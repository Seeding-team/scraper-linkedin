"""Unified WhatsApp router mounted at ``/api/all-platform/whatsapp`` by ``all_platform/router.py``."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.whatsapp.api.routes.accounts import router as accounts_router
from app.modules.all_platform.whatsapp.api.routes.auth import router as auth_router
from app.modules.all_platform.whatsapp.api.routes.calls import router as calls_router
from app.modules.all_platform.whatsapp.api.routes.conversations import router as conversations_router
from app.modules.all_platform.whatsapp.api.routes.events import router as events_router
from app.modules.all_platform.whatsapp.api.routes.messages import router as messages_router
from app.modules.all_platform.whatsapp.api.routes.quick_replies import router as quick_replies_router
from app.modules.all_platform.whatsapp.services import whatsapp_service

whatsapp_router = APIRouter()
whatsapp_router.include_router(auth_router)
whatsapp_router.include_router(accounts_router)
whatsapp_router.include_router(conversations_router)
whatsapp_router.include_router(messages_router)
whatsapp_router.include_router(calls_router)
whatsapp_router.include_router(quick_replies_router)
whatsapp_router.include_router(events_router)


@whatsapp_router.get("/media/{account_id}/{message_id}", tags=["WhatsApp Messages"])
async def serve_local_media_alias(
    account_id: str,
    message_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Short alias for local media fallback alongside ``/messages/media/{account_id}/{message_id}``."""
    file_path, mime, filename = await whatsapp_service.resolve_media_file(
        user, account_id, message_id
    )
    return FileResponse(path=str(file_path), media_type=mime, filename=filename)


router = whatsapp_router
