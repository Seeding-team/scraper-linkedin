"""AI comment generation via OpenAI-compatible API."""

from __future__ import annotations

import httpx

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

_SYSTEM_PROMPT = (
    "Bạn là chuyên gia marketing. Viết 1 bình luận ngắn gọn (tối đa 3 câu), "
    "tự nhiên, hữu ích bằng tiếng Việt để phản hồi bài đăng trên mạng xã hội sau. "
    "Chỉ trả về nội dung bình luận, không giải thích, không đặt trong dấu ngoặc kép."
)


async def generate_comment(post_content: str) -> str:
    api_key = settings.openai_api_key
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    url = f"{settings.openai_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": post_content},
        ],
        "temperature": 0.7,
        "max_tokens": 200,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"].strip()
    logger.info(f"AI comment generated ({len(content)} chars)")
    return content
