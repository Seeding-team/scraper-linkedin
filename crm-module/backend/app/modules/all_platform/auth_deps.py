"""FastAPI dependencies dùng chung để xác thực + phân quyền cho router.

Bọc lại đúng pattern đang chạy đúng trong `routers/fb.py` (`_current_user`/`_role`)
— cookie JWT `crawlpro_access_token` (hoặc header `Authorization: Bearer`) →
`decode_token` → `get_user_by_id`. Tách ra module riêng để router khác (users,
vps...) dùng lại thay vì tự viết check quyền riêng (hoặc quên viết hẳn — đây
chính là nguyên nhân `POST /users/update-role` và `/vnc-vps` trước đây không
có auth gì cả, ai gọi cũng được).
"""
from __future__ import annotations

from typing import Any

from fastapi import Header, HTTPException, Request

from app.modules.all_platform.services import decode_token, get_user_by_id


def get_current_user(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Xác thực người gọi qua JWT (cookie hoặc header Bearer). 401 nếu không hợp lệ."""
    if not authorization:
        cookie_token = request.cookies.get("crawlpro_access_token")
        if cookie_token:
            authorization = f"Bearer {cookie_token}"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    payload = decode_token(authorization[7:])
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        user = get_user_by_id(str(payload["sub"]))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Auth service temporarily unavailable") from exc
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_admin(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """403 nếu người gọi không phải admin. Dùng cho endpoint nhạy cảm (đổi role, VPS...).

    Chữ ký PHẢI giống hệt `get_current_user` (chỉ Request + Header, không có
    tham số `dict` trần) — nếu không FastAPI sẽ hiểu nhầm tham số đó là body/query
    bắt buộc khi dùng qua `Depends(require_admin)`.
    """
    resolved = get_current_user(request, authorization)
    role = str(resolved.get("role") or "member").strip().lower()
    if role not in ("admin", "leader"):
        raise HTTPException(status_code=403, detail="Forbidden: Admin or leader role required")
    return resolved


def require_admin_strict(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """403 nếu không phải ĐÚNG role admin (leader KHÔNG được tính, khác
    `require_admin` ở trên) — dùng riêng cho tính năng switcher workspace: chỉ
    admin mới được xem/đổi qua các brand khác."""
    resolved = get_current_user(request, authorization)
    role = str(resolved.get("role") or "member").strip().lower()
    if role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin role required")
    return resolved


def require_admin_or_leader(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """403 nếu người gọi không phải admin/leader. Dùng cho endpoint quản lý thành
    viên team (sửa hồ sơ, liên kết tài khoản đăng nhập...) mà leader cũng cần làm
    được cho team mình, không chỉ riêng admin.
    """
    resolved = get_current_user(request, authorization)
    role = str(resolved.get("role") or "member").strip().lower()
    if role not in ("admin", "leader"):
        raise HTTPException(status_code=403, detail="Forbidden: Admin or leader role required")
    return resolved


def get_authenticated_caller_email(request: Request, authorization: str | None = Header(default=None)) -> str | None:
    """Email người gọi THẬT, lấy từ JWT (cookie `crawlpro_access_token`) — dùng thay
    cho việc tin header `X-Caller-Email` client tự gửi (giá trị đó trước đây lấy
    thẳng từ `localStorage`, ai cũng sửa được bằng DevTools để mạo danh bất kỳ ai).

    Trả None nếu không có JWT hợp lệ (KHÔNG raise 401) — một số route Zalo hiện coi
    "không có caller_email" là truy cập đầy đủ cho tương thích ngược; giữ nguyên
    hành vi đó, chỉ đổi NGUỒN của email từ "client tự khai" sang "xác thực thật".
    """
    try:
        user = get_current_user(request, authorization)
    except HTTPException:
        return None
    return str(user.get("email") or "").strip().lower() or None


async def require_admin_ws(websocket, authorization: str | None = None) -> dict[str, Any] | None:
    """Bản cho WebSocket — không raise HTTPException (không áp dụng được), tự đóng
    connection với close code 4403 nếu thiếu quyền. Trả None nếu đã đóng — caller
    phải kiểm tra và return ngay sau khi gọi hàm này."""
    token = authorization
    if not token:
        token = websocket.cookies.get("crawlpro_access_token")
    if not token:
        # Cho phép truyền qua query param ?token=... vì WebSocket client (vd
        # noVNC/xterm.js) thường không set được header/cookie tuỳ ý.
        token = websocket.query_params.get("token")

    if not token:
        await websocket.close(code=4401)
        return None

    payload = decode_token(token)
    if not payload or not payload.get("sub"):
        await websocket.close(code=4401)
        return None

    try:
        user = get_user_by_id(str(payload["sub"]))
    except Exception:
        await websocket.close(code=4503)
        return None

    if not user or not user.get("is_active", True):
        await websocket.close(code=4401)
        return None

    role = str(user.get("role") or "member").strip().lower()
    if role not in ("admin", "leader"):
        await websocket.close(code=4403)
        return None

    return user
