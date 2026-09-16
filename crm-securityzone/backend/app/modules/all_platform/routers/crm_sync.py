"""Endpoint rieng cho he thong ngoai (Tech Support) PULL du lieu khach hang
da mua + contact - auth bang require_sync_api_key (static API key), TACH BIET
hoan toan khoi cac router crm_customer.py/crm_contact.py dung cho UI CRM
(get_current_user, JWT nhan vien). Khong sua/anh huong route UI hien co.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import require_sync_api_key
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services.crm_sync_service import (
    list_contacts_for_sync,
    list_purchased_customers_for_sync,
)

router = APIRouter()


@router.get("/customers")
def sync_customers_list(
    updated_after: str | None = Query(
        None, description="ISO timestamp - chi tra customer co updated_at >= gia tri nay"
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=200),
    _caller: str = Depends(require_sync_api_key),
) -> BaseResponse:
    """Danh sach crm_customers.status == 'current_customer' (Da mua/chot).
    KHONG tra ve customer o cac status khac (new_lead/following/not_fit)."""
    return BaseResponse(
        success=True,
        data=list_purchased_customers_for_sync(
            updated_after=updated_after, page=page, page_size=page_size
        ),
    )


@router.get("/contacts")
def sync_contacts_list(
    customer_ids: str = Query(
        ..., description="Danh sach crm_customers.id, phan tach boi dau phay"
    ),
    updated_after: str | None = Query(None),
    _caller: str = Depends(require_sync_api_key),
) -> BaseResponse:
    """Contact (nguoi lien he) cua cac customer_id truyen vao - chi goi voi
    customer_id lay tu /sync/customers (da loc status = current_customer),
    khong tu y truyen customer_id chua qua buoc do."""
    ids = [item.strip() for item in customer_ids.split(",") if item.strip()]
    return BaseResponse(
        success=True,
        data=list_contacts_for_sync(customer_ids=ids, updated_after=updated_after),
    )
