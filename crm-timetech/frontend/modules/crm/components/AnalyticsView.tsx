'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppAuth } from '@/contexts/AppAuthContext';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  MessageCircle,
  RotateCcw,
  Tag,
  Trophy,
  Wallet,
} from './icons';
import { formatCompactVND, formatVND, hasFullCrmAccess } from '../constants/crmConfig';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { AnalyticsFilters, CrmAnalytics, CrmUserOption } from '../types';

const emptyAnalytics: CrmAnalytics = {
  totalDeals: 0,
  openDeals: 0,
  wonDeals: 0,
  winRate: 0,
  wonValue: 0,
  pipelineValue: 0,
  industryRows: [],
  regionRows: [],
  categoryRows: [],
  marketingTips: [],
  executiveNotes: [],
  topIndustry: 'Chưa đủ dữ liệu',
  topRegion: 'Chưa đủ dữ liệu',
  topCategory: 'Chưa đủ dữ liệu',
};

export function AnalyticsView() {
  const { user } = useAppAuth();
  // Theo yeu cau Mylife (22/07): Phan tich CRM chi danh cho leader/admin -
  // member chi thay pipeline ban hang (trang /all-platform/crm), khong thay
  // duoc so lieu tong hop toan team/cong ty o day. Mo rong cho Sale
  // (team_type='sale', migration 049) - phai khop voi CrmAnalyticsGuard,
  // neu khong Sale se bi guard cho vao roi lai bi chan oan o day.
  const canView = hasFullCrmAccess(user);

  const [analytics, setAnalytics] = useState<CrmAnalytics>(emptyAnalytics);
  const [agents, setAgents] = useState<CrmUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AnalyticsFilters>({ period: 'all' });
  const [openFilter, setOpenFilter] = useState('');

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    Promise.all([
      seedingCrmRepository.getAnalytics(filters),
      seedingCrmRepository.getAgents(),
    ])
      .then(([nextAnalytics, nextAgents]) => {
        if (!alive) return;
        setAnalytics(nextAnalytics);
        setAgents(nextAgents);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filters, canView]);

  const filterOptions = useMemo(
    () => ({
      period: [
        { value: 'all', label: 'Thời gian: Tất cả' },
        { value: 'month', label: 'Thời gian: Tháng này' },
        { value: 'quarter', label: 'Thời gian: Quý này' },
      ],
      industry: [
        { value: '', label: 'Tất cả ngành' },
        ...analytics.industryRows.map(row => ({ value: row.label, label: row.label })),
      ],
      city: [
        { value: '', label: 'Tất cả khu vực' },
        ...analytics.regionRows.map(row => ({ value: row.label, label: row.label })),
      ],
      source: [
        { value: '', label: 'Tất cả nguồn lead' },
        { value: 'Manual', label: 'Manual' },
        { value: 'FB_Inbox', label: 'FB Inbox' },
        { value: 'FB_Group', label: 'FB Group' },
        { value: 'Zalo', label: 'Zalo' },
        { value: 'Website', label: 'Website' },
        { value: 'Referral', label: 'Referral' },
        { value: 'MarkeeChat', label: 'MarkeeChat' },
      ],
      owner: [
        { value: '', label: 'Tất cả owner' },
        ...agents.map(agent => ({ value: agent.id, label: agent.name })),
      ],
    }),
    [agents, analytics.industryRows, analytics.regionRows]
  );

  function filterLabel(key: keyof typeof filterOptions) {
    const value = filters[key as keyof AnalyticsFilters] || '';
    return filterOptions[key].find(option => option.value === value)?.label || filterOptions[key][0].label;
  }

  function setFilter(key: keyof AnalyticsFilters, value: string) {
    setFilters(current => ({ ...current, [key]: value }));
    setOpenFilter('');
  }

  const kpis = [
    { key: 'total', label: 'Tổng Deal', value: analytics.totalDeals, icon: Building2, tone: 'slate' },
    { key: 'open', label: 'Đang mở', value: analytics.openDeals, icon: Tag, tone: 'blue' },
    { key: 'won', label: 'Won', value: analytics.wonDeals, icon: Trophy, tone: 'green' },
    { key: 'win-rate', label: 'Tỷ lệ Win', value: `${analytics.winRate}%`, icon: CheckCircle2, tone: 'teal' },
    {
      key: 'won-value',
      label: 'Giá trị Win',
      value: formatCompactVND(analytics.wonValue),
      fullValue: formatVND(analytics.wonValue) || '0 đ',
      icon: Wallet,
      tone: 'amber',
    },
    {
      key: 'pipeline',
      label: 'Pipeline',
      value: formatCompactVND(analytics.pipelineValue),
      fullValue: formatVND(analytics.pipelineValue) || '0 đ',
      icon: MessageCircle,
      tone: 'violet',
    },
  ];

  if (!canView) {
    return (
      <div className="crm-analytics-shell">
        <section className="crm-analytics-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <AlertTriangle className="crm-button-icon" />
          <div>
            <p style={{ fontWeight: 700 }}>Không có quyền truy cập</p>
            <p>Phân tích CRM chỉ dành cho leader/admin. Bạn có thể xem và làm việc trên pipeline bán hàng.</p>
          </div>
          <Link href="/all-platform/crm" className="crm-back-button">
            <ArrowLeft className="crm-button-icon" /> Quay về CRM
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="crm-analytics-shell">
      <section className="crm-analytics-header">
        <div>
          <p>Theo dõi KPI, doanh thu theo ngành/khu vực và insight giúp Marketing chạy chiến dịch đúng tệp khách hàng.</p>
        </div>
        <Link href="/all-platform/crm" className="crm-back-button">
          <ArrowLeft className="crm-button-icon" /> Quay về CRM
        </Link>
      </section>

      <section className="crm-analytics-filters">
        {(['period', 'industry', 'city', 'source', 'owner'] as const).map(key => (
          <div key={key} className="crm-analytics-filter-select">
            <button
              type="button"
              className={`crm-analytics-filter-button ${openFilter === key ? 'is-open' : ''}`}
              onClick={() => setOpenFilter(openFilter === key ? '' : key)}
            >
              {key === 'period' ? <CalendarDays className="crm-filter-icon" /> : null}
              <span>{filterLabel(key)}</span>
            </button>
            {openFilter === key ? (
              <div className="crm-analytics-filter-menu">
                {filterOptions[key].map(option => (
                  <button
                    key={`${key}-${option.value}`}
                    type="button"
                    className={`crm-analytics-filter-option ${filters[key] === option.value ? 'is-selected' : ''}`}
                    onClick={() => setFilter(key, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <button type="button" onClick={() => setFilters({ period: 'all' })}>
          <RotateCcw className="crm-filter-icon" />
          Xóa lọc
        </button>
      </section>

      {loading ? <div className="crm-analytics-loading">Đang tải dữ liệu...</div> : null}

      {!loading ? (
        <>
          <section className="crm-kpi-grid">
            {kpis.map(kpi => {
              const Icon = kpi.icon;
              return (
                <article key={kpi.key} className={`crm-kpi-card crm-kpi-card--${kpi.tone}`} title={String(kpi.fullValue || kpi.value)}>
                  <span className="crm-kpi-icon"><Icon /></span>
                  <div>
                    <p>{kpi.label}</p>
                    <strong>{kpi.value}</strong>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="crm-analytics-main-grid">
            <article className="crm-analytics-card">
              <header>
                <h2>Doanh thu theo ngành</h2>
                <span>Doanh thu</span>
                <span>Tỷ trọng</span>
              </header>
              <div className="crm-revenue-list">
                {analytics.industryRows.map(row => (
                  <div key={row.label} className="crm-revenue-row">
                    <b>{row.label}</b>
                    <span className="crm-revenue-bar"><i style={{ width: `${row.percent}%`, backgroundColor: row.color }} /></span>
                    <strong>{formatVND(row.value)}</strong>
                    <em style={{ color: row.color }}>{row.percent}%</em>
                  </div>
                ))}
              </div>
              {!analytics.industryRows.length ? <p className="crm-empty-note">Chưa có doanh thu theo ngành.</p> : null}
              <div className="crm-insight-strip">Ngành <b>{analytics.topIndustry}</b> đang đóng góp doanh thu lớn nhất.</div>
            </article>

            <article className="crm-analytics-card">
              <header>
                <h2>Doanh thu theo khu vực</h2>
                <span>Doanh thu</span>
                <span>Tỷ trọng</span>
              </header>
              <div className="crm-region-layout">
                <div className="crm-donut" style={{ '--donut-color': analytics.regionRows[0]?.color || '#22c55e' } as React.CSSProperties}>
                  <span title={formatVND(analytics.wonValue) || '0 đ'}>{formatCompactVND(analytics.wonValue)}</span>
                </div>
                <div className="crm-region-list">
                  {analytics.regionRows.map(row => (
                    <div key={row.label}>
                      <span style={{ backgroundColor: row.color }} />
                      <b>{row.label}</b>
                      <strong>{formatVND(row.value)}</strong>
                      <em style={{ color: row.color }}>{row.percent}%</em>
                    </div>
                  ))}
                </div>
              </div>
              <div className="crm-insight-strip crm-insight-strip--blue"><b>{analytics.topRegion}</b> là khu vực đem doanh thu tốt nhất.</div>
            </article>
          </section>

          <section className="crm-bottom-grid">
            <article className="crm-analytics-card crm-growth-card">
              <h2>Nguồn tăng trưởng</h2>
              <div><span>Top ngành</span><b>{analytics.topIndustry}</b></div>
              <div><span>Top khu vực</span><b>{analytics.topRegion}</b></div>
              <div><span>Top danh mục</span><b>{analytics.topCategory}</b></div>
            </article>
            <article className="crm-analytics-card crm-tip-card">
              <h2>Gợi ý cho Marketing</h2>
              {analytics.marketingTips.map(tip => <p key={tip}>{tip}</p>)}
            </article>
            <article className="crm-analytics-card crm-tip-card crm-tip-card--blue">
              <h2>Góc nhìn CEO / CFO</h2>
              {analytics.executiveNotes.map(note => <p key={note}>{note}</p>)}
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
