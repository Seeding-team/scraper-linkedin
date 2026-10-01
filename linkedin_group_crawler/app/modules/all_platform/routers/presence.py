"""Presence (thời gian online thành viên) — heartbeat + tổng hợp cho Dashboard leader."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services.supabase_presence_service import (
    get_online_summary,
    is_member_online,
    record_heartbeat,
)

router = APIRouter()


class HeartbeatRequest(BaseModel):
    email: str


class OnlineSummaryRequest(BaseModel):
    email: str


class SelfOnlineRequest(BaseModel):
    email: str


@router.post("/heartbeat")
def presence_heartbeat(payload: HeartbeatRequest) -> BaseResponse:
    """Ping mỗi ~45s trong lúc tab đang hiển thị (xem AppAuthContext.tsx). Luôn trả
    success để KHÔNG bao giờ làm hỏng trải nghiệm người dùng vì 1 lỗi ghi nhận nhỏ."""
    try:
        data = record_heartbeat(payload.email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/online-summary")
def presence_online_summary(payload: OnlineSummaryRequest) -> BaseResponse:
    """"Thời gian online" cho Dashboard leader — admin thấy mọi thành viên, leader chỉ
    thấy team mình quản lý, member không thấy gì."""
    try:
        data = get_online_summary(payload.email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/self-online")
def presence_self_online(payload: SelfOnlineRequest) -> BaseResponse:
    """Tự kiểm tra ĐÚNG 1 tài khoản (email truyền lên) đang online hay không, không phân
    biệt role — dùng cho extension tự hỏi acc Seeding hệ thống (role member) có đang
    online không trước mỗi vòng cào xoay vòng. Khác /online-summary (chỉ trả dữ liệu cho
    admin/leader xem TEAM mình)."""
    try:
        data = is_member_online(payload.email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
