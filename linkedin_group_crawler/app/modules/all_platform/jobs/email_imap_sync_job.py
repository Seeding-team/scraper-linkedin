"""Periodic IMAP ingestion for the current CRM workspace."""
from __future__ import annotations

import os

from loguru import logger


def setup_email_imap_sync_worker():
    if os.getenv("EMAIL_IMAP_SYNC_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
        logger.info("Email IMAP sync worker disabled (EMAIL_IMAP_SYNC_ENABLED is 0).")
        return None
    if os.getenv("DISABLE_EMAIL_IMAP_SYNC", "").strip().lower() in {"1", "true", "yes"}:
        logger.info("Email IMAP sync worker disabled via DISABLE_EMAIL_IMAP_SYNC=1.")
        return None

    from apscheduler.executors.pool import ThreadPoolExecutor
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from app.modules.all_platform.email.services.email_inbox_service import sync_mailbox

    interval = max(20, int(os.getenv("EMAIL_IMAP_SYNC_INTERVAL_SECONDS", "30")))
    limit = max(1, min(500, int(os.getenv("EMAIL_IMAP_SYNC_BATCH_SIZE", "100"))))

    def run() -> None:
        try:
            result = sync_mailbox(max_messages=limit)
            if result.get("imported"):
                logger.info("Email IMAP sync imported {} message(s).", result["imported"])
        except Exception as exc:
            # Do not log credentials or raw server details.
            logger.warning("Email IMAP sync failed: {}", type(exc).__name__)

    scheduler = AsyncIOScheduler(executors={"default": ThreadPoolExecutor(1)})
    scheduler.add_job(
        run, "interval", seconds=interval, id="email-imap-sync",
        max_instances=1, coalesce=True, next_run_time=None,
    )
    scheduler.start()
    # Run first sync after startup without blocking FastAPI startup.
    scheduler.modify_job("email-imap-sync", next_run_time=__import__("datetime").datetime.now())
    return scheduler
