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
    safe_cfg = public_crawl_orchestrator.mask_config_for_api(updated)
    sims = public_crawl_orchestrator.rotator.snapshot_nodes(updated.get("proxy_urls"))
    public_crawl_orchestrator.append_log(
        "info",
        "config",
        (
            f"Cập nhật cấu hình: auto={'BẬT' if updated.get('enabled') else 'TẮT'}, "
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
