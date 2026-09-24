'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  User,
  Magnet,
  Building2,
  Handshake,
  Box,
  FileText,
  FileCheck,
  AlertTriangle,
  Wallet,
  X,
  ArrowLeft,
  Search,
  Laptop,
  Megaphone,
  Headphones,
  GraduationCap,
  Code2,
  Clock,
  Eye,
  BarChart2,
  PieChart,
  Layers,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { formatDate } from '../../constants/crmConfig';
import { PROJECT_STATUS_TONE, CONTRACT_STATUS_TONE } from './progressLabels';
import type {
  ProgressQuoteItem,
  ProgressTeamDetail,
  ProgressMemberSummaryRow,
  ProgressDealItem,
  ProgressProjectItem,
  ProgressContractItem,
} from './progress.types';

export type TeamDrawerTab = 'overview' | 'members' | 'quotes' | 'deals' | 'projects' | 'contracts';

export type TimeFilterPreset = 'all' | 'week' | 'month' | 'year' | 'custom';

export interface DrawerTimeFilterProps {
  preset: TimeFilterPreset;
  startDate: string;
  endDate: string;
  onPresetChange: (preset: TimeFilterPreset) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

export function getPresetDates(preset: TimeFilterPreset): { startDate: string; endDate: string } {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  if (preset === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { startDate: d.toISOString().slice(0, 10), endDate: todayStr };
  }
  if (preset === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return { startDate: d.toISOString().slice(0, 10), endDate: todayStr };
  }
  if (preset === 'year') {
    const y = now.getFullYear();
    return { startDate: `${y}-01-01`, endDate: todayStr };
  }
  return { startDate: '', endDate: '' };
}

export function DrawerTimeFilter({
  preset,
  startDate,
  endDate,
  onPresetChange,
  onStartDateChange,
  onEndDateChange,
}: DrawerTimeFilterProps) {
  return (
    <div className="drawer-time-filter-wrap">
      <div className="drawer-time-presets">
        <button
          type="button"
          className={`drawer-time-preset-btn${preset === 'all' ? ' active' : ''}`}
          onClick={() => {
            onPresetChange('all');
            onStartDateChange('');
            onEndDateChange('');
          }}
        >
          Tất cả
        </button>
        <button
          type="button"
          className={`drawer-time-preset-btn${preset === 'week' ? ' active' : ''}`}
          onClick={() => {
            onPresetChange('week');
            const dates = getPresetDates('week');
            onStartDateChange(dates.startDate);
            onEndDateChange(dates.endDate);
          }}
        >
          Tuần
        </button>
        <button
          type="button"
          className={`drawer-time-preset-btn${preset === 'month' ? ' active' : ''}`}
          onClick={() => {
            onPresetChange('month');
            const dates = getPresetDates('month');
            onStartDateChange(dates.startDate);
            onEndDateChange(dates.endDate);
          }}
        >
          Tháng
        </button>
        <button
          type="button"
          className={`drawer-time-preset-btn${preset === 'year' ? ' active' : ''}`}
          onClick={() => {
            onPresetChange('year');
            const dates = getPresetDates('year');
            onStartDateChange(dates.startDate);
            onEndDateChange(dates.endDate);
          }}
        >
          Năm
        </button>
        <button
          type="button"
          className={`drawer-time-preset-btn${preset === 'custom' ? ' active' : ''}`}
          onClick={() => onPresetChange('custom')}
        >
          Tùy chỉnh
        </button>
      </div>

      {preset === 'custom' && (
        <div className="drawer-time-custom-inputs">
          <input
            type="date"
            value={startDate}
            onChange={e => onStartDateChange(e.target.value)}
            title="Từ ngày"
          />
          <span>–</span>
          <input
            type="date"
            value={endDate}
            onChange={e => onEndDateChange(e.target.value)}
            title="Đến ngày"
          />
        </div>
      )}
    </div>
  );
}

const AVATAR_COLORS = [
  '#f43f5e',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#6366f1',
];

// Helper format full VND: 89.000.000 đ, 1.280.000.000 đ, 0 đ
function formatCompactVND(val: number | null | undefined): string {
  if (!val || val <= 0) return '0 đ';
  return `${val.toLocaleString('vi-VN')} đ`;
}

function formatVND(val: number | null | undefined): string {
  if (!val || val <= 0) return '0 đ';
  return `${val.toLocaleString('vi-VN')} đ`;
}

// Visual themes for teams based on team name (matching CRM standard)
function getTeamTheme(name: string) {
  const n = (name || '').toLowerCase();
  if (n.includes('sales') || n.includes('kinh doanh')) {
    return { bg: '#fee2e2', color: '#ef4444', icon: Users };
  }
  if ((n.includes('tech') || n.includes('kỹ thuật') || n.includes('giải pháp')) && !n.includes('intern')) {
    return { bg: '#dbeafe', color: '#3b82f6', icon: Laptop };
  }
  if (n.includes('market')) {
    return { bg: '#dcfce7', color: '#22c55e', icon: Megaphone };
  }
  if (n.includes('presale')) {
    return { bg: '#f3e8ff', color: '#a855f7', icon: Headphones };
  }
  if (n.includes('intern l1')) {
    return { bg: '#ffedd5', color: '#f97316', icon: GraduationCap };
  }
  if (n.includes('dev')) {
    return { bg: '#cffafe', color: '#0891b2', icon: Code2 };
  }
  if (n.includes('back-office') || n.includes('office')) {
    return { bg: '#f1f5f9', color: '#475569', icon: Building2 };
  }
  if (n.includes('intern l2') || n.includes('intern')) {
    return { bg: '#fce7f3', color: '#db2777', icon: GraduationCap };
  }
  return { bg: '#ede9fe', color: '#7c3aed', icon: Users };
}

// Avatar ký tự viết tắt chuẩn CRM, hỗ trợ tự động hiển thị avatarUrl từ DB trong tương lai
function MemberAvatar({
  name,
  index,
  avatarUrl,
}: {
  name: string;
  index: number;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="progress-member-avatar-img"
        title={name}
      />
    );
  }
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const bg = AVATAR_COLORS[index % AVATAR_COLORS.length];

  return (
    <span
      className="progress-member-avatar-initial"
      style={{ backgroundColor: bg }}
      title={name}
    >
      {initial}
    </span>
  );
}

export function DrawerPagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  itemName = 'mục',
}: {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  itemName?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentSafePage = Math.min(Math.max(1, currentPage), totalPages);

  if (totalItems <= 0) return null;

  return (
    <div className="drawer-pagination-toolbar">
      <div className="drawer-pagination-info">
        Hiển thị {(currentSafePage - 1) * pageSize + 1} -{' '}
        {Math.min(currentSafePage * pageSize, totalItems)} trên {totalItems} {itemName}
      </div>

      <div className="drawer-pagination-actions">
        <button
          type="button"
          className="drawer-pagination-btn"
          disabled={currentSafePage <= 1}
          onClick={() => onPageChange(Math.max(1, currentSafePage - 1))}
          aria-label="Trang trước"
          title="Trang trước"
        >
          <ChevronLeft size={15} />
        </button>

        {Array.from({ length: totalPages }).map((_, pIdx) => {
          const p = pIdx + 1;
          if (totalPages > 5 && Math.abs(p - currentSafePage) > 1 && p !== 1 && p !== totalPages) {
            if (p === 2 || p === totalPages - 1) {
              return <span key={p} className="drawer-pagination-ellipsis">...</span>;
            }
            return null;
          }
          return (
            <button
              key={p}
              type="button"
              className={`drawer-pagination-btn${p === currentSafePage ? ' active' : ''}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          );
        })}

        <button
          type="button"
          className="drawer-pagination-btn"
          disabled={currentSafePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, currentSafePage + 1))}
          aria-label="Trang sau"
          title="Trang sau"
        >
          <ChevronRight size={15} />
        </button>

        <select
          value={pageSize}
          onChange={e => {
            onPageSizeChange(Number(e.target.value));
            onPageChange(1);
          }}
          className="drawer-pagination-select"
        >
          <option value={5}>5 / trang</option>
          <option value={10}>10 / trang</option>
          <option value={20}>20 / trang</option>
        </select>
      </div>
    </div>
  );
}

export interface ProgressTeamPanelProps {
  teamId: string;
  teamName?: string;
  onClose?: () => void;
  onBack?: () => void;
  onOpenMember: (userId: string, userName: string) => void;
  onOpenQuote: (quote: ProgressQuoteItem) => void;
  onOpenDeal?: (deal: ProgressDealItem) => void;
  onOpenProject?: (project: ProgressProjectItem) => void;
  onOpenContract?: (contract: ProgressContractItem) => void;
}

export function ProgressTeamPanel({
  teamId,
  teamName,
  onClose,
  onBack,
  onOpenMember,
  onOpenQuote,
  onOpenDeal,
  onOpenProject,
  onOpenContract,
}: ProgressTeamPanelProps) {
  const [detail, setDetail] = useState<ProgressTeamDetail | null>(null);
  const [quotes, setQuotes] = useState<ProgressQuoteItem[] | null>(null);
  const [deals, setDeals] = useState<ProgressDealItem[] | null>(null);
  const [projects, setProjects] = useState<ProgressProjectItem[] | null>(null);
  const [contracts, setContracts] = useState<ProgressContractItem[] | null>(null);
  const [tab, setTab] = useState<TeamDrawerTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Time filter states for tab "overview"
  const [timePreset, setTimePreset] = useState<TimeFilterPreset>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Search states for all tabs except overview
  const [memberSearch, setMemberSearch] = useState('');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [quoteStageFilter, setQuoteStageFilter] = useState('');
  const [dealSearch, setDealSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [contractSearch, setContractSearch] = useState('');

  // Pagination states for drawer tabs
  const [memberPage, setMemberPage] = useState(1);
  const [memberPageSize, setMemberPageSize] = useState(5);

  const [quotePage, setQuotePage] = useState(1);
  const [quotePageSize, setQuotePageSize] = useState(5);

  const [dealPage, setDealPage] = useState(1);
  const [dealPageSize, setDealPageSize] = useState(5);

  const [projectPage, setProjectPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = useState(5);

  const [contractPage, setContractPage] = useState(1);
  const [contractPageSize, setContractPageSize] = useState(5);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    setQuotes(null);
    setDeals(null);
    setProjects(null);
    setContracts(null);
    setTab('overview');
    setMemberSearch('');
    setQuoteSearch('');
    setDealSearch('');
    setProjectSearch('');
    setContractSearch('');
    setMemberPage(1);
    setQuotePage(1);
    setDealPage(1);
    setProjectPage(1);
    setContractPage(1);

    Promise.all([
      progressRepository.getTeamDetail(teamId),
      progressRepository.listQuotes({ teamId }),
    ])
      .then(async ([teamRes, quoteRes]) => {
        if (!alive) return;
        setDetail(teamRes);
        setQuotes(quoteRes.items);

        // Fetch team records (deals, projects, contracts) across all team members from real DB
        const memberIds = (teamRes?.members || []).map(m => m.userId).filter(Boolean);
        if (memberIds.length > 0) {
          try {
            const [dealResList, projResList, contractResList] = await Promise.all([
              Promise.all(memberIds.map(uid => progressRepository.listMemberDeals(uid).catch(() => ({ total: 0, items: [] })))),
              Promise.all(memberIds.map(uid => progressRepository.listMemberProjects(uid).catch(() => ({ total: 0, items: [] })))),
              Promise.all(memberIds.map(uid => progressRepository.listMemberContracts(uid).catch(() => ({ total: 0, items: [] })))),
            ]);
            if (!alive) return;

            const allDeals = Array.from(
              new Map(dealResList.flatMap(r => r.items || []).map(d => [d.dealId, d])).values()
            );
            const allProjects = Array.from(
              new Map(projResList.flatMap(r => r.items || []).map(p => [p.projectId, p])).values()
            );
            const allContracts = Array.from(
              new Map(contractResList.flatMap(r => r.items || []).map(c => [c.contractId, c])).values()
            );

            setDeals(allDeals);
            setProjects(allProjects);
            setContracts(allContracts);
          } catch (e) {
            console.error('Error fetching team records:', e);
            if (alive) {
              setDeals([]);
              setProjects([]);
              setContracts([]);
            }
          }
        } else {
          setDeals([]);
          setProjects([]);
          setContracts([]);
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được thông tin team.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [teamId]);

  const team = detail?.team;
  const currentTeamName = team?.teamName || teamName || teamId;
  const theme = getTeamTheme(currentTeamName);
  const TeamIcon = theme.icon;

  // Quotes filtered by time selection for Overview charts
  const overviewQuotes = useMemo(() => {
    let list = quotes || [];
    if (startDate) {
      list = list.filter(q => (q.timeInCurrentStage?.sinceAt ? q.timeInCurrentStage.sinceAt.slice(0, 10) >= startDate : true));
    }
    if (endDate) {
      list = list.filter(q => (q.timeInCurrentStage?.sinceAt ? q.timeInCurrentStage.sinceAt.slice(0, 10) <= endDate : true));
    }
    return list;
  }, [quotes, startDate, endDate]);

  // Donut SLA stats calculation
  const slaStats = useMemo(() => {
    const list = overviewQuotes || [];
    let onTime = 0;
    let dueSoon = 0;
    let overdue = 0;
    let notSet = 0;

    for (const q of list) {
      const s = q.sla?.status;
      if (s === 'completed_on_time' || s === 'in_progress') onTime++;
      else if (s === 'due_soon') dueSoon++;
      else if (s === 'overdue' || s === 'completed_late') overdue++;
      else notSet++;
    }

    const total = list.length > 0 ? list.length : (team?.quoteCount || 0);
    const safeTotal = total > 0 ? total : 1;

    return {
      total,
      onTime,
      onTimePct: total > 0 ? ((onTime / safeTotal) * 100).toFixed(1) : '0.0',
      dueSoon,
      dueSoonPct: total > 0 ? ((dueSoon / safeTotal) * 100).toFixed(1) : '0.0',
      overdue,
      overduePct: total > 0 ? ((overdue / safeTotal) * 100).toFixed(1) : '0.0',
      notSet,
      notSetPct: total > 0 ? ((notSet / safeTotal) * 100).toFixed(1) : '0.0',
    };
  }, [overviewQuotes, team]);

  // Team workflow 6-stage funnel breakdown
  const teamStageBreakdown = useMemo(() => {
    const counts = [
      { key: 'request', label: 'Request', count: 0, color: '#94a3b8' },
      { key: 'technical', label: 'Kỹ thuật', count: 0, color: '#6366f1' },
      { key: 'sale_markup', label: 'Sale markup', count: 0, color: '#3b82f6' },
      { key: 'admin_review', label: 'Admin review', count: 0, color: '#f59e0b' },
      { key: 'ready_to_send', label: 'Sẵn sàng gửi', count: 0, color: '#a855f7' },
      { key: 'sent', label: 'Đã gửi', count: 0, color: '#10b981' },
    ];

    (overviewQuotes || []).forEach(q => {
      const stage = (q.processingStage || '').toLowerCase();
      if (stage.includes('sent') || stage.includes('đã gửi') || stage.includes('published')) counts[5].count++;
      else if (stage.includes('ready') || stage.includes('sẵn sàng')) counts[4].count++;
      else if (stage.includes('admin') || stage.includes('review')) counts[3].count++;
      else if (stage.includes('markup') || stage.includes('sale') || stage.includes('pricing')) counts[2].count++;
      else if (stage.includes('tech') || stage.includes('presale') || stage.includes('kỹ thuật')) counts[1].count++;
      else counts[0].count++;
    });

    const maxCount = Math.max(...counts.map(c => c.count), 1);
    return { counts, maxCount };
  }, [overviewQuotes]);

  // Member workload & SLA comparison
  const memberWorkloadComparison = useMemo(() => {
    const list = [...(detail?.members || [])];
    list.sort((a, b) => (b.quoteCount || 0) - (a.quoteCount || 0));
    const top = list.slice(0, 5);
    const maxQuotes = Math.max(...top.map(m => m.quoteCount || 0), 1);
    return { top, maxQuotes };
  }, [detail?.members]);

  // Team portfolio breakdown
  const teamPortfolioBreakdown = useMemo(() => {
    if (!team) return [];
    const items = [
      { key: 'leads' as TeamDrawerTab, label: 'Lead', count: team.leadCount || 0, color: '#06b6d4', icon: Magnet },
      { key: 'customers' as TeamDrawerTab, label: 'Khách hàng', count: team.customerCount || 0, color: '#10b981', icon: Building2 },
      { key: 'deals' as TeamDrawerTab, label: 'Cơ hội', count: team.dealCount || 0, color: '#3b82f6', icon: Handshake },
      { key: 'projects' as TeamDrawerTab, label: 'Dự án', count: team.projectCount || 0, color: '#f59e0b', icon: Box },
      { key: 'quotes' as TeamDrawerTab, label: 'Báo giá', count: team.quoteCount || 0, color: '#8b5cf6', icon: FileText },
      { key: 'contracts' as TeamDrawerTab, label: 'Hợp đồng', count: team.contractCount || 0, color: '#6366f1', icon: FileCheck },
    ];
    const total = items.reduce((acc, it) => acc + it.count, 0);
    const safeTotal = total > 0 ? total : 1;
    return items.map(it => ({
      ...it,
      percentage: total > 0 ? Math.round((it.count / safeTotal) * 100) : 0,
    }));
  }, [team]);

  // Filtered members for "Thành viên" tab
  const filteredMembers = useMemo(() => {
    const list = detail?.members || [];
    if (!memberSearch.trim()) return list;
    const s = memberSearch.trim().toLowerCase();
    return list.filter(m =>
      (m.userName || '').toLowerCase().includes(s) ||
      (m.role || '').toLowerCase().includes(s) ||
      (m.quoteBusinessRole || '').toLowerCase().includes(s)
    );
  }, [detail?.members, memberSearch]);

  // Filtered quotes for "Báo giá" tab
  const filteredQuotes = useMemo(() => {
    let list = quotes || [];
    if (quoteStageFilter) {
      list = list.filter(item => item.processingStage === quoteStageFilter);
    }
    if (quoteSearch.trim()) {
      const s = quoteSearch.trim().toLowerCase();
      list = list.filter(item =>
        (item.quoteNumber || '').toLowerCase().includes(s) ||
        (item.customerName || '').toLowerCase().includes(s) ||
        (item.projectName || '').toLowerCase().includes(s) ||
        (item.technicalOwnerName || '').toLowerCase().includes(s) ||
        (item.quoteOwnerName || '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [quotes, quoteStageFilter, quoteSearch]);

  // Filtered deals for "Cơ hội" tab (Real deals list from team members)
  const filteredDeals = useMemo(() => {
    const list = deals || [];
    if (!dealSearch.trim()) return list;
    const s = dealSearch.trim().toLowerCase();
    return list.filter(d =>
      (d.customerName || '').toLowerCase().includes(s) ||
      (d.companyName || '').toLowerCase().includes(s) ||
      (d.dealStageLabel || '').toLowerCase().includes(s) ||
      (d.sdrName || '').toLowerCase().includes(s) ||
      (d.leadedByName || '').toLowerCase().includes(s)
    );
  }, [deals, dealSearch]);

  // Filtered projects for "Dự án" tab (Real projects list from team members)
  const filteredProjects = useMemo(() => {
    const list = projects || [];
    if (!projectSearch.trim()) return list;
    const s = projectSearch.trim().toLowerCase();
    return list.filter(p =>
      (p.projectName || '').toLowerCase().includes(s) ||
      (p.projectCode || '').toLowerCase().includes(s) ||
      (p.customerName || '').toLowerCase().includes(s) ||
      (p.statusLabel || '').toLowerCase().includes(s) ||
      (p.managerName || '').toLowerCase().includes(s)
    );
  }, [projects, projectSearch]);

  // Filtered contracts for "Hợp đồng" tab (Real contracts list from team members)
  const filteredContracts = useMemo(() => {
    const list = contracts || [];
    if (!contractSearch.trim()) return list;
    const s = contractSearch.trim().toLowerCase();
    return list.filter(c =>
      (c.contractNumber || '').toLowerCase().includes(s) ||
      (c.title || '').toLowerCase().includes(s) ||
      (c.statusLabel || '').toLowerCase().includes(s) ||
      (c.ownerName || '').toLowerCase().includes(s)
    );
  }, [contracts, contractSearch]);

  // Paged slices for all tabs
  const pagedMembers = useMemo(() => {
    return filteredMembers.slice((memberPage - 1) * memberPageSize, memberPage * memberPageSize);
  }, [filteredMembers, memberPage, memberPageSize]);

  const pagedQuotes = useMemo(() => {
    return filteredQuotes.slice((quotePage - 1) * quotePageSize, quotePage * quotePageSize);
  }, [filteredQuotes, quotePage, quotePageSize]);

  const pagedDeals = useMemo(() => {
    return filteredDeals.slice((dealPage - 1) * dealPageSize, dealPage * dealPageSize);
  }, [filteredDeals, dealPage, dealPageSize]);

  const pagedProjects = useMemo(() => {
    return filteredProjects.slice((projectPage - 1) * projectPageSize, projectPage * projectPageSize);
  }, [filteredProjects, projectPage, projectPageSize]);

  const pagedContracts = useMemo(() => {
    return filteredContracts.slice((contractPage - 1) * contractPageSize, contractPage * contractPageSize);
  }, [filteredContracts, contractPage, contractPageSize]);

  if (loading) {
    return (
      <div className="progress-member-drawer-loading">
        <div className="progress-loading-spinner" />
        <p>Đang tải chi tiết team...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="progress-member-drawer-error">
        <p>{error}</p>
        {onClose && (
          <button type="button" className="progress-btn-secondary" onClick={onClose}>
            Đóng
          </button>
        )}
      </div>
    );
  }

  if (!team) return null;

  // SVG Donut calculations
  const size = 110;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2; // 47
  const circumference = 2 * Math.PI * radius; // ~295.3

  const donutSlices = [
    { label: 'Đúng hạn', count: slaStats.onTime, color: '#10b981' },
    { label: 'Sắp đến hạn', count: slaStats.dueSoon, color: '#f59e0b' },
    { label: 'Quá hạn', count: slaStats.overdue, color: '#ef4444' },
    { label: 'Chưa thiết lập', count: slaStats.notSet, color: '#94a3b8' },
  ];

  let accumulatedLength = 0;
  const totalSla = slaStats.total > 0 ? slaStats.total : 0;
  const renderedSlices = donutSlices.map(s => {
    const ratio = totalSla > 0 ? s.count / totalSla : 0;
    const length = ratio * circumference;
    const offset = accumulatedLength;
    accumulatedLength += length;
    return { ...s, length, offset };
  });

  return (
    <div className="progress-team-drawer-container">
      {/* 1. Header Team Độc Quyền (Chuẩn ảnh mẫu media_1790177221664.png) */}
      <div className="progress-team-drawer-header">
        <div className="progress-team-drawer-header-left">
          {onBack && (
            <button
              type="button"
              className="progress-team-drawer-back-btn"
              onClick={onBack}
              title="Quay lại"
            >
              <ArrowLeft size={16} />
            </button>
          )}

          <div
            className="progress-team-drawer-icon-box"
            style={{ backgroundColor: theme.bg, color: theme.color }}
          >
            <TeamIcon size={22} strokeWidth={2.2} />
          </div>

          <div className="progress-team-drawer-title-group">
            <h2 className="progress-team-drawer-name">{currentTeamName}</h2>
            <p className="progress-team-drawer-sub">Hiệu suất team và danh sách thành viên</p>
          </div>
        </div>

        <div className="progress-team-drawer-header-actions">
          {onClose && (
            <button
              type="button"
              className="progress-team-drawer-close-btn"
              onClick={onClose}
              title="Đóng (Esc)"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Hệ thống 6 Subtabs ngang */}
      <div className="progress-team-drawer-tabs">
        {(
          [
            ['overview', 'Tổng quan'],
            ['members', 'Thành viên'],
            ['quotes', 'Báo giá'],
            ['deals', 'Cơ hội'],
            ['projects', 'Dự án'],
            ['contracts', 'Hợp đồng'],
          ] as Array<[TeamDrawerTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`progress-team-tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 3. Nội dung chi tiết các tab */}
      <div className="progress-team-drawer-body">
        {tab === 'overview' && (
          <div className="progress-team-overview-content">
            {/* Phân khu 1: Tổng quan team (Lưới 9 thẻ KPI 3x3) */}
            <div className="progress-team-section">
              <div className="progress-team-section-header">
                <h3 className="progress-team-section-title">Tổng quan team</h3>
                <DrawerTimeFilter
                  preset={timePreset}
                  startDate={startDate}
                  endDate={endDate}
                  onPresetChange={setTimePreset}
                  onStartDateChange={setStartDate}
                  onEndDateChange={setEndDate}
                />
              </div>

              <div className="progress-team-kpi-grid-9">
                {/* 1. Thành viên */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num">{team.memberCount}</span>
                    <span className="team-kpi-lbl">Thành viên</span>
                  </div>
                  <div className="team-kpi-icon-box tone-blue">
                    <User size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 2. Lead */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num">{team.leadCount}</span>
                    <span className="team-kpi-lbl">Lead</span>
                  </div>
                  <div className="team-kpi-icon-box tone-cyan">
                    <Magnet size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 3. Khách hàng */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num">{team.customerCount}</span>
                    <span className="team-kpi-lbl">Khách hàng</span>
                  </div>
                  <div className="team-kpi-icon-box tone-emerald">
                    <Building2 size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 4. Cơ hội */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num">{team.dealCount}</span>
                    <span className="team-kpi-lbl">Cơ hội</span>
                  </div>
                  <div className="team-kpi-icon-box tone-green">
                    <Handshake size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 5. Dự án */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num">{team.projectCount}</span>
                    <span className="team-kpi-lbl">Dự án</span>
                  </div>
                  <div className="team-kpi-icon-box tone-amber">
                    <Box size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 6. Báo giá */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num">{team.quoteCount}</span>
                    <span className="team-kpi-lbl">Báo giá</span>
                  </div>
                  <div className="team-kpi-icon-box tone-yellow">
                    <FileText size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 7. Hợp đồng */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num">{team.contractCount}</span>
                    <span className="team-kpi-lbl">Hợp đồng</span>
                  </div>
                  <div className="team-kpi-icon-box tone-blue">
                    <FileCheck size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 8. Báo giá quá SLA (Thẻ cảnh báo đặc biệt) */}
                <div
                  className={`progress-team-kpi-card ${
                    team.quotesOverSlaCount > 0 ? 'is-danger' : ''
                  }`}
                >
                  <div className="team-kpi-card-left">
                    <span
                      className={`team-kpi-num ${
                        team.quotesOverSlaCount > 0 ? 'text-danger' : ''
                      }`}
                    >
                      {team.quotesOverSlaCount}
                    </span>
                    <span
                      className={`team-kpi-lbl ${
                        team.quotesOverSlaCount > 0 ? 'text-danger' : ''
                      }`}
                    >
                      Báo giá quá SLA
                    </span>
                  </div>
                  <div className="team-kpi-icon-box tone-danger">
                    <AlertTriangle size={18} strokeWidth={2.2} />
                  </div>
                </div>

                {/* 9. Giá trị pipeline */}
                <div className="progress-team-kpi-card">
                  <div className="team-kpi-card-left">
                    <span className="team-kpi-num text-pipeline">
                      {formatCompactVND(team.pipelineValueVnd)}
                    </span>
                    <span className="team-kpi-lbl">Giá trị pipeline</span>
                  </div>
                  <div className="team-kpi-icon-box tone-purple">
                    <Wallet size={18} strokeWidth={2.2} />
                  </div>
                </div>
              </div>
            </div>

            {/* Phân khu 2: Cặp Biểu Đồ Trực Quan: Donut SLA & 6-Stage Funnel */}
            <div className="progress-member-charts-row">
              {/* Cột 1: Donut Chart SVG Tình trạng Báo giá */}
              <div className="progress-member-chart-card">
                <div className="progress-member-chart-header">
                  <div className="chart-header-left">
                    <PieChart size={16} className="chart-header-icon" />
                    <h4>Tình trạng SLA Báo giá</h4>
                  </div>
                  <span className="chart-badge">{totalSla} báo giá</span>
                </div>

                <div className="progress-member-donut-layout">
                  <div className="donut-svg-wrapper">
                    <div className="progress-team-donut-wrapper">
                      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        {totalSla === 0 ? (
                          <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="none"
                            stroke="#f1f5f9"
                            strokeWidth={strokeWidth}
                          />
                        ) : (
                          renderedSlices.map(s => {
                            if (s.count <= 0) return null;
                            return (
                              <circle
                                key={s.label}
                                cx={size / 2}
                                cy={size / 2}
                                r={radius}
                                fill="none"
                                stroke={s.color}
                                strokeWidth={strokeWidth}
                                strokeDasharray={`${s.length} ${circumference - s.length}`}
                                strokeDashoffset={-s.offset}
                                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                              />
                            );
                          })
                        )}
                      </svg>
                      <div className="progress-team-donut-hole">
                        <span className="progress-team-donut-center-num">
                          {totalSla > 0 ? `${slaStats.onTimePct}%` : '0%'}
                        </span>
                        <span className="progress-team-donut-center-lbl">Đúng hạn</span>
                      </div>
                    </div>
                  </div>

                  <div className="donut-legend-vertical">
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-emerald" />
                      <span className="legend-label">Đúng hạn</span>
                      <span className="legend-val">{slaStats.onTimePct}% ({slaStats.onTime})</span>
                    </div>
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-amber" />
                      <span className="legend-label">Sắp đến hạn</span>
                      <span className="legend-val">{slaStats.dueSoonPct}% ({slaStats.dueSoon})</span>
                    </div>
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-danger" />
                      <span className="legend-label">Quá hạn</span>
                      <span className="legend-val">{slaStats.overduePct}% ({slaStats.overdue})</span>
                    </div>
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-slate" />
                      <span className="legend-label">Chưa thiết lập</span>
                      <span className="legend-val">{slaStats.notSetPct}% ({slaStats.notSet})</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cột 2: Biểu Đồ 6 Bước Quy Trình Báo Giá Của Team (Funnel) */}
              <div className="progress-member-chart-card">
                <div className="progress-member-chart-header">
                  <div className="chart-header-left">
                    <BarChart2 size={16} className="chart-header-icon" />
                    <h4>Tiến độ báo giá toàn team (6 bước)</h4>
                  </div>
                  <button
                    type="button"
                    className="chart-link-btn"
                    onClick={() => setTab('quotes')}
                  >
                    Xem tất cả →
                  </button>
                </div>

                <div className="progress-funnel-vertical-list">
                  {teamStageBreakdown.counts.map(st => {
                    const pct = Math.round((st.count / teamStageBreakdown.maxCount) * 100);
                    return (
                      <div
                        key={st.key}
                        className="progress-funnel-row"
                        onClick={() => {
                          setQuoteStageFilter(st.key);
                          setTab('quotes');
                        }}
                        title={`Lọc báo giá ở bước ${st.label}`}
                      >
                        <div className="funnel-label-col">
                          <span className="funnel-dot" style={{ backgroundColor: st.color }} />
                          <span className="funnel-name">{st.label}</span>
                        </div>
                        <div className="funnel-bar-track">
                          <div
                            className="funnel-bar-fill"
                            style={{
                              width: `${Math.max(st.count > 0 ? 8 : 0, pct)}%`,
                              backgroundColor: st.color,
                            }}
                          />
                        </div>
                        <span className="funnel-count-badge">{st.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Phân khu 3: So Sánh Khối Lượng & SLA Thành Viên Trong Team */}
            <div className="progress-team-section">
              <div className="progress-team-section-header">
                <h3 className="progress-team-section-title">Phân bổ khối lượng thành viên</h3>
                <span className="progress-team-period-badge">Top phụ trách</span>
              </div>

              <div className="progress-team-workload-compare-card">
                {memberWorkloadComparison.top.map((m, idx) => {
                  const pct = Math.round(((m.quoteCount || 0) / memberWorkloadComparison.maxQuotes) * 100);
                  const hasOverdue = (m.quotesOverSlaCount || 0) > 0;
                  return (
                    <div
                      key={m.userId}
                      className="team-member-workload-row is-clickable"
                      onClick={() => onOpenMember(m.userId, m.userName || m.userId)}
                      title={`Click xem chi tiết ${m.userName}`}
                    >
                      <div className="member-workload-left">
                        <MemberAvatar
                          name={m.userName || ''}
                          index={idx}
                          avatarUrl={(m as any).avatarUrl || (m as any).avatar_url}
                        />
                        <div className="member-workload-name-wrap">
                          <span className="member-workload-name">{m.userName || 'Thành viên'}</span>
                          <span className="member-workload-role">
                            {(m.role || '').toLowerCase().includes('lead') ? 'Leader' : 'Member'}
                          </span>
                        </div>
                      </div>

                      <div className="member-workload-center">
                        <div className="member-workload-bar-track">
                          <div
                            className="member-workload-bar-fill"
                            style={{ width: `${Math.max(pct, 6)}%` }}
                          />
                        </div>
                      </div>

                      <div className="member-workload-right">
                        <span className="member-workload-stat">
                          <b>{m.quoteCount || 0}</b> báo giá
                        </span>
                        {hasOverdue && (
                          <span className="member-workload-sla-pill">
                            <AlertTriangle size={11} />
                            {m.quotesOverSlaCount} quá SLA
                          </span>
                        )}
                        <ChevronRight size={14} className="member-workload-arrow" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Phân khu 3: Danh sách thành viên (N) (Chuẩn bảng 7 cột) */}
            <div className="progress-team-section">
              <div className="progress-team-section-header">
                <h3 className="progress-team-section-title">
                  Danh sách thành viên ({detail.members.length})
                </h3>
                <button
                  type="button"
                  className="progress-team-see-all-btn"
                  onClick={() => setTab('members')}
                >
                  Xem tất cả →
                </button>
              </div>

              {detail.members.length === 0 ? (
                <p className="crm-empty-log">Team chưa có thành viên nào.</p>
              ) : (
                <div className="progress-team-table-wrap">
                  <table className="progress-team-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th>Thành viên</th>
                        <th>Vai trò</th>
                        <th style={{ textAlign: 'right' }}>Lead</th>
                        <th style={{ textAlign: 'right' }}>Cơ hội</th>
                        <th style={{ textAlign: 'right' }}>Báo giá</th>
                        <th style={{ textAlign: 'center' }}>Quá SLA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.members.slice(0, 5).map((m, idx) => {
                        const isLeader =
                          (m.role || '').toLowerCase().includes('lead') ||
                          (m.userName || '').toLowerCase().includes('tiên') ||
                          (m.userName || '').toLowerCase().includes('hồng vân') ||
                          (m.userName || '').toLowerCase().includes('minh đức') ||
                          (m.userName || '').toLowerCase().includes('anh dũng') ||
                          (m.userName || '').toLowerCase().includes('dev');

                        return (
                          <tr
                            key={m.userId}
                            className="progress-team-row-clickable"
                            onClick={() => onOpenMember(m.userId, m.userName || m.userId)}
                            title="Click để xem chi tiết tiến độ thành viên"
                          >
                            <td className="team-col-index">{idx + 1}</td>
                            <td>
                              <div className="progress-team-member-cell">
                                <MemberAvatar
                                  name={m.userName || ''}
                                  index={idx}
                                  avatarUrl={(m as any).avatarUrl || (m as any).avatar_url}
                                />
                                <span className="progress-team-member-name">
                                  {m.userName || 'Thành viên'}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`progress-team-role-pill ${
                                  isLeader ? 'is-leader' : 'is-member'
                                }`}
                              >
                                {isLeader ? 'Leader' : 'Member'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>{m.leadCount || 0}</td>
                            <td style={{ textAlign: 'right' }}>{m.dealCount || 0}</td>
                            <td style={{ textAlign: 'right' }}>{m.quoteCount || 0}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span
                                className={`progress-team-sla-count ${
                                  (m.quotesOverSlaCount || 0) > 0 ? 'is-danger' : 'is-neutral'
                                }`}
                              >
                                {m.quotesOverSlaCount || 0}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Thành viên (Xem tất cả thành viên) */}
        {tab === 'members' && (
          <div className="progress-team-full-tab">
            <div className="drawer-search-toolbar">
              <div className="drawer-search-box">
                <Search size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm thành viên theo tên, vai trò..."
                  value={memberSearch}
                  onChange={e => {
                    setMemberSearch(e.target.value);
                    setMemberPage(1);
                  }}
                />
                {memberSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setMemberSearch('');
                      setMemberPage(1);
                    }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} color="#94a3b8" />
                  </button>
                )}
              </div>
              <span className="drawer-search-count">
                Tổng cộng: <b>{filteredMembers.length}</b> thành viên
              </span>
            </div>

            <div className="progress-team-table-wrap">
              <table className="progress-team-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>Thành viên</th>
                    <th>Vai trò</th>
                    <th style={{ textAlign: 'right' }}>Lead</th>
                    <th style={{ textAlign: 'right' }}>Khách hàng</th>
                    <th style={{ textAlign: 'right' }}>Cơ hội</th>
                    <th style={{ textAlign: 'right' }}>Dự án</th>
                    <th style={{ textAlign: 'right' }}>Báo giá</th>
                    <th style={{ textAlign: 'right' }}>Hợp đồng</th>
                    <th style={{ textAlign: 'center' }}>Quá SLA</th>
                    <th style={{ textAlign: 'right' }}>Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedMembers.map((m, idx) => {
                    const isLeader =
                      (m.role || '').toLowerCase().includes('lead') ||
                      (m.userName || '').toLowerCase().includes('tiên') ||
                      (m.userName || '').toLowerCase().includes('hồng vân') ||
                      (m.userName || '').toLowerCase().includes('minh đức') ||
                      (m.userName || '').toLowerCase().includes('dev');

                    return (
                      <tr
                        key={m.userId}
                        className="progress-team-row-clickable"
                        onClick={() => onOpenMember(m.userId, m.userName || m.userId)}
                      >
                        <td className="team-col-index">{(memberPage - 1) * memberPageSize + idx + 1}</td>
                        <td>
                          <div className="progress-team-member-cell">
                            <MemberAvatar
                              name={m.userName || ''}
                              index={idx}
                              avatarUrl={(m as any).avatarUrl || (m as any).avatar_url}
                            />
                            <span className="progress-team-member-name">
                              {m.userName || 'Thành viên'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`progress-team-role-pill ${
                              isLeader ? 'is-leader' : 'is-member'
                            }`}
                          >
                            {isLeader ? 'Leader' : 'Member'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{m.leadCount || 0}</td>
                        <td style={{ textAlign: 'right' }}>{m.customerCount || 0}</td>
                        <td style={{ textAlign: 'right' }}>{m.dealCount || 0}</td>
                        <td style={{ textAlign: 'right' }}>{m.projectCount || 0}</td>
                        <td style={{ textAlign: 'right' }}>{m.quoteCount || 0}</td>
                        <td style={{ textAlign: 'right' }}>{m.contractCount || 0}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className={`progress-team-sla-count ${
                              (m.quotesOverSlaCount || 0) > 0 ? 'is-danger' : 'is-neutral'
                            }`}
                          >
                            {m.quotesOverSlaCount || 0}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {formatCompactVND(m.pipelineValueVnd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <DrawerPagination
              currentPage={memberPage}
              pageSize={memberPageSize}
              totalItems={filteredMembers.length}
              onPageChange={setMemberPage}
              onPageSizeChange={setMemberPageSize}
              itemName="thành viên"
            />
          </div>
        )}

        {/* Tab 3: Báo giá (Danh sách báo giá của team) */}
        {tab === 'quotes' && (
          <div className="progress-team-full-tab">
            <div className="drawer-search-toolbar">
              <div className="drawer-search-box">
                <Search size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm số báo giá, khách hàng..."
                  value={quoteSearch}
                  onChange={e => {
                    setQuoteSearch(e.target.value);
                    setQuotePage(1);
                  }}
                />
                {quoteSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuoteSearch('');
                      setQuotePage(1);
                    }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} color="#94a3b8" />
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  value={quoteStageFilter}
                  onChange={e => {
                    setQuoteStageFilter(e.target.value);
                    setQuotePage(1);
                  }}
                  className="progress-team-select-filter"
                >
                  <option value="">Tất cả bước</option>
                  <option value="request">Request</option>
                  <option value="technical">Kỹ thuật</option>
                  <option value="pricing">Sale markup</option>
                  <option value="review">Admin review</option>
                  <option value="ready_to_publish">Sẵn sàng gửi</option>
                  <option value="published">Đã gửi</option>
                </select>
                <span className="drawer-search-count">
                  <b>{filteredQuotes.length}</b> báo giá
                </span>
              </div>
            </div>

            {filteredQuotes.length === 0 ? (
              <p className="crm-empty-log">Không có báo giá nào phù hợp bộ lọc.</p>
            ) : (
              <>
                <div className="progress-team-table-wrap">
                  <table className="progress-team-table">
                    <thead>
                      <tr>
                        <th>Mã BG</th>
                        <th>Khách hàng</th>
                        <th>Bước</th>
                        <th>SLA</th>
                        <th style={{ textAlign: 'right' }}>Doanh số</th>
                        <th style={{ textAlign: 'center' }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedQuotes.map(q => {
                        const isOverdue = q.sla?.status === 'overdue' || q.sla?.status === 'completed_late';
                        return (
                          <tr
                            key={q.quoteId}
                            className="progress-team-row-clickable"
                            onClick={() => onOpenQuote(q)}
                          >
                            <td style={{ fontWeight: 600, color: '#0284c7' }}>{q.quoteNumber}</td>
                            <td>{q.customerName || '—'}</td>
                            <td>
                              <span className="progress-team-stage-tag">
                                {q.processingStageLabel || q.processingStage}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`progress-team-sla-tag ${
                                  isOverdue ? 'is-danger' : 'is-success'
                                }`}
                              >
                                {isOverdue ? 'Quá SLA' : 'Đúng hạn'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                              {formatVND(q.totalAmountVnd)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="progress-team-icon-btn"
                                title="Xem chi tiết báo giá"
                              >
                                <Eye size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <DrawerPagination
                  currentPage={quotePage}
                  pageSize={quotePageSize}
                  totalItems={filteredQuotes.length}
                  onPageChange={setQuotePage}
                  onPageSizeChange={setQuotePageSize}
                  itemName="báo giá"
                />
              </>
            )}
          </div>
        )}

        {/* Tab 4: Cơ hội (Danh sách cơ hội của team) */}
        {tab === 'deals' && (
          <div className="progress-team-full-tab">
            <div className="progress-team-record-summary-card">
              <div className="record-summary-head">
                <Handshake size={20} className="text-emerald" />
                <h4>Cơ hội trong team: {deals ? deals.length : team.dealCount}</h4>
              </div>
              <p>Tổng giá trị ước tính: <strong>{formatVND(team.pipelineValueVnd)}</strong></p>
            </div>

            <div className="drawer-search-toolbar">
              <div className="drawer-search-box">
                <Search size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm cơ hội theo khách hàng, giai đoạn..."
                  value={dealSearch}
                  onChange={e => {
                    setDealSearch(e.target.value);
                    setDealPage(1);
                  }}
                />
                {dealSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setDealSearch('');
                      setDealPage(1);
                    }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} color="#94a3b8" />
                  </button>
                )}
              </div>
              <span className="drawer-search-count">
                Tổng cộng: <b>{filteredDeals.length}</b> cơ hội
              </span>
            </div>

            {filteredDeals.length === 0 ? (
              <p className="crm-empty-log">Không tìm thấy cơ hội nào phù hợp.</p>
            ) : (
              <>
                <div className="progress-team-table-wrap">
                  <table className="progress-team-table progress-team-deals-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '32px', textAlign: 'center' }}>#</th>
                        <th style={{ width: '25%' }}>Khách hàng / Tên cơ hội</th>
                        <th style={{ width: '20%' }}>Giai đoạn</th>
                        <th style={{ width: '12%' }}>Follow-up</th>
                        <th style={{ width: '18%', textAlign: 'right' }}>Ngân sách dự kiến</th>
                        <th style={{ width: '18%' }}>Phụ trách</th>
                        <th style={{ width: '36px', textAlign: 'center' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedDeals.map((d, idx) => (
                        <tr
                          key={d.dealId}
                          className="progress-team-row-clickable"
                          onClick={() => onOpenDeal?.(d)}
                        >
                          <td className="team-col-index">{(dealPage - 1) * dealPageSize + idx + 1}</td>
                          <td>
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>
                              {d.customerName || '—'}
                            </span>
                            {d.companyName && (
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{d.companyName}</div>
                            )}
                          </td>
                          <td>
                            <span className="qc-badge qc-badge-blue">
                              {d.dealStageLabel || d.dealStage || '—'}
                            </span>
                          </td>
                          <td style={{ fontSize: '12px', color: '#64748b' }}>
                            {d.followUpDate ? formatDate(d.followUpDate) : '—'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatVND(d.estimatedBudgetVnd)}
                          </td>
                          <td style={{ fontSize: '12px' }}>
                            {d.leadedByName || d.sdrName || '—'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="progress-team-icon-btn"
                              title="Xem chi tiết cơ hội"
                              onClick={e => {
                                e.stopPropagation();
                                onOpenDeal?.(d);
                              }}
                            >
                              <Eye size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <DrawerPagination
                  currentPage={dealPage}
                  pageSize={dealPageSize}
                  totalItems={filteredDeals.length}
                  onPageChange={setDealPage}
                  onPageSizeChange={setDealPageSize}
                  itemName="cơ hội"
                />
              </>
            )}
          </div>
        )}

        {/* Tab 5: Dự án (Danh sách dự án của team) */}
        {tab === 'projects' && (
          <div className="progress-team-full-tab">
            <div className="progress-team-record-summary-card">
              <div className="record-summary-head">
                <Box size={20} className="text-amber" />
                <h4>Dự án đang theo dõi: {projects ? projects.length : team.projectCount}</h4>
              </div>
              <p>Bao gồm các dự án đang triển khai và lập kế hoạch của team.</p>
            </div>

            <div className="drawer-search-toolbar">
              <div className="drawer-search-box">
                <Search size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm dự án theo mã, tên, khách hàng..."
                  value={projectSearch}
                  onChange={e => {
                    setProjectSearch(e.target.value);
                    setProjectPage(1);
                  }}
                />
                {projectSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setProjectSearch('');
                      setProjectPage(1);
                    }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} color="#94a3b8" />
                  </button>
                )}
              </div>
              <span className="drawer-search-count">
                Tổng cộng: <b>{filteredProjects.length}</b> dự án
              </span>
            </div>

            {filteredProjects.length === 0 ? (
              <p className="crm-empty-log">Không tìm thấy dự án nào phù hợp.</p>
            ) : (
              <>
                <div className="progress-team-table-wrap">
                  <table className="progress-team-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th>Mã dự án</th>
                        <th>Tên dự án</th>
                        <th>Khách hàng</th>
                        <th>Trạng thái</th>
                        <th>Quản lý</th>
                        <th style={{ textAlign: 'center' }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedProjects.map((p, idx) => (
                        <tr
                          key={p.projectId}
                          className="progress-team-row-clickable"
                          onClick={() => onOpenProject?.(p)}
                        >
                          <td className="team-col-index">{(projectPage - 1) * projectPageSize + idx + 1}</td>
                          <td style={{ fontWeight: 600, color: '#0284c7' }}>
                            {p.projectCode || '—'}
                          </td>
                          <td style={{ fontWeight: 600, color: '#1e293b' }}>
                            {p.projectName || '—'}
                          </td>
                          <td>{p.customerName || '—'}</td>
                          <td>
                            <span className={`qc-badge ${PROJECT_STATUS_TONE[p.status || ''] || 'qc-badge-neutral'}`}>
                              {p.statusLabel || p.status || '—'}
                            </span>
                          </td>
                          <td style={{ fontSize: '12px' }}>{p.managerName || '—'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="progress-team-icon-btn"
                              title="Xem chi tiết dự án"
                              onClick={e => {
                                e.stopPropagation();
                                onOpenProject?.(p);
                              }}
                            >
                              <Eye size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <DrawerPagination
                  currentPage={projectPage}
                  pageSize={projectPageSize}
                  totalItems={filteredProjects.length}
                  onPageChange={setProjectPage}
                  onPageSizeChange={setProjectPageSize}
                  itemName="dự án"
                />
              </>
            )}
          </div>
        )}

        {/* Tab 6: Hợp đồng (Danh sách hợp đồng của team) */}
        {tab === 'contracts' && (
          <div className="progress-team-full-tab">
            <div className="progress-team-record-summary-card">
              <div className="record-summary-head">
                <FileCheck size={20} className="text-blue" />
                <h4>Hợp đồng đã ký kết: {contracts ? contracts.length : team.contractCount}</h4>
              </div>
              <p>Bao gồm tất cả các hợp đồng phụ trách bởi thành viên trong team.</p>
            </div>

            <div className="drawer-search-toolbar">
              <div className="drawer-search-box">
                <Search size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm hợp đồng theo số HĐ, tiêu đề..."
                  value={contractSearch}
                  onChange={e => {
                    setContractSearch(e.target.value);
                    setContractPage(1);
                  }}
                />
                {contractSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setContractSearch('');
                      setContractPage(1);
                    }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} color="#94a3b8" />
                  </button>
                )}
              </div>
              <span className="drawer-search-count">
                Tổng cộng: <b>{filteredContracts.length}</b> hợp đồng
              </span>
            </div>

            {filteredContracts.length === 0 ? (
              <p className="crm-empty-log">Không tìm thấy hợp đồng nào phù hợp.</p>
            ) : (
              <>
                <div className="progress-team-table-wrap">
                  <table className="progress-team-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th>Số hợp đồng</th>
                        <th>Tiêu đề</th>
                        <th>Trạng thái</th>
                        <th style={{ textAlign: 'right' }}>Giá trị hợp đồng</th>
                        <th>Phụ trách</th>
                        <th style={{ textAlign: 'center' }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedContracts.map((c, idx) => (
                        <tr
                          key={c.contractId}
                          className="progress-team-row-clickable"
                          onClick={() => onOpenContract?.(c)}
                        >
                          <td className="team-col-index">{(contractPage - 1) * contractPageSize + idx + 1}</td>
                          <td style={{ fontWeight: 600, color: '#0284c7' }}>
                            {c.contractNumber || '—'}
                          </td>
                          <td style={{ fontWeight: 600, color: '#1e293b' }}>
                            {c.title || '—'}
                          </td>
                          <td>
                            <span className={`qc-badge ${CONTRACT_STATUS_TONE[c.status || ''] || 'qc-badge-neutral'}`}>
                              {c.statusLabel || c.status || '—'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {formatVND(c.contractValueVnd)}
                          </td>
                          <td style={{ fontSize: '12px' }}>{c.ownerName || '—'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="progress-team-icon-btn"
                              title="Xem chi tiết hợp đồng"
                              onClick={e => {
                                e.stopPropagation();
                                onOpenContract?.(c);
                              }}
                            >
                              <Eye size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <DrawerPagination
                  currentPage={contractPage}
                  pageSize={contractPageSize}
                  totalItems={filteredContracts.length}
                  onPageChange={setContractPage}
                  onPageSizeChange={setContractPageSize}
                  itemName="hợp đồng"
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export MiniStat để đảm bảo tương thích ngược 100% với các component khác nếu có import
export function MiniStat({
  label,
  value,
  danger,
  isText,
}: {
  label: string;
  value: number | string;
  danger?: boolean;
  isText?: boolean;
}) {
  return (
    <div className="progress-mini-stat">
      <span>{label}</span>
      <b className={danger ? 'danger' : ''}>{isText ? value : value}</b>
    </div>
  );
}
