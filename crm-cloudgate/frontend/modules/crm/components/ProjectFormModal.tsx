'use client';

import { useEffect, useMemo, useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { projectsService, memberOptionsService, type Project, type MemberOption } from '@/services/all-platform.service';
import { initialsOf } from '../utils/quoteDisplay';
import { MemberSearchSelect } from './MemberSearchSelect';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import { Loader2, X } from './icons';

// Ghi chu ve debounce/phan trang (yeu cau ke hoach muc C.2): danh sach Sale
// duoc tai 1 LAN DUY NHAT khi mo modal (khong goi lai API moi lan go phim) -
// o "tim kiem" chi loc client-side tren mang DA CO SAN trong bo nho, nen
// KHONG can debounce (khong co round-trip nao de debounce ca) va KHONG can
// phan trang (danh sach Sale thuc te nho, tai 1 lan la du - dung tinh than
// "tranh xay phan trang cho use-case chua tung xay ra" da chot trong ke hoach).

const STATUS_OPTIONS: Array<{ value: Project['status']; label: string }> = [
  { value: 'planning', label: 'Lên kế hoạch' },
  { value: 'active', label: 'Đang triển khai' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'cancelled', label: 'Đã huỷ' },
];

const SYSTEM_ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  leader: 'Leader',
  member: 'Member',
};

function systemRoleLabel(role: string): string {
  return SYSTEM_ROLE_LABEL[role] || role;
}

function ownerOptionSubtitle(option: MemberOption): string {
  const parts = [systemRoleLabel(option.systemRole)];
  if (option.teamNames.length) parts.push(option.teamNames.join(', '));
  return parts.join(' · ');
}

function Field({ label, hint, required, full, children }: { label: string; hint?: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`crm-field ${full ? 'crm-field--full' : ''}`}>
      <span>
        {label} {hint ? <em>({hint})</em> : null} {required ? <b>*</b> : null}
      </span>
      {children}
    </label>
  );
}

/** Modal Tao/Sua Du an (Checkpoint C tab "Dự án" trong Ho so khach hang) -
 * Customer LUON co dinh theo Ho so dang mo, hien nhu 1 khoi context CHI DOC
 * o dau form (khong phai field trong grid - customer_id cho payload LUON lay
 * tu prop `customerId`, khong bao gio tu input). Sua thi khoa customer_id
 * (khop dung update_project() backend - khong cho sua sau khi tao).
 *
 * "Mã dự án tự sinh hoàn toàn ở backend" - KHÔNG còn là input, chỉ hiện dòng
 * preview "Dự kiến: ..." (xem projectsService.previewCode()) - mã CHÍNH THỨC
 * luôn do backend cấp lúc bấm "Tạo dự án" (create_project() tự sinh, atomic
 * qua retry quanh UNIQUE index - xem supabase_project_service.py). */
export function ProjectFormModal({
  open,
  customerId,
  customerName,
  currentUserId,
  project,
  initialContactId,
  initialContactName,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  customerName: string;
  /** Id người đang đăng nhập - dùng để tự chọn chính họ làm "Người phụ trách
   * dự án" NẾU họ thuộc Sale, khi tạo dự án mới (không tự chọn người ngoài
   * Sale). Optional - nơi gọi chưa truyền thì bỏ qua autofill, không lỗi. */
  currentUserId?: string | null;
  project?: Project | null;
  initialContactId?: string;
  initialContactName?: string;
  onClose: () => void;
  /** Truyền lại dự án vừa tạo/sửa (nếu API trả về) để nơi gọi tự chọn luôn
   * bản ghi vừa tạo — tham số optional, các nơi gọi cũ không cần sửa. */
  onSaved: (savedProject?: Project) => void;
}) {
  useBodyScrollLock(open);
  const isEdit = Boolean(project);

  const [name, setName] = useState('');
  const [managerId, setManagerId] = useState('');
  const [primaryContactId, setPrimaryContactId] = useState('');
  const [status, setStatus] = useState<Project['status']>('planning');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ownerOptions, setOwnerOptions] = useState<MemberOption[]>([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  // "Người cũ không còn thuộc Sale" - phát hiện khi managerId đã lưu KHÔNG
  // nằm trong danh sách Sale vừa tải về (đã lọc team_type='sale' ở backend).
  const [staleManagerWarning, setStaleManagerWarning] = useState(false);

  const [previewCode, setPreviewCode] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name || '');
    setManagerId(project?.managerId || '');
    setPrimaryContactId((project as any)?.primaryContactId || initialContactId || '');
    setStatus(project?.status || 'planning');
    setDescription(project?.description || '');
    setError(null);
    setStaleManagerWarning(false);
  }, [open, project, initialContactId]);

  useEffect(() => {
    if (!open || !customerId) return;
    let alive = true;
    setContactsLoading(true);
    void seedingCrmRepository.listContacts(customerId)
      .then(rows => {
        if (alive) {
          setContacts(rows || []);
        }
      })
      .catch(() => {
        if (alive) setContacts([]);
      })
      .finally(() => {
        if (alive) setContactsLoading(false);
      });
    return () => { alive = false; };
  }, [open, customerId]);

  // Preview "Dự kiến" - CHỈ khi tạo mới (project đã tồn tại thì đã có
  // projectCode chính thức, không cần preview).
  useEffect(() => {
    if (!open || isEdit || !customerId) return;
    let cancelled = false;
    setPreviewLoading(true);
    projectsService
      .previewCode(customerId)
      .then(res => {
        if (cancelled) return;
        if (res.success && res.data) setPreviewCode(res.data.projectCode);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, customerId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOwnerLoading(true);
    setOwnerError(null);
    const includeIds = project?.managerId ? [project.managerId] : [];
    // "Người phụ trách dự án chỉ chọn Sale" - loc theo dung role/team/permission
    // ID that (team_type='sale', migration 049), KHONG loc bang text hien thi.
    memberOptionsService
      .getOptions({ active: true, includeIds, teamType: 'sale' })
      .then(res => {
        if (cancelled) return;
        if (res.success && res.data) {
          const items = res.data.items;
          setOwnerOptions(items);
          const currentManagerStillSale = !project?.managerId || items.some(o => o.id === project.managerId);
          setStaleManagerWarning(Boolean(project?.managerId) && !currentManagerStillSale);
          if (currentManagerStillSale === false) setManagerId('');
          // Autofill: nguoi tao dang la Sale -> tu chon chinh ho (CHI khi tao
          // moi, chua co lua chon nao khac). Khong tu chon nguoi ngoai Sale.
          if (!isEdit && !project?.managerId && currentUserId && items.some(o => o.id === currentUserId)) {
            setManagerId(prev => prev || currentUserId);
          }
        } else {
          setOwnerError('Không thể tải danh sách nhân viên Sale. Thử lại');
        }
      })
      .catch(() => {
        if (!cancelled) setOwnerError('Không thể tải danh sách nhân viên Sale. Thử lại');
      })
      .finally(() => {
        if (!cancelled) setOwnerLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // project?.id đủ để phát hiện đổi project đang sửa - không cần theo dõi
    // toàn bộ object `project` (tránh refetch khi chỉ đổi field khác của nó).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id, project?.managerId, isEdit, currentUserId]);

  const customerInitials = useMemo(() => initialsOf(customerName || '?'), [customerName]);

  if (!open) return null;

  async function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (busy) return; // chong double-submit
    if (!name.trim()) {
      setError('Vui lòng nhập tên dự án.');
      return;
    }
    if (staleManagerWarning) {
      setError('Người phụ trách hiện tại không còn thuộc nhóm Sale — vui lòng chọn lại.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isEdit && project) {
        const res = await projectsService.update(project.id, {
          name: name.trim(),
          manager_id: managerId || null,
          primary_contact_id: primaryContactId || null,
          status,
          description: description.trim() || undefined,
        });
        if (!res.success) throw new Error(res.message || 'Không lưu được dự án.');
        onSaved(res.data);
      } else {
        // KHONG gui project_code - backend luon tu sinh (xem CreateProjectInput).
        const res = await projectsService.create({
          name: name.trim(),
          customer_id: customerId,
          manager_id: managerId || null,
          primary_contact_id: primaryContactId || null,
          status,
          description: description.trim() || undefined,
        });
        if (!res.success) throw new Error(res.message || 'Không tạo được dự án.');
        onSaved(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi, vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crm-modal-backdrop" onClick={onClose}>
      <div className="crm-modal crm-modal--project-form" onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header">
          <div>
            <h2 className="crm-modal-title">{isEdit ? 'Sửa dự án' : 'Tạo dự án mới'}</h2>
          </div>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>
        <form id="projectForm" className="crm-modal-body" onSubmit={handleSubmit}>
          <div className="crm-project-customer-context">
            <span className="crm-project-customer-avatar">{customerInitials}</span>
            <span className="crm-project-customer-meta">
              <span className="crm-project-customer-label">Khách hàng</span>
              <span className="crm-project-customer-name">{customerName}</span>
            </span>
          </div>
          {error ? <p className="crm-error">{error}</p> : null}
          <div className="crm-form-section">
            <div className="crm-form-grid">
              <Field label="Người liên hệ chính" hint={initialContactId ? "đã khóa" : undefined}>
                {initialContactId ? (
                  <input
                    value={
                      initialContactName ||
                      contacts.find(c => c.id === initialContactId)?.name ||
                      (contactsLoading ? 'Đang tải...' : '')
                    }
                    disabled
                    readOnly
                  />
                ) : (
                  <select
                    value={primaryContactId}
                    onChange={e => setPrimaryContactId(e.target.value)}
                    disabled={contactsLoading}
                  >
                    <option value="">-- Chưa chọn / Liên hệ chung --</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.email ? `(${c.email})` : c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Tên dự án" required>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Website công ty ABC" />
              </Field>
              <Field label="Mã dự án">
                {isEdit ? (
                  <p className="crm-project-code-preview">{project?.projectCode}</p>
                ) : (
                  <p className="crm-project-code-preview crm-project-code-preview--pending">
                    {previewLoading ? 'Đang tính...' : previewCode ? `Dự kiến: ${previewCode}` : 'Tự động tạo khi lưu'}
                  </p>
                )}
              </Field>
              <Field label="Người phụ trách dự án">
                <MemberSearchSelect
                  value={managerId}
                  onChange={setManagerId}
                  loading={ownerLoading}
                  placeholder="Chưa gán người phụ trách"
                  searchPlaceholder="Tìm nhân viên Sale..."
                  emptyText="Không tìm thấy nhân viên Sale."
                  members={ownerOptions.map(o => ({
                    id: o.id,
                    displayName: o.displayName,
                    subtitle: ownerOptionSubtitle(o),
                    isActive: o.isActive,
                  }))}
                />
                {ownerError ? <p className="crm-error">{ownerError}</p> : null}
                {staleManagerWarning ? (
                  <p className="crm-error">Người phụ trách hiện tại không còn thuộc nhóm Sale — vui lòng chọn lại.</p>
                ) : null}
              </Field>
              <Field label="Trạng thái" required>
                <select value={status} onChange={e => setStatus(e.target.value as Project['status'])}>
                  {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </Field>
              <Field label="Mô tả" full>
                <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Mô tả ngắn về dự án (tuỳ chọn)" />
              </Field>
            </div>
          </div>
          <p className="crm-customer-form-hint">
            <strong>Dự án là lớp gom dữ liệu.</strong> Một dự án có thể có nhiều cơ hội, nhiều Quote Case và mỗi Quote Case có nhiều phiên bản.
          </p>
        </form>
        <footer className="crm-modal-footer">
          <button type="button" className="crm-cancel-button" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" form="projectForm" className="crm-save-button" disabled={busy}>
            {busy ? <Loader2 className="crm-save-spinner" /> : null}
            {busy ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Tạo dự án'}
          </button>
        </footer>
      </div>
    </div>
  );
}
