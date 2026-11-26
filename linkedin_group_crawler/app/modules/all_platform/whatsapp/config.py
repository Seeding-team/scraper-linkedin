"""Configuration and Fernet token encryption helpers for WhatsApp Chat & Call."""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# linkedin_group_crawler/ root directory
BACKEND_ROOT = Path(__file__).resolve().parents[4]


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


def sanitize_account(row: dict) -> dict:
    """Strip sensitive encrypted credentials before returning account objects to clients."""
    if not row:
        return {}
    has_token = bool((row.get("cloud_access_token_enc") or "").strip())
    clean = {k: v for k, v in row.items() if k != "cloud_access_token_enc"}
    clean["has_cloud_token"] = has_token
    return clean
