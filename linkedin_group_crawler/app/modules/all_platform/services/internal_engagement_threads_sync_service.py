"""Đồng bộ like/reply/repost cho bài Threads trong Internal Engagement — hoàn toàn
server-side, KHÔNG cần đăng nhập/Playwright/Extension (giống Facebook tự cào).

Threads (Meta) render sẵn dữ liệu bài viết (JSON nhúng trong HTML) cho crawler của
công cụ tìm kiếm: fetch trang bài bằng UA Googlebot sẽ nhận về object bài gốc có
like_count + text_post_app_info.{direct_reply_count, repost_count, quote_count}.
Fetch bằng UA Chrome thường chỉ nhận về trang SPA rỗng. Đã verify với threads.com
thật 2026-09-27.

Map sang 3 cột chung của bảng internal_engagement_custom_posts:
- likes    = like_count
- comments = direct_reply_count (reply trực tiếp vào bài)
- shares   = repost_count + quote_count (Threads gộp cả repost lẫn trích dẫn vào
             nút "Đăng lại")
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import httpx

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.supabase_internal_engagement_kpi_service import (
    resolve_threads_post_url,
    sync_linkedin_post_engagement_db,
)

logger = get_logger(__name__)

# Không cào lại cùng 1 bài quá dày (người dùng bấm "Đồng bộ" liên tục) — trả số đã lưu.
POST_SYNC_CACHE_SECONDS = 2 * 60

_THREADS_ENGAGEMENT_HEADERS = {
    "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

_POST_CODE_RE = re.compile(r"/post/([A-Za-z0-9_-]+)")


class ThreadsSyncError(Exception):
    """Không đọc được số liệu bài Threads (link sai, bài riêng tư/đã xoá, hoặc Threads
    đổi cấu trúc dữ liệu). Router trả error_code=THREADS_SYNC_FAILED."""


def _seconds_since_iso(value: str | None) -> float | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds()


def _enclosing_json_object(text: str, idx: int) -> str | None:
    """Trả về chuỗi JSON của object nhỏ nhất bao quanh vị trí idx (đếm ngoặc, bỏ qua
    ký tự nằm trong chuỗi khi quét xuôi)."""
    depth = 0
    start = idx
    while start >= 0:
        ch = text[start]
        if ch == "}":
            depth += 1
        elif ch == "{":
            if depth == 0:
                break
            depth -= 1
        start -= 1
    if start < 0:
        return None

    depth = 0
    in_str = False
    escaped = False
    for end in range(start, len(text)):
        ch = text[end]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:end + 1]
    return None


def extract_threads_engagement(page_html: str, post_code: str) -> dict | None:
    """Tìm object bài gốc (khớp đúng mã bài — trang còn chứa các reply bên dưới, mỗi
    reply cũng có like_count riêng) và trả {likes, comments, shares}."""
    marker = f'"code":"{post_code}"'
    pos = page_html.find(marker)
    while pos != -1:
        raw = _enclosing_json_object(page_html, pos)
        if raw:
            try:
                obj = json.loads(raw)
            except ValueError:
                obj = None
            if isinstance(obj, dict) and "like_count" in obj:
                info = obj.get("text_post_app_info") or {}
                return {
                    "likes": int(obj.get("like_count") or 0),
                    "comments": int(info.get("direct_reply_count") or 0),
                    "shares": int(info.get("repost_count") or 0) + int(info.get("quote_count") or 0),
                }
        pos = page_html.find(marker, pos + len(marker))
    return None


def fetch_threads_post_engagement(url: str) -> dict:
    # Bài tạo từ link chia sẻ (/share/XXX) trước khi có bước resolve lúc tạo bài vẫn
    # lưu link /share/ — mở ra link bài thật để lấy mã bài.
    clean = resolve_threads_post_url(url)
    match = _POST_CODE_RE.search(clean)
    if not match:
        raise ThreadsSyncError("Link Threads không có mã bài (/post/...), không đồng bộ được.")

    try:
        with httpx.Client(follow_redirects=True, timeout=20.0) as client:
            res = client.get(clean, headers=_THREADS_ENGAGEMENT_HEADERS)
    except httpx.HTTPError as e:
        raise ThreadsSyncError(f"Không kết nối được Threads: {e}") from e

    if res.status_code != 200:
        raise ThreadsSyncError(f"Threads trả về HTTP {res.status_code} khi đọc bài viết.")

    metrics = extract_threads_engagement(res.text, match.group(1))
    if metrics is None:
        raise ThreadsSyncError(
            "Không đọc được số liệu bài Threads (bài riêng tư/đã xoá, hoặc Threads đã đổi cấu trúc dữ liệu)."
        )
    return metrics


def sync_threads_post_engagement(post_id: str) -> dict:
    post_res = (
        get_supabase_client()
        .table("internal_engagement_custom_posts")
        .select("*")
        .eq("id", post_id)
        .execute()
    )
    if not post_res.data:
        raise ThreadsSyncError("Không tìm thấy bài viết hoặc bài viết đã bị xóa.")
    post = post_res.data[0]

    age_seconds = _seconds_since_iso(post.get("last_synced_at"))
    if age_seconds is not None and age_seconds < POST_SYNC_CACHE_SECONDS:
        return {
            **post,
            "public_likes": post.get("fb_total_likes") or 0,
            "public_comments": post.get("fb_total_comments") or 0,
            "public_shares": post.get("fb_total_shares") or 0,
            "synced_at": post.get("last_synced_at"),
            "from_cache": True,
        }

    metrics = fetch_threads_post_engagement(post.get("link_post") or "")
    logger.info("[THREADS-SYNC] post=%s metrics=%s", post_id, metrics)
    # Hàm lưu của LinkedIn thực chất platform-agnostic (ghi đè 3 cột fb_total_*).
    return sync_linkedin_post_engagement_db(
        post_id, likes=metrics["likes"], comments=metrics["comments"], shares=metrics["shares"]
    )
