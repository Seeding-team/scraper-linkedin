"""Configuration and Fernet token encryption helpers for WhatsApp Chat & Call."""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# linkedin_group_crawler/ root directory
BACKEND_ROOT = Path(__file__).resolve().parents[4]

VALID_PROXY_SCHEMES = frozenset({"http", "https", "socks4", "socks4a", "socks5", "socks5h"})


class WhatsAppSettings(BaseSettings):
    """Settings for WhatsApp Multi-Device Bridge and Meta Cloud Calling API."""

    storage_root: str = Field(
        default=str(BACKEND_ROOT / "storage"),
        validation_alias=AliasChoices("WHATSAPP_STORAGE_ROOT"),
    )
    supabase_storage_bucket: str = Field(
        default="whatsapp-media",
        validation_alias=AliasChoices("WHATSAPP_SUPABASE_STORAGE_BUCKET"),
    )
    meta_graph_api_base: str = Field(
        default="https://graph.facebook.com/v22.0",
        validation_alias=AliasChoices("WHATSAPP_META_GRAPH_API_BASE"),
    )
    bridge_script_path: str = Field(
        default=str(BACKEND_ROOT / "scripts" / "wa_persistent_bridge.mjs"),
        validation_alias=AliasChoices("WHATSAPP_BRIDGE_SCRIPT"),
    )
    node_binary: str = Field(
        default="node",
        validation_alias=AliasChoices("WHATSAPP_NODE_BINARY", "NODE_BINARY"),
    )
    webhook_verify_token: str = Field(
        default="",
        validation_alias=AliasChoices("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    )
    browser_name: str = Field(
        default="Markee CRM",
        validation_alias=AliasChoices("WHATSAPP_BROWSER_NAME"),
    )
    rpc_timeout_seconds: float = Field(
        default=30.0,
        validation_alias=AliasChoices("WHATSAPP_RPC_TIMEOUT_SECONDS"),
    )
    max_media_upload_bytes: int = Field(
        default=25 * 1024 * 1024,
        validation_alias=AliasChoices("WHATSAPP_MAX_MEDIA_UPLOAD_BYTES"),
    )
    default_proxy_url: str = Field(
        default="",
        validation_alias=AliasChoices("WHATSAPP_DEFAULT_PROXY_URL"),
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = WhatsAppSettings()


def get_auth_dir(account_id: str) -> Path:
    """Return persistent Baileys Multi-Device auth state directory for an account."""
    safe_id = "".join(c for c in str(account_id) if c.isalnum() or c in ("-", "_"))
    if not safe_id:
        raise ValueError("Invalid account_id for auth directory")
    path = Path(settings.storage_root) / "whatsapp_auth" / safe_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_media_dir(account_id: str) -> Path:
    """Return local downloaded/uploaded media directory for an account."""
    safe_id = "".join(c for c in str(account_id) if c.isalnum() or c in ("-", "_"))
    if not safe_id:
        raise ValueError("Invalid account_id for media directory")
    path = Path(settings.storage_root) / "whatsapp_media" / safe_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_bridge_script_path() -> Path:
    """Resolve the persistent Node.js Baileys bridge script path."""
    raw = (os.getenv("WHATSAPP_BRIDGE_SCRIPT") or settings.bridge_script_path or "").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = BACKEND_ROOT / path
    return path


def get_meta_graph_api_base() -> str:
    return (os.getenv("WHATSAPP_META_GRAPH_API_BASE") or settings.meta_graph_api_base).rstrip("/")


def get_webhook_verify_token() -> str:
    return (os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN") or settings.webhook_verify_token or "").strip()


def get_default_proxy_url() -> Optional[str]:
    """Return optional global default proxy URL from WHATSAPP_DEFAULT_PROXY_URL."""
    raw = (os.getenv("WHATSAPP_DEFAULT_PROXY_URL") or settings.default_proxy_url or "").strip()
    return raw or None


def normalize_whatsapp_phone(value: Optional[str]) -> str:
    """Normalize phone input to E.164 digits (strips +/spaces/00, maps VN 0xxxxxxxxx -> 84xxxxxxxxx)."""
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) >= 8:
        digits = f"84{digits[1:]}"
    return digits


# ── Fernet Encryption (same pattern as fb_eaa_token_crawler_service.py) ───────

def _resolve_fernet_key() -> bytes:
    """Derive a valid 32-byte urlsafe-base64 Fernet key from env secrets."""
    explicit = (os.getenv("WHATSAPP_FERNET_KEY") or "").strip()
    if explicit:
        try:
            raw = explicit.encode("utf-8")
            Fernet(raw)
            return raw
        except Exception:
            digest = hashlib.sha256(explicit.encode("utf-8")).digest()
            return base64.urlsafe_b64encode(digest)

    seed = (
        os.getenv("JWT_SECRET_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or "seeding-markee-local-dev-whatsapp-key"
    )
    digest = hashlib.sha256(f"whatsapp-cloud-v1:{seed}".encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet() -> Fernet:
    return Fernet(_resolve_fernet_key())


def encrypt_cloud_token(raw_token: str) -> str:
    tok = str(raw_token or "").strip()
    if not tok:
        raise ValueError("Cloud access token không được để trống.")
    return _fernet().encrypt(tok.encode("utf-8")).decode("utf-8")


def decrypt_cloud_token(token_encrypted: Optional[str]) -> str:
    if not token_encrypted:
        raise ValueError("Cloud access token mã hóa trống.")
    try:
        return _fernet().decrypt(token_encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError(
            "Không thể giải mã WhatsApp Cloud access token (khóa Fernet đã thay đổi hoặc dữ liệu lỗi)."
        ) from exc


def validate_proxy_url(raw_url: str) -> str:
    """Validate HTTP/HTTPS/SOCKS proxy URL syntax and return trimmed string."""
    cleaned = str(raw_url or "").strip()
    if not cleaned:
        raise ValueError("URL proxy không được để trống.")
    try:
        parsed = urlsplit(cleaned)
        port = parsed.port  # triggers ValueError on non-numeric/out-of-range port
    except ValueError as exc:
        raise ValueError(
            "URL proxy không hợp lệ (ví dụ hợp lệ: http://user:pass@1.2.3.4:8080 hoặc socks5://user:pass@1.2.3.4:1080)."
        ) from exc
    scheme = (parsed.scheme or "").lower()
    if scheme not in VALID_PROXY_SCHEMES or not parsed.hostname:
        raise ValueError(
            "URL proxy phải bắt đầu bằng http://, https://, socks4://, socks5:// hoặc socks5h:// và có địa chỉ host hợp lệ."
        )
    _ = port
    return cleaned


def encrypt_proxy_url(raw_url: str) -> str:
    cleaned = validate_proxy_url(raw_url)
    return _fernet().encrypt(cleaned.encode("utf-8")).decode("utf-8")


def decrypt_proxy_url(proxy_encrypted: Optional[str]) -> Optional[str]:
    enc = str(proxy_encrypted or "").strip()
    if not enc:
        return None
    try:
        return _fernet().decrypt(enc.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError(
            "Không thể giải mã WhatsApp proxy URL (khóa Fernet đã thay đổi hoặc dữ liệu lỗi)."
        ) from exc


def mask_proxy_url(raw_url: Optional[str]) -> Optional[str]:
    """Return safe masked proxy string (e.g. 'socks5://***@1.2.3.4:1080'), never exposing credentials."""
    cleaned = str(raw_url or "").strip()
    if not cleaned:
        return None
    try:
        parsed = urlsplit(cleaned)
        scheme = (parsed.scheme or "").lower()
        hostname = parsed.hostname
        if not scheme or not hostname:
            return None
        host_part = f"[{hostname}]" if ":" in hostname else hostname
        port_part = f":{parsed.port}" if parsed.port else ""
        has_auth = parsed.username is not None or parsed.password is not None
        if has_auth:
            return f"{scheme}://***@{host_part}{port_part}"
        return f"{scheme}://{host_part}{port_part}"
    except ValueError:
        return None


def resolve_effective_proxy_url(account_row: Optional[dict]) -> Optional[str]:
    """Return decrypted account proxy if set, otherwise WHATSAPP_DEFAULT_PROXY_URL."""
    raw_enc = str((account_row or {}).get("proxy_url_enc") or "").strip()
    if raw_enc:
        try:
            decrypted = decrypt_proxy_url(raw_enc)
            if decrypted:
                return decrypted
        except ValueError:
            return None
    default_url = get_default_proxy_url()
    if not default_url:
        return None
    try:
        return validate_proxy_url(default_url)
    except ValueError:
        return None


def sanitize_account(row: dict) -> dict:
    """Strip sensitive encrypted credentials before returning account objects to clients."""
    if not row:
        return {}
    has_token = bool((row.get("cloud_access_token_enc") or "").strip())
    raw_proxy_enc = str(row.get("proxy_url_enc") or "").strip()
    has_proxy = bool(raw_proxy_enc)
    proxy_masked: Optional[str] = None
    if has_proxy:
        try:
            proxy_masked = mask_proxy_url(decrypt_proxy_url(raw_proxy_enc))
        except ValueError:
            proxy_masked = "***"

    clean = {
        k: v
        for k, v in row.items()
        if k not in ("cloud_access_token_enc", "proxy_url_enc", "proxy_url")
    }
    clean["has_cloud_token"] = has_token
    clean["has_proxy"] = has_proxy
    clean["proxy_masked"] = proxy_masked
    return clean
