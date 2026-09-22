"""HTTP client for the mobile-proxy-console on the phone host PC.

Each SIM/phone node has its own console base URL (and optional API key) —
see mobile_proxy/config.py for how those are resolved from env for one or
many nodes.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from app.modules.all_platform.mobile_proxy.config import node_console_targets


def _headers(api_key: str | None) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["X-Proxy-Console-Key"] = api_key
    return headers


def is_mobile_proxy_console_enabled() -> bool:
    return len(node_console_targets()) > 0


async def console_request(
    method: str,
    path: str,
    base_url: str,
    api_key: str | None = None,
    timeout: float = 90.0,
) -> Any:
    base = base_url.rstrip("/")
    if not base:
        raise HTTPException(status_code=503, detail="Console URL is not configured for this node.")
    url = f"{base}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(method, url, headers=_headers(api_key))
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Mobile proxy console is not reachable at {base}: {exc}",
        ) from exc
    if response.status_code >= 400:
        detail: Any
        try:
            detail = response.json()
        except ValueError:
            detail = response.text or f"HTTP {response.status_code}"
        raise HTTPException(status_code=response.status_code, detail=detail)
    if not response.content:
        return {}
    return response.json()


async def console_request_default(method: str, path: str, timeout: float = 90.0) -> Any:
    """Convenience for the common single-node case: uses the first configured node."""
    targets = node_console_targets()
    if not targets:
        raise HTTPException(
            status_code=503,
            detail="No mobile-proxy-console node is configured (MOBILE_PROXY_CONSOLE_URL).",
        )
    first = targets[0]
    return await console_request(method, path, first["consoleUrl"], first["apiKey"], timeout)
