"""Router for Post Call Result (Kết quả liên hệ) endpoints.

Mounted at prefix "/posts" in router.py.
"""

from __future__ import annotations

from typing import Any, Optional
from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.post_call_result import PostCallResultUpdate
from app.modules.all_platform.services.post_call_result_service import (
    get_call_result,
    get_call_result_stats,
    update_call_result,
)

router = APIRouter()


def _error(exc: Exception) -> BaseResponse:
    return BaseResponse(success=False, message=str(exc))


@router.get("/call-results/stats")
def get_post_call_result_stats(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD, giờ VN. Mặc định 30 ngày trước date_to."),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD, giờ VN. Mặc định hôm nay."),
    platform: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None, description="Chỉ admin/leader dùng để lọc theo 1 thành viên."),
    result_code: Optional[str] = Query(None, description="Lọc by_member/by_day theo đúng loại này (khớp pill FE đang chọn)."),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Thống kê Kết quả liên hệ theo loại / theo thành viên / theo ngày.

    Route này KHÔNG trùng `/{post_id}/call-result` (khác số segment đường dẫn)
    nên không cần quan tâm thứ tự khai báo route.
    """
    try:
        data = get_call_result_stats(
            user,
            date_from=date_from,
            date_to=date_to,
            platform=platform,
            member_id=member_id,
            result_code=result_code,
        )
        return BaseResponse(success=True, data=data, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/{post_id}/call-result")
def get_post_call_result(
    post_id: str,
    platform: str = Query("facebook"),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lấy thông tin kết quả liên hệ, số lần gọi và thời điểm gọi gần nhất của bài viết."""
    del user
    try:
        data = get_call_result(post_id, platform=platform)
        return BaseResponse(success=True, data=data, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.patch("/{post_id}/call-result")
def patch_post_call_result(
    post_id: str,
    payload: PostCallResultUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Cập nhật kết quả liên hệ của bài viết (tự động tăng attempts và ghi nhận last_call_at)."""
    try:
        data = update_call_result(post_id, payload.dict(), user=user)
        return BaseResponse(success=True, data=data, message="Đã lưu kết quả liên hệ")
    except Exception as exc:
        return _error(exc)


@router.post("/{post_id}/call-result")
def post_post_call_result(
    post_id: str,
    payload: PostCallResultUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Alias cho PATCH: Cập nhật kết quả liên hệ của bài viết."""
    return patch_post_call_result(post_id, payload, user=user)

