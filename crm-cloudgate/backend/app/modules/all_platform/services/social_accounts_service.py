"""Social accounts service — CRUD for social media accounts linked to app users."""

from __future__ import annotations

from app.core.supabase_client import execute_supabase_query, get_supabase_client


def get_social_accounts(app_user_id: str, platform: str | None = None) -> list[dict]:
    """Get all social accounts for an app user, optionally filtered by platform slug."""
    # Map platforms
    plat_res = execute_supabase_query(
        lambda: get_supabase_client().table("platforms").select("id, name").execute()
    )
    plat_map = {p["id"]: p.get("name", "").strip().lower() for p in (plat_res.data or [])}
    
    target_id = None
    if platform:
        for pid, p_slug in plat_map.items():
            if p_slug == platform:
                target_id = pid
                break
        if target_id is None:
            return []
            
    def _load_accounts():
        query = get_supabase_client().table("social_accounts").select("*").eq("app_user_id", app_user_id)
        if target_id is not None:
            query = query.eq("id_platform", target_id)
        return query.order("created_at", desc=True).execute()

    result = execute_supabase_query(_load_accounts)
    
    items = result.data or []
    for item in items:
        item["platform"] = plat_map.get(item.get("id_platform"), "unknown")
    return items


def get_social_account_by_id(account_id: str, app_user_id: str) -> dict | None:
    """Get a specific social account (must belong to user)."""
    result = execute_supabase_query(
        lambda: (
            get_supabase_client().table("social_accounts")
            .select("*")
            .eq("id", account_id)
            .eq("app_user_id", app_user_id)
            .execute()
        )
    )
    return result.data[0] if result.data else None


def get_primary_account(app_user_id: str, platform: str) -> dict | None:
    """Get the primary social account for a platform slug."""
    plat_res = execute_supabase_query(
        lambda: get_supabase_client().table("platforms").select("id, name").execute()
    )
    target_id = None
    for p in (plat_res.data or []):
        if p.get("name", "").lower() == platform:
            target_id = p["id"]
            break
            
    if target_id is None:
        return None
        
    result = execute_supabase_query(
        lambda: (
            get_supabase_client().table("social_accounts")
            .select("*")
            .eq("app_user_id", app_user_id)
            .eq("id_platform", target_id)
            .eq("is_primary", True)
            .eq("is_active", True)
            .execute()
        )
    )
    
    item = result.data[0] if result.data else None
    if item:
        item["platform"] = platform
    return item


def create_social_account(
    app_user_id: str,
    platform: str,
    account_name: str,
    account_email: str | None = None,
    account_password: str | None = None,
    account_profile_id: str | None = None,
    id_platform: int | None = None,
    is_primary: bool = False,
    notes: str | None = None,
    is_banned: bool = False,
    ban_reason: str | None = None,
) -> dict:
    """Create a new social account."""
    # Auto-resolve id_platform if not provided
    if id_platform is None:
        plat_res = execute_supabase_query(
            lambda: get_supabase_client().table("platforms").select("id, name").execute()
        )
        for p in (plat_res.data or []):
            if p.get("name", "").strip().lower() == platform:
                id_platform = p["id"]
                break

    insert_data = {
        "app_user_id": app_user_id,
        "account_name": account_name,
        "account_email": account_email,
        "account_password": account_password,
        "account_profile_id": account_profile_id,
        "id_platform": id_platform,
        "is_primary": is_primary,
        "notes": notes,
        "is_banned": is_banned,
        "ban_reason": ban_reason if is_banned else None,
        "is_active": True,
    }

    result = execute_supabase_query(
        lambda: get_supabase_client().table("social_accounts").insert(insert_data).execute()
    )
    if not result.data:
        raise ValueError("Failed to create social account")
    item = result.data[0]
    item["platform"] = platform
    return item


def update_social_account(
    account_id: str,
    app_user_id: str,
    updates: dict,
) -> dict:
    """Update a social account (must belong to user)."""
    # Verify ownership
    existing = get_social_account_by_id(account_id, app_user_id)
    if not existing:
        raise ValueError("Social account not found")

    allowed_fields = (
        "account_name",
        "account_email",
        "account_password",
        "account_profile_id",
        "id_platform",
        "is_active",
        "is_primary",
        "notes",
        "is_banned",
        "ban_reason",
    )

    safe_updates = {
        k: v
        for k, v in updates.items()
        if k in allowed_fields
    }

    # Nếu bỏ tick BAN thì xóa lý do
    if safe_updates.get("is_banned") is False:
        safe_updates["ban_reason"] = None

    # Nếu tick BAN thì bắt buộc nhập lý do
    if safe_updates.get("is_banned") is True:
        reason = (safe_updates.get("ban_reason") or "").strip()

        if not reason:
            raise ValueError("Ban reason is required.")

        safe_updates["ban_reason"] = reason

    safe_updates["updated_at"] = "now()"

    result = execute_supabase_query(
        lambda: (
            get_supabase_client().table("social_accounts")
            .update(safe_updates)
            .eq("id", account_id)
            .eq("app_user_id", app_user_id)
            .execute()
        )
    )

    return result.data[0] if result.data else {}


def delete_social_account(account_id: str, app_user_id: str) -> dict:
    """Delete a social account (must belong to user)."""
    result = execute_supabase_query(
        lambda: (
            get_supabase_client().table("social_accounts")
            .delete()
            .eq("id", account_id)
            .eq("app_user_id", app_user_id)
            .execute()
        )
    )
    return {"deleted": len(result.data) if result.data else 0}


def set_primary_account(account_id: str, app_user_id: str) -> dict:
    """Set an account as primary (others of same platform auto-set to false via DB trigger)."""
    existing = get_social_account_by_id(account_id, app_user_id)
    if not existing:
        raise ValueError("Social account not found")

    result = execute_supabase_query(
        lambda: (
            get_supabase_client().table("social_accounts")
            .update({"is_primary": True, "updated_at": "now()"})
            .eq("id", account_id)
            .eq("app_user_id", app_user_id)
            .execute()
        )
    )
    return result.data[0] if result.data else {}


def get_social_account_summary(app_user_id: str) -> dict:
    """Get a summary of all social accounts grouped by platform."""
    accounts = get_social_accounts(app_user_id)
    summary: dict[str, dict] = {}
    for acc in accounts:
        platform = acc.get("platform", "unknown")
        if platform not in summary:
            summary[platform] = {"total": 0, "active": 0, "primary": None}
        summary[platform]["total"] += 1
        if acc.get("is_active"):
            summary[platform]["active"] += 1
        if acc.get("is_primary"):
            summary[platform]["primary"] = acc.get("account_name")
    return summary
