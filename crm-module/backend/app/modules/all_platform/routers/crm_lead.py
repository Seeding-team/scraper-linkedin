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
from app.modules.all_platform.services import crm_lead_rule_service
from app.modules.all_platform.services.crm_permission_service import can_manage_lead_classification_rules
from app.modules.all_platform.services.crm_lead_service import (
    DuplicateLeadError,
    LeadLinkedError,
    company_match,
    convert_lead,
    create_lead,
    delete_lead,
    delete_leads_bulk,
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
        # Khong con la loi chan cung: requiresCascadeConfirm de FE hoi lai roi
        # goi lai voi confirm_cascade=true. links van tra kem de UI dan nguoi
        # dung sang ho so downstream neu can.
        return BaseResponse(success=False, message=str(exc), data={"requiresCascadeConfirm": True, "links": exc.links, **exc.summary})
    if isinstance(exc, PermissionError):
        return BaseResponse(success=False, message=str(exc))
    return BaseResponse(success=False, message=str(exc))


@router.get("")
def leads_list(
    search: str | None = Query(None),
    status: str | None = Query(None),
    source: str | None = Query(None),
    sdr_id: str | None = Query(None),
    team: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(
            success=True,
            data=list_leads(user, search=search, status=status, source=source, sdr_id=sdr_id, team=team, page=page, page_size=page_size),
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


@router.post("/bulk-delete")
def leads_delete_bulk(payload: dict, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """
    Chức năng: Xóa hàng loạt Lead được tick chọn trên giao diện bảng danh sách Lead.
    Thay đổi: Bổ sung endpoint POST /crm/leads/bulk-delete nhận payload {"lead_ids": ["uuid-1", "uuid-2", ...]}.
    - Kiểm tra danh sách ID hợp lệ.
    - Gọi delete_leads_bulk(lead_ids, user) để duyệt qua từng Lead, áp dụng đúng quyền (can_write_lead) và chặn lead đã convert.
    - Trả về BaseResponse với số lượng Lead đã xóa thành công và danh sách lỗi nếu có.
    """
    try:
        lead_ids = payload.get("lead_ids")
        if not lead_ids or not isinstance(lead_ids, list):
            return BaseResponse(success=False, message="Danh sách lead_ids không hợp lệ.")
        data = delete_leads_bulk(lead_ids, user, confirm_cascade=bool(payload.get("confirm_cascade")))
        deleted_count = len(data.get("deleted_ids") or [])
        failed_count = len(data.get("failed") or [])
        if deleted_count == 0 and failed_count > 0:
            return BaseResponse(
                success=False,
                message=f"Không thể xóa {failed_count} Lead đã chọn: {data['failed'][0]['message']}",
                data=data,
            )
        message = f"Đã xóa {deleted_count} Lead" + (f", {failed_count} không thể xóa" if failed_count else "")
        return BaseResponse(success=True, message=message, data=data)
    except Exception as exc:
        return _error(exc)


@router.get("/classification-rules")
def leads_get_classification_rules(user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """Doc rule dang ap dung ("Dieu kien phan loai Lead") - moi nguoi da
    dang nhap deu xem duoc (Member/Leader chi xem, khong sua). PHAI dat
    TRUOC route /{lead_id} ben duoi (path tinh vs path dong cung 1 segment -
    FastAPI khop theo thu tu dang ky, dat sau se bi /{lead_id} "nuot" mat)."""
    try:
        return BaseResponse(success=True, data=crm_lead_rule_service.get_rule_set())
    except Exception as exc:
        return _error(exc)


@router.put("/classification-rules")
def leads_save_classification_rules(payload: dict[str, Any], user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """Sua rule - CHI Admin (yeu cau rieng "chỉ có admin mới được tick chọn")."""
    if not can_manage_lead_classification_rules(user):
        return BaseResponse(success=False, message="Chỉ Admin mới được cấu hình Điều kiện phân loại Lead")
    try:
        conditions = payload.get("conditions") or {}
        data = crm_lead_rule_service.save_rule_set(conditions, user.get("id"))
        return BaseResponse(success=True, message="Đã lưu Điều kiện phân loại Lead", data=data)
    except crm_lead_rule_service.RuleValidationError as exc:
        return BaseResponse(success=False, message=str(exc))
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
def leads_delete(
    lead_id: str,
    confirm_cascade: bool = Query(False, description="True sau khi nguoi dung da xac nhan xoa Lead da convert."),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        delete_lead(lead_id, user, confirm_cascade=confirm_cascade)
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
