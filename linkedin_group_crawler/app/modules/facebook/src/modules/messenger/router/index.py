"""FastAPI Router cho Facebook Messenger API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hmac
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.facebook.src.modules.messenger.schemas.messenger_schema import (
    ConnectAccountRequest,
    SendMessageRequest,
    UnfreezeAccountRequest,
    MessengerBaseResponse,
)
from app.modules.facebook.src.modules.messenger.services import bridge_client
from app.modules.facebook.src.modules.messenger.services.fb_messenger_service import FbMessengerService
from app.modules.facebook.src.modules.messenger.services.fb_realtime_listener import (
    FbRealtimeListener,
    messenger_event_bus,
)

logger = logging.getLogger("fb_messenger.router")

# Mọi endpoint Messenger (kể cả SSE /events, /webhook/sync) yêu cầu đăng nhập (cookie hoặc Bearer).
messenger_router = APIRouter(prefix="", tags=["Facebook Messenger"], dependencies=[Depends(get_current_user)])
router = messenger_router

# Router riêng cho messenger-bridge gọi webhook về (xác thực bằng X-Bridge-Key, không qua get_current_user).
messenger_bridge_webhook_router = APIRouter(prefix="", tags=["Facebook Messenger Bridge"])


@messenger_router.get("/accounts", response_model=MessengerBaseResponse)
def get_messenger_accounts(
    email: Optional[str] = Query(None, description="Email người dùng gọi API"),
) -> MessengerBaseResponse:
    """Lấy danh sách tài khoản Facebook Messenger kết nối trong hệ thống."""
    sb = get_supabase_client()
    try:
        q = sb.table("fb_messenger_accounts").select(
            "id, fb_user_id, name, avatar_url, status, warm_up_tier, daily_sent_count, daily_sent_limit, last_sent_at, frozen_until, checkpoint_reason, is_active, is_shared_with_all, created_at, updated_at"
        ).eq("is_active", True)

        res = q.order("created_at", desc=True).execute()
        return MessengerBaseResponse(success=True, data=res.data or [])
    except Exception as e:
        logger.exception(f"Error fetching fb_messenger_accounts: {e}")
        return MessengerBaseResponse(success=False, message=str(e), data=[])


@messenger_router.post("/accounts", response_model=MessengerBaseResponse)
def connect_messenger_account(payload: ConnectAccountRequest) -> MessengerBaseResponse:
    """Thêm mới hoặc cập nhật tài khoản Messenger qua Cookie."""
    res = FbMessengerService.connect_account(
        cookie_str=payload.cookie,
        name=payload.name,
        proxy_url=payload.proxy_url,
        user_agent=payload.user_agent,
        fb_user_id=payload.fb_user_id,
        is_shared_with_all=payload.is_shared_with_all or False,
    )
    return MessengerBaseResponse(
        success=res.get("success", False),
        message=res.get("message", ""),
        data=res.get("data"),
    )


@messenger_router.delete("/accounts/{account_id}", response_model=MessengerBaseResponse)
def delete_messenger_account(account_id: str) -> MessengerBaseResponse:
    """Xóa / ngắt kết nối tài khoản Messenger."""
    sb = get_supabase_client()
    try:
        sb.table("fb_messenger_accounts").update({"is_active": False}).eq("id", account_id).execute()
        if bridge_client.is_enabled():
            bridge_client.disconnect(account_id)
        return MessengerBaseResponse(success=True, message="Đã xóa tài khoản Messenger thành công.")
    except Exception as e:
        return MessengerBaseResponse(success=False, message=str(e))


@messenger_router.post("/accounts/{account_id}/unfreeze", response_model=MessengerBaseResponse)
def unfreeze_messenger_account(account_id: str) -> MessengerBaseResponse:
    """Mở đóng băng thủ công cho tài khoản bị Circuit Breaker ngắt."""
    sb = get_supabase_client()
    try:
        sb.table("fb_messenger_accounts").update({
            "status": "connected",
            "frozen_until": None,
            "checkpoint_reason": "Mở đóng băng thủ công bởi Admin",
        }).eq("id", account_id).execute()
        return MessengerBaseResponse(success=True, message="Đã rã đông tài khoản thành công.")
    except Exception as e:
        return MessengerBaseResponse(success=False, message=str(e))


@messenger_router.get("/threads", response_model=MessengerBaseResponse)
def get_messenger_threads(
    account_id: str = Query(..., description="ID tài khoản gửi tin"),
    limit: int = Query(50, ge=1, le=100),
) -> MessengerBaseResponse:
    """Lấy danh sách các cuộc trò chuyện Messenger theo tài khoản."""
    sb = get_supabase_client()
    try:
        res = (
            sb.table("fb_messenger_threads")
            .select("*")
            .eq("account_id", account_id)
            .order("last_message_at", desc=True)
            .limit(limit)
            .execute()
        )
        return MessengerBaseResponse(success=True, data=res.data or [])
    except Exception as e:
        logger.exception(f"Error fetching threads: {e}")
        return MessengerBaseResponse(success=False, message=str(e), data=[])


@messenger_router.get("/threads/{thread_id}/messages", response_model=MessengerBaseResponse)
def get_thread_messages(
    thread_id: str,
    account_id: str = Query(..., description="ID tài khoản gửi tin"),
    limit: int = Query(50, ge=1, le=100),
) -> MessengerBaseResponse:
    """Lấy danh sách tin nhắn chi tiết trong một cuộc trò chuyện."""
    sb = get_supabase_client()
    try:
        res = (
            sb.table("fb_messenger_messages")
            .select("*")
            .eq("thread_id", thread_id)
            .eq("account_id", account_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        # Sắp xếp lại theo thứ tự thời gian tăng dần để UI render từ trên xuống
        messages = list(reversed(res.data or []))
        return MessengerBaseResponse(success=True, data=messages)
    except Exception as e:
        logger.exception(f"Error fetching messages: {e}")
        return MessengerBaseResponse(success=False, message=str(e), data=[])


@messenger_router.post("/send", response_model=MessengerBaseResponse)
async def send_messenger_message(payload: SendMessageRequest) -> MessengerBaseResponse:
    """Gửi tin nhắn Messenger mô phỏng 5 bước nhịp sinh học người thật."""
    res = await FbMessengerService.send_message_human_like(
        account_id=payload.account_id,
        recipient_id=payload.recipient_id,
        content=payload.content or "",
        recipient_name=payload.recipient_name,
        recipient_avatar=payload.recipient_avatar,
        attachments=payload.attachments,
        simulate_human=payload.simulate_human if payload.simulate_human is not None else True,
    )
    return MessengerBaseResponse(
        success=res.get("success", False),
        message=res.get("message", ""),
        data=res.get("data"),
    )


@messenger_router.post("/upload", response_model=MessengerBaseResponse)
async def upload_messenger_media(
    file: UploadFile = File(...),
    account_id: Optional[str] = Form(None),
) -> MessengerBaseResponse:
    """Tải lên hình ảnh hoặc tài liệu đính kèm cho tin nhắn Messenger."""
    try:
        from app.modules.all_platform.services.crm_attachment_service import upload_attachment
        content_type = (file.content_type or "").lower()
        raw = await file.read()
        if len(raw) > 25 * 1024 * 1024:
            return MessengerBaseResponse(success=False, message="File quá lớn (tối đa 25MB).")

        filename = file.filename or "attachment"
        url, err = upload_attachment(
            prefix="messenger",
            customer_id=account_id or "general",
            filename=filename,
            content=raw,
            content_type=content_type,
        )
        if err:
            return MessengerBaseResponse(success=False, message=err)

        kind = "image" if content_type.startswith("image/") else "file"
        return MessengerBaseResponse(
            success=True,
            message="Tải tệp lên thành công",
            data={
                "url": url,
                "name": filename,
                "size": len(raw),
                "mime_type": content_type,
                "kind": kind,
            },
        )
    except Exception as e:
        logger.exception(f"Error uploading messenger media: {e}")
        return MessengerBaseResponse(success=False, message=str(e))



@messenger_router.get("/events")
async def stream_messenger_events(request: Request) -> StreamingResponse:
    """Server-Sent Events (SSE) Bus cho Facebook Messenger.

    Phát tin nhắn mới (chiều nhận) và tin nhắn echo (chiều gửi từ điện thoại) tức thì trong 0ms.
    """
    return StreamingResponse(
        messenger_event_bus.stream(request, heartbeat_seconds=15.0),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@messenger_router.post("/webhook/sync", response_model=MessengerBaseResponse)
async def webhook_incoming_messenger_message(payload: dict) -> MessengerBaseResponse:
    """Webhook đồng bộ tin nhắn từ Extension Chrome hoặc thiết bị di động."""
    account_id = payload.get("account_id")
    sender_id = payload.get("sender_id")
    recipient_id = payload.get("recipient_id")
    content = payload.get("content", "")
    is_self = payload.get("is_self", False)
    is_echo = payload.get("is_echo", False)
    sender_name = payload.get("sender_name")
    recipient_name = payload.get("recipient_name")
    attachments = payload.get("attachments")

    # Extension đọc danh sách chat trên facebook.com/messages: gửi fb_user_id (nick đang mở) + thread_id
    # thay vì account_id/sender_id/recipient_id. Chat E2EE không đọc được ở server nên chỉ có nguồn này.
    fb_user_id = str(payload.get("fb_user_id") or "").strip()
    thread_id = str(payload.get("thread_id") or "").strip()
    if fb_user_id and thread_id:
        sb = get_supabase_client()
        acc = sb.table("fb_messenger_accounts").select("id").eq("fb_user_id", fb_user_id).eq("is_active", True).limit(1).execute()
        if not acc.data:
            raise HTTPException(status_code=404, detail="Nick Facebook này chưa được kết nối trong Hộp thư Messenger")
        account_id = acc.data[0]["id"]
        sender_id, recipient_id = (fb_user_id, thread_id) if is_self else (thread_id, fb_user_id)
        if is_self:
            recipient_name = recipient_name or payload.get("peer_name")
        else:
            sender_name = sender_name or payload.get("peer_name")
        # shortcut: chỉ so với tin cuối của thread (extension gửi lại snapshot mỗi lần quét) — 2 tin giống hệt liên tiếp sẽ bị gộp.
        last = sb.table("fb_messenger_threads").select("last_message").eq("account_id", account_id).eq("thread_id", thread_id).limit(1).execute()
        if last.data and (last.data[0].get("last_message") or "") == (content or ""):
            return MessengerBaseResponse(success=True, message="duplicate", data=None)

    if not account_id or not sender_id or not recipient_id:
        raise HTTPException(status_code=400, detail="Thiếu account_id, sender_id hoặc recipient_id")

    saved = await FbRealtimeListener.process_incoming_payload(
        account_id=account_id,
        sender_id=sender_id,
        recipient_id=recipient_id,
        content=content,
        is_self=is_self,
        is_echo=is_echo,
        sender_name=sender_name,
        recipient_name=recipient_name,
        attachments=attachments,
    )
    return MessengerBaseResponse(success=True, message="Đã đồng bộ tin nhắn thành công", data=saved)


@messenger_bridge_webhook_router.post("/webhook/bridge", response_model=MessengerBaseResponse)
async def webhook_messenger_bridge(
    payload: dict,
    x_bridge_key: Optional[str] = Header(default=None, alias="X-Bridge-Key"),
) -> MessengerBaseResponse:
    """Webhook nhận sự kiện tin nhắn và trạng thái từ dịch vụ Go messenger-bridge."""
    provided_key = x_bridge_key if isinstance(x_bridge_key, str) else ""
    expected_key = (settings.messenger_bridge_key or "").strip()
    if (
        not bridge_client.is_enabled()
        or not provided_key
        or not expected_key
        or not hmac.compare_digest(provided_key.encode("utf-8"), expected_key.encode("utf-8"))
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Bridge-Key")

    event_type = str(payload.get("type") or "").strip()
    account_id = str(payload.get("account_id") or "").strip()
    sb = get_supabase_client()

    if event_type == "status":
        status_val = str(payload.get("status") or "").strip()
        error_val = payload.get("error")
        allowed_statuses = {"connected", "disconnected", "checkpoint", "expired"}
        if not account_id or status_val not in allowed_statuses:
            return MessengerBaseResponse(success=True)

        now_utc = datetime.now(timezone.utc)
        acc_res = (
            sb.table("fb_messenger_accounts")
            .select("status, frozen_until")
            .eq("id", account_id)
            .limit(1)
            .execute()
        )
        if acc_res.data:
            cur = acc_res.data[0]
            if cur.get("status") == "frozen" and status_val in ("connected", "disconnected"):
                frozen_until_str = cur.get("frozen_until")
                if frozen_until_str:
                    try:
                        frozen_until = datetime.fromisoformat(
                            str(frozen_until_str).replace("Z", "+00:00")
                        )
                        if frozen_until.tzinfo is None:
                            frozen_until = frozen_until.replace(tzinfo=timezone.utc)
                        if frozen_until > now_utc:
                            return MessengerBaseResponse(success=True)
                    except Exception:
                        pass

        sb.table("fb_messenger_accounts").update(
            {
                "status": status_val,
                "checkpoint_reason": error_val,
                "updated_at": now_utc.isoformat(),
            }
        ).eq("id", account_id).execute()
        return MessengerBaseResponse(success=True)

    if event_type == "message":
        peer_id = str(payload.get("peer_id") or "").strip()
        if not account_id or not peer_id:
            raise HTTPException(status_code=400, detail="Thiếu account_id hoặc peer_id")
        peer_name = payload.get("peer_name")
        message_id = str(payload.get("message_id") or "").strip() or None
        text = payload.get("text") or ""
        is_self = bool(payload.get("is_self", False))
        timestamp_ms = payload.get("timestamp_ms")
        attachments = payload.get("attachments")

        created_at: Optional[str] = None
        if timestamp_ms is not None:
            try:
                created_at = datetime.fromtimestamp(
                    float(timestamp_ms) / 1000.0, tz=timezone.utc
                ).isoformat()
            except Exception:
                created_at = None

        # 1. Dedupe theo (account_id, fb_message_id)
        if message_id:
            dup_res = (
                sb.table("fb_messenger_messages")
                .select("id")
                .eq("account_id", account_id)
                .eq("fb_message_id", message_id)
                .limit(1)
                .execute()
            )
            if dup_res.data:
                return MessengerBaseResponse(success=True, message="duplicate")

        # 2. Nếu is_self=True và có dòng vừa gửi (trong 2 phút gần nhất) cùng thread, cùng nội dung
        #    mà fb_message_id đang NULL -> cập nhật fb_message_id thay vì chèn dòng mới (echo)
        if is_self and message_id and peer_id:
            cutoff_dt = datetime.now(timezone.utc) - timedelta(minutes=2)
            recent_res = (
                sb.table("fb_messenger_messages")
                .select("id, content, fb_message_id, created_at, is_self")
                .eq("account_id", account_id)
                .eq("thread_id", peer_id)
                .eq("is_self", True)
                .order("created_at", desc=True)
                .limit(10)
                .execute()
            )
            for row in recent_res.data or []:
                if (
                    row.get("fb_message_id") is None
                    and (row.get("content") or "") == (text or "")
                ):
                    raw_created = row.get("created_at")
                    in_window = True
                    if raw_created:
                        try:
                            row_dt = datetime.fromisoformat(
                                str(raw_created).replace("Z", "+00:00")
                            )
                            if row_dt.tzinfo is None:
                                row_dt = row_dt.replace(tzinfo=timezone.utc)
                            in_window = row_dt >= cutoff_dt
                        except Exception:
                            in_window = False
                    if in_window:
                        sb.table("fb_messenger_messages").update(
                            {"fb_message_id": message_id}
                        ).eq("id", row["id"]).execute()
                        return MessengerBaseResponse(success=True, message="updated_echo")

        # 3. Lưu tin nhắn mới qua FbRealtimeListener.process_incoming_payload
        acc_res = (
            sb.table("fb_messenger_accounts")
            .select("fb_user_id, name")
            .eq("id", account_id)
            .limit(1)
            .execute()
        )
        if not acc_res.data:
            return MessengerBaseResponse(success=True, message="unknown account")
        acc_row = acc_res.data[0]
        fb_user_id = str(acc_row.get("fb_user_id") or account_id)
        acc_name = acc_row.get("name")

        if is_self:
            sender_id = fb_user_id
            recipient_id = peer_id
            sender_name = acc_name
            recipient_name = peer_name
        else:
            sender_id = peer_id
            recipient_id = fb_user_id
            sender_name = peer_name
            # Thread name comes from recipient_name first; for inbound the "recipient" is our own nick, so leave it
            # empty and let the listener fall back to sender_name (the customer's name).
            recipient_name = None

        try:
            saved = await FbRealtimeListener.process_incoming_payload(
                account_id=account_id,
                sender_id=sender_id,
                recipient_id=recipient_id,
                content=text,
                is_self=is_self,
                is_echo=is_self,
                sender_name=sender_name,
                recipient_name=recipient_name,
                attachments=attachments,
                fb_message_id=message_id,
                created_at=created_at,
            )
            return MessengerBaseResponse(success=True, data=saved)
        except Exception:
            if message_id:
                race_res = (
                    sb.table("fb_messenger_messages")
                    .select("id")
                    .eq("account_id", account_id)
                    .eq("fb_message_id", message_id)
                    .limit(1)
                    .execute()
                )
                if race_res.data:
                    return MessengerBaseResponse(success=True, message="duplicate")
            raise

    return MessengerBaseResponse(success=True)
