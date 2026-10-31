"""Unified posts service — single source of truth from Supabase, no cache."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from supabase import Client

from app.core.supabase_client import execute_supabase_query, get_supabase_client


def _parse_date(val: Any) -> str:
    if isinstance(val, (date, datetime)):
        return val.date().isoformat() if isinstance(val, datetime) else val.isoformat()
    if isinstance(val, str) and val:
        return val[:10]
    return ""


def _supabase() -> Client:
    return get_supabase_client()


# ── Core fetch ──────────────────────────────────────────────────────────────────

from functools import wraps

def retry_on_winerror(func):
    """Retry a read that touches Supabase when the connection fails transiently.

    Delegates to ``execute_supabase_query`` so the transient set stays in one
    place. The previous inline substring check ("10035"/"Connection"/"Timeout")
    matched neither ``RemoteProtocolError`` nor its message "Server disconnected
    without sending a response.", so the single most common failure — reusing a
    pooled socket the upstream already closed — was re-raised without a retry
    and surfaced to the user as a red banner.
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        return execute_supabase_query(lambda: func(*args, **kwargs))
    return wrapper

@retry_on_winerror
def _fetch_posts(
    *,
    table: str,
    email: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    intent: Optional[str] = None,
    industry: Optional[str] = None,
    team: Optional[str] = None,
    tier: Optional[str] = None,
    icp: Optional[str] = None,
    content_type: Optional[str] = None,
    product_seeding: Optional[str] = None,
    id_member: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "latest",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict], int]:
    """Fetch posts from a single table with full filter + sort + pagination.

    DB clean note: posts do NOT store taxonomy columns; taxonomy lives on groups.
    - facebook_posts joins via group_id -> facebook_groups
    - linkedin_posts joins via id_group -> linkedin_groups

    Therefore, intent/industry/team/tier filters are applied by first resolving matching group ids.

    Returns (posts, total_count).
    """
    sb = _supabase()
    tbl = sb.table(table)

    # Select nested group to get group_name and taxonomy UUIDs
    if table == "facebook_posts":
        query = tbl.select("*, author_post(*), facebook_groups(group_name, id_intent, id_industry, id_team, id_tier, id_icp, id_content_type, id_product_seeding, id_member)", count="exact")
    else:
        # linkedin_posts KHÔNG có FK tới author_post (khác facebook_posts.id_author) —
        # embed author_post ở đây khiến PostgREST lỗi PGRST200 mỗi lần tab "all"/
        # "linkedin" load -> FE hiện "Server disconnected". Giữ nguyên fix 7d4ed43.
        query = tbl.select("*, linkedin_groups(group_name, id_intent, id_industry, id_team, id_tier, id_icp, id_content_type, id_product_seeding, id_member)", count="exact")

    # Scope to requesting user
    if email:
        if table == "facebook_posts":
            # facebook_posts does not have email_crawl and facebook_groups doesn't either.
            # So we do not scope facebook_posts by email directly.
            pass
        else:
            # linkedin_posts does not have email_crawl, we must resolve via linkedin_groups
            pass # handled below in group_ids resolution

    if date_from:
        query = query.gte("crawl_date", date_from)
    if date_to:
        query = query.lte("crawl_date", date_to)

    # Resolve taxonomy and email filters via groups table
    group_ids: list[str] | None = None
    
    # 1. Resolve user role and scoped member ids
    user_id = None
    user_role = "member"
    allowed_member_ids: list[str] | None = None

    if email:
        user_res = sb.table("app_users").select("id, role").eq("email", email.strip().lower()).limit(1).execute()
        if user_res.data:
            user_id = user_res.data[0]["id"]
            user_role = user_res.data[0].get("role", "member")
            
    if user_role == "admin":
        allowed_member_ids = None  # Admin sees all
    elif user_role == "leader":
        if user_id:
            teams_res = sb.table("teams").select("id").eq("id_leader", user_id).execute()
            team_ids = [t["id"] for t in (teams_res.data or [])]
            allowed_member_ids = []
            if team_ids:
                mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
                allowed_member_ids = [m["id_member"] for m in (mot_res.data or []) if m.get("id_member")]
            if user_id not in allowed_member_ids:
                allowed_member_ids.append(user_id)
        else:
            allowed_member_ids = ["00000000-0000-0000-0000-000000000000"]
    else:
        # Member role
        allowed_member_ids = [user_id] if user_id else ["00000000-0000-0000-0000-000000000000"]

    # If id_member is specified, ensure it is within allowed_member_ids
    if id_member:
        if allowed_member_ids is None or id_member in allowed_member_ids:
            allowed_member_ids = [id_member]
        else:
            allowed_member_ids = ["00000000-0000-0000-0000-000000000000"]
    
    if table == "facebook_posts":
        if allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids)

        if intent or industry or team or tier is not None or icp or content_type or product_seeding:
            gq = sb.table("facebook_groups").select("id")
            if intent:
                gq = gq.eq("id_intent", intent)
            if industry:
                gq = gq.eq("id_industry", industry)
            if team:
                gq = gq.eq("id_team", team)
            if tier is not None:
                gq = gq.eq("id_tier", str(tier))
            if icp:
                gq = gq.eq("id_icp", icp)
            if content_type:
                gq = gq.eq("id_content_type", content_type)
            if product_seeding:
                gq = gq.eq("id_product_seeding", product_seeding)
            gres = gq.execute()
            group_ids = [r.get("id") for r in (gres.data or []) if r.get("id")]
            query = query.in_("group_id", group_ids or ["00000000-0000-0000-0000-000000000000"])
    else:
        # linkedin_posts needs group resolution for BOTH email and taxonomy
        gq = sb.table("linkedin_groups").select("id")
        needs_group_filter = False
        
        if allowed_member_ids is not None:
            gq = gq.in_("id_member", allowed_member_ids)
            needs_group_filter = True
            
        if intent:
            gq = gq.eq("id_intent", intent)
            needs_group_filter = True
        if industry:
            gq = gq.eq("id_industry", industry)
            needs_group_filter = True
        if team:
            gq = gq.eq("id_team", team)
            needs_group_filter = True
        if tier is not None:
            gq = gq.eq("id_tier", str(tier))
            needs_group_filter = True
        if icp:
            gq = gq.eq("id_icp", icp)
            needs_group_filter = True
        if content_type:
            gq = gq.eq("id_content_type", content_type)
            needs_group_filter = True
        if product_seeding:
            gq = gq.eq("id_product_seeding", product_seeding)
            needs_group_filter = True
            
        if needs_group_filter:
            gres = gq.execute()
            group_ids = [r.get("id") for r in (gres.data or []) if r.get("id")]
            query = query.in_("id_group", group_ids or ["00000000-0000-0000-0000-000000000000"])

    if search:
        # linkedin_posts does not have group_name column
        if table == "facebook_posts":
            query = query.or_(f"content.ilike.%{search}%,group_name.ilike.%{search}%")
        else:
            query = query.ilike("content", f"%{search}%")

    # Sort
    if sort == "score_high":
        query = query.order("score", desc=True, nullsfirst=False)
    elif sort == "score_low":
        query = query.order("score", desc=False, nullsfirst=False)
    elif sort == "comments_high":
        query = query.order("comments", desc=True, nullsfirst=False)
    elif sort == "crawler":
        if table == "facebook_posts":
            query = query.order("id_member", desc=False, nullsfirst=False)
        else:
            query = query.order("crawl_date", desc=True, nullsfirst=False)
    else:  # latest
        query = query.order("crawl_date", desc=True, nullsfirst=False)

    # Pagination
    offset = (page - 1) * page_size
    query = query.range(offset, offset + page_size - 1)

    result = query.execute()
    posts = result.data or []
    total = result.count or len(posts)

    if not posts:
        return posts, total

    # Collect UUIDs to resolve taxonomy and crawlers
    cat_ids = set()
    team_ids = set()
    member_ids_to_resolve = set()
    for p in posts:
        # Facebook posts have id_member on the root level
        if p.get("id_member"):
            member_ids_to_resolve.add(p["id_member"])
            
        grp = p.get("facebook_groups") or p.get("linkedin_groups") or {}
        # LinkedIn posts resolve id_member through linkedin_groups
        if grp.get("id_member"):
            member_ids_to_resolve.add(grp["id_member"])
            p["id_member"] = grp["id_member"] # Store it on post level for uniformity
            

        if grp.get("id_intent"): cat_ids.add(grp["id_intent"])
        if grp.get("id_industry"): cat_ids.add(grp["id_industry"])
        if grp.get("id_icp"): cat_ids.add(grp["id_icp"])
        if grp.get("id_tier"): cat_ids.add(grp["id_tier"])
        if grp.get("id_content_type"): cat_ids.add(grp["id_content_type"])
        if grp.get("id_product_seeding"): cat_ids.add(grp["id_product_seeding"])
        if grp.get("id_team"): team_ids.add(grp["id_team"])

    # Resolve names
    cat_map = {}
    if cat_ids:
        cres = sb.table("categories").select("id, name").in_("id", list(cat_ids)).execute()
        for c in (cres.data or []):
            cat_map[c["id"]] = c["name"]
    team_map = {}
    if team_ids:
        tres = sb.table("teams").select("id, name_team").in_("id", list(team_ids)).execute()
        for t in (tres.data or []):
            team_map[t["id"]] = t["name_team"]

    member_map = {}
    if member_ids_to_resolve:
        # Get member names
        mres = sb.table("app_users").select("id, name").in_("id", list(member_ids_to_resolve)).execute()
        for m in (mres.data or []):
            member_map[m["id"]] = {"name": m.get("name") or "Unknown"}
            
        # Get primary team for these members
        mot_res = sb.table("member_of_teams").select("id_member, id_teams").in_("id_member", list(member_ids_to_resolve)).execute()
        if mot_res.data:
            team_ids_for_members = set(m["id_teams"] for m in mot_res.data if m.get("id_teams"))
            team_res = sb.table("teams").select("id, name_team").in_("id", list(team_ids_for_members)).execute()
            team_dict = {t["id"]: t["name_team"] for t in (team_res.data or [])}
            
            for mot in mot_res.data:
                mid = mot.get("id_member")
                tid = mot.get("id_teams")
                if mid in member_map and tid in team_dict:
                    member_map[mid]["team_name"] = team_dict[tid]

    # Map nested group properties and resolved names to root
    for p in posts:
        grp = p.pop("facebook_groups", None) or p.pop("linkedin_groups", None)
        if grp and isinstance(grp, dict):
            p["group_name"] = grp.get("group_name")
            if grp.get("id_intent"): p["intent"] = cat_map.get(grp["id_intent"])
            if grp.get("id_industry"): p["industry"] = cat_map.get(grp["id_industry"])
            if grp.get("id_icp"): p["icp"] = cat_map.get(grp["id_icp"])
            if grp.get("id_tier"): p["tier"] = cat_map.get(grp["id_tier"])
            if grp.get("id_content_type"): p["content_type"] = cat_map.get(grp["id_content_type"])
            if grp.get("id_product_seeding"): p["product_seeding"] = cat_map.get(grp["id_product_seeding"])
            if grp.get("id_team"): p["team"] = team_map.get(grp["id_team"])
            
        mid = p.get("id_member")
        if mid and mid in member_map:
            p["crawler_name"] = member_map[mid].get("name")
            p["crawler_team"] = member_map[mid].get("team_name")

        # Map author_url and author name from author_post relationship
        author_post_data = p.pop("author_post", None)
        if author_post_data and isinstance(author_post_data, dict):
            p["author_url"] = author_post_data.get("url_profile") or ""
            author_name = author_post_data.get("name") or author_post_data.get("author_name") or ""
            p["author"] = author_name
            p["author_name"] = author_name

    return posts, total


def _get_seeded_today(sb: Client, id_member: str, platform: str) -> int:
    try:
        now_vn = datetime.now(timezone.utc) + timedelta(hours=7)
        today = now_vn.date().isoformat()
        query = (
            sb.table("seeding_content_kpi")
            .select("id", count="exact")
            .eq("id_member", id_member)
            .eq("current_day", today)
            .in_("verify", ["yes", "đã seeding", "xác minh", "verified"])
        )
        # Note: In schema, platform is usually a string, but the example has id_platform.
        # If the backend is saving string to a platform column, this works.
        # Otherwise we skip platform filter or adjust based on actual data.
        if platform == "facebook":
            query = query.eq("id_platform", 1)  # Facebook
        elif platform == "linkedin":
            query = query.eq("id_platform", 2)  # LinkedIn
            
        res = query.execute()
        return res.count or 0
    except Exception:
        return 0

def _get_kpi_progress(sb: Client, id_member: str, platform: str) -> tuple[int, int]:
    try:
        # Get active KPI for this member
        # platform filter if needed, but KPI is usually per member/platform
        now_vn = datetime.now(timezone.utc) + timedelta(hours=7)
        today = now_vn.date().isoformat()
        
        kpi_query = sb.table("kpi_tracker").select("start_date, end_date, kpi_comment, id_platform").eq("id_member", id_member).eq("status", "active")
        kpi_res = kpi_query.execute()
        
        if not kpi_res.data:
            return 0, 0
            
        # If there are multiple, try to match by platform
        target_platform_id = 1 if platform == "facebook" else 2
        active_kpi = None
        for k in kpi_res.data:
            if k.get("id_platform") == target_platform_id:
                active_kpi = k
                break
        
        if not active_kpi:
            return 0, 0
            
        start_date = active_kpi.get("start_date")
        end_date = active_kpi.get("end_date")
        kpi_target = active_kpi.get("kpi_comment") or 0
        
        if not start_date or not end_date:
            return 0, kpi_target
            
        # Count seeded posts in KPI date range
        progress_query = (
            sb.table("seeding_content_kpi")
            .select("id", count="exact")
            .eq("id_member", id_member)
            .eq("id_platform", target_platform_id)
            .gte("current_day", start_date)
            .lte("current_day", end_date)
            .in_("verify", ["yes", "đã seeding", "xác minh", "verified"])
        )
        
        progress_res = progress_query.execute()
        progress = progress_res.count or 0
        return progress, kpi_target
        
    except Exception as e:
        print("Error getting KPI progress:", e)
        return 0, 0



@retry_on_winerror
def _fetch_stats(
    *,
    table: str,
    email: str,
) -> dict[str, Any]:
    """Compute stats from database for a given table."""
    sb = _supabase()
    now_vn = datetime.now(timezone.utc) + timedelta(hours=7)
    today = now_vn.date().isoformat()
    yesterday = (now_vn.date() - timedelta(days=1)).isoformat()

    # 1. Resolve user role and scoped member ids
    user_id_fetch = None
    user_role = "member"
    allowed_member_ids: list[str] | None = None

    if email:
        user_res = sb.table("app_users").select("id, role").eq("email", email.strip().lower()).limit(1).execute()
        if user_res.data:
            user_id_fetch = user_res.data[0]["id"]
            user_role = user_res.data[0].get("role", "member")
            
    if user_role == "admin":
        allowed_member_ids = None  # Admin sees all
    elif user_role == "leader":
        if user_id_fetch:
            teams_res = sb.table("teams").select("id").eq("id_leader", user_id_fetch).execute()
            team_ids = [t["id"] for t in (teams_res.data or [])]
            allowed_member_ids = []
            if team_ids:
                mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
                allowed_member_ids = [m["id_member"] for m in (mot_res.data or []) if m.get("id_member")]
            if user_id_fetch not in allowed_member_ids:
                allowed_member_ids.append(user_id_fetch)
        else:
            allowed_member_ids = ["00000000-0000-0000-0000-000000000000"]
    else:
        # Member role
        allowed_member_ids = [user_id_fetch] if user_id_fetch else ["00000000-0000-0000-0000-000000000000"]
        
    group_ids = None
    if table == "linkedin_posts" and allowed_member_ids is not None:
        gq = sb.table("linkedin_groups").select("id").in_("id_member", allowed_member_ids).execute()
        group_ids = [r.get("id") for r in (gq.data or []) if r.get("id")]
    
    def apply_scope(query):
        if table == "linkedin_posts" and allowed_member_ids is not None:
            return query.in_("id_group", group_ids or ["00000000-0000-0000-0000-000000000000"])
        if table == "facebook_posts" and allowed_member_ids is not None:
            return query.in_("id_member", allowed_member_ids)
        return query

    # id_member da resolve o buoc 1 (user_id_fetch) - khong query lai app_users lan 2
    # cho cung 1 email trong cung 1 ham (tung la 1 round-trip Supabase thua thai).
    id_member = user_id_fetch
    platform_name = "facebook" if table == "facebook_posts" else "linkedin"

    # 6 query/tinh toan doc lap ben duoi (khong cai nao phu thuoc ket qua cua
    # nhau) truoc day chay tuan tu tung cai mot (~6 round-trip Supabase noi
    # tiep) - gop lai chay song song bang thread pool, giam tu ~6 round-trip
    # tuan tu con lai bang thoi gian cua request cham nhat.
    today_start, today_end = f"{today}T00:00:00Z", f"{today}T23:59:59Z"
    yesterday_start, yesterday_end = f"{yesterday}T00:00:00Z", f"{yesterday}T23:59:59Z"

    def _today_count():
        r = apply_scope(sb.table(table).select("id", count="exact").gte("crawl_date", today_start).lte("crawl_date", today_end)).execute()
        return r.count or 0

    def _yesterday_count():
        r = apply_scope(sb.table(table).select("id", count="exact").gte("crawl_date", yesterday_start).lte("crawl_date", yesterday_end)).execute()
        return r.count or 0

    def _total_count():
        r = apply_scope(sb.table(table).select("id", count="exact")).execute()
        return r.count or 0

    def _high_count():
        r = apply_scope(sb.table(table).select("id", count="exact").gte("score", 70)).execute()
        return r.count or 0

    def _seeded_today():
        return _get_seeded_today(sb, id_member, platform_name) if id_member else 0

    def _kpi_progress():
        return _get_kpi_progress(sb, id_member, platform_name) if id_member else (0, 0)

    with ThreadPoolExecutor(max_workers=6) as pool:
        f_today = pool.submit(_today_count)
        f_yesterday = pool.submit(_yesterday_count)
        f_total = pool.submit(_total_count)
        f_high = pool.submit(_high_count)
        f_seeded = pool.submit(_seeded_today)
        f_kpi = pool.submit(_kpi_progress)

        today_count = f_today.result()
        yesterday_count = f_yesterday.result()
        total_count = f_total.result()
        high_count = f_high.result()
        seeded_today = f_seeded.result()
        kpi_progress, kpi_target = f_kpi.result()

    return {
        "totalPostsToday": today_count,
        "postsYesterday": yesterday_count,
        "totalPosts": total_count,
        "highScoreCount": high_count,
        "highScorePercent": round((high_count / total_count) * 100, 1) if total_count > 0 else 0,
        "seededToday": seeded_today,
        "totalVisible": total_count,
        "kpiProgress": kpi_progress,
        "kpiTarget": kpi_target,
        "kpiProgressPercent": round((kpi_progress / kpi_target) * 100, 1) if kpi_target > 0 else 0,
    }


def _compute_quick_stats(
    *,
    email: str,
    platform: str,
    tables: list[str],
) -> dict[str, Any]:
    """Compute global dashboard stats for the active platform(s).

    Reused between `/unified/posts/filter` (as `quick_stats`) and
    `/unified/stats` (top-level endpoint). Returns the same shape in both
    so FE can use either source interchangeably.
    """
    if len(tables) == 1:
        try:
            return _fetch_stats(table=tables[0], email=email)
        except Exception as exc:
            # Stats failure must NOT break the feed — log and return zeros
            try:
                logger = _get_logger()
                logger.warning("quick_stats fetch failed: %s", exc)
            except Exception:
                pass
            return _zero_stats()

    # Multi-platform: query ca 2 bang song song (doc lap hoan toan voi nhau)
    # thay vi tuan tu, giam mot nua thoi gian cho khi platform="all".
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_fb = pool.submit(_fetch_stats, table="facebook_posts", email=email)
        f_li = pool.submit(_fetch_stats, table="linkedin_posts", email=email)
        try:
            fb = f_fb.result()
        except Exception:
            fb = _zero_stats()
        try:
            li = f_li.result()
        except Exception:
            li = _zero_stats()

    total = fb["totalPosts"] + li["totalPosts"]
    high = fb["highScoreCount"] + li["highScoreCount"]
    kpi_p = fb.get("kpiProgress", 0) + li.get("kpiProgress", 0)
    kpi_t = fb.get("kpiTarget", 0) + li.get("kpiTarget", 0)
    return {
        "totalPostsToday": fb["totalPostsToday"] + li["totalPostsToday"],
        "postsYesterday": fb["postsYesterday"] + li["postsYesterday"],
        "totalPosts": total,
        "highScoreCount": high,
        "highScorePercent": round((high / total) * 100, 1) if total > 0 else 0,
        "seededToday": fb["seededToday"] + li["seededToday"],
        "totalVisible": total,
        "kpiProgress": kpi_p,
        "kpiTarget": kpi_t,
        "kpiProgressPercent": round((kpi_p / kpi_t) * 100, 1) if kpi_t > 0 else 0,
    }


def _zero_stats() -> dict[str, Any]:
    return {
        "totalPostsToday": 0,
        "postsYesterday": 0,
        "totalPosts": 0,
        "highScoreCount": 0,
        "highScorePercent": 0,
        "seededToday": 0,
        "totalVisible": 0,
        "kpiProgress": 0,
        "kpiTarget": 0,
        "kpiProgressPercent": 0,
    }


def _get_logger():
    """Lazy logger accessor to avoid module-level import cycles."""
    try:
        from app.core.logger import get_logger
        return get_logger(__name__)
    except Exception:
        import logging
        return logging.getLogger(__name__)


# ── Public API ──────────────────────────────────────────────────────────────────


def get_unified_posts(
    *,
    email: str,
    platform: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    intent: Optional[str] = None,
    industry: Optional[str] = None,
    team: Optional[str] = None,
    tier: Optional[str] = None,
    icp: Optional[str] = None,
    content_type: Optional[str] = None,
    product_seeding: Optional[str] = None,
    id_member: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "latest",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Fetch posts from one or all platforms, fully filtered server-side."""
    platforms_to_fetch = []
    if platform == "all" or platform == "general":
        platforms_to_fetch = ["facebook_posts", "linkedin_posts"]
    elif platform == "facebook":
        platforms_to_fetch = ["facebook_posts"]
    elif platform == "linkedin":
        platforms_to_fetch = ["linkedin_posts"]
    else:
        platforms_to_fetch = ["facebook_posts", "linkedin_posts"]

    # Normalize sort parameter for backend database order
    db_sort = sort
    if sort == "newest":
        db_sort = "latest"
    elif sort == "engagement":
        db_sort = "comments_high"

    all_posts: list[dict] = []
    total_count = 0

    if len(platforms_to_fetch) > 1:
        # Combined platforms pagination logic:
        # Fetch the top (page * page_size) from each table, merge, sort, and slice.
        combined_limit = page * page_size
        for table in platforms_to_fetch:
            posts, count = _fetch_posts(
                table=table,
                email=email,
                date_from=date_from,
                date_to=date_to,
                intent=intent,
                industry=industry,
                team=team,
                tier=tier,
                icp=icp,
                content_type=content_type,
                product_seeding=product_seeding,
                id_member=id_member,
                search=search,
                sort=db_sort,
                page=1,
                page_size=combined_limit,
            )
            # Add platform tag
            platform_name = table.replace("_posts", "")
            for p in posts:
                p["platform"] = platform_name
                p["_platform"] = platform_name
            all_posts.extend(posts)
            total_count += count

        # Sort the combined list
        if sort == "score_high":
            all_posts.sort(key=lambda p: p.get("score", 0), reverse=True)
        elif sort == "score_low":
            all_posts.sort(key=lambda p: p.get("score", 0), reverse=False)
        elif sort == "comments_high" or sort == "engagement":
            all_posts.sort(key=lambda p: (p.get("reactions", 0) + p.get("comments", 0) + p.get("shares", 0)), reverse=True)
        elif sort == "crawler":
            def get_crawler_key(p):
                return (p.get("crawler_team") or "zzz", p.get("crawler_name") or "zzz", str(p.get("crawl_date") or ""))
            all_posts.sort(key=get_crawler_key, reverse=False)
        else: # newest / latest
            def get_date_key(p):
                dt = p.get("crawl_date")
                if not dt:
                    return ""
                return str(dt)
            all_posts.sort(key=get_date_key, reverse=True)

        # Slice the combined list for pagination
        offset = (page - 1) * page_size
        all_posts = all_posts[offset : offset + page_size]

    else:
        # Single platform pagination (let database handle pagination directly)
        table = platforms_to_fetch[0]
        posts, count = _fetch_posts(
            table=table,
            email=email,
            date_from=date_from,
            date_to=date_to,
            intent=intent,
            industry=industry,
            team=team,
            tier=tier,
            icp=icp,
            content_type=content_type,
            product_seeding=product_seeding,
            id_member=id_member,
            search=search,
            sort=db_sort,
            page=page,
            page_size=page_size,
        )
        platform_name = table.replace("_posts", "")
        for p in posts:
            p["platform"] = platform_name
            p["_platform"] = platform_name
            
        if sort == "crawler":
            def get_crawler_key(p):
                return (p.get("crawler_team") or "zzz", p.get("crawler_name") or "zzz", str(p.get("crawl_date") or ""))
            posts.sort(key=get_crawler_key, reverse=False)
            
        all_posts = posts
        total_count = count

    # Fetch seeding info for the returned posts
    if all_posts and email:
        try:
            # Each lambda re-resolves the client via _supabase(). Capturing `sb`
            # would hand a retry the same dead client execute_supabase_query just
            # dropped, defeating the reset.
            user_res = execute_supabase_query(
                lambda: _supabase().table("app_users").select("id, role").eq("email", email).limit(1).execute()
            )
            if user_res.data:
                id_member = user_res.data[0]["id"]
                role = user_res.data[0].get("role", "member")
                post_ids = [p.get("id") for p in all_posts if p.get("id")]
                if post_ids:
                    seeding_sel = "id_post, id_member, content, verify, link_comment, social_accounts(account_name)"
                    if role in ["admin", "leader"]:
                        kpi_res = execute_supabase_query(
                            lambda: _supabase().table("seeding_content_kpi").select(seeding_sel).in_("id_post", post_ids).execute()
                        )
                    else:
                        kpi_res = execute_supabase_query(
                            lambda: _supabase().table("seeding_content_kpi").select(seeding_sel).eq("id_member", id_member).in_("id_post", post_ids).execute()
                        )

                    kpi_data = kpi_res.data or []
                    seeding_member_ids = list(set([k.get("id_member") for k in kpi_data if k.get("id_member")]))
                    member_name_map = {}
                    if seeding_member_ids:
                        mem_res = execute_supabase_query(
                            lambda: _supabase().table("app_users").select("id, name").in_("id", seeding_member_ids).execute()
                        )
                        for m in (mem_res.data or []):
                            member_name_map[m["id"]] = m.get("name") or "Unknown"

                    kpi_map = {}
                    all_seedings_map = {}
                    
                    for kpi in kpi_data:
                        pid = kpi.get("id_post")
                        if pid:
                            sa = kpi.get("social_accounts") or {}
                            s_member_id = kpi.get("id_member")
                            
                            seeding_info = {
                                "member_name": member_name_map.get(s_member_id, "Unknown"),
                                "seeding_content": kpi.get("content"),
                                "seeding_name": sa.get("account_name") if isinstance(sa, dict) else None,
                                "link_comment": kpi.get("link_comment"),
                                "verify_status": kpi.get("verify")
                            }
                            
                            if pid not in all_seedings_map:
                                all_seedings_map[pid] = []
                            all_seedings_map[pid].append(seeding_info)
                            
                            if s_member_id == id_member or pid not in kpi_map:
                                kpi_map[pid] = {
                                    "seeding_content": kpi.get("content"),
                                    "seeding_name": sa.get("account_name") if isinstance(sa, dict) else None,
                                    "link_comment": kpi.get("link_comment"),
                                    "verify_status": kpi.get("verify")
                                }
                    
                    for p in all_posts:
                        pid = p.get("id")
                        if pid in kpi_map:
                            p.update(kpi_map[pid])
                        if pid in all_seedings_map:
                            p["all_seedings"] = all_seedings_map[pid]
        except Exception as e:
            print("Error fetching seeding info:", e)

    return {
        "posts": all_posts,
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": (total_count + page_size - 1) // page_size,
        # Phase 6: gộp dashboard stats vào filter response để tiết kiệm 1 round-trip
        # (thay vì gọi /unified/stats riêng). FE fallback về /unified/stats nếu thiếu.
        "quick_stats": _compute_quick_stats(
            email=email,
            platform=platform,
            tables=_tables_for_platform(platform),
        ),
    }


def _tables_for_platform(platform: str) -> list[str]:
    """Resolve platform token -> table list."""
    p = (platform or "").lower()
    if p in ("all", "general", ""):
        return ["facebook_posts", "linkedin_posts"]
    if p == "facebook":
        return ["facebook_posts"]
    if p == "linkedin":
        return ["linkedin_posts"]
    return ["facebook_posts", "linkedin_posts"]


def filter_unified_posts(
    *,
    email: str,
    platform: str,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    intent: Optional[str] = None,
    industry: Optional[str] = None,
    team: Optional[str] = None,
    tier: Optional[str] = None,
    icp: Optional[str] = None,
    content_type: Optional[str] = None,
    product_seeding: Optional[str] = None,
    id_member: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "latest",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Filter posts with ALL criteria applied server-side in Supabase."""
    date_from = date_from or date
    return get_unified_posts(
        email=email,
        platform=platform,
        date_from=date_from,
        date_to=date_to,
        intent=intent,
        industry=industry,
        team=team,
        tier=tier,
        icp=icp,
        content_type=content_type,
        product_seeding=product_seeding,
        id_member=id_member,
        search=search,
        sort=sort,
        page=page,
        page_size=page_size,
    )


def get_unified_stats(
    *,
    email: str,
    platform: str,
) -> dict[str, Any]:
    """Compute stats from Supabase — no cache, always fresh."""
    tables = []
    if platform == "all" or platform == "general":
        tables = ["facebook_posts", "linkedin_posts"]
    elif platform == "facebook":
        tables = ["facebook_posts"]
    elif platform == "linkedin":
        tables = ["linkedin_posts"]
    else:
        tables = ["facebook_posts", "linkedin_posts"]

    if len(tables) == 1:
        return _fetch_stats(table=tables[0], email=email)

    # Merge stats from multiple platforms
    fb = _fetch_stats(table="facebook_posts", email=email)
    li = _fetch_stats(table="linkedin_posts", email=email)

    total_posts = fb["totalPosts"] + li["totalPosts"]
    high_count = fb["highScoreCount"] + li["highScoreCount"]

    return {
        "totalPostsToday": fb["totalPostsToday"] + li["totalPostsToday"],
        "postsYesterday": fb["postsYesterday"] + li["postsYesterday"],
        "totalPosts": total_posts,
        "highScoreCount": high_count,
        "highScorePercent": round((high_count / total_posts) * 100, 1) if total_posts > 0 else 0,
        "seededToday": fb["seededToday"] + li["seededToday"],
        "totalVisible": total_posts,
        "kpiProgress": fb.get("kpiProgress", 0) + li.get("kpiProgress", 0),
        "kpiTarget": fb.get("kpiTarget", 0) + li.get("kpiTarget", 0),
        "kpiProgressPercent": round(((fb.get("kpiProgress", 0) + li.get("kpiProgress", 0)) / (fb.get("kpiTarget", 0) + li.get("kpiTarget", 0))) * 100, 1) if (fb.get("kpiTarget", 0) + li.get("kpiTarget", 0)) > 0 else 0,
    }


# ── Daily trend (Post Feed dashboard) ────────────────────────────────────────────

def _resolve_member_scope(sb: Client, email: str) -> Optional[list[str]]:
    """Tra ve allowed_member_ids theo role (None = khong gioi han, admin xem tat ca).

    Dung lai dung logic phan quyen nhu _fetch_stats (khong doi ham cu de tranh
    rui ro dung code dang chay tot) - trich rieng cho get_unified_daily_trend.
    """
    if not email:
        return ["00000000-0000-0000-0000-000000000000"]
    user_res = sb.table("app_users").select("id, role").eq("email", email.strip().lower()).limit(1).execute()
    if not user_res.data:
        return ["00000000-0000-0000-0000-000000000000"]
    user_id = user_res.data[0]["id"]
    role = user_res.data[0].get("role", "member")
    if role == "admin":
        return None
    if role == "leader":
        teams_res = sb.table("teams").select("id").eq("id_leader", user_id).execute()
        team_ids = [t["id"] for t in (teams_res.data or [])]
        allowed = []
        if team_ids:
            mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
            allowed = [m["id_member"] for m in (mot_res.data or []) if m.get("id_member")]
        if user_id not in allowed:
            allowed.append(user_id)
        return allowed
    return [user_id]


@retry_on_winerror
def get_unified_daily_trend(
    *,
    email: str,
    platform: str,
    days: int = 14,
) -> list[dict[str, Any]]:
    """Tong hop bai/comment/inbox theo TUNG NGAY trong `days` ngay gan nhat.

    Dung cho khoi dashboard xu huong o trang Post Feed (yeu cau cua Thanh:
    "cần thêm dashboard để biết tổng comment, inbox... các ngày ra sao" -
    4 the so hien tai chi co so cua HOM NAY, khong thay xu huong qua cac ngay).

    Tra ve list [{date, posts, comments, inbox}] sap xep tang dan theo ngay,
    du ca ngay khong co du lieu (gia tri 0) de FE ve bieu do lien mach.
    """
    sb = _supabase()
    now_vn = datetime.now(timezone.utc) + timedelta(hours=7)
    today = now_vn.date()
    start_day = today - timedelta(days=days - 1)

    allowed_member_ids = _resolve_member_scope(sb, email)

    # Khung ngay rong truoc, dien du lieu that vao sau - dam bao bieu do lien tuc
    buckets: dict[str, dict[str, int]] = {}
    d = start_day
    while d <= today:
        buckets[d.isoformat()] = {"posts": 0, "comments": 0, "inbox": 0}
        d += timedelta(days=1)

    tables = ["facebook_posts", "linkedin_posts"] if platform in ("all", "general") else (
        ["facebook_posts"] if platform == "facebook" else
        ["linkedin_posts"] if platform == "linkedin" else
        ["facebook_posts", "linkedin_posts"]
    )

    # 1) Posts theo ngay (crawl_date)
    for table in tables:
        query = sb.table(table).select("id, crawl_date").gte(
            "crawl_date", f"{start_day.isoformat()}T00:00:00Z"
        ).lte("crawl_date", f"{today.isoformat()}T23:59:59Z")
        if table == "facebook_posts" and allowed_member_ids is not None:
            query = query.in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"])
        elif table == "linkedin_posts" and allowed_member_ids is not None:
            gq = sb.table("linkedin_groups").select("id").in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"]).execute()
            group_ids = [r.get("id") for r in (gq.data or []) if r.get("id")]
            query = query.in_("id_group", group_ids or ["00000000-0000-0000-0000-000000000000"])
        try:
            rows = query.execute().data or []
        except Exception:
            rows = []
        for row in rows:
            day_key = _parse_date(row.get("crawl_date"))
            if day_key in buckets:
                buckets[day_key]["posts"] += 1

    # 2) Comment/seeding da verify theo ngay (current_day)
    try:
        c_query = sb.table("seeding_content_kpi").select("current_day, verify").gte(
            "current_day", start_day.isoformat()
        ).lte("current_day", today.isoformat())
        if allowed_member_ids is not None:
            c_query = c_query.in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"])
        c_rows = c_query.execute().data or []
    except Exception:
        c_rows = []
    for row in c_rows:
        if row.get("verify") not in ("yes", "đã seeding", "xác minh", "verified"):
            continue
        day_key = _parse_date(row.get("current_day"))
        if day_key in buckets:
            buckets[day_key]["comments"] += 1

    # 3) Inbox FB theo ngay (view co san v_member_daily_fb_inbox, da gop san
    #    theo id_member + day_vn - chi can loc scope + cong don theo ngay)
    try:
        i_query = sb.table("v_member_daily_fb_inbox").select("day_vn, inbox_count, id_member").gte(
            "day_vn", start_day.isoformat()
        ).lte("day_vn", today.isoformat())
        if allowed_member_ids is not None:
            i_query = i_query.in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"])
        i_rows = i_query.execute().data or []
    except Exception:
        i_rows = []
    for row in i_rows:
        day_key = _parse_date(row.get("day_vn"))
        if day_key in buckets:
            buckets[day_key]["inbox"] += int(row.get("inbox_count") or 0)

    return [
        {"date": day, "posts": v["posts"], "comments": v["comments"], "inbox": v["inbox"]}
        for day, v in sorted(buckets.items())
    ]

_LIVE_RECORDED_ROUNDS: list[dict[str, Any]] = []


def record_crawl_schedule_round(payload: dict[str, Any]) -> dict[str, Any]:
    """Ghi nhận tức thời kết quả vòng cào từ Extension hoặc Worker khi hoàn tất."""
    global _LIVE_RECORDED_ROUNDS
    import uuid as _uuid
    round_id = payload.get("id") or f"live-round-{str(_uuid.uuid4())[:8]}"
    round_entry = {
        "id": round_id,
        "round_number": payload.get("round_number", 1),
        "round_label": f"Vòng #{payload.get('round_number', 1)}",
        "schedule_id": payload.get("schedule_id"),
        "schedule_label": payload.get("schedule_label") or "Lịch cào xoay vòng đa nền tảng",
        "user_id": payload.get("user_id") or payload.get("id_member"),
        "user_email": payload.get("user_email") or "",
        "user_name": payload.get("user_name") or "Thành viên",
        "is_system": bool(payload.get("is_system", False)),
        "started_at": payload.get("started_at"),
        "finished_at": payload.get("finished_at"),
        "started_at_formatted": payload.get("started_at_formatted") or "",
        "duration_seconds": payload.get("duration_seconds", 0),
        "duration_formatted": payload.get("duration_formatted") or "45 giây",
        "status": payload.get("status", "done"),
        "facebook": payload.get("facebook") or {"posts_count": 0, "ai_passed_count": 0, "ai_pass_rate": 0.0},
        "linkedin": payload.get("linkedin") or {"posts_count": 0, "ai_passed_count": 0, "ai_pass_rate": 0.0},
        "threads": payload.get("threads") or {"posts_count": 0, "ai_passed_count": 0, "ai_pass_rate": 0.0},
        "total_posts": payload.get("total_posts", 0),
        "total_ai_passed": payload.get("total_ai_passed", 0),
        "ai_pass_rate": payload.get("ai_pass_rate", 0.0),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _LIVE_RECORDED_ROUNDS.insert(0, round_entry)
    if len(_LIVE_RECORDED_ROUNDS) > 200:
        _LIVE_RECORDED_ROUNDS = _LIVE_RECORDED_ROUNDS[:200]
    return {"success": True, "round": round_entry}


def get_crawl_schedule_rounds_history(
    email: Optional[str] = None,
    id_member: Optional[str] = None,
    time_range: str = "all",
    limit: int = 50,
) -> dict[str, Any]:
    """Bóc tách và thống kê chi tiết các vòng cào từ lịch theo từng user riêng biệt và accsystem crawler."""
    from collections import defaultdict
    sb = _supabase()
    ai_threshold = 40
    crawler_system_id = "4a15e851-580c-440e-bcf0-a4363a54170f"

    # 1. Danh sách user & tài khoản crawler
    users_data = sb.table("app_users").select("id, name, email").execute().data or []
    user_map = {u["id"]: u for u in users_data}

    user_map[SEEDING_SYSTEM_MEMBER_ID] = {
        "id": SEEDING_SYSTEM_MEMBER_ID,
        "name": "Hệ thống (VPS Crawler)",
        "email": "seedingsystem@markeeai.com",
        "is_system": True,
    }
    user_map[crawler_system_id] = {
        "id": crawler_system_id,
        "name": "Seeding Crawler System",
        "email": "seeding.crawler@markeeai.com",
        "is_system": True,
    }

    members_list = [
        {"id": "all", "name": "Tất cả tài khoản & Hệ thống", "email": "all@system", "is_system": False},
        {"id": SEEDING_SYSTEM_MEMBER_ID, "name": "Hệ thống (VPS Crawler)", "email": "seedingsystem@markeeai.com", "is_system": True},
        {"id": crawler_system_id, "name": "Seeding Crawler System", "email": "seeding.crawler@markeeai.com", "is_system": True},
    ]
    for u in users_data:
        if u["id"] not in (SEEDING_SYSTEM_MEMBER_ID, crawler_system_id):
            members_list.append({
                "id": u["id"],
                "name": u.get("name") or u.get("email") or "Thành viên",
                "email": u.get("email") or "",
                "is_system": False,
            })

    # Lọc thời gian
    now_vn = datetime.now(timezone(timedelta(hours=7)))
    date_from = None
    if time_range == "today":
        date_from = now_vn.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    elif time_range == "this_week":
        start_week = now_vn - timedelta(days=now_vn.weekday())
        date_from = start_week.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    elif time_range == "this_month":
        date_from = now_vn.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    # 2. Truy vấn bài viết từ 3 nền tảng
    q_fb = sb.table("facebook_posts").select("id, id_member, score, crawl_date, created_at, group_id")
    q_th = sb.table("threads_posts").select("id, id_member, score, crawl_date, created_at, keyword")
    q_li = sb.table("linkedin_posts").select("id, id_member, score, crawl_date, created_at, id_group, session_id")

    if id_member and id_member != "all":
        q_fb = q_fb.eq("id_member", id_member)
        q_th = q_th.eq("id_member", id_member)
        q_li = q_li.eq("id_member", id_member)

    if date_from:
        iso_from = date_from.isoformat()
        q_fb = q_fb.gte("created_at", iso_from)
        q_th = q_th.gte("created_at", iso_from)
        q_li = q_li.gte("created_at", iso_from)

    fb_data = q_fb.order("created_at", desc=True).limit(600).execute().data or []
    th_data = q_th.order("created_at", desc=True).limit(600).execute().data or []
    li_data = q_li.order("created_at", desc=True).limit(300).execute().data or []

    def _parse_ts(dt_val: Any) -> Optional[datetime]:
        if not dt_val:
            return None
        try:
            s = str(dt_val).replace("Z", "+00:00")
            return datetime.fromisoformat(s)
        except Exception:
            return None

    def _format_dur(sec: int) -> str:
        if sec <= 0:
            return "< 1 phút"
        m = int(sec // 60)
        s = int(sec % 60)
        h = int(m // 60)
        m = int(m % 60)
        if h > 0:
            return f"{h} giờ {m} phút"
        if m > 0:
            return f"{m} phút {s} giây" if s > 0 else f"{m} phút"
        return f"{s} giây"

    all_posts = []
    for p in fb_data:
        m_id = p.get("id_member") or SEEDING_SYSTEM_MEMBER_ID
        dt = _parse_ts(p.get("created_at") or p.get("crawl_date"))
        if dt:
            all_posts.append({
                "platform": "facebook",
                "id": p["id"],
                "member_id": m_id,
                "score": p.get("score") or 0,
                "created_at": dt,
            })
    for p in th_data:
        m_id = p.get("id_member") or SEEDING_SYSTEM_MEMBER_ID
        dt = _parse_ts(p.get("created_at") or p.get("crawl_date"))
        if dt:
            all_posts.append({
                "platform": "threads",
                "id": p["id"],
                "member_id": m_id,
                "score": p.get("score") or 0,
                "created_at": dt,
            })
    for p in li_data:
        m_id = p.get("id_member") or SEEDING_SYSTEM_MEMBER_ID
        dt = _parse_ts(p.get("created_at") or p.get("crawl_date"))
        if dt:
            all_posts.append({
                "platform": "linkedin",
                "id": p["id"],
                "member_id": m_id,
                "score": p.get("score") or 0,
                "created_at": dt,
            })

    all_posts.sort(key=lambda x: x["created_at"], reverse=True)

    by_member = defaultdict(list)
    for p in all_posts:
        by_member[p["member_id"]].append(p)

    generated_rounds = []
    for mid, m_posts in by_member.items():
        user_info = user_map.get(mid, {
            "id": mid,
            "name": "Thành viên" if mid not in (SEEDING_SYSTEM_MEMBER_ID, crawler_system_id) else "Hệ thống (VPS Crawler)",
            "email": "",
            "is_system": mid in (SEEDING_SYSTEM_MEMBER_ID, crawler_system_id),
        })
        is_sys = mid in (SEEDING_SYSTEM_MEMBER_ID, crawler_system_id)

        clusters = []
        cur = []
        for post in m_posts:
            if not cur:
                cur.append(post)
            else:
                prev_time = cur[-1]["created_at"]
                diff = (prev_time - post["created_at"]).total_seconds()
                if diff <= 45 * 60:
                    cur.append(post)
                else:
                    clusters.append(cur)
                    cur = [post]
        if cur:
            clusters.append(cur)

        for idx, cluster in enumerate(clusters):
            start = min(p["created_at"] for p in cluster)
            end = max(p["created_at"] for p in cluster)
            dur_sec = max(45, int((end - start).total_seconds()))

            fb_items = [p for p in cluster if p["platform"] == "facebook"]
            fb_cnt = len(fb_items)
            fb_ai = sum(1 for p in fb_items if p["score"] >= ai_threshold)

            li_items = [p for p in cluster if p["platform"] == "linkedin"]
            li_cnt = len(li_items)
            li_ai = sum(1 for p in li_items if p["score"] >= ai_threshold)

            th_items = [p for p in cluster if p["platform"] == "threads"]
            th_cnt = len(th_items)
            th_ai = sum(1 for p in th_items if p["score"] >= ai_threshold)

            tot_posts = fb_cnt + li_cnt + th_cnt
            tot_ai = fb_ai + li_ai + th_ai
            pass_rate = round((tot_ai / tot_posts * 100), 1) if tot_posts > 0 else 0.0

            vn_time = start.astimezone(timezone(timedelta(hours=7)))
            time_formatted = vn_time.strftime("%H:%M %d/%m/%Y")

            round_num = len(clusters) - idx
            generated_rounds.append({
                "id": f"round-{mid[:8]}-{int(start.timestamp())}",
                "round_number": round_num,
                "round_label": f"Vòng #{round_num}",
                "schedule_label": "Lịch cào xoay vòng đa nền tảng" if not is_sys else "Cào tự động Hệ thống VPS",
                "user_id": mid,
                "user_name": user_info.get("name") or "Thành viên",
                "user_email": user_info.get("email") or "",
                "is_system": is_sys,
                "started_at": start.isoformat(),
                "finished_at": end.isoformat(),
                "started_at_formatted": time_formatted,
                "duration_seconds": dur_sec,
                "duration_formatted": _format_dur(dur_sec),
                "status": "done",
                "facebook": {
                    "posts_count": fb_cnt,
                    "ai_passed_count": fb_ai,
                    "ai_pass_rate": round((fb_ai / fb_cnt * 100), 1) if fb_cnt > 0 else 0.0,
                },
                "linkedin": {
                    "posts_count": li_cnt,
                    "ai_passed_count": li_ai,
                    "ai_pass_rate": round((li_ai / li_cnt * 100), 1) if li_cnt > 0 else 0.0,
                },
                "threads": {
                    "posts_count": th_cnt,
                    "ai_passed_count": th_ai,
                    "ai_pass_rate": round((th_ai / th_cnt * 100), 1) if th_cnt > 0 else 0.0,
                },
                "total_posts": tot_posts,
                "total_ai_passed": tot_ai,
                "ai_pass_rate": pass_rate,
            })

    # Gộp các vòng cào chạy realtime gần nhất
    for lr in _LIVE_RECORDED_ROUNDS:
        if id_member and id_member != "all":
            if lr.get("user_id") != id_member:
                continue
        generated_rounds.append(lr)

    generated_rounds.sort(key=lambda x: x["started_at"], reverse=True)

    summary = {
        "total_rounds": len(generated_rounds),
        "total_posts": sum(r["total_posts"] for r in generated_rounds),
        "total_ai_passed": sum(r["total_ai_passed"] for r in generated_rounds),
        "facebook_total": sum(r["facebook"]["posts_count"] for r in generated_rounds),
        "linkedin_total": sum(r["linkedin"]["posts_count"] for r in generated_rounds),
        "threads_total": sum(r["threads"]["posts_count"] for r in generated_rounds),
        "overall_ai_pass_rate": (
            round(sum(r["total_ai_passed"] for r in generated_rounds) / sum(r["total_posts"] for r in generated_rounds) * 100, 1)
            if generated_rounds and sum(r["total_posts"] for r in generated_rounds) > 0
            else 0.0
        ),
    }

    return {
        "members": members_list,
        "rounds": generated_rounds[:limit],
        "summary": summary,
    }

