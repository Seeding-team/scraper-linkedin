"""Lớp truy cập DB (Supabase) cho module Telegram — dùng `get_supabase_client()` dùng
chung (app/core/supabase_client.py), giống các module MỚI trong all_platform (khác với
Zalo module cũ tự viết `_rest()` httpx riêng). supabase-py là client ĐỒNG BỘ — mọi hàm ở
đây chạy trong `asyncio.to_thread()` để không chặn event loop (event loop này còn phải
phục vụ I/O mạng của chính Telethon), giống cách `push_service.py` đã bọc `webpush()`."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.telegram.config import settings

_bucket_ready = False
_bucket_lock = asyncio.Lock()


async def _run(fn):
    return await asyncio.to_thread(fn)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Accounts ──────────────────────────────────────────────────────────────────

async def create_account(id_member: str, auth_type: str, phone: Optional[str] = None, label: Optional[str] = None) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    row = {
        "id_member": id_member,
        "auth_type": auth_type,
        "phone": phone,
        "label": label,
        "status": "pending",
    }
    res = await _run(lambda: sb.table("telegram_accounts").insert(row).execute())
    return res.data[0]


async def update_account(account_id: str, **fields: Any) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    fields["updated_at"] = _now_iso()
    res = await _run(lambda: sb.table("telegram_accounts").update(fields).eq("id", account_id).execute())
    return res.data[0] if res.data else {}


async def get_account(account_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(lambda: sb.table("telegram_accounts").select("*").eq("id", account_id).limit(1).execute())
    return res.data[0] if res.data else None


async def delete_account(account_id: str) -> None:
    sb: Client = get_supabase_client()
    await _run(lambda: sb.table("telegram_accounts").delete().eq("id", account_id).execute())


async def list_accounts(member_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """``member_ids=None`` nghĩa là admin — trả về TẤT CẢ account (caller đã tự resolve
    RBAC trước khi gọi, xem ``_resolve_member_scope`` trong telegram_service.py)."""
    sb: Client = get_supabase_client()
    if member_ids is None:
        res = await _run(lambda: sb.table("telegram_accounts").select("*").order("created_at", desc=True).execute())
        return res.data or []
    if not member_ids:
        return []
    res = await _run(
        lambda: sb.table("telegram_accounts").select("*").in_("id_member", member_ids).order("created_at", desc=True).execute()
    )
    return res.data or []


async def find_incomplete_account(id_member: str, phone: str) -> Optional[Dict[str, Any]]:
    """Tìm account cũ CHƯA kết nối xong (còn dở ở bước nhập mã/mật khẩu) của cùng
    (id_member, phone) — để tái sử dụng/ghi đè thay vì tạo rác mỗi lần người dùng thử
    lại (đổi số/gõ sai mã rồi bấm gửi lại mã)."""
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("telegram_accounts")
        .select("*")
        .eq("id_member", id_member)
        .eq("phone", phone)
        .in_("status", ["pending", "awaiting_code", "awaiting_password"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def list_connected_accounts() -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("telegram_accounts").select("*").eq("status", "connected").not_.is_("session_string", "null").execute()
    )
    return res.data or []


# ── Dialogs ───────────────────────────────────────────────────────────────────

async def upsert_dialogs(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    sb: Client = get_supabase_client()
    for r in rows:
        r["updated_at"] = _now_iso()
    await _run(lambda: sb.table("telegram_dialogs").upsert(rows, on_conflict="account_id,dialog_id").execute())


async def touch_dialog(
    account_id: str,
    dialog_id: int,
    *,
    title: Optional[str] = None,
    dialog_type: Optional[str] = None,
    username: Optional[str] = None,
    last_message_at: Optional[str] = None,
    last_message_preview: Optional[str] = None,
    increment_unread: bool = False,
) -> None:
    sb: Client = get_supabase_client()

    def _do():
        existing = (
            sb.table("telegram_dialogs")
            .select("unread_count")
            .eq("account_id", account_id)
            .eq("dialog_id", dialog_id)
            .limit(1)
            .execute()
        )
        row: Dict[str, Any] = {
            "account_id": account_id,
            "dialog_id": dialog_id,
            "updated_at": _now_iso(),
        }
        if title is not None:
            row["title"] = title
        if dialog_type is not None:
            row["dialog_type"] = dialog_type
        if username is not None:
            row["username"] = username
        if last_message_at is not None:
            row["last_message_at"] = last_message_at
        if last_message_preview is not None:
            row["last_message_preview"] = last_message_preview
        if increment_unread:
            prev = existing.data[0]["unread_count"] if existing.data else 0
            row["unread_count"] = int(prev or 0) + 1
        return sb.table("telegram_dialogs").upsert(row, on_conflict="account_id,dialog_id").execute()

    await _run(_do)


async def list_dialogs(account_id: str) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("telegram_dialogs")
        .select("*")
        .eq("account_id", account_id)
        .order("last_message_at", desc=True)
        .execute()
    )
    return res.data or []


async def clear_unread(account_id: str, dialog_id: int) -> None:
    sb: Client = get_supabase_client()
    await _run(
        lambda: sb.table("telegram_dialogs")
        .update({"unread_count": 0})
        .eq("account_id", account_id)
        .eq("dialog_id", dialog_id)
        .execute()
    )


# ── Messages ──────────────────────────────────────────────────────────────────

async def upsert_message(row: Dict[str, Any]) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("telegram_messages")
        .upsert(row, on_conflict="account_id,dialog_id,message_id")
        .execute()
    )
    return res.data[0] if res.data else row


async def list_messages(account_id: str, dialog_id: int, *, limit: int = 50, before_message_id: Optional[int] = None) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()

    def _do():
        q = (
            sb.table("telegram_messages")
            .select("*")
            .eq("account_id", account_id)
            .eq("dialog_id", dialog_id)
            .order("message_id", desc=True)
            .limit(limit)
        )
        if before_message_id:
            q = q.lt("message_id", before_message_id)
        return q.execute()

    res = await _run(_do)
    rows = res.data or []
    rows.reverse()  # DB trả mới->cũ (để LIMIT lấy đúng N tin gần nhất) -> đảo lại cũ->mới cho UI
    return rows


async def mark_messages_deleted(account_id: str, dialog_id: int, message_ids: List[int]) -> None:
    if not message_ids:
        return
    sb: Client = get_supabase_client()
    await _run(
        lambda: sb.table("telegram_messages")
        .update({"is_deleted": True})
        .eq("account_id", account_id)
        .eq("dialog_id", dialog_id)
        .in_("message_id", message_ids)
        .execute()
    )


# ── Media storage ─────────────────────────────────────────────────────────────

async def _ensure_bucket() -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    async with _bucket_lock:
        if _bucket_ready:
            return
        sb: Client = get_supabase_client()

        def _do():
            try:
                sb.storage.create_bucket(settings.supabase_storage_bucket, options={"public": True})
            except Exception as exc:
                if "already exists" not in str(exc).lower() and "duplicate" not in str(exc).lower():
                    raise

        try:
            await _run(_do)
        except Exception:
            logger.exception(f"Không tạo được bucket lưu media Telegram '{settings.supabase_storage_bucket}' (có thể đã tồn tại, bỏ qua)")
        _bucket_ready = True


async def upload_media(path: str, data: bytes, content_type: str) -> Optional[str]:
    await _ensure_bucket()
    sb: Client = get_supabase_client()
    bucket = settings.supabase_storage_bucket

    def _do():
        sb.storage.from_(bucket).upload(
            path, data, file_options={"content-type": content_type or "application/octet-stream", "upsert": "true"}
        )
        return sb.storage.from_(bucket).get_public_url(path)

    try:
        return await _run(_do)
    except Exception:
        logger.exception(f"Upload media Telegram thất bại: {path}")
        return None
