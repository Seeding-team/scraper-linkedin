"""Đơn vị tính & Mức VAT — master-data THẬT cho Danh mục dịch vụ (migration 117).

Trước đây trang "Thuế & đơn vị tính" chỉ là 1 báo cáo thống kê tính từ dữ
liệu sản phẩm hiện có (service_catalog_items.unit/default_vat_rate là chuỗi/
số tự do, KHÔNG tham chiếu bảng nào) - 2 bảng mới `service_catalog_units`/
`service_catalog_vat_rates` cho phép quản lý (thêm/sửa/ngừng sử dụng) 1 danh
sách "gợi ý chuẩn" thật sự, tách biệt hoàn toàn khỏi service_catalog_items
(KHÔNG đổi/xoá cột nào trên bảng đó — giữ nguyên logic giá/API hiện có)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client

from app.core.supabase_client import get_supabase_client

UNITS_TABLE = "service_catalog_units"
VAT_RATES_TABLE = "service_catalog_vat_rates"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_unit(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "sortOrder": row.get("sort_order") or 0,
    }


def _row_to_vat_rate(row: dict) -> dict:
    return {
        "id": row["id"],
        "rate": float(row["rate"]),
        "status": row["status"],
        "sortOrder": row.get("sort_order") or 0,
    }


def list_service_catalog_units(include_inactive: bool = True) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(UNITS_TABLE).select("*")
    if not include_inactive:
        query = query.eq("status", "active")
    res = query.order("sort_order").order("name").execute()
    return [_row_to_unit(row) for row in (res.data or [])]


def create_service_catalog_unit(name: str, status: str = "active") -> dict:
    name = name.strip()
    if not name:
        raise ValueError("Tên đơn vị tính không được để trống.")
    supabase: Client = get_supabase_client()
    res = (
        supabase.table(UNITS_TABLE)
        .insert({"name": name, "status": status, "updated_at": _now_iso()})
        .execute()
    )
    if not res.data:
        raise ValueError("Không tạo được đơn vị tính.")
    return _row_to_unit(res.data[0])


def update_service_catalog_unit(unit_id: str, patch: dict[str, Any]) -> dict:
    supabase: Client = get_supabase_client()
    update_data: dict[str, Any] = {"updated_at": _now_iso()}
    if "name" in patch and patch["name"] is not None:
        name = str(patch["name"]).strip()
        if not name:
            raise ValueError("Tên đơn vị tính không được để trống.")
        update_data["name"] = name
    if "status" in patch and patch["status"] is not None:
        update_data["status"] = patch["status"]
    res = supabase.table(UNITS_TABLE).update(update_data).eq("id", unit_id).execute()
    if not res.data:
        raise ValueError("Không tìm thấy đơn vị tính để cập nhật.")
    return _row_to_unit(res.data[0])


def list_service_catalog_vat_rates(include_inactive: bool = True) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(VAT_RATES_TABLE).select("*")
    if not include_inactive:
        query = query.eq("status", "active")
    res = query.order("sort_order").order("rate").execute()
    return [_row_to_vat_rate(row) for row in (res.data or [])]


def create_service_catalog_vat_rate(rate: float, status: str = "active") -> dict:
    supabase: Client = get_supabase_client()
    res = (
        supabase.table(VAT_RATES_TABLE)
        .insert({"rate": rate, "status": status, "updated_at": _now_iso()})
        .execute()
    )
    if not res.data:
        raise ValueError("Không tạo được mức VAT.")
    return _row_to_vat_rate(res.data[0])


def update_service_catalog_vat_rate(vat_rate_id: str, patch: dict[str, Any]) -> dict:
    supabase: Client = get_supabase_client()
    update_data: dict[str, Any] = {"updated_at": _now_iso()}
    if "rate" in patch and patch["rate"] is not None:
        update_data["rate"] = patch["rate"]
    if "status" in patch and patch["status"] is not None:
        update_data["status"] = patch["status"]
    res = supabase.table(VAT_RATES_TABLE).update(update_data).eq("id", vat_rate_id).execute()
    if not res.data:
        raise ValueError("Không tìm thấy mức VAT để cập nhật.")
    return _row_to_vat_rate(res.data[0])
