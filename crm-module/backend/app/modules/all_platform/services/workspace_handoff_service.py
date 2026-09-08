"""Chuyển workspace (brand) cho admin — chỉ admin mới thấy switcher, các role
khác mặc định thấy dữ liệu theo domain họ đang đứng (xem middleware trong
app/main.py), không liên quan tới file này.

Cookie phiên đăng nhập (`crawlpro_access_token`) bị trình duyệt giới hạn theo
domain — admin chuyển sang domain brand khác (thật) thì cookie KHÔNG tự mang
theo dù backend đã gộp 1 process. Cơ chế "handoff" ở đây: mint 1 mã dùng 1
lần (TTL ngắn) gắn với user hiện tại, redirect admin sang domain đích kèm mã,
domain đích đổi mã lấy cookie mới cho chính domain đó — không đi qua URL/log
1 JWT sống, chỉ đi qua 1 mã dùng 1 lần rồi bị đốt ngay.

Lưu mã trong bộ nhớ process (KHÔNG cần bền qua restart — hết hạn sau vài giây,
mất thì admin bấm lại) — chỉ đúng khi có ĐÚNG 1 backend process xử lý cả 3
domain (kiến trúc mục tiêu của việc gộp module này), không dùng được nếu sau
này lại tách về nhiều process/instance chạy song song phía sau 1 load balancer.
"""
from __future__ import annotations

import secrets
import time
from typing import Any

_CODE_TTL_SECONDS = 30
_codes: dict[str, dict[str, Any]] = {}


def _prune_expired(now: float) -> None:
    expired = [code for code, entry in _codes.items() if entry["expires_at"] < now]
    for code in expired:
        _codes.pop(code, None)


def mint_handoff_code(user_id: str) -> str:
    now = time.time()
    _prune_expired(now)
    code = secrets.token_urlsafe(24)
    _codes[code] = {"user_id": user_id, "expires_at": now + _CODE_TTL_SECONDS}
    return code


def consume_handoff_code(code: str) -> str | None:
    """Đốt mã (dùng 1 lần) — trả về user_id nếu hợp lệ/chưa hết hạn, None nếu không."""
    now = time.time()
    entry = _codes.pop(code, None)
    if not entry:
        return None
    if entry["expires_at"] < now:
        return None
    return entry["user_id"]
