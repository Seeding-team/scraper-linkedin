"""Dong bo Hang hoa MSC → CRM: endpoint chay thu cong + xem trang thai lan dong bo.

Toan bo logic nam o services/msc_sync_service.py (run_sync) — dung chung voi
job APScheduler hang ngay (jobs/msc_sync_job.py), khong nhan doi logic.

MSC la READ-ONLY: service chi GET {MSC_API_BASE_URL}/api/v1/goods.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas.common import BaseResponse
from app.modules.all_platform.schemas.msc_sync import MscSyncRunRequest
from app.modules.all_platform.services import msc_sync_service
from app.modules.all_platform.services.crm_permission_service import (
    can_manage_shared_master_data,
)

router = APIRouter()


@router.post("/run")
def msc_sync_run(
    payload: MscSyncRunRequest | None = None,
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Dong bo thu cong (button "Đồng bộ hàng hóa từ MSC").

    Ky quyen: cung nhom quyen quan ly master data voi service-catalog
    (admin/leader luon duoc; sale/presale theo can_manage_shared_master_data).
    Khong dua vao web-intake allowlist (chi danh cho nguoi CRM da dang nhap).
    """
    if not can_manage_shared_master_data(user):
        raise HTTPException(status_code=403, detail="Forbidden: CRM master data manager role required")
    dry_run = bool(payload.dry_run) if payload else False
    stats = msc_sync_service.run_sync(trigger="manual", user_id=user.get("id"), dry_run=dry_run)
    if stats.get("status") == "failed":
        return BaseResponse(
            success=False,
            message=stats.get("error_message") or "Đồng bộ hàng hóa từ MSC thất bại.",
            data=stats,
        )
    message = (
        f"Đã đồng bộ: {stats.get('inserted')} thêm mới, {stats.get('updated')} cập nhật, "
        f"{stats.get('skipped')} không thay đổi, {stats.get('failed')} lỗi."
    )
    if stats.get("dry_run"):
        message = f"DRY RUN — chưa ghi dữ liệu. Dự kiến: {message}"
    return BaseResponse(success=True, message=message, data=stats)


@router.get("/status")
def msc_sync_status(
    limit: int = Query(10, ge=1, le=50),
    _user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Trang thai cac lan dong bo gan nhat (ai dang nhap cung xem duoc)."""
    try:
        runs = msc_sync_service.list_sync_runs(limit)
        return BaseResponse(success=True, data=runs)
    except Exception as e:  # noqa: BLE001 — dung lai convention BaseResponse(success=False)
        return BaseResponse(success=False, message=str(e))
