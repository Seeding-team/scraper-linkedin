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


def _find_amount_near_labels(text: str, labels: list[str]) -> float | None:
    """Tìm số tiền VND gần nhất (trong ~80 ký tự) SAU 1 trong các nhãn cho
    trước. Best-effort - hợp đồng có bố cục tự do nên đây KHÔNG đảm bảo chính
    xác 100%, chỉ là gợi ý để người dùng đối chiếu, không phải nguồn tin cậy
    tuyệt đối (đã ghi rõ trong response bằng extraction_method="heuristic")."""
    for label_pattern in labels:
        for m in re.finditer(label_pattern, text, re.IGNORECASE):
            window = text[m.end(): m.end() + 80]
            amount_match = _AMOUNT_RE.search(window)
            if amount_match:
                value = _parse_vn_amount(amount_match.group(1))
                if value is not None:
                    return value
    return None


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

    subtotal = _find_amount_near_labels(text, _SUBTOTAL_LABELS)
    vat = _find_amount_near_labels(text, _VAT_LABELS)
    total = _find_amount_near_labels(text, _TOTAL_LABELS)

    found_any = any(v is not None for v in (contract_number, signed_at, subtotal, vat, total))
    return {
        "contract_number": contract_number,
        "signed_at": signed_at,
        "subtotal_amount": subtotal,
        "vat_amount": vat,
        "total_amount": total,
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
