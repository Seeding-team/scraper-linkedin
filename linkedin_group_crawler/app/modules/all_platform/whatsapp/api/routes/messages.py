"""WhatsApp rich messaging routes (text, media, location, contact, poll, react, edit, delete, forward, local media serve)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.whatsapp.schemas import (
    DeleteMessageRequest,
    EditMessageRequest,
    ForwardMessageRequest,
    ReactMessageRequest,
    SendContactRequest,
    SendLocationRequest,
    SendPollRequest,
    SendTextRequest,
)
from app.modules.all_platform.whatsapp.services import whatsapp_service

router = APIRouter(prefix="/messages", tags=["WhatsApp Messages"])


@router.post("/send")
async def send_text(
    payload: SendTextRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.send_text(
        user,
        payload.account_id,
        payload.chat_jid,
        payload.text,
        reply_to_message_id=payload.reply_to_message_id,
        quoted_text=payload.quoted_text,
        mentions=payload.mentions,
    )
    return BaseResponse(success=True, data=data)


@router.post("/send-media")
async def send_media(
    account_id: str = Form(...),
    chat_jid: str = Form(...),
    media_type: str = Form(default="document"),
    caption: Optional[str] = Form(default=None),
    reply_to_message_id: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    raw_bytes = await file.read()
    data = await whatsapp_service.send_media(
        user,
        account_id,
        chat_jid,
        filename=file.filename or "file",
        content_type=file.content_type,
        data=raw_bytes,
        media_type=media_type,
        caption=caption,
        reply_to_message_id=reply_to_message_id,
    )
    return BaseResponse(success=True, data=data)


@router.get("/media/{account_id}/{message_id}")
async def serve_local_media(
    account_id: str,
    message_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    file_path, mime, filename = await whatsapp_service.resolve_media_file(
        user, account_id, message_id
    )
    return FileResponse(path=str(file_path), media_type=mime, filename=filename)


@router.post("/send-location")
async def send_location(
    payload: SendLocationRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.send_location(
        user,
        payload.account_id,
        payload.chat_jid,
        latitude=payload.latitude,
        longitude=payload.longitude,
        name=payload.name,
        address=payload.address,
    )
    return BaseResponse(success=True, data=data)


@router.post("/send-contact")
async def send_contact(
    payload: SendContactRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.send_contact(
        user,
        payload.account_id,
        payload.chat_jid,
        contact_name=payload.contact_name,
        contact_phone=payload.contact_phone,
    )
    return BaseResponse(success=True, data=data)


@router.post("/send-poll")
async def send_poll(
    payload: SendPollRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.send_poll(
        user,
        payload.account_id,
        payload.chat_jid,
        question=payload.question,
        options=payload.options,
        selectable_count=payload.selectable_count,
    )
    return BaseResponse(success=True, data=data)


@router.post("/react")
async def react_message(
    payload: ReactMessageRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.react_message(
        user,
        payload.account_id,
        payload.chat_jid,
        payload.message_id,
        payload.emoji,
    )
    return BaseResponse(success=True, data=data)


@router.post("/edit")
async def edit_message(
    payload: EditMessageRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.edit_message(
        user,
        payload.account_id,
        payload.chat_jid,
        payload.message_id,
        payload.text,
    )
    return BaseResponse(success=True, data=data)


@router.post("/delete")
async def delete_message(
    payload: DeleteMessageRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.delete_message(
        user,
        payload.account_id,
        payload.chat_jid,
        payload.message_id,
        for_everyone=payload.for_everyone,
    )
    return BaseResponse(success=True, data=data)


@router.post("/forward")
async def forward_message(
    payload: ForwardMessageRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.forward_message(
        user,
        payload.account_id,
        payload.from_chat_jid,
        payload.message_id,
        payload.to_chat_jid,
    )
    return BaseResponse(success=True, data=data)
