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
# Many-to-many Workspace assignment (migration 190): 1 nhóm/có thể thuộc nhiều
# workspace; item nhìn thấy khi instance legacy nằm trong bộ lọc HOẶC có dòng
# junction (một trong những assignment của nó nằm trong bộ lọc). Cot cu `instance`
# LUON được giữ "primary" (1 phần tử của set) cho mọi reader cũ.
WORKSPACES_TABLE = "service_catalog_item_workspaces"
LINKS_TABLE = "quote_form_catalog_links"
PRICING_TABLE = "service_catalog_item_pricing"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def format_quantity(value: float) -> str:
    """Bỏ phần thập phân dư: 8.0 -> "8", 8.5 -> "8.5"."""
    if value == int(value):
        return str(int(value))
    return str(round(value, 2))


def _float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


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
        "defaultVatRate": _float_or_none(row.get("default_vat_rate")),
        "customerVisible": bool(row.get("customer_visible", True)),
        "quoteDisplayName": row.get("quote_display_name"),
        "quoteDescription": row.get("quote_description"),
        "quoteCta": row.get("quote_cta"),
        "monthlyPriceVnd": _float_or_none(row.get("monthly_price_vnd")),
        "annualCommitMonthlyPriceVnd": _float_or_none(row.get("annual_commit_monthly_price_vnd")),
        "annualTotalPriceVnd": _float_or_none(row.get("annual_total_price_vnd")),
        "maxSaleDiscountPercent": _float_or_none(row.get("max_sale_discount_percent")),
        "targetGrossMarginPercent": _float_or_none(row.get("target_gross_margin_percent")),
        "costBasisRule": row.get("cost_basis_rule"),
        "pricingPolicyExceptions": row.get("pricing_policy_exceptions") or [],
        "quotaUserCount": _float_or_none(row.get("quota_user_count")),
        "quotaUserLabel": row.get("quota_user_label"),
        "quotaConnectedChannels": _float_or_none(row.get("quota_connected_channels")),
        "quotaConnectedChannelsLabel": row.get("quota_connected_channels_label"),
        "quotaMessagesPerMonth": _float_or_none(row.get("quota_messages_per_month")),
        "quotaMessagesPerMonthLabel": row.get("quota_messages_per_month_label"),
        "quotaAiData": row.get("quota_ai_data"),
        "quotaHighlights": row.get("quota_highlights"),
        "quotaExtra": row.get("quota_extra") or {},
        "specQuantityPerUnit": float(row.get("spec_quantity_per_unit") or 1),
        "specUnitLabel": row.get("spec_unit_label"),
        "note": row.get("note"),
        "status": row.get("status") or "active",
        "sortOrder": row.get("sort_order") or 0,
        "brand": row.get("brand"),
        "partNumber": row.get("part_number"),
        "productType": row.get("product_type"),
        "internalNote": row.get("internal_note"),
        # TÍCH HỢP BỘ LỌC WORKSPACE: Trả về instance của item để FE hiển thị badge và phục vụ lọc
        "instance": row.get("instance") or "markee",
        "children": [],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Many-to-many Workspace assignment (migration 190). Quy uoc chung:
#  - set(item) = cac dong junction cua item neu co, nguoc lai [instance legacy].
#  - Moi thay doi assignment deu di qua `_ws_write()` de cot cu `instance`
#    va junction khong tach lech; MSP sync & vendor import khong can sua gi
#    vi ca hai deu di qua create/update service.
# ─────────────────────────────────────────────────────────────────────────────


def _normalize_instances(instances: list[str] | None) -> list[str]:
    """Lowercased, trimmed, deduplicated, bo phan tu rong theo thu tu truyen."""
    out: list[str] = []
    for raw in instances or []:
        if raw is None:
            continue
        value = str(raw).strip().lower()
        if value and value not in out:
            out.append(value)
    return out


def _load_workspaces_map(supabase: Client) -> dict[str, list[str]]:
    """Map item_id → danh sách instance (giu thu tu DB) tu junction table."""
    try:
        rows = supabase.table(WORKSPACES_TABLE).select("item_id, instance").execute().data or []
    except Exception:
        return {}
    ws_map: dict[str, list[str]] = {}
    for row in rows:
        instance = (row.get("instance") or "").strip().lower()
        if not instance:
            continue
        ws_map.setdefault(str(row.get("item_id")), []).append(instance)
    return ws_map


def _workspace_set_for(supabase: Client, item_row: dict, ws_map: dict[str, list[str]]) -> list[str]:
    """set cua 1 item = junction (neu co) hoac legacy instance (fallback)."""
    item_id = str(item_row.get("id"))
    existing = ws_map.get(item_id)
    if existing:
        return list(existing)
    legacy = (item_row.get("instance") or "markee").strip().lower()
    return [legacy] if legacy else ["markee"]


def _attach_workspaces(supabase: Client, items: list[dict]) -> list[dict]:
    """Annotate `workspaces` (list) len cac item da qua `_row_to_item`."""
    if not items:
        return items
    ws_map = _load_workspaces_map(supabase)
    for item in items:
        if isinstance(item, dict):
            item["workspaces"] = _workspace_set_for(
                supabase, {"id": item.get("id"), "instance": item.get("instance")}, ws_map
            )
    return items


def _ws_write(
    supabase: Client,
    item_ids: list[str],
    instances: list[str],
    actor_id: str | None = None,
) -> dict[str, list[str]]:
    """REPLACE-ALL assignment cho cac item_ids (1-2 item don le):

    - Xoa toan bo junction rows cu cua cac item, chen set instances moi.
    - Mirror legacy: giu gia tri `instance` hien tai neu no van con nam trong
      set moi, nguoc lai lay phan tu dau tien cua set (cot cu lun giu 1 phan tu
      de 100% read-path cu van dung).

    Luu y giao dich: bulk nhieu nhom phai di qua RPC `service_catalog_ws_assign`
    (migration 190) de co 1 giao dich duy nhat; ham nay danh cho 1-2 item don
    le trong cac duong create/update cua service.

    Set rong: `instances` rong se raise ValueError (KHONG silently clear
    assignment).
    """
    ids = [str(i) for i in item_ids if i]
    normalized = _normalize_instances(instances)
    if not ids:
        return {}
    if not normalized:
        raise ValueError("Vui long chon it nhat 1 Workspace.")

    old_rows = (
        supabase.table(ITEMS_TABLE)
        .select("id, instance")
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    current = {r.get("id"): (r.get("instance") or "").strip().lower() for r in old_rows}
    primary_in_set = [c for c in current.values() if c in normalized]
    primary = primary_in_set[0] if primary_in_set else normalized[0]

    supabase.table(WORKSPACES_TABLE).delete().in_("item_id", ids).execute()
    supabase.table(WORKSPACES_TABLE).insert(
        [{"item_id": item_id, "instance": instance} for item_id in ids for instance in normalized]
    ).execute()

    supabase.table(ITEMS_TABLE).update(
        {"instance": primary, "updated_at": _now_iso(), "updated_by": actor_id}
    ).in_("id", ids).execute()

    return {item_id: list(normalized) for item_id in ids}


def assign_group_workspaces(
    group_ids: list[str],
    instances: list[str],
    actor_id: str | None = None,
) -> dict:
    """Bulk replace-all Workspace assignment cho cac NHOM + con truc tiep.

    Dung RPC `service_catalog_ws_assign` (migration 190) de: normalize instance,
    khoa nhom (FOR UPDATE), replace junction cho nhom + TAT CA con truc tiep
    (parent_id IN groups), mirror legacy instance — TAT CA trong 1 giao dich.

    Raises:
        ValueError: khong chon nhom / qua 500 nhom / khong chon workspace /
            workspace chua dang ky trong danh sach kha dung (GET /workspaces) /
            id khong ton tai / khong phai nhom / RPC tra ve trong.

    Tra ve: {"assignment": {item_id: [instances]}, "groups": [ids da goi]}.
    """
    supabase: Client = get_supabase_client()
    ids: list[str] = []
    for raw in group_ids or []:
        value = str(raw or "").strip()
        if value and value not in ids:
            ids.append(value)
    if not ids:
        raise ValueError("Vui lòng chọn ít nhất 1 nhóm sản phẩm.")
    if len(ids) > 500:
        raise ValueError("Chỉ được gán tối đa 500 nhóm mỗi lần.")

    normalized = _normalize_instances(instances)
    if not normalized:
        raise ValueError("Vui lòng chọn ít nhất 1 Workspace.")

    # Workspace kha dung = nguon DONG duy nhat cua app (GET /workspaces).
    available = {
        (w.get("instance_key") or "").strip().lower()
        for w in list_available_workspaces()
        if w.get("instance_key")
    }
    unknown = [i for i in normalized if i not in available]
    if unknown:
        raise ValueError(
            "Workspace không hợp lệ: " + ", ".join(sorted(set(unknown)))
            + ". Danh sách Workspace khả dụng: " + ", ".join(sorted(available))
        )

    existing = (
        supabase.table(ITEMS_TABLE)
        .select("id, item_type")
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    by_id = {r["id"]: r for r in existing}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise ValueError(
            "Một vài nhóm không tồn tại hoặc đã bị xoá (ids: " + ", ".join(missing[:5]) + "…)."
        )
    not_group = [i for i, r in by_id.items() if r.get("item_type") != "group"]
    if not_group:
        raise ValueError(
            "Các id sau không phải là nhóm sản phẩm (ids: " + ", ".join(sorted(not_group)[:5]) + "…)."
        )

    rpc_rows = (
        supabase.rpc(
            "service_catalog_ws_assign",
            {"p_group_ids": ids, "p_instances": normalized, "p_actor_id": actor_id},
        )
        .execute()
        .data
        or []
    )
    if not rpc_rows:
        raise ValueError("Không ghi được Workspace assignment (database trả về trống).")

    assignment: dict[str, list[str]] = {}
    for row in rpc_rows:
        item_id = str(row.get("item_id"))
        instance = (row.get("instance") or "").strip().lower()
        if item_id and instance and instance not in assignment.setdefault(item_id, []):
            assignment[item_id].append(instance)
    return {"assignment": assignment, "groups": ids}


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
        "monthlyPriceVnd": _float_or_none(component.get("monthly_price_vnd")),
        "annualCommitMonthlyPriceVnd": _float_or_none(component.get("annual_commit_monthly_price_vnd")),
        "defaultCostPriceVnd": component.get("default_cost_price_vnd"),
        "defaultCustomerPriceVnd": component.get("default_customer_price_vnd"),
        "quota": bundle_item_row.get("quota"),
        "customerDisplayName": bundle_item_row.get("customer_display_name"),
        "crmNote": bundle_item_row.get("crm_note"),
        "quotaPoolKey": bundle_item_row.get("quota_pool_key"),
        "quotaPoolName": bundle_item_row.get("quota_pool_name"),
        "quotaPoolQuota": bundle_item_row.get("quota_pool_quota"),
        "quotaPoolLimit": _float_or_none(bundle_item_row.get("quota_pool_limit")),
        "required": bool(bundle_item_row.get("is_required", True)),
        "overagePolicy": bundle_item_row.get("overage_policy"),
        "showOnQuote": bool(bundle_item_row.get("show_on_quote", True)),
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
    """Ghép Description Items từ các thành phần của 1 bundle. Mỗi dòng chỉ lÃ
    displayText (số lượng cuối cùng đã quy đổi + đơn vị) kèm mô tả nếu có -
    TUYỆT ĐỐI không nối tên component hay hiển thị dạng phép nhân."""
    lines = []
    rendered_pool_keys: set[str] = set()
    for component in _bundle_components(bundle_id):
        if component.get("showOnQuote") is False:
            continue
        pool_key = component.get("quotaPoolKey")
        if pool_key:
            if pool_key in rendered_pool_keys:
                continue
            rendered_pool_keys.add(pool_key)
            name = component.get("quotaPoolName") or component.get("customerDisplayName") or component.get("name") or component.get("displayText")
            quota = component.get("quotaPoolQuota") or component.get("quota")
            text = f"{name}: {quota}" if quota else name
        else:
            name = component.get("customerDisplayName")
            text = f"{name}: {component.get('quota')}" if name and component.get("quota") else (name or component["displayText"])
        if not pool_key and component.get("description") and not component.get("customerDisplayName"):
            text = f"{text} - {component['description']}"
        lines.append(text)
    return "\n".join(lines)


# ==============================================================================
# TÍCH HỢP BỘ LỌC WORKSPACE: Danh sách Workspace khả dụng & Lọc danh mục theo Workspace
# ==============================================================================

def list_available_workspaces() -> list[dict]:
    """Lấy danh sách các Workspace khả dụng động từ Database.

    TÍCH HỢP BỘ LỌC WORKSPACE:
    - Truy vấn bảng `quote_issuer_companies` để lấy danh sách công ty/brand chính thức.
    - Truy vấn distinct `instance` từ bảng `service_catalog_items`.
    - Hợp nhất và trả về danh sách đầy đủ metadata (instance_key, code, name, total_groups)
      100% động từ DB, không hardcode danh sách trong client.
    """
    supabase: Client = get_supabase_client()
    companies = []
    try:
        companies_res = (
            supabase.table("quote_issuer_companies")
            .select("id, code, legal_name, brand_name, instance, status")
            .eq("status", "active")
            .order("sort_order")
            .execute()
        )
        companies = companies_res.data or []
    except Exception:
        companies = []

    group_counts: dict[str, int] = {}
    distinct_instances: set[str] = set()
    try:
        groups_res = (
            supabase.table(ITEMS_TABLE)
            .select("id, instance")
            .eq("item_type", "group")
            .execute()
        )
        all_groups = groups_res.data or []
        for g in all_groups:
            inst = (g.get("instance") or "markee").strip().lower()
            distinct_instances.add(inst)
    except Exception:
        all_groups = []

    # Counts theo assignment many-to-many (migration 190): dem DISTINCT nhom
    # theo tung instance trong JUNCTION; nhom khong co junction (DB cu / seed
    # cu) dem theo legacy instance (fallback). Product khong tao workspace moi.
    ws_map = _load_workspaces_map(supabase)
    for g in all_groups:
        gid = str(g.get("id"))
        inst = (g.get("instance") or "markee").strip().lower()
        assignments = set(ws_map.get(gid) or ([inst] if inst else []))
        for assigned in assignments:
            group_counts[assigned] = group_counts.get(assigned, 0) + 1
            distinct_instances.add(assigned)

    # Bản đồ quy chuẩn mã code công ty sang instance slug nếu chưa gán riêng
    code_to_instance = {
        "mk": "markee",
        "cg": "cloudgate",
        "sz": "securityzone",
    }

    seen_keys: set[str] = set()
    workspaces: list[dict] = []

    for comp in companies:
        code = (comp.get("code") or "").strip()
        code_lower = code.lower()
        inst_key = code_to_instance.get(code_lower, (comp.get("instance") or code_lower or "markee").lower())
        name = (comp.get("brand_name") or comp.get("legal_name") or code).strip()

        if inst_key not in seen_keys:
            seen_keys.add(inst_key)
            workspaces.append({
                "instance_key": inst_key,
                "code": code,
                "name": name,
                "total_groups": group_counts.get(inst_key, 0),
            })

    # Bổ sung các instance tồn tại trong service_catalog_items mà chưa có trong quote_issuer_companies
    for inst in sorted(distinct_instances):
        if inst not in seen_keys:
            seen_keys.add(inst)
            workspaces.append({
                "instance_key": inst,
                "code": inst[:2].upper(),
                "name": inst.capitalize(),
                "total_groups": group_counts.get(inst, 0),
            })

    return workspaces


def list_service_catalog_items_scoped(instances: list[str] | None = None) -> list[dict]:
    """Lấy cây danh mục dịch vụ có lọc theo phân vùng Workspace (instances).

    TÍCH HỢP BỘ LỌC WORKSPACE:
    - Nếu instances được chỉ định (vd ['markee', 'cloudgate']): lọc items có instance tương ứng.
    - Nếu instances là None hoặc rỗng: lấy toàn bộ danh mục như cũ.
    - Duy trì 100% cấu trúc phân tầng cha-con và bundle components hiện tại.
    """
    supabase: Client = get_supabase_client()
    query = supabase.table(ITEMS_TABLE).select("*")

    if instances:
        normalized: set[str] = set()
        for i in instances:
            s = str(i).strip()
            if s:
                normalized.add(s)
                normalized.add(s.lower())
                normalized.add(s.upper())
                if s.lower() == "securityzone":
                    normalized.add("SECURITYZONE")
        if normalized:
            query = query.in_("instance", list(normalized))

    rows = query.order("sort_order").execute().data or []
    if instances:
        # Many-to-many (migration 190): nhom da gan nhieu workspace chi cap-junction.
        # Lay them cac item co assignment nam trong bo loc (junction), nhung
        # chua tu cach legacy-filter benh tre (fallback cho DB cu / seeded cu).
        keys = sorted({s.lower() for s in normalized if s})
        ws_rows = (
            supabase.table(WORKSPACES_TABLE)
            .select("item_id")
            .in_("instance", keys)
            .execute()
            .data
            or []
        )
        junction_ids = [str(r["item_id"]) for r in ws_rows if r.get("item_id")]
        seen_ids = {r.get("id") for r in rows}
        extra_ids = [i for i in junction_ids if i not in seen_ids]
        if extra_ids:
            try:
                extra_rows = (
                    supabase.table(ITEMS_TABLE)
                    .select("*")
                    .in_("id", extra_ids)
                    .order("sort_order")
                    .execute()
                    .data
                    or []
                )
            except Exception:
                extra_rows = []
            rows = list(rows) + list(extra_rows)
    mapped = [_row_to_item(row) for row in rows]
    _attach_workspaces(supabase, mapped)
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


def list_service_catalog_items() -> list[dict]:
    """Hàm gốc giữ nguyên để đảm bảo backward-compatibility 100%."""
    return list_service_catalog_items_scoped(None)


def get_service_catalog_item(item_id: str) -> dict:
    supabase: Client = get_supabase_client()
    row = supabase.table(ITEMS_TABLE).select("*").eq("id", item_id).maybe_single().execute().data
    if not row:
        raise ValueError("Khong tim thay dich vu.")
    item = _row_to_item(row)
    _attach_workspaces(supabase, [item])
    if item["itemType"] == "bundle":
        item["components"] = _bundle_components(item_id)
    merge_pricing_into_tree([item], resolve_pricing_map(_collect_item_ids([item]), None))
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
    items = [_row_to_item(row) for row in rows]
    _attach_workspaces(supabase, items)
    return items


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
        "default_vat_rate": payload.get("default_vat_rate"),
        "customer_visible": payload.get("customer_visible", True),
        "quote_display_name": payload.get("quote_display_name"),
        "quote_description": payload.get("quote_description"),
        "quote_cta": payload.get("quote_cta"),
        "monthly_price_vnd": _float_or_none(payload.get("monthly_price_vnd")),
        "annual_commit_monthly_price_vnd": _float_or_none(payload.get("annual_commit_monthly_price_vnd")),
        "annual_total_price_vnd": _float_or_none(payload.get("annual_total_price_vnd")),
        "max_sale_discount_percent": _float_or_none(payload.get("max_sale_discount_percent")),
        "target_gross_margin_percent": _float_or_none(payload.get("target_gross_margin_percent")),
        "cost_basis_rule": payload.get("cost_basis_rule"),
        "pricing_policy_exceptions": payload.get("pricing_policy_exceptions") or [],
        "quota_user_count": _float_or_none(payload.get("quota_user_count")),
        "quota_user_label": payload.get("quota_user_label"),
        "quota_connected_channels": _float_or_none(payload.get("quota_connected_channels")),
        "quota_connected_channels_label": payload.get("quota_connected_channels_label"),
        "quota_messages_per_month": _float_or_none(payload.get("quota_messages_per_month")),
        "quota_messages_per_month_label": payload.get("quota_messages_per_month_label"),
        "quota_ai_data": payload.get("quota_ai_data"),
        "quota_highlights": payload.get("quota_highlights"),
        "quota_extra": payload.get("quota_extra") or {},
        "spec_quantity_per_unit": payload.get("spec_quantity_per_unit") or 1,
        "spec_unit_label": payload.get("spec_unit_label"),
        "note": payload.get("note"),
        "status": payload.get("status") or "active",
        "sort_order": next_order,
        "created_by": created_by,
        "updated_by": created_by,
    }
    # Only include optional fields if they have values (for compatibility with databases that may not have migration 127 applied)
    for field in ["brand", "part_number", "product_type", "internal_note"]:
        if payload.get(field) is not None:
            insert_data[field] = payload.get(field)
    # External identity (migration 175) — chi dien khi nguoi goi truyen vao
    # (dong bo MSC). Caller thuong (UI them moi) khong truyen => khong thay doi
    # hanh vi hien tai.
    for field in ["external_source", "external_id"]:
        if payload.get(field) is not None:
            insert_data[field] = payload.get(field)

    # TÍCH HỢP BỘ LỌC WORKSPACE: Gán instance khi tạo mới (từ form, hoặc kế thừa từ nhóm cha nếu có parent_id)
    if payload.get("instance"):
        insert_data["instance"] = payload.get("instance").strip().lower()
    elif payload.get("parent_id"):
        try:
            parent_res = supabase.table(ITEMS_TABLE).select("instance").eq("id", payload.get("parent_id")).limit(1).execute()
            if parent_res.data and parent_res.data[0].get("instance"):
                insert_data["instance"] = parent_res.data[0]["instance"].strip().lower()
        except Exception:
            pass
    
    result = supabase.table(ITEMS_TABLE).insert(insert_data).execute()
    item = result.data[0]

    # Many-to-many Workspace (migration 190): ghep junction ngay khi tao de
    # cac duong sau nay (MSC sync, vendor import) tu dong dong bo qua ham nay.
    try:
        ws_map = _load_workspaces_map(supabase)
        if item.get("parent_id"):
            # child: nhan dung set cua nhom cha (junction cua parent, fallback legacy)
            try:
                parent_row = (
                    supabase.table(ITEMS_TABLE)
                    .select("id, instance")
                    .eq("id", item["parent_id"])
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                parent_set = _workspace_set_for(
                    supabase,
                    parent_row[0] if parent_row else {"id": item["parent_id"], "instance": None},
                    ws_map,
                )
            except Exception:
                parent_set = []
            if not parent_set:
                parent_set = [(insert_data.get("instance") or "markee").strip().lower()]
            _ws_write(supabase, [item["id"]], parent_set, created_by)
        else:
            own_instance = (insert_data.get("instance") or item.get("instance") or "markee").strip().lower()
            _ws_write(supabase, [item["id"]], [own_instance], created_by)
    except Exception:
        # Neu attach workspace that bai (vd DB chua chay migration 190):
        # khong lam hong flow create; item van co legacy instance de hoat
        # dong nhu cu (read path co fallback).
        pass

    # Also upsert pricing if provided (only if at least one core pricing field has a non-None value)
    # Note: pricing_input_mode alone is not enough - we need at least one actual price value
    core_pricing_fields = ["default_cost_price_vnd", "default_markup_percent", "default_customer_price_vnd"]
    if any(payload.get(k) is not None for k in core_pricing_fields):
        upsert_service_catalog_item_pricing(
            item_id=item["id"],
            issuer_company_id=None,
            cost_price_vnd=payload.get("default_cost_price_vnd"),
            markup_percent=payload.get("default_markup_percent"),
            customer_price_vnd=payload.get("default_customer_price_vnd"),
            pricing_input_mode=payload.get("pricing_input_mode") or "cost",
            supplier_currency=payload.get("supplier_currency"),
            supplier_list_price=payload.get("supplier_list_price"),
            supplier_discount_percent=payload.get("supplier_discount_percent"),
            supplier_net_price=payload.get("supplier_net_price"),
            supplier_exchange_rate=payload.get("supplier_exchange_rate"),
            supplier_converted_price=payload.get("supplier_converted_price"),
            supplier_vendor_id=payload.get("supplier_vendor_id"),
            supplier_quote_ref=payload.get("supplier_quote_ref"),
            supplier_quote_source=payload.get("supplier_quote_source"),
            supplier_quote_date=payload.get("supplier_quote_date"),
            supplier_valid_until=payload.get("supplier_valid_until"),
            shipping_cost=payload.get("shipping_cost"),
            import_fee=payload.get("import_fee"),
            other_cost=payload.get("other_cost"),
            pricing_policy=payload.get("pricing_policy"),
        )

    created_item = _row_to_item(item)
    merge_pricing_into_tree([created_item], resolve_pricing_map([item["id"]], None))
    return created_item


# Field dong bo MSC (msc_sync_service._ITEM_SYNC_FIELDS tru name) ma nguoi dung
# CRM co the sua qua edit form. Khi update THUC SU lam doi gia tri 1 trong cac
# field nay, field do duoc danh dau vao cot sync_manual_fields (migration 176)
# de lan dong bo MSC sau do GIU NGUYEN gia tri nguoi dung (task "Extend MSC
# product sync" §7 - manual edit khong bi ghi de). Danh dau theo "gia tri that
# su khac" chu KHONG theo "co ton tai trong payload" vi edit form luon gui day
# du cac field (khong sua = khong danh dau).
_SYNC_MANUAL_TRACKED_FIELDS = ("brand", "part_number", "parent_id")


def _mark_sync_manual_fields(
    supabase: Client, item_id: str, update_data: dict
) -> None:
    """Doc gia tri cu cua item, danh dau cac field dong bo bi nguoi dung sua
    that su vao sync_manual_fields (merge voi danh sach cu, khong mat mark).
    Khong lam hong qua trinh update: loi doc/ghi mark chi duoc bo qua."""
    try:
        old_rows = (
            supabase.table(ITEMS_TABLE)
            .select("id, brand, part_number, parent_id, sync_manual_fields")
            .eq("id", item_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not old_rows:
            return
        old_row = old_rows[0]
        manual_fields = list(old_row.get("sync_manual_fields") or [])
        changed = False
        for key in _SYNC_MANUAL_TRACKED_FIELDS:
            if key not in update_data:
                continue
            if str(update_data.get(key) or "") == str(old_row.get(key) or ""):
                continue
            if key not in manual_fields:
                manual_fields.append(key)
                changed = True
        if changed:
            update_data["sync_manual_fields"] = manual_fields
    except Exception:
        # Khong duoc de viec danh dau manual lam hong update binh thuong.
        pass


def update_service_catalog_item(item_id: str, payload: dict, actor_id: str | None) -> dict:
    supabase: Client = get_supabase_client()

    # Doc ban ghi hien tai TRUOC khi cap nhat: can biet parent_id cu de nhan
    # biet co "reparent" (doi nhom cha) hay khong — reparent thi phai inherit
    # lai full set workspace cua nhom moi. Dung limit(1) (khong maybe_single)
    # de tuong thich moi truong test hien co cua repo.
    previous_rows = (
        supabase.table(ITEMS_TABLE)
        .select("id, parent_id, instance")
        .eq("id", item_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    previous = previous_rows[0] if previous_rows else None
    previous_parent_id = str(previous.get("parent_id") or "") if previous else ""

    allowed_keys = {
        "item_type", "parent_id", "sku", "name", "description", "unit",
        "list_price_usd", "unit_price_usd", "exchange_rate_snapshot",
        "default_unit_price_vnd", "default_discount_percent", "default_vat_rate",
        "customer_visible", "quote_display_name", "quote_description", "quote_cta",
        "monthly_price_vnd", "annual_commit_monthly_price_vnd",
        "annual_total_price_vnd", "max_sale_discount_percent", "target_gross_margin_percent",
        "cost_basis_rule", "pricing_policy_exceptions", "quota_user_count", "quota_user_label",
        "quota_connected_channels", "quota_connected_channels_label",
        "quota_messages_per_month", "quota_messages_per_month_label", "quota_ai_data",
        "quota_highlights", "quota_extra", "spec_quantity_per_unit", "spec_unit_label",
        "note", "status", "sort_order", "brand", "part_number", "product_type",
        "internal_note", "external_source", "external_id",
        # TÍCH HỢP BỘ LỌC WORKSPACE: Cho phép cập nhật trường instance
        "instance",
    }
    nullable_clear_keys = {
        "default_vat_rate", "quote_display_name", "quote_description", "quote_cta",
        "target_gross_margin_percent", "cost_basis_rule", "pricing_policy_exceptions",
    }
    update_data = {
        k: v for k, v in payload.items()
        if k in allowed_keys and (v is not None or k in nullable_clear_keys)
    }
    for numeric_key in (
        "monthly_price_vnd", "annual_commit_monthly_price_vnd", "annual_total_price_vnd",
        "max_sale_discount_percent", "target_gross_margin_percent", "quota_user_count", "quota_connected_channels",
        "quota_messages_per_month",
    ):
        if numeric_key in update_data:
            update_data[numeric_key] = _float_or_none(update_data[numeric_key])
    if update_data.get("pricing_policy_exceptions") is None:
        update_data.pop("pricing_policy_exceptions", None)

    # Manual-edit tracking (migration 176): danh dau field dong bo bi nguoi
    # dung sua that su truoc khi ghi, de MSC sync khong ghi de (§7).
    _mark_sync_manual_fields(supabase, item_id, update_data)

    update_data["updated_by"] = actor_id
    update_data["updated_at"] = _now_iso()
    result = supabase.table(ITEMS_TABLE).update(update_data).eq("id", item_id).execute()
    if not result.data:
        raise ValueError("Khong tim thay dich vu.")

    # Also upsert pricing if provided (only if at least one core pricing field has a non-None value)
    # Note: pricing_input_mode alone is not enough - we need at least one actual price value
    core_pricing_fields = ["default_cost_price_vnd", "default_markup_percent", "default_customer_price_vnd"]
    if any(payload.get(k) is not None for k in core_pricing_fields):
        upsert_service_catalog_item_pricing(
            item_id=item_id,
            issuer_company_id=None,
            cost_price_vnd=payload.get("default_cost_price_vnd"),
            markup_percent=payload.get("default_markup_percent"),
            customer_price_vnd=payload.get("default_customer_price_vnd"),
            pricing_input_mode=payload.get("pricing_input_mode") or "cost",
            supplier_currency=payload.get("supplier_currency"),
            supplier_list_price=payload.get("supplier_list_price"),
            supplier_discount_percent=payload.get("supplier_discount_percent"),
            supplier_net_price=payload.get("supplier_net_price"),
            supplier_exchange_rate=payload.get("supplier_exchange_rate"),
            supplier_converted_price=payload.get("supplier_converted_price"),
            supplier_vendor_id=payload.get("supplier_vendor_id"),
            supplier_quote_ref=payload.get("supplier_quote_ref"),
            supplier_quote_source=payload.get("supplier_quote_source"),
            supplier_quote_date=payload.get("supplier_quote_date"),
            supplier_valid_until=payload.get("supplier_valid_until"),
            shipping_cost=payload.get("shipping_cost"),
            import_fee=payload.get("import_fee"),
            other_cost=payload.get("other_cost"),
            pricing_policy=payload.get("pricing_policy"),
        )

    # Many-to-many Workspace (migration 190): sua assignment SAU khi cap nhat
    # update_data xong de gia tri sau-cap-nhat la co so duyet 1 duong:
    #   - payload co `instance`  -> set moi = {instance do} (replace-all;
    #     bulk multi-workspace di qua endpoint /workspaces-assign).
    #   - parent_id THAY DOI     -> reparent: product nhan full set cua nhom moi.
    if "instance" in update_data:
        try:
            _ws_write(supabase, [item_id], [_normalize_instances([update_data["instance"]])[0] or "markee"], actor_id)
        except Exception:
            pass
    else:
        new_parent_id = str(update_data.get("parent_id") or "")
        if new_parent_id and new_parent_id != previous_parent_id:
            try:
                parent_row = (
                    supabase.table(ITEMS_TABLE)
                    .select("id, instance")
                    .eq("id", new_parent_id)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                ws_map = _load_workspaces_map(supabase)
                parent_set = _workspace_set_for(
                    supabase,
                    parent_row[0] if parent_row else {"id": new_parent_id, "instance": None},
                    ws_map,
                )
                if parent_set:
                    _ws_write(supabase, [item_id], parent_set, actor_id)
            except Exception:
                pass

    updated_item = _row_to_item(result.data[0])
    _attach_workspaces(supabase, [updated_item])
    merge_pricing_into_tree([updated_item], resolve_pricing_map([item_id], None))
    return updated_item


def delete_service_catalog_item(item_id: str) -> dict:
    supabase: Client = get_supabase_client()
    item = supabase.table(ITEMS_TABLE).select("*").eq("id", item_id).maybe_single().execute().data
    if not item:
        raise ValueError("Khong tim thay dich vu.")

    if item["item_type"] == "group":
        children = supabase.table(ITEMS_TABLE).select("id").eq("parent_id", item_id).limit(1).execute()
        if children.data:
            raise ValueError("Nhom dich vu con dich vu con, khong the xoa.")

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
            raise ValueError(f"Sản phẩm đang được sử dụng trong (các) gói: {names}. Vui lòng xóa sản phẩm khỏi (các) gói trước khi xóa, hoặc chuyển sang trạng thái 'Ngừng kinh doanh'.")

    used_in_quotes = (
        supabase.table("quote_items").select("id").eq("catalog_item_id", item_id).limit(1).execute().data or []
    )
    if used_in_quotes:
        result = (
            supabase.table(ITEMS_TABLE)
            .update({"status": "inactive", "updated_at": _now_iso()})
            .eq("id", item_id)
            .execute()
        )
        updated = result.data[0] if result.data else {**item, "status": "inactive"}
        return {"deleted": False, "deactivated": True, "item": _row_to_item(updated)}

    supabase.table(ITEMS_TABLE).delete().eq("id", item_id).execute()
    return {"deleted": True, "deactivated": False}

def reorder_service_catalog_item(item_id: str, direction: str) -> list[dict]:
    """Swap sort_order giữa dòng target và hàng xóm liền kề, TRONG CÙNG parent_id."""
    supabase: Client = get_supabase_client()
    current = supabase.table(ITEMS_TABLE).select("*").eq("id", item_id).maybe_single().execute().data
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
    bundle = supabase.table(ITEMS_TABLE).select("*").eq("id", bundle_id).maybe_single().execute().data
    if not bundle or bundle["item_type"] != "bundle":
        raise ValueError("Không tìm thấy gói dịch vụ.")

    supabase.table(BUNDLE_ITEMS_TABLE).delete().eq("bundle_id", bundle_id).execute()
    for index, item in enumerate(items):
        supabase.table(BUNDLE_ITEMS_TABLE).insert({
            "bundle_id": bundle_id,
            "component_id": item["component_id"],
            "quantity": item.get("quantity") or 1,
            "quota": item.get("quota"),
            "customer_display_name": item.get("customer_display_name"),
            "crm_note": item.get("crm_note"),
            "quota_pool_key": item.get("quota_pool_key"),
            "quota_pool_name": item.get("quota_pool_name"),
            "quota_pool_quota": item.get("quota_pool_quota"),
            "quota_pool_limit": _float_or_none(item.get("quota_pool_limit")),
            "is_required": item.get("is_required", True),
            "overage_policy": item.get("overage_policy"),
            "show_on_quote": item.get("show_on_quote", True),
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
    return list(dict.fromkeys(ids))


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def resolve_pricing_map(item_ids: list[str], issuer_company_id: str | None) -> dict[str, dict[str, Decimal | None]]:
    """Voi moi item_id, uu tien dong pricing khop dung issuer_company_id dang
    resolve; neu khong co, dung dong `issuer_company_id IS NULL` (mac dinh
    dung chung); neu khong co dong nao -> ca 3 gia tri None (chua cau hinh,
    KHONG bia so 0)."""
    if not item_ids:
        return {}
    supabase: Client = get_supabase_client()
    unique_item_ids = list(dict.fromkeys(item_ids))
    pricing_select = (
        "service_catalog_item_id, issuer_company_id, default_cost_price_vnd, "
        "default_markup_percent, default_customer_price_vnd, supplier_currency, "
        "supplier_list_price, supplier_discount_percent, supplier_net_price, "
        "supplier_exchange_rate, supplier_converted_price, supplier_vendor_id, "
        "supplier_quote_ref, supplier_quote_source, supplier_quote_date, "
        "supplier_valid_until, shipping_cost, import_fee, other_cost, pricing_policy"
    )
    rows: list[dict] = []
    # PostgREST encodes `.in_(...)` in the request URL. The catalog page asks
    # for every SKU plus bundle components, so a single request can exceed the
    # gateway limit and make the router silently return catalog data without
    # pricing. Keep this batched so DB pricing is not lost between API and FE.
    for batch in _chunks(unique_item_ids, 25):
        rows.extend(
            supabase.table(PRICING_TABLE)
            .select(pricing_select)
            .in_("service_catalog_item_id", batch)
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
        entry.update({
            "supplierCurrency": row.get("supplier_currency"),
            "supplierListPrice": _to_decimal(row.get("supplier_list_price")),
            "supplierDiscountPercent": _to_decimal(row.get("supplier_discount_percent")),
            "supplierNetPrice": _to_decimal(row.get("supplier_net_price")),
            "supplierExchangeRate": _to_decimal(row.get("supplier_exchange_rate")),
            "supplierConvertedPrice": _to_decimal(row.get("supplier_converted_price")),
            "supplierVendorId": row.get("supplier_vendor_id"),
            "supplierQuoteRef": row.get("supplier_quote_ref"),
            "supplierQuoteSource": row.get("supplier_quote_source"),
            "supplierQuoteDate": row.get("supplier_quote_date"),
            "supplierValidUntil": row.get("supplier_valid_until"),
            "shippingCost": _to_decimal(row.get("shipping_cost")),
            "importFee": _to_decimal(row.get("import_fee")),
            "otherCost": _to_decimal(row.get("other_cost")),
            "pricingPolicy": row.get("pricing_policy"),
        })
        if row.get("issuer_company_id") and issuer_company_id and row["issuer_company_id"] == issuer_company_id:
            specific[item_id] = entry
        elif not row.get("issuer_company_id"):
            default[item_id] = entry
    result: dict[str, dict[str, Decimal | None]] = {}
    for item_id in unique_item_ids:
        result[item_id] = specific.get(item_id, default.get(item_id, {"cost": None, "markup": None, "customer": None}))
    return result


def _merge_pricing_entry(item: dict, entry: dict) -> None:
    item["defaultCostPriceVnd"] = float(entry["cost"]) if entry.get("cost") is not None else None
    item["defaultMarkupPercent"] = float(entry["markup"]) if entry.get("markup") is not None else None
    item["defaultCustomerPriceVnd"] = float(entry["customer"]) if entry.get("customer") is not None else None
    item["supplierCurrency"] = entry.get("supplierCurrency")
    item["supplierListPrice"] = float(entry["supplierListPrice"]) if entry.get("supplierListPrice") is not None else None
    item["supplierDiscountPercent"] = float(entry["supplierDiscountPercent"]) if entry.get("supplierDiscountPercent") is not None else None
    item["supplierNetPrice"] = float(entry["supplierNetPrice"]) if entry.get("supplierNetPrice") is not None else None
    item["supplierExchangeRate"] = float(entry["supplierExchangeRate"]) if entry.get("supplierExchangeRate") is not None else None
    item["supplierConvertedPrice"] = float(entry["supplierConvertedPrice"]) if entry.get("supplierConvertedPrice") is not None else None
    item["supplierVendorId"] = entry.get("supplierVendorId")
    item["supplierQuoteRef"] = entry.get("supplierQuoteRef")
    item["supplierQuoteSource"] = entry.get("supplierQuoteSource")
    item["supplierQuoteDate"] = entry.get("supplierQuoteDate")
    item["supplierValidUntil"] = entry.get("supplierValidUntil")
    item["shippingCost"] = float(entry["shippingCost"]) if entry.get("shippingCost") is not None else None
    item["importFee"] = float(entry["importFee"]) if entry.get("importFee") is not None else None
    item["otherCost"] = float(entry["otherCost"]) if entry.get("otherCost") is not None else None
    item["pricingPolicy"] = entry.get("pricingPolicy")


def merge_pricing_into_tree(tree: list[dict], pricing_map: dict[str, dict[str, Decimal | None]]) -> None:
    """Gan defaultCostPriceVnd/defaultMarkupPercent/defaultCustomerPriceVnd vao
    TUNG item trong cay (mutate in-place) - CHI goi ham nay sau khi router da
    xac nhan nguoi goi du quyen xem cost/markup; neu khong du quyen, XOA HAN
    2 field cost/markup (khong tra null gia), CHI giu lai defaultCustomerPriceVnd
    (Gia khach luon duoc tra cho moi request da auth, khong qua cong quyen
    nay - xem router)."""
    for item in tree:
        entry = pricing_map.get(item["id"], {})
        _merge_pricing_entry(item, entry)
        merge_pricing_into_tree(item.get("children") or [], pricing_map)
        for component in item.get("components") or []:
            comp_id = component.get("componentId")
            comp_entry = pricing_map.get(comp_id, {}) if comp_id else {}
            _merge_pricing_entry(component, comp_entry)


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
    pricing_input_mode: Literal["cost", "markup", "price", "customer_price"],
    actor_id: str | None = None,
    supplier_currency: str | None = None,
    supplier_list_price: Decimal | None = None,
    supplier_discount_percent: Decimal | None = None,
    supplier_net_price: Decimal | None = None,
    supplier_exchange_rate: Decimal | None = None,
    supplier_converted_price: Decimal | None = None,
    supplier_vendor_id: str | None = None,
    supplier_quote_ref: str | None = None,
    supplier_quote_source: str | None = None,
    supplier_quote_date: str | None = None,
    supplier_valid_until: str | None = None,
    shipping_cost: Decimal | None = None,
    import_fee: Decimal | None = None,
    other_cost: Decimal | None = None,
    pricing_policy: str | None = None,
) -> dict:
    """Backend la nguon THAT DUY NHAT tinh 3 gia tri - KHONG luu nguyen so
    client gui cho field KHONG phai field dieu khien. Contract chinh thuc:
    Markup% = (gia khach - gia von) / gia von * 100,
    Gia khach = gia von * (1 + Markup/100).
    Field duoc TINH LAI tuy `pricing_input_mode`:
      - mode='markup': cost + markup_percent la input, customer = cost * (1 + markup/100).
      - mode='customer_price' (alias 'price'): cost + customer la input,
        markup = (customer-cost)/cost neu cost > 0.
      - mode='cost': markup + customer la input, cost = customer / (1 + markup/100).
    Validate: cost/customer khong am (< 0 -> ValueError). Markup phai >= -100%
    khi dung de tinh nguoc/xuoi de gia khach khong am."""
    if cost_price_vnd is not None and cost_price_vnd < 0:
        raise ValueError("Giá vốn không được âm.")
    if customer_price_vnd is not None and customer_price_vnd < 0:
        raise ValueError("Giá khách không được âm.")
    if markup_percent is not None and markup_percent < -100:
        raise ValueError("Markup must be greater than or equal to -100%.")

    if pricing_input_mode == "markup":
        markup = markup_percent
        if cost_price_vnd is None or markup is None:
            customer = None
        else:
            multiplier = Decimal("1") + markup / Decimal("100")
            customer = cost_price_vnd * multiplier if multiplier >= 0 else None
        cost, resolved_markup, resolved_customer = cost_price_vnd, markup, customer
    elif pricing_input_mode in ("price", "customer_price"):
        if cost_price_vnd is None or cost_price_vnd <= 0 or customer_price_vnd is None:
            resolved_markup = None
        else:
            resolved_markup = ((customer_price_vnd - cost_price_vnd) / cost_price_vnd) * Decimal("100")
        cost, resolved_customer = cost_price_vnd, customer_price_vnd
    elif pricing_input_mode == "cost":
        markup = markup_percent
        divisor = None if markup is None else (Decimal("1") + markup / Decimal("100"))
        if divisor is None or divisor <= 0 or customer_price_vnd is None:
            cost = None
        else:
            cost = customer_price_vnd / divisor
        resolved_markup, resolved_customer = markup, customer_price_vnd
    else:
        cost, resolved_markup, resolved_customer = cost_price_vnd, markup_percent, customer_price_vnd

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
    # DB co CHECK exchange_rate > 0: 0/am nghia la "chua co ty gia" -> NULL.
    if supplier_exchange_rate is not None and supplier_exchange_rate <= 0:
        supplier_exchange_rate = None
    supplier_payload = {
        "supplier_currency": supplier_currency,
        "supplier_list_price": supplier_list_price,
        "supplier_discount_percent": supplier_discount_percent,
        "supplier_net_price": supplier_net_price,
        "supplier_exchange_rate": supplier_exchange_rate,
        "supplier_converted_price": supplier_converted_price,
        "supplier_vendor_id": supplier_vendor_id,
        "supplier_quote_ref": supplier_quote_ref,
        "supplier_quote_source": supplier_quote_source,
        "supplier_quote_date": supplier_quote_date,
        "supplier_valid_until": supplier_valid_until,
        "shipping_cost": shipping_cost,
        "import_fee": import_fee,
        "other_cost": other_cost,
        "pricing_policy": pricing_policy,
    }
    payload.update({
        key: (float(value) if isinstance(value, Decimal) else value)
        for key, value in supplier_payload.items()
        if value is not None
    })
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
