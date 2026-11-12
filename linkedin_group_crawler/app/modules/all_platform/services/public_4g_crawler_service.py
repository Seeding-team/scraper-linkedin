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
import logging
import os
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.mobile_proxy.client import console_request
from app.modules.all_platform.mobile_proxy.config import (
    build_node_config,
    node_console_targets,
)
from app.modules.all_platform.services.fb_story_parser import (
    classify_guest_page_state,
    extract_post_id_from_url,
    normalize_group_crawl_url,
    parse_fb_graphql_text,
    parse_fb_html_embedded_stories,
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
    resolve_socks_url_for_node,
    rewrite_proxy_url_for_runtime,
)
from app.modules.all_platform.websocket import manager

logger = logging.getLogger(__name__)

_VIETNAM_TZ = timezone(timedelta(hours=7))

DEFAULT_PUBLIC_CRAWL_CONFIG: dict[str, Any] = {
    "id": "default",
    "enabled": False,
    "cycle_interval_min": 15,
    "groups_per_ip_rotate": 6,
    "max_posts_per_group": 25,
    "max_scrolls_per_group": 2,
    "concurrent_sims": 2,
    "auto_skip_private": True,
    "headless": True,
}

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


def _extract_ip_from_console_payload(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in ("egressIp", "directMobileIp", "publicIp", "public_ip", "ip"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


@dataclass
class SimNodeRuntime:
    id: str
    label: str
    socks_url: str | None = None
    console_url: str | None = None
    api_key: str | None = None
    status: str = "idle"  # idle | crawling | rotating | error
    epoch: int = 0
    groups_in_epoch: int = 0
    total_groups: int = 0
    total_rotations: int = 0
    last_egress_ip: str | None = None
    last_rotated_at: str | None = None
    last_error: str | None = None
    raw_node: dict[str, Any] = field(default_factory=dict)

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "hasSocks": bool(self.socks_url),
            "hasConsole": bool(self.console_url),
            "status": self.status,
            "epoch": self.epoch,
            "groups_in_epoch": self.groups_in_epoch,
            "total_groups": self.total_groups,
            "total_rotations": self.total_rotations,
            "last_egress_ip": self.last_egress_ip,
            "last_rotated_at": self.last_rotated_at,
            "last_error": self.last_error,
        }


class MobileProxyRotator:
    """Thread/async-safe controller around `mobile_proxy` SIM nodes."""

    def __init__(
        self,
        *,
        console_fn: Callable[..., Awaitable[Any]] = console_request,
        probe_fn: Callable[..., Awaitable[dict[str, Any]]] = probe_proxy_egress,
    ) -> None:
        self._console_fn = console_fn
        self._probe_fn = probe_fn
        self._locks: dict[str, asyncio.Lock] = {}
        self._states: dict[str, SimNodeRuntime] = {}

    def _lock_for(self, node_id: str) -> asyncio.Lock:
        if node_id not in self._locks:
            self._locks[node_id] = asyncio.Lock()
        return self._locks[node_id]

    def sync_nodes(self) -> list[SimNodeRuntime]:
        """Load active node definitions dynamically from `mobile_proxy.config`."""
        cfg = build_node_config()
        targets_by_id = {t["id"]: t for t in node_console_targets()}
        runtimes: list[SimNodeRuntime] = []
        active_ids: set[str] = set()

        for raw in cfg.get("nodes") or []:
            node_id = str(raw.get("id") or "").strip()
            if not node_id:
                continue
            target = targets_by_id.get(node_id) or {}
            env_prefix = "MOBILE_PROXY_" + node_id.upper().replace("-", "_") + "_"
            has_explicit_local = bool(
                os.getenv("MOBILE_PROXY_SOCKS_URL_LOCAL_PC", "").strip()
                or os.getenv(f"{env_prefix}SOCKS_URL_LOCAL_PC", "").strip()
            )
            has_real_config = bool(
                raw.get("socksUrlVps")
                or raw.get("socksUrlOffice")
                or raw.get("consoleUrl")
                or target.get("consoleUrl")
                or has_explicit_local
            )
            if not has_real_config:
                continue
            socks_url = resolve_socks_url_for_node(raw)
            raw_console_url = (raw.get("consoleUrl") or target.get("consoleUrl") or "").strip() or None
            console_url = rewrite_proxy_url_for_runtime(raw_console_url)
            if not socks_url and not console_url:
                continue
            active_ids.add(node_id)
            api_key = target.get("apiKey")
            existing = self._states.get(node_id)
            if existing is None:
                existing = SimNodeRuntime(
                    id=node_id,
                    label=str(raw.get("label") or node_id),
                    socks_url=socks_url,
                    console_url=console_url,
                    api_key=api_key,
                    raw_node=raw,
                )
                self._states[node_id] = existing
            else:
                existing.label = str(raw.get("label") or node_id)
                existing.socks_url = socks_url
                existing.console_url = console_url
                existing.api_key = api_key
                existing.raw_node = raw
            runtimes.append(existing)

        for stale_id in list(self._states):
            if stale_id not in active_ids:
                self._states.pop(stale_id, None)

        return runtimes

    def snapshot_nodes(self) -> list[dict[str, Any]]:
        return [s.to_public_dict() for s in self.sync_nodes()]

    async def rotate_node(
        self,
        node_id: str,
        *,
        reason: str = "scheduled",
        log_cb: Callable[[str, str, str], None] | None = None,
    ) -> dict[str, Any]:
        """Serialize rotation per SIM via lock, rotate 4G IP via console API, verify egress."""
        self.sync_nodes()
        state = self._states.get(node_id)
        if state is None:
            return {"ok": False, "node_id": node_id, "error": f"Unknown SIM node '{node_id}'"}

        async with self._lock_for(node_id):
            prev_status = state.status
            state.status = "rotating"
            state.last_error = None
            if log_cb:
                log_cb("info", node_id, f"[SIM {node_id}] Đang xoay IP 4G ({reason})...")
            try:
                if not state.console_url:
                    raise RuntimeError(f"SIM '{node_id}' chưa cấu hình MOBILE_PROXY_CONSOLE_URL")

                settle_sec = float(os.getenv("PUBLIC_CRAWL_ROTATE_SETTLE_SEC", "1.5") or "0")
                rotate_res: Any = None
                for attempt in range(2):
                    try:
                        rotate_res = await self._console_fn(
                            "POST",
                            "/api/rotate",
                            state.console_url,
                            state.api_key,
                            timeout=90.0,
                        )
                        if isinstance(rotate_res, dict) and rotate_res.get("ok") is False:
                            err_detail = (
                                rotate_res.get("error")
                                or rotate_res.get("message")
                                or "Console API trả về ok=false"
                            )
                            raise RuntimeError(str(err_detail))
                        break
                    except Exception:
                        if attempt == 0:
                            if settle_sec > 0:
                                await asyncio.sleep(min(2.0, settle_sec + 0.5))
                            continue
                        raise

                new_ip = _extract_ip_from_console_payload(rotate_res)
                if settle_sec > 0:
                    await asyncio.sleep(settle_sec)

                # If console rotate payload didn't return egress IP, probe through SOCKS5
                if not new_ip and state.socks_url:
                    for probe_idx in range(2):
                        probe = await self._probe_fn(state.socks_url, timeout=8.0)
                        new_ip = probe.get("egressIp")
                        if new_ip or probe_idx == 1:
                            break
                        if settle_sec > 0:
                            await asyncio.sleep(1.5)

                state.epoch += 1
                state.groups_in_epoch = 0
                state.total_rotations += 1
                state.last_egress_ip = new_ip or state.last_egress_ip
                state.last_rotated_at = _utc_now_iso()
                state.status = "idle"

                if log_cb:
                    log_cb(
                        "success",
                        node_id,
                        f"[SIM {node_id}] Xoay IP xong (epoch #{state.epoch}) -> IP: {new_ip or 'N/A'}",
                    )
                return {
                    "ok": True,
                    "node_id": node_id,
                    "egress_ip": new_ip,
                    "epoch": state.epoch,
                    "raw": rotate_res,
                }
            except Exception as exc:
                err_msg = str(getattr(exc, "detail", exc))
                state.last_error = err_msg
                state.status = prev_status if prev_status != "rotating" else "error"
                if log_cb:
                    log_cb("error", node_id, f"[SIM {node_id}] Lỗi xoay IP: {err_msg}")
                return {"ok": False, "node_id": node_id, "error": err_msg}

    async def test_proxy(
        self,
        node_id: str | None = None,
        *,
        do_rotate: bool = False,
    ) -> dict[str, Any]:
        """Diagnose console reachability + SOCKS5 tunnel egress (+ optional live rotation)."""
        nodes = self.sync_nodes()
        selected = [n for n in nodes if (not node_id or n.id == node_id)]
        if not selected:
            return {
                "ok": False,
                "results": [],
                "error": "Chưa cấu hình node SIM 4G nào trong MOBILE_PROXY_NODES.",
            }

        results: list[dict[str, Any]] = []
        for sim in selected:
            entry: dict[str, Any] = {
                "id": sim.id,
                "label": sim.label,
                "consoleUrl": sim.console_url,
                "socksUrl": sim.socks_url,
                "consoleOk": False,
                "socksOk": False,
                "egressIpBefore": None,
                "egressIpAfter": None,
                "ipChanged": False,
                "latencyMs": None,
                "rotated": False,
                "error": None,
            }
            # 1. Check console /api/status
            if sim.console_url:
                try:
                    status_data = await self._console_fn(
                        "GET", "/api/status", sim.console_url, sim.api_key, timeout=15.0
                    )
                    entry["consoleOk"] = True
                    entry["egressIpBefore"] = _extract_ip_from_console_payload(status_data)
                    if not sim.socks_url and isinstance(status_data, dict):
                        proxy_url = (status_data.get("proxy") or {}).get("url")
                        sim.socks_url = rewrite_proxy_url_for_runtime(proxy_url)
                        entry["socksUrl"] = sim.socks_url
                except Exception as exc:
                    entry["error"] = f"Console error: {getattr(exc, 'detail', exc)}"

            # 2. Probe SOCKS5 egress directly
            if sim.socks_url:
                probe_before = await self._probe_fn(sim.socks_url, timeout=8.0)
                entry["socksOk"] = bool(probe_before.get("ok"))
                entry["latencyMs"] = probe_before.get("latencyMs")
                if probe_before.get("egressIp"):
                    entry["egressIpBefore"] = probe_before["egressIp"]
                    sim.last_egress_ip = probe_before["egressIp"]
                elif not entry["error"] and probe_before.get("error"):
                    entry["error"] = f"SOCKS5 probe error: {probe_before['error']}"

            # 3. Optional rotate + re-probe
            if do_rotate and sim.console_url:
                rot = await self.rotate_node(sim.id, reason="manual_test")
                entry["rotated"] = bool(rot.get("ok"))
                entry["egressIpAfter"] = rot.get("egress_ip")
                if not rot.get("ok"):
                    entry["error"] = rot.get("error") or entry["error"]
                elif sim.socks_url:
                    probe_after = await self._probe_fn(sim.socks_url, timeout=8.0)
                    if probe_after.get("ok"):
                        entry["socksOk"] = True
                        if probe_after.get("latencyMs") is not None:
                            entry["latencyMs"] = probe_after["latencyMs"]
                    elif not entry["error"] and probe_after.get("error"):
                        entry["error"] = f"SOCKS5 after rotate error: {probe_after['error']}"
                    probe_after_ip = probe_after.get("egressIp")
                    if probe_after_ip and (
                        not entry["egressIpAfter"] or probe_after_ip != entry["egressIpBefore"]
                    ):
                        entry["egressIpAfter"] = probe_after_ip
                    if entry["egressIpAfter"]:
                        sim.last_egress_ip = entry["egressIpAfter"]

            ip_before = entry.get("egressIpBefore")
            ip_after = entry.get("egressIpAfter")
            entry["ipChanged"] = bool(ip_before and ip_after and ip_before != ip_after)

            results.append(entry)

        if do_rotate:
            all_ok = bool(results) and any(
                r["rotated"] and (r["socksOk"] or r["consoleOk"]) for r in results
            )
        else:
            all_ok = any(r["socksOk"] or r["consoleOk"] for r in results)
        return {"ok": all_ok, "results": results}


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
    ) -> None:
        self.sim = sim
        self.rotator = rotator
        self.config = config
        self.log_cb = log_cb
        self.stop_check = stop_check
        self.progress_cb = progress_cb
        self.keywords = keywords
        self._attempt_fetcher = attempt_fetcher

        self._bridge: Socks5HttpBridge | None = None
        self._playwright: Any = None
        self._browser: Any = None
        self._context: Any = None

    async def __aenter__(self) -> "GuestPublicGroupWorker":
        await self.start()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.close()

    async def start(self) -> None:
        if self._attempt_fetcher is not None:
            return  # Unit test mode with injected fetcher (no Chromium spawn needed)

        proxy_arg: dict[str, str] | None = None
        if self.sim.socks_url:
            if self.sim.socks_url.lower().startswith("socks"):
                self._bridge = Socks5HttpBridge(self.sim.socks_url)
                local_http_url = await self._bridge.start()
                proxy_arg = {"server": local_http_url}
            else:
                proxy_arg = {"server": self.sim.socks_url}

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

    async def _fetch_group_with_playwright(
        self,
        group: dict[str, Any],
        watermarks: dict[str, set[str]],
    ) -> dict[str, Any]:
        """Load target Facebook public group in unauthenticated Guest mode."""
        if self._context is None:
            await self.reset_guest_context()
        if self._context is None:
            raise RuntimeError("Playwright Guest context could not be initialized")

        raw_url = (group.get("group_url") or "").strip()
        target_url = normalize_group_crawl_url(raw_url)
        max_posts = int(self.config.get("max_posts_per_group") or 25)
        max_scrolls = int(self.config.get("max_scrolls_per_group") or 2)
        known_urls = watermarks.get("urls") or set()
        known_ids = watermarks.get("post_ids") or set()

        collected: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        graphql_tasks: set[asyncio.Task[Any]] = set()
        http_status: int | None = None

        page = await self._context.new_page()

        async def _consume_graphql_response(resp: Any) -> None:
            try:
                r_url = resp.url or ""
                if "/api/graphql" not in r_url or resp.status != 200:
                    return
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
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
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
            limit=30,
        )

        outcome: dict[str, Any] = {"state": "error", "posts": [], "early_stop_reason": ""}
        rotated_on_retry = False
        error_msg: str | None = None

        for attempt in range(2):
            try:
                if self._attempt_fetcher is not None:
                    outcome = await self._attempt_fetcher(self.sim, group, watermarks, attempt)
                else:
                    outcome = await self._fetch_group_with_playwright(group, watermarks)
            except Exception as exc:
                error_msg = str(exc)
                if attempt == 0 and self.sim.console_url and self._attempt_fetcher is None:
                    self.log_cb(
                        "warn",
                        self.sim.id,
                        f"[{group_name}] Lỗi kết nối/proxy ({error_msg}) — xoay IP SIM {self.sim.id} & thử lại...",
                    )
                    rot = await self.rotator.rotate_node(
                        self.sim.id,
                        reason="reactive_proxy_error",
                        log_cb=self.log_cb,
                    )
                    if rot.get("ok"):
                        rotated_on_retry = True
                        self.progress_cb({"ip_rotations": 1})
                        await self.reset_guest_context()
                        continue
                outcome = {"state": "error", "posts": [], "early_stop_reason": ""}
                break

            state = outcome.get("state") or "ok"
            if state in {"rate_limit", "login_wall"} and attempt == 0 and self.sim.console_url:
                self.log_cb(
                    "warn",
                    self.sim.id,
                    f"[{group_name}] Gặp {state} — xoay IP SIM {self.sim.id} & tạo Guest session sạch rồi thử lại...",
                )
                rot = await self.rotator.rotate_node(
                    self.sim.id,
                    reason=f"reactive_{state}",
                    log_cb=self.log_cb,
                )
                if rot.get("ok"):
                    rotated_on_retry = True
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
            await asyncio.to_thread(
                _update_group_crawl_meta_sync,
                group_id=group_id,
                status=status_label,
                error=err_text,
                posts_count=0,
                mark_private=False,
            )
            self.log_cb("error", self.sim.id, f"[{group_name}] Thất bại ({status_label}): {err_text}")
            self.sim.total_groups += 1
            return {
                "group_id": group_id,
                "status": status_label,
                "posts_saved": 0,
                "elapsed_ms": elapsed_ms,
                "error": err_text,
            }

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

        saved_count = 0
        if ext_posts:
            ingest_req = ExtensionCrawlRequest(
                posts=ext_posts,
                group_name=group_name,
                group_url=group_url,
                group_id=group_id or None,
                keywords=self.keywords,
                post_limit=int(self.config.get("max_posts_per_group") or 25),
                worker_id=f"public-4g:{self.sim.id}",
            )
            ingest_res = await ingest_facebook_posts(
                ingest_req,
                event_name="public_4g_crawl_saved",
                extra_broadcast_fields={"source": "public_4g", "sim_node": self.sim.id},
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

        # Track epoch count & trigger proactive SIM IP rotation every K groups
        self.sim.total_groups += 1
        self.sim.groups_in_epoch += 1
        k_rotate = max(1, int(self.config.get("groups_per_ip_rotate") or 6))
        if (
            self.sim.console_url
            and self.sim.groups_in_epoch >= k_rotate
            and not self.stop_check()
        ):
            rot = await self.rotator.rotate_node(
                self.sim.id,
                reason=f"proactive_every_{k_rotate}_groups",
                log_cb=self.log_cb,
            )
            if rot.get("ok"):
                self.progress_cb({"ip_rotations": 1})
                await self.reset_guest_context()

        self.sim.status = "idle"
        return {
            "group_id": group_id,
            "status": crawl_status,
            "posts_saved": saved_count,
            "extracted": len(raw_posts),
            "elapsed_ms": elapsed_ms,
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
                for k, v in res.data[0].items():
                    if v is not None:
                        cfg[k] = v
        except Exception as exc:
            logger.debug("[PUBLIC-4G] get_config fallback defaults (%s)", exc)
        return cfg

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
        }
        clean_patch: dict[str, Any] = {}
        for k, v in patch.items():
            if k not in allowed or v is None:
                continue
            clean_patch[k] = v

        # Clamp bounds safely
        if "cycle_interval_min" in clean_patch:
            clean_patch["cycle_interval_min"] = max(5, min(1440, int(clean_patch["cycle_interval_min"])))
        if "groups_per_ip_rotate" in clean_patch:
            clean_patch["groups_per_ip_rotate"] = max(1, min(50, int(clean_patch["groups_per_ip_rotate"])))
        if "max_posts_per_group" in clean_patch:
            clean_patch["max_posts_per_group"] = max(1, min(100, int(clean_patch["max_posts_per_group"])))
        if "max_scrolls_per_group" in clean_patch:
            clean_patch["max_scrolls_per_group"] = max(0, min(10, int(clean_patch["max_scrolls_per_group"])))
        if "concurrent_sims" in clean_patch:
            clean_patch["concurrent_sims"] = max(1, min(10, int(clean_patch["concurrent_sims"])))

        merged = {**current, **clean_patch, "id": "default", "updated_at": _utc_now_iso()}
        if updated_by:
            merged["updated_by"] = updated_by

        try:
            supabase = get_supabase_client()
            supabase.table("public_crawl_config").upsert(
                {k: v for k, v in merged.items() if k in allowed or k in {"id", "updated_at", "updated_by"}},
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
            allowed["public_crawl_interval_min"] = max(5, min(1440, int(patch["public_crawl_interval_min"])))
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

        # Oldest crawled first so every run & limit_groups test rotates fairly across groups
        rows.sort(key=lambda r: str(r.get("last_public_crawled_at") or ""))
        if not only_due:
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
                interval = int(row.get("public_crawl_interval_min") or default_interval_min or 15)
                if (now - last_dt).total_seconds() >= max(5, interval) * 60:
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
    ) -> str:
        run_id = str(uuid.uuid4())
        try:
            supabase = get_supabase_client()
            supabase.table("public_crawl_runs").insert(
                {
                    "id": run_id,
                    "trigger_source": trigger_source,
                    "triggered_by": triggered_by or None,
                    "status": "running",
                    "started_at": _utc_now_iso(),
                    "total_groups": int(total_groups),
                    "sim_nodes": sim_ids,
                }
            ).execute()
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

    async def get_status(self) -> dict[str, Any]:
        cfg = await asyncio.to_thread(self.get_config_sync)
        recent_runs = await asyncio.to_thread(self.get_recent_runs_sync, 12)
        sims = self.rotator.snapshot_nodes()
        return {
            "config": cfg,
            "runtime": {
                "is_running": self.is_running,
                "stop_requested": self.stop_requested,
                "active_run_id": self.active_run_id,
                "started_at": self.started_at,
                **self._stats,
            },
            "sims": sims,
            "recent_runs": recent_runs,
            "logs": list(self._logs)[-80:],
        }

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
    ) -> dict[str, Any]:
        if self.is_running:
            return {
                "started": False,
                "reason": "already_running",
                "active_run_id": self.active_run_id,
            }

        cfg = await asyncio.to_thread(self.get_config_sync)
        groups = await asyncio.to_thread(
            self._select_due_groups_sync,
            group_ids=group_ids,
            default_interval_min=int(cfg.get("cycle_interval_min") or 15),
            only_due=only_due,
        )
        if limit_groups is not None and limit_groups > 0 and not group_ids:
            groups = groups[:limit_groups]
        if not groups:
            return {
                "started": False,
                "reason": "no_eligible_groups",
                "message": "Không có nhóm Public nào cần cào lúc này.",
            }

        sims = self.rotator.sync_nodes()
        allow_direct = os.getenv("PUBLIC_CRAWL_ALLOW_DIRECT_NO_PROXY", "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        if not sims:
            if not allow_direct and attempt_fetcher is None:
                return {
                    "started": False,
                    "reason": "no_mobile_proxy_configured",
                    "message": (
                        "Chưa cấu hình cụm SIM 4G (MOBILE_PROXY_NODES). Vui lòng cấu hình proxy 4G "
                        "hoặc bật PUBLIC_CRAWL_ALLOW_DIRECT_NO_PROXY=1 để chạy thử nghiệm."
                    ),
                }
            sims = [SimNodeRuntime(id="direct-local", label="Direct Guest (Dev)", status="idle")]

        max_lanes = max(1, min(len(sims), int(cfg.get("concurrent_sims") or len(sims))))
        active_sims = sims[:max_lanes]

        self.is_running = True
        self.stop_requested = False
        self.started_at = _utc_now_iso()
        self._stats = {
            "total_groups": len(groups),
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
            total_groups=len(groups),
            sim_ids=[s.id for s in active_sims],
        )

        self.append_log(
            "info",
            "orchestrator",
            f"Bắt đầu cào {len(groups)} nhóm Public bằng {len(active_sims)} SIM 4G ({', '.join(s.id for s in active_sims)}) — 0 Cookie",
        )

        self._active_task = asyncio.create_task(
            self._execute_run_task(
                run_id=self.active_run_id,
                groups=groups,
                active_sims=active_sims,
                config=cfg,
                keywords=keywords,
                attempt_fetcher=attempt_fetcher,
            )
        )
        return {
            "started": True,
            "run_id": self.active_run_id,
            "total_groups": len(groups),
            "sim_nodes": [s.id for s in active_sims],
        }

    async def _execute_run_task(
        self,
        *,
        run_id: str,
        groups: list[dict[str, Any]],
        active_sims: list[SimNodeRuntime],
        config: dict[str, Any],
        keywords: list[str] | None,
        attempt_fetcher: Callable[..., Awaitable[dict[str, Any]]] | None,
    ) -> None:
        t0 = time.perf_counter()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        for g in groups:
            queue.put_nowait(g)

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
                ) as worker:
                    while not self.stop_requested:
                        try:
                            group = queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        try:
                            res = await worker.process_group(group)
                            elapsed_samples.append(int(res.get("elapsed_ms") or 0))
                            self._stats["completed_groups"] += 1
                            st = res.get("status")
                            if st in {"ok", "rotated_retry"}:
                                self._stats["groups_ok"] += 1
                            elif st == "private_skipped":
                                self._stats["groups_private"] += 1
                            else:
                                self._stats["groups_failed"] += 1
                            self._stats["posts_saved"] += int(res.get("posts_saved") or 0)
                            if elapsed_samples:
                                self._stats["avg_ms_per_group"] = int(
                                    sum(elapsed_samples) / len(elapsed_samples)
                                )
                        except Exception as exc:
                            logger.error("[PUBLIC-4G] Worker %s group failure: %s", sim.id, exc, exc_info=True)
                            self._stats["completed_groups"] += 1
                            self._stats["groups_failed"] += 1
                        finally:
                            queue.task_done()
            except Exception as exc:
                nonlocal run_error
                run_error = str(exc)
                sim.status = "error"
                sim.last_error = run_error
                self.append_log("error", sim.id, f"[SIM {sim.id}] Lỗi khởi tạo worker: {run_error}")
            finally:
                if sim.status != "error":
                    sim.status = "idle"

        try:
            await asyncio.gather(*[_sim_lane(s) for s in active_sims])
        finally:
            total_ms = int((time.perf_counter() - t0) * 1000)
            final_status = "stopped" if self.stop_requested else ("failed" if run_error else "completed")
            await asyncio.to_thread(
                self._finish_run_record_sync,
                run_id=run_id,
                status=final_status,
                duration_ms=total_ms,
                stats=dict(self._stats),
                error_summary=run_error,
            )
            self.append_log(
                "info",
                "orchestrator",
                (
                    f"Kết thúc ({final_status}): {self._stats['groups_ok']} OK, "
                    f"{self._stats['groups_private']} Private, {self._stats['groups_failed']} Lỗi, "
                    f"+{self._stats['posts_saved']} bài mới, {self._stats['ip_rotations']} lần xoay IP 4G ({total_ms}ms)."
                ),
            )
            try:
                await manager.broadcast(
                    {
                        "event": "public_4g_run_finished",
                        "run_id": run_id,
                        "status": final_status,
                        "posts_saved": self._stats["posts_saved"],
                        "groups_ok": self._stats["groups_ok"],
                    }
                )
            except Exception:
                pass
            self.is_running = False
            self.stop_requested = False

    def request_stop(self) -> dict[str, Any]:
        if not self.is_running:
            return {"stopped": False, "message": "Không có phiên cào Public 4G nào đang chạy."}
        self.stop_requested = True
        self.append_log("warn", "orchestrator", "Đã nhận lệnh DỪNG từ người dùng — dừng sau nhóm hiện tại.")
        return {"stopped": True, "active_run_id": self.active_run_id}

    async def maybe_trigger_scheduled_run(self) -> dict[str, Any] | None:
        """Called every minute by APScheduler when continuous auto-crawl is enabled."""
        if self.is_running:
            return None
        cfg = await asyncio.to_thread(self.get_config_sync)
        if not cfg.get("enabled"):
            return None
        return await self.start_run(trigger_source="scheduler", only_due=True)


public_crawl_orchestrator = PublicCrawlOrchestrator()
