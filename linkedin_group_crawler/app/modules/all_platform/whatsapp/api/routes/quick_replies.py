"""WhatsApp quick reply template CRUD routes."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.whatsapp.schemas import (
    CreateQuickReplyRequest,
    UpdateQuickReplyRequest,
)
from app.modules.all_platform.whatsapp.services import whatsapp_service

router = APIRouter(prefix="/quick-replies", tags=["WhatsApp Quick Replies"])


@router.get("")
async def list_quick_replies(
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.list_quick_replies(user)
    return BaseResponse(success=True, data=data)


@router.post("")
async def create_quick_reply(
    payload: CreateQuickReplyRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.create_quick_reply(user, payload)
    return BaseResponse(success=True, data=data)


@router.patch("/{reply_id}")
async def update_quick_reply(
    reply_id: str,
    payload: UpdateQuickReplyRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.update_quick_reply(user, reply_id, payload)
    return BaseResponse(success=True, data=data)


@router.delete("/{reply_id}")
async def delete_quick_reply(
    reply_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    await whatsapp_service.delete_quick_reply(user, reply_id)
    return BaseResponse(success=True, message="Đã xoá mẫu tin nhắn nhanh.")
