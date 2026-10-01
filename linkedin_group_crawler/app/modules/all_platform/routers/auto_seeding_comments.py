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
from app.modules.all_platform.websocket import manager

router = APIRouter()

_CATEGORY_LABEL = {
    "website": "tìm đơn vị làm website",
    "app": "tìm đơn vị làm app",
    "landing_page": "tìm đơn vị làm landing page",
    "software": "tìm đơn vị làm phần mềm",
    "other": "tìm đơn vị hỗ trợ kỹ thuật",
}


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
async def mark_posted_endpoint(comment_id: str, payload: MarkPostedRequest) -> BaseResponse:
    try:
        data = mark_posted(comment_id, payload.link_comment)
        if data:
            # Thong bao cho ca team biet he thong vua tu dong seeding 1 binh luan (yeu cau
            # 2026-10-02: "de cac tai khoan member biet ... thay duoc he thong da seeding
            # cai gi") - KHONG gan involved_users de moi nguoi dang mo app deu thay, khong
            # chi rieng nguoi cao bai.
            need_category = data.get("need_category")
            group_name = data.get("group_name") or "(không rõ nhóm)"
            lead_score = data.get("lead_score")
            await manager.broadcast({
                "event": "auto_seeding_comment_posted",
                "platform": "facebook",
                "group_name": group_name,
                "lead_score": lead_score,
                "need_category": need_category,
                "post_url": data.get("post_url"),
                "link_comment": data.get("link_comment"),
                "message": (
                    f"🤖 Hệ thống vừa tự động seeding 1 bình luận (bài {_CATEGORY_LABEL.get(need_category, 'tiềm năng')}, "
                    f"điểm AI {lead_score}) vào nhóm \"{group_name}\""
                ),
            })
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
