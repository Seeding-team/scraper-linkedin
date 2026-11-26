"""Zero-Account LinkedIn B2B Crawler Service (Phase 3).

Combines two verified 100% No-Acc channels (zero `li_at` cookie, zero Chrome RAM):
1. **Channel 1 — LinkedIn Guest Jobs Buying-Intent API** (`httpx` / TLS pure HTTP):
   - Search: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=...&location=...&f_TPR=r604800`
   - Detail: `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<job_id>`
   Captures high-intent B2B hiring signals (companies actively recruiting for tools,
   roles, marketing, cybersecurity, ERP, cloud, dev teams) with 0 account risk.
2. **Channel 2 — LinkedIn Public Post Discovery via Search Index** (`httpx` pure HTTP):
   - Queries DuckDuckGo HTML index for `site:linkedin.com/posts` & `site:linkedin.com/pulse`
     to uncover public B2B inquiry posts without hitting LinkedIn's `/pulse` or `/company` JS wall.
3. **Channel 3 — `LinkedInGroupSafetyGuard`**:
   - Protects existing authenticated LinkedIn Group (`li_at`) accounts with 1-Account-1-Sticky-Proxy
     binding checks and daily scroll/group rate caps.

Results save directly into `linkedin_posts` (with `post_kind = 'job_intent'` or `'public_post'`)
so 100% of existing AI lead scoring (`score_and_save_posts`), KPI, and Post Feed UI work seamlessly.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

TABLE_TARGETS = "linkedin_no_acc_targets"
DEFAULT_LOCATION = "Vietnam"
DEFAULT_MAX_JOBS = 15
MAX_JOBS_CAP = 30

_LI_GUEST_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.linkedin.com/jobs/search",
}

_JOB_ID_RE = re.compile(r"(?:jobPosting:|/jobs/view/[^/?#]*-|/jobs/view/)(\d{6,15})")
_LI_POST_URL_RE = re.compile(
    r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:posts|pulse)/[^\s\"'<>&#?]+",
    re.IGNORECASE,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_linkedin_jobs_guest_url(
    keyword: str,
    *,
    location: str = DEFAULT_LOCATION,
    start: int = 0,
    time_window_sec: int = 604800,
) -> str:
    """Build LinkedIn public Guest Jobs API search URL (verified HTTP 200 without auth)."""
    kw = quote_plus(str(keyword or "").strip())
    loc = quote_plus(str(location or DEFAULT_LOCATION).strip())
    return (
        "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
        f"?keywords={kw}&location={loc}&f_TPR=r{max(3600, int(time_window_sec))}&start={max(0, int(start))}"
    )


def build_linkedin_job_detail_url(job_id: str) -> str:
    jid = re.sub(r"\D", "", str(job_id or ""))
    return f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jid}"


def build_linkedin_search_index_query(keyword: str) -> str:
    kw = str(keyword or "").strip()
    return f'(site:linkedin.com/posts OR site:linkedin.com/pulse) "{kw}"'


def parse_linkedin_jobs_search_html(html: str, limit: int = DEFAULT_MAX_JOBS) -> list[dict[str, Any]]:
    """Parse LinkedIn `/jobs-guest/jobs/api/seeMoreJobPostings/search` HTML list items."""
    if not html or "<li" not in html.lower():
        return []

    soup = BeautifulSoup(html, "html.parser")
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for card in soup.select("li"):
        base_card = card.select_one("[data-entity-urn], .base-card") or card
        urn = str(base_card.get("data-entity-urn") or "")
        link_el = card.select_one("a.base-card__full-link, a[href*='/jobs/view/']")
        href = str((link_el.get("href") if link_el else "") or "").strip()

        m_id = _JOB_ID_RE.search(urn) or _JOB_ID_RE.search(href)
        if not m_id:
            continue
        job_id = m_id.group(1)
        if job_id in seen_ids:
            continue
        seen_ids.add(job_id)

        title_el = card.select_one("h3.base-search-card__title, .base-search-card__title")
        comp_el = card.select_one("h4.base-search-card__subtitle, .base-search-card__subtitle")
        loc_el = card.select_one(".job-search-card__location")
        time_el = card.select_one("time[datetime]")

        title = title_el.get_text(" ", strip=True) if title_el else ""
        company = comp_el.get_text(" ", strip=True) if comp_el else ""
        location = loc_el.get_text(" ", strip=True) if loc_el else ""
        posted_at = (time_el.get("datetime") or time_el.get_text(" ", strip=True)) if time_el else None

        canonical_url = f"https://www.linkedin.com/jobs/view/{job_id}/"
        if not title and not company:
            continue

        results.append(
            {
                "job_id": job_id,
                "post_url": canonical_url,
                "title": title,
                "company_name": company,
                "job_location": location,
                "posted_at": str(posted_at).strip() if posted_at else None,
                "post_kind": "job_intent",
            }
        )
        if len(results) >= max(1, int(limit)):
            break

    return results


def parse_linkedin_job_detail_html(html: str, base_item: dict[str, Any]) -> dict[str, Any]:
    """Enrich a parsed job summary with full JD description & criteria from `/jobPosting/<id>`."""
    out = dict(base_item)
    description_text = ""
    criteria_pairs: list[str] = []

    if html:
        soup = BeautifulSoup(html, "html.parser")
        if not out.get("title"):
            t = soup.select_one("h2.top-card-layout__title, h1")
            if t:
                out["title"] = t.get_text(" ", strip=True)
        if not out.get("company_name"):
            c = soup.select_one("a.topcard__org-name-link, .topcard__flavor")
            if c:
                out["company_name"] = c.get_text(" ", strip=True)

        desc_el = soup.select_one(".show-more-less-html__markup, .description__text")
        if desc_el:
            description_text = desc_el.get_text("\n", strip=True)

        for crit in soup.select("li.description__job-criteria-item"):
            h = crit.select_one(".description__job-criteria-subheader")
            v = crit.select_one(".description__job-criteria-text")
            if h and v:
                criteria_pairs.append(f"{h.get_text(' ', strip=True)}: {v.get_text(' ', strip=True)}")

    title = out.get("title") or "Vị trí tuyển dụng"
    company = out.get("company_name") or "Doanh nghiệp LinkedIn"
    location = out.get("job_location") or ""
    header = f"[Tuyển dụng B2B] {company} đang tuyển: {title}"
    if location:
        header += f" ({location})"

    parts = [header]
    if criteria_pairs:
        parts.append(" | ".join(criteria_pairs[:4]))
    if description_text:
        parts.append(description_text[:3200])

    out["author"] = company
    out["content"] = "\n\n".join(parts).strip()
    out["post_kind"] = "job_intent"
    return out


def _unwrap_duckduckgo_redirect(href: str) -> str:
    raw = str(href or "").strip()
    if "uddg=" in raw:
        try:
            parsed = urlparse(raw)
            uddg = (parse_qs(parsed.query).get("uddg") or [""])[0]
            if uddg:
                return unquote(uddg)
        except Exception:
            pass
    return raw


def parse_duckduckgo_html_linkedin_results(html: str, *, keyword: str, limit: int = 12) -> list[dict[str, Any]]:
    """Parse DuckDuckGo HTML SERP for public `linkedin.com/posts` & `linkedin.com/pulse` leads."""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    for block in soup.select(".result, .web-result"):
        a = block.select_one("a.result__a, a[href*='linkedin.com']")
        if not a:
            continue
        href = _unwrap_duckduckgo_redirect(a.get("href") or "")
        m = _LI_POST_URL_RE.search(href)
        if not m:
            continue
        canon_url = m.group(0).rstrip("/")
        if canon_url in seen_urls:
            continue
        seen_urls.add(canon_url)

        title = a.get_text(" ", strip=True)
        snip_el = block.select_one(".result__snippet")
        snippet = snip_el.get_text(" ", strip=True) if snip_el else ""
        content = "\n".join(p for p in (title, snippet) if p).strip()
        if len(content) < 8:
            continue

        # Extract author handle if URL is `/posts/<slug>_...`
        author = "LinkedIn Public"
        m_auth = re.search(r"/posts/([A-Za-z0-9\-]+)_", canon_url)
        if m_auth:
            author = m_auth.group(1).replace("-", " ").title()

        results.append(
            {
                "post_url": canon_url,
                "author": author,
                "content": f"[LinkedIn Public · {keyword}] {content}",
                "posted_at": None,
                "post_kind": "public_post",
                "company_name": None,
                "job_location": None,
            }
        )
        if len(results) >= max(1, int(limit)):
            break

    return results


@dataclass
class LinkedInNoAccCrawlResult:
    keyword: str
    location: str
    channel: str  # jobs_guest | search_index | both
    status: str  # ok | empty | rate_limited | transport_error | proxy_expired | http_error
    should_rotate: bool = False
    jobs_extracted: int = 0
    public_posts_extracted: int = 0
    saved_count: int = 0
    high_score_count: int = 0
    skipped_duplicates: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
    posts: list[dict[str, Any]] = field(default_factory=list)


async def crawl_linkedin_no_acc_keyword(
    keyword: str,
    *,
    location: str = DEFAULT_LOCATION,
    channel: str = "both",
    max_jobs: int = DEFAULT_MAX_JOBS,
    max_public_posts: int = 8,
    proxy_http: Optional[str] = None,
    http_client: Any = None,
    fetch_job_details: bool = True,
    is_proxy_expired_fn: Optional[Callable[[str], bool]] = None,
) -> LinkedInNoAccCrawlResult:
    """Execute No-Acc LinkedIn crawl (Channel 1 Guest Jobs + Channel 2 Search Index) over pure HTTP."""
    t0 = time.monotonic()
    kw = str(keyword or "").strip()
    loc = str(location or DEFAULT_LOCATION).strip() or DEFAULT_LOCATION
    ch = channel if channel in {"jobs_guest", "search_index", "both"} else "both"
    cap_jobs = max(1, min(MAX_JOBS_CAP, int(max_jobs or DEFAULT_MAX_JOBS)))

    collected: list[dict[str, Any]] = []
    jobs_count = 0
    pub_count = 0
    rate_limited = False
    last_err: Optional[str] = None

    own_client = http_client is None
    client = http_client or httpx.AsyncClient(
        proxy=proxy_http,
        timeout=20.0,
        follow_redirects=True,
        headers=_LI_GUEST_HEADERS,
    )

    try:
        # ── Channel 1: LinkedIn Guest Jobs Buying-Intent API ─────────────────
        if ch in {"jobs_guest", "both"}:
            search_url = build_linkedin_jobs_guest_url(kw, location=loc, start=0)
            resp = await client.get(search_url)
            if resp.status_code == 429:
                rate_limited = True
                last_err = "LinkedIn Guest Jobs API trả HTTP 429 (cần xoay IP 4G)"
            elif resp.status_code == 200 and resp.text:
                summaries = parse_linkedin_jobs_search_html(resp.text, limit=cap_jobs)
                for idx, summary in enumerate(summaries):
                    if fetch_job_details and idx < min(cap_jobs, 10):
                        try:
                            d_resp = await client.get(build_linkedin_job_detail_url(summary["job_id"]))
                            if d_resp.status_code == 200 and d_resp.text:
                                enriched = parse_linkedin_job_detail_html(d_resp.text, summary)
                            else:
                                enriched = parse_linkedin_job_detail_html("", summary)
                        except Exception:
                            enriched = parse_linkedin_job_detail_html("", summary)
                        collected.append(enriched)
                        jobs_count += 1
                        await asyncio.sleep(0.25)
                    else:
                        collected.append(parse_linkedin_job_detail_html("", summary))
                        jobs_count += 1
            elif resp.status_code >= 400:
                last_err = f"LinkedIn Guest Jobs API trả HTTP {resp.status_code}"

        # ── Channel 2: LinkedIn Public Post Discovery via Search Index ───────
        if ch in {"search_index", "both"} and not rate_limited:
            try:
                ddg_query = build_linkedin_search_index_query(kw)
                ddg_resp = await client.post(
                    "https://html.duckduckgo.com/html/",
                    data={"q": ddg_query, "kl": "vn-vi"},
                    headers={
                        "User-Agent": _LI_GUEST_HEADERS["User-Agent"],
                        "Accept": "text/html,application/xhtml+xml",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                )
                if ddg_resp.status_code == 200 and ddg_resp.text:
                    pub_items = parse_duckduckgo_html_linkedin_results(
                        ddg_resp.text,
                        keyword=kw,
                        limit=max_public_posts,
                    )
                    collected.extend(pub_items)
                    pub_count = len(pub_items)
            except Exception as ddg_exc:
                logger.debug("[LI-NO-ACC] Search index channel skipped for %s: %s", kw, ddg_exc)

        if collected:
            return LinkedInNoAccCrawlResult(
                keyword=kw,
                location=loc,
                channel=ch,
                status="ok",
                should_rotate=False,
                jobs_extracted=jobs_count,
                public_posts_extracted=pub_count,
                duration_ms=int((time.monotonic() - t0) * 1000),
                posts=collected,
            )

        if rate_limited:
            return LinkedInNoAccCrawlResult(
                keyword=kw,
                location=loc,
                channel=ch,
                status="rate_limited",
                should_rotate=True,
                duration_ms=int((time.monotonic() - t0) * 1000),
                error=last_err,
            )

        return LinkedInNoAccCrawlResult(
            keyword=kw,
            location=loc,
            channel=ch,
            status="http_error" if last_err else "empty",
            should_rotate=bool(last_err),
            duration_ms=int((time.monotonic() - t0) * 1000),
            error=last_err,
        )
    except Exception as exc:
        err_text = str(exc)
        expired = bool(is_proxy_expired_fn(err_text)) if is_proxy_expired_fn else False
        return LinkedInNoAccCrawlResult(
            keyword=kw,
            location=loc,
            channel=ch,
            status="proxy_expired" if expired else "transport_error",
            should_rotate=not expired,
            duration_ms=int((time.monotonic() - t0) * 1000),
            error=err_text[:280],
        )
    finally:
        if own_client and hasattr(client, "aclose"):
            try:
                await client.aclose()
            except Exception:
                pass


def save_linkedin_no_acc_batch(
    *,
    posts: list[dict[str, Any]],
    keyword: str,
    location: str = DEFAULT_LOCATION,
    id_member: Optional[str] = None,
) -> dict[str, Any]:
    """Persist LinkedIn No-Acc items into `linkedin_posts` with `post_kind = 'job_intent' | 'public_post'`."""
    from app.modules.all_platform.services.supabase_linkedin_extension_crawl_service import (
        _get_or_create_extension_account_id,
        _resolve_or_create_group,
    )

    if not posts:
        return {"count": 0, "skipped_duplicates": 0, "_inserted_rows": []}

    sb = get_supabase_client()
    group_url = f"https://www.linkedin.com/jobs/search/?keywords={quote_plus(keyword)}&location={quote_plus(location)}"
    group_name = f"LinkedIn B2B No-Acc: {keyword} ({location})"
    id_group = _resolve_or_create_group(group_url, group_name, id_member)
    id_account_crawl = _get_or_create_extension_account_id()

    all_urls = [str(p.get("post_url") or "").strip() for p in posts if p.get("post_url")]
    existing_urls: set[str] = set()
    if all_urls:
        try:
            res = sb.table("linkedin_posts").select("post_url").in_("post_url", all_urls).execute()
            existing_urls = {r["post_url"] for r in (res.data or []) if r.get("post_url")}
        except Exception as exc:
            logger.warning("[LI-NO-ACC] Could not check duplicate post_url: %s", exc)

    deduped = [p for p in posts if p.get("post_url") and p["post_url"] not in existing_urls]
    skipped_duplicates = len(all_urls) - len(deduped)
    if not deduped:
        return {"count": 0, "skipped_duplicates": skipped_duplicates, "_inserted_rows": []}

    session_id = str(uuid.uuid4())
    now_iso = _utc_now_iso()
    try:
        sb.table("crawl_linkedin_session").insert(
            {
                "id": session_id,
                "posts_count": len(deduped),
                "status": "completed",
                "id_account_crawl": id_account_crawl,
                "id_member": id_member or None,
                "id_platform": 2,
            }
        ).execute()
    except Exception as exc:
        logger.debug("[LI-NO-ACC] Could not insert crawl_linkedin_session: %s", exc)
        session_id = None

    rows_to_insert: list[dict[str, Any]] = []
    for p in deduped:
        row: dict[str, Any] = {
            "post_url": str(p["post_url"]).strip(),
            "author": str(p.get("author") or p.get("company_name") or "LinkedIn").strip()[:250],
            "content": str(p.get("content") or "").strip()[:8000],
            "post_time": p.get("posted_at") or now_iso,
            "crawl_date": now_iso,
            "reactions": int(p.get("reactions") or 0),
            "comments": int(p.get("comments") or 0),
            "shares": int(p.get("shares") or 0),
            "score": 0,
            "id_group": id_group,
            "id_account_crawl": id_account_crawl,
            "session_id": session_id,
            "post_kind": p.get("post_kind") or "job_intent",
            "company_name": p.get("company_name"),
            "job_location": p.get("job_location") or location,
            "crawl_source": "linkedin_no_acc_4g",
        }
        rows_to_insert.append(row)

    inserted_rows: list[dict[str, Any]] = []
    try:
        ins = sb.table("linkedin_posts").insert(rows_to_insert).execute()
        inserted_rows = list(ins.data or [])
    except Exception:
        # Backward-compatible retry if migration 240 columns (`post_kind`, `company_name`, etc.) aren't applied yet
        compat_rows = [
            {
                k: v
                for k, v in r.items()
                if k not in {"post_kind", "company_name", "job_location", "crawl_source"}
            }
            for r in rows_to_insert
        ]
        try:
            ins = sb.table("linkedin_posts").insert(compat_rows).execute()
            inserted_rows = list(ins.data or [])
        except Exception as exc2:
            logger.error("[LI-NO-ACC] Insert linkedin_posts failed: %s", exc2)

    return {
        "count": len(inserted_rows),
        "skipped_duplicates": skipped_duplicates,
        "_inserted_rows": inserted_rows,
        "group_url": group_url,
        "group_name": group_name,
    }


async def ingest_linkedin_no_acc_batch(
    result: LinkedInNoAccCrawlResult,
    *,
    proxy_node: str = "proxy-01",
    run_id: Optional[str] = None,
) -> LinkedInNoAccCrawlResult:
    """Persist LinkedIn No-Acc leads -> Audit Log -> Immediate AI Lead Scoring -> Target Stats."""
    from app.modules.all_platform.services.crawled_post_audit_service import (
        record_crawled_posts_audit_sync,
    )
    from app.modules.all_platform.services.lead_score_service import score_and_save_posts

    if not result.posts:
        await asyncio.to_thread(
            record_linkedin_no_acc_target_result,
            result.keyword,
            0,
            0,
            result.error,
        )
        return result

    batch = await asyncio.to_thread(
        save_linkedin_no_acc_batch,
        posts=result.posts,
        keyword=result.keyword,
        location=result.location,
        id_member=None,
    )
    inserted_rows = batch.get("_inserted_rows") or []
    result.saved_count = int(batch.get("count") or 0)
    result.skipped_duplicates = int(batch.get("skipped_duplicates") or 0)

    if inserted_rows:
        group_name = batch.get("group_name") or f"LinkedIn B2B No-Acc: {result.keyword}"
        group_url = batch.get("group_url") or build_linkedin_jobs_guest_url(result.keyword, location=result.location)
        audit_entries = [
            {
                "platform": "linkedin",
                "crawl_source": "public_4g",
                "run_id": run_id,
                "proxy_node": proxy_node,
                "group_name": group_name,
                "group_url": group_url,
                "post_id": row.get("id"),
                "post_url": str(row.get("post_url") or ""),
                "author_name": row.get("author"),
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
            "linkedin_posts",
            inserted_rows,
            group_name=group_name,
            keywords=[result.keyword],
            crawl_source="public_4g",
            proxy_node=proxy_node,
            run_id=run_id,
            group_url=group_url,
        )
        score_dict = score_res or {}
        result.high_score_count = int(score_dict.get("high") or score_dict.get("high_score") or 0)

    await asyncio.to_thread(
        record_linkedin_no_acc_target_result,
        result.keyword,
        result.saved_count,
        result.high_score_count,
        result.error,
    )
    return result


# ── Channel 3: Safe LinkedIn Group (`li_at`) Rate & Sticky Proxy Guard ────────

class LinkedInGroupSafetyGuard:
    """Enforces 1-Account-1-Sticky-Proxy binding & daily group/scroll quotas for `li_at` accounts."""

    def __init__(self, *, max_groups_per_day: int = 25, max_scrolls_per_day: int = 80) -> None:
        self.max_groups_per_day = max(1, int(max_groups_per_day))
        self.max_scrolls_per_day = max(1, int(max_scrolls_per_day))
        self._account_proxy_binding: dict[str, str] = {}
        self._daily_usage: dict[tuple[str, str], dict[str, int]] = {}

    def validate_and_bind_proxy(self, account_id: str, proxy_url: Optional[str]) -> tuple[bool, str]:
        acc = str(account_id or "").strip()
        px = str(proxy_url or "").strip()
        if not px:
            return (False, f"Tài khoản LinkedIn '{acc}' chưa gắn Proxy Sticky cố định (nguy cơ restrict cao).")
        existing = self._account_proxy_binding.get(acc)
        if existing and existing != px:
            return (False, f"Tài khoản LinkedIn '{acc}' đã khóa với proxy cố định khác — từ chối đổi IP đột ngột.")
        self._account_proxy_binding[acc] = px
        return (True, "ok")

    def check_and_consume_quota(self, account_id: str, *, scrolls: int = 2) -> tuple[bool, str]:
        day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        bucket = self._daily_usage.setdefault((str(account_id), day_key), {"groups": 0, "scrolls": 0})
        if bucket["groups"] + 1 > self.max_groups_per_day:
            return (False, f"Đạt giới hạn an toàn {self.max_groups_per_day} nhóm/ngày cho tài khoản LinkedIn.")
        if bucket["scrolls"] + max(1, scrolls) > self.max_scrolls_per_day:
            return (False, f"Đạt giới hạn an toàn {self.max_scrolls_per_day} lượt cuộn/ngày cho tài khoản LinkedIn.")
        bucket["groups"] += 1
        bucket["scrolls"] += max(1, scrolls)
        return (True, "ok")


linkedin_group_safety_guard = LinkedInGroupSafetyGuard()


# ── LinkedIn No-Acc Targets Registry CRUD ─────────────────────────────────────

def list_linkedin_no_acc_targets(active_only: bool = False) -> list[dict[str, Any]]:
    try:
        sb = get_supabase_client()
        q = sb.table(TABLE_TARGETS).select("*").order("created_at", desc=True)
        if active_only:
            q = q.eq("is_active", True)
        res = q.execute()
        return list(res.data or [])
    except Exception as exc:
        logger.debug("[LI-NO-ACC] list_linkedin_no_acc_targets fallback empty (%s)", exc)
        return []


def add_linkedin_no_acc_targets(
    *,
    keywords: list[str],
    location: str = DEFAULT_LOCATION,
    channel: str = "both",
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    ch = channel if channel in {"jobs_guest", "search_index", "both"} else "both"
    loc = (location or DEFAULT_LOCATION).strip() or DEFAULT_LOCATION
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in keywords:
        val = str(raw or "").strip()
        if not val or val.lower() in seen:
            continue
        seen.add(val.lower())
        cleaned.append(val)

    if not cleaned:
        return {"success": False, "added_count": 0, "items": [], "message": "Danh sách từ khóa LinkedIn No-Acc trống."}

    sb = get_supabase_client()
    now_iso = _utc_now_iso()
    rows = [
        {
            "keyword": kw,
            "location": loc,
            "channel": ch,
            "is_active": True,
            "created_by": created_by,
            "updated_at": now_iso,
        }
        for kw in cleaned
    ]
    res = sb.table(TABLE_TARGETS).upsert(rows, on_conflict="keyword").execute()
    inserted = list(res.data or [])
    return {
        "success": True,
        "added_count": len(inserted),
        "items": inserted,
        "message": f"Đã thêm {len(inserted)} từ khóa LinkedIn No-Acc ({loc}).",
    }


def delete_linkedin_no_acc_target(target_id: str) -> bool:
    try:
        sb = get_supabase_client()
        sb.table(TABLE_TARGETS).delete().eq("id", target_id).execute()
        return True
    except Exception as exc:
        logger.warning("[LI-NO-ACC] delete_linkedin_no_acc_target failed: %s", exc)
        return False


def toggle_linkedin_no_acc_target(target_id: str, is_active: Optional[bool] = None) -> bool:
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
        logger.warning("[LI-NO-ACC] toggle_linkedin_no_acc_target failed: %s", exc)
        return False


def record_linkedin_no_acc_target_result(
    keyword: str,
    found_count: int,
    high_score_count: int,
    error: Optional[str] = None,
) -> None:
    try:
        sb = get_supabase_client()
        cur = (
            sb.table(TABLE_TARGETS)
            .select("id, times_used, total_posts_found, high_score_posts")
            .eq("keyword", keyword)
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
        logger.debug("[LI-NO-ACC] record_linkedin_no_acc_target_result skipped (%s)", exc)
