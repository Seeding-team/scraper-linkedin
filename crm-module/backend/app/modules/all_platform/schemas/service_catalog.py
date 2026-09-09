"""Danh mục dịch vụ (Service Catalog) schemas — group/component/bundle dùng chung
cho các Mẫu báo giá, thay thế dữ liệu dịch vụ hard-code trong schema_json."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ServiceCatalogItemCreateRequest(BaseModel):
    item_type: str  # 'group' | 'component' | 'bundle'
    parent_id: Optional[str] = None
    sku: Optional[str] = None
    name: str
    description: Optional[str] = None
    unit: Optional[str] = None
    list_price_usd: Optional[float] = None
    unit_price_usd: Optional[float] = None
    exchange_rate_snapshot: Optional[float] = None
    default_unit_price_vnd: float = 0
    default_discount_percent: float = Field(default=0, ge=0, le=100)
    default_vat_rate: float = Field(default=0, ge=0, le=100)
    spec_quantity_per_unit: float = 1
    spec_unit_label: Optional[str] = None
    note: Optional[str] = None
    status: str = "active"


class ServiceCatalogItemUpdateRequest(BaseModel):
    id: str
    parent_id: Optional[str] = None
    sku: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    list_price_usd: Optional[float] = None
    unit_price_usd: Optional[float] = None
    exchange_rate_snapshot: Optional[float] = None
    default_unit_price_vnd: Optional[float] = None
    default_discount_percent: Optional[float] = Field(default=None, ge=0, le=100)
    default_vat_rate: Optional[float] = Field(default=None, ge=0, le=100)
    spec_quantity_per_unit: Optional[float] = None
    spec_unit_label: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = None


class ServiceCatalogReorderRequest(BaseModel):
    id: str
    direction: str  # 'up' | 'down'


class BundleComponentInput(BaseModel):
    component_id: str
    quantity: float = 1
    sort_order: int = 0


class BundleComponentsSetRequest(BaseModel):
    items: list[BundleComponentInput] = []


class QuoteFormCatalogLinksSetRequest(BaseModel):
    catalog_item_ids: list[str] = []


class ServiceCatalogItemPricingUpsertRequest(BaseModel):
    """Bo gia MAC DINH rieng cho danh muc chung (migration 107,
    service_catalog_item_pricing) - TACH BIET hoan toan default_unit_price_vnd
    (gia BAN tren service_catalog_items, bang do RLS mo). issuer_company_id=None
    nghia la gia mac dinh dung chung moi cong ty phat hanh (quy uoc "Trung
    tinh" da co san o quote_forms.issuer_company_id).

    `pricing_input_mode` bat buoc - cho biet field nao vua duoc nguoi dung sua
    SAU CUNG, de backend tu TINH LAI field con lai bang Decimal (KHONG luu
    nguyen 3 so client gui - xem upsert_service_catalog_item_pricing()).
    Dung Decimal, KHONG dung float cho tien/%."""

    issuer_company_id: Optional[str] = None
    default_cost_price_vnd: Optional[Decimal] = Field(default=None, ge=0)
    default_markup_percent: Optional[Decimal] = None
    default_customer_price_vnd: Optional[Decimal] = Field(default=None, ge=0)
    pricing_input_mode: Literal["markup", "customer_price"]
