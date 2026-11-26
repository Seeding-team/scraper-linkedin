"""Router for Crawl Exclude Keywords & Proposals endpoints.

Mounted at prefix "/crawl-keywords" in router.py.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user, require_admin, require_admin_or_leader
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.crawl_keywords import (
    BulkApproveProposalRequest,
    ExcludeKeywordCreate,
    KeywordProposalCreate,
    KeywordProposalReject,
)
from app.modules.all_platform.services.crawl_exclude_service import (
    approve_proposal,
    auto_reject_legacy_low_lead_score_posts,
    bulk_approve_proposals,
    create_exclude_keyword,
    create_proposal,
    delete_exclude_keyword,
    list_exclude_keywords,
    list_proposals,
    reject_proposal,
)

router = APIRouter()


def _error(exc: Exception) -> BaseResponse:
    return BaseResponse(success=False, message=str(exc))


# ── Exclude Keywords (Từ khóa loại trừ) ──────────────────────────────────────


@router.get("/exclude")
def crawl_keywords_list_exclude(
    platform: Optional[str] = Query(None, description="Platform (facebook, linkedin, threads) hoặc None"),
    status: Optional[str] = Query("active", description="active hoặc inactive"),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Mọi user đăng nhập đều có thể đọc danh sách từ khóa loại trừ."""
    del user
    try:
        data = list_exclude_keywords(platform=platform, status=status)
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return _error(exc)


@router.post("/exclude")
def crawl_keywords_create_exclude(
    payload: ExcludeKeywordCreate,
    user: dict[str, Any] = Depends(require_admin_or_leader),
) -> BaseResponse:
    """Admin hoặc Leader thêm từ khóa loại trừ vào hệ thống."""
    try:
        data = create_exclude_keyword(payload.model_dump(exclude_unset=True), user)
        return BaseResponse(success=True, message="Đã thêm từ khóa loại trừ", data=data)
    except Exception as exc:
        return _error(exc)


@router.delete("/exclude/{id}")
def crawl_keywords_delete_exclude(
    id: str,
    user: dict[str, Any] = Depends(require_admin),
) -> BaseResponse:
    """Chỉ Admin mới có quyền xóa từ khóa loại trừ."""
    try:
        data = delete_exclude_keyword(id, user)
        return BaseResponse(success=True, message="Đã xóa từ khóa loại trừ", data=data)
    except Exception as exc:
        return _error(exc)


# ── Keyword Proposals (Đề xuất từ khóa) ──────────────────────────────────────


@router.post("/proposals")
def crawl_keywords_create_proposal(
    payload: KeywordProposalCreate,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Mọi thành viên đều có thể gửi đề xuất từ khóa loại trừ từ bài viết cào."""
    try:
        data = create_proposal(payload.model_dump(exclude_unset=True), user)
        return BaseResponse(success=True, message="Đã gửi đề xuất từ khóa loại trừ", data=data)
    except Exception as exc:
        return _error(exc)


@router.get("/proposals")
def crawl_keywords_list_proposals(
    status: Optional[str] = Query("pending", description="pending, approved, rejected, hoặc None cho tất cả"),
    user: dict[str, Any] = Depends(require_admin_or_leader),
) -> BaseResponse:
    """Admin và Leader xem danh sách các đề xuất từ khóa."""
    del user
    try:
        data = list_proposals(status=status)
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return _error(exc)


@router.post("/proposals/bulk-approve")
def crawl_keywords_bulk_approve_proposals(
    payload: BulkApproveProposalRequest,
    user: dict[str, Any] = Depends(require_admin),
) -> BaseResponse:
    """Admin duyệt hàng loạt danh sách đề xuất từ khóa."""
    try:
        data = bulk_approve_proposals(payload.proposal_ids, user)
        return BaseResponse(
            success=True,
            message=f"Đã duyệt {data.get('approved_count', 0)} đề xuất",
            data=data,
        )
    except Exception as exc:
        return _error(exc)


@router.post("/proposals/{id}/approve")
def crawl_keywords_approve_proposal(
    id: str,
    user: dict[str, Any] = Depends(require_admin),
) -> BaseResponse:
    """Admin duyệt một đề xuất và tự động đưa vào crawl_exclude_keywords."""
    try:
        data = approve_proposal(id, user)
        return BaseResponse(success=True, message="Đã duyệt đề xuất từ khóa", data=data)
    except Exception as exc:
        return _error(exc)


@router.post("/auto-reject-legacy-low-score")
def crawl_keywords_auto_reject_legacy_low_score(
    user: dict[str, Any] = Depends(require_admin),
) -> BaseResponse:
    """Việc C (2026-11-26, báo cáo điều tra feed ẩn bài do lead_score): quét 1 lần, idempotent,
    các bài CŨ đã có sẵn lead_score xác định 1-39 (không phải NULL — xem Việc B) còn sót lại
    từ cửa sổ lịch sử 2026-10-02 -> 2026-11-04, tự động gắn 'Không phù hợp'. Chỉ Admin được
    chạy (có thể gọi lại nhiều lần an toàn, không tạo thêm history thừa cho bài đã xử lý)."""
    del user
    try:
        data = auto_reject_legacy_low_lead_score_posts()
        return BaseResponse(
            success=True,
            message=f"Đã quét {data.get('scanned', 0)} bài, gắn 'Không phù hợp' cho {data.get('marked', 0)} bài",
            data=data,
        )
    except Exception as exc:
        return _error(exc)


@router.post("/proposals/{id}/reject")
def crawl_keywords_reject_proposal(
    id: str,
    payload: Optional[KeywordProposalReject] = None,
    user: dict[str, Any] = Depends(require_admin),
) -> BaseResponse:
    """Admin từ chối một đề xuất từ khóa (lưu lại lý do, không xóa bản ghi)."""
    try:
        reason = payload.reason if payload else None
        data = reject_proposal(id, reason=reason, user=user)
        return BaseResponse(success=True, message="Đã từ chối đề xuất", data=data)
    except Exception as exc:
        return _error(exc)

