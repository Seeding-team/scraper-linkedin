"""Extension crawl router (Threads) — nhận bài viết cào bằng "Markee Seeding Extension" (lệnh MK_TH_CRAWL_*).

Auth bằng `x-api-key` giống hệt Facebook/LinkedIn (`extension_crawl.py`,
`extension_crawl_linkedin.py`). Mỗi request = kết quả tìm kiếm của đúng 1 từ khoá.
"""

from __future__ import annotations

import asyncio
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.logger import get_logger
from app.modules.all_platform.services.supabase_threads_extension_crawl_service import (
    TABLE,
    save_threads_crawl_batch,
)
from app.modules.all_platform.services.lead_score_service import score_and_save_posts
from app.modules.all_platform.services import threads_keyword_service
from app.modules.all_platform.websocket import manager

logger = get_logger(__name__)

router = APIRouter()

EXTENSION_API_KEY = "markee-extension-key-2024"


@router.get("/keywords")
async def get_keywords(topic_ids: Optional[str] = None) -> dict:
    """Danh sách từ khoá/chủ đề Threads đang active.
    Ưu tiên lấy từ Thư viện từ khoá người dùng đã tạo (bảng categories, category_type='keyword_item',
    lọc theo topic_ids nếu có). Chỉ fallback sang threads_keyword_registry khi thư viện trống."""
    try:
        from app.core.supabase_client import get_supabase_client
        supabase = get_supabase_client()
        query = (
            supabase.table("categories")
            .select("name, code, is_active")
            .eq("category_type", "keyword_item")
        )
        if topic_ids and topic_ids.strip():
            clean_tids = [t.strip() for t in topic_ids.split(",") if t.strip()]
            if clean_tids:
                query = query.in_("code", clean_tids)
        res = query.order("created_at", desc=False).execute()
        lib_keywords: list[str] = []
        seen: set[str] = set()
        for row in (res.data or []):
            if row.get("is_active") is False:
                continue
            kw = str(row.get("name") or "").strip()
            if kw and kw.lower() not in seen:
                seen.add(kw.lower())
                lib_keywords.append(kw)
        if lib_keywords or (topic_ids and topic_ids.strip()):
            return {"success": True, "data": {"keywords": lib_keywords}}
    except Exception as e:
        logger.warning(f"[THREADS-KEYWORDS] Lỗi đọc thư viện từ khoá categories: {e}")

    try:
        await threads_keyword_service.ensure_daily_expansion()
    except Exception as e:
        logger.warning(f"[THREADS-KEYWORDS] ensure_daily_expansion lỗi (bỏ qua): {e}")
    rows = threads_keyword_service.get_active_keywords()
    return {"success": True, "data": {"keywords": [r["keyword"] for r in rows if r.get("keyword")]}}


class ThreadsExtensionPost(BaseModel):
    post_url: str
    author_username: Optional[str] = ""
    author_name: Optional[str] = ""
    content: Optional[str] = ""
    # ISO 8601 (extension đổi từ taken_at unix seconds của Threads).
    post_time: Optional[str] = None
    reactions: Optional[int] = 0
    comments: Optional[int] = 0
    shares: Optional[int] = 0
    image_urls: Optional[List[str]] = None
    media_url: Optional[str] = None


class ThreadsExtensionCrawlRequest(BaseModel):
    posts: List[ThreadsExtensionPost]
    keyword: Optional[str] = None
    id_member: Optional[str] = None
    post_limit: Optional[int] = Field(default=None, ge=1)
    max_age_days: Optional[int] = Field(default=None, ge=1)
    extension_version: Optional[str] = None


@router.post("/save-posts")
async def save_posts(
    payload: ThreadsExtensionCrawlRequest,
    x_api_key: Optional[str] = Header(None),
):
    """Lưu bài Threads vào `threads_posts` (dedupe theo post_url, lọc bài cũ, giới hạn số bài)."""
    if x_api_key != EXTENSION_API_KEY:
        logger.warning("[THREADS-EXT] Invalid API Key: %s", x_api_key)
        raise HTTPException(status_code=403, detail="Invalid API Key")

    try:
        result = await asyncio.to_thread(
            save_threads_crawl_batch,
            posts=[p.model_dump() for p in payload.posts],
            keyword=payload.keyword,
            id_member=payload.id_member,
            post_limit=payload.post_limit,
            max_age_days=payload.max_age_days,
        )
    except Exception as e:
        logger.exception("[THREADS-EXT] Lỗi lưu bài Threads (keyword=%r)", payload.keyword)
        raise HTTPException(status_code=500, detail=str(e))

    # Cham diem "tiem nang seeding" (LLM) - khac FB/LI (fire-and-forget): o day AWAIT truc
    # tiep de biet duoc KET QUA (bao nhieu bai diem cao) ngay, dung cap nhat hieu qua tu
    # khoa vao registry (threads_keyword_service.record_keyword_result) - xem module do.
    # Field noi bo, khong duoc tra ve qua HTTP cho extension.
    inserted_rows = result.pop("_inserted_rows", [])
    if inserted_rows:
        score_summary = await score_and_save_posts(TABLE, inserted_rows, id_member=payload.id_member, keywords=[payload.keyword] if payload.keyword else None)
        if payload.keyword:
            threads_keyword_service.record_keyword_result(
                payload.keyword, score_summary.get("total", 0), score_summary.get("high", 0)
            )

    # involved_users: de GlobalCrawlNotification.tsx chi hien cho dung nguoi dang cao (+
    # admin), khong lam phien cac thanh vien khac dang dung app (bug 2026-10-01).
    await manager.broadcast({
        "event": "extension_threads_crawl_saved",
        "platform": "threads",
        "keyword": payload.keyword,
        "posts_count": result["count"],
        "post_urls": result["post_urls"],
        "message": f"Đã lưu {result['count']} bài Threads cho từ khoá '{payload.keyword or ''}'",
        "involved_users": [payload.id_member] if payload.id_member else [],
    })

    return result
