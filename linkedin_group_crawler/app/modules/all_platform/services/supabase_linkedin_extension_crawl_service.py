"""Lưu bài viết LinkedIn cào được từ browser extension (DOM-scraping) vào Supabase.

Khác với `supabase_linkedin_crawl_service.save_crawl_batch_to_supabase` (luồng Playwright,
chỉ giữ 1 bài tương tác cao nhất mỗi group), hàm ở đây lưu TẤT CẢ bài đã dedupe mà
extension cào được. Extension dùng session đăng nhập sẵn có của user (không cần password
lưu trên server) — nhưng `id_account_crawl` trên `crawl_linkedin_session`/`linkedin_posts`
là NOT NULL trên schema thật, nên vẫn cần 1 row placeholder dùng chung trong
`linkedin_account_crawl` (không có password thật) chỉ để thoả FK, xem `_get_or_create_extension_account_id`.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client
from app.core.utils.datetime_utils import normalize_relative_time

logger = get_logger(__name__)

# `crawl_linkedin_session.id_account_crawl` / `linkedin_posts.id_account_crawl` là NOT NULL
# (FK -> linkedin_account_crawl) trên schema thật — không nullable như luồng Playwright hay
# gán None một cách "vô tư". Extension không có Playwright account thật nên dùng 1 row
# placeholder chung (id_member/password đều NULL, chỉ tồn tại để có FK hợp lệ) làm dấu hiệu
# nhận biết "crawl từ extension" (thay cho id_account_crawl IS NULL — cách không dùng được).
_PLACEHOLDER_ACCOUNT_EMAIL = "ext-crawl-placeholder@local.test"
_placeholder_account_id_cache: str | None = None


def _get_or_create_extension_account_id() -> str | None:
    global _placeholder_account_id_cache
    if _placeholder_account_id_cache:
        return _placeholder_account_id_cache

    supabase = get_supabase_client()
    try:
        res = (
            supabase.table("linkedin_account_crawl")
            .select("id")
            .eq("email_linkedin", _PLACEHOLDER_ACCOUNT_EMAIL)
            .limit(1)
            .execute()
        )
        if res.data:
            _placeholder_account_id_cache = res.data[0]["id"]
            return _placeholder_account_id_cache

        try:
            insert_res = (
                supabase.table("linkedin_account_crawl")
                .insert({"email_linkedin": _PLACEHOLDER_ACCOUNT_EMAIL, "id_member": None, "password": None})
                .execute()
            )
            if insert_res.data:
                _placeholder_account_id_cache = insert_res.data[0]["id"]
                return _placeholder_account_id_cache
        except Exception:
            # Có thể do 2 request chạy song song cùng insert lần đầu (email_linkedin
            # unique) — request thua tra lại theo email 1 lần nữa thay vì bỏ cuộc luôn.
            retry_res = (
                supabase.table("linkedin_account_crawl")
                .select("id")
                .eq("email_linkedin", _PLACEHOLDER_ACCOUNT_EMAIL)
                .limit(1)
                .execute()
            )
            if retry_res.data:
                _placeholder_account_id_cache = retry_res.data[0]["id"]
                return _placeholder_account_id_cache
            raise
    except Exception:
        logger.exception("[LI-EXT] Không lấy/tạo được placeholder linkedin_account_crawl")
    return None


def _resolve_or_create_group(group_url: str, group_name: str | None, id_member: str | None) -> str | None:
    """Tìm `linkedin_groups.id` theo group_url (giống `_get_group_taxonomy`); tạo mới nếu chưa có."""
    supabase = get_supabase_client()

    match = re.search(r"/groups/(\d+)", group_url)
    if match:
        res = (
            supabase.table("linkedin_groups")
            .select("id")
            .ilike("group_url", f"%{match.group(1)}%")
            .execute()
        )
        if res.data:
            return res.data[0]["id"]

    candidate_urls = [group_url]
    candidate_urls.append(group_url[:-1] if group_url.endswith("/") else group_url + "/")
    res = (
        supabase.table("linkedin_groups")
        .select("id")
        .in_("group_url", candidate_urls)
        .execute()
    )
    if res.data:
        return res.data[0]["id"]

    try:
        insert_res = (
            supabase.table("linkedin_groups")
            .insert(
                {
                    "group_url": group_url,
                    "group_name": group_name or None,
                    "status": "idle",
                    "id_member": id_member or None,
                    # Set rõ None để override default của các cột này (vài default trỏ tới
                    # row categories/app_users không còn tồn tại -> FK error nếu không override).
                    # Danh sách khớp với add_linkedin_group() trong supabase_groups_service.py.
                    "id_intent": None,
                    "id_industry": None,
                    "id_tier": None,
                    "id_team": None,
                    "id_icp": None,
                    "id_content_type": None,
                    "id_product_seeding": None,
                    "note": None,
                    "risk_note": None,
                    "assignee_id": None,
                    "co_assignee_id": None,
                    "assignee_name_hint": None,
                    "co_assignee_name_hint": None,
                    "id_member_name_hint": None,
                }
            )
            .execute()
        )
        if insert_res.data:
            return insert_res.data[0]["id"]
    except Exception:
        logger.exception("[LI-EXT] Không tạo được linkedin_groups cho %s", group_url)
    return None


def save_extension_crawl_batch(
    *,
    posts: list[dict],
    group_url: str,
    group_name: str | None,
    id_member: str | None,
) -> dict:
    """Chạy đồng bộ (gọi qua `asyncio.to_thread` từ router) — dedupe + insert bài LinkedIn.

    `posts` là list dict đã chuẩn hoá field: post_url, author, content, posted_at_raw,
    likes, comments, shares (đã gộp reposts/shares).
    """
    supabase = get_supabase_client()

    id_group = _resolve_or_create_group(group_url, group_name, id_member)
    id_account_crawl = _get_or_create_extension_account_id()

    all_urls = [p["post_url"] for p in posts if p.get("post_url")]
    existing_urls: set[str] = set()
    if all_urls:
        try:
            res = supabase.table("linkedin_posts").select("post_url").in_("post_url", all_urls).execute()
            existing_urls = {row["post_url"] for row in (res.data or []) if row.get("post_url")}
        except Exception:
            logger.exception("[LI-EXT] Không kiểm tra được post_url trùng")

    deduped = [p for p in posts if p.get("post_url") and p["post_url"] not in existing_urls]
    skipped_duplicates = len(all_urls) - len(deduped)

    session_id = str(uuid.uuid4())
    try:
        supabase.table("crawl_linkedin_session").insert(
            {
                "id": session_id,
                "posts_count": len(deduped),
                "status": "completed",
                "id_account_crawl": id_account_crawl,
                "id_member": id_member or None,
                "id_platform": 2,
            }
        ).execute()
    except Exception:
        logger.exception("[LI-EXT] Không tạo được crawl_linkedin_session cho %s", group_url)

    saved_count = 0
    inserted_rows: list[dict] = []
    if deduped:
        crawl_time = datetime.now(timezone.utc)
        crawl_date = crawl_time.strftime("%Y-%m-%d")
        records = []
        for p in deduped:
            likes = p.get("likes") or 0
            comments = p.get("comments") or 0
            shares = p.get("shares") or 0
            posted_at_dt = normalize_relative_time(p.get("posted_at_raw") or "", crawl_time)
            records.append(
                {
                    "session_id": session_id,
                    "crawl_date": crawl_date,
                    "post_url": p["post_url"],
                    "author": p.get("author") or "",
                    "content": p.get("content") or "",
                    "likes": likes,
                    "comments": comments,
                    "shares": shares,
                    "score": comments * 2 + likes + shares * 3,
                    "posted_at": posted_at_dt.isoformat() if posted_at_dt else None,
                    "total_posts_per_run": len(deduped),
                    "id_group": id_group,
                    "id_account_crawl": id_account_crawl,
                    "id_member": id_member or None,
                    "comments_detail": p.get("comments_detail") or [],
                    "likers": p.get("likers") or [],
                }
            )
        try:
            # upsert + ignore_duplicates: existing_urls o tren la snapshot luc DAU request
            # (TOCTOU race neu 2 lan cao gan nhu dong thoi cung tim ra 1 bai) - UNIQUE(post_url)
            # (migration 158) + ON CONFLICT DO NOTHING lam backstop o tang DB.
            res = supabase.table("linkedin_posts").upsert(records, on_conflict="post_url", ignore_duplicates=True).execute()
            saved_count = len(res.data or [])
            # post_url can cho bot auto-seeding (lead_score_service.py -> auto_seeding_comment_service.py,
            # migration 174) biet URL that de mo/comment, giong het inserted_rows cua Facebook.
            inserted_rows = [{"id": r.get("id"), "content": r.get("content"), "post_url": r.get("post_url")} for r in (res.data or []) if r.get("id")]
        except Exception as exc:
            # Migration 151 (comments_detail/likers) có thể chưa áp trên DB -> PostgREST báo
            # thiếu cột và làm hỏng CẢ lô bài. Lưu lại không kèm 2 cột đó thay vì mất hết bài.
            if "comments_detail" in str(exc) or "likers" in str(exc):
                logger.warning("[LI-EXT] linkedin_posts chưa có cột comments_detail/likers, lưu không kèm 2 cột này")
                stripped = [{k: v for k, v in r.items() if k not in ("comments_detail", "likers")} for r in records]
                try:
                    res = supabase.table("linkedin_posts").upsert(stripped, on_conflict="post_url", ignore_duplicates=True).execute()
                    saved_count = len(res.data or [])
                    inserted_rows = [{"id": r.get("id"), "content": r.get("content"), "post_url": r.get("post_url")} for r in (res.data or []) if r.get("id")]
                except Exception:
                    logger.exception("[LI-EXT] Không insert được linkedin_posts cho %s", group_url)
            else:
                logger.exception("[LI-EXT] Không insert được linkedin_posts cho %s", group_url)

    return {
        "success": True,
        "saved_count": saved_count,
        "skipped_duplicates": skipped_duplicates,
        "group_id": id_group,
        # Noi bo - khong tra ve qua HTTP (router pop() ra truoc khi tra response cho
        # extension), dung de cham diem "tiem nang seeding" (LLM) chay nen sau khi luu.
        "_inserted_rows": inserted_rows,
        "session_id": session_id,
    }
