from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CrmContactBase(BaseModel):
    name: str = Field(..., min_length=1)
    position: Optional[str] = None
    # migration 079 — Chuc vu category-driven select (category_type=crm_position).
    position_category_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    # migration 145 - khop phan "Thong tin bo sung" cua form Lead (feedback
    # 2026-09-23: form Them Contact "thieu tt" so voi form Lead).
    telegram: Optional[str] = None
    website: Optional[str] = None
    is_primary: bool = False
    note: Optional[str] = None


class CrmContactCreate(CrmContactBase):
    pass


class CrmContactUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    position_category_id: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None
    is_primary: Optional[bool] = None
    note: Optional[str] = None


class CrmContactResponse(CrmContactBase):
    id: str
    customer_id: str
    position_label_snapshot: Optional[str] = None
    phone_normalized: Optional[str] = None
    email_normalized: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
