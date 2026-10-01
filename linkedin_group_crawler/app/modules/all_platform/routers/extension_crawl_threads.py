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
    save_threads_crawl_batch,
)
from app.modules.all_platform.websocket import manager

logger = get_logger(__name__)

router = APIRouter()

EXTENSION_API_KEY = "markee-extension-key-2024"


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
