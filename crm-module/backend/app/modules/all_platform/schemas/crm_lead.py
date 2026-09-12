from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# Cung to chuc file rieng cho schema Lead, giong precedent crm_customer.py
# (co file schemas/crm_customer.py rieng, router import thang tu do, khong
# qua aggregator schemas/__init__.py) - khong piggyback vao 1 file khac.
CrmLeadStatus = Literal[
    "mql",
    "sql",
    "nurturing",
    "unqualified",
    # Legacy values kept for read/update compatibility until data is backfilled.
    "new_lead",
    "qualifying",
    "qualified",
    "nurture",
    "converted",
    "disqualified",
]


class CrmLeadBase(BaseModel):
    lead_name: str = Field(..., min_length=1)
    company_name: Optional[str] = None
    position: Optional[str] = None
    # migration 079 — Chuc vu category-driven select (category_type=crm_position).
    position_category_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None
    source: Optional[str] = None
    status: CrmLeadStatus = "mql"
    score: Optional[float] = None
    sdr_id: Optional[str] = None
    note: Optional[str] = None


class CrmLeadCreate(CrmLeadBase):
    pass


class CrmLeadUpdate(BaseModel):
    lead_name: Optional[str] = None
    company_name: Optional[str] = None
    position: Optional[str] = None
    position_category_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None
    source: Optional[str] = None
    status: Optional[CrmLeadStatus] = None
    score: Optional[float] = None
    sdr_id: Optional[str] = None
    note: Optional[str] = None

    # Qualification fields - plain update only, service layer guarantees
    # KHONG bao gio tu tao customer/contact/deal tu day.
    qualification_need: Optional[str] = None
    qualification_icp_fit: Optional[bool] = None
    qualification_estimated_value: Optional[float] = None
    qualification_decision_maker: Optional[str] = None
    qualification_expected_timeline: Optional[str] = None
    qualification_ae_id: Optional[str] = None
    next_step: Optional[str] = None
    follow_up_date: Optional[datetime] = None


class CrmLeadResponse(CrmLeadBase):
    id: str
    position_label_snapshot: Optional[str] = None
    phone_normalized: Optional[str] = None
    email_normalized: Optional[str] = None
    qualification_need: Optional[str] = None
    qualification_icp_fit: Optional[bool] = None
    qualification_estimated_value: Optional[float] = None
    qualification_decision_maker: Optional[str] = None
    qualification_expected_timeline: Optional[str] = None
    qualification_ae_id: Optional[str] = None
    next_step: Optional[str] = None
    follow_up_date: Optional[datetime] = None
    converted_customer_id: Optional[str] = None
    converted_contact_id: Optional[str] = None
    converted_deal_id: Optional[str] = None
    converted_by: Optional[str] = None
    converted_at: Optional[datetime] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CrmLeadListResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int
    page: int
    page_size: int
    kpi: dict[str, int]


class CrmLeadDuplicateCheckResponse(BaseModel):
    matches: list[dict[str, Any]]


class CrmLeadCompanyMatchResponse(BaseModel):
    matches: list[dict[str, Any]]


class CrmLeadConvertRequest(BaseModel):
    customer: Optional[dict[str, Any]] = None
    customer_id: Optional[str] = None
    contact: Optional[dict[str, Any]] = None
    contact_id: Optional[str] = None
    deal: dict[str, Any] = Field(default_factory=dict)
    update_customer: bool = False
    idempotency_key: Optional[str] = None
