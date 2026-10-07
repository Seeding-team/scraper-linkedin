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
# du thong tin lien he, nhan manh Markee AI, dung nhu cau bai viet can, tu van nhanh gon,
# nhan manh gia tot uy tin"). Dung template co dinh (khong de LLM tu sang tac noi dung cong
# khai) de dam bao chat luong/an toan on dinh.
_TEMPLATES: dict[str, str] = {
    "website": (
        "Chào bạn, bên mình là Markee AI — chuyên thiết kế website theo đúng nhu cầu, giá "
        "tốt, uy tín, đã triển khai nhiều dự án thực tế (giao diện riêng, chuẩn SEO, tích "
        "hợp AI chăm sóc khách tự động). Ghé markee.vn hoặc để lại số điện thoại để được tư "
        "vấn báo giá nhanh gọn nhé! 🚀"
    ),
    "app": (
        "Chào bạn, Markee AI chuyên phát triển app di động (iOS/Android) theo đúng yêu cầu, "
        "giá tốt, uy tín, có tích hợp AI tự động hoá vận hành. Ghé markee.vn hoặc để lại "
        "thông tin liên hệ để được tư vấn nhanh gọn nhé! 📱"
    ),
    "landing_page": (
        "Chào bạn, Markee AI chuyên thiết kế landing page tối ưu chuyển đổi, giá tốt, uy "
        "tín, tích hợp AI chăm sóc khách hàng tự động 24/7. Ghé markee.vn hoặc để lại thông "
        "tin để được tư vấn báo giá nhanh gọn nhé! 🎯"
    ),
    "software": (
        "Chào bạn, Markee AI chuyên phát triển phần mềm/outsource theo đúng yêu cầu, giá "
        "tốt, uy tín, tích hợp AI tự động hoá quy trình vận hành. Ghé markee.vn hoặc để lại "
        "thông tin liên hệ để được tư vấn nhanh gọn nhé! 💻"
    ),
    "other": (
        "Chào bạn, Markee AI chuyên tư vấn & triển khai giải pháp website/app/phần mềm theo "
        "đúng nhu cầu, giá tốt, uy tín, có tích hợp AI tự động hoá. Ghé markee.vn hoặc để "
        "lại thông tin liên hệ để được tư vấn nhanh gọn nhé! ✨"
    ),
}


def _build_comment(need_category: Optional[str]) -> str:
    return _TEMPLATES.get(need_category or "other", _TEMPLATES["other"])


async def maybe_create_auto_seeding_comment(
    *,
    post_id: str,
    post_url: str,
    group_name: Optional[str],
    id_member: Optional[str],
    content: str,
    lead_score: int,
    need_category: Optional[str],
    contact_phone: Optional[str] = None,
    platform: str = "facebook",
) -> Optional[dict[str, Any]]:
    """Tạo 1 dòng auto_seeding_comments (pending) cho bài điểm cao — bỏ qua êm nếu thiếu dữ
    liệu bắt buộc hoặc đã tồn tại (UNIQUE id_post_fb/id_post_li). KHÔNG raise — gọi từ
    lead_score_service trong luồng nền, lỗi ở đây không được làm hỏng việc chấm điểm/lưu bài.

    `platform` quyết định ghi vào cột id_post_fb hay id_post_li (migration 174 — ban đầu chỉ
    Facebook, mở rộng sang LinkedIn 2026-10-07, dùng 2 cột riêng thay vì 1 cột dùng chung để
    không đụng vào dữ liệu Facebook đang chạy thật).

    Trả về dòng VỪA TẠO (để lead_score_service biết id mà trigger nhắn Zalo tiếp, migration
    161), hoặc None nếu bỏ qua (thiếu dữ liệu / đã tồn tại từ trước - không trigger lại)."""
    if not post_id or not post_url:
        return None
    id_column = "id_post_li" if platform == "linkedin" else "id_post_fb"
    try:
        supabase = get_supabase_client()
        comment_content = _build_comment(need_category)
        row = await _insert(
            supabase,
            {
                id_column: post_id,
                "platform": platform,
                "post_url": post_url,
                "group_name": group_name,
                "id_member": id_member,
                "comment_content": comment_content,
                "lead_score": lead_score,
                "need_category": need_category,
                "phone_number": contact_phone,
                "status": "pending",
            },
        )
        logger.info(f"auto_seeding_comment: đã tạo nhiệm vụ comment cho bài {platform}#{post_id} (điểm {lead_score}, {need_category})")
        return row
    except Exception as exc:
        # UNIQUE(id_post_fb)/UNIQUE(id_post_li) vi phạm nghĩa là đã có nhiệm vụ cho bài này
        # rồi - bỏ qua êm.
        logger.info(f"auto_seeding_comment: bỏ qua bài {platform}#{post_id} ({exc})")
        return None


async def _insert(supabase, record: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    res = await asyncio.to_thread(lambda: supabase.table("auto_seeding_comments").insert(record).execute())
    return res.data[0] if res.data else {}


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
