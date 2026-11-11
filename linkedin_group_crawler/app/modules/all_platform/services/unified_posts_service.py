"""Unified posts service — single source of truth from Supabase, no cache."""

from __future__ import annotations
import re
from app.core.utils.datetime_utils import extract_linkedin_post_time

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
_DEFAULT_MIN_LEAD_SCORE = 40

_OWN_COMPANY_PHONES = {"0765055708", "0902355083", "84765055708", "84902355083"}


def _normalize_display_phone(raw: Optional[str]) -> Optional[str]:
    """Normalize phone number to standard Vietnamese 0... format, removing +84 prefix."""
    if not raw or not isinstance(raw, str):
        return None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("84") and len(digits) >= 10:
        digits = "0" + digits[2:]
    if digits in _OWN_COMPANY_PHONES:
        return None
    return digits if digits else None


def _extract_phone_from_text(content: Optional[str]) -> Optional[str]:
    """Extract standard Vietnamese phone numbers (03/05/07/08/09) from text."""
    if not content or not isinstance(content, str):
        return None
    pattern = r"(?:(?:\+?84|0)[35789](?:[.\s-]?\d){8})"
    matches = re.findall(pattern, content)
    for m in matches:
        norm = _normalize_display_phone(m)
        if norm and len(norm) == 10 and norm.startswith("0"):
            return norm
    return None



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


def _normalize_vn_date_bounds(
    date_from: Optional[str],
    date_to: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    """Chuẩn hoá chuỗi ngày YYYY-MM-DD sang đầu ngày / cuối ngày theo múi giờ Việt Nam (+07:00)."""
    norm_from = (date_from or "").strip() or None
    norm_to = (date_to or "").strip() or None
    if norm_from and len(norm_from) == 10 and "T" not in norm_from:
        norm_from = f"{norm_from}T00:00:00+07:00"
    if norm_to and len(norm_to) == 10 and "T" not in norm_to:
        norm_to = f"{norm_to}T23:59:59.999+07:00"
    return norm_from, norm_to


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
    if table in KEYWORD_POST_TABLES:
        return _fetch_keyword_posts(
            table=table,
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

    norm_from, norm_to = _normalize_vn_date_bounds(date_from, date_to)
    if norm_from:
        query = query.gte("crawl_date", norm_from)
    if norm_to:
        query = query.lte("crawl_date", norm_to)

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

        # Extract and normalize contact phone
        extracted_phone = _normalize_display_phone(p.get("contact_phone")) or _extract_phone_from_text(p.get("content"))
        if extracted_phone:
            p["phone_number"] = extracted_phone

        # Standardize post creation time across platforms
        if table == "linkedin_posts":
            real_time = p.get("posted_at")
            if not real_time:
                li_dt = extract_linkedin_post_time(p.get("post_url"))
                if li_dt:
                    real_time = li_dt.isoformat()
            p["posted_at"] = real_time
            p["post_time"] = real_time
        elif table == "facebook_posts":
            p["posted_at"] = p.get("post_time")

    if table in ("facebook_posts", "linkedin_posts"):
        _attach_auto_seeding_comments(sb, posts, platform="linkedin" if table == "linkedin_posts" else "facebook")

    return posts, total


def _attach_auto_seeding_comments(sb, posts: list[dict], platform: str = "facebook") -> None:
    """Gắn `auto_seeding_comment` (nội dung + trạng thái) cho mỗi bài đã có nhiệm vụ seeding
    tự động (bảng auto_seeding_comments, migration 160 Facebook + 174 LinkedIn) - để FE hiển
    thị ngay trên card bài viết, trông như 1 bình luận thật của member nhưng ghi rõ "Hệ
    thống:" (yêu cầu 2026-10-02). Chỉ 1 trang (page_size nhỏ, vài chục id) nên .in_() an
    toàn - vẫn bọc try/except, lỗi ở đây KHÔNG được làm hỏng việc hiển thị bài viết (bài học
    từ bug 502 .in_() quá dài ở _attach_group_lead_stats)."""
    post_ids = [p["id"] for p in posts if p.get("id")]
    if not post_ids:
        return
    id_column = "id_post_li" if platform == "linkedin" else "id_post_fb"
    by_post = {}
    try:
        # Chia batch 25 de tranh loi 502 Bad Gateway / URI Too Long cua PostgREST
        for batch_ids in [post_ids[i:i+25] for i in range(0, len(post_ids), 25)]:
            res = (
                sb.table("auto_seeding_comments")
                .select(
                    f"{id_column}, comment_content, status, posted_at, link_comment, need_category, "
                    "phone_number, zalo_status, zalo_message_content, zalo_sent_at, zalo_conversation_id, "
                    "zalo_error, zalo_display_name"
                )
                .in_(id_column, batch_ids)
                .execute()
            )
            for r in (res.data or []):
                if r.get(id_column):
                    by_post[r[id_column]] = r
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
                "phone_number": _normalize_display_phone(row.get("phone_number")) or row.get("phone_number"),
                "zalo_status": row.get("zalo_status"),
                "zalo_message_content": row.get("zalo_message_content"),
                "zalo_sent_at": row.get("zalo_sent_at"),
                "zalo_conversation_id": row.get("zalo_conversation_id"),
                "zalo_error": row.get("zalo_error"),
                "zalo_display_name": row.get("zalo_display_name"),
                "zalo_sent_by": row.get("zalo_sent_by") or (str(row.get("zalo_error") or "").replace("sent_by:", "") if "sent_by:" in str(row.get("zalo_error") or "") else None),
            }
            if p["auto_seeding_comment"].get("zalo_status"):
                p["zalo_status"] = p["auto_seeding_comment"]["zalo_status"]
                p["zalo_sent_by"] = p["auto_seeding_comment"].get("zalo_sent_by")
                p["zalo_display_name"] = p["auto_seeding_comment"].get("zalo_display_name")

    # 2. Đồng bộ trạng thái đã nhắn tin Zalo theo SĐT cho toàn bộ bài viết trên feed:
    # Nếu bất kỳ bài viết nào có SĐT đã từng được nhắn tin Zalo tư vấn (zalo_status = 'sent'),
    # hiển thị ngay cho toàn bộ các bài khác có cùng SĐT để không ai nhắn lại.
    all_phones = set()
    for p in posts:
        ph = (p.get("auto_seeding_comment") or {}).get("phone_number") or p.get("phone_number")
        if not ph and p.get("content"):
            ph = _extract_phone_from_text(p["content"])
        if ph:
            norm_ph = _normalize_display_phone(ph) or str(ph).strip()
            if norm_ph:
                all_phones.add(norm_ph)
                if norm_ph.startswith("0") and len(norm_ph) == 10:
                    all_phones.add("+84" + norm_ph[1:])
                elif norm_ph.startswith("+84") and len(norm_ph) == 12:
                    all_phones.add("0" + norm_ph[3:])

    if all_phones:
        try:
            sent_res = (
                sb.table("auto_seeding_comments")
                .select("phone_number, zalo_status, zalo_sent_at, zalo_display_name, zalo_error")
                .in_("phone_number", list(all_phones))
                .eq("zalo_status", "sent")
                .execute()
            )
            sent_map = {}
            for r in (sent_res.data or []):
                p_norm = _normalize_display_phone(r.get("phone_number")) or r.get("phone_number")
                if p_norm:
                    sent_map[p_norm] = r

            if sent_map:
                for p in posts:
                    ph = (p.get("auto_seeding_comment") or {}).get("phone_number") or p.get("phone_number")
                    if not ph and p.get("content"):
                        ph = _extract_phone_from_text(p["content"])
                    p_norm = _normalize_display_phone(ph) if ph else None
                    if p_norm and p_norm in sent_map:
                        match_info = sent_map[p_norm]
                        if not p.get("auto_seeding_comment"):
                            p["auto_seeding_comment"] = {}
                        p["auto_seeding_comment"]["zalo_status"] = "sent"
                        p["auto_seeding_comment"]["phone_number"] = p_norm
                        match_sent_by = match_info.get("zalo_sent_by") or (str(match_info.get("zalo_error") or "").replace("sent_by:", "") if "sent_by:" in str(match_info.get("zalo_error") or "") else None)
                        p["auto_seeding_comment"]["zalo_sent_by"] = match_sent_by or p["auto_seeding_comment"].get("zalo_sent_by")
                        p["auto_seeding_comment"]["zalo_sent_at"] = match_info.get("zalo_sent_at") or p["auto_seeding_comment"].get("zalo_sent_at")
                        p["auto_seeding_comment"]["zalo_display_name"] = match_info.get("zalo_display_name") or p["auto_seeding_comment"].get("zalo_display_name")
                        p["zalo_status"] = "sent"
                        p["zalo_sent_by"] = p["auto_seeding_comment"].get("zalo_sent_by")
                        p["zalo_display_name"] = p["auto_seeding_comment"].get("zalo_display_name")
        except Exception as e:
            _get_logger().warning(f"[AUTO-SEEDING-COMMENT] Lỗi đồng bộ trạng thái Zalo sent theo SĐT: {e}")

    try:
        from app.modules.all_platform.services.zalo_inbox_kpi_service import enrich_posts_with_zalo_kpi

        enrich_posts_with_zalo_kpi(sb, posts)
    except Exception as kpi_exc:
        _get_logger().debug(f"[ZALO-KPI] enrich_posts_with_zalo_kpi skipped: {kpi_exc}")


# Nền tảng không có "group" — bài tìm theo từ khoá qua "Markee Seeding Extension":
# Threads (lệnh MK_TH_CRAWL_*) và YouTube (lệnh MK_YT_CRAWL_*, kèm link dán tay).
KEYWORD_POST_TABLES = ("threads_posts", "youtube_posts")
# Bảng phân quyền theo cột id_member (người bấm cào), khác linkedin_posts (theo group).
MEMBER_SCOPED_TABLES = ("facebook_posts", *KEYWORD_POST_TABLES)
_TABLE_PLATFORM = {
    "facebook_posts": "facebook",
    "linkedin_posts": "linkedin",
    "threads_posts": "threads",
    "youtube_posts": "youtube",
}
_PLATFORM_TABLE = {v: k for k, v in _TABLE_PLATFORM.items()}


def _fetch_keyword_posts(
    *,
    table: str,
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
    """Bài Threads/YouTube (bảng threads_posts/youtube_posts, cào qua "Markee Seeding Extension").

    Không có group -> không có taxonomy (intent/industry/team...): khi FE lọc
    theo taxonomy thì không bài nào khớp -> trả rỗng (không lờ bộ lọc đi).
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

    norm_from, norm_to = _normalize_vn_date_bounds(date_from, date_to)
    time_col = "post_time" if table == "threads_posts" else "crawl_date"

    query = sb.table(table).select("*", count="exact")
    if allowed_member_ids is not None:
        query = query.in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"])
    if norm_from:
        query = query.gte(time_col, norm_from)
    if norm_to:
        query = query.lte(time_col, norm_to)
    if search:
        query = query.ilike("content", f"%{search}%")

    if sort == "lead_score_high":
        query = query.gte("lead_score", _DEFAULT_MIN_LEAD_SCORE).order(time_col, desc=True, nullsfirst=False)
    elif sort == "score_high":
        query = query.order("score", desc=True, nullsfirst=False)
    elif sort == "score_low":
        query = query.order("score", desc=False, nullsfirst=False)
    elif sort == "comments_high":
        # YouTube: trang tìm kiếm không có số comment -> "nhiều tương tác" = nhiều lượt xem.
        query = query.order("view_count" if table == "youtube_posts" else "comments", desc=True, nullsfirst=False)
    elif sort == "crawler":
        query = query.order("id_member", desc=False, nullsfirst=False)
    else:  # latest
        if table == "threads_posts":
            query = query.order("post_time", desc=True, nullsfirst=False).order("crawl_date", desc=True, nullsfirst=False)
        else:
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
        # Standardize post time
        if p.get("post_time"):
            p["posted_at"] = p.get("post_time")
        elif p.get("published_at"):
            p["post_time"] = p.get("published_at")
            p["posted_at"] = p.get("published_at")

        if table == "youtube_posts":
            # PostCard hiển thị group_name ở đầu thẻ — với YouTube là tên kênh.
            p["group_name"] = p.get("author_name") or p.get("channel_handle") or "Kênh YouTube"
            p["author"] = p.get("author_name") or p.get("channel_handle") or ""
            p["search_keyword"] = p.get("keyword") or ""
        else:
            username = p.get("author_username") or ""
            # PostCard hiển thị group_name ở đầu thẻ — với Threads dùng @tác giả, kèm từ
            # khoá đã tìm ra bài để người seeding biết bài đến từ đâu.
            p["group_name"] = f"@{username}" if username else "Threads"
            p["search_keyword"] = p.get("keyword") or ""
            p["author"] = p.get("author_name") or username
        p["group_url"] = p.get("author_url") or ""
        kw_phone = _normalize_display_phone(p.get("contact_phone")) or _extract_phone_from_text(p.get("content"))
        if kw_phone:
            p["phone_number"] = kw_phone
        mid = p.get("id_member")
        if mid and mid in member_map:
            p["crawler_name"] = member_map[mid].get("name")
            p["crawler_team"] = member_map[mid].get("team_name")

    return posts, total


def _get_platform_id_by_name(sb: Client, name: str) -> Optional[int]:
    """id của Threads/YouTube trong bảng platforms (seeding_content_kpi/kpi_tracker dùng id_platform).

    Không hardcode như Facebook=1/LinkedIn=2 vì không chắc DB đã có dòng đó và id
    là bao nhiêu — None nghĩa là chưa có -> các số liệu seeding/KPI của nền tảng = 0.
    """
    try:
        res = sb.table("platforms").select("id, name").ilike("name", f"%{name}%").limit(1).execute()
        if res.data:
            return res.data[0]["id"]
    except Exception:
        pass
    return None


def _platform_db_id(sb: Client, platform: str) -> Optional[int]:
    if platform == "facebook":
        return 1
    if platform == "linkedin":
        return 2
    if platform in ("threads", "youtube"):
        return _get_platform_id_by_name(sb, platform)
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
        elif platform in ("threads", "youtube"):
            platform_id = _platform_db_id(sb, platform)
            if platform_id is None:
                return 0
            query = query.eq("id_platform", platform_id)

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
        target_platform_id = _platform_db_id(sb, platform)
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
        if table in MEMBER_SCOPED_TABLES and allowed_member_ids is not None:
            return query.in_("id_member", allowed_member_ids)
        return query

    # id_member da resolve o buoc 1 (user_id_fetch) - khong query lai app_users lan 2
    # cho cung 1 email trong cung 1 ham (tung la 1 round-trip Supabase thua thai).
    id_member = user_id_fetch
    platform_name = _TABLE_PLATFORM.get(table, "linkedin")

    # 6 query/tinh toan doc lap ben duoi (khong cai nao phu thuoc ket qua cua
    # nhau) truoc day chay tuan tu tung cai mot (~6 round-trip Supabase noi
    # tiep) - gop lai chay song song bang thread pool, giam tu ~6 round-trip
    # tuan tu con lai bang thoi gian cua request cham nhat.
    today_start, today_end = f"{today}T00:00:00+07:00", f"{today}T23:59:59.999+07:00"
    yesterday_start, yesterday_end = f"{yesterday}T00:00:00+07:00", f"{yesterday}T23:59:59.999+07:00"
    stats_time_col = "post_time" if table == "threads_posts" else "crawl_date"

    def _today_count():
        r = apply_scope(sb.table(table).select("id", count="exact").gte(stats_time_col, today_start).lte(stats_time_col, today_end)).execute()
        return r.count or 0

    def _yesterday_count():
        r = apply_scope(sb.table(table).select("id", count="exact").gte(stats_time_col, yesterday_start).lte(stats_time_col, yesterday_end)).execute()
        return r.count or 0

    def _total_count():
        r = apply_scope(sb.table(table).select("id", count="exact")).execute()
        return r.count or 0

    def _high_count():
        r = apply_scope(sb.table(table).select("id", count="exact").or_("lead_score.gte.40,score.gte.40")).execute()
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
    platforms_to_fetch = _tables_for_platform(platform)

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
            all_posts.sort(key=lambda p: str(p.get("post_time") or p.get("posted_at") or p.get("crawl_date") or ""), reverse=True)
        elif sort == "score_high":
            all_posts.sort(key=lambda p: p.get("score", 0), reverse=True)
        elif sort == "score_low":
            all_posts.sort(key=lambda p: p.get("score", 0), reverse=False)
        elif sort == "comments_high" or sort == "engagement":
            all_posts.sort(key=lambda p: (p.get("reactions", 0) + p.get("comments", 0) + p.get("shares", 0)), reverse=True)
        elif sort == "crawler":
            def get_crawler_key(p):
                return (p.get("crawler_team") or "zzz", p.get("crawler_name") or "zzz", str(p.get("post_time") or p.get("crawl_date") or ""))
            all_posts.sort(key=get_crawler_key, reverse=False)
        else: # newest / latest
            def get_date_key(p):
                dt = p.get("post_time") or p.get("posted_at") or p.get("crawl_date")
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
            clean_email = (email or "").strip().lower()
            user_res = execute_supabase_query(
                lambda: _supabase().table("app_users").select("id, role, email").eq("email", clean_email).limit(1).execute()
            )
            if user_res.data:
                id_member = user_res.data[0]["id"]
                role = user_res.data[0].get("role", "member")
                post_ids = [p.get("id") for p in all_posts if p.get("id")]
                post_url_to_id = {p.get("post_url"): p.get("id") for p in all_posts if p.get("post_url") and p.get("id")}
                post_urls = list(post_url_to_id.keys())
                if post_ids or post_urls:
                    seeding_sel = "id_post, link_post, id_member, content, verify, link_comment, social_accounts(account_name)"
                    kpi_data = []
                    
                    # Chia batch 25 post_ids de tranh 502 Bad Gateway / URI Too Long
                    # Truy van toan bo seeding comment de member, leader, admin deu thay full minh chung ai da seeding
                    for batch_pids in [post_ids[i:i+25] for i in range(0, len(post_ids), 25)]:
                        b_res = execute_supabase_query(
                            lambda b=batch_pids: _supabase().table("seeding_content_kpi").select(seeding_sel).in_("id_post", b).execute()
                        )
                        if b_res.data:
                            kpi_data.extend(b_res.data)

                    existing_pids = set([k.get("id_post") for k in kpi_data if k.get("id_post")])
                    missing_urls = [u for u in post_urls if post_url_to_id.get(u) not in existing_pids]
                    if missing_urls:
                        # Chia batch 15 missing_urls vi URL rat dai
                        for batch_urls in [missing_urls[i:i+15] for i in range(0, len(missing_urls), 15)]:
                            url_kpi_res = execute_supabase_query(
                                lambda b=batch_urls: _supabase().table("seeding_content_kpi").select(seeding_sel).in_("link_post", b).execute()
                            )
                            if url_kpi_res.data:
                                kpi_data.extend(url_kpi_res.data)

                    seeding_member_ids = list(set([k.get("id_member") for k in kpi_data if k.get("id_member")]))
                    member_name_map = {}
                    member_email_map = {}
                    if seeding_member_ids:
                        for batch_mids in [seeding_member_ids[i:i+25] for i in range(0, len(seeding_member_ids), 25)]:
                            mem_res = execute_supabase_query(
                                lambda b=batch_mids: _supabase().table("app_users").select("id, name, email").in_("id", b).execute()
                            )
                            for m in (mem_res.data or []):
                                member_name_map[m["id"]] = m.get("name") or "Unknown"
                                member_email_map[m["id"]] = (m.get("email") or "").strip().lower()

                    kpi_map = {}
                    all_seedings_map = {}
                    
                    for kpi in kpi_data:
                        pid = kpi.get("id_post")
                        if not pid and kpi.get("link_post"):
                            pid = post_url_to_id.get(kpi.get("link_post"))
                        if pid:
                            sa = kpi.get("social_accounts") or {}
                            s_member_id = kpi.get("id_member")
                            s_email = member_email_map.get(s_member_id, "")
                            
                            seeding_info = {
                                "id_member": s_member_id,
                                "member_id": s_member_id,
                                "member_name": member_name_map.get(s_member_id, "Unknown"),
                                "member_email": s_email,
                                "seeding_content": kpi.get("content"),
                                "seeding_name": sa.get("account_name") if isinstance(sa, dict) else None,
                                "link_comment": kpi.get("link_comment"),
                                "verify_status": kpi.get("verify") or "yes"
                            }
                            
                            if pid not in all_seedings_map:
                                all_seedings_map[pid] = []
                            all_seedings_map[pid].append(seeding_info)
                            
                            is_me = (s_member_id == id_member) or (clean_email and s_email == clean_email)
                            if is_me:
                                kpi_map[pid] = {
                                    "seeding_content": kpi.get("content"),
                                    "seeding_name": sa.get("account_name") if isinstance(sa, dict) else None,
                                    "link_comment": kpi.get("link_comment"),
                                    "verify_status": kpi.get("verify") or "yes",
                                    "is_my_seeding": True
                                }
                            elif pid not in kpi_map:
                                kpi_map[pid] = {
                                    "seeding_content": kpi.get("content"),
                                    "seeding_name": sa.get("account_name") if isinstance(sa, dict) else None,
                                    "link_comment": kpi.get("link_comment"),
                                    "verify_status": kpi.get("verify") or "yes",
                                    "is_my_seeding": False
                                }
                    
                    for p in all_posts:
                        pid = p.get("id")
                        if pid in kpi_map:
                            p.update(kpi_map[pid])
                        if pid in all_seedings_map:
                            p["all_seedings"] = all_seedings_map[pid]
        except Exception as e:
            print("Error fetching seeding info:", e)

    # Enrich post evaluation and exclude keywords
    try:
        if all_posts:
            post_ids_str = [str(p["id"]) for p in all_posts if p.get("id")]
            from app.modules.all_platform.services.post_evaluation_service import get_reviews_by_post_ids
            from app.modules.all_platform.services.post_call_result_service import get_call_results_by_post_ids
            from app.modules.all_platform.services.crawl_exclude_service import compute_excluded_flag, list_exclude_keywords

            reviews_map = get_reviews_by_post_ids(post_ids_str)
            call_results_map = get_call_results_by_post_ids(post_ids_str)
            active_kws = list_exclude_keywords(status="active")

            for p in all_posts:
                pid = str(p.get("id"))
                rev = reviews_map.get(pid)
                if rev:
                    p["evaluation_code"] = rev.get("evaluation_code")
                    p["evaluation_reason"] = rev.get("reason")
                    p["evaluation_summary"] = rev.get("summary")
                    p["exclude_keyword_exempt"] = rev.get("exclude_keyword_exempt", False)
                    p["evaluated_by_user"] = rev.get("evaluated_by_user")
                    p["evaluated_at"] = rev.get("evaluated_at")
                else:
                    p["evaluation_code"] = "chua-danh-gia"
                    p["exclude_keyword_exempt"] = False
                    p["evaluated_by_user"] = None
                    p["evaluated_at"] = None

                call_res = call_results_map.get(pid)
                if call_res:
                    p["call_result_code"] = call_res.get("result_code")
                    p["call_attempts"] = call_res.get("attempts", 0)
                    p["last_call_at"] = call_res.get("last_call_at")
                    p["updated_by_user"] = call_res.get("updated_by_user")
                else:
                    p["call_result_code"] = None
                    p["call_attempts"] = 0
                    p["last_call_at"] = None
                    p["updated_by_user"] = None

                exc_info = compute_excluded_flag(p, rev, active_kws)
                p["is_excluded"] = exc_info["is_excluded"]
                p["matched_keywords"] = exc_info["matched_keywords"]
    except Exception as e:
        print("Error enriching evaluation and exclude keywords:", e)

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
    table = _PLATFORM_TABLE.get((platform or "").lower())
    return [table] if table else ["facebook_posts", "linkedin_posts"]


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
    tables = _tables_for_platform(platform)

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

    tables = _tables_for_platform(platform)

    # 1) Posts theo ngay (crawl_date)
    for table in tables:
        query = sb.table(table).select("id, crawl_date").gte(
            "crawl_date", f"{start_day.isoformat()}T00:00:00Z"
        ).lte("crawl_date", f"{today.isoformat()}T23:59:59Z")
        if table in MEMBER_SCOPED_TABLES and allowed_member_ids is not None:
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

    # Tab Threads/YouTube: comment chi tinh seeding tren dung nen tang do (id_platform
    # theo ten trong bang platforms), inbox luon 0 (view inbox chi co Facebook) - tranh
    # hien so lieu cua Facebook duoi tab khac. Facebook/LinkedIn giu nguyen hanh vi cu.
    is_keyword_platform = platform in ("threads", "youtube")
    keyword_platform_id = _platform_db_id(sb, platform) if is_keyword_platform else None

    # 2) Comment/seeding da verify theo ngay (current_day)
    try:
        if is_keyword_platform and keyword_platform_id is None:
            c_rows = []
        else:
            c_query = sb.table("seeding_content_kpi").select("current_day, verify").gte(
                "current_day", start_day.isoformat()
            ).lte("current_day", today.isoformat())
            if allowed_member_ids is not None:
                c_query = c_query.in_("id_member", allowed_member_ids or ["00000000-0000-0000-0000-000000000000"])
            if is_keyword_platform:
                c_query = c_query.eq("id_platform", keyword_platform_id)
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
    if not is_keyword_platform:
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
    """Roster theo dõi thành viên đã seeding / chưa seeding bài viết này:
    - Đối với Leader: Trả về toàn bộ thành viên thuộc các team do Leader đó quản lý, kèm nội dung bình luận, link minh chứng và trạng thái KPI.
    - Đối với Admin: Trả về toàn bộ thành viên của TẤT CẢ các team trong hệ thống.
    Mọi bài viết cào về đều mở cho mọi team và thành viên có thể vào xem / làm nhiệm vụ.
    """
    sb = _supabase()

    user_res = sb.table("app_users").select("id, role, name, email").eq("email", (email or "").strip().lower()).limit(1).execute()
    if not user_res.data:
        return {"role": "member", "team_name": None, "items": []}
    caller_id = user_res.data[0]["id"]
    role = user_res.data[0].get("role", "member")
    if role not in ("admin", "leader"):
        return {"role": role, "team_name": None, "items": []}

    # 1. Xác định danh sách Team cần xem
    if role == "leader":
        # Leader: lấy các team mà caller là id_leader
        leader_teams_res = sb.table("teams").select("id, name_team").eq("id_leader", caller_id).execute()
        target_teams = leader_teams_res.data or []
        if not target_teams:
            # Fallback theo email leader trong bảng members
            mem_res = sb.table("members").select("id").eq("email", (email or "").strip().lower()).limit(1).execute()
            if mem_res.data:
                target_teams = sb.table("teams").select("id, name_team").eq("leader_member_id", mem_res.data[0]["id"]).execute().data or []
    else:
        # Admin: lấy toàn bộ các team
        target_teams = sb.table("teams").select("id, name_team").order("name_team").execute().data or []

    if not target_teams:
        return {"role": role, "team_name": "Chưa có team", "items": []}

    target_team_ids = [t["id"] for t in target_teams]
    team_name_map = {t["id"]: t["name_team"] for t in target_teams}
    main_team_name = target_teams[0]["name_team"] if len(target_teams) == 1 else "Toàn bộ các Team"

    # 2. Lấy toàn bộ thành viên của các Team này từ member_of_teams
    mot_res = sb.table("member_of_teams").select("id_teams, id_member").in_("id_teams", target_team_ids).execute().data or []
    if not mot_res:
        return {"role": role, "team_name": main_team_name, "items": []}

    member_team_map = {}
    member_ids_set = set()
    for mot in mot_res:
        mid = mot.get("id_member")
        tid = mot.get("id_teams")
        if mid and str(mid).strip().lower() not in ("none", "null", ""):
            member_ids_set.add(mid)
            member_team_map[mid] = team_name_map.get(tid, main_team_name)

    member_ids = list(member_ids_set)
    if not member_ids:
        return {"role": role, "team_name": main_team_name, "items": []}

    # 3. Lấy thông tin user (tên, email)
    users_res = sb.table("app_users").select("id, name, email").in_("id", member_ids).execute().data or []
    user_map = {u["id"]: u for u in users_res}

    # 4. Tra cứu seeding trên bài viết này (từ seeding_content_kpi theo id_post hoặc link_post)
    table = "facebook_posts" if platform == "facebook" else "linkedin_posts" if platform == "linkedin" else None
    post_link = ""
    if table:
        try:
            p_row = sb.table(table).select("post_url").eq("id", post_id).limit(1).execute()
            if p_row.data:
                post_link = p_row.data[0].get("post_url") or ""
        except Exception:
            pass

    kpi_query = sb.table("seeding_content_kpi").select("id_member, content, verify, link_comment, link_post, created_at").in_("id_member", member_ids)
    if post_link:
        kpi_query = kpi_query.or_(f"id_post.eq.{post_id},link_post.eq.{post_link}")
    else:
        kpi_query = kpi_query.eq("id_post", post_id)
    
    kpi_res = kpi_query.order("created_at", desc=True).execute().data or []

    kpi_by_member: dict[str, dict] = {}
    for row in kpi_res:
        mid = row.get("id_member")
        if mid and mid not in kpi_by_member:
            kpi_by_member[mid] = row

    # 5. Dựng danh sách items
    items = []
    for mid in member_ids:
        u = user_map.get(mid, {})
        kpi = kpi_by_member.get(mid)
        name = u.get("name") or (u.get("email") or "").split("@")[0] or "Thành viên"
        items.append({
            "id_member": mid,
            "name": name,
            "email": u.get("email") or "",
            "team_name": member_team_map.get(mid, main_team_name),
            "has_seeded": bool(kpi),
            "content": (kpi or {}).get("content") or "",
            "verify_status": (kpi or {}).get("verify") or ("yes" if kpi else None),
            "link_comment": (kpi or {}).get("link_comment") or (post_link if kpi else None),
            "created_at": (kpi or {}).get("created_at"),
        })

    # Sắp xếp: Ai đã seeding lên trước, sau đó theo team và tên
    items.sort(key=lambda it: (0 if it["has_seeded"] else 1, it["team_name"], it["name"]))
    return {"role": role, "team_name": main_team_name, "items": items}


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
    mọi thành viên active, leader chỉ thấy team mình quản lý (+ chính mình), member thấy chính mình."""
    user_res = sb.table("app_users").select("id, name, email, role").eq("email", (email or "").strip().lower()).limit(1).execute()
    if not user_res.data:
        return "member", []
    caller_id = user_res.data[0]["id"]
    role = user_res.data[0].get("role", "member")
    if role == "admin":
        members = sb.table("app_users").select("id, name, email").eq("is_active", True).execute().data or []
        return role, members
    elif role == "leader":
        teams_res = sb.table("teams").select("id").eq("id_leader", caller_id).execute()
        team_ids = [t["id"] for t in (teams_res.data or [])]
        member_ids_set = {caller_id}
        if team_ids:
            mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
            member_ids_set.update(m["id_member"] for m in (mot_res.data or []) if m.get("id_member"))
        members = sb.table("app_users").select("id, name, email").in_("id", list(member_ids_set)).execute().data or []
        return role, members
    else:
        # Member xem tài khoản của chính mình
        return role, [user_res.data[0]]


# TTL Cache cho Overview thành viên seeding (tránh lặp 7-9 queries Supabase REST nặng)
_OVERVIEW_CACHE: dict[str, tuple[float, dict]] = {}
_OVERVIEW_CACHE_TTL = 30.0  # 30 giây


def invalidate_overview_cache():
    """Xóa cache khi có bài cào mới hoặc cập nhật nhóm/thành viên."""
    _OVERVIEW_CACHE.clear()


def get_member_seeding_overview(email: str, time_range: str = "all") -> dict:
    """Tab phụ "Tài khoản seeding" (Lịch crawl & Hàng đợi) — bảng tổng quan theo từng
    thành viên: số nhóm Facebook/LinkedIn đang sở hữu, đã kết nối Telegram Chat chưa,
    tổng số bài đã cào theo mốc thời gian (Ngày, Tuần này, Tuần trước, Tháng trước, Tất cả),
    số bài viết vượt AI check (score >= 70) + lần cào gần nhất.
    """
    import copy
    import time
    from concurrent.futures import ThreadPoolExecutor

    cache_key = f"{(email or '').strip().lower()}:{time_range}"
    cached = _OVERVIEW_CACHE.get(cache_key)
    if cached:
        cached_time, cached_data = cached
        if (time.time() - cached_time) < _OVERVIEW_CACHE_TTL:
            return copy.deepcopy(cached_data)

    sb = _supabase()
    role, members = _resolve_overview_scope(sb, email)
    if not members:
        return {"role": role, "accounts": [], "time_range": time_range}

    member_ids = [m["id"] for m in members]

    now_vn = datetime.now(timezone(timedelta(hours=7)))
    today_start = now_vn.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = today_start.astimezone(timezone.utc)
    presence_Lookback_utc = (now_vn - timedelta(days=7)).astimezone(timezone.utc)

    # Giai đoạn 1: Lấy nhóm FB, nhóm LinkedIn, tài khoản Telegram, và trạng thái Online đồng thời (Parallel Stage 1)
    def _fetch_online_rows():
        try:
            oq = (
                sb.table("member_online_minutes")
                .select("id_member, minute_bucket")
                .gte("minute_bucket", presence_Lookback_utc.isoformat())
            )
            if role != "admin":
                oq = oq.in_("id_member", member_ids)
            return oq.order("minute_bucket", desc=True).limit(10000).execute().data or []
        except Exception as err:
            logger.warning(f"Error fetching member_online_minutes in overview: {err}")
            return []

    with ThreadPoolExecutor(max_workers=4) as executor:
        if role == "admin":
            f_fb_g = executor.submit(lambda: sb.table("facebook_groups").select("id, id_member, chay_24h, time_crawl").execute().data or [])
            f_li_g = executor.submit(lambda: sb.table("linkedin_groups").select("id, id_member").execute().data or [])
            f_tg_a = executor.submit(lambda: sb.table("telegram_accounts").select("id_member").eq("status", "connected").execute().data or [])
        else:
            f_fb_g = executor.submit(lambda: sb.table("facebook_groups").select("id, id_member, chay_24h, time_crawl").in_("id_member", member_ids).execute().data or [])
            f_li_g = executor.submit(lambda: sb.table("linkedin_groups").select("id, id_member").in_("id_member", member_ids).execute().data or [])
            f_tg_a = executor.submit(lambda: sb.table("telegram_accounts").select("id_member").in_("id_member", member_ids).eq("status", "connected").execute().data or [])
        f_online = executor.submit(_fetch_online_rows)

        fb_groups = f_fb_g.result()
        li_groups = f_li_g.result()
        tg_accounts = f_tg_a.result()
        online_rows = f_online.result()

    now_utc = datetime.now(timezone.utc)
    online_stale_seconds = 120
    last_seen_map: dict[str, datetime] = {}
    today_online_buckets: dict[str, set] = {}
    for orow in online_rows:
        mid = orow.get("id_member")
        raw_bucket = orow.get("minute_bucket")
        if not mid or not raw_bucket:
            continue
        try:
            b_dt = datetime.fromisoformat(str(raw_bucket).replace("Z", "+00:00"))
            if b_dt.tzinfo is None:
                b_dt = b_dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if mid not in last_seen_map or b_dt > last_seen_map[mid]:
            last_seen_map[mid] = b_dt
        if b_dt >= today_start_utc:
            today_online_buckets.setdefault(mid, set()).add(b_dt)

    fb_group_owner_map: dict[str, str] = {}
    fb_group_count: dict[str, int] = {}
    fb_scheduled_count: dict[str, int] = {}
    for g in fb_groups:
        mid = g.get("id_member")
        gid = g.get("id")
        if mid:
            fb_group_count[mid] = fb_group_count.get(mid, 0) + 1
            if g.get("chay_24h") is True or g.get("time_crawl") is not None:
                fb_scheduled_count[mid] = fb_scheduled_count.get(mid, 0) + 1
            if gid:
                fb_group_owner_map[gid] = mid

    li_group_count: dict[str, int] = {}
    for g in li_groups:
        mid = g.get("id_member")
        if mid:
            li_group_count[mid] = li_group_count.get(mid, 0) + 1

    tg_connected = {a["id_member"] for a in tg_accounts if a.get("id_member")}

    start_iso: Optional[str] = None
    end_iso: Optional[str] = None

    if time_range == "today":
        start_iso = today_start.isoformat()
        end_iso = (today_start + timedelta(days=1)).isoformat()
    elif time_range == "this_week":
        monday = today_start - timedelta(days=today_start.weekday())
        start_iso = monday.isoformat()
        end_iso = (monday + timedelta(days=7)).isoformat()
    elif time_range == "last_week":
        monday_this_week = today_start - timedelta(days=today_start.weekday())
        monday_last_week = monday_this_week - timedelta(days=7)
        start_iso = monday_last_week.isoformat()
        end_iso = monday_this_week.isoformat()
    elif time_range == "last_month":
        first_this_month = today_start.replace(day=1)
        last_day_prev_month = first_this_month - timedelta(days=1)
        first_prev_month = last_day_prev_month.replace(day=1)
        start_iso = first_prev_month.isoformat()
        end_iso = first_this_month.isoformat()

    # Giai đoạn 2: Lấy bài viết FB, Threads, LinkedIn đồng thời (Parallel Stage 2)
    def _fetch_fb_posts():
        try:
            q = sb.table("facebook_posts").select("id, id_member, group_id, crawl_date, created_at, score, lead_score")
            if role != "admin":
                q = q.in_("id_member", member_ids)
            if start_iso:
                q = q.gte("crawl_date", start_iso)
            if end_iso:
                q = q.lt("crawl_date", end_iso)
            return q.order("crawl_date", desc=True).limit(5000).execute().data or []
        except Exception as err:
            logger.warning(f"Error fetching fb_posts in overview: {err}")
            return []

    def _fetch_th_posts():
        try:
            tq = sb.table("threads_posts").select("id, id_member, created_at, score, lead_score")
            if role != "admin":
                tq = tq.in_("id_member", member_ids)
            if start_iso:
                tq = tq.gte("created_at", start_iso)
            if end_iso:
                tq = tq.lt("created_at", end_iso)
            return tq.limit(2000).execute().data or []
        except Exception as err:
            logger.warning(f"Error fetching th_posts in overview: {err}")
            return []

    def _fetch_li_posts():
        try:
            lq = sb.table("linkedin_posts").select("id, id_member, crawl_date, created_at, score, lead_score")
            if role != "admin":
                lq = lq.in_("id_member", member_ids)
            if start_iso:
                lq = lq.gte("crawl_date", start_iso)
            if end_iso:
                lq = lq.lt("crawl_date", end_iso)
            return lq.limit(2000).execute().data or []
        except Exception as err:
            logger.warning(f"Error fetching li_posts in overview: {err}")
            return []

    with ThreadPoolExecutor(max_workers=3) as executor:
        f_fb_p = executor.submit(_fetch_fb_posts)
        f_th_p = executor.submit(_fetch_th_posts)
        f_li_p = executor.submit(_fetch_li_posts)

        fb_posts = f_fb_p.result()
        th_posts = f_th_p.result()
        li_posts = f_li_p.result()

    post_count: dict[str, int] = {}
    ai_passed_count: dict[str, int] = {}
    last_crawled: dict[str, str] = {}
    ai_threshold = 40

    for p in fb_posts:
        mid = p.get("id_member") or fb_group_owner_map.get(p.get("group_id"))
        if not mid or mid not in member_ids:
            continue
        post_count[mid] = post_count.get(mid, 0) + 1
        is_passed = ((p.get("lead_score") or 0) >= ai_threshold) or ((p.get("score") or 0) >= ai_threshold)
        if is_passed:
            ai_passed_count[mid] = ai_passed_count.get(mid, 0) + 1
        d = p.get("crawl_date") or p.get("created_at")
        if d and (mid not in last_crawled or d > last_crawled[mid]):
            last_crawled[mid] = d

    for p in th_posts:
        mid = p.get("id_member")
        if not mid or mid not in member_ids:
            continue
        post_count[mid] = post_count.get(mid, 0) + 1
        is_passed = ((p.get("lead_score") or 0) >= ai_threshold) or ((p.get("score") or 0) >= ai_threshold)
        if is_passed:
            ai_passed_count[mid] = ai_passed_count.get(mid, 0) + 1
        d = p.get("created_at")
        if d and (mid not in last_crawled or d > last_crawled[mid]):
            last_crawled[mid] = d



    for p in li_posts:
        mid = p.get("id_member")
        if not mid or mid not in member_ids:
            continue
        post_count[mid] = post_count.get(mid, 0) + 1
        is_passed = ((p.get("lead_score") or 0) >= ai_threshold) or ((p.get("score") or 0) >= ai_threshold)
        if is_passed:
            ai_passed_count[mid] = ai_passed_count.get(mid, 0) + 1
        d = p.get("crawl_date") or p.get("created_at")
        if d and (mid not in last_crawled or d > last_crawled[mid]):
            last_crawled[mid] = d

    accounts = []
    for m in members:
        mid = m["id"]
        total_crawled = post_count.get(mid, 0)
        ai_passed = ai_passed_count.get(mid, 0)
        ai_percent = round((ai_passed / total_crawled) * 100, 1) if total_crawled > 0 else 0
        seen_dt = last_seen_map.get(mid)
        is_online = bool(seen_dt and (now_utc - seen_dt).total_seconds() <= online_stale_seconds)
        accounts.append(
            {
                "id_member": mid,
                "name": m.get("name") or (m.get("email") or "").split("@")[0] or "Thành viên",
                "email": m.get("email"),
                "is_online": is_online,
                "last_seen_at": seen_dt.isoformat() if seen_dt else None,
                "online_today_minutes": len(today_online_buckets.get(mid, ())),
                "fb_groups": fb_group_count.get(mid, 0),
                "li_groups": li_group_count.get(mid, 0),
                "scheduled_crawls_count": fb_scheduled_count.get(mid, 0),
                "telegram_connected": mid in tg_connected,
                "total_crawled_posts": total_crawled,
                "total_fb_posts_crawled": total_crawled,
                "ai_passed_posts": ai_passed,
                "ai_passed_percent": ai_percent,
                "last_crawled_at": last_crawled.get(mid),
            }
        )
    accounts.sort(key=lambda a: (-a["total_crawled_posts"], a["name"]))
    result = {"role": role, "accounts": accounts, "time_range": time_range}
    _OVERVIEW_CACHE[cache_key] = (time.time(), copy.deepcopy(result))
    return result


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
    specific_date: Optional[str] = None,
    date_from_str: Optional[str] = None,
    date_to_str: Optional[str] = None,
    limit: int = 100,
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

    # Lọc thời gian (Giờ Việt Nam GMT+7)
    vn_tz = timezone(timedelta(hours=7))
    now_vn = datetime.now(vn_tz)
    date_from = None
    date_to = None

    if specific_date:
        try:
            # specific_date = "YYYY-MM-DD"
            p = [int(x) for x in specific_date.strip().split("-")]
            d_spec = datetime(p[0], p[1], p[2], tzinfo=vn_tz)
            date_from = d_spec.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
            date_to = d_spec.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(timezone.utc)
        except Exception:
            pass
    elif date_from_str or date_to_str:
        if date_from_str:
            try:
                p = [int(x) for x in date_from_str.strip().split("-")]
                d_f = datetime(p[0], p[1], p[2], tzinfo=vn_tz)
                date_from = d_f.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
            except Exception:
                pass
        if date_to_str:
            try:
                p = [int(x) for x in date_to_str.strip().split("-")]
                d_t = datetime(p[0], p[1], p[2], tzinfo=vn_tz)
                date_to = d_t.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(timezone.utc)
            except Exception:
                pass
    elif time_range == "today":
        date_from = now_vn.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        date_to = now_vn.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(timezone.utc)
    elif time_range in ("yesterday", "last_day"):
        y_day = now_vn - timedelta(days=1)
        date_from = y_day.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        date_to = y_day.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(timezone.utc)
    elif time_range in ("this_week", "last_week", "week"):
        date_from = (now_vn - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        date_to = now_vn.astimezone(timezone.utc)
    elif time_range in ("this_month", "last_month", "month"):
        date_from = (now_vn - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        date_to = now_vn.astimezone(timezone.utc)
    elif time_range in ("this_year", "last_year", "year"):
        date_from = (now_vn - timedelta(days=365)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        date_to = now_vn.astimezone(timezone.utc)

    # 2. Truy vấn bài viết từ 3 nền tảng
    q_fb = sb.table("facebook_posts").select("id, id_member, score, lead_score, crawl_date, created_at, group_id")
    q_th = sb.table("threads_posts").select("id, id_member, score, lead_score, crawl_date, created_at, keyword")
    q_li = sb.table("linkedin_posts").select("id, id_member, score, lead_score, crawl_date, created_at, id_group, session_id")

    if id_member and id_member != "all":
        q_fb = q_fb.eq("id_member", id_member)
        q_th = q_th.eq("id_member", id_member)
        q_li = q_li.eq("id_member", id_member)

    if date_from:
        iso_from = date_from.isoformat()
        q_fb = q_fb.gte("created_at", iso_from)
        q_th = q_th.gte("created_at", iso_from)
        q_li = q_li.gte("created_at", iso_from)

    if date_to:
        iso_to = date_to.isoformat()
        q_fb = q_fb.lte("created_at", iso_to)
        q_th = q_th.lte("created_at", iso_to)
        q_li = q_li.lte("created_at", iso_to)

    fb_data = q_fb.order("created_at", desc=True).limit(1000).execute().data or []
    th_data = q_th.order("created_at", desc=True).limit(1000).execute().data or []
    li_data = q_li.order("created_at", desc=True).limit(500).execute().data or []

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
            is_passed = ((p.get("lead_score") or 0) >= ai_threshold) or ((p.get("score") or 0) >= ai_threshold)
            all_posts.append({
                "platform": "facebook",
                "id": p["id"],
                "member_id": m_id,
                "score": p.get("score") or 0,
                "lead_score": p.get("lead_score"),
                "ai_passed": is_passed,
                "created_at": dt,
            })
    for p in th_data:
        m_id = p.get("id_member") or SEEDING_SYSTEM_MEMBER_ID
        dt = _parse_ts(p.get("created_at") or p.get("crawl_date"))
        if dt:
            is_passed = ((p.get("lead_score") or 0) >= ai_threshold) or ((p.get("score") or 0) >= ai_threshold)
            all_posts.append({
                "platform": "threads",
                "id": p["id"],
                "member_id": m_id,
                "score": p.get("score") or 0,
                "lead_score": p.get("lead_score"),
                "ai_passed": is_passed,
                "created_at": dt,
            })
    for p in li_data:
        m_id = p.get("id_member") or SEEDING_SYSTEM_MEMBER_ID
        dt = _parse_ts(p.get("created_at") or p.get("crawl_date"))
        if dt:
            is_passed = ((p.get("lead_score") or 0) >= ai_threshold) or ((p.get("score") or 0) >= ai_threshold)
            all_posts.append({
                "platform": "linkedin",
                "id": p["id"],
                "member_id": m_id,
                "score": p.get("score") or 0,
                "lead_score": p.get("lead_score"),
                "ai_passed": is_passed,
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
            fb_ai = sum(1 for p in fb_items if p.get("ai_passed"))

            li_items = [p for p in cluster if p["platform"] == "linkedin"]
            li_cnt = len(li_items)
            li_ai = sum(1 for p in li_items if p.get("ai_passed"))

            th_items = [p for p in cluster if p["platform"] == "threads"]
            th_cnt = len(th_items)
            th_ai = sum(1 for p in th_items if p.get("ai_passed"))

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

