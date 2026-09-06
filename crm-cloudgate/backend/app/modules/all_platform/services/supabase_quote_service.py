"""Supabase-based Quote Forms + Quotes service — real báo giá gắn với customer_leads.

Response dicts dùng camelCase để khớp thẳng với các TS type QuoteForm/Quote/QuoteItem/
QuoteReference phía frontend (modules/quotes) — tránh phải map lại 2 lần.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client

from app.core.config import settings
from app.core.supabase_client import get_supabase_client

FORMS_TABLE = "quote_forms"
QUOTES_TABLE = "quotes"
ITEMS_TABLE = "quote_items"
ISSUER_COMPANIES_TABLE = "quote_issuer_companies"
# Việt Nam không có giờ mùa hè (DST) nên offset cố định +7 tương đương
# "Asia/Ho_Chi_Minh" và không cần dữ liệu tzdata của hệ điều hành (image
# production thiếu tzdata -> ZoneInfo() crash toàn bộ backend khi import).
VN_TZ = timezone(timedelta(hours=7))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _count_fields(sections: list[dict]) -> int:
    total = 0
    for section in sections or []:
        for f in section.get("fields", []):
            if f.get("type") == "repeater-table":
                total += len(f.get("config", {}).get("columns", []) or []) or 1
            else:
                total += 1
    return total


def _row_to_form(row: dict) -> dict:
    schema_json = row.get("schema_json") or {}
    sections = schema_json.get("sections") or []
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "description": row.get("description") or "",
        "status": row["status"],
        "isDefaultTemplate": row.get("is_default_template") or False,
        "issuerCompanyId": row.get("issuer_company_id"),
        "schemaVersion": row["schema_version"],
        "schemaJson": schema_json,
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "sectionCount": len(sections),
        "fieldCount": _count_fields(sections),
        "shareToken": row.get("share_token"),
        "shareEnabled": row.get("share_enabled") or False,
        "shareUrl": f"/public/quote-forms/{row['share_token']}" if row.get("share_token") else None,
    }


def _row_to_item(row: dict) -> dict:
    return {
        "id": row["id"],
        "quoteId": row["quote_id"],
        "parentItemId": row.get("parent_item_id"),
        "description": row.get("description") or "",
        "serviceDescription": row.get("service_description") or "",
        "unit": row.get("unit"),
        "quantity": float(row.get("quantity") or 0),
        "unitPrice": float(row.get("unit_price") or 0),
        "discountPercent": float(row.get("discount_percent") or 0),
        "discountAmount": float(row.get("discount_amount") or 0),
        "amountAfterDiscount": float(row.get("amount_after_discount") or 0),
        "vatRate": float(row.get("vat_rate") or 0),
        "subtotalAmount": float(row.get("subtotal_amount") or 0),
        "vatAmount": float(row.get("vat_amount") or 0),
        "totalAmount": float(row.get("total_amount") or 0),
        "sortOrder": row.get("sort_order") or 0,
        "catalogItemId": row.get("catalog_item_id"),
        "bundleSnapshot": row.get("bundle_snapshot"),
        "listPriceUsd": row.get("list_price_usd"),
        "unitPriceUsd": row.get("unit_price_usd"),
        "exchangeRate": row.get("exchange_rate"),
        "unitPriceVnd": row.get("unit_price_vnd"),
        "children": [],
    }


def _row_to_quote(row: dict, items: list[dict] | None = None) -> dict:
    return {
        "id": row["id"],
        "dealId": row.get("deal_id"),
        "quoteFormId": row["quote_form_id"],
        "issuerCompanyId": row.get("issuer_company_id"),
        "quoteNumber": row["quote_number"],
        "status": row["status"],
        "formSchemaVersion": row["form_schema_version"],
        "formSnapshot": row.get("form_snapshot") or {},
        "data": row.get("data") or {},
        "items": _quote_item_tree(items or []),
        "subtotalAmount": float(row.get("subtotal_amount") or 0),
        "vatAmount": float(row.get("vat_amount") or 0),
        "totalAmount": float(row.get("total_amount") or 0),
        "currency": row.get("currency") or "VND",
        "issuedAt": row.get("issued_at"),
        "validUntil": row.get("valid_until"),
        "createdById": row.get("created_by"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "updatedById": row.get("updated_by"),
        "approvedById": row.get("approved_by"),
        "approvedAt": row.get("approved_at"),
        "publicToken": row.get("public_token"),
        "publicUrl": f"/public/quotes/{row['public_token']}" if row.get("public_token") else None,
        "publicEnabled": row.get("public_enabled") if row.get("public_enabled") is not None else True,
        "versionChainId": row.get("version_chain_id"),
        "versionNumber": row.get("version_number") or 1,
        "parentQuoteId": row.get("parent_quote_id"),
    }


def _row_to_issuer_company(row: dict) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "legalName": row["legal_name"],
        "brandName": row.get("brand_name"),
        "address": row.get("address"),
        "contactName": row.get("contact_name"),
        "phone": row.get("phone"),
        "email": row.get("email"),
        "website": row.get("website"),
        "taxCode": row.get("tax_code"),
        "logoUrl": row.get("logo_url"),
        "defaultQuoteFormId": row.get("default_quote_form_id"),
        "status": row.get("status") or "active",
    }


def list_issuer_companies(include_inactive: bool = False) -> list[dict]:
    """Danh sách công ty phát hành báo giá (bên bán). Mặc định chỉ trả company
    active (dùng cho dropdown Bước 1 wizard) - trang quản trị mới cần cả
    inactive nên truyền include_inactive=True."""
    supabase: Client = get_supabase_client()
    query = supabase.table(ISSUER_COMPANIES_TABLE).select("*").eq("instance", settings.crm_instance)
    if not include_inactive:
        query = query.eq("status", "active")
    result = query.order("sort_order").execute()
    return [_row_to_issuer_company(row) for row in (result.data or [])]


def create_issuer_company(payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    insert_data = {
        "code": payload["code"],
        "legal_name": payload["legal_name"],
        "brand_name": payload.get("brand_name"),
        "address": payload.get("address"),
        "contact_name": payload.get("contact_name"),
        "phone": payload.get("phone"),
        "email": payload.get("email"),
        "website": payload.get("website"),
        "tax_code": payload.get("tax_code"),
        "logo_url": payload.get("logo_url"),
        "default_quote_form_id": payload.get("default_quote_form_id"),
        "status": payload.get("status") or "active",
        "sort_order": payload.get("sort_order") or 0,
        "instance": settings.crm_instance,
    }
    result = supabase.table(ISSUER_COMPANIES_TABLE).insert(insert_data).execute()
    return _row_to_issuer_company(result.data[0])


def update_issuer_company(company_id: str, payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    field_map = {
        "code": "code", "legal_name": "legal_name", "brand_name": "brand_name",
        "address": "address", "contact_name": "contact_name", "phone": "phone",
        "email": "email", "website": "website", "tax_code": "tax_code",
        "logo_url": "logo_url", "default_quote_form_id": "default_quote_form_id",
        "status": "status", "sort_order": "sort_order",
    }
    update_data = {field_map[k]: v for k, v in payload.items() if k in field_map and v is not None}
    # logo_url/website/... rong "" (xoa logo/field) van phai ap dung duoc - chi
    # loai None (khong gui field do len), khong loai chuoi rong.
    result = (
        supabase.table(ISSUER_COMPANIES_TABLE)
        .update(update_data)
        .eq("id", company_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    return _row_to_issuer_company(result.data[0])


def _quote_items(quote_id: str) -> list[dict]:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(ITEMS_TABLE)
        .select("*")
        .eq("quote_id", quote_id)
        .eq("instance", settings.crm_instance)
        .order("sort_order")
        .execute()
    )
    return result.data or []


def _quote_item_tree(rows: list[dict]) -> list[dict]:
    mapped = [_row_to_item(row) for row in rows]
    by_id = {item["id"]: item for item in mapped if item.get("id")}
    roots: list[dict] = []
    for item in mapped:
        parent_id = item.get("parentItemId")
        if parent_id and parent_id in by_id:
            by_id[parent_id].setdefault("children", []).append(item)
        else:
            roots.append(item)
    for item in mapped:
        item["children"] = sorted(item.get("children") or [], key=lambda child: child.get("sortOrder") or 0)
    return sorted(roots, key=lambda item: item.get("sortOrder") or 0)


def _slug_code(name: str) -> str:
    import re
    import unicodedata

    normalized = unicodedata.normalize("NFD", name)
    ascii_name = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    ascii_name = ascii_name.replace("đ", "d").replace("Đ", "D")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_name).strip("_").upper()
    return slug or "QUOTE_FORM"


def _unique_code(base_name: str, ignore_id: str | None = None) -> str:
    supabase: Client = get_supabase_client()
    base = _slug_code(base_name)
    candidate = base
    suffix = 2
    while True:
        query = supabase.table(FORMS_TABLE).select("id").eq("code", candidate).eq("instance", settings.crm_instance)
        existing = query.execute().data or []
        existing = [row for row in existing if row["id"] != ignore_id]
        if not existing:
            return candidate
        candidate = f"{base}_{suffix}"
        suffix += 1


def _next_quote_number() -> str:
    """Số báo giá = giờ tạo (giờ Việt Nam) dạng YYYYMMDDHHMM, vd "202608262135".
    Không có hậu tố nếu là báo giá đầu tiên tạo trong phút đó; nếu trùng phút với
    báo giá khác thì mới thêm hậu tố "-02", "-03"... (đếm từ 2, không phải từ 1 -
    báo giá đầu tiên trong phút luôn hiện số trần, không có "-01")."""
    supabase: Client = get_supabase_client()
    base = datetime.now(VN_TZ).strftime("%Y%m%d%H%M")
    result = (
        supabase.table(QUOTES_TABLE)
        .select("quote_number")
        .or_(f"quote_number.eq.{base},quote_number.like.{base}-%")
        .eq("instance", settings.crm_instance)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return base
    max_seq = 1
    for row in rows:
        number = row["quote_number"]
        if number == base:
            continue
        try:
            seq = int(number.rsplit("-", 1)[-1])
            max_seq = max(max_seq, seq)
        except (ValueError, IndexError):
            continue
    return f"{base}-{max_seq + 1:02d}"


def _validate_percent(value: Any, field_name: str) -> float:
    try:
        pct = float(value or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be between 0 and 100.") from exc
    if pct < 0 or pct > 100:
        raise ValueError(f"{field_name} must be between 0 and 100.")
    return pct


def _calculate_item(quantity: float, unit_price: float, vat_rate: float, discount_percent: float = 0) -> tuple[float, float, float, float, float]:
    subtotal = quantity * unit_price
    discount = subtotal * discount_percent / 100
    after_discount = subtotal - discount
    vat = after_discount * vat_rate / 100
    return subtotal, discount, after_discount, vat, after_discount + vat


def _calculate_totals(items: list[dict]) -> tuple[float, float, float]:
    subtotal = sum(i["subtotal"] for i in items)
    vat = sum(i["vat"] for i in items)
    return subtotal, vat, subtotal + vat


def _flatten_computed_items(raw_items: list[dict]) -> tuple[list[dict], float, float, float]:
    flattened: list[dict] = []
    subtotal = 0.0
    vat = 0.0
    total = 0.0

    def append_item(item: dict, parent_temp_index: int | None, sort_order: int) -> int:
        nonlocal subtotal, vat, total
        discount_percent = _validate_percent(item.get("discount_percent"), "discount_percent")
        vat_rate = _validate_percent(item.get("vat_rate"), "vat_rate")
        item_subtotal, item_discount, item_after_discount, item_vat, item_total = _calculate_item(
            float(item.get("quantity") or 0),
            float(item.get("unit_price") or 0),
            vat_rate,
            discount_percent,
        )
        row = {
            **item,
            "parent_temp_index": parent_temp_index,
            "sort_order": sort_order,
            "discount_percent": discount_percent,
            "vat_rate": vat_rate,
            "subtotal": item_subtotal,
            "discount": item_discount,
            "after_discount": item_after_discount,
            "vat": item_vat,
            "total": item_total,
        }
        flattened.append(row)
        subtotal += item_subtotal
        vat += item_vat
        total += item_total
        return len(flattened) - 1

    for parent_index, item in enumerate(raw_items):
        parent_flat_index = append_item(item, None, parent_index)
        for child_index, child in enumerate(item.get("children") or []):
            append_item(child, parent_flat_index, child_index)

    return flattened, subtotal, vat, total


def _clamp_discount_percent(value: Any) -> float:
    """Kẹp % giảm giá về [0, 100] - phòng payload gửi số âm/quá lớn làm tổng
    tiền ra số vô lý. Khớp clampDiscountPercent() phía frontend."""
    try:
        pct = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(100.0, pct))


def _apply_discount(subtotal: float, gross_vat: float, discount_percent: Any) -> tuple[float, float, float]:
    """Giảm giá % trên TỔNG TRƯỚC THUẾ (subtotal), VAT tính lại trên phần đã
    giảm. Vì giảm giá nhân đều lên mọi dòng và VAT mỗi dòng tuyến tính theo
    subtotal dòng đó, tổng VAT sau giảm = tổng VAT gốc × (1 - %/100) - đúng
    cho cả trường hợp các dòng có VAT % khác nhau (xem chứng minh trong
    quoteCalculations.ts phía frontend, cùng công thức).

    Trả về (discount_amount, vat_amount, total_amount)."""
    pct = _clamp_discount_percent(discount_percent)
    discount_amount = subtotal * pct / 100
    vat_amount = gross_vat * (100 - pct) / 100
    total_amount = subtotal - discount_amount + vat_amount
    return discount_amount, vat_amount, total_amount


def _calculate_villa_totals(solution_items: list[dict]) -> tuple[float, float, float]:
    total = sum(float(item.get("offerPrice") or 0) for item in solution_items)
    return total, 0, total


# ── Quote Forms ────────────────────────────────────────────────────────────

def list_quote_forms(status: str | None = None) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(FORMS_TABLE).select("*").neq("status", "archived").eq("instance", settings.crm_instance)
    if status:
        query = query.eq("status", status)
    result = query.order("updated_at", desc=True).execute()
    return [_row_to_form(row) for row in (result.data or [])]


def get_quote_form(form_id: str) -> dict:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(FORMS_TABLE)
        .select("*")
        .eq("id", form_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
    )
    return _row_to_form(result.data)


def get_public_quote_form(token: str) -> dict:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(FORMS_TABLE)
        .select("*")
        .eq("share_token", token)
        .eq("share_enabled", True)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
    )
    if not result.data:
        raise ValueError("Mẫu báo giá không tồn tại hoặc đã bị khóa.")
    return _row_to_form(result.data)


def create_quote_form(payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    insert_data = {
        "code": _unique_code(payload["name"]),
        "name": payload["name"],
        "description": payload.get("description") or "",
        "status": payload.get("status") or "active",
        "layout_type": payload.get("layout_type") or "cloudgate_standard_quote",
        "schema_version": payload.get("schema_version") or 1,
        "schema_json": payload["schema_json"],
        "issuer_company_id": payload.get("issuer_company_id"),
        "instance": settings.crm_instance,
    }
    result = supabase.table(FORMS_TABLE).insert(insert_data).execute()
    return _row_to_form(result.data[0])


def update_quote_form(form_id: str, payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    update_data = {k: v for k, v in payload.items() if v is not None}
    if "layout_type" in update_data and not update_data["layout_type"]:
        update_data.pop("layout_type")
    update_data["updated_at"] = _now_iso()
    result = (
        supabase.table(FORMS_TABLE)
        .update(update_data)
        .eq("id", form_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    return _row_to_form(result.data[0])


def delete_quote_form(form_id: str) -> dict:
    supabase: Client = get_supabase_client()
    has_quotes = (
        supabase.table(QUOTES_TABLE)
        .select("id")
        .eq("quote_form_id", form_id)
        .eq("instance", settings.crm_instance)
        .limit(1)
        .execute()
    )
    if has_quotes.data:
        result = (
            supabase.table(FORMS_TABLE)
            .update({"status": "archived", "updated_at": _now_iso()})
            .eq("id", form_id)
            .eq("instance", settings.crm_instance)
            .execute()
        )
        return {"deleted": False, "archived": True, "form": _row_to_form(result.data[0])}
    supabase.table(FORMS_TABLE).delete().eq("id", form_id).eq("instance", settings.crm_instance).execute()
    return {"deleted": True, "archived": False}


def duplicate_quote_form(form_id: str) -> dict:
    supabase: Client = get_supabase_client()
    source = (
        supabase.table(FORMS_TABLE)
        .select("*")
        .eq("id", form_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    insert_data = {
        "code": _unique_code(f"{source['name']}_COPY", ignore_id=form_id),
        "name": f"{source['name']} - Bản sao",
        "description": source.get("description") or "",
        "status": source["status"],
        "layout_type": source["layout_type"],
        "schema_version": source["schema_version"],
        "schema_json": source["schema_json"],
        "instance": settings.crm_instance,
    }
    result = supabase.table(FORMS_TABLE).insert(insert_data).execute()
    return _row_to_form(result.data[0])


def share_quote_form(form_id: str, enabled: bool = True) -> dict:
    supabase: Client = get_supabase_client()
    current = (
        supabase.table(FORMS_TABLE)
        .select("share_token")
        .eq("id", form_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    token = current.get("share_token") or secrets.token_urlsafe(16)
    result = (
        supabase.table(FORMS_TABLE)
        .update({"share_token": token, "share_enabled": enabled, "updated_at": _now_iso()})
        .eq("id", form_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    return _row_to_form(result.data[0])


# ── Quotes ─────────────────────────────────────────────────────────────────

def list_quotes(deal_id: str | None = None) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(QUOTES_TABLE).select("*").eq("instance", settings.crm_instance)
    if deal_id:
        query = query.eq("deal_id", deal_id)
    result = query.order("created_at", desc=True).execute()
    quotes = result.data or []
    return [_row_to_quote(row, _quote_items(row["id"])) for row in quotes]


def get_quote(quote_id: str) -> dict:
    supabase: Client = get_supabase_client()
    row = (
        supabase.table(QUOTES_TABLE)
        .select("*")
        .eq("id", quote_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    return _row_to_quote(row, _quote_items(quote_id))


def get_public_quote(token: str) -> dict:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(QUOTES_TABLE)
        .select("*")
        .eq("public_token", token)
        .eq("public_enabled", True)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
    )
    row = result.data
    # 'confirmed' = quote tao truoc migration 053 (luon duoc coi la da chot/cong khai
    # nhu cu, khong hoi to) - 'draft'/'cancelled' thi CHUA duoc xem cong khai, phai
    # qua approve_quote() truoc.
    if not row or row.get("status") not in ("approved", "confirmed"):
        raise ValueError("Báo giá chưa được phát hành.")
    return _row_to_quote(row, _quote_items(row["id"]))


def create_quote(payload: dict, created_by: str | None) -> dict:
    supabase: Client = get_supabase_client()
    form = (
        supabase.table(FORMS_TABLE)
        .select("*")
        .eq("id", payload["quote_form_id"])
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    if not form or form["status"] != "active":
        raise ValueError("Mẫu báo giá không còn hoạt động.")

    is_villa = form["layout_type"] == "villa_solution_package"
    data = dict(payload.get("data") or {})
    raw_items = payload.get("items") or []

    if is_villa:
        subtotal, vat, total = _calculate_villa_totals(data.get("solutionItems") or [])
        items_to_insert: list[dict] = []
    else:
        items_to_insert, subtotal, vat, total = _flatten_computed_items(raw_items)

    quote_number = _next_quote_number()
    now = _now_iso()
    insert_data = {
        "deal_id": payload.get("deal_id"),
        "quote_form_id": form["id"],
        "issuer_company_id": payload.get("issuer_company_id"),
        "quote_number": quote_number,
        "status": "draft",
        "form_schema_version": form["schema_version"],
        "form_snapshot": form["schema_json"],
        "data": {**data, "quoteNumber": quote_number},
        "subtotal_amount": subtotal,
        "vat_amount": vat,
        "total_amount": total,
        "currency": str(data.get("currency") or "VND"),
        "issued_at": now,
        "public_token": None,
        "public_enabled": False,
        "created_by": created_by,
        "instance": settings.crm_instance,
    }
    quote_row = supabase.table(QUOTES_TABLE).insert(insert_data).execute().data[0]

    inserted_items = []
    inserted_ids_by_flat_index: dict[int, str] = {}
    for index, item in enumerate(items_to_insert):
        parent_temp_index = item.get("parent_temp_index")
        row = {
            "quote_id": quote_row["id"],
            "parent_item_id": inserted_ids_by_flat_index.get(parent_temp_index) if parent_temp_index is not None else None,
            "description": item.get("description") or "",
            "service_description": item.get("service_description") or None,
            "unit": item.get("unit"),
            "quantity": float(item.get("quantity") or 0),
            "unit_price": float(item.get("unit_price") or 0),
            "discount_percent": item["discount_percent"],
            "discount_amount": item["discount"],
            "amount_after_discount": item["after_discount"],
            "vat_rate": float(item.get("vat_rate") or 0),
            "subtotal_amount": item["subtotal"],
            "vat_amount": item["vat"],
            "total_amount": item["total"],
            "sort_order": item["sort_order"],
            "catalog_item_id": item.get("catalog_item_id") or None,
            "bundle_snapshot": item.get("bundle_snapshot"),
            "list_price_usd": item.get("list_price_usd"),
            "unit_price_usd": item.get("unit_price_usd"),
            "exchange_rate": item.get("exchange_rate"),
            "unit_price_vnd": item.get("unit_price_vnd"),
            "instance": settings.crm_instance,
        }
        inserted = supabase.table(ITEMS_TABLE).insert(row).execute().data[0]
        inserted_items.append(inserted)
        inserted_ids_by_flat_index[index] = inserted["id"]

    supabase.table("quote_activity_log").insert({
        "quote_id": quote_row["id"], "actor_id": created_by, "action": "created", "changes": None,
        "instance": settings.crm_instance,
    }).execute()

    if quote_row.get("deal_id"):
        # Chua duyet -> chi gan FK quote_id de Deal card thay ngay bao gia "Chua
        # duyet", KHONG ghi last_attachment_url/estimated_budget (chua co public
        # url that, chua chac chan gia da chot).
        supabase.table("customer_leads").update({"quote_id": quote_row["id"]}).eq("id", quote_row["deal_id"]).eq("instance", settings.crm_instance).execute()

    return _row_to_quote(quote_row, inserted_items)


_RPC_ERROR_MESSAGES = {
    "quote_not_found": "Không tìm thấy báo giá.",
    "quote_already_approved": "Báo giá đã được duyệt, không thể chỉnh sửa.",
    "quote_not_in_draft_status": "Báo giá không ở trạng thái chờ duyệt.",
    "quote_missing_required_fields": "Báo giá thiếu thông tin bắt buộc (chưa có hạng mục hoặc tổng tiền = 0).",
    "quote_item_invalid_percent": "Giảm giá/VAT phải nằm trong khoảng 0-100.",
}


def _raise_friendly_rpc_error(exc: Exception) -> None:
    message = str(exc)
    for code, friendly in _RPC_ERROR_MESSAGES.items():
        if code in message:
            raise ValueError(friendly) from exc
    raise


def update_quote(quote_id: str, payload: dict, actor_id: str | None) -> dict:
    supabase: Client = get_supabase_client()
    items = payload.get("items")
    changes = {"data_changed": payload.get("data") is not None, "items_changed": items is not None}
    try:
        supabase.rpc("quote_update", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_data": payload.get("data"),
            "p_items": [item for item in items] if items is not None else [],
            "p_changes": changes,
            "p_issuer_company_id": payload.get("issuer_company_id"),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    return get_quote(quote_id)


def approve_quote(quote_id: str, actor_id: str | None) -> dict:
    """Duyệt báo giá: khoá chỉnh sửa vĩnh viễn, sinh public_token (nếu chưa có),
    bật public_enabled, ghi approved_by/approved_at + activity log. Idempotent
    (gọi lại khi đã approved trả về nguyên trạng, không sinh thêm token/log)."""
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_approve", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_public_token": secrets.token_urlsafe(16),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    quote = get_quote(quote_id)
    if quote.get("dealId"):
        link_quote_to_deal(quote_id, quote["dealId"], {
            "id": quote["id"], "number": quote["quoteNumber"],
            "url": quote["publicUrl"], "totalAmount": quote["totalAmount"],
        })
    return quote


def update_and_approve_quote(quote_id: str, payload: dict, actor_id: str | None) -> dict:
    """Dùng cho nút "Duyệt báo giá" khi đang sửa trong modal - lưu thay đổi cuối
    + duyệt trong CÙNG 1 transaction Postgres (không tách 2 lệnh riêng, tránh
    nửa vời khi 1 trong 2 bước lỗi)."""
    supabase: Client = get_supabase_client()
    items = payload.get("items")
    changes = {"data_changed": payload.get("data") is not None, "items_changed": items is not None}
    try:
        supabase.rpc("quote_update_and_approve", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_data": payload.get("data"),
            "p_items": [item for item in items] if items is not None else [],
            "p_changes": changes,
            "p_public_token": secrets.token_urlsafe(16),
            "p_issuer_company_id": payload.get("issuer_company_id"),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    quote = get_quote(quote_id)
    if quote.get("dealId"):
        link_quote_to_deal(quote_id, quote["dealId"], {
            "id": quote["id"], "number": quote["quoteNumber"],
            "url": quote["publicUrl"], "totalAmount": quote["totalAmount"],
        })
    return quote


_RPC_ERROR_MESSAGES.update({
    "quote_not_found": "Không tìm thấy báo giá.",
    "quote_not_approved": "Chuỗi báo giá này chưa có phiên bản nào được duyệt, không thể tạo phiên bản mới.",
    "quote_is_draft": "Báo giá này đang là bản nháp (chưa duyệt), không thể tạo phiên bản mới từ đây.",
})


def create_quote_version(clicked_quote_id: str, actor_id: str | None) -> dict:
    """Tạo phiên bản mới trong chuỗi (V1/V2/V3...) từ bản ĐÃ DUYỆT mới nhất -
    xem chi tiết logic (khoá chuỗi, nguồn copy thật sự, redirect bản nháp có
    sẵn) trong migration 082_quote_versioning.sql (RPC quote_create_version)."""
    supabase: Client = get_supabase_client()
    try:
        result = supabase.rpc("quote_create_version", {
            "p_clicked_quote_id": clicked_quote_id,
            "p_actor_id": actor_id,
            "p_new_quote_number": _next_quote_number(),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    row = (result.data or [None])[0]
    if not row:
        raise ValueError("Không tạo được phiên bản báo giá mới.")
    new_quote = get_quote(row["quote"]["id"])
    return {
        "quote": new_quote,
        "created": bool(row.get("created")),
        "sourceQuoteId": row.get("source_quote_id"),
        "sourceVersionNumber": row.get("source_version_number"),
        "redirectedFromClickedQuote": row.get("source_quote_id") != clicked_quote_id,
    }


def list_quote_versions(chain_id: str) -> list[dict]:
    """Toàn bộ phiên bản (V1..Vn) của 1 chuỗi báo giá, mới nhất trước."""
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(QUOTES_TABLE)
        .select("*")
        .eq("version_chain_id", chain_id)
        .eq("instance", settings.crm_instance)
        .order("version_number", desc=True)
        .execute()
    )
    return [_row_to_quote(row, []) for row in (result.data or [])]


def delete_quote(quote_id: str) -> None:
    supabase: Client = get_supabase_client()
    current = (
        supabase.table(QUOTES_TABLE)
        .select("status")
        .eq("id", quote_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    if current and current.get("status") == "approved":
        raise ValueError("Báo giá đã duyệt, không thể xoá.")
    supabase.table(QUOTES_TABLE).delete().eq("id", quote_id).eq("instance", settings.crm_instance).execute()


def link_quote_to_deal(quote_id: str, deal_id: str, reference: dict | None = None) -> dict:
    """Gắn quote_id (FK thật) + đồng bộ last_attachment_url/name + estimated_budget
    trên customer_leads — Deal Card/Drawer đọc y hệt như tham chiếu thủ công cũ
    (rowToDeal() phía frontend không cần sửa gì), chỉ khác nguồn dữ liệu giờ là
    quote thật thay vì user tự gõ tay."""
    supabase: Client = get_supabase_client()
    supabase.table(QUOTES_TABLE).update({"deal_id": deal_id, "updated_at": _now_iso()}).eq("id", quote_id).eq(
        "instance", settings.crm_instance
    ).execute()

    update_data: dict[str, Any] = {"quote_id": quote_id}
    if reference:
        if reference.get("url"):
            update_data["last_attachment_url"] = reference["url"]
        if reference.get("number"):
            update_data["last_attachment_name"] = reference["number"]
        if reference.get("totalAmount"):
            current = (
                supabase.table("customer_leads")
                .select("estimated_budget")
                .eq("id", deal_id)
                .eq("instance", settings.crm_instance)
                .single()
                .execute()
                .data
            )
            if not (current or {}).get("estimated_budget"):
                update_data["estimated_budget"] = reference["totalAmount"]
    supabase.table("customer_leads").update(update_data).eq("id", deal_id).eq("instance", settings.crm_instance).execute()
    return get_quote(quote_id)
