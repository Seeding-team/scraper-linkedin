"""Pipeline mẫu DOCX -> (AI đề xuất) -> engine áp thay đổi -> DOCX chuẩn -> PDF (cùng nội dung) + báo cáo đối chiếu.

Không đọc/ghi DB. AI được tiêm qua tham số `propose` để test không cần mạng."""
from __future__ import annotations

from datetime import date
from typing import Any, Awaitable, Callable

from app.modules.all_platform.services import contract_docx_engine as eng
from app.modules.all_platform.services.contract_ai_service import (
    _format_deal_context, _format_quote_context, build_parties, propose_template_edits, validate_template_deletes,
    validate_template_edits, validate_template_inserts,
)

# `propose` co the tra ve list[dict] "edits" THUAN (kieu cu, van con dung trong nhieu test fake) hoac dict day du
# {"edits", "inserts", "deletes"} (propose_template_edits() that su goi AI) - render_from_template() tu nhan dien
# ca 2 dang de tuong thich nguoc, xem _normalize_propose_result().
Propose = Callable[[list[tuple[str, str]], "dict | None", "dict | None", "str | None"], Awaitable[list[dict] | dict]]


def _normalize_propose_result(raw: list[dict] | dict) -> dict:
    if isinstance(raw, list):
        return {"edits": raw, "inserts": [], "deletes": []}
    return {"edits": list(raw.get("edits") or []), "inserts": list(raw.get("inserts") or []), "deletes": list(raw.get("deletes") or [])}


def _parse_date(value: str | None) -> date | None:
    try:
        return date.fromisoformat((value or "")[:10]) if value else None
    except ValueError:
        return None


def crm_values(deal: dict | None, quote: dict | None, contract_number: str | None = None, contract_value: float | None = None, sign_date: str | None = None) -> dict[str, str]:
    """Giá trị cho placeholder {{khoa}} - CHỈ từ dữ liệu CRM đã có (không suy đoán)."""
    d = deal or {}
    q = quote or {}
    signed = _parse_date(sign_date)      # ngày ký chỉ điền khi người dùng cung cấp - hệ thống không tự lấy ngày hôm nay
    if contract_value not in (None, 0):
        value = eng._format_number(contract_value)
    else:
        value = eng._format_number(q.get("totalAmount")) if q.get("totalAmount") is not None else None
    raw = {
        "customer_name": d.get("customer_name"), "company_name": d.get("company_name") or d.get("customer_name"),
        "tax_code": d.get("tax_code"), "address": d.get("address"), "email": d.get("email"), "phone": d.get("phone"),
        "representative_position": d.get("position"), "contract_number": contract_number,
        "quote_number": q.get("quoteNumber"), "contract_value": value,
        "currency": (q.get("currency") or None),
        "subtotal_amount": eng._format_number(q.get("subtotalAmount"), q.get("currency") or "VND") if q.get("subtotalAmount") is not None else None,
        "vat_amount": eng._format_number(q.get("vatAmount"), q.get("currency") or "VND") if q.get("vatAmount") is not None else None,
        "total_amount": eng._format_number(q.get("totalAmount"), q.get("currency") or "VND") if q.get("totalAmount") is not None else None,
    }
    if signed:
        raw.update({"day": f"{signed.day:02d}", "month": f"{signed.month:02d}", "year": str(signed.year)})
    return {k: str(v) for k, v in raw.items() if v not in (None, "")}


def verify_structure(original: bytes, result: bytes) -> dict[str, Any]:
    """So dấu vân tay cấu trúc mẫu gốc với bản đã chỉnh. Chỉ bảng hạng mục được phép đổi SỐ HÀNG."""
    a, b = eng.fingerprint(eng.load_document(original)), eng.fingerprint(eng.load_document(result))
    diffs: list[str] = []
    for key in ("paragraphs", "sections", "pageBreaks", "sectPr", "numberedParagraphs", "styles"):
        if a[key] != b[key]:
            diffs.append(key)
    if len(a["tables"]) != len(b["tables"]) or any(x[1] != y[1] for x, y in zip(a["tables"], b["tables"])):
        diffs.append("tables(số bảng/số cột)")
    row_changed = [i for i, (x, y) in enumerate(zip(a["tables"], b["tables"])) if x[0] != y[0]]
    return {"preserved": not diffs, "differences": diffs, "rowCountChanged": row_changed}


async def render_from_template(
    docx_bytes: bytes, deal: dict | None, quote: dict | None, extra_prompt: str | None,
    contract_number: str | None = None, contract_value: float | None = None, propose: Propose = propose_template_edits, sign_date: str | None = None,
    items_table_index: int | None = None, issuer: dict | None = None, representative: dict | None = None,
) -> dict[str, Any]:
    original = bytes(docx_bytes)                              # bản gốc không bao giờ bị sửa: mọi thao tác chạy trên Document nạp từ bytes
    doc = eng.load_document(original)
    infos = eng.describe_paragraphs(doc)
    warnings: list[str] = []

    applied_ph, missing = eng.fill_placeholders(doc, crm_values(deal, quote, contract_number, contract_value, sign_date))
    if missing:
        warnings.append("Placeholder chưa có dữ liệu (giữ nguyên trong tài liệu, cần điền thủ công): " + ", ".join("{{%s}}" % k for k in missing))
    table_res = eng.fill_items_table(doc, quote, items_table_index)
    warnings += table_res["warnings"]

    # Mẫu tái sử dụng từ hợp đồng CŨ thường không dùng {{}} - MST/Địa chỉ/Người đại diện/SĐT/Email của Bên A/B nằm trong
    # bảng với chữ THẬT của khách hàng CŨ. Ghi đè bằng đúng dữ liệu Bên A/B của hợp đồng ĐANG tạo (cùng build_parties() mà
    # DOCX/PDF/Legal Check khác đang dùng) - tránh lộ thông tin khách hàng khác còn sót lại trong mẫu tái sử dụng.
    parties = build_parties(deal, quote, issuer, representative) if (deal or issuer) else None
    party_res = eng.fill_party_info_tables(doc, parties)
    if party_res["unresolvedTables"]:
        warnings.append(
            f"Mẫu có {party_res['unresolvedTables']} bảng giống thông tin Bên A/B nhưng không xác định được thuộc Bên nào "
            "(không có dòng 'BÊN A'/'BÊN B' ngay trước bảng) - hệ thống KHÔNG tự đoán, hãy kiểm tra tay bảng này trước khi gửi."
        )

    current = {p.id: p.text for p in eng.describe_paragraphs(doc)}
    editable = {p.id: current[p.id] for p in infos if p.text.strip() and not p.in_table and p.id in current}
    allowed_ctx = " ".join([_format_deal_context(deal), _format_quote_context(quote), extra_prompt or ""])
    accepted: list[dict] = []
    rejected: list[dict] = []
    accepted_inserts: list[dict] = []
    rejected_inserts: list[dict] = []
    accepted_deletes: list[dict] = []
    rejected_deletes: list[dict] = []
    if (extra_prompt or "").strip() or deal or quote:
        raw = _normalize_propose_result(await propose(list(editable.items()), deal, quote, extra_prompt))
        accepted, rejected = validate_template_edits(raw["edits"], editable, allowed_ctx)
        # "inserts"/"deletes" - AI de xuat THEM/XOA han 1 dieu khoan (khac "edits" chi sua noi dung doan CO SAN).
        # Truoc day pipeline nay khong co 2 kha nang nay, khien yeu cau "Them Dieu 9" bi am tham bo qua du prompt
        # da nhan dung yeu cau (bug "Bước 2 không ăn yêu cầu").
        accepted_inserts, rejected_inserts = validate_template_inserts(raw["inserts"], editable, allowed_ctx)
        accepted_deletes, rejected_deletes = validate_template_deletes(raw["deletes"], editable)
    applied_edits = eng.apply_edits(doc, accepted)
    structural = (
        eng.apply_structural_changes(doc, accepted_inserts, accepted_deletes)
        if (accepted_inserts or accepted_deletes) else {"inserted": [], "deletedCount": 0, "renumbered": 0}
    )
    if structural["inserted"]:
        warnings.append(f"Đã thêm {len(accepted_inserts)} điều khoản mới theo yêu cầu - kiểm tra lại nội dung trước khi lưu.")
    if structural["deletedCount"]:
        warnings.append(f"Đã xoá {structural['deletedCount']} đoạn theo yêu cầu xoá điều khoản.")
    if rejected_inserts:
        warnings.append("AI đề xuất thêm điều khoản bị từ chối: " + "; ".join(r.get("reason", "") for r in rejected_inserts))
    if rejected_deletes:
        warnings.append("AI đề xuất xoá điều khoản bị từ chối: " + "; ".join(r.get("reason", "") for r in rejected_deletes))
    result = eng.save_document(doc)
    structure = verify_structure(original, result)
    if not structure["preserved"]:
        # So doan (paragraphs) THAY DOI co chu dich khi Sale yeu cau them/xoa dieu khoan - khong phai loi, khong bao nhu
        # cac diff khac (vd mat section/page break moi la that su dang lo).
        diffs = list(structure["differences"])
        if (accepted_inserts or accepted_deletes) and "paragraphs" in diffs:
            diffs = [d for d in diffs if d != "paragraphs"]
        if diffs:
            warnings.append("Cấu trúc tài liệu sau chỉnh sửa khác mẫu ở: " + ", ".join(diffs))
    fonts = eng.font_report(result)
    if fonts["missing"]:
        warnings.append("Server thiếu font " + ", ".join(fonts["missing"]) + " - PDF có thể lệch bố cục so với Word.")
    return {
        "docx": result, "edits": applied_edits, "rejectedEdits": rejected,
        "inserts": structural["inserted"], "rejectedInserts": rejected_inserts,
        "deletedCount": structural["deletedCount"], "rejectedDeletes": rejected_deletes, "renumbered": structural["renumbered"],
        "placeholders": applied_ph, "missingPlaceholders": missing,
        "itemsTable": table_res, "partyTables": party_res, "structure": structure, "fonts": fonts, "warnings": warnings,
    }
