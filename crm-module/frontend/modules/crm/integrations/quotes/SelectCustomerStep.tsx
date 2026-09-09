'use client';

import { useEffect, useMemo, useState } from 'react';
import { emptyDealForm } from '../../components/DealFormFields';
import type { DealFormState } from '../../components/DealFormFields';
import { seedingCrmRepository } from '../../repositories/SeedingCrmRepository';
import type { CrmCustomerSummary, CrmUserOption, Deal } from '../../types';
import type { Quote } from '@/modules/quotes';
import type { Project } from '@/services/all-platform.service';

/** Chu cai dau (toi da 2 tu) de lam avatar-initials - vd "Nguyen Van An" -> "NA". */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function SelectCustomerStep({
  deals,
  customer,
  onChangeCustomer,
  /** Mở từ "Tạo báo giá cho deal này" — khách hàng + deal đã cố định theo đúng
   * deal đó, không cho tìm/đổi sang khách khác hay gỡ deal ra nữa. */
  lockedDeal,
  /** Tất cả báo giá thật (để tính thống kê lịch sử theo khách hàng) — optional,
   * không truyền thì ẩn hẳn khối thống kê thay vì hiện số 0 giả. */
  quotes,
  /** Danh sách Sale để chọn "Sale phụ trách" khi tạo khách mới. */
  agents,
  /** Cơ hội (deal) đang liên kết thủ công cho báo giá TỰ DO (không phải
   * lockedDeal) — undefined = chưa gắn, sẽ tự tạo cơ hội mới lúc lưu. */
  linkedDeal,
  onChangeLinkedDeal,
  customerIdForProjects,
  projects,
  projectId,
  onChangeProjectId,
  onRequestCreateProject,
  onRequestCreateDeal,
}: {
  deals: Deal[];
  customer: DealFormState;
  onChangeCustomer: (next: DealFormState) => void;
  lockedDeal?: Deal | null;
  quotes?: Quote[];
  agents?: CrmUserOption[];
  linkedDeal?: Deal | null;
  onChangeLinkedDeal?: (deal: Deal | null) => void;
  /** Khach hang THAT (co id) de tai Du an theo dung customer_id - '' = chua
   * co khach hang that, dropdown Du an se khoa voi placeholder "Chọn khách
   * hàng trước". */
  customerIdForProjects?: string;
  projects?: Project[] | null;
  projectId?: string;
  onChangeProjectId?: (id: string) => void;
  onRequestCreateProject?: () => void;
  onRequestCreateDeal?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<CrmCustomerSummary[]>([]);
  const [pickedCustomer, setPickedCustomer] = useState<CrmCustomerSummary | null>(null);
  const pickedExisting = Boolean(pickedCustomer) || Boolean(lockedDeal);
  const referenceCustomerId = lockedDeal?.customerId || pickedCustomer?.id || '';
  const [editingFields, setEditingFields] = useState(false);
  const [dealPickerOpen, setDealPickerOpen] = useState(false);
  const [dealPickerQuery, setDealPickerQuery] = useState('');

  const searchQueryReady = searchOpen && search.trim().length >= 2;

  useEffect(() => {
    const keyword = search.trim();
    if (!searchQueryReady) {
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      setSearchLoading(true);
      void seedingCrmRepository.quickSearchCustomers(keyword, 8)
        .then(result => {
          if (alive) setSearchResults(result);
        })
        .catch(() => {
          if (alive) setSearchResults([]);
        })
        .finally(() => {
          if (alive) setSearchLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [search, searchOpen, searchQueryReady]);

  // Thống kê lịch sử báo giá của khách này — gộp TẤT CẢ deal có cùng customerId
  // thật (1 khách có thể đứng tên nhiều deal), không chỉ riêng deal đang chọn.
  const customerStats = useMemo(() => {
    if (!referenceCustomerId || !quotes) return null;
    const sameCustomerDealIds = new Set(deals.filter(deal => deal.customerId === referenceCustomerId).map(deal => deal.id));
    const relatedQuotes = quotes.filter(quote => quote.dealId && sameCustomerDealIds.has(quote.dealId));
    const won = relatedQuotes.filter(quote => {
      const deal = deals.find(item => item.id === quote.dealId);
      return deal?.stage === 'won' || deal?.crmStatus === 'won';
    });
    const totalValue = relatedQuotes.reduce((sum, quote) => sum + (quote.totalAmount || 0), 0);
    return {
      count: relatedQuotes.length,
      totalValue,
      wonCount: won.length,
      conversionRate: relatedQuotes.length ? Math.round((won.length / relatedQuotes.length) * 1000) / 10 : 0,
    };
  }, [referenceCustomerId, quotes, deals]);

  function pickExistingCustomer(found: CrmCustomerSummary) {
    onChangeCustomer({
      ...emptyDealForm(),
      customerId: found.id,
      customerName: found.customerName || '',
      companyName: found.companyName || '',
      phone: found.phone || '',
      email: found.email || '',
      sourcePlatform: found.source || 'Manual',
    });
    setPickedCustomer(found);
    setSearch('');
    setSearchOpen(false);
    setEditingFields(false);
  }

  function startNewCustomer() {
    onChangeCustomer(emptyDealForm());
    setPickedCustomer(null);
    setSearch('');
    setSearchOpen(false);
    setEditingFields(false);
  }

  const hasCustomer = Boolean(customer.customerName.trim() || customer.phone.trim() || customer.email.trim());

  // Danh sach co hoi de chon trong "Doi co hoi" (che do bao gia tu do, khong bi
  // khoa boi lockedDeal) - loc theo tu khoa go tay, gioi han 8 dong dau tien
  // giong pattern searchResults ben tren, khong can API rieng (deals da la
  // prop san co, fetch 1 lan o CrmShell).
  const dealPickerResults = useMemo(() => {
    const keyword = dealPickerQuery.trim().toLowerCase();
    let pool = deals;
    // Da co khach hang THAT - chi hien Co hoi cua DUNG khach hang do (va DUNG
    // Du an neu da chon Du an) - khong goi y lung tung Co hoi cua khach khac.
    if (customerIdForProjects) {
      pool = pool.filter(d => d.customerId === customerIdForProjects);
      if (projectId) pool = pool.filter(d => d.projectId === projectId);
    }
    if (keyword) {
      pool = pool.filter(d => d.customerName.toLowerCase().includes(keyword) || (d.companyName || '').toLowerCase().includes(keyword));
    }
    return pool.slice(0, 8);
  }, [deals, dealPickerQuery, customerIdForProjects, projectId]);

  const activeLinkedDeal = lockedDeal || linkedDeal || null;

  return (
    <section className="crm-wizard-form-section">
      <div className="crm-wizard-section-head">
        <div>
          <h3 className="crm-wizard-form-title">Khách hàng</h3>
          <p className="crm-wizard-form-description">Chọn khách hàng đã có trên hệ thống hoặc tạo khách hàng mới.</p>
        </div>
        <a className="crm-secondary-inline" href="/all-platform/crm/customers" target="_blank" rel="noopener">
          Quản lý khách hàng
        </a>
      </div>

      {lockedDeal ? (
        <div className="crm-quote-customer-picked">
          <div>
            <b>{lockedDeal.customerName}</b>
            {lockedDeal.companyName ? <span> · {lockedDeal.companyName}</span> : null}
            <span className="crm-quote-customer-tag">Gắn với deal này</span>
          </div>
        </div>
      ) : (
        <>
          {!hasCustomer || !pickedExisting ? (
            <div className="crm-quote-customer-search-row">
              <div className="crm-quote-customer-search">
                <input
                  className="crm-input"
                  placeholder="Tìm khách hàng theo tên, SĐT, email, công ty..."
                  value={search}
                  onChange={event => {
                    setSearch(event.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  autoComplete="off"
                />
                {searchQueryReady ? (
                  <div className="crm-quote-customer-results crm-quote-customer-results--cards">
                    {searchLoading ? <div className="crm-quote-customer-empty">Đang tìm...</div> : null}
                    {!searchLoading && searchResults.length === 0 ? (
                      <div className="crm-quote-customer-empty">Không tìm thấy khách hàng nào khớp.</div>
                    ) : (
                      searchResults.map(found => {
                        const isSelected = pickedCustomer?.id === found.id;
                        return (
                          <button
                            type="button"
                            key={found.id}
                            className={`crm-quote-customer-card${isSelected ? ' crm-quote-customer-card--selected' : ''}`}
                            onClick={() => pickExistingCustomer(found)}
                          >
                            <span className="crm-quote-customer-card-avatar">{initialsOf(found.customerName)}</span>
                            <span className="crm-quote-customer-card-body">
                              <strong>{found.companyName || found.customerName}</strong>
                              <small>
                                {found.companyName ? found.customerName : found.position || 'Khách hàng'}
                                {found.dealCount ? ` · ${found.dealCount} deal` : ''}
                              </small>
                              {found.phone ? <small>{found.phone}</small> : null}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
              <button type="button" className="crm-quote-new-customer-button" onClick={startNewCustomer}>
                + Khách hàng mới
              </button>
            </div>
          ) : null}

          {hasCustomer ? (
            <div className="crm-quote-customer-picked">
              <div>
                <b>{customer.customerName || '(Chưa có tên)'}</b>
                {customer.companyName ? <span> · {customer.companyName}</span> : null}
                {pickedExisting ? <span className="crm-quote-customer-tag">Đã có</span> : <span className="crm-quote-customer-tag crm-quote-customer-tag--new">Khách mới</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {pickedExisting && !editingFields ? (
                  <button type="button" className="crm-secondary-inline" onClick={() => setEditingFields(true)}>
                    Sửa thông tin
                  </button>
                ) : null}
                <button type="button" className="crm-secondary-inline" onClick={startNewCustomer}>
                  Đổi khách khác
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {referenceCustomerId ? (
        <div className="crm-quote-crm-linked">
          <span className="crm-quote-crm-linked-badge">✓ Đã liên kết CRM</span>
          {customerStats ? (
            <div className="crm-quote-crm-stats">
              <div>
                <span>Số báo giá</span>
                <strong>{customerStats.count}</strong>
              </div>
              <div>
                <span>Tổng giá trị</span>
                <strong>{formatVndShort(customerStats.totalValue)}</strong>
              </div>
              <div>
                <span>Đã chốt</span>
                <strong>{customerStats.wonCount}</strong>
              </div>
              <div>
                <span>Tỷ lệ chuyển đổi</span>
                <strong>{customerStats.conversionRate}%</strong>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!pickedExisting || editingFields ? (
        <div className="crm-wizard-form-card-grid" style={{ marginTop: '0.85rem' }}>
          <label className="crm-field">
            <span>Tên khách hàng/đơn vị *</span>
            <input value={customer.companyName || customer.customerName} onChange={event => onChangeCustomer({ ...customer, companyName: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Mã số thuế</span>
            <input value={customer.taxCode} onChange={event => onChangeCustomer({ ...customer, taxCode: event.target.value })} />
          </label>
          <label className="crm-field crm-field--full">
            <span>Địa chỉ</span>
            <input value={customer.address} onChange={event => onChangeCustomer({ ...customer, address: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Người nhận báo giá *</span>
            <input value={customer.customerName} onChange={event => onChangeCustomer({ ...customer, customerName: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>SĐT</span>
            <input value={customer.phone} onChange={event => onChangeCustomer({ ...customer, phone: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Email nhận báo giá</span>
            <input value={customer.email} onChange={event => onChangeCustomer({ ...customer, email: event.target.value })} />
          </label>
          <label className="crm-field">
            <span>Sale phụ trách</span>
            {lockedDeal ? (
              <input value={lockedDeal.assignment.sdrName || lockedDeal.assignment.leadName || 'Chưa gán'} disabled readOnly />
            ) : (
              <select value={customer.sdrId} onChange={event => onChangeCustomer({ ...customer, sdrId: event.target.value })}>
                <option value="">-- Chưa chọn --</option>
                {(agents || []).map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      ) : null}

      {!lockedDeal ? (
        <div className="crm-quote-opportunity-card">
          <div className="crm-quote-opportunity-body">
            <span className="crm-quote-opportunity-label">Dự án (tuỳ chọn)</span>
            {!customerIdForProjects ? (
              <select disabled><option>Chọn khách hàng trước</option></select>
            ) : (
              <select
                value={projectId || ''}
                onChange={event => {
                  if (event.target.value === '__create_new_project__') {
                    onRequestCreateProject?.();
                    return;
                  }
                  onChangeProjectId?.(event.target.value);
                }}
              >
                <option value="">Chưa thuộc dự án</option>
                <option value="__create_new_project__">+ Tạo dự án mới…</option>
                {(projects || []).map(p => (
                  <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      ) : null}

      <div className="crm-quote-opportunity-card">
        <div className="crm-quote-opportunity-body">
          <span className="crm-quote-opportunity-label">Liên kết cơ hội CRM</span>
          {activeLinkedDeal ? (
            <strong>{activeLinkedDeal.customerName}{activeLinkedDeal.companyName ? ` · ${activeLinkedDeal.companyName}` : ''}</strong>
          ) : (
            <strong className="crm-quote-opportunity-empty">Chưa gắn — sẽ tự tạo cơ hội mới khi lưu</strong>
          )}
        </div>
        {!lockedDeal && onChangeLinkedDeal ? (
          <button type="button" className="crm-secondary-inline" onClick={() => setDealPickerOpen(open => !open)}>
            Đổi cơ hội
          </button>
        ) : null}
        {dealPickerOpen ? (
          <div className="crm-quote-opportunity-picker">
            <input
              className="crm-input"
              placeholder="Tìm cơ hội theo tên khách/công ty..."
              value={dealPickerQuery}
              onChange={event => setDealPickerQuery(event.target.value)}
              autoFocus
            />
            <div className="crm-quote-opportunity-picker-list">
              {onRequestCreateDeal ? (
                <button
                  type="button"
                  className="crm-quote-opportunity-picker-item"
                  onClick={() => {
                    onRequestCreateDeal();
                    setDealPickerOpen(false);
                  }}
                >
                  + Tạo cơ hội mới…
                </button>
              ) : null}
              {linkedDeal ? (
                <button
                  type="button"
                  className="crm-quote-opportunity-picker-item crm-quote-opportunity-picker-item--clear"
                  onClick={() => {
                    onChangeLinkedDeal?.(null);
                    setDealPickerOpen(false);
                  }}
                >
                  ✕ Bỏ liên kết (tạo cơ hội mới)
                </button>
              ) : null}
              {dealPickerResults.map(deal => (
                <button
                  key={deal.id}
                  type="button"
                  className="crm-quote-opportunity-picker-item"
                  onClick={() => {
                    onChangeLinkedDeal?.(deal);
                    setDealPickerOpen(false);
                  }}
                >
                  <b>{deal.customerName}</b>
                  {deal.companyName ? ` · ${deal.companyName}` : ''}
                </button>
              ))}
              {!dealPickerResults.length ? <div className="crm-quote-customer-empty">Không có cơ hội nào khớp.</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="crm-quote-smart-suggestion">
        <span className="crm-quote-smart-suggestion-icon">💡</span>
        <div>
          <b>Gợi ý thông minh</b>
          <p>
            {customerStats && customerStats.count > 0
              ? `Khách hàng này đã có ${customerStats.count} báo giá trước đây (tỷ lệ chuyển đổi ${customerStats.conversionRate}%) — cân nhắc mẫu và mức giá đã dùng gần nhất để giữ nhất quán.`
              : referenceCustomerId
                ? 'Đây là lần đầu tạo báo giá cho khách hàng này — hệ thống sẽ tự điền thông tin công ty phát hành và mẫu báo giá mặc định ở bước sau.'
                : 'Tìm hoặc chọn khách hàng đã có trên CRM để tự động điền thông tin liên hệ ở bước này.'}
          </p>
        </div>
      </div>
    </section>
  );
}

function formatVndShort(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(
    value || 0
  );
}
