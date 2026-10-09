"""AI Contract Copilot — soạn thảo hợp đồng + chấm điểm rủi ro via OpenAI-compatible API.

Tách khỏi supabase_contract_service.py (CRUD) theo đúng cách ai_comment_service.py tách
khỏi các service khác — 2 lệnh gọi AI độc lập, không đọc/ghi DB trực tiếp (nhận dữ liệu
deal/quote đã load sẵn từ router, trả kết quả để router/FE quyết định lưu hay không)."""

from __future__ import annotations

import json
import os
import re

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
    "(giữ nguyên văn tiêu đề, chỉ viết phần body). ĐIỀU 1: KHÔNG ghi tên, mã số thuế, địa chỉ hay người đại diện "
    "của các bên — hệ thống tự chèn khối thông tin hai bên ở đầu Điều 1; chỉ viết 1-2 câu về năng lực pháp lý và căn cứ ký kết. "
    "Tuyệt đối không bịa số liệu hay thông tin không có trong dữ liệu được cung cấp. Bên A là khách hàng (bên sử dụng dịch vụ), "
    "Bên B là bên cung cấp dịch vụ: "
    + " | ".join(_CANONICAL_CLAUSE_TITLES)
    + '. Luôn trả về DUY NHẤT 1 JSON object dạng '
    '{"clauses": [{"title": "...", "body": "..."}]} với đúng 7 phần tử theo thứ tự trên, '
    "không thêm giải thích, không markdown."
)

_REFINE_SYSTEM_PROMPT = (
    "Bạn là luật sư chỉnh sửa hợp đồng cung cấp dịch vụ tại Việt Nam. Bạn nhận nội dung hợp đồng "
    "hiện tại (7 điều khoản) và danh sách rủi ro pháp chế vừa phát hiện. Hãy VIẾT LẠI phần body của "
    "TỪNG điều khoản để khắc phục các rủi ro đó (bổ sung nội dung còn thiếu, sửa số liệu sai lệch), "
    "giữ nguyên đúng 7 tiêu đề đã cho, không đổi thứ tự. Khối thông tin hai bên (BÊN A / BÊN B) ở đầu ĐIỀU 1 do hệ thống quản lý: "
    "không viết lại, không đưa vào body bạn trả về. Luôn trả về DUY NHẤT 1 JSON object dạng "
    '{"clauses": [{"title": "...", "body": "..."}]} với đúng 7 phần tử, không thêm giải thích, không markdown.'
)

_REVIEW_SYSTEM_PROMPT = (
    "Bạn là chuyên viên pháp chế rà soát rủi ro hợp đồng. So sánh nội dung điều khoản với "
    "báo giá gốc và điều khoản chuẩn công ty; phát hiện thiếu sót, sai lệch giá trị/thanh toán, "
    "hoặc rủi ro pháp lý. Trong khối thông tin hai bên, dấu '……' nghĩa là thông tin chưa có: chỉ báo thiếu ĐÚNG trường còn trống, "
    "không báo thiếu những trường đã có nội dung. Luôn trả về DUY NHẤT 1 JSON object dạng "
    '{"score": <0-100>, "findings": [{"severity": "ok"|"warn", "title": "...", "detail": "..."}]}, '
    "không thêm giải thích, không markdown. score 100 = an toàn tuyệt đối, càng nhiều rủi ro càng thấp."
)


# Contract Copilot dung proxy.markeeai.com (model cc/claude-*) qua bien moi truong RIENG,
# de khong anh huong cac tinh nang AI khac dang dung chung OPENAI_* (ai_comment, deal_ai_parse...).
# Khong dat bien rieng -> roi ve OPENAI_* nhu cu.
def _cfg() -> tuple[str, str, str]:
    api_key = os.getenv("CONTRACT_AI_API_KEY") or settings.openai_api_key
    base_url = (os.getenv("CONTRACT_AI_BASE_URL") or settings.openai_base_url).rstrip("/")
    model = os.getenv("CONTRACT_AI_MODEL") or settings.ai_model
    return api_key, base_url, model


def _require_api_key() -> str:
    api_key = _cfg()[0]
    if not api_key:
        raise RuntimeError("Chưa cấu hình CONTRACT_AI_API_KEY/OPENAI_API_KEY — không thể dùng AI Contract Copilot.")
    return api_key


# Model dự phòng (thử lần lượt, MỖI model 2 lượt).
# - Dùng proxy markeeai (đặt CONTRACT_AI_BASE_URL): thứ tự theo benchmark 08/10/2026:
#   sonnet-5 (số liệu đúng 9/9) -> sonnet-5-5 -> haiku-4-5 (rẻ nhất, thi thoảng bịa số).
# - Không đặt biến riêng: giữ NGUYÊN hành vi cũ (shopaikey, danh sách GPT, max_tokens 2000).
_FALLBACK_MODELS_PROXY = ["cc/claude-sonnet-5", "cc/claude-sonnet-5-5", "cc/claude-haiku-4-5-20251001"]
_FALLBACK_MODELS_LEGACY = ["gpt-4o-mini", "gpt-4o", "gpt-5-mini", "gpt-5", "gpt-4.1-mini", "gpt-4.1"]
_ATTEMPTS_PER_MODEL = 2


def _use_proxy() -> bool:
    return bool(os.getenv("CONTRACT_AI_BASE_URL"))


def _max_tokens() -> int:
    # 2000 làm bản soạn 7 điều khoản bị CẮT CỤT (finish_reason=length -> JSON hỏng) với model Claude.
    return 6000 if _use_proxy() else 2000


def _parse_json_lenient(content: str) -> dict:
    """Model Claude đôi khi viết 1 câu trước/sau JSON hoặc bọc ```json."""
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        text = re.sub(r"^```(?:json)?|```$", "", (content or "").strip(), flags=re.M).strip()
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1])  # ném JSONDecodeError nếu vẫn hỏng


async def _call_chat_json(system_prompt: str, user_content: str) -> dict:
    api_key = _require_api_key()
    _, base_url, primary_model = _cfg()
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    fallbacks = _FALLBACK_MODELS_PROXY if _use_proxy() else _FALLBACK_MODELS_LEGACY
    models_to_try = [primary_model] + [m for m in fallbacks if m != primary_model]

    data: dict | None = None
    last_error_text = ""
    async with httpx.AsyncClient(timeout=180.0) as client:
        for model in models_to_try:
            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "temperature": 0.4,
                "max_tokens": _max_tokens(),
                "response_format": {"type": "json_object"},
                # proxy.markeeai.com mặc định trả SSE; thiếu cờ này resp.json() sẽ vỡ.
                **({"stream": False} if _use_proxy() else {}),
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
                except (httpx.HTTPError, ValueError) as exc:
                    last_error_text = f"[{model}] {exc}"
                    logger.warning(f"AI model call errored, will retry/fallback: {last_error_text}")
            if data is not None:
                break
    if data is None:
        raise RuntimeError(f"Tất cả model AI đều không khả dụng lúc này (provider chập chờn). Lỗi gần nhất: {last_error_text}")
    content = data["choices"][0]["message"]["content"]
    try:
        return _parse_json_lenient(content)
    except json.JSONDecodeError as exc:
        logger.error(f"AI contract response is not valid JSON: {content[:500]!r}")
        raise RuntimeError("AI trả về dữ liệu không hợp lệ, vui lòng thử lại.") from exc


_BLANK = "………………………"


def _first(*values) -> str:
    for v in values:
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def build_parties(deal: dict | None, quote: dict | None, issuer: dict | None) -> dict:
    """Gom thông tin 2 bên từ dữ liệu THẬT: Bên A = khách (deal CRM, thiếu thì lấy từ form báo giá),
    Bên B = đơn vị phát hành báo giá (quote_issuer_companies). Thiếu thì để rỗng, KHÔNG bịa."""
    d = deal or {}
    data = (quote or {}).get("data") or {}
    i = issuer or {}
    return {
        "a": {
            "name": _first(d.get("company_name"), data.get("customerCompanyName")),
            "tax_code": _first(d.get("tax_code"), data.get("customerTaxCode")),
            "address": _first(d.get("address"), data.get("customerAddress")),
            "rep": _first(data.get("customerContactName"), d.get("customer_name")),
            "position": _first(d.get("position")),
            "phone": _first(d.get("phone"), data.get("customerPhone")),
            "email": _first(d.get("email"), data.get("customerEmail")),
        },
        "b": {
            "name": _first(i.get("legalName")),
            "tax_code": _first(i.get("taxCode")),
            "address": _first(i.get("address")),
            "rep": _first(i.get("contactName")),
            "position": "",
            "phone": _first(i.get("phone")),
            "email": _first(i.get("email")),
        },
    }


def format_parties_block(parties: dict) -> str:
    def side(title: str, p: dict) -> str:
        rep = p["rep"] or _BLANK
        if p["position"]:
            rep = f"{rep} — Chức vụ: {p['position']}"
        return (
            f"{title}: {p['name'] or _BLANK}\n"
            f"- Mã số thuế: {p['tax_code'] or _BLANK}\n"
            f"- Địa chỉ: {p['address'] or _BLANK}\n"
            f"- Đại diện/Người liên hệ: {rep}\n"
            f"- Điện thoại: {p['phone'] or _BLANK}    Email: {p['email'] or _BLANK}"
        )

    return side("BÊN A (Bên sử dụng dịch vụ)", parties["a"]) + "\n\n" + side("BÊN B (Bên cung cấp dịch vụ)", parties["b"])


def _split_parties_block(body: str) -> tuple[str, str]:
    """Điều 1 = khối thông tin hai bên (hệ thống chèn) + đoạn do AI viết."""
    body = body or ""
    if body.startswith("BÊN A") and "BÊN B" in body:
        end = body.find("Email:", body.find("BÊN B"))
        if end != -1:
            end = body.find("\n", end)
            end = len(body) if end == -1 else end
            return body[:end].strip(), body[end:].strip()
    return "", body.strip()


def _attach_parties(clauses: list[dict], block: str) -> list[dict]:
    if block and clauses:
        _, rest = _split_parties_block(clauses[0].get("body", ""))
        clauses[0]["body"] = block + ("\n\n" + rest if rest else "")
    return clauses


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
    issuer: dict | None = None,
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
    parties_block = format_parties_block(build_parties(deal, quote, issuer))
    user_content = (
        f"Loại hợp đồng: {template_labels.get(template_type, template_type)}\n"
        f"Mức độ chi tiết: {detail_level}\n\n"
        f"=== THÔNG TIN KHÁCH HÀNG (CRM) ===\n{_format_deal_context(deal)}\n\n"
        f"=== THÔNG TIN HAI BÊN (hệ thống tự chèn vào đầu Điều 1 — CHỈ để bạn hiểu ngữ cảnh, không chép lại) ===\n{parties_block}\n\n"
        f"=== BÁO GIÁ ĐÃ CHỐT ===\n{_format_quote_context(quote)}\n\n"
        f"=== ĐIỀU KHOẢN CHUẨN CÔNG TY (tham chiếu, không copy nguyên văn) ===\n{_STANDARD_TERMS}\n\n"
        f"{reference_section}"
        f"=== YÊU CẦU THÊM TỪ SALE ===\n{extra_prompt or '(không có)'}"
    )
    result = await _call_chat_json(_DRAFT_SYSTEM_PROMPT, user_content)
    clauses = _attach_parties(_normalize_to_canonical(result.get("clauses") or []), parties_block)
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
    kept_block, _ = _split_parties_block(clauses[0].get("body", "")) if clauses else ("", "")
    clauses_text = "\n\n".join(f"{c.get('title', '')}\n{c.get('body', '')}" for c in clauses)
    findings_text = "\n".join(f"- [{f.get('severity')}] {f.get('title')}: {f.get('detail')}" for f in findings)
    user_content = (
        f"=== NỘI DUNG HỢP ĐỒNG HIỆN TẠI ===\n{clauses_text}\n\n"
        f"=== RỦI RO CẦN KHẮC PHỤC ===\n{findings_text or '(không có)'}\n\n"
        f"=== ĐIỀU KHOẢN CHUẨN CÔNG TY (tham chiếu để sửa đúng) ===\n{_STANDARD_TERMS}"
    )
    result = await _call_chat_json(_REFINE_SYSTEM_PROMPT, user_content)
    refined = _attach_parties(_normalize_to_canonical(result.get("clauses") or []), kept_block)
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
