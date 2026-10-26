from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.telegram.services import telegram_service

router = APIRouter(prefix="/messages")


class SendTextRequest(BaseModel):
    account_id: str
    dialog_id: int
    text: str
    reply_to: Optional[int] = None


class EditRequest(BaseModel):
    account_id: str
    dialog_id: int
    message_id: int
    text: str


class DeleteRequest(BaseModel):
    account_id: str
    dialog_id: int
    message_id: int
    revoke: bool = True


class ForwardRequest(BaseModel):
    account_id: str
    from_dialog_id: int
    message_id: int
    to_dialog_id: int


class PinRequest(BaseModel):
    account_id: str
    dialog_id: int
    message_id: int
    unpin: bool = False


@router.post("/send")
async def send_text(payload: SendTextRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.send_text(user, payload.account_id, payload.dialog_id, payload.text, reply_to=payload.reply_to)
    return BaseResponse(success=True, data=data)


@router.post("/send-media")
async def send_media(
    account_id: str = Form(...),
    dialog_id: int = Form(...),
    caption: Optional[str] = Form(default=None),
    reply_to: Optional[int] = Form(default=None),
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data_bytes = await file.read()
    data = await telegram_service.send_media(
        user, account_id, dialog_id, file.filename or "file", data_bytes, caption=caption, reply_to=reply_to
    )
    return BaseResponse(success=True, data=data)


@router.post("/edit")
async def edit_message(payload: EditRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.edit_message(user, payload.account_id, payload.dialog_id, payload.message_id, payload.text)
    return BaseResponse(success=True, data=data)


@router.post("/delete")
async def delete_message(payload: DeleteRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    await telegram_service.delete_message(user, payload.account_id, payload.dialog_id, payload.message_id, revoke=payload.revoke)
    return BaseResponse(success=True)


@router.post("/forward")
async def forward_message(payload: ForwardRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.forward_message(user, payload.account_id, payload.from_dialog_id, payload.message_id, payload.to_dialog_id)
    return BaseResponse(success=True, data=data)


@router.post("/pin")
async def pin_message(payload: PinRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    await telegram_service.pin_message(user, payload.account_id, payload.dialog_id, payload.message_id, unpin=payload.unpin)
    return BaseResponse(success=True)
