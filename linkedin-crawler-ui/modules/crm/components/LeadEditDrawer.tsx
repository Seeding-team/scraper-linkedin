'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { PositionSelect } from './PositionSelect';
import { MemberSearchSelect } from './MemberSearchSelect';
import { CrmCategoryCodeSelect } from './CrmCategorySelect';
import { mapLead } from './LeadsDirectory';
import { Loader2, X } from './icons';
import { hasFullCrmAccess, LEAD_SOURCE_EXCLUDED_VALUES } from '../constants/crmConfig';
import { crmTeamsService, usersService, type CrmTeam } from '@/services/all-platform.service';
import type { AppUser } from '@/types/unified.types';
import type { CrmLeadRow, CrmLeadStatus } from '../types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function isAdminOrLeader(user: AppUser | null) {
  return hasFullCrmAccess(user);
}

type EditFormState = {
  leadName: string;
  companyName: string;
  positionCategoryId: string;
  positionLabel: string;
  phone: string;
  email: string;
  source: string;
  sdrId: string;
  /** Team Sale nhận bàn giao (crm_leads.team_id -> crm_teams). */
  teamId: string;
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
    // Sale phu trach (neu da co) la nguoi phu trach that; SDR luon theo Sale.
    sdrId: lead.qualificationAeId || lead.sdrId || '',
    teamId: lead.teamId || '',
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
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !lead) {
      setForm(null);
      return;
    }
    setForm(formFromLead(lead));
    setError('');
    // Nạp lại form theo lead.id (không theo tham chiếu object) — tránh chạy
    // lại effect này khi LeadsDirectory chỉ đẩy xuống 1 object mới cho CÙNG
    // lead (vd sau khi lưu ở nơi khác).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id]);

  const canPickOwner = isAdminOrLeader(currentUser);
  const [leadOwnerUsers, setLeadOwnerUsers] = useState<Array<{ id: string; name: string; email?: string | null }>>([]);
  const ownerLabel = useMemo(() => {
    if (!form?.sdrId) return 'Chưa gán';
    if (form.sdrId === currentUser?.id) return currentUser?.name || currentUser?.email || 'Bạn';
    return leadOwnerUsers.find(u => u.id === form.sdrId)?.name || 'Chưa gán';
  }, [form?.sdrId, leadOwnerUsers, currentUser]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      usersService.getUsersByQuoteBusinessRole('presale'),
      usersService.getUsersByQuoteBusinessRole('sale'),
    ])
      .then(([presaleRes, saleRes]) => {
        if (!alive) return;
        const byId = new Map<string, { id: string; name: string; email?: string | null }>();
        [
          ...(presaleRes.success ? presaleRes.data || [] : []),
          ...(saleRes.success ? saleRes.data || [] : []),
        ].forEach(user => {
          if (user.id && !byId.has(user.id)) byId.set(user.id, { id: user.id, name: user.name || 'Chưa đặt tên' });
        });
        setLeadOwnerUsers([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (alive) setLeadOwnerUsers([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const [saleTeams, setSaleTeams] = useState<CrmTeam[]>([]);
  const [teamResolving, setTeamResolving] = useState(false);
  const findTeamIdInLoadedTeams = (ownerId: string) => (
    saleTeams.find(team => (
      team.status === 'active' &&
      (team.leader_user_id === ownerId || (team.member_ids || []).includes(ownerId))
    ))?.id || ''
  );
  useEffect(() => {
    if (!open) return;
    let alive = true;
    crmTeamsService
      .list()
      .then(res => {
        if (alive) setSaleTeams(res.success ? (res.data || []).filter(t => t.status === 'active') : []);
      })
      .catch(() => {
        if (alive) setSaleTeams([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);
  useEffect(() => {
    if (!form?.sdrId) {
      setForm(current => (current?.teamId ? { ...current, teamId: '' } : current));
      return;
    }
    const ownerId = form.sdrId;
    const localTeamId = findTeamIdInLoadedTeams(ownerId);
    if (localTeamId) setForm(current => (current && current.teamId !== localTeamId ? { ...current, teamId: localTeamId } : current));
    let alive = true;
    setTeamResolving(true);
    crmTeamsService
      .getTeamIdForUser(ownerId)
      .then(res => {
        if (!alive) return;
        const nextTeamId = (res.success ? res.data?.crm_team_id || '' : '') || localTeamId;
        setForm(current => (current && current.teamId !== nextTeamId ? { ...current, teamId: nextTeamId } : current));
      })
      .catch(() => {
        if (alive && !localTeamId) setForm(current => (current?.teamId ? { ...current, teamId: '' } : current));
      })
      .finally(() => {
        if (alive) setTeamResolving(false);
      });
    return () => {
      alive = false;
    };
  }, [form?.sdrId, saleTeams]);

  if (!open || !lead || !form) return null;

  const canWrite = Boolean(lead.canWrite);
  const isConverted = lead.status === 'converted' || lead.status === 'sql';

  function setValue<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setForm(current => (current ? { ...current, [key]: value } : current));
  }

  const locallyResolvedTeamId = form?.sdrId ? findTeamIdInLoadedTeams(form.sdrId) : '';
  const effectiveTeamId = form?.teamId || locallyResolvedTeamId;
  const teamOptionsForSelect = saleTeams.map(t => ({ id: t.id, displayName: t.name || t.code || 'Team Sale' }));
  if (effectiveTeamId && !teamOptionsForSelect.some(option => option.id === effectiveTeamId)) {
    teamOptionsForSelect.push({ id: effectiveTeamId, displayName: 'Team Sale đã gán' });
  }

  /** Cùng đúng 1 luật bắt buộc với luồng tạo Lead (LeadFormDrawer.validate):
   * phải có tên, và phải có ít nhất SĐT hoặc email. Không siết thêm luật mới
   * ở màn sửa để không khoá cứng những Lead cũ hợp lệ. */
  function validate(state: EditFormState): string | null {
    if (!state.leadName.trim()) return 'Vui lòng nhập họ và tên người liên hệ.';
    if (!state.phone.trim() && !state.email.trim()) return 'Cần nhập số điện thoại hoặc email.';
    if (!state.source) return 'Vui lòng chọn nguồn Lead.';
    if (!state.sdrId) return 'Vui lòng chọn người phụ trách Lead.';
    return null;
  }

  async function handleSave() {
    if (!form || !lead) return;
    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
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
      if (canPickOwner && !lead?.qualificationAeId) payload.sdr_id = form.sdrId || null;
      payload.team_id = effectiveTeamId || null;

      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || `Không lưu được thay đổi (lỗi ${res.status}).`);
      onSaved(mapLead(body.data));
      onClose();
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
          {!canWrite ? (
            <p className="crm-lead-lock-message">Bạn không có quyền sửa Lead này — chỉ xem.</p>
          ) : null}

          <fieldset className="crm-lead-info-fieldset" disabled={!canWrite || saving}>
            <section className="crm-form-section">
              <p className="crm-form-title">Thông tin cơ bản</p>
              <div className="crm-form-grid">
                <Field label="Họ và tên người liên hệ" required>
                  <input
                    data-testid="edit-lead-name"
                    value={form.leadName}
                    onChange={e => setValue('leadName', e.target.value)}
                    placeholder="Nguyễn Văn A"
                  />
                </Field>
                <Field label="Công ty / Tổ chức">
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
                    placeholder="-- Chưa chọn --"
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
                <Field label="Nguồn" required>
                  <CrmCategoryCodeSelect
                    categoryType="crm_source"
                    value={form.source}
                    excludeValues={LEAD_SOURCE_EXCLUDED_VALUES}
                    onChange={value => setValue('source', value)}
                    placeholder="-- Chưa chọn --"
                  />
                </Field>
                {lead?.qualificationAeId ? (
                  <Field label="Người phụ trách (theo Sale phụ trách)" required hint="đổi ở bước Xác minh → Sale phụ trách">
                    <input data-testid="edit-sdr" value={ownerLabel} disabled readOnly />
                  </Field>
                ) : canPickOwner ? (
                  <Field label="Người phụ trách (SDR)" required>
                    <MemberSearchSelect
                      testId="edit-sdr"
                      value={form.sdrId}
                      onChange={value => setValue('sdrId', value)}
                      placeholder="-- Chưa gán --"
                      showAvatar={false}
                      members={[
                        ...(currentUser?.id && !leadOwnerUsers.some(u => u.id === currentUser.id)
                          ? [{ id: currentUser.id, displayName: `${currentUser.name || currentUser.email || 'Bạn'} (Chính bạn)`, email: currentUser.email }]
                          : []),
                        ...leadOwnerUsers.map(user => ({
                          id: user.id,
                          displayName: user.id === currentUser?.id ? `${user.name} (Chính bạn)` : user.name,
                          email: user.email,
                        })),
                      ]}
                    />
                  </Field>
                ) : (
                  <Field label="Người phụ trách (SDR)" required hint="chỉ admin/leader đổi được">
                    <input data-testid="edit-sdr" value={ownerLabel} disabled readOnly />
                  </Field>
                )}
                <Field label="Team Sale">
                  <MemberSearchSelect
                    value={effectiveTeamId}
                    onChange={() => {}}
                    placeholder="-- Chưa gán --"
                    showAvatar={false}
                    disabled
                    loading={teamResolving}
                    members={teamOptionsForSelect}
                  />
                </Field>
                <Field label="Trạng thái">
                  <input data-testid="edit-status" value={isConverted ? 'Đã tạo cơ hội' : form.status.toUpperCase()} disabled readOnly />
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
