from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import asyncio
import json
import os

from loguru import logger

from app.modules.all_platform.zalo.schemas.message import Message
from app.modules.all_platform.zalo.services.supabase_service import (
    is_supabase_configured,
    save_listener_messages,
)
from app.modules.all_platform.zalo.config import settings
from app.modules.all_platform.zalo.services.zca_api_bridge import (
    get_zca_group_history,
    list_zca_groups,
    list_zca_friends,
)
from app.modules.all_platform.zalo.services.zca_auth_store import list_zca_auth_users, load_zca_auth

# Cache tên từ Supabase để fallback khi ZCA không có (tránh hiển thị mã số).
# Key: (user_id, group_id) → group_name
_supabase_group_name_cache: Dict[Tuple[str, str], str] = {}


_CACHE_LIMIT_PER_GROUP = 1000
_RESTART_BACKOFFS = [5, 15, 45, 120, 300]
_STARTUP_SYNC_GROUP_LIMIT = 8   # giảm từ 20 → 8 để tránh burst 429 khi reconnect
_STARTUP_SYNC_MESSAGE_COUNT = 50
_STARTUP_SYNC_TIMEOUT_MS = 25000
_STARTUP_SYNC_PER_GROUP_DELAY_S = 2.0
_STARTUP_SYNC_INITIAL_DELAY_S = 3.0  # chờ listener ổn định trước khi bắt đầu sync

# Global semaphore: giới hạn concurrent Zalo API calls để tránh burst overload.
_ZALO_API_SEMAPHORE = asyncio.Semaphore(2)


def _is_rate_limited(exc_text: str) -> bool:
    """Detect rate limit (429) errors from various error message formats."""
    lowered = exc_text.lower()
    return any(marker in lowered for marker in ("429", "too many requests", "rate limit", "rate_limit", "ratelimit"))


class AdaptiveRateLimiter:
    """Adaptive rate limiter tự điều chỉnh delay dựa trên phản hồi Zalo API.

    Cơ chế:
    - Base delay: 4s (khoảng cách tối thiểu giữa 2 API call)
    - Khi bị 429: delay x2 (tối đa 120s) + cooldown period 60-300s
    - Khi thành công liên tục: delay giảm dần về base (mỗi 5 success giảm 20%)
    - Jitter: thêm ±30% random để tránh synchronized bursts
    """

    def __init__(self, base_delay: float = 4.0, max_delay: float = 120.0) -> None:
        self._base_delay = base_delay
        self._max_delay = max_delay
        self._current_delay = base_delay
        self._consecutive_success = 0
        self._consecutive_429 = 0
        self._total_429 = 0
        self._cooldown_until: float = 0.0  # epoch timestamp
        self._lock = asyncio.Lock()

    @property
    def stats(self) -> Dict[str, Any]:
        import time
        cooldown_remaining = max(0, self._cooldown_until - time.time())
        return {
            "current_delay_s": round(self._current_delay, 1),
            "consecutive_success": self._consecutive_success,
            "consecutive_429": self._consecutive_429,
            "total_429": self._total_429,
            "cooldown_remaining_s": round(cooldown_remaining, 1),
        }

    async def wait(self) -> float:
        """Wait the adaptive delay before making the next API call. Returns actual delay used."""
        import random
        import time

        async with self._lock:
            # Nếu đang trong cooldown period, chờ hết cooldown.
            now = time.time()
            if now < self._cooldown_until:
                cooldown_wait = self._cooldown_until - now
                logger.info(
                    f"AdaptiveRateLimiter: in cooldown, waiting {cooldown_wait:.0f}s "
                    f"(total_429={self._total_429})"
                )
                await asyncio.sleep(cooldown_wait)

            # Jitter ±30%
            jitter_factor = 1.0 + random.uniform(-0.3, 0.3)
            delay = self._current_delay * jitter_factor
            delay = max(self._base_delay * 0.5, min(delay, self._max_delay))

        await asyncio.sleep(delay)
        return delay

    async def record_success(self) -> None:
        """Record a successful API call."""
        async with self._lock:
            self._consecutive_success += 1
            self._consecutive_429 = 0
            # Mỗi 5 success liên tục → giảm delay 20%, floor = base_delay
            if self._consecutive_success >= 5:
                self._current_delay = max(self._base_delay, self._current_delay * 0.8)
                self._consecutive_success = 0

    async def record_rate_limit(self) -> None:
        """Record a 429 rate limit error. Increases delay significantly."""
        import time

        async with self._lock:
            self._consecutive_429 += 1
            self._total_429 += 1
            self._consecutive_success = 0

            # Delay x2 mỗi lần bị 429 (tối đa max_delay)
            self._current_delay = min(self._max_delay, self._current_delay * 2.0)

            # Cooldown period: 60s cho lần 429 đầu, tăng dần tối đa 300s
            cooldown_s = min(300, 60 * self._consecutive_429)
            self._cooldown_until = time.time() + cooldown_s

            logger.warning(
                f"AdaptiveRateLimiter: 429 detected! "
                f"delay={self._current_delay:.0f}s, cooldown={cooldown_s}s, "
                f"consecutive_429={self._consecutive_429}, total_429={self._total_429}"
            )

    async def record_error(self) -> None:
        """Record a non-rate-limit error. Slightly increases delay."""
        async with self._lock:
            self._consecutive_success = 0
            # Tăng nhẹ delay (+25%) cho lỗi thường
            self._current_delay = min(self._max_delay, self._current_delay * 1.25)


# Global rate limiter — shared giữa startup sync và background backfill.
# ⚠️ LIMITATION (B18): Rate limiter state chỉ tồn tại in-memory per process.
# Nếu deploy horizontal scaling (nhiều backend instances), mỗi instance có limiter riêng
# → các instances không coordinate → có thể burst rate limit cùng lúc.
# TODO: Migrate sang Redis-backed rate limiter (INCR/EXPIRE pattern) khi cần scale.
# Hiện tại: chạy ổn với 1 process. Với 2+ instances, tăng base_delay lên ~8.0s.
_RATE_LIMITER = AdaptiveRateLimiter(base_delay=4.0, max_delay=120.0)

# ── CDN image download helper (B13) ─────────────────────────────────────────
# Zalo CDN URLs expire after the session ends (tied to cookie validity).
# To prevent broken images in message history, we fetch CDN images using
# the current Zalo cookies and append them as base64 data URLs alongside the
# original CDN URLs. Falls back to CDN URL only if download fails.
#
# Data URLs ARE large (~4/3× the raw bytes), but this is consistent with what
# the DOM scraping path already stores (message_parser.py keeps both CDN + data URL).
# Without this, any ZCA-API-sourced image message shows broken images after re-login.

_IMAGE_FETCH_TIMEOUT_S = 8.0
_IMAGE_FETCH_MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB — skip very large images
_IMAGE_FETCH_MAX_PER_MESSAGE = 2               # max CDN URLs to convert per message
_IMAGE_FETCH_SEMAPHORE = asyncio.Semaphore(2)  # max 2 concurrent image fetches globally
_ZALO_CDN_DOMAINS = frozenset({"zalo.me", "zadn.vn", "zalostatic.com", "zalostg.vn", "zaloapp.com"})


def _is_zalo_cdn_url(url: str) -> bool:
    """True nếu URL là Zalo CDN (sẽ expire sau khi session kết thúc)."""
    if not url or not url.startswith("http"):
        return False
    try:
        from urllib.parse import urlparse
        host = urlparse(url).netloc.lower()
        return any(d in host for d in _ZALO_CDN_DOMAINS)
    except Exception:
        return False


def _build_zalo_cookie_header(auth: Dict[str, Any]) -> str:
    """Build Cookie header string từ auth cookie list."""
    cookies = auth.get("cookies") or []
    if isinstance(cookies, str):
        return cookies  # already a header string
    parts = []
    for c in (cookies if isinstance(cookies, list) else []):
        name = c.get("key") or c.get("name") or ""
        value = c.get("value") or ""
        if name and value:
            parts.append(f"{name}={value}")
    return "; ".join(parts)


async def _try_fetch_image_data_url(url: str, auth: Dict[str, Any]) -> Optional[str]:
    """Fetch Zalo CDN image và trả về base64 data URL, hoặc None nếu thất bại."""
    if not _is_zalo_cdn_url(url):
        return None
    try:
        import base64
        import httpx
        headers = {
            "Cookie": _build_zalo_cookie_header(auth),
            "User-Agent": auth.get("userAgent") or "Mozilla/5.0",
            "Referer": "https://chat.zalo.me/",
        }
        async with _IMAGE_FETCH_SEMAPHORE:
            async with httpx.AsyncClient(timeout=_IMAGE_FETCH_TIMEOUT_S, follow_redirects=True) as client:
                response = await client.get(url, headers=headers)
        if not response.is_success:
            logger.debug(f"CDN image fetch {response.status_code} for {url[:80]}")
            return None
        content_type = response.headers.get("content-type", "").split(";")[0].strip()
        if not content_type.startswith("image/"):
            return None
        content = response.content
        if len(content) > _IMAGE_FETCH_MAX_SIZE_BYTES:
            logger.debug(f"CDN image too large ({len(content)} bytes), skipping data URL: {url[:80]}")
            return None
        b64 = base64.b64encode(content).decode("ascii")
        return f"data:{content_type};base64,{b64}"
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.debug(f"Could not fetch CDN image data URL ({url[:80]}): {exc}")
        return None


async def _enrich_image_urls(message: "Message", auth: Dict[str, Any]) -> "Message":
    """Với image-type message có CDN URLs, thử tải và append data URLs làm backup.

    Nếu session hết hạn sau đó, CDN URL sẽ expire nhưng data URL vẫn hiển thị được.
    Consistent với DOM scraping (message_parser.py) đã làm tương tự trong browser context.
    """
    if message.type != "image" or not message.image_urls:
        return message

    cdn_urls = [u for u in message.image_urls if _is_zalo_cdn_url(u)][:_IMAGE_FETCH_MAX_PER_MESSAGE]
    already_has_data = any(u.startswith("data:image/") for u in message.image_urls)
    if not cdn_urls or already_has_data:
        return message

    try:
        data_urls = await asyncio.wait_for(
            asyncio.gather(*[_try_fetch_image_data_url(u, auth) for u in cdn_urls]),
            timeout=_IMAGE_FETCH_TIMEOUT_S + 2.0,
        )
        new_data_urls = [u for u in data_urls if u]
        if new_data_urls:
            return message.model_copy(update={"image_urls": message.image_urls + new_data_urls})
    except asyncio.TimeoutError:
        logger.debug(f"CDN image enrichment timed out for message {message.message_id}")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.debug(f"CDN image enrichment failed for message {message.message_id}: {exc}")
    return message

# Marker cho biết cookie/session Zalo đã hết hạn — không cố restart vô ích nữa.
_AUTH_EXPIRED_MARKERS = (
    "đăng nhập thất bại",
    "logincookie",
    "login failed",
    "login_failed",
    "session expired",
    "not logged in",
    "invalid cookie",
    "cookie expired",
    "error_code",
    "improperly submitted",
)


def _looks_like_auth_expired(text: Optional[str]) -> bool:
    lowered = (text or "").lower()
    return any(marker in lowered for marker in _AUTH_EXPIRED_MARKERS)


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _listener_script_path() -> Path:
    return _backend_root() / "scripts" / "zca_persistent_listener.js"


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _timestamp_ms(value: Any) -> int:
    if value is None:
        return 0

    try:
        text = str(value).strip()
        if not text:
            return 0

        if text.isdigit():
            number = int(text)
            return number * 1000 if number < 10_000_000_000 else number

        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return int(parsed.timestamp() * 1000)
    except Exception:
        return 0


def _message_timestamp_ms(message: Message) -> int:
    return _timestamp_ms(message.timestamp) or _timestamp_ms(message.time_text)


def _message_id_numeric_key(message_id: Any) -> int:
    """Chuyển message_id sang int để sort đúng thứ tự số.

    Tránh lỗi string sort: "9" > "10" dù 9 < 10.
    Zalo message IDs thường là số nguyên lớn (e.g. 6723450981234567890).
    Non-numeric IDs (dom-..., uuid) fallback về 0 và sort theo string tiếp theo.
    """
    try:
        return int(str(message_id or "").strip())
    except (ValueError, TypeError):
        return 0


def _sort_messages_old_to_new(messages: List[Message]) -> List[Message]:
    return sorted(
        messages,
        key=lambda message: (
            _message_timestamp_ms(message),
            _message_id_numeric_key(message.message_id),
            str(message.message_id or ""),  # tiebreaker cho non-numeric IDs
        ),
    )


def _sort_messages_new_to_old(messages: List[Message]) -> List[Message]:
    return sorted(
        messages,
        key=lambda message: (
            _message_timestamp_ms(message),
            _message_id_numeric_key(message.message_id),
            str(message.message_id or ""),
        ),
        reverse=True,
    )


def _to_message(row: Dict[str, Any]) -> Message:
    return Message(
        message_id=str(row.get("message_id") or ""),
        sender_id=row.get("sender_id") or None,
        sender_name=row.get("sender_name") or None,
        timestamp=row.get("timestamp") or None,
        time_text=row.get("time_text") or None,
        type=str(row.get("type") or "text"),
        content=row.get("content") or None,
        image_urls=[str(url) for url in (row.get("image_urls") or []) if url],
        reply_to_id=row.get("reply_to_id") or None,
        is_deleted=bool(row.get("is_deleted")),
        is_sent=bool(row.get("is_sent")),
        # thread_id / group_id từ raw row (dùng khi resolve group_name).
        group_id=str(row.get("thread_id") or row.get("group_id") or "") or None,
    )


@dataclass
class ListenerState:
    user_id: str
    auth: Optional[Dict[str, Any]] = None
    task: Optional[asyncio.Task] = None
    proc: Any = None
    desired: bool = False
    connected: bool = False
    pid: Optional[int] = None
    last_event_at: Optional[str] = None
    last_error: Optional[str] = None
    messages_seen: int = 0
    restart_attempt: int = 0
    auth_expired: bool = False
    group_names: Dict[str, str] = field(default_factory=dict)
    reconnect_sync_task: Optional[asyncio.Task] = None
    backfill_task: Optional[asyncio.Task] = None


class ZcaPersistentListenerManager:
    def __init__(self) -> None:
        self._states: Dict[str, ListenerState] = {}
        self._lock = asyncio.Lock()
        self._cache: Dict[Tuple[str, str], Dict[str, Message]] = {}

    async def start_listener(
        self,
        user_id: str,
        auth: Dict[str, Any],
        *,
        force_restart: bool = False,
    ) -> Dict[str, Any]:
        async with self._lock:
            state = self._states.get(user_id)
            if state and state.task and not state.task.done() and not force_restart:
                return self.status(user_id)
            if state and force_restart:
                await self._stop_state(state)

            state = self._states.get(user_id) or ListenerState(user_id=user_id)
            state.auth = auth
            state.desired = True
            state.connected = False
            state.last_error = None
            state.auth_expired = False
            state.restart_attempt = 0
            self._states[user_id] = state
            state.task = asyncio.create_task(self._run_supervised(state))
            return self.status(user_id)

    async def restart_listener(self, user_id: str) -> Dict[str, Any]:
        auth = await load_zca_auth(user_id)
        if not auth:
            raise RuntimeError(f"No persisted ZCA auth for user={user_id}")
        return await self.start_listener(user_id, auth, force_restart=True)

    async def stop_listener(self, user_id: str) -> Dict[str, Any]:
        async with self._lock:
            state = self._states.get(user_id)
            if not state:
                return self.status(user_id)
            await self._stop_state(state)
            return self.status(user_id)

    async def start_persisted_listeners(self) -> None:
        # LƯU Ý (2026-08-27): đã thử thêm check "chỉ start nếu có row active
        # trong zalo_module_accounts" ở đây, nhưng phải revert — điều tra thực tế
        # trên production cho thấy có account (vd "zl_7035a34c",
        # "admin123-gmail.com") ĐANG hoạt động thật (nhận tin nhắn thật, được
        # frontend poll liên tục) dù KHÔNG có row nào trong zalo_module_accounts.
        # zalo_module_groups/zalo_module_messages chỉ khoá theo user_id (text), không có FK
        # tới zalo_module_accounts, nên listener vẫn chạy tốt độc lập với bảng đó.
        # Thêm check tồn tại sẽ làm gãy các phiên đang chạy thật kiểu này.
        for user_id in await list_zca_auth_users():
            auth = await load_zca_auth(user_id)
            if not auth:
                continue
            try:
                await self.start_listener(user_id, auth)
            except Exception as exc:
                logger.warning(f"Could not start persisted ZCA listener for user={user_id}: {exc}")

    async def shutdown(self) -> None:
        async with self._lock:
            states = list(self._states.values())
        for state in states:
            await self._stop_state(state)

    def status(self, user_id: str) -> Dict[str, Any]:
        state = self._states.get(user_id)
        if not state:
            return {
                "user_id": user_id,
                "running": False,
                "connected": False,
                "pid": None,
                "last_event_at": None,
                "last_error": None,
                "messages_seen": 0,
                "auth_expired": False,
            }
        running = bool(state.proc and state.proc.returncode is None)
        return {
            "user_id": user_id,
            "running": running,
            "connected": state.connected,
            "pid": state.pid if running else None,
            "last_event_at": state.last_event_at,
            "last_error": state.last_error,
            "messages_seen": state.messages_seen,
            "auth_expired": state.auth_expired,
        }

    def get_cached_messages(self, user_id: str, group_id: str, limit: int = 500) -> List[Message]:
        cache = self._cache.get((user_id, group_id)) or {}
        if not cache:
            return []
        safe_limit = max(1, min(int(limit or 500), _CACHE_LIMIT_PER_GROUP))
        return list(cache.values())[-safe_limit:]

    def _recent_group_ids_for_user(self, user_id: str, limit: int = 5) -> List[str]:
        group_stats: List[Tuple[int, int, str]] = []

        for (cached_user_id, group_id), cache in self._cache.items():
            if cached_user_id != user_id or not cache:
                continue

            messages = _sort_messages_new_to_old(list(cache.values()))
            if not messages:
                continue

            last_message = messages[0]
            timestamp_value = _message_timestamp_ms(last_message)
            group_stats.append((timestamp_value, len(cache), group_id))

        group_stats.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return [group_id for _ts, _count, group_id in group_stats[: max(1, int(limit))]]

    async def _sync_recent_groups_after_connect(self, state: ListenerState) -> None:
        if not getattr(settings, "zca_startup_sync_enabled", False):
            logger.info(f"ZCA listener startup sync disabled user={state.user_id}")
            return
        if state.reconnect_sync_task and not state.reconnect_sync_task.done():
            return

        async def _run() -> None:
            try:
                # Chờ listener ổn định trước khi bắt đầu sync để tránh burst 429
                # ngay sau khi connect (Zalo thường throttle nặng nếu gọi API liên tục).
                await asyncio.sleep(_STARTUP_SYNC_INITIAL_DELAY_S)

                if not state.desired or not state.connected:
                    return

                cached_group_ids = self._recent_group_ids_for_user(state.user_id, limit=8)
                known_group_ids = [
                    str(group_id).strip()
                    for group_id in state.group_names.keys()
                    if str(group_id).strip()
                ]

                group_ids = list(dict.fromkeys([*cached_group_ids, *known_group_ids]))[
                    :_STARTUP_SYNC_GROUP_LIMIT
                ]

                if not group_ids:
                    logger.info(f"ZCA listener startup sync skipped user={state.user_id}: no known groups")
                    return

                logger.info(
                    f"ZCA listener startup sync user={state.user_id} "
                    f"groups={group_ids} rate_limiter={_RATE_LIMITER.stats}"
                )

                for idx, group_id in enumerate(group_ids):
                    if not state.desired or not state.connected:
                        break
                    try:
                        # get_zca_group_history hoạt động cho CẢ group và DM khi truyền
                        # đúng thread id (đã dùng thống nhất kiểu này trong first_time_sync
                        # ở zca_api_bridge.js — xem comment "ZCA getGroupChatHistory cũng
                        # dùng được cho DM"). KHÔNG dùng get_zca_user_history/suy đoán type
                        # từ tiền tố "g" — ID zca-js là số nguyên trần, không có tiền tố đó
                        # (đó là convention riêng của DOM scraping cũ), nên heuristic cũ
                        # luôn coi mọi thread là "user" và gọi sai hàm, gây lỗi 404 từ Zalo.
                        async with _ZALO_API_SEMAPHORE:
                            messages = await get_zca_group_history(
                                state.auth or {},
                                group_id,
                                count=_STARTUP_SYNC_MESSAGE_COUNT,
                            )

                        messages = _sort_messages_old_to_new(messages)

                        if messages:
                            await self._record_messages(
                                state,
                                [
                                    {
                                        "thread_id": group_id,
                                        "message_id": message.message_id,
                                        "sender_id": message.sender_id,
                                        "sender_name": message.sender_name,
                                        "timestamp": message.timestamp,
                                        "time_text": message.time_text,
                                        "type": message.type,
                                        "content": message.content,
                                        "image_urls": message.image_urls,
                                        "reply_to_id": message.reply_to_id,
                                        "is_deleted": message.is_deleted,
                                        "is_sent": message.is_sent,
                                    }
                                    for message in messages
                                ],
                                increment_unread=False,
                            )
                            logger.info(
                                f"ZCA listener startup sync saved user={state.user_id} "
                                f"group={group_id} messages={len(messages)}"
                            )
                        else:
                            logger.info(
                                f"ZCA listener startup sync empty user={state.user_id} group={group_id}"
                            )
                        await _RATE_LIMITER.record_success()
                    except Exception as exc:
                        err_str = str(exc).lower()
                        if _is_rate_limited(err_str):
                            await _RATE_LIMITER.record_rate_limit()
                            logger.warning(
                                f"Startup sync rate-limited for user={state.user_id} "
                                f"group={group_id}, will use adaptive delay"
                            )
                        elif _looks_like_auth_expired(err_str):
                            state.auth_expired = True
                            logger.warning(f"Auth expired during startup sync for user={state.user_id}")
                            return
                        else:
                            await _RATE_LIMITER.record_error()
                            logger.warning(
                                f"Startup sync failed for user={state.user_id} group={group_id}: {exc}"
                            )

                    # Adaptive delay giữa các group (thay vì fixed delay).
                    if idx < len(group_ids) - 1:
                        delay = await _RATE_LIMITER.wait()
                        logger.debug(
                            f"Startup sync delay={delay:.1f}s before next group "
                            f"(rate_limiter={_RATE_LIMITER.stats})"
                        )
            finally:
                state.reconnect_sync_task = None
                if state.desired and state.connected:
                    if state.backfill_task and not state.backfill_task.done():
                        state.backfill_task.cancel()
                    state.backfill_task = asyncio.create_task(
                        self._run_background_backfill(state, exclude_group_ids=group_ids)
                    )

        state.reconnect_sync_task = asyncio.create_task(_run())

    async def _run_background_backfill(self, state: ListenerState, exclude_group_ids: List[str]) -> None:
        from app.modules.all_platform.zalo.services.supabase_service import _rest

        logger.info(
            f"Starting low-priority background backfill for user={state.user_id} "
            f"rate_limiter={_RATE_LIMITER.stats}"
        )
        try:
            rows = await _rest(
                "GET",
                "zalo_module_groups",
                params={
                    "select": "group_id,group_name,latest_message_at",
                    "user_id": f"eq.{state.user_id}",
                    "limit": "5000",
                },
            ) or []

            def _parse_time(t: Any) -> float:
                if not t:
                    return 0.0
                try:
                    return datetime.fromisoformat(str(t).replace("Z", "+00:00")).timestamp()
                except Exception:
                    return 0.0

            conversations = sorted(
                rows,
                key=lambda r: _parse_time(r.get("latest_message_at")),
                reverse=True,
            )

            group_ids = [
                str(r["group_id"]).strip()
                for r in conversations
                if r.get("group_id") and str(r["group_id"]).strip() not in exclude_group_ids
            ]

            logger.info(f"Background backfill queue for user={state.user_id}: {len(group_ids)} groups pending.")

            for idx, group_id in enumerate(group_ids):
                if not state.desired or not state.connected:
                    logger.info(
                        f"Stopping backfill for user={state.user_id} "
                        f"(desired={state.desired}, connected={state.connected})"
                    )
                    break

                if (idx + 1) % 20 == 0:
                    logger.info(
                        f"Backfill progress [{idx + 1}/{len(group_ids)}] "
                        f"user={state.user_id} rate_limiter={_RATE_LIMITER.stats}"
                    )

                retry_count = 0
                max_retries = 3
                while retry_count < max_retries:
                    if not state.desired or not state.connected:
                        break
                    try:
                        # Xem giải thích ở _sync_recent_groups_after_connect:
                        # get_zca_group_history dùng chung cho group + DM.
                        async with _ZALO_API_SEMAPHORE:
                            messages = await get_zca_group_history(
                                state.auth or {},
                                group_id,
                                count=30,
                            )

                        messages = _sort_messages_old_to_new(messages)
                        if messages:
                            await self._record_messages(
                                state,
                                [
                                    {
                                        "thread_id": group_id,
                                        "message_id": message.message_id,
                                        "sender_id": message.sender_id,
                                        "sender_name": message.sender_name,
                                        "timestamp": message.timestamp,
                                        "time_text": message.time_text,
                                        "type": message.type,
                                        "content": message.content,
                                        "image_urls": message.image_urls,
                                        "reply_to_id": message.reply_to_id,
                                        "is_deleted": message.is_deleted,
                                        "is_sent": message.is_sent,
                                    }
                                    for message in messages
                                ],
                                increment_unread=False,
                            )
                        await _RATE_LIMITER.record_success()
                        break
                    except Exception as exc:
                        err_str = str(exc).lower()
                        if _is_rate_limited(err_str):
                            await _RATE_LIMITER.record_rate_limit()
                            retry_count += 1
                            if retry_count < max_retries:
                                logger.warning(
                                    f"Backfill rate-limited user={state.user_id} "
                                    f"group={group_id} retry={retry_count}/{max_retries}. "
                                    f"Waiting for adaptive cooldown..."
                                )
                                # Cooldown is handled inside _RATE_LIMITER.wait() below
                            else:
                                logger.warning(
                                    f"Backfill skipping group={group_id} after {max_retries} "
                                    f"rate-limit retries for user={state.user_id}"
                                )
                        elif _looks_like_auth_expired(err_str):
                            logger.warning(f"Auth expired during backfill for user={state.user_id}: {exc}")
                            state.auth_expired = True
                            return
                        else:
                            await _RATE_LIMITER.record_error()
                            logger.warning(f"Backfill failed for user={state.user_id} group={group_id}: {exc}")
                            break

                # Adaptive delay: thay vì fixed random(6, 12), dùng rate limiter thông minh
                delay = await _RATE_LIMITER.wait()
                if (idx + 1) % 10 == 0:
                    logger.debug(f"Backfill adaptive delay={delay:.1f}s after group [{idx + 1}/{len(group_ids)}]")

            logger.info(
                f"Finished background backfill for user={state.user_id} "
                f"rate_limiter={_RATE_LIMITER.stats}"
            )
        except Exception as e:
            logger.error(f"Error in background backfill loop for user={state.user_id}: {e}")

    async def _stop_state(self, state: ListenerState) -> None:
        state.desired = False
        state.connected = False
        
        if state.backfill_task and not state.backfill_task.done():
            state.backfill_task.cancel()
            try:
                await state.backfill_task
            except asyncio.CancelledError:
                pass

        proc = state.proc
        if proc and proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=8)
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
            except ProcessLookupError:
                pass
            except Exception as exc:
                logger.warning(f"Could not stop ZCA listener for user={state.user_id}: {exc}")
        if state.task and not state.task.done():
            state.task.cancel()
            try:
                await state.task
            except asyncio.CancelledError:
                pass
        state.proc = None
        state.pid = None

    async def _run_supervised(self, state: ListenerState) -> None:
        while state.desired:
            try:
                await self._run_once(state)
                if not state.desired:
                    return
                state.last_error = "listener_exited"
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                state.connected = False
                state.last_error = f"{type(exc).__name__}: {exc}"
                logger.warning(f"ZCA listener crashed for user={state.user_id}: {exc}")
                if _looks_like_auth_expired(str(exc)):
                    state.auth_expired = True

            # Cookie hết hạn: dừng hẳn, không restart vô ích. Chờ user đăng nhập lại bằng QR.
            if state.auth_expired:
                state.desired = False
                reason = state.last_error or "unknown"
                logger.warning(
                    f"ZCA session expired for user={state.user_id} — stopping listener until re-login (QR)"
                )
                # Publish auth-expired event để auth SSE endpoint push về FE ngay lập tức.
                try:
                    from app.modules.all_platform.zalo.services.message_events import (
                        publish_auth_expired,
                    )
                    delivered = await publish_auth_expired(state.user_id, reason)
                    logger.info(
                        f"Published auth_expired event for user={state.user_id}: "
                        f"delivered_to_subscriber={delivered}"
                    )
                except Exception as exc:
                    logger.warning(f"Could not publish auth_expired event for user={state.user_id}: {exc}")
                return

            state.restart_attempt += 1
            
            # Safety: if crashed more than 10 times in a row, stop entirely.
            # This prevents resource leaks from cascading crashes (e.g. ZCA buffer overflow).
            if state.restart_attempt > 10:
                logger.error(
                    f"ZCA listener for user={state.user_id} crashed {state.restart_attempt} times "
                    f"in a row (last error: {state.last_error}) — STOPPING. "
                    f"Manual restart via /api/zalo/listener/restart required."
                )
                state.desired = False
                return
            
            delay = _RESTART_BACKOFFS[min(state.restart_attempt - 1, len(_RESTART_BACKOFFS) - 1)]
            logger.warning(
                f"Restarting ZCA listener for user={state.user_id} in {delay}s "
                f"(attempt {state.restart_attempt})"
            )
            await asyncio.sleep(delay)

    async def _run_once(self, state: ListenerState) -> None:
        if not state.auth:
            raise RuntimeError("missing_zca_auth")
        script = _listener_script_path()
        if not script.exists():
            raise RuntimeError(f"ZCA persistent listener helper not found: {script}")

        await self._refresh_group_names(state)

        import sys
        import subprocess

        cmd = [
            "node",
            str(script),
            "--user-id",
            state.user_id,
            "--old-message-interval-ms",
            str(int(getattr(settings, "zca_old_message_interval_ms", 60000))),
        ]

        if sys.platform == "win32":
            from app.modules.all_platform.zalo.services.win_subprocess import WindowsSubprocessWrapper
            stdin_payload = json.dumps(
                {"auth": state.auth, "user_id": state.user_id}
            ).encode("utf-8")
            proc = WindowsSubprocessWrapper(
                cmd,
                cwd=str(_backend_root()),
                env={**os.environ},
                stdin_input=stdin_payload,
            )
            state.proc = proc
            state.pid = proc._proc.pid
        else:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(_backend_root()),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ},
            )
            state.proc = proc
            state.pid = proc.pid
            
            if proc.stdin:
                proc.stdin.write(json.dumps({"auth": state.auth, "user_id": state.user_id}).encode("utf-8"))
                await proc.stdin.drain()
                proc.stdin.close()

        state.last_event_at = _now_iso()
        state.last_error = None
        logger.info(f"Started ZCA persistent listener user={state.user_id} pid={state.pid}")



        stderr_task = asyncio.create_task(self._read_stderr(state, proc))
        try:
            if not proc.stdout:
                raise RuntimeError("listener_stdout_missing")
            line_count = 0
            while state.desired:
                line = await proc.stdout.readline()
                if not line:
                    logger.info(
                        f"ZCA listener stdout closed user={state.user_id} after {line_count} lines"
                    )
                    break
                line_count += 1
                decoded = line.decode("utf-8", errors="replace").strip()
                # Log từng line để debug (chỉ log event quan trọng, tránh spam message).
                if line_count <= 5 or line_count % 50 == 0:
                    logger.info(
                        f"ZCA listener stdout line#{line_count} user={state.user_id}: {decoded[:200]}"
                    )
                await self._handle_event(state, decoded)
            # Drain any remaining buffered stdout so stale data doesn't
            # corrupt the next listener start.
            try:
                import errno
                while True:
                    try:
                        chunk = await asyncio.wait_for(proc.stdout.read(n=8192), timeout=0.5)
                        if not chunk:
                            break
                    except asyncio.TimeoutError:
                        break
                    except OSError as e:
                        if e.errno in (errno.EPIPE, errno.ENOTCONN, errno.EBADF):
                            break
                        raise
            except Exception:
                pass
            await proc.wait()
        finally:
            stderr_task.cancel()
            try:
                await stderr_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            state.connected = False
            state.pid = None
            state.proc = None

    async def _read_stderr(self, state: ListenerState, proc: Any) -> None:
        if not proc.stderr:
            return
        while True:
            line = await proc.stderr.readline()
            if not line:
                return
            logger.warning(
                "ZCA listener stderr user={}: {}",
                state.user_id,
                line.decode("utf-8", errors="replace").strip()[:1000],
            )

    async def _refresh_group_names(self, state: ListenerState) -> None:
        # 1. Load từ Supabase trước (nguồn tin cậy nhất sau sync-recent).
        #    Đặt vào global cache để _record_messages có thể dùng khi ZCA chưa load.
        try:
            from app.modules.all_platform.zalo.services.supabase_service import _rest
            rows = await _rest(
                "GET",
                "zalo_module_groups",
                params={
                    "select": "group_id,group_name",
                    "user_id": f"eq.{state.user_id}",
                    "limit": "5000",
                },
            ) or []
            for row in rows:
                g_id = str(row.get("group_id") or "").strip()
                g_name = str(row.get("group_name") or "").strip()
                if g_id and g_name and not g_name.startswith("Conversation ") and g_name != g_id:
                    _supabase_group_name_cache[(state.user_id, g_id)] = g_name
            logger.info(f"Loaded {len(rows)} group names from Supabase cache for listener user={state.user_id}")
        except Exception as exc:
            logger.warning(f"Could not load group names from Supabase for listener: {exc}")

        # 2. Load từ ZCA API (group + friends) — cập nhật vào state.group_names.
        # Dùng try riêng cho groups và friends để 429 trên một call không chặn cả hai.
        # Thêm delay nhỏ giữa 2 call để tránh burst rate limit ngay khi listener khởi động.
        groups: list = []
        friends: list = []
        try:
            groups = await list_zca_groups(state.auth or {})
        except Exception as exc:
            err = str(exc).lower()
            if "429" in err or "too many" in err or "rate limit" in err:
                logger.warning(f"Rate-limited loading ZCA groups for listener user={state.user_id}, skipping group name preload")
            else:
                logger.warning(f"Could not load ZCA groups for listener name preload user={state.user_id}: {exc}")

        if groups:
            # Small delay between group-list and friend-list calls to avoid burst
            await asyncio.sleep(2.0)

        try:
            friends = await list_zca_friends(state.auth or {})
        except Exception as exc:
            err = str(exc).lower()
            if "429" in err or "too many" in err or "rate limit" in err:
                logger.warning(f"Rate-limited loading ZCA friends for listener user={state.user_id}, skipping friend name preload")
            else:
                logger.warning(f"Could not load ZCA friends for listener name preload user={state.user_id}: {exc}")

        if groups or friends:
            state.group_names = {
                chat.group_id: chat.name
                for chat in (groups + friends)
                if chat.group_id and chat.name and chat.name != chat.group_id
            }
            logger.info(f"Loaded {len(state.group_names)} ZCA group/friend names for listener user={state.user_id}")
        else:
            logger.info(f"No ZCA group/friend names loaded for listener user={state.user_id} (will use Supabase cache)")

    async def _handle_event(self, state: ListenerState, raw_line: str) -> None:
        if not raw_line:
            return

        # ZCA JS emit một số dòng không phải JSON thuần (có prefix).
        # Strip prefix để parse được JSON phía sau.
        cleaned = raw_line
        for prefix in ("TEST_LOGIN_DATA: ", "TEST_SERVER_INFO: ", "WARN: ", "ERROR: "):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):]
                break

        try:
            event = json.loads(cleaned)
        except json.JSONDecodeError:
            logger.debug(f"Non-JSON line from ZCA listener for user={state.user_id}: {raw_line[:200]}")
            return

        state.last_event_at = _now_iso()
        event_name = event.get("event")
        if event_name in {"ready", "starting", "old_messages_requested"}:
            return
        if event_name == "connected":
            state.connected = True
            # Only reset crash counter if we've been running stably for 60s
            # This prevents premature reset from crashing immediately after startup
            if state.last_event_at:
                try:
                    last_ts = datetime.fromisoformat(state.last_event_at.replace("Z", "+00:00"))
                    age_s = (datetime.now(timezone.utc) - last_ts).total_seconds()
                    if age_s > 60:
                        state.restart_attempt = 0
                except Exception:
                    # Fallback: reset on first successful connect after any startup
                    if state.restart_attempt > 0:
                        state.restart_attempt = 0
            state.last_error = None
            logger.info(f"ZCA listener connected user={state.user_id} pid={state.pid}")
            await self._sync_recent_groups_after_connect(state)
            return
        if event_name in {"disconnected", "closed", "stopping"}:
            state.connected = False
            return
        if event_name in {"error", "fatal", "login_failed"}:
            detail = event.get("error_detail") or event.get("error") or event
            state.last_error = json.dumps(detail, ensure_ascii=False)[:1000]
            if _looks_like_auth_expired(state.last_error):
                state.auth_expired = True
            logger.warning(f"ZCA listener event error user={state.user_id}: {state.last_error}")
            return
        if event_name == "message":
            await self._record_messages(state, [event.get("message") or {}])
            return
        if event_name == "old_messages":
            await self._record_messages(state, event.get("messages") or [], increment_unread=False)

    async def _record_messages(self, state: ListenerState, rows: List[Dict[str, Any]], *, increment_unread: bool = True) -> None:
        grouped: Dict[str, List[Message]] = {}

        for row in rows:
            group_id = str(row.get("thread_id") or row.get("group_id") or "").strip()
            if not group_id:
                continue

            message = _to_message(row)
            if not message.message_id:
                continue

            # B13: CDN image URLs expire khi Zalo session hết hạn → broken images.
            # Tải ảnh ngay bây giờ (trong khi session còn valid) và append data URLs
            # làm backup. Nếu CDN expire sau đó, data URL vẫn hiển thị được.
            # Consistent với DOM scraping (message_parser.py) đã làm tương tự.
            if message.type == "image" and state.auth:
                message = await _enrich_image_urls(message, state.auth)

            cache = self._cache.setdefault((state.user_id, group_id), {})

            if message.message_id not in cache:
                state.messages_seen += 1

            cache[message.message_id] = message

            # Giữ cache theo timestamp, không phụ thuộc thứ tự insert.
            sorted_cache_messages = _sort_messages_old_to_new(list(cache.values()))
            if len(sorted_cache_messages) > _CACHE_LIMIT_PER_GROUP:
                sorted_cache_messages = sorted_cache_messages[-_CACHE_LIMIT_PER_GROUP:]

            self._cache[(state.user_id, group_id)] = {
                item.message_id: item
                for item in sorted_cache_messages
                if item.message_id
            }

            grouped.setdefault(group_id, []).append(message)

        if not grouped:
            return

        # Luôn sort tin nhắn cũ -> mới trước khi lưu DB/Supabase.
        for group_id in list(grouped.keys()):
            grouped[group_id] = _sort_messages_old_to_new(grouped[group_id])

        if not is_supabase_configured():
            return

        for group_id, messages in grouped.items():
            # Resolve group_name với 3 mức ưu tiên:
            # 1. Tên từ ZCA API (ưu tiên cao nhất, realtime).
            # 2. Tên từ Supabase cache (được load bởi _refresh_group_names).
            # 3. sender_name từ message đầu tiên (personal chat, sender_name = tên người gửi).
            # KHÔNG BAO GIỜ dùng "Conversation {group_id}" vì nó gây confusion trên UI.
            group_name = state.group_names.get(group_id)
            if not group_name:
                group_name = _supabase_group_name_cache.get((state.user_id, group_id))
            if not group_name:
                # Personal chat (DM): tìm tên từ sender của bất kỳ message nào trong batch.
                # Không chỉ dùng messages[0] vì message đầu có thể là tin của chính mình
                # (sender_name = "__me__") — cần tìm tin từ đối phương.
                _dm_skip = {"__me__", "me", "ban", "bạn", "", None}
                for _msg in messages:
                    if _msg.sender_name not in _dm_skip:
                        group_name = _msg.sender_name
                        break
                # Nếu toàn bộ batch là tin của mình (gửi đi), kiểm tra in-memory cache
                # để xem đối phương có tên trong tin nhắn cũ không.
                if not group_name:
                    cached_msgs = list((self._cache.get((state.user_id, group_id)) or {}).values())
                    for _msg in reversed(cached_msgs):  # tin mới nhất trước
                        if _msg.sender_name not in _dm_skip:
                            group_name = _msg.sender_name
                            break
                if not group_name:
                    # Cuối cùng mới dùng group_id — vẫn hiển thị đẹp hơn "Conversation g123"
                    group_name = f"DM {group_id}"

            try:
                await save_listener_messages(state.user_id, group_id, group_name, messages, increment_unread=increment_unread)
            except Exception as exc:
                state.last_error = f"save_listener_messages_failed:{type(exc).__name__}: {exc}"
                logger.warning(
                    f"Could not save listener messages user={state.user_id} group={group_id}: {exc}"
                )
                continue

            # ── Realtime push (additive, fail-soft) ─────────────────────────
            # Sau khi lưu DB thành công, đẩy event vào in-memory bus để FE nhận
            # qua SSE. Nếu lỗi thì log warning, KHÔNG ảnh hưởng listener loop.
            try:
                from app.modules.all_platform.zalo.services.message_events import (
                    publish_zalo_message_event,
                    register_account_owner,
                )
                from app.modules.all_platform.zalo.services.supabase_service import (
                    list_shared_conversation_ids,
                )

                # Cache owner để filter SSE subscribers.
                register_account_owner(state.user_id, state.user_id)

                # Lấy danh sách conversation đã share để filter cho admin/leader.
                shared_ids = await list_shared_conversation_ids(state.user_id)

                event = {
                    "type": "new_messages",
                    "account_id": state.user_id,
                    "group_id": group_id,
                    "group_name": group_name,
                    "messages": [message.model_dump() for message in messages],
                }
                await publish_zalo_message_event(
                    state.user_id,
                    event,
                    shared_conversation_ids=shared_ids,
                )
            except Exception as exc:
                logger.warning(
                    f"Realtime publish failed for user={state.user_id} group={group_id}: {exc}"
                )


_MANAGER = ZcaPersistentListenerManager()


async def start_listener(user_id: str, auth: Dict[str, Any], *, force_restart: bool = False) -> Dict[str, Any]:
    return await _MANAGER.start_listener(user_id, auth, force_restart=force_restart)


async def restart_listener(user_id: str) -> Dict[str, Any]:
    return await _MANAGER.restart_listener(user_id)


async def stop_listener(user_id: str) -> Dict[str, Any]:
    return await _MANAGER.stop_listener(user_id)


async def start_persisted_listeners() -> None:
    await _MANAGER.start_persisted_listeners()


async def shutdown_persistent_listeners() -> None:
    await _MANAGER.shutdown()


def get_listener_status(user_id: str) -> Dict[str, Any]:
    return _MANAGER.status(user_id)


def get_cached_messages(user_id: str, group_id: str, limit: int = 500) -> List[Message]:
    return _MANAGER.get_cached_messages(user_id, group_id, limit)


def reset_listener_auth_expired(user_id: str) -> None:
    state = _MANAGER._states.get(user_id)
    if state:
        state.auth_expired = False


