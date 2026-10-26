"""Chuc vu (job position/title) category resolution helper — migration 079.

Shared by crm_customer_service / crm_lead_service / crm_contact_service /
customer_lead_service so all 4 "position" free-text columns get consistent
server-side validation + snapshot derivation instead of 4 forked copies.
"""

from __future__ import annotations

from typing import Any

from app.core.supabase_client import execute_supabase_query, get_supabase_client

CATEGORY_TYPE = "crm_position"


class InvalidPositionCategoryError(ValueError):
    pass


def _fetch_category(category_id: str) -> dict[str, Any] | None:
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("categories")
        .select("id, category_type, name, is_active")
        .eq("id", category_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def resolve_position_category(
    position_category_id: str | None,
    *,
    require_active: bool,
) -> tuple[str | None, str | None]:
    """Resolve a position_category_id into (id, label) ready to store on a
    CRM row. Returns (None, None) when no id was given (field cleared).

    require_active=True rejects picking a deactivated category — pass True
    only when the value is being freshly (re)picked (create, or update where
    the incoming value differs from what's already stored). Reading/keeping
    an already-saved deactivated value must NOT go through this with
    require_active=True, otherwise every unrelated edit of that record would
    start failing the moment the category gets deactivated (same bug class
    fixed for source_platform in migration 056).
    """
    pid = str(position_category_id or "").strip()
    if not pid:
        return None, None

    category = _fetch_category(pid)
    if not category or category.get("category_type") != CATEGORY_TYPE:
        raise InvalidPositionCategoryError("Chức vụ không hợp lệ.")
    if require_active and not category.get("is_active", True):
        raise InvalidPositionCategoryError(
            "Chức vụ này đã ngừng sử dụng, vui lòng chọn Chức vụ khác."
        )
    return category["id"], (category.get("name") or "")


def apply_position_category(
    data: dict[str, Any],
    *,
    current_position_category_id: str | None = None,
) -> None:
    """Mutates `data` in place: if the caller included a `position_category_id`
    key (even if null, meaning "clear the field"), resolve it and set
    position_category_id + position_label_snapshot + mirror into the legacy
    `position` text column. If the key isn't present at all, `data` is left
    untouched (partial update of unrelated fields must not disturb position).

    require_active is derived automatically: True for a brand-new pick or a
    changed pick, False when the incoming id is identical to what the record
    already has (re-saving an unrelated field must not re-validate an
    already-deactivated saved position).
    """
    if "position_category_id" not in data:
        return

    incoming = str(data.get("position_category_id") or "").strip() or None
    require_active = incoming != (current_position_category_id or None)

    resolved_id, resolved_label = resolve_position_category(incoming, require_active=require_active)
    data["position_category_id"] = resolved_id
    data["position_label_snapshot"] = resolved_label
    # Mirror into the legacy free-text column so every existing read path
    # (lists/detail views) keeps working unmodified.
    data["position"] = resolved_label
