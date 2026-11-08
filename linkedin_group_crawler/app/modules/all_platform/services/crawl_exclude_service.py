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

