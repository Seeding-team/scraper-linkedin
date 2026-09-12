'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useMembers } from '@/hooks/useMembers';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { SearchableSelect } from './SearchableSelect';
import { CrmCategoryCodeSelect, CrmCategorySelect } from './CrmCategorySelect';
import { PositionSelect } from './PositionSelect';
import { Loader2, X } from './icons';
import type { AppUser } from '@/types/unified.types';
import type { CrmCustomerRow, CrmCustomerStatus } from '../types';

const STATUS_OPTIONS: Array<{ value: CrmCustomerStatus; label: string }> = [
  { value: 'new_lead', label: 'Tiềm năng' },
  { value: 'following', label: 'Đang bán' },
  { value: 'current_customer', label: 'Đã mua' },
  { value: 'not_fit', label: 'Ngừng hoạt động' },
];

type FormState = {
  customerName: string;
  companyName: string;
  positionCategoryId: string;
  positionLabel: string;
  phone: string;
  email: string;
  zalo: string;
  facebook: string;
  telegram: string;
  website: string;
  taxCode: string;
  address: string;
  city: string;
  industry: string;
  source: string;
  status: CrmCustomerStatus;
  ownerId: string;
  note: string;
};

function emptyForm(): FormState {
  return {
    customerName: '',
    companyName: '',
    positionCategoryId: '',
    positionLabel: '',
    phone: '',
    email: '',
    zalo: '',
    facebook: '',
    telegram: '',
    website: '',
    taxCode: '',
    address: '',
    city: '',
    industry: '',
    source: 'Manual',
    status: 'new_lead',
    ownerId: '',
    note: '',
  };
}

function formFromCustomer(customer: CrmCustomerRow): FormState {
  return {
    customerName: customer.customerName || '',
    companyName: customer.companyName || '',
    positionCategoryId: customer.positionCategoryId || '',
    positionLabel: customer.positionLabelSnapshot || customer.position || '',
    phone: customer.phone || '',
    email: customer.email || '',
    zalo: customer.zalo || '',
    facebook: customer.facebook || '',
    telegram: customer.telegram || '',
    website: customer.website || '',
    taxCode: customer.taxCode || '',
    address: customer.address || '',
    city: customer.city || '',
    industry: customer.industry || '',
    source: customer.source || 'Manual',
    status: customer.status || 'new_lead',
    ownerId: customer.ownerId || '',
    note: customer.note || '',
  };
}

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function isAdminOrLeader(user: AppUser | null) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'leader';
}

type DuplicateRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

// Kể từ khi có CustomerAddDrawer.tsx (luồng tạo mới 4 bước), modal này chỉ còn
// được CrmCustomersDirectory/CrmCustomerDetailPage gọi ở chế độ SỬA (customer
// luôn khác null trong thực tế). Nhánh "customer == null" (tạo mới) vẫn được
// giữ nguyên trong code cho an toàn/không phá vỡ API của component, nhưng
// không còn đường gọi nào trong UI hiện tại kích hoạt nó nữa.
export function CustomerFormModal({
  open,
  customer,
  currentUser,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Edit-only trong luồng hiện tại — luôn truyền object khách hàng cần sửa. */
  customer?: CrmCustomerRow | null;
  currentUser: AppUser | null;
  onClose: () => void;
  onSaved: (customer: CrmCustomerRow) => void;
}) {
  const isEdit = Boolean(customer);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateRow[]>([]);
  const { members } = useMembers();
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setError('');
    setDuplicates([]);
    setForm(customer ? formFromCustomer(customer) : emptyForm());
  }, [open, customer]);

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  const canPickOwner = isAdminOrLeader(currentUser);
  const selectionKeyOf = (m: { id: string; linked_user_id?: string | null; linked_user_id_2?: string | null }) =>
    m.linked_user_id || m.linked_user_id_2 || m.id;
  const ownerOptions = useMemo(() => {
    const linked = members.filter(m => m.linked_user_id || m.linked_user_id_2);
    return [...linked].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [members]);
  const currentUserMissing =
    Boolean(currentUser?.id) && !ownerOptions.some(m => selectionKeyOf(m) === currentUser!.id);

  function validate(): string | null {
    if (!form.customerName.trim()) return 'Vui lòng nhập tên khách hàng.';
    if (!form.phone.trim() && !form.email.trim()) return 'Cần nhập số điện thoại hoặc email.';
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    setDuplicates([]);
    try {
      const payload: Record<string, unknown> = {
        customer_name: form.customerName.trim(),
        company_name: form.companyName.trim() || null,
        position_category_id: form.positionCategoryId || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        zalo: form.zalo.trim() || null,
        facebook: form.facebook.trim() || null,
        telegram: form.telegram.trim() || null,
        website: form.website.trim() || null,
        tax_code: form.taxCode.trim() || null,
        address: form.address.trim() || null,
        city: form.city || null,
        industry: form.industry || null,
        source: form.source || null,
        status: form.status,
        note: form.note.trim() || null,
      };
      // owner_id chỉ gửi lên khi được phép chọn — backend tự ép về actor cho
      // người không phải admin/leader, gửi thừa cũng không có tác dụng nhưng
      // tránh hiểu nhầm UI có quyền mà không có.
      if (canPickOwner && form.ownerId) payload.owner_id = form.ownerId;

      const url = isEdit
        ? `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customer!.id)}`
        : `${API_BASE_URL}/api/all-platform/crm/customers`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.message || `Lỗi máy chủ (${res.status})`);
      }
      if (body.success === false) {
        const dupRows = (body.data?.duplicates || []) as DuplicateRow[];
        if (dupRows.length) {
          setDuplicates(dupRows);
          setError('Đã có hồ sơ khách hàng trùng số điện thoại hoặc email.');
          return;
        }
        throw new Error(body.message || 'Không lưu được hồ sơ khách hàng.');
      }
      onSaved(body.data as CrmCustomerRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được hồ sơ khách hàng.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="crm-modal-backdrop" onClick={onClose}>
      <div className="crm-modal crm-modal--customer-form" onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header">
          <div>
            <h2 className="crm-modal-title">{isEdit ? 'Sửa hồ sơ khách hàng' : 'Thêm khách hàng'}</h2>
            <p className="crm-modal-subtitle">
              {isEdit ? 'Cập nhật thông tin hồ sơ khách hàng.' : 'Tạo hồ sơ khách hàng mới — không tự tạo deal.'}
            </p>
          </div>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <form id="crmCustomerForm" className="crm-modal-body" onSubmit={handleSubmit}>
          {error ? <p className="crm-error crm-customer-form-error">{error}</p> : null}
          {duplicates.length ? (
            <div className="crm-duplicate-list">
              <p>Trùng với hồ sơ đã có:</p>
              <ul>
                {duplicates.map(dup => (
                  <li key={dup.id}>
                    <span>
                      {dup.customer_name || 'Khách hàng chưa tên'}
                      {dup.company_name ? ` · ${dup.company_name}` : ''}
                      {dup.phone ? ` · ${dup.phone}` : ''}
                      {dup.email ? ` · ${dup.email}` : ''}
                    </span>
                    <Link href={`/all-platform/crm/customers/${dup.id}`} target="_blank" className="crm-duplicate-open-btn">
                      Mở khách hàng
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="crm-customer-form-hint">Hệ thống sẽ kiểm tra khách hàng trùng theo SĐT hoặc Email.</p>

          <div className="crm-form-section">
            <p className="crm-form-title">Thông tin cơ bản</p>
            <div className="crm-form-grid">
              <Field label="Tên khách hàng" required>
                <input value={form.customerName} onChange={e => setValue('customerName', e.target.value)} placeholder="Nguyễn Văn A" />
              </Field>
              <Field label="Công ty">
                <input value={form.companyName} onChange={e => setValue('companyName', e.target.value)} placeholder="Công ty TNHH ABC" />
              </Field>
              <Field label="Chức vụ">
                <PositionSelect
                  value={form.positionCategoryId}
                  labelSnapshot={form.positionLabel}
                  onChange={(id, label) => {
                    setValue('positionCategoryId', id);
                    setValue('positionLabel', label);
                  }}
                />
              </Field>
              <Field label="Trạng thái">
                <select value={form.status} onChange={e => setValue('status', e.target.value as CrmCustomerStatus)}>
                  {STATUS_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="crm-form-section">
            <p className="crm-form-title">Thông tin liên hệ</p>
            <div className="crm-form-grid">
              <Field label="Số điện thoại" required hint="cần SĐT hoặc email">
                <input value={form.phone} onChange={e => setValue('phone', e.target.value)} type="tel" placeholder="09xxxxxxxx" />
              </Field>
              <Field label="Email" required hint="cần SĐT hoặc email">
                <input value={form.email} onChange={e => setValue('email', e.target.value)} type="email" placeholder="ten@congty.com" />
              </Field>
              <Field label="Zalo">
                <input value={form.zalo} onChange={e => setValue('zalo', e.target.value)} placeholder="Số/link Zalo" />
              </Field>
              <Field label="Facebook">
                <input value={form.facebook} onChange={e => setValue('facebook', e.target.value)} placeholder="Link Facebook" />
              </Field>
              <Field label="Telegram">
                <input value={form.telegram} onChange={e => setValue('telegram', e.target.value)} placeholder="@username hoặc link" />
              </Field>
              <Field label="Website">
                <input value={form.website} onChange={e => setValue('website', e.target.value)} placeholder="https://..." />
              </Field>
            </div>
          </div>

          <div className="crm-form-section">
            <p className="crm-form-title">Thông tin doanh nghiệp</p>
            <div className="crm-form-grid">
              <Field label="Mã số thuế">
                <input value={form.taxCode} onChange={e => setValue('taxCode', e.target.value)} />
              </Field>
              <Field label="Lĩnh vực">
                <CrmCategoryCodeSelect categoryType="crm_industry" value={form.industry} onChange={value => setValue('industry', value)} placeholder="-- Chọn --" />
              </Field>
              <Field label="Thành phố">
                <CrmCategorySelect categoryType="crm_city" value={form.city} onChange={value => setValue('city', value)} placeholder="-- Chọn --" />
              </Field>
              <Field label="Nguồn">
                <CrmCategoryCodeSelect categoryType="crm_source" value={form.source} onChange={value => setValue('source', value)} />
              </Field>
              <Field full label="Địa chỉ">
                <input value={form.address} onChange={e => setValue('address', e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="crm-form-section">
            <p className="crm-form-title">Quản lý</p>
            <div className="crm-form-grid">
              {canPickOwner ? (
                <Field label="Người phụ trách">
                  <select value={form.ownerId} onChange={e => setValue('ownerId', e.target.value)}>
                    <option value="">-- Chính bạn --</option>
                    {currentUserMissing && currentUser ? (
                      <option value={currentUser.id}>{currentUser.name || currentUser.email}</option>
                    ) : null}
                    {ownerOptions.map(m => (
                      <option key={m.id} value={selectionKeyOf(m)}>
                        {m.display_name}{m.email ? ` (${m.email})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Ghi chú" full={!canPickOwner}>
                <textarea value={form.note} onChange={e => setValue('note', e.target.value)} placeholder="Ghi chú nội bộ..." />
              </Field>
            </div>
          </div>
        </form>

        <footer className="crm-modal-footer">
          <button type="button" className="crm-cancel-button" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button type="submit" form="crmCustomerForm" className="crm-save-button" disabled={saving}>
            {saving ? <Loader2 className="crm-save-spinner" /> : null}
            {saving ? 'Đang lưu...' : isEdit ? 'Lưu thay đổi' : 'Tạo khách hàng'}
          </button>
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
