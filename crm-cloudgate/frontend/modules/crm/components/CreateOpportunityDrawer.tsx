'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { CurrencyInput } from '@/components/CurrencyInput';
import { parseCurrencyInput } from '@/lib/currency';
import { useMembers } from '@/hooks/useMembers';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { allPlatformCategoriesService } from '@/services/all-platform.service';
import { formatVND } from '../constants/crmConfig';
import {
  CustomerProfileCombobox,
  emptyDealForm,
  buildDealPayload,
  CREATE_STAGE_CHIPS,
  CREATE_STAGE_LABELS,
  type DealFormState,
} from './DealFormFields';
import { DEAL_STAGE_META } from '../constants/crmConfig';
import { CrmContactsPanel } from './CrmContactsPanel';
import { SearchableSelect } from './SearchableSelect';
import { CrmCategoryCodeSelect, CrmCategorySelect } from './CrmCategorySelect';
import { Loader2, X } from './icons';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { CreateDealInput, CrmCustomerRow } from '../types';
import type { AppUser } from '@/types/unified.types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function isAdminOrLeader(user: AppUser | null) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'leader';
}

type ApiContact = {
  id: string;
  name: string;
  position?: string;
  position_label_snapshot?: string;
  phone?: string;
  email?: string;
};

/**
 * Vai trò trong quyết định mua — enum nhỏ MỚI, chưa có cột riêng nào trong DB
 * để lưu (crm_contacts không có cột "role", cũng không có bảng deal-contact-
 * link riêng). Quyết định lưu trữ (judgment call, xem báo cáo cuối task):
 * gộp "<Tên contact> — <Vai trò>" vào thẳng cột `decision_maker` đã có sẵn
 * trên customer_leads (dùng đúng cho mục đích "người quyết định mua" từ
 * trước tới giờ) — KHÔNG thêm cột/migration mới, vì đây là nơi additive nhỏ
 * nhất có thể và ngữ nghĩa cột đã khớp.
 */
const CONTACT_ROLE_OPTIONS = [
  { value: 'Decision Maker', label: 'Người quyết định' },
  { value: 'Influencer', label: 'Người ảnh hưởng' },
  { value: 'User', label: 'Người sử dụng' },
  { value: 'Finance-Procurement', label: 'Tài chính/Mua hàng' },
];

/**
 * "Nguồn cơ hội" — Referral đã có sẵn trong danh mục crm_source. 3 giá trị
 * còn lại (Existing_Customer/Lead_Convert/Upsell) được thêm mới qua migration
 * 081_crm_source_opportunity_values.sql (chỉ INSERT thêm category, không đụng
 * dữ liệu cũ) — xem _validate_source() ở backend (crm_customer_service.py),
 * nguồn hợp lệ do bảng categories(category_type='crm_source') quyết định từ
 * migration 056, không còn CHECK constraint cứng.
 */
const STAGE_PROBABILITY: Partial<Record<string, number>> = {
  new_lead: 10,
  contacted: 20,
  qualified: 35,
  proposal_sent: 60,
  negotiation: 75,
};

type ProductOption = { value: string; label: string };

function customerRowToForm(customer: CrmCustomerRow, ownerId: string): DealFormState {
  return {
    ...emptyDealForm(),
    customerId: customer.id,
    customerProfileCanEdit: Boolean(customer.canEdit),
    customerName: customer.customerName || '',
    companyName: customer.companyName || '',
    taxCode: customer.taxCode || '',
    phone: customer.phone || '',
    email: customer.email || '',
    sourcePlatform: 'Existing_Customer',
    sdrId: ownerId || customer.ownerId || '',
  };
}

export function CreateOpportunityDrawer({
  open,
  customer,
  currentUser,
  onClose,
  onCreated,
  onCreatedAndOpen,
}: {
  open: boolean;
  customer: CrmCustomerRow | null;
  currentUser: AppUser | null;
  onClose: () => void;
  /** Tạo xong, ở lại danh sách (đóng drawer + báo cho trang cha reload số liệu). */
  onCreated: () => void;
  /** Tạo xong, mở luôn deal vừa tạo (điều hướng sang trang CRM kèm ?openDeal=<id>). */
  onCreatedAndOpen: (dealId: string) => void;
}) {
  useBodyScrollLock(open);
  const { members } = useMembers();
  const canSwitchCustomer = isAdminOrLeader(currentUser);
  const canPickOwner = isAdminOrLeader(currentUser);

  const [customerForm, setCustomerForm] = useState<DealFormState>(() => emptyDealForm());
  const [contactCount, setContactCount] = useState(0);
  const [dealCount, setDealCount] = useState(0);
  const [ownerNameHint, setOwnerNameHint] = useState('');

  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsReloadTick, setContactsReloadTick] = useState(0);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [contactRole, setContactRole] = useState('Decision Maker');

  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productValue, setProductValue] = useState('');
  const [dealName, setDealName] = useState('');
  const [dealNameTouched, setDealNameTouched] = useState(false);
  const [estimatedBudget, setEstimatedBudget] = useState('');

  const [oppSource, setOppSource] = useState('Existing_Customer');
  const [closeDate, setCloseDate] = useState('');

  const [saving, setSaving] = useState<'' | 'stay' | 'deal' | 'calendar'>('');
  const [error, setError] = useState('');

  const setCustomerFormValue = <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => {
    setCustomerForm(current => ({ ...current, [key]: value }));
  };

  // Reset toan bo state moi lan mo drawer voi 1 khach hang (row) khac.
  useEffect(() => {
    if (!open || !customer) return;
    const ownerId = customer.ownerId || currentUser?.id || '';
    setCustomerForm(customerRowToForm(customer, ownerId));
    setContactCount(customer.contactCount || 0);
    setDealCount(customer.dealCount || 0);
    setOwnerNameHint('');
    setSelectedContactId('');
    setContactRole('Decision Maker');
    setProductValue('');
    setDealName('');
    setDealNameTouched(false);
    setEstimatedBudget('');
    setOppSource('Existing_Customer');
    setCloseDate('');
    setError('');
    setSaving('');
  }, [open, customer?.id]);

  // Ten hien thi Owner - tra cuu qua useMembers (cung nguon voi cac noi khac trong CRM).
  useEffect(() => {
    const key = customerForm.sdrId;
    if (!key) {
      setOwnerNameHint('');
      return;
    }
    const match = members.find(m => (m.linked_user_id || m.linked_user_id_2) === key);
    setOwnerNameHint(match ? match.display_name : customerForm.sdrNameHint || '');
  }, [customerForm.sdrId, members, customerForm.sdrNameHint]);

  // Khi doi sang khach hang khac (qua combobox "Doi") - tai lai contact count/
  // deal count/owner that cua khach hang do, khong dung so cu cua row trigger.
  useEffect(() => {
    if (!open || !customerForm.customerId) return;
    let alive = true;
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerForm.customerId)}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được hồ sơ khách hàng.');
        return body.data as { deal_count?: number; contact_count?: number; owner_id?: string };
      })
      .then(data => {
        if (!alive) return;
        setDealCount(Number(data.deal_count || 0));
        setContactCount(Number(data.contact_count || 0));
        if (!customerForm.sdrId && data.owner_id) setCustomerFormValue('sdrId', data.owner_id);
      })
      .catch(() => {
        /* im lang - khong chan luong chinh vi 1 so lieu phu tai khong duoc */
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerForm.customerId]);

  // Danh sach Contact CHI thuoc khach hang dang chon (Phan 2).
  useEffect(() => {
    if (!open || !customerForm.customerId) return;
    let alive = true;
    setContactsLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerForm.customerId)}/contacts`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được danh sách liên hệ.');
        return (body.data || []) as ApiContact[];
      })
      .then(rows => {
        if (!alive) return;
        setContacts(rows);
        setContactCount(rows.length);
        setSelectedContactId(current => (rows.some(r => r.id === current) ? current : rows[0]?.id || ''));
      })
      .catch(() => {
        if (alive) setContacts([]);
      })
      .finally(() => {
        if (alive) setContactsLoading(false);
      });
    return () => { alive = false; };
  }, [open, customerForm.customerId, contactsReloadTick]);

  // Danh muc san pham/dich vu (category_type=crm_service_package) - goi thang
  // API categories, khong cho luong nay bi block boi component share cua agent
  // song song neu chua xong.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void allPlatformCategoriesService.getAll('crm_service_package', { activeOnly: true }).then(res => {
      if (!alive) return;
      setProductOptions((res.data || []).map(c => ({ value: c.code, label: c.name || c.code })));
    });
    return () => { alive = false; };
  }, [open]);

  // Ten co hoi tu sinh = "<Cong ty/Khach hang> - <San pham>", van sua tay
  // duoc - ngung tu dong cap nhat ngay khi Sale go tay vao o Ten co hoi.
  useEffect(() => {
    if (dealNameTouched) return;
    const product = productOptions.find(p => p.value === productValue)?.label || productValue;
    const company = customerForm.companyName || customerForm.customerName;
    if (company && product) setDealName(`${company} - ${product}`);
    else if (company) setDealName(company);
  }, [dealNameTouched, productValue, productOptions, customerForm.companyName, customerForm.customerName]);

  const selectedContact = contacts.find(c => c.id === selectedContactId) || null;
  const stageProbability = STAGE_PROBABILITY[customerForm.stage] ?? 0;

  const reviewReady =
    Boolean(customerForm.customerId) &&
    Boolean(productValue) &&
    Boolean(dealName.trim()) &&
    Boolean(customerForm.followUpDate) &&
    Boolean(customerForm.nextStep.trim());

  function validate(): string | null {
    if (!customerForm.customerId) return 'Vui lòng chọn khách hàng.';
    if (!productValue) return 'Vui lòng chọn sản phẩm/dịch vụ khách đang quan tâm.';
    if (!dealName.trim()) return 'Vui lòng nhập tên cơ hội.';
    if (!customerForm.nextStep.trim()) return 'Vui lòng chọn/nhập việc tiếp theo.';
    if (!customerForm.followUpDate.trim()) return 'Vui lòng chọn ngày follow-up cho việc tiếp theo.';
    return null;
  }

  function buildPayload() {
    const decisionMaker = selectedContact ? `${selectedContact.name} — ${contactRole}` : '';
    // "Tên cơ hội" và "Dự kiến chốt" chưa có cột riêng nào trên customer_leads
    // (grep toàn bộ BASE_COLUMNS không thấy deal_name/close_date) — judgment
    // call: KHÔNG fabricate migration mới cho 2 field UI-only này, gộp vào
    // đầu `note` thay vì mất thông tin. Xem báo cáo cuối task.
    const noteLines = [`Tên cơ hội: ${dealName.trim()}`];
    if (closeDate) noteLines.push(`Dự kiến chốt: ${closeDate}`);
    const form: DealFormState = {
      ...customerForm,
      servicePackage: productValue,
      estimatedBudget,
      decisionMaker,
      sourcePlatform: oppSource,
      note: noteLines.join('\n'),
    };
    // buildDealPayload() luon tra ve du field cho tao moi (chi khai bao kieu
    // hop nhat CreateDealInput|UpdateDealInput vi dung chung cho ca sua deal) -
    // ep kieu ve CreateDealInput vi drawer nay chi bao gio TAO moi.
    return buildDealPayload(form) as CreateDealInput;
  }

  async function handleCreate(mode: 'stay' | 'deal' | 'calendar') {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(mode);
    try {
      const payload = buildPayload();
      const deal = await seedingCrmRepository.createDeal(payload);
      if (mode === 'stay') {
        onCreated();
      } else {
        // "Tạo và mở lịch" KHÔNG có trang lịch/calendar thật nào trong CRM
        // (đã grep toàn bộ modules/crm, không tìm thấy) — hành xử giống hệt
        // "Tạo và mở Deal", nói rõ điều này trong báo cáo cuối task thay vì
        // giả lập 1 trang lịch không có thật.
        onCreatedAndOpen(deal.id);
      }
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Không tạo được cơ hội.');
    } finally {
      setSaving('');
    }
  }

  if (!open || !customer) return null;

  return (
    <div className="crm-drawer-backdrop" onClick={onClose}>
      <div className="crm-customer-drawer" onClick={event => event.stopPropagation()}>
        <header className="crm-customer-drawer-header">
          <div>
            <h2>Tạo cơ hội bán hàng</h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b', maxWidth: '38rem' }}>
              Chọn khách hàng → chọn sản phẩm → xác nhận việc tiếp theo. Phần còn lại hệ thống tự điền.
            </p>
          </div>
          <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-drawer-body">
          {error ? <p className="crm-error crm-customer-form-error">{error}</p> : null}

          <section className="crm-form-section">
            <p className="crm-form-title">1. Khách hàng / Công ty</p>
            <div className="crm-opportunity-summary-card">
              <span><strong>{customerForm.companyName || customerForm.customerName || 'Chưa chọn'}</strong></span>
              <span>MST: {customerForm.taxCode || '—'}</span>
              <span>{contactCount} contact</span>
              <span>{dealCount} deal</span>
              <span>Owner: {ownerNameHint || 'Chưa gán'}</span>
            </div>
            <CustomerProfileCombobox form={customerForm} setValue={setCustomerFormValue} disabled={!canSwitchCustomer} />
            {!canSwitchCustomer ? (
              <p className="crm-customer-form-hint">Chỉ admin/leader mới đổi được sang khách hàng khác.</p>
            ) : null}
          </section>

          <section className="crm-form-section">
            <p className="crm-form-title">2. Người liên hệ</p>
            {contactsLoading ? (
              <p className="crm-small"><Loader2 className="crm-spin-icon" /> Đang tải danh sách liên hệ...</p>
            ) : contacts.length ? (
              <div className="crm-form-grid">
                <Field label="Liên hệ">
                  <select value={selectedContactId} onChange={e => setSelectedContactId(e.target.value)}>
                    <option value="">-- Chưa chọn --</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.position || c.position_label_snapshot ? ` (${c.position_label_snapshot || c.position})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vai trò trong quyết định mua">
                  <select value={contactRole} onChange={e => setContactRole(e.target.value)}>
                    {CONTACT_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
            ) : (
              <div className="crm-opportunity-empty-contacts">
                <span>Khách hàng này chưa có Contact nào.</span>
              </div>
            )}
            {customerForm.customerId ? (
              <details style={{ marginTop: '0.6rem' }}>
                <summary className="crm-inline-link-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
                  {contacts.length ? '+ Thêm Contact khác' : '+ Thêm Contact'}
                </summary>
                <div style={{ marginTop: '0.5rem' }} onClick={() => setContactsReloadTick(tick => tick + 1)}>
                  <CrmContactsPanel customerId={customerForm.customerId} canEdit />
                </div>
              </details>
            ) : null}
          </section>

          <section className="crm-form-section">
            <p className="crm-form-title">3. Khách đang quan tâm gì</p>
            <div className="crm-form-grid">
              <Field label="Sản phẩm / dịch vụ" required>
                <SearchableSelect value={productValue} onChange={setProductValue} options={productOptions} placeholder="-- Chọn --" />
              </Field>
              <Field label="Tên cơ hội" required>
                <input
                  value={dealName}
                  onChange={e => { setDealName(e.target.value); setDealNameTouched(true); }}
                  placeholder="VD: Công ty ABC - Markee CRM"
                />
              </Field>
              <Field label="Giá trị ước tính (VND)" hint="danh mục sản phẩm chưa có giá niêm yết, nhập tay">
                <CurrencyInput
                  value={parseCurrencyInput(estimatedBudget)}
                  onChange={value => setEstimatedBudget(value != null ? String(value) : '')}
                  placeholder="VD: 50.000.000"
                />
              </Field>
            </div>
          </section>

          <section className="crm-form-section">
            <p className="crm-form-title">4. Bước bán hàng và người phụ trách</p>
            <div className="crm-form-grid">
              <Field full label="Giai đoạn" required>
                <div className="crm-stage-filter">
                  {CREATE_STAGE_CHIPS.map(stage => {
                    const selected = customerForm.stage === stage;
                    return (
                      <button
                        type="button"
                        key={stage}
                        className={`crm-stage-pill ${selected ? 'crm-stage-pill--selected' : 'crm-stage-pill--idle'}`}
                        style={selected ? { background: DEAL_STAGE_META[stage].color, borderColor: DEAL_STAGE_META[stage].color, color: '#fff' } : undefined}
                        onClick={() => setCustomerFormValue('stage', stage)}
                      >
                        {CREATE_STAGE_LABELS[stage]} · {STAGE_PROBABILITY[stage] ?? 0}%
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Người phụ trách">
                <select
                  value={customerForm.sdrId}
                  disabled={!canPickOwner}
                  onChange={e => {
                    const value = e.target.value;
                    const match = members.find(m => (m.linked_user_id || m.linked_user_id_2) === value);
                    setCustomerFormValue('sdrId', value);
                    setCustomerFormValue('sdrNameHint', match ? match.display_name : '');
                  }}
                >
                  <option value="">-- Chưa giao --</option>
                  {members.filter(m => m.linked_user_id || m.linked_user_id_2).map(m => (
                    <option key={m.id} value={m.linked_user_id || m.linked_user_id_2 || ''}>{m.display_name}</option>
                  ))}
                </select>
                {!canPickOwner ? <p className="crm-customer-form-hint">Mặc định theo Owner của khách hàng — chỉ admin/leader đổi được.</p> : null}
              </Field>
              <Field label="Dự kiến chốt">
                <input value={closeDate} onChange={e => setCloseDate(e.target.value)} type="date" />
              </Field>
              <Field label="Nguồn cơ hội">
                <CrmCategoryCodeSelect
                  categoryType="crm_source"
                  value={oppSource}
                  onChange={setOppSource}
                />
              </Field>
            </div>
          </section>

          <section className="crm-form-section">
            <p className="crm-form-title">5. Việc tiếp theo <b>*</b></p>
            <div className="crm-form-grid">
              <Field label="Việc cần làm" required>
                <CrmCategorySelect
                  categoryType="crm_next_step"
                  value={customerForm.nextStep}
                  onChange={value => setCustomerFormValue('nextStep', value)}
                  placeholder="-- Chọn --"
                  excludeLabels={["Khác", "Khac"]}
                />
              </Field>
              <Field label="Ngày follow-up" required>
                <input value={customerForm.followUpDate} onChange={e => setCustomerFormValue('followUpDate', e.target.value)} type="datetime-local" />
              </Field>
            </div>
          </section>

          <section className="crm-form-section">
            <p className="crm-form-title">6. Kiểm tra trước khi tạo</p>
            <div className="crm-opportunity-review-list">
              <div className="crm-opportunity-review-row"><span>Khách hàng</span><span>{customerForm.companyName || customerForm.customerName || '—'}</span></div>
              <div className="crm-opportunity-review-row"><span>Liên hệ</span><span>{selectedContact ? `${selectedContact.name} (${contactRole})` : 'Chưa chọn'}</span></div>
              <div className="crm-opportunity-review-row"><span>Sản phẩm</span><span>{productOptions.find(p => p.value === productValue)?.label || productValue || '—'}</span></div>
              <div className="crm-opportunity-review-row"><span>Tên cơ hội</span><span>{dealName || '—'}</span></div>
              <div className="crm-opportunity-review-row"><span>Giai đoạn</span><span>{CREATE_STAGE_LABELS[customerForm.stage] || customerForm.stage} ({stageProbability}%)</span></div>
              <div className="crm-opportunity-review-row"><span>Giá trị ước tính</span><span>{estimatedBudget ? formatVND(Number(estimatedBudget.replace(/[^0-9]/g, '')) || 0) : '—'}</span></div>
              <div className="crm-opportunity-review-row"><span>Người phụ trách</span><span>{ownerNameHint || 'Chưa gán'}</span></div>
              <div className="crm-opportunity-review-row"><span>Việc tiếp theo</span><span>{customerForm.nextStep || '—'}{customerForm.followUpDate ? ` · ${customerForm.followUpDate.replace('T', ' ')}` : ''}</span></div>
            </div>
            {!reviewReady ? <p className="crm-customer-form-hint">Điền đủ các mục bắt buộc (*) ở trên để có thể tạo cơ hội.</p> : null}
          </section>
        </div>

        <footer className="crm-drawer-footer crm-customer-drawer-footer">
          <div className="crm-customer-drawer-nav">
            <button type="button" className="crm-cancel-button" onClick={onClose} disabled={saving !== ''}>
              Hủy
            </button>
          </div>
          <div className="crm-footer-actions">
            <button type="button" className="crm-secondary-button" disabled={!reviewReady || saving !== ''} onClick={() => void handleCreate('stay')}>
              {saving === 'stay' ? <Loader2 className="crm-save-spinner" /> : null}
              Tạo cơ hội
            </button>
            <button
              type="button"
              className="crm-secondary-button"
              disabled={!reviewReady || saving !== ''}
              title="Chưa có trang lịch/scheduling riêng trong CRM — hành xử giống 'Tạo và mở Deal'."
              onClick={() => void handleCreate('calendar')}
            >
              {saving === 'calendar' ? <Loader2 className="crm-save-spinner" /> : null}
              Tạo và mở lịch
            </button>
            <button type="button" className="crm-save-button" disabled={!reviewReady || saving !== ''} onClick={() => void handleCreate('deal')}>
              {saving === 'deal' ? <Loader2 className="crm-save-spinner" /> : null}
              Tạo và mở Deal
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  full,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`crm-field ${full ? 'crm-field--full' : ''}`}>
      <span>
        {label} {hint ? <em>({hint})</em> : null} {required ? <b>*</b> : null}
      </span>
      {children}
    </label>
  );
}
