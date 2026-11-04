"""Seeding YouTube — liên kết kênh, mở phiên comment, extension báo đã comment để tính KPI.

Xem mô tả luồng đầy đủ ở `services/youtube_seeding_service.py`.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from app.core.logger import get_logger
from app.modules.all_platform.routers.social_accounts import _get_user_from_header
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services.youtube_seeding_service import (
    create_comment_session,
    link_youtube_channel,
    report_comment,
)

logger = get_logger(__name__)

router = APIRouter()


class LinkChannelRequest(BaseModel):
    channel_id: Optional[str] = Field(None, max_length=64)
    handle: Optional[str] = Field(None, max_length=120)
    name: Optional[str] = Field(None, max_length=255)


class CommentSessionRequest(BaseModel):
    post_id: str
    id_social_account: str


class CommentReportRequest(BaseModel):
    token: str
    content: Optional[str] = Field(None, max_length=10000)
    link_comment: Optional[str] = Field(None, max_length=1000)
    detected_channel_id: Optional[str] = Field(None, max_length=64)
    detected_handle: Optional[str] = Field(None, max_length=120)
    detected_name: Optional[str] = Field(None, max_length=255)


@router.post("/link-channel")
async def link_channel(
    payload: LinkChannelRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Lưu kênh YouTube (extension nhận diện trên trình duyệt) thành tài khoản seeding của người dùng."""
    user = _get_user_from_header(authorization, request)
    try:
        data = await asyncio.to_thread(
            link_youtube_channel,
            user_id=user["id"],
            channel_id=payload.channel_id,
            handle=payload.handle,
            name=payload.name,
        )
        message = "Kênh này đã được liên kết từ trước — đã cập nhật lại thông tin." if data.get("already_linked") else "Đã liên kết kênh YouTube."
        return BaseResponse(success=True, message=message, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        logger.exception("[YOUTUBE-SEEDING] Lỗi liên kết kênh")
        return BaseResponse(success=False, message=str(e))


@router.post("/comment-session")
async def comment_session(
    payload: CommentSessionRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Tạo phiên comment (token) cho 1 video + 1 kênh đã liên kết — extension dùng token này để báo KPI."""
    user = _get_user_from_header(authorization, request)
    try:
        data = await asyncio.to_thread(
            create_comment_session,
            user=user,
            post_id=payload.post_id,
            social_account_id=payload.id_social_account,
        )
        return BaseResponse(success=True, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        logger.exception("[YOUTUBE-SEEDING] Lỗi tạo phiên comment")
        return BaseResponse(success=False, message=str(e))


@router.post("/comment-report")
async def comment_report(payload: CommentReportRequest) -> BaseResponse:
    """Extension báo nhân viên đã bấm "Bình luận" và comment đã hiện trên YouTube.

    Không cần cookie đăng nhập (gọi từ service worker của extension): danh tính lấy từ token
    phiên comment đã ký, KHÔNG tin email/tài khoản nào extension tự gửi lên.
    """
    try:
        data = await asyncio.to_thread(
            report_comment,
            token=payload.token,
            content=payload.content,
            link_comment=payload.link_comment,
            detected_channel_id=payload.detected_channel_id,
            detected_handle=payload.detected_handle,
            detected_name=payload.detected_name,
        )
        if not data.get("counted"):
            return BaseResponse(success=False, message=data.get("reason") or "Chưa tính KPI.", data=data)
        return BaseResponse(success=True, message="Đã ghi nhận comment và tính KPI.", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        logger.exception("[YOUTUBE-SEEDING] Lỗi ghi nhận comment")
        return BaseResponse(success=False, message=str(e))
