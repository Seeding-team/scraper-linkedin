"""Chấm điểm "tiềm năng seeding" cho bài viết vừa cào về bằng LLM (OpenAI-compatible,
dùng chung config với ai_comment_service.py/deal_ai_parse_service.py — không tự implement
lại logic gọi API).

Mục tiêu (yêu cầu 2026-10-01): chỉ giữ lại bài viết của người ĐANG TÌM đơn vị làm
website/app/landing page (lead thật) — loại bài rác/không liên quan, và loại cả bài của
CHÍNH các đơn vị khác đang quảng cáo dịch vụ của họ (không phải người đi tìm thuê, không
phải lead). Chạy NỀN (fire-and-forget) ngay sau khi lưu bài — không chặn response trả về
cho extension, vì extension gửi theo lô (có thể vài chục bài/lần) và LLM có độ trễ riêng.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.core.logger import get_logger
from app.core.phone import vn_phone_to_e164
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

_NEED_CATEGORIES = ("website", "app", "landing_page", "software", "other")

_SYSTEM_PROMPT = (
    "Bạn là trợ lý sales cho 1 đơn vị làm website/app/landing page. Đọc 1 bài đăng mạng xã "
    "hội (Facebook/LinkedIn/Threads) và chấm điểm mức độ đây có phải LEAD TIỀM NĂNG hay không "
    "— tức là người VIẾT bài này đang CẦN THUÊ/TÌM đơn vị để làm website, app di động, "
    "landing page, hoặc phần mềm/outsource lập trình tương tự.\n\n"
    "Điểm CAO (70-100): bài hỏi xin giới thiệu/báo giá/đánh giá đơn vị làm web-app-landing "
    "page, đăng tin cần tuyển/thuê ngoài (outsource) làm web/app, hỏi kinh nghiệm chọn đơn vị "
    "làm website...\n"
    "Điểm THẤP (0-30): bài KHÔNG liên quan chủ đề này, bài tuyển dụng nhân sự nội bộ (không "
    "phải thuê ngoài), bài CHÍNH CÁC ĐƠN VỊ/AGENCY tự quảng cáo dịch vụ của họ (đây là đối "
    "thủ chào hàng, KHÔNG PHẢI người đi tìm thuê nên KHÔNG phải lead), bài chia sẻ kiến thức "
    "chung chung không có nhu cầu thuê rõ ràng.\n"
    "Điểm TRUNG BÌNH (31-69): không rõ ràng, có nhắc tới web/app nhưng không chắc có đang tìm "
    "thuê hay không.\n\n"
    "Nếu điểm >= 70, xác định thêm NHU CẦU CHÍNH (need_category) là 1 trong: "
    "\"website\" (web bán hàng/giới thiệu/doanh nghiệp), \"app\" (app di động iOS/Android), "
    "\"landing_page\" (trang đích 1 trang, quảng cáo/sự kiện), \"software\" (phần mềm/hệ thống "
    "quản lý/outsource lập trình khác), \"other\" (không rõ loại cụ thể). Nếu điểm < 70, để "
    "need_category là null.\n\n"
    "Nếu điểm >= 70 VÀ bài viết có yêu cầu rõ ràng liên hệ/inbox/nhắn tin/Zalo tới 1 SỐ ĐIỆN "
    "THOẠI cụ thể (vd \"liên hệ Zalo 09xxxxxxxx\", \"ib số 09xxxxxxxx\", \"gọi 09xxxxxxxx tư "
    "vấn\"), trích nguyên văn số điện thoại đó vào contact_phone. Nếu bài không có số điện "
    "thoại nào để liên hệ, hoặc điểm < 70, để contact_phone là null. KHÔNG được bịa số nếu bài "
    "không có.\n\n"
    "Chỉ trả về DUY NHẤT 1 object JSON hợp lệ, đúng 4 key sau, không thêm key nào khác, không "
    "giải thích, không markdown:\n"
    '{"score": number (0-100 nguyên), "reason": string (tối đa 20 từ tiếng Việt, lý do ngắn gọn), '
    '"need_category": string|null (1 trong 5 giá trị trên, hoặc null), '
    '"contact_phone": string|null (số điện thoại liên hệ nếu bài có nêu rõ, hoặc null)}'
)

# Gioi han so luong goi LLM dong thoi - tranh lam qua tai proxy AI dung chung voi cac
# tinh nang khac (AI comment, AI dien nhanh deal...) khi 1 lo cao tra ve vai chuc bai.
# Ha tu 5 xuong 3 sau khi thay proxy (shopaikey.com) tra 429 Too Many Requests kha thuong
# xuyen o concurrency cao hon trong lan backfill du lieu cu (2026-10-02).
_MAX_CONCURRENT_SCORING = 3

# Bai diem THAP (< nguong nay) la "khong co gia tri gi" (bai rac/quang cao doi thu/khong
# lien quan - dung tieu chi trong _SYSTEM_PROMPT) - XOA LUON thay vi chi luu diem thap, de
# feed luon sach, chi con bai dang gia tri xem xet seeding (yeu cau 2026-10-01).
_DELETE_BELOW_SCORE = 31

# Nguong "diem cao" dung chung voi feed bai viet/group scoring/registry tu khoa Threads.
_HIGH_SCORE = 70


def is_lead_scoring_configured() -> bool:
    return bool(settings.openai_api_key)


def _clean_content(text: str) -> str:
    """Bỏ ký tự điều khiển (trừ \\n, \\t) — vài bài copy-paste từ mạng xã hội chứa ký tự lạ
    (emoji biến thể, control char ẩn) khiến proxy AI trả 400 Bad Request khi encode JSON."""
    return "".join(ch for ch in (text or "") if ch in ("\n", "\t") or ord(ch) >= 32)


async def score_text_for_lead(content: str) -> Optional[dict[str, Any]]:
    """Trả {"score": int, "reason": str} hoặc None nếu chưa cấu hình/lỗi (KHÔNG raise —
    chấm điểm là tiện ích phụ, lỗi ở đây không được làm hỏng luồng lưu bài chính)."""
    content = _clean_content(content)
    if not settings.openai_api_key or not content.strip():
        return None

    url = f"{settings.openai_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": content[:3000]},
        ],
        "temperature": 0.2,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
    }

    # Proxy AI dùng chung (shopaikey.com) rate-limit khá chặt (429) khi nhiều bài cùng lúc
    # gọi gần nhau (vd 1 lô vài chục bài sau 1 lần cào group) — retry với backoff thay vì bỏ
    # cuộc ngay lần đầu, để bài không bị "treo" mãi ở lead_score NULL chỉ vì 1 lần 429 thoáng qua.
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(url, json=body, headers=headers)
                if resp.status_code in (429, 503) and attempt < 2:
                    await asyncio.sleep(3 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
            raw_content = data["choices"][0]["message"]["content"].strip()
            parsed = json.loads(raw_content)
            if not isinstance(parsed, dict):
                return None
            score = parsed.get("score")
            score = max(0, min(100, int(score)))
            reason = str(parsed.get("reason") or "")[:200]
            need_category = parsed.get("need_category")
            need_category = need_category if need_category in _NEED_CATEGORIES else None
            # Chuan hoa ve E.164 qua vn_phone_to_e164 - KHONG tin thang dinh dang LLM tra ve
            # (co the con khoang trang/dau cham), va loai bo neu LLM tra ve chuoi khong phai
            # SDT VN hop le (tranh goi Zalo API voi gia tri rac).
            contact_phone = vn_phone_to_e164(parsed.get("contact_phone"))
            return {
                "score": score,
                "reason": reason,
                "need_category": need_category,
                "contact_phone": contact_phone,
            }
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                await asyncio.sleep(2 * (attempt + 1))
                continue
    logger.warning(f"lead_score: chấm điểm thất bại sau 3 lần thử (bỏ qua, không ảnh hưởng lưu bài): {last_exc}")
    return None


async def score_and_save_posts(
    table: str,
    rows: list[dict[str, Any]],
    *,
    id_member: Optional[str] = None,
    group_name: Optional[str] = None,
) -> dict[str, int]:
    """Chấm điểm + lưu lead_score/lead_score_reason/lead_need_category cho các bài vừa
    insert (`rows` = list {"id", "content", "post_url"?}). Thường gọi qua asyncio.create_task
    (chạy nền, không chặn response trả về extension) — KHÔNG được raise ra ngoài, exception ở
    đây chỉ log, không crash gì. Trả về {"total", "high", "deleted"} — Threads (keyword
    registry) AWAIT trực tiếp hàm này để biết kết quả chấm điểm theo từ khoá; FB/LI vẫn dùng
    kiểu fire-and-forget như cũ, bỏ qua giá trị trả về.

    Với facebook_posts điểm cao (>=70): tự tạo 1 dòng "auto_seeding_comments" (pending) để
    comment seeding tự động — xem app/modules/all_platform/services/auto_seeding_comment_service.py.
    """
    summary = {"total": 0, "high": 0, "deleted": 0}
    if not is_lead_scoring_configured() or not rows:
        return summary

    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_SCORING)
    supabase = get_supabase_client()

    async def _score_one(row: dict[str, Any]) -> None:
        post_id = row.get("id")
        content = row.get("content") or ""
        if not post_id or not content.strip():
            return
        async with semaphore:
            result = await score_text_for_lead(content)
        if not result:
            return
        summary["total"] += 1
        try:
            if result["score"] < _DELETE_BELOW_SCORE:
                # Bai diem thap khong co gia tri cho seeding - xoa luon thay vi chi luu
                # diem, giu feed sach (yeu cau 2026-10-01).
                await asyncio.to_thread(lambda: supabase.table(table).delete().eq("id", post_id).execute())
                logger.info(f"lead_score: xoá bài {table}#{post_id} (điểm {result['score']} - {result['reason']})")
                summary["deleted"] += 1
            else:
                await asyncio.to_thread(
                    lambda: supabase.table(table)
                    .update({
                        "lead_score": result["score"],
                        "lead_score_reason": result["reason"],
                        "lead_need_category": result.get("need_category"),
                    })
                    .eq("id", post_id)
                    .execute()
                )
                if result["score"] >= _HIGH_SCORE:
                    summary["high"] += 1
                if table == "facebook_posts" and result["score"] >= 70:
                    from app.modules.all_platform.services.auto_seeding_comment_service import (
                        maybe_create_auto_seeding_comment,
                    )
                    created = await maybe_create_auto_seeding_comment(
                        id_post_fb=post_id,
                        post_url=row.get("post_url") or "",
                        group_name=group_name,
                        id_member=id_member,
                        content=content,
                        lead_score=result["score"],
                        need_category=result.get("need_category"),
                        contact_phone=result.get("contact_phone"),
                    )
                    # Chi trigger Zalo khi vua TAO MOI dong auto_seeding_comments (created
                    # khong None) - neu da ton tai tu truoc (UNIQUE id_post_fb) thi KHONG gui
                    # lai, tranh nhan tin trung lap cho cung 1 bai (yeu cau 2026-10-02).
                    if created and result.get("contact_phone"):
                        from app.modules.all_platform.services.auto_seeding_zalo_service import (
                            maybe_send_zalo_consult,
                        )
                        await maybe_send_zalo_consult(
                            comment_id=created["id"],
                            contact_phone=result["contact_phone"],
                            need_category=result.get("need_category"),
                        )
        except Exception as exc:
            logger.warning(f"lead_score: lưu/xoá bài {table}#{post_id} thất bại: {exc}")

    await asyncio.gather(*(_score_one(r) for r in rows))
    return summary
