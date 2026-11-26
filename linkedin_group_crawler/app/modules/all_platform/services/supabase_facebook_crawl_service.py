import asyncio
import logging
import threading
from typing import List
from datetime import datetime, timedelta, timezone
import re

from app.core.supabase_client import get_supabase_client
from app.modules.facebook.src.modules.crawl_fb.models.GroupSummary import GroupSummary

logger = logging.getLogger(__name__)


def _run_lead_scoring_in_background(table: str, rows: list[dict], **kwargs) -> None:
    """Chạy `score_and_save_posts()` (bất đồng bộ) từ hàm đồng bộ này.

    Việc A (2026-11-26): luồng cào 24h tự động (hàm chứa helper này) gọi trực tiếp
    từ nhiều ngữ cảnh khác nhau — có chỗ đã nằm sẵn trong thread riêng (qua
    `asyncio.to_thread(save_facebook_crawl_to_supabase, ...)`, không có event loop
    đang chạy trong thread đó -> `asyncio.run()` chạy bình thường, giống hệt cách
    Extension/Public4G chờ xong trước khi trả kết quả), có chỗ (`daily_crawl_job.py`,
    job APScheduler) khả năng chạy ngay trên thread có event loop chính đang chạy ->
    `asyncio.run()` sẽ ném "cannot be called from a running event loop". Tự phát
    hiện 2 trường hợp để luôn an toàn, không chặn request/job nào.
    """
    from app.modules.all_platform.services.lead_score_service import score_and_save_posts

    coro_factory = lambda: score_and_save_posts(table, rows, **kwargs)  # noqa: E731

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # Khong co event loop dang chay trong thread hien tai -> chay dong bo an toan
        # (thread nay von da la background thread cua caller, khong block request chinh).
        asyncio.run(coro_factory())
    else:
        # Dang co event loop chay trong thread hien tai -> khong the long asyncio.run().
        # Chay trong 1 thread moi, rieng biet, "fire-and-forget" giong het
        # asyncio.create_task() ma post_ingest_service.py dung cho Extension/Public4G.
        threading.Thread(target=lambda: asyncio.run(coro_factory()), daemon=True).start()

def parse_facebook_time(time_str: str) -> str | None:
    if not time_str:
        return None
        
    time_str = time_str.strip().lower()
    now = datetime.now(timezone.utc)
    
    try:
        # 1. "Vừa xong"
        if "vừa xong" in time_str:
            return now.isoformat()
            
        # 2. Phút
        match = re.search(r'(\d+)\s*phút', time_str)
        if match:
            mins = int(match.group(1))
            return (now - timedelta(minutes=mins)).isoformat()
            
        # 3. Giờ
        match = re.search(r'(\d+)\s*giờ', time_str)
        if match:
            hours = int(match.group(1))
            return (now - timedelta(hours=hours)).isoformat()
            
        # 4. Ngày
        match = re.search(r'(\d+)\s*ngày', time_str)
        if match:
            days = int(match.group(1))
            return (now - timedelta(days=days)).isoformat()
            
        # 5. Tuần
        match = re.search(r'(\d+)\s*tuần', time_str)
        if match:
            weeks = int(match.group(1))
            return (now - timedelta(weeks=weeks)).isoformat()
            
        # 6. Hôm qua
        if "hôm qua" in time_str:
            base_time = now - timedelta(days=1)
            time_match = re.search(r'lúc\s*(\d{1,2}):(\d{2})', time_str)
            if time_match:
                h, m = int(time_match.group(1)), int(time_match.group(2))
                base_time = base_time.replace(hour=h, minute=m)
            return base_time.isoformat()
            
        # 7. Ngày tháng (Ví dụ: 12 tháng 5 lúc 10:00)
        match = re.search(r'(\d{1,2})\s*tháng\s*(\d{1,2})', time_str)
        if match:
            day, month = int(match.group(1)), int(match.group(2))
            
            # Check for year
            year_match = re.search(r'năm\s*(\d{4})', time_str)
            if year_match:
                year = int(year_match.group(1))
            else:
                year = now.year
                
            base_time = now.replace(year=year, month=month, day=day)
            
            # Check for time
            time_match = re.search(r'lúc\s*(\d{1,2}):(\d{2})', time_str)
            if time_match:
                h, m = int(time_match.group(1)), int(time_match.group(2))
                base_time = base_time.replace(hour=h, minute=m)
                
            # Future date correction (if article is from previous year)
            if base_time > now:
                base_time = base_time.replace(year=year - 1)
                
            return base_time.isoformat()
            
        # 8. ISO Format / Other valid formats
        # If it doesn't match Vietnamese relative formats, we'll return it as-is 
        # and let Postgres handle it (or fail if invalid, but we catch below)
        return time_str
    except Exception as e:
        logger.warning(f"Failed to parse time string: {time_str} - {e}")
        return None

def save_facebook_crawl_to_supabase(user_id: str, summaries: List[GroupSummary]) -> dict:
    """Save Facebook crawl results (hot posts) to Supabase facebook_posts table.

    Returns a dict including inserted_posts for follow-up background filtering.
    """
    if not summaries:
        return {"total_posts": 0, "errors": [], "duplicates": 0, "inserted_posts": []}


    supabase = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Get all group URLs to fetch their taxonomy
    group_urls = [s.link_group for s in summaries if s.link_group]
    groups_db = []
    if group_urls:
        res = supabase.table("facebook_groups").select("*").in_("group_url", group_urls).execute()
        groups_db = res.data or []

    group_map = {g.get("group_url"): g for g in groups_db if g.get("group_url")}

    posts_to_insert: list[dict] = []
    errors: list[str] = []
    inserted_posts: list[dict] = []
    # Viec A (2026-11-26): group_id -> metadata, dung de goi score_and_save_posts()
    # theo dung tung nhom sau khi insert xong (xem vong lap ben duoi).
    group_meta: dict[str, dict] = {}

    def iter_selected_posts(summary: GroupSummary):
        # Prefer selected_posts; fallback to hot_post for backward compatibility
        if getattr(summary, "selected_posts", None):
            return summary.selected_posts or []
        if getattr(summary, "hot_post", None):
            return [summary.hot_post]
        return []

    # Việc 2 (2026-11-26): KHÔNG còn pre-check "SELECT post_url đang có -> lọc bằng Python ->
    # insert thường" (check-then-insert không atomic — 2 lần cào (job 24h) đụng nhau cùng lúc
    # có thể cùng thấy "chưa có" rồi cùng insert, lần sau bị UNIQUE constraint chặn -> insert()
    # thường ném exception làm MẤT NGUYÊN BATCH, kể cả bài mới hợp lệ khác trong cùng batch).
    # Mọi post hợp lệ (có url + group_id) đều được đưa thẳng vào posts_to_insert, giao hẳn việc
    # chống trùng cho DB qua upsert(on_conflict="post_url", ignore_duplicates=True) bên dưới.
    for summary in summaries:
        group_url = summary.link_group
        db_group = group_map.get(group_url, {})
        group_id = db_group.get("id")

        if group_id and group_id not in group_meta:
            group_meta[group_id] = {
                "group_name": summary.group_name or db_group.get("group_name"),
                "group_url": group_url,
                "id_member": summary.id_member or user_id,
            }

        for post in iter_selected_posts(summary):
            if not post or not post.url:
                continue

            post_time = parse_facebook_time(post.date) if post.date else None

            post_data = {
                "group_id": group_id,
                "post_url": post.url,
                "crawl_date": now_iso,
                "post_time": post_time,
                "content": post.content,
                "score": post.score,
                "reactions": post.reactions,
                "comments": post.comments,
                "shares": post.shares,
                "media_url": None,
                "image_urls": post.images or [],
                "created_at": now_iso,
                "updated_at": now_iso,
                "id_member": summary.id_member or user_id,
            }

            inserted_posts.append(
                {
                    "id_member": summary.id_member or user_id,
                    "post_url": post.url,
                    "content": post.content,
                    # Use group intent as context for AI
                    "industry": getattr(summary, "Intent", None),
                }
            )

            if group_id:
                posts_to_insert.append(post_data)

    if not posts_to_insert:
        return {"total_posts": 0, "errors": errors, "duplicates": 0, "inserted_posts": inserted_posts}

    try:
        # ignore_duplicates=True -> ON CONFLICT (post_url) DO NOTHING ở tầng DB: atomic,
        # race-safe (giống hệt pattern đã dùng ở post_ingest_service.py/
        # supabase_linkedin_extension_crawl_service.py/supabase_threads_extension_crawl_service.py/
        # supabase_youtube_extension_crawl_service.py). QUAN TRỌNG: bài ĐÃ CÓ SẴN giữ nguyên
        # 100%, KHÔNG bị ghi đè bất kỳ cột nào (đặc biệt crawl_date) — nếu lỡ dùng upsert
        # không kèm ignore_duplicates (= DO UPDATE), crawl_date của bài cũ sẽ bị đổi thành hôm
        # nay mỗi lần job 24h quét lại trúng bài cũ, gây đúng lỗi "Tổng bài tăng ảo" ở
        # post_call_result_service.py::_count_crawled_posts (đếm theo crawl_date) — nghiêm
        # trọng hơn lỗi mất bài hiện tại. Xem test_facebook_crawl_dedupe_upsert.py.
        res = (
            supabase.table("facebook_posts")
            .upsert(posts_to_insert, on_conflict="post_url", ignore_duplicates=True)
            .execute()
        )

        # Với ON CONFLICT DO NOTHING, PostgREST (Prefer: return=representation) chỉ trả về
        # (RETURNING) đúng những dòng THẬT SỰ mới được insert — dòng trùng post_url bị DB bỏ
        # qua hoàn toàn không có trong res.data. Dùng thẳng res.data để suy ra total_posts/
        # duplicates chính xác, không còn đoán qua snapshot pre-check như trước.
        attempted_urls = {p["post_url"] for p in posts_to_insert}
        newly_inserted_urls = {row["post_url"] for row in (res.data or []) if row.get("post_url")}
        duplicates = len(attempted_urls) - len(newly_inserted_urls)

        # Lọc inserted_posts (dùng cho bước AI/industry phía sau, xem crawl_fb/services/index.py)
        # chỉ còn đúng bài THẬT SỰ mới insert — bài bị DB bỏ qua vì đã tồn tại thì không cần xử
        # lý AI lại (đã xử lý ở lần cào trước tạo ra nó). Post không có group_id (chưa từng vào
        # posts_to_insert) giữ nguyên trong danh sách như hành vi gốc.
        inserted_posts = [
            p
            for p in inserted_posts
            if p["post_url"] not in attempted_urls or p["post_url"] in newly_inserted_urls
        ]

        if res.data:
            from app.modules.all_platform.services.crawl_exclude_service import auto_reject_if_excluded

            for row in res.data:
                try:
                    auto_reject_if_excluded(row.get("id"), "facebook", row.get("content") or "")
                except Exception as exc:
                    logger.warning("auto_reject_if_excluded lỗi cho post_id=%s: %s", row.get("id"), exc)

            # Việc A (2026-11-26): nối luồng cào 24h tự động vào AI lead-scoring, đúng
            # cơ chế Extension/Public4G đang dùng (post_ingest_service.py) — bao gồm cả
            # việc XOÁ bài đối thủ/điểm thấp (yêu cầu Master 2026-11-04). Trước đây luồng
            # này KHÔNG gọi AI chấm điểm -> lead_score luôn NULL vĩnh viễn -> bị
            # .gte("lead_score", 40) ở unified_posts_service.py ẩn khỏi feed mặc định mãi
            # mãi dù vẫn tính vào "Tổng bài" (nguyên nhân chính đã xác định qua điều tra).
            # Gộp theo từng group_id để truyền đúng id_member/group_name/group_url của
            # chính nhóm đó (1 lần save có thể gồm nhiều nhóm khác nhau).
            rows_by_group: dict[str, list[dict]] = {}
            for row in res.data:
                gid = row.get("group_id")
                if gid:
                    rows_by_group.setdefault(gid, []).append(row)

            for group_id, group_rows in rows_by_group.items():
                meta = group_meta.get(group_id, {})
                try:
                    _run_lead_scoring_in_background(
                        "facebook_posts",
                        group_rows,
                        id_member=meta.get("id_member") or user_id,
                        group_name=meta.get("group_name"),
                        crawl_source="facebook_24h_auto",
                        group_url=meta.get("group_url"),
                    )
                except Exception as exc:
                    logger.warning("score_and_save_posts lỗi cho group_id=%s: %s", group_id, exc)

        return {
            "total_posts": len(res.data or []),
            "errors": errors,
            "duplicates": duplicates,
            "inserted_posts": inserted_posts,
        }

    except Exception as e:
        logger.error(f"Error saving FB posts to Supabase: {e}")
        errors.append(str(e))

    return {"total_posts": 0, "errors": errors, "duplicates": 0, "inserted_posts": inserted_posts}

