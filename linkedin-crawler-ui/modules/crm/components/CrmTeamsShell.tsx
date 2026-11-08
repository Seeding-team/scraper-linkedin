'use client';

/** Tab "Leader / Team Sale" (trong "Tài khoản & Thành viên CRM",
 * `/all-platform/admin/quan-ly-thanh-vien`) - KHÁC HẲN bảng `teams`/
 * `team_type` KPI/seeding nội bộ (xem `AdminTeamsManagementShell.tsx`). Team
 * CRM đặt tên theo Leader, có thuộc tính mô tả (Phân khúc/Khối chuyên môn/
 * Ngành/Khu vực) - migration 155_crm_permission_groups_and_teams.sql.
 *
 * Redesign 2026-09-29 (feedback: đưa vào 1 tab riêng thay vì trang đứng
 * riêng, bám UI ảnh mẫu, bỏ hẳn cột/thẻ KPI vì chưa có nguồn dữ liệu KPI
 * thật gắn với Team CRM): thêm 4 thẻ thống kê + banner "tài khoản CRM chưa
 * thuộc Leader" (tính từ `member_ids` mọi team trả về, đối chiếu với toàn bộ
 * user - KHÔNG cần thêm API riêng); cột "Cơ hội đang xử lý" dùng
 * `active_deal_count` THẬT (BE đếm từ `customer_leads`, xem
 * crm_team_service._active_deal_counts_by_owner) - không phải số giả; panel
 * chi tiết đổi từ modal giữa màn hình sang drawer trượt từ phải (giữ list
 * bên trái vẫn nhìn thấy), bỏ hẳn UI KPI (thẻ + progress bar) vì lý do trên,
 * "Vai trò CRM" của member hiển thị tạm bằng `quote_business_role` (dữ liệu
 * thật duy nhất gần nghĩa "vai trò" hiện có, KHÔNG bịa field mới). */

import { useEffect, useMemo, useState } from 'react';
import { MaterialIcon } from '@/components/ui';
import { SearchableSelect } from './SearchableSelect';
import { CrmTeamFormModal, CRM_TEAM_SEGMENT_OPTIONS as SEGMENT_OPTIONS, CRM_TEAM_FUNCTION_AREA_OPTIONS as FUNCTION_AREA_OPTIONS } from './CrmTeamFormModal';
import {
  crmTeamsService,
  usersService,
  type AppUserProfile,
  type CrmTeam,
} from '@/services/all-platform.service';

function segmentLabel(value?: string | null): string {
  return SEGMENT_OPTIONS.find(o => o.value === value)?.label || '—';
}
function functionAreaLabel(value?: string | null): string {
  return FUNCTION_AREA_OPTIONS.find(o => o.value === value)?.label || '—';
}
function quoteRoleLabel(role?: string | null): string {
  if (role === 'sale') return 'Sale Executive';
  if (role === 'presale') return 'Presale';
  if (role === 'both') return 'Presale & Sale';
  return 'Chưa gán';
}
function initials(name?: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
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
  // Snapshot cua Team dang sua - truyen xuong CrmTeamFormModal (da tach ra
  // file rieng) lam `initialTeam`; null luc tao moi.
  const [editingTeam, setEditingTeam] = useState<CrmTeam | null>(null);

  const [detailTeam, setDetailTeam] = useState<CrmTeam | null>(null);
  const [allUsers, setAllUsers] = useState<AppUserProfile[]>([]);
  const [memberToAdd, setMemberToAdd] = useState('');

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

  // 4 the thong ke + banner "chua thuoc Leader" - tinh tu du lieu da co san
  // (KHONG goi them API rieng): hop `member_ids` cua moi team (BE tra kem,
  // xem CrmTeam.member_ids) roi doi voi toan bo user + tap leader_user_id.
  const assignedMemberIds = useMemo(() => new Set(teams.flatMap(t => t.member_ids || [])), [teams]);
  const leaderIds = useMemo(() => new Set(teams.map(t => t.leader_user_id).filter(Boolean) as string[]), [teams]);
  const unassignedUsers = useMemo(
    () => allUsers.filter(u => !assignedMemberIds.has(u.id) && !leaderIds.has(u.id)),
    [allUsers, assignedMemberIds, leaderIds]
  );
  const totalMemberInTeams = useMemo(() => teams.reduce((sum, t) => sum + (t.member_count || 0), 0), [teams]);

  function openCreate() {
    setEditingId(null);
    setEditingTeam(null);
    setModalOpen(true);
  }

  function openEdit(team: CrmTeam) {
    setEditingId(team.id);
    setEditingTeam(team);
    setModalOpen(true);
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

  async function refreshDetail() {
    if (!detailTeam) return;
    const res = await crmTeamsService.get(detailTeam.id);
    if (res.success) setDetailTeam(res.data || null);
    loadTeams();
  }

  async function handleAddMember(userId: string) {
    if (!detailTeam || !userId) return;
    const res = await crmTeamsService.addMember(detailTeam.id, userId);
    setMemberToAdd('');
    if (!res.success) {
      alert(res.message || 'Không thêm được thành viên.');
      return;
    }
    await refreshDetail();
  }

  async function handleRemoveMember(userId: string) {
    if (!detailTeam) return;
    await crmTeamsService.removeMember(detailTeam.id, userId);
    await refreshDetail();
  }

  const detailMemberIds = new Set((detailTeam?.members || []).map(m => m.id));
  // Leader KHONG duoc tu chon lam member cua CHINH team minh (feedback
  // 2026-09-29: "leader thi co can gan vao team lam gi" - an luon khoi
  // dropdown, khong doi nguoi dung phai bam roi moi bi tu choi).
  const availableUsers = allUsers.filter(
    u => !detailMemberIds.has(u.id) && u.id !== detailTeam?.leader_user_id
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">1</span>
          <div className="text-xs">
            <div className="font-bold text-on-background">Leader / Team Sale</div>
            <div className="text-on-surface-variant">Mỗi dòng là một Leader và team chính đang phụ trách.</div>
          </div>
        </div>
        <MaterialIcon name="arrow_forward" className="text-on-surface-variant text-base hidden sm:block" />
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">2</span>
          <div className="text-xs">
            <div className="font-bold text-on-background">Click dòng Leader</div>
            <div className="text-on-surface-variant">Mở panel bên phải để xem toàn bộ member và cơ hội của team.</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-outline-variant bg-surface p-4">
          <div className="text-h2 font-bold text-on-background">{teams.length}</div>
          <div className="text-[11px] text-on-surface-variant">Leader Sale · Đang quản lý team</div>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface p-4">
          <div className="text-h2 font-bold text-on-background">{totalMemberInTeams}</div>
          <div className="text-[11px] text-on-surface-variant">Member trong Team · Không tính Leader</div>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface p-4">
          <div className="text-h2 font-bold text-green-600">{allUsers.length - unassignedUsers.length}</div>
          <div className="text-[11px] text-on-surface-variant">Đã có Leader · Tài khoản đã được gán</div>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface p-4">
          <div className="text-h2 font-bold text-orange-600">{unassignedUsers.length}</div>
          <div className="text-[11px] text-on-surface-variant">Chưa có Leader · Cần phân team</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Tìm Leader / Team / phân khúc..."
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
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm"
        >
          <MaterialIcon name="add" className="text-base" /> Tạo Team CRM
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface shadow-sm">
        <table className="w-full min-w-[900px] border-collapse text-left text-xs">
          <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
            <tr>
              <th className="py-3 px-4">Leader / Team</th>
              <th className="py-3 px-4">Phân khúc</th>
              <th className="py-3 px-4">Khu vực</th>
              <th className="py-3 px-4">Member CRM</th>
              <th className="py-3 px-4">Cơ hội đang xử lý</th>
              <th className="py-3 px-4">Trạng thái</th>
              <th className="py-3 px-4 text-center">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant text-on-surface-variant">
            {loading ? (
              <tr><td colSpan={7} className="py-12 text-center italic">Đang tải...</td></tr>
            ) : teams.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center italic">Chưa có Team CRM nào.</td></tr>
            ) : (
              teams.map(team => (
                <tr key={team.id} className="hover:bg-surface-container-low transition">
                  <td className="py-3 px-4">
                    <button type="button" onClick={() => void openDetail(team)} className="flex items-center gap-2 text-left">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-bold">
                        {initials(team.leader_name)}
                      </span>
                      <span>
                        <div className="font-semibold text-on-background hover:underline">{team.leader_name || team.name}</div>
                        <div className="text-[10px] text-on-surface-variant">{team.name}</div>
                      </span>
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-blue-100 text-blue-700">{segmentLabel(team.segment)}</span>
                  </td>
                  <td className="py-3 px-4">{team.region || '—'}</td>
                  <td className="py-3 px-4">
                    <button type="button" onClick={() => void openDetail(team)} className="font-bold text-primary hover:underline">
                      {team.member_count ?? 0} member →
                    </button>
                  </td>
                  <td className="py-3 px-4 font-semibold text-on-background">{team.active_deal_count ?? 0}</td>
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
                      <button
                        type="button"
                        onClick={() => void openDetail(team)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-outline-variant hover:bg-surface-container-low transition"
                        title="Xem chi tiết / Thêm thành viên"
                      >
                        <MaterialIcon name="person_add" className="text-sm" /> Thêm member
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {unassignedUsers.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-800">
          <span>
            <MaterialIcon name="warning" className="text-base align-middle mr-1.5" />
            <strong>{unassignedUsers.length} tài khoản CRM chưa thuộc Leader:</strong>{' '}
            {unassignedUsers.slice(0, 3).map(u => u.name || u.email).join(', ')}
            {unassignedUsers.length > 3 ? ` +${unassignedUsers.length - 3} người khác` : ''}. Nên phân vào team để cơ hội và báo cáo Sale được tổng hợp đúng.
          </span>
          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-orange-300 hover:bg-orange-100 transition"
          >
            Phân Leader
          </button>
        </div>
      )}

      <CrmTeamFormModal
        open={modalOpen}
        editingId={editingId}
        initialTeam={editingTeam}
        leaders={leaders}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          loadTeams();
        }}
      />

      {detailTeam && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDetailTeam(null)}>
          <div className="w-full max-w-2xl h-full overflow-y-auto bg-surface shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                  {initials(detailTeam.leader_name)}
                </span>
                <div>
                  <div className="text-body-lg font-bold text-on-background">{detailTeam.name}</div>
                  <div className="text-[11px] text-on-surface-variant">
                    Leader: {detailTeam.leader_name || '—'} · {segmentLabel(detailTeam.segment)} · {detailTeam.region || '—'}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setDetailTeam(null)} className="p-1.5 hover:bg-surface-container-low rounded-lg transition">
                <MaterialIcon name="close" className="text-base" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-h3 font-bold text-on-background">{detailTeam.member_count ?? 0}</div>
                  <div className="text-[10px] text-on-surface-variant">Member CRM</div>
                </div>
                <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-h3 font-bold text-on-background">
                    {(detailTeam.members || []).filter(m => m.is_active !== false).length}
                  </div>
                  <div className="text-[10px] text-on-surface-variant">Đang hoạt động</div>
                </div>
                <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <div className="text-h3 font-bold text-on-background">{detailTeam.active_deal_count ?? 0}</div>
                  <div className="text-[10px] text-on-surface-variant">Cơ hội đang xử lý</div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-bold text-on-surface-variant">Thông tin Leader</div>
                  <button
                    type="button"
                    onClick={() => openEdit(detailTeam)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-outline-variant hover:bg-surface-container-low transition"
                  >
                    <MaterialIcon name="edit" className="text-sm" /> Chỉnh sửa
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 rounded-xl border border-outline-variant p-3 text-xs">
                  <div>
                    <div className="text-on-surface-variant text-[10px]">Leader</div>
                    <div className="font-bold text-on-background">{detailTeam.leader_name || '—'}</div>
                  </div>
                  <div>
                    <div className="text-on-surface-variant text-[10px]">Phân khúc</div>
                    <div className="font-bold text-on-background">{segmentLabel(detailTeam.segment)}</div>
                  </div>
                  <div>
                    <div className="text-on-surface-variant text-[10px]">Khu vực</div>
                    <div className="font-bold text-on-background">{detailTeam.region || '—'}</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-bold text-on-surface-variant">Member thuộc Leader</div>
                </div>
                <SearchableSelect
                  value={memberToAdd}
                  onChange={value => {
                    setMemberToAdd(value);
                    void handleAddMember(value);
                  }}
                  options={availableUsers.map(u => ({ value: u.id, label: u.name || u.email }))}
                  placeholder="+ Thêm member"
                  searchPlaceholder="Tìm member..."
                />
                <div className="overflow-x-auto rounded-xl border border-outline-variant mt-3">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Thành viên</th>
                        <th className="py-2.5 px-3">Vai trò CRM</th>
                        <th className="py-2.5 px-3">Cơ hội</th>
                        <th className="py-2.5 px-3">Trạng thái</th>
                        <th className="py-2.5 px-3 text-center">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant text-on-surface-variant">
                      {!detailTeam.members?.length ? (
                        <tr><td colSpan={5} className="py-8 text-center italic">Chưa có thành viên.</td></tr>
                      ) : (
                        detailTeam.members.map(m => (
                          <tr key={m.id}>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-[10px] font-bold">
                                  {initials(m.name || m.email)}
                                </span>
                                <span>
                                  <div className="font-semibold text-on-background">{m.name || '—'}</div>
                                  <div className="text-[10px] text-on-surface-variant">{m.email}</div>
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3">{quoteRoleLabel(m.quote_business_role)}</td>
                            <td className="py-2.5 px-3 font-semibold text-on-background">{m.active_deal_count ?? 0}</td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {m.is_active !== false ? 'Hoạt động' : 'Đã khoá'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button type="button" onClick={() => void handleRemoveMember(m.id)} className="text-red-600 hover:underline text-[10px] font-bold">
                                Gỡ
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
