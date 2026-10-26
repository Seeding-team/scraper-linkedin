"""CRUD "Nhom quyen" (crm_permission_groups) - xem
schemas/crm_permission_group.py va migration 155_crm_permission_groups_and_teams.sql.

Enforcement THAT (resolve quyen hieu luc cho 1 user) nam o crm_permission_service.py
(get_effective_permissions/has_module_access/get_scope_visible_user_ids) - file nay
CHI la CRUD template, khong tu ap dung quyen gi ca."""

from __future__ import annotations

from typing import Any

from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.crm_permission_service import clear_crm_permission_enforcement_cache

_SAFE_GROUP_COLUMNS = (
    "id, name, status, default_system_role, default_scope, description, "
    "default_quote_business_role, default_can_approve_quotes, quote_cost_permission, "
    "quote_sell_permission, quote_release_permission, modules, created_at, updated_at"
)

_USER_LIST_COLUMNS = "id, email, name, role, is_active, crm_status"


def list_permission_groups(status: str | None = None) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table("crm_permission_groups").select(_SAFE_GROUP_COLUMNS)
    if status:
        query = query.eq("status", status)
    result = query.order("name").execute()
    return result.data or []


def get_permission_group(group_id: str) -> dict | None:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table("crm_permission_groups")
        .select(_SAFE_GROUP_COLUMNS)
        .eq("id", group_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def create_permission_group(payload: dict[str, Any], created_by: str | None = None) -> dict:
    supabase: Client = get_supabase_client()
    insert_data = {
        "name": payload["name"].strip(),
        "status": payload.get("status") or "active",
        "default_system_role": payload.get("default_system_role") or "member",
        "default_scope": payload.get("default_scope") or "personal",
        "description": payload.get("description"),
        "default_quote_business_role": payload.get("default_quote_business_role") or None,
        "default_can_approve_quotes": bool(payload.get("default_can_approve_quotes")),
        "quote_cost_permission": payload.get("quote_cost_permission") or "none",
        "quote_sell_permission": payload.get("quote_sell_permission") or "none",
        "quote_release_permission": payload.get("quote_release_permission") or "none",
        "modules": payload.get("modules") or [],
        "created_by": created_by,
    }
    result = supabase.table("crm_permission_groups").insert(insert_data).execute()
    return result.data[0] if result.data else {}


def update_permission_group(group_id: str, payload: dict[str, Any]) -> dict:
    supabase: Client = get_supabase_client()
    update_data = {k: v for k, v in payload.items() if v is not None}
    if "name" in update_data:
        update_data["name"] = str(update_data["name"]).strip()
    update_data["updated_at"] = "now()"
    result = supabase.table("crm_permission_groups").update(update_data).eq("id", group_id).execute()
    clear_crm_permission_enforcement_cache()
    return result.data[0] if result.data else {}


def clone_permission_group(group_id: str, created_by: str | None = None) -> dict:
    """Clone 1 nhom quyen: giu nguyen toan bo config, doi ten '<ten> - Copy',
    trang thai luon 've 'draft' (giong nut "Clone" trong prototype HTML)."""
    original = get_permission_group(group_id)
    if not original:
        raise ValueError("Không tìm thấy nhóm quyền để clone")
    clone_payload = {k: v for k, v in original.items() if k not in ("id", "created_at", "updated_at")}
    clone_payload["name"] = f"{original['name']} - Copy"
    clone_payload["status"] = "draft"
    return create_permission_group(clone_payload, created_by=created_by)


def delete_permission_group(group_id: str) -> dict:
    """Xoa 1 nhom quyen - FK app_users.permission_group_id la ON DELETE SET
    NULL (migration 155), nen user dang gan nhom nay se tu dong ve
    "chua gan nhom" (khong con enforcement moi, ve dung hanh vi cu), khong bi
    chan xoa boi rang buoc FK."""
    supabase: Client = get_supabase_client()
    result = supabase.table("crm_permission_groups").delete().eq("id", group_id).execute()
    clear_crm_permission_enforcement_cache()
    return {"deleted": len(result.data) if result.data else 0}


def list_users_of_permission_group(group_id: str) -> list[dict]:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table("app_users")
        .select(_USER_LIST_COLUMNS)
        .eq("permission_group_id", group_id)
        .order("name")
        .execute()
    )
    return result.data or []
