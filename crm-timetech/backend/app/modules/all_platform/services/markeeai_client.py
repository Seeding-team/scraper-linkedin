"""Client for the external MarkeeAI backend (app.markeeai.com).

MarkeeAI is the separate product the company uses to publish posts on its
own Facebook Page(s). This client logs in AS THE CALLING EMPLOYEE when we
have a linked MarkeeAI account for them (markeeai_account_links), so posts
are fetched using whatever campaigns THAT PERSON is actually a member of —
falling back to one shared service account for anyone without a personal
link. Either way it lists the fanpages that identity can see, and fetches
each fanpage's posts (content + media_urls) so employees can seed-comment
on them internally.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


class MarkeeCredentials:
    __slots__ = ("email", "password")

    def __init__(self, email: str, password: str):
        self.email = email
        self.password = password

    @property
    def cache_key(self) -> str:
        return self.email


def _default_credentials() -> MarkeeCredentials:
    return MarkeeCredentials(settings.markeeai_service_email, settings.markeeai_service_password)


# Per-identity caches — keyed by markeeai_email, so several employees using
# their own linked account concurrently don't clobber each other's session.
_TOKEN_CACHE: dict[str, dict[str, Any]] = {}
_TOKEN_LOCKS: dict[str, asyncio.Lock] = {}
_FANPAGE_CACHE: dict[str, dict[str, Any]] = {}
_FANPAGE_CACHE_TTL_SEC = 300.0


def _auth_headers(access_token: str, campaign_id: Optional[str] = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {access_token}"}
    if campaign_id:
        headers["X-Campaign-Id"] = campaign_id
    return headers


async def _login(client: httpx.AsyncClient, creds: MarkeeCredentials) -> dict:
    if not creds.email or not creds.password:
        raise RuntimeError("MarkeeAI credentials are not configured for this identity")

    resp = await client.post("/auth/login", json={"email": creds.email, "password": creds.password})
    resp.raise_for_status()
    data = resp.json()
    entry = {
        "access_token": data["accessToken"],
        "refresh_token": data["refreshToken"],
        # Access tokens are short-lived; re-login well before real expiry
        # rather than parsing the JWT's own `exp` claim.
        "expires_at": time.monotonic() + 15 * 60,
    }
    _TOKEN_CACHE[creds.cache_key] = entry
    logger.info(f"MarkeeAI: logged in as {creds.email}")
    return entry


async def _refresh(client: httpx.AsyncClient, creds: MarkeeCredentials, entry: dict) -> bool:
    refresh_token = entry.get("refresh_token")
    if not refresh_token:
        return False
    try:
        resp = await client.post("/auth/refresh", json={"refreshToken": refresh_token})
        resp.raise_for_status()
        data = resp.json()
        entry["access_token"] = data["accessToken"]
        entry["refresh_token"] = data["refreshToken"]
        entry["expires_at"] = time.monotonic() + 15 * 60
        return True
    except httpx.HTTPError:
        return False


async def _ensure_token(client: httpx.AsyncClient, creds: MarkeeCredentials) -> str:
    lock = _TOKEN_LOCKS.setdefault(creds.cache_key, asyncio.Lock())
    async with lock:
        entry = _TOKEN_CACHE.get(creds.cache_key)
        if entry and entry.get("access_token") and time.monotonic() < entry.get("expires_at", 0):
            return entry["access_token"]
        if entry and entry.get("access_token") and await _refresh(client, creds, entry):
            return entry["access_token"]
        entry = await _login(client, creds)
        return entry["access_token"]


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=settings.markeeai_base_url, timeout=30.0)


async def list_fanpages(creds: MarkeeCredentials, force_refresh: bool = False) -> list[dict]:
    """List fanpages reachable by this identity, across every campaign
    configured (MARKEEAI_CAMPAIGN_IDS) plus any it owns personally."""
    cached = _FANPAGE_CACHE.get(creds.cache_key)
    if not force_refresh and cached is not None:
        if time.monotonic() - cached["fetched_at"] < _FANPAGE_CACHE_TTL_SEC:
            return cached["items"]

    campaign_ids: list[Optional[str]] = list(settings.markeeai_campaign_ids) or [None]

    async with _client() as client:
        token = await _ensure_token(client, creds)
        results = await asyncio.gather(
            *[
                client.get("/api/fanpages", headers=_auth_headers(token, cid), params={"limit": 100})
                for cid in campaign_ids
            ],
            return_exceptions=True,
        )

    by_id: dict[str, dict] = {}
    for resp in results:
        if isinstance(resp, Exception):
            logger.warning(f"MarkeeAI: failed to list fanpages for a campaign ({creds.email}): {resp}")
            continue
        if resp.status_code != 200:
            continue
        for fp in resp.json().get("items", []):
            by_id[fp["id"]] = fp

    items = list(by_id.values())
    _FANPAGE_CACHE[creds.cache_key] = {"items": items, "fetched_at": time.monotonic()}
    return items


async def list_posts_for_fanpage(creds: MarkeeCredentials, fanpage_id: str, limit: int = 50) -> list[dict]:
    """Uses GET /api/fanpages/{id}/posts — NOT /api/posts/fanpage/{id}, which
    additionally requires the caller to be the post's own author (rejects
    other campaign members with a 403 even when campaign scoping matches).
    The fanpages.py route only checks the fanpage's campaign ownership, so
    any teammate in the same campaign can see every post on the page."""
    campaign_ids: list[Optional[str]] = list(settings.markeeai_campaign_ids) or [None]
    async with _client() as client:
        token = await _ensure_token(client, creds)
        for cid in campaign_ids:
            resp = await client.get(
                f"/api/fanpages/{fanpage_id}/posts",
                headers=_auth_headers(token, cid),
                params={"limit": limit},
            )
            if resp.status_code == 200:
                raw_items = resp.json().get("items", [])
                return [
                    {
                        "id": item["id"],
                        "facebook_post_id": item.get("facebook_post_id"),
                        "content": item.get("message") or "",
                        "media_urls": [item["full_picture"]] if item.get("full_picture") else [],
                        "status": item.get("status_type"),
                        "created_at": item.get("created_time"),
                    }
                    for item in raw_items
                ]
        return []


def _build_permalink(page_id: Optional[str], facebook_post_id: Optional[str]) -> Optional[str]:
    """Build a real, clickable FB permalink in the `/posts/{id}` shape that
    extensions/comment-extension/content.js can parse a post id out of.
    """
    if not facebook_post_id:
        return None
    story_id = facebook_post_id.split("_", 1)[1] if "_" in facebook_post_id else facebook_post_id
    if page_id:
        return f"https://www.facebook.com/{page_id}/posts/{story_id}"
    return f"https://www.facebook.com/posts/{story_id}"


async def get_all_company_posts(
    creds: Optional[MarkeeCredentials] = None,
    limit_per_page: int = 50,
) -> list[dict]:
    """Fetch posts across every fanpage this identity can see, merged and
    sorted by created_at desc, with a ready-to-use permalink_url. Pass the
    caller's own linked MarkeeAI credentials (resolved from
    markeeai_account_links) to fetch using THEIR campaign membership;
    omit to fall back to the shared service account."""
    creds = creds or _default_credentials()

    fanpages = await list_fanpages(creds)
    if not fanpages:
        return []

    results = await asyncio.gather(
        *[list_posts_for_fanpage(creds, fp["id"], limit=limit_per_page) for fp in fanpages],
        return_exceptions=True,
    )

    posts: list[dict] = []
    for fanpage, page_posts in zip(fanpages, results):
        if isinstance(page_posts, Exception):
            logger.warning(f"MarkeeAI: failed to fetch posts for fanpage {fanpage.get('id')} ({creds.email}): {page_posts}")
            continue
        for post in page_posts:
            post["fanpage_id"] = fanpage["id"]
            post["fanpage_name"] = fanpage.get("page_name")
            post["permalink_url"] = _build_permalink(fanpage.get("page_id"), post.get("facebook_post_id"))
            posts.append(post)

    posts.sort(key=lambda p: p.get("created_at") or "", reverse=True)
    return posts
