"""Lưu video YouTube cào bằng "Markee Seeding Extension" (lệnh MK_YT_CRAWL_*) vào bảng `youtube_posts`.

Cùng khuôn Threads (`supabase_threads_extension_crawl_service.py`): YouTube không có "group",
extension mở trang youtube.com/results?search_query=<từ khoá> (hoặc mở thẳng link video người
dùng dán vào) rồi gửi danh sách video lên đây — mỗi request là kết quả của ĐÚNG 1 từ khoá / 1 lô link.

Các bước lọc (chạy đồng bộ, router gọi qua `asyncio.to_thread`):
1. Chuẩn hoá URL về 1 dạng duy nhất theo video_id (watch?v=, youtu.be/, /shorts/, /live/, /embed/...).
2. Bỏ video trùng trong batch và video đã có trong DB (dedupe theo video_id).
3. Bỏ video cũ hơn `max_age_days` ngày (chỉ áp cho tìm theo từ khoá — link người dùng tự dán luôn giữ).
4. Xếp theo lượt xem rồi lấy tối đa `post_limit` video (link dán tay không bị cắt).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

TABLE = "youtube_posts"
DEFAULT_POST_LIMIT = 20
MAX_POST_LIMIT = 100

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
_PATH_ID_RE = re.compile(r"^/(shorts|live|embed|v)/([A-Za-z0-9_-]{11})(?:[/?#]|$)")


def extract_video_id(url: Optional[str]) -> Optional[tuple[str, bool]]:
    """Trả về (video_id, is_short) hoặc None nếu không phải link video YouTube hợp lệ."""
    if not url:
        return None
    raw = url.strip()
    if not re.match(r"^https?://", raw, re.IGNORECASE):
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()

    if host in ("youtu.be", "www.youtu.be"):
        vid = parsed.path.strip("/").split("/")[0]
        return (vid, False) if _VIDEO_ID_RE.match(vid) else None

    if host not in _YT_HOSTS:
        return None

    m = _PATH_ID_RE.match(parsed.path)
    if m:
        return m.group(2), m.group(1) == "shorts"

    if parsed.path.rstrip("/") == "/watch":
        vid = (parse_qs(parsed.query).get("v") or [""])[0]
        return (vid, False) if _VIDEO_ID_RE.match(vid) else None
    return None


def canonical_video_url(video_id: str, is_short: bool) -> str:
    if is_short:
        return f"https://www.youtube.com/shorts/{video_id}"
    return f"https://www.youtube.com/watch?v={video_id}"


def _parse_post_time(raw: Any) -> Optional[datetime]:
    """Nhận ISO string (extension gửi) hoặc unix seconds; trả datetime UTC hoặc None."""
    if raw is None or raw == "":
        return None
    try:
        if isinstance(raw, (int, float)):
            return datetime.fromtimestamp(float(raw), tz=timezone.utc)
        text = str(raw).strip()
        if text.isdigit():
            return datetime.fromtimestamp(int(text), tz=timezone.utc)
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


def _as_int(val: Any) -> int:
    try:
        return max(0, int(val or 0))
    except (TypeError, ValueError):
        return 0


def _clean_handle(val: Any) -> Optional[str]:
    handle = str(val or "").strip()
    if not handle:
        return None
    return handle if handle.startswith("@") else f"@{handle}"


def _build_content(title: str, description: str) -> str:
    title = (title or "").strip()
    description = (description or "").strip()
    if title and description:
        return f"{title}\n\n{description}"
    return title or description


def _score_from_views(views: int) -> int:
    """Điểm 0-100 theo lượt xem (thang log) để feed có cột "AI Score" như các nền tảng khác."""
    if views <= 0:
        return 0
    # 1K ~ 30, 10K ~ 45, 100K ~ 60, 1M ~ 75, 10M+ ~ 90
    digits = len(str(views))
    return max(0, min(100, 15 * (digits - 2)))


def save_youtube_crawl_batch(
    *,
    posts: list[dict],
    keyword: Optional[str],
    id_member: Optional[str],
    post_limit: Optional[int],
    max_age_days: Optional[int],
    direct_links: bool = False,
) -> dict:
    supabase = get_supabase_client()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    limit = post_limit if post_limit and post_limit > 0 else DEFAULT_POST_LIMIT
    limit = min(limit, MAX_POST_LIMIT)
    cutoff = (
        now - timedelta(days=max_age_days)
        if not direct_links and max_age_days and max_age_days > 0
        else None
    )
    keyword_clean = None if direct_links else ((keyword or "").strip() or None)

    candidates: dict[str, dict] = {}
    skipped_invalid = 0
    skipped_old = 0
    for raw in posts:
        raw_url = raw.get("post_url") or (f"https://youtu.be/{raw['video_id']}" if raw.get("video_id") else None)
        parsed = extract_video_id(raw_url)
        if not parsed:
            skipped_invalid += 1
            continue
        video_id, is_short_from_url = parsed
        if video_id in candidates:
            continue
        is_short = bool(raw.get("is_short")) or is_short_from_url

        post_time = _parse_post_time(raw.get("post_time"))
        # Không rõ thời gian đăng thì cũng bỏ khi có giới hạn ngày (không chứng minh được là mới).
        if cutoff is not None and (post_time is None or post_time < cutoff):
            skipped_old += 1
            continue

        title = (raw.get("title") or "").strip()
        views = _as_int(raw.get("view_count"))
        handle = _clean_handle(raw.get("channel_handle"))
        channel_id = (raw.get("channel_id") or "").strip() or None
        author_url = (raw.get("author_url") or "").strip() or (
            f"https://www.youtube.com/{handle}" if handle
            else f"https://www.youtube.com/channel/{channel_id}" if channel_id
            else None
        )
        thumbs = [str(u) for u in (raw.get("image_urls") or []) if u][:3]
        if not thumbs:
            thumbs = [f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"]

        candidates[video_id] = {
            "video_id": video_id,
            "post_url": canonical_video_url(video_id, is_short),
            "is_short": is_short,
            "keyword": keyword_clean,
            "source": "link" if direct_links else "keyword",
            "title": title or None,
            "content": _build_content(title, raw.get("description") or ""),
            "author_name": (raw.get("author_name") or "").strip() or handle or None,
            "channel_id": channel_id,
            "channel_handle": handle,
            "author_url": author_url,
            "post_time": post_time.isoformat() if post_time else None,
            "published_text": (raw.get("published_text") or "").strip() or None,
            "duration_text": (raw.get("duration_text") or "").strip() or None,
            "view_count": views,
            "reactions": _as_int(raw.get("reactions")),
            "comments": _as_int(raw.get("comments")),
            "shares": 0,
            "score": _score_from_views(views),
            "image_urls": thumbs,
            "crawl_date": now_iso,
            "id_member": id_member or None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }

    existing: set[str] = set()
    ids = list(candidates.keys())
    for i in range(0, len(ids), 100):
        chunk = ids[i : i + 100]
        res = supabase.table(TABLE).select("video_id").in_("video_id", chunk).execute()
        existing.update(r["video_id"] for r in (res.data or []) if r.get("video_id"))

    fresh = [p for vid, p in candidates.items() if vid not in existing]
    fresh.sort(key=lambda p: p["view_count"], reverse=True)
    # Link người dùng tự dán: lưu hết (họ đã chọn đúng video cần seeding), không cắt theo limit.
    selected = fresh if direct_links else fresh[:limit]

    inserted_urls: list[str] = []
    if selected:
        # ignore_duplicates: 2 lần cào song song cùng ra 1 video -> ON CONFLICT DO NOTHING.
        res = (
            supabase.table(TABLE)
            .upsert(selected, on_conflict="video_id", ignore_duplicates=True)
            .execute()
        )
        inserted_urls = [r["post_url"] for r in (res.data or []) if r.get("post_url")]

    logger.info(
        "[YOUTUBE-EXT] keyword=%r links=%s | nhận=%d | URL lạ=%d | cũ=%d | đã có=%d | mới=%d | lưu=%d (limit=%d)",
        keyword, direct_links, len(posts), skipped_invalid, skipped_old, len(existing), len(fresh), len(inserted_urls), limit,
    )

    return {
        "success": True,
        "count": len(inserted_urls),
        "post_urls": inserted_urls,
        "received": len(posts),
        "skipped_invalid": skipped_invalid,
        "skipped_old": skipped_old,
        "skipped_existing": len(existing),
    }
