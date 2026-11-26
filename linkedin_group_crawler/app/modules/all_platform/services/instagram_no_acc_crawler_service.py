"""Zero-Account Rotating 4G Instagram Crawler Service (Phase 2).

Supports two unauthenticated Guest modes running over the shared `RotatingProxyPool`:
1. Keyword / Popular discovery: `https://www.instagram.com/popular/<slug>/`
2. Public profile monitoring:   `https://www.instagram.com/<username>/`

Post detail extraction uses Instagram's public embed endpoint inside the same
Playwright Guest context (blocking images/media/fonts for ~120MB RAM footprint):
    `https://www.instagram.com/p/<shortcode>/embed/captioned/`
which returns both `contextJSON` (full Vietnamese caption, owner username, like/comment
counts, taken_at timestamp, display_src) and clean `.Caption` DOM fallback.

Extracted batches persist to `instagram_posts` (deduped by canonical `post_url`),
record into `crawled_post_audit_logs`, and score immediately via `score_and_save_posts`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional
from urllib.parse import quote

from bs4 import BeautifulSoup

from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

TABLE_POSTS = "instagram_posts"
TABLE_TARGETS = "instagram_targets"
DEFAULT_MAX_POSTS = 12
MAX_POST_LIMIT = 30

_SHORTCODE_RE = re.compile(
    r"(?:https?://(?:www\.)?instagram\.com)?/(?:p|reel|tv)/([A-Za-z0-9_-]{5,32})(?:/|\?|$|\"|')",
    re.IGNORECASE,
)

_IG_LOGIN_MARKERS = (
    "log in to instagram",
    "đăng nhập vào instagram",
    "accounts/login",
    "challenge_required",
    "please wait a few minutes before you try again",
    "vui lòng đợi vài phút",
)

_IG_EMPTY_MARKERS = (
    "sorry, this page isn't available",
    "rất tiếc, trang này hiện không khả dụng",
    "no posts yet",
    "chưa có bài viết nào",
)

_IG_BLOCKED_RESOURCE_TYPES = frozenset({"image", "media", "font", "imageset"})


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify_instagram_keyword(keyword: str) -> str:
    """Normalize a keyword/hashtag into an Instagram `/popular/<slug>/` path slug."""
    raw = str(keyword or "").strip().lstrip("#@").lower()
    if not raw:
        return ""
    # Keep Vietnamese letters or convert whitespace to hyphens cleanly
    cleaned = re.sub(r"\s+", "-", raw)
    cleaned = re.sub(r"[^a-z0-9\-_\u00c0-\u024f\u1e00-\u1eff]", "", cleaned)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned or re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode())


def normalize_instagram_username(raw: str) -> str:
    """Extract clean Instagram username from handle or full profile URL."""
    s = str(raw or "").strip()
    if not s:
        return ""
    m = re.match(r"^https?://(?:www\.)?instagram\.com/([A-Za-z0-9._]{1,64})", s, re.IGNORECASE)
    if m:
        s = m.group(1)
    return s.lstrip("@").strip("/").lower()


def build_instagram_keyword_url(keyword: str) -> str:
    slug = _slugify_instagram_keyword(keyword)
    return f"https://www.instagram.com/popular/{quote(slug)}/"


def build_instagram_profile_url(username: str) -> str:
    handle = normalize_instagram_username(username)
    return f"https://www.instagram.com/{quote(handle)}/"


def build_instagram_embed_url(shortcode: str) -> str:
    code = str(shortcode or "").strip().strip("/")
    return f"https://www.instagram.com/p/{quote(code)}/embed/captioned/"


def canonical_instagram_post_url(shortcode: str) -> str:
    code = str(shortcode or "").strip().strip("/")
    return f"https://www.instagram.com/p/{code}/"


def extract_instagram_shortcodes_from_html(html: str, limit: int = 24) -> list[str]:
    """Extract ordered, deduplicated Instagram post/reel shortcodes from HTML or embedded JSON."""
    if not html:
        return []
    seen: set[str] = set()
    ordered: list[str] = []

    for m in _SHORTCODE_RE.finditer(html):
        code = m.group(1).strip()
        if not code or code.lower() in {"embed", "captioned", "media", "comments"}:
            continue
        if code not in seen:
            seen.add(code)
            ordered.append(code)
            if len(ordered) >= limit:
                return ordered

    # Also capture `"shortcode":"..."` or `"code":"..."` from embedded JSON chunks
    for m in re.finditer(r'"(?:shortcode|code)"\s*:\s*"([A-Za-z0-9_-]{7,20})"', html):
        code = m.group(1).strip()
        if code and code not in seen:
            seen.add(code)
            ordered.append(code)
            if len(ordered) >= limit:
                break
    return ordered


def _extract_context_json_from_embed(html: str) -> dict[str, Any] | None:
    """Extract and parse Instagram's escaped `contextJSON` object from `/embed/captioned/` HTML."""
    if not html:
        return None
    # Pattern 1: "contextJSON":"{\"context\":...}"
    m = re.search(r'"contextJSON"\s*:\s*"((?:\\.|[^"\\])+)"', html)
    if m:
        raw_escaped = m.group(1)
        try:
            unescaped = json.loads(f'"{raw_escaped}"')
            parsed = json.loads(unescaped)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    # Pattern 2: contextJSON: { ... } or window.__additionalDataLoaded(..., {...})
    for m2 in re.finditer(r'window\.__additionalDataLoaded\([^,]+,\s*(\{.*?\})\s*\);', html, re.S):
        try:
            parsed = json.loads(m2.group(1))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _parse_count_loose(val: Any) -> int:
    if isinstance(val, bool):
        return 0
    if isinstance(val, (int, float)):
        return max(0, int(val))
    s = str(val or "").strip().lower().replace(",", "").replace(" ", "")
    if not s:
        return 0
    m = re.match(r"^([\d.]+)([kmb])?$", s)
    if m:
        num = float(m.group(1))
        suf = m.group(2) or ""
        mult = {"k": 1000, "m": 1_000_000, "b": 1_000_000_000}.get(suf, 1)
        return max(0, int(round(num * mult)))
    digits = re.search(r"\d+", s)
    return int(digits.group(0)) if digits else 0


def parse_instagram_embed_html(
    html: str,
    shortcode: str,
    *,
    keyword: str = "",
    target_type: str = "keyword",
) -> dict[str, Any] | None:
    """Parse `/p/<shortcode>/embed/captioned/` HTML into a normalized post dict.

    Prioritizes structured `contextJSON` payload (highest fidelity), then enriches or
    falls back cleanly to BeautifulSoup DOM parsing (`.Caption`, `.UsernameText`,
    `img.EmbeddedMediaImage`, `time[datetime]`).
    """
    code = str(shortcode or "").strip().strip("/")
    if not code or not html:
        return None

    post_url = canonical_instagram_post_url(code)
    author_username = ""
    author_name = ""
    caption = ""
    likes = 0
    comments = 0
    post_time_iso: str | None = None
    media_url: str | None = None
    image_urls: list[str] = []

    ctx = _extract_context_json_from_embed(html)
    if isinstance(ctx, dict):
        # Context JSON nests under ctx["context"]["media"] or ctx["gql_data"]["shortcode_media"]
        media = (
            (ctx.get("context") or {}).get("media")
            if isinstance(ctx.get("context"), dict)
            else None
        ) or (
            (ctx.get("gql_data") or {}).get("shortcode_media")
            if isinstance(ctx.get("gql_data"), dict)
            else None
        ) or ctx.get("media") or ctx

        if isinstance(media, dict):
            owner = media.get("owner") if isinstance(media.get("owner"), dict) else {}
            author_username = str(
                owner.get("username")
                or media.get("owner_username")
                or ctx.get("username")
                or ""
            ).strip().lstrip("@")
            author_name = str(
                owner.get("full_name")
                or media.get("owner_full_name")
                or author_username
                or ""
            ).strip()

            # Caption formats across Instagram embed revisions
            cap_val = media.get("caption")
            if isinstance(cap_val, str):
                caption = cap_val.strip()
            elif isinstance(cap_val, dict):
                caption = str(cap_val.get("text") or "").strip()
            if not caption:
                edges = (
                    ((media.get("edge_media_to_caption") or {}).get("edges"))
                    if isinstance(media.get("edge_media_to_caption"), dict)
                    else None
                )
                if isinstance(edges, list) and edges:
                    first_node = (edges[0] or {}).get("node") or {}
                    caption = str(first_node.get("text") or "").strip()

            likes = _parse_count_loose(
                media.get("likes_count")
                or (media.get("edge_media_preview_like") or {}).get("count")
                or (media.get("edge_liked_by") or {}).get("count")
                or ctx.get("likes_count")
            )
            comments = _parse_count_loose(
                media.get("comments_count")
                or (media.get("edge_media_to_comment") or {}).get("count")
                or (media.get("edge_media_preview_comment") or {}).get("count")
                or ctx.get("comments_count")
            )

            ts_raw = (
                media.get("taken_at_timestamp")
                or media.get("taken_at")
                or ctx.get("taken_at_timestamp")
            )
            if ts_raw is not None:
                try:
                    ts_num = float(ts_raw)
                    if ts_num > 1e12:
                        ts_num /= 1000.0
                    if ts_num > 1e8:
                        post_time_iso = datetime.fromtimestamp(ts_num, tz=timezone.utc).isoformat()
                except (TypeError, ValueError, OSError):
                    pass

            for img_key in ("display_src", "display_url", "thumbnail_src"):
                v = media.get(img_key)
                if isinstance(v, str) and v.startswith("http") and v not in image_urls:
                    image_urls.append(v)
            if isinstance(media.get("video_url"), str) and media["video_url"].startswith("http"):
                media_url = media["video_url"]

    # DOM fallback & enrichment via BeautifulSoup
    try:
        soup = BeautifulSoup(html, "html.parser")
        if not author_username:
            u_el = (
                soup.select_one(".UsernameText")
                or soup.select_one(".HoverCardUserName")
                or soup.select_one("a.Username")
            )
            if u_el:
                author_username = u_el.get_text(" ", strip=True).lstrip("@")
                if not author_name:
                    author_name = author_username

        if not caption:
            cap_el = soup.select_one(".Caption")
            if cap_el:
                # Remove username link and "View all comments" link inside .Caption clone
                for noise in cap_el.select(".CaptionUsername, .CaptionComments, a.CaptionUsername"):
                    noise.decompose()
                caption = cap_el.get_text("\n", strip=True)

        if not post_time_iso:
            t_el = soup.select_one("time[datetime]")
            if t_el and t_el.get("datetime"):
                try:
                    dt = datetime.fromisoformat(str(t_el["datetime"]).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    post_time_iso = dt.astimezone(timezone.utc).isoformat()
                except ValueError:
                    pass

        if not image_urls:
            for img in soup.select("img.EmbeddedMediaImage, img.Content"):
                src = (img.get("src") or "").strip()
                if src.startswith("http") and src not in image_urls:
                    image_urls.append(src)
                    if len(image_urls) >= 5:
                        break

        if likes == 0:
            social_el = soup.select_one(".SocialProof")
            if social_el:
                m_like = re.search(r"([\d.,]+\s*[kKmMbB]?)\s*(?:likes?|lượt thích)", social_el.get_text(" ", strip=True), re.I)
                if m_like:
                    likes = _parse_count_loose(m_like.group(1))
    except Exception as exc:
        logger.debug("[IG-NO-ACC] DOM fallback parse skipped for %s: %s", code, exc)

    caption = caption.strip()
    if not caption and not image_urls and not author_username:
        return None

    return {
        "post_url": post_url,
        "shortcode": code,
        "author_username": author_username or (normalize_instagram_username(keyword) if target_type == "profile" else ""),
        "author_name": author_name or author_username or "Instagram User",
        "content": caption,
        "post_time": post_time_iso,
        "reactions": likes,
        "comments": comments,
        "shares": 0,
        "media_url": media_url,
        "image_urls": image_urls[:10],
        "keyword": keyword,
        "target_type": target_type,
    }


def classify_instagram_page_state(
    *,
    http_status: Optional[int],
    final_url: str,
    body_text: str,
    shortcode_count: int,
) -> tuple[str, bool, str]:
    """Classify Guest Instagram discovery result for proxy rotation decisions."""
    url_low = (final_url or "").lower()
    body_low = (body_text or "").lower()

    if "/accounts/login" in url_low or "/challenge/" in url_low:
        return ("login_wall", True, "Instagram chuyển hướng sang trang đăng nhập (/accounts/login)")
    if http_status == 429:
        return ("rate_limited", True, "Instagram giới hạn tốc độ (HTTP 429)")
    if shortcode_count > 0:
        return ("ok", False, f"Phát hiện {shortcode_count} bài/reel Instagram")
    if any(m in body_low for m in _IG_EMPTY_MARKERS):
        return ("empty", False, "Trang Instagram không có bài viết công khai")
    if any(m in body_low for m in _IG_LOGIN_MARKERS):
        return ("login_wall", True, "Instagram yêu cầu đăng nhập / challenge")
    if http_status and http_status >= 400:
        return ("http_error", True, f"HTTP {http_status} từ Instagram")
    return ("empty_or_throttled", True, "Instagram trả về trang trống (IP có thể bị soft-limit)")


@dataclass
class InstagramTargetCrawlResult:
    target_type: str  # keyword | profile
    target_value: str
    discovery_url: str
    status: str  # ok | empty | login_wall | rate_limited | empty_or_throttled | transport_error | proxy_expired | http_error
    should_rotate: bool = False
    shortcodes_found: int = 0
    raw_extracted: int = 0
    saved_count: int = 0
    high_score_count: int = 0
    ai_checked_count: int = 0
    skipped_existing: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
    posts: list[dict[str, Any]] = field(default_factory=list)


def get_known_instagram_shortcodes(limit: int = 200) -> set[str]:
    """Load recent shortcodes already in `instagram_posts` for incremental watermark stop."""
    try:
        sb = get_supabase_client()
        res = (
            sb.table(TABLE_POSTS)
            .select("shortcode")
            .order("crawl_date", desc=True)
            .limit(max(10, min(limit, 500)))
            .execute()
        )
        return {str(r["shortcode"]).strip() for r in (res.data or []) if r.get("shortcode")}
    except Exception as exc:
        logger.debug("[IG-NO-ACC] Watermark fetch skipped (%s)", exc)
        return set()


async def crawl_instagram_target_guest(
    page: Any,
    target_type: str,
    target_value: str,
    *,
    max_posts: int = DEFAULT_MAX_POSTS,
    known_shortcodes: Optional[set[str]] = None,
    hydrate_wait_sec: float = 4.5,
    is_proxy_expired_fn: Optional[Callable[[str], bool]] = None,
) -> InstagramTargetCrawlResult:
    """Discover Instagram shortcodes in Guest mode, then parse `/p/<code>/embed/captioned/`."""
    t0 = time.monotonic()
    t_type = "profile" if str(target_type).strip().lower() == "profile" else "keyword"
    t_val = normalize_instagram_username(target_value) if t_type == "profile" else str(target_value or "").strip()
    discovery_url = (
        build_instagram_profile_url(t_val)
        if t_type == "profile"
        else build_instagram_keyword_url(t_val)
    )
    known = known_shortcodes or set()
    cap = max(1, min(MAX_POST_LIMIT, int(max_posts or DEFAULT_MAX_POSTS)))
    http_status: Optional[int] = None

    try:
        resp = await page.goto(discovery_url, wait_until="domcontentloaded", timeout=28000)
        if resp is not None:
            http_status = resp.status

        # Wait briefly for Guest SSR/Hydration links to appear
        deadline = time.monotonic() + max(1.5, min(7.0, hydrate_wait_sec))
        while time.monotonic() < deadline:
            probe = await page.evaluate(
                """() => {
                    const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').length;
                    const urlLow = location.href.toLowerCase();
                    const blocked = urlLow.includes('/accounts/login') || urlLow.includes('/challenge');
                    return { links, blocked };
                }"""
            )
            if probe.get("blocked") or int(probe.get("links") or 0) >= 6:
                await asyncio.sleep(0.3)
                break
            await asyncio.sleep(0.35)

        html = await page.content()
        try:
            body_text = await page.inner_text("body")
        except Exception:
            body_text = ""

        shortcodes = extract_instagram_shortcodes_from_html(html, limit=cap * 2)
        status, should_rotate, detail = classify_instagram_page_state(
            http_status=http_status,
            final_url=str(page.url or discovery_url),
            body_text=body_text[:1500],
            shortcode_count=len(shortcodes),
        )
        if status != "ok":
            return InstagramTargetCrawlResult(
                target_type=t_type,
                target_value=t_val,
                discovery_url=discovery_url,
                status=status,
                should_rotate=should_rotate,
                shortcodes_found=len(shortcodes),
                duration_ms=int((time.monotonic() - t0) * 1000),
                error=None if status == "empty" else detail,
            )

        # Fetch `/p/<shortcode>/embed/captioned/` for fresh shortcodes, stopping early on watermark
        posts: list[dict[str, Any]] = []
        skipped_existing = 0
        consecutive_known = 0
        for code in shortcodes:
            if len(posts) >= cap:
                break
            if code in known:
                skipped_existing += 1
                consecutive_known += 1
                if t_type == "profile" and consecutive_known >= 2:
                    break  # Profile feeds are chronological -> early watermark stop!
                continue
            consecutive_known = 0

            embed_url = build_instagram_embed_url(code)
            try:
                emb_resp = await page.goto(embed_url, wait_until="domcontentloaded", timeout=18000)
                if emb_resp is not None and emb_resp.status == 429:
                    return InstagramTargetCrawlResult(
                        target_type=t_type,
                        target_value=t_val,
                        discovery_url=discovery_url,
                        status="rate_limited" if not posts else "ok",
                        should_rotate=not posts,
                        shortcodes_found=len(shortcodes),
                        raw_extracted=len(posts),
                        skipped_existing=skipped_existing,
                        duration_ms=int((time.monotonic() - t0) * 1000),
                        error="Instagram 429 trên embed endpoint" if not posts else None,
                        posts=posts,
                    )
                emb_html = await page.content()
                parsed = parse_instagram_embed_html(
                    emb_html,
                    code,
                    keyword=t_val,
                    target_type=t_type,
                )
                if parsed and parsed.get("content"):
                    posts.append(parsed)
            except Exception as emb_exc:
                logger.debug("[IG-NO-ACC] Embed fetch failed for %s: %s", code, emb_exc)
            await asyncio.sleep(0.4)

        return InstagramTargetCrawlResult(
            target_type=t_type,
            target_value=t_val,
            discovery_url=discovery_url,
            status="ok",
            should_rotate=False,
            shortcodes_found=len(shortcodes),
            raw_extracted=len(posts),
            skipped_existing=skipped_existing,
            duration_ms=int((time.monotonic() - t0) * 1000),
            posts=posts,
        )
    except Exception as exc:
        err_text = str(exc)
        expired = bool(is_proxy_expired_fn(err_text)) if is_proxy_expired_fn else False
        return InstagramTargetCrawlResult(
            target_type=t_type,
            target_value=t_val,
            discovery_url=discovery_url,
            status="proxy_expired" if expired else "transport_error",
            should_rotate=not expired,
            duration_ms=int((time.monotonic() - t0) * 1000),
            error=err_text[:280],
        )


def save_instagram_crawl_batch(
    *,
    posts: list[dict[str, Any]],
    keyword: str,
    target_type: str = "keyword",
    id_member: Optional[str] = None,
    post_limit: int = DEFAULT_MAX_POSTS,
    max_age_days: int = 14,
) -> dict[str, Any]:
    """Deduplicate and insert fresh Instagram No-Acc posts into `instagram_posts`."""
    sb = get_supabase_client()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    cutoff = now - timedelta(days=max(1, int(max_age_days or 14)))
    limit = max(1, min(MAX_POST_LIMIT, int(post_limit or DEFAULT_MAX_POSTS)))

    candidates: dict[str, dict[str, Any]] = {}
    skipped_invalid = 0
    skipped_old = 0
    for raw in posts:
        code = str(raw.get("shortcode") or "").strip()
        url = str(raw.get("post_url") or (canonical_instagram_post_url(code) if code else "")).strip()
        content = str(raw.get("content") or "").strip()
        if not url or len(content) < 4:
            skipped_invalid += 1
            continue
        if url in candidates:
            continue

        post_time_str = raw.get("post_time")
        if post_time_str:
            try:
                dt = datetime.fromisoformat(str(post_time_str).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt < cutoff:
                    skipped_old += 1
                    continue
                post_time_str = dt.astimezone(timezone.utc).isoformat()
            except ValueError:
                post_time_str = None

        reactions = max(0, int(raw.get("reactions") or 0))
        comments = max(0, int(raw.get("comments") or 0))
        shares = max(0, int(raw.get("shares") or 0))
        candidates[url] = {
            "post_url": url,
            "shortcode": code or None,
            "author_username": str(raw.get("author_username") or "").strip() or None,
            "author_name": str(raw.get("author_name") or raw.get("author_username") or "Instagram").strip(),
            "content": content[:8000],
            "post_time": post_time_str,
            "crawl_date": now_iso,
            "reactions": reactions,
            "comments": comments,
            "shares": shares,
            "media_url": raw.get("media_url") or None,
            "image_urls": list(raw.get("image_urls") or [])[:10],
            "keyword": str(keyword or "").strip() or None,
            "target_type": target_type,
            "id_member": id_member or None,
            "score": comments * 2 + reactions + shares * 3,
            "crawl_source": "public_4g",
        }

    if not candidates:
        return {
            "count": 0,
            "skipped_invalid": skipped_invalid,
            "skipped_old": skipped_old,
            "skipped_existing": 0,
            "_inserted_rows": [],
        }

    urls = list(candidates.keys())
    existing_urls: set[str] = set()
    try:
        res = sb.table(TABLE_POSTS).select("post_url").in_("post_url", urls).execute()
        existing_urls = {r["post_url"] for r in (res.data or []) if r.get("post_url")}
    except Exception as exc:
        logger.warning("[IG-NO-ACC] Could not check duplicate post_urls: %s", exc)

    fresh = [row for url, row in candidates.items() if url not in existing_urls]
    skipped_existing = len(candidates) - len(fresh)
    fresh.sort(key=lambda r: int(r.get("score") or 0), reverse=True)
    to_insert = fresh[:limit]

    inserted_rows: list[dict[str, Any]] = []
    if to_insert:
        try:
            ins = sb.table(TABLE_POSTS).upsert(to_insert, on_conflict="post_url").execute()
            inserted_rows = list(ins.data or [])
        except Exception as exc:
            logger.error("[IG-NO-ACC] Insert instagram_posts failed: %s", exc)

    return {
        "count": len(inserted_rows),
        "skipped_invalid": skipped_invalid,
        "skipped_old": skipped_old,
        "skipped_existing": skipped_existing,
        "_inserted_rows": inserted_rows,
    }


async def ingest_instagram_4g_batch(
    result: InstagramTargetCrawlResult,
    *,
    post_limit: int = DEFAULT_MAX_POSTS,
    max_age_days: int = 14,
    proxy_node: str = "proxy-01",
    run_id: Optional[str] = None,
) -> InstagramTargetCrawlResult:
    """Persist Instagram posts -> Audit Log -> Immediate AI Lead Scoring -> Target Stats."""
    from app.modules.all_platform.services.crawled_post_audit_service import (
        record_crawled_posts_audit_sync,
    )
    from app.modules.all_platform.services.lead_score_service import score_and_save_posts

    if not result.posts:
        await asyncio.to_thread(
            record_instagram_target_result,
            result.target_type,
            result.target_value,
            0,
            0,
            result.error,
        )
        return result

    batch = await asyncio.to_thread(
        save_instagram_crawl_batch,
        posts=result.posts,
        keyword=result.target_value,
        target_type=result.target_type,
        id_member=None,
        post_limit=post_limit,
        max_age_days=max_age_days,
    )
    inserted_rows = batch.get("_inserted_rows") or []
    result.saved_count = int(batch.get("count") or 0)
    result.skipped_existing += int(batch.get("skipped_existing") or 0)

    if inserted_rows:
        prefix = f"IG @{result.target_value}" if result.target_type == "profile" else f"Instagram: {result.target_value}"
        audit_entries = [
            {
                "platform": "instagram",
                "crawl_source": "public_4g",
                "run_id": run_id,
                "proxy_node": proxy_node,
                "group_name": prefix,
                "group_url": result.discovery_url,
                "post_id": row.get("id"),
                "post_url": str(row.get("post_url") or ""),
                "author_name": row.get("author_name") or row.get("author_username"),
                "content": row.get("content") or "",
                "post_time": row.get("post_time"),
                "reactions": int(row.get("reactions") or 0),
                "comments": int(row.get("comments") or 0),
                "shares": int(row.get("shares") or 0),
                "ai_status": "pending",
            }
            for row in inserted_rows
            if row.get("post_url")
        ]
        if audit_entries:
            await asyncio.to_thread(record_crawled_posts_audit_sync, audit_entries)

        score_res = await score_and_save_posts(
            TABLE_POSTS,
            inserted_rows,
            group_name=prefix,
            keywords=[result.target_value],
            crawl_source="public_4g",
            proxy_node=proxy_node,
            run_id=run_id,
            group_url=result.discovery_url,
        )
        score_dict = score_res or {}
        result.high_score_count = int(score_dict.get("high") or score_dict.get("high_score") or 0)
        result.ai_checked_count = int(score_dict.get("total") or len(inserted_rows))

    await asyncio.to_thread(
        record_instagram_target_result,
        result.target_type,
        result.target_value,
        result.saved_count,
        result.high_score_count,
        result.error,
    )
    return result


# ── Instagram Targets Registry CRUD ───────────────────────────────────────────

def list_instagram_targets(active_only: bool = False) -> list[dict[str, Any]]:
    try:
        sb = get_supabase_client()
        q = sb.table(TABLE_TARGETS).select("*").order("created_at", desc=True)
        if active_only:
            q = q.eq("is_active", True)
        res = q.execute()
        return list(res.data or [])
    except Exception as exc:
        logger.debug("[IG-NO-ACC] list_instagram_targets fallback empty (%s)", exc)
        return []


def add_instagram_targets(
    *,
    target_type: str,
    values: list[str],
    topic: str = "Chung",
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    t_type = "profile" if str(target_type).strip().lower() == "profile" else "keyword"
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in values:
        val = normalize_instagram_username(raw) if t_type == "profile" else str(raw or "").strip()
        if not val or val.lower() in seen:
            continue
        seen.add(val.lower())
        cleaned.append(val)

    if not cleaned:
        return {"success": False, "added_count": 0, "items": [], "message": "Danh sách target Instagram trống."}

    sb = get_supabase_client()
    now_iso = _utc_now_iso()
    rows = [
        {
            "target_type": t_type,
            "target_value": val,
            "topic": (topic or "Chung").strip(),
            "is_active": True,
            "created_by": created_by,
            "updated_at": now_iso,
        }
        for val in cleaned
    ]
    res = sb.table(TABLE_TARGETS).upsert(rows, on_conflict="target_type,target_value").execute()
    inserted = list(res.data or [])
    return {
        "success": True,
        "added_count": len(inserted),
        "items": inserted,
        "message": f"Đã thêm {len(inserted)} mục tiêu Instagram ({t_type}).",
    }


def delete_instagram_target(target_id: str) -> bool:
    try:
        sb = get_supabase_client()
        sb.table(TABLE_TARGETS).delete().eq("id", target_id).execute()
        return True
    except Exception as exc:
        logger.warning("[IG-NO-ACC] delete_instagram_target failed: %s", exc)
        return False


def toggle_instagram_target(target_id: str, is_active: Optional[bool] = None) -> bool:
    try:
        sb = get_supabase_client()
        if is_active is None:
            cur = sb.table(TABLE_TARGETS).select("is_active").eq("id", target_id).limit(1).execute()
            if not cur.data:
                return False
            is_active = not bool(cur.data[0].get("is_active", True))
        sb.table(TABLE_TARGETS).update({"is_active": bool(is_active), "updated_at": _utc_now_iso()}).eq("id", target_id).execute()
        return True
    except Exception as exc:
        logger.warning("[IG-NO-ACC] toggle_instagram_target failed: %s", exc)
        return False


def record_instagram_target_result(
    target_type: str,
    target_value: str,
    found_count: int,
    high_score_count: int,
    error: Optional[str] = None,
) -> None:
    try:
        sb = get_supabase_client()
        cur = (
            sb.table(TABLE_TARGETS)
            .select("id, times_used, total_posts_found, high_score_posts")
            .eq("target_type", target_type)
            .eq("target_value", target_value)
            .limit(1)
            .execute()
        )
        if not cur.data:
            return
        row = cur.data[0]
        sb.table(TABLE_TARGETS).update(
            {
                "times_used": int(row.get("times_used") or 0) + 1,
                "total_posts_found": int(row.get("total_posts_found") or 0) + max(0, int(found_count)),
                "high_score_posts": int(row.get("high_score_posts") or 0) + max(0, int(high_score_count)),
                "last_crawled_at": _utc_now_iso(),
                "last_error": (error[:300] if error else None),
                "updated_at": _utc_now_iso(),
            }
        ).eq("id", row["id"]).execute()
    except Exception as exc:
        logger.debug("[IG-NO-ACC] record_instagram_target_result skipped (%s)", exc)
