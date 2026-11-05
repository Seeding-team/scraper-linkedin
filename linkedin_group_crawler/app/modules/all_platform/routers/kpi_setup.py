"""Router for KPI Setup, Templates, Sessions and PM Plane.so Synchronization."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.kpi_setup import (
    ApplyTemplateRequest,
    KpiTemplateBonusRuleSchema,
    KpiTemplateCreate,
    KpiTemplateLevelSchema,
    KpiTemplateUpdate,
    UpdateAllocationsRequest,
    UpdateOverridesRequest,
    UpdateSessionSkillsRequest,
)
from app.modules.all_platform.services import (
    kpi_calculation_service,
    kpi_metric_service,
    kpi_pm_sync_service,
    kpi_session_service,
    kpi_template_service,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Metrics ───────────────────────────────────────────────────────────────────

@router.get("/metrics")
def get_kpi_metrics() -> BaseResponse:
    """Lay danh sach chi so KPI hop le (lay dong tu categories, loai tru chua-danh-gia)."""
    metrics = kpi_metric_service.get_valid_metrics()
    return BaseResponse(success=True, data=metrics)


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates")
def list_kpi_templates(
    active_only: bool = Query(False),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lay danh sach cac mau KPI chung."""
    data = kpi_template_service.list_templates(active_only=active_only)
    return BaseResponse(success=True, data=data)


@router.post("/templates")
def create_kpi_template(
    payload: KpiTemplateCreate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Tao moi 1 mau KPI."""
    try:
        user_id = user.get("id")
        created = kpi_template_service.create_template(payload, user_id=user_id)
        return BaseResponse(success=True, data=created, message="Tạo mẫu KPI thành công")
    except Exception as e:
        logger.error(f"Loi tao template: {e}")
        return BaseResponse(success=False, message=str(e))


@router.get("/templates/{template_id}")
def get_kpi_template(
    template_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lay chi tiet 1 mau KPI."""
    tpl = kpi_template_service.get_template(template_id)
    if not tpl:
        return BaseResponse(success=False, message="Không tìm thấy mẫu KPI")
    return BaseResponse(success=True, data=tpl)


@router.put("/templates/{template_id}")
@router.patch("/templates/{template_id}")
def update_kpi_template(
    template_id: str,
    payload: KpiTemplateUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Cap nhat mau KPI, levels hoac bonus rules."""
    try:
        updated = kpi_template_service.update_template(template_id, payload)
        return BaseResponse(success=True, data=updated, message="Cập nhật mẫu KPI thành công")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/templates/{template_id}")
def delete_kpi_template(
    template_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Xoa mau KPI."""
    try:
        kpi_template_service.delete_template(template_id)
        return BaseResponse(success=True, message="Đã xóa mẫu KPI")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/templates/{template_id}/levels")
def update_kpi_template_levels(
    template_id: str,
    payload: List[KpiTemplateLevelSchema],
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Cap nhat cac moc chi tieu cho template."""
    try:
        levels = kpi_template_service.upsert_template_levels(template_id, payload)
        return BaseResponse(success=True, data=levels, message="Đã cập nhật các mốc chỉ tiêu")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/templates/{template_id}/bonus-rules")
def update_kpi_template_bonus_rules(
    template_id: str,
    payload: List[KpiTemplateBonusRuleSchema],
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Cap nhat quy tac thuong manday cho template."""
    try:
        rules = kpi_template_service.upsert_template_bonus_rules(template_id, payload)
        return BaseResponse(success=True, data=rules, message="Đã cập nhật quy tắc thưởng")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.post("/sessions/apply-template")
@router.post("/sessions/apply")
def apply_kpi_template_to_team(
    payload: ApplyTemplateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Ap mau KPI vao 1 Team CRM cho ky tuan cu the."""
    try:
        if not payload.week_end:
            ws_str = str(payload.week_start).strip()[:10]
            ws_date = datetime.strptime(ws_str, "%Y-%m-%d").date()
            payload.week_end = (ws_date + timedelta(days=6)).isoformat()

        user_id = user.get("id")
        session = kpi_session_service.apply_template(payload, user_id=user_id)
        return BaseResponse(success=True, data=session, message="Đã áp dụng mẫu KPI vào Team thành công")
    except Exception as e:
        logger.error(f"Loi ap template vao session: {e}")
        return BaseResponse(success=False, message=str(e))


@router.get("/sessions")
def list_kpi_sessions(
    crm_team_id: Optional[str] = Query(None),
    limit: int = Query(50),
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lay danh sach cac ky KPI session."""
    data = kpi_session_service.list_sessions(crm_team_id=crm_team_id, limit=limit)
    return BaseResponse(success=True, data=data)


@router.get("/sessions/{session_id}")
def get_kpi_session(
    session_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lay chi tiet 1 session KPI."""
    detail = kpi_session_service.get_session_detail(session_id)
    if not detail:
        return BaseResponse(success=False, message="Không tìm thấy session KPI")
    return BaseResponse(success=True, data=detail)


@router.delete("/sessions/{session_id}")
def delete_kpi_session(
    session_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Xoa 1 ky KPI session."""
    try:
        kpi_session_service.delete_session(session_id)
        return BaseResponse(success=True, message="Đã xóa kỳ KPI thành công")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/sessions/{session_id}/allocations")
@router.patch("/sessions/{session_id}/allocations")
def update_session_allocations(
    session_id: str,
    payload: UpdateAllocationsRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Cap nhat ty trong phan bo va nguoi ho tro (supporter) cho cac thanh vien."""
    try:
        updated = kpi_session_service.update_allocations(session_id, payload.allocations)
        return BaseResponse(success=True, data=updated, message="Cập nhật phân bổ thành công")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/sessions/{session_id}/overrides")
@router.patch("/sessions/{session_id}/overrides")
def update_session_overrides(
    session_id: str,
    payload: UpdateOverridesRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Cap nhat cac moc Critical override rieng cho tung thanh vien."""
    try:
        updated = kpi_session_service.update_overrides(session_id, payload.overrides)
        return BaseResponse(success=True, data=updated, message="Cập nhật override thành công")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/sessions/{session_id}/skills")
@router.patch("/sessions/{session_id}/skills")
def update_session_skills(
    session_id: str,
    payload: UpdateSessionSkillsRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Luu cau hinh Skill Solution va Skill Vendor cho session."""
    try:
        updated = kpi_session_service.update_skills(session_id, payload)
        return BaseResponse(success=True, data=updated, message="Đã lưu cấu hình Skill PM")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/sessions/{session_id}/activate")
def activate_kpi_session(
    session_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Kich hoat session KPI."""
    try:
        session = kpi_session_service.activate_session(session_id)
        return BaseResponse(success=True, data=session, message="Đã kích hoạt kỳ KPI")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Calculations & Snapshots ──────────────────────────────────────────────────

@router.get("/sessions/{session_id}/preview")
def preview_kpi_session(
    session_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Xem thu ket qua tinh toan KPI thuc te hien tai."""
    try:
        preview = kpi_calculation_service.preview_session(session_id)
        return BaseResponse(success=True, data=preview)
    except Exception as e:
        logger.error(f"Loi preview session: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/sessions/{session_id}/snapshot")
@router.post("/sessions/{session_id}/snapshots")
def snapshot_kpi_session(
    session_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Chot va luu snapshot ket qua cua ky KPI."""
    try:
        snapshots = kpi_calculation_service.snapshot_session(session_id)
        return BaseResponse(success=True, data=snapshots, message="Đã chốt snapshot kỳ KPI thành công")
    except Exception as e:
        logger.error(f"Loi snapshot session: {e}")
        return BaseResponse(success=False, message=str(e))


# ── PM Sync ───────────────────────────────────────────────────────────────────

@router.get("/pm-skills")
def get_pm_skills_proxy(
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Proxy lay danh sach Skill Solution va Skill Vendor tu PM Plane.so."""
    try:
        res = kpi_pm_sync_service.get_pm_skills()
        if isinstance(res, dict) and not res.get("success", False):
            return BaseResponse(
                success=False,
                message=res.get("message") or "Không thể lấy danh sách Skill từ PM Plane.so",
                data=[],
            )
        groups = res.get("groups", []) if isinstance(res, dict) else []
        return BaseResponse(success=True, data=groups, message="")
    except Exception as e:
        logger.error(f"Lỗi khi gọi PM Plane.so skills: {e}")
        return BaseResponse(
            success=False,
            message=f"Lỗi kết nối PM Plane.so: {str(e)}",
            data=[],
        )


@router.post("/sessions/{session_id}/sync-pm")
def sync_kpi_session_to_pm(
    session_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Dong bo ket qua KPI cua session sang PM Plane.so."""
    try:
        res = kpi_pm_sync_service.sync_session_to_pm(session_id, user=user)
        return BaseResponse(
            success=res.get("success", False),
            data=res.get("data"),
            message=res.get("message"),
        )
    except Exception as e:
        logger.error(f"Loi dong bo sang PM: {e}")
        return BaseResponse(success=False, message=str(e))

