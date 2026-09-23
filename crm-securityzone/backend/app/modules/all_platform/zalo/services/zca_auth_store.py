from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

from app.modules.all_platform.zalo.config import settings
from app.modules.all_platform.zalo.schemas.session import SessionData
from app.modules.all_platform.zalo.services.session_store import save_session


_STORE_LOCKS: Dict[str, asyncio.Lock] = {}
_ZCA_AUTH_CACHE: Dict[str, Optional[Dict[str, Any]]] = {}

# ── Optional at-rest encryption ───────────────────────────────────────────────
# Bật bằng cách set env var ZCA_AUTH_ENCRYPTION_KEY=<base64-url-safe 32-byte key>.
# Tạo key: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Files đã tồn tại (plaintext) sẽ được đọc và re-encrypted lần tiếp theo ghi.
# Nếu không set key → lưu plaintext như cũ (backward compatible).
#
# PRODUCTION: set key trong .env hoặc secrets manager, KHÔNG commit vào git.

_ENCRYPTION_SENTINEL = b"\xfe\xfe\xfe\x01"  # Magic bytes đánh dấu file đã encrypt


def _get_fernet():
    """Trả về Fernet instance nếu ZCA_AUTH_ENCRYPTION_KEY được set, hoặc None."""
    key_b64 = os.environ.get("ZCA_AUTH_ENCRYPTION_KEY", "").strip()
    if not key_b64:
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(key_b64.encode() if isinstance(key_b64, str) else key_b64)
    except Exception as exc:
        logger.warning(f"ZCA_AUTH_ENCRYPTION_KEY invalid, falling back to plaintext: {exc}")
        return None


def _encrypt_auth(data: Dict[str, Any]) -> bytes:
    """Serialize + encrypt auth dict. Thêm sentinel bytes để nhận biết file đã encrypt."""
    fernet = _get_fernet()
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    if fernet is None:
        return raw
    encrypted = fernet.encrypt(raw)
    return _ENCRYPTION_SENTINEL + encrypted


def _decrypt_auth(raw_bytes: bytes) -> Dict[str, Any]:
    """Decrypt + deserialize. Tự động detect plaintext vs encrypted."""
    if raw_bytes.startswith(_ENCRYPTION_SENTINEL):
        fernet = _get_fernet()
        if fernet is None:
            raise ValueError(
                "ZCA auth file is encrypted but ZCA_AUTH_ENCRYPTION_KEY is not set. "
                "Set the key or delete the auth file to re-login."
            )
        payload = raw_bytes[len(_ENCRYPTION_SENTINEL):]
        decrypted = fernet.decrypt(payload)
        return json.loads(decrypted.decode("utf-8"))
    # Plaintext fallback (backward compat với files cũ chưa encrypt)
    return json.loads(raw_bytes.decode("utf-8"))


def _normalize_user_id(user_id: str) -> str:
    raw = (user_id or "default").strip().lower()
    raw = re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-._")
    return raw or "default"


def _store_path(user_id: str) -> Path:
    safe_user_id = _normalize_user_id(user_id)
    return Path(settings.zca_auth_store_dir).expanduser().resolve() / f"{safe_user_id}.json"


def _lock_for(user_id: str) -> asyncio.Lock:
    safe_user_id = _normalize_user_id(user_id)
    lock = _STORE_LOCKS.get(safe_user_id)
    if lock is None:
        lock = asyncio.Lock()
        _STORE_LOCKS[safe_user_id] = lock
    return lock


async def save_zca_auth(user_id: str, auth: Dict[str, Any]) -> None:
    if not isinstance(auth, dict) or not auth:
        return

    safe_user_id = _normalize_user_id(user_id)
    path = _store_path(user_id)
    encrypted = _encrypt_auth(auth)
    is_encrypted = encrypted.startswith(_ENCRYPTION_SENTINEL)
    async with _lock_for(user_id):
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_bytes(encrypted)
        try:
            os.chmod(tmp_path, 0o600)
        except Exception:
            pass
        tmp_path.replace(path)
        _ZCA_AUTH_CACHE[safe_user_id] = auth
    logger.info(f"Saved ZCA auth for user={safe_user_id} to {path} (encrypted={is_encrypted})")


async def load_zca_auth(user_id: str) -> Optional[Dict[str, Any]]:
    safe_user_id = _normalize_user_id(user_id)
    if safe_user_id in _ZCA_AUTH_CACHE:
        return _ZCA_AUTH_CACHE[safe_user_id]

    path = _store_path(user_id)
    async with _lock_for(user_id):
        if safe_user_id in _ZCA_AUTH_CACHE:
            return _ZCA_AUTH_CACHE[safe_user_id]
        if not path.exists():
            _ZCA_AUTH_CACHE[safe_user_id] = None
            return None
        try:
            raw_bytes = path.read_bytes()
            data = _decrypt_auth(raw_bytes)
        except Exception as exc:
            logger.warning(f"Could not read ZCA auth for user={safe_user_id}: {exc}")
            _ZCA_AUTH_CACHE[safe_user_id] = None
            return None
        if not isinstance(data, dict) or not data:
            _ZCA_AUTH_CACHE[safe_user_id] = None
            return None
        _ZCA_AUTH_CACHE[safe_user_id] = data
        return data


async def list_zca_auth_users() -> List[str]:
    root = Path(settings.zca_auth_store_dir).expanduser().resolve()
    if not root.exists():
        return []

    users: List[str] = []
    for path in sorted(root.glob("*.json")):
        user_id = _normalize_user_id(path.stem)
        if user_id and user_id not in users:
            users.append(user_id)
    return users


async def delete_zca_auth(user_id: str) -> bool:
    safe_user_id = _normalize_user_id(user_id)
    path = _store_path(user_id)
    async with _lock_for(user_id):
        _ZCA_AUTH_CACHE[safe_user_id] = None
        if not path.exists():
            return False
        try:
            path.unlink()
            logger.info(f"Deleted ZCA auth for user={safe_user_id}")
            return True
        except FileNotFoundError:
            return False
        except Exception as exc:
            logger.warning(f"Could not delete ZCA auth for user={safe_user_id}: {exc}")
            return False


async def ensure_session_zca_auth(session: SessionData) -> Optional[Dict[str, Any]]:
    if session.zca_auth:
        return session.zca_auth

    # If the session is actively waiting for scan or has expired, don't restore old credentials
    if session.status in {"waiting_scan", "qr_expired", "session_expired"}:
        return None

    auth = await load_zca_auth(session.user_id)
    if not auth:
        return None

    session.zca_auth = auth
    session.status = "confirmed"
    session.qr_base64 = None
    session.qr_signature = None
    await save_session(session)
    logger.info(f"Loaded persisted ZCA auth into session={session.session_id} user={session.user_id}")
    return auth

