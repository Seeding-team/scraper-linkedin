from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.crm_lead import (
    CrmLeadConvertRequest,
    CrmLeadCreate,
    CrmLeadUpdate,
)
from app.modules.all_platform.schemas.crm_lead_import import (
    ImportConfirmRequest,
    ImportRevalidateRequest,
)
from app.modules.all_platform.services.crm_lead_import_service import (
    MAX_IMPORT_BYTES,
    build_template,
    confirm_import,
    preview_import,
    revalidate_rows,
)
from app.modules.all_platform.services.crm_lead_service import (
    DuplicateLeadError,
    LeadLinkedError,
    company_match,
    convert_lead,
    create_lead,
    delete_lead,
    duplicate_check,
    get_lead,
    copy_lead_to_instance,
    copy_leads_to_instance,
    list_leads,
    update_lead,
)

router = APIRouter()


def _error(exc: Exception) -> BaseResponse:
    if isinstance(exc, DuplicateLeadError):
        return BaseResponse(success=False, message=str(exc), data={"duplicates": exc.matches})
    if isinstance(exc, LeadLinkedError):
        # Tra kem id ho so downstream de UI co the dan nguoi dung sang do thay
        # vi chi bao "khong xoa duoc".
        return BaseResponse(success=False, message=str(exc), data={"links": exc.links})
    if isinstance(exc, PermissionError):
        return BaseResponse(success=False, message=str(exc))
    return BaseResponse(success=False, message=str(exc))


@router.get("")
def leads_list(
    search: str | None = Query(None),
    status: str | None = Query(None),
    source: str | None = Query(None),
    sdr_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(
            success=True,
            data=list_leads(user, search=search, status=status, source=source, sdr_id=sdr_id, page=page, page_size=page_size),
        )
    except Exception as exc:
        return _error(exc)


@router.get("/duplicate-check")
def leads_duplicate_check(
    phone: str | None = Query(None),
    email: str | None = Query(None),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data={"matches": duplicate_check(user, phone, email)})
    except Exception as exc:
        return _error(exc)


@router.get("/import/template")
def leads_import_template(user: dict[str, Any] = Depends(get_current_user)) -> Response:
    del user
    content = build_template()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="lead-import-template.xlsx"'},
    )


@router.post("/import/preview")
async def leads_import_preview(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        if not (file.filename or "").lower().endswith(".xlsx"):
            raise ValueError("Chi ho tro file Excel .xlsx.")
        raw = await file.read(MAX_IMPORT_BYTES + 1)
        return BaseResponse(success=True, data=preview_import(raw, user))
    except Exception as exc:
        return _error(exc)


@router.post("/import/preview/revalidate")
def leads_import_revalidate(
    payload: ImportRevalidateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        rows_payload = [row.model_dump() for row in payload.rows]
        return BaseResponse(success=True, data=revalidate_rows(rows_payload, user))
    except Exception as exc:
        return _error(exc)


@router.post("/import/confirm")
def leads_import_confirm(
    payload: ImportConfirmRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        rows_payload = [row.model_dump() for row in payload.rows]
        data = confirm_import(rows_payload, payload.selected_rows, user)
        return BaseResponse(success=True, message="Da hoan tat import Lead.", data=data)
    except Exception as exc:
        return _error(exc)


@router.get("/company-match")
def leads_company_match(
    tax_code: str | None = Query(None),
    website: str | None = Query(None),
    name: str | None = Query(None),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data={"matches": company_match(user, tax_code, website, name)})
    except Exception as exc:
        return _error(exc)


@router.post("")
def leads_create(payload: CrmLeadCreate, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, message="Da tao lead", data=create_lead(payload.model_dump(), user))
    except Exception as exc:
        return _error(exc)


@router.post("/copy-instance")
def leads_copy_instance_bulk(payload: dict, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """Chi Admin THAT: sao chep NHIEU Lead cung luc, MOI Lead 1 workspace dich
    RIENG (khong bat buoc cung 1 dich cho ca lo) - ban bulk cua
    POST /{lead_id}/copy-instance. Payload: {"assignments": [{"lead_id":
    ..., "target_instance": ...}, ...]}."""
    if str(user.get("role") or "").strip().lower() != "admin":
        return BaseResponse(success=False, message="Chỉ Admin mới được sao chép Lead sang workspace khác")
    try:
        assignments = payload.get("assignments")
        if not assignments or not isinstance(assignments, list):
            return BaseResponse(success=False, message="assignments là bắt buộc (danh sách)")
        data = copy_leads_to_instance(assignments, user)
        failed_count = len(data.get("failed") or [])
        copied_count = len(data.get("copied") or [])
        message = f"Đã sao chép {copied_count} Lead" + (f", {failed_count} lỗi" if failed_count else "")
        return BaseResponse(success=True, message=message, data=data)
    except Exception as exc:
        return _error(exc)


@router.get("/{lead_id}")
def leads_get(lead_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_lead(lead_id, user))
    except Exception as exc:
        return _error(exc)


@router.put("/{lead_id}")
def leads_update(lead_id: str, payload: CrmLeadUpdate, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(
            success=True,
            message="Da cap nhat lead",
            data=update_lead(lead_id, payload.model_dump(exclude_unset=True), user),
        )
    except Exception as exc:
        return _error(exc)


@router.delete("/{lead_id}")
def leads_delete(lead_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        delete_lead(lead_id, user)
        return BaseResponse(success=True, message="Đã xóa Lead")
    except Exception as exc:
        return _error(exc)


@router.post("/{lead_id}/copy-instance")
def leads_copy_instance(lead_id: str, payload: dict, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """Chi Admin THAT (khong phai leader): tao 1 ban sao cua 1 Lead (chua
    convert) sang 1 workspace khac, Lead goc van giu nguyen - thao tac xuyen
    tenant."""
    if str(user.get("role") or "").strip().lower() != "admin":
        return BaseResponse(success=False, message="Chỉ Admin mới được sao chép Lead sang workspace khác")
    try:
        target_instance = payload.get("target_instance")
        if not target_instance:
            return BaseResponse(success=False, message="target_instance là bắt buộc")
        data = copy_lead_to_instance(lead_id, str(target_instance), user)
        return BaseResponse(success=True, message="Đã sao chép sang workspace khác", data=data)
    except Exception as exc:
        return _error(exc)


@router.post("/{lead_id}/convert")
def leads_convert(lead_id: str, payload: CrmLeadConvertRequest, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(
            success=True,
            message="Da chuyen doi lead",
            data=convert_lead(lead_id, payload.model_dump(exclude_none=True), user),
        )
    except Exception as exc:
        return _error(exc)
