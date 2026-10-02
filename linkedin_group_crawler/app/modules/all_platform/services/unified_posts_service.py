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


# Acc seeding hệ thống (VPS, cào xoay vòng): bài do acc này cào về phải hiển thị cho
# TẤT CẢ mọi người (kể cả member) để ai cũng tiến hành seeding được, không bị giới hạn
# theo RBAC thường (member chỉ thấy bài của chính mình). Đây là bypass CÓ PHẠM VI hẹp —
# chỉ thêm đúng 1 id vào danh sách allowed_member_ids, không gỡ bỏ RBAC chung.
SEEDING_SYSTEM_MEMBER_ID = "2edc819a-5c22-445a-8067-39656316f31c"


def _with_seeding_system_visible(allowed_member_ids: Optional[list[str]]) -> Optional[list[str]]:
    if allowed_member_ids is None:
        return None
    if SEEDING_SYSTEM_MEMBER_ID in allowed_member_ids:
        return allowed_member_ids
    return [*allowed_member_ids, SEEDING_SYSTEM_MEMBER_ID]


# Nguong diem "cao" cho view mac dinh khi vao trang (yeu cau 2026-10-02: "diem cao tam 80
# 85 tro len") - dung 80 lam nguong duy nhat (dau duoi khoang nguoi dung neu).
_DEFAULT_MIN_LEAD_SCORE = 80


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
    if table == "threads_posts":
        return _fetch_threads_posts(
            email=email,
            date_from=date_from,
            date_to=date_to,
            has_taxonomy_filter=bool(intent or industry or team or tier is not None or icp or content_type or product_seeding),
            id_member=id_member,
            search=search,
            sort=sort,
            page=page,
            page_size=page_size,
        )

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

    # Resolve taxonomy filters via groups table
    group_ids: list[str] | None = None

    # Bài viết là tài nguyên dùng chung để seeding — AI CÀO cũng hiển thị cho TẤT CẢ mọi
    # người xem và tiến hành seeding (yêu cầu 2026-10-01), không còn giới hạn theo
    # người cào/role nữa (trước đó có resolve role qua email ở đây, đã bỏ vì không còn
    # dùng). allowed_member_ids chỉ còn thu hẹp khi FE chủ động truyền id_member cụ thể
    # (vd lọc "chỉ xem bài của 1 member" ở khối ngay dưới đây).
    allowed_member_ids: list[str] | None = None

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
    if sort == "lead_score_high":
        # Mac dinh khi vao trang (yeu cau 2026-10-02): CHI hien bai diem cao (>=80) -
        # bai diem thap/chua cham bi loai hoan toan khoi view nay - roi sap xep theo
        # THOI GIAN bai viet moi nhat truoc (khong phai theo diem).
        query = query.gte("lead_score", _DEFAULT_MIN_LEAD_SCORE).order("crawl_date", desc=True, nullsfirst=False)
    elif sort == "score_high":
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

    if table == "facebook_posts":
        _attach_auto_seeding_comments(sb, posts)

    return posts, total


def _attach_auto_seeding_comments(sb, posts: list[dict]) -> None:
    """Gắn `auto_seeding_comment` (nội dung + trạng thái) cho mỗi bài FB đã có nhiệm vụ
    seeding tự động (bảng auto_seeding_comments, migration 160) - để FE hiển thị ngay trên
    card bài viết, trông như 1 bình luận thật của member nhưng ghi rõ "Hệ thống:" (yêu cầu
    2026-10-02). Chỉ 1 trang (page_size nhỏ, vài chục id) nên .in_() an toàn - vẫn bọc
    try/except, lỗi ở đây KHÔNG được làm hỏng việc hiển thị bài viết (bài học từ bug 502
    .in_() quá dài ở _attach_group_lead_stats)."""
    post_ids = [p["id"] for p in posts if p.get("id")]
    if not post_ids:
        return
    try:
        res = (
            sb.table("auto_seeding_comments")
            .select(
                "id_post_fb, comment_content, status, posted_at, link_comment, need_category, "
                "phone_number, zalo_status, zalo_message_content, zalo_sent_at"
            )
            .in_("id_post_fb", post_ids)
            .execute()
        )
        by_post = {r["id_post_fb"]: r for r in (res.data or []) if r.get("id_post_fb")}
    except Exception as e:
        _get_logger().warning(f"[AUTO-SEEDING-COMMENT] Lỗi lấy bình luận auto-seeding cho feed, bỏ qua: {e}")
        return
    for p in posts:
        row = by_post.get(p.get("id"))
        if row:
            p["auto_seeding_comment"] = {
                "content": row.get("comment_content"),
                "status": row.get("status"),
                "posted_at": row.get("posted_at"),
                "link_comment": row.get("link_comment"),
                "need_category": row.get("need_category"),
                "phone_number": row.get("phone_number"),
                "zalo_status": row.get("zalo_status"),
                "zalo_message_content": row.get("zalo_message_content"),
                "zalo_sent_at": row.get("zalo_sent_at"),
            }


def _fetch_threads_posts(
    *,
    email: str,
    date_from: Optional[str],
    date_to: Optional[str],
    has_taxonomy_filter: bool,
    id_member: Optional[str],
    search: Optional[str],
    sort: str,
    page: int,
    page_size: int,
) -> tuple[list[dict], int]:
    """Bài Threads (bảng threads_posts, cào qua "Markee Seeding Extension", lệnh MK_TH_CRAWL_*).

    Threads không có group -> không có taxonomy (intent/industry/team...): khi FE lọc
    theo taxonomy thì không bài Threads nào khớp -> trả rỗng (không lờ bộ lọc đi).
    Phân quyền giống facebook_posts: lọc theo id_member (người bấm cào).
    """
    if has_taxonomy_filter:
        return [], 0

    sb = _supabase()
    # Bài viết dùng chung để seeding - AI CÀO cũng hiển thị cho TẤT CẢ mọi người (giống
    # facebook_posts/linkedin_posts ở _fetch_posts() phía trên) - không dùng
    # _resolve_member_scope() nữa ở đây (hàm đó vẫn giữ nguyên, dùng cho dashboard
    # xu hướng/overview của admin-leader, nơi phân quyền theo team vẫn còn ý nghĩa).
    allowed_member_ids = None
    if id_member:
        if allowed_member_ids is None or id_member in allowed_member_ids:
            allowed_member_ids = [id_member]
        else:
            allowed_member_ids = ["00000000-0000-0000-0000-000000000000"]

    query = sb.table("threads_posts").select("*", count="exact")
    if allowed_member_ids is not None:
        query = query.in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"])
    if date_from:
        query = query.gte("crawl_date", date_from)
    if date_to:
        query = query.lte("crawl_date", date_to)
    if search:
        query = query.ilike("content", f"%{search}%")

    if sort == "lead_score_high":
        query = query.gte("lead_score", _DEFAULT_MIN_LEAD_SCORE).order("crawl_date", desc=True, nullsfirst=False)
    elif sort == "score_high":
        query = query.order("score", desc=True, nullsfirst=False)
    elif sort == "score_low":
        query = query.order("score", desc=False, nullsfirst=False)
    elif sort == "comments_high":
        query = query.order("comments", desc=True, nullsfirst=False)
    elif sort == "crawler":
        query = query.order("id_member", desc=False, nullsfirst=False)
    else:  # latest
        query = query.order("crawl_date", desc=True, nullsfirst=False)

    offset = (page - 1) * page_size
    result = query.range(offset, offset + page_size - 1).execute()
    posts = result.data or []
    total = result.count or len(posts)
    if not posts:
        return posts, total

    member_ids = list({p["id_member"] for p in posts if p.get("id_member")})
    member_map: dict[str, dict] = {}
    if member_ids:
        mres = sb.table("app_users").select("id, name").in_("id", member_ids).execute()
        for m in (mres.data or []):
            member_map[m["id"]] = {"name": m.get("name") or "Unknown"}
        mot_res = sb.table("member_of_teams").select("id_member, id_teams").in_("id_member", member_ids).execute()
        team_ids = {m["id_teams"] for m in (mot_res.data or []) if m.get("id_teams")}
        if team_ids:
            team_res = sb.table("teams").select("id, name_team").in_("id", list(team_ids)).execute()
            team_dict = {t["id"]: t["name_team"] for t in (team_res.data or [])}
            for mot in (mot_res.data or []):
                mid, tid = mot.get("id_member"), mot.get("id_teams")
                if mid in member_map and tid in team_dict:
                    member_map[mid]["team_name"] = team_dict[tid]

    for p in posts:
        username = p.get("author_username") or ""
        # PostCard hiển thị group_name ở đầu thẻ — với Threads dùng @tác giả, kèm từ
        # khoá đã tìm ra bài để người seeding biết bài đến từ đâu.
        p["group_name"] = f"@{username}" if username else "Threads"
        p["group_url"] = p.get("author_url") or ""
        p["search_keyword"] = p.get("keyword") or ""
        p["author"] = p.get("author_name") or username
        mid = p.get("id_member")
        if mid and mid in member_map:
            p["crawler_name"] = member_map[mid].get("name")
            p["crawler_team"] = member_map[mid].get("team_name")

    return posts, total


def _get_threads_platform_id(sb: Client) -> Optional[int]:
    """id của Threads trong bảng platforms (seeding_content_kpi/kpi_tracker dùng id_platform).

    Không hardcode như Facebook=1/LinkedIn=2 vì không chắc DB đã có dòng Threads và id
    là bao nhiêu — None nghĩa là chưa có -> các số liệu seeding/KPI Threads = 0.
    """
    try:
        res = sb.table("platforms").select("id, name").ilike("name", "%threads%").limit(1).execute()
        if res.data:
            return res.data[0]["id"]
    except Exception:
        pass
    return None


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
        elif platform == "threads":
            threads_id = _get_threads_platform_id(sb)
            if threads_id is None:
                return 0
            query = query.eq("id_platform", threads_id)

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
        target_platform_id = _get_threads_platform_id(sb) if platform == "threads" else (1 if platform == "facebook" else 2)
        if target_platform_id is None:
            return 0, 0
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

    # Resolve current user's own id — vẫn cần cho _seeded_today()/_kpi_progress() phía
    # dưới (KPI CÁ NHÂN, luôn tính theo đúng người đang xem, không đổi). Phần đếm bài
    # tổng (totalPostsToday/totalPosts/...) thì KHÔNG còn giới hạn theo role nữa — bài
    # viết dùng chung để seeding, ai cào cũng hiển thị cho tất cả mọi người (2026-10-01).
    user_id_fetch = None
    if email:
        user_res = sb.table("app_users").select("id").eq("email", email.strip().lower()).limit(1).execute()
        if user_res.data:
            user_id_fetch = user_res.data[0]["id"]

    allowed_member_ids: list[str] | None = None

    group_ids = None
    if table == "linkedin_posts" and allowed_member_ids is not None:
        gq = sb.table("linkedin_groups").select("id").in_("id_member", allowed_member_ids).execute()
        group_ids = [r.get("id") for r in (gq.data or []) if r.get("id")]
    
    def apply_scope(query):
        if table == "linkedin_posts" and allowed_member_ids is not None:
            return query.in_("id_group", group_ids or ["00000000-0000-0000-0000-000000000000"])
        if table in ("facebook_posts", "threads_posts") and allowed_member_ids is not None:
            return query.in_("id_member", allowed_member_ids)
        return query

    # id_member da resolve o buoc 1 (user_id_fetch) - khong query lai app_users lan 2
    # cho cung 1 email trong cung 1 ham (tung la 1 round-trip Supabase thua thai).
    id_member = user_id_fetch
    platform_name = {"facebook_posts": "facebook", "threads_posts": "threads"}.get(table, "linkedin")

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
    elif platform == "threads":
        platforms_to_fetch = ["threads_posts"]
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
        if sort == "lead_score_high":
            # Loc >=80 da ap dung o tung _fetch_posts()/_fetch_threads_posts() phia tren
            # (truyen qua db_sort) - o day chi can gop lai va sap theo THOI GIAN moi nhat.
            all_posts.sort(key=lambda p: str(p.get("crawl_date") or ""), reverse=True)
        elif sort == "score_high":
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
    if p == "threads":
        return ["threads_posts"]
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
    elif platform == "threads":
        tables = ["threads_posts"]
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
        return _with_seeding_system_visible(allowed)
    return _with_seeding_system_visible([user_id])


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
        ["threads_posts"] if platform == "threads" else
        ["facebook_posts", "linkedin_posts"]
    )

    # 1) Posts theo ngay (crawl_date)
    for table in tables:
        query = sb.table(table).select("id, crawl_date").gte(
            "crawl_date", f"{start_day.isoformat()}T00:00:00Z"
        ).lte("crawl_date", f"{today.isoformat()}T23:59:59Z")
        if table in ("facebook_posts", "threads_posts") and allowed_member_ids is not None:
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

    # Tab Threads: comment chi tinh seeding tren Threads (id_platform cua Threads),
    # inbox luon 0 (view inbox chi co Facebook) - tranh hien so lieu cua Facebook
    # duoi tab Threads. Facebook/LinkedIn giu nguyen hanh vi cu.
    is_threads = platform == "threads"
    threads_platform_id = _get_threads_platform_id(sb) if is_threads else None

    # 2) Comment/seeding da verify theo ngay (current_day)
    try:
        if is_threads and threads_platform_id is None:
            c_rows = []
        else:
            c_query = sb.table("seeding_content_kpi").select("current_day, verify").gte(
                "current_day", start_day.isoformat()
            ).lte("current_day", today.isoformat())
            if allowed_member_ids is not None:
                c_query = c_query.in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"])
            if is_threads:
                c_query = c_query.eq("id_platform", threads_platform_id)
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
    i_rows = []
    if not is_threads:
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


def get_post_seeding_roster(post_id: str, platform: str, email: str) -> dict:
    """Toàn bộ roster thành viên của team sở hữu group chứa bài viết này, kèm
    trạng thái/nội dung đã seeding (nếu có) — cho modal "Xem seeding theo team"
    ở trang Seeding bên ngoài (admin/leader). Khác get_post_interactions bên
    module internal_engagement: bài ở đây KHÔNG có khái niệm "giao theo team"
    (assigned_team_ids) — team roster được suy ra từ facebook_groups/
    linkedin_groups.id_team (team sở hữu nhóm crawl), giống hệt cách team/
    allowed_member_ids đã được tính trong _fetch_posts_from_table() ở trên.
    """
    sb = _supabase()

    user_res = sb.table("app_users").select("id, role").eq("email", (email or "").strip().lower()).limit(1).execute()
    if not user_res.data:
        return {"role": "member", "team_name": None, "items": []}
    caller_id = user_res.data[0]["id"]
    role = user_res.data[0].get("role", "member")
    if role not in ("admin", "leader"):
        return {"role": role, "team_name": None, "items": []}
    # Bài Threads không thuộc group nào -> không suy ra được team sở hữu (FE ẩn nút này
    # với bài Threads); trả rỗng thay vì tra nhầm sang bảng linkedin_posts ở dưới.
    if platform == "threads":
        return {"role": role, "team_name": None, "items": []}

    table = "facebook_posts" if platform == "facebook" else "linkedin_posts"
    group_fk = "facebook_groups" if platform == "facebook" else "linkedin_groups"

    post_res = (
        sb.table(table).select(f"id, {group_fk}(id_team, group_name)").eq("id", post_id).limit(1).execute()
    )
    if not post_res.data:
        return {"role": role, "team_name": None, "items": []}
    grp = post_res.data[0].get(group_fk) or {}
    id_team = grp.get("id_team")
    if not id_team:
        return {"role": role, "team_name": None, "items": []}

    if role == "leader":
        leader_teams = sb.table("teams").select("id").eq("id_leader", caller_id).execute().data or []
        if id_team not in {t["id"] for t in leader_teams}:
            return {"role": role, "team_name": None, "items": []}

    team_res = sb.table("teams").select("id, name_team").eq("id", id_team).limit(1).execute()
    team_name = team_res.data[0].get("name_team") if team_res.data else "Team"

    mot_res = sb.table("member_of_teams").select("id_member").eq("id_teams", id_team).execute().data or []
    member_ids = list({m["id_member"] for m in mot_res if m.get("id_member")})
    if not member_ids:
        return {"role": role, "team_name": team_name, "items": []}

    users_res = sb.table("app_users").select("id, name, email").in_("id", member_ids).execute().data or []
    user_map = {u["id"]: u for u in users_res}

    kpi_res = (
        sb.table("seeding_content_kpi")
        .select("id_member, content, verify, link_comment, created_at")
        .eq("id_post", post_id)
        .in_("id_member", member_ids)
        .order("created_at", desc=True)
        .execute()
    ).data or []
    kpi_by_member: dict[str, dict] = {}
    for row in kpi_res:
        mid = row.get("id_member")
        if mid and mid not in kpi_by_member:
            kpi_by_member[mid] = row

    items = []
    for mid in member_ids:
        u = user_map.get(mid, {})
        kpi = kpi_by_member.get(mid)
        name = u.get("name") or (u.get("email") or "").split("@")[0] or "Thành viên ẩn"
        items.append({
            "id_member": mid,
            "name": name,
            "has_seeded": bool(kpi),
            "content": (kpi or {}).get("content") or "",
            "verify_status": (kpi or {}).get("verify"),
            "link_comment": (kpi or {}).get("link_comment"),
            "created_at": (kpi or {}).get("created_at"),
        })

    items.sort(key=lambda it: (0 if it["has_seeded"] else 1, it["name"]))
    return {"role": role, "team_name": team_name, "items": items}


def get_teams_seeding_efficiency(email: str) -> dict:
    """"Hiệu quả theo team" cho Dashboard leader (Seeding bên ngoài) — cho admin thấy
    TẤT CẢ team, leader chỉ thấy team mình quản lý. Không cần RPC/migration mới: viết
    bằng supabase-py giống hệt pattern get_post_seeding_roster() ở trên (join thủ công
    thay vì SQL join phức tạp), chỉ đọc `seeding_content_kpi` của HÔM NAY (giờ VN)
    giống cách RPC get_unified_feed_overview tính team_kpi cho leader.
    """
    sb = _supabase()

    user_res = sb.table("app_users").select("id, role").eq("email", (email or "").strip().lower()).limit(1).execute()
    if not user_res.data:
        return {"role": "member", "teams": []}
    caller_id = user_res.data[0]["id"]
    role = user_res.data[0].get("role", "member")
    if role not in ("admin", "leader"):
        return {"role": role, "teams": []}

    if role == "leader":
        teams_res = sb.table("teams").select("id, name_team").eq("id_leader", caller_id).execute()
    else:
        teams_res = sb.table("teams").select("id, name_team").execute()
    teams = teams_res.data or []
    if not teams:
        return {"role": role, "teams": []}
    team_ids = [t["id"] for t in teams]

    mot_res = sb.table("member_of_teams").select("id_member, id_teams").in_("id_teams", team_ids).execute()
    member_to_team: dict[str, str] = {}
    team_member_count: dict[str, int] = {}
    for row in mot_res.data or []:
        mid, tid = row.get("id_member"), row.get("id_teams")
        if not mid or not tid:
            continue
        member_to_team[mid] = tid
        team_member_count[tid] = team_member_count.get(tid, 0) + 1

    member_ids = list(member_to_team.keys())
    vn_tz = timezone(timedelta(hours=7))
    today_start_utc = datetime.now(vn_tz).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    kpi_rows: list[dict] = []
    if member_ids:
        kpi_res = (
            sb.table("seeding_content_kpi")
            .select("id_member, id_post, verify, created_at")
            .in_("id_member", member_ids)
            .gte("created_at", today_start_utc.isoformat())
            .execute()
        )
        kpi_rows = kpi_res.data or []

    VERIFIED = {"yes", "đã seeding", "xác minh", "verified"}
    team_seeded_posts: dict[str, set] = {t["id"]: set() for t in teams}
    team_verified_count: dict[str, int] = {t["id"]: 0 for t in teams}
    team_active_members: dict[str, set] = {t["id"]: set() for t in teams}
    for row in kpi_rows:
        tid = member_to_team.get(row.get("id_member"))
        if not tid or tid not in team_seeded_posts:
            continue
        team_active_members[tid].add(row["id_member"])
        is_verified = (row.get("verify") or "").strip().lower() in VERIFIED
        if is_verified:
            team_verified_count[tid] += 1
            if row.get("id_post"):
                team_seeded_posts[tid].add(row["id_post"])

    result_teams = []
    for t in teams:
        tid = t["id"]
        verified = team_verified_count.get(tid, 0)
        seeded_posts = len(team_seeded_posts.get(tid, set()))
        members = team_member_count.get(tid, 0)
        result_teams.append({
            "team_id": tid,
            "team_name": t.get("name_team") or "Team",
            "total_members": members,
            "total_seeded_today": seeded_posts,
            "total_verified_today": verified,
            "active_members_today": len(team_active_members.get(tid, set())),
        })

    result_teams.sort(key=lambda x: x["total_verified_today"], reverse=True)
    return {"role": role, "teams": result_teams}


def _resolve_overview_scope(sb, email: str) -> tuple[str, list[dict]]:
    """Dùng chung cho get_member_seeding_overview/get_member_crawl_history — admin thấy
    mọi thành viên active, leader chỉ thấy team mình quản lý (+ chính mình)."""
    user_res = sb.table("app_users").select("id, role").eq("email", (email or "").strip().lower()).limit(1).execute()
    if not user_res.data:
        return "member", []
    caller_id = user_res.data[0]["id"]
    role = user_res.data[0].get("role", "member")
    if role not in ("admin", "leader"):
        return role, []
    if role == "admin":
        members = sb.table("app_users").select("id, name, email").eq("is_active", True).execute().data or []
        return role, members
    teams_res = sb.table("teams").select("id").eq("id_leader", caller_id).execute()
    team_ids = [t["id"] for t in (teams_res.data or [])]
    member_ids_set = {caller_id}
    if team_ids:
        mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
        member_ids_set.update(m["id_member"] for m in (mot_res.data or []) if m.get("id_member"))
    members = sb.table("app_users").select("id, name, email").in_("id", list(member_ids_set)).execute().data or []
    return role, members


def get_member_seeding_overview(email: str) -> dict:
    """Tab phụ "Tài khoản seeding" (Lịch crawl & Hàng đợi) — bảng tổng quan theo từng
    thành viên: số nhóm Facebook/LinkedIn đang sở hữu, đã kết nối Telegram Chat chưa,
    tổng số bài đã cào (Facebook — xem ghi chú bên dưới) + lần cào gần nhất. RBAC giống
    get_teams_seeding_efficiency: admin thấy toàn bộ, leader chỉ thấy team mình quản lý,
    member không thấy gì (dùng cho quản lý, không phải trang cá nhân của member).
    """
    sb = _supabase()
    role, members = _resolve_overview_scope(sb, email)
    if role not in ("admin", "leader") or not members:
        return {"role": role, "accounts": []}

    member_ids = [m["id"] for m in members]
    fb_groups = sb.table("facebook_groups").select("id, id_member").in_("id_member", member_ids).execute().data or []
    li_groups = sb.table("linkedin_groups").select("id, id_member").in_("id_member", member_ids).execute().data or []
    tg_accounts = (
        sb.table("telegram_accounts")
        .select("id_member")
        .in_("id_member", member_ids)
        .eq("status", "connected")
        .execute()
        .data
        or []
    )
    # facebook_posts.id_member co truc tiep tren bang; linkedin_posts KHONG co (phai
    # join qua linkedin_groups.id_member) - gioi han "lich su cao"/"tong bai cao" o day
    # trong Facebook de tranh 1 vong join N+1 phuc tap, van du de biet ai dang thuc su
    # cao (extension FB la kenh cao chinh cua tab nay).
    fb_posts = (
        sb.table("facebook_posts")
        .select("id_member, crawl_date")
        .in_("id_member", member_ids)
        .order("crawl_date", desc=True)
        .limit(5000)
        .execute()
        .data
        or []
    )

    fb_group_count: dict[str, int] = {}
    for g in fb_groups:
        mid = g.get("id_member")
        if mid:
            fb_group_count[mid] = fb_group_count.get(mid, 0) + 1
    li_group_count: dict[str, int] = {}
    for g in li_groups:
        mid = g.get("id_member")
        if mid:
            li_group_count[mid] = li_group_count.get(mid, 0) + 1
    tg_connected = {a["id_member"] for a in tg_accounts if a.get("id_member")}
    post_count: dict[str, int] = {}
    last_crawled: dict[str, str] = {}
    for p in fb_posts:
        mid = p.get("id_member")
        if not mid:
            continue
        post_count[mid] = post_count.get(mid, 0) + 1
        d = p.get("crawl_date")
        if d and (mid not in last_crawled or d > last_crawled[mid]):
            last_crawled[mid] = d

    accounts = []
    for m in members:
        mid = m["id"]
        accounts.append(
            {
                "id_member": mid,
                "name": m.get("name") or (m.get("email") or "").split("@")[0] or "Thành viên",
                "email": m.get("email"),
                "fb_groups": fb_group_count.get(mid, 0),
                "li_groups": li_group_count.get(mid, 0),
                "telegram_connected": mid in tg_connected,
                "total_fb_posts_crawled": post_count.get(mid, 0),
                "last_crawled_at": last_crawled.get(mid),
            }
        )
    accounts.sort(key=lambda a: (-a["total_fb_posts_crawled"], a["name"]))
    return {"role": role, "accounts": accounts}


def get_member_crawl_history(email: str, id_member: str, limit: int = 30) -> dict:
    """Chi tiết lịch sử cào của 1 thành viên — mở khi bấm vào 1 hàng trong bảng "Tài
    khoản seeding" (giống style bấm vào 1 lead ở CRM). Chỉ Facebook, xem ghi chú ở
    get_member_seeding_overview. Raise PermissionError nếu người gọi không có quyền
    xem thành viên này (router bắt lỗi này trả về 403)."""
    sb = _supabase()
    role, members = _resolve_overview_scope(sb, email)
    allowed_ids = {m["id"] for m in members}
    if role not in ("admin", "leader") or id_member not in allowed_ids:
        raise PermissionError("Không có quyền xem thành viên này.")

    groups = (
        sb.table("facebook_groups").select("id, group_name").eq("id_member", id_member).order("group_name").execute().data
        or []
    )
    posts = (
        sb.table("facebook_posts")
        .select("id, content, crawl_date, group_id")
        .eq("id_member", id_member)
        .order("crawl_date", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    group_name_map = {g["id"]: g.get("group_name") for g in groups}
    history = [
        {
            "id": p.get("id"),
            "group_name": group_name_map.get(p.get("group_id")) or "Không rõ nhóm",
            "content": (p.get("content") or "")[:200],
            "crawl_date": p.get("crawl_date"),
        }
        for p in posts
    ]
    return {
        "groups": [{"id": g["id"], "name": g.get("group_name") or "Không tên"} for g in groups],
        "history": history,
    }
