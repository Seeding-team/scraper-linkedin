"""Router for Post Call Result (Kết quả liên hệ) endpoints.

Mounted at prefix "/posts" in router.py.
"""

from __future__ import annotations

from typing import Any, Optional
from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.post_call_result import PostCallResultNoteUpdate, PostCallResultUpdate
from app.modules.all_platform.services.post_call_result_service import (
    get_call_result,
    get_call_result_stats,
    get_overdue_callbacks_count,
    update_call_result,
    update_call_result_note,
)
from app.modules.all_platform.services.post_contact_activity_service import (
    get_activity_log,
    get_day_breakdown,
    get_seeding_group_coverage,
    get_who_did_what,
)
from app.modules.all_platform.services.zalo_inbox_kpi_service import (
    get_post_feed_message_stats,
    get_zalo_followup_count,
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
    team_id: Optional[str] = Query(None, description="Lọc theo 1 Team (Dashboard Leader)."),
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
            team_id=team_id,
        )
        return BaseResponse(success=True, data=data, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/call-results/contact-activity/who")
def get_contact_activity_who(
    platform: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None, description="Lọc theo 1 Team (Dashboard Leader)."),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Thanh "Ai đã làm" (who-bar): tổng seeding + gọi điện + nhắn Zalo theo từng thành viên trong kỳ."""
    try:
        data = get_who_did_what(
            user,
            platform=platform,
            date_from=date_from,
            date_to=date_to,
            member_id=member_id,
            team_id=team_id,
        )
        return BaseResponse(success=True, data=data, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/call-results/contact-activity/log")
def get_contact_activity_log(
    platform: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None, description="Lọc theo 1 Team (Dashboard Leader)."),
    action_type: Optional[str] = Query(None, description="'seed' | 'call' | 'zalo' — bỏ trống = tất cả"),
    result_code: Optional[str] = Query(None, description="Chỉ áp cho action_type='call': lọc thêm theo đúng mã (vd 'interested' = Lead, 'callback' = Hẹn gọi lại)."),
    overdue_only: bool = Query(False, description="Chỉ áp khi result_code='callback': chỉ lấy các bản ghi đã quá hạn (>=1 ngày)."),
    needs_followup_only: bool = Query(False, description="Chỉ áp cho action_type='zalo': chỉ lấy hội thoại chưa có khách trả lời, trong 2 ngày gần nhất."),
    search: Optional[str] = Query(None, description="Lọc hậu kỳ theo tên thành viên hoặc bài viết (không phân biệt hoa/thường)."),
    page: int = Query(1),
    page_size: int = Query(10, le=2000, description="Tối đa 2000 (dùng khi xuất CSV lấy toàn bộ theo bộ lọc, không phân trang UI)."),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Nhật ký hoạt động: gộp seeding + gọi điện + nhắn Zalo, phân trang."""
    try:
        data = get_activity_log(
            user,
            platform=platform,
            date_from=date_from,
            date_to=date_to,
            member_id=member_id,
            team_id=team_id,
            action_type=action_type,
            result_code=result_code,
            overdue_only=overdue_only,
            needs_followup_only=needs_followup_only,
            search=search,
            page=page,
            page_size=page_size,
        )
        return BaseResponse(success=True, data=data, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/call-results/contact-activity/by-day")
def get_contact_activity_by_day(
    platform: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None, description="Lọc theo 1 Team (Dashboard Leader)."),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Tab "Theo ngày": seeding + gọi điện (OK/BAD) + Zalo (gửi/trả lời) theo từng ngày, đủ mọi
    ngày trong khoảng chọn (kể cả ngày không có hoạt động)."""
    try:
        data = get_day_breakdown(
            user,
            platform=platform,
            date_from=date_from,
            date_to=date_to,
            member_id=member_id,
            team_id=team_id,
        )
        return BaseResponse(success=True, data=data, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/call-results/zalo-message-stats")
def get_zalo_message_stats(
    platform: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None, description="Lọc theo 1 Team (Dashboard Leader)."),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Thống kê 'Tin nhắn Zalo đã gửi' / 'Khách đã phản hồi' (nguồn Post Feed)."""
    try:
        data = get_post_feed_message_stats(
            user,
            platform=platform,
            date_from=date_from,
            date_to=date_to,
            member_id=member_id,
            team_id=team_id,
        )
        return BaseResponse(success=True, data=data, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/call-results/overdue-callbacks-count")
def get_overdue_callbacks_count_endpoint(
    platform: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None),
    threshold_days: int = Query(1, ge=0),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """KPI/cảnh báo "Hẹn gọi lại quá hạn": số bài có kết quả liên hệ mới nhất là 'callback'
    nhưng đã quá `threshold_days` ngày chưa có lần gọi mới hơn."""
    try:
        count = get_overdue_callbacks_count(
            user,
            team_id=team_id,
            member_id=member_id,
            platform=platform,
            threshold_days=threshold_days,
        )
        return BaseResponse(success=True, data={"count": count}, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/call-results/zalo-followup-count")
def get_zalo_followup_count_endpoint(
    platform: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None),
    within_days: int = Query(2, ge=0),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """KPI/cảnh báo "Tin nhắn cần follow-up": số hội thoại Zalo đã gửi nhưng khách chưa trả
    lời, trong `within_days` ngày gần nhất."""
    try:
        count = get_zalo_followup_count(
            user,
            team_id=team_id,
            member_id=member_id,
            platform=platform,
            within_days=within_days,
        )
        return BaseResponse(success=True, data={"count": count}, message="Thành công")
    except Exception as exc:
        return _error(exc)


@router.get("/call-results/seeding-group-coverage")
def get_seeding_group_coverage_endpoint(
    platform: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None),
    limit: int = Query(15, ge=1, le=50),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Tab Comment: độ phủ seeding/bình luận theo nhóm/nguồn, top `limit` nhóm nhiều lượt nhất."""
    try:
        data = get_seeding_group_coverage(
            user,
            team_id=team_id,
            member_id=member_id,
            platform=platform,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
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


@router.patch("/{post_id}/call-result-note")
def patch_post_call_result_note(
    post_id: str,
    payload: PostCallResultNoteUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Việc 3: cập nhật riêng ghi chú lý do — KHÔNG đổi result_code, KHÔNG tạo bản ghi mới."""
    try:
        data = update_call_result_note(post_id, payload.platform or "facebook", payload.note, user=user)
        return BaseResponse(success=True, data=data, message="Đã lưu ghi chú")
    except Exception as exc:
        return _error(exc)

