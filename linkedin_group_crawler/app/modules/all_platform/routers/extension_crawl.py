"""Extension crawl router — handles extension-initiated crawl requests."""

from __future__ import annotations

import json as _json
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.modules.all_platform.services.lead_score_service import score_text_for_lead
from app.modules.all_platform.services.post_ingest_service import (
    ExtensionCrawlRequest,
    ExtensionPost,
    process_and_save_posts,
    sync_process_and_save_posts_db,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _log_raw_body_debug(request: Request) -> None:
    """Log incoming raw JSON keys & keyword aliases for extension payload diagnostics."""
    try:
        raw_body = await request.body()
        raw_dict = _json.loads(raw_body)
        top_level_keys = list(raw_dict.keys())
        keyword_like_fields = {
            k: v
            for k, v in raw_dict.items()
            if any(tok in k.lower() for tok in ("key", "kw", "search"))
        }
        logger.info(
            "[RAW-BODY-DEBUG] top_level_keys=%s | keyword_like_fields=%s",
            top_level_keys,
            keyword_like_fields,
        )
    except Exception as exc:
        logger.warning("[RAW-BODY-DEBUG] Không parse được raw body: %s", exc)


@router.post("/save-posts")
async def save_posts(
    request: Request,
    payload: ExtensionCrawlRequest,
    x_api_key: Optional[str] = Header(None),
):
    """Lưu bài viết vào bảng facebook_posts (schema mới)."""
    if x_api_key != "markee-extension-key-2024":
        logger.warning("Invalid API Key: %s", x_api_key)
        raise HTTPException(status_code=403, detail="Invalid API Key")

    await _log_raw_body_debug(request)
    logger.info("[KEYWORD-FINAL] payload.keywords sau khi validate = %s", payload.keywords)

    return await process_and_save_posts(payload, event_name="extension_crawl_saved", legacy=False)


@router.post("/crawl-result")
async def crawl_result(
    request: Request,
    payload: ExtensionCrawlRequest,
    x_api_key: Optional[str] = Header(None),
):
    """Lưu bài viết vào bảng facebook_posts (Legacy)."""
    if x_api_key != "markee-extension-key-2024":
        logger.warning("Invalid API Key: %s", x_api_key)
        raise HTTPException(status_code=403, detail="Invalid API Key")

    await _log_raw_body_debug(request)
    logger.info("[KEYWORD-FINAL] payload.keywords sau khi validate = %s", payload.keywords)

    return await process_and_save_posts(payload, event_name="extension_crawl_saved_legacy", legacy=True)


class ScorePostRequest(BaseModel):
    content: str
    post_id: Optional[str] = None
    author_name: Optional[str] = None


@router.post("/score-post")
async def score_single_post(payload: ScorePostRequest):
    """Chấm điểm tiềm năng bài viết tức thì (0-100) cho Extension."""
    result = await score_text_for_lead(payload.content)
    if not result:
        return {
            "success": False,
            "score": 0,
            "reason": "Chưa thể đánh giá hoặc nội dung rỗng",
            "need_category": None,
        }
    return {"success": True, **result}
