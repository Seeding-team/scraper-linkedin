"""Bảng giá VPS Zone (SecurityZone) — CRUD Draft/Published version + công thức
tính giá chính thức (Decimal, không làm tròn bước trung gian). Xem migration
106_price_book_vps_zone.sql cho schema, và
scripts/import_price_book_vps_zone.py cho import ban đầu từ Excel.

Nguyên tắc bất biến (KHÔNG được vi phạm):
  - Bảng giá VPS Zone (bảng này) là bảng giá CHUẨN. quote_items.price_book_snapshot
    là bản snapshot đông cứng lúc chọn - sửa/override trong 1 quote KHÔNG BAO
    GIỜ gọi ngược lại các hàm ở file này để ghi đè giá chuẩn.
  - Mọi Thêm/Sửa/Xóa sản phẩm luôn thao tác trên version 'draft' (qua RPC
    price_book_create_or_reuse_draft) - không bao giờ UPDATE thẳng 1 item
    thuộc version 'published'.
"""

from __future__ import annotations

from decimal import Decimal, DivisionByZero, InvalidOperation
from typing import Any

from app.core.supabase_client import get_supabase_client

PRICE_BOOK_CODE = "VPS_ZONE"


class PriceBookError(Exception):
    pass


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _safe_div(numerator: Decimal, denominator: Decimal | None) -> Decimal | None:
    """Chia an toan - tra None (khong phai NaN/Infinity) neu mau so None/0."""
    if denominator is None:
        return None
    try:
        return numerator / denominator
    except (DivisionByZero, InvalidOperation, ZeroDivisionError):
        return None


def _row_to_item(row: dict) -> dict:
    """Chuyen 1 row DB (snake_case) -> dict camelCase cho frontend, GIU
    NGUYEN gia tri Decimal-compatible (frontend/JSON serializer tu convert)."""
    return {
        "id": row["id"],
        "priceBookVersionId": row["price_book_version_id"],
        "sectionId": row.get("section_id"),
        "sourceSheet": row["source_sheet"],
        "sourceStt": row["source_stt"],
        "sku": row["sku"],
        "name": row["name"],
        "description": row.get("description"),
        "unit": row.get("unit"),
        "defaultQuantity": row.get("default_quantity"),
        "status": row.get("status"),
        "productImageUrl": row.get("product_image_url"),
        "costMode": row.get("cost_mode"),
        "vendorName": row.get("vendor_name"),
        "listPriceUsd": row.get("list_price_usd"),
        "unitPriceUsd": row.get("unit_price_usd"),
        "unitPriceVndDirect": row.get("unit_price_vnd_direct"),
        "exchangeRate": row.get("exchange_rate"),
        "importDutyPercent": row.get("import_duty_percent"),
        "vatInPercent": row.get("vat_in_percent"),
        "quoteReceivedDate": row.get("quote_received_date"),
        "quoteLink": row.get("quote_link"),
        "defaultRatePercent": row.get("default_rate_percent"),
        "vatEuPercent": row.get("vat_eu_percent"),
        "referencePrice": row.get("reference_price"),
        "referenceLink": row.get("reference_link"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def strip_cost_fields(item: dict) -> dict:
    """Loai bo TOAN BO field gia von/vendor/ty gia khoi response - dung khi
    can_view_price_book_cost() = False. Loai o TANG PYTHON (khong chi FE an),
    dung nguyen tac allowlist nguoc: xoa het field nhay cam, giu lai field
    thuong mai (ten/mo ta/don vi/gia ban mac dinh neu duoc phep xem)."""
    sensitive_keys = (
        "vendorName", "listPriceUsd", "unitPriceUsd", "unitPriceVndDirect",
        "exchangeRate", "importDutyPercent", "vatInPercent", "quoteReceivedDate",
        "quoteLink", "costMode", "referencePrice", "referenceLink",
        # costUsd la gia von quy doi (tinh tu compute_item_pricing) - cung
        # nhom "gia von" voi costUnit/costTotal (2 field do khong nam trong
        # dict nay vi duoc tinh RIENG, khong phai raw column - nhung costUsd
        # tinh RA TU field da bi strip nen phai an cung, tranh lo gian tiep).
        "costUsd",
    )
    return {k: v for k, v in item.items() if k not in sensitive_keys}


def compute_item_pricing(
    *,
    cost_mode: str,
    unit_price_usd: Any = None,
    exchange_rate: Any = None,
    unit_price_vnd_direct: Any = None,
    import_duty_percent: Any = 0,
    vat_in_percent: Any = 0,
    vat_eu_percent: Any = 0,
    quantity: Any,
    rate_percent: Any = None,
    unit_price_override: Any = None,
    reference_price: Any = None,
) -> dict:
    """Cong thuc chinh thuc (xem plan muc 2) - dung Decimal xuyen suot, KHONG
    lam tron buoc trung gian. Chi 1 nguon dieu khien Gia khach/Rate tai 1 thoi
    diem: neu `unit_price_override` co gia tri -> dung no lam Gia khach/DV va
    TINH NGUOC Rate%; nguoc lai dung `rate_percent` de tinh Gia khach/DV.
    Tra ve dict cac gia tri Decimal (hoac None neu "chua tinh duoc", KHONG
    bao gio tra NaN/Infinity)."""
    qty = _to_decimal(quantity) or Decimal(0)
    duty = _to_decimal(import_duty_percent) or Decimal(0)
    vat_in = _to_decimal(vat_in_percent) or Decimal(0)
    vat_eu = _to_decimal(vat_eu_percent) or Decimal(0)

    rate = _to_decimal(exchange_rate)
    if cost_mode == "usd":
        usd = _to_decimal(unit_price_usd)
        cost_unit = (usd * rate * (1 + duty / 100)) if (usd is not None and rate is not None) else None
        # Da la USD nguon san co, khong can tinh nguoc.
        cost_usd = usd
    else:
        cost_unit = _to_decimal(unit_price_vnd_direct)
        # MOI - chieu nguoc VND->USD, CHI la lop XEM QUY DOI tham khao cho
        # Sale (khong phai bao gia chinh thuc bang USD) - can exchange_rate,
        # KHONG tu bia ty gia neu thieu.
        cost_usd = _safe_div(cost_unit, rate) if cost_unit is not None else None

    cost_total = qty * cost_unit if cost_unit is not None else None
    vat_in_amount = cost_total * vat_in / 100 if cost_total is not None else None
    in_after_vat = (cost_total + vat_in_amount) if (cost_total is not None and vat_in_amount is not None) else None

    override_price = _to_decimal(unit_price_override)
    rate_pct = _to_decimal(rate_percent)
    if override_price is not None:
        unit_price = override_price
        rate_pct = _safe_div(unit_price - cost_unit, cost_unit) * 100 if cost_unit else None
    elif cost_unit is not None and rate_pct is not None:
        unit_price = cost_unit * (1 + rate_pct / 100)
    else:
        unit_price = None

    # Gia khach quy doi USD (MOI, tham khao) - dung CHUNG cho ca 2 cost_mode,
    # luon la unit_price(VND) / exchange_rate - KHONG anh huong so tien
    # chinh thuc cua quote (van la unit_price VND nhu cu).
    customer_price_usd = _safe_div(unit_price, rate) if (unit_price is not None and rate is not None) else None

    amount_before_vat = qty * unit_price if unit_price is not None else None
    vat_eu_amount = amount_before_vat * vat_eu / 100 if amount_before_vat is not None else None
    total_amount = (
        (amount_before_vat + vat_eu_amount) if (amount_before_vat is not None and vat_eu_amount is not None) else None
    )

    profit_before_vat = (
        (amount_before_vat - cost_total) if (amount_before_vat is not None and cost_total is not None) else None
    )
    margin_percent = None
    if profit_before_vat is not None:
        margin_ratio = _safe_div(profit_before_vat, amount_before_vat)
        margin_percent = margin_ratio * 100 if margin_ratio is not None else None
    rate_total_percent = None
    if amount_before_vat is not None and cost_total:
        ratio = _safe_div(amount_before_vat, cost_total)
        rate_total_percent = (ratio - 1) * 100 if ratio is not None else None

    ref_price = _to_decimal(reference_price)
    reference_diff_percent = None
    if unit_price is not None and ref_price:
        ratio = _safe_div(unit_price, ref_price)
        reference_diff_percent = (ratio - 1) * 100 if ratio is not None else None

    return {
        "costUnit": cost_unit,
        "costTotal": cost_total,
        "vatInAmount": vat_in_amount,
        "inAfterVat": in_after_vat,
        "unitPrice": unit_price,
        "ratePercent": rate_pct,
        "amountBeforeVat": amount_before_vat,
        "vatEuAmount": vat_eu_amount,
        "totalAmount": total_amount,
        "profitBeforeVat": profit_before_vat,
        "marginPercent": margin_percent,
        "rateTotalPercent": rate_total_percent,
        "referenceDiffPercent": reference_diff_percent,
        # Lop XEM QUY DOI USD (tham khao) - xem plan "VND/USD hai chieu cho
        # Bang gia VPS Zone". costUsd la du lieu GOC/GIA VON (bi strip boi
        # strip_cost_fields() khi khong du quyen, giong costUnit/costTotal).
        # customerPriceUsd la Gia KHACH quy doi - KHONG bi strip, giong
        # unitPrice/customerPriceVnd hien tai.
        "costUsd": cost_usd,
        "customerPriceUsd": customer_price_usd,
    }


def attach_usd_conversion(items: list[dict]) -> list[dict]:
    """Tinh THAT o backend (Decimal, khong lam tron giua chung) 2 field XEM
    QUY DOI USD moi - `costUsd` (gia von, se bi strip_cost_fields() an neu
    khong du quyen) va `customerPriceUsd` (gia khach quy doi, KHONG an -
    giong unitPrice/customerPriceVnd hien co). CHI merge dung 2 field nay,
    KHONG dung lai toan bo compute_item_pricing() de thay the costUnit/
    unitPrice (VND) dang tinh o FE (previewPriceBookItem) - giu nguyen
    luong VND hien tai, tranh rui ro doi ket qua da dung. Neu thieu du lieu
    (vd exchange_rate=None) tra costUsd/customerPriceUsd=None, khong loi."""
    result = []
    for item in items:
        pricing = compute_item_pricing(
            cost_mode=item.get("costMode") or "vnd",
            unit_price_usd=item.get("unitPriceUsd"),
            exchange_rate=item.get("exchangeRate"),
            unit_price_vnd_direct=item.get("unitPriceVndDirect"),
            import_duty_percent=item.get("importDutyPercent") or 0,
            vat_in_percent=item.get("vatInPercent") or 0,
            vat_eu_percent=item.get("vatEuPercent") or 0,
            quantity=item.get("defaultQuantity") or 1,
            rate_percent=item.get("defaultRatePercent") or 0,
            reference_price=item.get("referencePrice"),
        )
        merged = {
            **item,
            "costUsd": float(pricing["costUsd"]) if pricing["costUsd"] is not None else None,
            "customerPriceUsd": (
                float(pricing["customerPriceUsd"]) if pricing["customerPriceUsd"] is not None else None
            ),
        }
        result.append(merged)
    return result


def compute_overall_discount(
    *, total_amount_sum: Any, total_in_after_vat_sum: Any, overall_discount_percent: Any = None
) -> dict:
    """Muc 6.9 - Giam gia tong cap quote. `overall_discount_percent=None` nghia
    la khong ap dung (Gia sau giam = Tong khach thanh toan nguyen, khong giam)."""
    total_amount = _to_decimal(total_amount_sum) or Decimal(0)
    total_in_after_vat = _to_decimal(total_in_after_vat_sum) or Decimal(0)
    discount_pct = _to_decimal(overall_discount_percent)

    if discount_pct is None:
        amount_after_discount = total_amount
    else:
        amount_after_discount = total_amount * (1 - discount_pct / 100)

    income_after_discount = amount_after_discount - total_in_after_vat
    margin_after_discount = _safe_div(income_after_discount, amount_after_discount)
    margin_after_discount = margin_after_discount * 100 if margin_after_discount is not None else None

    return {
        "amountAfterDiscount": amount_after_discount,
        "incomeAfterDiscount": income_after_discount,
        "marginAfterDiscountPercent": margin_after_discount,
    }


# ─────────────────────────────────────────────────────────────────────────
# CRUD + versioning
# ─────────────────────────────────────────────────────────────────────────

def get_or_create_price_book(issuer_company_id: str, actor_id: str | None, code: str = PRICE_BOOK_CODE, name: str = "Bảng giá VPS Zone") -> dict:
    supabase = get_supabase_client()
    existing = supabase.table("price_books").select("*").eq("code", code).limit(1).execute()
    if existing.data:
        return existing.data[0]
    created = supabase.table("price_books").insert(
        {"issuer_company_id": issuer_company_id, "code": code, "name": name, "status": "active", "created_by": actor_id}
    ).execute()
    return created.data[0]


def get_or_create_draft_version(price_book_id: str, actor_id: str | None) -> dict:
    """Goi RPC price_book_create_or_reuse_draft() - xem migration 106 cho
    logic day du (co Draft san thi dung tiep, khong co thi clone tu Published
    thanh Draft moi version+1, chua tung publish thi tao Draft version=1 rong)."""
    supabase = get_supabase_client()
    result = supabase.rpc(
        "price_book_create_or_reuse_draft", {"p_price_book_id": price_book_id, "p_actor_id": actor_id}
    ).execute()
    row = result.data
    return row[0] if isinstance(row, list) else row


def publish_version(version_id: str, actor_id: str | None) -> dict:
    supabase = get_supabase_client()
    result = supabase.rpc(
        "price_book_publish_version", {"p_version_id": version_id, "p_actor_id": actor_id}
    ).execute()
    row = result.data
    return row[0] if isinstance(row, list) else row


def _get_or_create_section(version_id: str, group_label: str, source_sheet: str) -> str:
    supabase = get_supabase_client()
    existing = (
        supabase.table("price_book_sections")
        .select("id")
        .eq("price_book_version_id", version_id)
        .eq("source_group_label", group_label)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]["id"]
    created = supabase.table("price_book_sections").insert(
        {
            "price_book_version_id": version_id,
            "source_sheet": source_sheet,
            "source_group_label": group_label,
            "display_label": group_label,
            "name": f"Mục {group_label}",
            "sort_order": 0 if group_label == "I" else 1,
        }
    ).execute()
    return created.data[0]["id"]


def list_items_for_version(version_id: str) -> list[dict]:
    supabase = get_supabase_client()
    result = (
        supabase.table("price_book_items")
        .select("*")
        .eq("price_book_version_id", version_id)
        .order("source_sheet", desc=False)
        .order("source_stt", desc=False)
        .execute()
    )
    return [_row_to_item(r) for r in result.data]


def get_published_items(price_book_id: str) -> list[dict]:
    supabase = get_supabase_client()
    version = (
        supabase.table("price_book_versions")
        .select("id")
        .eq("price_book_id", price_book_id)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not version.data:
        return []
    return list_items_for_version(version.data[0]["id"])


def create_item(price_book_id: str, actor_id: str | None, payload: dict) -> dict:
    draft = get_or_create_draft_version(price_book_id, actor_id)
    group_label = payload["sourceGroupLabel"]
    section_id = _get_or_create_section(draft["id"], group_label, payload["sourceSheet"])
    supabase = get_supabase_client()
    row = {
        "price_book_version_id": draft["id"],
        "section_id": section_id,
        "source_sheet": payload["sourceSheet"],
        "source_stt": payload["sourceStt"],
        "sku": payload["sku"],
        "name": payload["name"],
        "description": payload.get("description"),
        "unit": payload.get("unit"),
        "default_quantity": payload.get("defaultQuantity", 1),
        "status": "active",
        "product_image_url": payload.get("productImageUrl"),
        "cost_mode": payload["costMode"],
        "vendor_name": payload.get("vendorName"),
        "list_price_usd": payload.get("listPriceUsd"),
        "unit_price_usd": payload.get("unitPriceUsd"),
        "unit_price_vnd_direct": payload.get("unitPriceVndDirect"),
        "exchange_rate": payload.get("exchangeRate"),
        "import_duty_percent": payload.get("importDutyPercent", 0),
        "vat_in_percent": payload.get("vatInPercent", 0),
        "quote_received_date": payload.get("quoteReceivedDate"),
        "quote_link": payload.get("quoteLink"),
        "default_rate_percent": payload.get("defaultRatePercent", 0),
        "vat_eu_percent": payload.get("vatEuPercent", 0),
        "reference_price": payload.get("referencePrice"),
        "reference_link": payload.get("referenceLink"),
    }
    created = supabase.table("price_book_items").insert(row).execute()
    supabase.table("price_book_audit_log").insert(
        {"price_book_item_id": created.data[0]["id"], "price_book_version_id": draft["id"], "actor_id": actor_id, "action": "update", "changes": payload}
    ).execute()
    return _row_to_item(created.data[0])


def _resolve_editable_item(item_id: str, actor_id: str | None) -> dict:
    """Neu item can sua dang thuoc version 'published', tu clone sang Draft
    moi (get_or_create_draft_version) roi tra ve DUNG row moi trong Draft do
    (khop theo source_sheet+source_stt) - KHONG BAO GIO update thang row
    Published. Neu da o Draft san thi tra ve chinh no."""
    supabase = get_supabase_client()
    item = supabase.table("price_book_items").select("*").eq("id", item_id).single().execute().data
    if not item:
        raise PriceBookError("price_book_item_not_found")
    version = supabase.table("price_book_versions").select("*").eq("id", item["price_book_version_id"]).single().execute().data
    if version["status"] == "draft":
        return item
    if version["status"] == "archived":
        raise PriceBookError("price_book_item_in_archived_version")

    draft = get_or_create_draft_version(version["price_book_id"], actor_id)
    cloned = (
        supabase.table("price_book_items")
        .select("*")
        .eq("price_book_version_id", draft["id"])
        .eq("source_sheet", item["source_sheet"])
        .eq("source_stt", item["source_stt"])
        .single()
        .execute()
        .data
    )
    if not cloned:
        raise PriceBookError("price_book_item_clone_failed")
    return cloned


def update_item(item_id: str, actor_id: str | None, payload: dict) -> dict:
    target = _resolve_editable_item(item_id, actor_id)
    supabase = get_supabase_client()
    update_data = {
        _CAMEL_TO_SNAKE.get(k, k): v
        for k, v in payload.items()
        if k in _CAMEL_TO_SNAKE
    }
    updated = supabase.table("price_book_items").update(update_data).eq("id", target["id"]).execute()
    supabase.table("price_book_audit_log").insert(
        {"price_book_item_id": target["id"], "price_book_version_id": target["price_book_version_id"], "actor_id": actor_id, "action": "update", "changes": payload}
    ).execute()
    return _row_to_item(updated.data[0])


_CAMEL_TO_SNAKE = {
    "name": "name", "description": "description", "unit": "unit", "defaultQuantity": "default_quantity",
    "productImageUrl": "product_image_url", "costMode": "cost_mode", "vendorName": "vendor_name",
    "listPriceUsd": "list_price_usd", "unitPriceUsd": "unit_price_usd", "unitPriceVndDirect": "unit_price_vnd_direct",
    "exchangeRate": "exchange_rate", "importDutyPercent": "import_duty_percent", "vatInPercent": "vat_in_percent",
    "quoteReceivedDate": "quote_received_date", "quoteLink": "quote_link", "defaultRatePercent": "default_rate_percent",
    "vatEuPercent": "vat_eu_percent", "referencePrice": "reference_price", "referenceLink": "reference_link",
}


def discontinue_item(item_id: str, actor_id: str | None) -> dict:
    target = _resolve_editable_item(item_id, actor_id)
    supabase = get_supabase_client()
    updated = supabase.table("price_book_items").update({"status": "discontinued"}).eq("id", target["id"]).execute()
    supabase.table("price_book_audit_log").insert(
        {"price_book_item_id": target["id"], "price_book_version_id": target["price_book_version_id"], "actor_id": actor_id, "action": "discontinue"}
    ).execute()
    return _row_to_item(updated.data[0])


def delete_item(item_id: str, actor_id: str | None) -> dict:
    """Hard-delete CHI khi chua tung duoc quote nao tham chieu qua BAT KY
    version nao cua price book nay (khop theo source_sheet+source_stt, vi moi
    version co ban ghi item RIENG - item vua clone sang Draft luon "chua dung
    lan nao" xet theo id cua no, nen phai kiem tra theo danh tinh LOGIC
    source_sheet+source_stt xuyen suot moi version, khong chi id hien tai).
    Neu da dung roi -> chi discontinue, KHONG xoa."""
    target = _resolve_editable_item(item_id, actor_id)
    supabase = get_supabase_client()

    version = supabase.table("price_book_versions").select("price_book_id").eq("id", target["price_book_version_id"]).single().execute().data
    sibling_versions = (
        supabase.table("price_book_versions").select("id").eq("price_book_id", version["price_book_id"]).execute()
    )
    version_ids = [v["id"] for v in sibling_versions.data]
    sibling_items = (
        supabase.table("price_book_items")
        .select("id")
        .in_("price_book_version_id", version_ids)
        .eq("source_sheet", target["source_sheet"])
        .eq("source_stt", target["source_stt"])
        .execute()
    )
    sibling_item_ids = [i["id"] for i in sibling_items.data]

    referenced = (
        supabase.table("quote_items").select("id").in_("price_book_item_id", sibling_item_ids).limit(1).execute()
    )
    if referenced.data:
        result = discontinue_item(target["id"], actor_id)
        return {"deleted": False, "discontinued": True, "item": result}

    supabase.table("price_book_items").delete().eq("id", target["id"]).execute()
    supabase.table("price_book_audit_log").insert(
        {"price_book_version_id": target["price_book_version_id"], "actor_id": actor_id, "action": "hard_delete", "changes": {"item_id": target["id"], "sku": target["sku"]}}
    ).execute()
    return {"deleted": True, "discontinued": False}


def get_audit_log(price_book_id: str) -> list[dict]:
    supabase = get_supabase_client()
    versions = supabase.table("price_book_versions").select("id").eq("price_book_id", price_book_id).execute()
    version_ids = [v["id"] for v in versions.data]
    if not version_ids:
        return []
    result = (
        supabase.table("price_book_audit_log")
        .select("*")
        .in_("price_book_version_id", version_ids)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data
