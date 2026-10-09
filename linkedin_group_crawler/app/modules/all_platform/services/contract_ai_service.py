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
_STANDARD_PAYMENT_TERM = "Thanh toán chuẩn (chỉ dùng khi báo giá KHÔNG có lịch thanh toán riêng): 50% khi ký, 30% khi bàn giao, 20% trong vòng 07 ngày sau nghiệm thu. "
_STANDARD_TERMS = (
    _STANDARD_PAYMENT_TERM +
    "Bảo mật: hai bên cam kết bảo mật thông tin kinh doanh/kỹ thuật trong và sau hợp đồng. "
    "Phạt chậm tiến độ: 0.1%/ngày trên giá trị hợp đồng, tối đa 8%. "
    "Chấm dứt: báo trước 30 ngày bằng văn bản nếu một bên vi phạm nghiêm trọng đã được nhắc nhở."
)
_NON_PAYMENT_STANDARD_TERMS = _STANDARD_TERMS[len(_STANDARD_PAYMENT_TERM):]


def _standard_terms_for(quote: dict | None) -> str:
    """Bỏ gợi ý 50/30/20 khi báo giá ĐÃ có lịch thanh toán riêng - tránh AI lẫn lộn giữa 2 lịch khác nhau (vd báo giá 40/60)."""
    return _NON_PAYMENT_STANDARD_TERMS if _quote_payment_plan(quote) else _STANDARD_TERMS

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
    "Tuyệt đối không bịa số liệu hay thông tin không có trong dữ liệu được cung cấp. Dữ liệu CRM/báo giá chỉ để bạn THAM KHẢO lấy số "
    "liệu đúng - KHÔNG chép nguyên văn định dạng liệt kê của dữ liệu đó vào điều khoản (vd không viết kiểu 'SL 1 x đơn giá X VND, VAT Y%'), "
    "hãy tự viết câu văn hợp đồng bằng văn phong pháp lý. Nếu báo giá có lịch thanh toán riêng (ghi rõ % từng đợt), Điều 3 PHẢI dùng ĐÚNG "
    "các đợt/tỷ lệ đó, KHÔNG tự đổi sang tỷ lệ khác. Bên A là khách hàng (bên sử dụng dịch vụ), "
    "Bên B là bên cung cấp dịch vụ: "
    + " | ".join(_CANONICAL_CLAUSE_TITLES)
    + ". Nếu \"YÊU CẦU THÊM TỪ SALE\" yêu cầu THÊM một hoặc nhiều điều khoản MỚI không nằm trong 7 điều khoản chuẩn trên "
    "(vd \"Thêm Điều 9: Quy định kiểm thử hệ thống trước nghiệm thu\"), PHẢI thêm các phần tử đó vào CUỐI mảng \"clauses\" "
    "(sau đúng 7 phần tử chuẩn) với \"title\" đúng như Sale ghi (hoặc tự đặt tiêu đề ngắn gọn nếu Sale không ghi rõ số điều) "
    "và \"body\" là nội dung điều khoản đó theo đúng yêu cầu - KHÔNG được bỏ qua yêu cầu thêm điều khoản này, KHÔNG gộp nội "
    "dung đó vào 1 trong 7 điều khoản chuẩn. Luôn trả về DUY NHẤT 1 JSON object dạng "
    '{"clauses": [{"title": "...", "body": "..."}]} với ĐÚNG 7 phần tử chuẩn theo thứ tự trên LÀM ĐẦU, cộng thêm các điều '
    "khoản mới (nếu có) ở cuối, không thêm giải thích, không markdown."
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
    "không báo thiếu những trường đã có nội dung. Mỗi finding PHẢI có thêm trường \"clause\": chép LẠI NGUYÊN VĂN đúng dòng "
    "tiêu đề 'ĐIỀU n. ...' (lấy từ chính nội dung bên dưới) mà finding đó nói tới, để hệ thống mở đúng điều khoản cho người "
    "dùng sửa ngay - nếu rủi ro không thuộc riêng 1 điều khoản nào (vd thiếu thông tin pháp lý chung) thì để \"clause\": \"\". "
    "Luôn trả về DUY NHẤT 1 JSON object dạng "
    '{"score": <0-100>, "findings": [{"severity": "ok"|"warn", "title": "...", "detail": "...", "clause": "ĐIỀU n. ..."}]}, '
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


def resolve_representative(deal: dict | None, override: dict | None = None) -> dict:
    """'Người đại diện ký' Bên A là vai trò nghiệp vụ RIÊNG - KHÔNG mặc nhiên là Người liên hệ của Deal/Quote.
    - override (Sale đã chọn/nhập và XÁC NHẬN ở Copilot): luôn thắng, confirmed=True.
    - Không override: gợi ý từ Contact đã gắn với Deal (deal['contact_name'] do enrich_deal() điền) -
      CHỈ LÀ GỢI Ý, confirmed=False, phải được xác nhận trước khi gửi duyệt/ký (xem contract_approval_service).
    - Khách hàng CÁ NHÂN (không company_name/tax_code) và chưa gắn Contact nào: chính khách hàng là người ký,
      confirmed=True (không có ai khác để chọn, không phải suy đoán)."""
    d = deal or {}
    if override and str(override.get("name") or "").strip():
        return {
            "name": override["name"], "position": override.get("position") or "", "phone": override.get("phone") or "",
            "email": override.get("email") or "", "contact_id": override.get("contact_id"), "confirmed": True, "source": "override",
        }
    is_individual = d.get("customer_kind") == "individual"
    contact_name = str(d.get("contact_name") or "").strip()
    if contact_name:
        return {
            "name": contact_name, "position": d.get("position") or "", "phone": d.get("phone") or "", "email": d.get("email") or "",
            "contact_id": d.get("contact_id"), "confirmed": False, "source": "contact",
        }
    if is_individual and str(d.get("customer_name") or "").strip():
        return {
            "name": d["customer_name"], "position": "", "phone": d.get("phone") or "", "email": d.get("email") or "",
            "contact_id": None, "confirmed": True, "source": "individual_self",
        }
    return {"name": "", "position": "", "phone": "", "email": "", "contact_id": None, "confirmed": False, "source": None}


def build_parties(deal: dict | None, quote: dict | None, issuer: dict | None, representative: dict | None = None) -> dict:
    """Gom thông tin 2 bên từ dữ liệu THẬT: Bên A = khách (deal CRM, thiếu thì lấy từ form báo giá),
    Bên B = đơn vị phát hành báo giá (quote_issuer_companies). Thiếu thì để rỗng, KHÔNG bịa.
    representative: người đại diện ký Bên A đã xác nhận (xem resolve_representative) - None thì tự suy ra mặc định."""
    d = deal or {}
    data = (quote or {}).get("data") or {}
    i = issuer or {}
    rep = representative if representative is not None else resolve_representative(d)
    return {
        "a": {
            "name": _first(d.get("company_name"), data.get("customerCompanyName")),
            "tax_code": _first(d.get("tax_code"), data.get("customerTaxCode")),
            "address": _first(d.get("address"), data.get("customerAddress")),
            "rep": _first(rep.get("name"), data.get("customerContactName")),
            "position": _first(rep.get("position"), d.get("position")),
            "phone": _first(rep.get("phone"), d.get("phone"), data.get("customerPhone")),
            "email": _first(rep.get("email"), d.get("email"), data.get("customerEmail")),
        },
        "b": {
            "name": _first(i.get("legalName")),
            "tax_code": _first(i.get("taxCode")),
            "address": _first(i.get("address")),
            "rep": _first(i.get("contactName")),
            "position": _first(i.get("positionLabel")),
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


def _quote_payment_plan(quote: dict | None) -> list[dict] | None:
    """Lịch thanh toán THẬT Sale đã nhập trên báo giá (quote.data.paymentPlan - % mỗi đợt). None nếu báo giá không có lịch riêng -
    lúc đó mới dùng điều khoản chuẩn công ty (50/30/20) làm gợi ý mặc định."""
    plan = ((quote or {}).get("data") or {}).get("paymentPlan")
    return plan if isinstance(plan, list) and plan else None


def _format_quote_context(quote: dict | None) -> str:
    from app.modules.all_platform.services.contract_docx_builder import money

    if not quote:
        return "Chưa có báo giá đính kèm."
    currency = quote.get("currency", "VND")
    items = quote.get("items") or []
    lines = []
    for i in items[:20]:
        vat_rate = i.get("vatRate") or 0
        line_total = i.get("totalAmount") if i.get("totalAmount") is not None else i.get("amountAfterDiscount")
        lines.append(
            f"- {i.get('description')}: SL {i.get('quantity')} x đơn giá trước thuế {money(i.get('unitPrice'), currency)} "
            f"{currency}, VAT {vat_rate}%, thành tiền ĐÃ GỒM VAT {money(line_total, currency)} {currency}"
        )
    totals = (
        f"Trước thuế: {money(quote.get('subtotalAmount'), currency)} {currency}. "
        f"VAT: {money(quote.get('vatAmount'), currency)} {currency}. "
        f"Tổng thanh toán: {money(quote.get('totalAmount'), currency)} {currency}."
    )
    plan = _quote_payment_plan(quote)
    plan_text = (
        "Lịch thanh toán của báo giá này: "
        + "; ".join(f"{p.get('phase') or f'Đợt {i + 1}'}: {p.get('percent')}%" + (f" ({p.get('condition')})" if p.get("condition") else "")
                    for i, p in enumerate(plan))
    ) if plan else "Báo giá này không có lịch thanh toán riêng."
    return (
        f"Báo giá {quote.get('quoteNumber')} — tổng giá trị {money(quote.get('totalAmount'), currency)} {currency}, "
        f"trạng thái: {quote.get('status')}.\nHạng mục:\n" + "\n".join(lines) + f"\n{totals}\n{plan_text}"
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
    representative: dict | None = None,
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
    parties_block = format_parties_block(build_parties(deal, quote, issuer, representative))
    user_content = (
        f"Loại hợp đồng: {template_labels.get(template_type, template_type)}\n"
        f"Mức độ chi tiết: {detail_level}\n\n"
        f"=== THÔNG TIN KHÁCH HÀNG (CRM) ===\n{_format_deal_context(deal)}\n\n"
        f"=== THÔNG TIN HAI BÊN (hệ thống tự chèn vào đầu Điều 1 — CHỈ để bạn hiểu ngữ cảnh, không chép lại) ===\n{parties_block}\n\n"
        f"=== BÁO GIÁ ĐÃ CHỐT ===\n{_format_quote_context(quote)}\n\n"
        f"=== ĐIỀU KHOẢN CHUẨN CÔNG TY (tham chiếu, không copy nguyên văn) ===\n{_standard_terms_for(quote)}\n\n"
        f"{reference_section}"
        f"=== YÊU CẦU THÊM TỪ SALE ===\n{extra_prompt or '(không có)'}"
    )
    result = await _call_chat_json(_DRAFT_SYSTEM_PROMPT, user_content)
    clauses = _attach_parties(_normalize_to_canonical(result.get("clauses") or []), parties_block)
    logger.info(f"AI contract draft generated: {len(clauses)} clauses")
    return clauses


def _normalize_to_canonical(clauses: list[dict]) -> list[dict]:
    """Ép 7 điều khoản ĐẦU về đúng 7 điều khoản chuẩn theo _CANONICAL_CLAUSE_TITLES, đúng thứ tự — phòng khi AI trả
    thiếu/thừa/sai thứ tự (model rẻ tiền đôi khi không tuân thủ hoàn toàn instruction). Khớp theo TIÊU ĐỀ trước (AI có
    thể trả đủ 7 tiêu đề chuẩn nhưng đảo thứ tự); không khớp được tiêu đề thì mới fallback theo VỊ TRÍ như cũ.
    QUAN TRỌNG: điều khoản THÊM ngoài 7 mục chuẩn (Sale yêu cầu "Thêm Điều 9: ...") phải được GIỮ LẠI, nối vào cuối -
    bản cũ cắt cứng về đúng 7 phần tử làm yêu cầu thêm điều khoản của Sale bị ÂM THẦM BỎ QUA dù AI đã soạn đúng
    (bug "Bước 2 không ăn yêu cầu")."""
    by_title: dict[str, dict] = {}
    extras: list[dict] = []
    for c in clauses:
        title = str(c.get("title") or "").strip()
        if title in _CANONICAL_CLAUSE_TITLES and title not in by_title:
            by_title[title] = c
        else:
            extras.append(c)
    out = []
    for i, canonical_title in enumerate(_CANONICAL_CLAUSE_TITLES):
        if canonical_title in by_title:
            body = by_title[canonical_title].get("body", "")
        else:
            body = clauses[i].get("body", "") if i < len(clauses) else ""
        out.append({"id": "", "title": canonical_title, "body": body})
    for c in extras:
        title = str(c.get("title") or "").strip()
        body = str(c.get("body") or "").strip()
        if (title or body) and title not in _CANONICAL_CLAUSE_TITLES:
            out.append({"id": "", "title": title or "Điều khoản bổ sung", "body": body})
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
        f"=== ĐIỀU KHOẢN CHUẨN CÔNG TY ===\n{_standard_terms_for(quote)}"
    )
    result = await _call_chat_json(_REVIEW_SYSTEM_PROMPT, user_content)
    score = result.get("score")
    try:
        score = max(0, min(100, int(score)))
    except (TypeError, ValueError):
        score = None
    findings = result.get("findings") or []
    # Dam bao field "clause" luon co (du AI quen dien) - FE dua vao field nay de quyet dinh co hien nut "Xem & xu ly" hay
    # khong, khong duoc de KeyError lam vo man hinh Legal Check.
    for f in findings:
        f["clause"] = str(f.get("clause") or "").strip()
    # Kiểm tra bằng SỐ HỌC (Decimal), KHÔNG để AI tự tính/tự xác nhận lệch tài chính - tách riêng khỏi "findings" (ý kiến AI,
    # chưa xác minh) để FE hiển thị khác nhau, và ĐIỂM không được mâu thuẫn với lỗi tài chính đã xác nhận ở đây.
    verified_findings = _verify_contract_financials(quote, contract_value)
    if any(f["severity"] == "error" for f in verified_findings):
        score = min(score, 30) if score is not None else 30
    logger.info(f"AI contract risk review: score={score}, findings={len(findings)}, verified={len(verified_findings)}")
    return {"score": score, "findings": findings, "verifiedFindings": verified_findings}


def _verify_contract_financials(quote: dict | None, contract_value: float | None) -> list[dict]:
    """Đối chiếu giá trị hợp đồng khai báo với TỔNG BÁO GIÁ THẬT bằng Decimal - không qua AI. Chỉ báo khi có đủ dữ liệu cả 2 phía;
    dung sai 0.5 (làm tròn). severity='error' = lệch xác nhận (ảnh hưởng điểm rủi ro), không trả gì nếu khớp."""
    from decimal import Decimal, InvalidOperation

    if not quote or contract_value is None:
        return []
    quote_total = quote.get("totalAmount")
    if quote_total is None:
        return []
    try:
        cv, qt = Decimal(str(contract_value)), Decimal(str(quote_total))
    except InvalidOperation:
        return []
    delta = cv - qt
    if abs(delta) <= Decimal("0.5"):
        return []
    currency = quote.get("currency") or "VND"
    return [{
        "severity": "error",
        "title": "Giá trị hợp đồng không khớp tổng báo giá (đã xác minh bằng số liệu thật)",
        "detail": f"Hợp đồng khai báo {cv:,.0f} {currency}, báo giá {quote.get('quoteNumber') or ''} có tổng {qt:,.0f} {currency} — chênh lệch {delta:+,.0f} {currency}.",
        "field": "contractValue", "contractValue": float(cv), "quoteValue": float(qt), "delta": float(delta),
    }]


# ───────────────────────── Chỉnh sửa MẪU DOCX: AI chỉ ĐỀ XUẤT, document engine mới là bên áp thay đổi ─────────────────────────

_TEMPLATE_EDIT_SYSTEM_PROMPT = (
    "Bạn là luật sư rà soát một hợp đồng MẪU đã có sẵn bố cục. Bạn nhận danh sách đoạn văn (id + nội dung) của mẫu, dữ liệu CRM "
    "và yêu cầu của Sale. Chỉ đề xuất sửa những đoạn THỰC SỰ cần đổi để điền thông tin khách hàng/hạng mục và thực hiện đúng yêu cầu "
    "của Sale. QUY TẮC CHO \"edits\" (sửa nội dung đoạn CÓ SẴN): (1) giữ nguyên số thứ tự điều/khoản ('Điều 3.', '3.1'...) và cấu trúc câu "
    "của đoạn nếu không cần đổi; (2) KHÔNG được tự thêm/đổi số tiền, tỷ lệ %, VAT, ngày tháng, thông tin pháp lý nếu không có trong dữ liệu "
    "CRM hoặc yêu cầu của Sale; (3) KHÔNG để trống nội dung (xoá cả điều khoản thì dùng \"deletes\" bên dưới, không xoá bằng cách để "
    "\"edits\" rỗng); (4) không đụng vào đoạn không cần sửa; (5) dữ liệu CRM/báo giá chỉ để THAM KHẢO lấy đúng số liệu - KHÔNG chép nguyên "
    "văn định dạng liệt kê của dữ liệu đó vào đoạn (vd không viết kiểu 'SL 1 x đơn giá X VND, VAT Y%'), phải tự viết câu văn hợp đồng; nếu "
    "báo giá có lịch thanh toán riêng thì dùng ĐÚNG tỷ lệ đó, không tự đổi; (6) BẮT BUỘC PHẢI SỬA mọi đoạn nêu cụ thể phí dịch vụ/giá trị "
    "hợp đồng của mẫu (kể cả viết bằng chữ trong ngoặc, vd '(Bằng chữ: Năm triệu đồng)') nếu số đó khác với tổng tiền thật của báo giá đang "
    "dùng để tạo hợp đồng này - mẫu là hợp đồng CŨ của khách khác nên số tiền cũ trong mẫu LUÔN phải thay bằng số tiền báo giá mới (cả số và "
    "phần viết bằng chữ), đây KHÔNG phải trường hợp 'đoạn không cần sửa' ở quy tắc (4).\n"
    "NẾU YÊU CẦU CỦA SALE MUỐN THÊM ĐIỀU KHOẢN MỚI (vd \"Thêm Điều 9: ...\"): PHẢI thêm 1 phần tử vào \"inserts\" - KHÔNG được bỏ qua, "
    "KHÔNG được nhét nội dung đó vào 1 đoạn \"edits\" có sẵn. Mỗi phần tử \"inserts\": {\"after_id\": \"p12\", \"title\": \"ĐIỀU 9. TÊN ĐIỀU "
    "KHOẢN\", \"body\": \"nội dung điều khoản, có thể nhiều dòng cách nhau bằng \\n\"} - \"after_id\" là id đoạn SẼ NẰM NGAY TRƯỚC điều khoản "
    "mới (chọn đoạn cuối cùng của điều khoản liền trước nếu Sale không nói rõ vị trí chèn vào đâu; dùng \"start\" nếu muốn chèn vào đầu tài "
    "liệu). \"title\" dùng ĐÚNG số điều Sale yêu cầu nếu có ghi rõ, hệ thống sẽ TỰ ĐÁNH SỐ LẠI tuần tự nếu cần nên không phải lo trùng số. "
    "KHÔNG tự bịa số liệu trong \"body\" giống quy tắc (2).\n"
    "NẾU YÊU CẦU CỦA SALE MUỐN XOÁ HẲN 1 ĐIỀU KHOẢN (không phải sửa nội dung): thêm 1 phần tử vào \"deletes\" dạng {\"ids\": [\"p30\", "
    "\"p31\"]} liệt kê ĐỦ id của TẤT CẢ đoạn thuộc điều khoản đó (từ dòng tiêu đề 'ĐIỀU n.' tới hết các đoạn con của nó, không xoá đoạn của "
    "điều khoản khác).\n"
    'Trả DUY NHẤT 1 JSON object dạng {"edits": [{"id": "p12", "text": "nội dung mới của cả đoạn", "reason": "lý do ngắn"}], '
    '"inserts": [{"after_id": "p12", "title": "...", "body": "...", "reason": "lý do ngắn"}], "deletes": [{"ids": ["p30"], "reason": "lý do ngắn"}]}. '
    'Không có gì cần sửa/thêm/xoá thì trả mảng rỗng cho từng mục tương ứng. Không markdown.'
)

_NUM_TOKEN = re.compile(r"\d[\d\.,]*\d%?|\d%?")
_SMALL_INT_WITH_UNIT = re.compile(r"\b\d{1,2}\s*(?:ngày|tháng|năm|giờ|lần|đồng|vnđ|vnd|usd)\b", re.I)


def numeric_tokens(text: str) -> set[str]:
    """Số 'nhạy cảm' cần đối chiếu: có %, có dấu phân cách, >= 3 chữ số, hoặc số nhỏ đi kèm đơn vị (ngày/tháng/đồng...).
    Số thứ tự đơn thuần ('Điều 3', 'đợt 2', '03 đợt') không bị coi là số liệu."""
    tokens = set()
    for t in _NUM_TOKEN.findall(text or ""):
        t = t.rstrip(".,")
        if t.endswith("%"):
            t = t.replace(",", ".")                          # 0,1% == 0.1%
        digits = re.sub(r"\D", "", t)
        if t.endswith("%") or len(digits) >= 3 or any(ch in t for ch in ".,"):
            tokens.add(t)
    for m in _SMALL_INT_WITH_UNIT.finditer(text or ""):
        tokens.add(re.sub(r"\s+", " ", m.group(0).lower()))
    return tokens


def validate_template_edits(
    edits: list[dict], paragraphs: dict[str, str], allowed_context: str,
) -> tuple[list[dict], list[dict]]:
    """Chặn đề xuất AI vi phạm an toàn: id lạ, rỗng/xoá nội dung, hoặc xuất hiện SỐ không có trong đoạn gốc/CRM/yêu cầu Sale.
    Trả (chấp nhận, từ chối kèm lý do)."""
    allowed = numeric_tokens(allowed_context)
    ok: list[dict] = []
    rejected: list[dict] = []
    for e in edits or []:
        pid, new = str(e.get("id") or ""), str(e.get("text") or "")
        if pid not in paragraphs:
            rejected.append({"id": pid, "reason": "id đoạn không tồn tại trong mẫu"})
            continue
        old = paragraphs[pid]
        if not new.strip():
            rejected.append({"id": pid, "reason": "không cho phép xoá/để trống nội dung đoạn"})
            continue
        if new == old:
            continue
        dropped = set(re.findall(r"\{\{\s*[A-Za-z0-9_\.]+\s*\}\}", old)) - set(re.findall(r"\{\{\s*[A-Za-z0-9_\.]+\s*\}\}", new))
        if dropped:
            rejected.append({"id": pid, "reason": "không được xoá/thay placeholder chưa có dữ liệu: " + ", ".join(sorted(dropped))})
            continue
        unknown = numeric_tokens(new) - numeric_tokens(old) - allowed
        if unknown:
            rejected.append({"id": pid, "reason": f"chứa số liệu không có trong CRM/yêu cầu: {', '.join(sorted(unknown))}"})
            continue
        if len(new) > max(4 * len(old), len(old) + 800):
            rejected.append({"id": pid, "reason": "nội dung mới dài bất thường so với đoạn gốc"})
            continue
        ok.append({"id": pid, "text": new, "reason": str(e.get("reason") or "")})
    return ok, rejected


def validate_template_inserts(
    inserts: list[dict], paragraphs: dict[str, str], allowed_context: str,
) -> tuple[list[dict], list[dict]]:
    """Chặn đề xuất CHÈN điều khoản mới vi phạm an toàn: vị trí chèn (after_id) không tồn tại, không có nội dung, hoặc
    chứa SỐ không có trong CRM/yêu cầu Sale. Trả (chấp nhận, từ chối kèm lý do)."""
    allowed = numeric_tokens(allowed_context)
    ok: list[dict] = []
    rejected: list[dict] = []
    for ins in inserts or []:
        after_id = str(ins.get("after_id") or "start")
        if after_id != "start" and after_id not in paragraphs:
            rejected.append({"after_id": after_id, "reason": "vị trí chèn (after_id) không tồn tại trong mẫu"})
            continue
        title = str(ins.get("title") or "").strip()
        body = str(ins.get("body") or "").strip()
        if not title and not body:
            rejected.append({"after_id": after_id, "reason": "điều khoản mới không có nội dung"})
            continue
        unknown = numeric_tokens(f"{title}\n{body}") - allowed
        if unknown:
            rejected.append({"after_id": after_id, "reason": f"chứa số liệu không có trong CRM/yêu cầu: {', '.join(sorted(unknown))}"})
            continue
        ok.append({"after_id": after_id, "title": title, "body": body, "reason": str(ins.get("reason") or "")})
    return ok, rejected


def validate_template_deletes(deletes: list[dict], paragraphs: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """Chặn đề xuất XOÁ điều khoản vi phạm an toàn: id đoạn không tồn tại trong mẫu. Trả (chấp nhận, từ chối kèm lý do)."""
    ok: list[dict] = []
    rejected: list[dict] = []
    for d in deletes or []:
        ids = [str(i) for i in (d.get("ids") or [])]
        invalid_ids = [i for i in ids if i not in paragraphs]
        if invalid_ids:
            rejected.append({"ids": ids, "reason": "id đoạn không tồn tại trong mẫu: " + ", ".join(invalid_ids)})
            continue
        valid_ids = [i for i in ids if i in paragraphs]
        if not valid_ids:
            continue
        ok.append({"ids": valid_ids, "reason": str(d.get("reason") or "")})
    return ok, rejected


async def propose_template_edits(
    paragraphs: list[tuple[str, str]], deal: dict | None, quote: dict | None, extra_prompt: str | None,
) -> dict:
    """paragraphs: [(id, text)] CHỈ các đoạn không nằm trong bảng. Trả đề xuất thô dạng {"edits", "inserts", "deletes"} -
    phải qua validate_template_edits/validate_template_inserts/validate_template_deletes trước khi áp dụng.
    (Trước đây chỉ trả "edits" - AI không có cách nào đề xuất THÊM/XOÁ cả điều khoản, khiến yêu cầu kiểu "Thêm Điều 9"
    của Sale không thể thực hiện được trong chế độ dùng mẫu DOCX dù prompt đã nhận đúng yêu cầu - bug "Bước 2 không ăn
    yêu cầu". render_from_template() tự nhận diện callable `propose` cũ trả list thuần (test fake) để tương thích ngược.)"""
    listing = "\n".join(f"[{pid}] {text}" for pid, text in paragraphs)[:24000]
    user_content = (
        f"=== CÁC ĐOẠN CỦA MẪU HỢP ĐỒNG ===\n{listing}\n\n"
        f"=== THÔNG TIN KHÁCH HÀNG (CRM) ===\n{_format_deal_context(deal)}\n\n"
        f"=== BÁO GIÁ ĐÃ CHỐT ===\n{_format_quote_context(quote)}\n\n"
        f"=== YÊU CẦU TỪ SALE ===\n{extra_prompt or '(không có)'}"
    )
    result = await _call_chat_json(_TEMPLATE_EDIT_SYSTEM_PROMPT, user_content)
    return {
        "edits": list(result.get("edits") or []),
        "inserts": list(result.get("inserts") or []),
        "deletes": list(result.get("deletes") or []),
    }


_CLAUSE_EDIT_SYSTEM_PROMPT = (
    "Bạn là luật sư chỉnh sửa MỘT điều khoản/đoạn của hợp đồng theo đúng yêu cầu của người dùng. Chỉ sửa phần được yêu cầu, giữ nguyên số thứ tự "
    "điều/khoản, giọng văn và phần còn lại của đoạn. KHÔNG tự thêm hay đổi số tiền, tỷ lệ %, VAT, thời hạn, ngày tháng, thông tin pháp lý nếu người dùng "
    "không yêu cầu hoặc không có trong dữ liệu CRM được cung cấp. KHÔNG viết lại các đoạn khác. Dữ liệu CRM/báo giá chỉ để THAM KHẢO lấy "
    "đúng số liệu - KHÔNG chép nguyên văn định dạng liệt kê của dữ liệu đó vào đoạn, phải tự viết câu văn hợp đồng. "
    'Trả DUY NHẤT 1 JSON object dạng {"text": "nội dung MỚI của cả đoạn", "reason": "tóm tắt đã sửa gì"}. Không markdown.'
)


async def propose_clause_edit(text: str, instruction: str, neighbors: str, deal: dict | None, quote: dict | None) -> dict:
    """AI chỉ ĐỀ XUẤT nội dung mới cho đúng 1 đoạn/điều khoản; backend kiểm tra rủi ro (edit_risk_flags) rồi người dùng mới duyệt áp dụng."""
    user_content = (
        f"=== ĐOẠN/ĐIỀU KHOẢN CẦN SỬA ===\n{text}\n\n"
        f"=== NGỮ CẢNH XUNG QUANH (chỉ để hiểu, không sửa) ===\n{neighbors or '(không có)'}\n\n"
        f"=== DỮ LIỆU CRM ===\n{_format_deal_context(deal)}\n{_format_quote_context(quote)}\n\n"
        f"=== YÊU CẦU CHỈNH SỬA CỦA NGƯỜI DÙNG ===\n{instruction}"
    )
    result = await _call_chat_json(_CLAUSE_EDIT_SYSTEM_PROMPT, user_content)
    return {"text": str(result.get("text") or "").strip(), "reason": str(result.get("reason") or "")}
