"""Extension crawl router (YouTube) — nhận video cào bằng "Markee Seeding Extension" (lệnh MK_YT_CRAWL_*).

Auth bằng `x-api-key` giống hệt Facebook/LinkedIn/Threads. Mỗi request = kết quả tìm kiếm của
đúng 1 từ khoá, hoặc 1 lô link video người dùng dán thẳng vào (`direct_links=true`).
"""

from __future__ import annotations

import asyncio
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.logger import get_logger
from app.modules.all_platform.routers.extension_crawl_threads import EXTENSION_API_KEY
from app.modules.all_platform.services.supabase_youtube_extension_crawl_service import (
    save_youtube_crawl_batch,
)
from app.modules.all_platform.websocket import manager

logger = get_logger(__name__)

router = APIRouter()


class YouTubeExtensionVideo(BaseModel):
    post_url: Optional[str] = None
    video_id: Optional[str] = None
    is_short: Optional[bool] = False
    title: Optional[str] = ""
    description: Optional[str] = ""
    author_name: Optional[str] = ""
    channel_id: Optional[str] = None
    channel_handle: Optional[str] = None
    author_url: Optional[str] = None
    # ISO 8601 — chính xác (publishDate trang video) hoặc ước lượng từ "2 ngày trước" (trang tìm kiếm).
    post_time: Optional[str] = None
    published_text: Optional[str] = None
    duration_text: Optional[str] = None
    view_count: Optional[int] = 0
    reactions: Optional[int] = 0
    comments: Optional[int] = 0
    image_urls: Optional[List[str]] = None


class YouTubeExtensionCrawlRequest(BaseModel):
    posts: List[YouTubeExtensionVideo]
    keyword: Optional[str] = None
    direct_links: bool = False
    id_member: Optional[str] = None
    post_limit: Optional[int] = Field(default=None, ge=1)
    max_age_days: Optional[int] = Field(default=None, ge=1)
    extension_version: Optional[str] = None


@router.post("/save-videos")
async def save_videos(
    payload: YouTubeExtensionCrawlRequest,
    x_api_key: Optional[str] = Header(None),
):
    """Lưu video YouTube vào `youtube_posts` (dedupe theo video_id, lọc video cũ, giới hạn số video)."""
    if x_api_key != EXTENSION_API_KEY:
        logger.warning("[YOUTUBE-EXT] Invalid API Key: %s", x_api_key)
        raise HTTPException(status_code=403, detail="Invalid API Key")

    try:
        result = await asyncio.to_thread(
            save_youtube_crawl_batch,
            posts=[p.model_dump() for p in payload.posts],
            keyword=payload.keyword,
            id_member=payload.id_member,
            post_limit=payload.post_limit,
            max_age_days=payload.max_age_days,
            direct_links=payload.direct_links,
        )
    except Exception as e:
        logger.exception("[YOUTUBE-EXT] Lỗi lưu video YouTube (keyword=%r)", payload.keyword)
        raise HTTPException(status_code=500, detail=str(e))

    label = "link dán tay" if payload.direct_links else f"từ khoá '{payload.keyword or ''}'"
    await manager.broadcast({
        "event": "extension_youtube_crawl_saved",
        "platform": "youtube",
        "keyword": payload.keyword,
        "posts_count": result["count"],
        "post_urls": result["post_urls"],
        "message": f"Đã lưu {result['count']} video YouTube cho {label}",
    })

    return result
