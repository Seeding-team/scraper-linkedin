"""Job snapshot KPI cuoi tuan (APScheduler cron).

- Chay vao cuoi ngay Chu Nhat hang tuan (23:55 gio Viet Nam UTC+7).
- Tu dong chot snapshot cho cac session dang o trang thai 'active'.
- Neu session co auto_sync_enabled = True thi tu dong goi dong bo sang PM Plane.so.
- Kill-switch: DISABLE_KPI_SNAPSHOT hoac DISABLE_SCHEDULER.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("app.jobs.kpi_snapshot")


def _env_flag_off(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")


def execute_kpi_weekly_snapshot() -> None:
    """Ham cron thuc thi snapshot cuoi tuan."""
    from app.core.supabase_client import get_supabase_client
    from app.modules.all_platform.services import (
        kpi_calculation_service,
        kpi_pm_sync_service,
    )

    logger.info("[KPI-SNAPSHOT] Bat dau kiem tra va snapshot cac session active...")
    try:
        supabase = get_supabase_client()
        # Tim cac session dang active
        resp = (
            supabase.table("kpi_sessions")
            .select("id, crm_team_id, week_start, week_end, status")
            .eq("status", "active")
            .execute()
        )
        sessions = resp.data or []
        logger.info(f"[KPI-SNAPSHOT] Tim thay {len(sessions)} session active can snapshot")

        for sess in sessions:
            sid = sess["id"]
            try:
                snapshots = kpi_calculation_service.snapshot_session(sid)
                logger.info(f"[KPI-SNAPSHOT] Da luu {len(snapshots)} snapshot cho session {sid}")

                # Kiem tra auto_sync PM
                pm_sync_resp = (
                    supabase.table("kpi_session_pm_sync")
                    .select("auto_sync_enabled")
                    .eq("session_id", sid)
                    .limit(1)
                    .execute()
                )
                sync_conf = pm_sync_resp.data[0] if pm_sync_resp.data else None
                if sync_conf and sync_conf.get("auto_sync_enabled"):
                    logger.info(f"[KPI-SNAPSHOT] Auto-sync PM enabled cho session {sid}, bat dau sync...")
                    res = kpi_pm_sync_service.sync_session_to_pm(sid)
                    logger.info(f"[KPI-SNAPSHOT] Ket qua auto-sync PM session {sid}: {res.get('message')}")
            except Exception as e:
                logger.error(f"[KPI-SNAPSHOT] Loi khi snapshot session {sid}: {e}")
    except Exception as e:
        logger.exception(f"[KPI-SNAPSHOT] Loi ngoai le khi thuc thi job snapshot: {e}")


def setup_kpi_snapshot_job() -> None:
    """Dang ky cron job snapshot KPI cuoi tuan. Goi tu app.main.lifespan."""
    if _env_flag_off("DISABLE_KPI_SNAPSHOT") or _env_flag_off("DISABLE_SCHEDULER"):
        logger.warning("DISABLE_KPI_SNAPSHOT hoac DISABLE_SCHEDULER enabled -> khong start kpi snapshot job.")
        return

    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.executors.asyncio import AsyncIOExecutor

    scheduler = AsyncIOScheduler(
        executors={"default": AsyncIOExecutor()},
        job_defaults={"coalesce": True},
        timezone=timezone(timedelta(hours=7)),
    )
    # Chay vao 23:55 Chu Nhat hang tuan
    scheduler.add_job(
        func=lambda: asyncio.to_thread(execute_kpi_weekly_snapshot),
        trigger="cron",
        day_of_week="sun",
        hour=23,
        minute=55,
        id="kpi_weekly_snapshot_job",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("🕒 KPI weekly snapshot scheduler started (23:55 Chu Nhat hang tuan, gio Viet Nam UTC+7).")

