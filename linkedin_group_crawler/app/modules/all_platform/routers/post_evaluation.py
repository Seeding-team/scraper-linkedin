"""Router for Post Evaluation (Quick Review) endpoints.

Mounted at prefix "/posts" in router.py.
Static routes (/evaluation/batch-reject, /evaluation/undo) are placed
BEFORE /{post_id}/evaluation so FastAPI does not capture 'evaluation' as a post_id.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.post_evaluation import (
    BatchRejectRequest,
    PostEvaluationUpdate,
    UndoBatchRejectRequest,
)
from app.modules.all_platform.services.post_evaluation_service import (
    batch_reject,
    get_review,
    undo_batch_reject,
    update_evaluation,
)

router = APIRouter()


def _error(exc: Exception) -> BaseResponse:
    return BaseResponse(success=False, message=str(exc))


@router.post("/evaluation/batch-reject")
def post_evaluation_batch_reject(
    payload: BatchRejectRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Review Nhanh: gán hàng loạt 'Không phù hợp' cho danh sách bài viết.

    Trả về undo_token để client có thể hoàn tác ngay nếu bấm nhầm.
    """
    try:
        data = batch_reject(
            post_ids=payload.post_ids,
            user=user,
            platform=payload.platform,
            reason=payload.reason,
        )
        return BaseResponse(
            success=True,
            message=f"Đã gán 'Không phù hợp' cho {data.get('affected_count', 0)} bài viết",
            data=data,
        )
    except Exception as exc:
        return _error(exc)


@router.post("/evaluation/undo")
def post_evaluation_undo(
    payload: UndoBatchRejectRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Hoàn tác thao tác Review Nhanh gần nhất bằng undo_token."""
    try:
        data = undo_batch_reject(payload.undo_token, user)
        return BaseResponse(
            success=True,
            message=data.get("message", "Đã hoàn tác đánh giá"),
            data=data,
        )
    except Exception as exc:
        return _error(exc)


@router.get("/{post_id}/evaluation")
def post_evaluation_get(
    post_id: str,
    platform: str = Query("facebook", description="Platform của bài viết (facebook, linkedin, threads)"),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lấy bản ghi đánh giá của 1 bài viết."""
    del user
    try:
        data = get_review(post_id, platform=platform)
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return _error(exc)


@router.patch("/{post_id}/evaluation")
def post_evaluation_update(
    post_id: str,
    payload: PostEvaluationUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Cập nhật trạng thái đánh giá cho 1 bài viết (phu-hop, khong-phu-hop, can-nhac, chua-danh-gia)

    kèm ghi chú/tóm tắt và cờ miễn trừ từ khóa loại trừ (exclude_keyword_exempt).
    """
    try:
        data = update_evaluation(post_id, payload.model_dump(exclude_unset=True), user)
        return BaseResponse(success=True, message="Đã lưu đánh giá bài viết", data=data)
    except Exception as exc:
        return _error(exc)

