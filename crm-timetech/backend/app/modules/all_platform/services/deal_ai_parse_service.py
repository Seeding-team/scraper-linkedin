"""AI dán-văn-bản-điền-form cho popup "Thêm deal" (CRM) — tiện ích phụ, KHÔNG phải phụ thuộc
cứng của luồng tạo deal. Dùng chung endpoint OpenAI-compatible với ai_comment_service.py,
không tự implement lại logic gọi API."""

from __future__ import annotations

import json

import httpx

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

# Đúng 1 bộ key camelCase duy nhất — khớp thẳng DealFormState phía frontend, không đổi tên
# ở bất kỳ tầng nào trong pipeline (tránh lặp lỗi service_package/servicePackage đợt trước).
_RESULT_KEYS = (
    "customerName",
    "companyName",
    "phone",
    "email",
    "servicePackage",
    "estimatedBudget",
    "nextStep",
    "note",
)

_SERVICE_PACKAGE_VALUES = (
    "Lam_Web",
    "Markee_Chat",
    "Markee_App",
    "Markee_CRM",
    "Marketing_Automation",
    "Khac",
)

_SYSTEM_PROMPT = (
    "Bạn là trợ lý CRM. Đọc đoạn văn bản khách hàng dán vào (tin nhắn, email, ghi chú cuộc "
    "gọi...) và trích xuất thông tin để điền form tạo deal bán hàng. "
    "Chỉ trả về DUY NHẤT 1 object JSON hợp lệ, đúng các key sau, không thêm key nào khác, "
    "không giải thích, không markdown:\n"
    '{"customerName": string|null, "companyName": string|null, "phone": string|null, '
    '"email": string|null, "servicePackage": string|null, "estimatedBudget": number|null, '
    '"nextStep": string|null, "note": string|null}\n\n'
    f"servicePackage CHỈ được là 1 trong các giá trị sau (hoặc null nếu không rõ): "
    f"{', '.join(_SERVICE_PACKAGE_VALUES)}.\n"
    "estimatedBudget là số nguyên VND thuần (không dấu chấm/phẩy/ký tự tiền tệ), hoặc null.\n"
    "Field nào không suy ra được từ văn bản thì để null — TUYỆT ĐỐI KHÔNG bịa giá trị."
)


def is_ai_configured() -> bool:
    """Dùng cho endpoint status nhẹ (frontend gọi 1 lần lúc mount để biết có nên hiện
    khối "AI điền nhanh" hay không) — không gọi thử OpenAI thật, chỉ kiểm tra config."""
    return bool(settings.openai_api_key)


def _require_config() -> None:
    if not settings.openai_api_key:
        raise RuntimeError(
            "Chưa cấu hình OPENAI_API_KEY — AI điền nhanh chưa dùng được, vui lòng nhập tay."
        )


async def parse_deal_text(text: str) -> dict:
    _require_config()

    url = f"{settings.openai_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
        "response_format": {"type": "json_object"},
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    raw_content = data["choices"][0]["message"]["content"].strip()
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        logger.warning(f"deal_ai_parse: model tra JSON khong hop le: {raw_content[:200]}")
        raise RuntimeError("AI trả về dữ liệu không hợp lệ, vui lòng thử lại hoặc nhập tay.") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError("AI trả về dữ liệu không hợp lệ, vui lòng thử lại hoặc nhập tay.")

    result: dict = {}
    for key in _RESULT_KEYS:
        value = parsed.get(key)
        result[key] = value if value not in ("", "null", None) else None

    if result.get("servicePackage") not in _SERVICE_PACKAGE_VALUES:
        result["servicePackage"] = None

    if result.get("estimatedBudget") is not None:
        try:
            result["estimatedBudget"] = int(result["estimatedBudget"])
        except (TypeError, ValueError):
            result["estimatedBudget"] = None

    logger.info("deal_ai_parse: parsed deal text successfully")
    return result
