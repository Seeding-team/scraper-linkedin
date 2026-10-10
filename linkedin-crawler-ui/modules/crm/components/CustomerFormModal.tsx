'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { usersService, type QuoteBusinessRoleUser } from '@/services/all-platform.service';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { MemberSearchSelect } from './MemberSearchSelect';
import { CrmCategoryCodeSelect, CrmCategorySelect } from './CrmCategorySelect';
import { PositionSelect } from './PositionSelect';
import { Loader2, X } from './icons';
import type { AppUser } from '@/types/unified.types';
import type { CrmCustomerRow, CrmCustomerStatus } from '../types';
import { deriveShortName, looksLikeEnterprise } from '../utils/customerNames';

const STATUS_OPTIONS: Array<{ value: CrmCustomerStatus; label: string }> = [
  { value: 'new_lead', label: 'Tiềm năng' },
  { value: 'following', label: 'Đang bán' },
  { value: 'current_customer', label: 'Đã mua' },
  { value: 'not_fit', label: 'Ngừng hoạt động' },
];

type FormState = {
  /** Ten viet tat (hien thi o danh sach/tieu de) - tu sinh tu ten cong ty, nguoi dung sua lai duoc. */
  customerName: string;
  /** Cong ty (ten day du) - bat buoc voi doanh nghiep. */
  companyName: string;
  /** Ten viet tat (short_name) - tu de xuat theo ten cong ty, sua duoc. */
  shortName: string;
  /** Nguoi lien he chinh (crm_contacts). */
  contactName: string;
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
    shortName: '',
    contactName: '',
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
    // Luon prefill = ten khach khi chua co company_name rieng (khop voi fallback hien thi "Cong ty: <ten khach>" o
    // Overview - feedback: ten khach hang CHINH LA ten cong ty, mo form Sua ma o trong gay hieu lam la mat du lieu).
    // Van sua/xoa duoc binh thuong neu Sale xac nhan day thuc su la khach ca nhan.
    companyName: customer.companyName || customer.customerName || '',
    shortName: customer.shortName || '',
    contactName: customer.primaryContact?.name || '',
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
  /** 'modal' (mặc định, giữ nguyên hành vi cũ — backdrop + popup riêng) hoặc
   * 'embedded' (2026-10-03: gộp vào drawer "Xem thông tin nhanh" — chỉ hiện
   * khi bấm "Chỉnh sửa" ngay trong drawer, không mở modal/backdrop riêng,
   * không tự khoá scroll body vì drawer cha đã quản lý). KHÔNG tạo logic
   * validate/submit/API mới — tái dùng y hệt, chỉ đổi phần bọc ngoài JSX. */
  variant = 'modal',
}: {
  open: boolean;
  /** Edit-only trong luồng hiện tại — luôn truyền object khách hàng cần sửa. */
  customer?: CrmCustomerRow | null;
  currentUser: AppUser | null;
  onClose: () => void;
  onSaved: (customer: CrmCustomerRow) => void;
  variant?: 'modal' | 'embedded';
}) {
  const isEdit = Boolean(customer);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateRow[]>([]);
  // Ten viet tat: tu dong theo Cong ty cho toi khi nguoi dung tu sua tay (khong ghi de ten da dat tay).
  const [shortTouched, setShortTouched] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  // Nguoi lien he chinh hien co (co the chua kem theo customer - vd trang chi tiet) -> tu nap khi mo form sua.
  const [primaryContact, setPrimaryContact] = useState<{ id: string; name: string } | null>(null);
  // Chuc vu goc cua nguoi lien he chinh (de biet co doi hay khong khi luu) - lay tu chinh Contact, khong phai Khach hang.
  const [contactPositionBase, setContactPositionBase] = useState('');
  // Tat ca nguoi lien he cua khach (chi de hien thi) - truoc day form chi cho thay 1 nguoi.
  const [contactsList, setContactsList] = useState<Array<{ id: string; name: string; position: string; phone: string; email: string; isPrimary: boolean }>>([]);
  // 4 kenh phu (Zalo/Facebook/Telegram/Website) chi hien khi co du lieu hoac bam "+" de them.
  const [extraChannels, setExtraChannels] = useState<Record<'zalo' | 'facebook' | 'telegram' | 'website', boolean>>({ zalo: false, facebook: false, telegram: false, website: false });
  const embedded = variant === 'embedded';
  useBodyScrollLock(embedded ? false : open);
  // Id DUY NHAT cho moi instance (truoc day hardcode "crmCustomerForm") - component nay duoc mount o CA
  // CrmCustomerDetailPage LAN CustomerQuickViewPanel; neu 2 instance cung open cung luc, 2 <form> trung id se
  // khien nut Luu (lien ket qua attribute form="...") co the submit NHAM form khac hoac khong submit gi ca
  // (feedback: "k bấm lưu dc" - bam nhung khong co gi xay ra).
  const formId = useId();

  useEffect(() => {
    if (!open) return;
    setError('');
    setDuplicates([]);
    const initial = customer ? formFromCustomer(customer) : emptyForm();
    setForm(initial);
    setShortTouched(Boolean(customer?.shortNameManual));
    setExtraChannels({ zalo: Boolean(initial.zalo), facebook: Boolean(initial.facebook), telegram: Boolean(initial.telegram), website: Boolean(initial.website) });
    setPrimaryContact(customer?.primaryContact?.id ? { id: customer.primaryContact.id, name: customer.primaryContact.name || '' } : null);
    setContactPositionBase('');
    setContactsList([]);
    if (customer) {
      let alive = true;
      fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customer.id)}/contacts`, { credentials: 'include', headers: headers() })
        .then(res => res.json())
        .then(body => {
          if (!alive || body.success === false || !Array.isArray(body.data) || !body.data.length) return;
          const main = body.data.find((c: { is_primary?: boolean }) => c.is_primary) || body.data[0];
          const digits = (v?: string | null) => String(v || '').replace(/\D/g, '');
          const sameAsCustomer = (c: { phone?: string | null; email?: string | null }) => Boolean((customer?.phone && digits(c.phone) === digits(customer.phone)) || (customer?.email && String(c.email || '').toLowerCase() === String(customer.email).toLowerCase()));
          // Chuc vu: uu tien lien he chinh; neu chua co thi lay cua lien he trung SDT/email dang hien tren form.
          const withPosition = body.data.find((c: { position_category_id?: string | null } & { phone?: string | null; email?: string | null }) => c.position_category_id && sameAsCustomer(c));
          const mainPosition = main.position_category_id || withPosition?.position_category_id || '';
          setContactsList(body.data.map((c: { id: string; name?: string; position_label_snapshot?: string | null; position?: string | null; phone?: string | null; email?: string | null; is_primary?: boolean }) => ({ id: c.id, name: c.name || '', position: c.position_label_snapshot || c.position || '', phone: c.phone || '', email: c.email || '', isPrimary: Boolean(c.is_primary) })));
          setPrimaryContact({ id: main.id, name: main.name || '' });
          setContactPositionBase(mainPosition);
          setForm(current => ({ ...current, contactName: current.contactName || main.name || '', positionCategoryId: mainPosition || current.positionCategoryId }));
        })
        .catch(() => { /* khong co lien he -> de trong */ });
      return () => { alive = false; };
    }
  }, [open, customer]);

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  // Goi y ten viet tat: dien NGAY bang quy tac cuc bo, roi nang cap bang backend (thuong hieu da co/AI) - chong race bang so thu tu.
  const suggestSeq = useRef(0);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function requestSuggestion(company: string, useAi: boolean): Promise<string> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers/suggest-short-name`, {
        method: 'POST', credentials: 'include', headers: headers(),
        body: JSON.stringify({ company_name: company, customer_id: customer?.id, use_ai: useAi }),
      });
      const body = await res.json();
      const value = body?.data?.suggestion;
      if (res.ok && body.success !== false && typeof value === 'string' && value.trim()) return value.trim();
    } catch { /* backend/AI loi -> fallback quy tac cuc bo */ }
    return deriveShortName(company);
  }

  function changeCompany(value: string) {
    setForm(current => ({ ...current, companyName: value, ...(shortTouched ? {} : { shortName: deriveShortName(value) }) }));
    if (shortTouched) return;   // da sua tay -> chi de xuat khi bam "Tao lai goi y", khong tu ghi de
    const seq = ++suggestSeq.current;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!value.trim()) return;
    suggestTimer.current = setTimeout(() => {
      void requestSuggestion(value, true).then(suggestion => {
        if (suggestSeq.current === seq) setForm(current => (current.companyName === value ? { ...current, shortName: suggestion } : current));
      });
    }, 700);
  }

  async function regenerateShortName() {
    const company = form.companyName.trim() || form.customerName.trim();
    if (!company) return;
    setSuggesting(true);
    const suggestion = await requestSuggestion(company, true);
    setSuggesting(false);
    setShortTouched(false);   // nguoi dung chu dong yeu cau -> quay lai che do tu dong
    setForm(current => ({ ...current, shortName: suggestion }));
  }

  const canPickOwner = isAdminOrLeader(currentUser);
  // "Người phụ trách" chỉ nên chọn trong Presale/Sale (feedback "lấy tên k đúng nó phải lấy
  // presale với sale") - truoc day loc tu `members` (toan bo nhan su co tai khoan dang nhap,
  // khong phan biet vai tro) nen hien ca nguoi khong thuoc Sale/Presale. Dung LAI dung API
  // "vai tro nghiep vu bao gia" (app_users.quote_business_role) qua GET /users/by-quote-business-role
  // (da tu gom ca 'sale' lan 'both') - dung y het CustomerAddDrawer.tsx dang dung cho field nay.
  const [ownerAssignableUsers, setOwnerAssignableUsers] = useState<QuoteBusinessRoleUser[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      usersService.getUsersByQuoteBusinessRole('sale'),
      usersService.getUsersByQuoteBusinessRole('presale'),
    ])
      .then(([saleRes, presaleRes]) => {
        if (!alive) return;
        const saleUsers = saleRes.success ? saleRes.data || [] : [];
        const presaleUsers = presaleRes.success ? presaleRes.data || [] : [];
        const assignable = new Map<string, QuoteBusinessRoleUser>();
        [...saleUsers, ...presaleUsers].forEach(user => { if (user.id) assignable.set(user.id, user); });
        setOwnerAssignableUsers([...assignable.values()].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => { if (alive) setOwnerAssignableUsers([]); });
    return () => { alive = false; };
  }, [open]);
  const ownerOptions = useMemo(
    () => ownerAssignableUsers.map(u => ({ id: u.id, display_name: u.name, email: '' })),
    [ownerAssignableUsers],
  );
  const currentUserMissing =
    Boolean(currentUser?.id) && !ownerAssignableUsers.some(u => u.id === currentUser!.id);

  function validate(): string | null {
    const personal = isEdit && !looksLikeEnterprise(customer?.customerName, customer?.companyName, customer?.taxCode) && !form.companyName.trim();
    if (!personal && !form.companyName.trim()) return 'Vui lòng nhập tên công ty.';
    if (!form.phone.trim() && !form.email.trim()) return 'Cần nhập số điện thoại hoặc email.';
    return null;
  }

  /** Nguoi lien he chinh + chuc vu luu o crm_contacts (cap nhat lien he co san, hoac tao moi neu da nhap ten). */
  async function syncPrimaryContact(customerId: string) {
    const name = form.contactName.trim();
    const existing = primaryContact;
    const base = `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`;
    if (existing?.id) {
      const nameChanged = name && name !== (existing.name || '');
      const positionChanged = form.positionCategoryId !== (contactPositionBase || customer?.positionCategoryId || '');
      if (!nameChanged && !positionChanged) return;
      const res = await fetch(`${base}/${encodeURIComponent(existing.id)}`, {
        method: 'PUT', credentials: 'include', headers: headers(),
        body: JSON.stringify({ ...(nameChanged ? { name } : {}), ...(positionChanged ? { position_category_id: form.positionCategoryId || null } : {}) }),
      });
      const out = await res.json();
      if (!res.ok || out.success === false) throw new Error(out?.message || 'Đã lưu hồ sơ nhưng chưa cập nhật được người liên hệ.');
    } else if (name) {
      const res = await fetch(base, {
        method: 'POST', credentials: 'include', headers: headers(),
        body: JSON.stringify({ name, phone: form.phone.trim() || null, email: form.email.trim() || null, position_category_id: form.positionCategoryId || null, is_primary: true }),
      });
      const out = await res.json();
      if (!res.ok || out.success === false) throw new Error(out?.message || 'Đã lưu hồ sơ nhưng chưa tạo được người liên hệ.');
    }
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
        // customer_name giu nguyen khi sua (ten day du/ten dinh danh da co); tao moi = ten cong ty.
        customer_name: isEdit ? (customer?.customerName || form.companyName.trim()) : (form.companyName.trim() || form.customerName.trim()),
        company_name: form.companyName.trim() || null,
        short_name: form.shortName.trim() || null,
        short_name_manual: shortTouched && Boolean(form.shortName.trim()),
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
      const saved = body.data as CrmCustomerRow;
      await syncPrimaryContact(saved.id);
      onSaved({ ...saved, primaryContact: saved.primaryContact || customer?.primaryContact || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được hồ sơ khách hàng.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const formAndFooter = (
    <>
        <form id={formId} className={embedded ? 'crm-quickview-editform-body' : 'crm-modal-body'} onSubmit={handleSubmit}>
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
              <Field label="Công ty" required>
                <input value={form.companyName} onChange={e => changeCompany(e.target.value)} placeholder="Công ty TNHH ABC" />
              </Field>
              <Field label="Tên viết tắt" hint="tự điền theo tên công ty, sửa được">
                <input
                  value={form.shortName}
                  onChange={e => { setShortTouched(true); setValue('shortName', e.target.value); }}
                  placeholder="ABC"
                />
                <button type="button" className="crm-short-regen-btn" data-testid="short-name-regen" disabled={suggesting || !(form.companyName.trim() || form.customerName.trim())} onClick={() => void regenerateShortName()}>
                  {suggesting ? 'Đang gợi ý…' : '↻ Tạo lại gợi ý'}
                </button>
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
            {contactsList.length > 1 ? (
              <ul className="crm-contact-list" data-testid="customer-contact-list">
                {contactsList.map(c => (
                  <li key={c.id}>
                    <b>{c.name || 'Chưa đặt tên'}</b>{c.isPrimary ? <em> · Chính</em> : null}
                    {c.position ? <span> · {c.position}</span> : null}
                    {c.phone ? <span> · {c.phone}</span> : null}
                    {c.email ? <span> · {c.email}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="crm-form-grid">
              <Field label="Người liên hệ" onClear={() => setValue('contactName', '')}>
                <input value={form.contactName} onChange={e => setValue('contactName', e.target.value)} placeholder="Nguyễn Văn A" />
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
              <Field label="Số điện thoại" required hint="cần SĐT hoặc email" onClear={() => setValue('phone', '')}>
                <input value={form.phone} onChange={e => setValue('phone', e.target.value)} type="tel" placeholder="09xxxxxxxx" />
              </Field>
              <Field label="Email" required hint="cần SĐT hoặc email" onClear={() => setValue('email', '')}>
                <input value={form.email} onChange={e => setValue('email', e.target.value)} type="email" placeholder="ten@congty.com" />
              </Field>
              {extraChannels.zalo ? (
                <Field label="Zalo" onClear={() => { setValue('zalo', ''); setExtraChannels(c => ({ ...c, zalo: false })); }}>
                  <input value={form.zalo} onChange={e => setValue('zalo', e.target.value)} placeholder="Số/link Zalo" />
                </Field>
              ) : null}
              {extraChannels.facebook ? (
                <Field label="Facebook" onClear={() => { setValue('facebook', ''); setExtraChannels(c => ({ ...c, facebook: false })); }}>
                  <input value={form.facebook} onChange={e => setValue('facebook', e.target.value)} placeholder="Link Facebook" />
                </Field>
              ) : null}
              {extraChannels.telegram ? (
                <Field label="Telegram" onClear={() => { setValue('telegram', ''); setExtraChannels(c => ({ ...c, telegram: false })); }}>
                  <input value={form.telegram} onChange={e => setValue('telegram', e.target.value)} placeholder="@username hoặc link" />
                </Field>
              ) : null}
              {extraChannels.website ? (
                <Field label="Website" onClear={() => { setValue('website', ''); setExtraChannels(c => ({ ...c, website: false })); }}>
                  <input value={form.website} onChange={e => setValue('website', e.target.value)} placeholder="https://..." />
                </Field>
              ) : null}
            </div>
            {(['zalo', 'facebook', 'telegram', 'website'] as const).some(key => !extraChannels[key]) ? (
              <div className="crm-extra-channels" data-testid="crm-extra-channels">
                {([['zalo', 'Zalo'], ['facebook', 'Facebook'], ['telegram', 'Telegram'], ['website', 'Website']] as const)
                  .filter(([key]) => !extraChannels[key])
                  .map(([key, label]) => (
                    <button key={key} type="button" className="crm-extra-channel-btn" onClick={() => setExtraChannels(c => ({ ...c, [key]: true }))}>
                      + {label}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>

          <div className="crm-form-section">
            <p className="crm-form-title">Thông tin doanh nghiệp</p>
            <div className="crm-form-grid">
              <Field label="Mã số thuế" onClear={() => setValue('taxCode', '')}>
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
                  <MemberSearchSelect
                    value={form.ownerId}
                    onChange={value => setValue('ownerId', value)}
                    placeholder="-- Chính bạn --"
                    showAvatar={false}
                    members={[
                      ...(currentUserMissing && currentUser
                        ? [{ id: currentUser.id, displayName: currentUser.name || currentUser.email || 'Bạn' }]
                        : []),
                      ...ownerOptions.map(m => ({ id: m.id, displayName: m.display_name, email: m.email })),
                    ]}
                  />
                </Field>
              ) : null}
              <Field label="Ghi chú" full={!canPickOwner}>
                <textarea value={form.note} onChange={e => setValue('note', e.target.value)} placeholder="Ghi chú nội bộ..." />
              </Field>
            </div>
          </div>
        </form>

        <footer className={embedded ? 'crm-quickview-editform-footer' : 'crm-modal-footer'}>
          {/* Form co the rat dai/cuon duoc - loi hien o DAU form (tren) de ngoai tam nhin khi dang cuon o duoi, nhin
              nhu bam Luu "khong co gi xay ra" (feedback that). Lap lai NGAY CANH nut Luu de luon thay duoc. */}
          {error ? <p className="crm-error crm-customer-form-error" style={{ margin: 0, flex: '1 1 auto' }}>{error}</p> : null}
          <button type="button" className="crm-cancel-button" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <button type="submit" form={formId} className="crm-save-button" disabled={saving}>
            {saving ? <Loader2 className="crm-save-spinner" /> : null}
            {saving ? 'Đang lưu...' : isEdit ? 'Lưu thay đổi' : 'Tạo khách hàng'}
          </button>
        </footer>
    </>
  );

  if (embedded) return formAndFooter;

  return (
    // Bug thuc te (2026-10-10, kem anh chup): dropdown MemberSearchSelect/
    // SearchableSelect portal menu ra thang document.body (ngoai DOM cua modal
    // nay) - click 1 option trong portal van bubble theo CAY REACT (khong phai
    // DOM) len toi backdrop, khien onClick={onClose} coi la "click ra ngoai"
    // va dong het modal truoc khi kip chon xong. Chi dong khi click THAT SU
    // vao chinh backdrop (event.target === event.currentTarget), bubble tu
    // bat ky phan tu con/portal nao deu bi bo qua.
    <div className="crm-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
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
        {formAndFooter}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  full,
  children,
  onClear,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
  /** Nút "×" xoá nhanh field này (yêu cầu 2026-10-03: "thêm phần xoá thông
   * tin khách hàng" - vd SĐT/email gõ sai, xoá 1 click thay vì bôi đen xoá
   * tay). Chỉ hiện khi truyền - field nào không cần xoá nhanh (vd các field
   * có dropdown/bắt buộc chọn) thì không truyền prop này. */
  onClear?: () => void;
}) {
  return (
    <label className={`crm-field ${full ? 'crm-field--full' : ''}`}>
      <span className="crm-field-label-row">
        <span>
          {label} {hint ? <em>({hint})</em> : null} {required ? <b>*</b> : null}
        </span>
        {onClear ? (
          <button
            type="button"
            className="crm-field-clear-btn"
            title={`Xoá ${label}`}
            onClick={(e) => { e.preventDefault(); onClear(); }}
          >
            ×
          </button>
        ) : null}
      </span>
      {children}
    </label>
  );
}
