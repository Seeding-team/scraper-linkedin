"""Quản lý các TelegramClient (Telethon) đang sống trong process — mỗi tài khoản
Telegram đã kết nối có ĐÚNG 1 client giữ kết nối MTProto liên tục (để nhận sự kiện
realtime qua ``events.NewMessage``/``MessageEdited``/``MessageDeleted``), y hệt tinh
thần ``zca_persistent_listener.py`` của Zalo nhưng không cần subprocess Node vì
Telethon là thư viện Python thuần.

Session lưu dạng ``StringSession`` (chuỗi text) trong cột ``telegram_accounts
.session_string`` — KHÔNG lưu ra file .session trên đĩa — để backend chạy được trên
container/nhiều instance mà không mất session khi container bị recreate.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, Optional

from loguru import logger
from telethon import TelegramClient, events, utils
from telethon.sessions import StringSession

from app.modules.all_platform.telegram.config import settings
from app.modules.all_platform.telegram.services import message_events, telegram_repo

# account_id (uuid text) -> TelegramClient đã đăng nhập xong, đang giữ kết nối realtime.
_live: Dict[str, TelegramClient] = {}

# account_id -> {"client":..., "phone_code_hash":..., "phone":..., "created_at": monotonic}
# Giữ TRONG LÚC người dùng đang gõ mã OTP/mật khẩu 2 lớp — PHẢI dùng lại đúng client đã
# gọi send_code_request() (Telethon yêu cầu cùng 1 kết nối cho các bước của 1 lần đăng
# nhập), không thể tạo client mới ở bước verify-code.
_pending: Dict[str, Dict[str, Any]] = {}
_cleanup_task: Optional[asyncio.Task] = None


def is_configured() -> bool:
    from app.modules.all_platform.telegram.config import is_configured as _is_cfg
    return _is_cfg()


def get_live_client(account_id: str) -> Optional[TelegramClient]:
    return _live.get(account_id)


async def new_pending_client() -> TelegramClient:
    client = TelegramClient(StringSession(), settings.telegram_api_id, settings.telegram_api_hash)
    await client.connect()
    return client


def register_pending(account_id: str, client: TelegramClient, phone_code_hash: str, phone: str) -> None:
    _pending[account_id] = {
        "client": client,
        "phone_code_hash": phone_code_hash,
        "phone": phone,
        "created_at": time.monotonic(),
    }


def get_pending(account_id: str) -> Optional[Dict[str, Any]]:
    return _pending.get(account_id)


async def drop_pending(account_id: str) -> None:
    entry = _pending.pop(account_id, None)
    if entry:
        try:
            await entry["client"].disconnect()
        except Exception:
            pass


def _guess_media(message) -> tuple[Optional[str], Optional[Any]]:
    if message.photo:
        return "photo", message.file
    if message.video:
        return "video", message.file
    if message.voice:
        return "voice", message.file
    if message.document:
        return "document", message.file
    return None, None


async def _persist_message(
    account_id: str, client: TelegramClient, message, *, is_edit: bool = False, publish: bool = True, touch_dialog: bool = True
) -> Dict[str, Any]:
    dialog_id = utils.get_peer_id(message.peer_id)

    sender_id = None
    sender_name = None
    try:
        sender = await message.get_sender()
        if sender is not None:
            sender_id = getattr(sender, "id", None)
            sender_name = utils.get_display_name(sender) or getattr(sender, "username", None)
    except Exception:
        pass

    media_type, file_info = _guess_media(message)
    media_url = None
    if media_type:
        try:
            data = await message.download_media(file=bytes)
            if data:
                ext = (file_info.ext if file_info and file_info.ext else "") or ""
                content_type = (file_info.mime_type if file_info else None) or "application/octet-stream"
                path = f"{account_id}/{dialog_id}/{message.id}{ext}"
                media_url = await telegram_repo.upload_media(path, data, content_type)
        except Exception:
            logger.exception(f"[Telegram {account_id}] Lỗi tải media của tin nhắn {message.id}")

    row = {
        "account_id": account_id,
        "dialog_id": dialog_id,
        "message_id": message.id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "is_outgoing": bool(message.out),
        "text": message.message or None,
        "media_type": media_type,
        "media_url": media_url,
        "reply_to_message_id": message.reply_to_msg_id,
        "is_edited": bool(is_edit or message.edit_date),
        "is_pinned": bool(message.pinned),
        "sent_at": message.date.isoformat() if message.date else None,
    }
    saved = await telegram_repo.upsert_message(row)

    # Backfill lịch sử (mở 1 hội thoại lần đầu, cache rỗng) không cần cập nhật preview/
    # unread của dialog cho TỪNG tin nhắn cũ - "hiện" nhất vẫn do sync_dialogs()/handler
    # realtime lo, làm ở đây chỉ tốn thêm round-trip DB (SELECT+upsert) x N tin nhắn,
    # là 1 phần lý do chính khiến mở hội thoại lần đầu chậm.
    if touch_dialog:
        preview = row["text"] or (f"[{media_type}]" if media_type else "")
        dialog_title = None
        dialog_type = None
        try:
            entity = await message.get_chat()
            if entity is not None:
                dialog_title = utils.get_display_name(entity) or getattr(entity, "title", None)
                dialog_type = (
                    "channel" if getattr(entity, "broadcast", False)
                    else "group" if (getattr(entity, "megagroup", False) or message.is_group)
                    else "bot" if getattr(entity, "bot", False)
                    else "user"
                )
        except Exception:
            pass

        await telegram_repo.touch_dialog(
            account_id,
            dialog_id,
            title=dialog_title,
            dialog_type=dialog_type,
            last_message_at=row["sent_at"],
            last_message_preview=preview,
            increment_unread=(not message.out and not is_edit),
        )

    if publish:
        await message_events.publish_telegram_event(account_id, {"type": "message", "message": saved})
    return saved


async def backfill_message(account_id: str, client: TelegramClient, message) -> Dict[str, Any]:
    """Nạp 1 tin nhắn LỊCH SỬ (đọc qua ``client.get_messages`` khi cache DB rỗng) vào
    DB — KHÔNG phát SSE (không phải tin mới, các client đang mở không cần được báo) và
    KHÔNG cập nhật preview/unread của dialog (xem giải thích ở ``_persist_message``)."""
    return await _persist_message(account_id, client, message, publish=False, touch_dialog=False)


async def record_sent_message(account_id: str, client: TelegramClient, message) -> Dict[str, Any]:
    """Tin nhắn do CHÍNH tool này vừa gửi/sửa/forward — vẫn phát SSE để các tab khác
    (vd admin đang xem cùng account) thấy ngay, không phải đợi tới lần poll kế tiếp."""
    return await _persist_message(account_id, client, message, publish=True)


def _register_handlers(account_id: str, client: TelegramClient) -> None:
    @client.on(events.NewMessage)
    async def _on_new(event):
        try:
            await _persist_message(account_id, client, event.message)
        except Exception:
            logger.exception(f"[Telegram {account_id}] Lỗi xử lý NewMessage")

    @client.on(events.MessageEdited)
    async def _on_edited(event):
        try:
            await _persist_message(account_id, client, event.message, is_edit=True)
        except Exception:
            logger.exception(f"[Telegram {account_id}] Lỗi xử lý MessageEdited")

    @client.on(events.MessageDeleted)
    async def _on_deleted(event):
        try:
            dialog_id = event.chat_id
            if dialog_id is None or not event.deleted_ids:
                return
            await telegram_repo.mark_messages_deleted(account_id, dialog_id, list(event.deleted_ids))
            await message_events.publish_telegram_event(
                account_id, {"type": "messages_deleted", "dialog_id": dialog_id, "message_ids": list(event.deleted_ids)}
            )
        except Exception:
            logger.exception(f"[Telegram {account_id}] Lỗi xử lý MessageDeleted")


async def promote_to_live(account_id: str, client: TelegramClient) -> None:
    """Client đã đăng nhập xong (OTP+2FA xong, hoặc bot token xong) -> gắn handler
    realtime + giữ kết nối liên tục. Gỡ khỏi ``_pending`` nếu còn (không disconnect nó
    — đây CHÍNH LÀ client đó, chỉ đổi vai trò)."""
    _pending.pop(account_id, None)
    _register_handlers(account_id, client)
    _live[account_id] = client


async def stop_live_client(account_id: str, *, revoke: bool = False) -> None:
    client = _live.pop(account_id, None)
    if not client:
        return
    try:
        if revoke:
            await client.log_out()
        else:
            await client.disconnect()
    except Exception:
        logger.exception(f"[Telegram {account_id}] Lỗi khi ngắt kết nối client")


async def start_persisted_clients() -> None:
    """Khởi động lại listener cho MỌI account đã ``connected`` (session còn hợp lệ) —
    gọi lúc app FastAPI start (xem app/main.py lifespan), giống ``start_persisted_listeners``
    của Zalo. Account nào session đã bị Telegram thu hồi (đổi mật khẩu, đăng xuất từ xa,
    revoke từ app Telegram gốc...) sẽ tự chuyển ``status='error'`` để FE báo cần đăng nhập
    lại, KHÔNG throw làm hỏng cả quá trình khởi động các account khác."""
    if not is_configured():
        logger.warning("TELEGRAM_API_ID/TELEGRAM_API_HASH chưa cấu hình — bỏ qua khởi động lại các Telegram client.")
        return
    accounts = await telegram_repo.list_connected_accounts()
    for acc in accounts:
        account_id = acc["id"]
        try:
            client = TelegramClient(StringSession(acc["session_string"]), settings.telegram_api_id, settings.telegram_api_hash)
            await client.connect()
            if not await client.is_user_authorized():
                await client.disconnect()
                await telegram_repo.update_account(account_id, status="error", last_error="Phiên đăng nhập đã hết hạn/bị thu hồi — cần kết nối lại.")
                continue
            await promote_to_live(account_id, client)
            logger.info(f"[Telegram] Đã khôi phục kết nối realtime cho account {account_id} ({acc.get('label') or acc.get('phone') or acc.get('username')})")
        except Exception as exc:
            logger.exception(f"[Telegram] Không khôi phục được account {account_id}")
            try:
                await telegram_repo.update_account(account_id, status="error", last_error=str(exc)[:500])
            except Exception:
                pass


async def shutdown_all() -> None:
    for account_id in list(_live.keys()):
        await stop_live_client(account_id)
    for account_id in list(_pending.keys()):
        await drop_pending(account_id)
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
        _cleanup_task = None


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        now = time.monotonic()
        stale = [aid for aid, entry in _pending.items() if now - entry["created_at"] > settings.pending_login_ttl_seconds]
        for aid in stale:
            logger.info(f"[Telegram] Dọn phiên đăng nhập dở dang quá hạn: {aid}")
            await drop_pending(aid)
            try:
                await telegram_repo.update_account(aid, status="error", last_error="Hết thời gian nhập mã/mật khẩu — thử kết nối lại.")
            except Exception:
                pass


def ensure_cleanup_task_started() -> None:
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_cleanup_loop())
