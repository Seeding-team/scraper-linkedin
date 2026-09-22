"""Đồng bộ like/comment/share cho bài Threads trong Internal Engagement.

Khác với LinkedIn (đã có sẵn cả 1 hệ thống crawl account — bảng
linkedin_account_crawl, session/login Playwright riêng, xem
internal_engagement_linkedin_sync_service.py), Threads (threads.net) CHƯA có bất kỳ
hạ tầng đăng nhập/lưu account nào trong repo. Vì vậy đồng bộ tự động server-side
(không cần Extension) CHƯA khả thi ngay — hàm dưới đây luôn raise NoThreadsAccountError
để router trả về lỗi rõ ràng, FE tự fallback sang luồng Extension (đọc like/comment/
share qua Extension rồi gửi lên POST /custom-posts/{id}/sync bằng likes/comments/
shares — luồng này đã platform-agnostic sẵn, không cần thay đổi gì).

Khi nào có tài khoản Threads test thật + biết cách login/đọc số liệu ổn định, thay
phần raise bên dưới bằng logic Playwright thật (đăng nhập, mở link bài, đọc
like/reply/repost) theo đúng khuôn của bản LinkedIn.
"""

from __future__ import annotations

from app.core.logger import get_logger

logger = get_logger(__name__)


class NoThreadsAccountError(Exception):
    """Chưa có hạ tầng đăng nhập Threads server-side (chưa có bảng account/session
    riêng như linkedin_account_crawl) — router luôn raise lỗi này để FE fallback
    sang luồng Extension thay vì thử một luồng Playwright chưa tồn tại."""


def sync_threads_post_engagement_via_playwright(post_id: str) -> dict:
    logger.info(
        "[THREADS-SYNC-PW] post=%s: chưa có hạ tầng đăng nhập Threads server-side, "
        "yêu cầu FE fallback sang Extension.",
        post_id,
    )
    raise NoThreadsAccountError(
        "Đồng bộ tự động (không cần Extension) cho Threads chưa được hỗ trợ — chưa có "
        "hạ tầng đăng nhập Threads server-side. Vui lòng dùng Extension để cào số liệu "
        "rồi hệ thống sẽ tự gửi lên qua đồng bộ thủ công."
    )
