"""Push notifier — tick loop gửi Web Push khi có tin nhắn Zalo mới (Mục 4.7 guide
`pushNotifier.js`, port sang 1 asyncio background task — xem Kiến trúc quy đổi
trong plan). Gọi định kỳ từ `main.py` lifespan (`PUSH_POLL_INTERVAL_MS`, mặc
định 4000ms).

CRUD/gửi thật nằm ở `push_service.py` — module này chỉ đọc `zalo_messages` mới
hơn watermark `zalo_push_cursor` cho từng account, rồi fan-out tới mọi subscriber
được phép xem account đó.
"""

from __future__ import annotations

import os
from typing import Any, Dict

from loguru import logger

from app.modules.all_platform.zalo.services.supabase_service import _rest
from app.modules.all_platform.zalo.services import push_service

PUSH_MESSAGES_PER_TICK = int(os.getenv("PUSH_MESSAGES_PER_TICK", "50"))

# Bỏ qua thông báo hệ thống (kết bạn/vote...) — chỉ push tin nhắn thật.
_SKIP_MSG_KINDS = {"system_notice"}


async def _get_account_ids_with_subscribers() -> list[str]:
    rows = await _rest("GET", "zalo_accounts", params={"select": "account_id", "is_active": "eq.true"}) or []
    return [r["account_id"] for r in rows if r.get("account_id")]


async def _tick_account(account_id: str) -> None:
    cursor = await push_service.read_push_cursor(account_id)
    rows = await _rest(
        "GET", "zalo_messages",
        params={
            "select": "*", "user_id": f"eq.{account_id}", "ts": f"gt.{cursor}",
            "is_sent": "eq.false",  # chỉ push tin ĐẾN (không tự push lại tin mình vừa gửi)
            "order": "ts.asc", "limit": str(PUSH_MESSAGES_PER_TICK),
        },
    ) or []
    if not rows:
        return

    subscriptions = await push_service.list_subscriptions_for_account(account_id)
    max_ts = cursor
    for row in rows:
        row_ts = int(row.get("ts") or 0)
        if row_ts <= 0:
            continue
        if (row.get("msg_kind") or "") in _SKIP_MSG_KINDS:
            max_ts = max(max_ts, row_ts)
            continue

        payload: Dict[str, Any] = {
            "title": row.get("sender_name") or "Zalo",
            "body": (row.get("content") or "").strip()[:150] or "Đã gửi 1 hình ảnh/tệp",
            "account_id": account_id,
            "conversation_id": row.get("group_id"),
            "url": f"/all-platform/zalo-inbox?account={account_id}&conversation={row.get('group_id')}",
        }
        for sub in subscriptions:
            try:
                await push_service.send_push_to_subscription(sub, payload)
            except Exception:
                logger.exception(f"[push] send failed account={account_id} sub={sub.get('id')}")
        max_ts = max(max_ts, row_ts)

    if max_ts > cursor:
        await push_service.write_push_cursor(account_id, max_ts)


async def run_push_tick() -> None:
    """1 tick toàn cục — gọi định kỳ từ main.py lifespan."""
    try:
        account_ids = await _get_account_ids_with_subscribers()
    except Exception:
        logger.exception("[push] failed to load account ids")
        return
    for account_id in account_ids:
        try:
            await _tick_account(account_id)
        except Exception:
            logger.exception(f"[push] tick failed for account={account_id}")
