"""Lớp nghiệp vụ Telegram gọi từ router — RBAC (admin/leader/member), luồng đăng nhập
(OTP + mật khẩu 2 lớp, hoặc bot token), CRUD hội thoại/tin nhắn qua Telethon. Quy ước
RBAC giống hệt ``supabase_presence_service.py`` (module MỚI: ``member_of_teams.id_member``
= ``app_users.id`` trực tiếp — KHÔNG qua bảng ``members`` trung gian như module
``internal_engagement`` cũ)."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from telethon import TelegramClient, utils
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.telegram.config import settings
from app.modules.all_platform.telegram.services import client_manager, message_events, telegram_repo


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_account(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in row.items() if k != "session_string"}


async def _resolve_member_scope(user: Dict[str, Any]) -> Optional[List[str]]:
    """None = admin (xem mọi account). Ngược lại: danh sách id_member được xem."""
    role = (user.get("role") or "member").strip().lower()
    caller_id = user["id"]
    if role == "admin":
        return None
    if role != "leader":
        return [caller_id]

    sb = get_supabase_client()

    def _do():
        teams_res = sb.table("teams").select("id").eq("id_leader", caller_id).execute()
        team_ids = [t["id"] for t in (teams_res.data or [])]
        member_ids = {caller_id}
        if team_ids:
            mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
            member_ids.update(m["id_member"] for m in (mot_res.data or []) if m.get("id_member"))
        return list(member_ids)

    return await asyncio.to_thread(_do)


async def ensure_account_access(user: Dict[str, Any], account_id: str) -> Dict[str, Any]:
    acc = await telegram_repo.get_account(account_id)
    if not acc:
        raise HTTPException(404, "Không tìm thấy tài khoản Telegram.")
    member_ids = await _resolve_member_scope(user)
    if member_ids is None or acc.get("id_member") in member_ids:
        return acc
    raise HTTPException(403, "Bạn không có quyền truy cập tài khoản Telegram này.")


def _require_live_client(account_id: str) -> TelegramClient:
    client = client_manager.get_live_client(account_id)
    if not client:
        raise HTTPException(400, "Tài khoản Telegram này chưa kết nối realtime (phiên có thể đã hết hạn) — thử kết nối lại.")
    return client


# ── Danh sách account (RBAC) ──────────────────────────────────────────────────

async def list_accounts_for_caller(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    member_ids = await _resolve_member_scope(user)
    rows = await telegram_repo.list_accounts(member_ids)
    return [_public_account(r) for r in rows]


async def resolve_account_ids_for_stream(user: Dict[str, Any]) -> List[str]:
    member_ids = await _resolve_member_scope(user)
    rows = await telegram_repo.list_accounts(member_ids)
    return [r["id"] for r in rows]


# ── Đăng nhập số điện thoại + OTP (+ mật khẩu 2 lớp) ──────────────────────────

async def send_code(user: Dict[str, Any], phone: str) -> Dict[str, Any]:
    if not client_manager.is_configured():
        raise HTTPException(
            500,
            "Server chưa cấu hình TELEGRAM_API_ID/TELEGRAM_API_HASH — lấy tại "
            "https://my.telegram.org/apps rồi khai báo vào .env, khởi động lại backend.",
        )
    phone = (phone or "").strip()
    if not phone:
        raise HTTPException(400, "Thiếu số điện thoại.")

    existing = await telegram_repo.find_incomplete_account(user["id"], phone)
    if existing:
        await client_manager.drop_pending(existing["id"])
        account = existing
    else:
        account = await telegram_repo.create_account(user["id"], "user", phone=phone)

    client = await client_manager.new_pending_client()
    try:
        sent = await client.send_code_request(phone)
    except Exception as exc:
        await client.disconnect()
        await telegram_repo.update_account(account["id"], status="error", last_error=str(exc)[:500])
        raise HTTPException(400, f"Không gửi được mã xác thực: {exc}")

    client_manager.register_pending(account["id"], client, sent.phone_code_hash, phone)
    client_manager.ensure_cleanup_task_started()
    await telegram_repo.update_account(account["id"], status="awaiting_code", last_error=None)
    return {"account_id": account["id"], "status": "awaiting_code"}


async def _finalize_login(account_id: str, client: TelegramClient) -> Dict[str, Any]:
    me = await client.get_me()
    session_string = client.session.save()
    await telegram_repo.update_account(
        account_id,
        session_string=session_string,
        telegram_user_id=me.id,
        username=getattr(me, "username", None),
        display_name=utils.get_display_name(me),
        status="connected",
        connected_at=_now_iso(),
        last_error=None,
    )
    await client_manager.promote_to_live(account_id, client)
    asyncio.create_task(sync_dialogs(account_id))
    return {"account_id": account_id, "status": "connected"}


async def verify_code(user: Dict[str, Any], account_id: str, code: str) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    pending = client_manager.get_pending(account_id)
    if not pending:
        raise HTTPException(400, "Phiên đăng nhập đã hết hạn hoặc chưa gửi mã — hãy bắt đầu lại từ bước nhập số điện thoại.")
    client = pending["client"]
    try:
        await client.sign_in(phone=pending["phone"], code=(code or "").strip(), phone_code_hash=pending["phone_code_hash"])
    except SessionPasswordNeededError:
        await telegram_repo.update_account(account_id, status="awaiting_password")
        return {"account_id": account_id, "status": "awaiting_password"}
    except Exception as exc:
        raise HTTPException(400, f"Mã xác thực không đúng hoặc đã hết hạn: {exc}")
    return await _finalize_login(account_id, client)


async def verify_password(user: Dict[str, Any], account_id: str, password: str) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    pending = client_manager.get_pending(account_id)
    if not pending:
        raise HTTPException(400, "Phiên đăng nhập đã hết hạn — hãy bắt đầu lại từ bước nhập số điện thoại.")
    client = pending["client"]
    try:
        await client.sign_in(password=password or "")
    except Exception as exc:
        raise HTTPException(400, f"Sai mật khẩu xác thực 2 lớp: {exc}")
    return await _finalize_login(account_id, client)


async def bot_login(user: Dict[str, Any], bot_token: str, label: Optional[str] = None) -> Dict[str, Any]:
    if not client_manager.is_configured():
        raise HTTPException(500, "Server chưa cấu hình TELEGRAM_API_ID/TELEGRAM_API_HASH — lấy tại https://my.telegram.org/apps.")
    bot_token = (bot_token or "").strip()
    if not bot_token:
        raise HTTPException(400, "Thiếu bot token.")
    account = await telegram_repo.create_account(user["id"], "bot", label=label)
    client = TelegramClient(StringSession(), settings.telegram_api_id, settings.telegram_api_hash)
    try:
        await client.connect()
        await client.start(bot_token=bot_token)
    except Exception as exc:
        try:
            await client.disconnect()
        except Exception:
            pass
        await telegram_repo.update_account(account["id"], status="error", last_error=str(exc)[:500])
        raise HTTPException(400, f"Đăng nhập bot thất bại: {exc}")
    return await _finalize_login(account["id"], client)


async def disconnect_account(user: Dict[str, Any], account_id: str, *, revoke: bool) -> None:
    await ensure_account_access(user, account_id)
    await client_manager.stop_live_client(account_id, revoke=revoke)
    await client_manager.drop_pending(account_id)
    await telegram_repo.delete_account(account_id)


# ── Hội thoại (dialogs) ────────────────────────────────────────────────────────

async def sync_dialogs(account_id: str) -> List[Dict[str, Any]]:
    client = client_manager.get_live_client(account_id)
    if not client:
        raise HTTPException(400, "Tài khoản chưa kết nối realtime — thử kết nối lại.")
    dialogs = await client.get_dialogs(limit=200)
    rows = []
    for d in dialogs:
        entity = d.entity
        dtype = "channel" if d.is_channel else "group" if d.is_group else "user"
        if getattr(entity, "bot", False):
            dtype = "bot"
        rows.append(
            {
                "account_id": account_id,
                "dialog_id": d.id,
                "dialog_type": dtype,
                "title": d.name or d.title,
                "username": getattr(entity, "username", None),
                "unread_count": d.unread_count or 0,
                "last_message_at": d.date.isoformat() if d.date else None,
                "last_message_preview": (d.message.message[:200] if d.message and d.message.message else None),
                "is_pinned": bool(d.pinned),
            }
        )
    await telegram_repo.upsert_dialogs(rows)
    return await telegram_repo.list_dialogs(account_id)


async def list_dialogs(user: Dict[str, Any], account_id: str, *, refresh: bool = False) -> List[Dict[str, Any]]:
    await ensure_account_access(user, account_id)
    if refresh:
        return await sync_dialogs(account_id)
    rows = await telegram_repo.list_dialogs(account_id)
    if not rows:
        return await sync_dialogs(account_id)
    return rows


# ── Tin nhắn ───────────────────────────────────────────────────────────────────

async def get_messages(
    user: Dict[str, Any], account_id: str, dialog_id: int, *, limit: int = 50, before_message_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    await ensure_account_access(user, account_id)
    rows = await telegram_repo.list_messages(account_id, dialog_id, limit=limit, before_message_id=before_message_id)
    if rows or before_message_id:
        if not before_message_id:
            await telegram_repo.clear_unread(account_id, dialog_id)
        return rows

    client = client_manager.get_live_client(account_id)
    if not client:
        return []
    entity = await client.get_input_entity(dialog_id)
    messages = await client.get_messages(entity, limit=limit)
    # Lần đầu mở 1 hội thoại (cache DB rỗng): mỗi tin nhắn cần 1-2 lượt gọi mạng riêng
    # (get_sender, download_media) - chạy TUẦN TỰ từng tin (await trong for-loop) khiến
    # tổng thời gian chờ = tổng của MỌI tin nhắn cộng lại (rất chậm khi có media). Chạy
    # song song (giới hạn 8 cùng lúc, tránh dí quá nhiều request cùng lúc vào Telegram)
    # để tổng thời gian chờ ~ bằng 1 tin nhắn chậm nhất thay vì cộng dồn.
    semaphore = asyncio.Semaphore(8)

    async def _backfill_one(m):
        async with semaphore:
            await client_manager.backfill_message(account_id, client, m)

    await asyncio.gather(*(_backfill_one(m) for m in messages))
    await telegram_repo.clear_unread(account_id, dialog_id)
    return await telegram_repo.list_messages(account_id, dialog_id, limit=limit)


async def send_text(user: Dict[str, Any], account_id: str, dialog_id: int, text: str, *, reply_to: Optional[int] = None) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    client = _require_live_client(account_id)
    text = (text or "").strip()
    if not text:
        raise HTTPException(400, "Nội dung tin nhắn trống.")
    entity = await client.get_input_entity(dialog_id)
    msg = await client.send_message(entity, text, reply_to=reply_to or None)
    return await client_manager.record_sent_message(account_id, client, msg)


async def send_media(
    user: Dict[str, Any],
    account_id: str,
    dialog_id: int,
    filename: str,
    data: bytes,
    *,
    caption: Optional[str] = None,
    reply_to: Optional[int] = None,
) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    client = _require_live_client(account_id)
    entity = await client.get_input_entity(dialog_id)
    buf = BytesIO(data)
    buf.name = filename or "file"
    msg = await client.send_file(entity, file=buf, caption=caption or None, reply_to=reply_to or None)
    return await client_manager.record_sent_message(account_id, client, msg)


async def edit_message(user: Dict[str, Any], account_id: str, dialog_id: int, message_id: int, text: str) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    client = _require_live_client(account_id)
    entity = await client.get_input_entity(dialog_id)
    try:
        msg = await client.edit_message(entity, message_id, text)
    except Exception as exc:
        raise HTTPException(400, f"Không sửa được tin nhắn: {exc}")
    return await client_manager.record_sent_message(account_id, client, msg)


async def delete_message(user: Dict[str, Any], account_id: str, dialog_id: int, message_id: int, *, revoke: bool = True) -> None:
    await ensure_account_access(user, account_id)
    client = _require_live_client(account_id)
    entity = await client.get_input_entity(dialog_id)
    await client.delete_messages(entity, [message_id], revoke=revoke)
    await telegram_repo.mark_messages_deleted(account_id, dialog_id, [message_id])
    await message_events.publish_telegram_event(account_id, {"type": "messages_deleted", "dialog_id": dialog_id, "message_ids": [message_id]})


async def forward_message(
    user: Dict[str, Any], account_id: str, from_dialog_id: int, message_id: int, to_dialog_id: int
) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    client = _require_live_client(account_id)
    from_entity = await client.get_input_entity(from_dialog_id)
    to_entity = await client.get_input_entity(to_dialog_id)
    try:
        msgs = await client.forward_messages(to_entity, [message_id], from_peer=from_entity)
    except Exception as exc:
        raise HTTPException(400, f"Không chuyển tiếp được: {exc}")
    msg = msgs[0] if isinstance(msgs, list) else msgs
    return await client_manager.record_sent_message(account_id, client, msg)


async def pin_message(user: Dict[str, Any], account_id: str, dialog_id: int, message_id: int, *, unpin: bool = False) -> None:
    await ensure_account_access(user, account_id)
    client = _require_live_client(account_id)
    entity = await client.get_input_entity(dialog_id)
    try:
        if unpin:
            await client.unpin_message(entity, message_id)
        else:
            await client.pin_message(entity, message_id, notify=False)
    except Exception as exc:
        raise HTTPException(400, f"Không thực hiện được: {exc}")
