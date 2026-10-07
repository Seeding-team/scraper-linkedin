"""Viber Chat — /api/all-platform/viber/*.

``viber_user_id`` (Viber cấp, dạng base64 có thể chứa '/') luôn đi qua query/body, không
qua path. ``/webhook/{account_id}`` KHÔNG cần đăng nhập — Viber gọi tới, xác thực bằng chữ
ký HMAC ``X-Viber-Content-Signature`` (xem ``viber_service.handle_webhook``)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, Header, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.viber.services import viber_service
from app.modules.all_platform.viber.services.message_events import subscribe_viber_events

router = APIRouter()


class ConnectRequest(BaseModel):
    auth_token: str
    label: Optional[str] = None


class SendTextRequest(BaseModel):
    account_id: str
    viber_user_id: str
    text: str


# ── Accounts ──────────────────────────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    return BaseResponse(success=True, data=await viber_service.list_accounts_for_caller(user))


@router.post("/accounts/connect")
async def connect_bot(payload: ConnectRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    return BaseResponse(success=True, data=await viber_service.connect_bot(user, payload.auth_token, payload.label))


@router.post("/accounts/{account_id}/reconnect")
async def reconnect(account_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    return BaseResponse(success=True, data=await viber_service.reconnect(user, account_id))


@router.delete("/accounts/{account_id}")
async def disconnect_account(account_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    await viber_service.disconnect_account(user, account_id)
    return BaseResponse(success=True)


# ── Conversations / messages ──────────────────────────────────────────────────

@router.get("/accounts/{account_id}/dialogs")
async def list_dialogs(account_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    return BaseResponse(success=True, data=await viber_service.list_dialogs(user, account_id))


@router.get("/accounts/{account_id}/messages")
async def list_messages(
    account_id: str,
    viber_user_id: str = Query(...),
    limit: int = Query(default=50, ge=1, le=200),
    before: Optional[str] = Query(default=None, description="sent_at ISO — lấy tin cũ hơn mốc này"),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await viber_service.get_messages(user, account_id, viber_user_id, limit=limit, before=before)
    return BaseResponse(success=True, data=data)


@router.post("/messages/send")
async def send_text(payload: SendTextRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await viber_service.send_text(user, payload.account_id, payload.viber_user_id, payload.text)
    return BaseResponse(success=True, data=data)


@router.post("/messages/send-media")
async def send_media(
    account_id: str = Form(...),
    viber_user_id: str = Form(...),
    caption: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data_bytes = await file.read()
    data = await viber_service.send_media(
        user, account_id, viber_user_id, file.filename or "file", data_bytes, file.content_type, caption=caption
    )
    return BaseResponse(success=True, data=data)


# ── Realtime (SSE) ────────────────────────────────────────────────────────────

@router.get("/events/stream")
async def stream_viber_events(request: Request, user: Dict[str, Any] = Depends(get_current_user)):
    account_ids = await viber_service.resolve_account_ids_for_stream(user)

    async def event_gen():
        async for chunk in subscribe_viber_events(account_ids):
            if await request.is_disconnected():
                break
            yield chunk

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ── Webhook (Viber gọi tới, không cần đăng nhập) ──────────────────────────────

@router.post("/webhook/{account_id}")
async def viber_webhook(
    account_id: str,
    request: Request,
    x_viber_content_signature: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    raw = await request.body()
    await viber_service.handle_webhook(account_id, raw, x_viber_content_signature)
    return {"status": 0}
