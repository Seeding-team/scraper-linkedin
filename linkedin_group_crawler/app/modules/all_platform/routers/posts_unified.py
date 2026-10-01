"""Unified posts router — fetches & filters posts from all platforms in one call."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.supabase_client import (
    execute_supabase_query,
    get_supabase_client,
    is_transient_supabase_error,
)
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.posts import (
    UnifiedPostsRequest,
    UnifiedFilterRequest,
    PostSeedingRosterRequest,
    MemberCrawlHistoryRequest,
)
from app.modules.all_platform.services.unified_posts_service import (
    get_unified_posts,
    filter_unified_posts,
    get_unified_stats,
    get_unified_daily_trend,
    get_post_seeding_roster,
    get_teams_seeding_efficiency,
    get_member_seeding_overview,
    get_member_crawl_history,
)

router = APIRouter()


def _fail(exc: Exception) -> BaseResponse:
    """Turn a service exception into the right HTTP shape.

    A transient upstream failure (Supabase closed a pooled socket, pool timeout,
    Cloudflare 5xx) is infrastructure, not a result: it must be a 5xx so the
    browser retries. Returning HTTP 200 + success=False made the frontend render
    httpx's raw "Server disconnected without sending a response." in a red
    banner, and its retry never fired because res.ok was true.
    """
    if isinstance(exc, HTTPException):
        raise exc
    if is_transient_supabase_error(exc):
        raise HTTPException(
            status_code=503,
            detail="Mất kết nối tới cơ sở dữ liệu, vui lòng thử lại.",
        ) from exc
    return BaseResponse(success=False, message=str(exc))


class FeedOverviewRequest(BaseModel):
    """Request payload for /unified/feed/overview RPC.

    Wraps the Phase 6 SQL RPC `get_unified_feed_overview` so the FE can
    fetch all dashboard KPIs + admin/leader aggregations in 1 round-trip
    instead of N HTTP requests (stats + N×kpi get-by-email + team-view).
    """
    email: str
    platform: Optional[str] = "all"
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    limit: Optional[int] = 15
    offset: Optional[int] = 0


@router.post("/posts")
def unified_get_posts(payload: UnifiedPostsRequest) -> BaseResponse:
    """Get posts from all platforms (facebook + linkedin) in one call."""
    try:
        data = get_unified_posts(
            email=payload.email,
            platform=payload.platform,
            date_from=payload.date_from,
            date_to=payload.date_to,
            intent=payload.intent,
            industry=payload.industry,
            team=payload.team,
            tier=payload.tier,
            sort=payload.sort,
            page=payload.page,
            page_size=payload.page_size,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return _fail(e)


@router.post("/posts/filter")
def unified_filter_posts(payload: UnifiedFilterRequest) -> BaseResponse:
    """Filter posts from all platforms with full criteria — server-side."""
    try:
        data = filter_unified_posts(
            email=payload.email,
            platform=payload.platform,
            date=payload.date,
            date_from=payload.date_from,
            date_to=payload.date_to,
            intent=payload.intent,
            industry=payload.industry,
            team=payload.team,
            tier=payload.tier,
            icp=payload.icp,
            content_type=payload.content_type,
            product_seeding=payload.product_seeding,
            search=payload.search,
            id_member=payload.id_member,
            sort=payload.sort,
            page=payload.page,
            page_size=payload.page_size,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return _fail(e)


@router.post("/stats")
def unified_get_stats(payload: UnifiedPostsRequest) -> BaseResponse:
    """Get stats from all platforms — computed server-side from database."""
    try:
        data = get_unified_stats(
            email=payload.email,
            platform=payload.platform,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return _fail(e)


@router.post("/stats/daily-trend")
def unified_get_daily_trend(payload: UnifiedPostsRequest) -> BaseResponse:
    """Xu huong tong bai/comment/inbox theo tung ngay (14 ngay gan nhat).

    Dung cho khoi dashboard xu huong o trang Post Feed - bo sung cho 4 the
    "hom nay" da co san o /unified/stats.
    """
    try:
        data = get_unified_daily_trend(
            email=payload.email,
            platform=payload.platform,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return _fail(e)


@router.post("/posts/seeding-roster")
def unified_post_seeding_roster(payload: PostSeedingRosterRequest) -> BaseResponse:
    """'Xem seeding theo team' modal (Seeding bên ngoài, admin/leader) — toàn bộ
    roster thành viên team sở hữu group của bài viết, kèm ai đã/chưa seeding."""
    try:
        data = get_post_seeding_roster(
            post_id=payload.post_id, platform=payload.platform, email=payload.email
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return _fail(e)


@router.post("/teams/seeding-efficiency")
def unified_teams_seeding_efficiency(payload: UnifiedPostsRequest) -> BaseResponse:
    """"Hiệu quả theo team" cho Dashboard leader (Seeding bên ngoài) — admin thấy mọi
    team, leader chỉ thấy team mình quản lý, member không thấy gì."""
    try:
        data = get_teams_seeding_efficiency(email=payload.email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return _fail(e)


@router.post("/members/seeding-overview")
def unified_member_seeding_overview(payload: UnifiedPostsRequest) -> BaseResponse:
    """Tab phụ "Tài khoản seeding" (Lịch crawl & Hàng đợi) — admin thấy mọi thành viên,
    leader chỉ thấy team mình quản lý, member không thấy gì."""
    try:
        data = get_member_seeding_overview(email=payload.email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return _fail(e)


@router.post("/members/crawl-history")
def unified_member_crawl_history(payload: MemberCrawlHistoryRequest) -> BaseResponse:
    """Chi tiết lịch sử cào của 1 thành viên — mở khi bấm vào 1 hàng trong bảng "Tài
    khoản seeding" (giống style bấm vào 1 lead ở CRM)."""
    try:
        data = get_member_crawl_history(email=payload.email, id_member=payload.id_member)
        return BaseResponse(success=True, data=data)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return _fail(e)


@router.post("/feed/overview")
def unified_feed_overview(payload: FeedOverviewRequest) -> BaseResponse:
    """Phase 6: Single RPC for unified feed dashboard.

    Returns:
      - quick_stats: dashboard KPIs (same shape as /unified/stats)
      - my_kpi: member's personal KPI target/current/remaining/percent
      - team_kpi: leader's team overview (only role=leader)
      - top_seeding_today: top 5 posts by seeding count today (admin/leader)
      - top_seeders_today: top 5 members by seeding count today (admin/leader)

    Called in parallel with /unified/posts/filter by FE — saves
    N+ round-trips that fan-out into:
      - 1 × /unified/stats
      - 1 × kpi/get-by-email (per member)
      - 1 × leader-view inbox-share (per leader)
      - 1 × seeding aggregation query (admin/leader)
    """
    try:
        sb = get_supabase_client()
        # RPC params follow SQL signature: p_email, p_platform, p_date_from,
        # p_date_to, p_limit, p_offset
        params: dict[str, Any] = {
            "p_email": payload.email,
            "p_platform": payload.platform or "all",
            "p_limit": payload.limit or 15,
            "p_offset": payload.offset or 0,
        }
        if payload.date_from:
            params["p_date_from"] = payload.date_from
        if payload.date_to:
            params["p_date_to"] = payload.date_to

        res = execute_supabase_query(
            lambda: sb.rpc("get_unified_feed_overview", params).execute()
        )
        rpc_data = res.data if res and res.data else {}
        # SQL RPC returns JSONB; supabase-py decodes it to dict already.
        return BaseResponse(success=True, data=rpc_data)
    except Exception as e:
        return _fail(e)
