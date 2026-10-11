"""Supabase-based seeding KPI service for all-platform module."""

from __future__ import annotations

import os
from datetime import date
from typing import Optional

from supabase import Client

from app.core.supabase_client import get_supabase_client


def _today() -> str:
    return date.today().isoformat()

def _get_member_id(email: str) -> Optional[str]:
    supabase: Client = get_supabase_client()
    res = supabase.table("app_users").select("id").eq("email", email).limit(1).execute()
    return res.data[0].get("id") if res.data else None


def save_seeding_mark(payload: dict) -> dict:
    """Step 1: Mark a post for seeding (verify='pending')."""
    supabase: Client = get_supabase_client()

    today_str = payload.get("current_day") or _today()
    if len(today_str) == 10 and today_str[2] == "-" and today_str[5] == "-":
        parts = today_str.split("-")
        today_str = f"{parts[2]}-{parts[1]}-{parts[0]}"
        
    id_member = _get_member_id(payload["email_member"])
    if not id_member:
        raise ValueError("Member email not found in app_users")

    data = {
        "id_member": id_member,
        "link_post": payload["link_post"],
        "link_comment": payload.get("link_comment"),
        "content": payload.get("content"),
        "verify": "pending",
        "current_day": today_str,
    }
    
    if payload.get("id_social_account"):
        data["id_social_account"] = payload["id_social_account"]
    if payload.get("id_platform"):
        data["id_platform"] = payload["id_platform"]

    result = (
        supabase.table("seeding_content_kpi")
        .insert(data)
        .execute()
    )
    return result.data[0] if result.data else {}


def verify_seeding_mark(payload: dict) -> dict:
    """Step 2: Verify a seeding mark (fill full columns, verify='yes')."""
    supabase: Client = get_supabase_client()
    
    id_member = _get_member_id(payload["email_member"])
    if not id_member:
        raise ValueError("Member email not found in app_users")

    update_data = {}
    if "link_comment" in payload:
        update_data["link_comment"] = payload["link_comment"]
    if "content" in payload:
        update_data["content"] = payload["content"]
    if payload.get("id_social_account"):
        update_data["id_social_account"] = payload["id_social_account"]
    elif payload.get("profile_id"):
        try:
            sa_res = supabase.table("social_accounts").select("id, id_platform").eq("app_user_id", id_member).eq("account_profile_id", payload["profile_id"]).limit(1).execute()
            if sa_res.data:
                update_data["id_social_account"] = sa_res.data[0]["id"]
                if sa_res.data[0].get("id_platform"):
                    update_data["id_platform"] = sa_res.data[0]["id_platform"]
        except Exception:
            pass

    if payload.get("id_platform") and "id_platform" not in update_data:
        update_data["id_platform"] = payload["id_platform"]

    if payload.get("id_post"):
        update_data["id_post"] = payload["id_post"]
    elif payload.get("link_post"):
        try:
            post_res = supabase.table("facebook_posts").select("id").eq("post_url", payload["link_post"]).limit(1).execute()
            if post_res.data:
                update_data["id_post"] = post_res.data[0]["id"]
        except Exception:
            pass
        
    update_data["verify"] = "yes"
    update_data["updated_at"] = "now()"

    # Check if record exists
    existing = (
        supabase.table("seeding_content_kpi")
        .select("id")
        .eq("link_post", payload["link_post"])
        .eq("id_member", id_member)
        .execute()
    )

    if existing.data and len(existing.data) > 0:
        result = (
            supabase.table("seeding_content_kpi")
            .update(update_data)
            .eq("link_post", payload["link_post"])
            .eq("id_member", id_member)
            .execute()
        )
    else:
        from datetime import datetime, timezone, timedelta
        vn_tz = timezone(timedelta(hours=7))
        today_str = datetime.now(vn_tz).strftime('%Y-%m-%d')
        
        insert_data = {
            "id_member": id_member,
            "link_post": payload["link_post"],
            "current_day": today_str,
            **update_data
        }
        # remove updated_at for insert since it might not be needed or handled by default
        if "updated_at" in insert_data:
            del insert_data["updated_at"]
            
        result = (
            supabase.table("seeding_content_kpi")
            .insert(insert_data)
            .execute()
        )

    return result.data[0] if result.data else {}


def get_all_seeding_marks(email_member: str) -> list[dict]:
    """Get all seeding marks (verified + pending) for a member."""
    supabase: Client = get_supabase_client()
    id_member = _get_member_id(email_member)
    if not id_member: return []

    result = (
        supabase.table("seeding_content_kpi")
        .select("*")
        .eq("id_member", id_member)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def get_unverified_seeding_marks(email_member: str) -> list[dict]:
    """Get unverified (pending) seeding marks for a member."""
    supabase: Client = get_supabase_client()
    id_member = _get_member_id(email_member)
    if not id_member: return []

    result = (
        supabase.table("seeding_content_kpi")
        .select("*")
        .eq("id_member", id_member)
        .eq("verify", "pending")
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def get_member_seeding_count(
    email_member: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    profile_id: Optional[str] = None,
    facebook_name: Optional[str] = None,
) -> dict:
    """Get verified_count, total_count, and all items for a member."""
    supabase: Client = get_supabase_client()
    id_member = _get_member_id(email_member)
    if not id_member:
        return {"verified_count": 0, "total_count": 0, "kpi_target": 0, "items": []}

    query = (
        supabase.table("seeding_content_kpi")
        .select("*")
        .eq("id_member", id_member)
    )

    if date_from:
        query = query.gte("current_day", date_from)
    if date_to:
        query = query.lte("current_day", date_to)

    result = query.execute()
    items = result.data or []

    # Count verified (accept multiple possible "verified" values)
    verified_keywords = ("yes", "đã seeding", "xác minh", "verified")
    verified_items = [
        i for i in items
        if (i.get("verify") or "").lower() in verified_keywords
    ]

    kpi_target = 0
    try:
        if id_member:
            kpi_result = (
                supabase.table("kpi_tracker")
                .select("kpi_comment")
                .eq("id_member", id_member)
                .eq("status", "active")
                .execute()
            )
            if kpi_result.data:
                kpi_target = kpi_result.data[0].get("kpi_comment", 0) or 0
    except Exception:
        pass

    return {
        "verified_count": len(verified_items),
        "total_count": len(items),
        "kpi_target": kpi_target,
        "items": items,
    }


def save_seeding_kpi(payload: dict) -> dict:
    """Save a seeding KPI row (called by Chrome extension / seeding tool)."""
    return save_seeding_mark(payload)


def get_all_seeding_kpi(email_member: str) -> list[dict]:
    """Get all seeding KPI rows for a member."""
    return get_all_seeding_marks(email_member)


def get_kpi_target(
    email_member: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    id_team: Optional[str] = None,
) -> dict:
    """Get KPI target for a member from kpi_tracker.

    DB clean: resolve email -> app_users.id then query kpi_tracker.id_member.
    """
    supabase: Client = get_supabase_client()

    ures = (
        supabase.table("app_users")
        .select("id")
        .eq("email", email_member)
        .limit(1)
        .execute()
    )
    member_id = ures.data[0].get("id") if ures.data else None
    if not member_id:
        return {}

    query = (
        supabase.table("kpi_tracker")
        .select("*")
        .eq("id_member", member_id)
        .eq("status", "active")
    )
    if id_team:
        query = query.eq("id_team", id_team)

    if date_from and date_to:
        # KPI that overlaps with the requested range:
        # KPI.start_date <= date_to AND KPI.end_date >= date_from
        query = (
            query
            .lte("start_date", date_to)
            .gte("end_date", date_from)
        )
    elif date_to:
        query = query.lte("start_date", date_to)
    elif date_from:
        query = query.gte("end_date", date_from)

    result = query.execute()
    return result.data[0] if result.data else {}
