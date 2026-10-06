"""PVCC (Pham vi cung cap) tu Mua Sam Cong (MSC) gan voi Lead / Co hoi CRM.

Presale nhap PVCC trong MSC (Tra cuu goi thau -> Presale Review). Khi goi chuyen sang Tham gia / Trung thau (Lead / Co hoi CRM),
MSC day PVCC sang day de CRM dung lai (xem Lead/Co hoi, tao Bao gia) ma khong phai go lai. Bang `crm_scope_items`
(migration crm_scope_items): moi dong = 1 hang muc PVCC, gan voi lead_id HOAC deal_id (customer_leads.id), kem source_ref = ma TBMT.

- PUT  /crm/scope-items/sync : thay the TOAN BO PVCC cua (nguon, ma TBMT, lead/deal) bang danh sach moi (chay lai khong bi trung).
- GET  /crm/scope-items      : danh sach theo lead_id / deal_id / source_ref.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services.crm_lead_service import get_lead

router = APIRouter()

MAX_ITEMS = 300
STATUSES = {"defined", "clarify", "new"}
COLUMNS = (
    "id, lead_id, deal_id, project_id, source, source_ref, sort_order, group_name, brand_name, product, sku, "
    "requirement, scope, unit, quantity, license, brand_requirement, status, note, created_by, created_at, updated_at"
)


class ScopeItemIn(BaseModel):
    group_name: str | None = None
    brand_name: str | None = None
    product: str | None = None
    sku: str | None = None
    requirement: str | None = None  # YCKT HSMT: yeu cau ky thuat goc trong ho so moi thau
    scope: str | None = None  # PVCC / mo ta cung cap: phuong an Presale de xuat
    unit: str | None = None
    quantity: float | None = 1
    license: str | None = None
    brand_requirement: str | None = None
    status: str | None = "new"
    note: str | None = None


class ScopeSyncRequest(BaseModel):
    source: str = Field(default="msc", max_length=20)
    source_ref: str = Field(min_length=3, max_length=60)  # ma TBMT
    lead_id: str | None = None
    deal_id: str | None = None
    project_id: str | None = None
    items: list[ScopeItemIn] = Field(default_factory=list)


def _txt(value: Any, limit: int) -> str | None:
    text = str(value or "").strip()
    return text[:limit] if text else None


def clean_item(raw: ScopeItemIn | dict[str, Any], index: int) -> dict[str, Any]:
    """Chuan hoa 1 dong PVCC (cat do dai, ep so luong >= 0, trang thai hop le)."""
    data = raw.model_dump() if isinstance(raw, BaseModel) else dict(raw)
    try:
        qty = float(data.get("quantity") if data.get("quantity") is not None else 1)
    except (TypeError, ValueError):
        qty = 1.0
    status = str(data.get("status") or "new")
    return {
        "sort_order": index,
        "group_name": _txt(data.get("group_name"), 160),
        "brand_name": _txt(data.get("brand_name"), 160),
        "product": _txt(data.get("product"), 300),
        "sku": _txt(data.get("sku"), 120),
        "requirement": _txt(data.get("requirement"), 4000),
        "scope": _txt(data.get("scope"), 3000),
        "unit": _txt(data.get("unit"), 40),
        "quantity": qty if qty >= 0 else 0.0,
        "license": _txt(data.get("license"), 80),
        "brand_requirement": _txt(data.get("brand_requirement"), 300),
        "status": status if status in STATUSES else "new",
        "note": _txt(data.get("note"), 1000),
    }


def sync_scope_items(payload: ScopeSyncRequest, user: dict[str, Any]) -> dict[str, Any]:
    if not payload.lead_id and not payload.deal_id:
        raise ValueError("Can lead_id hoac deal_id de gan PVCC.")
    if len(payload.items) > MAX_ITEMS:
        raise ValueError(f"Toi da {MAX_ITEMS} hang muc PVCC moi lan dong bo.")
    if payload.lead_id:
        get_lead(payload.lead_id, user)  # chi nguoi xem duoc Lead moi duoc ghi PVCC vao Lead do
    supabase = get_supabase_client()
    instance = settings.crm_instance
    target_col, target_id = ("lead_id", payload.lead_id) if payload.lead_id else ("deal_id", payload.deal_id)

    execute_supabase_query(
        lambda: supabase.table("crm_scope_items")
        .delete()
        .eq("instance", instance)
        .eq("source", payload.source)
        .eq("source_ref", payload.source_ref)
        .eq(target_col, target_id)
        .execute()
    )
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for index, item in enumerate(payload.items):
        row = clean_item(item, index)
        row.update(
            {
                "instance": instance,
                "source": payload.source,
                "source_ref": payload.source_ref,
                "lead_id": payload.lead_id,
                "deal_id": payload.deal_id,
                "project_id": payload.project_id,
                "created_by": str(user.get("id") or "") or None,
                "created_at": now,
                "updated_at": now,
            }
        )
        rows.append(row)
    if rows:
        execute_supabase_query(lambda: supabase.table("crm_scope_items").insert(rows).execute())
    return {"count": len(rows), "source_ref": payload.source_ref, "lead_id": payload.lead_id, "deal_id": payload.deal_id}


def list_scope_items(lead_id: str | None, deal_id: str | None, source_ref: str | None, user: dict[str, Any]) -> list[dict[str, Any]]:
    if not (lead_id or deal_id or source_ref):
        raise ValueError("Can lead_id, deal_id hoac source_ref.")
    if lead_id:
        get_lead(lead_id, user)
    supabase = get_supabase_client()

    def run():
        query = supabase.table("crm_scope_items").select(COLUMNS).eq("instance", settings.crm_instance)
        if lead_id:
            query = query.eq("lead_id", lead_id)
        if deal_id:
            query = query.eq("deal_id", deal_id)
        if source_ref:
            query = query.eq("source_ref", source_ref)
        return query.order("sort_order").execute()

    return list(execute_supabase_query(run).data or [])


@router.put("/sync")
def scope_items_sync(payload: ScopeSyncRequest, user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, message="Da dong bo PVCC", data=sync_scope_items(payload, user))
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.get("")
def scope_items_list(
    lead_id: str | None = Query(None),
    deal_id: str | None = Query(None),
    source_ref: str | None = Query(None),
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_scope_items(lead_id, deal_id, source_ref, user))
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))
