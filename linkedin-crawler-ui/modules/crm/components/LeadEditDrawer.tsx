'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useMembers } from '@/hooks/useMembers';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { PositionSelect } from './PositionSelect';
import { CrmCategoryCodeSelect } from './CrmCategorySelect';
import { mapLead } from './LeadsDirectory';
import { Loader2, X } from './icons';
import type { AppUser } from '@/types/unified.types';
import type { CrmLeadRow, CrmLeadStatus } from '../types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function isAdminOrLeader(user: AppUser | null) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'leader';
}

/** Trạng thái được phép chọn tay. 'converted' KHÔNG có mặt: backend
 * (update_lead trong crm_lead_service.py) chủ động ném lỗi nếu ai đó PUT
 * status='converted' — chỉ endpoint Convert mới được đặt trạng thái đó. Lead
 * đang ở 'converted' thì ô này hiện read-only thay vì đưa ra lựa chọn sẽ bị
 * backend từ chối. */
const EDITABLE_STATUS_OPTIONS: Array<{ value: CrmLeadStatus; label: string }> = [
  { value: 'mql', label: 'MQL' },
  { value: 'nurturing', label: 'Nuôi dưỡng' },
  { value: 'unqualified', label: 'Không đạt chuẩn' },
];

type EditFormState = {
  leadName: string;
  companyName: string;
  positionCategoryId: string;
  positionLabel: string;
  phone: string;
  email: string;
  source: string;
  sdrId: string;
  status: CrmLeadStatus;
  zalo: string;
  facebook: string;
  telegram: string;
  website: string;
  note: string;
};

function formFromLead(lead: CrmLeadRow): EditFormState {
  return {
    leadName: lead.leadName || '',
    companyName: lead.companyName || '',
    positionCategoryId: lead.positionCategoryId || '',
    positionLabel: lead.positionLabelSnapshot || lead.position || '',
    phone: lead.phone || '',
    email: lead.email || '',
    source: lead.source || '',
    sdrId: lead.sdrId || '',
    status: lead.status,
    zalo: lead.zalo || '',
    facebook: lead.facebook || '',
    telegram: lead.telegram || '',
    website: lead.website || '',
    note: lead.note || '',
  };
}

/**
 * Drawer "Sửa Lead" — form sửa THẬT, mở được toàn bộ trường hồ sơ của 1
 * `crm_leads`. Đây là bản DUY NHẤT của form sửa Lead: cả "Sửa nhanh" trong
 * menu "⋯" ở LeadsDirectory lẫn nút "Chỉnh sửa" trong drawer "Xác minh Lead"
 * (LeadDetailDrawer) đều mở đúng component này, không có bản thứ hai.
 *
 * KHÔNG dựng endpoint mới: lưu bằng đúng `PUT /crm/leads/{id}` sẵn có —
 * CrmLeadUpdate (schemas/crm_lead.py) đã nhận đủ mọi trường ở đây từ trước.
 *
 * Khác hẳn LeadFormDrawer ("Thêm Lead nhanh"): không có luồng kiểm-trùng-
 * trước-khi-mở-form, vì đây là sửa 1 bản ghi đã tồn tại.
 */
export function LeadEditDrawer({
  lead,
  open,
  currentUser,
  onClose,
  onSaved,
}: {
  lead: CrmLeadRow | null;
  open: boolean;
  currentUser: AppUser | null;
  onClose: () => void;
  onSaved: (lead: CrmLeadRow) => void;
}) {
  useBodyScrollLock(open);
  const { members } = useMembers();
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState('');

  useEffect(() => {
    if (!open || !lead) {
      setForm(null);
      return;
    }
    setForm(formFromLead(lead));
    setError('');
    setSavedOk('');
    // Nạp lại form theo lead.id (không theo tham chiếu object) — sau khi lưu,
    // LeadsDirectory đẩy xuống 1 object mới cho CÙNG lead, nếu chạy lại theo
    // tham chiếu thì thông báo "Đã lưu" vừa hiện sẽ bị xoá ngay lập tức.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id]);

  const canPickOwner = isAdminOrLeader(currentUser);
  const selectionKeyOf = (m: { id: string; linked_user_id?: string | null; linked_user_id_2?: string | null }) =>
    m.linked_user_id || m.linked_user_id_2 || m.id;
  const sdrOptions = useMemo(() => {
    const linked = members.filter(m => m.linked_user_id || m.linked_user_id_2);
    return [...linked].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [members]);
  const ownerLabel = useMemo(() => {
    if (!form?.sdrId) return 'Chưa gán';
    if (form.sdrId === currentUser?.id) return currentUser?.name || currentUser?.email || 'Bạn';
    return sdrOptions.find(m => selectionKeyOf(m) === form.sdrId)?.display_name || 'Chưa gán';
  }, [form?.sdrId, sdrOptions, currentUser]);

  if (!open || !lead || !form) return null;

  const canWrite = Boolean(lead.canWrite);
  const isConverted = lead.status === 'converted' || lead.status === 'sql';

  function setValue<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setForm(current => (current ? { ...current, [key]: value } : current));
  }

  /** Cùng đúng 1 luật bắt buộc với luồng tạo Lead (LeadFormDrawer.validate):
   * phải có tên, và phải có ít nhất SĐT hoặc email. Không siết thêm luật mới
   * ở màn sửa để không khoá cứng những Lead cũ hợp lệ. */
  function validate(state: EditFormState): string | null {
    if (!state.leadName.trim()) return 'Vui lòng nhập tên khách hàng.';
    if (!state.phone.trim() && !state.email.trim()) return 'Cần nhập số điện thoại hoặc email.';
    return null;
  }

  async function handleSave() {
    if (!form || !lead) return;
    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      setSavedOk('');
      return;
    }
    setSaving(true);
    setError('');
    setSavedOk('');
    try {
      const payload: Record<string, unknown> = {
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
        note: form.note.trim() || null,
      };
      // Lead đã convert: KHÔNG gửi status lên (backend từ chối 'converted', và
      // hạ cấp trạng thái của 1 Lead đã sinh Cơ hội cũng là sai nghiệp vụ).
      if (!isConverted) payload.status = form.status;
      if (canPickOwner) payload.sdr_id = form.sdrId || null;

      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || `Không lưu được thay đổi (lỗi ${res.status}).`);
      onSaved(mapLead(body.data));
      setSavedOk('Đã lưu thay đổi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được thay đổi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="crm-drawer-backdrop" onClick={onClose} />
      <aside className="crm-drawer crm-lead-edit-drawer" data-testid="lead-edit-drawer">
        <header className="crm-lead-drawer-header">
          <div>
            <h2>Sửa Lead</h2>
            <p>Cập nhật thông tin hồ sơ Lead. Thao tác này không tạo Khách hàng/Cơ hội nào.</p>
          </div>
          <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-drawer-body crm-lead-drawer-body">
          {error ? <p className="crm-error" data-testid="lead-edit-error">{error}</p> : null}
          {savedOk ? <p className="crm-verify-ok" data-testid="lead-edit-ok">{savedOk}</p> : null}
          {!canWrite ? (
            <p className="crm-lead-lock-message">Bạn không có quyền sửa Lead này — chỉ xem.</p>
          ) : null}

          <fieldset className="crm-lead-info-fieldset" disabled={!canWrite || saving}>
            <section className="crm-form-section">
              <p className="crm-form-title">Thông tin cơ bản</p>
              <div className="crm-form-grid">
                <Field label="Tên khách hàng" required>
                  <input
                    data-testid="edit-lead-name"
                    value={form.leadName}
                    onChange={e => setValue('leadName', e.target.value)}
                    placeholder="Nguyễn Văn A"
                  />
                </Field>
                <Field label="Công ty">
                  <input
                    data-testid="edit-company-name"
                    value={form.companyName}
                    onChange={e => setValue('companyName', e.target.value)}
                    placeholder="Công ty TNHH ABC"
                  />
                </Field>
                <Field label="Chức vụ">
                  <PositionSelect
                    value={form.positionCategoryId}
                    labelSnapshot={form.positionLabel}
                    disabled={!canWrite || saving}
                    onChange={(id, label) => {
                      setValue('positionCategoryId', id);
                      setValue('positionLabel', label);
                    }}
                  />
                </Field>
                <Field label="Số điện thoại" hint="cần SĐT hoặc email">
                  <input
                    data-testid="edit-phone"
                    value={form.phone}
                    onChange={e => setValue('phone', e.target.value)}
                    type="tel"
                    placeholder="VD: 0903 037 911"
                  />
                </Field>
                <Field label="Email" hint="cần SĐT hoặc email">
                  <input
                    data-testid="edit-email"
                    value={form.email}
                    onChange={e => setValue('email', e.target.value)}
                    type="email"
                    placeholder="VD: tien@abc.vn"
                  />
                </Field>
              </div>
            </section>

            <section className="crm-form-section">
              <p className="crm-form-title">Nguồn · Phụ trách · Trạng thái</p>
              <div className="crm-form-grid">
                <Field label="Nguồn">
                  <CrmCategoryCodeSelect
                    categoryType="crm_source"
                    value={form.source}
                    onChange={value => setValue('source', value)}
                    placeholder="-- Chưa chọn --"
                  />
                </Field>
                {canPickOwner ? (
                  <Field label="Người phụ trách (SDR)">
                    <select data-testid="edit-sdr" value={form.sdrId} onChange={e => setValue('sdrId', e.target.value)}>
                      <option value="">-- Chưa gán --</option>
                      {currentUser?.id && !sdrOptions.some(m => selectionKeyOf(m) === currentUser.id) ? (
                        <option value={currentUser.id}>-- Chính bạn --</option>
                      ) : null}
                      {sdrOptions.map(m => (
                        <option key={m.id} value={selectionKeyOf(m)}>
                          {m.display_name}{m.email ? ` (${m.email})` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Người phụ trách (SDR)" hint="chỉ admin/leader đổi được">
                    <input data-testid="edit-sdr" value={ownerLabel} disabled readOnly />
                  </Field>
                )}
                <Field label="Trạng thái">
                  {isConverted ? (
                    <input data-testid="edit-status" value="Đã tạo cơ hội" disabled readOnly />
                  ) : (
                    <select
                      data-testid="edit-status"
                      value={form.status}
                      onChange={e => setValue('status', e.target.value as CrmLeadStatus)}
                    >
                      {EDITABLE_STATUS_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            </section>

            <section className="crm-form-section">
              <p className="crm-form-title">Kênh liên hệ</p>
              <div className="crm-form-grid">
                <Field label="Zalo">
                  <input data-testid="edit-zalo" value={form.zalo} onChange={e => setValue('zalo', e.target.value)} placeholder="Số/link Zalo" />
                </Field>
                <Field label="Facebook">
                  <input data-testid="edit-facebook" value={form.facebook} onChange={e => setValue('facebook', e.target.value)} placeholder="Link Facebook" />
                </Field>
                <Field label="Telegram">
                  <input data-testid="edit-telegram" value={form.telegram} onChange={e => setValue('telegram', e.target.value)} placeholder="@username hoặc link" />
                </Field>
                <Field label="Website">
                  <input data-testid="edit-website" value={form.website} onChange={e => setValue('website', e.target.value)} placeholder="https://..." />
                </Field>
              </div>
            </section>

            <section className="crm-form-section">
              <p className="crm-form-title">Ghi chú</p>
              <div className="crm-form-grid">
                <Field full label="Ghi chú">
                  <textarea
                    data-testid="edit-note"
                    value={form.note}
                    onChange={e => setValue('note', e.target.value)}
                    placeholder="Ghi chú nội bộ..."
                    rows={4}
                  />
                </Field>
              </div>
            </section>
          </fieldset>
        </div>

        <footer className="crm-drawer-footer crm-lead-drawer-footer">
          <button type="button" className="crm-cancel-button" onClick={onClose} disabled={saving}>
            Hủy
          </button>
          <div className="crm-lead-drawer-footer-actions">
            <button
              type="button"
              className="crm-save-button"
              data-testid="lead-edit-save"
              disabled={saving || !canWrite}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 className="crm-save-spinner" /> : null}
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </footer>
      </aside>
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
