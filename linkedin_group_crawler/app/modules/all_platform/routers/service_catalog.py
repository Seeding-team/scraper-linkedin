"""Danh mục dịch vụ (Service Catalog) endpoints — group/component/bundle dùng chung
cho các Mẫu báo giá."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    ServiceCatalogItemCreateRequest,
    ServiceCatalogItemUpdateRequest,
    ServiceCatalogItemPricingUpsertRequest,
    ServiceCatalogReorderRequest,
    ServiceCatalogUnitCreateRequest,
    ServiceCatalogUnitUpdateRequest,
    ServiceCatalogVatRateCreateRequest,
    ServiceCatalogVatRateUpdateRequest,
    BundleComponentsSetRequest,
)
from app.modules.all_platform.services import service_catalog_config_service as config_service
from app.modules.all_platform.services import (
    list_service_catalog_items,
    create_service_catalog_item,
    update_service_catalog_item,
    delete_service_catalog_item,
    reorder_service_catalog_item,
    set_bundle_components,
    get_service_catalog_items_by_ids,
)
from app.modules.all_platform.services import supabase_service_catalog_service as catalog_service
from app.modules.all_platform.services.crm_permission_service import (
    can_manage_shared_master_data,
    can_manage_service_catalog_pricing,
    can_view_quote_cost,
)
from app.modules.all_platform.services.supabase_quote_service import get_quote, QuoteNotFoundError

router = APIRouter()
logger = logging.getLogger(__name__)


def _require_master_data_manager(user: dict) -> None:
    if not can_manage_shared_master_data(user):
        raise HTTPException(status_code=403, detail="Forbidden: CRM master data manager role required")


def _resolve_catalog_pricing_visibility(user: dict, context: str, quote_id: Optional[str]) -> tuple[bool, Optional[str]]:
    """Tra ve (co_duoc_xem_cost_markup, issuer_company_id_de_resolve_gia).

    BUG BAO MAT DA SUA (review lan 2, plan truoc bi revert vi ly do khac
    nhung phat hien lai dung diem yeu nay): KHONG con nhanh "chua co
    quote_id van cap cost cho nguoi goi" - bat ky user da dang nhap nao
    cung goi duoc endpoint nay, khong the tin "ho se la owner" ma chua co
    quote that de kiem tra. Gia khach (defaultCustomerPriceVnd) KHONG di qua
    ham nay - luon tra cho moi request da auth (xem service_catalog_get_all)."""
    if context != "quote_picker":
        return can_manage_service_catalog_pricing(user), None

    if not quote_id:
        # Thieu quote_id (du co the co issuer_company_id) - AN TOAN TUYET
        # DOI: khong co ngoai le nao cho "dang tao moi". Frontend phai tao
        # quote draft THAT truoc (xem plan 3.4) roi moi goi lai voi quote_id.
        return False, None

    try:
        quote = get_quote(quote_id)
    except QuoteNotFoundError:
        return False, None
    # issuer LUON lay tu quote THAT, KHONG tin tham so issuer_company_id
    # client tu gui (tranh doc gia cua 1 issuer khac qua quote cua issuer nay).
    return can_view_quote_cost(user, quote), quote.get("issuerCompanyId")


@router.get("")
def service_catalog_get_all(
    context: str = Query("admin", pattern="^(admin|quote_picker)$"),
    quote_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    try:
        tree = list_service_catalog_items()
    except Exception as e:
        return BaseResponse(success=False, message=str(e))

    # Bo gia mac dinh la TINH NANG BO SUNG (migration 107) - loi o buoc nay
    # (vi du migration chua duoc ap dung len DB that) KHONG duoc lam hong ca
    # danh sach danh muc goc (nguoi dung van phai chon duoc san pham binh
    # thuong, chi la chua co gia mac dinh di kem).
    try:
        can_view_cost, resolved_issuer = _resolve_catalog_pricing_visibility(user, context, quote_id)
        item_ids = catalog_service._collect_item_ids(tree)  # noqa: SLF001
        pricing_map = catalog_service.resolve_pricing_map(item_ids, resolved_issuer)
        catalog_service.merge_pricing_into_tree(tree, pricing_map)
        if not can_view_cost:
            catalog_service.strip_cost_markup_fields(tree)
    except Exception:
        logger.exception("service_catalog pricing: khong resolve duoc gia (co the migration 107 chua ap dung) - tra danh muc KHONG kem gia mac dinh, khong lam hong ca request.")

    return BaseResponse(success=True, data=tree)


@router.get("/{item_id}/pricing")
def service_catalog_get_item_pricing(item_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_service_catalog_pricing(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý bộ giá danh mục")
    try:
        return BaseResponse(success=True, data=catalog_service.list_service_catalog_item_pricing(item_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/{item_id}/pricing")
def service_catalog_upsert_item_pricing(
    item_id: str, payload: ServiceCatalogItemPricingUpsertRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    if not can_manage_service_catalog_pricing(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý bộ giá danh mục")
    try:
        data = catalog_service.upsert_service_catalog_item_pricing(
            item_id,
            payload.issuer_company_id,
            payload.default_cost_price_vnd,
            payload.default_markup_percent,
            payload.default_customer_price_vnd,
            payload.pricing_input_mode,
            user.get("id"),
        )
        return BaseResponse(success=True, message="Đã lưu bộ giá", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/lookup")
def service_catalog_lookup(ids: str = Query(..., description="Danh sach id, phan cach boi dau phay"), _user: dict = Depends(get_current_user)) -> BaseResponse:
    """Tra cuu nhieu san pham theo id, dung cho "Ap gia de xuat" o Buoc 2 -
    luon tra lai tu DB (khong cache), de biet dung gia/trang thai hien tai."""
    try:
        item_ids = [i for i in (x.strip() for x in ids.split(",")) if i]
        return BaseResponse(success=True, data=get_service_catalog_items_by_ids(item_ids))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/add")
def service_catalog_add(payload: ServiceCatalogItemCreateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = create_service_catalog_item(payload.model_dump(), user.get("id"))
        return BaseResponse(success=True, message="Đã thêm dịch vụ", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/update")
def service_catalog_update(payload: ServiceCatalogItemUpdateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = update_service_catalog_item(payload.id, payload.model_dump(exclude_none=True), user.get("id"))
        return BaseResponse(success=True, message="Đã cập nhật dịch vụ", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/delete")
def service_catalog_delete(id: str = Query(...), user: dict = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = delete_service_catalog_item(id)
        message = "Da xoa dich vu" if data.get("deleted") else "Dich vu da tung duoc dung - da chuyen sang Ngung su dung"
        return BaseResponse(success=True, message=message, data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/reorder")
def service_catalog_reorder(payload: ServiceCatalogReorderRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = reorder_service_catalog_item(payload.id, payload.direction)
        return BaseResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/{bundle_id}/components")
def service_catalog_set_bundle_components(
    bundle_id: str, payload: BundleComponentsSetRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = set_bundle_components(bundle_id, [item.model_dump() for item in payload.items])
        return BaseResponse(success=True, message="Da cap nhat thanh phan goi", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── "Đơn vị tính & VAT" (migration 117) — master-data thật, tách khỏi các
# endpoint group/component/bundle ở trên. Cùng quyền quản trị với bộ giá mặc
# định (can_manage_service_catalog_pricing) - đây đều là cấu hình cấp quản
# trị của Danh mục dịch vụ, không phải thao tác Sale/Presale thường ngày. ──

@router.get("/units")
def service_catalog_list_units(
    include_inactive: bool = Query(True), _user: dict = Depends(get_current_user)
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=config_service.list_service_catalog_units(include_inactive))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/units")
def service_catalog_create_unit(payload: ServiceCatalogUnitCreateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_service_catalog_pricing(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Đơn vị tính & VAT")
    try:
        data = config_service.create_service_catalog_unit(payload.name, payload.status)
        return BaseResponse(success=True, message="Đã thêm đơn vị tính", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/units/{unit_id}")
def service_catalog_update_unit(
    unit_id: str, payload: ServiceCatalogUnitUpdateRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    if not can_manage_service_catalog_pricing(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Đơn vị tính & VAT")
    try:
        data = config_service.update_service_catalog_unit(unit_id, payload.model_dump(exclude={"id"}, exclude_none=True))
        return BaseResponse(success=True, message="Đã cập nhật đơn vị tính", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/vat-rates")
def service_catalog_list_vat_rates(
    include_inactive: bool = Query(True), _user: dict = Depends(get_current_user)
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=config_service.list_service_catalog_vat_rates(include_inactive))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/vat-rates")
def service_catalog_create_vat_rate(payload: ServiceCatalogVatRateCreateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_service_catalog_pricing(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Đơn vị tính & VAT")
    try:
        data = config_service.create_service_catalog_vat_rate(payload.rate, payload.status)
        return BaseResponse(success=True, message="Đã thêm mức VAT", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/vat-rates/{vat_rate_id}")
def service_catalog_update_vat_rate(
    vat_rate_id: str, payload: ServiceCatalogVatRateUpdateRequest, user: dict = Depends(get_current_user)
) -> BaseResponse:
    if not can_manage_service_catalog_pricing(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Đơn vị tính & VAT")
    try:
        data = config_service.update_service_catalog_vat_rate(vat_rate_id, payload.model_dump(exclude={"id"}, exclude_none=True))
        return BaseResponse(success=True, message="Đã cập nhật mức VAT", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
