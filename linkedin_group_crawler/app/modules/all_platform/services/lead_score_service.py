"""Chấm điểm "tiềm năng seeding" cho bài viết vừa cào về bằng LLM (OpenAI-compatible,
dùng chung config với ai_comment_service.py/deal_ai_parse_service.py — không tự implement
lại logic gọi API).

Mục tiêu (yêu cầu Master 2026-11-04):
- CHỈ GIỮ LẠI bài viết của người ĐANG TÌM/CẦN THUÊ đơn vị làm website/app/landing page/tool (lead thật).
- LOẠI BỎ TRIỆT ĐỂ và XOÁ NGAY LẬP TỨC bài của các đối thủ/agency/freelancer đăng chào mời dịch vụ,
  tìm khách, quảng cáo ('em nhận làm...', 'bên em chuyên...', 'inbox em tư vấn',...).
- Đảm bảo xoá sạch bài đối thủ trên toàn bộ Facebook, Threads, LinkedIn.
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
from app.modules.all_platform.services.post_deduplication_service import is_obvious_competitor_seller

logger = get_logger(__name__)

_NEED_CATEGORIES = ("website", "app", "landing_page", "software", "other")

_OWN_COMPANY_PHONES_E164 = {"+84765055708", "+84902355083"}  # Markee, CloudGate

_SYSTEM_PROMPT = (
    "Bạn là chuyên gia thẩm định Lead và bài viết cho đơn vị chuyên cung cấp dịch vụ lập trình: "
    "Website, App di động, Landing Page, Phần mềm, Tool tự động hoá.\n\n"
    "NHIỆM VỤ TỐI THƯỢNG: Phân loại rạch ròi BÀI ĐĂNG CỦA KHÁCH HÀNG (CẦN TÌM/CẦN THUÊ) vs BÀI ĐĂNG "
    "CỦA ĐỐI THỦ/AGENCY/FREELANCER (CHÀO HÀNG/BÁN DỊCH VỤ/TÌM KHÁCH).\n\n"
    "1. ĐỐI THỦ / BÁN DỊCH VỤ / TÌM KHÁCH (SELLER / COMPETITOR) -> BẮT BUỘC ĐIỂM = 0 & is_competitor = true, is_buyer = false:\n"
    "   - Người viết là bên cung cấp dịch vụ đang chào mời, quảng cáo, nhận làm, tìm khách.\n"
    "   - Dấu hiệu nhận biết: 'em nhận...', 'bên em nhận...', 'bên em chuyên...', 'nhận thiết kế...', "
    "'nhận làm web/app/tool...', 'inbox em tư vấn', 'ib em hỗ trợ', 'chi phí rõ ràng', 'hỗ trợ 24/7', "
    "'hợp đồng + hóa đơn VAT', 'giá rẻ', 'demo miễn phí'...\n"
    "   - BÀI DẠNG NÀY TUYỆT ĐỐI CẤM CHẤM ĐIỂM CAO! BẮT BUỘC score = 0, is_competitor = true, is_buyer = false.\n\n"
    "2. KHÁCH HÀNG THỰC SỰ (BUYER / CLIENT) -> ĐIỂM CAO (70 - 100) & is_competitor = false, is_buyer = true:\n"
    "   - Người viết là KHÁCH HÀNG đang có nhu cầu CẦN TÌM / CẦN THUÊ / CẦN LÀM / CẦN BÁO GIÁ đơn vị "
    "lập trình làm Website, Mobile App, Landing Page, Tool, Phần mềm.\n"
    "   - Dấu hiệu nhận biết: 'mình cần tìm người làm...', 'cần tìm đơn vị thiết kế web...', 'ai nhận làm tool...', "
    "'em cần làm app...', 'cần báo giá website...', 'tìm agency outsource...', 'ai làm được web dạng này ib mình'...\n\n"
    "3. BÀI KHÔNG LIÊN QUAN / CHIA SẺ CHUNG CHUNG / TUYỂN DỤNG NỘI BỘ -> ĐIỂM THẤP (0 - 30):\n"
    "   - Tuyển dụng nhân sự đi làm công ty hưởng lương hàng tháng, chia sẻ tài liệu, bài spam rác, tin tức...\n\n"
    "Nếu điểm >= 70, xác định thêm need_category là 1 trong: 'website', 'app', 'landing_page', 'software', 'other'. "
    "Nếu điểm < 70, để need_category là null.\n\n"
    "Nếu điểm >= 70 VÀ bài viết có yêu cầu rõ ràng liên hệ/inbox/nhắn tin/Zalo tới 1 SỐ ĐIỆN THOẠI cụ thể "
    "(CHỈ KHI LÀ KHÁCH HÀNG THẬT SỰ), trích nguyên văn số điện thoại đó vào contact_phone. Nếu bài không có hoặc "
    "là đối thủ chào hàng, để contact_phone là null. KHÔNG được bịa số nếu bài không có.\n\n"
    "Chỉ trả về DUY NHẤT 1 object JSON hợp lệ, đúng các key sau, không markdown, không giải thích:\n"
    "{\n"
    '  "score": number (0-100 nguyên, NẾU LÀ ĐỐI THỦ CHÀO HÀNG THÌ BẮT BUỘC = 0),\n'
    '  "is_competitor": boolean (true nếu là đối thủ/agency/freelancer chào mời dịch vụ, false nếu là khách hàng tìm đơn vị),\n'
    '  "is_buyer": boolean (true nếu là khách hàng thật đang tìm thuê/làm, false nếu là đối thủ chào hàng),\n'
    '  "reason": string (tối đa 25 từ tiếng Việt giải thích rõ vì sao là khách hoặc vì sao là đối thủ chào hàng),\n'
    '  "need_category": string|null,\n'
    '  "contact_phone": string|null\n'
    "}"
)

_MAX_CONCURRENT_SCORING = 3

# Bài điểm THẤP (< ngưỡng này) hoặc bài đối thủ chào hàng là loại bỏ và XÓA NGAY LẬP TỨC
_DELETE_BELOW_SCORE = 40

# Ngưỡng điểm cao dùng chung
_HIGH_SCORE = 70


def is_lead_scoring_configured() -> bool:
    return bool(settings.openai_api_key)


def _clean_content(text: str) -> str:
    """Bỏ ký tự điều khiển (trừ \\n, \\t)."""
    return "".join(ch for ch in (text or "") if ch in ("\n", "\t") or ord(ch) >= 32)


async def score_text_for_lead(content: str, *, keywords: Optional[list[str]] = None) -> Optional[dict[str, Any]]:
    """Trả kết quả chấm điểm hoặc None nếu chưa cấu hình/lỗi."""
    content = _clean_content(content)
    if not settings.openai_api_key or not content.strip():
        return None

    # 1. KIỂM TRA QUY TẮC NHANH (FAST HEURISTIC): Phát hiện ngay đối thủ chào mời dịch vụ
    is_comp, comp_reason = is_obvious_competitor_seller(content)
    if is_comp:
        logger.info(f"lead_score: Fast rule phát hiện đối thủ: {comp_reason}")
        return {
            "score": 0,
            "is_competitor": True,
            "is_buyer": False,
            "reason": f"Đối thủ chào hàng: {comp_reason}",
            "need_category": None,
            "contact_phone": None,
        }

    # 2. XÂY DỰNG PROMPT CHẤM ĐIỂM
    clean_kws = [str(k).strip() for k in (keywords or []) if str(k).strip()]
    system_prompt = _SYSTEM_PROMPT
    if clean_kws:
        kw_str = ", ".join(clean_kws[:20])
        system_prompt = (
            f"{_SYSTEM_PROMPT}\n\n"
            f"LƯU Ý ĐẶC BIỆT KHI CÀO THEO TỪ KHOÁ [{kw_str}]:\n"
            f"- CHỈ ĐƯỢC CHẤM ĐIỂM CAO (70-100) nếu người viết là KHÁCH HÀNG (BUYER) ĐANG CẦN TÌM/CẦN THUÊ liên quan đến [{kw_str}].\n"
            f"- TUYỆT ĐỐI CẤM: Nếu bài viết là ĐỐI THỦ/AGENCY/FREELANCER CHÀO MỜI DỊCH VỤ, NHẬN LÀM [{kw_str}] (vd: 'HCM em nhận thiết kế Website...', 'Bên em chuyên thiết kế website...'), BẮT BUỘC CHO score = 0, is_competitor = true, is_buyer = false!"
        )

    url = f"{settings.openai_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content[:3000]},
        ],
        "temperature": 0.1,
        "max_tokens": 250,
        "response_format": {"type": "json_object"},
    }

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

            is_competitor = bool(parsed.get("is_competitor"))
            is_buyer = bool(parsed.get("is_buyer", not is_competitor))

            score = parsed.get("score")
            score = max(0, min(100, int(score or 0)))

            # Ép điểm = 0 nếu là đối thủ chào hàng
            if is_competitor or not is_buyer:
                score = 0

            reason = str(parsed.get("reason") or "")[:200]
            need_category = parsed.get("need_category")
            need_category = need_category if need_category in _NEED_CATEGORIES else None

            contact_phone = None
            if not is_competitor and is_buyer and score >= 70:
                contact_phone = vn_phone_to_e164(parsed.get("contact_phone"))
                if contact_phone in _OWN_COMPANY_PHONES_E164:
                    logger.warning(
                        f"lead_score: LLM trả về số điện thoại CỦA CHÍNH CÔNG TY ({contact_phone}) - loại bỏ."
                    )
                    contact_phone = None

            return {
                "score": score,
                "is_competitor": is_competitor,
                "is_buyer": is_buyer,
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
    keywords: Optional[list[str]] = None,
) -> dict[str, int]:
    """Chấm điểm + lưu lead_score/lead_score_reason/lead_need_category cho các bài vừa insert.
    Nếu bài là ĐỐI THỦ CHÀO MỜI hoặc ĐIỂM < 40: XÓA NGAY LẬP TỨC khỏi database.
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
            result = await score_text_for_lead(content, keywords=keywords)
        if not result:
            return
        summary["total"] += 1
        try:
            is_competitor = result.get("is_competitor") is True or result.get("is_buyer") is False
            score = result.get("score", 0)

            # ĐIỀU KIỆN XÓA TRIỆT ĐỂ: Nếu là đối thủ chào hàng HOẶC điểm < 40 -> XÓA NGAY
            if is_competitor or score < _DELETE_BELOW_SCORE:
                await asyncio.to_thread(lambda: supabase.table(table).delete().eq("id", post_id).execute())
                logger.info(
                    f"lead_score: ĐÃ XÓA bài đối thủ / điểm thấp {table}#{post_id} "
                    f"(điểm {score}, is_competitor={is_competitor} - {result.get('reason')})"
                )
                summary["deleted"] += 1
            else:
                await asyncio.to_thread(
                    lambda: supabase.table(table)
                    .update({
                        "lead_score": score,
                        "lead_score_reason": result.get("reason"),
                        "lead_need_category": result.get("need_category"),
                    })
                    .eq("id", post_id)
                    .execute()
                )
                if score >= _HIGH_SCORE:
                    summary["high"] += 1

                if table in ("facebook_posts", "linkedin_posts") and score >= 70:
                    from app.modules.all_platform.services.auto_seeding_comment_service import (
                        maybe_create_auto_seeding_comment,
                    )
                    platform = "linkedin" if table == "linkedin_posts" else "facebook"
                    created = await maybe_create_auto_seeding_comment(
                        post_id=post_id,
                        platform=platform,
                        post_url=row.get("post_url") or "",
                        group_name=group_name,
                        id_member=id_member,
                        content=content,
                        lead_score=score,
                        need_category=result.get("need_category"),
                        contact_phone=result.get("contact_phone"),
                    )
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
