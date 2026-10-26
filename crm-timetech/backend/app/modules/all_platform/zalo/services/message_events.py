"""In-memory event bus for Zalo real-time message push to the frontend.

Pattern tương tự ``job_events.py``: per-account ``asyncio.Queue`` + SSE generator.
Tất cả thao tác diễn ra trong RAM, không gọi network, không truy cập DB.

Sử dụng:
    * ZCA persistent listener → ``publish_zalo_message_event(account_id, event)``
      ngay sau khi lưu DB thành công.
    * SSE endpoint ``/api/zalo/events/stream`` → ``subscribe_zalo_events(account_ids)``
      trả về một async generator stream SSE.

Phân quyền:
    * ``can_view_account(...)`` là rule tổng quát (admin/leader/staff). Mỗi caller
      tự truyền role và owner mapping vào để check trước khi subscribe.
    * Quy tắc cụ thể cho từng role xem trong ``events.py`` (SSE endpoint).
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from typing import AsyncIterator, DefaultDict, Dict, List, Optional, Set, Tuple


# Map: account_id (normalized) → list of (queue, meta) từ FE subscribers.
# Meta là dict chứa role + email để filter theo quyền xem.
# Dùng list thay vì set vì tuple chứa dict không hashable.
Subscriber = Tuple[asyncio.Queue[str], Dict[str, str]]
_subscribers: DefaultDict[str, List[Subscriber]] = defaultdict(list)

# Map: account_id (normalized) → owner app_user_id (lowercase). Cập nhật mỗi lần
# listener khởi động. Dùng để SSE endpoint check ownership nhanh (không query DB).
_account_owners: Dict[str, str] = {}

# ══════════════════════════════════════════════════════════════════════════════
# Auth-expired event bus: khi ZCA listener phát hiện auth hết hạn,
# publish event vào đây để auth SSE endpoint nhận và push ngay về FE.
#
# THIẾT KẾ PER-USER QUEUE:
#   Trước đây dùng 1 queue chung (_auth_expired_queue) → lỗi race condition:
#   Nếu SSE của user A đang poll và event của user B bị expire, user A sẽ
#   dequeue event của B, check "B == A" fail → event bị mất vĩnh viễn.
#
#   Giải pháp: mỗi user_id có 1 asyncio.Queue(maxsize=5) riêng.
#   publish_auth_expired gửi vào đúng queue của user đó.
#   wait_for_auth_expired_user(user_id) chỉ đọc queue của user đó.
# ══════════════════════════════════════════════════════════════════════════════
_AuthExpiredEvent = Tuple[str, str]  # (account_id, reason)

# Per-user queues: account_id (normalized) → asyncio.Queue
_auth_expired_queues: Dict[str, asyncio.Queue] = {}


def _get_auth_expired_queue(account_id: str) -> "asyncio.Queue[_AuthExpiredEvent]":
    """Trả về queue của account_id, tạo mới nếu chưa có."""
    account = _normalize(account_id)
    if account not in _auth_expired_queues:
        _auth_expired_queues[account] = asyncio.Queue(maxsize=5)
    return _auth_expired_queues[account]


async def publish_auth_expired(account_id: str, reason: str) -> bool:
    """Đẩy auth-expired event vào queue riêng của account_id.

    Nếu queue đã đầy (5 events chưa được consume) thì drain 1 event cũ
    và push event mới — đảm bảo event mới nhất luôn được gửi đi.
    Trả True nếu push thành công.
    """
    q = _get_auth_expired_queue(account_id)
    event: _AuthExpiredEvent = (_normalize(account_id), reason)
    try:
        q.put_nowait(event)
        return True
    except asyncio.QueueFull:
        # Drain 1 event cũ nhất rồi push event mới
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
        try:
            q.put_nowait(event)
            return True
        except asyncio.QueueFull:
            return False


async def wait_for_auth_expired_user(account_id: str, timeout: float = 60.0) -> Optional[_AuthExpiredEvent]:
    """Chờ event auth-expired chỉ cho account_id cụ thể, hoặc None nếu timeout.

    Thay thế wait_for_auth_expired() cũ (dùng queue chung).
    Mỗi SSE connection gọi hàm này với user_id của mình → không bị race với user khác.
    """
    q = _get_auth_expired_queue(account_id)
    try:
        return await asyncio.wait_for(q.get(), timeout=timeout)
    except asyncio.TimeoutError:
        return None


# Backward-compat alias: auth.py cũ gọi wait_for_auth_expired(timeout=_POLL_INTERVAL)
# nhưng không truyền user_id → không dùng được với per-user queue.
# Giữ lại để không break code cũ; auth.py cần migrate sang wait_for_auth_expired_user.
async def wait_for_auth_expired(timeout: float = 60.0) -> Optional[_AuthExpiredEvent]:
    """[DEPRECATED] Dùng wait_for_auth_expired_user(account_id, timeout) thay thế.

    Hàm này giờ luôn trả None (không đọc queue nào) để tránh consume nhầm
    event của user khác. Auth SSE endpoints phải dùng wait_for_auth_expired_user().
    """
    # Chờ timeout mà không đọc queue nào → SSE endpoint sẽ fallback sang
    # poll _build_current_status_payload() như bình thường.
    await asyncio.sleep(min(timeout, 2.0))
    return None


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

def _normalize(value: Optional[str]) -> str:
    return (value or "default").strip().lower() or "default"


def register_account_owner(account_id: str, owner_id: str) -> None:
    """Cache account_id → owner_id để filter SSE subscribers."""
    _account_owners[_normalize(account_id)] = _normalize(owner_id)


def get_account_owner(account_id: str) -> Optional[str]:
    return _account_owners.get(_normalize(account_id))


def get_known_account_ids() -> Set[str]:
    return set(_account_owners.keys())


# ----------------------------------------------------------------------------
# Permission filter
# ----------------------------------------------------------------------------

# Role hierarchy (lower = ít quyền hơn). Mở rộng nếu sau này có role mới.
_PRIVILEGED_ROLES = {"admin", "leader"}


def can_view_account(
    caller_user_id: str,
    caller_role: str,
    caller_email: Optional[str],
    account_id: str,
    *,
    is_shared: bool = False,
) -> bool:
    """Quyết định caller có quyền nhận realtime event của account_id không.

    Quy tắc:
        * ``admin`` / ``leader``           → xem mọi account có share=true.
        * ``member`` / ``staff`` / khác    → chỉ xem account mình sở hữu
                                             (kể cả khi chưa share).
        * Caller thiếu thông tin           → từ chối (fail-closed).
    """
    role = (caller_role or "").strip().lower() or "member"
    account = _normalize(account_id)
    caller = _normalize(caller_user_id)

    # Admin: xem mọi account không cần share.
    # Leader: chỉ xem account được share.
    if role == "admin":
        return True

    # Leader: xem account được share.
    if role == "leader":
        return bool(is_shared)

    # Staff/member: chỉ xem của mình, không quan tâm share.
    if not caller or caller == "default":
        return False
    return _account_owners.get(account) == caller


def can_view_conversation(
    caller_user_id: str,
    caller_role: str,
    caller_email: Optional[str],
    account_id: str,
    conversation_id: str,
    is_shared: bool,
) -> bool:
    """Wrapper cho conversation. Hiện tại share là cờ cho cả conversation;
    sau này có thể mở rộng check theo conversation_id cụ thể.
    """
    return can_view_account(
        caller_user_id,
        caller_role,
        caller_email,
        account_id,
        is_shared=is_shared,
    )


# ----------------------------------------------------------------------------
# Publish
# ----------------------------------------------------------------------------

async def publish_zalo_message_event(
    account_id: str,
    event: Dict[str, object],
    *,
    shared_conversation_ids: Optional[Set[str]] = None,
    allowed_viewer_emails: Optional[Set[str]] = None,
) -> int:
    """Đẩy event vào queue của tất cả subscribers cho account_id.

    Args:
        account_id: tài khoản Zalo (owner của conversation).
        event: dict tuỳ ý. Sẽ được serialize sang JSON string.
        shared_conversation_ids: set các conversation_id đã được share với
            admin/leader. Nếu event có ``group_id`` không thuộc set này,
            subscriber role=admin/leader sẽ KHÔNG nhận được.
        allowed_viewer_emails: set email được phép xem event này (extra filter).

    Returns:
        Số subscriber đã nhận event.
    """
    account = _normalize(account_id)
    payload = json.dumps(event, ensure_ascii=False)
    delivered = 0
    owner_id = get_account_owner(account)
    
    for queue, meta in list(_subscribers.get(account, set())):
        if not isinstance(meta, dict):
            meta = {}

        # Extra filter theo email
        if allowed_viewer_emails is not None:
            email = str(meta.get("email") or "").strip().lower()
            if email and email not in allowed_viewer_emails:
                continue

        # Filter conversation share cho leader. Admin luôn nhận mọi event.
        role = str(meta.get("role") or "member").lower()
        if role == "leader" and shared_conversation_ids is not None:
            caller_id = meta.get("caller_id")

            # Neu leader chinh la chu so huu cua account nay, thi khong bi filter boi shared_conversation_ids
            is_owner = False
            if owner_id and caller_id and owner_id == caller_id:
                is_owner = True
            elif owner_id and owner_id == _normalize(meta.get("email", "")):
                is_owner = True

            if not is_owner:
                group_id = str(event.get("group_id") or "").strip()
                if group_id and group_id not in shared_conversation_ids:
                    continue
        # Admin: always receives all events, no filtering.

        try:
            queue.put_nowait(payload)
            delivered += 1
        except asyncio.QueueFull:
            # Subscriber quá chậm — bỏ qua. FE sẽ tự poll bù.
            continue
    return delivered


# ----------------------------------------------------------------------------
# Subscribe (SSE)
# ----------------------------------------------------------------------------

def _make_subscriber_queue() -> asyncio.Queue[str]:
    return asyncio.Queue(maxsize=200)


async def subscribe_zalo_events(
    account_ids: list[str],
    *,
    role: str = "member",
    email: Optional[str] = None,
    caller_id: Optional[str] = None,
) -> AsyncIterator[str]:
    """SSE generator: subscribe nhiều account, phát event ``zalo-message`` và
    heartbeat mỗi 20 giây.

    Yield các chuỗi theo định dạng SSE::

        event: zalo-message
        data: {...json...}

        event: heartbeat
        data: {}

    Cleanup: khi generator bị huỷ (client disconnect), tự gỡ queue khỏi bus.
    """
    queues: list[tuple[str, asyncio.Queue[str], Dict[str, str]]] = []
    meta: Dict[str, str] = {
        "role": (role or "member").strip().lower(),
        "email": (email or "").strip().lower(),
    }
    if caller_id:
        meta["caller_id"] = _normalize(caller_id)
        
    for raw_id in account_ids or []:
        account = _normalize(raw_id)
        queue = _make_subscriber_queue()
        _subscribers[account].append((queue, meta))
        queues.append((account, queue, meta))

    try:
        while True:
            # Gom task chờ data từ tất cả queue.
            if not queues:
                # Không subscribe account nào — vẫn giữ kết nối sống bằng heartbeat.
                await asyncio.sleep(20)
                yield f"event: heartbeat\ndata: {{\"ts\":{int(time.time())}}}\n\n"
                continue

            pending = [asyncio.create_task(q.get(), name=f"sse-{acc}") for acc, q, _ in queues]
            done, _ = await asyncio.wait(pending, timeout=20, return_when=asyncio.FIRST_COMPLETED)

            # Cancel các task chưa xong (timeout).
            for task in pending:
                if not task.done():
                    task.cancel()

            if not done:
                yield f"event: heartbeat\ndata: {{\"ts\":{int(time.time())}}}\n\n"
                continue

            for task in done:
                try:
                    payload = task.result()
                except Exception:
                    continue
                yield f"event: zalo-message\ndata: {payload}\n\n"
    finally:
        for account, queue, _meta in queues:
            subscribers = _subscribers.get(account)
            if subscribers is None:
                continue
            try:
                subscribers.remove((queue, meta))
            except ValueError:
                pass
            if not subscribers:
                _subscribers.pop(account, None)
