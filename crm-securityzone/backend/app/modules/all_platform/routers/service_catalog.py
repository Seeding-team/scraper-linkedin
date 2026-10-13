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
    ServiceCatalogWorkspaceAssignRequest,
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
    has_full_crm_access,
    has_quote_business_role,
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
        return True, None

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


def _can_view_draft_catalog_cost(user: dict) -> bool:
    """Draft quote has no persisted owner yet.

    Allow the same people who can actually work on a quote draft to receive
    catalog cost/markup defaults for prefill. Backend still enforces field-level
    permissions when the quote/items are saved.
    """
    if not user:
        return False
    return (
        has_full_crm_access(user)
        or has_quote_business_role(user, "presale")
        or has_quote_business_role(user, "sale")
    )


# ==============================================================================
# TÍCH HỢP BỘ LỌC WORKSPACE: Endpoint danh sách Workspace lấy động từ DB
# ==============================================================================
@router.get("/workspaces")
def service_catalog_get_workspaces(_user: dict = Depends(get_current_user)) -> BaseResponse:
    """TÍCH HỢP BỘ LỌC WORKSPACE: Lấy danh sách các Workspace khả dụng động từ Database."""
    try:
        data = catalog_service.list_available_workspaces()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        logger.exception("Lỗi khi tải danh sách workspaces cho service catalog")
        return BaseResponse(success=False, message=str(e))


@router.get("/version")
def service_catalog_get_version(_user: dict = Depends(get_current_user)) -> BaseResponse:
    """ĐỒNG BỘ CROSS-CLONE (Requirement C): fingerprint thay đổi dữ liệu danh mục.

    Các clone đọc/ghi CÙNG 1 DB với Seeding chính nhưng KHÔNG có cơ chế push giữa
    các deploy, nên frontend clone poll endpoint này với chu kỳ bounded (20s khi
    tab đang mở): fingerprint khác lần trước → refetch list/workspaces của mình —
    không cần F5, không poll full list. Mọi đường ghi hiện có (create/update/
    delete/reorder + RPC ws_assign) đều stamp `updated_at` nên fingerprint bắt
    được cả thay đổi assignment Workspace lẫn đổi tên/sửa nhóm. """
    try:
        data = catalog_service.get_catalog_change_fingerprint()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        logger.exception("Lỗi khi lấy fingerprint service catalog")
        return BaseResponse(success=False, message=str(e))


@router.get("")
def service_catalog_get_all(
    context: str = Query("admin", pattern="^(admin|quote_picker)$"),
    quote_id: Optional[str] = Query(None),
    issuer_company_id: Optional[str] = Query(None),
    instances: Optional[str] = Query(None, description="TÍCH HỢP BỘ LỌC WORKSPACE: Danh sách instance phân tách bằng dấu phẩy, vd: markee,cloudgate"),
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    # Workspace isolation (task 2026-10-14): issuer_company_id o duong draft
    # picker la CLIENT tu gui → kiem tra thuoc workspace cua deploy (403 neu
    # issuer workspace khac) TRUOC khi bat ky try-nuot-403 nao. Issuer lay tu
    # quote that (quote_id) khong can check vi quote da instance-scoped tu truoc.
    if context == "quote_picker" and not quote_id and _can_view_draft_catalog_cost(user):
        catalog_service.ensure_issuer_company_in_scope(issuer_company_id)
    try:
        instance_list: list[str] | None = None
        if instances:
            instance_list = [i.strip() for i in instances.split(",") if i.strip()]
        # Workspace isolation (task 2026-10-14): giao bo instances client hoi
        # voi floor cua deploy (flag CATALOG_SCOPE_ENFORCED). Flag OFF =>
        # passthrough (hanh vi cu). Giao RONG => tra cay rong voi HTTP 200
        # (khong goi list_service_catalog_items_scoped voi list rong se tro
        # thanh unfiltered).
        effective_instances = catalog_service.enforce_catalog_scope_floor(instance_list)
        if catalog_service._catalog_scope_floor() is not None and not effective_instances:
            return BaseResponse(success=True, data=[])
        tree = catalog_service.list_service_catalog_items_scoped(effective_instances)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))

    # Bo gia mac dinh la TINH NANG BO SUNG (migration 107) - loi o buoc nay
    # (vi du migration chua duoc ap dung len DB that) KHONG duoc lam hong ca
    # danh sach danh muc goc (nguoi dung van phai chon duoc san pham binh
    # thuong, chi la chua co gia mac dinh di kem).
    try:
        can_view_cost, resolved_issuer = _resolve_catalog_pricing_visibility(user, context, quote_id)
        if context == "quote_picker" and not quote_id and _can_view_draft_catalog_cost(user):
            can_view_cost = True
            resolved_issuer = issuer_company_id
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
    # Workspace isolation: item phai thuoc workspace cua deploy (403 neu khac).
    catalog_service.ensure_catalog_items_in_scope([item_id])
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
    # Workspace isolation: (1) item phai thuoc workspace cua deploy;
    # (2) issuer_company_id do CLIENT tu gui phai thuoc workspace cua deploy
    # (issuer None = dong gia mac dinh dung chung — cho phep nhu cu).
    catalog_service.ensure_catalog_items_in_scope([item_id])
    catalog_service.ensure_issuer_company_in_scope(payload.issuer_company_id)
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
    item_ids = [i for i in (x.strip() for x in ids.split(",")) if i]
    # Workspace isolation: khong cho tra cuu id thuoc workspace khac.
    # (Ngoai try: HTTPException 403 phai lam WON ra, khong bi `except
    # Exception` nuot thanh 200 success=False — contract 403 cua task.)
    catalog_service.ensure_catalog_items_in_scope(item_ids)
    try:
        return BaseResponse(success=True, data=get_service_catalog_items_by_ids(item_ids))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/add")
def service_catalog_add(payload: ServiceCatalogItemCreateRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    # Workspace isolation (task 2026-10-14): khi enforcement bat, KHONG cho
    # tao item vao workspace khac (403); thieu instance => tao vao workspace
    # cua deploy (bun junction/legacy qua create_service_catalog_item), khong
    # roi vao default 'markee' cua DB.
    payload_data = payload.model_dump()
    _floor = catalog_service._catalog_scope_floor()
    if _floor is not None:
        requested_instance = str(payload_data.get("instance") or "").strip().lower()
        if requested_instance and requested_instance not in set(_floor):
            raise HTTPException(status_code=403, detail="Forbidden: item belongs to another workspace")
        parent_id = payload_data.get("parent_id")
        if parent_id:
            catalog_service.ensure_catalog_items_in_scope([parent_id])
        if not requested_instance:
            payload_data["instance"] = _floor[0]
    try:
        data = create_service_catalog_item(payload_data, user.get("id"))
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
    # Workspace isolation (task 2026-10-14):
    #  - target item phai thuoc workspace cua deploy (403 neu khac);
    #  - payload `instance` (di chuyen item sang workspace khac) phai nam trong
    #    floor (403 neu khac) — khong con "move any item to any workspace";
    #  - reparent chi cho phep vao nhom cha thuoc workspace cua deploy.
    payload_data = payload.model_dump(exclude_none=True)
    _floor = catalog_service._catalog_scope_floor()
    if _floor is not None:
        catalog_service.ensure_catalog_items_in_scope([payload.id])
        requested_instance = str(payload_data.get("instance") or "").strip().lower()
        if requested_instance and requested_instance not in set(_floor):
            raise HTTPException(status_code=403, detail="Forbidden: item belongs to another workspace")
        if payload_data.get("parent_id"):
            catalog_service.ensure_catalog_items_in_scope([payload_data["parent_id"]])
    try:
        data = update_service_catalog_item(payload.id, payload_data, user.get("id"))
        return BaseResponse(success=True, message="Đã cập nhật dịch vụ", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except HTTPException:
        raise
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/workspaces-assign")
def service_catalog_workspaces_assign(
    payload: ServiceCatalogWorkspaceAssignRequest,
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Bulk thay set Workspace (many-to-many, migration 190) cho cac NHOM da
    chon + TAT CA con truc tiep — REPLACE-ALL trong 1 giao dich (RPC
    `service_catalog_ws_assign`, FOR UPDATE locks, khong partial failure).

    Ky quyen: cung nhom quen quan ly master data khac (/add, /update).
    Tra ve {"assignment": {item_id: [workspaces]}, "groups": [ids]}.

    Workspace isolation (task 2026-10-14): endpoint bulk assignment BỊ TẮT
    hoan toan tren 4 deploy clone (approved decision) — gán workspace chỉ
    thực hiện từ workspace chính (MAIN). 403 mọi lúc (kể cả khi JWT + role
    hợp lệ); frontend clone cũng đã bỏ nút và dialog tương ứng. JWT vẫn bắt
    buộc (user: Depends(get_current_user)) nên không còn đường unauth nào
    chạm service/database."""
    raise HTTPException(
        status_code=403,
        detail="Forbidden: Workspace assignment is disabled in this deployment (managed from the main workspace)",
    )


@router.delete("/delete")
def service_catalog_delete(id: str = Query(...), user: dict = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    # Workspace isolation: item phai thuoc workspace cua deploy (403 neu khac).
    catalog_service.ensure_catalog_items_in_scope([id])
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
    # Workspace isolation: item phai thuoc workspace cua deploy (403 neu khac).
    catalog_service.ensure_catalog_items_in_scope([payload.id])
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
    # Workspace isolation: bundle item phai thuoc workspace cua deploy (403
    # neu khac). Component CROSS-workspace van duoc phep tham chiếu (approved
    # decision: composition ≠ ownership, migration 190) — KHONG obj-chk từng
    # component_id, giữ nguyên semantics bundle hợp lệ đa workspace.
    catalog_service.ensure_catalog_items_in_scope([bundle_id])
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
