"""WhatsApp Dual-Mode Call routes (Baileys signaling, Meta Cloud WebRTC, linked-device handoff & webhook)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.whatsapp.schemas import (
    AcceptCallRequest,
    OutboundCallRequest,
    RejectCallRequest,
    TerminateCallRequest,
)
from app.modules.all_platform.whatsapp.services import whatsapp_call_service

router = APIRouter(tags=["WhatsApp Calls"])


@router.get("/accounts/{account_id}/calls")
async def list_account_calls(
    account_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_call_service.list_call_logs(user, account_id, limit=limit)
    return BaseResponse(success=True, data=data)


@router.get("/calls/webhook")
async def verify_meta_webhook(
    hub_mode: Optional[str] = Query(default=None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(default=None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(default=None, alias="hub.challenge"),
):
    challenge = await whatsapp_call_service.verify_meta_webhook(
        hub_mode, hub_verify_token, hub_challenge
    )
    return PlainTextResponse(content=challenge)


@router.post("/calls/webhook")
async def receive_meta_webhook(request: Request) -> Dict[str, Any]:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    result = await whatsapp_call_service.handle_meta_webhook(payload)
    return {"success": True, **result}


@router.post("/calls/reject")
async def reject_call(
    payload: RejectCallRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_call_service.reject_call(
        user,
        payload.account_id,
        payload.call_id,
        payload.caller_jid,
        auto_reply_text=payload.auto_reply_text,
    )
    return BaseResponse(success=True, data=data)


@router.post("/calls/outbound")
async def initiate_outbound_call(
    payload: OutboundCallRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_call_service.initiate_outbound_call(
        user,
        payload.account_id,
        chat_jid=payload.chat_jid,
        target_phone=payload.target_phone,
        is_video=payload.is_video,
        sdp_offer=payload.sdp_offer,
    )
    return BaseResponse(success=True, data=data)


@router.post("/calls/{call_id}/accept")
async def accept_inbound_call(
    call_id: str,
    payload: AcceptCallRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_call_service.accept_inbound_call(
        user,
        payload.account_id,
        call_id,
        payload.sdp_answer,
    )
    return BaseResponse(success=True, data=data)


@router.post("/calls/{call_id}/terminate")
async def terminate_call(
    call_id: str,
    payload: TerminateCallRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_call_service.terminate_call(
        user,
        payload.account_id,
        call_id,
    )
    return BaseResponse(success=True, data=data)
