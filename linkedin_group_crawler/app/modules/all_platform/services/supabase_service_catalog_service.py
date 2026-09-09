"""Danh mục dịch vụ (Service Catalog): group/component/bundle dùng chung cho các
Mẫu báo giá. Bundle (gói/combo, vd SZ-VPS) tổ hợp nhiều component qua
service_catalog_bundle_items — khi chọn 1 bundle lúc điền báo giá, hệ thống ghép
Description Items từ các thành phần và chỉ sinh ĐÚNG 1 dòng quote_item.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal

from supabase import Client

from app.core.supabase_client import get_supabase_client

ITEMS_TABLE = "service_catalog_items"
BUNDLE_ITEMS_TABLE = "service_catalog_bundle_items"
LINKS_TABLE = "quote_form_catalog_links"
PRICING_TABLE = "service_catalog_item_pricing"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def format_quantity(value: float) -> str:
    """Bỏ phần thập phân dư: 8.0 -> "8", 8.5 -> "8.5"."""
    if value == int(value):
        return str(int(value))
    return str(round(value, 2))


def _row_to_item(row: dict) -> dict:
    return {
        "id": row["id"],
        "itemType": row["item_type"],
        "parentId": row.get("parent_id"),
        "sku": row.get("sku"),
        "name": row["name"],
        "description": row.get("description") or "",
        "unit": row.get("unit"),
        "listPriceUsd": row.get("list_price_usd"),
        "unitPriceUsd": row.get("unit_price_usd"),
        "exchangeRateSnapshot": row.get("exchange_rate_snapshot"),
        "defaultUnitPriceVnd": float(row.get("default_unit_price_vnd") or 0),
        "defaultDiscountPercent": float(row.get("default_discount_percent") or 0),
        "defaultVatRate": float(row.get("default_vat_rate") or 0),
        "specQuantityPerUnit": float(row.get("spec_quantity_per_unit") or 1),
        "specUnitLabel": row.get("spec_unit_label"),
        "note": row.get("note"),
        "status": row.get("status") or "active",
        "sortOrder": row.get("sort_order") or 0,
        "children": [],
    }


def _bundle_component_line(bundle_item_row: dict, component: dict) -> dict:
    quantity = float(bundle_item_row.get("quantity") or 0)
    spec_qty = float(component.get("spec_quantity_per_unit") or 1)
    computed_quantity = quantity * spec_qty
    label = component.get("spec_unit_label") or component.get("unit") or ""
    display_text = f"{format_quantity(computed_quantity)} {label}".strip()
    return {
        "id": bundle_item_row["id"],
        "componentId": component["id"],
        "sku": component.get("sku"),
        "name": component.get("name"),
        "description": component.get("description") or "",
        "unit": component.get("unit"),
        "quantity": quantity,
        "computedQuantity": computed_quantity,
        "displayText": display_text,
        "unitPriceVnd": float(component.get("default_unit_price_vnd") or 0),
        "sortOrder": bundle_item_row.get("sort_order") or 0,
    }


def _bundle_components(bundle_id: str) -> list[dict]:
    supabase: Client = get_supabase_client()
    rows = (
        supabase.table(BUNDLE_ITEMS_TABLE)
        .select("*")
        .eq("bundle_id", bundle_id)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    if not rows:
        return []
    component_ids = [row["component_id"] for row in rows]
    components = (
        supabase.table(ITEMS_TABLE).select("*").in_("id", component_ids).execute().data or []
    )
    components_by_id = {c["id"]: c for c in components}
    lines = []
    for row in rows:
        component = components_by_id.get(row["component_id"])
        if not component:
            continue
        lines.append(_bundle_component_line(row, component))
    return sorted(lines, key=lambda line: line["sortOrder"])


def render_bundle_description(bundle_id: str) -> str:
    """Ghép Description Items từ các thành phần của 1 bundle. Mỗi dòng chỉ là
    displayText (số lượng cuối cùng đã quy đổi + đơn vị) kèm mô tả nếu có -
    TUYỆT ĐỐI không nối tên component hay hiển thị dạng phép nhân."""
    lines = []
    for component in _bundle_components(bundle_id):
        text = component["displayText"]
        if component.get("description"):
            text = f"{text} - {component['description']}"
        lines.append(text)
    return "\n".join(lines)


def list_service_catalog_items() -> list[dict]:
    supabase: Client = get_supabase_client()
    rows = supabase.table(ITEMS_TABLE).select("*").order("sort_order").execute().data or []
    mapped = [_row_to_item(row) for row in rows]
    by_id = {item["id"]: item for item in mapped}
    roots: list[dict] = []
    for item in mapped:
        if item["itemType"] == "bundle":
            item["components"] = _bundle_components(item["id"])
        parent_id = item.get("parentId")
        if parent_id and parent_id in by_id:
            by_id[parent_id].setdefault("children", []).append(item)
        else:
            roots.append(item)
    for item in mapped:
        item["children"] = sorted(item.get("children") or [], key=lambda c: c.get("sortOrder") or 0)
    return sorted(roots, key=lambda item: item.get("sortOrder") or 0)


def get_service_catalog_item(item_id: str) -> dict:
    supabase: Client = get_supabase_client()
    row = supabase.table(ITEMS_TABLE).select("*").eq("id", item_id).single().execute().data
    item = _row_to_item(row)
    if item["itemType"] == "bundle":
        item["components"] = _bundle_components(item_id)
    return item


def get_service_catalog_items_by_ids(item_ids: list[str]) -> list[dict]:
    """Tra cuu nhieu san pham cung luc theo id - dung cho "Ap gia de xuat" o
    Buoc 2 (tra lai gia/trang thai hien tai cua catalog theo catalogItemId da
    luu tren dong hang muc, KHONG dua vao state tam cua modal chon danh muc).
    Khong loc status - can biet ca item da ngung kinh doanh de hien thi dung."""
    if not item_ids:
        return []
    supabase: Client = get_supabase_client()
    rows = supabase.table(ITEMS_TABLE).select("*").in_("id", item_ids).execute().data or []
    return [_row_to_item(row) for row in rows]


def create_service_catalog_item(payload: dict, created_by: str | None) -> dict:
    supabase: Client = get_supabase_client()
    existing = (
        supabase.table(ITEMS_TABLE)
        .select("sort_order")
        .eq("parent_id", payload.get("parent_id"))
        if payload.get("parent_id")
        else supabase.table(ITEMS_TABLE).select("sort_order").is_("parent_id", "null")
    )
    existing = existing.order("sort_order", desc=True).limit(1).execute()
    next_order = (existing.data[0]["sort_order"] + 1) if existing.data else 0

    insert_data = {
        "item_type": payload["item_type"],
        "parent_id": payload.get("parent_id"),
        "sku": payload.get("sku"),
        "name": payload["name"],
        "description": payload.get("description"),
        "unit": payload.get("unit"),
        "list_price_usd": payload.get("list_price_usd"),
        "unit_price_usd": payload.get("unit_price_usd"),
        "exchange_rate_snapshot": payload.get("exchange_rate_snapshot"),
        "default_unit_price_vnd": payload.get("default_unit_price_vnd") or 0,
        "default_discount_percent": payload.get("default_discount_percent") or 0,
        "default_vat_rate": payload.get("default_vat_rate") or 0,
        "spec_quantity_per_unit": payload.get("spec_quantity_per_unit") or 1,
        "spec_unit_label": payload.get("spec_unit_label"),
        "note": payload.get("note"),
        "status": payload.get("status") or "active",
        "sort_order": next_order,
        "created_by": created_by,
        "updated_by": created_by,
    }
    result = supabase.table(ITEMS_TABLE).insert(insert_data).execute()
    return _row_to_item(result.data[0])


def update_service_catalog_item(item_id: str, payload: dict, actor_id: str | None) -> dict:
    supabase: Client = get_supabase_client()
    update_data = {k: v for k, v in payload.items() if k != "id" and v is not None}
    update_data["updated_by"] = actor_id
    update_data["updated_at"] = _now_iso()
    result = supabase.table(ITEMS_TABLE).update(update_data).eq("id", item_id).execute()
    return _row_to_item(result.data[0])


def delete_service_catalog_item(item_id: str) -> dict:
    supabase: Client = get_supabase_client()
    item = supabase.table(ITEMS_TABLE).select("*").eq("id", item_id).single().execute().data
    if not item:
        raise ValueError("Không tìm thấy dịch vụ.")

    if item["item_type"] == "group":
        children = supabase.table(ITEMS_TABLE).select("id").eq("parent_id", item_id).limit(1).execute()
        if children.data:
            raise ValueError("Nhóm dịch vụ còn dịch vụ con, không thể xoá.")

    if item["item_type"] == "component":
        used_in = (
            supabase.table(BUNDLE_ITEMS_TABLE)
            .select("bundle_id")
            .eq("component_id", item_id)
            .execute()
            .data
            or []
        )
        if used_in:
            bundle_ids = list({row["bundle_id"] for row in used_in})
            bundles = supabase.table(ITEMS_TABLE).select("name").in_("id", bundle_ids).execute().data or []
            names = ", ".join(b["name"] for b in bundles)
            raise ValueError(f"Dịch vụ đang được dùng trong gói: {names}. Không thể xoá.")

    # Không xoá cứng dịch vụ đã từng được chọn trong 1 báo giá (kể cả báo giá cũ) -
    # quote_items lưu snapshot riêng nên xoá không phá dữ liệu báo giá cũ, nhưng vẫn
    # chặn theo đúng yêu cầu nghiệp vụ: dùng "Ngưng kinh doanh" (đổi status) thay vì xoá.
    used_in_quotes = (
        supabase.table("quote_items").select("id").eq("catalog_item_id", item_id).limit(1).execute().data or []
    )
    if used_in_quotes:
        raise ValueError("Dịch vụ đã được dùng trong báo giá, không thể xoá — chuyển sang Ngưng kinh doanh.")

    supabase.table(ITEMS_TABLE).delete().eq("id", item_id).execute()
    return {"deleted": True}


def reorder_service_catalog_item(item_id: str, direction: str) -> list[dict]:
    """Swap sort_order giữa dòng target và hàng xóm liền kề, TRONG CÙNG parent_id."""
    supabase: Client = get_supabase_client()
    current = supabase.table(ITEMS_TABLE).select("*").eq("id", item_id).single().execute().data
    if not current:
        return list_service_catalog_items()

    query = supabase.table(ITEMS_TABLE).select("*")
    if current.get("parent_id"):
        query = query.eq("parent_id", current["parent_id"])
    else:
        query = query.is_("parent_id", "null")
    siblings = query.order("sort_order").execute().data or []

    index = next((i for i, row in enumerate(siblings) if row["id"] == item_id), None)
    if index is None:
        return list_service_catalog_items()

    target_index = index - 1 if direction == "up" else index + 1
    if target_index < 0 or target_index >= len(siblings):
        return list_service_catalog_items()

    target = siblings[target_index]
    supabase.table(ITEMS_TABLE).update({"sort_order": target["sort_order"]}).eq("id", current["id"]).execute()
    supabase.table(ITEMS_TABLE).update({"sort_order": current["sort_order"]}).eq("id", target["id"]).execute()
    return list_service_catalog_items()


def set_bundle_components(bundle_id: str, items: list[dict]) -> dict:
    supabase: Client = get_supabase_client()
    bundle = supabase.table(ITEMS_TABLE).select("*").eq("id", bundle_id).single().execute().data
    if not bundle or bundle["item_type"] != "bundle":
        raise ValueError("Không tìm thấy gói dịch vụ.")

    supabase.table(BUNDLE_ITEMS_TABLE).delete().eq("bundle_id", bundle_id).execute()
    for index, item in enumerate(items):
        supabase.table(BUNDLE_ITEMS_TABLE).insert({
            "bundle_id": bundle_id,
            "component_id": item["component_id"],
            "quantity": item.get("quantity") or 1,
            "sort_order": item.get("sort_order", index),
        }).execute()

    return get_service_catalog_item(bundle_id)


# ── Liên kết Mẫu báo giá <-> Danh mục dịch vụ ───────────────────────────────

def get_quote_form_catalog_links(quote_form_id: str) -> list[str]:
    supabase: Client = get_supabase_client()
    rows = (
        supabase.table(LINKS_TABLE)
        .select("catalog_item_id")
        .eq("quote_form_id", quote_form_id)
        .execute()
        .data
        or []
    )
    return [row["catalog_item_id"] for row in rows]


def set_quote_form_catalog_links(quote_form_id: str, catalog_item_ids: list[str]) -> list[str]:
    supabase: Client = get_supabase_client()
    supabase.table(LINKS_TABLE).delete().eq("quote_form_id", quote_form_id).execute()
    for catalog_item_id in catalog_item_ids:
        supabase.table(LINKS_TABLE).insert({
            "quote_form_id": quote_form_id,
            "catalog_item_id": catalog_item_id,
        }).execute()
    return get_quote_form_catalog_links(quote_form_id)


def get_service_catalog_options_for_form(quote_form_id: str) -> dict:
    """Trả về, theo các group đã liên kết với mẫu báo giá: danh sách bundle (kèm
    components[] đã tính sẵn displayText) + danh sách component - dùng để dựng
    dropdown 2 nhóm "Gói bán"/"Dịch vụ thành phần" khi điền báo giá."""
    supabase: Client = get_supabase_client()
    group_ids = get_quote_form_catalog_links(quote_form_id)
    if not group_ids:
        return {"bundles": [], "components": []}

    rows = (
        supabase.table(ITEMS_TABLE)
        .select("*")
        .in_("parent_id", group_ids)
        .eq("status", "active")
        .order("sort_order")
        .execute()
        .data
        or []
    )
    group_rows = supabase.table(ITEMS_TABLE).select("id,name").in_("id", group_ids).execute().data or []
    group_names = {g["id"]: g["name"] for g in group_rows}

    bundles = []
    components = []
    for row in rows:
        item = _row_to_item(row)
        item["groupId"] = row.get("parent_id")
        item["groupName"] = group_names.get(row.get("parent_id"))
        if item["itemType"] == "bundle":
            item["components"] = _bundle_components(item["id"])
            bundles.append(item)
        elif item["itemType"] == "component":
            components.append(item)
    return {"bundles": bundles, "components": components}


# ── Bo gia MAC DINH rieng cho danh muc chung (migration 107,
# service_catalog_item_pricing) ───────────────────────────────────────────
#
# TACH BIET hoan toan default_unit_price_vnd (gia BAN, tren chinh
# service_catalog_items - bang do RLS mo, doc truc tiep duoc). Bang pricing
# nay RLS chi cho service_role, nen chi truy cap duoc qua cac ham duoi day
# (goi tu backend FastAPI, dung service-role key) - KHONG bao gio tra thang
# ra API neu nguoi goi khong qua duoc kiem tra quyen o router (xem
# routers/service_catalog.py, _resolve_catalog_pricing_visibility()).


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _collect_item_ids(tree: list[dict]) -> list[str]:
    ids: list[str] = []
    for item in tree:
        ids.append(item["id"])
        ids.extend(_collect_item_ids(item.get("children") or []))
        for component in item.get("components") or []:
            comp_id = component.get("componentId")
            if comp_id:
                ids.append(comp_id)
    return ids


def resolve_pricing_map(item_ids: list[str], issuer_company_id: str | None) -> dict[str, dict[str, Decimal | None]]:
    """Voi moi item_id, uu tien dong pricing khop dung issuer_company_id dang
    resolve; neu khong co, dung dong `issuer_company_id IS NULL` (mac dinh
    dung chung); neu khong co dong nao -> ca 3 gia tri None (chua cau hinh,
    KHONG bia so 0)."""
    if not item_ids:
        return {}
    supabase: Client = get_supabase_client()
    rows = (
        supabase.table(PRICING_TABLE)
        .select("service_catalog_item_id, issuer_company_id, default_cost_price_vnd, default_markup_percent, default_customer_price_vnd")
        .in_("service_catalog_item_id", item_ids)
        .execute()
        .data
        or []
    )
    specific: dict[str, dict[str, Decimal | None]] = {}
    default: dict[str, dict[str, Decimal | None]] = {}
    for row in rows:
        item_id = row["service_catalog_item_id"]
        entry = {
            "cost": _to_decimal(row.get("default_cost_price_vnd")),
            "markup": _to_decimal(row.get("default_markup_percent")),
            "customer": _to_decimal(row.get("default_customer_price_vnd")),
        }
        if row.get("issuer_company_id") and issuer_company_id and row["issuer_company_id"] == issuer_company_id:
            specific[item_id] = entry
        elif not row.get("issuer_company_id"):
            default[item_id] = entry
    result: dict[str, dict[str, Decimal | None]] = {}
    for item_id in item_ids:
        result[item_id] = specific.get(item_id, default.get(item_id, {"cost": None, "markup": None, "customer": None}))
    return result


def merge_pricing_into_tree(tree: list[dict], pricing_map: dict[str, dict[str, Decimal | None]]) -> None:
    """Gan defaultCostPriceVnd/defaultMarkupPercent/defaultCustomerPriceVnd vao
    TUNG item trong cay (mutate in-place) - CHI goi ham nay sau khi router da
    xac nhan nguoi goi du quyen xem cost/markup; neu khong du quyen, XOA HAN
    2 field cost/markup (khong tra null gia), CHI giu lai defaultCustomerPriceVnd
    (Gia khach luon duoc tra cho moi request da auth, khong qua cong quyen
    nay - xem router)."""
    for item in tree:
        entry = pricing_map.get(item["id"], {})
        item["defaultCostPriceVnd"] = float(entry["cost"]) if entry.get("cost") is not None else None
        item["defaultMarkupPercent"] = float(entry["markup"]) if entry.get("markup") is not None else None
        item["defaultCustomerPriceVnd"] = float(entry["customer"]) if entry.get("customer") is not None else None
        merge_pricing_into_tree(item.get("children") or [], pricing_map)
        for component in item.get("components") or []:
            comp_id = component.get("componentId")
            comp_entry = pricing_map.get(comp_id, {}) if comp_id else {}
            component["defaultCostPriceVnd"] = float(comp_entry["cost"]) if comp_entry.get("cost") is not None else None
            component["defaultMarkupPercent"] = float(comp_entry["markup"]) if comp_entry.get("markup") is not None else None
            component["defaultCustomerPriceVnd"] = float(comp_entry["customer"]) if comp_entry.get("customer") is not None else None


def strip_cost_markup_fields(tree: list[dict]) -> None:
    """Nguoi goi KHONG du quyen xem cost/markup - xoa han 2 key nay khoi moi
    item/children/components (giu nguyen defaultCustomerPriceVnd neu da gan
    truoc do). Dung `pop(..., None)` de an toan neu key chua ton tai."""
    for item in tree:
        item.pop("defaultCostPriceVnd", None)
        item.pop("defaultMarkupPercent", None)
        strip_cost_markup_fields(item.get("children") or [])
        for component in item.get("components") or []:
            component.pop("defaultCostPriceVnd", None)
            component.pop("defaultMarkupPercent", None)


def list_service_catalog_item_pricing(item_id: str) -> list[dict]:
    """Danh sach TAT CA dong gia (ca dong mac dinh chung lan tung dong rieng
    theo issuer_company_id) cua 1 san pham - dung cho form quan tri (Admin),
    KHONG dung cho picker chon danh muc trong quote."""
    supabase: Client = get_supabase_client()
    rows = (
        supabase.table(PRICING_TABLE)
        .select("*")
        .eq("service_catalog_item_id", item_id)
        .execute()
        .data
        or []
    )
    return [
        {
            "id": row["id"],
            "issuerCompanyId": row.get("issuer_company_id"),
            "defaultCostPriceVnd": float(row["default_cost_price_vnd"]) if row.get("default_cost_price_vnd") is not None else None,
            "defaultMarkupPercent": float(row["default_markup_percent"]) if row.get("default_markup_percent") is not None else None,
            "defaultCustomerPriceVnd": float(row["default_customer_price_vnd"]) if row.get("default_customer_price_vnd") is not None else None,
            "updatedAt": row.get("updated_at"),
        }
        for row in rows
    ]


def upsert_service_catalog_item_pricing(
    item_id: str,
    issuer_company_id: str | None,
    cost_price_vnd: Decimal | None,
    markup_percent: Decimal | None,
    customer_price_vnd: Decimal | None,
    pricing_input_mode: Literal["markup", "customer_price"],
    actor_id: str | None,
) -> dict:
    """Backend la nguon THAT DUY NHAT tinh 3 gia tri - KHONG luu nguyen so
    client gui cho field KHONG phai field dieu khien (dung yeu cau audit:
    "backend phai dam bao 3 gia tri luon nhat quan"). `cost_price_vnd` LUON
    duoc tin nguyen (khong co field nao khac dieu khien no); field con lai
    tuy `pricing_input_mode`:
      - mode='markup': customer = cost * (1 + markup/100). cost=None ->
        customer=None (khong tinh duoc).
      - mode='customer_price': cost=None HOAC cost==0 -> KHONG chia (tranh
        ZeroDivisionError/suy nguoc vo nghia), markup tra ve None. Nguoc lai
        markup = customer/cost - 1.
    Validate: cost/customer khong am (< 0 -> ValueError). Markup kep toi
    thieu -100% (gia khach toi thieu = 0, giong dung cach da lam cho
    markup hang muc bao gia - khong co nguong tren nghiep vu nao dung chung
    cho danh muc mac dinh nen khong bia them gioi han tren)."""
    if cost_price_vnd is not None and cost_price_vnd < 0:
        raise ValueError("Giá vốn không được âm.")
    if customer_price_vnd is not None and customer_price_vnd < 0:
        raise ValueError("Giá khách không được âm.")

    if pricing_input_mode == "markup":
        markup = None if markup_percent is None else max(Decimal("-100"), markup_percent)
        if cost_price_vnd is None or markup is None:
            customer = None
        else:
            customer = cost_price_vnd * (Decimal("1") + markup / Decimal("100"))
        cost, resolved_markup, resolved_customer = cost_price_vnd, markup, customer
    else:  # customer_price
        if cost_price_vnd is None or cost_price_vnd == 0 or customer_price_vnd is None:
            resolved_markup = None
        else:
            resolved_markup = (customer_price_vnd / cost_price_vnd - Decimal("1")) * Decimal("100")
        cost, resolved_customer = cost_price_vnd, customer_price_vnd

    supabase: Client = get_supabase_client()
    query = supabase.table(PRICING_TABLE).select("id").eq("service_catalog_item_id", item_id)
    query = query.is_("issuer_company_id", "null") if not issuer_company_id else query.eq("issuer_company_id", issuer_company_id)
    existing = query.limit(1).execute().data
    payload = {
        "service_catalog_item_id": item_id,
        "issuer_company_id": issuer_company_id,
        "default_cost_price_vnd": float(cost) if cost is not None else None,
        "default_markup_percent": float(resolved_markup) if resolved_markup is not None else None,
        "default_customer_price_vnd": float(resolved_customer) if resolved_customer is not None else None,
        "updated_by": actor_id,
        "updated_at": _now_iso(),
    }
    if existing:
        result = supabase.table(PRICING_TABLE).update(payload).eq("id", existing[0]["id"]).execute()
    else:
        result = supabase.table(PRICING_TABLE).insert(payload).execute()
    row = result.data[0]
    return {
        "id": row["id"],
        "issuerCompanyId": row.get("issuer_company_id"),
        "defaultCostPriceVnd": float(row["default_cost_price_vnd"]) if row.get("default_cost_price_vnd") is not None else None,
        "defaultMarkupPercent": float(row["default_markup_percent"]) if row.get("default_markup_percent") is not None else None,
        "defaultCustomerPriceVnd": float(row["default_customer_price_vnd"]) if row.get("default_customer_price_vnd") is not None else None,
        "updatedAt": row.get("updated_at"),
    }
