"""Client mỏng cho Viber REST Bot API (https://developers.viber.com/docs/api/rest-bot-api/).

Mọi endpoint là ``POST {base}/<method>`` với header ``X-Viber-Auth-Token``; Viber trả
HTTP 200 kể cả khi lỗi, lỗi thật nằm ở ``status != 0`` + ``status_message`` -> ném
``ViberApiError`` để tầng service chuyển thành HTTPException có thông báo tiếng Việt.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, Dict, List, Optional

import httpx

from app.modules.all_platform.viber.config import settings

# Viber chỉ nhận ảnh JPEG/PNG/GIF dạng "picture"; ảnh quá lớn (iOS chặn > 1MB) gửi kiểu
# "file" để người nhận vẫn tải được thay vì gửi lỗi.
PICTURE_MIME = {"image/jpeg", "image/png", "image/gif"}
PICTURE_MAX_BYTES = 1 * 1024 * 1024
VIDEO_MAX_BYTES = 26 * 1024 * 1024
FILE_MAX_BYTES = 50 * 1024 * 1024
TEXT_MAX_CHARS = 7000
PICTURE_CAPTION_MAX_CHARS = 120
SENDER_NAME_MAX_CHARS = 28

WEBHOOK_EVENT_TYPES = ["delivered", "seen", "failed", "subscribed", "unsubscribed", "conversation_started"]

_STATUS_HINTS = {
    1: "Webhook URL không hợp lệ (Viber chỉ nhận HTTPS công khai).",
    2: "Auth token không hợp lệ.",
    3: "Yêu cầu không hợp lệ.",
    5: "Người nhận không tồn tại/không dùng Viber.",
    6: "Người nhận chưa đăng ký (subscribe) bot hoặc đã huỷ đăng ký.",
    7: "Bot không được phép gửi tin nhắn tới người nhận này.",
    10: "Phiên bản Viber của người nhận không hỗ trợ loại tin nhắn này.",
    12: "Gửi quá nhanh — Viber đang giới hạn tần suất, thử lại sau.",
    13: "Viber không truy cập được tệp đính kèm (URL media phải công khai).",
}


class ViberApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        hint = _STATUS_HINTS.get(status)
        super().__init__(f"{hint} ({message})" if hint else f"Viber lỗi {status}: {message}")


def verify_signature(auth_token: str, raw_body: bytes, signature: Optional[str]) -> bool:
    if not signature:
        return False
    expected = hmac.new(auth_token.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())


async def _call(auth_token: str, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            f"{settings.viber_api_base.rstrip('/')}/{method}",
            json=payload,
            headers={"X-Viber-Auth-Token": auth_token},
        )
    try:
        data = res.json()
    except ValueError:
        raise ViberApiError(-1, f"HTTP {res.status_code}: {res.text[:200]}")
    status = int(data.get("status", -1))
    if status != 0:
        raise ViberApiError(status, str(data.get("status_message") or "unknown"))
    return data


async def get_account_info(auth_token: str) -> Dict[str, Any]:
    return await _call(auth_token, "get_account_info", {})


async def set_webhook(auth_token: str, url: str, event_types: Optional[List[str]] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"url": url, "send_name": True, "send_photo": True}
    if url:
        payload["event_types"] = event_types or WEBHOOK_EVENT_TYPES
    return await _call(auth_token, "set_webhook", payload)


async def remove_webhook(auth_token: str) -> None:
    await _call(auth_token, "set_webhook", {"url": ""})


async def send_message(auth_token: str, receiver: str, sender_name: str, sender_avatar: Optional[str], body: Dict[str, Any]) -> str:
    """``body`` = phần riêng theo loại tin (``type`` + text/media/size/file_name...).
    Trả về ``message_token`` (str) Viber cấp cho tin vừa gửi."""
    sender: Dict[str, Any] = {"name": (sender_name or "Bot")[:SENDER_NAME_MAX_CHARS]}
    if sender_avatar:
        sender["avatar"] = sender_avatar
    payload = {"receiver": receiver, "min_api_version": 1, "sender": sender, **body}
    data = await _call(auth_token, "send_message", payload)
    return str(data.get("message_token"))


async def download(url: str) -> tuple[bytes, Optional[str]]:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.content, res.headers.get("content-type")
