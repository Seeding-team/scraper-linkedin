'use client';

import { useEffect, useMemo, useState } from 'react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { formatDate, formatVND } from '../../constants/crmConfig';
import {
  CONTRACT_STATUS_TONE,
  CUSTOMER_STATUS_TONE,
  LEAD_STATUS_TONE,
  PROJECT_STATUS_TONE,
  QUOTE_PHASE_TONE,
  customerStatusLabel,
  formatSinceDuration,
} from './progressLabels';
import { MiniStat } from './ProgressTeamPanel';
import type {
  ProgressContractItem,
  ProgressCustomerItem,
  ProgressDealItem,
  ProgressLeadItem,
  ProgressMemberSummaryResponse,
  ProgressProjectItem,
  ProgressQuoteItem,
} from './progress.types';

type SubTab = 'summary' | 'action' | 'leads' | 'customers' | 'deals' | 'projects' | 'quotes' | 'contracts';

export interface MemberPanelHandlers {
  onOpenQuote: (item: ProgressQuoteItem) => void;
  onOpenLead: (item: ProgressLeadItem) => void;
  onOpenCustomer: (customerId: string, customerName: string) => void;
  onOpenDeal: (item: ProgressDealItem) => void;
  onOpenProject: (item: ProgressProjectItem) => void;
  onOpenContract: (item: ProgressContractItem) => void;
}

/** Member 360 panel - fetch TOÀN BỘ 6 loại record NGAY khi mở (không lazy per
 * tab như trước) để tính được "record lâu nhất" cho header ngay và chuyển
 * tab tức thì - backend đã có cache TTL 20s (`_fetch_all` trong
 * progress_service.py) nên fetch đủ 6 API cùng lúc vẫn nhanh. */
export function ProgressMemberPanel({
  userId,
  initialTab,
  onOpenQuote,
  onOpenLead,
  onOpenCustomer,
  onOpenDeal,
  onOpenProject,
  onOpenContract,
}: { userId: string; initialTab?: SubTab } & MemberPanelHandlers) {
  const [summary, setSummary] = useState<ProgressMemberSummaryResponse | null>(null);
  const [tab, setTab] = useState<SubTab>(initialTab || 'summary');

  const [leads, setLeads] = useState<ProgressLeadItem[] | null>(null);
  const [customers, setCustomers] = useState<ProgressCustomerItem[] | null>(null);
  const [deals, setDeals] = useState<ProgressDealItem[] | null>(null);
  const [projects, setProjects] = useState<ProgressProjectItem[] | null>(null);
  const [quotes, setQuotes] = useState<ProgressQuoteItem[] | null>(null);
  const [contracts, setContracts] = useState<ProgressContractItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    setTab(initialTab || 'summary');
    setSummary(null);
    setLeads(null);
    setCustomers(null);
    setDeals(null);
    setProjects(null);
    setQuotes(null);
    setContracts(null);
    Promise.all([
      progressRepository.getMemberSummary(userId),
      progressRepository.listMemberLeads(userId),
      progressRepository.listMemberCustomers(userId),
      progressRepository.listMemberDeals(userId),
      progressRepository.listMemberProjects(userId),
      progressRepository.listMemberQuotes(userId),
      progressRepository.listMemberContracts(userId),
    ]).then(([s, l, c, d, p, q, ct]) => {
      if (!alive) return;
      setSummary(s);
      setLeads(l.items);
      setCustomers(c.items);
      setDeals(d.items);
      setProjects(p.items);
      setQuotes(q.items);
      setContracts(ct.items);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const oldestRecord = useMemo(() => {
    type Candidate = { label: string; sinceAt: string; onOpen: () => void };
    const candidates: Candidate[] = [];
    leads?.forEach(l => l.sinceAt && candidates.push({ label: `Lead · ${l.leadName}`, sinceAt: l.sinceAt, onOpen: () => onOpenLead(l) }));
    deals?.forEach(d => d.sinceAt && candidates.push({ label: `Cơ hội · ${d.customerName}`, sinceAt: d.sinceAt, onOpen: () => onOpenDeal(d) }));
    quotes?.forEach(q => q.timeInCurrentStage.sinceAt && candidates.push({ label: `Báo giá · ${q.quoteNumber}`, sinceAt: q.timeInCurrentStage.sinceAt, onOpen: () => onOpenQuote(q) }));
    contracts?.forEach(c => c.sinceAt && candidates.push({ label: `Hợp đồng · ${c.contractNumber}`, sinceAt: c.sinceAt, onOpen: () => onOpenContract(c) }));
    if (!candidates.length) return null;
    return candidates.reduce((oldest, cur) => (new Date(cur.sinceAt).getTime() < new Date(oldest.sinceAt).getTime() ? cur : oldest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, deals, quotes, contracts]);

  const overdueQuotes = useMemo(() => (quotes || []).filter(q => q.sla.status === 'overdue' || q.sla.status === 'completed_late'), [quotes]);
  const overdueFollowUpDeals = useMemo(
    () => (deals || []).filter(d => d.followUpDate && new Date(d.followUpDate).getTime() < Date.now()),
    [deals]
  );
  /** "Đứng lâu ở trạng thái" - CHỈ dùng cho Lead/Deal (có sinceAt thật), KHÔNG
   * gọi là "quá SLA" vì 2 entity này không có due-date thật - chỉ liệt kê top
   * 3 lâu nhất để cảnh báo, không bịa ngưỡng "bao nhiêu ngày là quá lâu". */
  const longStandingRecords = useMemo(() => {
    type Row = { key: string; label: string; sinceAt: string; onOpen: () => void };
    const rows: Row[] = [];
    leads?.forEach(l => l.sinceAt && rows.push({ key: `lead-${l.leadId}`, label: `Lead · ${l.leadName} (${l.statusLabel})`, sinceAt: l.sinceAt, onOpen: () => onOpenLead(l) }));
    deals?.forEach(d => d.sinceAt && rows.push({ key: `deal-${d.dealId}`, label: `Cơ hội · ${d.customerName} (${d.dealStageLabel})`, sinceAt: d.sinceAt, onOpen: () => onOpenDeal(d) }));
    return rows.sort((a, b) => new Date(a.sinceAt).getTime() - new Date(b.sinceAt).getTime()).slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, deals]);
  const actionCount = overdueQuotes.length + overdueFollowUpDeals.length;

  const member = summary?.member;
  const s = summary?.summary;
  const totalRecords = s ? s.leadCount + s.customerCount + s.dealCount + s.projectCount + s.quoteCount + s.contractCount : 0;

  if (!summary) return <p className="crm-empty-log">Đang tải...</p>;

  return (
    <div className="progress-panel">
      <div className="progress-member-hero">
        <div className="progress-avatar progress-avatar-lg">{(member?.userName || '?').slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0">
          <div className="progress-member-title">
            <h3>{member?.userName || '—'}</h3>
            <span className="qc-badge qc-badge-success">Đang hoạt động</span>
          </div>
          <p>{member?.teamName || 'Chưa gán phòng ban'} · {member?.role === 'admin' ? 'Admin' : member?.role === 'leader' ? 'Leader' : 'Member'}</p>
        </div>
      </div>

      <div className="progress-mini-grid progress-mini-grid-4">
        <MiniStat label="Đang phụ trách" value={totalRecords} />
        <MiniStat label="Pipeline" value={formatVND(s?.pipelineValueVnd || 0) || '0 đ'} isText />
        <MiniStat label="Báo giá quá SLA" value={s?.quotesOverSlaCount ?? 0} danger={Boolean(s?.quotesOverSlaCount)} />
        {oldestRecord ? (
          <button type="button" className="progress-mini-stat" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={oldestRecord.onOpen}>
            <span>Record lâu nhất</span>
            <b style={{ fontSize: 12.5 }}>{oldestRecord.label} · {formatSinceDuration(oldestRecord.sinceAt)}</b>
          </button>
        ) : (
          <MiniStat label="Record lâu nhất" value="—" isText />
        )}
      </div>

      <div className="progress-subtabs">
        {([
          ['summary', 'Tổng quan'],
          ['action', `Cần xử lý${actionCount ? ` (${actionCount})` : ''}`],
          ['leads', `Lead${leads ? ` (${leads.length})` : ''}`],
          ['customers', `Khách hàng${customers ? ` (${customers.length})` : ''}`],
          ['deals', `Cơ hội${deals ? ` (${deals.length})` : ''}`],
          ['projects', `Dự án${projects ? ` (${projects.length})` : ''}`],
          ['quotes', `Báo giá${quotes ? ` (${quotes.length})` : ''}`],
          ['contracts', `Hợp đồng${contracts ? ` (${contracts.length})` : ''}`],
        ] as Array<[SubTab, string]>).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <div className="progress-mini-grid progress-mini-grid-4">
          <MiniStat label="Lead" value={s?.leadCount ?? 0} />
          <MiniStat label="Khách hàng" value={s?.customerCount ?? 0} />
          <MiniStat label="Cơ hội" value={s?.dealCount ?? 0} />
          <MiniStat label="Dự án" value={s?.projectCount ?? 0} />
          <MiniStat label="Báo giá" value={s?.quoteCount ?? 0} />
          <MiniStat label="Hợp đồng" value={s?.contractCount ?? 0} />
        </div>
      ) : tab === 'action' ? (
        <div className="progress-panel">
          <section className="progress-drawer-section">
            <h3>Báo giá quá SLA ({overdueQuotes.length})</h3>
            {overdueQuotes.length === 0 ? <p className="crm-empty-log">Không có báo giá nào quá SLA.</p> : <QuotesTable items={overdueQuotes} onOpen={onOpenQuote} />}
          </section>
          <section className="progress-drawer-section">
            <h3>Follow-up quá hạn ({overdueFollowUpDeals.length})</h3>
            {overdueFollowUpDeals.length === 0 ? <p className="crm-empty-log">Không có follow-up nào quá hạn.</p> : <DealsList items={overdueFollowUpDeals} onOpen={onOpenDeal} />}
          </section>
          <section className="progress-drawer-section">
            <h3>Đứng lâu ở trạng thái (Lead/Cơ hội)</h3>
            {longStandingRecords.length === 0 ? (
              <p className="crm-empty-log">Chưa có dữ liệu.</p>
            ) : (
              <div className="progress-record-list">
                {longStandingRecords.map(r => (
                  <button key={r.key} type="button" className="progress-record-card" onClick={r.onOpen}>
                    <span className="progress-record-card-icon">⏳</span>
                    <div className="progress-record-card-main">
                      <div className="progress-record-card-title">{r.label}</div>
                      <div className="progress-record-card-sub"><span>{formatSinceDuration(r.sinceAt)}</span></div>
                    </div>
                    <span className="progress-arrow">›</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : tab === 'leads' ? (
        <LeadsList items={leads || []} onOpen={onOpenLead} />
      ) : tab === 'customers' ? (
        <CustomersList items={customers || []} onOpen={c => onOpenCustomer(c.customerId, c.customerName || 'Khách hàng')} />
      ) : tab === 'deals' ? (
        <DealsList items={deals || []} onOpen={onOpenDeal} />
      ) : tab === 'projects' ? (
        <ProjectsList items={projects || []} onOpen={onOpenProject} />
      ) : tab === 'quotes' ? (
        <QuotesTable items={quotes || []} onOpen={onOpenQuote} />
      ) : (
        <ContractsList items={contracts || []} onOpen={onOpenContract} />
      )}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="crm-empty-log">{text}</p>;
}

function LeadsList({ items, onOpen }: { items: ProgressLeadItem[]; onOpen: (item: ProgressLeadItem) => void }) {
  if (!items.length) return <EmptyRow text="Chưa có lead nào." />;
  return (
    <div className="progress-record-list">
      {items.map(row => (
        <button key={row.leadId} type="button" className="progress-record-card" onClick={() => onOpen(row)}>
          <span className="progress-record-card-icon">🧲</span>
          <div className="progress-record-card-main">
            <div className="progress-record-card-title">{row.leadName}</div>
            <div className="progress-record-card-sub">
              <span className={`qc-badge ${LEAD_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>{row.statusLabel}</span>
              <span>{formatSinceDuration(row.sinceAt)}</span>
            </div>
          </div>
          <span className="progress-arrow">›</span>
        </button>
      ))}
    </div>
  );
}

function CustomersList({ items, onOpen }: { items: ProgressCustomerItem[]; onOpen: (item: ProgressCustomerItem) => void }) {
  if (!items.length) return <EmptyRow text="Chưa có khách hàng nào." />;
  return (
    <div className="progress-record-list">
      {items.map(row => (
        <button key={row.customerId} type="button" className="progress-record-card" onClick={() => onOpen(row)}>
          <span className="progress-record-card-icon">🏢</span>
          <div className="progress-record-card-main">
            <div className="progress-record-card-title">{row.customerName}</div>
            <div className="progress-record-card-sub">
              <span className={`qc-badge ${CUSTOMER_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>{customerStatusLabel(row.status)}</span>
              <span>{row.dealCount} cơ hội</span>
            </div>
          </div>
          <div className="progress-record-card-value">{formatVND(row.pipelineValueVnd) || '0 đ'}</div>
        </button>
      ))}
    </div>
  );
}

function DealsList({ items, onOpen }: { items: ProgressDealItem[]; onOpen: (item: ProgressDealItem) => void }) {
  if (!items.length) return <EmptyRow text="Chưa có cơ hội nào." />;
  return (
    <div className="progress-record-list">
      {items.map(row => (
        <button key={row.dealId} type="button" className="progress-record-card" onClick={() => onOpen(row)}>
          <span className="progress-record-card-icon">🎯</span>
          <div className="progress-record-card-main">
            <div className="progress-record-card-title">{row.customerName}</div>
            <div className="progress-record-card-sub">
              <span className="qc-badge qc-badge-blue">{row.dealStageLabel}</span>
              <span>{formatSinceDuration(row.sinceAt)}</span>
              {row.followUpDate ? <span>Follow-up {formatDate(row.followUpDate)}</span> : null}
            </div>
          </div>
          <div className="progress-record-card-value">{formatVND(row.estimatedBudgetVnd) || '0 đ'}</div>
        </button>
      ))}
    </div>
  );
}

function ProjectsList({ items, onOpen }: { items: ProgressProjectItem[]; onOpen: (item: ProgressProjectItem) => void }) {
  if (!items.length) return <EmptyRow text="Chưa có dự án nào." />;
  return (
    <div className="progress-record-list">
      {items.map(row => (
        <button key={row.projectId} type="button" className="progress-record-card" onClick={() => onOpen(row)}>
          <span className="progress-record-card-icon">📁</span>
          <div className="progress-record-card-main">
            <div className="progress-record-card-title">{row.projectName || row.projectCode}</div>
            <div className="progress-record-card-sub">
              <span className={`qc-badge ${PROJECT_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>{row.statusLabel}</span>
              <span>{row.customerName}</span>
            </div>
          </div>
          <span className="progress-arrow">›</span>
        </button>
      ))}
    </div>
  );
}

export function QuotesTable({ items, onOpen, showOwner }: { items: ProgressQuoteItem[]; onOpen: (item: ProgressQuoteItem) => void; showOwner?: boolean }) {
  if (!items.length) return <EmptyRow text="Chưa có báo giá nào." />;
  return (
    <div className="progress-record-list">
      {items.map(row => (
        <button key={row.quoteId} type="button" className="progress-record-card" onClick={() => onOpen(row)}>
          <span className="progress-record-card-icon">📄</span>
          <div className="progress-record-card-main">
            <div className="progress-record-card-title">{row.quoteNumber} · {row.customerName}</div>
            <div className="progress-record-card-sub">
              <span className={`qc-badge ${QUOTE_PHASE_TONE[row.processingStage] || 'qc-badge-neutral'}`}>{row.processingStageLabel}</span>
              <span>{formatSinceDuration(row.timeInCurrentStage.sinceAt)}</span>
              <SlaBadge row={row} />
              {showOwner ? (
                <span>
                  {row.technicalOwnerName ? `Presale: ${row.technicalOwnerName}` : ''}
                  {row.technicalOwnerName && row.quoteOwnerName ? ' · ' : ''}
                  {row.quoteOwnerName ? `Sale: ${row.quoteOwnerName}` : ''}
                </span>
              ) : null}
            </div>
          </div>
          <div className="progress-record-card-value">{formatVND(row.totalAmountVnd) || '0 đ'}</div>
        </button>
      ))}
    </div>
  );
}

export function SlaBadge({ row }: { row: ProgressQuoteItem }) {
  const tone =
    row.sla.status === 'overdue' || row.sla.status === 'completed_late'
      ? 'qc-badge-danger'
      : row.sla.status === 'due_soon'
        ? 'qc-badge-warning'
        : row.sla.status === 'completed_on_time'
          ? 'qc-badge-success'
          : row.sla.status === 'not_set'
            ? 'qc-badge-neutral'
            : 'qc-badge-blue';
  const label =
    row.sla.status === 'overdue'
      ? 'Quá SLA'
      : row.sla.status === 'due_soon'
        ? 'Sắp đến hạn'
        : row.sla.status === 'completed_on_time'
          ? 'Đúng hạn'
          : row.sla.status === 'completed_late'
            ? 'Trễ hạn'
            : row.sla.status === 'not_set'
              ? 'Chưa thiết lập'
              : 'Đang xử lý';
  return <span className={`qc-badge ${tone}`}>{label}</span>;
}

function ContractsList({ items, onOpen }: { items: ProgressContractItem[]; onOpen: (item: ProgressContractItem) => void }) {
  if (!items.length) return <EmptyRow text="Chưa có hợp đồng nào." />;
  return (
    <div className="progress-record-list">
      {items.map(row => (
        <button key={row.contractId} type="button" className="progress-record-card" onClick={() => onOpen(row)}>
          <span className="progress-record-card-icon">📝</span>
          <div className="progress-record-card-main">
            <div className="progress-record-card-title">{row.contractNumber || row.title}</div>
            <div className="progress-record-card-sub">
              <span className={`qc-badge ${CONTRACT_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>{row.statusLabel}</span>
              <span>{formatSinceDuration(row.sinceAt)}</span>
            </div>
          </div>
          <div className="progress-record-card-value">{formatVND(row.contractValueVnd) || '0 đ'}</div>
        </button>
      ))}
    </div>
  );
}
