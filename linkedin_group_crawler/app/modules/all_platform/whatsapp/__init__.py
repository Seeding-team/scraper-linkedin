"""WhatsApp Multi-Device Chat & Dual-Mode VoIP Call module."""

from app.modules.all_platform.whatsapp.api.routes.router import whatsapp_router
from app.modules.all_platform.whatsapp.services.bridge_manager import (
    shutdown_all_bridges,
    start_persisted_bridges,
)

__all__ = [
    "whatsapp_router",
    "start_persisted_bridges",
    "shutdown_all_bridges",
]
