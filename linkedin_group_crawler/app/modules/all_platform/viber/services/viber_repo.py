"""Lớp truy cập DB (Supabase) cho module Viber — cùng khuôn ``telegram_repo.py``:
supabase-py là client đồng bộ nên mọi lệnh bọc ``asyncio.to_thread``."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.viber.config import settings

_bucket_ready = False
_bucket_lock = asyncio.Lock()


async def _run(fn):
    return await asyncio.to_thread(fn)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Accounts ──────────────────────────────────────────────────────────────────

async def create_account(id_member: str, auth_token: str, label: Optional[str] = None) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    row = {"id_member": id_member, "auth_token": auth_token, "label": label, "status": "pending"}
    res = await _run(lambda: sb.table("viber_accounts").insert(row).execute())
    return res.data[0]


async def update_account(account_id: str, **fields: Any) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    fields["updated_at"] = _now_iso()
    res = await _run(lambda: sb.table("viber_accounts").update(fields).eq("id", account_id).execute())
    return res.data[0] if res.data else {}


async def get_account(account_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(lambda: sb.table("viber_accounts").select("*").eq("id", account_id).limit(1).execute())
    return res.data[0] if res.data else None


async def find_account_by_bot(bot_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(lambda: sb.table("viber_accounts").select("*").eq("bot_id", bot_id).limit(1).execute())
    return res.data[0] if res.data else None


async def delete_account(account_id: str) -> None:
    sb: Client = get_supabase_client()
    await _run(lambda: sb.table("viber_accounts").delete().eq("id", account_id).execute())


async def list_accounts(member_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """``member_ids=None`` = admin (mọi account)."""
    sb: Client = get_supabase_client()
    if member_ids is None:
        res = await _run(lambda: sb.table("viber_accounts").select("*").order("created_at", desc=True).execute())
        return res.data or []
    if not member_ids:
        return []
    res = await _run(
        lambda: sb.table("viber_accounts").select("*").in_("id_member", member_ids).order("created_at", desc=True).execute()
    )
    return res.data or []


# ── Dialogs ───────────────────────────────────────────────────────────────────

async def touch_dialog(
    account_id: str,
    viber_user_id: str,
    *,
    name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    language: Optional[str] = None,
    country: Optional[str] = None,
    is_subscribed: Optional[bool] = None,
    last_message_at: Optional[str] = None,
    last_message_preview: Optional[str] = None,
    increment_unread: bool = False,
) -> None:
    sb: Client = get_supabase_client()

    def _do():
        row: Dict[str, Any] = {"account_id": account_id, "viber_user_id": viber_user_id, "updated_at": _now_iso()}
        for key, value in (
            ("name", name),
            ("avatar_url", avatar_url),
            ("language", language),
            ("country", country),
            ("is_subscribed", is_subscribed),
            ("last_message_at", last_message_at),
            ("last_message_preview", last_message_preview),
        ):
            if value is not None:
                row[key] = value
        if increment_unread:
            existing = (
                sb.table("viber_dialogs")
                .select("unread_count")
                .eq("account_id", account_id)
                .eq("viber_user_id", viber_user_id)
                .limit(1)
                .execute()
            )
            prev = existing.data[0]["unread_count"] if existing.data else 0
            row["unread_count"] = int(prev or 0) + 1
        return sb.table("viber_dialogs").upsert(row, on_conflict="account_id,viber_user_id").execute()

    await _run(_do)


async def get_dialog(account_id: str, viber_user_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("viber_dialogs")
        .select("*")
        .eq("account_id", account_id)
        .eq("viber_user_id", viber_user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def list_dialogs(account_id: str) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("viber_dialogs")
        .select("*")
        .eq("account_id", account_id)
        .order("last_message_at", desc=True, nullsfirst=False)
        .execute()
    )
    return res.data or []


async def clear_unread(account_id: str, viber_user_id: str) -> None:
    sb: Client = get_supabase_client()
    await _run(
        lambda: sb.table("viber_dialogs")
        .update({"unread_count": 0})
        .eq("account_id", account_id)
        .eq("viber_user_id", viber_user_id)
        .execute()
    )


# ── Messages ──────────────────────────────────────────────────────────────────

async def upsert_message(row: Dict[str, Any]) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("viber_messages").upsert(row, on_conflict="account_id,message_token").execute()
    )
    return res.data[0] if res.data else row


async def message_exists(account_id: str, message_token: str) -> bool:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("viber_messages")
        .select("id")
        .eq("account_id", account_id)
        .eq("message_token", message_token)
        .limit(1)
        .execute()
    )
    return bool(res.data)


# Trạng thái tin gửi đi chỉ được "nâng cấp" (sent -> delivered -> seen, hoặc -> failed),
# không hạ cấp. ``delivered`` và ``seen`` có thể tới gần như đồng thời và được xử lý ở 2
# task nền song song -> KHÔNG dùng đọc-rồi-ghi (race: cả 2 cùng đọc 'sent' rồi ghi đè
# nhau). Thay vào đó 1 câu UPDATE nguyên tử chỉ khớp khi trạng thái hiện tại còn thấp hơn.
_LOWER_STATUSES = {
    "delivered": ["sent"],
    "seen": ["sent", "delivered"],
    "failed": ["sent", "delivered", "seen"],
}


async def update_message_status(account_id: str, message_token: str, status: str, error: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Nâng trạng thái tin GỬI ĐI (delivered/seen/failed) bằng 1 UPDATE có điều kiện —
    an toàn khi 2 webhook trạng thái tới song song. Trả về dòng đã cập nhật, hoặc None nếu
    trạng thái hiện tại đã bằng/cao hơn (không làm gì)."""
    allowed_from = _LOWER_STATUSES.get(status)
    if allowed_from is None:
        return None
    sb: Client = get_supabase_client()
    fields: Dict[str, Any] = {"status": status}
    if error:
        fields["error"] = error[:500]

    def _do():
        res = (
            sb.table("viber_messages")
            .update(fields)
            .eq("account_id", account_id)
            .eq("message_token", message_token)
            .in_("status", allowed_from)
            .execute()
        )
        return res.data[0] if res.data else None

    return await _run(_do)


async def list_messages(account_id: str, viber_user_id: str, *, limit: int = 50, before: Optional[str] = None) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()

    def _do():
        q = (
            sb.table("viber_messages")
            .select("*")
            .eq("account_id", account_id)
            .eq("viber_user_id", viber_user_id)
            .order("sent_at", desc=True)
            .limit(limit)
        )
        if before:
            q = q.lt("sent_at", before)
        return q.execute()

    res = await _run(_do)
    rows = res.data or []
    rows.reverse()
    return rows


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
            logger.exception(f"Không tạo được bucket media Viber '{settings.supabase_storage_bucket}' (có thể đã tồn tại, bỏ qua)")
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
        logger.exception(f"Upload media Viber thất bại: {path}")
        return None
