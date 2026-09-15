from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.crm_customer_service import (
    _clean_text,
    can_edit_customer,
    can_view_customer,
    get_customer,
    normalize_email,
    normalize_phone,
)
from app.modules.all_platform.services.crm_permission_service import can_edit_contract
from app.modules.all_platform.services.crm_position_service import apply_position_category
from app.modules.all_platform.services.customer_lead_service import BASE_COLUMNS, _normalize_row
from app.modules.all_platform.services.crm_customer_service import _deal_visible_to
from app.modules.all_platform.services.supabase_quote_service import apply_quote_field_permissions

class ContactNotFoundError(ValueError):
    pass


CONTACT_COLUMNS = (
    "id, customer_id, name, position, position_category_id, "
    "position_label_snapshot, phone, phone_normalized, email, "
    "email_normalized, zalo, facebook, is_primary, note, created_by, "
    "created_at, updated_at"
)
logger = logging.getLogger(__name__)


def _normalize_payload(payload: dict[str, Any], actor_id: str | None = None) -> dict[str, Any]:
    out = {key: _clean_text(value) if isinstance(value, str) else value for key, value in payload.items()}
    out["email_normalized"] = normalize_email(out.get("email"))
    out["phone_normalized"] = normalize_phone(out.get("phone"))
    if actor_id:
        out["created_by"] = actor_id
    return out


def list_contacts(customer_id: str, user: dict[str, Any]) -> list[dict[str, Any]]:
    # Dung lai dung 1 permission logic voi crm_customers (khong fork ban thu
    # 2) - xem duoc contact neu xem duoc customer cha.
    get_customer(customer_id, user)
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("crm_contacts")
        .select(CONTACT_COLUMNS)
        .eq("customer_id", customer_id)
        .eq("instance", settings.crm_instance)
        .order("is_primary", desc=True)
        .order("created_at")
        .execute()
    )
    return res.data or []


def _unset_other_primary_contacts(customer_id: str, exclude_contact_id: str | None) -> None:
    """Business rule: "1 Contact chinh moi Customer" - khi 1 Contact duoc set
    is_primary=True, MOI Contact khac cua CUNG Customer nay (scope theo
    customer_id + instance, dung tenant guard nhu moi noi khac trong file
    nay) phai duoc unset. Goi TRUOC khi insert/update ban ghi dang duoc set
    chinh, tranh khoang thoi gian co 2 Contact chinh cung luc. Day la logic
    BACKEND (khong phai FE state) - dung 2 lenh UPDATE tuan tu (khong co RPC
    transaction rieng cho invariant nay, giong muc do "atomic" da chap nhan o
    cac invariant don gian khac trong file nay/du an nay - khong phai giao
    dich tai chinh can serializable transaction that su)."""
    supabase = get_supabase_client()
    query = (
        supabase.table("crm_contacts")
        .update({"is_primary": False})
        .eq("customer_id", customer_id)
        .eq("instance", settings.crm_instance)
    )
    if exclude_contact_id:
        query = query.neq("id", exclude_contact_id)
    execute_supabase_query(lambda: query.execute())


def create_contact(customer_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    customer = get_customer(customer_id, user)
    if not can_edit_customer(user, customer):
        raise PermissionError("Khong co quyen them lien he cho khach hang nay.")
    actor_id = str(user.get("id") or "")
    data = _normalize_payload(payload, actor_id=actor_id)
    apply_position_category(data)
    data["customer_id"] = customer_id
    data["instance"] = settings.crm_instance
    if data.get("is_primary"):
        _unset_other_primary_contacts(customer_id, exclude_contact_id=None)
    logger.info(
        "tenant_write table=crm_contacts operation=insert settings.crm_instance=%s resolved_instance=%s",
        settings.crm_instance,
        data["instance"],
    )
    supabase = get_supabase_client()
    res = execute_supabase_query(lambda: supabase.table("crm_contacts").insert(data).execute())
    return res.data[0]


def _get_contact(contact_id: str) -> dict[str, Any]:
    # BUG THAT DA GAP: .single() nem APIError tho (PGRST116) khi 0 dong khop -
    # khien nhanh "if not contact" ben duoi thanh dead code. Doi sang .maybe_single().
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("crm_contacts")
        .select(CONTACT_COLUMNS)
        .eq("id", contact_id)
        .eq("instance", settings.crm_instance)
        .maybe_single()
        .execute()
    )
    contact = res.data if res else None
    if not contact:
        raise ContactNotFoundError("Khong tim thay lien he.")
    return contact


def update_contact(customer_id: str, contact_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    customer = get_customer(customer_id, user)
    if not can_edit_customer(user, customer):
        raise PermissionError("Khong co quyen sua lien he cua khach hang nay.")
    contact = _get_contact(contact_id)
    if str(contact.get("customer_id")) != str(customer_id):
        raise ValueError("Lien he khong thuoc khach hang nay.")
    data = {key: _clean_text(value) if isinstance(value, str) else value for key, value in payload.items()}
    if "email" in data:
        data["email_normalized"] = normalize_email(data.get("email"))
    if "phone" in data:
        data["phone_normalized"] = normalize_phone(data.get("phone"))
    apply_position_category(data, current_position_category_id=contact.get("position_category_id"))
    data.pop("id", None)
    data.pop("customer_id", None)
    data.pop("created_by", None)
    if data.get("is_primary"):
        # "is_primary" in data (not just truthy) is already guaranteed by
        # router's exclude_unset=True - sua field khac KHONG the vo tinh
        # kich hoat nhanh nay (data se khong co key "is_primary" o tat ca).
        _unset_other_primary_contacts(customer_id, exclude_contact_id=contact_id)
    data.pop("instance", None)
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("crm_contacts")
        .update(data)
        .eq("id", contact_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    return res.data[0]


def delete_contact(customer_id: str, contact_id: str, user: dict[str, Any]) -> None:
    customer = get_customer(customer_id, user)
    if not can_edit_customer(user, customer):
        raise PermissionError("Khong co quyen xoa lien he cua khach hang nay.")
    contact = _get_contact(contact_id)
    if str(contact.get("customer_id")) != str(customer_id):
        raise ValueError("Lien he khong thuoc khach hang nay.")
    supabase = get_supabase_client()
    execute_supabase_query(
        lambda: supabase.table("crm_contacts").delete().eq("id", contact_id).eq("instance", settings.crm_instance).execute()
    )


# ============================================================
# Contact 360 (migration 134: customer_leads.primary_contact_id)
# ============================================================
#
# Permission model: KHONG tao rule rieng cho Contact - visibility cua 1
# Contact = visibility cua chinh Customer cha no (get_customer() da rai
# PermissionError/CustomerNotFoundError dung nhu Customer 360), va
# visibility cua tung Deal/Quote/Contract linked toi Contact van dung
# CHINH XAC _deal_visible_to()/apply_quote_field_permissions()/
# can_edit_contract() ma Customer 360 (related_records()) da dung - khong
# fork logic quyen thu 2. Muc dich: 1 Contact KHONG duoc "mo rong" quyen
# truy cap so voi Customer 360/Deal Workspace da cho phep (task yeu cau ro
# "must never widen access").


def get_contact(contact_id: str, user: dict[str, Any]) -> dict[str, Any]:
    """Tra ve {contact, customer} - dung chung cho drawer header + moi tab.
    Kiem tra quyen qua get_customer() (raises neu khong ton tai/khong co
    quyen xem), TUYET DOI khong tu suy quyen rieng cho contact."""
    contact = _get_contact(contact_id)
    customer = get_customer(contact["customer_id"], user)
    return {"contact": contact, "customer": customer}


def _contact_deal_ids(contact_id: str, customer_id: str, user: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """Deal ma primary_contact_id = contact nay VA cung thuoc dung Customer
    cha (defense-in-depth - primary_contact_id/customer_id la 2 cot doc lap,
    khong co FK composite rang buoc chung phai khop nhau), da loc theo dung
    _deal_visible_to() nhu related_records()."""
    supabase = get_supabase_client()
    lead_res = execute_supabase_query(
        lambda: supabase.table("customer_leads")
        .select(BASE_COLUMNS)
        .eq("primary_contact_id", contact_id)
        .eq("customer_id", customer_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    all_deals = [_normalize_row(row) for row in lead_res.data or []]
    deals = [deal for deal in all_deals if _deal_visible_to(user, deal)]
    return deals, [deal["id"] for deal in deals]


def get_contact_related(contact_id: str, user: dict[str, Any]) -> dict[str, Any]:
    """Contact 360 'Cơ hội/Báo giá/Hợp đồng' - CHI nhung Deal co
    primary_contact_id = contact nay (khong phai moi Deal cua Customer cha -
    do la Company 360, xem related_records()). Quote/Contract resolve QUA
    cac Deal do (deal_id) - Contract KHONG gop them theo customer_id truc
    tiep nhu Company 360 vi 1 Contract tao thang tren Customer (khong qua
    Deal) khong the quy ve dung 1 Contact cu the (task 6.Hợp đồng: "Resolve
    canonical Contracts through Contact-linked Deal/Quote relationships",
    khong noi customer_id)."""
    bundle = get_contact(contact_id, user)
    contact, customer = bundle["contact"], bundle["customer"]
    deals, deal_ids = _contact_deal_ids(contact_id, customer["id"], user)

    quotes: list[dict[str, Any]] = []
    contracts: list[dict[str, Any]] = []
    if deal_ids:
        supabase = get_supabase_client()
        quote_res = execute_supabase_query(
            lambda: supabase.table("quotes").select("*").eq("instance", settings.crm_instance).in_("deal_id", deal_ids).execute()
        )
        quotes = [apply_quote_field_permissions(row, user) for row in (quote_res.data or [])]

        try:
            contract_res = execute_supabase_query(
                lambda: supabase.table("contracts").select("*").eq("instance", settings.crm_instance).in_("deal_id", deal_ids).execute()
            )
            contracts = []
            for row in contract_res.data or []:
                row_for_check = {**row, "createdById": row.get("created_by")}
                linked_deal = next((d for d in deals if d["id"] == row.get("deal_id")), None)
                if can_edit_contract(user, row_for_check, linked_deal):
                    contracts.append(row)
        except Exception:
            logger.exception("get_contact_related: failed to load contracts for contact %s", contact_id)
            contracts = []

    total_value = sum(float(deal.get("estimated_budget") or deal.get("lifetime_value") or 0) for deal in deals)

    projects: list[dict[str, Any]] = []
    try:
        supabase = get_supabase_client()
        project_res = execute_supabase_query(
            lambda: supabase.table("projects").select("*").eq("instance", settings.crm_instance).eq("primary_contact_id", contact_id).execute()
        )
        projects = project_res.data or []
    except Exception:
        logger.exception("get_contact_related: failed to load projects for contact %s", contact_id)
        projects = []

    return {
        "contact": contact,
        "customer": customer,
        "deals": deals,
        "quotes": quotes,
        "contracts": contracts,
        "projects": projects,
        "kpi": {
            "deal_count": len(deals),
            "quote_count": len(quotes),
            "contract_count": len(contracts),
            "project_count": len(projects),
            "total_value": total_value,
        },
    }


def get_contact_activity(contact_id: str, user: dict[str, Any]) -> list[dict[str, Any]]:
    """Contact 360 'Hoạt động' - dung PHAM VI HEP giong het
    get_customer_activity() (Deal/Sales activity qua customer_lead_activity_log),
    nhung chi tren cac Deal co primary_contact_id = contact nay. KHONG suy
    dien Quote/Contract event vao day - dung y het gioi han da cong bo o
    Customer 360."""
    bundle = get_contact(contact_id, user)
    contact, customer = bundle["contact"], bundle["customer"]
    _, deal_ids = _contact_deal_ids(contact_id, customer["id"], user)
    if not deal_ids:
        return []
    supabase = get_supabase_client()
    log_res = execute_supabase_query(
        lambda: supabase.table("customer_lead_activity_log")
        .select("*")
        .eq("instance", settings.crm_instance)
        .in_("customer_id", deal_ids)
        .order("created_at", desc=True)
        .execute()
    )
    return log_res.data or []
