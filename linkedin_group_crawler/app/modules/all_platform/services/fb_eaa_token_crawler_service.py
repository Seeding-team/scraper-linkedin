"""Facebook EAA Token Fast-Lane Crawler & 5-Layer Anti-Checkpoint Pool (Phase 4).

Designed specifically for Private Facebook Groups & Deep Comment extraction where
Zero-Account 4G Guest mode cannot see posts. Built with 5 mandatory checkpoint guards:

1. **Fernet Encryption at Rest + Zero Plaintext Exposure**:
   Tokens are encrypted with `cryptography.fernet.Fernet` before persisting to `fb_eaa_tokens`
   and masked (`EAAD6V7•••••9xK2`) on every API response.
2. **1 Token = 1 Sticky Proxy Binding**:
   Each token binds to a fixed residential/4G proxy URL; missing sticky proxy triggers
   an explicit red warning (`proxy_warning=True`).
3. **Hourly Quota (<= 80 req/h) + Humanized Jitter (12-28s)**:
   Enforces sliding hourly budgets per token so Graph calls never look bursty.
4. **Live `X-App-Usage` Telemetry & Proactive Cooldown**:
   Parses `X-App-Usage` JSON header after EVERY Graph response; >= 65% usage puts the
   token into 30-minute `cooldown` automatically.
5. **Instant Auto-Quarantine on Graph Errors `190` / `368`**:
   Any checkpoint/invalid-session (`190`) or temporary block (`368`) immediately quarantines
   the token, broadcasts a realtime WS alert, and rotates to the next healthy token.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import random
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.socks5_http_bridge import (
    Socks5HttpBridge,
    mask_proxy_url,
    parse_proxy_entry,
    rewrite_proxy_url_for_runtime,
)
from app.modules.all_platform.websocket import manager

logger = logging.getLogger(__name__)

TABLE_EAA_TOKENS = "fb_eaa_tokens"
GRAPH_API_VERSION = "v19.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

DEFAULT_HOURLY_QUOTA = 80
MAX_HOURLY_QUOTA = 150
APP_USAGE_COOLDOWN_THRESHOLD_PCT = 65.0
APP_USAGE_COOLDOWN_MINUTES = 30
RATE_LIMIT_COOLDOWN_MINUTES = 45

QUARANTINE_ERROR_CODES = frozenset({190, 368})
COOLDOWN_ERROR_CODES = frozenset({4, 17, 32, 613})

_GROUP_ID_FROM_URL_RE = re.compile(r"/groups/(\d{6,24})", re.IGNORECASE)
_EAA_PREFIXES = ("EAAD6V7", "EAAAAU", "EAAG", "EAAB", "EAAI", "EAAC", "EAAV", "EAA")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


# ── Layer 1: Fernet Token Encryption & Masking ────────────────────────────────

def _resolve_fernet_key() -> bytes:
    """Derive a valid 32-byte urlsafe-base64 Fernet key from env secrets."""
    explicit = (os.getenv("FB_EAA_FERNET_KEY") or "").strip()
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
        or "seeding-markee-local-dev-eaa-key"
    )
    digest = hashlib.sha256(f"fb-eaa-v1:{seed}".encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet() -> Fernet:
    return Fernet(_resolve_fernet_key())


def encrypt_eaa_token(raw_token: str) -> str:
    tok = str(raw_token or "").strip()
    if not tok:
        raise ValueError("Access token không được để trống.")
    return _fernet().encrypt(tok.encode("utf-8")).decode("utf-8")


def decrypt_eaa_token(token_encrypted: str) -> str:
    if not token_encrypted:
        raise ValueError("Token mã hóa trống.")
    try:
        return _fernet().decrypt(token_encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Không thể giải mã EAA token (khóa Fernet đã thay đổi hoặc dữ liệu lỗi).") from exc


def detect_eaa_token_type(raw_token: str) -> str:
    tok = str(raw_token or "").strip()
    for prefix in _EAA_PREFIXES:
        if tok.startswith(prefix):
            return prefix
    return "UNKNOWN"


def mask_eaa_token(raw_token: str) -> str:
    tok = str(raw_token or "").strip()
    if len(tok) <= 12:
        return "EAA••••"
    return f"{tok[:7]}•••••{tok[-4:]}"


def extract_numeric_group_id(group_id_or_url: str) -> Optional[str]:
    raw = str(group_id_or_url or "").strip()
    if not raw:
        return None
    if raw.isdigit() and len(raw) >= 6:
        return raw
    m = _GROUP_ID_FROM_URL_RE.search(raw)
    if m:
        return m.group(1)
    return None


# ── Layer 4 & 5: X-App-Usage & Graph Error Classification ─────────────────────

def parse_x_app_usage_header(header_value: Optional[str]) -> float:
    """Parse Meta `X-App-Usage` JSON header and return peak percentage (0..100)."""
    if not header_value:
        return 0.0
    try:
        data = json.loads(str(header_value))
        if not isinstance(data, dict):
            return 0.0
        vals = [
            float(data.get(k) or 0.0)
            for k in ("call_count", "total_cputime", "total_time")
        ]
        return round(max(0.0, max(vals)), 2)
    except Exception:
        return 0.0


def classify_graph_error(payload: Any, http_status: int) -> tuple[Optional[int], Optional[str], Optional[str]]:
    """Return `(error_code, error_message, action)` where action is `quarantine | cooldown | None`."""
    code: Optional[int] = None
    msg: Optional[str] = None
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        err = payload["error"]
        try:
            code = int(err.get("code")) if err.get("code") is not None else None
        except (TypeError, ValueError):
            code = None
        msg = str(err.get("message") or "").strip() or None

    if code in QUARANTINE_ERROR_CODES:
        return (code, msg or f"Graph error {code} (checkpoint/token invalid)", "quarantine")
    if code in COOLDOWN_ERROR_CODES or http_status == 429:
        return (code or 429, msg or "Graph API rate limit exceeded", "cooldown")
    if http_status >= 400:
        return (code or http_status, msg or f"Graph HTTP {http_status}", None)
    return (None, None, None)


# ── HTTP Helper supporting both HTTP & SOCKS5 Sticky Proxies ──────────────────

async def _graph_get_json(
    url: str,
    *,
    params: dict[str, Any],
    sticky_proxy_url: Optional[str] = None,
    timeout: float = 20.0,
    http_client: Any = None,
) -> tuple[int, dict[str, Any], dict[str, str]]:
    """Execute a Graph API GET over a sticky proxy (HTTP or SOCKS5 via local bridge)."""
    if http_client is not None:
        resp = await http_client.get(url, params=params)
        try:
            body = resp.json()
        except Exception:
            body = {"raw_text": (resp.text or "")[:300]}
        return resp.status_code, body if isinstance(body, dict) else {}, dict(resp.headers)

    bridge: Socks5HttpBridge | None = None
    proxy_arg: str | None = None
    try:
        if sticky_proxy_url:
            canon = parse_proxy_entry(sticky_proxy_url)
            runtime_url = rewrite_proxy_url_for_runtime(canon) or canon
            if runtime_url.lower().startswith("socks"):
                bridge = Socks5HttpBridge(runtime_url)
                proxy_arg = await bridge.start()
            else:
                proxy_arg = runtime_url

        async with httpx.AsyncClient(
            proxy=proxy_arg,
            timeout=timeout,
            follow_redirects=False,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Linux; Android 13; SM-S918B) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
                ),
                "Accept": "application/json",
            },
        ) as client:
            resp = await client.get(url, params=params)
            try:
                body = resp.json()
            except Exception:
                body = {"raw_text": (resp.text or "")[:300]}
            return resp.status_code, body if isinstance(body, dict) else {}, dict(resp.headers)
    finally:
        if bridge is not None:
            try:
                await bridge.stop()
            except Exception:
                pass


# ── Graph Feed Normalization -> ExtensionPost-compatible dicts ────────────────

def normalize_graph_feed_posts(
    graph_data: dict[str, Any],
    *,
    group_id: str,
    group_url: str,
) -> list[dict[str, Any]]:
    """Convert Graph API `/{group_id}/feed` JSON into standard post dicts matching `fb_story_parser`."""
    items = graph_data.get("data") if isinstance(graph_data, dict) else None
    if not isinstance(items, list):
        return []

    now_iso = _utc_now_iso()
    posts: list[dict[str, Any]] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        raw_id = str(raw.get("id") or "").strip()
        post_id = raw_id.split("_")[-1] if "_" in raw_id else raw_id
        permalink = str(raw.get("permalink_url") or "").strip()
        if not permalink and post_id:
            permalink = f"https://www.facebook.com/groups/{group_id}/posts/{post_id}/"
        if not permalink:
            continue

        message = str(raw.get("message") or raw.get("story") or "").strip()
        if not message:
            continue

        author_obj = raw.get("from") if isinstance(raw.get("from"), dict) else {}
        author_id = str(author_obj.get("id") or "").strip()
        author_name = str(author_obj.get("name") or "").strip()
        author_url = f"https://www.facebook.com/{author_id}" if author_id else ""

        created_time = str(raw.get("created_time") or "").strip() or now_iso
        creation_ts: Optional[float] = None
        try:
            dt = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
            creation_ts = dt.timestamp()
        except ValueError:
            creation_ts = None

        reactions = int(((raw.get("reactions") or {}).get("summary") or {}).get("total_count") or 0)
        comments = int(((raw.get("comments") or {}).get("summary") or {}).get("total_count") or 0)
        shares = int((raw.get("shares") or {}).get("count") or 0)

        images: list[str] = []
        full_pic = raw.get("full_picture")
        if isinstance(full_pic, str) and full_pic.startswith("http"):
            images.append(full_pic)

        posts.append(
            {
                "post_id": post_id,
                "post_url": permalink,
                "author_name": author_name,
                "author_url": author_url,
                "author_id": author_id,
                "timestamp_raw": created_time,
                "creation_time": creation_ts,
                "content": message,
                "reactions": reactions,
                "comments": comments,
                "shares": shares,
                "images": images,
                "video_url": None,
                "group_url": group_url,
                "crawled_at": now_iso,
                "crawl_source": "fb_eaa_token",
            }
        )
    return posts


# ── Token Pool CRUD & Safe Public Projection ──────────────────────────────────

def to_public_token_dict(row: dict[str, Any]) -> dict[str, Any]:
    """Never expose `token_encrypted` or raw proxy password to API/UI."""
    sticky_raw = row.get("sticky_proxy_url")
    sticky_masked = row.get("sticky_proxy_masked") or (mask_proxy_url(sticky_raw) if sticky_raw else None)
    return {
        "id": row.get("id"),
        "label": row.get("label") or "Token EAA",
        "token_masked": row.get("token_masked") or "EAA••••",
        "token_type": row.get("token_type") or "UNKNOWN",
        "fb_user_id": row.get("fb_user_id"),
        "fb_user_name": row.get("fb_user_name"),
        "has_sticky_proxy": bool(sticky_raw),
        "sticky_proxy_masked": sticky_masked,
        "proxy_warning": not bool(sticky_raw),
        "hourly_quota": int(row.get("hourly_quota") or DEFAULT_HOURLY_QUOTA),
        "requests_this_hour": int(row.get("requests_this_hour") or 0),
        "total_requests": int(row.get("total_requests") or 0),
        "total_posts_saved": int(row.get("total_posts_saved") or 0),
        "status": row.get("status") or "active",
        "cooldown_until": row.get("cooldown_until"),
        "last_app_usage_pct": float(row.get("last_app_usage_pct") or 0.0),
        "last_error_code": row.get("last_error_code"),
        "last_error_message": row.get("last_error_message"),
        "last_used_at": row.get("last_used_at"),
        "last_tested_at": row.get("last_tested_at"),
        "created_by": row.get("created_by"),
        "created_at": row.get("created_at"),
    }


def list_eaa_tokens_sync() -> list[dict[str, Any]]:
    try:
        sb = get_supabase_client()
        res = sb.table(TABLE_EAA_TOKENS).select("*").order("created_at", desc=True).execute()
        return [to_public_token_dict(r) for r in (res.data or [])]
    except Exception as exc:
        logger.debug("[FB-EAA] list_eaa_tokens_sync fallback empty (%s)", exc)
        return []


def create_eaa_token_sync(
    *,
    label: str,
    access_token: str,
    sticky_proxy_url: Optional[str] = None,
    hourly_quota: int = DEFAULT_HOURLY_QUOTA,
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    raw_tok = str(access_token or "").strip()
    if not raw_tok.startswith("EAA") or len(raw_tok) < 30:
        raise ValueError("Token Facebook không hợp lệ — phải bắt đầu bằng tiền tố EAA... (vd EAAD6V7 / EAAAAU / EAAG).")

    clean_proxy: Optional[str] = None
    masked_proxy: Optional[str] = None
    if sticky_proxy_url and str(sticky_proxy_url).strip():
        clean_proxy = parse_proxy_entry(str(sticky_proxy_url).strip())
        masked_proxy = mask_proxy_url(clean_proxy)

    quota = max(5, min(MAX_HOURLY_QUOTA, int(hourly_quota or DEFAULT_HOURLY_QUOTA)))
    now_iso = _utc_now_iso()
    row = {
        "label": (label or f"Token {detect_eaa_token_type(raw_tok)}").strip()[:120],
        "token_encrypted": encrypt_eaa_token(raw_tok),
        "token_masked": mask_eaa_token(raw_tok),
        "token_type": detect_eaa_token_type(raw_tok),
        "sticky_proxy_url": clean_proxy,
        "sticky_proxy_masked": masked_proxy,
        "hourly_quota": quota,
        "requests_this_hour": 0,
        "hour_window_started_at": now_iso,
        "status": "active",
        "created_by": created_by,
        "updated_at": now_iso,
    }
    sb = get_supabase_client()
    res = sb.table(TABLE_EAA_TOKENS).insert(row).execute()
    created = (res.data or [row])[0]
    return to_public_token_dict(created)


def update_eaa_token_sync(token_id: str, patch: dict[str, Any]) -> Optional[dict[str, Any]]:
    allowed: dict[str, Any] = {}
    if patch.get("label") is not None:
        allowed["label"] = str(patch["label"]).strip()[:120]
    if patch.get("hourly_quota") is not None:
        allowed["hourly_quota"] = max(5, min(MAX_HOURLY_QUOTA, int(patch["hourly_quota"])))
    if patch.get("status") in {"active", "disabled", "cooldown", "quarantined"}:
        allowed["status"] = patch["status"]
        if patch["status"] == "active":
            allowed["cooldown_until"] = None
            allowed["last_error_code"] = None
            allowed["last_error_message"] = None
    if "sticky_proxy_url" in patch:
        raw_px = str(patch.get("sticky_proxy_url") or "").strip()
        if raw_px and "****" not in raw_px:
            canon = parse_proxy_entry(raw_px)
            allowed["sticky_proxy_url"] = canon
            allowed["sticky_proxy_masked"] = mask_proxy_url(canon)
        elif raw_px == "":
            allowed["sticky_proxy_url"] = None
            allowed["sticky_proxy_masked"] = None

    if not allowed:
        return None
    allowed["updated_at"] = _utc_now_iso()
    sb = get_supabase_client()
    res = sb.table(TABLE_EAA_TOKENS).update(allowed).eq("id", token_id).execute()
    return to_public_token_dict(res.data[0]) if res.data else None


def delete_eaa_token_sync(token_id: str) -> bool:
    try:
        sb = get_supabase_client()
        sb.table(TABLE_EAA_TOKENS).delete().eq("id", token_id).execute()
        return True
    except Exception as exc:
        logger.warning("[FB-EAA] delete_eaa_token_sync failed: %s", exc)
        return False


def _select_healthy_token_row_sync() -> Optional[dict[str, Any]]:
    """Pick the least-recently-used active token under its hourly quota (auto-releasing expired cooldowns)."""
    try:
        sb = get_supabase_client()
        res = (
            sb.table(TABLE_EAA_TOKENS)
            .select("*")
            .in_("status", ["active", "cooldown"])
            .order("last_used_at", desc=False, nullsfirst=True)
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        logger.debug("[FB-EAA] select healthy token failed: %s", exc)
        return None

    now = _utc_now()
    for row in rows:
        status = row.get("status")
        if status == "cooldown":
            cd_raw = row.get("cooldown_until")
            if cd_raw:
                try:
                    cd_dt = datetime.fromisoformat(str(cd_raw).replace("Z", "+00:00"))
                    if cd_dt.tzinfo is None:
                        cd_dt = cd_dt.replace(tzinfo=timezone.utc)
                    if cd_dt > now:
                        continue
                except ValueError:
                    continue
            # Cooldown expired -> promote back to active
            try:
                sb.table(TABLE_EAA_TOKENS).update(
                    {"status": "active", "cooldown_until": None, "updated_at": now.isoformat()}
                ).eq("id", row["id"]).execute()
                row["status"] = "active"
            except Exception:
                pass

        # Sliding 1-hour quota window
        quota = int(row.get("hourly_quota") or DEFAULT_HOURLY_QUOTA)
        req_count = int(row.get("requests_this_hour") or 0)
        win_raw = row.get("hour_window_started_at")
        window_expired = True
        if win_raw:
            try:
                win_dt = datetime.fromisoformat(str(win_raw).replace("Z", "+00:00"))
                if win_dt.tzinfo is None:
                    win_dt = win_dt.replace(tzinfo=timezone.utc)
                window_expired = (now - win_dt).total_seconds() >= 3600
            except ValueError:
                window_expired = True

        if window_expired:
            req_count = 0
            row["requests_this_hour"] = 0
            row["hour_window_started_at"] = now.isoformat()

        if req_count >= quota:
            continue

        # Prefer tokens that have a sticky proxy configured!
        if row.get("sticky_proxy_url"):
            return row

    # Fallback: allow non-sticky token if no sticky token exists
    for row in rows:
        if row.get("status") == "active":
            quota = int(row.get("hourly_quota") or DEFAULT_HOURLY_QUOTA)
            if int(row.get("requests_this_hour") or 0) < quota:
                return row
    return None


def _persist_token_telemetry_sync(
    token_id: str,
    *,
    requests_this_hour: int,
    hour_window_started_at: str,
    total_requests: int,
    total_posts_saved: int,
    app_usage_pct: float,
    new_status: Optional[str] = None,
    cooldown_until: Optional[str] = None,
    error_code: Optional[int] = None,
    error_message: Optional[str] = None,
    fb_user_id: Optional[str] = None,
    fb_user_name: Optional[str] = None,
    tested: bool = False,
) -> None:
    try:
        sb = get_supabase_client()
        now_iso = _utc_now_iso()
        patch: dict[str, Any] = {
            "requests_this_hour": max(0, int(requests_this_hour)),
            "hour_window_started_at": hour_window_started_at,
            "total_requests": max(0, int(total_requests)),
            "total_posts_saved": max(0, int(total_posts_saved)),
            "last_app_usage_pct": float(app_usage_pct),
            "last_used_at": now_iso,
            "updated_at": now_iso,
        }
        if tested:
            patch["last_tested_at"] = now_iso
        if new_status:
            patch["status"] = new_status
        if cooldown_until is not None or new_status == "active":
            patch["cooldown_until"] = cooldown_until
        if error_code is not None or new_status == "active":
            patch["last_error_code"] = error_code
            patch["last_error_message"] = (error_message[:400] if error_message else None)
        if fb_user_id:
            patch["fb_user_id"] = fb_user_id
        if fb_user_name:
            patch["fb_user_name"] = fb_user_name

        sb.table(TABLE_EAA_TOKENS).update(patch).eq("id", token_id).execute()
    except Exception as exc:
        logger.debug("[FB-EAA] telemetry update skipped (%s)", exc)


async def test_eaa_token_one_click(
    *,
    token_id: Optional[str] = None,
    raw_token: Optional[str] = None,
    sticky_proxy_url: Optional[str] = None,
    test_group_id_or_url: Optional[str] = None,
    http_client: Any = None,
) -> dict[str, Any]:
    """1-Click Token Health Check: calls `/v19.0/me` (+ optional `/{group_id}/feed?limit=1`)."""
    row: Optional[dict[str, Any]] = None
    if token_id:
        sb = get_supabase_client()
        res = sb.table(TABLE_EAA_TOKENS).select("*").eq("id", token_id).limit(1).execute()
        if not res.data:
            return {"ok": False, "error": "Không tìm thấy EAA token."}
        row = res.data[0]
        token_plain = decrypt_eaa_token(row["token_encrypted"])
        proxy_use = sticky_proxy_url or row.get("sticky_proxy_url")
    else:
        token_plain = str(raw_token or "").strip()
        proxy_use = sticky_proxy_url

    if not token_plain.startswith("EAA"):
        return {"ok": False, "error": "Token không bắt đầu bằng EAA..."}

    t0 = time.perf_counter()
    status_code, me_body, headers = await _graph_get_json(
        f"{GRAPH_API_BASE}/me",
        params={"fields": "id,name", "access_token": token_plain},
        sticky_proxy_url=proxy_use,
        http_client=http_client,
    )
    app_usage = parse_x_app_usage_header(headers.get("x-app-usage") or headers.get("X-App-Usage"))
    err_code, err_msg, action = classify_graph_error(me_body, status_code)

    fb_uid = str(me_body.get("id") or "").strip() or None
    fb_name = str(me_body.get("name") or "").strip() or None
    sample_posts_count: Optional[int] = None
    group_err: Optional[str] = None

    if err_code is None and test_group_id_or_url:
        gid = extract_numeric_group_id(test_group_id_or_url)
        if gid:
            g_status, g_body, g_headers = await _graph_get_json(
                f"{GRAPH_API_BASE}/{gid}/feed",
                params={"fields": "id,message,created_time", "limit": 2, "access_token": token_plain},
                sticky_proxy_url=proxy_use,
                http_client=http_client,
            )
            g_usage = parse_x_app_usage_header(g_headers.get("x-app-usage") or g_headers.get("X-App-Usage"))
            app_usage = max(app_usage, g_usage)
            g_err_code, g_err_msg, g_action = classify_graph_error(g_body, g_status)
            if g_err_code is None:
                sample_posts_count = len(g_body.get("data") or [])
            else:
                group_err = f"Lỗi test nhóm {gid} (mã {g_err_code}): {g_err_msg}"
                if g_action == "quarantine":
                    action = "quarantine"
                    err_code = g_err_code
                    err_msg = g_err_msg

    new_status = "active"
    cooldown_until: Optional[str] = None
    if action == "quarantine":
        new_status = "quarantined"
    elif action == "cooldown" or app_usage >= APP_USAGE_COOLDOWN_THRESHOLD_PCT:
        new_status = "cooldown"
        cooldown_until = (_utc_now() + timedelta(minutes=APP_USAGE_COOLDOWN_MINUTES)).isoformat()

    if row:
        await asyncio.to_thread(
            _persist_token_telemetry_sync,
            row["id"],
            requests_this_hour=int(row.get("requests_this_hour") or 0) + (2 if test_group_id_or_url else 1),
            hour_window_started_at=row.get("hour_window_started_at") or _utc_now_iso(),
            total_requests=int(row.get("total_requests") or 0) + (2 if test_group_id_or_url else 1),
            total_posts_saved=int(row.get("total_posts_saved") or 0),
            app_usage_pct=app_usage,
            new_status=new_status,
            cooldown_until=cooldown_until,
            error_code=err_code,
            error_message=err_msg or group_err,
            fb_user_id=fb_uid,
            fb_user_name=fb_name,
            tested=True,
        )

    return {
        "ok": err_code is None,
        "token_type": detect_eaa_token_type(token_plain),
        "token_masked": mask_eaa_token(token_plain),
        "fb_user_id": fb_uid,
        "fb_user_name": fb_name,
        "status": new_status,
        "app_usage_pct": app_usage,
        "proxy_warning": not bool(proxy_use),
        "sample_posts_count": sample_posts_count,
        "group_error": group_err,
        "error_code": err_code,
        "error": err_msg,
        "latency_ms": int((time.perf_counter() - t0) * 1000),
    }


async def crawl_fb_group_feed_via_eaa(
    token_row: dict[str, Any],
    *,
    group_id_or_url: str,
    group_url: Optional[str] = None,
    limit: int = 25,
    apply_jitter: bool = True,
    http_client: Any = None,
) -> dict[str, Any]:
    """Fetch a Facebook Group feed via Graph API using an encrypted EAA token with all 5 guards."""
    gid = extract_numeric_group_id(group_id_or_url)
    if not gid:
        return {
            "ok": False,
            "state": "invalid_group_id",
            "posts": [],
            "error": "Không tìm thấy numeric group_id (Graph API yêu cầu ID số của nhóm).",
        }

    if apply_jitter:
        await asyncio.sleep(random.uniform(12.0, 28.0))

    token_plain = decrypt_eaa_token(token_row["token_encrypted"])
    sticky_proxy = token_row.get("sticky_proxy_url")
    fields = (
        "id,message,created_time,permalink_url,from,full_picture,"
        "reactions.summary(true),comments.summary(true),shares"
    )
    status_code, body, headers = await _graph_get_json(
        f"{GRAPH_API_BASE}/{gid}/feed",
        params={"fields": fields, "limit": max(1, min(50, int(limit))), "access_token": token_plain},
        sticky_proxy_url=sticky_proxy,
        http_client=http_client,
    )
    app_usage = parse_x_app_usage_header(headers.get("x-app-usage") or headers.get("X-App-Usage"))
    err_code, err_msg, action = classify_graph_error(body, status_code)

    new_status: Optional[str] = None
    cooldown_until: Optional[str] = None
    if action == "quarantine":
        new_status = "quarantined"
    elif action == "cooldown" or app_usage >= APP_USAGE_COOLDOWN_THRESHOLD_PCT:
        new_status = "cooldown"
        mins = RATE_LIMIT_COOLDOWN_MINUTES if action == "cooldown" else APP_USAGE_COOLDOWN_MINUTES
        cooldown_until = (_utc_now() + timedelta(minutes=mins)).isoformat()

    posts = (
        normalize_graph_feed_posts(
            body,
            group_id=gid,
            group_url=group_url or f"https://www.facebook.com/groups/{gid}/",
        )
        if err_code is None
        else []
    )

    if token_row.get("id"):
        await asyncio.to_thread(
            _persist_token_telemetry_sync,
            token_row["id"],
            requests_this_hour=int(token_row.get("requests_this_hour") or 0) + 1,
            hour_window_started_at=token_row.get("hour_window_started_at") or _utc_now_iso(),
            total_requests=int(token_row.get("total_requests") or 0) + 1,
            total_posts_saved=int(token_row.get("total_posts_saved") or 0) + len(posts),
            app_usage_pct=app_usage,
            new_status=new_status,
            cooldown_until=cooldown_until,
            error_code=err_code,
            error_message=err_msg,
        )

    if new_status == "quarantined":
        try:
            await manager.broadcast(
                {
                    "event": "fb_eaa_token_quarantined",
                    "token_id": token_row.get("id"),
                    "label": token_row.get("label"),
                    "error_code": err_code,
                    "error": err_msg,
                }
            )
        except Exception:
            pass

    return {
        "ok": err_code is None,
        "state": "ok" if err_code is None else (new_status or "graph_error"),
        "token_id": token_row.get("id"),
        "token_label": token_row.get("label"),
        "app_usage_pct": app_usage,
        "posts": posts,
        "error_code": err_code,
        "error": err_msg,
    }


async def crawl_private_group_via_eaa_pool(
    *,
    group_url: str,
    group_name: str = "",
    limit: int = 25,
    apply_jitter: bool = False,
    max_token_attempts: int = 2,
    http_client: Any = None,
) -> dict[str, Any]:
    """Smart Router target for Private Groups: tries up to K healthy EAA tokens automatically."""
    tried_ids: set[str] = set()
    last_result: dict[str, Any] = {
        "ok": False,
        "state": "no_active_token",
        "posts": [],
        "error": "Không có EAA token khả dụng trong pool.",
    }
    for _ in range(max(1, int(max_token_attempts))):
        token_row = await asyncio.to_thread(_select_healthy_token_row_sync)
        if not token_row or token_row.get("id") in tried_ids:
            break
        if token_row.get("id"):
            tried_ids.add(str(token_row["id"]))

        res = await crawl_fb_group_feed_via_eaa(
            token_row,
            group_id_or_url=group_url,
            group_url=group_url,
            limit=limit,
            apply_jitter=apply_jitter,
            http_client=http_client,
        )
        last_result = res
        if res.get("ok"):
            return res
        # Only rotate to another token when this token died / hit cooldown
        if res.get("state") not in {"quarantined", "cooldown"}:
            break
    return last_result
