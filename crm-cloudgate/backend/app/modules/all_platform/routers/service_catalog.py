"""Danh mục dịch vụ (Service Catalog) endpoints — group/component/bundle dùng chung
cho các Mẫu báo giá."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    ServiceCatalogItemCreateRequest,
    ServiceCatalogItemUpdateRequest,
    ServiceCatalogReorderRequest,
    BundleComponentsSetRequest,
)
from app.modules.all_platform.services import (
    list_service_catalog_items,
    create_service_catalog_item,
    update_service_catalog_item,
    delete_service_catalog_item,
    reorder_service_catalog_item,
    set_bundle_components,
    get_service_catalog_items_by_ids,
)

router = APIRouter()


@router.get("")
def service_catalog_get_all(_user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_service_catalog_items())
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
def service_catalog_delete(id: str = Query(...), _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = delete_service_catalog_item(id)
        return BaseResponse(success=True, message="Đã xoá dịch vụ", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/reorder")
def service_catalog_reorder(payload: ServiceCatalogReorderRequest, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = reorder_service_catalog_item(payload.id, payload.direction)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/{bundle_id}/components")
def service_catalog_set_bundle_components(
    bundle_id: str, payload: BundleComponentsSetRequest, _user: dict = Depends(get_current_user)
) -> BaseResponse:
    try:
        data = set_bundle_components(bundle_id, [item.model_dump() for item in payload.items])
        return BaseResponse(success=True, message="Đã cập nhật thành phần gói", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
