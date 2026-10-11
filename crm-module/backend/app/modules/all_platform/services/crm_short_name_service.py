"""Tên viết tắt (short_name) của khách hàng doanh nghiệp - đề xuất tự động.

Thứ tự ưu tiên:
  1) Thương hiệu / tên giao dịch ĐÃ CÓ trong dữ liệu (crm_customers.short_name khác) xuất hiện nguyên vẹn trong tên công ty.
  2) Quy tắc: mã viết tắt trong ngoặc "(CPC)"; bỏ phần sau " - Chi nhánh ..."; bỏ tiền tố pháp lý (Công ty TNHH/Cổ phần/Tập đoàn...)
     và các từ mô tả ngành ở đầu (Thương mại, Dịch vụ, Công nghệ, Giải pháp...); bỏ hậu tố "Việt Nam".
  3) Tên quá dài và quy tắc không chắc chắn -> nhờ AI (OpenAI-compatible, nếu đã cấu hình) rút gọn, nhưng CHỈ nhận kết quả dùng
     toàn từ có trong tên gốc (không bịa thương hiệu). AI lỗi / không cấu hình / kết quả không hợp lệ -> fallback ổn định theo quy tắc.
  4) Không đủ căn cứ -> giữ tên (đã bỏ tiền tố/chi nhánh), KHÔNG lấy chữ cái đầu máy móc.

`customer_name` KHÔNG bị đổi bởi module này: người dùng sửa tay -> `short_name_manual = true` và hệ thống không bao giờ tự ghi đè.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any

import httpx

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

MAX_SHORT_LEN = 30

_LEGAL_PREFIXES = sorted(
    [
        "CONG TY TNHH MOT THANH VIEN", "CONG TY TRACH NHIEM HUU HAN MOT THANH VIEN", "CONG TY TRACH NHIEM HUU HAN", "CONG TY CO PHAN",
        "CONG TY TNHH MTV", "CONG TY HOP DANH", "CONG TY TNHH", "CONG TY CP", "TONG CONG TY", "CONG TY", "DOANH NGHIEP TU NHAN",
        "HO KINH DOANH", "CHI NHANH", "VAN PHONG DAI DIEN", "TAP DOAN", "DNTN", "CTCP", "TNHH", "MTV", "JSC", "CO., LTD", "CO LTD", "LTD",
        "COMPANY LIMITED", "CORPORATION", "CORP", "INC",
    ],
    key=len,
    reverse=True,
)
# Tu mo ta nganh hay gap o DAU ten (sau loai hinh) - bo di de lo ra ten rieng/thuong hieu. Khong dua tu mo ho nhu "Dien", "Hoc", "Tong".
_GENERIC_WORDS = {
    "THUONG", "MAI", "VA", "SAN", "XUAT", "DICH", "VU", "DAU", "TU", "NHAP", "KHAU", "CONG", "NGHE", "GIAI", "PHAP", "TIEP", "THI", "PHAT",
    "TRIEN", "XAY", "DUNG", "VAN", "TAI", "QUANG", "CAO", "TRUYEN", "THONG", "KY", "THUAT", "PHAN", "MEM", "TIN", "THIET", "KE",
    "CHUYEN", "DOI", "SO", "GROUP", "HOLDING", "TECHNOLOGY", "SOLUTIONS", "SERVICES", "TRADING", "TUVAN", "NOI", "NGOAI", "THAT",
}
_SAFE_GENERIC = _GENERIC_WORDS
_ORG_MARKERS = (
    "CONG TY", "TRUNG TAM", "TRUONG", "BENH VIEN", "TONG CONG TY", "TAP DOAN", "NGAN HANG", "HO KINH DOANH", "DOANH NGHIEP", "CHI NHANH",
    "HOC VIEN", "VIEN ", "UBND", "SO ", "PHONG ", "HOP TAC XA", "DNTN", "CTCP", "TNHH", "JSC", "LTD",
)
_SEPARATORS = (" - ", " – ", " — ", " | ", ", ")


def fold(text: str) -> str:
    """Bo dau tieng Viet, giu nguyen do dai (tung ky tu), viet hoa."""
    out = []
    for ch in text or "":
        if ch in ("đ", "Đ"):
            out.append("D")
            continue
        out.append(unicodedata.normalize("NFD", ch)[0].upper())
    return "".join(out)


def looks_like_enterprise(customer_name: str | None, company_name: str | None, tax_code: str | None) -> bool:
    """Khach hang doanh nghiep/to chuc (co ten cong ty, MST, hoac ten co tu khoa to chuc). Khach CA NHAN -> False (khong ep thanh cong ty)."""
    if (company_name or "").strip() or (tax_code or "").strip():
        return True
    name = fold((customer_name or "").strip()) + " "
    return any(marker in name for marker in _ORG_MARKERS)


def _strip_prefixes(text: str) -> str:
    rest = text.strip()
    for _ in range(4):
        rf = fold(rest)
        hit = next((p for p in _LEGAL_PREFIXES if rf == p or rf.startswith(p + " ")), None)
        if not hit:
            break
        rest = rest[len(hit):].strip(" ,.-")
    return rest


def _strip_generic(text: str) -> str:
    words = text.split()
    folded = [fold(w) for w in words]
    start = 0
    while start < len(words) - 1 and folded[start] in _SAFE_GENERIC:
        start += 1
    return " ".join(words[start:]) if start else text


def _strip_suffix(text: str) -> str:
    rest = text
    for suffix in ("VIET NAM", "VIETNAM", "CO., LTD", "CO.,LTD", "JSC"):
        rf = fold(rest)
        if rf.endswith(" " + suffix) and len(rest) > len(suffix) + 2:
            rest = rest[: -len(suffix)].strip(" ,.-")
    return rest


def rule_suggest(company_name: str) -> dict[str, Any]:
    """Quy tac thuan (khong AI, khong DB). Tra ve {suggestion, source, confident}."""
    original = re.sub(r"\s+", " ", (company_name or "").strip())
    if not original:
        return {"suggestion": "", "source": "empty", "confident": True}

    paren = re.search(r"\(([A-ZĐ0-9]{2,8})\)", original)
    if paren:
        return {"suggestion": paren.group(1), "source": "rule", "confident": True}

    text = original
    for sep in _SEPARATORS:  # bo phan "- Chi nhanh ..." phia sau
        if sep in text:
            left = text.split(sep, 1)[0].strip()
            if len(left) >= 6:
                text = left
    stripped = _strip_prefixes(text) or text
    had_prefix = stripped != text
    stripped = _strip_suffix(stripped) or stripped
    # Chi bo tu mo ta nganh khi ten co loai hinh doanh nghiep o dau ("Cong ty ... Thuong mai Dich vu X"); ten khong co loai hinh
    # (vd "Cao Son", "Van Phong") thi giu nguyen de khong cat nham ten rieng.
    candidate = (_strip_generic(stripped) or stripped) if had_prefix else stripped
    if candidate and len(candidate) <= MAX_SHORT_LEN:
        return {"suggestion": candidate, "source": "rule", "confident": True}

    words = candidate.split()
    caps = [w for w in words if re.fullmatch(r"[A-ZĐ0-9&.-]{2,8}", w) and fold(w) not in _GENERIC_WORDS]
    if caps:
        return {"suggestion": caps[-1], "source": "rule", "confident": True}
    return {"suggestion": candidate, "source": "keep", "confident": False}


def is_brand_of(name: str, company: str) -> bool:
    """customer_name co phai ten thuong hieu/ten giao dich cua cong ty (vd STARTECH ~ "CONG TY TNHH STARTECH SOLUTIONS", DENFOOD ~ "DEN FOOD")?
    Khong thi (vd ten nguoi lien he "Anh Dung" gan voi "So Giao duc Nghe An") thi khong dung lam ten viet tat."""
    a = re.sub(r"[^A-Z0-9]", "", fold(name or ""))
    b = re.sub(r"[^A-Z0-9]", "", fold(company or ""))
    return bool(a) and bool(b) and (a in b or b in a)


def _known_brands(exclude_customer_id: str | None = None) -> list[str]:
    try:
        rows = execute_supabase_query(
            lambda: get_supabase_client().table("crm_customers").select("id, short_name").eq("instance", settings.crm_instance).not_.is_("short_name", "null").execute()
        ).data or []
    except Exception:  # noqa: BLE001 - cot short_name chua co (chua chay migration 181)
        return []
    return [r["short_name"] for r in rows if r.get("short_name") and r.get("id") != exclude_customer_id]


def brand_match(company_name: str, brands: list[str]) -> str | None:
    """Thuong hieu da co (short_name khac) xuat hien nguyen ven (theo tu) trong ten cong ty -> dung lai de dong nhat."""
    company_f = f" {fold(company_name)} "
    best: str | None = None
    for brand in brands:
        bf = fold(brand).strip()
        if len(bf) < 3 or bf in _GENERIC_WORDS:
            continue
        if f" {bf} " in company_f and (best is None or len(bf) > len(fold(best))):
            best = brand
    return best


def _ai_suggest(company_name: str) -> str | None:
    """Nho AI rut gon (OpenAI-compatible). Chi nhan ket qua dung TOAN TU co trong ten goc; moi loi -> None (fallback quy tac)."""
    if not settings.openai_api_key:
        return None
    system = (
        "Bạn rút gọn TÊN CÔNG TY thành tên thương hiệu/tên giao dịch ngắn gọn dễ nhận diện để hiển thị trong danh sách. "
        "Quy tắc: bỏ tiền tố pháp lý (Công ty TNHH, Cổ phần, Tập đoàn...), bỏ phần mô tả ngành, giữ phần tên riêng nổi bật. "
        "CHỈ dùng các từ có sẵn trong tên gốc, tối đa 4 từ; tuyệt đối không bịa thương hiệu hay chữ viết tắt không có trong tên. "
        "Nếu không chắc, trả lại phần tên riêng dài nhất có thể. Trả về DUY NHẤT JSON: {\"short_name\": \"...\"}."
    )
    try:
        resp = httpx.post(
            f"{settings.openai_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
            json={
                "model": settings.ai_model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": company_name}],
                "temperature": 0,
                "max_tokens": 60,
                "response_format": {"type": "json_object"},
            },
            timeout=8.0,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        value = str(json.loads(raw).get("short_name") or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.info("short_name AI khong dung duoc (%s) -> fallback quy tac", exc)
        return None
    if not value or len(value) > MAX_SHORT_LEN + 10 or len(value) >= len(company_name):
        return None
    source_words = set(fold(company_name).replace("(", " ").replace(")", " ").split())
    if not all(w in source_words for w in fold(value).split()):  # co tu khong co trong ten goc -> bo
        return None
    return value


def suggest_short_name(company_name: str, *, customer_id: str | None = None, use_ai: bool = True) -> dict[str, Any]:
    """Đề xuất tên viết tắt. Trả về {suggestion, source: brand|rule|ai|keep|empty}. KHÔNG ghi DB."""
    name = (company_name or "").strip()
    if not name:
        return {"suggestion": "", "source": "empty"}
    brand = brand_match(name, _known_brands(customer_id))
    if brand:
        return {"suggestion": brand, "source": "brand"}
    result = rule_suggest(name)
    if not result["confident"] and use_ai:
        ai = _ai_suggest(name)
        if ai:
            return {"suggestion": ai, "source": "ai"}
    return {"suggestion": result["suggestion"], "source": result["source"]}


def fill_short_name_for_new(data: dict[str, Any]) -> None:
    """Tao khach hang moi: chua co short_name + la doanh nghiep -> dien tu dong (quy tac/thuong hieu, KHONG AI de khong cham request tao)."""
    if (data.get("short_name") or "").strip():
        data["short_name"] = data["short_name"].strip()
        data.setdefault("short_name_manual", True)
        return
    if not looks_like_enterprise(data.get("customer_name"), data.get("company_name"), data.get("tax_code")):
        return
    base = (data.get("company_name") or data.get("customer_name") or "").strip()
    out = suggest_short_name(base, use_ai=False)
    if out["suggestion"]:
        data["short_name"] = out["suggestion"]
        data["short_name_manual"] = False


def ensure_short_name(customer_id: str) -> str | None:
    """Khach hang vua tao (convert/tao kem co hoi...) chua co ten viet tat + la doanh nghiep -> dien (quy tac). Khong ghi de gia tri da co."""
    supabase = get_supabase_client()
    rows = execute_supabase_query(
        lambda: supabase.table("crm_customers").select("id, customer_name, company_name, tax_code, short_name")
        .eq("id", customer_id).eq("instance", settings.crm_instance).limit(1).execute()
    ).data or []
    if not rows or (rows[0].get("short_name") or "").strip():
        return None
    row = rows[0]
    if not looks_like_enterprise(row.get("customer_name"), row.get("company_name"), row.get("tax_code")):
        return None
    suggestion = suggest_short_name(row.get("company_name") or row.get("customer_name") or "", customer_id=customer_id, use_ai=False)["suggestion"]
    if not suggestion:
        return None
    execute_supabase_query(
        lambda: supabase.table("crm_customers").update({"short_name": suggestion, "short_name_manual": False})
        .eq("id", customer_id).eq("instance", settings.crm_instance).is_("short_name", "null").execute()
    )
    return suggestion
