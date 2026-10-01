"""API cho "nhiệm vụ comment seeding tự động" (bảng auto_seeding_comments, migration 160) —
tạo tự động khi lead_score_service.py chấm 1 bài Facebook >=70. Frontend poll GET / để biết
nhiệm vụ nào đang chờ, gọi thẳng extension để comment thật, rồi mark-posted/mark-failed.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.modules.all_platform.schemas.common import BaseResponse
from app.modules.all_platform.services.auto_seeding_comment_service import (
    list_pending,
    mark_posted,
    mark_failed,
)

router = APIRouter()


@router.get("/")
def list_comments(limit: int = 50) -> BaseResponse:
    try:
        data = list_pending(limit)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class MarkPostedRequest(BaseModel):
    link_comment: str = ""


@router.post("/{comment_id}/mark-posted")
def mark_posted_endpoint(comment_id: str, payload: MarkPostedRequest) -> BaseResponse:
    try:
        data = mark_posted(comment_id, payload.link_comment)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


class MarkFailedRequest(BaseModel):
    error_message: str = ""


@router.post("/{comment_id}/mark-failed")
def mark_failed_endpoint(comment_id: str, payload: MarkFailedRequest) -> BaseResponse:
    try:
        data = mark_failed(comment_id, payload.error_message)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
