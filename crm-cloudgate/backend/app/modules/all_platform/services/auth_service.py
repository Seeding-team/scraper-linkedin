"""Authentication service — JWT-based login/register/logout for app users."""

from __future__ import annotations

import hashlib
import secrets
import time
from threading import Thread
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.crm_permission_service import is_sale_member

_USER_PUBLIC_FIELDS = "id, email, name, role, is_active, can_approve_quotes, created_at, updated_at"
_USER_CACHE_TTL_SECONDS = 30.0
_USER_BY_ID_CACHE: dict[str, tuple[float, dict]] = {}
_USER_BY_EMAIL_CACHE: dict[str, tuple[float, dict]] = {}


def _copy_user(user: dict) -> dict:
    clean = dict(user)
    clean.pop("password", None)
    return clean


def _cache_user(user: dict) -> dict:
    clean = _copy_user(user)
    expires_at = time.monotonic() + _USER_CACHE_TTL_SECONDS
    user_id = str(clean.get("id") or "")
    email = str(clean.get("email") or "").lower().strip()
    if user_id:
        _USER_BY_ID_CACHE[user_id] = (expires_at, clean)
    if email:
        _USER_BY_EMAIL_CACHE[email] = (expires_at, clean)
    if len(_USER_BY_ID_CACHE) > 1000:
        for key in list(_USER_BY_ID_CACHE.keys())[:-1000]:
            _USER_BY_ID_CACHE.pop(key, None)
    if len(_USER_BY_EMAIL_CACHE) > 1000:
        for key in list(_USER_BY_EMAIL_CACHE.keys())[:-1000]:
            _USER_BY_EMAIL_CACHE.pop(key, None)
    return dict(clean)


def _cached_user(cache: dict[str, tuple[float, dict]], key: str) -> Optional[dict]:
    cached = cache.get(key)
    if not cached:
        return None
    expires_at, user = cached
    if expires_at <= time.monotonic():
        cache.pop(key, None)
        return None
    return dict(user)


def clear_user_cache(user_id: str | None = None, email: str | None = None) -> None:
    if user_id:
        _USER_BY_ID_CACHE.pop(str(user_id), None)
    if email:
        _USER_BY_EMAIL_CACHE.pop(str(email).lower().strip(), None)


def _hash_password(password: str) -> str:
    """Hash a password with bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _hash_token(token: str) -> str:
    """SHA-256 hash a JWT token for storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user_id: str, email: str, role: str) -> str:
    """Create a JWT access token."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[dict]:
    """Decode and verify a JWT token. Returns payload or None if invalid."""
    try:
        return jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        return None


def register_user(email: str, password: str, name: Optional[str] = None) -> dict:
    """Register a new app user. Returns user data or raises ValueError."""
    # Check if email already exists
    existing = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select("id").eq("email", email.lower()).execute()
    )
    if existing.data:
        raise ValueError("Email already registered")

    hashed_pw = _hash_password(password)
    user_data = {
        "email": email.lower().strip(),
        "password": hashed_pw,
        "name": name.strip() if name else None,
        "role": "member",
        "is_active": True,
        # Site (instance) da dang ky, suy tu Host header cua chinh request nay
        # (xem middleware resolve_crm_instance_middleware trong app/main.py) —
        # dung de chan/redirect neu sau nay dang nhap nham site khac.
        "home_instance": settings.crm_instance,
    }
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").insert(user_data).execute()
    )
    if not result.data:
        raise ValueError("Failed to create user")

    user = result.data[0]
    cached_user = _cache_user(user)
    access_token = create_access_token(user["id"], user["email"], user["role"])

    _store_session_async(user["id"], access_token)

    return {
        "user": {
            "id": cached_user["id"],
            "email": cached_user["email"],
            "name": cached_user.get("name"),
            "role": cached_user["role"],
        },
        "access_token": access_token,
    }


def _check_home_instance_redirect(user: dict) -> Optional[dict]:
    """Non-admin: neu tai khoan co home_instance (site da dang ky) khac voi
    instance dang phuc vu request HIEN TAI (settings.crm_instance) -> tra ve
    tin hieu redirect thay vi dang nhap thang. Admin luon duoc bo qua (dang
    nhap truc tiep duoc o ca 3 site, dung switcher rieng de chuyen qua lai).
    home_instance=None (tai khoan tao truoc tinh nang nay) -> khong bi rang
    buoc."""
    home_instance = user.get("home_instance")
    if user.get("role") == "admin" or not home_instance:
        return None
    if home_instance == settings.crm_instance:
        return None
    return {
        "redirect_required": True,
        "user_id": user["id"],
        "home_instance": home_instance,
    }


def login_user(email: str, password: str) -> dict:
    """Login an existing app user. Returns user + token, or a redirect signal
    if this account belongs to a different site (home_instance), or raises
    ValueError."""
    result = execute_supabase_query(
        lambda: get_supabase_client()
        .table("app_users")
        .select("id, email, name, role, is_active, can_approve_quotes, password, home_instance")
        .eq("email", email.lower().strip())
        .execute()
    )
    if not result.data:
        raise ValueError("Email không tồn tại")

    user = result.data[0]
    if not user.get("is_active", True):
        raise ValueError("Tài khoản đã bị vô hiệu hóa")

    if not _verify_password(password, user["password"]):
        raise ValueError("Sai mật khẩu")

    redirect = _check_home_instance_redirect(user)
    if redirect:
        return redirect

    cached_user = _cache_user(user)
    access_token = create_access_token(user["id"], user["email"], user["role"])

    _store_session_async(user["id"], access_token)

    return {
        "user": {
            "id": cached_user["id"],
            "email": cached_user["email"],
            "name": cached_user.get("name"),
            "role": cached_user.get("role", "member"),
            "is_sale": is_sale_member(cached_user["id"]),
            "can_approve_quotes": bool(cached_user.get("can_approve_quotes")),
        },
        "access_token": access_token,
    }


_VALID_ROLES = ("admin", "leader", "member")


def admin_create_user(email: str, name: Optional[str], role: str) -> dict:
    """Admin-only: provision a new app_users row for someone who will log in via
    Google Sign-In. Google login never auto-creates accounts (see
    login_with_google) — this is the explicit "add this email" step an admin
    does instead. Sets a random password nobody knows (password column is
    NOT NULL); the account is only ever meant to be used via Google.

    Neu email nay DA co trong app_users (vd admin bam "Tao tai khoan" cho 1
    member ma email do that ra da duoc cap tai khoan tu truoc, hoac 2 member
    trong danh ba tinh co dung chung 1 email), KHONG bao loi trung - tra ve
    thang tai khoan da co de FE lien ket (members.linked_user_id) vao do, dung
    tinh than "chi lien ket, khong tao trung" thay vi chan thao tac.
    """
    email = email.lower().strip()
    if not email or "@" not in email:
        raise ValueError("Email không hợp lệ")
    if role not in _VALID_ROLES:
        raise ValueError(f"Role phải là một trong: {', '.join(_VALID_ROLES)}")

    existing = execute_supabase_query(
        lambda: get_supabase_client()
        .table("app_users")
        .select("id, email, name, role")
        .eq("email", email)
        .execute()
    )
    if existing.data:
        user = existing.data[0]
        return {
            "id": user["id"],
            "email": user["email"],
            "name": user.get("name"),
            "role": user["role"],
            "already_existed": True,
        }

    random_password = secrets.token_urlsafe(32)
    user_data = {
        "email": email,
        "password": _hash_password(random_password),
        "name": (name or "").strip() or None,
        "role": role,
        "is_active": True,
    }
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").insert(user_data).execute()
    )
    if not result.data:
        raise ValueError("Không tạo được tài khoản")

    user = result.data[0]
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name"),
        "role": user["role"],
    }


def login_with_google(id_token_str: str) -> dict:
    """Login via Google Sign-In. Verifies the ID token against our OAuth client,
    then maps the verified email to an EXISTING app_users row — never creates a
    new account here (admin stays the only one who provisions accounts).

    Returns user + token or raises ValueError with the same messages as
    login_user() so the frontend error handling is unchanged.
    """
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    if not settings.google_oauth_client_id:
        raise ValueError("Google Sign-In chưa được cấu hình trên server")

    try:
        claims = google_id_token.verify_oauth2_token(
            id_token_str, google_requests.Request(), settings.google_oauth_client_id,
        )
    except Exception:
        raise ValueError("Token Google không hợp lệ hoặc đã hết hạn")

    if not claims.get("email_verified"):
        raise ValueError("Email Google chưa được xác minh")

    email = str(claims.get("email") or "").lower().strip()
    if not email:
        raise ValueError("Không lấy được email từ tài khoản Google")

    result = execute_supabase_query(
        lambda: get_supabase_client()
        .table("app_users")
        .select("id, email, name, role, is_active, can_approve_quotes, home_instance")
        .eq("email", email)
        .execute()
    )
    if not result.data:
        raise ValueError("Email chưa được cấp tài khoản trong hệ thống. Liên hệ admin để được thêm.")

    user = result.data[0]
    if not user.get("is_active", True):
        raise ValueError("Tài khoản đã bị vô hiệu hóa")

    redirect = _check_home_instance_redirect(user)
    if redirect:
        return redirect

    cached_user = _cache_user(user)
    access_token = create_access_token(user["id"], user["email"], user["role"])

    _store_session_async(user["id"], access_token)

    return {
        "user": {
            "id": cached_user["id"],
            "email": cached_user["email"],
            "name": cached_user.get("name"),
            "role": cached_user.get("role", "member"),
            "is_sale": is_sale_member(cached_user["id"]),
            "can_approve_quotes": bool(cached_user.get("can_approve_quotes")),
        },
        "access_token": access_token,
    }


def logout_user(token: str) -> dict:
    """Logout: remove session by token hash.

    Some deployments don't have `public.user_sessions` (older schema). In that case
    we treat logout as a no-op (client will still discard JWT).
    """
    token_hash = _hash_token(token)
    try:
        execute_supabase_query(
            lambda: get_supabase_client()
            .table("user_sessions")
            .delete()
            .eq("token_hash", token_hash)
            .execute(),
            attempts=2,
        )
    except Exception:
        # Best-effort: don't block logout if sessions table missing
        pass
    return {"logged_out": True}


def _store_session_async(user_id: str, token: str) -> None:
    Thread(target=_store_session, args=(user_id, token), daemon=True).start()


def _store_session(user_id: str, token: str, user_agent: Optional[str] = None, ip: Optional[str] = None) -> None:
    """Store a session in user_sessions table.

    Some Supabase projects may not have this table yet; login/register should still
    succeed even if we can't persist sessions.
    """
    token_hash = _hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    try:
        execute_supabase_query(
            lambda: get_supabase_client().table("user_sessions").insert({
                "user_id": user_id,
                "token_hash": token_hash,
                "user_agent": user_agent,
                "ip_address": ip,
                "expires_at": expires_at.isoformat(),
            }).execute(),
            attempts=2,
        )
    except Exception:
        # Best-effort: don't block login/register if sessions table missing
        pass


def get_user_by_id(user_id: str) -> Optional[dict]:
    """Get user by ID."""
    user_key = str(user_id)
    cached = _cached_user(_USER_BY_ID_CACHE, user_key)
    if cached:
        return cached
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select(_USER_PUBLIC_FIELDS).eq("id", user_key).execute()
    )
    if result.data:
        return _cache_user(result.data[0])
    return None


def get_user_by_email(email: str) -> Optional[dict]:
    """Get user by email."""
    email_key = email.lower().strip()
    cached = _cached_user(_USER_BY_EMAIL_CACHE, email_key)
    if cached:
        return cached
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select(_USER_PUBLIC_FIELDS).eq("email", email_key).execute()
    )
    if result.data:
        return _cache_user(result.data[0])
    return None


def update_user_profile(user_id: str, updates: dict) -> dict:
    """Update user profile (name, etc)."""
    safe_updates = {k: v for k, v in updates.items() if k in ("name") and v is not None}
    safe_updates["updated_at"] = "now()"
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").update(safe_updates).eq("id", user_id).execute()
    )
    if result.data:
        clear_user_cache(user_id=user_id)
        return _cache_user(result.data[0])
    return {}


def _store_session(user_id: str, token: str, user_agent: Optional[str] = None, ip: Optional[str] = None) -> None:
    """(Deprecated) Store a session in user_sessions table.

    We now keep auth session on the browser via HttpOnly cookie.
    This function remains for backward-compat but is best-effort.
    """
    token_hash = _hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    try:
        execute_supabase_query(
            lambda: get_supabase_client().table("user_sessions").insert({
                "user_id": user_id,
                "token_hash": token_hash,
                "user_agent": user_agent,
                "ip_address": ip,
                "expires_at": expires_at.isoformat(),
            }).execute(),
            attempts=2,
        )
    except Exception:
        pass


def get_user_sessions(user_id: str) -> list[dict]:
    """Get all active sessions for a user.

    If `user_sessions` table doesn't exist, return empty list.
    """
    try:
        result = execute_supabase_query(
            lambda: (
                get_supabase_client().table("user_sessions")
                .select("id, user_agent, ip_address, created_at, expires_at")
                .eq("user_id", user_id)
                .gte("expires_at", datetime.now(timezone.utc).isoformat())
                .order("created_at", desc=True)
                .execute()
            ),
            attempts=2,
        )
        return result.data or []
    except Exception:
        return []


def delete_session(session_id: str, user_id: str) -> dict:
    """Delete a specific session (for logout from specific device).

    If `user_sessions` table doesn't exist, treat as no-op.
    """
    try:
        result = execute_supabase_query(
            lambda: (
                get_supabase_client().table("user_sessions")
                .delete()
                .eq("id", session_id)
                .eq("user_id", user_id)
                .execute()
            ),
            attempts=2,
        )
        return {"deleted": len(result.data) if result.data else 0}
    except Exception:
        return {"deleted": 0}


def delete_all_sessions(user_id: str) -> dict:
    """Delete all sessions for a user (logout from all devices).

    If `user_sessions` table doesn't exist, treat as no-op.
    """
    try:
        result = execute_supabase_query(
            lambda: get_supabase_client().table("user_sessions").delete().eq("user_id", user_id).execute(),
            attempts=2,
        )
        return {"deleted": len(result.data) if result.data else 0}
    except Exception:
        return {"deleted": 0}


def verify_leader_code(code: str) -> dict:
    """Verify a leader code from the leader_codes table."""
    result = execute_supabase_query(
        lambda: (
            get_supabase_client().table("leader_codes")
            .select("*")
            .eq("code", code)
            .eq("is_active", True)
            .execute()
        )
    )
    if not result.data:
        return {"valid": False, "reason": "Invalid code"}

    code_row = result.data[0]

    # Check expiration
    expires_at = code_row.get("expires_at")
    if expires_at:
        try:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > exp:
                return {"valid": False, "reason": "Code expired"}
        except Exception:
            pass

    # Check usage limit
    max_uses = code_row.get("max_uses")
    used_count = code_row.get("used_count", 0)
    if max_uses is not None and used_count >= max_uses:
        return {"valid": False, "reason": "Code usage limit reached"}

    return {"valid": True, "code_id": code_row["id"]}


def deactivate_account(user_id: str, password: str) -> None:
    """Deactivate account after password verification."""
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select("password").eq("id", user_id).execute()
    )
    if not result.data:
        raise ValueError("User not found")

    user = result.data[0]
    if not _verify_password(password, user["password"]):
        raise ValueError("Invalid password")

    execute_supabase_query(
        lambda: get_supabase_client()
        .table("app_users")
        .update({"is_active": False, "updated_at": "now()"})
        .eq("id", user_id)
        .execute()
    )
    clear_user_cache(user_id=user_id)
    # Also delete all sessions
    delete_all_sessions(user_id)


def change_password(user_id: str, current_password: str, new_password: str) -> None:
    """Change user password after verifying current password."""
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select("password").eq("id", user_id).execute()
    )
    if not result.data:
        raise ValueError("User not found")

    user = result.data[0]
    if not _verify_password(current_password, user["password"]):
        raise ValueError("Current password is incorrect")

    if _verify_password(new_password, user["password"]):
        raise ValueError("New password must be different from current password")

    hashed_pw = _hash_password(new_password)
    execute_supabase_query(
        lambda: get_supabase_client()
        .table("app_users")
        .update({"password": hashed_pw, "updated_at": "now()"})
        .eq("id", user_id)
        .execute()
    )
    clear_user_cache(user_id=user_id)
    delete_all_sessions(user_id)


def reset_password_without_old(email: str, new_password: str) -> None:
    """Reset user password by email without verifying the current password."""
    result = execute_supabase_query(
        lambda: get_supabase_client().table("app_users").select("id").eq("email", email.lower().strip()).execute()
    )
    if not result.data:
        raise ValueError("Email không tồn tại trong hệ thống")
    user_id = result.data[0]["id"]
    hashed_pw = _hash_password(new_password)
    execute_supabase_query(
        lambda: get_supabase_client()
        .table("app_users")
        .update({"password": hashed_pw, "updated_at": "now()"})
        .eq("id", user_id)
        .execute()
    )
    clear_user_cache(user_id=user_id, email=email)
    delete_all_sessions(user_id)


def promote_to_leader(user_id: str, leader_code: str) -> dict:
    """Promote a user to leader role after verifying code."""
    code_check = verify_leader_code(leader_code)
    if not code_check.get("valid"):
        raise ValueError(code_check.get("reason", "Invalid code"))

    result = execute_supabase_query(
        lambda: (
            get_supabase_client().table("app_users")
            .update({"role": "leader", "updated_at": "now()"})
            .eq("id", user_id)
            .execute()
        )
    )
    if not result.data:
        raise ValueError("User not found")
    clear_user_cache(user_id=user_id)

    code_id = code_check.get("code_id")
    if code_id:
        used_res = execute_supabase_query(
            lambda: get_supabase_client().table("leader_codes").select("used_count").eq("id", code_id).execute()
        )
        used_count = (used_res.data or [{}])[0].get("used_count", 0)
        execute_supabase_query(
            lambda: get_supabase_client()
            .table("leader_codes")
            .update({"used_count": used_count + 1})
            .eq("id", code_id)
            .execute()
        )

    return {"user_id": user_id, "role": "leader"}
