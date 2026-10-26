from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

# File schema rieng cho Lead Import (revalidate/confirm), cung precedent voi
# crm_lead.py/crm_customer.py - khong piggyback vao schemas/crm_lead.py.


class ImportRowInput(BaseModel):
    # Shape khop voi "data" dict ma preview_import()/revalidate_rows() da tra
    # ve cho tung row - FE gui lai nguyen row (co the da sua 1-2 field), cac
    # key khong khai bao o day (issues, pending_creates, owner_name...) bi
    # Pydantic bo qua chu khong loi.
    row_number: int
    lead_name: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    position: Optional[str] = None
    source: Optional[str] = None
    # Raw display text/id, re-resolved fresh every validation pass (never a
    # trusted pre-resolved sdr_id) — see crm_lead_import_service.py owner
    # handling in _validate_and_resolve_rows.
    owner: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None
    note: Optional[str] = None


class ImportRevalidateRequest(BaseModel):
    rows: list[ImportRowInput]


class ImportConfirmRequest(BaseModel):
    rows: list[ImportRowInput]
    selected_rows: list[int]
