"""Service for Admin Dashboard statistics and analytics."""

from __future__ import annotations

import logging
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import Dict, List, Any
import time
from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

VN_TZ = timezone(timedelta(hours=7))

_CACHE_TTL_SECONDS = 30.0
_CACHE: dict[str, tuple[float, Any]] = {}


def _get_cached(key: str) -> Any | None:
    item = _CACHE.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at > time.monotonic():
        return value
    _CACHE.pop(key, None)
    return None


def _set_cached(key: str, value: Any) -> Any:
    _CACHE[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)
    return value


def get_top_stats() -> Dict[str, Any]:
    """Calculate top dashboard stats: crawled posts, seeding count, approval rate, KPI rate."""
    cached = _get_cached("top_stats")
    if cached is not None:
        return cached

    # 1. Total crawled posts (FB + LI)
    try:
        fb_res = execute_supabase_query(
            lambda: get_supabase_client().table("facebook_posts").select("id", count="exact").limit(1).execute()
        )
        fb_count = fb_res.count if fb_res.count is not None else len(fb_res.data or [])
    except Exception:
        fb_count = 0

    try:
        li_res = execute_supabase_query(
            lambda: get_supabase_client().table("linkedin_posts").select("id", count="exact").limit(1).execute()
        )
        li_count = li_res.count if li_res.count is not None else len(li_res.data or [])
    except Exception:
        li_count = 0

    total_crawled_posts = fb_count + li_count

    # 2. Total Seeding Comments
    try:
        seeding_res = execute_supabase_query(
            lambda: get_supabase_client().table("seeding_content_kpi").select("id", count="exact").limit(1).execute()
        )
        total_seeding = seeding_res.count if seeding_res.count is not None else len(seeding_res.data or [])
    except Exception:
        total_seeding = 0

    # 3. Approval Rate
    try:
        approved_res = execute_supabase_query(
            lambda: get_supabase_client()
            .table("seeding_content_kpi")
            .select("id", count="exact")
            .eq("verify", "yes")
            .limit(1)
            .execute()
        )
        approved_count = approved_res.count if approved_res.count is not None else len(approved_res.data or [])
    except Exception:
        approved_count = 0

    approval_rate = round((approved_count / total_seeding * 100), 1) if total_seeding > 0 else 0.0

    # 4. Average KPI completion rate across active KPIs (current VN week)
    try:
        kpis = execute_supabase_query(
            lambda: get_supabase_client().table("kpi_tracker").select("*").eq("status", "active").execute()
        ).data or []
        if not kpis:
            kpi_rate = 0.0
        else:
            # Compute current VN week boundaries
            today_vn = date.today()  # server runs in VN timezone
            monday_vn = today_vn - timedelta(days=today_vn.weekday())
            sunday_vn = monday_vn + timedelta(days=6)

            # Load seeding contents for current VN week only (server-side filter)
            seeding_data = execute_supabase_query(
                lambda: (
                    get_supabase_client()
                    .table("seeding_content_kpi")
                    .select("id_member, current_day")
                    .gte("current_day", monday_vn.isoformat())
                    .lte("current_day", sunday_vn.isoformat())
                    .execute()
                )
            ).data or []

            total_target = 0
            total_actual = 0

            for k in kpis:
                mid = str(k.get("id_member"))
                sd = k.get("start_date")
                ed = k.get("end_date")

                # Targets
                comment_t = k.get("kpi_comment") or 0
                post_t = k.get("kpi_post") or 0
                lead_t = k.get("kpi_lead") or 0
                inbox_t = k.get("kpi_inbox") or 0

                total_target += comment_t + post_t + lead_t + inbox_t

                # Actual comments within KPI range (intersection with current week)
                actual_comments = 0
                if sd and ed:
                    # Overlap between KPI range [sd, ed] and current week [monday, sunday]
                    overlap_start = max(sd, monday_vn.isoformat())
                    overlap_end = min(ed, sunday_vn.isoformat())
                    if overlap_start <= overlap_end:
                        actual_comments = sum(
                            1 for s in seeding_data
                            if str(s.get("id_member")) == mid
                            and s.get("current_day")
                            and overlap_start <= s["current_day"] <= overlap_end
                        )
                total_actual += actual_comments

            kpi_rate = round((total_actual / total_target * 100), 1) if total_target > 0 else 0.0
    except Exception:
        kpi_rate = 0.0

    return _set_cached("top_stats", {
        "total_crawled_posts": total_crawled_posts,
        "total_seeding_comments": total_seeding,
        "approval_rate": approval_rate,
        "kpi_rate": kpi_rate,
    })


def get_kpi_performance() -> List[Dict[str, Any]]:
    """Get KPI performance target vs actual progress for all teams."""
    cached = _get_cached("kpi_performance")
    if cached is not None:
        return cached
    try:
        # Load teams
        teams = execute_supabase_query(
            lambda: get_supabase_client().table("teams").select("id, name_team").execute()
        ).data or []
        if not teams:
            return []

        # Load member_of_teams associations
        mot_rows = execute_supabase_query(
            lambda: get_supabase_client().table("member_of_teams").select("id_teams, id_member").execute()
        ).data or []
        team_members = {}
        for mot in mot_rows:
            tid = str(mot["id_teams"])
            mid = str(mot["id_member"])
            if tid not in team_members:
                team_members[tid] = []
            team_members[tid].append(mid)

        # Load active KPIs
        kpis = execute_supabase_query(
            lambda: get_supabase_client().table("kpi_tracker").select("*").eq("status", "active").execute()
        ).data or []

        # Compute current VN week boundaries
        today_vn = date.today()
        monday_vn = today_vn - timedelta(days=today_vn.weekday())
        sunday_vn = monday_vn + timedelta(days=6)

        # Load seeding records for current VN week only (server-side filter)
        seeding_data = execute_supabase_query(
            lambda: (
                get_supabase_client()
                .table("seeding_content_kpi")
                .select("id_member, current_day")
                .gte("current_day", monday_vn.isoformat())
                .lte("current_day", sunday_vn.isoformat())
                .execute()
            )
        ).data or []

        # Group data by team name
        team_performance = {}
        for t in teams:
            tid = str(t["id"])
            tname = t.get("name_team") or "Unnamed Team"
            if tname not in team_performance:
                team_performance[tname] = {"target": 0, "actual": 0}

            mids = team_members.get(tid, [])
            for mid in mids:
                # Find active KPI for this member and this team
                k = next((item for item in kpis if str(item.get("id_member")) == mid and str(item.get("id_team")) == tid), None)
                if k:
                    comment_t = k.get("kpi_comment") or 0
                    post_t = k.get("kpi_post") or 0
                    lead_t = k.get("kpi_lead") or 0
                    inbox_t = k.get("kpi_inbox") or 0
                    team_performance[tname]["target"] += comment_t + post_t + lead_t + inbox_t

                    sd = k.get("start_date")
                    ed = k.get("end_date")
                    if sd and ed:
                        # Overlap between KPI range [sd, ed] and current week [monday, sunday]
                        overlap_start = max(sd, monday_vn.isoformat())
                        overlap_end = min(ed, sunday_vn.isoformat())
                        if overlap_start <= overlap_end:
                            actual = sum(
                                1 for s in seeding_data
                                if str(s.get("id_member")) == mid
                                and s.get("current_day")
                                and overlap_start <= s["current_day"] <= overlap_end
                            )
                            team_performance[tname]["actual"] += actual

        return _set_cached("kpi_performance", [
            {"team_name": name, "target": stats["target"], "actual": stats["actual"]}
            for name, stats in team_performance.items()
        ])
    except Exception:
        return []


def get_leaderboards() -> Dict[str, List[Dict[str, Any]]]:
    """Get top 5 seeders and top 5 groups with highest interaction."""
    cached = _get_cached("leaderboards")
    if cached is not None:
        return cached
    
    # 1. Top Seeders (current VN week)
    top_seeders = []
    try:
        today_vn = date.today()
        monday_vn = today_vn - timedelta(days=today_vn.weekday())
        sunday_vn = monday_vn + timedelta(days=6)
        seeding_res = execute_supabase_query(
            lambda: (
                get_supabase_client().table("seeding_content_kpi")
                .select("id_member")
                .eq("verify", "yes")
                .gte("current_day", monday_vn.isoformat())
                .lte("current_day", sunday_vn.isoformat())
                .execute()
            )
        )
        seeding_list = seeding_res.data or []

        # Group and count
        counts = {}
        for s in seeding_list:
            mid = str(s.get("id_member"))
            counts[mid] = counts.get(mid, 0) + 1

        sorted_mids = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]
        if sorted_mids:
            uids = [m[0] for m in sorted_mids]
            users_res = execute_supabase_query(
                lambda: get_supabase_client().table("app_users").select("id, email, name").in_("id", uids).execute()
            )
            user_map = {str(u["id"]): u for u in (users_res.data or [])}
            
            for mid, count in sorted_mids:
                uinfo = user_map.get(mid) or {}
                top_seeders.append({
                    "name": uinfo.get("name") or uinfo.get("email") or "Unknown",
                    "email": uinfo.get("email") or "—",
                    "count": count
                })
    except Exception:
        pass

    # 2. Top Groups by crawl/interaction count in facebook_posts
    top_groups = []
    try:
        fb_posts = execute_supabase_query(
            lambda: get_supabase_client().table("facebook_posts").select("group_id, reactions, comments").execute()
        ).data or []
        
        group_interactions = {}
        for p in fb_posts:
            gid = p.get("group_id")
            if not gid:
                continue
            reactions = p.get("reactions") or 0
            comments = p.get("comments") or 0
            group_interactions[gid] = group_interactions.get(gid, 0) + (reactions + comments)
            
        sorted_gids = sorted(group_interactions.items(), key=lambda x: x[1], reverse=True)[:5]
        
        if sorted_gids:
            gids = [item[0] for item in sorted_gids]
            groups_res = execute_supabase_query(
                lambda: get_supabase_client().table("facebook_groups").select("id, group_name, group_url").in_("id", gids).execute()
            ).data or []
            groups_map = {g["id"]: g for g in groups_res}
            
            for gid, count in sorted_gids:
                ginfo = groups_map.get(gid)
                if ginfo:
                    gurl = ginfo.get("group_url") or "#"
                    top_groups.append({
                        "name": ginfo.get("group_name") or "Unknown Group",
                        "url": gurl,
                        "interactions": count
                    })
    except Exception:
        pass

    return _set_cached("leaderboards", {
        "top_seeders": top_seeders,
        "top_groups": top_groups
    })


# ─────────────────────────────────────────────────────────────────────────────
# Phase 4 — Single RPC admin dashboard overview (thay thế 4 endpoint song song)
# ─────────────────────────────────────────────────────────────────────────────
#
# Thay vì FE gọi 4 HTTP request (/summary + /kpi-performance + /leaderboards
# + /team-history-v2), endpoint /admin/dashboard/overview mới gọi 1 RPC duy nhất
# `get_admin_dashboard_overview` — mọi aggregate được thực hiện server-side
# trong 1 round-trip Postgres.
#
# Cache TTL dài hơn (90s) vì admin dashboard data ít thay đổi theo giây.
# ─────────────────────────────────────────────────────────────────────────────

_OVERVIEW_CACHE_TTL = 90.0
_OVERVIEW_CACHE: dict[str, tuple[float, Any]] = {}


def _get_overview_cached(key: str) -> Any | None:
    item = _OVERVIEW_CACHE.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at > time.monotonic():
        return value
    _OVERVIEW_CACHE.pop(key, None)
    return None


def _set_overview_cached(key: str, value: Any) -> Any:
    _OVERVIEW_CACHE[key] = (time.monotonic() + _OVERVIEW_CACHE_TTL, value)
    return value


def get_admin_dashboard_overview(weeks: int = 4) -> Dict[str, Any]:
    """1 round-trip RPC trả về summary + kpi_performance + leaderboards + weekly_history.

    Schema response (key giống endpoint cũ để FE có thể hydrate thẳng):
      {
        "summary":        {total_crawled_posts, total_seeding_comments,
                           approved_count, approval_rate, kpi_rate},
        "kpi_performance":[{team_name, target, actual}, ...],
        "leaderboards":   {top_seeders: [...], top_groups: [...]},
        "weekly_history": [{week_name, teams: [...]}, ...],
        "range":          {start, end}
      }
    """
    cache_key = f"overview|weeks={weeks}"
    cached = _get_overview_cached(cache_key)
    if cached is not None:
        return cached

    try:
        res = execute_supabase_query(
            lambda: get_supabase_client().rpc(
                "get_admin_dashboard_overview",
                {"p_weeks": weeks},
            ).execute()
        )
        payload = (res.data or {}) if res else {}
    except Exception as exc:
        # Fallback graceful — vẫn trả rỗng, FE không crash
        logger.warning(f"get_admin_dashboard_overview RPC failed: {exc}")
        return _set_overview_cached(cache_key, {
            "summary": {"total_crawled_posts": 0, "total_seeding_comments": 0,
                        "approved_count": 0, "approval_rate": 0, "kpi_rate": 0},
            "kpi_performance": [],
            "leaderboards": {"top_seeders": [], "top_groups": []},
            "weekly_history": [],
            "range": {},
        })

    # Chuẩn hoá summary → thêm approval_rate FE đang kỳ vọng
    summary = dict(payload.get("summary") or {})
    total_seeding = int(summary.get("total_seeding_comments") or 0)
    approved = int(summary.get("approved_count") or 0)
    if "approval_rate" not in summary:
        summary["approval_rate"] = round((approved / total_seeding * 100), 1) if total_seeding else 0.0
    payload["summary"] = summary

    return _set_overview_cached(cache_key, payload)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 7 — High-Interaction Unseeded Posts
# ─────────────────────────────────────────────────────────────────────────────

_UNSEEDED_CACHE_TTL = 60.0  # 60s cache
_UNSEEDED_CACHE: dict[str, tuple[float, Any]] = {}


def _get_unseeded_cached(key: str) -> Any | None:
    item = _UNSEEDED_CACHE.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at > time.monotonic():
        return value
    _UNSEEDED_CACHE.pop(key, None)
    return None


def _set_unseeded_cached(key: str, value: Any) -> Any:
    _UNSEEDED_CACHE[key] = (time.monotonic() + _UNSEEDED_CACHE_TTL, value)
    return value


def get_high_interaction_unseeded_posts(limit: int = 10) -> Any:
    """Get high-interaction posts (score>=60) not yet seeded.

    Returns posts from facebook_posts + linkedin_posts where score >= 60,
    ordered by total interactions (reactions + comments) DESC.
    Filters out posts already in seeding_content_kpi.
    Cache TTL 60s — refreshes automatically when admin opens dashboard.
    """
    cache_key = f"unseeded|limit={limit}"
    cached = _get_unseeded_cached(cache_key)
    if cached is not None:
        return cached

    try:
        res = execute_supabase_query(
            lambda: get_supabase_client().rpc(
                "get_high_interaction_unseeded_posts",
                {"p_limit": limit},
            ).execute()
        )
        payload = res.data if res and res.data else []
    except Exception as exc:
        logger.warning(f"get_high_interaction_unseeded_posts RPC failed: {exc}")
        payload = []

    return _set_unseeded_cached(cache_key, payload)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 7b — Groups Health Stats
# ─────────────────────────────────────────────────────────────────────────────

_GROUPS_HEALTH_CACHE_TTL = 60.0
_GROUPS_HEALTH_CACHE: dict[str, tuple[float, Any]] = {}


def _get_groups_health_cached() -> Any | None:
    item = _GROUPS_HEALTH_CACHE.get("groups_health")
    if not item:
        return None
    expires_at, value = item
    if expires_at > time.monotonic():
        return value
    _GROUPS_HEALTH_CACHE.pop("groups_health", None)
    return None


def _set_groups_health_cached(value: Any) -> Any:
    _GROUPS_HEALTH_CACHE["groups_health"] = (time.monotonic() + _GROUPS_HEALTH_CACHE_TTL, value)
    return value


def get_groups_health_stats() -> Any:
    """Get groups health statistics from facebook_groups + linkedin_groups.

    Returns: {total_groups, alive, low_activity, dead, no_taxonomy, by_tier}.
    Cache TTL 60s.
    """
    cached = _get_groups_health_cached()
    if cached is not None:
        return cached

    try:
        res = execute_supabase_query(
            lambda: get_supabase_client().rpc("get_groups_health_stats").execute()
        )
        payload = res.data if res and res.data else {}
    except Exception as exc:
        logger.warning(f"get_groups_health_stats RPC failed: {exc}")
        payload = {}

    return _set_groups_health_cached(payload)


_TEAM_DAILY_TREND_CACHE_TTL = 60.0
_TEAM_DAILY_TREND_CACHE: dict[str, tuple[float, Any]] = {}


def _get_team_daily_trend_cached(key: str) -> Any | None:
    item = _TEAM_DAILY_TREND_CACHE.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at > time.monotonic():
        return value
    _TEAM_DAILY_TREND_CACHE.pop(key, None)
    return None


def _set_team_daily_trend_cached(key: str, value: Any) -> Any:
    _TEAM_DAILY_TREND_CACHE[key] = (
        time.monotonic() + _TEAM_DAILY_TREND_CACHE_TTL,
        value,
    )
    return value


def _date_head(raw: Any) -> str:
    if not raw:
        return ""
    if isinstance(raw, datetime):
        return raw.date().isoformat()
    if isinstance(raw, date):
        return raw.isoformat()
    return str(raw).strip()[:10]


def _vn_day(raw: Any) -> str:
    if not raw:
        return ""
    if isinstance(raw, datetime):
        dt = raw
    elif isinstance(raw, date):
        return raw.isoformat()
    else:
        text = str(raw).strip()
        if len(text) >= 10 and text[4:5] == "-" and text[7:8] == "-":
            if len(text) == 10:
                return text[:10]
            try:
                dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return text[:10]
        else:
            return text[:10]

    if dt.tzinfo is None:
        return dt.date().isoformat()
    return dt.astimezone(VN_TZ).date().isoformat()


def _parse_iso_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw).strip())
    except ValueError:
        return None


def get_team_daily_trend(
    days: int = 14,
    start_date: str | None = None,
    end_date: str | None = None,
    team_ids: List[str] | None = None,
    metric: str | None = None,
) -> Dict[str, Any]:
    """Return daily activity counts split by team for a date range."""
    safe_days = max(7, min(days, 31))
    today_vn = datetime.now(timezone.utc).astimezone(VN_TZ).date()
    parsed_start = _parse_iso_date(start_date)
    parsed_end = _parse_iso_date(end_date)

    if parsed_start and parsed_end and parsed_start <= parsed_end:
        start_day = parsed_start
        end_day = min(parsed_end, today_vn, parsed_start + timedelta(days=92))
        days_in_range = (end_day - start_day).days + 1
    else:
        end_day = today_vn
        start_day = today_vn - timedelta(days=safe_days - 1)
        days_in_range = safe_days

    normalized_team_ids = sorted(
        {
            str(team_id).strip()
            for team_id in (team_ids or [])
            if str(team_id).strip()
        }
    )
    cache_key = (
        f"team_daily_trend_v2|start={start_day.isoformat()}|end={end_day.isoformat()}|"
        f"teams={','.join(normalized_team_ids) or 'all'}|metric={metric or 'all'}"
    )
    cached = _get_team_daily_trend_cached(cache_key)
    if cached is not None:
        return cached

    day_keys = [
        (start_day + timedelta(days=offset)).isoformat()
        for offset in range(days_in_range)
    ]
    start_dt_utc = datetime.combine(start_day, dt_time.min, VN_TZ).astimezone(timezone.utc)
    end_dt_utc = datetime.combine(end_day, dt_time.max, VN_TZ).astimezone(timezone.utc)

    payload: Dict[str, Any] = {
        "days": days_in_range,
        "range": {"start": start_day.isoformat(), "end": end_day.isoformat()},
        "filters": {
            "team_ids": normalized_team_ids,
            "metric": metric or "total_kpi",
        },
        "teams": [],
    }

    try:
        teams = execute_supabase_query(
            lambda: get_supabase_client().table("teams").select("id, name_team, id_leader").order("name_team").execute()
        ).data or []
        if normalized_team_ids:
            teams = [
                team for team in teams
                if str(team.get("id") or "") in normalized_team_ids
            ]
        if not teams:
            return _set_team_daily_trend_cached(cache_key, payload)

        mot_rows = execute_supabase_query(
            lambda: get_supabase_client().table("member_of_teams").select("id_teams, id_member").execute()
        ).data or []

        team_name_by_id: dict[str, str] = {}
        team_buckets: dict[str, Dict[str, Dict[str, int]]] = {}
        member_to_team_ids: dict[str, set[str]] = {}
        member_ids: set[str] = set()

        for team in teams:
            team_id = str(team.get("id") or "")
            if not team_id:
                continue
            team_name_by_id[team_id] = str(team.get("name_team") or "Chưa gắn team")
            team_buckets[team_id] = {
                day: {
                    "posts": 0,
                    "comments": 0,
                    "inbox": 0,
                    "leads": 0,
                    "total_kpi": 0,
                }
                for day in day_keys
            }
            leader_id = str(team.get("id_leader") or "")
            if leader_id:
                member_ids.add(leader_id)
                member_to_team_ids.setdefault(leader_id, set()).add(team_id)

        for row in mot_rows:
            team_id = str(row.get("id_teams") or "")
            member_id = str(row.get("id_member") or "")
            if not team_id or not member_id or team_id not in team_buckets:
                continue
            member_ids.add(member_id)
            member_to_team_ids.setdefault(member_id, set()).add(team_id)

        if not member_ids:
            return _set_team_daily_trend_cached(cache_key, payload)

        fb_post_rows = execute_supabase_query(
            lambda: (
                get_supabase_client()
                .table("fb_post_kpi")
                .select("id_member, posted_at")
                .in_("id_member", list(member_ids))
                .gte("posted_at", start_dt_utc.isoformat())
                .lte("posted_at", end_dt_utc.isoformat())
                .execute()
            )
        ).data or []
        for row in fb_post_rows:
            member_id = str(row.get("id_member") or "")
            day = _vn_day(row.get("posted_at"))
            if day not in team_buckets.get(next(iter(team_buckets)), {}):
                continue
            for team_id in member_to_team_ids.get(member_id, set()):
                team_buckets[team_id][day]["posts"] += 1

        seeding_rows = execute_supabase_query(
            lambda: (
                get_supabase_client()
                .table("seeding_content_kpi")
                .select("id_member, current_day, verify")
                .in_("id_member", list(member_ids))
                .gte("current_day", start_day.isoformat())
                .lte("current_day", end_day.isoformat())
                .execute()
            )
        ).data or []
        verified_statuses = {"yes", "đã seeding", "xác minh", "verified"}
        verified_statuses.update({"da seeding", "đã seeding", "xac minh", "xác minh"})
        for row in seeding_rows:
            verify = str(row.get("verify") or "").strip().lower()
            if verify not in verified_statuses:
                continue
            member_id = str(row.get("id_member") or "")
            day = _date_head(row.get("current_day"))
            if day not in team_buckets.get(next(iter(team_buckets)), {}):
                continue
            for team_id in member_to_team_ids.get(member_id, set()):
                team_buckets[team_id][day]["comments"] += 1

        fb_inbox_rows = execute_supabase_query(
            lambda: (
                get_supabase_client()
                .table("fb_inbox_kpi")
                .select("id_member, is_confirmed, is_lead, created_at")
                .in_("id_member", list(member_ids))
                .eq("is_confirmed", True)
                .gte("created_at", start_dt_utc.isoformat())
                .lte("created_at", end_dt_utc.isoformat())
                .execute()
            )
        ).data or []
        for row in fb_inbox_rows:
            member_id = str(row.get("id_member") or "")
            day = _vn_day(row.get("created_at"))
            if day not in team_buckets.get(next(iter(team_buckets)), {}):
                continue
            for team_id in member_to_team_ids.get(member_id, set()):
                team_buckets[team_id][day]["inbox"] += 1
                if row.get("is_lead"):
                    team_buckets[team_id][day]["leads"] += 1

        zalo_rows = execute_supabase_query(
            lambda: (
                get_supabase_client()
                .table("zalo_conversation_permissions")
                .select("id_member, verified_at, is_lead")
                .in_("id_member", list(member_ids))
                .eq("shared_role", "leader")
                .eq("is_active", True)
                .eq("is_verify", True)
                .not_.is_("verified_at", "null")
                .gte("verified_at", start_dt_utc.isoformat())
                .lte("verified_at", end_dt_utc.isoformat())
                .execute()
            )
        ).data or []
        for row in zalo_rows:
            member_id = str(row.get("id_member") or "")
            day = _vn_day(row.get("verified_at"))
            if day not in team_buckets.get(next(iter(team_buckets)), {}):
                continue
            for team_id in member_to_team_ids.get(member_id, set()):
                team_buckets[team_id][day]["inbox"] += 1
                if row.get("is_lead"):
                    team_buckets[team_id][day]["leads"] += 1

        lead_rows = execute_supabase_query(
            lambda: (
                get_supabase_client()
                .table("customer_leads")
                .select("leaded_by, created_at")
                .in_("leaded_by", list(member_ids))
                .not_.is_("leaded_by", "null")
                .gte("created_at", start_dt_utc.isoformat())
                .lte("created_at", end_dt_utc.isoformat())
                .execute()
            )
        ).data or []
        for row in lead_rows:
            member_id = str(row.get("leaded_by") or "")
            day = _vn_day(row.get("created_at"))
            if day not in team_buckets.get(next(iter(team_buckets)), {}):
                continue
            for team_id in member_to_team_ids.get(member_id, set()):
                team_buckets[team_id][day]["leads"] += 1

        for buckets in team_buckets.values():
            for day in day_keys:
                values = buckets[day]
                values["total_kpi"] = (
                    values["posts"]
                    + values["comments"]
                    + values["inbox"]
                    + values["leads"]
                )

        payload["teams"] = [
            {
                "team_id": team_id,
                "team_name": team_name_by_id.get(team_id, "Chưa gắn team"),
                "series": [
                    {
                        "date": day,
                        "posts": values["posts"],
                        "comments": values["comments"],
                        "inbox": values["inbox"],
                        "leads": values["leads"],
                        "total_kpi": values["total_kpi"],
                    }
                    for day, values in sorted(team_buckets[team_id].items())
                ],
            }
            for team_id in sorted(team_buckets.keys(), key=lambda key: team_name_by_id.get(key, ""))
        ]
    except Exception as exc:
        logger.warning("get_team_daily_trend failed: %s", exc)

    return _set_team_daily_trend_cached(cache_key, payload)
