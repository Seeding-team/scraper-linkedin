"""Nghiệp vụ Viber Chat gọi từ router: RBAC (admin/leader/member — giống hệt
``telegram_service._resolve_member_scope``), kết nối bot (auth token + set_webhook), xử lý
webhook Viber gọi về, gửi text/ảnh/video/file.

Giới hạn của Viber Bot API (khác Telegram/Zalo — KHÔNG phải thiếu sót của tool):
- Không có API đọc lịch sử/danh sách hội thoại: hội thoại chỉ xuất hiện khi khách nhắn
  tới bot (hoặc mở màn chat với bot / subscribe) sau khi đã kết nối.
- Không sửa/xoá/ghim/chuyển tiếp tin nhắn; chỉ gửi được cho người đã nhắn/subscribe bot.
- Media gửi đi phải là URL công khai -> upload lên Supabase Storage rồi đưa URL cho Viber.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import HTTPException
from loguru import logger

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.viber.config import webhook_url_for
from app.modules.all_platform.viber.services import message_events, viber_api, viber_repo
from app.modules.all_platform.viber.services.viber_api import ViberApiError

# Giữ tham chiếu tới task xử lý webhook chạy nền để không bị GC giữa chừng.
_background_tasks: Set[asyncio.Task] = set()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ts_to_iso(ts_ms: Any) -> str:
    try:
        return datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return _now_iso()


def _public_account(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in row.items() if k != "auth_token"}


def _user_folder(viber_user_id: str) -> str:
    # viber_user_id có thể chứa '/', '+', '=' -> không dùng thẳng làm thư mục storage.
    return hashlib.sha1(viber_user_id.encode("utf-8")).hexdigest()[:16]


def _caller_name(user: Dict[str, Any]) -> Optional[str]:
    return user.get("full_name") or user.get("name") or user.get("email")


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
    acc = await viber_repo.get_account(account_id)
    if not acc:
        raise HTTPException(404, "Không tìm thấy tài khoản Viber.")
    member_ids = await _resolve_member_scope(user)
    if member_ids is None or acc.get("id_member") in member_ids:
        return acc
    raise HTTPException(403, "Bạn không có quyền truy cập tài khoản Viber này.")


# ── Danh sách account (RBAC) ──────────────────────────────────────────────────

async def list_accounts_for_caller(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    member_ids = await _resolve_member_scope(user)
    rows = await viber_repo.list_accounts(member_ids)
    return [_public_account(r) for r in rows]


async def resolve_account_ids_for_stream(user: Dict[str, Any]) -> List[str]:
    member_ids = await _resolve_member_scope(user)
    rows = await viber_repo.list_accounts(member_ids)
    return [r["id"] for r in rows]


# ── Kết nối bot ───────────────────────────────────────────────────────────────

def _info_fields(info: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "bot_id": info.get("id"),
        "bot_uri": info.get("uri"),
        "display_name": info.get("name"),
        "avatar_url": info.get("icon"),
        "subscribers_count": info.get("subscribers_count"),
    }


async def _register_webhook(account: Dict[str, Any]) -> Dict[str, Any]:
    """Gọi set_webhook. Trong lúc gọi, Viber gửi ngay 1 callback ``event=webhook`` tới URL
    và chỉ chấp nhận khi nhận 200 -> account phải có sẵn trong DB (để kiểm chữ ký)."""
    url = webhook_url_for(account["id"])
    if not url.startswith("https://"):
        msg = (
            "Chưa cấu hình URL HTTPS công khai cho webhook Viber — khai báo VIBER_WEBHOOK_BASE_URL "
            "(hoặc PUBLIC_APP_BASE_URL) dạng https://... trong .env rồi khởi động lại backend."
        )
        await viber_repo.update_account(account["id"], status="error", last_error=msg)
        raise HTTPException(500, msg)
    try:
        await viber_api.set_webhook(account["auth_token"], url)
    except Exception as exc:
        await viber_repo.update_account(account["id"], status="error", webhook_url=url, last_error=str(exc)[:500])
        raise HTTPException(400, f"Không đăng ký được webhook với Viber: {exc}")
    return await viber_repo.update_account(
        account["id"], status="connected", webhook_url=url, connected_at=_now_iso(), last_error=None
    )


async def connect_bot(user: Dict[str, Any], auth_token: str, label: Optional[str] = None) -> Dict[str, Any]:
    auth_token = (auth_token or "").strip()
    if not auth_token:
        raise HTTPException(400, "Thiếu auth token của Viber Bot.")
    try:
        info = await viber_api.get_account_info(auth_token)
    except ViberApiError as exc:
        raise HTTPException(400, f"Token không hợp lệ: {exc}")
    except Exception as exc:
        raise HTTPException(502, f"Không gọi được Viber API: {exc}")

    existing = await viber_repo.find_account_by_bot(str(info.get("id"))) if info.get("id") else None
    if existing:
        # Cùng 1 bot đã kết nối trước đó -> cập nhật token/thông tin thay vì tạo bản trùng
        # (2 bản ghi cùng bot sẽ giành nhau webhook, chỉ bản đăng ký sau nhận được tin).
        await ensure_account_access(user, existing["id"])
        account = await viber_repo.update_account(existing["id"], auth_token=auth_token, label=label or existing.get("label"), **_info_fields(info))
    else:
        account = await viber_repo.create_account(user["id"], auth_token, label=label)
        account = await viber_repo.update_account(account["id"], **_info_fields(info))
    account = await _register_webhook(account)
    return _public_account(account)


async def reconnect(user: Dict[str, Any], account_id: str) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    try:
        info = await viber_api.get_account_info(acc["auth_token"])
        acc = await viber_repo.update_account(account_id, **_info_fields(info))
    except ViberApiError as exc:
        await viber_repo.update_account(account_id, status="error", last_error=str(exc)[:500])
        raise HTTPException(400, f"Token không còn hợp lệ: {exc}")
    acc = await _register_webhook(acc)
    return _public_account(acc)


async def disconnect_account(user: Dict[str, Any], account_id: str) -> None:
    acc = await ensure_account_access(user, account_id)
    try:
        await viber_api.remove_webhook(acc["auth_token"])
    except Exception:
        logger.warning(f"[Viber {account_id}] Không gỡ được webhook (bỏ qua, vẫn xoá khỏi tool)")
    await viber_repo.delete_account(account_id)


# ── Hội thoại / tin nhắn ──────────────────────────────────────────────────────

async def list_dialogs(user: Dict[str, Any], account_id: str) -> List[Dict[str, Any]]:
    await ensure_account_access(user, account_id)
    return await viber_repo.list_dialogs(account_id)


async def get_messages(
    user: Dict[str, Any], account_id: str, viber_user_id: str, *, limit: int = 50, before: Optional[str] = None
) -> List[Dict[str, Any]]:
    await ensure_account_access(user, account_id)
    rows = await viber_repo.list_messages(account_id, viber_user_id, limit=limit, before=before)
    if not before:
        await viber_repo.clear_unread(account_id, viber_user_id)
    return rows


def _preview(row: Dict[str, Any]) -> str:
    if row.get("text"):
        return str(row["text"])[:200]
    labels = {"picture": "[Hình ảnh]", "video": "[Video]", "file": "[Tệp]", "sticker": "[Sticker]", "location": "[Vị trí]", "contact": "[Danh bạ]"}
    return labels.get(row.get("media_type") or "", "")


async def _record_outgoing(account_id: str, viber_user_id: str, message_token: str, user: Dict[str, Any], **fields: Any) -> Dict[str, Any]:
    row = {
        "account_id": account_id,
        "viber_user_id": viber_user_id,
        "message_token": message_token,
        "is_outgoing": True,
        "sender_name": _caller_name(user),
        "sent_by_member": user.get("id"),
        "status": "sent",
        "sent_at": _now_iso(),
        **fields,
    }
    saved = await viber_repo.upsert_message(row)
    await viber_repo.touch_dialog(account_id, viber_user_id, last_message_at=row["sent_at"], last_message_preview=_preview(row))
    await message_events.publish_viber_event(account_id, {"type": "message", "message": saved})
    return saved


def _send_error(exc: Exception) -> HTTPException:
    return HTTPException(400, f"Viber từ chối gửi: {exc}") if isinstance(exc, ViberApiError) else HTTPException(502, f"Không gửi được tới Viber: {exc}")


async def _ensure_dialog(account_id: str, viber_user_id: str) -> None:
    if not await viber_repo.get_dialog(account_id, viber_user_id):
        raise HTTPException(404, "Không tìm thấy hội thoại Viber này.")


async def send_text(user: Dict[str, Any], account_id: str, viber_user_id: str, text: str) -> List[Dict[str, Any]]:
    acc = await ensure_account_access(user, account_id)
    await _ensure_dialog(account_id, viber_user_id)
    text = (text or "").strip()
    if not text:
        raise HTTPException(400, "Nội dung tin nhắn trống.")
    # Viber giới hạn 7000 ký tự/tin -> chia nhỏ tin dài.
    chunks = [text[i : i + viber_api.TEXT_MAX_CHARS] for i in range(0, len(text), viber_api.TEXT_MAX_CHARS)]
    saved: List[Dict[str, Any]] = []
    for chunk in chunks:
        try:
            token = await viber_api.send_message(
                acc["auth_token"], viber_user_id, acc.get("display_name") or acc.get("label") or "Bot", acc.get("avatar_url"),
                {"type": "text", "text": chunk},
            )
        except Exception as exc:
            raise _send_error(exc)
        saved.append(await _record_outgoing(account_id, viber_user_id, token, user, text=chunk))
    return saved


def _media_kind(content_type: str, size: int) -> Optional[str]:
    if content_type in viber_api.PICTURE_MIME and size <= viber_api.PICTURE_MAX_BYTES:
        return "picture"
    if content_type == "video/mp4" and size <= viber_api.VIDEO_MAX_BYTES:
        return "video"
    if size <= viber_api.FILE_MAX_BYTES:
        return "file"
    return None


async def send_media(
    user: Dict[str, Any],
    account_id: str,
    viber_user_id: str,
    filename: str,
    data: bytes,
    content_type: Optional[str],
    *,
    caption: Optional[str] = None,
) -> List[Dict[str, Any]]:
    acc = await ensure_account_access(user, account_id)
    await _ensure_dialog(account_id, viber_user_id)
    if not data:
        raise HTTPException(400, "Tệp rỗng.")
    filename = (filename or "file").strip() or "file"
    ct = (content_type or "").split(";")[0].strip().lower()
    if not ct or ct == "application/octet-stream":
        ct = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    size = len(data)
    kind = _media_kind(ct, size)
    if not kind:
        raise HTTPException(400, "Tệp vượt quá 50MB — Viber không cho gửi.")

    ext = mimetypes.guess_extension(ct) or ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[1].lower()
    if ext == ".jpe":
        ext = ".jpg"
    path = f"{account_id}/{_user_folder(viber_user_id)}/out-{uuid.uuid4().hex}{ext}"
    media_url = await viber_repo.upload_media(path, data, ct)
    if not media_url:
        raise HTTPException(500, "Không tải được tệp lên kho lưu trữ để gửi qua Viber.")

    caption = (caption or "").strip()
    body: Dict[str, Any] = {"type": kind, "media": media_url}
    caption_in_picture = kind == "picture" and len(caption) <= viber_api.PICTURE_CAPTION_MAX_CHARS
    if kind == "picture":
        body["text"] = caption if caption_in_picture else ""
    else:
        body["size"] = size
    if kind == "file":
        body["file_name"] = filename[:255]

    sender_name = acc.get("display_name") or acc.get("label") or "Bot"
    try:
        token = await viber_api.send_message(acc["auth_token"], viber_user_id, sender_name, acc.get("avatar_url"), body)
    except Exception as exc:
        raise _send_error(exc)
    saved = [
        await _record_outgoing(
            account_id, viber_user_id, token, user,
            text=caption if caption_in_picture and caption else None,
            media_type=kind, media_url=media_url, file_name=filename, file_size=size,
        )
    ]
    if caption and not caption_in_picture:
        saved.extend(await send_text(user, account_id, viber_user_id, caption))
    return saved


# ── Webhook (Viber -> backend) ────────────────────────────────────────────────

async def _store_incoming_media(account_id: str, viber_user_id: str, message_token: str, url: str, file_name: Optional[str]) -> Optional[str]:
    """URL media Viber gửi kèm chỉ sống 1 thời gian -> tải về lưu lại Supabase Storage."""
    try:
        data, ct = await viber_api.download(url)
    except Exception:
        logger.exception(f"[Viber {account_id}] Không tải được media của tin {message_token}")
        return url
    ct = (ct or "").split(";")[0].strip().lower() or "application/octet-stream"
    ext = ""
    if file_name and "." in file_name:
        ext = "." + file_name.rsplit(".", 1)[1].lower()
    else:
        ext = mimetypes.guess_extension(ct) or ""
    path = f"{account_id}/{_user_folder(viber_user_id)}/{message_token}{ext}"
    return await viber_repo.upload_media(path, data, ct) or url


async def _handle_message(account_id: str, event: Dict[str, Any]) -> None:
    token = str(event.get("message_token") or "")
    sender = event.get("sender") or {}
    viber_user_id = sender.get("id")
    msg = event.get("message") or {}
    if not token or not viber_user_id:
        return
    if await viber_repo.message_exists(account_id, token):
        return  # Viber gửi lại (retry) cùng 1 tin

    mtype = msg.get("type") or "text"
    text = msg.get("text") or None
    media_type: Optional[str] = None
    media_url: Optional[str] = None
    if mtype in ("picture", "video", "file", "sticker") and msg.get("media"):
        media_type = mtype
        media_url = await _store_incoming_media(account_id, viber_user_id, token, msg["media"], msg.get("file_name"))
    elif mtype == "url":
        text = msg.get("media") or text
    elif mtype == "location":
        loc = msg.get("location") or {}
        media_type = "location"
        if loc.get("lat") is not None and loc.get("lon") is not None:
            media_url = f"https://www.google.com/maps?q={loc['lat']},{loc['lon']}"
    elif mtype == "contact":
        c = msg.get("contact") or {}
        media_type = "contact"
        text = " - ".join(x for x in (c.get("name"), c.get("phone_number")) if x) or text

    row = {
        "account_id": account_id,
        "viber_user_id": viber_user_id,
        "message_token": token,
        "is_outgoing": False,
        "sender_name": sender.get("name"),
        "text": text,
        "media_type": media_type,
        "media_url": media_url,
        "file_name": msg.get("file_name"),
        "file_size": msg.get("size"),
        "status": "received",
        "sent_at": _ts_to_iso(event.get("timestamp")),
    }
    saved = await viber_repo.upsert_message(row)
    await viber_repo.touch_dialog(
        account_id,
        viber_user_id,
        name=sender.get("name"),
        avatar_url=sender.get("avatar"),
        language=sender.get("language"),
        country=sender.get("country"),
        last_message_at=row["sent_at"],
        last_message_preview=_preview(row),
        increment_unread=True,
    )
    await message_events.publish_viber_event(account_id, {"type": "message", "viber_user_id": viber_user_id, "message": saved})


async def _handle_event(account_id: str, event: Dict[str, Any]) -> None:
    kind = event.get("event")
    try:
        if kind == "message":
            await _handle_message(account_id, event)
        elif kind in ("subscribed", "conversation_started"):
            u = event.get("user") or {}
            if not u.get("id"):
                return
            await viber_repo.touch_dialog(
                account_id,
                u["id"],
                name=u.get("name"),
                avatar_url=u.get("avatar"),
                language=u.get("language"),
                country=u.get("country"),
                is_subscribed=True if kind == "subscribed" else event.get("subscribed"),
            )
            await message_events.publish_viber_event(account_id, {"type": "dialog", "viber_user_id": u["id"]})
        elif kind == "unsubscribed":
            if event.get("user_id"):
                await viber_repo.touch_dialog(account_id, event["user_id"], is_subscribed=False)
                await message_events.publish_viber_event(account_id, {"type": "dialog", "viber_user_id": event["user_id"]})
        elif kind in ("delivered", "seen", "failed"):
            token = str(event.get("message_token") or "")
            updated = await viber_repo.update_message_status(account_id, token, kind, error=event.get("desc"))
            if updated:
                await message_events.publish_viber_event(
                    account_id, {"type": "status", "viber_user_id": updated.get("viber_user_id"), "message": updated}
                )
    except Exception:
        logger.exception(f"[Viber {account_id}] Lỗi xử lý webhook event={kind}")


async def handle_webhook(account_id: str, raw_body: bytes, signature: Optional[str]) -> None:
    acc = await viber_repo.get_account(account_id)
    if not acc:
        raise HTTPException(404, "Unknown Viber account")
    if not viber_api.verify_signature(acc["auth_token"], raw_body, signature):
        raise HTTPException(401, "Invalid Viber signature")
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid body")
    if event.get("event") == "webhook":
        return
    # Trả 200 ngay cho Viber (nó retry nếu phản hồi chậm), phần tải media/ghi DB chạy nền.
    task = asyncio.create_task(_handle_event(account_id, event))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
