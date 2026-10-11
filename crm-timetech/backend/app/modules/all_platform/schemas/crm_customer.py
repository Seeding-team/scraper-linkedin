from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

CrmCustomerStatus = Literal["new_lead", "following", "current_customer", "not_fit"]


class CrmCustomerBase(BaseModel):
    customer_name: str = Field(..., min_length=1)
    company_name: Optional[str] = None
    position: Optional[str] = None
    # migration 079 — Chuc vu category-driven select (category_type=crm_position).
    # position_label_snapshot is server-derived only, never trusted from client.
    position_category_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None
    tax_code: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    industry: Optional[str] = None
    source: Optional[str] = None
    status: CrmCustomerStatus = "new_lead"
    owner_id: Optional[str] = None
    sale_manager_id: Optional[str] = None
    note: Optional[str] = None


class CrmCustomerCreate(CrmCustomerBase):
    pass


class CrmCustomerUpdate(BaseModel):
    customer_name: Optional[str] = None
    company_name: Optional[str] = None
    position: Optional[str] = None
    position_category_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None
    tax_code: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    industry: Optional[str] = None
    source: Optional[str] = None
    status: Optional[CrmCustomerStatus] = None
    owner_id: Optional[str] = None
    sale_manager_id: Optional[str] = None
    note: Optional[str] = None


class CrmCustomerWithDealCreate(BaseModel):
    customer: CrmCustomerCreate
    deal: dict[str, Any]
    customer_id: Optional[str] = None
    update_customer_profile: bool = False
    idempotency_key: Optional[str] = None


class CrmCustomerResponse(CrmCustomerBase):
    id: str
    position_label_snapshot: Optional[str] = None
    phone_normalized: Optional[str] = None
    email_normalized: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    deal_count: int = 0
    total_value: float = 0
    last_deal_at: Optional[datetime] = None
    contact_count: int = 0


class CrmCustomerListResponse(BaseModel):
    items: list[CrmCustomerResponse]
    total: int
    page: int
    page_size: int
    kpi: dict[str, int]


class CrmCustomerRelatedResponse(BaseModel):
    customer: dict[str, Any]
    deals: list[dict[str, Any]]
    quotes: list[dict[str, Any]]
    contracts: list[dict[str, Any]]
    kpi: dict[str, Any]
