import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

_AI_EXTRACT_NEED_PROMPT = (
    "Bạn là trợ lý AI chuyên nghiệp phân tích bài viết cào được từ mạng xã hội (Facebook Group, LinkedIn, v.v.).\n"
    "Nhiệm vụ: Đọc nội dung bài viết và trả về đúng định dạng JSON (không kèm markdown thừa hay giải thích).\n"
    "Yêu cầu:\n"
    "1. 'need': Tóm tắt ngắn gọn nhu cầu thực tế của người đăng bài (dưới 15 từ, tiếng Việt chuẩn, không chứa SĐT, email hay icon lộn xộn). Ví dụ: 'Cần tìm đơn vị thiết kế website cho kinh doanh'.\n"
    "2. 'zalo_message': Soạn đoạn tin nhắn mở đầu để nhân viên liên hệ tư vấn qua Zalo:\n"
    "   - Giọng điệu lịch sự, chuyên nghiệp, tự nhiên.\n"
    "   - Nếu có tên nhóm ({group_name}), nói khéo 'mình thấy bài viết của bạn trong nhóm {group_name}'.\n"
    "   - Nêu rõ bên mình có thể hỗ trợ đúng nhu cầu vừa tóm tắt.\n"
    "   - Nếu có link bài viết ({post_url}), bắt buộc thêm ở dòng cuối: 'Link bài viết: {post_url}'.\n\n"
    "Trả về định dạng JSON thuần:\n"
    '{"need": "...", "zalo_message": "..."}'
)


def _clean_text_for_nlp(text: str) -> str:
    if not text:
        return ""
    # Loại bỏ link http(s) và số điện thoại để trích xuất nhu cầu sạch
    t = re.sub(r"https?://\S+", "", text)
    t = re.sub(r"(?:\+?84|0084|0)(?:\D*\d){8,10}\b", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def heuristic_extract_need(content: str) -> str:
    """Fallback NLP tiếng Việt bóc tách nhu cầu khi AI offline hoặc quá quota."""
    cleaned = _clean_text_for_nlp(content)
    if not cleaned:
        return "Tư vấn dịch vụ & giải pháp"

    # Các pattern nhu cầu thường gặp
    patterns = [
        r"(cần\s+(?:tìm|thuê|mua|hợp tác|tư vấn|làm|triển khai)[^.,;!\n\?]+)",
        r"(tìm\s+(?:bên|đối tác|người|dịch vụ|đơn vị)[^.,;!\n\?]+)",
        r"(có\s+ai\s+(?:nhận|làm|báo giá)[^.,;!\n\?]+)",
        r"(muốn\s+(?:tìm|hỏi|tư vấn|làm)[^.,;!\n\?]+)",
        r"(báo\s+giá\s+giúp[^.,;!\n\?]+)",
    ]
    for p in patterns:
        m = re.search(p, cleaned, re.IGNORECASE)
        if m:
            matched = m.group(1).strip()
            # Cắt ngắn nếu dài quá 80 ký tự
            if len(matched) > 80:
                matched = matched[:80].rsplit(" ", 1)[0]
            # Viết hoa chữ đầu
            return matched[0].upper() + matched[1:]

    # Nếu không khớp mẫu đặc trưng, lấy câu đầu tiên có nghĩa
    first_sentence = re.split(r"[.\n;!?]", cleaned)[0].strip()
    if len(first_sentence) > 70:
        first_sentence = first_sentence[:70].rsplit(" ", 1)[0]
    if len(first_sentence) >= 6:
        return first_sentence[0].upper() + first_sentence[1:]

    return "Tư vấn theo nội dung bài viết"


def draft_fallback_zalo_message(
    need: str,
    group_name: Optional[str] = None,
    post_url: Optional[str] = None,
) -> str:
    g_text = f' trong nhóm "{group_name}"' if group_name else ""
    lines = [
        f"Chào bạn, mình thấy bài viết của bạn{g_text} đang có nhu cầu: \"{need}\".",
        "Bên mình có giải pháp và kinh nghiệm có thể hỗ trợ bạn ngay.",
        "Mình gửi thông tin chi tiết qua Zalo để bạn tiện tham khảo nhé!",
    ]
    if post_url:
        lines.append(f"Link bài viết: {post_url}")
    return "\n".join(lines)


def _gemini_api_keys() -> List[str]:
    keys = []
    if getattr(settings, "gemini_api_key", None):
        keys.append(settings.gemini_api_key)
    for env_name in ("GEMINI_API_KEY", "GEMINI_API_KEY_2"):
        val = os.getenv(env_name)
        if val and val not in keys:
            keys.append(val)
    return keys


def _clean_json_str(text: str) -> str:
    cleaned = (text or "").strip().replace("```json", "```").replace("```", "")
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        return cleaned[start : end + 1]
    return cleaned


async def extract_need_and_draft_zalo_message(
    content: str,
    group_name: Optional[str] = None,
    post_url: Optional[str] = None,
) -> Dict[str, str]:
    """Trích xuất nhu cầu bằng AI (Gemini) kèm Fallback Heuristic tiếng Việt."""
    if not content or not content.strip():
        need = "Tư vấn thông tin dịch vụ"
        return {
            "need": need,
            "zalo_message": draft_fallback_zalo_message(need, group_name, post_url),
        }

    keys = _gemini_api_keys()
    if keys:
        try:
            import google.generativeai as genai
            import random

            api_key = random.choice(keys)
            genai.configure(api_key=api_key)
            model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
            model = genai.GenerativeModel(model_name)

            prompt = (
                f"{_AI_EXTRACT_NEED_PROMPT}\n\n"
                f"Tên nhóm: {group_name or 'Chưa rõ'}\n"
                f"Link bài viết: {post_url or 'Chưa có'}\n"
                f"Nội dung bài viết:\n\"\"\"{content.strip()}\"\"\""
            )

            def _call_gemini() -> str:
                resp = model.generate_content(
                    prompt,
                    generation_config={"temperature": 0.3, "max_output_tokens": 400},
                )
                return getattr(resp, "text", "") or ""

            raw_resp = await asyncio.wait_for(asyncio.to_thread(_call_gemini), timeout=10)
            cleaned = _clean_json_str(raw_resp)
            data = json.loads(cleaned)
            need = str(data.get("need", "")).strip()
            msg = str(data.get("zalo_message", "")).strip()

            if need:
                # Đảm bảo có link bài viết nếu post_url được truyền vào
                if post_url and post_url not in msg:
                    msg = f"{msg}\nLink bài viết: {post_url}"
                return {"need": need, "zalo_message": msg}
        except Exception as exc:
            logger.warning("Gemini extract need failed (%s), fallback to heuristic", exc)

    # Fallback khi không có API key hoặc gọi Gemini lỗi
    need = heuristic_extract_need(content)
    msg = draft_fallback_zalo_message(need, group_name, post_url)
    return {"need": need, "zalo_message": msg}

