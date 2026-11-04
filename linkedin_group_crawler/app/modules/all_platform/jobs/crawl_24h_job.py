import asyncio
import html
import logging
import os
from typing import List, Dict, Any
from datetime import datetime, timezone, timedelta

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.websocket import manager
from app.modules.all_platform.services import supabase_crawl_queue_service as queue_service
from app.modules.facebook.src.modules.telegram.services.telegram_service import TelegramService

logger = logging.getLogger(__name__)


def get_vietnam_now() -> datetime:
    """Lấy thời gian hiện tại theo múi giờ Việt Nam (UTC+7)."""
    return datetime.now(timezone(timedelta(hours=7)))


def _enqueue_due_groups_sync() -> Dict[str, int]:
    """Phần đồng bộ: query facebook_groups + enqueue job qua hàng đợi VPS worker.

    Chạy trong thread riêng (xem `execute_all_platform_crawl_workflow`) vì đây là các
    lệnh Supabase đồng bộ (network I/O) -- không được gọi trực tiếp trong hàm async
    chạy mỗi phút trên cùng tiến trình phục vụ API login (đúng loại lỗi từng khiến
    luồng Playwright cũ bị tắt vì nghẽn login).
    """
    supabase = get_supabase_client()
    now = get_vietnam_now()

    res = supabase.table("facebook_groups").select("*").eq("chay_24h", True).execute()
    all_auto_groups = res.data or []

    enqueued = 0
    skipped_pending = 0

    for row in all_auto_groups:
        start_time = row.get("start_time_in_day")
        end_time = row.get("end_time_in_day")
        time_crawl = row.get("time_crawl")
        end_date_str = row.get("end_date_hour")

        if start_time is None:
            start_time = 0
        if end_time is None:
            end_time = 24
        if time_crawl is None or time_crawl <= 0:
            time_crawl = 60

        if end_date_str:
            try:
                end_date = datetime.strptime(end_date_str[:10], "%Y-%m-%d").date()
                if now.date() > end_date:
                    continue
            except ValueError:
                pass

        now_minutes = now.hour * 60 + now.minute
        start_minutes = start_time * 60
        end_minutes = end_time * 60

        if not (start_minutes <= now_minutes <= end_minutes):
            continue
        if (now_minutes - start_minutes) % time_crawl != 0:
            continue

        group_url = (row.get("group_url") or "").strip()
        if not group_url:
            continue

        group_id = row.get("id")
        group_name = (row.get("group_name") or "Unknown").strip()
        # CHỈ dùng id_member của nhóm -- KHÔNG fallback sang assignee_id (khác mục đích:
        # assignee_id là trường CRM phân công, không phải acc FB sở hữu/thành viên nhóm).
        # Gán nhầm sẽ khiến VPS worker lấy sai acc cho nhóm kín.
        id_member = row.get("id_member")

        # Chống chồng job: nhóm này còn job pending/assigned/processing thì bỏ qua lượt
        # này, không enqueue thêm -- cần thiết vì time_crawl có thể ngắn (1 phút) trong
        # khi hàng đợi chỉ xử lý được ~1 job/worker/phút.
        existing = (
            supabase.table("crawl_jobs")
            .select("id")
            .eq("group_id", group_id)
            .in_("status", ["pending", "assigned", "processing"])
            .limit(1)
            .execute()
        )
        if existing.data:
            skipped_pending += 1
            continue

        queue_service.enqueue_crawl_job(
            group_url=group_url,
            group_name=group_name,
            group_id=group_id,
            id_member=id_member,
            platform="facebook",
        )
        enqueued += 1

    return {"enqueued": enqueued, "skipped_pending": skipped_pending}


async def execute_all_platform_crawl_workflow():
    """
    Luồng cào tự động 24h cho All-Platform.
    Chạy mỗi phút để kiểm tra nhóm nào có giờ cào khớp với hiện tại -- tới giờ thì
    enqueue job vào hàng đợi VPS worker (crawl_jobs), việc cào thật do VPS tự nhận job
    và tự chọn đúng acc theo id_member (xem supabase_crawl_queue_service.py).
    """
    try:
        stats = await asyncio.to_thread(_enqueue_due_groups_sync)

        if stats["enqueued"]:
            logger.info(f"[ALL-PLATFORM-24H] Đã enqueue {stats['enqueued']} job vào hàng đợi VPS worker.")
            asyncio.create_task(manager.broadcast({
                "event": "crawl_started",
                "message": f"Đã đưa {stats['enqueued']} nhóm vào hàng đợi cào",
                "count": stats["enqueued"],
            }))
        if stats["skipped_pending"]:
            logger.info(
                f"[ALL-PLATFORM-24H] Bỏ qua {stats['skipped_pending']} nhóm còn job cũ chưa xử lý xong."
            )

    except Exception as e:
        logger.error(f"❌ Thất bại trong lúc check scheduler: {e}", exc_info=True)
        try:
            telegram = TelegramService()
            telegram.send_message(f"🚨 <b>LỖI HỆ THỐNG CRON 24H (FB)</b> 🚨\n\n<code>{html.escape(str(e))}</code>")
        except Exception:
            pass


async def execute_requeue_stale_worker_jobs():
    """Thả job 'assigned'/'processing' của worker VPS đã mất heartbeat về 'pending'."""
    try:
        await asyncio.to_thread(queue_service.requeue_stale_jobs)
    except Exception as e:
        logger.error(f"❌ Lỗi khi kiểm tra worker VPS mất kết nối: {e}", exc_info=True)


async def execute_release_stale_fb_accounts():
    """Thả acc Facebook 'assigned' của worker VPS đã mất heartbeat về 'available'
    (VM claim acc rồi crash cứng -- mất mạng/tắt máy -- mà không kịp báo report-invalid)."""
    try:
        from app.modules.all_platform.services import supabase_fb_account_pool_service as pool_service
        await asyncio.to_thread(pool_service.release_stale_account_claims)
    except Exception as e:
        logger.error(f"❌ Lỗi khi kiểm tra acc FB pool bị kẹt: {e}", exc_info=True)


def setup_all_platform_jobs():
    """
    Khởi tạo scheduler cho All-Platform.
    """
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.executors.asyncio import AsyncIOExecutor

    executors = {
        'default': AsyncIOExecutor()
    }

    scheduler = AsyncIOScheduler(executors=executors)

    if os.getenv("DISABLE_ALL_PLATFORM_CRAWL_24H", "").strip().lower() in {"1", "true", "yes"}:
        logger.warning("All-Platform 24h crawl job disabled by DISABLE_ALL_PLATFORM_CRAWL_24H")
    else:
        # Thêm tác vụ cào 24h
        scheduler.add_job(
            func=execute_all_platform_crawl_workflow,
            trigger='cron',
            minute='*', # Chạy mỗi phút, chỉ enqueue job vào hàng đợi VPS worker (nhanh, không cào trực tiếp)
            id='all_platform_daily_facebook_crawl',
            replace_existing=True,
            max_instances=1  # Chống 2 lượt tick chạy chồng nhau (APScheduler tự đảm bảo)
        )

    # Kiểm tra worker VPS mất heartbeat mỗi phút, thả job treo về hàng đợi
    scheduler.add_job(
        func=execute_requeue_stale_worker_jobs,
        trigger='cron',
        minute='*',
        id='crawl_queue_requeue_stale_worker_jobs',
        replace_existing=True,
        max_instances=1
    )

    # Kiểm tra acc Facebook pool bị kẹt 'assigned' do worker VPS crash, thả về 'available'
    scheduler.add_job(
        func=execute_release_stale_fb_accounts,
        trigger='cron',
        minute='*',
        id='crawl_fb_accounts_release_stale',
        replace_existing=True,
        max_instances=1
    )

    # Chuyển job weekly backup từ module cũ sang để không làm đứt gãy logic
    from app.modules.facebook.src.jobs.daily_crawl_job import execute_weekly_backup_and_reset_workflow
    scheduler.add_job(
        func=execute_weekly_backup_and_reset_workflow,
        trigger='cron',
        day_of_week='sun', # Thực thi vào Chủ nhật
        hour=2,            # Lúc 2 giờ sáng
        minute=0,          # 00 phút
        id='weekly_user_score_backup_reset',
        replace_existing=True
    )

    logger.info(f"🕒 All-Platform Scheduler khởi động (Chế độ: AsyncIO).")
    scheduler.start()
