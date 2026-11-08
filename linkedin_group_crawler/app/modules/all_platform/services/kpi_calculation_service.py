"""KPI Calculation Service: Tinh toan ket qua KPI tu lich su danh gia bai cao."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
# from app.core.supabase_client import get_supabase_client
try:
    from app.modules.all_platform.services import kpi_metric_service, kpi_session_service, kpi_template_service
    from app.modules.all_platform.services.kpi_metric_service import get_valid_metrics, get_valid_metric_codes
except ImportError:
    import kpi_metric_service, kpi_session_service, kpi_template_service
    from kpi_metric_service import get_valid_metrics, get_valid_metric_codes
VN_TZ = timezone(timedelta(hours=7))

def _vn_week_range_to_utc(start_date: str, end_date: str) -> Tuple[str, str]:
    """Chuyển khoảng ngày YYYY-MM-DD (giờ VN) sang khoảng ISO UTC để so sánh."""
    try:
        s = datetime.strptime(start_date, "%Y-%m-%d").date()
    except Exception:
        s = datetime.now(VN_TZ).date()
    try:
        e = datetime.strptime(end_date, "%Y-%m-%d").date()
    except Exception:
        e = datetime.now(VN_TZ).date()
    start_dt = datetime.combine(s, datetime.min.time(), tzinfo=VN_TZ).astimezone(timezone.utc).isoformat()
    end_dt = datetime.combine(e, datetime.max.time(), tzinfo=VN_TZ).astimezone(timezone.utc).isoformat()
    return start_dt, end_dt

logger = logging.getLogger(__name__)


def resolve_tier(
    actual_count: float,
    level_normal: float,
    level_high: float,
    level_critical: float,
) -> Optional[str]:
    """Xac dinh bac (tier) dat duoc dua tren so luong thuc te.
    
    Quy tac: Critical >= High >= Normal.
    Neu khong dat muc Normal nao (> 0) thi tra ve None.
    """
    if level_critical > 0 and actual_count >= level_critical:
        return "critical"
    if level_high > 0 and actual_count >= level_high:
        return "high"
    if level_normal > 0 and actual_count >= level_normal:
        return "normal"
    return None


def compute_manday(
    tier: Optional[str],
    manday_normal: float,
    manday_high: float,
    manday_critical: float,
    actual_count: float,
    bonus_rules: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, float]:
    """Tinh toan manday co ban va manday thuong theo quy tac tier va bonus rules."""
    base_manday = 0.0
    if tier == "critical":
        base_manday = float(manday_critical)
    elif tier == "high":
        base_manday = float(manday_high)
    elif tier == "normal":
        base_manday = float(manday_normal)

    bonus_manday = 0.0
    if bonus_rules:
        for rule in bonus_rules:
            min_count = float(rule.get("min_count") or 0)
            bonus_val = float(rule.get("bonus_manday") or 0)
            req_tier = rule.get("requires_tier") or "critical"

            # Kiem tra dieu kien nhan thuong
            tier_ok = True if not req_tier or req_tier == "any" else (tier == req_tier)
            if tier_ok and actual_count >= min_count:
                bonus_manday += bonus_val

    return {
        "base_manday": round(base_manday, 2),
        "bonus_manday": round(bonus_manday, 2),
        "total_manday": round(base_manday + bonus_manday, 2),
    }


def count_actuals_by_users(
    week_start: str,
    week_end: str,
    user_ids: List[str],
    metric_codes: List[str],
) -> Dict[str, Dict[str, int]]:
    """Dem so luong danh gia thuc te cua tung user cho cac chi so trong khoang thoi gian.
    
    LUAT BAT BUOC:
    - Chi dem post_evaluation_history co action_type = 'manual' (khong tinh batch_reject/undo).
    - User thuc hien danh gia la evaluated_by.
    - Thoi gian danh gia tinh theo created_at (quy doi theo timezone Viet Nam).
    """
    if not user_ids or not metric_codes:
        return {}

    start_utc, end_utc = _vn_week_range_to_utc(week_start, week_end)
    from app.core.supabase_client import get_supabase_client
    from app.core.supabase_client import get_supabase_client
    supabase = get_supabase_client()

    # Query lich su danh gia
    resp = (
        supabase.table("post_evaluation_history")
        .select("evaluated_by, evaluation_code")
        .eq("action_type", "manual")
        .in_("evaluated_by", user_ids)
        .in_("evaluation_code", metric_codes)
        .gte("created_at", start_utc)
        .lte("created_at", end_utc)
        .execute()
    )

    rows = resp.data or []
    # Khoi tao ket qua {user_id: {code: 0}}
    result: Dict[str, Dict[str, int]] = {uid: {code: 0 for code in metric_codes} for uid in user_ids}

    for r in rows:
        uid = r.get("evaluated_by")
        code = r.get("evaluation_code")
        if uid and code and uid in result and code in result[uid]:
            result[uid][code] += 1

    return result


def preview_session(session_id: str) -> Dict[str, Any]:
    """Tinh toan ket qua thuc te hien tai cua session cho tat ca thanh vien (chua chot snapshot)."""
    session = kpi_session_service.get_session_detail(session_id)
    if not session:
        raise ValueError("Khong tim thay session KPI")

    week_start = session["week_start"]
    week_end = session["week_end"]
    allocations = session.get("kpi_session_allocations") or []
    levels = session.get("kpi_session_levels") or []
    overrides = session.get("kpi_session_member_overrides") or []

    # Map levels: {metric_code: level_dict}
    level_map = {lvl["metric_code"]: lvl for lvl in levels}
    valid_codes = get_valid_metric_codes()

    # Map overrides: {(user_id, metric_code): level_critical_override}
    override_map = {(ovr["user_id"], ovr["metric_code"]): ovr.get("level_critical_override") for ovr in overrides}

    # Lay bonus rules tu template goc neu co
    source_template_id = session.get("source_template_id")
    bonus_rules_by_metric: Dict[str, List[Dict[str, Any]]] = {}
    if source_template_id:
        tpl = kpi_template_service.get_template(source_template_id)
        if tpl:
            for br in tpl.get("kpi_template_bonus_rules") or []:
                m_code = br["metric_code"]
                bonus_rules_by_metric.setdefault(m_code, []).append(br)

    user_ids = [a["user_id"] for a in allocations]
    actuals_by_user = count_actuals_by_users(week_start, week_end, user_ids, valid_codes)

    members_preview = []
    summary_by_metric: Dict[str, Dict[str, Any]] = {
        code: {"code": code, "total_actual": 0, "normal_count": 0, "high_count": 0, "critical_count": 0}
        for code in valid_codes
    }

    for alloc in allocations:
        uid = alloc["user_id"]
        weight_pct = float(alloc.get("weight_pct") or 0)
        # Factor dieu chinh theo ty trong: vd weight_pct = 100% -> factor = 1.0; 50% -> factor = 0.5
        weight_factor = weight_pct / 100.0 if weight_pct > 0 else 0.0

        user_info = alloc.get("app_users") or {}
        supporter = alloc.get("support_user") or {}

        member_metrics: Dict[str, Any] = {}
        total_member_base_manday = 0.0
        total_member_bonus_manday = 0.0

        for code in valid_codes:
            lvl = level_map.get(code)
            actual = actuals_by_user.get(uid, {}).get(code, 0)
            summary_by_metric[code]["total_actual"] += actual

            if not lvl:
                member_metrics[code] = {
                    "actual_count": actual,
                    "tier_reached": None,
                    "base_manday": 0,
                    "bonus_manday": 0,
                    "total_manday": 0,
                }
                continue

            # Tinh muc chi tieu da nhan theo ty trong
            # Neu co override rieng cho critical thi dung override
            raw_critical = override_map.get((uid, code))
            if raw_critical is not None and raw_critical > 0:
                eff_critical = float(raw_critical)
            else:
                eff_critical = round(float(lvl.get("level_critical") or 0) * weight_factor, 1)

            eff_normal = round(float(lvl.get("level_normal") or 0) * weight_factor, 1)
            eff_high = round(float(lvl.get("level_high") or 0) * weight_factor, 1)

            tier = resolve_tier(actual, eff_normal, eff_high, eff_critical)
            if tier == "critical":
                summary_by_metric[code]["critical_count"] += 1
            elif tier == "high":
                summary_by_metric[code]["high_count"] += 1
            elif tier == "normal":
                summary_by_metric[code]["normal_count"] += 1

            br_list = bonus_rules_by_metric.get(code, [])
            calc = compute_manday(
                tier=tier,
                manday_normal=float(lvl.get("manday_normal") or 0),
                manday_high=float(lvl.get("manday_high") or 0),
                manday_critical=float(lvl.get("manday_critical") or 0),
                actual_count=actual,
                bonus_rules=br_list,
            )

            total_member_base_manday += calc["base_manday"]
            total_member_bonus_manday += calc["bonus_manday"]

            member_metrics[code] = {
                "actual_count": actual,
                "level_normal": eff_normal,
                "level_high": eff_high,
                "level_critical": eff_critical,
                "effective_critical": eff_critical,
                "tier_reached": tier,
                "base_manday": calc["base_manday"],
                "bonus_manday": calc["bonus_manday"],
                "total_manday": calc["total_manday"],
            }

        members_preview.append({
            "user_id": uid,
            "user_name": user_info.get("name") or "",
            "user_email": user_info.get("email") or "",
            "weight": weight_pct,
            "weight_pct": weight_pct,
            "support_user_id": alloc.get("support_user_id"),
            "support_user_name": supporter.get("name") if supporter else None,
            "support_user_email": supporter.get("email") if supporter else None,
            "metrics": member_metrics,
            "total_base_manday": round(total_member_base_manday, 2),
            "total_bonus_manday": round(total_member_bonus_manday, 2),
            "total_manday": round(total_member_base_manday + total_member_bonus_manday, 2),
        })

    total_team_manday = round(sum(m["total_manday"] for m in members_preview), 2)

    return {
        "session_id": session_id,
        "team_id": session["crm_team_id"],
        "team_name": (session.get("crm_teams") or {}).get("name") or "",
        "week_start": week_start,
        "week_end": week_end,
        "status": session.get("status") or "draft",
        "metrics": get_valid_metrics(),
        "total_team_manday": total_team_manday,
        "members": members_preview,
        "summary_by_metric": summary_by_metric,
    }


def snapshot_session(session_id: str) -> List[Dict[str, Any]]:
    """Chot va luu snapshot ket qua cua ky KPI vao bang kpi_snapshots.
    
    Cap nhat trang thai session thanh 'completed'.
    """
    preview = preview_session(session_id)
    members = preview.get("members") or []
    valid_codes = get_valid_metric_codes()

    snapshot_rows = []
    for m in members:
        uid = m["user_id"]
        for code in valid_codes:
            met = m["metrics"].get(code) or {}
            snapshot_rows.append({
                "session_id": session_id,
                "user_id": uid,
                "metric_code": code,
                "actual_count": met.get("actual_count", 0),
                "tier_reached": met.get("tier_reached"),
                "base_manday": met.get("base_manday", 0.0),
                "bonus_manday": met.get("bonus_manday", 0.0),
                "snapshotted_at": "now()",
            })

    from app.core.supabase_client import get_supabase_client
    supabase = get_supabase_client()
    # Xoa snapshot cu neu co
    supabase.table("kpi_snapshots").delete().eq("session_id", session_id).execute()
    if snapshot_rows:
        supabase.table("kpi_snapshots").insert(snapshot_rows).execute()

    supabase.table("kpi_sessions").update({"status": "locked", "updated_at": "now()"}).eq("id", session_id).execute()
    return snapshot_rows

