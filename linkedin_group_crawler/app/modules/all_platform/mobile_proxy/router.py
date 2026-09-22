"""Admin mobile SIM proxy — env URLs + live console on phone host PC."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.modules.all_platform.auth_deps import require_admin
from app.modules.all_platform.mobile_proxy.client import console_request, is_mobile_proxy_console_enabled
from app.modules.all_platform.mobile_proxy.config import build_node_config


router = APIRouter()


@router.get("/config")
def mobile_proxy_config(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return build_node_config()


@router.get("/status")
async def mobile_proxy_status(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    from fastapi import HTTPException

    base = build_node_config()
    if not is_mobile_proxy_console_enabled():
        return {**base, "live": None, "liveError": "MOBILE_PROXY_CONSOLE_URL chưa cấu hình trên backend."}
    try:
        live = await console_request("GET", "/api/status", timeout=120.0)
        return {**base, "live": live, "liveError": None}
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return {**base, "live": None, "liveError": detail}


@router.post("/rotate")
async def mobile_proxy_rotate(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return await console_request("POST", "/api/rotate", timeout=120.0)


@router.get("/sms")
async def mobile_proxy_sms(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return await console_request("GET", "/api/sms", timeout=120.0)
