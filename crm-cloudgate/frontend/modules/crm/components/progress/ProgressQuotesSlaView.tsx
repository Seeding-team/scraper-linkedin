'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Eye,
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertTriangle,
  Clock,
  FileCheck,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import type { ProgressQuoteItem, ProgressTeamSummary } from './progress.types';
import { ProgressDonut } from './ProgressDonut';
import { formatSinceDuration } from './progressLabels';

// Avatar pastel color palette
const AVATAR_BG_COLORS = ['#fda4af', '#93c5fd', '#86efac', '#c4b5fd', '#fcd34d', '#67e8f9', '#f9a8d4', '#a5b4fc'];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_BG_COLORS.length;
  return AVATAR_BG_COLORS[idx];
}

// Stage styling map (matching screenshot media_1790168781575.png)
function getStageStyle(stageLabel: string | null | undefined): { bg: string; color: string } {
  const s = (stageLabel || '').toLowerCase();
  if (s.includes('admin') || s.includes('review')) {
    return { bg: '#fef3c7', color: '#b45309' }; // Amber
  }
  if (s.includes('markup') || s.includes('sale')) {
    return { bg: '#dbeafe', color: '#1d4ed8' }; // Blue
  }
  if (s.includes('sẵn sàng') || s.includes('gửi') || s.includes('ready')) {
    return { bg: '#ede9fe', color: '#6d28d9' }; // Purple
  }
  if (s.includes('presale')) {
    return { bg: '#e0e7ff', color: '#4338ca' }; // Indigo
  }
  if (s.includes('hoàn thiện') || s.includes('giá')) {
    return { bg: '#fce7f3', color: '#be185d' }; // Pink
  }
  if (s.includes('kỹ thuật') || s.includes('tech')) {
    return { bg: '#f1f5f9', color: '#475569' }; // Slate
  }
  return { bg: '#f3f4f6', color: '#374151' };
}

// SLA badge styling map
function getSlaBadge(status: string | undefined): { label: string; className: string } {
  switch (status) {
    case 'overdue':
    case 'completed_late':
      return { label: 'Quá SLA', className: 'sla-badge-danger' };
    case 'due_soon':
      return { label: 'Sắp đến hạn', className: 'sla-badge-warning' };
    case 'not_set':
      return { label: 'Chưa thiết lập', className: 'sla-badge-neutral' };
    case 'in_progress':
    case 'completed_on_time':
    default:
      return { label: 'Đúng hạn', className: 'sla-badge-success' };
  }
}

export function formatQuoteVND(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '0 đ';
  return `${Math.round(val).toLocaleString('vi-VN')} đ`;
}

interface ProgressQuotesSlaViewProps {
  quotes: ProgressQuoteItem[];
  teams?: ProgressTeamSummary[];
  teamMembersMap?: Record<string, Array<{ userId: string; userName: string | null }>>;
  onOpenQuote: (quote: ProgressQuoteItem) => void;
  externalSearch?: string;
  externalTeamFilter?: string;
  externalMemberFilter?: string;
  externalStatusFilter?: string;
  externalPresaleFilter?: string;
  externalSaleFilter?: string;
  externalStageFilter?: string;
}

export function ProgressQuotesSlaView({
  quotes,
  teams = [],
  teamMembersMap = {},
  onOpenQuote,
  externalSearch = '',
  externalTeamFilter = '',
  externalMemberFilter = '',
  externalStatusFilter = '',
  externalPresaleFilter = '',
  externalSaleFilter = '',
  externalStageFilter = '',
}: ProgressQuotesSlaViewProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);

  // Overall KPI stats (calculated from all active quotes)
  const kpiStats = useMemo(() => {
    const total = quotes.length;
    let overdue = 0;
    let dueSoon = 0;
    let notSet = 0;
    let onTime = 0;

    quotes.forEach(q => {
      const st = q.sla?.status;
      if (st === 'overdue' || st === 'completed_late') overdue++;
      else if (st === 'due_soon') dueSoon++;
      else if (st === 'not_set') notSet++;
      else onTime++;
    });

    return { total, overdue, dueSoon, notSet, onTime };
  }, [quotes]);

  // Filtered quotes based on top toolbar filter inputs
  const filteredQuotes = useMemo(() => {
    let list = quotes;

    // 1. Search keyword
    const q = (externalSearch || '').toLowerCase().trim();
    if (q) {
      list = list.filter(item => {
        const num = (item.quoteNumber || '').toLowerCase();
        const cust = (item.customerName || '').toLowerCase();
        const proj = (item.projectName || '').toLowerCase();
        const pre = (item.technicalOwnerName || '').toLowerCase();
        const sal = (item.quoteOwnerName || '').toLowerCase();
        return num.includes(q) || cust.includes(q) || proj.includes(q) || pre.includes(q) || sal.includes(q);
      });
    }

    // 2. Team filter
    if (externalTeamFilter) {
      const teamObj = teams.find(t => t.teamId === externalTeamFilter || (t.teamName || t.teamId) === externalTeamFilter);
      const tKey = teamObj ? (teamObj.teamName || teamObj.teamId) : externalTeamFilter;
      const teamMembers = teamMembersMap[tKey] || teamMembersMap[externalTeamFilter] || [];
      const memberIds = new Set(teamMembers.map(m => m.userId));
      const memberNames = new Set(teamMembers.map(m => (m.userName || '').toLowerCase()));

      list = list.filter(item => {
        if (item.technicalOwnerId && memberIds.has(item.technicalOwnerId)) return true;
        if (item.quoteOwnerId && memberIds.has(item.quoteOwnerId)) return true;
        if (item.technicalOwnerName && memberNames.has(item.technicalOwnerName.toLowerCase())) return true;
        if (item.quoteOwnerName && memberNames.has(item.quoteOwnerName.toLowerCase())) return true;
        const anyItem = item as any;
        if (anyItem.teamId === externalTeamFilter || anyItem.teamName === tKey) return true;
        return false;
      });
    }

    // 3. Member filter (Sale or Presale)
    if (externalMemberFilter) {
      list = list.filter(item => {
        const preId = item.technicalOwnerId || '';
        const salId = item.quoteOwnerId || '';
        const preName = (item.technicalOwnerName || '').toLowerCase();
        const salName = (item.quoteOwnerName || '').toLowerCase();
        const target = externalMemberFilter.toLowerCase();
        return preId === externalMemberFilter || salId === externalMemberFilter || preName.includes(target) || salName.includes(target);
      });
    }

    // 4. Presale filter
    if (externalPresaleFilter) {
      list = list.filter(item => {
        return item.technicalOwnerName === externalPresaleFilter || item.technicalOwnerId === externalPresaleFilter;
      });
    }

    // 5. Sale filter
    if (externalSaleFilter) {
      list = list.filter(item => {
        return item.quoteOwnerName === externalSaleFilter || item.quoteOwnerId === externalSaleFilter;
      });
    }

    // 6. Stage filter
    if (externalStageFilter) {
      list = list.filter(item => {
        return item.processingStageLabel === externalStageFilter;
      });
    }

    // 7. Status / SLA filter
    if (externalStatusFilter) {
      list = list.filter(item => {
        const st = item.sla?.status;
        if (externalStatusFilter === 'overdue') return st === 'overdue' || st === 'completed_late';
        if (externalStatusFilter === 'due_soon') return st === 'due_soon';
        if (externalStatusFilter === 'not_set') return st === 'not_set';
        if (externalStatusFilter === 'in_progress') return st === 'in_progress' || st === 'completed_on_time';
        if (externalStatusFilter === 'completed') return st === 'completed_on_time' || st === 'completed_late';
        return true;
      });
    }

    return list;
  }, [
    quotes,
    externalSearch,
    externalTeamFilter,
    externalMemberFilter,
    externalStatusFilter,
    externalPresaleFilter,
    externalSaleFilter,
    externalStageFilter,
    teams,
    teamMembersMap,
  ]);

  // Reset page when top toolbar filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    externalSearch,
    externalTeamFilter,
    externalMemberFilter,
    externalStatusFilter,
    externalPresaleFilter,
    externalSaleFilter,
    externalStageFilter,
  ]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredQuotes.length / pageSize));
  const currentSafePage = Math.min(currentPage, totalPages);
  const paginatedQuotes = useMemo(() => {
    const start = (currentSafePage - 1) * pageSize;
    return filteredQuotes.slice(start, start + pageSize);
  }, [filteredQuotes, currentSafePage, pageSize]);

  // Donut chart segments for Widget 1
  const donutSegments = useMemo(() => {
    return [
      { label: 'Đúng hạn', value: kpiStats.onTime, color: '#10b981' },
      { label: 'Sắp đến hạn', value: kpiStats.dueSoon, color: '#f59e0b' },
      { label: 'Quá hạn', value: kpiStats.overdue, color: '#ef4444' },
      { label: 'Chưa thiết lập', value: kpiStats.notSet, color: '#94a3b8' },
    ];
  }, [kpiStats]);

  // Widget 2: Stage counts (Horizontal Bar Chart)
  const stageStats = useMemo(() => {
    const counts: Record<string, number> = {};
    quotes.forEach(q => {
      const lbl = q.processingStageLabel || 'Khác';
      counts[lbl] = (counts[lbl] || 0) + 1;
    });

    const STAGE_BAR_COLORS: Record<string, string> = {
      'Sẵn sàng gửi': '#8b5cf6',
      'Admin review': '#f59e0b',
      'Sale markup': '#3b82f6',
      'Presale': '#6366f1',
      'Hoàn thiện giá': '#ec4899',
      'Kỹ thuật': '#94a3b8',
    };

    return Object.entries(counts)
      .map(([label, count]) => ({
        label,
        count,
        color: STAGE_BAR_COLORS[label] || '#64748b',
      }))
      .sort((a, b) => b.count - a.count);
  }, [quotes]);

  const maxStageCount = useMemo(() => {
    return Math.max(1, ...stageStats.map(s => s.count));
  }, [stageStats]);

  // Widget 3: Top Presale
  const topPresales = useMemo(() => {
    const counts: Record<string, number> = {};
    quotes.forEach(q => {
      const name = q.technicalOwnerName || 'Chưa gán';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [quotes]);

  const maxPresaleCount = useMemo(() => {
    return Math.max(1, ...topPresales.map(p => p.count));
  }, [topPresales]);

  // Widget 4: Top Sale
  const topSales = useMemo(() => {
    const counts: Record<string, number> = {};
    quotes.forEach(q => {
      const name = q.quoteOwnerName || 'Chưa gán';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [quotes]);

  const maxSaleCount = useMemo(() => {
    return Math.max(1, ...topSales.map(s => s.count));
  }, [topSales]);

  return (
    <div className="progress-quotes-sla-container">
      {/* 2-Column Main Layout */}
      <div className="progress-quotes-main-layout">
        {/* Left Column (72%): KPI Cards, Filters, 12-col Table */}
        <div className="progress-quotes-left-col">
          {/* 4 Summary KPI Cards */}
          <div className="progress-quotes-kpi-grid">
            {/* Card 1: Báo giá đang xử lý */}
            <div className="progress-quotes-kpi-card">
              <div className="progress-quotes-kpi-header">
                <div className="progress-quotes-kpi-icon icon-blue">
                  <FileText size={20} />
                </div>
              </div>
              <div className="progress-quotes-kpi-body">
                <div className="progress-quotes-kpi-num">{kpiStats.total}</div>
                <div className="progress-quotes-kpi-label">Báo giá đang xử lý</div>
                <div className="progress-quotes-kpi-trend trend-green">
                  <span>↑ 15%</span>
                </div>
              </div>
            </div>

            {/* Card 2: Báo giá quá SLA */}
            <div className="progress-quotes-kpi-card">
              <div className="progress-quotes-kpi-header">
                <div className="progress-quotes-kpi-icon icon-red">
                  <AlertTriangle size={20} />
                </div>
              </div>
              <div className="progress-quotes-kpi-body">
                <div className="progress-quotes-kpi-num">{kpiStats.overdue}</div>
                <div className="progress-quotes-kpi-label">Báo giá quá SLA</div>
                <div className="progress-quotes-kpi-trend trend-red">
                  <span>↑ 50%</span>
                </div>
              </div>
            </div>

            {/* Card 3: Sắp đến hạn */}
            <div className="progress-quotes-kpi-card">
              <div className="progress-quotes-kpi-header">
                <div className="progress-quotes-kpi-icon icon-amber">
                  <Clock size={20} />
                </div>
              </div>
              <div className="progress-quotes-kpi-body">
                <div className="progress-quotes-kpi-num">{kpiStats.dueSoon}</div>
                <div className="progress-quotes-kpi-label">Sắp đến hạn</div>
                <div className="progress-quotes-kpi-trend trend-amber">
                  <span>↑ 25%</span>
                </div>
              </div>
            </div>

            {/* Card 4: Chưa thiết lập SLA */}
            <div className="progress-quotes-kpi-card">
              <div className="progress-quotes-kpi-header">
                <div className="progress-quotes-kpi-icon icon-slate">
                  <FileCheck size={20} />
                </div>
              </div>
              <div className="progress-quotes-kpi-body">
                <div className="progress-quotes-kpi-num">{kpiStats.notSet}</div>
                <div className="progress-quotes-kpi-label">Chưa thiết lập SLA</div>
                <div className="progress-quotes-kpi-trend trend-neutral">
                  <span>—</span>
                </div>
              </div>
            </div>
          </div>

          {/* 12-Column Quotes & SLA Table */}
          <div className="progress-quotes-table-wrap">
            <table className="progress-quotes-table">
              <thead>
                <tr>
                  <th style={{ width: '28px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '85px' }}>Mã báo giá</th>
                  <th style={{ minWidth: '85px', maxWidth: '105px' }}>Khách hàng</th>
                  <th style={{ width: '55px' }}>Project</th>
                  <th style={{ width: '105px' }}>Presale</th>
                  <th style={{ width: '105px' }}>Sale</th>
                  <th style={{ width: '92px' }}>Bước hiện tại</th>
                  <th style={{ width: '75px' }}>Ở bước này</th>
                  <th style={{ width: '78px', textAlign: 'center' }}>SLA</th>
                  <th style={{ width: '82px', textAlign: 'right' }}>Giá trị</th>
                  <th style={{ width: '76px', textAlign: 'center' }}>Trạng thái</th>
                  <th style={{ width: '52px', textAlign: 'center' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {paginatedQuotes.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="progress-quotes-empty-cell">
                      Không tìm thấy báo giá nào phù hợp với bộ lọc.
                    </td>
                  </tr>
                ) : (
                  paginatedQuotes.map((quote, idx) => {
                    const globalIdx = (currentSafePage - 1) * pageSize + idx + 1;
                    const isSelected = selectedQuoteId === quote.quoteId;
                    const stageStyle = getStageStyle(quote.processingStageLabel);
                    const slaInfo = getSlaBadge(quote.sla?.status);

                    const presaleName = quote.technicalOwnerName || '—';
                    const presaleInitial = (presaleName !== '—' ? presaleName.trim().slice(0, 1) : '?').toUpperCase();
                    const presaleBg = presaleName !== '—' ? getAvatarColor(presaleName) : '#94a3b8';

                    const saleName = quote.quoteOwnerName || '—';
                    const saleInitial = (saleName !== '—' ? saleName.trim().slice(0, 1) : '?').toUpperCase();
                    const saleBg = saleName !== '—' ? getAvatarColor(saleName) : '#94a3b8';

                    const timeInStageStr = quote.timeInCurrentStage?.sinceAt
                      ? formatSinceDuration(quote.timeInCurrentStage.sinceAt)
                      : '—';

                    return (
                      <tr
                        key={quote.quoteId}
                        className={`progress-quote-tr${isSelected ? ' is-selected' : ''}`}
                        onClick={() => {
                          setSelectedQuoteId(quote.quoteId);
                          onOpenQuote(quote);
                        }}
                      >
                        <td style={{ textAlign: 'center', color: '#64748b' }}>{globalIdx}</td>
                        <td className="quote-number-cell">
                          <span className="quote-number-text">{quote.quoteNumber || quote.quoteId.slice(0, 8)}</span>
                        </td>
                        <td className="quote-customer-cell">
                          <span className="quote-customer-name" title={quote.customerName || ''}>
                            {quote.customerName || 'Khách lẻ'}
                          </span>
                        </td>
                        <td className="quote-project-cell" title={quote.projectName || ''}>
                          {quote.projectName || '—'}
                        </td>

                        {/* Presale Profile */}
                        <td>
                          <div className="quote-person-cell" title={`Presale: ${presaleName}`}>
                            <span className="quote-person-name">
                              {presaleName}
                            </span>
                          </div>
                        </td>

                        {/* Sale Profile */}
                        <td>
                          <div className="quote-person-cell" title={`Sale: ${saleName}`}>
                            <span className="quote-person-name">
                              {saleName}
                            </span>
                          </div>
                        </td>

                        {/* Bước hiện tại */}
                        <td>
                          <span
                            className="quote-stage-pill"
                            style={{
                              backgroundColor: stageStyle.bg,
                              color: stageStyle.color,
                            }}
                          >
                            {quote.processingStageLabel || 'Khởi tạo'}
                          </span>
                        </td>

                        {/* Ở bước này */}
                        <td className="quote-duration-cell">{timeInStageStr}</td>

                        {/* SLA status badge */}
                        <td style={{ textAlign: 'center' }}>
                          <span className={`quote-sla-pill ${slaInfo.className}`}>
                            {slaInfo.label}
                          </span>
                        </td>

                        {/* Giá trị */}
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                          {formatQuoteVND(quote.totalAmountVnd)}
                        </td>

                        {/* Trạng thái */}
                        <td style={{ textAlign: 'center' }}>
                          <span className="quote-status-badge">Đang xử lý</span>
                        </td>

                        {/* Thao tác */}
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <div className="quote-actions-cell" style={{ justifyContent: 'center' }}>
                            <button
                              type="button"
                              className="quote-action-btn"
                              title="Xem chi tiết báo giá"
                              onClick={() => onOpenQuote(quote)}
                            >
                              <Eye size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Toolbar */}
          <div className="progress-quotes-pagination">
            <div className="progress-pagination-info">
              Hiển thị {filteredQuotes.length > 0 ? (currentSafePage - 1) * pageSize + 1 : 0} -{' '}
              {Math.min(currentSafePage * pageSize, filteredQuotes.length)} trên {filteredQuotes.length} báo giá
            </div>

            <div className="progress-pagination-pages">
              <button
                type="button"
                className="progress-pagination-btn"
                disabled={currentSafePage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                aria-label="Trang trước"
              >
                <ChevronLeft size={16} />
              </button>

              {Array.from({ length: totalPages }).map((_, pIdx) => {
                const p = pIdx + 1;
                return (
                  <button
                    key={p}
                    type="button"
                    className={`progress-pagination-btn page-num-btn${p === currentSafePage ? ' active' : ''}`}
                    onClick={() => setCurrentPage(p)}
                  >
                    {p}
                  </button>
                );
              })}

              <button
                type="button"
                className="progress-pagination-btn"
                disabled={currentSafePage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                aria-label="Trang tiếp"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="progress-pagination-size">
              <select
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="progress-pagination-select"
              >
                <option value={10}>Hiển thị 10 / trang</option>
                <option value={20}>Hiển thị 20 / trang</option>
                <option value={50}>Hiển thị 50 / trang</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right Column (28%): Sidebar Analytics Widgets */}
        <aside className="progress-quotes-sidebar-col">
          {/* Widget 1: Tình trạng báo giá (Donut Chart) */}
          <div className="progress-sidebar-widget">
            <h3 className="progress-sidebar-title">Tình trạng báo giá</h3>
            <div className="progress-sidebar-donut-wrap">
              <ProgressDonut
                segments={donutSegments}
                centerLabel={String(kpiStats.total)}
                centerSubtext="Tổng số"
              />
            </div>
          </div>

          {/* Widget 2: Bước hiện tại (Horizontal Bar Chart) */}
          <div className="progress-sidebar-widget">
            <h3 className="progress-sidebar-title">Bước hiện tại</h3>
            <div className="progress-stage-bars-list">
              {stageStats.map(st => {
                const pct = Math.round((st.count / maxStageCount) * 100);
                return (
                  <div key={st.label} className="progress-stage-bar-item">
                    <div className="progress-stage-bar-meta">
                      <span className="progress-stage-bar-label">{st.label}</span>
                      <span className="progress-stage-bar-count">{st.count}</span>
                    </div>
                    <div className="progress-stage-bar-track">
                      <div
                        className="progress-stage-bar-fill"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: st.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Widget 3: Top Presale */}
          <div className="progress-sidebar-widget">
            <div className="progress-sidebar-widget-header">
              <h3 className="progress-sidebar-title">Top Presale</h3>
              <a href="#all-presale" className="progress-sidebar-link">
                <span>Xem tất cả</span>
                <ArrowRight size={13} />
              </a>
            </div>
            <div className="progress-top-ranking-list">
              {topPresales.map(p => {
                const initial = p.name.trim().slice(0, 1).toUpperCase();
                const bg = getAvatarColor(p.name);
                const pct = Math.round((p.count / maxPresaleCount) * 100);
                return (
                  <div key={p.name} className="progress-top-ranking-item">
                    <div className="progress-ranking-left">
                      <span className="progress-ranking-avatar" style={{ backgroundColor: bg }}>
                        {initial}
                      </span>
                      <span className="progress-ranking-name" title={p.name}>
                        {p.name}
                      </span>
                    </div>
                    <div className="progress-ranking-right">
                      <div className="progress-ranking-bar-track">
                        <div
                          className="progress-ranking-bar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="progress-ranking-val">{p.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Widget 4: Top Sale */}
          <div className="progress-sidebar-widget">
            <div className="progress-sidebar-widget-header">
              <h3 className="progress-sidebar-title">Top Sale</h3>
              <a href="#all-sale" className="progress-sidebar-link">
                <span>Xem tất cả</span>
                <ArrowRight size={13} />
              </a>
            </div>
            <div className="progress-top-ranking-list">
              {topSales.map(s => {
                const initial = s.name.trim().slice(0, 1).toUpperCase();
                const bg = getAvatarColor(s.name);
                const pct = Math.round((s.count / maxSaleCount) * 100);
                return (
                  <div key={s.name} className="progress-top-ranking-item">
                    <div className="progress-ranking-left">
                      <span className="progress-ranking-avatar" style={{ backgroundColor: bg }}>
                        {initial}
                      </span>
                      <span className="progress-ranking-name" title={s.name}>
                        {s.name}
                      </span>
                    </div>
                    <div className="progress-ranking-right">
                      <div className="progress-ranking-bar-track">
                        <div
                          className="progress-ranking-bar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="progress-ranking-val">{s.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
