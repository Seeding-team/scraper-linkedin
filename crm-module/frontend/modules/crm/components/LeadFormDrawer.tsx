'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { allPlatformCategoriesService } from '@/services/all-platform.service';
import { useMembers } from '@/hooks/useMembers';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { SOURCE_OPTIONS } from '../constants/crmConfig';
import { mergeCategoryOptions } from '../hooks/useCrm';
import { PositionSelect } from './PositionSelect';
import { mapLead, LEAD_STATUS_LABEL } from './LeadsDirectory';
import { ChevronDown, ChevronUp, Loader2, X } from './icons';
import type { AppUser } from '@/types/unified.types';
import type { CrmLeadRow } from '../types';

type FormState = {
  leadName: string;
  companyName: string;
  positionCategoryId: string;
  positionLabel: string;
  phone: string;
  email: string;
  zalo: string;
  facebook: string;
  telegram: string;
  website: string;
  source: string;
  sdrId: string;
  sdrLabel: string;
  note: string;
};

function emptyForm(currentUser: AppUser | null): FormState {
  return {
    leadName: '',
    companyName: '',
    positionCategoryId: '',
    positionLabel: '',
    phone: '',
    email: '',
    zalo: '',
    facebook: '',
    telegram: '',
    website: '',
    source: 'Manual',
    sdrId: currentUser?.id || '',
    sdrLabel: currentUser?.name || currentUser?.email || '',
    note: '',
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

// Regex don gian cho SDT VN (10 so, bat dau 0, hoac +84) va email - du dung cho
// ban rule-based dau tien (khong goi AI/backend), theo dung yeu cau spec.
const PHONE_RE = /(?:\+?84|0)(?:\d[\s.-]?){9,10}\b/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/** Nhan dien "Nguon" tu noi dung dan vao (yeu cau rieng - "chỗ nguồn lead vẫn
 * chưa feed") - TRUOC DAY handleParsePaste() chi doan duoc SDT/Email/Ten,
 * hoan toan khong dung toi form.source, nen Nguon luon giu nguyen mac dinh
 * 'Manual' du noi dung dan vao ro rang tu 1 kenh khac (vd link Zalo/Facebook
 * Messenger). Chi doan theo tu khoa/duong dan RO RANG - KHONG doan mo ho de
 * tranh gan nham nguon (vd 1 website bat ky KHONG tu dong quy ve 'Website'
 * neu khong co dau hieu ro nhu http(s)://). Tra ve null neu khong nhan dien
 * duoc gi - giu nguyen 'Manual' nhu cu, khong ep bang bat ky gia tri nao. */
function detectSourceFromPaste(text: string): string | null {
  const lower = text.toLowerCase();
  if (/zalo\.me|chat\.zalo|\bzalo\b/.test(lower)) return 'Zalo';
  if (/markee/.test(lower)) return 'MarkeeChat';
  if (/m\.me\/|messenger\.com|facebook\.com\/messages|\bfb inbox\b|\binbox\b/.test(lower)) return 'FB_Inbox';
  if (/facebook\.com\/groups|\bfb group\b|\bgroup\b/.test(lower)) return 'FB_Group';
  if (/gi[ớo]i thi[eệ]u|referral/.test(lower)) return 'Referral';
  if (/https?:\/\/|www\./.test(lower)) return 'Website';
  return null;
}

// Heuristic "du dieu kien de auto-check" - CHI dung de quyet dinh co nen tu
// dong goi API duplicate-check hay khong (UX), khong thay the chuan hoa that
// o backend (vn_phone_to_e164 / normalize_email trong crm_lead_service.py).
function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 12;
}
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value.trim());
}

type DupState = 'idle' | 'checking' | 'clean' | 'duplicate' | 'error';

type CompanyMatchRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  match_reason?: string;
};

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN');
}

const INTERACTION_TYPES = ['Cuộc gọi', 'Tin nhắn', 'Email', 'Meeting', 'Ghi chú'];

export function LeadFormDrawer({
  open,
  currentUser,
  onClose,
  onSaved,
  onOpenQualification,
  onOpenExistingLead,
}: {
  open: boolean;
  currentUser: AppUser | null;
  onClose: () => void;
  onSaved: (lead: CrmLeadRow) => void;
  onOpenQualification: (lead: CrmLeadRow) => void;
  /** Mo lead da co (tim thay khi check trung) bang chinh co che mo Lead hien
   * huu dang dung o LeadsDirectory (LeadDetailDrawer) - khong dung lai. */
  onOpenExistingLead?: (lead: CrmLeadRow) => void;
}) {
  const [checkPhone, setCheckPhone] = useState('');
  const [checkEmail, setCheckEmail] = useState('');
  const [dupState, setDupState] = useState<DupState>('idle');
  const [duplicates, setDuplicates] = useState<CrmLeadRow[]>([]);
  const [overrideCreate, setOverrideCreate] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const [form, setForm] = useState<FormState>(() => emptyForm(currentUser));
  const [saving, setSaving] = useState<'create' | 'create-next' | 'create-qualify' | null>(null);
  const [error, setError] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const [companyMatches, setCompanyMatches] = useState<CompanyMatchRow[]>([]);
  const [matchedCustomerId, setMatchedCustomerId] = useState('');

  // "+ Them tuong tac" - khong co bang interaction/activity log rieng cho
  // crm_leads (xem migration 078: "Qualification fields flat columns; no
  // separate history table per spec"). Viec nho nhat co the tai su dung that
  // (khong bia du lieu, khong dung subsystem moi) la append 1 dong co dau
  // timestamp vao chinh cot note dang co, qua DUNG endpoint PUT /crm/leads/:id
  // da duoc test truoc do (LeadDetailDrawer dung endpoint nay de luu xac minh).
  const [interactionForId, setInteractionForId] = useState<string>('');
  const [interactionType, setInteractionType] = useState(INTERACTION_TYPES[0]);
  const [interactionNote, setInteractionNote] = useState('');
  const [interactionSaving, setInteractionSaving] = useState(false);
  const [interactionSavedFor, setInteractionSavedFor] = useState<string>('');

  const { members } = useMembers();
  const leadNameRef = useRef<HTMLInputElement>(null);
  useBodyScrollLock(open);

  // BUG THAT DA GAP ("chỗ nguồn lead vẫn chưa feed"): dropdown "Nguồn" truoc
  // day dung THANG `SOURCE_OPTIONS` tinh (hardcode trong crmConfig.ts), trong
  // khi trang "Danh mục CRM" cho phep them/sua "Nguồn" dong qua bang
  // categories (category_type='crm_source') - them "Nguồn" moi o Danh muc thi
  // dropdown nay KHONG BAO GIO thay vi khong he goi API. `useCrm()` (hook
  // dung o trang Leads/Pipeline chinh) da co san dung logic merge nay
  // (`loadCrmCategoryOptions`) nhung LeadFormDrawer la drawer doc lap, KHONG
  // dung chung hook nang do (se keo theo load ca deals/agents khong can) - chi
  // tai su dung ham `mergeCategoryOptions()` da export tu useCrm.ts, tu fetch
  // rieng 1 lan khi mo drawer.
  const [sourceOptions, setSourceOptions] = useState(SOURCE_OPTIONS);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    allPlatformCategoriesService
      .getAll('crm_source')
      .then(res => {
        if (alive) setSourceOptions(mergeCategoryOptions(SOURCE_OPTIONS, res.data));
      })
      .catch(() => {
        // Giu nguyen danh sach mac dinh neu tai danh muc mo rong that bai.
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Bo dem chan-doi-thi (generation counter) - moi lan len lich goi
  // duplicate-check tang seq; khi response ve chi ap dung neu no van la lan
  // goi MOI NHAT. Mirror dung tinh than "alive flag" cua CustomerAddDrawer.tsx
  // (quick-search debounce) nhung dung so dem thay vi closure vi o day 2 input
  // (SDT + email) cung trigger 1 check dung chung, va can chan ca hanh vi goi
  // lai tu dan-paste.
  const checkSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setError('');
    setCheckPhone('');
    setCheckEmail('');
    setDupState('idle');
    setDuplicates([]);
    setOverrideCreate(false);
    setPasteOpen(false);
    setPasteText('');
    setCompanyMatches([]);
    setMatchedCustomerId('');
    setForm(emptyForm(currentUser));
    setExtraOpen(false);
    setInteractionForId('');
    setInteractionNote('');
    setInteractionSavedFor('');
    checkSeqRef.current += 1;
  }, [open, currentUser]);

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  const canPickOwner = isAdminOrLeader(currentUser);
  const selectionKeyOf = (m: { id: string; linked_user_id?: string | null; linked_user_id_2?: string | null }) =>
    m.linked_user_id || m.linked_user_id_2 || m.id;
  const sdrOptions = useMemo(() => {
    const linked = members.filter(m => m.linked_user_id || m.linked_user_id_2);
    return [...linked].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [members]);
  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) map.set(key, m.display_name);
    });
    if (currentUser?.id && !map.has(currentUser.id)) map.set(currentUser.id, currentUser.name || currentUser.email || 'Bạn');
    return map;
  }, [members, currentUser]);

  // Auto-check trung khi SDT/Email hop le - debounce 400ms, huy neu component
  // unmount hoac gia tri lai doi truoc khi ket qua ve (dung effect-cleanup
  // pattern giong CustomerAddDrawer.tsx). Vi paste-extraction cung ghi vao
  // checkPhone/checkEmail nen dan noi dung se TU DONG kich hoat check nay,
  // khong bao gio bo qua buoc kiem tra trung sau khi paste.
  useEffect(() => {
    const phone = checkPhone.trim();
    const email = checkEmail.trim();
    if (!looksLikePhone(phone) && !looksLikeEmail(email)) {
      setDupState('idle');
      setDuplicates([]);
      return;
    }
    let alive = true;
    const seq = ++checkSeqRef.current;
    setDupState('checking');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (phone) params.set('phone', phone);
      if (email) params.set('email', email);
      fetch(`${API_BASE_URL}/api/all-platform/crm/leads/duplicate-check?${params.toString()}`, {
        credentials: 'include',
        headers: headers(),
      })
        .then(res => res.json())
        .then(body => {
          // Bo qua neu day khong con la lan goi moi nhat (nguoi dung go tiep
          // trong luc cho response) - chan dung race condition: response CU
          // ve SAU response MOI se khong duoc ap dung.
          if (!alive || seq !== checkSeqRef.current) return;
          if (body.success === false) {
            setDupState('error');
            return;
          }
          const rows = ((body.data?.matches || []) as Array<Record<string, unknown>>).map(row =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mapLead(row as any),
          );
          setDuplicates(rows);
          if (rows.length) {
            setDupState('duplicate');
          } else {
            setDupState('clean');
            // Tu dien SDT/Email sang form ben phai - chi khi o form dang trong
            // de khong ghi de gia tri nguoi dung da sua tay ben phai.
            setForm(current => ({
              ...current,
              phone: current.phone.trim() ? current.phone : phone,
              email: current.email.trim() ? current.email : email,
            }));
          }
        })
        .catch(() => {
          if (!alive || seq !== checkSeqRef.current) return;
          setDupState('error');
        });
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [checkPhone, checkEmail]);

  function runCompanyMatch(name: string, website: string) {
    if (!name.trim() && !website.trim()) {
      setCompanyMatches([]);
      return;
    }
    const params = new URLSearchParams();
    if (website.trim()) params.set('website', website.trim());
    if (name.trim()) params.set('name', name.trim());
    fetch(`${API_BASE_URL}/api/all-platform/crm/leads/company-match?${params.toString()}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(res => res.json())
      .then(body => {
        if (body.success !== false) setCompanyMatches((body.data?.matches || []) as CompanyMatchRow[]);
      })
      .catch(() => { /* im lang - goi y doanh nghiep khong bat buoc */ });
  }

  const companyTimer = useRef<number | undefined>(undefined);
  function handleCompanyNameChange(value: string) {
    setValue('companyName', value);
    setMatchedCustomerId('');
    window.clearTimeout(companyTimer.current);
    companyTimer.current = window.setTimeout(() => runCompanyMatch(value, form.website), 300);
  }

  function handleParsePaste() {
    const text = pasteText;
    const phoneMatch = text.match(PHONE_RE);
    const emailMatch = text.match(EMAIL_RE);
    if (phoneMatch && !checkPhone.trim()) {
      setCheckPhone(phoneMatch[0].replace(/[\s.-]/g, ''));
    }
    if (emailMatch && !checkEmail.trim()) {
      setCheckEmail(emailMatch[0]);
    }
    // Doan ten don gian: dong dau tien khong phai la SDT/email thuan tuy, cat truoc dau '-' hoac ','.
    if (!form.leadName.trim()) {
      const firstLine = text.split(/\n/)[0] || '';
      const namePart = firstLine.split(/[-,]/)[0].trim();
      if (namePart && !PHONE_RE.test(namePart) && !EMAIL_RE.test(namePart) && namePart.length < 60) {
        setValue('leadName', namePart);
      }
    }
    // Nguon: CHI tu dien khi dang la mac dinh 'Manual' (nguoi dung CHUA tu
    // chon nguon nao) - tranh ghi de lua chon thu cong neu ho da doi truoc
    // khi dan noi dung.
    if (form.source === 'Manual') {
      const detected = detectSourceFromPaste(text);
      if (detected) setValue('source', detected);
    }
  }

  // Dung 1 rule duy nhat voi ban goc: chi can 1 trong 2 (SDT hoac Email), o
  // ca 2 cot (trai la nguon that su gui len backend qua form.phone/email da
  // duoc autofill).
  function validate(): string | null {
    if (!form.leadName.trim()) return 'Vui lòng nhập tên khách hàng.';
    if (!form.phone.trim() && !form.email.trim()) return 'Cần nhập số điện thoại hoặc email.';
    return null;
  }

  function buildPayload() {
    return {
      lead_name: form.leadName.trim(),
      company_name: form.companyName.trim() || null,
      position_category_id: form.positionCategoryId || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      zalo: form.zalo.trim() || null,
      facebook: form.facebook.trim() || null,
      telegram: form.telegram.trim() || null,
      website: form.website.trim() || null,
      source: form.source || null,
      status: 'new_lead',
      sdr_id: canPickOwner ? (form.sdrId || null) : (currentUser?.id || null),
      note: form.note.trim() || null,
    };
  }

  async function submitLead(): Promise<CrmLeadRow | null> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads`, {
      method: 'POST',
      credentials: 'include',
      headers: headers(),
      body: JSON.stringify(buildPayload()),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.message || `Lỗi máy chủ (${res.status})`);
    if (body.success === false) {
      const dupRows = ((body.data?.duplicates || []) as Array<Record<string, unknown>>).map(row =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mapLead(row as any),
      );
      if (dupRows.length) {
        setDuplicates(dupRows);
        setDupState('duplicate');
        setOverrideCreate(false);
        setError('Đã có Lead trùng số điện thoại hoặc email — kiểm tra danh sách bên dưới trước khi tạo tiếp.');
        return null;
      }
      throw new Error(body.message || 'Không tạo được Lead.');
    }
    return mapLead(body.data);
  }

  // Cong tac "khoa" cot phai: THEO MOCKUP, chi mo khi check trung da chay
  // xong VA ket qua la khong trung, hoac nguoi dung da bam "Van tao Lead moi".
  const unlocked = dupState === 'clean' || overrideCreate;
  const dedupGatePassed = unlocked;

  async function handleAction(mode: 'create' | 'create-next' | 'create-qualify') {
    if (!dedupGatePassed) {
      setError('Cần kiểm tra trùng SĐT/Email trước khi tạo Lead.');
      return;
    }
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(mode);
    setError('');
    try {
      const created = await submitLead();
      if (!created) return;
      onSaved(created);
      if (mode === 'create') {
        onClose();
      } else if (mode === 'create-next') {
        setCheckPhone('');
        setCheckEmail('');
        setDupState('idle');
        setDuplicates([]);
        setOverrideCreate(false);
        setPasteText('');
        setForm(emptyForm(currentUser));
        setCompanyMatches([]);
        setMatchedCustomerId('');
        window.setTimeout(() => leadNameRef.current?.focus(), 0);
      } else {
        onOpenQualification(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được Lead.');
    } finally {
      setSaving(null);
    }
  }

  function handleForceCreate() {
    setOverrideCreate(true);
    setForm(current => ({
      ...current,
      phone: current.phone.trim() ? current.phone : checkPhone.trim(),
      email: current.email.trim() ? current.email : checkEmail.trim(),
    }));
    window.setTimeout(() => leadNameRef.current?.focus(), 0);
  }

  async function handleSaveInteraction(lead: CrmLeadRow) {
    if (!interactionNote.trim()) return;
    setInteractionSaving(true);
    try {
      const stamp = new Date().toLocaleString('vi-VN');
      const entry = `[${stamp}] ${interactionType}: ${interactionNote.trim()}`;
      const nextNote = lead.note ? `${lead.note}\n${entry}` : entry;
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify({ note: nextNote }),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không lưu được tương tác.');
      const updated = mapLead(body.data);
      setDuplicates(current => current.map(d => (d.id === updated.id ? updated : d)));
      setInteractionSavedFor(lead.id);
      setInteractionForId('');
      setInteractionNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được tương tác.');
    } finally {
      setInteractionSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="crm-drawer-backdrop" onClick={onClose}>
      <aside className="crm-drawer crm-lead-drawer crm-lead-drawer--quick" onClick={event => event.stopPropagation()}>
        <header className="crm-lead-drawer-header">
          <div>
            <h2>Thêm Lead nhanh</h2>
            <p>Nhập SĐT hoặc Email để kiểm tra trùng trước khi hoàn thiện thông tin.</p>
          </div>
          <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-drawer-body crm-lead-drawer-body">
          {error ? <p className="crm-error">{error}</p> : null}

          <div className="crm-lead-quickadd-grid">
            {/* ---- Cot trai: 1. Kiem tra Lead ---- */}
            <section className="crm-form-section crm-lead-check-col">
              <p className="crm-form-title">1. Kiểm tra Lead</p>
              <p className="crm-lead-check-subtitle">Nhập ít nhất SĐT hoặc Email</p>

              <div className="crm-form-grid">
                <Field label="Số điện thoại">
                  <input
                    value={checkPhone}
                    onChange={e => setCheckPhone(e.target.value)}
                    type="tel"
                    placeholder="VD: 0903 037 911"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Email">
                  <input
                    value={checkEmail}
                    onChange={e => setCheckEmail(e.target.value)}
                    type="email"
                    placeholder="VD: tien@abc.vn"
                    autoComplete="off"
                  />
                </Field>
              </div>

              {dupState === 'checking' ? (
                <p className="crm-lead-check-status crm-lead-check-status--checking">
                  <Loader2 className="crm-spin-icon" /> Đang kiểm tra trùng...
                </p>
              ) : null}

              {dupState === 'clean' ? (
                <div className="crm-lead-check-banner crm-lead-check-banner--success">
                  <b>✓ Không tìm thấy Lead trùng</b>
                  <span>SĐT / Email đã được tự động điền sang form.</span>
                </div>
              ) : null}

              {dupState === 'error' ? (
                <div className="crm-lead-check-banner crm-lead-check-banner--warning">
                  <b>Không kiểm tra được trùng lúc này</b>
                  <span>Có thể thử lại bằng cách sửa nhẹ SĐT/Email, hoặc bấm &quot;Vẫn tạo Lead mới&quot; nếu chắc chắn.</span>
                </div>
              ) : null}

              {overrideCreate ? (
                <div className="crm-lead-check-banner crm-lead-check-banner--warning">
                  <b>Đã bỏ qua cảnh báo trùng</b>
                  <span>Bạn đang tạo Lead mới dù hệ thống tìm thấy Lead trùng — vui lòng kiểm tra kỹ.</span>
                </div>
              ) : null}

              {dupState === 'duplicate' && !overrideCreate ? (
                <div className="crm-lead-duplicate-cards">
                  {duplicates.map(dup => (
                    <div key={dup.id} className="crm-lead-duplicate-card">
                      <div className="crm-lead-duplicate-card-head">
                        <div>
                          <b>{dup.leadName}</b>
                          <span>{dup.companyName || 'Chưa có công ty'}</span>
                        </div>
                      </div>
                      <div className="crm-lead-duplicate-card-meta">
                        <div>Điện thoại: <b>{dup.phone || 'Chưa có'}</b></div>
                        <div>Email: <b>{dup.email || 'Chưa có'}</b></div>
                        <div>Phụ trách: <b>{memberName.get(dup.sdrId || '') || 'Chưa gán'}</b></div>
                        <div>Trạng thái: <b>{LEAD_STATUS_LABEL[dup.status] || dup.status}</b></div>
                        <div>Nguồn: <b>{dup.source || 'Manual'}</b></div>
                        <div>
                          Cập nhật gần nhất: <b>{formatDateTime(dup.updatedAt) || 'chưa có hoạt động'}</b>
                        </div>
                      </div>
                      <p className="crm-ai-fill-hint">
                        Lead hiện chưa có nhật ký hoạt động riêng — đây là thời điểm cập nhật hồ sơ gần nhất, không phải lịch sử tương tác đầy đủ.
                      </p>
                      <div className="crm-lead-duplicate-card-actions">
                        <button
                          type="button"
                          className="crm-primary-button crm-button-sm"
                          onClick={() => onOpenExistingLead?.(dup)}
                          disabled={!onOpenExistingLead}
                        >
                          Mở Lead
                        </button>
                        <button
                          type="button"
                          className="crm-secondary-button crm-button-sm"
                          onClick={() => setInteractionForId(current => (current === dup.id ? '' : dup.id))}
                        >
                          + Thêm tương tác
                        </button>
                        <button type="button" className="crm-ghost-button crm-button-sm" onClick={handleForceCreate}>
                          Vẫn tạo Lead mới
                        </button>
                      </div>
                      {interactionSavedFor === dup.id ? (
                        <p className="crm-verify-ok">Đã lưu tương tác vào ghi chú của Lead.</p>
                      ) : null}
                      {interactionForId === dup.id ? (
                        <div className="crm-lead-interaction-panel">
                          <Field label="Loại tương tác">
                            <select value={interactionType} onChange={e => setInteractionType(e.target.value)}>
                              {INTERACTION_TYPES.map(type => (
                                <option key={type} value={type}>{type}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Nội dung">
                            <textarea
                              value={interactionNote}
                              onChange={e => setInteractionNote(e.target.value)}
                              placeholder="VD: Khách vừa gọi lại, muốn nhận báo giá trong hôm nay..."
                              rows={2}
                            />
                          </Field>
                          <div className="crm-lead-interaction-actions">
                            <button type="button" className="crm-secondary-button crm-button-sm" onClick={() => setInteractionForId('')}>
                              Hủy
                            </button>
                            <button
                              type="button"
                              className="crm-primary-button crm-button-sm"
                              disabled={interactionSaving || !interactionNote.trim()}
                              onClick={() => void handleSaveInteraction(dup)}
                            >
                              {interactionSaving ? <Loader2 className="crm-save-spinner" /> : null} Lưu tương tác
                            </button>
                          </div>
                          <p className="crm-ai-fill-hint">
                            Ghi chú: chưa có bảng lịch sử tương tác riêng cho Lead — nội dung này được nối thêm vào ô ghi chú (note) sẵn có của Lead qua API cập nhật Lead hiện tại.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className="crm-lead-paste-toggle"
                onClick={() => setPasteOpen(v => !v)}
              >
                {pasteOpen ? <ChevronUp className="crm-inline-icon" /> : <ChevronDown className="crm-inline-icon" />}
                ✨ Dán nội dung để điền nhanh
              </button>
              {pasteOpen ? (
                <div className="crm-ai-fill crm-lead-paste-box">
                  <div className="crm-ai-fill-row">
                    <textarea
                      className="crm-ai-fill-textarea"
                      value={pasteText}
                      onChange={event => setPasteText(event.target.value)}
                      placeholder="Dán tin nhắn/email có SĐT + email, hệ thống tự tách ra ô tương ứng..."
                      rows={4}
                    />
                    <button type="button" className="crm-ai-fill-btn" disabled={!pasteText.trim()} onClick={handleParsePaste}>
                      Phân tích nội dung
                    </button>
                  </div>
                </div>
              ) : null}

              <p className="crm-lead-check-hint">Hệ thống tự kiểm tra khi dữ liệu hợp lệ.</p>
            </section>

            {/* ---- Cot phai: 2. Thong tin Lead ---- */}
            <section className={`crm-form-section crm-lead-info-col ${unlocked ? '' : 'crm-lead-info-col--locked'}`}>
              <div className="crm-lead-info-col-head">
                <div>
                  <p className="crm-form-title">2. Thông tin Lead</p>
                  <p className="crm-lead-check-subtitle">SĐT / Email tự động điền; hoàn thiện các trường còn lại.</p>
                </div>
                <span className={`crm-lead-lock-badge ${unlocked ? 'crm-lead-lock-badge--open' : ''}`}>
                  {unlocked ? '🔓 Đã mở khóa' : '🔒 Đang khóa'}
                </span>
              </div>

              {!unlocked ? (
                <p className="crm-lead-lock-message">
                  Form đang chờ kết quả kiểm tra trùng ở cột bên trái. Khi không trùng (hoặc bạn chọn &quot;Vẫn tạo Lead mới&quot;), form sẽ tự mở.
                </p>
              ) : null}

              <fieldset className="crm-lead-info-fieldset" disabled={!unlocked}>
                <div className="crm-form-grid">
                  <Field label="Tên khách hàng" required>
                    <input ref={leadNameRef} value={form.leadName} onChange={e => setValue('leadName', e.target.value)} placeholder="Nguyễn Văn A" />
                  </Field>
                  <Field label="Công ty">
                    <input value={form.companyName} onChange={e => handleCompanyNameChange(e.target.value)} placeholder="Công ty TNHH ABC" />
                  </Field>
                  <Field label="Số điện thoại" hint="cần SĐT hoặc email">
                    <input value={form.phone} onChange={e => setValue('phone', e.target.value)} type="tel" placeholder="Autofill từ kiểm tra trùng" />
                  </Field>
                  <Field label="Email" hint="cần SĐT hoặc email">
                    <input value={form.email} onChange={e => setValue('email', e.target.value)} type="email" placeholder="Autofill từ kiểm tra trùng" />
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
                  <Field label="Nguồn" required>
                    <select value={form.source} onChange={e => setValue('source', e.target.value)}>
                      {sourceOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                  {canPickOwner ? (
                    <Field label="Người phụ trách Lead" required>
                      <select value={form.sdrId} onChange={e => setValue('sdrId', e.target.value)}>
                        <option value={currentUser?.id || ''}>-- Chính bạn --</option>
                        {sdrOptions.map(m => (
                          <option key={m.id} value={selectionKeyOf(m)}>
                            {m.display_name}{m.email ? ` (${m.email})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field label="Người phụ trách Lead" required>
                      <input value={currentUser?.name || currentUser?.email || 'Bạn'} disabled readOnly />
                    </Field>
                  )}
                  <Field label="Trạng thái">
                    <input value="Lead mới" disabled readOnly />
                  </Field>
                </div>

                {companyMatches.length ? (
                  <div className="crm-lead-company-match">
                    <p className="crm-form-title">Doanh nghiệp có thể trùng</p>
                    {companyMatches.slice(0, 3).map(match => (
                      <div key={match.id} className={`crm-lead-company-match-card ${matchedCustomerId === match.id ? 'is-selected' : ''}`}>
                        <div>
                          <b>{match.customer_name || match.company_name || 'Khách hàng'}</b>
                          <span>{match.website || ''}</span>
                        </div>
                        <button
                          type="button"
                          className="crm-secondary-inline"
                          onClick={() => setMatchedCustomerId(current => (current === match.id ? '' : match.id))}
                        >
                          {matchedCustomerId === match.id ? 'Đã liên kết' : 'Liên kết doanh nghiệp này'}
                        </button>
                      </div>
                    ))}
                    <p className="crm-ai-fill-hint">Chỉ ghi nhớ tạm trên form này — việc liên kết thật sự diễn ra ở bước Tạo cơ hội.</p>
                  </div>
                ) : null}

                <div className="crm-lead-extra-section">
                  <button type="button" className="crm-lead-extra-toggle" onClick={() => setExtraOpen(v => !v)}>
                    {extraOpen ? <ChevronUp className="crm-inline-icon" /> : <ChevronDown className="crm-inline-icon" />}
                    ▾ Thông tin bổ sung
                    <em className="crm-optional-hint">Zalo, Facebook, Telegram, Website, ghi chú</em>
                  </button>
                  {extraOpen ? (
                    <div className="crm-form-grid" style={{ marginTop: '0.75rem' }}>
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
                      <Field full label="Ghi chú">
                        <textarea value={form.note} onChange={e => setValue('note', e.target.value)} placeholder="Ghi chú nội bộ..." />
                      </Field>
                    </div>
                  ) : null}
                </div>
              </fieldset>
            </section>
          </div>
        </div>

        <footer className="crm-drawer-footer crm-lead-drawer-footer">
          <button type="button" className="crm-cancel-button" onClick={onClose} disabled={saving !== null}>
            Hủy
          </button>
          <div className="crm-lead-drawer-footer-center">
            {dedupGatePassed ? <span className="crm-lead-footer-check-ok">✓ Đã kiểm tra trùng</span> : null}
          </div>
          <div className="crm-lead-drawer-footer-actions crm-lead-split-button">
            <button
              type="button"
              className="crm-secondary-button"
              disabled={saving !== null || !dedupGatePassed}
              title={dedupGatePassed ? undefined : 'Cần kiểm tra trùng SĐT/Email trước'}
              onClick={() => void handleAction('create-next')}
            >
              {saving === 'create-next' ? <Loader2 className="crm-save-spinner" /> : null}
              Tạo và thêm Lead tiếp theo
            </button>
            <button
              type="button"
              className="crm-secondary-button"
              disabled={saving !== null || !dedupGatePassed}
              title={dedupGatePassed ? undefined : 'Cần kiểm tra trùng SĐT/Email trước'}
              onClick={() => void handleAction('create-qualify')}
            >
              {saving === 'create-qualify' ? <Loader2 className="crm-save-spinner" /> : null}
              Tạo và mở Qualification
            </button>
            <button
              type="button"
              className="crm-save-button"
              disabled={saving !== null || !dedupGatePassed}
              title={dedupGatePassed ? undefined : 'Cần kiểm tra trùng SĐT/Email trước'}
              onClick={() => void handleAction('create')}
            >
              {saving === 'create' ? <Loader2 className="crm-save-spinner" /> : null}
              Tạo Lead
            </button>
          </div>
        </footer>
      </aside>
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
