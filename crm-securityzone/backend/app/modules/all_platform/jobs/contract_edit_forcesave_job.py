"""Worker forcesave dinh ky cho Word Editor (2026-10-27, OnlyOffice self-host). Moi phien
`contract_edit_sessions` dang 'editing' duoc goi Command Service forcesave moi ~25s (APScheduler,
cung pattern voi contract_drive_sync_job.py/msc_sync_job.py da co san trong repo) - KHONG dung
OnlyOffice "autosave" noi bo (chi giu trang thai trong RAM cua no, mat khi container restart),
ma keo ve `_draft.docx` qua callback THAT moi lan forcesave (xem contract_edit_service.handle_callback)."""
from __future__ import annotations

import logging

logger = logging.getLogger("app.jobs.contract_edit_forcesave")


def process_active_edit_sessions() -> None:
    from app.core.supabase_client import get_supabase_client
    from app.modules.all_platform.services.contract_edit_service import trigger_forcesave

    sb = get_supabase_client()
    try:
        sessions = sb.table("contract_edit_sessions").select("document_key").eq("status", "editing").execute().data or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("Không đọc được contract_edit_sessions (có thể migration 197 chưa chạy): %s", exc)
        return
    for s in sessions:
        trigger_forcesave(s["document_key"])


async def _tick() -> None:
    import asyncio

    await asyncio.to_thread(process_active_edit_sessions)


def setup_contract_edit_forcesave_worker() -> None:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.executors.asyncio import AsyncIOExecutor
    from datetime import timedelta, timezone

    scheduler = AsyncIOScheduler(
        executors={"default": AsyncIOExecutor()},
        job_defaults={"coalesce": True},
        timezone=timezone(timedelta(hours=7)),
    )
    scheduler.add_job(
        func=_tick, trigger="interval", seconds=25,
        id="contract_edit_forcesave_worker", replace_existing=True, max_instances=1,
    )
    scheduler.start()
    logger.info("🕒 Word Editor forcesave worker started (poll mỗi 25s).")
