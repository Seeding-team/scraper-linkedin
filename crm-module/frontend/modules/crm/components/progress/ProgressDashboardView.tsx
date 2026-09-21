'use client';

import { useEffect, useMemo, useState } from 'react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { formatVND } from '../../constants/crmConfig';
import { SearchableSelect } from '../SearchableSelect';
import '../../styles/quote-center.css';
import './progress.css';
import { ProgressTeamPanel } from './ProgressTeamPanel';
import { ProgressMemberPanel, QuotesTable } from './ProgressMemberPanel';
import { ProgressQuoteDrawer } from './ProgressQuoteDrawer';
import { ProgressRightDrawer } from './ProgressRightDrawer';
import { ProgressLeadDrawer } from './ProgressLeadDrawer';
import { ProgressCustomerDrawer } from './ProgressCustomerDrawer';
import { ProgressDealDrawer } from './ProgressDealDrawer';
import { ProgressProjectDrawer } from './ProgressProjectDrawer';
import { ProgressContractDrawer } from './ProgressContractDrawer';
import { formatSinceDuration } from './progressLabels';
import type {
  ProgressAlerts,
  ProgressContractItem,
  ProgressDealItem,
  ProgressLeadItem,
  ProgressMemberSummaryRow,
  ProgressOverview,
  ProgressProjectItem,
  ProgressQuoteItem,
  ProgressSearchResults,
  ProgressTeamSummary,
} from './progress.types';

type TabKey = 'overview' | 'teams' | 'members' | 'quotes';
type FlatMember = ProgressMemberSummaryRow & { teamId: string; teamName: string | null };

/** Nested Quick View navigation stack - mỗi entry mang sẵn `label` để dựng
 * breadcrumb (không navigate away, chỉ đổi nội dung trong 1 drawer duy
 * nhất). Xem ProgressRightDrawer.tsx cho phần render breadcrumb/back. */
type DrawerEntry =
  | { type: 'team'; teamId: string; label: string }
  | { type: 'member'; memberId: string; label: string; initialTab?: 'action' }
  | { type: 'quote'; quote: ProgressQuoteItem; label: string }
  | { type: 'lead'; item: ProgressLeadItem; label: string }
  | { type: 'customer'; customerId: string; label: string }
  | { type: 'deal'; item: ProgressDealItem; label: string }
  | { type: 'project'; item: ProgressProjectItem; label: string }
  | { type: 'contract'; item: ProgressContractItem; label: string };

const SLA_FILTER_OPTIONS = [
  { value: '', label: 'SLA: Tất cả' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'due_soon', label: 'Sắp đến hạn' },
  { value: 'overdue', label: 'Quá SLA' },
  { value: 'not_set', label: 'Chưa thiết lập' },
];

export function ProgressDashboardView() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [overview, setOverview] = useState<ProgressOverview | null>(null);
  const [teams, setTeams] = useState<ProgressTeamSummary[]>([]);
  const [flatMembers, setFlatMembers] = useState<FlatMember[] | null>(null);
  const [allQuotes, setAllQuotes] = useState<ProgressQuoteItem[] | null>(null);
  const [quotesTab, setQuotesTab] = useState<ProgressQuoteItem[] | null>(null);
  const [alerts, setAlerts] = useState<ProgressAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [teamFilter, setTeamFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProgressSearchResults | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quotesSlaFilter, setQuotesSlaFilter] = useState('');
  const [quotePresaleFilter, setQuotePresaleFilter] = useState('');
  const [quoteSaleFilter, setQuoteSaleFilter] = useState('');
  const [quoteStageFilter, setQuoteStageFilter] = useState('');
  const [drawerStack, setDrawerStack] = useState<DrawerEntry[]>([]);

  function openRoot(entry: DrawerEntry) {
    setDrawerStack([entry]);
  }
  function pushDrawer(entry: DrawerEntry) {
    setDrawerStack(s => [...s, entry]);
  }
  function closeDrawer() {
    setDrawerStack([]);
  }
  function backDrawer() {
    setDrawerStack(s => s.slice(0, -1));
  }
  function jumpToDrawer(idx: number) {
    setDrawerStack(s => s.slice(0, idx + 1));
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      progressRepository.getOverview(),
      progressRepository.listTeams(),
      progressRepository.listQuotes({}),
      progressRepository.getAlerts(),
    ])
      .then(([ov, teamsRes, quotesRes, alertsRes]) => {
        if (!alive) return;
        setOverview(ov);
        setTeams(teamsRes.teams);
        setAllQuotes(quotesRes.items);
        setAlerts(alertsRes);
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được dữ liệu tiến độ.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!teams.length) {
      if (!loading) setFlatMembers([]);
      return;
    }
    let alive = true;
    Promise.all(teams.map(t => progressRepository.getTeamDetail(t.teamId).catch(() => null))).then(results => {
      if (!alive) return;
      const seen = new Map<string, FlatMember>();
      results.forEach((res, idx) => {
        if (!res) return;
        const team = teams[idx];
        res.members.forEach(m => {
          if (!seen.has(m.userId)) seen.set(m.userId, { ...m, teamId: team.teamId, teamName: team.teamName });
        });
      });
      setFlatMembers(Array.from(seen.values()));
    });
    return () => {
      alive = false;
    };
  }, [teams, loading]);

  /** Search toàn module (GET /progress/search) - CHỈ query khi >=2 ký tự,
   * debounce 300ms tránh spam API mỗi keystroke. Vẫn giữ nguyên filter cục
   * bộ (visibleTeams/visibleMembers/filteredQuotes) dùng CÙNG state `search`
   * - dropdown search này bổ sung thêm Lead/Customer/Deal/Project/Contract
   * mà filter cục bộ không có sẵn danh sách để lọc. */
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setSearchResults(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      progressRepository.search(query).then(res => {
        if (alive) setSearchResults(res);
      }).catch(() => {
        if (alive) setSearchResults(null);
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search]);

  useEffect(() => {
    if (tab !== 'quotes') return;
    let alive = true;
    setQuotesTab(null);
    progressRepository.listQuotes({ teamId: teamFilter || undefined, slaStatus: quotesSlaFilter || undefined }).then(res => {
      if (alive) setQuotesTab(res.items);
    });
    return () => {
      alive = false;
    };
  }, [tab, teamFilter, quotesSlaFilter]);

  const teamOptions = useMemo(
    () => [{ value: '', label: 'Tất cả team' }, ...teams.map(t => ({ value: t.teamId, label: t.teamName || t.teamId }))],
    [teams]
  );

  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams.filter(t => {
      if (teamFilter && t.teamId !== teamFilter) return false;
      if (q && !`${t.teamName} ${t.leaderName || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [teams, teamFilter, search]);

  const visibleMembers = useMemo(() => {
    if (!flatMembers) return null;
    const q = search.trim().toLowerCase();
    return flatMembers.filter(m => {
      if (teamFilter && m.teamId !== teamFilter) return false;
      if (q && !`${m.userName || ''} ${m.teamName || ''} ${m.role || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [flatMembers, teamFilter, search]);

  const filteredQuotes = useMemo(() => {
    if (!quotesTab) return null;
    const q = search.trim().toLowerCase();
    return quotesTab.filter(item => {
      if (q && !`${item.quoteNumber || ''} ${item.customerName || ''} ${item.projectName || ''}`.toLowerCase().includes(q)) return false;
      if (quotePresaleFilter && item.technicalOwnerName !== quotePresaleFilter) return false;
      if (quoteSaleFilter && item.quoteOwnerName !== quoteSaleFilter) return false;
      if (quoteStageFilter && item.processingStageLabel !== quoteStageFilter) return false;
      return true;
    });
  }, [quotesTab, search, quotePresaleFilter, quoteSaleFilter, quoteStageFilter]);

  const quoteFilterOptions = useMemo(() => {
    const items = quotesTab || [];
    const unique = (getter: (item: ProgressQuoteItem) => string | null | undefined, prefix: string) => [
      { value: '', label: `${prefix}: Tất cả` },
      ...Array.from(new Set(items.map(getter).filter(Boolean))).map(value => ({ value: value as string, label: value as string })),
    ];
    return {
      presale: unique(q => q.technicalOwnerName, 'Presale'),
      sale: unique(q => q.quoteOwnerName, 'Sale'),
      stage: unique(q => q.processingStageLabel, 'Stage'),
    };
  }, [quotesTab]);

  const quoteSummary = useMemo(() => {
    const items = quotesTab || [];
    return {
      total: items.length,
      overdue: items.filter(q => q.sla.status === 'overdue' || q.sla.status === 'completed_late').length,
      dueSoon: items.filter(q => q.sla.status === 'due_soon').length,
      notSet: items.filter(q => q.sla.status === 'not_set').length,
    };
  }, [quotesTab]);

  const kpis = overview?.kpis;

  return (
    <div className="qc-page progress-page">
      <header className="progress-header">
        <div>
          <h1>Quản lý tiến độ</h1>
          <p>Theo dõi tiến độ Lead → Khách hàng → Cơ hội → Dự án → Báo giá → Hợp đồng theo Team và Thành viên.</p>
        </div>
        <div className="progress-date-pill" title="Dashboard hiển thị trạng thái hiện tại, chưa lọc theo khoảng ngày (backend chưa có dữ liệu time-series để lọc chính xác)">
          Dữ liệu hiện tại
        </div>
      </header>

      <div className="progress-toolbar">
        <div className="progress-global-search">
          <input
            className="progress-toolbar-search"
            placeholder="Tìm kiếm team, thành viên, lead, khách hàng, cơ hội, dự án, báo giá, hợp đồng..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          />
          {searchOpen && search.trim().length >= 2 ? (
            <GlobalSearchDropdown
              results={searchResults}
              onOpenTeam={(teamId, teamName) => openRoot({ type: 'team', teamId, label: teamName })}
              onOpenMember={(memberId, memberName) => openRoot({ type: 'member', memberId, label: memberName })}
              onOpenCustomer={(customerId, customerName) => openRoot({ type: 'customer', customerId, label: customerName })}
              onOpenLead={item => openRoot({ type: 'lead', item, label: item.leadName || 'Lead' })}
              onOpenDeal={item => openRoot({ type: 'deal', item, label: item.customerName || 'Cơ hội' })}
              onOpenProject={item => openRoot({ type: 'project', item, label: item.projectName || item.projectCode || 'Dự án' })}
              onOpenQuote={item => openRoot({ type: 'quote', quote: item, label: item.quoteNumber || item.quoteId })}
              onOpenContract={item => openRoot({ type: 'contract', item, label: item.contractNumber || item.title || 'Hợp đồng' })}
            />
          ) : null}
        </div>
        <div className="progress-select">
          <SearchableSelect value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="Tất cả team" hideClearOption />
        </div>
      </div>

      <nav className="progress-tabs" aria-label="Quản lý tiến độ">
        {([
          ['overview', 'Tổng quan'],
          ['teams', 'Theo team'],
          ['members', 'Theo thành viên'],
          ['quotes', 'Báo giá & SLA'],
        ] as Array<[TabKey, string]>).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {error ? <p className="progress-error">{error}</p> : null}

      {tab === 'overview' ? (
        loading ? (
          <p className="crm-empty-log">Đang tải...</p>
        ) : (
          <>
            <KpiGrid>
              <Metric tone="blue" label="Lead" value={kpis?.leadsInProgress.count ?? 0} />
              <Metric tone="rose" label="Khách hàng" value={kpis?.customersBeingCared.count ?? 0} />
              <Metric tone="green" label="Cơ hội" value={kpis?.dealsOpen.count ?? 0} subtext={formatVND(kpis?.dealsOpen.pipelineValueVnd || 0) || '0 đ'} />
              <Metric tone="purple" label="Dự án" value={kpis?.projectsActive.count ?? 0} />
              <Metric tone="amber" label="Báo giá" value={kpis?.quotesInProgress.count ?? 0} onClick={() => setTab('quotes')} />
              <Metric tone="danger" label="Quá SLA" value={kpis?.quotesOverSla.count ?? 0} onClick={() => { setQuotesSlaFilter('overdue'); setTab('quotes'); }} />
              <Metric tone="slate" label="Hợp đồng" value={kpis?.contractsTracked.count ?? 0} />
            </KpiGrid>

            <section className="progress-card">
              <CardTitle title="Cảnh báo cần xử lý" subtitle="Chỉ gom vấn đề có nguồn dữ liệu thật — Quote dùng SLA thật, Deal dùng follow-up thật, Lead/Hợp đồng chỉ báo 'đứng lâu', không suy diễn quá hạn" />
              <ManagementAlertsPanel
                alerts={alerts}
                onOpenQuote={quote => openRoot({ type: 'quote', quote, label: quote.quoteNumber || quote.quoteId })}
                onOpenDeal={item => openRoot({ type: 'deal', item, label: item.customerName || 'Cơ hội' })}
                onOpenLead={item => openRoot({ type: 'lead', item, label: item.leadName || 'Lead' })}
                onOpenContract={item => openRoot({ type: 'contract', item, label: item.contractNumber || item.title || 'Hợp đồng' })}
                onSeeAllQuotes={filter => { setQuotesSlaFilter(filter); setTab('quotes'); }}
              />
            </section>

            <div className="progress-overview-grid">
              <section className="progress-card progress-card-wide">
                <CardTitle title="Tiến độ theo team" action="Xem tất cả" onClick={() => setTab('teams')} />
                <TeamsTable teams={visibleTeams} onOpen={(teamId, teamName) => openRoot({ type: 'team', teamId, label: teamName })} compact />
              </section>
              <section className="progress-card">
                <CardTitle title="Team có nhiều quá hạn nhất" />
                <TeamOverdueRanking teams={teams} onOpen={(teamId, teamName) => openRoot({ type: 'team', teamId, label: teamName })} />
              </section>
            </div>
          </>
        )
      ) : null}

      {tab === 'teams' ? (
        <section className="progress-card">
          <CardTitle title="Theo team" subtitle={`${visibleTeams.length} team`} />
          <TeamsTable teams={visibleTeams} onOpen={(teamId, teamName) => openRoot({ type: 'team', teamId, label: teamName })} />
        </section>
      ) : null}

      {tab === 'members' ? (
        <section className="progress-card">
          <CardTitle title="Theo thành viên" subtitle={visibleMembers ? `${visibleMembers.length} thành viên` : 'Đang tải...'} />
          {visibleMembers === null ? (
            <p className="crm-empty-log">Đang tải...</p>
          ) : (
            <MembersTable members={visibleMembers} onOpen={(memberId, memberName) => openRoot({ type: 'member', memberId, label: memberName })} />
          )}
        </section>
      ) : null}

      {tab === 'quotes' ? (
        <section className="progress-card">
          <KpiGrid compact>
            <Metric tone="blue" label="Đang xử lý" value={quoteSummary.total} onClick={() => setQuotesSlaFilter('')} active={!quotesSlaFilter} />
            <Metric tone="danger" label="Quá SLA" value={quoteSummary.overdue} onClick={() => setQuotesSlaFilter('overdue')} active={quotesSlaFilter === 'overdue'} />
            <Metric tone="amber" label="Sắp đến hạn" value={quoteSummary.dueSoon} onClick={() => setQuotesSlaFilter('due_soon')} active={quotesSlaFilter === 'due_soon'} />
            <Metric tone="green" label="Chưa thiết lập" value={quoteSummary.notSet} onClick={() => setQuotesSlaFilter('not_set')} active={quotesSlaFilter === 'not_set'} />
          </KpiGrid>

          <div className="progress-filter-bar">
            <input className="search-input" placeholder="Tìm mã báo giá, khách hàng, project..." value={search} onChange={e => setSearch(e.target.value)} />
            <SearchableSelect value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="Team: Tất cả" hideClearOption />
            <SearchableSelect value={quotePresaleFilter} onChange={setQuotePresaleFilter} options={quoteFilterOptions.presale} placeholder="Presale: Tất cả" hideClearOption />
            <SearchableSelect value={quoteSaleFilter} onChange={setQuoteSaleFilter} options={quoteFilterOptions.sale} placeholder="Sale: Tất cả" hideClearOption />
            <SearchableSelect value={quoteStageFilter} onChange={setQuoteStageFilter} options={quoteFilterOptions.stage} placeholder="Stage: Tất cả" hideClearOption />
            <SearchableSelect value={quotesSlaFilter} onChange={setQuotesSlaFilter} options={SLA_FILTER_OPTIONS} placeholder="SLA: Tất cả" hideClearOption />
          </div>

          {filteredQuotes === null ? (
            <p className="crm-empty-log">Đang tải...</p>
          ) : (
            <QuotesTable items={filteredQuotes} onOpen={quote => openRoot({ type: 'quote', quote, label: quote.quoteNumber || quote.quoteId })} showOwner />
          )}
        </section>
      ) : null}

      <ProgressDrawer
        stack={drawerStack}
        onClose={closeDrawer}
        onBack={backDrawer}
        onBreadcrumbClick={jumpToDrawer}
        onOpenMember={(memberId, memberName) => pushDrawer({ type: 'member', memberId, label: memberName })}
        onOpenQuote={quote => pushDrawer({ type: 'quote', quote, label: quote.quoteNumber || quote.quoteId })}
        onOpenLead={item => pushDrawer({ type: 'lead', item, label: item.leadName || 'Lead' })}
        onOpenCustomer={(customerId, customerName) => pushDrawer({ type: 'customer', customerId, label: customerName })}
        onOpenDeal={item => pushDrawer({ type: 'deal', item, label: item.customerName || 'Cơ hội' })}
        onOpenProject={item => pushDrawer({ type: 'project', item, label: item.projectName || item.projectCode || 'Dự án' })}
        onOpenContract={item => pushDrawer({ type: 'contract', item, label: item.contractNumber || item.title || 'Hợp đồng' })}
      />
    </div>
  );
}

function KpiGrid({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={`progress-kpi-grid${compact ? ' compact' : ''}`}>{children}</div>;
}

function Metric({
  tone,
  label,
  value,
  trend,
  subtext,
  onClick,
  active,
}: {
  tone: 'rose' | 'blue' | 'green' | 'amber' | 'purple' | 'danger' | 'slate';
  label: string;
  value: number | string;
  trend?: string;
  subtext?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button type="button" className={`progress-metric ${tone}${onClick ? ' clickable' : ''}${active ? ' active' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="progress-metric-icon" />
      <span className="progress-metric-label">{label}</span>
      <strong>{value}</strong>
      {trend || subtext ? <small>{trend || subtext}</small> : null}
    </button>
  );
}

function CardTitle({ title, subtitle, action, onClick }: { title: string; subtitle?: string; action?: string; onClick?: () => void }) {
  return (
    <div className="progress-card-title">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <button type="button" onClick={onClick}>{action}</button> : null}
    </div>
  );
}

function TeamsTable({ teams, onOpen, compact }: { teams: ProgressTeamSummary[]; onOpen: (teamId: string, teamName: string) => void; compact?: boolean }) {
  if (!teams.length) return <p className="crm-empty-log">Chưa có team nào trong phạm vi xem của bạn.</p>;
  return (
    <div className="qc-table-wrap progress-table-wrap">
      <table className="qc-team-table">
        <thead>
          <tr>
            <th>Team</th><th>Leader</th><th className="num-col">Thành viên</th><th className="num-col">Lead</th><th className="num-col">KH</th>
            <th className="num-col">Cơ hội</th><th className="num-col">Dự án</th><th className="num-col">Báo giá</th><th className="num-col">Hợp đồng</th>
            <th className="num-col">Quá SLA</th><th className="num-col">Pipeline</th><th />
          </tr>
        </thead>
        <tbody>
          {teams.slice(0, compact ? 6 : teams.length).map(t => (
            <tr key={t.teamId} className="progress-row-clickable" onClick={() => onOpen(t.teamId, t.teamName || t.teamId)}>
              <td><b>{t.teamName || t.teamId}</b></td>
              <td>{t.leaderName || 'Chưa xác định'}</td>
              <td className="num-col">{t.memberCount}</td>
              <td className="num-col">{t.leadCount}</td>
              <td className="num-col">{t.customerCount}</td>
              <td className="num-col">{t.dealCount}</td>
              <td className="num-col">{t.projectCount}</td>
              <td className="num-col">{t.quoteCount}</td>
              <td className="num-col">{t.contractCount}</td>
              <td className="num-col">{t.quotesOverSlaCount > 0 ? <span className="qc-badge qc-badge-danger">{t.quotesOverSlaCount}</span> : <span className="qc-badge qc-badge-neutral">0</span>}</td>
              <td className="num-col">{formatVND(t.pipelineValueVnd) || '0 đ'}</td>
              <td className="progress-arrow">›</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MembersTable({ members, onOpen }: { members: FlatMember[]; onOpen: (memberId: string, memberName: string) => void }) {
  if (!members.length) return <p className="crm-empty-log">Không có thành viên phù hợp.</p>;
  return (
    <div className="qc-table-wrap progress-table-wrap">
      <table className="qc-team-table">
        <thead>
          <tr>
            <th>Thành viên</th><th>Team</th><th>Role</th><th className="num-col">Lead</th><th className="num-col">KH</th><th className="num-col">Cơ hội</th>
            <th className="num-col">Dự án</th><th className="num-col">Báo giá</th><th className="num-col">Hợp đồng</th><th className="num-col">Quá SLA</th><th className="num-col">Pipeline</th><th />
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.userId} className="progress-row-clickable progress-member-row" onClick={() => onOpen(m.userId, m.userName || m.userId)}>
              <td>
                <span className="progress-person">
                  <span className="progress-avatar">{(m.userName || '?').slice(0, 1).toUpperCase()}</span>
                  <b>{m.userName}</b>
                </span>
              </td>
              <td>{m.teamName || '—'}</td>
              <td><span className="qc-badge qc-badge-neutral">{m.role || 'Member'}</span></td>
              <td className="num-col">{m.leadCount}</td>
              <td className="num-col">{m.customerCount}</td>
              <td className="num-col">{m.dealCount}</td>
              <td className="num-col">{m.projectCount}</td>
              <td className="num-col">{m.quoteCount}</td>
              <td className="num-col">{m.contractCount}</td>
              <td className="num-col">{m.quotesOverSlaCount > 0 ? <span className="qc-badge qc-badge-danger">{m.quotesOverSlaCount}</span> : <span className="qc-badge qc-badge-neutral">0</span>}</td>
              <td className="num-col">{formatVND(m.pipelineValueVnd) || '0 đ'}</td>
              <td className="progress-arrow">›</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Cảnh báo cần xử lý" cấp quản lý - render 6 nhóm cảnh báo THẬT từ
 * GET /progress/alerts, mỗi nhóm click thẳng ra đúng record (Quick View tại
 * chỗ). Nhóm nào rỗng thì ẩn luôn (không hiện "0 cảnh báo" giả tạo). */
function ManagementAlertsPanel({
  alerts,
  onOpenQuote,
  onOpenDeal,
  onOpenLead,
  onOpenContract,
  onSeeAllQuotes,
}: {
  alerts: ProgressAlerts | null;
  onOpenQuote: (item: ProgressQuoteItem) => void;
  onOpenDeal: (item: ProgressDealItem) => void;
  onOpenLead: (item: ProgressLeadItem) => void;
  onOpenContract: (item: ProgressContractItem) => void;
  onSeeAllQuotes: (slaFilter: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!alerts) return <p className="crm-empty-log">Đang tải...</p>;

  const quoteRep = (q: ProgressQuoteItem) => ({ label: `${q.quoteNumber} · ${q.customerName || '—'}`, sub: q.processingStageLabel, onOpen: () => onOpenQuote(q) });
  const dealRep = (d: ProgressDealItem) => ({ label: d.customerName || '—', sub: `${d.dealStageLabel} · quá hạn từ ${d.followUpDate ? new Date(d.followUpDate).toLocaleDateString('vi-VN') : '—'}`, onOpen: () => onOpenDeal(d) });
  const leadRep = (l: ProgressLeadItem) => ({ label: l.leadName || '—', sub: `${l.statusLabel} · ${formatSinceDuration(l.sinceAt)}`, onOpen: () => onOpenLead(l) });
  const contractRep = (c: ProgressContractItem) => ({ label: c.contractNumber || c.title || '—', sub: `${c.statusLabel} · ${formatSinceDuration(c.sinceAt)}`, onOpen: () => onOpenContract(c) });

  type Group = {
    key: string; title: string; tone: 'danger' | 'amber' | 'neutral'; count: number;
    representative: { label: string; sub: string; onOpen: () => void } | null;
    onSeeAll: () => void;
    expandedRows?: React.ReactNode;
  };

  const groups: Group[] = [
    {
      key: 'quotesOverdue', title: 'Báo giá quá SLA', tone: 'danger' as const, count: alerts.quotesOverdue.length,
      representative: alerts.quotesOverdue[0] ? quoteRep(alerts.quotesOverdue[0]) : null,
      onSeeAll: () => onSeeAllQuotes('overdue'),
    },
    {
      key: 'quotesDueSoon', title: 'Báo giá sắp đến hạn', tone: 'amber' as const, count: alerts.quotesDueSoon.length,
      representative: alerts.quotesDueSoon[0] ? quoteRep(alerts.quotesDueSoon[0]) : null,
      onSeeAll: () => onSeeAllQuotes('due_soon'),
    },
    {
      key: 'quotesNotSet', title: 'Báo giá chưa thiết lập SLA', tone: 'neutral' as const, count: alerts.quotesNotSet.length,
      representative: alerts.quotesNotSet[0] ? quoteRep(alerts.quotesNotSet[0]) : null,
      onSeeAll: () => onSeeAllQuotes('not_set'),
    },
    {
      key: 'followUp', title: 'Cơ hội quá hạn follow-up', tone: 'danger' as const, count: alerts.overdueFollowUpDeals.length,
      representative: alerts.overdueFollowUpDeals[0] ? dealRep(alerts.overdueFollowUpDeals[0]) : null,
      onSeeAll: () => setExpanded(s => toggleSet(s, 'followUp')),
      expandedRows: (
        <div className="progress-record-list">
          {alerts.overdueFollowUpDeals.slice(0, 5).map(d => (
            <button key={d.dealId} type="button" className="progress-record-card" onClick={() => onOpenDeal(d)}>
              <span className="progress-record-card-icon">🎯</span>
              <div className="progress-record-card-main">
                <div className="progress-record-card-title">{d.customerName}</div>
                <div className="progress-record-card-sub"><span className="qc-badge qc-badge-blue">{d.dealStageLabel}</span><span>Follow-up {d.followUpDate ? new Date(d.followUpDate).toLocaleDateString('vi-VN') : ''}</span></div>
              </div>
              <div className="progress-record-card-value">{formatVND(d.estimatedBudgetVnd) || '0 đ'}</div>
            </button>
          ))}
        </div>
      ),
    },
    {
      key: 'longLeads', title: 'Lead đứng lâu ở trạng thái', tone: 'neutral' as const, count: alerts.longStandingLeads.length,
      representative: alerts.longStandingLeads[0] ? leadRep(alerts.longStandingLeads[0]) : null,
      onSeeAll: () => setExpanded(s => toggleSet(s, 'longLeads')),
      expandedRows: (
        <div className="progress-record-list">
          {alerts.longStandingLeads.slice(0, 5).map(l => (
            <button key={l.leadId} type="button" className="progress-record-card" onClick={() => onOpenLead(l)}>
              <span className="progress-record-card-icon">🧲</span>
              <div className="progress-record-card-main">
                <div className="progress-record-card-title">{l.leadName}</div>
                <div className="progress-record-card-sub"><span className="qc-badge qc-badge-neutral">{l.statusLabel}</span><span>{formatSinceDuration(l.sinceAt)}</span></div>
              </div>
              <span className="progress-arrow">›</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      key: 'longContracts', title: 'Hợp đồng đứng lâu ở trạng thái', tone: 'neutral' as const, count: alerts.longStandingContracts.length,
      representative: alerts.longStandingContracts[0] ? contractRep(alerts.longStandingContracts[0]) : null,
      onSeeAll: () => setExpanded(s => toggleSet(s, 'longContracts')),
      expandedRows: (
        <div className="progress-record-list">
          {alerts.longStandingContracts.slice(0, 5).map(c => (
            <button key={c.contractId} type="button" className="progress-record-card" onClick={() => onOpenContract(c)}>
              <span className="progress-record-card-icon">📝</span>
              <div className="progress-record-card-main">
                <div className="progress-record-card-title">{c.contractNumber || c.title}</div>
                <div className="progress-record-card-sub"><span className="qc-badge qc-badge-neutral">{c.statusLabel}</span><span>{formatSinceDuration(c.sinceAt)}</span></div>
              </div>
              <div className="progress-record-card-value">{formatVND(c.contractValueVnd) || '0 đ'}</div>
            </button>
          ))}
        </div>
      ),
    },
  ].filter(g => g.count > 0);

  if (!groups.length) return <p className="crm-empty-log">Không có cảnh báo nào — mọi thứ đang ổn. 🎉</p>;

  return (
    <div className="progress-alerts-compact">
      {groups.map(g => (
        <div key={g.key} className="progress-alert-row">
          <div className="progress-alert-row-main">
            <span className={`qc-badge qc-badge-${g.tone === 'danger' ? 'danger' : g.tone === 'amber' ? 'warning' : 'neutral'}`}>{g.count}</span>
            <b className="progress-alert-row-title">{g.title}</b>
            {g.representative ? (
              <button type="button" className="progress-alert-row-rep" onClick={g.representative.onOpen}>
                {g.representative.label} <em>{g.representative.sub}</em>
              </button>
            ) : null}
            <button type="button" className="progress-alert-row-seeall" onClick={g.onSeeAll}>
              {g.expandedRows ? (expanded.has(g.key) ? 'Thu gọn' : 'Xem tất cả') : 'Xem tất cả'}
            </button>
          </div>
          {g.expandedRows && expanded.has(g.key) ? g.expandedRows : null}
        </div>
      ))}
    </div>
  );
}

function toggleSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function TeamOverdueRanking({ teams, onOpen }: { teams: ProgressTeamSummary[]; onOpen: (teamId: string, teamName: string) => void }) {
  const ranked = [...teams].filter(t => t.quotesOverSlaCount > 0).sort((a, b) => b.quotesOverSlaCount - a.quotesOverSlaCount).slice(0, 5);
  if (!ranked.length) return <p className="crm-empty-log">Không có team nào đang quá SLA.</p>;
  return (
    <div className="progress-compact-ranking">
      {ranked.map((t, idx) => (
        <button key={t.teamId} type="button" className="progress-compact-ranking-row" onClick={() => onOpen(t.teamId, t.teamName || t.teamId)}>
          <span className="progress-compact-ranking-index">{idx + 1}</span>
          <span className="progress-compact-ranking-name">{t.teamName}</span>
          <span className="qc-badge qc-badge-danger">{t.quotesOverSlaCount}</span>
        </button>
      ))}
    </div>
  );
}

/** Dropdown search toàn module - hiện dưới ô search chung, gom kết quả 8
 * loại record trả về từ GET /progress/search, click thẳng ra Quick View
 * tương ứng (Team/Member/Customer chỉ cần id+tên vì Quick View tự fetch). */
function GlobalSearchDropdown({
  results,
  onOpenTeam,
  onOpenMember,
  onOpenCustomer,
  onOpenLead,
  onOpenDeal,
  onOpenProject,
  onOpenQuote,
  onOpenContract,
}: {
  results: ProgressSearchResults | null;
  onOpenTeam: (teamId: string, teamName: string) => void;
  onOpenMember: (memberId: string, memberName: string) => void;
  onOpenCustomer: (customerId: string, customerName: string) => void;
  onOpenLead: (item: ProgressLeadItem) => void;
  onOpenDeal: (item: ProgressDealItem) => void;
  onOpenProject: (item: ProgressProjectItem) => void;
  onOpenQuote: (item: ProgressQuoteItem) => void;
  onOpenContract: (item: ProgressContractItem) => void;
}) {
  if (!results) return <div className="progress-search-dropdown"><p className="crm-empty-log">Đang tìm...</p></div>;
  const totalHits = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
  if (!totalHits) return <div className="progress-search-dropdown"><p className="crm-empty-log">Không tìm thấy kết quả.</p></div>;

  return (
    <div className="progress-search-dropdown">
      {results.teams.length > 0 ? (
        <div className="progress-search-group">
          <small>TEAM</small>
          {results.teams.map(t => (
            <button key={t.teamId} type="button" onClick={() => onOpenTeam(t.teamId, t.teamName || t.teamId)}>{t.teamName}</button>
          ))}
        </div>
      ) : null}
      {results.members.length > 0 ? (
        <div className="progress-search-group">
          <small>THÀNH VIÊN</small>
          {results.members.map(m => (
            <button key={m.userId} type="button" onClick={() => onOpenMember(m.userId, m.userName || m.userId)}>{m.userName} <em>{m.teamName || ''}</em></button>
          ))}
        </div>
      ) : null}
      {results.customers.length > 0 ? (
        <div className="progress-search-group">
          <small>KHÁCH HÀNG</small>
          {results.customers.map(c => (
            <button key={c.customerId} type="button" onClick={() => onOpenCustomer(c.customerId, c.customerName || 'Khách hàng')}>{c.customerName} <em>{c.companyName || ''}</em></button>
          ))}
        </div>
      ) : null}
      {results.leads.length > 0 ? (
        <div className="progress-search-group">
          <small>LEAD</small>
          {results.leads.map(l => (
            <button key={l.leadId} type="button" onClick={() => onOpenLead(l)}>{l.leadName} <em>{l.companyName || ''}</em></button>
          ))}
        </div>
      ) : null}
      {results.deals.length > 0 ? (
        <div className="progress-search-group">
          <small>CƠ HỘI</small>
          {results.deals.map(d => (
            <button key={d.dealId} type="button" onClick={() => onOpenDeal(d)}>{d.customerName} <em>{d.dealStageLabel}</em></button>
          ))}
        </div>
      ) : null}
      {results.projects.length > 0 ? (
        <div className="progress-search-group">
          <small>DỰ ÁN</small>
          {results.projects.map(p => (
            <button key={p.projectId} type="button" onClick={() => onOpenProject(p)}>{p.projectName || p.projectCode} <em>{p.customerName || ''}</em></button>
          ))}
        </div>
      ) : null}
      {results.quotes.length > 0 ? (
        <div className="progress-search-group">
          <small>BÁO GIÁ</small>
          {results.quotes.map(q => (
            <button key={q.quoteId} type="button" onClick={() => onOpenQuote(q)}>{q.quoteNumber} <em>{q.customerName || ''}</em></button>
          ))}
        </div>
      ) : null}
      {results.contracts.length > 0 ? (
        <div className="progress-search-group">
          <small>HỢP ĐỒNG</small>
          {results.contracts.map(c => (
            <button key={c.contractId} type="button" onClick={() => onOpenContract(c)}>{c.contractNumber || c.title}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Renders exactly ONE ProgressRightDrawer for the whole nested stack - only
 * the TOP entry's content changes, with breadcrumb/back driven by the stack.
 * This is what implements "KHÔNG NAVIGATE RA KHỎI Quản lý tiến độ": every
 * drill-down (Team → Member → Quote/Lead/Customer/Deal/Project/Contract)
 * pushes onto the same drawer instead of opening a new page. */
function ProgressDrawer({
  stack,
  onClose,
  onBack,
  onBreadcrumbClick,
  onOpenMember,
  onOpenQuote,
  onOpenLead,
  onOpenCustomer,
  onOpenDeal,
  onOpenProject,
  onOpenContract,
}: {
  stack: DrawerEntry[];
  onClose: () => void;
  onBack: () => void;
  onBreadcrumbClick: (idx: number) => void;
  onOpenMember: (memberId: string, memberName: string) => void;
  onOpenQuote: (quote: ProgressQuoteItem) => void;
  onOpenLead: (item: ProgressLeadItem) => void;
  onOpenCustomer: (customerId: string, customerName: string) => void;
  onOpenDeal: (item: ProgressDealItem) => void;
  onOpenProject: (item: ProgressProjectItem) => void;
  onOpenContract: (item: ProgressContractItem) => void;
}) {
  if (!stack.length) return null;
  const top = stack[stack.length - 1];
  const breadcrumb = stack.map(e => e.label);

  let eyebrow = '';
  let content: React.ReactNode = null;

  if (top.type === 'team') {
    eyebrow = 'Team detail';
    content = <ProgressTeamPanel teamId={top.teamId} onOpenMember={onOpenMember} onOpenQuote={onOpenQuote} />;
  } else if (top.type === 'member') {
    eyebrow = 'Member detail';
    content = (
      <ProgressMemberPanel
        key={`${top.memberId}-${top.initialTab || 'summary'}`}
        userId={top.memberId}
        initialTab={top.initialTab}
        onOpenQuote={onOpenQuote}
        onOpenLead={onOpenLead}
        onOpenCustomer={onOpenCustomer}
        onOpenDeal={onOpenDeal}
        onOpenProject={onOpenProject}
        onOpenContract={onOpenContract}
      />
    );
  } else if (top.type === 'quote') {
    eyebrow = top.quote.processingStageLabel;
    content = <ProgressQuoteDrawer item={top.quote} />;
  } else if (top.type === 'lead') {
    eyebrow = 'Lead';
    content = <ProgressLeadDrawer item={top.item} />;
  } else if (top.type === 'customer') {
    eyebrow = 'Khách hàng';
    content = <ProgressCustomerDrawer customerId={top.customerId} />;
  } else if (top.type === 'deal') {
    eyebrow = 'Cơ hội';
    content = <ProgressDealDrawer item={top.item} onOpenCustomer={(id, name) => onOpenCustomer(id, name)} />;
  } else if (top.type === 'project') {
    eyebrow = 'Dự án';
    content = <ProgressProjectDrawer item={top.item} onOpenCustomer={(id, name) => onOpenCustomer(id, name)} />;
  } else if (top.type === 'contract') {
    eyebrow = 'Hợp đồng';
    content = <ProgressContractDrawer item={top.item} />;
  }

  return (
    <ProgressRightDrawer
      eyebrow={eyebrow}
      title={top.label}
      onClose={onClose}
      onBack={stack.length > 1 ? onBack : undefined}
      breadcrumb={breadcrumb}
      onBreadcrumbClick={onBreadcrumbClick}
      width={680}
    >
      {content}
    </ProgressRightDrawer>
  );
}
