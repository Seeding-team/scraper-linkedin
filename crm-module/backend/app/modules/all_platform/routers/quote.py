"""Quote Forms + Quotes endpoints — real báo giá gắn với customer_leads (CRM deal).

CRUD nội bộ dùng auth hiện có (get_current_user). Endpoint public (form/quote qua
token) không yêu cầu auth — dùng cho trang public không đăng nhập.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    QuoteCreateRequest,
    QuoteFormCreateRequest,
    QuoteFormUpdateRequest,
    QuoteUpdateRequest,
    QuoteStageUpdateRequest,
    QuoteOwnersUpdateRequest,
    QuoteVersionReasonRequest,
    QuoteHandoffChecklistUpdateRequest,
    QuoteCancelRequest,
    QuoteSoftDeleteRequest,
    QuoteHardDeleteRequest,
    QuoteRequestChangesRequest,
    QuoteApproveRequest,
    QuoteFormCatalogLinksSetRequest,
    IssuerCompanyCreateRequest,
    IssuerCompanyUpdateRequest,
)
from app.modules.all_platform.services import (
    QuoteNotFoundError,
    approve_quote,
    publish_quote,
    cancel_quote,
    revoke_public_quote,
    soft_delete_quote,
    restore_quote,
    hard_delete_quote,
    request_quote_changes,
    create_quote,
    create_quote_form,
    create_quote_version,
    delete_quote_form,
    duplicate_quote_form,
    get_public_quote,
    get_public_quote_form,
    get_quote,
    get_quote_form,
    list_quote_forms,
    list_quote_versions,
    list_quotes,
    list_quotes_by_phase,
    share_quote_form,
    update_and_approve_quote,
    update_quote,
    update_quote_form,
    get_quote_form_catalog_links,
    set_quote_form_catalog_links,
    get_service_catalog_options_for_form,
    list_issuer_companies,
    create_issuer_company,
    update_issuer_company,
    send_quote_to_telegram,
    get_quote_telegram_log,
    set_quote_processing_stage,
    assign_quote_owner,
    get_quote_handoff_checklist,
    save_quote_handoff_checklist,
    list_quote_activity_log,
    log_quote_version_reason,
)
from app.modules.all_platform.services.supabase_quote_service import apply_quote_field_permissions
from app.modules.all_platform.services.crm_permission_service import (
    can_approve_quote,
    can_edit_quote,
    can_edit_technical_quote,
    can_edit_quote_pricing,
    can_transition_quote_stage,
    can_manage_quote_email_settings,
    can_send_quote_email,
    can_manage_quote_approval_rules,
)
from app.modules.all_platform.services import quote_rule_evaluation_service
from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id

quote_forms_router = APIRouter()
quotes_router = APIRouter()


# ── Quote Forms ────────────────────────────────────────────────────────────

@quote_forms_router.get("")
def quote_forms_list(status: str | None = Query(None), _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_quote_forms(status))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.get("/public/{token}")
def quote_forms_get_public(token: str) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_public_quote_form(token))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.get("/{form_id}")
def quote_forms_get(form_id: str, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_quote_form(form_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.post("")
def quote_forms_create(payload: QuoteFormCreateRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = create_quote_form(payload.model_dump())
        return BaseResponse(success=True, message="Đã tạo mẫu báo giá", data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.put("/{form_id}")
def quote_forms_update(form_id: str, payload: QuoteFormUpdateRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = update_quote_form(form_id, payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Đã lưu mẫu báo giá", data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.delete("/{form_id}")
def quote_forms_delete(form_id: str, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = delete_quote_form(form_id)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.post("/{form_id}/duplicate")
def quote_forms_duplicate(form_id: str, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = duplicate_quote_form(form_id)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.post("/{form_id}/share")
def quote_forms_share(form_id: str, enabled: bool = True, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = share_quote_form(form_id, enabled)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.get("/{form_id}/catalog-links")
def quote_forms_get_catalog_links(form_id: str, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_quote_form_catalog_links(form_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quote_forms_router.put("/{form_id}/catalog-links")
def quote_forms_set_catalog_links(
    form_id: str, payload: QuoteFormCatalogLinksSetRequest, _user: dict = Depends(get_current_user)
) -> BaseResponse:
    try:
        data = set_quote_form_catalog_links(form_id, payload.catalog_item_ids)
        return BaseResponse(success=True, message="Đã lưu danh mục dịch vụ áp dụng", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Quotes ─────────────────────────────────────────────────────────────────

@quotes_router.get("")
def quotes_list(deal_id: str | None = Query(None), user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = [apply_quote_field_permissions(quote, user) for quote in list_quotes(deal_id)]
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/by-phase")
def quotes_list_by_phase(
    phase: str | None = Query(None),
    search: str | None = Query(None),
    customer_id: str | None = Query(None),
    project_id: str | None = Query(None),
    technical_owner_id: str | None = Query(None),
    quote_owner_id: str | None = Query(None),
    owner_id: str | None = Query(None),
    mine: bool = Query(False),
    team_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sla: str | None = Query(None, description="'overdue' | 'due_soon' - Section 7 KPI SLA, loc TRUOC pagination"),
    quote_type: list[str] | None = Query(None, description="code cua crm_quote_type, co the truyen nhieu lan (OR); '__unclassified__' = chua gan Loai bao gia nao"),
    page: int = Query(1),
    page_size: int = Query(10),
    _user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Danh sach Quote Center THAT: gom theo version_chain_id, loc theo
    phase (presale/sale_markup/admin_review/ready_to_send/sent) suy tu
    processing_stage/status/sent_at that. TOAN BO filter (customer/project/
    owner/team/mine/thoi gian/tim kiem/sla) ap dung o day TRUOC pagination -
    khong con filter tren du lieu 1 trang da tra ve."""
    try:
        result = list_quotes_by_phase(
            phase=phase,
            search=search,
            customer_id=customer_id,
            project_id=project_id,
            technical_owner_id=technical_owner_id,
            quote_owner_id=quote_owner_id,
            owner_id=owner_id,
            mine_user_id=_user.get("id") if mine else None,
            team_id=team_id,
            date_from=date_from,
            date_to=date_to,
            sla=sla,
            quote_types=quote_type,
            page=page,
            page_size=page_size,
        )
        result["items"] = [apply_quote_field_permissions(quote, _user) for quote in result.get("items") or []]
        return BaseResponse(success=True, data=result)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/public/{token}")
def quotes_get_public(token: str) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_public_quote(token))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/service-catalog-options")
def quotes_service_catalog_options(form_id: str = Query(..., alias="formId"), _user: dict = Depends(get_current_user)) -> BaseResponse:
    """Danh sách gói (bundle) + dịch vụ thành phần (component) khả dụng cho 1 mẫu
    báo giá, dùng dựng dropdown khi điền báo giá. Phải đăng ký TRƯỚC /{quote_id}
    để không bị FastAPI khớp nhầm "service-catalog-options" thành quote_id."""
    try:
        return BaseResponse(success=True, data=get_service_catalog_options_for_form(form_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/issuer-companies")
def quotes_issuer_companies(
    include_inactive: bool = Query(False), _user: dict = Depends(get_current_user)
) -> BaseResponse:
    """Danh sách công ty phát hành báo giá (bên bán) dùng ở Bước 1 wizard tạo báo
    giá (mặc định chỉ active) và trang quản trị danh mục (include_inactive=true).
    Phải đăng ký TRƯỚC /{quote_id} để không bị FastAPI khớp nhầm thành quote_id."""
    try:
        return BaseResponse(success=True, data=list_issuer_companies(include_inactive))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/issuer-companies")
def quotes_issuer_companies_create(
    payload: IssuerCompanyCreateRequest, _user: dict = Depends(get_current_user)
) -> BaseResponse:
    try:
        data = create_issuer_company(payload.model_dump())
        return BaseResponse(success=True, message="Đã tạo công ty phát hành", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.put("/issuer-companies/{company_id}")
def quotes_issuer_companies_update(
    company_id: str, payload: IssuerCompanyUpdateRequest, _user: dict = Depends(get_current_user)
) -> BaseResponse:
    try:
        data = update_issuer_company(company_id, payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Đã lưu công ty phát hành", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# Field-level authorization cho PUT /quotes/{id} (RPC quote_update luon
# XOA+CHEN LAI toan bo items - khong co "sua 1 field") - dung yeu cau audit
# "kiem tra endpoint update item hien tai co cho gui dong thoi cost + markup
# hay khong... backend phai field-level authorize". So sanh item MOI (payload,
# snake_case) voi item CU (quote da luu, camelCase) theo TUNG VI TRI (RPC
# thay toan bo theo thu tu, khong theo id) - neu co thay doi o nhom field
# KY THUAT (scope/quantity/gia von) ma user KHONG co quyen ky thuat, hoac
# nhom field GIA BAN (markup/gia khach/chiet khau/VAT) ma user KHONG co
# quyen gia ban, thi tu choi TRUOC KHI goi RPC.
_TECHNICAL_ITEM_FIELD_PAIRS = [
    ("description", "description"),
    ("serviceDescription", "service_description"),
    ("unit", "unit"),
    ("quantity", "quantity"),
    ("costPrice", "cost_price"),
    ("costNotApplicable", "cost_not_applicable"),
]
_PRICING_ITEM_FIELD_PAIRS = [
    ("unitPrice", "unit_price"),
    ("discountPercent", "discount_percent"),
    ("markupPercent", "markup_percent"),
    ("vatRate", "vat_rate"),
]
# cost_price/cost_not_applicable rieng (khac _TECHNICAL_ITEM_FIELD_PAIRS o
# tren) - CHI 2 field nay bi khoa theo buoc, description/unit/quantity trong
# nhom _TECHNICAL_ITEM_FIELD_PAIRS van sua duoc tu Buoc 1 (khong doi hanh vi).
_COST_ONLY_ITEM_FIELD_PAIRS = [
    ("costPrice", "cost_price"),
    ("costNotApplicable", "cost_not_applicable"),
]


def _values_differ(old_val, new_val) -> bool:
    if isinstance(old_val, (int, float)) or isinstance(new_val, (int, float)):
        try:
            return float(old_val or 0) != float(new_val or 0)
        except (TypeError, ValueError):
            return old_val != new_val
    return (old_val or None) != (new_val or None)


def _items_touch_fields(existing_items: list[dict], new_items: list[dict], field_pairs: list[tuple[str, str]]) -> bool:
    if len(new_items) != len(existing_items):
        return True  # them/bot hang muc - tinh la thay doi ky thuat (so luong), khong phai gia
    for i, new_item in enumerate(new_items):
        existing = existing_items[i] if i < len(existing_items) else {}
        for camel, snake in field_pairs:
            if _values_differ(existing.get(camel), new_item.get(snake)):
                return True
    return False


def _check_item_field_level_permission(user: dict, quote: dict, new_items: Optional[list]) -> Optional[str]:
    """Tra ve None neu OK, hoac 1 thong bao loi tieng Viet neu bi tu choi.

    Ngoai quyen theo VAI TRO (co san tu truoc), them khoa theo BUOC
    (processingStage) cho dung 2 nhom field hep hon (Gia von / Markup+Gia
    khach) - yeu cau moi (SUA LAI lan 2, bo han ngoai le Admin/Leader): Buoc 1
    (request) chi duoc dien Hang muc+SL, CHUA duoc dien Gia von; tu Buoc 2
    (technical) tro di moi dien duoc Gia von; Markup/Gia khach CHI dien duoc
    dung o Buoc 3 (pricing). Khoa nay ap dung cho TAT CA, KHONG con ngoai le
    Admin/Leader (khac han_full_crm_access o cac quyen SUA khac trong file
    nay - day la khoa THEO BUOC, khong phai khoa theo VAI TRO)."""
    if new_items is None:
        return None
    existing_items = quote.get("items") or []
    if _items_touch_fields(existing_items, new_items, _TECHNICAL_ITEM_FIELD_PAIRS) and not can_edit_technical_quote(user, quote):
        return "Không có quyền sửa phần kỹ thuật (mô tả/số lượng/giá vốn) của báo giá này"
    if _items_touch_fields(existing_items, new_items, _PRICING_ITEM_FIELD_PAIRS) and not can_edit_quote_pricing(user, quote):
        return "Không có quyền sửa phần giá bán (markup/chiết khấu/giá khách) của báo giá này"

    stage = quote.get("processingStage") or "request"
    if _items_touch_fields(existing_items, new_items, _COST_ONLY_ITEM_FIELD_PAIRS) and stage == "request":
        return "Giá vốn chỉ được nhập từ Bước 2 (Thông tin kỹ thuật) trở đi"
    if _items_touch_fields(existing_items, new_items, _PRICING_ITEM_FIELD_PAIRS) and stage != "pricing":
        return "Markup/Giá khách chỉ được nhập ở Bước 3 (Hoàn thiện giá bán)"
    return None


def _not_found_response(exc: QuoteNotFoundError) -> JSONResponse:
    """HTTP 404 THAT (khong phai 200 + success:false nhu quy uoc chung) -
    body van dung dung hinh dang {success,message} de frontend doc duoc qua
    nhanh `!res.ok` da co san (xem SeedingQuoteRepository.ts), khong dung
    FastAPI HTTPException(detail=...) vi shape khac ({detail} thay vi
    {message}) se lam frontend khong doc duoc ly do that."""
    return JSONResponse(status_code=404, content={"success": False, "message": str(exc)})


def _load_quote_and_lead(quote_id: str) -> tuple[dict, dict | None]:
    quote = get_quote(quote_id)
    lead = get_customer_lead_by_id(quote["dealId"]) if quote.get("dealId") else None
    return quote, lead


@quotes_router.get("/{quote_id}")
def quotes_get(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        # Bao gia da duyet/confirmed (da co link public) thi ai dang nhap cung
        # xem noi bo duoc nhu truoc gio - chi bao gia CHUA duyet moi gioi han
        # theo nhom quyen (nguoi tao/quan ly deal/phu trach deal/co quyen duyet/admin).
        if quote["status"] not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        return BaseResponse(success=True, data=apply_quote_field_permissions(quote, user))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("")
def quotes_create(payload: QuoteCreateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = create_quote(payload.model_dump(), user.get("id"))
        return BaseResponse(success=True, message="Đã tạo báo giá", data=apply_quote_field_permissions(data, user))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.put("/{quote_id}")
def quotes_update(quote_id: str, payload: QuoteUpdateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền chỉnh sửa báo giá này")
        dump = payload.model_dump(exclude_none=True)
        # Bug that da gap: exclude_none=True xoa het field client gui RO
        # RANG la null (vd "bo gan Du an" = gui project_id=null CO Y) khoi
        # dump, khien no lam y het "khong gui gi ca" (giu nguyen gia tri
        # cu) - nguoi dung KHONG THE go Project ra duoc nua. Dung
        # model_fields_set (Pydantic v2 - field co mat trong body request,
        # bat ke gia tri) de phan biet that "khong gui" voi "gui null co y",
        # CHI ap dung rieng cho project_id/sla_due_at (khong doi hanh vi cac
        # field khac, tranh vo tinh lam field khac bi clear ngoai y muon).
        fields_set = payload.model_fields_set
        if "project_id" in fields_set:
            dump["project_id"] = payload.project_id
        if "sla_due_at" in fields_set:
            dump["sla_due_at"] = payload.sla_due_at
        if "overall_discount_percent" in fields_set:
            dump["overall_discount_percent"] = payload.overall_discount_percent
        if "quote_type_codes" in fields_set:
            dump["quote_type_codes"] = payload.quote_type_codes
        denied = _check_item_field_level_permission(user, quote, dump.get("items"))
        if denied:
            return BaseResponse(success=False, message=denied)
        data = update_quote(quote_id, dump, user.get("id"))
        return BaseResponse(success=True, data=apply_quote_field_permissions(data, user))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.delete("/{quote_id}")
def quotes_delete(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """SUA LAI (audit): endpoint nay TRUOC DAY goi delete_quote() - HARD DELETE
    that su (DELETE FROM quotes, khong deleted_at, KHONG ghi audit) cho BAT KY
    ai co quyen sua quote (khong rieng admin) - vi pham yeu cau "xoa thuong
    phai la soft delete, hard delete chi danh cho Admin qua endpoint rieng".
    Doi sang goi CHINH RPC quote_soft_delete (qua soft_delete_quote()) - dung
    RPC DA CO SAN, DA ghi activity log/audit rieng (xem migration quote_soft_
    delete), KHONG can them logic moi. Hard delete THAT SU van CHI qua
    POST /{quote_id}/hard-delete (admin-only, bat buoc quote_number + reason,
    ghi quote_deletion_audit TRUOC khi xoa) - khong doi, khong lien quan sua
    lan nay."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xoá báo giá này")
        soft_delete_quote(quote_id, user.get("id"), "Xoá báo giá (nháp) qua thao tác thường")
        return BaseResponse(success=True)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


def _guard_exception_approval(quote_id: str, user: dict, exception_reason: str | None) -> BaseResponse | None:
    """Section 5 - Admin duyet ngoai le theo version. Tra ve None neu duoc
    duyet BINH THUONG (rule pass, hoac chua cau hinh rule engine). Tra ve 1
    BaseResponse loi rieng (message co dinh "quote_requires_exception_reason"
    de FE nhan biet va mo modal, KHONG phai loi chung chung) neu evaluation
    gan nhat result != 'pass' VA chua co exception_reason hop le. Neu co
    exception_reason hop le, ghi lai quote_exception_approvals SAU KHI RPC
    duyet thanh cong (goi o noi goi, khong o day - ham nay chi GUARD)."""
    evaluation = quote_rule_evaluation_service.get_latest_evaluation(quote_id)
    if not quote_rule_evaluation_service.requires_exception_reason(evaluation):
        return None
    if not exception_reason or not exception_reason.strip():
        return BaseResponse(
            success=False,
            message="quote_requires_exception_reason",
            data={"evaluation": evaluation},
        )
    return None


@quotes_router.post("/{quote_id}/approve")
def quotes_approve(quote_id: str, payload: QuoteApproveRequest = QuoteApproveRequest(), user: dict = Depends(get_current_user)) -> BaseResponse:
    """Duyệt báo giá - chặn quyền THẬT ở backend (không chỉ ẩn nút frontend).
    Section 5: neu Rule Engine gan nhat cua quote nay KHONG dat ('fail'/
    'insufficient_data'), bat buoc `exception_reason` moi duyet duoc - ghi lai
    quote_exception_approvals + activity 'approved_with_exception' SAU KHI
    duyet RPC thanh cong (khong ghi truoc, tranh audit "duyet ngoai le" cho 1
    lan duyet that ra da that bai)."""
    try:
        if not can_approve_quote(user):
            return BaseResponse(success=False, message="Bạn không có quyền duyệt báo giá")
        guard = _guard_exception_approval(quote_id, user, payload.exception_reason)
        if guard is not None:
            return guard
        evaluation = quote_rule_evaluation_service.get_latest_evaluation(quote_id)
        data = approve_quote(quote_id, user.get("id"))
        if quote_rule_evaluation_service.requires_exception_reason(evaluation) and payload.exception_reason:
            quote_rule_evaluation_service.record_exception_approval(
                quote_id, data.get("versionNumber") or 1, evaluation.get("id"),
                payload.exception_reason.strip(), user.get("id"),
            )
        return BaseResponse(success=True, message="Đã duyệt báo giá", data=apply_quote_field_permissions(data, user))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/update-and-approve")
def quotes_update_and_approve(
    quote_id: str, payload: QuoteUpdateRequest, user: dict = Depends(get_current_user),
    exception_reason: str | None = Query(None, description="Bat buoc neu Rule Engine gan nhat khong dat (Section 5)"),
) -> BaseResponse:
    """Dùng khi bấm "Duyệt báo giá" ngay trong modal đang sửa - lưu thay đổi cuối
    + duyệt atomic trong 1 transaction (xem quote_update_and_approve RPC)."""
    try:
        if not can_approve_quote(user):
            return BaseResponse(success=False, message="Bạn không có quyền duyệt báo giá")
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền chỉnh sửa báo giá này")
        guard = _guard_exception_approval(quote_id, user, exception_reason)
        if guard is not None:
            return guard
        evaluation = quote_rule_evaluation_service.get_latest_evaluation(quote_id)
        data = update_and_approve_quote(quote_id, payload.model_dump(exclude_none=True), user.get("id"))
        if quote_rule_evaluation_service.requires_exception_reason(evaluation) and exception_reason:
            quote_rule_evaluation_service.record_exception_approval(
                quote_id, data.get("versionNumber") or 1, evaluation.get("id"), exception_reason.strip(), user.get("id"),
            )
        return BaseResponse(success=True, message="Đã duyệt báo giá", data=apply_quote_field_permissions(data, user))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/create-version")
def quotes_create_version(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Tạo phiên bản mới (V2/V3...) từ bản ĐÃ DUYỆT mới nhất trong chuỗi của
    quote_id được bấm - có thể redirect (khác source_quote_id) hoặc trả về bản
    nháp có sẵn thay vì tạo mới (data["created"] = False), xem
    quote_create_version RPC. Quyền: giống quyền sửa báo giá của deal đó, KHÔNG
    dùng quyền duyệt (tạo bản nháp mới không phải hành động duyệt)."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền tạo phiên bản báo giá này")
        data = create_quote_version(quote_id, user.get("id"))
        data["quote"] = apply_quote_field_permissions(data["quote"], user)
        message = "Đã tạo phiên bản mới" if data["created"] else "Chuỗi đã có bản nháp, mở bản nháp đó"
        return BaseResponse(success=True, message=message, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/{quote_id}/versions")
def quotes_list_versions(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if quote["status"] not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        versions = [apply_quote_field_permissions(v, user) for v in list_quote_versions(quote["versionChainId"])]
        return BaseResponse(success=True, data=versions)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/processing-stage")
def quotes_set_processing_stage(
    quote_id: str, payload: QuoteStageUpdateRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    """Phase 2 workspace - chuyen buoc xu ly noi bo (Yeu cau bao gia/Thong tin
    ky thuat/Hoan thien gia ban/Cho duyet). Quyen tach theo dung nguoi phu
    trach buoc do (can_transition_quote_stage - migration 087/089), khong
    con dung chung can_edit_quote nhu truoc (ai sua duoc bao gia cung chuyen
    stage duoc)."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_transition_quote_stage(user, quote, payload.stage):
            return BaseResponse(success=False, message="Không có quyền chuyển bước xử lý này")
        data = set_quote_processing_stage(quote_id, user.get("id"), payload.stage)

        # Hoan tat gia ban (pricing->review) - danh gia Rule engine THAT (neu
        # da cau hinh) va ghi lai snapshot, dung yeu cau "Khi bam Hoan tat
        # phan gia ban -> evaluate active rule set -> luu evaluation snapshot".
        # Auto-approve CHI xay ra khi rule-set BAT auto_approve_enabled VA
        # dat DU 4/4 rule required - khong bao gio tu phat hanh/tu gui kem theo.
        if payload.stage == "review":
            try:
                evaluation = quote_rule_evaluation_service.evaluate_and_record(data, user.get("id"))
            except Exception:
                evaluation = None
            if quote_rule_evaluation_service.should_auto_approve(evaluation):
                try:
                    data = approve_quote(quote_id, user.get("id"))
                    quote_rule_evaluation_service.record_auto_approve_activity(quote_id, user.get("id"), evaluation)
                except Exception:
                    pass  # Rule dat nhung approve that bai vi ly do khac (vd da approved) - giu nguyen o 'review', khong chan luong chinh.

        return BaseResponse(success=True, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/request-changes")
def quotes_request_changes(
    quote_id: str, payload: QuoteRequestChangesRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    """Yeu cau chinh sua (Phase 3.B) - chi nguoi co quyen duyet (approver/
    manager) moi tra bao gia lui ve Thong tin ky thuat/Gia ban duoc."""
    try:
        if not can_approve_quote(user):
            return BaseResponse(success=False, message="Bạn không có quyền yêu cầu chỉnh sửa báo giá này")
        data = request_quote_changes(quote_id, user.get("id"), payload.target_stage, payload.reason)
        return BaseResponse(success=True, message="Đã gửi yêu cầu chỉnh sửa", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/publish")
def quotes_publish(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Phat hanh bao gia da duyet (Phase 3.F) - tach rieng khoi /approve, chi
    quote da status='approved' moi phat hanh duoc (xem quote_publish RPC)."""
    try:
        if not can_approve_quote(user):
            return BaseResponse(success=False, message="Bạn không có quyền phát hành báo giá")
        data = publish_quote(quote_id, user.get("id"))
        return BaseResponse(success=True, message="Đã phát hành báo giá", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/cancel")
def quotes_cancel(quote_id: str, payload: QuoteCancelRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Huy bao gia (Phase 1) - khong hard-delete, bat buoc ly do, tu tat public
    link (xem quote_cancel RPC)."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền huỷ báo giá này")
        data = cancel_quote(quote_id, user.get("id"), payload.reason)
        return BaseResponse(success=True, message="Đã huỷ báo giá", data=data)
    except QuoteNotFoundError as e:
        return _not_found_response(e)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/revoke-public")
def quotes_revoke_public(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Huy cong khai (Phase 1) - tat public link, KHONG xoa quote. Public API
    tra ve khong truy cap duoc ngay sau khi goi (get_public_quote da loc
    public_enabled=True)."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền huỷ công khai báo giá này")
        data = revoke_public_quote(quote_id, user.get("id"))
        return BaseResponse(success=True, message="Đã huỷ công khai báo giá", data=data)
    except QuoteNotFoundError as e:
        return _not_found_response(e)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/soft-delete")
def quotes_soft_delete(quote_id: str, payload: QuoteSoftDeleteRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Xoa mem (Phase 1) - list/get/public/version deu tu loai quote da xoa
    (xem list_quotes/get_quote/get_public_quote/list_quote_versions), khoi
    phuc duoc qua /restore."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xoá báo giá này")
        data = soft_delete_quote(quote_id, user.get("id"), payload.reason)
        return BaseResponse(success=True, message="Đã xoá báo giá (có thể khôi phục)", data=data)
    except QuoteNotFoundError as e:
        return _not_found_response(e)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/restore")
def quotes_restore(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        # Quote da bi soft-delete se KHONG con thay qua get_quote() mac dinh
        # (loc deleted_at IS NULL) - phai doc voi include_deleted=True rieng
        # o day, khong dung _load_quote_and_lead() dung chung.
        quote = get_quote(quote_id, include_deleted=True)
        lead = get_customer_lead_by_id(quote["dealId"]) if quote.get("dealId") else None
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền khôi phục báo giá này")
        data = restore_quote(quote_id, user.get("id"))
        return BaseResponse(success=True, message="Đã khôi phục báo giá", data=data)
    except QuoteNotFoundError as e:
        return _not_found_response(e)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/hard-delete")
def quotes_hard_delete(
    quote_id: str, payload: QuoteHardDeleteRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    """Xoa VINH VIEN (Phase 1) - CHI admin THAT (khong tinh leader, khac
    require_admin() dung chung o auth_deps.py dang cho ca leader) - endpoint
    nay KHONG duoc goi tu UI thong thuong, chi danh cho cong cu quan tri.
    Backend tu doc lai quote_number va doi chieu voi payload.quote_number
    truoc khi ghi quote_deletion_audit roi moi DELETE that, cung 1
    transaction (xem quote_hard_delete RPC, migration 089)."""
    try:
        role = str(user.get("role") or "").strip().lower()
        if role != "admin":
            return BaseResponse(success=False, message="Chỉ Admin mới được xoá vĩnh viễn báo giá")
        current = get_quote(quote_id, include_deleted=True)
        if current["quoteNumber"] != payload.quote_number:
            return BaseResponse(success=False, message="Mã báo giá xác nhận không khớp — huỷ thao tác để an toàn")
        hard_delete_quote(quote_id, user.get("id"), payload.quote_number, payload.reason, payload.request_id)
        return BaseResponse(success=True, message="Đã xoá vĩnh viễn báo giá")
    except QuoteNotFoundError as e:
        return _not_found_response(e)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/owners")
def quotes_assign_owners(
    quote_id: str, payload: QuoteOwnersUpdateRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    """Gan nguoi phu trach ky thuat / nguoi phu trach bao gia. Field khong gui
    (khong nam trong model_fields_set) = khong doi; gui null that su = bo gan."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền cập nhật báo giá này")
        fields_set = payload.model_fields_set
        data = assign_quote_owner(
            quote_id, user.get("id"),
            technical_owner_id=payload.technical_owner_id,
            quote_owner_id=payload.quote_owner_id,
            assign_technical="technical_owner_id" in fields_set,
            assign_quote_owner_field="quote_owner_id" in fields_set,
        )
        return BaseResponse(success=True, data=apply_quote_field_permissions(data, user))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/{quote_id}/handoff-checklist")
def quotes_get_handoff_checklist(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if quote["status"] not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        return BaseResponse(success=True, data=get_quote_handoff_checklist(quote_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.put("/{quote_id}/handoff-checklist")
def quotes_save_handoff_checklist(
    quote_id: str, payload: QuoteHandoffChecklistUpdateRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền cập nhật báo giá này")
        data = save_quote_handoff_checklist(quote_id, user.get("id"), payload.model_dump())
        return BaseResponse(success=True, message="Đã lưu bàn giao kỹ thuật", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/{quote_id}/activity-log")
def quotes_get_activity_log(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if quote["status"] not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        return BaseResponse(success=True, data=list_quote_activity_log(quote_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/version-reason")
def quotes_log_version_reason(
    quote_id: str, payload: QuoteVersionReasonRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    """Ghi ly do tao phien ban (popup "Tao phien ban moi") vao activity log -
    goi SAU KHI da tao version thanh cong, gan vao quote_id cua BAN MOI."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền cập nhật báo giá này")
        log_quote_version_reason(quote_id, user.get("id"), payload.reason)
        return BaseResponse(success=True, data=list_quote_activity_log(quote_id))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.get("/{quote_id}/telegram-log")
def quotes_get_telegram_log(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if quote["status"] not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        return BaseResponse(success=True, data=get_quote_telegram_log(quote_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/send-telegram")
def quotes_send_telegram(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Gửi báo giá đã duyệt qua Telegram (group "Markee Team", topic "Báo giá"
    cố định — xem quote_telegram_service.py). Ai xem được báo giá thì gửi
    được (đúng logic quyền xem đã dùng cho GET /{quote_id})."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if quote["status"] not in ("approved", "confirmed") and not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền gửi báo giá này")
        data = send_quote_to_telegram(quote_id, user.get("id"))
        return BaseResponse(success=True, message="Đã gửi báo giá qua Telegram", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ─────────────────────────────────────────────────────────────────────────
# Cấu hình kênh gửi email báo giá (Gmail IMAP/SMTP) — CHỈ Admin/Leader (dùng
# can_manage_quote_email_settings() tập trung, KHÔNG inline role check rải
# rác — mọi endpoint dưới đây đều raise HTTPException(403) thật, không phải
# BaseResponse(success=False) 200, để đúng yêu cầu "Backend trả 403", "Không
# chỉ ẩn menu"). Migration 092 (quote_delivery_channels). Router riêng,
# KHÔNG lồng trong quotes_router (path không có {quote_id} — đây là cấu
# hình chung 1 lần, không gắn 1 báo giá cụ thể nào).
# ─────────────────────────────────────────────────────────────────────────
from pydantic import BaseModel  # noqa: E402
from app.modules.all_platform.services import quote_email_provider_service as email_provider_service  # noqa: E402


def _safe_error_message(exc: Exception, fallback: str = "Đã xảy ra lỗi không xác định ở máy chủ.") -> str:
    """Helper CHUNG (dung yeu cau "tranh sua rai rac roi tai phat") - mot so
    exception (vd cryptography.fernet.InvalidToken) khong co message
    (str(exc) rong). Neu de rot thang xuong BaseResponse(success=False,
    message=str(e)) se tao dung bug that da gap: HTTP 200 + success=false +
    message rong, frontend tu bia ra "Lỗi máy chủ (200)" vo nghia. Luon tra
    ve 1 chuoi KHONG RONG."""
    text = str(exc).strip()
    return text or fallback


quote_email_provider_router = APIRouter()


def require_quote_email_manager(user: dict = Depends(get_current_user)) -> dict:
    """403 that (khong phai BaseResponse 200) neu user khong phai admin/
    leader - dung 1 diem duy nhat cho toan bo endpoint cau hinh kenh gui
    email (GET/PUT/xoa credential/test IMAP/SMTP/bat-tat), KHONG inline
    role check rieng trong tung ham. Anonymous da bi chan 401 tu truoc do
    boi get_current_user() (Depends xay ra truoc ham nay chay)."""
    if not can_manage_quote_email_settings(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin hoặc Leader mới được cấu hình kênh gửi email")
    return user


class EmailProviderSaveRequest(BaseModel):
    sender_address: str
    sender_name: str = ""
    # rỗng/None = giữ nguyên App Password đã lưu trước đó (không ghi đè).
    app_password: Optional[str] = None


class EmailProviderTestRequest(BaseModel):
    # Cho phép test TRƯỚC KHI lưu (nhập tạm, không ghi DB) - rỗng thì test
    # bằng credential đã lưu.
    sender_address: Optional[str] = None
    app_password: Optional[str] = None


class EmailProviderSendTestRequest(BaseModel):
    test_recipient: str


@quote_email_provider_router.get("")
def email_provider_get(user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=email_provider_service.get_email_provider_settings())
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.put("")
def email_provider_save(payload: EmailProviderSaveRequest, user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        if not payload.sender_address.strip():
            return BaseResponse(success=False, message="Vui lòng nhập email gửi")
        data = email_provider_service.save_email_provider_settings(
            payload.sender_address, payload.sender_name, payload.app_password, user.get("id")
        )
        email_provider_service.record_audit_log(user, "save_config")
        return BaseResponse(success=True, message="Đã lưu cấu hình email", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.delete("/credentials")
def email_provider_clear_credentials(user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        data = email_provider_service.clear_email_provider_credentials(user.get("id"))
        email_provider_service.record_audit_log(user, "clear_credentials")
        return BaseResponse(success=True, message="Đã xoá thông tin xác thực", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.post("/enable")
def email_provider_enable(user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        data = email_provider_service.set_email_provider_enabled(True, user.get("id"))
        email_provider_service.record_audit_log(user, "enable_channel")
        return BaseResponse(success=True, message="Đã bật kênh gửi báo giá qua email", data=data)
    except email_provider_service.EmailProviderNotConfiguredError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.post("/disable")
def email_provider_disable(user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        data = email_provider_service.set_email_provider_enabled(False, user.get("id"))
        email_provider_service.record_audit_log(user, "disable_channel")
        return BaseResponse(success=True, message="Đã tắt kênh gửi báo giá qua email", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.post("/test-imap")
def email_provider_test_imap(payload: EmailProviderTestRequest, user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        result = email_provider_service.test_imap_connection(payload.sender_address, payload.app_password)
        email_provider_service.record_audit_log(user, "test_imap")
        return BaseResponse(success=result["ok"], message=result["message"])
    except email_provider_service.EmailProviderNotConfiguredError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except ValueError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.post("/test-smtp")
def email_provider_test_smtp(payload: EmailProviderTestRequest, user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        result = email_provider_service.test_smtp_connection(payload.sender_address, payload.app_password)
        email_provider_service.record_audit_log(user, "test_smtp")
        return BaseResponse(success=result["ok"], message=result["message"])
    except email_provider_service.EmailProviderNotConfiguredError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except ValueError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.post("/send-test")
def email_provider_send_test(payload: EmailProviderSendTestRequest, user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    """Gui 1 email THU that toi dung dia chi Admin/Leader nhap trong payload -
    KHONG dung cho gui bao gia khach that (endpoint gui bao gia that dung
    quyen rieng can_send_quote_email(), xem plan 'Phat hanh va gui khach
    that')."""
    try:
        if not payload.test_recipient.strip():
            return BaseResponse(success=False, message="Vui lòng nhập email nhận thử")
        result = email_provider_service.send_test_email(payload.test_recipient.strip())
        email_provider_service.record_audit_log(user, "send_test_email")
        return BaseResponse(success=result["ok"], message=result["message"])
    except email_provider_service.EmailProviderNotConfiguredError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


class QuoteSendRequest(BaseModel):
    recipient_name: Optional[str] = None
    recipient_email: str
    recipient_source: Optional[str] = None
    subject: Optional[str] = None
    message: str = ""
    attach_pdf: bool = False
    idempotency_key: str


@quotes_router.get("/{quote_id}/delivery-log")
def quotes_get_delivery_log(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead) and not can_send_quote_email(user, quote):
            return BaseResponse(success=False, message="Không có quyền xem lịch sử gửi báo giá này")
        from app.modules.all_platform.services import quote_email_delivery_service
        return BaseResponse(success=True, data=quote_email_delivery_service.get_quote_delivery_log(quote_id))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quotes_router.post("/{quote_id}/send")
def quotes_send(quote_id: str, payload: QuoteSendRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Gui bao gia THAT cho khach qua email (xem quote_email_delivery_service.py
    cho toan bo dieu kien validate + luong idempotency/retry)."""
    try:
        from app.modules.all_platform.services import quote_email_delivery_service
        quote, lead = _load_quote_and_lead(quote_id)
        if not payload.recipient_email.strip():
            return BaseResponse(success=False, message="Vui lòng nhập email người nhận")
        if not payload.idempotency_key.strip():
            return BaseResponse(success=False, message="Thiếu idempotency_key")
        data = quote_email_delivery_service.send_quote_email(
            quote=quote,
            deal=lead,
            user=user,
            recipient_name=payload.recipient_name,
            recipient_email=payload.recipient_email.strip(),
            recipient_source=payload.recipient_source,
            message=payload.message,
            attach_pdf=payload.attach_pdf,
            idempotency_key=payload.idempotency_key.strip(),
            subject_override=payload.subject,
        )
        return BaseResponse(success=True, message="Đã gửi báo giá qua email", data=data)
    except quote_email_delivery_service.QuoteSendValidationError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except email_provider_service.EmailProviderNotConfiguredError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except ValueError as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quotes_router.get("/{quote_id}/send-availability")
def quotes_send_availability(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Cho MOI nguoi co quyen gui bao gia nay biet kenh gui san sang hay
    chua - KHONG dung require_quote_email_manager (Member la quote owner
    van phai goi duoc endpoint nay) va KHONG BAO GIO tra ve host/port/email
    ky thuat (chi True/False + 1 cau ly do ngan), khac han GET
    /quotes-email-provider (endpoint do moi tra chi tiet cau hinh, chi
    Admin/Leader)."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_send_quote_email(user, quote):
            return BaseResponse(success=True, data={"available": False, "reason": "Bạn không có quyền gửi báo giá này"})
        try:
            email_provider_service.get_active_email_channel_for_sending()
            return BaseResponse(success=True, data={"available": True, "reason": None})
        except email_provider_service.EmailProviderNotConfiguredError as e:
            return BaseResponse(success=True, data={"available": False, "reason": str(e)})
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quotes_router.get("/{quote_id}/recipient-suggestion")
def quotes_recipient_suggestion(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Goi y nguoi nhan (khong bat buoc dung) - uu tien deal.email, roi
    crm_customers.email (xem resolve_recipient trong
    quote_email_delivery_service.py). KHONG doan neu ca 2 nguon deu rong -
    frontend tu cho nhap tay."""
    try:
        from app.modules.all_platform.services import quote_email_delivery_service
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead) and not can_send_quote_email(user, quote):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        return BaseResponse(success=True, data=quote_email_delivery_service.resolve_recipient(quote, lead, user))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quotes_router.post("/{quote_id}/evaluate-rules")
def quotes_evaluate_rules(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Danh gia lai THAT (khong fake) rule engine cho 1 bao gia - dung khi
    nguoi dung muon xem lai ket qua ngay (vd sau khi sua gia von) ma chua
    chuyen buoc. Ai xem duoc bao gia thi danh gia lai duoc (khong doi trang
    thai gi, chi ghi 1 snapshot moi)."""
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead) and not can_send_quote_email(user, quote):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        evaluation = quote_rule_evaluation_service.evaluate_and_record(quote, user.get("id"))
        if evaluation is None:
            return BaseResponse(success=True, data=None, message="Chưa cấu hình quy tắc phê duyệt")
        return BaseResponse(success=True, data=evaluation)
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quotes_router.get("/{quote_id}/rule-evaluation")
def quotes_get_rule_evaluation(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead) and not can_send_quote_email(user, quote):
            return BaseResponse(success=False, message="Không có quyền xem báo giá này")
        return BaseResponse(success=True, data=quote_rule_evaluation_service.get_latest_evaluation(quote_id))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


# ─────────────────────────────────────────────────────────────────────────
# Rule engine duyet bao gia (migration 091, DA APPLY - bang dang rong, chua
# co rule-set nao, xem readonly_check_migration_090_092.py). GET active mo
# cho MOI nguoi dang nhap (Member xem ket qua/nguong nhung khong sua duoc).
# PUT active CHI Admin (can_manage_quote_approval_rules, 403 that).
# ─────────────────────────────────────────────────────────────────────────
quote_approval_rules_router = APIRouter()


class QuoteApprovalRuleInput(BaseModel):
    ruleType: str
    thresholdValue: float
    isRequired: bool = True
    isActive: bool = True


class QuoteApprovalRuleSetSaveRequest(BaseModel):
    rules: list[QuoteApprovalRuleInput]
    autoApproveEnabled: bool = False
    idempotencyKey: str


@quote_approval_rules_router.get("/active")
def quote_approval_rules_get_active(user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=quote_rule_evaluation_service.get_active_rule_set_for_api())
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_approval_rules_router.put("/active")
def quote_approval_rules_save_active(payload: QuoteApprovalRuleSetSaveRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_quote_approval_rules(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin hoặc Leader mới được cấu hình quy tắc phê duyệt")
    try:
        rules_input = [r.model_dump() for r in payload.rules]
        data = quote_rule_evaluation_service.save_rule_set(rules_input, payload.autoApproveEnabled, user.get("id"), payload.idempotencyKey)
        return BaseResponse(success=True, message="Đã lưu quy tắc phê duyệt", data=data)
    except quote_rule_evaluation_service.RuleValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@quote_email_provider_router.get("/audit-log")
def email_provider_get_audit_log(user: dict = Depends(require_quote_email_manager)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=email_provider_service.get_audit_log())
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
