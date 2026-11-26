"""Service handling Crawl Exclude Keywords, Proposals, and Dynamic Exclusion Flag."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.keyword_match import match_keywords

logger = logging.getLogger(__name__)

EXCLUDE_KEYWORD_COLUMNS = "id, keyword, platform, status, created_by, created_at, updated_at"
PROPOSAL_COLUMNS = (
    "id, keyword, reason, source_post_id, platform, status, "
    "proposed_by, reviewed_by, reviewed_at, created_at, updated_at"
)

# ── In-process Cache cho từ khóa loại trừ (TTL 60s, tương tự crm_permission_service) ──
_KEYWORDS_CACHE_TTL_SECONDS = 60.0
_KEYWORDS_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def clear_exclude_keywords_cache() -> None:
    """Xóa cache từ khóa loại trừ khi có thao tác thêm/xóa/duyệt mới."""
    _KEYWORDS_CACHE.clear()


def list_exclude_keywords(platform: Optional[str] = None, status: Optional[str] = "active") -> list[dict[str, Any]]:
    """Lấy danh sách từ khóa loại trừ (có cache TTL 60s cho truy vấn thông thường)."""
    cache_key = f"{platform or 'all'}:{status or 'all'}"
    now = time.monotonic()
    cached = _KEYWORDS_CACHE.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    supabase = get_supabase_client()
    query = supabase.table("crawl_exclude_keywords").select(EXCLUDE_KEYWORD_COLUMNS)
    if status:
        query = query.eq("status", status)
    if platform:
        # Lấy từ khóa riêng cho platform này HOẶC từ khóa dùng chung (platform IS NULL)
        query = query.or_(f"platform.eq.{platform},platform.is.null")

    res = execute_supabase_query(lambda: query.order("created_at", desc=True).execute())
    data = res.data or []

    _KEYWORDS_CACHE[cache_key] = (now + _KEYWORDS_CACHE_TTL_SECONDS, data)
    return data


def create_exclude_keyword(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    """Thêm một từ khóa loại trừ mới (Admin/Leader)."""
    keyword = str(payload.get("keyword") or "").strip()
    if not keyword:
        raise ValueError("Từ khóa không được để trống.")

    supabase = get_supabase_client()
    user_id = user.get("id")
    platform = payload.get("platform")
    status = payload.get("status") or "active"

    data = {
        "keyword": keyword,
        "platform": platform or None,
        "status": status,
        "created_by": user_id,
    }

    res = execute_supabase_query(
        lambda: supabase.table("crawl_exclude_keywords").insert(data).execute()
    )
    clear_exclude_keywords_cache()
    return res.data[0] if res.data else {}


def delete_exclude_keyword(keyword_id: str, user: dict[str, Any]) -> dict[str, Any]:
    """Xóa một từ khóa loại trừ (chỉ Admin)."""
    del user  # Auth check done at router level
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("crawl_exclude_keywords")
        .delete()
        .eq("id", keyword_id)
        .execute()
    )
    clear_exclude_keywords_cache()
    return {"deleted": len(res.data) if res.data else 1}


# ── Keyword Proposals (Đề xuất từ khóa) ──────────────────────────────────────


def create_proposal(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    """Tạo đề xuất từ khóa loại trừ từ bài viết nguồn (Member/Leader/Admin)."""
    keyword = str(payload.get("keyword") or "").strip()
    if not keyword:
        raise ValueError("Từ khóa đề xuất không được để trống.")

    supabase = get_supabase_client()
    user_id = user.get("id")
    data = {
        "keyword": keyword,
        "reason": payload.get("reason"),
        "source_post_id": str(payload.get("source_post_id") or ""),
        "platform": payload.get("platform"),
        "status": "pending",
        "proposed_by": user_id,
    }

    res = execute_supabase_query(
        lambda: supabase.table("crawl_keyword_proposals").insert(data).execute()
    )
    return res.data[0] if res.data else {}


def list_proposals(status: Optional[str] = "pending") -> list[dict[str, Any]]:
    """Xem danh sách đề xuất từ khóa (Admin xem pending để duyệt)."""
    supabase = get_supabase_client()
    query = supabase.table("crawl_keyword_proposals").select(
        f"{PROPOSAL_COLUMNS}, app_users!proposed_by(name, email)"
    )
    if status:
        query = query.eq("status", status)

    res = execute_supabase_query(lambda: query.order("created_at", desc=True).execute())
    rows = res.data or []

    # Flatten proposer info
    for r in rows:
        proposer = r.pop("app_users", None) or {}
        r["proposer_name"] = proposer.get("name") or proposer.get("email") or "Unknown"

    return rows


def approve_proposal(proposal_id: str, user: dict[str, Any]) -> dict[str, Any]:
    """Duyệt đề xuất: cập nhật proposal sang 'approved' và tự động thêm vào crawl_exclude_keywords."""
    supabase = get_supabase_client()
    user_id = user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()

    # Lấy proposal
    prop_res = execute_supabase_query(
        lambda: supabase.table("crawl_keyword_proposals")
        .select("*")
        .eq("id", proposal_id)
        .maybe_single()
        .execute()
    )
    proposal = prop_res.data if prop_res else None
    if not proposal:
        raise ValueError("Không tìm thấy đề xuất.")

    keyword = proposal["keyword"]
    platform = proposal.get("platform")

    # 1. Cập nhật trạng thái proposal
    execute_supabase_query(
        lambda: supabase.table("crawl_keyword_proposals")
        .update({
            "status": "approved",
            "reviewed_by": user_id,
            "reviewed_at": now_iso,
            "updated_at": now_iso,
        })
        .eq("id", proposal_id)
        .execute()
    )

    # 2. Thêm vào bảng crawl_exclude_keywords
    created_keyword = create_exclude_keyword({
        "keyword": keyword,
        "platform": platform,
        "status": "active",
    }, user)

    return {
        "proposal_id": proposal_id,
        "status": "approved",
        "created_keyword": created_keyword,
    }


def reject_proposal(proposal_id: str, reason: Optional[str], user: dict[str, Any]) -> dict[str, Any]:
    """Từ chối đề xuất: cập nhật proposal sang 'rejected' (giữ lại bản ghi để audit, không xóa)."""
    supabase = get_supabase_client()
    user_id = user.get("id")
    now_iso = datetime.now(timezone.utc).isoformat()

    res = execute_supabase_query(
        lambda: supabase.table("crawl_keyword_proposals")
        .update({
            "status": "rejected",
            "reason": reason or "Không phù hợp",
            "reviewed_by": user_id,
            "reviewed_at": now_iso,
            "updated_at": now_iso,
        })
        .eq("id", proposal_id)
        .execute()
    )
    return res.data[0] if res.data else {"id": proposal_id, "status": "rejected"}


def bulk_approve_proposals(proposal_ids: list[str], user: dict[str, Any]) -> dict[str, Any]:
    """Duyệt hàng loạt danh sách đề xuất từ khóa."""
    if not proposal_ids:
        return {"approved_count": 0, "message": "Danh sách rỗng."}

    approved = []
    failed = []

    for pid in proposal_ids:
        try:
            res = approve_proposal(pid, user)
            approved.append(res)
        except Exception as exc:
            failed.append({"id": pid, "error": str(exc)})

    return {
        "approved_count": len(approved),
        "failed_count": len(failed),
        "failed": failed,
    }


# ── Đánh giá động bài viết có bị loại trừ theo từ khóa hay không ────────────


def compute_excluded_flag(
    post: dict[str, Any],
    review: Optional[dict[str, Any]] = None,
    active_keywords: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Tính toán động xem bài viết có bị loại trừ do chứa từ khóa hay không.

    Quy tắc:
    1. Kiểm tra `exclude_keyword_exempt`: nếu bài đã được đánh giá và tick 'Miễn trừ từ khóa'
       -> KHÔNG loại trừ (is_excluded = False, exempt = True).
    2. Nếu không miễn trừ: quét nội dung bài viết với danh sách từ khóa loại trừ đang active.
    """
    # 1. Kiểm tra miễn trừ
    if review and review.get("exclude_keyword_exempt"):
        return {
            "is_excluded": False,
            "matched_keywords": [],
            "exempt": True,
        }

    platform = post.get("platform")
    if active_keywords is None:
        active_keywords = list_exclude_keywords(platform=platform, status="active")

    content = str(post.get("content") or "")
    # Ghép cả title / group_name / keyword nếu có để quét toàn diện
    search_keyword = str(post.get("search_keyword") or "")
    scan_text = f"{content} {search_keyword}".strip()

    keyword_strings = [
        str(kw.get("keyword") or "")
        for kw in active_keywords
        if kw.get("keyword")
    ]

    matched = match_keywords(scan_text, keyword_strings)
    return {
        "is_excluded": len(matched) > 0,
        "matched_keywords": matched,
        "exempt": False,
    }


# ── Tự động loại trừ bài MỚI cào khớp từ khóa (hook ở tầng ingest) ──────────


def auto_reject_if_excluded(
    post_id: str,
    platform: str,
    content: str,
    search_keyword: str = "",
) -> Optional[dict[str, Any]]:
    """Tự động gắn 'khong-phu-hop' cho bài MỚI CÀO nếu nội dung khớp từ khóa loại trừ
    đang active — gọi ngay sau khi insert bài thành công ở tầng ingest
    (post_ingest_service.py, supabase_linkedin_extension_crawl_service.py,
    supabase_threads_extension_crawl_service.py). CHỈ áp dụng cho bài mới đi qua đúng
    điểm insert này, không quét lại bài cũ đã có sẵn trong DB (khác compute_excluded_flag()
    ở trên vốn tính động mỗi lần load feed cho MỌI bài).

    Tái dùng đúng logic match (normalize/strip dấu/contains-match) và cờ miễn trừ của
    compute_excluded_flag() — không viết lại. Tôn trọng đánh giá thủ công đã có (chỉ tự
    gán khi bài chưa có đánh giá hoặc đang 'chua-danh-gia'). Idempotent: gọi lại nhiều lần
    trên cùng 1 post không ghi đè/không tạo thêm history thừa.
    """
    from app.modules.all_platform.services.post_evaluation_service import get_review

    review = get_review(post_id, platform)
    exc_info = compute_excluded_flag(
        {"platform": platform, "content": content, "search_keyword": search_keyword},
        review,
    )
    if not exc_info["is_excluded"]:
        return None

    matched_str = ", ".join(exc_info["matched_keywords"])
    return _apply_auto_not_suitable(
        post_id,
        platform,
        review,
        reason=f"Tự động loại trừ do khớp từ khóa cấm: {matched_str}",
        action_type="auto_exclude_keyword",
        log_extra={"matched": exc_info["matched_keywords"]},
    )


def _apply_auto_not_suitable(
    post_id: str,
    platform: str,
    review: Optional[dict[str, Any]],
    *,
    reason: str,
    action_type: str,
    log_extra: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Gắn 'khong-phu-hop' tự động cho 1 bài, tôn trọng đánh giá thủ công đã có.

    Tách từ `auto_reject_if_excluded()` để `auto_reject_legacy_low_lead_score_posts()`
    (Việc C, 2026-11-26) tái dùng đúng cơ chế upsert `post_quick_review` + ghi
    `post_evaluation_history`, không viết lại logic song song.
    """
    current_code = review.get("evaluation_code") if review else None
    if current_code not in (None, "chua-danh-gia"):
        # Đã có đánh giá (thủ công hoặc đã tự động gắn 'khong-phu-hop' từ lần gọi trước) ->
        # không ghi đè, không tạo history thừa.
        return review

    supabase = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    upsert_data: dict[str, Any] = {
        "post_id": str(post_id),
        "platform": platform,
        "evaluation_code": "khong-phu-hop",
        "reason": reason,
        "evaluated_by": None,
        "evaluated_at": now_iso,
        "updated_at": now_iso,
    }
    if review is not None:
        upsert_data["exclude_keyword_exempt"] = review.get("exclude_keyword_exempt", False)

    res = execute_supabase_query(
        lambda: supabase.table("post_quick_review")
        .upsert(upsert_data, on_conflict="post_id,platform")
        .execute()
    )
    saved_review = res.data[0] if res.data else upsert_data

    history_entry = {
        "post_id": str(post_id),
        "platform": platform,
        "previous_evaluation_code": current_code,
        "evaluation_code": "khong-phu-hop",
        "reason": reason,
        "action_type": action_type,
        "evaluated_by": None,
        "created_at": now_iso,
    }
    execute_supabase_query(
        lambda: supabase.table("post_evaluation_history").insert(history_entry).execute()
    )

    logger.info(
        "%s post_id=%s platform=%s %s",
        action_type,
        post_id,
        platform,
        log_extra or {},
    )

    return saved_review


# ── Việc C (2026-11-26): backfill bài CŨ có lead_score 1-39 XÁC ĐỊNH (không phải NULL) ──
# Phạm vi nhỏ, có giới hạn: chỉ còn tồn tại do 1 cửa sổ lịch sử ngắn (commit 2026-10-02 ->
# 2026-11-04) từng loại trừ threads_posts/bài cào theo từ khóa khỏi việc XOÁ bài điểm thấp
# (xem lead_score_service.py::score_and_save_posts — hiện tại MỌI bài điểm <40 đều bị xoá
# thẳng, không còn exemption nào, nên KHÔNG có "bài mới" nào rơi vào trường hợp này nữa).
# KHÔNG đụng tới bài lead_score IS NULL (chưa từng được chấm điểm — xem Việc B, khác hẳn
# bản chất với "điểm thấp xác định").
_LEGACY_LOW_SCORE_TABLES = ("facebook_posts", "linkedin_posts", "threads_posts")


def auto_reject_legacy_low_lead_score_posts(
    min_score: int = 1,
    max_score: int = 39,
) -> dict[str, Any]:
    """Quét 1 lần (idempotent — gọi lại không tạo thêm history thừa) các bài đã có sẵn
    `lead_score` xác định trong khoảng [min_score, max_score] và tự động gắn
    'khong-phu-hop', tôn trọng đánh giá thủ công đã có (giống hệt `auto_reject_if_excluded`).
    """
    from app.modules.all_platform.services.post_evaluation_service import get_review

    supabase = get_supabase_client()
    summary: dict[str, Any] = {"scanned": 0, "marked": 0, "skipped_already_reviewed": 0, "errors": []}

    for table in _LEGACY_LOW_SCORE_TABLES:
        platform = "threads" if table == "threads_posts" else ("linkedin" if table == "linkedin_posts" else "facebook")
        try:
            res = execute_supabase_query(
                lambda t=table: supabase.table(t)
                .select("id, lead_score")
                .gte("lead_score", min_score)
                .lte("lead_score", max_score)
                .execute()
            )
        except Exception as exc:
            summary["errors"].append(f"{table}: {exc}")
            continue

        rows = res.data or []
        summary["scanned"] += len(rows)

        for row in rows:
            post_id = row.get("id")
            if not post_id:
                continue
            try:
                review = get_review(post_id, platform)
                result = _apply_auto_not_suitable(
                    post_id,
                    platform,
                    review,
                    reason=f"Tự động loại trừ do điểm AI thấp (lead_score={row.get('lead_score')} < 40)",
                    action_type="auto_exclude_low_score",
                    log_extra={"lead_score": row.get("lead_score")},
                )
                current_code = review.get("evaluation_code") if review else None
                if current_code not in (None, "chua-danh-gia"):
                    summary["skipped_already_reviewed"] += 1
                elif result:
                    summary["marked"] += 1
            except Exception as exc:
                summary["errors"].append(f"{table}#{post_id}: {exc}")

    return summary

