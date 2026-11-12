"""Shared Facebook post ingestion & watermark lookup service.

Used by both Chrome Extension (`/extension/save-posts`, `/extension/crawl-result`)
and the zero-account Public 4G Crawler so deduplication, Vietnam UTC+7 today
filtering, keyword matching, author resolution, AI lead scoring, and WebSocket
notifications remain 100% consistent.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, model_validator

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services import supabase_crawl_queue_service as queue_service
from app.modules.all_platform.services.fb_story_parser import extract_post_id_from_url
from app.modules.all_platform.services.lead_score_service import score_and_save_posts
from app.modules.all_platform.services.post_deduplication_service import filter_posts_by_unique_content
from app.modules.all_platform.websocket import manager
from app.modules.facebook.src.modules.crawl_fb.models.post import Post as FBPost
from app.modules.facebook.src.modules.facebook.services.facebook_scraper import (
    _pick_by_keywords_and_threshold,
)

logger = logging.getLogger(__name__)

_VIETNAM_TZ = timezone(timedelta(hours=7))


class ExtensionPost(BaseModel):
    post_url: Optional[str] = None
    url: Optional[str] = None
    author_name: Optional[str] = ""
    author_url: Optional[str] = ""
    timestamp_raw: Optional[str] = ""
    date: Optional[str] = None
    timestamp_class: Optional[str] = "unknown"
    content: Optional[str] = ""
    reactions: Optional[int] = 0
    comments: Optional[int] = 0
    shares: Optional[int] = 0
    images: Optional[List[str]] = []
    video_url: Optional[str] = None
    media_url: Optional[str] = None
    group_url: Optional[str] = None
    crawled_at: Optional[str] = None


class ExtensionCrawlRequest(BaseModel):
    posts: List[ExtensionPost]
    group_name: Optional[str] = None
    group_url: Optional[str] = None
    group_id: Optional[str] = None
    id_member: Optional[str] = None
    extension_version: Optional[str] = None

    keywords: Optional[List[str]] = None
    post_limit: Optional[int] = None

    job_id: Optional[str] = None
    worker_id: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_keywords(cls, data: Any) -> Any:
        """Normalize incoming keyword field aliases into `keywords: List[str]`."""
        if not isinstance(data, dict):
            return data

        existing = data.get("keywords")
        if isinstance(existing, list) and existing:
            cleaned = [str(k).strip() for k in existing if str(k).strip()]
            if cleaned:
                data["keywords"] = cleaned
                return data

        candidates = [
            data.get("keyword"),
            data.get("search_keyword"),
            data.get("search_keywords"),
            data.get("kw"),
            data.get("filter_keyword"),
            existing,
        ]

        for val in candidates:
            if val is None:
                continue
            if isinstance(val, str) and val.strip():
                data["keywords"] = [k.strip() for k in val.split(",") if k.strip()]
                logger.info(
                    "[KEYWORD-NORMALIZE] Đã map keyword từ field khác -> keywords=%s",
                    data["keywords"],
                )
                return data
            if isinstance(val, list) and val:
                cleaned = [str(k).strip() for k in val if str(k).strip()]
                if cleaned:
                    data["keywords"] = cleaned
                    logger.info(
                        "[KEYWORD-NORMALIZE] Đã map keyword từ field khác -> keywords=%s",
                        data["keywords"],
                    )
                    return data

        return data


def _parse_iso_to_vn_date(raw_time: str) -> str:
    clean = raw_time.replace("Z", "+00:00")
    clean = re.sub(r"\.\d+", "", clean)
    clean = clean.replace(" ", "T")
    dt_utc = datetime.fromisoformat(clean)
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    return dt_utc.astimezone(_VIETNAM_TZ).strftime("%Y-%m-%d")


def get_group_post_watermarks(
    *,
    group_id: str | None = None,
    group_url: str | None = None,
    limit: int = 30,
) -> dict[str, set[str]]:
    """Fetch recent known `post_url`s & numeric `post_id`s for incremental early-stop."""
    known_urls: set[str] = set()
    known_ids: set[str] = set()
    supabase = get_supabase_client()

    resolved_gid = group_id or None
    if not resolved_gid and group_url:
        try:
            g_res = (
                supabase.table("facebook_groups")
                .select("id")
                .eq("group_url", group_url)
                .limit(1)
                .execute()
            )
            if g_res.data:
                resolved_gid = g_res.data[0].get("id")
        except Exception as exc:
            logger.debug("[WATERMARK] Could not resolve group_id for %s: %s", group_url, exc)

    if not resolved_gid:
        return {"urls": known_urls, "post_ids": known_ids}

    try:
        res = (
            supabase.table("facebook_posts")
            .select("post_url")
            .eq("group_id", resolved_gid)
            .order("created_at", desc=True)
            .limit(max(1, min(int(limit), 100)))
            .execute()
        )
        for row in res.data or []:
            u = (row.get("post_url") or "").strip()
            if not u:
                continue
            known_urls.add(u)
            pid = extract_post_id_from_url(u)
            if pid:
                known_ids.add(pid)
    except Exception as exc:
        logger.warning("[WATERMARK] Lookup failed for group_id=%s: %s", resolved_gid, exc)

    return {"urls": known_urls, "post_ids": known_ids}


def sync_process_and_save_posts_db(
    payload: ExtensionCrawlRequest,
    legacy: bool = False,
) -> tuple[int, list[str], list[dict[str, Any]]]:
    """Run synchronous Supabase dedupe/filter/upsert inside a worker thread."""
    supabase = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Resolve group_id
    group_id = payload.group_id
    group_url = payload.group_url
    if not group_id and group_url:
        try:
            res = supabase.table("facebook_groups").select("id").eq("group_url", group_url).execute()
            if res.data:
                group_id = res.data[0].get("id")
        except Exception as exc:
            logger.error("Error fetching group id for %s: %s", group_url, exc)

    group_id = group_id or None

    # 2. Existing post_urls lookup (skip exact URL duplicates upfront)
    all_post_urls = [p.post_url or p.url for p in payload.posts if (p.post_url or p.url)]
    existing_urls: set[str] = set()
    if all_post_urls:
        try:
            res_existing = (
                supabase.table("facebook_posts")
                .select("post_url")
                .in_("post_url", all_post_urls)
                .execute()
            )
            existing_urls = {
                item["post_url"] for item in (res_existing.data or []) if item.get("post_url")
            }
        except Exception as exc:
            logger.warning("Could not check existing urls in facebook_posts: %s", exc)

    # 3. Filter strictly to today (Vietnam UTC+7)
    today_vn_str = datetime.now(_VIETNAM_TZ).strftime("%Y-%m-%d")
    today_posts: list[tuple[ExtensionPost, str]] = []
    skipped_old = 0
    skipped_no_time = 0

    for p in payload.posts:
        post_url = p.post_url or p.url
        if not post_url or post_url in existing_urls:
            continue
        if "comment_id=" in post_url or "reply_comment_id=" in post_url:
            continue

        raw_time = p.timestamp_raw or p.date or None
        if not raw_time:
            skipped_no_time += 1
            continue

        try:
            post_date_vn = _parse_iso_to_vn_date(raw_time)
            if post_date_vn != today_vn_str:
                skipped_old += 1
                continue
            today_posts.append((p, raw_time))
        except Exception as exc:
            logger.warning("[DATE-FILTER] Không parse được '%s': %s", raw_time, exc)
            skipped_no_time += 1
            continue

    logger.info(
        "[FILTER] Tổng=%s | Trùng URL=%s | Bài cũ=%s | Không có time=%s | Bài HÔM NAY=%s (today_vn=%s)",
        len(payload.posts),
        len(existing_urls),
        skipped_old,
        skipped_no_time,
        len(today_posts),
        today_vn_str,
    )

    keywords = payload.keywords or []
    post_limit = payload.post_limit
    ext_post_by_url: dict[str, ExtensionPost] = {}
    posts_in_day: list[FBPost] = []

    for ext_post, raw_time in today_posts:
        post_url = ext_post.post_url or ext_post.url
        if not post_url:
            continue
        ext_post_by_url[post_url] = ext_post
        reactions = ext_post.reactions or 0
        comments = ext_post.comments or 0
        shares = ext_post.shares or 0
        score = comments * 2 + reactions + shares * 3
        posts_in_day.append(
            FBPost(
                url=post_url,
                date=raw_time,
                reactions=reactions,
                comments=comments,
                shares=shares,
                score=score,
                content=ext_post.content or "",
                media_url=ext_post.video_url or ext_post.media_url,
                video_url=ext_post.video_url,
                author_url=ext_post.author_url,
                author_name=ext_post.author_name,
                crawled_at=ext_post.crawled_at,
                images=ext_post.images or [],
            )
        )

    selected_posts = _pick_by_keywords_and_threshold(
        posts_in_day=posts_in_day,
        keywords=keywords,
        post_limit=post_limit,
    )

    top_ext_posts: list[ExtensionPost] = []
    for p in selected_posts:
        ext_post = ext_post_by_url.get(p.url) if p.url else None
        if ext_post:
            top_ext_posts.append(ext_post)
        else:
            logger.warning("[AUTHOR] Không map ngược ExtensionPost cho fb_url=%s", p.url)

    # 4. Resolve or create authors in author_post
    author_urls = [
        p.author_url for p in top_ext_posts if p.author_url and str(p.author_url).strip()
    ]
    author_map: dict[str, str] = {}
    if author_urls:
        try:
            res_authors = (
                supabase.table("author_post")
                .select("id, url_profile")
                .in_("url_profile", author_urls)
                .execute()
            )
            author_map = {item["url_profile"]: item["id"] for item in (res_authors.data or [])}
        except Exception as exc:
            logger.warning("Error fetching authors: %s", exc)

    new_authors: list[dict[str, Any]] = []
    for p in top_ext_posts:
        url = p.author_url.strip() if p.author_url else ""
        name = p.author_name.strip() if p.author_name else ""
        if url and url not in author_map:
            new_id = str(uuid.uuid4())
            author_map[url] = new_id
            new_authors.append(
                {
                    "id": new_id,
                    "name": name or "Ẩn danh",
                    "url_profile": url,
                    "create_at": now_iso,
                }
            )
        elif not url and name and name not in ("Ẩn danh", ""):
            fallback_key = f"__name__{name}"
            if fallback_key not in author_map:
                new_id = str(uuid.uuid4())
                author_map[fallback_key] = new_id
                new_authors.append(
                    {
                        "id": new_id,
                        "name": name,
                        "url_profile": fallback_key,
                        "create_at": now_iso,
                    }
                )

    if new_authors:
        unique_new_authors = list({a["url_profile"]: a for a in new_authors}.values())
        inserted_author_urls: set[str] = set()
        try:
            supabase.table("author_post").insert(unique_new_authors, upsert=False).execute()
            inserted_author_urls = {a["url_profile"] for a in unique_new_authors}
        except Exception as exc:
            logger.warning("[AUTHOR] Batch insert failed (%s), falling back to single inserts", exc)
            for a in unique_new_authors:
                try:
                    supabase.table("author_post").insert(a).execute()
                    inserted_author_urls.add(a["url_profile"])
                except Exception as exc2:
                    logger.warning("[AUTHOR] Skipped '%s': %s", a["url_profile"], exc2)

        for a in unique_new_authors:
            if a["url_profile"] not in inserted_author_urls:
                author_map.pop(a["url_profile"], None)

    # 5. Prepare rows & content deduplication
    posts_to_insert: list[dict[str, Any]] = []
    for p in selected_posts:
        post_url = p.url
        author_url_key = (p.author_url or "").strip()
        author_name_key = (p.author_name or "").strip()
        id_author = author_map.get(author_url_key) or (
            author_map.get(f"__name__{author_name_key}")
            if author_name_key and author_name_key not in ("Ẩn danh", "")
            else None
        )
        posts_to_insert.append(
            {
                "group_id": group_id,
                "post_url": post_url,
                "crawl_date": now_iso,
                "post_time": p.date,
                "content": p.content,
                "score": 0,
                "reactions": p.reactions,
                "comments": p.comments,
                "shares": p.shares,
                "media_url": p.video_url or p.media_url,
                "image_urls": p.images or [],
                "created_at": p.crawled_at if legacy else now_iso,
                "updated_at": now_iso,
                "id_author": id_author,
                "id_member": payload.id_member or None,
            }
        )

    if posts_to_insert:
        logger.info("[SAVE] Sẽ lưu %s bài (hôm nay) vào DB", len(posts_to_insert))

    posts_to_insert, skipped_content_dups = filter_posts_by_unique_content(
        supabase,
        "facebook_posts",
        posts_to_insert,
    )
    if skipped_content_dups > 0:
        logger.info("[DEDUPE-FB] Đã loại bỏ %s bài viết do trùng nội dung content!", skipped_content_dups)

    inserted_count = 0
    inserted_post_urls: list[str] = []
    inserted_rows: list[dict[str, Any]] = []
    if posts_to_insert:
        try:
            res = (
                supabase.table("facebook_posts")
                .upsert(posts_to_insert, on_conflict="post_url", ignore_duplicates=True)
                .execute()
            )
            inserted_count = len(res.data or [])
            if res.data:
                inserted_post_urls = [p.get("post_url") for p in res.data if p.get("post_url")]
                inserted_rows = [
                    {
                        "id": p.get("id"),
                        "content": p.get("content"),
                        "post_url": p.get("post_url"),
                    }
                    for p in res.data
                    if p.get("id")
                ]
        except Exception as exc:
            logger.error("Error saving to facebook_posts: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return inserted_count, inserted_post_urls, inserted_rows


async def ingest_facebook_posts(
    payload: ExtensionCrawlRequest,
    *,
    event_name: str = "extension_crawl_saved",
    legacy: bool = False,
    extra_broadcast_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Ingest Facebook posts asynchronously, trigger AI lead scoring, and broadcast WS."""
    inserted_count, inserted_post_urls, inserted_rows = await asyncio.to_thread(
        sync_process_and_save_posts_db,
        payload,
        legacy,
    )

    if inserted_rows:
        asyncio.create_task(
            score_and_save_posts(
                "facebook_posts",
                inserted_rows,
                id_member=payload.id_member,
                group_name=payload.group_name,
                keywords=payload.keywords,
            )
        )

    if payload.job_id:
        try:
            queue_service.complete_job(
                payload.job_id,
                success=True,
                worker_id=payload.worker_id,
                result_count=inserted_count,
            )
        except Exception as exc:
            logger.warning("[CRAWL-QUEUE] Không đóng được job %s: %s", payload.job_id, exc)

    msg_prefix = "Legacy: " if legacy else ""
    broadcast_payload: dict[str, Any] = {
        "event": event_name,
        "platform": "facebook",
        "group_url": payload.group_url,
        "group_name": payload.group_name,
        "posts_count": inserted_count,
        "post_urls": inserted_post_urls,
        "message": f"{msg_prefix}Đã lưu {inserted_count} bài viết từ {payload.group_name}",
        "involved_users": [payload.id_member] if payload.id_member else [],
    }
    if extra_broadcast_fields:
        broadcast_payload.update(extra_broadcast_fields)

    try:
        await manager.broadcast(broadcast_payload)
    except Exception as exc:
        logger.debug("[WS] Broadcast ignored error: %s", exc)

    return {"success": True, "count": inserted_count, "post_urls": inserted_post_urls}


async def process_and_save_posts(
    payload: ExtensionCrawlRequest,
    event_name: str,
    legacy: bool = False,
) -> dict[str, Any]:
    """Backward-compatible wrapper used by extension_crawl routes."""
    return await ingest_facebook_posts(payload, event_name=event_name, legacy=legacy)
