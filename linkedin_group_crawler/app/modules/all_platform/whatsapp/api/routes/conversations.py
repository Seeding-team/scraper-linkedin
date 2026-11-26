"""WhatsApp conversation list, sync, start-chat, read/typing, group metadata, and message timeline routes."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.whatsapp.schemas import (
    StartChatRequest,
    TypingPresenceRequest,
    UpdateConversationRequest,
)
from app.modules.all_platform.whatsapp.services import whatsapp_service

router = APIRouter(prefix="/accounts", tags=["WhatsApp Conversations"])


@router.get("/{account_id}/conversations")
async def list_conversations(
    account_id: str,
    search: Optional[str] = Query(default=None),
    filter: str = Query(
        default="all",
        description="all|unread|groups|direct|pinned|archived",
    ),
    limit: int = Query(default=100, ge=1, le=500),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.list_conversations(
        user,
        account_id,
        search=search,
        filter_mode=filter,
        limit=limit,
    )
    return BaseResponse(success=True, data=data)


@router.post("/{account_id}/conversations/sync")
async def sync_conversations(
    account_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.sync_conversations(user, account_id)
    return BaseResponse(success=True, data=data)


@router.post("/{account_id}/conversations/start-chat")
async def start_chat(
    account_id: str,
    payload: StartChatRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.start_chat(user, account_id, payload.phone_number)
    return BaseResponse(success=True, data=data)


@router.get("/{account_id}/conversations/{chat_jid}/messages")
async def list_messages(
    account_id: str,
    chat_jid: str,
    limit: int = Query(default=60, ge=1, le=200),
    before_ts: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.list_messages(
        user,
        account_id,
        chat_jid,
        limit=limit,
        before_ts=before_ts,
    )
    return BaseResponse(success=True, data=data)


@router.post("/{account_id}/conversations/{chat_jid}/read")
async def mark_conversation_read(
    account_id: str,
    chat_jid: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.mark_conversation_read(user, account_id, chat_jid)
    return BaseResponse(success=True, data=data)


@router.patch("/{account_id}/conversations/{chat_jid}")
async def update_conversation(
    account_id: str,
    chat_jid: str,
    payload: UpdateConversationRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.update_conversation(user, account_id, chat_jid, payload)
    return BaseResponse(success=True, data=data)


@router.post("/{account_id}/conversations/{chat_jid}/typing")
async def send_typing(
    account_id: str,
    chat_jid: str,
    payload: TypingPresenceRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.send_typing(user, account_id, chat_jid, payload.state)
    return BaseResponse(success=True, data=data)


@router.get("/{account_id}/conversations/{chat_jid}/group-info")
async def get_group_info(
    account_id: str,
    chat_jid: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.get_group_info(user, account_id, chat_jid)
    return BaseResponse(success=True, data=data)
