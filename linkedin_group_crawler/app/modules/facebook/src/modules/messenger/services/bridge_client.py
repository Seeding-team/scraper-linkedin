"""HTTP client gọi sang dịch vụ Go messenger-bridge."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("fb_messenger.bridge_client")

CONNECT_TIMEOUT_SEC = 60.0
DEFAULT_TIMEOUT_SEC = 20.0


def is_enabled() -> bool:
    """Kiểm tra messenger-bridge đã được cấu hình đầy đủ URL và Key chưa."""
    return bool(
        (settings.messenger_bridge_url or "").strip()
        and (settings.messenger_bridge_key or "").strip()
    )


def _base_url() -> str:
    return (settings.messenger_bridge_url or "").strip().rstrip("/")


def _headers() -> Dict[str, str]:
    return {"X-Bridge-Key": (settings.messenger_bridge_key or "").strip()}


def _request(
    method: str,
    path: str,
    json_body: Optional[Dict[str, Any]] = None,
    timeout: float = DEFAULT_TIMEOUT_SEC,
) -> Dict[str, Any]:
    if not is_enabled():
        return {"ok": False, "error": "messenger-bridge is disabled"}

    url = f"{_base_url()}{path}"
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.request(method, url, headers=_headers(), json=json_body)
        try:
            data = resp.json()
        except Exception:
            data = None

        if isinstance(data, dict) and "ok" in data:
            if not data.get("ok") and not data.get("error"):
                data["error"] = f"HTTP {resp.status_code}"
            return data

        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": f"HTTP {resp.status_code}: {(resp.text or '')[:200]}",
            }

        if isinstance(data, dict):
            return {"ok": True, **data}
        return {"ok": True}
    except Exception as exc:
        logger.warning("messenger-bridge request %s %s failed: %s", method, path, exc)
        return {"ok": False, "error": str(exc)}


def connect(
    account_id: str,
    fb_user_id: str,
    cookie: str,
    user_agent: Optional[str] = None,
    proxy_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Khởi tạo hoặc cập nhật phiên kết nối của tài khoản trên messenger-bridge."""
    body: Dict[str, Any] = {
        "fb_user_id": str(fb_user_id),
        "cookie": cookie,
    }
    if user_agent:
        body["user_agent"] = user_agent
    if proxy_url:
        body["proxy_url"] = proxy_url
    return _request(
        "POST",
        f"/accounts/{account_id}/connect",
        json_body=body,
        timeout=CONNECT_TIMEOUT_SEC,
    )


def disconnect(account_id: str) -> Dict[str, Any]:
    """Ngắt kết nối và xoá phiên của tài khoản khỏi messenger-bridge."""
    return _request(
        "DELETE",
        f"/accounts/{account_id}",
        timeout=DEFAULT_TIMEOUT_SEC,
    )


def status(account_id: str) -> Dict[str, Any]:
    """Lấy trạng thái hiện tại của tài khoản trên messenger-bridge."""
    return _request(
        "GET",
        f"/accounts/{account_id}/status",
        timeout=DEFAULT_TIMEOUT_SEC,
    )


def send(
    account_id: str,
    recipient_id: str,
    text: str,
    client_msg_id: str,
) -> Dict[str, Any]:
    """Gửi tin nhắn qua messenger-bridge (tự động chọn E2EE hoặc thường)."""
    body: Dict[str, Any] = {
        "recipient_id": str(recipient_id),
        "text": text,
        "client_msg_id": str(client_msg_id),
    }
    return _request(
        "POST",
        f"/accounts/{account_id}/send",
        json_body=body,
        timeout=DEFAULT_TIMEOUT_SEC,
    )
