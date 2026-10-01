"""Tự động tạo "nhiệm vụ comment seeding" cho bài Facebook điểm AI cao (>=70), đổ vào bảng
`auto_seeding_comments` (migration 160) — KHÔNG dùng chung `scheduled_comments` vì bảng đó có
1 job server-side riêng (`scheduled_comment_job.py`) dùng Playwright + mật khẩu lưu sẵn, sẽ
tranh giành (claim pending -> processing) với luồng extension mới và thất bại do không có
`id_social_account` hợp lệ.

Luồng thực thi thật (post comment lên Facebook) nằm ở FRONTEND: hook
`useAutoSeedingCommentRuntime` (use-seeding-extension.ts) poll bảng này mỗi ~10s, gọi thẳng
Markee Seeding Extension (giống "Làm nhiệm vụ" thủ công) — chỉ cần tab Seeding còn mở là chạy,
không cần người bấm gì.
"""

from __future__ import annotations

from typing import Any, Optional

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

# Mau cau COMMENT ON DINH theo tung nhu cau (yeu cau 2026-10-02: "van mau on dinh va hay,
# du thong tin lien he, nhan manh Markee AI, dung nhu cau bai viet can"). Dung template co
# dinh (khong de LLM tu sang tac noi dung cong khai) de dam bao chat luong/an toan on dinh.
_TEMPLATES: dict[str, str] = {
    "website": (
        "Chào bạn, bên mình là Markee AI — chuyên thiết kế website theo đúng nhu cầu "
        "(giao diện riêng, chuẩn SEO, tích hợp AI chăm sóc khách tự động). Bạn để lại số "
        "điện thoại hoặc ghé markee.vn để được tư vấn báo giá nhanh nhé! 🚀"
    ),
    "app": (
        "Chào bạn, Markee AI chuyên phát triển app di động (iOS/Android) theo yêu cầu, có "
        "tích hợp AI tự động hoá vận hành. Bạn ghé markee.vn hoặc để lại thông tin liên hệ "
        "để được tư vấn chi tiết nhé! 📱"
    ),
    "landing_page": (
        "Chào bạn, Markee AI chuyên thiết kế landing page tối ưu chuyển đổi, tích hợp AI "
        "chăm sóc khách hàng tự động 24/7. Ghé markee.vn hoặc để lại thông tin để được tư "
        "vấn báo giá nhanh nhé! 🎯"
    ),
    "software": (
        "Chào bạn, Markee AI chuyên phát triển phần mềm/outsource theo yêu cầu, tích hợp AI "
        "tự động hoá quy trình vận hành. Bạn ghé markee.vn hoặc để lại thông tin liên hệ để "
        "được tư vấn chi tiết nhé! 💻"
    ),
    "other": (
        "Chào bạn, Markee AI chuyên tư vấn & triển khai giải pháp website/app/phần mềm theo "
        "đúng nhu cầu, có tích hợp AI tự động hoá. Bạn ghé markee.vn hoặc để lại thông tin "
        "liên hệ để được tư vấn nhanh nhé! ✨"
    ),
}


def _build_comment(need_category: Optional[str]) -> str:
    return _TEMPLATES.get(need_category or "other", _TEMPLATES["other"])


async def maybe_create_auto_seeding_comment(
    *,
    id_post_fb: str,
    post_url: str,
    group_name: Optional[str],
    id_member: Optional[str],
    content: str,
    lead_score: int,
    need_category: Optional[str],
) -> None:
    """Tạo 1 dòng auto_seeding_comments (pending) cho bài điểm cao — bỏ qua êm nếu thiếu dữ
    liệu bắt buộc hoặc đã tồn tại (UNIQUE id_post_fb). KHÔNG raise — gọi từ lead_score_service
    trong luồng nền, lỗi ở đây không được làm hỏng việc chấm điểm/lưu bài."""
    if not id_post_fb or not post_url:
        return
    try:
        supabase = get_supabase_client()
        comment_content = _build_comment(need_category)
        await _insert(
            supabase,
            {
                "id_post_fb": id_post_fb,
                "post_url": post_url,
                "group_name": group_name,
                "id_member": id_member,
                "comment_content": comment_content,
                "lead_score": lead_score,
                "need_category": need_category,
                "status": "pending",
            },
        )
        logger.info(f"auto_seeding_comment: đã tạo nhiệm vụ comment cho bài {id_post_fb} (điểm {lead_score}, {need_category})")
    except Exception as exc:
        # UNIQUE(id_post_fb) vi phạm nghĩa là đã có nhiệm vụ cho bài này rồi - bỏ qua êm.
        logger.info(f"auto_seeding_comment: bỏ qua bài {id_post_fb} ({exc})")


async def _insert(supabase, record: dict[str, Any]) -> None:
    import asyncio

    await asyncio.to_thread(lambda: supabase.table("auto_seeding_comments").insert(record).execute())


def list_pending(limit: int = 50) -> list[dict]:
    supabase = get_supabase_client()
    res = (
        supabase.table("auto_seeding_comments")
        .select("*")
        .eq("status", "pending")
        .order("created_at")
        .limit(limit)
        .execute()
    )
    return res.data or []


def mark_posted(comment_id: str, link_comment: str = "") -> dict:
    supabase = get_supabase_client()
    res = (
        supabase.table("auto_seeding_comments")
        .update({"status": "posted", "posted_at": "now()", "link_comment": link_comment})
        .eq("id", comment_id)
        .execute()
    )
    return res.data[0] if res.data else {}


def mark_failed(comment_id: str, error_message: str = "") -> dict:
    supabase = get_supabase_client()
    res = (
        supabase.table("auto_seeding_comments")
        .update({"status": "failed", "error_message": error_message[:500]})
        .eq("id", comment_id)
        .execute()
    )
    return res.data[0] if res.data else {}
