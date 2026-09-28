"use client";

/** Modal "Chỉnh quyền CRM" cho 1 tài khoản - GOM CHUNG toàn bộ quyền của 1
 * user vào đúng 1 nút Lưu (Role hệ thống, Nhóm quyền, Trạng thái CRM, Phạm
 * vi dữ liệu, Workspace, Vai trò nghiệp vụ báo giá, Override quyền riêng) -
 * theo ĐÚNG cấu trúc drawer "Chỉnh sửa quyền người dùng CRM" của prototype
 * markee_crm_account_permission_prototype_v4_full_flow.html (5 mục: Thông
 * tin tài khoản / Nhóm quyền & quyền hệ thống / Vai trò nghiệp vụ báo giá /
 * Override quyền riêng / Ghi chú thay đổi). Trước đây role/vai trò báo
 * giá/workspace nằm rời rạc ở select inline trong bảng — gộp hết vào đây để
 * đúng 1 luồng "Chỉnh quyền" duy nhất, khớp yêu cầu bám sát HTML gốc. Team
 * CRM KHÔNG có trong drawer này (v4 gốc không có) - gán thành viên vào Team
 * CRM làm ở trang riêng `/all-platform/crm/sale-teams`.
 *
 * Module này (clone) CÓ endpoint /auth/workspaces (khác app gốc Main không
 * có), giống WorkspaceSwitcherShadcn.tsx - danh sách workspace load ĐỘNG qua
 * authService.listWorkspaces(), KHÔNG hardcode tĩnh như bản Main. */

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import {
  usersService,
  authService,
  crmPermissionGroupsService,
  type AppUserProfile,
  type CrmDataScope,
  type CrmModuleKey,
  type CrmPermissionGroup,
} from "@/services/all-platform.service";
import { CRM_MODULE_DEFS, CRM_SCOPE_LABELS } from "@/modules/crm/constants/crmPermissionLabels";
import type { MemberProfile } from "@/types/unified.types";

const SCOPE_OPTIONS: { value: CrmDataScope; label: string }[] = (
  Object.entries(CRM_SCOPE_LABELS) as [CrmDataScope, string][]
).map(([value, label]) => ({ value, label }));

const STATUS_OPTIONS: { value: "active" | "pending_review" | "locked"; label: string }[] = [
  { value: "active", label: "Đang hoạt động" },
  { value: "pending_review", label: "Chờ rà soát" },
  { value: "locked", label: "Tạm khóa" },
];

// Cung nhan biet nhu WorkspaceSwitcherShadcn.tsx - danh sach that lay tu
// /auth/workspaces (authService.listWorkspaces), day chi la nhan hien thi.
const WORKSPACE_LABELS: Record<string, string> = {
  markee: "Markee",
  cloudgate: "CloudGate",
  SECURITYZONE: "SecurityZone",
};

function workspaceLabel(instance: string): string {
  return WORKSPACE_LABELS[instance] || instance;
}

export function CrmPermissionModal({
  account,
  linkedMember,
  onClose,
  onSaved,
}: {
  account: AppUserProfile;
  linkedMember?: MemberProfile | null;
  onClose: () => void;
  onSaved: (updated: AppUserProfile) => void;
}) {
  const [groups, setGroups] = useState<CrmPermissionGroup[]>([]);
  const [workspaceOptions, setWorkspaceOptions] = useState<{ instance: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groupId, setGroupId] = useState(account.permission_group_id || "");
  const [scope, setScope] = useState<CrmDataScope | "">(account.data_scope || "");
  const [systemRole, setSystemRole] = useState(account.role || "member");
  const [status, setStatus] = useState<"active" | "pending_review" | "locked">(account.crm_status || "active");
  const [workspaces, setWorkspaces] = useState<string[]>(account.allowed_instances || []);
  const [quoteBusinessRole, setQuoteBusinessRole] = useState(account.quote_business_role || "");
  const [canApproveQuotes, setCanApproveQuotes] = useState(Boolean(account.can_approve_quotes));
  const [override, setOverride] = useState(Boolean(account.permission_override));
  const [overrideModules, setOverrideModules] = useState<CrmModuleKey[]>(
    (account.permission_overrides as CrmModuleKey[] | undefined) || []
  );
  const [note, setNote] = useState(account.crm_note || "");

  useEffect(() => {
    let alive = true;
    Promise.all([crmPermissionGroupsService.list(), authService.listWorkspaces()])
      .then(([groupsRes, workspacesRes]) => {
        if (!alive) return;
        if (groupsRes.success) setGroups(groupsRes.data || []);
        setWorkspaceOptions(workspacesRes.data?.items || []);
      })
      .catch(() => {
        if (alive) setError("Không tải được danh sách Nhóm quyền.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [account.id]);

  const selectedGroup = groups.find(g => g.id === groupId) || null;
  const effectiveModules = override ? overrideModules : selectedGroup?.modules || [];

  function toggleOverrideModule(key: CrmModuleKey, checked: boolean) {
    setOverrideModules(current => (checked ? [...current, key] : current.filter(m => m !== key)));
  }

  function toggleWorkspace(instance: string, checked: boolean) {
    setWorkspaces(current => (checked ? [...current, instance] : current.filter(w => w !== instance)));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.all([
        usersService.updateRole(account.email, systemRole),
        usersService.updateAllowedInstances(account.email, workspaces),
        usersService.updateQuoteApprover(account.email, canApproveQuotes),
        usersService.updateQuoteBusinessRole(
          account.email,
          (quoteBusinessRole || null) as "presale" | "sale" | "both" | null
        ),
        usersService.updateCrmPermission(account.email, {
          permission_group_id: groupId || null,
          data_scope: scope || null,
          permission_override: override,
          permission_overrides: override ? overrideModules : [],
          crm_status: status,
          crm_note: note,
        }),
      ]);
      const failed = results.find(r => !r.success);
      if (failed) {
        setError(failed.message || "Lưu thất bại.");
        return;
      }
      const last = results[results.length - 1];
      onSaved(last.data as AppUserProfile);
      onClose();
    } catch {
      setError("Có lỗi xảy ra, thử lại sau.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-surface shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant p-5">
          <div>
            <div className="text-body-lg font-bold text-on-background">Chỉnh sửa quyền người dùng CRM</div>
            <div className="text-body-sm text-on-surface-variant">
              {account.name || account.email} · {account.email}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-surface-container-low rounded-lg transition">
            <MaterialIcon name="close" className="text-base" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-body-sm text-on-surface-variant">Đang tải...</div>
        ) : (
          <div className="p-5 space-y-5">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
            )}

            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1.5 mb-2">
                1. Thông tin tài khoản
              </h4>
              <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                <span className="text-on-surface-variant">Họ tên</span>
                <span className="font-bold text-on-background text-right">{account.name || "—"}</span>
                <span className="text-on-surface-variant">Team</span>
                <span className="font-bold text-on-background text-right">{linkedMember?.team || "—"}</span>
                <span className="text-on-surface-variant">Level CV</span>
                <span className="font-bold text-on-background text-right">{linkedMember?.level || "—"}</span>
                <span className="text-on-surface-variant">Leader</span>
                <span className="font-bold text-on-background text-right">{linkedMember?.leader_name || "—"}</span>
              </div>
            </section>

            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1.5 mb-2">
                2. Nhóm quyền &amp; quyền hệ thống
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Nhóm quyền</label>
                  <select
                    value={groupId}
                    onChange={e => setGroupId(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                  >
                    <option value="">— Chưa gán —</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-on-surface-variant">Chọn template nhóm quyền có sẵn.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Role hệ thống</label>
                  <select
                    value={systemRole}
                    onChange={e => setSystemRole(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                  >
                    <option value="member">Member</option>
                    <option value="leader">Leader</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Trạng thái CRM</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as typeof status)}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {status === "locked" && (
                    <p className="mt-1 text-[10px] text-red-600">Tạm khóa sẽ khóa đăng nhập ngay lập tức.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Phạm vi dữ liệu</label>
                  <select
                    value={scope}
                    onChange={e => setScope(e.target.value as CrmDataScope)}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                  >
                    <option value="">
                      — Theo Nhóm quyền ({selectedGroup ? CRM_SCOPE_LABELS[selectedGroup.default_scope] : "chưa gán"}) —
                    </option>
                    {SCOPE_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Workspace</label>
                {systemRole === "admin" ? (
                  <p className="text-[10px] italic text-on-surface-variant">Admin luôn vào được mọi workspace.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {workspaceOptions.map(w => (
                      <label key={w.instance} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={workspaces.includes(w.instance)}
                          onChange={e => toggleWorkspace(w.instance, e.target.checked)}
                        />
                        {workspaceLabel(w.instance)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1.5 mb-2">
                3. Vai trò nghiệp vụ báo giá
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Vai trò báo giá</label>
                  <select
                    value={quoteBusinessRole}
                    onChange={e => setQuoteBusinessRole(e.target.value as typeof quoteBusinessRole)}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                  >
                    <option value="">Chưa gán</option>
                    <option value="presale">Presale</option>
                    <option value="sale">Sale</option>
                    <option value="both">Presale &amp; Sale</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Được duyệt báo giá</label>
                  <select
                    value={canApproveQuotes ? "yes" : "no"}
                    onChange={e => setCanApproveQuotes(e.target.value === "yes")}
                    disabled={systemRole === "admin"}
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs disabled:opacity-60"
                  >
                    <option value="no">Không</option>
                    <option value="yes">Có</option>
                  </select>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-on-surface-variant">
                Role nghiệp vụ báo giá tách biệt Role hệ thống. Quyền chỉ áp dụng khi user được phân công đúng báo giá.
              </p>
            </section>

            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1.5 mb-2">
                4. Override quyền riêng cho user
              </h4>
              <p className="text-[10px] text-on-surface-variant mb-2">
                Mặc định user kế thừa permission từ nhóm quyền. Bật &quot;Override&quot; khi cần quyền khác nhóm.
              </p>
              <label className="flex items-center gap-2 text-xs font-bold text-on-surface-variant mb-2">
                <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
                Cho phép override quyền riêng
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CRM_MODULE_DEFS.map(m => (
                  <label
                    key={m.key}
                    className={`flex items-center gap-1.5 rounded-lg border border-outline-variant px-2.5 py-1.5 text-[11px] ${
                      override ? "bg-surface" : "bg-surface-container-low text-on-surface-variant"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!override}
                      checked={effectiveModules.includes(m.key)}
                      onChange={e => toggleOverrideModule(m.key, e.target.checked)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1.5 mb-2">
                5. Ghi chú thay đổi
              </h4>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Lý do chỉnh quyền..."
                className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
              />
            </section>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-outline-variant p-4">
          <span className="text-[10px] text-on-surface-variant">Mọi thay đổi sẽ được ghi log phân quyền.</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold border border-outline-variant hover:bg-surface-container-low transition"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-on-primary-fixed-variant transition disabled:opacity-60"
            >
              {saving ? "Đang lưu..." : "Lưu quyền user"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
