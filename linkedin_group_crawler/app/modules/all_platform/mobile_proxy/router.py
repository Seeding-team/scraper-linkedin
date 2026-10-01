"""Admin mobile SIM proxy — env URLs + live console(s) on phone host PC(s).

Supports one phone today and more later (see config.py: MOBILE_PROXY_NODES).
Each endpoint here talks to every node that has a console configured and
returns per-node results, so the admin UI can show/operate several SIMs.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import require_admin
from app.modules.all_platform.mobile_proxy.client import console_request, is_mobile_proxy_console_enabled
from app.modules.all_platform.mobile_proxy.config import (
    build_node_config,
    node_console_targets,
    set_node_label,
)


router = APIRouter()


@router.get("/config")
def mobile_proxy_config(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return build_node_config()


class SetLabelBody(BaseModel):
    label: str = Field(min_length=1, max_length=64)


@router.patch("/nodes/{node_id}/label")
def mobile_proxy_set_label(
    node_id: str,
    body: SetLabelBody,
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    if not set_node_label(node_id, body.label):
        raise HTTPException(status_code=404, detail=f"Unknown node '{node_id}'.")
    return build_node_config()


async def _live_for_node(target: dict[str, Any], path: str, method: str = "GET") -> dict[str, Any]:
    try:
        data = await console_request(method, path, target["consoleUrl"], target["apiKey"])
        return {"id": target["id"], "label": target["label"], "data": data, "error": None}
    except Exception as exc:  # noqa: BLE001 - surfaced to the admin UI, not swallowed
        detail = exc.detail if hasattr(exc, "detail") else str(exc)  # type: ignore[attr-defined]
        detail = detail if isinstance(detail, str) else str(detail)
        return {"id": target["id"], "label": target["label"], "data": None, "error": detail}


@router.get("/status")
async def mobile_proxy_status(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    base = build_node_config()
    targets = node_console_targets()
    if not targets:
        return {**base, "live": [], "liveError": "Chưa node nào cấu hình MOBILE_PROXY_CONSOLE_URL."}
    live = [await _live_for_node(t, "/api/status") for t in targets]
    return {**base, "live": live, "liveError": None}


@router.post("/rotate")
async def mobile_proxy_rotate(
    node_id: str | None = None,
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    targets = node_console_targets()
    if node_id:
        targets = [t for t in targets if t["id"] == node_id]
    if not targets:
        return {"ok": False, "error": f"No console configured for node '{node_id or '*'}'.", "results": []}
    results = [await _live_for_node(t, "/api/rotate", method="POST") for t in targets]
    return {"ok": all(r["error"] is None for r in results), "results": results}


@router.get("/sms")
async def mobile_proxy_sms(
    node_id: str | None = None,
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    targets = node_console_targets()
    if node_id:
        targets = [t for t in targets if t["id"] == node_id]
    if not targets:
        return {"messages": [], "byNode": [], "error": "No console configured."}
    by_node = [await _live_for_node(t, "/api/sms") for t in targets]
    merged: list[Any] = []
    for entry in by_node:
        if entry["data"]:
            merged.extend(entry["data"].get("messages") or entry["data"].get("cached") or [])
    return {"messages": merged, "byNode": by_node}


# Re-export for callers that only need the boolean check.
__all__ = ["router", "is_mobile_proxy_console_enabled"]
