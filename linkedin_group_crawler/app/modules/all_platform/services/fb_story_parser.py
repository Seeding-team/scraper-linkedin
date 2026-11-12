"""Fast Facebook Public Group SSR HTML & GraphQL Story JSON parser.

Reuses the exact Relay/Story extraction rules of the Chrome extension
(`platforms/facebook/crawl.js`), running purely in Python so backend guest
workers can extract posts from BOTH initial SSR `<script type="application/json">`
payloads AND intercepted `/api/graphql` responses with zero DOM clicks.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

STORY_SKIP_KEYS = frozenset({
    "feedback",
    "ufi",
    "comment_rendering_instance",
    "comment_rendering_instance_for_feed_location",
    "interesting_top_level_comments",
    "display_comments",
    "comments",
    "reply_comment",
    "top_level_comments",
    "attached_story",
    "bump_reason",
})

_SCRIPT_JSON_RE = re.compile(
    r'<script[^>]*type=["\']application/json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_GROUP_ID_PATH_RE = re.compile(r"/groups/([^/?#]+)", re.IGNORECASE)
_GROUP_ID_JSON_RE = re.compile(r'"(?:groupID|group_id)"\s*:\s*"(\d+)"')
_POST_ID_FROM_URL_RE = re.compile(r"/(?:posts|permalink)/(\d+)|[?&](?:story_fbid|multi_permalinks)=(\d+)")

_PRIVATE_GROUP_PATTERNS = (
    re.compile(r"nhóm\s+riêng\s+tư", re.IGNORECASE),
    re.compile(r"private\s+group", re.IGNORECASE),
    re.compile(r"only\s+members\s+can\s+see\s+who(?:'|’)?s\s+in\s+the\s+group", re.IGNORECASE),
    re.compile(r"chỉ\s+thành\s+viên\s+mới\s+có\s+thể\s+nhìn\s+thấy", re.IGNORECASE),
    re.compile(r"tham\s+gia\s+nhóm\s+để\s+xem\s+bài\s+viết", re.IGNORECASE),
    re.compile(r"join\s+group\s+to\s+view", re.IGNORECASE),
)

_HARD_BLOCK_PATTERNS = (
    re.compile(r"/checkpoint/", re.IGNORECASE),
    re.compile(r'"error_subcode"\s*:\s*1357004', re.IGNORECASE),
    re.compile(r"you(?:'|’)?re\s+temporarily\s+blocked", re.IGNORECASE),
    re.compile(r"tài\s+khoản\s+của\s+bạn\s+tạm\s+thời\s+bị\s+khóa", re.IGNORECASE),
    re.compile(r"thao\s+tác\s+quá\s+nhanh", re.IGNORECASE),
    re.compile(r"we\s+noticed\s+unusual\s+activity", re.IGNORECASE),
    re.compile(r"please\s+log\s+in\s+to\s+continue", re.IGNORECASE),
    re.compile(r"bạn\s+phải\s+đăng\s+nhập\s+để\s+tiếp\s+tục", re.IGNORECASE),
)


def normalize_group_crawl_url(group_url: str) -> str:
    """Force Facebook group URL onto `sorting_setting=CHRONOLOGICAL` (newest first)."""
    raw = (group_url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    path = parsed.path or ""
    if not path.endswith("/"):
        path = f"{path}/"
    qs = parse_qs(parsed.query, keep_blank_values=False)
    qs["sorting_setting"] = ["CHRONOLOGICAL"]
    query_str = urlencode(qs, doseq=True)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or "www.facebook.com"
    return urlunparse((scheme, netloc, path, "", query_str, ""))


def extract_post_id_from_url(post_url: str | None) -> str | None:
    if not post_url:
        return None
    m = _POST_ID_FROM_URL_RE.search(str(post_url))
    if not m:
        return None
    return (m.group(1) or m.group(2) or "").strip() or None


def extract_group_id_hint(group_url: str, html_text: str = "") -> str:
    if html_text:
        m = _GROUP_ID_JSON_RE.search(html_text)
        if m:
            return m.group(1)
    m_url = _GROUP_ID_PATH_RE.search(group_url or "")
    if m_url:
        return m_url.group(1).strip()
    return ""


def _get_deep_value(obj: Any, target_keys: tuple[str, ...]) -> Any:
    if isinstance(obj, dict):
        for k in target_keys:
            if obj.get(k) is not None:
                return obj[k]
        for v in obj.values():
            res = _get_deep_value(v, target_keys)
            if res is not None:
                return res
    elif isinstance(obj, list):
        for item in obj:
            res = _get_deep_value(item, target_keys)
            if res is not None:
                return res
    return None


def _get_story_value(obj: Any, target_keys: tuple[str, ...]) -> Any:
    if isinstance(obj, dict):
        for k in target_keys:
            if obj.get(k) is not None:
                return obj[k]
        for k, v in obj.items():
            if k in STORY_SKIP_KEYS:
                continue
            res = _get_story_value(v, target_keys)
            if res is not None:
                return res
    elif isinstance(obj, list):
        for item in obj:
            res = _get_story_value(item, target_keys)
            if res is not None:
                return res
    return None


def _extract_media(attachments: Any) -> tuple[list[str], str | None]:
    images: list[str] = []
    video_url: str | None = None

    def _walk(node: Any) -> None:
        nonlocal video_url
        if isinstance(node, dict):
            for img_key in ("photo_image", "image", "viewer_image"):
                img = node.get(img_key)
                if isinstance(img, dict):
                    uri = img.get("uri")
                    if isinstance(uri, str) and uri and uri not in images:
                        images.append(uri)
            for vid_key in ("playable_url_quality_hd", "browser_native_hd_url", "playable_url"):
                p_url = node.get(vid_key)
                if isinstance(p_url, str) and p_url and video_url is None:
                    video_url = p_url
                    break
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    if attachments is not None:
        _walk(attachments)
    return images, video_url


def _is_pinned_story(node: dict[str, Any]) -> bool:
    for k in ("is_pinned", "is_pinned_post", "pinned_for_group", "is_featured", "featured_post_info"):
        if node.get(k):
            return True
    story_txt = json.dumps(
        {k: v for k, v in node.items() if k in {"bump_reason", "context_layout", "header", "badge"}},
        ensure_ascii=False,
    ).lower()
    return "pinned" in story_txt or "đã ghim" in story_txt


def _story_node_to_post(
    node: dict[str, Any],
    group_id: str,
    group_url: str,
) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None
    typename = node.get("__typename")
    if typename and typename != "Story":
        return None
    raw_node_id = str(node.get("id") or "")
    if raw_node_id.startswith("Y29tbWVudD"):
        return None
    if node.get("comment_parent") is not None:
        return None

    raw_post_id = (
        node.get("post_id")
        or node.get("legacy_post_id")
        or _get_story_value(node, ("post_id", "legacy_post_id"))
        or (raw_node_id if raw_node_id and not raw_node_id.startswith("Y29tbWVudD") else None)
    )
    post_id = str(raw_post_id).strip() if raw_post_id else ""
    if not post_id:
        return None

    fallback_gid = group_id or extract_group_id_hint(group_url)
    raw_url = (
        node.get("url")
        or node.get("share_url")
        or _get_story_value(node, ("url", "share_url", "wwwURL"))
        or (f"https://www.facebook.com/groups/{fallback_gid}/posts/{post_id}" if fallback_gid else "")
    )
    url = str(raw_url or "").strip()
    if not url or re.search(r"([?&])(comment_id|reply_comment_id)=", url, re.IGNORECASE):
        return None

    actors_val = _get_story_value(node, ("actors",))
    if isinstance(actors_val, list):
        actor_obj = actors_val[0] if actors_val and isinstance(actors_val[0], dict) else {}
    elif isinstance(actors_val, dict):
        actor_obj = actors_val
    else:
        actor_obj = {}

    author_name = str(actor_obj.get("name") or "Ẩn danh").strip() or "Ẩn danh"
    actor_profile_url = str(actor_obj.get("url") or actor_obj.get("profile_url") or "").strip()
    actor_id = str(actor_obj.get("id") or actor_obj.get("profile_id") or "").strip()
    author_url = actor_profile_url or (f"https://www.facebook.com/profile.php?id={actor_id}" if actor_id else "")

    msg_obj = _get_story_value(node, ("message",))
    content = ""
    if isinstance(msg_obj, dict):
        content = str(msg_obj.get("text") or "").strip()
    elif isinstance(msg_obj, str):
        content = msg_obj.strip()

    creation_time_raw = node.get("creation_time") or _get_story_value(node, ("creation_time",))
    creation_time: int | None = None
    if creation_time_raw is not None:
        try:
            creation_time = int(float(creation_time_raw))
        except (TypeError, ValueError):
            creation_time = None

    if not creation_time or creation_time <= 0:
        # Without timestamp we cannot enforce today/watermark filters reliably
        return None

    ts_iso = datetime.fromtimestamp(creation_time, tz=timezone.utc).isoformat()

    reaction_obj = _get_deep_value(node, ("reaction_count",))
    reactions = int(reaction_obj.get("count") or 0) if isinstance(reaction_obj, dict) else 0

    comment_obj = _get_deep_value(node, ("total_comment_count", "comments"))
    if isinstance(comment_obj, (int, float)):
        comments = int(comment_obj)
    elif isinstance(comment_obj, dict):
        comments = int(comment_obj.get("total_count") or 0)
    else:
        comments = 0

    share_obj = _get_deep_value(node, ("share_count",))
    shares = int(share_obj.get("count") or 0) if isinstance(share_obj, dict) else 0

    attachments = _get_story_value(node, ("attachments",))
    images, video_url = _extract_media(attachments)

    canonical_post_id = extract_post_id_from_url(url) or post_id

    return {
        "post_id": str(canonical_post_id),
        "post_url": url,
        "author_name": author_name,
        "author_url": author_url,
        "creation_time": creation_time,
        "timestamp_raw": ts_iso,
        "content": content or "[Bài viết Media/Share/Poll]",
        "reactions": reactions,
        "comments": comments,
        "shares": shares,
        "images": images,
        "video_url": video_url,
        "is_pinned": _is_pinned_story(node),
        "crawled_at": datetime.now(timezone.utc).isoformat(),
    }


def _extract_stories_from_obj(
    payload: Any,
    group_id: str,
    group_url: str,
    seen_ids: set[str],
    out: list[dict[str, Any]],
) -> int:
    """Recursively locate group feed edges or Story objects inside an arbitrary Relay JSON payload."""
    added = 0

    def _visit(obj: Any) -> None:
        nonlocal added
        if isinstance(obj, dict):
            # Direct Story edge list (e.g. group_feed.edges)
            if isinstance(obj.get("group_feed"), dict):
                edges = obj["group_feed"].get("edges")
                if isinstance(edges, list):
                    for edge in edges:
                        node = edge.get("node") if isinstance(edge, dict) and isinstance(edge.get("node"), dict) else edge
                        if isinstance(node, dict):
                            post = _story_node_to_post(node, group_id, group_url)
                            if post and post["post_id"] not in seen_ids and post["post_url"] not in seen_ids:
                                seen_ids.add(post["post_id"])
                                seen_ids.add(post["post_url"])
                                out.append(post)
                                added += 1

            # Streaming Story node
            if obj.get("__typename") == "Story" and (obj.get("post_id") or obj.get("creation_time")):
                post = _story_node_to_post(obj, group_id, group_url)
                if post and post["post_id"] not in seen_ids and post["post_url"] not in seen_ids:
                    seen_ids.add(post["post_id"])
                    seen_ids.add(post["post_url"])
                    out.append(post)
                    added += 1
                    return  # do not recurse inside already-parsed Story's comments/attachments

            for k, v in obj.items():
                if k in STORY_SKIP_KEYS:
                    continue
                _visit(v)
        elif isinstance(obj, list):
            for item in obj:
                _visit(item)

    _visit(payload)
    return added


def parse_fb_graphql_text(
    raw_text: str,
    group_id: str = "",
    group_url: str = "",
    seen_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Parse newline-delimited JSON response chunks from `/api/graphql`."""
    if not raw_text:
        return []
    clean = re.sub(r"^for\s*\(\s*;\s*;\s*\)\s*;?", "", raw_text).strip()
    if not clean:
        return []
    seen = seen_ids if seen_ids is not None else set()
    posts: list[dict[str, Any]] = []
    for line in clean.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except ValueError:
            continue
        _extract_stories_from_obj(data, group_id, group_url, seen, posts)
    return posts


def parse_fb_html_embedded_stories(
    html_text: str,
    group_id: str = "",
    group_url: str = "",
    seen_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Parse initial SSR `<script type="application/json">` hydration chunks from Facebook HTML."""
    if not html_text:
        return []
    resolved_gid = group_id or extract_group_id_hint(group_url, html_text)
    seen = seen_ids if seen_ids is not None else set()
    posts: list[dict[str, Any]] = []
    for match in _SCRIPT_JSON_RE.finditer(html_text):
        raw_json = (match.group(1) or "").strip()
        if not raw_json or len(raw_json) < 20:
            continue
        if "Story" not in raw_json and "group_feed" not in raw_json and "creation_time" not in raw_json:
            continue
        try:
            payload = json.loads(raw_json)
        except ValueError:
            continue
        _extract_stories_from_obj(payload, resolved_gid, group_url, seen, posts)
    return posts


def classify_guest_page_state(
    current_url: str,
    body_text: str,
    extracted_posts_count: int = 0,
    http_status: int | None = None,
) -> str:
    """Classify unauthenticated guest crawl outcome:
    - 'ok'
    - 'rate_limit' (triggers 4G IP rotation + clean retry)
    - 'login_wall' (triggers 4G IP rotation + clean retry)
    - 'private_group' (marks group visibility='private', does NOT spin rotate loop)
    """
    if http_status == 429:
        return "rate_limit"

    url_lower = (current_url or "").lower()
    if "/checkpoint/" in url_lower:
        return "rate_limit"

    text = body_text or ""
    for pat in _HARD_BLOCK_PATTERNS:
        if pat.search(text) or pat.search(current_url or ""):
            # Even if login wall banner exists on some groups, if we already extracted
            # public feed stories on initial load we treat it as usable unless hard redirect
            if "/login" in url_lower or extracted_posts_count == 0:
                return "rate_limit" if ("blocked" in pat.pattern or "1357004" in pat.pattern or "checkpoint" in pat.pattern or "nhanh" in pat.pattern) else "login_wall"

    if extracted_posts_count == 0:
        for pat in _PRIVATE_GROUP_PATTERNS:
            if pat.search(text):
                return "private_group"
        if "/login" in url_lower:
            return "login_wall"

    return "ok"
