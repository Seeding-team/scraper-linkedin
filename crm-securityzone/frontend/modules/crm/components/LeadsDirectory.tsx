'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { useMembers } from '@/hooks/useMembers';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { LeadFormDrawer } from './LeadFormDrawer';
import { LeadDetailDrawer } from './LeadDetailDrawer';
import { LeadEditDrawer } from './LeadEditDrawer';
import { SearchableSelect } from './SearchableSelect';
import { useCrmCategoryCodeOptions } from './CrmCategorySelect';
import { Loader2, Plus, RotateCcw } from './icons';
import type { CrmLeadKpi, CrmLeadRow, CrmLeadStatus } from '../types';

const STATUS_OPTIONS: Array<{ value: CrmLeadStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'mql', label: 'MQL' },
  { value: 'sql', label: 'SQL' },
  { value: 'nurturing', label: 'Nuôi dưỡng' },
  { value: 'unqualified', label: 'Không đạt chuẩn' },
];

export const LEAD_STATUS_LABEL: Record<string, string> = {
  mql: 'MQL',
  sql: 'SQL',
  nurturing: 'Nuôi dưỡng',
  unqualified: 'Không đạt chuẩn',
  new_lead: 'MQL',
  qualifying: 'MQL',
  qualified: 'SQL',
  nurture: 'Nuôi dưỡng',
  converted: 'SQL',
  disqualified: 'Không đạt chuẩn',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  mql: 'crm-lead-status--new',
  sql: 'crm-lead-status--qualified',
  nurturing: 'crm-lead-status--nurture',
  unqualified: 'crm-lead-status--disqualified',
  new_lead: 'crm-lead-status--new',
  qualifying: 'crm-lead-status--qualifying',
  qualified: 'crm-lead-status--qualified',
  nurture: 'crm-lead-status--nurture',
  converted: 'crm-lead-status--converted',
  disqualified: 'crm-lead-status--disqualified',
};

const PAGE_SIZE = 20;

type ApiLeadRow = {
  id: string;
  lead_name?: string | null;
  company_name?: string | null;
  position?: string | null;
  position_category_id?: string | null;
  position_label_snapshot?: string | null;
  phone?: string | null;
  email?: string | null;
  zalo?: string | null;
  facebook?: string | null;
  telegram?: string | null;
  website?: string | null;
  source?: string | null;
  status?: CrmLeadStatus | null;
  score?: number | null;
  sdr_id?: string | null;
  note?: string | null;
  qualification_need?: string | null;
  qualification_icp_fit?: boolean | null;
  qualification_estimated_value?: number | null;
  qualification_decision_maker?: string | null;
  qualification_expected_timeline?: string | null;
  qualification_ae_id?: string | null;
  next_step?: string | null;
  follow_up_date?: string | null;
  converted_customer_id?: string | null;
  converted_contact_id?: string | null;
  converted_deal_id?: string | null;
  converted_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  can_write?: boolean | null;
};

type ApiListResponse = {
  items?: ApiLeadRow[];
  total?: number;
  page?: number;
  page_size?: number;
  kpi?: Partial<CrmLeadKpi>;
};

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

export function mapLead(row: ApiLeadRow): CrmLeadRow {
  return {
    id: row.id,
    leadName: row.lead_name || 'Lead chưa tên',
    companyName: row.company_name || '',
    position: row.position || '',
    positionCategoryId: row.position_category_id || '',
    positionLabelSnapshot: row.position_label_snapshot || '',
    phone: row.phone || '',
    email: row.email || '',
    zalo: row.zalo || '',
    facebook: row.facebook || '',
    telegram: row.telegram || '',
    website: row.website || '',
    source: row.source || '',
    status: row.status || 'mql',
    score: row.score ?? null,
    sdrId: row.sdr_id || '',
    note: row.note || '',
    qualificationNeed: row.qualification_need || '',
    qualificationIcpFit: row.qualification_icp_fit ?? null,
    qualificationEstimatedValue: row.qualification_estimated_value ?? null,
    qualificationDecisionMaker: row.qualification_decision_maker || '',
    qualificationExpectedTimeline: row.qualification_expected_timeline || '',
    qualificationAeId: row.qualification_ae_id || '',
    nextStep: row.next_step || '',
    followUpDate: row.follow_up_date || '',
    convertedCustomerId: row.converted_customer_id || '',
    convertedContactId: row.converted_contact_id || '',
    convertedDealId: row.converted_deal_id || '',
    convertedAt: row.converted_at || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    canWrite: Boolean(row.can_write),
  };
}

export function LeadsDirectory() {
  const { user } = useAppAuth();
  const { members } = useMembers();
  const [items, setItems] = useState<CrmLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<CrmLeadKpi>({ total: 0, mql: 0, sql: 0, nurturing: 0, unqualified: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [sdrId, setSdrId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<CrmLeadRow | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'qualify' | 'convert'>('view');
  const [editLead, setEditLead] = useState<CrmLeadRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CrmLeadRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const { options: sourceOptions } = useCrmCategoryCodeOptions('crm_source');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [status, source, sdrId]);

  const load = useCallback(() => {
    let alive = true;
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (sdrId) params.set('sdr_id', sdrId);
    setLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/leads?${params.toString()}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được danh sách Lead.');
        return body.data as ApiListResponse;
      })
      .then(data => {
        if (!alive) return;
        setItems((data.items || []).map(mapLead));
        setTotal(data.total || 0);
        const rawKpi = (data.kpi || {}) as Record<string, number | undefined>;
        setKpi({
          total: data.kpi?.total ?? 0,
          mql: rawKpi.mql ?? rawKpi.new_lead ?? 0,
          sql: rawKpi.sql ?? rawKpi.qualified ?? 0,
          nurturing: rawKpi.nurturing ?? rawKpi.nurture ?? 0,
          unqualified: rawKpi.unqualified ?? rawKpi.disqualified ?? 0,
        });
        setError('');
      })
      .catch(err => {
        if (!alive) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Không tải được danh sách Lead.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [page, search, status, source, sdrId]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load, reloadTick]);

  const sdrName = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) map.set(key, m.display_name);
    });
    if (user?.id && !map.has(user.id)) map.set(user.id, user.name || user.email);
    return map;
  }, [members, user]);

  const sdrFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) seen.set(key, m.display_name);
    });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [members]);

  const kpiCards = [
    { label: 'Tổng Lead', value: kpi.total, tone: 'total' },
    { label: 'MQL', value: kpi.mql, tone: 'open' },
    { label: 'SQL', value: kpi.sql, tone: 'won' },
    { label: 'Nuôi dưỡng', value: kpi.nurturing, tone: 'won-value' },
    { label: 'Không đạt chuẩn', value: kpi.unqualified, tone: 'lost' },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(search || status || source || sdrId);

  function resetFilters() {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setSource('');
    setSdrId('');
    setPage(1);
  }

  function handleSaved() {
    setReloadTick(tick => tick + 1);
  }

  function openView(lead: CrmLeadRow) {
    setDetailLead(lead);
    setDetailMode('view');
  }

  /** Lối vào DUY NHẤT của form sửa Lead (LeadEditDrawer). Cả "Sửa nhanh" ở
   * menu "⋯" lẫn nút "Chỉnh sửa" trong drawer "Xác minh Lead" đều gọi hàm
   * này — không có bản form sửa thứ hai ở đâu khác. */
  function openEdit(lead: CrmLeadRow) {
    setEditLead(lead);
  }

  /** Cập nhật NGAY dòng tương ứng trong bảng sau khi lưu (không chờ reload
   * toàn trang), rồi vẫn nạp lại nền để KPI/thứ tự sắp xếp theo updated_at
   * khớp với server. */
  function applyUpdatedLead(updated: CrmLeadRow) {
    setItems(current => current.map(row => (row.id === updated.id ? updated : row)));
    setEditLead(current => (current && current.id === updated.id ? updated : current));
    setDetailLead(current => (current && current.id === updated.id ? updated : current));
    setReloadTick(tick => tick + 1);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: headers(),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || `Không xóa được Lead (lỗi ${res.status}).`);
      // Bỏ dòng khỏi bảng ngay, đồng thời nạp lại để KPI/tổng số về đúng.
      setItems(current => current.filter(row => row.id !== target.id));
      setTotal(current => Math.max(0, current - 1));
      setDeleteTarget(null);
      if (detailLead?.id === target.id) setDetailLead(null);
      if (editLead?.id === target.id) setEditLead(null);
      setReloadTick(tick => tick + 1);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Không xóa được Lead.');
    } finally {
      setDeleting(false);
    }
  }
  function openQualifyForNewLead(lead: CrmLeadRow) {
    setDetailLead(lead);
    setDetailMode('qualify');
  }

  /** Bấm vào tên Lead / dòng Lead mở ĐÚNG cùng 1 drawer "Xác minh Lead" như
   * nút hành động chính — trước đây tên Lead luôn mở chế độ 'view' trong khi
   * nút hành động lại mở chế độ khác, nên 2 lối vào cùng 1 record cho ra 2 màn
   * khác nhau. Lead đã kết thúc luồng (converted / không phù hợp) mở ở chế độ
   * xem, phần còn lại mở thẳng luồng xác minh. */
  function openRow(lead: CrmLeadRow) {
    if (lead.status === 'sql' || lead.status === 'unqualified' || lead.status === 'converted' || lead.status === 'disqualified') {
      openView(lead);
      return;
    }
    openQualifyForNewLead(lead);
  }

  /** Hành động chính của 1 dòng phụ thuộc TRẠNG THÁI lead — mọi trạng thái đều
   * mở đúng 1 drawer "Xác minh Lead", chỉ khác chỗ được cuộn tới; riêng lead đã
   * convert thì mở thẳng Deal đã tạo (?openDeal=<converted_deal_id> — cùng
   * deep-link mà CrmShell.tsx đã đọc sẵn) thay vì mở lại drawer xác minh. */
  function primaryActionOf(lead: CrmLeadRow): { label: string; run: () => void } {
    switch (lead.status) {
      case 'mql':
      case 'new_lead':
      case 'qualifying':
        return { label: 'Xác minh', run: () => openQualifyForNewLead(lead) };
      case 'sql':
      case 'qualified':
      case 'converted':
        if (lead.convertedDealId) {
          const dealId = lead.convertedDealId;
          return {
            label: 'Mở Deal',
            run: () => {
              window.location.href = `/all-platform/crm?openDeal=${encodeURIComponent(dealId)}`;
            },
          };
        }
        return { label: 'Xem xác minh', run: () => openQualifyForNewLead(lead) };
      case 'nurturing':
      case 'nurture':
      case 'unqualified':
      case 'disqualified':
        return { label: 'Xem xác minh', run: () => openQualifyForNewLead(lead) };
      default:
        return { label: 'Mở', run: () => openView(lead) };
    }
  }

  /** Hành động phụ trong menu "⋯": "Sửa nhanh" nay mở FORM SỬA thật
   * (LeadEditDrawer) thay vì drawer xác minh; lối vào tạo cơ hội cho lead chưa
   * convert; và "Xóa Lead" (đỏ, luôn ở cuối) — chỉ hiện với người có quyền ghi
   * Lead đó, tức đúng `can_write` mà backend trả về từ can_write_lead(). */
  function secondaryActionsOf(lead: CrmLeadRow): ActionMenuItem[] {
    return [
      { key: 'edit', label: 'Sửa nhanh', onSelect: () => openEdit(lead) },
      ...((lead.status === 'converted' || lead.status === 'sql') && lead.convertedCustomerId
        ? [{
            key: 'customer',
            label: 'Xem khách hàng',
            onSelect: () => {
              window.location.href = `/all-platform/crm/customers/${lead.convertedCustomerId}`;
            },
          }]
        : []),
      ...(lead.canWrite
        ? [{
            key: 'delete',
            label: 'Xóa Lead',
            danger: true,
            onSelect: () => {
              setDeleteError('');
              setDeleteTarget(lead);
            },
          }]
        : []),
    ];
  }

  return (
    <div className="crm-shell">
      <section className="crm-page-card crm-leads-page-shell">
        {error ? <p className="crm-error">{error}</p> : null}

        <div className="crm-stat-grid crm-stat-grid--4">
          {kpiCards.map(card => (
            <div key={card.label} className={`crm-stat-card crm-stat-card--${card.tone}`}>
              <p className="crm-stat-label">{card.label}</p>
              <p className="crm-stat-value">{card.value}</p>
            </div>
          ))}
        </div>

        <section className="crm-filter-card">
          <div className="crm-filter-grid crm-filter-grid--leads">
            <input
              value={searchInput}
              onChange={event => setSearchInput(event.target.value)}
              className="crm-input"
              placeholder="Tìm tên, công ty, SĐT, email..."
              autoComplete="off"
            />
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={status}
                onChange={setStatus}
                placeholder="Tất cả trạng thái"
                options={STATUS_OPTIONS.filter(option => option.value !== '')}
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={source}
                onChange={setSource}
                placeholder="Tất cả nguồn"
                options={sourceOptions}
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={sdrId}
                onChange={setSdrId}
                placeholder="Tất cả SDR phụ trách"
                options={sdrFilterOptions.map(([id, name]) => ({ value: id, label: name }))}
              />
            </div>
            <div className="crm-icon-action-group" style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
              {hasFilters ? (
                <button type="button" className="crm-secondary-button crm-filter-reset" onClick={resetFilters}>
                  <RotateCcw className="crm-button-icon" /> Xóa lọc
                </button>
              ) : null}
              <button type="button" className="crm-primary-button" onClick={() => setFormOpen(true)}>
                <Plus className="crm-button-icon" /> Thêm Lead
              </button>
            </div>
          </div>
        </section>

        <section className="crm-content-section">
          <div className="crm-table-card crm-lead-table-card--desktop">
            <div className="crm-table-scroll">
              <table className="crm-table crm-lead-directory-table">
                <colgroup>
                  <col className="crm-col-lead-name" />
                  <col className="crm-col-lead-contact" />
                  <col className="crm-col-lead-source" />
                  <col className="crm-col-lead-score" />
                  <col className="crm-col-lead-status" />
                  <col className="crm-col-lead-sdr" />
                  <col className="crm-col-lead-nextstep" />
                  <col className="crm-col-lead-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="crm-th">Lead</th>
                    <th className="crm-th">Liên hệ</th>
                    <th className="crm-th">Nguồn</th>
                    <th className="crm-th crm-th--right">Score</th>
                    <th className="crm-th">Trạng thái</th>
                    <th className="crm-th">SDR</th>
                    <th className="crm-th">Việc tiếp theo</th>
                    <th className="crm-th crm-th--right crm-th--actions-col">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</td></tr>
                  ) : items.length ? (
                    items.map(lead => (
                      <tr key={lead.id} className="crm-row">
                        <td className="crm-td">
                          <button type="button" className="crm-customer-name-link crm-lead-name-btn" title={lead.leadName} onClick={() => openRow(lead)}>
                            {lead.leadName}
                          </button>
                          <div className="crm-customer-company" title={lead.companyName || 'Chưa có công ty'}>
                            {lead.companyName || 'Chưa có công ty'}
                          </div>
                        </td>
                        <td className="crm-td crm-contact-cell">
                          {lead.phone ? (
                            <a className="crm-contact-link" href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>{lead.phone}</a>
                          ) : <div className="crm-small">-</div>}
                          {lead.email ? (
                            <a className="crm-contact-link crm-muted crm-truncate" title={lead.email} href={`mailto:${lead.email}`}>{lead.email}</a>
                          ) : <div className="crm-muted crm-truncate">-</div>}
                        </td>
                        <td className="crm-td"><span className="crm-source-badge">{lead.source || 'Manual'}</span></td>
                        <td className="crm-td crm-td--right">{lead.score == null ? '-' : lead.score}</td>
                        <td className="crm-td">
                          <span className={`crm-lead-status-badge ${STATUS_BADGE_CLASS[lead.status] || ''}`}>
                            {LEAD_STATUS_LABEL[lead.status] || lead.status}
                          </span>
                        </td>
                        <td className="crm-td crm-small">{sdrName.get(lead.sdrId || '') || 'Chưa gán'}</td>
                        <td className="crm-td crm-muted crm-truncate" title={lead.nextStep || ''}>{lead.nextStep || '-'}</td>
                        <td className="crm-td crm-td--actions-col">
                          <div className="crm-row-actions">
                            {(() => {
                              const action = primaryActionOf(lead);
                              return (
                                <button
                                  type="button"
                                  className="crm-row-action-primary crm-lead-row-action"
                                  title={action.label}
                                  onClick={action.run}
                                >
                                  {action.label}
                                </button>
                              );
                            })()}
                            <ActionMenu label="Thao tác khác" items={secondaryActionsOf(lead)} />
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <div className="crm-empty-state">
                          <span className="crm-empty-state-icon">
                            <Plus className="crm-button-icon" />
                          </span>
                          <p className="crm-empty-state-title">
                            {hasFilters ? 'Không có Lead phù hợp với bộ lọc' : 'Chưa có Lead'}
                          </p>
                          <p className="crm-empty-state-desc">
                            {hasFilters
                              ? 'Thử đổi từ khóa tìm kiếm hoặc bấm "Xóa lọc" để xem lại toàn bộ danh sách.'
                              : 'Bắt đầu bằng cách thêm Lead đầu tiên vào CRM.'}
                          </p>
                          {hasFilters ? (
                            <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                              <RotateCcw className="crm-button-icon" /> Xóa lọc
                            </button>
                          ) : (
                            <button type="button" className="crm-primary-button" onClick={() => setFormOpen(true)}>
                              <Plus className="crm-button-icon" /> Thêm Lead đầu tiên
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Card list cho man hep - cung ly do voi CrmCustomersDirectory.tsx
           * (bang 8 cot ep table-layout:fixed khong doc noi duoi 900px). */}
          <div className="crm-lead-card-list">
            {loading ? (
              <div className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</div>
            ) : items.length ? (
              items.map(lead => (
                <div key={lead.id} className="crm-customer-card crm-lead-card">
                  <div className="crm-customer-card-head">
                    <div className="crm-customer-card-identity">
                      <button type="button" className="crm-customer-name-link crm-lead-name-btn" title={lead.leadName} onClick={() => openRow(lead)}>
                        {lead.leadName}
                      </button>
                      <div className="crm-customer-company" title={lead.companyName || 'Chưa có công ty'}>
                        {lead.companyName || 'Chưa có công ty'}
                      </div>
                    </div>
                    <span className={`crm-lead-status-badge ${STATUS_BADGE_CLASS[lead.status] || ''}`}>
                      {LEAD_STATUS_LABEL[lead.status] || lead.status}
                    </span>
                  </div>
                  <div className="crm-customer-card-contact">
                    {lead.phone ? (
                      <a className="crm-contact-link" href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>{lead.phone}</a>
                    ) : null}
                    {lead.email ? (
                      <a className="crm-contact-link crm-muted crm-truncate" title={lead.email} href={`mailto:${lead.email}`}>{lead.email}</a>
                    ) : null}
                  </div>
                  <div className="crm-customer-card-meta">
                    <span className="crm-source-badge">{lead.source || 'Manual'}</span>
                    <span className="crm-small">{sdrName.get(lead.sdrId || '') || 'Chưa gán'}</span>
                  </div>
                  <div className="crm-customer-card-metrics">
                    <span>Score: {lead.score == null ? '-' : lead.score}</span>
                    <span className="crm-muted crm-truncate">{lead.nextStep || 'Chưa có việc tiếp theo'}</span>
                  </div>
                  <div className="crm-customer-card-actions">
                    {(() => {
                      const action = primaryActionOf(lead);
                      return (
                        <button type="button" className="crm-row-action-primary crm-lead-row-action" onClick={action.run}>
                          {action.label}
                        </button>
                      );
                    })()}
                    <ActionMenu label="Thao tác khác" items={secondaryActionsOf(lead)} />
                  </div>
                </div>
              ))
            ) : (
              <div className="crm-empty-state">
                <span className="crm-empty-state-icon">
                  <Plus className="crm-button-icon" />
                </span>
                <p className="crm-empty-state-title">
                  {hasFilters ? 'Không có Lead phù hợp với bộ lọc' : 'Chưa có Lead'}
                </p>
                {hasFilters ? (
                  <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                    <RotateCcw className="crm-button-icon" /> Xóa lọc
                  </button>
                ) : (
                  <button type="button" className="crm-primary-button" onClick={() => setFormOpen(true)}>
                    <Plus className="crm-button-icon" /> Thêm Lead đầu tiên
                  </button>
                )}
              </div>
            )}
          </div>

          {total > 0 ? (
            <div className="crm-pagination">
              <span className="crm-pagination-info">
                Trang {page}/{totalPages} · {total} Lead
              </span>
              <div className="crm-pagination-actions">
                <button type="button" className="crm-secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  Trước
                </button>
                <button type="button" className="crm-secondary-button" disabled={page >= totalPages || loading} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  Sau
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </section>

      <LeadFormDrawer
        open={formOpen}
        currentUser={user}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
        onOpenQualification={lead => {
          setFormOpen(false);
          openQualifyForNewLead(lead);
        }}
        onOpenExistingLead={lead => {
          setFormOpen(false);
          openRow(lead);
        }}
      />

      <LeadDetailDrawer
        lead={detailLead}
        open={Boolean(detailLead)}
        initialMode={detailMode}
        currentUser={user}
        onClose={() => setDetailLead(null)}
        onSaved={updated => {
          setDetailLead(updated);
          handleSaved();
        }}
        onEdit={openEdit}
      />

      <LeadEditDrawer
        lead={editLead}
        open={Boolean(editLead)}
        currentUser={user}
        onClose={() => setEditLead(null)}
        onSaved={applyUpdatedLead}
      />

      {deleteTarget ? (
        <div
          className="crm-modal-backdrop crm-modal-backdrop--confirm"
          onClick={() => (deleting ? undefined : setDeleteTarget(null))}
        >
          <div
            className="crm-modal crm-modal--confirm"
            role="dialog"
            aria-modal="true"
            data-testid="lead-delete-confirm"
            onClick={event => event.stopPropagation()}
          >
            <header className="crm-modal-header">
              <div>
                <p className="crm-modal-title">Xóa Lead</p>
                <p className="crm-modal-subtitle">Hành động này không thể hoàn tác.</p>
              </div>
            </header>
            <div className="crm-modal-body">
              {deleteError ? <p className="crm-error" data-testid="lead-delete-error">{deleteError}</p> : null}
              <p>
                Xóa Lead <b>&ldquo;{deleteTarget.leadName}&rdquo;</b>? Hành động này không thể hoàn tác.
              </p>
              <p className="crm-ai-fill-hint">
                Nếu chỉ muốn ngừng theo dõi, hãy dùng &quot;Sửa nhanh&quot; để chuyển trạng thái sang &quot;Theo dõi
                sau&quot; hoặc &quot;Không phù hợp&quot; thay vì xóa hẳn.
              </p>
            </div>
            <footer className="crm-modal-footer">
              <button
                type="button"
                className="crm-cancel-button"
                data-testid="lead-delete-cancel"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="crm-danger-button"
                data-testid="lead-delete-confirm-btn"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? <Loader2 className="crm-save-spinner" /> : null}
                {deleting ? 'Đang xóa...' : 'Xóa Lead'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
