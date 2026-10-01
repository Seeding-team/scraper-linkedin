"""Extension crawl router (LinkedIn) — nhận bài viết cào từ browser extension.

Tách riêng khỏi `crawl_linkedin.py` (dùng JWT Bearer + luồng Playwright/account password)
vì đây là bề mặt dành cho extension, auth bằng `x-api-key` giống hệt bên Facebook
(`extension_crawl.py`), không đụng tới `linkedin_account_crawl`/Playwright.
"""

from __future__ import annotations

import asyncio
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.core.logger import get_logger
from app.modules.all_platform.services.supabase_linkedin_extension_crawl_service import (
    save_extension_crawl_batch,
)

logger = get_logger(__name__)

router = APIRouter()

EXTENSION_API_KEY = "markee-extension-key-2024"


class LinkedInExtensionCommentItem(BaseModel):
    author_name: Optional[str] = ""
    author_url: Optional[str] = ""
    content: Optional[str] = ""
    likes: Optional[int] = 0


class LinkedInExtensionPost(BaseModel):
    post_url: str
    author: Optional[str] = ""
    content: Optional[str] = ""
    posted_at_raw: Optional[str] = ""
    likes: Optional[int] = 0
    comments: Optional[int] = 0
    reposts: Optional[int] = None
    shares: Optional[int] = None
    crawled_at: Optional[str] = None
    comments_list: Optional[List[LinkedInExtensionCommentItem]] = None
    likers: Optional[List[str]] = None


class LinkedInExtensionCrawlRequest(BaseModel):
    posts: List[LinkedInExtensionPost]
    group_url: str
    group_name: Optional[str] = None
    id_member: Optional[str] = None
    extension_version: Optional[str] = None


def _check_api_key(x_api_key: Optional[str]) -> None:
    if x_api_key != EXTENSION_API_KEY:
        logger.warning("[LI-EXT] Invalid API Key: %s", x_api_key)
        raise HTTPException(status_code=403, detail="Invalid API Key")


@router.post("/save-posts")
async def save_posts(
    payload: LinkedInExtensionCrawlRequest,
    x_api_key: Optional[str] = Header(None),
):
    """Lưu bài viết LinkedIn cào từ extension vào `linkedin_posts` (dedupe theo post_url)."""
    _check_api_key(x_api_key)

    posts = [
        {
            "post_url": p.post_url,
            "author": p.author,
            "content": p.content,
            "posted_at_raw": p.posted_at_raw,
            "likes": p.likes,
            "comments": p.comments,
            "shares": (p.reposts if p.reposts is not None else p.shares) or 0,
            "comments_detail": [c.model_dump() for c in (p.comments_list or [])],
            "likers": p.likers or [],
        }
        for p in payload.posts
    ]

    result = await asyncio.to_thread(
        save_extension_crawl_batch,
        posts=posts,
        group_url=payload.group_url,
        group_name=payload.group_name,
        id_member=payload.id_member,
    )
    return result
