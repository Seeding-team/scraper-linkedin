"""Worker dong bo file hop dong len Google Drive (2026-10-26, Phan A3).

Job BEN VUNG - khac voi 1 lan BackgroundTasks don thuan: moi yeu cau dong bo CHI insert 1 row
vao bang `contract_drive_sync_jobs` (status='queued'), KHONG goi Drive truc tiep trong request.
Worker nay (APScheduler interval, pattern sao chep tu msc_sync_job.py da co san trong repo) poll
bang do moi 10s, xu ly tuan tu, backoff khi loi. Vi job nam trong DB (khong phai RAM), backend
restart KHONG mat job dang cho - worker khoi dong lai se tu nhat tiep.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("app.jobs.contract_drive_sync")

_MAX_ATTEMPTS = 5
_BACKOFF_SECONDS = (30, 120, 600, 1800, 3600)  # 30s/2p/10p/30p/1h


def _backoff_for(attempts: int) -> int:
    idx = min(attempts, len(_BACKOFF_SECONDS) - 1)
    return _BACKOFF_SECONDS[idx]


def process_pending_drive_jobs() -> None:
    from app.core.supabase_client import get_supabase_client
    from app.modules.all_platform.services.contract_drive_service import sync_contract_file

    sb = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        queued = sb.table("contract_drive_sync_jobs").select("*").eq("status", "queued").limit(5).execute().data or []
        due_errors = (
            sb.table("contract_drive_sync_jobs").select("*").eq("status", "error")
            .lte("next_attempt_at", now_iso).limit(5).execute().data
        ) or []
    except Exception as exc:  # noqa: BLE001
        # Bang chua ton tai (migration 194 chua ap dung) - khong spam log loi moi 10s, chi 1 dong canh bao ro rang.
        logger.warning("Không đọc được contract_drive_sync_jobs (có thể migration 194 chưa chạy): %s", exc)
        return

    jobs = queued + due_errors
    for job in jobs:
        job_id = job["id"]
        sb.table("contract_drive_sync_jobs").update({"status": "running", "updated_at": now_iso}).eq("id", job_id).execute()
        try:
            result = sync_contract_file(job["contract_id"])
            if result.get("status") == "error":
                raise RuntimeError(result.get("error") or "Lỗi không rõ")
            sb.table("contract_drive_sync_jobs").update({
                "status": "done", "last_error": None, "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            logger.info("[DRIVE-SYNC] job %s xong: %s", job_id, result)
        except Exception as exc:  # noqa: BLE001
            attempts = (job.get("attempts") or 0) + 1
            next_attempt = datetime.now(timezone.utc) + timedelta(seconds=_backoff_for(attempts))
            sb.table("contract_drive_sync_jobs").update({
                "status": "error", "attempts": attempts, "last_error": str(exc)[:2000],
                "next_attempt_at": next_attempt.isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            logger.warning("[DRIVE-SYNC] job %s lỗi (lần %s): %s", job_id, attempts, exc)


async def _tick() -> None:
    """QUAN TRONG (bug that xac nhan qua test, khong phai doan): dang ky truc tiep
    `lambda: asyncio.to_thread(fn)` lam job func (y het pattern cu trong msc_sync_job.py) khien
    AsyncIOExecutor KHONG await dung coroutine tra ve (RuntimeWarning "coroutine 'to_thread' was
    never awaited" trong log that, job "executed successfully" nhung than KHONG chay gi ca). Phai
    dinh nghia 1 ham async THAT SU roi tu await ben trong, khong dua coroutine qua lambda."""
    import asyncio

    await asyncio.to_thread(process_pending_drive_jobs)


def setup_contract_drive_sync_worker() -> None:
    """Dang ky vao APScheduler (goi tu app.main.lifespan, cung pattern voi setup_msc_sync_job)."""
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.executors.asyncio import AsyncIOExecutor

    scheduler = AsyncIOScheduler(
        executors={"default": AsyncIOExecutor()},
        job_defaults={"coalesce": True},
        timezone=timezone(timedelta(hours=7)),
    )
    scheduler.add_job(
        func=_tick,
        trigger="interval",
        seconds=10,
        id="contract_drive_sync_worker",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("🕒 Contract Drive sync worker started (poll mỗi 10s).")
