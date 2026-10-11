"use client";

/** Tab "Nhóm quyền" - template permission dùng lại cho nhiều user CRM
 * (migration 155). Theo prototype
 * markee_crm_account_permission_prototype_v4_full_flow.html (tab "Quyền báo
 * giá & Nhóm quyền" - card list + ma trận quyền + panel chi tiết + wizard 4
 * bước tạo/sửa). */

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import {
  crmPermissionGroupsService,
  type AppUserProfile,
  type CrmDataScope,
  type CrmModuleKey,
  type CrmPermissionGroup,
} from "@/services/all-platform.service";
import { CRM_MODULE_DEFS as MODULE_DEFS, CRM_SCOPE_LABELS as SCOPE_LABELS } from "@/modules/crm/constants/crmPermissionLabels";

const QUOTE_PERM_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Không" },
  { value: "read_only", label: "Read-only" },
  { value: "assigned", label: "Có trên báo giá được gán" },
  { value: "all", label: "Có trên mọi báo giá" },
];

const QUOTE_RELEASE_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Không" },
  { value: "assigned", label: "Có trên báo giá được gán" },
  { value: "all", label: "Có trên mọi báo giá" },
];

function emptyGroupForm(): Partial<CrmPermissionGroup> {
  return {
    name: "",
    status: "active",
    default_system_role: "member",
    default_scope: "personal",
    description: "",
    default_quote_business_role: null,
    default_can_approve_quotes: false,
    quote_cost_permission: "none",
    quote_sell_permission: "none",
    quote_release_permission: "none",
    modules: [],
  };
}

export function CrmPermissionGroupsTab() {
  const [groups, setGroups] = useState<CrmPermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [usersOfGroup, setUsersOfGroup] = useState<AppUserProfile[] | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CrmPermissionGroup>>(emptyGroupForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadGroups() {
    setLoading(true);
    crmPermissionGroupsService
      .list()
      .then(res => {
        if (res.success) {
          setGroups(res.data || []);
          setSelectedId(prev => prev || res.data?.[0]?.id || null);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadGroups();
  }, []);

  const filtered = groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
  const selected = groups.find(g => g.id === selectedId) || null;

  function openCreateWizard() {
    setEditingId(null);
    setForm(emptyGroupForm());
    setWizardStep(1);
    setError(null);
    setWizardOpen(true);
  }

  function openEditWizard(group: CrmPermissionGroup) {
    setEditingId(group.id);
    setForm({ ...group });
    setWizardStep(1);
    setError(null);
    setWizardOpen(true);
  }

  async function handleClone(group: CrmPermissionGroup) {
    const res = await crmPermissionGroupsService.clone(group.id);
    if (res.success) {
      loadGroups();
      setSelectedId(res.data?.id || null);
    }
  }

  async function handleShowUsers(group: CrmPermissionGroup) {
    setSelectedId(group.id);
    const res = await crmPermissionGroupsService.listUsers(group.id);
    setUsersOfGroup(res.success ? res.data || [] : []);
  }

  function toggleModule(key: CrmModuleKey, checked: boolean) {
    setForm(f => {
      const current = f.modules || [];
      return { ...f, modules: checked ? [...current, key] : current.filter(m => m !== key) };
    });
  }

  function nextStep() {
    if (wizardStep === 1 && !form.name?.trim()) {
      setError("Vui lòng nhập tên nhóm quyền");
      return;
    }
    setError(null);
    setWizardStep(s => Math.min(4, s + 1));
  }

  async function handleSaveGroup() {
    setSaving(true);
    setError(null);
    try {
      const res = editingId
        ? await crmPermissionGroupsService.update(editingId, form)
        : await crmPermissionGroupsService.create(form);
      if (!res.success) {
        setError(res.message || "Lưu thất bại.");
        return;
      }
      setWizardOpen(false);
      loadGroups();
      setSelectedId(res.data?.id || null);
    } catch {
      setError("Có lỗi xảy ra, thử lại sau.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(group: CrmPermissionGroup) {
    if (!confirm(`Xoá nhóm quyền "${group.name}"? User đang gán nhóm này sẽ về trạng thái "chưa gán".`)) return;
    const res = await crmPermissionGroupsService.delete(group.id);
    if (res.success) {
      loadGroups();
      if (selectedId === group.id) setSelectedId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-outline-variant">
          <div>
            <div className="text-body-md font-bold text-on-background">Danh sách nhóm quyền</div>
            <div className="text-body-sm text-on-surface-variant">Template permission dùng lại cho nhiều user.</div>
          </div>
          <button
            type="button"
            onClick={openCreateWizard}
            className="flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm"
          >
            <MaterialIcon name="add" className="text-base" /> Tạo nhóm quyền
          </button>
        </div>

        <div className="p-5 border-b border-outline-variant">
          <input
            type="text"
            placeholder="Tìm nhóm quyền..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-xs px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
          />
        </div>

        {loading ? (
          <div className="p-8 text-center text-body-sm text-on-surface-variant">Đang tải...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-5">
              {filtered.map(g => (
                <div
                  key={g.id}
                  onClick={() => setSelectedId(g.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition ${
                    selectedId === g.id ? "border-primary shadow-sm" : "border-outline-variant hover:shadow-sm"
                  }`}
                >
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${
                      g.status === "active" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                    }`}
                  >
                    {g.status === "active" ? "Đang dùng" : "Nháp"}
                  </span>
                  <div className="mt-2 font-bold text-on-background">{g.name}</div>
                  <p className="mt-1 text-[11px] text-on-surface-variant line-clamp-2">{g.description || "—"}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-lg text-[10px] bg-surface-container-low border border-outline-variant">
                      {g.default_system_role}
                    </span>
                    <button type="button" onClick={e => { e.stopPropagation(); openEditWizard(g); }} className="p-1 hover:bg-surface-container-low rounded">
                      <MaterialIcon name="edit" className="text-sm" />
                    </button>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full py-8 text-center text-body-sm italic text-on-surface-variant">
                  Chưa có nhóm quyền nào.
                </div>
              )}
            </div>

            <div className="overflow-x-auto p-5 pt-0">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-outline-variant text-left text-[10px] uppercase text-on-surface-variant">
                    <th className="py-2 pr-3">Nhóm quyền</th>
                    {MODULE_DEFS.map(m => (
                      <th key={m.key} className="py-2 px-2 text-center">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(g => (
                    <tr key={g.id} className="border-b border-outline-variant/60">
                      <td className="py-2 pr-3 font-semibold text-on-background">{g.name}</td>
                      {MODULE_DEFS.map(m => (
                        <td key={m.key} className="py-2 px-2 text-center">
                          {g.modules.includes(m.key) ? (
                            <span className="text-green-600 font-bold">✓</span>
                          ) : (
                            <span className="text-on-surface-variant">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <aside className="rounded-xl border border-outline-variant bg-surface p-5 shadow-sm h-max">
        <h3 className="font-bold text-on-background mb-3">Nhóm đang chọn</h3>
        {!selected ? (
          <div className="text-body-sm text-on-surface-variant">Chưa chọn nhóm</div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="flex justify-between border-b border-dashed border-outline-variant pb-2">
              <span className="text-on-surface-variant">Tên nhóm</span>
              <span className="font-bold text-on-background">{selected.name}</span>
            </div>
            <div className="flex justify-between border-b border-dashed border-outline-variant pb-2">
              <span className="text-on-surface-variant">Phạm vi mặc định</span>
              <span className="font-bold text-on-background">{SCOPE_LABELS[selected.default_scope]}</span>
            </div>
            <div className="flex justify-between border-b border-dashed border-outline-variant pb-2">
              <span className="text-on-surface-variant">Vai trò báo giá</span>
              <span className="font-bold text-on-background">{selected.default_quote_business_role || "Chưa gán"}</span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-on-surface-variant">Duyệt báo giá</span>
              <span className="font-bold text-on-background">{selected.default_can_approve_quotes ? "Có" : "Không"}</span>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {selected.modules.map(m => (
                <span key={m} className="px-2 py-0.5 rounded-lg bg-surface-container-low text-[10px]">
                  {m}
                </span>
              ))}
            </div>

            <div className="grid gap-2 pt-3">
              <button type="button" onClick={() => openEditWizard(selected)} className="px-3 py-2 rounded-xl text-xs font-bold border border-outline-variant hover:bg-surface-container-low transition">
                ✎ Chỉnh sửa nhóm quyền
              </button>
              <button type="button" onClick={() => void handleClone(selected)} className="px-3 py-2 rounded-xl text-xs font-bold border border-outline-variant hover:bg-surface-container-low transition">
                ⧉ Clone nhóm quyền
              </button>
              <button type="button" onClick={() => void handleShowUsers(selected)} className="px-3 py-2 rounded-xl text-xs font-bold border border-outline-variant hover:bg-surface-container-low transition">
                👥 Xem user đang áp dụng
              </button>
              <button type="button" onClick={() => void handleDelete(selected)} className="px-3 py-2 rounded-xl text-xs font-bold border border-red-200 text-red-600 hover:bg-red-50 transition">
                Xoá nhóm quyền
              </button>
            </div>

            {usersOfGroup && (
              <div className="pt-3 border-t border-outline-variant mt-3">
                <div className="font-bold text-on-background mb-1.5">User đang áp dụng ({usersOfGroup.length})</div>
                {usersOfGroup.length === 0 ? (
                  <div className="italic text-on-surface-variant">Chưa có user nào.</div>
                ) : (
                  <ul className="space-y-1">
                    {usersOfGroup.map(u => (
                      <li key={u.id} className="text-on-surface-variant">
                        {u.name || u.email}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </aside>

      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setWizardOpen(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-surface shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-outline-variant p-5">
              <div>
                <div className="text-body-lg font-bold text-on-background">
                  {editingId ? "Chỉnh sửa nhóm quyền" : "Tạo nhóm quyền"}
                </div>
                <div className="text-body-sm text-on-surface-variant">Thiết lập permission theo nhóm</div>
              </div>
              <button type="button" onClick={() => setWizardOpen(false)} className="p-1.5 hover:bg-surface-container-low rounded-lg transition">
                <MaterialIcon name="close" className="text-base" />
              </button>
            </div>

            <div className="flex gap-2 p-5 pb-0">
              {["1. Thông tin", "2. Quyền CRM", "3. Quyền báo giá", "4. Xác nhận"].map((label, idx) => (
                <div
                  key={label}
                  className={`flex-1 rounded-lg px-2 py-2 text-center text-[10px] font-bold ${
                    wizardStep === idx + 1
                      ? "bg-sky-50 text-sky-700"
                      : wizardStep > idx + 1
                        ? "bg-green-50 text-green-700"
                        : "bg-surface-container-low text-on-surface-variant"
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="p-5 space-y-4">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}

              {wizardStep === 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Tên nhóm quyền</label>
                    <input
                      type="text"
                      value={form.name || ""}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="VD: Sales Executive"
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Trạng thái</label>
                    <select
                      value={form.status || "active"}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value as CrmPermissionGroup["status"] }))}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    >
                      <option value="active">Đang dùng</option>
                      <option value="draft">Nháp</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Role hệ thống mặc định</label>
                    <select
                      value={form.default_system_role || "member"}
                      onChange={e => setForm(f => ({ ...f, default_system_role: e.target.value as CrmPermissionGroup["default_system_role"] }))}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    >
                      <option value="member">Member</option>
                      <option value="leader">Leader</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Phạm vi dữ liệu mặc định</label>
                    <select
                      value={form.default_scope || "personal"}
                      onChange={e => setForm(f => ({ ...f, default_scope: e.target.value as CrmDataScope }))}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    >
                      {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Mô tả</label>
                    <textarea
                      rows={3}
                      value={form.description || ""}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Nhóm quyền này dùng cho ai, mục đích gì..."
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    />
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div>
                  <div className="mb-2 text-xs font-bold text-on-surface-variant">Quyền chức năng CRM</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {MODULE_DEFS.map(m => (
                      <label key={m.key} className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-2.5 py-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={(form.modules || []).includes(m.key)}
                          onChange={e => toggleModule(m.key, e.target.checked)}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Vai trò báo giá mặc định</label>
                    <select
                      value={form.default_quote_business_role || ""}
                      onChange={e => setForm(f => ({ ...f, default_quote_business_role: (e.target.value || null) as CrmPermissionGroup["default_quote_business_role"] }))}
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
                      value={form.default_can_approve_quotes ? "yes" : "no"}
                      onChange={e => setForm(f => ({ ...f, default_can_approve_quotes: e.target.value === "yes" }))}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    >
                      <option value="no">Không</option>
                      <option value="yes">Có</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Nhập giá vốn</label>
                    <select
                      value={form.quote_cost_permission || "none"}
                      onChange={e => setForm(f => ({ ...f, quote_cost_permission: e.target.value as CrmPermissionGroup["quote_cost_permission"] }))}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    >
                      {QUOTE_PERM_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Nhập giá bán</label>
                    <select
                      value={form.quote_sell_permission || "none"}
                      onChange={e => setForm(f => ({ ...f, quote_sell_permission: e.target.value as CrmPermissionGroup["quote_sell_permission"] }))}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    >
                      {QUOTE_PERM_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-on-surface-variant mb-1.5">Phát hành / gửi khách</label>
                    <select
                      value={form.quote_release_permission || "none"}
                      onChange={e => setForm(f => ({ ...f, quote_release_permission: e.target.value as CrmPermissionGroup["quote_release_permission"] }))}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg text-xs"
                    >
                      {QUOTE_RELEASE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {wizardStep === 4 && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">
                    Kiểm tra trước khi lưu: nhóm quyền sau khi tạo sẽ xuất hiện trong tab &quot;Tài khoản CRM&quot; để admin gán cho
                    user.
                  </div>
                  <div className="text-xs space-y-1.5">
                    <div className="flex justify-between border-b border-dashed border-outline-variant pb-1.5">
                      <span className="text-on-surface-variant">Tên nhóm</span>
                      <span className="font-bold text-on-background">{form.name}</span>
                    </div>
                    <div className="flex justify-between border-b border-dashed border-outline-variant pb-1.5">
                      <span className="text-on-surface-variant">Role hệ thống</span>
                      <span className="font-bold text-on-background">{form.default_system_role}</span>
                    </div>
                    <div className="flex justify-between border-b border-dashed border-outline-variant pb-1.5">
                      <span className="text-on-surface-variant">Phạm vi</span>
                      <span className="font-bold text-on-background">{SCOPE_LABELS[(form.default_scope || "personal") as CrmDataScope]}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {(form.modules || []).map(m => (
                        <span key={m} className="px-2 py-0.5 rounded-lg bg-surface-container-low text-[10px]">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-outline-variant p-4">
              {wizardStep > 1 ? (
                <button type="button" onClick={() => setWizardStep(s => Math.max(1, s - 1))} className="px-4 py-2 rounded-xl text-xs font-bold border border-outline-variant hover:bg-surface-container-low transition">
                  ← Quay lại
                </button>
              ) : (
                <span />
              )}
              {wizardStep < 4 ? (
                <button type="button" onClick={nextStep} className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:bg-on-primary-fixed-variant transition">
                  Tiếp tục →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSaveGroup()}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-60"
                >
                  {saving ? "Đang lưu..." : "Lưu nhóm quyền"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
