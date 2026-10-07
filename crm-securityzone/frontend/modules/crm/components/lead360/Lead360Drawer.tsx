'use client';

/** Lead 360 - tong quan xu ly Lead (READ-ONLY) trong right drawer.
 *
 * Sale doc DU thong tin ngay tren 1 man (khong bat buoc click man con): thong tin Lead/Khach, Phu trach/Ban giao,
 * Viec hien tai (noi bat nhat), Co hoi/Du an, Bao gia day du, Hop dong, Tien do, Timeline.
 * Du lieu lay tu GET /crm/leads/{id}/overview (derive tu record that + nhat ky that, khong tao status gia).
 * Click card chi dung de xem sau/chinh sua/duyet: dung LAI cac drawer cua module Tien do
 * (ProgressDealDrawer/ProgressQuoteDrawer/ProgressContractDrawer/ProgressCustomerDrawer) trong CUNG drawer,
 * co breadcrumb + nut quay lai; dong child -> ve dung Lead 360.
 * Bo cuc theo muc uu tien: phan quan trong tren fold, phan chi tiet (thong tin Lead, timeline) co the thu gon. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, FileText, FileCheck, Building2, User, Target } from 'lucide-react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { ProgressRightDrawer } from '../progress/ProgressRightDrawer';
import { ProgressDealDrawer } from '../progress/ProgressDealDrawer';
import { ProgressQuoteDrawer } from '../progress/ProgressQuoteDrawer';
import { ProgressContractDrawer } from '../progress/ProgressContractDrawer';
import { ProgressCustomerDrawer } from '../progress/ProgressCustomerDrawer';
import type { ProgressContractItem, ProgressDealItem, ProgressQuoteItem } from '../progress/progress.types';
import { DEAL_STAGE_META } from '../../constants/crmConfig';
import { INTEREST_LEVEL_OPTIONS, interestLevelFromScore } from '../../utils/leadQualificationRules';
import { getSourceLabel } from '../DealFormFields';
import { LeadQuoteWorkspaceHost } from './LeadQuoteWorkspaceHost';
import type { DealDrawerExtra } from '../progress/ProgressDealDrawer';
// progress.css chi duoc nap boi trang Tien do -> nap o day de ProgressRightDrawer + cac drawer con co kieu dang tren trang Leads.
import '../progress/progress.css';
import '../../styles/quote-center.css';
import './lead360.css';

type Due = {
  dueAt: string;
  status: 'completed' | 'overdue' | 'due_soon' | 'in_progress';
  daysRemaining?: number;
  remainingHours?: number;
  overdueDays?: number;
  overdueHours?: number;
} | null;

type Step = { key: string; label: string; state: 'done' | 'current' | 'pending' | 'overdue' | 'out'; at: string | null; due: string | null; actor: string | null; note?: string | null };

type QuoteCard = {
  id: string; number: string | null; version: number; status: string | null; stage: string | null; stageLabel: string | null; phase: string | null; currency: string;
  mainItem: string | null; itemCount: number; items: Array<{ name: string | null; quantity: number | null; unit: string | null; amount: number | null }>; totalAmount: number | null; netRevenue: number | null; vatAmount: number | null;
  costTotal: number | null; grossProfit: number | null; marginPercent: number | null; markupPercent: number | null; costViewAllowed: boolean; profitabilityViewAllowed: boolean;
  presale: string | null; sale: string | null; technicalOwnerId: string | null; quoteOwnerId: string | null;
  sla: { startedAt: string | null; dueAt: string | null; completedAt: string | null; status: string };
  waitingOn: string | null;
  approval: { state: 'approved' | 'pending' | 'changes_requested' | 'not_yet'; label: string; approvedAt: string | null; approvedBy?: string | null; changesRequestedAt: string | null };
  createdAt: string | null; approvedAt: string | null; publishedAt: string | null; sentAt: string | null; updatedAt: string | null;
  /** Tien do RIENG cua bao gia nay (Yeu cau BG -> Presale -> Sale -> Cho duyet -> Bao gia -> Hop dong). */
  progress: Step[]; hasContract: boolean;
  /** Ket qua cua KHACH sau phat hanh: awaiting (dang cho phan hoi) | lost (Khong chot / OUT) - lay tu backend. */
  outcome?: { state: 'awaiting' | 'lost'; label: string; reasonLabel?: string | null; reasonOther?: string | null; note?: string | null; by?: string | null; at?: string | null } | null;
};

type ContractCard = {
  id: string; number: string | null; title: string | null; status: string | null; value: number | null; currency: string; signedAt: string | null; fileUrl: string | null;
  source: string | null; createdAt: string | null; dealId: string | null; quoteId: string | null; quoteNumber: string | null; startDate: string | null; endDate: string | null;
  ownerId: string | null; ownerName: string | null;
};

type Overview = {
  lead: {
    id: string; name: string | null; company: string | null; phone: string | null; email: string | null; status: string | null; statusLabel: string | null; source: string | null;
    position: string | null; need: string | null; estimatedValue: number | null; score: number | null; expectedTimeline: string | null; dealStage: string | null; note: string | null;
    nextStep: string | null; followUpDate: string | null; createdAt: string | null; converted: boolean; contactCode?: string | null; isOut?: boolean; outReason?: string | null;
  };
  customer: { id: string; name: string | null; code: string | null; taxCode: string | null; owner: string | null; team: string | null } | null;
  contact: { id: string; name: string | null; phone: string | null; email: string | null; position: string | null; contactCode?: string | null } | null;
  deal: {
    id: string; name: string | null; companyName: string | null; stage: string | null; estimatedBudget: number | null; stageEnteredAt: string | null; followUpDate: string | null;
    createdAt: string | null; nextStep: string | null; nextStepDue: Due; servicePackage: string | null; customerId: string | null; projectId: string | null; quoteId: string | null;
    sdrId: string | null; sdrName: string | null; leadedById: string | null; leadedByName: string | null; ownerTeam: string | null;
    project: { id: string; name: string | null; code: string | null } | null;
  } | null;
  sale: { id: string | null; name: string | null; team: string | null };
  presale: { id: string | null; name: string | null } | null;
  owner: { id: string | null; name: string | null; team: string | null };
  handover: {
    teamSale: string | null; sale: string | null; presale: string | null; handedOverBy: string | null; handedOverAt: string | null; nextStep: string | null;
    followUp: Due; followUpAt: string | null; documents: Array<{ title: string; url: string }>;
  };
  currentTask: { label: string; stepKey?: string; assignee: string | null; role: string | null; due: Due; nextStep: string | null; quoteId?: string; quoteNumber?: string | null; openQuotes?: number };
  steps: Step[];
  quotes: QuoteCard[];
  contracts: ContractCard[];
  timeline: Array<{ at: string; kind: string; title: string; actor: string | null; detail: string | null; ref?: string | null }>;
};

type Frame =
  | { type: 'lead' }
  | { type: 'deal'; item: ProgressDealItem; label: string }
  | { type: 'quote'; item: ProgressQuoteItem; label: string }
  | { type: 'contract'; item: ProgressContractItem; label: string }
  | { type: 'customer'; customerId: string; label: string };

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp', pending_legal: 'Chờ pháp lý', pending_signature: 'Chờ ký', signed: 'Đã ký', active: 'Hiệu lực', terminated: 'Đã chấm dứt', expired: 'Hết hạn',
};
const SLA_LABEL: Record<string, string> = {
  overdue: 'Quá hạn', due_soon: 'Sắp đến hạn', in_progress: 'Trong hạn', completed_on_time: 'Hoàn thành đúng hạn', completed_late: 'Hoàn thành trễ', not_set: 'Chưa đặt hạn',
};

function headers(): Record<string, string> {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}

function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(value?: number | null, currency = 'VND'): string {
  if (value == null) return '—';
  return currency === 'USD'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    : `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
}

/** "Còn 1 ngày" / "Còn 5 giờ" / "Quá hạn 2 ngày" / "Quá hạn 3 giờ". */
function dueText(due: Due): { text: string; tone: 'ok' | 'soon' | 'late' | 'done' } | null {
  if (!due) return null;
  if (due.status === 'completed') return { text: 'Đã hoàn thành', tone: 'done' };
  if (due.status === 'overdue') {
    const days = due.overdueDays ?? 0;
    return { text: days >= 1 ? `Quá hạn ${days} ngày` : `Quá hạn ${Math.max(1, due.overdueHours ?? 1)} giờ`, tone: 'late' };
  }
  const days = due.daysRemaining ?? 0;
  const text = days >= 1 ? `Còn ${days} ngày` : `Còn ${Math.max(1, due.remainingHours ?? 1)} giờ`;
  return { text, tone: due.status === 'due_soon' ? 'soon' : 'ok' };
}

function DueBadge({ due }: { due: Due }) {
  const t = dueText(due);
  return t ? <span className={`crm-l360-due crm-l360-due--${t.tone}`}>{t.text}</span> : null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="crm-l360-field">
      <span>{label}</span>
      <b>{children || '—'}</b>
    </div>
  );
}

export function Lead360Drawer({
  leadId,
  onClose,
  onOpenVerify,
  onOpenEdit,
  hidden = false,
  reloadKey = 0,
}: {
  leadId: string;
  onClose: () => void;
  /** Mo form Xac minh/Chi tiet Lead hien tai (cung right drawer shell, LeadsDirectory doi noi dung). */
  onOpenVerify: (leadId: string) => void;
  onOpenEdit: (leadId: string) => void;
  /** An di (Xac minh/Sua dang mo ben tren) nhung GIU state + scroll de Back quay ve nguyen trang thai. */
  hidden?: boolean;
  /** Doi gia tri -> refetch overview (sau khi luu o form con). */
  reloadKey?: number;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [stack, setStack] = useState<Frame[]>([{ type: 'lead' }]);
  // Quote Workspace THAT (overlay tren Lead 360): dong lai -> refetch overview ngay.
  const [workspaceQuoteId, setWorkspaceQuoteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(leadId)}/overview`, { credentials: 'include', headers: headers() });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không tải được tổng quan Lead.');
      setData(body.data as Overview);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Không tải được tổng quan Lead.');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  // Drawer persistent: doi Lead -> chi doi noi dung (ve Lead 360 cua Lead moi), KHONG dong drawer.
  useEffect(() => {
    setStack([{ type: 'lead' }]);
    setWorkspaceQuoteId(null);
    setData(null);
    void load();
  }, [load]);

  // Luu o form con (Xac minh/Sua) -> refetch du lieu moi (khong reset stack).
  useEffect(() => { if (reloadKey) void load(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Popup con (Quote Workspace) dang mo -> bao cho click-away cua danh sach Lead khong dong drawer.
  useEffect(() => {
    if (!workspaceQuoteId) return;
    document.body.setAttribute('data-crm-drawer-child', '1');
    return () => document.body.removeAttribute('data-crm-drawer-child');
  }, [workspaceQuoteId]);

  // An/hien khi form con mo o tren: giu nguyen vi tri cuon cua Lead 360.
  const rootRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  useEffect(() => {
    const body = rootRef.current?.querySelector<HTMLElement>('.progress-drawer-body');
    if (hidden) { if (body) savedScroll.current = body.scrollTop; return; }
    if (body && savedScroll.current) body.scrollTop = savedScroll.current;
  }, [hidden]);

  const push = (frame: Frame) => setStack(prev => [...prev, frame]);
  const back = () => setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const jump = (index: number) => setStack(prev => prev.slice(0, index + 1));

  const dealItem = useMemo<ProgressDealItem | null>(() => {
    if (!data?.deal) return null;
    const d = data.deal;
    const stageMeta = d.stage ? (DEAL_STAGE_META as Record<string, { label: string }>)[d.stage] : undefined;
    return {
      dealId: d.id, customerName: d.name, companyName: d.companyName, dealStage: d.stage, dealStageLabel: stageMeta?.label || d.stage,
      sinceAt: d.stageEnteredAt, estimatedBudgetVnd: Number(d.estimatedBudget || 0), followUpDate: d.followUpDate, quoteId: d.quoteId,
      projectId: d.projectId, customerId: d.customerId, sdrId: d.sdrId, sdrName: d.sdrName, leadedById: d.leadedById, leadedByName: d.leadedByName,
      deepLink: `/all-platform/crm?openDeal=${encodeURIComponent(d.id)}`,
    };
  }, [data]);

  function quoteItem(q: QuoteCard): ProgressQuoteItem {
    return {
      quoteId: q.id, quoteNumber: q.number, dealId: data?.deal?.id ?? null, projectId: data?.deal?.projectId ?? null,
      customerName: data?.customer?.name ?? data?.deal?.name ?? null, projectName: data?.deal?.project?.name ?? null,
      processingStage: q.stage || 'request', processingStageLabel: q.stageLabel || 'Yêu cầu báo giá',
      technicalOwnerId: q.technicalOwnerId, technicalOwnerName: q.presale, quoteOwnerId: q.quoteOwnerId, quoteOwnerName: q.sale,
      timeInCurrentStage: { sinceAt: q.updatedAt || q.createdAt },
      sla: q.sla as ProgressQuoteItem['sla'], totalAmountVnd: Number(q.totalAmount || 0), currency: q.currency,
      deepLink: `/all-platform/quote-center?quote=${encodeURIComponent(q.id)}`,
    };
  }

  function contractItem(c: ContractCard): ProgressContractItem {
    return {
      contractId: c.id, contractNumber: c.number, title: c.title, status: c.status, statusLabel: CONTRACT_STATUS_LABEL[c.status || ''] || c.status,
      sinceAt: c.createdAt, contractValueVnd: Number(c.value || 0), currency: c.currency, dealId: c.dealId, quoteId: c.quoteId,
      ownerId: c.ownerId, ownerName: c.ownerName, deepLink: `/all-platform/contracts/${encodeURIComponent(c.id)}`,
    };
  }

  /** Du lieu THAT cho bo cuc compact cua Co hoi (lay tu overview, khong goi nguon moi). */
  function dealExtra(d: Overview): DealDrawerExtra {
    return {
      contactName: d.contact?.name || d.lead.name,
      contactPosition: d.contact?.position || d.lead.position,
      projectName: d.deal?.project ? `${d.deal.project.name}${d.deal.project.code ? ` · ${d.deal.project.code}` : ''}` : null,
      teamName: d.deal?.ownerTeam || d.sale.team,
      createdAt: d.deal?.createdAt,
      nextStep: d.deal?.nextStep || d.currentTask.nextStep,
      followUpBadge: d.contracts.length ? null : <DueBadge due={d.deal?.nextStepDue ?? null} />,
      steps: d.steps.map(step => ({ key: step.key, label: step.label, state: step.state })),
      related: <RelatedRecords quotes={d.quotes} contracts={d.contracts} onOpenQuote={id => setWorkspaceQuoteId(id)} />,
    };
  }

  const top = stack[stack.length - 1];
  const leadLabel = data?.lead.name || 'Lead 360';
  const breadcrumb = stack.map(frame => (frame.type === 'lead' ? 'Lead 360' : frame.label)); // vd: Lead 360 / Cơ hội HANDEE

  let eyebrow = 'Lead 360';
  let content: React.ReactNode;
  if (top.type === 'deal') {
    eyebrow = 'Cơ hội';
    content = (
      <ProgressDealDrawer
        item={top.item}
        extra={data ? dealExtra(data) : undefined}
        onOpenCustomer={id => { window.location.href = `/all-platform/crm/customers/${id}`; }}
      />
    );
  } else if (top.type === 'quote') {
    eyebrow = top.item.processingStageLabel;
    content = <ProgressQuoteDrawer item={top.item} />;
  } else if (top.type === 'contract') {
    eyebrow = 'Hợp đồng';
    content = <ProgressContractDrawer item={top.item} />;
  } else if (top.type === 'customer') {
    eyebrow = 'Khách hàng';
    content = <ProgressCustomerDrawer customerId={top.customerId} />;
  } else {
    content = (
      <div className="crm-l360">
        {loading && !data ? <div className="crm-l360-state">Đang tải tổng quan…</div> : null}
        {error ? <div className="crm-l360-state crm-l360-state--error">{error} <button type="button" onClick={() => void load()}>Thử lại</button></div> : null}
        {data ? <Lead360Body data={data} onVerify={() => onOpenVerify(leadId)} onEdit={() => onOpenEdit(leadId)} push={push} dealItem={dealItem} quoteItem={quoteItem} onOpenWorkspace={setWorkspaceQuoteId} /> : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ display: hidden ? 'none' : 'contents' }}>
    <ProgressRightDrawer
      eyebrow={eyebrow}
      title={top.type === 'lead' ? leadLabel : top.label}
      subtitle={top.type === 'lead' ? (data?.lead.company || undefined) : undefined}
      onClose={onClose}
      onBack={stack.length > 1 ? back : undefined}
      breadcrumb={breadcrumb}
      onBreadcrumbClick={jump}
      persistent
    >
      {content}
    </ProgressRightDrawer>
    {workspaceQuoteId ? (
      <LeadQuoteWorkspaceHost
        quoteId={workspaceQuoteId}
        dealId={data?.deal?.id ?? null}
        customerId={data?.customer?.id ?? null}
        onChanged={() => void load()}
        onClose={() => { setWorkspaceQuoteId(null); void load(); }}
      />
    ) : null}
    </div>
  );
}

function Lead360Body({
  data, onVerify, onEdit, push, dealItem, quoteItem, onOpenWorkspace,
}: {
  data: Overview;
  onVerify: () => void;
  onEdit: () => void;
  push: (frame: Frame) => void;
  dealItem: ProgressDealItem | null;
  quoteItem: (q: QuoteCard) => ProgressQuoteItem;
  onOpenWorkspace: (quoteId: string) => void;
}) {
  const { lead, customer, contact, deal, sale, presale, owner, handover, currentTask, steps, quotes, contracts, timeline } = data;
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [expandedQuotes, setExpandedQuotes] = useState<Set<string>>(new Set());
  const [quoteSortOrder, setQuoteSortOrder] = useState<'desc' | 'asc'>('desc');
  const toggleQuote = (id: string) => setExpandedQuotes(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // Hoan tat CHI khi moi bao gia deu da co hop dong (1 bao gia co hop dong khong du de ket luan ca Lead xong).
  const finished = contracts.length > 0 && (currentTask.openQuotes ?? 0) === 0;

  // Sort Quote theo created_at (DESC = moi nhat truoc), tie-break bang ID neu trung gio tao.
  const sortedQuotes = useMemo(() => {
    if (!quotes || !quotes.length) return [];
    return [...quotes].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeA !== timeB) {
        return quoteSortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      }
      return quoteSortOrder === 'desc' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
    });
  }, [quotes, quoteSortOrder]);

  const newestQuoteId = useMemo(() => {
    if (!quotes || quotes.length < 2) return null;
    let newest = quotes[0];
    for (const q of quotes) {
      const tCurrent = q.createdAt ? new Date(q.createdAt).getTime() : 0;
      const tNewest = newest.createdAt ? new Date(newest.createdAt).getTime() : 0;
      if (tCurrent > tNewest || (tCurrent === tNewest && q.id > newest.id)) {
        newest = q;
      }
    }
    return newest.id;
  }, [quotes]);

  const oldestQuoteId = useMemo(() => {
    if (!quotes || quotes.length < 2) return null;
    let oldest = quotes[0];
    for (const q of quotes) {
      const tCurrent = q.createdAt ? new Date(q.createdAt).getTime() : 0;
      const tOldest = oldest.createdAt ? new Date(oldest.createdAt).getTime() : 0;
      if (tCurrent < tOldest || (tCurrent === tOldest && q.id < oldest.id)) {
        oldest = q;
      }
    }
    return oldest.id !== newestQuoteId ? oldest.id : null;
  }, [quotes, newestQuoteId]);

  // Accordion: chi 1 Co hoi / 1 Bao gia mo tai 1 thoi diem; chi co 1 record thi mo san.
  const [openDealId, setOpenDealId] = useState<string | null>(deal ? deal.id : null);
  const [openContractId, setOpenContractId] = useState<string | null>(contracts.length === 1 ? contracts[0].id : null);
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(quotes.length === 1 ? quotes[0].id : (currentTask.quoteId ?? null));
  const dueTxt = finished ? null : dueText(currentTask.due);
  const interest = INTEREST_LEVEL_OPTIONS.find(o => o.value === interestLevelFromScore(lead.score))?.label;
  const dealStageLabel = (stage?: string | null) => (stage ? ((DEAL_STAGE_META as Record<string, { label: string }>)[stage]?.label || stage) : null);
  const currentStep = quotes.find(q => q.id === currentTask.quoteId)?.progress.find(s => s.key === currentTask.stepKey) || steps.find(s => s.key === currentTask.stepKey);
  const shownTimeline = showAllTimeline ? timeline : timeline.slice(0, 8);

  return (
    <>
      {/* 1) Header khach/lead: ma KH, cong ty, lien he + chuc vu, SDT/email, nguon, trang thai */}
      <section className="crm-l360-card crm-l360-head">
        <div className="crm-l360-head-main">
          <div className="crm-l360-head-title">
            <span className="crm-l360-head-name crm-l360-head-name--company">
              <Building2 size={18} className="crm-l360-icon-company" /> {customer?.name || lead.company || lead.name}
            </span>
            {customer?.code ? <span className="crm-l360-chip crm-l360-chip--code" title="Mã khách hàng">{customer.code}</span> : null}
            <span className={`crm-l360-chip crm-l360-chip--status-${(lead.status || '').toLowerCase()}`}>{lead.statusLabel || lead.status || 'Lead'}</span>
            {lead.isOut ? <span className="crm-l360-chip crm-l360-chip--out" title="Cơ hội đã OUT (không còn báo giá nào hoạt động)">OUT</span> : null}
          </div>
          <div className="crm-l360-head-sub">
            <span>Liên hệ: <b>{contact?.name || lead.name || '—'}</b>{(contact?.position || lead.position) ? ` · ${contact?.position || lead.position}` : ''}</span>
            {(contact?.phone || lead.phone) ? <span>SĐT: <b>{contact?.phone || lead.phone}</b></span> : null}
            {(contact?.email || lead.email) ? <span>Email: <b>{contact?.email || lead.email}</b></span> : null}
            {lead.source ? <span>Nguồn: <b>{getSourceLabel(lead.source)}</b></span> : null}
          </div>
        </div>
        <div className="crm-l360-head-people">
          <div><span>Sale phụ trách</span><b>{sale.name || 'Chưa gán'}</b>{handover.teamSale ? <small>{handover.teamSale}</small> : null}</div>
          <div><span>Presale hiện tại</span><b>{presale?.name || '—'}</b></div>
          <div><span>Team / Owner</span><b>{owner.name || '—'}</b>{owner.team ? <small>{owner.team}</small> : null}</div>
        </div>
        <div className="crm-l360-head-cta">
          <button type="button" className="crm-l360-btn-verify" onClick={onVerify}>Xác minh / Chi tiết Lead</button>
          {customer ? (
            <button type="button" className="crm-l360-btn-customer" onClick={() => push({ type: 'customer', customerId: customer.id, label: customer.name || 'Khách hàng' })}>Mở hồ sơ khách hàng ↗</button>
          ) : null}
        </div>
      </section>

      {/* 2) VIEC HIEN TAI - noi bat nhat: dang o buoc nao -> ai giu -> han -> tre khong -> viec tiep theo */}
      <section className={`crm-l360-card crm-l360-task${dueTxt?.tone === 'late' ? ' is-late' : ''}`}>
        <p className="crm-l360-eyebrow">Việc hiện tại</p>
        <h3>{currentTask.label}</h3>
        <ol className="crm-l360-chain">
          <li><span>Đang ở bước</span><b>{currentStep?.label || '—'}</b></li>
          <li><span>Ai đang giữ</span><b>{currentTask.assignee || 'Chưa gán'}</b>{currentTask.role ? <small>{currentTask.role}</small> : null}</li>
          <li><span>Hạn lúc</span><b>{currentTask.due ? fmtDateTime(currentTask.due.dueAt) : '—'}</b></li>
          <li><span>Có trễ không</span><b>{finished ? 'Đã hoàn tất' : dueTxt ? <DueBadge due={currentTask.due} /> : 'Chưa đặt hạn'}</b></li>
          <li><span>Việc tiếp theo</span><b>{currentTask.nextStep || handover.nextStep || '—'}</b></li>
        </ol>
        {deal && !quotes.length ? (
          <div className="crm-l360-actions">
            <button type="button" className="crm-l360-btn crm-l360-btn--primary crm-l360-create-quote" onClick={() => onOpenWorkspace('new')}>+ Tạo yêu cầu báo giá</button>
          </div>
        ) : null}
      </section>

      {/* 3) Tien do: moi buoc co actor + moc thoi gian/deadline */}
      <section className="crm-l360-card">
        <p className="crm-l360-eyebrow">Tiến độ</p>
        <ol className="crm-l360-steps">
          {steps.map((step, index) => (
            <li key={step.key} className={`crm-l360-step crm-l360-step--${step.state}`}>
              <span className="crm-l360-step-dot">{step.state === 'done' ? '✓' : step.state === 'out' ? '✕' : index + 1}</span>
              <span className="crm-l360-step-label">{step.label}</span>
              <span className="crm-l360-step-state">{{ done: 'Hoàn thành', current: 'Đang xử lý', pending: 'Chưa tới', overdue: 'Quá hạn', out: 'OUT' }[step.state]}</span>
              {step.actor ? <span className="crm-l360-step-actor">{step.actor}</span> : null}
              {step.note ? <span className="crm-l360-step-note">{step.note}</span> : null}
              {step.at ? <span className="crm-l360-step-meta">{fmtDateTime(step.at)}</span> : null}
              {step.due ? <span className={`crm-l360-step-meta${step.state === 'overdue' ? ' is-late' : ''}`}>Hạn {fmtDateTime(step.due)}</span> : null}
            </li>
          ))}
        </ol>
        {sortedQuotes.length ? (
          <div className="crm-l360-qprogs">
            <p className="crm-l360-group-title">Tiến độ theo từng báo giá</p>
            {sortedQuotes.map(q => <QuoteProgressRow key={q.id} q={q} onOpen={() => setOpenQuoteId(q.id)} />)}
          </div>
        ) : null}
      </section>

      {/* 4) Phu trach / Ban giao */}
      <section className="crm-l360-card">
        <p className="crm-l360-eyebrow">Phụ trách &amp; bàn giao</p>
        <div className="crm-l360-fields">
          <Field label="Team Sale">{handover.teamSale}</Field>
          <Field label="Sale phụ trách">{handover.sale}</Field>
          <Field label="Presale hiện tại">{handover.presale}</Field>
          <Field label="Người bàn giao">{handover.handedOverBy}</Field>
          <Field label="Thời gian bàn giao">{handover.handedOverAt ? fmtDateTime(handover.handedOverAt) : null}</Field>
          <Field label="Việc tiếp theo">{handover.nextStep}</Field>
          <Field label="Follow-up / SLA">{handover.followUpAt ? <>{fmtDateTime(handover.followUpAt)} {finished ? null : <DueBadge due={handover.followUp} />}</> : null}</Field>
          <Field label="Tài liệu bàn giao">
            {handover.documents.length ? handover.documents.map(d => (
              <a key={d.url} className="crm-l360-doc" href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a>
            )) : <span className="crm-l360-nolink">Chưa có tài liệu bàn giao</span>}
          </Field>
        </div>
      </section>

      {/* 5) Co hoi / Du an */}
      <section className="crm-l360-card crm-l360-sec--deal">
        <p className="crm-l360-eyebrow crm-l360-eyebrow--deal">
          <Briefcase size={14} className="crm-l360-icon" /> Cơ hội / Dự án
        </p>
        {deal && dealItem ? (
          <div className="crm-l360-list">
            <div className={`crm-l360-acc crm-l360-row--deal${openDealId === deal.id ? ' is-active' : ''}`}>
              <button type="button" className="crm-l360-acc-head" aria-expanded={openDealId === deal.id} onClick={() => setOpenDealId(openDealId === deal.id ? null : deal.id)}>
                <span className="crm-l360-acc-caret">{openDealId === deal.id ? '▾' : '▸'}</span>
                <b className="crm-l360-acc-title">{deal.name || 'Cơ hội'}</b>
                <span className="crm-l360-chip">{dealStageLabel(deal.stage) || '—'}</span>
                <span className="crm-l360-val-money">{fmtMoney(deal.estimatedBudget)}</span>
                <span className="crm-l360-acc-sub">{deal.sdrName || deal.leadedByName || '—'}</span>
                {deal.nextStep && !finished ? <DueBadge due={deal.nextStepDue} /> : null}
              </button>
              {openDealId === deal.id ? (
                <div className="crm-l360-acc-body">
                  <div className="crm-l360-fields crm-l360-fields--tight crm-l360-fields--4col">
                    <Field label="Dự án">{deal.project ? <span className="crm-l360-val-code">{`${deal.project.name}${deal.project.code ? ` · ${deal.project.code}` : ''}`}</span> : 'Chưa gắn dự án'}</Field>
                    <Field label="Giai đoạn">{dealStageLabel(deal.stage)}</Field>
                    <Field label="Giá trị">{fmtMoney(deal.estimatedBudget) !== '—' ? <span className="crm-l360-val-money">{fmtMoney(deal.estimatedBudget)}</span> : '—'}</Field>
                    <Field label="Sale / Owner">{deal.sdrName || deal.leadedByName}{deal.ownerTeam ? ` · ${deal.ownerTeam}` : ''}</Field>
                    <Field label="Ngày tạo">{fmtDate(deal.createdAt)}</Field>
                    <Field label="Việc tiếp theo">{deal.nextStep ? `${deal.nextStep}${deal.followUpDate ? ` · ${fmtDateTime(deal.followUpDate)}` : ''}` : '—'}</Field>
                  </div>
                  <div className="crm-l360-actions">
                    <button type="button" className="crm-l360-btn crm-l360-btn--primary crm-l360-open-deal" onClick={() => push({ type: 'deal', item: dealItem, label: `Cơ hội ${deal.companyName || deal.name || ''}`.trim() })}>Xem chi tiết cơ hội</button>
                    <button type="button" className="crm-l360-btn" onClick={onVerify}>Sửa cơ hội</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : <p className="crm-l360-empty">Chưa có cơ hội (Lead chưa chuyển đổi).</p>}
      </section>

      {/* 6) Bao gia / Yeu cau bao gia: tom tat compact list row + SLA 1 badge duy nhat */}
      <section className="crm-l360-card crm-l360-sec--quote">
        <div className="crm-l360-sec-head">
          <p className="crm-l360-eyebrow crm-l360-eyebrow--quote">
            <FileText size={14} className="crm-l360-icon" /> Báo giá / Yêu cầu báo giá ({quotes.length})
          </p>
          {quotes.length > 1 ? (
            <div className="crm-l360-sort-toggle">
              <span className="crm-l360-sort-label">Sắp xếp:</span>
              <button
                type="button"
                className={`crm-l360-sort-btn${quoteSortOrder === 'desc' ? ' is-active' : ''}`}
                onClick={() => setQuoteSortOrder('desc')}
              >
                Mới nhất
              </button>
              <button
                type="button"
                className={`crm-l360-sort-btn${quoteSortOrder === 'asc' ? ' is-active' : ''}`}
                onClick={() => setQuoteSortOrder('asc')}
              >
                Cũ nhất
              </button>
            </div>
          ) : null}
        </div>
        {sortedQuotes.length ? (
          <div className="crm-l360-list">
            {sortedQuotes.map(q => {
              const expanded = expandedQuotes.has(q.id);
              const relatedContracts = contracts.filter(c => c.quoteId === q.id);
              const isOpen = openQuoteId === q.id;
              const isNewest = q.id === newestQuoteId;
              const isOldest = q.id === oldestQuoteId;
              return (
                <div key={q.id} className={`crm-l360-acc crm-l360-row--quote${isOpen ? ' is-active' : ''}`} data-quote-id={q.id}>
                  <button type="button" className="crm-l360-acc-head" aria-expanded={isOpen} onClick={() => setOpenQuoteId(isOpen ? null : q.id)}>
                    <span className="crm-l360-acc-caret">{isOpen ? '▾' : '▸'}</span>
                    <b className="crm-l360-val-code">{q.number || 'Báo giá'} · V{q.version}</b>
                    <span className="crm-l360-acc-sub crm-l360-acc-item">{q.mainItem || 'Chưa có hạng mục'}{q.itemCount > 1 ? ` (+${q.itemCount - 1})` : ''}</span>
                    <span className="crm-l360-chip">{q.stageLabel || '—'}</span>
                    <span className="crm-l360-val-money">{fmtMoney(q.totalAmount, q.currency)}</span>
                    <span className="crm-l360-acc-sub">{q.presale || '—'} → {q.sale || '—'}</span>
                    {q.createdAt ? <span className="crm-l360-time-badge" title={`Tạo lúc ${fmtDateTime(q.createdAt)}`}>{fmtDateTime(q.createdAt)}</span> : null}
                    {isNewest ? <span className="crm-l360-chip crm-l360-chip--newest">Mới nhất</span> : isOldest ? <span className="crm-l360-chip crm-l360-chip--oldest">Cũ nhất</span> : null}
                    {q.outcome?.state === 'lost' ? <span className="crm-l360-chip crm-l360-chip--out">OUT</span> : q.outcome?.state === 'awaiting' ? <span className="crm-l360-chip crm-l360-chip--awaiting">Chờ khách</span> : null}
                    {q.hasContract ? <span className="crm-l360-chip crm-l360-chip--ct-signed">Có hợp đồng</span> : q.outcome?.state === 'lost' ? null : q.sla.dueAt ? <span className={`crm-l360-sla crm-l360-sla--${q.sla.status}`}>{SLA_LABEL[q.sla.status] || q.sla.status}</span> : null}
                  </button>
                  {isOpen ? (
                    <div className="crm-l360-acc-body">
                      <div className="crm-l360-fields crm-l360-fields--tight crm-l360-fields--4col">
                        <Field label="Thời gian tạo">{fmtDateTime(q.createdAt)}</Field>
                        <Field label="Đang chờ ai">{q.waitingOn || 'Không còn chờ'}</Field>
                        <Field label="Người duyệt">{q.approval.approvedBy ? `${q.approval.approvedBy}${q.approval.approvedAt ? ` · ${fmtDateTime(q.approval.approvedAt)}` : ''}` : (q.approval.state === 'approved' && q.approval.approvedAt ? fmtDateTime(q.approval.approvedAt) : '—')}</Field>
                        <Field label="SLA / deadline">{q.sla.dueAt ? fmtDateTime(q.sla.dueAt) : 'Chưa đặt hạn'}</Field>
                        <Field label="Trạng thái duyệt"><span className={`crm-l360-chip crm-l360-chip--appr-${q.approval.state}`}>{q.approval.label}</span></Field>
                        <Field label="Giá vốn">{q.costViewAllowed ? (fmtMoney(q.costTotal, q.currency) !== '—' ? <span className="crm-l360-val-money">{fmtMoney(q.costTotal, q.currency)}</span> : '—') : 'Không có quyền xem'}</Field>
                        <Field label="Margin / Markup">{q.profitabilityViewAllowed ? `${q.marginPercent != null ? `${q.marginPercent}%` : '—'} / ${q.markupPercent != null ? `${q.markupPercent}%` : '—'}` : 'Không có quyền xem'}</Field>
                        <Field label="Kết quả báo giá">{q.outcome ? (q.outcome.state === 'lost' ? `OUT — ${q.outcome.reasonLabel || 'Không chốt'}${q.outcome.reasonOther ? `: ${q.outcome.reasonOther}` : ''}${q.outcome.note ? ` · ${q.outcome.note}` : ''}${q.outcome.by ? ` · ${q.outcome.by}` : ''}${q.outcome.at ? ` · ${fmtDateTime(q.outcome.at)}` : ''}` : q.outcome.label) : null}</Field>
                        <Field label="Cập nhật">{fmtDateTime(q.updatedAt)}</Field>
                        <Field label="Hợp đồng liên quan">
                          {relatedContracts.length ? relatedContracts.map(c => (
                            c.fileUrl
                              ? <a key={c.id} className="crm-l360-doc" href={c.fileUrl} target="_blank" rel="noopener noreferrer"><span className="crm-l360-val-code">{c.number || c.title}</span></a>
                              : <span key={c.id} className="crm-l360-nolink"><span className="crm-l360-val-code">{c.number || c.title}</span></span>
                          )) : 'Chưa có hợp đồng'}
                        </Field>
                      </div>
                      <div className="crm-l360-actions">
                        <button type="button" className="crm-l360-btn crm-l360-btn--primary" onClick={() => onOpenWorkspace(q.id)}>Mở báo giá</button>
                        <button type="button" className="crm-l360-btn" aria-expanded={expanded} onClick={() => toggleQuote(q.id)}>
                          {expanded ? 'Thu gọn Hạng mục' : 'Xem nhanh'}
                        </button>
                        <button type="button" className="crm-l360-btn crm-l360-btn--ghost" onClick={() => push({ type: 'quote', item: quoteItem(q), label: `Tiến độ BG ${q.number || ''}`.trim() })}>Tiến độ xử lý</button>
                      </div>
                      {expanded ? (
                        <div className="crm-l360-quick">
                          {q.items?.length ? (
                            <table className="crm-l360-items">
                              <thead><tr><th>Hạng mục SP / DV</th><th>Số lượng</th><th>Thành tiền</th></tr></thead>
                              <tbody>
                                {q.items.map((it, i) => (
                                  <tr key={i}>
                                    <td>{it.name || '—'}</td>
                                    <td>{it.quantity ?? '—'}{it.unit ? ` ${it.unit}` : ''}</td>
                                    <td><span className="crm-l360-val-money">{fmtMoney(it.amount, q.currency)}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : <p className="crm-l360-empty">Báo giá chưa khai báo danh mục sản phẩm chi tiết.</p>}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : <p className="crm-l360-empty">Chưa có báo giá.</p>}
      </section>

      {/* 7) Hop dong */}
      <section className="crm-l360-card crm-l360-sec--contract">
        <p className="crm-l360-eyebrow crm-l360-eyebrow--contract">
          <FileCheck size={14} className="crm-l360-icon" /> Hợp đồng ({contracts.length})
        </p>
        {contracts.length ? (
          <div className="crm-l360-list">
            {contracts.map(c => {
              const isOpen = openContractId === c.id;
              return (
                <div key={c.id} className={`crm-l360-acc crm-l360-row--contract${isOpen ? ' is-active' : ''}`} data-contract-id={c.id}>
                  <button type="button" className="crm-l360-acc-head" aria-expanded={isOpen} onClick={() => setOpenContractId(isOpen ? null : c.id)}>
                    <span className="crm-l360-acc-caret">{isOpen ? '▾' : '▸'}</span>
                    <b className="crm-l360-val-code">{c.number || c.title || 'Hợp đồng'}</b>
                    <span className={`crm-l360-chip crm-l360-chip--ct-${c.status || ''}`}>{CONTRACT_STATUS_LABEL[c.status || ''] || c.status || '—'}</span>
                    <span className="crm-l360-val-money">{fmtMoney(c.value, c.currency)}</span>
                    {c.quoteNumber ? <span className="crm-l360-acc-sub">BG {c.quoteNumber}</span> : null}
                    {c.signedAt ? <span className="crm-l360-acc-sub">Ký {fmtDate(c.signedAt)}</span> : null}
                    {c.fileUrl ? null : <span className="crm-l360-nolink">Chưa có link</span>}
                  </button>
                  {isOpen ? (
                    <div className="crm-l360-acc-body">
                      <div className="crm-l360-fields crm-l360-fields--tight crm-l360-fields--4col">
                        <Field label="Tên hợp đồng">{c.title}</Field>
                        <Field label="Báo giá liên kết">{c.quoteNumber ? <span className="crm-l360-val-code">{c.quoteNumber}</span> : '—'}</Field>
                        <Field label="Giá trị">{fmtMoney(c.value, c.currency) !== '—' ? <span className="crm-l360-val-money">{fmtMoney(c.value, c.currency)}</span> : '—'}</Field>
                        <Field label="Ngày ký">{c.signedAt ? fmtDate(c.signedAt) : null}</Field>
                        <Field label="Thời hạn">{c.startDate || c.endDate ? `${c.startDate ? fmtDate(c.startDate) : '—'} → ${c.endDate ? fmtDate(c.endDate) : '—'}` : null}</Field>
                        <Field label="Phụ trách">{c.ownerName}</Field>
                      </div>
                      <div className="crm-l360-actions">
                        {c.fileUrl ? (
                          <a className="crm-l360-btn crm-l360-btn--primary" href={c.fileUrl} target="_blank" rel="noopener noreferrer">Xem hợp đồng</a>
                        ) : (
                          <span className="crm-l360-nolink">Chưa có link hợp đồng</span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : <p className="crm-l360-empty">Chưa có hợp đồng.</p>}
      </section>

      {/* 8) Thong tin Lead / Khach - chi tiet, thu gon duoc */}
      <details className="crm-l360-card crm-l360-details" open>
        <summary className="crm-l360-info-head">
          <span className="crm-l360-info-title">Thông tin Lead / Khách hàng</span>
          <button type="button" className="crm-l360-btn crm-l360-info-edit" onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(); }}>Sửa thông tin Lead</button>
        </summary>
        <div className="crm-l360-group-box">
          <div className="crm-l360-group-hdr crm-l360-group-hdr--company">
            <Building2 size={13} className="crm-l360-ghdr-icon" />
            <span>CÔNG TY / KHÁCH HÀNG</span>
          </div>
          <div className="crm-l360-fields crm-l360-fields--tight">
            <Field label="Mã KH">{customer?.code ? <span className="crm-l360-val-code">{customer.code}</span> : null}</Field>
            <Field label="Tên công ty">{customer?.name || lead.company}</Field>
            <Field label="MST">{customer?.taxCode}</Field>
          </div>
        </div>

        <div className="crm-l360-group-box">
          <div className="crm-l360-group-hdr crm-l360-group-hdr--contact">
            <User size={13} className="crm-l360-ghdr-icon" />
            <span>NGƯỜI LIÊN HỆ</span>
          </div>
          <div className="crm-l360-fields crm-l360-fields--tight">
            <Field label="Mã liên hệ">{contact?.contactCode || lead.contactCode}</Field>
            <Field label="Người liên hệ">{contact?.name || lead.name}{(contact?.position || lead.position) ? ` · ${contact?.position || lead.position}` : ''}</Field>
            <Field label="SĐT">{contact?.phone || lead.phone}</Field>
            <Field label="Email">{contact?.email || lead.email}</Field>
          </div>
        </div>

        <div className="crm-l360-group-box">
          <div className="crm-l360-group-hdr crm-l360-group-hdr--lead">
            <Target size={13} className="crm-l360-ghdr-icon" />
            <span>LEAD &amp; NGUỒN</span>
          </div>
          <div className="crm-l360-fields crm-l360-fields--tight">
            <Field label="Nguồn Lead">{lead.source ? getSourceLabel(lead.source) : null}</Field>
            <Field label="Trạng thái">{lead.statusLabel}</Field>
            <Field label="Ngày tạo Lead">{fmtDate(lead.createdAt)}</Field>
          </div>
        </div>

        <div className="crm-l360-group-box">
          <div className="crm-l360-group-hdr crm-l360-group-hdr--need">
            <Briefcase size={13} className="crm-l360-ghdr-icon" />
            <span>NHU CẦU &amp; DỰ KIẾN</span>
          </div>
          <div className="crm-l360-fields crm-l360-fields--tight">
            <Field label="Nhu cầu / SP-DV">{lead.need || deal?.servicePackage}</Field>
            <Field label="Giá trị dự kiến">{fmtMoney(lead.estimatedValue ?? deal?.estimatedBudget ?? null) !== '—' ? <span className="crm-l360-val-money">{fmtMoney(lead.estimatedValue ?? deal?.estimatedBudget ?? null)}</span> : null}</Field>
            <Field label="Mức độ quan tâm">{interest}</Field>
            <Field label="Dự kiến triển khai">{lead.expectedTimeline}</Field>
            <Field label="Giai đoạn">{dealStageLabel(lead.dealStage || deal?.stage)}</Field>
          </div>
        </div>
        {lead.note ? <p className="crm-l360-note"><span>Ghi chú Lead</span>{lead.note}</p> : null}
      </details>

      {/* 9) Timeline that - su kien quan trong doc duoc ngay */}
      <details className="crm-l360-card crm-l360-details" open>
        <summary>Lịch sử hoạt động ({timeline.length})</summary>
        {timeline.length ? (
          <>
            <ul className="crm-l360-timeline">
              {shownTimeline.map((event, index) => (
                <li key={`${event.at}-${index}`} className={`crm-l360-tl crm-l360-tl--${event.kind}`}>
                  <span className="crm-l360-tl-time">{fmtDateTime(event.at)}</span>
                  <div>
                    <b>{event.title}{event.ref ? ` · ${event.ref}` : ''}</b>
                    {event.detail ? <span>{event.detail}</span> : null}
                    {event.actor ? <small>{event.actor}</small> : null}
                  </div>
                </li>
              ))}
            </ul>
            {timeline.length > 8 ? (
              <button type="button" className="crm-l360-more" onClick={() => setShowAllTimeline(v => !v)}>
                {showAllTimeline ? 'Thu gọn' : `Xem thêm ${timeline.length - 8} hoạt động`}
              </button>
            ) : null}
          </>
        ) : <p className="crm-l360-empty">Chưa có hoạt động.</p>}
      </details>
    </>
  );
}

/** Record lien quan hien trong view Co hoi compact: bao gia (mo Quote Workspace that) + hop dong (mo link that). */
function RelatedRecords({
  quotes, contracts, onOpenQuote,
}: {
  quotes: QuoteCard[];
  contracts: ContractCard[];
  onOpenQuote: (quoteId: string) => void;
}) {
  if (!quotes.length && !contracts.length) return <p className="crm-l360-empty">Chưa có yêu cầu báo giá hoặc hợp đồng.</p>;
  return (
    <div className="crm-l360-related">
      {quotes.map(q => (
        <div key={q.id} className="crm-l360-related-row">
          <div className="crm-l360-related-info">
            <b>Báo giá <span className="crm-l360-val-code">{q.number || 'BG'} · V{q.version}</span></b>
            <span className="crm-l360-chip">{q.stageLabel || '—'}</span>
            <span className={`crm-l360-chip crm-l360-chip--appr-${q.approval.state}`}>{q.approval.label}</span>
          </div>
          <div className="crm-l360-related-actions">
            <span className="crm-l360-related-money crm-l360-val-money">{fmtMoney(q.totalAmount, q.currency)}</span>
            <button type="button" className="crm-l360-btn crm-l360-btn--primary" onClick={() => onOpenQuote(q.id)}>Mở báo giá</button>
          </div>
        </div>
      ))}
      {contracts.map(c => (
        <div key={c.id} className="crm-l360-related-row">
          <div className="crm-l360-related-info">
            <b>Hợp đồng <span className="crm-l360-val-code">{c.number || c.title}</span></b>
            <span className={`crm-l360-chip crm-l360-chip--ct-${c.status || ''}`}>{CONTRACT_STATUS_LABEL[c.status || ''] || c.status || '—'}</span>
          </div>
          <div className="crm-l360-related-actions">
            <span className="crm-l360-related-money crm-l360-val-money">{fmtMoney(c.value, c.currency)}</span>
            {c.fileUrl
              ? <a className="crm-l360-btn crm-l360-btn--primary" href={c.fileUrl} target="_blank" rel="noopener noreferrer">Xem hợp đồng</a>
              : <span className="crm-l360-nolink">Chưa có link hợp đồng</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 1 dong tien do RIENG cua 1 bao gia: ma+version+SP/DV, trang thai/assignee/deadline cua CHINH bao gia do + 6 buoc. */
function QuoteProgressRow({ q, onOpen }: { q: QuoteCard; onOpen: () => void }) {
  const active = q.progress.find(s => s.state === 'overdue' || s.state === 'current');
  const holder = q.hasContract ? 'Đã có hợp đồng' : q.outcome?.state === 'lost' ? `OUT — ${q.outcome.reasonLabel || 'Không chốt'}` : active ? `${active.label}${active.actor ? `: ${active.actor}` : ''}` : (q.waitingOn || '—');
  return (
    <div className="crm-l360-qprog" data-quote-id={q.id}>
      <div className="crm-l360-qprog-head">
        <button type="button" className="crm-l360-qprog-code" onClick={onOpen} title="Mở chi tiết báo giá bên dưới">
          <b className="crm-l360-val-code">{q.number || 'Báo giá'} · V{q.version}</b>
        </button>
        <span className="crm-l360-qprog-item">{q.mainItem || 'Chưa có hạng mục'}{q.itemCount > 1 ? ` (+${q.itemCount - 1})` : ''}</span>
        <span className="crm-l360-chip">{q.stageLabel || '—'}</span>
        <span className="crm-l360-qprog-who">{holder}</span>
        {!q.hasContract && q.outcome?.state !== 'lost' && q.sla.dueAt ? (
          <span className="crm-l360-qprog-due">Hạn {fmtDateTime(q.sla.dueAt)} <span className={`crm-l360-sla crm-l360-sla--${q.sla.status}`}>{SLA_LABEL[q.sla.status] || q.sla.status}</span></span>
        ) : null}
      </div>
      <ol className="crm-l360-qsteps">
        {q.progress.map((step, index) => (
          <li key={step.key} className={`crm-l360-qstep crm-l360-qstep--${step.state}`} title={step.at ? fmtDateTime(step.at) : undefined}>
            <span className="crm-l360-qstep-dot">{step.state === 'done' ? '✓' : index + 1}</span>
            <span className="crm-l360-qstep-label">{step.label}</span>
            {step.actor ? <span className="crm-l360-qstep-actor">{step.actor}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
