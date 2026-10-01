"""Event bus trong-process cho SSE realtime (giống hệt tinh thần
``zalo/services/message_events.py`` nhưng gọn hơn — RBAC "được xem account nào" đã lọc
XONG ở lúc subscribe (theo account_id) nên không cần lọc lại theo từng conversation/share
như Zalo (Telegram module này không có tính năng "share 1 hội thoại cụ thể")."""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator, Dict, List

_subscribers: Dict[str, List["asyncio.Queue[str]"]] = {}
_HEARTBEAT_SECONDS = 20
_QUEUE_MAXSIZE = 200


def _format_event(event_name: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def publish_telegram_event(account_id: str, payload: Dict[str, Any]) -> int:
    """Đẩy 1 event tới mọi SSE client đang subscribe account_id này. Trả về số client
    nhận được (0 nghĩa là không ai đang mở tab lúc này — vẫn OK, dữ liệu đã lưu DB rồi)."""
    queues = _subscribers.get(account_id, [])
    if not queues:
        return 0
    data = _format_event("telegram-message", {**payload, "account_id": account_id})
    delivered = 0
    for q in list(queues):
        try:
            q.put_nowait(data)
            delivered += 1
        except asyncio.QueueFull:
            pass
    return delivered


async def subscribe_telegram_events(account_ids: List[str]) -> AsyncGenerator[str, None]:
    """Async generator SSE — caller (route) chịu trách nhiệm chỉ truyền vào những
    account_id mà người gọi THẬT SỰ được quyền xem (đã lọc RBAC trước khi gọi hàm này)."""
    q: "asyncio.Queue[str]" = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
    for aid in account_ids:
        _subscribers.setdefault(aid, []).append(q)
    try:
        yield _format_event("ready", {"account_ids": account_ids})
        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=_HEARTBEAT_SECONDS)
                yield item
            except asyncio.TimeoutError:
                yield _format_event("heartbeat", {})
    finally:
        for aid in account_ids:
            lst = _subscribers.get(aid)
            if lst and q in lst:
                lst.remove(q)
                if not lst:
                    _subscribers.pop(aid, None)
