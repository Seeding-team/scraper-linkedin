'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { usersService, type QuoteBusinessRoleUser } from '@/services/all-platform.service';
import { SearchableSelect } from './SearchableSelect';
import { CrmCategoryCodeSelect, CrmCategorySelect } from './CrmCategorySelect';
import { PositionSelect } from './PositionSelect';
import { ChevronDown, Loader2, X } from './icons';
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

type QuickSearchRow = {
  id: string;
  customerName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  taxCode?: string;
};

type CompanyForm = {
  customerName: string;
  taxCode: string;
  website: string;
  city: string;
  address: string;
  industry: string;
  source: string;
};

type ContactForm = {
  name: string;
  positionCategoryId: string;
  positionLabel: string;
  phone: string;
  email: string;
  zalo: string;
  facebook: string;
};

type ManageForm = {
  ownerId: string;
  saleManagerId: string;
  status: 'new_lead' | 'following' | 'current_customer';
  note: string;
  nextStep: string;
  followUpDate: string;
};

function emptyCompany(): CompanyForm {
  return { customerName: '', taxCode: '', website: '', city: '', address: '', industry: '', source: 'Manual' };
}
function emptyContact(): ContactForm {
  return { name: '', positionCategoryId: '', positionLabel: '', phone: '', email: '', zalo: '', facebook: '' };
}
function emptyManage(): ManageForm {
  return { ownerId: '', saleManagerId: '', status: 'new_lead', note: '', nextStep: '', followUpDate: '' };
}

const STATUS_OPTIONS: Array<{ value: ManageForm['status']; label: string; hint: string }> = [
  { value: 'new_lead', label: 'Tiềm năng', hint: 'Đã biết doanh nghiệp nhưng chưa có Deal.' },
  { value: 'following', label: 'Đang bán', hint: 'Đang có nhu cầu/cơ hội bán hàng.' },
  { value: 'current_customer', label: 'Đã mua', hint: 'Khách hàng hiện hữu / import từ hệ thống cũ.' },
];

const ANCHORS = [
  { key: 'crm', label: 'Tìm CRM' },
  { key: 'company', label: 'Công ty' },
  { key: 'contact', label: 'Contact chính' },
  { key: 'manage', label: 'Quản lý' },
] as const;

type AnchorKey = (typeof ANCHORS)[number]['key'];

/**
 * Drawer "Thêm khách hàng" (tạo mới) — single-page scrollable form, thay cho
 * wizard 4 bước cũ (currentStep + nút Quay lại/Tiếp theo). Toàn bộ section
 * hiển thị cùng lúc, cuộn dọc trong 1 drawer; thanh ANCHORS chỉ mô tả luồng +
 * cuộn-tới-vị-trí khi bấm, KHÔNG chặn hay yêu cầu "Tiếp theo" như trước. Toàn
 * bộ logic tạo khách hàng (tìm trùng, tự điền, 3 hành động tạo) giữ nguyên
 * 100% — chỉ đổi cách trình bày.
 *
 * Sửa hồ sơ đã có vẫn dùng CustomerFormModal (centered) như cũ.
 */
export function CustomerAddDrawer({
  open,
  currentUser,
  onClose,
  onCreated,
}: {
  open: boolean;
  currentUser: AppUser | null;
  onClose: () => void;
  onCreated: (customerId: string) => void;
}) {
  useBodyScrollLock(open);
  const canPickOwner = isAdminOrLeader(currentUser);

  // "Sale manager" (yeu cau rieng, canh "Nguoi phu trach") - danh sach chon
  // KHONG phai 1 co che moi, dung LAI "vai tro nghiep vu bao gia" da co san
  // (app_users.quote_business_role) qua GET /users/by-quote-business-role -
  // API nay da tu gom ca 'sale' lan 'both' (list_users_by_quote_business_role()),
  // dung y het cach QuoteWorkspaceModal dung cho picker Presale/Sale.
  const [ownerAssignableOptions, setOwnerAssignableOptions] = useState<QuoteBusinessRoleUser[]>([]);
  const [saleManagerOptions, setSaleManagerOptions] = useState<QuoteBusinessRoleUser[]>([]);
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
        [...saleUsers, ...presaleUsers].forEach(user => {
          if (user.id) assignable.set(user.id, user);
        });
        setOwnerAssignableOptions([...assignable.values()].sort((a, b) => a.name.localeCompare(b.name)));
        setSaleManagerOptions(saleUsers.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (alive) {
          setOwnerAssignableOptions([]);
          setSaleManagerOptions([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<QuickSearchRow[]>([]);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [company, setCompany] = useState<CompanyForm>(emptyCompany);
  const [contact, setContact] = useState<ContactForm>(emptyContact);
  const [manage, setManage] = useState<ManageForm>(emptyManage);
  const [saving, setSaving] = useState<'' | 'plain' | 'contact' | 'deal'>('');
  const [error, setError] = useState('');
  const [activeAnchor, setActiveAnchor] = useState<AnchorKey>('crm');
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  const [splitMenuPos, setSplitMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const crmSectionRef = useRef<HTMLElement>(null);
  const companySectionRef = useRef<HTMLElement>(null);
  const contactSectionRef = useRef<HTMLElement>(null);
  const manageSectionRef = useRef<HTMLElement>(null);
  const customerNameInputRef = useRef<HTMLInputElement>(null);
  const nextStepInputRef = useRef<HTMLInputElement>(null);
  const followUpDateInputRef = useRef<HTMLInputElement>(null);
  const splitTriggerRef = useRef<HTMLButtonElement>(null);
  const splitMenuListRef = useRef<HTMLDivElement>(null);

  const sectionRefsByAnchor: Record<AnchorKey, React.RefObject<HTMLElement | null>> = {
    crm: crmSectionRef,
    company: companySectionRef,
    contact: contactSectionRef,
    manage: manageSectionRef,
  };

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMatches([]);
    setSearchedOnce(false);
    setCompany(emptyCompany());
    setContact(emptyContact());
    setManage(emptyManage());
    setError('');
    setSaving('');
    setActiveAnchor('crm');
    setSplitMenuOpen(false);
  }, [open]);

  // Debounce 300ms — reuse cung UX voi CustomerProfileCombobox (DealFormFields.tsx).
  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setMatches([]);
      setSearchedOnce(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE_URL}/api/all-platform/crm/customers/quick-search?q=${encodeURIComponent(keyword)}&limit=5`, {
        credentials: 'include',
        headers: headers(),
      })
        .then(async res => {
          const body = await res.json();
          if (!res.ok || body.success === false) throw new Error(body.message || 'Không tìm được.');
          return (body.data || []) as Array<Record<string, unknown>>;
        })
        .then(rows => {
          if (!alive) return;
          setMatches(
            rows.map(row => ({
              id: String(row.id),
              customerName: String(row.customerName || row.customer_name || ''),
              companyName: String(row.companyName || row.company_name || ''),
              phone: String(row.phone || ''),
              email: String(row.email || ''),
            })),
          );
          setSearchedOnce(true);
        })
        .catch(() => {
          if (alive) {
            setMatches([]);
            setSearchedOnce(true);
          }
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const hasBlockingMatch = matches.length > 0;

  function setCompanyField<K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) {
    setCompany(current => ({ ...current, [key]: value }));
  }
  function setContactField<K extends keyof ContactForm>(key: K, value: ContactForm[K]) {
    setContact(current => ({ ...current, [key]: value }));
  }
  function setManageField<K extends keyof ManageForm>(key: K, value: ManageForm[K]) {
    setManage(current => ({ ...current, [key]: value }));
  }

  const ownerSelectOptions = useMemo(
    () => ownerAssignableOptions.map(user => ({ value: user.id, label: user.name })),
    [ownerAssignableOptions],
  );
  const saleManagerSelectOptions = useMemo(
    () => saleManagerOptions.map(user => ({ value: user.id, label: user.name })),
    [saleManagerOptions],
  );

  const contactFilled = Boolean(
    contact.name.trim() || contact.phone.trim() || contact.email.trim() || contact.positionCategoryId || contact.zalo.trim() || contact.facebook.trim(),
  );
  const isFollowing = manage.status === 'following';

  function validateStep2(): string | null {
    if (!company.customerName.trim()) return 'Vui lòng nhập tên doanh nghiệp.';
    return null;
  }
  function validateStep4ForFollowing(): string | null {
    if (!isFollowing) return null;
    if (!manage.nextStep.trim()) return 'Vui lòng nhập "Sale cần làm gì tiếp" khi trạng thái là Đang bán.';
    if (!manage.followUpDate.trim()) return 'Vui lòng chọn "Khi nào làm" khi trạng thái là Đang bán.';
    return null;
  }

  /** Validate toàn bộ form (không còn theo từng step) - lỗi đầu tiên tìm thấy
   * sẽ tự cuộn + focus đúng field, thay vì chỉ hiện banner lỗi chung chung
   * như form single-page vẫn có thể khiến người dùng không biết lỗi ở đâu. */
  function validateAll(): boolean {
    const companyErr = validateStep2();
    if (companyErr) {
      setError(companyErr);
      companySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => customerNameInputRef.current?.focus(), 300);
      return false;
    }
    if (canPickOwner && !manage.ownerId) {
      setError('Vui lòng chọn người phụ trách thuộc nhóm Sale/Presale.');
      manageSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return false;
    }
    const manageErr = validateStep4ForFollowing();
    if (manageErr) {
      setError(manageErr);
      manageSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        if (!manage.nextStep.trim()) nextStepInputRef.current?.focus();
        else followUpDateInputRef.current?.focus();
      }, 300);
      return false;
    }
    setError('');
    return true;
  }

  function buildCustomerPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      customer_name: company.customerName.trim(),
      tax_code: company.taxCode.trim() || null,
      website: company.website.trim() || null,
      city: company.city || null,
      address: company.address.trim() || null,
      industry: company.industry || null,
      source: company.source || null,
      status: manage.status,
      note: manage.note.trim() || null,
    };
    if (canPickOwner && manage.ownerId) payload.owner_id = manage.ownerId;
    if (manage.saleManagerId) payload.sale_manager_id = manage.saleManagerId;
    return payload;
  }

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `Lỗi máy chủ (${res.status})`);
    return data;
  }

  async function handleCreatePlain() {
    if (!validateAll()) return;
    setSaving('plain');
    try {
      const data = await postJson(`${API_BASE_URL}/api/all-platform/crm/customers`, buildCustomerPayload());
      if (data.success === false) throw new Error(data.message || 'Không tạo được khách hàng.');
      onCreated(data.data.id);
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Không tạo được khách hàng.');
    } finally {
      setSaving('');
    }
  }

  async function handleCreateWithContact() {
    if (!validateAll()) return;
    setSaving('contact');
    try {
      const data = await postJson(`${API_BASE_URL}/api/all-platform/crm/customers`, buildCustomerPayload());
      if (data.success === false) throw new Error(data.message || 'Không tạo được khách hàng.');
      const customerId = data.data.id as string;
      if (contactFilled) {
        const contactPayload = {
          name: contact.name.trim() || company.customerName.trim(),
          position_category_id: contact.positionCategoryId || null,
          phone: contact.phone.trim() || null,
          email: contact.email.trim() || null,
          zalo: contact.zalo.trim() || null,
          facebook: contact.facebook.trim() || null,
          is_primary: true,
        };
        // Khach hang da tao thanh cong - chi bao loi rieng phan contact, khong
        // roll back (khong co giao dich chung 2 endpoint nay). Bat ca loi nem
        // ra (vd 404/network) lan loi {success:false}, tranh de loi contact
        // lam nguoi dung tuong nham khach hang chua duoc tao.
        const contactRes = await postJson(
          `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`,
          contactPayload,
        ).catch((contactErr: unknown) => ({
          success: false,
          message: contactErr instanceof Error ? contactErr.message : 'lỗi không rõ.',
        }));
        if (contactRes.success === false) {
          setError(`Đã tạo khách hàng, nhưng không thêm được Contact: ${contactRes.message || 'lỗi không rõ.'}`);
          onCreated(customerId);
          return;
        }
      }
      onCreated(customerId);
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Không tạo được khách hàng.');
    } finally {
      setSaving('');
    }
  }

  async function handleCreateWithDeal() {
    if (!validateAll()) return;
    setSaving('deal');
    try {
      const deal: Record<string, unknown> = {};
      if (manage.nextStep.trim()) deal.next_step = manage.nextStep.trim();
      if (manage.followUpDate.trim()) deal.follow_up_date = new Date(manage.followUpDate).toISOString();
      const payload = { customer: buildCustomerPayload(), deal };
      const data = await postJson(`${API_BASE_URL}/api/all-platform/crm/customers/with-deal`, payload);
      if (data.success === false) throw new Error(data.message || 'Không tạo được khách hàng + deal.');
      const customerId = data.data?.customer?.id as string;
      if (contactFilled && customerId) {
        const contactPayload = {
          name: contact.name.trim() || company.customerName.trim(),
          position_category_id: contact.positionCategoryId || null,
          phone: contact.phone.trim() || null,
          email: contact.email.trim() || null,
          zalo: contact.zalo.trim() || null,
          facebook: contact.facebook.trim() || null,
          is_primary: true,
        };
        await postJson(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`, contactPayload).catch(() => null);
      }
      onCreated(customerId);
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Không tạo được khách hàng + deal.');
    } finally {
      setSaving('');
    }
  }

  function scrollToAnchor(key: AnchorKey) {
    sectionRefsByAnchor[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveAnchor(key);
  }

  /** Scroll-spy don gian: muc nao co top gan/qua dinh vung cuon nhat thi la
   * active - chi de highlight thanh ANCHORS, khong anh huong logic tao. */
  function handleBodyScroll() {
    const body = bodyRef.current;
    if (!body) return;
    const scrollTop = body.scrollTop;
    let current: AnchorKey = 'crm';
    for (const anchor of ANCHORS) {
      const el = sectionRefsByAnchor[anchor.key].current;
      if (el && el.offsetTop - body.offsetTop <= scrollTop + 48) current = anchor.key;
    }
    setActiveAnchor(current);
  }

  /** Trigger nam trong footer (sat day man hinh), khong the luon mo xuong -
   * uoc luong chieu cao menu (~150px, 3 muc) va mo NGUOC LEN neu khong du
   * khong gian phia duoi, tranh menu bi cat/tran ngoai vung nhin thay duoc
   * o vien man hinh thap (bug thuc te Playwright bat duoc: 900px height,
   * trigger o footer, menu mo xuong bi "outside of the viewport"). */
  function openSplitMenu() {
    const rect = splitTriggerRef.current?.getBoundingClientRect();
    if (rect) {
      const estimatedMenuHeight = 150;
      const spaceBelow = window.innerHeight - rect.bottom;
      const right = window.innerWidth - rect.right;
      if (spaceBelow < estimatedMenuHeight) {
        setSplitMenuPos({ bottom: window.innerHeight - rect.top + 4, right });
      } else {
        setSplitMenuPos({ top: rect.bottom + 4, right });
      }
    }
    setSplitMenuOpen(true);
  }

  useEffect(() => {
    if (!splitMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (splitTriggerRef.current?.contains(target)) return;
      if (splitMenuListRef.current?.contains(target)) return;
      setSplitMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [splitMenuOpen]);

  if (!open) return null;

  return (
    <div className="crm-drawer-backdrop" onClick={onClose}>
      <div className="crm-customer-drawer" onClick={event => event.stopPropagation()}>
        <header className="crm-customer-drawer-header">
          <div>
            <h2>Thêm khách hàng</h2>
            <p className="crm-customer-drawer-subtitle">
              Tạo hồ sơ trực tiếp khi Sale đã biết rõ doanh nghiệp — không cần tạo Lead trung gian.
            </p>
          </div>
          <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-customer-drawer-steps">
          {ANCHORS.map((anchor, index) => (
            <button
              key={anchor.key}
              type="button"
              className={`crm-customer-drawer-step ${activeAnchor === anchor.key ? 'is-active' : ''}`}
              onClick={() => scrollToAnchor(anchor.key)}
            >
              {index + 1}. {anchor.label}
            </button>
          ))}
        </div>

        <div className="crm-drawer-body crm-customer-drawer-body" ref={bodyRef} onScroll={handleBodyScroll}>
          {error ? <p className="crm-error crm-customer-form-error">{error}</p> : null}

          <section className="crm-form-section" ref={crmSectionRef}>
            <p className="crm-form-title">1. Tìm công ty trong CRM</p>
            <p className="crm-customer-form-hint">
              Tìm theo tên doanh nghiệp, SĐT hoặc email để tránh tạo trùng hồ sơ đã có.
            </p>
            <input
              className="crm-customer-drawer-search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Nhập tên doanh nghiệp / SĐT / email..."
              autoComplete="off"
            />
            {searching ? (
              <p className="crm-small"><Loader2 className="crm-spin-icon" /> Đang tìm...</p>
            ) : null}
            {!searching && hasBlockingMatch ? (
              <div className="crm-duplicate-list crm-customer-drawer-matches">
                <p>Đã tìm thấy hồ sơ trùng — vui lòng mở hồ sơ có sẵn thay vì tạo mới:</p>
                <ul>
                  {matches.map(row => (
                    <li key={row.id}>
                      <span>
                        {row.customerName || 'Khách hàng chưa tên'}
                        {row.companyName ? ` · ${row.companyName}` : ''}
                        {row.phone ? ` · ${row.phone}` : ''}
                        {row.email ? ` · ${row.email}` : ''}
                      </span>
                      <Link href={`/all-platform/crm/customers/${row.id}`} target="_blank" className="crm-duplicate-open-btn">
                        Mở khách hàng
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!searching && searchedOnce && !hasBlockingMatch ? (
              <p className="crm-customer-drawer-ok">Không tìm thấy hồ sơ trùng — có thể tạo mới.</p>
            ) : null}
            <p className="crm-customer-drawer-note">
              Lưu ý: tìm kiếm ở bước này hiện chỉ theo tên/SĐT/email — chưa tìm theo MST hoặc website.
            </p>
          </section>

          <section className="crm-form-section" ref={companySectionRef}>
            <p className="crm-form-title">2. Thông tin công ty</p>
            <div className="crm-form-grid">
              <Field label="Tên doanh nghiệp" required>
                <input
                  ref={customerNameInputRef}
                  value={company.customerName}
                  onChange={e => setCompanyField('customerName', e.target.value)}
                  placeholder="Công ty TNHH ABC"
                />
              </Field>
              <Field label="Mã số thuế">
                <input value={company.taxCode} onChange={e => setCompanyField('taxCode', e.target.value)} />
              </Field>
              <Field label="Website">
                <input value={company.website} onChange={e => setCompanyField('website', e.target.value)} placeholder="https://..." />
              </Field>
              <Field label="Thành phố">
                <CrmCategorySelect categoryType="crm_city" value={company.city} onChange={value => setCompanyField('city', value)} placeholder="-- Chọn --" />
              </Field>
              <Field label="Lĩnh vực">
                <CrmCategoryCodeSelect categoryType="crm_industry" value={company.industry} onChange={value => setCompanyField('industry', value)} placeholder="-- Chọn --" />
              </Field>
              <Field label="Nguồn">
                <CrmCategoryCodeSelect categoryType="crm_source" value={company.source} onChange={value => setCompanyField('source', value)} />
              </Field>
              <Field full label="Địa chỉ">
                <input value={company.address} onChange={e => setCompanyField('address', e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="crm-form-section" ref={contactSectionRef}>
            <p className="crm-form-title">3. Người liên hệ chính (không bắt buộc)</p>
            <div className="crm-form-grid">
              <Field label="Họ tên">
                <input value={contact.name} onChange={e => setContactField('name', e.target.value)} placeholder="Nguyễn Văn A" />
              </Field>
              <Field label="Chức vụ">
                <PositionSelect
                  value={contact.positionCategoryId}
                  labelSnapshot={contact.positionLabel}
                  onChange={(id, label) => {
                    setContactField('positionCategoryId', id);
                    setContactField('positionLabel', label);
                  }}
                />
              </Field>
              <Field label="Số điện thoại">
                <input value={contact.phone} onChange={e => setContactField('phone', e.target.value)} type="tel" placeholder="09xxxxxxxx" />
              </Field>
              <Field label="Email">
                <input value={contact.email} onChange={e => setContactField('email', e.target.value)} type="email" />
              </Field>
              <Field label="Zalo">
                <input value={contact.zalo} onChange={e => setContactField('zalo', e.target.value)} />
              </Field>
              <Field label="Facebook">
                <input value={contact.facebook} onChange={e => setContactField('facebook', e.target.value)} />
              </Field>
            </div>
            <p className="crm-customer-form-hint">Để trống toàn bộ mục này nếu chưa có người liên hệ cụ thể — hệ thống sẽ không tạo Contact nào.</p>
          </section>

          <section className="crm-form-section" ref={manageSectionRef}>
            <p className="crm-form-title">4. Phụ trách &amp; trạng thái</p>
            <div className="crm-form-grid">
              {canPickOwner ? (
                <Field label="Người phụ trách">
                  <SearchableSelect
                    value={manage.ownerId}
                    onChange={value => setManageField('ownerId', value)}
                    options={ownerSelectOptions}
                    placeholder="-- Chọn Sale/Presale --"
                    hideClearOption
                  />
                </Field>
              ) : null}
              <Field label="Sale manager">
                <SearchableSelect
                  value={manage.saleManagerId}
                  onChange={value => setManageField('saleManagerId', value)}
                  options={saleManagerSelectOptions}
                  placeholder="-- Không chọn --"
                />
              </Field>
            </div>

            <p className="crm-customer-status-label">Trạng thái khách hàng</p>
            <div className="crm-customer-status-cards">
              {STATUS_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`crm-customer-status-card ${manage.status === option.value ? 'is-selected' : ''}`}
                  onClick={() => setManageField('status', option.value)}
                >
                  <span className="crm-customer-status-card-title">{option.label}</span>
                  <span className="crm-customer-status-card-hint">{option.hint}</span>
                </button>
              ))}
            </div>

            {isFollowing ? (
              <div className="crm-form-grid crm-customer-nextstep-grid">
                <Field label="Sale cần làm gì tiếp" required>
                  <input
                    ref={nextStepInputRef}
                    value={manage.nextStep}
                    onChange={e => setManageField('nextStep', e.target.value)}
                    placeholder="VD: Gọi xác nhận nhu cầu"
                  />
                </Field>
                <Field label="Khi nào làm" required>
                  <input
                    ref={followUpDateInputRef}
                    value={manage.followUpDate}
                    onChange={e => setManageField('followUpDate', e.target.value)}
                    type="datetime-local"
                  />
                </Field>
              </div>
            ) : null}
            {isFollowing ? (
              <p className="crm-customer-drawer-note">
                Trạng thái &quot;Đang bán&quot; cần lưu Next step/Ngày follow-up — 2 trường này chỉ tồn tại trên Deal,
                nên hành động lưu duy nhất khả dụng là &quot;Tạo khách hàng và tạo Deal&quot;.
              </p>
            ) : null}

            <div className="crm-form-grid">
              <Field full label="Ghi chú">
                <textarea value={manage.note} onChange={e => setManageField('note', e.target.value)} placeholder="Ghi chú nội bộ..." />
              </Field>
            </div>
          </section>
        </div>

        <footer className="crm-drawer-footer crm-customer-drawer-footer crm-customer-drawer-footer--single-page">
          <div className="crm-customer-drawer-footer-row">
            <button type="button" className="crm-cancel-button" onClick={onClose} disabled={saving !== ''}>
              Hủy
            </button>
            <div className="crm-customer-split-button">
              <button
                type="button"
                className="crm-save-button crm-customer-split-button-main"
                disabled={isFollowing || saving !== ''}
                title={isFollowing ? 'Trạng thái "Đang bán" bắt buộc tạo kèm Deal' : undefined}
                onClick={() => void handleCreatePlain()}
              >
                {saving === 'plain' ? <Loader2 className="crm-save-spinner" /> : null}
                Tạo khách hàng
              </button>
              <button
                ref={splitTriggerRef}
                type="button"
                className="crm-save-button crm-customer-split-button-toggle"
                aria-label="Thêm lựa chọn tạo khách hàng"
                aria-haspopup="menu"
                aria-expanded={splitMenuOpen}
                disabled={saving !== ''}
                onClick={() => (splitMenuOpen ? setSplitMenuOpen(false) : openSplitMenu())}
              >
                <ChevronDown className="crm-inline-icon" />
              </button>
              {splitMenuOpen && splitMenuPos
                ? createPortal(
                    <div
                      ref={splitMenuListRef}
                      className="crm-action-menu-list crm-action-menu-list--portal crm-customer-split-menu"
                      role="menu"
                      style={{
                        top: splitMenuPos.top ?? 'auto',
                        bottom: splitMenuPos.bottom ?? 'auto',
                        right: splitMenuPos.right,
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="crm-action-menu-item"
                        disabled={isFollowing || saving !== ''}
                        onClick={() => {
                          setSplitMenuOpen(false);
                          void handleCreatePlain();
                        }}
                      >
                        Tạo khách hàng
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="crm-action-menu-item"
                        disabled={isFollowing || saving !== ''}
                        onClick={() => {
                          setSplitMenuOpen(false);
                          void handleCreateWithContact();
                        }}
                      >
                        Tạo khách hàng &amp; thêm Contact
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="crm-action-menu-item"
                        disabled={saving !== ''}
                        onClick={() => {
                          setSplitMenuOpen(false);
                          void handleCreateWithDeal();
                        }}
                      >
                        Tạo khách hàng &amp; tạo Deal
                      </button>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          </div>
          <div className="crm-customer-drawer-footer-shortcuts">
            <button
              type="button"
              className="crm-customer-drawer-shortcut"
              disabled={isFollowing || saving !== ''}
              title={isFollowing ? 'Trạng thái "Đang bán" bắt buộc tạo kèm Deal' : undefined}
              onClick={() => void handleCreateWithContact()}
            >
              + Tạo &amp; thêm Contact
            </button>
            <button
              type="button"
              className="crm-customer-drawer-shortcut"
              disabled={saving !== ''}
              onClick={() => void handleCreateWithDeal()}
            >
              ◇ Tạo &amp; tạo Deal
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`crm-field ${full ? 'crm-field--full' : ''}`}>
      <span>
        {label} {required ? <b>*</b> : null}
      </span>
      {children}
    </label>
  );
}
