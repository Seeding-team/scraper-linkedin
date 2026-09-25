'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { seedingQuoteRepository, QuoteApprovalRequiresExceptionError, QuoteDocumentRenderer, QuotePrintLayoutSaveButton, buildPublicQuoteUrl } from '@/modules/quotes';
import type { Quote, QuoteActivityLogEntry, QuoteHandoffChecklist, QuoteItem, QuoteProcessingStage, QuoteApprovalRuleSet, QuoteApprovalRuleType, QuoteRuleEvaluation, QuoteDeliveryLogEntry, QuoteForm, QuoteData, IssuerCompany } from '@/modules/quotes';
import type { ContactOption } from './dealHydration';
import { applyIssuerCompanySnapshot, applyIssuerPaymentTermsSnapshot } from '../integrations/quotes/types';
import type { AppUser } from '@/types/unified.types';
import { canApproveQuote, canEditQuoteCost, canEditQuotePricingFields, canWriteDeal, getPackageText, getServicePackageText, SOURCE_OPTIONS, SERVICE_PACKAGE_OPTIONS, CRM_PACKAGE_OPTIONS, INDUSTRY_OPTIONS } from '../constants/crmConfig';
import { CurrencyInput } from '@/components/CurrencyInput';
import type { CrmUserOption, Deal, CreateDealInput } from '../types';
import type { ServiceCatalogItem } from '@/modules/service-catalog/types';
import { serviceCatalogRepository } from '@/modules/service-catalog/repositories/ServiceCatalogRepository';
import { priceBookZoneRepository, type PriceBookItem } from '@/modules/service-catalog/repositories/PriceBookZoneRepository';
import { previewPriceBookItem, formatVnd as formatPriceBookVnd, formatPercent as formatPriceBookPercent } from '@/modules/service-catalog/price-book-preview';
import { customerPriceFromTargetGrossMargin } from '@/modules/service-catalog/pricing-math';
import { CatalogPickerModal, type CatalogPickerListItem } from '@/modules/service-catalog/CatalogPickerModal';
import { useCatalogItemAdd } from '@/modules/service-catalog/useCatalogItemAdd';
import { QuickAddProductModal } from '@/modules/service-catalog/QuickAddProductModal';
import { QuickAddGroupModal } from '@/modules/service-catalog/QuickAddGroupModal';
import {
  dealBusinessCode,
  formatDate,
  formatMoney,
  formatPercentTrim,
  initialsOf,
  quoteDisplayStatus,
  relativeTime,
} from '../utils/quoteDisplay';
import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronUp, Eye, FileText, GitBranchPlus, History, LayoutGrid, Link2, Mail, Maximize2, Minimize2, Pencil, Phone, Plus, Printer, RectangleHorizontal, RectangleVertical, RotateCcw, Send, Trash2, User, X } from './icons';
import { usersService, projectsService, allPlatformCategoriesService, type QuoteBusinessRoleUser, type Project } from '@/services/all-platform.service';
import { computeQuoteSla } from '../utils/quoteSla';
import { SearchableSelect } from './SearchableSelect';
import { CustomerAddDrawer } from './CustomerAddDrawer';
import { CrmCategoryManageDrawer, CrmCategoryQuickModal, invalidateCrmCategoryCache } from './CrmCategorySelect';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import { ProjectFormModal } from './ProjectFormModal';
import { DealFormModal, clearDealDraft } from './DealFormModal';
import { ConfirmModal } from './ConfirmModal';
import { ActionMenu } from './ActionMenu';
import { QuoteColumnVisibilityPicker } from '../integrations/quotes/QuoteColumnVisibilityPicker';
import type { QuoteDraft } from '../integrations/quotes/types';
import { CustomBlocksEditor } from '../integrations/quotes/CustomBlocksEditor';
import { PaymentPlanEditor } from '@/modules/quotes/components/PaymentPlanEditor';
import { calculateQuoteTotals, calculateOverallDiscountSummary, clampDiscountPercent, calculateItemTotal, calculateSectionTotal } from '@/modules/quotes/utils/quoteCalculations';
import { paymentPlanAmount, paymentPlanPercent } from '@/modules/quotes/utils/paymentPlan';
import type { BundleSnapshotComponent, BundleSnapshotValue, CustomBlock, PaymentPlanRow } from '@/modules/quotes/types';

/** 4 buoc THAT (Yeu cau bao gia/Thong tin ky thuat/Hoan thien gia ban/Cho
 * duyet-Phat hanh) - anh xa dung 1-1 voi `quotes.processing_stage` (migration
 * 085). KHONG phai Presale/Sale/CEO - he thong chi co Admin/Leader/Member +
 * Team Sale/Dev/MKT that (xem plan da xac nhan). */
const STAGE_ORDER: QuoteProcessingStage[] = ['request', 'technical', 'pricing', 'review'];
const STAGE_LABELS: Record<QuoteProcessingStage, string> = {
  request: 'Yêu cầu báo giá',
  technical: 'Thông tin kỹ thuật',
  pricing: 'Hoàn thiện giá bán',
  review: 'Chờ duyệt',
  // Khong hien nhu 1 step rieng tren stage bar (STAGE_ORDER van dung 4 buoc
  // theo dung HTML) - chi dung lam fallback text khi can, gia tri that hien
  // qua stageLabel() dua tren processingStage/status THAT (migration 087).
  ready_to_publish: 'Đã duyệt · Chưa phát hành',
  published: 'Đã phát hành',
};

type QuoteCustomerOption = {
  id: string;
  label: string;
  name?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxCode?: string;
};

function appendBundleQuota(label: string, quota?: string | null): string {
  const cleanQuota = String(quota || '').trim();
  if (!cleanQuota) return label;
  if (label.toLowerCase().includes(cleanQuota.toLowerCase())) return label;
  return `${label} — ${cleanQuota}`;
}

function bundleSnapshotComponents(item: QuoteItem): BundleSnapshotComponent[] {
  const snapshot = item.bundleSnapshot as unknown;
  if (Array.isArray(snapshot)) return snapshot as BundleSnapshotComponent[];
  if (snapshot && typeof snapshot === 'object' && Array.isArray((snapshot as { components?: unknown }).components)) {
    return (snapshot as { components: BundleSnapshotComponent[] }).components;
  }
  return [];
}

function bundleSnapshotPricingMode(item: QuoteItem): 'fixed' | 'auto' {
  const snapshot = item.bundleSnapshot as unknown;
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && (snapshot as { pricingMode?: unknown }).pricingMode === 'auto') {
    return 'auto';
  }
  return 'fixed';
}

function bundleSnapshotTargetGm(item: QuoteItem): number {
  const snapshot = item.bundleSnapshot as unknown;
  const fromSnapshot = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? Number((snapshot as { targetGrossMarginPercent?: unknown }).targetGrossMarginPercent)
    : NaN;
  if (Number.isFinite(fromSnapshot) && fromSnapshot >= 0 && fromSnapshot < 100) return fromSnapshot;
  return 30;
}

function makeBundleSnapshot(item: QuoteItem, components: BundleSnapshotComponent[], patch: Partial<BundleSnapshotValue> = {}): BundleSnapshotValue {
  const snapshot = item.bundleSnapshot as unknown;
  const existing = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot as Partial<BundleSnapshotValue> : {};
  return {
    ...existing,
    pricingMode: patch.pricingMode ?? existing.pricingMode ?? 'fixed',
    targetGrossMarginPercent: patch.targetGrossMarginPercent ?? existing.targetGrossMarginPercent ?? 30,
    components,
  };
}

function roundBundlePrice(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / 1000) * 1000);
}

function componentCustomerPrice(component: BundleSnapshotComponent): number {
  const configured = firstPositiveNumber(
    component.defaultCustomerPriceVnd,
    component.monthlyPriceVnd,
    component.annualCommitMonthlyPriceVnd,
    component.unitPriceVnd
  );
  return Math.max(0, Number(configured ?? component.defaultCustomerPriceVnd ?? component.unitPriceVnd ?? 0) || 0);
}

function componentCostPrice(component: BundleSnapshotComponent): number | null {
  const cost = component.defaultCostPriceVnd;
  return cost == null ? null : Math.max(0, Number(cost) || 0);
}

function componentQuantity(component: BundleSnapshotComponent): number {
  return Math.max(0, Number(component.computedQuantity || component.quantity || 1) || 0);
}

function calculateBundleComponentCost(components: BundleSnapshotComponent[]): number | null {
  let hasCost = false;
  const countedPoolKeys = new Set<string>();
  const total = components.reduce((sum, component) => {
    const poolKey = component.quotaPoolKey?.trim();
    if (poolKey) {
      if (countedPoolKeys.has(poolKey)) return sum;
      countedPoolKeys.add(poolKey);
    }
    const cost = componentCostPrice(component);
    if (cost == null) return sum;
    hasCost = true;
    return sum + cost * componentQuantity(component);
  }, 0);
  return hasCost ? total : null;
}

function calculateMarkupFromCostPrice(cost: number | null | undefined, price: number | null): number | null {
  if (cost == null || price == null) return null;
  if (!Number.isFinite(cost) || !Number.isFinite(price) || cost <= 0) return null;
  return ((price - cost) / cost) * 100;
}

function isValidMarkupPercent(value: number): boolean {
  return Number.isFinite(value) && value >= -100;
}

function isValidTargetMarginPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 100;
}

function formatPercentFixed2(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

/** "TỶ TRỌNG" (C, cot noi bo) = amount / quoteTotal * 100 - dung CHUNG cong
 * thuc voi calculateQuoteTotals (ca 2 deu cong tren calculateItemTotal) de
 * tu so/mau so luon cung 1 co so "Thành tiền" gồm VAT, khong bao gio lech
 * nhau. quoteTotal <= 0 (bao gia rong/loi) tra ve "—" thay vi chia cho 0
 * (NaN/Infinity) - formatPercentFixed2 da lo sẵn Number.isFinite nhung van
 * chan tu day cho ro rang y do. */
function formatWeightPercent(amount: number, quoteTotal: number): string {
  if (!quoteTotal || !Number.isFinite(quoteTotal)) return '—';
  return formatPercentFixed2((amount / quoteTotal) * 100);
}

const MOJIBAKE_HINT_RE = /[\u00c2\u00c3\u00c4\u00c6]|\u00e1[\u00ba\u00bb]/;

function repairUtf8Mojibake(value: string | null | undefined): string {
  if (!value) return '';
  if (!MOJIBAKE_HINT_RE.test(value)) return value;
  try {
    const bytes = Uint8Array.from(Array.from(value, char => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return decoded && !decoded.includes('\uFFFD') ? decoded : value;
  } catch {
    return value;
  }
}

function deepClone<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneQuoteItems(items: QuoteItem[]): QuoteItem[] {
  return deepClone(items);
}

function sanitizeDraftQuoteItems(items: QuoteItem[]): QuoteItem[] {
  return cloneQuoteItems(items).map(item => ({
    ...item,
    markupPercent: item.markupPercent != null && isValidMarkupPercent(item.markupPercent) ? item.markupPercent : null,
  }));
}

function resolveQuoteItemCostTotal(item: Partial<QuoteItem>): number | null {
  if (item.costNotApplicable) return 0;
  if (item.costTotal != null && Number.isFinite(Number(item.costTotal))) return Math.max(0, Number(item.costTotal));
  if (item.costPrice != null && Number.isFinite(Number(item.costPrice))) {
    const quantity = Number.isFinite(Number(item.quantity)) ? Math.max(0, Number(item.quantity)) : 0;
    return Math.max(0, Number(item.costPrice)) * quantity;
  }
  return null;
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function resolveCatalogCustomerPrice(item: ServiceCatalogItem): number {
  const configured = firstPositiveNumber(
    item.defaultCustomerPriceVnd,
    item.monthlyPriceVnd,
    item.annualCommitMonthlyPriceVnd,
    item.defaultUnitPriceVnd
  );
  if (configured != null) return configured;
  if (
    item.defaultCostPriceVnd != null &&
    item.defaultMarkupPercent != null &&
    Number.isFinite(item.defaultCostPriceVnd) &&
    Number.isFinite(item.defaultMarkupPercent)
  ) {
    return customerPriceFromTargetGrossMargin(item.defaultCostPriceVnd, item.defaultMarkupPercent) ?? 0;
  }
  return 0;
}

function recalculateBundleParent(item: QuoteItem, components: BundleSnapshotComponent[], mode: 'fixed' | 'auto' = bundleSnapshotPricingMode(item), targetGm = bundleSnapshotTargetGm(item)): QuoteItem {
  const bundleCost = calculateBundleComponentCost(components);
  let unitPrice = item.unitPrice;
  if (mode === 'auto' && bundleCost != null) {
    unitPrice = roundBundlePrice(bundleCost / (1 - targetGm / 100));
  }
  return {
    ...item,
    costPrice: bundleCost,
    costNotApplicable: false,
    unitPrice,
    markupPercent: calculateMarkupFromCostPrice(bundleCost, unitPrice),
    bundleSnapshot: makeBundleSnapshot(item, components, { pricingMode: mode, targetGrossMarginPercent: targetGm }),
  };
}

function bundleComponentsToWorkspaceRows(item: QuoteItem, catalogItems: ServiceCatalogItem[] = []): QuoteItem[] {
  const catalogBundle = item.catalogItemId ? catalogItems.find(candidate => candidate.id === item.catalogItemId) : undefined;
  const fallbackComponentsById = new Map(
    (catalogBundle?.components || []).map(component => [component.componentId, component])
  );
  const components = bundleSnapshotComponents(item)
    .filter(component => component.showOnQuote !== false)
    .map(component => {
      const fallback = fallbackComponentsById.get(component.componentId);
      return {
        ...component,
        defaultCostPriceVnd: component.defaultCostPriceVnd !== undefined ? component.defaultCostPriceVnd : fallback?.defaultCostPriceVnd,
        defaultMarkupPercent: component.defaultMarkupPercent !== undefined ? component.defaultMarkupPercent : fallback?.defaultMarkupPercent,
        monthlyPriceVnd: component.monthlyPriceVnd !== undefined ? component.monthlyPriceVnd : fallback?.monthlyPriceVnd,
        annualCommitMonthlyPriceVnd: component.annualCommitMonthlyPriceVnd !== undefined ? component.annualCommitMonthlyPriceVnd : fallback?.annualCommitMonthlyPriceVnd,
        defaultCustomerPriceVnd: component.defaultCustomerPriceVnd !== undefined ? component.defaultCustomerPriceVnd : fallback?.defaultCustomerPriceVnd,
        unitPriceVnd: component.unitPriceVnd ?? fallback?.unitPriceVnd ?? fallback?.monthlyPriceVnd ?? fallback?.annualCommitMonthlyPriceVnd ?? fallback?.defaultCustomerPriceVnd ?? 0,
      };
    })
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const renderedPoolKeys = new Set<string>();
  const rows: QuoteItem[] = [];
  components.forEach((component, index) => {
    const componentCustomerPriceValue = componentCustomerPrice(component);
    const componentCost = component.defaultCostPriceVnd ?? null;
    const componentMarkup = componentCost != null
      ? calculateMarkupFromCostPrice(componentCost, componentCustomerPriceValue)
      : null;
    const poolKey = component.quotaPoolKey?.trim();
    if (poolKey) {
      if (renderedPoolKeys.has(poolKey)) return;
      renderedPoolKeys.add(poolKey);
      const poolComponents = components.filter(candidate => candidate.quotaPoolKey?.trim() === poolKey);
      const technicalPoolName = component.quotaPoolName || '';
      const label = component.customerDisplayName || (technicalPoolName.toLowerCase() === 'channel quota' ? 'Kênh kết nối' : technicalPoolName) || component.name || 'Kênh kết nối';
      rows.push({
        id: `bundle-pool-${poolKey}-${index}`,
        rowType: 'item',
        serviceDescription: appendBundleQuota(label, component.quotaPoolQuota || component.quota),
        description: '',
        unit: component.unit || '',
        quantity: 1,
        unitPrice: componentCustomerPriceValue,
        costPrice: componentCost,
        markupPercent: componentMarkup,
        discountPercent: 0,
        vatRate: 0,
        __bundleComponent: true,
        __bundleComponentIds: poolComponents.map(poolComponent => poolComponent.componentId),
        __bundlePoolKey: poolKey,
        __bundleRequired: poolComponents.some(poolComponent => poolComponent.required === true),
        __bundleCanDeriveCost: poolComponents.some(poolComponent => (poolComponent.sku || '').toUpperCase() !== 'MCHAT-AI-TOKEN' && componentCustomerPrice(poolComponent) > 0),
      });
      return;
    }
    const label = component.customerDisplayName || component.name || component.displayText || 'Hạng mục';
    rows.push({
      id: `bundle-component-${component.componentId}-${index}`,
      rowType: 'item',
      serviceDescription: appendBundleQuota(label, component.quota),
      description: component.description || '',
      unit: component.unit || '',
      quantity: component.computedQuantity || component.quantity || 1,
      unitPrice: componentCustomerPriceValue,
      costPrice: componentCost,
      markupPercent: componentMarkup,
      discountPercent: 0,
      vatRate: 0,
      __bundleComponent: true,
      __bundleComponentIds: [component.componentId],
      __bundlePoolKey: null,
      __bundleRequired: component.required === true,
      __bundleCanDeriveCost: (component.sku || '').toUpperCase() !== 'MCHAT-AI-TOKEN' && componentCustomerPrice(component) > 0,
    });
  });
  return rows;
}

async function loadQuoteCustomerOptions(): Promise<QuoteCustomerOption[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers?page=1&page_size=200`, { credentials: 'include', headers });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(body.message || 'load failed');
  const items = (body.data?.items || []) as Array<{
    id: string;
    customer_name?: string;
    company_name?: string;
    phone?: string;
    email?: string;
    address?: string;
    tax_code?: string;
  }>;
  return items.map(row => ({
    id: row.id,
    label: `${row.customer_name || 'Khách hàng chưa tên'}${row.company_name ? ' · ' + row.company_name : ''}`,
    name: row.customer_name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxCode: row.tax_code,
  }));
}

async function loadQuoteCustomerOption(customerId: string): Promise<QuoteCustomerOption | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${customerId}`, { credentials: 'include', headers });
  const body = await res.json();
  if (!res.ok || body.success === false || !body.data) return null;
  const row = body.data as {
    id: string;
    customer_name?: string;
    company_name?: string;
    phone?: string;
    email?: string;
    address?: string;
    tax_code?: string;
  };
  return {
    id: row.id,
    label: `${row.customer_name || 'Khách hàng chưa tên'}${row.company_name ? ' · ' + row.company_name : ''}`,
    name: row.customer_name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxCode: row.tax_code,
  };
}

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Tạo báo giá',
  updated: 'Cập nhật báo giá',
  approved: 'Duyệt báo giá',
  cancelled: 'Huỷ báo giá',
  version_created: 'Tạo phiên bản mới',
  stage_changed: 'Chuyển bước xử lý',
  handoff_updated: 'Cập nhật bàn giao kỹ thuật',
  owner_assigned: 'Gán người phụ trách',
  version_reason: 'Ghi lý do tạo phiên bản',
  approved_with_exception: 'đã phê duyệt ngoại lệ',
  auto_approved_by_rule_engine: 'Tự động duyệt bởi Rule Engine',
};

/** Section 5 - hien cau tu nhien "<Ten> đã phê duyệt ngoại lệ cho V2 lúc …"
 * cho rieng action nay (khac cach hien chung "<Ten> <nhan>" cua cac action
 * khac) - dung yeu cau audit doc duoc ngay, khong phai 1 dong nhan chung
 * chung. Tra ve PHAN SAU ten (giu nguyen pattern <strong>{ten}</strong>
 * {phan_sau} o noi goi). Fallback ve nhan chung neu thieu
 * changes.versionNumber (du lieu cu truoc migration 102). */
function activityLogTail(entry: QuoteActivityLogEntry): string {
  if (entry.action === 'approved_with_exception') {
    const versionNumber = (entry.changes as { versionNumber?: number } | null)?.versionNumber;
    const at = formatDate(entry.createdAt);
    return versionNumber ? `đã phê duyệt ngoại lệ cho V${versionNumber} lúc ${at}` : `đã phê duyệt ngoại lệ lúc ${at}`;
  }
  return ACTIVITY_LABELS[entry.action] || entry.action;
}

/** Gop cac activity LIEN TIEP cung nguoi + cung loai hanh dong trong 1 cua so
 * thoi gian ngan (5 phut) thanh 1 dong kem "(xN)" - chi gop o TANG HIEN THI,
 * khong dung/sua data goc trong `quote_activity_log` (van con nguyen ven cho
 * moi lan doc lai). Dung cho ca 2 panel Activity trong workspace. */
const ACTIVITY_GROUP_WINDOW_MS = 5 * 60 * 1000;
const ACTIVITY_COLLAPSED_LIMIT = 5;

function groupActivityEntries(entries: QuoteActivityLogEntry[]): Array<{ entry: QuoteActivityLogEntry; count: number }> {
  const out: Array<{ entry: QuoteActivityLogEntry; count: number }> = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (
      last &&
      last.entry.actorId === entry.actorId &&
      last.entry.action === entry.action &&
      Math.abs(new Date(last.entry.createdAt).getTime() - new Date(entry.createdAt).getTime()) <= ACTIVITY_GROUP_WINDOW_MS
    ) {
      last.count += 1;
      continue;
    }
    out.push({ entry, count: 1 });
  }
  return out;
}

/** Empty-state khi chua co ai duoc cau hinh Presale/Sale (quote_business_role) -
 * gon trong 1 dong nho (khong de text dai lam lech header info-row), CTA
 * THAT cho Admin/Leader (link that toi Quan ly thanh vien), chi dan lien he
 * Admin cho Member (khong co quyen tu gan). */
function NoStaffConfigured({ isAdminOrLeader }: { isAdminOrLeader: boolean }) {
  return (
    <span className="qc-no-staff">
      <span className="qc-no-staff-text">Chưa có nhân sự phù hợp.</span>
      {isAdminOrLeader ? (
        <Link href="/all-platform/admin/quan-ly-thanh-vien" className="qc-no-staff-cta">Đi tới Quản lý thành viên</Link>
      ) : (
        <span className="qc-no-staff-cta qc-no-staff-cta--muted">Vui lòng liên hệ Admin.</span>
      )}
    </span>
  );
}

/** So La Ma cho Muc cha (I, II, III...) - dung 1 bang tra don gian, du dung
 * (bang hang muc thuc te chi vai chuc nhom la cung, khong can thuat toan
 * tong quat cho so lon). */
function toRomanNumeral(num: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let n = num;
  let out = '';
  for (const [value, symbol] of table) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out || String(num);
}

/** Bug that da gap ("I. I. Phan mem"): mot so Muc cha (Section) co san du lieu
 * da tu go san so La Ma vao dau ten (vd "I. Phần mềm" go tu Excel/thoi quen
 * cu), trong khi UI moi LUON tu dong ghep them so La Ma tinh theo vi tri
 * (`toRomanNumeral(sectionCounter)`) truoc ten - ghep 2 cai lai thanh lap
 * ("I. I. Phần mềm"). CHI strip dung so La Ma KHOP VOI vi tri hien tai cua
 * chinh no (`expectedRoman`) + dau cham theo sau - KHONG dung regex chung
 * chung moi chuoi bat dau bang chu hoa (se cat nham ten that su bat dau bang
 * chu "I"/"V"/"X"... khong phai so thu tu, vd "Video call"). */
function stripLeadingRomanPrefix(text: string, expectedRoman: string): string {
  const pattern = new RegExp(`^${expectedRoman}\\.\\s*`, 'i');
  return text.replace(pattern, '');
}

function newBlockId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `block_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}


/** Muc cha (Section)/hang muc con - xem migration 104. `itemsDraft` (state
 * edit cua bang hang muc) LUON giu dang PHANG (khong dung cay `children`
 * long nhau) de moi thao tac (them/xoa/nhan ban/doi thu tu/chuyen nhom) chi
 * la 1 phep splice mang don gian, khong phai de quy cay. Cay chi ton tai
 * ngan gon o 2 dau: (1) load() nap `quote.items` (BE tra ve dang cay qua
 * _quote_item_tree) -> lam PHANG ngay de edit; (2) luc gui len BE, gop lai
 * thanh cay dung dinh dang API cu da co san (children long nhau) truoc khi
 * map qua toItemInput(). Section/item lien he nhau qua `parentItemId` (tro
 * toi `id` cua dong section, ke ca id TAM cho section moi tao chua luu). */
function flattenItemTree(items: QuoteItem[]): QuoteItem[] {
  const out: QuoteItem[] = [];
  for (const item of items) {
    const { children, ...rest } = item;
    out.push(rest);
    if (children && children.length) out.push(...flattenItemTree(children));
  }
  return out;
}

function buildItemTree(flat: QuoteItem[]): QuoteItem[] {
  const withChildren = flat.map(item => ({ ...item, children: [] as QuoteItem[] }));
  const byId = new Map<string, QuoteItem & { children: QuoteItem[] }>();
  for (const item of withChildren) {
    if (item.id) byId.set(item.id, item);
  }
  const roots: QuoteItem[] = [];
  for (const item of withChildren) {
    const parent = item.parentItemId ? byId.get(item.parentItemId) : undefined;
    if (parent) parent.children.push(item);
    else roots.push(item);
  }
  return roots;
}

/** Sau MOI lan sap xep lai (keo-tha, di chuyen len/xuong, xoa/them dong) -
 * gan lai `parentItemId` THEO DUNG VI TRI hien tai: 1 hang muc thuoc DUNG
 * Muc cha (Section) gan lien truoc no gan nhat (cho toi khi gap 1 Section
 * khac). Cach lam nay bien "thuoc nhom nao" thanh 1 THUOC TINH SUY RA TU VI
 * TRI, KHONG con phai tu quan ly parentItemId thu cong moi lan di chuyen -
 * tranh ca 1 lop bug "keo xong quen cap nhat nhom" de xay ra neu lam nguoc
 * lai (giu parentItemId co dinh, tu tinh vi tri theo no). */
function recomputeParentIds(items: QuoteItem[]): QuoteItem[] {
  let currentSectionId: string | undefined;
  return items.map(item => {
    if (item.rowType === 'section') {
      currentSectionId = item.id;
      return item;
    }
    return { ...item, parentItemId: currentSectionId };
  });
}

/** BUG THAT DA GAP ("mục tổng chưa cộng các hạng mục con"): cac ham them
 * hang muc THEO VI TRI CUOI MANG (nut "Thêm hạng mục"/"Chọn từ danh mục"
 * duoi bang khi khong chon truoc 1 Muc cha cu the) truoc day LUON append
 * voi parentItemId=undefined, BAT KE dong cuoi cung hien tai co phai la 1
 * Section (hoac 1 hang muc DA thuoc 1 Section) hay khong. Hau qua: tao 1
 * Section moi (rong) roi bam "Thêm hạng mục" de dien hang muc vao NGAY -
 * hang muc moi nam DUNG VI TRI ngay sau Section (nhin nhu da thuoc nhom) tren
 * man hinh, nhung parentItemId that su la undefined != section.id nen bi
 * calculateSectionTotal() (loc theo parentItemId === section.id, xem
 * qc-workspace-section-row ben duoi) coi la KHONG PHAI hang muc con - tong
 * tien/ty trong cua Section do dung o "0 đ"/"0.00%" mai mai, du dien gia bao
 * nhieu cung khong tinh lai (khong phai loi cong thuc calculateSectionTotal,
 * cung khong phai do/lag autosave - day la loi hang muc bi loai hoan toan
 * khoi phep cong tu dau). Ham nay suy ra parentItemId DUNG theo VI TRI cuoi
 * mang hien tai (giong nguyen tac recomputeParentIds() o tren) de hang muc
 * moi luon "thuoc" dung Section ma no nam ngay sau, khop voi nhung gi nguoi
 * dung nhin thay tren man hinh. */
function trailingParentItemId(items: QuoteItem[]): string | undefined {
  const last = items[items.length - 1];
  if (!last) return undefined;
  return last.rowType === 'section' ? last.id : last.parentItemId;
}

/** BUG THAT DA GAP #2 - "bao gia CU (tao truoc khi co fix trailingParentItemId
 * o tren) van hien tong Muc cha = 0đ du code moi da deploy": fix
 * trailingParentItemId() o tren chi sua duong THEM DONG MOI, khong sua lai du
 * lieu CU da luu san trong DB tu truoc - 1 hang muc da luu voi
 * parentItemId=null nhung nam DUNG VI TRI ngay sau 1 Section van giu nguyen
 * parentItemId=null vinh vien moi lan load lai, vi khong co buoc nao doc lai
 * du lieu cu va suy luan lai theo vi tri ca. Ham nay chay 1 LAN moi khi NAP
 * `quote.items` tu server vao `itemsDraft` (xem useEffect [quote?.id] ben
 * duoi) - quet XUOI, hang muc nao dang co parentItemId rong (falsy) thi suy
 * ra parentItemId DUNG bang chinh trailingParentItemId() ap vao PHAN MANG DA
 * XU LY TRUOC DO (out), y het nguyen tac trailingParentItemId dung cho hang
 * muc MOI them - chi khac la ap dung cho hang muc CU ngay luc doc, khong doi
 * nguoi dung phai keo-tha/them dong moi thi moi tu sua. Hang muc nao DA CO
 * san parentItemId (kha nang do 1 lan sua/di chuyen truoc do da ghi dung) thi
 * GIU NGUYEN, khong ghi de - tranh lam sai du lieu that su co gia tri khac 0.
 * Day la suy luan THUAN CLIENT, CHI anh huong itemsDraft trong bo nho (hien
 * thi Section total dung ngay khi mo lai) - KHONG tu dong luu len server;
 * parentItemId suy ra duoc chi thuc su ghi xuong DB vao lan Luu THAT TIEP
 * THEO cua chinh nguoi dung (tu "chua lanh" du lieu cu 1 cach tu nhien, dung
 * dan la item nay VON DI thuoc Section do, chi la lien ket bi thieu tu truoc). */
function normalizeLoadedParentIds(items: QuoteItem[]): QuoteItem[] {
  const out: QuoteItem[] = [];
  for (const item of items) {
    if (item.rowType !== 'section' && !item.parentItemId) {
      const inferredParentId = trailingParentItemId(out);
      out.push(inferredParentId ? { ...item, parentItemId: inferredParentId } : item);
    } else {
      out.push(item);
    }
  }
  return out;
}


/** [start, end) cua 1 "khoi" bat dau tu `index` - neu la 1 hang muc thuong
 * (rowType='item') thi khoi chi co dung 1 dong; neu la Muc cha (Section) thi
 * khoi gom CA dong Section VA toan bo hang muc con lien tiep ngay sau no
 * (toi khi gap Section tiep theo hoac het mang) - dam bao keo 1 Muc cha se
 * mang theo CA nhom cua no, khong bao gio lam roi hang muc con lai phia sau. */
function getRowBlockRange(items: QuoteItem[], index: number): [number, number] {
  if (items[index]?.rowType !== 'section') return [index, index + 1];
  let end = index + 1;
  while (end < items.length && items[end].rowType !== 'section') end += 1;
  return [index, end];
}

/** Nguoc voi getRowBlockRange (do CHI tinh xuoi) - dung khi can biet khoi
 * LIEN KE PHIA TRUOC bat dau tu dau, cho truong hop "di chuyen len": cho
 * truoc chi so cua DONG CUOI khoi do (`endingAtIndex`), tim dung diem bat
 * dau. Neu dong do thuoc 1 Section (co parentItemId), phai quet NGUOC tim
 * dung dong Section chu no - khong the chi lay [index,index+1) nhu 1 hang
 * muc doc lap, vi nhu vay se "cat doi" 1 Section dang co nhieu hang muc con
 * (bug that da tim thay khi tu trace tay truoc khi port). */
function blockStartEndingAt(items: QuoteItem[], endingAtIndex: number): number {
  const row = items[endingAtIndex];
  if (!row || row.rowType === 'section' || !row.parentItemId) return endingAtIndex;
  for (let i = endingAtIndex; i >= 0; i -= 1) {
    if (items[i].rowType === 'section') return i;
  }
  return endingAtIndex;
}

/** Di chuyen 1 khoi (xem getRowBlockRange) tu vi tri `fromIndex` toi ngay
 * TRUOC `targetIndex` (theo chi so cua mang GOC, truoc khi cat khoi ra) - tu
 * dong gan lai parentItemId theo vi tri moi qua recomputeParentIds(), KHONG
 * can code rieng xu ly tung truong hop "keo hang muc vao 1 nhom"/"keo ca 1
 * nhom di noi khac" nua, vi nhom gio la thuoc tinh suy ra tu vi tri. */
function moveRowBlock(items: QuoteItem[], fromIndex: number, targetIndex: number): QuoteItem[] {
  const [start, end] = getRowBlockRange(items, fromIndex);
  if (targetIndex >= start && targetIndex < end) return items; // tha vao chinh no/con cua no - khong doi gi
  const block = items.slice(start, end);
  const rest = [...items.slice(0, start), ...items.slice(end)];
  let insertAt = targetIndex > start ? targetIndex - (end - start) : targetIndex;
  insertAt = Math.max(0, Math.min(insertAt, rest.length));
  return recomputeParentIds([...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]);
}

const VERSION_REASONS = [
  { value: 'scope_change', label: 'Khách thay đổi scope' },
  { value: 'price_change', label: 'Đổi giá/chiết khấu' },
  { value: 'add_items', label: 'Bổ sung hạng mục' },
  { value: 'other', label: 'Khác' },
];

type RecipientSnapshot = { customerRecipient: string; customerPhone: string; customerEmail: string };

/** Card preview gon "Thông tin hiển thị trên báo giá" - thay the 3 o input tho
 * luon hien truoc day (D2). CHI hien READ-ONLY summary + 1 nut "Chỉnh thông
 * tin hiển thị" o goc tren phai; bam moi mo popover nho neo ngay canh nut do
 * voi 3 o nhap that. Luu popover goi thang `onSave` (caller quyet dinh ghi
 * vao state local (che do tao moi) hay persistRecipientField len server
 * (quote da ton tai) - component nay khong biet/khong can biet dang o che do
 * nao, chi lam UI thuan tuy dung yeu cau "snapshot only, khong dong crm_contacts". */
function RecipientInfoCard({
  recipient,
  editable,
  onSave,
}: {
  recipient: RecipientSnapshot;
  editable: boolean;
  onSave: (next: RecipientSnapshot) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RecipientSnapshot>(recipient);

  function openPopover() {
    setDraft(recipient);
    setOpen(true);
  }

  return (
    <div className="qc-workspace-recipient-card">
      <div className="qc-workspace-recipient-card-head">
        <span className="qc-workspace-recipient-card-title">Thông tin hiển thị trên báo giá</span>
        {editable ? (
          <button type="button" className="qc-mini-btn" onClick={() => (open ? setOpen(false) : openPopover())}>
            <Pencil className="qc-icon" /> Chỉnh thông tin hiển thị
          </button>
        ) : null}
      </div>
      <div className="qc-workspace-recipient-preview">
        <div className="qc-workspace-recipient-preview-item">
          <User className="qc-workspace-recipient-preview-icon" />
          <div>
            <span className="qc-workspace-recipient-preview-label">Kính gửi</span>
            <strong>{recipient.customerRecipient || 'Chưa có'}</strong>
          </div>
        </div>
        <div className="qc-workspace-recipient-preview-item">
          <Phone className="qc-workspace-recipient-preview-icon" />
          <div>
            <span className="qc-workspace-recipient-preview-label">SĐT</span>
            <strong>{recipient.customerPhone || 'Chưa có'}</strong>
          </div>
        </div>
        <div className="qc-workspace-recipient-preview-item">
          <Mail className="qc-workspace-recipient-preview-icon" />
          <div>
            <span className="qc-workspace-recipient-preview-label">Email</span>
            <strong>{recipient.customerEmail || 'Chưa có'}</strong>
          </div>
        </div>
      </div>
      {open ? (
        <div className="qc-workspace-recipient-popover">
          <label className="crm-field">
            <span>Kính gửi</span>
            <input
              className="crm-input"
              autoFocus
              value={draft.customerRecipient}
              onChange={event => setDraft(prev => ({ ...prev, customerRecipient: event.target.value }))}
              placeholder="Tên người nhận báo giá"
            />
          </label>
          <label className="crm-field">
            <span>SĐT liên hệ</span>
            <input
              className="crm-input"
              value={draft.customerPhone}
              onChange={event => setDraft(prev => ({ ...prev, customerPhone: event.target.value }))}
            />
          </label>
          <label className="crm-field">
            <span>Email liên hệ</span>
            <input
              className="crm-input"
              value={draft.customerEmail}
              onChange={event => setDraft(prev => ({ ...prev, customerEmail: event.target.value }))}
            />
          </label>
          <div className="qc-workspace-recipient-popover-actions">
            <button type="button" className="qc-btn" onClick={() => setOpen(false)}>Huỷ</button>
            <button
              type="button"
              className="qc-btn qc-btn-primary"
              onClick={() => {
                onSave(draft);
                setOpen(false);
              }}
            >
              Lưu
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function QuoteWorkspaceModal({
  quoteId,
  deals,
  dealsById,
  agents,
  user,
  onClose,
  onChanged,
  onEditDraft,
  defaultFormId,
  quoteForms = [],
  initialCustomerId,
  initialProjectId,
  lockCustomer = false,
  lockProject = false,
}: {
  /** null = che do TAO MOI ("+ Yeu cau ho tro bao gia") - workspace hien day
   * du UI ngay nhung CHUA co record that nao cho toi khi bam Luu nhap/Gui yeu
   * cau xu ly (tranh tao "quote rong" ngay khi mo modal, chi 1 lan bam huy se
   * khong de lai rac trong DB). */
  quoteId: string | null;
  deals: Deal[];
  dealsById: Map<string, Deal>;
  agents: CrmUserOption[];
  user: AppUser | null | undefined;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onEditDraft: (quote: Quote) => void;
  /** Mau bao gia GOI Y mac dinh khi vua mo (uu tien defaultQuoteFormId cua don
   * vi phat hanh, fallback mau isDefaultTemplate - xem QuoteCenterPage) - Sale
   * van doi lai duoc qua dropdown "Mau bao gia" (draftFormId) neu can. */
  defaultFormId?: string;
  /** Danh sach mau bao gia active de hien dropdown "Mau bao gia" o Buoc 1
   * (CHI khi tao moi, quoteId=null) - rong thi an han dropdown, dung nguyen
   * defaultFormId nhu truoc. */
  quoteForms?: QuoteForm[];
  /** Block 1: mo tu nut "Tạo báo giá" o Ho so khach hang/Project card - PHAI
   * THAT SU doc + ap dung (khong chi mang query param roi bo qua). Khach
   * hang/Du an tu dien vao draftCustomerId/draftProjectId ngay khi mo o CHE
   * DO TAO MOI (quoteId=null); lockCustomer/lockProject an dropdown, hien
   * text tinh - CHI ap dung khi quoteId=null. */
  initialCustomerId?: string;
  initialProjectId?: string;
  lockCustomer?: boolean;
  lockProject?: boolean;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(Boolean(quoteId));
  const [activity, setActivity] = useState<QuoteActivityLogEntry[]>([]);
  const [checklist, setChecklist] = useState<QuoteHandoffChecklist | null>(null);
  // Gop Buoc 1+2: cho tick checklist bang giao NGAY tu luc con o Buoc 1 (truoc
  // ca khi quote tu tao xong) - khong duoc de null nua (setChecklistDraft(prev
  // => prev ? {...} : prev) se KHONG lam gi neu prev=null, tick se vo tac
  // dung im lang). Dung 1 object rong lam gia tri khoi tao thay vi null.
  function emptyChecklist(): QuoteHandoffChecklist {
    return {
      quoteId: '',
      scopeConfirmed: false,
      scopeNote: '',
      costConfirmed: false,
      costNote: '',
      timelineConfirmed: false,
      timelineNote: '',
      assumptionConfirmed: false,
      assumptionNote: '',
      handoffNote: '',
    };
  }
  const [checklistDraft, setChecklistDraft] = useState<QuoteHandoffChecklist>(emptyChecklist());
  const [busy, setBusy] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionReason, setVersionReason] = useState(VERSION_REASONS[0].value);
  // Checkpoint D muc 6 - neu chuoi DA CO 1 draft moi hon quote approved dang
  // xem (vd dang xem V2 approved nhung V3 draft da ton tai tu truoc), nut
  // header PHAI ghi "Tiep tuc chinh sua V{n}" va MO THANG draft do, KHONG
  // tao them 1 draft thu 2 (RPC createQuoteVersion() da tu chan viec nay o
  // backend, nhung nut o day phai PHAN ANH DUNG truoc khi bam, khong de
  // nguoi dung bam "Tao phien ban moi" roi bi redirect bat ngo).
  const [existingDraftVersion, setExistingDraftVersion] = useState<Quote | null>(null);
  // Reset scroll ve dau moi lan mo/chuyen quote (bug thuc te da bao: mo quote
  // moi nhung dung giua vung trang cua quote TRUOC do, tao cam giac "man
  // hinh trong" du noi dung THAT su van co o phia tren).
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (workspaceBodyRef.current) workspaceBodyRef.current.scrollTop = 0;
  }, [quote?.id]);
  // Card "Chuẩn bị gửi Presale" (stage 'request') - nut "Bổ sung" nhay THAT
  // toi dung khu vuc con thieu, khong phai link tro suong. Cac field
  // Khach hang/Du an/Co hoi/Presale/Sale/SLA nam trong info-strip CO DINH
  // (ngoai qc-workspace-body cuon duoc) - "nhay" toi cho cac field nay chi
  // can dua body ve dau (info-strip luon hien san, khong bao gio cuon mat).
  function jumpToAnchor(anchor: string) {
    if (anchor === 'top') {
      if (workspaceBodyRef.current) workspaceBodyRef.current.scrollTop = 0;
      return;
    }
    const el = workspaceBodyRef.current?.querySelector(`[data-qc-anchor="${anchor}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Che do tao moi - toan bo state duoi day chi LOCAL (chua ghi DB) cho toi
  // khi tao record that (createRequest). Khach hang (crm_customers, ho so
  // rieng biet) va Co hoi CRM (Deal) la 2 THUC THE THAT KHAC NHAU trong DB
  // (deal.customerId tro toi 1 crm_customers, co the null) - chon rieng tung
  // cai, KHONG suy quan ly/team tu khach hang (chi Deal moi mang assignment/
  // team that). Quote chi luu duoc deal_id (khong co cot customer_id rieng)
  // nen Khach hang o day chi dung de LOC danh sach Co hoi cho de tim, gia tri
  // THAT su duoc ghi la draftDealId.
  const [draftCustomerId, setDraftCustomerId] = useState(initialCustomerId || '');
  const [customers, setCustomers] = useState<QuoteCustomerOption[]>([]);
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false);
  // "Người liên hệ" (redesign Buoc 1) - danh sach Contact THAT cua DUNG
  // draftCustomerId dang chon, CHI tai/hien khi con o che do tao moi (!quote -
  // quote da ton tai giu nguyen snapshot cu, khong doi Contact nua). Dung lai
  // dung API (seedingCrmRepository.listContacts) + 3 quy tac auto-chon
  // (chinh -> tu chon; dung 1 -> tu chon; nhieu khong ai chinh -> de trong;
  // 0 -> de trong) GIONG HET SelectCustomerStep.tsx (luong tao bao gia tu
  // Deal), khong bia lai logic rieng.
  const [draftContactId, setDraftContactId] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactsLoadedFor, setContactsLoadedFor] = useState('');
  const [contactsLoading, setContactsLoading] = useState(false);
  // Tai danh sach Contact cua 1 customerId + ap dung dung 3 quy tac auto-chon
  // (chinh -> tu chon; dung 1 -> tu chon; nhieu/0 -> de trong) - tach thanh
  // ham rieng (thay vi chi nam trong useEffect) de DUNG LAI DUOC sau khi tao
  // Contact moi tai cho (xem submitCreateContact ben duoi), khong copy logic
  // 2 lan. `preferContactId` (tuy chon) = ep chon dung ID nay thay vi tu suy
  // theo quy tac (vd Contact VUA tao xong, du no khong phai contact chinh/
  // khong phai contact duy nhat).
  async function refreshContacts(customerId: string, preferContactId?: string) {
    setContactsLoading(true);
    try {
      const list = await seedingCrmRepository.listContacts(customerId);
      setContacts(list);
      setContactsLoadedFor(customerId);
      const preferred = preferContactId ? list.find(c => c.id === preferContactId) : undefined;
      const primary = list.find(c => c.is_primary);
      const autoSelected = preferred || primary || (list.length === 1 ? list[0] : null);
      setDraftContactId(autoSelected?.id || '');
      // Kinh gui/SDT/Email preview PHAI dong bo NGAY theo Contact vua tu
      // chon (hoac de trong neu khong Contact nao) - KHONG fallback ve ten
      // Khach hang/cong ty (dung yeu cau D, xem SelectCustomerStep.tsx).
      setDraftRecipientFields({
        customerRecipient: autoSelected?.name || '',
        customerPhone: autoSelected?.phone || '',
        customerEmail: autoSelected?.email || '',
      });
      return list;
    } catch {
      setContacts([]);
      setContactsLoadedFor(customerId);
      return [];
    } finally {
      setContactsLoading(false);
    }
  }
  useEffect(() => {
    if (quote) return; // Quote da ton tai - giu nguyen snapshot Contact cu, khong tai lai/doi.
    if (!draftCustomerId) {
      setContacts([]);
      setContactsLoadedFor('');
      setDraftContactId('');
      return;
    }
    let alive = true;
    void refreshContacts(draftCustomerId).then(() => {
      if (!alive) return;
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftCustomerId, quote]);
  function selectDraftContact(contactId: string) {
    const found = contacts.find(c => c.id === contactId);
    setDraftContactId(contactId);
    if (contactId) clearRequiredError('contact');
    setDraftRecipientFields({
      customerRecipient: found?.name || '',
      customerPhone: found?.phone || '',
      customerEmail: found?.email || '',
    });
  }
  // "+ Tạo người liên hệ mới" ngay trong dropdown Người liên hệ - GIONG HET
  // pattern "+ Tạo khách hàng mới" cua dropdown Khach hang o tren (yeu cau
  // rieng "cho tạo người liên hệ tại chỗ tương tự mấy dropdown kia") - CHI
  // POST thang API contact CRM co san (/crm/customers/{id}/contacts, dung
  // API voi CrmContactsPanel.tsx tren trang 360 khach hang), KHONG tao rieng
  // 1 modal CRUD Contact day du (form nay CHI can du de tao nhanh 1 Contact
  // moi roi tu chon lai, khong phai thay the trang quan ly Contact).
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [createContactBusy, setCreateContactBusy] = useState(false);
  const [createContactError, setCreateContactError] = useState('');
  const [createContactName, setCreateContactName] = useState('');
  const [createContactPhone, setCreateContactPhone] = useState('');
  const [createContactEmail, setCreateContactEmail] = useState('');
  function openCreateContact() {
    setCreateContactName('');
    setCreateContactPhone('');
    setCreateContactEmail('');
    setCreateContactError('');
    setCreateContactOpen(true);
  }
  async function submitCreateContact() {
    if (!draftCustomerId) return;
    if (!createContactName.trim()) {
      setCreateContactError('Vui lòng nhập họ tên.');
      return;
    }
    setCreateContactBusy(true);
    setCreateContactError('');
    try {
      const headersInit: Record<string, string> = { 'Content-Type': 'application/json' };
      if (API_KEY) headersInit['X-API-Key'] = API_KEY;
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(draftCustomerId)}/contacts`, {
        method: 'POST',
        credentials: 'include',
        headers: headersInit,
        body: JSON.stringify({
          name: createContactName.trim(),
          phone: createContactPhone.trim() || null,
          email: createContactEmail.trim() || null,
          is_primary: false,
        }),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || 'Không tạo được người liên hệ.');
      const createdId = body.data?.id as string | undefined;
      await refreshContacts(draftCustomerId, createdId);
      if (createdId) clearRequiredError('contact');
      setCreateContactOpen(false);
    } catch (err) {
      setCreateContactError(err instanceof Error ? err.message : 'Không tạo được người liên hệ.');
    } finally {
      setCreateContactBusy(false);
    }
  }
  // "Đơn vị phát hành" (redesign Buoc 1) - override tuy chon TREN NEN gia tri
  // mac dinh suy tu mau bao gia dang chon (draftCatalogIssuerCompanyId, dinh
  // nghia o duoi) - '' = chua override, dung nguyen mac dinh cua mau.
  const [issuerCompanies, setIssuerCompanies] = useState<IssuerCompany[]>([]);
  const [draftIssuerCompanyIdOverride, setDraftIssuerCompanyIdOverride] = useState('');
  useEffect(() => {
    void seedingQuoteRepository.getIssuerCompanies().then(setIssuerCompanies).catch(() => setIssuerCompanies([]));
  }, []);
  const [draftDealId, setDraftDealId] = useState('');
  // "+ Tạo cơ hội mới" ngay trong dropdown - BUG THAT DA GAP (gap that su,
  // khong phai gia dinh): khach hang chua co Cơ hội nao thi dropdown chi
  // hien "Không tìm thấy", bat nguoi dung THOAT KHOI form dang dien de di
  // tao Co hoi o cho khac roi quay lai tu dau - mat het du lieu dang go
  // (Hạng mục/scope...). `deals`/`dealsById` la PROP tu component cha
  // (QuoteCenterPage/CrmCustomerDetailPage), khong the goi API cha refetch
  // tu day - luu Co hoi vua tao THEM vao 1 state local, GOP voi prop that
  // moi noi can doc (xem effectiveDeals/effectiveDealsById ben duoi) de hien
  // ngay khong can cho cha tai lai.
  const [locallyCreatedDeals, setLocallyCreatedDeals] = useState<Deal[]>([]);
  const effectiveDeals = useMemo(
    () => (locallyCreatedDeals.length ? [...deals, ...locallyCreatedDeals] : deals),
    [deals, locallyCreatedDeals]
  );
  const effectiveDealsById = useMemo(() => {
    if (!locallyCreatedDeals.length) return dealsById;
    const map = new Map(dealsById);
    locallyCreatedDeals.forEach(d => map.set(d.id, d));
    return map;
  }, [dealsById, locallyCreatedDeals]);
  const CREATE_NEW_DEAL_OPTION = '__create_new_deal__';
  const CREATE_NEW_PROJECT_OPTION = '__create_new_project__';
  // "Tạo dự án mới"/"Tạo cơ hội mới" nhanh ngay trong workspace - tái dùng
  // dung 2 component chuan hoa da co cho toan he thong (ProjectFormModal,
  // DealFormModal) thay vi 1 form rieng tu viet - vua dam bao du field
  // (nguoi phu trach, gia tri du kien, next step...) vua khong tao code
  // trung lap. `agents` chi can fetch 1 lan cho ca 2 modal nay dung chung.
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [dealModalOpen, setDealModalOpen] = useState(false);
  const [dealCreateBusy, setDealCreateBusy] = useState(false);
  const [dealCreateError, setDealCreateError] = useState('');
  const [quickCreateAgents, setQuickCreateAgents] = useState<CrmUserOption[]>([]);
  useEffect(() => {
    void seedingCrmRepository.getAgents().then(setQuickCreateAgents).catch(() => setQuickCreateAgents([]));
  }, []);

  async function handleCreateQuickDeal(input: CreateDealInput) {
    setDealCreateBusy(true);
    setDealCreateError('');
    try {
      const created = await seedingCrmRepository.createDeal(input);
      clearDealDraft();
      setLocallyCreatedDeals(prev => [...prev, created]);
      setDraftDealId(created.id);
      if (created.projectId) setDraftProjectId(created.projectId);
      setDealModalOpen(false);
    } catch (err) {
      setDealCreateError(err instanceof Error ? err.message : 'Không tạo được cơ hội.');
    } finally {
      setDealCreateBusy(false);
    }
  }
  // "Mau bao gia" - Sale duoc doi lai mau goi y mac dinh (defaultFormId) qua
  // dropdown rieng, CHI o che do tao moi (quoteId=null). '' = chua co goi y
  // nao (dang cho fetch defaultFormId) - fallback ve defaultFormId luc gui.
  const [draftFormId, setDraftFormId] = useState('');
  useEffect(() => {
    if (defaultFormId) setDraftFormId(prev => prev || defaultFormId);
  }, [defaultFormId]);
  // Du an that (migration 097) - lay theo dung khach hang (draftCustomerId),
  // KHONG theo Co hoi (1 Du an co nhieu Co hoi). "" = "Chua thuoc du an".
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [draftProjectId, setDraftProjectId] = useState(initialProjectId || '');
  // SLA / han hoan tat noi bo that (migration 097) - datetime-local string,
  // KHAC HOAN TOAN validUntil (hieu luc bao gia voi khach hang).
  const [draftSlaDueAt, setDraftSlaDueAt] = useState('');
  // "Loai bao gia" (migration 112) - phai chon duoc TU BUOC 1 (truoc khi
  // quote that ton tai), mirror dung pattern draftSlaDueAt/draftProjectId.
  const [draftQuoteTypeCodes, setDraftQuoteTypeCodes] = useState<string[]>([]);
  const [quoteTypeOptions, setQuoteTypeOptions] = useState<{ value: string; label: string }[]>([]);
  const [quoteTypeDropdownOpen, setQuoteTypeDropdownOpen] = useState(false);
  const [quoteTypeSearch, setQuoteTypeSearch] = useState('');
  const [quoteTypeQuickAddOpen, setQuoteTypeQuickAddOpen] = useState(false);
  const [quoteTypeManageOpen, setQuoteTypeManageOpen] = useState(false);
  async function reloadQuoteTypeOptions(forceRefresh = false) {
    const res = await allPlatformCategoriesService.getAll('crm_quote_type', { activeOnly: true, forceRefresh });
    const next = (res.data || []).map(c => ({ value: c.code, label: c.name || c.code }));
    setQuoteTypeOptions(next);
    return next;
  }
  useEffect(() => {
    let alive = true;
    reloadQuoteTypeOptions()
      .then(options => {
        if (alive) setQuoteTypeOptions(options);
      })
      .catch(() => {
        if (alive) setQuoteTypeOptions([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  // BUG THAT DA GAP ("bấm nó k hiện tick luôn"): truoc day checkbox controlled
  // THANG theo quote.quoteTypeCodes (du lieu server) - luu lai la 1 request
  // async, nen ngay khi bam, React render lai TRUOC khi request kip xong, ep
  // checkbox ve lai trang thai cu (server chua doi), nhin nhu bam khong an
  // thua gi ca. Fix: dong bo draftQuoteTypeCodes tu quote MOI LOAD/DOI (effect
  // duoi day), roi luon doc/ghi qua state LOCAL nay (optimistic) - luu xuong
  // server chay NGAM phia sau, khong con cho round-trip moi thay doi UI.
  useEffect(() => {
    setDraftQuoteTypeCodes(quote?.quoteTypeCodes || []);
  }, [quote?.id]);
  const currentQuoteTypeCodes = draftQuoteTypeCodes;
  function toggleQuoteTypeCode(code: string) {
    const set = new Set(currentQuoteTypeCodes);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    const next = [...set];
    setDraftQuoteTypeCodes(next);
    if (quote) void persistQuote({ quoteTypeCodes: next }, { silent: true });
  }
  function quoteTypeLabel(code: string): string {
    return quoteTypeOptions.find(o => o.value === code)?.label || code;
  }
  // (D2) Sua truc tiep 3 truong snapshot "Kính gửi"/"SĐT liên hệ"/"Email liên
  // hệ" (quote.data.customerRecipient/customerPhone/customerEmail) ngay trong
  // Workspace, khi bao gia con o trang thai sua duoc (draft, chua khoa
  // review) - CHI sua field snapshot trong `data` (JSON tai-thoi-diem cua
  // CHINH bao gia nay), KHONG dong den crm_contacts master. Dong bo lai tu
  // `quote` moi lan doi phien ban/tai lai (xem effect ben duoi), tranh giu
  // gia tri cu cua 1 bao gia/version khac.
  const [draftRecipientFields, setDraftRecipientFields] = useState({ customerRecipient: '', customerPhone: '', customerEmail: '' });
  useEffect(() => {
    setDraftRecipientFields({
      customerRecipient: typeof quote?.data?.customerRecipient === 'string' ? quote.data.customerRecipient : '',
      customerPhone: typeof quote?.data?.customerPhone === 'string' ? quote.data.customerPhone : '',
      customerEmail: typeof quote?.data?.customerEmail === 'string' ? quote.data.customerEmail : '',
    });
  }, [quote?.id, quote?.versionNumber]);
  function persistRecipientField(key: 'customerRecipient' | 'customerPhone' | 'customerEmail', value: string) {
    if (!quote) return;
    if ((quote.data?.[key] as string | undefined) === value) return;
    // BUG THAT DA GAP ("đổi rồi mà Bản xem trước/PDF không đổi"): persistQuote()
    // co dong `if (opts?.silent) return;` (them tu commit "stabilize pricing
    // draft behavior" 2026-09-20, CO Y bien MOI cuoc goi silent:true thanh
    // no-op de tranh autosave tung phim go Markup/Gia von gay race condition) -
    // ham nay bi goi voi silent:true nen KHONG BAO GIO thuc su luu len server,
    // chi cap nhat UI cuc bo (draftRecipientFields) roi dung im, khien
    // quote.data (nguon du lieu THAT cua Preview/Public/PDF/Detail) khong bao
    // gio doi. Nut "Lưu" trong popover la HANH DONG TUONG MINH cua nguoi dung
    // (khong phai autosave go phim), nen goi persistQuote KHONG silent o day
    // la dung/an toan - luu that su, cap nhat quote.data ngay.
    void persistQuote({ data: { ...quote.data, [key]: value, customerContactName: key === 'customerRecipient' ? value : quote.data?.customerContactName } });
  }
  const [draftTitle, setDraftTitle] = useState('');
  const [draftScope, setDraftScope] = useState('');
  const [draftCustomBlocks, setDraftCustomBlocks] = useState<CustomBlock[]>([]);
  const [draftPaymentPlan, setDraftPaymentPlan] = useState<PaymentPlanRow[]>([]);
  const [draftSummary, setDraftSummary] = useState('');
  const [draftExpectedProducts, setDraftExpectedProducts] = useState('');
  const [draftInternalNote, setDraftInternalNote] = useState('');
  const [autofillMessage, setAutofillMessage] = useState('');
  const [draftTechnicalOwnerId, setDraftTechnicalOwnerId] = useState('');
  const [draftQuoteOwnerId, setDraftQuoteOwnerId] = useState('');
  const [draftVisibleColumns, setDraftVisibleColumns] = useState<string[] | undefined>(undefined);
  const [draftVisibleSummaryFields, setDraftVisibleSummaryFields] = useState<string[] | undefined>(undefined);
  const [draftVisibleCustomerFields, setDraftVisibleCustomerFields] = useState<string[] | undefined>(undefined);
  // BUG THAT DA GAP ("go Chiet khau tong khi chua co quote thi khong co tac
  // dung gi ca"): o quickbar (~4448), onChange goc chi goi
  // setQuote(prev => prev ? {...} : prev) - khi CHUA co `quote` (dang tao moi,
  // chua luu lan nao) day la no-op tuyet doi, gia tri go vao KHONG phan anh
  // duoc vao dau (ke ca popup preview) cho toi khi quote duoc tao. Them state
  // rieng mirror dung pattern `draftPaymentTermsDays` da co san trong file nay.
  const [draftOverallDiscountPercent, setDraftOverallDiscountPercent] = useState<number | null | undefined>(undefined);
  const [requiredFieldErrors, setRequiredFieldErrors] = useState<Record<string, string>>({});

  function focusFirstRequiredError(errors: Record<string, string>) {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    window.requestAnimationFrame(() => {
      const root = workspaceBodyRef.current?.closest('.qc-workspace') || document;
      const field = root.querySelector<HTMLElement>(`[data-qc-required="${firstKey}"]`);
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field?.querySelector<HTMLElement>('input, button, select, textarea')?.focus();
    });
  }

  function clearRequiredError(key: string) {
    setRequiredFieldErrors(current => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validateRequiredWorkspaceFields(existingQuote?: Quote | null) {
    const errors: Record<string, string> = {};
    const selectedDealId = existingQuote?.dealId || draftDealId;
    const customerId = existingQuote ? effectiveDealsById.get(selectedDealId || '')?.customerId : draftCustomerId;
    const formId = existingQuote?.quoteFormId || draftFormId || defaultFormId;
    const technicalOwnerId = existingQuote?.technicalOwnerId || draftTechnicalOwnerId;
    const quoteOwnerId = existingQuote?.quoteOwnerId || draftQuoteOwnerId;
    const slaDueAt = existingQuote?.slaDueAt || datetimeLocalValueToIso(draftSlaDueAt);
    if (!customerId) errors.customer = 'Vui lòng chọn khách hàng.';
    // "Người liên hệ"/"Đơn vị phát hành"/"Hạng mục & cấu trúc giá" la phan
    // thuong mai cua Sale (feedback 2026-09-25 "presale bỏ luôn chỗ người
    // liên hệ, này phase của sale... hạng mục & cấu trúc giá cho nằm bên sale
    // luôn") - KHONG con bat buoc o Buoc 1 (beyondStep1=false, Presale tao
    // yeu cau/Bàn giao) nua, ke ca luc tao moi. Field/UI tuong ung cung da AN
    // khoi Buoc 1 (xem beyondStep1 o Nguoi lien he/Don vi phat hanh, o day
    // CHI can dong bo lai validate cho KHOP - truoc day van bat buoc luc tao
    // (!existingQuote) du field da bi an, khien Presale KHONG THE Luu/Bàn
    // giao duoc (bug that da gap, "ở bước 1 đang không lưu, bàn giao cũng
    // không được"). Tu Buoc 2 (beyondStep1) Sale se tu dien 3 muc nay qua UI
    // rieng cua ho, khong con validate cung o day (mirror dung nguyen tac cu
    // "bao gia cu co the chua tung co Contact/Issuer" - gio ap dung ca cho
    // luong tao moi).
    if (!selectedDealId) errors.deal = beyondStep1 ? 'Vui lòng chọn cơ hội CRM.' : 'Vui lòng chọn dự án.';
    if (!formId) errors.form = 'Vui lòng chọn mẫu báo giá.';
    if (!technicalOwnerId) errors.presale = 'Vui lòng chọn Presale.';
    if (!quoteOwnerId) errors.sale = 'Vui lòng chọn Sale.';
    if (!slaDueAt || new Date(slaDueAt).getTime() <= Date.now()) errors.sla = 'Vui lòng chọn hạn hoàn tất trong tương lai.';
    setRequiredFieldErrors(errors);
    focusFirstRequiredError(errors);
    return Object.keys(errors).length === 0;
  }
  // Che do tao moi (chua co quote.id that) - dieu khoan thanh toan/CK tong
  // van phai nhap duoc NGAY, luu tam local roi gop vao data.customBlocks
  // that luc tao quote (createRequest) - KHONG doi thanh 1 luong luu rieng
  // thu 2.
  const [draftPaymentTermsDays, setDraftPaymentTermsDays] = useState('30');
  const [draftExtraTerms, setDraftExtraTerms] = useState<{ id: string; title: string; content: string }[]>([]);
  const [recentDealQuote, setRecentDealQuote] = useState<Quote | null>(null);
  // "Chon tu danh muc" - lay THANG tu CRM -> San pham & dich vu (dung
  // serviceCatalogRepository.list(), CHINH LA repository ma man "Mau bao
  // gia" (QuoteFormBuilderPage) dang dung) - KHONG con phu thuoc
  // quote_form_catalog_links, khong con bao "mau chua lien ket danh muc".
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogTree, setCatalogTree] = useState<ServiceCatalogItem[] | null>(null);
  // quote?.id (hoac null luc dang tao moi) tai THOI DIEM fetch catalogTree
  // gan nhat - dung de biet co can fetch LAI hay khong khi quote chuyen tu
  // "chua co" sang "da luu that" (xem openCatalogPicker()).
  const [catalogTreeQuoteId, setCatalogTreeQuoteId] = useState<string | null>(null);
  // "Tạo nhanh sản phẩm/nhóm sản phẩm ngay trong popup chọn từ danh mục" +
  // "Nhận biết hạng mục đã có trong Sản phẩm & dịch vụ" (2 yeu cau dung
  // CHUNG QuickAddProductModal - xem file rieng). `quickAddProductTarget`
  // phan biet 2 luong gọi: 'newRow' (nut "+ Sản phẩm mới" trong popup Chọn
  // tu danh muc - san pham tao xong THEM THANH 1 DONG MOI trong bao gia) vs
  // { linkIndex } (bam dau "+" canh 1 hang muc da co san trong bao gia -
  // san pham tao xong CHI GAN ID nguoc lai dong do, KHONG tao dong moi).
  const [quickAddProductTarget, setQuickAddProductTarget] = useState<'newRow' | { linkIndex: number; locked?: boolean } | null>(null);
  // BUG THAT DA GAP ("tự động thêm thẳng vào báo giá ngay sau khi lưu sản
  // phẩm"): luong 'newRow' TRUOC DAY tu goi catalogAdd.handleAddSelected()
  // ngay sau khi tao xong - sai vi Sale co the tao nham hoac muon tao nhieu
  // san pham TRUOC KHI ap dung. Dung luong: chi luu id vua tao vao day, Picker
  // (van dang mo) se TU TICH CHON no (xem prop autoSelectId cua
  // CatalogPickerModal) - Sale tu kiem tra roi bam "+ Thêm vào báo giá" nhu
  // binh thuong, KHONG con dong nao tu dong them dong vao bao gia nua.
  const [autoSelectCatalogItemId, setAutoSelectCatalogItemId] = useState<string | null>(null);
  const [catalogHydratingItem, setCatalogHydratingItem] = useState<ServiceCatalogItem | null>(null);
  const [catalogHydrationRetryItem, setCatalogHydrationRetryItem] = useState<ServiceCatalogItem | null>(null);
  const [catalogHydrationError, setCatalogHydrationError] = useState<string | null>(null);
  const [quickAddGroupOpen, setQuickAddGroupOpen] = useState(false);
  const [pickerGroupFilter, setPickerGroupFilter] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTargetSectionId, setCatalogTargetSectionId] = useState('');
  // "+" rieng tren TUNG dong hang muc (yeu cau rieng "thao tác thêm hạng
  // mục") - chen NGAY SAU dung dong do (khac voi catalogTargetSectionId chi
  // dam bao "cuoi 1 Muc cha"). Uu tien HON catalogTargetSectionId trong
  // addItemsFromCatalog() khi ca 2 cung duoc set - xem ham do.
  const [catalogInsertAfterIndex, setCatalogInsertAfterIndex] = useState<number | null>(null);
  // "Batch" cac hang muc vua chon nhieu tu Danh muc cung 1 luc (yeu cau rieng
  // "đánh dấu là một batch và giữ trạng thái được chọn... nhập Giá vốn ở
  // dòng đầu tiên -> auto fill cùng Giá vốn cho cả batch") - chi la trang
  // thai CUC BO o Workspace (khong luu DB, khong can ton tai qua lan tai
  // lai), reset moi khi them 1 batch MOI (thay the batch cu, khong cong don).
  const [costBatchIds, setCostBatchIds] = useState<string[]>([]);
  const [zoneAdding, setZoneAdding] = useState(false);
  // Bang gia VPS Zone (migration 106) - nguon THU 2 song song voi danh muc
  // noi bo hien co, KHONG doi luong cu. `catalogSource` chi anh huong modal
  // "Chon tu danh muc" dang mo - chua co du lieu Zone (issuer khac SecurityZone)
  // thi list rong, khong loi.
  const [catalogSource, setCatalogSource] = useState<'internal' | 'zone'>('internal');
  const [priceBookItems, setPriceBookItems] = useState<PriceBookItem[] | null>(null);
  const [priceBookLoading, setPriceBookLoading] = useState(false);
  // "Chi tiet gia" drawer - chi mo cho dong co priceBookItemId (Zone), doc
  // TU priceBookSnapshot da dong cung tren chinh dong do, KHONG goi lai API
  // price book goc (dung nguyen tac an bien cua snapshot).
  const [priceBookDrawerIndex, setPriceBookDrawerIndex] = useState<number | null>(null);
  // Drawer "Chi tiet hang muc" CHUNG (yeu cau chung, khong rieng nguon nao) -
  // mo cho MOI dong hang muc (nhap tay/catalog/Zone), khac priceBookDrawerIndex
  // o tren (CHI danh cho dong Zone, hien cong thuc gia). Dung khi ten hang muc
  // bi cat ngan trong bang (nhieu cot), xem toan bo + sua field co quyen.
  const [itemDetailDrawerIndex, setItemDetailDrawerIndex] = useState<number | null>(null);
  // Snapshot dong tai THOI DIEM mo drawer - dung de HUY sua doi neu nguoi
  // dung dong (X/"Đóng") ma KHONG bam "Lưu" (bug that da gap: sua nham gia
  // tri roi bam X, blur cua input tu dong fire TRUOC khi modal dong, khien
  // persistQuote() im lang chay va luu nham gia tri sai - gio inputs trong
  // drawer nay KHONG con tu luu qua onBlur nua, chi luu that khi bam "Lưu"
  // ro rang; dong khong luu se phuc hoi lai dung snapshot nay).
  const [itemDetailDrawerSnapshot, setItemDetailDrawerSnapshot] = useState<QuoteItem | null>(null);
  const [costOverrideModal, setCostOverrideModal] = useState<{ index: number; reason: string; value: number | null } | null>(null);
  // "Chỉnh Phạm vi bảo hành & Ghi chú/Khuyến mãi" (popover rieng, KHONG them
  // cot vao bang) - luu vao DUNG field quote_item.warrantyScope + quote_item.note
  // da co san (note dung cho "Mẫu ưu đãi combo (Markee)", xem quoteConfig.ts).
  // readOnly khi quote da khoa/khong con quyen sua (Buoc 3/da duyet) - van xem
  // duoc, chi khong sua. "Nội dung công việc" (quote_item.description) TRUOC
  // DAY cung sua o day - da chuyen ra textarea sua truc tiep ngay duoi ten
  // hang muc trong bang (yeu cau ro rang "chỉnh được ở đây luôn, không cần
  // bấm vào chỉnh nữa"), popover nay gio giu "Phạm vi bảo hành" + "Ghi chú/
  // Khuyến mãi".
  const [descriptionPopoverIndex, setDescriptionPopoverIndex] = useState<number | null>(null);
  const [warrantyDraftText, setWarrantyDraftText] = useState('');
  const [noteDraftText, setNoteDraftText] = useState('');
  function openDescriptionPopover(index: number) {
    setDescriptionPopoverIndex(index);
    setWarrantyDraftText(itemsDraft[index]?.warrantyScope || '');
    setNoteDraftText(itemsDraft[index]?.note || '');
  }
  function saveDescriptionPopover() {
    if (descriptionPopoverIndex == null) return;
    const idx = descriptionPopoverIndex;
    // BUG THAT DA GAP (tranh lap lai o day): setItemsDraft la async, goi
    // persistQuote({}, ...) NGAY SAU trong cung 1 ham se doc lai itemsDraft
    // CU (closure cua lan render nay, chua kip cap nhat) - dung DUNG pattern
    // da co san o applyFillDown/doApplyQuickMarkup: tinh mang MOI truoc, set
    // state VA truyen thang mang do vao persistQuote({ items: next }) thay
    // vi de no tu doc itemsDraft.
    const next = itemsDraft.map((row, i) => (i === idx ? { ...row, warrantyScope: warrantyDraftText.trim() || null, note: noteDraftText.trim() || null } : row));
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
    setDescriptionPopoverIndex(null);
  }
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  // "chỉnh xoay ngang, xoay dọc, căn chỉnh cột ở đây luôn" - toolbar Dọc/Ngang
  // + kéo độ rộng cột nằm NGAY TRONG popup "Bản xem trước cho khách hàng"
  // (khong con phai bam THEM 1 nut "Xem trước khi in" de mo 1 lop modal khac
  // nua - da bo QuotePrintPreviewModal, dieu khien TRUC TIEP renderer duy
  // nhat cua popup nay qua printPreviewMode/printOrientation, dung y het
  // PublicQuotePage.tsx/QuoteDetailPage.tsx).
  const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [printResetKey, setPrintResetKey] = useState(0);
  // Nut "Lưu" trong popup (y het toolbar in o QuoteDetailPage/PDF chinh
  // thuc): do rong cot keo tay moi nhat tu QuoteDocumentRenderer. Quote da
  // ton tai -> QuotePrintLayoutSaveButton goi thang /print-layout-prefs; CHUA
  // tao (Buoc 1 tao moi) -> giu o draftPrintLayoutPrefs, gui kem
  // data.printLayoutPrefs luc createRequest().
  const [printColumnWidths, setPrintColumnWidths] = useState<Record<string, number> | null>(null);
  const [draftPrintLayoutPrefs, setDraftPrintLayoutPrefs] = useState<{ orientation: 'portrait' | 'landscape'; columnWidths: Record<string, number> } | null>(null);
  useEffect(() => {
    const prefs = quote?.data?.printLayoutPrefs;
    setPrintOrientation(prefs?.orientation || 'portrait');
    setPrintColumnWidths(prefs?.columnWidths && Object.keys(prefs.columnWidths).length ? prefs.columnWidths : null);
    setPrintResetKey(key => key + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  // Section 5 - Admin duyet ngoai le theo version: modal RIENG, chi mo khi
  // backend tra "quote_requires_exception_reason" (Rule Engine gan nhat
  // result != 'pass'). evaluation = snapshot ket qua rule de hien ro dang
  // chan vi ly do gi (khong bat nguoi dung tu doan).
  const [exceptionApprovalModal, setExceptionApprovalModal] = useState<{
    open: boolean;
    reason: string;
    evaluation: { result?: string; details?: unknown } | null;
  }>({ open: false, reason: '', evaluation: null });
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [requestChangesModalOpen, setRequestChangesModalOpen] = useState(false);
  const [requestChangesSection, setRequestChangesSection] = useState<'technical' | 'pricing'>('pricing');
  const [requestChangesReason, setRequestChangesReason] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientSource, setSendRecipientSource] = useState<string | null>(null);
  const [sendSubject, setSendSubject] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendAttachPdf, setSendAttachPdf] = useState(false);
  const [sendAvailability, setSendAvailability] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState('');
  // "Xem lich su gui" (Checkpoint D, phase Da phat hanh/Da gui) - repository
  // + backend da co san (get_quote_delivery_log/getQuoteDeliveryLog) nhung
  // CHUA co UI nao dung toi - bo sung modal + nut footer that.
  const [deliveryLogModal, setDeliveryLogModal] = useState<{ open: boolean; loading: boolean; entries: QuoteDeliveryLogEntry[]; error: string | null }>({
    open: false, loading: false, entries: [], error: null,
  });

  // ── Rule engine duyet bao gia (migration 091) - CHI CON HIEN THI o day (xem
  // card "Quy tắc phê duyệt" ben duoi); sua that chuyen sang trang rieng
  // "Cài đặt báo giá" (components/all-platform/admin/QuoteApprovalRuleSettings.tsx,
  // menu Quan ly CRM) - khong con modal sua ngay trong workspace nay nua. ──
  const [ruleSet, setRuleSet] = useState<QuoteApprovalRuleSet | null>(null);
  const [ruleSetLoaded, setRuleSetLoaded] = useState(false);
  const [ruleEvaluation, setRuleEvaluation] = useState<QuoteRuleEvaluation | null>(null);

  // ── Owner-picker Presale/Sale (migration 095) - THAY the "agents" cu (chi
  // admin/leader, dung cho gan SDR/quan ly Deal CRM, KHONG dung cho owner
  // bao gia) bang 2 danh sach rieng loc theo quote_business_role that. ────
  const [presaleUsers, setPresaleUsers] = useState<QuoteBusinessRoleUser[] | null>(null);
  const [saleUsers, setSaleUsers] = useState<QuoteBusinessRoleUser[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    usersService.getUsersByQuoteBusinessRole('presale').then(res => {
      if (!cancelled) setPresaleUsers(res.success ? (res.data || []) : []);
    }).catch(() => { if (!cancelled) setPresaleUsers([]); });
    usersService.getUsersByQuoteBusinessRole('sale').then(res => {
      if (!cancelled) setSaleUsers(res.success ? (res.data || []) : []);
    }).catch(() => { if (!cancelled) setSaleUsers([]); });
    return () => { cancelled = true; };
  }, []);

  // Nguoi tao la Sale/Both -> mac dinh gan CHINH HO lam quote_owner_id o
  // create-mode (dung yeu cau "Neu nguoi tao la Sale/Both va co quyen, co
  // the mac dinh gan chinh nguoi tao") - CHI khi chua co quote that va chua
  // tu chon ai khac, van cho phep chon lai binh thuong.
  useEffect(() => {
    if (quote || draftQuoteOwnerId || !saleUsers || !user?.id) return;
    if (saleUsers.some(u => u.id === user.id)) {
      setDraftQuoteOwnerId(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleUsers, user?.id, quote]);

  // Tuong tu Sale o tren - nguoi tao la Presale/Both -> mac dinh gan CHINH
  // HO lam technical_owner_id (Presale) o create-mode, khong bat tu chon lai
  // tu dau (bug/thieu sot that da gap: chi Sale duoc tu gan, Presale luon
  // "Chua gan" du nguoi dang login chinh la Presale).
  useEffect(() => {
    if (quote || draftTechnicalOwnerId || !presaleUsers || !user?.id) return;
    if (presaleUsers.some(u => u.id === user.id)) {
      setDraftTechnicalOwnerId(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presaleUsers, user?.id, quote]);

  // Card "Phan cong & SLA" (CHI o day thoi, khong dung o bat ky owner-picker
  // nao khac trong file nay) - gop chung Presale+Sale thanh 1 danh sach duy
  // nhat, hien CA 2 dropdown Presale va Sale deu thay het nhung ai co
  // quote_business_role la presale/sale/both - thay vi loc rieng tung ben
  // nhu truoc (presaleUsers chi Presale/Both, saleUsers chi Sale/Both).
  const businessRoleUsers = useMemo(() => {
    const map = new Map<string, QuoteBusinessRoleUser>();
    for (const u of presaleUsers || []) map.set(u.id, u);
    for (const u of saleUsers || []) map.set(u.id, u);
    return Array.from(map.values());
  }, [presaleUsers, saleUsers]);

  function businessRoleLabel(role?: string | null): string {
    if (role === 'presale') return 'Presale';
    if (role === 'sale') return 'Sale';
    if (role === 'both') return 'Presale & Sale';
    return '';
  }
  function systemRoleLabel(role?: string): string {
    if (role === 'admin') return 'Admin';
    if (role === 'leader') return 'Leader';
    return 'Member';
  }
  function ownerOptionLabel(u: QuoteBusinessRoleUser): string {
    const parts = [repairUtf8Mojibake(u.name), systemRoleLabel(u.role), businessRoleLabel(u.quote_business_role)].filter(Boolean);
    return parts.join(' · ');
  }
  // Ten hien thi cho 1 owner id DA GAN - phai tim ca trong danh sach
  // presale/sale (khong chi "agents" cu) de nguoi da gan truoc do (vd tung
  // la Presale nhung Admin vua bo gan business role) van hien dung TEN, KHONG
  // hien "Không rõ"/"undefined".
  const businessRoleUsersById = useMemo(() => {
    const map = new Map<string, QuoteBusinessRoleUser>();
    for (const u of presaleUsers || []) map.set(u.id, u);
    for (const u of saleUsers || []) map.set(u.id, u);
    return map;
  }, [presaleUsers, saleUsers]);
  function ownerNameFor(id?: string | null): string {
    if (!id) return 'Chưa gán';
    if (id === user?.id && user?.name) return repairUtf8Mojibake(user.name);
    const found = businessRoleUsersById.get(id);
    if (found) return ownerOptionLabel(found);
    const agentName = agentsById.get(id);
    return agentName ? repairUtf8Mojibake(agentName) : 'Không rõ (đã bỏ vai trò báo giá)';
  }
  /** Chi TEN THUAN (khong kem "· Leader · Presale & Sale" nhu ownerNameFor -
   * cai do danh cho label dropdown, KHONG phai de hien tren tai lieu bao gia
   * "Người liên hệ") - yeu cau rieng "hiển thị tên thôi k hiện Leader/
   * Presale & Sale". */
  function plainNameFor(id?: string | null): string | undefined {
    if (!id) return undefined;
    if (id === user?.id && user?.name) return repairUtf8Mojibake(user.name);
    const found = businessRoleUsersById.get(id);
    if (found) return repairUtf8Mojibake(found.name);
    const agentName = agentsById.get(id);
    return agentName ? repairUtf8Mojibake(agentName) : undefined;
  }
  // `action` tuy chon - yeu cau rieng "cho + sp và dv ở đâu luôn bro nếu
  // quên sao": toast bao "Báo giá đã khoá..." truoc day CHI la text, nguoi
  // dung phai tu nho di bam "Tạo phiên bản mới" o dau khac - gio toast co
  // luon 1 nut hanh dong ngay tai cho, bam la mo thang luong tao phien ban
  // (KHONG chi huong dan suong). Tham so tuy chon nen KHONG anh huong cac
  // showToast(...) khac dang khong truyen action.
  const [workspaceToast, setWorkspaceToast] = useState<{ ok: boolean; text: string; action?: { label: string; onClick: () => void } } | null>(null);

  function showToast(ok: boolean, text: string, action?: { label: string; onClick: () => void }) {
    setWorkspaceToast({ ok, text, action });
    window.setTimeout(() => setWorkspaceToast(null), action ? 8000 : 4000);
  }

  // Nhan biet CU THE nut nao dang chay (khong dung chung 1 boolean `busy` mo
  // ho cho MOI nut - bug de gap: nhieu nut cung disable/spinner nhung khong
  // ro dang cho hanh dong nao, nguoi dung khong biet dang cho gi). Cac ham
  // async lien quan gan/xoa key nay quanh setBusy(true)/false.
  type WorkspaceAction = 'draftSave' | 'handoff' | 'reviewPricing' | 'requestChanges' | 'approve' | 'publish' | 'send';
  const ACTION_LOADING_LABELS: Record<WorkspaceAction, string> = {
    draftSave: 'Đang lưu…',
    handoff: 'Đang lưu và bàn giao…',
    reviewPricing: 'Đang gửi duyệt…',
    requestChanges: 'Đang gửi yêu cầu…',
    approve: 'Đang duyệt…',
    publish: 'Đang phát hành…',
    send: 'Đang gửi…',
  };
  const [activeAction, setActiveAction] = useState<WorkspaceAction | null>(null);
  /** Noi dung nut khi dang chay: spinner nho + chu mo ta (khong bao gio chi
   * hien spinner tron - accessibility, nguoi dung phai biet dang cho gi). */
  function actionButtonContent(key: WorkspaceAction, idleContent: React.ReactNode) {
    if (busy && activeAction === key) {
      return (
        <>
          <span className="qc-btn-spinner" aria-hidden="true" />
          {ACTION_LOADING_LABELS[key]}
        </>
      );
    }
    return idleContent;
  }

  // Bo quy tac active - doc 1 lan (khong phu thuoc quote - "Create mode chua
  // co du lieu van phai render card").
  useEffect(() => {
    let cancelled = false;
    seedingQuoteRepository.getActiveQuoteApprovalRuleSet().then(result => {
      if (!cancelled) setRuleSet(result);
    }).catch(() => {
      if (!cancelled) setRuleSet(null);
    }).finally(() => {
      if (!cancelled) setRuleSetLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Danh gia LAI THAT moi lan bao gia thay doi (khong chi doc snapshot cu -
  // neu khong, card se hien "Chua co du lieu" ngay ca khi bao gia da co day
  // du gia von/gia ban, vi CHUA CO lan danh gia nao duoc luu tu truoc toi
  // gio - danh gia chi tung chay tu dong luc "Hoan tat phan gia ban"). Goi
  // evaluate-rules() de vua tinh LAI so that vua luu snapshot moi, thay vi
  // cho toi luc chuyen buoc.
  useEffect(() => {
    if (!quote?.id) {
      setRuleEvaluation(null);
      return;
    }
    let cancelled = false;
    seedingQuoteRepository.evaluateQuoteRules(quote.id).then(result => {
      if (!cancelled) setRuleEvaluation(result);
    }).catch(() => {
      if (!cancelled) setRuleEvaluation(null);
    });
    return () => { cancelled = true; };
  }, [quote?.id, quote?.updatedAt]);

  const RULE_LABELS: Record<QuoteApprovalRuleType, { label: string; description: string; unit: string }> = {
    gross_margin_percent: { label: 'Gross margin tối thiểu', description: 'Margin = (Giá sau CK − Cost) / Giá sau CK.', unit: '%' },
    gross_profit_amount: { label: 'Lợi nhuận gộp tối thiểu', description: 'Giá bán sau chiết khấu phải tạo đủ gross profit.', unit: 'đ' },
    discount_percent: { label: 'Chiết khấu thương mại tối đa', description: 'Vượt ngưỡng phải chuyển người có quyền duyệt.', unit: '%' },
    payment_terms_days: { label: 'Thời hạn thanh toán tối đa', description: 'Điều khoản dài hơn ngưỡng được xem là ngoại lệ.', unit: 'ngày' },
  };

  // Bang "Hang muc & cau truc gia" - state edit LOCAL, dong bo lai tu
  // quote.items moi lan quote thay doi (sau khi load/luu). Luu that qua
  // updateQuote() - RPC quote_update XOA HET roi CHEN LAI toan bo item moi
  // lan goi (khong phai partial update) nen MOI LAN luu deu phai gui DU CA
  // data LAN items hien tai, neu khong se VO TINH XOA SACH item/data con lai
  // (bug thuc te phat hien khi doc lai RPC, khong phai gia dinh).
  const [itemsDraft, setItemsDraft] = useState<QuoteItem[]>([]);
  const [itemsFullscreen, setItemsFullscreen] = useState(false);
  const [selectedDiscountRowKeys, setSelectedDiscountRowKeys] = useState<Set<string>>(new Set());
  const [itemDiscountInput, setItemDiscountInput] = useState('');
  const persistedDraftSnapshotRef = useRef('');
  const persistedItemsDraftRef = useRef<QuoteItem[]>([]);
  const persistedQuoteDataRef = useRef<Quote['data'] | undefined>(undefined);
  const persistedOverallDiscountRef = useRef<number | null | undefined>(undefined);
  const [discardCloseConfirmOpen, setDiscardCloseConfirmOpen] = useState(false);
  function makeWorkspaceSnapshot(items: QuoteItem[], data: Quote['data'] | undefined, overallDiscountPercent: number | null | undefined): string {
    return JSON.stringify({
      items: buildItemsPayload(cloneQuoteItems(items)),
      data: data ?? null,
      overallDiscountPercent: overallDiscountPercent ?? null,
    });
  }
  useEffect(() => {
    const nextItems = quote?.items ? normalizeLoadedParentIds(sanitizeDraftQuoteItems(flattenItemTree(quote.items))) : [];
    setItemsDraft(nextItems);
    persistedItemsDraftRef.current = cloneQuoteItems(nextItems);
    persistedQuoteDataRef.current = quote?.data ? deepClone(quote.data) : quote?.data;
    persistedOverallDiscountRef.current = quote?.overallDiscountPercent ?? null;
    persistedDraftSnapshotRef.current = makeWorkspaceSnapshot(nextItems, quote?.data, quote?.overallDiscountPercent ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  const workspaceDirty = useMemo(() => {
    if (!quote) return false;
    return makeWorkspaceSnapshot(itemsDraft, quote.data, quote.overallDiscountPercent ?? null) !== persistedDraftSnapshotRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsDraft, quote?.data, quote?.overallDiscountPercent, quote?.id]);

  function discardDraftChanges() {
    setItemsDraft(cloneQuoteItems(persistedItemsDraftRef.current));
    setQuote(current => current ? {
      ...current,
      data: persistedQuoteDataRef.current ? deepClone(persistedQuoteDataRef.current) : current.data,
      overallDiscountPercent: persistedOverallDiscountRef.current ?? null,
    } : current);
    setSelectedDiscountRowKeys(new Set());
    setDiscardCloseConfirmOpen(false);
  }

  function requestWorkspaceClose() {
    markClosingIntent();
    if (workspaceDirty) {
      setDiscardCloseConfirmOpen(true);
      return;
    }
    onClose();
  }

  function confirmDiscardAndClose() {
    discardDraftChanges();
    onClose();
  }

  useEffect(() => {
    function handleWorkspaceEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestWorkspaceClose();
    }
    window.addEventListener('keydown', handleWorkspaceEscape);
    return () => window.removeEventListener('keydown', handleWorkspaceEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceDirty]);

  function discountRowKey(row: QuoteItem, index: number) {
    return row.id || `draft-${index}`;
  }

  const selectableDiscountRowKeys = useMemo(
    () => itemsDraft
      .map((row, index) => (row.rowType === 'section' ? null : discountRowKey(row, index)))
      .filter((key): key is string => Boolean(key)),
    [itemsDraft]
  );

  const selectedDiscountCount = useMemo(
    () => selectableDiscountRowKeys.filter(key => selectedDiscountRowKeys.has(key)).length,
    [selectableDiscountRowKeys, selectedDiscountRowKeys]
  );

  useEffect(() => {
    setSelectedDiscountRowKeys(prev => {
      const allowed = new Set(selectableDiscountRowKeys);
      const next = new Set([...prev].filter(key => allowed.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableDiscountRowKeys]);

  useEffect(() => {
    if (!itemsFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [itemsFullscreen]);

  // Kiem tra kenh gui email san sang hay chua - CHI goi khi bao gia da
  // duyet+phat hanh (dung dieu kien "Chua duyet"/"Chua phat hanh" da du de
  // disable nut roi, khong can goi API som hon). Endpoint nay khong doi hoi
  // quyen Admin/Leader - bat ky ai duoc GUI bao gia nay deu goi duoc (xem
  // /quotes/{id}/send-availability).
  useEffect(() => {
    if (!quote || quote.status !== 'approved' || quote.processingStage !== 'published' || !quote.publicEnabled) {
      setSendAvailability(null);
      return;
    }
    let cancelled = false;
    seedingQuoteRepository.getQuoteSendAvailability(quote.id).then(result => {
      if (!cancelled) setSendAvailability(result);
    }).catch(() => {
      if (!cancelled) setSendAvailability({ available: false, reason: 'Không kiểm tra được kênh gửi email.' });
    });
    return () => { cancelled = true; };
  }, [quote?.id, quote?.status, quote?.processingStage, quote?.publicEnabled]);

  function updateRow(index: number, patch: Partial<QuoteItem>) {
    setItemsDraft(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function toggleDiscountRowSelection(key: string, checked: boolean) {
    setSelectedDiscountRowKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAllItemSelection(checked: boolean) {
    setSelectedDiscountRowKeys(checked ? new Set(selectableDiscountRowKeys) : new Set());
  }

  function applyItemDiscount(scope: 'selected' | 'all') {
    const normalized = itemDiscountInput.trim().replace(',', '.');
    const rawValue = normalized === '' ? 0 : Number(normalized);
    if (!Number.isFinite(rawValue)) {
      window.alert('Chiết khấu phải là một số từ 0% đến 100%.');
      return;
    }
    const discountPercent = clampDiscountPercent(rawValue);
    if (scope === 'selected' && selectedDiscountCount === 0) {
      window.alert('Chọn ít nhất một hạng mục để áp chiết khấu.');
      return;
    }
    const targetKeys = scope === 'all' ? new Set(selectableDiscountRowKeys) : selectedDiscountRowKeys;
    const nextItems = itemsDraft.map((row, index) => {
      if (row.rowType === 'section') return row;
      const key = discountRowKey(row, index);
      return targetKeys.has(key) ? { ...row, discountPercent } : row;
    });
    setItemsDraft(nextItems);
    if (quote) void persistQuote({ items: nextItems }, { silent: true });
    showToast(true, scope === 'all' ? 'Đã áp chiết khấu cho tất cả hạng mục.' : `Đã áp chiết khấu cho ${selectedDiscountCount} hạng mục.`);
  }

  function removeSelectedItemRows() {
    if (selectedDiscountCount === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Xóa ${selectedDiscountCount} hạng mục đã chọn?`)) return;
    const selected = new Set(selectedDiscountRowKeys);
    const nextItems = itemsDraft.filter((row, index) => row.rowType === 'section' || !selected.has(discountRowKey(row, index)));
    setItemsDraft(nextItems);
    setSelectedDiscountRowKeys(new Set());
    if (quote) void persistQuote({ items: nextItems }, { silent: true });
    showToast(true, `Đã xóa ${selectedDiscountCount} hạng mục.`);
  }

  // Ca 3 handler duoi day PHAI khong bao gio tao ra NaN/Infinity du nguoi
  // dung nhap ky tu la, so am hay de trong - dung Number.isFinite() thay vi
  // `Number(raw) || 0` (KHONG du: NaN||0 tinh cờ ve 0 dung, nhung Math.max(0,
  // NaN) van tra ve NaN - da xac nhan bug that qua test yeu cau, khong phai
  // gia dinh).
  // CurrencyInput da tu parse ra number|null (xem lib/currency.ts) - handler
  // chi con can kep am, khong tu parse chuoi rieng nua.
  function toSafeNonNegative(value: number | null): number | null {
    if (value === null) return null;
    return Math.max(0, value);
  }

  function applyCostToRow(row: QuoteItem, cost: number | null): QuoteItem {
    if (cost === null) return { ...row, costPrice: null, markupPercent: null };
    // BUG that da fix: truoc day markup mac dinh ve 0 khi chua dat, khien
    // Gia khach TU DONG nhay bang dung Gia von moi nhap (Sale chua he
    // dong vao Gia khach). CHI tinh lai unitPrice khi markup DA duoc dat
    // ro rang (khac null) - giu nguyen Gia khach neu markup chua xac dinh.
    // Chot lai them: CHI tu tinh lai unitPrice (Gia khach) khi nguoi dang
    // sua THAT SU co quyen pricing (canEditPricingCells) - Presale (chi co
    // quyen Cost, khong co quyen Pricing) sua Gia von KHONG duoc phep lam
    // Gia khach am tham doi theo, du markup dong do da co san tu truoc.
    return {
      ...row,
      costPrice: cost,
      costNotApplicable: false,
      markupPercent: calculateMarkupFromCostPrice(cost, row.unitPrice),
    };
  }

  // CHOT LAI LAN 2 ("Bỏ tự động lan Giá vốn từ dòng đầu"): TRUOC day nhap
  // Gia von o dong DAU TIEN cua 1 batch vua them se tu dong lan sang cac
  // dong con lai (dung 1 lan). Yeu cau ro rang lan nay: BO HOAN TOAN hanh vi
  // tu dong lan, KE CA lan nhap dau tien - sua/nhap Gia von o BAT KY dong
  // nao CHI doi dung dong do, khong bao gio tu dong anh huong dong khac.
  // Muon dien nhieu dong PHAI chu dong bam icon "Điền xuống" (xem
  // fillDownTargets/applyFillDown/fillDownUndo ben duoi) - tach biet hoan
  // toan 2 co che, khong con "1 lan tu dong + Dien xuong thu cong" nhu truoc.
  function handleCostPriceChange(index: number, value: number | null) {
    const cost = toSafeNonNegative(value);
    setItemsDraft(prev => prev.map((r, i) => (i === index ? applyCostToRow(r, cost) : r)));
  }

  function handleCostPriceBlur() {
    void persistQuote({}, { silent: true });
  }

  // Tick "Khong ap dung gia von" xoa luon costPrice/markupPercent dang co -
  // 2 trang thai nay khong duoc cung ton tai (tranh vua co gia von vua danh
  // dau khong ap dung, vo nghia va se bi RPC ep ve NULL/false phia server
  // (migration 090) neu lo gui len).
  function handleCostNotApplicableChange(index: number, checked: boolean) {
    setItemsDraft(prev =>
      prev.map((row, i) => (i === index ? { ...row, costNotApplicable: checked, costPrice: checked ? null : row.costPrice, markupPercent: checked ? null : row.markupPercent } : row))
    );
  }

  /** Override Gia von cho dong nguon Bang gia VPS Zone (muc 13 yeu cau) - PHAI
   * co ly do, luu gia cu/moi/nguoi sua/thoi gian. CHI dung cho dong co
   * priceBookItemId (dong danh muc noi bo khong co khai niem "gia chuan" de
   * so sanh, khong can luong nay). KHONG goi API Bang gia VPS Zone - chi sua
   * dong quote_items hien tai (dung nguyen tac snapshot bat bien). */
  function applyCostOverride(index: number, newCost: number, reason: string) {
    setItemsDraft(prev =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const original = row.costPriceOriginal ?? row.costPrice ?? null;
        return {
          ...row,
          costPriceOriginal: original,
          costPrice: newCost,
          costOverrideReason: reason,
          costOverrideBy: user?.id || null,
          costOverrideAt: new Date().toISOString(),
        };
      })
    );
    setCostOverrideModal(null);
    if (quote) void persistQuote({}, { silent: true });
  }

  function restoreCostFormula(index: number) {
    setItemsDraft(prev =>
      prev.map((row, i) =>
        i === index
          ? { ...row, costPrice: row.costPriceOriginal ?? row.costPrice, costPriceOriginal: null, costOverrideReason: null, costOverrideBy: null, costOverrideAt: null }
          : row
      )
    );
    if (quote) void persistQuote({}, { silent: true });
  }

  function handleMarkupChange(index: number, raw: string) {
    const parsed = raw.trim() === '' ? null : Number(raw);
    if (parsed != null && !isValidMarkupPercent(parsed)) {
      window.alert('Markup phải từ -100% trở lên.');
      return;
    }
    setItemsDraft(prev =>
      prev.map((row, i) => {
        if (i !== index || row.costPrice == null) return row;
        if (raw.trim() === '') return { ...row, markupPercent: null };
        if (parsed == null || !Number.isFinite(parsed)) return row;
        const markup = parsed;
        return { ...row, markupPercent: markup, unitPrice: Math.max(0, row.costPrice * (1 + markup / 100)) };
      })
    );
  }

  function handleUnitPriceChange(index: number, value: number | null) {
    const price = toSafeNonNegative(value);
    setItemsDraft(prev =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, unitPrice: price, markupPercent: calculateMarkupFromCostPrice(row.costPrice, price) };
      })
    );
  }

  function updateBundleComponents(parentIndex: number, componentIds: string[], patcher: (component: BundleSnapshotComponent) => BundleSnapshotComponent) {
    const targetIds = new Set(componentIds);
    const nextItems = itemsDraft.map((row, i) => {
      if (i !== parentIndex) return row;
      const currentComponents = bundleSnapshotComponents(row);
      if (currentComponents.length === 0) return row;
      const nextComponents = currentComponents.map(component => (targetIds.has(component.componentId) ? patcher(component) : component));
      return recalculateBundleParent(row, nextComponents);
    });
    setItemsDraft(nextItems);
    if (quote) void persistQuote({ items: nextItems }, { silent: true });
  }

  function setBundleComponentCost(parentIndex: number, componentIds: string[], value: number | null) {
    const cost = toSafeNonNegative(value);
    updateBundleComponents(parentIndex, componentIds, component => {
      const price = componentCustomerPrice(component);
      return {
        ...component,
        defaultCostPriceVnd: cost,
        defaultMarkupPercent: calculateMarkupFromCostPrice(cost, price),
      };
    });
  }

  function setBundleComponentPrice(parentIndex: number, componentIds: string[], value: number | null) {
    const price = toSafeNonNegative(value) ?? 0;
    updateBundleComponents(parentIndex, componentIds, component => {
      const cost = componentCostPrice(component);
      return {
        ...component,
        unitPriceVnd: price,
        defaultCustomerPriceVnd: price,
        defaultMarkupPercent: calculateMarkupFromCostPrice(cost, price),
      };
    });
  }

  function deriveBundleComponentCost(parentIndex: number, componentIds: string[]) {
    updateBundleComponents(parentIndex, componentIds, component => {
      if (component.defaultCostPriceVnd != null) return component;
      if ((component.sku || '').toUpperCase() === 'MCHAT-AI-TOKEN') return component;
      const basis = Number(component.defaultCustomerPriceVnd ?? component.unitPriceVnd ?? 0) || 0;
      const derivedCost = basis > 0 ? roundBundlePrice(basis * 0.7) : null;
      return {
        ...component,
        defaultCostPriceVnd: derivedCost,
        defaultMarkupPercent: calculateMarkupFromCostPrice(derivedCost, componentCustomerPrice(component)),
      };
    });
  }

  function toggleBundleAutoPricing(parentIndex: number, auto: boolean) {
    const nextItems = itemsDraft.map((row, i) => {
      if (i !== parentIndex) return row;
      return recalculateBundleParent(row, bundleSnapshotComponents(row), auto ? 'auto' : 'fixed', bundleSnapshotTargetGm(row));
    });
    setItemsDraft(nextItems);
    if (quote) void persistQuote({ items: nextItems }, { silent: true });
  }

  function removeBundleComponent(parentIndex: number, child: QuoteItem) {
    if (child.__bundleRequired) return;
    const componentIds = child.__bundleComponentIds || [];
    if (componentIds.length === 0) return;
    const label = child.serviceDescription || 'thành phần';
    if (typeof window !== 'undefined' && !window.confirm(`Bỏ ${label} khỏi gói Combo này?`)) return;
    const targetIds = new Set(componentIds);
    const nextItems = itemsDraft.map((row, i) => {
      if (i !== parentIndex) return row;
      const nextComponents = bundleSnapshotComponents(row).filter(component => !targetIds.has(component.componentId));
      return recalculateBundleParent(row, nextComponents);
    });
    setItemsDraft(nextItems);
    if (quote) void persistQuote({ items: nextItems }, { silent: true });
  }

  // "Dien xuong" Gia von/Markup (yeu cau chung - KHONG phai autofill tu danh
  // muc, huong do da bi huy). Pham vi = cac dong LIEN TIEP ngay sau `index`
  // co CUNG parentItemId voi dong nguon - dung dung bat bien ma
  // recomputeParentIds() da giu xuyen suot (parentItemId luon suy tu vi tri,
  // Muc cha gan truoc no gan nhat), nen chi can dung lai khi gap 1 Section
  // hoac 1 parentItemId khac. Muc cha (rowType==='section') khong bao gio
  // duoc chon lam dong nguon/dich.
  type FillDownMode = 'empty' | 'all';
  const [fillDownConfirm, setFillDownConfirm] = useState<
    { index: number; field: 'costPrice' | 'markupPercent'; targetIndices: number[]; mode: FillDownMode } | null
  >(null);
  // "Sau khi áp dụng phải có toast thông báo và Undo" - snapshot TOAN BO
  // itemsDraft truoc khi ap dung fill-down, cho phep hoan tac dung 1 lan gan
  // nhat (khong phai stack nhieu buoc). Doc lap hoan toan voi co che autofill
  // tu dong da BI BO o tren - day CHI kich hoat khi nguoi dung CHU DONG bam
  // "Điền xuống", khong bao gio tu chay.
  const [fillDownUndo, setFillDownUndo] = useState<{ items: QuoteItem[]; message: string } | null>(null);

  // Pham vi "hang muc con" - chi cac dong LIEN TIEP ngay sau `index` cung
  // parentItemId (dung Section lam ranh gioi). Muc cha (rowType==='section')
  // khong bao gio duoc chon lam dong nguon/dich.
  function fillDownTargets(index: number): number[] {
    const source = itemsDraft[index];
    if (!source || source.rowType === 'section') return [];
    const targets: number[] = [];
    for (let i = index + 1; i < itemsDraft.length; i++) {
      const row = itemsDraft[i];
      if (row.rowType === 'section') break;
      if (row.parentItemId !== source.parentItemId) break;
      targets.push(i);
    }
    return targets;
  }

  // "Chỉ điền các dòng đang trống" - subset cua fillDownTargets() ma field
  // tuong ung dang null (chua nhap) - CHE DO NAY khong bao gio ghi de, nen
  // khong can ConfirmModal du co bao nhieu dong.
  function fillDownEmptyTargets(index: number, field: 'costPrice' | 'markupPercent'): number[] {
    return fillDownTargets(index).filter(i => {
      const row = itemsDraft[i];
      return field === 'costPrice' ? row.costPrice == null : row.markupPercent == null;
    });
  }

  function applyFillDown(index: number, field: 'costPrice' | 'markupPercent', targetIndices: number[], mode: FillDownMode) {
    const source = itemsDraft[index];
    if (!source) return;
    const undoSnapshot = cloneQuoteItems(itemsDraft);
    const targetSet = new Set(targetIndices);
    const next = itemsDraft.map((row, i) => {
      if (!targetSet.has(i)) return row;
      if (field === 'costPrice') {
        // Chi copy gia von don thuan - GIU NGUYEN markup/gia khach hien co
        // cua tung dong con (dung yeu cau "dien gia von", khong tu dong tinh
        // lai gia ban).
        return { ...row, costPrice: source.costPrice, costNotApplicable: false };
      }
      // markupPercent: ap CUNG % markup nhu dong nguon, roi tinh lai gia
      // khach - CHI cho dong da co gia von rieng (thieu gia von thi bo qua,
      // khong the suy unitPrice tu markup neu khong co cost).
      if (row.costPrice == null) return row;
      const markup = source.markupPercent ?? 0;
      return { ...row, markupPercent: markup, unitPrice: Math.max(0, row.costPrice * (1 + markup / 100)) };
    });
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
    setFillDownConfirm(null);
    const fieldLabel = field === 'costPrice' ? 'Giá vốn' : 'Markup';
    const scopeLabel = mode === 'empty' ? 'đang trống' : 'đã chọn';
    const message = `Đã điền ${fieldLabel} xuống ${targetIndices.length} dòng ${scopeLabel}.`;
    setFillDownUndo({ items: undoSnapshot, message });
    showToast(true, message);
  }

  function undoFillDown() {
    if (!fillDownUndo) return;
    setItemsDraft(fillDownUndo.items);
    if (quote) void persistQuote({ items: fillDownUndo.items }, { silent: true });
    setFillDownUndo(null);
  }

  // Vao dung 1 trong 2 che do nguoi dung chon o popover cua icon "Điền
  // xuống" (xem renderFillDownIcon) - "empty" khong bao gio ghi de (bo qua
  // ConfirmModal), "all" moi can hoi xac nhan neu co dong da co gia tri.
  function fillDownWithMode(index: number, field: 'costPrice' | 'markupPercent', mode: FillDownMode) {
    const source = itemsDraft[index];
    if (!source) return;
    if (field === 'costPrice' && source.costPrice == null) return;
    if (field === 'markupPercent' && source.markupPercent == null) return;
    const targetIndices = mode === 'empty' ? fillDownEmptyTargets(index, field) : fillDownTargets(index);
    if (targetIndices.length === 0) return;
    if (mode === 'all') {
      const overwriteCount = targetIndices.filter(i => {
        const row = itemsDraft[i];
        return field === 'costPrice' ? row.costPrice != null : row.markupPercent != null;
      }).length;
      if (overwriteCount > 0) {
        setFillDownConfirm({ index, field, targetIndices, mode });
        return;
      }
    }
    applyFillDown(index, field, targetIndices, mode);
  }

  /** Icon nho "Điền xuống" (yeu cau rieng: khong hien chu, dung icon +
   * tooltip/aria-label) - bam mo popover (ActionMenu) cho chon 1 trong 2
   * pham vi RO RANG ("Chỉ điền các dòng đang trống" / "Điền toàn bộ các
   * dòng") thay vi chay thang 1 hanh dong duy nhat nhu ban truoc - dung yeu
   * cau moi "phải hiển thị phạm vi và số dòng sẽ bị ảnh hưởng" (hien so
   * dong ngay trong nhan cua tung lua chon). Chi hien khi dong nay CO the
   * lam nguon (da co gia tri o field tuong ung) VA co it nhat 1 hang muc
   * con. Dung lai ActionMenu (portal + position:fixed) - da xac nhan an
   * toan voi overflow:auto cua bang cha tu bug fix truoc do. */
  function renderFillDownIcon(index: number, field: 'costPrice' | 'markupPercent') {
    if (!canEdit || !isDraft || isLockedForReview) return null;
    const item = itemsDraft[index];
    const hasSourceValue = field === 'costPrice' ? item.costPrice != null : item.markupPercent != null;
    if (!hasSourceValue) return null;
    const allTargets = fillDownTargets(index);
    if (allTargets.length === 0) return null;
    const emptyTargets = fillDownEmptyTargets(index, field);
    const fieldLabel = field === 'costPrice' ? 'Giá vốn' : 'Markup';
    const label = `Điền ${fieldLabel} xuống`;
    return (
      <ActionMenu
        label={label}
        icon={ArrowDownToLine}
        triggerClassName="qc-fill-down-icon-btn"
        iconClassName="qc-inline-icon"
        items={[
          {
            key: 'empty',
            label: `Chỉ điền các dòng đang trống (${emptyTargets.length})`,
            disabled: emptyTargets.length === 0,
            title: emptyTargets.length === 0 ? 'Không còn dòng nào đang trống trong phạm vi này' : undefined,
            onSelect: () => fillDownWithMode(index, field, 'empty'),
          },
          {
            key: 'all',
            label: `Điền toàn bộ (${allTargets.length} dòng)`,
            onSelect: () => fillDownWithMode(index, field, 'all'),
          },
        ]}
      />
    );
  }

  function toItemInput(row: QuoteItem): QuoteItem {
    return {
      rowType: row.rowType === 'section' ? 'section' : 'item',
      description: row.description || '',
      serviceDescription: row.serviceDescription,
      warrantyScope: row.warrantyScope,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      discountPercent: row.discountPercent ?? 0,
      vatRate: row.vatRate ?? 10,
      costPrice: row.costPrice ?? null,
      markupPercent: row.markupPercent != null && isValidMarkupPercent(row.markupPercent) ? row.markupPercent : null,
      costNotApplicable: row.costNotApplicable ?? false,
      catalogItemId: row.catalogItemId,
      bundleSnapshot: row.bundleSnapshot,
      // BUG THAT DA GAP (phat hien khi test snapshot USD Bang gia VPS Zone):
      // toItemInput() liet ke tung field mot, THIEU HAN 3 field nay - moi
      // hang muc them tu "Bảng giá VPS Zone" (priceBookItemToQuoteItem())
      // gan priceBookItemId/priceBookVersionId/priceBookSnapshot ngay luc
      // them, nhung khi gui len BE qua ham nay thi 3 field do bi ROI RA
      // (undefined, khong nam trong object tra ve) - DB luu NULL, mat het
      // lien ket toi price_book_items goc LAN toan bo snapshot audit-trail
      // (costMode/unitPriceUsd/exchangeRate/costUsd/customerPriceUsd...),
      // du cot DB da co san tu migration 106. Anh huong CA yeu cau "reload
      // quote van giu dung snapshot" moi lan nay.
      priceBookItemId: row.priceBookItemId,
      priceBookVersionId: row.priceBookVersionId,
      priceBookSnapshot: row.priceBookSnapshot,
      // De quy - hang muc thuoc 1 nhom (Section) duoc gui long trong
      // `children` cua dong section do, dung DINH DANG API cu da co san
      // (xem buildItemTree() gop itemsDraft PHANG thanh cay truoc khi goi
      // ham nay o cap goc).
      children: (row.children || []).map(toItemInput),
    };
  }

  /** Gop itemsDraft (PHANG) thanh cay + anh xa qua toItemInput - dung DUY
   * NHAT 1 cho truoc moi lan gui hang muc len BE (thay cho
   * `itemsDraft.map(toItemInput)` cu, von bo lo cau truc nhom vi map phang
   * khong biet hang muc nao thuoc section nao). */
  function buildItemsPayload(flat: QuoteItem[]): QuoteItem[] {
    return buildItemTree(flat).map(toItemInput);
  }

  // Xem giai thich day du trong persistQuote() ben duoi - danh dau "sap dong,
  // dung autosave nua" tren onMouseDown cua nut Dong/Huy (chay TRUOC blur).
  const skipNextAutoSaveRef = useRef(false);
  const quoteContentRevisionRef = useRef(0);
  function markClosingIntent() {
    skipNextAutoSaveRef.current = true;
  }

  async function persistQuote(overrides: { data?: Quote['data']; items?: QuoteItem[]; overallDiscountPercent?: number | null; quoteTypeCodes?: string[] }, opts?: { silent?: boolean }) {
    if (!quote) return;
    // BUG THAT DA GAP (fix 2026-09-22, xem commit e38f1635 "stabilize pricing
    // draft behavior" 2026-09-20): 1 dong `if (opts?.silent) return;` bi
    // chen NHAM ngay truoc check dung ben duoi, khien MOI cuoc goi silent
    // (autosave ngam onBlur cua Mo ta/SL/Gia von/Markup/keo-tha hang muc/sua
    // Custom block/doi Du an...) tren TOAN BO Workspace bi no-op tu do den
    // gio - go/sua xong roi rot khoi o KHONG con luu xuong DB nua (chi con
    // luu duoc khi bam nut "Lưu thay đổi" chinh, la nut goi persistQuote()
    // KHONG silent). Da xoa dong thua, chi giu lai check dung ben duoi (chan
    // rieng truong hop dang co "y dinh dong modal").
    // BUG THAT DA GAP ("sua nham 1 o roi bam X dong luon van bi luu"): moi o
    // sua trong bang hang muc (Markup/Gia von/Gia khach/Mo ta/SL...) deu
    // auto-save NGAM qua onBlur - khi bam nut Dong (X)/Huy/"← Danh sách", trinh
    // duyet BLUR o dang go TRUOC KHI chay onClick cua nut do, nen gia tri vua
    // go (co the go NHAM) van bi luu xuong DB truoc khi modal kip dong, du
    // nguoi dung chua he bam nut "Lưu thay đổi" chinh. Cac nut dong/huy nay
    // gio deu co onMouseDown={markClosingIntent} (mousedown chay TRUOC blur)
    // de bao truoc "sap dong, dung luu autosave nua" - CHI chan cuoc goi
    // SILENT (autosave ngam), KHONG anh huong nut "Lưu thay đổi" chinh (luon
    // goi khong co silent, van luu binh thuong khi nguoi dung chu dong bam).
    if (opts?.silent && skipNextAutoSaveRef.current) return;
    // silent=true: dung cho auto-save NGAM khi go/blur tung o (mo ta/SL/gia
    // von/markup...) - KHONG dung chung co `busy`/`activeAction` voi cac nut
    // hanh dong chinh (Bàn giao/Gửi duyệt...) nua. BUG THAT DA GAP: truoc day
    // MOI auto-save nay deu bat `busy=true`, khien nut "Bàn giao" bi disable
    // (khong the bam) DUNG NGAY luc nguoi dung vua nhap xong hang muc roi bam
    // lien tay - lan bam dau tien bi "nuot mat" (nut dang disable, trinh
    // duyet khong phat click), phai bam LAN 2 (luc auto-save da xong,
    // busy=false) moi thanh cong - nhin nhu phai bam 2 lan Bàn giao moi qua
    // duoc buoc 2. Auto-save van chay binh thuong ngam, chi khong con chan
    // cac nut hanh dong khac trong luc no dang luu.
    if (!opts?.silent) {
      setActiveAction('draftSave');
      setBusy(true);
    }
    try {
      const nextItems = overrides.items ?? itemsDraft;
      const contentRevision = quoteContentRevisionRef.current;
      const updated = await seedingQuoteRepository.updateQuote(quote.id, {
        data: overrides.data ?? quote.data,
        items: buildItemsPayload(nextItems),
        overallDiscountPercent: 'overallDiscountPercent' in overrides ? overrides.overallDiscountPercent : (quote.overallDiscountPercent ?? null),
        ...('quoteTypeCodes' in overrides ? { quoteTypeCodes: overrides.quoteTypeCodes } : {}),
      });
      setQuote(current => current?.id === updated.id && contentRevision !== quoteContentRevisionRef.current
        ? { ...updated, data: { ...updated.data, paymentPlan: current.data.paymentPlan, customBlocks: current.data.customBlocks } }
        : updated);
      const savedItems = cloneQuoteItems(flattenItemTree(updated.items || []));
      setItemsDraft(savedItems);
      persistedItemsDraftRef.current = cloneQuoteItems(savedItems);
      persistedQuoteDataRef.current = updated.data ? deepClone(updated.data) : updated.data;
      persistedOverallDiscountRef.current = updated.overallDiscountPercent ?? null;
      persistedDraftSnapshotRef.current = makeWorkspaceSnapshot(savedItems, updated.data, updated.overallDiscountPercent ?? null);
      await onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được thay đổi.');
    } finally {
      if (!opts?.silent) {
        setBusy(false);
        setActiveAction(null);
      }
    }
  }

  function addItemRow() {
    clearRequiredError('items');
    setItemsDraft(prev => [
      ...prev,
      { description: '', quantity: 1, unitPrice: 0, vatRate: 10, discountPercent: 0, costPrice: null, markupPercent: null, parentItemId: trailingParentItemId(prev) },
    ]);
  }

  // Muc cha (Section, migration 104) - dong tieu de nhom THUAN TUY, khong
  // tinh tien (server tu ep qty/gia ve 0 du client gui gi). `id` TAM (client-
  // side, chua luu that) de cac hang muc con moi them ngay sau do co the tro
  // toi qua `parentItemId` TRUOC ca khi bam Luu - buildItemsPayload() gop lai
  // dung nhom nay luc gui len, BE se tra ve id THAT sau khi luu/tai lai.
  function addSectionRow() {
    setItemsDraft(prev => [
      ...prev,
      { id: newBlockId(), rowType: 'section', description: 'Mục mới', quantity: 0, unitPrice: 0, vatRate: 0, discountPercent: 0 },
    ]);
  }

  // "+" tren TUNG dong hang muc (yeu cau rieng "thao tác thêm hạng mục" -
  // KHONG con nut tren Muc cha nua) - them 1 dong TRONG NGAY SAU dong o
  // index, ke thua dung parentItemId cua dong nguon (dong thuoc Muc cha nao
  // thi dong moi cung vao dung Muc cha do, dong ngoai Muc cha nao thi cung
  // khong gan Muc cha - dung tinh chat "cac hang muc cua 1 nhom nam LIEN
  // TIEP trong mang" ma vong lap render dang dua vao).
  function addBlankItemAfterIndex(index: number) {
    setItemsDraft(prev => {
      const sourceRow = prev[index];
      if (!sourceRow) return prev;
      const newRow: QuoteItem = {
        description: '', quantity: 1, unitPrice: 0, vatRate: 10, discountPercent: 0,
        costPrice: null, markupPercent: null, parentItemId: sourceRow.parentItemId,
      };
      return [...prev.slice(0, index + 1), newRow, ...prev.slice(index + 1)];
    });
  }

  function duplicateItemRow(index: number) {
    setItemsDraft(prev => {
      const source = prev[index];
      if (!source) return prev;
      const clone: QuoteItem = { ...deepClone(source), id: undefined };
      const next = [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)];
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }

  // Keo-tha sap xep/chuyen nhom bang hang muc - dung API HTML5 Drag and Drop
  // thuan (khong them thu vien ngoai, bang chi vai chuc dong la nhieu). Chi
  // luu INDEX dang keo trong 1 ref (khong can state, khong lam re-render moi
  // khi keo qua tung hang). Tha 1 hang muc VAO 1 Muc cha se tu chuyen no vao
  // dung nhom do (thanh hang muc DAU TIEN cua nhom) - tha VAO 1 hang muc
  // khac se xep truoc dong do (thua ke DUNG nhom cua dong do, ke ca "khong
  // thuoc nhom nao"). Keo ca 1 Muc cha se mang theo CA hang muc con cua no
  // (xem getRowBlockRange/moveRowBlock).
  const dragRowIndexRef = useRef<number | null>(null);
  function handleRowDragStart(index: number) {
    dragRowIndexRef.current = index;
  }
  function handleRowDrop(targetIndex: number, targetIsSection: boolean) {
    const fromIndex = dragRowIndexRef.current;
    dragRowIndexRef.current = null;
    if (fromIndex === null || fromIndex === targetIndex) return;
    setItemsDraft(prev => {
      const draggedIsSection = prev[fromIndex]?.rowType === 'section';
      let insertBeforeIndex = targetIndex;
      if (targetIsSection && !draggedIsSection) {
        // Drop an item on a section: make it the section's first child.
        insertBeforeIndex = targetIndex + 1;
      } else if (targetIsSection && draggedIsSection && fromIndex < targetIndex) {
        // Moving a section downward must place its whole block after the
        // target block. Inserting before the target collapses back to the
        // original index once the dragged block is removed.
        insertBeforeIndex = getRowBlockRange(prev, targetIndex)[1];
      }
      const next = moveRowBlock(prev, fromIndex, insertBeforeIndex);
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }
  // Doi cho voi CA khoi lien ke (tren/duoi) - dung getRowBlockRange 2 lan de
  // biet dung ranh gioi khoi lang gieng (phong khoi do la 1 Section nhieu
  // hang muc con, khong phai luon dung 1 dong).
  function moveRowUpDown(index: number, direction: -1 | 1) {
    setItemsDraft(prev => {
      const [start, end] = getRowBlockRange(prev, index);
      let insertBeforeIndex: number;
      if (direction === -1) {
        if (start === 0) return prev;
        insertBeforeIndex = blockStartEndingAt(prev, start - 1);
      } else {
        if (end >= prev.length) return prev;
        insertBeforeIndex = getRowBlockRange(prev, end)[1];
      }
      const next = moveRowBlock(prev, index, insertBeforeIndex);
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }

  // Danh sach phang cac dong BAN DUOC (bundle/component) tu cay catalog day
  // du - group chi dung lam ten nhom + loc, khong tu chon duoc. Gan kem
  // groupName cua group CHA GAN NHAT (catalog hien chi 1 cap group->item,
  // nhung ham nay van de quy vong sau phong khi mo rong).
  function flattenCatalogTree(roots: ServiceCatalogItem[]): ServiceCatalogItem[] {
    const out: ServiceCatalogItem[] = [];
    function walk(nodes: ServiceCatalogItem[], nearestGroupName?: string) {
      for (const node of nodes) {
        if (node.itemType === 'group') {
          walk(node.children || [], node.name);
        } else {
          out.push({ ...node, groupName: nearestGroupName });
          if (node.children?.length) walk(node.children, nearestGroupName);
        }
      }
    }
    walk(roots);
    return out;
  }

  function addItemsFromCatalog(itemsIn: QuoteItem[]) {
    if (itemsIn.length === 0) return;
    clearRequiredError('items');
    // Gan id ON DINH cho tung dong MOI ngay tu day (thay vi de trong cho tam
    // server sinh sau khi luu) - can co id THAT SU de theo doi dung batch
    // qua costBatchIds, khong phu thuoc vao index (index se doi khi chen/xoa/
    // keo tha dong khac).
    const items = itemsIn.map(item => (item.id ? item : { ...item, id: newBlockId() }));
    if (items.length > 1) setCostBatchIds(items.map(item => item.id!));
    else setCostBatchIds([]);
    let next = itemsDraft;
    if (catalogInsertAfterIndex != null && itemsDraft[catalogInsertAfterIndex]) {
      // "+" tren 1 dong cu the - chen NGAY SAU dung dong do, ke thua
      // parentItemId cua chinh dong nguon (dong thuoc Muc cha nao thi hang
      // muc moi vao dung Muc cha do; dong khong thuoc Muc cha nao - vd nam
      // ngoai moi Section - thi hang muc moi cung khong co parentItemId,
      // dung yeu cau "nếu dòng không thuộc Mục cha → chèn ngay sau dòng đó
      // ở cấp ngoài").
      const sourceRow = itemsDraft[catalogInsertAfterIndex];
      const insertAt = catalogInsertAfterIndex + 1;
      next = [
        ...next.slice(0, insertAt),
        ...items.map(item => ({ ...item, parentItemId: sourceRow.parentItemId })),
        ...next.slice(insertAt),
      ];
    } else if (catalogTargetSectionId) {
      const sectionIndex = next.findIndex(row => row.id === catalogTargetSectionId);
      if (sectionIndex !== -1) {
        let insertAt = sectionIndex + 1;
        while (insertAt < next.length && next[insertAt].parentItemId === catalogTargetSectionId) insertAt += 1;
        next = [
          ...next.slice(0, insertAt),
          ...items.map(item => ({ ...item, parentItemId: catalogTargetSectionId })),
          ...next.slice(insertAt),
        ];
      } else {
        const parentItemId = trailingParentItemId(next);
        next = [...next, ...items.map(item => ({ ...item, parentItemId }))];
      }
    } else {
      const parentItemId = trailingParentItemId(next);
      next = [...next, ...items.map(item => ({ ...item, parentItemId }))];
    }
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  /** Mapping khi them tu danh muc: snapshot day du ma/ten, mo ta, don vi, VAT, SL, gia von, markup va Gia khach mac dinh tu catalog. Quyen sua o tren UI/backend van theo role + buoc hien tai. */
  function catalogItemToQuoteItem(item: ServiceCatalogItem): QuoteItem {
    const bundleSnapshot = (item.components || []).map(component => ({
      componentId: component.componentId,
      sku: component.sku,
      name: component.name,
      description: component.description,
      unit: component.unit,
      quantity: component.quantity,
      computedQuantity: component.computedQuantity,
      displayText: component.displayText,
      unitPriceVnd: component.unitPriceVnd,
      monthlyPriceVnd: component.monthlyPriceVnd,
      annualCommitMonthlyPriceVnd: component.annualCommitMonthlyPriceVnd,
      defaultCostPriceVnd: component.defaultCostPriceVnd,
      defaultMarkupPercent: component.defaultCostPriceVnd != null && firstPositiveNumber(component.defaultCustomerPriceVnd, component.monthlyPriceVnd, component.annualCommitMonthlyPriceVnd, component.unitPriceVnd) != null
        ? calculateMarkupFromCostPrice(component.defaultCostPriceVnd, firstPositiveNumber(component.defaultCustomerPriceVnd, component.monthlyPriceVnd, component.annualCommitMonthlyPriceVnd, component.unitPriceVnd)!)
        : null,
      defaultCustomerPriceVnd: firstPositiveNumber(component.defaultCustomerPriceVnd, component.monthlyPriceVnd, component.annualCommitMonthlyPriceVnd, component.unitPriceVnd) ?? component.defaultCustomerPriceVnd ?? component.unitPriceVnd,
      quota: component.quota,
      customerDisplayName: component.customerDisplayName,
      crmNote: component.crmNote,
      quotaPoolKey: component.quotaPoolKey,
      quotaPoolName: component.quotaPoolName,
      quotaPoolQuota: component.quotaPoolQuota,
      quotaPoolLimit: component.quotaPoolLimit,
      required: component.required,
      overagePolicy: component.overagePolicy,
      showOnQuote: component.showOnQuote,
      sortOrder: component.sortOrder,
    }));
    const defaultUnitPrice = resolveCatalogCustomerPrice(item);
    const defaultCostPrice = item.itemType === 'bundle' ? calculateBundleComponentCost(bundleSnapshot) : (item.defaultCostPriceVnd ?? null);
    return {
      description: item.quoteDescription || item.description || item.name,
      serviceDescription: item.quoteDisplayName || (item.sku ? `${item.sku} - ${item.name}` : item.name),
      unit: item.unit || '',
      quantity: item.specQuantityPerUnit || 1,
      // Uu tien Gia khach da cau hinh o Bo gia mac dinh (migration 107) -
      // fallback ve Don gia Sale cu (default_unit_price_vnd) cho san pham
      // CHUA duoc cau hinh bo gia moi, tranh Gia khach ve 0 vo ly.
      unitPrice: defaultUnitPrice,
      discountPercent: item.defaultDiscountPercent || 0,
      vatRate: item.defaultVatRate ?? 10,
      // Bo gia MAC DINH cua danh muc chung (migration 107,
      // service_catalog_item_pricing) - CHI la GIA TRI MAC DINH luc chon,
      // sua trong quote KHONG ghi nguoc ve danh muc (dung nguyen tac
      // snapshot, giong het Bang gia VPS Zone). item.defaultCostPriceVnd co
      // the la `undefined` (khong du quyen xem, API da loai han field) hoac
      // `null` (du quyen nhung chua cau hinh) - ca 2 truong hop deu quy ve
      // costPrice=null, KHONG bia so 0.
      costPrice: costViewAllowed ? defaultCostPrice : null,
      // BUG THAT DA GAP: markupPercent truoc day gate theo canEditCostCells
      // (chi yeu cau stage != 'request') nhung backend coi markupPercent la
      // field PRICING (_PRICING_ITEM_FIELD_PAIRS trong quote.py), CHI duoc
      // sua o dung stage 'pricing' - Presale them hang muc o Buoc 2 (technical)
      // co san defaultMarkupPercent se bi BACKEND TU CHOI CA REQUEST voi loi
      // "Markup/Giá khách chỉ được nhập ở Bước 3" du costPrice hoan toan hop
      // le, khien hang muc KHONG luu duoc. Doi sang canEditPricingCells cho
      // dung phan loai field cua backend.
      markupPercent: item.itemType === 'bundle'
        ? calculateMarkupFromCostPrice(costViewAllowed ? defaultCostPrice : null, defaultUnitPrice)
        : calculateMarkupFromCostPrice(costViewAllowed ? defaultCostPrice : null, defaultUnitPrice) ?? item.defaultMarkupPercent ?? null,
      catalogItemId: item.id,
      bundleSnapshot: item.itemType === 'bundle'
        ? { pricingMode: 'fixed', targetGrossMarginPercent: item.targetGrossMarginPercent ?? 30, components: bundleSnapshot }
        : undefined,
    };
  }

  /** Mapping cho nguon "Bang gia VPS Zone" (migration 106) - SONG SONG voi
   * catalogItemToQuoteItem(), KHONG sua ham do. Khac 1 diem CO CHU DICH: Zone
   * co san gia von/Rate THAT (khong nhu danh muc noi bo khong co khai niem
   * cost), nen dien san costPrice/markupPercent lam GIA TRI MAC DINH - nhung
   * 2 gate canEditCostCells/canEditPricingCells VAN quyet dinh co duoc SUA
   * hay khong, khong bi mo khoa som hon quy dinh boi nguon Zone. */
  function priceBookItemToQuoteItem(item: PriceBookItem): QuoteItem {
    const preview = previewPriceBookItem({
      costMode: item.costMode,
      unitPriceUsd: item.unitPriceUsd,
      exchangeRate: item.exchangeRate,
      unitPriceVndDirect: item.unitPriceVndDirect,
      importDutyPercent: item.importDutyPercent,
      vatInPercent: item.vatInPercent,
      vatEuPercent: item.vatEuPercent,
      defaultQuantity: item.defaultQuantity,
      defaultRatePercent: item.defaultRatePercent,
      referencePrice: item.referencePrice,
    });
    return {
      description: item.description || item.name,
      serviceDescription: `${item.sku} - ${item.name}`,
      unit: item.unit || '',
      quantity: item.defaultQuantity || 1,
      unitPrice: canEditPricingCells ? preview.unitPrice || 0 : 0,
      discountPercent: 0,
      vatRate: item.vatEuPercent ?? 10,
      costPrice: canEditCostCells ? preview.costUnit ?? null : null,
      // Cung bug/fix voi catalogItemToQuoteItem() o tren - markupPercent la
      // field PRICING (chi sua duoc o stage 'pricing'), khong phai canEditCostCells.
      markupPercent: canEditPricingCells ? item.defaultRatePercent ?? null : null,
      catalogItemId: undefined,
      priceBookItemId: item.id,
      priceBookVersionId: item.priceBookVersionId,
      priceBookSnapshot: { ...item, computedAtSelection: preview },
    };
  }

  async function loadPriceBookItems() {
    // BUG THAT DA GAP ("SAO ĐANG TẠO CÁI MỚI MÀ BÊN VPS ZONE K HIỂN DANH MỤC
    // TA"): truoc day chan han khi !quote?.id (dang tao moi, chua co quote
    // that) - khien tab "Bảng giá VPS Zone" luon 0 san pham trong luc tao
    // moi, khac voi "Danh mục nội bộ" van xem binh thuong. quote_id gio la
    // optional o ca repository lan backend (tra danh sach day du, chi an gia
    // von/markup neu thieu quote that) - goi duoc ca khi !quote.
    if (priceBookItems !== null) return;
    setPriceBookLoading(true);
    try {
      const list = await priceBookZoneRepository.listPublishedForQuote(quote?.id);
      setPriceBookItems(list);
    } catch {
      setPriceBookItems([]);
    } finally {
      setPriceBookLoading(false);
    }
  }

  // `target` tuy chon (yeu cau rieng "thao tác thêm hạng mục" - bam "+" tai
  // 1 Muc cha hoac tai 1 dong hang muc, khong chi qua nut "Chọn từ danh mục"
  // chung o cuoi bang nhu truoc): { sectionId } = luon them vao CUOI dung
  // Muc cha do; { afterIndex } = chen NGAY SAU dung dong o vi tri do (dong
  // do co the thuoc 1 Muc cha hay khong, addItemsFromCatalog() tu suy
  // parentItemId tu chinh dong nguon). Khong truyen gi = giu nguyen hanh vi
  // cu (them vao cuoi bang, nguoi dung tu chon Muc cha dich qua dropdown
  // extraToolbar neu muon).
  const draftCatalogIssuerCompanyId =
    quote?.issuerCompanyId ?? quoteForms.find(form => form.id === (draftFormId || defaultFormId))?.issuerCompanyId ?? null;
  // "Đơn vị phát hành" THAT SU se duoc dung (che do tao moi, !quote) - mac
  // dinh la draftCatalogIssuerCompanyId (suy tu mau bao gia), Sale van doi
  // duoc qua dropdown moi (draftIssuerCompanyIdOverride) ma khong mat mac
  // dinh ban dau. Quote da ton tai (co quote) van giu nguyen issuerCompanyId
  // da luu, KHONG bi override nay anh huong.
  const effectiveIssuerCompanyId = quote
    ? quote.issuerCompanyId ?? null
    : draftIssuerCompanyIdOverride || draftCatalogIssuerCompanyId;
  // "Mặc định luôn hiện Markee" (feedback 2026-09-24): quote DA TON TAI ma
  // chua tung gan issuerCompanyId (tao truoc khi tinh nang nay co, hoac Presale
  // tao yeu cau chua dung toi Buoc thuong mai) - hien "MARKEE AI" (code 'MK',
  // xem migration 069_quote_issuer_companies.sql) lam mac dinh thay vi de
  // trong "Chưa chọn" - CHI ap dung cho quote da ton tai, khong dung anh
  // huong luong tao moi (co logic default rieng o CreateQuoteModal/QuoteCenterPage).
  const effectiveIssuerCompany =
    issuerCompanies.find(company => company.id === effectiveIssuerCompanyId) ||
    (quote ? issuerCompanies.find(company => company.code === 'MK') || null : null);

  async function openCatalogPicker(target?: { sectionId?: string; afterIndex?: number }) {
    setCatalogHydrationError(null);
    setCatalogHydrationRetryItem(null);
    setCatalogModalOpen(true);
    setCatalogTargetSectionId(target?.sectionId || '');
    setCatalogInsertAfterIndex(target?.afterIndex ?? null);
    if (catalogSource === 'zone') {
      void loadPriceBookItems();
    }
    // Cache theo DUNG quote?.id da fetch lan truoc - neu quote vua duoc tao
    // that (chuyen tu chua co sang co id that) phai FETCH LAI, khong dung
    // cay cu (fetch luc chua co quote_id se KHONG kem Gia von/Markup - giu
    // nguyen cay do mai mai se ket "khong bao gio thay cost" du bao gia da
    // luu xong).
    if (catalogTree && catalogTreeQuoteId === (quote?.id ?? null)) return;
    setCatalogLoading(true);
    try {
      // context='quote_picker' + quoteId THAT (khi da co) - dieu kien BAT
      // BUOC de backend cap Gia von/Markup (xem _resolve_catalog_pricing_visibility,
      // routers/service_catalog.py). Che do TAO MOI (quote?.id con undefined)
      // se KHONG kem quote_id - Picker van dung duoc binh thuong (Gia khach
      // luon hien), chi CHUA thay Gia von/Markup cho toi khi bao gia duoc
      // luu that (khong con ngoai le "tu cap cho nguoi goi" nhu thiet ke cu
      // - da bi audit bat lo hong bao mat, xem plan).
      const tree = await serviceCatalogRepository.list({
        context: 'quote_picker',
        quoteId: quote?.id,
        issuerCompanyId: draftCatalogIssuerCompanyId,
      });
      setCatalogTree(tree);
      setCatalogTreeQuoteId(quote?.id ?? null);
    } catch {
      setCatalogTree([]);
      setCatalogTreeQuoteId(quote?.id ?? null);
    } finally {
      setCatalogLoading(false);
    }
  }

  // Dau "+" canh 1 hang muc CHUA lien ket (xem cot ten hang muc) - mo THANG
  // QuickAddProductModal, khong can mo ca popup Chọn từ danh mục truoc. Phai
  // tu dam bao catalogTree da tai (dau "+" nay co the la LAN DAU nguoi dung
  // cham toi danh muc trong phien lam viec nay, khac voi luong tu popup Chọn
  // từ danh mục von da goi openCatalogPicker() truoc do).
  function openQuickAddForRow(index: number, locked?: boolean) {
    setQuickAddProductTarget({ linkIndex: index, locked });
    if (!catalogTree || catalogTreeQuoteId !== (quote?.id ?? null)) void refreshCatalogTree();
  }

  const catalogFlatItems = useMemo(() => (catalogTree ? flattenCatalogTree(catalogTree) : []), [catalogTree]);
  const catalogSectionOptions = useMemo(
    () => itemsDraft.filter(row => row.rowType === 'section' && row.id).map(row => ({ id: row.id as string, label: row.description || 'Mục cha' })),
    [itemsDraft]
  );

  // Khoa trung lap: catalogItemId/priceBookItemId -> index dong DA CO trong
  // itemsDraft (bo qua Muc cha). Tinh lai moi render - phan anh dung state
  // THAT ngay luc bam "Them vao bao gia", khong cache.
  const existingCatalogKeys = useMemo(() => {
    const map = new Map<string, number>();
    itemsDraft.forEach((row, index) => {
      if (row.rowType !== 'section' && row.catalogItemId) map.set(row.catalogItemId, index);
    });
    return map;
  }, [itemsDraft]);
  const existingZoneKeys = useMemo(() => {
    const map = new Map<string, number>();
    itemsDraft.forEach((row, index) => {
      if (row.rowType !== 'section' && row.priceBookItemId) map.set(row.priceBookItemId, index);
    });
    return map;
  }, [itemsDraft]);

  // Dung CHUNG useCatalogItemAdd (module service-catalog) cho ca 2 nguon -
  // dam bao hanh vi "san pham da co trong bang" GIONG HET nhau (hien "Da
  // them" + ConfirmModal tang SL/them dong moi) nhu FillQuoteStep dung cho
  // luong "Tao bao gia nhanh" (xem CatalogPickerModal + useCatalogItemAdd).
  const catalogAdd = useCatalogItemAdd<QuoteItem>({ existingKeys: existingCatalogKeys, onAdd: addItemsFromCatalog });
  const zoneAdd = useCatalogItemAdd<QuoteItem>({ existingKeys: existingZoneKeys, onAdd: addItemsFromCatalog });

  const internalPickerItems: CatalogPickerListItem[] = useMemo(
    () =>
      catalogFlatItems.map(item => ({
        id: item.id,
        // BUG THAT DA GAP: thieu itemType khien CatalogPickerModal loc
        // item.itemType === 'bundle' luon ra RONG (tab "Goi Combo" luon hien
        // 0 du API/DB co du lieu dung) - Combo khong bao gio hien duoc trong
        // Product Picker cua Quote Workspace. components/monthlyPriceVnd/...
        // cung thieu (can cho phan "Xem thanh phan" khi expand 1 Combo).
        // flattenCatalogTree() chi push node itemType='component'|'bundle'
        // (group luon bi "walk" xuyen qua, khong bao gio vao mang phang nay) -
        // ep kieu hep lai dung voi thuc te runtime, khop CatalogPickerListItem.
        itemType: item.itemType as 'component' | 'bundle',
        components: item.components,
        sku: item.sku,
        name: item.name,
        description: item.description,
        quoteDisplayName: item.quoteDisplayName,
        quoteDescription: item.quoteDescription,
        quoteCta: item.quoteCta,
        groupName: item.groupName,
        unit: item.unit,
        vatRate: item.defaultVatRate,
        costPriceVnd: item.defaultCostPriceVnd,
        markupPercent: item.defaultMarkupPercent,
        customerPriceVnd: resolveCatalogCustomerPrice(item),
        monthlyPriceVnd: item.monthlyPriceVnd,
        annualCommitMonthlyPriceVnd: item.annualCommitMonthlyPriceVnd,
        annualTotalPriceVnd: item.annualTotalPriceVnd,
        status: item.status,
        alreadyAdded: existingCatalogKeys.has(item.id),
      })),
    [catalogFlatItems, existingCatalogKeys]
  );
  function handleAddSelectedCatalogItems(ids: string[]) {
    const selectedItems = catalogFlatItems.filter(item => ids.includes(item.id));
    const dedupCount = catalogAdd.handleAddSelected(
      selectedItems.map(item => ({ key: item.id, item: catalogItemToQuoteItem(item), label: item.name }))
    );
    if (dedupCount === 0) setCatalogModalOpen(false);
  }

  function handleAddSelectedZoneItems(ids: string[]) {
    const selectedItems = (priceBookItems || []).filter(item => ids.includes(item.id));
    const dedupCount = zoneAdd.handleAddSelected(
      selectedItems.map(item => ({ key: item.id, item: priceBookItemToQuoteItem(item), label: item.name }))
    );
    if (dedupCount === 0) setCatalogModalOpen(false);
  }

  // Lam moi catalogTree SAU KHI tao san pham/nhom moi (QuickAddProductModal/
  // QuickAddGroupModal) - dung LAI DUNG API/cache-key voi openCatalogPicker()
  // (context='quote_picker' + quote?.id) de san pham/nhom vua tao "xuất hiện
  // ngay trong danh sách" voi DAY DU gia von/markup (khong phai ban rong).
  async function refreshCatalogTree(): Promise<ServiceCatalogItem[] | null> {
    try {
      const tree = await serviceCatalogRepository.list({
        context: 'quote_picker',
        quoteId: quote?.id,
        issuerCompanyId: draftCatalogIssuerCompanyId,
      });
      setCatalogTree(tree);
      setCatalogTreeQuoteId(quote?.id ?? null);
      return tree;
    } catch {
      // Giu nguyen cay cu neu lam moi loi - khong lam hong popup dang mo.
      return null;
    }
  }

  // "+ Nhóm sản phẩm" - nhom tao xong: lam moi cay + tu dong loc sang dung
  // nhom vua tao (rong, chua co san pham nao) de Sale "chuyển sang nhóm vừa
  // tạo và thêm sản phẩm ngay" nhu yeu cau, khong bat thoat popup.
  useEffect(() => {
    const needsBundlePricing = itemsDraft.some(item =>
      item.catalogItemId &&
      bundleSnapshotComponents(item).some(component =>
        component.showOnQuote !== false &&
        (component.defaultCostPriceVnd === undefined || component.defaultMarkupPercent === undefined || component.defaultCustomerPriceVnd === undefined)
      )
    );
    if (!needsBundlePricing) return;
    if (catalogTree && catalogTreeQuoteId === (quote?.id ?? null)) return;
    void refreshCatalogTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsDraft, catalogTree, catalogTreeQuoteId, quote?.id]);

  async function handleGroupCreated(created: ServiceCatalogItem) {
    await refreshCatalogTree();
    setPickerGroupFilter(created.name);
    setQuickAddGroupOpen(false);
    showToast(true, `Đã tạo nhóm "${created.name}".`);
  }

  // "+ Sản phẩm mới" (tu popup, them thanh DONG MOI) HOAC dau "+" canh 1
  // hang muc co san (chi GAN ID nguoc lai dong do, khong tao dong moi) - xem
  // giai thich quickAddProductTarget o khai bao state.
  async function hydrateQuickCreatedProduct(created: ServiceCatalogItem) {
    setCatalogHydratingItem(created);
    setCatalogHydrationRetryItem(null);
    setCatalogHydrationError(null);
    const tree = await refreshCatalogTree();
    if (!tree) {
      setCatalogHydrationError(`Không tải lại được giá của “${created.name}”.`);
      setCatalogHydrationRetryItem(created);
      setCatalogHydratingItem(null);
      setQuickAddProductTarget(null);
      return null;
    }
    const fetched = flattenCatalogTree(tree).find(item => item.id === created.id);
    if (!fetched) {
      setCatalogHydrationError(`Không tìm thấy “${created.name}” sau khi tạo.`);
      setCatalogHydrationRetryItem(created);
      setCatalogHydratingItem(null);
      setQuickAddProductTarget(null);
      return null;
    }
    // Response pricing cua QuickAdd la authoritative neu list bi cache cham;
    // response list lai bo sung group/issuer context. Khong de undefined tu
    // list ghi de mat bo gia vua luu thanh cong.
    const hydrated = {
      ...created,
      ...fetched,
      defaultCostPriceVnd: fetched.defaultCostPriceVnd !== undefined ? fetched.defaultCostPriceVnd : created.defaultCostPriceVnd,
      defaultMarkupPercent: fetched.defaultMarkupPercent !== undefined ? fetched.defaultMarkupPercent : created.defaultMarkupPercent,
      defaultCustomerPriceVnd: fetched.defaultCustomerPriceVnd !== undefined ? fetched.defaultCustomerPriceVnd : created.defaultCustomerPriceVnd,
    };
    setCatalogTree(current => current ? current.map(group => ({
      ...group,
      children: (group.children || []).map(item => item.id === hydrated.id ? hydrated : item),
    })) : tree);
    setCatalogHydratingItem(null);
    setCatalogHydrationRetryItem(null);
    return hydrated;
  }

  async function handleQuickAddProductCreated(created: ServiceCatalogItem) {
    const hydrated = await hydrateQuickCreatedProduct(created);
    if (!hydrated) return;
    if (quickAddProductTarget && typeof quickAddProductTarget === 'object') {
      const { linkIndex, locked } = quickAddProductTarget;
      if (locked) {
        // "k cần tạo phiên bản mới bro" - quote/version da khoa: VAN cho tao
        // san pham vao "Sản phẩm & dịch vụ" binh thuong (khong con bat qua
        // luong "Tạo phiên bản mới" nua), nhung KHONG ghi catalogItemId
        // nguoc lai dong hang muc cua version da khoa (giu nguyen bat bien
        // du lieu quote da duyet - dung tinh than yeu cau truoc do "có thể
        // cho tạo vào Sản phẩm & dịch vụ, nhưng không được ghi ngược ID vào
        // version đã khóa").
        showToast(true, `Đã tạo "${created.name}" vào Sản phẩm & dịch vụ. Báo giá đã khoá nên chưa liên kết vào hạng mục này.`);
        setQuickAddProductTarget(null);
        return;
      }
      setItemsDraft(prev => {
        const next = prev.map((row, i) => (i === linkIndex ? { ...row, catalogItemId: hydrated.id } : row));
        if (quote) void persistQuote({ items: next }, { silent: true });
        return next;
      });
      showToast(true, `Đã thêm "${created.name}" vào Sản phẩm & dịch vụ và liên kết với hạng mục này.`);
    } else {
      // 'newRow' - CHI tao san pham + tu tich chon trong Picker (van dang
      // mo), KHONG tu dong them vao bao gia (xem giai thich o khai bao
      // autoSelectCatalogItemId) - Sale tu bam "+ Thêm vào báo giá" khi da
      // san sang.
      setAutoSelectCatalogItemId(hydrated.id);
      showToast(true, `Đã tạo "${created.name}" và tự chọn trong danh sách — bấm "+ Thêm vào báo giá" khi sẵn sàng.`);
    }
    setQuickAddProductTarget(null);
  }

  function increaseExistingRowQty(existingIndex: number, addQuantity: number) {
    setItemsDraft(prev => {
      const next = prev.map((row, index) => (index === existingIndex ? { ...row, quantity: (row.quantity || 0) + (addQuantity || 1) } : row));
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }


  // "Nap tu bao gia gan nhat" - CHI hien CTA khi thuc su tim thay 1 bao gia
  // KHAC (cung deal) co hang muc that qua API that (getQuotes() + loc client
  // theo dealId) - khong bao gio bia san 1 nut "co ve nhu co du lieu".
  useEffect(() => {
    if (quote) return; // chi ap dung luc tao moi
    if (!draftDealId) {
      setRecentDealQuote(null);
      return;
    }
    let alive = true;
    seedingQuoteRepository
      .getQuotes()
      .then(all => {
        if (!alive) return;
        const candidates = all
          .filter(q => q.dealId === draftDealId && q.items && q.items.length > 0)
          .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
        setRecentDealQuote(candidates[0] || null);
      })
      .catch(() => {
        if (alive) setRecentDealQuote(null);
      });
    return () => {
      alive = false;
    };
  }, [draftDealId, quote]);

  function loadFromRecentQuote() {
    if (!recentDealQuote) return;
    // Yeu cau that: nap tu bao gia gan nhat CHI nap Gia von (costPrice) -
    // Markup/Gia khach la quyet dinh rieng cua Sale cho TUNG khach/deal,
    // KHONG duoc tu dong keo theo gia cu cua 1 khach/deal khac - Presale/Sale
    // luon phai tu dinh gia lai tu dau cho bao gia moi nay, chi do lai duoc
    // phan uoc luong ky thuat (gia von) da lam truoc do.
    const cloned = recentDealQuote.items.map(item => ({
      description: item.description,
      serviceDescription: item.serviceDescription,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: 0,
      discountPercent: item.discountPercent ?? 0,
      vatRate: item.vatRate ?? 10,
      costPrice: item.costPrice ?? null,
      markupPercent: null,
      catalogItemId: item.catalogItemId,
    }));
    const next = [...itemsDraft, ...cloned];
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  function removeItemRow(index: number) {
    const target = itemsDraft[index];
    // Xoa 1 Muc cha (Section) thi xoa LUON toan bo hang muc con thuoc nhom do
    // (khop hanh vi ON DELETE CASCADE tren parent_item_id da co san o DB tu
    // migration 063 - khong de lai hang muc "mo coi" khong thuoc nhom nao ma
    // nguoi dung khong co y dinh giu lai rieng).
    const next = target?.rowType === 'section' && target.id
      ? itemsDraft.filter((row, i) => i !== index && row.parentItemId !== target.id)
      : itemsDraft.filter((_, i) => i !== index);
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  // Markup nhanh (preset +15/20/25/30% hoac Tuy chinh) - CHI ap cho hang muc
  // THAT (row.costPrice != null da tu loai Muc cha, vi Muc cha luon co
  // costPrice=null). Neu >=1 dong da co markupPercent (da tung nhap gia
  // truoc do) thi phai xac nhan ghi de qua ConfirmModal (yeu cau rieng - benh
  // vien nhieu lan ghi de nham markup dang dung khi bam preset khac).
  function doApplyQuickMarkup(percent: number) {
    if (!isValidMarkupPercent(percent)) return;
    const next = itemsDraft.map(row =>
      row.costPrice != null ? { ...row, markupPercent: percent, unitPrice: Math.max(0, row.costPrice * (1 + percent / 100)) } : row
    );
    setItemsDraft(next);
    setLastAppliedMarkupPct(percent);
    setLastAppliedMarginPct(null);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }
  // Margin mục tiêu (KHOI PHUC - yeu cau rieng): suy nguoc gia khach tu
  // margin MUON DAT (margin = loi nhuan/gia khach, KHONG phai loi nhuan/
  // cost) - unitPrice = cost / (1 - margin/100), roi tu do suy lai
  // markupPercent (LUON chi luu markupPercent tren row, margin CHUA BAO GIO
  // luu rieng - chi tinh lai o render, xem bien `margin` trong vong lap
  // render ben duoi) - dam bao Markup/Margin khong bao gio mau thuan nhau vi
  // chi co DUY NHAT markupPercent la nguon that.
  function doApplyTargetMargin(marginPercent: number) {
    const next = itemsDraft.map(row => {
      if (row.costPrice == null) return row;
      const unitPrice = customerPriceFromTargetGrossMargin(row.costPrice, marginPercent);
      if (unitPrice == null) return row;
      return { ...row, unitPrice, markupPercent: marginPercent };
    });
    setItemsDraft(next);
    setLastAppliedMarginPct(marginPercent);
    setLastAppliedMarkupPct(null);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  const [markupApplyConfirm, setMarkupApplyConfirm] = useState<{ percent: number } | null>(null);
  function applyQuickMarkup(percent: number) {
    if (!isValidMarkupPercent(percent)) {
      window.alert('Markup phải từ -100% trở lên.');
      return;
    }
    const hasExisting = itemsDraft.some(row => row.costPrice != null && row.markupPercent != null);
    if (hasExisting) {
      setMarkupApplyConfirm({ percent });
      return;
    }
    doApplyQuickMarkup(percent);
  }

  const [marginApplyConfirm, setMarginApplyConfirm] = useState<{ percent: number } | null>(null);
  function applyTargetMargin(marginPercent: number) {
    if (!isValidTargetMarginPercent(marginPercent)) {
      window.alert('Margin phải trong khoảng 0% đến dưới 100%.');
      return;
    }
    const hasExisting = itemsDraft.some(row => row.costPrice != null && row.markupPercent != null);
    if (hasExisting) {
      setMarginApplyConfirm({ percent: marginPercent });
      return;
    }
    doApplyTargetMargin(marginPercent);
  }

  // Markup Tuy chinh (o nhap % rieng, canh cac nut preset - yeu cau rieng,
  // dung CHUNG applyQuickMarkup/doApplyQuickMarkup nhu preset, khong tach
  // logic rieng).
  const [markupCustomInput, setMarkupCustomInput] = useState('');
  // Margin Tuy chinh - tuong tu Markup Tuy chinh o tren.
  const [marginCustomInput, setMarginCustomInput] = useState('');
  // Highlight dung nut preset Markup/Margin vua ap de biet dang o muc nao - 2
  // nhom loai tru nhau (ap Markup thi bo highlight Margin va nguoc lai, vi 2
  // cach nhap khac nhau du cung chi ra 1 markupPercent duy nhat).
  const [lastAppliedMarkupPct, setLastAppliedMarkupPct] = useState<number | null>(null);
  const [lastAppliedMarginPct, setLastAppliedMarginPct] = useState<number | null>(null);

  // Thu gon Activity (yeu cau chung, khong rieng 1 stage) - mac dinh chi hien
  // ACTIVITY_COLLAPSED_LIMIT dong moi nhat, toggle "Xem tat ca (N)"/"Thu gon"
  // dung chung 1 state cho ca 2 panel Activity trong workspace.
  const [activityExpanded, setActivityExpanded] = useState(false);

  // CK tong (yeu cau rieng): TRUOC DAY co 1 o "CK tổng" trong quickbar tu
  // set `discountPercent` cho TUNG DONG (ap dung o buoc Thanh tien = subtotal
  // - subtotal*discountPercent/100 - xem lineSubtotal ben duoi) - BUG vi CK
  // tong lai am tham thay doi so lieu tung dong, trai voi yeu cau "CK tổng
  // chỉ giảm trên tổng tiền cuối báo giá, không đổi Markup/Giá khách/ĐV từng
  // dòng". Quote DA CO SAN dung 1 co che nay roi: cot `overall_discount_percent`
  // tren quotes (KHONG dung tren tung quote_items) - chi tru thang vao
  // `totalAmount` sau cung (xem "Giá sau giảm" o khoi Loi nhuan ben duoi, cung
  // dùng chính field nay) - XOA hang "CK tổng" cu (tung set discountPercent
  // tung dong) va THAY bang o nhap CUNG tro toi `quote.overallDiscountPercent`
  // ngay trong quickbar (ke Markup nhanh) de de thao tac, khong tao co che
  // thu 2 nao moi.

  const paymentTermsBlockDraft = quote?.data?.customBlocks?.find(b => b.kind === 'payment_terms');
  const paymentTermsDaysMatch = paymentTermsBlockDraft?.content.match(/(\d+)/);
  const [paymentTermsDays, setPaymentTermsDays] = useState('30');
  useEffect(() => {
    setPaymentTermsDays(paymentTermsDaysMatch ? paymentTermsDaysMatch[1] : '30');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  function applyPaymentTerms(days: string) {
    if (!quote) {
      // Che do tao moi: chua co quote.data that - giu tam o state rieng,
      // gop vao customBlocks that luc createRequest().
      setDraftPaymentTermsDays(days);
      return;
    }
    const blocks = [...(quote.data?.customBlocks || [])];
    const idx = blocks.findIndex(b => b.kind === 'payment_terms');
    const newBlock = {
      id: idx >= 0 ? blocks[idx].id : newBlockId(),
      kind: 'payment_terms' as const,
      title: 'Điều khoản thanh toán',
      content: `Thanh toán trong ${days} ngày kể từ ngày duyệt báo giá.`,
    };
    if (idx >= 0) blocks[idx] = newBlock;
    else blocks.push(newBlock);
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
  }

  // Popup nho canh nut "+ Điều khoản" (thay window.prompt() cu) - o nhap
  // ngay ke ben, khong con hop thoai native cua trinh duyet.
  const [termNotePopoverOpen, setTermNotePopoverOpen] = useState(false);
  const [termNoteInput, setTermNoteInput] = useState('');

  function submitTermNote() {
    const text = termNoteInput.trim();
    if (!text) return;
    if (!quote) {
      setDraftExtraTerms(prev => [...prev, { id: newBlockId(), title: 'Điều khoản', content: text }]);
    } else {
      const blocks = [...(quote.data?.customBlocks || []), { id: newBlockId(), kind: 'custom_field' as const, title: 'Điều khoản', content: text }];
      void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
    }
    setTermNoteInput('');
    setTermNotePopoverOpen(false);
  }

  // Danh sach dieu khoan bo sung da them (nut "+ Điều khoản") - hien NGAY
  // duoi quickbar kem Sửa/Xóa, ca 2 che do: che do tao moi doc draftExtraTerms
  // (chua ghi DB that), quote da ton tai doc thang tu quote.data.customBlocks
  // (kind='custom_field' - KHONG lay payment_terms/scope_of_work, 2 kind do
  // co UI rieng o cho khac).
  const extraTermsList = quote
    ? (quote.data?.customBlocks || []).filter(b => b.kind === 'custom_field').map(b => ({ id: b.id, title: b.title, content: b.content }))
    : draftExtraTerms;

  function editTermNote(id: string) {
    const current = extraTermsList.find(t => t.id === id);
    if (!current) return;
    const text = window.prompt('Sửa điều khoản:', current.content);
    if (text === null || !text.trim()) return;
    if (!quote) {
      setDraftExtraTerms(prev => prev.map(t => (t.id === id ? { ...t, content: text.trim() } : t)));
      return;
    }
    const blocks = (quote.data?.customBlocks || []).map(b => (b.id === id ? { ...b, content: text.trim() } : b));
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
  }

  function removeTermNote(id: string) {
    if (!quote) {
      setDraftExtraTerms(prev => prev.filter(t => t.id !== id));
      return;
    }
    const blocks = (quote.data?.customBlocks || []).filter(b => b.id !== id);
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
  }

  // The gon "Yeu cau & pham vi cong viec" cho bao gia DA TON TAI - hien tom
  // tat readonly (giong mockup), bam "Chinh sua" moi lo textarea. Luu vao
  // cung noi da dung o che do tao moi (customBlocks kind='scope_of_work' +
  // data.requestSummary) - KHONG tao co che luu rieng thu hai.
  const scopeBlock = quote?.data?.customBlocks?.find(b => b.kind === 'scope_of_work');
  const requestSummaryText = typeof quote?.data?.requestSummary === 'string' ? quote.data.requestSummary : '';
  // Bug da xac nhan (audit trude): expectedProducts duoc GHI luc tao quote
  // nhung khong co cho nao DOC lai sau khi quote da ton tai - them bien nay
  // + dua vao form Chinh sua/tom tat de nguoi dung con thay lai duoc.
  const expectedProductsText = typeof quote?.data?.expectedProducts === 'string' ? quote.data.expectedProducts : '';
  const [scopeEditing, setScopeEditing] = useState(false);
  const [editSummary, setEditSummary] = useState('');
  const [editScope, setEditScope] = useState('');
  // BUG THAT DA GAP ("card Yêu cầu & phạm vi đóng sẵn không mở được"): truoc
  // day `open` cua <details> duoc TINH LAI moi lan render (theo
  // editSummary/editScope hien tai) - component nay re-render RAT thuong
  // xuyen (autosave onBlur o hang chuc o input khac), nen ngay sau khi
  // nguoi dung bam mo tay, 1 render tiep theo (do 1 o BAT KY khac thay doi)
  // se tinh lai `open` va React DONG LAI NGAY, ghi de thao tac bam cua
  // nguoi dung. Fix: chi tinh gia tri MAC DINH 1 LAN duy nhat luc mount
  // (lazy initializer), sau do doc/ghi qua state rieng nay + onToggle - la
  // pattern dung de bien 1 <details> "uncontrolled tu nhien" thanh co the
  // set MAC DINH ban dau ma khong bi ep lai lien tuc.
  // Chot lai theo yeu cau ro rang cua nguoi dung: LUON mac dinh DONG (khong
  // con phan biet co/khong co du lieu nua) - "cần thì mới mở", tu bam mo khi
  // muon xem/sua lai.
  const [scopeCardOpen, setScopeCardOpen] = useState(false);
  // Card "Bàn giao kỹ thuật" - CHOT LAI LAN 3 (yeu cau ro rang "Khối này mặc
  // định đóng khi mở popup yêu cầu báo giá... Bàn giao kỹ thuật chỉ là tính
  // năng hỗ trợ, không phải điều kiện bắt buộc"): mac dinh DONG (dao nguoc
  // lai quyet dinh truoc do). Checklist trong card nay KHONG con dung de
  // chan Luu/Chuyen buoc/Ban giao/Duyet nua; card chi con la tinh nang ho tro.
  const [handoffCardOpen, setHandoffCardOpen] = useState(false);
  // "Kế hoạch thanh toán" - KHAC voi scope/handoff o tren (luon mac dinh
  // dong): card nay lien quan truc tiep den tien nen phai TU MO khi con
  // thieu/sai de Sale khong bo qua (yeu cau rieng) - dong bo lai theo dung
  // paymentPlan CUA QUOTE trong effect [quote?.id] ben duoi (cung ly do
  // "QuoteCenterPage khong unmount modal" nhu scopeCardOpen/handoffCardOpen).
  const [paymentPlanCardOpen, setPaymentPlanCardOpen] = useState(false);
  // Card "Hạng mục & giá khách" o ban tom tat quote da khoa (review/
  // approved/published) - yeu cau rieng "cho thu gon" - mac dinh dong,
  // giong "Yêu cầu & phạm vi".
  const [summaryItemsCardOpen, setSummaryItemsCardOpen] = useState(false);
  const [editExpectedProducts, setEditExpectedProducts] = useState('');
  // "Giới hạn xem link báo giá bằng Email hoặc Số điện thoại" (migration 118,
  // thay the checkbox+email don le cu) - state cuc bo cho khoi sua trong card
  // "Thông tin phát hành", dong bo lai TU quote moi lan doi quote?.id (cung
  // pattern voi scopeCardOpen/handoffCardOpen ben tren - QuoteCenterPage
  // khong unmount modal giua 2 lan mo quote khac nhau).
  const [accessMode, setAccessMode] = useState<'none' | 'email' | 'phone'>('none');
  const [accessEmailsText, setAccessEmailsText] = useState('');
  const [accessPhonesText, setAccessPhonesText] = useState('');
  const [accessSaving, setAccessSaving] = useState(false);
  useEffect(() => {
    setEditSummary(requestSummaryText);
    setEditScope(scopeBlock?.content || '');
    setEditExpectedProducts(expectedProductsText);
    setScopeEditing(false);
    // Dong bo lai mac dinh mo/dong THEO DUNG quote vua tai (chi chay 1 lan
    // khi doi quote, khong phai moi render - xem giai thich o khai bao
    // scopeCardOpen ben tren).
    setScopeCardOpen(false);
    // BUG THAT DA GAP ("Bàn giao kỹ thuật không mặc định đóng"): QuoteCenterPage
    // KHONG unmount QuoteWorkspaceModal giua 2 lan mo bao gia khac nhau (chi
    // doi prop quoteId) - component INSTANCE dung lai nguyen, nen state cuc
    // bo handoffCardOpen tung mo o bao gia A se "ro ri" sang bao gia B ke
    // tiep neu khong tu reset khi doi quote. Reset lai o DUNG effect nay
    // (chay moi lan quote?.id doi that su).
    setHandoffCardOpen(false);
    setSummaryItemsCardOpen(false);
    const currentPaymentPlan = quote?.data.paymentPlan || draftPaymentPlan;
    setPaymentPlanCardOpen(currentPaymentPlan.length === 0 || paymentPlanPercent(currentPaymentPlan) !== 100);
    // "set mặc định sẵn chọn Giới hạn theo Số điện thoại trước" (feedback
    // 2026-09-24) - quote CHUA TUNG luu publicAccessMode (chua ai chon gi ca,
    // gia tri falsy) mac dinh hien 'phone' thay vi 'none' - Sale van doi
    // duoc sang 3 che do binh thuong qua radio ben duoi, quote DA TUNG luu
    // 'none' ro rang truoc do (that su ="Không giới hạn") KHONG bi doi lai.
    // (Cot DB luon NOT NULL - mac dinh 'phone' + backfill quote cu nam o
    // migration 149, fallback `|| 'phone'` chi con la luoi an toan.)
    setAccessMode(quote?.publicAccessMode || 'phone');
    setAccessEmailsText((quote?.publicAllowedEmails || []).join('\n'));
    // Danh sach SDT rong o che do 'phone' -> backend get_public_quote() dung
    // SDT khach hang tren bao gia (data.customerPhone) de doi chieu, hien san
    // dung so do o day de Sale thay dung so dang duoc phep xem.
    const storedPhones = (quote?.publicAllowedPhones || []).join('\n');
    const fallbackPhone = typeof quote?.data?.customerPhone === 'string' ? quote.data.customerPhone.trim() : '';
    setAccessPhonesText(storedPhones || fallbackPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  async function saveAccessRestriction() {
    if (!quote) return;
    const emails = accessEmailsText.split(/[\n,;]/).map(e => e.trim()).filter(Boolean);
    const phones = accessPhonesText.split(/[\n,;]/).map(p => p.trim()).filter(Boolean);
    setAccessSaving(true);
    try {
      // BUG THAT DA GAP ("tắt giới hạn nhưng vẫn yêu cầu Email"): fix o day la
      // CHI gui dung 1 `mode` duy nhat (enum) - khong con gui song song 1
      // boolean rieng nen KHONG the xay ra truong hop "tat qua duong nay
      // nhung code khac van doc co cu". Khi mode==='none', backend tu bo qua
      // moi kiem tra Email/SDT (xem get_public_quote()) - khach mo tab an
      // danh la xem duoc ngay, khong con man hinh xac minh nao ca.
      const updated = await seedingQuoteRepository.setPublicAccessRestriction(quote.id, accessMode, emails, phones);
      setQuote(updated);
      showToast(true, 'Đã lưu cấu hình giới hạn xem link.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được cấu hình giới hạn xem link.');
    } finally {
      setAccessSaving(false);
    }
  }

  async function saveScopeSummary() {
    if (!quote) return;
    const blocks = [...(quote.data?.customBlocks || [])];
    const idx = blocks.findIndex(b => b.kind === 'scope_of_work');
    if (editScope.trim()) {
      const newBlock = { id: idx >= 0 ? blocks[idx].id : newBlockId(), kind: 'scope_of_work' as const, title: 'Mô tả scope / yêu cầu cần estimate', content: editScope.trim() };
      if (idx >= 0) blocks[idx] = newBlock;
      else blocks.push(newBlock);
    } else if (idx >= 0) {
      blocks.splice(idx, 1);
    }
    await persistQuote({
      data: { ...quote.data, customBlocks: blocks, requestSummary: editSummary.trim() || undefined, expectedProducts: editExpectedProducts.trim() || undefined },
    }, { silent: true });
    setScopeEditing(false);
  }

  const agentsById = useMemo(() => new Map(agents.map(agent => [agent.id, agent.name])), [agents]);
  function nameFor(id?: string | null): string {
    if (!id) return 'Chưa gán';
    if (id === user?.id && user?.name) return repairUtf8Mojibake(user.name);
    const roleUser = businessRoleUsersById.get(id);
    if (roleUser) return ownerOptionLabel(roleUser);
    const agentName = agentsById.get(id);
    return agentName ? repairUtf8Mojibake(agentName) : 'Không rõ';
  }

  async function load(id: string, opts?: { silent?: boolean }) {
    // "silent" - dung cho reload() sau 1 thao tac nho (gan nguoi phu trach,
    // sua 1 field...) - KHONG duoc bat lai "loading" toan man hinh (truoc day
    // luon bat, khien ca form bi thay bang "Đang tải báo giá..." roi hien lai
    // - giat/nhay y het load lai trang, du chi doi 1 truong nho). Chi lan tai
    // DAU TIEN (mo modal) moi can man hinh loading day du.
    if (!opts?.silent) setLoading(true);
    try {
      const [q, log, hc] = await Promise.all([
        seedingQuoteRepository.getQuote(id),
        seedingQuoteRepository.getQuoteActivityLog(id).catch(() => []),
        seedingQuoteRepository.getQuoteHandoffChecklist(id).catch(() => null),
      ]);
      setQuote(q);
      setActivity(log);
      setChecklist(hc);
      setChecklistDraft(hc || emptyChecklist());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được báo giá.');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  // Chi can kiem tra "da co draft moi hon" khi quote dang xem la approved
  // (chi luc nay nut "Tao phien ban moi" moi enable) - khong goi cho draft/
  // request/technical/pricing/review (chua the tao version moi tu do).
  useEffect(() => {
    let cancelled = false;
    if (!quote || quote.status !== "approved") {
      setExistingDraftVersion(null);
      return;
    }
    seedingQuoteRepository.getQuoteVersions(quote.id).then(versions => {
      if (cancelled) return;
      const draft = versions.find(v => v.status === "draft" && (v.versionNumber || 1) > (quote.versionNumber || 1)) || null;
      setExistingDraftVersion(draft);
    }).catch(() => {
      if (!cancelled) setExistingDraftVersion(null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, quote?.status, quote?.versionNumber]);

  useEffect(() => {
    if (quoteId) {
      void load(quoteId);
    } else {
      setQuote(null);
      setActivity([]);
      setChecklist(null);
      setChecklistDraft(emptyChecklist());
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Danh sach Khach hang (ho so crm_customers that, KHAC voi Deal/Co hoi) -
  // chi can khi mo o che do tao moi. page_size lon vi list nay chi dung de
  // loc nhanh trong 1 dropdown local (giong cach `deals` cua ca trang da
  // load full roi loc client-side), khong phan trang server.
  useEffect(() => {
    if (quoteId) return;
    let alive = true;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers?page=1&page_size=200`, { credentials: 'include', headers })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'load failed');
        return body.data as {
          items?: Array<{
            id: string;
            customer_name?: string;
            company_name?: string;
            phone?: string;
            email?: string;
            address?: string;
            tax_code?: string;
          }>;
        };
      })
      .then(data => {
        if (!alive) return;
        setCustomers(
          (data.items || []).map(row => ({
            id: row.id,
            label: `${row.customer_name || 'Khách hàng chưa tên'}${row.company_name ? ' · ' + row.company_name : ''}`,
            name: row.customer_name,
            companyName: row.company_name,
            phone: row.phone,
            email: row.email,
            address: row.address,
            taxCode: row.tax_code,
          }))
        );
      })
      .catch(() => {
        if (alive) setCustomers([]);
      });
    return () => {
      alive = false;
    };
  }, [quoteId]);

  // "deal"/effectiveCustomerIdForProjects va useEffect ngay duoi day PHAI
  // dung TRUOC bat ky early return nao (vd "if (loading) return" ben duoi) -
  // Rules of Hooks: 1 useEffect nam SAU 1 return co dieu kien se bi SKIP tren
  // nhung render co dieu kien do dung (vd loading=true giua luc load(id) sau
  // khi tao bao gia), gay loi that "change in the order of Hooks" (bug that
  // da xay ra khi bam Luu nhap/Gui yeu cau xu ly trong che do tao moi).
  const deal = quote?.dealId ? effectiveDealsById.get(quote.dealId) : draftDealId ? effectiveDealsById.get(draftDealId) : undefined;

  function selectDraftCustomer(value: string) {
    setDraftCustomerId(value);
    if (value) clearRequiredError('customer');
    // Doi khach hang -> co hoi da chon (neu co) co the khong con thuoc
    // khach hang moi - bo chon de tranh luu sai lech.
    if (draftDealId && effectiveDealsById.get(draftDealId)?.customerId !== value) setDraftDealId('');
    // Du an cung thuoc DUNG 1 khach hang - doi khach hang thi bo chon Du an cu.
    setDraftProjectId('');
  }

  async function handleCustomerCreated(customerId: string) {
    setCustomerDrawerOpen(false);
    selectDraftCustomer(customerId);
    try {
      const nextCustomers = await loadQuoteCustomerOptions();
      if (nextCustomers.some(customer => customer.id === customerId)) {
        setCustomers(nextCustomers);
        return;
      }
      const createdCustomer = await loadQuoteCustomerOption(customerId);
      if (createdCustomer) setCustomers(prev => [createdCustomer, ...prev.filter(customer => customer.id !== customerId)]);
    } catch {
      // Khong chan flow tao bao gia: customer vua tao van duoc gan vao draft,
      // list dropdown se nap lai o lan mo sau neu fetch tam thoi loi.
    }
  }

  // Goi y + tu dien email/SDT khach hang cua chinh quote nay (cung nguon voi
  // autofill customerEmail/customerPhone luc tao quote o tren - uu tien ho so
  // Khach hang that, fallback ve Co hoi) - dung de goi y khi Sale bat 1 trong
  // 2 che do gioi han o card "Thông tin phát hành" ma chua nhap gi ca, KHONG
  // tu dong ghi de neu da co du lieu nguoi dung tung nhap.
  const suggestedCustomerEmail = useMemo(() => {
    const customerId = deal?.customerId || draftCustomerId;
    const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
    return customerRecord?.email || deal?.email || '';
  }, [deal, draftCustomerId, customers]);
  const suggestedCustomerPhone = useMemo(() => {
    const customerId = deal?.customerId || draftCustomerId;
    const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
    return customerRecord?.phone || deal?.phone || '';
  }, [deal, draftCustomerId, customers]);

  function setAccessModeAndSuggest(mode: 'none' | 'email' | 'phone') {
    setAccessMode(mode);
    if (mode === 'email' && !accessEmailsText.trim() && suggestedCustomerEmail) {
      setAccessEmailsText(suggestedCustomerEmail);
    } else if (mode === 'phone' && !accessPhonesText.trim() && suggestedCustomerPhone) {
      setAccessPhonesText(suggestedCustomerPhone);
    }
  }

  // Du an cascade THEO KHACH HANG that (Khach hang -> Du an -> Co hoi) - chua
  // biet khach hang (create-mode chua chon, hoac quote da ton tai khong gan
  // Co hoi nao) thi Project luon rong ([]) - disable dropdown, KHONG goi API
  // vo ich.
  const effectiveCustomerIdForProjects = quote ? deal?.customerId : draftCustomerId;
  useEffect(() => {
    if (!effectiveCustomerIdForProjects) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    setProjects(null);
    projectsService.list(effectiveCustomerIdForProjects).then(res => {
      if (!cancelled) setProjects(res.success ? (res.data || []) : []);
    }).catch(() => { if (!cancelled) setProjects([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCustomerIdForProjects]);

  const status = quote ? quoteDisplayStatus(quote, deal) : { key: 'draft' as const, label: 'Yêu cầu mới', className: 'qc-badge-amber' };
  const canEdit = quote ? canWriteDeal(user, deal) || canApproveQuote(user) : true;
  const canApprove = canApproveQuote(user);
  // Admin/leader (dung cho cac cho KHONG lien quan quy tac phe duyet, vd
  // NoStaffConfigured Presale/Sale ben duoi - tach rieng khoi
  // canManageApprovalRules de doi rieng gia tri kia khong lam sai cho nay).
  const isAdminOrLeader = user?.role === 'admin' || user?.role === 'leader';
  // Mirror can_manage_quote_approval_rules() o backend (SUA LAI: chi Admin,
  // khong con Leader) - CHI dung de hien goi y trong card "Quy tắc phê
  // duyệt", sua that da chuyen het sang trang "Cài đặt báo giá" rieng.
  const canManageApprovalRules = user?.role === 'admin';
  const businessCode = deal ? dealBusinessCode(deal) : null;
  const opportunityName = deal ? getServicePackageText(deal.servicePackage) || getPackageText(deal.package) : '';
  const stage = quote?.processingStage || 'request';
  const isDraft = quote ? quote.status === 'draft' : true;
  const isCancelled = quote ? status.key === 'lost' : false;
  const hasCostData = Boolean(quote?.hasCostData);
  // Bang hang muc THONG NHAT (Section 4) - 1 bang duy nhat, KHONG con toggle
  // 2 giao dien roi (Thong tin ky thuat / Gia ban) khien Sale khong doi chieu
  // duoc gia von + markup CUNG dong. Cot Gia von luon hien thi tren CUNG dong
  // voi cot Markup/Gia khach; editable/read-only tach theo QUYEN THAT (mirror
  // backend can_edit_technical_quote/can_edit_quote_pricing), KHONG theo tab
  // nguoi dung tu bam. Backend van la lop chan that qua
  // _check_item_field_level_permission - day chi la UX.
  // stage 'review' = dang cho Admin duyet/tra ve - KHONG ai (ke ca Presale/
  // Sale) duoc sua hang muc nua, chi Admin xem READ-ONLY + quyet dinh duyet/
  // tra ve (dung yeu cau "Review/Admin: hien thi Cost+Pricing+Profitability
  // dang read-only"). Sau 'review' (approved) da tu khoa qua isDraft roi.
  const isLockedForReview = stage === 'review';
  // Khoa theo BUOC (moi, SUA LAI lan 2: bo han ngoai le Admin/Leader - khoa
  // that cho TAT CA, khong con bypass): Buoc 1 (request) chi dien Hang
  // muc+SL, CHUA duoc dien Gia von (tu Buoc 2 - technical - tro di moi
  // duoc); Markup/Gia khach CHI dien duoc dung o Buoc 3 (pricing). Backend
  // enforce lai y het qua _check_item_field_level_permission - day chi la
  // UX, khong phai lop chan that.
  // Che do TAO MOI (!quote) gio la man hinh GOP Buoc 1+2 - Gia von phai dien
  // duoc ngay tai day (khong con man "Thong tin ky thuat" rieng nua), du
  // `stage` fallback ve 'request' khi chua co quote that. Quote CU da ton
  // tai nhung con ket o 'request' (truoc khi co thay doi nay) van GIU khoa
  // cho toi khi tu chuyen qua nut "Gửi yêu cầu xử lý" (duong lui cu, xem
  // footer) - tranh mo khoa nham cho du lieu cu chua qua luong moi.
  // Bao gia VERSION MOI (V2, V3...) la BAN SAO cua 1 bao gia DA DUYET - da co
  // san Gia von/Markup/Gia khach day du tu ban nguon ngay luc tao (khong phai
  // rong nhu bao gia tao moi tu dau) - yeu cau nguoi dung xac nhan ro (khong
  // doan): cho sua gia NGAY o Buoc 1 khi tao V2, KHONG bat di lai tu dau
  // luong "Bàn giao kỹ thuật -> Hoàn thiện giá bán" nhu bao gia tao moi hoan
  // toan. Chi ap dung cho quote CO version_number > 1 (that su la 1 phien
  // ban tiep theo trong chuoi) - quote V1/tao moi van giu dung khoa theo
  // stage nhu cu, tranh sua gia non khi chua qua xac nhan ky thuat.
  const isVersionedQuote = (quote?.versionNumber || 1) > 1;
  const costStageOk = true;
  const pricingStageOk = stage === 'pricing' || isVersionedQuote;
  const canEditCostCells = canEdit && isDraft && !isLockedForReview && canEditQuoteCost(user, quote) && costStageOk;
  const canEditPricingCells = canEdit && isDraft && !isLockedForReview && canEditQuotePricingFields(user, quote) && pricingStageOk;
  // "Loai bao gia" (yeu cau rieng, sua lai 2026-09-24): truoc day chi khoa o
  // stage 'review' nen Presale VAN sua duoc luc con o Buoc 1 (bug nguoi dung
  // phat hien qua screenshot thuc te) - day la phan loai thuong mai giong
  // Don vi phat hanh/Du an ("Presale không làm phần thương mại"), doi sang
  // dung chung pricingStageOk voi cac field thuong mai khac, chi Sale sua
  // duoc tu Buoc 2 tro di.
  const canEditQuoteType = canEdit && !isLockedForReview && pricingStageOk;
  // "Presale không làm phần thương mại" (feedback 2026-09-24) - cac khoi
  // thuong mai (Dự án/Kế hoạch thanh toán...) chi hien tu Buoc 2 (pricing)
  // tro di, AN het khoi Presale luc con o Buoc 1 (request/technical) hoac
  // dang tao yeu cau (!quote). isVersionedQuote van cho hien (giong
  // pricingStageOk) vi tao V2+ la Sale lam lai tu dau, khong qua lai Buoc 1.
  const beyondStep1 = Boolean(quote) && (stage !== 'request' && stage !== 'technical' || isVersionedQuote);
  // BUG THAT DA GAP: zonePickerItems truoc day khai bao O TREN (gan
  // catalogPickerItems, ~dong 1248) - nhung lai doc canEditCostCells (khai
  // bao O DUOI, dong nay) ngay trong THAN useMemo, chay NGAY LUC RENDER nen
  // bi crash "Cannot access 'canEditCostCells' before initialization" (Runtime
  // ReferenceError, phat hien khi mo tab "Bảng giá VPS Zone" trong Catalog
  // Picker). Chuyen useMemo nay xuong DAY, SAU khi canEditCostCells da khoi
  // tao xong, va them canEditCostCells vao dependency array (truoc day thieu,
  // se khong re-tinh khi quyen thay doi).
  const zonePickerItems: CatalogPickerListItem[] = useMemo(
    () =>
      (priceBookItems || []).map(item => {
        const preview = previewPriceBookItem({
          costMode: item.costMode,
          unitPriceUsd: item.unitPriceUsd,
          exchangeRate: item.exchangeRate,
          unitPriceVndDirect: item.unitPriceVndDirect,
          importDutyPercent: item.importDutyPercent,
          vatInPercent: item.vatInPercent,
          vatEuPercent: item.vatEuPercent,
          defaultQuantity: item.defaultQuantity,
          defaultRatePercent: item.defaultRatePercent,
          referencePrice: item.referencePrice,
        });
        return {
          id: item.id,
          sku: item.sku,
          name: item.name,
          description: item.description,
          groupName: item.sourceSheet?.startsWith('1.') ? 'Mục I' : item.sourceSheet?.startsWith('2.') ? 'Mục II' : undefined,
          unit: item.unit,
          vatRate: item.vatEuPercent,
          // Bang gia VPS Zone da co san gia von/Rate THAT (khac danh muc noi
          // bo truoc day khong co khai niem cost) - hien luon trong Picker
          // giong het danh muc noi bo, van gate theo canEditCostCells
          // (undefined = an han neu khong du quyen, dung PATTERN da dung o
          // priceBookItemToQuoteItem()).
          costPriceVnd: canEditCostCells ? preview.costUnit ?? null : undefined,
          markupPercent: canEditCostCells ? item.defaultRatePercent ?? null : undefined,
          customerPriceVnd: preview.unitPrice || 0,
          // Lop XEM QUY DOI USD (tham khao) - da tinh THAT o backend bang
          // Decimal (attach_usd_conversion(), price_book_service.py), chi
          // truyen qua day, KHONG tu tinh lai o FE. costPriceUsd gate giong
          // costPriceVnd; customerPriceUsd/exchangeRate KHONG gate (backend
          // da tu strip exchangeRate rieng cho nguoi khong du quyen xem gia
          // von, customerPriceUsd van tinh dung du co bi strip exchangeRate
          // hay khong).
          costPriceUsd: canEditCostCells ? item.costUsd ?? null : undefined,
          customerPriceUsd: item.customerPriceUsd ?? null,
          exchangeRate: item.exchangeRate ?? null,
          alreadyAdded: existingZoneKeys.has(item.id),
        };
      }),
    [priceBookItems, existingZoneKeys, canEditCostCells]
  );
  // "Chưa có/Chưa tính" (khong du du lieu) khac "Không có quyền xem" (bi
  // chan boi apply_quote_field_permissions o backend) - quote moi (chua co
  // quote.id, dang tao) mac dinh coi la duoc xem/sua (draft cua chinh minh).
  const costViewAllowed = quote ? quote.costViewAllowed !== false : true;
  const pricingViewAllowed = quote ? quote.pricingViewAllowed !== false : true;
  const profitabilityViewAllowed = quote ? quote.profitabilityViewAllowed !== false : true;

  // Sau khi chon Co hoi CRM (che do tao moi), tu dien cac field nghiep vu tu
  // CHINH Deal that (khong bia noi dung) - CHI dien field dang TRONG, hoi xac
  // nhan truoc khi ghi de field da co du lieu nguoi dung tu nhap. Deal khong
  // co du lieu cho field nao thi bao ro that (khong de trang im lang khien
  // tuong nut khong hoat dong - dung phan hoi UI da xac nhan can sua).
  function handleSelectDeal(dealId: string) {
    if (dealId === CREATE_NEW_DEAL_OPTION) {
      setDealCreateError('');
      setDealModalOpen(true);
      return;
    }
    setDraftDealId(dealId);
    if (dealId) clearRequiredError('deal');
    const selected = dealId ? effectiveDealsById.get(dealId) : undefined;
    // Co hoi da co san Du an -> tu chon dung Du an do (dung yeu cau "Chon
    // Opportunity co project_id: tu chon dung Project").
    if (selected?.projectId) setDraftProjectId(selected.projectId);
    if (!selected) return;

    const needSummary = selected.note?.trim() || selected.nextStep?.trim() || '';
    const needProducts = getServicePackageText(selected.servicePackage) || getPackageText(selected.package) || '';
    let filledAny = false;

    if (needSummary) {
      if (!draftSummary.trim()) {
        setDraftSummary(needSummary);
        filledAny = true;
      } else if (draftSummary.trim() !== needSummary && window.confirm('Tóm tắt nhu cầu đã có nội dung bạn tự nhập. Ghi đè bằng dữ liệu thật từ cơ hội này?')) {
        setDraftSummary(needSummary);
        filledAny = true;
      }
    }
    if (needProducts) {
      if (!draftExpectedProducts.trim()) {
        setDraftExpectedProducts(needProducts);
        filledAny = true;
      } else if (draftExpectedProducts.trim() !== needProducts && window.confirm('Sản phẩm/dịch vụ dự kiến đã có nội dung bạn tự nhập. Ghi đè bằng dữ liệu thật từ cơ hội này?')) {
        setDraftExpectedProducts(needProducts);
        filledAny = true;
      }
    }

    setAutofillMessage(filledAny ? 'Đã nạp thông tin từ cơ hội' : 'Cơ hội chưa có thông tin phạm vi/hạng mục');
    window.setTimeout(() => setAutofillMessage(''), 4000);
  }

  async function createRequest(submitFully: boolean) {
    // Gop Buoc 1 (Yeu cau bao gia) + Buoc 2 (Thong tin ky thuat) lam MOT -
    // cung 1 nguoi (thuong la Presale) dien hang muc VA gia von ngay tai day.
    // 2 nut goi ham nay: header "Lưu / Chỉnh sửa" (submitFully=false, CHI luu
    // ban nhap, giu nguyen o 'request', KHONG bat SLA) va footer "Bàn giao"
    // (submitFully=true, luu VA tu chuyen sang 'technical' ngay, bat dau SLA).
    if (!validateRequiredWorkspaceFields()) return;
    // Bam "Bàn giao" (submitFully=true) la muon chuyen sang buoc 2 ngay -
    // backend (set_quote_processing_stage) bat buoc phai co sla_due_at hop
    // le (da dat + con trong tuong lai) moi cho chuyen buoc, neu khong se
    // chan luon o day thay vi tao xong quote roi lang le "ket" o buoc 1 (bug
    // that da gap: Sale bam Bàn giao nhung khong thay gi doi, phai tu bam
    // nut du phong "Gửi yêu cầu xử lý" moi hieu ra vi sao).
    setActiveAction(submitFully ? 'handoff' : 'draftSave');
    setBusy(true);
    try {
      const legacyBlocks = [
        ...(draftScope.trim()
          ? [{ id: newBlockId(), kind: 'scope_of_work' as const, title: 'Mô tả scope / yêu cầu cần estimate', content: draftScope.trim() }]
          : []),
        // Dieu khoan thanh toan/bo sung nguoi dung da nhap TRUOC khi quote
        // that ton tai (che do tao moi) - gop vao cung luc tao, khong bat
        // nguoi dung phai lam lai sau khi luu.
        {
          id: newBlockId(),
          kind: 'payment_terms' as const,
          title: 'Điều khoản thanh toán',
          content: `Thanh toán trong ${draftPaymentTermsDays} ngày kể từ ngày duyệt báo giá.`,
        },
        ...draftExtraTerms.map(t => ({ id: t.id, kind: 'custom_field' as const, title: t.title, content: t.content })),
      ];
      const customBlocks = [...legacyBlocks.filter(block => !draftCustomBlocks.some(b => b.kind !== 'custom_field' && b.kind === block.kind)), ...draftCustomBlocks].filter(b => b.content.trim());
      const createData: QuoteData = {
        quoteTitle: draftTitle.trim() || 'Yêu cầu hỗ trợ báo giá',
        customBlocks,
        paymentPlan: draftPaymentPlan,
        ...(draftVisibleColumns ? { visibleColumns: draftVisibleColumns } : {}),
        ...(draftVisibleSummaryFields ? { visibleSummaryFields: draftVisibleSummaryFields } : {}),
        ...(draftVisibleCustomerFields ? { visibleCustomerFields: draftVisibleCustomerFields } : {}),
        ...(draftPrintLayoutPrefs ? { printLayoutPrefs: draftPrintLayoutPrefs } : {}),
        // Field noi bo rieng cho luong "Yeu cau ho tro bao gia" - KHONG phai
        // customBlocks (customBlocks la du lieu hien cho khach qua public
        // link/PDF) - luu truc tiep vao `data` (JSONB schema-less, khong can
        // migration) de khong bao gio lo ra ban khach hang.
        requestSummary: draftSummary.trim() || undefined,
        expectedProducts: draftExpectedProducts.trim() || undefined,
        internalRequestNote: draftInternalNote.trim() || undefined,
        // BUG that da fix: khoi "THONG TIN KHACH HANG" tren ban khach truoc
        // day luon rong ([Kinh gui]/[Khach hang]...) du da chon dung Khach
        // hang/Co hoi o tren, vi day la field text tu do rieng cua tung
        // quote (data.customerRecipient...), KHONG tu dong lay tu ho so CRM
        // - copy san tu `deal`/Khach hang da chon luc tao, Sale van sua lai
        // duoc binh thuong neu can khac di.
        // BUG THAT DA GAP LAN 2 ("autofill thi bien mat"): `deal` (Co hoi,
        // bang customer_leads) chi la ban ghi pipeline, cot phone/email/
        // tax_code cua no THUONG XUYEN de trong (Sale khong nhap lai) - chi
        // co address la hay duoc dien. Ho so Khach hang that (crm_customers,
        // tim qua `customers` da fetch o tren) moi la noi luu day du SDT/
        // Email/MST/Dia chi that su - uu tien ho so Khach hang lam nguon
        // chinh, CHI fallback ve field cua deal khi Khach hang khong co du
        // lieu (vd deal.address con nhap tay rieng khac dia chi ho so).
        ...(() => {
          const customerId = deal?.customerId || draftCustomerId;
          const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
          if (!deal && !customerRecord) return {};
          // (Redesign Buoc 1) "Kính gửi"/SĐT/Email UU TIEN snapshot tu Contact
          // THAT da chon o dropdown "Người liên hệ" (draftRecipientFields, tu
          // dong dien theo Contact hoac sua tay qua popover "Chỉnh thông tin
          // hiển thị") - CHI fallback ve ten Khach hang/Deal khi chua co
          // Contact nao duoc chon (vd khach hang chua co Contact nao trong
          // CRM) - KHONG con luon uu tien ten ho so Khach hang nhu truoc day
          // (bug that da gap, xem quoteDraftFromForm.ts).
          const displayName = draftRecipientFields.customerRecipient.trim() || customerRecord?.name || deal?.customerName;
          return {
            customerRecipient: displayName || undefined,
            customerCompanyName: customerRecord?.companyName || deal?.companyName || undefined,
            customerContactName: displayName || undefined,
            customerAddress: customerRecord?.address || deal?.address || undefined,
            customerPhone: draftRecipientFields.customerPhone.trim() || customerRecord?.phone || deal?.phone || undefined,
            customerEmail: draftRecipientFields.customerEmail.trim() || customerRecord?.email || deal?.email || undefined,
            customerTaxCode: customerRecord?.taxCode || deal?.taxCode || undefined,
            // Snapshot id Contact THAT (crm_contacts.id) da chon luc tao bao
            // gia nay - CHI de tham chieu/debug, KHONG dung de doc lai song
            // (mirror dung pattern quoteDraftFromForm.ts).
            customerContactId: draftContactId || undefined,
          };
        })(),
      };
      // "Đơn vị phát hành" (redesign Buoc 1) - snapshot THONG TIN cong ty ban
      // (sellerCompanyName/...) + Dieu khoan thanh toan mac dinh cua don vi do
      // (chi ap dung neu block 'payment_terms' con RONG - applyIssuerPaymentTermsSnapshot
      // tu tra ve som neu legacyBlocks o tren da dien san noi dung) - dung
      // LAI 2 helper co san (types.ts), KHONG viet lai logic snapshot rieng.
      if (effectiveIssuerCompany) {
        applyIssuerCompanySnapshot(createData, effectiveIssuerCompany);
        applyIssuerPaymentTermsSnapshot(createData, effectiveIssuerCompany, issuerCompanies);
      }
      const created = await seedingQuoteRepository.createQuote({
        dealId: draftDealId,
        // Da validate o tren (!draftFormId && !defaultFormId -> return som) -
        // toi day chac chan co 1 trong 2 gia tri, an toan non-null assert.
        quoteFormId: (draftFormId || defaultFormId)!,
        // BUG THAT DA GAP: truoc day KHONG gui issuer_company_id luc tao quote
        // (backend create_quote() luu thang payload.get("issuer_company_id"),
        // KHONG tu suy tu mau bao gia) - moi bao gia tao qua Workspace nay bi
        // issuer_company_id=NULL vinh vien, ban PDF/khach mat het thong tin
        // cong ty phat hanh (sellerCompanyName...) du da "chon" o dropdown moi.
        issuerCompanyId: effectiveIssuerCompanyId || undefined,
        projectId: draftProjectId || null,
        slaDueAt: datetimeLocalValueToIso(draftSlaDueAt),
        quoteTypeCodes: draftQuoteTypeCodes,
        data: createData,
        // Hang muc da nhap truoc khi quote that ton tai (che do tao moi) -
        // gui luon cung luc tao, KHONG bat nguoi dung phai luu roi moi duoc
        // nhap hang muc (yeu cau da xac nhan).
        items: buildItemsPayload(itemsDraft),
      });
      // Hai vai tro nay la bat buoc tren form. Khong fallback ngam ve nguoi
      // dang dang nhap, vi nhu vay du lieu luu khac voi lua chon hien tren UI.
      const resolvedTechnicalOwnerId = draftTechnicalOwnerId;
      const resolvedQuoteOwnerId = draftQuoteOwnerId;
      if (resolvedTechnicalOwnerId || resolvedQuoteOwnerId) {
        await seedingQuoteRepository.assignQuoteOwners(created.id, {
          technicalOwnerId: resolvedTechnicalOwnerId || undefined,
          quoteOwnerId: resolvedQuoteOwnerId || undefined,
        });
      }
      // submitFully=true (nut "Bàn giao"): tu dong chuyen processing_stage tu
      // 'request' -> 'technical' ngay sau khi tao - day chinh la moc SLA bat
      // dau tinh (sla_started_at chi set o lan dau request->technical, xem
      // set_quote_processing_stage). SLA da duoc validate hop le O TREN
      // (truoc khi tao quote) khi submitFully=true, nen toi day chac chan
      // chuyen buoc duoc - khong con nhanh "im lang bo qua" nua. submitFully
      // =false (nut header "Lưu / Chỉnh sửa"): CHI luu ban nhap, KHONG chuyen
      // buoc - giu nguyen o 'request' de Sale con sua thoai mai.
      let advancedToTechnical = false;
      if (submitFully) {
        try {
          await seedingQuoteRepository.setQuoteProcessingStage(created.id, 'technical');
          advancedToTechnical = true;
        } catch (stageErr) {
          window.alert(
            (stageErr instanceof Error ? stageErr.message : 'Không chuyển được sang bước Thông tin kỹ thuật.') +
              ' Báo giá đã được lưu — bạn có thể tự bấm "Bàn giao" trong workspace sau khi sửa.'
          );
        }
      }
      await onChanged();
      // Sale co the da tick san checklist ban giao (Scope/Cost/Timeline/
      // Assumption) NGAY tu luc con o Buoc 1, TRUOC khi quote tu tao xong -
      // luu lai truoc khi load() ben duoi lam mat (load() luon nap checklist
      // THAT tu server, luc nay chi la record rong vua tao, se de mat trang
      // tick cuc bo neu khong luu lai truoc).
      const pendingChecklist = checklistDraft;
      const hasChecklistInput = Boolean(
        pendingChecklist.scopeConfirmed || pendingChecklist.costConfirmed ||
        pendingChecklist.timelineConfirmed || pendingChecklist.assumptionConfirmed ||
        pendingChecklist.scopeNote?.trim() || pendingChecklist.costNote?.trim() ||
        pendingChecklist.timelineNote?.trim() || pendingChecklist.assumptionNote?.trim() ||
        pendingChecklist.handoffNote?.trim()
      );
      // silent:true - tranh giat/nhay y het reload() (xem comment o load()) -
      // vua tao xong quote, form dang hien day du du lieu, khong can che het
      // bang man hinh "Đang tải báo giá..." roi hien lai.
      await load(created.id, { silent: true });
      if (hasChecklistInput) {
        try {
          const saved = await seedingQuoteRepository.saveQuoteHandoffChecklist(created.id, {
            scopeConfirmed: pendingChecklist.scopeConfirmed,
            scopeNote: pendingChecklist.scopeNote,
            costConfirmed: pendingChecklist.costConfirmed,
            costNote: pendingChecklist.costNote,
            timelineConfirmed: pendingChecklist.timelineConfirmed,
            timelineNote: pendingChecklist.timelineNote,
            assumptionConfirmed: pendingChecklist.assumptionConfirmed,
            assumptionNote: pendingChecklist.assumptionNote,
            handoffNote: pendingChecklist.handoffNote,
          });
          setChecklist(saved);
          setChecklistDraft(saved);
        } catch {
          // Khong critical - Sale van tu tick lai binh thuong o Buoc 2/3 duoc.
        }
      }
      // Bam "Bàn giao" tuc la Presale coi nhu DA XONG ca hang muc lan gia
      // von NGAY tai buoc gop (bubble "Yêu cầu & Kỹ thuật") - neu moi thu da
      // du dieu kien (dung DUNG dieu kien RPC quote_set_processing_stage:
      // co hang muc, SL>0, da nhap gia von hoac tick "khong ap dung") thi chuyen
      // luon tiep sang 'pricing' TRONG CUNG 1 lan bam - tranh nguoi dung
      // tuong "bam bàn giao xong roi" ma van con ket o bubble buoc 1 (bug
      // that da gap: du da chuyen 'technical' that su duoi DB, bubble van
      // hien "current" vi bubble nay gop chung request+technical). Neu con
      // thieu dieu kien nao, IM LANG dung lai o 'technical' - nut "Bàn giao
      // xử lý giá" rieng trong workspace van con do de Sale/Presale tu bam
      // tiep sau khi bo sung du.
      if (submitFully && advancedToTechnical) {
        const realDraftItems = itemsDraft.filter(item => item.rowType !== 'section');
        const stillMissingCost = realDraftItems.some(item => !item.costNotApplicable && item.costPrice == null);
        const stillMissingQty = realDraftItems.some(item => !(item.quantity > 0));
        // Ly do CU THE khien chua chuyen tiep duoc sang 'pricing' - hien ro
        // cho nguoi dung (KHONG im lang nua, bug that da gap: nguoi dung
        // khong hieu vi sao bam "Bàn giao" xong van con nut "Bàn giao xử lý
        // giá" o Buoc 1, tuong he thong bi loi).
        const blockingReasons = [
          realDraftItems.length === 0 ? 'chưa có hạng mục nào' : null,
          stillMissingQty ? 'còn hạng mục chưa nhập số lượng' : null,
          stillMissingCost ? 'còn hạng mục chưa nhập giá vốn (hoặc chưa tick "Không áp dụng")' : null,
        ].filter((reason): reason is string => Boolean(reason));
        if (blockingReasons.length === 0) {
          try {
            await seedingQuoteRepository.setQuoteProcessingStage(created.id, 'pricing');
            // BUG THAT DA GAP ("không được mặc định hoàn thành Bước 1 là luôn
            // điều hướng sang Bước 2") - dung y het logic o handoffStep1ToPricing()
            // (quote da ton tai): so sale_user_id (resolvedQuoteOwnerId) voi
            // current_user_id (user?.id) bang ID THAT, khong so ten.
            const currentUserId = user?.id || null;
            if (resolvedQuoteOwnerId && currentUserId && resolvedQuoteOwnerId === currentUserId) {
              await load(created.id, { silent: true });
            } else {
              showToast(
                true,
                resolvedQuoteOwnerId
                  ? `Đã hoàn thành Bước 1 và bàn giao cho ${nameFor(resolvedQuoteOwnerId)}.`
                  : 'Đã hoàn thành Bước 1. Báo giá đang chờ phân công Sale.'
              );
              window.setTimeout(() => {
                markClosingIntent();
                onClose();
              }, 1200);
            }
          } catch (pricingErr) {
            showToast(false, `Đã lưu, nhưng chưa chuyển được sang "Hoàn thiện giá bán": ${pricingErr instanceof Error ? pricingErr.message : 'lỗi không xác định'}. Bổ sung rồi bấm "Bàn giao" lại.`);
          }
        } else {
          showToast(false, `Đã lưu, nhưng CHƯA sang được "Hoàn thiện giá bán" vì: ${blockingReasons.join(', ')}. Bổ sung rồi bấm "Bàn giao" lại.`);
        }
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được yêu cầu hỗ trợ báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  // SUA LAI lan 2 (bo tu dong): Sale phan hoi la tu dong tao ngam ngay khi co
  // hang muc dau tien lam form GIAT/RELOAD giua luc dang go du da them dieu
  // kien "phai co noi dung" - van con dinh do khong on. Quay lai bam nut ro
  // rang ("Tạo báo giá") thay vi tu chay ngam - Sale tu quyet dinh luc nao
  // xong de bam, khong bi ngat ngang khi dang nhap lieu nua.

  async function reload() {
    if (!quote) return;
    await load(quote.id, { silent: true });
    await onChanged();
  }

  function stageState(target: QuoteProcessingStage): 'done' | 'current' | 'upcoming' | 'halted' {
    if (isCancelled) return 'halted';
    if (!isDraft) return 'done'; // da duyet/confirmed -> ca 4 buoc coi nhu da qua
    const currentIdx = STAGE_ORDER.indexOf(stage);
    const idx = STAGE_ORDER.indexOf(target);
    if (idx < currentIdx) return 'done';
    if (idx === currentIdx) return 'current';
    return 'upcoming';
  }

  // Buoc 4 dung CHUNG 1 gia tri DB 'review' (chi co 4 gia tri trong
  // processing_stage) cho ca "dang cho duyet" LAN "da duyet, san sang phat
  // hanh" - phan biet bang label hien thi (KHONG them gia tri DB moi):
  // quote.status='approved' -> "San sang phat hanh", con lai (draft o buoc
  // review) -> "Cho duyet".
  function stageLabel(target: QuoteProcessingStage): string {
    // Gio da co state THAT rieng (migration 087/089: ready_to_publish/
    // published) - khong con phai dung nhan FE gia tren cung 1 gia tri DB
    // 'review' nua, doc thang tu quote.processingStage that.
    if (target === 'review') {
      if (quote?.processingStage === 'published') return 'Đã phát hành';
      if (quote?.processingStage === 'ready_to_publish') return 'Đã duyệt · Chưa phát hành';
    }
    return STAGE_LABELS[target];
  }

  // Nhan card "Pham vi" doi theo DUNG phase - truoc day dung chung 1 label
  // cho moi phase ("Yêu cầu & phạm vi công việc"), gay sai ngu canh o
  // technical/pricing/locked (khong con la "yeu cau" nua, ma la pham vi da
  // CHOT/da BAN GIAO). KHONG giu text sai chi vi test cu key cung vao no -
  // test phai tro qua data-testid="qc-scope-card-title" (xem JSX).
  function scopeCardLabel(target: QuoteProcessingStage): string {
    if (target === 'technical') return 'Phạm vi kỹ thuật';
    if (target === 'pricing') return 'Phạm vi đã bàn giao';
    if (target === 'review' || target === 'ready_to_publish' || target === 'published') return 'Phạm vi công việc';
    return 'Yêu cầu & phạm vi công việc';
  }

  function stageOwnerName(target: QuoteProcessingStage): string {
    if (!quote) {
      if (target === 'request') return nameFor(user?.id);
      if (target === 'technical') return nameFor(draftTechnicalOwnerId);
      if (target === 'pricing') return nameFor(draftQuoteOwnerId);
      return 'Chưa duyệt';
    }
    if (target === 'request') return nameFor(quote.createdById);
    if (target === 'technical') return ownerNameFor(quote.technicalOwnerId);
    if (target === 'pricing') return ownerNameFor(quote.quoteOwnerId);
    if (quote.processingStage === 'published') return nameFor(quote.publishedById);
    return nameFor(quote.approvedById);
  }

  function stageTimeLabel(target: QuoteProcessingStage): string {
    if (!quote) return target === 'request' ? 'Đang soạn' : '';
    if (target === 'request') return relativeTime(quote.createdAt);
    if (target === 'technical') return relativeTime(checklist?.updatedAt || quote.updatedAt);
    if (target === 'pricing') return relativeTime(quote.updatedAt);
    if (!quote.approvedAt) return 'Chưa duyệt';
    if (quote.processingStage === 'published' && quote.publishedAt) return relativeTime(quote.publishedAt);
    return relativeTime(quote.approvedAt);
  }

  async function assignOwner(field: 'technicalOwnerId' | 'quoteOwnerId', value: string) {
    setBusy(true);
    try {
      await seedingQuoteRepository.assignQuoteOwners(quote!.id, { [field]: value || null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gán được người phụ trách.');
    } finally {
      setBusy(false);
    }
  }

  // <input type="datetime-local"> lam viec theo GIO DIA PHUONG cua trinh
  // duyet, con quote.slaDueAt la ISO UTC - PHAI tu doi 2 chieu, khong duoc
  // .slice(0,16) truc tiep (se lech dung bang so gio UTC offset cua nguoi
  // dung, vd sai 7 tieng o VN).
  function isoToDatetimeLocalValue(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function datetimeLocalValueToIso(value: string): string | null {
    if (!value) return null;
    const d = new Date(value); // parse nhu gio dia phuong (dung hanh vi cua datetime-local)
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  async function updateQuoteSlaDueAt(localValue: string) {
    const iso = datetimeLocalValueToIso(localValue);
    setBusy(true);
    try {
      await seedingQuoteRepository.updateQuote(quote!.id, { slaDueAt: iso });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được SLA.');
    } finally {
      setBusy(false);
    }
  }

  // BUG THAT DA GAP (fix 2026-09-22): "Đơn vị phát hành" tren 1 quote DA TON
  // TAI truoc gio LUON bi khoa (dropdown disabled) - ke ca khi quote chua he
  // co issuer nao (tao TRUOC khi tinh nang nay ton tai, issuerCompanyId
  // NULL) - nguoi dung KHONG CO CACH nao gan issuer cho cac quote cu nay.
  // Mirror dung pattern updateQuoteProject() o tren (cho phep sua khi
  // `isDraft && canEdit`, xem cho goi ham nay trong JSX ben duoi). Luon ap
  // lai applyIssuerCompanySnapshot + applyIssuerPaymentTermsSnapshot moi lan
  // chon/doi issuer - AN TOAN du quote da co issuer khac tu truoc, vi
  // applyIssuerPaymentTermsSnapshot() (types.ts) CHI ghi de block
  // 'payment_terms' khi no dang RONG hoac dang la mau tu-dong-sinh boi
  // dropdown "Thanh toán X ngày" (khong phai noi dung Sale tu go that su).
  async function updateQuoteIssuerCompany(issuerCompanyId: string) {
    setBusy(true);
    try {
      const company = issuerCompanies.find(c => c.id === issuerCompanyId) || null;
      let dataOverride: Quote['data'] | undefined;
      if (company) {
        const nextData = deepClone(quote!.data) || {};
        applyIssuerCompanySnapshot(nextData, company);
        applyIssuerPaymentTermsSnapshot(nextData, company, issuerCompanies);
        dataOverride = nextData;
      }
      // "Mẫu ăn theo Đơn vị phát hành" (feedback 2026-09-24, "chọn Markee thì
      // mẫu báo giá auto fill mẫu thuộc đơn vị phát hành đó") - doi Don vi
      // phat hanh se tu dong doi luon Mau bao gia sang company.defaultQuoteFormId
      // (dung DUNG pattern CreateQuoteModal.tsx dang dung luc TAO moi, gio ap
      // dung them cho SUA 1 quote da ton tai o Buoc 2/3) - chi doi khi cong ty
      // MOI thuc su co gan san 1 mau mac dinh rieng, KHONG dung gi neu chua
      // cau hinh (giu nguyen mau dang dung).
      const nextQuoteFormId = company?.defaultQuoteFormId || undefined;
      await seedingQuoteRepository.updateQuote(quote!.id, {
        issuerCompanyId,
        ...(dataOverride ? { data: dataOverride } : {}),
        ...(nextQuoteFormId ? { quoteFormId: nextQuoteFormId } : {}),
      });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gán được đơn vị phát hành.');
    } finally {
      setBusy(false);
    }
  }

  async function updateQuoteProject(projectId: string) {
    setBusy(true);
    try {
      await seedingQuoteRepository.updateQuote(quote!.id, { projectId: projectId || null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gán được dự án.');
    } finally {
      setBusy(false);
    }
  }

  // "Sale vẫn chọn được mẫu báo giá chứ" (feedback 2026-09-24) - doi Mau bao
  // gia THU CONG, doc lap voi auto-fill "an theo" Don vi phat hanh o
  // updateQuoteIssuerCompany() - 2 duong deu cung goi updateQuote({quoteFormId})
  // nen deu dong bo lai form_snapshot/form_schema_version o backend (xem
  // update_quote(), supabase_quote_service.py), khong bi lech schema render.
  async function updateQuoteFormId(quoteFormId: string) {
    setBusy(true);
    try {
      await seedingQuoteRepository.updateQuote(quote!.id, { quoteFormId });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không đổi được mẫu báo giá.');
    } finally {
      setBusy(false);
    }
  }

  async function advanceStage(target: QuoteProcessingStage) {
    // Chi con dung cho 'review' (Hoan tat phan gia ban) - hop request-
    // >technical->pricing gio di qua handoffStep1ToPricing() rieng (nut
    // "Bàn giao" hop nhat Buoc 1), khong con goi ham nay voi 'technical' nua.
    setActiveAction('reviewPricing');
    setBusy(true);
    try {
      await seedingQuoteRepository.setQuoteProcessingStage(quote!.id, target);
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không chuyển được bước xử lý.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  /** Bam "Hoàn tất phần giá bán" (Buoc 2 -> Buoc 3 review) - feedback
   * 2026-09-24: Dự án bat buoc (*) phai duoc chon TRUOC khi gui duyet, chua
   * chon phai chan lai + hien thong bao ro rang (toast + field error ngay
   * tai o Dự án), khong chi am tham disable nut. */
  function handoffPricingToReview() {
    if (!quote) return;
    if (!quote.projectId) {
      const errors = { project: 'Vui lòng chọn dự án.' };
      setRequiredFieldErrors(current => ({ ...current, ...errors }));
      focusFirstRequiredError(errors);
      showToast(false, 'Vui lòng chọn dự án trước khi gửi duyệt.');
      return;
    }
    void advanceStage('review');
  }

  async function saveChecklist() {
    if (!checklistDraft) return;
    setActiveAction('draftSave');
    setBusy(true);
    try {
      const saved = await seedingQuoteRepository.saveQuoteHandoffChecklist(quote!.id, {
        scopeConfirmed: checklistDraft.scopeConfirmed,
        scopeNote: checklistDraft.scopeNote,
        costConfirmed: checklistDraft.costConfirmed,
        costNote: checklistDraft.costNote,
        timelineConfirmed: checklistDraft.timelineConfirmed,
        timelineNote: checklistDraft.timelineNote,
        assumptionConfirmed: checklistDraft.assumptionConfirmed,
        assumptionNote: checklistDraft.assumptionNote,
        handoffNote: checklistDraft.handoffNote,
      });
      setChecklist(saved);
      setChecklistDraft(saved);
      await onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được checklist bàn giao.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  // BUG THAT DA GAP (phan anh tu nguoi dung): quote da luu (khong phai vua
  // tao) dang o Buoc 1 gop ("Yêu cầu & Kỹ thuật") nhung UI van bat bam HAI
  // nut lien tiep - "Gửi yêu cầu xử lý" (request->technical, UI KHONG doi vi
  // van con Buoc 1) roi moi hien "Bàn giao xử lý giá" (technical->pricing,
  // luc nay UI moi qua Buoc 2) - nhin nhu Buoc 1 bi lap lai 2 lan. Gop lam
  // MOT hanh dong "Bàn giao" duy nhat cho ca 2 truong hop (stage='request'
  // HOAC 'technical'): luu toan bo du lieu dang sua truoc, chuyen
  // request->technical NEU con o request (khong hien rieng buoc nay ra UI -
  // bubble 1 van gop chung ca 2), roi chuyen tiep technical->pricing luon -
  // CHI 1 lan bam la xong, giong dung hanh vi cua nut "Bàn giao" luc tao moi
  // (createRequest). That bai o buoc nao (vd thieu scope/checklist chua du)
  // thi dung lai dung do, KHONG mat du lieu, bam lai se tu bo qua buoc da
  // xong (processingStage da doc lai tu response, khong goi lai buoc thua).
  async function handoffStep1ToPricing() {
    if (busy || !quote) return;
    if (!validateRequiredWorkspaceFields(quote)) return;
    if (itemsMissingCost.length > 0) {
      window.alert(`Còn ${itemsMissingCost.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu "Không áp dụng giá vốn". Vui lòng bổ sung trước khi bàn giao.`);
      return;
    }
    setActiveAction('handoff');
    setBusy(true);
    try {
      const savedQuote = await seedingQuoteRepository.updateQuote(quote.id, {
        data: quote.data,
        items: buildItemsPayload(itemsDraft),
      });
      setQuote(savedQuote);

      if (checklistDraft && checklistDirty) {
        const savedChecklist = await seedingQuoteRepository.saveQuoteHandoffChecklist(quote.id, {
          scopeConfirmed: checklistDraft.scopeConfirmed,
          scopeNote: checklistDraft.scopeNote,
          costConfirmed: checklistDraft.costConfirmed,
          costNote: checklistDraft.costNote,
          timelineConfirmed: checklistDraft.timelineConfirmed,
          timelineNote: checklistDraft.timelineNote,
          assumptionConfirmed: checklistDraft.assumptionConfirmed,
          assumptionNote: checklistDraft.assumptionNote,
          handoffNote: checklistDraft.handoffNote,
        });
        setChecklist(savedChecklist);
        setChecklistDraft(savedChecklist);
      }

      // Neu van con o 'request' (chua tung Gui yeu cau xu ly lan nao), tu
      // chuyen sang 'technical' TRUOC (day chinh la moc bat SLA that -
      // set_quote_processing_stage chi set sla_started_at o LAN DAU tien
      // request->technical, Admin tra ve 'technical' sau nay se KHONG bi bat
      // lai SLA lan 2 vi da co sla_started_at tu truoc). KHONG reload/doi UI
      // giua chung - bubble 1 van gop ca 2 stage nay, nguoi dung khong can
      // thay buoc trung gian.
      if (savedQuote.processingStage === 'request') {
        await seedingQuoteRepository.setQuoteProcessingStage(quote.id, 'technical');
      }
      const finalQuote = await seedingQuoteRepository.setQuoteProcessingStage(quote.id, 'pricing');
      if (finalQuote.processingStage !== 'pricing') {
        throw new Error('Chưa thể hoàn tất bàn giao. Vui lòng thử lại.');
      }

      // BUG THAT DA GAP ("không được mặc định hoàn thành Bước 1 là luôn điều
      // hướng sang Bước 2"): truoc day luon `await reload()` roi de nguyen UI
      // hien buoc moi nhat cua quote (pricing) - Presale KHONG phai Sale
      // duoc phan cong cung bi "keo theo" sang man hinh Buoc 2 (thuc chat
      // khong lam gi duoc o do vi khong co quyen sua Buoc 2). Dung DUNG
      // sale_user_id (quote.quoteOwnerId) so voi current_user_id (user?.id)
      // - so bang ID THAT, KHONG so ten/email/text role.
      await reload();
      showToast(true, `Đã bàn giao sang Bước 2${finalQuote.quoteOwnerId ? ` cho ${nameFor(finalQuote.quoteOwnerId)}` : ''}.`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Chưa thể hoàn tất bàn giao. Vui lòng thử lại.');
      // Du that bai o buoc nao, tai lai du lieu THAT tu server (co the da
      // qua duoc request->technical) - khong de UI dung sai lech voi DB
      // that. Popup GIU NGUYEN MO (khong dong) - dung yeu cau "Nếu API lỗi
      // thì giữ popup mở, giữ nguyên dữ liệu" - nguoi dung tu bam "Bàn giao"
      // lai de thu lai (dong vai tro nut "thu lai").
      await reload();
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function approveNow() {
    if (busy) return; // chong double-click
    setActiveAction('approve');
    setBusy(true);
    try {
      // Duyet KHONG con tu bat public link nua (tach rieng khoi publish, xem
      // quote_approve RPC migration 089) - sau khi duyet processingStage se
      // la 'ready_to_publish', PHAI bam "Phat hanh" rieng moi co public link that.
      await seedingQuoteRepository.approveQuote(quote!.id);
      setApproveModalOpen(false);
      await reload();
    } catch (err) {
      if (err instanceof QuoteApprovalRequiresExceptionError) {
        // Rule Engine khong dat - dong modal duyet thuong, mo modal "Phê
        // duyệt ngoại lệ" rieng (Section 5), bat nhap ly do.
        setApproveModalOpen(false);
        setExceptionApprovalModal({ open: true, reason: '', evaluation: err.evaluation });
        return;
      }
      window.alert(err instanceof Error ? err.message : 'Không duyệt được báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function approveWithExceptionNow() {
    if (busy) return;
    const reason = exceptionApprovalModal.reason.trim();
    if (!reason) {
      window.alert('Vui lòng nhập lý do phê duyệt ngoại lệ.');
      return;
    }
    setActiveAction('approve');
    setBusy(true);
    try {
      await seedingQuoteRepository.approveQuote(quote!.id, reason);
      setExceptionApprovalModal({ open: false, reason: '', evaluation: null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không duyệt ngoại lệ được báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function publishNow() {
    if (busy) return;
    setActiveAction('publish');
    setBusy(true);
    try {
      await seedingQuoteRepository.publishQuote(quote!.id);
      setPublishModalOpen(false);
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không phát hành được báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function requestChangesNow() {
    if (busy) return;
    if (!requestChangesReason.trim()) {
      window.alert('Vui lòng nhập lý do yêu cầu chỉnh sửa.');
      return;
    }
    setActiveAction('requestChanges');
    setBusy(true);
    try {
      await seedingQuoteRepository.requestQuoteChanges(quote!.id, requestChangesSection, requestChangesReason.trim());
      setRequestChangesModalOpen(false);
      setRequestChangesReason('');
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gửi được yêu cầu chỉnh sửa.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function copyPublicLink() {
    const url = buildPublicQuoteUrl(quote!.publicUrl);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    showToast(true, 'Đã sao chép link báo giá.');
  }

  function printPublicQuotePdf() {
    const url = buildPublicQuoteUrl(quote!.publicUrl, { print: true });
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // "Khoá link báo giá" - yeu cau rieng "gui khach xong lam sao khoa link lai
  // duoc" (endpoint /revoke-public da co san o backend/repository tu truoc,
  // dung o menu "..." tren trang Danh sach bao gia - nhung CHUA co trong
  // Quote Workspace, dung nga can nguoi dung nhat khi ho dang xem chinh link
  // vua gui). Dung lai API cu, chi them nut + cap nhat lai state tai cho.
  async function revokePublicLinkFromWorkspace() {
    if (!quote) return;
    if (!window.confirm('Khoá link báo giá này? Khách hàng sẽ không truy cập được link cũ nữa cho tới khi bạn gửi lại.')) return;
    setBusy(true);
    try {
      const updated = await seedingQuoteRepository.revokePublicQuote(quote.id);
      setQuote(updated);
      showToast(true, 'Đã khoá link báo giá.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không khoá được link báo giá.');
    } finally {
      setBusy(false);
    }
  }

  // "Mở lại link báo giá" - yeu cau rieng ("khóa link rồi ... k thấy nút mở
  // link nha bro"): truoc day chi co chieu khoa (tren), khong co cach nao mo
  // lai link cu ma khong lam gi ca - gio dung API moi (/enable-public,
  // migration 115), giu nguyen public_token cu nen link cu hoat dong lai y
  // het, khong can gui lai link moi cho khach.
  async function enablePublicLinkFromWorkspace() {
    if (!quote) return;
    setBusy(true);
    try {
      const updated = await seedingQuoteRepository.enablePublicQuote(quote.id);
      setQuote(updated);
      showToast(true, 'Đã mở lại link báo giá.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không mở lại được link báo giá.');
    } finally {
      setBusy(false);
    }
  }

  function newSendIdempotencyKey(quoteId: string): string {
    return `${quoteId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function viewDeliveryLog() {
    if (!quote) return;
    setDeliveryLogModal({ open: true, loading: true, entries: [], error: null });
    try {
      const entries = await seedingQuoteRepository.getQuoteDeliveryLog(quote.id);
      setDeliveryLogModal({ open: true, loading: false, entries, error: null });
    } catch (err) {
      setDeliveryLogModal({ open: true, loading: false, entries: [], error: err instanceof Error ? err.message : 'Không tải được lịch sử gửi.' });
    }
  }

  // Mo popup "Gui khach hang" - LUON mo duoc (du thieu recipient), CHI nut
  // submit ben trong bi disable neu thieu du lieu (dung yeu cau "Thieu
  // recipient -> mo popup nhung submit disabled", KHONG chan mo popup).
  async function openSendModal() {
    if (!quote) return;
    setSendError(null);
    setSendSuccess(false);
    setSendAttachPdf(false);
    setSendMessage('');
    setSendRecipientName('');
    setSendRecipientEmail('');
    setSendRecipientSource(null);
    setSendSubject(`Báo giá ${quote.quoteNumber}${quote.data?.quoteTitle ? ` · ${quote.data.quoteTitle}` : ''}`);
    setSendIdempotencyKey(newSendIdempotencyKey(quote.id));
    setSendModalOpen(true);
    try {
      const suggestion = await seedingQuoteRepository.getQuoteRecipientSuggestion(quote.id);
      setSendRecipientName(suggestion.name || '');
      setSendRecipientEmail(suggestion.email || '');
      setSendRecipientSource(suggestion.source);
    } catch {
      // Khong chan mo popup neu goi y that bai - nguoi dung tu nhap tay.
    }
  }

  async function submitSendQuote() {
    if (!quote || sendBusy) return;
    if (!sendRecipientEmail.trim()) {
      setSendError('Vui lòng nhập email người nhận.');
      return;
    }
    setSendBusy(true);
    setSendError(null);
    try {
      const result = await seedingQuoteRepository.sendQuoteEmail(quote.id, {
        recipientName: sendRecipientName.trim() || null,
        recipientEmail: sendRecipientEmail.trim(),
        recipientSource: sendRecipientSource,
        subject: sendSubject,
        message: sendMessage,
        attachPdf: sendAttachPdf,
        idempotencyKey: sendIdempotencyKey,
      });
      if (result.status === 'sent') {
        setSendSuccess(true);
        await reload();
      } else {
        setSendError(result.errorMessage || 'Gửi email thất bại.');
        setSendIdempotencyKey(newSendIdempotencyKey(quote.id));
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Gửi email thất bại.');
      setSendIdempotencyKey(newSendIdempotencyKey(quote.id));
    } finally {
      setSendBusy(false);
    }
  }

  async function confirmCreateVersion() {
    setBusy(true);
    try {
      const result = await seedingQuoteRepository.createQuoteVersion(quote!.id);
      setVersionModalOpen(false);
      if (result.redirectedFromClickedQuote) {
        window.alert(`Chuỗi báo giá đã có bản duyệt mới hơn (V${result.sourceVersionNumber}) — đã tạo phiên bản mới từ bản đó.`);
      } else if (!result.created) {
        window.alert('Chuỗi này đã có bản nháp sẵn — mở bản nháp đó.');
      } else {
        try {
          await seedingQuoteRepository.logQuoteVersionReason(result.quote.id, versionReason);
        } catch {
          // Khong chan luong neu ghi ly do that bai - version van da tao dung that.
        }
      }
      await onChanged();
      await load(result.quote.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tạo được phiên bản báo giá mới.');
    } finally {
      setBusy(false);
    }
  }

  // Nut "Tao phien ban moi" LUON hien o header (dong nhat voi HTML tham
  // khao), nhung CHI enable khi bao gia THAT SU dang o status='approved' va
  // chua chot/huy - moi truong hop khac disabled kem tooltip giai thich dung
  // ly do that (khong an nut, khong copy loi HTML "BG-MOI/V1 nhung nut ghi
  // tu V4"). Nhan label CHI doc quote.versionNumber THAT khi bao gia da ton
  // tai - KHONG BAO GIO hien so gia trong che do tao moi.
  const versionButtonState = (() => {
    if (!quote) {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Cần lưu và duyệt báo giá trước khi tạo phiên bản mới.' };
    }
    if (status.key === 'lost') {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Báo giá đã huỷ, không thể tạo phiên bản mới.' };
    }
    if (status.key === 'won') {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Báo giá đã chốt, không thể tạo phiên bản mới.' };
    }
    if (quote.status !== 'approved') {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Chỉ báo giá đã duyệt mới có thể tạo phiên bản mới.' };
    }
    if (existingDraftVersion) {
      return { disabled: false, label: `Tiếp tục chỉnh sửa V${existingDraftVersion.versionNumber || ''}`, tooltip: undefined, continueExisting: true as const };
    }
    return { disabled: false, label: `Tạo phiên bản mới từ V${quote.versionNumber || 1}`, tooltip: undefined };
  })();

  const rootItems = quote?.items || [];
  // Muc cha (Section, migration 104) KHONG tinh tien, khong bat nhap SL/gia
  // von/markup - loai hoan toan khoi moi kiem tra nghiep vu (thieu gia von,
  // dem so hang muc...) giong dung cach RPC backend loai no qua `row_type =
  // 'item'`, tranh dem nham 1 dong tieu de la "hang muc thieu du lieu".
  const realItemsDraft = itemsDraft.filter(item => item.rowType !== 'section');
  // Hang muc "thieu gia von" = chua nhap costPrice VA chua tick "khong ap
  // dung" - dung DUNG dieu kien RPC quote_set_processing_stage (migration
  // 090) validate ('quote_item_missing_cost_price') de nut FE disable/thong
  // bao KHOP voi that su backend se chan hay khong (khong doan mo ho).
  const itemsMissingCost = realItemsDraft.filter(item => !item.costNotApplicable && item.costPrice == null);
  // "Co thay doi chua luu" - so sanh dung 9 field thuc su gui len
  // saveQuoteHandoffChecklist(), KHONG so sanh nguyen object (co the lech field
  // metadata nhu updatedAt lam sai lech ket qua so sanh).
  const checklistDirty = Boolean(
    checklistDraft && (
      checklistDraft.scopeConfirmed !== (checklist?.scopeConfirmed ?? false) ||
      (checklistDraft.scopeNote || '') !== (checklist?.scopeNote || '') ||
      checklistDraft.costConfirmed !== (checklist?.costConfirmed ?? false) ||
      (checklistDraft.costNote || '') !== (checklist?.costNote || '') ||
      checklistDraft.timelineConfirmed !== (checklist?.timelineConfirmed ?? false) ||
      (checklistDraft.timelineNote || '') !== (checklist?.timelineNote || '') ||
      checklistDraft.assumptionConfirmed !== (checklist?.assumptionConfirmed ?? false) ||
      (checklistDraft.assumptionNote || '') !== (checklist?.assumptionNote || '') ||
      (checklistDraft.handoffNote || '') !== (checklist?.handoffNote || '')
    )
  );
  const paymentTermsBlock = (quote?.data?.customBlocks || []).find(block => block.kind === 'payment_terms' && block.content.trim());
  const canReadyForApproval = Boolean(quote && rootItems.length > 0 && quote.totalAmount >= 0);

  // "Xem ban khach hang" theo dung nguyen tac: nut LUON hien, chi disable +
  // tooltip khi chua du dieu kien - khong an nut. Dieu kien du: da chon
  // khach hang/co hoi (draftDealId o create-mode, hoac quote.dealId khi da
  // ton tai) VA co it nhat 1 hang muc trong itemsDraft (bao gom ca thay doi
  // CHUA luu, dung yeu cau "preview tu state hien tai").
  // Quote da ton tai (du draft/pricing/approved) chi can co hang muc la du -
  // KHONG bat buoc phai co Deal (bao gia co the dung doc lap, khong gan Deal
  // van la 1 trang thai that). Rieng CREATE-MODE moi bat buoc them dieu
  // kien "da chon khach hang/co hoi" vi luc nay chua co gi ngoai draft.
  // "ở bước 1 vẫn được xem bản xem trước" (feedback 2026-09-24): KHONG con
  // bat buoc co hang muc (bang rong van xem duoc bo cuc/header/thong tin
  // khach) va o create-mode chi can chon Khach hang HOAC Co hoi - luong
  // Khach hang -> Bao gia thuong chua gan Co hoi nao o Buoc 1.
  const canPreview = quote ? true : Boolean(draftDealId || draftCustomerId);
  const previewDisabledReason = !canPreview
    ? 'Chọn khách hàng để xem bản khách hàng'
    : undefined;

  // BUG THAT DA GAP ("bấm Preview khách hàng ở bước 1 ra bảng cũ chứ không
  // hiện bản PDF"): modal xem truoc truoc day CHI dung QuoteDocumentRenderer
  // (giong PDF/public that) khi `quote.formSnapshot` co - tuc CHI sau khi da
  // bam Luu/Ban giao it nhat 1 lan (quote that su ton tai trong DB). Truoc
  // do (che do tao moi, quote con null) roi ve ban rut gon 4 cot cu, du
  // nguoi dung DA CHON mau bao gia qua dropdown "Mẫu báo giá" (draftFormId)
  // roi - schema DA BIET, chi la chua duoc luu thanh quote.formSnapshot. Xay
  // "ban nhap" cua schema + du lieu tu chinh cac state dang go (draftTitle/
  // draftScope/draftCustomerId...) - GIONG HET logic build payload luc bam
  // "Bàn giao" that su (xem createRequest(), dong ~2179-2241) - de Preview
  // dung DUNG renderer/schema tu buoc 1, khong con phan biet "truoc/sau khi
  // luu" nua.
  const draftSelectedForm = useMemo(
    () => quoteForms.find(f => f.id === (draftFormId || defaultFormId)),
    [quoteForms, draftFormId, defaultFormId]
  );
  const draftPreviewData = useMemo(() => {
    const customerId = deal?.customerId || draftCustomerId;
    const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
    const displayName = customerRecord?.name || deal?.customerName;
    const legacyBlocks = [
      ...(draftScope.trim()
        ? [{ id: 'preview-scope', kind: 'scope_of_work' as const, title: 'Mô tả scope / yêu cầu cần estimate', content: draftScope.trim() }]
        : []),
      {
        id: 'preview-payment',
        kind: 'payment_terms' as const,
        title: 'Điều khoản thanh toán',
        content: `Thanh toán trong ${draftPaymentTermsDays} ngày kể từ ngày duyệt báo giá.`,
      },
      ...draftExtraTerms.map(t => ({ id: t.id, kind: 'custom_field' as const, title: t.title, content: t.content })),
    ];
    const customBlocks = [...legacyBlocks.filter(block => !draftCustomBlocks.some(b => b.kind !== 'custom_field' && b.kind === block.kind)), ...draftCustomBlocks].filter(b => b.content.trim());
    const previewData: QuoteData = {
      quoteTitle: draftTitle.trim() || 'Yêu cầu hỗ trợ báo giá',
      customBlocks,
      paymentPlan: draftPaymentPlan,
      ...(draftVisibleColumns ? { visibleColumns: draftVisibleColumns } : {}),
      ...(draftVisibleSummaryFields ? { visibleSummaryFields: draftVisibleSummaryFields } : {}),
      ...(draftVisibleCustomerFields ? { visibleCustomerFields: draftVisibleCustomerFields } : {}),
      ...(deal || customerRecord
        ? {
            customerRecipient: displayName || undefined,
            customerCompanyName: customerRecord?.companyName || deal?.companyName || undefined,
            customerContactName: displayName || undefined,
            customerAddress: customerRecord?.address || deal?.address || undefined,
            customerPhone: customerRecord?.phone || deal?.phone || undefined,
            customerEmail: customerRecord?.email || deal?.email || undefined,
            customerTaxCode: customerRecord?.taxCode || deal?.taxCode || undefined,
          }
        : {}),
    };
    // Xem truoc phai hien DUNG Don vi phat hanh dang chon (logo/thong tin/
    // dieu khoan) - cung snapshot ma createRequest() se luu (feedback
    // 2026-09-23 muc 3), khong phai default cua mau bao gia.
    if (effectiveIssuerCompany) {
      applyIssuerCompanySnapshot(previewData, effectiveIssuerCompany);
      applyIssuerPaymentTermsSnapshot(previewData, effectiveIssuerCompany, issuerCompanies);
    }
    return previewData;
  }, [deal, draftCustomerId, customers, draftTitle, draftScope, draftPaymentTermsDays, draftExtraTerms, draftCustomBlocks, draftPaymentPlan, draftVisibleColumns, draftVisibleSummaryFields, draftVisibleCustomerFields, effectiveIssuerCompany, issuerCompanies]);
  const columnVisibilitySchema = quote?.formSnapshot || draftSelectedForm?.schemaJson;
  // "Kế hoạch thanh toán" dang chim qua trong 1 accordion phang - badge trang
  // thai + tom tat khi dong de Sale khong bo qua (yeu cau rieng, xem
  // paymentPlanCardOpen ben duoi). KHONG doi logic tinh tien/villa/persistence.
  const paymentPlanRows = quote?.data.paymentPlan || draftPaymentPlan;
  const paymentPlanFinalPayable = calculateOverallDiscountSummary(calculateQuoteTotals(itemsDraft), quote ? quote.overallDiscountPercent : draftOverallDiscountPercent).grandTotal;
  const paymentPlanPct = paymentPlanPercent(paymentPlanRows);
  const paymentPlanIsEmpty = paymentPlanRows.length === 0;
  const paymentPlanIsComplete = !paymentPlanIsEmpty && paymentPlanPct === 100;
  const paymentPlanBadgeText = paymentPlanIsEmpty ? 'Chưa thiết lập' : paymentPlanIsComplete ? `${paymentPlanRows.length} đợt · 100%` : 'Cần đủ 100%';
  const paymentPlanBadgeClass = paymentPlanIsEmpty ? 'qc-badge-neutral' : paymentPlanIsComplete ? 'qc-badge-success' : 'qc-badge-warning';
  const paymentPlanTotalAmount = paymentPlanRows.reduce((sum, row) => sum + paymentPlanAmount(paymentPlanFinalPayable, row.percent), 0);
  const columnVisibilityDraft: QuoteDraft = {
    data: quote ? quote.data : draftPreviewData,
    items: itemsDraft,
    solutionItems: quote?.data?.solutionItems || [],
  };

  // "Khi tích xong hỏi lại có chắc lưu và hiển thị vậy không" - moi lan bam
  // tick 1 cot deu hoi xac nhan TRUOC khi that su ap dung/luu.
  //
  // BUG THAT DA GAP ("k bấm dc luôn" - lap lai 2 lan): ban dau dung
  // <ConfirmModal> tuy chinh - dialog nay dung <div class="crm-modal-backdrop">
  // rieng, z-index mac dinh THAP HON popup preview dang mo (`elevated` prop
  // da them van khong du tin cay - co the do 1 ancestor tao stacking context
  // moi khien z-index tuyet doi khong con so sanh dung nhu ky vong). Doi
  // sang `window.confirm()` cua CHINH trinh duyet - LUON hien tren CUNG
  // TUYET DOI (browser-native, khong bao gio bi 1 modal/overlay tuy chinh
  // nao khac trong trang de len tren), khong con phu thuoc z-index/stacking
  // context tinh toan sai nua. QuoteColumnVisibilityPicker van giu NGUYEN
  // 100% JSX/logic cua no (component "controlled" tu prop `draft`) - chi doi
  // CACH goi ham xac nhan o tang goi (QuoteWorkspaceModal), khong dung
  // component/state moi nao khac.
  function handleColumnVisibilityChange(next: QuoteDraft) {
    if (!window.confirm('Bạn có chắc muốn lưu và áp dụng đúng cấu hình hiển thị (cột & tổng hợp giá) đã chọn cho bản xem/khách hàng không?')) {
      return;
    }
    const visibleColumns = next.data.visibleColumns;
    const visibleSummaryFields = next.data.visibleSummaryFields;
    const visibleCustomerFields = next.data.visibleCustomerFields;
    if (quote) {
      const nextData = { ...quote.data, visibleColumns, visibleSummaryFields, visibleCustomerFields };
      setQuote(current => (current ? { ...current, data: nextData } : current));
      void persistQuote({ data: nextData }, { silent: true });
    } else {
      setDraftVisibleColumns(Array.isArray(visibleColumns) ? visibleColumns : undefined);
      setDraftVisibleSummaryFields(Array.isArray(visibleSummaryFields) ? visibleSummaryFields : undefined);
      setDraftVisibleCustomerFields(Array.isArray(visibleCustomerFields) ? visibleCustomerFields : undefined);
    }
  }
  // Tinh tam TU itemsDraft (chi de xem truoc, KHONG phai so luu that) - khop
  // dung nguyen tac da dung o cac noi khac trong file nay ("so preview FE...
  // khong dua vao de dam bao tinh dung", so that luon do backend tinh lai
  // bang Decimal sau khi luu that).
  const draftPreviewTotals = useMemo(() => {
    const rows = itemsDraft.filter(i => i.rowType !== 'section');
    const subtotalAmount = rows.reduce((sum, i) => sum + (i.amountAfterDiscount ?? (i.quantity * (i.unitPrice ?? 0) || 0)), 0);
    const totalVatAmount = rows.reduce((sum, i) => {
      const base = i.amountAfterDiscount ?? (i.quantity * (i.unitPrice ?? 0) || 0);
      return sum + (i.vatAmount ?? (base * (i.vatRate || 0)) / 100);
    }, 0);
    return { subtotalAmount, totalVatAmount, totalAmount: subtotalAmount + totalVatAmount };
  }, [itemsDraft]);

  const liveCommercialSummary = useMemo(() => {
    const rows = itemsDraft.filter(i => i.rowType !== 'section');
    const costValues = rows.map(resolveQuoteItemCostTotal);
    const numericCostValues = costValues.filter((value): value is number => value != null);
    const liveHasCostData = rows.length > 0 && numericCostValues.length > 0;
    const costTotal = numericCostValues.reduce((sum, value) => sum + value, 0);
    const totals = calculateQuoteTotals(rows);
    const discountSummary = calculateOverallDiscountSummary(totals, quote ? quote.overallDiscountPercent : draftOverallDiscountPercent);
    const netRevenue = discountSummary.subtotalAfterDiscount;
    const grossProfit = liveHasCostData ? netRevenue - costTotal : null;
    const grossMarginPercent = liveHasCostData && netRevenue > 0 && grossProfit != null ? (grossProfit / netRevenue) * 100 : null;
    const ratePercent = grossMarginPercent;
    return {
      hasRows: rows.length > 0,
      hasCostData: liveHasCostData,
      costTotal,
      netRevenue,
      totalAmount: discountSummary.grandTotal,
      grossProfit,
      grossMarginPercent,
      ratePercent,
      overallDiscountPercent: quote ? quote.overallDiscountPercent : draftOverallDiscountPercent,
    };
  }, [itemsDraft, quote, draftOverallDiscountPercent]);

  const summaryHasCostData = liveCommercialSummary.hasCostData || hasCostData;
  const summaryCostTotal = liveCommercialSummary.hasCostData ? liveCommercialSummary.costTotal : (quote?.costTotal || 0);
  const summaryNetRevenue = liveCommercialSummary.hasRows ? liveCommercialSummary.netRevenue : (quote?.netRevenue || 0);
  const summaryTotalAmount = liveCommercialSummary.hasRows ? liveCommercialSummary.totalAmount : (quote?.totalAmount || 0);
  const summaryGrossProfit = liveCommercialSummary.hasCostData ? liveCommercialSummary.grossProfit : (quote?.grossProfit ?? null);
  const summaryGrossMarginPercent = liveCommercialSummary.hasCostData ? liveCommercialSummary.grossMarginPercent : (quote?.grossMarginPercent ?? null);
  const summaryRatePercent = liveCommercialSummary.hasCostData ? liveCommercialSummary.ratePercent : (summaryNetRevenue > 0 ? ((summaryNetRevenue - summaryCostTotal) / summaryNetRevenue) * 100 : null);
  const summaryOverallDiscountPercent = liveCommercialSummary.overallDiscountPercent;

  // "Gui khach hang" - LUON hien, ly do disable phai phan biet dung tung
  // tinh huong that (khong gop chung 1 cau chung chung) - dung DUNG thu tu
  // uu tien nhu spec: chua duyet > chua phat hanh > kenh mail chua san sang.
  const sendDisabledReason = !quote
    ? 'Cần lưu và duyệt báo giá trước khi gửi khách'
    : quote.status !== 'approved'
      ? 'Báo giá chưa được duyệt'
      : quote.processingStage !== 'published' || !quote.publicEnabled
        ? 'Cần phát hành báo giá trước khi gửi'
        : !sendAvailability
          ? 'Đang kiểm tra kênh gửi email...'
          : !sendAvailability.available
            ? (sendAvailability.reason || 'Kênh email hiện không hoạt động')
            : undefined;

  // Preview modal phai xem duoc CA o create-mode (chua co quote that) - tinh
  // tong cuc bo tu itemsDraft (dung CHINH XAC cong thuc server: tung dong
  // tinh CK truoc, VAT tren phan sau CK, KHONG lay tong da gom VAT de suy
  // nguoc). Khi da co quote that thi dung so THAT tu quote (khong tinh lai
  // o FE de tranh lech lam tron voi server).
  const marginBelowThreshold = Boolean(summaryHasCostData && summaryGrossMarginPercent != null && summaryGrossMarginPercent < 20);

  const previewTotals = quote
    ? { subtotal: quote.subtotalAmount, vat: quote.vatAmount, total: quote.totalAmount }
    : itemsDraft.reduce(
        (acc, item) => {
          const lineSubtotal = (item.quantity || 0) * (item.unitPrice || 0);
          const discountAmount = lineSubtotal * ((item.discountPercent ?? 0) / 100);
          const afterDiscount = lineSubtotal - discountAmount;
          const vat = afterDiscount * ((item.vatRate ?? 10) / 100);
          return { subtotal: acc.subtotal + lineSubtotal, vat: acc.vat + vat, total: acc.total + afterDiscount + vat };
        },
        { subtotal: 0, vat: 0, total: 0 }
      );

  // BUG THAT DA GAP: early return nay truoc day nam O GIUA cac hook (truoc
  // ca zonePickerItems da chuyen xuong duoi) - vi pham Rules of Hooks that su
  // (React bao "change in the order of Hooks" o runtime, khong chi ly thuyet)
  // vi zonePickerItems chi duoc goi khi `loading===false`, sinh so luong hook
  // khac nhau giua 2 lan render. Chuyen xuong DAY - SAU khi TOAN BO hook/
  // useMemo/useEffect cua component da chay xong, chi con anh huong phan
  // RENDER (JSX) nhu cu, khong con cat ngang chuoi hook nua.
  if (loading) {
    return (
      <div className="qc-modal-backdrop">
        <div className="qc-workspace qc-workspace--loading">Đang tải báo giá...</div>
      </div>
    );
  }

  // "Cơ hội CRM" (data-qc-required="deal") - dung CHUNG 1 JSX cho ca 2 vi tri:
  // hang 1 (chung voi Khach hang/Nguoi lien he) luc con o Buoc 1, roi TRA VE
  // hang 2 (chung voi Du an/Loai bao gia, dung bo cuc 3+3 GOC) tu Buoc 2
  // (beyondStep1) tro di - feedback "check lai xem buoc 2 co ve dung thu tu
  // cu khong" (2026-09-24, sau khi da gop 3 truong Buoc 1 vao 1 hang).
  const dealField = (
    <div data-qc-required="deal">
      {/* Chi doi CHU hien thi tu "Cơ hội CRM" sang "Dự án" (feedback
       * 2026-09-25) - VAN chon tu bang Deal/pipeline (customer_leads) nhu
       * cu, KHONG doi sang bang Project rieng (da xac nhan voi nguoi dung,
       * "chỉ đổi chữ hiển thị") - moi bien/state (deal, draftDealId,
       * requiredFieldErrors.deal...) giu nguyen ten cu, chi la label. CHI
       * doi chu luc con o Buoc 1 (!beyondStep1, o day la field DUY NHAT
       * Presale thay) - tu Buoc 2 field nay TRA VE hang 2, dung CHUNG hang
       * voi field "Dự án" THAT (data-qc-required="project", khac bang
       * Project) - giu nguyen "Cơ hội CRM" o do de khong lap 2 nhan "Dự án"
       * cung 1 hang (2 field khac nhau, 2 gia tri khac nhau). */}
      <span className="qc-workspace-info-label">{beyondStep1 ? 'Cơ hội CRM' : 'Dự án'} <span className="qc-required-mark">*</span></span>
      {!quote ? (
        <SearchableSelect
          value={draftDealId}
          onChange={handleSelectDeal}
          options={[
            { value: CREATE_NEW_DEAL_OPTION, label: '+ Tạo cơ hội mới…' },
            ...effectiveDeals
              .filter(d => !draftCustomerId || d.customerId === draftCustomerId)
              // Toi tu 1 Project card cu the (lockProject) - Co hoi CHI
              // hien dung cua Project do, khong phai moi Co hoi cua Khach hang.
              .filter(d => !lockProject || !draftProjectId || d.projectId === draftProjectId)
              .map(d => ({ value: d.id, label: `${d.customerName}${d.companyName ? ' · ' + d.companyName : ''}` })),
          ]}
          placeholder={beyondStep1 ? 'Chọn cơ hội...' : 'Chọn dự án...'}
          hideClearOption
        />
      ) : null}
      {!quote && draftDealId ? (
        <div className="qc-row-sub">
          {beyondStep1 ? 'Mã cơ hội' : 'Mã dự án'}: {businessCode || 'Chưa có mã'}
          {deal?.estimatedBudget ? ` · Giá trị dự kiến: ${formatMoney(deal.estimatedBudget)}` : ''}
        </div>
      ) : null}
      {quote ? (
        <>
          {/* Tuong tu Khach hang o tren - khong con doi Co hoi duoc
           * that su sau khi quote da tao, nhung van hien dang box
           * SearchableSelect disabled cho nhat quan giao dien, khong
           * hien nhu nhan chu bi khoa cung. */}
          <SearchableSelect
            value="current"
            onChange={() => {}}
            options={[{ value: 'current', label: businessCode || (deal ? (beyondStep1 ? 'Cơ hội chưa có mã' : 'Dự án chưa có mã') : (beyondStep1 ? 'Chưa gắn cơ hội' : 'Chưa gắn dự án')) }]}
            disabled
          />
          <div className="qc-row-sub">
            {/* opportunityName muon tu ten goi dich vu, KHONG phai "ten
             * co hoi" that (Deal khong co field nay) - ghi nhan ro
             * nguon that de khong trinh bay nhu du lieu that khac. */}
            {opportunityName ? `Gói dịch vụ: ${opportunityName}` : deal ? 'Chưa có gói dịch vụ' : ''}
            {deal?.estimatedBudget ? ` · Giá trị dự kiến: ${formatMoney(deal.estimatedBudget)}` : ''}
          </div>
        </>
      ) : null}
      {requiredFieldErrors.deal ? <p className="qc-field-error">{requiredFieldErrors.deal}</p> : null}
    </div>
  );

  return (
    <div className="qc-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) requestWorkspaceClose(); }}>
      <div className="qc-workspace">
        <header className="qc-workspace-header">
          {/* Dong rieng CHI hien tren mobile (≤767px, CSS an tren desktop) -
           * trang thai + nut dong o TREN CUNG, dung yeu cau "Dòng 1: trạng
           * thái + nút đóng". Cac nut phu (version/quay lai danh sach) don
           * vao 1 menu "⋯" dung chung ActionMenu (khong viet dropdown rieng)
           * de khong con 4 nut chen nhau xuong dong nhu truoc. */}
          <div className="qc-workspace-header-mobile-row">
            <span className={`qc-badge ${status.className}`}>{status.label}</span>
            <div className="qc-workspace-header-mobile-actions">
              <ActionMenu
                label="Thao tác khác"
                items={[
                  {
                    key: 'version',
                    label: versionButtonState.label,
                    disabled: versionButtonState.disabled || busy,
                    title: versionButtonState.tooltip,
                    onSelect: () => {
                      if (existingDraftVersion) {
                        void load(existingDraftVersion.id);
                      } else {
                        setVersionModalOpen(true);
                      }
                    },
                  },
                  { key: 'back', label: '← Danh sách', disabled: busy, onSelect: requestWorkspaceClose },
                ]}
              />
              <button type="button" className="crm-icon-action" aria-label="Đóng" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>
                <X className="qc-inline-icon" />
              </button>
            </div>
          </div>
          <div className="qc-workspace-header-main">
            {quote ? (
              <>
                <div className="qc-workspace-header-title">
                  <strong>{quote.quoteNumber}</strong>
                  <span className="qc-workspace-version-badge">V{quote.versionNumber || 1}</span>
                  <span className={`qc-badge ${status.className}`}>{status.label}</span>
                </div>
                <div className="qc-workspace-header-sub">
                  {typeof quote.data?.quoteTitle === 'string' && quote.data.quoteTitle ? quote.data.quoteTitle : 'Chưa có tiêu đề báo giá'}
                  {' · '}Cập nhật lần cuối {relativeTime(quote.updatedAt || quote.createdAt)}
                </div>
              </>
            ) : (
              // "Presale không làm phần thương mại" (feedback 2026-09-24, kem
              // screenshot) - "Tiêu đề báo giá" (draftTitle -> data.quoteTitle,
              // xem createRequest()) la field THUONG MAI, da co quyet dinh
              // truoc do (xem comment o quickbar "Tiêu đề báo giá" phia duoi)
              // la CHUYEN sang cho Sale dien o Buoc 2 - nhung o day (luc tao
              // yeu cau, !quote) van con sot 1 input cu cho Presale tu go -
              // AN HOAN TOAN input nay (khong phai khoa/disabled), Sale se dat
              // tieu de that o quickbar Buoc 2, draftTitle rong van hop le
              // (createRequest() tu fallback "Yêu cầu hỗ trợ báo giá").
              <div className="qc-workspace-header-title qc-workspace-header-title--create">
                <span className={`qc-badge ${status.className}`}>{status.label}</span>
                <span className="qc-workspace-muted" style={{ fontSize: 13 }}>Yêu cầu hỗ trợ báo giá</span>
              </div>
            )}
          </div>

          {/* Tien trinh 3 buoc GOP CHUNG 1 hang voi tieu de+nut hanh dong tren
           * desktop (yeu cau "Header và tiến trình chung một hàng") - CHINH
           * la .qc-workspace-stages cu, chi doi VI TRI (nam trong header thay
           * vi la 1 hang rieng ben duoi) - CSS mobile @767px van an di y het
           * truoc (display:none), khong doi hanh vi mobile. */}
          <div className="qc-workspace-stages qc-workspace-header-progress">
            {/* Gop Buoc 1 (request) + Buoc 2 (technical) lam MOT bubble hien
             * thi ("Yêu cầu & Kỹ thuật") - dung 1 nguoi dien hang muc+gia von
             * cung luc, khong con hanh dong rieng giua 2 buoc DB nay nua (xem
             * createRequest). STAGE_ORDER/stage van giu nguyen 4 gia tri DB o
             * moi noi khac (permission/SLA...), CHI gop rieng phan hien thi. */}
            {([
              { key: 'request_technical' as const, label: 'Yêu cầu & Kỹ thuật', repr: (stage === 'technical' ? 'technical' : 'request') as QuoteProcessingStage },
              { key: 'pricing' as const, label: stageLabel('pricing'), repr: 'pricing' as QuoteProcessingStage },
              { key: 'review' as const, label: stageLabel('review'), repr: 'review' as QuoteProcessingStage },
            ]).map((s, index, arr) => {
              const currentIdx = STAGE_ORDER.indexOf(stage);
              const state: 'done' | 'current' | 'upcoming' | 'halted' = isCancelled
                ? 'halted'
                : !isDraft
                  ? 'done'
                  : s.key === 'request_technical'
                    ? (currentIdx > STAGE_ORDER.indexOf('technical') ? 'done' : 'current')
                    : stageState(s.repr);
              const owner = stageOwnerName(s.repr);
              const time = stageTimeLabel(s.repr);
              const meta = [owner, time].filter(Boolean).join(' · ');
              return (
                <div className={`qc-stagebar-step qc-stagebar-step--${state}`} key={s.key}>
                  <span className="qc-stagebar-circle">{state === 'done' ? '✓' : index + 1}</span>
                  <span className="qc-stagebar-text">
                    <span className="qc-stagebar-label">{s.label}</span>
                    {meta ? <span className="qc-stagebar-meta">{meta}</span> : null}
                  </span>
                  {index < arr.length - 1 ? <span className="qc-stagebar-connector" aria-hidden="true" /> : null}
                </div>
              );
            })}
          </div>

          <div className="qc-workspace-header-actions">
            {/* BUG THAT DA GAP ("xóa 3 này đi, nút tạo phiên bản chỉ hiện
             * bước đã duyệt thôi"): "Lưu"/"← Danh sách" o day TRUNG LAP 100%
             * voi cac nut cung chuc nang da co san o footer (xem
             * qc-workspace-footer - moi stage deu co "Lưu" rieng, "← Danh
             * sách" da co san khi !isDraft/khi con la ban nhap) - bo han 2
             * nut nay khoi header, chi giu nut Dong (X). "Tạo phiên bản mới"
             * TRUOC DAY luon hien (disabled+tooltip khi chua duyet) - gio
             * CHI RENDER khi that su dang o trang thai duyet
             * (!versionButtonState.disabled, dung DUNG dieu kien co san,
             * khong doan lai). */}
            {!versionButtonState.disabled ? (
              <button
                type="button"
                className="qc-btn qc-workspace-header-btn-desktop-only"
                disabled={busy}
                title={versionButtonState.tooltip}
                onClick={() => {
                  if (existingDraftVersion) {
                    void load(existingDraftVersion.id);
                  } else {
                    setVersionModalOpen(true);
                  }
                }}
              >
                <GitBranchPlus className="qc-icon" /> {versionButtonState.label}
              </button>
            ) : null}
            {/* "Lưu / Chỉnh sửa" DA CHUYEN xuong footer, dat canh nut "Bàn
             * giao" (xem qc-workspace-footer, đổi tên thành "Lưu / Bản
             * nháp") theo yeu cau moi - header gio chi con nut Dong (X).
             * Bam X hieu ngam la Huỷ, khong con nut chu "Huỷ" rieng o
             * footer nua. */}
            <button type="button" className="crm-icon-action qc-workspace-header-btn-desktop-only" aria-label="Đóng" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>
              <X className="qc-inline-icon" />
            </button>
          </div>
        </header>

        {/* Tom tat progress GON cho mobile (≤767px, CSS an tren desktop) -
         * "Bước X/3 — {label}" 1 dong duy nhat thay vi ep ca 3 buoc + connector
         * + meta nguoi phu trach vao 1 hang chat chu nho. Tinh truc tiep bang
         * JSX (khong doan qua CSS an/hien tung buoc) de chac chan dung noi
         * dung buoc hien tai. */}
        <div className="qc-stagebar-mobile-summary">
          {(() => {
            const mobileSteps = [
              { key: 'request_technical' as const, label: 'Yêu cầu & Kỹ thuật', repr: (stage === 'technical' ? 'technical' : 'request') as QuoteProcessingStage },
              { key: 'pricing' as const, label: stageLabel('pricing'), repr: 'pricing' as QuoteProcessingStage },
              { key: 'review' as const, label: stageLabel('review'), repr: 'review' as QuoteProcessingStage },
            ];
            const currentIdx = STAGE_ORDER.indexOf(stage);
            const states = mobileSteps.map(s =>
              isCancelled
                ? 'halted'
                : !isDraft
                  ? 'done'
                  : s.key === 'request_technical'
                    ? (currentIdx > STAGE_ORDER.indexOf('technical') ? 'done' : 'current')
                    : stageState(s.repr)
            );
            let activeIndex = states.findIndex(s => s === 'current');
            if (activeIndex === -1) activeIndex = states.lastIndexOf('done');
            if (activeIndex === -1) activeIndex = 0;
            return `Bước ${activeIndex + 1}/${mobileSteps.length} — ${mobileSteps[activeIndex].label}`;
          })()}
        </div>

        <div className="qc-workspace-info-strip">
        <div className="qc-workspace-info-strip-row">
          <div data-qc-required="customer">
            <span className="qc-workspace-info-label">Khách hàng <span className="qc-required-mark">*</span></span>
            {!quote && lockCustomer ? (
              <strong>{customers.find(c => c.id === draftCustomerId)?.label || 'Đang tải…'}</strong>
            ) : !quote ? (
              <SearchableSelect
                value={draftCustomerId}
                onChange={selectDraftCustomer}
                options={customers.map(c => ({ value: c.id, label: c.label }))}
                actions={[
                  { key: 'create-customer', label: '+ Tạo khách hàng mới', onSelect: () => setCustomerDrawerOpen(true), type: 'add' },
                  { key: 'manage-customers', label: 'Quản lý khách hàng', onSelect: () => window.open('/all-platform/crm/customers', '_blank', 'noopener,noreferrer'), type: 'manage' },
                ]}
                placeholder="Chọn khách hàng..."
              />
            ) : (
              // Quote da tao xong: KHONG con doi Khach hang duoc that su
              // (backend chua co API doi deal_id tren quote da ton tai) -
              // nhung van hien dang o box giong Du an/Presale/Sale (khong
              // hien nhu 1 nhan chu thuong bi khoa cung) de giao dien nhat
              // quan - dung SearchableSelect disabled voi 1 option duy nhat
              // la gia tri hien tai.
              // BUG THAT DA GAP (audit thuc te tren du lieu that, quote
              // 202609220703 "Unifarm"): truoc day o day doc thang
              // deal?.customerName - field nay o customer_leads la TEN
              // NGUOI/contact-style (vd "Phương Uyển"), KHONG phai ten cong
              // ty (xem comment o dau file/CLAUDE.md ve domain quirk nay) -
              // hien no o o "Khách hàng" (dung de la CONG TY) lam nguoc voi
              // "Người liên hệ" ben canh khi 2 field nay tinh co khac nhau.
              // Uu tien snapshot cong ty THAT da luu tren chinh quote
              // (data.customerCompanyName, dien tu luc tao - xem createRequest)
              // roi moi fallback deal.companyName/deal.customerName.
              <SearchableSelect
                value="current"
                onChange={() => {}}
                options={[{ value: 'current', label: (quote?.data?.customerCompanyName as string | undefined) || deal?.companyName || deal?.customerName || 'Chưa gắn cơ hội' }]}
                disabled
              />
            )}
            {requiredFieldErrors.customer ? <p className="qc-field-error">{requiredFieldErrors.customer}</p> : null}
          </div>
          {/* "Người liên hệ" la thong tin hien tren ban khach (PDF) - thuoc
           * phase thuong mai cua Sale, KHONG con la trach nhiem Presale luc
           * tao yeu cau (feedback 2026-09-25 "presale bỏ luôn chỗ người liên
           * hệ, này phase của sale") - AN HOAN TOAN khoi Buoc 1 (khong render,
           * khong con bat buoc), CHI hien tu Buoc 2 (Sale, beyondStep1) tro
           * di, dung chung dieu kien voi Đơn vị phát hành ngay ben duoi. */}
          {beyondStep1 ? (
          <div data-qc-required="contact">
            <span className="qc-workspace-info-label">Người liên hệ <span className="qc-required-mark">*</span></span>
            {!quote ? (
              <SearchableSelect
                value={draftContactId}
                onChange={selectDraftContact}
                disabled={!draftCustomerId || contactsLoading}
                loading={contactsLoading}
                options={contacts.map(c => ({
                  value: c.id,
                  label: `${c.name}${c.is_primary ? ' · Chính' : ''}${c.position || c.position_label_snapshot ? ` (${c.position || c.position_label_snapshot})` : ''}`,
                }))}
                placeholder={!draftCustomerId ? 'Chọn khách hàng trước' : contactsLoadedFor === draftCustomerId && contacts.length === 0 ? 'Khách hàng chưa có người liên hệ' : 'Chọn người liên hệ...'}
                emptyText="Khách hàng này chưa có Người liên hệ nào."
                actions={draftCustomerId ? [
                  { key: 'create-contact', label: '+ Tạo người liên hệ mới', onSelect: openCreateContact, type: 'add' },
                ] : []}
              />
            ) : (
              <SearchableSelect
                value="current"
                onChange={() => {}}
                options={[{ value: 'current', label: draftRecipientFields.customerRecipient || 'Đã lưu' }]}
                disabled
              />
            )}
            {requiredFieldErrors.contact ? <p className="qc-field-error">{requiredFieldErrors.contact}</p> : null}
          </div>
          ) : null}
          {!beyondStep1 ? dealField : null}
          {/* "Presale không làm phần thương mại" (feedback 2026-09-24, kem
           * screenshot - "ẩn đi luôn, không xem được, KHÔNG phải khoá"): Đơn
           * vị phát hành CHI hien tu Buoc 2 (Sale, pricingStageOk) tro di -
           * AN HOAN TOAN (khong render, khong phai disabled) luc Presale tao
           * yeu cau hoac con o Buoc 1 (request/technical), dung chung
           * beyondStep1 voi Dự án/Loại báo giá/Kế hoạch thanh toán. TRUOC DAY
           * co hien 1 tom tat disabled cho ca 2 truong hop nay - da bo, vi
           * yeu cau ro rang la AN, khong phai khoa+hien preview. */}
          {beyondStep1 ? (
            <div data-qc-required="issuerCompany">
              <span className="qc-workspace-info-label">Đơn vị phát hành <span className="qc-required-mark">*</span></span>
              {isDraft && canEdit && pricingStageOk ? (
                <SearchableSelect
                  // Mac dinh hien "MARKEE AI" (effectiveIssuerCompany, xem noi
                  // dinh nghia) khi quote chua tung gan issuerCompanyId - CHI
                  // la mac dinh HIEN THI, chua ghi xuong DB cho toi khi Sale
                  // thuc su bam chon (onChange) - tranh am tham gan issuer
                  // ma khong ai bam gi ca.
                  value={quote?.issuerCompanyId || effectiveIssuerCompany?.id || ''}
                  onChange={value => { if (value) void updateQuoteIssuerCompany(value); }}
                  options={issuerCompanies.map(company => ({ value: company.id, label: company.brandName || company.legalName }))}
                  placeholder="Chọn đơn vị phát hành..."
                  hideClearOption
                />
              ) : (
                <SearchableSelect
                  value="current"
                  onChange={() => {}}
                  options={[{ value: 'current', label: effectiveIssuerCompany?.brandName || effectiveIssuerCompany?.legalName || 'Chưa chọn' }]}
                  disabled
                />
              )}
              {requiredFieldErrors.issuerCompany ? <p className="qc-field-error">{requiredFieldErrors.issuerCompany}</p> : null}
            </div>
          ) : null}
        </div>
        {/* Hang 2 (Du an/Mau bao gia loi/Loai bao gia/Hieu luc den) - o Buoc 1
         * (Presale, chua beyondStep1) hang nay thuong RONG hoan toan (moi field
         * deu an) - bo qua render de khong con 1 khoang gap 6px thua giua 2
         * hang (feedback "3 cai de chung 1 hang, dung de duoi vay nua"). */}
        {(!quote && lockProject) || Boolean(quote) || (!quote && quoteForms.length > 0 && !draftFormId && !defaultFormId) || quote?.validUntil ? (
        <div className="qc-workspace-info-strip-row">
          {/* "Presale không làm phần thương mại" (feedback 2026-09-24, kem
           * screenshot - "ẩn đi luôn, không xem được, KHÔNG phải khoá"): Dự
           * án CHI hien tu Buoc 2 (Sale, beyondStep1) tro di - AN HOAN TOAN
           * (khong render) luc Presale tao yeu cau hoac con o Buoc 1. Truong
           * hop lockProject (tao tu Project card) van hien READ-ONLY - do la
           * NGU CANH duoc chon san TRUOC khi Presale bat dau, khong phai
           * Presale tu chon nen khong thuoc dien phai an. Bat buoc (*) +
           * validate truoc khi gui duyet - xem requiredFieldErrors.project va
           * handoffPricingToReview(). */}
          {(!quote && lockProject) || beyondStep1 ? (
            <div data-qc-required="project">
              <span className="qc-workspace-info-label">Dự án <span className="qc-required-mark">*</span></span>
              {!quote && lockProject ? (
                <strong>
                  {(() => {
                    const found = (projects || []).find(p => p.id === draftProjectId);
                    return found ? `${found.projectCode} · ${found.name}` : 'Đang tải…';
                  })()}
                </strong>
              ) : isDraft && canEdit && pricingStageOk ? (
                !effectiveCustomerIdForProjects ? (
                  <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Cơ hội chưa gắn hồ sơ khách hàng</span>
                ) : projects === null ? (
                  <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải…</span>
                ) : (
                  <SearchableSelect
                    value={quote?.projectId || ''}
                    onChange={value => {
                      if (value === CREATE_NEW_PROJECT_OPTION) {
                        setProjectModalOpen(true);
                        return;
                      }
                      if (value) clearRequiredError('project');
                      void updateQuoteProject(value);
                    }}
                    // BUG THAT DA GAP ("lặp 2 chữ Chưa thuộc dự án"): SearchableSelect
                    // TU render san 1 nut "clear" o dau danh sach dung chinh
                    // `placeholder` lam nhan (xem SearchableSelect.tsx) - truoc day
                    // options con khai bao THEM 1 dong { value: '', label: 'Chưa
                    // thuộc dự án' } giong het, thanh ra hien 2 dong trung nhau.
                    // Chi can placeholder, KHONG khai bao lai value='' trong options.
                    options={[
                      { value: CREATE_NEW_PROJECT_OPTION, label: '+ Tạo dự án mới…' },
                      ...projects.map(p => ({ value: p.id, label: `${p.projectCode} · ${p.name}` })),
                    ]}
                    placeholder="Chưa thuộc dự án"
                    hideClearOption
                  />
                )
              ) : (
                <SearchableSelect
                  value="current"
                  onChange={() => {}}
                  options={[{
                    value: 'current',
                    label: (() => {
                      const found = (projects || []).find(p => p.id === quote?.projectId);
                      return found ? `${found.projectCode} · ${found.name}` : quote?.projectId ? 'Đang tải…' : 'Chưa chọn';
                    })(),
                  }]}
                  disabled
                />
              )}
              {requiredFieldErrors.project ? <p className="qc-field-error">{requiredFieldErrors.project}</p> : null}
            </div>
          ) : null}
          {beyondStep1 ? dealField : null}
          {/* "Presale không làm phần thương mại" (feedback) - Mẫu báo giá
           * cung la field thuong mai, AN het khoi Presale luc tao yeu cau
           * (!quote) - draftFormId van tu dien ngam qua defaultFormId (xem
           * effect dong ~1070). Van giu 1 khung "form" cho focusFirstRequiredError
           * neu he thong chua cau hinh mau mac dinh nao (loi that, khong phai
           * Presale quen chon). */}
          {!quote && quoteForms.length > 0 && !draftFormId && !defaultFormId ? (
            <div data-qc-required="form">
              <span className="qc-workspace-info-label">Mẫu báo giá</span>
              <p className="qc-field-error">Hệ thống chưa có mẫu báo giá mặc định — liên hệ Admin cấu hình trước khi tạo yêu cầu.</p>
              {requiredFieldErrors.form ? <p className="qc-field-error">{requiredFieldErrors.form}</p> : null}
            </div>
          ) : null}
          {/* "Sale vẫn chọn được mẫu báo giá chứ, ... vẫn có thể đổi được"
           * (feedback 2026-09-24) - quote DA TON TAI (Buoc 2/3) truoc gio
           * KHONG hien ten mau bao gia dang dung o dau ca. Gio hien 1 dropdown
           * THAT SU chon duoc tu do (updateQuoteFormId, doc lap voi auto-fill
           * "an theo" Don vi phat hanh o updateQuoteIssuerCompany) - auto-fill
           * chi la GOI Y mac dinh luc doi issuer, Sale van doi tay lai duoc
           * sang bat ky mau nao khac binh thuong. */}
          {quote ? (
            <div data-qc-required="quoteForm">
              <span className="qc-workspace-info-label">Mẫu báo giá</span>
              {isDraft && canEdit && pricingStageOk ? (
                <SearchableSelect
                  value={quote.quoteFormId || ''}
                  onChange={value => { if (value) void updateQuoteFormId(value); }}
                  options={quoteForms.map(f => ({ value: f.id, label: f.name }))}
                  placeholder="Chọn mẫu báo giá..."
                  hideClearOption
                />
              ) : (
                <SearchableSelect
                  value="current"
                  onChange={() => {}}
                  options={[{ value: 'current', label: quoteForms.find(f => f.id === quote.quoteFormId)?.name || 'Không rõ mẫu' }]}
                  disabled
                />
              )}
            </div>
          ) : null}
          {/* "Presale không làm phần thương mại" (feedback 2026-09-24, kem
           * screenshot - "ẩn đi luôn, không xem được, KHÔNG phải khoá"): AN
           * HOAN TOAN khoi Presale (khong render) luc tao yeu cau hoac con o
           * Buoc 1, dung chung beyondStep1 voi Dự án/Đơn vị phát hành/Kế
           * hoạch thanh toán - CHI hien tu Buoc 2 (Sale) tro di. */}
          {beyondStep1 ? (
          <div
            tabIndex={-1}
            onBlur={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setQuoteTypeDropdownOpen(false);
            }}
            style={{ position: 'relative' }}
          >
            <span className="qc-workspace-info-label">Loại báo giá</span>
            <div
              className={`qc-quote-type-control${canEditQuoteType ? ' qc-quote-type-control--editable' : ''}`}
              onClick={() => canEditQuoteType && setQuoteTypeDropdownOpen(v => !v)}
            >
              {currentQuoteTypeCodes.length === 0 ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Chọn loại báo giá...</span>
              ) : (
                <div className="qc-quote-type-chips">
                  {currentQuoteTypeCodes.map(code => (
                    <span key={code} className="qc-quote-type-chip">
                      {quoteTypeLabel(code)}
                      {canEditQuoteType ? (
                        <button
                          type="button"
                          aria-label={`Bỏ chọn ${quoteTypeLabel(code)}`}
                          onClick={e => { e.stopPropagation(); toggleQuoteTypeCode(code); }}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {quoteTypeDropdownOpen && canEditQuoteType ? (
              <div className="qc-quote-type-dropdown">
                <input
                  autoFocus
                  className="qc-cell-input"
                  placeholder="Tìm loại báo giá..."
                  value={quoteTypeSearch}
                  onChange={e => setQuoteTypeSearch(e.target.value)}
                />
                <div className="qc-quote-type-dropdown-list">
                  {quoteTypeOptions
                    .filter(o => o.label.toLowerCase().includes(quoteTypeSearch.trim().toLowerCase()))
                    .map(o => (
                      <label key={o.value} className="qc-quote-type-option">
                        <input type="checkbox" checked={currentQuoteTypeCodes.includes(o.value)} onChange={() => toggleQuoteTypeCode(o.value)} />
                        {o.label}
                      </label>
                    ))}
                  {quoteTypeOptions.length === 0 ? (
                    <div className="qc-workspace-muted" style={{ fontSize: 12, padding: 8 }}>
                      Chưa có Loại báo giá nào trong Danh mục CRM.
                    </div>
                  ) : null}
                  <div className="crm-searchable-select-actions">
                    <div className="crm-searchable-select-divider" />
                    <button type="button" className="crm-searchable-select-action" onClick={() => { setQuoteTypeDropdownOpen(false); setQuoteTypeQuickAddOpen(true); }}>
                      + Thêm loại báo giá
                    </button>
                    <button type="button" className="crm-searchable-select-action" onClick={() => { setQuoteTypeDropdownOpen(false); setQuoteTypeManageOpen(true); }}>
                      Quản lý loại báo giá
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          ) : null}
          {/* Presale/Sale/SLA DA CHUYEN sang sidebar (card "Phân công & SLA",
           * xem <aside className="qc-workspace-side"> ben duoi) theo yeu cau
           * rieng "Phân công & SLA để bên sidebar luôn" - KHONG con nam
           * trong info-strip hang 2 nua, chi con "Loại báo giá"/"Hiệu lực
           * đến" o day. */}
          {quote?.validUntil ? (
            <div>
              <span className="qc-workspace-info-label">Hiệu lực đến</span>
              <strong>{formatDate(quote.validUntil)}</strong>
            </div>
          ) : null}
        </div>
        ) : null}
        </div>

        <div className="qc-workspace-body" ref={workspaceBodyRef}>
          <div className="qc-workspace-main">
            {!quote || isDraft ? (
              // Gop Buoc 1+2: quote co the da duoc tu dong tao ngam (xem
              // createRequest()) ngay khi dang go - KHONG duoc chuyen sang
              // dang "xem tom tat + bam Chinh sua" chi vi da co quote, Sale
              // van dang cam nhan "con o Buoc 1" nen phai giu dung 1 kieu
              // giao dien go truc tiep (khong toggle) xuyen suot. Khi quote
              // da ton tai, doi sang doc/ghi tu editSummary/editScope/
              // editExpectedProducts (da co san co che dong bo + luu qua
              // saveScopeSummary() - xem effect [quote?.id] o tren) thay vi
              // draftSummary/draftScope (chi la buffer cuc bo truoc khi tao).
              <details
                className="qc-workspace-card qc-workspace-collapsible-card"
                data-qc-anchor="scope"
                data-testid="qc-scope-card"
                open={scopeCardOpen}
                onToggle={event => setScopeCardOpen((event.target as HTMLDetailsElement).open)}
              >
                <summary className="qc-workspace-card-head qc-workspace-collapsible-summary">
                  <h3 data-testid="qc-scope-card-title">Yêu cầu &amp; phạm vi công việc</h3>
                  <span className="qc-workspace-collapsible-hint">{scopeCardOpen ? '(bấm để thu gọn)' : '(bấm để xem)'}</span>
                  {autofillMessage ? <span className="qc-workspace-autofill-toast">{autofillMessage}</span> : null}
                </summary>
                <div className="qc-workspace-request-form">
                  <div className="qc-workspace-request-form-cols">
                    <label>
                      <span className="qc-workspace-info-label">Tóm tắt nhu cầu của khách</span>
                      <textarea
                        className="qc-workspace-handoff-note"
                        rows={3}
                        disabled={quote ? !canEdit : false}
                        value={quote ? editSummary : draftSummary}
                        onChange={event => (quote ? setEditSummary : setDraftSummary)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder={draftDealId ? 'Cơ hội chưa có mô tả nhu cầu — tự nhập tại đây.' : 'Khách cần gì, bối cảnh yêu cầu...'}
                      />
                    </label>
                    <label>
                      <span className="qc-workspace-info-label">Mô tả scope / yêu cầu cần estimate</span>
                      <textarea
                        className="qc-workspace-handoff-note"
                        rows={3}
                        disabled={quote ? !canEdit : false}
                        value={quote ? editScope : draftScope}
                        onChange={event => (quote ? setEditScope : setDraftScope)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder="Phạm vi công việc cần kỹ thuật estimate..."
                      />
                    </label>
                  </div>
                  <details className="qc-workspace-request-more">
                    <summary>Sản phẩm dự kiến / Ghi chú nội bộ (tuỳ chọn)</summary>
                    <label>
                      <span className="qc-workspace-info-label">Sản phẩm / dịch vụ dự kiến (nếu có)</span>
                      <input
                        type="text"
                        className="crm-input"
                        disabled={quote ? !canEdit : false}
                        value={quote ? editExpectedProducts : draftExpectedProducts}
                        onChange={event => (quote ? setEditExpectedProducts : setDraftExpectedProducts)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder={draftDealId ? 'Chưa có sản phẩm/dịch vụ — tự nhập tại đây.' : 'Ví dụ: Gói VPS Cloud, dịch vụ tư vấn...'}
                      />
                    </label>
                    {!quote ? (
                      <label>
                        <span className="qc-workspace-info-label">Ghi chú nội bộ (không hiện cho khách)</span>
                        <textarea className="qc-workspace-handoff-note" rows={2} value={draftInternalNote} onChange={event => setDraftInternalNote(event.target.value)} placeholder="Ghi chú riêng cho đội xử lý..." />
                      </label>
                    ) : null}
                    <p className="qc-workspace-note">Chưa hỗ trợ tệp đính kèm.</p>
                  </details>
                </div>
              </details>
            ) : !isDraft ? (
              <>
                {(() => {
                  const project = (projects || []).find(p => p.id === quote.projectId);
                  const techName = quote.technicalOwnerId ? nameFor(quote.technicalOwnerId) : null;
                  const saleName = quote.quoteOwnerId ? nameFor(quote.quoteOwnerId) : null;
                  const sla = computeQuoteSla({ slaDueAt: quote.slaDueAt, completedAt: quote.completedAt, sentAt: quote.sentAt });
                  const missingLinks: string[] = [];
                  if (!deal) missingLinks.push('Chưa gắn khách hàng');
                  if (!project) missingLinks.push('Chưa thuộc dự án');
                  if (!deal) missingLinks.push('Chưa gắn cơ hội');
                  if (!quote.slaDueAt) missingLinks.push('Chưa đặt SLA');
                  return (
                    <>
                      <div className="qc-workspace-card">
                        <div className="qc-workspace-card-head">
                          <h3>Bản tóm tắt báo giá</h3>
                          <span className="qc-badge qc-badge-neutral">Version đã khoá</span>
                        </div>
                        <div className="qc-summary-grid">
                          <div><span className="qc-workspace-info-label">Khách hàng</span><strong>{deal?.customerName || 'Chưa gắn khách hàng'}</strong></div>
                          <div><span className="qc-workspace-info-label">Dự án</span><strong>{project ? `${project.projectCode} · ${project.name}` : 'Chưa thuộc dự án'}</strong></div>
                          <div><span className="qc-workspace-info-label">Cơ hội CRM</span><strong>{businessCode || (deal ? 'Cơ hội chưa có mã' : 'Chưa gắn cơ hội')}</strong></div>
                          <div><span className="qc-workspace-info-label">Presale phụ trách</span><strong>{techName || 'Chưa gán'}</strong></div>
                          <div><span className="qc-workspace-info-label">Sale phụ trách</span><strong>{saleName || 'Chưa gán'}</strong></div>
                          <div><span className="qc-workspace-info-label">SLA</span><strong>{quote.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong></div>
                          <div><span className="qc-workspace-info-label">Người duyệt</span><strong>{quote.approvedById ? nameFor(quote.approvedById) : 'Chưa duyệt'}</strong></div>
                          <div><span className="qc-workspace-info-label">Ngày duyệt</span><strong>{quote.approvedAt ? formatDate(quote.approvedAt) : '—'}</strong></div>
                        </div>
                        {missingLinks.length > 0 ? (
                          <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                            <strong>Thông tin liên kết chưa đầy đủ</strong>
                            <ul>{missingLinks.map(m => <li key={m}>{m}</li>)}</ul>
                            <p>Phiên bản đã duyệt nên không thể sửa trực tiếp. Tạo phiên bản mới để bổ sung thông tin.</p>
                          </div>
                        ) : null}
                      </div>

                      {/* Card "Hạng mục & giá khách" (QuoteDocumentRenderer
                       * rut gon) DA BO - yeu cau ro rang "XÓA NÀY Ở BƯỚC 3
                       * ĐI": trung lap 100% voi bang "Hạng mục & cấu trúc
                       * giá" that (interactive, ngay ben duoi) - quote da
                       * khoa van hien dung bang do (chi READ-ONLY qua
                       * canEdit/isDraft), khong can renderer rut gon rieng
                       * cho cung 1 du lieu. */}
                    </>
                  );
                })()}
              </>
            ) : null}
            <div
              className={`qc-workspace-card qc-workspace-items-card${itemsFullscreen ? ' qc-workspace-items-card--fullscreen' : ''}`}
              data-qc-anchor="items"
              data-qc-required="items"
            >
              <div className="qc-workspace-card-head qc-workspace-items-card-head">
                <div className="qc-workspace-items-card-head-title">
                  <h3>Hạng mục &amp; cấu trúc giá <span className="qc-required-mark">*</span></h3>
                  <span className="qc-row-sub">
                    {canEditCostCells && !canEditPricingCells
                      ? 'Bạn sửa được Giá vốn · Giá bán do Sale phụ trách nhập'
                      : canEditPricingCells && !canEditCostCells
                      ? 'Bạn sửa được Giá bán · Giá vốn do Presale phụ trách nhập (khoá)'
                      : canEditCostCells && canEditPricingCells
                      ? 'Bạn sửa được cả Giá vốn và Giá bán'
                      : 'Chỉ xem — không có quyền sửa hạng mục này'}
                  </span>
                </div>
                {/* "markup /margin cho 1 dòng với hạng mục di" - yeu cau rieng
                 * dat thanh Markup nhanh/Margin muc tieu CUNG 1 hang voi
                 * tieu de "Hạng mục & cấu trúc giá" (thay vi 1 hang rieng
                 * ben duoi) - chuyen nguyen khoi vao day, .qc-workspace-
                 * card-head da la flex justify-content:space-between nen tu
                 * nam ben phai tieu de; man hep tu xuong dong (flex-wrap:wrap
                 * da co san o .qc-workspace-items-card-head). */}
                {canEditPricingCells && isDraft ? (
                <div className="qc-workspace-quickbar qc-workspace-pricing-bar">
                    <div className="qc-pricing-group">
                      <span className="qc-workspace-info-label qc-qb-row-label">Markup</span>
                      {[30].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          className={`qc-mini-btn${lastAppliedMarkupPct === pct ? ' qc-mini-btn-active' : ''}`}
                          disabled={busy}
                          onClick={() => applyQuickMarkup(pct)}
                        >
                          +{pct}%
                        </button>
                      ))}
                      <label className="qc-workspace-quickbar-field">
                        Tuỳ chỉnh
                        <input
                          type="number"
                          className="qc-workspace-quickbar-input"
                          value={markupCustomInput}
                          onChange={event => setMarkupCustomInput(event.target.value)}
                          placeholder="vd 40"
                        />
                        %
                      </label>
                      <button
                        type="button"
                        className="qc-mini-btn"
                        disabled={busy || markupCustomInput.trim() === '' || !Number.isFinite(Number(markupCustomInput)) || !isValidMarkupPercent(Number(markupCustomInput))}
                        title="Áp Markup tuỳ chỉnh cho toàn bộ hạng mục có giá vốn hợp lệ"
                        onClick={() => applyQuickMarkup(Number(markupCustomInput))}
                      >
                        Áp dụng
                      </button>
                    </div>
                    <span className="qc-workspace-quickbar-sep" aria-hidden="true" />
                    <div className="qc-pricing-group">
                      <span className="qc-workspace-info-label qc-qb-row-label">Margin mục tiêu</span>
                      {[30].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          className={`qc-mini-btn${lastAppliedMarginPct === pct ? ' qc-mini-btn-active' : ''}`}
                          disabled={busy}
                          title="Áp ngay cho toàn bộ hạng mục có giá vốn hợp lệ"
                          onClick={() => applyTargetMargin(pct)}
                        >
                          {pct}%
                        </button>
                      ))}
                      <label className="qc-workspace-quickbar-field">
                        Tuỳ chỉnh
                        <input
                          type="number"
                          className="qc-workspace-quickbar-input"
                          value={marginCustomInput}
                          onChange={event => setMarginCustomInput(event.target.value)}
                          placeholder="vd 22"
                        />
                        %
                      </label>
                      <button
                        type="button"
                        className="qc-mini-btn"
                        disabled={busy || marginCustomInput.trim() === '' || !Number.isFinite(Number(marginCustomInput)) || Number(marginCustomInput) < 0 || Number(marginCustomInput) >= 100}
                        title="Áp Margin tuỳ chỉnh cho toàn bộ hạng mục có giá vốn hợp lệ"
                        onClick={() => applyTargetMargin(Number(marginCustomInput))}
                      >
                        Áp dụng
                      </button>
                    </div>
                    <span className="qc-qb-margin-hint" title="Ngưỡng tham chiếu, không tự động chặn">Ngưỡng margin tham chiếu: 20%</span>
                </div>
                ) : null}
                <button
                  type="button"
                  className="qc-mini-btn qc-workspace-items-fullscreen-btn"
                  onClick={() => setItemsFullscreen(value => !value)}
                  title={itemsFullscreen ? 'Thu nhỏ bảng hạng mục' : 'Phóng to bảng hạng mục'}
                  aria-label={itemsFullscreen ? 'Thu nhỏ bảng hạng mục' : 'Phóng to bảng hạng mục'}
                >
                  {itemsFullscreen ? <Minimize2 className="qc-inline-icon" /> : <Maximize2 className="qc-inline-icon" />}
                  <span>{itemsFullscreen ? 'Thu nhỏ' : 'Phóng to'}</span>
                </button>
                {canEdit && isDraft && !isLockedForReview && selectedDiscountCount > 0 ? (
                  <button
                    type="button"
                    className="qc-mini-btn qc-mini-btn-danger"
                    onClick={removeSelectedItemRows}
                    title={`Xóa ${selectedDiscountCount} hạng mục đã chọn`}
                  >
                    <Trash2 className="qc-inline-icon" />
                    <span>Xóa {selectedDiscountCount} hạng mục</span>
                  </button>
                ) : null}
              </div>
              {requiredFieldErrors.items ? <p className="qc-field-error qc-field-error--card">{requiredFieldErrors.items}</p> : null}

              {/* (Redesign Buoc 1) Preview gon "Thông tin hiển thị trên báo
               * giá" - thay 3 o input tho truoc day (D2). Che do TAO MOI
               * (!quote): sua qua popover chi ghi local state (draftRecipientFields),
               * chua co quote that de goi persistRecipientField. Bao gia DA
               * TON TAI: van hien + sua duoc CHI khi con o trang thai sua duoc
               * (draft, chua khoa review) - giu dung dieu kien khoa cu (canEdit
               * && isDraft && !isLockedForReview); da duyet/khoa thi AN HAN
               * (giu nguyen snapshot cu, giong hanh vi truoc day).
               * Feedback 2026-09-25 "chuyển qua bước 2 mới làm được, ẩn cái
               * ở bước 1 đi" - AN HOAN TOAN o Buoc 1 (!beyondStep1, ke ca
               * !quote luc tao moi), dung chung dieu kien voi Nguoi lien
               * he/Don vi phat hanh (phase thuong mai cua Sale). */}
              {beyondStep1 && canEdit && isDraft && !isLockedForReview ? (
                <RecipientInfoCard
                  recipient={draftRecipientFields}
                  editable
                  onSave={next => {
                    setDraftRecipientFields(next);
                    if (quote) {
                      (Object.keys(next) as Array<keyof RecipientSnapshot>).forEach(key => {
                        if (next[key] !== draftRecipientFields[key]) persistRecipientField(key, next[key]);
                      });
                    }
                  }}
                />
              ) : null}

              {canEditCostCells && isDraft && itemsDraft.length > 0 && itemsMissingCost.length > 0 ? (
                <div className="qc-workspace-warning-banner">
                  Còn {itemsMissingCost.length}/{itemsDraft.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu &quot;Không áp dụng giá vốn&quot; — cần bổ sung trước khi bàn giao.
                </div>
              ) : null}
              {/* Bang THONG NHAT: Cost (Presale) + Pricing (Sale) tren CUNG 1
                  dong, khong con tab rieng - dung yeu cau "Sale phai doi chieu
                  duoc cost va markup cung dong". overflow-x rieng cho bang
                  (khong lam vo trang) - xem .qc-table-wrap trong quote-center.css. */}
              <div className="qc-table-wrap qc-workspace-items-scroll">
                <table className={`qc-linked-table qc-workspace-items-table qc-workspace-items-table--unified${itemsDraft.length > 0 ? ' qc-workspace-items-table--has-rows' : ''}`}>
                  {/* BUG THAT DA GAP ("Margin bi cat '23....', cot Thao tac
                   * troi ra ngoai bang"): width % qua nth-child KHONG dang
                   * tin cay duoi table-layout:fixed khi noi dung 1 cell (vd
                   * 2 nut icon +/⋮ trong Thao tac) co kich thuoc PIXEL toi
                   * thieu lon hon % da phan, khien ca hang vuot qua container
                   * - .qc-workspace-items-scroll dang overflow-x:hidden nen
                   * PHAN VUOT bi cat mat thay vi cuon, dung ngay cot cuoi
                   * (Margin/Thao tac). Dung <colgroup> voi PX CO DINH cho moi
                   * cot hep/co dinh (DVT/SL/Gia von/Cost tong/Markup/Gia
                   * khach/Thanh tien/Margin/Thao tac) + de rieng "Hạng mục"
                   * KHONG khai bao width - day la cach table-layout:fixed
                   * tin cay nhat (dung chuan CSS: cot khong khai bao width se
                   * tu chia het phan con lai), khong con phu thuoc content
                   * "vua khit" % duoc gan tren th/td nua.
                   * (A1, phien sau) "Hạng mục"/"Mô tả" van qua hep de doc noi
                   * dung dai that (yeu cau rieng) - chuyen 2 cot nay SANG PX
                   * CO DINH luon (thay vi de trong/tu chia deu nhu truoc),
                   * dung nguyen tac PX co dinh CHUNG voi cac cot con lai o
                   * tren, tranh 2 cot bi chia deu 50/50 khong theo y muon.
                   * qc-workspace-items-table--unified.min-width (quote-center.css)
                   * da tang tuong ung theo tong 12 cot moi (bao gom TỶ TRỌNG).
                   * (Fix lech cot Hạng mục, phien sau A1): 210px la TONG ca
                   * cot 1 bao gom ca vung drag-handle/checkbox/STT (grid
                   * "60px 1fr" trong .qc-workspace-item-name-cell) - vung
                   * CHU THAT SU con lai chi ~146px, qua hep so voi yeu cau
                   * rieng "220px la vung noi dung ten, khong tinh drag/
                   * checkbox/STT/action". Tang tong cot len 330px (60px
                   * control + ~266px cho ten, du > 220px yeu cau) - chi doi
                   * o day, KHONG doi grid-template-columns cua
                   * .qc-workspace-item-name-cell (van "60px 1fr", 1fr tu
                   * dong nhan them do rong moi). */}
                  <colgroup>
                    <col style={{ width: '330px' }} />
                    <col style={{ width: '300px' }} />
                    <col style={{ width: '92px' }} />
                    <col style={{ width: '64px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '96px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '82px' }} />
                    <col style={{ width: '88px' }} />
                    {canEdit && isDraft && !isLockedForReview ? <col style={{ width: '44px' }} /> : null}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="qc-th-name">
                        <span className="qc-workspace-th-name-content">
                          {canEdit && isDraft && !isLockedForReview && selectableDiscountRowKeys.length > 0 ? (
                            <input
                              type="checkbox"
                              className="qc-workspace-item-select"
                              checked={selectedDiscountCount === selectableDiscountRowKeys.length}
                              ref={node => {
                                if (node) node.indeterminate = selectedDiscountCount > 0 && selectedDiscountCount < selectableDiscountRowKeys.length;
                              }}
                              title="Chọn tất cả hạng mục"
                              aria-label="Chọn tất cả hạng mục"
                              onChange={event => toggleAllItemSelection(event.target.checked)}
                            />
                          ) : null}
                          <span>Hạng mục</span>
                        </span>
                      </th>
                      <th className="qc-th-desc">Mô tả</th>
                      <th className="qc-th-unit">ĐVT</th>
                      <th className="qc-th-money qc-th-qty">SL</th>
                      <th className="qc-th-money qc-th-cost">Giá vốn/ĐV</th>
                      <th className="qc-th-money qc-th-cost">Cost tổng</th>
                      <th className="qc-th-money qc-th-markup">Markup</th>
                      <th className="qc-th-money qc-th-markup">Giá khách/ĐV</th>
                      <th className="qc-th-money qc-th-total">Thành tiền</th>
                      <th className="qc-th-money qc-th-margin-col">Margin</th>
                      {profitabilityViewAllowed ? (
                        <th className="qc-th-money qc-th-weight" title="Tỷ trọng hạng mục trên tổng giá trị báo giá">TỶ TRỌNG</th>
                      ) : (
                        <th className="qc-th-money qc-th-weight" title="Tỷ trọng hạng mục trên tổng giá trị báo giá" />
                      )}
                      {canEdit && isDraft && !isLockedForReview ? <th className="qc-th-actions qc-cell-actions--menu" aria-label="Thao tác" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {itemsDraft.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="qc-empty qc-workspace-items-empty-cell">
                          {/* CHOT LAI (yeu cau moi nhat "Trả các nút thêm hạng
                           * mục xuống dưới bảng"): 3 nut Chọn từ danh mục/
                           * Thêm hạng mục/+ Mục cha da chuyen XUONG DUOI bang
                           * (xem .qc-workspace-add-row ngay sau </table>),
                           * KHONG con nam tren header khoi nua - o day CHI
                           * giu rieng "Nạp từ báo giá gần nhất" (dac thu cho
                           * trang thai rong, khong nam trong bo 3 nut chuan). */}
                          <div className="qc-workspace-items-empty">
                            <span>Chưa có hạng mục nào.</span>
                            {canEdit && isDraft && !isLockedForReview && recentDealQuote ? (
                              <div className="qc-workspace-items-empty-actions">
                                <button type="button" className="qc-mini-btn" onClick={loadFromRecentQuote}>
                                  Nạp từ báo giá gần nhất ({recentDealQuote.quoteNumber})
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (() => {
                        // Muc cha (Section)/hang muc con - migration 104. So
                        // La Ma dem RIENG cho section (theo thu tu xuat hien),
                        // so 01/02/03 dem LIEN TUC cho hang muc that xuyen
                        // suot ca bang (KHONG reset lai moi nhom - dung khop
                        // cach danh so 01-21 lien tuc qua ca 3 "GIAI DOAN"
                        // trong file Excel mau).
                        let sectionCounter = 0;
                        let itemCounter = 0;
                        const canDragRows = canEdit && isDraft && !isLockedForReview;
                        // (B)/(C) mau so chung cho ca Tong tien section VA Ty
                        // trong - dung calculateQuoteTotals (cong tren
                        // calculateItemTotal) de luon cung 1 co so voi tu so
                        // (calculateItemTotal/calculateSectionTotal), khong
                        // lech nhau du hang muc nao thay doi.
                        const workspaceQuoteTotal = calculateQuoteTotals(itemsDraft).totalAmount;
                        return itemsDraft.map((item, index) => {
                          if (item.rowType === 'section') {
                            sectionCounter += 1;
                            const roman = toRomanNumeral(sectionCounter);
                            // (B) Tong tien truc tiep cac hang muc con cua
                            // section nay (parentItemId === item.id) - KHONG
                            // de quy sau hon, dung chung 1 ham voi
                            // QuoteDocumentRenderer (xem calculateSectionTotal).
                            const sectionChildren = itemsDraft.filter(row => row.parentItemId === item.id);
                            const sectionTotal = calculateSectionTotal(sectionChildren);
                            return (
                              <tr
                                key={item.id || index}
                                className="qc-workspace-section-row"
                                draggable={canDragRows}
                                onDragStart={() => handleRowDragStart(index)}
                                onDragOver={canDragRows ? event => event.preventDefault() : undefined}
                                onDrop={canDragRows ? () => handleRowDrop(index, true) : undefined}
                              >
                                {/* Ten data columns (them "Mô tả"), plus the separate action cell when editable. */}
                                <td colSpan={8}>
                                  {canDragRows ? <span className="qc-workspace-drag-handle" title="Kéo để sắp xếp">⠿</span> : null}
                                  {/* Roman numeral (I/II/III...) dat TRUOC ten muc (ben trai) thay vi
                                   * sau nhu cu - o kich thuoc nho, badge "I" dat SAU chu de bi doc
                                   * nham thanh dau "!" (theo dung phan anh "I la mã nằm khúc bên
                                   * trái đầu trc chữ hạ á"). */}
                                  <span className="qc-workspace-section-roman">{roman}</span>
                                  {canEdit && isDraft && !isLockedForReview ? (
                                    <input
                                      className="qc-cell-input qc-workspace-section-input"
                                      value={stripLeadingRomanPrefix(item.description || '', roman)}
                                      onChange={e => updateRow(index, { description: e.target.value })}
                                      onBlur={() => void persistQuote({}, { silent: true })}
                                      placeholder="Tên mục cha"
                                    />
                                  ) : (
                                    <strong>{stripLeadingRomanPrefix(item.description || '', roman) || 'Mục mới'}</strong>
                                  )}
                                  {/* Yeu cau moi nhat: Muc cha KHONG con nut them nao
                                   * ca - 2 icon "+"/"danh mục" chuyen het xuong
                                   * TUNG dong hang muc con (cot Thao tac) thay vi
                                   * dat rieng tren hang Muc cha. */}
                                </td>
                                <td className="qc-cell-money" data-label="Thành tiền"><strong>{formatMoney(sectionTotal)}</strong></td>
                                <td className="qc-cell-money qc-th-margin-col" data-label="Margin" />
                                <td className="qc-cell-money qc-th-weight" data-label="Tỷ trọng">
                                  {!profitabilityViewAllowed ? (
                                    <span className="qc-row-sub">—</span>
                                  ) : (
                                    <strong>{formatWeightPercent(sectionTotal, workspaceQuoteTotal)}</strong>
                                  )}
                                </td>
                                {canEdit && isDraft && !isLockedForReview ? (
                                  <td className="qc-cell-actions qc-cell-actions--menu">
                                    <ActionMenu
                                      label="Thao tác mục cha"
                                      items={[
                                        { key: 'up', label: 'Di chuyển lên', icon: ChevronUp, onSelect: () => moveRowUpDown(index, -1), group: 1 },
                                        { key: 'down', label: 'Di chuyển xuống', icon: ChevronDown, onSelect: () => moveRowUpDown(index, 1), group: 1 },
                                        { key: 'delete', label: 'Xoá mục cha (và toàn bộ hạng mục con)', icon: Trash2, danger: true, onSelect: () => removeItemRow(index), group: 2 },
                                      ]}
                                    />
                                  </td>
                                ) : null}
                              </tr>
                            );
                          }
                        itemCounter += 1;
                        const displayNo = String(itemCounter).padStart(2, '0');
                        const unitPriceValue = item.unitPrice ?? 0;
                        const margin = item.costPrice != null && unitPriceValue > 0 ? ((unitPriceValue - item.costPrice) / unitPriceValue) * 100 : null;
                        const costTotal = item.costPrice != null ? item.costPrice * item.quantity : null;
                        const editableTechnicalCells = canEditCostCells;
                        const editableCells = canEditPricingCells;
                        const bundleChildRows = bundleComponentsToWorkspaceRows(item, catalogFlatItems);
                        const isBundleRow = bundleChildRows.length > 0;
                        const bundleMode = bundleSnapshotPricingMode(item);
                        const bundleTargetGm = bundleSnapshotTargetGm(item);
                        const discountKey = discountRowKey(item, index);
                        const discountSelected = selectedDiscountRowKeys.has(discountKey);
                        const mainRow = (
                          <tr
                            key={item.id || index}
                            className={[
                              item.parentItemId ? 'qc-workspace-item-row--nested' : '',
                              item.id && costBatchIds.includes(item.id) ? 'qc-workspace-item-row--batch' : '',
                            ].filter(Boolean).join(' ') || undefined}
                            draggable={canDragRows}
                            onDragStart={() => handleRowDragStart(index)}
                            onDragOver={canDragRows ? event => event.preventDefault() : undefined}
                            onDrop={canDragRows ? () => handleRowDrop(index, false) : undefined}
                          >
                            <td data-label="Hạng mục">
                              <span className="qc-workspace-item-name-cell">
                                <span className="qc-workspace-item-no-col">
                                  {canDragRows ? <span className="qc-workspace-drag-handle" title="Kéo để sắp xếp">⠿</span> : null}
                                  {canEditPricingCells && isDraft && !isLockedForReview ? (
                                    <input
                                      type="checkbox"
                                      className="qc-workspace-item-select"
                                      checked={discountSelected}
                                      title="Chọn hạng mục"
                                      aria-label="Chọn hạng mục"
                                      onChange={event => toggleDiscountRowSelection(discountKey, event.target.checked)}
                                    />
                                  ) : null}
                                  <span className="qc-workspace-item-no">{displayNo}</span>
                                </span>
                                <span className="qc-workspace-item-name-col">
                                <span className="qc-workspace-item-name-row">
                                  {(editableTechnicalCells || editableCells) ? (
                                    <textarea
                                      className="qc-cell-input qc-cell-textarea"
                                      rows={2}
                                      value={item.serviceDescription || ''}
                                      onChange={e => updateRow(index, { serviceDescription: e.target.value })}
                                      onBlur={() => void persistQuote({}, { silent: true })}
                                      placeholder="Tên hạng mục"
                                      title={[item.serviceDescription, item.description].filter(Boolean).join(' — ') || ''}
                                    />
                                  ) : (
                                    <span
                                      className="qc-workspace-item-name-clamp qc-workspace-item-name-clickable"
                                      title={[item.serviceDescription, item.description].filter(Boolean).join(' — ') || ''}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot(deepClone(item)); }}
                                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot(deepClone(item)); } }}
                                    >
                                      {item.serviceDescription || '—'}
                                    </span>
                                  )}
                                  {/* "Nhận biết hạng mục đã có trong Sản phẩm
                                   * & dịch vụ" - xac dinh bang catalogItemId/
                                   * priceBookItemId THAT (ID lien ket that,
                                   * KHONG so sanh theo ten). */}
                                  {/* BUG THAT DA GAP ("Bước 3 chưa hiển thị
                                   * trạng thái liên kết"): nhanh "chua lien
                                   * ket" TRUOC DAY chi render khi
                                   * canEdit && isDraft && !isLockedForReview -
                                   * an HAN icon (khong phai disable) o Buoc 3/
                                   * quote da khoa, sai yeu cau "Không được ẩn
                                   * icon chỉ vì bảng đang read-only". Dung 1
                                   * nhanh render CHUNG cho MOI buoc: co the
                                   * SUA (dau + bam duoc, mo QuickAddProductModal)
                                   * hay CHI XEM/da khoa (dau + mau xam, bam
                                   * vao chi hien thong bao huong dan tao
                                   * phien ban moi, KHONG mo form sua/KHONG
                                   * ghi de catalogItemId len version da khoa). */}
                                  {item.catalogItemId || item.priceBookItemId ? (
                                    <span
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--linked"
                                      title="Đã có trong Sản phẩm & dịch vụ"
                                      aria-label="Đã có trong Sản phẩm & dịch vụ"
                                    >
                                      <CheckCircle2 className="qc-inline-icon" />
                                    </span>
                                  ) : canEdit && isDraft && !isLockedForReview ? (
                                    <button
                                      type="button"
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--unlinked"
                                      title="Thêm vào Sản phẩm & dịch vụ"
                                      aria-label="Thêm vào Sản phẩm & dịch vụ"
                                      onClick={() => openQuickAddForRow(index)}
                                    >
                                      <Plus className="qc-inline-icon" />
                                    </button>
                                  ) : (
                                    // "k cần tạo phiên bản mới bro" - bao giá
                                    // da khoa VAN cho tao san pham vao "Sản
                                    // phẩm & dịch vụ" binh thuong (mo thang
                                    // QuickAddProductModal, khong con bat qua
                                    // luong "Tạo phiên bản mới" nua) - CHI
                                    // khac 1 diem duy nhat: KHONG ghi
                                    // catalogItemId nguoc lai dong hang muc
                                    // cua version da khoa (xem
                                    // handleQuickAddProductCreated, nhanh
                                    // `locked`), giu bat bien du lieu quote
                                    // da duyet.
                                    <button
                                      type="button"
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--unlinked qc-workspace-item-link-badge--locked"
                                      title="Thêm vào Sản phẩm & dịch vụ (báo giá đã khoá nên sẽ không liên kết vào hạng mục này)"
                                      aria-label="Thêm vào Sản phẩm & dịch vụ"
                                      onClick={() => openQuickAddForRow(index, true)}
                                    >
                                      <Plus className="qc-inline-icon" />
                                    </button>
                                  )}
                                  {/* "Chỉnh Phạm vi bảo hành & Ghi chú/Khuyến mãi" -
                                   * icon RIENG, KHONG them cot vao bang. "Nội dung
                                   * công việc" da chuyen ra textarea sua truc tiep
                                   * ngay duoi ten (xem ben tren), popover nay gio
                                   * giu "Phạm vi bảo hành" + "Ghi chú/Khuyến mãi"
                                   * (dung cho "Mẫu ưu đãi combo (Markee)"). Trang
                                   * thai icon khac han khi DA CO gia tri (dam, to
                                   * mau) vs CHUA CO (nhat) de de nhan biet - bam mo
                                   * popover ca 2 truong hop, CHI khac o quyen sua
                                   * (readOnly khi khoa/Buoc 3). */}
                                  <button
                                    type="button"
                                    className={`qc-workspace-item-desc-btn${item.warrantyScope || item.note ? ' qc-workspace-item-desc-btn--filled' : ''}`}
                                    title="Chỉnh sửa phạm vi bảo hành & ghi chú/khuyến mãi"
                                    aria-label="Chỉnh sửa phạm vi bảo hành & ghi chú/khuyến mãi"
                                    onClick={() => openDescriptionPopover(index)}
                                  >
                                    <FileText className="qc-inline-icon" />
                                  </button>
                                  {canEdit && isDraft && !isLockedForReview ? (
                                    <span className="qc-workspace-item-quick-add">
                                      <button
                                        type="button"
                                        className="qc-mini-btn-icon qc-workspace-item-quick-add-btn"
                                        title="Thêm hạng mục trống ngay sau dòng này"
                                        aria-label="Thêm hạng mục trống ngay sau dòng này"
                                        onClick={() => addBlankItemAfterIndex(index)}
                                      >
                                        <Plus className="qc-inline-icon" />
                                      </button>
                                      <button
                                        type="button"
                                        className="qc-mini-btn-icon qc-workspace-item-quick-add-btn"
                                        title="Chọn từ danh mục, chèn ngay sau dòng này"
                                        aria-label="Chọn từ danh mục, chèn ngay sau dòng này"
                                        onClick={() => void openCatalogPicker({ afterIndex: index })}
                                      >
                                        <LayoutGrid className="qc-inline-icon" />
                                      </button>
                                    </span>
                                  ) : null}
                                  {isBundleRow ? (
                                    <span className="qc-bundle-pricing-mode">
                                      <span className={`qc-bundle-pricing-chip qc-bundle-pricing-chip--${bundleMode}`}>
                                        {bundleMode === 'auto' ? `Tự tính theo GM ${formatPercentTrim(bundleTargetGm)}` : 'Giữ giá gói cố định'}
                                      </span>
                                      {canEdit && isDraft && !isLockedForReview && editableCells ? (
                                        <button
                                          type="button"
                                          className="qc-bundle-pricing-toggle"
                                          onClick={() => toggleBundleAutoPricing(index, bundleMode !== 'auto')}
                                          title={bundleMode === 'auto' ? 'Tắt tự tính giá gói, giữ giá Combo hiện tại' : 'Bật tự tính giá gói theo cost và Markup'}
                                        >
                                          {bundleMode === 'auto' ? 'Tắt tự tính' : 'Tự tính giá gói'}
                                        </button>
                                      ) : null}
                                    </span>
                                  ) : null}
                                  {(item.discountPercent ?? 0) > 0 ? (
                                    <span className="qc-line-discount-chip">CK dòng {formatPercentTrim(item.discountPercent)}</span>
                                  ) : null}
                                </span>
                              </span>
                              </span>
                            </td>
                            <td className="qc-cell-desc" data-label="Mô tả">
                              {/* Yeu cau rieng "tách cột Mô tả riêng" (giong bang
                               * Sản phẩm & dịch vụ, xem sc-cell-desc) - truoc day mo
                               * ta nam LONG duoi ten hang muc trong CUNG 1 cot, gio
                               * tach thanh cot doc lap. Van dung chung field
                               * quote_item.description, van la textarea sua TRUC
                               * TIEP (yeu cau cu "chỉnh được ở đây luôn" - KHONG quay
                               * lai popover, popover chi con giu Phạm vi bảo hành). */}
                              <textarea
                                className="qc-cell-input qc-workspace-item-desc-inline"
                                rows={2}
                                value={item.description || ''}
                                disabled={!(editableTechnicalCells || editableCells)}
                                onChange={e => updateRow(index, { description: e.target.value })}
                                onBlur={() => void persistQuote({}, { silent: true })}
                                placeholder={(editableTechnicalCells || editableCells) ? 'Mô tả / nội dung công việc...' : 'Chưa có mô tả.'}
                              />
                            </td>
                            <td className="qc-cell-unit" data-label="ĐVT">
                              {editableTechnicalCells ? (
                                <input
                                  className="qc-cell-input"
                                  value={item.unit || ''}
                                  onChange={e => updateRow(index, { unit: e.target.value })}
                                  onBlur={() => void persistQuote({}, { silent: true })}
                                  placeholder="Gói, Tháng..."
                                />
                              ) : (
                                item.unit || '—'
                              )}
                            </td>
                            <td className="qc-cell-money qc-cell-qty" data-label="SL">
                              {editableTechnicalCells ? (
                                <input type="number" className="qc-cell-input qc-cell-input-money" value={item.quantity} onChange={e => updateRow(index, { quantity: Math.max(0, Number(e.target.value) || 0) })} onBlur={() => void persistQuote({}, { silent: true })} />
                              ) : item.quantity}
                            </td>
                            <td className={`qc-cell-money qc-cell-cost ${!item.costNotApplicable && item.costPrice == null ? 'qc-cell-cost-missing' : ''}`} data-label="Giá vốn/ĐV" title={!editableTechnicalCells && costViewAllowed ? 'Presale đã chốt — chỉ đọc' : undefined}>
                              {/* BUG THAT DA GAP ("mũi tên xuống dòng riêng
                               * bên dưới số tiền"): gia tri + icon "Điền
                               * xuống" truoc day la 2 phan tu ANH XA rieng le
                               * (input width:100% chiem het dong, hoac chu
                               * dai vua khit) nen KHONG con cho cho icon tren
                               * CUNG 1 dong, buoc phai xuong dong rieng. Boc
                               * chung 1 flex row - LUON giu icon nam ngang
                               * ben phai gia tri, khong con xuong dong. */}
                              <span className="qc-cell-value-row">
                                <span className="qc-cell-value-row-main">
                                  {!costViewAllowed ? (
                                    <span className="qc-row-sub">Không có quyền xem</span>
                                  ) : editableTechnicalCells ? (
                                    <CurrencyInput
                                      className="qc-cell-input qc-cell-input-money"
                                      value={item.costPrice ?? null}
                                      placeholder={item.costNotApplicable ? 'Không áp dụng' : 'Bắt buộc nhập'}
                                      disabled={item.costNotApplicable}
                                      onChange={value => handleCostPriceChange(index, value)}
                                      onBlur={handleCostPriceBlur}
                                    />
                                  ) : (
                                    (item.costNotApplicable ? 'Không áp dụng' : item.costPrice != null ? formatMoney(item.costPrice) : 'Còn thiếu')
                                  )}
                                </span>
                                {renderFillDownIcon(index, 'costPrice')}
                              </span>
                            </td>
                            <td className="qc-cell-money qc-cell-cost" data-label="Cost tổng">
                              {!costViewAllowed ? <span className="qc-row-sub">Không có quyền xem</span> : item.costNotApplicable ? '—' : costTotal != null ? formatMoney(costTotal) : '—'}
                            </td>
                            <td className="qc-cell-money qc-cell-markup" data-label="Markup">
                              <span className="qc-cell-value-row">
                                <span className="qc-cell-value-row-main">
                                  {!pricingViewAllowed ? (
                                    <span className="qc-row-sub">Không có quyền xem</span>
                                  ) : editableCells ? (
                                    <input type="number" step="0.01" className="qc-cell-input qc-cell-input-money" value={item.markupPercent != null ? Number(item.markupPercent.toFixed(2)) : ''} placeholder="—" disabled={item.costPrice == null} onChange={e => handleMarkupChange(index, e.target.value)} onBlur={() => void persistQuote({}, { silent: true })} />
                                  ) : formatPercentFixed2(item.markupPercent)}
                                </span>
                                {renderFillDownIcon(index, 'markupPercent')}
                              </span>
                            </td>
                            <td className="qc-cell-money qc-cell-markup" data-label="Giá khách/ĐV">
                              {editableCells ? (
                                <CurrencyInput
                                  className="qc-cell-input qc-cell-input-money"
                                  value={item.unitPrice ?? null}
                                  onChange={value => handleUnitPriceChange(index, value)}
                                  onBlur={() => void persistQuote({}, { silent: true })}
                                />
                              ) : formatMoney(item.unitPrice ?? 0)}
                            </td>
                            <td className="qc-cell-money" data-label="Thành tiền">{formatMoney(calculateItemTotal(item))}</td>
                            <td className={`qc-cell-money qc-th-margin-col ${margin != null && margin >= 20 ? 'qc-cell-margin-good' : margin != null ? 'qc-cell-margin-warn' : ''}`} style={{ position: 'relative' }} data-label="Margin">
                              {!profitabilityViewAllowed ? <span className="qc-row-sub">Không có quyền xem</span> : formatPercentFixed2(margin)}
                            </td>
                            <td className="qc-cell-money qc-th-weight" data-label="Tỷ trọng">
                              {!profitabilityViewAllowed ? (
                                <span className="qc-row-sub">Không có quyền xem</span>
                              ) : (
                                formatWeightPercent(calculateItemTotal(item), workspaceQuoteTotal)
                              )}
                            </td>
                            {canEdit && isDraft && !isLockedForReview ? (
                              <td className="qc-cell-actions qc-cell-actions--menu" data-label="Thao tác">
                                {/* BUG THAT DA GAP: 2 icon nhanh rieng (Plus/LayoutGrid)
                                 * dat canh nut "⋮" trong 1 cot rat hep gay CHONG
                                 * LAN/vo layout that su tren man hinh (ket hop voi
                                 * ActionMenu tu quan ly vi tri trigger cua no) -
                                 * BO HAN 2 icon rieng, CHI con dung 1 nut "⋮" duy
                                 * nhat, on dinh - 2 hanh dong "Thêm hạng mục trống"/
                                 * "Chọn từ danh mục" van du dung qua menu chu (2
                                 * muc dau tien ben duoi), dung cho ca desktop lan
                                 * mobile (mobile von di khong co hover that su nen
                                 * cung se can menu chu, khong mat chuc nang gi). */}
                                <ActionMenu
                                  label="Thao tác hạng mục"
                                  items={[
                                    { key: 'add-blank', label: 'Thêm hạng mục trống', icon: Plus, onSelect: () => addBlankItemAfterIndex(index), group: 1 },
                                    { key: 'add-catalog', label: 'Chọn từ danh mục', icon: LayoutGrid, onSelect: () => void openCatalogPicker({ afterIndex: index }), group: 1 },
                                    { key: 'detail', label: 'Xem chi tiết hạng mục', onSelect: () => { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot(deepClone(item)); } },
                                    ...(item.priceBookItemId
                                      ? [{ key: 'price-detail', label: 'Chi tiết giá vốn/EU/VAT', onSelect: () => setPriceBookDrawerIndex(index) }]
                                      : []),
                                    // Mobile/man hinh hep an het icon "Điền xuống" ngay tai o
                                    // (xem @media 767px o quote-center.css) - giu du 2 pham vi
                                    // (empty/all) qua menu chu o day, dong bo voi popover desktop.
                                    ...(item.costPrice != null && fillDownTargets(index).length > 0
                                      ? [
                                          { key: 'fill-down-cost-empty', label: `Điền Giá vốn xuống dòng trống (${fillDownEmptyTargets(index, 'costPrice').length})`, onSelect: () => fillDownWithMode(index, 'costPrice', 'empty') },
                                          { key: 'fill-down-cost-all', label: `Điền Giá vốn xuống toàn bộ (${fillDownTargets(index).length})`, onSelect: () => fillDownWithMode(index, 'costPrice', 'all') },
                                        ]
                                      : []),
                                    ...(item.markupPercent != null && fillDownTargets(index).length > 0
                                      ? [
                                          { key: 'fill-down-markup-empty', label: `Điền Markup xuống dòng trống (${fillDownEmptyTargets(index, 'markupPercent').length})`, onSelect: () => fillDownWithMode(index, 'markupPercent', 'empty') },
                                          { key: 'fill-down-markup-all', label: `Điền Markup xuống toàn bộ (${fillDownTargets(index).length})`, onSelect: () => fillDownWithMode(index, 'markupPercent', 'all') },
                                        ]
                                      : []),
                                    { key: 'up', label: 'Di chuyển lên', icon: ChevronUp, onSelect: () => moveRowUpDown(index, -1), group: 2 },
                                    { key: 'down', label: 'Di chuyển xuống', icon: ChevronDown, onSelect: () => moveRowUpDown(index, 1), group: 2 },
                                    { key: 'duplicate', label: 'Nhân bản hạng mục', onSelect: () => duplicateItemRow(index), group: 2 },
                                    { key: 'delete', label: 'Xoá hạng mục', icon: Trash2, danger: true, onSelect: () => removeItemRow(index), group: 3 },
                                  ]}
                                />
                              </td>
                            ) : null}
                          </tr>
                        );
                        return (
                          <Fragment key={`item-with-bundle-${item.id || index}`}>
                            {mainRow}
                            {bundleChildRows.map(child => (
                              (() => {
                                const childCostTotal = child.costPrice != null ? child.costPrice * (child.quantity || 1) : null;
                                const childUnitPrice = child.unitPrice ?? 0;
                                const childTotal = childUnitPrice * (child.quantity || 1);
                                const childMargin = child.costPrice != null && childUnitPrice > 0 ? ((childUnitPrice - child.costPrice) / childUnitPrice) * 100 : null;
                                return (
                                  <tr key={child.id} className="qc-workspace-item-row--bundle-child">
                                    <td data-label="Hạng mục">
                                      <span className="qc-workspace-item-name-cell">
                                        <span className="qc-workspace-item-no-col" />
                                        <span className="qc-workspace-item-name-col">
                                          <span className="qc-workspace-item-name-clamp" title={[child.serviceDescription, child.description].filter(Boolean).join(' — ') || ''}>
                                            {child.serviceDescription || '—'}
                                          </span>
                                        </span>
                                      </span>
                                    </td>
                                    <td className="qc-cell-desc" data-label="Mô tả" title={child.description || undefined}>{child.description || '—'}</td>
                                    <td className="qc-cell-unit" data-label="ĐVT">{child.unit || '—'}</td>
                                    <td className="qc-cell-money qc-cell-qty" data-label="SL">{child.quantity || '—'}</td>
                                    <td className="qc-cell-money qc-cell-cost" data-label="Giá vốn/ĐV">
                                      {!costViewAllowed ? (
                                        <span className="qc-row-sub">Không có quyền xem</span>
                                      ) : editableTechnicalCells ? (
                                        <span className="qc-bundle-child-edit">
                                          <CurrencyInput
                                            className="qc-cell-input qc-cell-input-money"
                                            value={child.costPrice ?? null}
                                            placeholder="Chưa có giá"
                                            onChange={value => setBundleComponentCost(index, child.__bundleComponentIds || [], value)}
                                          />
                                          {child.costPrice == null && child.__bundleCanDeriveCost ? (
                                            <button type="button" className="qc-bundle-child-inline-action" onClick={() => deriveBundleComponentCost(index, child.__bundleComponentIds || [])}>
                                              Tự tính
                                            </button>
                                          ) : null}
                                        </span>
                                      ) : child.costPrice != null ? formatMoney(child.costPrice) : 'Chưa có giá'}
                                    </td>
                                    <td className="qc-cell-money qc-cell-cost" data-label="Cost tổng">
                                      {!costViewAllowed ? <span className="qc-row-sub">Không có quyền xem</span> : childCostTotal != null ? formatMoney(childCostTotal) : '—'}
                                    </td>
                                    <td className="qc-cell-money qc-cell-markup" data-label="Markup">{formatPercentFixed2(child.markupPercent)}</td>
                                    <td className="qc-cell-money qc-cell-markup" data-label="Giá khách/ĐV">
                                      {!pricingViewAllowed ? (
                                        <span className="qc-row-sub">Không có quyền xem</span>
                                      ) : editableCells ? (
                                        <CurrencyInput
                                          className="qc-cell-input qc-cell-input-money"
                                          value={child.unitPrice ?? null}
                                          onChange={value => setBundleComponentPrice(index, child.__bundleComponentIds || [], value)}
                                        />
                                      ) : child.unitPrice ? formatMoney(child.unitPrice) : '—'}
                                    </td>
                                    <td className="qc-cell-money" data-label="Thành tiền">{childTotal ? formatMoney(childTotal) : '—'}</td>
                                    <td className={`qc-cell-money qc-th-margin-col ${childMargin != null && childMargin >= 20 ? 'qc-cell-margin-good' : childMargin != null ? 'qc-cell-margin-warn' : ''}`} data-label="Margin">
                                      {formatPercentFixed2(childMargin)}
                                    </td>
                                    <td className="qc-cell-money qc-th-weight" data-label="Tỷ trọng">
                                      {!profitabilityViewAllowed ? (
                                        <span className="qc-row-sub">Không có quyền xem</span>
                                      ) : (
                                        formatWeightPercent(childTotal, workspaceQuoteTotal)
                                      )}
                                    </td>
                                    {canEdit && isDraft && !isLockedForReview ? (
                                      <td className="qc-cell-actions qc-cell-actions--menu" data-label="Thao tác">
                                        <button
                                          type="button"
                                          className="qc-mini-btn-icon qc-bundle-child-remove-btn"
                                          disabled={child.__bundleRequired}
                                          title={child.__bundleRequired ? 'Đây là thành phần bắt buộc của gói.' : 'Xoá khỏi gói Combo này'}
                                          aria-label="Xoá khỏi gói Combo"
                                          onClick={() => removeBundleComponent(index, child)}
                                        >
                                          <Trash2 className="qc-inline-icon" />
                                        </button>
                                      </td>
                                    ) : null}
                                  </tr>
                                );
                              })()
                            ))}
                          </Fragment>
                        );
                        });
                      })()
                    )}
                  </tbody>
                </table>
              </div>
              {canEdit && isDraft && !isLockedForReview ? (
                <div className="qc-workspace-add-row">
                  <button type="button" className="qc-mini-btn" onClick={() => void openCatalogPicker()}>Chọn từ danh mục</button>
                  <button type="button" className="qc-mini-btn" onClick={addItemRow}>Thêm hạng mục</button>
                  <button type="button" className="qc-mini-btn" onClick={addSectionRow}>+ Mục cha</button>
                </div>
              ) : null}
              {fillDownUndo ? (
                <div className="qc-workspace-note-box qc-workspace-autofill-undo-box">
                  <span>{fillDownUndo.message}</span>
                  <button type="button" className="qc-mini-btn" onClick={undoFillDown}>Hoàn tác</button>
                </div>
              ) : null}
              <div className="qc-workspace-totals">
                <div>
                  <span className="qc-workspace-info-label">Tổng giá vốn</span>
                  <strong>{!costViewAllowed ? 'Không có quyền xem' : summaryHasCostData ? formatMoney(summaryCostTotal) : 'Chưa có dữ liệu giá vốn'}</strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Giá khách sau CK</span>
                  <strong>{formatMoney(summaryTotalAmount)}</strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Lợi nhuận gộp</span>
                  <strong className={summaryHasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                    {!profitabilityViewAllowed ? 'Không có quyền xem' : summaryHasCostData && summaryGrossProfit != null ? formatMoney(summaryGrossProfit) : 'Chưa có dữ liệu'}
                  </strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Gross margin</span>
                  <strong className={summaryHasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                    {!profitabilityViewAllowed ? 'Không có quyền xem' : summaryHasCostData && summaryGrossMarginPercent != null ? formatPercentTrim(summaryGrossMarginPercent) : 'Chưa có dữ liệu'}
                  </strong>
                </div>
                {profitabilityViewAllowed && summaryHasCostData && summaryCostTotal > 0 && summaryRatePercent != null ? (
                  <div>
                    <span className="qc-workspace-info-label">Rate tổng</span>
                    <strong>{formatPercentTrim(summaryRatePercent)}</strong>
                  </div>
                ) : null}
                <div>
                  {/* Sua o "Chiết khấu tổng" tren quickbar (canh Markup nhanh) -
                   * day chi con la HIEN THI (khong sua thang o day nua), tranh
                   * 2 o edit cung 1 field gay hieu nham co 2 co che rieng. */}
                  <span className="qc-workspace-info-label">Giảm giá toàn báo giá (%)</span>
                  <strong>{summaryOverallDiscountPercent != null ? `${summaryOverallDiscountPercent}%` : 'Không giảm'}</strong>
                </div>
                {profitabilityViewAllowed && summaryOverallDiscountPercent != null ? (() => {
                  const amountAfterDiscount = summaryTotalAmount;
                  const marginAfterDiscount = summaryGrossMarginPercent;
                  return (
                    <>
                      <div>
                        <span className="qc-workspace-info-label">Giá sau giảm</span>
                        <strong>{formatMoney(amountAfterDiscount)}</strong>
                      </div>
                      <div>
                        <span className="qc-workspace-info-label">Margin sau giảm</span>
                        <strong className={marginAfterDiscount != null && marginAfterDiscount >= 0 ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                          {marginAfterDiscount != null ? `${marginAfterDiscount.toFixed(2)}%` : 'Chưa có dữ liệu'}
                        </strong>
                      </div>
                    </>
                  );
                })() : null}
              </div>

              {/* Chiết khấu tổng/Thanh toán/+ Điều khoản - CHUYEN xuong NGAY
               * SAU tong tien (yeu cau rieng "cho ck tổng thanh toán với dk
               * nằm trên chỗ Chuẩn bị hoàn tất giá bán, sau tổng á") - thay
               * vi nam TRUOC bang/tong nhu truoc do. Giu nguyen 100% state/
               * handler cu (overallDiscountPercent, paymentTermsDays,
               * termNotePopoverOpen...), chi doi vi tri render. */}
              {canEditPricingCells && isDraft ? (
                <div className="qc-workspace-commercial-row">
                  <div className="qc-item-discount-tools" title="Áp chiết khấu cho từng hạng mục thật; thành phần con của Combo chỉ để hiển thị nên không bị tính lần 2.">
                    <span className="qc-workspace-quickbar-field">
                      Chiết khấu hạng mục
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="qc-workspace-quickbar-input qc-qb-discount-input"
                        value={itemDiscountInput}
                        placeholder="0"
                        onChange={event => setItemDiscountInput(event.target.value)}
                      />
                      %
                    </span>
                    <button type="button" className="qc-mini-btn" onClick={() => applyItemDiscount('selected')}>
                      Áp hạng mục được chọn ({selectedDiscountCount})
                    </button>
                    <button type="button" className="qc-mini-btn" onClick={() => applyItemDiscount('all')}>
                      Áp tất cả hạng mục
                    </button>
                  </div>
                  <span className="qc-workspace-quickbar-sep" aria-hidden="true" />
                  <label className="qc-workspace-quickbar-field" title="Áp dụng cho tổng báo giá sau khi đã tính các hạng mục; không tự ghi đè chiết khấu riêng từng dòng.">
                    Chiết khấu toàn báo giá
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="qc-workspace-quickbar-input qc-qb-discount-input"
                      value={(quote ? quote.overallDiscountPercent : draftOverallDiscountPercent) ?? ''}
                      placeholder="0"
                      onChange={event => {
                        const raw = event.target.value;
                        const value = raw.trim() === '' ? null : Number(raw);
                        if (quote) {
                          setQuote(prev => (prev ? { ...prev, overallDiscountPercent: value } : prev));
                        } else {
                          setDraftOverallDiscountPercent(value);
                        }
                      }}
                      onBlur={() => quote && void persistQuote({ overallDiscountPercent: quote.overallDiscountPercent ?? null }, { silent: true })}
                    />
                    %
                  </label>
                  <span className="qc-workspace-quickbar-sep" aria-hidden="true" />
                  {/* "Tiêu đề báo giá" (feedback "Presale không làm phần
                   * thương mại") - CHUYEN sang cho Sale dien o day (khoi nay
                   * chi hien khi canEditPricingCells, tuc DUNG luc Sale duoc
                   * sua - xem dieu kien bao ngoai). Truoc day field nay CHI
                   * co the dat 1 LAN luc Presale tao yeu cau (draftTitle) roi
                   * khong ai sua lai duoc nua - gio Sale sua/ghi de o day,
                   * luu qua persistQuote() giong Chiet khau/Thanh toan. */}
                  {quote ? (
                    <label className="qc-workspace-quickbar-field qc-workspace-quickbar-field--title">
                      Tiêu đề báo giá
                      <input
                        type="text"
                        className="qc-workspace-quickbar-input"
                        placeholder="Tiêu đề báo giá..."
                        value={typeof quote.data?.quoteTitle === 'string' ? quote.data.quoteTitle : ''}
                        onChange={event => {
                          const value = event.target.value;
                          setQuote(prev => (prev ? { ...prev, data: { ...prev.data, quoteTitle: value } } : prev));
                        }}
                        onBlur={() => quote && void persistQuote({ data: quote.data }, { silent: true })}
                      />
                    </label>
                  ) : null}
                  <span className="qc-workspace-quickbar-sep" aria-hidden="true" />
                  <label className="qc-workspace-quickbar-field">
                    Thanh toán
                    <select
                      className="qc-workspace-quickbar-input qc-workspace-quickbar-select"
                      value={quote ? paymentTermsDays : draftPaymentTermsDays}
                      onChange={event => {
                        if (quote) setPaymentTermsDays(event.target.value);
                        applyPaymentTerms(event.target.value);
                      }}
                    >
                      {['15', '30', '45', '60'].map(d => <option key={d} value={d}>{d} ngày</option>)}
                    </select>
                  </label>
                  <span className="qc-term-note-anchor">
                    <button type="button" className="qc-mini-btn" onClick={() => setTermNotePopoverOpen(v => !v)}>+ Điều khoản</button>
                    {termNotePopoverOpen ? (
                      <div className="qc-row-margin-popover qc-term-note-popover" onClick={e => e.stopPropagation()}>
                        <textarea autoFocus className="qc-cell-input" rows={3} placeholder="Nhập nội dung điều khoản..." value={termNoteInput} onChange={e => setTermNoteInput(e.target.value)} />
                        <div className="qc-row-margin-popover-actions">
                          <button type="button" className="qc-mini-btn" onClick={() => { setTermNotePopoverOpen(false); setTermNoteInput(''); }}>Huỷ</button>
                          <button type="button" className="qc-mini-btn qc-mini-btn-brand" disabled={!termNoteInput.trim()} onClick={submitTermNote}>Thêm</button>
                        </div>
                      </div>
                    ) : null}
                  </span>
                  {!quote ? <span className="qc-workspace-quickbar-hint">Lưu tạm, sẽ ghi khi tạo yêu cầu</span> : null}
                </div>
              ) : null}
              {extraTermsList.length > 0 ? (
                <ul className="qc-workspace-draft-terms">
                  {extraTermsList.map(t => (
                    <li key={t.id}>
                      <span>{t.title}: {t.content}</span>
                      <span className="qc-workspace-draft-terms-actions">
                        <button type="button" className="qc-mini-btn" onClick={() => editTermNote(t.id)}>Sửa</button>
                        <button type="button" className="qc-mini-btn" onClick={() => removeTermNote(t.id)}>Xóa</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* "Tổng hợp giá" - CHUYEN xuong ngay duoi "Hạng mục & cấu trúc
             * giá" o Buoc 3 (quote da khoa/duyet) theo yeu cau ro rang "cho
             * nằm dưới đít Hạng mục & cấu trúc giá ở bước 3", thay vi nam
             * ben sidebar phai nhu truoc (xem <aside> - da bo card nay khoi
             * do). Giu nguyen 100% du lieu/logic, chi doi vi tri render. */}
            {!isDraft && quote ? (
              <div className="qc-workspace-card">
                <h3>Tổng hợp giá</h3>
                <div className="qc-summary-grid">
                  <div><span className="qc-workspace-info-label">Điều khoản thanh toán</span><strong>{paymentTermsBlock?.content || 'Chưa có điều khoản'}</strong></div>
                  <div><span className="qc-workspace-info-label">Hiệu lực báo giá</span><strong>{quote.validUntil ? formatDate(quote.validUntil) : 'Chưa đặt'}</strong></div>
                  <div><span className="qc-workspace-info-label">Phạm vi công việc</span><strong>{scopeBlock?.content || 'Chưa mô tả'}</strong></div>
                  <div><span className="qc-workspace-info-label">Trước chiết khấu</span><strong>{formatMoney(quote.subtotalAmount)}</strong></div>
                  <div><span className="qc-workspace-info-label">VAT</span><strong>{formatMoney(quote.vatAmount)}</strong></div>
                  <div><span className="qc-workspace-info-label">Khách thanh toán</span><strong>{formatMoney(quote.totalAmount)}</strong></div>
                </div>
              </div>
            ) : null}

            {beyondStep1 && columnVisibilitySchema?.enableDynamicPaymentPlan && columnVisibilitySchema.layoutType !== 'villa_solution_package' ? (
              <details className={`qc-workspace-card qc-workspace-collapsible-card qc-payment-plan-card${paymentPlanIsComplete ? ' qc-payment-plan-card--complete' : paymentPlanIsEmpty ? '' : ' qc-payment-plan-card--warning'}`} data-testid="qc-payment-plan-card"
                open={paymentPlanCardOpen} onToggle={event => setPaymentPlanCardOpen((event.target as HTMLDetailsElement).open)}>
                <summary className="qc-workspace-card-head qc-workspace-collapsible-summary">
                  <h3>Kế hoạch thanh toán</h3>
                  <span className="qc-workspace-collapsible-hint">{paymentPlanCardOpen ? '(bấm để thu gọn)' : '(bấm để xem)'}</span>
                  <div className="qc-workspace-card-head-badges">
                    <span className={`qc-badge ${paymentPlanBadgeClass}`}>{paymentPlanBadgeText}</span>
                    {!paymentPlanCardOpen && !paymentPlanIsEmpty ? (
                      <span className="qc-workspace-collapsible-hint">Khách thanh toán: {formatMoney(paymentPlanTotalAmount)}</span>
                    ) : null}
                  </div>
                </summary>
              <PaymentPlanEditor rows={paymentPlanRows}
                finalPayable={paymentPlanFinalPayable}
                disabled={!canEdit || !isDraft || isLockedForReview}
                onChange={paymentPlan => {
                  quoteContentRevisionRef.current += 1;
                  if (quote) setQuote(current => current ? { ...current, data: { ...current.data, paymentPlan } } : current);
                  else setDraftPaymentPlan(paymentPlan);
                }} />
              </details>
            ) : null}
            <details className="qc-workspace-card qc-workspace-collapsible-card" data-testid="qc-custom-blocks-card">
              <summary className="qc-workspace-card-head qc-workspace-collapsible-summary">
                <h3>Nội dung bổ sung</h3>
                <span className="qc-workspace-collapsible-hint">(cấp báo giá · bấm để xem)</span>
              </summary>
            <fieldset disabled={!canEdit || !isDraft || isLockedForReview} style={{ border: 0, padding: 0, margin: 0 }}>
              <CustomBlocksEditor blocks={quote?.data.customBlocks || draftCustomBlocks} onChange={customBlocks => {
                quoteContentRevisionRef.current += 1;
                if (quote) setQuote(current => current ? { ...current, data: { ...current.data, customBlocks } } : current);
                else setDraftCustomBlocks(customBlocks);
              }} />
            </fieldset>
            </details>

            {stage === 'technical' || stage === 'request' ? (
              // Gop Buoc 1+2: hien san khoi ban giao ngay tu luc con o
              // 'request' (truoc khi Sale kip them hang muc/quote tu tao
              // xong) - dung tinh than "man hinh gop" thay vi doi dung
              // stage==='technical' (chi co that sau khi auto-create xong).
              <details className="qc-workspace-card qc-workspace-collapsible-card" open={handoffCardOpen} onToggle={event => setHandoffCardOpen((event.target as HTMLDetailsElement).open)}>
                <summary className="qc-workspace-card-head qc-workspace-collapsible-summary">
                  <h3>Bàn giao kỹ thuật → người phụ trách báo giá</h3>
                  <span className="qc-workspace-collapsible-hint">{handoffCardOpen ? '(bấm để thu gọn)' : '(bấm để xem)'}</span>
                  <div className="qc-workspace-card-head-badges">
                    {checklistDirty ? <span className="qc-badge qc-badge-amber">Có thay đổi chưa lưu</span> : null}
                  </div>
                </summary>
                <div className="qc-workspace-checklist">
                  {([
                    ['scopeConfirmed', 'scopeNote', 'Phạm vi (Scope)'],
                    ['costConfirmed', 'costNote', 'Giá vốn (Cost)'],
                    ['timelineConfirmed', 'timelineNote', 'Tiến độ (Timeline)'],
                    ['assumptionConfirmed', 'assumptionNote', 'Giả định/Ngoại lệ'],
                  ] as const).map(([confirmedKey, noteKey, label]) => (
                    <label className="qc-workspace-checklist-item" key={confirmedKey}>
                      <input
                        type="checkbox"
                        checked={Boolean(checklistDraft?.[confirmedKey])}
                        disabled={!canEdit || !isDraft}
                        onChange={event =>
                          setChecklistDraft(prev => (prev ? { ...prev, [confirmedKey]: event.target.checked } : prev))
                        }
                      />
                      <div>
                        <strong>{label}</strong>
                        <input
                          type="text"
                          className="qc-workspace-note-input"
                          placeholder="Ghi chú..."
                          value={checklistDraft?.[noteKey] || ''}
                          disabled={!canEdit || !isDraft}
                          onChange={event =>
                            setChecklistDraft(prev => (prev ? { ...prev, [noteKey]: event.target.value } : prev))
                          }
                        />
                      </div>
                    </label>
                  ))}
                  <textarea
                    className="qc-workspace-handoff-note"
                    placeholder="Ghi chú bàn giao..."
                    value={checklistDraft?.handoffNote || ''}
                    disabled={!canEdit || !isDraft}
                    onChange={event => setChecklistDraft(prev => (prev ? { ...prev, handoffNote: event.target.value } : prev))}
                  />
                </div>
              </details>
            ) : null}

            {/* Card "Phân công & SLA" READ-ONLY o cot chinh (chi hien stage
             * 'request') DA BO - yeu cau ro rang "chỗ Phân công & SLA này để
             * sidebar bên phải chứ k phải cái kia" - CHI CON DUNG 1 noi DUY
             * NHAT hien thi/sua Presale/Sale/SLA la card cung ten trong
             * <aside className="qc-workspace-side"> (luon hien moi stage,
             * sua truc tiep tai do - xem phia tren), tranh trung lap 2 noi
             * gay nham lan "sua o dau moi dung". */}

            {stage === 'pricing' ? (
              <div className="qc-workspace-card">
                <div className="qc-workspace-card-head">
                  <h3>Chuẩn bị hoàn tất giá bán</h3>
                </div>
                <ul className="qc-readiness-list">
                  {([
                    // BUG THAT DA GAP ("chỗ anh dũng có full r mà sao chỗ ni
                    // báo chưa"): itemsDraft.every() truoc day chay tren CA
                    // dong Section (row_type='section', luon co unitPrice=0
                    // theo dung thiet ke - khong tinh tien) - CHI CAN co 1
                    // Muc cha la check nay luon bao "Chưa" du MOI hang muc
                    // that (row_type='item') da co gia ban day du. Loc chi
                    // con hang muc THAT truoc khi check, dung y het bug
                    // hasCostData da sua o backend (_quote_cost_summary).
                    (() => {
                      const realItems = itemsDraft.filter(i => i.rowType !== 'section');
                      return ['Tất cả hạng mục đã có giá bán', realItems.length > 0 && realItems.every(i => (i.unitPrice || 0) > 0)] as const;
                    })(),
                    // "Đã có điều khoản thanh toán" da BO KHOI danh sach nay
                    // - khong con la dieu kien bat buoc de chuyen pricing->
                    // review (migration 109_quote_payment_terms_not_required.sql,
                    // DA APPLY THAT), giu no o day se hien "Chưa" gay hieu
                    // nham sai la van con chan buoc chuyen tiep.
                    ['Đã có dữ liệu margin', hasCostData],
                    ['Đã xác nhận chiết khấu (có thể 0%)', quote ? quote.subtotalAmount != null : true],
                    ['SLA đã nhập', Boolean(quote?.slaDueAt || draftSlaDueAt)],
                  ] as const).map(([label, done]) => (
                    <li key={label} className={`qc-readiness-item ${done ? 'is-done' : 'is-missing'}`}>
                      <span className="qc-readiness-status">{done ? 'Có' : 'Chưa'}</span>
                      <span className="qc-readiness-label">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>Tóm tắt dữ liệu bàn giao</h3>
                <div className="qc-workspace-summary-row">
                  <span>Số hạng mục</span>
                  <strong>{rootItems.length}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Tổng giá vốn</span>
                  <strong>{hasCostData ? formatMoney(rootItems.reduce((sum, i) => sum + (i.costTotal || 0), 0)) : 'Chưa có dữ liệu'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Hạng mục thiếu giá vốn</span>
                  <strong className={itemsMissingCost.length ? 'qc-cell-margin-bad' : undefined}>{itemsMissingCost.length}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Presale</span>
                  <strong>{ownerNameFor(quote?.technicalOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Sale nhận bàn giao</span>
                  <strong>{ownerNameFor(quote?.quoteOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>SLA còn lại</span>
                  <strong>{quote?.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong>
                </div>
                {checklistDirty ? (
                  <div className="qc-workspace-note-box qc-workspace-note-box--warn">Có thay đổi checklist chưa lưu.</div>
                ) : null}
              </div>
            ) : null}

            {stage === 'request' || stage === 'technical' || stage === 'pricing' ? (
              <div className="qc-workspace-card">
                <h3>{stage === 'request' ? 'Lịch sử yêu cầu' : stage === 'technical' ? 'Lịch sử xử lý' : 'Activity'}</h3>
                {(() => {
                  const grouped = groupActivityEntries(activity);
                  const visible = activityExpanded ? grouped : grouped.slice(0, ACTIVITY_COLLAPSED_LIMIT);
                  return (
                    <>
                      <ul className={`qc-workspace-activity${activityExpanded ? ' qc-workspace-activity--scroll' : ''}`}>
                        {activity.length === 0 ? (
                          <li className="qc-workspace-muted">{quote ? 'Chưa có hoạt động nào.' : 'Yêu cầu chưa được lưu.'}</li>
                        ) : null}
                        {visible.map(({ entry, count }) => (
                          <li key={entry.id}>
                            <strong>{nameFor(entry.actorId)}</strong> {activityLogTail(entry)}{count > 1 ? ` (x${count})` : ''}
                            <div className="qc-row-sub">{relativeTime(entry.createdAt)}</div>
                          </li>
                        ))}
                      </ul>
                      {grouped.length > ACTIVITY_COLLAPSED_LIMIT ? (
                        <button type="button" className="qc-mini-btn" onClick={() => setActivityExpanded(v => !v)}>
                          {activityExpanded ? 'Thu gọn' : `Xem tất cả (${grouped.length})`}
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : null}
          </div>

          <aside className="qc-workspace-side">
            {/* "Phân công & SLA để bên sidebar luôn" - LUON hien (khong gate
             * theo stage/draft) o dau sidebar, tach khoi info-strip chinh
             * (Khach hang/Du an/Co hoi/Mau bao gia/Loai bao gia). Giu NGUYEN
             * y het logic/component cu (SearchableSelect + assignOwner +
             * computeQuoteSla...), chi doi VI TRI render. */}
            <div className="qc-workspace-card qc-workspace-assignment-card">
              <h3>Phân công &amp; SLA</h3>
              <div className="qc-workspace-assignment-grid">
                <div data-qc-required="presale">
                  <span className="qc-workspace-info-label">Presale <span className="qc-required-mark">*</span></span>
                  {!quote || (isDraft && canEdit) ? (
                    presaleUsers === null || saleUsers === null ? (
                      <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải danh sách Presale…</span>
                    ) : businessRoleUsers.length === 0 ? (
                      <NoStaffConfigured isAdminOrLeader={isAdminOrLeader} />
                    ) : (
                      <SearchableSelect
                        value={quote ? quote.technicalOwnerId || '' : draftTechnicalOwnerId}
                        onChange={value => { if (value) clearRequiredError('presale'); quote ? void assignOwner('technicalOwnerId', value) : setDraftTechnicalOwnerId(value); }}
                        options={businessRoleUsers.map(a => ({ value: a.id, label: ownerOptionLabel(a) }))}
                        placeholder="Chưa gán"
                      />
                    )
                  ) : (
                    <strong>{ownerNameFor(quote.technicalOwnerId)}</strong>
                  )}
                  {requiredFieldErrors.presale ? <p className="qc-field-error">{requiredFieldErrors.presale}</p> : null}
                </div>
                <div data-qc-required="sale">
                   <span className="qc-workspace-info-label">Sale <span className="qc-required-mark">*</span></span>
                  {!quote || (isDraft && canEdit) ? (
                    presaleUsers === null || saleUsers === null ? (
                      <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải danh sách Sale…</span>
                    ) : businessRoleUsers.length === 0 ? (
                      <NoStaffConfigured isAdminOrLeader={isAdminOrLeader} />
                    ) : (
                      <SearchableSelect
                        value={quote ? quote.quoteOwnerId || '' : draftQuoteOwnerId}
                        onChange={value => { if (value) clearRequiredError('sale'); quote ? void assignOwner('quoteOwnerId', value) : setDraftQuoteOwnerId(value); }}
                        options={businessRoleUsers.map(a => ({ value: a.id, label: ownerOptionLabel(a) }))}
                        placeholder="Chưa gán"
                      />
                    )
                  ) : (
                    <strong>{ownerNameFor(quote.quoteOwnerId)}</strong>
                  )}
                  {requiredFieldErrors.sale ? <p className="qc-field-error">{requiredFieldErrors.sale}</p> : null}
                </div>
                <div data-qc-required="sla">
                  <span className="qc-workspace-info-label" title="Hạn xử lý NỘI BỘ - khác hoàn toàn 'Hiệu lực đến' (hiệu lực báo giá với khách hàng)">
                    SLA / Hạn hoàn tất nội bộ <span className="qc-required-mark">*</span>
                  </span>
                  {!quote ? (
                    <input
                      key="sla-draft"
                      type="datetime-local"
                      className="qc-cell-input"
                      value={draftSlaDueAt}
                      onChange={e => { setDraftSlaDueAt(e.target.value); if (e.target.value) clearRequiredError('sla'); }}
                    />
                  ) : stage === 'request' && canEdit ? (
                    // key rieng voi input tren - tranh React tuong "cung 1
                    // input" roi bao "controlled -> uncontrolled" khi quote
                    // tu dong duoc tao xong (tu !quote sang co quote NGAY
                    // TRONG 1 phien, khong qua remount) vi input tren dung
                    // value (controlled) con input nay dung defaultValue
                    // (uncontrolled) - key khac buoc React unmount/mount lai
                    // thay vi doi props tren cung 1 DOM node.
                    <input
                      key="sla-existing"
                      type="datetime-local"
                      className="qc-cell-input"
                      defaultValue={isoToDatetimeLocalValue(quote.slaDueAt)}
                      onBlur={e => void updateQuoteSlaDueAt(e.target.value)}
                    />
                  ) : (
                    <strong>{quote.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong>
                  )}
                  {(() => {
                    const sla = computeQuoteSla({
                      slaDueAt: quote ? quote.slaDueAt : (draftSlaDueAt ? new Date(draftSlaDueAt).toISOString() : null),
                      completedAt: quote?.completedAt,
                      sentAt: quote?.sentAt,
                    });
                    if (sla.status === 'not_set') return null;
                    return (
                      <div
                        className="qc-row-sub"
                        style={{
                          color: sla.tone === 'danger' ? '#b3261e' : sla.tone === 'warning' ? '#8a6416' : sla.tone === 'success' ? '#148e61' : undefined,
                        }}
                      >
                        {sla.label}{sla.relativeText ? ` · ${sla.relativeText}` : ''}
                      </div>
                    );
                  })()}
                  {requiredFieldErrors.sla ? <p className="qc-field-error">{requiredFieldErrors.sla}</p> : null}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="qc-btn qc-workspace-preview-sidebar-btn qc-workspace-preview-sidebar-btn--accent"
              disabled={!canPreview}
              title={previewDisabledReason}
              onClick={() => setPreviewModalOpen(true)}
            >
              <Eye className="qc-icon" /> Xem bản khách hàng
            </button>

            {/* "Cột hiển thị" DA GOP vao trong popup preview (yeu cau rieng
             * "Gộp lại chức năng Cột hiển thị vào bên trong Xem bản khách
             * hàng") - sidebar CHI CON DUNG 1 nut "Xem bản khách hàng", KHONG
             * con <QuoteColumnVisibilityPicker> rieng o day nua. Xem
             * previewModalOpen ben duoi - dung LAI y het component/state/
             * handler nay (columnVisibilityDraft/handleColumnVisibilityChange/
             * columnVisibilitySchema), chi doi VI TRI render sang header cua
             * popup preview. */}

            {/* "khi tích xong hỏi lại có chắc lưu và hiển thị vậy không" -
             * gio dung window.confirm() ngay trong handleColumnVisibilityChange
             * (xem khai bao ham o tren) - KHONG con ConfirmModal rieng o day
             * nua (bug "k bấm dc luôn" do z-index/stacking context tuy
             * chinh khong dang tin cay khi long trong popup preview). */}

            {/* Yeu cau rieng "mấy card này đẻ bên sidebar phải đi, đang trống
             * kế bên kìa" - o quote da khoa/duyet (khong phai draft), sidebar
             * truoc day RONG (cac card duoi day chi gate theo stage request/
             * technical/pricing/review, khong co nhanh nao cho 'published'/
             * 'ready_to_publish') trong khi cot chinh qua tai 3 card tong
             * hop. Chuyen "Phê duyệt & version"/"Thông tin phát hành" sang
             * day, cung dieu kien !isDraft nhu cot chinh. "Tổng hợp giá" DA
             * CHUYEN xuong ngay duoi khoi "Hạng mục & cấu trúc giá" o cot
             * chinh (yeu cau rieng "cho nằm dưới đít Hạng mục & cấu trúc giá
             * ở bước 3") - xem ngay sau </div> dong khoi items card. */}
            {!isDraft && quote ? (
              <>
                <div className="qc-workspace-card">
                  <h3>Phê duyệt &amp; version</h3>
                  <div className="qc-workspace-summary-row"><span>Version hiện tại</span><strong>V{quote.versionNumber || 1}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Kết quả Rule Engine</span><strong>{ruleEvaluation ? (ruleEvaluation.result === 'pass' ? 'Đạt' : ruleEvaluation.result === 'fail' ? 'Không đạt' : 'Chưa đủ dữ liệu') : 'Chưa đánh giá'}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Phê duyệt</span><strong>{ruleEvaluation?.autoApproveEnabled ? 'Tự động duyệt' : 'Duyệt thủ công'}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Trạng thái public link</span><strong>{quote.publicEnabled ? 'Đang bật' : 'Chưa bật'}</strong></div>
                </div>

                {quote.processingStage === 'published' ? (
                  <div className="qc-workspace-card">
                    <h3>{quote.sentAt ? 'Thông tin gửi khách' : 'Thông tin phát hành'}</h3>
                    <div className="qc-workspace-summary-row"><span>Public URL</span><strong>{quote.publicUrl || '—'}</strong></div>
                    <div className="qc-workspace-summary-row"><span>Người phát hành</span><strong>{quote.publishedById ? nameFor(quote.publishedById) : '—'}</strong></div>
                    <div className="qc-workspace-summary-row"><span>Ngày phát hành</span><strong>{quote.publishedAt ? formatDate(quote.publishedAt) : '—'}</strong></div>
                    {/* "Giới hạn xem link báo giá bằng Email hoặc Số điện
                     * thoại" (migration 118) - mac dinh "Không giới hạn"
                     * (khong doi hanh vi cu, ai co link cung xem duoc). CHI 1
                     * trong 3 che do co hieu luc tai 1 thoi diem (radio, khong
                     * phai checkbox+danh sach nhu ban cu) - tranh dut khoat
                     * bug "tắt giới hạn nhưng vẫn yêu cầu Email" da gap truoc
                     * do (khi do dung 1 boolean rieng + danh sach song song,
                     * de "quen" cap nhat 1 trong 2 khi tat). */}
                    <div className="qc-workspace-email-gate">
                      <div className="qc-workspace-access-mode-toggle">
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'none'} onChange={() => setAccessModeAndSuggest('none')} />
                          Không giới hạn
                        </label>
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'email'} onChange={() => setAccessModeAndSuggest('email')} />
                          Giới hạn theo Email
                        </label>
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'phone'} onChange={() => setAccessModeAndSuggest('phone')} />
                          Giới hạn theo Số điện thoại
                        </label>
                      </div>
                      {accessMode === 'email' ? (
                        <textarea
                          className="qc-workspace-email-gate-textarea"
                          placeholder={'Nhập email được phép xem, mỗi dòng 1 email\nvd: khach@congty.com'}
                          value={accessEmailsText}
                          onChange={e => setAccessEmailsText(e.target.value)}
                        />
                      ) : null}
                      {accessMode === 'phone' ? (
                        <textarea
                          className="qc-workspace-email-gate-textarea"
                          placeholder={'Nhập số điện thoại được phép xem, mỗi dòng 1 số\nvd: 0901234567'}
                          value={accessPhonesText}
                          onChange={e => setAccessPhonesText(e.target.value)}
                        />
                      ) : null}
                      <button type="button" className="qc-mini-btn" disabled={accessSaving} onClick={() => void saveAccessRestriction()}>
                        {accessSaving ? 'Đang lưu...' : 'Lưu giới hạn xem link'}
                      </button>
                    </div>
                    {quote.sentAt ? (
                      <>
                        <div className="qc-workspace-summary-row"><span>Người gửi</span><strong>{quote.sentById ? nameFor(quote.sentById) : '—'}</strong></div>
                        <div className="qc-workspace-summary-row"><span>Ngày gửi</span><strong>{formatDate(quote.sentAt)}</strong></div>
                        {(() => {
                          const sla = computeQuoteSla({ slaDueAt: quote.slaDueAt, completedAt: quote.completedAt, sentAt: quote.sentAt });
                          return (
                            <div className="qc-workspace-summary-row">
                              <span>SLA</span>
                              <strong style={{ color: sla.tone === 'danger' ? '#b3261e' : sla.tone === 'success' ? '#148e61' : undefined }}>{sla.label}</strong>
                            </div>
                          );
                        })()}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            {stage === 'request' ? (
              <div className="qc-workspace-card">
                <h3>Tóm tắt yêu cầu</h3>
                <div className="qc-workspace-summary-row">
                  <span>Khách hàng</span>
                  <strong>{deal?.customerName || (draftCustomerId ? customers.find(c => c.id === draftCustomerId)?.label : null) || 'Chưa chọn'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Dự án</span>
                  <strong>{(projects || []).find(p => p.id === (quote ? quote.projectId : draftProjectId))?.name || 'Chưa thuộc dự án'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Cơ hội</span>
                  <strong>{businessCode || (deal ? 'Chưa có mã' : 'Chưa gắn cơ hội')}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>SLA</span>
                  <strong>{(quote ? quote.slaDueAt : draftSlaDueAt) ? formatDate(quote ? quote.slaDueAt! : new Date(draftSlaDueAt).toISOString()) : 'Chưa đặt SLA'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Loại báo giá</span>
                  <strong>{currentQuoteTypeCodes.length > 0 ? currentQuoteTypeCodes.map(quoteTypeLabel).join(', ') : 'Chưa chọn'}</strong>
                </div>
              </div>
            ) : null}

            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>Tổng giá vốn</h3>
                <div className="qc-workspace-summary-row">
                  <span>Tổng giá vốn</span>
                  <strong>{hasCostData ? formatMoney(rootItems.reduce((sum, i) => sum + (i.costTotal || 0), 0)) : 'Chưa có dữ liệu'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Hạng mục thiếu giá vốn</span>
                  <strong className={itemsMissingCost.length ? 'qc-cell-margin-bad' : undefined}>{itemsMissingCost.length}</strong>
                </div>
              </div>
            ) : null}
            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>SLA</h3>
                <div className="qc-workspace-summary-row">
                  <span>Hạn hoàn tất nội bộ</span>
                  <strong>{quote?.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong>
                </div>
              </div>
            ) : null}

            {stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Tổng hợp thương mại</h3>
              <div className="qc-workspace-summary-row">
                <span>Trước chiết khấu</span>
                <strong>{quote ? formatMoney(quote.subtotalAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Chiết khấu</span>
                <strong>{quote ? formatMoney(Math.max(0, quote.subtotalAmount - (quote.netRevenue ?? quote.subtotalAmount))) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Sau chiết khấu</span>
                <strong>{quote ? formatMoney(quote.netRevenue ?? quote.subtotalAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>VAT</span>
                <strong>{quote ? formatMoney(quote.vatAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row qc-workspace-summary-row--total">
                <span>Khách thanh toán</span>
                <strong>{quote ? formatMoney(quote.totalAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Lợi nhuận dự kiến</span>
                <strong className={hasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                  {hasCostData ? formatMoney(quote!.grossProfit || 0) : 'Chưa có dữ liệu giá vốn'}
                </strong>
              </div>
              {hasCostData && quote?.grossMarginPercent != null ? (
                <div className="qc-workspace-margin-bar">
                  <div className="qc-workspace-margin-bar-track">
                    <div className="qc-workspace-margin-bar-fill" style={{ width: `${Math.max(0, Math.min(100, quote.grossMarginPercent))}%` }} />
                  </div>
                  <span>Margin {formatPercentTrim(quote.grossMarginPercent)}</span>
                </div>
              ) : null}
            </div>
            ) : null}

            {stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card qc-rule-card">
              <div className="qc-workspace-card-head">
                <div>
                  <h3>Quy tắc phê duyệt</h3>
                  <p className="qc-rule-card-subtitle">
                    {ruleSet ? `${ruleSet.name} · V${ruleSet.version}` : ruleSetLoaded ? 'Chưa cấu hình quy tắc' : 'Đang tải…'}
                  </p>
                </div>
              </div>

              {ruleSet ? (
                <>
                  <ul className="qc-rule-list">
                    {ruleSet.rules.map(rule => {
                      const detail = ruleEvaluation?.details.find(d => d.ruleType === rule.ruleType);
                      const label = RULE_LABELS[rule.ruleType]?.label || rule.ruleType;
                      const statusIcon = !detail ? '•' : detail.status === 'pass' ? '✓' : detail.status === 'fail' ? '✗' : '•';
                      const statusClass = !detail ? 'qc-rule-row--pending' : detail.status === 'pass' ? 'qc-rule-row--pass' : detail.status === 'fail' ? 'qc-rule-row--fail' : 'qc-rule-row--pending';
                      return (
                        <li key={rule.ruleType} className={`qc-rule-row ${statusClass}`}>
                          <span className="qc-rule-row-icon">{statusIcon}</span>
                          <span className="qc-rule-row-label">{label}</span>
                          <span className="qc-rule-row-value">{detail ? detail.actualDisplay : 'Chưa có dữ liệu'}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="qc-rule-summary">
                    {!ruleEvaluation
                      ? 'Chưa đủ dữ liệu để đánh giá'
                      : ruleEvaluation.result === 'pass'
                        ? `✓ Đạt ${ruleEvaluation.details.length}/${ruleEvaluation.details.length} quy tắc${ruleEvaluation.autoApproveEnabled ? ' · tự động duyệt' : ''}`
                        : ruleEvaluation.result === 'insufficient_data'
                          ? 'Chưa đủ dữ liệu để đánh giá'
                          : `Không đạt ${ruleEvaluation.details.filter(d => d.status === 'fail').length}/${ruleEvaluation.details.length} quy tắc`}
                  </div>
                </>
              ) : (
                <p className="qc-workspace-muted" style={{ fontSize: 13 }}>
                  {canManageApprovalRules
                    ? 'Chưa có quy tắc phê duyệt nào được cấu hình — vào "Cài đặt báo giá" (menu Quản lý CRM) để thiết lập.'
                    : 'Chưa có quy tắc phê duyệt nào được cấu hình.'}
                </p>
              )}
            </div>
            ) : null}

            {/* Card qc-workspace-actions (Xem bản khách hàng/Gửi khách hàng/
             * link) o stage==='review' DA BO HET - yeu cau rieng "Xem bản
             * khách hàng" trùng header (đã gỡ), roi "gửi khách hàng đang
             * chờ duyệt dỡ luôn đi": "Gửi khách hàng" o day LUON disabled
             * (sendDisabledReason luon = "Báo giá chưa được duyệt" khi
             * stage==='review', vi quote.status CHI thanh 'approved' SAU KHI
             * roi khoi stage nay - xem approveNow()/RPC quote_approve) - nut
             * khong bao gio bam duoc o day, chi la UI chet. 3 khoi con lai
             * trong card (copy/khoá/mở link) deu dieu kien
             * quote?.status==='approved' nen CUNG khong bao gio hien khi con
             * o 'review' (status chi approved SAU stage nay) - ca card rong
             * khong con gi de hien, bo han thay vi de trong. */}

            {stage === 'request' || stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Kiểm tra dữ liệu</h3>
              <ul className="qc-workspace-checks">
                <li className={deal ? 'ok' : 'pending'}>Đã có thông tin khách hàng</li>
                {/* BUG THAT DA GAP: rootItems = quote?.items (chi co gia tri
                 * SAU KHI quote da tao that) - o che do tao moi (!quote),
                 * rootItems LUON RONG du go bao nhieu hang muc di nua, khien
                 * o nay khong bao gio hien "da xong" cho toi khi bam Bàn
                 * giao xong. Doc tu itemsDraft (ban nhap dang go) khi chua
                 * co quote that thay vi rootItems. */}
                <li className={(quote ? rootItems.length > 0 : itemsDraft.length > 0) ? 'ok' : 'pending'}>Đã có hạng mục và chi phí</li>
                <li className={(quote ? hasCostData : itemsDraft.some(item => item.markupPercent != null || item.unitPrice != null)) ? 'ok' : 'pending'}>Đã nhập giá bán/Markup</li>
                {/* "Đã có điều khoản thanh toán"/"Đã mô tả phạm vi công việc"
                 * da BO KHOI checklist nay theo yeu cau - ca 2 deu KHONG bat
                 * buoc (dieu khoan thanh toan van con bat buoc rieng o buoc
                 * pricing->review qua "Chuẩn bị hoàn tất giá bán" ben tren,
                 * scope thi khong con bat buoc dau nao ca - xem migration
                 * 108_quote_scope_not_required.sql). */}
              </ul>
              {marginBelowThreshold ? (
                <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                  Cảnh báo: margin {quote?.grossMarginPercent?.toFixed(2)}% dưới ngưỡng tham chiếu 20%.
                </div>
              ) : null}
            </div>
            ) : null}

            {/* Card "Preview khách hàng" lon (o sidebar) DA BO - "Xem bản
             * khách hàng" gio la 1 nut full-width rieng ngay dau sidebar
             * (xem .qc-workspace-preview-sidebar-btn ngay ben tren, sau card
             * "Phân công & SLA") theo yeu cau moi nhat "Chuyển Xem bản khách
             * hàng sang sidebar phải" - dung LAI DUNG canPreview/
             * previewDisabledReason/setPreviewModalOpen, khong tao luong
             * preview moi nao. */}

            {stage === 'request' || stage === 'technical' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>{stage === 'request' ? 'Activity ngắn' : 'Activity & handoff'}</h3>
              {(() => {
                const grouped = groupActivityEntries(activity);
                const visible = activityExpanded ? grouped : grouped.slice(0, ACTIVITY_COLLAPSED_LIMIT);
                return (
                  <>
                    <ul className={`qc-workspace-activity${activityExpanded ? ' qc-workspace-activity--scroll' : ''}`}>
                      {activity.length === 0 ? (
                        <li className="qc-workspace-muted">{quote ? 'Chưa có hoạt động nào.' : 'Yêu cầu chưa được lưu.'}</li>
                      ) : null}
                      {visible.map(({ entry, count }) => (
                        <li key={entry.id}>
                          <strong>{nameFor(entry.actorId)}</strong> {ACTIVITY_LABELS[entry.action] || entry.action}{count > 1 ? ` (x${count})` : ''}
                          <div className="qc-row-sub">{relativeTime(entry.createdAt)}</div>
                        </li>
                      ))}
                    </ul>
                    {grouped.length > ACTIVITY_COLLAPSED_LIMIT ? (
                      <button type="button" className="qc-mini-btn" onClick={() => setActivityExpanded(v => !v)}>
                        {activityExpanded ? 'Thu gọn' : `Xem tất cả (${grouped.length})`}
                      </button>
                    ) : null}
                  </>
                );
              })()}
            </div>
            ) : null}
          </aside>
        </div>

        <div className="qc-workspace-footer">
          {!quote ? (
            <>
              {/* "Lưu / Chỉnh sửa" chuyen tu header xuong day, dat KE nut
               * "Bàn giao" - đổi ten thanh "Lưu / Bản nháp" + o mau TRANG
               * (qc-btn thuong, khong phai qc-btn-primary) de khong canh
               * tranh voi nut hanh dong chinh "Bàn giao". Nut "Huỷ" rieng
               * DA BO - bam X o header da hieu ngam la Huỷ, khong can lap
               * lai 1 nut chu rieng nua. */}
              <button type="button" className="qc-btn" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} onClick={() => void createRequest(false)}>
                {actionButtonContent('draftSave', 'Lưu / Bản nháp')}
              </button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy}
                aria-busy={busy && activeAction === 'handoff'}
                onClick={() => void createRequest(true)}
              >
                {actionButtonContent('handoff', 'Bàn giao')}
              </button>
            </>
          ) : !isDraft ? (
            <>
              <button type="button" className="qc-btn" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>← Danh sách</button>
              {quote.status === 'approved' ? (
                <>
                  <button type="button" className="qc-btn" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem bản khách hàng
                  </button>
                  {quote.processingStage === 'published' ? (
                    <>
                      {quote.publicEnabled ? (
                        <>
                          <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                            <Link2 className="qc-icon" /> Sao chép link báo giá
                          </button>
                          <button type="button" className="qc-btn" onClick={printPublicQuotePdf}>
                            <Printer className="qc-icon" /> In PDF
                          </button>
                          <button type="button" className="qc-btn" disabled={busy} onClick={() => void revokePublicLinkFromWorkspace()}>
                            Khoá link
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="qc-workspace-footer-note">Link báo giá đã bị khoá</span>
                          <button type="button" className="qc-btn" disabled={busy} onClick={() => void enablePublicLinkFromWorkspace()}>
                            Mở lại link
                          </button>
                        </>
                      )}
                      {quote.sentAt ? (
                        <>
                          <button type="button" className="qc-btn" onClick={() => void viewDeliveryLog()}>
                            <History className="qc-icon" /> Xem lịch sử gửi
                          </button>
                          <button
                            type="button"
                            className="qc-btn qc-btn-primary"
                            disabled={Boolean(sendDisabledReason)}
                            title={sendDisabledReason}
                            onClick={() => void openSendModal()}
                          >
                            <Send className="qc-icon" /> Gửi lại
                          </button>
                          <span className="qc-workspace-footer-note">
                            Đã gửi{quote.sentAt ? ` · ${relativeTime(quote.sentAt)}` : ''}
                          </span>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="qc-btn qc-btn-primary"
                          disabled={Boolean(sendDisabledReason)}
                          title={sendDisabledReason}
                          onClick={() => void openSendModal()}
                        >
                          <Send className="qc-icon" /> Gửi khách hàng
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" className="qc-btn qc-btn-primary" onClick={() => setPublishModalOpen(true)}>
                      Phát hành
                    </button>
                  )}
                </>
              ) : null}
              <span className="qc-workspace-footer-note">
                Version đã khoá{versionButtonState.disabled ? '' : ' · Tạo revision để sửa'}
              </span>
            </>
          ) : (
            <>
              <button type="button" className="qc-btn" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>← Danh sách</button>
              {(stage === 'request' || stage === 'technical') && canEdit ? (
                // MOT nut duy nhat cho ca Buoc 1 gop (request VA technical la
                // CUNG 1 buoc UI "Yêu cầu & Kỹ thuật") - khong con tach thanh
                // "Gửi yêu cầu xử lý" roi "Bàn giao xử lý giá" nhu 2 luot bam
                // lien tiep (bug that da gap: nhin nhu Buoc 1 chay 2 lan).
                // handoffStep1ToPricing() tu xu ly ca 2 hop (request-
                // >technical NEU can, roi ->pricing) trong CUNG 1 lan bam.
                <>
                  <button type="button" className="qc-btn" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} title="Lưu bản nháp báo giá" onClick={() => void persistQuote({}).then(() => showToast(true, 'Đã lưu bản nháp.'))}>Lưu</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || itemsMissingCost.length > 0 || (stage === 'request' && !quote?.slaDueAt)}
                    aria-busy={busy && activeAction === 'handoff'}
                    title={
                      stage === 'request' && !quote?.slaDueAt
                        ? 'Cần đặt SLA / hạn hoàn tất nội bộ trước khi Bàn giao'
                        : itemsMissingCost.length > 0
                        ? `Còn ${itemsMissingCost.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu "Không áp dụng"`
                        : undefined
                    }
                    onClick={() => void handoffStep1ToPricing()}
                  >
                    {actionButtonContent('handoff', 'Bàn giao')}
                  </button>
                </>
              ) : null}
              {stage === 'pricing' && canEdit ? (
                <>
                  <button type="button" className="qc-btn" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} onClick={() => void persistQuote({}).then(() => showToast(true, 'Đã lưu báo giá.'))}>{actionButtonContent('draftSave', 'Lưu')}</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || !canReadyForApproval}
                    aria-busy={busy && activeAction === 'reviewPricing'}
                    title={!canReadyForApproval ? 'Cần ít nhất 1 hạng mục và tổng tiền > 0 trước khi gửi duyệt' : !quote?.projectId ? 'Cần chọn Dự án trước khi gửi duyệt' : undefined}
                    onClick={handoffPricingToReview}
                  >
                    {actionButtonContent('reviewPricing', 'Hoàn tất phần giá bán')}
                  </button>
                </>
              ) : null}
              {stage === 'review' ? (
                <>
                  <button type="button" className="qc-btn" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem bản khách hàng
                  </button>
                  {canEdit ? (
                    <button type="button" className="qc-btn" disabled={busy} onClick={() => setRequestChangesModalOpen(true)}>
                      Yêu cầu chỉnh sửa
                    </button>
                  ) : null}
                  {canApprove ? (
                    <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => setApproveModalOpen(true)}>
                      <CheckCircle2 className="qc-icon" /> Duyệt báo giá
                    </button>
                  ) : (
                    <span className="qc-workspace-footer-note">Chờ người có quyền duyệt (Admin hoặc được cấp quyền) xử lý.</span>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {quote && versionModalOpen ? (
        <div className="qc-modal-backdrop">
          <div className="qc-deal-picker">
            <h3>Tạo phiên bản V{(quote.versionNumber || 1) + 1}</h3>
            <p className="qc-workspace-note">Báo giá {quote.quoteNumber} · giữ nguyên version cũ để đối chiếu</p>
            <label className="qc-workspace-info-label">Lý do tạo revision</label>
            <select className="crm-input" value={versionReason} onChange={event => setVersionReason(event.target.value)}>
              {VERSION_REASONS.map(reason => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
            <div className="qc-workspace-note-box">
              Version {quote.versionNumber || 1} sẽ được giữ nguyên, không sửa được nữa. Toàn bộ dữ liệu sẽ copy sang bản nháp mới.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setVersionModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => void confirmCreateVersion()}>
                Tạo version mới
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CustomerAddDrawer
        open={customerDrawerOpen}
        currentUser={user ?? null}
        onClose={() => setCustomerDrawerOpen(false)}
        onCreated={customerId => void handleCustomerCreated(customerId)}
      />

      {/* "+ Tạo người liên hệ mới" tại chỗ tu dropdown "Người liên hệ" - form
       * nho gon (chi Ho ten, SDT, Email, du de tao nhanh 1 Contact roi tu
       * chon lai ngay), KHONG phai ban sao trang quan ly Contact day du
       * (CrmContactsPanel.tsx) - dung LAI dung endpoint API cua trang do. */}
      {createContactOpen ? (
        <div className="crm-modal-backdrop" onClick={() => !createContactBusy && setCreateContactOpen(false)}>
          <div className="crm-modal" onClick={event => event.stopPropagation()}>
            <header className="crm-modal-header">
              <h2 className="crm-modal-title">Tạo người liên hệ mới</h2>
              <button type="button" className="crm-modal-close" onClick={() => setCreateContactOpen(false)} aria-label="Đóng">×</button>
            </header>
            <form
              id="qcCreateContactForm"
              className="crm-modal-body"
              onSubmit={event => { event.preventDefault(); void submitCreateContact(); }}
            >
              {createContactError ? <p className="crm-error">{createContactError}</p> : null}
              <div className="crm-form-grid">
                <label className="crm-field">
                  <span>Họ tên <b>*</b></span>
                  <input autoFocus value={createContactName} onChange={e => setCreateContactName(e.target.value)} />
                </label>
                <label className="crm-field">
                  <span>Số điện thoại</span>
                  <input value={createContactPhone} onChange={e => setCreateContactPhone(e.target.value)} type="tel" />
                </label>
                <label className="crm-field">
                  <span>Email</span>
                  <input value={createContactEmail} onChange={e => setCreateContactEmail(e.target.value)} type="email" />
                </label>
              </div>
            </form>
            <footer className="crm-modal-footer">
              <button type="button" className="crm-cancel-button" onClick={() => setCreateContactOpen(false)} disabled={createContactBusy}>Hủy</button>
              <button type="submit" form="qcCreateContactForm" className="crm-save-button" disabled={createContactBusy}>
                {createContactBusy ? 'Đang lưu...' : 'Lưu'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {quoteTypeQuickAddOpen ? (
        <CrmCategoryQuickModal
          categoryType="crm_quote_type"
          onClose={() => setQuoteTypeQuickAddOpen(false)}
          onSaved={category => {
            setQuoteTypeQuickAddOpen(false);
            invalidateCrmCategoryCache('crm_quote_type');
            void reloadQuoteTypeOptions(true).then(() => {
              if (category.code) toggleQuoteTypeCode(category.code);
            });
          }}
        />
      ) : null}

      {quoteTypeManageOpen ? (
        <CrmCategoryManageDrawer
          categoryType="crm_quote_type"
          onClose={() => setQuoteTypeManageOpen(false)}
          onChanged={() => {
            invalidateCrmCategoryCache('crm_quote_type');
            void reloadQuoteTypeOptions(true);
          }}
        />
      ) : null}

      <ProjectFormModal
        open={projectModalOpen}
        customerId={effectiveCustomerIdForProjects || ''}
        customerName={quote ? deal?.customerName || 'Khách hàng hiện tại' : customers.find(c => c.id === draftCustomerId)?.label || 'Khách hàng hiện tại'}
        currentUserId={user?.id ?? null}
        onClose={() => setProjectModalOpen(false)}
        onSaved={created => {
          setProjectModalOpen(false);
          if (!created) return;
          setProjects(prev => [...(prev || []), created]);
          if (quote) void updateQuoteProject(created.id);
          else setDraftProjectId(created.id);
        }}
      />

      <DealFormModal
        open={dealModalOpen}
        loading={dealCreateBusy}
        onClose={() => { if (!dealCreateBusy) setDealModalOpen(false); }}
        onCreate={input => void handleCreateQuickDeal(input)}
        onUpdate={() => {}}
        agents={quickCreateAgents}
        sourceOptions={SOURCE_OPTIONS}
        servicePackageOptions={SERVICE_PACKAGE_OPTIONS}
        packageOptions={CRM_PACKAGE_OPTIONS}
        industryOptions={INDUSTRY_OPTIONS.map(value => ({ value, label: value }))}
        currentUser={user ?? null}
        initialCustomer={
          draftCustomerId
            ? { id: draftCustomerId, name: customers.find(c => c.id === draftCustomerId)?.label || '' }
            : null
        }
        initialProject={draftProjectId ? { id: draftProjectId } : null}
      />
      {dealCreateError ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={() => setDealCreateError('')}>
          <div className="qc-deal-picker" onMouseDown={event => event.stopPropagation()}>
            <h3>Không tạo được cơ hội</h3>
            <div className="qc-workspace-note-box qc-workspace-note-box--warn">{dealCreateError}</div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn qc-btn-primary" onClick={() => setDealCreateError('')}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {previewModalOpen ? (() => {
        // BUG THAT DA GAP ("bấm Preview khách hàng ở bước 1 ra bảng cũ chứ
        // không hiện bản PDF"): xem giai thich day du o khai bao
        // draftSelectedForm/draftPreviewData/draftPreviewTotals o tren -
        // resolve schema tu quote THAT (da luu) HOAC tu mau bao gia da chon
        // trong dropdown (che do tao moi, chua luu) - CHI khi ca 2 deu
        // khong co (chua chon mau nao ca) moi roi ve ban rut gon cu.
        const previewSchema = quote?.formSnapshot || draftSelectedForm?.schemaJson;
        return (
      <>
      <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewModalOpen(false); }}>
          <div className={`qc-workspace-preview-modal${previewSchema ? ' qc-workspace-preview-modal--doc' : ''}`}>
            <div className="qc-workspace-modal-head">
              <h3>{quote ? 'Bản xem trước cho khách hàng' : 'Bản xem trước'}</h3>
              <div className="qc-workspace-card-head-badges">
                {/* "Cột hiển thị" gop vao NGAY TRONG popup preview (yeu cau
                 * rieng "Gộp lại chức năng Cột hiển thị vào bên trong Xem
                 * bản khách hàng... tại góc trên bên phải") - dung LAI DUNG
                 * component/state/handler cu (columnVisibilityDraft/
                 * handleColumnVisibilityChange/columnVisibilitySchema), CHI
                 * doi vi tri render tu sidebar sang day. Bat/tat cot cap
                 * nhat NGAY quoteData.visibleColumns ma QuoteDocumentRenderer
                 * ben duoi dang doc, nen ban preview dang mo phan anh ket
                 * qua ngay lap tuc, khong can dong/mo lai popup. */}
                {previewSchema && columnVisibilitySchema ? (
                  <QuoteColumnVisibilityPicker
                    schema={columnVisibilitySchema}
                    draft={columnVisibilityDraft}
                    onChange={handleColumnVisibilityChange}
                    quoteFormId={quote?.quoteFormId || draftFormId || defaultFormId}
                    readOnly={!isDraft || isLockedForReview}
                  />
                ) : null}
                {/* "chỉnh xoay ngang, xoay dọc, căn chỉnh cột ở đây luôn" -
                 * toolbar Dọc/Ngang + Đặt lại độ rộng cột + In/Tải PDF nam
                 * TRUC TIEP trong header popup nay (khong con nut "Xem trước
                 * khi in" mo THEM 1 lop modal rieng nhu truoc - bug tung gap
                 * "In/Tải trực tiếp tại đây" (phân trang "11 trang, lặp
                 * letterhead") da duoc fix rieng qua cac rule position:static
                 * !important cho .qc-modal-backdrop/.qc-workspace-preview-
                 * modal, xem quotes.css, nen gio in thang tu day an toan). */}
                {previewSchema ? (
                  <div className="quote-print-preview-orientation-group" role="group" aria-label="Hướng giấy">
                    <button
                      type="button"
                      className={`quote-print-preview-btn${printOrientation === 'portrait' ? ' is-active' : ''}`}
                      onClick={() => setPrintOrientation('portrait')}
                    >
                      <RectangleVertical className="quote-print-preview-icon" /> Dọc
                    </button>
                    <button
                      type="button"
                      className={`quote-print-preview-btn${printOrientation === 'landscape' ? ' is-active' : ''}`}
                      onClick={() => setPrintOrientation('landscape')}
                    >
                      <RectangleHorizontal className="quote-print-preview-icon" /> Ngang
                    </button>
                  </div>
                ) : null}
                {previewSchema ? (
                  <button
                    type="button"
                    className="qc-mini-btn"
                    title="Kéo viền phải mỗi cột trong bảng để chỉnh độ rộng, sau đó bấm In"
                    onClick={() => {
                      setPrintColumnWidths(null);
                      setPrintResetKey(key => key + 1);
                    }}
                  >
                    <RotateCcw className="qc-icon" /> Đặt lại độ rộng cột
                  </button>
                ) : null}
                {/* Nut "Lưu" giong het toolbar ban PDF chinh thuc
                 * (QuoteDetailPage) - luu huong giay + do rong cot de lan
                 * in/tai PDF sau dung dung ban da chinh. */}
                {previewSchema ? (
                  <QuotePrintLayoutSaveButton
                    quoteId={quote?.id ?? null}
                    printOrientation={printOrientation}
                    columnWidthsDraft={printColumnWidths}
                    // CHI cap nhat dung khoa printLayoutPrefs - khong ghi de
                    // ca `quote` (tranh dung cham state dang sua do).
                    onSaved={updated => setQuote(prev => (prev ? { ...prev, data: { ...prev.data, printLayoutPrefs: updated.data?.printLayoutPrefs } } : prev))}
                    onSaveLocal={prefs => {
                      setDraftPrintLayoutPrefs(prefs);
                      showToast(true, 'Đã lưu hướng giấy + độ rộng cột, sẽ áp dụng khi tạo báo giá.');
                    }}
                  />
                ) : null}
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setPreviewModalOpen(false)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
            </div>
            {/* CHOT LAI (yeu cau ro rang "Preview phải dùng chung renderer và
             * cùng dữ liệu với public quote/PDF/bản in, không duy trì renderer
             * rút gọn riêng"): khi quote da co formSnapshot that (da tao xong,
             * da chon Mau bao gia), dung THANG QuoteDocumentRenderer mode=
             * 'public' - CHINH XAC cung component/du lieu voi trang cong khai
             * (xem PublicQuotePage.tsx) nen tu dong an het Gia von/Markup/
             * Margin/ghi chu noi bo (schema cong khai von di khong co field
             * nay), khong phai tu allowlist rieng nhu ban rut gon cu. Bao boc
             * trong .quote-print-root de tai dung dung co che "in bulletproof"
             * da co san (quotes.css) - visibility:hidden ca trang, chi hien
             * dung khoi nay, hoat dong DU dang nam trong modal long nhieu lop. */}
            {previewSchema ? (
              // CHOT LAI (yeu cau ro rang "popup quá nhỏ, không cuộn xuống
              // được"): BO HAN co che transform:scale() + do dac JS truoc do
              // (fragile, tinh chieu cao sai la mat noi dung/khong cuon
              // duoc) - .quote-sheet/.quote-sheet--print-landscape BAN THAN
              // DA CO `width: min(210mm|297mm, 100%)` (xem quotes.css), tu
              // nhien co lai vua khit container KHONG CAN JS - don gian hon,
              // it loi hon han. Container o day CHI can la vung cuon DOC
              // that (overflow-y:auto, overflow-x:hidden), qua .qc-workspace-
              // preview-modal-body--doc (CSS da doi lai thanh flex:1 min-
              // height:0 - xem quote-center.css).
              <div className="quote-print-root qc-workspace-preview-modal-body qc-workspace-preview-modal-body--doc">
                <QuoteDocumentRenderer
                  key={printResetKey}
                  schemaSnapshot={previewSchema}
                  quoteData={quote ? quote.data : draftPreviewData}
                  quoteItems={buildItemTree(itemsDraft)}
                  solutionItems={quote ? quote.data?.solutionItems : undefined}
                  totals={previewSchema.layoutType === 'villa_solution_package' && quote ? {
                    subtotalAmount: quote.subtotalAmount ?? 0,
                    totalVatAmount: quote.vatAmount ?? 0,
                    totalAmount: quote.totalAmount ?? 0,
                  } : calculateQuoteTotals(itemsDraft)}
                  mode="public"
                  isPublished={quote ? quote.processingStage === 'published' : false}
                  quoteNumber={quote?.quoteNumber}
                  overallDiscountPercent={quote ? quote.overallDiscountPercent ?? null : draftOverallDiscountPercent ?? null}
                  printPreviewMode
                  printOrientation={printOrientation}
                  initialColumnWidths={printColumnWidths}
                  onColumnWidthsChange={setPrintColumnWidths}
                  contactPersonName={plainNameFor(quote ? quote.quoteOwnerId : draftQuoteOwnerId)}
                />
              </div>
            ) : (
              /* Chi con dung khi CHUA chon mau bao gia nao ca (khong co
               * schema nao de dung chung renderer) - giu ban toi gian cu lam
               * fallback cuoi cung cho dung truong hop hiem nay. */
              <div className="qc-workspace-preview-modal-body">
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Khách hàng</span>
                  <strong>{deal?.customerName || (!quote && typeof draftPreviewData.customerRecipient === 'string' ? draftPreviewData.customerRecipient : '') || 'Chưa gắn cơ hội'}</strong>
                </div>
                <table className="qc-linked-table qc-linked-table--preview4col">
                  <thead>
                    <tr>
                      <th>Hạng mục</th>
                      <th className="qc-th-money">SL</th>
                      <th className="qc-th-money">Đơn giá</th>
                      <th className="qc-th-money">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let sectionCounter = 0;
                      return itemsDraft.map((item, index) => {
                        if (item.rowType === 'section') {
                          sectionCounter += 1;
                          const previewRoman = toRomanNumeral(sectionCounter);
                          return (
                            <tr key={item.id || index} className="qc-linked-table-section-row">
                              <td colSpan={4}>
                                <strong>{previewRoman}. {stripLeadingRomanPrefix(item.description || '', previewRoman) || 'Mục mới'}</strong>
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={item.id || index}>
                            <td>{item.serviceDescription || '—'}</td>
                            <td className="qc-cell-money">{item.quantity}</td>
                            <td className="qc-cell-money">{formatMoney(item.unitPrice ?? 0)}</td>
                            <td className="qc-cell-money">{formatMoney(item.totalAmount || item.quantity * (item.unitPrice ?? 0) || 0)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
                <div className="qc-workspace-summary-row">
                  <span>VAT</span>
                  <strong>{formatMoney(previewTotals.vat)}</strong>
                </div>
                <div className="qc-workspace-summary-row qc-workspace-summary-row--total">
                  <span>Tổng thanh toán</span>
                  <strong>{formatMoney(previewTotals.total)}</strong>
                </div>
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Điều khoản thanh toán</span>
                  <p>Thanh toán trong {draftPaymentTermsDays} ngày kể từ ngày duyệt báo giá.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
        );
      })() : null}

      {quote && sendModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setSendModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Gửi khách hàng</h3>
            <p className="qc-workspace-note">Báo giá {quote.quoteNumber} · V{quote.versionNumber || 1}</p>

            {sendSuccess ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--ok">
                Đã gửi báo giá tới {sendRecipientEmail}.
              </div>
            ) : (
              <>
                <label className="qc-workspace-info-label">Người nhận</label>
                <input
                  type="text"
                  className="crm-input"
                  value={sendRecipientName}
                  onChange={event => setSendRecipientName(event.target.value)}
                  placeholder="Tên người nhận (không bắt buộc)"
                />
                <label className="qc-workspace-info-label">Email người nhận</label>
                <input
                  type="email"
                  className="crm-input"
                  value={sendRecipientEmail}
                  onChange={event => { setSendRecipientEmail(event.target.value); setSendRecipientSource('manual'); }}
                  placeholder="email@khachhang.com"
                />
                {sendRecipientSource ? (
                  <p className="qc-workspace-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                    Nguồn email: {sendRecipientSource === 'deal_contact' ? 'Cơ hội CRM' : sendRecipientSource === 'crm_customer' ? 'Hồ sơ khách hàng' : 'Nhập tay'}
                  </p>
                ) : null}

                <label className="qc-workspace-info-label">Tiêu đề</label>
                <input
                  type="text"
                  className="crm-input"
                  value={sendSubject}
                  onChange={event => setSendSubject(event.target.value)}
                />

                <label className="qc-workspace-info-label">Lời nhắn</label>
                <textarea
                  className="qc-workspace-handoff-note"
                  rows={3}
                  value={sendMessage}
                  onChange={event => setSendMessage(event.target.value)}
                  placeholder="Lời nhắn gửi kèm báo giá..."
                />

                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Public link</span>
                  <a href={buildPublicQuoteUrl(quote.publicUrl) || '#'} target="_blank" rel="noreferrer">{buildPublicQuoteUrl(quote.publicUrl)}</a>
                </div>

                <label className="qc-workspace-checklist-item" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={sendAttachPdf} onChange={event => setSendAttachPdf(event.target.checked)} />
                  <span>Đính kèm PDF (tự render từ bản khách hàng)</span>
                </label>

                {sendError ? (
                  <div className="qc-workspace-note-box qc-workspace-note-box--warn">{sendError}</div>
                ) : null}
              </>
            )}

            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={sendBusy} onClick={() => setSendModalOpen(false)}>
                {sendSuccess ? 'Đóng' : 'Huỷ'}
              </button>
              {!sendSuccess ? (
                <button
                  type="button"
                  className="qc-btn qc-btn-primary"
                  disabled={sendBusy || !sendRecipientEmail.trim()}
                  aria-busy={sendBusy}
                  onClick={() => void submitSendQuote()}
                >
                  {sendBusy ? (<><span className="qc-btn-spinner" aria-hidden="true" /> Đang gửi…</>) : sendError ? 'Thử lại' : 'Gửi báo giá'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}


      {workspaceToast ? (
        <div className={`qc-workspace-toast ${workspaceToast.ok ? 'qc-workspace-toast--ok' : 'qc-workspace-toast--error'}`}>
          <span>{workspaceToast.text}</span>
          {workspaceToast.action ? (
            <button
              type="button"
              className="qc-workspace-toast-action"
              onClick={() => {
                workspaceToast.action!.onClick();
                setWorkspaceToast(null);
              }}
            >
              {workspaceToast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {quote && approveModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setApproveModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Duyệt báo giá</h3>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Mã báo giá/version</span>
              <strong>{quote.quoteNumber} · V{quote.versionNumber || 1}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Người gửi duyệt</span>
              <strong>{ownerNameFor(quote.quoteOwnerId) === 'Chưa gán' ? nameFor(quote.createdById) : ownerNameFor(quote.quoteOwnerId)}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Tổng thanh toán</span>
              <strong>{formatMoney(quote.totalAmount)}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Margin</span>
              <strong className={marginBelowThreshold ? 'qc-cell-margin-warn' : hasCostData ? 'qc-cell-margin-good' : ''}>
                {hasCostData && quote.grossMarginPercent != null ? formatPercentTrim(quote.grossMarginPercent) : 'Chưa có dữ liệu giá vốn'}
              </strong>
            </div>
            {marginBelowThreshold ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                Cảnh báo: margin dưới ngưỡng tham chiếu 20%.
              </div>
            ) : null}
            <div className="qc-workspace-note-box">
              Sau khi duyệt, version {quote.versionNumber || 1} sẽ bị khoá — không sửa được nữa, chỉ tạo được phiên bản mới.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setApproveModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} aria-busy={busy && activeAction === 'approve'} onClick={() => void approveNow()}>
                {actionButtonContent('approve', 'Duyệt báo giá')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && exceptionApprovalModal.open ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setExceptionApprovalModal({ open: false, reason: '', evaluation: null }); }}>
          <div className="qc-deal-picker">
            <h3>Phê duyệt ngoại lệ</h3>
            <div className="qc-workspace-note-box qc-workspace-note-box--warn">
              Báo giá {quote.quoteNumber} · V{quote.versionNumber || 1} chưa đạt Rule Engine
              {exceptionApprovalModal.evaluation?.result === 'insufficient_data' ? ' (chưa đủ dữ liệu để đánh giá)' : ''}.
              Bạn đang duyệt NGOẠI LỆ — bắt buộc nhập lý do, quyết định này sẽ được ghi lại trong lịch sử.
            </div>
            {Array.isArray((exceptionApprovalModal.evaluation?.details as Array<{ label?: string; reason?: string; status?: string }> | undefined)) ? (
              <ul className="qc-workspace-activity" style={{ marginBottom: 12 }}>
                {(exceptionApprovalModal.evaluation!.details as Array<{ ruleType: string; label: string; reason: string; status: string }>).map(d => (
                  <li key={d.ruleType} className={d.status === 'fail' ? 'qc-cell-margin-warn' : d.status === 'insufficient_data' ? 'qc-workspace-muted' : undefined}>
                    {d.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <label>
              <span className="qc-workspace-info-label">Lý do phê duyệt ngoại lệ (bắt buộc)</span>
              <textarea
                className="qc-workspace-handoff-note"
                rows={3}
                value={exceptionApprovalModal.reason}
                onChange={event => setExceptionApprovalModal(prev => ({ ...prev, reason: event.target.value }))}
                placeholder="Vd: Khách hàng chiến lược, chấp nhận margin thấp hơn ngưỡng để giữ quan hệ dài hạn."
              />
            </label>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setExceptionApprovalModal({ open: false, reason: '', evaluation: null })}>Huỷ</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !exceptionApprovalModal.reason.trim()}
                aria-busy={busy && activeAction === 'approve'}
                onClick={() => void approveWithExceptionNow()}
              >
                {actionButtonContent('approve', 'Duyệt ngoại lệ')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && publishModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPublishModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Phát hành báo giá</h3>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Version</span>
              <strong>{quote.quoteNumber} · V{quote.versionNumber || 1}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Hiệu lực báo giá</span>
              <strong>{quote.validUntil ? formatDate(quote.validUntil) : 'Chưa đặt hiệu lực'}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Public link</span>
              {quote.publicUrl ? (
                <strong>Đã bật — {buildPublicQuoteUrl(quote.publicUrl)}</strong>
              ) : (
                <strong>Chưa bật</strong>
              )}
            </div>
            {quote.publicUrl ? (
              <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                <Link2 className="qc-icon" /> Sao chép public link
              </button>
            ) : null}
            <div className="qc-workspace-note-box">
              Sau khi phát hành, version {quote.versionNumber || 1} sẽ được khoá, public link sẽ được bật thật.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setPublishModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} aria-busy={busy && activeAction === 'publish'} onClick={() => void publishNow()}>
                {actionButtonContent('publish', 'Xác nhận phát hành')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && deliveryLogModal.open ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setDeliveryLogModal(m => ({ ...m, open: false })); }}>
          <div className="qc-deal-picker">
            <h3>Lịch sử gửi báo giá</h3>
            {deliveryLogModal.loading ? (
              <div className="qc-workspace-muted">Đang tải lịch sử gửi…</div>
            ) : deliveryLogModal.error ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--warn">{deliveryLogModal.error}</div>
            ) : deliveryLogModal.entries.length === 0 ? (
              <div className="qc-workspace-muted">Chưa có lần gửi nào.</div>
            ) : (
              <div className="qc-table-wrap">
                <table className="qc-linked-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Người nhận</th>
                      <th>Người gửi</th>
                      <th>Trạng thái</th>
                      <th>Lần thử</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryLogModal.entries.map(entry => (
                      <tr key={entry.id}>
                        <td>{entry.requestedAt ? formatDate(entry.requestedAt) : '—'}</td>
                        <td>
                          {entry.recipientName || 'Chưa rõ'}
                          {entry.recipientEmail ? <div className="qc-row-sub">{entry.recipientEmail}</div> : null}
                        </td>
                        <td>{nameFor(entry.requestedById)}</td>
                        <td>
                          <span className={`qc-badge qc-badge-${entry.status === 'sent' ? 'success' : entry.status === 'failed' ? 'danger' : 'neutral'}`}>
                            {entry.status === 'sent' ? 'Đã gửi' : entry.status === 'failed' ? 'Thất bại' : entry.status === 'sending' ? 'Đang gửi' : 'Đang chờ'}
                          </span>
                          {entry.status === 'failed' && entry.errorMessage ? <div className="qc-row-sub">{entry.errorMessage}</div> : null}
                        </td>
                        <td>{entry.attemptCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setDeliveryLogModal(m => ({ ...m, open: false }))}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && requestChangesModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setRequestChangesModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Yêu cầu chỉnh sửa</h3>
            <label className="qc-workspace-info-label">Chọn phần cần sửa</label>
            <select className="crm-input" value={requestChangesSection} onChange={event => setRequestChangesSection(event.target.value as 'technical' | 'pricing')}>
              <option value="technical">Thông tin kỹ thuật</option>
              <option value="pricing">Giá bán</option>
            </select>
            <label className="qc-workspace-info-label">Lý do (bắt buộc)</label>
            <textarea
              className="qc-workspace-handoff-note"
              rows={3}
              value={requestChangesReason}
              onChange={event => setRequestChangesReason(event.target.value)}
              placeholder="Vì sao cần chỉnh sửa lại..."
            />
            <div className="qc-workspace-note-box">
              Báo giá sẽ chuyển lùi về đúng bước đã chọn để chỉnh sửa lại — chỉ áp dụng khi đang ở "Chờ duyệt", chưa duyệt.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setRequestChangesModalOpen(false)}>Huỷ</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !requestChangesReason.trim()}
                aria-busy={busy && activeAction === 'requestChanges'}
                onClick={() => void requestChangesNow()}
              >
                {actionButtonContent('requestChanges', 'Gửi yêu cầu chỉnh sửa')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CatalogPickerModal
        open={catalogModalOpen}
        onClose={() => {
          setCatalogModalOpen(false);
          setAutoSelectCatalogItemId(null);
          setCatalogHydrationError(null);
          setCatalogHydrationRetryItem(null);
        }}
        showZoneTab
        activeSource={catalogSource}
        onSourceChange={source => {
          setCatalogSource(source);
          if (source === 'zone') void loadPriceBookItems();
        }}
        loading={catalogSource === 'zone' ? priceBookLoading : catalogLoading}
        items={catalogSource === 'zone' ? zonePickerItems : internalPickerItems}
        onAddSelected={ids => (catalogSource === 'zone' ? handleAddSelectedZoneItems(ids) : handleAddSelectedCatalogItems(ids))}
        autoSelectId={catalogSource === 'internal' ? autoSelectCatalogItemId : undefined}
        adding={catalogSource === 'internal' && Boolean(catalogHydratingItem)}
        hydratingItem={catalogSource === 'internal' ? catalogHydratingItem : null}
        hydrationError={catalogSource === 'internal' ? catalogHydrationError : null}
        onRetryHydration={catalogHydrationRetryItem ? () => {
          void handleQuickAddProductCreated(catalogHydrationRetryItem);
        } : undefined}
        groupFilterValue={catalogSource === 'internal' ? pickerGroupFilter : undefined}
        onGroupFilterChange={catalogSource === 'internal' ? setPickerGroupFilter : undefined}
        onQuickAddProduct={catalogSource === 'internal' ? () => setQuickAddProductTarget('newRow') : undefined}
        onQuickAddGroup={catalogSource === 'internal' ? () => setQuickAddGroupOpen(true) : undefined}
        extraToolbar={
          catalogSource === 'internal' && catalogSectionOptions.length > 0 ? (
            <div className="cp-filter-chips" style={{ paddingTop: 0 }}>
              <select className="crm-input" value={catalogTargetSectionId} onChange={e => setCatalogTargetSectionId(e.target.value)}>
                <option value="">Thêm vào: Cuối bảng</option>
                {catalogSectionOptions.map(s => <option key={s.id} value={s.id}>Thêm vào mục: {s.label}</option>)}
              </select>
            </div>
          ) : undefined
        }
      />

      <QuickAddGroupModal
        open={quickAddGroupOpen}
        onClose={() => setQuickAddGroupOpen(false)}
        onCreated={group => void handleGroupCreated(group)}
      />

      <QuickAddProductModal
        open={quickAddProductTarget != null}
        onClose={() => setQuickAddProductTarget(null)}
        groups={(catalogTree || []).filter(g => g.itemType === 'group')}
        existingItems={catalogFlatItems}
        defaultGroupId={
          // "Khi đang chọn nhóm VPS Hosting, bấm + Sản phẩm mới: Tự chọn sẵn
          // nhóm VPS Hosting" - suy tu pickerGroupFilter (ten nhom dang loc
          // trong Picker) sang id THAT tuong ung trong catalogTree.
          pickerGroupFilter ? (catalogTree || []).find(g => g.itemType === 'group' && g.name === pickerGroupFilter)?.id : undefined
        }
        initialValues={
          typeof quickAddProductTarget === 'object' && quickAddProductTarget
            ? (() => {
                const source = itemsDraft[quickAddProductTarget.linkIndex];
                return source
                  ? {
                      name: source.serviceDescription || source.description,
                      unit: source.unit,
                      vatRate: source.vatRate,
                      unitPriceVnd: source.unitPrice ?? undefined,
                      costPriceVnd: source.costPrice,
                    }
                  : undefined;
              })()
            : undefined
        }
        onCreated={item => void handleQuickAddProductCreated(item)}
      />

      <ConfirmModal
        open={discardCloseConfirmOpen}
        title="Bạn có thay đổi chưa lưu"
        message="Bạn có muốn thoát và bỏ các thay đổi này không?"
        cancelLabel="Tiếp tục chỉnh sửa"
        onClose={() => setDiscardCloseConfirmOpen(false)}
        actions={[
          {
            label: 'Bỏ thay đổi',
            variant: 'primary',
            onClick: confirmDiscardAndClose,
          },
        ]}
      />

      <ConfirmModal
        open={fillDownConfirm != null}
        title="Ghi đè dòng đã có giá trị"
        message={
          fillDownConfirm
            ? `${fillDownConfirm.targetIndices.filter(i => {
                const row = itemsDraft[i];
                return fillDownConfirm.field === 'costPrice' ? row.costPrice != null : row.markupPercent != null;
              }).length} trong số ${fillDownConfirm.targetIndices.length} dòng đã có ${fillDownConfirm.field === 'costPrice' ? 'giá vốn' : 'markup'} — Điền xuống sẽ ghi đè các dòng này. Tiếp tục?`
            : ''
        }
        onClose={() => setFillDownConfirm(null)}
        actions={[
          {
            label: 'Điền xuống, ghi đè',
            variant: 'primary',
            onClick: () => fillDownConfirm && applyFillDown(fillDownConfirm.index, fillDownConfirm.field, fillDownConfirm.targetIndices, fillDownConfirm.mode),
          },
        ]}
      />

      <ConfirmModal
        open={markupApplyConfirm != null}
        title="Ghi đè Markup đã có"
        message={
          markupApplyConfirm
            ? `${itemsDraft.filter(row => row.costPrice != null && row.markupPercent != null).length} hạng mục đã có Markup — áp Markup ${markupApplyConfirm.percent}% sẽ ghi đè giá bán các dòng này. Tiếp tục?`
            : ''
        }
        onClose={() => setMarkupApplyConfirm(null)}
        actions={[
          {
            label: 'Áp dụng, ghi đè',
            variant: 'primary',
            onClick: () => {
              if (markupApplyConfirm) doApplyQuickMarkup(markupApplyConfirm.percent);
              setMarkupApplyConfirm(null);
            },
          },
        ]}
      />

      <ConfirmModal
        open={marginApplyConfirm != null}
        title="Ghi đè Margin đã có"
        message={
          marginApplyConfirm
            ? `${itemsDraft.filter(row => row.costPrice != null && row.markupPercent != null).length} hạng mục đã có Markup/Giá khách — áp Margin mục tiêu ${marginApplyConfirm.percent}% sẽ ghi đè giá bán các dòng này. Tiếp tục?`
            : ''
        }
        onClose={() => setMarginApplyConfirm(null)}
        actions={[
          {
            label: 'Áp dụng, ghi đè',
            variant: 'primary',
            onClick: () => {
              if (marginApplyConfirm) doApplyTargetMargin(marginApplyConfirm.percent);
              setMarginApplyConfirm(null);
            },
          },
        ]}
      />

      <ConfirmModal
        open={catalogAdd.dedupQueue.length > 0}
        title="Sản phẩm đã có trong bảng"
        message={
          catalogAdd.dedupQueue[0]
            ? `"${catalogAdd.dedupQueue[0].label}" đã có sẵn 1 dòng trong bảng hạng mục. Bạn muốn tăng số lượng dòng có sẵn hay vẫn thêm thành dòng mới?`
            : ''
        }
        onClose={() => catalogAdd.cancelDedup()}
        actions={[
          {
            label: 'Tăng số lượng dòng có sẵn',
            variant: 'primary',
            onClick: () => {
              const entry = catalogAdd.dedupQueue[0];
              catalogAdd.resolveDedup('increase', existingIndex => increaseExistingRowQty(existingIndex, entry?.candidate.item.quantity ?? 1));
            },
          },
          { label: 'Vẫn thêm dòng mới', onClick: () => catalogAdd.resolveDedup('addNew', () => {}) },
        ]}
      />

      <ConfirmModal
        open={zoneAdd.dedupQueue.length > 0}
        title="Sản phẩm đã có trong bảng"
        message={
          zoneAdd.dedupQueue[0]
            ? `"${zoneAdd.dedupQueue[0].label}" đã có sẵn 1 dòng trong bảng hạng mục. Bạn muốn tăng số lượng dòng có sẵn hay vẫn thêm thành dòng mới?`
            : ''
        }
        onClose={() => zoneAdd.cancelDedup()}
        actions={[
          {
            label: 'Tăng số lượng dòng có sẵn',
            variant: 'primary',
            onClick: () => {
              const entry = zoneAdd.dedupQueue[0];
              zoneAdd.resolveDedup('increase', existingIndex => increaseExistingRowQty(existingIndex, entry?.candidate.item.quantity ?? 1));
            },
          },
          { label: 'Vẫn thêm dòng mới', onClick: () => zoneAdd.resolveDedup('addNew', () => {}) },
        ]}
      />

      {priceBookDrawerIndex != null && itemsDraft[priceBookDrawerIndex] ? (() => {
        const drawerItem = itemsDraft[priceBookDrawerIndex];
        const snap = (drawerItem.priceBookSnapshot || {}) as Record<string, any>;
        const hasOverride = drawerItem.costPriceOriginal != null;
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPriceBookDrawerIndex(null); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 480 }}>
              <div className="qc-workspace-modal-head">
                <h3>Chi tiết giá — Bảng giá VPS Zone</h3>
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setPriceBookDrawerIndex(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <p><strong>{drawerItem.serviceDescription || drawerItem.description}</strong></p>
                {costViewAllowed ? (
                  <>
                    <p>Chế độ giá vốn: {snap.costMode === 'usd' ? 'USD × Tỷ giá' : 'VND trực tiếp'}</p>
                    {snap.costMode === 'usd' ? (
                      <>
                        <p>Đơn giá USD: {snap.unitPriceUsd ?? '—'}</p>
                        <p>Tỷ giá: {snap.exchangeRate ?? '—'}</p>
                        <p>Thuế nhập khẩu: {snap.importDutyPercent ?? 0}%</p>
                      </>
                    ) : null}
                    <p>VAT đầu vào: {snap.vatInPercent ?? 0}%</p>
                    <p>Nhà cung cấp: {snap.vendorName || '—'}</p>
                    <p>VAT đầu ra: {snap.vatEuPercent ?? 0}%</p>
                    <p>Giá tham chiếu: {snap.referencePrice != null ? formatMoney(snap.referencePrice) : '—'}</p>
                    {snap.referenceLink ? <p>Link tham chiếu: <a href={snap.referenceLink} target="_blank" rel="noreferrer">{snap.referenceLink}</a></p> : null}
                    {snap.quoteLink ? <p>Link/chứng từ giá: <a href={snap.quoteLink} target="_blank" rel="noreferrer">{snap.quoteLink}</a></p> : null}

                    <hr />
                    <p>
                      Giá vốn hiện tại: <strong>{drawerItem.costPrice != null ? formatMoney(drawerItem.costPrice) : '—'}</strong>
                      {hasOverride ? <span className="qc-row-sub"> · Đã điều chỉnh (gốc: {formatMoney(drawerItem.costPriceOriginal || 0)})</span> : null}
                    </p>
                    {drawerItem.costOverrideReason ? (
                      <p className="qc-row-sub">
                        Lý do: {drawerItem.costOverrideReason} — {drawerItem.costOverrideAt ? new Date(drawerItem.costOverrideAt).toLocaleString('vi-VN') : ''}
                      </p>
                    ) : null}

                    {canEditCostCells ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" className="qc-btn" onClick={() => setCostOverrideModal({ index: priceBookDrawerIndex, reason: '', value: drawerItem.costPrice ?? null })}>
                          Ghi đè giá vốn (có lý do)
                        </button>
                        {hasOverride ? (
                          <button type="button" className="qc-btn" onClick={() => restoreCostFormula(priceBookDrawerIndex)}>
                            Khôi phục theo công thức
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="qc-row-sub">Không có quyền xem giá vốn.</p>
                )}
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setPriceBookDrawerIndex(null)}>Đóng</button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {/* Popover "Chỉnh sửa phạm vi bảo hành & ghi chú/khuyến mãi hạng mục" -
       * NHO gon (khong phai drawer to), gom: Ten hang muc (chi doc) + Textarea
       * "Phạm vi bảo hành" + Textarea "Ghi chú/Khuyến mãi" + Huỷ/Lưu. "Nội
       * dung công việc" (quote_item.description) da CHUYEN ra textarea sua
       * truc tiep ngay duoi ten hang muc trong bang (khong con o popover nay -
       * yeu cau ro rang "chỉnh được ở đây luôn, không cần bấm vào chỉnh nữa").
       * "Ghi chú/Khuyến mãi" (quote_item.note) them cho "Mẫu ưu đãi combo
       * (Markee)" - field nay khach SE NHIN THAY (public), khac warrantyScope
       * cung public nhung khac muc dich. Luu vao DUNG quote_item.warrantyScope
       * + quote_item.note - dung DUNG persistQuote({items:next}) de tranh doc
       * lai itemsDraft cu (xem giai thich o saveDescriptionPopover). */}
      {descriptionPopoverIndex != null && itemsDraft[descriptionPopoverIndex] ? (() => {
        const descItem = itemsDraft[descriptionPopoverIndex];
        const canEditDescription = canEdit && isDraft && !isLockedForReview;
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setDescriptionPopoverIndex(null); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 460 }}>
              <div className="qc-workspace-modal-head">
                <h3>Phạm vi bảo hành & ghi chú hạng mục</h3>
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setDescriptionPopoverIndex(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <div className="qc-workspace-drawer-field">
                  <span className="qc-workspace-info-label">Tên hạng mục</span>
                  <p>{descItem.serviceDescription || '—'}</p>
                </div>
                <label className="qc-workspace-drawer-field">
                  <span className="qc-workspace-info-label">Phạm vi bảo hành</span>
                  <textarea className="qc-cell-input" rows={4} value={warrantyDraftText} disabled={!canEditDescription}
                    placeholder="Nhập phạm vi bảo hành riêng cho hạng mục..." onChange={e => setWarrantyDraftText(e.target.value)} />
                </label>
                <label className="qc-workspace-drawer-field">
                  <span className="qc-workspace-info-label">Ghi chú/Khuyến mãi</span>
                  <textarea className="qc-cell-input" rows={3} value={noteDraftText} disabled={!canEditDescription}
                    placeholder="Ví dụ: Giảm giá 15% cho khách hàng đầu tiên khi order trước ngày..." onChange={e => setNoteDraftText(e.target.value)} />
                </label>
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setDescriptionPopoverIndex(null)}>
                  {canEditDescription ? 'Huỷ' : 'Đóng'}
                </button>
                {canEditDescription ? (
                  <button type="button" className="qc-btn qc-btn-primary" onClick={saveDescriptionPopover}>
                    Lưu
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })() : null}

      {itemDetailDrawerIndex != null && itemsDraft[itemDetailDrawerIndex] ? (() => {
        const drawerIndex = itemDetailDrawerIndex;
        const drawerItem = itemsDraft[drawerIndex];
        const drawerEditableTechnical = canEditCostCells;
        const drawerEditablePricing = canEditPricingCells;
        const sourceLabel = drawerItem.priceBookItemId
          ? 'Bảng giá VPS Zone'
          : drawerItem.catalogItemId
            ? 'Danh mục dịch vụ'
            : 'Nhập tay';
        // Dong drawer: 'save' = ghi that (persistQuote), 'discard' = phuc
        // hoi lai DUNG snapshot luc mo (huy moi sua doi con dang o local
        // state, KHONG bao gio goi persistQuote) - khong con onBlur nao tu
        // luu am tham trong drawer nay nua.
        function closeItemDetailDrawer(action: 'save' | 'discard') {
          if (action === 'save') {
            void persistQuote({}, { silent: true });
          } else if (itemDetailDrawerSnapshot) {
            setItemsDraft(prev => prev.map((row, i) => (i === drawerIndex ? deepClone(itemDetailDrawerSnapshot) : row)));
          }
          setItemDetailDrawerIndex(null);
          setItemDetailDrawerSnapshot(null);
        }
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) closeItemDetailDrawer('discard'); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 480 }}>
              <div className="qc-workspace-modal-head">
                <h3>Chi tiết hạng mục</h3>
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => closeItemDetailDrawer('discard')}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <label className="qc-workspace-drawer-field">
                  Tên hạng mục
                  {drawerEditableTechnical ? (
                    <input
                      className="qc-cell-input"
                      value={drawerItem.serviceDescription || ''}
                      onChange={e => updateRow(drawerIndex, { serviceDescription: e.target.value })}
                    />
                  ) : (
                    <p>{drawerItem.serviceDescription || '—'}</p>
                  )}
                </label>
                <label className="qc-workspace-drawer-field">
                  Đơn vị tính (ĐVT)
                  {drawerEditableTechnical ? (
                    <input
                      className="qc-cell-input"
                      value={drawerItem.unit || ''}
                      onChange={e => updateRow(drawerIndex, { unit: e.target.value })}
                      placeholder="Gói, Tháng..."
                    />
                  ) : (
                    <p>{drawerItem.unit || '—'}</p>
                  )}
                </label>
                <label className="qc-workspace-drawer-field">
                  Số lượng
                  {drawerEditableTechnical ? (
                    <input
                      type="number"
                      className="qc-cell-input"
                      value={drawerItem.quantity}
                      onChange={e => updateRow(drawerIndex, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  ) : (
                    <p>{drawerItem.quantity}</p>
                  )}
                </label>
                <p>Nguồn gốc: <strong>{sourceLabel}</strong></p>
                {costViewAllowed ? (
                  <>
                    <label className="qc-workspace-drawer-field">
                      Giá vốn/ĐV
                      {drawerEditableTechnical ? (
                        <CurrencyInput
                          className="qc-cell-input"
                          value={drawerItem.costPrice ?? null}
                          disabled={drawerItem.costNotApplicable}
                          onChange={value => handleCostPriceChange(drawerIndex, value)}
                        />
                      ) : (
                        <p>{drawerItem.costNotApplicable ? 'Không áp dụng' : drawerItem.costPrice != null ? formatMoney(drawerItem.costPrice) : 'Còn thiếu'}</p>
                      )}
                    </label>
                  </>
                ) : (
                  <p className="qc-row-sub">Không có quyền xem giá vốn.</p>
                )}
                {pricingViewAllowed ? (
                  <label className="qc-workspace-drawer-field">
                    Markup %
                    {drawerEditablePricing ? (
                      <input
                        type="number"
                        className="qc-cell-input"
                        value={drawerItem.markupPercent ?? ''}
                        disabled={drawerItem.costPrice == null}
                        onChange={e => handleMarkupChange(drawerIndex, e.target.value)}
                      />
                    ) : (
                      <p>{formatPercentTrim(drawerItem.markupPercent)}</p>
                    )}
                  </label>
                ) : (
                  <p className="qc-row-sub">Không có quyền xem markup.</p>
                )}
                {drawerEditableTechnical || drawerEditablePricing ? (
                  <p className="qc-row-sub">Sửa xong bấm &quot;Lưu&quot; — đóng bằng X/&quot;Huỷ&quot; sẽ KHÔNG lưu các thay đổi ở trên.</p>
                ) : null}
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => closeItemDetailDrawer('discard')}>Huỷ</button>
                {drawerEditableTechnical || drawerEditablePricing ? (
                  <button type="button" className="qc-btn qc-btn-primary" onClick={() => closeItemDetailDrawer('save')}>Lưu</button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })() : null}

      {costOverrideModal ? (() => {
        const targetItem = itemsDraft[costOverrideModal.index];
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setCostOverrideModal(null); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 420 }}>
              <div className="qc-workspace-modal-head">
                <h3>Ghi đè giá vốn</h3>
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setCostOverrideModal(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <label className="qc-field">
                  <span>Giá vốn mới (VND)</span>
                  <CurrencyInput
                    className="qc-cell-input qc-cell-input-money"
                    value={costOverrideModal.value ?? targetItem?.costPrice ?? null}
                    onChange={value => setCostOverrideModal({ ...costOverrideModal, value })}
                  />
                </label>
                <label className="qc-field">
                  <span>Lý do điều chỉnh *</span>
                  <textarea
                    rows={2}
                    value={costOverrideModal.reason}
                    onChange={e => setCostOverrideModal({ ...costOverrideModal, reason: e.target.value })}
                  />
                </label>
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setCostOverrideModal(null)}>Huỷ</button>
                <button
                  type="button"
                  className="qc-btn qc-btn-primary"
                  disabled={!costOverrideModal.reason.trim()}
                  onClick={() => {
                    const value = costOverrideModal.value;
                    if (value === null || !Number.isFinite(value) || value < 0) return;
                    applyCostOverride(costOverrideModal.index, value, costOverrideModal.reason.trim());
                  }}
                >
                  Lưu
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
