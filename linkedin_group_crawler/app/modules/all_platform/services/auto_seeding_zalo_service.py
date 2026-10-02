"""Tự động nhắn tin Zalo tư vấn cho bài Facebook điểm cao có nêu rõ số điện thoại liên hệ
(yêu cầu 2026-10-02) — dùng tài khoản Zalo "Markee" đã đăng nhập sẵn qua extension
(`zalo_accounts.account_id`, xem [[zalo-markee-account-for-auto-seeding]]), auth lưu tại ổ
đĩa (zca_auth_store) nên gọi được THẲNG TỪ BACKEND, không cần trình duyệt/extension nào
đang mở — khác hẳn luồng auto-comment Facebook (bắt buộc qua extension vì FB không có API
server-side).

Trigger: lead_score_service.score_and_save_posts, ngay sau khi tạo auto_seeding_comments
(chỉ facebook_posts, điểm >=70, và LLM có trích được contact_phone từ nội dung bài).
"""

from __future__ import annotations

from typing import Any, Optional

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.zalo.services.zca_api_bridge import (
    ZcaAuthExpiredError,
    find_zca_user_by_phone,
    send_zca_message,
)
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth

logger = get_logger(__name__)

# Tai khoan Zalo "Markee" dung chung de tu van khach (zalo_accounts.account_id, label
# "Markee", is_shared_with_all=true, status=confirmed luc viet code 2026-10-02). Neu phien
# het han / doi sang tai khoan khac, cap nhat hang so nay (giong SEEDING_SYSTEM_MEMBER_ID /
# SEEDING_SYSTEM_ACCOUNT_EMAIL - xem [[seeding-system-account]]).
_ZALO_SENDER_ACCOUNT_ID = "zl_d8b95576"

_ZALO_TEMPLATES: dict[str, str] = {
    "website": (
        "Chào bạn, mình bên Markee AI thấy bạn đang cần làm website. Bên mình chuyên thiết "
        "kế website theo đúng nhu cầu, giá tốt, uy tín, có tích hợp AI chăm sóc khách tự "
        "động. Bạn cho mình xin ít thông tin (loại website, ngân sách dự kiến) để tư vấn "
        "báo giá nhanh gọn nhé! Tham khảo thêm tại markee.vn 🚀"
    ),
    "app": (
        "Chào bạn, mình bên Markee AI thấy bạn đang cần làm app. Bên mình chuyên phát triển "
        "app di động (iOS/Android) theo đúng yêu cầu, giá tốt, uy tín, tích hợp AI tự động "
        "hoá vận hành. Bạn cho mình xin ít thông tin nhu cầu để tư vấn nhanh gọn nhé! Tham "
        "khảo thêm tại markee.vn 📱"
    ),
    "landing_page": (
        "Chào bạn, mình bên Markee AI thấy bạn đang cần làm landing page. Bên mình chuyên "
        "thiết kế landing page tối ưu chuyển đổi, giá tốt, uy tín, tích hợp AI chăm sóc "
        "khách tự động 24/7. Bạn cho mình xin ít thông tin để tư vấn báo giá nhanh gọn "
        "nhé! Tham khảo thêm tại markee.vn 🎯"
    ),
    "software": (
        "Chào bạn, mình bên Markee AI thấy bạn đang cần làm phần mềm. Bên mình chuyên phát "
        "triển phần mềm/outsource theo đúng yêu cầu, giá tốt, uy tín, tích hợp AI tự động "
        "hoá quy trình vận hành. Bạn cho mình xin ít thông tin để tư vấn nhanh gọn nhé! "
        "Tham khảo thêm tại markee.vn 💻"
    ),
    "other": (
        "Chào bạn, mình bên Markee AI thấy bạn đang có nhu cầu làm website/app/phần mềm. "
        "Bên mình tư vấn & triển khai theo đúng nhu cầu, giá tốt, uy tín, có tích hợp AI tự "
        "động hoá. Bạn cho mình xin ít thông tin để tư vấn nhanh gọn nhé! Tham khảo thêm "
        "tại markee.vn ✨"
    ),
}


def _build_message(need_category: Optional[str]) -> str:
    return _ZALO_TEMPLATES.get(need_category or "other", _ZALO_TEMPLATES["other"])


async def _update(comment_id: str, fields: dict[str, Any]) -> None:
    import asyncio

    try:
        supabase = get_supabase_client()
        await asyncio.to_thread(
            lambda: supabase.table("auto_seeding_comments").update(fields).eq("id", comment_id).execute()
        )
    except Exception as exc:
        logger.warning(f"auto_seeding_zalo: không ghi được trạng thái cho {comment_id}: {exc}")


async def maybe_send_zalo_consult(
    *,
    comment_id: str,
    contact_phone: Optional[str],
    need_category: Optional[str],
) -> None:
    """Tìm user Zalo theo SĐT (đã chuẩn hoá E.164 từ trước) rồi nhắn tin tư vấn 1 lần.
    KHÔNG raise — lỗi ở đây chỉ ghi `zalo_status=failed` + `zalo_error`, không ảnh hưởng tới
    việc chấm điểm/lưu bài/tạo nhiệm vụ comment FB đã xong trước đó."""
    if not contact_phone:
        return

    auth = await load_zca_auth(_ZALO_SENDER_ACCOUNT_ID)
    if not auth:
        logger.warning("auto_seeding_zalo: chưa có phiên Zalo hợp lệ cho tài khoản Markee — bỏ qua.")
        await _update(comment_id, {"zalo_status": "failed", "zalo_error": "Chưa có phiên Zalo hợp lệ (tài khoản Markee)."})
        return

    try:
        user = await find_zca_user_by_phone(auth, contact_phone)
        uid = str((user or {}).get("userId") or "")
        if not uid:
            await _update(comment_id, {"zalo_status": "failed", "zalo_error": "Không tìm thấy user Zalo với SĐT này."})
            return

        message = _build_message(need_category)
        await send_zca_message(auth, uid, message, thread_type=0)

        # Upsert hội thoại để team thấy trong UI Zalo chat, theo dõi tiếp nếu khách trả lời
        # (best-effort — lỗi ở đây không coi là gửi thất bại, tin đã gửi thành công rồi).
        try:
            from app.modules.all_platform.zalo.services.supabase_service import upsert_group

            display_name = (user or {}).get("displayName") or (user or {}).get("zaloName") or uid
            await upsert_group(
                user_id=_ZALO_SENDER_ACCOUNT_ID,
                group_id=uid,
                group_name=display_name,
                avatar_url=(user or {}).get("avatar") or (user or {}).get("avatarUrl"),
            )
        except Exception as exc:
            logger.info(f"auto_seeding_zalo: upsert hội thoại thất bại (bỏ qua, tin đã gửi): {exc}")

        await _update(
            comment_id,
            {
                "zalo_status": "sent",
                "zalo_message_content": message,
                "zalo_conversation_id": uid,
                "zalo_sent_at": "now()",
            },
        )
        logger.info(f"auto_seeding_zalo: đã nhắn tin tư vấn Zalo cho SĐT {contact_phone} (comment={comment_id})")
    except ZcaAuthExpiredError:
        await _update(comment_id, {"zalo_status": "failed", "zalo_error": "Phiên Zalo (tài khoản Markee) đã hết hạn."})
    except Exception as exc:
        err = str(exc)[:500]
        logger.warning(f"auto_seeding_zalo: gửi thất bại cho SĐT {contact_phone}: {exc}")
        await _update(comment_id, {"zalo_status": "failed", "zalo_error": err})
