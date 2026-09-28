"""CRUD "Team CRM" (crm_teams/crm_team_members) - KHAC HAN bang `teams`/
`team_type` dang dung cho KPI/seeding noi bo (xem docstring
crm_permission_service.py). Team CRM dat ten theo Leader, co thuoc tinh mo ta
(segment/khoi chuyen mon/nganh/khu vuc). Xem migration
155_crm_permission_groups_and_teams.sql."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.crm_permission_service import clear_crm_permission_enforcement_cache

_SAFE_TEAM_COLUMNS = (
    "id, name, code, leader_user_id, status, segment, function_area, industry, region, "
    "description, created_at, updated_at"
)
_MEMBER_USER_COLUMNS = "id, email, name, role, is_active, crm_status"


def _slugify_leader_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    words = re.findall(r"[A-Za-z0-9]+", normalized)
    return "".join(word[0] for word in words).upper() or "TM"


def suggest_team_code(leader_name: str) -> str:
    """Ma goi y ngan (vd Leader "Nguyen Minh Anh" -> "NMA") - chi la GOI Y,
    admin sua duoc tu do (cot `code` chi UNIQUE, khong CHECK format)."""
    return _slugify_leader_name(leader_name)


def list_teams(segment: str | None = None, function_area: str | None = None, search: str | None = None) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table("crm_teams").select(_SAFE_TEAM_COLUMNS)
    if segment:
        query = query.eq("segment", segment)
    if function_area:
        query = query.eq("function_area", function_area)
    if search:
        query = query.or_(f"name.ilike.%{search}%,code.ilike.%{search}%,industry.ilike.%{search}%")
    result = query.order("name").execute()
    teams = result.data or []

    leader_ids = list({t["leader_user_id"] for t in teams if t.get("leader_user_id")})
    leaders_by_id: dict[str, dict] = {}
    if leader_ids:
        leaders_res = (
            supabase.table("app_users").select("id, name, email").in_("id", leader_ids).execute()
        )
        leaders_by_id = {row["id"]: row for row in (leaders_res.data or [])}

    team_ids = [t["id"] for t in teams]
    member_counts: dict[str, int] = {}
    if team_ids:
        members_res = (
            supabase.table("crm_team_members").select("crm_team_id").in_("crm_team_id", team_ids).execute()
        )
        for row in members_res.data or []:
            tid = row.get("crm_team_id")
            if tid:
                member_counts[tid] = member_counts.get(tid, 0) + 1

    for team in teams:
        leader = leaders_by_id.get(team.get("leader_user_id") or "")
        team["leader_name"] = leader.get("name") or leader.get("email") if leader else None
        team["member_count"] = member_counts.get(team["id"], 0)
    return teams


def get_team_id_for_user(user_id: str) -> str | None:
    """Tra ve Team CRM hien tai cua 1 user (None neu chua thuoc Team nao) -
    dung cho drawer "Chinh quyen user" hien thi dung Team dang chon. Tai su
    dung DUNG ham cache da co trong crm_permission_service (dung cho
    enforcement) - tranh 2 nguon doc lech nhau."""
    from app.modules.all_platform.services.crm_permission_service import get_crm_team_id_for_user

    return get_crm_team_id_for_user(user_id)


def get_team(team_id: str) -> dict | None:
    supabase: Client = get_supabase_client()
    result = supabase.table("crm_teams").select(_SAFE_TEAM_COLUMNS).eq("id", team_id).limit(1).execute()
    if not result.data:
        return None
    team = result.data[0]

    if team.get("leader_user_id"):
        leader_res = (
            supabase.table("app_users").select("id, name, email").eq("id", team["leader_user_id"]).limit(1).execute()
        )
        team["leader_name"] = (leader_res.data[0].get("name") or leader_res.data[0].get("email")) if leader_res.data else None

    members_res = (
        supabase.table("crm_team_members").select("user_id").eq("crm_team_id", team_id).execute()
    )
    member_ids = [row["user_id"] for row in (members_res.data or []) if row.get("user_id")]
    team["members"] = []
    if member_ids:
        users_res = supabase.table("app_users").select(_MEMBER_USER_COLUMNS).in_("id", member_ids).execute()
        team["members"] = users_res.data or []
    return team


def create_team(payload: dict[str, Any]) -> dict:
    supabase: Client = get_supabase_client()

    name = (payload.get("name") or "").strip()
    leader_user_id = payload.get("leader_user_id") or None
    if not name:
        if not leader_user_id:
            raise ValueError("Cần chọn Leader hoặc nhập tên Team")
        leader_res = supabase.table("app_users").select("name, email").eq("id", leader_user_id).limit(1).execute()
        leader_name = (leader_res.data[0].get("name") or leader_res.data[0].get("email")) if leader_res.data else "?"
        name = f"Team {leader_name}"

    insert_data = {
        "name": name,
        "code": (payload.get("code") or "").strip() or None,
        "leader_user_id": leader_user_id,
        "status": payload.get("status") or "active",
        "segment": payload.get("segment") or None,
        "function_area": payload.get("function_area") or None,
        "industry": payload.get("industry") or None,
        "region": payload.get("region") or None,
        "description": payload.get("description") or None,
    }
    result = supabase.table("crm_teams").insert(insert_data).execute()
    return result.data[0] if result.data else {}


def update_team(team_id: str, payload: dict[str, Any]) -> dict:
    supabase: Client = get_supabase_client()
    update_data = {k: v for k, v in payload.items() if v is not None}
    if "name" in update_data:
        update_data["name"] = str(update_data["name"]).strip()
    if "code" in update_data:
        update_data["code"] = str(update_data["code"]).strip() or None
    update_data["updated_at"] = "now()"
    result = supabase.table("crm_teams").update(update_data).eq("id", team_id).execute()
    return result.data[0] if result.data else {}


def delete_team(team_id: str) -> dict:
    """Xoa 1 Team CRM - `crm_team_members` co ON DELETE CASCADE (migration
    155) nen member cua team se tu dong bi go lien ket (KHONG bi xoa tai
    khoan), chi mat gan Team CRM (ve trang thai chua co Team, giong logic
    permission_group_id o tren)."""
    supabase: Client = get_supabase_client()
    result = supabase.table("crm_teams").delete().eq("id", team_id).execute()
    clear_crm_permission_enforcement_cache()
    return {"deleted": len(result.data) if result.data else 0}


def add_team_member(team_id: str, user_id: str) -> dict:
    """1 user chi thuoc dung 1 Team CRM (UNIQUE user_id tren crm_team_members,
    migration 155) - go lien ket CU (neu co, kha nang o 1 team khac) truoc khi
    gan lien ket MOI, tranh vi pham UNIQUE constraint."""
    supabase: Client = get_supabase_client()
    supabase.table("crm_team_members").delete().eq("user_id", user_id).execute()
    result = supabase.table("crm_team_members").insert({"crm_team_id": team_id, "user_id": user_id}).execute()
    clear_crm_permission_enforcement_cache()
    return result.data[0] if result.data else {}


def remove_team_member(team_id: str, user_id: str) -> dict:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table("crm_team_members")
        .delete()
        .eq("crm_team_id", team_id)
        .eq("user_id", user_id)
        .execute()
    )
    clear_crm_permission_enforcement_cache()
    return {"deleted": len(result.data) if result.data else 0}
