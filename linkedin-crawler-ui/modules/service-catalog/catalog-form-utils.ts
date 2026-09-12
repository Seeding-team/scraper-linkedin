import type { ServiceCatalogItem, ServiceCatalogItemInput } from './types';
import { formatCurrencyDisplay } from '@/lib/currency';

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
    defaultVatRate: 0,
    specQuantityPerUnit: 1,
    specUnitLabel: '',
    note: '',
    status: 'active',
  };
}

export function emptyGroupForm(): ServiceCatalogItemInput {
  return {
    itemType: 'group',
    sku: '',
    name: '',
    description: '',
    status: 'active',
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
    defaultVatRate: item.defaultVatRate,
    specQuantityPerUnit: item.specQuantityPerUnit,
    specUnitLabel: item.specUnitLabel || '',
    note: item.note || '',
    status: item.status,
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
  if (cost == null || markup == null) return null;
  return cost * (1 + markup / 100);
}

export function computeMarkupFromCustomer(cost: number | null, customer: number | null): number | null {
  if (cost == null || cost === 0 || customer == null) return null;
  return (customer / cost - 1) * 100;
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
