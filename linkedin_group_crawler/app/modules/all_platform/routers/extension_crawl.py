"""Extension crawl router — handles extension-initiated crawl requests."""

from __future__ import annotations

import json as _json
import logging
import re
import uuid
import asyncio
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, model_validator

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.websocket import manager
from app.modules.all_platform.services.supabase_facebook_crawl_service import parse_facebook_time
from app.modules.all_platform.services import supabase_crawl_queue_service as queue_service

# Reuse facebook keyword picker logic
from app.modules.facebook.src.modules.facebook.services.facebook_scraper import (
    _pick_by_keywords_and_threshold,
)
from app.modules.facebook.src.modules.crawl_fb.models.post import Post as FBPost


logger = logging.getLogger(__name__)

router = APIRouter()

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

    # Optional keyword-based picking (sent by extension)
    keywords: Optional[List[str]] = None
    post_limit: Optional[int] = None

    # Định danh job/worker khi bài viết đến từ hàng đợi multi-VPS (không bắt buộc,
    # extension cũ/luồng thủ công không gửi field này vẫn hoạt động bình thường).
    job_id: Optional[str] = None
    worker_id: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_keywords(cls, data):
        """
        Chuẩn hoá field keyword từ nhiều biến thể tên/kiểu dữ liệu khác nhau
        mà extension có thể gửi, gộp hết về đúng field `keywords: List[str]`.

        Hỗ trợ:
        - keywords: ["a", "b"]           -> giữ nguyên
        - keywords: "a, b"               -> tách theo dấu phẩy
        - keyword: "a"                   -> map sang keywords=["a"]
        - search_keyword / search_keywords / kw / filter_keyword -> tương tự
        """
        if not isinstance(data, dict):
            return data

        existing = data.get("keywords")
        if isinstance(existing, list) and existing:
            # Đã có list hợp lệ, chỉ cần strip khoảng trắng
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
            existing,  # có thể là string thay vì list
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


def sync_process_and_save_posts_db(payload: ExtensionCrawlRequest, legacy: bool):
    """
    Chạy các lệnh Supabase (đồng bộ) trong một thread riêng để không block EventLoop của asyncio.
    Giúp tránh lỗi [WinError 10035] WSAEWOULDBLOCK trên Windows.
    """
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
        except Exception as e:
            logger.error(f"Error fetching group id for {group_url}: {e}")

    # group_id có thể vẫn là chuỗi rỗng nếu không resolve được (group_url lạ,
    # chưa có trong facebook_groups) -> Postgres từ chối "" cho cột UUID.
    # Chuẩn hoá về None để insert NULL thay vì crash cả batch.
    group_id = group_id or None

    # 2. Get existing post_urls to avoid duplicate insertion
    all_post_urls = [p.post_url or p.url for p in payload.posts if (p.post_url or p.url)]
    existing_urls = set()
    if all_post_urls:
        try:
            res_existing = supabase.table("facebook_posts").select("post_url").in_("post_url", all_post_urls).execute()
            existing_urls = {item["post_url"] for item in (res_existing.data or []) if item.get("post_url")}
        except Exception as e:
            logger.warning(f"Could not check existing urls in facebook_posts: {e}")


    # 4. Lọc bài viết: chỉ giữ bài TRONG NGÀY HÔM NAY (giờ Việt Nam UTC+7).
    # Toàn bộ logic chọn bài (keyword match + fallback theo tương tác) đều chạy
    # TRÊN TẬP NÀY - phạm vi luôn là "bài hôm nay", keyword chỉ dùng để ưu tiên/lọc
    # bên trong tập đó, không mở rộng ra các ngày khác.
    vietnam_tz = timezone(timedelta(hours=7))
    now_vn = datetime.now(vietnam_tz)
    today_vn_str = now_vn.strftime('%Y-%m-%d')

    today_posts = []  # List of (ext_post, raw_time_str)
    skipped_old = 0
    skipped_no_time = 0

    for p in payload.posts:
        post_url = p.post_url or p.url
        if not post_url or post_url in existing_urls:
            continue

        raw_time = p.timestamp_raw or p.date or None
        if not raw_time:
            skipped_no_time += 1
            continue

        try:
            # Extension gửi ISO: "2026-06-29T08:50:42.000Z"
            # Supabase lưu:      "2026-06-29 08:50:42+00"
            # Chuẩn hoá để Python fromisoformat() đọc được:
            clean = raw_time.replace('Z', '+00:00')   # bỏ Z
            clean = re.sub(r'\.\d+', '', clean)        # bỏ .000 milliseconds
            clean = clean.replace(' ', 'T')            # thay space bằng T nếu cần

            dt_utc = datetime.fromisoformat(clean)
            if dt_utc.tzinfo is None:
                dt_utc = dt_utc.replace(tzinfo=timezone.utc)

            dt_vn = dt_utc.astimezone(vietnam_tz)
            post_date_vn = dt_vn.strftime('%Y-%m-%d')

            if post_date_vn != today_vn_str:
                skipped_old += 1
                post_url_for_log = post_url or ''
                raw_time_for_log = raw_time
                logger.info(
                    "[FILTER-DEBUG-OLD] "
                    f"post_url={post_url_for_log} | "
                    f"raw_time={raw_time_for_log} | "
                    f"dt_utc={dt_utc.isoformat()} | "
                    f"dt_vn={dt_vn.isoformat()} | "
                    f"post_date_vn={post_date_vn} | today_vn_str={today_vn_str}"
                )
                continue

            today_posts.append((p, raw_time))
        except Exception as e:
            logger.warning(f"[DATE-FILTER] Không parse được '{raw_time}': {e}")
            skipped_no_time += 1
            continue

    logger.info(
        f"[FILTER] Tổng={len(payload.posts)} | Trùng URL={len(existing_urls)} "
        f"| Bài cũ (không phải hôm nay)={skipped_old} | Không có time={skipped_no_time} "
        f"| Bài HÔM NAY={len(today_posts)} (today_vn={today_vn_str})"
    )

    # Note: _pick_by_keywords_and_threshold cần: url, date, reactions/comments/shares/score, content
    keywords = payload.keywords or []
    post_limit = payload.post_limit
    candidate_posts = today_posts

    # 4b. Build map theo post_url để MAP NGƯỢC object gốc (có author_url/author_name/content đầy đủ)
    ext_post_by_url = {}
    for (ext_post, _raw_time) in candidate_posts:
        p_url = ext_post.post_url or ext_post.url
        if p_url:
            ext_post_by_url[p_url] = ext_post

    # Helper để map ngược từ FBPost(url=...) về object extension gốc
    def get_ext_post_by_fb_url(fb_url: str) -> Optional[ExtensionPost]:
        return ext_post_by_url.get(fb_url)



    # 5. Build FB Post objects để tái sử dụng keyword picker
    # NOTE: FBPost model chỉ có url/date/reactions/comments/shares/score/content/media/images
    # KHÔNG có author_url/author_name => sau khi picker chọn xong phải map ngược object gốc theo post_url.

    logger.info(
        "[KEYWORD-CHECK] payload.keywords=%s | post_limit=%s | candidate_count=%s",
        keywords,
        post_limit,
        len(candidate_posts),
    )

    posts_in_day: list[FBPost] = []
    for (ext_post, raw_time) in candidate_posts:
        post_url = ext_post.post_url or ext_post.url
        if not post_url:
            continue

        reactions = ext_post.reactions or 0
        comments = ext_post.comments or 0
        shares = ext_post.shares or 0
        score = comments * 2 + reactions + shares * 3

        # _pick_by_keywords_and_threshold dùng p.content + p.url + p.score
        # p.date dùng cho các logic calendar nếu có (ở đây ta đã lọc hôm nay rồi)
        fb_post = FBPost(
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
        posts_in_day.append(fb_post)

    # 6. Gọi lại picker keyword/thresh
    selected_posts = _pick_by_keywords_and_threshold(
        posts_in_day=posts_in_day,
        keywords=keywords,
        post_limit=post_limit,
    )

    top_posts_objects = selected_posts


    # 7. Resolve authors (chỉ lấy tác giả cho những bài top 3 sẽ lưu)
    # LƯU Ý: top_posts_objects không có author_url/author_name (coming from picker FBPost model)
    # -> map ngược theo post_url về ExtensionPost gốc để lấy author fields.
    top_ext_posts: list[ExtensionPost] = []
    for p in top_posts_objects:
        fb_url = p.url
        ext_post = get_ext_post_by_fb_url(fb_url) if fb_url else None
        if ext_post:
            top_ext_posts.append(ext_post)
        else:
            logger.warning(f"[AUTHOR] Không map ngược ExtensionPost cho fb_url={fb_url}")

    author_urls = [
        p.author_url
        for p in top_ext_posts
        if p.author_url and str(p.author_url).strip()
    ]
    author_map = {}

    if author_urls:
        try:
            res_authors = supabase.table("author_post").select("id, url_profile").in_("url_profile", author_urls).execute()
            author_map = {item["url_profile"]: item["id"] for item in (res_authors.data or [])}
            logger.info(f"[AUTHOR] Tìm thấy {len(author_map)} tác giả đã có trong DB cho top 3")
        except Exception as e:
            logger.warning(f"Error fetching authors: {e}")

    new_authors = []
    # Tạo author new theo ExtensionPost gốc
    for p in top_ext_posts:
        url = p.author_url.strip() if p.author_url else ""
        name = p.author_name.strip() if p.author_name else ""

        logger.info(f"[AUTHOR-DEBUG] author_name='{name}' | author_url='{url}'")
        
        if url and url not in author_map:
            new_id = str(uuid.uuid4())
            author_map[url] = new_id
            new_authors.append({
                "id": new_id,
                "name": name or "Ẩn danh",
                "url_profile": url,
                "create_at": now_iso
            })
        elif not url and name and name not in ("Ẩn danh", ""):
            fallback_key = f"__name__{name}"
            if fallback_key not in author_map:
                new_id = str(uuid.uuid4())
                author_map[fallback_key] = new_id
                new_authors.append({
                    "id": new_id,
                    "name": name,
                    "url_profile": fallback_key,
                    "create_at": now_iso
                })
            
    if new_authors:
        unique_new_authors = list({a["url_profile"]: a for a in new_authors}.values())
        logger.info(f"[AUTHOR] Đang insert {len(unique_new_authors)} tác giả mới cho top 3")
        inserted_author_urls = set()
        try:
            supabase.table("author_post").insert(unique_new_authors, upsert=False).execute()
            inserted_author_urls = {a["url_profile"] for a in unique_new_authors}
            logger.info(f"[AUTHOR] Insert thành công {len(inserted_author_urls)} tác giả")
        except Exception as e:
            logger.warning(f"[AUTHOR] Insert author lỗi: {e} — Đang thử insert từng người một...")
            for a in unique_new_authors:
                try:
                    supabase.table("author_post").insert(a).execute()
                    inserted_author_urls.add(a["url_profile"])
                except Exception as e2:
                    logger.warning(f"[AUTHOR] Bỏ qua '{a['url_profile']}': {e2}")
        
        for a in unique_new_authors:
            if a["url_profile"] not in inserted_author_urls:
                author_map.pop(a["url_profile"], None)
                logger.warning(f"[AUTHOR] Đã xoá UUID ảo cho '{a['url_profile']}' khỏi author_map")

    # 8. Chuẩn bị dữ liệu để insert vào Supabase
    posts_to_insert = []
    for p in top_posts_objects:
        post_url = p.url

        # top_posts_objects đến từ keyword picker (FBPost)
        author_url_key = (p.author_url or "").strip()
        author_name_key = (p.author_name or "").strip()
        # Tìm id_author: ưu tiên URL, sau đó fallback theo tên
        id_author = (
            author_map.get(author_url_key) or
            (author_map.get(f"__name__{author_name_key}") if author_name_key and author_name_key not in ("Ẩn danh", "") else None)
        )
        logger.info(f"[SAVE-AUTHOR] post={post_url[:60]} | author_url='{author_url_key}' | id_author={id_author}")
        # debug để verify content và mapping keyword
        ext_dbg = get_ext_post_by_fb_url(post_url)

        if ext_dbg:
            logger.info(
                "[SAVE-DEBUG] post_url=%s | author_url=%s | keyword_content_preview=%r",
                post_url,
                (ext_dbg.author_url or "").strip(),
                (ext_dbg.content or "")[:120],
            )

        post_data = {
            "group_id": group_id,
            "post_url": post_url,
            "crawl_date": now_iso,
            "post_time": p.date,

            "content": p.content,
            "score": 0,
            "reactions": p.reactions,
            "comments": p.comments,
            "shares": p.shares,
            "media_url": (p.video_url or p.media_url),
            "image_urls": p.images or [],
            "created_at": (p.crawled_at if legacy else now_iso),
            "updated_at": now_iso,
            "id_author": id_author,
            "id_member": payload.id_member or None
        }

        posts_to_insert.append(post_data)

        logger.info(f"[SAVE] Sẽ lưu {len(posts_to_insert)} bài (top 3 hôm nay) vào DB")

    inserted_count = 0
    inserted_post_urls = []
    if posts_to_insert:
        try:
            # upsert + ignore_duplicates: existing_urls ở trên lọc theo snapshot lúc ĐẦU
            # request (TOCTOU race nếu 2 lần cào trùng group gần như đồng thời cùng tìm
            # ra 1 bài) — UNIQUE(post_url) (migration 158) + ON CONFLICT DO NOTHING làm
            # backstop ở tầng DB, không còn phụ thuộc hoàn toàn vào pre-check tầng app.
            res = supabase.table("facebook_posts").upsert(posts_to_insert, on_conflict="post_url", ignore_duplicates=True).execute()
            inserted_count = len(res.data or [])
            if res.data:
                inserted_post_urls = [p.get("post_url") for p in res.data if p.get("post_url")]
        except Exception as e:
            logger.error(f"Error saving to facebook_posts: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return inserted_count, inserted_post_urls

async def process_and_save_posts(payload: ExtensionCrawlRequest, event_name: str, legacy: bool = False):
    # Offload sync Supabase DB calls to a separate thread to prevent blocking Uvicorn Asyncio EventLoop
    inserted_count, inserted_post_urls = await asyncio.to_thread(sync_process_and_save_posts_db, payload, legacy)

    if payload.job_id:
        try:
            queue_service.complete_job(
                payload.job_id,
                success=True,
                worker_id=payload.worker_id,
                result_count=inserted_count,
            )
        except Exception as e:
            logger.warning(f"[CRAWL-QUEUE] Không đóng được job {payload.job_id}: {e}")

    # Realtime WebSocket Broadcast
    msg_prefix = "Legacy: " if legacy else ""
    await manager.broadcast({
        "event": event_name,
        "platform": "facebook",
        "group_url": payload.group_url,
        "group_name": payload.group_name,
        "posts_count": inserted_count,
        "post_urls": inserted_post_urls,
        "message": f"{msg_prefix}Đã lưu {inserted_count} bài viết từ {payload.group_name}"
    })

    return {"success": True, "count": inserted_count, "post_urls": inserted_post_urls}


async def _log_raw_body_debug(request: Request) -> None:
    """
    Log toàn bộ raw JSON body gửi lên, để xác định chính xác tên field keyword
    thật sự mà extension đang gửi (dùng để chẩn đoán, có thể xoá sau khi đã
    xác nhận field name chuẩn và dọn code normalize_keywords cho gọn).
    """
    try:
        raw_body = await request.body()
        raw_dict = _json.loads(raw_body)
        top_level_keys = list(raw_dict.keys())
        keyword_like_fields = {
            k: v for k, v in raw_dict.items()
            if any(tok in k.lower() for tok in ("key", "kw", "search"))
        }
        logger.info(
            "[RAW-BODY-DEBUG] top_level_keys=%s | keyword_like_fields=%s",
            top_level_keys,
            keyword_like_fields,
        )
    except Exception as e:
        logger.warning(f"[RAW-BODY-DEBUG] Không parse được raw body: {e}")


@router.post("/save-posts")
async def save_posts(
    request: Request,
    payload: ExtensionCrawlRequest,
    x_api_key: Optional[str] = Header(None)
):
    """Lưu bài viết vào bảng facebook_posts (schema mới)."""
    if x_api_key != "markee-extension-key-2024":
        logger.warning(f"Invalid API Key: {x_api_key}")
        raise HTTPException(status_code=403, detail="Invalid API Key")

    await _log_raw_body_debug(request)
    logger.info("[KEYWORD-FINAL] payload.keywords sau khi validate = %s", payload.keywords)

    return await process_and_save_posts(payload, event_name="extension_crawl_saved", legacy=False)

@router.post("/crawl-result")
async def crawl_result(
    request: Request,
    payload: ExtensionCrawlRequest,
    x_api_key: Optional[str] = Header(None)
):
    """Lưu bài viết vào bảng facebook_posts (Legacy)."""
    if x_api_key != "markee-extension-key-2024":
        logger.warning(f"Invalid API Key: {x_api_key}")
        raise HTTPException(status_code=403, detail="Invalid API Key")

    await _log_raw_body_debug(request)
    logger.info("[KEYWORD-FINAL] payload.keywords sau khi validate = %s", payload.keywords)

    return await process_and_save_posts(payload, event_name="extension_crawl_saved_legacy", legacy=True)