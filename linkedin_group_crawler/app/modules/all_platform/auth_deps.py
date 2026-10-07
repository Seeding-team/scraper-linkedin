"""FastAPI dependencies dùng chung để xác thực + phân quyền cho router.

Bọc lại đúng pattern đang chạy đúng trong `routers/fb.py` (`_current_user`/`_role`)
— cookie JWT `crawlpro_access_token` (hoặc header `Authorization: Bearer`) →
`decode_token` → `get_user_by_id`. Tách ra module riêng để router khác (users,
vps...) dùng lại thay vì tự viết check quyền riêng (hoặc quên viết hẳn — đây
chính là nguyên nhân `POST /users/update-role` và `/vnc-vps` trước đây không
có auth gì cả, ai gọi cũng được).
"""
from __future__ import annotations

import hmac
import re
from typing import Any

from fastapi import Header, HTTPException, Request

from app.core.config import settings
from app.modules.all_platform.services import decode_token, get_user_by_id
from app.modules.all_platform.services.crm_permission_service import is_web_intake_user  # noqa: F401 (re-export)


# Khoá web-intake CHỈ mở đúng các endpoint mà Project 2 (web Learn) thực sự dùng — không phải bypass JWT toàn CRM.
# Mọi endpoint khác (duyệt/xoá/gửi báo giá, quản trị, người dùng...) vẫn bắt buộc JWT như bình thường.
# Path so khớp SAU tiền tố /api/all-platform. Đổi danh sách này đồng thời với whitelist của lib/crm-proxy.ts ở Project 2.
_API_PREFIX = "/api/all-platform"
_UUID = r"[0-9a-fA-F-]{36}"
_WEB_INTAKE_ALLOWED: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (method, re.compile(f"^{pattern}$"))
    for method, pattern in (
        # Master data (chỉ đọc)
        ("GET", r"/categories"),
        ("GET", r"/quote-approval-rules/active"),
        ("GET", r"/quote-forms"),
        ("GET", rf"/quote-forms/{_UUID}"),
        ("GET", rf"/quote-forms/{_UUID}/catalog-links"),
        ("GET", r"/quotes/issuer-companies"),
        ("GET", r"/quotes/exchange-rate"),  # tỷ giá USD/VND hệ thống (chỉ đọc; POST refresh/cập nhật vẫn cần JWT)
        ("GET", r"/price-book-items"),
        ("GET", r"/service-catalog"),
        ("GET", r"/service-catalog/(lookup|units|vat-rates)"),
        ("GET", rf"/service-catalog/{_UUID}/(pricing|components)"),
        ("GET", r"/users/by-quote-business-role"),
        # Khách hàng / liên hệ / dự án / cơ hội: chỉ đọc + tạo mới
        ("GET", r"/crm/customers"),
        ("POST", r"/crm/customers"),
        ("POST", r"/crm/customers/with-deal"),
        ("GET", rf"/crm/customers/{_UUID}"),
        ("GET", rf"/crm/customers/{_UUID}/contacts"),
        ("POST", rf"/crm/customers/{_UUID}/contacts"),
        ("GET", r"/projects"),
        ("GET", r"/projects/preview-code"),
        ("POST", r"/projects"),
        ("POST", r"/customer-leads"),
        # Báo giá: tạo + chỉnh bản nháp của chính mình. KHÔNG chuyển bước/gán owner (nội bộ làm trong CRM), KHÔNG duyệt/phát hành/xoá/gửi.
        ("GET", r"/quotes"),
        ("POST", r"/quotes"),
        ("GET", rf"/quotes/{_UUID}"),
        ("PUT", rf"/quotes/{_UUID}"),
        ("GET", rf"/quotes/{_UUID}/(handoff-checklist|activity-log|edit-permission|versions)"),
        ("PUT", rf"/quotes/{_UUID}/(handoff-checklist|print-layout-prefs)"),
        ("POST", rf"/quotes/{_UUID}/evaluate-rules"),
    )
)


def _web_intake_allows(method: str, path: str) -> bool:
    rel = path[len(_API_PREFIX):] if path.startswith(_API_PREFIX) else path
    rel = rel.rstrip("/") or "/"
    return any(m == method and rx.match(rel) for m, rx in _WEB_INTAKE_ALLOWED)


def resolve_web_intake_user(request: Request) -> dict[str, Any] | None:
    """Web ngoài (Project 2) xác thực bằng khoá API riêng thay vì đăng nhập mật khẩu.

    Trả None nếu tính năng tắt, request không gửi khoá đúng, HOẶC endpoint không nằm trong allowlist (để đi tiếp luồng
    JWT bình thường → 401). Khoá đúng + endpoint hợp lệ thì chạy dưới user kỹ thuật WEB_INTAKE_USER_ID — mọi kiểm tra
    quyền/role phía sau vẫn áp dụng như với user đó (user này là member, không có vai trò Sale/Presale).
    """
    expected = settings.web_intake_api_key
    if not expected:
        return None
    sent = request.headers.get("x-web-intake-key")
    if not sent or not hmac.compare_digest(sent.encode(), expected.encode()):
        return None
    if not _web_intake_allows(request.method.upper(), request.url.path):
        return None
    user_id = (settings.web_intake_user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=503, detail="WEB_INTAKE_USER_ID is not configured")
    try:
        user = get_user_by_id(user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Auth service temporarily unavailable") from exc
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Web intake user not found or inactive")
    return user


def get_current_user(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Xác thực người gọi qua JWT (cookie hoặc header Bearer) hoặc khoá web-intake. 401 nếu không hợp lệ."""
    intake_user = resolve_web_intake_user(request)
    if intake_user is not None:
        return intake_user
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
