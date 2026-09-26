'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { ActionMenu } from './ActionMenu';
import { PositionSelect } from './PositionSelect';
import { fetchCrmCategoryIdOptions } from './CrmCategorySelect';
import { ChevronDown, ChevronUp, Loader2, Plus, X } from './icons';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Phone, Mail, AlertCircle, UserCheck } from 'lucide-react';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

type ApiContact = {
  id: string;
  customer_id: string;
  name: string;
  position?: string | null;
  position_category_id?: string | null;
  position_label_snapshot?: string | null;
  phone?: string | null;
  email?: string | null;
  zalo?: string | null;
  facebook?: string | null;
  telegram?: string | null;
  website?: string | null;
  is_primary?: boolean | null;
  note?: string | null;
};

type DuplicateContact = ApiContact & {
  customer_name?: string | null;
  same_customer?: boolean;
  match_reasons?: string[];
};

type ContactFormState = {
  name: string;
  positionCategoryId: string;
  positionLabel: string;
  phone: string;
  email: string;
  zalo: string;
  facebook: string;
  telegram: string;
  website: string;
  note: string;
  isPrimary: boolean;
};

type DupState = 'idle' | 'checking' | 'clean' | 'duplicate' | 'error';

function emptyForm(): ContactFormState {
  return {
    name: '', positionCategoryId: '', positionLabel: '', phone: '', email: '',
    zalo: '', facebook: '', telegram: '', website: '', note: '', isPrimary: false,
  };
}

function formFromContact(contact: ApiContact): ContactFormState {
  return {
    name: contact.name || '',
    positionCategoryId: contact.position_category_id || '',
    positionLabel: contact.position_label_snapshot || contact.position || '',
    phone: contact.phone || '',
    email: contact.email || '',
    zalo: contact.zalo || '',
    facebook: contact.facebook || '',
    telegram: contact.telegram || '',
    website: contact.website || '',
    note: contact.note || '',
    isPrimary: Boolean(contact.is_primary),
  };
}

// Cung heuristic voi LeadFormDrawer.tsx - chi de quyet dinh co tu dong goi
// duplicate-check hay khong, chuan hoa that van o backend.
const PHONE_RE = /(?:\+?84|0)(?:\d[\s.-]?){9,10}\b/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 12;
}
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value.trim());
}

/** Tach link mang xa hoi/website tu noi dung dan vao - chi nhan dien khi co
 * dau hieu RO RANG (domain), khong doan mo ho. */
function detectLinksFromPaste(text: string): Partial<Pick<ContactFormState, 'zalo' | 'facebook' | 'telegram' | 'website'>> {
  const urls = text.match(/(?:https?:\/\/|www\.)[^\s,]+/gi) || [];
  const out: Partial<Pick<ContactFormState, 'zalo' | 'facebook' | 'telegram' | 'website'>> = {};
  for (const url of urls) {
    const lower = url.toLowerCase();
    if (/zalo\.me/.test(lower)) out.zalo = out.zalo || url;
    else if (/facebook\.com|fb\.com|m\.me\//.test(lower)) out.facebook = out.facebook || url;
    else if (/t\.me\/|telegram\.me/.test(lower)) out.telegram = out.telegram || url;
    else out.website = out.website || url;
  }
  const tg = text.match(/(?:telegram|tele)\s*[:\-]?\s*(@[a-z0-9_]{4,})/i);
  if (tg && !out.telegram) out.telegram = tg[1];
  return out;
}

async function detectPositionFromPaste(text: string): Promise<{ id: string; label: string } | null> {
  try {
    const options = await fetchCrmCategoryIdOptions('crm_position');
    const lower = text.toLowerCase();
    let best: { id: string; label: string } | null = null;
    for (const option of options) {
      const label = option.label?.trim();
      if (!label) continue;
      if (lower.includes(label.toLowerCase()) && (!best || label.length > best.label.length)) {
        best = { id: option.value, label };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Danh sách + CRUD Contact (nguoi lien he) cua 1 ho so khach hang - hien tren
 * CrmCustomerDetailPage.tsx. Goi that /crm/customers/{id}/contacts, khong
 * mockup. canEdit dieu khien co hien nut Sua/Xoa/+ Them hay khong (server van
 * tu kiem tra lai qua can_edit_customer()).
 *
 * Form Them/Sua Contact dung DUNG khuon form "Thêm Lead nhanh" (feedback
 * 2026-09-23: "chỗ thêm contact này chỉ lại form lấy tt như thằng lead đó, nó
 * thiếu tt"): cot trai kiem tra trung SĐT/Email (trong tenant) + dan noi dung
 * de dien nhanh, cot phai thong tin day du (them Telegram/Website/Ghi chu).
 */
export function CrmContactsPanel({
  customerId,
  canEdit,
  onOpenContact,
  onCountChange,
  onCreateDeal,
  onCreateProject,
}: {
  customerId: string;
  canEdit: boolean;
  onOpenContact?: (contactId: string) => void;
  onCountChange?: (count: number) => void;
  onCreateDeal?: (contactId: string) => void;
  onCreateProject?: (contactId: string) => void;
}) {
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiContact | null>(null);
  const [form, setForm] = useState<ContactFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [checkPhone, setCheckPhone] = useState('');
  const [checkEmail, setCheckEmail] = useState('');
  const [dupState, setDupState] = useState<DupState>('idle');
  const [duplicates, setDuplicates] = useState<DuplicateContact[]>([]);
  const [overrideCreate, setOverrideCreate] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const checkSeqRef = useRef(0);
  useBodyScrollLock(formOpen);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được danh sách contact.');
        return (body.data || []) as ApiContact[];
      })
      .then(rows => {
        if (alive) {
          setContacts(rows);
          setError('');
          onCountChange?.(rows.length);
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được danh sách contact.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  // Tu dong kiem tra trung khi SDT/Email hop le (debounce 400ms, chong race
  // bang so dem - cung co che voi LeadFormDrawer.tsx).
  // Trang thai hien thi: SDT/Email chua hop le -> luon 'idle' (tinh luc render,
  // khong setState dong bo trong effect).
  const checkable = looksLikePhone(checkPhone.trim()) || looksLikeEmail(checkEmail.trim());
  const dupView: DupState = checkable ? dupState : 'idle';

  /** Doi o kiem tra -> dat 'checking' ngay tai handler (khong trong effect). */
  function updateCheckInput(kind: 'phone' | 'email', value: string) {
    const phone = kind === 'phone' ? value : checkPhone;
    const email = kind === 'email' ? value : checkEmail;
    if (kind === 'phone') setCheckPhone(value);
    else setCheckEmail(value);
    setDupState(looksLikePhone(phone.trim()) || looksLikeEmail(email.trim()) ? 'checking' : 'idle');
  }

  useEffect(() => {
    if (!formOpen) return;
    const phone = checkPhone.trim();
    const email = checkEmail.trim();
    if (!looksLikePhone(phone) && !looksLikeEmail(email)) return;
    let alive = true;
    const seq = ++checkSeqRef.current;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (phone) params.set('phone', phone);
      if (email) params.set('email', email);
      if (editing) params.set('exclude_contact_id', editing.id);
      fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts/duplicate-check?${params.toString()}`, {
        credentials: 'include',
        headers: headers(),
      })
        .then(res => res.json())
        .then(body => {
          if (!alive || seq !== checkSeqRef.current) return;
          if (body.success === false) {
            setDupState('error');
            return;
          }
          const rows = (body.data?.matches || []) as DuplicateContact[];
          setDuplicates(rows);
          if (rows.length) {
            setDupState('duplicate');
          } else {
            setDupState('clean');
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
  }, [checkPhone, checkEmail, formOpen, customerId, editing]);

  function resetCheck(phone = '', email = '') {
    setCheckPhone(phone);
    setCheckEmail(email);
    setDupState('idle');
    setDuplicates([]);
    setOverrideCreate(false);
    setPasteOpen(false);
    setPasteText('');
    checkSeqRef.current += 1;
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setExtraOpen(false);
    resetCheck();
    setFormOpen(true);
  }
  function openEdit(contact: ApiContact) {
    setEditing(contact);
    setForm(formFromContact(contact));
    setFormError('');
    setExtraOpen(Boolean(contact.zalo || contact.facebook || contact.telegram || contact.website || contact.note));
    resetCheck(contact.phone || '', contact.email || '');
    setFormOpen(true);
  }
  function closeForm() {
    if (saving) return;
    setFormOpen(false);
  }

  function setValue<K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function handleParsePaste() {
    const text = pasteText;
    const phoneMatch = text.match(PHONE_RE);
    const emailMatch = text.match(EMAIL_RE);
    if (phoneMatch && !checkPhone.trim()) updateCheckInput('phone', phoneMatch[0].replace(/[\s.-]/g, ''));
    if (emailMatch && !checkEmail.trim()) updateCheckInput('email', emailMatch[0]);
    if (!form.name.trim()) {
      const firstLine = text.split(/\n/)[0] || '';
      const namePart = firstLine.split(/[-,]/)[0].trim();
      if (namePart && !PHONE_RE.test(namePart) && !EMAIL_RE.test(namePart) && namePart.length < 60) {
        setValue('name', namePart);
      }
    }
    const links = detectLinksFromPaste(text);
    setForm(current => ({
      ...current,
      zalo: current.zalo || links.zalo || '',
      facebook: current.facebook || links.facebook || '',
      telegram: current.telegram || links.telegram || '',
      website: current.website || links.website || '',
    }));
    if (links.zalo || links.facebook || links.telegram || links.website) setExtraOpen(true);
    if (!form.positionCategoryId) {
      void detectPositionFromPaste(text).then(detected => {
        if (!detected) return;
        setForm(prev => (prev.positionCategoryId ? prev : { ...prev, positionCategoryId: detected.id, positionLabel: detected.label }));
      });
    }
  }

  // Them moi: khoa cot phai cho toi khi kiem tra trung xong (khong trung hoac
  // nguoi dung chon "Vẫn thêm Contact mới") - dung nhu form Lead. Sua: luon mo.
  const unlocked = Boolean(editing) || dupView === 'clean' || overrideCreate;

  async function handleDelete(contact: ApiContact) {
    if (!window.confirm(`Xóa contact "${contact.name}"? Bạn chấp nhận mất người liên hệ này?`)) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contact.id)}`,
        { method: 'DELETE', credentials: 'include', headers: headers() },
      );
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || 'Không xóa được contact.');
      setReloadTick(t => t + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xóa được contact.');
    }
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!form.name.trim()) {
      setFormError('Vui lòng nhập họ tên.');
      return;
    }
    if (!editing && !form.phone.trim() && !form.email.trim()) {
      setFormError('Cần nhập số điện thoại hoặc email.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        position_category_id: form.positionCategoryId || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        zalo: form.zalo.trim() || null,
        facebook: form.facebook.trim() || null,
        telegram: form.telegram.trim() || null,
        website: form.website.trim() || null,
        note: form.note.trim() || null,
        is_primary: form.isPrimary,
      };
      const url = editing
        ? `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(editing.id)}`
        : `${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/contacts`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || 'Không lưu được contact.');
      setFormOpen(false);
      setReloadTick(t => t + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không lưu được contact.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card className="bg-card shadow-xs border border-border/80 overflow-hidden">
      <CardHeader className="py-4 px-6 border-b border-border/60 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-4.5 text-primary" />
          <CardTitle className="text-base font-semibold text-foreground">Người liên hệ</CardTitle>
          <Badge variant="secondary" className="text-xs px-2 py-0.5 font-bold">
            {contacts.length}
          </Badge>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            className="gap-1.5 shadow-xs"
            onClick={openCreate}
          >
            <Plus className="size-3.5" />
            <span>Thêm Contact</span>
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="p-6">
        {error ? (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs mb-4 flex items-start gap-2">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span>Đang tải danh sách liên hệ...</span>
          </div>
        ) : contacts.length ? (
          <div className="space-y-2.5">
            {contacts.map(contact => (
              <div
                key={contact.id}
                className={`p-3.5 rounded-xl border border-border/70 bg-card hover:border-primary/40 hover:shadow-xs transition-all flex flex-wrap items-center justify-between gap-3 ${onOpenContact ? 'cursor-pointer' : ''}`}
                onClick={onOpenContact ? () => onOpenContact(contact.id) : undefined}
                role={onOpenContact ? 'button' : undefined}
                tabIndex={onOpenContact ? 0 : undefined}
              >
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                    {contact.name ? contact.name.trim().charAt(0).toUpperCase() : '?'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-foreground">{contact.name}</span>
                      {contact.is_primary ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 text-[10px] font-semibold px-2 py-0">
                          Chính
                        </Badge>
                      ) : null}
                    </div>
                    {(contact.position_label_snapshot || contact.position) ? (
                      <span className="text-[11px] text-muted-foreground">{contact.position_label_snapshot || contact.position}</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs" onClick={event => event.stopPropagation()}>
                  {contact.phone ? (
                    <a
                      className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary transition-colors"
                      href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}
                    >
                      <Phone className="size-3 text-muted-foreground" />
                      <span>{contact.phone}</span>
                    </a>
                  ) : null}
                  {contact.email ? (
                    <a
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                      href={`mailto:${contact.email}`}
                    >
                      <Mail className="size-3 text-muted-foreground" />
                      <span>{contact.email}</span>
                    </a>
                  ) : null}
                </div>

                <div className="flex items-center gap-1.5" onClick={event => event.stopPropagation()}>
                  {onCreateDeal && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5"
                      onClick={() => onCreateDeal(contact.id)}
                    >
                      + Cơ hội
                    </Button>
                  )}
                  {onCreateProject && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5"
                      onClick={() => onCreateProject(contact.id)}
                    >
                      + Dự án
                    </Button>
                  )}
                  <ActionMenu
                    label="Thao tác contact"
                    items={[
                      ...(canEdit ? [{ key: 'edit', label: 'Sửa', onSelect: () => openEdit(contact) }] : []),
                      { key: 'delete', label: 'Xóa', danger: true, onSelect: () => void handleDelete(contact) },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
            <Users className="size-8 text-muted-foreground/30 stroke-1" />
            <span>Chưa có người liên hệ nào.</span>
          </div>
        )}
      </CardContent>
    </Card>

      {formOpen ? (
        <div className="crm-drawer-backdrop" onClick={closeForm}>
          <aside
            className="crm-drawer crm-lead-drawer crm-lead-drawer--quick"
            data-testid="contact-form-drawer"
            onClick={event => event.stopPropagation()}
          >
            <header className="crm-lead-drawer-header">
              <div>
                <h2>{editing ? 'Sửa Contact' : 'Thêm Contact'}</h2>
                <p>Nhập SĐT hoặc Email để kiểm tra trùng trước khi hoàn thiện thông tin.</p>
              </div>
              <button type="button" className="crm-drawer-close" onClick={closeForm} aria-label="Đóng">
                <X className="crm-icon" />
              </button>
            </header>

            <form id="crmContactForm" className="crm-drawer-body crm-lead-drawer-body" onSubmit={handleSubmit}>
              {formError ? <p className="crm-error">{formError}</p> : null}

              <div className="crm-lead-quickadd-grid">
                {/* ---- Cot trai: 1. Kiem tra Contact ---- */}
                <section className="crm-form-section crm-lead-check-col">
                  <p className="crm-form-title">1. Kiểm tra Contact</p>
                  <p className="crm-lead-check-subtitle">Nhập ít nhất SĐT hoặc Email</p>
                  <div className="crm-form-grid">
                    <Field label="Số điện thoại">
                      <input
                        name="crm-contact-form-check-phone"
                        value={checkPhone}
                        onChange={e => updateCheckInput('phone', e.target.value)}
                        type="tel"
                        placeholder="VD: 0903 037 911"
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        name="crm-contact-form-check-email"
                        value={checkEmail}
                        onChange={e => updateCheckInput('email', e.target.value)}
                        type="email"
                        placeholder="VD: tien@abc.vn"
                        autoComplete="off"
                      />
                    </Field>
                  </div>

                  {dupView === 'checking' ? (
                    <p className="crm-lead-check-status crm-lead-check-status--checking">
                      <Loader2 className="crm-spin-icon" /> Đang kiểm tra trùng...
                    </p>
                  ) : null}
                  {dupView === 'clean' ? (
                    <div className="crm-lead-check-banner crm-lead-check-banner--success" data-testid="contact-dup-clean">
                      <b>✓ Không tìm thấy Contact trùng</b>
                      <span>SĐT / Email đã được tự động điền sang form.</span>
                    </div>
                  ) : null}
                  {dupView === 'error' ? (
                    <div className="crm-lead-check-banner crm-lead-check-banner--warning">
                      <b>Không kiểm tra được trùng lúc này</b>
                      <span>Có thể thử lại bằng cách sửa nhẹ SĐT/Email, hoặc bấm &quot;Vẫn thêm Contact mới&quot; nếu chắc chắn.</span>
                    </div>
                  ) : null}
                  {dupView === 'error' && !overrideCreate && !editing ? (
                    <button type="button" className="crm-ghost-button crm-button-sm" onClick={() => setOverrideCreate(true)}>
                      Vẫn thêm Contact mới
                    </button>
                  ) : null}
                  {overrideCreate ? (
                    <div className="crm-lead-check-banner crm-lead-check-banner--warning">
                      <b>Đã bỏ qua cảnh báo trùng</b>
                      <span>Bạn đang thêm Contact dù hệ thống tìm thấy Contact trùng — vui lòng kiểm tra kỹ.</span>
                    </div>
                  ) : null}
                  {dupView === 'duplicate' && !overrideCreate ? (
                    <div className="crm-lead-duplicate-cards" data-testid="contact-dup-list">
                      {duplicates.map(dup => (
                        <div key={dup.id} className="crm-lead-duplicate-card">
                          <div className="crm-lead-duplicate-card-head">
                            <div>
                              <b>{dup.name}</b>
                              <span>{dup.same_customer ? 'Đã là người liên hệ của khách hàng này' : `Thuộc khách hàng: ${dup.customer_name || 'khác'}`}</span>
                            </div>
                          </div>
                          <div className="crm-lead-duplicate-card-meta">
                            <div>Điện thoại: <b>{dup.phone || 'Chưa có'}</b></div>
                            <div>Email: <b>{dup.email || 'Chưa có'}</b></div>
                            <div>Chức vụ: <b>{dup.position_label_snapshot || dup.position || 'Chưa có'}</b></div>
                            <div>Trùng theo: <b>{(dup.match_reasons || []).map(r => (r === 'phone' ? 'SĐT' : 'Email')).join(', ') || '—'}</b></div>
                          </div>
                          <div className="crm-lead-duplicate-card-actions">
                            {dup.same_customer && onOpenContact ? (
                              <button
                                type="button"
                                className="crm-primary-button crm-button-sm"
                                onClick={() => { setFormOpen(false); onOpenContact(dup.id); }}
                              >
                                Mở Contact
                              </button>
                            ) : !dup.same_customer ? (
                              <Link className="crm-primary-button crm-button-sm" href={`/all-platform/crm/customers/${dup.customer_id}`}>
                                Mở khách hàng
                              </Link>
                            ) : null}
                            {!editing ? (
                              <button type="button" className="crm-ghost-button crm-button-sm" onClick={() => setOverrideCreate(true)}>
                                Vẫn thêm Contact mới
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <button type="button" className="crm-lead-paste-toggle" onClick={() => setPasteOpen(v => !v)}>
                    {pasteOpen ? <ChevronUp className="crm-inline-icon" /> : <ChevronDown className="crm-inline-icon" />}
                    ✨ Dán nội dung để điền nhanh
                  </button>
                  {pasteOpen ? (
                    <div className="crm-ai-fill crm-lead-paste-box">
                      <div className="crm-ai-fill-row">
                        <textarea
                          name="crm-contact-form-paste-text"
                          className="crm-ai-fill-textarea"
                          value={pasteText}
                          onChange={event => setPasteText(event.target.value)}
                          placeholder="Dán chữ ký email/tin nhắn có tên, SĐT, email, link Zalo/Facebook..., hệ thống tự tách ra ô tương ứng..."
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

                {/* ---- Cot phai: 2. Thong tin Contact ---- */}
                <section className={`crm-form-section crm-lead-info-col ${unlocked ? '' : 'crm-lead-info-col--locked'}`}>
                  <div className="crm-lead-info-col-head">
                    <div>
                      <p className="crm-form-title">2. Thông tin Contact</p>
                      <p className="crm-lead-check-subtitle">SĐT / Email tự động điền; hoàn thiện các trường còn lại.</p>
                    </div>
                    <span className={`crm-lead-lock-badge ${unlocked ? 'crm-lead-lock-badge--open' : ''}`}>
                      {unlocked ? '🔓 Đã mở khóa' : '🔒 Đang khóa'}
                    </span>
                  </div>
                  {!unlocked ? (
                    <p className="crm-lead-lock-message">
                      Form đang chờ kết quả kiểm tra trùng ở cột bên trái. Khi không trùng (hoặc bạn chọn &quot;Vẫn thêm Contact mới&quot;), form sẽ tự mở.
                    </p>
                  ) : null}

                  <fieldset className="crm-lead-info-fieldset" disabled={!unlocked}>
                    <div className="crm-form-grid">
                      <Field label="Họ và tên" required>
                        <input value={form.name} onChange={e => setValue('name', e.target.value)} placeholder="Nguyễn Văn A" />
                      </Field>
                      <Field label="Chức vụ">
                        <PositionSelect
                          value={form.positionCategoryId}
                          labelSnapshot={form.positionLabel}
                          onChange={(id, label) => setForm(f => ({ ...f, positionCategoryId: id, positionLabel: label }))}
                        />
                      </Field>
                      <Field label="Số điện thoại" hint="cần SĐT hoặc email">
                        <input value={form.phone} onChange={e => setValue('phone', e.target.value)} type="tel" placeholder="Autofill từ kiểm tra trùng" />
                      </Field>
                      <Field label="Email" hint="cần SĐT hoặc email">
                        <input value={form.email} onChange={e => setValue('email', e.target.value)} type="email" placeholder="Autofill từ kiểm tra trùng" />
                      </Field>
                    </div>
                    <div className="crm-switch-row" style={{ marginTop: '0.75rem' }}>
                      <div className="crm-switch-row-text">
                        <span className="crm-switch-row-label">Liên hệ chính</span>
                        <span className="crm-switch-row-hint">Người liên hệ chính của khách hàng này</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={form.isPrimary}
                        className={`crm-switch ${form.isPrimary ? 'crm-switch--on' : ''}`}
                        onClick={() => setForm(f => ({ ...f, isPrimary: !f.isPrimary }))}
                      >
                        <span className="crm-switch-thumb" />
                      </button>
                    </div>

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
            </form>

            <footer className="crm-drawer-footer crm-lead-drawer-footer">
              <button type="button" className="crm-cancel-button" onClick={closeForm} disabled={saving}>
                Hủy
              </button>
              <div className="crm-lead-drawer-footer-center">
                {unlocked && !editing ? <span className="crm-lead-footer-check-ok">✓ Đã kiểm tra trùng</span> : null}
              </div>
              <div className="crm-lead-drawer-footer-actions">
                <button
                  type="submit"
                  form="crmContactForm"
                  className="crm-save-button"
                  disabled={saving || !unlocked}
                  title={unlocked ? undefined : 'Cần kiểm tra trùng SĐT/Email trước'}
                >
                  {saving ? <Loader2 className="crm-save-spinner" /> : null}
                  {saving ? 'Đang lưu...' : editing ? 'Lưu' : 'Thêm Contact'}
                </button>
              </div>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
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
