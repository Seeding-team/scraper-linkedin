'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { seedingQuoteRepository, QuoteApprovalRequiresExceptionError, QuoteDocumentRenderer } from '@/modules/quotes';
import type { Quote, QuoteActivityLogEntry, QuoteHandoffChecklist, QuoteItem, QuoteProcessingStage, QuoteApprovalRuleSet, QuoteApprovalRuleType, QuoteRuleEvaluation, QuoteDeliveryLogEntry, QuoteForm } from '@/modules/quotes';
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
import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronUp, Eye, FileText, GitBranchPlus, History, LayoutGrid, Link2, Maximize2, Minimize2, Plus, Send, Trash2, X } from './icons';
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
import { calculateQuoteTotals, calculateOverallDiscountSummary, clampDiscountPercent } from '@/modules/quotes/utils/quoteCalculations';
import { paymentPlanAmount, paymentPlanPercent } from '@/modules/quotes/utils/paymentPlan';
import type { BundleSnapshotComponent, BundleSnapshotValue, CustomBlock, PaymentPlanRow } from '@/modules/quotes/types';

/** 4 buoc THAT (Yeu cau bao gia/Thong tin ky thuat/Hoan thien gia ban/Cho
 * duyet-Phat hanh) - anh xa dung 1-1 voi `quotes.processing_stage` (migration
 * 085). KHONG phai Presale/Sale/CEO - he thong chi co Admin/Leader/Member +
 * Team Sale/Dev/MKT that (xem plan da xac nhan). */
const STAGE_ORDER: QuoteProcessingStage[] = ['request', 'technical', 'pricing', 'review'];
const STAGE_LABELS: Record<QuoteProcessingStage, string> = {
  request: 'YÃªu cáº§u bÃ¡o giÃ¡',
  technical: 'ThÃ´ng tin ká»¹ thuáº­t',
  pricing: 'HoÃ n thiá»‡n giÃ¡ bÃ¡n',
  review: 'Chá» duyá»‡t',
  // Khong hien nhu 1 step rieng tren stage bar (STAGE_ORDER van dung 4 buoc
  // theo dung HTML) - chi dung lam fallback text khi can, gia tri that hien
  // qua stageLabel() dua tren processingStage/status THAT (migration 087).
  ready_to_publish: 'ÄÃ£ duyá»‡t Â· ChÆ°a phÃ¡t hÃ nh',
  published: 'ÄÃ£ phÃ¡t hÃ nh',
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
  return `${label} â€” ${cleanQuota}`;
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
  if (value == null || !Number.isFinite(value)) return 'â€”';
  return `${value.toFixed(2)}%`;
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
      const label = component.customerDisplayName || (technicalPoolName.toLowerCase() === 'channel quota' ? 'KÃªnh káº¿t ná»‘i' : technicalPoolName) || component.name || 'KÃªnh káº¿t ná»‘i';
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
    const label = component.customerDisplayName || component.name || component.displayText || 'Háº¡ng má»¥c';
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
    label: `${row.customer_name || 'KhÃƒÂ¡ch hÃƒÂ ng chÃ†Â°a tÃƒÂªn'}${row.company_name ? ' Ã‚Â· ' + row.company_name : ''}`,
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
    label: `${row.customer_name || 'KhÃƒÂ¡ch hÃƒÂ ng chÃ†Â°a tÃƒÂªn'}${row.company_name ? ' Ã‚Â· ' + row.company_name : ''}`,
    name: row.customer_name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxCode: row.tax_code,
  };
}

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Táº¡o bÃ¡o giÃ¡',
  updated: 'Cáº­p nháº­t bÃ¡o giÃ¡',
  approved: 'Duyá»‡t bÃ¡o giÃ¡',
  cancelled: 'Huá»· bÃ¡o giÃ¡',
  version_created: 'Táº¡o phiÃªn báº£n má»›i',
  stage_changed: 'Chuyá»ƒn bÆ°á»›c xá»­ lÃ½',
  handoff_updated: 'Cáº­p nháº­t bÃ n giao ká»¹ thuáº­t',
  owner_assigned: 'GÃ¡n ngÆ°á»i phá»¥ trÃ¡ch',
  version_reason: 'Ghi lÃ½ do táº¡o phiÃªn báº£n',
  approved_with_exception: 'Ä‘Ã£ phÃª duyá»‡t ngoáº¡i lá»‡',
  auto_approved_by_rule_engine: 'Tá»± Ä‘á»™ng duyá»‡t bá»Ÿi Rule Engine',
};

/** Section 5 - hien cau tu nhien "<Ten> Ä‘Ã£ phÃª duyá»‡t ngoáº¡i lá»‡ cho V2 lÃºc â€¦"
 * cho rieng action nay (khac cach hien chung "<Ten> <nhan>" cua cac action
 * khac) - dung yeu cau audit doc duoc ngay, khong phai 1 dong nhan chung
 * chung. Tra ve PHAN SAU ten (giu nguyen pattern <strong>{ten}</strong>
 * {phan_sau} o noi goi). Fallback ve nhan chung neu thieu
 * changes.versionNumber (du lieu cu truoc migration 102). */
function activityLogTail(entry: QuoteActivityLogEntry): string {
  if (entry.action === 'approved_with_exception') {
    const versionNumber = (entry.changes as { versionNumber?: number } | null)?.versionNumber;
    const at = formatDate(entry.createdAt);
    return versionNumber ? `Ä‘Ã£ phÃª duyá»‡t ngoáº¡i lá»‡ cho V${versionNumber} lÃºc ${at}` : `Ä‘Ã£ phÃª duyá»‡t ngoáº¡i lá»‡ lÃºc ${at}`;
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
      <span className="qc-no-staff-text">ChÆ°a cÃ³ nhÃ¢n sá»± phÃ¹ há»£p.</span>
      {isAdminOrLeader ? (
        <Link href="/all-platform/admin/quan-ly-thanh-vien" className="qc-no-staff-cta">Äi tá»›i Quáº£n lÃ½ thÃ nh viÃªn</Link>
      ) : (
        <span className="qc-no-staff-cta qc-no-staff-cta--muted">Vui lÃ²ng liÃªn há»‡ Admin.</span>
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
 * da tu go san so La Ma vao dau ten (vd "I. Pháº§n má»m" go tu Excel/thoi quen
 * cu), trong khi UI moi LUON tu dong ghep them so La Ma tinh theo vi tri
 * (`toRomanNumeral(sectionCounter)`) truoc ten - ghep 2 cai lai thanh lap
 * ("I. I. Pháº§n má»m"). CHI strip dung so La Ma KHOP VOI vi tri hien tai cua
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
  { value: 'scope_change', label: 'KhÃ¡ch thay Ä‘á»•i scope' },
  { value: 'price_change', label: 'Äá»•i giÃ¡/chiáº¿t kháº¥u' },
  { value: 'add_items', label: 'Bá»• sung háº¡ng má»¥c' },
  { value: 'other', label: 'KhÃ¡c' },
];

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
  /** Block 1: mo tu nut "Táº¡o bÃ¡o giÃ¡" o Ho so khach hang/Project card - PHAI
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
  // Card "Chuáº©n bá»‹ gá»­i Presale" (stage 'request') - nut "Bá»• sung" nhay THAT
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
  const [draftDealId, setDraftDealId] = useState('');
  // "+ Táº¡o cÆ¡ há»™i má»›i" ngay trong dropdown - BUG THAT DA GAP (gap that su,
  // khong phai gia dinh): khach hang chua co CÆ¡ há»™i nao thi dropdown chi
  // hien "KhÃ´ng tÃ¬m tháº¥y", bat nguoi dung THOAT KHOI form dang dien de di
  // tao Co hoi o cho khac roi quay lai tu dau - mat het du lieu dang go
  // (Háº¡ng má»¥c/scope...). `deals`/`dealsById` la PROP tu component cha
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
  // "Táº¡o dá»± Ã¡n má»›i"/"Táº¡o cÆ¡ há»™i má»›i" nhanh ngay trong workspace - tÃ¡i dÃ¹ng
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
      setDealCreateError(err instanceof Error ? err.message : 'KhÃ´ng táº¡o Ä‘Æ°á»£c cÆ¡ há»™i.');
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
  // BUG THAT DA GAP ("báº¥m nÃ³ k hiá»‡n tick luÃ´n"): truoc day checkbox controlled
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
    const realItems = itemsDraft.filter(item => item.rowType !== 'section');
    if (!customerId) errors.customer = 'Vui lÃ²ng chá»n khÃ¡ch hÃ ng.';
    if (!selectedDealId) errors.deal = 'Vui lÃ²ng chá»n cÆ¡ há»™i CRM.';
    if (!formId) errors.form = 'Vui lÃ²ng chá»n máº«u bÃ¡o giÃ¡.';
    if (!technicalOwnerId) errors.presale = 'Vui lÃ²ng chá»n Presale.';
    if (!quoteOwnerId) errors.sale = 'Vui lÃ²ng chá»n Sale.';
    if (!slaDueAt || new Date(slaDueAt).getTime() <= Date.now()) errors.sla = 'Vui lÃ²ng chá»n háº¡n hoÃ n táº¥t trong tÆ°Æ¡ng lai.';
    if (realItems.length === 0) errors.items = 'Vui lÃ²ng thÃªm Ã­t nháº¥t má»™t háº¡ng má»¥c.';
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
  // "Táº¡o nhanh sáº£n pháº©m/nhÃ³m sáº£n pháº©m ngay trong popup chá»n tá»« danh má»¥c" +
  // "Nháº­n biáº¿t háº¡ng má»¥c Ä‘Ã£ cÃ³ trong Sáº£n pháº©m & dá»‹ch vá»¥" (2 yeu cau dung
  // CHUNG QuickAddProductModal - xem file rieng). `quickAddProductTarget`
  // phan biet 2 luong gá»i: 'newRow' (nut "+ Sáº£n pháº©m má»›i" trong popup Chá»n
  // tu danh muc - san pham tao xong THEM THANH 1 DONG MOI trong bao gia) vs
  // { linkIndex } (bam dau "+" canh 1 hang muc da co san trong bao gia -
  // san pham tao xong CHI GAN ID nguoc lai dong do, KHONG tao dong moi).
  const [quickAddProductTarget, setQuickAddProductTarget] = useState<'newRow' | { linkIndex: number; locked?: boolean } | null>(null);
  // BUG THAT DA GAP ("tá»± Ä‘á»™ng thÃªm tháº³ng vÃ o bÃ¡o giÃ¡ ngay sau khi lÆ°u sáº£n
  // pháº©m"): luong 'newRow' TRUOC DAY tu goi catalogAdd.handleAddSelected()
  // ngay sau khi tao xong - sai vi Sale co the tao nham hoac muon tao nhieu
  // san pham TRUOC KHI ap dung. Dung luong: chi luu id vua tao vao day, Picker
  // (van dang mo) se TU TICH CHON no (xem prop autoSelectId cua
  // CatalogPickerModal) - Sale tu kiem tra roi bam "+ ThÃªm vÃ o bÃ¡o giÃ¡" nhu
  // binh thuong, KHONG con dong nao tu dong them dong vao bao gia nua.
  const [autoSelectCatalogItemId, setAutoSelectCatalogItemId] = useState<string | null>(null);
  const [catalogHydratingItem, setCatalogHydratingItem] = useState<ServiceCatalogItem | null>(null);
  const [catalogHydrationRetryItem, setCatalogHydrationRetryItem] = useState<ServiceCatalogItem | null>(null);
  const [catalogHydrationError, setCatalogHydrationError] = useState<string | null>(null);
  const [quickAddGroupOpen, setQuickAddGroupOpen] = useState(false);
  const [pickerGroupFilter, setPickerGroupFilter] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTargetSectionId, setCatalogTargetSectionId] = useState('');
  // "+" rieng tren TUNG dong hang muc (yeu cau rieng "thao tÃ¡c thÃªm háº¡ng
  // má»¥c") - chen NGAY SAU dung dong do (khac voi catalogTargetSectionId chi
  // dam bao "cuoi 1 Muc cha"). Uu tien HON catalogTargetSectionId trong
  // addItemsFromCatalog() khi ca 2 cung duoc set - xem ham do.
  const [catalogInsertAfterIndex, setCatalogInsertAfterIndex] = useState<number | null>(null);
  // "Batch" cac hang muc vua chon nhieu tu Danh muc cung 1 luc (yeu cau rieng
  // "Ä‘Ã¡nh dáº¥u lÃ  má»™t batch vÃ  giá»¯ tráº¡ng thÃ¡i Ä‘Æ°á»£c chá»n... nháº­p GiÃ¡ vá»‘n á»Ÿ
  // dÃ²ng Ä‘áº§u tiÃªn -> auto fill cÃ¹ng GiÃ¡ vá»‘n cho cáº£ batch") - chi la trang
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
  // dung dong (X/"ÄÃ³ng") ma KHONG bam "LÆ°u" (bug that da gap: sua nham gia
  // tri roi bam X, blur cua input tu dong fire TRUOC khi modal dong, khien
  // persistQuote() im lang chay va luu nham gia tri sai - gio inputs trong
  // drawer nay KHONG con tu luu qua onBlur nua, chi luu that khi bam "LÆ°u"
  // ro rang; dong khong luu se phuc hoi lai dung snapshot nay).
  const [itemDetailDrawerSnapshot, setItemDetailDrawerSnapshot] = useState<QuoteItem | null>(null);
  const [costOverrideModal, setCostOverrideModal] = useState<{ index: number; reason: string; value: number | null } | null>(null);
  // "Chá»‰nh MÃ´ táº£ háº¡ng má»¥c" (popover rieng, KHONG them cot vao bang) - luu
  // vao DUNG field quote_item.description da co san (KHONG dung ten field
  // moi "featuresIncluded"/tao field DB moi). readOnly khi quote da khoa/
  // khong con quyen sua (Buoc 3/da duyet) - van xem duoc, chi khong sua.
  const [descriptionPopoverIndex, setDescriptionPopoverIndex] = useState<number | null>(null);
  const [descriptionDraftText, setDescriptionDraftText] = useState('');
  const [warrantyDraftText, setWarrantyDraftText] = useState('');
  function openDescriptionPopover(index: number) {
    setDescriptionPopoverIndex(index);
    setDescriptionDraftText(itemsDraft[index]?.description || '');
    setWarrantyDraftText(itemsDraft[index]?.warrantyScope || '');
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
    const next = itemsDraft.map((row, i) => (i === idx ? { ...row, description: descriptionDraftText, warrantyScope: warrantyDraftText.trim() || null } : row));
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
    setDescriptionPopoverIndex(null);
  }
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
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

  // â”€â”€ Rule engine duyet bao gia (migration 091) - CHI CON HIEN THI o day (xem
  // card "Quy táº¯c phÃª duyá»‡t" ben duoi); sua that chuyen sang trang rieng
  // "CÃ i Ä‘áº·t bÃ¡o giÃ¡" (components/all-platform/admin/QuoteApprovalRuleSettings.tsx,
  // menu Quan ly CRM) - khong con modal sua ngay trong workspace nay nua. â”€â”€
  const [ruleSet, setRuleSet] = useState<QuoteApprovalRuleSet | null>(null);
  const [ruleSetLoaded, setRuleSetLoaded] = useState(false);
  const [ruleEvaluation, setRuleEvaluation] = useState<QuoteRuleEvaluation | null>(null);

  // â”€â”€ Owner-picker Presale/Sale (migration 095) - THAY the "agents" cu (chi
  // admin/leader, dung cho gan SDR/quan ly Deal CRM, KHONG dung cho owner
  // bao gia) bang 2 danh sach rieng loc theo quote_business_role that. â”€â”€â”€â”€
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
    return parts.join(' Â· ');
  }
  // Ten hien thi cho 1 owner id DA GAN - phai tim ca trong danh sach
  // presale/sale (khong chi "agents" cu) de nguoi da gan truoc do (vd tung
  // la Presale nhung Admin vua bo gan business role) van hien dung TEN, KHONG
  // hien "KhÃ´ng rÃµ"/"undefined".
  const businessRoleUsersById = useMemo(() => {
    const map = new Map<string, QuoteBusinessRoleUser>();
    for (const u of presaleUsers || []) map.set(u.id, u);
    for (const u of saleUsers || []) map.set(u.id, u);
    return map;
  }, [presaleUsers, saleUsers]);
  function ownerNameFor(id?: string | null): string {
    if (!id) return 'ChÆ°a gÃ¡n';
    if (id === user?.id && user?.name) return repairUtf8Mojibake(user.name);
    const found = businessRoleUsersById.get(id);
    if (found) return ownerOptionLabel(found);
    const agentName = agentsById.get(id);
    return agentName ? repairUtf8Mojibake(agentName) : 'KhÃ´ng rÃµ (Ä‘Ã£ bá» vai trÃ² bÃ¡o giÃ¡)';
  }
  // `action` tuy chon - yeu cau rieng "cho + sp vÃ  dv á»Ÿ Ä‘Ã¢u luÃ´n bro náº¿u
  // quÃªn sao": toast bao "BÃ¡o giÃ¡ Ä‘Ã£ khoÃ¡..." truoc day CHI la text, nguoi
  // dung phai tu nho di bam "Táº¡o phiÃªn báº£n má»›i" o dau khac - gio toast co
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
    draftSave: 'Äang lÆ°uâ€¦',
    handoff: 'Äang lÆ°u vÃ  bÃ n giaoâ€¦',
    reviewPricing: 'Äang gá»­i duyá»‡tâ€¦',
    requestChanges: 'Äang gá»­i yÃªu cáº§uâ€¦',
    approve: 'Äang duyá»‡tâ€¦',
    publish: 'Äang phÃ¡t hÃ nhâ€¦',
    send: 'Äang gá»­iâ€¦',
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
    gross_margin_percent: { label: 'Gross margin tá»‘i thiá»ƒu', description: 'Margin = (GiÃ¡ sau CK âˆ’ Cost) / GiÃ¡ sau CK.', unit: '%' },
    gross_profit_amount: { label: 'Lá»£i nhuáº­n gá»™p tá»‘i thiá»ƒu', description: 'GiÃ¡ bÃ¡n sau chiáº¿t kháº¥u pháº£i táº¡o Ä‘á»§ gross profit.', unit: 'Ä‘' },
    discount_percent: { label: 'Chiáº¿t kháº¥u thÆ°Æ¡ng máº¡i tá»‘i Ä‘a', description: 'VÆ°á»£t ngÆ°á»¡ng pháº£i chuyá»ƒn ngÆ°á»i cÃ³ quyá»n duyá»‡t.', unit: '%' },
    payment_terms_days: { label: 'Thá»i háº¡n thanh toÃ¡n tá»‘i Ä‘a', description: 'Äiá»u khoáº£n dÃ i hÆ¡n ngÆ°á»¡ng Ä‘Æ°á»£c xem lÃ  ngoáº¡i lá»‡.', unit: 'ngÃ y' },
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
    const nextItems = quote?.items ? sanitizeDraftQuoteItems(flattenItemTree(quote.items)) : [];
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
      if (!cancelled) setSendAvailability({ available: false, reason: 'KhÃ´ng kiá»ƒm tra Ä‘Æ°á»£c kÃªnh gá»­i email.' });
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
      window.alert('Chiáº¿t kháº¥u pháº£i lÃ  má»™t sá»‘ tá»« 0% Ä‘áº¿n 100%.');
      return;
    }
    const discountPercent = clampDiscountPercent(rawValue);
    if (scope === 'selected' && selectedDiscountCount === 0) {
      window.alert('Chá»n Ã­t nháº¥t má»™t háº¡ng má»¥c Ä‘á»ƒ Ã¡p chiáº¿t kháº¥u.');
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
    showToast(true, scope === 'all' ? 'ÄÃ£ Ã¡p chiáº¿t kháº¥u cho táº¥t cáº£ háº¡ng má»¥c.' : `ÄÃ£ Ã¡p chiáº¿t kháº¥u cho ${selectedDiscountCount} háº¡ng má»¥c.`);
  }

  function removeSelectedItemRows() {
    if (selectedDiscountCount === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`XÃ³a ${selectedDiscountCount} háº¡ng má»¥c Ä‘Ã£ chá»n?`)) return;
    const selected = new Set(selectedDiscountRowKeys);
    const nextItems = itemsDraft.filter((row, index) => row.rowType === 'section' || !selected.has(discountRowKey(row, index)));
    setItemsDraft(nextItems);
    setSelectedDiscountRowKeys(new Set());
    if (quote) void persistQuote({ items: nextItems }, { silent: true });
    showToast(true, `ÄÃ£ xÃ³a ${selectedDiscountCount} háº¡ng má»¥c.`);
  }

  // Ca 3 handler duoi day PHAI khong bao gio tao ra NaN/Infinity du nguoi
  // dung nhap ky tu la, so am hay de trong - dung Number.isFinite() thay vi
  // `Number(raw) || 0` (KHONG du: NaN||0 tinh cá» ve 0 dung, nhung Math.max(0,
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

  // CHOT LAI LAN 2 ("Bá» tá»± Ä‘á»™ng lan GiÃ¡ vá»‘n tá»« dÃ²ng Ä‘áº§u"): TRUOC day nhap
  // Gia von o dong DAU TIEN cua 1 batch vua them se tu dong lan sang cac
  // dong con lai (dung 1 lan). Yeu cau ro rang lan nay: BO HOAN TOAN hanh vi
  // tu dong lan, KE CA lan nhap dau tien - sua/nhap Gia von o BAT KY dong
  // nao CHI doi dung dong do, khong bao gio tu dong anh huong dong khac.
  // Muon dien nhieu dong PHAI chu dong bam icon "Äiá»n xuá»‘ng" (xem
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
      window.alert('Markup pháº£i tá»« -100% trá»Ÿ lÃªn.');
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
    const label = child.serviceDescription || 'thÃ nh pháº§n';
    if (typeof window !== 'undefined' && !window.confirm(`Bá» ${label} khá»i gÃ³i Combo nÃ y?`)) return;
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
  // "Sau khi Ã¡p dá»¥ng pháº£i cÃ³ toast thÃ´ng bÃ¡o vÃ  Undo" - snapshot TOAN BO
  // itemsDraft truoc khi ap dung fill-down, cho phep hoan tac dung 1 lan gan
  // nhat (khong phai stack nhieu buoc). Doc lap hoan toan voi co che autofill
  // tu dong da BI BO o tren - day CHI kich hoat khi nguoi dung CHU DONG bam
  // "Äiá»n xuá»‘ng", khong bao gio tu chay.
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

  // "Chá»‰ Ä‘iá»n cÃ¡c dÃ²ng Ä‘ang trá»‘ng" - subset cua fillDownTargets() ma field
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
    const fieldLabel = field === 'costPrice' ? 'GiÃ¡ vá»‘n' : 'Markup';
    const scopeLabel = mode === 'empty' ? 'Ä‘ang trá»‘ng' : 'Ä‘Ã£ chá»n';
    const message = `ÄÃ£ Ä‘iá»n ${fieldLabel} xuá»‘ng ${targetIndices.length} dÃ²ng ${scopeLabel}.`;
    setFillDownUndo({ items: undoSnapshot, message });
    showToast(true, message);
  }

  function undoFillDown() {
    if (!fillDownUndo) return;
    setItemsDraft(fillDownUndo.items);
    if (quote) void persistQuote({ items: fillDownUndo.items }, { silent: true });
    setFillDownUndo(null);
  }

  // Vao dung 1 trong 2 che do nguoi dung chon o popover cua icon "Äiá»n
  // xuá»‘ng" (xem renderFillDownIcon) - "empty" khong bao gio ghi de (bo qua
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

  /** Icon nho "Äiá»n xuá»‘ng" (yeu cau rieng: khong hien chu, dung icon +
   * tooltip/aria-label) - bam mo popover (ActionMenu) cho chon 1 trong 2
   * pham vi RO RANG ("Chá»‰ Ä‘iá»n cÃ¡c dÃ²ng Ä‘ang trá»‘ng" / "Äiá»n toÃ n bá»™ cÃ¡c
   * dÃ²ng") thay vi chay thang 1 hanh dong duy nhat nhu ban truoc - dung yeu
   * cau moi "pháº£i hiá»ƒn thá»‹ pháº¡m vi vÃ  sá»‘ dÃ²ng sáº½ bá»‹ áº£nh hÆ°á»Ÿng" (hien so
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
    const fieldLabel = field === 'costPrice' ? 'GiÃ¡ vá»‘n' : 'Markup';
    const label = `Äiá»n ${fieldLabel} xuá»‘ng`;
    return (
      <ActionMenu
        label={label}
        icon={ArrowDownToLine}
        triggerClassName="qc-fill-down-icon-btn"
        iconClassName="qc-inline-icon"
        items={[
          {
            key: 'empty',
            label: `Chá»‰ Ä‘iá»n cÃ¡c dÃ²ng Ä‘ang trá»‘ng (${emptyTargets.length})`,
            disabled: emptyTargets.length === 0,
            title: emptyTargets.length === 0 ? 'KhÃ´ng cÃ²n dÃ²ng nÃ o Ä‘ang trá»‘ng trong pháº¡m vi nÃ y' : undefined,
            onSelect: () => fillDownWithMode(index, field, 'empty'),
          },
          {
            key: 'all',
            label: `Äiá»n toÃ n bá»™ (${allTargets.length} dÃ²ng)`,
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
      // hang muc them tu "Báº£ng giÃ¡ VPS Zone" (priceBookItemToQuoteItem())
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
    if (opts?.silent) return;
    // BUG THAT DA GAP ("sua nham 1 o roi bam X dong luon van bi luu"): moi o
    // sua trong bang hang muc (Markup/Gia von/Gia khach/Mo ta/SL...) deu
    // auto-save NGAM qua onBlur - khi bam nut Dong (X)/Huy/"â† Danh sÃ¡ch", trinh
    // duyet BLUR o dang go TRUOC KHI chay onClick cua nut do, nen gia tri vua
    // go (co the go NHAM) van bi luu xuong DB truoc khi modal kip dong, du
    // nguoi dung chua he bam nut "LÆ°u thay Ä‘á»•i" chinh. Cac nut dong/huy nay
    // gio deu co onMouseDown={markClosingIntent} (mousedown chay TRUOC blur)
    // de bao truoc "sap dong, dung luu autosave nua" - CHI chan cuoc goi
    // SILENT (autosave ngam), KHONG anh huong nut "LÆ°u thay Ä‘á»•i" chinh (luon
    // goi khong co silent, van luu binh thuong khi nguoi dung chu dong bam).
    if (opts?.silent && skipNextAutoSaveRef.current) return;
    // silent=true: dung cho auto-save NGAM khi go/blur tung o (mo ta/SL/gia
    // von/markup...) - KHONG dung chung co `busy`/`activeAction` voi cac nut
    // hanh dong chinh (BÃ n giao/Gá»­i duyá»‡t...) nua. BUG THAT DA GAP: truoc day
    // MOI auto-save nay deu bat `busy=true`, khien nut "BÃ n giao" bi disable
    // (khong the bam) DUNG NGAY luc nguoi dung vua nhap xong hang muc roi bam
    // lien tay - lan bam dau tien bi "nuot mat" (nut dang disable, trinh
    // duyet khong phat click), phai bam LAN 2 (luc auto-save da xong,
    // busy=false) moi thanh cong - nhin nhu phai bam 2 lan BÃ n giao moi qua
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng lÆ°u Ä‘Æ°á»£c thay Ä‘á»•i.');
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
      { description: '', quantity: 1, unitPrice: 0, vatRate: 10, discountPercent: 0, costPrice: null, markupPercent: null },
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
      { id: newBlockId(), rowType: 'section', description: 'Má»¥c má»›i', quantity: 0, unitPrice: 0, vatRate: 0, discountPercent: 0 },
    ]);
  }

  // "+" tren TUNG dong hang muc (yeu cau rieng "thao tÃ¡c thÃªm háº¡ng má»¥c" -
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
      // dung yeu cau "náº¿u dÃ²ng khÃ´ng thuá»™c Má»¥c cha â†’ chÃ¨n ngay sau dÃ²ng Ä‘Ã³
      // á»Ÿ cáº¥p ngoÃ i").
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
        next = [...next, ...items];
      }
    } else {
      next = [...next, ...items];
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
      // "Markup/GiÃ¡ khÃ¡ch chá»‰ Ä‘Æ°á»£c nháº­p á»Ÿ BÆ°á»›c 3" du costPrice hoan toan hop
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
    // BUG THAT DA GAP ("SAO ÄANG Táº O CÃI Má»šI MÃ€ BÃŠN VPS ZONE K HIá»‚N DANH Má»¤C
    // TA"): truoc day chan han khi !quote?.id (dang tao moi, chua co quote
    // that) - khien tab "Báº£ng giÃ¡ VPS Zone" luon 0 san pham trong luc tao
    // moi, khac voi "Danh má»¥c ná»™i bá»™" van xem binh thuong. quote_id gio la
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

  // `target` tuy chon (yeu cau rieng "thao tÃ¡c thÃªm háº¡ng má»¥c" - bam "+" tai
  // 1 Muc cha hoac tai 1 dong hang muc, khong chi qua nut "Chá»n tá»« danh má»¥c"
  // chung o cuoi bang nhu truoc): { sectionId } = luon them vao CUOI dung
  // Muc cha do; { afterIndex } = chen NGAY SAU dung dong o vi tri do (dong
  // do co the thuoc 1 Muc cha hay khong, addItemsFromCatalog() tu suy
  // parentItemId tu chinh dong nguon). Khong truyen gi = giu nguyen hanh vi
  // cu (them vao cuoi bang, nguoi dung tu chon Muc cha dich qua dropdown
  // extraToolbar neu muon).
  const draftCatalogIssuerCompanyId =
    quote?.issuerCompanyId ?? quoteForms.find(form => form.id === (draftFormId || defaultFormId))?.issuerCompanyId ?? null;

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
  // QuickAddProductModal, khong can mo ca popup Chá»n tá»« danh má»¥c truoc. Phai
  // tu dam bao catalogTree da tai (dau "+" nay co the la LAN DAU nguoi dung
  // cham toi danh muc trong phien lam viec nay, khac voi luong tu popup Chá»n
  // tá»« danh má»¥c von da goi openCatalogPicker() truoc do).
  function openQuickAddForRow(index: number, locked?: boolean) {
    setQuickAddProductTarget({ linkIndex: index, locked });
    if (!catalogTree || catalogTreeQuoteId !== (quote?.id ?? null)) void refreshCatalogTree();
  }

  const catalogFlatItems = useMemo(() => (catalogTree ? flattenCatalogTree(catalogTree) : []), [catalogTree]);
  const catalogSectionOptions = useMemo(
    () => itemsDraft.filter(row => row.rowType === 'section' && row.id).map(row => ({ id: row.id as string, label: row.description || 'Má»¥c cha' })),
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
  // (context='quote_picker' + quote?.id) de san pham/nhom vua tao "xuáº¥t hiá»‡n
  // ngay trong danh sÃ¡ch" voi DAY DU gia von/markup (khong phai ban rong).
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

  // "+ NhÃ³m sáº£n pháº©m" - nhom tao xong: lam moi cay + tu dong loc sang dung
  // nhom vua tao (rong, chua co san pham nao) de Sale "chuyá»ƒn sang nhÃ³m vá»«a
  // táº¡o vÃ  thÃªm sáº£n pháº©m ngay" nhu yeu cau, khong bat thoat popup.
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
    showToast(true, `ÄÃ£ táº¡o nhÃ³m "${created.name}".`);
  }

  // "+ Sáº£n pháº©m má»›i" (tu popup, them thanh DONG MOI) HOAC dau "+" canh 1
  // hang muc co san (chi GAN ID nguoc lai dong do, khong tao dong moi) - xem
  // giai thich quickAddProductTarget o khai bao state.
  async function hydrateQuickCreatedProduct(created: ServiceCatalogItem) {
    setCatalogHydratingItem(created);
    setCatalogHydrationRetryItem(null);
    setCatalogHydrationError(null);
    const tree = await refreshCatalogTree();
    if (!tree) {
      setCatalogHydrationError(`KhÃ´ng táº£i láº¡i Ä‘Æ°á»£c giÃ¡ cá»§a â€œ${created.name}â€.`);
      setCatalogHydrationRetryItem(created);
      setCatalogHydratingItem(null);
      setQuickAddProductTarget(null);
      return null;
    }
    const fetched = flattenCatalogTree(tree).find(item => item.id === created.id);
    if (!fetched) {
      setCatalogHydrationError(`KhÃ´ng tÃ¬m tháº¥y â€œ${created.name}â€ sau khi táº¡o.`);
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
        // "k cáº§n táº¡o phiÃªn báº£n má»›i bro" - quote/version da khoa: VAN cho tao
        // san pham vao "Sáº£n pháº©m & dá»‹ch vá»¥" binh thuong (khong con bat qua
        // luong "Táº¡o phiÃªn báº£n má»›i" nua), nhung KHONG ghi catalogItemId
        // nguoc lai dong hang muc cua version da khoa (giu nguyen bat bien
        // du lieu quote da duyet - dung tinh than yeu cau truoc do "cÃ³ thá»ƒ
        // cho táº¡o vÃ o Sáº£n pháº©m & dá»‹ch vá»¥, nhÆ°ng khÃ´ng Ä‘Æ°á»£c ghi ngÆ°á»£c ID vÃ o
        // version Ä‘Ã£ khÃ³a").
        showToast(true, `ÄÃ£ táº¡o "${created.name}" vÃ o Sáº£n pháº©m & dá»‹ch vá»¥. BÃ¡o giÃ¡ Ä‘Ã£ khoÃ¡ nÃªn chÆ°a liÃªn káº¿t vÃ o háº¡ng má»¥c nÃ y.`);
        setQuickAddProductTarget(null);
        return;
      }
      setItemsDraft(prev => {
        const next = prev.map((row, i) => (i === linkIndex ? { ...row, catalogItemId: hydrated.id } : row));
        if (quote) void persistQuote({ items: next }, { silent: true });
        return next;
      });
      showToast(true, `ÄÃ£ thÃªm "${created.name}" vÃ o Sáº£n pháº©m & dá»‹ch vá»¥ vÃ  liÃªn káº¿t vá»›i háº¡ng má»¥c nÃ y.`);
    } else {
      // 'newRow' - CHI tao san pham + tu tich chon trong Picker (van dang
      // mo), KHONG tu dong them vao bao gia (xem giai thich o khai bao
      // autoSelectCatalogItemId) - Sale tu bam "+ ThÃªm vÃ o bÃ¡o giÃ¡" khi da
      // san sang.
      setAutoSelectCatalogItemId(hydrated.id);
      showToast(true, `ÄÃ£ táº¡o "${created.name}" vÃ  tá»± chá»n trong danh sÃ¡ch â€” báº¥m "+ ThÃªm vÃ o bÃ¡o giÃ¡" khi sáºµn sÃ ng.`);
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
  // Margin má»¥c tiÃªu (KHOI PHUC - yeu cau rieng): suy nguoc gia khach tu
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
      window.alert('Markup pháº£i tá»« -100% trá»Ÿ lÃªn.');
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
      window.alert('Margin pháº£i trong khoáº£ng 0% Ä‘áº¿n dÆ°á»›i 100%.');
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

  // CK tong (yeu cau rieng): TRUOC DAY co 1 o "CK tá»•ng" trong quickbar tu
  // set `discountPercent` cho TUNG DONG (ap dung o buoc Thanh tien = subtotal
  // - subtotal*discountPercent/100 - xem lineSubtotal ben duoi) - BUG vi CK
  // tong lai am tham thay doi so lieu tung dong, trai voi yeu cau "CK tá»•ng
  // chá»‰ giáº£m trÃªn tá»•ng tiá»n cuá»‘i bÃ¡o giÃ¡, khÃ´ng Ä‘á»•i Markup/GiÃ¡ khÃ¡ch/ÄV tá»«ng
  // dÃ²ng". Quote DA CO SAN dung 1 co che nay roi: cot `overall_discount_percent`
  // tren quotes (KHONG dung tren tung quote_items) - chi tru thang vao
  // `totalAmount` sau cung (xem "GiÃ¡ sau giáº£m" o khoi Loi nhuan ben duoi, cung
  // dÃ¹ng chÃ­nh field nay) - XOA hang "CK tá»•ng" cu (tung set discountPercent
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
      title: 'Äiá»u khoáº£n thanh toÃ¡n',
      content: `Thanh toÃ¡n trong ${days} ngÃ y ká»ƒ tá»« ngÃ y duyá»‡t bÃ¡o giÃ¡.`,
    };
    if (idx >= 0) blocks[idx] = newBlock;
    else blocks.push(newBlock);
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
  }

  // Popup nho canh nut "+ Äiá»u khoáº£n" (thay window.prompt() cu) - o nhap
  // ngay ke ben, khong con hop thoai native cua trinh duyet.
  const [termNotePopoverOpen, setTermNotePopoverOpen] = useState(false);
  const [termNoteInput, setTermNoteInput] = useState('');

  function submitTermNote() {
    const text = termNoteInput.trim();
    if (!text) return;
    if (!quote) {
      setDraftExtraTerms(prev => [...prev, { id: newBlockId(), title: 'Äiá»u khoáº£n', content: text }]);
    } else {
      const blocks = [...(quote.data?.customBlocks || []), { id: newBlockId(), kind: 'custom_field' as const, title: 'Äiá»u khoáº£n', content: text }];
      void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
    }
    setTermNoteInput('');
    setTermNotePopoverOpen(false);
  }

  // Danh sach dieu khoan bo sung da them (nut "+ Äiá»u khoáº£n") - hien NGAY
  // duoi quickbar kem Sá»­a/XÃ³a, ca 2 che do: che do tao moi doc draftExtraTerms
  // (chua ghi DB that), quote da ton tai doc thang tu quote.data.customBlocks
  // (kind='custom_field' - KHONG lay payment_terms/scope_of_work, 2 kind do
  // co UI rieng o cho khac).
  const extraTermsList = quote
    ? (quote.data?.customBlocks || []).filter(b => b.kind === 'custom_field').map(b => ({ id: b.id, title: b.title, content: b.content }))
    : draftExtraTerms;

  function editTermNote(id: string) {
    const current = extraTermsList.find(t => t.id === id);
    if (!current) return;
    const text = window.prompt('Sá»­a Ä‘iá»u khoáº£n:', current.content);
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
  // BUG THAT DA GAP ("card YÃªu cáº§u & pháº¡m vi Ä‘Ã³ng sáºµn khÃ´ng má»Ÿ Ä‘Æ°á»£c"): truoc
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
  // con phan biet co/khong co du lieu nua) - "cáº§n thÃ¬ má»›i má»Ÿ", tu bam mo khi
  // muon xem/sua lai.
  const [scopeCardOpen, setScopeCardOpen] = useState(false);
  // Card "BÃ n giao ká»¹ thuáº­t" - CHOT LAI LAN 3 (yeu cau ro rang "Khá»‘i nÃ y máº·c
  // Ä‘á»‹nh Ä‘Ã³ng khi má»Ÿ popup yÃªu cáº§u bÃ¡o giÃ¡... BÃ n giao ká»¹ thuáº­t chá»‰ lÃ  tÃ­nh
  // nÄƒng há»— trá»£, khÃ´ng pháº£i Ä‘iá»u kiá»‡n báº¯t buá»™c"): mac dinh DONG (dao nguoc
  // lai quyet dinh truoc do). Checklist trong card nay KHONG con dung de
  // chan Luu/Chuyen buoc/Ban giao/Duyet nua; card chi con la tinh nang ho tro.
  const [handoffCardOpen, setHandoffCardOpen] = useState(false);
  // "Káº¿ hoáº¡ch thanh toÃ¡n" - KHAC voi scope/handoff o tren (luon mac dinh
  // dong): card nay lien quan truc tiep den tien nen phai TU MO khi con
  // thieu/sai de Sale khong bo qua (yeu cau rieng) - dong bo lai theo dung
  // paymentPlan CUA QUOTE trong effect [quote?.id] ben duoi (cung ly do
  // "QuoteCenterPage khong unmount modal" nhu scopeCardOpen/handoffCardOpen).
  const [paymentPlanCardOpen, setPaymentPlanCardOpen] = useState(false);
  // Card "Háº¡ng má»¥c & giÃ¡ khÃ¡ch" o ban tom tat quote da khoa (review/
  // approved/published) - yeu cau rieng "cho thu gon" - mac dinh dong,
  // giong "YÃªu cáº§u & pháº¡m vi".
  const [summaryItemsCardOpen, setSummaryItemsCardOpen] = useState(false);
  const [editExpectedProducts, setEditExpectedProducts] = useState('');
  // "Giá»›i háº¡n xem link bÃ¡o giÃ¡ báº±ng Email hoáº·c Sá»‘ Ä‘iá»‡n thoáº¡i" (migration 118,
  // thay the checkbox+email don le cu) - state cuc bo cho khoi sua trong card
  // "ThÃ´ng tin phÃ¡t hÃ nh", dong bo lai TU quote moi lan doi quote?.id (cung
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
    // BUG THAT DA GAP ("BÃ n giao ká»¹ thuáº­t khÃ´ng máº·c Ä‘á»‹nh Ä‘Ã³ng"): QuoteCenterPage
    // KHONG unmount QuoteWorkspaceModal giua 2 lan mo bao gia khac nhau (chi
    // doi prop quoteId) - component INSTANCE dung lai nguyen, nen state cuc
    // bo handoffCardOpen tung mo o bao gia A se "ro ri" sang bao gia B ke
    // tiep neu khong tu reset khi doi quote. Reset lai o DUNG effect nay
    // (chay moi lan quote?.id doi that su).
    setHandoffCardOpen(false);
    setSummaryItemsCardOpen(false);
    const currentPaymentPlan = quote?.data.paymentPlan || draftPaymentPlan;
    setPaymentPlanCardOpen(currentPaymentPlan.length === 0 || paymentPlanPercent(currentPaymentPlan) !== 100);
    setAccessMode(quote?.publicAccessMode || 'none');
    setAccessEmailsText((quote?.publicAllowedEmails || []).join('\n'));
    setAccessPhonesText((quote?.publicAllowedPhones || []).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  async function saveAccessRestriction() {
    if (!quote) return;
    const emails = accessEmailsText.split(/[\n,;]/).map(e => e.trim()).filter(Boolean);
    const phones = accessPhonesText.split(/[\n,;]/).map(p => p.trim()).filter(Boolean);
    setAccessSaving(true);
    try {
      // BUG THAT DA GAP ("táº¯t giá»›i háº¡n nhÆ°ng váº«n yÃªu cáº§u Email"): fix o day la
      // CHI gui dung 1 `mode` duy nhat (enum) - khong con gui song song 1
      // boolean rieng nen KHONG the xay ra truong hop "tat qua duong nay
      // nhung code khac van doc co cu". Khi mode==='none', backend tu bo qua
      // moi kiem tra Email/SDT (xem get_public_quote()) - khach mo tab an
      // danh la xem duoc ngay, khong con man hinh xac minh nao ca.
      const updated = await seedingQuoteRepository.setPublicAccessRestriction(quote.id, accessMode, emails, phones);
      setQuote(updated);
      showToast(true, 'ÄÃ£ lÆ°u cáº¥u hÃ¬nh giá»›i háº¡n xem link.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng lÆ°u Ä‘Æ°á»£c cáº¥u hÃ¬nh giá»›i háº¡n xem link.');
    } finally {
      setAccessSaving(false);
    }
  }

  async function saveScopeSummary() {
    if (!quote) return;
    const blocks = [...(quote.data?.customBlocks || [])];
    const idx = blocks.findIndex(b => b.kind === 'scope_of_work');
    if (editScope.trim()) {
      const newBlock = { id: idx >= 0 ? blocks[idx].id : newBlockId(), kind: 'scope_of_work' as const, title: 'MÃ´ táº£ scope / yÃªu cáº§u cáº§n estimate', content: editScope.trim() };
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
    if (!id) return 'ChÆ°a gÃ¡n';
    if (id === user?.id && user?.name) return repairUtf8Mojibake(user.name);
    const roleUser = businessRoleUsersById.get(id);
    if (roleUser) return ownerOptionLabel(roleUser);
    const agentName = agentsById.get(id);
    return agentName ? repairUtf8Mojibake(agentName) : 'KhÃ´ng rÃµ';
  }

  async function load(id: string, opts?: { silent?: boolean }) {
    // "silent" - dung cho reload() sau 1 thao tac nho (gan nguoi phu trach,
    // sua 1 field...) - KHONG duoc bat lai "loading" toan man hinh (truoc day
    // luon bat, khien ca form bi thay bang "Äang táº£i bÃ¡o giÃ¡..." roi hien lai
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng táº£i Ä‘Æ°á»£c bÃ¡o giÃ¡.');
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
            label: `${row.customer_name || 'KhÃ¡ch hÃ ng chÆ°a tÃªn'}${row.company_name ? ' Â· ' + row.company_name : ''}`,
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
  // 2 che do gioi han o card "ThÃ´ng tin phÃ¡t hÃ nh" ma chua nhap gi ca, KHONG
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

  const status = quote ? quoteDisplayStatus(quote, deal) : { key: 'draft' as const, label: 'YÃªu cáº§u má»›i', className: 'qc-badge-amber' };
  const canEdit = quote ? canWriteDeal(user, deal) || canApproveQuote(user) : true;
  const canApprove = canApproveQuote(user);
  // Admin/leader (dung cho cac cho KHONG lien quan quy tac phe duyet, vd
  // NoStaffConfigured Presale/Sale ben duoi - tach rieng khoi
  // canManageApprovalRules de doi rieng gia tri kia khong lam sai cho nay).
  const isAdminOrLeader = user?.role === 'admin' || user?.role === 'leader';
  // Mirror can_manage_quote_approval_rules() o backend (SUA LAI: chi Admin,
  // khong con Leader) - CHI dung de hien goi y trong card "Quy táº¯c phÃª
  // duyá»‡t", sua that da chuyen het sang trang "CÃ i Ä‘áº·t bÃ¡o giÃ¡" rieng.
  const canManageApprovalRules = user?.role === 'admin';
  const businessCode = deal ? dealBusinessCode(deal) : null;
  const opportunityName = deal ? getServicePackageText(deal.servicePackage) || getPackageText(deal.package) : '';
  const stage = quote?.processingStage || 'request';
  // "Loai bao gia" (yeu cau rieng): sua duoc o Buoc 1 (request/technical, da
  // gop UI thanh "BÃ n giao") + Buoc 2 (pricing) - CHI KHOA khi sang Buoc 3
  // "Chá» duyá»‡t" (review); tra ve Buoc 1/2 thi sua lai duoc. Dung quyen chinh
  // bao gia CHUNG (canEdit) - KHONG phu thuoc canEditCostCells/
  // canEditPricingCells (2 quyen do rieng cho Gia von/Gia ban, khac pham vi).
  const canEditQuoteType = canEdit && stage !== 'review';
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
  // cho toi khi tu chuyen qua nut "Gá»­i yÃªu cáº§u xá»­ lÃ½" (duong lui cu, xem
  // footer) - tranh mo khoa nham cho du lieu cu chua qua luong moi.
  // Bao gia VERSION MOI (V2, V3...) la BAN SAO cua 1 bao gia DA DUYET - da co
  // san Gia von/Markup/Gia khach day du tu ban nguon ngay luc tao (khong phai
  // rong nhu bao gia tao moi tu dau) - yeu cau nguoi dung xac nhan ro (khong
  // doan): cho sua gia NGAY o Buoc 1 khi tao V2, KHONG bat di lai tu dau
  // luong "BÃ n giao ká»¹ thuáº­t -> HoÃ n thiá»‡n giÃ¡ bÃ¡n" nhu bao gia tao moi hoan
  // toan. Chi ap dung cho quote CO version_number > 1 (that su la 1 phien
  // ban tiep theo trong chuoi) - quote V1/tao moi van giu dung khoa theo
  // stage nhu cu, tranh sua gia non khi chua qua xac nhan ky thuat.
  const isVersionedQuote = (quote?.versionNumber || 1) > 1;
  const costStageOk = true;
  const pricingStageOk = stage === 'pricing' || isVersionedQuote;
  const canEditCostCells = canEdit && isDraft && !isLockedForReview && canEditQuoteCost(user, quote) && costStageOk;
  const canEditPricingCells = canEdit && isDraft && !isLockedForReview && canEditQuotePricingFields(user, quote) && pricingStageOk;
  // BUG THAT DA GAP: zonePickerItems truoc day khai bao O TREN (gan
  // catalogPickerItems, ~dong 1248) - nhung lai doc canEditCostCells (khai
  // bao O DUOI, dong nay) ngay trong THAN useMemo, chay NGAY LUC RENDER nen
  // bi crash "Cannot access 'canEditCostCells' before initialization" (Runtime
  // ReferenceError, phat hien khi mo tab "Báº£ng giÃ¡ VPS Zone" trong Catalog
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
          groupName: item.sourceSheet?.startsWith('1.') ? 'Má»¥c I' : item.sourceSheet?.startsWith('2.') ? 'Má»¥c II' : undefined,
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
  // "ChÆ°a cÃ³/ChÆ°a tÃ­nh" (khong du du lieu) khac "KhÃ´ng cÃ³ quyá»n xem" (bi
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
      } else if (draftSummary.trim() !== needSummary && window.confirm('TÃ³m táº¯t nhu cáº§u Ä‘Ã£ cÃ³ ná»™i dung báº¡n tá»± nháº­p. Ghi Ä‘Ã¨ báº±ng dá»¯ liá»‡u tháº­t tá»« cÆ¡ há»™i nÃ y?')) {
        setDraftSummary(needSummary);
        filledAny = true;
      }
    }
    if (needProducts) {
      if (!draftExpectedProducts.trim()) {
        setDraftExpectedProducts(needProducts);
        filledAny = true;
      } else if (draftExpectedProducts.trim() !== needProducts && window.confirm('Sáº£n pháº©m/dá»‹ch vá»¥ dá»± kiáº¿n Ä‘Ã£ cÃ³ ná»™i dung báº¡n tá»± nháº­p. Ghi Ä‘Ã¨ báº±ng dá»¯ liá»‡u tháº­t tá»« cÆ¡ há»™i nÃ y?')) {
        setDraftExpectedProducts(needProducts);
        filledAny = true;
      }
    }

    setAutofillMessage(filledAny ? 'ÄÃ£ náº¡p thÃ´ng tin tá»« cÆ¡ há»™i' : 'CÆ¡ há»™i chÆ°a cÃ³ thÃ´ng tin pháº¡m vi/háº¡ng má»¥c');
    window.setTimeout(() => setAutofillMessage(''), 4000);
  }

  async function createRequest(submitFully: boolean) {
    // Gop Buoc 1 (Yeu cau bao gia) + Buoc 2 (Thong tin ky thuat) lam MOT -
    // cung 1 nguoi (thuong la Presale) dien hang muc VA gia von ngay tai day.
    // 2 nut goi ham nay: header "LÆ°u / Chá»‰nh sá»­a" (submitFully=false, CHI luu
    // ban nhap, giu nguyen o 'request', KHONG bat SLA) va footer "BÃ n giao"
    // (submitFully=true, luu VA tu chuyen sang 'technical' ngay, bat dau SLA).
    if (!validateRequiredWorkspaceFields()) return;
    // Bam "BÃ n giao" (submitFully=true) la muon chuyen sang buoc 2 ngay -
    // backend (set_quote_processing_stage) bat buoc phai co sla_due_at hop
    // le (da dat + con trong tuong lai) moi cho chuyen buoc, neu khong se
    // chan luon o day thay vi tao xong quote roi lang le "ket" o buoc 1 (bug
    // that da gap: Sale bam BÃ n giao nhung khong thay gi doi, phai tu bam
    // nut du phong "Gá»­i yÃªu cáº§u xá»­ lÃ½" moi hieu ra vi sao).
    setActiveAction(submitFully ? 'handoff' : 'draftSave');
    setBusy(true);
    try {
      const legacyBlocks = [
        ...(draftScope.trim()
          ? [{ id: newBlockId(), kind: 'scope_of_work' as const, title: 'MÃ´ táº£ scope / yÃªu cáº§u cáº§n estimate', content: draftScope.trim() }]
          : []),
        // Dieu khoan thanh toan/bo sung nguoi dung da nhap TRUOC khi quote
        // that ton tai (che do tao moi) - gop vao cung luc tao, khong bat
        // nguoi dung phai lam lai sau khi luu.
        {
          id: newBlockId(),
          kind: 'payment_terms' as const,
          title: 'Äiá»u khoáº£n thanh toÃ¡n',
          content: `Thanh toÃ¡n trong ${draftPaymentTermsDays} ngÃ y ká»ƒ tá»« ngÃ y duyá»‡t bÃ¡o giÃ¡.`,
        },
        ...draftExtraTerms.map(t => ({ id: t.id, kind: 'custom_field' as const, title: t.title, content: t.content })),
      ];
      const customBlocks = [...legacyBlocks.filter(block => !draftCustomBlocks.some(b => b.kind !== 'custom_field' && b.kind === block.kind)), ...draftCustomBlocks].filter(b => b.content.trim());
      const created = await seedingQuoteRepository.createQuote({
        dealId: draftDealId,
        // Da validate o tren (!draftFormId && !defaultFormId -> return som) -
        // toi day chac chan co 1 trong 2 gia tri, an toan non-null assert.
        quoteFormId: (draftFormId || defaultFormId)!,
        projectId: draftProjectId || null,
        slaDueAt: datetimeLocalValueToIso(draftSlaDueAt),
        quoteTypeCodes: draftQuoteTypeCodes,
        data: {
          quoteTitle: draftTitle.trim() || 'YÃªu cáº§u há»— trá»£ bÃ¡o giÃ¡',
          customBlocks,
          paymentPlan: draftPaymentPlan,
          ...(draftVisibleColumns ? { visibleColumns: draftVisibleColumns } : {}),
          ...(draftVisibleSummaryFields ? { visibleSummaryFields: draftVisibleSummaryFields } : {}),
          ...(draftVisibleCustomerFields ? { visibleCustomerFields: draftVisibleCustomerFields } : {}),
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
            const displayName = customerRecord?.name || deal?.customerName;
            return {
              customerRecipient: displayName || undefined,
              customerCompanyName: customerRecord?.companyName || deal?.companyName || undefined,
              customerContactName: displayName || undefined,
              customerAddress: customerRecord?.address || deal?.address || undefined,
              customerPhone: customerRecord?.phone || deal?.phone || undefined,
              customerEmail: customerRecord?.email || deal?.email || undefined,
              customerTaxCode: customerRecord?.taxCode || deal?.taxCode || undefined,
            };
          })(),
        },
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
      // submitFully=true (nut "BÃ n giao"): tu dong chuyen processing_stage tu
      // 'request' -> 'technical' ngay sau khi tao - day chinh la moc SLA bat
      // dau tinh (sla_started_at chi set o lan dau request->technical, xem
      // set_quote_processing_stage). SLA da duoc validate hop le O TREN
      // (truoc khi tao quote) khi submitFully=true, nen toi day chac chan
      // chuyen buoc duoc - khong con nhanh "im lang bo qua" nua. submitFully
      // =false (nut header "LÆ°u / Chá»‰nh sá»­a"): CHI luu ban nhap, KHONG chuyen
      // buoc - giu nguyen o 'request' de Sale con sua thoai mai.
      let advancedToTechnical = false;
      if (submitFully) {
        try {
          await seedingQuoteRepository.setQuoteProcessingStage(created.id, 'technical');
          advancedToTechnical = true;
        } catch (stageErr) {
          window.alert(
            (stageErr instanceof Error ? stageErr.message : 'KhÃ´ng chuyá»ƒn Ä‘Æ°á»£c sang bÆ°á»›c ThÃ´ng tin ká»¹ thuáº­t.') +
              ' BÃ¡o giÃ¡ Ä‘Ã£ Ä‘Æ°á»£c lÆ°u â€” báº¡n cÃ³ thá»ƒ tá»± báº¥m "BÃ n giao" trong workspace sau khi sá»­a.'
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
      // bang man hinh "Äang táº£i bÃ¡o giÃ¡..." roi hien lai.
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
      // Bam "BÃ n giao" tuc la Presale coi nhu DA XONG ca hang muc lan gia
      // von NGAY tai buoc gop (bubble "YÃªu cáº§u & Ká»¹ thuáº­t") - neu moi thu da
      // du dieu kien (dung DUNG dieu kien RPC quote_set_processing_stage:
      // co hang muc, SL>0, da nhap gia von hoac tick "khong ap dung") thi chuyen
      // luon tiep sang 'pricing' TRONG CUNG 1 lan bam - tranh nguoi dung
      // tuong "bam bÃ n giao xong roi" ma van con ket o bubble buoc 1 (bug
      // that da gap: du da chuyen 'technical' that su duoi DB, bubble van
      // hien "current" vi bubble nay gop chung request+technical). Neu con
      // thieu dieu kien nao, IM LANG dung lai o 'technical' - nut "BÃ n giao
      // xá»­ lÃ½ giÃ¡" rieng trong workspace van con do de Sale/Presale tu bam
      // tiep sau khi bo sung du.
      if (submitFully && advancedToTechnical) {
        const realDraftItems = itemsDraft.filter(item => item.rowType !== 'section');
        const stillMissingCost = realDraftItems.some(item => !item.costNotApplicable && item.costPrice == null);
        const stillMissingQty = realDraftItems.some(item => !(item.quantity > 0));
        // Ly do CU THE khien chua chuyen tiep duoc sang 'pricing' - hien ro
        // cho nguoi dung (KHONG im lang nua, bug that da gap: nguoi dung
        // khong hieu vi sao bam "BÃ n giao" xong van con nut "BÃ n giao xá»­ lÃ½
        // giÃ¡" o Buoc 1, tuong he thong bi loi).
        const blockingReasons = [
          realDraftItems.length === 0 ? 'chÆ°a cÃ³ háº¡ng má»¥c nÃ o' : null,
          stillMissingQty ? 'cÃ²n háº¡ng má»¥c chÆ°a nháº­p sá»‘ lÆ°á»£ng' : null,
          stillMissingCost ? 'cÃ²n háº¡ng má»¥c chÆ°a nháº­p giÃ¡ vá»‘n (hoáº·c chÆ°a tick "KhÃ´ng Ã¡p dá»¥ng")' : null,
        ].filter((reason): reason is string => Boolean(reason));
        if (blockingReasons.length === 0) {
          try {
            await seedingQuoteRepository.setQuoteProcessingStage(created.id, 'pricing');
            // BUG THAT DA GAP ("khÃ´ng Ä‘Æ°á»£c máº·c Ä‘á»‹nh hoÃ n thÃ nh BÆ°á»›c 1 lÃ  luÃ´n
            // Ä‘iá»u hÆ°á»›ng sang BÆ°á»›c 2") - dung y het logic o handoffStep1ToPricing()
            // (quote da ton tai): so sale_user_id (resolvedQuoteOwnerId) voi
            // current_user_id (user?.id) bang ID THAT, khong so ten.
            const currentUserId = user?.id || null;
            if (resolvedQuoteOwnerId && currentUserId && resolvedQuoteOwnerId === currentUserId) {
              await load(created.id, { silent: true });
            } else {
              showToast(
                true,
                resolvedQuoteOwnerId
                  ? `ÄÃ£ hoÃ n thÃ nh BÆ°á»›c 1 vÃ  bÃ n giao cho ${nameFor(resolvedQuoteOwnerId)}.`
                  : 'ÄÃ£ hoÃ n thÃ nh BÆ°á»›c 1. BÃ¡o giÃ¡ Ä‘ang chá» phÃ¢n cÃ´ng Sale.'
              );
              window.setTimeout(() => {
                markClosingIntent();
                onClose();
              }, 1200);
            }
          } catch (pricingErr) {
            showToast(false, `ÄÃ£ lÆ°u, nhÆ°ng chÆ°a chuyá»ƒn Ä‘Æ°á»£c sang "HoÃ n thiá»‡n giÃ¡ bÃ¡n": ${pricingErr instanceof Error ? pricingErr.message : 'lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh'}. Bá»• sung rá»“i báº¥m "BÃ n giao" láº¡i.`);
          }
        } else {
          showToast(false, `ÄÃ£ lÆ°u, nhÆ°ng CHÆ¯A sang Ä‘Æ°á»£c "HoÃ n thiá»‡n giÃ¡ bÃ¡n" vÃ¬: ${blockingReasons.join(', ')}. Bá»• sung rá»“i báº¥m "BÃ n giao" láº¡i.`);
        }
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng lÆ°u Ä‘Æ°á»£c yÃªu cáº§u há»— trá»£ bÃ¡o giÃ¡.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  // SUA LAI lan 2 (bo tu dong): Sale phan hoi la tu dong tao ngam ngay khi co
  // hang muc dau tien lam form GIAT/RELOAD giua luc dang go du da them dieu
  // kien "phai co noi dung" - van con dinh do khong on. Quay lai bam nut ro
  // rang ("Táº¡o bÃ¡o giÃ¡") thay vi tu chay ngam - Sale tu quyet dinh luc nao
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
      if (quote?.processingStage === 'published') return 'ÄÃ£ phÃ¡t hÃ nh';
      if (quote?.processingStage === 'ready_to_publish') return 'ÄÃ£ duyá»‡t Â· ChÆ°a phÃ¡t hÃ nh';
    }
    return STAGE_LABELS[target];
  }

  // Nhan card "Pham vi" doi theo DUNG phase - truoc day dung chung 1 label
  // cho moi phase ("YÃªu cáº§u & pháº¡m vi cÃ´ng viá»‡c"), gay sai ngu canh o
  // technical/pricing/locked (khong con la "yeu cau" nua, ma la pham vi da
  // CHOT/da BAN GIAO). KHONG giu text sai chi vi test cu key cung vao no -
  // test phai tro qua data-testid="qc-scope-card-title" (xem JSX).
  function scopeCardLabel(target: QuoteProcessingStage): string {
    if (target === 'technical') return 'Pháº¡m vi ká»¹ thuáº­t';
    if (target === 'pricing') return 'Pháº¡m vi Ä‘Ã£ bÃ n giao';
    if (target === 'review' || target === 'ready_to_publish' || target === 'published') return 'Pháº¡m vi cÃ´ng viá»‡c';
    return 'YÃªu cáº§u & pháº¡m vi cÃ´ng viá»‡c';
  }

  function stageOwnerName(target: QuoteProcessingStage): string {
    if (!quote) {
      if (target === 'request') return nameFor(user?.id);
      if (target === 'technical') return nameFor(draftTechnicalOwnerId);
      if (target === 'pricing') return nameFor(draftQuoteOwnerId);
      return 'ChÆ°a duyá»‡t';
    }
    if (target === 'request') return nameFor(quote.createdById);
    if (target === 'technical') return ownerNameFor(quote.technicalOwnerId);
    if (target === 'pricing') return ownerNameFor(quote.quoteOwnerId);
    if (quote.processingStage === 'published') return nameFor(quote.publishedById);
    return nameFor(quote.approvedById);
  }

  function stageTimeLabel(target: QuoteProcessingStage): string {
    if (!quote) return target === 'request' ? 'Äang soáº¡n' : '';
    if (target === 'request') return relativeTime(quote.createdAt);
    if (target === 'technical') return relativeTime(checklist?.updatedAt || quote.updatedAt);
    if (target === 'pricing') return relativeTime(quote.updatedAt);
    if (!quote.approvedAt) return 'ChÆ°a duyá»‡t';
    if (quote.processingStage === 'published' && quote.publishedAt) return relativeTime(quote.publishedAt);
    return relativeTime(quote.approvedAt);
  }

  async function assignOwner(field: 'technicalOwnerId' | 'quoteOwnerId', value: string) {
    setBusy(true);
    try {
      await seedingQuoteRepository.assignQuoteOwners(quote!.id, { [field]: value || null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng gÃ¡n Ä‘Æ°á»£c ngÆ°á»i phá»¥ trÃ¡ch.');
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng lÆ°u Ä‘Æ°á»£c SLA.');
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng gÃ¡n Ä‘Æ°á»£c dá»± Ã¡n.');
    } finally {
      setBusy(false);
    }
  }

  async function advanceStage(target: QuoteProcessingStage) {
    // Chi con dung cho 'review' (Hoan tat phan gia ban) - hop request-
    // >technical->pricing gio di qua handoffStep1ToPricing() rieng (nut
    // "BÃ n giao" hop nhat Buoc 1), khong con goi ham nay voi 'technical' nua.
    setActiveAction('reviewPricing');
    setBusy(true);
    try {
      await seedingQuoteRepository.setQuoteProcessingStage(quote!.id, target);
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng chuyá»ƒn Ä‘Æ°á»£c bÆ°á»›c xá»­ lÃ½.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng lÆ°u Ä‘Æ°á»£c checklist bÃ n giao.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  // BUG THAT DA GAP (phan anh tu nguoi dung): quote da luu (khong phai vua
  // tao) dang o Buoc 1 gop ("YÃªu cáº§u & Ká»¹ thuáº­t") nhung UI van bat bam HAI
  // nut lien tiep - "Gá»­i yÃªu cáº§u xá»­ lÃ½" (request->technical, UI KHONG doi vi
  // van con Buoc 1) roi moi hien "BÃ n giao xá»­ lÃ½ giÃ¡" (technical->pricing,
  // luc nay UI moi qua Buoc 2) - nhin nhu Buoc 1 bi lap lai 2 lan. Gop lam
  // MOT hanh dong "BÃ n giao" duy nhat cho ca 2 truong hop (stage='request'
  // HOAC 'technical'): luu toan bo du lieu dang sua truoc, chuyen
  // request->technical NEU con o request (khong hien rieng buoc nay ra UI -
  // bubble 1 van gop chung ca 2), roi chuyen tiep technical->pricing luon -
  // CHI 1 lan bam la xong, giong dung hanh vi cua nut "BÃ n giao" luc tao moi
  // (createRequest). That bai o buoc nao (vd thieu scope/checklist chua du)
  // thi dung lai dung do, KHONG mat du lieu, bam lai se tu bo qua buoc da
  // xong (processingStage da doc lai tu response, khong goi lai buoc thua).
  async function handoffStep1ToPricing() {
    if (busy || !quote) return;
    if (!validateRequiredWorkspaceFields(quote)) return;
    if (itemsMissingCost.length > 0) {
      window.alert(`CÃ²n ${itemsMissingCost.length} háº¡ng má»¥c chÆ°a nháº­p giÃ¡ vá»‘n hoáº·c chÆ°a Ä‘Ã¡nh dáº¥u "KhÃ´ng Ã¡p dá»¥ng giÃ¡ vá»‘n". Vui lÃ²ng bá»• sung trÆ°á»›c khi bÃ n giao.`);
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
        throw new Error('ChÆ°a thá»ƒ hoÃ n táº¥t bÃ n giao. Vui lÃ²ng thá»­ láº¡i.');
      }

      // BUG THAT DA GAP ("khÃ´ng Ä‘Æ°á»£c máº·c Ä‘á»‹nh hoÃ n thÃ nh BÆ°á»›c 1 lÃ  luÃ´n Ä‘iá»u
      // hÆ°á»›ng sang BÆ°á»›c 2"): truoc day luon `await reload()` roi de nguyen UI
      // hien buoc moi nhat cua quote (pricing) - Presale KHONG phai Sale
      // duoc phan cong cung bi "keo theo" sang man hinh Buoc 2 (thuc chat
      // khong lam gi duoc o do vi khong co quyen sua Buoc 2). Dung DUNG
      // sale_user_id (quote.quoteOwnerId) so voi current_user_id (user?.id)
      // - so bang ID THAT, KHONG so ten/email/text role.
      await reload();
      showToast(true, `ÄÃ£ bÃ n giao sang BÆ°á»›c 2${finalQuote.quoteOwnerId ? ` cho ${nameFor(finalQuote.quoteOwnerId)}` : ''}.`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'ChÆ°a thá»ƒ hoÃ n táº¥t bÃ n giao. Vui lÃ²ng thá»­ láº¡i.');
      // Du that bai o buoc nao, tai lai du lieu THAT tu server (co the da
      // qua duoc request->technical) - khong de UI dung sai lech voi DB
      // that. Popup GIU NGUYEN MO (khong dong) - dung yeu cau "Náº¿u API lá»—i
      // thÃ¬ giá»¯ popup má»Ÿ, giá»¯ nguyÃªn dá»¯ liá»‡u" - nguoi dung tu bam "BÃ n giao"
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
        // Rule Engine khong dat - dong modal duyet thuong, mo modal "PhÃª
        // duyá»‡t ngoáº¡i lá»‡" rieng (Section 5), bat nhap ly do.
        setApproveModalOpen(false);
        setExceptionApprovalModal({ open: true, reason: '', evaluation: err.evaluation });
        return;
      }
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng duyá»‡t Ä‘Æ°á»£c bÃ¡o giÃ¡.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function approveWithExceptionNow() {
    if (busy) return;
    const reason = exceptionApprovalModal.reason.trim();
    if (!reason) {
      window.alert('Vui lÃ²ng nháº­p lÃ½ do phÃª duyá»‡t ngoáº¡i lá»‡.');
      return;
    }
    setActiveAction('approve');
    setBusy(true);
    try {
      await seedingQuoteRepository.approveQuote(quote!.id, reason);
      setExceptionApprovalModal({ open: false, reason: '', evaluation: null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng duyá»‡t ngoáº¡i lá»‡ Ä‘Æ°á»£c bÃ¡o giÃ¡.');
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng phÃ¡t hÃ nh Ä‘Æ°á»£c bÃ¡o giÃ¡.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function requestChangesNow() {
    if (busy) return;
    if (!requestChangesReason.trim()) {
      window.alert('Vui lÃ²ng nháº­p lÃ½ do yÃªu cáº§u chá»‰nh sá»­a.');
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng gá»­i Ä‘Æ°á»£c yÃªu cáº§u chá»‰nh sá»­a.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function copyPublicLink() {
    if (!quote!.publicUrl) return;
    await navigator.clipboard.writeText(`${window.location.origin}${quote!.publicUrl}`);
    showToast(true, 'ÄÃ£ sao chÃ©p link bÃ¡o giÃ¡.');
  }

  // "KhoÃ¡ link bÃ¡o giÃ¡" - yeu cau rieng "gui khach xong lam sao khoa link lai
  // duoc" (endpoint /revoke-public da co san o backend/repository tu truoc,
  // dung o menu "..." tren trang Danh sach bao gia - nhung CHUA co trong
  // Quote Workspace, dung nga can nguoi dung nhat khi ho dang xem chinh link
  // vua gui). Dung lai API cu, chi them nut + cap nhat lai state tai cho.
  async function revokePublicLinkFromWorkspace() {
    if (!quote) return;
    if (!window.confirm('KhoÃ¡ link bÃ¡o giÃ¡ nÃ y? KhÃ¡ch hÃ ng sáº½ khÃ´ng truy cáº­p Ä‘Æ°á»£c link cÅ© ná»¯a cho tá»›i khi báº¡n gá»­i láº¡i.')) return;
    setBusy(true);
    try {
      const updated = await seedingQuoteRepository.revokePublicQuote(quote.id);
      setQuote(updated);
      showToast(true, 'ÄÃ£ khoÃ¡ link bÃ¡o giÃ¡.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng khoÃ¡ Ä‘Æ°á»£c link bÃ¡o giÃ¡.');
    } finally {
      setBusy(false);
    }
  }

  // "Má»Ÿ láº¡i link bÃ¡o giÃ¡" - yeu cau rieng ("khÃ³a link rá»“i ... k tháº¥y nÃºt má»Ÿ
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
      showToast(true, 'ÄÃ£ má»Ÿ láº¡i link bÃ¡o giÃ¡.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng má»Ÿ láº¡i Ä‘Æ°á»£c link bÃ¡o giÃ¡.');
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
      setDeliveryLogModal({ open: true, loading: false, entries: [], error: err instanceof Error ? err.message : 'KhÃ´ng táº£i Ä‘Æ°á»£c lá»‹ch sá»­ gá»­i.' });
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
    setSendSubject(`BÃ¡o giÃ¡ ${quote.quoteNumber}${quote.data?.quoteTitle ? ` Â· ${quote.data.quoteTitle}` : ''}`);
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
      setSendError('Vui lÃ²ng nháº­p email ngÆ°á»i nháº­n.');
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
        setSendError(result.errorMessage || 'Gá»­i email tháº¥t báº¡i.');
        setSendIdempotencyKey(newSendIdempotencyKey(quote.id));
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Gá»­i email tháº¥t báº¡i.');
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
        window.alert(`Chuá»—i bÃ¡o giÃ¡ Ä‘Ã£ cÃ³ báº£n duyá»‡t má»›i hÆ¡n (V${result.sourceVersionNumber}) â€” Ä‘Ã£ táº¡o phiÃªn báº£n má»›i tá»« báº£n Ä‘Ã³.`);
      } else if (!result.created) {
        window.alert('Chuá»—i nÃ y Ä‘Ã£ cÃ³ báº£n nhÃ¡p sáºµn â€” má»Ÿ báº£n nhÃ¡p Ä‘Ã³.');
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
      window.alert(err instanceof Error ? err.message : 'KhÃ´ng táº¡o Ä‘Æ°á»£c phiÃªn báº£n bÃ¡o giÃ¡ má»›i.');
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
      return { disabled: true, label: 'Táº¡o phiÃªn báº£n má»›i', tooltip: 'Cáº§n lÆ°u vÃ  duyá»‡t bÃ¡o giÃ¡ trÆ°á»›c khi táº¡o phiÃªn báº£n má»›i.' };
    }
    if (status.key === 'lost') {
      return { disabled: true, label: 'Táº¡o phiÃªn báº£n má»›i', tooltip: 'BÃ¡o giÃ¡ Ä‘Ã£ huá»·, khÃ´ng thá»ƒ táº¡o phiÃªn báº£n má»›i.' };
    }
    if (status.key === 'won') {
      return { disabled: true, label: 'Táº¡o phiÃªn báº£n má»›i', tooltip: 'BÃ¡o giÃ¡ Ä‘Ã£ chá»‘t, khÃ´ng thá»ƒ táº¡o phiÃªn báº£n má»›i.' };
    }
    if (quote.status !== 'approved') {
      return { disabled: true, label: 'Táº¡o phiÃªn báº£n má»›i', tooltip: 'Chá»‰ bÃ¡o giÃ¡ Ä‘Ã£ duyá»‡t má»›i cÃ³ thá»ƒ táº¡o phiÃªn báº£n má»›i.' };
    }
    if (existingDraftVersion) {
      return { disabled: false, label: `Tiáº¿p tá»¥c chá»‰nh sá»­a V${existingDraftVersion.versionNumber || ''}`, tooltip: undefined, continueExisting: true as const };
    }
    return { disabled: false, label: `Táº¡o phiÃªn báº£n má»›i tá»« V${quote.versionNumber || 1}`, tooltip: undefined };
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
  const canPreview = quote ? itemsDraft.length > 0 : Boolean(draftDealId) && itemsDraft.length > 0;
  const previewDisabledReason = !canPreview
    ? 'ThÃªm thÃ´ng tin khÃ¡ch hÃ ng vÃ  háº¡ng má»¥c Ä‘á»ƒ xem báº£n khÃ¡ch hÃ ng'
    : undefined;

  // BUG THAT DA GAP ("báº¥m Preview khÃ¡ch hÃ ng á»Ÿ bÆ°á»›c 1 ra báº£ng cÅ© chá»© khÃ´ng
  // hiá»‡n báº£n PDF"): modal xem truoc truoc day CHI dung QuoteDocumentRenderer
  // (giong PDF/public that) khi `quote.formSnapshot` co - tuc CHI sau khi da
  // bam Luu/Ban giao it nhat 1 lan (quote that su ton tai trong DB). Truoc
  // do (che do tao moi, quote con null) roi ve ban rut gon 4 cot cu, du
  // nguoi dung DA CHON mau bao gia qua dropdown "Máº«u bÃ¡o giÃ¡" (draftFormId)
  // roi - schema DA BIET, chi la chua duoc luu thanh quote.formSnapshot. Xay
  // "ban nhap" cua schema + du lieu tu chinh cac state dang go (draftTitle/
  // draftScope/draftCustomerId...) - GIONG HET logic build payload luc bam
  // "BÃ n giao" that su (xem createRequest(), dong ~2179-2241) - de Preview
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
        ? [{ id: 'preview-scope', kind: 'scope_of_work' as const, title: 'MÃ´ táº£ scope / yÃªu cáº§u cáº§n estimate', content: draftScope.trim() }]
        : []),
      {
        id: 'preview-payment',
        kind: 'payment_terms' as const,
        title: 'Äiá»u khoáº£n thanh toÃ¡n',
        content: `Thanh toÃ¡n trong ${draftPaymentTermsDays} ngÃ y ká»ƒ tá»« ngÃ y duyá»‡t bÃ¡o giÃ¡.`,
      },
      ...draftExtraTerms.map(t => ({ id: t.id, kind: 'custom_field' as const, title: t.title, content: t.content })),
    ];
    const customBlocks = [...legacyBlocks.filter(block => !draftCustomBlocks.some(b => b.kind !== 'custom_field' && b.kind === block.kind)), ...draftCustomBlocks].filter(b => b.content.trim());
    return {
      quoteTitle: draftTitle.trim() || 'YÃªu cáº§u há»— trá»£ bÃ¡o giÃ¡',
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
  }, [deal, draftCustomerId, customers, draftTitle, draftScope, draftPaymentTermsDays, draftExtraTerms, draftCustomBlocks, draftPaymentPlan, draftVisibleColumns, draftVisibleSummaryFields, draftVisibleCustomerFields]);
  const columnVisibilitySchema = quote?.formSnapshot || draftSelectedForm?.schemaJson;
  // "Káº¿ hoáº¡ch thanh toÃ¡n" dang chim qua trong 1 accordion phang - badge trang
  // thai + tom tat khi dong de Sale khong bo qua (yeu cau rieng, xem
  // paymentPlanCardOpen ben duoi). KHONG doi logic tinh tien/villa/persistence.
  const paymentPlanRows = quote?.data.paymentPlan || draftPaymentPlan;
  const paymentPlanFinalPayable = calculateOverallDiscountSummary(calculateQuoteTotals(itemsDraft), quote ? quote.overallDiscountPercent : draftOverallDiscountPercent).grandTotal;
  const paymentPlanPct = paymentPlanPercent(paymentPlanRows);
  const paymentPlanIsEmpty = paymentPlanRows.length === 0;
  const paymentPlanIsComplete = !paymentPlanIsEmpty && paymentPlanPct === 100;
  const paymentPlanBadgeText = paymentPlanIsEmpty ? 'ChÆ°a thiáº¿t láº­p' : paymentPlanIsComplete ? `${paymentPlanRows.length} Ä‘á»£t Â· 100%` : 'Cáº§n Ä‘á»§ 100%';
  const paymentPlanBadgeClass = paymentPlanIsEmpty ? 'qc-badge-neutral' : paymentPlanIsComplete ? 'qc-badge-success' : 'qc-badge-warning';
  const paymentPlanTotalAmount = paymentPlanRows.reduce((sum, row) => sum + paymentPlanAmount(paymentPlanFinalPayable, row.percent), 0);
  const columnVisibilityDraft: QuoteDraft = {
    data: quote ? quote.data : draftPreviewData,
    items: itemsDraft,
    solutionItems: quote?.data?.solutionItems || [],
  };

  // "Khi tÃ­ch xong há»i láº¡i cÃ³ cháº¯c lÆ°u vÃ  hiá»ƒn thá»‹ váº­y khÃ´ng" - moi lan bam
  // tick 1 cot deu hoi xac nhan TRUOC khi that su ap dung/luu.
  //
  // BUG THAT DA GAP ("k báº¥m dc luÃ´n" - lap lai 2 lan): ban dau dung
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
    if (!window.confirm('Báº¡n cÃ³ cháº¯c muá»‘n lÆ°u vÃ  Ã¡p dá»¥ng Ä‘Ãºng cáº¥u hÃ¬nh hiá»ƒn thá»‹ (cá»™t & tá»•ng há»£p giÃ¡) Ä‘Ã£ chá»n cho báº£n xem/khÃ¡ch hÃ ng khÃ´ng?')) {
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
    ? 'Cáº§n lÆ°u vÃ  duyá»‡t bÃ¡o giÃ¡ trÆ°á»›c khi gá»­i khÃ¡ch'
    : quote.status !== 'approved'
      ? 'BÃ¡o giÃ¡ chÆ°a Ä‘Æ°á»£c duyá»‡t'
      : quote.processingStage !== 'published' || !quote.publicEnabled
        ? 'Cáº§n phÃ¡t hÃ nh bÃ¡o giÃ¡ trÆ°á»›c khi gá»­i'
        : !sendAvailability
          ? 'Äang kiá»ƒm tra kÃªnh gá»­i email...'
          : !sendAvailability.available
            ? (sendAvailability.reason || 'KÃªnh email hiá»‡n khÃ´ng hoáº¡t Ä‘á»™ng')
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
        <div className="qc-workspace qc-workspace--loading">Äang táº£i bÃ¡o giÃ¡...</div>
      </div>
    );
  }

  return (
    <div className="qc-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) requestWorkspaceClose(); }}>
      <div className="qc-workspace">
        <header className="qc-workspace-header">
          {/* Dong rieng CHI hien tren mobile (â‰¤767px, CSS an tren desktop) -
           * trang thai + nut dong o TREN CUNG, dung yeu cau "DÃ²ng 1: tráº¡ng
           * thÃ¡i + nÃºt Ä‘Ã³ng". Cac nut phu (version/quay lai danh sach) don
           * vao 1 menu "â‹¯" dung chung ActionMenu (khong viet dropdown rieng)
           * de khong con 4 nut chen nhau xuong dong nhu truoc. */}
          <div className="qc-workspace-header-mobile-row">
            <span className={`qc-badge ${status.className}`}>{status.label}</span>
            <div className="qc-workspace-header-mobile-actions">
              <ActionMenu
                label="Thao tÃ¡c khÃ¡c"
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
                  { key: 'back', label: 'â† Danh sÃ¡ch', disabled: busy, onSelect: requestWorkspaceClose },
                ]}
              />
              <button type="button" className="crm-icon-action" aria-label="ÄÃ³ng" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>
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
                  {typeof quote.data?.quoteTitle === 'string' && quote.data.quoteTitle ? quote.data.quoteTitle : 'ChÆ°a cÃ³ tiÃªu Ä‘á» bÃ¡o giÃ¡'}
                  {' Â· '}Cáº­p nháº­t láº§n cuá»‘i {relativeTime(quote.updatedAt || quote.createdAt)}
                </div>
              </>
            ) : (
              <div className="qc-workspace-header-title qc-workspace-header-title--create">
                <span className={`qc-badge ${status.className}`}>{status.label}</span>
                <input
                  type="text"
                  className="qc-workspace-title-input"
                  placeholder="TiÃªu Ä‘á» yÃªu cáº§u há»— trá»£ bÃ¡o giÃ¡..."
                  value={draftTitle}
                  onChange={event => setDraftTitle(event.target.value)}
                />
              </div>
            )}
          </div>

          {/* Tien trinh 3 buoc GOP CHUNG 1 hang voi tieu de+nut hanh dong tren
           * desktop (yeu cau "Header vÃ  tiáº¿n trÃ¬nh chung má»™t hÃ ng") - CHINH
           * la .qc-workspace-stages cu, chi doi VI TRI (nam trong header thay
           * vi la 1 hang rieng ben duoi) - CSS mobile @767px van an di y het
           * truoc (display:none), khong doi hanh vi mobile. */}
          <div className="qc-workspace-stages qc-workspace-header-progress">
            {/* Gop Buoc 1 (request) + Buoc 2 (technical) lam MOT bubble hien
             * thi ("YÃªu cáº§u & Ká»¹ thuáº­t") - dung 1 nguoi dien hang muc+gia von
             * cung luc, khong con hanh dong rieng giua 2 buoc DB nay nua (xem
             * createRequest). STAGE_ORDER/stage van giu nguyen 4 gia tri DB o
             * moi noi khac (permission/SLA...), CHI gop rieng phan hien thi. */}
            {([
              { key: 'request_technical' as const, label: 'YÃªu cáº§u & Ká»¹ thuáº­t', repr: (stage === 'technical' ? 'technical' : 'request') as QuoteProcessingStage },
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
              const meta = [owner, time].filter(Boolean).join(' Â· ');
              return (
                <div className={`qc-stagebar-step qc-stagebar-step--${state}`} key={s.key}>
                  <span className="qc-stagebar-circle">{state === 'done' ? 'âœ“' : index + 1}</span>
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
            {/* BUG THAT DA GAP ("xÃ³a 3 nÃ y Ä‘i, nÃºt táº¡o phiÃªn báº£n chá»‰ hiá»‡n
             * bÆ°á»›c Ä‘Ã£ duyá»‡t thÃ´i"): "LÆ°u"/"â† Danh sÃ¡ch" o day TRUNG LAP 100%
             * voi cac nut cung chuc nang da co san o footer (xem
             * qc-workspace-footer - moi stage deu co "LÆ°u" rieng, "â† Danh
             * sÃ¡ch" da co san khi !isDraft/khi con la ban nhap) - bo han 2
             * nut nay khoi header, chi giu nut Dong (X). "Táº¡o phiÃªn báº£n má»›i"
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
            {/* "LÆ°u / Chá»‰nh sá»­a" DA CHUYEN xuong footer, dat canh nut "BÃ n
             * giao" (xem qc-workspace-footer, Ä‘á»•i tÃªn thÃ nh "LÆ°u / Báº£n
             * nhÃ¡p") theo yeu cau moi - header gio chi con nut Dong (X).
             * Bam X hieu ngam la Huá»·, khong con nut chu "Huá»·" rieng o
             * footer nua. */}
            <button type="button" className="crm-icon-action qc-workspace-header-btn-desktop-only" aria-label="ÄÃ³ng" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>
              <X className="qc-inline-icon" />
            </button>
          </div>
        </header>

        {/* Tom tat progress GON cho mobile (â‰¤767px, CSS an tren desktop) -
         * "BÆ°á»›c X/3 â€” {label}" 1 dong duy nhat thay vi ep ca 3 buoc + connector
         * + meta nguoi phu trach vao 1 hang chat chu nho. Tinh truc tiep bang
         * JSX (khong doan qua CSS an/hien tung buoc) de chac chan dung noi
         * dung buoc hien tai. */}
        <div className="qc-stagebar-mobile-summary">
          {(() => {
            const mobileSteps = [
              { key: 'request_technical' as const, label: 'YÃªu cáº§u & Ká»¹ thuáº­t', repr: (stage === 'technical' ? 'technical' : 'request') as QuoteProcessingStage },
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
            return `BÆ°á»›c ${activeIndex + 1}/${mobileSteps.length} â€” ${mobileSteps[activeIndex].label}`;
          })()}
        </div>

        <div className="qc-workspace-info-strip">
          <div data-qc-required="customer">
            <span className="qc-workspace-info-label">KhÃ¡ch hÃ ng <span className="qc-required-mark">*</span></span>
            {!quote && lockCustomer ? (
              <strong>{customers.find(c => c.id === draftCustomerId)?.label || 'Äang táº£iâ€¦'}</strong>
            ) : !quote ? (
              <SearchableSelect
                value={draftCustomerId}
                onChange={selectDraftCustomer}
                options={customers.map(c => ({ value: c.id, label: c.label }))}
                actions={[
                  { key: 'create-customer', label: '+ Táº¡o khÃ¡ch hÃ ng má»›i', onSelect: () => setCustomerDrawerOpen(true), type: 'add' },
                  { key: 'manage-customers', label: 'Quáº£n lÃ½ khÃ¡ch hÃ ng', onSelect: () => window.open('/all-platform/crm/customers', '_blank', 'noopener,noreferrer'), type: 'manage' },
                ]}
                placeholder="Chá»n khÃ¡ch hÃ ng..."
              />
            ) : (
              // Quote da tao xong: KHONG con doi Khach hang duoc that su
              // (backend chua co API doi deal_id tren quote da ton tai) -
              // nhung van hien dang o box giong Du an/Presale/Sale (khong
              // hien nhu 1 nhan chu thuong bi khoa cung) de giao dien nhat
              // quan - dung SearchableSelect disabled voi 1 option duy nhat
              // la gia tri hien tai.
              <SearchableSelect
                value="current"
                onChange={() => {}}
                options={[{ value: 'current', label: deal?.customerName || 'ChÆ°a gáº¯n cÆ¡ há»™i' }]}
                disabled
              />
            )}
            {requiredFieldErrors.customer ? <p className="qc-field-error">{requiredFieldErrors.customer}</p> : null}
          </div>
          <div>
            <span className="qc-workspace-info-label">Dá»± Ã¡n</span>
            {!quote && lockProject ? (
              <strong>
                {(() => {
                  const found = (projects || []).find(p => p.id === draftProjectId);
                  return found ? `${found.projectCode} Â· ${found.name}` : 'Äang táº£iâ€¦';
                })()}
              </strong>
            ) : !quote || (isDraft && canEdit) ? (
              !effectiveCustomerIdForProjects ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>
                  {quote ? 'CÆ¡ há»™i chÆ°a gáº¯n há»“ sÆ¡ khÃ¡ch hÃ ng' : 'Chá»n khÃ¡ch hÃ ng trÆ°á»›c'}
                </span>
              ) : projects === null ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Äang táº£iâ€¦</span>
              ) : (
                <SearchableSelect
                  value={quote ? quote.projectId || '' : draftProjectId}
                  onChange={value => {
                    if (value === CREATE_NEW_PROJECT_OPTION) {
                      setProjectModalOpen(true);
                      return;
                    }
                    if (quote) void updateQuoteProject(value);
                    else setDraftProjectId(value);
                  }}
                  // BUG THAT DA GAP ("láº·p 2 chá»¯ ChÆ°a thuá»™c dá»± Ã¡n"): SearchableSelect
                  // TU render san 1 nut "clear" o dau danh sach dung chinh
                  // `placeholder` lam nhan (xem SearchableSelect.tsx) - truoc day
                  // options con khai bao THEM 1 dong { value: '', label: 'ChÆ°a
                  // thuá»™c dá»± Ã¡n' } giong het, thanh ra hien 2 dong trung nhau.
                  // Chi can placeholder, KHONG khai bao lai value='' trong options.
                  options={[
                    { value: CREATE_NEW_PROJECT_OPTION, label: '+ Táº¡o dá»± Ã¡n má»›iâ€¦' },
                    ...projects.map(p => ({ value: p.id, label: `${p.projectCode} Â· ${p.name}` })),
                  ]}
                  placeholder="ChÆ°a thuá»™c dá»± Ã¡n"
                  hideClearOption
                />
              )
            ) : (
              <strong>
                {(() => {
                  const found = (projects || []).find(p => p.id === quote.projectId);
                  return found ? `${found.projectCode} Â· ${found.name}` : quote.projectId ? 'Äang táº£iâ€¦' : 'ChÆ°a thuá»™c dá»± Ã¡n';
                })()}
              </strong>
            )}
          </div>
          <div data-qc-required="deal">
            <span className="qc-workspace-info-label">CÆ¡ há»™i CRM <span className="qc-required-mark">*</span></span>
            {!quote ? (
              <SearchableSelect
                value={draftDealId}
                onChange={handleSelectDeal}
                options={[
                  { value: CREATE_NEW_DEAL_OPTION, label: '+ Táº¡o cÆ¡ há»™i má»›iâ€¦' },
                  ...effectiveDeals
                    .filter(d => !draftCustomerId || d.customerId === draftCustomerId)
                    // Toi tu 1 Project card cu the (lockProject) - Co hoi CHI
                    // hien dung cua Project do, khong phai moi Co hoi cua Khach hang.
                    .filter(d => !lockProject || !draftProjectId || d.projectId === draftProjectId)
                    .map(d => ({ value: d.id, label: `${d.customerName}${d.companyName ? ' Â· ' + d.companyName : ''}` })),
                ]}
                placeholder="Chá»n cÆ¡ há»™i..."
                hideClearOption
              />
            ) : null}
            {!quote && draftDealId ? (
              <div className="qc-row-sub">
                MÃ£ cÆ¡ há»™i: {businessCode || 'ChÆ°a cÃ³ mÃ£'}
                {deal?.estimatedBudget ? ` Â· GiÃ¡ trá»‹ dá»± kiáº¿n: ${formatMoney(deal.estimatedBudget)}` : ''}
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
                  options={[{ value: 'current', label: businessCode || (deal ? 'CÆ¡ há»™i chÆ°a cÃ³ mÃ£' : 'ChÆ°a gáº¯n cÆ¡ há»™i') }]}
                  disabled
                />
                <div className="qc-row-sub">
                  {/* opportunityName muon tu ten goi dich vu, KHONG phai "ten
                   * co hoi" that (Deal khong co field nay) - ghi nhan ro
                   * nguon that de khong trinh bay nhu du lieu that khac. */}
                  {opportunityName ? `GÃ³i dá»‹ch vá»¥: ${opportunityName}` : deal ? 'ChÆ°a cÃ³ gÃ³i dá»‹ch vá»¥' : ''}
                  {deal?.estimatedBudget ? ` Â· GiÃ¡ trá»‹ dá»± kiáº¿n: ${formatMoney(deal.estimatedBudget)}` : ''}
                </div>
              </>
            ) : null}
            {requiredFieldErrors.deal ? <p className="qc-field-error">{requiredFieldErrors.deal}</p> : null}
          </div>
          {!quote && quoteForms.length > 0 ? (
            <div data-qc-required="form">
              <span className="qc-workspace-info-label">Máº«u bÃ¡o giÃ¡ <span className="qc-required-mark">*</span></span>
              <SearchableSelect
                value={draftFormId}
                onChange={value => { setDraftFormId(value); if (value) clearRequiredError('form'); }}
                options={quoteForms.map(f => ({ value: f.id, label: f.name }))}
                placeholder="Chá»n máº«u bÃ¡o giÃ¡..."
              />
              {requiredFieldErrors.form ? <p className="qc-field-error">{requiredFieldErrors.form}</p> : null}
            </div>
          ) : null}
          <div
            tabIndex={-1}
            onBlur={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setQuoteTypeDropdownOpen(false);
            }}
            style={{ position: 'relative' }}
          >
            <span className="qc-workspace-info-label">Loáº¡i bÃ¡o giÃ¡</span>
            <div
              className={`qc-quote-type-control${canEditQuoteType ? ' qc-quote-type-control--editable' : ''}`}
              onClick={() => canEditQuoteType && setQuoteTypeDropdownOpen(v => !v)}
            >
              {currentQuoteTypeCodes.length === 0 ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Chá»n loáº¡i bÃ¡o giÃ¡...</span>
              ) : (
                <div className="qc-quote-type-chips">
                  {currentQuoteTypeCodes.map(code => (
                    <span key={code} className="qc-quote-type-chip">
                      {quoteTypeLabel(code)}
                      {canEditQuoteType ? (
                        <button
                          type="button"
                          aria-label={`Bá» chá»n ${quoteTypeLabel(code)}`}
                          onClick={e => { e.stopPropagation(); toggleQuoteTypeCode(code); }}
                        >
                          Ã—
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
                  placeholder="TÃ¬m loáº¡i bÃ¡o giÃ¡..."
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
                      ChÆ°a cÃ³ Loáº¡i bÃ¡o giÃ¡ nÃ o trong Danh má»¥c CRM.
                    </div>
                  ) : null}
                  <div className="crm-searchable-select-actions">
                    <div className="crm-searchable-select-divider" />
                    <button type="button" className="crm-searchable-select-action" onClick={() => { setQuoteTypeDropdownOpen(false); setQuoteTypeQuickAddOpen(true); }}>
                      + ThÃªm loáº¡i bÃ¡o giÃ¡
                    </button>
                    <button type="button" className="crm-searchable-select-action" onClick={() => { setQuoteTypeDropdownOpen(false); setQuoteTypeManageOpen(true); }}>
                      Quáº£n lÃ½ loáº¡i bÃ¡o giÃ¡
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {/* Presale/Sale/SLA DA CHUYEN sang sidebar (card "PhÃ¢n cÃ´ng & SLA",
           * xem <aside className="qc-workspace-side"> ben duoi) theo yeu cau
           * rieng "PhÃ¢n cÃ´ng & SLA Ä‘á»ƒ bÃªn sidebar luÃ´n" - KHONG con nam
           * trong info-strip hang 2 nua, chi con "Loáº¡i bÃ¡o giÃ¡"/"Hiá»‡u lá»±c
           * Ä‘áº¿n" o day. */}
          {quote?.validUntil ? (
            <div>
              <span className="qc-workspace-info-label">Hiá»‡u lá»±c Ä‘áº¿n</span>
              <strong>{formatDate(quote.validUntil)}</strong>
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
                  <h3 data-testid="qc-scope-card-title">YÃªu cáº§u &amp; pháº¡m vi cÃ´ng viá»‡c</h3>
                  <span className="qc-workspace-collapsible-hint">{scopeCardOpen ? '(báº¥m Ä‘á»ƒ thu gá»n)' : '(báº¥m Ä‘á»ƒ xem)'}</span>
                  {autofillMessage ? <span className="qc-workspace-autofill-toast">{autofillMessage}</span> : null}
                </summary>
                <div className="qc-workspace-request-form">
                  <div className="qc-workspace-request-form-cols">
                    <label>
                      <span className="qc-workspace-info-label">TÃ³m táº¯t nhu cáº§u cá»§a khÃ¡ch</span>
                      <textarea
                        className="qc-workspace-handoff-note"
                        rows={3}
                        disabled={quote ? !canEdit : false}
                        value={quote ? editSummary : draftSummary}
                        onChange={event => (quote ? setEditSummary : setDraftSummary)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder={draftDealId ? 'CÆ¡ há»™i chÆ°a cÃ³ mÃ´ táº£ nhu cáº§u â€” tá»± nháº­p táº¡i Ä‘Ã¢y.' : 'KhÃ¡ch cáº§n gÃ¬, bá»‘i cáº£nh yÃªu cáº§u...'}
                      />
                    </label>
                    <label>
                      <span className="qc-workspace-info-label">MÃ´ táº£ scope / yÃªu cáº§u cáº§n estimate</span>
                      <textarea
                        className="qc-workspace-handoff-note"
                        rows={3}
                        disabled={quote ? !canEdit : false}
                        value={quote ? editScope : draftScope}
                        onChange={event => (quote ? setEditScope : setDraftScope)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder="Pháº¡m vi cÃ´ng viá»‡c cáº§n ká»¹ thuáº­t estimate..."
                      />
                    </label>
                  </div>
                  <details className="qc-workspace-request-more">
                    <summary>Sáº£n pháº©m dá»± kiáº¿n / Ghi chÃº ná»™i bá»™ (tuá»³ chá»n)</summary>
                    <label>
                      <span className="qc-workspace-info-label">Sáº£n pháº©m / dá»‹ch vá»¥ dá»± kiáº¿n (náº¿u cÃ³)</span>
                      <input
                        type="text"
                        className="crm-input"
                        disabled={quote ? !canEdit : false}
                        value={quote ? editExpectedProducts : draftExpectedProducts}
                        onChange={event => (quote ? setEditExpectedProducts : setDraftExpectedProducts)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder={draftDealId ? 'ChÆ°a cÃ³ sáº£n pháº©m/dá»‹ch vá»¥ â€” tá»± nháº­p táº¡i Ä‘Ã¢y.' : 'VÃ­ dá»¥: GÃ³i VPS Cloud, dá»‹ch vá»¥ tÆ° váº¥n...'}
                      />
                    </label>
                    {!quote ? (
                      <label>
                        <span className="qc-workspace-info-label">Ghi chÃº ná»™i bá»™ (khÃ´ng hiá»‡n cho khÃ¡ch)</span>
                        <textarea className="qc-workspace-handoff-note" rows={2} value={draftInternalNote} onChange={event => setDraftInternalNote(event.target.value)} placeholder="Ghi chÃº riÃªng cho Ä‘á»™i xá»­ lÃ½..." />
                      </label>
                    ) : null}
                    <p className="qc-workspace-note">ChÆ°a há»— trá»£ tá»‡p Ä‘Ã­nh kÃ¨m.</p>
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
                  if (!deal) missingLinks.push('ChÆ°a gáº¯n khÃ¡ch hÃ ng');
                  if (!project) missingLinks.push('ChÆ°a thuá»™c dá»± Ã¡n');
                  if (!deal) missingLinks.push('ChÆ°a gáº¯n cÆ¡ há»™i');
                  if (!quote.slaDueAt) missingLinks.push('ChÆ°a Ä‘áº·t SLA');
                  return (
                    <>
                      <div className="qc-workspace-card">
                        <div className="qc-workspace-card-head">
                          <h3>Báº£n tÃ³m táº¯t bÃ¡o giÃ¡</h3>
                          <span className="qc-badge qc-badge-neutral">Version Ä‘Ã£ khoÃ¡</span>
                        </div>
                        <div className="qc-summary-grid">
                          <div><span className="qc-workspace-info-label">KhÃ¡ch hÃ ng</span><strong>{deal?.customerName || 'ChÆ°a gáº¯n khÃ¡ch hÃ ng'}</strong></div>
                          <div><span className="qc-workspace-info-label">Dá»± Ã¡n</span><strong>{project ? `${project.projectCode} Â· ${project.name}` : 'ChÆ°a thuá»™c dá»± Ã¡n'}</strong></div>
                          <div><span className="qc-workspace-info-label">CÆ¡ há»™i CRM</span><strong>{businessCode || (deal ? 'CÆ¡ há»™i chÆ°a cÃ³ mÃ£' : 'ChÆ°a gáº¯n cÆ¡ há»™i')}</strong></div>
                          <div><span className="qc-workspace-info-label">Presale phá»¥ trÃ¡ch</span><strong>{techName || 'ChÆ°a gÃ¡n'}</strong></div>
                          <div><span className="qc-workspace-info-label">Sale phá»¥ trÃ¡ch</span><strong>{saleName || 'ChÆ°a gÃ¡n'}</strong></div>
                          <div><span className="qc-workspace-info-label">SLA</span><strong>{quote.slaDueAt ? formatDate(quote.slaDueAt) : 'ChÆ°a Ä‘áº·t SLA'}</strong></div>
                          <div><span className="qc-workspace-info-label">NgÆ°á»i duyá»‡t</span><strong>{quote.approvedById ? nameFor(quote.approvedById) : 'ChÆ°a duyá»‡t'}</strong></div>
                          <div><span className="qc-workspace-info-label">NgÃ y duyá»‡t</span><strong>{quote.approvedAt ? formatDate(quote.approvedAt) : 'â€”'}</strong></div>
                        </div>
                        {missingLinks.length > 0 ? (
                          <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                            <strong>ThÃ´ng tin liÃªn káº¿t chÆ°a Ä‘áº§y Ä‘á»§</strong>
                            <ul>{missingLinks.map(m => <li key={m}>{m}</li>)}</ul>
                            <p>PhiÃªn báº£n Ä‘Ã£ duyá»‡t nÃªn khÃ´ng thá»ƒ sá»­a trá»±c tiáº¿p. Táº¡o phiÃªn báº£n má»›i Ä‘á»ƒ bá»• sung thÃ´ng tin.</p>
                          </div>
                        ) : null}
                      </div>

                      {/* Card "Háº¡ng má»¥c & giÃ¡ khÃ¡ch" (QuoteDocumentRenderer
                       * rut gon) DA BO - yeu cau ro rang "XÃ“A NÃ€Y á»ž BÆ¯á»šC 3
                       * ÄI": trung lap 100% voi bang "Háº¡ng má»¥c & cáº¥u trÃºc
                       * giÃ¡" that (interactive, ngay ben duoi) - quote da
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
                  <h3>Háº¡ng má»¥c &amp; cáº¥u trÃºc giÃ¡ <span className="qc-required-mark">*</span></h3>
                  <span className="qc-row-sub">
                    {canEditCostCells && !canEditPricingCells
                      ? 'Báº¡n sá»­a Ä‘Æ°á»£c GiÃ¡ vá»‘n Â· GiÃ¡ bÃ¡n do Sale phá»¥ trÃ¡ch nháº­p'
                      : canEditPricingCells && !canEditCostCells
                      ? 'Báº¡n sá»­a Ä‘Æ°á»£c GiÃ¡ bÃ¡n Â· GiÃ¡ vá»‘n do Presale phá»¥ trÃ¡ch nháº­p (khoÃ¡)'
                      : canEditCostCells && canEditPricingCells
                      ? 'Báº¡n sá»­a Ä‘Æ°á»£c cáº£ GiÃ¡ vá»‘n vÃ  GiÃ¡ bÃ¡n'
                      : 'Chá»‰ xem â€” khÃ´ng cÃ³ quyá»n sá»­a háº¡ng má»¥c nÃ y'}
                  </span>
                </div>
                {/* "markup /margin cho 1 dÃ²ng vá»›i háº¡ng má»¥c di" - yeu cau rieng
                 * dat thanh Markup nhanh/Margin muc tieu CUNG 1 hang voi
                 * tieu de "Háº¡ng má»¥c & cáº¥u trÃºc giÃ¡" (thay vi 1 hang rieng
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
                        Tuá»³ chá»‰nh
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
                        title="Ãp Markup tuá»³ chá»‰nh cho toÃ n bá»™ háº¡ng má»¥c cÃ³ giÃ¡ vá»‘n há»£p lá»‡"
                        onClick={() => applyQuickMarkup(Number(markupCustomInput))}
                      >
                        Ãp dá»¥ng
                      </button>
                    </div>
                    <span className="qc-workspace-quickbar-sep" aria-hidden="true" />
                    <div className="qc-pricing-group">
                      <span className="qc-workspace-info-label qc-qb-row-label">Margin má»¥c tiÃªu</span>
                      {[30].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          className={`qc-mini-btn${lastAppliedMarginPct === pct ? ' qc-mini-btn-active' : ''}`}
                          disabled={busy}
                          title="Ãp ngay cho toÃ n bá»™ háº¡ng má»¥c cÃ³ giÃ¡ vá»‘n há»£p lá»‡"
                          onClick={() => applyTargetMargin(pct)}
                        >
                          {pct}%
                        </button>
                      ))}
                      <label className="qc-workspace-quickbar-field">
                        Tuá»³ chá»‰nh
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
                        title="Ãp Margin tuá»³ chá»‰nh cho toÃ n bá»™ háº¡ng má»¥c cÃ³ giÃ¡ vá»‘n há»£p lá»‡"
                        onClick={() => applyTargetMargin(Number(marginCustomInput))}
                      >
                        Ãp dá»¥ng
                      </button>
                    </div>
                    <span className="qc-qb-margin-hint" title="NgÆ°á»¡ng tham chiáº¿u, khÃ´ng tá»± Ä‘á»™ng cháº·n">NgÆ°á»¡ng margin tham chiáº¿u: 20%</span>
                </div>
                ) : null}
                <button
                  type="button"
                  className="qc-mini-btn qc-workspace-items-fullscreen-btn"
                  onClick={() => setItemsFullscreen(value => !value)}
                  title={itemsFullscreen ? 'Thu nhá» báº£ng háº¡ng má»¥c' : 'PhÃ³ng to báº£ng háº¡ng má»¥c'}
                  aria-label={itemsFullscreen ? 'Thu nhá» báº£ng háº¡ng má»¥c' : 'PhÃ³ng to báº£ng háº¡ng má»¥c'}
                >
                  {itemsFullscreen ? <Minimize2 className="qc-inline-icon" /> : <Maximize2 className="qc-inline-icon" />}
                  <span>{itemsFullscreen ? 'Thu nhá»' : 'PhÃ³ng to'}</span>
                </button>
                {canEdit && isDraft && !isLockedForReview && selectedDiscountCount > 0 ? (
                  <button
                    type="button"
                    className="qc-mini-btn qc-mini-btn-danger"
                    onClick={removeSelectedItemRows}
                    title={`XÃ³a ${selectedDiscountCount} háº¡ng má»¥c Ä‘Ã£ chá»n`}
                  >
                    <Trash2 className="qc-inline-icon" />
                    <span>XÃ³a {selectedDiscountCount} háº¡ng má»¥c</span>
                  </button>
                ) : null}
              </div>
              {requiredFieldErrors.items ? <p className="qc-field-error qc-field-error--card">{requiredFieldErrors.items}</p> : null}

              {canEditCostCells && isDraft && itemsDraft.length > 0 && itemsMissingCost.length > 0 ? (
                <div className="qc-workspace-warning-banner">
                  CÃ²n {itemsMissingCost.length}/{itemsDraft.length} háº¡ng má»¥c chÆ°a nháº­p giÃ¡ vá»‘n hoáº·c chÆ°a Ä‘Ã¡nh dáº¥u &quot;KhÃ´ng Ã¡p dá»¥ng giÃ¡ vá»‘n&quot; â€” cáº§n bá»• sung trÆ°á»›c khi bÃ n giao.
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
                   * 2 nut icon +/â‹® trong Thao tac) co kich thuoc PIXEL toi
                   * thieu lon hon % da phan, khien ca hang vuot qua container
                   * - .qc-workspace-items-scroll dang overflow-x:hidden nen
                   * PHAN VUOT bi cat mat thay vi cuon, dung ngay cot cuoi
                   * (Margin/Thao tac). Dung <colgroup> voi PX CO DINH cho moi
                   * cot hep/co dinh (DVT/SL/Gia von/Cost tong/Markup/Gia
                   * khach/Thanh tien/Margin/Thao tac) + de rieng "Háº¡ng má»¥c"
                   * KHONG khai bao width - day la cach table-layout:fixed
                   * tin cay nhat (dung chuan CSS: cot khong khai bao width se
                   * tu chia het phan con lai), khong con phu thuoc content
                   * "vua khit" % duoc gan tren th/td nua. */}
                  <colgroup>
                    <col />
                    <col style={{ width: '92px' }} />
                    <col style={{ width: '64px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '96px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '82px' }} />
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
                              title="Chá»n táº¥t cáº£ háº¡ng má»¥c"
                              aria-label="Chá»n táº¥t cáº£ háº¡ng má»¥c"
                              onChange={event => toggleAllItemSelection(event.target.checked)}
                            />
                          ) : null}
                          <span>Háº¡ng má»¥c</span>
                        </span>
                      </th>
                      <th className="qc-th-unit">ÄVT</th>
                      <th className="qc-th-money qc-th-qty">SL</th>
                      <th className="qc-th-money qc-th-cost">GiÃ¡ vá»‘n/ÄV</th>
                      <th className="qc-th-money qc-th-cost">Cost tá»•ng</th>
                      <th className="qc-th-money qc-th-markup">Markup</th>
                      <th className="qc-th-money qc-th-markup">GiÃ¡ khÃ¡ch/ÄV</th>
                      <th className="qc-th-money qc-th-total">ThÃ nh tiá»n</th>
                      <th className="qc-th-money qc-th-margin-col">Margin</th>
                      {canEdit && isDraft && !isLockedForReview ? <th className="qc-th-actions qc-cell-actions--menu" aria-label="Thao tÃ¡c" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {itemsDraft.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="qc-empty qc-workspace-items-empty-cell">
                          {/* CHOT LAI (yeu cau moi nhat "Tráº£ cÃ¡c nÃºt thÃªm háº¡ng
                           * má»¥c xuá»‘ng dÆ°á»›i báº£ng"): 3 nut Chá»n tá»« danh má»¥c/
                           * ThÃªm háº¡ng má»¥c/+ Má»¥c cha da chuyen XUONG DUOI bang
                           * (xem .qc-workspace-add-row ngay sau </table>),
                           * KHONG con nam tren header khoi nua - o day CHI
                           * giu rieng "Náº¡p tá»« bÃ¡o giÃ¡ gáº§n nháº¥t" (dac thu cho
                           * trang thai rong, khong nam trong bo 3 nut chuan). */}
                          <div className="qc-workspace-items-empty">
                            <span>ChÆ°a cÃ³ háº¡ng má»¥c nÃ o.</span>
                            {canEdit && isDraft && !isLockedForReview && recentDealQuote ? (
                              <div className="qc-workspace-items-empty-actions">
                                <button type="button" className="qc-mini-btn" onClick={loadFromRecentQuote}>
                                  Náº¡p tá»« bÃ¡o giÃ¡ gáº§n nháº¥t ({recentDealQuote.quoteNumber})
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
                        return itemsDraft.map((item, index) => {
                          if (item.rowType === 'section') {
                            sectionCounter += 1;
                            const roman = toRomanNumeral(sectionCounter);
                            return (
                              <tr
                                key={item.id || index}
                                className="qc-workspace-section-row"
                                draggable={canDragRows}
                                onDragStart={() => handleRowDragStart(index)}
                                onDragOver={canDragRows ? event => event.preventDefault() : undefined}
                                onDrop={canDragRows ? () => handleRowDrop(index, true) : undefined}
                              >
                                {/* Nine data columns, plus the separate action cell when editable. */}
                                <td colSpan={9}>
                                  {canDragRows ? <span className="qc-workspace-drag-handle" title="KÃ©o Ä‘á»ƒ sáº¯p xáº¿p">â ¿</span> : null}
                                  {/* Roman numeral (I/II/III...) dat TRUOC ten muc (ben trai) thay vi
                                   * sau nhu cu - o kich thuoc nho, badge "I" dat SAU chu de bi doc
                                   * nham thanh dau "!" (theo dung phan anh "I la mÃ£ náº±m khÃºc bÃªn
                                   * trÃ¡i Ä‘áº§u trc chá»¯ háº¡ Ã¡"). */}
                                  <span className="qc-workspace-section-roman">{roman}</span>
                                  {canEdit && isDraft && !isLockedForReview ? (
                                    <input
                                      className="qc-cell-input qc-workspace-section-input"
                                      value={stripLeadingRomanPrefix(item.description || '', roman)}
                                      onChange={e => updateRow(index, { description: e.target.value })}
                                      onBlur={() => void persistQuote({}, { silent: true })}
                                      placeholder="TÃªn má»¥c cha"
                                    />
                                  ) : (
                                    <strong>{stripLeadingRomanPrefix(item.description || '', roman) || 'Má»¥c má»›i'}</strong>
                                  )}
                                  {/* Yeu cau moi nhat: Muc cha KHONG con nut them nao
                                   * ca - 2 icon "+"/"danh má»¥c" chuyen het xuong
                                   * TUNG dong hang muc con (cot Thao tac) thay vi
                                   * dat rieng tren hang Muc cha. */}
                                </td>
                                {canEdit && isDraft && !isLockedForReview ? (
                                  <td className="qc-cell-actions qc-cell-actions--menu">
                                    <ActionMenu
                                      label="Thao tÃ¡c má»¥c cha"
                                      items={[
                                        { key: 'up', label: 'Di chuyá»ƒn lÃªn', icon: ChevronUp, onSelect: () => moveRowUpDown(index, -1), group: 1 },
                                        { key: 'down', label: 'Di chuyá»ƒn xuá»‘ng', icon: ChevronDown, onSelect: () => moveRowUpDown(index, 1), group: 1 },
                                        { key: 'delete', label: 'XoÃ¡ má»¥c cha (vÃ  toÃ n bá»™ háº¡ng má»¥c con)', icon: Trash2, danger: true, onSelect: () => removeItemRow(index), group: 2 },
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
                            <td data-label="Háº¡ng má»¥c">
                              <span className="qc-workspace-item-name-cell">
                                <span className="qc-workspace-item-no-col">
                                  {canDragRows ? <span className="qc-workspace-drag-handle" title="KÃ©o Ä‘á»ƒ sáº¯p xáº¿p">â ¿</span> : null}
                                  {canEditPricingCells && isDraft && !isLockedForReview ? (
                                    <input
                                      type="checkbox"
                                      className="qc-workspace-item-select"
                                      checked={discountSelected}
                                      title="Chá»n háº¡ng má»¥c"
                                      aria-label="Chá»n háº¡ng má»¥c"
                                      onChange={event => toggleDiscountRowSelection(discountKey, event.target.checked)}
                                    />
                                  ) : null}
                                  <span className="qc-workspace-item-no">{displayNo}</span>
                                </span>
                                <span className="qc-workspace-item-name-col">
                                  {(editableTechnicalCells || editableCells) ? (
                                    <textarea
                                      className="qc-cell-input qc-cell-textarea"
                                      rows={2}
                                      value={item.serviceDescription || ''}
                                      onChange={e => updateRow(index, { serviceDescription: e.target.value })}
                                      onBlur={() => void persistQuote({}, { silent: true })}
                                      placeholder="TÃªn háº¡ng má»¥c"
                                      title={[item.serviceDescription, item.description].filter(Boolean).join(' â€” ') || ''}
                                    />
                                  ) : (
                                    <span
                                      className="qc-workspace-item-name-clamp qc-workspace-item-name-clickable"
                                      title={[item.serviceDescription, item.description].filter(Boolean).join(' â€” ') || ''}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot(deepClone(item)); }}
                                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot(deepClone(item)); } }}
                                    >
                                      {item.serviceDescription || 'â€”'}
                                    </span>
                                  )}
                                  {/* "Nháº­n biáº¿t háº¡ng má»¥c Ä‘Ã£ cÃ³ trong Sáº£n pháº©m
                                   * & dá»‹ch vá»¥" - xac dinh bang catalogItemId/
                                   * priceBookItemId THAT (ID lien ket that,
                                   * KHONG so sanh theo ten). */}
                                  {/* BUG THAT DA GAP ("BÆ°á»›c 3 chÆ°a hiá»ƒn thá»‹
                                   * tráº¡ng thÃ¡i liÃªn káº¿t"): nhanh "chua lien
                                   * ket" TRUOC DAY chi render khi
                                   * canEdit && isDraft && !isLockedForReview -
                                   * an HAN icon (khong phai disable) o Buoc 3/
                                   * quote da khoa, sai yeu cau "KhÃ´ng Ä‘Æ°á»£c áº©n
                                   * icon chá»‰ vÃ¬ báº£ng Ä‘ang read-only". Dung 1
                                   * nhanh render CHUNG cho MOI buoc: co the
                                   * SUA (dau + bam duoc, mo QuickAddProductModal)
                                   * hay CHI XEM/da khoa (dau + mau xam, bam
                                   * vao chi hien thong bao huong dan tao
                                   * phien ban moi, KHONG mo form sua/KHONG
                                   * ghi de catalogItemId len version da khoa). */}
                                  {item.catalogItemId || item.priceBookItemId ? (
                                    <span
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--linked"
                                      title="ÄÃ£ cÃ³ trong Sáº£n pháº©m & dá»‹ch vá»¥"
                                      aria-label="ÄÃ£ cÃ³ trong Sáº£n pháº©m & dá»‹ch vá»¥"
                                    >
                                      <CheckCircle2 className="qc-inline-icon" />
                                    </span>
                                  ) : canEdit && isDraft && !isLockedForReview ? (
                                    <button
                                      type="button"
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--unlinked"
                                      title="ThÃªm vÃ o Sáº£n pháº©m & dá»‹ch vá»¥"
                                      aria-label="ThÃªm vÃ o Sáº£n pháº©m & dá»‹ch vá»¥"
                                      onClick={() => openQuickAddForRow(index)}
                                    >
                                      <Plus className="qc-inline-icon" />
                                    </button>
                                  ) : (
                                    // "k cáº§n táº¡o phiÃªn báº£n má»›i bro" - bao giÃ¡
                                    // da khoa VAN cho tao san pham vao "Sáº£n
                                    // pháº©m & dá»‹ch vá»¥" binh thuong (mo thang
                                    // QuickAddProductModal, khong con bat qua
                                    // luong "Táº¡o phiÃªn báº£n má»›i" nua) - CHI
                                    // khac 1 diem duy nhat: KHONG ghi
                                    // catalogItemId nguoc lai dong hang muc
                                    // cua version da khoa (xem
                                    // handleQuickAddProductCreated, nhanh
                                    // `locked`), giu bat bien du lieu quote
                                    // da duyet.
                                    <button
                                      type="button"
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--unlinked qc-workspace-item-link-badge--locked"
                                      title="ThÃªm vÃ o Sáº£n pháº©m & dá»‹ch vá»¥ (bÃ¡o giÃ¡ Ä‘Ã£ khoÃ¡ nÃªn sáº½ khÃ´ng liÃªn káº¿t vÃ o háº¡ng má»¥c nÃ y)"
                                      aria-label="ThÃªm vÃ o Sáº£n pháº©m & dá»‹ch vá»¥"
                                      onClick={() => openQuickAddForRow(index, true)}
                                    >
                                      <Plus className="qc-inline-icon" />
                                    </button>
                                  )}
                                  {/* "Chá»‰nh MÃ´ táº£ háº¡ng má»¥c" - icon RIENG, KHONG
                                   * them cot vao bang (yeu cau ro rang). Trang
                                   * thai icon khac han khi DA CO mo ta (dam,
                                   * to mau) vs CHUA CO (nhat) de de nhan biet -
                                   * bam mo popover ca 2 truong hop, CHI khac o
                                   * quyen sua (readOnly khi khoa/Buoc 3). */}
                                  <button
                                    type="button"
                                    className={`qc-workspace-item-desc-btn${item.description ? ' qc-workspace-item-desc-btn--filled' : ''}`}
                                    title="Chá»‰nh sá»­a mÃ´ táº£ háº¡ng má»¥c"
                                    aria-label="Chá»‰nh sá»­a mÃ´ táº£ háº¡ng má»¥c"
                                    onClick={() => openDescriptionPopover(index)}
                                  >
                                    <FileText className="qc-inline-icon" />
                                  </button>
                                  {canEdit && isDraft && !isLockedForReview ? (
                                    <span className="qc-workspace-item-quick-add">
                                      <button
                                        type="button"
                                        className="qc-mini-btn-icon qc-workspace-item-quick-add-btn"
                                        title="ThÃªm háº¡ng má»¥c trá»‘ng ngay sau dÃ²ng nÃ y"
                                        aria-label="ThÃªm háº¡ng má»¥c trá»‘ng ngay sau dÃ²ng nÃ y"
                                        onClick={() => addBlankItemAfterIndex(index)}
                                      >
                                        <Plus className="qc-inline-icon" />
                                      </button>
                                      <button
                                        type="button"
                                        className="qc-mini-btn-icon qc-workspace-item-quick-add-btn"
                                        title="Chá»n tá»« danh má»¥c, chÃ¨n ngay sau dÃ²ng nÃ y"
                                        aria-label="Chá»n tá»« danh má»¥c, chÃ¨n ngay sau dÃ²ng nÃ y"
                                        onClick={() => void openCatalogPicker({ afterIndex: index })}
                                      >
                                        <LayoutGrid className="qc-inline-icon" />
                                      </button>
                                    </span>
                                  ) : null}
                                  {isBundleRow ? (
                                    <span className="qc-bundle-pricing-mode">
                                      <span className={`qc-bundle-pricing-chip qc-bundle-pricing-chip--${bundleMode}`}>
                                        {bundleMode === 'auto' ? `Tá»± tÃ­nh theo GM ${formatPercentTrim(bundleTargetGm)}` : 'Giá»¯ giÃ¡ gÃ³i cá»‘ Ä‘á»‹nh'}
                                      </span>
                                      {canEdit && isDraft && !isLockedForReview && editableCells ? (
                                        <button
                                          type="button"
                                          className="qc-bundle-pricing-toggle"
                                          onClick={() => toggleBundleAutoPricing(index, bundleMode !== 'auto')}
                                          title={bundleMode === 'auto' ? 'Táº¯t tá»± tÃ­nh giÃ¡ gÃ³i, giá»¯ giÃ¡ Combo hiá»‡n táº¡i' : 'Báº­t tá»± tÃ­nh giÃ¡ gÃ³i theo cost vÃ  Markup'}
                                        >
                                          {bundleMode === 'auto' ? 'Táº¯t tá»± tÃ­nh' : 'Tá»± tÃ­nh giÃ¡ gÃ³i'}
                                        </button>
                                      ) : null}
                                    </span>
                                  ) : null}
                                  {(item.discountPercent ?? 0) > 0 ? (
                                    <span className="qc-line-discount-chip">CK dÃ²ng {formatPercentTrim(item.discountPercent)}</span>
                                  ) : null}
                                </span>
                              </span>
                            </td>
                            <td className="qc-cell-unit" data-label="ÄVT">
                              {editableTechnicalCells ? (
                                <input
                                  className="qc-cell-input"
                                  value={item.unit || ''}
                                  onChange={e => updateRow(index, { unit: e.target.value })}
                                  onBlur={() => void persistQuote({}, { silent: true })}
                                  placeholder="GÃ³i, ThÃ¡ng..."
                                />
                              ) : (
                                item.unit || 'â€”'
                              )}
                            </td>
                            <td className="qc-cell-money qc-cell-qty" data-label="SL">
                              {editableTechnicalCells ? (
                                <input type="number" className="qc-cell-input qc-cell-input-money" value={item.quantity} onChange={e => updateRow(index, { quantity: Math.max(0, Number(e.target.value) || 0) })} onBlur={() => void persistQuote({}, { silent: true })} />
                              ) : item.quantity}
                            </td>
                            <td className={`qc-cell-money qc-cell-cost ${!item.costNotApplicable && item.costPrice == null ? 'qc-cell-cost-missing' : ''}`} data-label="GiÃ¡ vá»‘n/ÄV" title={!editableTechnicalCells && costViewAllowed ? 'Presale Ä‘Ã£ chá»‘t â€” chá»‰ Ä‘á»c' : undefined}>
                              {/* BUG THAT DA GAP ("mÅ©i tÃªn xuá»‘ng dÃ²ng riÃªng
                               * bÃªn dÆ°á»›i sá»‘ tiá»n"): gia tri + icon "Äiá»n
                               * xuá»‘ng" truoc day la 2 phan tu ANH XA rieng le
                               * (input width:100% chiem het dong, hoac chu
                               * dai vua khit) nen KHONG con cho cho icon tren
                               * CUNG 1 dong, buoc phai xuong dong rieng. Boc
                               * chung 1 flex row - LUON giu icon nam ngang
                               * ben phai gia tri, khong con xuong dong. */}
                              <span className="qc-cell-value-row">
                                <span className="qc-cell-value-row-main">
                                  {!costViewAllowed ? (
                                    <span className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem</span>
                                  ) : editableTechnicalCells ? (
                                    <CurrencyInput
                                      className="qc-cell-input qc-cell-input-money"
                                      value={item.costPrice ?? null}
                                      placeholder={item.costNotApplicable ? 'KhÃ´ng Ã¡p dá»¥ng' : 'Báº¯t buá»™c nháº­p'}
                                      disabled={item.costNotApplicable}
                                      onChange={value => handleCostPriceChange(index, value)}
                                      onBlur={handleCostPriceBlur}
                                    />
                                  ) : (
                                    (item.costNotApplicable ? 'KhÃ´ng Ã¡p dá»¥ng' : item.costPrice != null ? formatMoney(item.costPrice) : 'CÃ²n thiáº¿u')
                                  )}
                                </span>
                                {renderFillDownIcon(index, 'costPrice')}
                              </span>
                            </td>
                            <td className="qc-cell-money qc-cell-cost" data-label="Cost tá»•ng">
                              {!costViewAllowed ? <span className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem</span> : item.costNotApplicable ? 'â€”' : costTotal != null ? formatMoney(costTotal) : 'â€”'}
                            </td>
                            <td className="qc-cell-money qc-cell-markup" data-label="Markup">
                              <span className="qc-cell-value-row">
                                <span className="qc-cell-value-row-main">
                                  {!pricingViewAllowed ? (
                                    <span className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem</span>
                                  ) : editableCells ? (
                                    <input type="number" step="0.01" className="qc-cell-input qc-cell-input-money" value={item.markupPercent != null ? Number(item.markupPercent.toFixed(2)) : ''} placeholder="â€”" disabled={item.costPrice == null} onChange={e => handleMarkupChange(index, e.target.value)} onBlur={() => void persistQuote({}, { silent: true })} />
                                  ) : formatPercentFixed2(item.markupPercent)}
                                </span>
                                {renderFillDownIcon(index, 'markupPercent')}
                              </span>
                            </td>
                            <td className="qc-cell-money qc-cell-markup" data-label="GiÃ¡ khÃ¡ch/ÄV">
                              {editableCells ? (
                                <CurrencyInput
                                  className="qc-cell-input qc-cell-input-money"
                                  value={item.unitPrice ?? null}
                                  onChange={value => handleUnitPriceChange(index, value)}
                                  onBlur={() => void persistQuote({}, { silent: true })}
                                />
                              ) : formatMoney(item.unitPrice ?? 0)}
                            </td>
                            <td className="qc-cell-money" data-label="ThÃ nh tiá»n">{formatMoney(item.totalAmount || item.quantity * (item.unitPrice ?? 0) || 0)}</td>
                            <td className={`qc-cell-money qc-th-margin-col ${margin != null && margin >= 20 ? 'qc-cell-margin-good' : margin != null ? 'qc-cell-margin-warn' : ''}`} style={{ position: 'relative' }} data-label="Margin">
                              {!profitabilityViewAllowed ? <span className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem</span> : formatPercentFixed2(margin)}
                            </td>
                            {canEdit && isDraft && !isLockedForReview ? (
                              <td className="qc-cell-actions qc-cell-actions--menu" data-label="Thao tÃ¡c">
                                {/* BUG THAT DA GAP: 2 icon nhanh rieng (Plus/LayoutGrid)
                                 * dat canh nut "â‹®" trong 1 cot rat hep gay CHONG
                                 * LAN/vo layout that su tren man hinh (ket hop voi
                                 * ActionMenu tu quan ly vi tri trigger cua no) -
                                 * BO HAN 2 icon rieng, CHI con dung 1 nut "â‹®" duy
                                 * nhat, on dinh - 2 hanh dong "ThÃªm háº¡ng má»¥c trá»‘ng"/
                                 * "Chá»n tá»« danh má»¥c" van du dung qua menu chu (2
                                 * muc dau tien ben duoi), dung cho ca desktop lan
                                 * mobile (mobile von di khong co hover that su nen
                                 * cung se can menu chu, khong mat chuc nang gi). */}
                                <ActionMenu
                                  label="Thao tÃ¡c háº¡ng má»¥c"
                                  items={[
                                    { key: 'add-blank', label: 'ThÃªm háº¡ng má»¥c trá»‘ng', icon: Plus, onSelect: () => addBlankItemAfterIndex(index), group: 1 },
                                    { key: 'add-catalog', label: 'Chá»n tá»« danh má»¥c', icon: LayoutGrid, onSelect: () => void openCatalogPicker({ afterIndex: index }), group: 1 },
                                    { key: 'detail', label: 'Xem chi tiáº¿t háº¡ng má»¥c', onSelect: () => { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot(deepClone(item)); } },
                                    ...(item.priceBookItemId
                                      ? [{ key: 'price-detail', label: 'Chi tiáº¿t giÃ¡ vá»‘n/EU/VAT', onSelect: () => setPriceBookDrawerIndex(index) }]
                                      : []),
                                    // Mobile/man hinh hep an het icon "Äiá»n xuá»‘ng" ngay tai o
                                    // (xem @media 767px o quote-center.css) - giu du 2 pham vi
                                    // (empty/all) qua menu chu o day, dong bo voi popover desktop.
                                    ...(item.costPrice != null && fillDownTargets(index).length > 0
                                      ? [
                                          { key: 'fill-down-cost-empty', label: `Äiá»n GiÃ¡ vá»‘n xuá»‘ng dÃ²ng trá»‘ng (${fillDownEmptyTargets(index, 'costPrice').length})`, onSelect: () => fillDownWithMode(index, 'costPrice', 'empty') },
                                          { key: 'fill-down-cost-all', label: `Äiá»n GiÃ¡ vá»‘n xuá»‘ng toÃ n bá»™ (${fillDownTargets(index).length})`, onSelect: () => fillDownWithMode(index, 'costPrice', 'all') },
                                        ]
                                      : []),
                                    ...(item.markupPercent != null && fillDownTargets(index).length > 0
                                      ? [
                                          { key: 'fill-down-markup-empty', label: `Äiá»n Markup xuá»‘ng dÃ²ng trá»‘ng (${fillDownEmptyTargets(index, 'markupPercent').length})`, onSelect: () => fillDownWithMode(index, 'markupPercent', 'empty') },
                                          { key: 'fill-down-markup-all', label: `Äiá»n Markup xuá»‘ng toÃ n bá»™ (${fillDownTargets(index).length})`, onSelect: () => fillDownWithMode(index, 'markupPercent', 'all') },
                                        ]
                                      : []),
                                    { key: 'up', label: 'Di chuyá»ƒn lÃªn', icon: ChevronUp, onSelect: () => moveRowUpDown(index, -1), group: 2 },
                                    { key: 'down', label: 'Di chuyá»ƒn xuá»‘ng', icon: ChevronDown, onSelect: () => moveRowUpDown(index, 1), group: 2 },
                                    { key: 'duplicate', label: 'NhÃ¢n báº£n háº¡ng má»¥c', onSelect: () => duplicateItemRow(index), group: 2 },
                                    { key: 'delete', label: 'XoÃ¡ háº¡ng má»¥c', icon: Trash2, danger: true, onSelect: () => removeItemRow(index), group: 3 },
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
                                    <td data-label="Háº¡ng má»¥c">
                                      <span className="qc-workspace-item-name-cell">
                                        <span className="qc-workspace-item-no-col" />
                                        <span className="qc-workspace-item-name-col">
                                          <span className="qc-workspace-item-name-clamp" title={[child.serviceDescription, child.description].filter(Boolean).join(' â€” ') || ''}>
                                            {child.serviceDescription || 'â€”'}
                                          </span>
                                        </span>
                                      </span>
                                    </td>
                                    <td className="qc-cell-unit" data-label="ÄVT">{child.unit || 'â€”'}</td>
                                    <td className="qc-cell-money qc-cell-qty" data-label="SL">{child.quantity || 'â€”'}</td>
                                    <td className="qc-cell-money qc-cell-cost" data-label="GiÃ¡ vá»‘n/ÄV">
                                      {!costViewAllowed ? (
                                        <span className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem</span>
                                      ) : editableTechnicalCells ? (
                                        <span className="qc-bundle-child-edit">
                                          <CurrencyInput
                                            className="qc-cell-input qc-cell-input-money"
                                            value={child.costPrice ?? null}
                                            placeholder="ChÆ°a cÃ³ giÃ¡"
                                            onChange={value => setBundleComponentCost(index, child.__bundleComponentIds || [], value)}
                                          />
                                          {child.costPrice == null && child.__bundleCanDeriveCost ? (
                                            <button type="button" className="qc-bundle-child-inline-action" onClick={() => deriveBundleComponentCost(index, child.__bundleComponentIds || [])}>
                                              Tá»± tÃ­nh
                                            </button>
                                          ) : null}
                                        </span>
                                      ) : child.costPrice != null ? formatMoney(child.costPrice) : 'ChÆ°a cÃ³ giÃ¡'}
                                    </td>
                                    <td className="qc-cell-money qc-cell-cost" data-label="Cost tá»•ng">
                                      {!costViewAllowed ? <span className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem</span> : childCostTotal != null ? formatMoney(childCostTotal) : 'â€”'}
                                    </td>
                                    <td className="qc-cell-money qc-cell-markup" data-label="Markup">{formatPercentFixed2(child.markupPercent)}</td>
                                    <td className="qc-cell-money qc-cell-markup" data-label="GiÃ¡ khÃ¡ch/ÄV">
                                      {!pricingViewAllowed ? (
                                        <span className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem</span>
                                      ) : editableCells ? (
                                        <CurrencyInput
                                          className="qc-cell-input qc-cell-input-money"
                                          value={child.unitPrice ?? null}
                                          onChange={value => setBundleComponentPrice(index, child.__bundleComponentIds || [], value)}
                                        />
                                      ) : child.unitPrice ? formatMoney(child.unitPrice) : 'â€”'}
                                    </td>
                                    <td className="qc-cell-money" data-label="ThÃ nh tiá»n">{childTotal ? formatMoney(childTotal) : 'â€”'}</td>
                                    <td className={`qc-cell-money qc-th-margin-col ${childMargin != null && childMargin >= 20 ? 'qc-cell-margin-good' : childMargin != null ? 'qc-cell-margin-warn' : ''}`} data-label="Margin">
                                      {formatPercentFixed2(childMargin)}
                                    </td>
                                    {canEdit && isDraft && !isLockedForReview ? (
                                      <td className="qc-cell-actions qc-cell-actions--menu" data-label="Thao tÃ¡c">
                                        <button
                                          type="button"
                                          className="qc-mini-btn-icon qc-bundle-child-remove-btn"
                                          disabled={child.__bundleRequired}
                                          title={child.__bundleRequired ? 'ÄÃ¢y lÃ  thÃ nh pháº§n báº¯t buá»™c cá»§a gÃ³i.' : 'XoÃ¡ khá»i gÃ³i Combo nÃ y'}
                                          aria-label="XoÃ¡ khá»i gÃ³i Combo"
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
                  <button type="button" className="qc-mini-btn" onClick={() => void openCatalogPicker()}>Chá»n tá»« danh má»¥c</button>
                  <button type="button" className="qc-mini-btn" onClick={addItemRow}>ThÃªm háº¡ng má»¥c</button>
                  <button type="button" className="qc-mini-btn" onClick={addSectionRow}>+ Má»¥c cha</button>
                </div>
              ) : null}
              {fillDownUndo ? (
                <div className="qc-workspace-note-box qc-workspace-autofill-undo-box">
                  <span>{fillDownUndo.message}</span>
                  <button type="button" className="qc-mini-btn" onClick={undoFillDown}>HoÃ n tÃ¡c</button>
                </div>
              ) : null}
              <div className="qc-workspace-totals">
                <div>
                  <span className="qc-workspace-info-label">Tá»•ng giÃ¡ vá»‘n</span>
                  <strong>{!costViewAllowed ? 'KhÃ´ng cÃ³ quyá»n xem' : summaryHasCostData ? formatMoney(summaryCostTotal) : 'ChÆ°a cÃ³ dá»¯ liá»‡u giÃ¡ vá»‘n'}</strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">GiÃ¡ khÃ¡ch sau CK</span>
                  <strong>{formatMoney(summaryTotalAmount)}</strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Lá»£i nhuáº­n gá»™p</span>
                  <strong className={summaryHasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                    {!profitabilityViewAllowed ? 'KhÃ´ng cÃ³ quyá»n xem' : summaryHasCostData && summaryGrossProfit != null ? formatMoney(summaryGrossProfit) : 'ChÆ°a cÃ³ dá»¯ liá»‡u'}
                  </strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Gross margin</span>
                  <strong className={summaryHasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                    {!profitabilityViewAllowed ? 'KhÃ´ng cÃ³ quyá»n xem' : summaryHasCostData && summaryGrossMarginPercent != null ? formatPercentTrim(summaryGrossMarginPercent) : 'ChÆ°a cÃ³ dá»¯ liá»‡u'}
                  </strong>
                </div>
                {profitabilityViewAllowed && summaryHasCostData && summaryCostTotal > 0 && summaryRatePercent != null ? (
                  <div>
                    <span className="qc-workspace-info-label">Rate tá»•ng</span>
                    <strong>{formatPercentTrim(summaryRatePercent)}</strong>
                  </div>
                ) : null}
                <div>
                  {/* Sua o "Chiáº¿t kháº¥u tá»•ng" tren quickbar (canh Markup nhanh) -
                   * day chi con la HIEN THI (khong sua thang o day nua), tranh
                   * 2 o edit cung 1 field gay hieu nham co 2 co che rieng. */}
                  <span className="qc-workspace-info-label">Giáº£m giÃ¡ toÃ n bÃ¡o giÃ¡ (%)</span>
                  <strong>{summaryOverallDiscountPercent != null ? `${summaryOverallDiscountPercent}%` : 'KhÃ´ng giáº£m'}</strong>
                </div>
                {profitabilityViewAllowed && summaryOverallDiscountPercent != null ? (() => {
                  const amountAfterDiscount = summaryTotalAmount;
                  const marginAfterDiscount = summaryGrossMarginPercent;
                  return (
                    <>
                      <div>
                        <span className="qc-workspace-info-label">GiÃ¡ sau giáº£m</span>
                        <strong>{formatMoney(amountAfterDiscount)}</strong>
                      </div>
                      <div>
                        <span className="qc-workspace-info-label">Margin sau giáº£m</span>
                        <strong className={marginAfterDiscount != null && marginAfterDiscount >= 0 ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                          {marginAfterDiscount != null ? `${marginAfterDiscount.toFixed(2)}%` : 'ChÆ°a cÃ³ dá»¯ liá»‡u'}
                        </strong>
                      </div>
                    </>
                  );
                })() : null}
              </div>

              {/* Chiáº¿t kháº¥u tá»•ng/Thanh toÃ¡n/+ Äiá»u khoáº£n - CHUYEN xuong NGAY
               * SAU tong tien (yeu cau rieng "cho ck tá»•ng thanh toÃ¡n vá»›i dk
               * náº±m trÃªn chá»— Chuáº©n bá»‹ hoÃ n táº¥t giÃ¡ bÃ¡n, sau tá»•ng Ã¡") - thay
               * vi nam TRUOC bang/tong nhu truoc do. Giu nguyen 100% state/
               * handler cu (overallDiscountPercent, paymentTermsDays,
               * termNotePopoverOpen...), chi doi vi tri render. */}
              {canEditPricingCells && isDraft ? (
                <div className="qc-workspace-commercial-row">
                  <div className="qc-item-discount-tools" title="Ãp chiáº¿t kháº¥u cho tá»«ng háº¡ng má»¥c tháº­t; thÃ nh pháº§n con cá»§a Combo chá»‰ Ä‘á»ƒ hiá»ƒn thá»‹ nÃªn khÃ´ng bá»‹ tÃ­nh láº§n 2.">
                    <span className="qc-workspace-quickbar-field">
                      Chiáº¿t kháº¥u háº¡ng má»¥c
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
                      Ãp háº¡ng má»¥c Ä‘Æ°á»£c chá»n ({selectedDiscountCount})
                    </button>
                    <button type="button" className="qc-mini-btn" onClick={() => applyItemDiscount('all')}>
                      Ãp táº¥t cáº£ háº¡ng má»¥c
                    </button>
                  </div>
                  <span className="qc-workspace-quickbar-sep" aria-hidden="true" />
                  <label className="qc-workspace-quickbar-field" title="Ãp dá»¥ng cho tá»•ng bÃ¡o giÃ¡ sau khi Ä‘Ã£ tÃ­nh cÃ¡c háº¡ng má»¥c; khÃ´ng tá»± ghi Ä‘Ã¨ chiáº¿t kháº¥u riÃªng tá»«ng dÃ²ng.">
                    Chiáº¿t kháº¥u toÃ n bÃ¡o giÃ¡
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
                  <label className="qc-workspace-quickbar-field">
                    Thanh toÃ¡n
                    <select
                      className="qc-workspace-quickbar-input qc-workspace-quickbar-select"
                      value={quote ? paymentTermsDays : draftPaymentTermsDays}
                      onChange={event => {
                        if (quote) setPaymentTermsDays(event.target.value);
                        applyPaymentTerms(event.target.value);
                      }}
                    >
                      {['15', '30', '45', '60'].map(d => <option key={d} value={d}>{d} ngÃ y</option>)}
                    </select>
                  </label>
                  <span className="qc-term-note-anchor">
                    <button type="button" className="qc-mini-btn" onClick={() => setTermNotePopoverOpen(v => !v)}>+ Äiá»u khoáº£n</button>
                    {termNotePopoverOpen ? (
                      <div className="qc-row-margin-popover qc-term-note-popover" onClick={e => e.stopPropagation()}>
                        <textarea autoFocus className="qc-cell-input" rows={3} placeholder="Nháº­p ná»™i dung Ä‘iá»u khoáº£n..." value={termNoteInput} onChange={e => setTermNoteInput(e.target.value)} />
                        <div className="qc-row-margin-popover-actions">
                          <button type="button" className="qc-mini-btn" onClick={() => { setTermNotePopoverOpen(false); setTermNoteInput(''); }}>Huá»·</button>
                          <button type="button" className="qc-mini-btn qc-mini-btn-brand" disabled={!termNoteInput.trim()} onClick={submitTermNote}>ThÃªm</button>
                        </div>
                      </div>
                    ) : null}
                  </span>
                  {!quote ? <span className="qc-workspace-quickbar-hint">LÆ°u táº¡m, sáº½ ghi khi táº¡o yÃªu cáº§u</span> : null}
                </div>
              ) : null}
              {extraTermsList.length > 0 ? (
                <ul className="qc-workspace-draft-terms">
                  {extraTermsList.map(t => (
                    <li key={t.id}>
                      <span>{t.title}: {t.content}</span>
                      <span className="qc-workspace-draft-terms-actions">
                        <button type="button" className="qc-mini-btn" onClick={() => editTermNote(t.id)}>Sá»­a</button>
                        <button type="button" className="qc-mini-btn" onClick={() => removeTermNote(t.id)}>XÃ³a</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* "Tá»•ng há»£p giÃ¡" - CHUYEN xuong ngay duoi "Háº¡ng má»¥c & cáº¥u trÃºc
             * giÃ¡" o Buoc 3 (quote da khoa/duyet) theo yeu cau ro rang "cho
             * náº±m dÆ°á»›i Ä‘Ã­t Háº¡ng má»¥c & cáº¥u trÃºc giÃ¡ á»Ÿ bÆ°á»›c 3", thay vi nam
             * ben sidebar phai nhu truoc (xem <aside> - da bo card nay khoi
             * do). Giu nguyen 100% du lieu/logic, chi doi vi tri render. */}
            {!isDraft && quote ? (
              <div className="qc-workspace-card">
                <h3>Tá»•ng há»£p giÃ¡</h3>
                <div className="qc-summary-grid">
                  <div><span className="qc-workspace-info-label">Äiá»u khoáº£n thanh toÃ¡n</span><strong>{paymentTermsBlock?.content || 'ChÆ°a cÃ³ Ä‘iá»u khoáº£n'}</strong></div>
                  <div><span className="qc-workspace-info-label">Hiá»‡u lá»±c bÃ¡o giÃ¡</span><strong>{quote.validUntil ? formatDate(quote.validUntil) : 'ChÆ°a Ä‘áº·t'}</strong></div>
                  <div><span className="qc-workspace-info-label">Pháº¡m vi cÃ´ng viá»‡c</span><strong>{scopeBlock?.content || 'ChÆ°a mÃ´ táº£'}</strong></div>
                  <div><span className="qc-workspace-info-label">TrÆ°á»›c chiáº¿t kháº¥u</span><strong>{formatMoney(quote.subtotalAmount)}</strong></div>
                  <div><span className="qc-workspace-info-label">VAT</span><strong>{formatMoney(quote.vatAmount)}</strong></div>
                  <div><span className="qc-workspace-info-label">KhÃ¡ch thanh toÃ¡n</span><strong>{formatMoney(quote.totalAmount)}</strong></div>
                </div>
              </div>
            ) : null}

            {columnVisibilitySchema?.enableDynamicPaymentPlan && columnVisibilitySchema.layoutType !== 'villa_solution_package' ? (
              <details className={`qc-workspace-card qc-workspace-collapsible-card qc-payment-plan-card${paymentPlanIsComplete ? ' qc-payment-plan-card--complete' : paymentPlanIsEmpty ? '' : ' qc-payment-plan-card--warning'}`} data-testid="qc-payment-plan-card"
                open={paymentPlanCardOpen} onToggle={event => setPaymentPlanCardOpen((event.target as HTMLDetailsElement).open)}>
                <summary className="qc-workspace-card-head qc-workspace-collapsible-summary">
                  <h3>Káº¿ hoáº¡ch thanh toÃ¡n</h3>
                  <span className="qc-workspace-collapsible-hint">{paymentPlanCardOpen ? '(báº¥m Ä‘á»ƒ thu gá»n)' : '(báº¥m Ä‘á»ƒ xem)'}</span>
                  <div className="qc-workspace-card-head-badges">
                    <span className={`qc-badge ${paymentPlanBadgeClass}`}>{paymentPlanBadgeText}</span>
                    {!paymentPlanCardOpen && !paymentPlanIsEmpty ? (
                      <span className="qc-workspace-collapsible-hint">KhÃ¡ch thanh toÃ¡n: {formatMoney(paymentPlanTotalAmount)}</span>
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
                <h3>Ná»™i dung bá»• sung</h3>
                <span className="qc-workspace-collapsible-hint">(cáº¥p bÃ¡o giÃ¡ Â· báº¥m Ä‘á»ƒ xem)</span>
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
                  <h3>BÃ n giao ká»¹ thuáº­t â†’ ngÆ°á»i phá»¥ trÃ¡ch bÃ¡o giÃ¡</h3>
                  <span className="qc-workspace-collapsible-hint">{handoffCardOpen ? '(báº¥m Ä‘á»ƒ thu gá»n)' : '(báº¥m Ä‘á»ƒ xem)'}</span>
                  <div className="qc-workspace-card-head-badges">
                    {checklistDirty ? <span className="qc-badge qc-badge-amber">CÃ³ thay Ä‘á»•i chÆ°a lÆ°u</span> : null}
                  </div>
                </summary>
                <div className="qc-workspace-checklist">
                  {([
                    ['scopeConfirmed', 'scopeNote', 'Pháº¡m vi (Scope)'],
                    ['costConfirmed', 'costNote', 'GiÃ¡ vá»‘n (Cost)'],
                    ['timelineConfirmed', 'timelineNote', 'Tiáº¿n Ä‘á»™ (Timeline)'],
                    ['assumptionConfirmed', 'assumptionNote', 'Giáº£ Ä‘á»‹nh/Ngoáº¡i lá»‡'],
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
                          placeholder="Ghi chÃº..."
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
                    placeholder="Ghi chÃº bÃ n giao..."
                    value={checklistDraft?.handoffNote || ''}
                    disabled={!canEdit || !isDraft}
                    onChange={event => setChecklistDraft(prev => (prev ? { ...prev, handoffNote: event.target.value } : prev))}
                  />
                </div>
              </details>
            ) : null}

            {/* Card "PhÃ¢n cÃ´ng & SLA" READ-ONLY o cot chinh (chi hien stage
             * 'request') DA BO - yeu cau ro rang "chá»— PhÃ¢n cÃ´ng & SLA nÃ y Ä‘á»ƒ
             * sidebar bÃªn pháº£i chá»© k pháº£i cÃ¡i kia" - CHI CON DUNG 1 noi DUY
             * NHAT hien thi/sua Presale/Sale/SLA la card cung ten trong
             * <aside className="qc-workspace-side"> (luon hien moi stage,
             * sua truc tiep tai do - xem phia tren), tranh trung lap 2 noi
             * gay nham lan "sua o dau moi dung". */}

            {stage === 'pricing' ? (
              <div className="qc-workspace-card">
                <div className="qc-workspace-card-head">
                  <h3>Chuáº©n bá»‹ hoÃ n táº¥t giÃ¡ bÃ¡n</h3>
                </div>
                <ul className="qc-readiness-list">
                  {([
                    // BUG THAT DA GAP ("chá»— anh dÅ©ng cÃ³ full r mÃ  sao chá»— ni
                    // bÃ¡o chÆ°a"): itemsDraft.every() truoc day chay tren CA
                    // dong Section (row_type='section', luon co unitPrice=0
                    // theo dung thiet ke - khong tinh tien) - CHI CAN co 1
                    // Muc cha la check nay luon bao "ChÆ°a" du MOI hang muc
                    // that (row_type='item') da co gia ban day du. Loc chi
                    // con hang muc THAT truoc khi check, dung y het bug
                    // hasCostData da sua o backend (_quote_cost_summary).
                    (() => {
                      const realItems = itemsDraft.filter(i => i.rowType !== 'section');
                      return ['Táº¥t cáº£ háº¡ng má»¥c Ä‘Ã£ cÃ³ giÃ¡ bÃ¡n', realItems.length > 0 && realItems.every(i => (i.unitPrice || 0) > 0)] as const;
                    })(),
                    // "ÄÃ£ cÃ³ Ä‘iá»u khoáº£n thanh toÃ¡n" da BO KHOI danh sach nay
                    // - khong con la dieu kien bat buoc de chuyen pricing->
                    // review (migration 109_quote_payment_terms_not_required.sql,
                    // DA APPLY THAT), giu no o day se hien "ChÆ°a" gay hieu
                    // nham sai la van con chan buoc chuyen tiep.
                    ['ÄÃ£ cÃ³ dá»¯ liá»‡u margin', hasCostData],
                    ['ÄÃ£ xÃ¡c nháº­n chiáº¿t kháº¥u (cÃ³ thá»ƒ 0%)', quote ? quote.subtotalAmount != null : true],
                    ['SLA Ä‘Ã£ nháº­p', Boolean(quote?.slaDueAt || draftSlaDueAt)],
                  ] as const).map(([label, done]) => (
                    <li key={label} className={`qc-readiness-item ${done ? 'is-done' : 'is-missing'}`}>
                      <span className="qc-readiness-status">{done ? 'CÃ³' : 'ChÆ°a'}</span>
                      <span className="qc-readiness-label">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>TÃ³m táº¯t dá»¯ liá»‡u bÃ n giao</h3>
                <div className="qc-workspace-summary-row">
                  <span>Sá»‘ háº¡ng má»¥c</span>
                  <strong>{rootItems.length}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Tá»•ng giÃ¡ vá»‘n</span>
                  <strong>{hasCostData ? formatMoney(rootItems.reduce((sum, i) => sum + (i.costTotal || 0), 0)) : 'ChÆ°a cÃ³ dá»¯ liá»‡u'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Háº¡ng má»¥c thiáº¿u giÃ¡ vá»‘n</span>
                  <strong className={itemsMissingCost.length ? 'qc-cell-margin-bad' : undefined}>{itemsMissingCost.length}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Presale</span>
                  <strong>{ownerNameFor(quote?.technicalOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Sale nháº­n bÃ n giao</span>
                  <strong>{ownerNameFor(quote?.quoteOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>SLA cÃ²n láº¡i</span>
                  <strong>{quote?.slaDueAt ? formatDate(quote.slaDueAt) : 'ChÆ°a Ä‘áº·t SLA'}</strong>
                </div>
                {checklistDirty ? (
                  <div className="qc-workspace-note-box qc-workspace-note-box--warn">CÃ³ thay Ä‘á»•i checklist chÆ°a lÆ°u.</div>
                ) : null}
              </div>
            ) : null}

            {stage === 'request' || stage === 'technical' || stage === 'pricing' ? (
              <div className="qc-workspace-card">
                <h3>{stage === 'request' ? 'Lá»‹ch sá»­ yÃªu cáº§u' : stage === 'technical' ? 'Lá»‹ch sá»­ xá»­ lÃ½' : 'Activity'}</h3>
                {(() => {
                  const grouped = groupActivityEntries(activity);
                  const visible = activityExpanded ? grouped : grouped.slice(0, ACTIVITY_COLLAPSED_LIMIT);
                  return (
                    <>
                      <ul className={`qc-workspace-activity${activityExpanded ? ' qc-workspace-activity--scroll' : ''}`}>
                        {activity.length === 0 ? (
                          <li className="qc-workspace-muted">{quote ? 'ChÆ°a cÃ³ hoáº¡t Ä‘á»™ng nÃ o.' : 'YÃªu cáº§u chÆ°a Ä‘Æ°á»£c lÆ°u.'}</li>
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
                          {activityExpanded ? 'Thu gá»n' : `Xem táº¥t cáº£ (${grouped.length})`}
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : null}
          </div>

          <aside className="qc-workspace-side">
            {/* "PhÃ¢n cÃ´ng & SLA Ä‘á»ƒ bÃªn sidebar luÃ´n" - LUON hien (khong gate
             * theo stage/draft) o dau sidebar, tach khoi info-strip chinh
             * (Khach hang/Du an/Co hoi/Mau bao gia/Loai bao gia). Giu NGUYEN
             * y het logic/component cu (SearchableSelect + assignOwner +
             * computeQuoteSla...), chi doi VI TRI render. */}
            <div className="qc-workspace-card qc-workspace-assignment-card">
              <h3>PhÃ¢n cÃ´ng &amp; SLA</h3>
              <div className="qc-workspace-assignment-grid">
                <div data-qc-required="presale">
                  <span className="qc-workspace-info-label">Presale <span className="qc-required-mark">*</span></span>
                  {!quote || (isDraft && canEdit) ? (
                    presaleUsers === null ? (
                      <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Äang táº£i danh sÃ¡ch Presaleâ€¦</span>
                    ) : presaleUsers.length === 0 ? (
                      <NoStaffConfigured isAdminOrLeader={isAdminOrLeader} />
                    ) : (
                      <SearchableSelect
                        value={quote ? quote.technicalOwnerId || '' : draftTechnicalOwnerId}
                        onChange={value => { if (value) clearRequiredError('presale'); quote ? void assignOwner('technicalOwnerId', value) : setDraftTechnicalOwnerId(value); }}
                        options={presaleUsers.map(a => ({ value: a.id, label: ownerOptionLabel(a) }))}
                        placeholder="ChÆ°a gÃ¡n"
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
                    saleUsers === null ? (
                      <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Äang táº£i danh sÃ¡ch Saleâ€¦</span>
                    ) : saleUsers.length === 0 ? (
                      <NoStaffConfigured isAdminOrLeader={isAdminOrLeader} />
                    ) : (
                      <SearchableSelect
                        value={quote ? quote.quoteOwnerId || '' : draftQuoteOwnerId}
                        onChange={value => { if (value) clearRequiredError('sale'); quote ? void assignOwner('quoteOwnerId', value) : setDraftQuoteOwnerId(value); }}
                        options={saleUsers.map(a => ({ value: a.id, label: ownerOptionLabel(a) }))}
                        placeholder="ChÆ°a gÃ¡n"
                      />
                    )
                  ) : (
                    <strong>{ownerNameFor(quote.quoteOwnerId)}</strong>
                  )}
                  {requiredFieldErrors.sale ? <p className="qc-field-error">{requiredFieldErrors.sale}</p> : null}
                </div>
                <div data-qc-required="sla">
                  <span className="qc-workspace-info-label" title="Háº¡n xá»­ lÃ½ Ná»˜I Bá»˜ - khÃ¡c hoÃ n toÃ n 'Hiá»‡u lá»±c Ä‘áº¿n' (hiá»‡u lá»±c bÃ¡o giÃ¡ vá»›i khÃ¡ch hÃ ng)">
                    SLA / Háº¡n hoÃ n táº¥t ná»™i bá»™ <span className="qc-required-mark">*</span>
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
                    <strong>{quote.slaDueAt ? formatDate(quote.slaDueAt) : 'ChÆ°a Ä‘áº·t SLA'}</strong>
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
                        {sla.label}{sla.relativeText ? ` Â· ${sla.relativeText}` : ''}
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
              <Eye className="qc-icon" /> Xem báº£n khÃ¡ch hÃ ng
            </button>

            {/* "Cá»™t hiá»ƒn thá»‹" DA GOP vao trong popup preview (yeu cau rieng
             * "Gá»™p láº¡i chá»©c nÄƒng Cá»™t hiá»ƒn thá»‹ vÃ o bÃªn trong Xem báº£n khÃ¡ch
             * hÃ ng") - sidebar CHI CON DUNG 1 nut "Xem báº£n khÃ¡ch hÃ ng", KHONG
             * con <QuoteColumnVisibilityPicker> rieng o day nua. Xem
             * previewModalOpen ben duoi - dung LAI y het component/state/
             * handler nay (columnVisibilityDraft/handleColumnVisibilityChange/
             * columnVisibilitySchema), chi doi VI TRI render sang header cua
             * popup preview. */}

            {/* "khi tÃ­ch xong há»i láº¡i cÃ³ cháº¯c lÆ°u vÃ  hiá»ƒn thá»‹ váº­y khÃ´ng" -
             * gio dung window.confirm() ngay trong handleColumnVisibilityChange
             * (xem khai bao ham o tren) - KHONG con ConfirmModal rieng o day
             * nua (bug "k báº¥m dc luÃ´n" do z-index/stacking context tuy
             * chinh khong dang tin cay khi long trong popup preview). */}

            {/* Yeu cau rieng "máº¥y card nÃ y Ä‘áº» bÃªn sidebar pháº£i Ä‘i, Ä‘ang trá»‘ng
             * káº¿ bÃªn kÃ¬a" - o quote da khoa/duyet (khong phai draft), sidebar
             * truoc day RONG (cac card duoi day chi gate theo stage request/
             * technical/pricing/review, khong co nhanh nao cho 'published'/
             * 'ready_to_publish') trong khi cot chinh qua tai 3 card tong
             * hop. Chuyen "PhÃª duyá»‡t & version"/"ThÃ´ng tin phÃ¡t hÃ nh" sang
             * day, cung dieu kien !isDraft nhu cot chinh. "Tá»•ng há»£p giÃ¡" DA
             * CHUYEN xuong ngay duoi khoi "Háº¡ng má»¥c & cáº¥u trÃºc giÃ¡" o cot
             * chinh (yeu cau rieng "cho náº±m dÆ°á»›i Ä‘Ã­t Háº¡ng má»¥c & cáº¥u trÃºc giÃ¡
             * á»Ÿ bÆ°á»›c 3") - xem ngay sau </div> dong khoi items card. */}
            {!isDraft && quote ? (
              <>
                <div className="qc-workspace-card">
                  <h3>PhÃª duyá»‡t &amp; version</h3>
                  <div className="qc-workspace-summary-row"><span>Version hiá»‡n táº¡i</span><strong>V{quote.versionNumber || 1}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Káº¿t quáº£ Rule Engine</span><strong>{ruleEvaluation ? (ruleEvaluation.result === 'pass' ? 'Äáº¡t' : ruleEvaluation.result === 'fail' ? 'KhÃ´ng Ä‘áº¡t' : 'ChÆ°a Ä‘á»§ dá»¯ liá»‡u') : 'ChÆ°a Ä‘Ã¡nh giÃ¡'}</strong></div>
                  <div className="qc-workspace-summary-row"><span>PhÃª duyá»‡t</span><strong>{ruleEvaluation?.autoApproveEnabled ? 'Tá»± Ä‘á»™ng duyá»‡t' : 'Duyá»‡t thá»§ cÃ´ng'}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Tráº¡ng thÃ¡i public link</span><strong>{quote.publicEnabled ? 'Äang báº­t' : 'ChÆ°a báº­t'}</strong></div>
                </div>

                {quote.processingStage === 'published' ? (
                  <div className="qc-workspace-card">
                    <h3>{quote.sentAt ? 'ThÃ´ng tin gá»­i khÃ¡ch' : 'ThÃ´ng tin phÃ¡t hÃ nh'}</h3>
                    <div className="qc-workspace-summary-row"><span>Public URL</span><strong>{quote.publicUrl || 'â€”'}</strong></div>
                    <div className="qc-workspace-summary-row"><span>NgÆ°á»i phÃ¡t hÃ nh</span><strong>{quote.publishedById ? nameFor(quote.publishedById) : 'â€”'}</strong></div>
                    <div className="qc-workspace-summary-row"><span>NgÃ y phÃ¡t hÃ nh</span><strong>{quote.publishedAt ? formatDate(quote.publishedAt) : 'â€”'}</strong></div>
                    {/* "Giá»›i háº¡n xem link bÃ¡o giÃ¡ báº±ng Email hoáº·c Sá»‘ Ä‘iá»‡n
                     * thoáº¡i" (migration 118) - mac dinh "KhÃ´ng giá»›i háº¡n"
                     * (khong doi hanh vi cu, ai co link cung xem duoc). CHI 1
                     * trong 3 che do co hieu luc tai 1 thoi diem (radio, khong
                     * phai checkbox+danh sach nhu ban cu) - tranh dut khoat
                     * bug "táº¯t giá»›i háº¡n nhÆ°ng váº«n yÃªu cáº§u Email" da gap truoc
                     * do (khi do dung 1 boolean rieng + danh sach song song,
                     * de "quen" cap nhat 1 trong 2 khi tat). */}
                    <div className="qc-workspace-email-gate">
                      <div className="qc-workspace-access-mode-toggle">
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'none'} onChange={() => setAccessModeAndSuggest('none')} />
                          KhÃ´ng giá»›i háº¡n
                        </label>
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'email'} onChange={() => setAccessModeAndSuggest('email')} />
                          Giá»›i háº¡n theo Email
                        </label>
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'phone'} onChange={() => setAccessModeAndSuggest('phone')} />
                          Giá»›i háº¡n theo Sá»‘ Ä‘iá»‡n thoáº¡i
                        </label>
                      </div>
                      {accessMode === 'email' ? (
                        <textarea
                          className="qc-workspace-email-gate-textarea"
                          placeholder={'Nháº­p email Ä‘Æ°á»£c phÃ©p xem, má»—i dÃ²ng 1 email\nvd: khach@congty.com'}
                          value={accessEmailsText}
                          onChange={e => setAccessEmailsText(e.target.value)}
                        />
                      ) : null}
                      {accessMode === 'phone' ? (
                        <textarea
                          className="qc-workspace-email-gate-textarea"
                          placeholder={'Nháº­p sá»‘ Ä‘iá»‡n thoáº¡i Ä‘Æ°á»£c phÃ©p xem, má»—i dÃ²ng 1 sá»‘\nvd: 0901234567'}
                          value={accessPhonesText}
                          onChange={e => setAccessPhonesText(e.target.value)}
                        />
                      ) : null}
                      <button type="button" className="qc-mini-btn" disabled={accessSaving} onClick={() => void saveAccessRestriction()}>
                        {accessSaving ? 'Äang lÆ°u...' : 'LÆ°u giá»›i háº¡n xem link'}
                      </button>
                    </div>
                    {quote.sentAt ? (
                      <>
                        <div className="qc-workspace-summary-row"><span>NgÆ°á»i gá»­i</span><strong>{quote.sentById ? nameFor(quote.sentById) : 'â€”'}</strong></div>
                        <div className="qc-workspace-summary-row"><span>NgÃ y gá»­i</span><strong>{formatDate(quote.sentAt)}</strong></div>
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
                <h3>TÃ³m táº¯t yÃªu cáº§u</h3>
                <div className="qc-workspace-summary-row">
                  <span>KhÃ¡ch hÃ ng</span>
                  <strong>{deal?.customerName || (draftCustomerId ? customers.find(c => c.id === draftCustomerId)?.label : null) || 'ChÆ°a chá»n'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Dá»± Ã¡n</span>
                  <strong>{(projects || []).find(p => p.id === (quote ? quote.projectId : draftProjectId))?.name || 'ChÆ°a thuá»™c dá»± Ã¡n'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>CÆ¡ há»™i</span>
                  <strong>{businessCode || (deal ? 'ChÆ°a cÃ³ mÃ£' : 'ChÆ°a gáº¯n cÆ¡ há»™i')}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>SLA</span>
                  <strong>{(quote ? quote.slaDueAt : draftSlaDueAt) ? formatDate(quote ? quote.slaDueAt! : new Date(draftSlaDueAt).toISOString()) : 'ChÆ°a Ä‘áº·t SLA'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Loáº¡i bÃ¡o giÃ¡</span>
                  <strong>{currentQuoteTypeCodes.length > 0 ? currentQuoteTypeCodes.map(quoteTypeLabel).join(', ') : 'ChÆ°a chá»n'}</strong>
                </div>
              </div>
            ) : null}

            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>Tá»•ng giÃ¡ vá»‘n</h3>
                <div className="qc-workspace-summary-row">
                  <span>Tá»•ng giÃ¡ vá»‘n</span>
                  <strong>{hasCostData ? formatMoney(rootItems.reduce((sum, i) => sum + (i.costTotal || 0), 0)) : 'ChÆ°a cÃ³ dá»¯ liá»‡u'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Háº¡ng má»¥c thiáº¿u giÃ¡ vá»‘n</span>
                  <strong className={itemsMissingCost.length ? 'qc-cell-margin-bad' : undefined}>{itemsMissingCost.length}</strong>
                </div>
              </div>
            ) : null}
            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>SLA</h3>
                <div className="qc-workspace-summary-row">
                  <span>Háº¡n hoÃ n táº¥t ná»™i bá»™</span>
                  <strong>{quote?.slaDueAt ? formatDate(quote.slaDueAt) : 'ChÆ°a Ä‘áº·t SLA'}</strong>
                </div>
              </div>
            ) : null}

            {stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Tá»•ng há»£p thÆ°Æ¡ng máº¡i</h3>
              <div className="qc-workspace-summary-row">
                <span>TrÆ°á»›c chiáº¿t kháº¥u</span>
                <strong>{quote ? formatMoney(quote.subtotalAmount) : '0 Ä‘'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Chiáº¿t kháº¥u</span>
                <strong>{quote ? formatMoney(Math.max(0, quote.subtotalAmount - (quote.netRevenue ?? quote.subtotalAmount))) : '0 Ä‘'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Sau chiáº¿t kháº¥u</span>
                <strong>{quote ? formatMoney(quote.netRevenue ?? quote.subtotalAmount) : '0 Ä‘'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>VAT</span>
                <strong>{quote ? formatMoney(quote.vatAmount) : '0 Ä‘'}</strong>
              </div>
              <div className="qc-workspace-summary-row qc-workspace-summary-row--total">
                <span>KhÃ¡ch thanh toÃ¡n</span>
                <strong>{quote ? formatMoney(quote.totalAmount) : '0 Ä‘'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Lá»£i nhuáº­n dá»± kiáº¿n</span>
                <strong className={hasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                  {hasCostData ? formatMoney(quote!.grossProfit || 0) : 'ChÆ°a cÃ³ dá»¯ liá»‡u giÃ¡ vá»‘n'}
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
                  <h3>Quy táº¯c phÃª duyá»‡t</h3>
                  <p className="qc-rule-card-subtitle">
                    {ruleSet ? `${ruleSet.name} Â· V${ruleSet.version}` : ruleSetLoaded ? 'ChÆ°a cáº¥u hÃ¬nh quy táº¯c' : 'Äang táº£iâ€¦'}
                  </p>
                </div>
              </div>

              {ruleSet ? (
                <>
                  <ul className="qc-rule-list">
                    {ruleSet.rules.map(rule => {
                      const detail = ruleEvaluation?.details.find(d => d.ruleType === rule.ruleType);
                      const label = RULE_LABELS[rule.ruleType]?.label || rule.ruleType;
                      const statusIcon = !detail ? 'â€¢' : detail.status === 'pass' ? 'âœ“' : detail.status === 'fail' ? 'âœ—' : 'â€¢';
                      const statusClass = !detail ? 'qc-rule-row--pending' : detail.status === 'pass' ? 'qc-rule-row--pass' : detail.status === 'fail' ? 'qc-rule-row--fail' : 'qc-rule-row--pending';
                      return (
                        <li key={rule.ruleType} className={`qc-rule-row ${statusClass}`}>
                          <span className="qc-rule-row-icon">{statusIcon}</span>
                          <span className="qc-rule-row-label">{label}</span>
                          <span className="qc-rule-row-value">{detail ? detail.actualDisplay : 'ChÆ°a cÃ³ dá»¯ liá»‡u'}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="qc-rule-summary">
                    {!ruleEvaluation
                      ? 'ChÆ°a Ä‘á»§ dá»¯ liá»‡u Ä‘á»ƒ Ä‘Ã¡nh giÃ¡'
                      : ruleEvaluation.result === 'pass'
                        ? `âœ“ Äáº¡t ${ruleEvaluation.details.length}/${ruleEvaluation.details.length} quy táº¯c${ruleEvaluation.autoApproveEnabled ? ' Â· tá»± Ä‘á»™ng duyá»‡t' : ''}`
                        : ruleEvaluation.result === 'insufficient_data'
                          ? 'ChÆ°a Ä‘á»§ dá»¯ liá»‡u Ä‘á»ƒ Ä‘Ã¡nh giÃ¡'
                          : `KhÃ´ng Ä‘áº¡t ${ruleEvaluation.details.filter(d => d.status === 'fail').length}/${ruleEvaluation.details.length} quy táº¯c`}
                  </div>
                </>
              ) : (
                <p className="qc-workspace-muted" style={{ fontSize: 13 }}>
                  {canManageApprovalRules
                    ? 'ChÆ°a cÃ³ quy táº¯c phÃª duyá»‡t nÃ o Ä‘Æ°á»£c cáº¥u hÃ¬nh â€” vÃ o "CÃ i Ä‘áº·t bÃ¡o giÃ¡" (menu Quáº£n lÃ½ CRM) Ä‘á»ƒ thiáº¿t láº­p.'
                    : 'ChÆ°a cÃ³ quy táº¯c phÃª duyá»‡t nÃ o Ä‘Æ°á»£c cáº¥u hÃ¬nh.'}
                </p>
              )}
            </div>
            ) : null}

            {/* Card qc-workspace-actions (Xem báº£n khÃ¡ch hÃ ng/Gá»­i khÃ¡ch hÃ ng/
             * link) o stage==='review' DA BO HET - yeu cau rieng "Xem báº£n
             * khÃ¡ch hÃ ng" trÃ¹ng header (Ä‘Ã£ gá»¡), roi "gá»­i khÃ¡ch hÃ ng Ä‘ang
             * chá» duyá»‡t dá»¡ luÃ´n Ä‘i": "Gá»­i khÃ¡ch hÃ ng" o day LUON disabled
             * (sendDisabledReason luon = "BÃ¡o giÃ¡ chÆ°a Ä‘Æ°á»£c duyá»‡t" khi
             * stage==='review', vi quote.status CHI thanh 'approved' SAU KHI
             * roi khoi stage nay - xem approveNow()/RPC quote_approve) - nut
             * khong bao gio bam duoc o day, chi la UI chet. 3 khoi con lai
             * trong card (copy/khoÃ¡/má»Ÿ link) deu dieu kien
             * quote?.status==='approved' nen CUNG khong bao gio hien khi con
             * o 'review' (status chi approved SAU stage nay) - ca card rong
             * khong con gi de hien, bo han thay vi de trong. */}

            {stage === 'request' || stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Kiá»ƒm tra dá»¯ liá»‡u</h3>
              <ul className="qc-workspace-checks">
                <li className={deal ? 'ok' : 'pending'}>ÄÃ£ cÃ³ thÃ´ng tin khÃ¡ch hÃ ng</li>
                {/* BUG THAT DA GAP: rootItems = quote?.items (chi co gia tri
                 * SAU KHI quote da tao that) - o che do tao moi (!quote),
                 * rootItems LUON RONG du go bao nhieu hang muc di nua, khien
                 * o nay khong bao gio hien "da xong" cho toi khi bam BÃ n
                 * giao xong. Doc tu itemsDraft (ban nhap dang go) khi chua
                 * co quote that thay vi rootItems. */}
                <li className={(quote ? rootItems.length > 0 : itemsDraft.length > 0) ? 'ok' : 'pending'}>ÄÃ£ cÃ³ háº¡ng má»¥c vÃ  chi phÃ­</li>
                <li className={(quote ? hasCostData : itemsDraft.some(item => item.markupPercent != null || item.unitPrice != null)) ? 'ok' : 'pending'}>ÄÃ£ nháº­p giÃ¡ bÃ¡n/Markup</li>
                {/* "ÄÃ£ cÃ³ Ä‘iá»u khoáº£n thanh toÃ¡n"/"ÄÃ£ mÃ´ táº£ pháº¡m vi cÃ´ng viá»‡c"
                 * da BO KHOI checklist nay theo yeu cau - ca 2 deu KHONG bat
                 * buoc (dieu khoan thanh toan van con bat buoc rieng o buoc
                 * pricing->review qua "Chuáº©n bá»‹ hoÃ n táº¥t giÃ¡ bÃ¡n" ben tren,
                 * scope thi khong con bat buoc dau nao ca - xem migration
                 * 108_quote_scope_not_required.sql). */}
              </ul>
              {marginBelowThreshold ? (
                <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                  Cáº£nh bÃ¡o: margin {quote?.grossMarginPercent?.toFixed(2)}% dÆ°á»›i ngÆ°á»¡ng tham chiáº¿u 20%.
                </div>
              ) : null}
            </div>
            ) : null}

            {/* Card "Preview khÃ¡ch hÃ ng" lon (o sidebar) DA BO - "Xem báº£n
             * khÃ¡ch hÃ ng" gio la 1 nut full-width rieng ngay dau sidebar
             * (xem .qc-workspace-preview-sidebar-btn ngay ben tren, sau card
             * "PhÃ¢n cÃ´ng & SLA") theo yeu cau moi nhat "Chuyá»ƒn Xem báº£n khÃ¡ch
             * hÃ ng sang sidebar pháº£i" - dung LAI DUNG canPreview/
             * previewDisabledReason/setPreviewModalOpen, khong tao luong
             * preview moi nao. */}

            {stage === 'request' || stage === 'technical' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>{stage === 'request' ? 'Activity ngáº¯n' : 'Activity & handoff'}</h3>
              {(() => {
                const grouped = groupActivityEntries(activity);
                const visible = activityExpanded ? grouped : grouped.slice(0, ACTIVITY_COLLAPSED_LIMIT);
                return (
                  <>
                    <ul className={`qc-workspace-activity${activityExpanded ? ' qc-workspace-activity--scroll' : ''}`}>
                      {activity.length === 0 ? (
                        <li className="qc-workspace-muted">{quote ? 'ChÆ°a cÃ³ hoáº¡t Ä‘á»™ng nÃ o.' : 'YÃªu cáº§u chÆ°a Ä‘Æ°á»£c lÆ°u.'}</li>
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
                        {activityExpanded ? 'Thu gá»n' : `Xem táº¥t cáº£ (${grouped.length})`}
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
              {/* "LÆ°u / Chá»‰nh sá»­a" chuyen tu header xuong day, dat KE nut
               * "BÃ n giao" - Ä‘á»•i ten thanh "LÆ°u / Báº£n nhÃ¡p" + o mau TRANG
               * (qc-btn thuong, khong phai qc-btn-primary) de khong canh
               * tranh voi nut hanh dong chinh "BÃ n giao". Nut "Huá»·" rieng
               * DA BO - bam X o header da hieu ngam la Huá»·, khong can lap
               * lai 1 nut chu rieng nua. */}
              <button type="button" className="qc-btn" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} onClick={() => void createRequest(false)}>
                {actionButtonContent('draftSave', 'LÆ°u / Báº£n nhÃ¡p')}
              </button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy}
                aria-busy={busy && activeAction === 'handoff'}
                onClick={() => void createRequest(true)}
              >
                {actionButtonContent('handoff', 'BÃ n giao')}
              </button>
            </>
          ) : !isDraft ? (
            <>
              <button type="button" className="qc-btn" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>â† Danh sÃ¡ch</button>
              {quote.status === 'approved' ? (
                <>
                  <button type="button" className="qc-btn" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem báº£n khÃ¡ch hÃ ng
                  </button>
                  {quote.processingStage === 'published' ? (
                    <>
                      {quote.publicEnabled ? (
                        <>
                          <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                            <Link2 className="qc-icon" /> Sao chÃ©p link bÃ¡o giÃ¡
                          </button>
                          <button type="button" className="qc-btn" disabled={busy} onClick={() => void revokePublicLinkFromWorkspace()}>
                            KhoÃ¡ link
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="qc-workspace-footer-note">Link bÃ¡o giÃ¡ Ä‘Ã£ bá»‹ khoÃ¡</span>
                          <button type="button" className="qc-btn" disabled={busy} onClick={() => void enablePublicLinkFromWorkspace()}>
                            Má»Ÿ láº¡i link
                          </button>
                        </>
                      )}
                      {quote.sentAt ? (
                        <>
                          <button type="button" className="qc-btn" onClick={() => void viewDeliveryLog()}>
                            <History className="qc-icon" /> Xem lá»‹ch sá»­ gá»­i
                          </button>
                          <button
                            type="button"
                            className="qc-btn qc-btn-primary"
                            disabled={Boolean(sendDisabledReason)}
                            title={sendDisabledReason}
                            onClick={() => void openSendModal()}
                          >
                            <Send className="qc-icon" /> Gá»­i láº¡i
                          </button>
                          <span className="qc-workspace-footer-note">
                            ÄÃ£ gá»­i{quote.sentAt ? ` Â· ${relativeTime(quote.sentAt)}` : ''}
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
                          <Send className="qc-icon" /> Gá»­i khÃ¡ch hÃ ng
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" className="qc-btn qc-btn-primary" onClick={() => setPublishModalOpen(true)}>
                      PhÃ¡t hÃ nh
                    </button>
                  )}
                </>
              ) : null}
              <span className="qc-workspace-footer-note">
                Version Ä‘Ã£ khoÃ¡{versionButtonState.disabled ? '' : ' Â· Táº¡o revision Ä‘á»ƒ sá»­a'}
              </span>
            </>
          ) : (
            <>
              <button type="button" className="qc-btn" disabled={busy} onMouseDown={markClosingIntent} onClick={requestWorkspaceClose}>â† Danh sÃ¡ch</button>
              {(stage === 'request' || stage === 'technical') && canEdit ? (
                // MOT nut duy nhat cho ca Buoc 1 gop (request VA technical la
                // CUNG 1 buoc UI "YÃªu cáº§u & Ká»¹ thuáº­t") - khong con tach thanh
                // "Gá»­i yÃªu cáº§u xá»­ lÃ½" roi "BÃ n giao xá»­ lÃ½ giÃ¡" nhu 2 luot bam
                // lien tiep (bug that da gap: nhin nhu Buoc 1 chay 2 lan).
                // handoffStep1ToPricing() tu xu ly ca 2 hop (request-
                // >technical NEU can, roi ->pricing) trong CUNG 1 lan bam.
                <>
                  <button type="button" className="qc-btn" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} title="LÆ°u báº£n nhÃ¡p bÃ¡o giÃ¡" onClick={() => void persistQuote({}).then(() => showToast(true, 'ÄÃ£ lÆ°u báº£n nhÃ¡p.'))}>LÆ°u</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || itemsMissingCost.length > 0 || (stage === 'request' && !quote?.slaDueAt)}
                    aria-busy={busy && activeAction === 'handoff'}
                    title={
                      stage === 'request' && !quote?.slaDueAt
                        ? 'Cáº§n Ä‘áº·t SLA / háº¡n hoÃ n táº¥t ná»™i bá»™ trÆ°á»›c khi BÃ n giao'
                        : itemsMissingCost.length > 0
                        ? `CÃ²n ${itemsMissingCost.length} háº¡ng má»¥c chÆ°a nháº­p giÃ¡ vá»‘n hoáº·c chÆ°a Ä‘Ã¡nh dáº¥u "KhÃ´ng Ã¡p dá»¥ng"`
                        : undefined
                    }
                    onClick={() => void handoffStep1ToPricing()}
                  >
                    {actionButtonContent('handoff', 'BÃ n giao')}
                  </button>
                </>
              ) : null}
              {stage === 'pricing' && canEdit ? (
                <>
                  <button type="button" className="qc-btn" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} onClick={() => void persistQuote({}).then(() => showToast(true, 'ÄÃ£ lÆ°u bÃ¡o giÃ¡.'))}>{actionButtonContent('draftSave', 'LÆ°u')}</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || !canReadyForApproval}
                    aria-busy={busy && activeAction === 'reviewPricing'}
                    title={!canReadyForApproval ? 'Cáº§n Ã­t nháº¥t 1 háº¡ng má»¥c vÃ  tá»•ng tiá»n > 0 trÆ°á»›c khi gá»­i duyá»‡t' : undefined}
                    onClick={() => void advanceStage('review')}
                  >
                    {actionButtonContent('reviewPricing', 'HoÃ n táº¥t pháº§n giÃ¡ bÃ¡n')}
                  </button>
                </>
              ) : null}
              {stage === 'review' ? (
                <>
                  <button type="button" className="qc-btn" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem báº£n khÃ¡ch hÃ ng
                  </button>
                  {canEdit ? (
                    <button type="button" className="qc-btn" disabled={busy} onClick={() => setRequestChangesModalOpen(true)}>
                      YÃªu cáº§u chá»‰nh sá»­a
                    </button>
                  ) : null}
                  {canApprove ? (
                    <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => setApproveModalOpen(true)}>
                      <CheckCircle2 className="qc-icon" /> Duyá»‡t bÃ¡o giÃ¡
                    </button>
                  ) : (
                    <span className="qc-workspace-footer-note">Chá» ngÆ°á»i cÃ³ quyá»n duyá»‡t (Admin hoáº·c Ä‘Æ°á»£c cáº¥p quyá»n) xá»­ lÃ½.</span>
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
            <h3>Táº¡o phiÃªn báº£n V{(quote.versionNumber || 1) + 1}</h3>
            <p className="qc-workspace-note">BÃ¡o giÃ¡ {quote.quoteNumber} Â· giá»¯ nguyÃªn version cÅ© Ä‘á»ƒ Ä‘á»‘i chiáº¿u</p>
            <label className="qc-workspace-info-label">LÃ½ do táº¡o revision</label>
            <select className="crm-input" value={versionReason} onChange={event => setVersionReason(event.target.value)}>
              {VERSION_REASONS.map(reason => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
            <div className="qc-workspace-note-box">
              Version {quote.versionNumber || 1} sáº½ Ä‘Æ°á»£c giá»¯ nguyÃªn, khÃ´ng sá»­a Ä‘Æ°á»£c ná»¯a. ToÃ n bá»™ dá»¯ liá»‡u sáº½ copy sang báº£n nhÃ¡p má»›i.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setVersionModalOpen(false)}>Huá»·</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => void confirmCreateVersion()}>
                Táº¡o version má»›i
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
        customerName={quote ? deal?.customerName || 'KhÃ¡ch hÃ ng hiá»‡n táº¡i' : customers.find(c => c.id === draftCustomerId)?.label || 'KhÃ¡ch hÃ ng hiá»‡n táº¡i'}
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
            <h3>KhÃ´ng táº¡o Ä‘Æ°á»£c cÆ¡ há»™i</h3>
            <div className="qc-workspace-note-box qc-workspace-note-box--warn">{dealCreateError}</div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn qc-btn-primary" onClick={() => setDealCreateError('')}>ÄÃ³ng</button>
            </div>
          </div>
        </div>
      ) : null}

      {previewModalOpen ? (() => {
        // BUG THAT DA GAP ("báº¥m Preview khÃ¡ch hÃ ng á»Ÿ bÆ°á»›c 1 ra báº£ng cÅ© chá»©
        // khÃ´ng hiá»‡n báº£n PDF"): xem giai thich day du o khai bao
        // draftSelectedForm/draftPreviewData/draftPreviewTotals o tren -
        // resolve schema tu quote THAT (da luu) HOAC tu mau bao gia da chon
        // trong dropdown (che do tao moi, chua luu) - CHI khi ca 2 deu
        // khong co (chua chon mau nao ca) moi roi ve ban rut gon cu.
        const previewSchema = quote?.formSnapshot || draftSelectedForm?.schemaJson;
        return (
      <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewModalOpen(false); }}>
          <div className={`qc-workspace-preview-modal${previewSchema ? ' qc-workspace-preview-modal--doc' : ''}`}>
            <div className="qc-workspace-modal-head">
              <h3>{quote ? 'Báº£n xem trÆ°á»›c cho khÃ¡ch hÃ ng' : 'Báº£n xem trÆ°á»›c'}</h3>
              <div className="qc-workspace-card-head-badges">
                {/* "Cá»™t hiá»ƒn thá»‹" gop vao NGAY TRONG popup preview (yeu cau
                 * rieng "Gá»™p láº¡i chá»©c nÄƒng Cá»™t hiá»ƒn thá»‹ vÃ o bÃªn trong Xem
                 * báº£n khÃ¡ch hÃ ng... táº¡i gÃ³c trÃªn bÃªn pháº£i") - dung LAI DUNG
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
                {/* Yeu cau rieng "xÃ³a nÃºt In/Táº£i chá»— báº£n xem trÆ°á»›c Ä‘i" - bug
                 * phan trang khi in tu modal nay (11 trang, lap letterhead)
                 * chua sua trietj de duoc, bo han nut de tranh nguoi dung
                 * dung nham duong hong loi. In/Tai PDF that van dung duoc
                 * qua trang chi tiet bao gia (/all-platform/quotes/[id]) hoac
                 * link cong khai gui khach - 2 noi do khong qua modal nay. */}
                <button type="button" className="crm-icon-action" aria-label="ÄÃ³ng" onClick={() => setPreviewModalOpen(false)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
            </div>
            {/* CHOT LAI (yeu cau ro rang "Preview pháº£i dÃ¹ng chung renderer vÃ 
             * cÃ¹ng dá»¯ liá»‡u vá»›i public quote/PDF/báº£n in, khÃ´ng duy trÃ¬ renderer
             * rÃºt gá»n riÃªng"): khi quote da co formSnapshot that (da tao xong,
             * da chon Mau bao gia), dung THANG QuoteDocumentRenderer mode=
             * 'public' - CHINH XAC cung component/du lieu voi trang cong khai
             * (xem PublicQuotePage.tsx) nen tu dong an het Gia von/Markup/
             * Margin/ghi chu noi bo (schema cong khai von di khong co field
             * nay), khong phai tu allowlist rieng nhu ban rut gon cu. Bao boc
             * trong .quote-print-root de tai dung dung co che "in bulletproof"
             * da co san (quotes.css) - visibility:hidden ca trang, chi hien
             * dung khoi nay, hoat dong DU dang nam trong modal long nhieu lop. */}
            {previewSchema ? (
              // CHOT LAI (yeu cau ro rang "popup quÃ¡ nhá», khÃ´ng cuá»™n xuá»‘ng
              // Ä‘Æ°á»£c"): BO HAN co che transform:scale() + do dac JS truoc do
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
                  schemaSnapshot={previewSchema}
                  quoteData={quote ? quote.data : draftPreviewData}
                  quoteItems={itemsDraft}
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
                />
              </div>
            ) : (
              /* Chi con dung khi CHUA chon mau bao gia nao ca (khong co
               * schema nao de dung chung renderer) - giu ban toi gian cu lam
               * fallback cuoi cung cho dung truong hop hiem nay. */
              <div className="qc-workspace-preview-modal-body">
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">KhÃ¡ch hÃ ng</span>
                  <strong>{deal?.customerName || 'ChÆ°a gáº¯n cÆ¡ há»™i'}</strong>
                </div>
                <table className="qc-linked-table qc-linked-table--preview4col">
                  <thead>
                    <tr>
                      <th>Háº¡ng má»¥c</th>
                      <th className="qc-th-money">SL</th>
                      <th className="qc-th-money">ÄÆ¡n giÃ¡</th>
                      <th className="qc-th-money">ThÃ nh tiá»n</th>
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
                                <strong>{previewRoman}. {stripLeadingRomanPrefix(item.description || '', previewRoman) || 'Má»¥c má»›i'}</strong>
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={item.id || index}>
                            <td>{item.serviceDescription || 'â€”'}</td>
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
                  <span>Tá»•ng thanh toÃ¡n</span>
                  <strong>{formatMoney(previewTotals.total)}</strong>
                </div>
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Äiá»u khoáº£n thanh toÃ¡n</span>
                  <p>Thanh toÃ¡n trong {draftPaymentTermsDays} ngÃ y ká»ƒ tá»« ngÃ y duyá»‡t bÃ¡o giÃ¡.</p>
                </div>
              </div>
            )}
          </div>
        </div>
        );
      })() : null}

      {quote && sendModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setSendModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Gá»­i khÃ¡ch hÃ ng</h3>
            <p className="qc-workspace-note">BÃ¡o giÃ¡ {quote.quoteNumber} Â· V{quote.versionNumber || 1}</p>

            {sendSuccess ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--ok">
                ÄÃ£ gá»­i bÃ¡o giÃ¡ tá»›i {sendRecipientEmail}.
              </div>
            ) : (
              <>
                <label className="qc-workspace-info-label">NgÆ°á»i nháº­n</label>
                <input
                  type="text"
                  className="crm-input"
                  value={sendRecipientName}
                  onChange={event => setSendRecipientName(event.target.value)}
                  placeholder="TÃªn ngÆ°á»i nháº­n (khÃ´ng báº¯t buá»™c)"
                />
                <label className="qc-workspace-info-label">Email ngÆ°á»i nháº­n</label>
                <input
                  type="email"
                  className="crm-input"
                  value={sendRecipientEmail}
                  onChange={event => { setSendRecipientEmail(event.target.value); setSendRecipientSource('manual'); }}
                  placeholder="email@khachhang.com"
                />
                {sendRecipientSource ? (
                  <p className="qc-workspace-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                    Nguá»“n email: {sendRecipientSource === 'deal_contact' ? 'CÆ¡ há»™i CRM' : sendRecipientSource === 'crm_customer' ? 'Há»“ sÆ¡ khÃ¡ch hÃ ng' : 'Nháº­p tay'}
                  </p>
                ) : null}

                <label className="qc-workspace-info-label">TiÃªu Ä‘á»</label>
                <input
                  type="text"
                  className="crm-input"
                  value={sendSubject}
                  onChange={event => setSendSubject(event.target.value)}
                />

                <label className="qc-workspace-info-label">Lá»i nháº¯n</label>
                <textarea
                  className="qc-workspace-handoff-note"
                  rows={3}
                  value={sendMessage}
                  onChange={event => setSendMessage(event.target.value)}
                  placeholder="Lá»i nháº¯n gá»­i kÃ¨m bÃ¡o giÃ¡..."
                />

                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Public link</span>
                  <a href={quote.publicUrl || '#'} target="_blank" rel="noreferrer">{quote.publicUrl}</a>
                </div>

                <label className="qc-workspace-checklist-item" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={sendAttachPdf} onChange={event => setSendAttachPdf(event.target.checked)} />
                  <span>ÄÃ­nh kÃ¨m PDF (tá»± render tá»« báº£n khÃ¡ch hÃ ng)</span>
                </label>

                {sendError ? (
                  <div className="qc-workspace-note-box qc-workspace-note-box--warn">{sendError}</div>
                ) : null}
              </>
            )}

            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={sendBusy} onClick={() => setSendModalOpen(false)}>
                {sendSuccess ? 'ÄÃ³ng' : 'Huá»·'}
              </button>
              {!sendSuccess ? (
                <button
                  type="button"
                  className="qc-btn qc-btn-primary"
                  disabled={sendBusy || !sendRecipientEmail.trim()}
                  aria-busy={sendBusy}
                  onClick={() => void submitSendQuote()}
                >
                  {sendBusy ? (<><span className="qc-btn-spinner" aria-hidden="true" /> Äang gá»­iâ€¦</>) : sendError ? 'Thá»­ láº¡i' : 'Gá»­i bÃ¡o giÃ¡'}
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
            <h3>Duyá»‡t bÃ¡o giÃ¡</h3>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">MÃ£ bÃ¡o giÃ¡/version</span>
              <strong>{quote.quoteNumber} Â· V{quote.versionNumber || 1}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">NgÆ°á»i gá»­i duyá»‡t</span>
              <strong>{ownerNameFor(quote.quoteOwnerId) === 'ChÆ°a gÃ¡n' ? nameFor(quote.createdById) : ownerNameFor(quote.quoteOwnerId)}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Tá»•ng thanh toÃ¡n</span>
              <strong>{formatMoney(quote.totalAmount)}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Margin</span>
              <strong className={marginBelowThreshold ? 'qc-cell-margin-warn' : hasCostData ? 'qc-cell-margin-good' : ''}>
                {hasCostData && quote.grossMarginPercent != null ? formatPercentTrim(quote.grossMarginPercent) : 'ChÆ°a cÃ³ dá»¯ liá»‡u giÃ¡ vá»‘n'}
              </strong>
            </div>
            {marginBelowThreshold ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                Cáº£nh bÃ¡o: margin dÆ°á»›i ngÆ°á»¡ng tham chiáº¿u 20%.
              </div>
            ) : null}
            <div className="qc-workspace-note-box">
              Sau khi duyá»‡t, version {quote.versionNumber || 1} sáº½ bá»‹ khoÃ¡ â€” khÃ´ng sá»­a Ä‘Æ°á»£c ná»¯a, chá»‰ táº¡o Ä‘Æ°á»£c phiÃªn báº£n má»›i.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setApproveModalOpen(false)}>Huá»·</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} aria-busy={busy && activeAction === 'approve'} onClick={() => void approveNow()}>
                {actionButtonContent('approve', 'Duyá»‡t bÃ¡o giÃ¡')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && exceptionApprovalModal.open ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setExceptionApprovalModal({ open: false, reason: '', evaluation: null }); }}>
          <div className="qc-deal-picker">
            <h3>PhÃª duyá»‡t ngoáº¡i lá»‡</h3>
            <div className="qc-workspace-note-box qc-workspace-note-box--warn">
              BÃ¡o giÃ¡ {quote.quoteNumber} Â· V{quote.versionNumber || 1} chÆ°a Ä‘áº¡t Rule Engine
              {exceptionApprovalModal.evaluation?.result === 'insufficient_data' ? ' (chÆ°a Ä‘á»§ dá»¯ liá»‡u Ä‘á»ƒ Ä‘Ã¡nh giÃ¡)' : ''}.
              Báº¡n Ä‘ang duyá»‡t NGOáº I Lá»† â€” báº¯t buá»™c nháº­p lÃ½ do, quyáº¿t Ä‘á»‹nh nÃ y sáº½ Ä‘Æ°á»£c ghi láº¡i trong lá»‹ch sá»­.
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
              <span className="qc-workspace-info-label">LÃ½ do phÃª duyá»‡t ngoáº¡i lá»‡ (báº¯t buá»™c)</span>
              <textarea
                className="qc-workspace-handoff-note"
                rows={3}
                value={exceptionApprovalModal.reason}
                onChange={event => setExceptionApprovalModal(prev => ({ ...prev, reason: event.target.value }))}
                placeholder="Vd: KhÃ¡ch hÃ ng chiáº¿n lÆ°á»£c, cháº¥p nháº­n margin tháº¥p hÆ¡n ngÆ°á»¡ng Ä‘á»ƒ giá»¯ quan há»‡ dÃ i háº¡n."
              />
            </label>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setExceptionApprovalModal({ open: false, reason: '', evaluation: null })}>Huá»·</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !exceptionApprovalModal.reason.trim()}
                aria-busy={busy && activeAction === 'approve'}
                onClick={() => void approveWithExceptionNow()}
              >
                {actionButtonContent('approve', 'Duyá»‡t ngoáº¡i lá»‡')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && publishModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPublishModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>PhÃ¡t hÃ nh bÃ¡o giÃ¡</h3>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Version</span>
              <strong>{quote.quoteNumber} Â· V{quote.versionNumber || 1}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Hiá»‡u lá»±c bÃ¡o giÃ¡</span>
              <strong>{quote.validUntil ? formatDate(quote.validUntil) : 'ChÆ°a Ä‘áº·t hiá»‡u lá»±c'}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Public link</span>
              {quote.publicUrl ? (
                <strong>ÄÃ£ báº­t â€” {window.location.origin}{quote.publicUrl}</strong>
              ) : (
                <strong>ChÆ°a báº­t</strong>
              )}
            </div>
            {quote.publicUrl ? (
              <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                <Link2 className="qc-icon" /> Sao chÃ©p public link
              </button>
            ) : null}
            <div className="qc-workspace-note-box">
              Sau khi phÃ¡t hÃ nh, version {quote.versionNumber || 1} sáº½ Ä‘Æ°á»£c khoÃ¡, public link sáº½ Ä‘Æ°á»£c báº­t tháº­t.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setPublishModalOpen(false)}>Huá»·</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} aria-busy={busy && activeAction === 'publish'} onClick={() => void publishNow()}>
                {actionButtonContent('publish', 'XÃ¡c nháº­n phÃ¡t hÃ nh')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && deliveryLogModal.open ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setDeliveryLogModal(m => ({ ...m, open: false })); }}>
          <div className="qc-deal-picker">
            <h3>Lá»‹ch sá»­ gá»­i bÃ¡o giÃ¡</h3>
            {deliveryLogModal.loading ? (
              <div className="qc-workspace-muted">Äang táº£i lá»‹ch sá»­ gá»­iâ€¦</div>
            ) : deliveryLogModal.error ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--warn">{deliveryLogModal.error}</div>
            ) : deliveryLogModal.entries.length === 0 ? (
              <div className="qc-workspace-muted">ChÆ°a cÃ³ láº§n gá»­i nÃ o.</div>
            ) : (
              <div className="qc-table-wrap">
                <table className="qc-linked-table">
                  <thead>
                    <tr>
                      <th>Thá»i gian</th>
                      <th>NgÆ°á»i nháº­n</th>
                      <th>NgÆ°á»i gá»­i</th>
                      <th>Tráº¡ng thÃ¡i</th>
                      <th>Láº§n thá»­</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryLogModal.entries.map(entry => (
                      <tr key={entry.id}>
                        <td>{entry.requestedAt ? formatDate(entry.requestedAt) : 'â€”'}</td>
                        <td>
                          {entry.recipientName || 'ChÆ°a rÃµ'}
                          {entry.recipientEmail ? <div className="qc-row-sub">{entry.recipientEmail}</div> : null}
                        </td>
                        <td>{nameFor(entry.requestedById)}</td>
                        <td>
                          <span className={`qc-badge qc-badge-${entry.status === 'sent' ? 'success' : entry.status === 'failed' ? 'danger' : 'neutral'}`}>
                            {entry.status === 'sent' ? 'ÄÃ£ gá»­i' : entry.status === 'failed' ? 'Tháº¥t báº¡i' : entry.status === 'sending' ? 'Äang gá»­i' : 'Äang chá»'}
                          </span>
                          {entry.status === 'failed' && entry.errorMessage ? <div className="qc-row-sub">{entry.errorMessage}</div> : null}
                        </td>
                        <td>{entry.attemptCount ?? 'â€”'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setDeliveryLogModal(m => ({ ...m, open: false }))}>ÄÃ³ng</button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && requestChangesModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setRequestChangesModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>YÃªu cáº§u chá»‰nh sá»­a</h3>
            <label className="qc-workspace-info-label">Chá»n pháº§n cáº§n sá»­a</label>
            <select className="crm-input" value={requestChangesSection} onChange={event => setRequestChangesSection(event.target.value as 'technical' | 'pricing')}>
              <option value="technical">ThÃ´ng tin ká»¹ thuáº­t</option>
              <option value="pricing">GiÃ¡ bÃ¡n</option>
            </select>
            <label className="qc-workspace-info-label">LÃ½ do (báº¯t buá»™c)</label>
            <textarea
              className="qc-workspace-handoff-note"
              rows={3}
              value={requestChangesReason}
              onChange={event => setRequestChangesReason(event.target.value)}
              placeholder="VÃ¬ sao cáº§n chá»‰nh sá»­a láº¡i..."
            />
            <div className="qc-workspace-note-box">
              BÃ¡o giÃ¡ sáº½ chuyá»ƒn lÃ¹i vá» Ä‘Ãºng bÆ°á»›c Ä‘Ã£ chá»n Ä‘á»ƒ chá»‰nh sá»­a láº¡i â€” chá»‰ Ã¡p dá»¥ng khi Ä‘ang á»Ÿ "Chá» duyá»‡t", chÆ°a duyá»‡t.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setRequestChangesModalOpen(false)}>Huá»·</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !requestChangesReason.trim()}
                aria-busy={busy && activeAction === 'requestChanges'}
                onClick={() => void requestChangesNow()}
              >
                {actionButtonContent('requestChanges', 'Gá»­i yÃªu cáº§u chá»‰nh sá»­a')}
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
                <option value="">ThÃªm vÃ o: Cuá»‘i báº£ng</option>
                {catalogSectionOptions.map(s => <option key={s.id} value={s.id}>ThÃªm vÃ o má»¥c: {s.label}</option>)}
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
          // "Khi Ä‘ang chá»n nhÃ³m VPS Hosting, báº¥m + Sáº£n pháº©m má»›i: Tá»± chá»n sáºµn
          // nhÃ³m VPS Hosting" - suy tu pickerGroupFilter (ten nhom dang loc
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
        title="Báº¡n cÃ³ thay Ä‘á»•i chÆ°a lÆ°u"
        message="Báº¡n cÃ³ muá»‘n thoÃ¡t vÃ  bá» cÃ¡c thay Ä‘á»•i nÃ y khÃ´ng?"
        cancelLabel="Tiáº¿p tá»¥c chá»‰nh sá»­a"
        onClose={() => setDiscardCloseConfirmOpen(false)}
        actions={[
          {
            label: 'Bá» thay Ä‘á»•i',
            variant: 'primary',
            onClick: confirmDiscardAndClose,
          },
        ]}
      />

      <ConfirmModal
        open={fillDownConfirm != null}
        title="Ghi Ä‘Ã¨ dÃ²ng Ä‘Ã£ cÃ³ giÃ¡ trá»‹"
        message={
          fillDownConfirm
            ? `${fillDownConfirm.targetIndices.filter(i => {
                const row = itemsDraft[i];
                return fillDownConfirm.field === 'costPrice' ? row.costPrice != null : row.markupPercent != null;
              }).length} trong sá»‘ ${fillDownConfirm.targetIndices.length} dÃ²ng Ä‘Ã£ cÃ³ ${fillDownConfirm.field === 'costPrice' ? 'giÃ¡ vá»‘n' : 'markup'} â€” Äiá»n xuá»‘ng sáº½ ghi Ä‘Ã¨ cÃ¡c dÃ²ng nÃ y. Tiáº¿p tá»¥c?`
            : ''
        }
        onClose={() => setFillDownConfirm(null)}
        actions={[
          {
            label: 'Äiá»n xuá»‘ng, ghi Ä‘Ã¨',
            variant: 'primary',
            onClick: () => fillDownConfirm && applyFillDown(fillDownConfirm.index, fillDownConfirm.field, fillDownConfirm.targetIndices, fillDownConfirm.mode),
          },
        ]}
      />

      <ConfirmModal
        open={markupApplyConfirm != null}
        title="Ghi Ä‘Ã¨ Markup Ä‘Ã£ cÃ³"
        message={
          markupApplyConfirm
            ? `${itemsDraft.filter(row => row.costPrice != null && row.markupPercent != null).length} háº¡ng má»¥c Ä‘Ã£ cÃ³ Markup â€” Ã¡p Markup ${markupApplyConfirm.percent}% sáº½ ghi Ä‘Ã¨ giÃ¡ bÃ¡n cÃ¡c dÃ²ng nÃ y. Tiáº¿p tá»¥c?`
            : ''
        }
        onClose={() => setMarkupApplyConfirm(null)}
        actions={[
          {
            label: 'Ãp dá»¥ng, ghi Ä‘Ã¨',
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
        title="Ghi Ä‘Ã¨ Margin Ä‘Ã£ cÃ³"
        message={
          marginApplyConfirm
            ? `${itemsDraft.filter(row => row.costPrice != null && row.markupPercent != null).length} háº¡ng má»¥c Ä‘Ã£ cÃ³ Markup/GiÃ¡ khÃ¡ch â€” Ã¡p Margin má»¥c tiÃªu ${marginApplyConfirm.percent}% sáº½ ghi Ä‘Ã¨ giÃ¡ bÃ¡n cÃ¡c dÃ²ng nÃ y. Tiáº¿p tá»¥c?`
            : ''
        }
        onClose={() => setMarginApplyConfirm(null)}
        actions={[
          {
            label: 'Ãp dá»¥ng, ghi Ä‘Ã¨',
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
        title="Sáº£n pháº©m Ä‘Ã£ cÃ³ trong báº£ng"
        message={
          catalogAdd.dedupQueue[0]
            ? `"${catalogAdd.dedupQueue[0].label}" Ä‘Ã£ cÃ³ sáºµn 1 dÃ²ng trong báº£ng háº¡ng má»¥c. Báº¡n muá»‘n tÄƒng sá»‘ lÆ°á»£ng dÃ²ng cÃ³ sáºµn hay váº«n thÃªm thÃ nh dÃ²ng má»›i?`
            : ''
        }
        onClose={() => catalogAdd.cancelDedup()}
        actions={[
          {
            label: 'TÄƒng sá»‘ lÆ°á»£ng dÃ²ng cÃ³ sáºµn',
            variant: 'primary',
            onClick: () => {
              const entry = catalogAdd.dedupQueue[0];
              catalogAdd.resolveDedup('increase', existingIndex => increaseExistingRowQty(existingIndex, entry?.candidate.item.quantity ?? 1));
            },
          },
          { label: 'Váº«n thÃªm dÃ²ng má»›i', onClick: () => catalogAdd.resolveDedup('addNew', () => {}) },
        ]}
      />

      <ConfirmModal
        open={zoneAdd.dedupQueue.length > 0}
        title="Sáº£n pháº©m Ä‘Ã£ cÃ³ trong báº£ng"
        message={
          zoneAdd.dedupQueue[0]
            ? `"${zoneAdd.dedupQueue[0].label}" Ä‘Ã£ cÃ³ sáºµn 1 dÃ²ng trong báº£ng háº¡ng má»¥c. Báº¡n muá»‘n tÄƒng sá»‘ lÆ°á»£ng dÃ²ng cÃ³ sáºµn hay váº«n thÃªm thÃ nh dÃ²ng má»›i?`
            : ''
        }
        onClose={() => zoneAdd.cancelDedup()}
        actions={[
          {
            label: 'TÄƒng sá»‘ lÆ°á»£ng dÃ²ng cÃ³ sáºµn',
            variant: 'primary',
            onClick: () => {
              const entry = zoneAdd.dedupQueue[0];
              zoneAdd.resolveDedup('increase', existingIndex => increaseExistingRowQty(existingIndex, entry?.candidate.item.quantity ?? 1));
            },
          },
          { label: 'Váº«n thÃªm dÃ²ng má»›i', onClick: () => zoneAdd.resolveDedup('addNew', () => {}) },
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
                <h3>Chi tiáº¿t giÃ¡ â€” Báº£ng giÃ¡ VPS Zone</h3>
                <button type="button" className="crm-icon-action" aria-label="ÄÃ³ng" onClick={() => setPriceBookDrawerIndex(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <p><strong>{drawerItem.serviceDescription || drawerItem.description}</strong></p>
                {costViewAllowed ? (
                  <>
                    <p>Cháº¿ Ä‘á»™ giÃ¡ vá»‘n: {snap.costMode === 'usd' ? 'USD Ã— Tá»· giÃ¡' : 'VND trá»±c tiáº¿p'}</p>
                    {snap.costMode === 'usd' ? (
                      <>
                        <p>ÄÆ¡n giÃ¡ USD: {snap.unitPriceUsd ?? 'â€”'}</p>
                        <p>Tá»· giÃ¡: {snap.exchangeRate ?? 'â€”'}</p>
                        <p>Thuáº¿ nháº­p kháº©u: {snap.importDutyPercent ?? 0}%</p>
                      </>
                    ) : null}
                    <p>VAT Ä‘áº§u vÃ o: {snap.vatInPercent ?? 0}%</p>
                    <p>NhÃ  cung cáº¥p: {snap.vendorName || 'â€”'}</p>
                    <p>VAT Ä‘áº§u ra: {snap.vatEuPercent ?? 0}%</p>
                    <p>GiÃ¡ tham chiáº¿u: {snap.referencePrice != null ? formatMoney(snap.referencePrice) : 'â€”'}</p>
                    {snap.referenceLink ? <p>Link tham chiáº¿u: <a href={snap.referenceLink} target="_blank" rel="noreferrer">{snap.referenceLink}</a></p> : null}
                    {snap.quoteLink ? <p>Link/chá»©ng tá»« giÃ¡: <a href={snap.quoteLink} target="_blank" rel="noreferrer">{snap.quoteLink}</a></p> : null}

                    <hr />
                    <p>
                      GiÃ¡ vá»‘n hiá»‡n táº¡i: <strong>{drawerItem.costPrice != null ? formatMoney(drawerItem.costPrice) : 'â€”'}</strong>
                      {hasOverride ? <span className="qc-row-sub"> Â· ÄÃ£ Ä‘iá»u chá»‰nh (gá»‘c: {formatMoney(drawerItem.costPriceOriginal || 0)})</span> : null}
                    </p>
                    {drawerItem.costOverrideReason ? (
                      <p className="qc-row-sub">
                        LÃ½ do: {drawerItem.costOverrideReason} â€” {drawerItem.costOverrideAt ? new Date(drawerItem.costOverrideAt).toLocaleString('vi-VN') : ''}
                      </p>
                    ) : null}

                    {canEditCostCells ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" className="qc-btn" onClick={() => setCostOverrideModal({ index: priceBookDrawerIndex, reason: '', value: drawerItem.costPrice ?? null })}>
                          Ghi Ä‘Ã¨ giÃ¡ vá»‘n (cÃ³ lÃ½ do)
                        </button>
                        {hasOverride ? (
                          <button type="button" className="qc-btn" onClick={() => restoreCostFormula(priceBookDrawerIndex)}>
                            KhÃ´i phá»¥c theo cÃ´ng thá»©c
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem giÃ¡ vá»‘n.</p>
                )}
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setPriceBookDrawerIndex(null)}>ÄÃ³ng</button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {/* Popover "Chá»‰nh sá»­a mÃ´ táº£ háº¡ng má»¥c" - NHO gon (khong phai drawer to),
       * gom: Ten hang muc (chi doc) + Textarea "MÃ´ táº£ háº¡ng má»¥c" + Huá»·/LÆ°u.
       * Luu vao DUNG quote_item.description (KHONG dung featuresIncluded,
       * KHONG tao field DB moi) - dung DUNG persistQuote({items:next}) de
       * tranh doc lai itemsDraft cu (xem giai thich o saveDescriptionPopover). */}
      {descriptionPopoverIndex != null && itemsDraft[descriptionPopoverIndex] ? (() => {
        const descItem = itemsDraft[descriptionPopoverIndex];
        const canEditDescription = canEdit && isDraft && !isLockedForReview;
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setDescriptionPopoverIndex(null); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 460 }}>
              <div className="qc-workspace-modal-head">
                <h3>MÃ´ táº£ háº¡ng má»¥c</h3>
                <button type="button" className="crm-icon-action" aria-label="ÄÃ³ng" onClick={() => setDescriptionPopoverIndex(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <div className="qc-workspace-drawer-field">
                  <span className="qc-workspace-info-label">TÃªn háº¡ng má»¥c</span>
                  <p>{descItem.serviceDescription || 'â€”'}</p>
                </div>
                <label className="qc-workspace-drawer-field">
                  <span className="qc-workspace-info-label">Ná»™i dung cÃ´ng viá»‡c</span>
                  <textarea
                    className="qc-cell-input"
                    rows={5}
                    value={descriptionDraftText}
                    disabled={!canEditDescription}
                    placeholder={canEditDescription ? 'Nháº­p mÃ´ táº£ háº¡ng má»¥c...' : 'ChÆ°a cÃ³ mÃ´ táº£.'}
                    onChange={e => setDescriptionDraftText(e.target.value)}
                  />
                </label>
                <label className="qc-workspace-drawer-field">
                  <span className="qc-workspace-info-label">Pháº¡m vi báº£o hÃ nh</span>
                  <textarea className="qc-cell-input" rows={5} value={warrantyDraftText} disabled={!canEditDescription}
                    placeholder="Nháº­p pháº¡m vi báº£o hÃ nh riÃªng cho háº¡ng má»¥c..." onChange={e => setWarrantyDraftText(e.target.value)} />
                </label>
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setDescriptionPopoverIndex(null)}>
                  {canEditDescription ? 'Huá»·' : 'ÄÃ³ng'}
                </button>
                {canEditDescription ? (
                  <button type="button" className="qc-btn qc-btn-primary" onClick={saveDescriptionPopover}>
                    LÆ°u
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
          ? 'Báº£ng giÃ¡ VPS Zone'
          : drawerItem.catalogItemId
            ? 'Danh má»¥c dá»‹ch vá»¥'
            : 'Nháº­p tay';
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
                <h3>Chi tiáº¿t háº¡ng má»¥c</h3>
                <button type="button" className="crm-icon-action" aria-label="ÄÃ³ng" onClick={() => closeItemDetailDrawer('discard')}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <label className="qc-workspace-drawer-field">
                  TÃªn háº¡ng má»¥c
                  {drawerEditableTechnical ? (
                    <input
                      className="qc-cell-input"
                      value={drawerItem.serviceDescription || ''}
                      onChange={e => updateRow(drawerIndex, { serviceDescription: e.target.value })}
                    />
                  ) : (
                    <p>{drawerItem.serviceDescription || 'â€”'}</p>
                  )}
                </label>
                <label className="qc-workspace-drawer-field">
                  ÄÆ¡n vá»‹ tÃ­nh (ÄVT)
                  {drawerEditableTechnical ? (
                    <input
                      className="qc-cell-input"
                      value={drawerItem.unit || ''}
                      onChange={e => updateRow(drawerIndex, { unit: e.target.value })}
                      placeholder="GÃ³i, ThÃ¡ng..."
                    />
                  ) : (
                    <p>{drawerItem.unit || 'â€”'}</p>
                  )}
                </label>
                <label className="qc-workspace-drawer-field">
                  Sá»‘ lÆ°á»£ng
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
                <p>Nguá»“n gá»‘c: <strong>{sourceLabel}</strong></p>
                {costViewAllowed ? (
                  <>
                    <label className="qc-workspace-drawer-field">
                      GiÃ¡ vá»‘n/ÄV
                      {drawerEditableTechnical ? (
                        <CurrencyInput
                          className="qc-cell-input"
                          value={drawerItem.costPrice ?? null}
                          disabled={drawerItem.costNotApplicable}
                          onChange={value => handleCostPriceChange(drawerIndex, value)}
                        />
                      ) : (
                        <p>{drawerItem.costNotApplicable ? 'KhÃ´ng Ã¡p dá»¥ng' : drawerItem.costPrice != null ? formatMoney(drawerItem.costPrice) : 'CÃ²n thiáº¿u'}</p>
                      )}
                    </label>
                  </>
                ) : (
                  <p className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem giÃ¡ vá»‘n.</p>
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
                  <p className="qc-row-sub">KhÃ´ng cÃ³ quyá»n xem markup.</p>
                )}
                {drawerEditableTechnical || drawerEditablePricing ? (
                  <p className="qc-row-sub">Sá»­a xong báº¥m &quot;LÆ°u&quot; â€” Ä‘Ã³ng báº±ng X/&quot;Huá»·&quot; sáº½ KHÃ”NG lÆ°u cÃ¡c thay Ä‘á»•i á»Ÿ trÃªn.</p>
                ) : null}
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => closeItemDetailDrawer('discard')}>Huá»·</button>
                {drawerEditableTechnical || drawerEditablePricing ? (
                  <button type="button" className="qc-btn qc-btn-primary" onClick={() => closeItemDetailDrawer('save')}>LÆ°u</button>
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
                <h3>Ghi Ä‘Ã¨ giÃ¡ vá»‘n</h3>
                <button type="button" className="crm-icon-action" aria-label="ÄÃ³ng" onClick={() => setCostOverrideModal(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <label className="qc-field">
                  <span>GiÃ¡ vá»‘n má»›i (VND)</span>
                  <CurrencyInput
                    className="qc-cell-input qc-cell-input-money"
                    value={costOverrideModal.value ?? targetItem?.costPrice ?? null}
                    onChange={value => setCostOverrideModal({ ...costOverrideModal, value })}
                  />
                </label>
                <label className="qc-field">
                  <span>LÃ½ do Ä‘iá»u chá»‰nh *</span>
                  <textarea
                    rows={2}
                    value={costOverrideModal.reason}
                    onChange={e => setCostOverrideModal({ ...costOverrideModal, reason: e.target.value })}
                  />
                </label>
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setCostOverrideModal(null)}>Huá»·</button>
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
                  LÆ°u
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
