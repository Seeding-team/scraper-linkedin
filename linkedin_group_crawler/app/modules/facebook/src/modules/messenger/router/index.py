"""FastAPI Router cho Facebook Messenger API."""

from __future__ import annotations

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Header

from app.core.supabase_client import get_supabase_client
from app.modules.facebook.src.modules.messenger.schemas.messenger_schema import (
    ConnectAccountRequest,
    SendMessageRequest,
    UnfreezeAccountRequest,
    MessengerBaseResponse,
)
from app.modules.facebook.src.modules.messenger.services.fb_messenger_service import FbMessengerService

logger = logging.getLogger("fb_messenger.router")

messenger_router = APIRouter(prefix="/messenger", tags=["Facebook Messenger"])


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
        content=payload.content,
        recipient_name=payload.recipient_name,
        recipient_avatar=payload.recipient_avatar,
        simulate_human=payload.simulate_human if payload.simulate_human is not None else True,
    )
    return MessengerBaseResponse(
        success=res.get("success", False),
        message=res.get("message", ""),
        data=res.get("data"),
    )
