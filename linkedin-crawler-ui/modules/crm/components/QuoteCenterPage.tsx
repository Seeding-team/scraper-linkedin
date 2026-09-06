'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { teamsService, type TeamRow } from '@/services/all-platform.service';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote, QuoteForm } from '@/modules/quotes';
import { useCrm } from '../hooks/useCrm';
import { canApproveQuote } from '../constants/crmConfig';
import type { Deal } from '../types';
import { CreateQuoteModal } from '../integrations/quotes';
import { FileText, MessageCircle, Plus, Wallet } from './icons';
import { SearchableSelect } from './SearchableSelect';
import '../styles/quote-center.css';

type RoleScope = 'ceo' | 'lead' | 'personal';
type Period = 'all' | 'month' | 'quarter' | 'year';
type QuoteStatusFilter = 'all' | 'draft' | 'sent' | 'won' | 'lost';

const TEMPLATE_ICON_CLASSES = ['qc-icon-blue', 'qc-icon-rose', 'qc-icon-green'];

function formatMoney(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(
    value || 0
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

function relativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Hôm qua';
  if (diffDay < 7) return `${diffDay} ngày trước`;
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function matchesPeriod(dateStr: string | undefined, period: Period): boolean {
  if (period === 'all') return true;
  const date = new Date(dateStr || '');
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (period === 'quarter') {
    return date.getFullYear() === now.getFullYear() && Math.floor(date.getMonth() / 3) === Math.floor(now.getMonth() / 3);
  }
  return date.getFullYear() === now.getFullYear();
}

function isWonDeal(deal?: Deal): boolean {
  return deal?.stage === 'won' || deal?.crmStatus === 'won';
}
function isLostDeal(deal?: Deal): boolean {
  return deal?.stage === 'lost' || deal?.crmStatus === 'lost';
}
function isSentQuote(quote: Quote): boolean {
  return quote.status === 'approved' || quote.status === 'confirmed';
}

/** Trạng thái hiển thị của 1 báo giá — suy từ status thật của quote + stage
 * thật của deal liên kết, không có khái niệm "Đã xem"/"Đàm phán" (không có
 * dữ liệu nguồn cho các trạng thái đó trong hệ thống). */
function quoteDisplayStatus(quote: Quote, deal?: Deal): { key: QuoteStatusFilter; label: string; className: string } {
  if (isWonDeal(deal)) return { key: 'won', label: 'Đã chốt', className: 'qc-badge-green' };
  if (isLostDeal(deal) || quote.status === 'cancelled') return { key: 'lost', label: 'Thất bại', className: 'qc-badge-rose' };
  if (isSentQuote(quote)) return { key: 'sent', label: 'Đã gửi', className: 'qc-badge-blue' };
  return { key: 'draft', label: 'Bản nháp', className: 'qc-badge-amber' };
}

interface SaleRow {
  key: string;
  name: string;
  dealIds: Set<string>;
  quotes: number;
  sent: number;
  won: number;
  value: number;
  wonValue: number;
}

const QUOTE_ROW_LIMIT = 10;

export function QuoteCenterPage() {
  const { user } = useAppAuth();
  const { deals, agents, loading: dealsLoading } = useCrm();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [forms, setForms] = useState<QuoteForm[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);

  const isAdmin = user?.role === 'admin';
  const isLeader = user?.role === 'leader';
  const [roleScope, setRoleScope] = useState<RoleScope>(isAdmin ? 'ceo' : isLeader ? 'lead' : 'personal');
  const [period, setPeriod] = useState<Period>('all');
  const [teamFilter, setTeamFilter] = useState('');

  const [quoteModal, setQuoteModal] = useState<{ open: boolean; deal: Deal | null; quoteFormId?: string; editQuote?: Quote | null }>({
    open: false,
    deal: null,
  });
  const [dealPickerOpen, setDealPickerOpen] = useState(false);
  const [dealSearch, setDealSearch] = useState('');

  const [listSearch, setListSearch] = useState('');
  const [listStatus, setListStatus] = useState<QuoteStatusFilter>('all');
  const linkedQuotesSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    void seedingQuoteRepository.getQuotes().then(rows => {
      if (alive) setQuotes(rows);
    }).finally(() => alive && setQuotesLoading(false));
    void seedingQuoteRepository.getForms().then(rows => {
      if (alive) setForms(rows);
    });
    void teamsService.getAll().then(res => {
      if (alive && res.success && res.data) setTeams(res.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const dealsById = useMemo(() => new Map(deals.map(deal => [deal.id, deal])), [deals]);

  function dealInRoleScope(deal: Deal | undefined, quote?: Quote): boolean {
    if (roleScope === 'ceo') return true;
    if (roleScope === 'lead') return deal?.assignment.leadedById === user?.id;
    if (deal) return deal.assignment.sdrId === user?.id || deal.assignment.leadedById === user?.id;
    return quote?.createdById === user?.id;
  }
  function dealInTeamScope(deal?: Deal): boolean {
    if (!teamFilter) return true;
    return deal?.teamId === teamFilter;
  }

  const scopedDeals = useMemo(
    () => deals.filter(deal => dealInRoleScope(deal) && dealInTeamScope(deal) && matchesPeriod(deal.createdAt, period)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, roleScope, teamFilter, period, user?.id]
  );

  const scopedQuotes = useMemo(() => {
    return quotes.filter(quote => {
      const deal = quote.dealId ? dealsById.get(quote.dealId) : undefined;
      if (!dealInRoleScope(deal, quote)) return false;
      if (deal ? !dealInTeamScope(deal) : Boolean(teamFilter)) return false;
      if (!matchesPeriod(quote.issuedAt || quote.createdAt, period)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, dealsById, roleScope, teamFilter, period, user?.id]);

  const kpis = useMemo(() => {
    const quotedDealIds = new Set(scopedQuotes.filter(q => q.dealId).map(q => q.dealId as string));
    const sent = scopedQuotes.filter(isSentQuote).length;
    const won = scopedQuotes.filter(q => isWonDeal(q.dealId ? dealsById.get(q.dealId) : undefined)).length;
    const totalValue = scopedQuotes.reduce((sum, q) => sum + (q.totalAmount || 0), 0);
    const wonValue = scopedQuotes
      .filter(q => isWonDeal(q.dealId ? dealsById.get(q.dealId) : undefined))
      .reduce((sum, q) => sum + (q.totalAmount || 0), 0);
    return {
      totalDeals: scopedDeals.length,
      quotedCustomers: quotedDealIds.size,
      totalQuotes: scopedQuotes.length,
      sent,
      won,
      conversionRate: scopedQuotes.length ? Math.round((won / scopedQuotes.length) * 1000) / 10 : 0,
      totalValue,
      wonValue,
    };
  }, [scopedQuotes, scopedDeals, dealsById]);

  const funnel = useMemo(() => {
    const base = kpis.totalQuotes || 1;
    return [
      { label: 'Tạo báo giá', count: kpis.totalQuotes },
      { label: 'Đã gửi', count: kpis.sent },
      { label: 'Đã chốt', count: kpis.won },
    ].map(step => ({ ...step, percent: Math.round((step.count / base) * 100) }));
  }, [kpis]);

  const saleRows = useMemo(() => {
    const map = new Map<string, SaleRow>();
    for (const quote of scopedQuotes) {
      const deal = quote.dealId ? dealsById.get(quote.dealId) : undefined;
      const key = deal?.assignment.sdrId || deal?.assignment.leadedById || 'unassigned';
      const name = deal?.assignment.sdrName || deal?.assignment.leadName || 'Chưa gán';
      let row = map.get(key);
      if (!row) {
        row = { key, name, dealIds: new Set(), quotes: 0, sent: 0, won: 0, value: 0, wonValue: 0 };
        map.set(key, row);
      }
      if (deal) row.dealIds.add(deal.id);
      row.quotes += 1;
      if (isSentQuote(quote)) row.sent += 1;
      row.value += quote.totalAmount || 0;
      if (isWonDeal(deal)) {
        row.won += 1;
        row.wonValue += quote.totalAmount || 0;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [scopedQuotes, dealsById]);

  // Bảng "Báo giá" — hiện TẤT CẢ báo giá trong phạm vi đang chọn, kể cả báo
  // giá đứng độc lập chưa gắn deal CRM nào (trước đây bị ẩn hoàn toàn khỏi
  // trang này, khiến báo giá tạo ra "biến mất" không thấy ở đâu). Báo giá có
  // deal thật thì hiện tên khách/Sale từ Deal, không thì hiện "Chưa gắn CRM".
  const linkedQuoteRows = useMemo(() => {
    const term = listSearch.trim().toLowerCase();
    return scopedQuotes
      .map(quote => {
        const deal = quote.dealId ? dealsById.get(quote.dealId) : undefined;
        return { quote, deal, status: quoteDisplayStatus(quote, deal) };
      })
      .filter(row => (listStatus === 'all' ? true : row.status.key === listStatus))
      .filter(row => {
        if (!term) return true;
        const haystack = `${row.quote.quoteNumber} ${row.deal?.customerName || ''} ${row.deal?.companyName || ''} ${row.deal?.dealId || ''}`.toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => new Date(b.quote.updatedAt || b.quote.createdAt).getTime() - new Date(a.quote.updatedAt || a.quote.createdAt).getTime());
  }, [scopedQuotes, dealsById, listSearch, listStatus]);

  const filteredDealsForPicker = useMemo(() => {
    const term = dealSearch.trim().toLowerCase();
    if (!term) return deals.slice(0, 30);
    return deals
      .filter(
        deal =>
          deal.customerName.toLowerCase().includes(term) || (deal.companyName || '').toLowerCase().includes(term)
      )
      .slice(0, 30);
  }, [deals, dealSearch]);

  function openFreshModal() {
    setQuoteModal({ open: true, deal: null });
  }
  function openTemplateModal(form: QuoteForm) {
    setQuoteModal({ open: true, deal: null, quoteFormId: form.id });
  }
  function pickDealAndOpen(deal: Deal) {
    setDealPickerOpen(false);
    setDealSearch('');
    setQuoteModal({ open: true, deal });
  }

  async function createVersion(quote: Quote) {
    try {
      const result = await seedingQuoteRepository.createQuoteVersion(quote.id);
      if (result.redirectedFromClickedQuote) {
        window.alert(`Chuỗi báo giá đã có bản duyệt mới hơn (V${result.sourceVersionNumber}) — đã tạo phiên bản mới từ bản đó.`);
      } else if (!result.created) {
        window.alert('Chuỗi này đã có bản nháp sẵn — mở bản nháp đó.');
      }
      const rows = await seedingQuoteRepository.getQuotes();
      setQuotes(rows);
      // Bang "Danh sach bao gia" nam khuat ben duoi trang (sau KPI/quick-start/
      // templates) - bao gia moi tao luon o dong dau bang (sort theo updatedAt
      // desc) nhung nguoi dung khong thay ngay vi vi tri cuon trang khong doi -
      // tu cuon xuong dung bang de lo dong moi ra thay vi bat tim thu cong.
      linkedQuotesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const deal = result.quote.dealId ? dealsById.get(result.quote.dealId) : null;
      setQuoteModal({ open: true, deal: deal || null, editQuote: result.quote });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tạo được phiên bản báo giá mới.');
    }
  }

  const loading = dealsLoading || quotesLoading;

  return (
    <div className="qc-page">
      <header className="qc-header">
        <div>
          <h1>Trung tâm báo giá</h1>
          <p>Tạo, gửi và theo dõi báo giá liên kết trực tiếp với CRM</p>
        </div>
        <div className="qc-header-actions">
          <button type="button" className="qc-btn" disabled title="Chưa hỗ trợ — sẽ có ở giai đoạn sau">
            Nhập báo giá
          </button>
          <button type="button" className="qc-btn qc-btn-primary" onClick={openFreshModal}>
            <Plus className="qc-icon" /> Tạo báo giá
          </button>
        </div>
      </header>

      <section className="qc-insights">
        <div className="qc-section-head">
          <div>
            <h2>Hiệu suất báo giá &amp; CRM</h2>
            <p>KPI tính trực tiếp từ báo giá đã liên kết khách hàng và cơ hội CRM</p>
          </div>
          <div className="qc-controls">
            <div className="qc-role-switch">
              {isAdmin ? (
                <button type="button" className={roleScope === 'ceo' ? 'active' : ''} onClick={() => setRoleScope('ceo')}>
                  CEO
                </button>
              ) : null}
              {isAdmin || isLeader ? (
                <button type="button" className={roleScope === 'lead' ? 'active' : ''} onClick={() => setRoleScope('lead')}>
                  Lead Sale
                </button>
              ) : null}
              <button type="button" className={roleScope === 'personal' ? 'active' : ''} onClick={() => setRoleScope('personal')}>
                Cá nhân
              </button>
            </div>
            <select value={period} onChange={event => setPeriod(event.target.value as Period)}>
              <option value="month">Tháng này</option>
              <option value="quarter">Quý này</option>
              <option value="year">Năm nay</option>
              <option value="all">Tất cả thời gian</option>
            </select>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={teamFilter}
                onChange={setTeamFilter}
                placeholder="Tất cả team"
                options={teams.map(team => ({ value: team.id, label: team.name_team }))}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="qc-state">Đang tải dữ liệu...</div>
        ) : (
          <>
            <div className="qc-metrics">
              <MetricCard tone="rose" label="Tổng khách hàng CRM" value={String(kpis.totalDeals)} />
              <MetricCard tone="blue" label="Khách hàng được báo giá" value={String(kpis.quotedCustomers)} />
              <MetricCard tone="blue" label="Tổng số báo giá" value={String(kpis.totalQuotes)} />
              <MetricCard tone="amber" label="Báo giá đã gửi" value={String(kpis.sent)} />
              <MetricCard tone="green" label="Báo giá thành công" value={String(kpis.won)} />
              <MetricCard tone="green" label="Tỷ lệ chuyển đổi" value={`${kpis.conversionRate}%`} />
              <MetricCard tone="rose" label="Tổng giá trị báo giá" value={formatMoney(kpis.totalValue)} big />
              <MetricCard tone="green" label="Giá trị đã chốt" value={formatMoney(kpis.wonValue)} big />
            </div>

            <div className="qc-insight-grid">
              <article className="qc-insight-card">
                <h3>Phễu chuyển đổi báo giá</h3>
                <p>Từ khâu tạo báo giá đến khi chốt thành hợp đồng</p>
                <div className="qc-funnel">
                  {funnel.map(step => (
                    <div className="qc-funnel-item" key={step.label}>
                      <span>{step.label}</span>
                      <div className="qc-funnel-track">
                        <i style={{ width: `${step.percent}%` }} />
                      </div>
                      <b>
                        {step.count} · {step.percent}%
                      </b>
                    </div>
                  ))}
                </div>
              </article>

              <article className="qc-insight-card">
                <h3>Hiệu suất theo Sale</h3>
                <p>So sánh số khách hàng, số báo giá, giá trị và tỷ lệ chuyển đổi</p>
                <div className="qc-table-wrap">
                  <table className="qc-team-table">
                    <thead>
                      <tr>
                        <th>Sale</th>
                        <th>KH đã BG</th>
                        <th>Báo giá</th>
                        <th>Đã gửi</th>
                        <th>Đã chốt</th>
                        <th>Tỷ lệ chốt</th>
                        <th>Giá trị BG</th>
                        <th>Giá trị chốt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="qc-empty">
                            Chưa có dữ liệu trong phạm vi đang chọn.
                          </td>
                        </tr>
                      ) : (
                        saleRows.map(row => (
                          <tr key={row.key}>
                            <td data-label="Sale">
                              <div className="qc-sale-cell">
                                <span className="qc-avatar">{initialsOf(row.name)}</span>
                                <strong>{row.name}</strong>
                              </div>
                            </td>
                            <td data-label="KH đã BG">{row.dealIds.size}</td>
                            <td data-label="Báo giá">{row.quotes}</td>
                            <td data-label="Đã gửi">{row.sent}</td>
                            <td data-label="Đã chốt">{row.won}</td>
                            <td data-label="Tỷ lệ chốt">{row.quotes ? Math.round((row.won / row.quotes) * 1000) / 10 : 0}%</td>
                            <td data-label="Giá trị BG">{formatMoney(row.value)}</td>
                            <td data-label="Giá trị chốt">{formatMoney(row.wonValue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </>
        )}
      </section>

      <section className="qc-quick">
        <div>
          <span className="qc-eyebrow">TẠO NHANH TRONG 60 GIÂY</span>
          <h2>Bắt đầu báo giá mới</h2>
          <p>Chọn khách hàng và mẫu có sẵn, hệ thống sẽ tự điền dịch vụ, giá bán, thuế và điều khoản.</p>
          <div className="qc-quick-buttons">
            <button type="button" className="qc-btn qc-btn-primary" onClick={openFreshModal}>
              <Plus className="qc-icon" /> Tạo báo giá nhanh
            </button>
            <button type="button" className="qc-btn qc-btn-soft" onClick={() => setDealPickerOpen(true)}>
              Tạo từ cơ hội CRM →
            </button>
          </div>
        </div>
        <div className="qc-quick-steps">
          <div className="qc-quick-step">
            <b>1</b>
            <span>
              <strong>Khách hàng</strong>
              <small>Chọn từ CRM</small>
            </span>
          </div>
          <i />
          <div className="qc-quick-step">
            <b>2</b>
            <span>
              <strong>Dịch vụ</strong>
              <small>Từ mẫu báo giá</small>
            </span>
          </div>
          <i />
          <div className="qc-quick-step">
            <b>3</b>
            <span>
              <strong>Gửi khách</strong>
              <small>Link báo giá</small>
            </span>
          </div>
        </div>
      </section>

      <section className="qc-section">
        <div className="qc-section-head">
          <div>
            <h2>Mẫu dùng nhanh</h2>
            <p>Tạo báo giá từ mẫu đã chuẩn hoá</p>
          </div>
          <Link href="/all-platform/quotes" className="qc-link">
            Quản lý mẫu →
          </Link>
        </div>
        {forms.length === 0 ? (
          <div className="qc-state">Chưa có mẫu báo giá đang hoạt động.</div>
        ) : (
          <div className="qc-templates">
            {forms.map((form, index) => (
              <article key={form.id} className="qc-template" onClick={() => openTemplateModal(form)}>
                <div className="qc-template-top">
                  <div className={`qc-template-icon ${TEMPLATE_ICON_CLASSES[index % TEMPLATE_ICON_CLASSES.length]}`}>
                    {index % 3 === 2 ? <MessageCircle className="qc-icon" /> : <FileText className="qc-icon" />}
                  </div>
                  <div className="qc-template-body">
                    <h3 title={form.name}>{form.name}</h3>
                    <p>{form.description || 'Mẫu báo giá chuẩn hoá'}</p>
                  </div>
                </div>
                <span className="qc-template-fieldcount">{form.fieldCount} trường dữ liệu</span>
                <button
                  type="button"
                  className="qc-template-cta"
                  onClick={event => {
                    event.stopPropagation();
                    openTemplateModal(form);
                  }}
                >
                  Tạo báo giá
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="qc-section qc-linked-quotes" ref={linkedQuotesSectionRef}>
        <div className="qc-section-head">
          <div>
            <h2>Danh sách báo giá</h2>
            <p>Toàn bộ báo giá trong phạm vi đang chọn — kèm khách hàng, cơ hội CRM và Sale phụ trách (nếu đã gắn)</p>
          </div>
          <div className="qc-list-tools">
            <input
              placeholder="Tìm mã, khách hàng, cơ hội..."
              value={listSearch}
              onChange={event => setListSearch(event.target.value)}
            />
            <select value={listStatus} onChange={event => setListStatus(event.target.value as QuoteStatusFilter)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="draft">Bản nháp</option>
              <option value="sent">Đã gửi</option>
              <option value="won">Đã chốt</option>
              <option value="lost">Thất bại</option>
            </select>
            <Link href="/all-platform/quote-history" className="qc-btn">
              Xem tất cả →
            </Link>
          </div>
        </div>

        <div className="qc-table-wrap">
          <table className="qc-linked-table">
            <thead>
              <tr>
                <th>Mã báo giá</th>
                <th>Khách hàng CRM</th>
                <th>Cơ hội CRM</th>
                <th>Giá trị</th>
                <th>Phụ trách</th>
                <th>Trạng thái</th>
                <th>Phiên bản</th>
                <th>Cập nhật</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {linkedQuoteRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="qc-empty">
                    Chưa có báo giá nào trong phạm vi đang chọn.
                  </td>
                </tr>
              ) : (
                linkedQuoteRows.slice(0, QUOTE_ROW_LIMIT).map(({ quote, deal, status }) => {
                  const saleName = deal?.assignment.sdrName || deal?.assignment.leadName || 'Chưa gán';
                  return (
                    <tr key={quote.id}>
                      <td data-label="Mã báo giá" title={quote.quoteNumber}>
                        <Link href={`/all-platform/quotes/${quote.id}`} className="qc-row-link">
                          {quote.quoteNumber}
                        </Link>
                      </td>
                      <td data-label="Khách hàng CRM">
                        {deal ? (
                          <>
                            <Link href={`/all-platform/crm?openDeal=${deal.id}`} className="qc-row-link">
                              {deal.customerName}
                            </Link>
                            {deal.companyName ? <div className="qc-row-sub">{deal.companyName}</div> : null}
                          </>
                        ) : (
                          <span className="qc-row-sub">Chưa gắn CRM</span>
                        )}
                      </td>
                      <td data-label="Cơ hội CRM">
                        {deal ? (
                          <>
                            <Link href={`/all-platform/crm?openDeal=${deal.id}`} className="qc-row-link">
                              {deal.servicePackage || deal.package || 'Cơ hội CRM'}
                            </Link>
                            <div className="qc-row-sub">{deal.dealId}</div>
                          </>
                        ) : (
                          <span className="qc-row-sub">—</span>
                        )}
                      </td>
                      <td data-label="Giá trị">{formatMoney(quote.totalAmount)}</td>
                      <td data-label="Phụ trách">
                        <div className="qc-sale-cell">
                          <span className="qc-avatar qc-avatar-sm">{initialsOf(saleName)}</span>
                          {saleName}
                        </div>
                      </td>
                      <td data-label="Trạng thái">
                        <span className={`qc-badge ${status.className}`}>{status.label}</span>
                      </td>
                      <td data-label="Phiên bản">
                        <span className="qc-badge qc-badge-version" title={quote.parentQuoteId ? `Từ phiên bản trước (${quote.parentQuoteId})` : 'Phiên bản gốc'}>
                          V{quote.versionNumber || 1}
                        </span>
                      </td>
                      <td data-label="Cập nhật">{relativeTime(quote.updatedAt || quote.createdAt)}</td>
                      <td data-label="">
                        <div className="qc-row-actions-cell">
                          <Link href={`/all-platform/quotes/${quote.id}`} className="qc-row-action" aria-label="Mở báo giá">
                            →
                          </Link>
                          {quote.status === 'approved' ? (
                            <button
                              type="button"
                              className="qc-row-version-btn"
                              title="Tạo phiên bản mới từ báo giá đã duyệt này"
                              onClick={() => void createVersion(quote)}
                            >
                              + Phiên bản mới
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {linkedQuoteRows.length > QUOTE_ROW_LIMIT ? (
          <div className="qc-list-footnote">
            Hiển thị {QUOTE_ROW_LIMIT}/{linkedQuoteRows.length} báo giá gần nhất — bấm "Xem tất cả" để xem đầy đủ.
          </div>
        ) : null}
      </section>

      {dealPickerOpen ? (
        <div className="qc-modal-backdrop" onClick={() => setDealPickerOpen(false)}>
          <div className="qc-deal-picker" onClick={event => event.stopPropagation()}>
            <h3>Chọn cơ hội CRM</h3>
            <input
              autoFocus
              placeholder="Tìm theo tên khách hàng hoặc công ty..."
              value={dealSearch}
              onChange={event => setDealSearch(event.target.value)}
            />
            <div className="qc-deal-picker-list">
              {filteredDealsForPicker.length === 0 ? (
                <div className="qc-empty">Không tìm thấy cơ hội phù hợp.</div>
              ) : (
                filteredDealsForPicker.map(deal => (
                  <button type="button" key={deal.id} className="qc-deal-picker-item" onClick={() => pickDealAndOpen(deal)}>
                    <strong>{deal.customerName}</strong>
                    <span>{deal.companyName || 'Chưa có công ty'}</span>
                  </button>
                ))
              )}
            </div>
            <div className="qc-deal-picker-foot">
              <button type="button" className="qc-btn" onClick={() => setDealPickerOpen(false)}>
                Hủy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CreateQuoteModal
        open={quoteModal.open}
        deals={deals}
        agents={agents}
        initialDeal={quoteModal.deal}
        editQuote={quoteModal.editQuote}
        initialQuoteFormId={quoteModal.quoteFormId}
        canApproveQuotes={canApproveQuote(user)}
        onClose={() => setQuoteModal({ open: false, deal: null })}
        onCreated={async () => {
          const rows = await seedingQuoteRepository.getQuotes();
          setQuotes(rows);
        }}
        onUpdated={async () => {
          const rows = await seedingQuoteRepository.getQuotes();
          setQuotes(rows);
        }}
      />
    </div>
  );
}

function MetricCard({ label, value, tone, big }: { label: string; value: string; tone: 'rose' | 'blue' | 'green' | 'amber'; big?: boolean }) {
  return (
    <div className="qc-metric">
      <span className={`qc-metric-dot qc-metric-dot-${tone}`} />
      <span className="qc-metric-label">{label}</span>
      <strong className={big ? 'qc-metric-value-lg' : ''}>{value}</strong>
    </div>
  );
}
