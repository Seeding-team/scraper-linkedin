'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { ActionMenu } from './ActionMenu';
import { PositionSelect } from './PositionSelect';
import { fetchCrmCategoryIdOptions } from './CrmCategorySelect';
import { ChevronDown, ChevronUp, Loader2, Plus, X } from './icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  Phone, 
  Mail, 
  AlertCircle, 
  Eye, 
  Edit3, 
  Trash2, 
  FolderPlus, 
  Sparkles, 
  Search, 
  Target, 
  Folder, 
  UserCheck
} from 'lucide-react';

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
  deal_count?: number;
  project_count?: number;
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

const PHONE_RE = /(?:\+?84|0)(?:\d[\s.-]?){9,10}\b/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 12;
}
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value.trim());
}

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

  const checkable = looksLikePhone(checkPhone.trim()) || looksLikeEmail(checkEmail.trim());
  const dupView: DupState = checkable ? dupState : 'idle';

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

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const filteredContacts = contacts.filter(c => {
    const s = search.toLowerCase();
    const matchSearch = !search || (c.name || '').toLowerCase().includes(s) || (c.phone || '').includes(s) || (c.email || '').toLowerCase().includes(s) || String((c as { contact_code?: string }).contact_code || '').toLowerCase().includes(s);
    const matchRole = roleFilter === 'all' || (roleFilter === 'primary' && c.is_primary) || (roleFilter === 'secondary' && !c.is_primary);
    return matchSearch && matchRole;
  });

  return (
    <div className="space-y-6 bg-white py-1">
      {/* Workspace Header Toolbar matching mockup */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Users className="size-5 text-[#c2185b]" />
            <h2 className="text-base font-bold text-slate-900">
              Người liên hệ
              <span className="ml-2 inline-flex items-center justify-center size-5 rounded-full bg-rose-100 text-[#c2185b] text-xs font-bold">
                {contacts.length}
              </span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Quản lý các đầu mối liên hệ của khách hàng</p>
        </div>
        
        <div className="flex items-center gap-2.5">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Tìm tên, SĐT, email, mã LH..." 
              className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#c2185b]"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select 
            className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium outline-none focus:ring-1 focus:ring-[#c2185b]"
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
          >
            <option value="all">Tất cả vai trò</option>
            <option value="primary">Liên hệ chính</option>
            <option value="secondary">Liên hệ phụ</option>
          </select>

          {canEdit ? (
            <Button
              size="sm"
              className="gap-1 text-xs h-8 bg-[#c2185b] hover:bg-[#a91549] text-white shadow-2xs font-medium px-3 rounded-lg"
              onClick={openCreate}
            >
              <Plus className="size-3.5" />
              <span>Thêm liên hệ</span>
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs mb-3 flex items-start gap-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Contacts Card Row List matching mockup */}
      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin text-[#c2185b]" />
          <span>Đang tải danh sách liên hệ...</span>
        </div>
      ) : filteredContacts.length ? (
        <div className="space-y-3">
          {filteredContacts.map(contact => (
            <div
              key={contact.id}
              className={`p-4 rounded-xl border border-slate-200/90 bg-white hover:border-slate-300 transition-all flex flex-wrap items-center justify-between gap-4 ${
                onOpenContact ? 'cursor-pointer' : ''
              }`}
              onClick={onOpenContact ? () => onOpenContact(contact.id) : undefined}
            >
              {/* Column 1: Avatar + Name + Primary Badge + Position */}
              <div className="flex items-center gap-3.5 min-w-[220px]">
                <div className="size-11 rounded-full bg-rose-100 text-[#c2185b] font-bold text-base flex items-center justify-center shrink-0">
                  {contact.name ? contact.name.trim().charAt(0).toUpperCase() : '?'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 truncate">{contact.name}</span>
                    {contact.is_primary ? (
                      <Badge className="bg-rose-50 text-rose-600 border border-rose-100 shadow-none font-semibold text-[10px] px-2 py-0.5 rounded-full shrink-0">
                        Liên hệ chính
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500 font-medium truncate mt-0.5">
                    {contact.position_label_snapshot || contact.position || 'Chưa đặt chức vụ'}
                  </div>
                </div>
              </div>

              {/* Column 2: Phone & Email */}
              <div className="border-l border-slate-100 pl-6 space-y-1 text-xs shrink-0 min-w-[180px]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 text-slate-700">
                  <Phone className="size-3.5 text-slate-400 shrink-0" />
                  {contact.phone ? (
                    <a href={`tel:${contact.phone.replace(/\D/g, '')}`} className="font-medium hover:text-[#c2185b] transition-colors">
                      {contact.phone}
                    </a>
                  ) : <span className="text-slate-400 italic">Chưa có SĐT</span>}
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Mail className="size-3.5 text-slate-400 shrink-0" />
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="font-medium hover:text-[#c2185b] transition-colors truncate max-w-[150px]">
                      {contact.email}
                    </a>
                  ) : <span className="text-slate-400 italic">Chưa có email</span>}
                </div>
              </div>

              {/* Column 3: Associated Deals & Projects */}
              <div className="border-l border-slate-100 pl-6 space-y-1 text-xs shrink-0 min-w-[140px]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 text-slate-600">
                  <Target className="size-3.5 text-[#c2185b] shrink-0" />
                  <span className="font-semibold text-slate-800">{contact.deal_count || 0} Cơ hội</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Folder className="size-3.5 text-blue-600 shrink-0" />
                  <span className="font-semibold text-slate-800">{contact.project_count || 0} Dự án</span>
                </div>
              </div>

              {/* Column 4: Quick Actions & ActionMenu */}
              <div className="border-l border-slate-100 pl-6 flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                {contact.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/\D/g, '')}`}
                    className="size-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#c2185b] hover:text-[#c2185b] flex items-center justify-center transition-all shadow-2xs"
                    title="Gọi điện"
                  >
                    <Phone className="size-4" />
                  </a>
                ) : null}
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="size-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#c2185b] hover:text-[#c2185b] flex items-center justify-center transition-all shadow-2xs"
                    title="Gửi Email"
                  >
                    <Mail className="size-4" />
                  </a>
                ) : null}
                
                <ActionMenu
                  label="Thao tác contact"
                  items={[
                    ...(onOpenContact ? [{ key: 'view', label: 'Xem chi tiết', icon: Eye, onSelect: () => onOpenContact(contact.id) }] : []),
                    ...(canEdit ? [{ key: 'edit', label: 'Chỉnh sửa', icon: Edit3, onSelect: () => openEdit(contact) }] : []),
                    ...(onCreateDeal ? [{ key: 'deal', label: 'Tạo cơ hội', icon: Sparkles, onSelect: () => onCreateDeal(contact.id) }] : []),
                    ...(onCreateProject ? [{ key: 'project', label: 'Gắn vào dự án', icon: FolderPlus, onSelect: () => onCreateProject(contact.id) }] : []),
                    ...(canEdit ? [{ key: 'delete', label: 'Xóa', icon: Trash2, danger: true, onSelect: () => void handleDelete(contact) }] : []),
                  ]}
                />
              </div>
            </div>
          ))}

          {/* Empty State Banner for Additional Contacts matching mockup */}
          <div className="pt-8 pb-6 text-center border-t border-slate-100 flex flex-col items-center gap-2.5">
            <div className="size-12 rounded-full bg-rose-50 text-[#c2185b] flex items-center justify-center">
              <UserCheck className="size-6" />
            </div>
            <h3 className="font-bold text-sm text-slate-800">Chưa có người liên hệ khác</h3>
            <p className="text-xs text-slate-400 max-w-sm">
              Thêm người liên hệ để quản lý thông tin và theo dõi tương tác.
            </p>
            {canEdit ? (
              <Button
                size="sm"
                className="mt-1 gap-1 text-xs h-8 bg-[#c2185b] hover:bg-[#a91549] text-white shadow-2xs font-medium px-4 rounded-lg"
                onClick={openCreate}
              >
                <Plus className="size-3.5" />
                <span>Thêm liên hệ</span>
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
          <div className="size-12 rounded-full bg-rose-50 text-[#c2185b] flex items-center justify-center">
            <UserCheck className="size-6" />
          </div>
          <h3 className="font-bold text-sm text-slate-800">Chưa có người liên hệ</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Thêm người liên hệ để quản lý thông tin và theo dõi tương tác.
          </p>
          {canEdit ? (
            <Button
              size="sm"
              className="mt-2 gap-1 text-xs h-8 bg-[#c2185b] hover:bg-[#a91549] text-white shadow-2xs font-medium px-4 rounded-lg"
              onClick={openCreate}
            >
              <Plus className="size-3.5" />
              <span>Thêm liên hệ</span>
            </Button>
          ) : null}
        </div>
      )}

      {/* Slide-over Form Drawer */}
      {formOpen ? (
        // Chi dong khi click THAT SU vao backdrop (khong phai bubble tu dropdown
        // portal ra document.body ben trong drawer - xem CustomerFormModal.tsx).
        <div className="crm-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) closeForm(); }}>
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
                {/* Cot trai: Kiem tra Contact */}
                <section className="crm-form-section crm-lead-check-col">
                  <p className="crm-form-title">1. Kiểm tra Contact</p>
                  <p className="crm-lead-check-subtitle">Nhập ít nhất SĐT hoặc Email</p>
                  <div className="crm-form-grid">
                    <div className="crm-field">
                      <label className="crm-label">Số điện thoại</label>
                      <input
                        name="crm-contact-form-check-phone"
                        value={checkPhone}
                        onChange={e => updateCheckInput('phone', e.target.value)}
                        type="tel"
                        placeholder="VD: 0903 037 911"
                        autoComplete="off"
                        className="crm-input"
                      />
                    </div>
                    <div className="crm-field">
                      <label className="crm-label">Email</label>
                      <input
                        name="crm-contact-form-check-email"
                        value={checkEmail}
                        onChange={e => updateCheckInput('email', e.target.value)}
                        type="email"
                        placeholder="VD: tien@abc.vn"
                        autoComplete="off"
                        className="crm-input"
                      />
                    </div>
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

                {/* Cot phai: Thong tin Contact */}
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
                      <div className="crm-field">
                        <label className="crm-label">Họ và tên <span className="text-rose-500">*</span></label>
                        <input className="crm-input" value={form.name} onChange={e => setValue('name', e.target.value)} placeholder="Nguyễn Văn A" />
                      </div>
                      <div className="crm-field">
                        <label className="crm-label">Chức vụ</label>
                        <PositionSelect
                          value={form.positionCategoryId}
                          labelSnapshot={form.positionLabel}
                          onChange={(id, label) => setForm(f => ({ ...f, positionCategoryId: id, positionLabel: label }))}
                        />
                      </div>
                      <div className="crm-field">
                        <label className="crm-label">Số điện thoại</label>
                        <input className="crm-input" value={form.phone} onChange={e => setValue('phone', e.target.value)} type="tel" placeholder="Autofill từ kiểm tra trùng" />
                      </div>
                      <div className="crm-field">
                        <label className="crm-label">Email</label>
                        <input className="crm-input" value={form.email} onChange={e => setValue('email', e.target.value)} type="email" placeholder="Autofill từ kiểm tra trùng" />
                      </div>
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
                          <div className="crm-field">
                            <label className="crm-label">Zalo</label>
                            <input className="crm-input" value={form.zalo} onChange={e => setValue('zalo', e.target.value)} placeholder="Số/link Zalo" />
                          </div>
                          <div className="crm-field">
                            <label className="crm-label">Facebook</label>
                            <input className="crm-input" value={form.facebook} onChange={e => setValue('facebook', e.target.value)} placeholder="Link Facebook" />
                          </div>
                          <div className="crm-field">
                            <label className="crm-label">Telegram</label>
                            <input className="crm-input" value={form.telegram} onChange={e => setValue('telegram', e.target.value)} placeholder="@username hoặc link" />
                          </div>
                          <div className="crm-field">
                            <label className="crm-label">Website</label>
                            <input className="crm-input" value={form.website} onChange={e => setValue('website', e.target.value)} placeholder="https://..." />
                          </div>
                          <div className="crm-field col-span-2">
                            <label className="crm-label">Ghi chú</label>
                            <textarea className="crm-input" value={form.note} onChange={e => setValue('note', e.target.value)} placeholder="Ghi chú nội bộ..." />
                          </div>
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
    </div>
  );
}
