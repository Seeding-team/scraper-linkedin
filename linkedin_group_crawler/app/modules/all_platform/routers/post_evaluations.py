"""Post evaluations router — Shared persistent storage for post ratings across all users."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional
from datetime import datetime, timezone
from loguru import logger
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.modules.all_platform.schemas import BaseResponse

router = APIRouter(prefix="/posts", tags=["Post Evaluations"])

def _get_storage_path() -> Path:
    base = Path(os.getcwd())
    storage_dir = base / "artifacts" / "post-evaluations"
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir / "evaluations.json"

def _load_evaluations() -> Dict[str, Dict[str, Any]]:
    p = _get_storage_path()
    if not p.exists():
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading post evaluations: {e}")
        return {}

def _save_evaluations(data: Dict[str, Dict[str, Any]]) -> None:
    p = _get_storage_path()
    try:
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Error saving post evaluations: {e}")


class SavePostEvaluationRequest(BaseModel):
    post_id: str
    post_url: Optional[str] = None
    status: str
    user_email: Optional[str] = None


@router.get("/evaluations", response_model=BaseResponse)
def get_all_post_evaluations() -> BaseResponse:
    """Lấy toàn bộ map đánh giá bài viết dùng chung cho tất cả các thành viên (Admin, Leader, Staff)."""
    try:
        stored = _load_evaluations()
        result_map: Dict[str, str] = {}
        for k, v in stored.items():
            st = v.get("status") if isinstance(v, dict) else str(v)
            if st:
                result_map[k] = st
        return BaseResponse(success=True, data=result_map, message="Loaded post evaluations")
    except Exception as e:
        logger.error(f"Failed to get post evaluations: {e}")
        return BaseResponse(success=False, data={}, message=str(e))


@router.post("/evaluations", response_model=BaseResponse)
def save_post_evaluation(payload: SavePostEvaluationRequest) -> BaseResponse:
    """Lưu đánh giá bài viết và chia sẻ đồng bộ cho toàn bộ hệ thống."""
    try:
        pid = (payload.post_id or "").strip()
        purl = (payload.post_url or "").strip()
        status = (payload.status or "chua_danh_gia").strip()
        email = (payload.user_email or "unknown").strip()

        if not pid and not purl:
            raise HTTPException(status_code=400, detail="Thiếu post_id hoặc post_url")

        stored = _load_evaluations()
        now_str = datetime.now(timezone.utc).isoformat()
        item = {
            "status": status,
            "evaluated_by": email,
            "updated_at": now_str,
        }

        if pid:
            stored[pid] = item
        if purl:
            stored[purl] = item

        _save_evaluations(stored)
        return BaseResponse(success=True, message=f"Đã lưu đánh giá {status}", data=item)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save post evaluation: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/cleanup-feed", response_model=BaseResponse)
def cleanup_feed() -> BaseResponse:
    """Quét và xóa sạch các bài viết trùng lặp nội dung và bài viết đối thủ chào hàng
    hiện có trong Database (Facebook, Threads, LinkedIn)."""
    try:
        from app.core.supabase_client import get_supabase_client
        from app.modules.all_platform.services.post_deduplication_service import (
            cleanup_duplicate_posts_in_table,
            cleanup_competitor_posts_in_table,
        )
        supabase = get_supabase_client()
        res_fb_dup = cleanup_duplicate_posts_in_table(supabase, "facebook_posts")
        res_fb_comp = cleanup_competitor_posts_in_table(supabase, "facebook_posts")

        res_th_dup = cleanup_duplicate_posts_in_table(supabase, "threads_posts")
        res_th_comp = cleanup_competitor_posts_in_table(supabase, "threads_posts")

        res_li_dup = cleanup_duplicate_posts_in_table(supabase, "linkedin_posts")
        res_li_comp = cleanup_competitor_posts_in_table(supabase, "linkedin_posts")

        summary = {
            "facebook": {"deleted_duplicates": res_fb_dup, "deleted_competitors": res_fb_comp},
            "threads": {"deleted_duplicates": res_th_dup, "deleted_competitors": res_th_comp},
            "linkedin": {"deleted_duplicates": res_li_dup, "deleted_competitors": res_li_comp},
            "total_deleted": (res_fb_dup + res_fb_comp + res_th_dup + res_th_comp + res_li_dup + res_li_comp),
        }
        logger.info(f"[CLEANUP-FEED] Hoàn thành dọn dẹp feed: {summary}")
        return BaseResponse(success=True, message=f"Đã xoá {summary['total_deleted']} bài rác/trùng/đối thủ!", data=summary)
    except Exception as e:
        logger.error(f"[CLEANUP-FEED] Lỗi dọn dẹp feed: {e}")
        return BaseResponse(success=False, message=str(e))
