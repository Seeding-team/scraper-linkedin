"""Supabase-based groups service for all-platform module."""

from __future__ import annotations

from typing import Optional

from supabase import Client

from app.core.supabase_client import get_supabase_client


def get_facebook_groups(
    id_intent: Optional[str] = None,
    id_team: Optional[str] = None,
    id_tier: Optional[str] = None,
    id_member: Optional[str] = None,
) -> list[dict]:
    """Get all Facebook groups, optionally filtered by FK IDs.

    Enriches each group with resolved category names (intent_name, industry_name,
    team_name, tier_name, icp_name) by joining against the categories table.
    """
    supabase: Client = get_supabase_client()

    query = supabase.table("facebook_groups").select("*")

    if id_intent:
        query = query.eq("id_intent", id_intent)
    if id_team:
        query = query.eq("id_team", id_team)
    if id_tier:
        query = query.eq("id_tier", id_tier)
    if id_member:
        query = query.eq("id_member", id_member)

    result = query.order("group_name").execute()
    rows: list[dict] = result.data or []

    # Collect all FK ids to batch-fetch categories
    cat_ids: set[str] = set()
    for r in rows:
        for fk in ("id_intent", "id_industry", "id_tier", "id_team", "id_icp", "id_content_type", "id_product_seeding"):
            val = r.get(fk)
            if val:
                cat_ids.add(str(val))

    # Batch-fetch categories in one query
    cat_map: dict[str, dict] = {}
    if cat_ids:
        cat_rows = (
            supabase.table("categories")
            .select("id, category_type, code, name")
            .in_("id", list(cat_ids))
            .execute()
        )
        for c in (cat_rows.data or []):
            cat_map[str(c["id"])] = c

    # Resolve FK → display name and attach to each row
    type_field_map = {
        "id_intent":   "intent",
        "id_industry": "industry",
        "id_tier":     "tier",
        "id_team":     "team",
        "id_icp":      "icp",
        "id_content_type": "content_type",
        "id_product_seeding": "product_seeding",
    }
    name_field_map = {
        "id_intent":   "intent_name",
        "id_industry": "industry_name",
        "id_tier":     "tier_name",
        "id_team":     "team_name",
        "id_icp":      "icp_name",
        "id_content_type": "content_type_name",
        "id_product_seeding": "product_seeding_name",
    }

    for r in rows:
        for fk_field, disp_field in name_field_map.items():
            cat_id = r.get(fk_field)
            if cat_id and str(cat_id) in cat_map:
                cat = cat_map[str(cat_id)]
                r[disp_field] = cat.get("name") or cat.get("code") or str(cat_id)
            else:
                r[disp_field] = None

    return rows


def _clean_group_payload(payload: dict) -> dict:
    """Clean group payload by converting empty/whitespace strings to None/proper types."""
    cleaned = {}
    numeric_fields = {"tier", "members", "posts_per_week", "health_score", "start_time_in_day", "end_time_in_day", "time_crawl"}

    for k, v in payload.items():
        if k in numeric_fields:
            if v is None or v == "" or (isinstance(v, str) and not v.strip()):
                cleaned[k] = None
            else:
                try:
                    cleaned[k] = int(float(v))
                except (ValueError, TypeError):
                    cleaned[k] = None
        elif isinstance(v, str) and not v.strip():
            cleaned[k] = None
        else:
            cleaned[k] = v
    return cleaned


def add_facebook_group(payload: dict) -> dict:
    """Add a new Facebook group."""
    supabase: Client = get_supabase_client()

    cleaned = _clean_group_payload(payload)
    insert_data = {
        "group_name": cleaned.get("group_name"),
        "group_url": cleaned.get("group_url"),
        "members": cleaned.get("members"),
        "posts_per_week": cleaned.get("posts_per_week"),
        "health_score": cleaned.get("health_score"),
        "chay_24h": cleaned.get("chay_24h", False),
        "crawl_time": cleaned.get("crawl_time"),
        "crawl_frequency": cleaned.get("crawl_frequency"),
        "id_member": cleaned.get("id_member"),
        # Stable FK fields (match DB clean)
        "id_intent": cleaned.get("id_intent"),
        "id_industry": cleaned.get("id_industry"),
        "id_tier": cleaned.get("id_tier"),
        "id_team": cleaned.get("id_team"),
        "id_icp": cleaned.get("id_icp"),
        "id_content_type": cleaned.get("id_content_type"),
        "id_product_seeding": cleaned.get("id_product_seeding"),
        "end_time_24h": cleaned.get("end_time_24h"),
        "start_time_in_day": cleaned.get("start_time_in_day"),
        "end_time_in_day": cleaned.get("end_time_in_day"),
        "time_crawl": cleaned.get("time_crawl"),
        "end_date_hour": cleaned.get("end_date_hour"),
        "note": cleaned.get("note"),
        "risk_note": cleaned.get("risk_note"),
        "assignee_id": cleaned.get("assignee_id"),
        "co_assignee_id": cleaned.get("co_assignee_id"),
        # Ten hien thi tai thoi diem chon, dung khi id that o tren la NULL
        # (nguoi duoc chon chua lien ket tai khoan dang nhap) - xem migration 045.
        "assignee_name_hint": cleaned.get("assignee_name_hint"),
        "co_assignee_name_hint": cleaned.get("co_assignee_name_hint"),
        "id_member_name_hint": cleaned.get("id_member_name_hint"),
    }

    result = (
        supabase.table("facebook_groups")
        .insert(insert_data)
        .execute()
    )
    return result.data[0] if result.data else {}


def update_facebook_group(group_id: str, payload: dict) -> dict:
    """Update an existing Facebook group."""
    supabase: Client = get_supabase_client()

    cleaned = _clean_group_payload(payload)
    allowed_fields = {
        "group_name",
        "group_url",
        "members",
        "posts_per_week",
        "health_score",
        "chay_24h",
        "crawl_time",
        "crawl_frequency",
        "id_member",
        # stable FK fields
        "id_intent",
        "id_industry",
        "id_tier",
        "id_team",
        "id_icp",
        "id_content_type",
        "id_product_seeding",
        "end_time_24h",
        "start_time_in_day",
        "end_time_in_day",
        "time_crawl",
        "end_date_hour",
        "note",
        "risk_note",
        "assignee_id",
        "co_assignee_id",
        "assignee_name_hint",
        "co_assignee_name_hint",
        "id_member_name_hint",
    }

    update_data = {k: v for k, v in cleaned.items() if k in allowed_fields}
    update_data["updated_at"] = "now()"

    # Note: we need to allow `None` to unset a crawl_time or frequency
    # We remove keys that are completely missing from the payload?
    # Actually, the payload is fully merged in update_data.

    result = (
        supabase.table("facebook_groups")
        .update(update_data)
        .eq("id", group_id)
        .execute()
    )
    return result.data[0] if result.data else {}


def delete_facebook_group(group_id: str, id_member: str, is_admin: bool = False) -> dict:
    """Delete a Facebook group and all its posts, scoped to member unless admin."""
    supabase: Client = get_supabase_client()

    group_res = (
        supabase.table("facebook_groups")
        .select("group_url, id_member")
        .eq("id", group_id)
        .execute()
    )
    deleted_posts = 0
    if group_res.data:
        group = group_res.data[0]
        # Ensure the group belongs to the member before deleting (unless admin)
        if not is_admin and group.get("id_member") != id_member:
            raise ValueError("You don't have permission to delete this group.")
            
        group_url = group.get("group_url")
        if group_url:
            posts_res = (
                supabase.table("facebook_posts")
                .delete()
                .eq("group_id", group_id)  # Fix: dùng group_id thay vì group_url
                .execute()
            )
            deleted_posts = len(posts_res.data) if posts_res.data else 0

    query = supabase.table("facebook_groups").delete().eq("id", group_id)
    if not is_admin:
        query = query.eq("id_member", id_member)
    result = query.execute()
    return {
        "deleted": len(result.data) if result.data else 0,
        "deleted_posts": deleted_posts
    }


def get_linkedin_groups(status: Optional[str] = None, id_member: Optional[str] = None) -> list[dict]:
    """Get all LinkedIn groups, optionally filtered.

    Enriches each group with resolved category names (intent_name, industry_name,
    team_name, tier_name, icp_name) by joining against the categories table.
    """
    supabase: Client = get_supabase_client()

    query = supabase.table("linkedin_groups").select("*")

    if status:
        query = query.eq("status", status)
    if id_member:
        query = query.eq("id_member", id_member)

    result = query.order("group_name").execute()
    rows: list[dict] = result.data or []

    # Collect all FK ids to batch-fetch categories
    cat_ids: set[str] = set()
    for r in rows:
        for fk in ("id_intent", "id_industry", "id_tier", "id_team", "id_icp", "id_content_type", "id_product_seeding"):
            val = r.get(fk)
            if val:
                cat_ids.add(str(val))

    # Batch-fetch categories in one query
    cat_map: dict[str, dict] = {}
    if cat_ids:
        cat_rows = (
            supabase.table("categories")
            .select("id, category_type, code, name")
            .in_("id", list(cat_ids))
            .execute()
        )
        for c in (cat_rows.data or []):
            cat_map[str(c["id"])] = c

    name_field_map = {
        "id_intent":   "intent_name",
        "id_industry": "industry_name",
        "id_tier":     "tier_name",
        "id_team":     "team_name",
        "id_icp":      "icp_name",
        "id_content_type": "content_type_name",
        "id_product_seeding": "product_seeding_name",
    }

    for r in rows:
        for fk_field, disp_field in name_field_map.items():
            cat_id = r.get(fk_field)
            if cat_id and str(cat_id) in cat_map:
                cat = cat_map[str(cat_id)]
                r[disp_field] = cat.get("name") or cat.get("code") or str(cat_id)
            else:
                r[disp_field] = None

    return rows


def add_linkedin_group(payload: dict) -> dict:
    """Add a new LinkedIn group."""
    supabase: Client = get_supabase_client()

    cleaned = _clean_group_payload(payload)
    insert_data = {
        "group_url": cleaned["group_url"],
        "group_name": cleaned.get("group_name"),
        "status": "idle",
        "id_member": cleaned.get("id_member"),
        # Stable FK fields (match DB clean)
        "id_intent": cleaned.get("id_intent"),
        "id_industry": cleaned.get("id_industry"),
        "id_tier": cleaned.get("id_tier"),
        "id_team": cleaned.get("id_team"),
        "id_icp": cleaned.get("id_icp"),
        "id_content_type": cleaned.get("id_content_type"),
        "id_product_seeding": cleaned.get("id_product_seeding"),
        "note": cleaned.get("note"),
        "risk_note": cleaned.get("risk_note"),
        "assignee_id": cleaned.get("assignee_id"),
        "co_assignee_id": cleaned.get("co_assignee_id"),
        "assignee_name_hint": cleaned.get("assignee_name_hint"),
        "co_assignee_name_hint": cleaned.get("co_assignee_name_hint"),
        "id_member_name_hint": cleaned.get("id_member_name_hint"),
    }

    result = (
        supabase.table("linkedin_groups")
        .insert(insert_data)
        .execute()
    )
    return result.data[0] if result.data else {}


def update_linkedin_group(group_id: str, payload: dict) -> dict:
    """Update an existing LinkedIn group."""
    supabase: Client = get_supabase_client()

    cleaned = _clean_group_payload(payload)
    allowed_fields = {
        "group_url",
        "group_name",
        "status",
        "id_member",
        # stable FK fields
        "id_intent",
        "id_industry",
        "id_tier",
        "id_team",
        "id_icp",
        "id_content_type",
        "id_product_seeding",
        "note",
        "risk_note",
        "assignee_id",
        "co_assignee_id",
        "assignee_name_hint",
        "co_assignee_name_hint",
        "id_member_name_hint",
    }

    update_data = {k: v for k, v in cleaned.items() if k in allowed_fields and v is not None}
    update_data["updated_at"] = "now()"

    result = (
        supabase.table("linkedin_groups")
        .update(update_data)
        .eq("id", group_id)
        .execute()
    )
    return result.data[0] if result.data else {}


def delete_linkedin_group(group_id: str) -> dict:
    """Delete a LinkedIn group and all its posts."""
    supabase: Client = get_supabase_client()

    group_res = (
        supabase.table("linkedin_groups")
        .select("group_url")
        .eq("id", group_id)
        .execute()
    )
    deleted_posts = 0
    if group_res.data:
        group_url = group_res.data[0].get("group_url")
        if group_url:
            posts_res = (
                supabase.table("linkedin_posts")
                .delete()
                .eq("group_url", group_url)
                .execute()
            )
            deleted_posts = len(posts_res.data) if posts_res.data else 0

    result = (
        supabase.table("linkedin_groups")
        .delete()
        .eq("id", group_id)
        .execute()
    )
    return {
        "deleted": len(result.data) if result.data else 0,
        "deleted_posts": deleted_posts
    }
