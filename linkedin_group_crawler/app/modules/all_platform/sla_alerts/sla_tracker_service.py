"""Core Omnichannel Inbox SLA Tracker Service.

Manages:
- Hierarchical SLA configuration (`account:<channel>:<id>` -> `channel:<channel>` -> `global`) with 30s TTL cache.
- Real-time turn lifecycle hooks (`on_inbound_message`, `on_staff_reply`) with 23505 race protection & fail-soft guards.
- Live SLA dashboard analytics (KPIs, FRT/ART/P50/P90, by-channel, by-staff, daily trend).
- Turn queue listing, dismissal, live badges, and watchdog notification helpers.
- Idempotent 4-channel historical SLA backfill (Zalo, Messenger, Telegram, WhatsApp).
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple, Union
from urllib.parse import quote

from supabase import Client

from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.sla_alerts.business_hours import (
    DEFAULT_SHIFTS,
    DEFAULT_WORK_DAYS,
    VN_TZ,
    add_business_seconds,
    calculate_business_seconds,
    parse_iso_dt,
)
from app.modules.all_platform.sla_alerts.schemas import (
    BACKFILL_CHANNELS,
    SUPPORTED_SLA_CHANNELS,
    SlaConfigPayload,
)

logger = logging.getLogger(__name__)

IGNORED_MSG_KINDS = frozenset({"system_notice", "system", "call_log", "revoked"})
_CONFIG_CACHE_TTL_SECONDS = 30.0
_MAX_QUERY_ROWS = 20000
_PAGE_SIZE = 1000

DEFAULT_SLA_CONFIG: Dict[str, Any] = {
    "id": None,
    "scope_key": "global",
    "target_minutes": 5,
    "warning_pct": 70,
    "business_hours_enabled": True,
    "timezone": "Asia/Ho_Chi_Minh",
    "work_days": list(DEFAULT_WORK_DAYS),
    "shifts": [dict(s) for s in DEFAULT_SHIFTS],
    "include_group_chats": False,
    "exclude_bot_replies": True,
    "updated_by": None,
    "created_at": None,
    "updated_at": None,
}

_config_cache_lock = threading.Lock()
_config_cache_map: Optional[Dict[str, Dict[str, Any]]] = None
_config_cache_loaded_at: float = 0.0


# ── Internal Helpers ──────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now_utc().isoformat()


def _is_missing_table_error(exc: Exception) -> bool:
    """Detect un-migrated table errors (42P01 / PGRST205) for graceful fail-soft behavior."""
    msg = str(exc).lower()
    return (
        "42p01" in msg
        or "pgrst205" in msg
        or "does not exist" in msg
        or "could not find the table" in msg
        or "schema cache" in msg
    )


def _is_unique_violation_error(exc: Exception) -> bool:
    """Detect PostgreSQL unique violation (23505) on partial unique index ``uq_inbox_sla_turns_active``."""
    msg = str(exc).lower()
    return (
        "23505" in msg
        or "duplicate key" in msg
        or "uq_inbox_sla_turns_active" in msg
    )


def _truncate_preview(content: Optional[str], max_len: int = 280) -> Optional[str]:
    if content is None:
        return None
    text = " ".join(str(content).strip().split())
    if not text:
        return None
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _normalize_config_row(row: Optional[Dict[str, Any]], scope_key: str = "global") -> Dict[str, Any]:
    merged = dict(DEFAULT_SLA_CONFIG)
    merged["scope_key"] = scope_key
    if not isinstance(row, dict):
        return merged

    merged["id"] = row.get("id")
    merged["scope_key"] = str(row.get("scope_key") or scope_key)
    try:
        merged["target_minutes"] = max(1, min(1440, int(row.get("target_minutes") or 5)))
    except (TypeError, ValueError):
        merged["target_minutes"] = 5
    try:
        merged["warning_pct"] = max(10, min(99, int(row.get("warning_pct") or 70)))
    except (TypeError, ValueError):
        merged["warning_pct"] = 70

    merged["business_hours_enabled"] = bool(
        row.get("business_hours_enabled") if row.get("business_hours_enabled") is not None else True
    )
    merged["timezone"] = str(row.get("timezone") or "Asia/Ho_Chi_Minh")

    raw_days = row.get("work_days")
    if isinstance(raw_days, list) and raw_days:
        valid_days = sorted({int(d) for d in raw_days if isinstance(d, int) and 1 <= d <= 7})
        merged["work_days"] = valid_days or list(DEFAULT_WORK_DAYS)
    else:
        merged["work_days"] = list(DEFAULT_WORK_DAYS)

    raw_shifts = row.get("shifts")
    if isinstance(raw_shifts, list) and raw_shifts:
        clean_shifts: List[Dict[str, str]] = []
        for s in raw_shifts:
            if isinstance(s, dict) and s.get("start") and s.get("end"):
                clean_shifts.append({"start": str(s["start"]), "end": str(s["end"])})
        merged["shifts"] = clean_shifts or [dict(s) for s in DEFAULT_SHIFTS]
    else:
        merged["shifts"] = [dict(s) for s in DEFAULT_SHIFTS]

    merged["include_group_chats"] = bool(row.get("include_group_chats", False))
    merged["exclude_bot_replies"] = bool(
        row.get("exclude_bot_replies") if row.get("exclude_bot_replies") is not None else True
    )
    merged["updated_by"] = row.get("updated_by")
    merged["created_at"] = row.get("created_at")
    merged["updated_at"] = row.get("updated_at")
    return merged


def build_open_url(channel: str, account_id: str, conversation_id: str) -> str:
    """Build deep-link URL to open the conversation in the corresponding inbox screen."""
    ch = (channel or "").strip().lower()
    acc = str(account_id or "").strip()
    conv = str(conversation_id or "").strip()
    if ch == "zalo":
        return f"/all-platform/zalo-inbox?account={quote(acc, safe='')}&conversation={quote(conv, safe='')}"
    if ch == "messenger":
        return "/all-platform/messenger-inbox"
    if ch == "telegram":
        return "/all-platform/telegram-chat"
    if ch == "whatsapp":
        return "/all-platform/whatsapp-chat"
    if ch == "email":
        return "/all-platform/inbox"
    return "/all-platform/omnichannel-inbox"


def _resolve_user_profile(
    sb: Client,
    email: Optional[str],
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Resolve ``(app_users.id, app_users.name, normalized_email)`` from email."""
    clean = (email or "").strip().lower()
    if not clean:
        return None, None, None
    try:
        res = execute_supabase_query(
            lambda: sb.table("app_users")
            .select("id, name, email")
            .eq("email", clean)
            .limit(1)
            .execute()
        )
        if res.data:
            row = res.data[0]
            return (
                str(row["id"]) if row.get("id") else None,
                str(row.get("name")).strip() if row.get("name") else None,
                str(row.get("email") or clean).strip().lower(),
            )
    except Exception as exc:
        logger.debug(f"[SLA] Could not resolve app_users for {clean}: {exc}")
    return None, None, clean


def _vn_date_range_to_utc_bounds(
    start_date: Optional[str],
    end_date: Optional[str],
    *,
    default_days: int = 7,
) -> Tuple[str, str, str, str]:
    """Convert inclusive VN date strings ``[start_date, end_date]`` to half-open UTC ISO ``[start, end)``."""
    today_vn = datetime.now(VN_TZ).date()
    default_start = today_vn - timedelta(days=max(0, default_days - 1))

    def _parse_day(val: Optional[str], fallback):
        if not val:
            return fallback
        try:
            return datetime.fromisoformat(str(val).strip()[:10]).date()
        except Exception:
            return fallback

    e_date = _parse_day(end_date, today_vn)
    s_date = _parse_day(start_date, default_start if not end_date else e_date - timedelta(days=max(0, default_days - 1)))
    if s_date > e_date:
        s_date, e_date = e_date, s_date

    start_utc = datetime(s_date.year, s_date.month, s_date.day, tzinfo=VN_TZ).astimezone(timezone.utc)
    end_utc_exclusive = (
        datetime(e_date.year, e_date.month, e_date.day, tzinfo=VN_TZ) + timedelta(days=1)
    ).astimezone(timezone.utc)
    return s_date.isoformat(), e_date.isoformat(), start_utc.isoformat(), end_utc_exclusive.isoformat()


def _percentile(values: List[int], pct: float) -> int:
    """Linear-interpolated percentile (matching PostgreSQL ``percentile_cont``)."""
    if not values:
        return 0
    ordered = sorted(values)
    n = len(ordered)
    if n == 1:
        return int(ordered[0])
    rank = (pct / 100.0) * (n - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return int(round(ordered[low]))
    weight = rank - low
    return int(round(ordered[low] * (1.0 - weight) + ordered[high] * weight))


def _resolve_from_map(
    cfg_map: Dict[str, Dict[str, Any]],
    channel: Optional[str] = None,
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    ch = (channel or "").strip().lower()
    acc = str(account_id or "").strip()
    if ch and acc:
        acc_key = f"account:{ch}:{acc}"
        if acc_key in cfg_map:
            return cfg_map[acc_key]
    if ch:
        ch_key = f"channel:{ch}"
        if ch_key in cfg_map:
            return cfg_map[ch_key]
    return cfg_map.get("global") or dict(DEFAULT_SLA_CONFIG)


def _compute_live_waiting_state(
    turn: Dict[str, Any],
    now_dt: datetime,
    cfg: Dict[str, Any],
) -> Tuple[int, str, int, int]:
    """Return ``(wait_business_seconds, state, target_seconds, warning_pct)`` for a waiting turn."""
    cust_dt = parse_iso_dt(turn.get("customer_msg_at")) or now_dt
    wait_biz = calculate_business_seconds(cust_dt, now_dt, cfg)
    target_secs = int(turn.get("target_seconds") or (int(cfg.get("target_minutes") or 5) * 60))
    if target_secs <= 0:
        target_secs = 300
    warning_pct = int(cfg.get("warning_pct") or 70)
    warn_secs = max(1, int(math.floor(target_secs * warning_pct / 100.0)))

    if wait_biz >= target_secs:
        state = "breached"
    elif wait_biz >= warn_secs:
        state = "warning"
    else:
        state = "ok"
    return wait_biz, state, target_secs, warning_pct


def _enrich_turn(
    turn: Dict[str, Any],
    now_dt: datetime,
    cfg_map: Dict[str, Dict[str, Any]],
    *,
    include_config: bool = False,
) -> Dict[str, Any]:
    row = dict(turn)
    ch = str(row.get("channel") or "")
    acc = str(row.get("account_id") or "")
    conv = str(row.get("conversation_id") or "")
    cfg = _resolve_from_map(cfg_map, ch, acc)

    status = str(row.get("status") or "waiting")
    if status == "waiting":
        wait_biz, live_state, target_secs, warning_pct = _compute_live_waiting_state(row, now_dt, cfg)
        row["target_seconds"] = target_secs
        row["current_wait_business_seconds"] = wait_biz
        row["live_state"] = live_state
        if include_config:
            row["warning_pct"] = warning_pct
            row["sla_config"] = cfg
    else:
        row["current_wait_business_seconds"] = int(row.get("business_response_seconds") or 0)
        row["live_state"] = status
        if include_config:
            row["warning_pct"] = int(cfg.get("warning_pct") or 70)
            row["sla_config"] = cfg

    row["open_url"] = build_open_url(ch, acc, conv)
    return row


def _fetch_paginated(
    build_query_fn,
    *,
    max_rows: int = _MAX_QUERY_ROWS,
    page_size: int = _PAGE_SIZE,
) -> List[Dict[str, Any]]:
    """Fetch paginated rows from PostgREST safely past the default 1000-row cap."""
    rows: List[Dict[str, Any]] = []
    offset = 0
    while offset < max_rows:
        end = min(offset + page_size - 1, max_rows - 1)
        res = execute_supabase_query(lambda s=offset, e=end: build_query_fn().range(s, e).execute())
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < (end - offset + 1):
            break
        offset += len(batch)
    return rows


# ── Config Helpers (30s TTL Cache) ────────────────────────────────────────────

def invalidate_sla_config_cache() -> None:
    """Clear the in-memory 30s SLA config cache immediately after any upsert."""
    global _config_cache_map, _config_cache_loaded_at
    with _config_cache_lock:
        _config_cache_map = None
        _config_cache_loaded_at = 0.0


def _load_sla_configs_map(
    supabase: Optional[Client] = None,
    *,
    force_refresh: bool = False,
) -> Dict[str, Dict[str, Any]]:
    global _config_cache_map, _config_cache_loaded_at

    # Bypass cache when caller injects a custom/mock Supabase client (e.g. unit tests)
    use_cache = supabase is None and not force_refresh
    now_mono = time.monotonic()

    if use_cache:
        with _config_cache_lock:
            if (
                _config_cache_map is not None
                and (now_mono - _config_cache_loaded_at) < _CONFIG_CACHE_TTL_SECONDS
            ):
                return {k: dict(v) for k, v in _config_cache_map.items()}

    sb = supabase or get_supabase_client()
    cfg_map: Dict[str, Dict[str, Any]] = {"global": dict(DEFAULT_SLA_CONFIG)}
    try:
        res = execute_supabase_query(
            lambda: sb.table("inbox_sla_configs")
            .select("*")
            .order("scope_key", desc=False)
            .execute()
        )
        for raw in (res.data or []):
            key = str(raw.get("scope_key") or "").strip()
            if key:
                cfg_map[key] = _normalize_config_row(raw, key)
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.info(f"[SLA] inbox_sla_configs not ready yet; using defaults: {exc}")
        else:
            logger.warning(f"[SLA] Failed to load inbox_sla_configs: {exc}")

    if supabase is None:
        with _config_cache_lock:
            _config_cache_map = {k: dict(v) for k, v in cfg_map.items()}
            _config_cache_loaded_at = time.monotonic()

    return cfg_map


def get_sla_configs(supabase: Optional[Client] = None) -> Dict[str, Any]:
    """Return ``{'global': <SlaConfig>, 'overrides': [<SlaConfig>, ...]}``."""
    cfg_map = _load_sla_configs_map(supabase=supabase, force_refresh=True)
    global_cfg = cfg_map.get("global") or dict(DEFAULT_SLA_CONFIG)
    overrides = [
        cfg_map[k]
        for k in sorted(cfg_map.keys())
        if k != "global"
    ]
    return {
        "global": global_cfg,
        "overrides": overrides,
    }


def resolve_effective_sla_config(
    channel: Optional[str] = None,
    account_id: Optional[str] = None,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Resolve effective SLA config with hierarchy: ``account:<ch>:<id>`` -> ``channel:<ch>`` -> ``global``."""
    cfg_map = _load_sla_configs_map(supabase=supabase)
    return dict(_resolve_from_map(cfg_map, channel, account_id))


def upsert_sla_config(
    payload: Union[SlaConfigPayload, Dict[str, Any]],
    updated_by_email: Optional[str] = None,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Upsert an SLA config row by ``scope_key`` and invalidate the 30s config cache."""
    model = payload if isinstance(payload, SlaConfigPayload) else SlaConfigPayload.model_validate(payload)
    sb = supabase or get_supabase_client()
    user_id, _, _ = _resolve_user_profile(sb, updated_by_email)

    now_iso = _now_iso()
    record: Dict[str, Any] = {
        "scope_key": model.scope_key,
        "target_minutes": int(model.target_minutes),
        "warning_pct": int(model.warning_pct),
        "business_hours_enabled": bool(model.business_hours_enabled),
        "timezone": model.timezone,
        "work_days": list(model.work_days),
        "shifts": [{"start": s.start, "end": s.end} for s in model.shifts],
        "include_group_chats": bool(model.include_group_chats),
        "exclude_bot_replies": bool(model.exclude_bot_replies),
        "updated_by": user_id,
        "updated_at": now_iso,
    }

    try:
        res = execute_supabase_query(
            lambda: sb.table("inbox_sla_configs")
            .upsert(record, on_conflict="scope_key")
            .execute()
        )
        invalidate_sla_config_cache()
        saved = (res.data or [record])[0]
        return _normalize_config_row(saved, model.scope_key)
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.warning(f"[SLA] inbox_sla_configs not migrated yet: {exc}")
            raise RuntimeError("Bảng inbox_sla_configs chưa được migrate (Migration 243).") from exc
        raise


# ── Core Real-Time Hooks ──────────────────────────────────────────────────────

def _find_waiting_turn(
    sb: Client,
    channel: str,
    account_id: str,
    conversation_id: str,
) -> Optional[Dict[str, Any]]:
    res = execute_supabase_query(
        lambda: sb.table("inbox_sla_turns")
        .select("*")
        .eq("channel", channel)
        .eq("account_id", account_id)
        .eq("conversation_id", conversation_id)
        .eq("status", "waiting")
        .order("customer_msg_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def _update_existing_waiting_turn(
    sb: Client,
    existing: Dict[str, Any],
    *,
    received_dt: datetime,
    preview: Optional[str],
    account_name: Optional[str],
    customer_name: Optional[str],
    customer_phone: Optional[str],
) -> Dict[str, Any]:
    prev_last_dt = parse_iso_dt(existing.get("last_customer_msg_at")) or parse_iso_dt(existing.get("customer_msg_at"))
    latest_dt = max(prev_last_dt, received_dt) if prev_last_dt else received_dt
    updates: Dict[str, Any] = {
        "last_customer_msg_at": latest_dt.isoformat(),
        "unanswered_msg_count": int(existing.get("unanswered_msg_count") or 1) + 1,
        "updated_at": _now_iso(),
    }
    if preview:
        updates["last_msg_preview"] = preview
        if not existing.get("first_msg_preview"):
            updates["first_msg_preview"] = preview
    if account_name and not existing.get("account_name"):
        updates["account_name"] = account_name
    if customer_name and not existing.get("customer_name"):
        updates["customer_name"] = customer_name
    if customer_phone and not existing.get("customer_phone"):
        updates["customer_phone"] = customer_phone

    upd_res = execute_supabase_query(
        lambda: sb.table("inbox_sla_turns")
        .update(updates)
        .eq("id", existing["id"])
        .execute()
    )
    return (upd_res.data or [{**existing, **updates}])[0]


def on_inbound_message(
    channel: str,
    account_id: str,
    conversation_id: str,
    *,
    account_name: Optional[str] = None,
    customer_name: Optional[str] = None,
    customer_phone: Optional[str] = None,
    thread_type: str = "direct",
    content: Optional[str] = None,
    msg_kind: str = "text",
    received_at: Any = None,
    is_bot: bool = False,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Record a customer inbound message: open a new SLA turn or increment active waiting turn."""
    ch = (channel or "").strip().lower()
    acc = str(account_id or "").strip()
    conv = str(conversation_id or "").strip()
    if not ch or not acc or not conv or ch not in SUPPORTED_SLA_CHANNELS:
        return {"status": "skipped_invalid", "opened_new_turn": False, "turn": None, "sla_config": None}

    norm_kind = (msg_kind or "text").strip().lower()
    if norm_kind in IGNORED_MSG_KINDS:
        return {"status": "ignored_msg_kind", "opened_new_turn": False, "turn": None, "sla_config": None}

    sb = supabase or get_supabase_client()
    cfg = resolve_effective_sla_config(ch, acc, supabase=sb)

    if is_bot:
        return {"status": "ignored_bot", "opened_new_turn": False, "turn": None, "sla_config": cfg}

    norm_thread_type = "group" if str(thread_type or "").strip().lower() == "group" else "direct"
    if norm_thread_type == "group" and not bool(cfg.get("include_group_chats", False)):
        return {"status": "ignored_group", "opened_new_turn": False, "turn": None, "sla_config": cfg}

    received_dt = parse_iso_dt(received_at) or _now_utc()
    received_iso = received_dt.isoformat()
    preview = _truncate_preview(content)
    open_url = build_open_url(ch, acc, conv)

    try:
        existing = _find_waiting_turn(sb, ch, acc, conv)
        if existing:
            updated = _update_existing_waiting_turn(
                sb,
                existing,
                received_dt=received_dt,
                preview=preview,
                account_name=account_name,
                customer_name=customer_name,
                customer_phone=customer_phone,
            )
            updated["open_url"] = open_url
            return {
                "status": "updated_waiting",
                "opened_new_turn": False,
                "turn": updated,
                "sla_config": cfg,
            }

        # Check if conversation ever had any prior SLA turn -> determines is_first_turn (FRT)
        prior_res = execute_supabase_query(
            lambda: sb.table("inbox_sla_turns")
            .select("id")
            .eq("channel", ch)
            .eq("account_id", acc)
            .eq("conversation_id", conv)
            .limit(1)
            .execute()
        )
        is_first_turn = not bool(prior_res.data)

        target_seconds = max(60, int(cfg.get("target_minutes") or 5) * 60)
        deadline_dt = add_business_seconds(received_dt, target_seconds, cfg)
        now_iso = _now_iso()

        insert_row: Dict[str, Any] = {
            "channel": ch,
            "account_id": acc,
            "account_name": account_name,
            "conversation_id": conv,
            "customer_name": customer_name,
            "customer_phone": customer_phone,
            "thread_type": norm_thread_type,
            "customer_msg_at": received_iso,
            "last_customer_msg_at": received_iso,
            "unanswered_msg_count": 1,
            "first_msg_preview": preview,
            "last_msg_preview": preview,
            "deadline_at": deadline_dt.isoformat(),
            "target_seconds": target_seconds,
            "is_first_turn": is_first_turn,
            "status": "waiting",
            "created_at": now_iso,
            "updated_at": now_iso,
        }

        try:
            ins_res = execute_supabase_query(
                lambda: sb.table("inbox_sla_turns").insert(insert_row).execute()
            )
            row = (ins_res.data or [insert_row])[0]
            row["open_url"] = open_url
            return {
                "status": "opened",
                "opened_new_turn": True,
                "turn": row,
                "sla_config": cfg,
            }
        except Exception as ins_exc:
            # Handle 23505 race condition on partial unique index uq_inbox_sla_turns_active
            if _is_unique_violation_error(ins_exc):
                concurrent = _find_waiting_turn(sb, ch, acc, conv)
                if concurrent:
                    updated = _update_existing_waiting_turn(
                        sb,
                        concurrent,
                        received_dt=received_dt,
                        preview=preview,
                        account_name=account_name,
                        customer_name=customer_name,
                        customer_phone=customer_phone,
                    )
                    updated["open_url"] = open_url
                    return {
                        "status": "updated_waiting",
                        "opened_new_turn": False,
                        "turn": updated,
                        "sla_config": cfg,
                    }
            raise
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.info(f"[SLA] inbox_sla_turns not ready yet; skipping on_inbound_message: {exc}")
            return {"status": "table_not_ready", "opened_new_turn": False, "turn": None, "sla_config": cfg}
        logger.warning(f"[SLA] on_inbound_message error ({ch}/{acc}/{conv}): {exc}")
        return {"status": "error", "opened_new_turn": False, "turn": None, "sla_config": cfg, "error": str(exc)}


def on_staff_reply(
    channel: str,
    account_id: str,
    conversation_id: str,
    *,
    caller_email: Optional[str] = None,
    caller_name: Optional[str] = None,
    replied_at: Any = None,
    is_bot: bool = False,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Close active waiting SLA turn when staff sends a reply."""
    ch = (channel or "").strip().lower()
    acc = str(account_id or "").strip()
    conv = str(conversation_id or "").strip()
    if not ch or not acc or not conv or ch not in SUPPORTED_SLA_CHANNELS:
        return {"status": "skipped_invalid", "turn": None}

    sb = supabase or get_supabase_client()
    cfg = resolve_effective_sla_config(ch, acc, supabase=sb)

    if is_bot and bool(cfg.get("exclude_bot_replies", True)):
        return {"status": "ignored_bot", "turn": None}

    try:
        waiting = _find_waiting_turn(sb, ch, acc, conv)
        if not waiting:
            return {"status": "no_waiting_turn", "turn": None}

        user_id, db_name, norm_email = _resolve_user_profile(sb, caller_email)
        final_name = (caller_name or "").strip() or db_name or norm_email

        reply_dt = parse_iso_dt(replied_at) or _now_utc()
        cust_dt = parse_iso_dt(waiting.get("customer_msg_at")) or reply_dt

        raw_secs = max(0, int((reply_dt - cust_dt).total_seconds()))
        biz_secs = calculate_business_seconds(cust_dt, reply_dt, cfg)
        target_secs = int(waiting.get("target_seconds") or (int(cfg.get("target_minutes") or 5) * 60))
        if target_secs <= 0:
            target_secs = 300

        new_status = "met" if biz_secs <= target_secs else "breached"
        updates: Dict[str, Any] = {
            "staff_reply_at": reply_dt.isoformat(),
            "raw_response_seconds": raw_secs,
            "business_response_seconds": biz_secs,
            "status": new_status,
            "responded_by_user_id": user_id,
            "responded_by_email": norm_email,
            "responded_by_name": final_name,
            "updated_at": _now_iso(),
        }

        upd_res = execute_supabase_query(
            lambda: sb.table("inbox_sla_turns")
            .update(updates)
            .eq("id", waiting["id"])
            .eq("status", "waiting")
            .execute()
        )
        updated_row = (upd_res.data or [{**waiting, **updates}])[0]
        updated_row["open_url"] = build_open_url(ch, acc, conv)
        return {
            "status": new_status,
            "turn": updated_row,
        }
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.info(f"[SLA] inbox_sla_turns not ready yet; skipping on_staff_reply: {exc}")
            return {"status": "table_not_ready", "turn": None}
        logger.warning(f"[SLA] on_staff_reply error ({ch}/{acc}/{conv}): {exc}")
        return {"status": "error", "turn": None, "error": str(exc)}


# ── Dashboard, Queue, Dismiss, Live Badges & Watchdog ─────────────────────────

def get_sla_dashboard(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    channel: str = "all",
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Aggregate SLA KPIs, per-channel breakdown, staff leaderboard, and daily trend."""
    norm_channel = (channel or "all").strip().lower()
    if norm_channel not in ("all", *SUPPORTED_SLA_CHANNELS):
        norm_channel = "all"

    s_str, e_str, start_utc_iso, end_utc_iso = _vn_date_range_to_utc_bounds(start_date, end_date, default_days=7)
    empty_payload = {
        "range": {"start_date": s_str, "end_date": e_str, "channel": norm_channel},
        "kpis": {
            "total_turns": 0,
            "met_count": 0,
            "breached_count": 0,
            "waiting_count": 0,
            "waiting_breached_count": 0,
            "waiting_warning_count": 0,
            "sla_compliance_pct": 0.0,
            "avg_frt_seconds": 0,
            "avg_response_seconds": 0,
            "p50_response_seconds": 0,
            "p90_response_seconds": 0,
        },
        "by_channel": [],
        "by_staff": [],
        "daily_trend": [],
    }

    sb = supabase or get_supabase_client()
    cfg_map = _load_sla_configs_map(supabase=sb)
    now_dt = _now_utc()

    try:
        def _build_range_query():
            q = (
                sb.table("inbox_sla_turns")
                .select(
                    "id, channel, account_id, customer_msg_at, staff_reply_at, deadline_at, "
                    "business_response_seconds, target_seconds, is_first_turn, status, "
                    "responded_by_user_id, responded_by_email, responded_by_name"
                )
                .neq("status", "dismissed")
                .gte("customer_msg_at", start_utc_iso)
                .lt("customer_msg_at", end_utc_iso)
                .order("customer_msg_at", desc=False)
            )
            if norm_channel != "all":
                q = q.eq("channel", norm_channel)
            return q

        def _build_waiting_query():
            q = (
                sb.table("inbox_sla_turns")
                .select(
                    "id, channel, account_id, customer_msg_at, deadline_at, target_seconds, status"
                )
                .eq("status", "waiting")
                .order("customer_msg_at", desc=False)
            )
            if norm_channel != "all":
                q = q.eq("channel", norm_channel)
            return q

        range_rows = _fetch_paginated(_build_range_query)
        waiting_rows = _fetch_paginated(_build_waiting_query)
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.info(f"[SLA] inbox_sla_turns not ready for dashboard: {exc}")
            return empty_payload
        logger.warning(f"[SLA] get_sla_dashboard error: {exc}")
        raise

    # Live waiting metrics (across all active waiting turns for the selected channel)
    waiting_count = len(waiting_rows)
    waiting_breached_count = 0
    waiting_warning_count = 0
    waiting_by_channel: Dict[str, int] = defaultdict(int)
    for w_row in waiting_rows:
        w_ch = str(w_row.get("channel") or "zalo")
        waiting_by_channel[w_ch] += 1
        w_cfg = _resolve_from_map(cfg_map, w_ch, w_row.get("account_id"))
        _, live_state, _, _ = _compute_live_waiting_state(w_row, now_dt, w_cfg)
        if live_state == "breached":
            waiting_breached_count += 1
        elif live_state == "warning":
            waiting_warning_count += 1

    # Aggregate range turns
    total_turns = len(range_rows)
    met_count = 0
    breached_count = 0
    closed_biz_secs: List[int] = []
    frt_biz_secs: List[int] = []

    channel_buckets: Dict[str, Dict[str, Any]] = {}
    staff_buckets: Dict[str, Dict[str, Any]] = {}
    day_buckets: Dict[str, Dict[str, Any]] = {}

    # Seed continuous days in range (up to 90 days) for clean daily charts
    try:
        s_day = datetime.fromisoformat(s_str).date()
        e_day = datetime.fromisoformat(e_str).date()
        if (e_day - s_day).days <= 90:
            cur = s_day
            while cur <= e_day:
                day_key = cur.isoformat()
                day_buckets[day_key] = {
                    "day": day_key,
                    "total": 0,
                    "met": 0,
                    "breached": 0,
                    "biz_secs": [],
                }
                cur += timedelta(days=1)
    except Exception:
        pass

    for row in range_rows:
        st = str(row.get("status") or "waiting")
        ch = str(row.get("channel") or "zalo")
        biz = row.get("business_response_seconds")
        biz_int = int(biz) if biz is not None else None

        ch_b = channel_buckets.setdefault(
            ch,
            {"channel": ch, "total": 0, "met": 0, "breached": 0, "waiting": 0, "biz_secs": []},
        )
        ch_b["total"] += 1

        cust_dt = parse_iso_dt(row.get("customer_msg_at"))
        day_key = cust_dt.astimezone(VN_TZ).date().isoformat() if cust_dt else s_str
        d_b = day_buckets.setdefault(
            day_key,
            {"day": day_key, "total": 0, "met": 0, "breached": 0, "biz_secs": []},
        )
        d_b["total"] += 1

        if st == "met":
            met_count += 1
            ch_b["met"] += 1
            d_b["met"] += 1
        elif st == "breached":
            breached_count += 1
            ch_b["breached"] += 1
            d_b["breached"] += 1
        elif st == "waiting":
            ch_b["waiting"] += 1

        if st in ("met", "breached") and biz_int is not None:
            closed_biz_secs.append(biz_int)
            ch_b["biz_secs"].append(biz_int)
            d_b["biz_secs"].append(biz_int)
            if row.get("is_first_turn"):
                frt_biz_secs.append(biz_int)

        if st in ("met", "breached"):
            uid = str(row.get("responded_by_user_id") or "").strip() or None
            email = str(row.get("responded_by_email") or "").strip().lower()
            name = str(row.get("responded_by_name") or "").strip()
            if uid or email or name:
                staff_key = uid or email or name
                s_b = staff_buckets.setdefault(
                    staff_key,
                    {
                        "user_id": uid,
                        "email": email,
                        "name": name or email or "Không rõ",
                        "total": 0,
                        "met": 0,
                        "breached": 0,
                        "biz_secs": [],
                    },
                )
                if name and (not s_b["name"] or s_b["name"] == s_b["email"]):
                    s_b["name"] = name
                if email and not s_b["email"]:
                    s_b["email"] = email
                s_b["total"] += 1
                if st == "met":
                    s_b["met"] += 1
                else:
                    s_b["breached"] += 1
                if biz_int is not None:
                    s_b["biz_secs"].append(biz_int)

    # Ensure channels that only have active waiting turns also appear in by_channel
    for w_ch, w_cnt in waiting_by_channel.items():
        if w_ch not in channel_buckets:
            channel_buckets[w_ch] = {
                "channel": w_ch,
                "total": 0,
                "met": 0,
                "breached": 0,
                "waiting": w_cnt,
                "biz_secs": [],
            }
        else:
            channel_buckets[w_ch]["waiting"] = max(channel_buckets[w_ch]["waiting"], w_cnt)

    closed_total = met_count + breached_count
    sla_compliance_pct = round((met_count * 100.0) / closed_total, 2) if closed_total > 0 else 0.0
    avg_response_seconds = int(round(sum(closed_biz_secs) / len(closed_biz_secs))) if closed_biz_secs else 0
    avg_frt_seconds = int(round(sum(frt_biz_secs) / len(frt_biz_secs))) if frt_biz_secs else 0
    p50_response_seconds = _percentile(closed_biz_secs, 50)
    p90_response_seconds = _percentile(closed_biz_secs, 90)

    by_channel: List[Dict[str, Any]] = []
    for ch_b in sorted(channel_buckets.values(), key=lambda x: (-x["total"], x["channel"])):
        c_closed = ch_b["met"] + ch_b["breached"]
        secs = ch_b["biz_secs"]
        by_channel.append({
            "channel": ch_b["channel"],
            "total": ch_b["total"],
            "met": ch_b["met"],
            "breached": ch_b["breached"],
            "waiting": ch_b["waiting"],
            "compliance_pct": round((ch_b["met"] * 100.0) / c_closed, 2) if c_closed > 0 else 0.0,
            "avg_response_seconds": int(round(sum(secs) / len(secs))) if secs else 0,
        })

    by_staff: List[Dict[str, Any]] = []
    for s_b in staff_buckets.values():
        s_closed = s_b["met"] + s_b["breached"]
        secs = s_b["biz_secs"]
        by_staff.append({
            "user_id": s_b["user_id"],
            "email": s_b["email"],
            "name": s_b["name"],
            "total": s_b["total"],
            "met": s_b["met"],
            "breached": s_b["breached"],
            "compliance_pct": round((s_b["met"] * 100.0) / s_closed, 2) if s_closed > 0 else 0.0,
            "avg_response_seconds": int(round(sum(secs) / len(secs))) if secs else 0,
            "p90_response_seconds": _percentile(secs, 90),
        })
    by_staff.sort(key=lambda x: (-x["compliance_pct"], -x["total"], x["avg_response_seconds"]))

    daily_trend: List[Dict[str, Any]] = []
    for d_key in sorted(day_buckets.keys()):
        d_b = day_buckets[d_key]
        d_closed = d_b["met"] + d_b["breached"]
        secs = d_b["biz_secs"]
        daily_trend.append({
            "day": d_b["day"],
            "total": d_b["total"],
            "met": d_b["met"],
            "breached": d_b["breached"],
            "compliance_pct": round((d_b["met"] * 100.0) / d_closed, 2) if d_closed > 0 else 0.0,
            "avg_response_seconds": int(round(sum(secs) / len(secs))) if secs else 0,
        })

    return {
        "range": {"start_date": s_str, "end_date": e_str, "channel": norm_channel},
        "kpis": {
            "total_turns": total_turns,
            "met_count": met_count,
            "breached_count": breached_count,
            "waiting_count": waiting_count,
            "waiting_breached_count": waiting_breached_count,
            "waiting_warning_count": waiting_warning_count,
            "sla_compliance_pct": sla_compliance_pct,
            "avg_frt_seconds": avg_frt_seconds,
            "avg_response_seconds": avg_response_seconds,
            "p50_response_seconds": p50_response_seconds,
            "p90_response_seconds": p90_response_seconds,
        },
        "by_channel": by_channel,
        "by_staff": by_staff,
        "daily_trend": daily_trend,
    }


def list_sla_turns(
    status: str = "all",
    channel: str = "all",
    staff_email: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """List SLA turns with live waiting metrics, state, and channel deep-link ``open_url``."""
    norm_status = (status or "all").strip().lower()
    norm_channel = (channel or "all").strip().lower()
    clean_staff = (staff_email or "").strip().lower()
    clean_search = (search or "").strip()
    safe_limit = max(1, min(200, int(limit or 50)))
    safe_offset = max(0, int(offset or 0))

    sb = supabase or get_supabase_client()
    cfg_map = _load_sla_configs_map(supabase=sb)
    now_dt = _now_utc()

    start_utc_iso: Optional[str] = None
    end_utc_iso: Optional[str] = None
    if start_date or end_date:
        _, _, start_utc_iso, end_utc_iso = _vn_date_range_to_utc_bounds(start_date, end_date, default_days=7)

    try:
        q = sb.table("inbox_sla_turns").select("*", count="exact")

        if norm_status == "waiting_breached":
            q = q.eq("status", "waiting")
        elif norm_status in ("waiting", "met", "breached", "dismissed"):
            q = q.eq("status", norm_status)

        if norm_channel in SUPPORTED_SLA_CHANNELS:
            q = q.eq("channel", norm_channel)

        if clean_staff:
            q = q.ilike("responded_by_email", f"%{clean_staff}%")

        if start_utc_iso:
            q = q.gte("customer_msg_at", start_utc_iso)
        if end_utc_iso:
            q = q.lt("customer_msg_at", end_utc_iso)

        if clean_search:
            safe_term = clean_search.replace(",", " ").replace("(", " ").replace(")", " ").strip()
            if safe_term:
                q = q.or_(
                    f"customer_name.ilike.%{safe_term}%,"
                    f"customer_phone.ilike.%{safe_term}%,"
                    f"account_name.ilike.%{safe_term}%,"
                    f"conversation_id.ilike.%{safe_term}%,"
                    f"first_msg_preview.ilike.%{safe_term}%,"
                    f"last_msg_preview.ilike.%{safe_term}%"
                )

        if norm_status == "waiting_breached":
            # Filter live waiting_breached in Python because business-hours calculation is exact here
            res = execute_supabase_query(lambda: q.order("customer_msg_at", desc=False).range(0, 999).execute())
            enriched = [_enrich_turn(r, now_dt, cfg_map) for r in (res.data or [])]
            filtered = [r for r in enriched if r.get("live_state") == "breached"]
            return {
                "items": filtered[safe_offset : safe_offset + safe_limit],
                "total": len(filtered),
            }

        # Waiting queue is most actionable oldest-first; general history newest-first
        order_desc = norm_status != "waiting"
        res = execute_supabase_query(
            lambda: q.order("customer_msg_at", desc=order_desc)
            .range(safe_offset, safe_offset + safe_limit - 1)
            .execute()
        )
        items = [_enrich_turn(r, now_dt, cfg_map) for r in (res.data or [])]
        total = res.count if res.count is not None else len(items)
        return {
            "items": items,
            "total": int(total),
        }
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.info(f"[SLA] inbox_sla_turns not ready for list_sla_turns: {exc}")
            return {"items": [], "total": 0}
        logger.warning(f"[SLA] list_sla_turns error: {exc}")
        raise


def dismiss_sla_turn(
    turn_id: str,
    reason: Optional[str] = None,
    caller_email: Optional[str] = None,
    supabase: Optional[Client] = None,
) -> Optional[Dict[str, Any]]:
    """Dismiss a spam/non-actionable SLA turn and return the updated record (or None if not found)."""
    clean_id = str(turn_id or "").strip()
    if not clean_id:
        return None

    sb = supabase or get_supabase_client()
    user_id, _, _ = _resolve_user_profile(sb, caller_email)
    updates: Dict[str, Any] = {
        "status": "dismissed",
        "dismiss_reason": (reason or "").strip() or None,
        "dismissed_by": user_id,
        "updated_at": _now_iso(),
    }

    try:
        res = execute_supabase_query(
            lambda: sb.table("inbox_sla_turns")
            .update(updates)
            .eq("id", clean_id)
            .execute()
        )
        if not res.data:
            return None
        cfg_map = _load_sla_configs_map(supabase=sb)
        return _enrich_turn(res.data[0], _now_utc(), cfg_map)
    except Exception as exc:
        if _is_missing_table_error(exc):
            return None
        logger.warning(f"[SLA] dismiss_sla_turn error ({clean_id}): {exc}")
        raise


def get_live_sla_badges(
    channel: str = "all",
    supabase: Optional[Client] = None,
) -> List[Dict[str, Any]]:
    """Return live SLA badges for all active waiting turns (sorted by urgency)."""
    norm_channel = (channel or "all").strip().lower()
    sb = supabase or get_supabase_client()
    cfg_map = _load_sla_configs_map(supabase=sb)
    now_dt = _now_utc()

    try:
        def _build_q():
            q = (
                sb.table("inbox_sla_turns")
                .select(
                    "id, channel, account_id, account_name, conversation_id, customer_name, "
                    "customer_msg_at, last_customer_msg_at, deadline_at, target_seconds, "
                    "unanswered_msg_count, status"
                )
                .eq("status", "waiting")
                .order("customer_msg_at", desc=False)
            )
            if norm_channel in SUPPORTED_SLA_CHANNELS:
                q = q.eq("channel", norm_channel)
            return q

        rows = _fetch_paginated(_build_q, max_rows=5000)
    except Exception as exc:
        if _is_missing_table_error(exc):
            return []
        logger.warning(f"[SLA] get_live_sla_badges error: {exc}")
        raise

    severity_rank = {"breached": 0, "warning": 1, "ok": 2}
    badges: List[Dict[str, Any]] = []
    for row in rows:
        ch = str(row.get("channel") or "zalo")
        acc = str(row.get("account_id") or "")
        conv = str(row.get("conversation_id") or "")
        cfg = _resolve_from_map(cfg_map, ch, acc)
        wait_biz, state, target_secs, warning_pct = _compute_live_waiting_state(row, now_dt, cfg)
        badges.append({
            "id": row.get("id"),
            "turn_id": row.get("id"),
            "channel": ch,
            "account_id": acc,
            "account_name": row.get("account_name"),
            "conversation_id": conv,
            "customer_name": row.get("customer_name"),
            "customer_msg_at": row.get("customer_msg_at"),
            "last_customer_msg_at": row.get("last_customer_msg_at"),
            "deadline_at": row.get("deadline_at"),
            "unanswered_msg_count": int(row.get("unanswered_msg_count") or 1),
            "target_seconds": target_secs,
            "warning_pct": warning_pct,
            "wait_business_seconds": wait_biz,
            "current_wait_business_seconds": wait_biz,
            "state": state,
            "live_state": state,
            "open_url": build_open_url(ch, acc, conv),
        })

    badges.sort(key=lambda b: (severity_rank.get(b["state"], 9), -int(b["wait_business_seconds"])))
    return badges


def list_waiting_turns_for_watchdog(supabase: Optional[Client] = None) -> List[Dict[str, Any]]:
    """Return all active ``waiting`` turns enriched with effective SLA config & live wait seconds."""
    sb = supabase or get_supabase_client()
    cfg_map = _load_sla_configs_map(supabase=sb)
    now_dt = _now_utc()

    try:
        rows = _fetch_paginated(
            lambda: sb.table("inbox_sla_turns")
            .select("*")
            .eq("status", "waiting")
            .order("customer_msg_at", desc=False),
            max_rows=5000,
        )
    except Exception as exc:
        if _is_missing_table_error(exc):
            return []
        logger.warning(f"[SLA] list_waiting_turns_for_watchdog error: {exc}")
        return []

    return [_enrich_turn(row, now_dt, cfg_map, include_config=True) for row in rows]


def mark_turn_notified(
    turn_id: str,
    kind: str,
    supabase: Optional[Client] = None,
) -> bool:
    """Atomically mark a turn's ``warning_notified_at`` or ``breach_notified_at`` if still NULL.

    Returns ``True`` only if this call actually set the timestamp (guards against duplicate alerts).
    """
    clean_id = str(turn_id or "").strip()
    norm_kind = (kind or "").strip().lower()
    if not clean_id:
        return False

    if norm_kind in ("warning", "sla_warning"):
        col = "warning_notified_at"
    elif norm_kind in ("breach", "sla_breach"):
        col = "breach_notified_at"
    else:
        raise ValueError(f"Unsupported notification kind: {kind!r} (expected 'warning' or 'breach')")

    sb = supabase or get_supabase_client()
    now_iso = _now_iso()
    try:
        res = execute_supabase_query(
            lambda: sb.table("inbox_sla_turns")
            .update({col: now_iso, "updated_at": now_iso})
            .eq("id", clean_id)
            .is_(col, "null")
            .execute()
        )
        return bool(res.data)
    except Exception as exc:
        if _is_missing_table_error(exc):
            return False
        logger.warning(f"[SLA] mark_turn_notified({clean_id}, {kind}) error: {exc}")
        return False


# ── Idempotent 4-Channel Historical SLA Backfill ──────────────────────────────

def _dedup_key(channel: str, account_id: str, conversation_id: str, dt: datetime) -> Tuple[str, str, str, int]:
    """Normalize idempotency key to integer UTC epoch seconds to avoid microsecond formatting drift."""
    return (channel, str(account_id), str(conversation_id), int(dt.timestamp()))


def _load_existing_turn_keys(
    sb: Client,
    channels: List[str],
    cutoff_iso: str,
) -> Tuple[Set[Tuple[str, str, str, int]], Set[Tuple[str, str, str]], Set[Tuple[str, str, str]]]:
    """Return ``(existing_turn_keys, active_waiting_convs, convs_with_any_turn)``."""
    existing_keys: Set[Tuple[str, str, str, int]] = set()
    active_waiting: Set[Tuple[str, str, str]] = set()
    convs_with_history: Set[Tuple[str, str, str]] = set()

    try:
        rows = _fetch_paginated(
            lambda: sb.table("inbox_sla_turns")
            .select("channel, account_id, conversation_id, customer_msg_at, status")
            .in_("channel", channels)
            .gte("customer_msg_at", cutoff_iso)
            .order("customer_msg_at", desc=False),
            max_rows=50000,
        )
        for r in rows:
            ch = str(r.get("channel") or "")
            acc = str(r.get("account_id") or "")
            conv = str(r.get("conversation_id") or "")
            convs_with_history.add((ch, acc, conv))
            if r.get("status") == "waiting":
                active_waiting.add((ch, acc, conv))
            dt = parse_iso_dt(r.get("customer_msg_at"))
            if dt:
                existing_keys.add(_dedup_key(ch, acc, conv, dt))
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning(f"[SLA-Backfill] Error loading existing turn keys: {exc}")

    # Also ensure we know ALL currently active waiting turns (even older than cutoff)
    try:
        wait_rows = _fetch_paginated(
            lambda: sb.table("inbox_sla_turns")
            .select("channel, account_id, conversation_id")
            .in_("channel", channels)
            .eq("status", "waiting"),
            max_rows=10000,
        )
        for r in wait_rows:
            ch = str(r.get("channel") or "")
            acc = str(r.get("account_id") or "")
            conv = str(r.get("conversation_id") or "")
            active_waiting.add((ch, acc, conv))
            convs_with_history.add((ch, acc, conv))
    except Exception:
        pass

    return existing_keys, active_waiting, convs_with_history


def _safe_fetch_lookup_rows(sb: Client, table: str, select_cols: str, limit: int = 5000) -> List[Dict[str, Any]]:
    try:
        return _fetch_paginated(
            lambda: sb.table(table).select(select_cols),
            max_rows=limit,
        )
    except Exception:
        return []


def _load_channel_messages_for_backfill(
    sb: Client,
    channel: str,
    cutoff_iso: str,
) -> List[Dict[str, Any]]:
    """Normalize raw messages from each channel table into a uniform chronological event list."""
    events: List[Dict[str, Any]] = []

    if channel == "zalo":
        acc_names: Dict[str, str] = {}
        for row in _safe_fetch_lookup_rows(sb, "zalo_accounts", "account_id, label, phone, owner_name"):
            aid = str(row.get("account_id") or "").strip()
            if aid:
                acc_names[aid] = str(
                    row.get("label") or row.get("phone") or row.get("owner_name") or ""
                ).strip() or aid

        group_meta: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for row in _safe_fetch_lookup_rows(sb, "zalo_groups", "user_id, group_id, group_name, thread_type, is_friend", limit=20000):
            uid = str(row.get("user_id") or "").strip()
            gid = str(row.get("group_id") or "").strip()
            if uid and gid:
                group_meta[(uid, gid)] = row

        try:
            raw_msgs = _fetch_paginated(
                lambda: sb.table("zalo_messages")
                .select("user_id, group_id, group_name, is_sent, ts, created_at, sender_name, content, msg_kind, type, is_deleted")
                .gte("created_at", cutoff_iso)
                .order("created_at", desc=False),
                max_rows=25000,
            )
        except Exception as exc:
            logger.warning(f"[SLA-Backfill] zalo_messages fetch error: {exc}")
            return []

        for m in raw_msgs:
            if m.get("is_deleted"):
                continue
            acc_id = str(m.get("user_id") or "").strip()
            conv_id = str(m.get("group_id") or "").strip()
            if not acc_id or not conv_id:
                continue
            kind = str(m.get("msg_kind") or m.get("type") or "text").strip().lower()
            if kind in IGNORED_MSG_KINDS:
                continue
            dt = parse_iso_dt(m.get("ts")) or parse_iso_dt(m.get("created_at"))
            if dt is None:
                continue
            g_info = group_meta.get((acc_id, conv_id), {})
            g_tt = str(g_info.get("thread_type") or "").strip().lower()
            is_friend = bool(g_info.get("is_friend"))
            thread_type = "group" if (g_tt == "group" and not is_friend) else "direct"
            customer_name = (
                str(g_info.get("group_name") or m.get("group_name") or "").strip()
                or (str(m.get("sender_name") or "").strip() if not m.get("is_sent") else "")
                or None
            )
            events.append({
                "account_id": acc_id,
                "account_name": acc_names.get(acc_id),
                "conversation_id": conv_id,
                "customer_name": customer_name,
                "customer_phone": None,
                "thread_type": thread_type,
                "is_outgoing": bool(m.get("is_sent")),
                "dt": dt,
                "content": m.get("content"),
            })

    elif channel == "messenger":
        acc_names = {}
        for row in _safe_fetch_lookup_rows(sb, "fb_messenger_accounts", "id, name"):
            aid = str(row.get("id") or "").strip()
            if aid:
                acc_names[aid] = str(row.get("name") or "").strip() or aid

        thread_names: Dict[Tuple[str, str], str] = {}
        for row in _safe_fetch_lookup_rows(sb, "fb_messenger_threads", "account_id, thread_id, recipient_name", limit=20000):
            aid = str(row.get("account_id") or "").strip()
            tid = str(row.get("thread_id") or "").strip()
            if aid and tid and row.get("recipient_name"):
                thread_names[(aid, tid)] = str(row["recipient_name"]).strip()

        try:
            raw_msgs = _fetch_paginated(
                lambda: sb.table("fb_messenger_messages")
                .select("account_id, thread_id, is_self, is_echo, created_at, sender_name, content")
                .gte("created_at", cutoff_iso)
                .order("created_at", desc=False),
                max_rows=25000,
            )
        except Exception as exc:
            logger.warning(f"[SLA-Backfill] fb_messenger_messages fetch error: {exc}")
            return []

        for m in raw_msgs:
            acc_id = str(m.get("account_id") or "").strip()
            conv_id = str(m.get("thread_id") or "").strip()
            if not acc_id or not conv_id:
                continue
            dt = parse_iso_dt(m.get("created_at"))
            if dt is None:
                continue
            is_out = bool(m.get("is_self")) or bool(m.get("is_echo"))
            customer_name = (
                thread_names.get((acc_id, conv_id))
                or (str(m.get("sender_name") or "").strip() if not is_out else "")
                or None
            )
            events.append({
                "account_id": acc_id,
                "account_name": acc_names.get(acc_id),
                "conversation_id": conv_id,
                "customer_name": customer_name,
                "customer_phone": None,
                "thread_type": "direct",
                "is_outgoing": is_out,
                "dt": dt,
                "content": m.get("content"),
            })

    elif channel == "telegram":
        acc_names = {}
        for row in _safe_fetch_lookup_rows(sb, "telegram_accounts", "id, display_name, label, username"):
            aid = str(row.get("id") or "").strip()
            if aid:
                acc_names[aid] = str(row.get("display_name") or row.get("label") or row.get("username") or "").strip() or aid

        dialog_meta: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for row in _safe_fetch_lookup_rows(sb, "telegram_dialogs", "account_id, dialog_id, dialog_type, title", limit=20000):
            aid = str(row.get("account_id") or "").strip()
            did = str(row.get("dialog_id") or "").strip()
            if aid and did:
                dialog_meta[(aid, did)] = row

        try:
            raw_msgs = _fetch_paginated(
                lambda: sb.table("telegram_messages")
                .select("account_id, dialog_id, is_outgoing, sent_at, sender_name, text, is_deleted")
                .gte("sent_at", cutoff_iso)
                .order("sent_at", desc=False),
                max_rows=25000,
            )
        except Exception as exc:
            logger.warning(f"[SLA-Backfill] telegram_messages fetch error: {exc}")
            return []

        for m in raw_msgs:
            if m.get("is_deleted"):
                continue
            acc_id = str(m.get("account_id") or "").strip()
            conv_id = str(m.get("dialog_id") or "").strip()
            if not acc_id or not conv_id:
                continue
            dt = parse_iso_dt(m.get("sent_at"))
            if dt is None:
                continue
            d_info = dialog_meta.get((acc_id, conv_id), {})
            d_type = str(d_info.get("dialog_type") or "user").strip().lower()
            thread_type = "group" if d_type in ("group", "channel") else "direct"
            is_out = bool(m.get("is_outgoing"))
            customer_name = (
                str(d_info.get("title") or "").strip()
                or (str(m.get("sender_name") or "").strip() if not is_out else "")
                or None
            )
            events.append({
                "account_id": acc_id,
                "account_name": acc_names.get(acc_id),
                "conversation_id": conv_id,
                "customer_name": customer_name,
                "customer_phone": None,
                "thread_type": thread_type,
                "is_outgoing": is_out,
                "dt": dt,
                "content": m.get("text"),
            })

    elif channel == "whatsapp":
        acc_names = {}
        for row in _safe_fetch_lookup_rows(sb, "whatsapp_accounts", "id, display_name, label, phone_number"):
            aid = str(row.get("id") or "").strip()
            if aid:
                acc_names[aid] = str(row.get("display_name") or row.get("label") or row.get("phone_number") or "").strip() or aid

        conv_meta: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for row in _safe_fetch_lookup_rows(sb, "whatsapp_conversations", "account_id, chat_jid, chat_type, title, phone_number", limit=20000):
            aid = str(row.get("account_id") or "").strip()
            jid = str(row.get("chat_jid") or "").strip()
            if aid and jid:
                conv_meta[(aid, jid)] = row

        try:
            raw_msgs = _fetch_paginated(
                lambda: sb.table("whatsapp_messages")
                .select("account_id, chat_jid, is_outgoing, sent_at, sender_name, sender_phone, text, msg_type, is_deleted")
                .gte("sent_at", cutoff_iso)
                .order("sent_at", desc=False),
                max_rows=25000,
            )
        except Exception as exc:
            logger.warning(f"[SLA-Backfill] whatsapp_messages fetch error: {exc}")
            return []

        for m in raw_msgs:
            if m.get("is_deleted"):
                continue
            acc_id = str(m.get("account_id") or "").strip()
            conv_id = str(m.get("chat_jid") or "").strip()
            if not acc_id or not conv_id or conv_id == "status@broadcast":
                continue
            msg_type = str(m.get("msg_type") or "text").strip().lower()
            if msg_type in IGNORED_MSG_KINDS:
                continue
            dt = parse_iso_dt(m.get("sent_at"))
            if dt is None:
                continue
            c_info = conv_meta.get((acc_id, conv_id), {})
            c_type = str(c_info.get("chat_type") or ("group" if conv_id.endswith("@g.us") else "direct")).strip().lower()
            if c_type == "broadcast":
                continue
            thread_type = "group" if c_type == "group" else "direct"
            is_out = bool(m.get("is_outgoing"))
            customer_name = (
                str(c_info.get("title") or "").strip()
                or (str(m.get("sender_name") or "").strip() if not is_out else "")
                or None
            )
            customer_phone = (
                str(c_info.get("phone_number") or "").strip()
                or (str(m.get("sender_phone") or "").strip() if not is_out else "")
                or None
            )
            events.append({
                "account_id": acc_id,
                "account_name": acc_names.get(acc_id),
                "conversation_id": conv_id,
                "customer_name": customer_name,
                "customer_phone": customer_phone,
                "thread_type": thread_type,
                "is_outgoing": is_out,
                "dt": dt,
                "content": m.get("text"),
            })

    return events


def _insert_backfill_batch(sb: Client, rows: List[Dict[str, Any]]) -> int:
    """Insert reconstructed turns in chunks, gracefully falling back to per-row insert on conflict."""
    if not rows:
        return 0
    created = 0
    chunk_size = 200
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i : i + chunk_size]
        try:
            res = execute_supabase_query(
                lambda c=chunk: sb.table("inbox_sla_turns").insert(c).execute()
            )
            created += len(res.data or chunk)
        except Exception as exc:
            if _is_unique_violation_error(exc):
                for single in chunk:
                    try:
                        s_res = execute_supabase_query(
                            lambda r=single: sb.table("inbox_sla_turns").insert(r).execute()
                        )
                        created += len(s_res.data or [single])
                    except Exception as s_exc:
                        if _is_unique_violation_error(s_exc):
                            continue
                        logger.debug(f"[SLA-Backfill] Skipping row on insert error: {s_exc}")
            else:
                logger.warning(f"[SLA-Backfill] Batch insert error: {exc}")
                raise
    return created


def backfill_sla_history(
    days: int = 7,
    channels: Optional[List[str]] = None,
    supabase: Optional[Client] = None,
) -> Dict[str, Any]:
    """Reconstruct missing historical SLA turns across Zalo, Messenger, Telegram, WhatsApp (idempotent)."""
    safe_days = max(1, min(90, int(days or 7)))
    if channels:
        target_channels = [
            str(c).strip().lower()
            for c in channels
            if str(c).strip().lower() in BACKFILL_CHANNELS
        ]
        target_channels = list(dict.fromkeys(target_channels)) or list(BACKFILL_CHANNELS)
    else:
        target_channels = list(BACKFILL_CHANNELS)

    sb = supabase or get_supabase_client()
    cfg_map = _load_sla_configs_map(supabase=sb, force_refresh=True)

    cutoff_dt = _now_utc() - timedelta(days=safe_days)
    cutoff_iso = cutoff_dt.isoformat()
    dedup_cutoff_iso = (cutoff_dt - timedelta(days=1)).isoformat()

    existing_keys, active_waiting, convs_with_history = _load_existing_turn_keys(
        sb, target_channels, dedup_cutoff_iso
    )

    total_processed = 0
    total_created = 0
    by_channel_summary: Dict[str, Dict[str, int]] = {}
    now_iso = _now_iso()

    for ch in target_channels:
        events = _load_channel_messages_for_backfill(sb, ch, cutoff_iso)
        processed_ch = len(events)
        total_processed += processed_ch

        # Group by (account_id, conversation_id) and sort chronologically
        grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
        for ev in events:
            grouped[(ev["account_id"], ev["conversation_id"])].append(ev)

        rows_to_insert: List[Dict[str, Any]] = []

        for (acc_id, conv_id), msg_list in grouped.items():
            msg_list.sort(key=lambda item: item["dt"])
            cfg = _resolve_from_map(cfg_map, ch, acc_id)
            include_groups = bool(cfg.get("include_group_chats", False))
            target_seconds = max(60, int(cfg.get("target_minutes") or 5) * 60)

            conv_tuple = (ch, acc_id, conv_id)
            seen_turn_for_conv = conv_tuple in convs_with_history
            open_turn: Optional[Dict[str, Any]] = None

            for ev in msg_list:
                if ev["thread_type"] == "group" and not include_groups:
                    continue

                if not ev["is_outgoing"]:
                    preview = _truncate_preview(ev.get("content"))
                    if open_turn is None:
                        deadline_dt = add_business_seconds(ev["dt"], target_seconds, cfg)
                        open_turn = {
                            "channel": ch,
                            "account_id": acc_id,
                            "account_name": ev.get("account_name"),
                            "conversation_id": conv_id,
                            "customer_name": ev.get("customer_name"),
                            "customer_phone": ev.get("customer_phone"),
                            "thread_type": ev["thread_type"],
                            "customer_dt": ev["dt"],
                            "last_customer_dt": ev["dt"],
                            "unanswered_msg_count": 1,
                            "first_msg_preview": preview,
                            "last_msg_preview": preview,
                            "deadline_dt": deadline_dt,
                            "target_seconds": target_seconds,
                            "is_first_turn": not seen_turn_for_conv,
                        }
                        seen_turn_for_conv = True
                    else:
                        open_turn["last_customer_dt"] = max(open_turn["last_customer_dt"], ev["dt"])
                        open_turn["unanswered_msg_count"] += 1
                        if preview:
                            open_turn["last_msg_preview"] = preview
                            if not open_turn["first_msg_preview"]:
                                open_turn["first_msg_preview"] = preview
                        if ev.get("customer_name") and not open_turn.get("customer_name"):
                            open_turn["customer_name"] = ev["customer_name"]
                        if ev.get("customer_phone") and not open_turn.get("customer_phone"):
                            open_turn["customer_phone"] = ev["customer_phone"]
                else:
                    # Outgoing staff reply closes the currently open inbound turn
                    if open_turn is not None:
                        cust_dt: datetime = open_turn["customer_dt"]
                        reply_dt: datetime = ev["dt"]
                        d_key = _dedup_key(ch, acc_id, conv_id, cust_dt)
                        if d_key not in existing_keys:
                            raw_secs = max(0, int((reply_dt - cust_dt).total_seconds()))
                            biz_secs = calculate_business_seconds(cust_dt, reply_dt, cfg)
                            turn_status = "met" if biz_secs <= target_seconds else "breached"
                            rows_to_insert.append({
                                "channel": ch,
                                "account_id": acc_id,
                                "account_name": open_turn.get("account_name"),
                                "conversation_id": conv_id,
                                "customer_name": open_turn.get("customer_name"),
                                "customer_phone": open_turn.get("customer_phone"),
                                "thread_type": open_turn["thread_type"],
                                "customer_msg_at": cust_dt.isoformat(),
                                "last_customer_msg_at": open_turn["last_customer_dt"].isoformat(),
                                "unanswered_msg_count": open_turn["unanswered_msg_count"],
                                "first_msg_preview": open_turn.get("first_msg_preview"),
                                "last_msg_preview": open_turn.get("last_msg_preview"),
                                "staff_reply_at": reply_dt.isoformat(),
                                "deadline_at": open_turn["deadline_dt"].isoformat(),
                                "raw_response_seconds": raw_secs,
                                "business_response_seconds": biz_secs,
                                "target_seconds": target_seconds,
                                "is_first_turn": bool(open_turn["is_first_turn"]),
                                "status": turn_status,
                                "created_at": cust_dt.isoformat(),
                                "updated_at": now_iso,
                            })
                            existing_keys.add(d_key)
                        open_turn = None

            # Trailing unanswered inbound turn -> insert as 'waiting' only if no active waiting turn exists
            if open_turn is not None:
                cust_dt = open_turn["customer_dt"]
                d_key = _dedup_key(ch, acc_id, conv_id, cust_dt)
                if d_key not in existing_keys and conv_tuple not in active_waiting:
                    rows_to_insert.append({
                        "channel": ch,
                        "account_id": acc_id,
                        "account_name": open_turn.get("account_name"),
                        "conversation_id": conv_id,
                        "customer_name": open_turn.get("customer_name"),
                        "customer_phone": open_turn.get("customer_phone"),
                        "thread_type": open_turn["thread_type"],
                        "customer_msg_at": cust_dt.isoformat(),
                        "last_customer_msg_at": open_turn["last_customer_dt"].isoformat(),
                        "unanswered_msg_count": open_turn["unanswered_msg_count"],
                        "first_msg_preview": open_turn.get("first_msg_preview"),
                        "last_msg_preview": open_turn.get("last_msg_preview"),
                        "deadline_at": open_turn["deadline_dt"].isoformat(),
                        "target_seconds": target_seconds,
                        "is_first_turn": bool(open_turn["is_first_turn"]),
                        "status": "waiting",
                        "created_at": cust_dt.isoformat(),
                        "updated_at": now_iso,
                    })
                    existing_keys.add(d_key)
                    active_waiting.add(conv_tuple)

        try:
            created_ch = _insert_backfill_batch(sb, rows_to_insert)
        except Exception as exc:
            if _is_missing_table_error(exc):
                raise RuntimeError("Bảng inbox_sla_turns chưa được migrate (Migration 243).") from exc
            raise

        total_created += created_ch
        by_channel_summary[ch] = {
            "processed_messages": processed_ch,
            "turns_created": created_ch,
        }

    return {
        "processed_messages": total_processed,
        "turns_created": total_created,
        "by_channel": by_channel_summary,
    }
