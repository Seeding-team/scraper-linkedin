"""Zalo tập trung (port ZALO_CENTRALIZED_MODULE_GUIDE.md) — Mục 4.7 / 8(l) / 11.10:
Web Push cho tin nhắn Zalo mới.

Quản lý bảng ``push_subscriptions`` (đăng ký nhận push của từng ``app_users``) và
``zalo_push_cursor`` (watermark cho worker `push_notifier.py`), cộng RBAC "ai được
push khi account_id có tin nhắn mới" — dùng lại đúng các bảng/khái niệm RBAC đã có
của module Zalo tập trung (``zalo_accounts``, ``zalo_account_assignments``), không
tạo cơ chế phân quyền riêng.

Tái sử dụng các helper REST thô (`_rest`, `_headers`, `_base_url`, `_http_client`)
và các hàm đã có (`get_zalo_account_by_id`, `list_account_assignments`,
`is_supabase_configured`) từ `supabase_service.py` — KHÔNG viết lại logic gọi
PostgREST ở đây, theo đúng quy ước hiện có của module Zalo.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger
from pywebpush import WebPushException, webpush

from app.modules.all_platform.zalo.config import settings
from app.modules.all_platform.zalo.services.supabase_service import (
    _rest,
    get_zalo_account_by_id,
    is_supabase_configured,
    list_account_assignments,
)

# Role được coi là "admin-equivalent" (xem mọi account, không cần share/assignment)
# — khớp đúng tập role đang dùng ở supabase_inbox_share_service.py (`is_admin =
# role in ["admin", "superadmin"]`) và conversations.py (`["admin", "superadmin",
# "leader"]`). KHÔNG gồm "leader": quyền xem của leader bị giới hạn theo
# zalo_conversation_permissions (share theo conversation cụ thể), khác hẳn phạm vi
# "mọi account" — ngoài phạm vi web push (tin nhắn mới toàn account) của việc này.
_ADMIN_EQUIVALENT_ROLES = ("admin", "superadmin")


def _is_valid_uuid(value: Optional[str]) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


async def save_subscription(
    app_user_id: str,
    endpoint: str,
    p256dh: str,
    auth_key: str,
    user_agent: Optional[str] = None,
) -> None:
    """Upsert 1 push subscription theo cặp (app_user_id, endpoint)."""
    await _rest(
        "POST",
        "push_subscriptions",
        json=[
            {
                "app_user_id": app_user_id,
                "endpoint": endpoint,
                "p256dh": p256dh,
                "auth": auth_key,
                "user_agent": user_agent,
            }
        ],
        params={"on_conflict": "app_user_id,endpoint"},
        prefer="resolution=merge-duplicates",
    )


async def delete_subscription(app_user_id: str, endpoint: str) -> None:
    """Xoá 1 push subscription (user tự tắt thông báo, hoặc endpoint đã hết hạn)."""
    if not is_supabase_configured():
        return
    await _rest(
        "DELETE",
        "push_subscriptions",
        params={
            "app_user_id": f"eq.{app_user_id}",
            "endpoint": f"eq.{endpoint}",
        },
    )


async def list_subscriptions_for_account(account_id: str) -> List[Dict[str, Any]]:
    """Trả về các push_subscriptions của mọi app_user được phép xem account_id.

    Union theo đúng RBAC đã có của module Zalo tập trung:
      (a) Chủ tài khoản — dùng ``zalo_accounts.id_member`` (UUID, FK thật tới
          app_users.id — xem sql/backup.sql). CỐ Ý không ưu tiên ``owner_id``:
          cột này là TEXT tự do, mặc định `'default'` cho các account cũ
          (không có FK), y hệt cách `accounts.py::_resolve_accounts_for_role`
          và `list_zalo_accounts()` đã coi id_member là owner thật, owner_id chỉ
          là fallback hiển thị. owner_id vẫn được cộng thêm NẾU tình cờ là 1
          UUID hợp lệ, để không bỏ sót account cũ lỡ set owner_id = user id.
      (b) Mọi app_users có role admin-equivalent (xem _ADMIN_EQUIVALENT_ROLES).
      (c) app_users có zalo_account_assignments.can_view=true cho account này.
      (d) Nếu zalo_accounts.is_shared_with_all=true → TẤT CẢ app_users đang active
          (tài khoản dùng chung toàn công ty — bỏ qua owner/assignment ở trên).
    """
    if not is_supabase_configured():
        return []

    account = await get_zalo_account_by_id(account_id)
    if not account:
        return []

    user_ids: set[str] = set()

    if bool(account.get("is_shared_with_all")):
        rows = (
            await _rest(
                "GET",
                "app_users",
                params={"select": "id", "is_active": "eq.true"},
            )
            or []
        )
        user_ids.update(str(row["id"]) for row in rows if isinstance(row, dict) and row.get("id"))
    else:
        id_member = str(account.get("id_member") or "").strip()
        if _is_valid_uuid(id_member):
            user_ids.add(id_member)
        owner_id = str(account.get("owner_id") or "").strip()
        if _is_valid_uuid(owner_id):
            user_ids.add(owner_id)

        admin_rows = (
            await _rest(
                "GET",
                "app_users",
                params={
                    "select": "id",
                    "role": f"in.({','.join(_ADMIN_EQUIVALENT_ROLES)})",
                    "is_active": "eq.true",
                },
            )
            or []
        )
        user_ids.update(str(row["id"]) for row in admin_rows if isinstance(row, dict) and row.get("id"))

        assignments = await list_account_assignments(account_id)
        user_ids.update(
            str(row["app_user_id"])
            for row in assignments
            if isinstance(row, dict) and row.get("can_view") and row.get("app_user_id")
        )

    if not user_ids:
        return []

    ids_param = ",".join(sorted(user_ids))
    return (
        await _rest(
            "GET",
            "push_subscriptions",
            params={"select": "*", "app_user_id": f"in.({ids_param})"},
        )
        or []
    )


async def read_push_cursor(account_id: str) -> int:
    if not is_supabase_configured():
        return 0
    rows = (
        await _rest(
            "GET",
            "zalo_push_cursor",
            params={
                "select": "last_message_ts",
                "account_id": f"eq.{account_id}",
                "limit": "1",
            },
        )
        or []
    )
    if rows and isinstance(rows[0], dict):
        try:
            return int(rows[0].get("last_message_ts") or 0)
        except (TypeError, ValueError):
            return 0
    return 0


async def write_push_cursor(account_id: str, last_message_ts: int) -> None:
    if not is_supabase_configured():
        return
    await _rest(
        "POST",
        "zalo_push_cursor",
        json=[
            {
                "account_id": account_id,
                "last_message_ts": int(last_message_ts),
                "updated_at": datetime.utcnow().isoformat(),
            }
        ],
        params={"on_conflict": "account_id"},
        prefer="resolution=merge-duplicates",
    )


async def send_push_to_subscription(subscription: Dict[str, Any], payload: Dict[str, Any]) -> bool:
    """Gửi 1 web push. Trả False (không raise) nếu gửi thất bại — caller (push_notifier)
    không nên để 1 subscription lỗi làm hỏng cả batch."""
    endpoint = subscription.get("endpoint")
    if not settings.vapid_private_key or not endpoint:
        logger.warning("VAPID_PRIVATE_KEY chưa cấu hình hoặc thiếu endpoint — bỏ qua gửi push.")
        return False

    subscription_info = {
        "endpoint": endpoint,
        "keys": {
            "p256dh": subscription.get("p256dh"),
            "auth": subscription.get("auth"),
        },
    }

    try:
        # pywebpush.webpush() là hàm đồng bộ (dùng requests bên dưới) — chạy trong
        # thread riêng để không block event loop, giống cách main.py chạy
        # warmup_playwright_pool qua asyncio.to_thread.
        await asyncio.to_thread(
            webpush,
            subscription_info=subscription_info,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
        return True
    except WebPushException as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        if status_code in (404, 410):
            # Subscription đã hết hạn / bị trình duyệt thu hồi — dọn khỏi DB luôn,
            # tránh mỗi tick sau lại thử gửi và lỗi lặp lại vô ích.
            app_user_id = subscription.get("app_user_id")
            if app_user_id and endpoint:
                try:
                    await delete_subscription(str(app_user_id), str(endpoint))
                except Exception:
                    logger.warning("Không xoá được push_subscription hết hạn: {}", endpoint)
            return False
        logger.warning("Gửi web push thất bại (status={}): {}", status_code, exc)
        return False
    except Exception as exc:
        logger.warning("Gửi web push thất bại (lỗi khác): {}", exc)
        return False
