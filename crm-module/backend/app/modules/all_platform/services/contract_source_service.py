"""Kiểm tra NGUỒN dữ liệu của AI Contract Copilot ở backend (không chỉ frontend): Customer -> Deal -> Quote + thông tin pháp lý hai bên.

* Deal/Quote chỉ lấy trong workspace hiện tại (get_customer_lead_by_id / get_quote đều lọc theo instance và loại bản xoá mềm).
* Báo giá phải thuộc đúng Deal, trạng thái đã duyệt (approved/confirmed), không OUT (customer_outcome='lost'), không xoá.
* Thông tin pháp lý thiếu KHÔNG được bịa: phân loại 'blockers' (không thể tiếp tục) / 'required' (phải bổ sung hoặc xác nhận để trống) / 'optional'.
"""
from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.contract_ai_service import build_parties, resolve_representative

APPROVED_QUOTE_STATUSES = {"approved", "confirmed"}


class SourceError(ValueError):
    """Nguồn dữ liệu không hợp lệ (trả message tiếng Việt cho người dùng)."""


def list_customer_deals(customer_id: str) -> list[dict[str, Any]]:
    rows = (
        get_supabase_client().table("customer_leads").select("id, customer_id, deal_stage")
        .eq("customer_id", customer_id).eq("instance", settings.crm_instance).execute().data or []
    )
    return rows


def _fetch_customer_and_contact(deal: dict[str, Any], contact_id: str | None = None) -> tuple[dict | None, dict | None]:
    sb = get_supabase_client()
    customer = contact = None
    if deal.get("customer_id"):
        rows = sb.table("crm_customers").select("customer_name, company_name, tax_code, address, phone, email, position").eq("id", deal["customer_id"]).limit(1).execute().data or []
        customer = rows[0] if rows else None
    # contact_id tường minh (Sale chọn ở Copilot khi khách có nhiều Contact) thắng liên hệ chính mặc định của Deal.
    cid = contact_id or deal.get("primary_contact_id")
    if cid:
        rows = sb.table("crm_contacts").select("id, name, position, phone, email").eq("id", cid).limit(1).execute().data or []
        contact = rows[0] if rows else None
    return customer, contact


def enrich_deal(deal: dict[str, Any], contact_id: str | None = None) -> dict[str, Any]:
    """Thông tin pháp lý nằm ở Customer 360 (crm_customers) và Contact đã chọn (Người liên hệ của Deal, hoặc contact_id tường minh);
    bản ghi Deal có thể để trống. CHỈ điền vào ô còn trống từ nguồn CRM thật (không ghi đè dữ liệu có sẵn của Deal, không suy đoán).

    Phân biệt rõ 2 nhóm trường (không trộn Customer/Contact):
    - Tên pháp nhân/MST/địa chỉ (company_name/tax_code/address): LUÔN lấy từ Customer (doanh nghiệp/pháp nhân) - không bao giờ lấy
      từ Contact. Khách cá nhân (không company_name riêng) thì company_name = chính customer_name của hồ sơ khách hàng.
    - Họ tên người liên hệ (contact_name)/chức vụ/SĐT/email: ưu tiên Contact đã chọn trước; chỉ dùng số liệu của Customer khi
      Contact không có (vd khách cá nhân tự giao dịch, không có Contact riêng)."""
    try:
        customer, contact = _fetch_customer_and_contact(deal, contact_id)
    except Exception:  # noqa: BLE001  (lỗi đọc thêm không được làm hỏng luồng: giữ nguyên dữ liệu Deal, thiếu sẽ bị cảnh báo)
        return deal
    out = dict(deal)
    if customer and not str(customer.get("company_name") or "").strip() and str(customer.get("customer_name") or "").strip():
        customer = {**customer, "company_name": customer["customer_name"]}
        # Đánh dấu rõ đây là khách CÁ NHÂN (company_name chỉ là customer_name điền tạm cho đủ tên pháp lý, KHÔNG phải doanh
        # nghiệp thật) - để resolve_representative() không nhầm "có company_name" = doanh nghiệp khi suy ra người đại diện ký.
        out["customer_kind"] = "individual"
    for key in ("company_name", "tax_code", "address"):
        if not str(out.get(key) or "").strip() and customer and str(customer.get(key) or "").strip():
            out[key] = customer[key]
    if contact and str(contact.get("name") or "").strip() and not str(out.get("contact_name") or "").strip():
        out["contact_name"] = contact["name"]
        out["contact_id"] = contact.get("id")
    for key in ("position", "phone", "email"):
        if not str(out.get(key) or "").strip():
            src = contact if (contact and str(contact.get(key) or "").strip()) else customer
            if src and str(src.get(key) or "").strip():
                out[key] = src[key]
    return out


def money_tokens_text(quote: dict | None, deal: dict | None = None, issuer: dict | None = None) -> str:
    """Chuỗi chứa mọi con số HỢP LỆ từ nguồn CRM: tiền/VAT/số lượng của báo giá (cả dạng 111.375.177) + MST/SĐT/địa chỉ hai bên. Dùng làm 'nguồn cho phép'
    khi kiểm tra số liệu AI viết ra (không để số lấy từ nguồn thật bị báo nhầm)."""
    def fmt(v: Any) -> str:
        try:
            n = float(v)
        except (TypeError, ValueError):
            return ""
        return f"{int(round(n)):,}".replace(",", ".") if n == int(n) else f"{n:.2f}"

    parts: list[str] = []
    if quote:
        for k in ("subtotalAmount", "vatAmount", "totalAmount"):
            parts.append(fmt(quote.get(k)))
        for i in quote.get("items") or []:
            for k in ("quantity", "unitPrice", "amountAfterDiscount", "totalAmount", "vatAmount", "subtotalAmount"):
                parts.append(fmt(i.get(k)))
            parts.append(f"{fmt(i.get('vatRate'))}%" if i.get("vatRate") is not None else "")
            parts.append(f"{i.get('description') or ''} {i.get('serviceDescription') or ''}")
        parts.append(str(quote.get("quoteNumber") or ""))
    if deal or issuer:
        p = build_parties(deal, quote, issuer)
        parts.append(" ".join(str(v) for side in (p["a"], p["b"]) for v in side.values()))
    return " ".join(x for x in parts if x)


def check_quote_for_deal(quote: dict[str, Any] | None, deal_id: str) -> None:
    """Hàm thuần: ném SourceError nếu báo giá không dùng được cho hợp đồng của Deal này."""
    if not quote:
        raise SourceError("Không tìm thấy báo giá trong workspace này (có thể đã bị xoá).")
    if quote.get("deletedAt") or quote.get("deleted_at"):
        raise SourceError("Báo giá đã bị xoá.")
    if (quote.get("customerOutcome") or quote.get("customer_outcome")) == "lost":
        raise SourceError("Báo giá đã đánh dấu OUT (không chốt) - không dùng để soạn hợp đồng.")
    if str(quote.get("status")) not in APPROVED_QUOTE_STATUSES:
        raise SourceError(f"Báo giá chưa được duyệt (trạng thái: {quote.get('status')}) - chỉ báo giá đã duyệt mới dùng được.")
    qdeal = quote.get("dealId") or quote.get("deal_id")
    if str(qdeal or "") != str(deal_id or ""):
        raise SourceError("Báo giá không thuộc Deal đã chọn.")


def resolve_source(
    deal_id: str | None, quote_id: str | None, customer_id: str | None = None, *, require_deal: bool = False,
    contact_id: str | None = None,
) -> tuple[dict | None, dict | None]:
    """-> (deal, quote). Ném SourceError khi sai/thiếu. customer_id (Customer 360) buộc phải chọn Deal."""
    from app.modules.all_platform.services import get_quote
    from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id

    if (customer_id or require_deal) and not deal_id:
        deals = list_customer_deals(customer_id) if customer_id else []
        if not deals:
            raise SourceError("Khách hàng chưa có Deal (cơ hội) nào - hãy tạo Deal trước khi soạn hợp đồng.")
        raise SourceError(f"Khách hàng có {len(deals)} Deal - phải chọn đúng Deal trước khi tạo bản nháp.")
    deal = None
    if deal_id:
        deal = get_customer_lead_by_id(deal_id)
        if not deal:
            raise SourceError("Deal không tồn tại trong workspace này.")
        if customer_id and str(deal.get("customer_id") or "") != str(customer_id):
            raise SourceError("Deal không thuộc khách hàng đang chọn.")
        deal = enrich_deal(deal, contact_id=contact_id)
    quote = None
    if quote_id:
        if not deal_id:
            raise SourceError("Phải chọn Deal trước khi chọn báo giá.")
        try:
            quote = get_quote(quote_id)
        except Exception as exc:  # QuoteNotFoundError và lỗi tương tự -> coi là không tìm thấy trong workspace
            if exc.__class__.__name__ == "QuoteNotFoundError":
                raise SourceError("Không tìm thấy báo giá trong workspace này (có thể đã bị xoá).") from exc
            raise
        check_quote_for_deal(quote, deal_id)
    return deal, quote


def legal_gaps(deal: dict | None, quote: dict | None, issuer: dict | None, representative: dict | None = None) -> dict[str, Any]:
    """Phân loại trường pháp lý còn thiếu. Dữ liệu lấy đúng như build_parties (CRM + form báo giá + đơn vị phát hành), không suy đoán.

    Tên/MST/địa chỉ hai bên là 'required' (phải bổ sung hoặc xác nhận để trống mới tạo được nháp). Người đại diện ký Bên A/B và
    thông tin liên hệ (chức vụ/SĐT/email) KHÔNG chặn tạo nháp - chỉ bắt buộc khi gửi duyệt/ký (xem contract_approval_service),
    vì Người liên hệ của Deal không mặc nhiên có quyền đại diện ký, cần Sale xác nhận rõ ràng, không phải checkbox vượt qua."""
    rep = representative if representative is not None else resolve_representative(deal or {})
    p = build_parties(deal, quote, issuer, rep)
    a, b = p["a"], p["b"]
    blockers: list[dict[str, str]] = []
    required: list[dict[str, str]] = []
    optional: list[dict[str, str]] = []

    def add(bucket: list, side: str, key: str, label: str, source: str) -> None:
        bucket.append({"side": side, "field": key, "label": label, "source": source})

    # Thiếu thông tin pháp lý KHÔNG chặn tạo nháp (chỉ sai Customer/Deal/Quote mới chặn): phải bổ sung hoặc xác nhận để trống; gửi duyệt mới bắt buộc đủ.
    if not a["name"]:
        add(required, "A", "name", "Tên pháp lý Bên A (khách hàng)", "Thông tin doanh nghiệp của khách hàng")
    for key, label in (("tax_code", "Mã số thuế Bên A"), ("address", "Địa chỉ Bên A")):
        if not a[key]:
            add(required, "A", key, label, "Thông tin doanh nghiệp của khách hàng")
    for key, label in (("name", "Tên pháp lý Bên B (đơn vị phát hành báo giá)"), ("tax_code", "Mã số thuế Bên B"), ("address", "Địa chỉ Bên B")):
        if not b[key]:
            add(required, "B", key, label, "Đơn vị phát hành báo giá")
    # Người đại diện ký Bên A: chưa có ai -> cần chọn; có gợi ý từ Người liên hệ nhưng CHƯA xác nhận -> cần xác nhận (2 tình huống khác nhau).
    if not rep.get("name"):
        add(optional, "A", "rep", "Người đại diện ký Bên A", "Chưa chọn người đại diện ký hợp đồng")
    elif not rep.get("confirmed"):
        # Lo ten NGAY trong dong gap (khong chi noi "co goi y") - Sale thay duoc AI dang de xuat AI ma khong phai mo
        # "Bo sung thong tin" long nhau de xem (feedback: "co thay dau bro" khi chi ghi chung chung).
        rep_source = f"Gợi ý từ người liên hệ: {rep.get('name')}" + (f" ({rep['position']})" if rep.get("position") else "") + " - cần Sale xác nhận trước khi gửi duyệt"
        add(optional, "A", "rep", "Xác nhận người đại diện ký Bên A", rep_source)
    for side, party in (("A", a), ("B", b)):
        for key, label in (("position", "Chức vụ người đại diện"), ("phone", "Điện thoại"), ("email", "Email")):
            if side == "A" and key == "position" and not rep.get("name"):
                continue  # đã báo ở mục "Người đại diện ký Bên A" rồi, khỏi lặp
            if not party[key]:
                add(optional, side, key, f"{label} Bên {side}", "Có thể để trống")
    if not b["rep"]:
        add(optional, "B", "rep", "Người đại diện Bên B", "Có thể để trống")
    return {"blockers": blockers, "required": required, "optional": optional, "representative": rep}


def payment_plan_mismatch_warning(quote: dict | None, clauses: list[dict]) -> list[str]:
    """So khớp % lịch thanh toán AI vừa viết ở Điều 3 với lịch thanh toán THẬT của báo giá (quote.data.paymentPlan, Sale đã nhập khi
    duyệt báo giá) - KHÔNG chặn tạo nháp (chỉ cảnh báo để Sale xem lại/xác nhận trước khi lưu, đúng quy tắc 'không chặn tạo nháp
    chỉ vì thiếu xác nhận không bắt buộc'). Dùng Decimal, không suy đoán - chỉ báo khi có đủ dữ liệu cả 2 phía để so sánh thật."""
    from decimal import Decimal

    from app.modules.all_platform.services.contract_docx_builder import parse_payment_plan

    plan = ((quote or {}).get("data") or {}).get("paymentPlan")
    if not isinstance(plan, list) or not plan:
        return []
    quote_pcts = sorted(Decimal(str(p.get("percent"))) for p in plan if p.get("percent") is not None)
    if not quote_pcts:
        return []
    payment_clause = next((c for c in clauses if "GIÁ TRỊ" in (c.get("title") or "").upper() or "THANH TOÁN" in (c.get("title") or "").upper()),
                          clauses[2] if len(clauses) > 2 else None)
    if not payment_clause:
        return []
    found, _warn = parse_payment_plan(payment_clause.get("body") or "")
    if not found:
        return []
    draft_pcts = sorted(f["percent"] for f in found)
    if draft_pcts != quote_pcts:
        quote_text = "/".join(f"{p:g}%" for p in quote_pcts)
        draft_text = "/".join(f"{p:g}%" for p in draft_pcts)
        return [f"Lịch thanh toán trong bản nháp ({draft_text}) khác lịch thanh toán đã lưu trên báo giá ({quote_text}) - "
                f"hãy xem lại Điều 3 và xác nhận trước khi lưu hợp đồng."]
    return []


def enforce_gaps(gaps: dict, acknowledged: bool) -> None:
    """Trường 'required' còn thiếu: chỉ được tiếp tục khi người dùng đã xác nhận để trống (………). Blockers luôn chặn."""
    if gaps["blockers"]:
        raise SourceError("Thiếu thông tin bắt buộc: " + "; ".join(g["label"] for g in gaps["blockers"]))
    if gaps["required"] and not acknowledged:
        raise SourceError("Còn thiếu thông tin pháp lý cần bổ sung: " + "; ".join(g["label"] for g in gaps["required"]) +
                          ". Hãy bổ sung ở Customer 360 hoặc xác nhận để trống (………) rồi tạo lại.")


# ───────────── kiểm tra thay đổi điều khoản (AI chỉnh từng phần) ─────────────
SENSITIVE_TOPICS = {
    "thanh toán": "thanh toán", "phạt": "phạt vi phạm", "bồi thường": "bồi thường", "chấm dứt": "chấm dứt hợp đồng", "bảo hành": "bảo hành",
    "bảo mật": "bảo mật", "thời hạn": "thời hạn", "tiến độ": "tiến độ", "nghiệm thu": "nghiệm thu", "trách nhiệm": "trách nhiệm",
    "vat": "thuế/VAT", "thuế": "thuế/VAT", "giá trị hợp đồng": "giá trị hợp đồng", "tranh chấp": "giải quyết tranh chấp",
}


def edit_risk_flags(before: str, after: str, allowed_context: str) -> dict[str, Any]:
    """Cờ cảnh báo cho 1 thay đổi: số liệu mới/đổi (tiền, %, thời hạn) và chủ đề pháp lý nhạy cảm bị chạm tới. Không tự chặn - người dùng phải xem và duyệt;
    chỉ 'blocked' khi xuất hiện số liệu KHÔNG có trong đoạn gốc / CRM / yêu cầu người dùng."""
    from app.modules.all_platform.services.contract_ai_service import numeric_tokens

    b_nums, a_nums, ctx = numeric_tokens(before), numeric_tokens(after), numeric_tokens(allowed_context)
    new_nums = sorted(a_nums - b_nums)
    removed = sorted(b_nums - a_nums)
    invented = sorted(n for n in new_nums if n not in ctx)
    low_b, low_a = before.lower(), after.lower()
    topics = sorted({label for kw, label in SENSITIVE_TOPICS.items() if (kw in low_b or kw in low_a)})
    flags: list[str] = []
    if new_nums or removed:
        flags.append("Thay đổi số liệu (tiền/tỷ lệ/thời hạn): " + ", ".join([f"+{n}" for n in new_nums] + [f"-{n}" for n in removed]))
    if topics and (low_b != low_a):
        flags.append("Chạm tới nội dung pháp lý nhạy cảm: " + ", ".join(topics))
    return {"flags": flags, "newNumbers": new_nums, "removedNumbers": removed, "inventedNumbers": invented, "blocked": bool(invented),
            "needsCareReview": bool(flags)}
