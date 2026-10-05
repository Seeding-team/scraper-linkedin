'use client';

/**
 * Trang "Chi tiết báo giá" (/all-platform/crm/quotes/[id], /all-platform/quotes/[id]).
 *
 * 100% dữ liệu THẬT theo quote_id — không mock / hard-code / fallback bịa. Mọi con số, tên, trạng thái
 * dùng CÙNG nguồn và CÙNG công thức với Quote Workspace (QuoteWorkspaceModal):
 *  - Khách hàng / Cơ hội : quote.data.customerCompanyName → deal (customer_leads) giống Workspace
 *  - Người phụ trách      : quote.technicalOwner (Presale) / quote.quoteOwner (Sale)
 *  - Totals               : calculateOverallDiscountSummary(quote totals, overallDiscountPercent) giống liveCommercialSummary
 *  - Giá vốn / Margin     : cộng từ hạng mục (qty × costPrice), quyền xem theo costViewAllowed/pricingViewAllowed của server
 *  - Phê duyệt / lịch sử  : quote_activity_log (stage_changed / approved…) + processingStage
 *  - Điều khoản           : quote.data.customBlocks / paymentPlan / validityDays + VAT thật của từng dòng
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  Clock,
  Send,
  ExternalLink,
  Plus,
  Printer,
  ShieldAlert,
  Building2,
  Target,
  User,
  History,
} from 'lucide-react';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import { seedingContractRepository } from '@/modules/contracts/repositories/SeedingContractRepository';
import { seedingCrmRepository } from '@/modules/crm/repositories/SeedingCrmRepository';
import type { Quote, QuoteActivityLogEntry, QuoteItem } from '../types';
import type { Contract } from '@/modules/contracts';
import type { CrmUserOption, Deal } from '@/modules/crm/types';
import { RegisterExternalContractModal } from '@/components/all-platform/customers/RegisterExternalContractModal';
import { getPackageText, getServicePackageText } from '@/modules/crm/constants/crmConfig';
import { quoteDisplayStatus } from '@/modules/crm/utils/quoteDisplay';
import { Button } from '@/components/ui/button';
import { formatQuoteMoney } from '@/lib/currency';
import { calculateItemTotal, calculateOverallDiscountSummary, calculateSectionTotal } from '../utils/quoteCalculations';
import { ACTIVITY_LABELS, PROCESSING_STAGE_LABELS } from '../utils/quoteActivity';
import { paymentPlanAmount } from '../utils/paymentPlan';

const PLACEHOLDER = '—';

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function relativeTime(dateStr?: string | null): string {
  if (!dateStr) return PLACEHOLDER;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return PLACEHOLDER;
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return 'Vừa xong';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
  return `${Math.floor(diffSec / 86400)} ngày trước`;
}

function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return PLACEHOLDER;
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

/** "SKU - Tên" (cách catalog đặt serviceDescription khi thêm vào báo giá) → tách SKU; không khớp thì không có SKU. */
function splitSku(text?: string | null): { sku: string | null; name: string } {
  const raw = (text || '').trim();
  const m = raw.match(/^([A-Za-z0-9][A-Za-z0-9._/]*(?:-[A-Za-z0-9._/]+)+)\s+[-–—]\s+(.+)$/);
  return m ? { sku: m[1], name: m[2] } : { sku: null, name: raw };
}

interface Props {
  quoteId: string;
}

export function InternalQuoteWorkspacePage({ quoteId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dealIdParam = searchParams.get('dealId');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [activity, setActivity] = useState<QuoteActivityLogEntry[]>([]);
  const [agents, setAgents] = useState<CrmUserOption[]>([]);
  const [linkedContract, setLinkedContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const [createContractOpen, setCreateContractOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');

    async function loadData() {
      try {
        const loadedQuote = await seedingQuoteRepository.getQuote(quoteId);
        if (!alive) return;
        setQuote(loadedQuote);

        // Chạy song song các nguồn phụ; lỗi từng nguồn không làm hỏng trang (hiển thị "—", KHÔNG bịa dữ liệu).
        const targetDealId = loadedQuote.dealId || dealIdParam;
        const [dealRes, logRes, agentRes, contractRes] = await Promise.allSettled([
          targetDealId ? seedingCrmRepository.getDeal(targetDealId) : Promise.resolve(null),
          seedingQuoteRepository.getQuoteActivityLog(loadedQuote.id),
          seedingCrmRepository.getAgents(),
          seedingContractRepository.getContracts({ quoteId: loadedQuote.id }),
        ]);
        if (!alive) return;
        if (dealRes.status === 'fulfilled') setDeal(dealRes.value);
        if (logRes.status === 'fulfilled') setActivity(logRes.value || []);
        if (agentRes.status === 'fulfilled') setAgents(agentRes.value || []);
        if (contractRes.status === 'fulfilled' && contractRes.value?.length) setLinkedContract(contractRes.value[0]);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được chi tiết báo giá.');
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadData();
    return () => {
      alive = false;
    };
  }, [quoteId, dealIdParam]);

  const currency = quote?.currency;
  const money = (value: number | null | undefined) => formatQuoteMoney(value ?? 0, currency);

  const agentName = (id?: string | null) => (id ? agents.find(a => a.id === id)?.name || null : null);

  const isApproved = useMemo(() => {
    if (!quote) return false;
    const st = (quote.status || '').toLowerCase();
    return st === 'approved' || st === 'confirmed';
  }, [quote]);

  // Smart Back navigation
  const rawReturnUrl = searchParams.get('returnUrl');
  const returnUrl = rawReturnUrl?.startsWith('/all-platform/') ? rawReturnUrl : null;
  const paramCustomerId = searchParams.get('customerId');
  const customerId = deal?.customerId || quote?.accountId || paramCustomerId;
  const dealId = quote?.dealId || dealIdParam;

  const backHref = useMemo(() => {
    if (returnUrl) return returnUrl;
    if (customerId && dealId) return `/all-platform/crm/customers/${customerId}?tab=deals&dealId=${encodeURIComponent(dealId)}`;
    if (customerId) return `/all-platform/crm/customers/${customerId}?tab=quotes`;
    if (dealId) return `/all-platform/crm?openDeal=${encodeURIComponent(dealId)}`;
    return '/all-platform/quote-center';
  }, [returnUrl, customerId, dealId]);

  const handleBack = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (returnUrl) {
      router.replace(returnUrl);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(backHref);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="flex items-center gap-3 bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-slate-600 text-sm font-medium">
          <div className="size-5 border-2 border-[#c2185b] border-t-transparent rounded-full animate-spin" />
          <span>Đang tải chi tiết báo giá...</span>
        </div>
      </main>
    );
  }

  if (error || !quote) {
    return (
      <main className="min-h-screen bg-white p-6 flex flex-col items-center justify-center">
        <div className="bg-white border border-rose-200 rounded-xl p-6 max-w-md w-full text-center space-y-3 shadow-sm">
          <ShieldAlert className="size-10 text-rose-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Lỗi tải báo giá</h2>
          <p className="text-xs text-slate-500">{error || 'Không tìm thấy báo giá yêu cầu.'}</p>
          <Button variant="outline" size="sm" className="mt-2 text-xs cursor-pointer" onClick={handleBack}>
            ← Quay lại
          </Button>
        </div>
      </main>
    );
  }

  // ───────────────────────── dữ liệu dẫn xuất (cùng nguồn/công thức với Quote Workspace) ─────────────────────────
  const quoteData = (quote.data || {}) as Record<string, any>;
  const rootItems: QuoteItem[] = quote.items || [];
  const flatItems = rootItems.flatMap(item => (item.rowType === 'section' ? item.children || [] : [item])).filter(i => i.rowType !== 'section');
  const costViewAllowed = quote.costViewAllowed !== false;
  const pricingViewAllowed = quote.pricingViewAllowed !== false;
  const profitViewAllowed = quote.profitabilityViewAllowed !== false;

  const customerLabel = String(quoteData.customerCompanyName || deal?.companyName || deal?.customerName || '').trim() || PLACEHOLDER;
  const opportunityLabel = deal ? [deal.customerName, deal.companyName].filter(Boolean).join(' · ') || PLACEHOLDER : PLACEHOLDER;
  const servicePackage = deal ? getServicePackageText(deal.servicePackage) || getPackageText(deal.package) : '';

  const presaleName = quote.technicalOwner?.name || agentName(quote.technicalOwnerId) || null;
  const saleName = quote.quoteOwner?.name || quote.quoteOwnerName || agentName(quote.quoteOwnerId) || null;

  // Totals — y hệt liveCommercialSummary của Workspace
  const rawTotals = { totalAmount: quote.totalAmount ?? 0, totalVatAmount: quote.vatAmount ?? 0 };
  const summary = calculateOverallDiscountSummary(rawTotals, quote.overallDiscountPercent ?? null, currency);
  const costTotals = flatItems.map(item => {
    if (item.costNotApplicable) return 0;
    if (item.costPrice != null && Number.isFinite(Number(item.costPrice))) return Math.max(0, Number(item.costPrice)) * Math.max(0, Number(item.quantity) || 0);
    return null;
  });
  const numericCost = costTotals.filter((v): v is number => v != null);
  const hasCostData = flatItems.length > 0 && numericCost.length > 0;
  const totalCost = hasCostData ? numericCost.reduce((a, b) => a + b, 0) : null;
  const netRevenue = summary.subtotalAfterDiscount;
  const grossProfit = hasCostData && totalCost != null ? netRevenue - totalCost : null;
  const grossMargin = grossProfit != null && netRevenue > 0 ? (grossProfit / netRevenue) * 100 : null;

  const display = quoteDisplayStatus(quote, deal || undefined);
  const stage = String(quote.processingStage || 'request').toLowerCase();
  const stageRank = ['request', 'technical', 'pricing', 'review', 'ready_to_publish', 'published'].indexOf(stage);
  const stageLabel = PROCESSING_STAGE_LABELS[stage] || stage;

  // ───────────────────────── Phê duyệt (từ quote_activity_log) ─────────────────────────
  const sortedLog = [...activity].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const firstStageEntry = (target: string) =>
    sortedLog.find(e => e.action === 'stage_changed' && (e.changes as { stage?: string } | null)?.stage === target);
  const approvalEntry = [...sortedLog].reverse().find(e => ['approved', 'approved_with_exception', 'auto_approved_by_rule_engine'].includes(e.action));
  const presaleEntry = firstStageEntry('pricing');
  const saleEntry = firstStageEntry('review');

  const approvalSteps = [
    {
      key: 'presale',
      label: 'Presale xác nhận input',
      done: isApproved || stageRank >= 2,
      who: agentName(presaleEntry?.actorId) || presaleName,
      at: presaleEntry?.createdAt || null,
      waiting: presaleName ? `Chờ ${presaleName}` : 'Chưa gán Presale',
    },
    {
      key: 'sale',
      label: 'Sale xác nhận giá bán',
      done: isApproved || stageRank >= 3,
      who: agentName(saleEntry?.actorId) || saleName,
      at: saleEntry?.createdAt || null,
      waiting: saleName ? `Chờ ${saleName}` : 'Chưa gán Sale',
    },
    {
      key: 'manager',
      label: 'Manager duyệt margin',
      done: isApproved,
      who: approvalEntry?.action === 'auto_approved_by_rule_engine' ? 'Rule Engine' : agentName(approvalEntry?.actorId || quote.approvedById) || null,
      at: approvalEntry?.createdAt || quote.approvedAt || null,
      waiting: stageRank >= 3 ? 'Chờ phê duyệt' : 'Chưa đến bước duyệt',
    },
  ];

  const approvalBoxLabel = isApproved ? 'Đã duyệt' : stage === 'review' ? 'Chờ duyệt' : `Đang ở: ${stageLabel}`;

  // ───────────────────────── Điều khoản thương mại (từ data thật) ─────────────────────────
  const blocks = (Array.isArray(quoteData.customBlocks) ? quoteData.customBlocks : []) as Array<{ id?: string; kind: string; title?: string; content?: string }>;
  const blockByKind = (kind: string) => blocks.find(b => b.kind === kind && (b.content || '').trim());
  const paymentTerms = blockByKind('payment_terms')?.content?.trim() || '';
  const timeline = blockByKind('timeline')?.content?.trim() || '';
  const otherBlocks = blocks.filter(b => !['payment_terms', 'timeline'].includes(b.kind) && (b.content || '').trim());
  const paymentPlan = (Array.isArray(quoteData.paymentPlan) ? quoteData.paymentPlan : []) as Array<{ id: string; phase: string; percent: number; condition?: string; note?: string }>;
  const validity = quoteData.validityDays ? `${quoteData.validityDays} ngày` : quote.validUntil ? `đến ${formatDate(quote.validUntil)}` : '';
  const vatRates = Array.from(new Set(flatItems.map(i => Number(i.vatRate ?? 0)))).sort((a, b) => a - b);
  const vatText = vatRates.length ? vatRates.map(v => `${v}%`).join(' / ') : '';

  // ───────────────────────── Hành động "Gửi duyệt" thật (cùng RPC với Workspace) ─────────────────────────
  const canSubmitForReview = !isApproved && quote.status === 'draft' && stage === 'pricing';
  const submitForReview = async () => {
    setUpdatingStatus(true);
    try {
      const updated = await seedingQuoteRepository.setQuoteProcessingStage(quote.id, 'review');
      setQuote(updated);
      const log = await seedingQuoteRepository.getQuoteActivityLog(quote.id).catch(() => null);
      if (log) setActivity(log);
    } catch (e) {
      alert('Lỗi gửi duyệt: ' + (e as Error).message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const renderItemRow = (item: QuoteItem, idx: string, indent = false) => {
    const { sku, name } = splitSku(item.serviceDescription || item.description);
    const detail = item.serviceDescription && item.description && item.description !== item.serviceDescription ? item.description : '';
    const qty = Number(item.quantity) || 0;
    const unit = item.unitPrice;
    const cost = item.costNotApplicable ? 0 : item.costPrice;
    const rowMargin = unit != null && unit > 0 && cost != null ? ((unit - cost) / unit) * 100 : null;
    return (
      <tr key={item.id || idx} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80 transition-colors">
        <td className="py-3.5 px-3 font-mono text-[11px] text-slate-500 font-medium">{sku || PLACEHOLDER}</td>
        <td className={`py-3.5 px-3 text-slate-900 max-w-xs ${indent ? 'pl-6' : ''}`}>
          <div className="font-bold text-slate-900">{name || PLACEHOLDER}</div>
          {detail ? <div className="text-[11px] text-slate-400 font-normal mt-0.5 leading-relaxed whitespace-pre-line">{detail}</div> : null}
        </td>
        <td className="py-3.5 px-3 text-slate-600">{item.unit || PLACEHOLDER}</td>
        <td className="py-3.5 px-3 text-center font-bold text-slate-800">{qty}</td>
        <td className="py-3.5 px-3 text-right font-medium text-slate-700">
          {!costViewAllowed ? <span className="text-slate-400">Không có quyền xem</span> : item.costNotApplicable ? 'Không áp dụng' : cost != null ? money(cost) : PLACEHOLDER}
        </td>
        <td className="py-3.5 px-3 text-right font-medium text-slate-700">
          {!pricingViewAllowed ? <span className="text-slate-400">Không có quyền xem</span> : percent(item.markupPercent, 2)}
        </td>
        <td className="py-3.5 px-3 text-right font-bold text-slate-900">{unit != null ? money(unit) : PLACEHOLDER}</td>
        <td className="py-3.5 px-3 text-right font-bold text-slate-900">{money(calculateItemTotal(item, currency))}</td>
        <td className="py-3.5 px-3 text-right font-bold text-emerald-600">
          {!costViewAllowed ? <span className="text-slate-400">—</span> : percent(rowMargin)}
        </td>
      </tr>
    );
  };

  return (
    <main className="min-h-screen bg-white pb-16 text-slate-800 text-xs">
      {/* TOP HEADER / BREADCRUMB BAR */}
      <header className="bg-white border-b border-slate-200/90 shadow-2xs px-6 lg:px-8 py-3.5 sticky top-0 z-30">
        <div className="w-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <button type="button" onClick={handleBack} className="hover:text-slate-900 flex items-center gap-1.5 cursor-pointer text-slate-600 transition-colors">
              <ArrowLeft className="size-4" />
              <span className="font-semibold text-slate-800">Cơ hội</span>
            </button>
            <span className="text-slate-300">/</span>
            <span className="text-slate-400 font-normal">Báo giá {quote.quoteNumber}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href={`/all-platform/quotes/${quote.id}?view=document${dealId ? `&dealId=${encodeURIComponent(dealId)}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="h-8 text-xs font-medium border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5 cursor-pointer">
                <Printer className="size-3.5 text-slate-500" />
                <span>Mở báo giá (In / PDF)</span>
              </Button>
            </Link>

            {canSubmitForReview ? (
              <Button
                size="sm"
                className="h-8 text-xs font-bold bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 shadow-2xs cursor-pointer"
                onClick={submitForReview}
                disabled={updatingStatus}
              >
                <Send className="size-3.5" />
                <span>{updatingStatus ? 'Đang gửi...' : 'Gửi duyệt báo giá'}</span>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="w-full px-6 lg:px-8 pt-6 space-y-6">
        {/* HERO HEADER CARD */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
              <FileText className="size-6" />
            </div>

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">BÁO GIÁ</div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-extrabold text-slate-900">
                  {quote.quoteNumber}
                  {quoteData.quoteTitle ? ` • ${quoteData.quoteTitle}` : ''}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-600 border border-blue-200">
                  V{quote.versionNumber || 1}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    display.key === 'sent' || display.key === 'won'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : display.key === 'lost'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  {display.label}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">{stageLabel}</span>
                {currency && String(currency).toUpperCase() !== 'VND' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {String(currency).toUpperCase()}
                    {quote.exchangeRate ? ` · 1 USD = ${quote.exchangeRate.toLocaleString('vi-VN')} VND` : ''}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* 4 cột metadata */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1 text-xs">
            <div className="flex items-center gap-2.5">
              <Building2 className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Khách hàng</span>
                <span className="font-bold text-slate-800">{customerLabel}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Target className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Cơ hội</span>
                <span className="font-bold text-slate-800">{opportunityLabel}</span>
                {servicePackage ? <span className="text-[11px] text-slate-400 block">Gói dịch vụ: {servicePackage}</span> : null}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <User className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Người phụ trách</span>
                <span className="font-bold text-slate-800 block">Sale: {saleName || 'Chưa gán'}</span>
                <span className="text-[11px] text-slate-500 block">Presale: {presaleName || 'Chưa gán'}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Clock className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Cập nhật</span>
                <span className="font-bold text-slate-800 block">{relativeTime(quote.updatedAt || quote.createdAt)}</span>
                <span className="text-[11px] text-slate-400 block">{formatDateTime(quote.updatedAt || quote.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* 6 ô KPI */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 pt-2 text-xs">
            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">
                {quote.overallDiscountPercent ? 'Giá bán trước VAT (sau chiết khấu)' : 'Giá bán trước VAT'}
              </span>
              <span className="text-sm font-extrabold text-slate-900 block">{money(summary.subtotalAfterDiscount)}</span>
              {quote.overallDiscountPercent ? (
                <span className="text-[10px] text-slate-400 block">Trước CK {money(summary.subtotalBeforeVat)} · CK {quote.overallDiscountPercent}%</span>
              ) : null}
            </div>

            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">VAT{vatText ? ` (${vatText})` : ''}</span>
              <span className="text-sm font-extrabold text-slate-900 block">{money(summary.vatAfterDiscount)}</span>
            </div>

            <div className="bg-[#fff0f5] border border-rose-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-[#c2185b] font-bold block">Tổng thanh toán</span>
              <span className="text-base font-black text-[#c2185b] block">{money(summary.grandTotal)}</span>
            </div>

            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">Giá vốn</span>
              <span className={`${costViewAllowed && hasCostData ? 'text-sm font-extrabold text-slate-900' : 'text-xs font-semibold text-slate-400'} block`}>
                {!costViewAllowed ? 'Không có quyền xem' : hasCostData && totalCost != null ? money(totalCost) : 'Chưa có dữ liệu'}
              </span>
            </div>

            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">Margin</span>
              {!profitViewAllowed || !costViewAllowed ? (
                <span className="text-xs font-semibold text-slate-400 block">Không có quyền xem</span>
              ) : grossProfit != null && grossMargin != null ? (
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-extrabold text-emerald-600">{percent(grossMargin)}</span>
                  <span className="text-[10px] font-semibold text-emerald-600/80">({money(grossProfit)})</span>
                </div>
              ) : (
                <span className="text-xs font-semibold text-slate-400 block">Chưa có dữ liệu</span>
              )}
            </div>

            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">Phê duyệt</span>
              <span
                className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold mt-0.5 ${
                  isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {approvalBoxLabel}
              </span>
            </div>
          </div>
        </div>

        {/* 2 CỘT */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
          {/* TRÁI */}
          <div className="flex flex-col gap-6 min-w-0">
            {/* SẢN PHẨM / DỊCH VỤ */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-sm">Danh sách sản phẩm / dịch vụ</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">{flatItems.length} hạng mục</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-50/80 text-[11px] uppercase text-slate-400 font-bold">
                    <tr className="border-b border-slate-100">
                      <th className="py-2.5 px-3">SKU</th>
                      <th className="py-2.5 px-3">Sản phẩm / Dịch vụ</th>
                      <th className="py-2.5 px-3">ĐVT</th>
                      <th className="py-2.5 px-3 text-center">SL</th>
                      <th className="py-2.5 px-3 text-right">Giá vốn</th>
                      <th className="py-2.5 px-3 text-right">Markup</th>
                      <th className="py-2.5 px-3 text-right">Giá bán</th>
                      <th className="py-2.5 px-3 text-right">Thành tiền</th>
                      <th className="py-2.5 px-3 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rootItems.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">Báo giá chưa có hạng mục nào.</td>
                      </tr>
                    ) : (
                      rootItems.flatMap((item, idx) => {
                        if (item.rowType === 'section') {
                          const children = (item.children || []).filter(c => c.rowType !== 'section');
                          return [
                            <tr key={item.id || `section-${idx}`} className="bg-[#fdf1f4] border-b border-slate-100">
                              <td colSpan={7} className="py-2.5 px-3 font-bold text-slate-800">{item.description || item.serviceDescription || 'Mục'}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-800">{money(calculateSectionTotal(children, currency))}</td>
                              <td className="py-2.5 px-3" />
                            </tr>,
                            ...children.map((child, cIdx) => renderItemRow(child, `${idx}-${cIdx}`, true)),
                          ];
                        }
                        return [renderItemRow(item, String(idx))];
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ĐIỀU KHOẢN THƯƠNG MẠI */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded bg-rose-50 text-[#c2185b] flex items-center justify-center">
                    <FileText className="size-3.5" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">Điều khoản thương mại</h3>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 text-xs pt-1">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Thanh toán</span>
                  <span className="font-bold text-slate-900 text-xs whitespace-pre-line">{paymentTerms || PLACEHOLDER}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Hiệu lực báo giá</span>
                  <span className="font-bold text-slate-900 text-xs">{validity || PLACEHOLDER}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Thời gian triển khai</span>
                  <span className="font-bold text-slate-900 text-xs whitespace-pre-line">{timeline || PLACEHOLDER}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Thuế VAT</span>
                  <span className="font-bold text-slate-900 text-xs">{vatText || PLACEHOLDER}</span>
                </div>
              </div>

              {paymentPlan.length > 0 ? (
                <div className="pt-2">
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Kế hoạch thanh toán</span>
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      {paymentPlan.map(row => (
                        <tr key={row.id} className="border-b border-slate-100 last:border-b-0">
                          <td className="py-2 pr-3 font-semibold text-slate-800">{row.phase}</td>
                          <td className="py-2 pr-3 text-slate-600">{row.percent}%</td>
                          <td className="py-2 pr-3 text-slate-900 font-bold text-right">{money(paymentPlanAmount(summary.grandTotal, row.percent, currency))}</td>
                          <td className="py-2 pl-3 text-slate-500">{[row.condition, row.note].filter(Boolean).join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {otherBlocks.map(block => (
                <div key={block.id || `${block.kind}-${block.title}`} className="pt-1">
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">{block.title || block.kind}</span>
                  <span className="text-xs text-slate-800 whitespace-pre-line">{block.content}</span>
                </div>
              ))}
            </div>
          </div>

          {/* PHẢI */}
          <div className="flex flex-col gap-6 min-w-0">
            {/* PHÊ DUYỆT */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-900 text-sm">Phê duyệt</h3>
                <button
                  type="button"
                  className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                  onClick={() => setHistoryOpen(open => !open)}
                >
                  {historyOpen ? 'Ẩn lịch sử' : `Xem lịch sử (${activity.length})`}
                </button>
              </div>

              <div className="space-y-4 text-xs pt-1">
                {approvalSteps.map(step => {
                  const sub = step.done ? [formatDateTime(step.at), step.who].filter(Boolean).join(' · ') : step.waiting;
                  return (
                    <div key={step.key} className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        {step.done ? (
                          <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <div className="size-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">●</div>
                        )}
                        <div>
                          <span className="font-bold text-slate-900 block">{step.label}</span>
                          {sub ? <span className="text-[11px] text-slate-400 font-medium block mt-0.5">{sub}</span> : null}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${step.done ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {step.done ? 'Hoàn thành' : 'Chờ duyệt'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {historyOpen ? (
                <div className="border-t border-slate-100 pt-3 space-y-2.5 max-h-72 overflow-y-auto">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    <History className="size-3.5" /> Lịch sử hoạt động
                  </div>
                  {activity.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Chưa có hoạt động nào được ghi nhận.</p>
                  ) : (
                    [...activity]
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map(entry => {
                        const stageTarget = entry.action === 'stage_changed' ? (entry.changes as { stage?: string } | null)?.stage : '';
                        const label =
                          (ACTIVITY_LABELS[entry.action] || entry.action) +
                          (stageTarget ? ` → ${PROCESSING_STAGE_LABELS[stageTarget] || stageTarget}` : '');
                        return (
                          <div key={entry.id} className="text-[11px] leading-snug">
                            <span className="font-semibold text-slate-800">{agentName(entry.actorId) || 'Hệ thống'}</span>{' '}
                            <span className="text-slate-600">{label}</span>
                            <span className="block text-slate-400">{formatDateTime(entry.createdAt)}</span>
                          </div>
                        );
                      })
                  )}
                </div>
              ) : null}
            </div>

            {/* HỢP ĐỒNG */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <FileText className="size-4 text-[#c2185b]" />
                <h3 className="font-bold text-slate-900 text-sm">Hợp đồng</h3>
              </div>

              {linkedContract ? (
                <div className="space-y-2.5">
                  <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl">
                    <div className="font-bold text-slate-900 text-xs">{linkedContract.contractNumber || linkedContract.title}</div>
                    <p className="text-[11px] text-blue-700 mt-0.5 font-medium">
                      Đã tạo từ báo giá này • {formatQuoteMoney(linkedContract.contractValue ?? 0, linkedContract.currency || 'VND')}
                    </p>
                  </div>

                  <Link href={`/all-platform/contracts/${linkedContract.id}`}>
                    <Button variant="outline" size="sm" className="w-full h-8 text-xs font-medium border-blue-200 text-blue-700 hover:bg-blue-50 gap-1.5 cursor-pointer">
                      <ExternalLink className="size-3.5" />
                      <span>Mở hợp đồng</span>
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-[#fff0f5] border border-rose-100 rounded-xl p-3 flex items-center gap-2 text-slate-600 text-[11px] font-medium">
                    <div className="size-4 rounded bg-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
                      <FileText className="size-2.5" />
                    </div>
                    <span>Chưa có hợp đồng được tạo từ báo giá này.</span>
                  </div>

                  <Button
                    size="sm"
                    className="w-full h-9 text-xs font-bold bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 shadow-2xs rounded-xl cursor-pointer"
                    onClick={() => setCreateContractOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    <span>Tạo hợp đồng từ báo giá</span>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {createContractOpen && (
        <RegisterExternalContractModal
          open={createContractOpen}
          deal={
            {
              id: quote.dealId || '',
              customer_id: deal?.customerId || quote.accountId || '',
              customer_name: deal?.customerName || '',
              company_name: deal?.companyName || '',
              primary_contact_id: deal?.primaryContactId || null,
              project_id: quote.projectId || null,
            } as any
          }
          customerLabel={customerLabel === PLACEHOLDER ? '' : customerLabel}
          quoteOptions={[{ id: quote.id, label: `${quote.quoteNumber} · ${money(quote.totalAmount)}`, dealId: quote.dealId }]}
          onClose={() => setCreateContractOpen(false)}
          onCreated={newContract => {
            setLinkedContract(newContract);
            setCreateContractOpen(false);
            alert('Đã tạo hợp đồng thành công từ báo giá!');
          }}
        />
      )}
    </main>
  );
}
