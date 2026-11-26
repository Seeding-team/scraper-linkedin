"""In-process SSE pub/sub event bus for WhatsApp Chat & Call realtime streaming.

Mirrors ``telegram/services/message_events.py`` with two enhancements:
1. Emits typed SSE event frames (``account_status``, ``message``, ``message_update``,
   ``conversation_update``, ``presence``, ``call_event``) so browser ``EventSource``
   listeners can subscribe cleanly by event type.
2. Supports optional member/admin-scope subscriptions so a freshly connected account
   immediately delivers QR/pairing/status events on an already-open SSE stream without
   requiring the frontend to reconnect first.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Set

_HEARTBEAT_SECONDS = 20
_QUEUE_MAXSIZE = 250

VALID_SSE_EVENTS = frozenset({
    "account_status",
    "message",
    "message_update",
    "conversation_update",
    "presence",
    "call_event",
    "call_answer_sdp",
})


@dataclass
class _Subscriber:
    queue: "asyncio.Queue[str]"
    account_ids: Set[str] = field(default_factory=set)
    member_ids: Optional[Set[str]] = None  # None = admin (all accounts)
    explicit_account_filter: Optional[str] = None


_subscribers: List[_Subscriber] = []


def _format_event(event_name: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def _matches_subscriber(
    sub: _Subscriber,
    account_id: str,
    id_member: Optional[str],
) -> bool:
    if sub.explicit_account_filter:
        return account_id == sub.explicit_account_filter
    if account_id in sub.account_ids:
        return True
    if sub.member_ids is None:
        return True
    if id_member and id_member in sub.member_ids:
        # Dynamically attach newly created account to this subscriber's scope
        sub.account_ids.add(account_id)
        return True
    return False


async def publish_whatsapp_event(
    account_id: str,
    event_name: str,
    payload: Dict[str, Any],
    *,
    id_member: Optional[str] = None,
) -> int:
    """Publish a realtime SSE event to every authorized client listening to ``account_id``."""
    if not _subscribers:
        return 0
    evt = event_name if event_name in VALID_SSE_EVENTS else "message"
    envelope = {**payload, "type": evt, "account_id": account_id}
    frame = _format_event(evt, envelope)
    delivered = 0
    for sub in list(_subscribers):
        if not _matches_subscriber(sub, account_id, id_member):
            continue
        try:
            sub.queue.put_nowait(frame)
            delivered += 1
        except asyncio.QueueFull:
            # Drop oldest frame so live updates (e.g. call_event / qr) are never starved
            try:
                sub.queue.get_nowait()
                sub.queue.put_nowait(frame)
                delivered += 1
            except Exception:
                pass
    return delivered


async def subscribe_whatsapp_events(
    account_ids: Iterable[str],
    *,
    member_ids: Optional[Iterable[str]] = None,
    explicit_account_filter: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Yield SSE frames for authorized WhatsApp accounts with 20s heartbeat keepalive."""
    account_set = {str(a) for a in account_ids if a}
    member_set = None if member_ids is None else {str(m) for m in member_ids if m}
    sub = _Subscriber(
        queue=asyncio.Queue(maxsize=_QUEUE_MAXSIZE),
        account_ids=account_set,
        member_ids=member_set,
        explicit_account_filter=explicit_account_filter,
    )
    _subscribers.append(sub)
    try:
        yield _format_event(
            "ready",
            {"account_ids": sorted(account_set)},
        )
        while True:
            try:
                item = await asyncio.wait_for(sub.queue.get(), timeout=_HEARTBEAT_SECONDS)
                yield item
            except asyncio.TimeoutError:
                yield _format_event("heartbeat", {})
    finally:
        if sub in _subscribers:
            _subscribers.remove(sub)


def active_subscriber_count() -> int:
    """Return active SSE subscriber count (useful for diagnostics and tests)."""
    return len(_subscribers)
