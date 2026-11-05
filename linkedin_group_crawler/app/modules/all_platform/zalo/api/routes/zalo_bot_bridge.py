"""Endpoint để n8n (workflow "Seeding Zalo - Outgoing") gửi câu trả lời của bot ra Zalo.

Bảo vệ bằng secret dùng chung `ZALO_BOT_SHARED_SECRET` (header `x-api-key`). Không set
secret -> endpoint từ chối hết (không mở), vì endpoint này gửi tin Zalo thật."""

import hmac
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.modules.all_platform.zalo.services.zalo_chatwoot_bridge import send_outbound_message

router = APIRouter(prefix="/zalo-bot", tags=["zalo-bot-bridge"])


class BotSendMessage(BaseModel):
    zaloAccountId: str
    zaloUserId: str
    content: str = Field(min_length=1, max_length=4000)
    threadType: Optional[str] = "user"
    senderType: Optional[str] = None  # Chatwoot sender.type: 'agent_bot' (bot) | 'user' (nhân viên)


@router.post("/send-message")
async def bot_send_message(body: BotSendMessage, x_api_key: Optional[str] = Header(default=None)):
    secret = os.getenv("ZALO_BOT_SHARED_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="ZALO_BOT_SHARED_SECRET chưa cấu hình")
    if not x_api_key or not hmac.compare_digest(x_api_key, secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    if (body.threadType or "user").lower() == "group":
        return {"status": "skipped", "reason": "bot chỉ gửi hội thoại 1-1"}
    try:
        return await send_outbound_message(
            body.zaloAccountId, body.zaloUserId, body.content, sender_type=body.senderType,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
