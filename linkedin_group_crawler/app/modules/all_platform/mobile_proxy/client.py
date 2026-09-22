"""HTTP client for the mobile-proxy-console on the phone host PC."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException


def _console_base_url() -> str | None:
    raw = os.getenv("MOBILE_PROXY_CONSOLE_URL", "").strip().rstrip("/")
    return raw or None


def _console_api_key() -> str | None:
    raw = os.getenv("MOBILE_PROXY_CONSOLE_API_KEY", "").strip()
    return raw or None


def is_mobile_proxy_console_enabled() -> bool:
    return _console_base_url() is not None


def _headers() -> dict[str, str]:
    headers = {"Accept": "application/json"}
    key = _console_api_key()
    if key:
        headers["X-Proxy-Console-Key"] = key
    return headers


async def console_request(method: str, path: str, timeout: float = 90.0) -> Any:
    base = _console_base_url()
    if not base:
        raise HTTPException(
            status_code=503,
            detail="MOBILE_PROXY_CONSOLE_URL is not configured on the backend.",
        )
    url = f"{base}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(method, url, headers=_headers())
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
