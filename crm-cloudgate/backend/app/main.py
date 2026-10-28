"""FastAPI entrypoint cho module CRM độc lập.

Rút gọn từ `linkedin_group_crawler/app/main.py` gốc: giữ nguyên middleware CORS
tuỳ biến + endpoint /health + exception handler (đều không phụ thuộc crawler).

2026-09-23: thêm lại lifespan CHỈ để auto-start ZCA persistent listener (Zalo
Chat/Inbox Zalo Admin, đồng bộ từ crm-module) — copy nguyên từ
crm-module/backend/app/main.py. Vẫn KHÔNG có scheduler/Playwright warmup nào
khác, module này không tự cào dữ liệu gì ngoài Zalo.
"""

from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager

if sys.platform == "win32":
    # Ép UTF-8 cho console Windows để tránh lỗi encode khi log tiếng Việt.
    for _stream_name in ("stdout", "stderr"):
        _stream = getattr(sys, _stream_name, None)
        if _stream is not None and hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logger import get_logger, setup_logging
from app.modules.all_platform.router import all_platform_router
from app.modules.all_platform.schemas.common import BaseResponse

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-start ZCA persistent listeners cho mọi account đã có auth file trên
    # disk (artifacts/zca-auth/*.json) — không có hook này thì listener chỉ
    # được start khi user import session mới, và sau khi backend restart sẽ
    # không có realtime push cho tới khi ai đó đăng nhập lại.
    zca_listeners_task: asyncio.Task | None = None

    async def _start_zca_listeners_background() -> None:
        try:
            from app.modules.all_platform.zalo.services.zca_persistent_listener import (
                start_persisted_listeners,
            )
            await start_persisted_listeners()
            logger.info("ZCA persistent listeners auto-start finished")
        except Exception:
            logger.exception(
                "ZCA persistent listeners auto-start failed — sẽ thử lại khi user login lại",
            )

    if os.getenv("DISABLE_ZCA_LISTENERS", "").strip().lower() in {"1", "true", "yes"}:
        logger.warning("DISABLE_ZCA_LISTENERS enabled -> not auto-starting ZCA persistent listeners.")
    else:
        zca_listeners_task = asyncio.create_task(_start_zca_listeners_background())

    # MSC → CRM product sync (migration 175): cron 1 lan/ngay, goi dung
    # msc_sync_service.run_sync nhu button manual. Gate: DISABLE_MSC_SYNC;
    # khong them job neu MSC_API_BASE_URL chua cau hinh (xem jobs/msc_sync_job.py).
    try:
        from app.modules.all_platform.jobs.msc_sync_job import setup_msc_sync_job
        setup_msc_sync_job()
        logger.info("MSC product sync scheduler setup finished")
    except Exception:
        logger.exception("Failed to start MSC product sync scheduler")

    # Google Drive sync worker cho hop dong (2026-10-26, Phan A3) - poll bang
    # contract_drive_sync_jobs moi 10s, ben vung qua restart (xem jobs/contract_drive_sync_job.py).
    try:
        from app.modules.all_platform.jobs.contract_drive_sync_job import setup_contract_drive_sync_worker
        setup_contract_drive_sync_worker()
        logger.info("Contract Drive sync worker setup finished")
    except Exception:
        logger.exception("Failed to start Contract Drive sync worker")

    # Word Editor (OnlyOffice self-host, 2026-10-27, CHI dev) - forcesave dinh ky cho moi phien
    # dang 'editing' (xem jobs/contract_edit_forcesave_job.py).
    try:
        from app.modules.all_platform.jobs.contract_edit_forcesave_job import setup_contract_edit_forcesave_worker
        setup_contract_edit_forcesave_worker()
        logger.info("Word Editor forcesave worker setup finished")
    except Exception:
        logger.exception("Failed to start Word Editor forcesave worker")

    # Auto-start lại các Telegram client (Telethon) đã connected trước khi BE restart.
    telegram_clients_task: asyncio.Task | None = None

    async def _start_telegram_clients_background() -> None:
        try:
            from app.modules.all_platform.telegram.services.client_manager import start_persisted_clients
            await start_persisted_clients()
            logger.info("Telegram persistent clients auto-start finished")
        except Exception:
            logger.exception("Telegram persistent clients auto-start failed — sẽ thử lại khi user kết nối lại")

    if os.getenv("DISABLE_TELEGRAM_LISTENERS", "").strip().lower() in {"1", "true", "yes"}:
        logger.warning("DISABLE_TELEGRAM_LISTENERS enabled -> not auto-starting Telegram clients.")
    else:
        telegram_clients_task = asyncio.create_task(_start_telegram_clients_background())

    try:
        yield
    finally:
        if zca_listeners_task is not None and not zca_listeners_task.done():
            zca_listeners_task.cancel()
            try:
                await zca_listeners_task
            except asyncio.CancelledError:
                pass
        try:
            from app.modules.all_platform.zalo.services.zca_persistent_listener import (
                shutdown_persistent_listeners,
            )
            await shutdown_persistent_listeners()
        except Exception:
            logger.exception("ZCA persistent listeners shutdown failed")
        if telegram_clients_task is not None and not telegram_clients_task.done():
            telegram_clients_task.cancel()
            try:
                await telegram_clients_task
            except asyncio.CancelledError:
                pass
        try:
            from app.modules.all_platform.telegram.services.client_manager import shutdown_all as shutdown_telegram_clients
            await shutdown_telegram_clients()
        except Exception:
            logger.exception("Telegram clients shutdown failed")


app = FastAPI(
    title="CRM Module API",
    version="1.0.0",
    description="Module CRM độc lập (Leads/Khách hàng/Cơ hội/Báo giá/Hợp đồng/Sản phẩm & dịch vụ) — dùng chung DB self-host với app seeding.",
    lifespan=lifespan,
)


@app.middleware("http")
async def handle_cors_middleware(request: Request, call_next):
    origin = request.headers.get("origin", "")

    allowed_origins = {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:18090",
        "http://127.0.0.1:18090",
    }
    for _o in (os.getenv("CORS_ORIGINS", "") or "").split(","):
        _o = _o.strip()
        if _o:
            allowed_origins.add(_o)

    is_allowed = origin in allowed_origins

    if request.method == "OPTIONS":
        response = Response(status_code=200)
        if is_allowed and origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        else:
            response.headers["Access-Control-Allow-Origin"] = origin or "*"
        response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS, PUT, DELETE, PATCH"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, x-api-key, Authorization, X-User-ID, X-Caller-Email, Idempotency-Key"
        return response

    response = await call_next(request)

    if origin:
        if is_allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        else:
            response.headers["Access-Control-Allow-Origin"] = origin

    response.headers.setdefault("Keep-Alive", "timeout=30, max=100")
    response.headers.setdefault("X-Connection-Mode", "persistent")

    return response


@app.get("/health", response_model=BaseResponse)
def root_health() -> BaseResponse:
    """Health check cho Docker/reverse-proxy."""
    return BaseResponse(success=True, message="CRM module is healthy")


@app.get("/debug/instance", response_model=BaseResponse)
def debug_instance(request: Request) -> BaseResponse:
    """Debug endpoint to verify the fixed CRM tenant for this backend."""
    return BaseResponse(
        success=True,
        data={
            "host_header": (request.headers.get("host") or "").split(":")[0].strip().lower(),
            "resolved_instance": settings.crm_instance,
            "default_crm_instance": settings.crm_instance,
        },
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_, exc: RequestValidationError) -> JSONResponse:
    error_messages: list[str] = []
    for item in exc.errors():
        location = " -> ".join(str(part) for part in item.get("loc", []))
        message = item.get("msg", "Invalid request")
        error_messages.append(f"{location}: {message}")

    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "message": "Invalid request body",
            "data": {"errors": error_messages},
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_, exc: Exception) -> JSONResponse:
    """Safety net cho loi chua bat: FastAPI/Starlette tu uu tien handler cu
    the hon (HTTPException/RequestValidationError da dang ky o tren) truoc
    khi roi xuong day, nen handler nay CHI nhan cac exception thuc su chua
    bat o dau ca. BUG THAT DA GAP: 1 so call site Supabase (auth, quote,
    project, members...) goi `.execute()` truc tiep, khong qua wrapper
    `execute_supabase_query()` - khi PostgREST self-host tra ve 502/503/504
    (OpenResty/Kong gap su co), `postgrest.exceptions.APIError` thoat nguyen
    dang (dict Python: `{'message': 'JSON could not be generated', 'code':
    502, ...}`) toi tan response cho FE neu co code nao do lam `str(exc)`.
    Bat toan bo o day de KHONG bao gio lo raw dict/HTML nhu vay ra ngoai."""
    from app.core.supabase_client import (
        friendly_supabase_error_message,
        is_transient_supabase_error,
    )

    logger.exception("Unhandled exception: %s", exc)
    if is_transient_supabase_error(exc):
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "message": friendly_supabase_error_message(exc),
                "data": None,
            },
        )
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": "Đã có lỗi xảy ra, vui lòng thử lại.",
            "data": None,
        },
    )


app.include_router(all_platform_router, prefix="/api/all-platform")

# Word Editor (OnlyOffice self-host, 2026-10-27, CHI dev - xem
# C:\Users\Asus\.claude\plans\proud-stargazing-pixel.md) - plugin can duoc trinh duyet TAI QUA
# URL CONG KHAI (router nginx /api/ da proxy nguyen path toi backend nay, xem nginx/nginx.conf)
# vi OnlyOffice fetch pluginsData bang fetch() TRONG TRINH DUYET (da xac nhan qua Phase 0 POC),
# khong phai server-side nhu document.url. config.json dong (khong phai file tinh) vi "baseUrl"
# ben trong phai tro dung CRM_PUBLIC_URL, khong hardcode duoc luc build image.
import os as _os

from fastapi.staticfiles import StaticFiles

_onlyoffice_plugin_dir = _os.path.join(_os.path.dirname(__file__), "..", "static", "onlyoffice_plugin")


# BUG THAT DA GAP (xac nhan qua Playwright that, console 404 luc mo tab "Chinh sua (Word)"):
# OnlyOffice KHONG dung field "baseUrl" de tai chinh file "index.html" cua plugin - no resolve
# variations[].url ("index.html") TUONG DOI VOI CHINH URL cua config.json (tuc cung thu muc
# "/api/onlyoffice-plugin/", KHONG phai "/api/onlyoffice-plugin/assets/" nhu "baseUrl" khai bao).
# Phai mount static file o DUNG prefix do ("/api/onlyoffice-plugin", khong phai "/assets" con)
# - va DANG KY route config.json TRUOC mount (Starlette match theo thu tu dang ky, route cu the
# phai di truoc Mount cung prefix neu khong se bi Mount "nuot" mat). "baseUrl" van giu dung prefix
# nay de cac tai nguyen SAU NAY (neu index.html dung duong dan tuyet doi qua baseUrl) cung dung.
@app.get("/api/onlyoffice-plugin/config.json")
def onlyoffice_plugin_config() -> dict:
    base = f"{settings.crm_public_url}/api/onlyoffice-plugin/"
    return {
        "name": "Markee Contract Editor Bridge",
        "guid": "asc.{B7E4C9F1-6A2D-4E3B-8C5A-1F9D2E8B4C7A}",
        "baseUrl": base,
        "variations": [{
            "description": "Markee Contract Editor Bridge",
            "url": "index.html",
            "icons": [], "isViewer": False, "EditorsSupport": ["word"],
            "isVisual": False, "initDataType": "none", "initData": "", "buttons": [],
        }],
    }


app.mount("/api/onlyoffice-plugin", StaticFiles(directory=_onlyoffice_plugin_dir), name="onlyoffice-plugin-assets")
