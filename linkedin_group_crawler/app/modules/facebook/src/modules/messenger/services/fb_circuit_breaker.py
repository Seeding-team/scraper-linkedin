"""Facebook Messenger Circuit Breaker & Safety Shield.

Quản lý hạn mức Warm-up theo ngày, giãn cách cooldown, và tự động đóng băng tài khoản khi gặp mã lỗi nguy hiểm từ Meta.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Tuple, Dict, Any, Optional

from app.modules.facebook.src.modules.messenger.constants import (
    FB_ERROR_TEMPORARILY_BLOCKED,
    FB_ERROR_CHECKPOINT,
    FB_ERROR_SESSION_EXPIRED,
    WARM_UP_TIERS,
    CIRCUIT_BREAKER_FREEZE_HOURS,
)

logger = logging.getLogger("fb_messenger.circuit_breaker")


class FbCircuitBreaker:
    """Cầu chì an toàn bảo vệ tài khoản Facebook Messenger."""

    @staticmethod
    def can_send_message(
        sb: Any, account_id: str, is_reply: bool = False
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """Kiểm tra điều kiện an toàn trước khi cho phép gửi tin nhắn.

        is_reply=True (người kia đã nhắn trong hội thoại): bỏ hạn mức ngày + giãn cách,
        chỉ giữ chặn khi nick bị đóng băng/checkpoint. Hạn mức chỉ dành cho nhắn người lạ.

        Returns:
            (is_allowed, reason_if_blocked, account_data)
        """
        now = datetime.now(timezone.utc)

        # 1. Lấy thông tin tài khoản
        try:
            res = sb.table("fb_messenger_accounts").select("*").eq("id", account_id).limit(1).execute()
        except Exception as e:
            return False, f"Lỗi truy vấn tài khoản: {e}", None

        if not res.data:
            return False, "Không tìm thấy tài khoản Messenger chỉ định.", None

        account = res.data[0]

        if not account.get("is_active"):
            return False, "Tài khoản Messenger này đang bị vô hiệu hóa.", account

        status = account.get("status", "connected")
        frozen_until_str = account.get("frozen_until")

        # 2. Xử lý trạng thái Đóng băng (Frozen)
        if status == "frozen":
            if frozen_until_str:
                frozen_until = datetime.fromisoformat(frozen_until_str.replace("Z", "+00:00"))
                if now < frozen_until:
                    diff_h = round((frozen_until - now).total_seconds() / 3600, 1)
                    return (
                        False,
                        f"Tài khoản đang bị đóng băng bảo vệ chống khóa nick (còn lại {diff_h} giờ). Lý do: {account.get('checkpoint_reason')}",
                        account,
                    )
                else:
                    # Đã hết thời gian đóng băng -> Tự động rã đông an toàn
                    logger.info(f"Account {account_id} freeze period expired. Auto-unfreezing.")
                    sb.table("fb_messenger_accounts").update({
                        "status": "connected",
                        "frozen_until": None,
                        "checkpoint_reason": "Tự động rã đông sau thời gian an toàn 24h",
                        "updated_at": now.isoformat(),
                    }).eq("id", account_id).execute()
                    status = "connected"
            else:
                return False, "Tài khoản đang bị đóng băng an toàn.", account

        # 3. Xử lý trạng thái Checkpoint / Hết hạn
        if status == "checkpoint":
            return (
                False,
                f"Tài khoản đang bị Meta yêu cầu xác minh (Checkpoint): {account.get('checkpoint_reason', 'Vui lòng mở Facebook xác thực')}",
                account,
            )
        if status == "expired":
            return False, "Cookie tài khoản đã hết hạn. Vui lòng cập nhật Cookie mới.", account

        if is_reply:
            return True, "", account

        # 4. Kiểm tra Hạn mức gửi tin trong ngày (Daily Quota)
        tier = account.get("warm_up_tier", 1)
        tier_cfg = WARM_UP_TIERS.get(tier, WARM_UP_TIERS[1])
        daily_limit = account.get("daily_sent_limit") or tier_cfg["daily_limit"]
        daily_sent = account.get("daily_sent_count", 0)

        # Kiểm tra nếu sang ngày mới (UTC+7) thì reset count
        last_sent_str = account.get("last_sent_at")
        if last_sent_str:
            last_sent = datetime.fromisoformat(last_sent_str.replace("Z", "+00:00"))
            # Nếu tin cuối là ngày hôm trước -> Reset count về 0
            if (now.date() - last_sent.date()).days >= 1:
                daily_sent = 0
                sb.table("fb_messenger_accounts").update({
                    "daily_sent_count": 0,
                    "updated_at": now.isoformat(),
                }).eq("id", account_id).execute()

        if daily_sent >= daily_limit:
            return (
                False,
                f"Tài khoản đã đạt hạn mức an toàn trong ngày ({daily_sent}/{daily_limit} tin nhắn) để chống quét spam. Hạn mức sẽ tự động đặt lại vào ngày mai.",
                account,
            )

        # 5. Kiểm tra Giãn cách an toàn (Cooldown interval)
        if last_sent_str:
            last_sent = datetime.fromisoformat(last_sent_str.replace("Z", "+00:00"))
            min_interval = tier_cfg["min_interval_seconds"]
            elapsed = (now - last_sent).total_seconds()
            if elapsed < min_interval:
                wait_sec = int(min_interval - elapsed)
                return (
                    False,
                    f"Giãn cách nhịp sinh học: Vui lòng đợi {wait_sec} giây trước khi gửi tin nhắn tiếp theo từ nick này.",
                    account,
                )

        return True, "", account

    @staticmethod
    def record_send_success(sb: Any, account_id: str) -> None:
        """Cập nhật bộ đếm thành công sau khi gửi tin."""
        now = datetime.now(timezone.utc).isoformat()
        try:
            # Tăng count và cập nhật last_sent_at
            sb.rpc("increment_fb_messenger_sent_count", {"p_account_id": account_id}).execute()
        except Exception:
            # Fallback nếu RPC chưa tồn tại
            res = sb.table("fb_messenger_accounts").select("daily_sent_count").eq("id", account_id).limit(1).execute()
            count = (res.data[0].get("daily_sent_count") or 0) + 1 if res.data else 1
            sb.table("fb_messenger_accounts").update({
                "daily_sent_count": count,
                "last_sent_at": now,
                "updated_at": now,
            }).eq("id", account_id).execute()

    @staticmethod
    def trigger_circuit_breaker(
        sb: Any, account_id: str, error_code: Optional[int], error_message: str
    ) -> None:
        """Kích hoạt cầu chì bảo vệ tài khoản khi phát hiện cảnh báo từ Meta."""
        now = datetime.now(timezone.utc)
        logger.warning(
            f"CIRCUIT BREAKER TRIGGERED for account {account_id}! Error: {error_code} - {error_message}"
        )

        update_payload: Dict[str, Any] = {
            "checkpoint_reason": f"[{error_code}] {error_message}"[:500],
            "updated_at": now.isoformat(),
        }

        if error_code in (FB_ERROR_TEMPORARILY_BLOCKED, FB_ERROR_RATE_LIMIT, 368):
            # Đóng băng 24 giờ
            freeze_until = now + timedelta(hours=CIRCUIT_BREAKER_FREEZE_HOURS)
            update_payload["status"] = "frozen"
            update_payload["frozen_until"] = freeze_until.isoformat()
            logger.error(f"Account {account_id} FROZEN until {freeze_until.isoformat()} (24h safety lock)")

        elif error_code in (FB_ERROR_CHECKPOINT, 405):
            update_payload["status"] = "checkpoint"
            logger.error(f"Account {account_id} MARKED AS CHECKPOINT!")

        elif error_code in (FB_ERROR_SESSION_EXPIRED, 190):
            update_payload["status"] = "expired"
            logger.warning(f"Account {account_id} MARKED AS EXPIRED!")

        try:
            sb.table("fb_messenger_accounts").update(update_payload).eq("id", account_id).execute()
        except Exception as e:
            logger.exception(f"Failed to update circuit breaker status in DB: {e}")
