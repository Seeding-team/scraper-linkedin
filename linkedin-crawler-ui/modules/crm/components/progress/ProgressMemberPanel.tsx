'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  X,
  ArrowLeft,
  Check,
  CheckCircle2,
  AlertTriangle,
  FileText,
  File,
  Search,
  Eye,
  ChevronRight,
  Clock,
  Wallet,
  Building2,
  Handshake,
  Box,
  FileCheck,
  Magnet,
  PieChart,
  BarChart2,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { seedingQuoteRepository, type QuoteActivityLogEntry } from '@/modules/quotes';
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
import { MiniStat, DrawerPagination, DrawerTimeFilter, type TimeFilterPreset } from './ProgressTeamPanel';
import type {
  ProgressContractItem,
  ProgressCustomerItem,
  ProgressDealItem,
  ProgressLeadItem,
  ProgressMemberSummaryResponse,
  ProgressProjectItem,
  ProgressQuoteItem,
} from './progress.types';

export type SubTab = 'summary' | 'action' | 'leads' | 'customers' | 'deals' | 'projects' | 'quotes' | 'contracts';

export interface MemberPanelHandlers {
  onOpenQuote: (item: ProgressQuoteItem) => void;
  onOpenLead: (item: ProgressLeadItem) => void;
  onOpenCustomer: (customerId: string, customerName: string) => void;
  onOpenDeal: (item: ProgressDealItem) => void;
  onOpenProject: (item: ProgressProjectItem) => void;
  onOpenContract: (item: ProgressContractItem) => void;
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

const WORKFLOW_STEPS = [
  { key: 'request', label: 'Request' },
  { key: 'technical', altKey: 'presale', label: 'Kỹ thuật' },
  { key: 'sale_markup', altKey: 'pricing', label: 'Sale markup' },
  { key: 'admin_review', altKey: 'review', label: 'Admin review' },
  { key: 'ready_to_send', altKey: 'ready_to_publish', label: 'Sẵn sàng gửi' },
  { key: 'sent', altKey: 'published', label: 'Đã gửi' },
] as const;

function formatShortVND(val: number | null | undefined): string {
  if (!val || val <= 0) return '0 đ';
  return `${val.toLocaleString('vi-VN')} đ`;
}

function formatStepDateTime(dateStr?: string | null): string {
  if (!dateStr) return '---';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '---';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hours}:${mins}`;
  } catch {
    return '---';
  }
}

function formatDueAtDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${mins}`;
  } catch {
    return '—';
  }
}

function getStageStyle(stage?: string | null) {
  const s = (stage || '').toLowerCase();
  if (s.includes('admin') || s.includes('review')) {
    return { bg: '#fef3c7', text: '#b45309', border: '#fde68a' };
  }
  if (s.includes('sale') || s.includes('markup') || s.includes('giá bán')) {
    return { bg: '#dbeafe', text: '#1d4ed8', border: '#bfdbfe' };
  }
  if (s.includes('sẵn sàng') || s.includes('ready')) {
    return { bg: '#f3e8ff', text: '#7e22ce', border: '#e9d5ff' };
  }
  if (s.includes('presale') || s.includes('kỹ thuật') || s.includes('technical')) {
    return { bg: '#e0e7ff', text: '#4338ca', border: '#c7d2fe' };
  }
  if (s.includes('đã gửi') || s.includes('sent')) {
    return { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' };
  }
  return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
}

export function ProgressMemberPanel({
  userId,
  initialTab = 'summary',
  onClose,
  onBack,
  onOpenQuote,
  onOpenLead,
  onOpenCustomer,
  onOpenDeal,
  onOpenProject,
  onOpenContract,
}: {
  userId: string;
  initialTab?: SubTab;
  onClose?: () => void;
  onBack?: () => void;
} & MemberPanelHandlers) {
  const [summary, setSummary] = useState<ProgressMemberSummaryResponse | null>(null);
  const [tab, setTab] = useState<SubTab>(initialTab);

  const [leads, setLeads] = useState<ProgressLeadItem[] | null>(null);
  const [customers, setCustomers] = useState<ProgressCustomerItem[] | null>(null);
  const [deals, setDeals] = useState<ProgressDealItem[] | null>(null);
  const [projects, setProjects] = useState<ProgressProjectItem[] | null>(null);
  const [quotes, setQuotes] = useState<ProgressQuoteItem[] | null>(null);
  const [contracts, setContracts] = useState<ProgressContractItem[] | null>(null);

  // Time filter states for tab "summary"
  const [timePreset, setTimePreset] = useState<TimeFilterPreset>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Quotes Tab State
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [quoteStageFilter, setQuoteStageFilter] = useState('');
  const [quoteSlaFilter, setQuoteSlaFilter] = useState('');
  const [quotesPage, setQuotesPage] = useState(1);
  const [quotesPageSize, setQuotesPageSize] = useState(5);
  const [activityLogs, setActivityLogs] = useState<Record<string, QuoteActivityLogEntry[]>>({});

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
    setSelectedQuoteId(null);
    setQuotesPage(1);

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

      if (q.items && q.items.length > 0) {
        setSelectedQuoteId(q.items[0].quoteId);
      }
    });

    return () => {
      alive = false;
    };
  }, [userId, initialTab]);

  // Load activity log for selected quote
  useEffect(() => {
    if (!selectedQuoteId || activityLogs[selectedQuoteId]) return;
    let alive = true;
    seedingQuoteRepository
      .getQuoteActivityLog(selectedQuoteId)
      .then(log => {
        if (!alive) return;
        setActivityLogs(prev => ({
          ...prev,
          [selectedQuoteId]: [...log].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          ),
        }));
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [selectedQuoteId, activityLogs]);

  const member = summary?.member;
  const s = summary?.summary;

  // Filter quotes by time for Summary dashboard charts
  const summaryQuotes = useMemo(() => {
    let list = quotes || [];
    if (startDate) {
      list = list.filter(q => (q.timeInCurrentStage?.sinceAt ? q.timeInCurrentStage.sinceAt.slice(0, 10) >= startDate : true));
    }
    if (endDate) {
      list = list.filter(q => (q.timeInCurrentStage?.sinceAt ? q.timeInCurrentStage.sinceAt.slice(0, 10) <= endDate : true));
    }
    return list;
  }, [quotes, startDate, endDate]);

  // Quotes KPI metrics
  const quotesKpis = useMemo(() => {
    const list = summaryQuotes || [];
    const total = list.length;
    const overdue = list.filter(
      q => q.sla.status === 'overdue' || q.sla.status === 'completed_late'
    ).length;
    const onTime = list.filter(
      q => q.sla.status === 'in_progress' || q.sla.status === 'completed_on_time'
    ).length;
    const notSet = list.filter(q => q.sla.status === 'not_set').length;
    const totalVnd = list.reduce((sum, q) => sum + (q.totalAmountVnd || 0), 0);

    return { total, overdue, onTime, notSet, totalVnd };
  }, [summaryQuotes]);

  // Member SLA Donut stats
  const memberSlaStats = useMemo(() => {
    const list = summaryQuotes || [];
    let onTime = 0;
    let dueSoon = 0;
    let overdue = 0;
    let notSet = 0;

    for (const q of list) {
      const st = q.sla?.status;
      if (st === 'completed_on_time' || st === 'in_progress') onTime++;
      else if (st === 'due_soon') dueSoon++;
      else if (st === 'overdue' || st === 'completed_late') overdue++;
      else notSet++;
    }

    const total = list.length;
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
  }, [summaryQuotes]);

  // Stage funnel breakdown for quotes (6 steps)
  const stageBreakdown = useMemo(() => {
    const counts = [
      { key: 'request', label: 'Request', count: 0, color: '#94a3b8' },
      { key: 'technical', label: 'Kỹ thuật', count: 0, color: '#6366f1' },
      { key: 'sale_markup', label: 'Sale markup', count: 0, color: '#3b82f6' },
      { key: 'admin_review', label: 'Admin review', count: 0, color: '#f59e0b' },
      { key: 'ready_to_send', label: 'Sẵn sàng gửi', count: 0, color: '#a855f7' },
      { key: 'sent', label: 'Đã gửi', count: 0, color: '#10b981' },
    ];

    (summaryQuotes || []).forEach(q => {
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
  }, [summaryQuotes]);

  // Workload Breakdown (Records)
  const workloadBreakdown = useMemo(() => {
    const items = [
      { key: 'leads' as SubTab, label: 'Lead', count: s?.leadCount ?? 0, icon: Magnet, color: '#06b6d4', bg: '#ecfeff' },
      { key: 'customers' as SubTab, label: 'Khách hàng', count: s?.customerCount ?? 0, icon: Building2, color: '#10b981', bg: '#ecfdf5' },
      { key: 'deals' as SubTab, label: 'Cơ hội', count: s?.dealCount ?? 0, icon: Handshake, color: '#3b82f6', bg: '#eff6ff' },
      { key: 'projects' as SubTab, label: 'Dự án', count: s?.projectCount ?? 0, icon: Box, color: '#f59e0b', bg: '#fffbeb' },
      { key: 'quotes' as SubTab, label: 'Báo giá', count: s?.quoteCount ?? 0, icon: FileText, color: '#8b5cf6', bg: '#f5f3ff' },
      { key: 'contracts' as SubTab, label: 'Hợp đồng', count: s?.contractCount ?? 0, icon: FileCheck, color: '#6366f1', bg: '#eef2ff' },
    ];
    const totalCount = items.reduce((acc, it) => acc + it.count, 0);
    const safeTotal = totalCount > 0 ? totalCount : 1;
    return items.map(it => ({
      ...it,
      percentage: totalCount > 0 ? Math.round((it.count / safeTotal) * 100) : 0,
    }));
  }, [s]);

  // Urgent attention items (Overdue/Due soon quotes, overdue deals)
  const urgentQuotes = useMemo(() => {
    return (quotes || []).filter(
      q => q.sla.status === 'overdue' || q.sla.status === 'completed_late' || q.sla.status === 'due_soon'
    ).slice(0, 4);
  }, [quotes]);

  const urgentDeals = useMemo(() => {
    return (deals || []).filter(
      d => Boolean(d.followUpDate && new Date(d.followUpDate).getTime() < Date.now())
    ).slice(0, 3);
  }, [deals]);

  // Unique Stage options for dropdown
  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    (quotes || []).forEach(q => {
      if (q.processingStageLabel) set.add(q.processingStageLabel);
    });
    return Array.from(set);
  }, [quotes]);

  // Filtered Quotes
  const filteredQuotes = useMemo(() => {
    return (quotes || []).filter(q => {
      if (quoteStageFilter && q.processingStageLabel !== quoteStageFilter) {
        return false;
      }
      if (quoteSlaFilter) {
        const st = q.sla.status;
        if (quoteSlaFilter === 'overdue' && st !== 'overdue' && st !== 'completed_late') return false;
        if (quoteSlaFilter === 'on_time' && st !== 'in_progress' && st !== 'completed_on_time') return false;
        if (quoteSlaFilter === 'due_soon' && st !== 'due_soon') return false;
        if (quoteSlaFilter === 'not_set' && st !== 'not_set') return false;
      }
      return true;
    });
  }, [quotes, quoteStageFilter, quoteSlaFilter]);

  // Paged Quotes
  const pagedQuotes = useMemo(() => {
    return filteredQuotes.slice((quotesPage - 1) * quotesPageSize, quotesPage * quotesPageSize);
  }, [filteredQuotes, quotesPage, quotesPageSize]);

  // Selected Quote Object
  const selectedQuote = useMemo(() => {
    if (!quotes || quotes.length === 0) return null;
    return quotes.find(q => q.quoteId === selectedQuoteId) || quotes[0];
  }, [quotes, selectedQuoteId]);

  // Stepper Calculation for selectedQuote
  const stepperData = useMemo(() => {
    if (!selectedQuote) return null;
    const currentPhase = selectedQuote.processingStage || 'request';

    let currentIndex = WORKFLOW_STEPS.findIndex(
      step => step.key === currentPhase || (step as any).altKey === currentPhase
    );
    if (currentIndex < 0) {
      if (currentPhase.includes('review')) currentIndex = 3;
      else if (currentPhase.includes('markup') || currentPhase.includes('pricing')) currentIndex = 2;
      else if (currentPhase.includes('ready')) currentIndex = 4;
      else if (currentPhase.includes('sent')) currentIndex = 5;
      else currentIndex = 1;
    }

    const logs = (selectedQuote.quoteId && activityLogs[selectedQuote.quoteId]) || [];

    const stepsWithDates = WORKFLOW_STEPS.map((step, idx) => {
      let isDone = idx < currentIndex;
      let isCurrent = idx === currentIndex;
      let isUpcoming = idx > currentIndex;

      let dateText = '---';

      if (idx === 0) {
        const createLog = logs.find(l => l.action === 'created');
        dateText = formatStepDateTime(createLog?.createdAt || selectedQuote.sla.startedAt);
      } else if (idx <= currentIndex) {
        const stepLog = logs.find(l => {
          if (l.action !== 'stage_changed') return false;
          const target = (l.changes as any)?.stage;
          return target === step.key || target === (step as any).altKey;
        });

        if (stepLog?.createdAt) {
          dateText = formatStepDateTime(stepLog.createdAt);
        } else if (idx === currentIndex) {
          dateText = formatStepDateTime(
            selectedQuote.timeInCurrentStage?.sinceAt || selectedQuote.sla.startedAt
          );
        } else {
          dateText = formatStepDateTime(selectedQuote.sla.startedAt);
        }
      }

      return {
        ...step,
        index: idx,
        isDone,
        isCurrent,
        isUpcoming,
        dateText,
      };
    });

    const isOverdue =
      selectedQuote.sla.status === 'overdue' || selectedQuote.sla.status === 'completed_late';
    const isDueSoon = selectedQuote.sla.status === 'due_soon';

    return {
      currentIndex,
      steps: stepsWithDates,
      isOverdue,
      isDueSoon,
    };
  }, [selectedQuote, activityLogs]);

  // SLA Alert calculation for selectedQuote
  const slaAlert = useMemo(() => {
    if (!selectedQuote) return null;
    const sla = selectedQuote.sla;
    const isOverdue = sla.status === 'overdue' || sla.status === 'completed_late';
    const isDueSoon = sla.status === 'due_soon';
    const isNotSet = sla.status === 'not_set';

    let overdueHours = 5;
    let overdueMins = 20;

    if (sla.dueAt) {
      const diffMs = Date.now() - new Date(sla.dueAt).getTime();
      if (diffMs > 0) {
        overdueHours = Math.floor(diffMs / (1000 * 60 * 60));
        overdueMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      }
    }

    return {
      isOverdue,
      isDueSoon,
      isNotSet,
      overdueHours: Math.max(1, overdueHours),
      overdueMins,
      dueAtFormatted: formatDueAtDateTime(sla.dueAt),
      durationText: formatSinceDuration(sla.dueAt),
    };
  }, [selectedQuote]);

  const avatarInitial = (member?.userName || '?').trim().slice(0, 1).toUpperCase();
  const avatarBg = AVATAR_COLORS[Math.abs((member?.userName || '').length) % AVATAR_COLORS.length];
  const avatarUrl =
    (member as any)?.avatarUrl || (member as any)?.avatar || (member as any)?.avatar_url;

  if (!summary) {
    return (
      <div className="progress-member-drawer-loading">
        <p className="crm-empty-log">Đang tải thông tin thành viên...</p>
      </div>
    );
  }

  return (
    <div className="progress-member-drawer-wrap">
      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <header className="progress-member-drawer-header">
        <div className="progress-member-drawer-header-left">
          {onBack ? (
            <button
              type="button"
              className="progress-member-drawer-back-btn"
              onClick={onBack}
              aria-label="Quay lại"
              title="Quay lại"
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}

          <div className="progress-member-drawer-avatar-wrap">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={member?.userName || ''}
                className="progress-member-drawer-avatar-img"
              />
            ) : (
              <span
                className="progress-member-drawer-avatar-initial"
                style={{ backgroundColor: avatarBg }}
              >
                {avatarInitial}
              </span>
            )}
          </div>

          <div className="progress-member-drawer-hero-info">
            <div className="progress-member-drawer-name-row">
              <h2 className="progress-member-drawer-name">
                {member?.userName || 'Chưa đặt tên'}
              </h2>
              <span className="progress-member-status-pill">
                <span className="status-dot" />
                <span>Đang hoạt động</span>
              </span>
            </div>
            <p className="progress-member-drawer-meta">
              {member?.teamName || 'Nhà LNH'} •{' '}
              {member?.role === 'admin'
                ? 'Admin'
                : member?.role === 'leader'
                  ? 'Leader'
                  : 'Member'}
            </p>
          </div>
        </div>

        <div className="progress-member-drawer-header-right">
          <a
            href="/all-platform/crm"
            target="_blank"
            rel="noopener noreferrer"
            className="progress-member-crm-link-btn"
            title="Mở trong CRM"
          >
            <span>Xem trong CRM</span>
            <ExternalLink size={13} />
          </a>

          {onClose ? (
            <button
              type="button"
              className="progress-member-drawer-close-btn"
              onClick={onClose}
              aria-label="Đóng"
              title="Đóng chi tiết"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>
      </header>

      {/* ── 7 Horizontal Tabs ──────────────────────────────────────── */}
      <nav className="progress-member-drawer-nav" aria-label="Phân loại dữ liệu thành viên">
        {([
          ['summary', 'Tổng quan'],
          ['leads', `Lead${leads ? ` (${leads.length})` : ''}`],
          ['customers', `Khách hàng${customers ? ` (${customers.length})` : ''}`],
          ['deals', `Cơ hội${deals ? ` (${deals.length})` : ''}`],
          ['projects', `Dự án${projects ? ` (${projects.length})` : ''}`],
          ['quotes', `Báo giá${quotes ? ` (${quotes.length})` : ''}`],
          ['contracts', `Hợp đồng${contracts ? ` (${contracts.length})` : ''}`],
        ] as Array<[SubTab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`progress-member-drawer-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── Tab Content ───────────────────────────────────────────── */}
      <div className="progress-member-drawer-body">
        {tab === 'quotes' ? (
          <div className="progress-member-quotes-view">
            {/* 5 KPI Summary Cards */}
            <div className="progress-member-kpi-grid-5">
              {/* Card 1: Báo giá */}
              <div className="progress-member-kpi-card">
                <div className="progress-member-kpi-card-left">
                  <span className="kpi-num">{quotesKpis.total}</span>
                  <span className="kpi-lbl">Báo giá</span>
                </div>
                <div className="progress-member-kpi-icon-box tone-yellow">
                  <FileText size={18} />
                </div>
              </div>

              {/* Card 2: Quá SLA */}
              <div className="progress-member-kpi-card">
                <div className="progress-member-kpi-card-left">
                  <span className="kpi-num">{quotesKpis.overdue}</span>
                  <span className="kpi-lbl">Quá SLA</span>
                </div>
                <div className="progress-member-kpi-icon-box tone-red">
                  <AlertTriangle size={18} />
                </div>
              </div>

              {/* Card 3: Đúng hạn */}
              <div className="progress-member-kpi-card">
                <div className="progress-member-kpi-card-left">
                  <span className="kpi-num">{quotesKpis.onTime}</span>
                  <span className="kpi-lbl">Đúng hạn</span>
                </div>
                <div className="progress-member-kpi-icon-box tone-green">
                  <CheckCircle2 size={18} />
                </div>
              </div>

              {/* Card 4: Chưa thiết lập */}
              <div className="progress-member-kpi-card">
                <div className="progress-member-kpi-card-left">
                  <span className="kpi-num">{quotesKpis.notSet}</span>
                  <span className="kpi-lbl">Chưa thiết lập</span>
                </div>
                <div className="progress-member-kpi-icon-box tone-slate">
                  <File size={18} />
                </div>
              </div>

              {/* Card 5: Tổng giá trị */}
              <div className="progress-member-kpi-card kpi-val-card">
                <div className="progress-member-kpi-card-left">
                  <span className="kpi-num kpi-num-large">{formatShortVND(quotesKpis.totalVnd)}</span>
                  <span className="kpi-lbl">Tổng giá trị</span>
                </div>
              </div>
            </div>

            {/* Danh Sách Báo Giá Header & Filters */}
            <div className="progress-member-quotes-section">
              <div className="progress-member-quotes-title-row">
                <h3>Danh sách báo giá ({filteredQuotes.length})</h3>
              </div>

              <div className="progress-member-filter-row">
                <select
                  className="progress-member-filter-select"
                  value={quoteStageFilter}
                  onChange={e => {
                    setQuoteStageFilter(e.target.value);
                    setQuotesPage(1);
                  }}
                >
                  <option value="">Tất cả bước</option>
                  {stageOptions.map(st => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>

                <select
                  className="progress-member-filter-select"
                  value={quoteSlaFilter}
                  onChange={e => {
                    setQuoteSlaFilter(e.target.value);
                    setQuotesPage(1);
                  }}
                >
                  <option value="">Tất cả trạng thái SLA</option>
                  <option value="overdue">Quá SLA</option>
                  <option value="on_time">Đúng hạn</option>
                  <option value="due_soon">Sắp đến hạn</option>
                  <option value="not_set">Chưa thiết lập</option>
                </select>
              </div>

              {/* 8-Column Quotes Table (Fixed 100% width, no horizontal scroll) */}
              <div className="progress-member-table-wrap">
                <table className="progress-member-quotes-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '15%' }}>Mã báo giá</th>
                      <th style={{ width: '19%' }}>Khách hàng</th>
                      <th style={{ width: '10%' }}>Project</th>
                      <th style={{ width: '16%' }}>Bước hiện tại</th>
                      <th style={{ width: '11%' }}>Ở bước này</th>
                      <th style={{ width: '11%', textAlign: 'center' }}>SLA</th>
                      <th style={{ width: '12%', textAlign: 'right' }}>Giá trị</th>
                      <th style={{ width: '6%', textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="progress-quotes-empty-cell">
                          Không tìm thấy báo giá nào phù hợp.
                        </td>
                      </tr>
                    ) : (
                      pagedQuotes.map(quote => {
                        const isSelected = selectedQuote?.quoteId === quote.quoteId;
                        const stStyle = getStageStyle(quote.processingStageLabel);
                        const isOverdue =
                          quote.sla.status === 'overdue' ||
                          quote.sla.status === 'completed_late';
                        const isDueSoon = quote.sla.status === 'due_soon';
                        const isNotSet = quote.sla.status === 'not_set';

                        return (
                          <tr
                            key={quote.quoteId}
                            className={`progress-member-quote-tr ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => setSelectedQuoteId(quote.quoteId)}
                          >
                            <td className="quote-code-cell">
                              <b>{quote.quoteNumber || quote.quoteId.slice(0, 8)}</b>
                            </td>
                            <td className="quote-customer-cell" title={quote.customerName || ''}>
                              {quote.customerName || '—'}
                            </td>
                            <td className="quote-project-cell" title={quote.projectName || ''}>
                              {quote.projectName || '—'}
                            </td>
                            <td>
                              <span
                                className="quote-stage-pill"
                                style={{
                                  backgroundColor: stStyle.bg,
                                  color: stStyle.text,
                                  borderColor: stStyle.border,
                                }}
                              >
                                {quote.processingStageLabel}
                              </span>
                            </td>
                            <td className="quote-duration-cell">
                              {formatSinceDuration(quote.timeInCurrentStage?.sinceAt)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span
                                className={`quote-sla-pill ${
                                  isOverdue
                                    ? 'sla-badge-danger'
                                    : isDueSoon
                                      ? 'sla-badge-warning'
                                      : isNotSet
                                        ? 'sla-badge-neutral'
                                        : 'sla-badge-success'
                                }`}
                              >
                                {isOverdue
                                  ? 'Quá SLA'
                                  : isDueSoon
                                    ? 'Sắp đến hạn'
                                    : isNotSet
                                      ? 'Chưa thiết lập'
                                      : 'Đúng hạn'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }} className="quote-val-cell">
                              {formatVND(quote.totalAmountVnd)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="quote-action-eye-btn"
                                onClick={e => {
                                  e.stopPropagation();
                                  onOpenQuote(quote);
                                }}
                                title="Xem chi tiết báo giá"
                              >
                                <Eye size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <DrawerPagination
                currentPage={quotesPage}
                pageSize={quotesPageSize}
                totalItems={filteredQuotes.length}
                onPageChange={setQuotesPage}
                onPageSizeChange={setQuotesPageSize}
                itemName="báo giá"
              />
            </div>

            {/* ── Tiến độ xử lý báo giá (Stepper & SLA Alert) ────────── */}
            {selectedQuote && stepperData ? (
              <div className="progress-member-timeline-section">
                <div className="progress-member-timeline-header">
                  <h4>
                    Tiến độ xử lý báo giá:{' '}
                    <span className="quote-hl">#{selectedQuote.quoteNumber || selectedQuote.quoteId.slice(0, 8)}</span>
                  </h4>
                  <button
                    type="button"
                    className="progress-member-view-detail-link"
                    onClick={() => onOpenQuote(selectedQuote)}
                  >
                    <span>Xem chi tiết</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                {/* 6-Step Horizontal Stepper */}
                <div className="progress-member-stepper-wrap">
                  <div className="progress-member-stepper">
                    {stepperData.steps.map((step, idx) => {
                      const isLast = idx === stepperData.steps.length - 1;
                      const nextStep = stepperData.steps[idx + 1];

                      let lineColorClass = 'line-upcoming';
                      if (step.isDone && (nextStep?.isDone || nextStep?.isCurrent)) {
                        lineColorClass = nextStep?.isCurrent && stepperData.isOverdue ? 'line-red' : 'line-blue';
                      }

                      return (
                        <div key={step.key} className="progress-step-item">
                          <div className="progress-step-node-row">
                            {/* Step Indicator Circle */}
                            <div
                              className={`progress-step-circle ${
                                step.isDone
                                  ? 'step-done'
                                  : step.isCurrent
                                    ? stepperData.isOverdue
                                      ? 'step-current-overdue'
                                      : 'step-current-blue'
                                    : 'step-upcoming'
                              }`}
                            >
                              {step.isDone ? (
                                <Check size={12} strokeWidth={3} />
                              ) : step.isCurrent ? (
                                <span className="step-current-inner-dot" />
                              ) : (
                                <span className="step-upcoming-inner-dot" />
                              )}
                            </div>

                            {/* Connecting Line */}
                            {!isLast ? (
                              <div className={`progress-step-line ${lineColorClass}`} />
                            ) : null}
                          </div>

                          {/* Step Label & Date */}
                          <div className="progress-step-text-wrap">
                            <span
                              className={`progress-step-label ${
                                step.isCurrent
                                  ? stepperData.isOverdue
                                    ? 'label-current-red'
                                    : 'label-current'
                                  : step.isDone
                                    ? 'label-done'
                                    : 'label-upcoming'
                              }`}
                            >
                              {step.label}
                            </span>
                            <span className="progress-step-date">{step.dateText}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SLA Alert Box */}
                {slaAlert ? (
                  <div
                    className={`progress-member-sla-alert-box ${
                      slaAlert.isOverdue
                        ? 'alert-overdue'
                        : slaAlert.isDueSoon
                          ? 'alert-duesoon'
                          : slaAlert.isNotSet
                            ? 'alert-notset'
                            : 'alert-ontime'
                    }`}
                  >
                    <div className="sla-alert-left">
                      <div className="sla-alert-icon-square">
                        <AlertTriangle size={18} />
                      </div>
                      <div className="sla-alert-text-block">
                        <h5 className="sla-alert-title">
                          {slaAlert.isOverdue
                            ? `Quá SLA ${slaAlert.overdueHours} giờ`
                            : slaAlert.isDueSoon
                              ? 'Sắp đến hạn SLA'
                              : slaAlert.isNotSet
                                ? 'Chưa thiết lập SLA'
                                : 'Đúng hạn SLA'}
                        </h5>
                        <p className="sla-alert-sub">
                          Hạn hoàn tất: {slaAlert.dueAtFormatted}
                          {slaAlert.isOverdue
                            ? ` | Đã quá hạn: ${slaAlert.overdueHours} giờ ${slaAlert.overdueMins} phút`
                            : ''}
                        </p>
                      </div>
                    </div>

                    <a
                      href={`/all-platform/quotes/${selectedQuote.quoteId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sla-alert-action-btn"
                    >
                      <span>Mở báo giá đầy đủ</span>
                      <ExternalLink size={13} />
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : tab === 'summary' ? (
          <div className="progress-member-summary-content">
            {/* 1. Lưới 8 Thẻ KPI Hiện Đại */}
            <div className="progress-member-section">
              <div className="progress-member-section-header">
                <h3 className="progress-member-section-title">Tổng quan hiệu suất</h3>
                <DrawerTimeFilter
                  preset={timePreset}
                  startDate={startDate}
                  endDate={endDate}
                  onPresetChange={setTimePreset}
                  onStartDateChange={setStartDate}
                  onEndDateChange={setEndDate}
                />
              </div>

              <div className="progress-member-kpi-grid-8">
                {/* 1. Pipeline Value */}
                <div className="progress-member-kpi-card-v2 kpi-tone-purple">
                  <div className="kpi-card-v2-icon">
                    <Wallet size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{formatShortVND(s?.pipelineValueVnd || 0)}</span>
                    <span className="kpi-card-v2-lbl">Giá trị pipeline</span>
                  </div>
                </div>

                {/* 2. Báo giá */}
                <div
                  className="progress-member-kpi-card-v2 kpi-tone-yellow is-clickable"
                  onClick={() => setTab('quotes')}
                  title="Xem danh sách báo giá"
                >
                  <div className="kpi-card-v2-icon">
                    <FileText size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{s?.quoteCount ?? quotesKpis.total}</span>
                    <span className="kpi-card-v2-lbl">Báo giá</span>
                  </div>
                </div>

                {/* 3. Quá hạn SLA */}
                <div
                  className={`progress-member-kpi-card-v2 kpi-tone-red ${
                    ((s?.quotesOverSlaCount ?? quotesKpis.overdue) || 0) > 0 ? 'is-alert-danger' : ''
                  }`}
                  onClick={() => {
                    setQuoteSlaFilter('overdue');
                    setTab('quotes');
                  }}
                  title="Lọc báo giá quá SLA"
                >
                  <div className="kpi-card-v2-icon">
                    <AlertTriangle size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{(s?.quotesOverSlaCount ?? quotesKpis.overdue) || 0}</span>
                    <span className="kpi-card-v2-lbl">Quá SLA</span>
                  </div>
                </div>

                {/* 4. Đúng hạn SLA */}
                <div className="progress-member-kpi-card-v2 kpi-tone-green">
                  <div className="kpi-card-v2-icon">
                    <CheckCircle2 size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{quotesKpis.onTime}</span>
                    <span className="kpi-card-v2-lbl">Đúng hạn SLA</span>
                  </div>
                </div>

                {/* 5. Khách hàng */}
                <div
                  className="progress-member-kpi-card-v2 kpi-tone-emerald is-clickable"
                  onClick={() => setTab('customers')}
                  title="Xem danh sách khách hàng"
                >
                  <div className="kpi-card-v2-icon">
                    <Building2 size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{s?.customerCount ?? 0}</span>
                    <span className="kpi-card-v2-lbl">Khách hàng</span>
                  </div>
                </div>

                {/* 6. Cơ hội */}
                <div
                  className="progress-member-kpi-card-v2 kpi-tone-blue is-clickable"
                  onClick={() => setTab('deals')}
                  title="Xem danh sách cơ hội"
                >
                  <div className="kpi-card-v2-icon">
                    <Handshake size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{s?.dealCount ?? 0}</span>
                    <span className="kpi-card-v2-lbl">Cơ hội (Deals)</span>
                  </div>
                </div>

                {/* 7. Dự án */}
                <div
                  className="progress-member-kpi-card-v2 kpi-tone-amber is-clickable"
                  onClick={() => setTab('projects')}
                  title="Xem danh sách dự án"
                >
                  <div className="kpi-card-v2-icon">
                    <Box size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{s?.projectCount ?? 0}</span>
                    <span className="kpi-card-v2-lbl">Dự án</span>
                  </div>
                </div>

                {/* 8. Hợp đồng */}
                <div
                  className="progress-member-kpi-card-v2 kpi-tone-indigo is-clickable"
                  onClick={() => setTab('contracts')}
                  title="Xem danh sách hợp đồng"
                >
                  <div className="kpi-card-v2-icon">
                    <FileCheck size={18} />
                  </div>
                  <div className="kpi-card-v2-body">
                    <span className="kpi-card-v2-num">{s?.contractCount ?? 0}</span>
                    <span className="kpi-card-v2-lbl">Hợp đồng</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Cặp Biểu Đồ Trực Quan: Donut SLA & 6-Stage Funnel */}
            <div className="progress-member-charts-row">
              {/* Cột 1: Donut Chart SVG Tình trạng Báo giá */}
              <div className="progress-member-chart-card">
                <div className="progress-member-chart-header">
                  <div className="chart-header-left">
                    <PieChart size={16} className="chart-header-icon" />
                    <h4>Tình trạng SLA Báo giá</h4>
                  </div>
                  <span className="chart-badge">{quotes?.length || 0} báo giá</span>
                </div>

                <div className="progress-member-donut-layout">
                  <div className="donut-svg-wrapper">
                    {(() => {
                      const dSize = 110;
                      const dStroke = 16;
                      const dRadius = (dSize - dStroke) / 2;
                      const dCirc = 2 * Math.PI * dRadius;
                      const totalSla = memberSlaStats.total;

                      const slices = [
                        { label: 'Đúng hạn', count: memberSlaStats.onTime, color: '#10b981' },
                        { label: 'Sắp đến hạn', count: memberSlaStats.dueSoon, color: '#f59e0b' },
                        { label: 'Quá hạn', count: memberSlaStats.overdue, color: '#ef4444' },
                        { label: 'Chưa thiết lập', count: memberSlaStats.notSet, color: '#94a3b8' },
                      ];

                      let accum = 0;
                      const rendered = slices.map(sl => {
                        const ratio = totalSla > 0 ? sl.count / totalSla : 0;
                        const len = ratio * dCirc;
                        const off = accum;
                        accum += len;
                        return { ...sl, length: len, offset: off };
                      });

                      return (
                        <div className="progress-team-donut-wrapper">
                          <svg width={dSize} height={dSize} viewBox={`0 0 ${dSize} ${dSize}`}>
                            {totalSla === 0 ? (
                              <circle
                                cx={dSize / 2}
                                cy={dSize / 2}
                                r={dRadius}
                                fill="none"
                                stroke="#f1f5f9"
                                strokeWidth={dStroke}
                              />
                            ) : (
                              rendered.map(sl => {
                                if (sl.count <= 0) return null;
                                return (
                                  <circle
                                    key={sl.label}
                                    cx={dSize / 2}
                                    cy={dSize / 2}
                                    r={dRadius}
                                    fill="none"
                                    stroke={sl.color}
                                    strokeWidth={dStroke}
                                    strokeDasharray={`${sl.length} ${dCirc - sl.length}`}
                                    strokeDashoffset={-sl.offset}
                                    transform={`rotate(-90 ${dSize / 2} ${dSize / 2})`}
                                  />
                                );
                              })
                            )}
                          </svg>
                          <div className="progress-team-donut-hole">
                            <span className="progress-team-donut-center-num">
                              {totalSla > 0 ? `${memberSlaStats.onTimePct}%` : '0%'}
                            </span>
                            <span className="progress-team-donut-center-lbl">Đúng hạn</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="donut-legend-vertical">
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-emerald" />
                      <span className="legend-label">Đúng hạn</span>
                      <span className="legend-val">{memberSlaStats.onTimePct}% ({memberSlaStats.onTime})</span>
                    </div>
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-amber" />
                      <span className="legend-label">Sắp đến hạn</span>
                      <span className="legend-val">{memberSlaStats.dueSoonPct}% ({memberSlaStats.dueSoon})</span>
                    </div>
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-danger" />
                      <span className="legend-label">Quá hạn</span>
                      <span className="legend-val">{memberSlaStats.overduePct}% ({memberSlaStats.overdue})</span>
                    </div>
                    <div className="donut-legend-item">
                      <span className="legend-dot bg-slate" />
                      <span className="legend-label">Chưa thiết lập</span>
                      <span className="legend-val">{memberSlaStats.notSetPct}% ({memberSlaStats.notSet})</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cột 2: Biểu Đồ 6 Bước Quy Trình Báo Giá (Stage Funnel) */}
              <div className="progress-member-chart-card">
                <div className="progress-member-chart-header">
                  <div className="chart-header-left">
                    <BarChart2 size={16} className="chart-header-icon" />
                    <h4>Quy trình xử lý báo giá (6 bước)</h4>
                  </div>
                  <button
                    type="button"
                    className="chart-link-btn"
                    onClick={() => setTab('quotes')}
                  >
                    Xem chi tiết →
                  </button>
                </div>

                <div className="progress-funnel-vertical-list">
                  {stageBreakdown.counts.map(st => {
                    const pct = Math.round((st.count / stageBreakdown.maxCount) * 100);
                    return (
                      <div
                        key={st.key}
                        className="progress-funnel-row"
                        onClick={() => {
                          setQuoteStageFilter(st.label);
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

            {/* 3. Biểu đồ Thanh Cơ Cấu Khối Lượng Hồ Sơ CRM (Workload Portfolio) */}
            <div className="progress-member-section">
              <div className="progress-member-section-header">
                <h3 className="progress-member-section-title">Cơ cấu hồ sơ &amp; Khối lượng công việc</h3>
                <span className="progress-member-period-badge">
                  Tổng {workloadBreakdown.reduce((sum, w) => sum + w.count, 0)} hồ sơ
                </span>
              </div>

              <div className="progress-workload-grid">
                {workloadBreakdown.map(item => {
                  const ItemIcon = item.icon;
                  return (
                    <div
                      key={item.key}
                      className="progress-workload-card is-clickable"
                      onClick={() => setTab(item.key)}
                      title={`Xem danh sách ${item.label}`}
                    >
                      <div className="workload-card-top">
                        <div
                          className="workload-card-icon"
                          style={{ backgroundColor: item.bg, color: item.color }}
                        >
                          <ItemIcon size={16} />
                        </div>
                        <div className="workload-card-info">
                          <span className="workload-card-count">{item.count}</span>
                          <span className="workload-card-label">{item.label}</span>
                        </div>
                        <span className="workload-card-pct">{item.percentage}%</span>
                      </div>
                      <div className="workload-bar-track">
                        <div
                          className="workload-bar-fill"
                          style={{
                            width: `${Math.max(item.count > 0 ? 6 : 0, item.percentage)}%`,
                            backgroundColor: item.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 4. Danh Sách Việc Khẩn Cấp Cần Xử Lý (Urgent Action Items) */}
            {(urgentQuotes.length > 0 || urgentDeals.length > 0) && (
              <div className="progress-member-section">
                <div className="progress-member-section-header">
                  <div className="section-title-with-badge">
                    <h3 className="progress-member-section-title">Hồ sơ cần chú ý gấp</h3>
                    <span className="urgent-badge-pill">
                      {urgentQuotes.length + urgentDeals.length} việc
                    </span>
                  </div>
                </div>

                <div className="progress-urgent-list">
                  {urgentQuotes.map(quote => {
                    const isOverdue =
                      quote.sla.status === 'overdue' || quote.sla.status === 'completed_late';
                    return (
                      <div
                        key={quote.quoteId}
                        className="progress-urgent-item"
                        onClick={() => {
                          setSelectedQuoteId(quote.quoteId);
                          setTab('quotes');
                        }}
                      >
                        <div className="urgent-item-left">
                          <span className={`urgent-status-tag ${isOverdue ? 'is-danger' : 'is-warning'}`}>
                            {isOverdue ? 'Quá SLA' : 'Sắp đến hạn'}
                          </span>
                          <div className="urgent-item-details">
                            <span className="urgent-item-code">
                              #{quote.quoteNumber || quote.quoteId.slice(0, 8)}
                            </span>
                            <span className="urgent-item-sub">
                              {quote.customerName || 'Khách hàng'} • Bước: {quote.processingStageLabel}
                            </span>
                          </div>
                        </div>
                        <div className="urgent-item-right">
                          <span className="urgent-item-val">{formatVND(quote.totalAmountVnd)}</span>
                          <ChevronRight size={15} className="urgent-item-arrow" />
                        </div>
                      </div>
                    );
                  })}

                  {urgentDeals.map(deal => (
                    <div
                      key={deal.dealId}
                      className="progress-urgent-item"
                      onClick={() => onOpenDeal(deal)}
                    >
                      <div className="urgent-item-left">
                        <span className="urgent-status-tag is-danger">Quá Follow-up</span>
                        <div className="urgent-item-details">
                          <span className="urgent-item-code">{deal.customerName}</span>
                          <span className="urgent-item-sub">
                            Giai đoạn: {deal.dealStageLabel} • Hạn follow: {formatDate(deal.followUpDate)}
                          </span>
                        </div>
                      </div>
                      <div className="urgent-item-right">
                        <span className="urgent-item-val">{formatVND(deal.estimatedBudgetVnd)}</span>
                        <ChevronRight size={15} className="urgent-item-arrow" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : tab === 'leads' ? (
          <LeadsList items={leads || []} onOpen={onOpenLead} />
        ) : tab === 'customers' ? (
          <CustomersList
            items={customers || []}
            onOpen={c => onOpenCustomer(c.customerId, c.customerName || 'Khách hàng')}
          />
        ) : tab === 'deals' ? (
          <DealsList items={deals || []} onOpen={onOpenDeal} />
        ) : tab === 'projects' ? (
          <ProjectsList items={projects || []} onOpen={onOpenProject} />
        ) : (
          <ContractsList items={contracts || []} onOpen={onOpenContract} />
        )}
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="crm-empty-log">{text}</p>;
}

function LeadsList({
  items,
  onOpen,
}: {
  items: ProgressLeadItem[];
  onOpen: (item: ProgressLeadItem) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const s = searchTerm.trim().toLowerCase();
    return items.filter(
      row =>
        (row.leadName || '').toLowerCase().includes(s) ||
        (row.companyName || '').toLowerCase().includes(s) ||
        (row.statusLabel || '').toLowerCase().includes(s) ||
        (row.sdrName || '').toLowerCase().includes(s)
    );
  }, [items, searchTerm]);

  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="progress-member-list-tab-wrap">
      <div className="drawer-search-toolbar">
        <div className="drawer-search-box">
          <Search size={15} color="#94a3b8" />
          <input
            type="text"
            placeholder="Tìm kiếm lead theo tên, công ty..."
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setPage(1);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <X size={14} color="#94a3b8" />
            </button>
          )}
        </div>
        <span className="drawer-search-count">
          {filteredItems.length} lead
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyRow text="Không tìm thấy lead nào phù hợp." />
      ) : (
        <>
          <div className="progress-record-list">
            {pagedItems.map(row => (
              <button
                key={row.leadId}
                type="button"
                className="progress-record-card"
                onClick={() => onOpen(row)}
              >
                <span className="progress-record-card-icon">🧲</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">{row.leadName}</div>
                  <div className="progress-record-card-sub">
                    <span className={`qc-badge ${LEAD_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>
                      {row.statusLabel}
                    </span>
                    <span>{formatSinceDuration(row.sinceAt)}</span>
                  </div>
                </div>
                <span className="progress-arrow">›</span>
              </button>
            ))}
          </div>

          <DrawerPagination
            currentPage={page}
            pageSize={pageSize}
            totalItems={filteredItems.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemName="lead"
          />
        </>
      )}
    </div>
  );
}

function CustomersList({
  items,
  onOpen,
}: {
  items: ProgressCustomerItem[];
  onOpen: (item: ProgressCustomerItem) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const s = searchTerm.trim().toLowerCase();
    return items.filter(
      row =>
        (row.customerName || '').toLowerCase().includes(s) ||
        (row.companyName || '').toLowerCase().includes(s) ||
        (row.status || '').toLowerCase().includes(s)
    );
  }, [items, searchTerm]);

  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="progress-member-list-tab-wrap">
      <div className="drawer-search-toolbar">
        <div className="drawer-search-box">
          <Search size={15} color="#94a3b8" />
          <input
            type="text"
            placeholder="Tìm kiếm khách hàng..."
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setPage(1);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <X size={14} color="#94a3b8" />
            </button>
          )}
        </div>
        <span className="drawer-search-count">
          {filteredItems.length} khách hàng
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyRow text="Không tìm thấy khách hàng nào phù hợp." />
      ) : (
        <>
          <div className="progress-record-list">
            {pagedItems.map(row => (
              <button
                key={row.customerId}
                type="button"
                className="progress-record-card"
                onClick={() => onOpen(row)}
              >
                <span className="progress-record-card-icon">🏢</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">{row.customerName}</div>
                  <div className="progress-record-card-sub">
                    <span className={`qc-badge ${CUSTOMER_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>
                      {customerStatusLabel(row.status)}
                    </span>
                    <span>{row.dealCount} cơ hội</span>
                  </div>
                </div>
                <div className="progress-record-card-value">
                  {formatVND(row.pipelineValueVnd) || '0 đ'}
                </div>
              </button>
            ))}
          </div>

          <DrawerPagination
            currentPage={page}
            pageSize={pageSize}
            totalItems={filteredItems.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemName="khách hàng"
          />
        </>
      )}
    </div>
  );
}

function DealsList({
  items,
  onOpen,
}: {
  items: ProgressDealItem[];
  onOpen: (item: ProgressDealItem) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const s = searchTerm.trim().toLowerCase();
    return items.filter(
      row =>
        (row.customerName || '').toLowerCase().includes(s) ||
        (row.companyName || '').toLowerCase().includes(s) ||
        (row.dealStageLabel || '').toLowerCase().includes(s)
    );
  }, [items, searchTerm]);

  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="progress-member-list-tab-wrap">
      <div className="drawer-search-toolbar">
        <div className="drawer-search-box">
          <Search size={15} color="#94a3b8" />
          <input
            type="text"
            placeholder="Tìm cơ hội theo khách hàng, giai đoạn..."
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setPage(1);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <X size={14} color="#94a3b8" />
            </button>
          )}
        </div>
        <span className="drawer-search-count">
          {filteredItems.length} cơ hội
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyRow text="Không tìm thấy cơ hội nào phù hợp." />
      ) : (
        <>
          <div className="progress-record-list">
            {pagedItems.map(row => (
              <button
                key={row.dealId}
                type="button"
                className="progress-record-card"
                onClick={() => onOpen(row)}
              >
                <span className="progress-record-card-icon">🎯</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">{row.customerName}</div>
                  <div className="progress-record-card-sub">
                    <span className="qc-badge qc-badge-blue">{row.dealStageLabel}</span>
                    <span>{formatSinceDuration(row.sinceAt)}</span>
                    {row.followUpDate ? <span>Follow-up {formatDate(row.followUpDate)}</span> : null}
                  </div>
                </div>
                <div className="progress-record-card-value">
                  {formatVND(row.estimatedBudgetVnd) || '0 đ'}
                </div>
              </button>
            ))}
          </div>

          <DrawerPagination
            currentPage={page}
            pageSize={pageSize}
            totalItems={filteredItems.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemName="cơ hội"
          />
        </>
      )}
    </div>
  );
}

function ProjectsList({
  items,
  onOpen,
}: {
  items: ProgressProjectItem[];
  onOpen: (item: ProgressProjectItem) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const s = searchTerm.trim().toLowerCase();
    return items.filter(
      row =>
        (row.projectName || '').toLowerCase().includes(s) ||
        (row.projectCode || '').toLowerCase().includes(s) ||
        (row.customerName || '').toLowerCase().includes(s) ||
        (row.statusLabel || '').toLowerCase().includes(s)
    );
  }, [items, searchTerm]);

  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="progress-member-list-tab-wrap">
      <div className="drawer-search-toolbar">
        <div className="drawer-search-box">
          <Search size={15} color="#94a3b8" />
          <input
            type="text"
            placeholder="Tìm kiếm dự án theo mã, tên dự án..."
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setPage(1);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <X size={14} color="#94a3b8" />
            </button>
          )}
        </div>
        <span className="drawer-search-count">
          {filteredItems.length} dự án
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyRow text="Không tìm thấy dự án nào phù hợp." />
      ) : (
        <>
          <div className="progress-record-list">
            {pagedItems.map(row => (
              <button
                key={row.projectId}
                type="button"
                className="progress-record-card"
                onClick={() => onOpen(row)}
              >
                <span className="progress-record-card-icon">📁</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">
                    {row.projectName || row.projectCode}
                  </div>
                  <div className="progress-record-card-sub">
                    <span className={`qc-badge ${PROJECT_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>
                      {row.statusLabel}
                    </span>
                    <span>{row.customerName}</span>
                  </div>
                </div>
                <span className="progress-arrow">›</span>
              </button>
            ))}
          </div>

          <DrawerPagination
            currentPage={page}
            pageSize={pageSize}
            totalItems={filteredItems.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemName="dự án"
          />
        </>
      )}
    </div>
  );
}

function ContractsList({
  items,
  onOpen,
}: {
  items: ProgressContractItem[];
  onOpen: (item: ProgressContractItem) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const s = searchTerm.trim().toLowerCase();
    return items.filter(
      row =>
        (row.contractNumber || '').toLowerCase().includes(s) ||
        (row.title || '').toLowerCase().includes(s) ||
        (row.statusLabel || '').toLowerCase().includes(s)
    );
  }, [items, searchTerm]);

  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="progress-member-list-tab-wrap">
      <div className="drawer-search-toolbar">
        <div className="drawer-search-box">
          <Search size={15} color="#94a3b8" />
          <input
            type="text"
            placeholder="Tìm hợp đồng theo số HĐ, tiêu đề..."
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setPage(1);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            >
              <X size={14} color="#94a3b8" />
            </button>
          )}
        </div>
        <span className="drawer-search-count">
          {filteredItems.length} hợp đồng
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyRow text="Không tìm thấy hợp đồng nào phù hợp." />
      ) : (
        <>
          <div className="progress-record-list">
            {pagedItems.map(row => (
              <button
                key={row.contractId}
                type="button"
                className="progress-record-card"
                onClick={() => onOpen(row)}
              >
                <span className="progress-record-card-icon">📝</span>
                <div className="progress-record-card-main">
                  <div className="progress-record-card-title">
                    {row.contractNumber || row.title}
                  </div>
                  <div className="progress-record-card-sub">
                    <span className={`qc-badge ${CONTRACT_STATUS_TONE[row.status || ''] || 'qc-badge-neutral'}`}>
                      {row.statusLabel}
                    </span>
                    <span>{formatSinceDuration(row.sinceAt)}</span>
                  </div>
                </div>
                <div className="progress-record-card-value">
                  {formatVND(row.contractValueVnd) || '0 đ'}
                </div>
              </button>
            ))}
          </div>

          <DrawerPagination
            currentPage={page}
            pageSize={pageSize}
            totalItems={filteredItems.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemName="hợp đồng"
          />
        </>
      )}
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

export function QuotesTable({
  items,
  onOpen,
  showOwner,
}: {
  items: ProgressQuoteItem[];
  onOpen: (item: ProgressQuoteItem) => void;
  showOwner?: boolean;
}) {
  if (!items.length) return <EmptyRow text="Chưa có báo giá nào." />;
  return (
    <div className="progress-record-list">
      {items.map(row => (
        <button
          key={row.quoteId}
          type="button"
          className="progress-record-card"
          onClick={() => onOpen(row)}
        >
          <span className="progress-record-card-icon">📄</span>
          <div className="progress-record-card-main">
            <div className="progress-record-card-title">
              {row.quoteNumber} · {row.customerName}
            </div>
            <div className="progress-record-card-sub">
              <span className={`qc-badge ${QUOTE_PHASE_TONE[row.processingStage] || 'qc-badge-neutral'}`}>
                {row.processingStageLabel}
              </span>
              <span>{formatSinceDuration(row.timeInCurrentStage?.sinceAt)}</span>
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
          <div className="progress-record-card-value">
            {formatVND(row.totalAmountVnd) || '0 đ'}
          </div>
        </button>
      ))}
    </div>
  );
}

