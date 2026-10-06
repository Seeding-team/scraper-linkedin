"""Job dong bo Hang hoa MSC → CRM tu dong 1 lan/ngay (APScheduler cron).

- DUNG LAI dung logic dong bo o services/msc_sync_service.run_sync — sched job chi
  la lop lich; manual (POST /msc-sync/run) cung goi dung ham do.
- Pattern sao che tu app/modules/all_platform/jobs/crawl_24h_job.py:
  AsyncIOScheduler + cron trigger + max_instances=1 (chong overlap) +
  kill-switch bang env.
- Kill switch: DISABLE_MSC_SYNC (theo convention DISABLE_* hien co).
- Neu MSC_API_BASE_URL chua cau hinh → KHONG them job (log warning) de tránh
  log loi / failed-run vo nghia tren moi deployment chua cau hinh MSC.
- Job chay trong thread rieng (run_sync la ham sync/blocking I/O httpx) de
  khong nghen event loop.
"""

from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger("app.jobs.msc_sync")


def _env_flag_off(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")


def execute_msc_product_sync() -> None:
    """Ham cron goi — chay 1 lan dong bo (trigger='scheduled')."""
    from app.modules.all_platform.services import msc_sync_service

    try:
        stats = msc_sync_service.run_sync(trigger="scheduled", user_id=None)
        logger.info(
            "[MSC-SYNC] scheduled run: status=%s fetched_items=%s inserted=%s updated=%s "
            "skipped=%s failed=%s duplicates=%s duration_ms=%s",
            stats.get("status"),
            stats.get("fetched_items"),
            stats.get("inserted"),
            stats.get("updated"),
            stats.get("skipped"),
            stats.get("failed"),
            stats.get("duplicates"),
            stats.get("duration_ms"),
        )
        if stats.get("status") == "failed":
            logger.error("[MSC-SYNC] that bai: %s — CRM khong bi thay doi.", stats.get("error_message"))
    except Exception:
        # run_sync tu catch exception noi bo; dong nay chi la chan cuoi cung.
        logger.exception("[MSC-SYNC] loi khong mong muon khi dong bo MSC → CRM")


def setup_msc_sync_job() -> None:
    """Dang ky cron job dong bo hang ngay. Goi tu app.main.lifespan."""
    if _env_flag_off("DISABLE_MSC_SYNC"):
        logger.warning("DISABLE_MSC_SYNC enabled -> not starting MSC product sync job.")
        return

    from app.core.config import settings

    if not (settings.msc_api_base_url or "").strip():
        logger.warning(
            "MSC_API_BASE_URL is not configured -> MSC product sync job will NOT be scheduled."
        )
        return

    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.executors.asyncio import AsyncIOExecutor

    scheduler = AsyncIOScheduler(
        executors={"default": AsyncIOExecutor()},
        job_defaults={"coalesce": True},
    )
    scheduler.add_job(
        func=lambda: asyncio.to_thread(execute_msc_product_sync),
        trigger="cron",
        hour=settings.msc_sync_hour,
        minute=settings.msc_sync_minute,
        id="msc_product_daily_sync",
        replace_existing=True,
        max_instances=1,  # APScheduler tu dam bao khong 2 lan tick chay chồng nhau
    )
    scheduler.start()
    logger.info(
        "🕒 MSC product sync scheduler started (daily at %02d:%02d, TZ cua container).",
        settings.msc_sync_hour,
        settings.msc_sync_minute,
    )
