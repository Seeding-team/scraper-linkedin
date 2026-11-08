"""Supabase-based Quick Inbox template library service for all-platform module."""

from __future__ import annotations

from supabase import Client

from app.core.supabase_client import get_supabase_client

TABLE = "quick_inbox_templates"


def get_all_quick_inbox() -> list[dict]:
    """Get all quick inbox templates, ordered."""
    supabase: Client = get_supabase_client()

    result = supabase.table(TABLE).select("*").order("order_index").execute()
    return result.data or []


def add_quick_inbox(payload: dict, created_by: str | None) -> dict:
    """Add a new quick inbox template, appended to the end of the order."""
    supabase: Client = get_supabase_client()

    existing = (
        supabase.table(TABLE)
        .select("order_index")
        .order("order_index", desc=True)
        .limit(1)
        .execute()
    )
    next_order = (existing.data[0]["order_index"] + 1) if existing.data else 1

    insert_data = {
        "title": payload["title"],
        "label": payload.get("label") or "Khác",
        "content": payload["content"],
        "content_with_post": payload.get("content_with_post"),
        "order_index": next_order,
        "created_by": created_by,
    }

    result = supabase.table(TABLE).insert(insert_data).execute()
    return result.data[0] if result.data else {}


def update_quick_inbox(template_id: str, payload: dict) -> dict:
    """Update an existing quick inbox template."""
    supabase: Client = get_supabase_client()

    update_data = {k: v for k, v in payload.items() if k != "id" and v is not None}
    update_data["updated_at"] = "now()"

    result = (
        supabase.table(TABLE)
        .update(update_data)
        .eq("id", template_id)
        .execute()
    )
    return result.data[0] if result.data else {}


def delete_quick_inbox(template_id: str) -> dict:
    """Delete a quick inbox template."""
    supabase: Client = get_supabase_client()

    result = supabase.table(TABLE).delete().eq("id", template_id).execute()
    return {"deleted": len(result.data) if result.data else 0}


def reorder_quick_inbox(template_id: str, direction: str) -> list[dict]:
    """Swap order_index between the target template and its neighbor, return the full ordered list."""
    supabase: Client = get_supabase_client()

    items = supabase.table(TABLE).select("*").order("order_index").execute().data or []
    index = next((i for i, item in enumerate(items) if item["id"] == template_id), None)
    if index is None:
        return items

    target_index = index - 1 if direction == "up" else index + 1
    if target_index < 0 or target_index >= len(items):
        return items

    current_item = items[index]
    target_item = items[target_index]

    supabase.table(TABLE).update({"order_index": target_item["order_index"]}).eq(
        "id", current_item["id"]
    ).execute()
    supabase.table(TABLE).update({"order_index": current_item["order_index"]}).eq(
        "id", target_item["id"]
    ).execute()

    return get_all_quick_inbox()
