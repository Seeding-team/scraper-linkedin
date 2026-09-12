'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { projectsService, memberOptionsService, type Project, type MemberOption } from '@/services/all-platform.service';
import { initialsOf } from '../utils/quoteDisplay';
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

/** Combobox tìm kiếm được cho "Người phụ trách dự án" — mỗi dòng hiện
 * avatar/initials + tên + vai trò hệ thống + team (KHÔNG BAO GIỜ render UUID
 * thô), có option tường minh "Chưa gán người phụ trách" (manager_id nullable),
 * và badge "Đã ngưng hoạt động" nếu người đang được chọn đã bị vô hiệu hoá. */
function OwnerPicker({
  value,
  onChange,
  options,
  loading,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  options: MemberOption[];
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setSearch('');
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const selected = options.find(o => o.id === value) || null;
  const filtered = search.trim()
    ? options.filter(o => o.displayName.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  return (
    <div ref={containerRef} className="crm-searchable-select crm-owner-picker">
      <button
        type="button"
        className="crm-searchable-select-trigger crm-owner-picker-trigger"
        onClick={() => setOpen(o => !o)}
      >
        {selected ? (
          <>
            <span className="crm-owner-picker-trigger-avatar">{initialsOf(selected.displayName)}</span>
            <span className="crm-owner-picker-trigger-label">{selected.displayName}</span>
            {!selected.isActive ? <span className="crm-owner-inactive-badge">Đã ngưng hoạt động</span> : null}
          </>
        ) : (
          <span className="crm-owner-picker-trigger-label">Chưa gán người phụ trách</span>
        )}
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="crm-searchable-select-menu">
          <input
            autoFocus
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm nhân viên Sale..."
            className="crm-searchable-select-input"
          />
          <div className="crm-searchable-select-list">
            <button
              type="button"
              className={`crm-searchable-select-option ${value === '' ? 'is-selected' : ''}`}
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
            >
              Chưa gán người phụ trách
            </button>
            {loading ? <div className="crm-owner-picker-state">Đang tải thành viên...</div> : null}
            {!loading && error ? <div className="crm-owner-picker-state crm-owner-picker-state--error">{error}</div> : null}
            {!loading && !error && filtered.length === 0 ? (
              <div className="crm-owner-picker-state">Không tìm thấy nhân viên Sale.</div>
            ) : null}
            {!loading && !error
              ? filtered.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    className={`crm-searchable-select-option ${value === option.id ? 'is-selected' : ''}`}
                    onClick={() => { onChange(option.id); setOpen(false); setSearch(''); }}
                  >
                    <span className="crm-owner-option">
                      <span className="crm-owner-option-avatar">{initialsOf(option.displayName)}</span>
                      <span className="crm-owner-option-meta">
                        <span className="crm-owner-option-name">{option.displayName}</span>
                        <span className="crm-owner-option-sub">{ownerOptionSubtitle(option)}</span>
                      </span>
                      {!option.isActive ? <span className="crm-owner-inactive-badge">Đã ngưng hoạt động</span> : null}
                    </span>
                  </button>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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
  onClose: () => void;
  /** Truyền lại dự án vừa tạo/sửa (nếu API trả về) để nơi gọi tự chọn luôn
   * bản ghi vừa tạo — tham số optional, các nơi gọi cũ không cần sửa. */
  onSaved: (savedProject?: Project) => void;
}) {
  useBodyScrollLock(open);
  const isEdit = Boolean(project);

  const [name, setName] = useState('');
  const [managerId, setManagerId] = useState('');
  const [status, setStatus] = useState<Project['status']>('planning');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ownerOptions, setOwnerOptions] = useState<MemberOption[]>([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  // "Người cũ không còn thuộc Sale" - phát hiện khi managerId đã lưu KHÔNG
  // nằm trong danh sách Sale vừa tải về (đã lọc team_type='sale' ở backend).
  const [staleManagerWarning, setStaleManagerWarning] = useState(false);

  const [previewCode, setPreviewCode] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name || '');
    setManagerId(project?.managerId || '');
    setStatus(project?.status || 'planning');
    setDescription(project?.description || '');
    setError(null);
    setStaleManagerWarning(false);
  }, [open, project]);

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
          status,
          description: description.trim() || undefined,
        });
        if (!res.success) throw new Error(res.message || 'Không lưu được dự án.');
        onSaved(res.data);
      } else {
        // KHONG gui project_code - backend luon tu sinh (xem CreateProjectInput).
        const res = await projectsService.create({
          name: name.trim(),
          customer_id: customerId,
          manager_id: managerId || null,
          status,
          description: description.trim() || undefined,
        });
        if (!res.success) throw new Error(res.message || 'Không tạo được dự án.');
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
              <span className="crm-project-customer-label">Khách hàng</span>
              <span className="crm-project-customer-name">{customerName}</span>
            </span>
          </div>
          {error ? <p className="crm-error">{error}</p> : null}
          <div className="crm-form-section">
            <div className="crm-form-grid">
              <Field label="Tên dự án" required>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Website công ty ABC" />
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
                <OwnerPicker value={managerId} onChange={setManagerId} options={ownerOptions} loading={ownerLoading} error={ownerError} />
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
