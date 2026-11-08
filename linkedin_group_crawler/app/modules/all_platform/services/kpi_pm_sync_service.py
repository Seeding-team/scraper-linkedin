"""KPI PM Sync Service: Dong bo ket qua KPI sang he thong Plane.so (kpi.markeeai.com)."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional
import httpx

# from app.core.supabase_client import get_supabase_client
try:
    from app.modules.all_platform.services import kpi_calculation_service, kpi_session_service
except ImportError:
    import kpi_calculation_service, kpi_session_service

logger = logging.getLogger(__name__)

SOURCE_PREFIX = "seeding-kpi:"

# In-memory cache cho PM skills (TTL 10 phut)
_SKILLS_CACHE: Dict[str, Any] = {"expires_at": 0.0, "data": []}


def get_pm_base_url() -> str:
    return os.getenv("PM_BASE_URL", "").rstrip("/")


def get_pm_sync_token() -> str:
    return os.getenv("PM_SYNC_TOKEN", "").strip()


def get_pm_project_id() -> str:
    return os.getenv("PM_PROJECT_ID", "").strip()


def is_pm_configured() -> bool:
    """Kiem tra xem da cau hinh du bien ket noi PM chua."""
    url = get_pm_base_url()
    tok = get_pm_sync_token()
    pid = get_pm_project_id()
    return bool(url and tok and pid.isdigit())


def get_pm_skills() -> Dict[str, Any]:
    """Proxy lay danh sach Skill Solution va Skill Vendor tu PM Plane.so (kem cache 10 phut)."""
    now = time.monotonic()
    if _SKILLS_CACHE["data"] and _SKILLS_CACHE["expires_at"] > now:
        return {"success": True, "groups": _SKILLS_CACHE["data"], "data": _SKILLS_CACHE["data"]}

    if not is_pm_configured():
        return {
            "success": False,
            "message": "Chưa cấu hình kết nối PM (cần PM_BASE_URL, PM_SYNC_TOKEN, PM_PROJECT_ID)",
            "groups": [],
            "data": [],
        }

    url = f"{get_pm_base_url()}/api/msc-sync/skills"
    token = get_pm_sync_token()
    try:
        resp = httpx.get(
            url,
            headers={"X-MSC-Sync-Token": token},
            timeout=httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0),
        )
        if resp.status_code == 200:
            body = resp.json()
            groups = body.get("groups") or []
            _SKILLS_CACHE["data"] = groups
            _SKILLS_CACHE["expires_at"] = now + 600.0  # 10 minutes
            return {"success": True, "groups": groups, "data": groups}
        else:
            return {
                "success": False,
                "message": f"PM trả về lỗi HTTP {resp.status_code}",
                "groups": [],
                "data": [],
            }
    except Exception as e:
        logger.error(f"Loi khi goi PM skills: {e}")
        return {"success": False, "message": f"Không thể kết nối PM: {e}", "groups": [], "data": []}


def build_payload(
    session: Dict[str, Any],
    preview_data: Dict[str, Any],
    skill_solution_id: Optional[int] = None,
    skill_vendor_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Xay dung payload dong bo sang PM Plane.so theo dung contract msc_sync.
    
    Chi dua vao payload cac task co tier_reached khac None (da dat muc).
    """
    crm_team_id = session["crm_team_id"]
    session_id = session["id"]
    team_name = (session.get("crm_teams") or {}).get("name") or "Team Seeding"
    week_start = session["week_start"]

    group_key = f"{SOURCE_PREFIX}{crm_team_id}:{session_id}"
    group_name = f"Tuần {week_start} - {team_name}"

    # Lay skill tu session neu khong truyen
    eff_skill_solution_id = skill_solution_id or session.get("skill_solution_id")
    eff_skill_vendor_id = skill_vendor_id or session.get("skill_vendor_id")

    members = preview_data.get("members") or []
    tasks = []

    for m in members:
        user_id = m["user_id"]
        user_name = m.get("user_name") or "Thành viên"
        user_email = (m.get("user_email") or "").strip().lower()
        if not user_email:
            continue

        support_email = (m.get("support_user_email") or "").strip().lower()
        support_name = m.get("support_user_name") or "Người hỗ trợ"
        # Supporter khong duoc trung voi assignee
        has_supporter = bool(support_email and support_email != user_email)

        for code, met in (m.get("metrics") or {}).items():
            tier = met.get("tier_reached")
            if not tier:
                continue

            total_manday = met.get("total_manday") or met.get("base_manday") or 0.0
            if total_manday <= 0:
                continue

            task_key = f"{SOURCE_PREFIX}{crm_team_id}:{session_id}:{user_id}:{code}"
            priority = tier.capitalize()  # "Normal", "High", "Critical"

            task_item: Dict[str, Any] = {
                "externalKey": task_key,
                "title": f"[{code}] {user_name} - {priority}",
                "detail": f"[{code}] {user_name} - {priority}",
                "priority": priority,
                "status": "Done",
                "manday": float(total_manday),
                "startDate": week_start,
                "assignee": {
                    "email": user_email,
                    "name": user_name,
                },
                "assigneeEmail": user_email,
            }

            if has_supporter:
                task_item["support"] = {
                    "email": support_email,
                    "name": support_name,
                }
                task_item["supporterEmail"] = support_email
                task_item["supportEmail"] = support_email
                task_item["ratio"] = {"assign": 90, "support": 10}

            if eff_skill_solution_id:
                task_item["skillSolutionId"] = eff_skill_solution_id
                task_item["skillGroupId"] = eff_skill_solution_id
            if eff_skill_vendor_id:
                task_item["skillVendorId"] = eff_skill_vendor_id
                task_item["skillId"] = eff_skill_vendor_id

            tasks.append(task_item)

    return {
        "group": {
            "name": group_name,
            "externalKey": group_key,
        },
        "week": {
            "startDate": week_start,
        },
        "tasks": tasks,
    }


def persist_pm_sync_result(session_id: str, body: Dict[str, Any], status: str = "success") -> None:
    """Luu ket qua dong bo vao cac bang kpi_session_pm_tasks va kpi_session_pm_sync."""
    from app.core.supabase_client import get_supabase_client
    supabase = get_supabase_client()
    now_iso = "now()"

    # 1. Cap nhat kpi_session_pm_sync
    supabase.table("kpi_session_pm_sync").upsert({
        "session_id": session_id,
        "last_synced_at": now_iso,
        "last_sync_status": status,
    }).execute()

    # 2. Cap nhat kpi_session_pm_tasks
    returned_tasks = body.get("tasks") or []
    errors = body.get("errors") or []
    pm_group_id = (body.get("group") or {}).get("id")

    for t in returned_tasks:
        ext_key = t.get("externalKey")
        if not ext_key:
            continue
        # Parse externalKey: seeding-kpi:{team_id}:{session_id}:{user_id}:{metric_code}
        parts = ext_key.split(":")
        if len(parts) >= 5:
            user_id = parts[3]
            metric_code = parts[4]
            supabase.table("kpi_session_pm_tasks").upsert({
                "session_id": session_id,
                "user_id": user_id,
                "metric_code": metric_code,
                "external_key": ext_key,
                "pm_task_id": t.get("id"),
                "pm_task_code": t.get("code"),
                "pm_group_id": pm_group_id,
                "last_synced_at": now_iso,
                "last_error": None,
                "updated_at": now_iso,
            }).execute()

    for err in errors:
        ext_key = err.get("externalKey")
        if not ext_key:
            continue
        parts = ext_key.split(":")
        if len(parts) >= 5:
            user_id = parts[3]
            metric_code = parts[4]
            supabase.table("kpi_session_pm_tasks").upsert({
                "session_id": session_id,
                "user_id": user_id,
                "metric_code": metric_code,
                "external_key": ext_key,
                "pm_group_id": pm_group_id,
                "last_synced_at": now_iso,
                "last_error": err.get("message"),
                "updated_at": now_iso,
            }).execute()


def sync_session_to_pm(session_id: str, user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Dong bo ket qua cua 1 session KPI sang PM Plane.so."""
    if not is_pm_configured():
        return {
            "success": False,
            "message": "Chưa cấu hình kết nối PM (PM_BASE_URL, PM_SYNC_TOKEN, PM_PROJECT_ID)",
        }

    session = kpi_session_service.get_session_detail(session_id)
    if not session:
        return {"success": False, "message": "Không tìm thấy session KPI"}

    preview = kpi_calculation_service.preview_session(session_id)
    payload = build_payload(session, preview)

    if not payload["tasks"]:
        return {
            "success": True,
            "message": "Không có chỉ số nào đạt mức (Normal/High/Critical) để đẩy sang PM",
            "data": {"tasks": [], "group": None},
        }

    pm_base_url = get_pm_base_url()
    pm_project_id = get_pm_project_id()
    pm_token = get_pm_sync_token()

    url = f"{pm_base_url}/api/msc-sync/projects/{pm_project_id}/weekly-kpi"

    try:
        resp = httpx.post(
            url,
            json=payload,
            headers={"X-MSC-Sync-Token": pm_token},
            timeout=httpx.Timeout(connect=10.0, read=25.0, write=25.0, pool=10.0),
        )
    except httpx.TimeoutException:
        return {"success": False, "message": "PM không phản hồi (quá thời gian chờ 25s)"}
    except httpx.RequestError as e:
        return {"success": False, "message": f"Không kết nối được PM: {e}"}

    if resp.status_code in (401, 403):
        return {"success": False, "message": f"PM từ chối xác thực token (HTTP {resp.status_code})"}
    if resp.status_code >= 500:
        return {"success": False, "message": f"PM gặp lỗi máy chủ nội bộ (HTTP {resp.status_code})"}
    if resp.status_code != 200:
        return {"success": False, "message": f"PM trả về lỗi: {resp.text}"}

    body = resp.json()
    errors = body.get("errors") or []
    returned_tasks = body.get("tasks") or []

    if errors and not returned_tasks:
        first_err = errors[0].get("message") or "Lỗi từ PM"
        persist_pm_sync_result(session_id, body, status="failed")
        return {"success": False, "message": f"PM từ chối: {first_err}", "data": body}

    persist_pm_sync_result(session_id, body, status="success" if not errors else "partial")

    created_count = sum(1 for t in returned_tasks if t.get("action") == "created")
    updated_count = sum(1 for t in returned_tasks if t.get("action") == "updated")
    body["created_count"] = created_count
    body["updated_count"] = updated_count
    body["task_count"] = len(returned_tasks)
    body["project_id"] = str(pm_project_id)
    if (body.get("group") or {}).get("id"):
        body["group_url"] = f"{pm_base_url}/projects/{pm_project_id}"

    if errors:
        msg = f"Đồng bộ {len(returned_tasks)} task thành công, nhưng có {len(errors)} task bị lỗi: {errors[0].get('message')}"
    else:
        msg = f"Đồng bộ thành công {len(returned_tasks)} tasks sang PM"

    return {
        "success": True,
        "message": msg,
        "data": body,
    }

