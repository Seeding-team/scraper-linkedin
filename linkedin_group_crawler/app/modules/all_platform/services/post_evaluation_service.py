"""Service handling Post Evaluation (Quick Review) and Evaluation History."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

POST_REVIEW_COLUMNS = (
    "id, post_id, platform, evaluation_code, reason, summary, "
    "exclude_keyword_exempt, evaluated_by, evaluated_at, created_at, updated_at, "
    "evaluated_by_user:app_users!evaluated_by(id, name, email)"
)


def _normalize_review(row: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Chuẩn hoá object review, đảm bảo evaluated_by_user luôn nhất quán."""
    if not row:
        return row
    user_obj = row.pop("app_users", None)
    if user_obj and "evaluated_by_user" not in row:
        row["evaluated_by_user"] = user_obj
    return row


def get_review(post_id: str, platform: str = "facebook") -> Optional[dict[str, Any]]:
    """Lấy bản ghi đánh giá hiện tại của 1 bài viết theo post_id và platform."""
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("post_quick_review")
        .select(POST_REVIEW_COLUMNS)
        .eq("post_id", str(post_id))
        .eq("platform", str(platform))
        .maybe_single()
        .execute()
    )
    return _normalize_review(res.data) if res and res.data else None


def get_reviews_by_post_ids(post_ids: list[str], platform: Optional[str] = None) -> dict[str, dict[str, Any]]:
    """Lấy map post_id -> review cho danh sách bài viết (dùng cho hiển thị bảng feed)."""
    if not post_ids:
        return {}

    supabase = get_supabase_client()
    query = supabase.table("post_quick_review").select(POST_REVIEW_COLUMNS).in_("post_id", post_ids)
    if platform:
        query = query.eq("platform", platform)

    res = execute_supabase_query(lambda: query.execute())
    rows = res.data or []
    return {str(r["post_id"]): _normalize_review(r) for r in rows}


def update_evaluation(
    post_id: str,
    payload: dict[str, Any],
    user: dict[str, Any],
) -> dict[str, Any]:
    """Cập nhật đánh giá cho 1 bài viết (upsert post_quick_review + append history)."""
    supabase = get_supabase_client()
    platform = payload.get("platform") or "facebook"
    new_code = payload.get("evaluation_code") or "can-lien-he"
    reason = payload.get("reason")
    summary = payload.get("summary")
    exempt = payload.get("exclude_keyword_exempt")
    user_id = user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Lấy trạng thái đánh giá cũ
    existing = get_review(post_id, platform)
    previous_code = existing.get("evaluation_code") if existing else None

    # 2. Chuẩn bị payload upsert
    upsert_data: dict[str, Any] = {
        "post_id": str(post_id),
        "platform": platform,
        "evaluation_code": new_code,
        "evaluated_by": user_id,
        "evaluated_at": now_iso,
        "updated_at": now_iso,
    }
    if reason is not None:
        upsert_data["reason"] = reason
    if summary is not None:
        upsert_data["summary"] = summary
    if exempt is not None:
        upsert_data["exclude_keyword_exempt"] = bool(exempt)
    elif existing is not None:
        upsert_data["exclude_keyword_exempt"] = existing.get("exclude_keyword_exempt", False)

    res = execute_supabase_query(
        lambda: supabase.table("post_quick_review")
        .upsert(upsert_data, on_conflict="post_id,platform")
        .execute()
    )
    saved_review = res.data[0] if res.data else upsert_data

    # 3. Ghi log lịch sử (append-only)
    history_entry = {
        "post_id": str(post_id),
        "platform": platform,
        "previous_evaluation_code": previous_code,
        "evaluation_code": new_code,
        "reason": reason,
        "action_type": "manual",
        "evaluated_by": user_id,
        "created_at": now_iso,
    }
    execute_supabase_query(
        lambda: supabase.table("post_evaluation_history").insert(history_entry).execute()
    )

    fresh = get_review(post_id, platform)
    return fresh if fresh else saved_review


def batch_reject(
    post_ids: list[str],
    user: dict[str, Any],
    platform: Optional[str] = None,
    reason: Optional[str] = "Hoàn tất trang Review Nhanh",
) -> dict[str, Any]:
    """Review Nhanh: gán hàng loạt 'khong-phu-hop' cho các bài được chỉ định.

    Trả về undo_token (chính là batch_id) để người dùng có thể hoàn tác ngay lập tức.
    """
    if not post_ids:
        return {"undo_token": None, "affected_count": 0, "message": "Danh sách post_ids rỗng"}

    supabase = get_supabase_client()
    batch_id = str(uuid.uuid4())
    user_id = user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()
    resolved_platform = platform or "facebook"

    # Lấy các review hiện tại để lưu previous_evaluation_code
    current_reviews_res = execute_supabase_query(
        lambda: supabase.table("post_quick_review")
        .select("post_id, evaluation_code, exclude_keyword_exempt")
        .in_("post_id", post_ids)
        .eq("platform", resolved_platform)
        .execute()
    )
    current_map = {str(r["post_id"]): r for r in (current_reviews_res.data or [])}

    upsert_rows = []
    history_rows = []

    for pid in post_ids:
        pid_str = str(pid)
        curr = current_map.get(pid_str)
        prev_code = curr.get("evaluation_code") if curr else None

        upsert_rows.append({
            "post_id": pid_str,
            "platform": resolved_platform,
            "evaluation_code": "khong-phu-hop",
            "reason": reason,
            "exclude_keyword_exempt": curr.get("exclude_keyword_exempt", False) if curr else False,
            "evaluated_by": user_id,
            "evaluated_at": now_iso,
            "updated_at": now_iso,
        })

        history_rows.append({
            "post_id": pid_str,
            "platform": resolved_platform,
            "previous_evaluation_code": prev_code,
            "evaluation_code": "khong-phu-hop",
            "reason": reason,
            "batch_id": batch_id,
            "action_type": "batch_reject",
            "evaluated_by": user_id,
            "created_at": now_iso,
        })

    if upsert_rows:
        execute_supabase_query(
            lambda: supabase.table("post_quick_review")
            .upsert(upsert_rows, on_conflict="post_id,platform")
            .execute()
        )
    if history_rows:
        execute_supabase_query(
            lambda: supabase.table("post_evaluation_history").insert(history_rows).execute()
        )

    logger.info("batch_reject completed batch_id=%s count=%d", batch_id, len(upsert_rows))
    return {
        "undo_token": batch_id,
        "batch_id": batch_id,
        "affected_count": len(upsert_rows),
    }


def undo_batch_reject(undo_token: str, user: dict[str, Any]) -> dict[str, Any]:
    """Khôi phục đúng 1 bước lùi gần nhất dựa trên undo_token (batch_id)."""
    if not undo_token:
        raise ValueError("undo_token là bắt buộc.")

    supabase = get_supabase_client()
    user_id = user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()

    # Tìm các bản ghi history ứng với batch_id này
    hist_res = execute_supabase_query(
        lambda: supabase.table("post_evaluation_history")
        .select("post_id, platform, previous_evaluation_code, evaluation_code")
        .eq("batch_id", undo_token)
        .eq("action_type", "batch_reject")
        .execute()
    )
    history_items = hist_res.data or []
    if not history_items:
        return {"restored_count": 0, "message": "Không tìm thấy phiên batch cần hoàn tác hoặc đã hoàn tác."}

    restored_count = 0
    new_history_entries = []

    for item in history_items:
        post_id = item["post_id"]
        platform = item["platform"]
        prev_code = item.get("previous_evaluation_code")

        if prev_code:
            # Khôi phục trạng thái cũ
            execute_supabase_query(
                lambda p=post_id, pl=platform, c=prev_code: supabase.table("post_quick_review")
                .update({
                    "evaluation_code": c,
                    "updated_at": now_iso,
                    "evaluated_by": user_id,
                })
                .eq("post_id", p)
                .eq("platform", pl)
                .execute()
            )
        else:
            # Trước đó chưa từng được đánh giá -> Xóa bản ghi review
            execute_supabase_query(
                lambda p=post_id, pl=platform: supabase.table("post_quick_review")
                .delete()
                .eq("post_id", p)
                .eq("platform", pl)
                .execute()
            )

        new_history_entries.append({
            "post_id": post_id,
            "platform": platform,
            "previous_evaluation_code": "khong-phu-hop",
            "evaluation_code": prev_code or "chua-danh-gia",
            "reason": f"Hoàn tác batch_id={undo_token}",
            "batch_id": undo_token,
            "action_type": "undo",
            "evaluated_by": user_id,
            "created_at": now_iso,
        })
        restored_count += 1

    if new_history_entries:
        execute_supabase_query(
            lambda: supabase.table("post_evaluation_history").insert(new_history_entries).execute()
        )

    logger.info("undo_batch_reject completed batch_id=%s restored=%d", undo_token, restored_count)
    return {
        "undo_token": undo_token,
        "restored_count": restored_count,
        "message": f"Đã hoàn tác đánh giá cho {restored_count} bài viết.",
    }

