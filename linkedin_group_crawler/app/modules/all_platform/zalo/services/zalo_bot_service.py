"""Dịch vụ quản lý Bot Zalo: cấu hình, tiếp quản hội thoại, nhật ký, nhãn "Bot".

Dùng chung cho:
  * `zalo_chatwoot_bridge.py` (vòng nền đẩy tin sang n8n, endpoint gửi tin ra),
  * `api/routes/zalo_bot_admin.py` (API cho giao diện),
  * `api/routes/conversations.py` (gắn nhãn Bot + tự tạm dừng khi nhân viên nhắn tay).

Tiếp quản: bảng `zalo_bot_threads` là nguồn sự thật phía Seeding (bot không đẩy/không gửi khi đang
tạm dừng). Nếu cấu hình ZALO_BOT_CHATWOOT_URL/TOKEN thì đồng bộ thêm cờ `bot_handed_off` sang
Chatwoot (best-effort) để bot n8n cũng im lặng và Chatwoot hiển thị đúng trạng thái.
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from loguru import logger

from app.modules.all_platform.zalo.services.supabase_service import _rest
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth

VN_TZ = timezone(timedelta(hours=7))

CONFIG_DEFAULTS: Dict[str, Any] = {
    "is_enabled": False,
    "dry_run": True,
    "chatwoot_account_id": None,
    "chatwoot_inbox_id": None,
    "auto_pause_on_staff_reply": True,
    "pause_minutes": 60,
    "chatwoot_sync": True,
    "scope_mode": "all",
    "batch_wait_seconds": 10,
}
MAX_BATCH_WAIT_S = 120
SCOPE_MODES = ("all", "selected")
MAX_RULE_BATCH = 500
CONFIG_FIELDS = tuple(CONFIG_DEFAULTS.keys())

LOG_STATUSES = ("forwarded", "sent", "dry_run", "skipped", "paused", "error")

_CW_CONV_CACHE: Dict[Tuple[str, str], Tuple[float, int]] = {}
_CW_STATE_CACHE: Dict[Tuple[str, str], Tuple[float, Optional[bool]]] = {}
_CW_CONV_TTL = 600.0
_CW_STATE_TTL = 20.0


# ─────────────────────────────────────────────────────────────────────────
# Tiện ích chung
# ─────────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_ts(value: Any) -> Optional[datetime]:
    """Parse chuỗi thời gian PostgREST (có thể 'Z' hoặc +00:00, phần giây lẻ bất kỳ)."""
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    m = re.match(r"^(.*?)(\.\d+)?([+-]\d{2}:\d{2})?$", text)
    if m:
        base, frac, tz = m.group(1), m.group(2) or "", m.group(3) or "+00:00"
        frac = (frac + "000000")[:7] if frac else ""
        text = f"{base}{frac}{tz}"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def runtime_flags() -> Dict[str, bool]:
    """Cờ cấu hình của server (không lộ giá trị bí mật)."""
    return {
        "n8n_incoming_configured": bool(_env("ZALO_BOT_N8N_INCOMING_URL")),
        "shared_secret_configured": bool(_env("ZALO_BOT_SHARED_SECRET")),
        "chatwoot_sync_configured": bool(_env("ZALO_BOT_CHATWOOT_URL") and _env("ZALO_BOT_CHATWOOT_TOKEN")),
        "bridge_enabled": _env("DISABLE_ZALO_CHATWOOT_BRIDGE").lower() not in {"1", "true", "yes"},
    }


def extract_zca_msg_id(result: Any) -> Optional[str]:
    """msgId thuần từ kết quả send-message của zca (cùng quy ước với conversations._build_outgoing_message_id)."""
    if not isinstance(result, dict):
        return None
    payload = result.get("response") or result.get("result") or result
    if not isinstance(payload, dict):
        return None
    msg_obj = payload.get("message")
    if isinstance(msg_obj, dict) and msg_obj.get("msgId") is not None:
        try:
            return str(int(msg_obj["msgId"]))
        except (TypeError, ValueError):
            return str(msg_obj["msgId"])
    attachments = payload.get("attachment")
    if isinstance(attachments, list) and attachments and isinstance(attachments[0], dict):
        if attachments[0].get("msgId") is not None:
            try:
                return str(int(attachments[0]["msgId"]))
            except (TypeError, ValueError):
                return str(attachments[0]["msgId"])
    return None


# ─────────────────────────────────────────────────────────────────────────
# Cấu hình bot
# ─────────────────────────────────────────────────────────────────────────

async def get_config_row(account_id: str) -> Optional[Dict[str, Any]]:
    rows = await _rest("GET", "zalo_bot_configs", params={"select": "*", "account_id": f"eq.{account_id}", "limit": "1"}) or []
    return rows[0] if rows else None


async def get_configs_brief(account_ids: List[str]) -> Dict[str, Dict[str, bool]]:
    ids = [a for a in dict.fromkeys(a.strip() for a in account_ids) if a][:100]
    if not ids:
        return {}
    quoted = ",".join('"' + a.replace('"', "") + '"' for a in ids)
    rows = await _rest(
        "GET", "zalo_bot_configs",
        params={"select": "account_id,is_enabled,dry_run", "account_id": f"in.({quoted})"},
    ) or []
    return {r["account_id"]: {"is_enabled": bool(r.get("is_enabled")), "dry_run": bool(r.get("dry_run", True))} for r in rows}


def normalize_config(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(CONFIG_DEFAULTS)
    for k in CONFIG_FIELDS:
        if row is not None and k in row and row[k] is not None:
            out[k] = row[k]
        elif row is not None and k in ("chatwoot_account_id", "chatwoot_inbox_id"):
            out[k] = row.get(k)
    return out


async def build_config_view(account_id: str) -> Dict[str, Any]:
    row = await get_config_row(account_id)
    cfg = normalize_config(row)
    flags = runtime_flags()
    try:
        zca_ok = bool(await load_zca_auth(account_id))
    except Exception:
        zca_ok = False
    complete = bool(cfg["chatwoot_account_id"] and cfg["chatwoot_inbox_id"])
    scope = await scope_summary(account_id, cfg["scope_mode"])
    return {
        "account_id": account_id,
        "exists": row is not None,
        **cfg,
        "scope": scope,
        "updated_at": (row or {}).get("updated_at"),
        "readiness": {"zca_logged_in": zca_ok, **flags, "config_complete": complete},
    }


def validate_config_patch(current: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Trả về cấu hình sau khi áp patch; ném ValueError(thông báo tiếng Việt) nếu không hợp lệ."""
    merged = dict(current)
    for key, value in patch.items():
        if key not in CONFIG_FIELDS:
            continue
        merged[key] = value
    for key in ("chatwoot_account_id", "chatwoot_inbox_id"):
        value = merged.get(key)
        if value is not None:
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError("Chatwoot account/inbox ID phải là số nguyên dương")
    wait = merged.get("batch_wait_seconds")
    if isinstance(wait, bool) or not isinstance(wait, int) or not (0 <= wait <= MAX_BATCH_WAIT_S):
        raise ValueError(f"Thời gian chờ gom tin phải từ 0 đến {MAX_BATCH_WAIT_S} giây (0 = tắt gom tin)")
    if merged.get("scope_mode") not in SCOPE_MODES:
        raise ValueError("Phạm vi bot phải là 'all' (tất cả) hoặc 'selected' (chỉ người đã chọn)")
    minutes = merged.get("pause_minutes")
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not (0 <= minutes <= 1440):
        raise ValueError("Số phút tạm dừng phải từ 0 đến 1440")
    if merged.get("is_enabled") and not (merged.get("chatwoot_account_id") and merged.get("chatwoot_inbox_id")):
        raise ValueError("Cần nhập Chatwoot account ID và inbox ID trước khi bật bot")
    return merged


async def reset_cursor_to_now(account_id: str) -> None:
    """Bắt đầu đọc tin từ BÂY GIỜ: bật bot lại sau thời gian tắt không được trả lời tin cũ."""
    await _rest(
        "POST", "zalo_bot_cursor",
        json=[{"account_id": account_id, "last_message_ts": int(time.time() * 1000), "updated_at": _iso(_now())}],
        params={"on_conflict": "account_id"}, prefer="resolution=merge-duplicates",
    )


async def upsert_config(account_id: str, patch: Dict[str, Any], updated_by: Optional[str]) -> Dict[str, Any]:
    row = await get_config_row(account_id)
    current = normalize_config(row)
    merged = validate_config_patch(current, patch)
    was_enabled = bool(current["is_enabled"]) and row is not None
    body = {k: merged[k] for k in CONFIG_FIELDS}
    body.update({"account_id": account_id, "updated_at": _iso(_now()), "updated_by": updated_by})
    try:
        await _rest(
            "POST", "zalo_bot_configs", json=[body],
            params={"on_conflict": "account_id"}, prefer="resolution=merge-duplicates",
        )
    except RuntimeError as exc:
        _raise_if_scope_table_missing(exc)
        raise
    if merged["is_enabled"] and not was_enabled:
        await reset_cursor_to_now(account_id)
    return await build_config_view(account_id)


# ─────────────────────────────────────────────────────────────────────────
# Loại hội thoại
# ─────────────────────────────────────────────────────────────────────────

async def direct_thread_ids(account_id: str, thread_ids: List[str]) -> set:
    """Chỉ chat 1-1: thread_type='user' hoặc is_friend=true."""
    ids = [t for t in thread_ids if t]
    if not ids:
        return set()
    rows = await _rest(
        "GET", "zalo_groups",
        params={
            "select": "group_id,thread_type,is_friend", "user_id": f"eq.{account_id}",
            "group_id": f"in.({','.join(ids)})",
        },
    ) or []
    return {
        r["group_id"] for r in rows
        if str(r.get("thread_type") or "").lower() == "user" or r.get("is_friend") is True
    }


# ─────────────────────────────────────────────────────────────────────────
# Phạm vi bật bot theo từng người
# ─────────────────────────────────────────────────────────────────────────

def in_scope(scope_mode: str, rule: Optional[bool]) -> bool:
    """Bot có được phép trả lời hội thoại này không.

    'all'      : trả lời tất cả, trừ hội thoại bị tắt (rule is False).
    'selected' : chỉ trả lời hội thoại được bật tay (rule is True).
    """
    if scope_mode == "selected":
        return rule is True
    return rule is not False


SCOPE_MIGRATION_HINT = (
    "Cơ sở dữ liệu chưa có bảng/cột phạm vi bot (migration 219_zalo_bot_scope.sql). "
    "Chạy `python supabase/setup_test_db.py` trong thư mục linkedin_group_crawler rồi thử lại."
)


BATCH_MIGRATION_HINT = (
    "Cơ sở dữ liệu chưa có cột gom tin (migration 220_zalo_bot_batch_wait.sql). "
    "Chạy `python supabase/setup_test_db.py` trong thư mục linkedin_group_crawler rồi thử lại."
)


def _raise_if_scope_table_missing(exc: Exception) -> None:
    text = str(exc)
    if "zalo_bot_thread_rules" in text or "scope_mode" in text:
        raise ValueError(SCOPE_MIGRATION_HINT) from exc
    if "batch_wait_seconds" in text:
        raise ValueError(BATCH_MIGRATION_HINT) from exc


async def get_rules(account_id: str) -> Dict[str, bool]:
    """thread_id -> bot_on. Lỗi (vd. chưa chạy migration 219) -> {} để bot không sập."""
    try:
        rows = await _rest(
            "GET", "zalo_bot_thread_rules",
            params={"select": "thread_id,bot_on", "account_id": f"eq.{account_id}", "limit": "10000"},
        ) or []
    except Exception:
        logger.exception("[zalo-bot] đọc zalo_bot_thread_rules lỗi (đã chạy migration 219 chưa?)")
        return {}
    return {r["thread_id"]: bool(r["bot_on"]) for r in rows}


async def get_rule(account_id: str, thread_id: str) -> Optional[bool]:
    try:
        rows = await _rest(
            "GET", "zalo_bot_thread_rules",
            params={"select": "bot_on", "account_id": f"eq.{account_id}", "thread_id": f"eq.{thread_id}", "limit": "1"},
        ) or []
    except Exception:
        logger.exception("[zalo-bot] đọc rule hội thoại lỗi")
        return None
    return bool(rows[0]["bot_on"]) if rows else None


async def set_rules(account_id: str, thread_ids: List[str], bot_on: Optional[bool], by: Optional[str]) -> int:
    """Đặt bot bật (True) / tắt (False) / về mặc định (None = xoá rule) cho nhiều hội thoại. Trả về số hội thoại đã xử lý."""
    ids = [t.strip() for t in dict.fromkeys(thread_ids or []) if t and t.strip()]
    if not ids:
        return 0
    if len(ids) > MAX_RULE_BATCH:
        raise ValueError(f"Mỗi lần chỉ áp dụng tối đa {MAX_RULE_BATCH} hội thoại")
    if bot_on is None:
        quoted = ",".join('"' + t.replace('"', "") + '"' for t in ids)
        await _rest(
            "DELETE", "zalo_bot_thread_rules",
            params={"account_id": f"eq.{account_id}", "thread_id": f"in.({quoted})"},
        )
        return len(ids)
    now = _iso(_now())
    try:
        await _rest(
            "POST", "zalo_bot_thread_rules",
            json=[{"account_id": account_id, "thread_id": t, "bot_on": bool(bot_on), "updated_by": by, "updated_at": now} for t in ids],
            params={"on_conflict": "account_id,thread_id"}, prefer="resolution=merge-duplicates",
        )
    except RuntimeError as exc:
        _raise_if_scope_table_missing(exc)
        raise
    return len(ids)


async def clear_all_rules(account_id: str) -> None:
    await _rest("DELETE", "zalo_bot_thread_rules", params={"account_id": f"eq.{account_id}"})


async def scope_summary(account_id: str, scope_mode: str) -> Dict[str, Any]:
    rules = await get_rules(account_id)
    return {
        "scope_mode": scope_mode,
        "on_count": sum(1 for v in rules.values() if v),
        "off_count": sum(1 for v in rules.values() if not v),
    }


async def list_scope_candidates(account_id: str, q: Optional[str], limit: int = 50) -> List[Dict[str, Any]]:
    """Danh sách hội thoại 1-1 (kèm trạng thái rule) để chọn người bật/tắt bot. Tìm theo tên."""
    params: Dict[str, Any] = {
        "select": "group_id,group_name,avatar_url,thread_type,is_friend",
        "user_id": f"eq.{account_id}",
        "or": "(thread_type.eq.user,is_friend.eq.true)",
        "order": "group_name.asc",
        "limit": str(max(1, min(limit, 200))),
    }
    term = _clean_search(q or "")
    if term:
        params["group_name"] = f"ilike.*{term}*"
    rows = await _rest("GET", "zalo_groups", params=params) or []
    rules = await get_rules(account_id)
    return [
        {
            "thread_id": r["group_id"],
            "name": r.get("group_name") or r["group_id"],
            "avatar_url": r.get("avatar_url") or None,
            "rule": rules.get(r["group_id"]),
        }
        for r in rows
        if r.get("group_id")
    ]


# ─────────────────────────────────────────────────────────────────────────
# Chatwoot (best-effort)
# ─────────────────────────────────────────────────────────────────────────

def chatwoot_ready(cfg: Optional[Dict[str, Any]]) -> bool:
    return bool(
        cfg and cfg.get("chatwoot_sync", True) and cfg.get("chatwoot_account_id") and cfg.get("chatwoot_inbox_id")
        and _env("ZALO_BOT_CHATWOOT_URL") and _env("ZALO_BOT_CHATWOOT_TOKEN")
    )


async def _cw(method: str, path: str, *, json: Any = None) -> Any:
    base = _env("ZALO_BOT_CHATWOOT_URL").rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.request(
            method, f"{base}/api/v1/{path.lstrip('/')}",
            headers={"api_access_token": _env("ZALO_BOT_CHATWOOT_TOKEN")}, json=json,
        )
    resp.raise_for_status()
    return resp.json() if resp.content else {}


async def _cw_find_conversation_id(cfg: Dict[str, Any], thread_id: str) -> Optional[int]:
    key = (cfg["account_id"], thread_id)
    cached = _CW_CONV_CACHE.get(key)
    if cached and time.time() - cached[0] < _CW_CONV_TTL:
        return cached[1]
    acc = cfg["chatwoot_account_id"]
    ident = f"seeding_zalo_{cfg['account_id']}_{thread_id}"
    found = await _cw("GET", f"accounts/{acc}/contacts/search?q={ident}&include_contacts=true")
    contact = next((c for c in (found.get("payload") or []) if c.get("identifier") == ident), None)
    if not contact:
        return None
    convs = await _cw("GET", f"accounts/{acc}/contacts/{contact['id']}/conversations")
    mine = [c for c in (convs.get("payload") or []) if str(c.get("inbox_id")) == str(cfg["chatwoot_inbox_id"])]
    if not mine:
        return None
    live = [c for c in mine if c.get("status") in ("open", "pending")] or mine
    conv_id = int(max(live, key=lambda c: int(c.get("id") or 0))["id"])
    _CW_CONV_CACHE[key] = (time.time(), conv_id)
    return conv_id


async def chatwoot_handed_off(cfg: Dict[str, Any], thread_id: str) -> Optional[bool]:
    """Cờ bot_handed_off của hội thoại bên Chatwoot (None nếu không đọc được)."""
    if not chatwoot_ready(cfg):
        return None
    key = (cfg["account_id"], thread_id)
    cached = _CW_STATE_CACHE.get(key)
    if cached and time.time() - cached[0] < _CW_STATE_TTL:
        return cached[1]
    value: Optional[bool] = None
    try:
        conv_id = await _cw_find_conversation_id(cfg, thread_id)
        if conv_id:
            conv = await _cw("GET", f"accounts/{cfg['chatwoot_account_id']}/conversations/{conv_id}")
            value = (conv.get("custom_attributes") or {}).get("bot_handed_off") is True
    except Exception as exc:
        logger.warning(f"[zalo-bot] đọc trạng thái Chatwoot lỗi thread={thread_id}: {exc}")
    _CW_STATE_CACHE[key] = (time.time(), value)
    return value


async def chatwoot_set_handoff(cfg: Dict[str, Any], thread_id: str, handed_off: bool) -> bool:
    """Đặt/xoá cờ bot_handed_off bên Chatwoot. True = đã đồng bộ."""
    if not chatwoot_ready(cfg):
        return False
    try:
        conv_id = await _cw_find_conversation_id(cfg, thread_id)
        if not conv_id:
            return False
        attrs = {
            "bot_handed_off": handed_off,
            "bot_handed_off_at": _iso(_now()) if handed_off else None,
            "bot_resume_requested": False,
        }
        await _cw("POST", f"accounts/{cfg['chatwoot_account_id']}/conversations/{conv_id}/custom_attributes",
                  json={"custom_attributes": attrs})
        _CW_STATE_CACHE[(cfg["account_id"], thread_id)] = (time.time(), handed_off)
        return True
    except Exception as exc:
        logger.warning(f"[zalo-bot] đồng bộ handoff sang Chatwoot lỗi thread={thread_id}: {exc}")
        return False


# ─────────────────────────────────────────────────────────────────────────
# Tiếp quản hội thoại
# ─────────────────────────────────────────────────────────────────────────

def effective_pause(row: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    empty = {"paused": False, "paused_until": None, "reason": None, "paused_by": None, "expired": False}
    if not row or not row.get("paused"):
        return empty
    until = parse_ts(row.get("paused_until"))
    if until is not None and until <= now:
        return {**empty, "expired": True}
    return {
        "paused": True,
        "paused_until": _iso(until) if until else None,
        "reason": row.get("reason"),
        "paused_by": row.get("paused_by"),
        "expired": False,
    }


async def _get_thread_row(account_id: str, thread_id: str) -> Optional[Dict[str, Any]]:
    rows = await _rest(
        "GET", "zalo_bot_threads",
        params={"select": "*", "account_id": f"eq.{account_id}", "thread_id": f"eq.{thread_id}", "limit": "1"},
    ) or []
    return rows[0] if rows else None


async def get_pause_state(account_id: str, thread_id: str) -> Dict[str, Any]:
    return effective_pause(await _get_thread_row(account_id, thread_id))


async def _write_thread(account_id: str, thread_id: str, fields: Dict[str, Any]) -> None:
    body = {"account_id": account_id, "thread_id": thread_id, "updated_at": _iso(_now()), **fields}
    await _rest(
        "POST", "zalo_bot_threads", json=[body],
        params={"on_conflict": "account_id,thread_id"}, prefer="resolution=merge-duplicates",
    )


async def set_pause(
    cfg: Dict[str, Any], thread_id: str, *, minutes: Optional[int], reason: str, by: Optional[str],
) -> Dict[str, Any]:
    account_id = cfg["account_id"]
    until = _iso(_now() + timedelta(minutes=minutes)) if minutes and minutes > 0 else None
    synced = await chatwoot_set_handoff(cfg, thread_id, True)
    await _write_thread(account_id, thread_id, {
        "paused": True, "paused_until": until, "reason": reason,
        "paused_by": by or "staff", "chatwoot_synced": synced,
    })
    return await get_pause_state(account_id, thread_id)


async def clear_pause(cfg: Dict[str, Any], thread_id: str, *, by: Optional[str]) -> Dict[str, Any]:
    account_id = cfg["account_id"]
    await chatwoot_set_handoff(cfg, thread_id, False)
    await _write_thread(account_id, thread_id, {
        "paused": False, "paused_until": None, "reason": None, "paused_by": by, "chatwoot_synced": False,
    })
    return await get_pause_state(account_id, thread_id)


async def is_paused_or_expire(cfg: Dict[str, Any], thread_id: str) -> bool:
    """True nếu hội thoại đang bị tạm dừng. Hết hạn thì tự bật lại (và xoá cờ bên Chatwoot)."""
    row = await _get_thread_row(cfg["account_id"], thread_id)
    state = effective_pause(row)
    if state["paused"]:
        return True
    if state["expired"]:
        try:
            await clear_pause(cfg, thread_id, by="auto-expire")
        except Exception:
            logger.exception(f"[zalo-bot] tự bật lại bot sau hết hạn tạm dừng lỗi thread={thread_id}")
    return False


async def list_paused_thread_ids(account_id: str) -> List[str]:
    rows = await _rest(
        "GET", "zalo_bot_threads",
        params={"select": "thread_id,paused,paused_until", "account_id": f"eq.{account_id}", "paused": "eq.true"},
    ) or []
    now = _now()
    return [r["thread_id"] for r in rows if effective_pause(r, now)["paused"]]


async def thread_status(account_id: str, thread_id: str) -> Dict[str, Any]:
    cfg_row = await get_config_row(account_id)
    cfg = normalize_config(cfg_row)
    enabled = bool(cfg_row and cfg["is_enabled"])
    direct = bool(await direct_thread_ids(account_id, [thread_id]))
    scope_mode = cfg.get("scope_mode") or "all"
    rule = await get_rule(account_id, thread_id) if (enabled and direct) else None
    scoped = in_scope(scope_mode, rule)
    applicable = enabled and direct
    pause = await get_pause_state(account_id, thread_id) if applicable else effective_pause(None)
    cw_handed: Optional[bool] = None
    if applicable and chatwoot_ready({**cfg, "account_id": account_id}):
        cw_handed = await chatwoot_handed_off({**cfg, "account_id": account_id}, thread_id)
    if not applicable:
        state = "off"
    elif not scoped:
        state = "out_of_scope"
    elif pause["paused"]:
        state = "paused"
    elif cw_handed:
        state = "handed_off"
    else:
        state = "active"
    return {
        "account_id": account_id,
        "thread_id": thread_id,
        "bot_applicable": applicable,
        "bot_enabled": enabled,
        "scope_mode": scope_mode,
        "rule": rule,              # True = bật tay, False = tắt tay, None = theo mặc định của phạm vi
        "in_scope": scoped,        # bot có được phép trả lời hội thoại này không
        "dry_run": bool(cfg["dry_run"]),
        "state": state,
        "paused": pause["paused"],
        "paused_until": pause["paused_until"],
        "reason": pause["reason"],
        "paused_by": pause["paused_by"],
        "chatwoot_handed_off": cw_handed,
    }


async def note_staff_reply(account_id: str, thread_id: str, email: Optional[str] = None) -> None:
    """Nhân viên vừa nhắn tay -> tự tạm dừng bot ở hội thoại đó (nếu cấu hình cho phép). Không bao giờ ném lỗi."""
    try:
        row = await get_config_row(account_id)
        if not row or not row.get("is_enabled") or not row.get("auto_pause_on_staff_reply", True):
            return
        if not await direct_thread_ids(account_id, [thread_id]):
            return
        cfg = {**normalize_config(row), "account_id": account_id}
        minutes = int(cfg.get("pause_minutes") or 0)
        current = await get_pause_state(account_id, thread_id)
        if current["paused"]:
            if current["paused_until"] is None:
                return  # đang tạm dừng vô thời hạn: giữ nguyên
            new_until = _now() + timedelta(minutes=minutes) if minutes > 0 else None
            existing_until = parse_ts(current["paused_until"])
            if new_until is not None and existing_until is not None and existing_until >= new_until:
                return  # không rút ngắn thời gian tạm dừng đang có
        await set_pause(cfg, thread_id, minutes=minutes or None, reason="staff_reply", by=email or "auto")
    except Exception:
        logger.exception(f"[zalo-bot] tự tạm dừng khi nhân viên nhắn lỗi account={account_id} thread={thread_id}")


# ─────────────────────────────────────────────────────────────────────────
# Nhật ký + thống kê
# ─────────────────────────────────────────────────────────────────────────

async def log_event(
    account_id: str, thread_id: str, direction: str, source_msg_id: Optional[str],
    content: Optional[str], status: str, error: Optional[str] = None, sent_by: str = "bot",
) -> None:
    try:
        await _rest(
            "POST", "zalo_bot_logs",
            json=[{
                "account_id": account_id, "thread_id": thread_id, "direction": direction,
                "source_msg_id": source_msg_id, "content": content, "status": status,
                "error": error, "sent_by": sent_by,
            }],
        )
    except Exception:
        logger.exception("[zalo-bot] ghi log thất bại")


def _clean_search(q: str) -> str:
    return re.sub(r"[,()*%\\\"']", " ", q or "").strip()[:80]


async def _thread_names(account_id: str, thread_ids: List[str]) -> Dict[str, str]:
    ids = [t for t in dict.fromkeys(thread_ids) if t]
    if not ids:
        return {}
    rows = await _rest(
        "GET", "zalo_groups",
        params={"select": "group_id,group_name", "user_id": f"eq.{account_id}", "group_id": f"in.({','.join(ids)})"},
    ) or []
    return {r["group_id"]: r.get("group_name") or "" for r in rows}


LOG_SCAN_MAX_PAGES = 20  # trần số trang quét khi phải lọc theo hội thoại được chia sẻ


async def list_logs(
    account_id: str, *, thread_id: Optional[str] = None, direction: Optional[str] = None,
    status: Optional[str] = None, q: Optional[str] = None, limit: int = 50, before_id: Optional[int] = None,
    allowed_thread_ids: Optional[Any] = None,
) -> Dict[str, Any]:
    """Nhật ký bot. `allowed_thread_ids` (tập thread_id) giới hạn chỉ các hội thoại người gọi được xem;
    None = không giới hạn (người xem được toàn bộ hội thoại của tài khoản)."""
    limit = max(1, min(int(limit or 50), 200))
    allowed = None if allowed_thread_ids is None else {str(t).strip() for t in allowed_thread_ids if str(t).strip()}
    if allowed is not None and not allowed:
        return {"items": [], "has_more": False, "next_before_id": None}
    params: Dict[str, str] = {
        "select": "id,account_id,thread_id,direction,source_msg_id,content,status,error,sent_by,created_at",
        "account_id": f"eq.{account_id}", "order": "id.desc", "limit": str(limit + 1),
    }
    if thread_id:
        params["thread_id"] = f"eq.{thread_id}"
    if direction in ("in", "out"):
        params["direction"] = f"eq.{direction}"
    if status in LOG_STATUSES:
        params["status"] = f"eq.{status}"
    if before_id:
        params["id"] = f"lt.{int(before_id)}"
    term = _clean_search(q or "")
    if term:
        groups = await _rest(
            "GET", "zalo_groups",
            params={"select": "group_id", "user_id": f"eq.{account_id}", "group_name": f"ilike.*{term}*", "limit": "50"},
        ) or []
        gids = [g["group_id"] for g in groups if g.get("group_id")]
        clause = f"content.ilike.*{term}*"
        if gids:
            clause += f",thread_id.in.({','.join(gids)})"
        params["or"] = f"({clause})"
    scan_cursor: Optional[int] = None  # đặt khi dừng vì chạm trần trang mà DB còn dữ liệu cũ hơn
    if allowed is None:
        rows = await _rest("GET", "zalo_bot_logs", params=params) or []
    else:
        # Danh sách hội thoại được chia sẻ có thể rất dài (không nhét vừa URL PostgREST) nên quét theo trang
        # rồi lọc ở đây, dừng khi đủ limit+1 dòng hoặc hết dữ liệu.
        rows = []
        page_params = dict(params)
        page_params["limit"] = "500"
        for _ in range(LOG_SCAN_MAX_PAGES):
            page = await _rest("GET", "zalo_bot_logs", params=page_params) or []
            rows.extend(r for r in page if str(r.get("thread_id") or "").strip() in allowed)
            if len(rows) > limit or len(page) < 500:
                scan_cursor = None
                break
            scan_cursor = int(page[-1]["id"])
            page_params["id"] = f"lt.{scan_cursor}"
    scan_capped = scan_cursor is not None and len(rows) <= limit  # chạm trần quét mà DB còn dữ liệu cũ hơn
    has_more = scan_capped or len(rows) > limit
    rows = rows[:limit]
    names = await _thread_names(account_id, [r["thread_id"] for r in rows])
    items = [{**r, "thread_name": names.get(r["thread_id"]) or None} for r in rows]
    if scan_capped:
        next_id: Optional[int] = scan_cursor  # "Tải thêm" tiếp tục từ chỗ đã quét tới
    else:
        next_id = rows[-1]["id"] if has_more and rows else None
    return {"items": items, "has_more": has_more, "next_before_id": next_id}


def aggregate_stats(rows: List[Dict[str, Any]], days: int, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = (now or _now()).astimezone(VN_TZ)
    totals = {s: 0 for s in LOG_STATUSES}
    by_day: Dict[str, Dict[str, int]] = {}
    for offset in range(days - 1, -1, -1):
        d = (now - timedelta(days=offset)).strftime("%Y-%m-%d")
        by_day[d] = {"in": 0, "out": 0, "error": 0}
    threads = set()
    for r in rows:
        status = r.get("status")
        if status in totals:
            totals[status] += 1
        if r.get("direction") == "in" and r.get("thread_id"):
            threads.add(r["thread_id"])
        ts = parse_ts(r.get("created_at"))
        if not ts:
            continue
        bucket = by_day.get(ts.astimezone(VN_TZ).strftime("%Y-%m-%d"))
        if bucket is None:
            continue
        if r.get("direction") in ("in", "out"):
            bucket[r["direction"]] += 1
        if status == "error":
            bucket["error"] += 1
    return {
        "days": days,
        "totals": totals,
        "threads_handled": len(threads),
        "by_day": [{"date": d, **v} for d, v in by_day.items()],
    }


async def get_stats(account_id: str, days: int = 7) -> Dict[str, Any]:
    days = max(1, min(int(days or 7), 90))
    start = (_now().astimezone(VN_TZ).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1))
    rows = await _rest(
        "GET", "zalo_bot_logs",
        params={
            "select": "direction,status,thread_id,created_at", "account_id": f"eq.{account_id}",
            "created_at": f"gte.{_iso(start)}", "order": "id.desc", "limit": "20000",
        },
    ) or []
    return aggregate_stats(rows, days)


# ─────────────────────────────────────────────────────────────────────────
# Nhãn "Bot" cho tin nhắn gửi đi
# ─────────────────────────────────────────────────────────────────────────

def _row_ms(row: Dict[str, Any]) -> Optional[int]:
    ts = row.get("ts")
    if ts:
        try:
            return int(ts)
        except (TypeError, ValueError):
            pass
    parsed = parse_ts(row.get("created_at") or row.get("time_text"))
    return int(parsed.timestamp() * 1000) if parsed else None


def apply_bot_labels(rows: List[Dict[str, Any]], logs: List[Dict[str, Any]], tolerance_s: int = 180) -> int:
    """Gắn sent_by='bot' cho tin gửi đi khớp log bot: ưu tiên msgId, dự phòng nội dung + thời gian. Trả về số tin gắn nhãn."""
    ids = {str(l["source_msg_id"]) for l in logs if l.get("source_msg_id")}
    pool = [l for l in logs if not l.get("source_msg_id") and (l.get("content") or "").strip()]
    marked = 0
    for r in rows:
        if not r.get("is_sent"):
            continue
        if str(r.get("source_message_id")) in ids:
            r["sent_by"] = "bot"
            marked += 1
            continue
        content = (r.get("content") or "").strip()
        if not content:
            continue
        ms = _row_ms(r)
        if ms is None:
            continue
        for l in pool:
            lt = parse_ts(l.get("created_at"))
            if lt and (l.get("content") or "").strip() == content and abs(int(lt.timestamp() * 1000) - ms) <= tolerance_s * 1000:
                r["sent_by"] = "bot"
                pool.remove(l)
                marked += 1
                break
    return marked


async def annotate_bot_messages(account_id: str, thread_id: str, rows: List[Dict[str, Any]]) -> None:
    """Gắn sent_by='bot' vào các dòng tin nhắn (dict) của 1 trang tin. Không bao giờ ném lỗi."""
    try:
        sent = [r for r in rows if r.get("is_sent")]
        if not sent:
            return
        stamps = [m for m in (_row_ms(r) for r in sent) if m]
        if not stamps:
            return
        since = datetime.fromtimestamp(min(stamps) / 1000 - 600, tz=timezone.utc)
        logs = await _rest(
            "GET", "zalo_bot_logs",
            params={
                "select": "source_msg_id,content,created_at", "account_id": f"eq.{account_id}",
                "thread_id": f"eq.{thread_id}", "direction": "eq.out", "status": "eq.sent", "sent_by": "eq.bot",
                "created_at": f"gte.{_iso(since)}", "order": "id.desc", "limit": "300",
            },
        ) or []
        if logs:
            apply_bot_labels(rows, logs)
    except Exception:
        logger.exception(f"[zalo-bot] gắn nhãn Bot lỗi account={account_id} thread={thread_id}")
