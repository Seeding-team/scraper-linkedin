"""Internal Engagement (Tương tác nội bộ) — company's own Facebook Page posts
pulled from MarkeeAI, for employees to seed-comment/react on internally."""

from __future__ import annotations

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

from app.modules.all_platform.schemas import (
    BaseResponse,
    InternalEngagementActionRecordRequest,
    InternalEngagementPost,
    InternalEngagementSummaryRequest,
    MyMarksRequest,
    PostInteractionsRequest,
    TeamTotalsRequest,
    TeamTrendRequest,
)
from app.modules.all_platform.schemas.internal_engagement import (
    AddCustomPostRequest,
    CreateSeedingCampaignRequest,
    DebugFetchMetaRequest,
    DeleteCustomPostRequest,
    MarkActionRequest,
    OverrideMarkeePostRequest,
    UpdateCustomPostRequest,
)
from app.modules.all_platform.services import markeeai_client
from app.modules.all_platform.services.internal_engagement_linkedin_sync_service import (
    NoLinkedInAccountError,
    sync_linkedin_post_engagement_via_playwright,
)
from app.modules.all_platform.services.internal_engagement_threads_sync_service import (
    NoThreadsAccountError,
    sync_threads_post_engagement_via_playwright,
)
from app.modules.all_platform.services.markeeai_account_links_service import resolve_markeeai_credentials
from app.modules.all_platform.services.supabase_internal_engagement_kpi_service import (
    add_custom_post,
    create_seeding_campaign_db,
    debug_fetch_facebook_post_metadata,
    delete_custom_post_db,
    delete_seeding_campaign_db,
    get_action_summary,
    get_custom_post_platform_db,
    get_custom_posts_db,
    get_markee_overrides_db,
    get_marks_by_links,
    get_post_interactions,
    get_post_team_counts,
    get_seeder_leaderboard_db,
    get_seeding_campaigns_db,
    get_team_daily_trend,
    get_team_totals,
    mark_action_by_fb_uid,
    record_action,
    sync_facebook_post_engagement_db,
    sync_linkedin_post_engagement_db,
    update_custom_post_db,
    upsert_markee_override_db,
)

router = APIRouter()


@router.get("/posts", response_model=BaseResponse)
async def list_posts(page: int = 1, page_size: int = 20, email: str | None = None) -> BaseResponse:
    try:
        # Nếu người gọi có tài khoản MarkeeAI riêng (markeeai_account_links),
        # lấy bài bằng đúng danh tính đó (đúng campaign họ thực sự tham gia).
        # Không có thì rơi về 1 service account dùng chung như trước.
        creds = resolve_markeeai_credentials(email) if email else None
        try:
            all_posts = await markeeai_client.get_all_company_posts(creds)
        except Exception as markee_err:
            logger.warning(f"Không thể kết nối MarkeeAI ({markee_err}), fallback bài viết rỗng.")
            all_posts = []

        # Lấy danh sách overrides từ DB nội bộ
        markee_ids = [str(p["id"]) for p in all_posts if isinstance(p, dict) and "id" in p]
        overrides = get_markee_overrides_db(markee_ids) if markee_ids else {}

        filtered_posts = []
        for p in all_posts:
            if not isinstance(p, dict):
                continue
            post_id = str(p.get("id"))
            ov = overrides.get(post_id, {})
            if ov.get("is_hidden"):
                continue

            fan_name = ov.get("override_fanpage_name") or p.get("fanpage_name")
            cnt = ov.get("override_content") if ov.get("override_content") is not None else (p.get("content") or "")
            media = ov.get("override_media_urls") if ov.get("override_media_urls") is not None else (p.get("media_urls") or [])

            filtered_posts.append(
                InternalEngagementPost(
                    id=post_id,
                    fanpage_id=p.get("fanpage_id", ""),
                    fanpage_name=fan_name,
                    facebook_post_id=p.get("facebook_post_id"),
                    content=cnt,
                    media_urls=media,
                    permalink_url=p.get("permalink_url"),
                    status=p.get("status"),
                    created_at=p.get("created_at"),
                ).model_dump()
            )

        total = len(filtered_posts)
        start = max(page - 1, 0) * page_size
        page_items = filtered_posts[start : start + page_size]

        return BaseResponse(
            success=True,
            data={"items": page_items, "total": total, "page": page, "page_size": page_size},
        )
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/custom-posts/{id}", response_model=BaseResponse)
def update_custom_post(id: str, payload: UpdateCustomPostRequest) -> BaseResponse:
    """API sửa bài viết thủ công (hỗ trợ gia hạn deadline, đổi Target KPI)"""
    try:
        fan_name = payload.fanpage_name or payload.page_name
        data = update_custom_post_db(
            post_id=id,
            email_member=payload.email,
            content=payload.content,
            fanpage_name=fan_name,
            media_urls=payload.media_urls,
            campaign_id=payload.campaign_id,
            campaign_name=payload.campaign_name,
            deadline=payload.deadline,
            target_comments=payload.target_comments,
            assigned_team_ids=payload.assigned_team_ids,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/custom-posts/{id}", response_model=BaseResponse)
def delete_custom_post(id: str, payload: DeleteCustomPostRequest) -> BaseResponse:
    """API xóa (soft delete) bài viết thủ công"""
    try:
        data = delete_custom_post_db(post_id=id, email_member=payload.email)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/markee-posts/{id}/override", response_model=BaseResponse)
def override_markee_post(id: str, payload: OverrideMarkeePostRequest) -> BaseResponse:
    """API ghi đè (sửa) bài viết Markee"""
    try:
        fan_name = payload.fanpage_name or payload.page_name
        data = upsert_markee_override_db(
            markee_post_id=id,
            email_member=payload.email,
            is_hidden=payload.is_hidden,
            fanpage_name=fan_name,
            content=payload.content,
            media_urls=payload.media_urls,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/markee-posts/{id}/override", response_model=BaseResponse)
def hide_markee_post(id: str, payload: DeleteCustomPostRequest) -> BaseResponse:
    """API ẩn (xóa) bài viết Markee bằng cách lưu is_hidden = true trong overrides"""
    try:
        data = upsert_markee_override_db(
            markee_post_id=id,
            email_member=payload.email,
            is_hidden=True,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/add-custom-post", response_model=BaseResponse)
@router.post("/social-posts/import", response_model=BaseResponse)
async def create_custom_post(payload: AddCustomPostRequest) -> BaseResponse:
    """API để Frontend gọi lưu link thủ công (nhận url hoặc link_post)"""
    try:
        target_url = payload.url or payload.link_post
        if not target_url or not target_url.strip():
            return BaseResponse(success=False, message="Vui lòng cung cấp link bài viết (url hoặc link_post).")

        fan_name = payload.fanpage_name or payload.page_name
        data = await add_custom_post(
            email_member=payload.email,
            link_post=target_url.strip(),
            content=payload.content,
            fanpage_name=fan_name,
            media_urls=payload.media_urls,
            cookie=payload.cookie,
            campaign_id=payload.campaign_id,
            campaign_name=payload.campaign_name,
            deadline=payload.deadline,
            target_comments=payload.target_comments if payload.target_comments is not None else 32,
            assigned_team_ids=payload.assigned_team_ids,
            platform=payload.platform,
            likes=payload.likes,
            comments=payload.comments,
            shares=payload.shares,
        )
        debug_msg = data.pop("_debug_info", None) if isinstance(data, dict) else None
        return BaseResponse(success=True, message=debug_msg or "Tạo bài viết Seeding thành công!", data=data)
    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        msg = str(e)
        if "đã tồn tại" in msg.lower():
            raise HTTPException(status_code=400, detail="Bài viết này đã tồn tại trong hệ thống!")
        return BaseResponse(success=False, message=msg)


@router.post("/custom-posts/debug-fetch", response_model=BaseResponse)
def debug_fetch_meta(payload: DebugFetchMetaRequest) -> BaseResponse:
    """Endpoint dùng cho Postman / Dev test cào OpenGraph metadata từ link Facebook"""
    try:
        data = debug_fetch_facebook_post_metadata(payload.url, cookie=payload.cookie)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/custom-posts", response_model=BaseResponse)
def list_custom_posts(page: int = 1, page_size: int = 20) -> BaseResponse:
    """API lấy danh sách bài thủ công và format giống bài Fanpage để FE dễ dùng"""
    try:
        result = get_custom_posts_db(page, page_size)
        
        items = []
        for p in result["items"]:
            post_url = p.get("link_post") or p.get("post_url") or ""
            fanpage_name = p.get("fanpage_name") or p.get("page_name") or "Markee AI Marketing"
            content = p.get("content") or "Bài viết Facebook được nhân viên chia sẻ thủ công."
            media_urls = p.get("media_urls") or p.get("media_url") or []
            if isinstance(media_urls, str):
                media_urls = [media_urls]
            created_at = p.get("published_at") or p.get("created_at")

            items.append({
                "id": str(p["id"]),
                "platform": p.get("platform") or "facebook",
                "fanpage_id": "custom",
                "fanpage_name": fanpage_name,
                "page_name": fanpage_name,
                "facebook_post_id": "",
                "content": content,
                "media_urls": media_urls,
                "media_url": media_urls,
                "permalink_url": post_url,
                "post_url": post_url,
                "link_post": post_url,
                "status": "published",
                "created_at": str(created_at) if created_at else None,
                "published_at": str(created_at) if created_at else None,
                "campaign_id": p.get("campaign_id"),
                "campaign_name": p.get("campaign_name"),
                "deadline": str(p.get("deadline")) if p.get("deadline") else None,
                "target_comments": p.get("target_comments"),
                "assigned_team_ids": p.get("assigned_team_ids") or [],
                "public_likes": p.get("public_likes") or p.get("fb_total_likes") or 0,
                "public_comments": p.get("public_comments") or p.get("fb_total_comments") or 0,
                "public_shares": p.get("public_shares") or p.get("fb_total_shares") or 0,
                "fb_total_likes": p.get("public_likes") or p.get("fb_total_likes") or 0,
                "fb_total_comments": p.get("public_comments") or p.get("fb_total_comments") or 0,
                "fb_total_shares": p.get("public_shares") or p.get("fb_total_shares") or 0,
                "synced_at": str(p.get("synced_at") or p.get("last_synced_at")) if (p.get("synced_at") or p.get("last_synced_at")) else None,
                "last_synced_at": str(p.get("synced_at") or p.get("last_synced_at")) if (p.get("synced_at") or p.get("last_synced_at")) else None,
            })
        
        return BaseResponse(
            success=True,
            data={"items": items, "total": result["total"], "page": page, "page_size": page_size},
        )
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/custom-posts/{post_id}/sync", response_model=BaseResponse)
@router.post("/posts/{post_id}/sync", response_model=BaseResponse)
def sync_post_metrics_endpoint(
    post_id: str,
    cookie: Optional[str] = None,
    likes: Optional[int] = None,
    comments: Optional[int] = None,
    shares: Optional[int] = None,
) -> BaseResponse:
    """API cập nhật số lượng Like, Comment, Share của bài viết gốc.
    Facebook: backend tự cào server-side. LinkedIn/Threads: không tự cào được (cần
    đăng nhập) nên FE phải cào qua extension rồi gửi số liệu lên qua
    likes/comments/shares — nhánh này platform-agnostic, không cần biết platform gì."""
    try:
        if likes is not None or comments is not None or shares is not None:
            data = sync_linkedin_post_engagement_db(
                post_id=post_id, likes=likes, comments=comments, shares=shares
            )
            message = "Đồng bộ chỉ số bài viết LinkedIn thành công!"
        else:
            data = sync_facebook_post_engagement_db(post_id=post_id, cookie=cookie)
            message = "Đồng bộ chỉ số bài viết gốc từ Facebook thành công!"
        return BaseResponse(success=True, message=message, data=data)
    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        logger.error(f"Lỗi khi đồng bộ chỉ số bài viết {post_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/custom-posts/{post_id}/sync-playwright", response_model=BaseResponse)
def sync_post_metrics_playwright_endpoint(post_id: str) -> BaseResponse:
    """Đồng bộ Like/Comment/Share hoàn toàn server-side qua Playwright, không cần
    browser extension. LinkedIn: dùng account LinkedIn đã đăng ký của người tạo bài.
    Threads: CHƯA có hạ tầng đăng nhập server-side, luôn trả error_code=
    NO_THREADS_AUTO_SYNC. FE nên tự fallback sang luồng extension (endpoint /sync ở
    trên) nếu gọi API này trả về error_code=NO_LINKEDIN_ACCOUNT/NO_THREADS_AUTO_SYNC
    hoặc thất bại vì lý do khác."""
    try:
        platform = get_custom_post_platform_db(post_id)
        if platform == "threads":
            data = sync_threads_post_engagement_via_playwright(post_id)
        else:
            data = sync_linkedin_post_engagement_via_playwright(post_id)
        return BaseResponse(
            success=True,
            message="Đồng bộ (tự động, không cần Extension) thành công!",
            data=data,
        )
    except NoThreadsAccountError as e:
        return BaseResponse(success=False, message=str(e), data={"error_code": "NO_THREADS_AUTO_SYNC"})
    except NoLinkedInAccountError as e:
        return BaseResponse(success=False, message=str(e), data={"error_code": "NO_LINKEDIN_ACCOUNT"})
    except Exception as e:
        logger.error(f"Lỗi đồng bộ Playwright cho bài {post_id}: {e}")
        return BaseResponse(success=False, message=str(e), data={"error_code": "PLAYWRIGHT_SYNC_FAILED"})


@router.post("/my-marks", response_model=BaseResponse)
def my_marks(payload: MyMarksRequest) -> BaseResponse:
    """Bucket a list of post permalinks into need/received/completed for one employee,
    from the dedicated internal_engagement_kpi table."""
    try:
        marks = get_marks_by_links(payload.email_member, payload.link_posts)
        return BaseResponse(success=True, data={"marks": marks})
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/kpi/record", response_model=BaseResponse)
def record_kpi_action(payload: InternalEngagementActionRecordRequest) -> BaseResponse:
    """Record the final result of one comment/reaction/share attempt made by the
    extension. Called by the extension itself right after it executes an action
    (success or failure), so status/error_message reflect the real outcome."""
    print(f"Nhận request KPI: {payload.model_dump(exclude_none=True)}")
    try:
        data = record_action(payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, data=data)
    except Exception as e:
        print(f"[KPI RECORD ERROR] Lỗi khi lưu KPI: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/mark-action", response_model=BaseResponse)
@router.post("/kpi/mark-done", response_model=BaseResponse)
def mark_action_endpoint(payload: MarkActionRequest) -> BaseResponse:
    """API ghi nhận hành động tương tác (Like, Comment, Share) từ Extension hoặc FE vào bảng KPI"""
    try:
        data = mark_action_by_fb_uid(
            action_type=payload.action_type,
            fb_uid=payload.fb_uid,
            post_url=payload.post_url,
            email_member=payload.email_member,
            content=payload.content,
        )
        return BaseResponse(
            success=True,
            message=f"Đã ghi nhận {payload.action_type} thành công!",
            data=data,
        )
    except Exception as e:
        logger.error(f"Lỗi khi mark action {payload.action_type}: {e}")
        return BaseResponse(success=False, message=str(e))


@router.post("/kpi/summary", response_model=BaseResponse)
def kpi_summary(payload: InternalEngagementSummaryRequest) -> BaseResponse:
    try:
        data = get_action_summary(
            email_member=payload.email_member,
            date_from=payload.date_from,
            date_to=payload.date_to,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Team visibility: admin sees every team, leader sees only their own team ────

@router.get("/kpi/post-team-counts", response_model=BaseResponse)
def post_team_counts(link_post: str, email: str, team_id: str | None = None) -> BaseResponse:
    """Small per-team badge counts shown under a post (e.g. 'Team Sales: 3 tương tác')."""
    try:
        data = get_post_team_counts(link_post=link_post, email=email, team_id=team_id)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/kpi/post-interactions", response_model=BaseResponse)
def post_interactions(payload: PostInteractionsRequest) -> BaseResponse:
    """'Xem tương tác thành viên' modal — detailed list of who did what on this post."""
    try:
        data = get_post_interactions(
            link_post=payload.link_post, email=payload.email, team_id=payload.team_id
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/kpi/team-trend", response_model=BaseResponse)
def team_trend(payload: TeamTrendRequest) -> BaseResponse:
    """Daily interaction series per team — trend/stability chart."""
    try:
        data = get_team_daily_trend(email=payload.email, days=payload.days, team_id=payload.team_id)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/kpi/team-totals", response_model=BaseResponse)
def team_totals(payload: TeamTotalsRequest) -> BaseResponse:
    """Per-team totals + stability score (active-days ratio) — ranking chart/table."""
    try:
        data = get_team_totals(
            email=payload.email,
            date_from=payload.date_from,
            date_to=payload.date_to,
            team_id=payload.team_id,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/seeding/campaigns", response_model=BaseResponse)
def list_seeding_campaigns() -> BaseResponse:
    """Lấy danh sách các chiến dịch Seeding"""
    try:
        data = get_seeding_campaigns_db()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/seeding/campaigns", response_model=BaseResponse)
def create_seeding_campaign(payload: CreateSeedingCampaignRequest) -> BaseResponse:
    """Tạo mới chiến dịch Seeding"""
    try:
        data = create_seeding_campaign_db(payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/seeding/campaigns/{id}", response_model=BaseResponse)
def delete_seeding_campaign(id: str) -> BaseResponse:
    """Xóa chiến dịch Seeding"""
    try:
        data = delete_seeding_campaign_db(id)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/seeding/leaderboard", response_model=BaseResponse)
def get_seeder_leaderboard() -> BaseResponse:
    """Bảng xếp hạng Seeder nổi bật kết nối với View v_seeder_leaderboard"""
    try:
        data = get_seeder_leaderboard_db()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
