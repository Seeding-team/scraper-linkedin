"""Service for managing linkedin_account table in Supabase."""

from __future__ import annotations

from typing import Optional

from app.core.supabase_client import get_supabase_client


def get_linkedin_accounts() -> list[dict]:
    """Get all LinkedIn accounts from the linkedin_account table."""
    supabase = get_supabase_client()
    result = (
        supabase.table("linkedin_account_crawl")
        .select("id, id_member, email_linkedin, created_at, app_users!inner(email)")
        .order("created_at", desc=True)
        .execute()
    )
    
    accounts = []
    for row in (result.data or []):
        app_user = row.get("app_users")
        email_member = app_user.get("email") if isinstance(app_user, dict) else ""
        accounts.append({
            "id": row["id"],
            "id_member": row["id_member"],
            "email_linkedin": row["email_linkedin"],
            "created_at": row["created_at"],
            "email_member": email_member
        })
    return accounts


def add_linkedin_account(email_member: str, email_linkedin: str, password: str) -> dict:
    """Add a new LinkedIn account."""
    supabase = get_supabase_client()
    
    user_res = supabase.table("app_users").select("id").eq("email", email_member.strip().lower()).limit(1).execute()
    if not user_res.data:
        raise ValueError(f"User not found for email: {email_member}")
    user_id = user_res.data[0]["id"]
    
    result = (
        supabase.table("linkedin_account_crawl")
        .insert({
            "id_member": user_id,
            "email_linkedin": email_linkedin,
            "password": password,
        })
        .execute()
    )
    return result.data[0] if result.data else {}


def update_linkedin_account(account_id: str, payload: dict) -> dict:
    """Update an existing LinkedIn account."""
    supabase = get_supabase_client()
    update_data = {}
    if "email_member" in payload:
        email_member = payload["email_member"]
        user_res = supabase.table("app_users").select("id").eq("email", email_member.strip().lower()).limit(1).execute()
        if user_res.data:
            update_data["id_member"] = user_res.data[0]["id"]
    if "email_linkedin" in payload:
        update_data["email_linkedin"] = payload["email_linkedin"]
    if "password" in payload and payload["password"]:
        update_data["password"] = payload["password"]

    result = (
        supabase.table("linkedin_account_crawl")
        .update(update_data)
        .eq("id", account_id)
        .execute()
    )
    return result.data[0] if result.data else {}


def delete_linkedin_account(account_id: str) -> dict:
    """Delete a LinkedIn account."""
    supabase = get_supabase_client()
    result = (
        supabase.table("linkedin_account_crawl")
        .delete()
        .eq("id", account_id)
        .execute()
    )
    return {"deleted": len(result.data) if result.data else 0}


def get_linkedin_account_password(email_linkedin: str) -> Optional[str]:
    """Get password for a specific LinkedIn email (for crawl use only)."""
    supabase = get_supabase_client()
    result = (
        supabase.table("linkedin_account_crawl")
        .select("password")
        .eq("email_linkedin", email_linkedin)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0].get("password")
    return None
