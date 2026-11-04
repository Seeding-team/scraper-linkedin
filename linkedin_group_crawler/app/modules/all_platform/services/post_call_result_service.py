"""Service handling Post Call Results (Kết quả liên hệ, số lần gọi, thời điểm gọi gần nhất)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

POST_CALL_RESULT_COLUMNS = (
    "id, post_id, platform, result_code, attempts, last_call_at, updated_by, created_at, updated_at, "
    "updated_by_user:app_users!updated_by(id, name, email)"
)


def _normalize_call_result(row: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Chuẩn hoá object call result, đảm bảo updated_by_user luôn nhất quán."""
    if not row:
        return row
    user_obj = row.pop("app_users", None)
    if user_obj and "updated_by_user" not in row:
        row["updated_by_user"] = user_obj
    return row


def get_call_result(post_id: str, platform: str = "facebook") -> Optional[dict[str, Any]]:
    """Lấy bản ghi kết quả liên hệ hiện tại của 1 bài viết theo post_id và platform."""
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("post_call_results")
        .select(POST_CALL_RESULT_COLUMNS)
        .eq("post_id", str(post_id))
        .eq("platform", str(platform))
        .maybe_single()
        .execute()
    )
    return _normalize_call_result(res.data) if res and res.data else None


def get_call_results_by_post_ids(post_ids: list[str], platform: Optional[str] = None) -> dict[str, dict[str, Any]]:
    """Lấy map post_id -> call_result cho danh sách bài viết (dùng cho feed tổng hợp)."""
    if not post_ids:
        return {}

    supabase = get_supabase_client()
    query = supabase.table("post_call_results").select(POST_CALL_RESULT_COLUMNS).in_("post_id", post_ids)
    if platform:
        query = query.eq("platform", platform)

    res = execute_supabase_query(lambda: query.execute())
    rows = res.data or []
    return {str(r["post_id"]): _normalize_call_result(r) for r in rows}


def update_call_result(
    post_id: str,
    payload: dict[str, Any],
    user: dict[str, Any],
) -> dict[str, Any]:
    """Cập nhật kết quả liên hệ cho 1 bài viết (tự động tăng số lần gọi và lưu thời điểm gọi)."""
    supabase = get_supabase_client()
    platform = payload.get("platform") or "facebook"
    result_code = payload.get("result_code")
    user_id = user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()

    existing = get_call_result(post_id, platform)
    curr_attempts = int(existing.get("attempts") or 0) if existing else 0

    # Nếu người dùng chọn 1 kết quả liên hệ (khác rỗng) -> Tăng số lần gọi lên 1
    if result_code:
        next_attempts = curr_attempts + 1
        last_call = now_iso
    else:
        next_attempts = curr_attempts
        last_call = existing.get("last_call_at") if existing else None

    upsert_data: dict[str, Any] = {
        "post_id": str(post_id),
        "platform": platform,
        "result_code": str(result_code or ""),
        "attempts": next_attempts,
        "last_call_at": last_call,
        "updated_by": user_id,
        "updated_at": now_iso,
    }

    res = execute_supabase_query(
        lambda: supabase.table("post_call_results")
        .upsert(upsert_data, on_conflict="post_id,platform")
        .execute()
    )
    saved_result = res.data[0] if res.data else upsert_data
    fresh = get_call_result(post_id, platform)
    if fresh:
        saved_result = fresh
    logger.info(
        "update_call_result post_id=%s platform=%s result_code=%s attempts=%d",
        post_id,
        platform,
        result_code,
        next_attempts,
    )
    return saved_result

