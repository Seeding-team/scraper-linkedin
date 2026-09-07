from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.crm_customer import (
    CrmCustomerCreate,
    CrmCustomerUpdate,
    CrmCustomerWithDealCreate,
)
from app.modules.all_platform.services.crm_customer_service import (
    CustomerLinkedError,
    DuplicateCustomerError,
    create_customer,
    create_customer_with_deal,
    delete_customer,
    get_customer,
    list_customers,
    quick_search_customers,
    related_records,
    update_customer,
)
from app.modules.all_platform.services.supabase_project_service import get_customer_projects_summary
from app.modules.all_platform.services.crm_permission_service import can_view_project

router = APIRouter()


def _error(exc: Exception) -> BaseResponse:
    if isinstance(exc, DuplicateCustomerError):
        return BaseResponse(success=False, message=str(exc), data={"duplicates": exc.matches})
    if isinstance(exc, CustomerLinkedError):
        return BaseResponse(
            success=False,
            message=str(exc),
            data={"deal_count": exc.deal_count, "contact_count": exc.contact_count},
        )
    if isinstance(exc, PermissionError):
        return BaseResponse(success=False, message=str(exc))
    return BaseResponse(success=False, message=str(exc))


@router.get("")
def customers_list(
    search: str | None = Query(None),
    status: str | None = Query(None),
    source: str | None = Query(None),
    owner_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(
            success=True,
            data=list_customers(user, search=search, status=status, source=source, owner_id=owner_id, page=page, page_size=page_size),
        )
    except Exception as exc:
        return _error(exc)


@router.get("/quick-search")
def customers_quick_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(8, ge=1, le=20),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=quick_search_customers(user, q, limit=limit))
    except Exception as exc:
        return _error(exc)


@router.post("")
def customers_create(payload: CrmCustomerCreate, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, message="Da tao ho so khach hang", data=create_customer(payload.model_dump(), user))
    except Exception as exc:
        return _error(exc)


@router.post("/with-deal")
def customers_create_with_deal(payload: CrmCustomerWithDealCreate, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        data = create_customer_with_deal(payload.model_dump(exclude_none=True), user)
        message = data.get("partial_message") or "Da tao deal"
        return BaseResponse(success=True, message=message, data=data)
    except Exception as exc:
        return _error(exc)


@router.get("/{customer_id}")
def customers_get(customer_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_customer(customer_id, user))
    except Exception as exc:
        return _error(exc)


@router.put("/{customer_id}")
def customers_update(customer_id: str, payload: CrmCustomerUpdate, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(
            success=True,
            message="Da cap nhat ho so khach hang",
            data=update_customer(customer_id, payload.model_dump(exclude_unset=True), user),
        )
    except Exception as exc:
        return _error(exc)


@router.delete("/{customer_id}")
def customers_delete(customer_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        delete_customer(customer_id, user)
        return BaseResponse(success=True, message="Da xoa ho so khach hang")
    except Exception as exc:
        return _error(exc)


@router.get("/{customer_id}/related")
def customers_related(customer_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=related_records(customer_id, user))
    except Exception as exc:
        return _error(exc)


@router.get("/{customer_id}/projects-summary")
def customers_projects_summary(customer_id: str, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """Tab "Dự án" trong Hồ sơ khách hàng - 1 goi API tong hop (khong N+1 tu
    frontend goi rieng tung Project card). Ai dang nhap cung xem duoc (giong
    GET /projects that, xem can_view_project())."""
    if not can_view_project(user):
        return BaseResponse(success=False, message="Không có quyền xem dự án")
    try:
        return BaseResponse(success=True, data=get_customer_projects_summary(customer_id))
    except Exception as exc:
        return _error(exc)
