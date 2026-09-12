"""FastAPI entrypoint cho module CRM độc lập.

Rút gọn từ `linkedin_group_crawler/app/main.py` gốc: giữ nguyên middleware CORS
tuỳ biến + endpoint /health + exception handler (đều không phụ thuộc crawler),
bỏ hẳn lifespan (không scheduler, không Playwright warmup, không ZCA listener —
module này không cào dữ liệu gì cả, chỉ phục vụ CRUD CRM qua Supabase).
"""

from __future__ import annotations

import os
import sys

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

app = FastAPI(
    title="CRM Module API",
    version="1.0.0",
    description="Module CRM độc lập (Leads/Khách hàng/Cơ hội/Báo giá/Hợp đồng/Sản phẩm & dịch vụ) — dùng chung DB self-host với app seeding.",
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


app.include_router(all_platform_router, prefix="/api/all-platform")
