"""Contracts endpoints — hợp đồng gắn với customer_leads (CRM deal) + quotes đã chốt,
kèm AI Contract Copilot (soạn thảo + chấm điểm rủi ro).

CRUD nội bộ dùng auth hiện có (get_current_user), theo đúng pattern quote.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    ContractCreateRequest,
    ContractUpdateRequest,
    ContractStatusUpdateRequest,
    ContractGenerateRequest,
    ContractReviewRequest,
    ContractRefineRequest,
)
from app.modules.all_platform.services import (
    create_contract,
    delete_contract,
    get_contract,
    get_contracts_dashboard_stats,
    list_contracts,
    update_contract,
    update_contract_status,
    generate_contract_draft,
    review_contract_risk,
    refine_contract_draft,
    get_contract_template,
    get_quote,
    list_contract_activity_log,
)
from app.modules.all_platform.services.contract_ocr_service import compare_to_quote, extract_contract_summary
from app.modules.all_platform.services.quote_currency import quote_amount_to_vnd
from app.modules.all_platform.services.crm_permission_service import can_edit_contract, can_edit_quote, filter_rows_by_scope, get_scope_visible_user_ids
from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id

contracts_router = APIRouter()


def _load_contract_and_lead(contract_id: str) -> tuple[dict, dict | None]:
    contract = get_contract(contract_id)
    lead = get_customer_lead_by_id(contract["dealId"]) if contract.get("dealId") else None
    return contract, lead


@contracts_router.get("")
def contracts_list(
    deal_id: str | None = Query(None),
    status: str | None = Query(None),
    quote_id: str | None = Query(None),
    _user: dict = Depends(get_current_user),
) -> BaseResponse:
    try:
        rows = filter_rows_by_scope(_user, list_contracts(deal_id, status, quote_id), ("createdById", "ownerId"))
        return BaseResponse(success=True, data=rows)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/dashboard-stats")
def contracts_dashboard_stats(_user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        allowed = None
        if get_scope_visible_user_ids(_user) is not None:  # KPI chi tinh tren hop dong user duoc thay
            allowed = {r["id"] for r in filter_rows_by_scope(_user, list_contracts(None, None, None), ("createdById", "ownerId"))}
        return BaseResponse(success=True, data=get_contracts_dashboard_stats(allowed))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/{contract_id}")
def contracts_get(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền xem hợp đồng này")
        return BaseResponse(success=True, data=contract)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.get("/{contract_id}/activity-log")
def contracts_activity_log(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền xem lịch sử hợp đồng này")
        return BaseResponse(success=True, data=list_contract_activity_log(contract_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("")
def contracts_create(payload: ContractCreateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = create_contract(payload.model_dump(), user.get("id"))
        return BaseResponse(success=True, message="Đã tạo hợp đồng", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.put("/{contract_id}")
def contracts_update(contract_id: str, payload: ContractUpdateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền chỉnh sửa hợp đồng này")
        data = update_contract(contract_id, payload.model_dump(exclude_none=True), user.get("id"))
        return BaseResponse(success=True, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/{contract_id}/status")
def contracts_update_status(contract_id: str, payload: ContractStatusUpdateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền đổi trạng thái hợp đồng này")
        data = update_contract_status(contract_id, payload.status, payload.signed_at, user.get("id"))
        return BaseResponse(success=True, message="Đã cập nhật trạng thái hợp đồng", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.delete("/{contract_id}")
def contracts_delete(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        contract, lead = _load_contract_and_lead(contract_id)
        if not can_edit_contract(user, contract, lead):
            return BaseResponse(success=False, message="Không có quyền xoá hợp đồng này")
        delete_contract(contract_id)
        return BaseResponse(success=True)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── AI Contract Copilot ──────────────────────────────────────────────────────

@contracts_router.post("/generate-draft")
async def contracts_generate_draft(payload: ContractGenerateRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """AI soạn thảo — KHÔNG tạo row DB, chỉ trả clauses tạm để FE review trước khi Lưu."""
    try:
        deal = get_customer_lead_by_id(payload.deal_id) if payload.deal_id else None
        if not deal and payload.manual_customer_name:
            deal = {"customer_name": payload.manual_customer_name}
        quote = get_quote(payload.quote_id) if payload.quote_id else None
        reference_text = None
        if payload.reference_template_id:
            reference_text = get_contract_template(payload.reference_template_id, include_text=True).get("extractedText")
        clauses = await generate_contract_draft(
            deal, quote, payload.template_type, payload.detail_level, payload.extra_prompt, reference_text
        )
        return BaseResponse(success=True, data={"clauses": clauses})
    except RuntimeError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/ai-review")
async def contracts_ai_review(payload: ContractReviewRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote = get_quote(payload.quote_id) if payload.quote_id else None
        clauses = [c.model_dump() for c in payload.clauses]
        result = await review_contract_risk(clauses, quote, payload.contract_value, payload.payment_terms)
        return BaseResponse(success=True, data=result)
    except RuntimeError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contracts_router.post("/refine-draft")
async def contracts_refine_draft(payload: ContractRefineRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    """'✦ AI đề xuất chỉnh sửa' — soạn lại nội dung điều khoản để khắc phục các
    rủi ro vừa được /ai-review phát hiện. Không tạo/sửa DB, chỉ trả clauses mới
    để FE hiển thị + người dùng tự bấm Lưu."""
    try:
        clauses = [c.model_dump() for c in payload.clauses]
        refined = await refine_contract_draft(clauses, payload.findings)
        return BaseResponse(success=True, data={"clauses": refined})
    except RuntimeError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── OCR reconciliation ("Ghi nhận hợp đồng có sẵn" - đối chiếu file hợp đồng
#    đã upload với số liệu THẬT của báo giá đã chọn) ──────────────────────────

@contracts_router.post("/ocr-reconcile")
async def contracts_ocr_reconcile(
    file: UploadFile = File(...),
    quote_id: str = Form(...),
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Đọc file hợp đồng vừa upload (PDF/ảnh), trích xuất best-effort số hợp
    đồng/ngày ký/3 mốc tiền (Trước VAT/VAT/Sau VAT), rồi so với số liệu THẬT
    của báo giá `quote_id` đã chọn trên form. Dùng lại đúng quyền đọc báo giá
    đã áp dụng ở GET /quotes/{quote_id} (quotes_get trong quote.py) - báo giá
    đã duyệt/xác nhận thì ai đăng nhập cũng xem được, chưa duyệt thì phải có
    quyền sửa báo giá đó (can_edit_quote) mới được đối chiếu.

    KHÔNG bịa dữ liệu: nếu không đọc được nội dung file, trả extractable=False
    và data.comparison rỗng - FE phải hiển thị honest message, không dựng bảng
    so sánh giả."""
    try:
        quote = get_quote(quote_id)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))

    lead = get_customer_lead_by_id(quote["dealId"]) if quote.get("dealId") else None
    if quote.get("status") not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
        return BaseResponse(success=False, message="Không có quyền xem báo giá này")

    try:
        file_bytes = await file.read()
        extracted = await extract_contract_summary(file_bytes, file.filename or "")
        # Hop dong dang VND: bao gia USD so sanh theo gia tri quy doi VND (ty gia DA CHOT cua bao gia).
        def _vnd(amount):
            if amount is None or str(quote.get("currency") or "VND").upper() == "VND":
                return amount
            return quote_amount_to_vnd(amount, quote.get("currency"), quote.get("exchangeRate"))

        comparison = compare_to_quote(
            extracted,
            _vnd(quote.get("subtotalAmount")),
            _vnd(quote.get("vatAmount")),
            _vnd(quote.get("totalAmount")),
        )
        return BaseResponse(
            success=True,
            data={
                "extracted": extracted,
                "comparison": comparison["rows"],
                "allMatched": comparison["allMatched"],
                "extractable": extracted.get("extractable", False),
            },
        )
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
