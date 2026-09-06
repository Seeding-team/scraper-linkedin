"""Quote Forms + Quotes endpoints — real báo giá gắn với customer_leads (CRM deal).

CRUD nội bộ dùng auth hiện có (get_current_user). Endpoint public (form/quote qua
token) không yêu cầu auth — dùng cho trang public không đăng nhập.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    QuoteCreateRequest,
    QuoteFormCreateRequest,
    QuoteFormUpdateRequest,
    QuoteUpdateRequest,
    QuoteFormCatalogLinksSetRequest,
    IssuerCompanyCreateRequest,
    IssuerCompanyUpdateRequest,
)
from app.modules.all_platform.services import (
    approve_quote,
    create_quote,
    create_quote_form,
    create_quote_version,
    delete_quote,
    delete_quote_form,
    duplicate_quote_form,
    get_public_quote,
    get_public_quote_form,
    get_quote,
    get_quote_form,
    list_quote_forms,
    list_quote_versions,
    list_quotes,
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
)
from app.modules.all_platform.services.crm_permission_service import can_approve_quote, can_edit_quote
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
def quotes_list(deal_id: str | None = Query(None), _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_quotes(deal_id))
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
        return BaseResponse(success=True, data=quote)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("")
def quotes_create(payload: QuoteCreateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = create_quote(payload.model_dump(), user.get("id"))
        return BaseResponse(success=True, message="Đã tạo báo giá", data=data)
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
        data = update_quote(quote_id, payload.model_dump(exclude_none=True), user.get("id"))
        return BaseResponse(success=True, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.delete("/{quote_id}")
def quotes_delete(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền xoá báo giá này")
        delete_quote(quote_id)
        return BaseResponse(success=True)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/approve")
def quotes_approve(quote_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Duyệt báo giá - chặn quyền THẬT ở backend (không chỉ ẩn nút frontend)."""
    try:
        if not can_approve_quote(user):
            return BaseResponse(success=False, message="Bạn không có quyền duyệt báo giá")
        data = approve_quote(quote_id, user.get("id"))
        return BaseResponse(success=True, message="Đã duyệt báo giá", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@quotes_router.post("/{quote_id}/update-and-approve")
def quotes_update_and_approve(quote_id: str, payload: QuoteUpdateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    """Dùng khi bấm "Duyệt báo giá" ngay trong modal đang sửa - lưu thay đổi cuối
    + duyệt atomic trong 1 transaction (xem quote_update_and_approve RPC)."""
    try:
        if not can_approve_quote(user):
            return BaseResponse(success=False, message="Bạn không có quyền duyệt báo giá")
        quote, lead = _load_quote_and_lead(quote_id)
        if not can_edit_quote(user, quote, lead):
            return BaseResponse(success=False, message="Không có quyền chỉnh sửa báo giá này")
        data = update_and_approve_quote(quote_id, payload.model_dump(exclude_none=True), user.get("id"))
        return BaseResponse(success=True, message="Đã duyệt báo giá", data=data)
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
        return BaseResponse(success=True, data=list_quote_versions(quote["versionChainId"]))
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
