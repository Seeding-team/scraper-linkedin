from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.crm_lead import (
    CrmLeadConvertRequest,
    CrmLeadCreate,
    CrmLeadUpdate,
)
from app.modules.all_platform.services.crm_lead_service import (
    DuplicateLeadError,
    LeadLinkedError,
    company_match,
    convert_lead,
    copy_lead_to_instance,
    create_lead,
    delete_lead,
    duplicate_check,
    get_lead,
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
    convert) sang 1 clone CRM doc lap khac (cloudgate/SECURITYZONE), Lead
    goc van giu nguyen o Main - thao tac xuyen tenant."""
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
