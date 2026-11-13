"""Zero-Account Fast Public Group Crawler + 4G Mobile Proxy Orchestrator.

Runs unauthenticated Playwright Guest contexts (zero cookies, zero employee accounts)
behind per-SIM local HTTP->SOCKS5 tunnels (`socks5_http_bridge`), blocks heavy static
assets (images, videos, fonts, trackers), extracts stories directly from SSR HTML
hydration JSON and `/api/graphql` streams, stops scrolling immediately upon hitting
the incremental DB watermark or yesterday's posts, and rotates 4G SIM IPs both
proactively (every K groups) and reactively (on HTTP 429 / checkpoint / login wall).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import parse_qs, unquote, urlencode, urlparse

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.fb_story_parser import (
    classify_guest_page_state,
    extract_post_id_from_url,
    extract_ssr_feed_metadata,
    normalize_group_crawl_url,
    parse_fb_graphql_text,
    parse_fb_html_embedded_stories,
    parse_graphql_pagination_meta,
)
from app.modules.all_platform.services.post_ingest_service import (
    ExtensionCrawlRequest,
    ExtensionPost,
    get_group_post_watermarks,
    ingest_facebook_posts,
)
from app.modules.all_platform.services.socks5_http_bridge import (
    Socks5HttpBridge,
    probe_proxy_egress,
    rewrite_proxy_url_for_runtime,
    parse_proxy_entry,
    normalize_proxy_list,
    mask_proxy_url,
    probe_any_proxy_egress,
)
from app.modules.all_platform.websocket import manager
import httpx

logger = logging.getLogger(__name__)

_VIETNAM_TZ = timezone(timedelta(hours=7))

CHROME_DOC_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

_ACTIVE_GQL_PAGINATION_DOC_ID: str = os.getenv(
    "FB_GQL_GROUP_FEED_DOC_ID",
    "28899178166419503",
).strip() or "28899178166419503"

_GQL_RELAY_INTERNAL_DEFAULTS: dict[str, Any] = {
    "__relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider": False,
    "__relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider": False,
    "__relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider": False,
    "__relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider": False,
    "__relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider": False,
    "__relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider": False,
    "__relay_internal__pv__IsWorkUserrelayprovider": False,
    "__relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider": False,
    "__relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider": False,
    "__relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider": False,
    "__relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider": True,
    "__relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider": False,
    "__relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider": True,
    "__relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider": False,
    "__relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider": False,
    "__relay_internal__pv__IsMergQAPollsrelayprovider": False,
    "__relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider": True,
    "__relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider": False,
    "__relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider": "AUTO_TRANSLATE",
    "__relay_internal__pv__GeminiUFISaveToKnowledgeHubGKrelayprovider": False,
    "__relay_internal__pv__CometUFIShareActionMigrationrelayprovider": True,
    "__relay_internal__pv__CometUFISingleLineUFIrelayprovider": True,
    "__relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider": True,
    "__relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider": False,
    "__relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider": 150,
    "__relay_internal__pv__StoriesShouldEnablePhotosensitiveContentWarningrelayprovider": False,
    "__relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider": False,
    "__relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider": False,
}

PUBLIC_CRAWL_CONFIG_BOUNDS: dict[str, tuple[int, int]] = {
    "cycle_interval_min": (0, 1440),
    "groups_per_ip_rotate": (1, 6),
    "max_posts_per_group": (1, 25),
    "max_scrolls_per_group": (0, 3),
    "concurrent_sims": (1, 4),
    "threads_keyword_target": (5, 50),
    "threads_max_posts_per_keyword": (5, 30),
    "threads_max_age_days": (1, 30),
}

_SCROLL_DEPTH_GQL_BUDGET: dict[int, int] = {
    0: 0,
    1: 4,
    2: 9,
    3: 10,
}

DEFAULT_PUBLIC_CRAWL_CONFIG: dict[str, Any] = {
    "id": "default",
    "enabled": True,
    "cycle_interval_min": 0,
    "groups_per_ip_rotate": 6,
    "max_posts_per_group": 25,
    "max_scrolls_per_group": 2,
    "concurrent_sims": 1,
    "auto_skip_private": True,
    "headless": True,
    "proxy_urls": [],
    "auto_pause_reason": None,
    "proxy_expired_error": None,
    "alternating_threads_enabled": True,
    "threads_keyword_target": 30,
    "threads_max_posts_per_keyword": 20,
    "threads_max_age_days": 7,
    "last_completed_platform": None,
}

MAX_CONSECUTIVE_PROXY_FAILURES = 3

_PROXY_EXPIRED_KEYWORDS: tuple[str, ...] = (
    "socks5 username/password authentication failed",
    "proxy authentication required",
    "407 proxy",
    "socks5 handshake rejected",
    "no acceptable authentication methods",
    "authentication failed (status=",
    "proxy expired",
    "proxy_expired",
)

_PROXY_TRANSPORT_KEYWORDS: tuple[str, ...] = (
    "err_proxy_connection_failed",
    "err_tunnel_connection_failed",
    "err_socks_connection_failed",
    "connection refused",
    "upstream tcp connect",
    "upstream http connect failed",
    "timed out",
    "incomplete read",
    "eof occurred",
    "network is unreachable",
    "host unreachable",
)


def is_proxy_expired_error(err: str | None) -> bool:
    """Return True when proxy explicitly rejects credentials/auth or signals expiry."""
    low = (err or "").strip().lower()
    return bool(low and any(tok in low for tok in _PROXY_EXPIRED_KEYWORDS))


def is_proxy_transport_failure(err: str | None) -> bool:
    """Return True when proxy tunnel/transport fails instead of a Facebook content block."""
    low = (err or "").strip().lower()
    return bool(low and any(tok in low for tok in _PROXY_TRANSPORT_KEYWORDS))


def _continuous_breath_seconds() -> float:
    raw = os.getenv("PUBLIC_CRAWL_CONTINUOUS_BREATH_SEC", "2.0").strip()
    try:
        return max(0.02, min(10.0, float(raw)))
    except ValueError:
        return 2.0


def compute_gql_page_budget(max_posts: int, max_scrolls: int) -> int:
    """Compute bounded GraphQL cursor pagination rounds so UI depth & max_posts both take effect."""
    p_lo, p_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["max_posts_per_group"]
    s_lo, s_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["max_scrolls_per_group"]
    capped_posts = max(p_lo, min(p_hi, int(max_posts)))
    capped_scrolls = max(s_lo, min(s_hi, int(max_scrolls)))
    if capped_scrolls <= 0:
        return 0
    by_scroll = _SCROLL_DEPTH_GQL_BUDGET.get(capped_scrolls, 9)
    by_posts = max(1, (capped_posts + 2) // 3 + 1)
    return max(1, min(by_scroll, by_posts, 10))


def _resolve_configured_proxy_count(proxy_urls: Any = None) -> int:
    if isinstance(proxy_urls, list):
        cleaned = [str(u or "").strip() for u in proxy_urls if str(u or "").strip()]
        if cleaned:
            return len(cleaned)
    env_raw = os.getenv("PUBLIC_CRAWL_PROXIES", "").strip()
    if env_raw:
        try:
            return len(normalize_proxy_list(env_raw))
        except ValueError:
            pass
    return 0


def clamp_public_crawl_config(
    cfg: dict[str, Any],
    *,
    proxy_count: int | None = None,
) -> dict[str, Any]:
    """Enforce safer-only bounds across every config knob and sync concurrent_sims to real proxy count."""
    clamped = dict(cfg)
    for field_name, (lo, hi) in PUBLIC_CRAWL_CONFIG_BOUNDS.items():
        raw_val = clamped.get(field_name)
        fallback = DEFAULT_PUBLIC_CRAWL_CONFIG[field_name]
        try:
            parsed = int(raw_val) if raw_val is not None else int(fallback)
        except (TypeError, ValueError):
            parsed = int(fallback)
        clamped[field_name] = max(lo, min(hi, parsed))

    resolved_proxies = (
        max(0, int(proxy_count))
        if proxy_count is not None
        else _resolve_configured_proxy_count(clamped.get("proxy_urls"))
    )
    max_lanes_cap = max(
        1,
        min(PUBLIC_CRAWL_CONFIG_BOUNDS["concurrent_sims"][1], max(1, resolved_proxies)),
    )
    clamped["concurrent_sims"] = max(1, min(int(clamped["concurrent_sims"]), max_lanes_cap))
    clamped["max_allowed_concurrent_sims"] = max_lanes_cap
    clamped["alternating_threads_enabled"] = (
        True
        if clamped.get("alternating_threads_enabled") is None
        else bool(clamped.get("alternating_threads_enabled"))
    )
    return clamped

_TRACKER_URL_SUBSTRINGS = (
    "facebook.com/tr",
    "connect.facebook.net",
    "doubleclick.net",
    "google-analytics.com",
    "googletagmanager.com",
    "/ajax/bz",
    "/ajax/bnzai",
    "fbsbx.com",
)
_BLOCKED_RESOURCE_TYPES = frozenset({"image", "media", "font", "imageset"})


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_vn_str() -> str:
    return datetime.now(_VIETNAM_TZ).strftime("%Y-%m-%d")


def _post_vn_date(post: dict[str, Any]) -> str | None:
    ts = post.get("creation_time")
    if isinstance(ts, (int, float)) and ts > 0:
        return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(_VIETNAM_TZ).strftime("%Y-%m-%d")
    raw = (post.get("timestamp_raw") or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_VIETNAM_TZ).strftime("%Y-%m-%d")
    except ValueError:
        return None


def evaluate_watermark_early_stop(
    posts: list[dict[str, Any]],
    *,
    known_urls: set[str],
    known_post_ids: set[str],
    today_vn_str: str | None = None,
    max_posts: int = 25,
) -> tuple[bool, str]:
    """Decide whether scrolling can stop immediately for a chronological group feed.

    Pinned posts (`is_pinned=True`) are ignored for the stale/known streak so an old
    pinned announcement at the top never prematurely aborts fresh posts beneath it.
    """
    if not posts:
        return False, ""

    today_str = today_vn_str or _today_vn_str()
    non_pinned = [p for p in posts if not p.get("is_pinned")]
    if not non_pinned:
        return False, ""

    # Order newest-first when creation_time exists
    ordered = sorted(
        non_pinned,
        key=lambda p: float(p.get("creation_time") or 0),
        reverse=True,
    )

    consecutive_stale = 0
    fresh_today = 0

    for post in ordered:
        p_url = (post.get("post_url") or "").strip()
        p_id = str(post.get("post_id") or extract_post_id_from_url(p_url) or "").strip()
        p_date = _post_vn_date(post)

        is_known = (bool(p_url) and p_url in known_urls) or (bool(p_id) and p_id in known_post_ids)
        is_older_day = bool(p_date and p_date < today_str)

        if is_known or is_older_day:
            consecutive_stale += 1
            if consecutive_stale >= 2:
                reason = "known_watermark" if is_known else "older_than_today"
                return True, reason
        else:
            consecutive_stale = 0
            if not p_date or p_date == today_str:
                fresh_today += 1
                if max_posts > 0 and fresh_today >= max_posts:
                    return True, "max_posts_reached"

    return False, ""


def _parse_host_port(proxy_url: str | None) -> tuple[str | None, int | None, str]:
    if not proxy_url:
        return None, None, "direct"
    try:
        parsed = urlparse(proxy_url)
        return parsed.hostname, parsed.port, (parsed.scheme or "socks5").lower()
    except Exception:
        return None, None, "unknown"


@dataclass
class SimNodeRuntime:
    id: str
    label: str
    socks_url: str | None = None
    console_url: str | None = None  # Deprecated: intentionally always None (no mobile phone bridge)
    api_key: str | None = None
    status: str = "idle"  # idle | crawling | rotating | error | expired
    epoch: int = 0
    groups_in_epoch: int = 0
    total_groups: int = 0
    total_rotations: int = 0
    consecutive_proxy_failures: int = 0
    last_egress_ip: str | None = None
    last_rotated_at: str | None = None
    last_error: str | None = None
    last_latency_ms: int | None = None
    last_fb_status: int | None = None
    platform: str | None = None  # None (shared) | "facebook" | "threads"
    raw_node: dict[str, Any] = field(default_factory=dict)

    def to_public_dict(self) -> dict[str, Any]:
        host, port, scheme = _parse_host_port(self.socks_url)
        masked = mask_proxy_url(self.socks_url) if self.socks_url else "direct"
        return {
            "id": self.id,
            "label": self.label,
            "platform": self.platform,
            "hasSocks": bool(self.socks_url),
            "hasConsole": False,
            "autoRotating": bool(self.socks_url),
            "proxyMode": "auto_60s" if self.socks_url else "direct",
            "maskedUrl": masked,
            "socksHost": host,
            "socksPort": port,
            "scheme": scheme,
            "status": self.status,
            "epoch": self.epoch,
            "groups_in_epoch": self.groups_in_epoch,
            "total_groups": self.total_groups,
            "total_rotations": self.total_rotations,
            "consecutive_proxy_failures": self.consecutive_proxy_failures,
            "last_egress_ip": self.last_egress_ip,
            "last_rotated_at": self.last_rotated_at,
            "last_error": self.last_error,
            "last_latency_ms": self.last_latency_ms,
            "last_fb_status": self.last_fb_status,
        }


async def _default_fb_guest_probe(proxy_url: str, timeout: float = 12.0) -> dict[str, Any]:
    """Quickly test whether the current egress IP gets HTTP 200 OK or 302 /login on public FB."""
    test_url = "https://www.facebook.com/groups/thietkewebvietnam/?sorting_setting=CHRONOLOGICAL"
    t0 = time.perf_counter()
    canon = parse_proxy_entry(proxy_url)
    bridge: Socks5HttpBridge | None = None
    httpx_proxy: str | None = None
    try:
        if canon.lower().startswith("socks"):
            bridge = Socks5HttpBridge(canon)
            httpx_proxy = await bridge.start()
        else:
            httpx_proxy = canon

        async with httpx.AsyncClient(
            proxy=httpx_proxy,
            timeout=timeout,
            follow_redirects=False,
            headers=CHROME_DOC_HEADERS,
        ) as client:
            resp = await client.get(test_url)
            loc = (resp.headers.get("location") or "").strip()
            fb_ok = resp.status_code == 200
            return {
                "fbOk": fb_ok,
                "fbStatus": resp.status_code,
                "fbLatencyMs": int((time.perf_counter() - t0) * 1000),
                "fbLocation": loc[:120] if loc else None,
            }
    except Exception as exc:
        return {
            "fbOk": False,
            "fbStatus": None,
            "fbLatencyMs": int((time.perf_counter() - t0) * 1000),
            "fbError": str(exc),
        }
    finally:
        if bridge is not None:
            await bridge.stop()


class RotatingProxyPool:
    """Thread/async-safe pool managing auto-rotating residential/4G proxies (no phone bridge)."""

    def __init__(
        self,
        *,
        probe_fn: Callable[..., Awaitable[dict[str, Any]]] = probe_any_proxy_egress,
        fb_probe_fn: Callable[..., Awaitable[dict[str, Any]]] = _default_fb_guest_probe,
    ) -> None:
        self._probe_fn = probe_fn
        self._fb_probe_fn = fb_probe_fn
        self._locks: dict[str, asyncio.Lock] = {}
        self._states: dict[str, SimNodeRuntime] = {}

    def _lock_for(self, node_id: str) -> asyncio.Lock:
        if node_id not in self._locks:
            self._locks[node_id] = asyncio.Lock()
        return self._locks[node_id]

    def sync_nodes(self, proxy_urls: list[str] | str | None = None) -> list[SimNodeRuntime]:
        """Load rotating proxies from DB config (`proxy_urls`) or `PUBLIC_CRAWL_PROXIES` env."""
        entries: list[str] = []
        if proxy_urls:
            try:
                entries = normalize_proxy_list(proxy_urls)
            except ValueError as exc:
                logger.warning("[PUBLIC-PROXY] Invalid DB proxy_urls entry ignored: %s", exc)
        if not entries:
            env_raw = os.getenv("PUBLIC_CRAWL_PROXIES", "").strip()
            if env_raw:
                try:
                    entries = normalize_proxy_list(env_raw)
                except ValueError as exc:
                    logger.warning("[PUBLIC-PROXY] Invalid PUBLIC_CRAWL_PROXIES env entry: %s", exc)

        # Preserve in-memory node states when callers omit `proxy_urls` (`proxy_urls=None`)
        # during internal rotation/refresh calls, while still honoring explicit `[]` clear.
        if not entries and proxy_urls is None and self._states:
            return list(self._states.values())

        runtimes: list[SimNodeRuntime] = []
        active_ids: set[str] = set()
        total_entries = len(entries)

        for idx, raw_url in enumerate(entries, start=1):
            runtime_url = rewrite_proxy_url_for_runtime(raw_url)
            if not runtime_url:
                continue
            node_id = f"proxy-{idx:02d}"
            host, port, scheme = _parse_host_port(runtime_url)

            # Determine platform assignment:
            # 1. Explicit tag in raw entry (#facebook / #threads or ?platform=...)
            # 2. Port matching (4434 -> facebook, 4554 -> threads)
            # 3. Position convention when 2 proxies configured (idx 1 -> facebook, idx 2 -> threads)
            assigned_platform: str | None = None
            lower_raw = str(raw_url).lower()
            if "#facebook" in lower_raw or "platform=facebook" in lower_raw or port == 4434:
                assigned_platform = "facebook"
            elif "#threads" in lower_raw or "platform=threads" in lower_raw or port == 4554:
                assigned_platform = "threads"
            elif total_entries == 2:
                assigned_platform = "facebook" if idx == 1 else "threads"

            if assigned_platform == "facebook":
                label = f"Proxy FB #{idx:02d} · {host}:{port}" if host and port else f"Proxy FB #{idx:02d}"
            elif assigned_platform == "threads":
                label = f"Proxy Threads #{idx:02d} · {host}:{port}" if host and port else f"Proxy Threads #{idx:02d}"
            else:
                label = f"Proxy Xoay #{idx:02d} · {host}:{port}" if host and port else f"Proxy Xoay #{idx:02d}"

            active_ids.add(node_id)

            existing = self._states.get(node_id)
            if existing is None:
                existing = SimNodeRuntime(
                    id=node_id,
                    label=label,
                    socks_url=runtime_url,
                    console_url=None,
                    platform=assigned_platform,
                    raw_node={"scheme": scheme, "host": host, "port": port},
                )
                self._states[node_id] = existing
            else:
                if existing.socks_url != runtime_url:
                    existing.last_egress_ip = None
                    existing.consecutive_proxy_failures = 0
                    existing.last_error = None
                    if existing.status in {"expired", "error"}:
                        existing.status = "idle"
                existing.label = label
                existing.socks_url = runtime_url
                existing.console_url = None
                existing.platform = assigned_platform
                existing.raw_node = {"scheme": scheme, "host": host, "port": port}
            runtimes.append(existing)

        for stale_id in list(self._states):
            if stale_id not in active_ids:
                self._states.pop(stale_id, None)

        return runtimes

    def reset_proxy_health(self) -> None:
        """Clear consecutive proxy failures / expired markers when new proxies or manual run start."""
        for st in self._states.values():
            st.consecutive_proxy_failures = 0
            st.last_error = None
            if st.status in {"expired", "error"}:
                st.status = "idle"

    def snapshot_nodes(self, proxy_urls: list[str] | str | None = None) -> list[dict[str, Any]]:
        return [s.to_public_dict() for s in self.sync_nodes(proxy_urls)]

    async def refresh_egress_ip(
        self,
        node_id: str,
        *,
        proxy_urls: list[str] | str | None = None,
        log_cb: Callable[[str, str, str], None] | None = None,
    ) -> dict[str, Any]:
        """Non-blocking probe to detect if the 60s auto-rotating proxy already switched IP."""
        self.sync_nodes(proxy_urls)
        state = self._states.get(node_id)
        if state is None or not state.socks_url:
            return {"ok": False, "ip_changed": False, "egress_ip": None}

        prev_ip = state.last_egress_ip
        probe = await self._probe_fn(state.socks_url, timeout=10.0)
        new_ip = probe.get("egressIp")
        if probe.get("latencyMs") is not None:
            state.last_latency_ms = int(probe["latencyMs"])
        ip_changed = bool(new_ip and prev_ip and new_ip != prev_ip)
        if ip_changed:
            state.epoch += 1
            state.groups_in_epoch = 0
            state.total_rotations += 1
            state.last_rotated_at = _utc_now_iso()
            if log_cb:
                log_cb("info", node_id, f"[{node_id}] Proxy tự xoay sang IP mới: {prev_ip} -> {new_ip}")
        if new_ip:
            state.last_egress_ip = new_ip
        return {
            "ok": bool(probe.get("ok")),
            "egress_ip": new_ip,
            "previous_ip": prev_ip,
            "ip_changed": ip_changed,
            "latency_ms": probe.get("latencyMs"),
        }

    async def wait_for_ip_rotation(
        self,
        node_id: str,
        *,
        reason: str = "scheduled",
        proxy_urls: list[str] | str | None = None,
        timeout_sec: float | None = None,
        poll_interval: float = 6.0,
        stop_check: Callable[[], bool] | None = None,
        log_cb: Callable[[str, str, str], None] | None = None,
    ) -> dict[str, Any]:
        """Wait for the provider's 60s auto-rotating proxy to expose a fresh egress IP."""
        self.sync_nodes(proxy_urls)
        state = self._states.get(node_id)
        if state is None:
            return {"ok": False, "node_id": node_id, "error": f"Unknown proxy node '{node_id}'"}
        if not state.socks_url:
            return {"ok": False, "node_id": node_id, "error": f"Proxy '{node_id}' chưa có URL kết nối"}

        max_wait = (
            float(timeout_sec)
            if timeout_sec is not None
            else float(os.getenv("PUBLIC_CRAWL_ROTATE_WAIT_SEC", "68") or "0")
        )

        async with self._lock_for(node_id):
            prev_status = state.status
            state.status = "rotating"
            state.last_error = None
            before_ip = state.last_egress_ip

            try:
                first_probe = await self._probe_fn(state.socks_url, timeout=10.0)
                first_err = str(first_probe.get("error") or "")
                if not first_probe.get("ok") and is_proxy_expired_error(first_err):
                    state.status = "expired"
                    state.last_error = first_err
                    state.consecutive_proxy_failures += 1
                    if log_cb:
                        log_cb(
                            "error",
                            node_id,
                            f"[{node_id}] Proxy HẾT HẠN / Lỗi xác thực SOCKS5 ({first_err}) — dừng xoay IP.",
                        )
                    return {
                        "ok": False,
                        "proxy_expired": True,
                        "node_id": node_id,
                        "error": first_err,
                    }
                cur_ip = first_probe.get("egressIp")
                if first_probe.get("latencyMs") is not None:
                    state.last_latency_ms = int(first_probe["latencyMs"])

                # If IP already rolled over since we started the previous crawl, return immediately!
                if before_ip and cur_ip and cur_ip != before_ip:
                    state.epoch += 1
                    state.groups_in_epoch = 0
                    state.total_rotations += 1
                    state.last_egress_ip = cur_ip
                    state.last_rotated_at = _utc_now_iso()
                    state.status = "idle"
                    if log_cb:
                        log_cb(
                            "success",
                            node_id,
                            f"[{node_id}] Proxy đã tự xoay IP ({reason}): {before_ip} -> {cur_ip}",
                        )
                    return {
                        "ok": True,
                        "node_id": node_id,
                        "egress_ip": cur_ip,
                        "previous_ip": before_ip,
                        "ip_changed": True,
                        "epoch": state.epoch,
                    }

                baseline_ip = before_ip or cur_ip
                if cur_ip:
                    state.last_egress_ip = cur_ip

                if max_wait <= 0:
                    state.status = "idle"
                    return {
                        "ok": bool(first_probe.get("ok")),
                        "node_id": node_id,
                        "egress_ip": cur_ip,
                        "previous_ip": baseline_ip,
                        "ip_changed": False,
                        "epoch": state.epoch,
                    }

                if log_cb:
                    log_cb(
                        "warn",
                        node_id,
                        f"[{node_id}] IP {baseline_ip or '?'} gặp {reason} — chờ proxy tự xoay IP mới (chu kỳ 60s, tối đa {int(max_wait)}s)...",
                    )

                deadline = time.monotonic() + max_wait
                new_ip = cur_ip
                ip_changed = False

                while time.monotonic() < deadline:
                    if stop_check and stop_check():
                        break
                    # Sleep in 1s slices so Dừng button cancels immediately
                    remaining = max(0.0, deadline - time.monotonic())
                    slice_sec = min(poll_interval, remaining)
                    slept = 0.0
                    while slept < slice_sec:
                        if stop_check and stop_check():
                            break
                        step = min(1.0, slice_sec - slept)
                        await asyncio.sleep(step)
                        slept += step
                    if stop_check and stop_check():
                        break

                    probe = await self._probe_fn(state.socks_url, timeout=10.0)
                    probe_err = str(probe.get("error") or "")
                    if not probe.get("ok") and is_proxy_expired_error(probe_err):
                        state.status = "expired"
                        state.last_error = probe_err
                        state.consecutive_proxy_failures += 1
                        if log_cb:
                            log_cb(
                                "error",
                                node_id,
                                f"[{node_id}] Proxy HẾT HẠN trong lúc chờ xoay IP ({probe_err}).",
                            )
                        return {
                            "ok": False,
                            "proxy_expired": True,
                            "node_id": node_id,
                            "error": probe_err,
                        }
                    cand_ip = probe.get("egressIp")
                    if probe.get("latencyMs") is not None:
                        state.last_latency_ms = int(probe["latencyMs"])
                    if cand_ip and baseline_ip and cand_ip != baseline_ip:
                        new_ip = cand_ip
                        ip_changed = True
                        break
                    if cand_ip:
                        new_ip = cand_ip

                if ip_changed:
                    state.epoch += 1
                    state.groups_in_epoch = 0
                    state.total_rotations += 1
                    state.last_egress_ip = new_ip
                    state.last_rotated_at = _utc_now_iso()
                    if log_cb:
                        log_cb(
                            "success",
                            node_id,
                            f"[{node_id}] Đã nhận IP mới sau tự xoay: {baseline_ip} -> {new_ip}",
                        )
                elif log_cb:
                    log_cb(
                        "info",
                        node_id,
                        f"[{node_id}] Hết thời gian chờ đổi IP (vẫn giữ {new_ip or 'N/A'}) — thử lại lượt tiếp theo.",
                    )

                state.status = "idle"
                return {
                    "ok": True,
                    "node_id": node_id,
                    "egress_ip": new_ip,
                    "previous_ip": baseline_ip,
                    "ip_changed": ip_changed,
                    "epoch": state.epoch,
                }
            except Exception as exc:
                err_msg = str(getattr(exc, "detail", exc))
                state.last_error = err_msg
                state.status = prev_status if prev_status != "rotating" else "error"
                if log_cb:
                    log_cb("error", node_id, f"[{node_id}] Lỗi kiểm tra xoay IP: {err_msg}")
                return {"ok": False, "node_id": node_id, "error": err_msg}

    async def rotate_node(
        self,
        node_id: str,
        *,
        reason: str = "scheduled",
        log_cb: Callable[[str, str, str], None] | None = None,
    ) -> dict[str, Any]:
        return await self.wait_for_ip_rotation(node_id, reason=reason, log_cb=log_cb)

    async def test_proxy(
        self,
        node_id: str | None = None,
        *,
        do_rotate: bool = False,
        proxy_urls: list[str] | str | None = None,
    ) -> dict[str, Any]:
        """Probe configured auto-rotating proxies (IP + latency + FB Guest 200/302 check)."""
        nodes = self.sync_nodes(proxy_urls)
        selected = [n for n in nodes if (not node_id or n.id == node_id)]
        if not selected:
            return {
                "ok": False,
                "results": [],
                "error": (
                    "Chưa cấu hình proxy xoay nào. Dán proxy dạng host:port:user:pass hoặc "
                    "socks5://user:pass@host:port vào khung Pool Proxy Xoay rồi bấm Lưu."
                ),
            }

        results: list[dict[str, Any]] = []
        for sim in selected:
            prev_cached_ip = sim.last_egress_ip
            entry: dict[str, Any] = {
                "id": sim.id,
                "label": sim.label,
                "maskedUrl": mask_proxy_url(sim.socks_url) if sim.socks_url else None,
                "socksOk": False,
                "fbOk": False,
                "fbStatus": None,
                "egressIpBefore": prev_cached_ip,
                "egressIpAfter": None,
                "ipChanged": False,
                "latencyMs": None,
                "rotated": False,
                "autoRotating": True,
                "error": None,
            }

            if sim.socks_url:
                probe_now = await self._probe_fn(sim.socks_url, timeout=12.0)
                entry["socksOk"] = bool(probe_now.get("ok"))
                entry["latencyMs"] = probe_now.get("latencyMs")
                if probe_now.get("latencyMs") is not None:
                    sim.last_latency_ms = int(probe_now["latencyMs"])

                cur_ip = probe_now.get("egressIp")
                if cur_ip:
                    if not prev_cached_ip:
                        entry["egressIpBefore"] = cur_ip
                    entry["egressIpAfter"] = cur_ip
                    sim.last_egress_ip = cur_ip
                    sim.last_error = None
                    sim.consecutive_proxy_failures = 0
                    if sim.status in {"expired", "error"}:
                        sim.status = "idle"
                    if prev_cached_ip and cur_ip != prev_cached_ip:
                        entry["rotated"] = True
                        sim.total_rotations += 1
                        sim.last_rotated_at = _utc_now_iso()
                elif probe_now.get("error"):
                    raw_probe_err = str(probe_now["error"])
                    entry["error"] = f"Lỗi kết nối proxy: {raw_probe_err}"
                    sim.last_error = entry["error"]
                    if is_proxy_expired_error(raw_probe_err):
                        sim.status = "expired"
                        entry["proxyExpired"] = True

                if do_rotate and entry["socksOk"]:
                    wait_res = await self.wait_for_ip_rotation(
                        sim.id,
                        reason="manual_rotation_verify",
                        proxy_urls=proxy_urls,
                    )
                    if wait_res.get("egress_ip"):
                        entry["egressIpAfter"] = wait_res["egress_ip"]
                    entry["rotated"] = bool(wait_res.get("ip_changed"))

                # Lightweight Facebook Guest HTTP probe to verify IP isn't on a login wall
                if entry["socksOk"]:
                    fb_res = await self._fb_probe_fn(sim.socks_url, timeout=10.0)
                    entry["fbOk"] = bool(fb_res.get("fbOk"))
                    entry["fbStatus"] = fb_res.get("fbStatus")
                    sim.last_fb_status = fb_res.get("fbStatus")

            ip_before = entry.get("egressIpBefore")
            ip_after = entry.get("egressIpAfter")
            entry["ipChanged"] = bool(ip_before and ip_after and ip_before != ip_after)
            results.append(entry)

        all_ok = any(r["socksOk"] for r in results)
        return {"ok": all_ok, "results": results}


# Backward-compat alias for internal imports/tests during transition
MobileProxyRotator = RotatingProxyPool


class GuestPublicGroupWorker:
    """Scrapes a batch of public Facebook groups over a dedicated SIM 4G proxy lane."""

    def __init__(
        self,
        *,
        sim: SimNodeRuntime,
        rotator: MobileProxyRotator,
        config: dict[str, Any],
        log_cb: Callable[[str, str, str], None],
        stop_check: Callable[[], bool],
        progress_cb: Callable[[dict[str, Any]], None],
        keywords: list[str] | None = None,
        attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        threads_attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        run_id: str | None = None,
    ) -> None:
        self.sim = sim
        self.rotator = rotator
        self.config = config
        self.log_cb = log_cb
        self.stop_check = stop_check
        self.progress_cb = progress_cb
        self.keywords = keywords
        self._attempt_fetcher = attempt_fetcher
        self._threads_attempt_fetcher = threads_attempt_fetcher
        self.run_id = run_id

        self._bridge: Socks5HttpBridge | None = None
        self._http_client: httpx.AsyncClient | None = None
        self._playwright: Any = None
        self._browser: Any = None
        self._context: Any = None

    async def __aenter__(self) -> "GuestPublicGroupWorker":
        await self.start()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.close()

    async def start(self) -> None:
        if self._attempt_fetcher is not None or self._threads_attempt_fetcher is not None:
            return  # Unit test mode with injected fetcher (no Chromium spawn needed)

        if self.sim.socks_url and self.sim.socks_url.lower().startswith("socks"):
            self._bridge = Socks5HttpBridge(self.sim.socks_url)
            await self._bridge.start()

    async def _ensure_playwright_browser(self) -> None:
        """Lazily boot headless Chromium only when deep scroll / JS fallback is actually needed."""
        if self._browser is not None and self._context is not None:
            return
        if self._attempt_fetcher is not None and self._threads_attempt_fetcher is not None:
            return

        proxy_arg: dict[str, str] | None = None
        if self._bridge is not None:
            proxy_arg = {"server": self._bridge.local_http_url}
        elif self.sim.socks_url:
            from urllib.parse import urlparse as _urlparse, unquote as _unquote
            parsed = _urlparse(self.sim.socks_url)
            server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
            proxy_arg = {"server": server}
            if parsed.username:
                proxy_arg["username"] = _unquote(parsed.username)
                proxy_arg["password"] = _unquote(parsed.password or "")

        from playwright.async_api import async_playwright

        self._playwright = await async_playwright().start()
        headless = bool(self.config.get("headless", True))
        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ]
        self._browser = await self._playwright.chromium.launch(
            headless=headless,
            proxy=proxy_arg,
            args=launch_args,
        )
        await self.reset_guest_context()

    async def reset_guest_context(self) -> None:
        """Close any previous Guest context and create a fresh cookie-free context."""
        if self._attempt_fetcher is not None:
            return
        if self._context is not None:
            try:
                await self._context.close()
            except Exception:
                pass
            self._context = None
        if self._browser is None:
            return

        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 840},
            locale="vi-VN",
            timezone_id="Asia/Ho_Chi_Minh",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            ignore_https_errors=True,
        )

        async def _route_filter(route: Any) -> None:
            req = route.request
            r_type = req.resource_type
            url_lower = (req.url or "").lower()
            if r_type in _BLOCKED_RESOURCE_TYPES or any(
                tok in url_lower for tok in _TRACKER_URL_SUBSTRINGS
            ):
                await route.abort()
                return
            await route.continue_()

        await self._context.route("**/*", _route_filter)

    async def close(self) -> None:
        if self._http_client is not None:
            try:
                await self._http_client.aclose()
            except Exception:
                pass
            self._http_client = None
        if self._context is not None:
            try:
                await self._context.close()
            except Exception:
                pass
            self._context = None
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        if self._bridge is not None:
            try:
                await self._bridge.stop()
            except Exception:
                pass
            self._bridge = None

    def _httpx_proxy_url(self) -> str | None:
        if self._bridge is not None:
            return self._bridge.local_http_url
        if self.sim.socks_url and self.sim.socks_url.lower().startswith("http"):
            return self.sim.socks_url
        return None

    def _build_http_client(self, proxy_http: str | None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            proxy=proxy_http,
            timeout=20.0,
            follow_redirects=False,
            headers=CHROME_DOC_HEADERS,
        )

    async def _resilient_http_request(
        self,
        method: str,
        url: str,
        *,
        client: Any,
        ephemeral: bool,
        proxy_http: str | None,
        **kwargs: Any,
    ) -> tuple[Any, Any]:
        """Execute GET/POST with 1 transparent reconnect retry if 60s proxy rotation drops TCP socket."""
        retry_excs = (
            httpx.RemoteProtocolError,
            httpx.ReadTimeout,
            httpx.ConnectError,
            httpx.ProxyError,
        )
        cur_client = client
        for retry_idx in range(2):
            try:
                fn = getattr(cur_client, method.lower())
                resp = await (fn(url) if (method.lower() == "get" and not kwargs) else fn(url, **kwargs))
                return resp, cur_client
            except retry_excs as exc:
                if retry_idx == 0:
                    logger.debug(
                        "[PUBLIC-PROXY] %s reconnect retry after transient transport error (%s)",
                        self.sim.id,
                        exc,
                    )
                    if not ephemeral:
                        cookie_backup: dict[str, str] = {}
                        try:
                            if hasattr(cur_client, "cookies"):
                                cookie_backup = dict(cur_client.cookies.items())
                        except Exception:
                            cookie_backup = {}
                        try:
                            if hasattr(cur_client, "aclose"):
                                await cur_client.aclose()
                        except Exception:
                            pass
                        cur_client = self._build_http_client(proxy_http)
                        self._http_client = cur_client
                        try:
                            if cookie_backup and hasattr(cur_client, "cookies"):
                                cur_client.cookies.update(cookie_backup)
                        except Exception:
                            pass
                    continue
                raise
        raise RuntimeError("Unreachable HTTP retry loop")

    async def _fetch_group_ssr_fast(
        self,
        raw_url: str,
        target_url: str,
        *,
        known_urls: set[str],
        known_ids: set[str],
        max_posts: int,
        max_scrolls: int,
    ) -> dict[str, Any]:
        """Hybrid HTTPX fast-path: SSR fetch (~1s) + direct `/api/graphql` cursor pagination for 20-25 posts.

        - Catches `302 /login/` walls in ~300ms without booting Chromium.
        - Parses initial SSR `<script type="application/json">` stories.
        - Short-circuits when `max_scrolls == 0` or DB watermark / today-limit is already reached.
        - Otherwise chains `GroupsCometFeedRegularStoriesPaginationQuery` via HTTPX (`~1s` per 3 posts)
          to collect up to `max_posts` (`20-25`) chronological posts without launching Playwright.
        """
        collected: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        proxy_http = self._httpx_proxy_url()
        cur_url = target_url
        final_status: int | None = None
        html_text = ""

        client: Any
        ephemeral = False
        if self._attempt_fetcher is None and hasattr(httpx.AsyncClient, "aclose"):
            if self._http_client is None:
                self._http_client = self._build_http_client(proxy_http)
            client = self._http_client
        else:
            ephemeral = True
            client = self._build_http_client(proxy_http)

        if hasattr(client, "cookies"):
            client.cookies.clear()

        async def _run_on_client(c: Any) -> dict[str, Any] | None:
            nonlocal cur_url, final_status, html_text
            for _hop in range(3):
                resp, c = await self._resilient_http_request(
                    "get",
                    cur_url,
                    client=c,
                    ephemeral=ephemeral,
                    proxy_http=proxy_http,
                )
                final_status = resp.status_code
                if final_status in {301, 302, 303, 307, 308}:
                    loc = (resp.headers.get("location") or "").strip()
                    loc_lower = loc.lower()
                    if "/login" in loc_lower or "/checkpoint" in loc_lower:
                        return {
                            "state": "login_wall",
                            "posts": [],
                            "seen_ids": seen_ids,
                            "early_stop_reason": "",
                            "scrolls": 0,
                            "need_playwright": False,
                            "method": "httpx_fast",
                        }
                    if loc.startswith("http"):
                        cur_url = normalize_group_crawl_url(loc) if "/groups/" in loc_lower else loc
                        continue
                html_text = resp.text or ""
                break

            if final_status == 429:
                return {
                    "state": "rate_limit",
                    "posts": [],
                    "seen_ids": seen_ids,
                    "early_stop_reason": "",
                    "scrolls": 0,
                    "need_playwright": False,
                    "method": "httpx_fast",
                }

            if final_status == 200 and html_text:
                ssr_posts = parse_fb_html_embedded_stories(
                    html_text,
                    group_url=raw_url,
                    seen_ids=seen_ids,
                )
                collected.extend(ssr_posts)

                body_hint = ""
                if not collected:
                    body_hint = re.sub(r"<[^>]+>", " ", html_text[:80000])
                state = classify_guest_page_state(
                    current_url=cur_url,
                    body_text=body_hint,
                    extracted_posts_count=len(collected),
                    http_status=final_status,
                )
                if state in {"rate_limit", "login_wall", "private_group"}:
                    return {
                        "state": state,
                        "posts": collected,
                        "seen_ids": seen_ids,
                        "early_stop_reason": "",
                        "scrolls": 0,
                        "need_playwright": False,
                        "method": "httpx_fast",
                    }

                non_pinned_count = sum(1 for p in collected if not p.get("is_pinned"))
                should_stop, stop_reason = evaluate_watermark_early_stop(
                    collected,
                    known_urls=known_urls,
                    known_post_ids=known_ids,
                    max_posts=max_posts,
                )
                if (max_scrolls <= 0 and len(collected) > 0) or (should_stop and len(collected) > 0) or (non_pinned_count >= max_posts):
                    return {
                        "state": "ok",
                        "posts": collected,
                        "seen_ids": seen_ids,
                        "early_stop_reason": stop_reason or ("httpx_fast_no_scroll" if max_scrolls <= 0 else ""),
                        "scrolls": 0,
                        "need_playwright": False,
                        "method": "httpx_fast",
                    }

                # HTTPX GraphQL Cursor Pagination when cursor + LSD + group_id exist in SSR HTML
                meta = extract_ssr_feed_metadata(html_text, group_url=cur_url)
                cursor = meta.get("end_cursor")
                has_next = bool(meta.get("has_next_page"))
                gid = meta.get("group_id") or ""
                lsd = meta.get("lsd") or ""
                initial_count = len(collected)
                gql_pages_done = 0

                if max_scrolls > 0 and cursor and has_next and gid and lsd and hasattr(c, "post"):
                    max_gql_pages = compute_gql_page_budget(max_posts, max_scrolls)
                    for page_no in range(1, max_gql_pages + 1):
                        non_pinned_count = sum(1 for p in collected if not p.get("is_pinned"))
                        if self.stop_check() or non_pinned_count >= max_posts or not cursor or not has_next:
                            break
                        vp = {
                            "count": 10,
                            "cursor": cursor,
                            "feedLocation": "GROUP",
                            "feedType": "DISCUSSION",
                            "feedbackSource": 0,
                            "filterTopicId": None,
                            "focusCommentID": None,
                            "privacySelectorRenderLocation": "COMET_STREAM",
                            "referringStoryRenderLocation": None,
                            "renderLocation": "group",
                            "scale": 1,
                            "sortingSetting": "CHRONOLOGICAL",
                            "stream_initial_count": 1,
                            "useDefaultActor": False,
                            "youthIntegrityHostID": gid,
                            "id": gid,
                            **_GQL_RELAY_INTERNAL_DEFAULTS,
                        }
                        form = {
                            "av": "0",
                            "__user": "0",
                            "__a": "1",
                            "__req": format(page_no + 2, "x"),
                            "__hs": meta.get("hs") or "",
                            "dpr": "1",
                            "__ccg": "EXCELLENT",
                            "__rev": meta.get("rev") or "1054229411",
                            "__hsi": meta.get("hsi") or "",
                            "__comet_req": "15",
                            "lsd": lsd,
                            "__spin_r": meta.get("spin_r") or meta.get("rev") or "1054229411",
                            "__spin_b": meta.get("spin_b") or "trunk",
                            "__spin_t": meta.get("spin_t") or str(int(time.time())),
                            "fb_api_caller_class": "RelayModern",
                            "fb_api_req_friendly_name": "GroupsCometFeedRegularStoriesPaginationQuery",
                            "variables": json.dumps(vp, separators=(",", ":")),
                            "server_timestamps": "true",
                            "doc_id": _ACTIVE_GQL_PAGINATION_DOC_ID,
                        }
                        gql_headers = {
                            "User-Agent": CHROME_DOC_HEADERS["User-Agent"],
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Accept": "*/*",
                            "Accept-Language": CHROME_DOC_HEADERS["Accept-Language"],
                            "Origin": "https://www.facebook.com",
                            "Referer": cur_url,
                            "X-FB-Friendly-Name": "GroupsCometFeedRegularStoriesPaginationQuery",
                            "X-FB-LSD": lsd,
                            "Sec-Fetch-Dest": "empty",
                            "Sec-Fetch-Mode": "cors",
                            "Sec-Fetch-Site": "same-origin",
                        }
                        try:
                            gr, c = await self._resilient_http_request(
                                "post",
                                "https://www.facebook.com/api/graphql/",
                                client=c,
                                ephemeral=ephemeral,
                                proxy_http=proxy_http,
                                data=urlencode(form),
                                headers=gql_headers,
                            )
                        except Exception as gql_exc:
                            logger.debug("[PUBLIC-PROXY] GQL page %s transient stop: %s", page_no, gql_exc)
                            if len(collected) > initial_count:
                                stop_reason = stop_reason or "httpx_gql_partial"
                            break

                        gql_pages_done += 1
                        if gr.status_code == 429:
                            if len(collected) <= initial_count:
                                return {
                                    "state": "rate_limit",
                                    "posts": collected,
                                    "seen_ids": seen_ids,
                                    "early_stop_reason": "",
                                    "scrolls": gql_pages_done,
                                    "need_playwright": False,
                                    "method": "httpx_gql",
                                }
                            stop_reason = stop_reason or "gql_rate_limit_partial"
                            break

                        if gr.status_code != 200 or not getattr(gr, "text", ""):
                            break

                        gql_txt = gr.text or ""
                        new_posts = parse_fb_graphql_text(
                            gql_txt,
                            group_url=raw_url,
                            seen_ids=seen_ids,
                        )
                        gql_meta = parse_graphql_pagination_meta(gql_txt)
                        if new_posts:
                            collected.extend(new_posts)

                        non_pinned_count = sum(1 for p in collected if not p.get("is_pinned"))
                        should_stop, stop_reason = evaluate_watermark_early_stop(
                            collected,
                            known_urls=known_urls,
                            known_post_ids=known_ids,
                            max_posts=max_posts,
                        )
                        if should_stop or non_pinned_count >= max_posts:
                            stop_reason = stop_reason or "max_posts_reached"
                            break

                        if gql_meta.get("login_required") or gql_meta.get("rate_limited"):
                            if len(collected) <= initial_count:
                                return {
                                    "state": "rate_limit" if gql_meta.get("rate_limited") else "login_wall",
                                    "posts": collected,
                                    "seen_ids": seen_ids,
                                    "early_stop_reason": "",
                                    "scrolls": gql_pages_done,
                                    "need_playwright": False,
                                    "method": "httpx_gql",
                                }
                            stop_reason = stop_reason or "gql_partial"
                            break

                        if not new_posts:
                            break

                        next_cursor = gql_meta.get("end_cursor")
                        has_next = bool(gql_meta.get("has_next_page"))
                        if not next_cursor or next_cursor == cursor:
                            break
                        cursor = next_cursor

                    if len(collected) > initial_count or should_stop or not has_next:
                        return {
                            "state": "ok",
                            "posts": collected,
                            "seen_ids": seen_ids,
                            "early_stop_reason": stop_reason or f"httpx_gql_{gql_pages_done}p",
                            "scrolls": gql_pages_done,
                            "need_playwright": False,
                            "method": "httpx_gql",
                        }

                return {
                    "state": "ok",
                    "posts": collected,
                    "seen_ids": seen_ids,
                    "early_stop_reason": stop_reason,
                    "scrolls": gql_pages_done,
                    "need_playwright": True,
                    "method": "httpx_partial",
                }

            return None

        try:
            ctx_mgr = client if ephemeral and hasattr(client, "__aenter__") else None
            if ctx_mgr is not None:
                async with ctx_mgr as c:
                    res = await _run_on_client(c)
                    if res is not None:
                        return res
            else:
                res = await _run_on_client(client)
                if res is not None:
                    return res
        finally:
            if ephemeral and not hasattr(client, "__aenter__") and hasattr(client, "aclose"):
                await client.aclose()

        return {
            "state": "unknown",
            "posts": collected,
            "seen_ids": seen_ids,
            "early_stop_reason": "",
            "scrolls": 0,
            "need_playwright": True,
            "method": "httpx_fallback",
        }

    async def _fetch_group_with_playwright(
        self,
        group: dict[str, Any],
        watermarks: dict[str, set[str]],
    ) -> dict[str, Any]:
        """Hybrid public group loader: HTTPX SSR Fast-Path first (~1s), Playwright scroll when needed."""
        raw_url = (group.get("group_url") or "").strip()
        target_url = normalize_group_crawl_url(raw_url)
        p_lo, p_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["max_posts_per_group"]
        s_lo, s_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["max_scrolls_per_group"]
        raw_max_posts = self.config.get("max_posts_per_group")
        max_posts = 25 if raw_max_posts is None else max(p_lo, min(p_hi, int(raw_max_posts)))
        raw_max_scrolls = self.config.get("max_scrolls_per_group")
        max_scrolls = 2 if raw_max_scrolls is None else max(s_lo, min(s_hi, int(raw_max_scrolls)))
        known_urls = watermarks.get("urls") or set()
        known_ids = watermarks.get("post_ids") or set()

        collected: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        # Step 1: Fast HTTPX SSR path
        try:
            fast_res = await self._fetch_group_ssr_fast(
                raw_url,
                target_url,
                known_urls=known_urls,
                known_ids=known_ids,
                max_posts=max_posts,
                max_scrolls=max_scrolls,
            )
            collected.extend(fast_res.get("posts") or [])
            seen_ids.update(fast_res.get("seen_ids") or set())
            if not fast_res.get("need_playwright"):
                return {
                    "state": fast_res.get("state") or "ok",
                    "posts": collected,
                    "early_stop_reason": fast_res.get("early_stop_reason") or "",
                    "scrolls": 0,
                }
        except Exception as fast_exc:
            logger.debug("[PUBLIC-PROXY] HTTPX fast-path fallback for %s (%s)", raw_url, fast_exc)

        # Step 2: Lazy Playwright Guest mode with modal dialog dismissal + GraphQL intercept
        await self._ensure_playwright_browser()
        if self._context is None:
            await self.reset_guest_context()
        if self._context is None:
            raise RuntimeError("Playwright Guest context could not be initialized")

        graphql_tasks: set[asyncio.Task[Any]] = set()
        http_status: int | None = None

        page = await self._context.new_page()

        async def _consume_graphql_response(resp: Any) -> None:
            global _ACTIVE_GQL_PAGINATION_DOC_ID
            try:
                r_url = resp.url or ""
                if "/api/graphql" not in r_url or resp.status != 200:
                    return
                try:
                    post_data = getattr(resp.request, "post_data", "") or ""
                    if "GroupsCometFeedRegularStoriesPaginationQuery" in post_data:
                        qs = parse_qs(post_data)
                        new_doc_id = (qs.get("doc_id") or [""])[0].strip()
                        if new_doc_id and new_doc_id.isdigit() and new_doc_id != _ACTIVE_GQL_PAGINATION_DOC_ID:
                            _ACTIVE_GQL_PAGINATION_DOC_ID = new_doc_id
                            logger.info("[PUBLIC-PROXY] Auto-updated GQL Pagination doc_id=%s", new_doc_id)
                except Exception:
                    pass
                raw_text = await resp.text()
                new_posts = parse_fb_graphql_text(
                    raw_text,
                    group_url=raw_url,
                    seen_ids=seen_ids,
                )
                if new_posts:
                    collected.extend(new_posts)
            except Exception:
                pass

        def _on_response(resp: Any) -> None:
            r_url = resp.url or ""
            if "/api/graphql" in r_url:
                t = asyncio.create_task(_consume_graphql_response(resp))
                graphql_tasks.add(t)
                t.add_done_callback(graphql_tasks.discard)

        page.on("response", _on_response)
        try:
            resp = await page.goto(target_url, wait_until="domcontentloaded", timeout=22000)
            if resp is not None:
                http_status = resp.status

            # Brief settle for inline SSR hydration + initial Relay chunks
            await page.wait_for_timeout(1200)
            try:
                await page.keyboard.press("Escape")
                await page.evaluate(
                    "document.querySelectorAll('[role=dialog], [aria-modal=true]').forEach(el => {"
                    "el.style.setProperty('display','none','important');"
                    "el.style.setProperty('pointer-events','none','important');"
                    "});"
                    "if(document.body) document.body.style.overflow='auto';"
                    "if(document.documentElement) document.documentElement.style.overflow='auto';"
                )
            except Exception:
                pass

            if graphql_tasks:
                await asyncio.gather(*list(graphql_tasks), return_exceptions=True)

            html_text = await page.content()
            ssr_posts = parse_fb_html_embedded_stories(
                html_text,
                group_url=raw_url,
                seen_ids=seen_ids,
            )
            if ssr_posts:
                collected.extend(ssr_posts)

            try:
                body_text = await page.inner_text("body")
            except Exception:
                body_text = ""

            state = classify_guest_page_state(
                current_url=page.url,
                body_text=body_text,
                extracted_posts_count=len(collected),
                http_status=http_status,
            )
            if state in {"rate_limit", "login_wall", "private_group"}:
                return {
                    "state": state,
                    "posts": collected,
                    "early_stop_reason": "",
                    "scrolls": 0,
                }

            should_stop, stop_reason = evaluate_watermark_early_stop(
                collected,
                known_urls=known_urls,
                known_post_ids=known_ids,
                max_posts=max_posts,
            )

            scrolls_done = 0
            while not should_stop and scrolls_done < max_scrolls and not self.stop_check():
                scrolls_done += 1
                await page.evaluate(
                    "document.querySelectorAll('[role=dialog], [aria-modal=true]').forEach(el => {"
                    "el.style.setProperty('display','none','important');"
                    "el.style.setProperty('pointer-events','none','important');"
                    "});"
                    "window.scrollTo(0, document.body.scrollHeight);"
                )
                await page.wait_for_timeout(1500)
                if graphql_tasks:
                    await asyncio.gather(*list(graphql_tasks), return_exceptions=True)
                should_stop, stop_reason = evaluate_watermark_early_stop(
                    collected,
                    known_urls=known_urls,
                    known_post_ids=known_ids,
                    max_posts=max_posts,
                )

            return {
                "state": "ok",
                "posts": collected,
                "early_stop_reason": stop_reason,
                "scrolls": scrolls_done,
            }
        finally:
            try:
                page.remove_listener("response", _on_response)
            except Exception:
                pass
            if graphql_tasks:
                for t in list(graphql_tasks):
                    t.cancel()
            try:
                await page.close()
            except Exception:
                pass

    async def process_group(self, group: dict[str, Any]) -> dict[str, Any]:
        """Crawl one public group, handle early-stop / reactive IP rotation / DB update."""
        t0 = time.perf_counter()
        group_id = str(group.get("id") or "")
        group_name = (group.get("group_name") or group.get("group_url") or "Unknown").strip()
        group_url = (group.get("group_url") or "").strip()

        self.sim.status = "crawling"
        watermarks = await asyncio.to_thread(
            get_group_post_watermarks,
            group_id=group_id or None,
            group_url=group_url or None,
            limit=40,
        )

        outcome: dict[str, Any] = {"state": "error", "posts": [], "early_stop_reason": ""}
        rotated_on_retry = False
        error_msg: str | None = None
        proxy_expired_detected = False

        for attempt in range(2):
            try:
                if self._attempt_fetcher is not None:
                    outcome = await self._attempt_fetcher(self.sim, group, watermarks, attempt)
                else:
                    outcome = await self._fetch_group_with_playwright(group, watermarks)
                if outcome.get("error") and not error_msg:
                    error_msg = str(outcome.get("error"))
            except Exception as exc:
                error_msg = str(exc)
                if is_proxy_expired_error(error_msg):
                    proxy_expired_detected = True
                    outcome = {"state": "error", "posts": [], "early_stop_reason": ""}
                    break
                if attempt == 0 and self.sim.socks_url and self._attempt_fetcher is None:
                    self.log_cb(
                        "warn",
                        self.sim.id,
                        f"[{group_name}] Lỗi kết nối/proxy ({error_msg}) — đợi proxy {self.sim.id} xoay IP & thử lại...",
                    )
                    rot = await self.rotator.wait_for_ip_rotation(
                        self.sim.id,
                        reason="reactive_proxy_error",
                        proxy_urls=[self.sim.socks_url],
                        stop_check=self.stop_check,
                        log_cb=self.log_cb,
                    )
                    if rot.get("proxy_expired"):
                        proxy_expired_detected = True
                        error_msg = str(rot.get("error") or error_msg)
                        outcome = {"state": "error", "posts": [], "early_stop_reason": ""}
                        break
                    if rot.get("ok"):
                        rotated_on_retry = bool(rot.get("ip_changed") or rot.get("ok"))
                        if rot.get("ip_changed"):
                            self.progress_cb({"ip_rotations": 1})
                        await self.reset_guest_context()
                        continue
                outcome = {"state": "error", "posts": [], "early_stop_reason": ""}
                break

            state = outcome.get("state") or "ok"
            if state == "error" and is_proxy_expired_error(error_msg):
                proxy_expired_detected = True
                break
            fallback_proxies = self.config.get("proxy_urls") or ([self.sim.socks_url] if self.sim.socks_url else None)
            if state in {"rate_limit", "login_wall"} and attempt == 0 and fallback_proxies:
                rot = await self.rotator.wait_for_ip_rotation(
                    self.sim.id,
                    reason=f"reactive_{state}",
                    proxy_urls=fallback_proxies,
                    stop_check=self.stop_check,
                    log_cb=self.log_cb,
                )
                if rot.get("proxy_expired"):
                    proxy_expired_detected = True
                    error_msg = str(rot.get("error") or error_msg or state)
                    break
                if rot.get("ok"):
                    rotated_on_retry = True
                    if rot.get("ip_changed"):
                        self.progress_cb({"ip_rotations": 1})
                    await self.reset_guest_context()
                    continue
                error_msg = rot.get("error") or state
                break
            break

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        final_state = outcome.get("state") or "ok"
        raw_posts: list[dict[str, Any]] = outcome.get("posts") or []

        if final_state == "private_group":
            self.sim.consecutive_proxy_failures = 0
            if self.sim.status in {"expired", "error"}:
                self.sim.status = "idle"
            await asyncio.to_thread(
                _update_group_crawl_meta_sync,
                group_id=group_id,
                status="private_skipped",
                error="Phát hiện nhóm riêng tư (Private Group) ở chế độ Guest",
                posts_count=0,
                mark_private=bool(self.config.get("auto_skip_private", True)),
            )
            self.log_cb("warn", self.sim.id, f"[{group_name}] Là nhóm riêng tư -> đã gắn badge Private & bỏ qua ({elapsed_ms}ms)")
            self.sim.total_groups += 1
            return {
                "group_id": group_id,
                "status": "private_skipped",
                "posts_saved": 0,
                "elapsed_ms": elapsed_ms,
            }

        if final_state in {"rate_limit", "login_wall", "error"} and not raw_posts:
            status_label = "blocked" if final_state in {"rate_limit", "login_wall"} else "error"
            err_text = error_msg or f"Guest blocked ({final_state})"

            if final_state in {"rate_limit", "login_wall"}:
                # Temporary FB block means proxy itself is still alive -> never trip 24/24 proxy expiry
                self.sim.consecutive_proxy_failures = 0
                if self.sim.status in {"expired", "error"}:
                    self.sim.status = "idle"
            else:
                if proxy_expired_detected or is_proxy_expired_error(err_text):
                    self.sim.consecutive_proxy_failures += 1
                    self.sim.status = "expired"
                    self.sim.last_error = err_text
                    status_label = "proxy_expired"
                elif is_proxy_transport_failure(err_text) or error_msg is not None:
                    self.sim.consecutive_proxy_failures += 1
                    if self.sim.consecutive_proxy_failures >= MAX_CONSECUTIVE_PROXY_FAILURES:
                        probe_dead = True
                        probe_err = err_text
                        if self.sim.socks_url:
                            try:
                                probe_res = await self.rotator._probe_fn(self.sim.socks_url, timeout=8.0)
                                if probe_res.get("ok"):
                                    probe_dead = False
                                    self.sim.consecutive_proxy_failures = 0
                                elif probe_res.get("error"):
                                    probe_err = str(probe_res["error"])
                            except Exception as probe_exc:
                                probe_err = str(probe_exc)
                        if probe_dead:
                            self.sim.status = "expired"
                            self.sim.last_error = probe_err
                            err_text = probe_err
                            status_label = "proxy_expired"

            await asyncio.to_thread(
                _update_group_crawl_meta_sync,
                group_id=group_id,
                status="error" if status_label == "proxy_expired" else status_label,
                error=err_text,
                posts_count=0,
                mark_private=False,
            )
            log_lvl = "error"
            if status_label == "proxy_expired":
                self.log_cb(
                    log_lvl,
                    self.sim.id,
                    f"[{group_name}] PROXY HẾT HẠN / LỖI KẾT NỐI ({err_text}) — tạm dừng luồng {self.sim.id}.",
                )
            else:
                self.log_cb(log_lvl, self.sim.id, f"[{group_name}] Thất bại ({status_label}): {err_text}")
            self.sim.total_groups += 1
            return {
                "group_id": group_id,
                "status": status_label,
                "proxy_expired": status_label == "proxy_expired",
                "posts_saved": 0,
                "elapsed_ms": elapsed_ms,
                "error": err_text,
            }

        self.sim.consecutive_proxy_failures = 0
        self.sim.last_error = None
        if self.sim.status in {"expired", "error"}:
            self.sim.status = "idle"

        # Convert extracted dicts -> ExtensionPost payload and ingest through shared service
        ext_posts = [
            ExtensionPost(
                post_url=p.get("post_url"),
                url=p.get("post_url"),
                author_name=p.get("author_name") or "",
                author_url=p.get("author_url") or "",
                timestamp_raw=p.get("timestamp_raw"),
                date=p.get("timestamp_raw"),
                timestamp_class="iso",
                content=p.get("content") or "",
                reactions=int(p.get("reactions") or 0),
                comments=int(p.get("comments") or 0),
                shares=int(p.get("shares") or 0),
                images=p.get("images") or [],
                video_url=p.get("video_url"),
                media_url=p.get("video_url"),
                group_url=group_url,
                crawled_at=p.get("crawled_at"),
            )
            for p in raw_posts
            if p.get("post_url")
        ]

        effective_max_posts = max(
            PUBLIC_CRAWL_CONFIG_BOUNDS["max_posts_per_group"][0],
            min(
                PUBLIC_CRAWL_CONFIG_BOUNDS["max_posts_per_group"][1],
                int(self.config.get("max_posts_per_group") or 25),
            ),
        )
        saved_count = 0
        if ext_posts:
            ingest_req = ExtensionCrawlRequest(
                posts=ext_posts,
                group_name=group_name,
                group_url=group_url,
                group_id=group_id or None,
                keywords=self.keywords,
                post_limit=effective_max_posts,
                worker_id=f"public-4g:{self.sim.id}",
            )
            ingest_res = await ingest_facebook_posts(
                ingest_req,
                event_name="public_4g_crawl_saved",
                extra_broadcast_fields={
                    "source": "public_4g",
                    "sim_node": self.sim.id,
                    "run_id": self.run_id,
                },
            )
            saved_count = int(ingest_res.get("count") or 0)

        crawl_status = "rotated_retry" if rotated_on_retry else "ok"
        await asyncio.to_thread(
            _update_group_crawl_meta_sync,
            group_id=group_id,
            status=crawl_status,
            error=None,
            posts_count=saved_count,
            mark_private=False,
        )

        stop_note = f" | {outcome['early_stop_reason']}" if outcome.get("early_stop_reason") else ""
        self.log_cb(
            "success",
            self.sim.id,
            f"[{group_name}] Đọc {len(raw_posts)} bài -> lưu mới {saved_count} bài ({elapsed_ms}ms{stop_note})",
        )

        # Track epoch count & probe passively every K groups to detect 60s auto-rotated IP + clean Guest context
        self.sim.total_groups += 1
        self.sim.groups_in_epoch += 1
        k_lo, k_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["groups_per_ip_rotate"]
        k_rotate = max(k_lo, min(k_hi, int(self.config.get("groups_per_ip_rotate") or 6)))
        if (
            self.sim.socks_url
            and self.sim.groups_in_epoch >= k_rotate
            and not self.stop_check()
        ):
            probe_res = await self.rotator.refresh_egress_ip(
                self.sim.id,
                proxy_urls=self.config.get("proxy_urls") or [self.sim.socks_url],
                log_cb=self.log_cb,
            )
            if probe_res.get("ip_changed"):
                self.progress_cb({"ip_rotations": 1})
            self.sim.groups_in_epoch = 0
            await self.reset_guest_context()

        self.sim.status = "idle"
        return {
            "group_id": group_id,
            "status": crawl_status,
            "posts_saved": saved_count,
            "extracted": len(raw_posts),
            "elapsed_ms": elapsed_ms,
        }

    async def process_threads_keyword(self, keyword: str) -> dict[str, Any]:
        """Crawl one Threads search keyword without any account over the rotating 4G proxy."""
        from app.modules.all_platform.services.threads_no_acc_crawler_service import (
            ThreadsKeywordCrawlResult,
            build_threads_search_url,
            crawl_threads_keyword_guest,
            ingest_threads_4g_keyword_batch,
        )

        t0 = time.perf_counter()
        kw = str(keyword or "").strip()
        search_url = build_threads_search_url(kw)
        self.sim.status = "crawling"

        p_lo, p_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["threads_max_posts_per_keyword"]
        raw_limit = self.config.get("threads_max_posts_per_keyword")
        max_posts = 20 if raw_limit is None else max(p_lo, min(p_hi, int(raw_limit)))

        a_lo, a_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["threads_max_age_days"]
        raw_age = self.config.get("threads_max_age_days")
        max_age_days = 7 if raw_age is None else max(a_lo, min(a_hi, int(raw_age)))

        # Threads Guest locks page-2+ GraphQL pagination and opens an Instagram login modal on scroll,
        # so scroll=0 avoids wasted latency & modal popups while getting all ~10-26 SSR/hydrated posts.
        scrolls = 0

        result: ThreadsKeywordCrawlResult = ThreadsKeywordCrawlResult(
            keyword=kw,
            search_url=search_url,
            status="transport_error",
            should_rotate=False,
        )
        rotated_on_retry = False
        proxy_expired_detected = False

        for attempt in range(2):
            if self.stop_check():
                break
            try:
                if self._threads_attempt_fetcher is not None:
                    raw_out = await self._threads_attempt_fetcher(self.sim, kw, attempt)
                    if isinstance(raw_out, ThreadsKeywordCrawlResult):
                        result = raw_out
                    else:
                        st = str((raw_out or {}).get("status") or (raw_out or {}).get("state") or "ok")
                        result = ThreadsKeywordCrawlResult(
                            keyword=kw,
                            search_url=search_url,
                            status=st,
                            should_rotate=bool(
                                (raw_out or {}).get(
                                    "should_rotate",
                                    st in {"login_wall", "rate_limited", "empty_or_throttled", "transport_error", "http_error"},
                                )
                            ),
                            raw_extracted=len((raw_out or {}).get("posts") or []),
                            error=(raw_out or {}).get("error"),
                            posts=list((raw_out or {}).get("posts") or []),
                        )
                else:
                    await self._ensure_playwright_browser()
                    if self._context is None:
                        await self.reset_guest_context()
                    if self._context is None:
                        raise RuntimeError("Playwright Guest context could not be initialized for Threads")
                    page = await self._context.new_page()
                    try:
                        result = await crawl_threads_keyword_guest(
                            page,
                            kw,
                            max_posts=max_posts,
                            scrolls=scrolls,
                            is_proxy_expired_fn=is_proxy_expired_error,
                        )
                    finally:
                        try:
                            await page.close()
                        except Exception:
                            pass
            except Exception as exc:
                err_str = str(exc)
                expired = is_proxy_expired_error(err_str)
                result = ThreadsKeywordCrawlResult(
                    keyword=kw,
                    search_url=search_url,
                    status="proxy_expired" if expired else "transport_error",
                    should_rotate=not expired,
                    error=err_str[:280],
                )

            if result.status == "proxy_expired" or is_proxy_expired_error(result.error):
                proxy_expired_detected = True
                break

            fallback_proxies = self.config.get("proxy_urls") or (
                [self.sim.socks_url] if self.sim.socks_url else None
            )
            if result.should_rotate and attempt == 0 and fallback_proxies:
                rot = await self.rotator.wait_for_ip_rotation(
                    self.sim.id,
                    reason=f"threads_{result.status}",
                    proxy_urls=fallback_proxies,
                    stop_check=self.stop_check,
                    log_cb=self.log_cb,
                )
                if rot.get("proxy_expired"):
                    proxy_expired_detected = True
                    result.error = str(rot.get("error") or result.error or result.status)
                    break
                if rot.get("ok"):
                    rotated_on_retry = True
                    if rot.get("ip_changed"):
                        self.progress_cb({"ip_rotations": 1})
                    await self.reset_guest_context()
                    continue
                if rot.get("error") and not result.error:
                    result.error = str(rot["error"])
                break
            break

        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if result.status in {"login_wall", "rate_limited", "empty", "empty_or_throttled", "ok"} and not proxy_expired_detected:
            self.sim.consecutive_proxy_failures = 0
            if self.sim.status in {"expired", "error"}:
                self.sim.status = "idle"
        else:
            err_text = result.error or result.status
            if proxy_expired_detected or is_proxy_expired_error(err_text):
                self.sim.consecutive_proxy_failures += 1
                self.sim.status = "expired"
                self.sim.last_error = err_text
                self.log_cb(
                    "error",
                    self.sim.id,
                    f"[Threads: {kw}] PROXY HẾT HẠN / LỖI KẾT NỐI ({err_text}) — tạm dừng luồng {self.sim.id}.",
                )
                self.sim.total_groups += 1
                return {
                    "keyword": kw,
                    "status": "proxy_expired",
                    "proxy_expired": True,
                    "posts_saved": 0,
                    "extracted": 0,
                    "elapsed_ms": elapsed_ms,
                    "error": err_text,
                }
            if result.status in {"transport_error", "http_error"}:
                self.sim.consecutive_proxy_failures += 1
                if self.sim.consecutive_proxy_failures >= MAX_CONSECUTIVE_PROXY_FAILURES:
                    probe_dead = True
                    probe_err = err_text
                    if self.sim.socks_url:
                        try:
                            probe_res = await self.rotator._probe_fn(self.sim.socks_url, timeout=8.0)
                            if probe_res.get("ok"):
                                probe_dead = False
                                self.sim.consecutive_proxy_failures = 0
                            elif probe_res.get("error"):
                                probe_err = str(probe_res["error"])
                        except Exception as probe_exc:
                            probe_err = str(probe_exc)
                    if probe_dead:
                        self.sim.status = "expired"
                        self.sim.last_error = probe_err
                        self.sim.total_groups += 1
                        return {
                            "keyword": kw,
                            "status": "proxy_expired",
                            "proxy_expired": True,
                            "posts_saved": 0,
                            "extracted": 0,
                            "elapsed_ms": elapsed_ms,
                            "error": probe_err,
                        }

        # Ingest extracted posts into threads_posts -> crawled_post_audit_logs -> AI scoring -> keyword registry
        if result.posts:
            result = await ingest_threads_4g_keyword_batch(
                result,
                keyword=kw,
                post_limit=max_posts,
                max_age_days=max_age_days,
                proxy_node=self.sim.id,
                run_id=self.run_id,
            )
            status_out = "rotated_retry" if rotated_on_retry else "ok"
            lead_note = f" · {result.high_score_count} Lead >=70đ" if result.high_score_count > 0 else ""
            self.log_cb(
                "success",
                self.sim.id,
                (
                    f"[Threads: {kw}] Đọc {result.raw_extracted} bài -> lưu mới {result.saved_count} bài"
                    f"{lead_note} ({elapsed_ms}ms)"
                ),
            )
        elif result.status == "empty":
            try:
                from app.modules.all_platform.services.threads_keyword_service import record_keyword_result
                await asyncio.to_thread(record_keyword_result, kw, 0, 0)
            except Exception:
                pass
            status_out = "ok"
            self.log_cb(
                "info",
                self.sim.id,
                f"[Threads: {kw}] 0 bài khớp từ khóa ({elapsed_ms}ms)",
            )
        else:
            status_out = "blocked" if result.status in {"login_wall", "rate_limited", "empty_or_throttled"} else "error"
            self.log_cb(
                "warn" if status_out == "blocked" else "error",
                self.sim.id,
                f"[Threads: {kw}] Bị chặn / lỗi tạm thời ({result.error or result.status}) ({elapsed_ms}ms)",
            )

        self.sim.total_groups += 1
        self.sim.groups_in_epoch += 1
        k_lo, k_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["groups_per_ip_rotate"]
        k_rotate = max(k_lo, min(k_hi, int(self.config.get("groups_per_ip_rotate") or 6)))
        if (
            self.sim.socks_url
            and self.sim.groups_in_epoch >= k_rotate
            and not self.stop_check()
        ):
            probe_res = await self.rotator.refresh_egress_ip(
                self.sim.id,
                proxy_urls=self.config.get("proxy_urls") or [self.sim.socks_url],
                log_cb=self.log_cb,
            )
            if probe_res.get("ip_changed"):
                self.progress_cb({"ip_rotations": 1})
            self.sim.groups_in_epoch = 0
            await self.reset_guest_context()

        self.sim.status = "idle"
        return {
            "keyword": kw,
            "status": status_out,
            "posts_saved": result.saved_count,
            "high_score_count": result.high_score_count,
            "extracted": result.raw_extracted,
            "elapsed_ms": elapsed_ms,
            "error": result.error,
        }


def _update_group_crawl_meta_sync(
    *,
    group_id: str,
    status: str,
    error: str | None,
    posts_count: int,
    mark_private: bool = False,
) -> None:
    if not group_id:
        return
    try:
        supabase = get_supabase_client()
        patch: dict[str, Any] = {
            "last_public_crawled_at": _utc_now_iso(),
            "last_public_crawl_status": status,
            "last_public_crawl_error": (error[:500] if error else None),
            "last_public_posts_count": int(posts_count),
        }
        if mark_private:
            patch["visibility"] = "private"
        supabase.table("facebook_groups").update(patch).eq("id", group_id).execute()
    except Exception as exc:
        logger.warning("[PUBLIC-4G] Could not update group meta %s: %s", group_id, exc)


class PublicCrawlOrchestrator:
    """Singleton orchestrator scheduling parallel SIM 4G lanes + config + run history."""

    def __init__(self) -> None:
        self.rotator = MobileProxyRotator()
        self.is_running: bool = False
        self.stop_requested: bool = False
        self.active_run_id: str | None = None
        self.started_at: str | None = None
        self._active_task: asyncio.Task[Any] | None = None
        self._next_round_task: asyncio.Task[Any] | None = None
        self._task_fb: asyncio.Task[Any] | None = None
        self._task_threads: asyncio.Task[Any] | None = None
        self._waiting_fb: bool = False
        self._waiting_threads: bool = False
        self.loop_round_fb: int = 0
        self.loop_round_threads: int = 0
        self.active_run_id_fb: str | None = None
        self.active_run_id_threads: str | None = None
        self._stats_fb: dict[str, Any] = {
            "total_groups": 0,
            "completed_groups": 0,
            "groups_ok": 0,
            "groups_failed": 0,
            "groups_private": 0,
            "posts_saved": 0,
            "ip_rotations": 0,
            "avg_ms_per_group": 0,
        }
        self._stats_threads: dict[str, Any] = {
            "total_groups": 0,
            "completed_groups": 0,
            "groups_ok": 0,
            "groups_failed": 0,
            "groups_private": 0,
            "posts_saved": 0,
            "ip_rotations": 0,
            "avg_ms_per_group": 0,
        }
        self._continuous_waiting: bool = False
        self._continuous_attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None
        self._continuous_threads_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None
        self._continuous_keywords: list[str] | None = None
        self._continuous_limit_groups: int | None = None
        self.loop_round: int = 0
        self.last_round_finished_at: str | None = None
        self.new_groups_detected: int = 0
        self.auto_pause_reason: str | None = None
        self.proxy_expired_error: str | None = None
        self.current_platform: str = "facebook"
        self.next_platform: str = "threads"
        self.last_completed_platform: str | None = None
        self.active_threads_keywords: list[dict[str, Any]] = []
        self.threads_keyword_meta: dict[str, Any] = {}
        self._logs: deque[dict[str, str]] = deque(maxlen=250)
        self._stats: dict[str, Any] = {
            "total_groups": 0,
            "completed_groups": 0,
            "groups_ok": 0,
            "groups_failed": 0,
            "groups_private": 0,
            "posts_saved": 0,
            "ip_rotations": 0,
            "avg_ms_per_group": 0,
        }

    def append_log(self, level: str, sim_id: str, message: str) -> None:
        self._logs.append(
            {
                "ts": _utc_now_iso(),
                "level": level,
                "sim_id": sim_id,
                "message": message,
            }
        )

    def _bump_progress(self, delta: dict[str, int]) -> None:
        for k, v in delta.items():
            if k in self._stats and isinstance(v, (int, float)):
                self._stats[k] = int(self._stats.get(k) or 0) + int(v)

    def get_config_sync(self) -> dict[str, Any]:
        cfg = dict(DEFAULT_PUBLIC_CRAWL_CONFIG)
        cfg["auto_pause_reason"] = self.auto_pause_reason
        cfg["proxy_expired_error"] = self.proxy_expired_error
        try:
            supabase = get_supabase_client()
            res = (
                supabase.table("public_crawl_config")
                .select("*")
                .eq("id", "default")
                .limit(1)
                .execute()
            )
            if res.data:
                row = res.data[0]
                for k, v in row.items():
                    if v is not None:
                        cfg[k] = v
                if "auto_pause_reason" in row:
                    self.auto_pause_reason = row.get("auto_pause_reason")
                    cfg["auto_pause_reason"] = self.auto_pause_reason
                if "proxy_expired_error" in row:
                    self.proxy_expired_error = row.get("proxy_expired_error")
                    cfg["proxy_expired_error"] = self.proxy_expired_error
                if row.get("last_completed_platform") in {"facebook", "threads"} and self.last_completed_platform is None:
                    self.last_completed_platform = row.get("last_completed_platform")
        except Exception as exc:
            logger.debug("[PUBLIC-4G] get_config fallback defaults (%s)", exc)
        return clamp_public_crawl_config(cfg)

    def _persist_last_platform_sync(self, platform_name: str) -> None:
        self.last_completed_platform = platform_name
        try:
            supabase = get_supabase_client()
            supabase.table("public_crawl_config").upsert(
                {
                    "id": "default",
                    "last_completed_platform": platform_name,
                    "updated_at": _utc_now_iso(),
                },
                on_conflict="id",
            ).execute()
        except Exception as exc:
            logger.debug("[PUBLIC-4G] _persist_last_platform_sync skipped (%s)", exc)

    def _persist_pause_state_sync(
        self,
        *,
        enabled: bool | None = None,
        auto_pause_reason: str | None,
        proxy_expired_error: str | None,
    ) -> None:
        self.auto_pause_reason = auto_pause_reason
        self.proxy_expired_error = proxy_expired_error
        try:
            supabase = get_supabase_client()
            payload: dict[str, Any] = {
                "id": "default",
                "updated_at": _utc_now_iso(),
                "auto_pause_reason": auto_pause_reason,
                "proxy_expired_error": proxy_expired_error,
            }
            if enabled is not None:
                payload["enabled"] = bool(enabled)
            try:
                supabase.table("public_crawl_config").upsert(payload, on_conflict="id").execute()
            except Exception:
                # Backward-compatible fallback when migration 228 columns aren't applied yet
                fallback_payload: dict[str, Any] = {
                    "id": "default",
                    "updated_at": payload["updated_at"],
                }
                if enabled is not None:
                    fallback_payload["enabled"] = bool(enabled)
                if len(fallback_payload) > 2:
                    supabase.table("public_crawl_config").upsert(fallback_payload, on_conflict="id").execute()
        except Exception as exc:
            logger.debug("[PUBLIC-4G] _persist_pause_state_sync skipped (%s)", exc)

    def _send_proxy_expired_alert_sync(self, error_text: str) -> None:
        chat_id = (
            os.getenv("PUBLIC_CRAWL_ALERT_TELEGRAM_CHAT_ID")
            or os.getenv("TELEGRAM_ALERT_CHAT_ID")
            or ""
        ).strip()
        if not chat_id:
            return
        try:
            from app.modules.facebook.src.modules.telegram.services.telegram_service import (
                TelegramService,
            )

            TelegramService().send_message(
                chat_id=chat_id,
                text=(
                    "⚠️ [Cào FB No-Acc 4G 24/24] Đã TẠM DỪNG tự động vì Proxy 4G hết hạn / lỗi kết nối:\n"
                    f"{error_text}"
                ),
            )
        except Exception as exc:
            logger.debug("[PUBLIC-4G] Telegram proxy-expired alert skipped (%s)", exc)

    def update_config_sync(self, patch: dict[str, Any], updated_by: str | None = None) -> dict[str, Any]:
        current = self.get_config_sync()
        allowed = {
            "enabled",
            "cycle_interval_min",
            "groups_per_ip_rotate",
            "max_posts_per_group",
            "max_scrolls_per_group",
            "concurrent_sims",
            "auto_skip_private",
            "headless",
            "proxy_urls",
            "alternating_threads_enabled",
            "threads_keyword_target",
            "threads_max_posts_per_keyword",
            "threads_max_age_days",
        }
        clean_patch: dict[str, Any] = {}
        for k, v in patch.items():
            if k not in allowed or v is None:
                continue
            clean_patch[k] = v

        if "proxy_urls" in clean_patch:
            # Guard against accidental UI re-submit of masked placeholders
            raw_list = clean_patch["proxy_urls"]
            if isinstance(raw_list, list) and any("****" in str(item) for item in raw_list):
                clean_patch.pop("proxy_urls", None)
            else:
                clean_patch["proxy_urls"] = normalize_proxy_list(raw_list)

        merged = clamp_public_crawl_config(
            {**current, **clean_patch, "id": "default", "updated_at": _utc_now_iso()}
        )
        if updated_by:
            merged["updated_by"] = updated_by

        proxy_updated = "proxy_urls" in clean_patch
        re_enabled = clean_patch.get("enabled") is True
        if proxy_updated or re_enabled:
            self.auto_pause_reason = None
            self.proxy_expired_error = None
            self.rotator.reset_proxy_health()
            merged["auto_pause_reason"] = None
            merged["proxy_expired_error"] = None
        elif clean_patch.get("enabled") is False:
            self.auto_pause_reason = "manual_stop"
            merged["auto_pause_reason"] = "manual_stop"

        try:
            supabase = get_supabase_client()
            upsert_cols = allowed | {"id", "updated_at", "updated_by", "auto_pause_reason", "proxy_expired_error"}
            payload = {k: v for k, v in merged.items() if k in upsert_cols}
            try:
                supabase.table("public_crawl_config").upsert(payload, on_conflict="id").execute()
            except Exception:
                # Backward-compatible retry without migration 228/229 columns if pending
                base_only = {
                    "id",
                    "updated_at",
                    "updated_by",
                    "enabled",
                    "cycle_interval_min",
                    "groups_per_ip_rotate",
                    "max_posts_per_group",
                    "max_scrolls_per_group",
                    "concurrent_sims",
                    "auto_skip_private",
                    "headless",
                    "proxy_urls",
                }
                supabase.table("public_crawl_config").upsert(
                    {k: v for k, v in merged.items() if k in base_only},
                    on_conflict="id",
                ).execute()
        except Exception as exc:
            logger.error("[PUBLIC-4G] update_config failed: %s", exc)
            raise
        return self.get_config_sync()

    def list_groups_sync(self, *, visibility: str | None = None, limit: int = 300) -> list[dict[str, Any]]:
        supabase = get_supabase_client()
        query = (
            supabase.table("facebook_groups")
            .select(
                "id, group_name, group_url, members, visibility, public_crawl_enabled, "
                "public_crawl_interval_min, last_public_crawled_at, last_public_crawl_status, "
                "last_public_crawl_error, last_public_posts_count, chay_24h, crawl_time, created_at"
            )
            .order("created_at", desc=True)
            .limit(max(1, min(int(limit), 1000)))
        )
        if visibility in {"public", "private"}:
            query = query.eq("visibility", visibility)
        res = query.execute()
        return res.data or []

    def update_group_sync(self, group_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        supabase = get_supabase_client()
        allowed: dict[str, Any] = {}
        if patch.get("visibility") in {"public", "private"}:
            allowed["visibility"] = patch["visibility"]
        if patch.get("public_crawl_enabled") is not None:
            allowed["public_crawl_enabled"] = bool(patch["public_crawl_enabled"])
        if patch.get("public_crawl_interval_min") is not None:
            ci_lo, ci_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["cycle_interval_min"]
            allowed["public_crawl_interval_min"] = max(ci_lo, min(ci_hi, int(patch["public_crawl_interval_min"])))
        if not allowed:
            return {}
        allowed["updated_at"] = _utc_now_iso()
        res = supabase.table("facebook_groups").update(allowed).eq("id", group_id).execute()
        return res.data[0] if res.data else {}

    def bulk_toggle_groups_sync(
        self,
        *,
        group_ids: list[str],
        public_crawl_enabled: bool | None = None,
        visibility: str | None = None,
    ) -> int:
        if not group_ids:
            return 0
        patch: dict[str, Any] = {"updated_at": _utc_now_iso()}
        if public_crawl_enabled is not None:
            patch["public_crawl_enabled"] = bool(public_crawl_enabled)
        if visibility in {"public", "private"}:
            patch["visibility"] = visibility
        if len(patch) == 1:
            return 0
        supabase = get_supabase_client()
        res = supabase.table("facebook_groups").update(patch).in_("id", group_ids).execute()
        return len(res.data or [])

    def get_recent_runs_sync(self, limit: int = 12) -> list[dict[str, Any]]:
        try:
            supabase = get_supabase_client()
            res = (
                supabase.table("public_crawl_runs")
                .select("*")
                .order("started_at", desc=True)
                .limit(max(1, min(int(limit), 50)))
                .execute()
            )
            return res.data or []
        except Exception as exc:
            logger.debug("[PUBLIC-4G] get_recent_runs fallback empty (%s)", exc)
            return []

    def _select_due_groups_sync(
        self,
        *,
        group_ids: list[str] | None,
        default_interval_min: int,
        only_due: bool,
    ) -> list[dict[str, Any]]:
        supabase = get_supabase_client()
        query = supabase.table("facebook_groups").select(
            "id, group_name, group_url, visibility, public_crawl_enabled, "
            "public_crawl_interval_min, last_public_crawled_at"
        )
        if group_ids:
            query = query.in_("id", group_ids)
        else:
            query = query.eq("visibility", "public").eq("public_crawl_enabled", True)

        rows = [r for r in (query.execute().data or []) if (r.get("group_url") or "").strip()]
        if group_ids:
            return rows

        # Newly added groups (last_public_crawled_at IS NULL) always jump to head of queue, then oldest crawled first
        rows.sort(
            key=lambda r: (
                0 if not r.get("last_public_crawled_at") else 1,
                str(r.get("last_public_crawled_at") or ""),
            )
        )
        if not only_due:
            return rows

        ci_lo, ci_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["cycle_interval_min"]
        raw_interval = (
            DEFAULT_PUBLIC_CRAWL_CONFIG["cycle_interval_min"]
            if default_interval_min is None
            else int(default_interval_min)
        )
        global_interval = max(ci_lo, min(ci_hi, raw_interval))
        if global_interval <= 0:
            return rows
        now = datetime.now(timezone.utc)
        due: list[dict[str, Any]] = []
        for row in rows:
            last_raw = row.get("last_public_crawled_at")
            if not last_raw:
                due.append(row)
                continue
            try:
                last_dt = datetime.fromisoformat(str(last_raw).replace("Z", "+00:00"))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                # Always honor the configured global cycle_interval_min instead of letting SQL column DEFAULT 30 shadow UI edits
                if (now - last_dt).total_seconds() >= global_interval * 60:
                    due.append(row)
            except ValueError:
                due.append(row)

        return due

    def _create_run_record_sync(
        self,
        *,
        trigger_source: str,
        triggered_by: str | None,
        total_groups: int,
        sim_ids: list[str],
        platform: str = "facebook",
    ) -> str:
        run_id = str(uuid.uuid4())
        try:
            supabase = get_supabase_client()
            row = {
                "id": run_id,
                "trigger_source": trigger_source,
                "triggered_by": triggered_by or None,
                "status": "running",
                "started_at": _utc_now_iso(),
                "total_groups": int(total_groups),
                "sim_nodes": sim_ids,
                "platform": platform,
            }
            try:
                supabase.table("public_crawl_runs").insert(row).execute()
            except Exception:
                row.pop("platform", None)
                supabase.table("public_crawl_runs").insert(row).execute()
        except Exception as exc:
            logger.warning("[PUBLIC-4G] Could not insert public_crawl_runs row: %s", exc)
        return run_id

    def _finish_run_record_sync(
        self,
        *,
        run_id: str,
        status: str,
        duration_ms: int,
        stats: dict[str, Any],
        error_summary: str | None = None,
    ) -> None:
        try:
            supabase = get_supabase_client()
            supabase.table("public_crawl_runs").update(
                {
                    "status": status,
                    "finished_at": _utc_now_iso(),
                    "duration_ms": int(duration_ms),
                    "total_groups": int(stats.get("total_groups") or 0),
                    "groups_ok": int(stats.get("groups_ok") or 0),
                    "groups_failed": int(stats.get("groups_failed") or 0),
                    "groups_private": int(stats.get("groups_private") or 0),
                    "posts_saved": int(stats.get("posts_saved") or 0),
                    "ip_rotations": int(stats.get("ip_rotations") or 0),
                    "avg_ms_per_group": int(stats.get("avg_ms_per_group") or 0),
                    "error_summary": error_summary,
                }
            ).eq("id", run_id).execute()
        except Exception as exc:
            logger.warning("[PUBLIC-4G] Could not update public_crawl_runs row %s: %s", run_id, exc)

    @staticmethod
    def mask_config_for_api(cfg: dict[str, Any]) -> dict[str, Any]:
        """Return safe config copy for UI/API without exposing plaintext proxy passwords."""
        masked_list: list[str] = []
        raw_proxies = cfg.get("proxy_urls") or []
        if isinstance(raw_proxies, list):
            for entry in raw_proxies:
                s = str(entry or "").strip()
                if s:
                    masked_list.append(mask_proxy_url(s))
        if not masked_list:
            env_raw = os.getenv("PUBLIC_CRAWL_PROXIES", "").strip()
            if env_raw:
                try:
                    masked_list = [mask_proxy_url(u) for u in normalize_proxy_list(env_raw)]
                except ValueError:
                    pass
        safe = clamp_public_crawl_config(cfg, proxy_count=len(masked_list))
        safe["proxy_urls"] = masked_list
        safe["proxies_masked"] = masked_list
        safe["proxies_configured"] = len(masked_list)
        return safe

    async def get_status(self) -> dict[str, Any]:
        cfg = await asyncio.to_thread(self.get_config_sync)
        recent_runs = await asyncio.to_thread(self.get_recent_runs_sync, 12)
        sims = self.rotator.snapshot_nodes(cfg.get("proxy_urls"))

        is_fb_active = bool(self._task_fb and not self._task_fb.done())
        is_th_active = bool(self._task_threads and not self._task_threads.done())
        effective_running = is_fb_active or is_th_active or self.is_running
        effective_waiting = self._continuous_waiting or self._waiting_fb or self._waiting_threads

        if is_fb_active and is_th_active:
            cur_platform = "both"
        elif is_th_active:
            cur_platform = "threads"
        elif is_fb_active:
            cur_platform = "facebook"
        else:
            cur_platform = self.current_platform or "facebook"

        if is_fb_active or is_th_active:
            merged_stats = {
                "total_groups": self._stats_fb["total_groups"] + self._stats_threads["total_groups"],
                "completed_groups": self._stats_fb["completed_groups"] + self._stats_threads["completed_groups"],
                "groups_ok": self._stats_fb["groups_ok"] + self._stats_threads["groups_ok"],
                "groups_failed": self._stats_fb["groups_failed"] + self._stats_threads["groups_failed"],
                "groups_private": self._stats_fb["groups_private"] + self._stats_threads["groups_private"],
                "posts_saved": self._stats_fb["posts_saved"] + self._stats_threads["posts_saved"],
                "ip_rotations": self._stats_fb["ip_rotations"] + self._stats_threads["ip_rotations"],
                "avg_ms_per_group": self._stats["avg_ms_per_group"],
            }
        else:
            merged_stats = dict(self._stats)

        return {
            "config": self.mask_config_for_api(cfg),
            "runtime": {
                "is_running": effective_running,
                "stop_requested": self.stop_requested,
                "active_run_id": self.active_run_id_fb or self.active_run_id_threads or self.active_run_id,
                "active_run_id_fb": self.active_run_id_fb,
                "active_run_id_threads": self.active_run_id_threads,
                "started_at": self.started_at,
                "loop_round": max(self.loop_round_fb, self.loop_round_threads, self.loop_round),
                "loop_round_fb": self.loop_round_fb,
                "loop_round_threads": self.loop_round_threads,
                "last_round_finished_at": self.last_round_finished_at,
                "new_groups_detected": self.new_groups_detected,
                "auto_pause_reason": self.auto_pause_reason,
                "proxy_expired_error": self.proxy_expired_error,
                "continuous_waiting": effective_waiting,
                "current_platform": cur_platform,
                "next_platform": self.next_platform,
                "last_completed_platform": self.last_completed_platform,
                "parallel_mode": bool(is_fb_active and is_th_active),
                "facebook": {
                    "is_running": is_fb_active,
                    "active_run_id": self.active_run_id_fb,
                    "loop_round": self.loop_round_fb,
                    "waiting": self._waiting_fb,
                    **self._stats_fb,
                },
                "threads": {
                    "is_running": is_th_active,
                    "active_run_id": self.active_run_id_threads,
                    "loop_round": self.loop_round_threads,
                    "waiting": self._waiting_threads,
                    "active_threads_keywords": self.active_threads_keywords[:50],
                    "threads_keyword_meta": self.threads_keyword_meta,
                    **self._stats_threads,
                },
                "active_threads_keywords": self.active_threads_keywords[:50],
                "threads_keyword_meta": self.threads_keyword_meta,
                **merged_stats,
            },
            "sims": sims,
            "recent_runs": recent_runs,
            "logs": list(self._logs)[-80:],
        }

    def _cancel_next_round_wait(self) -> None:
        self._continuous_waiting = False
        cur: asyncio.Task[Any] | None = None
        try:
            cur = asyncio.current_task()
        except RuntimeError:
            cur = None
        if (
            self._next_round_task is not None
            and not self._next_round_task.done()
            and self._next_round_task is not cur
        ):
            self._next_round_task.cancel()
        if self._next_round_task is not cur:
            self._next_round_task = None

    def _schedule_next_continuous_round(
        self,
        *,
        keywords: list[str] | None,
        limit_groups: int | None,
        attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None,
        threads_attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        next_platform: str = "auto",
    ) -> None:
        self._cancel_next_round_wait()
        self._continuous_waiting = True
        breath_sec = _continuous_breath_seconds()

        async def _next_round_runner() -> None:
            try:
                await asyncio.sleep(breath_sec)
                self._continuous_waiting = False
                if self.stop_requested or self.is_running or self.auto_pause_reason is not None:
                    return
                fresh_cfg = await asyncio.to_thread(self.get_config_sync)
                fresh_interval = (
                    int(fresh_cfg["cycle_interval_min"])
                    if fresh_cfg.get("cycle_interval_min") is not None
                    else 0
                )
                if not fresh_cfg.get("enabled") or fresh_interval > 0:
                    self.append_log(
                        "info",
                        "orchestrator",
                        "Dừng vòng xoay 24/24 do cấu hình Auto đã tắt hoặc đổi chu kỳ nghỉ > 0 phút.",
                    )
                    return
                resolved_platform = (
                    next_platform
                    if (next_platform == "facebook" or fresh_cfg.get("alternating_threads_enabled", True))
                    else "facebook"
                )
                await self.start_run(
                    keywords=keywords,
                    trigger_source="continuous_24h",
                    only_due=False,
                    limit_groups=limit_groups,
                    attempt_fetcher=attempt_fetcher,
                    threads_attempt_fetcher=threads_attempt_fetcher,
                    continuous=True,
                    platform=resolved_platform,
                )
            except asyncio.CancelledError:
                self._continuous_waiting = False
            except Exception as exc:
                self._continuous_waiting = False
                logger.error("[PUBLIC-4G] _next_round_runner failed: %s", exc, exc_info=True)

        self._next_round_task = asyncio.create_task(_next_round_runner())

    async def start_run(
        self,
        *,
        group_ids: list[str] | None = None,
        keywords: list[str] | None = None,
        trigger_source: str = "manual",
        triggered_by: str | None = None,
        only_due: bool = False,
        limit_groups: int | None = None,
        attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        threads_attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        continuous: bool | None = None,
        platform: str = "auto",
    ) -> dict[str, Any]:
        is_fb_active = bool(self._task_fb and not self._task_fb.done())
        is_th_active = bool(self._task_threads and not self._task_threads.done())
        is_active_task = bool(self._active_task and not self._active_task.done())
        if is_fb_active and is_th_active:
            return {
                "started": False,
                "reason": "already_running",
                "active_run_id": self.active_run_id_fb or self.active_run_id_threads or self.active_run_id,
            }
        if is_active_task or (self.is_running and not (is_fb_active or is_th_active)):
            return {
                "started": False,
                "reason": "already_running",
                "active_run_id": self.active_run_id,
            }

        self._cancel_next_round_wait()

        if trigger_source == "manual":
            # User explicitly clicked Start: clear previous pause states & proxy expiry flags
            self.rotator.reset_proxy_health()
            if self.auto_pause_reason is not None or self.proxy_expired_error is not None:
                await asyncio.to_thread(
                    self._persist_pause_state_sync,
                    enabled=None,
                    auto_pause_reason=None,
                    proxy_expired_error=None,
                )

        cfg = await asyncio.to_thread(self.get_config_sync)
        cfg_interval = (
            int(cfg["cycle_interval_min"])
            if cfg.get("cycle_interval_min") is not None
            else 0
        )
        effective_only_due = False if cfg_interval <= 0 else only_due

        sims = self.rotator.sync_nodes(cfg.get("proxy_urls"))
        allow_direct = os.getenv("PUBLIC_CRAWL_ALLOW_DIRECT_NO_PROXY", "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        if not sims:
            if not allow_direct and attempt_fetcher is None and threads_attempt_fetcher is None:
                return {
                    "started": False,
                    "reason": "no_rotating_proxy_configured",
                    "message": (
                        "Chưa cấu hình proxy xoay nào trong DB (`proxy_urls`) hoặc `PUBLIC_CRAWL_PROXIES`. "
                        "Vui lòng dán proxy dạng `host:port:user:pass` vào ô Pool Proxy Xoay rồi bấm Lưu."
                    ),
                }
            sims = [SimNodeRuntime(id="direct-local", label="Direct Guest (Dev)", status="idle")]

        # Check if we have dedicated proxies for both platforms to run in parallel
        fb_sims = [s for s in sims if getattr(s, "platform", None) == "facebook"]
        threads_sims = [s for s in sims if getattr(s, "platform", None) == "threads"]
        can_run_parallel = bool(fb_sims and threads_sims) and not group_ids and not keywords

        if can_run_parallel and platform in {"auto", "both"}:
            is_continuous = (
                bool(not group_ids and cfg.get("enabled") and cfg_interval == 0)
                if continuous is None
                else bool(continuous and not group_ids)
            )

            self.stop_requested = False
            self.is_running = True
            self.started_at = _utc_now_iso()
            self.current_platform = "both"

            self.append_log(
                "info",
                "orchestrator",
                (
                    f"🚀 [CHẠY SONG SONG 24/24] Kích hoạt đồng thời 2 luồng độc lập: "
                    f"Proxy FB #01 ({fb_sims[0].id} :4434) quét nhóm Facebook Public ⟷ "
                    f"Proxy Threads #02 ({threads_sims[0].id} :4554) quét 30 từ khóa Threads No-Acc!"
                ),
            )

            if not is_fb_active:
                self._task_fb = asyncio.create_task(
                    self._run_platform_continuous_loop(
                        platform="facebook",
                        active_sims=fb_sims,
                        config=cfg,
                        group_ids=None,
                        keywords=None,
                        limit_groups=limit_groups,
                        attempt_fetcher=attempt_fetcher,
                        continuous=is_continuous,
                        trigger_source=trigger_source,
                        triggered_by=triggered_by,
                        only_due=effective_only_due,
                    )
                )

            if not is_th_active:
                self._task_threads = asyncio.create_task(
                    self._run_platform_continuous_loop(
                        platform="threads",
                        active_sims=threads_sims,
                        config=cfg,
                        group_ids=None,
                        keywords=None,
                        limit_groups=limit_groups,
                        threads_attempt_fetcher=threads_attempt_fetcher,
                        continuous=is_continuous,
                        trigger_source=trigger_source,
                        triggered_by=triggered_by,
                        only_due=False,
                    )
                )

            return {
                "started": True,
                "mode": "parallel",
                "platforms": ["facebook", "threads"],
                "current_platform": "both",
                "continuous": is_continuous,
                "sim_nodes": [s.id for s in (fb_sims + threads_sims)],
            }

        alternating_enabled = bool(cfg.get("alternating_threads_enabled", True))
        if group_ids:
            target_platform = "facebook"
        elif platform in {"facebook", "threads"}:
            target_platform = platform
        else:
            prev_completed = self.last_completed_platform or cfg.get("last_completed_platform")
            if alternating_enabled and prev_completed == "facebook":
                target_platform = "threads"
            else:
                target_platform = "facebook"

        groups: list[dict[str, Any]] = []
        threads_keywords: list[str] = []
        new_groups_count = 0

        if target_platform == "facebook":
            groups = await asyncio.to_thread(
                self._select_due_groups_sync,
                group_ids=group_ids,
                default_interval_min=cfg_interval,
                only_due=effective_only_due,
            )
            if limit_groups is not None and limit_groups > 0 and not group_ids:
                groups = groups[:limit_groups]
            if not groups:
                if platform == "auto" and alternating_enabled:
                    target_platform = "threads"
                else:
                    return {
                        "started": False,
                        "reason": "no_eligible_groups",
                        "message": "Không có nhóm Public nào cần cào lúc này.",
                    }
            else:
                new_groups_count = sum(1 for g in groups if not g.get("last_public_crawled_at"))

        if target_platform == "threads":
            explicit_kws = [str(k).strip() for k in (keywords or []) if str(k).strip()]
            if explicit_kws:
                threads_keywords = explicit_kws
                self.active_threads_keywords = [
                    {"keyword": kw, "times_used": 0, "total_posts_found": 0, "high_score_posts": 0}
                    for kw in threads_keywords
                ]
                self.threads_keyword_meta = {
                    "total_active": len(threads_keywords),
                    "selected_count": len(threads_keywords),
                    "newly_generated": 0,
                    "deactivated": [],
                    "ai_powered": False,
                    "manual_keywords": True,
                }
            else:
                from app.modules.all_platform.services.threads_keyword_service import (
                    evolve_and_select_keywords,
                )

                kw_lo, kw_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["threads_keyword_target"]
                kw_target = max(kw_lo, min(kw_hi, int(cfg.get("threads_keyword_target") or 30)))
                evolved = await evolve_and_select_keywords(target_count=kw_target, rotate_replace_count=6)
                threads_keywords = evolved.get("keywords") or []
                meta = evolved.get("meta") or {}
                self.active_threads_keywords = list(meta.get("items") or [])
                self.threads_keyword_meta = {k: v for k, v in meta.items() if k != "items"}
            if limit_groups is not None and limit_groups > 0:
                threads_keywords = threads_keywords[:limit_groups]
            if not threads_keywords:
                return {
                    "started": False,
                    "reason": "no_threads_keywords",
                    "message": "Không có từ khóa Threads nào để chạy.",
                }

        work_items: list[dict[str, Any]] = (
            [{"kind": "threads", "keyword": kw} for kw in threads_keywords]
            if target_platform == "threads"
            else [{"kind": "facebook", "group": g} for g in groups]
        )

        if continuous is None:
            is_continuous = bool(not group_ids and cfg.get("enabled") and cfg_interval == 0)
        else:
            is_continuous = bool(continuous and not group_ids)

        # Select active proxy nodes dedicated to target_platform (or fallback to shared/all)
        platform_sims = [s for s in sims if getattr(s, "platform", None) == target_platform]
        if not platform_sims:
            platform_sims = [s for s in sims if not getattr(s, "platform", None)] or sims

        _, max_sims_bound = PUBLIC_CRAWL_CONFIG_BOUNDS["concurrent_sims"]
        max_lanes = max(1, min(len(platform_sims), max_sims_bound, int(cfg.get("concurrent_sims") or len(platform_sims))))
        active_sims = platform_sims[:max_lanes]
        for s in active_sims:
            s.groups_in_epoch = 0

        self.loop_round += 1
        self.new_groups_detected = new_groups_count
        self.current_platform = target_platform
        self.next_platform = (
            ("threads" if target_platform == "facebook" else "facebook")
            if alternating_enabled
            else "facebook"
        )
        self._continuous_attempt_fetcher = attempt_fetcher if is_continuous else None
        self._continuous_threads_fetcher = threads_attempt_fetcher if is_continuous else None
        self._continuous_keywords = keywords if is_continuous else None
        self._continuous_limit_groups = limit_groups if is_continuous else None

        self.is_running = True
        self.stop_requested = False
        self.started_at = _utc_now_iso()
        self._stats = {
            "total_groups": len(work_items),
            "completed_groups": 0,
            "groups_ok": 0,
            "groups_failed": 0,
            "groups_private": 0,
            "posts_saved": 0,
            "ip_rotations": 0,
            "avg_ms_per_group": 0,
        }
        self.active_run_id = await asyncio.to_thread(
            self._create_run_record_sync,
            trigger_source=trigger_source,
            triggered_by=triggered_by,
            total_groups=len(work_items),
            sim_ids=[s.id for s in active_sims],
            platform=target_platform,
        )

        mode_note = f"Vòng #{self.loop_round} · 24/24 luân phiên" if is_continuous else f"Vòng #{self.loop_round}"
        if target_platform == "threads":
            ai_added = int(self.threads_keyword_meta.get("newly_generated") or 0)
            deactivated_n = len(self.threads_keyword_meta.get("deactivated") or [])
            ai_note = (
                f" | AI biến đổi: +{ai_added} mới, loại {deactivated_n} từ yếu"
                if (ai_added or deactivated_n)
                else ""
            )
            self.append_log(
                "info",
                "orchestrator",
                (
                    f"[{mode_note} · THREADS NO-ACC] Bắt đầu quét {len(threads_keywords)} từ khóa AI "
                    f"qua {len(active_sims)} luồng Proxy Xoay ({', '.join(s.id for s in active_sims)}){ai_note}"
                ),
            )
        else:
            new_note = f" ({new_groups_count} nhóm mới chưa từng cào)" if new_groups_count > 0 else ""
            self.append_log(
                "info",
                "orchestrator",
                (
                    f"[{mode_note} · FACEBOOK PUBLIC] Bắt đầu cào {len(groups)} nhóm Public{new_note} "
                    f"qua {len(active_sims)} luồng Proxy Xoay ({', '.join(s.id for s in active_sims)}) — 0 Cookie"
                ),
            )

        self._active_task = asyncio.create_task(
            self._execute_run_task(
                run_id=self.active_run_id,
                platform=target_platform,
                work_items=work_items,
                active_sims=active_sims,
                config=cfg,
                keywords=keywords,
                attempt_fetcher=attempt_fetcher,
                threads_attempt_fetcher=threads_attempt_fetcher,
                continuous=is_continuous,
                limit_groups=limit_groups,
            )
        )
        return {
            "started": True,
            "run_id": self.active_run_id,
            "platform": target_platform,
            "next_platform": self.next_platform,
            "loop_round": self.loop_round,
            "continuous": is_continuous,
            "new_groups_detected": new_groups_count,
            "total_groups": len(work_items),
            "sim_nodes": [s.id for s in active_sims],
        }

    async def _run_platform_continuous_loop(
        self,
        *,
        platform: str,
        active_sims: list[SimNodeRuntime],
        config: dict[str, Any],
        group_ids: list[str] | None = None,
        keywords: list[str] | None = None,
        limit_groups: int | None = None,
        attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        threads_attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        continuous: bool = True,
        trigger_source: str = "manual",
        triggered_by: str | None = None,
        only_due: bool = False,
    ) -> None:
        """Independent 24/7 continuous loop for a single platform lane in parallel mode."""
        loop_counter = 0
        try:
            while not self.stop_requested:
                loop_counter += 1
                cfg = await asyncio.to_thread(self.get_config_sync)
                cfg_interval = int(cfg.get("cycle_interval_min") or 0)
                if not cfg.get("enabled") or self.auto_pause_reason is not None:
                    break
                if all(s.status == "expired" for s in active_sims):
                    self.append_log(
                        "error",
                        "orchestrator",
                        f"Proxy cho {platform} đã hết hạn hoặc lỗi kết nối. Tạm dừng luồng {platform}.",
                    )
                    break

                work_items: list[dict[str, Any]] = []
                if platform == "facebook":
                    self.loop_round_fb += 1
                    groups = await asyncio.to_thread(
                        self._select_due_groups_sync,
                        group_ids=group_ids,
                        default_interval_min=cfg_interval,
                        only_due=False if cfg_interval <= 0 else only_due,
                    )
                    if limit_groups and limit_groups > 0:
                        groups = groups[:limit_groups]
                    if not groups:
                        self.append_log(
                            "info",
                            "orchestrator",
                            "[FB Song Song] Chưa có nhóm Public nào cần cào lúc này, nghỉ chờ vòng sau...",
                        )
                        if not continuous or self.stop_requested:
                            break
                        self._waiting_fb = True
                        try:
                            await asyncio.sleep(_continuous_breath_seconds())
                        finally:
                            self._waiting_fb = False
                        continue
                    work_items = [{"kind": "facebook", "group": g} for g in groups]
                else:
                    self.loop_round_threads += 1
                    explicit_kws = [str(k).strip() for k in (keywords or []) if str(k).strip()]
                    if explicit_kws:
                        threads_keywords = explicit_kws
                        self.active_threads_keywords = [
                            {"keyword": kw, "times_used": 0, "total_posts_found": 0, "high_score_posts": 0}
                            for kw in threads_keywords
                        ]
                    else:
                        from app.modules.all_platform.services.threads_keyword_service import (
                            evolve_and_select_keywords,
                        )
                        kw_lo, kw_hi = PUBLIC_CRAWL_CONFIG_BOUNDS["threads_keyword_target"]
                        kw_target = max(kw_lo, min(kw_hi, int(cfg.get("threads_keyword_target") or 30)))
                        evolved = await evolve_and_select_keywords(target_count=kw_target, rotate_replace_count=6)
                        threads_keywords = evolved.get("keywords") or []
                        meta = evolved.get("meta") or {}
                        self.active_threads_keywords = list(meta.get("items") or [])
                        self.threads_keyword_meta = {k: v for k, v in meta.items() if k != "items"}
                    if limit_groups and limit_groups > 0:
                        threads_keywords = threads_keywords[:limit_groups]
                    if not threads_keywords:
                        self.append_log(
                            "info",
                            "orchestrator",
                            "[Threads Song Song] Chưa có từ khóa Threads nào, nghỉ chờ vòng sau...",
                        )
                        if not continuous or self.stop_requested:
                            break
                        self._waiting_threads = True
                        try:
                            await asyncio.sleep(_continuous_breath_seconds())
                        finally:
                            self._waiting_threads = False
                        continue
                    work_items = [{"kind": "threads", "keyword": kw} for kw in threads_keywords]

                run_id = await asyncio.to_thread(
                    self._create_run_record_sync,
                    trigger_source=trigger_source if loop_counter == 1 else "continuous_24h",
                    triggered_by=triggered_by,
                    total_groups=len(work_items),
                    sim_ids=[s.id for s in active_sims],
                    platform=platform,
                )
                if platform == "facebook":
                    self.active_run_id_fb = run_id
                else:
                    self.active_run_id_threads = run_id

                cur_round = self.loop_round_fb if platform == "facebook" else self.loop_round_threads
                mode_str = f"Vòng #{cur_round} · Song Song 24/24" if continuous else f"Vòng #{cur_round}"
                sim_labels = ", ".join(s.label for s in active_sims)
                if platform == "threads":
                    self.append_log(
                        "info",
                        "orchestrator",
                        f"[{mode_str} · THREADS (Song Song)] Bắt đầu quét {len(work_items)} từ khóa AI qua {sim_labels} — 0 Cookie",
                    )
                else:
                    self.append_log(
                        "info",
                        "orchestrator",
                        f"[{mode_str} · FACEBOOK (Song Song)] Bắt đầu cào {len(work_items)} nhóm Public qua {sim_labels} — 0 Cookie",
                    )

                stats_target = self._stats_fb if platform == "facebook" else self._stats_threads
                stats_target["total_groups"] = len(work_items)
                stats_target["completed_groups"] = 0
                stats_target["groups_ok"] = 0
                stats_target["groups_failed"] = 0
                stats_target["groups_private"] = 0
                stats_target["posts_saved"] = 0
                stats_target["ip_rotations"] = 0

                await self._execute_run_task(
                    run_id=run_id,
                    platform=platform,
                    work_items=work_items,
                    active_sims=active_sims,
                    config=cfg,
                    keywords=keywords,
                    attempt_fetcher=attempt_fetcher,
                    threads_attempt_fetcher=threads_attempt_fetcher,
                    continuous=False,
                    limit_groups=limit_groups,
                    stats_target=stats_target,
                    round_idx=cur_round,
                )

                if not continuous or self.stop_requested or not cfg.get("enabled"):
                    break

                breath = _continuous_breath_seconds()
                p_name = "Threads" if platform == "threads" else "Facebook"
                self.append_log(
                    "info",
                    "orchestrator",
                    f"🔄 [{p_name} Song Song] Hoàn tất Vòng #{cur_round}. Tự động tiếp tục Vòng #{cur_round + 1} sau {breath:.1f}s...",
                )
                if platform == "facebook":
                    self._waiting_fb = True
                else:
                    self._waiting_threads = True
                try:
                    await asyncio.sleep(breath)
                finally:
                    if platform == "facebook":
                        self._waiting_fb = False
                    else:
                        self._waiting_threads = False
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("[PUBLIC-4G] Lane %s error: %s", platform, exc, exc_info=True)
            self.append_log("error", "orchestrator", f"Lỗi luồng {platform}: {exc}")
        finally:
            if platform == "facebook":
                self.active_run_id_fb = None
            else:
                self.active_run_id_threads = None
            is_fb = bool(self._task_fb and not self._task_fb.done())
            is_th = bool(self._task_threads and not self._task_threads.done())
            if not is_fb and not is_th:
                self.is_running = False

    async def _execute_run_task(
        self,
        *,
        run_id: str,
        platform: str,
        work_items: list[dict[str, Any]],
        active_sims: list[SimNodeRuntime],
        config: dict[str, Any],
        keywords: list[str] | None,
        attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None,
        threads_attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None = None,
        continuous: bool = False,
        limit_groups: int | None = None,
        stats_target: dict[str, Any] | None = None,
        round_idx: int | None = None,
    ) -> None:
        t0 = time.perf_counter()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        for item in work_items:
            queue.put_nowait(item)

        elapsed_samples: list[int] = []
        run_error: str | None = None

        async def _sim_lane(sim: SimNodeRuntime) -> None:
            try:
                async with GuestPublicGroupWorker(
                    sim=sim,
                    rotator=self.rotator,
                    config=config,
                    log_cb=self.append_log,
                    stop_check=lambda: self.stop_requested,
                    progress_cb=self._bump_progress,
                    keywords=keywords,
                    attempt_fetcher=attempt_fetcher,
                    threads_attempt_fetcher=threads_attempt_fetcher,
                    run_id=run_id,
                ) as worker:
                    # Clean platform handoff on shared proxy: probe fresh IP status once when switching platform
                    if (
                        self.last_completed_platform is not None
                        and self.last_completed_platform != platform
                        and sim.socks_url
                        and not self.stop_requested
                    ):
                        probe_res = await self.rotator.refresh_egress_ip(
                            sim.id,
                            proxy_urls=config.get("proxy_urls") or [sim.socks_url],
                            log_cb=self.append_log,
                        )
                        if probe_res.get("ip_changed"):
                            self._bump_progress({"ip_rotations": 1})

                    while not self.stop_requested and sim.status != "expired":
                        try:
                            work_item = queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        try:
                            if work_item.get("kind") == "threads":
                                res = await worker.process_threads_keyword(str(work_item.get("keyword") or ""))
                            else:
                                res = await worker.process_group(work_item["group"])
                            elapsed_samples.append(int(res.get("elapsed_ms") or 0))
                            st_dict = stats_target if stats_target is not None else self._stats
                            st_dict["completed_groups"] += 1
                            st = res.get("status")
                            if st in {"ok", "rotated_retry"}:
                                st_dict["groups_ok"] += 1
                            elif st == "private_skipped":
                                st_dict["groups_private"] += 1
                            else:
                                st_dict["groups_failed"] += 1
                            st_dict["posts_saved"] += int(res.get("posts_saved") or 0)
                            if elapsed_samples:
                                st_dict["avg_ms_per_group"] = int(
                                    sum(elapsed_samples) / len(elapsed_samples)
                                )
                            if stats_target is not None:
                                self._stats["completed_groups"] += 1
                                self._stats["posts_saved"] += int(res.get("posts_saved") or 0)
                                if st in {"ok", "rotated_retry"}:
                                    self._stats["groups_ok"] += 1
                                elif st == "private_skipped":
                                    self._stats["groups_private"] += 1
                                else:
                                    self._stats["groups_failed"] += 1
                            if res.get("proxy_expired") or sim.status == "expired":
                                break
                        except Exception as exc:
                            logger.error("[PUBLIC-4G] Worker %s item failure: %s", sim.id, exc, exc_info=True)
                            st_dict = stats_target if stats_target is not None else self._stats
                            st_dict["completed_groups"] += 1
                            st_dict["groups_failed"] += 1
                            if stats_target is not None:
                                self._stats["completed_groups"] += 1
                                self._stats["groups_failed"] += 1
                        finally:
                            queue.task_done()
            except Exception as exc:
                nonlocal run_error
                run_error = str(exc)
                sim.status = "expired" if is_proxy_expired_error(run_error) else "error"
                sim.last_error = run_error
                self.append_log("error", sim.id, f"[SIM {sim.id}] Lỗi khởi tạo worker: {run_error}")
            finally:
                if sim.status not in {"error", "expired"}:
                    sim.status = "idle"

        all_proxies_expired = False
        expired_reason_msg: str | None = None
        should_continue_loop = False
        user_stopped = False
        scheduled_next_platform = "facebook"

        try:
            await asyncio.gather(*[_sim_lane(s) for s in active_sims])
        finally:
            total_ms = int((time.perf_counter() - t0) * 1000)
            user_stopped = bool(self.stop_requested)
            all_proxies_expired = bool(active_sims) and all(s.status == "expired" for s in active_sims)
            if all_proxies_expired:
                expired_reason_msg = next(
                    (s.last_error for s in active_sims if s.last_error),
                    "Tất cả Proxy 4G đã hết hạn hoặc lỗi kết nối.",
                )

            final_status = (
                "stopped"
                if user_stopped
                else ("failed" if (run_error or all_proxies_expired) else "completed")
            )
            final_stats = dict(stats_target or self._stats)
            await asyncio.to_thread(
                self._finish_run_record_sync,
                run_id=run_id,
                status=final_status,
                duration_ms=total_ms,
                stats=final_stats,
                error_summary=expired_reason_msg or run_error,
            )
            self.last_round_finished_at = _utc_now_iso()
            platform_tag = "Threads" if platform == "threads" else "Facebook"
            unit_note = "Từ khóa OK" if platform == "threads" else f"{final_stats['groups_private']} Private"
            effective_round = round_idx if round_idx is not None else self.loop_round
            self.append_log(
                "error" if all_proxies_expired else "info",
                "orchestrator",
                (
                    f"Kết thúc Vòng #{effective_round} [{platform_tag}] ({final_status}): "
                    f"{final_stats['groups_ok']} OK ({unit_note}), {final_stats['groups_failed']} Lỗi, "
                    f"+{final_stats['posts_saved']} bài mới, {final_stats['ip_rotations']} lần xoay IP 4G ({total_ms}ms)."
                ),
            )
            try:
                await manager.broadcast(
                    {
                        "event": "public_4g_run_finished",
                        "run_id": run_id,
                        "platform": platform,
                        "loop_round": effective_round,
                        "status": final_status,
                        "posts_saved": final_stats["posts_saved"],
                        "groups_ok": final_stats["groups_ok"],
                    }
                )
            except Exception:
                pass

            if all_proxies_expired:
                await asyncio.to_thread(
                    self._persist_pause_state_sync,
                    enabled=False,
                    auto_pause_reason="proxy_expired",
                    proxy_expired_error=expired_reason_msg,
                )
                self.append_log(
                    "error",
                    "orchestrator",
                    f"DỪNG KHẨN CẤP AUTO 24/24: Tất cả Proxy 4G hết hạn / chết ({expired_reason_msg}). Hãy cập nhật proxy mới rồi bật lại.",
                )
                try:
                    await manager.broadcast(
                        {
                            "event": "public_4g_proxy_expired",
                            "run_id": run_id,
                            "loop_round": effective_round,
                            "error": expired_reason_msg,
                        }
                    )
                except Exception:
                    pass
                asyncio.create_task(
                    asyncio.to_thread(self._send_proxy_expired_alert_sync, expired_reason_msg or "")
                )
            elif not user_stopped:
                await asyncio.to_thread(self._persist_last_platform_sync, platform)
                fresh_cfg = await asyncio.to_thread(self.get_config_sync)
                alternating = bool(fresh_cfg.get("alternating_threads_enabled", True))
                scheduled_next_platform = (
                    ("threads" if platform == "facebook" else "facebook")
                    if alternating
                    else "facebook"
                )
                self.next_platform = scheduled_next_platform
                fresh_interval = (
                    int(fresh_cfg["cycle_interval_min"])
                    if fresh_cfg.get("cycle_interval_min") is not None
                    else 0
                )
                if continuous and fresh_cfg.get("enabled") and fresh_interval == 0 and self.auto_pause_reason is None:
                    should_continue_loop = True

            if stats_target is None:
                self.is_running = False
                self.stop_requested = False

        if should_continue_loop and stats_target is None:
            breath = _continuous_breath_seconds()
            next_label = "Threads (~từ khóa AI)" if scheduled_next_platform == "threads" else "Facebook Public (reload nhóm DB)"
            self.append_log(
                "info",
                "orchestrator",
                f"🔄 Chuyển pha 24/24: Chuẩn bị chạy {next_label} ở Vòng #{self.loop_round + 1} sau {breath:.1f}s...",
            )
            self._schedule_next_continuous_round(
                keywords=keywords,
                limit_groups=limit_groups,
                attempt_fetcher=attempt_fetcher,
                threads_attempt_fetcher=threads_attempt_fetcher,
                next_platform=scheduled_next_platform,
            )

    def request_stop(self) -> dict[str, Any]:
        was_waiting = (
            self._continuous_waiting
            or self._waiting_fb
            or self._waiting_threads
            or (self._next_round_task is not None and not self._next_round_task.done())
        )
        self._cancel_next_round_wait()
        self._continuous_attempt_fetcher = None
        self._continuous_threads_fetcher = None

        is_fb_active = bool(self._task_fb and not self._task_fb.done())
        is_th_active = bool(self._task_threads and not self._task_threads.done())
        is_active = self.is_running or is_fb_active or is_th_active

        if not is_active and not was_waiting:
            return {"stopped": False, "message": "Không có phiên cào Public 4G nào đang chạy."}

        self.stop_requested = True
        if self._task_fb and not self._task_fb.done():
            self._task_fb.cancel()
        if self._task_threads and not self._task_threads.done():
            self._task_threads.cancel()
        if self._active_task and not self._active_task.done():
            self._active_task.cancel()

        self.is_running = False
        self._persist_pause_state_sync(
            enabled=False,
            auto_pause_reason="manual_stop",
            proxy_expired_error=None,
        )
        self.append_log(
            "warn",
            "orchestrator",
            "Đã nhận lệnh DỪNG từ người dùng — dừng sau nhóm hiện tại & tạm tắt Auto 24/24.",
        )
        return {
            "stopped": True,
            "active_run_id": self.active_run_id_fb or self.active_run_id_threads or self.active_run_id,
        }

    async def maybe_trigger_scheduled_run(self, *, trigger_source: str = "scheduler") -> dict[str, Any] | None:
        """Called on app startup & every minute by APScheduler when continuous auto-crawl is enabled."""
        if self.is_running or self._continuous_waiting:
            return None
        cfg = await asyncio.to_thread(self.get_config_sync)
        if not cfg.get("enabled"):
            return None
        if self.auto_pause_reason in {"proxy_expired", "manual_stop"}:
            return None
        cfg_interval = (
            int(cfg["cycle_interval_min"])
            if cfg.get("cycle_interval_min") is not None
            else 0
        )
        return await self.start_run(
            trigger_source=trigger_source,
            only_due=cfg_interval > 0,
            continuous=(cfg_interval == 0),
        )


public_crawl_orchestrator = PublicCrawlOrchestrator()
