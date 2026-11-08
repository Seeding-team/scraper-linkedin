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
    update_call_result,
)

router = APIRouter()


def _error(exc: Exception) -> BaseResponse:
    return BaseResponse(success=False, message=str(exc))


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

