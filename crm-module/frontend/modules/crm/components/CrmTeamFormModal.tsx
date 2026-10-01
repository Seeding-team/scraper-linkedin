'use client';

/** Modal tạo/sửa "Team CRM" - TÁCH RA từ CrmTeamsShell.tsx (trang
 * `/all-platform/crm/sale-teams`) để tái sử dụng ở nút "+ Thêm Team mới"
 * trong dropdown "Team Sale" của 3 form (LeadDetailDrawer, CreateOpportunityDrawer,
 * DealFormFields) — feedback "tái sử dụng lại bên chỗ team crm" (2026-09-29).
 * CrmTeamsShell.tsx giữ nguyên hành vi cũ (đóng ngay sau khi lưu, không có
 * bước thêm thành viên) bằng cách KHÔNG truyền `allowAddMembersAfterCreate`.
 * 3 form gọi từ dropdown truyền `allowAddMembersAfterCreate` để cho thêm
 * thành viên ngay sau khi tạo Team mới (tuỳ chọn, không bắt buộc). */

import { useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui';
import { SearchableSelect } from './SearchableSelect';
import {
  crmTeamsService,
  type AppUserProfile,
  type CrmTeam,
} from '@/services/all-platform.service';

export const CRM_TEAM_SEGMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'smb', label: 'SMB' },
  { value: 'mid_market', label: 'Mid-Market' },
  { value: 'government', label: 'Government' },
  { value: 'mixed', label: 'Mixed' },
];

export const CRM_TEAM_FUNCTION_AREA_OPTIONS: { value: string; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'presale', label: 'Presale' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'software', label: 'Software' },
  { value: 'security', label: 'Security' },
  { value: 'finance', label: 'Finance' },
  { value: 'operations', label: 'Operations' },
];

export function emptyCrmTeamForm(): Partial<CrmTeam> {
  return {
    name: '',
    code: '',
    leader_user_id: '',
    status: 'active',
    segment: null,
    function_area: null,
    industry: '',
    region: '',
    description: '',
  };
}

export function CrmTeamFormModal({
  open,
  editingId,
  initialTeam,
  leaders,
  allUsers = [],
  allowAddMembersAfterCreate = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = tạo mới, có giá trị = sửa Team đã có (đúng id đang sửa). */
  editingId: string | null;
  /** Snapshot Team đang sửa (bỏ qua khi editingId = null). */
  initialTeam?: Partial<CrmTeam> | null;
  leaders: AppUserProfile[];
  /** Chỉ cần khi `allowAddMembersAfterCreate` - danh sách user để chọn thêm
   * thành viên ngay sau khi tạo Team mới. */
  allUsers?: AppUserProfile[];
  /** true: sau khi TẠO MỚI thành công (không áp dụng khi sửa), hiện thêm 1
   * bước "Thêm thành viên" ngay trong modal trước khi đóng - dùng cho nút
   * "+ Thêm Team mới" trong dropdown Team Sale. CrmTeamsShell.tsx (trang Team
   * CRM) KHÔNG bật cờ này để giữ nguyên hành vi cũ (đóng ngay sau khi lưu). */
  allowAddMembersAfterCreate?: boolean;
  onClose: () => void;
  /** Gọi sau khi lưu xong (tạo/sửa) - hoặc sau khi bấm "Xong" ở bước thêm
   * thành viên (nếu bật allowAddMembersAfterCreate). Trả về Team mới nhất. */
  onSaved: (team: CrmTeam) => void;
}) {
  const [form, setForm] = useState<Partial<CrmTeam>>(() => (editingId ? initialTeam || {} : emptyCrmTeamForm()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTeam, setCreatedTeam] = useState<CrmTeam | null>(null);
  const [memberToAdd, setMemberToAdd] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(editingId ? { ...(initialTeam || {}) } : emptyCrmTeamForm());
    setError(null);
    setCreatedTeam(null);
    setMemberToAdd('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  async function handleLeaderChange(leaderUserId: string) {
    setForm(f => ({ ...f, leader_user_id: leaderUserId }));
    if (!editingId && leaderUserId) {
      const leader = leaders.find(l => l.id === leaderUserId);
      if (leader) {
        setForm(f => ({ ...f, leader_user_id: leaderUserId, name: f.name?.trim() ? f.name : `Team ${leader.name || leader.email}` }));
        const suggestRes = await crmTeamsService.suggestCode(leader.name || leader.email);
        if (suggestRes.success) {
          setForm(f => (f.code?.trim() ? f : { ...f, code: suggestRes.data?.code }));
        }
      }
    }
  }

  async function handleSave() {
    if (!form.name?.trim() && !form.leader_user_id) {
      setError('Cần chọn Leader hoặc nhập tên Team');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = editingId ? await crmTeamsService.update(editingId, form) : await crmTeamsService.create(form);
      if (!res.success || !res.data) {
        setError(res.message || 'Lưu thất bại.');
        return;
      }
      if (!editingId && allowAddMembersAfterCreate) {
        setCreatedTeam(res.data);
        return;
      }
      onSaved(res.data);
    } catch {
      setError('Có lỗi xảy ra, thử lại sau.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMemberToCreatedTeam(userId: string) {
    if (!createdTeam || !userId) return;
    await crmTeamsService.addMember(createdTeam.id, userId);
    const res = await crmTeamsService.get(createdTeam.id);
    if (res.success && res.data) setCreatedTeam(res.data);
    setMemberToAdd('');
  }

  function finishAfterCreate() {
    if (createdTeam) onSaved(createdTeam);
  }

  if (!open) return null;

  // Buoc "Thêm thành viên" ngay sau khi tao Team moi (chi khi
  // allowAddMembersAfterCreate) - tuy chon, khong bat buoc phai them ai.
  if (createdTeam) {
    const memberIds = new Set((createdTeam.members || []).map(m => m.id));
    const availableUsers = allUsers.filter(u => !memberIds.has(u.id));
    return (
      <div className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/40 p-4" onClick={finishAfterCreate}>
        <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-surface shadow-xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant p-5">
            <div className="text-body-lg font-bold text-on-background">Đã tạo Team &quot;{createdTeam.name}&quot;</div>
            <button type="button" onClick={finishAfterCreate} className="p-1.5 hover:bg-surface-container-low rounded-lg transition">
              <MaterialIcon name="close" className="text-base" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Thêm thành viên (tuỳ chọn)</label>
              <SearchableSelect
                value={memberToAdd}
                onChange={value => {
                  setMemberToAdd(value);
                  void handleAddMemberToCreatedTeam(value);
                }}
                options={availableUsers.map(u => ({ value: u.id, label: u.name || u.email }))}
                placeholder="— Chọn user —"
                searchPlaceholder="Tìm user..."
              />
            </div>
            {createdTeam.members?.length ? (
              <ul className="space-y-1.5">
                {createdTeam.members.map(m => (
                  <li key={m.id} className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs">
                    {m.name || m.email}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs italic text-on-surface-variant">Chưa có thành viên.</div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-outline-variant p-4">
            <button
              type="button"
              onClick={finishAfterCreate}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-on-primary-fixed-variant transition"
            >
              Xong
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-surface shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-outline-variant p-5">
          <div className="text-body-lg font-bold text-on-background">{editingId ? 'Sửa Team CRM' : 'Tạo Team CRM'}</div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-surface-container-low rounded-lg transition">
            <MaterialIcon name="close" className="text-base" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Leader</label>
            <SearchableSelect
              value={form.leader_user_id || ''}
              onChange={value => void handleLeaderChange(value)}
              options={leaders.map(l => ({ value: l.id, label: l.name || l.email }))}
              placeholder="— Chọn Leader —"
              searchPlaceholder="Tìm Leader..."
            />
            <p className="mt-1 text-[10px] text-on-surface-variant">Chọn Leader trước để tự sinh tên Team + gợi ý mã.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Tên Team</label>
              <input
                type="text"
                value={form.name || ''}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Team Nguyễn Minh Anh"
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Mã Team</label>
              <input
                type="text"
                value={form.code || ''}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Trạng thái</label>
              <select
                value={form.status || 'active'}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as CrmTeam['status'] }))}
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              >
                <option value="active">Hoạt động</option>
                <option value="inactive">Ngừng hoạt động</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Phân khúc khách hàng</label>
              <select
                value={form.segment || ''}
                onChange={e => setForm(f => ({ ...f, segment: (e.target.value || null) as CrmTeam['segment'] }))}
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              >
                <option value="">— Chưa rõ —</option>
                {CRM_TEAM_SEGMENT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Khối / chuyên môn</label>
              <select
                value={form.function_area || ''}
                onChange={e => setForm(f => ({ ...f, function_area: (e.target.value || null) as CrmTeam['function_area'] }))}
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              >
                <option value="">— Chưa rõ —</option>
                {CRM_TEAM_FUNCTION_AREA_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Ngành phụ trách</label>
              <input
                type="text"
                value={form.industry || ''}
                onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                placeholder="VD: Năng lượng, Bank, FSI..."
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Khu vực / thị trường</label>
              <input
                type="text"
                value={form.region || ''}
                onChange={e => setForm(f => ({ ...f, region: e.target.value }))}
                placeholder="VD: Miền Nam, Toàn quốc..."
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Mô tả thêm</label>
              <textarea
                rows={2}
                value={form.description || ''}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-outline-variant p-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold border border-outline-variant hover:bg-surface-container-low transition">
            Hủy
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-on-primary-fixed-variant transition disabled:opacity-60"
          >
            {saving ? 'Đang lưu...' : 'Lưu Team CRM'}
          </button>
        </div>
      </div>
    </div>
  );
}
