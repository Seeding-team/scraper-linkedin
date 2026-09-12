from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.crm_customer_service import (
    _clean_text,
    can_edit_customer,
    get_customer,
    normalize_email,
    normalize_phone,
)
from app.modules.all_platform.services.crm_position_service import apply_position_category

CONTACT_COLUMNS = (
    "id, customer_id, name, position, position_category_id, "
    "position_label_snapshot, phone, phone_normalized, email, "
    "email_normalized, zalo, facebook, is_primary, note, created_by, "
    "created_at, updated_at"
)


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


def create_contact(customer_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    customer = get_customer(customer_id, user)
    if not can_edit_customer(user, customer):
        raise PermissionError("Khong co quyen them lien he cho khach hang nay.")
    actor_id = str(user.get("id") or "")
    data = _normalize_payload(payload, actor_id=actor_id)
    apply_position_category(data)
    data["customer_id"] = customer_id
    data["instance"] = settings.crm_instance
    supabase = get_supabase_client()
    res = execute_supabase_query(lambda: supabase.table("crm_contacts").insert(data).execute())
    return res.data[0]


def _get_contact(contact_id: str) -> dict[str, Any]:
    # BUG THAT DA GAP: .single() nem APIError tho (PGRST116) khi 0 dong khop
    # (id khong ton tai, HOAC ton tai o instance khac) - khien nhanh "if not
    # contact" ben duoi thanh dead code. Doi sang .maybe_single().
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
        raise ValueError("Khong tim thay lien he.")
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
        lambda: supabase.table("crm_contacts")
        .delete()
        .eq("id", contact_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
