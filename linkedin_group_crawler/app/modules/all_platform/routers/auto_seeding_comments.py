"""API cho "nhiệm vụ comment seeding tự động" (bảng auto_seeding_comments, migration 160) —
tạo tự động khi lead_score_service.py chấm 1 bài Facebook >=70. Frontend poll GET / để biết
nhiệm vụ nào đang chờ, gọi thẳng extension để comment thật, rồi mark-posted/mark-failed.
"""

from __future__ import annotations

from typing import Optional

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


class RetryZaloRequest(BaseModel):
    contact_phone: str
    need_category: Optional[str] = None


@router.post("/{comment_id}/retry-zalo")
async def retry_zalo_endpoint(comment_id: str, payload: RetryZaloRequest) -> BaseResponse:
    """Thử lại (hoặc kích hoạt lần đầu) nhánh tư vấn Zalo cho 1 nhiệm vụ đã có (migration
    161) — dùng khi bài được chấm điểm TRƯỚC lúc tính năng Zalo deploy (chưa có
    contact_phone), hoặc khi lần gửi trước zalo_status='failed' do lỗi tạm thời. Lưu
    phone_number TRƯỚC khi thử gửi — card hiển thị đúng SĐT ngay cả khi lần gửi này vẫn lỗi."""
    from app.core.phone import vn_phone_to_e164
    from app.core.supabase_client import get_supabase_client
    from app.modules.all_platform.services.auto_seeding_zalo_service import maybe_send_zalo_consult

    e164 = vn_phone_to_e164(payload.contact_phone)
    if not e164:
        return BaseResponse(success=False, message="SĐT không hợp lệ.")
    try:
        supabase = get_supabase_client()
        existing = supabase.table("auto_seeding_comments").select("need_category").eq("id", comment_id).limit(1).execute()
        if not existing.data:
            return BaseResponse(success=False, message="Không tìm thấy nhiệm vụ seeding này.")
        need_category = payload.need_category or existing.data[0].get("need_category")
        supabase.table("auto_seeding_comments").update({"phone_number": e164}).eq("id", comment_id).execute()
        await maybe_send_zalo_consult(comment_id=comment_id, contact_phone=e164, need_category=need_category)
        data = supabase.table("auto_seeding_comments").select("*").eq("id", comment_id).limit(1).execute()
        return BaseResponse(success=True, data=data.data[0] if data.data else None)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
