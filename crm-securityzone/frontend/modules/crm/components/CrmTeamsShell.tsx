'use client';

/** Trang "Team CRM" (`/all-platform/crm/sale-teams`) - KHÁC HẲN bảng
 * `teams`/`team_type` KPI/seeding nội bộ (xem
 * `AdminTeamsManagementShell.tsx`). Team CRM đặt tên theo Leader, có thuộc
 * tính mô tả (Phân khúc/Khối chuyên môn/Ngành/Khu vực) - migration
 * 155_crm_permission_groups_and_teams.sql, theo ghi chú thiết kế phiên bản
 * mới hơn prototype markee_crm_account_permission_prototype_v4_full_flow.html. */

import { useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui';
import { SearchableSelect } from './SearchableSelect';
import {
  crmTeamsService,
  usersService,
  type AppUserProfile,
  type CrmTeam,
} from '@/services/all-platform.service';

const SEGMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'smb', label: 'SMB' },
  { value: 'mid_market', label: 'Mid-Market' },
  { value: 'government', label: 'Government' },
  { value: 'mixed', label: 'Mixed' },
];

const FUNCTION_AREA_OPTIONS: { value: string; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'presale', label: 'Presale' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'software', label: 'Software' },
  { value: 'security', label: 'Security' },
  { value: 'finance', label: 'Finance' },
  { value: 'operations', label: 'Operations' },
];

function segmentLabel(value?: string | null): string {
  return SEGMENT_OPTIONS.find(o => o.value === value)?.label || '—';
}
function functionAreaLabel(value?: string | null): string {
  return FUNCTION_AREA_OPTIONS.find(o => o.value === value)?.label || '—';
}

function emptyForm(): Partial<CrmTeam> {
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

export function CrmTeamsShell() {
  const [teams, setTeams] = useState<CrmTeam[]>([]);
  const [leaders, setLeaders] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('');
  const [functionAreaFilter, setFunctionAreaFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CrmTeam>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailTeam, setDetailTeam] = useState<CrmTeam | null>(null);
  const [allUsers, setAllUsers] = useState<AppUserProfile[]>([]);

  function loadTeams() {
    setLoading(true);
    crmTeamsService
      .list({ segment: segmentFilter || undefined, function_area: functionAreaFilter || undefined, search: search || undefined })
      .then(res => {
        if (res.success) setTeams(res.data || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentFilter, functionAreaFilter]);

  useEffect(() => {
    const timer = setTimeout(loadTeams, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    usersService.getAllProfiles().then(res => {
      if (res.success) {
        setLeaders((res.data || []).filter(u => u.role === 'leader' || u.role === 'admin'));
        setAllUsers(res.data || []);
      }
    });
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  }

  function openEdit(team: CrmTeam) {
    setEditingId(team.id);
    setForm({ ...team });
    setError(null);
    setModalOpen(true);
  }

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
      if (!res.success) {
        setError(res.message || 'Lưu thất bại.');
        return;
      }
      setModalOpen(false);
      loadTeams();
    } catch {
      setError('Có lỗi xảy ra, thử lại sau.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(team: CrmTeam) {
    if (!confirm(`Xoá Team CRM "${team.name}"? Thành viên sẽ tự gỡ liên kết (không bị xoá tài khoản).`)) return;
    const res = await crmTeamsService.delete(team.id);
    if (res.success) loadTeams();
  }

  async function openDetail(team: CrmTeam) {
    const res = await crmTeamsService.get(team.id);
    setDetailTeam(res.success ? res.data || team : team);
    setMemberToAdd('');
  }

  const [memberToAdd, setMemberToAdd] = useState('');

  async function handleAddMember(userId: string) {
    if (!detailTeam || !userId) return;
    await crmTeamsService.addMember(detailTeam.id, userId);
    const res = await crmTeamsService.get(detailTeam.id);
    if (res.success) setDetailTeam(res.data || null);
    setMemberToAdd('');
    loadTeams();
  }

  async function handleRemoveMember(userId: string) {
    if (!detailTeam) return;
    await crmTeamsService.removeMember(detailTeam.id, userId);
    const res = await crmTeamsService.get(detailTeam.id);
    if (res.success) setDetailTeam(res.data || null);
    loadTeams();
  }

  const memberIds = new Set((detailTeam?.members || []).map(m => m.id));
  const availableUsers = allUsers.filter(u => !memberIds.has(u.id));

  return (
    <div style={{ padding: '1.25rem 1.5rem' }} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-body-lg font-bold text-on-background">Team CRM</h1>
          <p className="text-body-sm text-on-surface-variant">
            Team đặt tên theo Leader, mô tả bằng phân khúc/khối chuyên môn/ngành/khu vực — tách biệt Nhóm quyền.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm"
        >
          <MaterialIcon name="add" className="text-base" /> Tạo Team CRM
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Tìm Team / Leader / ngành..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="min-w-[220px] flex-1 px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs"
        />
        <select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} className="px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs">
          <option value="">Tất cả phân khúc</option>
          {SEGMENT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={functionAreaFilter} onChange={e => setFunctionAreaFilter(e.target.value)} className="px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs">
          <option value="">Tất cả khối chức năng</option>
          {FUNCTION_AREA_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface shadow-sm">
        <table className="w-full min-w-[900px] border-collapse text-left text-xs">
          <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
            <tr>
              <th className="py-3 px-4">Team</th>
              <th className="py-3 px-4">Leader</th>
              <th className="py-3 px-4">Phân khúc</th>
              <th className="py-3 px-4">Khối chuyên môn</th>
              <th className="py-3 px-4">Ngành / Khu vực</th>
              <th className="py-3 px-4">Thành viên</th>
              <th className="py-3 px-4">Trạng thái</th>
              <th className="py-3 px-4 text-center">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant text-on-surface-variant">
            {loading ? (
              <tr><td colSpan={8} className="py-12 text-center italic">Đang tải...</td></tr>
            ) : teams.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center italic">Chưa có Team CRM nào.</td></tr>
            ) : (
              teams.map(team => (
                <tr key={team.id} className="hover:bg-surface-container-low transition">
                  <td className="py-3 px-4">
                    <button type="button" onClick={() => void openDetail(team)} className="font-semibold text-on-background hover:underline">
                      {team.name}
                    </button>
                    {team.code && <div className="text-[10px] text-on-surface-variant">{team.code}</div>}
                  </td>
                  <td className="py-3 px-4">{team.leader_name || '—'}</td>
                  <td className="py-3 px-4">{segmentLabel(team.segment)}</td>
                  <td className="py-3 px-4">{functionAreaLabel(team.function_area)}</td>
                  <td className="py-3 px-4">{[team.industry, team.region].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="py-3 px-4">{team.member_count ?? 0}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${team.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {team.status === 'active' ? 'Hoạt động' : 'Ngừng hoạt động'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-2">
                      <button type="button" onClick={() => openEdit(team)} className="p-1.5 hover:bg-surface-container-low rounded-lg transition" title="Sửa">
                        <MaterialIcon name="edit" className="text-base" />
                      </button>
                      <button type="button" onClick={() => void handleDelete(team)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition" title="Xoá">
                        <MaterialIcon name="delete" className="text-base" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-surface shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant p-5">
              <div className="text-body-lg font-bold text-on-background">{editingId ? 'Sửa Team CRM' : 'Tạo Team CRM'}</div>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 hover:bg-surface-container-low rounded-lg transition">
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
                    {SEGMENT_OPTIONS.map(o => (
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
                    {FUNCTION_AREA_OPTIONS.map(o => (
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
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-xl text-xs font-bold border border-outline-variant hover:bg-surface-container-low transition">
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
      )}

      {detailTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailTeam(null)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-surface shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant p-5">
              <div className="text-body-lg font-bold text-on-background">{detailTeam.name}</div>
              <button type="button" onClick={() => setDetailTeam(null)} className="p-1.5 hover:bg-surface-container-low rounded-lg transition">
                <MaterialIcon name="close" className="text-base" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Thêm thành viên</label>
                <SearchableSelect
                  value={memberToAdd}
                  onChange={value => {
                    setMemberToAdd(value);
                    void handleAddMember(value);
                  }}
                  options={availableUsers.map(u => ({ value: u.id, label: u.name || u.email }))}
                  placeholder="— Chọn user —"
                  searchPlaceholder="Tìm user..."
                />
              </div>
              <div>
                <div className="text-xs font-bold text-on-surface-variant mb-1.5">
                  Thành viên ({detailTeam.members?.length || 0})
                </div>
                {!detailTeam.members?.length ? (
                  <div className="text-xs italic text-on-surface-variant">Chưa có thành viên.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {detailTeam.members.map(m => (
                      <li key={m.id} className="flex items-center justify-between rounded-lg border border-outline-variant px-3 py-1.5 text-xs">
                        <span>{m.name || m.email}</span>
                        <button type="button" onClick={() => void handleRemoveMember(m.id)} className="text-red-600 hover:underline text-[10px] font-bold">
                          Gỡ
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
