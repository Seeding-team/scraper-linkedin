"""Service cho /sync/* - export khach hang da mua (crm_customers.status =
'current_customer') + contact (crm_contacts) cho he thong ngoai (Tech Support)
PULL ve. Co CHU Y quan trong: KHONG tai su dung list_customers()/list_contacts()
o crm_customer_service.py/crm_contact_service.py vi 2 ham do gan chat voi
quyen xem cua 1 nguoi dung CRM that (_customer_ids_visible_to, can_view_customer)
- /sync/* la call he thong-toi-he thong (auth bang require_sync_api_key, khong
co user), can THAY THE toan bo tap current_customer theo instance, khong loc
theo quyen so huu/team cua bat ky ai.
"""
from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.crm_customer_service import CUSTOMER_COLUMNS
from app.modules.all_platform.services.crm_contact_service import CONTACT_COLUMNS

PURCHASED_STATUS = "current_customer"

# PostgREST .in_() truyen ca list qua query string - gioi han so luong id/1 lan
# goi de tranh URL qua dai (page_size customer toi da dang la 200, khop voi
# gioi han nay).
MAX_CONTACT_CUSTOMER_IDS = 200


def list_purchased_customers_for_sync(
    *,
    updated_after: str | None = None,
    page: int = 1,
    page_size: int = 200,
) -> dict[str, Any]:
    supabase = get_supabase_client()
    query = (
        supabase.table("crm_customers")
        .select(CUSTOMER_COLUMNS)
        .eq("instance", settings.crm_instance)
        .eq("status", PURCHASED_STATUS)
    )
    if updated_after:
        query = query.gte("updated_at", updated_after)
    res = execute_supabase_query(lambda: query.order("updated_at").execute())
    rows = res.data or []
    total = len(rows)
    start = (page - 1) * page_size
    return {
        "items": rows[start:start + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def list_contacts_for_sync(
    *,
    customer_ids: list[str],
    updated_after: str | None = None,
) -> list[dict[str, Any]]:
    ids = [item for item in customer_ids if item][:MAX_CONTACT_CUSTOMER_IDS]
    if not ids:
        return []
    supabase = get_supabase_client()
    query = (
        supabase.table("crm_contacts")
        .select(CONTACT_COLUMNS)
        .eq("instance", settings.crm_instance)
        .in_("customer_id", ids)
    )
    if updated_after:
        query = query.gte("updated_at", updated_after)
    res = execute_supabase_query(lambda: query.order("updated_at").execute())
    return res.data or []
