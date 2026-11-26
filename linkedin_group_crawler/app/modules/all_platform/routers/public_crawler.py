"""Router for Zero-Account Fast Public Group Crawler (4G Mobile Proxy)."""

from __future__ import annotations

import asyncio
from typing import Any, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_current_user, require_admin_or_leader
from app.modules.all_platform.services.crawled_post_audit_service import (
    list_crawled_posts_overview_sync,
)
from app.modules.all_platform.services.public_4g_crawler_service import (
    PUBLIC_CRAWL_CONFIG_BOUNDS,
    public_crawl_orchestrator,
)

router = APIRouter()


class RunPublicCrawlBody(BaseModel):
    group_ids: Optional[List[str]] = None
    keywords: Optional[List[str]] = None
    only_due: bool = False
    limit_groups: Optional[int] = Field(None, ge=1, le=50)
    platform: Literal["auto", "facebook", "threads", "instagram", "linkedin_no_acc"] = "auto"


class ConfigUpdateBody(BaseModel):
    enabled: Optional[bool] = None
    cycle_interval_min: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["cycle_interval_min"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["cycle_interval_min"][1],
    )
    groups_per_ip_rotate: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["groups_per_ip_rotate"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["groups_per_ip_rotate"][1],
    )
    max_posts_per_group: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["max_posts_per_group"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["max_posts_per_group"][1],
    )
    max_scrolls_per_group: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["max_scrolls_per_group"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["max_scrolls_per_group"][1],
    )
    concurrent_sims: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["concurrent_sims"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["concurrent_sims"][1],
    )
    auto_skip_private: Optional[bool] = None
    headless: Optional[bool] = None
    proxy_urls: Optional[Union[List[str], str]] = None
    alternating_threads_enabled: Optional[bool] = None
    threads_keyword_target: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["threads_keyword_target"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["threads_keyword_target"][1],
    )
    threads_max_posts_per_keyword: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["threads_max_posts_per_keyword"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["threads_max_posts_per_keyword"][1],
    )
    threads_max_age_days: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["threads_max_age_days"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["threads_max_age_days"][1],
    )
    use_curl_cffi: Optional[bool] = None
    alternating_instagram_enabled: Optional[bool] = None
    instagram_max_posts_per_target: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["instagram_max_posts_per_target"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["instagram_max_posts_per_target"][1],
    )
    alternating_linkedin_no_acc_enabled: Optional[bool] = None
    linkedin_no_acc_location: Optional[str] = None
    linkedin_no_acc_max_jobs_per_keyword: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["linkedin_no_acc_max_jobs_per_keyword"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["linkedin_no_acc_max_jobs_per_keyword"][1],
    )
    use_eaa_for_private_groups: Optional[bool] = None


class GroupPublicSettingsBody(BaseModel):
    visibility: Optional[Literal["public", "private"]] = None
    public_crawl_enabled: Optional[bool] = None
    public_crawl_interval_min: Optional[int] = Field(
        None,
        ge=PUBLIC_CRAWL_CONFIG_BOUNDS["cycle_interval_min"][0],
        le=PUBLIC_CRAWL_CONFIG_BOUNDS["cycle_interval_min"][1],
    )


class BulkToggleGroupsBody(BaseModel):
    group_ids: List[str]
    visibility: Optional[Literal["public", "private"]] = None
    public_crawl_enabled: Optional[bool] = None


class ProxyTestBody(BaseModel):
    node_id: Optional[str] = None
    do_rotate: bool = False


@router.get("/status")
async def get_public_crawl_status(_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    status = await public_crawl_orchestrator.get_status()
    return {"success": True, **status}


@router.post("/run")
async def start_public_crawl_run(
    body: RunPublicCrawlBody | None = None,
    user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    req = body or RunPublicCrawlBody()
    result = await public_crawl_orchestrator.start_run(
        group_ids=req.group_ids,
        keywords=req.keywords,
        trigger_source="manual",
        triggered_by=user.get("id"),
        only_due=req.only_due,
        limit_groups=req.limit_groups,
        platform=req.platform,
    )
    return {"success": bool(result.get("started")), **result}


@router.post("/stop")
async def stop_public_crawl_run(
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    result = public_crawl_orchestrator.request_stop()
    return {"success": bool(result.get("stopped")), **result}


@router.put("/config")
async def update_public_crawl_config(
    body: ConfigUpdateBody,
    user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    try:
        updated = await asyncio.to_thread(
            public_crawl_orchestrator.update_config_sync,
            body.model_dump(exclude_none=True),
            user.get("id"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.enabled is False:
        public_crawl_orchestrator._cancel_next_round_wait()
    safe_cfg = public_crawl_orchestrator.mask_config_for_api(updated)
    sims = public_crawl_orchestrator.rotator.snapshot_nodes(updated.get("proxy_urls"))
    public_crawl_orchestrator.append_log(
        "info",
        "config",
        (
            f"Cập nhật cấu hình: auto={'BẬT' if updated.get('enabled') else 'TẮT'}, "
            f"luân_phiên_threads={'BẬT' if updated.get('alternating_threads_enabled', True) else 'TẮT'} "
            f"({updated.get('threads_keyword_target', 30)} từ khóa), "
            f"proxy={len(sims)}, bài={updated.get('max_posts_per_group')}, "
            f"độ_sâu={updated.get('max_scrolls_per_group')}, xoay={updated.get('groups_per_ip_rotate')}, "
            f"luồng={updated.get('concurrent_sims')}, chu kỳ {updated.get('cycle_interval_min')}p"
        ),
    )
    return {"success": True, "config": safe_cfg, "sims": sims}


@router.get("/groups")
async def list_public_crawl_groups(
    visibility: Optional[str] = Query(None, description="Filter: public | private"),
    limit: int = Query(300, ge=1, le=1000),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    groups = await asyncio.to_thread(
        public_crawl_orchestrator.list_groups_sync,
        visibility=visibility,
        limit=limit,
    )
    return {"success": True, "groups": groups}


@router.patch("/groups/{group_id}")
async def update_group_public_settings(
    group_id: str,
    body: GroupPublicSettingsBody,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    updated = await asyncio.to_thread(
        public_crawl_orchestrator.update_group_sync,
        group_id,
        body.model_dump(exclude_none=True),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Group not found or no valid fields supplied")
    return {"success": True, "group": updated}


@router.post("/groups/bulk-toggle")
async def bulk_toggle_public_groups(
    body: BulkToggleGroupsBody,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    count = await asyncio.to_thread(
        public_crawl_orchestrator.bulk_toggle_groups_sync,
        group_ids=body.group_ids,
        public_crawl_enabled=body.public_crawl_enabled,
        visibility=body.visibility,
    )
    return {"success": True, "updated_count": count}


@router.post("/proxy/test")
async def test_mobile_proxy_nodes(
    body: ProxyTestBody | None = None,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    req = body or ProxyTestBody()
    cfg = await asyncio.to_thread(public_crawl_orchestrator.get_config_sync)
    res = await public_crawl_orchestrator.rotator.test_proxy(
        node_id=req.node_id,
        do_rotate=req.do_rotate,
        proxy_urls=cfg.get("proxy_urls"),
    )
    for item in res.get("results") or []:
        if item.get("error"):
            public_crawl_orchestrator.append_log(
                "error",
                str(item.get("id") or "proxy"),
                f"[Test {item.get('id')}] Lỗi: {item.get('error')}",
            )
        else:
            fb_tag = (
                f"FB Guest={item.get('fbStatus')} OK"
                if item.get("fbOk")
                else f"FB Guest={item.get('fbStatus') or 'ERR'}"
            )
            public_crawl_orchestrator.append_log(
                "success" if item.get("fbOk") else "warn",
                str(item.get("id") or "proxy"),
                (
                    f"[Test {item.get('id')}] Tunnel={'OK' if item.get('socksOk') else 'FAIL'} "
                    f"({item.get('latencyMs') or '?'}ms) | IP={item.get('egressIpAfter') or item.get('egressIpBefore') or 'N/A'} | {fb_tag}"
                    + (f" (Đổi IP: {item.get('egressIpBefore')} -> {item.get('egressIpAfter')})" if item.get("ipChanged") else "")
                ),
            )
    return {"success": bool(res.get("ok")), **res}


@router.get("/crawled-posts")
async def list_public_crawled_and_ai_posts(
    time_range: str = Query("all", description="Filter window: today | 7d | all"),
    search: Optional[str] = Query(None, description="Keyword/group/author/AI reason filter"),
    ai_filter: str = Query("all", description="AI status filter: all | lead_high | kept | deleted | pending"),
    source_filter: str = Query("all", description="AI table source filter: all | public_4g | extension"),
    limit: int = Query(100, ge=1, le=300),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    data = await asyncio.to_thread(
        list_crawled_posts_overview_sync,
        time_range=time_range,
        search=search,
        ai_filter=ai_filter,
        source_filter=source_filter,
        limit=limit,
    )
    return {"success": True, **data}


class AddThreadsKeywordBody(BaseModel):
    topic: str = "Chung"
    keywords: List[str]


class ToggleThreadsKeywordBody(BaseModel):
    is_active: Optional[bool] = None


@router.get("/threads-keywords")
async def get_threads_keywords_library(
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Lấy danh sách toàn bộ từ khóa trong Thư viện Threads (mở cho cả member, leader, admin)."""
    from app.modules.all_platform.services.threads_keyword_service import (
        DEFAULT_TOPICS,
        list_all_keywords,
    )

    items = await asyncio.to_thread(list_all_keywords)
    return {"success": True, "items": items, "topics": list(DEFAULT_TOPICS)}


@router.post("/threads-keywords")
async def add_threads_keywords_to_library(
    body: AddThreadsKeywordBody,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Thêm từ khóa mới theo Chủ đề vào Thư viện Threads (mở cho cả member, leader, admin)."""
    from app.modules.all_platform.services.threads_keyword_service import add_keywords

    creator = user.get("name") or user.get("email") or "Thành viên"
    res = await asyncio.to_thread(
        add_keywords,
        topic=body.topic,
        keywords=body.keywords,
        created_by=creator,
    )
    return res


@router.delete("/threads-keywords/{kw_id}")
async def delete_threads_keyword_from_library(
    kw_id: str,
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Xóa từ khóa khỏi Thư viện Threads."""
    from app.modules.all_platform.services.threads_keyword_service import delete_keyword

    ok = await asyncio.to_thread(delete_keyword, keyword_id=kw_id)
    return {"success": ok}


@router.post("/threads-keywords/{kw_id}/toggle")
async def toggle_threads_keyword_status(
    kw_id: str,
    body: Optional[ToggleThreadsKeywordBody] = None,
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Bật / Tắt trạng thái từ khóa trong Thư viện Threads."""
    from app.modules.all_platform.services.threads_keyword_service import toggle_keyword

    is_act = body.is_active if body else None
    ok = await asyncio.to_thread(toggle_keyword, keyword_id=kw_id, is_active=is_act)
    return {"success": ok}


@router.post("/threads/purge-foreign-language")
async def purge_foreign_language_threads(
    limit: int = Query(200, ge=1, le=1000),
    current_user: Any = Depends(require_admin_or_leader),
):
    """Gạch bỏ các bài viết tiếng Anh / ngoại ngữ hiện có trong threads_posts."""
    from app.modules.all_platform.services.threads_language_service import purge_foreign_threads_posts
    result = await asyncio.to_thread(purge_foreign_threads_posts, batch_size=limit)
    return {"success": True, "data": result}


# ── Phase 2: Instagram No-Acc Targets CRUD ────────────────────────────────────

class AddInstagramTargetsBody(BaseModel):
    target_type: Literal["keyword", "profile"] = "keyword"
    values: List[str]
    topic: str = "Chung"


class ToggleTargetBody(BaseModel):
    is_active: Optional[bool] = None


@router.get("/instagram-targets")
async def get_instagram_targets(
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    from app.modules.all_platform.services.instagram_no_acc_crawler_service import (
        list_instagram_targets,
    )

    items = await asyncio.to_thread(list_instagram_targets)
    return {"success": True, "items": items}


@router.post("/instagram-targets")
async def create_instagram_targets(
    body: AddInstagramTargetsBody,
    user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.instagram_no_acc_crawler_service import (
        add_instagram_targets,
    )

    creator = user.get("name") or user.get("email") or "Admin"
    return await asyncio.to_thread(
        add_instagram_targets,
        target_type=body.target_type,
        values=body.values,
        topic=body.topic,
        created_by=creator,
    )


@router.delete("/instagram-targets/{target_id}")
async def remove_instagram_target(
    target_id: str,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.instagram_no_acc_crawler_service import (
        delete_instagram_target,
    )

    ok = await asyncio.to_thread(delete_instagram_target, target_id)
    return {"success": ok}


@router.post("/instagram-targets/{target_id}/toggle")
async def toggle_instagram_target_route(
    target_id: str,
    body: Optional[ToggleTargetBody] = None,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.instagram_no_acc_crawler_service import (
        toggle_instagram_target,
    )

    ok = await asyncio.to_thread(toggle_instagram_target, target_id, body.is_active if body else None)
    return {"success": ok}


# ── Phase 3: LinkedIn No-Acc Targets CRUD ─────────────────────────────────────

class AddLinkedInNoAccTargetsBody(BaseModel):
    keywords: List[str]
    location: str = "Vietnam"
    channel: Literal["jobs_guest", "search_index", "both"] = "both"


@router.get("/linkedin-no-acc-targets")
async def get_linkedin_no_acc_targets(
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    from app.modules.all_platform.services.linkedin_no_acc_crawler_service import (
        list_linkedin_no_acc_targets,
    )

    items = await asyncio.to_thread(list_linkedin_no_acc_targets)
    return {"success": True, "items": items}


@router.post("/linkedin-no-acc-targets")
async def create_linkedin_no_acc_targets(
    body: AddLinkedInNoAccTargetsBody,
    user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.linkedin_no_acc_crawler_service import (
        add_linkedin_no_acc_targets,
    )

    creator = user.get("name") or user.get("email") or "Admin"
    return await asyncio.to_thread(
        add_linkedin_no_acc_targets,
        keywords=body.keywords,
        location=body.location,
        channel=body.channel,
        created_by=creator,
    )


@router.delete("/linkedin-no-acc-targets/{target_id}")
async def remove_linkedin_no_acc_target(
    target_id: str,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.linkedin_no_acc_crawler_service import (
        delete_linkedin_no_acc_target,
    )

    ok = await asyncio.to_thread(delete_linkedin_no_acc_target, target_id)
    return {"success": ok}


@router.post("/linkedin-no-acc-targets/{target_id}/toggle")
async def toggle_linkedin_no_acc_target_route(
    target_id: str,
    body: Optional[ToggleTargetBody] = None,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.linkedin_no_acc_crawler_service import (
        toggle_linkedin_no_acc_target,
    )

    ok = await asyncio.to_thread(toggle_linkedin_no_acc_target, target_id, body.is_active if body else None)
    return {"success": ok}


# ── Phase 4: Facebook EAA Token Fast-Lane Pool CRUD & 1-Click Test ────────────

class CreateEaaTokenBody(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    access_token: str = Field(..., min_length=30)
    sticky_proxy_url: Optional[str] = None
    hourly_quota: int = Field(80, ge=5, le=150)


class UpdateEaaTokenBody(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=120)
    sticky_proxy_url: Optional[str] = None
    hourly_quota: Optional[int] = Field(None, ge=5, le=150)
    status: Optional[Literal["active", "disabled", "cooldown", "quarantined"]] = None


class TestEaaTokenBody(BaseModel):
    test_group_id_or_url: Optional[str] = None


class TestRawEaaTokenBody(BaseModel):
    access_token: str = Field(..., min_length=30)
    sticky_proxy_url: Optional[str] = None
    test_group_id_or_url: Optional[str] = None


@router.get("/eaa-tokens")
async def list_fb_eaa_tokens(
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    from app.modules.all_platform.services.fb_eaa_token_crawler_service import (
        list_eaa_tokens_sync,
    )

    items = await asyncio.to_thread(list_eaa_tokens_sync)
    return {"success": True, "items": items}


@router.post("/eaa-tokens")
async def add_fb_eaa_token(
    body: CreateEaaTokenBody,
    user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.fb_eaa_token_crawler_service import (
        create_eaa_token_sync,
    )

    creator = user.get("name") or user.get("email") or "Admin"
    try:
        item = await asyncio.to_thread(
            create_eaa_token_sync,
            label=body.label,
            access_token=body.access_token,
            sticky_proxy_url=body.sticky_proxy_url,
            hourly_quota=body.hourly_quota,
            created_by=creator,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "item": item}


@router.patch("/eaa-tokens/{token_id}")
async def patch_fb_eaa_token(
    token_id: str,
    body: UpdateEaaTokenBody,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.fb_eaa_token_crawler_service import (
        update_eaa_token_sync,
    )

    try:
        updated = await asyncio.to_thread(
            update_eaa_token_sync,
            token_id,
            body.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Không tìm thấy EAA token")
    return {"success": True, "item": updated}


@router.delete("/eaa-tokens/{token_id}")
async def delete_fb_eaa_token(
    token_id: str,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.fb_eaa_token_crawler_service import (
        delete_eaa_token_sync,
    )

    ok = await asyncio.to_thread(delete_eaa_token_sync, token_id)
    return {"success": ok}


@router.post("/eaa-tokens/{token_id}/test")
async def test_saved_fb_eaa_token(
    token_id: str,
    body: Optional[TestEaaTokenBody] = None,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.fb_eaa_token_crawler_service import (
        test_eaa_token_one_click,
    )

    res = await test_eaa_token_one_click(
        token_id=token_id,
        test_group_id_or_url=body.test_group_id_or_url if body else None,
    )
    return {"success": bool(res.get("ok")), **res}


@router.post("/eaa-tokens/test-raw")
async def test_raw_fb_eaa_token(
    body: TestRawEaaTokenBody,
    _user: dict[str, Any] = Depends(require_admin_or_leader),
) -> dict[str, Any]:
    from app.modules.all_platform.services.fb_eaa_token_crawler_service import (
        test_eaa_token_one_click,
    )

    res = await test_eaa_token_one_click(
        raw_token=body.access_token,
        sticky_proxy_url=body.sticky_proxy_url,
        test_group_id_or_url=body.test_group_id_or_url,
    )
    return {"success": bool(res.get("ok")), **res}
