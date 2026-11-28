"""Zalo Group Alert Forward Service — CRUD, Group Lookup, Anti-Loop Routing & Dispatch.

Coordinates:
- CRUD on ``public.inbox_alert_forward_configs`` (with 15s in-memory active cache).
- Log queries on ``public.inbox_alert_forward_logs``.
- Zalo group discovery from ``public.zalo_groups`` (``thread_type='group'``).
- Routing inbound messages & SLA warning/breach events to the Node.js Persistent
  Alert Forward Engine via ``js_alert_engine_bridge``.
- Immediate test-ping delivery with DB audit logging.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from loguru import logger

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.sla_alerts.business_hours import parse_iso_dt
from app.modules.all_platform.sla_alerts.js_alert_engine_bridge import (
    enqueue_alert,
    send_immediate,
)
from app.modules.all_platform.sla_alerts.schemas import (
    AlertForwardConfigCreate,
    AlertForwardConfigUpdate,
)
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth

VN_TZ = timezone(timedelta(hours=7))

_ACTIVE_CONFIGS_TTL_S = 15.0
_active_configs_cache: Optional[List[Dict[str, Any]]] = None
_active_configs_cached_at: float = 0.0

_IGNORED_MSG_KINDS = frozenset({"system_notice", "system", "call_log", "revoked", "undo"})
_ANTI_LOOP_MARKERS = (
    "[TIN MỚI -",
    "[QUÁ HẠN SLA",
    "[SẮP QUÁ HẠN SLA",
    "[TEST THÔNG BÁO SLA",
)


def _is_missing_table_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "42p01" in msg
        or "pgrst205" in msg
        or "does not exist" in msg
        or "could not find the table" in msg
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def invalidate_forward_config_cache() -> None:
    global _active_configs_cache, _active_configs_cached_at
    _active_configs_cache = None
    _active_configs_cached_at = 0.0


def build_open_url(
    channel: str,
    account_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    *,
    absolute: bool = True,
) -> str:
    ch = str(channel or "zalo").strip().lower()
    acc = quote(str(account_id or "").strip(), safe="")
    conv = quote(str(conversation_id or "").strip(), safe="")
    if ch == "zalo":
        path = f"/all-platform/zalo-inbox?account={acc}&conversation={conv}" if (acc or conv) else "/all-platform/zalo-inbox"
    elif ch == "messenger":
        path = f"/all-platform/messenger-inbox?account={acc}&thread={conv}" if (acc or conv) else "/all-platform/messenger-inbox"
    elif ch == "telegram":
        path = f"/all-platform/telegram-chat?account={acc}&dialog={conv}" if (acc or conv) else "/all-platform/telegram-chat"
    elif ch == "whatsapp":
        path = f"/all-platform/whatsapp-chat?account={acc}&chat={conv}" if (acc or conv) else "/all-platform/whatsapp-chat"
    else:
        path = "/all-platform/omnichannel-inbox"

    if not absolute:
        return path
    base = str(getattr(settings, "crm_public_url", "") or "").strip().rstrip("/")
    return f"{base}{path}" if base else path


def is_anti_loop_blocked(
    config: Dict[str, Any],
    *,
    channel: str,
    conversation_id: Optional[str],
    content: Optional[str] = None,
    alert_type: str = "new_message",
) -> bool:
    """Return True if forwarding this message would create an infinite Zalo alert loop."""
    if str(alert_type or "").strip().lower() == "test":
        return False
    ch = str(channel or "").strip().lower()
    if ch != "zalo":
        return False
    target_gid = str(config.get("target_zalo_group_id") or "").strip()
    conv_id = str(conversation_id or "").strip()
    if target_gid and conv_id and conv_id == target_gid:
        return True
    text = str(content or "")
    return any(marker in text for marker in _ANTI_LOOP_MARKERS)


def config_matches_event(
    config: Dict[str, Any],
    *,
    alert_type: str,
    channel: str,
    account_id: str,
    conversation_id: str,
    thread_type: str = "direct",
    content: Optional[str] = None,
) -> Tuple[bool, Optional[str]]:
    """Evaluate whether a forward config should receive this event.

    Returns ``(matched, skip_reason)``.
    """
    if not config.get("is_enabled", True):
        return False, "disabled"

    ch = str(channel or "").strip().lower()
    cfg_channels = [str(c).strip().lower() for c in (config.get("channels") or []) if c]
    if cfg_channels and ch not in cfg_channels:
        return False, "channel_mismatch"

    src_accounts = [str(a).strip() for a in (config.get("source_account_ids") or []) if str(a or "").strip()]
    if src_accounts and str(account_id or "").strip() not in src_accounts:
        return False, "account_mismatch"

    if str(thread_type or "direct").strip().lower() == "group" and not config.get("include_group_chats", False):
        return False, "group_chat_excluded"

    excluded = [str(c).strip() for c in (config.get("excluded_conversation_ids") or []) if str(c or "").strip()]
    if str(conversation_id or "").strip() in excluded:
        return False, "excluded_conversation"

    atype = str(alert_type or "new_message").strip().lower()
    if atype == "new_message" and not config.get("notify_new_message", True):
        return False, "new_message_disabled"
    if atype == "sla_warning" and not config.get("notify_sla_warning", False):
        return False, "sla_warning_disabled"
    if atype == "sla_breach" and not config.get("notify_sla_breach", True):
        return False, "sla_breach_disabled"

    if is_anti_loop_blocked(
        config,
        channel=ch,
        conversation_id=conversation_id,
        content=content,
        alert_type=atype,
    ):
        return False, "anti_loop_guard"

    return True, None


def _resolve_user_id_by_email(email: Optional[str]) -> Optional[str]:
    clean = str(email or "").strip().lower()
    if not clean:
        return None
    try:
        sb = get_supabase_client()
        res = sb.table("app_users").select("id").eq("email", clean).limit(1).execute()
        if res.data:
            return str(res.data[0]["id"])
    except Exception:
        pass
    return None


def _lookup_zalo_account_name(account_id: str) -> Optional[str]:
    aid = str(account_id or "").strip()
    if not aid:
        return None
    try:
        sb = get_supabase_client()
        res = (
            sb.table("zalo_accounts")
            .select("label, phone, owner_name")
            .eq("account_id", aid)
            .limit(1)
            .execute()
        )
        if res.data:
            row = res.data[0]
            return row.get("label") or row.get("phone") or row.get("owner_name")
    except Exception:
        pass
    return None


def _lookup_zalo_group_name(account_id: str, group_id: str) -> Optional[str]:
    aid = str(account_id or "").strip()
    gid = str(group_id or "").strip()
    if not aid or not gid:
        return None
    try:
        sb = get_supabase_client()
        res = (
            sb.table("zalo_groups")
            .select("group_name")
            .eq("user_id", aid)
            .eq("group_id", gid)
            .limit(1)
            .execute()
        )
        if res.data and res.data[0].get("group_name"):
            return str(res.data[0]["group_name"])
    except Exception:
        pass
    return None


# ── CRUD: inbox_alert_forward_configs ────────────────────────────────────────

def list_forward_configs() -> List[Dict[str, Any]]:
    try:
        sb = get_supabase_client()
        res = (
            sb.table("inbox_alert_forward_configs")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        return list(res.data or [])
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.debug(f"[sla-alerts] inbox_alert_forward_configs not migrated yet: {exc}")
            return []
        raise


def _list_active_configs_cached() -> List[Dict[str, Any]]:
    global _active_configs_cache, _active_configs_cached_at
    now = time.monotonic()
    if _active_configs_cache is not None and (now - _active_configs_cached_at) < _ACTIVE_CONFIGS_TTL_S:
        return _active_configs_cache
    try:
        sb = get_supabase_client()
        res = (
            sb.table("inbox_alert_forward_configs")
            .select("*")
            .eq("is_enabled", True)
            .order("created_at", desc=False)
            .execute()
        )
        rows = list(res.data or [])
        _active_configs_cache = rows
        _active_configs_cached_at = now
        return rows
    except Exception as exc:
        if _is_missing_table_error(exc):
            _active_configs_cache = []
            _active_configs_cached_at = now
            return []
        logger.warning(f"[sla-alerts] failed loading active forward configs: {exc}")
        return _active_configs_cache or []


def get_forward_config(config_id: str) -> Optional[Dict[str, Any]]:
    try:
        sb = get_supabase_client()
        res = (
            sb.table("inbox_alert_forward_configs")
            .select("*")
            .eq("id", str(config_id))
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as exc:
        if _is_missing_table_error(exc):
            return None
        raise


def create_forward_config(
    payload: AlertForwardConfigCreate,
    caller_email: Optional[str] = None,
) -> Dict[str, Any]:
    data = payload.model_dump()
    if not data.get("notifier_zalo_account_name"):
        data["notifier_zalo_account_name"] = _lookup_zalo_account_name(
            data["notifier_zalo_account_id"]
        )
    if not data.get("target_zalo_group_name"):
        data["target_zalo_group_name"] = _lookup_zalo_group_name(
            data["notifier_zalo_account_id"],
            data["target_zalo_group_id"],
        )
    created_by = _resolve_user_id_by_email(caller_email)
    if created_by:
        data["created_by"] = created_by
    now_iso = _now_iso()
    data["created_at"] = now_iso
    data["updated_at"] = now_iso

    sb = get_supabase_client()
    res = sb.table("inbox_alert_forward_configs").insert(data).execute()
    invalidate_forward_config_cache()
    if not res.data:
        raise RuntimeError("Không thể tạo cấu hình thông báo nhóm Zalo")
    return res.data[0]


def update_forward_config(
    config_id: str,
    payload: AlertForwardConfigUpdate,
) -> Optional[Dict[str, Any]]:
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        return get_forward_config(config_id)

    if patch.get("notifier_zalo_account_id") and not patch.get("notifier_zalo_account_name"):
        resolved_acc = _lookup_zalo_account_name(patch["notifier_zalo_account_id"])
        if resolved_acc:
            patch["notifier_zalo_account_name"] = resolved_acc

    if patch.get("target_zalo_group_id") and not patch.get("target_zalo_group_name"):
        acc_id = patch.get("notifier_zalo_account_id")
        if not acc_id:
            existing = get_forward_config(config_id)
            acc_id = (existing or {}).get("notifier_zalo_account_id")
        if acc_id:
            resolved_grp = _lookup_zalo_group_name(acc_id, patch["target_zalo_group_id"])
            if resolved_grp:
                patch["target_zalo_group_name"] = resolved_grp

    patch["updated_at"] = _now_iso()

    sb = get_supabase_client()
    res = (
        sb.table("inbox_alert_forward_configs")
        .update(patch)
        .eq("id", str(config_id))
        .execute()
    )
    invalidate_forward_config_cache()
    return res.data[0] if res.data else None


def delete_forward_config(config_id: str) -> bool:
    sb = get_supabase_client()
    res = (
        sb.table("inbox_alert_forward_configs")
        .delete()
        .eq("id", str(config_id))
        .execute()
    )
    invalidate_forward_config_cache()
    return bool(res.data)


# ── Logs & Zalo Group Discovery ──────────────────────────────────────────────

def list_alert_logs(
    *,
    config_id: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    capped = max(1, min(int(limit or 50), 500))
    try:
        sb = get_supabase_client()
        q = sb.table("inbox_alert_forward_logs").select("*")
        if config_id:
            q = q.eq("config_id", str(config_id).strip())
        res = q.order("created_at", desc=True).limit(capped).execute()
        return list(res.data or [])
    except Exception as exc:
        if _is_missing_table_error(exc):
            return []
        raise


def _insert_alert_log_sync(row: Dict[str, Any]) -> None:
    try:
        sb = get_supabase_client()
        sb.table("inbox_alert_forward_logs").insert(row).execute()
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning(f"[sla-alerts] failed inserting alert log: {exc}")


def list_available_zalo_groups_for_account(account_id: str) -> List[Dict[str, Any]]:
    """Read group conversations for a Zalo account from ``public.zalo_groups``."""
    aid = str(account_id or "").strip()
    if not aid:
        return []
    try:
        sb = get_supabase_client()
        res = (
            sb.table("zalo_groups")
            .select("group_id, group_name, avatar_url, thread_type, is_friend, last_message_at")
            .eq("user_id", aid)
            .eq("thread_type", "group")
            .order("last_message_at", desc=True)
            .limit(300)
            .execute()
        )
        rows = list(res.data or [])

        # Fallback for legacy rows where thread_type was not explicitly set
        if not rows:
            fb_res = (
                sb.table("zalo_groups")
                .select("group_id, group_name, avatar_url, thread_type, is_friend, last_message_at")
                .eq("user_id", aid)
                .eq("is_friend", False)
                .order("last_message_at", desc=True)
                .limit(300)
                .execute()
            )
            rows = [
                r
                for r in (fb_res.data or [])
                if str(r.get("thread_type") or "").strip().lower() not in ("direct", "user")
            ]

        groups: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            gid = str(row.get("group_id") or "").strip()
            if not gid or gid in seen:
                continue
            seen.add(gid)
            name = str(row.get("group_name") or "").strip() or gid
            groups.append(
                {
                    "group_id": gid,
                    "name": name,
                    "avatar_url": row.get("avatar_url"),
                }
            )
        return groups
    except Exception as exc:
        if _is_missing_table_error(exc):
            return []
        logger.warning(f"[sla-alerts] failed listing zalo_groups for {aid}: {exc}")
        return []


# ── Event Dispatching (Inbound, SLA Warning/Breach, Test Ping) ───────────────

async def dispatch_inbound_alert(
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
    received_at: Optional[Any] = None,
    turn: Optional[Dict[str, Any]] = None,
    opened_new_turn: bool = False,
    image_urls: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Route a customer inbound message to all matching active Zalo group alert configs."""
    kind = str(msg_kind or "text").strip().lower()
    if kind in _IGNORED_MSG_KINDS:
        return []

    ch = str(channel or "zalo").strip().lower()
    acc_id = str(account_id or "").strip()
    conv_id = str(conversation_id or "").strip()
    if not acc_id or not conv_id:
        return []

    configs = await asyncio.to_thread(_list_active_configs_cached)
    if not configs:
        return []

    parsed_received = parse_iso_dt(received_at)
    received_iso = parsed_received.isoformat() if parsed_received is not None else _now_iso()
    target_secs = int((turn or {}).get("target_seconds") or 300)
    sla_minutes = max(1, round(target_secs / 60))
    open_url = build_open_url(ch, acc_id, conv_id, absolute=True)

    results: List[Dict[str, Any]] = []
    for cfg in configs:
        matched, skip_reason = config_matches_event(
            cfg,
            alert_type="new_message",
            channel=ch,
            account_id=acc_id,
            conversation_id=conv_id,
            thread_type=thread_type,
            content=content,
        )
        if not matched:
            if skip_reason == "anti_loop_guard":
                logger.debug(
                    f"[sla-alerts] anti_loop_guard skipped config={cfg.get('id')} channel={ch} conv={conv_id}"
                )
            continue

        notifier_acc = str(cfg.get("notifier_zalo_account_id") or "").strip()
        auth = None if cfg.get("dry_run") else await load_zca_auth(notifier_acc)

        event = {
            "alert_type": "new_message",
            "channel": ch,
            "account_id": acc_id,
            "account_name": account_name or (turn or {}).get("account_name") or acc_id,
            "conversation_id": conv_id,
            "customer_name": customer_name or (turn or {}).get("customer_name") or "Khách hàng",
            "customer_phone": customer_phone or (turn or {}).get("customer_phone") or "",
            "thread_type": thread_type,
            "content": content or "",
            "msg_kind": kind,
            "received_at": received_iso,
            "sla_turn_id": (turn or {}).get("id"),
            "deadline_at": (turn or {}).get("deadline_at"),
            "target_seconds": target_secs,
            "sla_minutes": sla_minutes,
            "force_new_turn": bool(opened_new_turn),
            "image_urls": list(image_urls or []) if cfg.get("forward_images") else [],
            "open_url": open_url,
        }
        try:
            res = await enqueue_alert(cfg, event, auth=auth)
            results.append({"config_id": cfg.get("id"), **res})
        except Exception as exc:
            logger.warning(f"[sla-alerts] dispatch_inbound_alert failed config={cfg.get('id')}: {exc}")
            results.append({"config_id": cfg.get("id"), "ok": False, "error": str(exc)})

    return results


async def dispatch_sla_alert(
    alert_type: str,
    turn: Dict[str, Any],
    *,
    wait_business_seconds: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Dispatch an immediate ``sla_warning`` or ``sla_breach`` alert for a waiting SLA turn."""
    atype = str(alert_type or "").strip().lower()
    if atype not in ("sla_warning", "sla_breach"):
        return []

    ch = str(turn.get("channel") or "zalo").strip().lower()
    acc_id = str(turn.get("account_id") or "").strip()
    conv_id = str(turn.get("conversation_id") or "").strip()
    thread_type = str(turn.get("thread_type") or "direct").strip().lower()
    content = turn.get("last_msg_preview") or turn.get("first_msg_preview") or ""

    configs = await asyncio.to_thread(_list_active_configs_cached)
    if not configs:
        return []

    target_secs = int(turn.get("target_seconds") or 300)
    sla_minutes = max(1, round(target_secs / 60))
    wait_secs = (
        int(wait_business_seconds)
        if wait_business_seconds is not None
        else int(turn.get("current_wait_business_seconds") or target_secs)
    )
    open_url = build_open_url(ch, acc_id, conv_id, absolute=True)

    results: List[Dict[str, Any]] = []
    for cfg in configs:
        matched, _ = config_matches_event(
            cfg,
            alert_type=atype,
            channel=ch,
            account_id=acc_id,
            conversation_id=conv_id,
            thread_type=thread_type,
            content=content,
        )
        if not matched:
            continue

        notifier_acc = str(cfg.get("notifier_zalo_account_id") or "").strip()
        auth = None if cfg.get("dry_run") else await load_zca_auth(notifier_acc)

        event = {
            "alert_type": atype,
            "channel": ch,
            "account_id": acc_id,
            "account_name": turn.get("account_name") or acc_id,
            "conversation_id": conv_id,
            "customer_name": turn.get("customer_name") or "Khách hàng",
            "customer_phone": turn.get("customer_phone") or "",
            "thread_type": thread_type,
            "content": content,
            "received_at": turn.get("customer_msg_at") or _now_iso(),
            "sla_turn_id": turn.get("id"),
            "deadline_at": turn.get("deadline_at"),
            "target_seconds": target_secs,
            "sla_minutes": sla_minutes,
            "wait_business_seconds": wait_secs,
            "staff_name": turn.get("responded_by_name") or turn.get("assigned_user_name") or "Chưa phân công",
            "open_url": open_url,
        }
        try:
            res = await enqueue_alert(cfg, event, auth=auth)
            results.append({"config_id": cfg.get("id"), **res})
        except Exception as exc:
            logger.warning(f"[sla-alerts] dispatch_sla_alert ({atype}) failed config={cfg.get('id')}: {exc}")
            results.append({"config_id": cfg.get("id"), "ok": False, "error": str(exc)})

    return results


async def send_test_alert(
    config_id: str,
    caller_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an immediate test message to verify a forward config & log the attempt."""
    cfg = await asyncio.to_thread(get_forward_config, config_id)
    if not cfg:
        raise ValueError("Không tìm thấy cấu hình thông báo nhóm Zalo")

    notifier_acc = str(cfg.get("notifier_zalo_account_id") or "").strip()
    auth = None if cfg.get("dry_run") else await load_zca_auth(notifier_acc)
    primary_channel = (cfg.get("channels") or ["zalo"])[0]
    base_url = str(getattr(settings, "crm_public_url", "") or "").strip().rstrip("/")
    monitor_url = f"{base_url}/all-platform/sla-monitor" if base_url else "/all-platform/sla-monitor"

    event = {
        "alert_type": "test",
        "channel": primary_channel,
        "account_id": notifier_acc,
        "account_name": cfg.get("notifier_zalo_account_name") or notifier_acc,
        "conversation_id": str(cfg.get("target_zalo_group_id") or ""),
        "customer_name": caller_email or "Quản trị viên",
        "customer_phone": "",
        "content": (
            f"Tin nhắn kiểm tra kết nối từ {caller_email or 'Admin'} — "
            f"Cấu hình \"{cfg.get('name') or 'SLA Alert'}\" hoạt động ổn định."
        ),
        "received_at": _now_iso(),
        "sla_minutes": 5,
        "open_url": monitor_url,
    }

    result = await send_immediate(cfg, event, auth=auth)
    status = str(result.get("status") or ("dry_run" if result.get("dry_run") else ("sent" if result.get("sent") else "failed")))
    if status not in ("sent", "dry_run", "failed", "skipped", "rate_limited"):
        status = "sent" if result.get("sent") else "failed"

    log_row = {
        "config_id": cfg.get("id"),
        "alert_type": "test",
        "channel": str(primary_channel),
        "source_account_id": notifier_acc,
        "source_conversation_id": str(cfg.get("target_zalo_group_id") or ""),
        "sla_turn_id": None,
        "target_zalo_group_id": str(cfg.get("target_zalo_group_id") or ""),
        "rendered_text": result.get("rendered_text"),
        "status": status,
        "via": str(result.get("via") or "js_engine"),
        "latency_ms": int(result["latency_ms"]) if result.get("latency_ms") is not None else None,
        "error": str(result["error"])[:1000] if result.get("error") else None,
    }
    await asyncio.to_thread(_insert_alert_log_sync, log_row)

    response_data: Dict[str, Any] = {
        "sent": bool(result.get("sent")),
        "dry_run": bool(result.get("dry_run", cfg.get("dry_run", False))),
        "via": str(result.get("via") or "js_engine"),
        "latency_ms": result.get("latency_ms"),
        "rendered_text": result.get("rendered_text"),
    }
    if result.get("error"):
        response_data["error"] = str(result["error"])
    return response_data
