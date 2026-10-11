"""Supabase-based KPI service for all-platform module."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from typing import Any, Dict, Iterable, List, Optional, Tuple

from loguru import logger
from supabase import Client

from app.core.supabase_client import execute_supabase_query, get_supabase_client


def _retry_supabase(func):
    """Re-run a read-only KPI query when the Supabase connection drops.

    These functions re-resolve the client via ``get_supabase_client()`` on entry,
    so replaying the whole body after ``reset_supabase_client()`` picks up a fresh
    connection. Only safe on reads — never decorate a function that writes.
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        return execute_supabase_query(lambda: func(*args, **kwargs))
    return wrapper

# Vietnam timezone (+07:00) — used consistently in all date comparisons
vn_tz = VN_TZ = timezone(timedelta(hours=7))

# So ngay 1 hoi thoai FB duoc "khoa" sau khi da tinh 1 diem KPI Inbox - trong
# khoang thoi gian nay, tin nhan moi tu cung khach hang (cung conv_id) se KHONG
# duoc tinh them diem, tranh spam qua lai cung 1 deal de bao KPI. Qua moc nay,
# khach nhan tin lai duoc xem la 1 luot cham soc moi -> cong them 1 diem KPI moi.
# Chinh sua duy nhat o day, khong hardcode rai rac noi khac.
INBOX_KPI_LOCK_DAYS = 30

# ─────────────────────────────────────────────────────────────────────────────
# In-memory TTL cache for team overview v2 (Phase 1 optimization)
# Pattern lấy cảm hứng từ admin_dashboard_service.py + auth_service.py
# ─────────────────────────────────────────────────────────────────────────────
_KPI_OVERVIEW_CACHE: Dict[str, Tuple[float, Any]] = {}
_KPI_OVERVIEW_CACHE_TTL_SECONDS = 30.0
_KPI_OVERVIEW_CACHE_LIMIT = 500


def _overview_cache_get(key: str) -> Optional[Any]:
    item = _KPI_OVERVIEW_CACHE.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at > time.monotonic():
        return value
    _KPI_OVERVIEW_CACHE.pop(key, None)
    return None


def _overview_cache_set(key: str, value: Any) -> Any:
    _KPI_OVERVIEW_CACHE[key] = (time.monotonic() + _KPI_OVERVIEW_CACHE_TTL_SECONDS, value)
    if len(_KPI_OVERVIEW_CACHE) > _KPI_OVERVIEW_CACHE_LIMIT:
        # Xóa các key cũ nhất khi vượt giới hạn
        for old_key in list(_KPI_OVERVIEW_CACHE.keys())[: -_KPI_OVERVIEW_CACHE_LIMIT]:
            _KPI_OVERVIEW_CACHE.pop(old_key, None)
    return value


def invalidate_overview_cache(leader_email: Optional[str] = None) -> None:
    """Xóa cache overview. Nếu leader_email được truyền, chỉ xóa cache liên quan.

    Gọi khi leader assign KPI mới, sync inbox, verify post, v.v.
    """
    if not leader_email:
        _KPI_OVERVIEW_CACHE.clear()
        return
    needle = leader_email.strip().lower()
    for key in list(_KPI_OVERVIEW_CACHE.keys()):
        if needle in key:
            _KPI_OVERVIEW_CACHE.pop(key, None)


def _rpc_cache_get(key: str) -> Optional[Any]:
    """Cache riêng cho kết quả RPC — TTL dài hơn (60s) vì RPC đã chạy aggregation phía DB."""
    item = _KPI_OVERVIEW_CACHE.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at > time.monotonic():
        return value
    return None


def _normalize_rpc_response(payload: Any) -> dict:
    """Chuẩn hóa JSON từ RPC `get_team_kpi_overview` về schema giống get_all_kpis_for_leader.

    Schema backend cũ (FE đang dùng):
      {
        "total": int,
        "members": [{
          "id", "email", "name", "role", "profile_slug", "email_leader",
          "kpi": [{...kpi_tracker row...}],
          "seeding_stats": {
            "verified_count", "kpi_target", "kpi_post", "kpi_post_current",
            "kpi_lead", "kpi_lead_current", "kpi_inbox", "kpi_inbox_current",
            "kpi_inbox_zalo", "kpi_inbox_fb_seeder", "kpi_inbox_fb_kpi",
            "kpi_inbox_range": {"start", "end"}
          },
          "seeding_items": [...],
          "profile_id", "facebook_name"
        }]
      }
    """
    if not isinstance(payload, dict):
        return {"total": 0, "members": []}

    raw_members = payload.get("members") or []
    if not isinstance(raw_members, list):
        return {"total": 0, "members": []}

    rng = payload.get("range") or {}
    eff_start = rng.get("start") or ""
    eff_end = rng.get("end") or ""

    out_members: List[Dict[str, Any]] = []
    for m in raw_members:
        if not isinstance(m, dict):
            continue
        kpi_obj = m.get("kpi") or {}
        actuals = m.get("actuals") or {}
        comment_n = int(actuals.get("comment") or 0)
        post_n = int(actuals.get("post") or 0)
        inbox_zalo = int(actuals.get("inbox_zalo") or 0)
        lead_zalo = int(actuals.get("lead_zalo") or 0)
        inbox_fb = int(actuals.get("inbox_fb_kpi") or 0)
        lead_fb = int(actuals.get("lead_fb_kpi") or 0)
        inbox_seeder_note = 0  # RPC không đếm được; FE đã có seeder call riêng nếu cần

        total_inbox = inbox_zalo + inbox_seeder_note + inbox_fb
        total_lead = lead_zalo + lead_fb

        out_members.append({
            "id": str(m.get("id", "")),
            "email": str(m.get("email", "")).lower(),
            "name": m.get("name"),
            "role": m.get("role") or "member",
            "profile_slug": m.get("profile_slug"),
            "email_leader": None,  # RPC không trả về, FE tự fill
            "kpi": [{
                "kpi_post": int(kpi_obj.get("kpi_post") or 0),
                "kpi_lead": int(kpi_obj.get("kpi_lead") or 0),
                "kpi_inbox": int(kpi_obj.get("kpi_inbox") or 0),
                "kpi_comment": int(kpi_obj.get("kpi_comment") or 0),
                "start_date": kpi_obj.get("start_date"),
                "end_date": kpi_obj.get("end_date"),
            }] if kpi_obj else [],
            "seeding_stats": {
                "verified_count": comment_n,
                "kpi_target": int(kpi_obj.get("kpi_comment") or 0),
                "kpi_post": int(kpi_obj.get("kpi_post") or 0),
                "kpi_post_current": post_n,
                "kpi_lead": int(kpi_obj.get("kpi_lead") or 0),
                "kpi_lead_current": total_lead,
                "kpi_inbox": int(kpi_obj.get("kpi_inbox") or 0),
                "kpi_inbox_current": total_inbox,
                "kpi_inbox_zalo": inbox_zalo,
                "kpi_inbox_fb_seeder": inbox_seeder_note,
                "kpi_inbox_fb_kpi": inbox_fb,
                "kpi_inbox_range": {"start": eff_start, "end": eff_end},
            },
            "seeding_items": [],  # RPC không trả về list chi tiết; FE leader-inbox view sẽ gọi modal riêng
            "profile_id": m.get("profile_id"),
            "facebook_name": m.get("facebook_name"),
        })

    return {"total": len(out_members), "members": out_members}


@_retry_supabase
def get_team_kpi_overview_v2_rpc(
    *,
    leader_email: Optional[str],
    id_team: Optional[str],
    start_date: str,
    end_date: str,
) -> dict:
    """Phase 2 — gọi RPC `get_team_kpi_overview` của Supabase.

    Nếu RPC chưa được deploy (VD: chưa chạy migration 012), tự fallback
    sang `get_team_kpi_overview_v2` (Phase 1 batch queries).
    """
    cache_key = f"rpc|{(leader_email or '').strip().lower()}|{id_team or ''}|{start_date}|{end_date}"
    cached = _rpc_cache_get(cache_key)
    if cached is not None:
        return cached

    supabase: Client = get_supabase_client()

    try:
        rpc_params = {
            "p_leader_email": (leader_email or "").strip().lower() or None,
            "p_id_team": (id_team or "").strip() or None,
            "p_start": start_date.strip() or None,
            "p_end": end_date.strip() or None,
        }
        rpc_res = supabase.rpc("get_team_kpi_overview", rpc_params).execute()
        if rpc_res.data:
            normalized = _normalize_rpc_response(rpc_res.data)
            return _overview_cache_set(cache_key, normalized)
        # data rỗng → fallback
        logger.debug("RPC returned empty data, falling back to v2 batch")
    except Exception as exc:
        logger.warning(f"get_team_kpi_overview_v2_rpc failed ({exc}), falling back to v2 batch")

    return get_team_kpi_overview_v2(
        leader_email=leader_email,
        id_team=id_team,
        start_date=start_date,
        end_date=end_date,
    )


def assign_kpi(payload: dict) -> dict:
    """Assign KPI to a member — upsert into kpi_tracker.

    Upsert rules:
    - Unique key: (id_member, id_team, start_date, end_date) with status='active'.
    - If start_date or end_date is missing, use current VN week boundaries.
    - If a record already exists for that exact week+team, UPDATE it.
    - Otherwise INSERT a new record.
    """
    from app.modules.all_platform.schemas.kpi import AssignKpiRequest

    # Use Pydantic to normalise the payload and extract validated fields
    validated: AssignKpiRequest = AssignKpiRequest.model_validate(payload)

    supabase: Client = get_supabase_client()

    # ── Resolve emails ────────────────────────────────────────────────────────
    member_res = supabase.table("app_users").select("id").eq("email", validated.email.lower().strip()).execute()
    if not member_res.data:
        raise ValueError(f"Không tìm thấy user với email: {validated.email}")
    id_member: str = member_res.data[0]["id"]

    leader_res = supabase.table("app_users").select("id").eq("email", validated.email_leader.lower().strip()).execute()
    if not leader_res.data:
        raise ValueError(f"Không tìm thấy leader với email: {validated.email_leader}")
    id_leader: str = leader_res.data[0]["id"]

    id_team = validated.id_team
    if id_team == "":
        id_team = None

    # ── Determine week boundaries ─────────────────────────────────────────────
    # Always use the latest KPI item in the payload
    kpi_items = validated.kpi
    if not kpi_items:
        raise ValueError("KPI payload phải có ít nhất 1 mục trong mảng 'kpi'")

    latest = kpi_items[-1]

    # Normalise start/end dates: if missing, default to current VN week Mon–Sun
    if latest.start_day and latest.end_day:
        start_date = str(latest.start_day).strip()[:10]
        end_date = str(latest.end_day).strip()[:10]
    else:
        today_vn = date.today()
        monday = today_vn - timedelta(days=today_vn.weekday())
        sunday = monday + timedelta(days=6)
        start_date = monday.isoformat()
        end_date = sunday.isoformat()

    upsert_data = {
        "id_member": id_member,
        "id_leader": id_leader,
        "id_platform": 1,  # all-platform
        "id_team": id_team,
        "kpi_comment": latest.kpi_comment,
        "kpi_post": latest.kpi_post,
        "kpi_lead": latest.kpi_lead,
        "kpi_inbox": latest.kpi_inbox,
        "start_date": start_date,
        "end_date": end_date,
        "status": "active",
        "is_failed": latest.is_failed,
        "reason_not_met": (
        latest.reason_not_met if latest.is_failed else None),
    }

    # ── Check for existing record (unique key: member + team + week) ───────────
    query = (
        supabase.table("kpi_tracker")
        .select("id")
        .eq("id_member", id_member)
        .eq("status", "active")
        .eq("start_date", start_date)
        .eq("end_date", end_date)
    )
    if id_team:
        query = query.eq("id_team", id_team)
    else:
        query = query.is_("id_team", "null")

    existing = query.execute()

    if existing.data:
        # UPDATE existing record
        kpi_id = existing.data[0]["id"]
        result = (
            supabase.table("kpi_tracker")
            .update(upsert_data)
            .eq("id", kpi_id)
            .execute()
        )
        logger.info(f"assign_kpi: updated kpi_id={kpi_id} for member={id_member}, week={start_date}..{end_date}")
    else:
        # INSERT new record
        result = (
            supabase.table("kpi_tracker")
            .insert(upsert_data)
            .execute()
        )
        logger.info(f"assign_kpi: inserted new KPI for member={id_member}, week={start_date}..{end_date}")

    if not result.data:
        raise RuntimeError("Không thể lưu KPI vào database")

    # Phase 1: invalidate cache v2 khi KPI thay đổi
    try:
        invalidate_overview_cache(validated.email_leader)
    except Exception:
        pass

    return result.data[0]


def get_all_kpis_for_leader(
    leader_email: str,
    id_team: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict:
    """Get all KPIs for a leader's team with weekly actual counts."""
    supabase: Client = get_supabase_client()

    # Get leader ID
    leader_res = supabase.table("app_users").select("id").eq("email", leader_email).execute()
    if not leader_res.data:
        return {"total": 0, "members": []}
    leader_id = leader_res.data[0]["id"]

    # Get all members of this leader from member_of_teams
    if id_team:
        members_result = (
            supabase.table("member_of_teams")
            .select("id_member")
            .eq("id_teams", id_team)
            .execute()
        )
    else:
        # Fallback: get all member IDs of all teams led by this leader
        teams_result = (
            supabase.table("teams")
            .select("id")
            .eq("id_leader", leader_id)
            .execute()
        )
        team_ids = [t["id"] for t in (teams_result.data or [])]
        if not team_ids:
            return {"total": 0, "members": []}
        members_result = (
            supabase.table("member_of_teams")
            .select("id_member")
            .in_("id_teams", team_ids)
            .execute()
        )
        
    member_ids = [r["id_member"] for r in (members_result.data or []) if r.get("id_member")]

    # 2026-07-04: them chinh leader vao danh sach tinh KPI - truoc day
    # member_ids CHI lay tu member_of_teams (thanh vien thuong), KPI cua
    # leader "mat tich" khoi modal "Xem TV" (Teams-management). Them
    # leader_id vao day de toan bo pipeline tinh actual ben duoi (seeding,
    # zalo inbox, fb inbox/post) tu dong ap dung luon cho leader, khong can
    # viet lai logic. Dung leader_id_set de kiem tra is_leader khi build
    # members_data ben duoi.
    leader_id_str = str(leader_id)
    if leader_id_str not in {str(m) for m in member_ids}:
        member_ids = [*member_ids, leader_id]

    if not member_ids:
        return {"total": 0, "members": []}

    # Get user info
    user_result = (
        supabase.table("app_users")
        .select("*")
        .in_("id", member_ids)
        .execute()
    )
    user_map = {str(u["id"]): u for u in (user_result.data or [])}

    # Calculate default weekly range (current week: Monday to Sunday) in VN timezone
    from datetime import datetime, timedelta
    today = datetime.now(VN_TZ).date()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    default_start = start_date or monday.isoformat()
    default_end = end_date or sunday.isoformat()

    # Get KPI for each member
    kpi_query = (
        supabase.table("kpi_tracker")
        .select("*")
        .in_("id_member", member_ids)
        .eq("status", "active")
    )
    if id_team:
        kpi_query = kpi_query.eq("id_team", id_team)
    if start_date and end_date:
        # Range overlap (khong phai exact-match) - giong logic RPC get_team_kpi_overview
        # (kt2.start_date <= v_end AND kt2.end_date >= v_start). Exact-match truoc day de
        # target ve 0 khi tuan do FE tu tinh (getRecentWeeks(), theo gio local trinh duyet)
        # lech 1 ngay so voi tuan luu trong kpi_tracker, du actual van hien dung vi actual
        # tinh rieng theo range date, khong phu thuoc active_kpi co tim thay hay khong.
        kpi_query = kpi_query.lte("start_date", end_date).gte("end_date", start_date)

    kpi_query = kpi_query.order("start_date", desc=False)
    kpi_result = kpi_query.execute()
    kpi_map = {}
    for k in (kpi_result.data or []):
        # We might have multiple active ones if start/end date were not provided, 
        # so keeping the latest one is a reasonable fallback. But we prefer exact match.
        kpi_map[str(k["id_member"])] = k

    # Find minimum start date to fetch records efficiently
    min_start_date = default_start
    for k in kpi_map.values():
        eff_start = start_date or k.get("start_date") or default_start
        if eff_start and eff_start < min_start_date:
            min_start_date = eff_start

    # Get seeding content for members (Comments) with server-side date filtering.
    # We query from the earliest KPI start date to the latest end date needed,
    # then filter per-member in Python for precision. This avoids loading
    # the entire seeding_history table while ensuring date correctness.
    seeding_result = (
        supabase.table("seeding_content_kpi")
        .select("id_member, verify, current_day, content, link_comment, id_social_account, social_accounts(account_name)")
        .in_("id_member", member_ids)
        .gte("current_day", min_start_date)
        .lte("current_day", default_end)
        .execute()
    )
    seeding_list = seeding_result.data or []

    verified_keywords = ("yes", "đã seeding", "xác minh", "verified")

    # CRM lead count từ customer_leads — cùng công thức với get_team_kpi_overview_v2.
    # Thiếu term này thì lead_actual của endpoint legacy luôn nhỏ hơn v2/v3.
    legacy_start_utc, legacy_end_utc = _vn_week_range_to_utc(default_start, default_end)
    crm_lead_count: Dict[str, int] = {str(m): 0 for m in member_ids}
    try:
        crm_lead_res = (
            supabase.table("customer_leads")
            .select("leaded_by, created_at")
            .in_("leaded_by", member_ids)
            .not_.is_("leaded_by", "null")
            .gte("created_at", legacy_start_utc)
            .lte("created_at", legacy_end_utc)
            .execute()
        )
        for r in (crm_lead_res.data or []):
            _mid = str(r.get("leaded_by"))
            if _mid in crm_lead_count:
                crm_lead_count[_mid] += 1
    except Exception as exc:
        logger.warning(f"customer_leads lead-count (legacy get_all) failed: {exc}")

    members_data = []
    for mid in set(str(m) for m in member_ids):
        user = user_map.get(mid)
        if not user:
            continue

        active_kpi = kpi_map.get(mid, {})
        eff_start_date = start_date or active_kpi.get("start_date") or default_start
        eff_end_date = end_date or active_kpi.get("end_date") or default_end
        member_email = user.get("email", "").lower()

        # Calculate actual Comments within active week (using member's KPI date range)
        member_comments = [
            s for s in seeding_list
            if str(s.get("id_member")) == mid
            and s.get("current_day")
            and eff_start_date <= s["current_day"] <= eff_end_date
        ]
        # Chỉ đếm comment ĐÃ VERIFY — giống get_team_kpi_overview_v2 và view
        # v_member_daily_seeding. Trước đây hàm này đếm mọi dòng bất kể `verify`
        # nên cùng team/tuần lại ra số comment khác endpoint v2/v3.
        comment_current = sum(
            1 for s in member_comments
            if str(s.get("verify", "")).strip().lower() in verified_keywords
        )

        # Set Posts to 0 as requested
        post_current = 0

        # Zalo inbox: số tin nhắn khách gửi tới trong tuần KPI.
        try:
            inbox_progress = compute_kpi_inbox_progress([mid], eff_start_date, eff_end_date)
            inbox_current = int(inbox_progress.get(mid, {}).get("kpi_inbox_current", 0))
            lead_current = int(inbox_progress.get(mid, {}).get("kpi_lead_current", 0))
        except Exception as exc:
            logger.warning(f"compute_kpi_inbox_progress failed for member={mid}: {exc}")
            inbox_current = 0
            lead_current = 0

        # Facebook Messenger inbox: dùng date range của member (KHÔNG phải default)
        fb_inbox_from_seeder = 0
        fb_inbox_from_kpi = 0
        fb_lead_from_kpi = 0
        if member_email:
            try:
                fb_progress = _compute_fb_inbox_progress([mid], eff_start_date, eff_end_date)
                fb_inbox_from_seeder = int(fb_progress.get(mid, {}).get("kpi_fb_inbox_count", 0))
            except Exception as exc:
                logger.warning(f"_compute_fb_inbox_progress failed for member={mid}: {exc}")

            try:
                fb_kpi_summary = get_fb_inbox_kpi_summary(member_email, eff_start_date, eff_end_date)
                fb_inbox_from_kpi = int(fb_kpi_summary.get("inbox_count", 0))
                fb_lead_from_kpi = int(fb_kpi_summary.get("lead_count", 0))
            except Exception as exc:
                logger.warning(f"get_fb_inbox_kpi_summary failed for member={mid}: {exc}")

        # Facebook Post KPI: đếm số bài viết đã đăng từ fb_post_kpi
        fb_post_count = 0
        try:
            from app.modules.all_platform.services.fb_post_kpi_service import get_fb_post_kpi_summary
            fb_post_summary = get_fb_post_kpi_summary(member_email, eff_start_date, eff_end_date)
            fb_post_count = int(fb_post_summary.get("post_count", 0))
        except Exception as exc:
            logger.warning(f"get_fb_post_kpi_summary failed for member={mid}: {exc}")

        # Tổng inbox = SỐ HỘI THOẠI: Zalo đã verify + FB đã tính KPI.
        # `fb_inbox_from_seeder` là SỐ TIN NHẮN khách gửi (khác đơn vị) -> chỉ
        # hiển thị tham khảo ở `kpi_inbox_fb_seeder`, không cộng vào tổng.
        total_inbox_current = inbox_current + fb_inbox_from_kpi

        members_data.append({
            "id": mid,
            "email": member_email,
            "name": user.get("name"),
            "role": user.get("role", "member"),
            "is_leader": mid == leader_id_str,
            "profile_slug": user.get("slug"),
            "email_leader": leader_email,
            "kpi": [active_kpi] if active_kpi else [],
            "seeding_stats": {
                "verified_count": comment_current,
                "kpi_target": active_kpi.get("kpi_comment", 0),
                "kpi_post": active_kpi.get("kpi_post", 0),
                "kpi_post_current": fb_post_count,  # FB Post KPI từ fb_post_kpi
                "kpi_lead": active_kpi.get("kpi_lead", 0),
                "kpi_lead_current": lead_current + fb_lead_from_kpi + int(crm_lead_count.get(mid, 0)),
                "kpi_inbox": active_kpi.get("kpi_inbox", 0),
                "kpi_inbox_current": total_inbox_current,
                "kpi_inbox_zalo": inbox_current,
                "kpi_inbox_fb_seeder": fb_inbox_from_seeder,
                "kpi_inbox_fb_kpi": fb_inbox_from_kpi,
                "kpi_inbox_range": {
                    "start": eff_start_date,
                    "end": eff_end_date,
                },
            },
            "seeding_items": member_comments,
            "profile_id": user.get("profile_id"),
            "facebook_name": user.get("facebook_name"),
        })

    return {"total": len(members_data), "members": members_data}


@_retry_supabase
def get_kpi_by_email(email: str) -> dict:
    """Get KPI for a specific member."""
    supabase: Client = get_supabase_client()

    # Get user info
    user_result = (
        supabase.table("app_users")
        .select("*")
        .eq("email", email)
        .execute()
    )
    if not user_result.data:
        return {}
    user = user_result.data[0]
    user_id = user["id"]

    # Determine current week in VN timezone
    from datetime import datetime, timedelta
    today = datetime.now(VN_TZ).date()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    current_monday = monday.isoformat()
    current_sunday = sunday.isoformat()

    result = (
        supabase.table("kpi_tracker")
        .select("*")
        .eq("id_member", user_id)
        .eq("status", "active")
        .eq("start_date", current_monday)
        .eq("end_date", current_sunday)
        .order("start_date", desc=True)
        .execute()
    )
    
    # Fallback to latest KPI if no exact match for current week
    carried_over_from: Optional[Dict[str, Any]] = None
    if not result.data:
        result = (
            supabase.table("kpi_tracker")
            .select("*")
            .eq("id_member", user_id)
            .eq("status", "active")
            .order("start_date", desc=True)
            .limit(1)
            .execute()
        )
        # Virtual carry-over: keep targets from old KPI, but update dates to current week
        # so the progress is correctly calculated for the new week (reset to 0).
        # Ghi lại nguồn gốc: nếu không, UI hiển thị thanh tiến độ chạy trên chỉ
        # tiêu của TUẦN CŨ mà không ai biết tuần này leader chưa giao KPI.
        if result.data:
            carried_over_from = {
                "start": result.data[0].get("start_date"),
                "end": result.data[0].get("end_date"),
            }
            result.data[0]["start_date"] = current_monday
            result.data[0]["end_date"] = current_sunday

    if result.data:
        kpi = result.data[0]
        # Fetch leader email for compatibility
        leader_res = supabase.table("app_users").select("email").eq("id", kpi.get("id_leader")).execute()
        leader_email = leader_res.data[0]["email"] if leader_res.data else None

        # Tính kpi_inbox_current trong khoảng KPI hiện tại
        kpi_inbox_target = int(kpi.get("kpi_inbox") or 0)
        kpi_inbox_current = 0
        kpi_inbox_zalo = 0
        kpi_inbox_fb = 0
        if kpi_inbox_target > 0:
            try:
                progress = compute_kpi_inbox_progress(
                    [str(user_id)],
                    kpi.get("start_date"),
                    kpi.get("end_date"),
                )
                kpi_inbox_zalo = int(progress.get(str(user_id), {}).get("kpi_inbox_current", 0))
            except Exception as exc:
                logger.warning(f"compute_kpi_inbox_progress failed for email={email}: {exc}")

        # FB Messenger inbox từ seeder service — owner trên seeder LÀ user_id (UUID),
        # không phải email (xem chú thích ở _compute_fb_inbox_progress).
        member_email_lower = email.strip().lower()
        kpi_inbox_fb_seeder = 0
        kpi_inbox_fb_kpi = 0
        try:
            fb_progress = _compute_fb_inbox_progress(
                [str(user_id)],
                kpi.get("start_date"),
                kpi.get("end_date"),
            )
            kpi_inbox_fb_seeder = int(fb_progress.get(str(user_id), {}).get("kpi_fb_inbox_count", 0))
        except Exception as exc:
            logger.warning(f"_compute_fb_inbox_progress failed for email={email}: {exc}")

        # FB inbox KPI từ Supabase fb_inbox_kpi table (manually counted via "Tính Inbox")
        try:
            fb_kpi_summary = get_fb_inbox_kpi_summary(
                member_email_lower,
                kpi.get("start_date"),
                kpi.get("end_date"),
            )
            kpi_inbox_fb_kpi = int(fb_kpi_summary.get("inbox_count", 0))
        except Exception as exc:
            logger.warning(f"get_fb_inbox_kpi_summary failed for email={email}: {exc}")

        # Xem chú thích ở get_team_kpi_overview_v2: kpi_inbox_fb_seeder là số TIN
        # NHẮN, không phải số hội thoại -> không cộng vào KPI Inbox.
        kpi_inbox_current = kpi_inbox_zalo + kpi_inbox_fb_kpi

        return {
            "email": email,
            "name": user.get("name"),
            "role": user.get("role", "member"),
            "profile_slug": user.get("slug"),
            "email_leader": leader_email,
            "kpi": [kpi],
            "kpi_inbox_current": kpi_inbox_current,
            "kpi_inbox_zalo": kpi_inbox_zalo,
            "kpi_inbox_fb_seeder": kpi_inbox_fb_seeder,
            "kpi_inbox_fb_kpi": kpi_inbox_fb_kpi,
            "kpi_inbox_target": kpi_inbox_target,
            # True = tuần này leader CHƯA giao KPI, đang mượn chỉ tiêu tuần cũ.
            "not_assigned": carried_over_from is not None,
            "carried_over_from": carried_over_from,
            "profile_id": user.get("profile_id"),
            "facebook_name": user.get("facebook_name"),
        }
    return {}


def sync_kpi_progress(email: str, posts: list[dict]) -> dict:
    """Sync engagement progress from posts into linkedin_posts table."""
    supabase: Client = get_supabase_client()

    updated = 0
    for post in posts:
        post_url = post.get("post_url")
        if not post_url:
            continue
        update_data = {}
        if "reactions" in post:
            update_data["likes"] = post["reactions"]
        elif "likes" in post:
            update_data["likes"] = post["likes"]
        if "comments" in post:
            update_data["comments"] = post["comments"]
        if "shares" in post:
            update_data["shares"] = post["shares"]

        if update_data:
            user_res = supabase.table("app_users").select("id").eq("email", email.strip().lower()).limit(1).execute()
            user_id = user_res.data[0]["id"] if user_res.data else None
            
            if user_id:
                result = (
                    supabase.table("linkedin_posts")
                    .update(update_data)
                    .eq("post_url", post_url)
                    .eq("id_member", user_id)
                    .execute()
                )
                updated += len(result.data) if result.data else 0

    return {"updated": updated}


def check_permission(email: str) -> dict:
    """Check if user is leader or member."""
    supabase: Client = get_supabase_client()

    result = (
        supabase.table("app_users")
        .select("role, email_leader, name")
        .eq("email", email)
        .execute()
    )

    if result.data:
        user = result.data[0]
        return {
            "role": user.get("role", "member"),
            "email_leader": user.get("email_leader"),
            "name": user.get("name"),
        }

    return {"role": "member", "email_leader": None, "name": None}


def verify_leader_code(code: str) -> dict:
    """Verify leader authorization code."""
    from app.core.config import settings

    if code == settings.leader_code:
        return {"valid": True}
    return {"valid": False}


def update_user_role_to_member(email: str) -> dict:
    """Update user role to member."""
    supabase: Client = get_supabase_client()

    result = (
        supabase.table("app_users")
        .update({"role": "member", "updated_at": "now()"})
        .eq("email", email)
        .execute()
    )
    return result.data[0] if result.data else {}


# ─────────────────────────────────────────────────────────────────────────────
# Zalo inbox KPI
# ─────────────────────────────────────────────────────────────────────────────
#
# "Tin nhắn KPI" = số tin nhắn KHÁCH gửi tới (is_sent = false) trong khoảng
# start_date -> end_date trên tất cả Zalo account thuộc sở hữu của member.
#
# Quy ước schema:
#   - zalo_accounts.owner_id      -> app_users.id (member)
#   - zalo_messages.user_id       -> zalo_accounts.account_id
#   - zalo_messages.is_sent=false -> tin nhắn nhận từ khách
#
# Hàm này trả về số liệu actual để hiển thị progress bar; nó KHÔNG ghi vào
# kpi_tracker (giữ bảng này immutable cho target do leader giao).
# ─────────────────────────────────────────────────────────────────────────────


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    """Parse YYYY-MM-DD[ T...] -> date. Trả None nếu không phân tích được."""
    if not value:
        return None
    raw = str(value).strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw[: len(fmt) + 30] if "%z" in fmt else raw, fmt).date()
        except ValueError:
            continue
    # Fallback: lấy 10 ký tự đầu
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Facebook Inbox from seeder service
# ─────────────────────────────────────────────────────────────────────────────
#
# Seeder service lưu tin nhắn khách (from='them') vào data/inbox_messages/{owner}/{yyyy-MM-dd}.json.
# Hàm này gọi GET /inbox/messages/count của seeder để đếm tin theo owner + khoảng ngày KPI.
#
# QUAN TRỌNG: `owner` trên seeder LÀ member UUID (app_users.id), KHÔNG PHẢI email.
# Extension gửi cookie kèm `owner: user.id` khi provision (markee-ext-provision.ts:119),
# và mọi endpoint khác trên seeder (/inbox/conversations?owner=, /extensions?owner=...)
# đều so khớp bằng UUID này. Bản đầu tiên của hàm này gọi `?owner={email}` — so sánh
# email với UUID không bao giờ khớp -> "Khách reply" luôn = 0 dù seeder đã có dữ liệu.
# ─────────────────────────────────────────────────────────────────────────────

def _compute_fb_inbox_progress(
    member_ids: Iterable[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """Gọi seeder service để đếm tin nhắn khách (FB Messenger) của từng member trong tuần KPI.

    Args:
        member_ids: danh sách UUID (app_users.id) của các member cần đếm — PHẢI khớp
            với `owner` mà extension gửi khi provision cookie, không phải email.
        start_date: ISO date (YYYY-MM-DD). Mặc định = Monday tuần hiện tại.
        end_date: ISO date. Mặc định = Sunday tuần hiện tại.

    Returns:
        Dict map ``member_id -> {kpi_fb_inbox_count, range: {start, end}}``.
    """
    from app.core.config import settings

    if start_date is None or end_date is None:
        today_d = datetime.now(VN_TZ).date()
        monday = today_d - timedelta(days=today_d.weekday())
        sunday = monday + timedelta(days=6)
        start_date = start_date or monday.isoformat()
        end_date = end_date or sunday.isoformat()

    out: Dict[str, Dict[str, Any]] = {}
    base_url = settings.seeder_service_url.rstrip("/")
    api_key = settings.seeder_service_api_key

    for member_id in member_ids:
        out[member_id] = {
            "kpi_fb_inbox_count": 0,
            "range": {"start": start_date, "end": end_date},
        }
        if not base_url:
            continue
        try:
            import httpx

            headers = {}
            if api_key:
                headers["X-API-Key"] = api_key

            url = (
                f"{base_url}/inbox/messages/count"
                f"?owner={member_id}&start={start_date}&end={end_date}"
            )
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                out[member_id] = {
                    "kpi_fb_inbox_count": int(data.get("count", 0)),
                    "range": data.get("range", {"start": start_date, "end": end_date}),
                }
            else:
                logger.warning(
                    f"Seeder service /inbox/messages/count returned {resp.status_code} "
                    f"for member={member_id}: {resp.text[:200]}"
                )
        except Exception as exc:
            logger.warning(f"Failed to fetch FB inbox from seeder for member={member_id}: {exc}")

    return out


def _member_zalo_account_ids(supabase: Client, member_user_id: str) -> List[str]:
    """Lấy danh sách zalo_accounts.account_id thuộc sở hữu của 1 member.

    Trả [] nếu member chưa từng claim Zalo account nào.
    """
    if not member_user_id:
        return []
    res = (
        supabase.table("zalo_accounts")
        .select("account_id")
        .eq("owner_id", member_user_id)
        .execute()
    )
    return [str(row["account_id"]) for row in (res.data or []) if row.get("account_id")]


def compute_kpi_inbox_progress(
    member_user_ids: Iterable[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """Tính kpi_inbox_current cho từng member.

    Đếm số conversation mà member đã tick share VÀ leader đã verify, có
    ``updated_at`` nằm trong khoảng [start_date, end_date] (theo kpi_tracker).

    Chỉ các row thoả mãn **đồng thời** mới được tính:
        - id_member = member_id
        - shared_role = 'leader'
        - is_active = true
        - verified_at IS NOT NULL (leader đã xác minh)
        - updated_at trong [start_dt, end_dt]

    Args:
        member_user_ids: danh sách app_users.id cần tính.
        start_date: ISO date (YYYY-MM-DD). Mặc định = Monday tuần hiện tại.
        end_date:   ISO date. Mặc định = Sunday tuần hiện tại.

    Returns:
        Dict map ``member_user_id -> {kpi_inbox_current, account_ids, range: {start, end}}``.
        Member nào không có share verified trong khoảng → current = 0.
    """
    supabase: Client = get_supabase_client()

    # Chuẩn hoá khoảng thời gian
    if start_date is None or end_date is None:
        today = datetime.now(VN_TZ).date()
        monday = today - timedelta(days=today.weekday())
        sunday = monday + timedelta(days=6)
        start_date = start_date or monday.isoformat()
        end_date = end_date or sunday.isoformat()

    start_iso = _parse_iso_date(start_date) or date.today()
    end_iso = _parse_iso_date(end_date) or date.today()

    # Tạo timezone Vietnam (+07:00) để đảm bảo so sánh thời gian trùng khớp với mốc ngày của user
    vn_tz = VN_TZ

    # Mở rộng end_date lên cuối ngày (VN) cho so sánh updated_at/created_at, sau đó chuyển sang UTC để so sánh chuỗi ISO
    end_dt = datetime.combine(end_iso, datetime.max.time(), tzinfo=vn_tz).astimezone(timezone.utc).isoformat()
    start_dt = datetime.combine(start_iso, datetime.min.time(), tzinfo=vn_tz).astimezone(timezone.utc).isoformat()

    out: Dict[str, Dict[str, Any]] = {}
    for mid in member_user_ids:
        # Đếm số conversation đã verify của member này trong khoảng
        # (không phụ thuộc vào zalo_accounts.account_id; chỉ cần member có share là đủ)
        try:
            res = (
                supabase.table("zalo_conversation_permissions")
                .select("id, verified_at, is_lead")
                .eq("id_member", mid)
                .eq("shared_role", "leader")
                .eq("is_active", True)
                .eq("is_verify", True)
                .not_.is_("verified_at", "null")
                .execute()
            )
            current = 0
            lead_current = 0
            for r in res.data or []:
                v_at = r.get("verified_at") or ""
                # Chi xet verified_at (thoi diem leader xac minh) de xac dinh
                # tuan tinh KPI - truoc day OR ca created_at/updated_at khien
                # 1 conversation cu bi dem lai neu bi update vi ly do khac
                # (vd toggle is_lead) trong tuan hien tai, gay trung/lech KPI
                # giua cac tuan. verified_at cung la quy uoc dang dung o RPC
                # get_team_kpi_overview (migration 012) cho cung 1 bang nay.
                if v_at >= start_dt and v_at <= end_dt:
                    current += 1
                    if r.get("is_lead"):
                        lead_current += 1
        except Exception as exc:
            logger.warning(f"compute_kpi_inbox_progress failed for member={mid}: {exc}")
            current = 0
            lead_current = 0

        account_ids = _member_zalo_account_ids(supabase, mid)
        out[mid] = {
            "kpi_inbox_current": current,
            "kpi_lead_current": lead_current,
            "account_ids": account_ids,
            "range": {"start": start_date, "end": end_date},
        }

    return out


def get_kpi_inbox_progress_by_email(
    email: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """API thuận tiện: truyền email -> trả về kpi_inbox_current cho 1 member.

    Trả về dict rỗng nếu email không tồn tại.
    """
    supabase: Client = get_supabase_client()
    res = supabase.table("app_users").select("id").eq("email", email).limit(1).execute()
    if not res.data:
        return {}
    member_id = str(res.data[0]["id"])
    progress = compute_kpi_inbox_progress([member_id], start_date, end_date)
    return progress.get(member_id, {"kpi_inbox_current": 0, "account_ids": [], "range": {}})


# ─────────────────────────────────────────────────────────────────────────────
# Facebook Inbox KPI (local Supabase — FB inbox từ seeder service)
# ─────────────────────────────────────────────────────────────────────────────
#
# Sau khi leader/admin bấm "Tính Inbox" trên hộp thoại FB:
#   1. FE gọi POST /kpi/fb-inbox-sync với {user_id, conv_ids}
#   2. Backend upsert vào bảng fb_inbox_kpi (supabase)
#   3. Backend proxy request sang seeder service để lưu tin nhắn
#   4. KPI inbox được tính tổng hợp: Zalo (zalo_conversation_permissions) + FB (fb_inbox_kpi)
#
# Bảng fb_inbox_kpi schema:
#   id (uuid), id_member (uuid FK app_users), id_leader (uuid FK app_users),
#   conv_id (text), user_id (text — FB user_id), message_count (int),
#   is_lead (bool), synced_at (timestamptz), created_at (timestamptz)
# ─────────────────────────────────────────────────────────────────────────────


def count_fb_inbox_kpi(
    member_email: str,
    leader_email: str,
    conv_ids: List[str],
    user_id: str,
    is_lead: bool = False,
) -> dict:
    """Upsert inbox KPI count cho 1 hoặc nhiều hội thoại FB.

    Mỗi hội thoại = 1 inbox KPI count.
    Nếu is_lead=True -> đánh dấu là lead tiềm năng.

    Trả: {"synced": n, "lead": m} với số lượng upsert thành công.

    LUỒNG MỚI:
    1. Gọi resolve_id_member() từ fb_inbox_account_service - dùng bảng fb_inbox_accounts
    2. Nếu không tìm thấy -> thử các fallback cũ (social_accounts, profile_id, Markee)
    3. Lưu vào fb_inbox_kpi với id_member đã resolve
    """
    supabase: Client = get_supabase_client()

    # Resolve leader email -> user id (always via email)
    leader_res = supabase.table("app_users").select("id").eq("email", leader_email).limit(1).execute()
    if not leader_res.data:
        raise ValueError(f"Không tìm thấy leader với email: {leader_email}")
    id_leader = leader_res.data[0]["id"]

    # === PRIMARY: Resolve id_member từ bảng fb_inbox_accounts ===
    from app.modules.all_platform.services.fb_inbox_account_service import resolve_id_member
    id_member: Optional[str] = resolve_id_member(user_id)

    # === FALLBACK: Các cách resolve cũ nếu bảng mới không có ===
    if not id_member:
        # Trường hợp 1 — member_email != leader_email (member tự bấm trên acc của mình):
        if member_email.lower() != leader_email.lower():
            member_res = supabase.table("app_users").select("id").eq("email", member_email).limit(1).execute()
            if member_res.data:
                id_member = member_res.data[0]["id"]
        # Trường hợp 2 — member_email == leader_email (admin/leader bấm trên session của member khác)
        else:
            # A) Qua social_accounts
            platforms_res = supabase.table("platforms").select("id").ilike("name", "facebook").limit(1).execute()
            fb_platform_id = platforms_res.data[0]["id"] if platforms_res.data else None

            if fb_platform_id:
                fb_acc_res = (
                    supabase.table("social_accounts")
                    .select("app_user_id")
                    .eq("id_platform", fb_platform_id)
                    .eq("account_profile_id", user_id)
                    .limit(1)
                    .execute()
                )
                if fb_acc_res.data:
                    id_member = str(fb_acc_res.data[0]["app_user_id"])

            # B) Fallback: thử qua app_users.profile_id
            if not id_member:
                try:
                    member_by_profile = (
                        supabase.table("app_users")
                        .select("id")
                        .eq("profile_id", user_id)
                        .limit(1)
                        .execute()
                    )
                    if member_by_profile.data:
                        id_member = str(member_by_profile.data[0]["id"])
                except Exception:
                    pass  # column profile_id may not exist

            # C) Fallback: gọi Markee service
            if not id_member:
                try:
                    import httpx as _hx
                    import os as _os
                    _markee_url = (_os.getenv("MARKEE_FB_BASE_URL") or "https://auto-fb.zenithglobal.dev").rstrip("/")
                    _markee_key = _os.getenv("MARKEE_FB_API_KEY", "").strip()
                    _h = {"X-API-Key": _markee_key} if _markee_key else {}
                    with _hx.Client(timeout=10.0) as _c:
                        _r = _c.get(f"{_markee_url}/session/owner/{user_id}", headers=_h)
                    if _r.status_code == 200:
                        _payload = _r.json()
                        _owner = _payload.get("owner")
                        if _owner and isinstance(_owner, str) and len(_owner) == 36:
                            id_member = _owner
                except Exception:
                    pass

    if not id_member:
        raise ValueError(
            f"Không tìm thấy member sở hữu FB account [{user_id}]. "
            f"Vui lòng đảm bảo FB account đã được thêm vào hệ thống "
            f"(vào app -> Quản lý tài khoản -> Thêm FB Inbox Account)."
        )

    now = datetime.now(timezone.utc).isoformat()
    synced = 0
    lead = 0

    for conv_id in conv_ids:
        existing = (
            supabase.table("fb_inbox_kpi")
            .select("id, is_lead")
            .eq("id_member", id_member)
            .eq("conv_id", conv_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            existing_row = existing.data[0]
            # Update only if is_lead changed from False to True
            if is_lead and not existing_row.get("is_lead"):
                supabase.table("fb_inbox_kpi").update(
                    {"is_lead": True, "synced_at": now}
                ).eq("id", existing_row["id"]).execute()
                lead += 1
            else:
                supabase.table("fb_inbox_kpi").update(
                    {"message_count": existing_row.get("message_count", 0) + 1, "synced_at": now}
                ).eq("id", existing_row["id"]).execute()
            synced += 1
        else:
            supabase.table("fb_inbox_kpi").insert({
                "id_member": id_member,
                "id_leader": id_leader,
                "conv_id": conv_id,
                "user_id": user_id,
                "message_count": 1,
                "is_lead": is_lead,
                "synced_at": now,
            }).execute()
            synced += 1
            if is_lead:
                lead += 1

    # Phase 1: invalidate cache sau khi upsert fb_inbox_kpi
    if synced > 0:
        try:
            invalidate_overview_cache(leader_email)
        except Exception:
            pass

    return {"synced": synced, "lead": lead, "member_email": member_email}


def auto_count_fb_inbox_reply(
    user_id: str, conv_id: str, raise_on_error: bool = False,
) -> Optional[dict]:
    """Tự động tính +1 KPI inbox khi nhân viên trả lời khách qua FB Messenger.

    Gọi sau khi POST /inbox/reply gửi thành công. Ghi thẳng is_confirmed=True
    nên không cần leader bấm xác nhận.

    KHÔNG backdate theo thời điểm tin nhắn thật — bấm quét/phát hiện ở tuần nào
    thì tính điểm vào đúng tuần đó (created_at = now() tại thời điểm xử lý), kể
    cả khi tin nhắn thực tế đã tồn đọng từ trước (vd acc vừa đăng nhập lại sau
    nhiều tuần offline).

    Khóa 30 ngày theo hội thoại (INBOX_KPI_LOCK_DAYS): 1 conv_id chỉ được tính
    điểm KPI Inbox mới nếu lần tính gần nhất đã cách đây >= 30 ngày (hoặc chưa
    từng tính). Trong vòng 30 ngày kể từ lần tính gần nhất, tin nhắn mới từ cùng
    hội thoại bị bỏ qua — tránh spam qua lại cùng 1 deal để bào KPI. Mỗi lần đủ
    điều kiện tính điểm sẽ INSERT 1 dòng MỚI (không update đè dòng cũ), để mỗi
    dòng giữ đúng created_at của riêng nó (thời điểm quét/phát hiện).

    Trả None (không raise) nếu FB account chưa được link với member nào, để
    không làm hỏng luồng gửi tin.

    raise_on_error: mặc định False để KHÔNG đổi hành vi cũ (gọi từ BackgroundTasks
    của /inbox/reply — fire-and-forget, không ai đọc lỗi). Đặt True khi caller CẦN
    phân biệt "thành công/no-op hợp lệ" với "lỗi tạm thời nên thử lại" (vd endpoint
    /fb/inbox/reply-detected — nếu nuốt lỗi Supabase disconnect rồi vẫn trả None
    như thành công thì y hệt bug đã xảy ra với acc Lê Hải 2026-07-09)."""
    if not user_id or not conv_id:
        return None

    try:
        from app.modules.all_platform.services.fb_inbox_account_service import resolve_id_member

        id_member = resolve_id_member(user_id)
        if not id_member:
            logger.info(f"auto_count_fb_inbox_reply: no member linked to user_id={user_id}, skip")
            return None

        supabase: Client = get_supabase_client()

        # Resolve leader của member (fallback: member tự làm leader nếu chưa có team)
        id_leader = id_member
        member_teams = (
            supabase.table("member_of_teams")
            .select("id_teams")
            .eq("id_member", id_member)
            .limit(1)
            .execute()
        )
        if member_teams.data:
            team_res = (
                supabase.table("teams")
                .select("id_leader")
                .eq("id", member_teams.data[0]["id_teams"])
                .limit(1)
                .execute()
            )
            if team_res.data and team_res.data[0].get("id_leader"):
                id_leader = team_res.data[0]["id_leader"]

        now_dt = datetime.now(timezone.utc)
        now = now_dt.isoformat()

        existing = (
            supabase.table("fb_inbox_kpi")
            .select("id, is_confirmed, created_at")
            .eq("id_member", id_member)
            .eq("conv_id", conv_id)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if existing.data:
            row = existing.data[0]
            if row.get("is_confirmed"):
                last_counted = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
                if now_dt - last_counted < timedelta(days=INBOX_KPI_LOCK_DAYS):
                    return None  # trong thoi gian khoa, khong tinh them
                # Qua moc khoa -> coi la 1 luot cham soc moi, cong 1 diem KPI moi
                supabase.table("fb_inbox_kpi").insert({
                    "id_member": id_member,
                    "id_leader": id_leader,
                    "conv_id": conv_id,
                    "user_id": user_id,
                    "message_count": 1,
                    "is_lead": False,
                    "is_confirmed": True,
                    "synced_at": now,
                }).execute()
            else:
                # Dong cu chua tung duoc confirm (tao boi luong de xuat cu) -> xac nhan luon
                supabase.table("fb_inbox_kpi").update(
                    {"is_confirmed": True, "synced_at": now}
                ).eq("id", row["id"]).execute()
        else:
            supabase.table("fb_inbox_kpi").insert({
                "id_member": id_member,
                "id_leader": id_leader,
                "conv_id": conv_id,
                "user_id": user_id,
                "message_count": 1,
                "is_lead": False,
                "is_confirmed": True,
                "synced_at": now,
            }).execute()

        # Invalidate cache overview để dashboard cập nhật ngay
        leader_email = None
        try:
            leader_res = supabase.table("app_users").select("email").eq("id", id_leader).limit(1).execute()
            if leader_res.data:
                leader_email = leader_res.data[0].get("email")
        except Exception:
            pass
        invalidate_overview_cache(leader_email)

        logger.info(
            f"auto_count_fb_inbox_reply: counted conv_id={conv_id} for member={id_member} (user_id={user_id})"
        )
        return {"id_member": id_member, "id_leader": id_leader, "conv_id": conv_id}
    except Exception as exc:
        logger.warning(
            f"auto_count_fb_inbox_reply failed (user_id={user_id}, conv_id={conv_id}): {exc}"
        )
        if raise_on_error:
            raise
        return None


def mark_fb_inbox_lead(
    user_id: str, conv_id: str, raise_on_error: bool = False
) -> Optional[dict]:
    """Set is_lead=True cho 1 hội thoại FB Inbox — gọi khi nhân viên bấm "Đánh dấu
    là khách" trong tab Inbox (field=is_customer, value=true).

    Trước giờ "Đánh dấu là khách" chỉ lưu cờ is_customer trong file JSON local
    của service, KHÔNG hề ghi lên Supabase -> phần "Lead" (45% trọng số KPI team,
    nặng nhất) luôn = 0 dù nhân viên đã đánh dấu đủ khách thật. Hàm này nối lại
    hành động đó vào fb_inbox_kpi.is_lead.

    Nếu chưa có dòng KPI cho hội thoại này (nhân viên đánh dấu khách trước khi
    được auto-count reply) thì tạo mới luôn (is_confirmed=True) thay vì bỏ qua.
    Idempotent: chỉ update khi is_lead đang False, gọi lại nhiều lần không sao.
    """
    if not user_id or not conv_id:
        return None

    try:
        from app.modules.all_platform.services.fb_inbox_account_service import resolve_id_member

        id_member = resolve_id_member(user_id)
        if not id_member:
            logger.info(f"mark_fb_inbox_lead: no member linked to user_id={user_id}, skip")
            return None

        supabase: Client = get_supabase_client()

        id_leader = id_member
        member_teams = (
            supabase.table("member_of_teams")
            .select("id_teams")
            .eq("id_member", id_member)
            .limit(1)
            .execute()
        )
        if member_teams.data:
            team_res = (
                supabase.table("teams")
                .select("id_leader")
                .eq("id", member_teams.data[0]["id_teams"])
                .limit(1)
                .execute()
            )
            if team_res.data and team_res.data[0].get("id_leader"):
                id_leader = team_res.data[0]["id_leader"]

        now = datetime.now(timezone.utc).isoformat()

        existing = (
            supabase.table("fb_inbox_kpi")
            .select("id, is_lead")
            .eq("id_member", id_member)
            .eq("conv_id", conv_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            row = existing.data[0]
            if not row.get("is_lead"):
                supabase.table("fb_inbox_kpi").update(
                    {"is_lead": True, "synced_at": now}
                ).eq("id", row["id"]).execute()
        else:
            supabase.table("fb_inbox_kpi").insert({
                "id_member": id_member,
                "id_leader": id_leader,
                "conv_id": conv_id,
                "user_id": user_id,
                "message_count": 1,
                "is_lead": True,
                "is_confirmed": True,
                "synced_at": now,
            }).execute()

        leader_email = None
        try:
            leader_res = supabase.table("app_users").select("email").eq("id", id_leader).limit(1).execute()
            if leader_res.data:
                leader_email = leader_res.data[0].get("email")
        except Exception:
            pass
        invalidate_overview_cache(leader_email)

        logger.info(f"mark_fb_inbox_lead: marked lead conv_id={conv_id} for member={id_member} (user_id={user_id})")
        return {"id_member": id_member, "id_leader": id_leader, "conv_id": conv_id}
    except Exception as exc:
        logger.warning(f"mark_fb_inbox_lead failed (user_id={user_id}, conv_id={conv_id}): {exc}")
        if raise_on_error:
            raise
        return None


# Phase 1: gọi helper này từ bất kỳ đâu trong module khác để clear cache khi
# leader verify/sync inbox. Tránh vòng import trực tiếp từ các module khác.
def notify_fb_inbox_changed(leader_email: Optional[str] = None) -> None:
    """Public hook để invalidate cache khi fb_inbox_kpi thay đổi."""
    try:
        invalidate_overview_cache(leader_email)
    except Exception as exc:  # pragma: no cover
        logger.debug(f"invalidate_overview_cache failed: {exc}")


@_retry_supabase
def get_fb_inbox_kpi_summary(
    member_email: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Lấy tổng hợp KPI inbox FB ĐÃ XÁC NHẬN cho 1 member trong khoảng ngày.

    CHỈ đếm inbox đã được leader/admin xác nhận (is_confirmed=True).
    Dùng cho hiển thị KPI đã hoàn thành.

    Returns: {inbox_count, lead_count, conv_ids, range}.
    """
    supabase: Client = get_supabase_client()

    res = supabase.table("app_users").select("id").eq("email", member_email).limit(1).execute()
    if not res.data:
        return {"inbox_count": 0, "lead_count": 0, "conv_ids": [], "range": {}}

    member_id = res.data[0]["id"]

    # Convert YYYY-MM-DD -> VN timezone datetime range, then compare as UTC strings.
    #
    # Dung created_at (set 1 lan luc insert, khong bao gio bi ghi de) thay vi
    # synced_at (bi cap nhat lai = now() moi lan leader xac nhan/xac nhan lai
    # CUNG 1 conv_id qua /kpi/fb-inbox-sync hoac /kpi/fb-inbox-bulk-verify) -
    # tranh 1 hoi thoai cu "troi" vao tuan hien tai moi lan duoc dong lai,
    # gay KPI Inbox cua member hay duoc xac nhan lien tuc bi phinh len sai.
    if start_date and end_date:
        vn_tz = VN_TZ
        start_iso = _parse_iso_date(start_date) or date.today()
        end_iso = _parse_iso_date(end_date) or date.today()
        start_dt = datetime.combine(start_iso, datetime.min.time(), tzinfo=vn_tz).astimezone(timezone.utc).isoformat()
        end_dt = datetime.combine(end_iso, datetime.max.time(), tzinfo=vn_tz).astimezone(timezone.utc).isoformat()
        query = (
            supabase.table("fb_inbox_kpi")
            .select("id, conv_id, message_count, is_lead, synced_at, created_at")
            .eq("id_member", member_id)
            .eq("is_confirmed", True)  # CHỈ đếm inbox ĐÃ XÁC NHẬN
            .gte("created_at", start_dt)
            .lte("created_at", end_dt)
        )
    else:
        query = (
            supabase.table("fb_inbox_kpi")
            .select("id, conv_id, message_count, is_lead, synced_at, created_at")
            .eq("id_member", member_id)
            .eq("is_confirmed", True)  # CHỈ đếm inbox ĐÃ XÁC NHẬN
        )

    rows = query.execute().data or []
    inbox_count = len(rows)
    lead_count = sum(1 for r in rows if r.get("is_lead"))
    conv_ids = [r["conv_id"] for r in rows if r.get("conv_id")]

    return {
        "inbox_count": inbox_count,
        "lead_count": lead_count,
        "conv_ids": conv_ids,
        "range": {"start": start_date or "", "end": end_date or ""},
    }


@_retry_supabase
def get_pending_fb_inbox_kpi(
    member_email: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Lấy danh sách KPI inbox FB CHƯA XÁC NHẬN cho 1 member.

    Dùng cho filter "Chưa xác minh" - hiển thị inbox member đã đề xuất
    nhưng leader/admin chưa duyệt (is_confirmed=False).

    Returns: {pending_count, pending_conv_ids, range}.
    """
    supabase: Client = get_supabase_client()

    res = supabase.table("app_users").select("id").eq("email", member_email).limit(1).execute()
    if not res.data:
        return {"pending_count": 0, "pending_conv_ids": [], "range": {}}

    member_id = res.data[0]["id"]

    if start_date and end_date:
        vn_tz = VN_TZ
        start_iso = _parse_iso_date(start_date) or date.today()
        end_iso = _parse_iso_date(end_date) or date.today()
        start_dt = datetime.combine(start_iso, datetime.min.time(), tzinfo=vn_tz).astimezone(timezone.utc).isoformat()
        end_dt = datetime.combine(end_iso, datetime.max.time(), tzinfo=vn_tz).astimezone(timezone.utc).isoformat()
        query = (
            supabase.table("fb_inbox_kpi")
            .select("id, conv_id, message_count, is_lead, synced_at, created_at")
            .eq("id_member", member_id)
            .eq("is_confirmed", False)  # CHỈ lấy inbox CHƯA XÁC NHẬN
            # created_at, không phải synced_at: synced_at bị ghi đè mỗi lần
            # (re)confirm nên hội thoại tuần cũ trôi sang tuần hiện tại. Cùng cột
            # với get_fb_inbox_kpi_summary + overview v2 (migration 022).
            .gte("created_at", start_dt)
            .lte("created_at", end_dt)
        )
    else:
        query = (
            supabase.table("fb_inbox_kpi")
            .select("id, conv_id, message_count, is_lead, synced_at")
            .eq("id_member", member_id)
            .eq("is_confirmed", False)  # CHỈ lấy inbox CHƯA XÁC NHẬN
        )

    rows = query.execute().data or []
    pending_count = len(rows)
    pending_conv_ids = [r["conv_id"] for r in rows if r.get("conv_id")]

    return {
        "pending_count": pending_count,
        "pending_conv_ids": pending_conv_ids,
        "range": {"start": start_date or "", "end": end_date or ""},
    }


def _vn_date(ts: str) -> Optional[date]:
    """Convert an ISO timestamp to a VN (Asia/Ho_Chi_Minh) date.

    Handles timestamps stored as UTC strings and converts them to VN local date,
    ensuring consistent date-boundary filtering across all KPI functions.
    Falls back to naive date.fromisoformat if the timestamp can't be parsed.
    """
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(VN_TZ).date()
    except ValueError:
        try:
            return date.fromisoformat(ts[:10])
        except ValueError:
            return None


def get_team_kpi_history(
    leader_email: Optional[str] = None,
    weeks: int = 4,
) -> List[Dict[str, Any]]:
    """Trả về lịch sử KPI theo tuần cho từng team.

    Admin: trả tất cả team.
    Leader: chỉ trả team mình phụ trách (leader_email bắt buộc).
    Mỗi tuần = 1 WeeklySnapshot { week_name, teams: [KpiTeamStats] }.
    Actuals: inbox + lead lấy từ fb_inbox_kpi, post từ fb_post_kpi.
    Comment actuals = 0 (chưa có bảng riêng).
    """
    supabase: Client = get_supabase_client()

    # 1. Lấy danh sách team
    if leader_email:
        leader_res = (
            supabase.table("app_users")
            .select("id")
            .eq("email", leader_email.strip().lower())
            .limit(1)
            .execute()
        )
        if not leader_res.data:
            return []
        leader_id = leader_res.data[0]["id"]
        teams_res = (
            supabase.table("teams")
            .select("id, name_team, id_leader")
            .eq("id_leader", leader_id)
            .execute()
        )
    else:
        teams_res = supabase.table("teams").select("id, name_team, id_leader").execute()

    teams = teams_res.data or []
    if not teams:
        return []

    team_ids = [str(t["id"]) for t in teams]

    # 2. Member ↔ team mapping
    members_res = (
        supabase.table("member_of_teams")
        .select("id_teams, id_member")
        .in_("id_teams", team_ids)
        .execute()
    )
    team_members: Dict[str, List[str]] = {}
    for row in (members_res.data or []):
        tid = str(row["id_teams"])
        mid = str(row["id_member"])
        team_members.setdefault(tid, []).append(mid)

    all_member_ids = list({m for mids in team_members.values() for m in mids})
    if not all_member_ids:
        return []

    # 3. Tuần cần hiển thị (mới nhất trước)
    today = date.today()
    monday_this = today - timedelta(days=today.weekday())
    week_ranges: List[Tuple[str, date, date]] = []
    for i in range(weeks):
        w_start = monday_this - timedelta(weeks=i)
        w_end = w_start + timedelta(days=6)
        year, wnum, _ = w_start.isocalendar()
        week_ranges.append((f"{year}-W{wnum:02d}", w_start, w_end))

    earliest_start = week_ranges[-1][1].isoformat()
    earliest_start_date = week_ranges[-1][1]
    # Convert earliest_start to VN timezone for DB query (match other functions)
    earliest_start_dt = datetime.combine(earliest_start_date, datetime.min.time(), tzinfo=VN_TZ).astimezone(timezone.utc).isoformat()

    # 4. KPI targets từ kpi_tracker
    kpi_res = (
        supabase.table("kpi_tracker")
        .select("id_member, kpi_inbox, kpi_lead, kpi_post, kpi_comment, start_date, end_date")
        .in_("id_member", all_member_ids)
        .eq("status", "active")
        .execute()
    )
    kpi_rows = kpi_res.data or []

    # 5. Actuals cho toàn bộ khoảng
    # created_at (on dinh, khong bi ghi de khi xac nhan lai) - xem migration 022.
    inbox_res = (
        supabase.table("fb_inbox_kpi")
        .select("id_member, is_lead, is_confirmed, created_at")
        .in_("id_member", all_member_ids)
        .gte("created_at", earliest_start_dt)
        .execute()
    )
    post_res = (
        supabase.table("fb_post_kpi")
        .select("id_member, posted_at")
        .in_("id_member", all_member_ids)
        .gte("posted_at", earliest_start_dt)
        .execute()
    )
    inbox_rows = inbox_res.data or []
    post_rows = post_res.data or []

    # 5b. CRM lead count từ customer_leads (1 truy vấn batch)
    crm_lead_rows: List[Dict[str, Any]] = []
    try:
        latest_iso = datetime.combine(
            monday_this + timedelta(days=6), datetime.max.time(), tzinfo=VN_TZ
        ).astimezone(timezone.utc).isoformat()
        crm_res = (
            supabase.table("customer_leads")
            .select("leaded_by, created_at")
            .in_("leaded_by", all_member_ids)
            .not_.is_("leaded_by", "null")
            .gte("created_at", earliest_start_dt)
            .lte("created_at", latest_iso)
            .execute()
        )
        crm_lead_rows = crm_res.data or []
    except Exception as exc:
        logger.warning(f"customer_leads lead-count (history v1) failed: {exc}")

    # 6. Build snapshots
    result: List[Dict[str, Any]] = []
    for week_name, w_start, w_end in week_ranges:
        week_teams = []
        for team in teams:
            tid = str(team["id"])
            mids = set(team_members.get(tid, []))
            if not mids:
                continue

            # --- Targets: sum KPI tracker entries overlapping this week ---
            inbox_target = lead_target = post_target = comment_target = 0
            for kt in kpi_rows:
                if str(kt["id_member"]) not in mids:
                    continue
                kt_start = date.fromisoformat(kt["start_date"]) if kt.get("start_date") else None
                kt_end = date.fromisoformat(kt["end_date"]) if kt.get("end_date") else None
                if kt_start and kt_end:
                    if not (kt_end < w_start or kt_start > w_end):
                        inbox_target += kt.get("kpi_inbox") or 0
                        lead_target += kt.get("kpi_lead") or 0
                        post_target += kt.get("kpi_post") or 0
                        comment_target += kt.get("kpi_comment") or 0
                else:
                    inbox_target += kt.get("kpi_inbox") or 0
                    lead_target += kt.get("kpi_lead") or 0
                    post_target += kt.get("kpi_post") or 0
                    comment_target += kt.get("kpi_comment") or 0

            # --- Actuals ---
            inbox_actual = lead_actual = post_actual = 0
            for row in inbox_rows:
                if str(row["id_member"]) not in mids:
                    continue
                d = _vn_date(row.get("created_at") or "")
                if d is None:
                    continue
                if w_start <= d <= w_end:
                    if row.get("is_confirmed"):
                        inbox_actual += 1
                    if row.get("is_lead"):
                        lead_actual += 1

            for row in post_rows:
                if str(row["id_member"]) not in mids:
                    continue
                d = _vn_date(row.get("posted_at") or "")
                if d is None:
                    continue
                if w_start <= d <= w_end:
                    post_actual += 1

            # CRM lead: deal được tạo với leaded_by = member trong tuần này
            for row in crm_lead_rows:
                mid = str(row.get("leaded_by"))
                if mid not in mids:
                    continue
                d = _vn_date(row.get("created_at") or "")
                if d is None:
                    continue
                if w_start <= d <= w_end:
                    lead_actual += 1

            week_teams.append({
                "team_id": tid,
                "team_name": team.get("name_team") or "",
                "lead_actual": lead_actual,
                "lead_target": lead_target,
                "inbox_actual": inbox_actual,
                "inbox_target": inbox_target,
                "post_actual": post_actual,
                "post_target": post_target,
                "comment_actual": 0,
                "comment_target": comment_target,
            })

        result.append({"week_name": week_name, "teams": week_teams})

    return result


def _build_team_kpi_history_optimized(
    *,
    leader_email: Optional[str],
    weeks: int,
) -> List[Dict[str, Any]]:
    """Phiên bản tối ưu của `get_team_kpi_history`.

    Cải thiện so với hàm cũ (admin phải chờ lâu):
      • In-memory cache TTL 30s → request thứ 2 trong 30s là instant.
      • Pre-index `inbox_rows` / `post_rows` thành `dict[mid] -> dict[week_idx -> count]`
        trước khi lặp week × team → tránh O(W × T × len(rows)) của hàm cũ.
      • Load giới hạn lte latest_end_dt để không kéo dữ liệu quá cũ.

    Schema trả về giống hệt `get_team_kpi_history` để FE không phải đổi code.
    """
    cache_key = f"team_history|{(leader_email or '').strip().lower()}|{weeks}"
    cached = _overview_cache_get(cache_key)
    if cached is not None:
        return cached

    supabase: Client = get_supabase_client()

    # 1. Lấy danh sách team
    if leader_email:
        leader_res = (
            supabase.table("app_users")
            .select("id")
            .eq("email", leader_email.strip().lower())
            .limit(1)
            .execute()
        )
        if not leader_res.data:
            return _overview_cache_set(cache_key, [])
        leader_id = leader_res.data[0]["id"]
        teams_res = (
            supabase.table("teams")
            .select("id, name_team, id_leader")
            .eq("id_leader", leader_id)
            .execute()
        )
    else:
        teams_res = supabase.table("teams").select("id, name_team, id_leader").execute()

    teams = teams_res.data or []
    if not teams:
        return _overview_cache_set(cache_key, [])

    team_ids = [str(t["id"]) for t in teams]

    # 2. Member ↔ team mapping (single query)
    members_res = (
        supabase.table("member_of_teams")
        .select("id_teams, id_member")
        .in_("id_teams", team_ids)
        .execute()
    )
    team_members: Dict[str, set] = {}
    for row in (members_res.data or []):
        tid = str(row["id_teams"])
        mid = str(row["id_member"])
        team_members.setdefault(tid, set()).add(mid)

    all_member_ids = list({m for mids in team_members.values() for m in mids})
    if not all_member_ids:
        return _overview_cache_set(cache_key, [])

    # 3. Tính tuần (mới nhất trước)
    today = date.today()
    monday_this = today - timedelta(days=today.weekday())
    week_ranges: List[Tuple[str, date, date]] = []
    for i in range(weeks):
        w_start = monday_this - timedelta(weeks=i)
        w_end = w_start + timedelta(days=6)
        year, wnum, _ = w_start.isocalendar()
        week_ranges.append((f"{year}-W{wnum:02d}", w_start, w_end))

    earliest_start_date = week_ranges[-1][1]
    earliest_start_dt = datetime.combine(
        earliest_start_date, datetime.min.time(), tzinfo=VN_TZ
    ).astimezone(timezone.utc).isoformat()
    latest_end_dt = datetime.combine(
        monday_this + timedelta(days=6), datetime.max.time(), tzinfo=VN_TZ
    ).astimezone(timezone.utc).isoformat()

    # 4. KPI targets từ kpi_tracker (single query, batch)
    kpi_res = (
        supabase.table("kpi_tracker")
        .select("id_member, kpi_inbox, kpi_lead, kpi_post, kpi_comment, start_date, end_date")
        .in_("id_member", all_member_ids)
        .eq("status", "active")
        .execute()
    )
    kpi_rows = kpi_res.data or []

    # 5. Bulk load inbox + post trong cửa sổ W tuần (giới hạn lte để không load lố)
    # created_at (on dinh, khong bi ghi de khi xac nhan lai) - xem migration 022.
    inbox_res = (
        supabase.table("fb_inbox_kpi")
        .select("id_member, is_lead, is_confirmed, created_at")
        .in_("id_member", all_member_ids)
        .gte("created_at", earliest_start_dt)
        .lte("created_at", latest_end_dt)
        .execute()
    )
    post_res = (
        supabase.table("fb_post_kpi")
        .select("id_member, posted_at")
        .in_("id_member", all_member_ids)
        .gte("posted_at", earliest_start_dt)
        .lte("posted_at", latest_end_dt)
        .execute()
    )

    # 6. Pre-index: dict[mid] -> dict[week_idx -> [inbox, lead]]
    #     week_idx = index trong week_ranges (0 = tuần hiện tại).
    inbox_by_member: Dict[str, Dict[int, List[int]]] = {}
    for row in (inbox_res.data or []):
        mid = str(row.get("id_member"))
        d = _vn_date(row.get("created_at") or "")
        if d is None:
            continue
        wk_idx = None
        for idx, (_, w_start, w_end) in enumerate(week_ranges):
            if w_start <= d <= w_end:
                wk_idx = idx
                break
        if wk_idx is None:
            continue
        slot = inbox_by_member.setdefault(mid, {}).setdefault(wk_idx, [0, 0])
        if row.get("is_confirmed"):
            slot[0] += 1
        if row.get("is_lead"):
            slot[1] += 1

    # Pre-index: dict[mid] -> dict[week_idx -> post_count]
    post_by_member: Dict[str, Dict[int, int]] = {}
    for row in (post_res.data or []):
        mid = str(row.get("id_member"))
        d = _vn_date(row.get("posted_at") or "")
        if d is None:
            continue
        wk_idx = None
        for idx, (_, w_start, w_end) in enumerate(week_ranges):
            if w_start <= d <= w_end:
                wk_idx = idx
                break
        if wk_idx is None:
            continue
        post_by_member.setdefault(mid, {})[wk_idx] = (
            post_by_member.get(mid, {}).get(wk_idx, 0) + 1
        )

    # Pre-index kpi theo member
    kpi_by_member: Dict[str, List[Dict[str, Any]]] = {}
    for kt in kpi_rows:
        mid = str(kt["id_member"])
        kpi_by_member.setdefault(mid, []).append(kt)

    # 6b. CRM lead count từ customer_leads (1 truy vấn batch)
    # Pre-index: dict[mid] -> dict[week_idx] -> count
    crm_lead_by_member: Dict[str, Dict[int, int]] = {}
    try:
        earliest_iso = earliest_start_dt
        latest_iso = datetime.combine(
            monday_this + timedelta(days=6), datetime.max.time(), tzinfo=VN_TZ
        ).astimezone(timezone.utc).isoformat()
        crm_res = (
            supabase.table("customer_leads")
            .select("leaded_by, created_at")
            .in_("leaded_by", all_member_ids)
            .not_.is_("leaded_by", "null")
            .gte("created_at", earliest_iso)
            .lte("created_at", latest_iso)
            .execute()
        )
        for row in (crm_res.data or []):
            mid = str(row.get("leaded_by"))
            d = _vn_date(row.get("created_at") or "")
            if d is None or mid not in set(all_member_ids):
                continue
            wk_idx = None
            for idx, (_, w_start, w_end) in enumerate(week_ranges):
                if w_start <= d <= w_end:
                    wk_idx = idx
                    break
            if wk_idx is None:
                continue
            crm_lead_by_member.setdefault(mid, {})[wk_idx] = (
                crm_lead_by_member.get(mid, {}).get(wk_idx, 0) + 1
            )
    except Exception as exc:
        logger.warning(f"customer_leads lead-count (history) failed: {exc}")

    # 7. Build snapshots — O(W × T), tra cứu dict O(1)
    result: List[Dict[str, Any]] = []
    for week_idx, (week_name, w_start, w_end) in enumerate(week_ranges):
        week_teams = []
        for team in teams:
            tid = str(team["id"])
            mids = team_members.get(tid, set())
            if not mids:
                continue

            # Targets: sum KPI tracker entries overlap week
            inbox_target = lead_target = post_target = comment_target = 0
            for mid in mids:
                for kt in kpi_by_member.get(mid, []):
                    kt_start_s = kt.get("start_date")
                    kt_end_s = kt.get("end_date")
                    if kt_start_s and kt_end_s:
                        try:
                            kt_start = date.fromisoformat(kt_start_s)
                            kt_end = date.fromisoformat(kt_end_s)
                        except ValueError:
                            continue
                        if kt_end < w_start or kt_start > w_end:
                            continue
                    inbox_target += kt.get("kpi_inbox") or 0
                    lead_target += kt.get("kpi_lead") or 0
                    post_target += kt.get("kpi_post") or 0
                    comment_target += kt.get("kpi_comment") or 0

            # Actuals: lookup pre-indexed
            inbox_actual = lead_actual = post_actual = 0
            for mid in mids:
                slot = inbox_by_member.get(mid, {}).get(week_idx)
                if slot:
                    inbox_actual += slot[0]
                    lead_actual += slot[1]
                post_actual += post_by_member.get(mid, {}).get(week_idx, 0)
                # Cộng lead từ CRM deal (customer_leads) — người lead tạo deal
                # trong tuần này được tính +1 KPI lead.
                crm_lead_n = crm_lead_by_member.get(mid, {}).get(week_idx, 0)
                lead_actual += crm_lead_n

            week_teams.append({
                "team_id": tid,
                "team_name": team.get("name_team") or "",
                "lead_actual": lead_actual,
                "lead_target": lead_target,
                "inbox_actual": inbox_actual,
                "inbox_target": inbox_target,
                "post_actual": post_actual,
                "post_target": post_target,
                "comment_actual": 0,
                "comment_target": comment_target,
            })

        result.append({"week_name": week_name, "teams": week_teams})

    return _overview_cache_set(cache_key, result)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 1 — Optimized team KPI overview (batch queries, single round-trip)
# ─────────────────────────────────────────────────────────────────────────────
#
# KHÔNG thay đổi hàm `get_all_kpis_for_leader` ở trên — endpoint cũ vẫn hoạt
# động bình thường. Hàm mới `get_team_kpi_overview_v2` được route mới
# /kpi/get-team-overview-v2 sử dụng.
#
# Khác biệt chính:
#   • Thay vì gọi 4–5 truy vấn Supabase × N members trong vòng lặp Python,
#     hàm này gọi ~7 truy vấn cố định bất kể số lượng members.
#   • 1 HTTP request duy nhất tới seeder service (batch owners) thay vì N.
#   • In-memory cache TTL 30s (giống admin_dashboard_service).
# ─────────────────────────────────────────────────────────────────────────────


def _vn_week_range_to_utc(start_date: str, end_date: str) -> Tuple[str, str]:
    """Chuyển khoảng ngày YYYY-MM-DD (giờ VN) sang khoảng ISO UTC để so sánh."""
    s = _parse_iso_date(start_date) or date.today()
    e = _parse_iso_date(end_date) or date.today()
    start_dt = datetime.combine(s, datetime.min.time(), tzinfo=VN_TZ).astimezone(timezone.utc).isoformat()
    end_dt = datetime.combine(e, datetime.max.time(), tzinfo=VN_TZ).astimezone(timezone.utc).isoformat()
    return start_dt, end_dt


def _batch_fb_inbox_count_from_seeder(
    member_ids: List[str],
    start_date: str,
    end_date: str,
) -> Dict[str, int]:
    """Gọi seeder service 1 lần duy nhất cho N owners.

    `member_ids` PHẢI là UUID (app_users.id) — khớp với `owner` mà extension gửi
    khi provision cookie (markee-ext-provision.ts:119). Xem chú thích ở
    `_compute_fb_inbox_progress` — bản đầu dùng email, không bao giờ khớp.

    Seeder service hỗ trợ nhiều `owner` qua comma-separated; nếu chưa hỗ trợ,
    sẽ fallback về gọi tuần tự (giống hàm cũ).
    """
    from app.core.config import settings

    if not member_ids:
        return {}

    base_url = (getattr(settings, "seeder_service_url", "") or "").rstrip("/")
    api_key = getattr(settings, "seeder_service_api_key", "") or ""
    if not base_url:
        return {mid: 0 for mid in member_ids}

    result: Dict[str, int] = {mid: 0 for mid in member_ids}

    try:
        import httpx

        headers = {"X-API-Key": api_key} if api_key else {}
        # Thử gọi batch trước (nếu seeder hỗ trợ `owners` comma-separated).
        # Nếu trả 400/422, fallback gọi tuần tự.
        url_batch = (
            f"{base_url}/inbox/messages/count-batch"
            f"?owners={','.join(member_ids)}&start={start_date}&end={end_date}"
        )
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url_batch, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            counts = data.get("counts") or {}
            for mid in member_ids:
                result[mid] = int(counts.get(mid, 0))
            return result

        # Fallback: gọi tuần tự (giống hàm cũ) — không quá N=20 nên an toàn
        if resp.status_code not in (400, 404, 422):
            logger.warning(
                f"Seeder batch endpoint returned {resp.status_code}, falling back to per-member"
            )
    except Exception as exc:
        logger.debug(f"Seeder batch call failed ({exc}), falling back to per-member")

    # Per-member fallback (giống _compute_fb_inbox_progress cũ)
    try:
        import httpx

        headers = {"X-API-Key": api_key} if api_key else {}
        with httpx.Client(timeout=10.0) as client:
            for mid in member_ids:
                try:
                    url = f"{base_url}/inbox/messages/count?owner={mid}&start={start_date}&end={end_date}"
                    r = client.get(url, headers=headers)
                    if r.status_code == 200:
                        result[mid] = int(r.json().get("count", 0))
                except Exception as exc:
                    logger.debug(f"FB inbox fallback for member={mid} failed: {exc}")
    except Exception as exc:
        logger.warning(f"FB inbox fallback overall failed: {exc}")

    return result


@_retry_supabase
def get_team_kpi_overview_v2(
    *,
    leader_email: Optional[str],
    id_team: Optional[str],
    start_date: str,
    end_date: str,
) -> dict:
    """Phiên bản tối ưu của get_all_kpis_for_leader.

    Tối ưu:
      • ~7 truy vấn Supabase cố định (không phụ thuộc số members).
      • 1 HTTP call tới seeder service (batch).
      • In-memory cache 30s (invalidated khi assign_kpi / verify inbox).
      • Trả về schema tương thích với get_all_kpis_for_leader (members[]).
    """
    cache_key = f"{(leader_email or '').strip().lower()}|{id_team or ''}|{start_date}|{end_date}"
    cached = _overview_cache_get(cache_key)
    if cached is not None:
        logger.debug(f"kpi_overview_v2 cache HIT for {cache_key}")
        return cached

    supabase: Client = get_supabase_client()

    # ── 1. Resolve leader_id + team_ids + member_ids (3 truy vấn) ───────────
    leader_id: Optional[str] = None
    if leader_email:
        leader_res = (
            supabase.table("app_users")
            .select("id")
            .eq("email", leader_email.strip().lower())
            .limit(1)
            .execute()
        )
        leader_id = str(leader_res.data[0]["id"]) if leader_res.data else None

    member_ids: List[str] = []
    if id_team:
        mr = (
            supabase.table("member_of_teams")
            .select("id_member")
            .eq("id_teams", id_team)
            .execute()
        )
        member_ids = [str(r["id_member"]) for r in (mr.data or []) if r.get("id_member")]
    elif leader_id:
        tr = supabase.table("teams").select("id").eq("id_leader", leader_id).execute()
        team_ids = [str(t["id"]) for t in (tr.data or [])]
        if team_ids:
            mr = (
                supabase.table("member_of_teams")
                .select("id_member")
                .in_("id_teams", team_ids)
                .execute()
            )
            member_ids = [str(r["id_member"]) for r in (mr.data or []) if r.get("id_member")]

    # Leader cũng được tính như 1 member trong team của mình
    if leader_id and leader_id not in member_ids:
        member_ids.append(leader_id)

    # Một member có thể thuộc NHIỀU team dưới cùng 1 leader (hoặc khi admin xem
    # tất cả, id_team rỗng). Không dedup ở đây thì vòng lặp build response chạy
    # 2 lần cho member đó -> KPI nhân đôi. Cùng lớp bug mà migration
    # 018_fix_admin_teams_kpi_dup.sql đã sửa ở phía RPC.
    member_ids = list(dict.fromkeys(member_ids))

    if not member_ids:
        return _overview_cache_set(cache_key, {"total": 0, "members": []})

    # ── 2. Member info + KPI tracker + seeding_content (3 truy vấn batch) ────
    user_res = (
        supabase.table("app_users")
        .select("id, email, name, role")
        .in_("id", member_ids)
        .execute()
    )
    user_map: Dict[str, Any] = {str(u["id"]): u for u in (user_res.data or [])}

    kpi_query = (
        supabase.table("kpi_tracker")
        .select("*")
        .in_("id_member", member_ids)
        .eq("status", "active")
    )
    if id_team:
        kpi_query = kpi_query.eq("id_team", id_team)
    if start_date and end_date:
        kpi_query = kpi_query.eq("start_date", start_date).eq("end_date", end_date)
    kpi_rows = kpi_query.execute().data or []
    kpi_map: Dict[str, Any] = {}
    for k in kpi_rows:
        # Nếu 1 member có nhiều KPI active, gán tất định thay vì last-write-wins
        # theo thứ tự Supabase trả về: ưu tiên record khớp đúng tuần đang xem,
        # sau đó tới record có start_date mới nhất.
        mid = str(k["id_member"])
        prev = kpi_map.get(mid)
        if prev is None:
            kpi_map[mid] = k
            continue
        if start_date and end_date:
            k_exact = k.get("start_date") == start_date and k.get("end_date") == end_date
            prev_exact = prev.get("start_date") == start_date and prev.get("end_date") == end_date
            if k_exact != prev_exact:
                if k_exact:
                    kpi_map[mid] = k
                continue
        if str(k.get("start_date") or "") > str(prev.get("start_date") or ""):
            kpi_map[mid] = k

    # Default date range
    default_start, default_end = start_date, end_date
    if not default_start or not default_end:
        today_d = datetime.now(VN_TZ).date()
        monday = today_d - timedelta(days=today_d.weekday())
        sunday = monday + timedelta(days=6)
        default_start = start_date or monday.isoformat()
        default_end = end_date or sunday.isoformat()

    # Tìm min start date từ kpi tracker
    min_start = default_start
    for k in kpi_map.values():
        ks = k.get("start_date")
        if ks and ks < min_start:
            min_start = ks

    seeding_res = (
        supabase.table("seeding_content_kpi")
        .select("id_member, verify, current_day, content, link_comment, id_social_account")
        .in_("id_member", member_ids)
        .gte("current_day", min_start)
        .lte("current_day", default_end)
        .execute()
    )
    seeding_list = seeding_res.data or []
    seeding_by_member: Dict[str, List[Dict[str, Any]]] = {}
    for s in seeding_list:
        mid = str(s.get("id_member"))
        seeding_by_member.setdefault(mid, []).append(s)

    # ── 3. Bulk inbox Zalo (1 truy vấn) ─────────────────────────────────────
    # Chi xet verified_at (thoi diem leader xac minh) de xac dinh tuan tinh
    # KPI - truoc day OR ca created_at/updated_at khien 1 conversation cu bi
    # dem lai/lech tuan khi bi update vi ly do khac (xem fix cung logic o
    # compute_kpi_inbox_progress).
    zalo_res = (
        supabase.table("zalo_conversation_permissions")
        .select("id_member, verified_at, is_lead")
        .in_("id_member", member_ids)
        .eq("shared_role", "leader")
        .eq("is_active", True)
        .eq("is_verify", True)
        # .not_ là property, phải chain .is_(col, "null") — gọi .not_(...) như hàm
        # sẽ ném "'SyncSelectRequestBuilder' object is not callable" và làm hỏng
        # cả nhánh fallback v2 khi RPC lỗi.
        .not_.is_("verified_at", "null")
        .execute()
    )
    start_iso_utc, end_iso_utc = _vn_week_range_to_utc(default_start, default_end)
    zalo_inbox: Dict[str, int] = {m: 0 for m in member_ids}
    zalo_lead: Dict[str, int] = {m: 0 for m in member_ids}
    for r in (zalo_res.data or []):
        mid = str(r.get("id_member"))
        v_at = r.get("verified_at") or ""
        if start_iso_utc <= v_at <= end_iso_utc:
            zalo_inbox[mid] = zalo_inbox.get(mid, 0) + 1
            if r.get("is_lead"):
                zalo_lead[mid] = zalo_lead.get(mid, 0) + 1

    # ── 4. Bulk FB inbox KPI (1 truy vấn) ───────────────────────────────────
    # created_at (on dinh, khong bi ghi de khi xac nhan lai) - xem migration 022.
    fb_inbox_res = (
        supabase.table("fb_inbox_kpi")
        .select("id_member, is_lead, is_confirmed, created_at")
        .in_("id_member", member_ids)
        .eq("is_confirmed", True)
        .gte("created_at", start_iso_utc)
        .lte("created_at", end_iso_utc)
        .execute()
    )
    fb_inbox_count: Dict[str, int] = {m: 0 for m in member_ids}
    fb_lead_count: Dict[str, int] = {m: 0 for m in member_ids}
    for r in (fb_inbox_res.data or []):
        mid = str(r.get("id_member"))
        fb_inbox_count[mid] = fb_inbox_count.get(mid, 0) + 1
        if r.get("is_lead"):
            fb_lead_count[mid] = fb_lead_count.get(mid, 0) + 1

    # ── 5. Bulk FB post KPI (1 truy vấn) ────────────────────────────────────
    fb_post_res = (
        supabase.table("fb_post_kpi")
        .select("id_member, posted_at")
        .in_("id_member", member_ids)
        .gte("posted_at", start_iso_utc)
        .lte("posted_at", end_iso_utc)
        .execute()
    )
    fb_post_count: Dict[str, int] = {m: 0 for m in member_ids}
    for r in (fb_post_res.data or []):
        mid = str(r.get("id_member"))
        fb_post_count[mid] = fb_post_count.get(mid, 0) + 1

    # ── 6. Bulk FB inbox từ seeder (1 HTTP call batch) ──────────────────────
    # owner trên seeder LÀ member UUID (xem chú thích ở _compute_fb_inbox_progress),
    # nên gọi thẳng bằng member_ids — không cần resolve email.
    fb_seeder_count = _batch_fb_inbox_count_from_seeder(member_ids, default_start, default_end)

    # ── 6b. CRM lead count từ customer_leads ───────────────────────────────
    # Mỗi deal có `leaded_by = member_id` và `created_at` nằm trong tuần KPI
    # được tính là 1 lead cho member đó. Leader quản lý member; admin xem tất cả.
    # Cộng dồn vào lead_actual của member.
    crm_lead_count: Dict[str, int] = {m: 0 for m in member_ids}
    try:
        crm_lead_res = (
            supabase.table("customer_leads")
            .select("leaded_by, created_at")
            .in_("leaded_by", member_ids)
            .not_.is_("leaded_by", "null")
            .gte("created_at", start_iso_utc)
            .lte("created_at", end_iso_utc)
            .execute()
        )
        for r in (crm_lead_res.data or []):
            mid = str(r.get("leaded_by"))
            if mid in crm_lead_count:
                crm_lead_count[mid] += 1
    except Exception as exc:
        logger.warning(f"customer_leads lead-count query failed: {exc}")

    # ── 7. Build response (không có truy vấn) ───────────────────────────────
    verified_keywords = ("yes", "đã seeding", "xác minh", "verified")
    members_data: List[Dict[str, Any]] = []
    for mid in member_ids:
        user = user_map.get(mid)
        if not user:
            continue
        active_kpi = kpi_map.get(mid, {}) or {}
        member_email = str(user.get("email", "")).lower()
        eff_start = start_date or active_kpi.get("start_date") or default_start
        eff_end = end_date or active_kpi.get("end_date") or default_end

        # Comment actual trong khoảng
        member_seeding = [
            s for s in seeding_by_member.get(mid, [])
            if s.get("current_day") and eff_start <= s["current_day"] <= eff_end
        ]
        comment_current = sum(
            1 for s in member_seeding
            if str(s.get("verify", "")).strip().lower() in verified_keywords
        )

        # Tổng hợp actuals
        inbox_zalo = int(zalo_inbox.get(mid, 0))
        lead_zalo = int(zalo_lead.get(mid, 0))
        inbox_fb_kpi = int(fb_inbox_count.get(mid, 0))
        lead_fb_kpi = int(fb_lead_count.get(mid, 0))
        inbox_fb_seeder = int(fb_seeder_count.get(mid, 0))
        fb_post_n = int(fb_post_count.get(mid, 0))
        # CRM lead: deal được tạo với leaded_by = member, created_at trong tuần KPI
        lead_crm = int(crm_lead_count.get(mid, 0))

        # KPI Inbox = SỐ HỘI THOẠI (zalo đã verify + fb đã tính KPI).
        # KHÔNG cộng `inbox_fb_seeder`: đó là SỐ TIN NHẮN khách gửi, khác đơn vị
        # -> cộng vào sẽ thổi phồng KPI. Nó chỉ để hiển thị tham khảo
        # (`kpi_inbox_fb_seeder` bên dưới).
        total_inbox_current = inbox_zalo + inbox_fb_kpi
        total_lead_current = lead_zalo + lead_fb_kpi + lead_crm

        members_data.append({
            "id": mid,
            "email": member_email,
            "name": user.get("name"),
            "role": user.get("role", "member"),
            "profile_slug": user.get("slug"),
            "email_leader": leader_email,
            "kpi": [active_kpi] if active_kpi else [],
            "seeding_stats": {
                "verified_count": comment_current,
                "kpi_target": active_kpi.get("kpi_comment", 0),
                "kpi_post": active_kpi.get("kpi_post", 0),
                "kpi_post_current": fb_post_n,
                "kpi_lead": active_kpi.get("kpi_lead", 0),
                "kpi_lead_current": total_lead_current,
                "kpi_inbox": active_kpi.get("kpi_inbox", 0),
                "kpi_inbox_current": total_inbox_current,
                "kpi_inbox_zalo": inbox_zalo,
                "kpi_inbox_fb_seeder": inbox_fb_seeder,
                "kpi_inbox_fb_kpi": inbox_fb_kpi,
                "kpi_inbox_range": {"start": eff_start, "end": eff_end},
            },
            "seeding_items": member_seeding,
            "profile_id": user.get("profile_id"),
            "facebook_name": user.get("facebook_name"),
        })

    return _overview_cache_set(cache_key, {"total": len(members_data), "members": members_data})
