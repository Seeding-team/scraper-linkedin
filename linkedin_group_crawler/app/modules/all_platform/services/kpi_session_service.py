"""KPI Session Service: Quan ly ky KPI tuan theo Team CRM va phan bo chi tieu."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import logging
from typing import Any, Dict, List, Optional
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.schemas.kpi_setup import (
    AllocationUpdateItem,
    ApplyTemplateRequest,
    OverrideUpdateItem,
    UpdateSessionSkillsRequest,
)
from app.modules.all_platform.services import kpi_template_service

logger = logging.getLogger(__name__)


def get_team_members(crm_team_id: str) -> List[Dict[str, Any]]:
    """Lay danh sach thanh vien truc thuoc Team CRM tu bang crm_team_members va app_users."""
    supabase = get_supabase_client()
    resp = (
        supabase.table("crm_team_members")
        .select("id, crm_team_id, user_id, app_users(id, name, email, role)")
        .eq("crm_team_id", crm_team_id)
        .execute()
    )
    members = []
    for row in resp.data or []:
        user_info = row.get("app_users") or {}
        members.append({
            "membership_id": row["id"],
            "user_id": row["user_id"],
            "name": user_info.get("name") or "",
            "email": user_info.get("email") or "",
            "role": user_info.get("role") or "member",
        })
    return members


def apply_template(payload: ApplyTemplateRequest, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Ap mau KPI chung vao 1 Team CRM cho 1 ky tuan cu the.
    
    1. Tao/cap nhat ban ghi trong kpi_sessions.
    2. Sao chep cac mốc chi tieu (levels) tu kpi_templates sang kpi_session_levels.
    3. Tu dong lay cac thanh vien tu crm_team_members de tao allocations chia deu ty trong.
    """
    supabase = get_supabase_client()
    tpl = kpi_template_service.get_template(payload.template_id)
    if not tpl:
        raise ValueError("Khong tim thay template KPI goc")

    # 1. Upsert session
    week_start = str(payload.week_start).strip()[:10]
    week_end = str(payload.week_end).strip()[:10] if payload.week_end else None
    if not week_end:
        try:
            ws_date = datetime.strptime(week_start, "%Y-%m-%d").date()
            week_end = (ws_date + timedelta(days=6)).isoformat()
        except Exception:
            week_end = week_start

    session_data: Dict[str, Any] = {
        "crm_team_id": payload.crm_team_id,
        "source_template_id": payload.template_id,
        "week_start": week_start,
        "week_end": week_end,
        "created_by": user_id,
        "updated_at": "now()",
    }
    if payload.skill_solution_id is not None:
        session_data["skill_solution_id"] = payload.skill_solution_id
    if payload.skill_vendor_id is not None:
        session_data["skill_vendor_id"] = payload.skill_vendor_id
    if payload.skill_solution_name is not None:
        session_data["skill_solution_name"] = payload.skill_solution_name
    if payload.skill_vendor_name is not None:
        session_data["skill_vendor_name"] = payload.skill_vendor_name

    # Kiem tra xem da co session cho team + week_start nay chua
    existing = (
        supabase.table("kpi_sessions")
        .select("id, status")
        .eq("crm_team_id", payload.crm_team_id)
        .eq("week_start", payload.week_start)
        .limit(1)
        .execute()
    )
    if existing.data:
        session_id = existing.data[0]["id"]
        supabase.table("kpi_sessions").update(session_data).eq("id", session_id).execute()
    else:
        session_data["status"] = "draft"
        ins = supabase.table("kpi_sessions").insert(session_data).execute()
        if not ins.data:
            raise ValueError("Khong the tao ky KPI session moi")
        session_id = ins.data[0]["id"]

    # 2. Sao chep levels tu template sang kpi_session_levels
    supabase.table("kpi_session_levels").delete().eq("session_id", session_id).execute()
    tpl_levels = tpl.get("kpi_template_levels") or []
    session_levels = []
    for lvl in tpl_levels:
        session_levels.append({
            "session_id": session_id,
            "metric_code": lvl["metric_code"],
            "level_normal": lvl["level_normal"],
            "level_high": lvl["level_high"],
            "level_critical": lvl["level_critical"],
            "manday_normal": lvl["manday_normal"],
            "manday_high": lvl["manday_high"],
            "manday_critical": lvl["manday_critical"],
        })
    if session_levels:
        supabase.table("kpi_session_levels").insert(session_levels).execute()

    # 3. Tao hoac dong bo allocations theo crm_team_members
    members = get_team_members(payload.crm_team_id)
    n = len(members)
    if n > 0:
        base_weight = round(100.0 / n, 2)
        # Lay cac allocations hien co de giu nguyen support_user_id neu da set
        curr_allocs_resp = (
            supabase.table("kpi_session_allocations")
            .select("user_id, weight_pct, support_user_id")
            .eq("session_id", session_id)
            .execute()
        )
        existing_map = {row["user_id"]: row for row in (curr_allocs_resp.data or [])}

        alloc_rows = []
        accum = 0.0
        for i, m in enumerate(members):
            uid = m["user_id"]
            if i == n - 1:
                w = round(100.0 - accum, 2)
            else:
                w = base_weight
                accum += w

            # Neu da co san thi giu nguyen ti trong va support_user_id
            if uid in existing_map:
                row_alloc = existing_map[uid]
                alloc_rows.append({
                    "session_id": session_id,
                    "user_id": uid,
                    "weight_pct": row_alloc.get("weight_pct", w),
                    "support_user_id": row_alloc.get("support_user_id"),
                })
            else:
                alloc_rows.append({
                    "session_id": session_id,
                    "user_id": uid,
                    "weight_pct": w,
                    "support_user_id": None,
                })

        # Xoa va chen lai danh sach allocations
        supabase.table("kpi_session_allocations").delete().eq("session_id", session_id).execute()
        supabase.table("kpi_session_allocations").insert(alloc_rows).execute()

    return get_session_detail(session_id) or {"id": session_id}


def list_sessions(crm_team_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Lay danh sach cac ky KPI session."""
    supabase = get_supabase_client()
    query = supabase.table("kpi_sessions").select(
        "id, crm_team_id, source_template_id, week_start, week_end, status, "
        "skill_solution_id, skill_vendor_id, skill_solution_name, skill_vendor_name, "
        "created_by, created_at, updated_at, "
        "crm_teams(id, name, code), "
        "kpi_templates(id, name)"
    )
    if crm_team_id:
        query = query.eq("crm_team_id", crm_team_id)
    
    resp = query.order("week_start", desc=True).limit(limit).execute()
    return resp.data or []


def get_session_detail(session_id: str) -> Optional[Dict[str, Any]]:
    """Lay chi tiet 1 session kem levels, allocations va overrides."""
    supabase = get_supabase_client()
    resp = (
        supabase.table("kpi_sessions")
        .select(
            "id, crm_team_id, source_template_id, week_start, week_end, status, "
            "skill_solution_id, skill_vendor_id, skill_solution_name, skill_vendor_name, "
            "created_by, created_at, updated_at, "
            "crm_teams(id, name, code), "
            "kpi_templates(id, name), "
            "kpi_session_levels(*), "
            "kpi_session_allocations(*, app_users!kpi_session_allocations_user_id_fkey(id, name, email)), "
            "kpi_session_member_overrides(*)"
        )
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    data = resp.data or []
    if not data:
        return None
    session = data[0]

    # Bo sung them thong tin support user name/email neu co
    allocs = session.get("kpi_session_allocations") or []
    supporter_ids = [a["support_user_id"] for a in allocs if a.get("support_user_id")]
    supporter_map = {}
    if supporter_ids:
        u_resp = supabase.table("app_users").select("id, name, email").in_("id", supporter_ids).execute()
        supporter_map = {u["id"]: u for u in (u_resp.data or [])}

    for a in allocs:
        sid = a.get("support_user_id")
        if sid and sid in supporter_map:
            a["support_user"] = supporter_map[sid]
        else:
            a["support_user"] = None

    return session


def update_allocations(session_id: str, allocations: List[AllocationUpdateItem]) -> List[Dict[str, Any]]:
    """Cap nhat ty trong phan bo va support_user cho cac thanh vien trong session."""
    supabase = get_supabase_client()
    rows = []
    for item in allocations:
        # Validate: supporter khong duoc trung voi assignee
        if item.support_user_id and item.support_user_id == item.user_id:
            raise ValueError("Người hỗ trợ (supporter) không được trùng với chính người được giao KPI")
        rows.append({
            "session_id": session_id,
            "user_id": item.user_id,
            "weight_pct": item.weight_pct,
            "support_user_id": item.support_user_id or None,
        })

    supabase.table("kpi_session_allocations").delete().eq("session_id", session_id).execute()
    if rows:
        resp = supabase.table("kpi_session_allocations").insert(rows).execute()
        return resp.data or []
    return []


def update_overrides(session_id: str, overrides: List[OverrideUpdateItem]) -> List[Dict[str, Any]]:
    """Cap nhat cac moc override rieng cho thanh vien trong session."""
    supabase = get_supabase_client()
    supabase.table("kpi_session_member_overrides").delete().eq("session_id", session_id).execute()
    rows = []
    for item in overrides:
        if item.level_critical_override is not None:
            rows.append({
                "session_id": session_id,
                "user_id": item.user_id,
                "metric_code": item.metric_code,
                "level_critical_override": item.level_critical_override,
            })
    if rows:
        resp = supabase.table("kpi_session_member_overrides").insert(rows).execute()
        return resp.data or []
    return []


def update_skills(session_id: str, payload: UpdateSessionSkillsRequest) -> Dict[str, Any]:
    """Luu cau hinh Skill Solution va Skill Vendor cho session."""
    supabase = get_supabase_client()
    update_data = {
        "skill_solution_id": payload.skill_solution_id,
        "skill_vendor_id": payload.skill_vendor_id,
        "skill_solution_name": payload.skill_solution_name,
        "skill_vendor_name": payload.skill_vendor_name,
        "updated_at": "now()",
    }
    supabase.table("kpi_sessions").update(update_data).eq("id", session_id).execute()
    return get_session_detail(session_id) or {"id": session_id}


def activate_session(session_id: str) -> Dict[str, Any]:
    """Kich hoat session tu draft sang active."""
    supabase = get_supabase_client()
    supabase.table("kpi_sessions").update({"status": "active", "updated_at": "now()"}).eq("id", session_id).execute()
    return get_session_detail(session_id) or {"id": session_id}

