"""Auth endpoints — register, login, logout, profile management."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from app.core.config import settings
from app.modules.all_platform.auth_deps import require_admin, require_admin_strict
from app.modules.all_platform.services.workspace_handoff_service import (
    consume_handoff_code,
    mint_handoff_code,
)
from app.modules.all_platform.schemas import (
    RegisterRequest,
    LoginRequest,
    GoogleLoginRequest,
    ChangePasswordRequest,
    DeactivateAccountRequest,
    UpdateProfileRequest,
    PromoteToLeaderRequest,
    BaseResponse,
    CheckEmailRequest,
    ResetPasswordRequest,
)
from pydantic import BaseModel
from app.modules.all_platform.services import (
    register_user,
    login_user,
    login_with_google,
    logout_user,
    decode_token,
    get_user_by_id,
    create_access_token,
    update_user_profile,
    verify_leader_code as verify_code,
    promote_to_leader,
    get_user_sessions,
    delete_session,
    delete_all_sessions,
    change_password,
    deactivate_account,
    reset_password_without_old,
    get_user_by_email,
    is_sale_member,
)

router = APIRouter()


def _get_user_from_header(authorization: str | None, request: Request | None = None) -> dict:
    """Extract and validate user from Bearer token or HttpOnly cookie."""
    if not authorization:
        if request:
            cookie_token = request.cookies.get("crawlpro_access_token")
            if cookie_token:
                authorization = f"Bearer {cookie_token}"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    try:
        user = get_user_by_id(user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Auth service temporarily unavailable") from exc
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.post("/register")
def auth_register(payload: RegisterRequest, response: Response) -> BaseResponse:
    """Register a new app user account.

    Sets an HttpOnly cookie for 5 days so the browser keeps the session without
    using localStorage.
    """
    try:
        data = register_user(
            email=payload.email,
            password=payload.password,
            name=payload.name,
        )
        token = (data or {}).get("access_token")
        if token:
            response.set_cookie(
                key="crawlpro_access_token",
                value=token,
                httponly=True,
                secure=False,
                samesite="lax",
                max_age=5 * 24 * 60 * 60,
                path="/",
            )
        return BaseResponse(success=True, message="Registration successful", data={"user": data.get("user")})
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=f"Registration failed: {e}")


@router.post("/login")
def auth_login(payload: LoginRequest, response: Response) -> BaseResponse:
    """Login with email and password.

    Sets an HttpOnly cookie for 5 days so the browser keeps the session without
    using localStorage.
    """
    try:
        data = login_user(email=payload.email, password=payload.password)
        if data.get("redirect_required"):
            return _redirect_response(data)
        token = (data or {}).get("access_token")
        if token:
            response.set_cookie(
                key="crawlpro_access_token",
                value=token,
                httponly=True,
                secure=False,
                samesite="lax",
                max_age=5 * 24 * 60 * 60,
                path="/",
            )
        return BaseResponse(success=True, message="Login successful", data={"user": data.get("user")})
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=f"Login failed: {e}")


def _redirect_response(data: dict) -> BaseResponse:
    """Tai khoan non-admin dang nhap nham site khac site da dang ky
    (home_instance) — mint 1 ma dung-1-lan (giong co che switcher cua admin,
    xem workspace_handoff_service.py) roi tra ve URL sang dung site, KHONG set
    cookie cho domain hien tai."""
    home_instance = data["home_instance"]
    target_base = settings.workspace_domains.get(home_instance)
    if not target_base:
        return BaseResponse(
            success=False,
            message="Tài khoản này thuộc site khác nhưng hệ thống chưa cấu hình được domain để chuyển hướng. Liên hệ admin.",
        )
    code = mint_handoff_code(data["user_id"])
    return BaseResponse(
        success=True,
        data={"redirect_required": True, "redirect_url": f"{target_base}/auth/handoff?code={code}"},
    )


@router.get("/workspaces")
def auth_list_workspaces(request: Request) -> BaseResponse:
    """Danh sách workspace (brand) đang cấu hình + workspace hiện tại (suy ra
    từ Host header của chính request này, xem middleware trong app/main.py).
    Không lộ thông tin nhạy cảm (chỉ tên brand + URL công khai) nên không cần
    auth — frontend dùng để hiện switcher (chỉ render UI khi role=admin, xem
    kiểm tra quyền thật ở /workspace-handoff bên dưới)."""
    current_instance = settings.crm_instance
    items = [
        {"instance": instance, "url": url, "current": instance == current_instance}
        for instance, url in settings.workspace_domains.items()
    ]
    return BaseResponse(success=True, data={"items": items, "current_instance": current_instance})


@router.post("/workspace-handoff")
def auth_mint_workspace_handoff(user: dict = Depends(require_admin_strict)) -> BaseResponse:
    """CHỈ admin (không tính leader) — sinh 1 mã dùng 1 lần (~30s) để mang
    session sang domain brand khác. Xem workspace_handoff_service.py để hiểu
    vì sao cần bước trung gian này thay vì redirect kèm thẳng JWT."""
    code = mint_handoff_code(user["id"])
    return BaseResponse(success=True, data={"code": code})


@router.get("/workspace-handoff/consume")
def auth_consume_workspace_handoff(code: str, response: Response) -> BaseResponse:
    """Đổi mã dùng 1 lần lấy cookie đăng nhập MỚI cho domain hiện tại (domain
    đích của switcher). Không cần auth (chính mã này LÀ bằng chứng quyền truy
    cập, đã bị đốt ngay sau khi đọc dù thành công hay thất bại)."""
    user_id = consume_handoff_code(code)
    if not user_id:
        raise HTTPException(status_code=400, detail="Mã chuyển workspace đã hết hạn hoặc không hợp lệ, vui lòng thử lại.")

    user = get_user_by_id(user_id)
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Tài khoản không hợp lệ hoặc đã bị vô hiệu hoá.")

    token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie(
        key="crawlpro_access_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=5 * 24 * 60 * 60,
        path="/",
    )
    return BaseResponse(
        success=True,
        data={
            "user": {
                "id": user["id"],
                "email": user["email"],
                "name": user.get("name"),
                "role": user.get("role", "member"),
            },
        },
    )


@router.post("/google")
def auth_google_login(payload: GoogleLoginRequest, response: Response) -> BaseResponse:
    """Login via Google Sign-In (ID token from Google Identity Services).

    Mirrors /login exactly on success — same cookie, same response shape — so
    every downstream page/route keeps working unchanged regardless of which
    login method was used.
    """
    try:
        data = login_with_google(payload.credential)
        if data.get("redirect_required"):
            return _redirect_response(data)
        token = (data or {}).get("access_token")
        if token:
            response.set_cookie(
                key="crawlpro_access_token",
                value=token,
                httponly=True,
                secure=False,
                samesite="lax",
                max_age=5 * 24 * 60 * 60,
                path="/",
            )
        return BaseResponse(success=True, message="Login successful", data={"user": data.get("user")})
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=f"Login failed: {e}")


@router.post("/check-email")
def auth_check_email(payload: CheckEmailRequest) -> BaseResponse:
    """Check if email exists for forgot password flow."""
    user = get_user_by_email(payload.email)
    if user:
        return BaseResponse(success=True, message="Email exists", data={"exists": True})
    return BaseResponse(success=False, message="Email không tồn tại trong hệ thống", data={"exists": False})


@router.post("/reset-password")
def auth_reset_password(payload: ResetPasswordRequest) -> BaseResponse:
    """Reset password without knowing current password (forgot password flow)."""
    try:
        reset_password_without_old(payload.email, payload.new_password)
        return BaseResponse(success=True, message="Đổi mật khẩu thành công")
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=f"Lỗi: {e}")


@router.post("/logout")
def auth_logout(response: Response, authorization: str | None = Header(None)) -> BaseResponse:
    """Logout: clear cookie session."""
    response.delete_cookie(key="crawlpro_access_token", path="/")
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        logout_user(token)
    return BaseResponse(success=True, message="Logged out")


@router.get("/me")
def auth_me(request: Request, authorization: str | None = Header(None)) -> BaseResponse:
    """Get current authenticated user profile.

    Accepts either Authorization Bearer token (legacy) or HttpOnly cookie.
    """
    try:
        cookie_token = request.cookies.get("crawlpro_access_token")
        authz = authorization
        if not authz and cookie_token:
            authz = f"Bearer {cookie_token}"

        user = _get_user_from_header(authz)
        return BaseResponse(success=True, data={
            "id": user.get("id"),
            "email": user.get("email"),
            "name": user.get("name"),
            "role": user.get("role"),
            "is_active": user.get("is_active"),
            "created_at": user.get("created_at"),
            "is_sale": is_sale_member(user.get("id")),
            "can_approve_quotes": bool(user.get("can_approve_quotes")),
        })
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.put("/me/profile")
def auth_update_profile(
    payload: UpdateProfileRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Update current user's profile."""
    try:
        user = _get_user_from_header(authorization, request)
        data = update_user_profile(user["id"], payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Profile updated", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.post("/promote-to-leader")
def auth_promote_to_leader(
    payload: PromoteToLeaderRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Promote current user to leader using leader code."""
    try:
        user = _get_user_from_header(authorization, request)
        data = promote_to_leader(user["id"], payload.leader_code)
        return BaseResponse(success=True, message="Promoted to leader", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/verify-leader-code")
def auth_verify_leader_code(code: str) -> BaseResponse:
    """Verify a leader code (no auth required)."""
    result = verify_code(code)
    return BaseResponse(success=True, data=result)


@router.get("/sessions")
def auth_get_sessions(request: Request, authorization: str | None = Header(None)) -> BaseResponse:
    """Get all active sessions for current user."""
    try:
        user = _get_user_from_header(authorization, request)
        data = get_user_sessions(user["id"])
        return BaseResponse(success=True, data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.delete("/sessions/{session_id}")
def auth_delete_session(
    session_id: str,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Delete a specific session."""
    try:
        user = _get_user_from_header(authorization, request)
        data = delete_session(session_id, user["id"])
        return BaseResponse(success=True, message="Session deleted", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.delete("/sessions")
def auth_delete_all_sessions(request: Request, authorization: str | None = Header(None)) -> BaseResponse:
    """Delete all sessions (logout from all devices)."""
    try:
        user = _get_user_from_header(authorization, request)
        data = delete_all_sessions(user["id"])
        return BaseResponse(success=True, message="All sessions deleted", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.put("/me/password")
def auth_change_password(
    payload: ChangePasswordRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Change the current user's password."""
    try:
        user = _get_user_from_header(authorization, request)
        change_password(user["id"], payload.current_password, payload.new_password)
        return BaseResponse(success=True, message="Password changed successfully")
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/me/deactivate")
def auth_deactivate_account(
    payload: DeactivateAccountRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Deactivate the current user's account."""
    try:
        user = _get_user_from_header(authorization, request)
        deactivate_account(user["id"], payload.password)
        return BaseResponse(success=True, message="Account deactivated")
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))


class AdminResetPasswordRequest(BaseModel):
    email: str

@router.post("/admin/reset-password")
def auth_admin_reset_password(
    payload: AdminResetPasswordRequest,
    _admin: dict = Depends(require_admin),
) -> BaseResponse:
    """Admin tool to reset password to 123123.

    Truoc day khong co Depends() nao ca -> bat ky ai cung reset duoc mat khau
    cua bat ky tai khoan nao (ke ca admin) ve gia tri co dinh "123123" ->
    chiem tai khoan hoan toan. Gio bat buoc phai la admin da xac thuc.
    """
    try:
        from app.modules.all_platform.services.auth_service import _hash_password
        from app.core.supabase_client import get_supabase_client
        sb = get_supabase_client()
        hashed = _hash_password("123123")
        res = sb.table("app_users").update({"password": hashed, "updated_at": "now()"}).eq("email", payload.email).execute()
        if not res.data:
            return BaseResponse(success=False, message="User not found")
        return BaseResponse(success=True, message=f"Password for {payload.email} reset to 123123")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
