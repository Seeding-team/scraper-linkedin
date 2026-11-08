"""Supabase-based categories service for all-platform module."""

from __future__ import annotations

from supabase import Client

from app.core.supabase_client import get_supabase_client


def get_all_categories() -> list[dict]:
    """Get all categories across all types."""
    supabase: Client = get_supabase_client()

    try:
        result = (
            supabase.table("categories")
            .select("*")
            .order("category_type")
            .order("sort_order")
            .order("code")
            .execute()
        )
    except Exception:
        result = (
            supabase.table("categories")
            .select("*")
            .order("category_type")
            .order("code")
            .execute()
        )
    return result.data or []


def get_categories_by_type(category_type: str, active_only: bool = False) -> list[dict]:
    """Get categories of a specific type. active_only=True hides deactivated
    rows (is_active=false) — used by live-search dropdowns picking a NEW
    value. Admin management views must keep passing active_only=False (the
    default) so deactivated rows still show up for reactivation."""
    supabase: Client = get_supabase_client()

    query = supabase.table("categories").select("*").eq("category_type", category_type)
    if active_only:
        query = query.eq("is_active", True)
    try:
        result = query.order("sort_order").order("code").execute()
    except Exception:
        result = query.order("code").execute()
    return result.data or []


def add_category(payload: dict) -> dict:
    """Add a new category."""
    supabase: Client = get_supabase_client()

    insert_data = {
        "category_type": payload["category_type"],
        "code": payload["code"],
        "name": payload.get("name"),
        "description": payload.get("description"),
        "platform": payload.get("platform", "general"),
        "is_active": payload.get("is_active", True),
    }
    if "sort_order" in payload:
        insert_data["sort_order"] = payload.get("sort_order") or 0

    result = (
        supabase.table("categories")
        .insert(insert_data)
        .execute()
    )
    return result.data[0] if result.data else {}


def update_category(category_id: str, payload: dict) -> dict:
    """Update an existing category."""
    supabase: Client = get_supabase_client()

    update_data = {k: v for k, v in payload.items() if k != "id" and v is not None}
    update_data["updated_at"] = "now()"

    result = (
        supabase.table("categories")
        .update(update_data)
        .eq("id", category_id)
        .execute()
    )
    return result.data[0] if result.data else {}


def delete_category(category_id: str) -> dict:
    """Delete a category."""
    supabase: Client = get_supabase_client()

    result = (
        supabase.table("categories")
        .delete()
        .eq("id", category_id)
        .execute()
    )
    return {"deleted": len(result.data) if result.data else 0}
