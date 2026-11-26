"""WhatsApp Multi-Device authentication routes (QR code & 8-char phone pairing code)."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.whatsapp.schemas import (
    ConnectPairingRequest,
    ConnectQRRequest,
)
from app.modules.all_platform.whatsapp.services import whatsapp_service

router = APIRouter(prefix="/auth", tags=["WhatsApp Auth"])


@router.post("/connect-qr")
async def connect_qr(
    payload: ConnectQRRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.connect_qr(
        user,
        label=payload.label,
        account_id=payload.account_id,
        proxy_url=payload.proxy_url,
    )
    return BaseResponse(success=True, data=data)


@router.post("/connect-pairing")
async def connect_pairing(
    payload: ConnectPairingRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    data = await whatsapp_service.connect_pairing(
        user,
        phone_number=payload.phone_number,
        label=payload.label,
        account_id=payload.account_id,
        proxy_url=payload.proxy_url,
    )
    return BaseResponse(success=True, data=data)
