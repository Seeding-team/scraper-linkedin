"""SSE realtime event stream route for WhatsApp Chat & Call."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.whatsapp.services import whatsapp_service
from app.modules.all_platform.whatsapp.services.message_events import subscribe_whatsapp_events

router = APIRouter(prefix="/events", tags=["WhatsApp Events"])


@router.get("/stream")
async def stream_whatsapp_events(
    request: Request,
    account_id: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_current_user),
):
    account_ids, member_scope = await whatsapp_service.resolve_stream_scope(
        user, account_id=account_id
    )

    async def event_gen():
        async for chunk in subscribe_whatsapp_events(
            account_ids,
            member_ids=member_scope,
            explicit_account_filter=account_id,
        ):
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
