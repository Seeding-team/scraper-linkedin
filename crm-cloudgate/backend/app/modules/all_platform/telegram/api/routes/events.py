"""SSE realtime cho Telegram Chat — /api/all-platform/telegram/events/stream.
Cùng khuôn ``zalo/api/routes/events.py`` nhưng đơn giản hơn: không có tính năng "share 1
hội thoại cụ thể với admin/leader" (RBAC chỉ ở mức "được xem account nào", xem
``telegram_service._resolve_member_scope``)."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.telegram.services import telegram_service
from app.modules.all_platform.telegram.services.message_events import subscribe_telegram_events

router = APIRouter(prefix="/events")


@router.get("/stream")
async def stream_telegram_events(request: Request, user: Dict[str, Any] = Depends(get_current_user)):
    account_ids = await telegram_service.resolve_account_ids_for_stream(user)

    async def event_gen():
        async for chunk in subscribe_telegram_events(account_ids):
            if await request.is_disconnected():
                break
            yield chunk

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
