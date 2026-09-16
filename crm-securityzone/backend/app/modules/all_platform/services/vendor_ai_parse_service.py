import google.generativeai as genai
import json
import logging
import os
import io
import pdfplumber
import httpx
import re
from app.core.config import settings

logger = logging.getLogger(__name__)

# Try to init Gemini
if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key)

SYSTEM_PROMPT = """Bạn là trợ lý AI chuyên trích xuất thông tin báo giá từ nhà cung cấp (Vendor Quote/Price Book).
Nhiệm vụ: Trích xuất các mặt hàng (products) từ văn bản/bảng được cung cấp và chuẩn hóa thành danh sách JSON.

CHỈ trả về JSON array hợp lệ, không có markdown block hay giải thích gì thêm.
Mỗi object trong array phải có các field sau (nếu không có thì để null):
{
  "sku": string (Part Number hoặc Mã sản phẩm của NCC, nếu có),
  "name": string (Tên sản phẩm - BẮT BUỘC),
  "description": string (Mô tả chi tiết, nếu có),
  "quantity": number (Số lượng, mặc định 1),
  "uom": string (Đơn vị tính: Cái, Bộ, License, v.v.),
  "brand": string (Hãng sản xuất, nếu có),
  "currency": string (VND hoặc USD),
  "list_price": number (Giá niêm yết chưa chiết khấu),
  "discount_percent": number (Phần trăm chiết khấu, 0-100),
  "net_price": number (Giá sau chiết khấu / Giá mua thực tế),
  "vat_rate": number (Phần trăm VAT, ví dụ 8 hoặc 10)
}

Quy tắc:
1. Nếu chỉ có một loại giá, hãy đặt nó vào "net_price" và tính toán list_price/discount nếu có đủ dữ liệu.
2. Cố gắng trích xuất chính xác tên sản phẩm và mã.
3. Không tự chếa ra sản phẩm không có trong đoạn text.
4. Bỏ qua các hàng trống, hoặc các hàng chỉ có tiêu đề bảng.
"""

def chunk_text(text: str, max_chars: int = 30000) -> list:
    """Simple chunking to avoid LLM token limits"""
    chunks = []
    current = ""
    for line in text.split('\n'):
        if len(current) + len(line) > max_chars:
            chunks.append(current)
            current = line + "\n"
        else:
            current += line + "\n"
    if current:
        chunks.append(current)
    return chunks

def _parse_number(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = re.sub(r"[^\d,.\-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        parts = text.split(",")
        text = text.replace(",", ".") if len(parts[-1]) <= 2 else text.replace(",", "")
    elif text.count(".") > 1:
        text = text.replace(".", "")
    try:
        return float(text)
    except ValueError:
        return None

def _norm_header(value: str) -> str:
    text = str(value or "").strip().lower()
    text = (
        text.replace("đ", "d")
        .replace("ã", "a").replace("á", "a").replace("à", "a").replace("ạ", "a").replace("ả", "a").replace("ă", "a").replace("ắ", "a").replace("ằ", "a").replace("ặ", "a").replace("ẳ", "a").replace("â", "a").replace("ấ", "a").replace("ầ", "a").replace("ậ", "a").replace("ẩ", "a")
        .replace("é", "e").replace("è", "e").replace("ẹ", "e").replace("ẻ", "e").replace("ê", "e").replace("ế", "e").replace("ề", "e").replace("ệ", "e").replace("ể", "e")
        .replace("í", "i").replace("ì", "i").replace("ị", "i").replace("ỉ", "i")
        .replace("ó", "o").replace("ò", "o").replace("ọ", "o").replace("ỏ", "o").replace("ô", "o").replace("ố", "o").replace("ồ", "o").replace("ộ", "o").replace("ổ", "o").replace("ơ", "o").replace("ớ", "o").replace("ờ", "o").replace("ợ", "o").replace("ở", "o")
        .replace("ú", "u").replace("ù", "u").replace("ụ", "u").replace("ủ", "u").replace("ư", "u").replace("ứ", "u").replace("ừ", "u").replace("ự", "u").replace("ử", "u")
        .replace("ý", "y").replace("ỳ", "y").replace("ỵ", "y").replace("ỷ", "y")
    )
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")

_HEADER_ALIASES = {
    "sku": {"sku", "ma", "ma_san_pham", "ma_sp", "part_number", "pn", "model"},
    "name": {"name", "ten", "ten_san_pham", "san_pham", "hang_muc", "mo_ta_hang_hoa", "description"},
    "description": {"mo_ta", "description", "dien_giai"},
    "quantity": {"qty", "quantity", "sl", "so_luong"},
    "uom": {"uom", "unit", "dvt", "don_vi", "don_vi_tinh"},
    "brand": {"brand", "hang", "hang_sx", "manufacturer"},
    "currency": {"currency", "tien_te", "loai_tien"},
    "list_price": {"list_price", "gia_niem_yet", "don_gia", "unit_price", "gia"},
    "discount_percent": {"discount", "discount_percent", "chiet_khau", "ck"},
    # "net_unit" them vao day vi bang bao gia Vendor that (Allied Telesis mau
    # test) dat ten cot "NET UNIT" - khong co no thi list_price+discount van
    # suy ra duoc net_price gan dung, nhung khop cot that van chinh xac hon.
    "net_price": {"net_price", "net_unit", "gia_net", "gia_sau_ck", "gia_mua", "gia_von", "cost"},
    "vat_rate": {"vat", "vat_rate", "thue"},
}
# Bang chi duoc coi la "bang gia san pham" That neu co CA sku/name LAN it
# nhat 1 cot gia - day la dieu kien loai bo cac bang khac trong cung file
# (vd bang "SKU | VENDOR PART/NOTES | BUNDLE/SERVICE" o trang 2 cua PDF mau
# Allied Telesis - co cot "SKU" nhung khong co gia nao ca, nen KHONG phai
# bang can import). Neu chi doi hoi sku/name se lam 1 bang ghi-chu khong
# lien quan bi nham thanh san pham, gay tang so dong sai (bug that da audit).
_PRICE_FIELDS = {"list_price", "net_price"}

_NUMERIC_ONLY_RE = re.compile(r"^-?\d+([.,]\d+)?$")
_CURRENCY_ONLY_RE = re.compile(r"^\$?\s?-?[\d,]+\.\d{2}$")


def _looks_like_stray_numeric_or_currency(value: str | None) -> bool:
    """True neu gia tri chi la 1 con so tran (vd "9", "1") hoac 1 so tien
    (vd "$2,970.00") - day la dau hieu 1 cell QTY/LIST PRICE/... bi rung
    thanh dong rieng do 1 cell KHAC trong cung hang co newline noi bo lam vo
    cau truc bang (bug that da audit: "SKU=9, name=$2,970.00"). Khong duoc
    chap nhan lam SKU/ten san pham that."""
    v = (value or "").strip()
    if not v:
        return True
    return bool(_NUMERIC_ONLY_RE.match(v) or _CURRENCY_ONLY_RE.match(v))


def _detect_table_header(rows: list[list[str]], scan_limit: int = 10) -> tuple[int | None, dict[str, int]]:
    for idx, row in enumerate(rows[:scan_limit]):
        normalized = [_norm_header(cell) for cell in row]
        found: dict[str, int] = {}
        used_cols: set[int] = set()
        # Pass 1: CHI exact match, khong dung endswith - uu tien tuyet doi va
        # khoa cot lai ngay khi khop, tranh 1 cot bi 2 field cung nhan (vd
        # header "NET UNIT" -> "net_unit" khop EXACT voi alias net_price,
        # nhung cung khop endswith("_unit") cua uom neu khong khoa cot lai -
        # bug that phat hien khi them "net_unit" vao alias net_price).
        for field, names in _HEADER_ALIASES.items():
            for col, value in enumerate(normalized):
                if col in used_cols:
                    continue
                if value in names:
                    found[field] = col
                    used_cols.add(col)
                    break
        # Pass 2: endswith fallback (cho header ghep vd "don_gia_ban"), CHI
        # xet field chua khop va cot chua bi field nao khac chiem.
        for field, names in _HEADER_ALIASES.items():
            if field in found:
                continue
            for col, value in enumerate(normalized):
                if col in used_cols:
                    continue
                if any(value.endswith("_" + name) for name in names):
                    found[field] = col
                    used_cols.add(col)
                    break
        if ("name" in found or "sku" in found) and (_PRICE_FIELDS & found.keys()):
            # "name" va "description" thuong la CUNG 1 cot trong bang vendor
            # thuc te (1 cot mo ta tu do, vd "DESCRIPTION") - viec khoa cot o
            # pass 1/2 chi cho phep 1 field nhan cot do, nen bu lai o day de
            # khong mat du lieu description khi 2 field trung nhau that su.
            if "description" not in found and "name" in found:
                found["description"] = found["name"]
            return idx, found
    return None, {}


_DOC_CURRENCY_RE = re.compile(r"(?i)^currency\s*[:\-]?\s*([a-z]{3})$")


def _detect_document_currency(tables: list[list[list[str]]]) -> str | None:
    """Quote PDF thuong co 1 bang thong tin chung (Vendor/Customer/Date/
    Currency/Project/Valid Until) TACH RIENG voi bang gia san pham - moi cell
    trong bang do la "Nhan\\nGia tri" gop lam 1 o (vd cell = "Currency\\nUSD").
    Ham nay quet TAT CA bang tim dong "Currency <ma tien te>" de lay dung
    don vi tien cua CA CHUNG TU (ap dung cho moi dong san pham khong co cot
    currency rieng) - khong the doan currency tu ban than bang gia (bang gia
    That cua Allied Telesis KHONG co cot Currency rieng, chi co table thong
    tin chung moi co)."""
    for table in tables:
        for row in table:
            for raw_cell in row:
                cell_text = " ".join(str(raw_cell).split())
                match = _DOC_CURRENCY_RE.match(cell_text.strip())
                if match:
                    return match.group(1).upper()
    return None


def _rows_to_items(rows: list[list[str]], default_currency: str | None = None) -> list:
    """Chuyen 1 bang THAT (list cac hang, moi hang la list cac cell da tach
    dung ranh gioi - KHONG phai text da flatten thanh pipe-string) thanh danh
    sach san pham. Dung chung cho ca duong PDF-structured-table (moi) va
    fallback text-table (Excel/PDF khong doc duoc bang that). `default_currency`
    (vd "USD" doc duoc tu bang thong tin chung cua chung tu, xem
    _detect_document_currency) duoc dung khi CHINH bang gia nay khong co cot
    currency rieng - truoc day bug that luon mac dinh VND trong truong hop
    nay (PDF Allied Telesis that: gia USD nhung bi luu thanh VND)."""
    header_idx, header_map = _detect_table_header(rows)
    if header_idx is None:
        return []

    parsed = []
    for row in rows[header_idx + 1:]:
        def cell(field: str):
            col = header_map.get(field)
            return row[col].strip() if col is not None and col < len(row) else None

        name = cell("name")
        sku = cell("sku")
        if not name and not sku:
            continue

        list_price = _parse_number(cell("list_price"))
        discount = _parse_number(cell("discount_percent")) or 0
        net_price = _parse_number(cell("net_price"))
        has_valid_price = list_price is not None or net_price is not None
        # Dong "rac" do 1 cell khac trong CUNG hang that bi day xuong dong
        # rieng (vd chi con "9" hoac "$2,970.00" o vi tri cot SKU/name) -
        # khong duoc tao thanh 1 VendorImportItem. SUA LAI (bug that da bao
        # cao): TRUOC DAY loai bo BAT KY sku nao la so nguyen tran
        # (vd `if sku and _NUMERIC_ONLY_RE.match(sku): continue`) - dieu nay
        # vo tinh xoa mat ca SKU so THAT trong danh muc (vd san pham that
        # SKU="2322" trong he thong nay). Nhan dien "rac" phai theo Y NGHIA
        # cua dong, KHONG chi theo hinh dang SKU:
        #   - "name" tu no da la 1 chuoi so/tien tran (vd "$2,970.00", "9")
        #     -> chac chan la 1 cell gia/so bi rung xuong nham cot ten, loai
        #     bo LUON bat ke gia co hop le hay khong.
        #   - "sku" la 1 chuoi so/tien tran (kha nang la fragment) NHUNG
        #     hang KHONG co gia nao hop le di kem -> chac chan la dong rac
        #     mo coi, loai bo. Nguoc lai (co gia That kem theo, vd SKU so
        #     nguyen "2322" + gia 1.000.000) -> day la 1 SKU so THAT hop le,
        #     GIU LAI.
        if _looks_like_stray_numeric_or_currency(name):
            continue
        if _looks_like_stray_numeric_or_currency(sku) and not has_valid_price:
            continue

        if net_price is None and list_price is not None:
            net_price = list_price * (1 - discount / 100)
        if list_price is None and net_price is not None:
            list_price = net_price
        parsed.append({
            "sku": sku,
            "name": name or sku,
            "description": cell("description"),
            "quantity": _parse_number(cell("quantity")) or 1,
            "uom": cell("uom"),
            "brand": cell("brand"),
            "currency": (cell("currency") or default_currency or "VND").upper(),
            "list_price": list_price,
            "discount_percent": discount,
            "net_price": net_price,
            "vat_rate": _parse_number(cell("vat_rate")),
        })
    return parsed


def _fallback_parse_table(text: str) -> list:
    """Deterministic fallback for real table text extracted from Excel/PDF
    khong doc duoc bang cau truc that (vd PDF scan roi ve text thuan). Van
    dung pipe-text vi day la duong danh cho truong hop KHONG co bang that -
    khong ap dung duoc cho PDF co bang that (xem extract_tables_from_pdf +
    _rows_to_items, la duong CHINH cho PDF, giu nguyen ranh gioi cell that).
    """
    rows = [
        [cell.strip() for cell in line.split("|")]
        for line in text.splitlines()
        if "|" in line and any(cell.strip() for cell in line.split("|"))
    ]
    if not rows:
        return []
    return _rows_to_items(rows)


class VendorAIParsingService:
    @staticmethod
    def extract_from_excel(file_bytes: bytes) -> str:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            text = ""
            for sheet in wb.worksheets:
                for row in sheet.iter_rows(values_only=True):
                    # Filter out completely empty rows
                    if any(cell is not None and str(cell).strip() != "" for cell in row):
                        text += " | ".join([str(cell).strip() if cell is not None else "" for cell in row]) + "\n"
            return text
        except Exception as e:
            logger.error(f"Excel extraction failed: {e}")
            raise ValueError(f"Không thể đọc file Excel: {e}")

    @staticmethod
    def extract_tables_from_pdf(file_bytes: bytes) -> list:
        """Tra ve MOI bang pdfplumber tim thay, GIU NGUYEN ranh gioi
        rows/cells that (khong flatten thanh 1 chuoi pipe-text). Day la
        duong parse CHINH cho PDF dang bang that - deterministic, khong can
        AI. Newline noi bo trong 1 cell (vd cot DESCRIPTION wrap 2 dong
        trong PDF) duoc gop thanh 1 khoang trang - day chinh la nguyen nhan
        that gay bug "1 hang bi tach thanh 2 hang, cac cot bi lech" da audit
        (PDF that Allied Telesis: 4 dong san pham that bi tach thanh 11 dong
        vi hang 1 va hang 2 co description 2 dong)."""
        tables: list = []
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables():
                    cleaned = [
                        [" ".join(str(cell).split()) if cell is not None else "" for cell in row]
                        for row in table
                    ]
                    tables.append(cleaned)
        return tables

    @staticmethod
    def extract_from_pdf(file_bytes: bytes) -> str:
        text = ""
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for page in pdf.pages:
                    # Try to extract tables first, if not fallback to text
                    tables = page.extract_tables()
                    if tables:
                        for table in tables:
                            for row in table:
                                # Gop newline NOI BO trong 1 cell (vd cell
                                # DESCRIPTION wrap nhieu dong) thanh 1 khoang
                                # trang truoc khi noi hang bang " | " - neu
                                # khong, 1 hang that se bi splitlines() tach
                                # thanh nhieu "hang" gia, lam lech cot (bug
                                # that da audit). Day chi la duong text du
                                # phong/excerpt - duong parse CHINH cho PDF
                                # dung extract_tables_from_pdf() + _rows_to_items().
                                cells = [" ".join(str(cell).split()) if cell is not None else "" for cell in row]
                                text += " | ".join(cells) + "\n"
                    else:
                        page_text = page.extract_text()
                        if page_text: text += page_text + "\n"
            return text
        except Exception as e:
            logger.error(f"PDF extraction failed: {e}")
            raise ValueError(f"Không thể đọc file PDF: {e}")

    @staticmethod
    async def normalize_text_with_llm(text: str) -> list:
        try:
            chunks = chunk_text(text)
            all_items = []

            for chunk in chunks:
                if not chunk.strip(): continue
                if settings.gemini_api_key:
                    model = genai.GenerativeModel('gemini-1.5-flash', system_instruction=SYSTEM_PROMPT)
                    response = model.generate_content(
                        f"Trich xuat JSON tu du lieu sau:\n\n{chunk}",
                        generation_config={"temperature": 0.1}
                    )
                    resp_text = response.text.strip()
                elif settings.openai_api_key:
                    url = f"{settings.openai_base_url}/chat/completions"
                    headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
                    body = {
                        "model": settings.ai_model,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": f"Trich xuat JSON tu du lieu sau:\n\n{chunk}"},
                        ],
                        "temperature": 0.1,
                        "max_tokens": 4000,
                        "response_format": {"type": "json_object"},
                    }
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        resp = await client.post(url, json=body, headers=headers)
                        resp.raise_for_status()
                    data = resp.json()
                    resp_text = data["choices"][0]["message"]["content"].strip()
                else:
                    all_items.extend(_fallback_parse_table(chunk))
                    continue
                if resp_text.startswith("```json"): resp_text = resp_text[7:]
                if resp_text.startswith("```"): resp_text = resp_text[3:]
                if resp_text.endswith("```"): resp_text = resp_text[:-3]
                resp_text = resp_text.strip()

                try:
                    parsed = json.loads(resp_text)
                    if isinstance(parsed, list):
                        all_items.extend(parsed)
                    elif isinstance(parsed, dict) and "items" in parsed:
                        all_items.extend(parsed["items"])
                except Exception as e:
                    logger.error(f"LLM JSON parse error for chunk: {e}")
            return all_items
        except Exception as e:
            logger.error(f"LLM Extraction failed: {e}")
            raise ValueError(f"AI Normalize failed: {e}")

    @staticmethod
    async def parse_file(file_bytes: bytes, file_type: str, file_name: str) -> list:
        ext = os.path.splitext(file_name)[1].lower()
        raw_text = ""

        if ext == '.pdf':
            # Duong CHINH cho PDF dang bang that: parse truc tiep tren cau
            # truc bang cua pdfplumber (giu nguyen ranh gioi cell that), KHONG
            # can AI de giu dung so dong/cot - "PDF nay la text/table PDF va
            # phai parse duoc deterministic khong can Gemini/OpenAI" (yeu cau
            # that). Chi roi xuong duong text+AI/fallback ben duoi neu KHONG
            # tim thay bang san pham hop le nao (vd PDF scan, khong co bang).
            tables = VendorAIParsingService.extract_tables_from_pdf(file_bytes)
            doc_currency = _detect_document_currency(tables)
            structured_items: list = []
            for table in tables:
                structured_items.extend(_rows_to_items(table, default_currency=doc_currency))
            raw_text = VendorAIParsingService.extract_from_pdf(file_bytes)
            if structured_items:
                return structured_items, raw_text
        elif ext in ['.xlsx', '.xls']:
            raw_text = VendorAIParsingService.extract_from_excel(file_bytes)
        elif ext in ['.jpg', '.jpeg', '.png']:
            # Fallback to Vision if needed, but for now we just throw error as it's advanced
            raise ValueError("Vision OCR cho hình ảnh đang được phát triển.")
        else:
            raise ValueError(f"Định dạng file {ext} chưa được hỗ trợ.")

        if not raw_text.strip():
            raise ValueError("Không tìm thấy text nào trong file.")

        normalized_items = await VendorAIParsingService.normalize_text_with_llm(raw_text)
        return normalized_items, raw_text
