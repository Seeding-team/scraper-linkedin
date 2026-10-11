from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.telegram.services import telegram_service

router = APIRouter(prefix="/accounts")


@router.get("/{account_id}/dialogs")
async def list_dialogs(
    account_id: str,
    refresh: bool = Query(default=False, description="True = đồng bộ lại từ Telegram thay vì đọc cache DB"),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await telegram_service.list_dialogs(user, account_id, refresh=refresh)
    return BaseResponse(success=True, data=data)


@router.get("/{account_id}/dialogs/{dialog_id}/messages")
async def list_messages(
    account_id: str,
    dialog_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    before_message_id: Optional[int] = Query(default=None),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await telegram_service.get_messages(user, account_id, dialog_id, limit=limit, before_message_id=before_message_id)
    return BaseResponse(success=True, data=data)
