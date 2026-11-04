"""Đăng nhập Telegram: số điện thoại + OTP (+ mật khẩu 2 lớp nếu tài khoản đó bật), hoặc
bot token. Mỗi bước trả về ``status`` để FE biết hiển thị ô nhập tiếp theo (mã, hoặc mật
khẩu 2FA) hay đã xong."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.telegram.services import telegram_service

router = APIRouter(prefix="/auth")


class SendCodeRequest(BaseModel):
    phone: str


class VerifyCodeRequest(BaseModel):
    account_id: str
    code: str


class VerifyPasswordRequest(BaseModel):
    account_id: str
    password: str


class BotLoginRequest(BaseModel):
    bot_token: str
    label: Optional[str] = None


@router.post("/send-code")
async def send_code(payload: SendCodeRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.send_code(user, payload.phone)
    return BaseResponse(success=True, data=data)


@router.post("/verify-code")
async def verify_code(payload: VerifyCodeRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.verify_code(user, payload.account_id, payload.code)
    return BaseResponse(success=True, data=data)


@router.post("/verify-password")
async def verify_password(payload: VerifyPasswordRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.verify_password(user, payload.account_id, payload.password)
    return BaseResponse(success=True, data=data)


@router.post("/bot-login")
async def bot_login(payload: BotLoginRequest, user: Dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    data = await telegram_service.bot_login(user, payload.bot_token, payload.label)
    return BaseResponse(success=True, data=data)
