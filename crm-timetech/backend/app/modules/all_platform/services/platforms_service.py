"""Supabase-based platforms service — read-only list of platforms."""

from __future__ import annotations

from supabase import Client

from app.core.supabase_client import get_supabase_client


def get_all_platforms() -> list[dict]:
    """Get all rows from the platforms table, ordered by display_order then id."""
    supabase: Client = get_supabase_client()

    result = (
        supabase.table("platforms")
        .select("id, name")
        .order("id")
        .execute()
    )
    return result.data or []
