'use client';

import { useEffect, useMemo, useState } from 'react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { getAllTeams } from '@/services/linkedinCrawlerService';
import { formatVND } from '../../constants/crmConfig';
import { SearchableSelect } from '../SearchableSelect';
import '../../styles/quote-center.css';
import './progress.css';
import {
  Magnet,
  Users,
  Target,
  Folder,
  FileText,
  AlertTriangle,
  FileSignature,
  FileSpreadsheet,
  Filter,
  Clock,
  Hourglass,
  RotateCcw,
} from 'lucide-react';
import { ProgressTimeSeriesChart } from './ProgressTimeSeriesChart';
import { ProgressDonut } from './ProgressDonut';
import { ProgressOverdueQuotesTable } from './ProgressOverdueQuotesTable';
import { ProgressTeamPanel } from './ProgressTeamPanel';
import { ProgressTeamsListView, getLeaderName } from './ProgressTeamsListView';
import { ProgressMembersListView } from './ProgressMembersListView';
import { ProgressQuotesSlaView } from './ProgressQuotesSlaView';
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
  | { type: 'member'; memberId: string; label: string; initialTab?: 'summary' | 'action' | 'leads' | 'customers' | 'deals' | 'projects' | 'quotes' | 'contracts' }
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

const TIME_FILTER_TABS = [
  { value: '', label: 'Tất cả' },
  { value: 'week', label: 'Tuần này' },
  { value: 'month', label: 'Tháng này' },
  { value: 'quarter', label: 'Quý này' },
];

const QUOTE_SLA_OPTIONS = [
  { value: '', label: 'SLA: Tất cả' },
  { value: 'in_progress', label: 'Đúng hạn / Đang xử lý' },
  { value: 'due_soon', label: 'Sắp đến hạn' },
  { value: 'overdue', label: 'Quá SLA' },
  { value: 'not_set', label: 'Chưa thiết lập' },
];

const RECORD_TYPE_OPTIONS = [
  { value: '', label: 'Loại record: Tất cả' },
  { value: 'lead', label: 'Lead' },
  { value: 'customer', label: 'Khách hàng' },
  { value: 'deal', label: 'Cơ hội' },
  { value: 'project', label: 'Dự án' },
  { value: 'quote', label: 'Báo giá' },
  { value: 'contract', label: 'Hợp đồng' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Trạng thái: Tất cả' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'overdue', label: 'Quá hạn / Quá SLA' },
  { value: 'completed', label: 'Hoàn thành' },
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
  const [memberFilter, setMemberFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState('');
  const [customStartDate, setCustomStartDate] = useState('2026-09-01');
  const [customEndDate, setCustomEndDate] = useState('2026-09-21');
  const [recordTypeFilter, setRecordTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [teamLeaderFilter, setTeamLeaderFilter] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState('');
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
      getAllTeams().catch(() => null),
    ])
      .then(([ov, teamsRes, quotesRes, alertsRes, allTeamsRes]) => {
        if (!alive) return;
        setOverview(ov);
        const allTeamsList = (allTeamsRes && allTeamsRes.data) ? allTeamsRes.data : [];
        const enrichedTeams = teamsRes.teams.map(t => {
          if (t.leaderName) return t;
          const cleanTeamName = (t.teamName || t.teamId || '').toLowerCase().replace('team', '').trim();
          const matched = allTeamsList.find(at => {
            const cleanAtName = (at.name_team || '').toLowerCase().replace('team', '').trim();
            return cleanTeamName && cleanAtName && (cleanTeamName.includes(cleanAtName) || cleanAtName.includes(cleanTeamName));
          });
          if (matched && matched.leader_name) {
            return {
              ...t,
              leaderId: t.leaderId || matched.id_leader,
              leaderName: matched.leader_name,
            };
          }
          return t;
        });
        setTeams(enrichedTeams);
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
          if (!seen.has(m.userId)) {
            const isTeamLeader = team.leaderId === m.userId || (team.leaderName && team.leaderName.toLowerCase() === (m.userName || '').toLowerCase());
            const role = isTeamLeader && (!m.role || m.role.toLowerCase() === 'member') ? 'Leader' : (m.role || 'Member');
            seen.set(m.userId, { ...m, role, teamId: team.teamId, teamName: team.teamName });
          }
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

  const memberOptions = useMemo(() => {
    let list = flatMembers || [];
    if (teamFilter) {
      list = list.filter(m => m.teamId === teamFilter);
    }
    return [
      { value: '', label: 'Tất cả thành viên' },
      ...list.map(m => ({ value: m.userId, label: m.userName || m.userId })),
    ];
  }, [flatMembers, teamFilter]);

  const teamMembersMap = useMemo(() => {
    const map: Record<string, FlatMember[]> = {};
    (flatMembers || []).forEach(m => {
      const key = m.teamName || m.teamId || '';
      if (!map[key]) map[key] = [];
      map[key].push(m);
    });
    return map;
  }, [flatMembers]);

  const leaderOptions = useMemo(() => {
    const leaderNames = Array.from(
      new Set(
        teams
          .map(t => {
            const mems = teamMembersMap[t.teamName || t.teamId] || teamMembersMap[t.teamId] || [];
            return getLeaderName(t, mems);
          })
          .filter(name => name && name !== 'Chưa phân công')
      )
    );
    return [
      { value: '', label: 'Tất cả leader' },
      ...leaderNames.map(name => ({ value: name, label: name })),
    ];
  }, [teams, teamMembersMap]);

  const memberRoleOptions = useMemo(() => {
    // Quét toàn bộ vai trò thực tế từ database (thông qua flatMembers)
    const dbRoles = Array.from(
      new Set(
        (flatMembers || [])
          .map(m => (m.role || '').trim())
          .filter(Boolean)
      )
    );

    // Đảm bảo các vai trò tiêu chuẩn leader, member luôn có mặt
    const allRoles = Array.from(
      new Set(['leader', 'member', ...dbRoles.map(r => r.toLowerCase())])
    );

    const formatRoleLabel = (role: string) => {
      const lower = role.toLowerCase();
      if (lower === 'leader') return 'Trưởng nhóm (Leader)';
      if (lower === 'member') return 'Thành viên (Member)';
      if (lower === 'admin') return 'Quản trị viên (Admin)';
      if (lower === 'manager') return 'Quản lý (Manager)';
      if (lower === 'director') return 'Giám đốc (Director)';
      if (lower === 'intern') return 'Thực tập sinh (Intern)';
      if (lower === 'presale') return 'Chuyên viên kỹ thuật (Presale)';
      if (lower === 'sale') return 'Nhân viên kinh doanh (Sale)';
      // Tự động viết hoa chữ cái đầu cho bất kỳ vai trò mới nào được tạo trong DB
      return role.charAt(0).toUpperCase() + role.slice(1);
    };

    return [
      { value: '', label: 'Tất cả vai trò' },
      ...allRoles.map(r => ({ value: r, label: formatRoleLabel(r) })),
    ];
  }, [flatMembers]);

  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams.filter(t => {
      if (teamFilter && t.teamId !== teamFilter) return false;
      if (teamLeaderFilter) {
        const mems = teamMembersMap[t.teamName || t.teamId] || teamMembersMap[t.teamId] || [];
        const leader = getLeaderName(t, mems).toLowerCase();
        if (leader !== teamLeaderFilter.toLowerCase()) return false;
      }
      if (q && !`${t.teamName} ${t.leaderName || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [teams, teamFilter, teamLeaderFilter, search, teamMembersMap]);

  const visibleMembers = useMemo(() => {
    if (!flatMembers) return null;
    const q = search.trim().toLowerCase();
    return flatMembers.filter(m => {
      if (teamFilter && m.teamId !== teamFilter) return false;
      if (memberFilter && m.userId !== memberFilter) return false;
      if (memberRoleFilter) {
        const r = (m.role || '').toLowerCase();
        const target = memberRoleFilter.toLowerCase();
        if (target === 'leader') {
          const isLeader = r.includes('leader') || r.includes('admin') || r.includes('trưởng');
          if (!isLeader) return false;
        } else if (target === 'member') {
          const isLeader = r.includes('leader') || r.includes('admin') || r.includes('trưởng');
          if (isLeader) return false;
        } else {
          if (r !== target && !r.includes(target)) return false;
        }
      }
      if (q && !`${m.userName || ''} ${m.teamName || ''} ${m.role || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [flatMembers, teamFilter, memberFilter, memberRoleFilter, search]);

  const topMembers = useMemo(() => {
    if (!visibleMembers) return [];
    return [...visibleMembers]
      .sort((a, b) => {
        const totalA =
          (a.leadCount || 0) +
          (a.customerCount || 0) +
          (a.dealCount || 0) +
          (a.projectCount || 0) +
          (a.quoteCount || 0) +
          (a.contractCount || 0);
        const totalB =
          (b.leadCount || 0) +
          (b.customerCount || 0) +
          (b.dealCount || 0) +
          (b.projectCount || 0) +
          (b.quoteCount || 0) +
          (b.contractCount || 0);
        return totalB - totalA;
      })
      .slice(0, 5);
  }, [visibleMembers]);

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
    const items = allQuotes || quotesTab || [];
    const unique = (getter: (item: ProgressQuoteItem) => string | null | undefined, prefix: string) => [
      { value: '', label: `${prefix}: Tất cả` },
      ...Array.from(new Set(items.map(getter).filter(Boolean))).map(value => ({ value: value as string, label: value as string })),
    ];
    return {
      presale: unique(q => q.technicalOwnerName, 'Presale'),
      sale: unique(q => q.quoteOwnerName, 'Sale'),
      stage: unique(q => q.processingStageLabel, 'Bước'),
    };
  }, [allQuotes, quotesTab]);

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

  const dynamicKpis = useMemo(() => {
    if (!kpis) return null;
    if (!teamFilter && !memberFilter) return kpis;

    let targetMems = flatMembers || [];
    if (teamFilter) {
      targetMems = targetMems.filter(m => m.teamId === teamFilter);
    }
    if (memberFilter) {
      targetMems = targetMems.filter(m => m.userId === memberFilter);
    }
    if (!targetMems.length) return kpis;

    const leadTotal = targetMems.reduce((sum, m) => sum + (m.leadCount || 0), 0);
    const custTotal = targetMems.reduce((sum, m) => sum + (m.customerCount || 0), 0);
    const dealTotal = targetMems.reduce((sum, m) => sum + (m.dealCount || 0), 0);
    const projTotal = targetMems.reduce((sum, m) => sum + (m.projectCount || 0), 0);
    const quoteTotal = targetMems.reduce((sum, m) => sum + (m.quoteCount || 0), 0);
    const contractTotal = targetMems.reduce((sum, m) => sum + (m.contractCount || 0), 0);

    const memIds = new Set(targetMems.map(m => m.userId));
    const memQuotes = (allQuotes || []).filter(q => {
      return (q.technicalOwnerId && memIds.has(q.technicalOwnerId)) || (q.quoteOwnerId && memIds.has(q.quoteOwnerId));
    });
    const quotesOverSla = memQuotes.filter(q => q.sla?.status === 'overdue' || q.sla?.status === 'completed_late').length;

    return {
      ...kpis,
      leadsInProgress: { ...kpis.leadsInProgress, count: leadTotal },
      customersBeingCared: { ...kpis.customersBeingCared, count: custTotal },
      dealsOpen: { ...kpis.dealsOpen, count: dealTotal },
      projectsActive: { ...kpis.projectsActive, count: projTotal },
      quotesInProgress: { ...kpis.quotesInProgress, count: quoteTotal || memQuotes.length },
      quotesOverSla: { ...kpis.quotesOverSla, count: quotesOverSla },
      contractsTracked: { ...kpis.contractsTracked, count: contractTotal },
    };
  }, [kpis, teamFilter, memberFilter, flatMembers, allQuotes]);

  const donutSegments = useMemo(
    () => [
      { label: 'Lead', value: dynamicKpis?.leadsInProgress.count || 0, color: '#2563eb' },
      { label: 'Khách hàng', value: dynamicKpis?.customersBeingCared.count || 0, color: '#e11d48' },
      { label: 'Cơ hội', value: dynamicKpis?.dealsOpen.count || 0, color: '#16a34a' },
      { label: 'Dự án đang chạy', value: dynamicKpis?.projectsActive.count || 0, color: '#9333ea' },
      { label: 'Báo giá', value: dynamicKpis?.quotesInProgress.count || 0, color: '#ea580c' },
      { label: 'Báo giá quá SLA', value: dynamicKpis?.quotesOverSla.count || 0, color: '#dc2626' },
      { label: 'Hợp đồng theo dõi', value: dynamicKpis?.contractsTracked.count || 0, color: '#8b5cf6' },
    ],
    [dynamicKpis]
  );

  const timeSeriesTotals = useMemo(
    () => ({
      lead: dynamicKpis?.leadsInProgress.count || 0,
      customer: dynamicKpis?.customersBeingCared.count || 0,
      deal: dynamicKpis?.dealsOpen.count || 0,
      project: dynamicKpis?.projectsActive.count || 0,
      quote: dynamicKpis?.quotesInProgress.count || 0,
      quoteOverdue: dynamicKpis?.quotesOverSla.count || 0,
      contract: dynamicKpis?.contractsTracked.count || 0,
    }),
    [dynamicKpis]
  );

  const searchPlaceholder = useMemo(() => {
    switch (tab) {
      case 'teams':
        return 'Tìm tên team, leader...';
      case 'members':
        return 'Tìm theo tên thành viên, vai trò...';
      case 'quotes':
        return 'Tìm mã báo giá, khách hàng, dự án...';
      case 'overview':
      default:
        return 'Tìm kiếm team, thành viên, lead, khách hàng, cơ hội, dự án, báo giá, hợp đồng...';
    }
  }, [tab]);

  const isAnyFilterActive = useMemo(() => {
    if (search.trim()) return true;
    if (teamFilter) return true;
    if (tab === 'overview') {
      return Boolean(memberFilter || timeFilter || recordTypeFilter || statusFilter || customStartDate !== '2026-09-01' || customEndDate !== '2026-09-21');
    }
    if (tab === 'teams') {
      return Boolean(teamLeaderFilter);
    }
    if (tab === 'members') {
      return Boolean(memberFilter || memberRoleFilter);
    }
    if (tab === 'quotes') {
      return Boolean(quotesSlaFilter || quotePresaleFilter || quoteSaleFilter || quoteStageFilter);
    }
    return false;
  }, [
    search,
    teamFilter,
    tab,
    memberFilter,
    timeFilter,
    customStartDate,
    customEndDate,
    recordTypeFilter,
    statusFilter,
    teamLeaderFilter,
    memberRoleFilter,
    quotesSlaFilter,
    quotePresaleFilter,
    quoteSaleFilter,
    quoteStageFilter,
  ]);

  const handleResetFilters = () => {
    setSearch('');
    setTeamFilter('');
    setMemberFilter('');
    setTimeFilter('');
    setCustomStartDate('2026-09-01');
    setCustomEndDate('2026-09-21');
    setRecordTypeFilter('');
    setStatusFilter('');
    setTeamLeaderFilter('');
    setMemberRoleFilter('');
    setQuotesSlaFilter('');
    setQuotePresaleFilter('');
    setQuoteSaleFilter('');
    setQuoteStageFilter('');
  };

  const totalAlertsCount = useMemo(() => {
    if (!alerts) return 0;
    return (
      (alerts.quotesOverdue?.length || 0) +
      (alerts.overdueFollowUpDeals?.length || 0) +
      (alerts.quotesDueSoon?.length || 0) +
      (alerts.longStandingContracts?.length || 0) +
      (alerts.longStandingLeads?.length || 0)
    );
  }, [alerts]);

  return (
    <div className="qc-page progress-page">
      <div className="progress-toolbar-controls">
        <div className="progress-global-search">
          <input
            className="progress-toolbar-search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => {
              if (tab === 'overview') setSearchOpen(true);
            }}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          />
          {tab === 'overview' && searchOpen && search.trim().length >= 2 ? (
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

        {/* Tab 1: Tổng quan */}
        {tab === 'overview' && (
          <>
            <div className="progress-select">
              <SearchableSelect value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="Tất cả team" hideClearOption />
            </div>
            <div className="progress-select">
              <SearchableSelect value={memberFilter} onChange={setMemberFilter} options={memberOptions} placeholder="Tất cả thành viên" hideClearOption />
            </div>
            <div className="progress-time-filter-row">
              <div className="progress-time-tabs" aria-label="Bộ lọc thời gian">
                {TIME_FILTER_TABS.map(option => (
                  <button
                    key={option.value || 'all'}
                    type="button"
                    className={timeFilter === option.value ? 'active' : ''}
                    onClick={() => setTimeFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="progress-date-range-control" title="Khoảng thời gian tùy chỉnh">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={event => {
                    setCustomStartDate(event.target.value);
                    setTimeFilter('custom');
                  }}
                  aria-label="Từ ngày"
                />
                <span>-</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={event => {
                    setCustomEndDate(event.target.value);
                    setTimeFilter('custom');
                  }}
                  aria-label="Đến ngày"
                />
              </div>
            </div>
          </>
        )}

        {/* Tab 2: Theo team */}
        {tab === 'teams' && (
          <>
            <div className="progress-select">
              <SearchableSelect value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="Tất cả team" hideClearOption />
            </div>
            <div className="progress-select">
              <SearchableSelect value={teamLeaderFilter} onChange={setTeamLeaderFilter} options={leaderOptions} placeholder="Tất cả leader" hideClearOption />
            </div>
          </>
        )}

        {/* Tab 3: Theo thành viên */}
        {tab === 'members' && (
          <>
            <div className="progress-select">
              <SearchableSelect value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="Tất cả team" hideClearOption />
            </div>
            <div className="progress-select">
              <SearchableSelect value={memberRoleFilter} onChange={setMemberRoleFilter} options={memberRoleOptions} placeholder="Tất cả vai trò" hideClearOption />
            </div>
          </>
        )}

        {/* Tab 4: Báo giá & SLA */}
        {tab === 'quotes' && (
          <>
            <div className="progress-select">
              <SearchableSelect value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="Tất cả team" hideClearOption />
            </div>
            <div className="progress-select">
              <SearchableSelect value={quotePresaleFilter} onChange={setQuotePresaleFilter} options={quoteFilterOptions.presale} placeholder="Presale" hideClearOption />
            </div>
            <div className="progress-select">
              <SearchableSelect value={quoteSaleFilter} onChange={setQuoteSaleFilter} options={quoteFilterOptions.sale} placeholder="Sale" hideClearOption />
            </div>
            <div className="progress-select">
              <SearchableSelect value={quoteStageFilter} onChange={setQuoteStageFilter} options={quoteFilterOptions.stage} placeholder="Bước hiện tại" hideClearOption />
            </div>
            <div className="progress-select">
              <SearchableSelect value={quotesSlaFilter} onChange={setQuotesSlaFilter} options={QUOTE_SLA_OPTIONS} placeholder="Trạng thái SLA" hideClearOption />
            </div>
          </>
        )}

        <button
          type="button"
          className={`progress-filter-reset-btn${isAnyFilterActive ? ' active' : ''}`}
          onClick={handleResetFilters}
          title="Đặt lại bộ lọc"
        >
          <RotateCcw size={14} />
          <span>Đặt lại</span>
        </button>
        <button
          type="button"
          className="progress-export-btn"
          onClick={() => {
            if (typeof window !== 'undefined') window.print();
          }}
        >
          <FileSpreadsheet size={15} /> Xuất báo cáo
        </button>
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
            <div className="progress-kpi-7-grid">
              <div className="progress-kpi-card tone-blue">
                <div className="progress-kpi-icon-wrap">
                  <Magnet size={16} strokeWidth={2.2} />
                </div>
                <div className="progress-kpi-body">
                  <span className="progress-kpi-title">Lead đang xử lý</span>
                  <div className="progress-kpi-val-row">
                    <span className="progress-kpi-val">{dynamicKpis?.leadsInProgress.count ?? 0}</span>
                    <span className="progress-kpi-trend trend-up">↑ 12%</span>
                  </div>
                </div>
              </div>

              <div className="progress-kpi-card tone-rose">
                <div className="progress-kpi-icon-wrap">
                  <Users size={16} strokeWidth={2.2} />
                </div>
                <div className="progress-kpi-body">
                  <span className="progress-kpi-title">Khách hàng đang chăm</span>
                  <div className="progress-kpi-val-row">
                    <span className="progress-kpi-val">{dynamicKpis?.customersBeingCared.count ?? 0}</span>
                    <span className="progress-kpi-trend trend-up">↑ 5%</span>
                  </div>
                </div>
              </div>

              <div className="progress-kpi-card tone-green">
                <div className="progress-kpi-icon-wrap">
                  <Target size={16} strokeWidth={2.2} />
                </div>
                <div className="progress-kpi-body">
                  <span className="progress-kpi-title">Cơ hội đang mở</span>
                  <div className="progress-kpi-val-row">
                    <span className="progress-kpi-val">{dynamicKpis?.dealsOpen.count ?? 0}</span>
                    <span className="progress-kpi-trend trend-up">↑ 8%</span>
                  </div>
                </div>
              </div>

              <div className="progress-kpi-card tone-purple">
                <div className="progress-kpi-icon-wrap">
                  <Folder size={16} strokeWidth={2.2} />
                </div>
                <div className="progress-kpi-body">
                  <span className="progress-kpi-title">Dự án đang chạy</span>
                  <div className="progress-kpi-val-row">
                    <span className="progress-kpi-val">{dynamicKpis?.projectsActive.count ?? 0}</span>
                    <span className="progress-kpi-trend trend-up">↑ 2</span>
                  </div>
                </div>
              </div>

              <div className="progress-kpi-card tone-amber clickable" onClick={() => setTab('quotes')}>
                <div className="progress-kpi-icon-wrap">
                  <FileText size={16} strokeWidth={2.2} />
                </div>
                <div className="progress-kpi-body">
                  <span className="progress-kpi-title">Báo giá đang xử lý</span>
                  <div className="progress-kpi-val-row">
                    <span className="progress-kpi-val">{dynamicKpis?.quotesInProgress.count ?? 0}</span>
                    <span className="progress-kpi-trend trend-up">↑ 8%</span>
                  </div>
                </div>
              </div>

              <div
                className="progress-kpi-card tone-danger clickable"
                onClick={() => {
                  setQuotesSlaFilter('overdue');
                  setTab('quotes');
                }}
              >
                <div className="progress-kpi-icon-wrap">
                  <AlertTriangle size={16} strokeWidth={2.2} />
                </div>
                <div className="progress-kpi-body">
                  <span className="progress-kpi-title">Báo giá quá SLA</span>
                  <div className="progress-kpi-val-row">
                    <span className="progress-kpi-val">{dynamicKpis?.quotesOverSla.count ?? 0}</span>
                    <span className="progress-kpi-trend trend-down">↓ 15%</span>
                  </div>
                </div>
              </div>

              <div className="progress-kpi-card tone-slate">
                <div className="progress-kpi-icon-wrap">
                  <FileSignature size={16} strokeWidth={2.2} />
                </div>
                <div className="progress-kpi-body">
                  <span className="progress-kpi-title" title="Hợp đồng đang theo dõi">Hợp đồng đang theo dõi</span>
                  <div className="progress-kpi-val-row">
                    <span className="progress-kpi-val">{dynamicKpis?.contractsTracked.count ?? 0}</span>
                    <span className="progress-kpi-trend trend-up">↑ 3</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sơ đồ đa đường toàn chiều rộng: Trải dài thoáng đãng, không bị co hẹp */}
            <section className="progress-card progress-card-timeseries-full">
              <ProgressTimeSeriesChart totals={timeSeriesTotals} />
            </section>

            {/* Hàng 2 cột cân đối: Cơ cấu record (Donut) và Cảnh báo cần xử lý */}
            <div className="progress-sub-middle-row">
              <section className="progress-card">
                <CardTitle title="Cơ cấu record đang xử lý" subtitle="Tỷ lệ 7 nhóm đối tượng" />
                <ProgressDonut segments={donutSegments} />
              </section>

              <section className="progress-card">
                <CardTitle
                  title="Cảnh báo cần xử lý"
                  subtitle={`${totalAlertsCount} cảnh báo cần can thiệp`}
                />
                <ManagementAlertsPanel
                  alerts={alerts}
                  onOpenQuote={quote => openRoot({ type: 'quote', quote, label: quote.quoteNumber || quote.quoteId })}
                  onOpenDeal={item => openRoot({ type: 'deal', item, label: item.customerName || 'Cơ hội' })}
                  onOpenLead={item => openRoot({ type: 'lead', item, label: item.leadName || 'Lead' })}
                  onOpenContract={item => openRoot({ type: 'contract', item, label: item.contractNumber || item.title || 'Hợp đồng' })}
                  onSeeAllQuotes={filter => {
                    setQuotesSlaFilter(filter);
                    setTab('quotes');
                  }}
                />
              </section>
            </div>

            <div className="progress-tables-row">
              <section className="progress-card">
                <CardTitle title="Tiến độ theo team" action="Xem tất cả →" onClick={() => setTab('teams')} />
                <TeamsTable teams={visibleTeams} onOpen={(teamId, teamName) => openRoot({ type: 'team', teamId, label: teamName })} compact />
              </section>

              <section className="progress-card">
                <CardTitle title="Top thành viên nhiều việc" action="Xem tất cả →" onClick={() => setTab('members')} />
                <TopMembersTable members={topMembers} onOpen={(memberId, memberName) => openRoot({ type: 'member', memberId, label: memberName })} />
              </section>
            </div>

            <ProgressOverdueQuotesTable
              quotes={allQuotes || []}
              onOpenQuote={quote => openRoot({ type: 'quote', quote, label: quote.quoteNumber || quote.quoteId })}
              onSeeAll={() => {
                setQuotesSlaFilter('overdue');
                setTab('quotes');
              }}
            />
          </>
        )
      ) : null}

      {tab === 'teams' ? (
        <section className="progress-card">
          <ProgressTeamsListView
            teams={visibleTeams}
            teamMembersMap={teamMembersMap}
            onOpen={(teamId, teamName) => openRoot({ type: 'team', teamId, label: teamName })}
          />
        </section>
      ) : null}

      {tab === 'members' ? (
        visibleMembers === null ? (
          <section className="progress-card">
            <p className="crm-empty-log">Đang tải...</p>
          </section>
        ) : (
          <ProgressMembersListView
            members={visibleMembers}
            allMembers={flatMembers || []}
            overviewKpis={dynamicKpis}
            onOpen={(memberId, memberName) => openRoot({ type: 'member', memberId, label: memberName, initialTab: 'summary' })}
          />
        )
      ) : null}

      {tab === 'quotes' ? (
        allQuotes === null ? (
          <section className="progress-card">
            <p className="crm-empty-log">Đang tải...</p>
          </section>
        ) : (
          <ProgressQuotesSlaView
            quotes={allQuotes}
            teams={teams}
            teamMembersMap={teamMembersMap}
            onOpenQuote={quote => openRoot({ type: 'quote', quote, label: quote.quoteNumber || quote.quoteId })}
            externalSearch={search}
            externalTeamFilter={teamFilter}
            externalMemberFilter={memberFilter}
            externalStatusFilter={quotesSlaFilter}
            externalPresaleFilter={quotePresaleFilter}
            externalSaleFilter={quoteSaleFilter}
            externalStageFilter={quoteStageFilter}
          />
        )
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
            <th className="num-col">Cơ hội</th>
            {!compact && <th className="num-col">Dự án</th>}
            <th className="num-col">Báo giá</th>
            {!compact && <th className="num-col">Hợp đồng</th>}
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
              {!compact && <td className="num-col">{t.projectCount}</td>}
              <td className="num-col">{t.quoteCount}</td>
              {!compact && <td className="num-col">{t.contractCount}</td>}
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

function TopMembersTable({
  members,
  onOpen,
}: {
  members: FlatMember[];
  onOpen: (userId: string, userName: string) => void;
}) {
  if (!members.length) return <p className="crm-empty-log">Chưa có thành viên nào.</p>;
  return (
    <div className="qc-table-wrap progress-table-wrap">
      <table className="qc-team-table">
        <thead>
          <tr>
            <th>Thành viên</th>
            <th>Team</th>
            <th className="num-col">Tổng việc</th>
            <th className="num-col">Báo giá</th>
            <th className="num-col">Quá SLA</th>
            <th className="num-col">Pipeline</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map(m => {
            const totalWork =
              (m.leadCount || 0) +
              (m.customerCount || 0) +
              (m.dealCount || 0) +
              (m.projectCount || 0) +
              (m.quoteCount || 0) +
              (m.contractCount || 0);
            return (
              <tr
                key={m.userId}
                className="progress-row-clickable"
                onClick={() => onOpen(m.userId, m.userName || m.userId)}
              >
                <td>
                  <div className="progress-member-avatar-cell">
                    <span className="progress-member-avatar">
                      {(m.userName || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <b>{m.userName}</b>
                  </div>
                </td>
                <td>{m.teamName || '—'}</td>
                <td className="num-col">
                  <b>{totalWork}</b>
                </td>
                <td className="num-col">{m.quoteCount}</td>
                <td className="num-col">
                  {m.quotesOverSlaCount > 0 ? (
                    <span className="qc-badge qc-badge-danger">{m.quotesOverSlaCount}</span>
                  ) : (
                    <span className="qc-badge qc-badge-neutral">0</span>
                  )}
                </td>
                <td className="num-col">{formatVND(m.pipelineValueVnd) || '0 đ'}</td>
                <td className="progress-arrow">›</td>
              </tr>
            );
          })}
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

/** "Cảnh báo cần xử lý" cấp quản lý - render các cảnh báo THẬT từ
 * GET /progress/alerts, mỗi item click thẳng ra đúng record trong Drawer. */
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
  if (!alerts) return <p className="crm-empty-log">Đang tải...</p>;

  type AlertItem = {
    id: string;
    icon: React.ReactNode;
    title: string;
    meta: string;
    badgeText: string;
    badgeTone: 'danger' | 'warning' | 'caution';
    timeText: string;
    onClick: () => void;
  };

  const items: AlertItem[] = [];

  (alerts.quotesOverdue || []).forEach(q => {
    items.push({
      id: `quote-overdue-${q.quoteId}`,
      icon: <AlertTriangle size={15} color="#dc2626" />,
      title: `Báo giá ${q.quoteNumber}`,
      meta: `${q.customerName || '—'} · ${q.processingStageLabel}`,
      badgeText: 'Quá SLA',
      badgeTone: 'danger',
      timeText: q.sla?.dueAt
        ? `Hạn ${new Date(q.sla.dueAt).toLocaleDateString('vi-VN')}`
        : 'Quá hạn',
      onClick: () => onOpenQuote(q),
    });
  });

  (alerts.overdueFollowUpDeals || []).forEach(d => {
    items.push({
      id: `deal-followup-${d.dealId}`,
      icon: <Clock size={15} color="#ea580c" />,
      title: `Cơ hội: ${d.customerName}`,
      meta: `${d.dealStageLabel} · Follow-up quá hạn`,
      badgeText: 'Chưa follow-up',
      badgeTone: 'warning',
      timeText: d.followUpDate ? `Từ ${new Date(d.followUpDate).toLocaleDateString('vi-VN')}` : 'Quá hạn',
      onClick: () => onOpenDeal(d),
    });
  });

  (alerts.quotesDueSoon || []).forEach(q => {
    items.push({
      id: `quote-duesoon-${q.quoteId}`,
      icon: <Hourglass size={15} color="#d97706" />,
      title: `Báo giá ${q.quoteNumber}`,
      meta: `${q.customerName || '—'} · ${q.processingStageLabel}`,
      badgeText: 'Sắp đến hạn',
      badgeTone: 'caution',
      timeText: 'Sắp hết SLA',
      onClick: () => onOpenQuote(q),
    });
  });

  (alerts.longStandingContracts || []).forEach(c => {
    items.push({
      id: `contract-standing-${c.contractId}`,
      icon: <FileSignature size={15} color="#7c3aed" />,
      title: `Hợp đồng ${c.contractNumber || c.title}`,
      meta: `${c.statusLabel} · Đứng lâu`,
      badgeText: 'Chờ ký',
      badgeTone: 'warning',
      timeText: formatSinceDuration(c.sinceAt),
      onClick: () => onOpenContract(c),
    });
  });

  (alerts.longStandingLeads || []).forEach(l => {
    items.push({
      id: `lead-standing-${l.leadId}`,
      icon: <Magnet size={15} color="#2563eb" />,
      title: `Lead: ${l.leadName}`,
      meta: `${l.statusLabel} · Đứng lâu`,
      badgeText: 'Tồn đọng',
      badgeTone: 'caution',
      timeText: formatSinceDuration(l.sinceAt),
      onClick: () => onOpenLead(l),
    });
  });

  if (!items.length) {
    return <p className="crm-empty-log">Không có cảnh báo nào — mọi thứ đang ổn. 🎉</p>;
  }

  return (
    <div className="progress-alerts-list">
      {items.slice(0, 4).map(it => (
        <button key={it.id} type="button" className="progress-alert-row" onClick={it.onClick}>
          <span className="progress-alert-icon">{it.icon}</span>
          <div className="progress-alert-content">
            <span className="progress-alert-title">{it.title}</span>
            <span className="progress-alert-meta">{it.meta}</span>
          </div>
          <span className={`progress-alert-badge ${it.badgeTone}`}>{it.badgeText}</span>
          <span className="progress-alert-time">{it.timeText}</span>
        </button>
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
    content = (
      <ProgressTeamPanel
        teamId={top.teamId}
        teamName={top.label}
        onClose={onClose}
        onBack={stack.length > 1 ? onBack : undefined}
        onOpenMember={onOpenMember}
        onOpenQuote={onOpenQuote}
        onOpenDeal={onOpenDeal}
        onOpenProject={onOpenProject}
        onOpenContract={onOpenContract}
      />
    );
  } else if (top.type === 'member') {
    eyebrow = 'Member detail';
    content = (
      <ProgressMemberPanel
        key={`${top.memberId}-${top.initialTab || 'summary'}`}
        userId={top.memberId}
        initialTab={top.initialTab || 'summary'}
        onClose={onClose}
        onBack={stack.length > 1 ? onBack : undefined}
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
      width={top.type === 'member' || top.type === 'team' || top.type === 'quote' ? 780 : 680}
      hideHeader={top.type === 'member' || top.type === 'team'}
    >
      {content}
    </ProgressRightDrawer>
  );
}
