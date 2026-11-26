from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from loguru import logger

from app.modules.all_platform.zalo.config import settings
from app.modules.all_platform.zalo.schemas.session import SessionData
from app.modules.all_platform.zalo.services.session_store import save_session


_STORE_LOCKS: Dict[str, asyncio.Lock] = {}
_ZCA_AUTH_CACHE: Dict[str, Optional[Dict[str, Any]]] = {}

_ALLOWED_PROXY_SCHEMES = frozenset({"http", "https", "socks4", "socks4a", "socks5", "socks5h"})
_PRIORITY_AUTH_COOKIE_KEYS = frozenset({"zpw_sek", "zpsid", "zppsid", "zpw_wsid", "zpw_sekm"})
_COOKIE_EXPIRING_SOON_SECONDS = 24 * 3600


def validate_proxy_url(proxy_url: Optional[str]) -> Optional[str]:
    """Validate and normalize an optional HTTP/HTTPS/SOCKS proxy URL.

    Returns ``None`` when empty/unset. Raises ``ValueError`` if malformed or using
    an unsupported scheme.
    """
    if proxy_url is None:
        return None
    cleaned = str(proxy_url).strip()
    if not cleaned:
        return None
    if any(ch.isspace() or ord(ch) < 32 for ch in cleaned):
        raise ValueError("Proxy URL không hợp lệ (chứa khoảng trắng hoặc ký tự điều khiển)")
    parsed = urlparse(cleaned)
    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_PROXY_SCHEMES:
        raise ValueError(
            "Proxy URL phải bắt đầu bằng http://, https://, socks4:// hoặc socks5://"
        )
    if not parsed.hostname:
        raise ValueError("Proxy URL thiếu địa chỉ máy chủ (hostname)")
    if parsed.port is not None and not (1 <= parsed.port <= 65535):
        raise ValueError("Cổng proxy không hợp lệ (1-65535)")
    return cleaned


def mask_proxy_url(proxy_url: Optional[str]) -> Optional[str]:
    """Mask proxy credentials before exposing to API/UI/logs.

    Examples:
        - ``socks5://user:pass@1.2.3.4:1080`` -> ``socks5://***@1.2.3.4:1080``
        - ``http://1.2.3.4:8080`` -> ``http://1.2.3.4:8080``
    """
    cleaned = str(proxy_url or "").strip()
    if not cleaned:
        return None
    try:
        parsed = urlparse(cleaned)
        scheme = (parsed.scheme or "").lower()
        host = parsed.hostname or ""
        if not scheme or not host:
            return "***"
        host_fmt = f"[{host}]" if ":" in host else host
        try:
            port = parsed.port
        except ValueError:
            port = None
        port_part = f":{port}" if port else ""
        if parsed.username is not None or parsed.password is not None:
            return f"{scheme}://***@{host_fmt}{port_part}"
        return f"{scheme}://{host_fmt}{port_part}"
    except Exception:
        return "***"


def get_effective_proxy_url(auth: Optional[Dict[str, Any]]) -> Optional[str]:
    """Return raw proxy URL for subprocess env (per-account first, then optional default env)."""
    if isinstance(auth, dict):
        raw = str(auth.get("proxy_url") or "").strip()
        if raw:
            return raw
    env_default = str(os.environ.get("ZALO_DEFAULT_PROXY_URL") or "").strip()
    return env_default or None


def _parse_cookie_expiry_dt(raw_value: Any) -> Optional[datetime]:
    if raw_value is None or raw_value == "" or isinstance(raw_value, bool):
        return None
    if isinstance(raw_value, (int, float)):
        ts = float(raw_value)
        if ts <= 0:
            return None
        if ts >= 1_000_000_000_000:
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    text = str(raw_value).strip()
    if not text or text.lower() in {"infinity", "session", "none", "null"}:
        return None
    try:
        num = float(text)
        return _parse_cookie_expiry_dt(num)
    except ValueError:
        pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _iter_cookie_dicts(auth: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(auth, dict):
        return []
    cookies = auth.get("cookies")
    if isinstance(cookies, str):
        stripped = cookies.strip()
        if stripped.startswith(("[", "{")):
            try:
                cookies = json.loads(stripped)
            except Exception:
                return []
        else:
            return []
    if isinstance(cookies, dict) and isinstance(cookies.get("cookies"), list):
        cookies = cookies["cookies"]
    if not isinstance(cookies, list):
        return []
    return [c for c in cookies if isinstance(c, dict)]


def extract_cookie_expiry(
    auth: Optional[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
) -> Tuple[Optional[str], bool]:
    """Extract earliest session-cookie expiry ISO timestamp and `< 24h` warning flag."""
    cookies = _iter_cookie_dicts(auth)
    if not cookies:
        return None, False

    priority_dts: List[datetime] = []
    all_dts: List[datetime] = []
    for cookie in cookies:
        name = str(cookie.get("key") or cookie.get("name") or "").strip().lower()
        dt = _parse_cookie_expiry_dt(cookie.get("expires")) or _parse_cookie_expiry_dt(
            cookie.get("expirationDate")
        )
        if dt is None:
            continue
        all_dts.append(dt)
        if name in _PRIORITY_AUTH_COOKIE_KEYS:
            priority_dts.append(dt)

    candidates = priority_dts or all_dts
    if not candidates:
        return None, False

    earliest = min(candidates)
    ref_now = now or datetime.now(timezone.utc)
    if ref_now.tzinfo is None:
        ref_now = ref_now.replace(tzinfo=timezone.utc)
    remaining_s = (earliest - ref_now).total_seconds()
    iso_str = earliest.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return iso_str, remaining_s < _COOKIE_EXPIRING_SOON_SECONDS


def inspect_zca_auth_health(
    auth: Optional[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Return safe, redacted session health & proxy metadata for status endpoints."""
    cookie_expires_at, cookie_expiring_soon = extract_cookie_expiry(auth, now=now)
    effective_proxy = get_effective_proxy_url(auth)
    return {
        "cookie_expires_at": cookie_expires_at,
        "cookie_expiring_soon": cookie_expiring_soon,
        "has_proxy": bool(effective_proxy),
        "proxy_masked": mask_proxy_url(effective_proxy),
    }


def get_cached_zca_auth(user_id: str) -> Optional[Dict[str, Any]]:
    """Synchronous best-effort lookup of cached auth dict (never performs disk I/O)."""
    safe_user_id = _normalize_user_id(user_id)
    return _ZCA_AUTH_CACHE.get(safe_user_id)

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
    stored_auth = dict(auth)
    path = _store_path(user_id)
    encrypted = _encrypt_auth(stored_auth)
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
        _ZCA_AUTH_CACHE[safe_user_id] = stored_auth
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

