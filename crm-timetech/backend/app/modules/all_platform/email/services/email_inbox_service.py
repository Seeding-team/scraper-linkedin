"""Persistent IMAP/SMTP email inbox for CRM Omnichannel.

All rows are scoped with server-side ``CRM_INSTANCE``. Credentials come from
the encrypted per-instance ``quote_delivery_channels`` record or the multi-account
encrypted vault. There is no in-memory or fixture fallback in this module.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import imaplib
import json
import os
import re
import secrets
import smtplib
import ssl
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from email import message_from_bytes, policy
from email.headerregistry import Address
from email.message import EmailMessage, Message
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Optional

import httpx
from loguru import logger

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.email.schemas.email_inbox import (
    CrmContractItem, EmailAccountResponse, EmailAttachment,
    EmailConversationResponse, EmailMessageResponse, EmailSendRequest,
    EmailSimulateIncomingRequest, EmailComposeRequest,
    EmailAccountConnectImapRequest,
)
from app.modules.all_platform.services import quote_email_provider_service as provider

ATTACHMENT_BUCKET = "omnichannel-email-attachments"
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024

_vault_lock = threading.Lock()


class EmailInboxError(RuntimeError):
    pass


class EmailInboxSchemaError(EmailInboxError):
    pass


class EmailSendError(EmailInboxError):
    pass


def _workspace() -> str:
    value = (getattr(settings, "crm_instance", "") or "").strip().lower()
    if not value:
        raise EmailInboxError("CRM_INSTANCE chưa được cấu hình.")
    return value


def _db():
    return get_supabase_client()


def _run(operation):
    try:
        return execute_supabase_query(operation)
    except Exception as exc:
        text = str(exc).lower()
        if "omnichannel_email_" in text and (
            "does not exist" in text or "pgrst205" in text or "schema cache" in text
        ):
            raise EmailInboxSchemaError(
                "Database chưa áp dụng đầy đủ migration Email Inbox 201-203."
            ) from exc
        raise


def _account_id(address: str) -> str:
    return "email-" + hashlib.sha256(f"{_workspace()}:{address.lower()}".encode()).hexdigest()[:16]


def _vault_file_path() -> Path:
    for base in [Path("/app/artifacts"), Path("/app/storage"), Path("./storage"), Path(".")]:
        if base.exists() and base.is_dir():
            return base / "omnichannel_email_accounts_vault.json"
    return Path("omnichannel_email_accounts_vault.json")


def _encrypt_credentials(data: dict) -> str:
    raw = json.dumps(data)
    fernet = provider._get_fernet()
    return fernet.encrypt(raw.encode("utf-8")).decode("ascii")


def _decrypt_credentials(token_str: str) -> dict:
    if not token_str:
        return {}
    fernet = provider._get_fernet()
    try:
        raw = fernet.decrypt(token_str.encode("ascii")).decode("utf-8")
        return json.loads(raw)
    except Exception:
        return {}


def _load_vault() -> dict[str, dict[str, Any]]:
    with _vault_lock:
        path = _vault_file_path()
        if not path.exists():
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.warning("Failed to read email accounts vault {}: {}", path, exc)
            return {}


def _account_row_to_info(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "workspace": row.get("instance"),
        "email": (row.get("account_email") or "").lower(),
        "name": row.get("account_name") or row.get("account_email"),
        "provider_type": row.get("provider_type") or "google_oauth",
        "encrypted_credentials": row.get("encrypted_credentials") or "",
        "status": row.get("status") or "connected",
        "is_active": bool(row.get("is_active", True)),
        "is_default": bool(row.get("is_default", False)),
        "last_synced_at": row.get("last_synced_at"),
        "last_sync_error": row.get("last_sync_error"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _account_rows(active_only: bool = True) -> list[dict[str, Any]]:
    query = _db().table("omnichannel_email_accounts").select("*").eq("instance", _workspace())
    if active_only:
        query = query.eq("is_active", True)
    result = _run(lambda: query.order("created_at").execute())
    return list(result.data or [])


def _account_row_by_email(email: str) -> Optional[dict[str, Any]]:
    result = _run(lambda: _db().table("omnichannel_email_accounts").select("*")
        .eq("instance", _workspace()).eq("account_email", email.strip().lower()).limit(1).execute())
    return result.data[0] if result.data else None


def _account_row_by_id(account_id: str) -> Optional[dict[str, Any]]:
    result = _run(lambda: _db().table("omnichannel_email_accounts").select("*")
        .eq("instance", _workspace()).eq("id", account_id).limit(1).execute())
    return result.data[0] if result.data else None


def _upsert_account_record(values: dict[str, Any]) -> dict[str, Any]:
    payload = {**values, "instance": _workspace(), "updated_at": datetime.now(timezone.utc).isoformat()}
    result = _run(lambda: _db().table("omnichannel_email_accounts")
        .upsert(payload, on_conflict="instance,account_email").execute())
    if not result.data:
        raise EmailInboxError("Không thể lưu tài khoản email vào database.")
    return result.data[0]


def _import_legacy_vault_once() -> None:
    """Copy legacy encrypted accounts into DB without deleting or rewriting the vault."""
    ws = _workspace()
    legacy_accounts = _load_vault().get(ws, {})
    if not legacy_accounts:
        return
    existing = {str(row.get("account_email") or "").lower() for row in _account_rows(active_only=False)}
    for account in legacy_accounts.values():
        email = str(account.get("email") or "").strip().lower()
        if not email or email in existing:
            continue
        _upsert_account_record({
            "account_email": email,
            "account_name": account.get("name") or email,
            "provider_type": account.get("provider_type") or "imap_smtp",
            "encrypted_credentials": account.get("encrypted_credentials"),
            "status": "connected" if account.get("is_active", True) else "disconnected",
            "is_default": bool(account.get("is_default", False)),
            "is_active": bool(account.get("is_active", True)),
            "last_sync_error": account.get("last_sync_error"),
            "created_at": account.get("created_at") or datetime.now(timezone.utc).isoformat(),
        })
        existing.add(email)


def get_google_client_id() -> str:
    return str(os.environ.get("GMAIL_OAUTH_CLIENT_ID") or "").strip()


def get_google_client_secret() -> str:
    return str(os.environ.get("GMAIL_OAUTH_CLIENT_SECRET") or "").strip()


def _oauth_state_secret() -> bytes:
    value = (os.environ.get("GMAIL_OAUTH_STATE_SECRET") or "").strip()
    if not value:
        raise EmailInboxError("Hệ thống chưa cấu hình GMAIL_OAUTH_STATE_SECRET.")
    return value.encode("utf-8")


def _normalized_origin(origin: str) -> str:
    parsed = urllib.parse.urlparse((origin or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
        raise PermissionError("OAuth origin không hợp lệ.")
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def validate_google_oauth_origin(origin: str) -> str:
    normalized = _normalized_origin(origin)
    configured = {
        _normalized_origin(item)
        for item in (os.environ.get("GMAIL_OAUTH_ALLOWED_ORIGINS") or "").split(",")
        if item.strip()
    }
    if not configured:
        raise EmailInboxError("Hệ thống chưa cấu hình GMAIL_OAUTH_ALLOWED_ORIGINS.")
    if normalized not in configured:
        raise PermissionError("OAuth origin không thuộc danh sách Dev được phép.")
    return normalized


def create_google_oauth_state(origin: str, user_key: str) -> str:
    normalized = validate_google_oauth_origin(origin)
    payload = {
        "instance": _workspace(),
        "origin": normalized,
        "user": str(user_key),
        "nonce": secrets.token_urlsafe(24),
        "issued_at": int(time.time()),
    }
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    ).rstrip(b"=")
    signature = hmac.new(_oauth_state_secret(), body, hashlib.sha256).digest()
    state = f"{body.decode('ascii')}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode('ascii')}"
    _run(lambda: _db().table("omnichannel_email_oauth_states").insert({
        "instance": _workspace(),
        "user_key": str(user_key),
        "state_hash": hashlib.sha256(state.encode("utf-8")).hexdigest(),
        "origin": normalized,
        "expires_at": datetime.fromtimestamp(payload["issued_at"] + 600, timezone.utc).isoformat(),
    }).execute())
    return state


def validate_google_oauth_state(state: str, origin: str, user_key: str) -> str:
    try:
        body_text, signature_text = (state or "").split(".", 1)
        body = body_text.encode("ascii")
        signature = base64.urlsafe_b64decode(signature_text + "=" * (-len(signature_text) % 4))
        expected = hmac.new(_oauth_state_secret(), body, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        decoded = base64.urlsafe_b64decode(body_text + "=" * (-len(body_text) % 4))
        payload = json.loads(decoded.decode("utf-8"))
    except Exception as exc:
        raise PermissionError("OAuth state không hợp lệ.") from exc

    normalized = validate_google_oauth_origin(origin)
    if payload.get("instance") != _workspace() or payload.get("origin") != normalized:
        raise PermissionError("OAuth state không khớp workspace hoặc origin.")
    if not hmac.compare_digest(str(payload.get("user") or ""), str(user_key)):
        raise PermissionError("OAuth state không khớp người dùng hiện tại.")
    issued_at = int(payload.get("issued_at") or 0)
    if issued_at <= 0 or abs(int(time.time()) - issued_at) > 600:
        raise PermissionError("OAuth state đã hết hạn.")
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    stored = _run(lambda: _db().table("omnichannel_email_oauth_states").select("state_hash")
        .eq("instance", _workspace()).eq("user_key", str(user_key))
        .eq("state_hash", state_hash).eq("origin", normalized).is_("used_at", "null")
        .gt("expires_at", datetime.now(timezone.utc).isoformat()).limit(1).execute())
    if not stored.data:
        raise PermissionError("OAuth state không tồn tại, đã dùng hoặc đã hết hạn.")
    consumed = _run(lambda: _db().table("omnichannel_email_oauth_states").update({
        "used_at": datetime.now(timezone.utc).isoformat(),
    }).eq("instance", _workspace()).eq("state_hash", state_hash).is_("used_at", "null").execute())
    if not consumed.data:
        raise PermissionError("OAuth state đã được sử dụng.")
    return normalized


def get_google_auth_url(redirect_uri: str, state: Optional[str] = None) -> tuple[str, str]:
    client_id = get_google_client_id()
    if not client_id:
        raise EmailInboxError("Hệ thống chưa cấu hình GMAIL_OAUTH_CLIENT_ID.")
    redirect_uri = validate_google_oauth_origin(redirect_uri)
    scopes = [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/gmail.modify",
    ]
    st = state or f"{_workspace()}:{int(time.time())}"
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(scopes),
        "access_type": "offline",
        # Always show Google's account chooser so users can connect multiple
        # Gmail / Workspace mailboxes instead of silently reusing the last one.
        "prompt": "select_account consent",
        "state": st,
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return url, client_id


def exchange_google_oauth_code(
    code: str,
    redirect_uri: str,
    state: str,
    user_key: str,
) -> EmailAccountResponse:
    redirect_uri = validate_google_oauth_state(state, redirect_uri, user_key)
    client_id = get_google_client_id()
    client_secret = get_google_client_secret()
    if not client_id or not client_secret:
        raise EmailInboxError("Hệ thống chưa cấu hình GMAIL_OAUTH_CLIENT_ID hoặc GMAIL_OAUTH_CLIENT_SECRET.")

    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    try:
        resp = httpx.post(token_url, data=data, timeout=25.0)
    except Exception as exc:
        raise EmailInboxError(f"Không thể kết nối máy chủ Google OAuth: {exc}") from exc

    if resp.status_code != 200:
        err_msg = resp.text
        try:
            parsed = resp.json()
            err_msg = parsed.get("error_description") or parsed.get("error") or resp.text
        except Exception:
            pass
        raise EmailInboxError(f"Google OAuth thất bại: {err_msg}")

    tokens = resp.json()
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    expires_in = int(tokens.get("expires_in") or 3600)
    expires_at = int(time.time()) + expires_in

    try:
        user_resp = httpx.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15.0,
        )
    except Exception as exc:
        raise EmailInboxError("Không thể lấy thông tin người dùng Google.") from exc

    if user_resp.status_code != 200:
        raise EmailInboxError(f"Google UserInfo lỗi: {user_resp.text}")

    user_info = user_resp.json()
    account_email = (user_info.get("email") or "").strip().lower()
    if not account_email or "@" not in account_email:
        raise EmailInboxError("Tài khoản Google không trả về email hợp lệ.")
    account_name = user_info.get("name") or user_info.get("given_name") or account_email

    ws = _workspace()
    existing_row = _account_row_by_email(account_email)
    existing_creds = _decrypt_credentials((existing_row or {}).get("encrypted_credentials") or "")
    if not refresh_token:
        refresh_token = existing_creds.get("refresh_token")

    cred_dict = {
        "provider": "google_oauth",
        "email": account_email,
        "name": account_name,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "scope": tokens.get("scope", ""),
        "token_type": tokens.get("token_type", "Bearer"),
    }
    encrypted = _encrypt_credentials(cred_dict)

    account_row = _upsert_account_record({
        "account_email": account_email,
        "account_name": account_name,
        "provider_type": "google_oauth",
        "encrypted_credentials": encrypted,
        "status": "connected",
        "is_active": True,
        "is_default": bool((existing_row or {}).get("is_default", False)),
    })
    acc_id = str(account_row["id"])

    now = datetime.now(timezone.utc).isoformat()
    try:
        _run(lambda: _db().table("omnichannel_email_sync_state").upsert({
            "instance": ws, "account_email": account_email, "mailbox": "INBOX",
            "last_synced_at": now, "last_error": None, "updated_at": now,
        }, on_conflict="instance,account_email,mailbox").execute())
    except Exception:
        pass

    threading.Thread(target=sync_mailbox, kwargs={"account_email": account_email}, daemon=True).start()

    return EmailAccountResponse(
        id=acc_id,
        name=f"{account_name} · {account_email}",
        email=account_email,
        channel="email",
        provider_type="google_oauth",
        status="online",
        unread_count=0,
        workspace=ws,
        last_synced_at=now,
        last_sync_error=None,
        total_threads=0,
        is_default=bool(account_row.get("is_default", False)),
        is_active=True,
        reconnect_required=False,
    )


def refresh_google_oauth_token_if_needed(account_info: dict) -> str:
    creds = _decrypt_credentials(account_info.get("encrypted_credentials", ""))
    access_token = creds.get("access_token")
    expires_at = int(creds.get("expires_at") or 0)
    if access_token and time.time() < (expires_at - 120):
        return access_token

    refresh_token = creds.get("refresh_token")
    acc_id = account_info.get("id") or _account_id(account_info.get("email", ""))
    ws = _workspace()

    if not refresh_token:
        _set_account_status(acc_id, "expired", "Hết phiên đăng nhập Google. Vui lòng kết nối lại.")
        raise EmailInboxError("Phiên đăng nhập Google đã hết hạn. Vui lòng bấm Kết nối lại.")

    client_id = get_google_client_id()
    client_secret = get_google_client_secret()

    try:
        resp = httpx.post("https://oauth2.googleapis.com/token", data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }, timeout=15.0)
    except Exception as exc:
        raise EmailInboxError("Không thể kết nối làm mới token Google.") from exc

    if resp.status_code != 200:
        _set_account_status(acc_id, "expired", "Quyền truy cập Google đã bị thu hồi hoặc hết hạn.")
        raise EmailInboxError("Quyền truy cập Google đã bị thu hồi hoặc hết hạn. Vui lòng bấm Kết nối lại.")

    data = resp.json()
    new_access_token = data.get("access_token")
    creds["access_token"] = new_access_token
    creds["expires_at"] = int(time.time()) + int(data.get("expires_in") or 3600)
    if data.get("refresh_token"):
        creds["refresh_token"] = data["refresh_token"]

    _run(lambda: _db().table("omnichannel_email_accounts").update({
        "encrypted_credentials": _encrypt_credentials(creds),
        "status": "connected",
        "last_sync_error": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("instance", ws).eq("id", acc_id).execute())

    return new_access_token


def _set_account_status(acc_id: str, status: str, error: Optional[str] = None) -> None:
    ws = _workspace()
    row = _account_row_by_id(acc_id)
    if not row:
        return
    db_status = {"online": "connected", "offline": "disconnected"}.get(status, status)
    now = datetime.now(timezone.utc).isoformat()
    _run(lambda: _db().table("omnichannel_email_accounts").update({
        "status": db_status, "last_sync_error": error, "updated_at": now,
    }).eq("instance", ws).eq("id", acc_id).execute())
    email = row.get("account_email")
    if email:
        try:
            _run(lambda: _db().table("omnichannel_email_sync_state").upsert({
                "instance": ws, "account_email": email, "mailbox": "INBOX",
                "last_error": error, "updated_at": now,
            }, on_conflict="instance,account_email,mailbox").execute())
        except Exception:
            pass


def connect_imap_account(payload: EmailAccountConnectImapRequest) -> EmailAccountResponse:
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise EmailInboxError("Vui lòng nhập địa chỉ email hợp lệ.")

    app_pwd = provider.normalize_app_password(payload.app_password)
    if not app_pwd:
        raise EmailInboxError("Vui lòng nhập Mật khẩu ứng dụng (App Password).")

    smtp_res = provider.test_smtp_connection(email, app_pwd, payload.smtp_host, payload.smtp_port)
    if not smtp_res.get("ok"):
        raise EmailInboxError(f"Kiểm tra SMTP thất bại: {smtp_res.get('message')}")

    imap_res = provider.test_imap_connection(email, app_pwd, payload.imap_host, payload.imap_port)
    if not imap_res.get("ok"):
        raise EmailInboxError(f"Kiểm tra IMAP thất bại: {imap_res.get('message')}")

    ws = _workspace()
    name = payload.name or email

    creds = {
        "provider": "imap_smtp",
        "email": email,
        "name": name,
        "app_password": app_pwd,
        "imap_host": payload.imap_host,
        "imap_port": payload.imap_port,
        "smtp_host": payload.smtp_host,
        "smtp_port": payload.smtp_port,
    }
    encrypted = _encrypt_credentials(creds)

    account_row = _upsert_account_record({
        "account_email": email,
        "account_name": name,
        "provider_type": "imap_smtp",
        "encrypted_credentials": encrypted,
        "imap_host": payload.imap_host,
        "imap_port": payload.imap_port,
        "smtp_host": payload.smtp_host,
        "smtp_port": payload.smtp_port,
        "status": "connected",
        "is_active": True,
        "is_default": False,
    })
    acc_id = str(account_row["id"])

    now = datetime.now(timezone.utc).isoformat()
    try:
        _run(lambda: _db().table("omnichannel_email_sync_state").upsert({
            "instance": ws, "account_email": email, "mailbox": "INBOX",
            "last_synced_at": now, "last_error": None, "updated_at": now,
        }, on_conflict="instance,account_email,mailbox").execute())
    except Exception:
        pass

    threading.Thread(target=sync_mailbox, kwargs={"account_email": email}, daemon=True).start()

    return EmailAccountResponse(
        id=acc_id,
        name=f"{name} · {email}",
        email=email,
        channel="email",
        provider_type="imap_smtp",
        status="online",
        unread_count=0,
        workspace=ws,
        last_synced_at=now,
        last_sync_error=None,
        total_threads=0,
        is_default=False,
        is_active=True,
        reconnect_required=False,
    )


def disconnect_email_account(account_id: str) -> bool:
    ws = _workspace()
    row = _account_row_by_id(account_id)
    if not row:
        return False
    _run(lambda: _db().table("omnichannel_email_accounts").update({
        "is_active": False,
        "status": "disconnected",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("instance", ws).eq("id", account_id).execute())
    return True


def _get_account_for_email(email: str) -> dict[str, Any]:
    clean_email = email.strip().lower()
    row = _account_row_by_email(clean_email)
    if row and row.get("is_active", True):
        return _account_row_to_info(row)

    try:
        active_cfg = provider.get_active_email_channel_for_sending()
        if (active_cfg.get("sender_address") or "").strip().lower() == clean_email:
            return {
                "id": _account_id(clean_email),
                "email": clean_email,
                "name": active_cfg.get("sender_name") or clean_email,
                "provider_type": "imap_smtp",
                "app_password": active_cfg.get("app_password"),
                "imap_host": active_cfg.get("imap_host") or "imap.gmail.com",
                "imap_port": active_cfg.get("imap_port") or 993,
                "smtp_host": active_cfg.get("smtp_host") or "smtp.gmail.com",
                "smtp_port": active_cfg.get("smtp_port") or 587,
                "is_default": True,
            }
    except Exception:
        pass

    try:
        cfg = provider.get_email_provider_settings()
        legacy_addr = (cfg.get("senderAddress") or "").strip().lower()
        if legacy_addr == clean_email:
            active_cfg = provider.get_active_email_channel_for_sending()
            return {
                "id": _account_id(clean_email),
                "email": clean_email,
                "name": cfg.get("senderName") or clean_email,
                "provider_type": "imap_smtp",
                "app_password": active_cfg.get("app_password"),
                "imap_host": cfg.get("imapHost") or "imap.gmail.com",
                "imap_port": cfg.get("imapPort") or 993,
                "smtp_host": cfg.get("smtpHost") or "smtp.gmail.com",
                "smtp_port": cfg.get("smtpPort") or 587,
                "is_default": True,
            }
    except Exception:
        pass

    raise EmailInboxError(f"Không tìm thấy cấu hình gửi cho tài khoản {email} trong workspace {_workspace()}.")


def _addresses(value: str | Iterable[str] | None) -> list[str]:
    raw = [value] if isinstance(value, str) else list(value or [])
    return [addr.lower() for _, addr in getaddresses(raw) if addr]


def _clean_subject(subject: str | None) -> str:
    value = (subject or "(Không có tiêu đề)").strip()
    return re.sub(r"^(?:(?:re|fw|fwd)\s*:\s*)+", "", value, flags=re.I).strip()


def _thread_key(subject: str | None, external_email: str) -> str:
    raw = f"{_clean_subject(subject).casefold()}|{external_email.casefold()}"
    return "subject:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _safe_filename(value: str | None) -> str:
    name = PurePosixPath((value or "attachment").replace("\\", "/")).name
    name = re.sub(r"[^\w.()\- ]+", "_", name, flags=re.UNICODE).strip(" .")
    return (name or "attachment")[:180]


def _format_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def _attachment_kind(content_type: str) -> str:
    if content_type == "application/pdf":
        return "pdf"
    if content_type.startswith("image/"):
        return "image"
    return "file"


def _message_bodies(msg: Message) -> tuple[str, str | None]:
    plain_parts: list[str] = []
    html_parts: list[str] = []
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        if part.get_content_disposition() == "attachment":
            continue
        content_type = part.get_content_type()
        if content_type not in {"text/plain", "text/html"}:
            continue
        try:
            value = part.get_content()
        except Exception:
            raw = part.get_payload(decode=True) or b""
            value = raw.decode(part.get_content_charset() or "utf-8", errors="replace")
        (plain_parts if content_type == "text/plain" else html_parts).append(str(value))
    text = "\n".join(x.strip() for x in plain_parts if x.strip())
    body_html = "\n".join(x for x in html_parts if x.strip()) or None
    if not text and body_html:
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(body_html))).strip()
    return text, body_html


def _message_attachments(msg: Message) -> list[tuple[str, str, bytes, str | None]]:
    result: list[tuple[str, str, bytes, str | None]] = []
    total = 0
    for part in msg.walk():
        filename = part.get_filename()
        if not filename and part.get_content_disposition() != "attachment":
            continue
        payload = part.get_payload(decode=True) or b""
        if not payload:
            continue
        total += len(payload)
        if len(payload) > MAX_ATTACHMENT_BYTES or total > MAX_MESSAGE_ATTACHMENT_BYTES:
            continue
        name = _safe_filename(filename or "attachment")
        content_type = part.get_content_type() or "application/octet-stream"
        content_id = (part.get("Content-ID") or "").strip("<>") or None
        result.append((name, content_type, payload, content_id))
    return result


def _parse_date(date_header: str | None) -> str:
    if not date_header:
        return datetime.now(timezone.utc).isoformat()
    try:
        dt = parsedate_to_datetime(date_header)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _get_or_create_thread(
    account: str,
    external_email: str,
    external_name: str,
    subject: str | None,
    references: list[str],
    received_at: str,
    provider_thread_id: str | None = None,
) -> dict[str, Any]:
    existing: dict[str, Any] | None = None
    clean = _clean_subject(subject)
    key = f"gmail:{provider_thread_id}" if provider_thread_id else _thread_key(clean, external_email)

    if provider_thread_id:
        result = _run(lambda: _db().table("omnichannel_email_threads").select("*")
            .eq("instance", _workspace()).eq("account_email", account)
            .eq("provider_thread_id", provider_thread_id).limit(1).execute())
        existing = result.data[0] if result.data else None

    if references:
        clean_refs = [r.strip().strip("<>") for r in references if r.strip()]
        for ref in clean_refs:
            ref_fmt1 = f"<{ref}>"
            ref_fmt2 = ref
            res = _run(lambda: _db().table("omnichannel_email_messages").select("thread_id")
                .eq("instance", _workspace()).eq("account_email", account)
                .in_("message_id", [ref_fmt1, ref_fmt2]).limit(1).execute())
            if res.data:
                thread_res = _run(lambda: _db().table("omnichannel_email_threads").select("*")
                    .eq("instance", _workspace()).eq("id", res.data[0]["thread_id"]).limit(1).execute())
                if thread_res.data:
                    existing = thread_res.data[0]
                    break

    if existing is None:
        res = _run(lambda: _db().table("omnichannel_email_threads").select("*")
            .eq("instance", _workspace()).eq("account_email", account)
            .eq("thread_key", key).limit(1).execute())
        existing = res.data[0] if res.data else None

    if existing is None:
        res = _run(lambda: _db().table("omnichannel_email_threads").select("*")
            .eq("instance", _workspace()).eq("account_email", account)
            .ilike("customer_email", external_email)
            .limit(10).execute())
        for row in res.data or []:
            if _clean_subject(row.get("subject")).casefold() == clean.casefold():
                existing = row
                break

    if existing:
        if provider_thread_id and not existing.get("provider_thread_id"):
            updated = _run(lambda: _db().table("omnichannel_email_threads").update({
                "provider_thread_id": provider_thread_id,
                "thread_key": f"gmail:{provider_thread_id}",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("instance", _workspace()).eq("id", existing["id"]).execute())
            if updated.data:
                existing = updated.data[0]
        return existing
    created = _run(lambda: _db().table("omnichannel_email_threads").insert({
        "instance": _workspace(), "account_email": account, "thread_key": key,
        "provider_thread_id": provider_thread_id,
        "subject": subject, "customer_email": external_email,
        "customer_name": external_name or external_email, "last_message_at": received_at,
    }).execute())
    return created.data[0]


def _store_attachment(message_db_id: str, filename: str, content_type: str,
                      data: bytes, content_id: str | None) -> str:
    attachment_id = str(uuid.uuid4())
    path = f"{_workspace()}/{message_db_id}/{attachment_id}-{_safe_filename(filename)}"
    _db().storage.from_(ATTACHMENT_BUCKET).upload(
        path, data,
        file_options={"content-type": content_type, "cache-control": "3600", "upsert": "false"},
    )
    _run(lambda: _db().table("omnichannel_email_attachments").insert({
        "id": attachment_id, "instance": _workspace(), "message_id": message_db_id,
        "file_name": _safe_filename(filename), "content_type": content_type,
        "size_bytes": len(data), "storage_path": path, "content_id": content_id,
    }).execute())
    return attachment_id


def _persist_inbound(
    account: str,
    uid: int | None,
    msg: Message,
    custom_message_id: str | None = None,
    provider_thread_id: str | None = None,
) -> bool:
    message_id = (msg.get("Message-ID") or custom_message_id or (f"<imap-{uid}@{account.split('@')[-1]}>" if uid else f"<msg-{uuid.uuid4()}@{account.split('@')[-1]}>")).strip()
    duplicate = _run(lambda: _db().table("omnichannel_email_messages").select("id")
        .eq("instance", _workspace()).eq("account_email", account)
        .eq("message_id", message_id).limit(1).execute())
    if duplicate.data:
        return False
    pairs = getaddresses([msg.get("From", "")])
    sender_name, sender_email = pairs[0] if pairs else ("", "")
    sender_email = sender_email.lower().strip()
    if not sender_email:
        sender_email = account.lower()

    to_addrs = _addresses([msg.get("To", "")])
    cc_addrs = _addresses([msg.get("Cc", "")])
    is_outbound = sender_email == account.lower()

    if is_outbound:
        external_email = to_addrs[0] if to_addrs else sender_email
        external_name = external_email
        direction = "outbound"
        msg_status = "sent"
    else:
        external_email = sender_email
        external_name = sender_name or sender_email
        direction = "inbound"
        msg_status = "received"

    subject = str(msg.get("Subject") or "(Không có tiêu đề)")
    in_reply_to = (msg.get("In-Reply-To") or "").strip() or None
    refs_header = (msg.get("References") or "").strip() or None
    refs = re.findall(r"<[^>]+>", " ".join(x for x in (refs_header, in_reply_to) if x))
    received_at = _parse_date(msg.get("Date"))

    thread = _get_or_create_thread(
        account=account, external_email=external_email,
        external_name=external_name, subject=subject,
        references=refs, received_at=received_at,
        provider_thread_id=provider_thread_id,
    )
    body_text, body_html = _message_bodies(msg)
    inserted = _run(lambda: _db().table("omnichannel_email_messages").insert({
        "instance": _workspace(), "thread_id": thread["id"], "account_email": account,
        "provider_thread_id": provider_thread_id,
        "imap_uid": uid, "message_id": message_id, "in_reply_to": in_reply_to,
        "references_header": refs_header, "direction": direction,
        "sender_name": sender_name or sender_email, "sender_email": sender_email,
        "recipient_emails": to_addrs,
        "cc_emails": cc_addrs, "subject": subject,
        "body_text": body_text, "body_html": body_html, "status": msg_status,
        "received_at": received_at,
    }).execute())
    db_message_id = inserted.data[0]["id"]
    cid_to_attachment_id: dict[str, str] = {}
    for filename, content_type, data, content_id in _message_attachments(msg):
        attachment_id = _store_attachment(db_message_id, filename, content_type, data, content_id)
        if content_id:
            cid_to_attachment_id[content_id] = attachment_id

    # Bug that (2026-10-31): anh nhung (vd logo trong email MISA) tham chieu bang
    # "cid:xxxx" trong body_html - trinh duyet KHONG hieu scheme "cid:" (chi email
    # client moi hieu), nen luon vo ra icon anh vo. Doi cid: -> URL that cua dung
    # attachment da luu o tren (chi doi duoc SAU khi co attachment_id that, nen phai
    # UPDATE lai body_html sau khi insert, khong lam duoc ngay luc insert ban dau).
    if body_html and cid_to_attachment_id:
        rewritten_html = body_html
        for cid, attachment_id in cid_to_attachment_id.items():
            attachment_url = f"/api/all-platform/email-inbox/attachments/{attachment_id}"
            rewritten_html = re.sub(
                rf"cid:{re.escape(cid)}(?=[\"'])",
                attachment_url,
                rewritten_html,
                flags=re.IGNORECASE,
            )
        if rewritten_html != body_html:
            body_html = rewritten_html
            _run(lambda: _db().table("omnichannel_email_messages").update({
                "body_html": body_html,
            }).eq("instance", _workspace()).eq("id", db_message_id).execute())

    new_unread = int(thread.get("unread_count") or 0) + (1 if direction == "inbound" else 0)
    _run(lambda: _db().table("omnichannel_email_threads").update({
        "subject": subject,
        "last_message_text": body_text[:1000], "last_message_at": received_at,
        "unread_count": new_unread,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("instance", _workspace()).eq("id", thread["id"]).execute())
    return True


def _sync_account_imap(cfg: dict, account: str, max_messages: int = 100) -> int:
    state_res = _run(lambda: _db().table("omnichannel_email_sync_state").select("*")
        .eq("instance", _workspace()).eq("account_email", account).eq("mailbox", "INBOX")
        .limit(1).execute())
    state = state_res.data[0] if state_res.data else {}
    last_uid = int(state.get("last_uid") or 0)
    conn: imaplib.IMAP4_SSL | None = None
    imported = 0
    highest_uid = last_uid
    try:
        host = cfg.get("imap_host") or "imap.gmail.com"
        port = int(cfg.get("imap_port") or 993)
        conn = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=30)
        conn.login(account, cfg["app_password"])
        status, _ = conn.select("INBOX", readonly=True)
        if status != "OK":
            raise EmailInboxError("Không mở được INBOX qua IMAP.")
        validity_data = conn.response("UIDVALIDITY")[1]
        uid_validity = int(validity_data[0]) if validity_data and validity_data[0] else None
        if state.get("uid_validity") and uid_validity and int(state["uid_validity"]) != uid_validity:
            last_uid = 0
        status, data = conn.uid("search", None, f"UID {last_uid + 1}:*")
        if status != "OK":
            raise EmailInboxError("IMAP không trả được danh sách thư mới.")
        uids = [int(x) for x in (data[0] or b"").split() if x]
        for uid in uids[-max(1, min(max_messages, 500)):]:
            status, fetched = conn.uid("fetch", str(uid), "(BODY.PEEK[])")
            if status != "OK":
                continue
            raw = next((item[1] for item in fetched if isinstance(item, tuple)), None)
            if not raw:
                continue
            imported += int(_persist_inbound(account, uid, message_from_bytes(raw, policy=policy.default)))
            highest_uid = max(highest_uid, uid)
        now = datetime.now(timezone.utc).isoformat()
        _run(lambda: _db().table("omnichannel_email_sync_state").upsert({
            "instance": _workspace(), "account_email": account, "mailbox": "INBOX",
            "uid_validity": uid_validity, "last_uid": highest_uid,
            "last_synced_at": now, "last_error": None, "updated_at": now,
        }, on_conflict="instance,account_email,mailbox").execute())
        return imported
    except Exception as exc:
        err_msg = str(exc)
        if "AUTHENTICATIONFAILED" in err_msg or "Invalid credentials" in err_msg:
            friendly_err = "Mật khẩu ứng dụng Gmail (App Password) không chính xác hoặc đã bị thu hồi."
        elif "connection refused" in err_msg.lower() or "timed out" in err_msg.lower():
            friendly_err = "Không thể kết nối máy chủ IMAP (hết thời gian chờ kết nối)."
        else:
            friendly_err = f"Lỗi đồng bộ IMAP: {err_msg[:120]}"
        try:
            _run(lambda: _db().table("omnichannel_email_sync_state").upsert({
                "instance": _workspace(), "account_email": account, "mailbox": "INBOX",
                "last_uid": highest_uid, "last_error": friendly_err,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="instance,account_email,mailbox").execute())
        except Exception:
            pass
        raise
    finally:
        if conn is not None:
            try:
                conn.logout()
            except Exception:
                pass


def _sync_single_account(acc: dict, max_messages: int = 100) -> int:
    prov = acc.get("provider_type", "imap_smtp")
    email = acc["email"].lower()
    ws = _workspace()
    imported = 0

    if prov == "google_oauth":
        access_token = refresh_google_oauth_token_if_needed(acc)
        headers = {"Authorization": f"Bearer {access_token}"}
        resp = httpx.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers=headers,
            params={"maxResults": min(max_messages, 50), "q": "label:INBOX OR label:SENT"},
            timeout=25.0,
        )
        if resp.status_code != 200:
            raise EmailInboxError(f"Gmail API lỗi khi tải danh sách thư: {resp.text[:120]}")

        items = resp.json().get("messages", [])
        for item in items:
            mid = item["id"]
            existing = _run(lambda: _db().table("omnichannel_email_messages").select("id")
                .eq("instance", ws).eq("account_email", email).eq("message_id", mid).limit(1).execute())
            if existing.data:
                continue

            raw_res = httpx.get(f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{mid}?format=raw",
                                headers=headers, timeout=20.0)
            if raw_res.status_code == 200:
                raw_payload = raw_res.json()
                raw_b64 = raw_payload.get("raw", "")
                raw_bytes = base64.urlsafe_b64decode(raw_b64)
                msg = message_from_bytes(raw_bytes, policy=policy.default)
                imported += int(_persist_inbound(
                    email,
                    None,
                    msg,
                    custom_message_id=mid,
                    provider_thread_id=raw_payload.get("threadId") or item.get("threadId"),
                ))
    else:
        if "app_password" in acc and acc["app_password"]:
            cfg = acc
        else:
            creds = _decrypt_credentials(acc.get("encrypted_credentials", ""))
            cfg = {
                "sender_address": email,
                "app_password": creds.get("app_password"),
                "imap_host": creds.get("imap_host") or "imap.gmail.com",
                "imap_port": creds.get("imap_port") or 993,
            }
        imported = _sync_account_imap(cfg, email, max_messages)

    now = datetime.now(timezone.utc).isoformat()
    _run(lambda: _db().table("omnichannel_email_sync_state").upsert({
        "instance": ws, "account_email": email, "mailbox": "INBOX",
        "last_synced_at": now, "last_error": None, "updated_at": now,
    }, on_conflict="instance,account_email,mailbox").execute())
    return imported


def _claim_sync_lease(account_email: str, owner: str) -> bool:
    result = _run(lambda: _db().rpc("claim_omnichannel_email_sync", {
        "p_instance": _workspace(),
        "p_account_email": account_email.lower(),
        "p_owner": owner,
        "p_lease_seconds": 300,
    }).execute())
    return result.data is True or result.data == [True]


def _release_sync_lease(account_email: str, owner: str) -> None:
    try:
        _run(lambda: _db().rpc("release_omnichannel_email_sync", {
            "p_instance": _workspace(),
            "p_account_email": account_email.lower(),
            "p_owner": owner,
        }).execute())
    except Exception as exc:
        logger.warning("Failed to release email sync lease for {}: {}", account_email, exc)


def sync_mailbox(account_email: Optional[str] = None, max_messages: int = 100) -> dict[str, Any]:
    accounts = list_email_accounts()
    if not accounts:
        return {"ok": True, "imported": 0, "message": "Chưa có tài khoản email nào được cấu hình."}

    target_accounts = [a for a in accounts if a.email.lower() == account_email.lower()] if account_email else accounts
    total_imported = 0
    errors = []
    skipped_locked = 0

    for acc_resp in target_accounts:
        lease_owner = f"{os.getpid()}:{uuid.uuid4()}"
        try:
            if not _claim_sync_lease(acc_resp.email, lease_owner):
                skipped_locked += 1
                continue
            acc_info = _get_account_for_email(acc_resp.email)
            imported = _sync_single_account(acc_info, max_messages)
            total_imported += imported
        except Exception as exc:
            err_msg = str(exc)
            logger.warning(f"Sync failed for account {acc_resp.email}: {err_msg}")
            errors.append(f"{acc_resp.email}: {err_msg[:80]}")
            _set_account_status(acc_resp.id, "error", err_msg[:120])
        finally:
            _release_sync_lease(acc_resp.email, lease_owner)

    if errors and total_imported == 0:
        return {"ok": False, "imported": 0, "error": "; ".join(errors)}
    return {"ok": True, "imported": total_imported, "skipped_locked": skipped_locked}


def list_email_accounts() -> list[EmailAccountResponse]:
    ws = _workspace()
    results: list[EmailAccountResponse] = []
    seen_emails = set()

    _import_legacy_vault_once()
    for row in _account_rows(active_only=True):
        acc = _account_row_to_info(row)
        acc_id = acc["id"]
        email = acc["email"].lower()
        seen_emails.add(email)

        rows = _run(lambda: _db().table("omnichannel_email_threads").select("unread_count")
            .eq("instance", ws).eq("account_email", email).execute())
        unread = sum(int(r.get("unread_count") or 0) for r in (rows.data or []))
        total_threads = len(rows.data or [])

        state_res = _run(lambda: _db().table("omnichannel_email_sync_state").select("last_synced_at,last_error")
            .eq("instance", ws).eq("account_email", email).eq("mailbox", "INBOX").limit(1).execute())
        state = state_res.data[0] if state_res.data else {}
        last_synced = state.get("last_synced_at")
        last_err = state.get("last_error") or acc.get("last_sync_error")

        raw_status = acc.get("status") or "connected"
        status = {"connected": "online", "disconnected": "offline"}.get(raw_status, raw_status)
        if last_err and status != "expired":
            status = "error"

        results.append(EmailAccountResponse(
            id=acc_id,
            name=f"{acc.get('name') or email} · {email}",
            email=email,
            channel="email",
            provider_type=acc.get("provider_type", "google_oauth"),
            status=status,
            unread_count=unread,
            workspace=ws,
            last_synced_at=last_synced,
            last_sync_error=last_err,
            total_threads=total_threads,
            is_default=bool(acc.get("is_default", False)),
            is_active=True,
            reconnect_required=(status == "expired"),
        ))

    cfg = provider.get_email_provider_settings()
    legacy_addr = (cfg.get("senderAddress") or "").strip().lower()
    if legacy_addr and legacy_addr not in seen_emails:
        seen_emails.add(legacy_addr)
        rows = _run(lambda: _db().table("omnichannel_email_threads").select("unread_count")
            .eq("instance", ws).eq("account_email", legacy_addr).execute())
        unread = sum(int(r.get("unread_count") or 0) for r in (rows.data or []))
        total_threads = len(rows.data or [])

        state_res = _run(lambda: _db().table("omnichannel_email_sync_state").select("last_synced_at,last_error")
            .eq("instance", ws).eq("account_email", legacy_addr).eq("mailbox", "INBOX").limit(1).execute())
        state = state_res.data[0] if state_res.data else {}
        last_synced = state.get("last_synced_at")
        last_err = state.get("last_error")

        online = bool(cfg.get("isEnabled") and cfg.get("imapConnectionStatus") == "ok"
                      and cfg.get("smtpConnectionStatus") == "ok")
        status = "error" if last_err else ("online" if online else "offline")
        sender_display = cfg.get("senderName") or ws

        results.insert(0, EmailAccountResponse(
            id=_account_id(legacy_addr),
            name=f"{sender_display} · {legacy_addr}",
            email=legacy_addr,
            channel="email",
            provider_type="imap_smtp",
            status=status,
            unread_count=unread,
            workspace=ws,
            last_synced_at=last_synced,
            last_sync_error=last_err,
            total_threads=total_threads,
            is_default=True,
            is_active=True,
            reconnect_required=False,
        ))

    return results


def _crm_enrichment(customer_email: str) -> dict[str, Any]:
    base: dict[str, Any] = {"is_crm_matched": False, "crm_data": {"matched": False, "email": customer_email}, "opportunity": None, "quote": None, "contracts": []}
    try:
        customers = _run(lambda: _db().table("crm_customers")
            .select("id,customer_name,company_name,phone,address,email")
            .eq("instance", _workspace()).ilike("email", customer_email).limit(1).execute())
        if customers.data:
            customer = customers.data[0]
            base["is_crm_matched"] = True
            base["crm_data"] = {"matched": True, "customerId": customer["id"],
                "name": customer.get("company_name") or customer.get("customer_name"),
                "companyName": customer.get("company_name"), "phone": customer.get("phone"),
                "email": customer.get("email"), "address": customer.get("address"),
                "statusLabel": "Khách hàng CRM"}
            contracts = _run(lambda: _db().table("contracts")
                .select("id,contract_number,title,status,contract_value,signed_at,start_date")
                .eq("instance", _workspace()).eq("customer_id", customer["id"]).limit(10).execute())
            base["contracts"] = [{"id": str(x["id"]),
                "code": x.get("contract_number") or f"HĐ-{str(x['id'])[:6]}",
                "title": x.get("title") or "Hợp đồng", "status": x.get("status") or "",
                "amount": f"{int(x.get('contract_value') or 0):,} đ".replace(",", "."),
                "signed_at": x.get("signed_at"), "effective_date": x.get("start_date")}
                for x in contracts.data or []]
            return base
        deals = _run(lambda: _db().table("customer_leads")
            .select("id,customer_name,company_name,phone,email,address,deal_stage,estimated_budget")
            .eq("instance", _workspace()).ilike("email", customer_email).limit(1).execute())
        if deals.data:
            deal = deals.data[0]
            base["is_crm_matched"] = True
            base["crm_data"] = {"matched": True, "name": deal.get("company_name") or deal.get("customer_name"), "companyName": deal.get("company_name"), "phone": deal.get("phone"), "email": deal.get("email"), "address": deal.get("address"), "statusLabel": "Cơ hội CRM"}
            base["opportunity"] = {"id": str(deal["id"]), "code": f"OPP-{str(deal['id'])[:6].upper()}", "name": deal.get("customer_name") or "Cơ hội bán hàng", "amount": f"{int(deal.get('estimated_budget') or 0):,} đ".replace(",", "."), "stage": deal.get("deal_stage") or "Đang trao đổi", "winRate": "", "ownerName": "", "updatedAt": ""}
    except Exception as exc:
        logger.warning("Email CRM enrichment failed for workspace {}: {}", _workspace(), type(exc).__name__)
    return base


def list_email_conversations(
    filter_tab: str = "all",
    search: str | None = None,
    account_email: str | None = None,
) -> list[EmailConversationResponse]:
    query = _db().table("omnichannel_email_threads").select("*").eq("instance", _workspace())
    if account_email and account_email.strip():
        query = query.ilike("account_email", account_email.strip().lower())
    query = query.order("last_message_at", desc=True).limit(200)

    if filter_tab == "unread":
        query = query.gt("unread_count", 0)
    rows = _run(query.execute).data or []
    output: list[EmailConversationResponse] = []
    for row in rows:
        haystack = " ".join(str(row.get(k) or "") for k in ("customer_name", "customer_email", "subject", "last_message_text"))
        if search and search.casefold() not in haystack.casefold():
            continue
        enrichment = _crm_enrichment(row["customer_email"])
        if filter_tab == "crm" and not enrichment["is_crm_matched"]:
            continue
        output.append(EmailConversationResponse(
            id=str(row["id"]), account_id=_account_id(row["account_email"]),
            account_label=row["account_email"], customer_name=row.get("customer_name") or row["customer_email"],
            customer_avatar="", customer_email=row["customer_email"], subject=row.get("subject"),
            unread_count=int(row.get("unread_count") or 0), last_message_text=row.get("last_message_text") or "",
            last_message_time=str(row.get("last_message_at") or ""), tags=[],
            is_crm_matched=enrichment["is_crm_matched"], crm_data=enrichment["crm_data"],
            opportunity=enrichment["opportunity"], quote=enrichment["quote"],
            contracts=[CrmContractItem(**x) for x in enrichment["contracts"]], messages=[]))
    return output


def _attachments_for_message(message_id: str) -> list[EmailAttachment]:
    rows = _run(lambda: _db().table("omnichannel_email_attachments").select("*")
        .eq("instance", _workspace()).eq("message_id", message_id).execute()).data or []
    return [EmailAttachment(id=str(x["id"]), name=x["file_name"],
        size=_format_size(int(x.get("size_bytes") or 0)), size_bytes=int(x.get("size_bytes") or 0),
        content_type=x.get("content_type"), type=_attachment_kind(x.get("content_type") or ""),
        url=f"/api/all-platform/email-inbox/attachments/{x['id']}") for x in rows]


def get_email_messages(conversation_id: str) -> list[EmailMessageResponse]:
    thread = _run(lambda: _db().table("omnichannel_email_threads").select("id")
        .eq("instance", _workspace()).eq("id", conversation_id).limit(1).execute())
    if not thread.data:
        raise KeyError(conversation_id)
    rows = _run(lambda: _db().table("omnichannel_email_messages").select("*")
        .eq("instance", _workspace()).eq("thread_id", conversation_id).order("received_at").execute()).data or []
    return [EmailMessageResponse(id=str(x["id"]), conversation_id=conversation_id,
        message_id=x["message_id"], in_reply_to=x.get("in_reply_to"),
        references_header=x.get("references_header"), sender="me" if x["direction"] == "outbound" else "them",
        sender_name=x.get("sender_name"), sender_email=x["sender_email"],
        recipient_emails=x.get("recipient_emails") or [], cc_emails=x.get("cc_emails") or [],
        subject=x.get("subject"), text=x.get("body_text") or "", html=x.get("body_html"),
        time=str(x.get("received_at") or ""), status=x.get("status"),
        attachments=_attachments_for_message(str(x["id"])),
        idempotency_key=x.get("idempotency_key")) for x in rows]


def _attachment_row(attachment_id: str) -> dict[str, Any]:
    found = _run(lambda: _db().table("omnichannel_email_attachments").select("*")
        .eq("instance", _workspace()).eq("id", attachment_id).limit(1).execute())
    if not found.data:
        raise KeyError(attachment_id)
    return found.data[0]


def _outgoing_attachment(att: EmailAttachment) -> tuple[str, str, bytes] | None:
    if att.content_base64:
        try:
            data = base64.b64decode(att.content_base64, validate=True)
        except Exception as exc:
            raise EmailSendError(f"File đính kèm '{att.name}' không phải base64 hợp lệ.") from exc
        return _safe_filename(att.name), att.content_type or "application/octet-stream", data
    if att.id:
        row = _attachment_row(att.id)
        data = _db().storage.from_(ATTACHMENT_BUCKET).download(row["storage_path"])
        return row["file_name"], row["content_type"], data
    return None


def _send_smtp(cfg: dict, sender: str, recipients: list[str], mail: EmailMessage) -> None:
    port = int(cfg.get("smtp_port") or 587)
    host = cfg.get("smtp_host") or "smtp.gmail.com"
    security = (cfg.get("smtp_security") or "starttls").lower()

    try:
        if port == 465 or security == "ssl":
            cls = getattr(smtplib, "SMTP_SSL", smtplib.SMTP)
            with cls(host, port, timeout=30) as server:
                server.login(sender, cfg["app_password"])
                refused = server.send_message(mail, from_addr=sender, to_addrs=recipients)
                if refused:
                    raise EmailSendError(f"SMTP từ chối {len(refused)} người nhận.")
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                server.ehlo()
                if security == "starttls" or port == 587:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                server.login(sender, cfg["app_password"])
                refused = server.send_message(mail, from_addr=sender, to_addrs=recipients)
                if refused:
                    raise EmailSendError(f"SMTP từ chối {len(refused)} người nhận.")
    except EmailSendError:
        raise
    except Exception as exc:
        logger.error("SMTP send failed for workspace {}: {}", _workspace(), type(exc).__name__)
        raise EmailSendError("Gửi email thất bại. Vui lòng kiểm tra SMTP và thử lại.") from exc


def _send_gmail_api(
    access_token: str,
    mail: EmailMessage,
    provider_thread_id: str | None = None,
) -> tuple[str, str | None]:
    raw_bytes = mail.as_bytes()
    encoded = base64.urlsafe_b64encode(raw_bytes).decode("ascii")
    try:
        resp = httpx.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json={"raw": encoded, **({"threadId": provider_thread_id} if provider_thread_id else {})},
            timeout=30.0,
        )
    except Exception as exc:
        raise EmailSendError(f"Không thể kết nối Gmail API gửi thư: {exc}") from exc

    if resp.status_code not in (200, 201):
        err = resp.text
        try:
            err = resp.json().get("error", {}).get("message") or resp.text
        except Exception:
            pass
        raise EmailSendError(f"Gmail API gửi thư thất bại: {err}")
    payload = resp.json()
    return payload.get("id") or f"gmail-{uuid.uuid4()}", payload.get("threadId")


def _dispatch_send(
    account_info: dict,
    sender: str,
    recipients: list[str],
    mail: EmailMessage,
    provider_thread_id: str | None = None,
) -> tuple[str, str | None]:
    prov = account_info.get("provider_type", "imap_smtp")
    if prov == "google_oauth":
        access_token = refresh_google_oauth_token_if_needed(account_info)
        return _send_gmail_api(access_token, mail, provider_thread_id)
    else:
        if "app_password" in account_info and account_info["app_password"]:
            cfg = account_info
        else:
            creds = _decrypt_credentials(account_info.get("encrypted_credentials", ""))
            cfg = {
                "sender_address": sender,
                "sender_name": account_info.get("name"),
                "app_password": creds.get("app_password"),
                "smtp_host": creds.get("smtp_host") or "smtp.gmail.com",
                "smtp_port": creds.get("smtp_port") or 587,
                "smtp_security": "starttls",
            }
        _send_smtp(cfg, sender, recipients, mail)
        return f"smtp-{uuid.uuid4()}", None


def send_email_reply(conversation_id: str, payload: EmailSendRequest) -> EmailMessageResponse:
    # 1. Idempotency Check
    if payload.idempotency_key:
        existing_msg = _run(lambda: _db().table("omnichannel_email_messages").select("id")
            .eq("instance", _workspace()).eq("idempotency_key", payload.idempotency_key).limit(1).execute())
        if existing_msg.data:
            logger.info("Idempotency hit for reply: {}", payload.idempotency_key)
            messages = get_email_messages(conversation_id)
            target = next((m for m in messages if m.id == existing_msg.data[0]["id"]), None)
            return target or messages[-1]

    thread_res = _run(lambda: _db().table("omnichannel_email_threads").select("*")
        .eq("instance", _workspace()).eq("id", conversation_id).limit(1).execute())
    if not thread_res.data:
        raise KeyError(conversation_id)
    thread = thread_res.data[0]
    sender = str(thread["account_email"]).lower()

    account_info = _get_account_for_email(sender)

    target_msg = None
    if payload.reply_to_message_id:
        target_res = _run(lambda: _db().table("omnichannel_email_messages").select("*")
            .eq("instance", _workspace()).eq("thread_id", conversation_id)
            .eq("id", payload.reply_to_message_id).limit(1).execute())
        if target_res.data:
            target_msg = target_res.data[0]

    if not target_msg:
        previous = _run(lambda: _db().table("omnichannel_email_messages").select("*")
            .eq("instance", _workspace()).eq("thread_id", conversation_id)
            .order("received_at", desc=True).limit(1).execute())
        target_msg = previous.data[0] if previous.data else {}

    mode = (payload.mode or "reply").lower()
    orig_subject = target_msg.get("subject") or thread.get("subject") or ""
    clean_sub = _clean_subject(orig_subject)

    if mode == "reply_all":
        target_sender = (target_msg.get("sender_email") or "").lower()
        if target_msg.get("direction") == "inbound" and target_sender:
            recipient = (payload.recipient_email or target_sender).strip().lower()
        else:
            recips = target_msg.get("recipient_emails") or []
            recipient = (payload.recipient_email or (recips[0] if recips else thread["customer_email"])).strip().lower()

        all_recips = set()
        for r in (target_msg.get("recipient_emails") or []):
            all_recips.add(r.lower().strip())
        for c in (target_msg.get("cc_emails") or []):
            all_recips.add(c.lower().strip())
        if target_sender and target_sender != sender and target_sender != recipient:
            all_recips.add(target_sender)
        for c in (payload.cc_emails or []):
            if c:
                all_recips.add(c.lower().strip())
        all_recips.discard(sender)
        all_recips.discard(recipient)
        cc_list = sorted(list(all_recips))
        subject = payload.subject or (f"Re: {clean_sub}" if clean_sub else "Re: Không có tiêu đề")
        if not re.match(r"^re\s*:", subject, re.I):
            subject = f"Re: {subject}"
        in_reply_to = target_msg.get("message_id")
        parent_refs = target_msg.get("references_header") or ""
        refs = " ".join(x for x in (parent_refs, in_reply_to) if x)

    elif mode == "forward":
        recipient = (payload.recipient_email or "").strip().lower()
        if not recipient:
            raise EmailSendError("Vui lòng nhập địa chỉ email người nhận để chuyển tiếp thư.")
        cc_list = [addr.lower() for addr in (payload.cc_emails or []) if addr]
        subject = payload.subject or (f"Fwd: {clean_sub}" if clean_sub else "Fwd: Không có tiêu đề")
        if not re.match(r"^(?:fwd|fw)\s*:", subject, re.I):
            subject = f"Fwd: {subject}"
        in_reply_to = target_msg.get("message_id")
        parent_refs = target_msg.get("references_header") or ""
        refs = " ".join(x for x in (parent_refs, in_reply_to) if x)

    else:
        target_sender = (target_msg.get("sender_email") or "").lower()
        if target_msg.get("direction") == "inbound" and target_sender:
            recipient = (payload.recipient_email or target_sender).strip().lower()
        else:
            recips = target_msg.get("recipient_emails") or []
            recipient = (payload.recipient_email or (recips[0] if recips else thread["customer_email"])).strip().lower()

        cc_list = [addr.lower() for addr in (payload.cc_emails or []) if addr]
        subject = payload.subject or (f"Re: {clean_sub}" if clean_sub else "Re: Không có tiêu đề")
        if not re.match(r"^re\s*:", subject, re.I):
            subject = f"Re: {subject}"
        in_reply_to = target_msg.get("message_id")
        parent_refs = target_msg.get("references_header") or ""
        refs = " ".join(x for x in (parent_refs, in_reply_to) if x)

    message_id = f"<{uuid.uuid4()}@{sender.split('@')[-1]}>"
    mail = EmailMessage()
    sender_name = account_info.get("name") or sender
    mail["From"] = Address(sender_name, addr_spec=sender)
    mail["To"] = recipient
    if cc_list:
        mail["Cc"] = ", ".join(cc_list)
    mail["Subject"] = subject
    mail["Message-ID"] = message_id
    if in_reply_to:
        mail["In-Reply-To"] = in_reply_to
        mail["References"] = refs
    mail.set_content(payload.text)
    if payload.html:
        mail.add_alternative(payload.html, subtype="html")

    decoded: list[tuple[str, str, bytes]] = []
    total = 0
    for attachment in payload.attachments or []:
        item = _outgoing_attachment(attachment)
        if not item:
            continue
        filename, content_type, data = item
        total += len(data)
        if len(data) > MAX_ATTACHMENT_BYTES or total > MAX_MESSAGE_ATTACHMENT_BYTES:
            raise EmailSendError("File đính kèm vượt quá giới hạn 20 MB/file hoặc 25 MB/email.")
        maintype, subtype = (content_type.split("/", 1) + ["octet-stream"])[:2]
        mail.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
        decoded.append(item)

    recipients = [recipient, *cc_list]
    provider_thread_id = thread.get("provider_thread_id")
    _, sent_provider_thread_id = _dispatch_send(account_info, sender, recipients, mail, provider_thread_id)
    provider_thread_id = sent_provider_thread_id or provider_thread_id
    if provider_thread_id and thread.get("provider_thread_id") != provider_thread_id:
        _run(lambda: _db().table("omnichannel_email_threads").update({
            "provider_thread_id": provider_thread_id,
            "thread_key": f"gmail:{provider_thread_id}",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("instance", _workspace()).eq("id", conversation_id).execute())

    sent_at = datetime.now(timezone.utc).isoformat()
    insert_row = {
        "instance": _workspace(), "thread_id": conversation_id, "account_email": sender,
        "message_id": message_id, "provider_thread_id": provider_thread_id,
        "in_reply_to": in_reply_to, "references_header": refs or None,
        "direction": "outbound", "sender_name": sender_name,
        "sender_email": sender, "recipient_emails": [recipient], "cc_emails": cc_list,
        "subject": subject, "body_text": payload.text, "body_html": payload.html,
        "status": "sent", "received_at": sent_at,
    }
    if payload.idempotency_key:
        insert_row["idempotency_key"] = payload.idempotency_key

    inserted = _run(lambda: _db().table("omnichannel_email_messages").insert(insert_row).execute())
    db_id = str(inserted.data[0]["id"])
    for filename, content_type, data in decoded:
        _store_attachment(db_id, filename, content_type, data, None)
    _run(lambda: _db().table("omnichannel_email_threads").update({
        "last_message_text": payload.text[:1000], "last_message_at": sent_at,
        "updated_at": sent_at}).eq("instance", _workspace()).eq("id", conversation_id).execute())
    return get_email_messages(conversation_id)[-1]


def compose_new_email(payload: EmailComposeRequest) -> EmailConversationResponse:
    # 1. Idempotency Check
    if payload.idempotency_key:
        existing_msg = _run(lambda: _db().table("omnichannel_email_messages").select("id,thread_id")
            .eq("instance", _workspace()).eq("idempotency_key", payload.idempotency_key).limit(1).execute())
        if existing_msg.data:
            logger.info("Idempotency hit for compose: {}", payload.idempotency_key)
            conv_list = list_email_conversations()
            cid = str(existing_msg.data[0]["thread_id"])
            target = next((c for c in conv_list if c.id == cid), None)
            if target:
                target.messages = get_email_messages(cid)
                return target

    # Resolve sender account
    accounts = list_email_accounts()
    if not accounts:
        raise EmailSendError("Chưa có tài khoản email nào được cấu hình trong workspace.")

    if payload.from_email:
        sender = payload.from_email.strip().lower()
        account_info = _get_account_for_email(sender)
    else:
        default_acc = next((a for a in accounts if a.is_default), accounts[0])
        sender = default_acc.email.lower()
        account_info = _get_account_for_email(sender)

    recipient = (payload.recipient_email or "").strip().lower()
    if not recipient or "@" not in recipient:
        raise EmailSendError("Vui lòng nhập địa chỉ email người nhận hợp lệ.")

    subject = (payload.subject or "(Không có tiêu đề)").strip()
    clean_sub = _clean_subject(subject)
    cc_list = [addr.lower() for addr in (payload.cc_emails or []) if addr]

    thread_key = _thread_key(clean_sub, recipient)
    existing = _run(lambda: _db().table("omnichannel_email_threads").select("*")
        .eq("instance", _workspace()).eq("account_email", sender)
        .eq("thread_key", thread_key).limit(1).execute())

    now = datetime.now(timezone.utc).isoformat()
    if existing.data:
        thread = existing.data[0]
    else:
        created = _run(lambda: _db().table("omnichannel_email_threads").insert({
            "instance": _workspace(), "account_email": sender, "thread_key": thread_key,
            "subject": subject, "customer_email": recipient,
            "customer_name": recipient, "last_message_at": now,
            "last_message_text": payload.text[:1000],
            "unread_count": 0,
        }).execute())
        thread = created.data[0]

    conversation_id = str(thread["id"])
    message_id = f"<{uuid.uuid4()}@{sender.split('@')[-1]}>"

    mail = EmailMessage()
    sender_name = account_info.get("name") or sender
    mail["From"] = Address(sender_name, addr_spec=sender)
    mail["To"] = recipient
    if cc_list:
        mail["Cc"] = ", ".join(cc_list)
    mail["Subject"] = subject
    mail["Message-ID"] = message_id
    mail.set_content(payload.text)
    if payload.html:
        mail.add_alternative(payload.html, subtype="html")

    decoded: list[tuple[str, str, bytes]] = []
    total = 0
    for attachment in payload.attachments or []:
        item = _outgoing_attachment(attachment)
        if not item:
            continue
        filename, content_type, data = item
        total += len(data)
        if len(data) > MAX_ATTACHMENT_BYTES or total > MAX_MESSAGE_ATTACHMENT_BYTES:
            raise EmailSendError("File đính kèm vượt quá giới hạn 20 MB/file hoặc 25 MB/email.")
        maintype, subtype = (content_type.split("/", 1) + ["octet-stream"])[:2]
        mail.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
        decoded.append(item)

    recipients = [recipient, *cc_list]
    _, provider_thread_id = _dispatch_send(account_info, sender, recipients, mail)
    if provider_thread_id:
        _run(lambda: _db().table("omnichannel_email_threads").update({
            "provider_thread_id": provider_thread_id,
            "thread_key": f"gmail:{provider_thread_id}",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("instance", _workspace()).eq("id", conversation_id).execute())

    insert_row = {
        "instance": _workspace(), "thread_id": conversation_id, "account_email": sender,
        "message_id": message_id, "provider_thread_id": provider_thread_id,
        "in_reply_to": None, "references_header": None,
        "direction": "outbound", "sender_name": sender_name,
        "sender_email": sender, "recipient_emails": [recipient], "cc_emails": cc_list,
        "subject": subject, "body_text": payload.text, "body_html": payload.html,
        "status": "sent", "received_at": now,
    }
    if payload.idempotency_key:
        insert_row["idempotency_key"] = payload.idempotency_key

    inserted = _run(lambda: _db().table("omnichannel_email_messages").insert(insert_row).execute())

    db_id = str(inserted.data[0]["id"])
    for filename, content_type, data in decoded:
        _store_attachment(db_id, filename, content_type, data, None)

    _run(lambda: _db().table("omnichannel_email_threads").update({
        "last_message_text": payload.text[:1000], "last_message_at": now,
        "updated_at": now,
    }).eq("instance", _workspace()).eq("id", conversation_id).execute())

    conv_list = list_email_conversations()
    target_conv = next((c for c in conv_list if c.id == conversation_id), None)
    if target_conv:
        target_conv.messages = get_email_messages(conversation_id)
        return target_conv
    return conv_list[0]


def mark_email_read(conversation_id: str) -> bool:
    thread = _run(lambda: _db().table("omnichannel_email_threads").select("id")
        .eq("instance", _workspace()).eq("id", conversation_id).limit(1).execute())
    if not thread.data:
        return False
    now = datetime.now(timezone.utc).isoformat()
    _run(lambda: _db().table("omnichannel_email_threads").update({"unread_count": 0, "updated_at": now})
        .eq("instance", _workspace()).eq("id", conversation_id).execute())
    _run(lambda: _db().table("omnichannel_email_messages").update({"status": "read", "read_at": now})
        .eq("instance", _workspace()).eq("thread_id", conversation_id)
        .eq("direction", "inbound").eq("status", "received").execute())
    return True


def download_attachment(attachment_id: str) -> tuple[bytes, str, str]:
    row = _attachment_row(attachment_id)
    data = _db().storage.from_(ATTACHMENT_BUCKET).download(row["storage_path"])
    return data, row["content_type"], row["file_name"]


def simulate_incoming_email(payload: EmailSimulateIncomingRequest) -> EmailConversationResponse:
    if os.getenv("EMAIL_ALLOW_SIMULATE_INCOMING", "").strip().lower() not in {"1", "true", "yes"}:
        raise PermissionError("Endpoint simulate-incoming đang bị khóa.")
    accounts = list_email_accounts()
    if not accounts:
        raise EmailInboxError("Chưa có tài khoản email nào được cấu hình.")
    target_account = accounts[0].email
    raw = EmailMessage()
    raw["From"] = f"{payload.sender_name or payload.sender_email} <{payload.sender_email}>"
    raw["To"] = target_account
    raw["Subject"] = payload.subject
    raw["Message-ID"] = f"<dev-{uuid.uuid4()}@local.test>"
    raw["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S %z")
    raw.set_content(payload.text)
    _persist_inbound(target_account, int(datetime.now().timestamp() * 1000), raw)
    return list_email_conversations()[0]
