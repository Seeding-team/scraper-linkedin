"""Đối chiếu hợp đồng scan/PDF với báo giá đã chốt — "Ghi nhận hợp đồng có sẵn"
(RegisterExternalContractModal.tsx), phần OCR trước đây chỉ là placeholder
("Đối chiếu tự động qua OCR chưa khả dụng").

Tái sử dụng ĐÚNG hạ tầng AI-parsing đã có (vendor_ai_parse_service.py) thay vì
dựng 1 pattern AI mới:
  - PDF có text đọc được: dùng lại VendorAIParsingService.extract_from_pdf()
    (pdfplumber, không cần AI) rồi gửi text cho Gemini nếu có GEMINI_API_KEY,
    nếu không thì gửi cho OpenAI-compatible (chat/completions, dùng
    OPENAI_API_KEY/OPENAI_BASE_URL/AI_MODEL - _extract_via_openai_text()).
  - PDF scan ảnh (text quá ngắn) hoặc ảnh (PNG/JPG): luôn cần AI vision
    (không có Tesseract/pytesseract trong repo này) - CHỈ Gemini hỗ trợ
    đường này hiện tại (gửi thẳng file/ảnh); OpenAI chưa nối cho vision vì
    AI_MODEL đang cấu hình (gpt-3.5-turbo) không đọc được ảnh.
  - Tier cuối cùng (không có AI nào chạy được) là regex/heuristic thuần
    Python, tìm số hợp đồng / ngày ký / các mốc tiền VND theo các từ khoá
    tiếng Việt phổ biến trong hợp đồng - PHẢI thật, không phải stub.

KHÔNG bịa số liệu ở bất kỳ tier nào - nếu không trích xuất được, trả về
extractable=False, tất cả field None, KHÔNG đoán/không dùng giá trị mặc định.

KHÔNG sửa vendor_ai_parse_service.py - chỉ import lại các static method của
VendorAIParsingService (extract_from_pdf) để tránh viết lại logic pdfplumber."""

from __future__ import annotations

import json
import logging
import re

import google.generativeai as genai
import httpx

from app.core.config import settings
from app.modules.all_platform.services.vendor_ai_parse_service import VendorAIParsingService

logger = logging.getLogger(__name__)

# Ngưỡng "text quá ngắn coi như PDF scan ảnh, pdfplumber không đọc được chữ" -
# 40 ký tự là mốc rất thấp (1-2 dòng), đủ để phân biệt "có text thật" khỏi
# "trắng/rỗng do PDF chỉ là ảnh chụp" mà không loại nhầm hợp đồng ngắn thật.
_MIN_TEXT_LEN_FOR_HEURISTIC = 40

CONTRACT_SYSTEM_PROMPT = """Bạn là trợ lý AI chuyên trích xuất thông tin ĐẦU MỤC/TỔNG TIỀN từ văn bản hợp đồng
tiếng Việt (không phải bảng hàng hoá chi tiết).

CHỈ trả về JSON object hợp lệ, KHÔNG có markdown block hay giải thích gì thêm, đúng hình dạng:
{
  "contract_number": string hoặc null (Số hợp đồng, vd "12/2026/HĐKT"),
  "signed_at": string hoặc null (Ngày ký hợp đồng, định dạng YYYY-MM-DD),
  "subtotal_amount": number hoặc null (Giá trị hợp đồng TRƯỚC thuế/VAT, đơn vị VND),
  "vat_amount": number hoặc null (Tiền thuế GTGT/VAT, đơn vị VND),
  "total_amount": number hoặc null (Tổng giá trị hợp đồng SAU thuế/VAT, đơn vị VND)
}

Quy tắc:
1. Nếu không tìm thấy field nào trong văn bản, để null - KHÔNG được đoán hay tự tính.
2. Số tiền phải là number thuần (không có "đ", "VND", dấu chấm/phẩy phân cách).
3. Nếu văn bản chỉ có 1 mốc tiền duy nhất (không phân biệt trước/sau thuế), đặt vào total_amount, để subtotal_amount/vat_amount là null.
"""

# "AI Contract Review" (2026-10-26, Phan B2) - MO RONG trich xuat, KHONG thay the
# CONTRACT_SYSTEM_PROMPT cu (van giu nguyen cho extract_contract_summary() - noi
# khac con goi). Moi field THEM co kem "source_excerpt" (trich dan NGUYEN VAN tu
# van ban, dung de B4 dinh vi highlight) + "source_location" (ten "DIEU n" neu la
# hop dong co danh so dieu khoan, hoac null neu khong xac dinh duoc - KHONG doan).
EXTENDED_FIELDS_SYSTEM_PROMPT = """Bạn là trợ lý AI chuyên trích xuất thông tin quan trọng từ văn bản hợp đồng tiếng Việt.

CHỈ trả về JSON object hợp lệ, KHÔNG markdown/giải thích thêm, đúng hình dạng:
{
  "contract_number": string|null,
  "signed_at": string|null (YYYY-MM-DD),
  "subtotal_amount": number|null (VND, trước VAT),
  "vat_amount": number|null (VND),
  "total_amount": number|null (VND, sau VAT),
  "company_name": string|null (DEPRECATED - giữ để tương thích ngược, LUÔN điền giống party_a_name),
  "party_a_name": string|null (tên công ty của BÊN A - bên yêu cầu/mua dịch vụ, tức KHÁCH HÀNG - đây là bên cần đối chiếu với CRM, KHÔNG phải bên phát hành hợp đồng),
  "party_b_name": string|null (tên công ty của BÊN B - bên cung cấp dịch vụ/bán hàng, thường là chính công ty phát hành hợp đồng),
  "tax_code": string|null (mã số thuế CỦA BÊN A/khách hàng - không lấy MST của Bên B),
  "address": string|null (địa chỉ công ty ghi trong hợp đồng),
  "warranty_period": string|null (thời gian bảo hành, vd "12 tháng"),
  "payment_terms": string|null (tóm tắt điều khoản thanh toán - đợt/thời hạn),
  "delivery_terms": string|null (tóm tắt điều khoản bàn giao/giao hàng),
  "penalty_clause": string|null (tóm tắt điều khoản phạt vi phạm/bồi thường),
  "termination_clause": string|null (tóm tắt điều khoản chấm dứt hợp đồng),
  "validity_period": string|null (hiệu lực hợp đồng)
}

Với MỖI field (trừ contract_number/signed_at) tìm được, THÊM 1 field tương ứng "<field>_excerpt" chứa
ĐOẠN TRÍCH DẪN NGUYÊN VĂN (copy chính xác, không diễn giải lại) từ văn bản gốc chứng minh cho giá trị đó,
và 1 field "<field>_location" ghi tên điều khoản chứa đoạn đó nếu văn bản có đánh số kiểu "ĐIỀU n" (vd "ĐIỀU 4"),
nếu không xác định được điều khoản thì để null - KHÔNG đoán bừa.

Quy tắc bắt buộc:
1. Không tìm thấy -> để null. TUYỆT ĐỐI không bịa/suy đoán nội dung không có trong văn bản.
2. "<field>_excerpt" PHẢI là nguyên văn copy từ input, không được diễn giải/rút gọn/dịch.
3. Số tiền là number thuần, không đơn vị/dấu phân cách.
"""

_EXTENDED_FIELD_NAMES = (
    "company_name", "party_a_name", "party_b_name", "tax_code", "address", "warranty_period",
    "payment_terms", "delivery_terms", "penalty_clause", "termination_clause", "validity_period",
)


def _empty_result_full(method: str, extractable: bool) -> dict:
    base = _empty_result(method, extractable)
    for field in _EXTENDED_FIELD_NAMES:
        base[field] = None
        base[f"{field}_excerpt"] = None
        base[f"{field}_location"] = None
    return base


_TAX_CODE_RE = re.compile(r"(?:m[ãa]\s*s[ốô]\s*thu[ếe]|mst)\s*[:\-]?\s*([0-9]{10}(?:-[0-9]{3})?)", re.IGNORECASE)
# CHI dung de PARSE lai 1 chuoi DA BIET la gia tri bao hanh (vd contracts.warranty_period =
# "12 tháng" hoac warranty_period da trich xuat) thanh (so, don vi) de so sanh - KHONG dung truc
# tiep tren TOAN VAN BAN HOP DONG (xem _WARRANTY_LABEL_RE ben duoi cho viec do).
_WARRANTY_RE = re.compile(r"(\d+)\s*(tháng|ngày|năm)\s*(?:b[ảa]o\s*h[àa]nh)?", re.IGNORECASE)
# Label THAT "bảo hành" bat buoc phai co mat gan do (trong ~60 ky tu) - dung rieng khi trich xuat
# tu VAN BAN THO cua hop dong (BUG THAT DA GAP, xac nhan qua test voi HD/2026/0007 - hop dong nay
# KHONG HE co dieu khoan bao hanh nao, nhung _WARRANTY_RE.search(text) truoc day khop NHAM voi
# "10 tháng" trong cau "Hôm nay, ngày 10 tháng 06 năm 2026..." vi "bảo hành" trong pattern cu la
# OPTIONAL (?:...)?)  - bia ra 1 gia tri bao hanh hoan toan khong co that. Fix: tim label "bảo
# hành" TRUOC, roi moi tim so+don vi GAN no, giong het pattern _find_amount_near_labels() da dung
# cho tien).
_WARRANTY_LABEL_RE = re.compile(r"b[ảa]o\s*h[àa]nh", re.IGNORECASE)


def _extract_warranty_from_text(text: str) -> tuple[str | None, str | None]:
    """Tim '<so> <don vi>' CHI trong pham vi ~60 ky tu QUANH 1 lan xuat hien that cua label 'bảo
    hành' - tra ve (gia_tri, excerpt) hoac (None, None) neu khong co dieu khoan bao hanh nao trong
    van ban (KHONG bia, khac han loi cu da gap)."""
    for m_label in _WARRANTY_LABEL_RE.finditer(text):
        window_start = max(0, m_label.start() - 60)
        window_end = min(len(text), m_label.end() + 60)
        window = text[window_start:window_end]
        m_num = _WARRANTY_RE.search(window)
        if m_num:
            value = f"{m_num.group(1)} {m_num.group(2)}"
            excerpt_start = min(m_num.start(), m_label.start() - window_start)
            excerpt_end = max(m_num.end(), m_label.end() - window_start)
            excerpt = window[max(0, excerpt_start):excerpt_end].strip()
            return value, excerpt
    return None, None


def _fallback_parse_extended(text: str, base: dict) -> dict:
    """Heuristic tang cuoi cho cac field moi - CHI quy tac chac chan (ma so thue, bao hanh dang
    so+don vi), KHONG doan cac dieu khoan tu do (payment/delivery/penalty/termination) vi regex
    khong du tin cay cho van ban tu do - de None thay vi bia, dung nguyen tac "khong bia so lieu"
    da co san trong file nay."""
    result = {**base}
    m_tax = _TAX_CODE_RE.search(text)
    if m_tax:
        result["tax_code"] = m_tax.group(1)
        result["tax_code_excerpt"] = m_tax.group(0).strip()
    warranty_value, warranty_excerpt = _extract_warranty_from_text(text)
    if warranty_value:
        result["warranty_period"] = warranty_value
        result["warranty_period_excerpt"] = warranty_excerpt
    # (2026-10-28) Ben A = khach hang (dung de doi chieu CRM), Ben B = ben phat hanh hop dong -
    # xem _extract_party_name_near_label. "company_name" (cu, giu tuong thich nguoc) LUON = Ben A.
    party_a, party_a_excerpt = _extract_party_name_near_label(text, _PARTY_A_LABEL_RE)
    if party_a:
        result["party_a_name"] = party_a
        result["party_a_name_excerpt"] = party_a_excerpt
        result["company_name"] = party_a
        result["company_name_excerpt"] = party_a_excerpt
    party_b, party_b_excerpt = _extract_party_name_near_label(text, _PARTY_B_LABEL_RE)
    if party_b:
        result["party_b_name"] = party_b
        result["party_b_name_excerpt"] = party_b_excerpt
    return result


async def _extract_full_via_gemini_text(text: str) -> dict | None:
    if not _configure_gemini_if_needed():
        return None
    try:
        model = genai.GenerativeModel("gemini-flash-latest", system_instruction=EXTENDED_FIELDS_SYSTEM_PROMPT)
        response = model.generate_content(
            f"Trích xuất JSON từ nội dung hợp đồng sau:\n\n{text[:30000]}",
            generation_config={"temperature": 0.1},
        )
        return _parse_ai_json(response.text)
    except Exception as e:
        logger.error(f"Contract OCR (full): Gemini text extraction failed: {e}")
        return None


async def _extract_full_via_openai_text(text: str) -> dict | None:
    if not settings.openai_api_key:
        return None
    try:
        url = f"{settings.openai_base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
        body = {
            "model": settings.ai_model,
            "messages": [
                {"role": "system", "content": EXTENDED_FIELDS_SYSTEM_PROMPT},
                {"role": "user", "content": f"Trích xuất JSON từ nội dung hợp đồng sau:\n\n{text[:30000]}"},
            ],
            "temperature": 0.1,
            "max_tokens": 2000,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
        resp_text = resp.json()["choices"][0]["message"]["content"]
        return _parse_ai_json(resp_text)
    except Exception as e:
        logger.error(f"Contract OCR (full): OpenAI text extraction failed: {e}")
        return None


async def extract_contract_fields_full(text: str) -> dict:
    """Ham MOI (B2) - trich xuat day du field (so voi extract_contract_summary() cu chi co
    contract_number/signed_at/3 moc tien). Nhan THANG text da trich san (tai dung pipeline doc
    file co san o extract_contract_summary/_extract_docx_text/VendorAIParsingService.extract_from_pdf
    - KHONG viet lai logic doc file), vi ham nay chi lo phan "goi AI voi prompt moi + fallback
    heuristic cho field moi", tach biet voi logic chon tier theo dinh dang file."""
    if len(text.strip()) < _MIN_TEXT_LEN_FOR_HEURISTIC:
        return _empty_result_full("heuristic", False)
    if settings.gemini_api_key:
        parsed = await _extract_full_via_gemini_text(text)
        if parsed:
            return {**_empty_result_full("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
    elif settings.openai_api_key:
        parsed = await _extract_full_via_openai_text(text)
        if parsed:
            return {**_empty_result_full("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
    return _fallback_parse_extended(text, _fallback_parse_contract_text(text))


# ── "Dieu khoan quan trong & rui ro" (2026-10-27, yeu cau sep) ──────────────────────────────
# KHAC voi cac field o tren (chi trich xuat so lieu dinh danh) - day la phan tich NGU NGHIA toan
# bo noi dung hop dong de tim cac dieu khoan rui ro/quan trong (nghiem thu mac dinh, thoi han,
# phat vi pham, gia han/cham dut, bao hanh/bao mat, quyen & nghia vu) - KHONG the lam dung bang
# regex tong quat (yeu cau sep ro: "khong chi them regex cho rieng vi du nay"). Tang AI (that)
# la co che CHINH; tang heuristic chi la "ung vien tu khoa" CHUA XAC THUC, gan nhan ro rang de
# khong gia vo la da phan tich AI that.

RISK_CLAUSE_CATEGORIES = {
    "default_acceptance": "Nghiệm thu/chấp nhận mặc định",
    "deadline": "Thời hạn phản hồi/bàn giao/thanh toán",
    "penalty_liability": "Phạt vi phạm & giới hạn trách nhiệm",
    "renewal_termination": "Gia hạn tự động & chấm dứt hợp đồng",
    "warranty_confidentiality": "Bảo hành & bảo mật",
    "rights_obligations": "Quyền và nghĩa vụ hai bên",
}

RISK_CLAUSE_SYSTEM_PROMPT = """Bạn là trợ lý AI chuyên rà soát rủi ro pháp lý trong hợp đồng tiếng Việt cho đội Sale/pháp chế.

Đọc TOÀN BỘ văn bản hợp đồng được cung cấp, xác định các ĐIỀU KHOẢN QUAN TRỌNG/RỦI RO thuộc các nhóm sau (bỏ qua nhóm nào không có trong văn bản):
- default_acceptance: Nghiệm thu/chấp nhận MẶC ĐỊNH khi một bên không phản hồi trong thời hạn
- deadline: Thời hạn phản hồi, bàn giao, thanh toán, thực hiện nghĩa vụ
- penalty_liability: Phạt vi phạm, bồi thường thiệt hại, giới hạn trách nhiệm
- renewal_termination: Gia hạn tự động hợp đồng, đơn phương chấm dứt hợp đồng
- warranty_confidentiality: Bảo hành, bảo mật thông tin
- rights_obligations: Quyền và nghĩa vụ quan trọng của mỗi bên (ngoài các nhóm trên)

CHỈ trả về JSON array hợp lệ (không markdown/giải thích thêm), mỗi phần tử đúng hình dạng:
{
  "category": "default_acceptance" | "deadline" | "penalty_liability" | "renewal_termination" | "warranty_confidentiality" | "rights_obligations",
  "title": string (tóm tắt ngắn gọn, vd "Nghiệm thu mặc định sau 3 ngày không phản hồi"),
  "excerpt": string (TRÍCH DẪN NGUYÊN VĂN CHÍNH XÁC từ văn bản - bắt buộc, copy đúng từng chữ kể cả dấu câu, dùng để định vị highlight),
  "location": string|null (tên điều khoản chứa đoạn đó nếu văn bản có đánh số kiểu "ĐIỀU n"/"1.x", null nếu không xác định được),
  "explanation": string (giải thích ngắn gọn hệ quả/rủi ro thực tế cho Sale hiểu, KHÔNG đưa ra kết luận pháp lý),
  "severity": "warn" | "info" (warn = điều khoản có thể bất lợi/rủi ro cao hơn cho một bên hoặc thời hạn ngắn bất thường, info = điều khoản quan trọng cần biết nhưng không đặc biệt bất lợi)
}

Quy tắc bắt buộc:
1. CHỈ liệt kê điều khoản THẬT SỰ có trong văn bản - TUYỆT ĐỐI không suy đoán/bịa nội dung không có.
2. "excerpt" PHẢI là nguyên văn copy chính xác (không diễn giải/rút gọn/dịch) - nếu không trích dẫn chính xác được thì KHÔNG đưa điều khoản đó vào kết quả.
3. KHÔNG kết luận điều khoản vi phạm pháp luật hay đưa tư vấn pháp lý - chỉ nêu rủi ro thực tế để Sale/pháp chế tự xem xét.
4. Không có điều khoản nào thuộc các nhóm trên -> trả về mảng rỗng [].
"""


async def _extract_risk_clauses_via_gemini(text: str) -> list[dict] | None:
    if not _configure_gemini_if_needed():
        return None
    try:
        model = genai.GenerativeModel("gemini-flash-latest", system_instruction=RISK_CLAUSE_SYSTEM_PROMPT)
        response = model.generate_content(
            f"Rà soát điều khoản quan trọng/rủi ro trong hợp đồng sau:\n\n{text[:30000]}",
            generation_config={"temperature": 0.1},
        )
        parsed = json.loads(_strip_json_fences(response.text))
        return parsed if isinstance(parsed, list) else None
    except Exception as e:  # noqa: BLE001
        logger.error(f"Risk clause extraction: Gemini failed: {e}")
        return None


async def _extract_risk_clauses_via_openai(text: str) -> list[dict] | None:
    if not settings.openai_api_key:
        return None
    try:
        url = f"{settings.openai_base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
        body = {
            "model": settings.ai_model,
            "messages": [
                {"role": "system", "content": RISK_CLAUSE_SYSTEM_PROMPT},
                {"role": "user", "content": f"Rà soát điều khoản quan trọng/rủi ro trong hợp đồng sau:\n\n{text[:30000]}"},
            ],
            "temperature": 0.1, "max_tokens": 3000,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
        resp_text = resp.json()["choices"][0]["message"]["content"]
        parsed = json.loads(_strip_json_fences(resp_text))
        return parsed if isinstance(parsed, list) else None
    except Exception as e:  # noqa: BLE001
        logger.error(f"Risk clause extraction: OpenAI failed: {e}")
        return None


# Tu khoa "ung vien" CHUA XAC THUC - chi dung khi KHONG co AI key nao, gan nhan ro
# verified=False de FE KHONG hien nhu ket qua AI that (yeu cau sep: "khong chi them regex cho
# rieng vi du nay" - day la luoi an toan toi thieu, KHONG phai co che chinh).
_RISK_CANDIDATE_TRIGGERS: dict[str, list[str]] = {
    "default_acceptance": [r"mặc nhiên.{0,60}(nghiệm thu|chấp nhận|đồng ý)", r"không\s+(có\s+)?phản hồi.{0,80}mặc nhiên"],
    "penalty_liability": [r"phạt vi phạm", r"bồi thường thiệt hại", r"giới hạn trách nhiệm"],
    "renewal_termination": [r"tự động gia hạn", r"gia hạn tự động", r"đơn phương chấm dứt", r"chấm dứt hợp đồng trước thời hạn"],
    "warranty_confidentiality": [r"bảo mật thông tin", r"nghĩa vụ bảo mật"],
}


def _sentence_containing(text: str, match_start: int, match_end: int) -> str:
    """Lay ca cau (ngan cach boi dau cham/xuong dong) chua vi tri khop, lam excerpt du ngu
    canh - KHONG chi lay dung cum tu khop (qua ngan, mat ngu canh khi hien cho Sale doc)."""
    left = max(text.rfind(".", 0, match_start), text.rfind("\n", 0, match_start))
    right_dot = text.find(".", match_end)
    right_nl = text.find("\n", match_end)
    right = min(x for x in (right_dot, right_nl, len(text)) if x != -1)
    return text[left + 1:right + 1].strip()


def _fallback_risk_clause_candidates(text: str) -> list[dict]:
    """Luoi an toan toi thieu khi KHONG co AI key - CHI tim duoc vai cum tu kich hoat RO RANG,
    KHONG the thay the phan tich ngu nghia that. Moi ket qua danh dau category + verified=False."""
    results: list[dict] = []
    seen_excerpts: set[str] = set()
    for category, patterns in _RISK_CANDIDATE_TRIGGERS.items():
        for pattern in patterns:
            m = re.search(pattern, text, re.IGNORECASE)
            if not m:
                continue
            excerpt = _sentence_containing(text, m.start(), m.end())
            if not excerpt or excerpt in seen_excerpts:
                continue
            seen_excerpts.add(excerpt)
            results.append({
                "category": category, "title": RISK_CLAUSE_CATEGORIES.get(category, category),
                "excerpt": excerpt, "location": None,
                "explanation": "Phát hiện bằng từ khoá (chưa qua AI thật) — Sale/pháp chế tự đọc và đánh giá rủi ro thực tế.",
                "severity": "warn", "verified": False,
            })
    return results


async def extract_risk_clauses(text: str) -> dict:
    """Tra ve {method: 'ai'|'heuristic_candidate', clauses: [...]}. Tang AI (Gemini -> OpenAI)
    la co che CHINH de phan tich ngu nghia toan bo hop dong; KHONG co AI key nao thi dung luoi an
    toan tu khoa (xem _fallback_risk_clause_candidates), gan verified=False tren TUNG clause."""
    if len(text.strip()) < _MIN_TEXT_LEN_FOR_HEURISTIC:
        return {"method": "heuristic_candidate", "clauses": []}
    if settings.gemini_api_key:
        parsed = await _extract_risk_clauses_via_gemini(text)
        if parsed is not None:
            for c in parsed:
                c["verified"] = True
            return {"method": "ai", "clauses": parsed}
    elif settings.openai_api_key:
        parsed = await _extract_risk_clauses_via_openai(text)
        if parsed is not None:
            for c in parsed:
                c["verified"] = True
            return {"method": "ai", "clauses": parsed}
    return {"method": "heuristic_candidate", "clauses": _fallback_risk_clause_candidates(text)}


def _configure_gemini_if_needed() -> bool:
    if not settings.gemini_api_key:
        return False
    genai.configure(api_key=settings.gemini_api_key)
    return True


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _empty_result(method: str, extractable: bool) -> dict:
    return {
        "contract_number": None,
        "signed_at": None,
        "subtotal_amount": None,
        "vat_amount": None,
        "total_amount": None,
        "extraction_method": method,
        "extractable": extractable,
    }


def _parse_ai_json(resp_text: str) -> dict | None:
    try:
        parsed = json.loads(_strip_json_fences(resp_text))
    except Exception as e:
        logger.error(f"Contract OCR: AI JSON parse error: {e}")
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


async def _extract_via_gemini_text(text: str) -> dict | None:
    """Gửi text đã trích (pdfplumber) cho Gemini để lấy JSON header hợp đồng."""
    if not _configure_gemini_if_needed():
        return None
    try:
        model = genai.GenerativeModel("gemini-flash-latest", system_instruction=CONTRACT_SYSTEM_PROMPT)
        response = model.generate_content(
            f"Trích xuất JSON từ nội dung hợp đồng sau:\n\n{text[:30000]}",
            generation_config={"temperature": 0.1},
        )
        parsed = _parse_ai_json(response.text)
        return parsed
    except Exception as e:
        logger.error(f"Contract OCR: Gemini text extraction failed: {e}")
        return None


async def _extract_via_openai_text(text: str) -> dict | None:
    """Đường OpenAI-compatible (chat/completions) cho text đã trích - cùng
    endpoint/pattern normalize_text_with_llm() trong vendor_ai_parse_service.py
    đang dùng cho tính năng khác. Chỉ áp dụng cho text (không phải vision) vì
    AI_MODEL cấu hình hiện tại có thể không hỗ trợ ảnh."""
    if not settings.openai_api_key:
        return None
    try:
        url = f"{settings.openai_base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
        body = {
            "model": settings.ai_model,
            "messages": [
                {"role": "system", "content": CONTRACT_SYSTEM_PROMPT},
                {"role": "user", "content": f"Trích xuất JSON từ nội dung hợp đồng sau:\n\n{text[:30000]}"},
            ],
            "temperature": 0.1,
            "max_tokens": 1000,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
        resp_text = resp.json()["choices"][0]["message"]["content"]
        return _parse_ai_json(resp_text)
    except Exception as e:
        logger.error(f"Contract OCR: OpenAI text extraction failed: {e}")
        return None


async def _extract_via_gemini_file(file_bytes: bytes, mime_type: str) -> dict | None:
    """Gửi trực tiếp bytes file (PDF scan ảnh hoặc ảnh chụp) cho Gemini - cùng
    format content-list [{mime_type, data}, prompt] mà extract_items_from_image
    trong vendor_ai_parse_service.py đã dùng; Gemini SDK nhận mime_type
    "application/pdf" theo đúng cách này (không cần API khác)."""
    if not _configure_gemini_if_needed():
        return None
    try:
        model = genai.GenerativeModel("gemini-flash-latest", system_instruction=CONTRACT_SYSTEM_PROMPT)
        prompt = "Trích xuất JSON các thông tin đầu mục/tổng tiền từ file hợp đồng sau."
        response = model.generate_content(
            [{"mime_type": mime_type, "data": file_bytes}, prompt],
            generation_config={"temperature": 0.1},
        )
        return _parse_ai_json(response.text)
    except Exception as e:
        logger.error(f"Contract OCR: Gemini file extraction failed: {e}")
        return None


# ── Regex/heuristic fallback (tier cuối, dùng khi KHÔNG có AI key nào) ──────

_CONTRACT_NUMBER_RE = re.compile(
    r"(?:s[ốôo]\s*h[ợo]p\s*đ[ồô]ng|h[ợo]p\s*đ[ồô]ng\s*s[ốôo]|h[ợo]p\s*đ[ồô]ng\s*kinh\s*t[ếe]\s*s[ốôo]|hđkt\s*s[ốôo]|hđ\s*s[ốôo])\s*[:\-]?\s*([A-Za-zĐ0-9][A-Za-zĐ0-9\/\.\-]{2,40})",
    re.IGNORECASE,
)

_DATE_NUMERIC_RE = re.compile(r"(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})")
_DATE_VN_RE = re.compile(
    r"ng[àa]y\s*(\d{1,2})\s*th[áa]ng\s*(\d{1,2})\s*n[ăa]m\s*(\d{4})",
    re.IGNORECASE,
)

# Amount: chuỗi số có thể có dấu . hoặc , làm phân cách nghìn, theo sau bởi
# "đ"/"vnd"/"đồng" (không bắt buộc, vì nhiều hợp đồng chỉ viết số trần ngay
# sau nhãn "Tổng cộng:").
_AMOUNT_RE = re.compile(r"([\d][\d\.,]{2,})\s*(?:đ(?:ồng)?|vnđ|vnd)?", re.IGNORECASE)

_SUBTOTAL_LABELS = [
    r"gi[áa]\s*tr[ịi]\s*h[ợo]p\s*đ[ồô]ng\s*trư[ớo]c\s*(?:thu[ếe]|vat)",
    r"tr[ướu]c\s*vat",
    r"tr[ướu]c\s*thu[ếe]",
    r"t[ạa]m\s*t[íi]nh",
    r"c[ộô]ng\s*ti[ềe]n\s*h[àa]ng",
]
_VAT_LABELS = [
    r"thu[ếe]\s*gtgt",
    r"ti[ềe]n\s*thu[ếe]",
    r"\bvat\b",
]
# (2026-10-28, fix bug THAT da xac nhan tren HD/2026/0007: "6.952.400 VNĐ" la GIA TRUOC VAT
# (van ban ghi ro "Phí dịch vụ... chưa bao gồm thuế giá trị gia tăng (VAT)"), nhung heuristic cu
# khop nham voi nhan "TỔNG CỘNG" o bang gia roi gan vao total_amount ("Tổng giá trị SAU VAT") -
# BIA sai huong ca khi so tien dung. Neu van ban noi RO RANG so tien "chua gom VAT/thue" MA van
# chi tim thay DUY NHAT 1 moc tien (khong co vat_amount/subtotal_amount rieng) -> so do PHAI la
# truoc VAT, khong phai sau VAT, bat ke no nam canh nhan "Tong cong" nao trong bang.
_VAT_EXCLUDED_RE = re.compile(
    r"ch[ưu]a\s+(?:bao\s+)?g[ồô]m\s+thu[ếe]\s*(?:gi[áa]\s*tr[ịi]\s*gia\s*t[ăa]ng)?\s*(?:\(?vat\)?)?",
    re.IGNORECASE,
)

# (2026-10-28) Nhan dien ten cong ty Ben A (khach hang - can doi chieu voi CRM) va Ben B (ben phat
# hanh hop dong) rieng biet - hop dong tieng Viet hau het co khoi khai bao "...(BÊN A):\n<ten cong
# ty>" / "...(BÊN B):\n<ten cong ty>" ngay dau van ban. BUG DA XAC NHAN tren HD/2026/0007: prompt AI
# cu dinh nghia "company_name" la Ben B (ben phat hanh, vd chinh Markee) - so sanh voi CRM customer
# (luon la khach hang = Ben A) se LUON LUON khong khop/needs_review du AI trich xuat dung, vi dang
# so sanh SAI huong (cong ty cua minh voi khach hang cua minh, khong bao gio trung ten).
_COMPANY_LINE_RE = re.compile(r"(?:C[ÔO]NG\s*TY|CTY)\b[^\n]{0,120}", re.IGNORECASE)


def _extract_party_name_near_label(text: str, label_re: re.Pattern) -> tuple[str | None, str | None]:
    """Tim ten cong ty trong ~250 ky tu SAU lan xuat hien DAU TIEN cua nhan Ben A/Ben B - lan dau
    tien gan nhat voi khoi khai bao 2 ben o dau hop dong (cac lan nhac lai "Bên A"/"Bên B" sau do
    trong van ban thuong KHONG di kem ten cong ty day du nen se khong khop _COMPANY_LINE_RE,
    vong lap tu dong bo qua va thu lan xuat hien tiep theo)."""
    for m in label_re.finditer(text):
        window = text[m.end(): m.end() + 250]
        m_company = _COMPANY_LINE_RE.search(window)
        if m_company:
            name = m_company.group(0).strip().rstrip(":;,.")
            excerpt = text[m.start(): m.end() + m_company.end()].strip()
            return name, excerpt
    return None, None


_PARTY_A_LABEL_RE = re.compile(r"B[ÊE]N\s*A\b\)?\s*[:\-]?", re.IGNORECASE)
_PARTY_B_LABEL_RE = re.compile(r"B[ÊE]N\s*B\b\)?\s*[:\-]?", re.IGNORECASE)

_TOTAL_LABELS = [
    r"t[ổô]ng\s*gi[áa]\s*tr[ịi]\s*h[ợo]p\s*đ[ồô]ng",
    r"t[ổô]ng\s*thanh\s*to[áa]n",
    r"t[ổô]ng\s*c[ộô]ng",
    r"th[àa]nh\s*ti[ềe]n\s*sau\s*thu[ếe]",
    r"sau\s*vat",
    r"sau\s*thu[ếe]",
]


def _parse_vn_amount(raw: str) -> float | None:
    """Số VND kiểu VN: dấu chấm ngăn nghìn (vd "1.234.567"), dấu phẩy đôi khi
    dùng làm thập phân - hợp đồng gần như luôn ghi số nguyên VND nên coi dấu
    phẩy cuối cũng là phân cách nghìn nếu nhóm sau nó có 3 chữ số."""
    text = raw.strip()
    if not text:
        return None
    text = text.replace(" ", "")
    # Bỏ dấu . / , dùng làm phân cách nghìn - CHỈ giữ lại nếu nhóm cuối có
    # đúng 1-2 chữ số (khả năng là phần thập phân thật, hiếm gặp với VND).
    parts = re.split(r"[\.,]", text)
    if len(parts) > 1 and len(parts[-1]) in (1, 2) and len(parts) == 2:
        # dạng "1234,5" -> coi là thập phân
        normalized = parts[0] + "." + parts[-1]
    else:
        normalized = "".join(parts)
    try:
        value = float(normalized)
    except ValueError:
        return None
    if value <= 0:
        return None
    return value


def _find_amount_near_labels(text: str, labels: list[str], with_excerpt: bool = False):
    """Tìm số tiền VND gần nhất (trong ~80 ký tự) SAU 1 trong các nhãn cho
    trước. Best-effort - hợp đồng có bố cục tự do nên đây KHÔNG đảm bảo chính
    xác 100%, chỉ là gợi ý để người dùng đối chiếu, không phải nguồn tin cậy
    tuyệt đối (đã ghi rõ trong response bằng extraction_method="heuristic").

    `with_excerpt=True` (2026-10-27, de highlight duoc ca cac moc tien, khong chi tax_code/
    warranty_period) - tra ve (value, excerpt) thay vi chi value; excerpt = chinh doan nhan +
    so tien vua khop, dung lam `source_excerpt` de highlight_docx/highlight_pdf_* dinh vi."""
    for label_pattern in labels:
        for m in re.finditer(label_pattern, text, re.IGNORECASE):
            window = text[m.end(): m.end() + 80]
            amount_match = _AMOUNT_RE.search(window)
            if amount_match:
                value = _parse_vn_amount(amount_match.group(1))
                if value is not None:
                    if with_excerpt:
                        excerpt = text[m.start(): m.end() + amount_match.end()].strip()
                        return value, excerpt
                    return value
    return (None, None) if with_excerpt else None


def _fallback_parse_contract_text(text: str) -> dict:
    """Regex/heuristic thuần Python, không AI - tier duy nhất chạy được khi
    KHÔNG có GEMINI_API_KEY/OPENAI_API_KEY (đúng môi trường dev hiện tại).
    Best-effort, KHÔNG đảm bảo chính xác - chỉ trả về gì thật sự tìm thấy
    trong text, không đoán/không suy luận thêm."""
    contract_number = None
    m = _CONTRACT_NUMBER_RE.search(text)
    if m:
        contract_number = m.group(1).strip().strip(".,;")

    signed_at = None
    m_vn = _DATE_VN_RE.search(text)
    if m_vn:
        d, mo, y = m_vn.groups()
        signed_at = f"{y}-{int(mo):02d}-{int(d):02d}"
    else:
        m_num = _DATE_NUMERIC_RE.search(text)
        if m_num:
            d, mo, y = m_num.groups()
            try:
                if 1 <= int(mo) <= 12 and 1 <= int(d) <= 31:
                    signed_at = f"{y}-{int(mo):02d}-{int(d):02d}"
            except ValueError:
                signed_at = None

    subtotal, subtotal_excerpt = _find_amount_near_labels(text, _SUBTOTAL_LABELS, with_excerpt=True)
    vat, vat_excerpt = _find_amount_near_labels(text, _VAT_LABELS, with_excerpt=True)
    total, total_excerpt = _find_amount_near_labels(text, _TOTAL_LABELS, with_excerpt=True)

    # BUG THAT da xac nhan tren HD/2026/0007 (xem _VAT_EXCLUDED_RE): van ban noi ro so tien duy
    # nhat la "CHƯA bao gồm VAT" nhung nhan bang gia ("TỔNG CỘNG") lai khop _TOTAL_LABELS, bia sai
    # thanh "Tổng giá trị SAU VAT". Chi 1 moc tien duy nhat tim duoc (khong co vat/subtotal rieng)
    # + van ban noi ro "chua gom VAT" -> do PHAI la truoc VAT, doi lai nhan cho dung voi NOI DUNG
    # THAT cua hop dong (khong phai doan theo vi tri trong bang).
    if total is not None and subtotal is None and vat is None and _VAT_EXCLUDED_RE.search(text):
        subtotal, subtotal_excerpt = total, total_excerpt
        total, total_excerpt = None, None

    found_any = any(v is not None for v in (contract_number, signed_at, subtotal, vat, total))
    return {
        "contract_number": contract_number,
        "signed_at": signed_at,
        "subtotal_amount": subtotal,
        "subtotal_amount_excerpt": subtotal_excerpt,
        "vat_amount": vat,
        "vat_amount_excerpt": vat_excerpt,
        "total_amount": total,
        "total_amount_excerpt": total_excerpt,
        "extraction_method": "heuristic",
        "extractable": found_any,
    }


def _extract_docx_text(file_bytes: bytes) -> str:
    """Van ban tho tu file .docx (doan van + bang) - dung lai python-docx
    da co san lam dependency (xem contract_docx_engine.py), KHONG them thu
    vien moi. .docx LUON co text that (khong co truong hop "scan anh" nhu
    PDF) nen khong can tang AI vision rieng cho dinh dang nay."""
    from io import BytesIO

    from docx import Document

    doc = Document(BytesIO(file_bytes))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text.strip():
                    parts.append(cell.text)
    return "\n".join(parts)


async def _summarize_from_text(text: str) -> dict:
    """Tang AI (uu tien Gemini roi OpenAI-compatible) -> heuristic - dung
    chung cho moi nguon da co san TEXT THAT (PDF co text + .docx), tranh
    lap lai cung 1 logic 3 tang o 2 nhanh dinh dang khac nhau."""
    if len(text.strip()) < _MIN_TEXT_LEN_FOR_HEURISTIC:
        return _empty_result("heuristic", False)
    if settings.gemini_api_key:
        parsed = await _extract_via_gemini_text(text)
        if parsed:
            return {**_empty_result("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
        # AI co key nhung goi loi/parse loi - van con text that, roi xuong heuristic thay vi tra loi trang tay.
    elif settings.openai_api_key:
        parsed = await _extract_via_openai_text(text)
        if parsed:
            return {**_empty_result("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
    return _fallback_parse_contract_text(text)


async def extract_contract_summary(file_bytes: bytes, filename: str) -> dict:
    """Best-effort trích xuất {contract_number, signed_at, subtotal_amount,
    vat_amount, total_amount, extraction_method, extractable} từ 1 file hợp
    đồng đã upload (PDF, ảnh, hoặc .docx). KHÔNG BAO GIỜ bịa số liệu -
    extractable=False + toàn bộ field None là kết quả hợp lệ khi không đọc
    được nội dung."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    has_ai = bool(settings.gemini_api_key or settings.openai_api_key)

    if ext == "docx":
        try:
            text = _extract_docx_text(file_bytes)
        except Exception:
            logger.warning("Contract OCR: khong doc duoc .docx %s", filename, exc_info=True)
            text = ""
        return await _summarize_from_text(text)

    if ext in ("png", "jpg", "jpeg"):
        # Ảnh chụp/scan: không có text để pdfplumber đọc - bắt buộc cần AI
        # vision (không có Tesseract/pytesseract trong repo này).
        if not settings.gemini_api_key:
            # openai_api_key chỉ mới nối cho tier TEXT (_extract_via_openai_text),
            # chưa nối cho vision/file (AI_MODEL hiện tại - gpt-3.5-turbo - không
            # đọc được ảnh) - ảnh chụp/scan bắt buộc vẫn cần Gemini.
            return _empty_result("heuristic", False)
        mime = "image/png" if ext == "png" else "image/jpeg"
        parsed = await _extract_via_gemini_file(file_bytes, mime)
        if parsed:
            return {**_empty_result("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
        return _empty_result("ai", False)

    if ext == "pdf":
        try:
            text = VendorAIParsingService.extract_from_pdf(file_bytes)
        except ValueError:
            text = ""

        if len(text.strip()) >= _MIN_TEXT_LEN_FOR_HEURISTIC:
            if settings.gemini_api_key:
                parsed = await _extract_via_gemini_text(text)
                if parsed:
                    return {**_empty_result("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
                # AI có key nhưng gọi lỗi/parse lỗi - vẫn còn text thật, rơi
                # xuống heuristic thay vì trả lỗi trắng tay.
            elif settings.openai_api_key:
                parsed = await _extract_via_openai_text(text)
                if parsed:
                    return {**_empty_result("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
            return _fallback_parse_contract_text(text)

        # Text quá ngắn/rỗng - nhiều khả năng PDF scan ảnh, không đọc được
        # bằng pdfplumber. Chỉ còn đường AI vision (Gemini nhận thẳng PDF).
        if settings.gemini_api_key:
            parsed = await _extract_via_gemini_file(file_bytes, "application/pdf")
            if parsed:
                return {**_empty_result("ai", True), **parsed, "extraction_method": "ai", "extractable": True}
        return _empty_result("ai" if has_ai else "heuristic", False)

    # Định dạng khác (docx, ...) - chưa hỗ trợ, honest "không đọc được".
    return _empty_result("heuristic", False)


_TOLERANCE_RATIO = 0.01  # 1%
_TOLERANCE_MIN_VND = 5000  # sàn tuyệt đối cho các khoản tiền rất nhỏ/bằng 0


def _values_match(a: float | None, b: float | None) -> bool:
    """Dung sai 1% giá trị báo giá (hoặc tối thiểu 5.000đ) - hợp đồng scan/OCR
    thường lệch vài đồng do làm tròn/phí ngân hàng ghi kèm, không nên báo
    "Lệch" chỉ vì sai số làm tròn. Nếu 1 trong 2 giá trị là None (không trích
    xuất được / báo giá không có field đó) thì KHÔNG coi là khớp - để người
    dùng biết rõ đây là "chưa đối chiếu được", không phải "khớp"."""
    if a is None or b is None:
        return False
    tolerance = max(abs(b) * _TOLERANCE_RATIO, _TOLERANCE_MIN_VND)
    return abs(a - b) <= tolerance


def compare_to_quote(
    extracted: dict,
    quote_subtotal: float | None,
    quote_vat: float | None,
    quote_total: float | None,
) -> dict:
    """So sánh 3 mốc tiền (Trước VAT / VAT / Sau VAT) giữa hợp đồng OCR và báo
    giá thật đã chọn. Dung sai 1% (tối thiểu 5.000đ) - xem _values_match."""
    rows = [
        {
            "label": "Trước VAT",
            "contractValue": extracted.get("subtotal_amount"),
            "quoteValue": quote_subtotal,
            "matched": _values_match(extracted.get("subtotal_amount"), quote_subtotal),
        },
        {
            "label": "VAT",
            "contractValue": extracted.get("vat_amount"),
            "quoteValue": quote_vat,
            "matched": _values_match(extracted.get("vat_amount"), quote_vat),
        },
        {
            "label": "Sau VAT",
            "contractValue": extracted.get("total_amount"),
            "quoteValue": quote_total,
            "matched": _values_match(extracted.get("total_amount"), quote_total),
        },
    ]
    all_matched = all(row["matched"] for row in rows)
    return {"rows": rows, "allMatched": all_matched}


RULES_VERSION = "v6"  # Bump: neo highlight ten Bên A bằng đúng tên công ty; cache cũ chưa có vùng tô chính xác.
# v5 (2026-10-28, "Hybrid Regex + AI that" - fix 2 bug that xac nhan qua HD/2026/0007):
# (1) company_name truoc day = Ben B (chinh cong ty phat hanh hop dong) nen SO SANH SAI HUONG voi
# CRM customer (luon la khach hang = Ben A) - them party_a_name/party_b_name rieng, doi chieu dung
# voi party_a_name; (2) heuristic gan nham "6.952.400 VNĐ" thanh "Tong gia tri SAU VAT" du van ban
# ghi ro "chua bao gom VAT" - them _VAT_EXCLUDED_RE de doc dung noi dung THAT thay vi doan theo vi
# tri trong bang. Them verdict moi "not_found_in_document" (AI DA CHAY that nhung khong thay trong
# van ban) - tach bach voi "not_extracted" (AI chua chay) va "insufficient_data" (thieu du lieu
# phia BAO GIA/khach hang, khong lien quan AI). BUMP de hop dong da chay AI Review truoc do (vd
# HD/2026/0007) tu dong chay lai duoi logic moi.
# v4 (2026-10-27, yeu cau sep "AI phai doc toan bo hop dong tim dieu khoan quan trong/rui ro"):
# them extract_risk_clauses() (nghiem thu mac dinh, thoi han, phat vi pham, gia han/cham dut,
# bao hanh/bao mat, quyen & nghia vu) + doi mau highlight sang vang dong nhat #FFF176. BUMP de
# moi hop dong da chay AI Review truoc do tu dong chay lai, co them muc "Dieu khoan quan trong".
# v2 (2026-10-27, fix bug "bao thieu du lieu sai" + highlight khong chay): them verdict
# "not_extracted" (khac "insufficient_data"), fix crash "Table Grid" lam highlight luon that bai
# am tham.
# v3 (2026-10-27, gop y UX "highlight sai - dang tao bang bao cao thay vi to mau hop dong that"):
# BO HAN buoc chen trang/bang tong ket vao file Highlight (DOCX/PDF) - file Highlight gio CHI la
# ban sao hop dong goc duoc to mau, KHONG con bang "Noi dung/Ket qua/Trich dan" o dau file nua;
# bao cao do CHI hien o panel ket qua AI (FE) + API response. BUMP de moi hop dong da chay AI
# Review truoc do (file Highlight cu dang co bang bao cao sai) tu dong tao lai dung.


def _normalize_company_name(name: str | None) -> str:
    """Bo dau tieng Viet (tai dung fold() cua crm_short_name_service - tranh viet lai) truoc khi
    so sanh - ten cong ty trong hop dong/CRM rat hay khac nhau ve cach go dau/viet tat."""
    from app.modules.all_platform.services.crm_short_name_service import fold

    return re.sub(r"\s+", " ", fold(name or "").strip())


def _normalize_tax_code(code: str | None) -> str:
    return re.sub(r"\D", "", (code or ""))


def compare_contract_to_quote_full(
    extracted: dict,
    quote: dict | None,
    customer: dict | None,
    contract_warranty_period: str | None,
) -> list[dict]:
    """(B3) Doi chieu day du - KHONG xoa compare_to_quote() cu (noi khac con goi). `quote` la
    dict tra ve tu get_quote() (supabase_quote_service.py, co the None neu hop dong khong gan
    quote_id). `customer` la dict tu crm_customers (company_name, tax_code - co the None).
    Tra ve list {field, label, contractValue, quoteValue, verdict, sourceExcerpt, sourceLocation},
    verdict in {match, mismatch, needs_review, insufficient_data, not_extracted, not_found_in_document}.
    "not_extracted" (2026-10-27): AI CHUA CHAY (khong co API key) nen chua trich xuat duoc - gia tri
    co the THAT SU co trong van ban, Sale phai tu doc. "not_found_in_document" (2026-10-28, fix bug
    that - yeu cau sep "phan biet Khong tim thay trong tai lieu / Chua trich xuat / Khong du du
    lieu"): AI THAT SU DA CHAY xong nhung khong tim thay noi dung nay trong van ban - khac han
    "not_extracted" (chua chay) va "insufficient_data" (du lieu phia BAO GIA/KHACH HANG thieu de
    doi chieu, khong lien quan gi den viec AI co tim thay trong hop dong hay khong)."""
    rows: list[dict] = []
    extraction_method = extracted.get("extraction_method")
    is_ai = extraction_method == "ai"

    def _unknown_verdict() -> str:
        return "not_extracted" if not is_ai else "not_found_in_document"

    def _excerpt(field: str) -> str | None:
        return extracted.get(f"{field}_excerpt")

    def _location(field: str) -> str | None:
        return extracted.get(f"{field}_location")

    # -- Cong ty / MST (tu crm_customers qua chuoi quote.dealId -> customer_leads -> crm_customers,
    # cap nhat tai day chi nhan `customer` da resolve san tu caller, khong tu truy van lai). --
    # (2026-10-28, fix bug that tren HD/2026/0007) So sanh voi party_a_name (BEN A = khach hang) -
    # KHONG dung "company_name" (truoc day = Ben B = chinh cong ty phat hanh hop dong, se KHONG
    # BAO GIO trung voi khach hang trong CRM). Fallback ve company_name cu neu party_a_name chua
    # co (du lieu cu/AI output cu chua co field moi) de khong vo review da luu truoc do.
    company_value = extracted.get("party_a_name") or extracted.get("company_name")
    company_field = "party_a_name" if extracted.get("party_a_name") else "company_name"
    company_ref = (customer or {}).get("company_name") or (customer or {}).get("customer_name")
    if company_value is None:
        company_verdict = _unknown_verdict()
    elif company_ref is None:
        company_verdict = "insufficient_data"
    elif _normalize_company_name(company_value) == _normalize_company_name(company_ref) or (
        _normalize_company_name(company_value) in _normalize_company_name(company_ref)
        or _normalize_company_name(company_ref) in _normalize_company_name(company_value)
    ):
        company_verdict = "match"
    else:
        # Ten cong ty la so sanh VAN BAN TU DO (khac han MST/so tien la doi chieu CHINH XAC) -
        # khong khop chu khong co nghia la SAI han, luon can Sale tu doc lai thay vi bao do
        # "mismatch" cung nhac nguoi dung hoang hot nham.
        company_verdict = "needs_review"
    rows.append({
        "field": "company_name", "label": "Tên công ty (Bên A - khách hàng)",
        "contractValue": company_value, "quoteValue": company_ref,
        # Chỉ neo đúng TÊN công ty thay vì cả block "BÊN A ... tên công ty".
        # Excerpt dài có thể bắc qua nhiều paragraph/cell nên verdict vẫn Match
        # nhưng highlighter exact-text không định vị được; company_value chính
        # là chuỗi đã trích từ tài liệu và cho vùng tô vàng chính xác hơn.
        "verdict": company_verdict, "sourceExcerpt": company_value or _excerpt(company_field), "sourceLocation": _location(company_field),
    })

    tax_value = extracted.get("tax_code")
    tax_ref = (customer or {}).get("tax_code")
    if tax_value is None:
        tax_verdict = _unknown_verdict()
    elif tax_ref is None:
        tax_verdict = "insufficient_data"
    elif _normalize_tax_code(tax_value) == _normalize_tax_code(tax_ref):
        tax_verdict = "match"
    else:
        tax_verdict = "mismatch"
    rows.append({
        "field": "tax_code", "label": "Mã số thuế",
        "contractValue": tax_value, "quoteValue": tax_ref,
        "verdict": tax_verdict, "sourceExcerpt": _excerpt("tax_code"), "sourceLocation": _location("tax_code"),
    })

    # -- Gia tri / VAT (tai dung dung sai cua compare_to_quote cu) --
    quote_subtotal = (quote or {}).get("subtotalAmount")
    quote_vat = (quote or {}).get("vatAmount")
    quote_total = (quote or {}).get("totalAmount")
    for field, label, contract_key, quote_val in (
        ("subtotal_amount", "Giá trị trước VAT", "subtotal_amount", quote_subtotal),
        ("vat_amount", "Tiền VAT", "vat_amount", quote_vat),
        ("total_amount", "Tổng giá trị sau VAT", "total_amount", quote_total),
    ):
        contract_val = extracted.get(contract_key)
        if contract_val is None:
            verdict = _unknown_verdict()
        elif quote_val is None:
            verdict = "insufficient_data"
        elif _values_match(contract_val, quote_val):
            verdict = "match"
        else:
            verdict = "mismatch"
        rows.append({
            "field": field, "label": label, "contractValue": contract_val, "quoteValue": quote_val,
            "verdict": verdict, "sourceExcerpt": extracted.get(f"{contract_key}_excerpt"), "sourceLocation": None,
        })

    # -- Bao hanh: so voi gia tri da luu tren CHINH hop dong (contracts.warranty_period, dropdown
    # da lam truoc do) - KHONG phai tren quote (quote khong co field nay o cap header). --
    warranty_extracted = extracted.get("warranty_period")
    if warranty_extracted is None:
        warranty_verdict = _unknown_verdict()
    elif contract_warranty_period is None:
        warranty_verdict = "insufficient_data"
    else:
        m1 = _WARRANTY_RE.search(warranty_extracted)
        m2 = _WARRANTY_RE.search(contract_warranty_period)
        if m1 and m2 and m1.group(1) == m2.group(1) and m1.group(2).lower() == m2.group(2).lower():
            warranty_verdict = "match"
        else:
            warranty_verdict = "needs_review"
    rows.append({
        "field": "warranty_period", "label": "Thời gian bảo hành",
        "contractValue": warranty_extracted, "quoteValue": contract_warranty_period,
        "verdict": warranty_verdict, "sourceExcerpt": _excerpt("warranty_period"), "sourceLocation": _location("warranty_period"),
    })

    # -- Dieu khoan tu do (payment/delivery/penalty/termination/validity): KHONG co du lieu
    # chuan de doi chieu tu dong (quote khong luu cac field nay o dang co cau truc so sanh duoc) -
    # luon can Sale tu doc lai (needs_review), trung thuc hon viec gia vo "tu dong xac minh duoc". --
    for field, label in (
        ("payment_terms", "Điều khoản thanh toán"),
        ("delivery_terms", "Điều khoản bàn giao"),
        ("penalty_clause", "Điều khoản phạt vi phạm"),
        ("termination_clause", "Điều khoản chấm dứt"),
        ("validity_period", "Hiệu lực hợp đồng"),
    ):
        value = extracted.get(field)
        verdict = "needs_review" if value else _unknown_verdict()
        rows.append({
            "field": field, "label": label, "contractValue": value, "quoteValue": None,
            "verdict": verdict,
            "sourceExcerpt": _excerpt(field), "sourceLocation": _location(field),
        })

    return rows
