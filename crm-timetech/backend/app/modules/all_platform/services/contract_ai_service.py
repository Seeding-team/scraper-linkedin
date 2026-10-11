"""AI Contract Copilot — soạn thảo hợp đồng + chấm điểm rủi ro via OpenAI-compatible API.

Tách khỏi supabase_contract_service.py (CRUD) theo đúng cách ai_comment_service.py tách
khỏi các service khác — 2 lệnh gọi AI độc lập, không đọc/ghi DB trực tiếp (nhận dữ liệu
deal/quote đã load sẵn từ router, trả kết quả để router/FE quyết định lưu hay không)."""

from __future__ import annotations

import json

import httpx

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

# Điều khoản chuẩn Markee — hard-code ngắn gọn trong prompt (không tạo bảng riêng ở v1,
# xem "Việc KHÔNG làm ở lần này" trong kế hoạch).
_STANDARD_TERMS = (
    "Thanh toán chuẩn: 50% khi ký, 30% khi bàn giao, 20% trong vòng 07 ngày sau nghiệm thu. "
    "Bảo mật: hai bên cam kết bảo mật thông tin kinh doanh/kỹ thuật trong và sau hợp đồng. "
    "Phạt chậm tiến độ: 0.1%/ngày trên giá trị hợp đồng, tối đa 8%. "
    "Chấm dứt: báo trước 30 ngày bằng văn bản nếu một bên vi phạm nghiêm trọng đã được nhắc nhở."
)

# 7 điều khoản chuẩn — đúng thứ tự/tên hiện trong "Mục lục điều khoản" của mockup UI
# (crm-trung-tam-sale-ai-hop-dong-v8.html). AI PHẢI trả đủ 7, đúng thứ tự này để
# frontend map ✓/! theo từng mục cố định thay vì mục lục đổi tuỳ theo AI trả về gì.
_CANONICAL_CLAUSE_TITLES = [
    "ĐIỀU 1. THÔNG TIN CÁC BÊN",
    "ĐIỀU 2. PHẠM VI CÔNG VIỆC",
    "ĐIỀU 3. GIÁ TRỊ & THANH TOÁN",
    "ĐIỀU 4. TRIỂN KHAI & NGHIỆM THU",
    "ĐIỀU 5. BẢO MẬT DỮ LIỆU",
    "ĐIỀU 6. TRÁCH NHIỆM & PHẠT",
    "ĐIỀU 7. CHẤM DỨT HỢP ĐỒNG",
]

_DRAFT_SYSTEM_PROMPT = (
    "Bạn là luật sư soạn thảo hợp đồng cung cấp dịch vụ tại Việt Nam. Dựa trên dữ liệu CRM "
    "và báo giá được cung cấp, soạn các điều khoản hợp đồng bằng tiếng Việt, văn phong pháp lý "
    "chuẩn mực, ngắn gọn, rõ ràng. PHẢI trả về ĐÚNG 7 điều khoản, ĐÚNG THỨ TỰ và ĐÚNG TIÊU ĐỀ sau "
    "(giữ nguyên văn tiêu đề, chỉ viết phần body): "
    + " | ".join(_CANONICAL_CLAUSE_TITLES)
    + '. Luôn trả về DUY NHẤT 1 JSON object dạng '
    '{"clauses": [{"title": "...", "body": "..."}]} với đúng 7 phần tử theo thứ tự trên, '
    "không thêm giải thích, không markdown."
)

_REFINE_SYSTEM_PROMPT = (
    "Bạn là luật sư chỉnh sửa hợp đồng cung cấp dịch vụ tại Việt Nam. Bạn nhận nội dung hợp đồng "
    "hiện tại (7 điều khoản) và danh sách rủi ro pháp chế vừa phát hiện. Hãy VIẾT LẠI phần body của "
    "TỪNG điều khoản để khắc phục các rủi ro đó (bổ sung nội dung còn thiếu, sửa số liệu sai lệch), "
    "giữ nguyên đúng 7 tiêu đề đã cho, không đổi thứ tự. Luôn trả về DUY NHẤT 1 JSON object dạng "
    '{"clauses": [{"title": "...", "body": "..."}]} với đúng 7 phần tử, không thêm giải thích, không markdown.'
)

_REVIEW_SYSTEM_PROMPT = (
    "Bạn là chuyên viên pháp chế rà soát rủi ro hợp đồng. So sánh nội dung điều khoản với "
    "báo giá gốc và điều khoản chuẩn công ty; phát hiện thiếu sót, sai lệch giá trị/thanh toán, "
    "hoặc rủi ro pháp lý. Luôn trả về DUY NHẤT 1 JSON object dạng "
    '{"score": <0-100>, "findings": [{"severity": "ok"|"warn", "title": "...", "detail": "..."}]}, '
    "không thêm giải thích, không markdown. score 100 = an toàn tuyệt đối, càng nhiều rủi ro càng thấp."
)


def _require_api_key() -> str:
    api_key = settings.openai_api_key
    if not api_key:
        raise RuntimeError("Chưa cấu hình OPENAI_API_KEY — không thể dùng AI Contract Copilot.")
    return api_key


# Model dự phòng khi provider (proxy nhiều nhà cung cấp kiểu shopaikey) báo lỗi
# tạm thời cho model chính ("no available channel", hết quota theo model...) -
# thử lần lượt, MỖI model 2 lượt (proxy dạng distributor này rất chập chờn -
# cùng 1 model có thể fail rồi thành công ngay lượt sau), tránh phải đổi
# AI_MODEL thủ công mỗi lần provider gặp sự cố. Lỗi thật (401 sai key, thiếu
# cấu hình...) vẫn sẽ lộ ra trong message cuối cùng nếu MỌI model đều fail.
_FALLBACK_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4.1"]
_ATTEMPTS_PER_MODEL = 2


async def _call_chat_json(system_prompt: str, user_content: str) -> dict:
    api_key = _require_api_key()
    url = f"{settings.openai_base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    models_to_try = [settings.ai_model] + [m for m in _FALLBACK_MODELS if m != settings.ai_model]

    data: dict | None = None
    last_error_text = ""
    async with httpx.AsyncClient(timeout=60.0) as client:
        for model in models_to_try:
            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "temperature": 0.4,
                "max_tokens": 2000,
                "response_format": {"type": "json_object"},
            }
            for attempt in range(_ATTEMPTS_PER_MODEL):
                try:
                    resp = await client.post(url, json=body, headers=headers)
                    if resp.status_code >= 400:
                        last_error_text = f"[{model}] {resp.status_code}: {resp.text[:300]}"
                        logger.warning(f"AI model call failed, will retry/fallback: {last_error_text}")
                        continue
                    data = resp.json()
                    break
                except httpx.HTTPError as exc:
                    last_error_text = f"[{model}] {exc}"
                    logger.warning(f"AI model call errored, will retry/fallback: {last_error_text}")
            if data is not None:
                break
    if data is None:
        raise RuntimeError(f"Tất cả model AI đều không khả dụng lúc này (provider chập chờn). Lỗi gần nhất: {last_error_text}")
    content = data["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        logger.error(f"AI contract response is not valid JSON: {content[:500]!r}")
        raise RuntimeError("AI trả về dữ liệu không hợp lệ, vui lòng thử lại.") from exc


def _format_quote_context(quote: dict | None) -> str:
    if not quote:
        return "Chưa có báo giá đính kèm."
    items = quote.get("items") or []
    lines = [f"- {i.get('description')}: SL {i.get('quantity')} x {i.get('unitPrice')} VND" for i in items[:20]]
    return (
        f"Báo giá {quote.get('quoteNumber')} — tổng giá trị {quote.get('totalAmount')} {quote.get('currency', 'VND')}, "
        f"trạng thái: {quote.get('status')}.\nHạng mục:\n" + "\n".join(lines)
    )


def _format_deal_context(deal: dict | None) -> str:
    if not deal:
        return "Chưa có thông tin khách hàng CRM."
    return (
        f"Khách hàng: {deal.get('customer_name')}\nCông ty: {deal.get('company_name') or '(chưa có)'}\n"
        f"Mã số thuế: {deal.get('tax_code') or '(chưa có)'}\nĐịa chỉ: {deal.get('address') or '(chưa có)'}\n"
        f"Người liên hệ/chức vụ: {deal.get('position') or '(chưa có)'}\nEmail: {deal.get('email') or '(chưa có)'}"
    )


async def generate_contract_draft(
    deal: dict | None,
    quote: dict | None,
    template_type: str,
    detail_level: str,
    extra_prompt: str | None,
    reference_template_text: str | None = None,
) -> list[dict]:
    template_labels = {
        "service": "Hợp đồng cung cấp dịch vụ CNTT",
        "principle": "Hợp đồng nguyên tắc",
        "marketing": "Hợp đồng dịch vụ Marketing",
    }
    reference_section = (
        f"=== MẪU HỢP ĐỒNG THAM CHIẾU (bám theo văn phong/cấu trúc câu chữ của mẫu này, "
        f"KHÔNG copy nguyên văn số liệu/tên riêng trong mẫu) ===\n{reference_template_text[:8000]}\n\n"
        if reference_template_text
        else ""
    )
    user_content = (
        f"Loại hợp đồng: {template_labels.get(template_type, template_type)}\n"
        f"Mức độ chi tiết: {detail_level}\n\n"
        f"=== THÔNG TIN KHÁCH HÀNG (CRM) ===\n{_format_deal_context(deal)}\n\n"
        f"=== BÁO GIÁ ĐÃ CHỐT ===\n{_format_quote_context(quote)}\n\n"
        f"=== ĐIỀU KHOẢN CHUẨN CÔNG TY (tham chiếu, không copy nguyên văn) ===\n{_STANDARD_TERMS}\n\n"
        f"{reference_section}"
        f"=== YÊU CẦU THÊM TỪ SALE ===\n{extra_prompt or '(không có)'}"
    )
    result = await _call_chat_json(_DRAFT_SYSTEM_PROMPT, user_content)
    clauses = _normalize_to_canonical(result.get("clauses") or [])
    logger.info(f"AI contract draft generated: {len(clauses)} clauses")
    return clauses


def _normalize_to_canonical(clauses: list[dict]) -> list[dict]:
    """Ép về đúng 7 điều khoản chuẩn theo _CANONICAL_CLAUSE_TITLES, đúng thứ tự —
    phòng khi AI trả thiếu/thừa/sai thứ tự (model rẻ tiền đôi khi không tuân thủ
    hoàn toàn instruction). Ghép theo VỊ TRÍ (index) là đủ vì prompt đã yêu cầu rõ
    thứ tự cố định; body rỗng nếu AI không trả đủ 7 phần tử."""
    out = []
    for i, canonical_title in enumerate(_CANONICAL_CLAUSE_TITLES):
        body = clauses[i].get("body", "") if i < len(clauses) else ""
        out.append({"id": "", "title": canonical_title, "body": body})
    return out


async def refine_contract_draft(clauses: list[dict], findings: list[dict]) -> list[dict]:
    """'✦ AI đề xuất chỉnh sửa' — soạn lại body từng điều khoản để khắc phục các
    rủi ro AI vừa phát hiện ở review_contract_risk(). Khác generate_contract_draft:
    không cần deal/quote (đã có sẵn nội dung hợp đồng hiện tại), chỉ cần bản thân
    nội dung + danh sách finding cần sửa."""
    clauses_text = "\n\n".join(f"{c.get('title', '')}\n{c.get('body', '')}" for c in clauses)
    findings_text = "\n".join(f"- [{f.get('severity')}] {f.get('title')}: {f.get('detail')}" for f in findings)
    user_content = (
        f"=== NỘI DUNG HỢP ĐỒNG HIỆN TẠI ===\n{clauses_text}\n\n"
        f"=== RỦI RO CẦN KHẮC PHỤC ===\n{findings_text or '(không có)'}\n\n"
        f"=== ĐIỀU KHOẢN CHUẨN CÔNG TY (tham chiếu để sửa đúng) ===\n{_STANDARD_TERMS}"
    )
    result = await _call_chat_json(_REFINE_SYSTEM_PROMPT, user_content)
    refined = _normalize_to_canonical(result.get("clauses") or [])
    logger.info(f"AI contract draft refined: {len(refined)} clauses")
    return refined


async def review_contract_risk(
    clauses: list[dict],
    quote: dict | None,
    contract_value: float | None,
    payment_terms: str | None,
) -> dict:
    clauses_text = "\n\n".join(f"{c.get('title', '')}\n{c.get('body', '')}" for c in clauses)
    user_content = (
        f"=== NỘI DUNG HỢP ĐỒNG CẦN RÀ SOÁT ===\n{clauses_text}\n\n"
        f"=== GIÁ TRỊ HỢP ĐỒNG KHAI BÁO ===\n{contract_value}\n"
        f"=== ĐIỀU KHOẢN THANH TOÁN KHAI BÁO ===\n{payment_terms or '(không có)'}\n\n"
        f"=== BÁO GIÁ GỐC ĐỐI CHIẾU ===\n{_format_quote_context(quote)}\n\n"
        f"=== ĐIỀU KHOẢN CHUẨN CÔNG TY ===\n{_STANDARD_TERMS}"
    )
    result = await _call_chat_json(_REVIEW_SYSTEM_PROMPT, user_content)
    score = result.get("score")
    try:
        score = max(0, min(100, int(score)))
    except (TypeError, ValueError):
        score = None
    findings = result.get("findings") or []
    logger.info(f"AI contract risk review: score={score}, findings={len(findings)}")
    return {"score": score, "findings": findings}
