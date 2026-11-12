"""Facebook Messenger Realtime Listener & 2-Way Synchronization Engine.

Lắng nghe sự kiện tin nhắn thời gian thực qua Webhook / Long-polling / MQTT Bridge:
1. Chiều nhận: Khách nhắn đến -> Lưu vào `fb_messenger_messages` (is_self=false), cập nhật thread, phát SSE `fb_new_message`.
2. Chiều Echo: Master gửi từ app Messenger điện thoại -> Bắt sự kiện echo, lưu vào DB (is_self=true, is_echo=true), phát SSE để Web App cập nhật 0ms không cần F5.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.phone_bridge.events import AdminEventBus

logger = logging.getLogger("fb_messenger.realtime_listener")

# Global Event Bus cho Messenger SSE
messenger_event_bus = AdminEventBus(queue_size=200)


class FbRealtimeListener:
    """Quản lý các kết nối lắng nghe thời gian thực cho từng tài khoản Messenger."""

    _active_accounts: Set[str] = set()
    _running: bool = False
    _sync_task: Optional[asyncio.Task[None]] = None

    @classmethod
    def get_event_bus(cls) -> AdminEventBus:
        """Lấy Event Bus phát sự kiện SSE."""
        return messenger_event_bus

    @classmethod
    async def process_incoming_payload(
        cls,
        account_id: str,
        sender_id: str,
        recipient_id: str,
        content: str,
        is_self: bool = False,
        is_echo: bool = False,
        sender_name: Optional[str] = None,
        recipient_name: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        offline_threading_id: Optional[str] = None,
        fb_message_id: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Xử lý và lưu trữ một gói tin nhắn (cả chiều khách gửi và echo từ điện thoại)."""
        sb = get_supabase_client()
        now_iso = datetime.now(timezone.utc).isoformat()
        msg_created_at = created_at or now_iso

        # Thread ID: Trong chat 1-1, thread ID là đối phương (không phải chính mình)
        thread_id = str(recipient_id if is_self else sender_id).strip()

        # 1. Lưu bản ghi tin nhắn vào fb_messenger_messages
        msg_payload: Dict[str, Any] = {
            "account_id": account_id,
            "thread_id": thread_id,
            "sender_id": str(sender_id),
            "sender_name": sender_name,
            "recipient_id": str(recipient_id),
            "content": content or "",
            "attachments": attachments or [],
            "is_self": is_self,
            "is_echo": is_echo,
            "status": "sent",
            "offline_threading_id": offline_threading_id,
            "created_at": msg_created_at,
        }
        if fb_message_id is not None:
            msg_payload["fb_message_id"] = fb_message_id

        try:
            msg_res = sb.table("fb_messenger_messages").insert(msg_payload).execute()
            saved_msg = msg_res.data[0] if msg_res.data else msg_payload
        except Exception as e:
            logger.exception(f"Error saving incoming fb message: {e}")
            saved_msg = msg_payload

        # 2. Cập nhật thông tin fb_messenger_threads
        thread_payload: Dict[str, Any] = {
            "account_id": account_id,
            "thread_id": thread_id,
            "recipient_id": thread_id,
            "last_message": content or "(Tệp đính kèm/Hình ảnh)",
            "last_message_at": msg_created_at,
            "updated_at": now_iso,
        }
        if recipient_name:
            thread_payload["recipient_name"] = recipient_name
        elif not is_self and sender_name:
            thread_payload["recipient_name"] = sender_name

        try:
            sb.table("fb_messenger_threads").upsert(
                thread_payload, on_conflict="account_id,thread_id"
            ).execute()
        except Exception as te:
            logger.warning(f"Error upserting thread in listener: {te}")

        # 3. Phát sự kiện SSE Bus về Web App (0ms Realtime)
        sse_event = {
            "type": "fb_message_new",
            "account_id": account_id,
            "thread_id": thread_id,
            "is_self": is_self,
            "is_echo": is_echo,
            "message": saved_msg,
            "timestamp": now_iso,
        }
        await messenger_event_bus.publish(sse_event)
        logger.info(
            f"Broadcasted fb_message_new for thread {thread_id} (is_self={is_self}, is_echo={is_echo})"
        )

        return saved_msg

    @classmethod
    async def start_background_sync(cls) -> None:
        """Khởi động tiến trình đồng bộ nền."""
        if cls._running:
            return
        cls._running = True
        logger.info("Facebook Messenger Realtime Listener started.")

    @classmethod
    async def stop_background_sync(cls) -> None:
        """Dừng tiến trình đồng bộ nền."""
        cls._running = False
        if cls._sync_task:
            cls._sync_task.cancel()
            cls._sync_task = None
        logger.info("Facebook Messenger Realtime Listener stopped.")
