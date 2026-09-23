"""FastAPI entrypoint cho module CRM độc lập.

Rút gọn từ `linkedin_group_crawler/app/main.py` gốc: giữ nguyên middleware CORS
tuỳ biến + endpoint /health + exception handler (đều không phụ thuộc crawler).

2026-09-23: thêm lại lifespan CHỈ để auto-start ZCA persistent listener (Zalo
Chat/Inbox Zalo Admin, phần tiếp theo của module "Quản lý kênh & CSKH" đang
được gộp dần vào — xem router.py) — copy nguyên từ zalo-module/backend/app/main.py.
Vẫn KHÔNG có scheduler/Playwright warmup nào khác, module này không tự cào dữ
liệu gì ngoài Zalo.
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

from app.core.config import settings, reset_current_instance, set_current_instance
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


app = FastAPI(
    title="CRM Module API",
    version="1.0.0",
    description="Module CRM đa brand (Leads/Khách hàng/Cơ hội/Báo giá/Hợp đồng/Sản phẩm & dịch vụ) — dùng chung DB self-host với app seeding, 1 process phục vụ nhiều domain/brand (xem instance_domain_map trong app/core/config.py).",
    lifespan=lifespan,
)


@app.middleware("http")
async def resolve_crm_instance_middleware(request: Request, call_next):
    """Xác định instance (brand) đang phục vụ request này dựa vào domain
    trình duyệt gọi vào (Host header), không phải theo process nữa — 1
    process duy nhất giờ trả lời cho cả crm.markee.vn/crm.markeeai.com/
    crm.getcloudgate.com/crm.securityzone.vn. Domain lạ (gọi thẳng IP,
    health-check nội bộ...) rơi về `default_crm_instance` thay vì lỗi."""
    host = (request.headers.get("host") or "").split(":")[0].strip().lower()
    instance = settings.instance_domain_map.get(host, settings.default_crm_instance)
    token = set_current_instance(instance)
    try:
        return await call_next(request)
    finally:
        reset_current_instance(token)


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
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, x-api-key, Authorization, X-User-ID, X-Caller-Email"
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
    """Soi instance đang được resolve cho domain (Host header) của request này
    — dùng để kiểm tra NPM/`INSTANCE_DOMAIN_MAP` đã trỏ đúng chưa sau khi
    deploy/cutover, không trả dữ liệu nhạy cảm nên không cần auth."""
    host = (request.headers.get("host") or "").split(":")[0].strip().lower()
    return BaseResponse(
        success=True,
        data={
            "host_header": host,
            "resolved_instance": settings.crm_instance,
            "instance_domain_map": settings.instance_domain_map,
            "default_crm_instance": settings.default_crm_instance,
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


app.include_router(all_platform_router, prefix="/api/all-platform")
