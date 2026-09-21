import type { ServiceCatalogItem, ServiceCatalogItemInput } from './types';
import { formatCurrencyDisplay } from '@/lib/currency';
import {
  costFromTargetGrossMarginAndCustomer,
  customerPriceFromTargetGrossMargin,
  targetGrossMarginFromCustomerPrice,
} from './pricing-math';

/** Helper dung chung cho form Nhom/San pham + tinh toan bo gia mac dinh
 * (Gia von/Markup/Gia khach) - tach rieng ra khoi ServiceCatalogPage.tsx cu
 * de ServiceCatalogGroupDetailPage.tsx (trang moi) tai su dung dung 1 noi,
 * khong copy-paste lai (yeu cau "ưu tiên tái sử dụng component"). */

export function emptyProductForm(parentId?: string): ServiceCatalogItemInput {
  return {
    itemType: 'component',
    parentId,
    sku: '',
    name: '',
    description: '',
    unit: '',
    listPriceUsd: undefined,
    unitPriceUsd: undefined,
    exchangeRateSnapshot: undefined,
    defaultUnitPriceVnd: 0,
    defaultDiscountPercent: 0,
    defaultVatRate: null,
    customerVisible: true,
    quoteDisplayName: '',
    quoteDescription: '',
    quoteCta: '',
    monthlyPriceVnd: null,
    annualCommitMonthlyPriceVnd: null,
    annualTotalPriceVnd: null,
    maxSaleDiscountPercent: null,
    targetGrossMarginPercent: null,
    costBasisRule: '',
    pricingPolicyExceptions: [],
    quotaUserCount: null,
    quotaUserLabel: '',
    quotaConnectedChannels: null,
    quotaConnectedChannelsLabel: '',
    quotaMessagesPerMonth: null,
    quotaMessagesPerMonthLabel: '',
    quotaAiData: '',
    quotaHighlights: '',
    quotaExtra: {},
    specQuantityPerUnit: 1,
    specUnitLabel: '',
    note: '',
    status: 'active',
    brand: '',
    partNumber: '',
    productType: '',
    internalNote: '',
    supplierCurrency: 'VND',
    supplierListPrice: null,
    supplierDiscountPercent: null,
    supplierNetPrice: null,
    supplierExchangeRate: null,
    supplierConvertedPrice: null,
    supplierVendorId: null,
    supplierQuoteRef: '',
    supplierQuoteSource: '',
    supplierQuoteDate: '',
    supplierValidUntil: '',
    shippingCost: null,
    importFee: null,
    otherCost: null,
    pricingPolicy: '',
  };
}

export function emptyGroupForm(): ServiceCatalogItemInput {
  return {
    itemType: 'group',
    sku: '',
    name: '',
    description: '',
    status: 'active',
    defaultVatRate: null,
    customerVisible: true,
    targetGrossMarginPercent: null,
    costBasisRule: '',
    pricingPolicyExceptions: [],
    quotaUserLabel: '',
    quotaConnectedChannelsLabel: '',
    quotaMessagesPerMonthLabel: '',
    brand: '',
    partNumber: '',
    productType: '',
    internalNote: '',
    supplierCurrency: 'VND',
    supplierQuoteSource: '',
  };
}

export function itemToForm(item: ServiceCatalogItem): ServiceCatalogItemInput {
  return {
    itemType: item.itemType,
    parentId: item.parentId,
    sku: item.sku || '',
    name: item.name,
    description: item.description || '',
    unit: item.unit || '',
    listPriceUsd: item.listPriceUsd,
    unitPriceUsd: item.unitPriceUsd,
    exchangeRateSnapshot: item.exchangeRateSnapshot,
    defaultUnitPriceVnd: item.defaultUnitPriceVnd,
    defaultDiscountPercent: item.defaultDiscountPercent,
    defaultVatRate: item.defaultVatRate ?? null,
    customerVisible: item.customerVisible ?? true,
    quoteDisplayName: item.quoteDisplayName || '',
    quoteDescription: item.quoteDescription || '',
    quoteCta: item.quoteCta || '',
    monthlyPriceVnd: item.monthlyPriceVnd ?? null,
    annualCommitMonthlyPriceVnd: item.annualCommitMonthlyPriceVnd ?? null,
    annualTotalPriceVnd: item.annualTotalPriceVnd ?? null,
    maxSaleDiscountPercent: item.maxSaleDiscountPercent ?? null,
    targetGrossMarginPercent: item.targetGrossMarginPercent ?? null,
    costBasisRule: item.costBasisRule || '',
    pricingPolicyExceptions: item.pricingPolicyExceptions || [],
    quotaUserCount: item.quotaUserCount ?? null,
    quotaUserLabel: item.quotaUserLabel || '',
    quotaConnectedChannels: item.quotaConnectedChannels ?? null,
    quotaConnectedChannelsLabel: item.quotaConnectedChannelsLabel || '',
    quotaMessagesPerMonth: item.quotaMessagesPerMonth ?? null,
    quotaMessagesPerMonthLabel: item.quotaMessagesPerMonthLabel || '',
    quotaAiData: item.quotaAiData || '',
    quotaHighlights: item.quotaHighlights || '',
    quotaExtra: item.quotaExtra || {},
    specQuantityPerUnit: item.specQuantityPerUnit,
    specUnitLabel: item.specUnitLabel || '',
    note: item.note || '',
    status: item.status,
    brand: item.brand,
    partNumber: item.partNumber,
    productType: item.productType,
    internalNote: item.internalNote,
    supplierCurrency: item.supplierCurrency || 'VND',
    supplierListPrice: item.supplierListPrice ?? null,
    supplierDiscountPercent: item.supplierDiscountPercent ?? null,
    supplierNetPrice: item.supplierNetPrice ?? null,
    supplierExchangeRate: item.supplierExchangeRate ?? null,
    supplierConvertedPrice: item.supplierConvertedPrice ?? null,
    supplierVendorId: item.supplierVendorId ?? null,
    supplierQuoteRef: item.supplierQuoteRef || '',
    supplierQuoteSource: item.supplierQuoteSource || '',
    supplierQuoteDate: item.supplierQuoteDate || '',
    supplierValidUntil: item.supplierValidUntil || '',
    shippingCost: item.shippingCost ?? null,
    importFee: item.importFee ?? null,
    otherCost: item.otherCost ?? null,
    pricingPolicy: item.pricingPolicy || '',
  };
}

// Wrapper mong quanh formatCurrencyDisplay() dung chung (lib/currency.ts) -
// khong tu goi toLocaleString rieng nua.
export function formatVnd(value: number | undefined | null): string {
  return `${formatCurrencyDisplay(value || 0)} đ`;
}

/** Gia `0` la 1 gia tri DA cau hinh, khac voi "chua nhap" (null/undefined) -
 * KHONG duoc coi `0` la falsy roi hien "Chưa nhập" (dung != null, khong
 * dung `value || fallback`). */
export function formatVndOrMissing(value: number | undefined | null): string {
  if (value == null) return 'Chưa nhập';
  return `${formatCurrencyDisplay(value)} đ`;
}

export function formatMarkupOrMissing(value: number | undefined | null): string {
  if (value == null) return 'Chưa nhập';
  return `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
}

export function computeCustomerFromMarkup(cost: number | null, markup: number | null): number | null {
  return customerPriceFromTargetGrossMargin(cost, markup);
}

export function computeMarkupFromCustomer(cost: number | null, customer: number | null): number | null {
  return targetGrossMarginFromCustomerPrice(cost, customer);
}

/** Nguoc voi computeCustomerFromMarkup: suy Gia von tu GM muc tieu + Gia khach. */
export function computeCostFromMarkupAndCustomer(markup: number | null, customer: number | null): number | null {
  return costFromTargetGrossMarginAndCustomer(markup, customer);
}

export function parseNullableNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** "SKU – Tên" nhưng bỏ SKU nếu trùng hệt tên. */
export function formatSkuName(sku: string | undefined, name: string): string {
  if (!sku || sku.trim().toLowerCase() === name.trim().toLowerCase()) return name;
  return `${sku} – ${name}`;
}

export interface FlatProduct extends ServiceCatalogItem {
  groupName: string;
}
