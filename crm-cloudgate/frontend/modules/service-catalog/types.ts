export type ServiceCatalogItemType = 'group' | 'component' | 'bundle';
export type ServiceCatalogStatus = 'active' | 'inactive';

export interface BundleComponentLine {
  id?: string;
  componentId: string;
  sku?: string;
  name?: string;
  description?: string;
  unit?: string;
  quantity: number;
  computedQuantity: number;
  displayText: string;
  unitPriceVnd: number;
  sortOrder: number;
  /** Bo gia MAC DINH rieng (migration 107, service_catalog_item_pricing) -
   * TACH BIET unitPriceVnd (Gia BAN). defaultCostPriceVnd/defaultMarkupPercent
   * chi co mat trong response neu nguoi goi du quyen xem (xem
   * _resolve_catalog_pricing_visibility o backend) - undefined = KHONG co
   * quyen xem (khac null = co quyen nhung chua cau hinh). defaultCustomerPriceVnd
   * LUON co mat cho moi request da auth (khong qua cong quyen nay). */
  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
}

export interface ServiceCatalogItem {
  id: string;
  itemType: ServiceCatalogItemType;
  parentId?: string;
  /** Chỉ có khi lấy qua getServiceCatalogOptions() (bước điền báo giá) — tên
   * nhóm cha, dùng để lọc theo nhóm trong popup chọn sản phẩm. */
  groupId?: string;
  groupName?: string;
  sku?: string;
  name: string;
  description?: string;
  unit?: string;
  listPriceUsd?: number;
  unitPriceUsd?: number;
  exchangeRateSnapshot?: number;
  defaultUnitPriceVnd: number;
  defaultDiscountPercent: number;
  defaultVatRate: number;
  specQuantityPerUnit: number;
  specUnitLabel?: string;
  note?: string;
  status: ServiceCatalogStatus;
  sortOrder: number;
  children?: ServiceCatalogItem[];
  components?: BundleComponentLine[];
  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
}

export interface ServiceCatalogOptions {
  bundles: ServiceCatalogItem[];
  components: ServiceCatalogItem[];
}

export interface ServiceCatalogItemInput {
  itemType: ServiceCatalogItemType;
  parentId?: string;
  sku?: string;
  name: string;
  description?: string;
  unit?: string;
  listPriceUsd?: number;
  unitPriceUsd?: number;
  exchangeRateSnapshot?: number;
  defaultUnitPriceVnd?: number;
  defaultDiscountPercent?: number;
  defaultVatRate?: number;
  specQuantityPerUnit?: number;
  specUnitLabel?: string;
  note?: string;
  status?: ServiceCatalogStatus;
}

export interface BundleComponentInput {
  componentId: string;
  quantity: number;
  sortOrder: number;
}

/** 1 dòng giá (migration 107) — issuerCompanyId=null nghĩa là bộ giá mặc
 * định dùng chung cho mọi công ty phát hành (khác dòng riêng theo issuer). */
export interface ServiceCatalogItemPricingRow {
  id: string;
  issuerCompanyId: string | null;
  defaultCostPriceVnd: number | null;
  defaultMarkupPercent: number | null;
  defaultCustomerPriceVnd: number | null;
  updatedAt?: string;
}

export type ServiceCatalogPricingInputMode = 'markup' | 'customer_price';

export interface ServiceCatalogItemPricingUpsertInput {
  issuerCompanyId?: string | null;
  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
  pricingInputMode: ServiceCatalogPricingInputMode;
}
