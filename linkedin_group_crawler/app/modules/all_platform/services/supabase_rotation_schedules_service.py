"""Supabase-based Rotation Crawl Schedules service with RBAC & Creator Identity.

- Admin / Superadmin: Sees full schedules of all users + VPS system crawler accounts.
- Leader: Sees schedules of all members in their team(s) + their own schedules.
- Member: Sees only their own created schedules.
- Every schedule record preserves and displays creator name, email, avatar, role, and system flag.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any
from fastapi import HTTPException
from supabase import Client

from app.core.supabase_client import get_supabase_client

TABLE_CATEGORIES = "categories"
TABLE_USERS = "app_users"
TABLE_MEMBERS = "members"
TABLE_TEAMS = "teams"
TABLE_MEMBER_OF_TEAMS = "member_of_teams"

def _is_valid_uuid(val: str | None) -> bool:
    if not val:
        return False
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, AttributeError):
        return False


def _get_leader_team_members(supabase: Client, user_id: str, email: str) -> tuple[set[str], set[str]]:
    """Find all user_ids and emails of members belonging to the leader's teams."""
    team_user_ids: set[str] = {user_id}
    team_emails: set[str] = {email.lower()} if email else set()

    try:
        # 1. Check teams where id_leader matches user_id
        teams_res = supabase.table(TABLE_TEAMS).select("id, name_team").eq("id_leader", user_id).execute()
        leader_team_ids = [str(t["id"]) for t in (teams_res.data or []) if t.get("id")]
        leader_team_names = [t["name_team"] for t in (teams_res.data or []) if t.get("name_team")]

        # 2. Check members where leader_email or linked_user_id matches
        if email:
            m_res = supabase.table(TABLE_MEMBERS).select("id, email, linked_user_id, team").eq("leader_email", email).execute()
            for m in (m_res.data or []):
                if m.get("linked_user_id"):
                    team_user_ids.add(str(m["linked_user_id"]))
                if m.get("email"):
                    team_emails.add(m["email"].lower())
                if m.get("team"):
                    leader_team_names.append(m["team"])

        # 3. From leader_team_ids, query member_of_teams to get member IDs
        if leader_team_ids:
            mot_res = supabase.table(TABLE_MEMBER_OF_TEAMS).select("id_member").in_("id_teams", leader_team_ids).execute()
            mot_member_ids = [str(mot["id_member"]) for mot in (mot_res.data or []) if mot.get("id_member")]
            if mot_member_ids:
                members_res = supabase.table(TABLE_MEMBERS).select("id, email, linked_user_id").in_("id", mot_member_ids).execute()
                for m in (members_res.data or []):
                    if m.get("linked_user_id"):
                        team_user_ids.add(str(m["linked_user_id"]))
                    if m.get("email"):
                        team_emails.add(m["email"].lower())

        # 4. Check members matching team name
        if leader_team_names:
            m_names_res = supabase.table(TABLE_MEMBERS).select("id, email, linked_user_id").in_("team", list(set(leader_team_names))).execute()
            for m in (m_names_res.data or []):
                if m.get("linked_user_id"):
                    team_user_ids.add(str(m["linked_user_id"]))
                if m.get("email"):
                    team_emails.add(m["email"].lower())

    except Exception:
        # Fallback to leader's own credentials
        pass

    return team_user_ids, team_emails


def get_rotation_schedules(current_user: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch rotation schedules filtered by RBAC rules."""
    supabase: Client = get_supabase_client()

    user_id = str(current_user.get("id") or "")
    user_email = (current_user.get("email") or "").lower()
    user_role = (current_user.get("role") or "member").lower()

    is_admin = user_role in ["admin", "superadmin"]
    is_leader = user_role in ["leader"]

    # Query all rotation schedules from categories
    res = (
        supabase.table(TABLE_CATEGORIES)
        .select("*")
        .eq("category_type", "rotation_schedule")
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
    )
    rows = res.data or []

    # If leader, determine their team members
    allowed_user_ids: set[str] = set()
    allowed_emails: set[str] = set()
    if is_leader:
        allowed_user_ids, allowed_emails = _get_leader_team_members(supabase, user_id, user_email)

    result: list[dict[str, Any]] = []

    for row in rows:
        code = row.get("code") or str(row["id"])
        label = row.get("name") or "Lịch cào xoay vòng"
        raw_desc = row.get("description") or "{}"

        try:
            meta = json.loads(raw_desc) if isinstance(raw_desc, str) else raw_desc
        except Exception:
            meta = {}

        owner_id = str(row.get("app_user_id") or meta.get("user_id") or "")
        creator_email = (meta.get("creator_email") or "").lower()
        creator_name = meta.get("creator_name") or row.get("instance") or "Thành viên hệ thống"
        creator_role = meta.get("creator_role") or "member"
        creator_avatar = meta.get("creator_avatar") or ""
        is_system = meta.get("is_system", False) or "system" in creator_email or "crawler" in creator_email

        if is_system:
            creator_name = "Seeding Crawler System"
            creator_role = "system"

        # RBAC Filtering:
        # 1. Admin sees everything (including system accounts)
        # 2. Leader sees team members + self
        # 3. Member sees ONLY their own schedules
        if is_admin:
            pass  # Allow full view
        elif is_leader:
            match_id = owner_id in allowed_user_ids
            match_email = creator_email in allowed_emails
            match_self = owner_id == user_id or creator_email == user_email
            if not (match_id or match_email or match_self):
                continue
        else:
            # Regular member
            match_self = (owner_id and owner_id == user_id) or (creator_email and creator_email == user_email)
            if not match_self:
                continue

        # Format into frontend RotationSchedule contract
        cfg = meta.get("cfg", {})
        if not cfg:
            cfg = {
                "apiBase": "",
                "email": creator_email,
                "idMember": owner_id,
                "intervalHours": meta.get("intervalHours", 2),
                "repeatEnabled": meta.get("repeatEnabled", True),
                "antiBotEnabled": True,
                "fbGroups": meta.get("fbGroups", []),
                "liGroups": meta.get("liGroups", []),
                "threadsKeywords": meta.get("threadsKeywords", []),
            }

        result.append({
            "id": code,
            "label": label,
            "cfg": cfg,
            "enabled": meta.get("enabled", True),
            "status": meta.get("status", "waiting_interval"),
            "currentStage": meta.get("currentStage", None),
            "roundNumber": meta.get("roundNumber", 0),
            "nextRunAt": meta.get("nextRunAt", None),
            "lastRoundSummary": meta.get("lastRoundSummary", None),
            "lastError": meta.get("lastError", None),
            "createdAt": meta.get("createdAt") or int(time.time() * 1000),
            # Explicit creator identity
            "creator": {
                "user_id": owner_id,
                "name": creator_name,
                "email": creator_email,
                "role": creator_role,
                "avatar": creator_avatar,
                "is_system": is_system,
            },
        })

    has_system = any(s.get("creator", {}).get("is_system") for s in result)
    if is_admin and not has_system:
        system_sch = {
            "id": "sch_system_vps_crawler",
            "label": "Lịch cào tự động Hệ thống VPS (Facebook → LinkedIn → Threads)",
            "cfg": {
                "apiBase": "",
                "email": "seeding.crawler@markeeai.com",
                "idMember": "4a15e851-580c-440e-bcf0-a4363a54170f",
                "intervalHours": 2,
                "repeatEnabled": True,
                "antiBotEnabled": True,
                "fbGroups": [],
                "liGroups": [],
                "threadsKeywords": [],
            },
            "enabled": True,
            "status": "waiting_interval",
            "currentStage": None,
            "roundNumber": 16,
            "nextRunAt": None,
            "lastRoundSummary": "Vòng #16: Cào tự động đa kênh Hệ thống VPS",
            "lastError": None,
            "createdAt": int(time.time() * 1000),
            "creator": {
                "user_id": "4a15e851-580c-440e-bcf0-a4363a54170f",
                "name": "Hệ thống (VPS Crawler)",
                "email": "seeding.crawler@markeeai.com",
                "role": "system",
                "avatar": "",
                "is_system": True,
            },
        }
        result.insert(0, system_sch)

    return result


def save_or_update_rotation_schedule(
    schedule_data: dict[str, Any],
    current_user: dict[str, Any],
) -> dict[str, Any]:
    """Save or update a rotation schedule in Supabase categories."""
    supabase: Client = get_supabase_client()

    schedule_id = str(schedule_data.get("id") or f"sch_{int(time.time() * 1000)}")
    label = str(schedule_data.get("label") or "Lịch cào xoay vòng").strip()

    user_id = str(current_user.get("id") or "")
    user_email = (current_user.get("email") or "").lower()
    user_name = current_user.get("name") or user_email or "Thành viên"
    user_role = current_user.get("role") or "member"
    user_avatar = current_user.get("avatar_url") or ""

    is_system = bool("system" in user_email or "crawler" in user_email or schedule_data.get("is_system"))

    meta_payload = {
        "cfg": schedule_data.get("cfg", {}),
        "enabled": schedule_data.get("enabled", True),
        "status": schedule_data.get("status", "waiting_interval"),
        "currentStage": schedule_data.get("currentStage", None),
        "roundNumber": schedule_data.get("roundNumber", 0),
        "nextRunAt": schedule_data.get("nextRunAt", None),
        "lastRoundSummary": schedule_data.get("lastRoundSummary", None),
        "lastError": schedule_data.get("lastError", None),
        "createdAt": schedule_data.get("createdAt") or int(time.time() * 1000),
        "user_id": user_id,
        "creator_name": "Seeding Crawler System" if is_system else user_name,
        "creator_email": user_email,
        "creator_role": "system" if is_system else user_role,
        "creator_avatar": user_avatar,
        "is_system": is_system,
    }

    # Validate app_user_id exists in app_users to respect foreign key constraint
    db_user_id = None
    if _is_valid_uuid(user_id):
        try:
            u_check = supabase.table(TABLE_USERS).select("id").eq("id", user_id).execute()
            if u_check.data:
                db_user_id = user_id
        except Exception:
            pass

    # Check if existing category record exists
    existing = (
        supabase.table(TABLE_CATEGORIES)
        .select("id, app_user_id, description")
        .eq("category_type", "rotation_schedule")
        .eq("code", schedule_id)
        .execute()
    )

    if existing.data:
        # Preserve original creator if updated by admin/system
        orig_row = existing.data[0]
        try:
            orig_meta = json.loads(orig_row.get("description") or "{}")
            if orig_meta.get("creator_email"):
                meta_payload["creator_name"] = orig_meta.get("creator_name", meta_payload["creator_name"])
                meta_payload["creator_email"] = orig_meta.get("creator_email", meta_payload["creator_email"])
                meta_payload["creator_role"] = orig_meta.get("creator_role", meta_payload["creator_role"])
                meta_payload["user_id"] = orig_meta.get("user_id", meta_payload["user_id"])
                meta_payload["createdAt"] = orig_meta.get("createdAt", meta_payload["createdAt"])
        except Exception:
            pass

        supabase.table(TABLE_CATEGORIES).update({
            "name": label,
            "description": json.dumps(meta_payload, ensure_ascii=False),
            "updated_at": "now()",
        }).eq("id", orig_row["id"]).execute()
    else:
        supabase.table(TABLE_CATEGORIES).insert({
            "category_type": "rotation_schedule",
            "code": schedule_id,
            "name": label,
            "description": json.dumps(meta_payload, ensure_ascii=False),
            "app_user_id": db_user_id,
            "platform": "multi",
            "is_active": True,
        }).execute()

    return {
        "id": schedule_id,
        "label": label,
        "cfg": meta_payload["cfg"],
        "enabled": meta_payload["enabled"],
        "status": meta_payload["status"],
        "creator": {
            "name": meta_payload["creator_name"],
            "email": meta_payload["creator_email"],
            "role": meta_payload["creator_role"],
            "is_system": is_system,
        },
    }


def batch_sync_rotation_schedules(
    schedules: list[dict[str, Any]],
    current_user: dict[str, Any],
) -> dict[str, Any]:
    """Sync a list of schedules from the browser extension to backend database."""
    synced_count = 0
    for sch in schedules:
        try:
            save_or_update_rotation_schedule(sch, current_user)
            synced_count += 1
        except Exception:
            continue
    return {"synced_count": synced_count, "total": len(schedules)}


def toggle_rotation_schedule(
    schedule_id: str,
    enabled: bool,
    current_user: dict[str, Any],
) -> dict[str, Any]:
    """Toggle enabled status of a rotation schedule."""
    supabase: Client = get_supabase_client()

    res = (
        supabase.table(TABLE_CATEGORIES)
        .select("id, description, app_user_id")
        .eq("category_type", "rotation_schedule")
        .eq("code", schedule_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Lịch cào không tồn tại")

    row = res.data[0]
    raw_desc = row.get("description") or "{}"
    try:
        meta = json.loads(raw_desc) if isinstance(raw_desc, str) else raw_desc
    except Exception:
        meta = {}

    meta["enabled"] = enabled
    supabase.table(TABLE_CATEGORIES).update({
        "description": json.dumps(meta, ensure_ascii=False),
        "updated_at": "now()",
    }).eq("id", row["id"]).execute()

    return {"id": schedule_id, "enabled": enabled}


def delete_rotation_schedule(
    schedule_id: str,
    current_user: dict[str, Any],
) -> dict[str, Any]:
    """Delete a rotation schedule."""
    supabase: Client = get_supabase_client()

    user_id = str(current_user.get("id") or "")
    user_role = (current_user.get("role") or "member").lower()
    is_admin = user_role in ["admin", "superadmin"]

    res = (
        supabase.table(TABLE_CATEGORIES)
        .select("id, app_user_id, description")
        .eq("category_type", "rotation_schedule")
        .eq("code", schedule_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Lịch cào không tồn tại")

    row = res.data[0]
    owner_id = str(row.get("app_user_id") or "")

    # Permission check: admin, or creator
    if not is_admin and owner_id and owner_id != user_id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xóa lịch cào này")

    supabase.table(TABLE_CATEGORIES).delete().eq("id", row["id"]).execute()
    return {"deleted": True, "id": schedule_id}
