"""Lưu bài viết Threads cào bằng "Markee Seeding Extension" (lệnh MK_TH_CRAWL_*) vào bảng `threads_posts`.

Tính năng "Siêu Tốc Cào Dữ Liệu" cho Threads (tab "Seeding bên ngoài"), tương tự
luồng Facebook (`routers/extension_crawl.py`) nhưng Threads không có "group": extension
mở trang tìm kiếm threads.com/search?q=<từ khoá>, lấy bài từ JSON dữ liệu của trang
rồi gửi lên đây — mỗi request là kết quả của ĐÚNG 1 từ khoá.

Các bước lọc (chạy đồng bộ, router gọi qua `asyncio.to_thread`):
1. Chuẩn hoá + kiểm tra URL bài (chỉ nhận dạng https://www.threads.com/@user/post/code).
2. Bỏ bài trùng trong batch và bài đã có trong DB (dedupe theo post_url).
3. Bỏ bài cũ hơn `max_age_days` ngày (nếu có truyền) — search Threads trả cả bài cũ.
4. Xếp theo tương tác (comment*2 + like + share*3, giống công thức chọn bài của FB)
   rồi lấy tối đa `post_limit` bài.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

TABLE = "threads_posts"
DEFAULT_POST_LIMIT = 20
MAX_POST_LIMIT = 100

# threads.com (domain mới) và threads.net (domain cũ, vẫn redirect) — username Threads
# chỉ gồm chữ/số/dấu chấm/gạch dưới; shortcode bài gồm chữ/số/-/_.
_POST_URL_RE = re.compile(
    r"^https?://(?:www\.)?threads\.(?:com|net)/@([A-Za-z0-9._]+)/post/([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)


def normalize_threads_post_url(url: Optional[str]) -> Optional[tuple[str, str, str]]:
    """Trả về (url_chuẩn, username, code) hoặc None nếu không phải URL bài Threads hợp lệ.

    Bỏ query string, hậu tố /media, /replies... để 1 bài chỉ có đúng 1 URL trong DB.
    """
    if not url:
        return None
    m = _POST_URL_RE.match(url.strip())
    if not m:
        return None
    username, code = m.group(1), m.group(2)
    return f"https://www.threads.com/@{username}/post/{code}", username, code


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


def _engagement_score(p: dict) -> int:
    return p["comments"] * 2 + p["reactions"] + p["shares"] * 3


def save_threads_crawl_batch(
    *,
    posts: list[dict],
    keyword: Optional[str],
    id_member: Optional[str],
    post_limit: Optional[int],
    max_age_days: Optional[int],
) -> dict:
    supabase = get_supabase_client()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    limit = post_limit if post_limit and post_limit > 0 else DEFAULT_POST_LIMIT
    limit = min(limit, MAX_POST_LIMIT)
    cutoff = now - timedelta(days=max_age_days) if max_age_days and max_age_days > 0 else None

    # 1 + 2a. Chuẩn hoá, bỏ URL lạ + trùng trong batch
    candidates: dict[str, dict] = {}
    skipped_invalid = 0
    skipped_old = 0
    for raw in posts:
        norm = normalize_threads_post_url(raw.get("post_url"))
        if not norm:
            skipped_invalid += 1
            continue
        url, username, code = norm
        if url in candidates:
            continue

        post_time = _parse_post_time(raw.get("post_time"))
        # 3. Lọc bài cũ: bài không rõ thời gian cũng bỏ khi có giới hạn ngày (không
        # chứng minh được là bài mới) — giống FB bỏ bài không có time.
        if cutoff is not None and (post_time is None or post_time < cutoff):
            skipped_old += 1
            continue

        username_from_payload = (raw.get("author_username") or "").strip().lstrip("@")
        author_username = username_from_payload or username
        images = [str(u) for u in (raw.get("image_urls") or []) if u][:10]

        candidates[url] = {
            "post_url": url,
            "post_code": code,
            "keyword": (keyword or "").strip() or None,
            "author_username": author_username,
            "author_name": (raw.get("author_name") or "").strip() or author_username,
            "author_url": f"https://www.threads.com/@{author_username}",
            "content": raw.get("content") or "",
            "post_time": post_time.isoformat() if post_time else None,
            "crawl_date": now_iso,
            "score": 0,
            "reactions": _as_int(raw.get("reactions")),
            "comments": _as_int(raw.get("comments")),
            "shares": _as_int(raw.get("shares")),
            "media_url": raw.get("media_url") or None,
            "image_urls": images,
            "id_member": id_member or None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }

    # 2b. Bỏ bài đã có trong DB
    existing: set[str] = set()
    urls = list(candidates.keys())
    for i in range(0, len(urls), 100):
        chunk = urls[i : i + 100]
        res = supabase.table(TABLE).select("post_url").in_("post_url", chunk).execute()
        existing.update(r["post_url"] for r in (res.data or []) if r.get("post_url"))

    fresh = [p for url, p in candidates.items() if url not in existing]

    # 4. Ưu tiên bài nhiều tương tác, giới hạn số bài
    fresh.sort(key=_engagement_score, reverse=True)
    selected = fresh[:limit]

    inserted_urls: list[str] = []
    if selected:
        # ignore_duplicates: 2 lần cào song song cùng tìm ra 1 bài -> lần sau bỏ qua
        # êm (ON CONFLICT DO NOTHING) thay vì lỗi cả batch vì UNIQUE(post_url).
        res = (
            supabase.table(TABLE)
            .upsert(selected, on_conflict="post_url", ignore_duplicates=True)
            .execute()
        )
        inserted_urls = [r["post_url"] for r in (res.data or []) if r.get("post_url")]
        inserted_rows = [{"id": r.get("id"), "content": r.get("content")} for r in (res.data or []) if r.get("id")]
    else:
        inserted_rows = []

    logger.info(
        "[THREADS-EXT] keyword=%r | nhận=%d | URL lạ=%d | cũ=%d | đã có=%d | mới=%d | lưu=%d (limit=%d)",
        keyword, len(posts), skipped_invalid, skipped_old, len(existing), len(fresh), len(inserted_urls), limit,
    )

    return {
        "success": True,
        "count": len(inserted_urls),
        "post_urls": inserted_urls,
        "received": len(posts),
        "skipped_invalid": skipped_invalid,
        "skipped_old": skipped_old,
        "skipped_existing": len(existing),
        # Noi bo - khong tra ve qua HTTP (router pop() ra truoc khi tra response cho
        # extension), dung de cham diem "tiem nang seeding" (LLM) chay nen sau khi luu.
        "_inserted_rows": inserted_rows,
    }
