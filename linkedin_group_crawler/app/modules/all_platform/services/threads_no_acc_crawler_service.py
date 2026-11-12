"""Zero-Account Rotating 4G Threads Crawler Service.

Extracts public Threads posts from `https://www.threads.com/search?q=<kw>&serp_type=default`
in unauthenticated Playwright Guest mode behind the shared `RotatingProxyPool`
(blocking heavy images/media/fonts, waiting for Relay hydration, combining
embedded JSON + DOM extraction, and filtering replies/comments strictly).
Extracted batches feed directly into `save_threads_crawl_batch` ->
`record_crawled_posts_audit_sync` -> `score_and_save_posts("threads_posts")` ->
`threads_keyword_service.record_keyword_result`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)

_THREADS_EMPTY_MARKERS = (
    "không có kết quả nào",
    "không tìm thấy kết quả",
    "no results found",
    "try another search",
    "thử tìm kiếm khác",
)

_THREADS_LOGIN_MARKERS = (
    "hãy tiếp tục bằng instagram",
    "continue with instagram",
    "log in to continue",
    "đăng nhập để tiếp tục",
    "đăng nhập hoặc đăng ký",
    "log in or sign up",
    "create an account",
)

_THREADS_RATE_LIMIT_MARKERS = (
    "something went wrong",
    "try again later",
    "please wait a few minutes",
    "rate limit",
    "too many requests",
    "đã xảy ra lỗi",
    "vui lòng thử lại sau",
)

_POST_URL_REGEX = re.compile(r"https?://(?:www\.)?threads\.(?:net|com)/@([^/?#]+)/post/([A-Za-z0-9_-]+)", re.I)

_JS_EXTRACT_THREADS_EMBEDDED_JSON = r"""
() => {
  const results = [];
  const seen = new Set();

  function parseCaptionText(post) {
    if (!post || typeof post !== 'object') return '';
    if (typeof post.caption === 'string') return post.caption;
    if (post.caption && typeof post.caption.text === 'string') return post.caption.text;
    const fragments = post.text_post_app_info && post.text_post_app_info.text_fragments && post.text_post_app_info.text_fragments.fragments;
    if (Array.isArray(fragments)) {
      return fragments.map((f) => (f && f.plaintext) || '').join('');
    }
    return '';
  }

  function collect(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) collect(item);
      return;
    }

    if (Array.isArray(obj.thread_items)) {
      const items = obj.thread_items;
      items.forEach((item, idx) => {
        const post = item && (item.post || item);
        if (!post || typeof post !== 'object' || !post.code) return;
        const user = post.user || {};
        const username = String(user.username || '').trim().replace(/^@+/, '');
        if (!username) return;
        const url = `https://www.threads.com/@${username}/post/${post.code}`;
        if (seen.has(url)) return;

        const tpInfo = post.text_post_app_info || {};
        const replyInfo = item.reply_to_author || tpInfo.reply_to_author || tpInfo.direct_reply_count_text;
        const isReply = Boolean(
          idx > 0 ||
          post.is_reply ||
          item.is_reply ||
          (tpInfo && tpInfo.is_reply) ||
          (tpInfo && tpInfo.reply_to_author)
        );
        if (isReply) return;

        seen.add(url);
        const imgs = [];
        const candidates = post.image_versions2 && post.image_versions2.candidates;
        if (Array.isArray(candidates) && candidates.length && candidates[0] && candidates[0].url) {
          imgs.push(String(candidates[0].url));
        }
        if (Array.isArray(post.carousel_media)) {
          for (const m of post.carousel_media) {
            const c = m && m.image_versions2 && m.image_versions2.candidates;
            if (Array.isArray(c) && c.length && c[0] && c[0].url) imgs.push(String(c[0].url));
          }
        }
        const vids = post.video_versions;
        const videoUrl = Array.isArray(vids) && vids.length && vids[0] && vids[0].url ? String(vids[0].url) : null;
        const takenAt = Number(post.taken_at || 0);
        const postTime = takenAt > 1e8 ? new Date(takenAt * 1000).toISOString() : null;

        results.push({
          post_url: url,
          post_code: String(post.code),
          author_username: username,
          author_name: String(user.full_name || username).trim(),
          content: String(parseCaptionText(post) || '').trim(),
          post_time: postTime,
          reactions: Number(post.like_count || 0) || 0,
          comments: Number((tpInfo && tpInfo.direct_reply_count) || 0) || 0,
          shares: Number((tpInfo && (tpInfo.repost_count || tpInfo.reshare_count)) || 0) || 0,
          media_url: videoUrl,
          image_urls: imgs.slice(0, 10),
          is_reply: false,
          source: 'embedded_json',
        });
      });
    }

    for (const k of Object.keys(obj)) {
      if (k === 'extensions' || k === '__bbox' && obj[k] === null) continue;
      collect(obj[k]);
    }
  }

  const scripts = document.querySelectorAll('script[type="application/json"]');
  for (const s of scripts) {
    const raw = s.textContent || '';
    if (!raw || (!raw.includes('taken_at') && !raw.includes('thread_items'))) continue;
    try {
      collect(JSON.parse(raw));
    } catch (_err) {}
  }

  return results;
}
"""

_JS_EXTRACT_THREADS_DOM = r"""
(maxPosts) => {
  const out = [];
  const seen = new Set();
  const bodyText = (document.body && document.body.innerText) || '';

  function parseCountText(raw) {
    if (!raw) return 0;
    const s = String(raw).trim().replace(/,/g, '.').replace(/\s+/g, '');
    const m = s.match(/^([\d.]+)([KMBkmb]|nghìn|tr|triệu)?$/i);
    if (!m) {
      const d = s.match(/\d+/);
      return d ? parseInt(d[0], 10) : 0;
    }
    const num = parseFloat(m[1]) || 0;
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k' || suf === 'nghìn') return Math.round(num * 1000);
    if (suf === 'm' || suf === 'tr' || suf === 'triệu') return Math.round(num * 1000000);
    if (suf === 'b') return Math.round(num * 1000000000);
    return Math.round(num);
  }

  function extractActionCounts(card) {
    let reactions = 0, comments = 0, shares = 0;
    const buttons = card.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const svg = btn.querySelector('svg[aria-label]');
      const label = ((btn.getAttribute('aria-label') || '') + ' ' + ((svg && svg.getAttribute('aria-label')) || '')).toLowerCase();
      const txt = (btn.innerText || '').trim();
      const numMatch = txt.match(/[\d.,]+\s*[kKmMbB]?/);
      const val = numMatch ? parseCountText(numMatch[0]) : 0;
      if (!val) continue;
      if (/like|thích|bỏ thích|unlike/.test(label)) reactions = Math.max(reactions, val);
      else if (/reply|comment|trả lời|bình luận/.test(label)) comments = Math.max(comments, val);
      else if (/repost|share|đăng lại|chia sẻ/.test(label)) shares = Math.max(shares, val);
    }
    return { reactions, comments, shares };
  }

  function cleanCardContent(card, username) {
    const clone = card.cloneNode(true);
    // Strip timestamps, SVGs, buttons, videos and exact author handle links so text stays clean
    clone.querySelectorAll('time, svg, button, video').forEach((el) => el.remove());
    if (username) {
      clone.querySelectorAll(`a[href="/@${username}"], a[href="/@${username}/"]`).forEach((a) => {
        const txt = (a.innerText || '').trim().toLowerCase().replace(/^@/, '');
        if (txt === username.toLowerCase()) a.remove();
      });
    }
    // Prevent adjacent inline <span> / <a> elements from gluing together without whitespace
    clone.querySelectorAll('a, div, p, span').forEach((el) => {
      if (el.childElementCount === 0 && el.textContent && !/\s$/.test(el.textContent)) {
        el.appendChild(document.createTextNode('\n'));
      }
    });
    // Collect meaningful text blocks excluding author handle links
    const rawLines = (clone.innerText || clone.textContent || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const uiNoise = new Set([
      'theo dõi', 'follow', 'đang theo dõi', 'following',
      'đã xác minh', 'verified', 'dịch', 'translate', 'xem bản dịch',
      'xem thêm', 'see more', 'thu gọn', 'được tài trợ', 'sponsored',
      'tác giả', 'author', 'thích', 'bình luận', 'đăng lại', 'chia sẻ',
      'xem hoạt động', 'view activity', 'gắn thẻ',
    ]);

    const filtered = [];
    for (const line of rawLines) {
      const low = line.toLowerCase();
      if (uiNoise.has(low)) continue;
      if (username && (low === username.toLowerCase() || low === `@${username.toLowerCase()}`)) continue;
      if (/^\d{1,3}([.,]\d+)?[kKmMbB]?$/.test(line)) continue;
      if (/^\d+\s*(giờ|phút|giây|ngày|tuần|tháng|năm|h|m|d|w|y|s)(\s*trước)?$/i.test(line)) continue;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(line)) continue;
      if (/^(trả lời|replying to)\s+@/i.test(line)) return '';
      if (!filtered.length || filtered[filtered.length - 1] !== line) {
        filtered.push(line);
      }
    }
    return filtered.join('\n').trim();
  }

  const postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]'));
  for (const link of postLinks) {
    const href = link.href || link.getAttribute('href') || '';
    const m = href.match(/\/@([^/?#]+)\/post\/([A-Za-z0-9_-]+)/);
    if (!m) continue;
    const username = m[1];
    const code = m[2];
    const postUrl = `https://www.threads.com/@${username}/post/${code}`;
    if (seen.has(postUrl)) continue;

    // Walk up to find the pressable/post card containing text for THIS post only
    let card = link.closest('[data-pressable-container="true"]') || link.closest('article') || link.parentElement;
    for (let depth = 0; depth < 6 && card; depth++) {
      const linksInside = card.querySelectorAll('a[href*="/post/"]');
      const distinctCodes = new Set();
      for (const l of linksInside) {
        const cm = (l.getAttribute('href') || '').match(/\/post\/([A-Za-z0-9_-]+)/);
        if (cm) distinctCodes.add(cm[1]);
      }
      if (distinctCodes.size > 1) break;
      if ((card.innerText || '').trim().length > 25 && card.parentElement) {
        const pLinks = card.parentElement.querySelectorAll('a[href*="/post/"]');
        const pCodes = new Set();
        for (const pl of pLinks) {
          const pcm = (pl.getAttribute('href') || '').match(/\/post\/([A-Za-z0-9_-]+)/);
          if (pcm) pCodes.add(pcm[1]);
        }
        if (pCodes.size === 1) {
          card = card.parentElement;
          continue;
        }
      }
      if ((card.innerText || '').trim().length > 15) break;
      card = card.parentElement;
    }

    if (!card) continue;

    // Reply/comment guard in card text
    const cardText = (card.innerText || '').trim();
    if (/^(đang\s+)?trả lời\s+@/im.test(cardText) || /^replying to\s+@/im.test(cardText)) {
      continue;
    }

    const timeEl = card.querySelector('time[datetime]') || link.querySelector('time[datetime]');
    const timeDt = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText || '') : (link.innerText || '');
    const content = cleanCardContent(card, username);
    if (!content || content.length < 4) continue;

    const counts = extractActionCounts(card);
    const images = Array.from(card.querySelectorAll('img[src]'))
      .map((img) => img.getAttribute('src') || '')
      .filter((src) => src && !src.includes('profile_pic') && !src.includes('s150x150') && !src.startsWith('data:'))
      .slice(0, 10);

    seen.add(postUrl);
    out.push({
      post_url: postUrl,
      post_code: code,
      author_username: username,
      author_name: username,
      content,
      post_time: timeDt ? String(timeDt).trim() : null,
      reactions: counts.reactions,
      comments: counts.comments,
      shares: counts.shares,
      media_url: null,
      image_urls: images,
      is_reply: false,
      source: 'dom',
    });

    if (out.length >= (maxPosts || 30)) break;
  }

  return {
    posts: out,
    linkCount: postLinks.length,
    bodySnippet: bodyText.slice(0, 1200),
    pageUrl: location.href,
  };
}
"""


def build_threads_search_url(keyword: str) -> str:
    """Build deterministic public Guest search URL for Threads."""
    return f"https://www.threads.com/search?q={quote_plus(str(keyword or '').strip())}&serp_type=default"


def normalize_threads_time_raw(raw_time: Optional[str], now_utc: Optional[datetime] = None) -> Optional[str]:
    """Normalize ISO timestamps or relative VN/EN labels returned from Threads DOM into ISO UTC."""
    if not raw_time:
        return None
    s = str(raw_time).strip()
    if not s:
        return None
    now = now_utc or datetime.now(timezone.utc)

    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except ValueError:
        pass

    low = s.lower()
    m = re.search(r"(\d+)\s*(giây|s|phút|m|giờ|h|ngày|d|tuần|w)\b", low)
    if m:
        val = int(m.group(1))
        unit = m.group(2)
        if unit in ("giây", "s"):
            return (now - timedelta(seconds=val)).isoformat()
        if unit in ("phút", "m"):
            return (now - timedelta(minutes=val)).isoformat()
        if unit in ("giờ", "h"):
            return (now - timedelta(hours=val)).isoformat()
        if unit in ("ngày", "d"):
            return (now - timedelta(days=val)).isoformat()
        if unit in ("tuần", "w"):
            return (now - timedelta(weeks=val)).isoformat()

    m_date = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
    if m_date:
        day, month, year = int(m_date.group(1)), int(m_date.group(2)), int(m_date.group(3))
        if year < 100:
            year += 2000
        try:
            vn_tz = timezone(timedelta(hours=7))
            return datetime(year, month, day, 12, 0, tzinfo=vn_tz).astimezone(timezone.utc).isoformat()
        except ValueError:
            return None
    return None


def merge_threads_extracted_posts(
    embedded_posts: list[dict[str, Any]],
    dom_posts: list[dict[str, Any]],
    max_posts: int = 30,
) -> list[dict[str, Any]]:
    """Merge Embedded Relay JSON posts and DOM-rendered posts keyed by canonical post_url."""
    by_url: dict[str, dict[str, Any]] = {}

    def _absorb(items: list[dict[str, Any]], prefer_richer: bool = True) -> None:
        for raw in items:
            url = str(raw.get("post_url") or "").strip()
            m = _POST_URL_REGEX.match(url)
            if not m:
                continue
            username, code = m.group(1), m.group(2)
            canon_url = f"https://www.threads.com/@{username}/post/{code}"
            norm_time = normalize_threads_time_raw(raw.get("post_time")) or raw.get("post_time")
            content = str(raw.get("content") or "").strip()
            entry = {
                "post_url": canon_url,
                "post_code": code,
                "author_username": str(raw.get("author_username") or username).strip().lstrip("@"),
                "author_name": str(raw.get("author_name") or username).strip(),
                "content": content,
                "post_time": norm_time,
                "reactions": int(raw.get("reactions") or 0),
                "comments": int(raw.get("comments") or 0),
                "shares": int(raw.get("shares") or 0),
                "media_url": raw.get("media_url"),
                "image_urls": list(raw.get("image_urls") or [])[:10],
                "is_reply": bool(raw.get("is_reply")),
            }
            existing = by_url.get(canon_url)
            if existing is None:
                by_url[canon_url] = entry
                continue
            if prefer_richer:
                if len(entry["content"]) > len(existing["content"]):
                    existing["content"] = entry["content"]
                if not existing.get("post_time") and entry.get("post_time"):
                    existing["post_time"] = entry["post_time"]
                if existing.get("author_name") == existing.get("author_username") and entry.get("author_name"):
                    existing["author_name"] = entry["author_name"]
                existing["reactions"] = max(existing["reactions"], entry["reactions"])
                existing["comments"] = max(existing["comments"], entry["comments"])
                existing["shares"] = max(existing["shares"], entry["shares"])
                if not existing.get("media_url") and entry.get("media_url"):
                    existing["media_url"] = entry["media_url"]
                if not existing.get("image_urls") and entry.get("image_urls"):
                    existing["image_urls"] = entry["image_urls"]

    _absorb(embedded_posts, prefer_richer=False)
    _absorb(dom_posts, prefer_richer=True)

    merged = [v for v in by_url.values() if not v.get("is_reply") and len(v.get("content") or "") >= 4]
    return merged[: max(1, max_posts)]


def classify_threads_page_state(
    *,
    http_status: Optional[int],
    final_url: str,
    body_snippet: str,
    extracted_count: int,
) -> tuple[str, bool, str]:
    """Classify Threads Guest search outcome cleanly for rotation decisions.

    Returns `(status, should_rotate, detail)`.
    Note: Threads Guest renders the sidebar CTA ("Đăng nhập hoặc đăng ký Threads /
    Tiếp tục bằng Instagram") on EVERY page including valid empty search pages, and
    extracted post text may legitimately contain phrases like "something went wrong".
    Therefore we check: real `/login` redirect -> HTTP 429 -> extracted_count > 0
    -> empty search markers -> rate-limit text -> login-wall text.
    """
    low = (body_snippet or "").lower()
    url_low = (final_url or "").lower()

    if "/login" in url_low or "/accounts/login" in url_low or "instagram.com/accounts" in url_low:
        return ("login_wall", True, "Threads điều hướng về trang đăng nhập (/login)")

    if http_status == 429:
        return ("rate_limited", True, "Threads yêu cầu tạm chậm (HTTP 429)")

    if extracted_count > 0:
        return ("ok", False, f"Trích xuất {extracted_count} bài Threads")

    if any(m in low for m in _THREADS_EMPTY_MARKERS):
        return ("empty", False, "Không có bài Threads khớp từ khóa")

    if any(m in low for m in _THREADS_RATE_LIMIT_MARKERS):
        return ("rate_limited", True, "Threads yêu cầu tạm chậm (429/rate-limit)")

    if any(m in low for m in _THREADS_LOGIN_MARKERS):
        return ("login_wall", True, "Threads yêu cầu đăng nhập / challenge")

    if http_status and http_status >= 400:
        return ("http_error", True, f"HTTP {http_status} từ Threads")

    return ("empty_or_throttled", True, "Threads không render kết quả (có thể IP đang bị soft-limit)")


@dataclass
class ThreadsKeywordCrawlResult:
    keyword: str
    search_url: str
    status: str  # ok | empty | login_wall | rate_limited | empty_or_throttled | transport_error | proxy_expired | http_error
    should_rotate: bool = False
    raw_extracted: int = 0
    saved_count: int = 0
    high_score_count: int = 0
    ai_checked_count: int = 0
    skipped_invalid: int = 0
    skipped_old: int = 0
    skipped_existing: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
    posts: list[dict[str, Any]] = field(default_factory=list)


async def crawl_threads_keyword_guest(
    page: Any,
    keyword: str,
    *,
    max_posts: int = 20,
    scrolls: int = 0,
    hydrate_wait_sec: float = 5.0,
    is_proxy_expired_fn: Optional[Callable[[str], bool]] = None,
) -> ThreadsKeywordCrawlResult:
    """Open `threads.com/search` in Guest Playwright page and extract posts without login."""
    t0 = time.monotonic()
    search_url = build_threads_search_url(keyword)
    http_status: Optional[int] = None

    try:
        response = await page.goto(search_url, wait_until="domcontentloaded", timeout=28000)
        if response is not None:
            http_status = response.status

        # Threads SSR embeds only 1 seed post; Relay client hydration renders ~15-26 cards within 2-4.5s
        deadline = time.monotonic() + max(2.0, min(8.0, hydrate_wait_sec))
        while time.monotonic() < deadline:
            probe = await page.evaluate(
                """() => {
                    const count = document.querySelectorAll('a[href*="/post/"]').length;
                    const txt = ((document.body && document.body.innerText) || '').toLowerCase();
                    const empty = txt.includes('không có kết quả nào') || txt.includes('không tìm thấy kết quả') || txt.includes('no results found');
                    const blocked = count === 0 && !empty && (
                        location.pathname.toLowerCase().includes('/login') ||
                        txt.includes('log in to continue') ||
                        txt.includes('đăng nhập để tiếp tục') ||
                        txt.includes('something went wrong')
                    );
                    return { count, empty, blocked };
                }"""
            )
            if probe.get("empty") or probe.get("blocked"):
                break
            if int(probe.get("count") or 0) >= 8:
                await asyncio.sleep(0.35)
                break
            await asyncio.sleep(0.3)

        # Light scroll passes only if explicitly requested (Guest blocks page-2+ GraphQL pagination)
        for _ in range(max(0, min(2, scrolls))):
            await page.evaluate("() => window.scrollBy(0, 1200)")
            await asyncio.sleep(0.75)

        # Dismiss/hide any Instagram login modal overlay so DOM text & cards remain clean
        await page.evaluate(
            """() => {
                document.querySelectorAll('[role="dialog"], [aria-modal="true"]').forEach((el) => {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                });
            }"""
        )

        embedded = await page.evaluate(_JS_EXTRACT_THREADS_EMBEDDED_JSON)
        dom_res = await page.evaluate(_JS_EXTRACT_THREADS_DOM, max(10, min(40, max_posts * 2)))
        dom_posts = (dom_res or {}).get("posts") or []
        body_snippet = str((dom_res or {}).get("bodySnippet") or "")
        final_url = str((dom_res or {}).get("pageUrl") or page.url or search_url)

        merged = merge_threads_extracted_posts(
            embedded_posts=embedded if isinstance(embedded, list) else [],
            dom_posts=dom_posts if isinstance(dom_posts, list) else [],
            max_posts=max(10, max_posts * 2),
        )
        status, should_rotate, detail = classify_threads_page_state(
            http_status=http_status,
            final_url=final_url,
            body_snippet=body_snippet,
            extracted_count=len(merged),
        )
        return ThreadsKeywordCrawlResult(
            keyword=keyword,
            search_url=search_url,
            status=status,
            should_rotate=should_rotate,
            raw_extracted=len(merged),
            duration_ms=int((time.monotonic() - t0) * 1000),
            error=None if status in ("ok", "empty") else detail,
            posts=merged,
        )
    except Exception as exc:
        err_text = str(exc)
        expired = bool(is_proxy_expired_fn(err_text)) if is_proxy_expired_fn else False
        return ThreadsKeywordCrawlResult(
            keyword=keyword,
            search_url=search_url,
            status="proxy_expired" if expired else "transport_error",
            should_rotate=True,
            duration_ms=int((time.monotonic() - t0) * 1000),
            error=err_text[:280],
        )


async def ingest_threads_4g_keyword_batch(
    result: ThreadsKeywordCrawlResult,
    *,
    keyword: str,
    post_limit: int = 20,
    max_age_days: int = 7,
    proxy_node: str = "proxy-01",
    run_id: Optional[str] = None,
) -> ThreadsKeywordCrawlResult:
    """Persist Threads No-Acc posts -> Audit Log -> Immediate AI Lead Scoring -> Keyword Registry."""
    from app.modules.all_platform.services.crawled_post_audit_service import (
        record_crawled_posts_audit_sync,
    )
    from app.modules.all_platform.services.lead_score_service import score_and_save_posts
    from app.modules.all_platform.services.supabase_threads_extension_crawl_service import (
        save_threads_crawl_batch,
    )
    from app.modules.all_platform.services.threads_keyword_service import (
        record_keyword_result,
    )

    if not result.posts:
        await asyncio.to_thread(record_keyword_result, keyword, 0, 0)
        return result

    batch = await asyncio.to_thread(
        save_threads_crawl_batch,
        posts=result.posts,
        keyword=keyword,
        id_member=None,
        post_limit=post_limit,
        max_age_days=max_age_days,
    )

    inserted_rows = batch.get("_inserted_rows") or []
    result.saved_count = int(batch.get("count") or 0)
    result.skipped_invalid = int(batch.get("skipped_invalid") or 0)
    result.skipped_old = int(batch.get("skipped_old") or 0)
    result.skipped_existing = int(batch.get("skipped_existing") or 0)

    if inserted_rows:
        group_label = f"Threads: {keyword}"
        await asyncio.to_thread(
            record_crawled_posts_audit_sync,
            platform="threads",
            crawl_source="public_4g",
            run_id=run_id,
            proxy_node=proxy_node,
            group_name=group_label,
            group_url=result.search_url,
            posts=inserted_rows,
        )
        score_res = await score_and_save_posts(
            "threads_posts",
            inserted_rows,
            group_name=group_label,
            keywords=[keyword],
            crawl_source="public_4g",
            proxy_node=proxy_node,
            run_id=run_id,
            group_url=result.search_url,
        )
        result.high_score_count = int((score_res or {}).get("high_score") or 0)
        result.ai_checked_count = int((score_res or {}).get("scored") or len(inserted_rows))

    await asyncio.to_thread(
        record_keyword_result,
        keyword,
        result.raw_extracted,
        result.high_score_count,
    )
    return result
