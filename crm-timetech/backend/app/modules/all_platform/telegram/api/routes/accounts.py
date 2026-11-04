from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.telegram.services import telegram_service

router = APIRouter(prefix="/accounts")


@router.get("")
async def list_accounts(user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.list_accounts_for_caller(user)
    return BaseResponse(success=True, data=data)


@router.delete("/{account_id}")
async def disconnect_account(
    account_id: str,
    revoke: bool = Query(default=False, description="True = đăng xuất hẳn khỏi Telegram (huỷ session), False = chỉ gỡ khỏi tool"),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    await telegram_service.disconnect_account(user, account_id, revoke=revoke)
    return BaseResponse(success=True)
