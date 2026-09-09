'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { useMembers } from '@/hooks/useMembers';
import { usersService, type QuoteBusinessRoleUser } from '@/services/all-platform.service';
import { formatVND } from '../constants/crmConfig';
import { CustomerFormModal } from './CustomerFormModal';
import { CustomerAddDrawer } from './CustomerAddDrawer';
import { CreateOpportunityDrawer } from './CreateOpportunityDrawer';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { SearchableSelect } from './SearchableSelect';
import { Loader2, Plus, RotateCcw } from './icons';
import type { CrmCustomerKpi, CrmCustomerRow } from '../types';

/**
 * Tab -> status mapping (quyet dinh cuoi cung, xem bao cao task):
 *   Tat ca            -> '' (khong loc)
 *   Tiem nang         -> new_lead
 *   Dang ban          -> following
 *   Da mua            -> current_customer
 *   Ngung hoat dong   -> not_fit
 * Chon theo dung 4 gia tri enum status hien co tren crm_customers, dat ten
 * tab theo ngon ngu kinh doanh (khac chut so voi nhan cu "Dang cham soc"/
 * "Khong phu hop") de khop dung tinh than "doanh nghiep la khach hang, dang
 * qua cac giai doan ban hang" cua thiet ke moi.
 */
const STATUS_TABS: Array<{ value: string; label: string; kpiKey: keyof CrmCustomerKpi }> = [
  { value: '', label: 'Tất cả', kpiKey: 'total' },
  { value: 'new_lead', label: 'Tiềm năng', kpiKey: 'new_lead' },
  { value: 'following', label: 'Đang bán', kpiKey: 'following' },
  { value: 'current_customer', label: 'Đã mua', kpiKey: 'current_customer' },
  { value: 'not_fit', label: 'Ngừng hoạt động', kpiKey: 'not_fit' },
];

const STATUS_LABEL: Record<string, string> = {
  new_lead: 'Tiềm năng',
  following: 'Đang bán',
  current_customer: 'Đã mua',
  not_fit: 'Ngừng hoạt động',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  new_lead: 'crm-customer-status--new',
  following: 'crm-customer-status--following',
  current_customer: 'crm-customer-status--current',
  not_fit: 'crm-customer-status--not-fit',
};

/** Nhan nut hanh dong chinh o cot "Hanh dong", theo dung status - Ngung hoat
 * dong KHONG co nut tao deal nao (quyet dinh cua task, tranh tao co hoi ban
 * hang cho khach da ngung). */
const PRIMARY_ACTION_LABEL: Record<string, string> = {
  new_lead: '+ Deal',
  following: '+ Deal',
  current_customer: '+ Upsell',
};

const PAGE_SIZE = 20;

type ApiCustomerRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
  tax_code?: string | null;
  city?: string | null;
  website?: string | null;
  source?: string | null;
  status?: CrmCustomerRow['status'] | null;
  owner_id?: string | null;
  can_edit?: boolean | null;
  deal_count?: number | null;
  contact_count?: number | null;
  total_value?: number | string | null;
  last_deal_at?: string | null;
  updated_at?: string | null;
};

type ApiListResponse = {
  items?: ApiCustomerRow[];
  total?: number;
  page?: number;
  page_size?: number;
  // Backend trả đúng {total, new_lead, following, current_customer, not_fit} —
  // KHÔNG phải total_customers/current_customers/new_leads như bản cũ đã đoán
  // sai (bug key mismatch khiến 4 thẻ KPI luôn hiện 0).
  kpi?: Partial<CrmCustomerKpi>;
};

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function mapCustomer(row: ApiCustomerRow): CrmCustomerRow {
  return {
    id: row.id,
    customerName: row.customer_name || 'Khách hàng chưa tên',
    companyName: row.company_name || '',
    position: row.position || '',
    phone: row.phone || '',
    email: row.email || '',
    taxCode: row.tax_code || '',
    city: row.city || '',
    website: row.website || '',
    source: row.source || '',
    status: row.status || undefined,
    ownerId: row.owner_id || '',
    canEdit: Boolean(row.can_edit),
    dealCount: Number(row.deal_count || 0),
    contactCount: Number(row.contact_count || 0),
    totalValue: Number(row.total_value || 0),
    lastDealAt: row.last_deal_at || '',
    updatedAt: row.updated_at || '',
  };
}

export function CrmCustomersDirectory() {
  const router = useRouter();
  const { user } = useAppAuth();
  const { members } = useMembers();
  const [items, setItems] = useState<CrmCustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<CrmCustomerKpi>({ total: 0, new_lead: 0, following: 0, current_customer: 0, not_fit: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [saleManagerId, setSaleManagerId] = useState('');
  const [saleManagerOptions, setSaleManagerOptions] = useState<QuoteBusinessRoleUser[]>([]);
  useEffect(() => {
    let alive = true;
    usersService
      .getUsersByQuoteBusinessRole('sale')
      .then(res => {
        if (alive) setSaleManagerOptions(res.success ? res.data || [] : []);
      })
      .catch(() => {
        if (alive) setSaleManagerOptions([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CrmCustomerRow | null>(null);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [opportunityCustomer, setOpportunityCustomer] = useState<CrmCustomerRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CrmCustomerRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Debounce ô tìm kiếm ~300ms — tránh gọi API mỗi lần gõ phím.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [status, ownerId, saleManagerId]);

  const load = useCallback(() => {
    let alive = true;
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (ownerId) params.set('owner_id', ownerId);
    if (saleManagerId) params.set('sale_manager_id', saleManagerId);
    setLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers?${params.toString()}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được hồ sơ khách hàng.');
        return body.data as ApiListResponse;
      })
      .then(data => {
        if (!alive) return;
        setItems((data.items || []).map(mapCustomer));
        setTotal(data.total || 0);
        setKpi({
          total: data.kpi?.total ?? 0,
          new_lead: data.kpi?.new_lead ?? 0,
          following: data.kpi?.following ?? 0,
          current_customer: data.kpi?.current_customer ?? 0,
          not_fit: data.kpi?.not_fit ?? 0,
        });
        setError('');
      })
      .catch(err => {
        if (!alive) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Không tải được hồ sơ khách hàng.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [page, search, status, ownerId, saleManagerId]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load, reloadTick]);

  const ownerName = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) map.set(key, m.display_name);
    });
    if (user?.id && !map.has(user.id)) map.set(user.id, user.name || user.email);
    return map;
  }, [members, user]);

  const ownerFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) seen.set(key, m.display_name);
    });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [members]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(search || ownerId || saleManagerId);

  function resetFilters() {
    setSearchInput('');
    setSearch('');
    setOwnerId('');
    setSaleManagerId('');
    setPage(1);
  }

  function handleSaved() {
    setFormOpen(false);
    setEditingCustomer(null);
    setReloadTick(tick => tick + 1);
  }

  function handleCreated(customerId: string) {
    setAddDrawerOpen(false);
    setReloadTick(tick => tick + 1);
    router.push(`/all-platform/crm/customers/${customerId}`);
  }

  function goToDetail(customerId: string) {
    router.push(`/all-platform/crm/customers/${customerId}`);
  }

  function handleOpportunityCreated() {
    setOpportunityCustomer(null);
    setReloadTick(tick => tick + 1);
  }

  function handleOpportunityCreatedAndOpen(dealId: string) {
    setOpportunityCustomer(null);
    setReloadTick(tick => tick + 1);
    router.push(`/all-platform/crm?openDeal=${encodeURIComponent(dealId)}`);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: headers(),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || `Không xóa được khách hàng (lỗi ${res.status}).`);
      setItems(current => current.filter(row => row.id !== target.id));
      setTotal(current => Math.max(0, current - 1));
      setDeleteTarget(null);
      setReloadTick(tick => tick + 1);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Không xóa được khách hàng.');
    } finally {
      setDeleting(false);
    }
  }

  /** Dùng chung cho cả bảng desktop lẫn card mobile — tránh 2 bản danh sách
   * hành động lệch nhau. "Xóa" chỉ hiện với người có quyền sửa hồ sơ (đúng
   * quyền `can_edit_customer` backend đã kiểm — canEdit dùng chung cho cả
   * sửa lẫn xóa), backend tự chặn nếu còn deal/contact liên kết. */
  function secondaryActionsOf(customer: CrmCustomerRow): ActionMenuItem[] {
    if (!customer.canEdit) return [];
    return [
      { key: 'edit', label: 'Sửa', onSelect: () => { setEditingCustomer(customer); setFormOpen(true); } },
      {
        key: 'delete',
        label: 'Xóa',
        danger: true,
        onSelect: () => {
          setDeleteError('');
          setDeleteTarget(customer);
        },
      },
    ];
  }

  function renderPrimaryAction(customer: CrmCustomerRow) {
    const label = PRIMARY_ACTION_LABEL[customer.status || ''];
    if (!label) return null;
    return (
      <button
        type="button"
        className="crm-row-action-primary"
        onClick={event => {
          event.stopPropagation();
          setOpportunityCustomer(customer);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="crm-shell">
      <section className="crm-page-card crm-customers-page-shell">
        {error ? <p className="crm-error">{error}</p> : null}

        <div className="crm-guidance-strip">
          <div className="crm-guidance-chip">Biết rõ doanh nghiệp/khách hàng → Thêm khách hàng.</div>
          <div className="crm-guidance-chip">
            Đầu mối chưa xác minh → <Link href="/all-platform/crm/leads">Tạo Lead</Link>.
          </div>
          <div className="crm-guidance-chip">Có nhu cầu bán hàng → Tạo cơ hội.</div>
        </div>

        <div className="crm-page-tabs" role="tablist">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value || 'all'}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              className={`crm-page-tab ${status === tab.value ? 'crm-page-tab--active' : ''}`}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
              <span className="crm-page-tab-count">{kpi[tab.kpiKey]}</span>
            </button>
          ))}
        </div>

        <section className="crm-filter-card">
          <div className="crm-filter-grid crm-filter-grid--customers-v2">
            <input
              value={searchInput}
              onChange={event => setSearchInput(event.target.value)}
              className="crm-input"
              placeholder="Tìm tên doanh nghiệp, MST, người liên hệ, SĐT, email..."
              autoComplete="off"
            />
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={saleManagerId}
                onChange={setSaleManagerId}
                placeholder="Tất cả Sale manager"
                options={saleManagerOptions.map(u => ({ value: u.id, label: u.name }))}
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={ownerId}
                onChange={setOwnerId}
                placeholder="Tất cả người phụ trách"
                options={ownerFilterOptions.map(([id, name]) => ({ value: id, label: name }))}
              />
            </div>
            <div className="crm-icon-action-group" style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
              {hasFilters ? (
                <button type="button" className="crm-secondary-button crm-filter-reset" onClick={resetFilters}>
                  <RotateCcw className="crm-button-icon" /> Xóa lọc
                </button>
              ) : null}
              <button type="button" className="crm-primary-button" onClick={() => setAddDrawerOpen(true)}>
                <Plus className="crm-button-icon" /> Thêm khách hàng
              </button>
            </div>
          </div>
        </section>

        <section className="crm-content-section">
          <div className="crm-table-card crm-customer-table-card--desktop">
            <div className="crm-table-scroll">
              <table className="crm-table crm-customer-directory-table crm-customer-directory-table--v2">
                <colgroup>
                  <col className="crm-col-cust-name-v2" />
                  <col className="crm-col-cust-taxcode" />
                  <col className="crm-col-cust-contacts" />
                  <col className="crm-col-cust-deals" />
                  <col className="crm-col-cust-value" />
                  <col className="crm-col-cust-status" />
                  <col className="crm-col-cust-owner" />
                  <col className="crm-col-cust-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="crm-th">Doanh nghiệp</th>
                    <th className="crm-th">MST</th>
                    <th className="crm-th crm-th--right">Người liên hệ</th>
                    <th className="crm-th crm-th--right">Cơ hội</th>
                    <th className="crm-th crm-th--right">Giá trị Pipeline</th>
                    <th className="crm-th">Trạng thái</th>
                    <th className="crm-th">Owner</th>
                    <th className="crm-th crm-th--right crm-th--actions-col">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</td></tr>
                  ) : items.length ? (
                    items.map(customer => (
                      <tr
                        key={customer.id}
                        className="crm-row crm-row--clickable"
                        onClick={() => goToDetail(customer.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="crm-td">
                          <Link
                            href={`/all-platform/crm/customers/${customer.id}`}
                            className="crm-customer-name-link"
                            title={customer.customerName}
                            onClick={event => event.stopPropagation()}
                          >
                            {customer.customerName}
                          </Link>
                          {(customer.city || customer.website) ? (
                            <div className="crm-customer-company" title={[customer.city, customer.website].filter(Boolean).join(' · ')}>
                              {[customer.city, customer.website].filter(Boolean).join(' · ')}
                            </div>
                          ) : customer.companyName && customer.companyName !== customer.customerName ? (
                            <div className="crm-customer-company" title={customer.companyName}>
                              {customer.companyName}
                            </div>
                          ) : null}
                        </td>
                        <td className="crm-td crm-muted">{customer.taxCode || '-'}</td>
                        <td className="crm-td crm-td--right">{customer.contactCount || 0}</td>
                        <td className="crm-td crm-td--right">{customer.dealCount || 0}</td>
                        <td className="crm-td crm-td--right crm-budget">{formatVND(customer.totalValue || 0) || '0 đ'}</td>
                        <td className="crm-td">
                          <span className={`crm-customer-status-badge ${STATUS_BADGE_CLASS[customer.status || ''] || ''}`}>
                            {STATUS_LABEL[customer.status || ''] || 'Chưa phân loại'}
                          </span>
                        </td>
                        <td className="crm-td crm-small">{ownerName.get(customer.ownerId || '') || 'Chưa gán'}</td>
                        <td className="crm-td crm-td--actions-col" onClick={event => event.stopPropagation()}>
                          <div className="crm-row-actions">
                            {renderPrimaryAction(customer)}
                            <ActionMenu
                              label="Thao tác khác"
                              items={secondaryActionsOf(customer)}
                            />
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
                            {hasFilters ? 'Không có hồ sơ phù hợp với bộ lọc' : 'Chưa có khách hàng'}
                          </p>
                          <p className="crm-empty-state-desc">
                            {hasFilters
                              ? 'Thử đổi từ khóa tìm kiếm hoặc bấm "Xóa lọc" để xem lại toàn bộ danh sách.'
                              : 'Bắt đầu bằng cách thêm hồ sơ khách hàng đầu tiên vào CRM.'}
                          </p>
                          {hasFilters ? (
                            <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                              <RotateCcw className="crm-button-icon" /> Xóa lọc
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="crm-primary-button"
                              onClick={() => setAddDrawerOpen(true)}
                            >
                              <Plus className="crm-button-icon" /> Thêm khách hàng đầu tiên
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

          {/* Bang desktop 8 cot khong dung duoc o man hep - table-layout:fixed
           * ep het chu xuong tung ky tu, khong doc noi (bug thuc te thay qua
           * anh chup 375/768px). Thay bang danh sach card rieng, chi hien o
           * man hep qua CSS (xem .crm-customer-card-list). */}
          <div className="crm-customer-card-list">
            {loading ? (
              <div className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</div>
            ) : items.length ? (
              items.map(customer => (
                <div
                  key={customer.id}
                  className="crm-customer-card"
                  onClick={() => goToDetail(customer.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="crm-customer-card-head">
                    <div className="crm-customer-card-identity">
                      <Link
                        href={`/all-platform/crm/customers/${customer.id}`}
                        className="crm-customer-name-link"
                        title={customer.customerName}
                        onClick={event => event.stopPropagation()}
                      >
                        {customer.customerName}
                      </Link>
                      <div className="crm-customer-company" title={customer.taxCode ? `MST: ${customer.taxCode}` : 'Chưa có MST'}>
                        {customer.taxCode ? `MST: ${customer.taxCode}` : 'Chưa có MST'}
                      </div>
                    </div>
                    <span className={`crm-customer-status-badge ${STATUS_BADGE_CLASS[customer.status || ''] || ''}`}>
                      {STATUS_LABEL[customer.status || ''] || 'Chưa phân loại'}
                    </span>
                  </div>
                  <div className="crm-customer-card-meta">
                    <span className="crm-small">{ownerName.get(customer.ownerId || '') || 'Chưa gán'}</span>
                  </div>
                  <div className="crm-customer-card-metrics">
                    <span>{customer.contactCount || 0} contact</span>
                    <span>{customer.dealCount || 0} deal</span>
                    <span className="crm-budget">{formatVND(customer.totalValue || 0) || '0 đ'}</span>
                  </div>
                  <div className="crm-customer-card-actions" onClick={event => event.stopPropagation()}>
                    {renderPrimaryAction(customer)}
                    <ActionMenu
                      label="Thao tác khác"
                      items={secondaryActionsOf(customer)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="crm-empty-state">
                <span className="crm-empty-state-icon">
                  <Plus className="crm-button-icon" />
                </span>
                <p className="crm-empty-state-title">
                  {hasFilters ? 'Không có hồ sơ phù hợp với bộ lọc' : 'Chưa có khách hàng'}
                </p>
                <p className="crm-empty-state-desc">
                  {hasFilters
                    ? 'Thử đổi từ khóa tìm kiếm hoặc bấm "Xóa lọc" để xem lại toàn bộ danh sách.'
                    : 'Bắt đầu bằng cách thêm hồ sơ khách hàng đầu tiên vào CRM.'}
                </p>
                {hasFilters ? (
                  <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                    <RotateCcw className="crm-button-icon" /> Xóa lọc
                  </button>
                ) : (
                  <button
                    type="button"
                    className="crm-primary-button"
                    onClick={() => setAddDrawerOpen(true)}
                  >
                    <Plus className="crm-button-icon" /> Thêm khách hàng đầu tiên
                  </button>
                )}
              </div>
            )}
          </div>

          {total > 0 ? (
            <div className="crm-pagination">
              <span className="crm-pagination-info">
                Trang {page}/{totalPages} · {total} hồ sơ
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

      <CustomerFormModal
        open={formOpen}
        customer={editingCustomer}
        currentUser={user}
        onClose={() => { setFormOpen(false); setEditingCustomer(null); }}
        onSaved={handleSaved}
      />

      <CustomerAddDrawer
        open={addDrawerOpen}
        currentUser={user}
        onClose={() => setAddDrawerOpen(false)}
        onCreated={handleCreated}
      />

      <CreateOpportunityDrawer
        open={Boolean(opportunityCustomer)}
        customer={opportunityCustomer}
        currentUser={user}
        onClose={() => setOpportunityCustomer(null)}
        onCreated={handleOpportunityCreated}
        onCreatedAndOpen={handleOpportunityCreatedAndOpen}
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
            data-testid="customer-delete-confirm"
            onClick={event => event.stopPropagation()}
          >
            <header className="crm-modal-header">
              <div>
                <p className="crm-modal-title">Xóa khách hàng</p>
                <p className="crm-modal-subtitle">Hành động này không thể hoàn tác.</p>
              </div>
            </header>
            <div className="crm-modal-body">
              {deleteError ? <p className="crm-error" data-testid="customer-delete-error">{deleteError}</p> : null}
              <p>
                Xóa khách hàng <b>&ldquo;{deleteTarget.customerName}&rdquo;</b>? Hành động này không thể hoàn tác.
              </p>
              <p className="crm-ai-fill-hint">
                Nếu khách hàng còn deal hoặc người liên hệ, thao tác sẽ bị chặn — hãy chuyển
                trạng thái sang &quot;Ngừng hoạt động&quot; thay vì xóa hẳn.
              </p>
            </div>
            <footer className="crm-modal-footer">
              <button
                type="button"
                className="crm-cancel-button"
                data-testid="customer-delete-cancel"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="crm-danger-button"
                data-testid="customer-delete-confirm-btn"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? <Loader2 className="crm-save-spinner" /> : null}
                {deleting ? 'Đang xóa...' : 'Xóa khách hàng'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
