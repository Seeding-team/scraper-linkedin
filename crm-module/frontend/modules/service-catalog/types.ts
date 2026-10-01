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
  monthlyPriceVnd?: number | null;
  annualCommitMonthlyPriceVnd?: number | null;
  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
  quota?: string | null;
  customerDisplayName?: string | null;
  crmNote?: string | null;
  quotaPoolKey?: string | null;
  quotaPoolName?: string | null;
  quotaPoolQuota?: string | null;
  quotaPoolLimit?: number | null;
  required?: boolean;
  overagePolicy?: string | null;
  showOnQuote?: boolean;
  sortOrder: number;
  /** Bo gia MAC DINH rieng (migration 107, service_catalog_item_pricing) -
   * TACH BIET unitPriceVnd (Gia BAN). defaultCostPriceVnd/defaultMarkupPercent
   * chi co mat trong response neu nguoi goi du quyen xem (xem
   * _resolve_catalog_pricing_visibility o backend) - undefined = KHONG co
   * quyen xem (khac null = co quyen nhung chua cau hinh). defaultCustomerPriceVnd
   * LUON co mat cho moi request da auth (khong qua cong quyen nay). */
}

export interface ServiceCatalogItem {
  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
  pricingInputMode?: ServiceCatalogPricingInputMode;
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
  defaultVatRate: number | null;
  customerVisible: boolean;
  quoteDisplayName?: string | null;
  quoteDescription?: string | null;
  quoteCta?: string | null;
  monthlyPriceVnd?: number | null;
  annualCommitMonthlyPriceVnd?: number | null;
  annualTotalPriceVnd?: number | null;
  maxSaleDiscountPercent?: number | null;
  targetGrossMarginPercent?: number | null;
  costBasisRule?: string | null;
  pricingPolicyExceptions?: Array<Record<string, unknown>>;
  quotaUserCount?: number | null;
  quotaUserLabel?: string | null;
  quotaConnectedChannels?: number | null;
  quotaConnectedChannelsLabel?: string | null;
  quotaMessagesPerMonth?: number | null;
  quotaMessagesPerMonthLabel?: string | null;
  quotaAiData?: string | null;
  quotaHighlights?: string | null;
  quotaExtra?: Record<string, unknown>;
  specQuantityPerUnit: number;
  specUnitLabel?: string;
  note?: string;
  status: ServiceCatalogStatus;
  sortOrder: number;
  brand?: string;
  partNumber?: string;
  productType?: string;
  internalNote?: string;
  supplierCurrency?: string;
  supplierListPrice?: number | null;
  supplierDiscountPercent?: number | null;
  supplierNetPrice?: number | null;
  supplierExchangeRate?: number | null;
  supplierConvertedPrice?: number | null;
  supplierVendorId?: string | null;
  supplierQuoteRef?: string | null;
  supplierQuoteSource?: string | null;
  supplierQuoteDate?: string | null;
  supplierValidUntil?: string | null;
  shippingCost?: number | null;
  importFee?: number | null;
  otherCost?: number | null;
  pricingPolicy?: string | null;


  children?: ServiceCatalogItem[];
  components?: BundleComponentLine[];
}

/** "Đơn vị tính & VAT" - master-data THẬT (migration 117), quản lý qua
 * ServiceCatalogConfigPage.tsx - tách biệt hoàn toàn với
 * ServiceCatalogItem.unit/defaultVatRate (vẫn là chuỗi/số tự do trên từng
 * sản phẩm, không đổi). */
export interface ServiceCatalogUnit {
  id: string;
  name: string;
  status: ServiceCatalogStatus;
  sortOrder: number;
}

export interface ServiceCatalogVatRate {
  id: string;
  rate: number;
  status: ServiceCatalogStatus;
  sortOrder: number;
}

export interface ServiceCatalogOptions {
  bundles: ServiceCatalogItem[];
  components: ServiceCatalogItem[];
}

export interface ServiceCatalogItemInput {
  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
  pricingInputMode?: ServiceCatalogPricingInputMode;
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
  defaultVatRate?: number | null;
  customerVisible?: boolean;
  quoteDisplayName?: string | null;
  quoteDescription?: string | null;
  quoteCta?: string | null;
  monthlyPriceVnd?: number | null;
  annualCommitMonthlyPriceVnd?: number | null;
  annualTotalPriceVnd?: number | null;
  maxSaleDiscountPercent?: number | null;
  targetGrossMarginPercent?: number | null;
  costBasisRule?: string | null;
  pricingPolicyExceptions?: Array<Record<string, unknown>>;
  quotaUserCount?: number | null;
  quotaUserLabel?: string | null;
  quotaConnectedChannels?: number | null;
  quotaConnectedChannelsLabel?: string | null;
  quotaMessagesPerMonth?: number | null;
  quotaMessagesPerMonthLabel?: string | null;
  quotaAiData?: string | null;
  quotaHighlights?: string | null;
  quotaExtra?: Record<string, unknown>;
  specQuantityPerUnit?: number;
  specUnitLabel?: string;
  note?: string;
  status?: ServiceCatalogStatus;
  brand?: string;
  partNumber?: string;
  productType?: string;
  internalNote?: string;
  supplierCurrency?: string;
  supplierListPrice?: number | null;
  supplierDiscountPercent?: number | null;
  supplierNetPrice?: number | null;
  supplierExchangeRate?: number | null;
  supplierConvertedPrice?: number | null;
  supplierVendorId?: string | null;
  supplierQuoteRef?: string | null;
  supplierQuoteSource?: string | null;
  supplierQuoteDate?: string | null;
  supplierValidUntil?: string | null;
  shippingCost?: number | null;
  importFee?: number | null;
  otherCost?: number | null;
  pricingPolicy?: string | null;

}

export interface BundleComponentInput {
  componentId: string;
  quantity: number;
  quota?: string | null;
  customerDisplayName?: string | null;
  crmNote?: string | null;
  quotaPoolKey?: string | null;
  quotaPoolName?: string | null;
  quotaPoolQuota?: string | null;
  quotaPoolLimit?: number | null;
  required?: boolean;
  overagePolicy?: string | null;
  showOnQuote?: boolean;
  sortOrder: number;
}

/** 1 dòng giá (migration 107) — issuerCompanyId=null nghĩa là bộ giá mặc
 * định dùng chung cho mọi công ty phát hành (khác dòng riêng theo issuer). */
export interface ServiceCatalogItemPricingRow {
  id: string;
  issuerCompanyId: string | null;
  updatedAt?: string;

  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
}

export type ServiceCatalogPricingInputMode = 'cost' | 'markup' | 'price';

export interface ServiceCatalogItemPricingUpsertInput {
  pricingInputMode: ServiceCatalogPricingInputMode;
  issuerCompanyId?: string | null;
  defaultCostPriceVnd?: number | null;
  defaultMarkupPercent?: number | null;
  defaultCustomerPriceVnd?: number | null;
  supplierCurrency?: string;
  supplierListPrice?: number | null;
  supplierDiscountPercent?: number | null;
  supplierNetPrice?: number | null;
  supplierExchangeRate?: number | null;
  supplierConvertedPrice?: number | null;
  supplierVendorId?: string | null;
  supplierQuoteRef?: string | null;
  supplierQuoteSource?: string | null;
  supplierQuoteDate?: string | null;
  supplierValidUntil?: string | null;
  shippingCost?: number | null;
  importFee?: number | null;
  otherCost?: number | null;
  pricingPolicy?: string | null;

}
