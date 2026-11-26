"""WhatsApp account lifecycle, status, and Cloud Calling API settings routes."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.whatsapp.schemas import UpdateAccountSettingsRequest
from app.modules.all_platform.whatsapp.services import whatsapp_service

router = APIRouter(prefix="/accounts", tags=["WhatsApp Accounts"])


@router.get("")
async def list_accounts(
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.list_accounts_for_caller(user)
    return BaseResponse(success=True, data=data)


@router.get("/{account_id}/status")
async def get_account_status(
    account_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.get_account_status(user, account_id)
    return BaseResponse(success=True, data=data)


@router.patch("/{account_id}/settings")
async def update_account_settings(
    account_id: str,
    payload: UpdateAccountSettingsRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.update_account_settings(user, account_id, payload)
    return BaseResponse(success=True, data=data)


@router.post("/{account_id}/reconnect")
async def reconnect_account(
    account_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.reconnect_account(user, account_id)
    return BaseResponse(success=True, data=data)


@router.delete("/{account_id}")
async def disconnect_account(
    account_id: str,
    logout: bool = Query(
        default=False,
        description="True = đăng xuất khỏi Linked Devices trên WhatsApp và xoá thư mục auth; False = chỉ gỡ khỏi CRM",
    ),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    await whatsapp_service.disconnect_account(user, account_id, logout=logout)
    return BaseResponse(success=True, message="Đã ngắt kết nối tài khoản WhatsApp.")
