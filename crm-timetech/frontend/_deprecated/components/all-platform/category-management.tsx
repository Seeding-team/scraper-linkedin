"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  allPlatformCategoriesService,
  teamsService,
  usersService,
  type AppUserProfile,
  type TeamRow
} from "@/services/all-platform.service";
import type { Category, CategoryType } from "@/types/unified.types";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/ui";

const CATEGORY_TABS: { type: CategoryType; label: string; icon: string }[] = [
  { type: "intent", label: "Lĩnh vực", icon: "🏷️" },
  { type: "industry", label: "Ngành (Industry)", icon: "📂" },
  { type: "tier", label: "Tier", icon: "🔥" },
  { type: "team", label: "Team", icon: "👥" },
  { type: "icp", label: "ICP Target", icon: "🎯" },
  { type: "content_type", label: "Loại nội dung", icon: "📄" },
  { type: "product_seeding", label: "Sản phẩm Seeding", icon: "📦" },
];

const CATEGORY_TYPE_COLS: Record<CategoryType, string[]> = {
  intent: ["code", "name", "platform"],
  industry: ["code", "name", "description"],
  tier: ["code", "name", "description"],
  icp: ["code", "name", "platform"],
  team: ["name_team", "leader_email", "number_of_member"],
  content_type: ["code", "name", "description"],
  product_seeding: ["code", "name", "description"],
  crm_source: ["code", "name", "platform"],
  crm_service_package: ["code", "name", "platform"],
  crm_package: ["code", "name", "platform"],
  crm_industry: ["code", "name", "platform"],
  crm_position: ["code", "name", "platform"],
  crm_expected_timeline: ["code", "name", "platform"],
  crm_next_step: ["code", "name", "platform"],
  crm_nurture_reason: ["code", "name", "platform"],
  crm_follow_up_channel: ["code", "name", "platform"],
  crm_unqualified_reason: ["code", "name", "platform"],
  crm_quote_type: ["code", "name", "platform"],
  crm_city: ["code", "name", "platform"],
  crm_contract_status: ["code", "name", "platform"],
  crm_payment_status: ["code", "name", "platform"],
  crm_billing_type: ["code", "name", "platform"],
  crm_won_reason: ["code", "name", "platform"],
  crm_lost_reason: ["code", "name", "platform"],
  crm_outcome_confidence: ["code", "name", "platform"],
  crm_outcome_trigger: ["code", "name", "platform"],
  crm_outcome_objection: ["code", "name", "platform"],
  crm_kb_reuse_level: ["code", "name", "platform"],
  crm_kb_owner: ["code", "name", "platform"],
  crm_kb_status: ["code", "name", "platform"],
};

// ── CATEGORY MODAL (Intent, Industry, Tier, ICP) ─────────────────────────────
function CategoryModal({ isOpen, onClose, onSave, editing, categoryType }: any) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState("general");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editing) {
      setCode(editing.code || "");
      setName(editing.name || "");
      setDescription(editing.description || "");
      setPlatform(editing.platform || "general");
    } else {
      setCode("");
      setName("");
      setDescription("");
      setPlatform("general");
    }
  }, [editing, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!code.trim()) return;
    setIsSubmitting(true);
    try {
      await onSave({
        id: editing?.id,
        category_type: categoryType,
        code: code.trim(),
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        platform,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[448px] rounded-xl bg-surface p-6 shadow-xl border border-outline-variant max-h-[90vh] overflow-y-auto">
        <h2 className="mb-4 text-lg font-bold text-on-surface">
          {editing ? "Sửa" : "Thêm"} danh mục
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">
              Code {editing ? "(không đổi)" : "*"}
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!!editing}
              placeholder="Ví dụ: tech, finance..."
              className="w-full rounded-lg border border-[#333333] px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-surface-container-low"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Tên</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên hiển thị"
              className="w-full rounded-lg border border-[#333333] px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          {(categoryType === "industry" || categoryType === "tier") && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Mô tả</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-[#333333] px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-lg border border-[#333333] px-3 py-2 text-sm focus:border-primary focus:outline-none bg-surface"
            >
              <option value="general">Tổng hợp (General)</option>
              <option value="facebook">Facebook</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low cursor-pointer">
            Hủy
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting || !code.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-on-primary-fixed-variant cursor-pointer disabled:opacity-50">
            {isSubmitting ? "Đang lưu..." : editing ? "Cập nhật" : "Thêm mới"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TEAM MODAL (Multi-select members, Leader dropdown) ──────────────────────
function TeamModal({ isOpen, onClose, onSave, editing }: any) {
  const [nameTeam, setNameTeam] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const [leaders, setLeaders] = useState<AppUserProfile[]>([]);
  const [allUsers, setAllUsers] = useState<AppUserProfile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      usersService.getByRole("leader").then(r => r.success && setLeaders(r.data || []));
      usersService.getAllProfiles().then(r => r.success && setAllUsers(r.data || []));
    }
  }, [isOpen]);

  useEffect(() => {
    if (editing) {
      setNameTeam(editing.name_team || "");
      setLeaderId(String(editing.id_leader || ""));
      setMemberIds(editing.member_ids || []);
    } else {
      setNameTeam("");
      setLeaderId("");
      setMemberIds([]);
    }
  }, [editing, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!nameTeam.trim() || !leaderId) return;
    setIsSubmitting(true);
    try {
      await onSave({
        name_team: nameTeam.trim(),
        leader_id: leaderId,
        member_ids: memberIds,
        isEdit: !!editing
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMember = (id: string) => {
    setMemberIds(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[448px] rounded-xl bg-surface p-6 shadow-xl border border-outline-variant max-h-[90vh] flex flex-col">
        <h2 className="mb-4 text-lg font-bold text-on-surface shrink-0">
          {editing ? "Sửa" : "Thêm"} Team
        </h2>
        <div className="space-y-4 overflow-y-auto pr-2 flex-1">
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">
              Tên Team {editing ? "(không đổi)" : "*"}
            </label>
            <input
              type="text"
              value={nameTeam}
              onChange={(e) => setNameTeam(e.target.value)}
              disabled={!!editing}
              placeholder="Ví dụ: Team Alpha"
              className="w-full rounded-lg border border-[#333333] px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-surface-container-low"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">
              Leader {editing ? "(không đổi)" : "*"}
            </label>
            <select
              value={leaderId}
              onChange={(e) => setLeaderId(e.target.value)}
              disabled={!!editing}
              className="w-full rounded-lg border border-[#333333] px-3 py-2 text-sm focus:border-primary focus:outline-none bg-surface disabled:bg-surface-container-low"
            >
              <option value="">-- Chọn Leader --</option>
              {leaders.map(l => (
                <option key={l.id} value={l.id}>{l.name || l.email} ({l.email})</option>
              ))}
              {editing && leaderId && !leaders.find(l => String(l.id) === String(leaderId)) && (
                <option value={leaderId}>{leaderId}</option>
              )}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Members</label>
            <div className="border border-outline-variant rounded-lg max-h-48 overflow-y-auto bg-surface-container-low p-2 space-y-1">
              {allUsers.length === 0 ? (
                <div className="text-xs text-center p-2 text-on-surface-variant">Đang tải user...</div>
              ) : (
                allUsers.map(u => {
                  const uid = String(u.id);
                  const selected = memberIds.includes(uid);
                  return (
                    <div
                      key={uid}
                      onClick={() => toggleMember(uid)}
                      className={cn("flex items-center gap-2 p-2 rounded-md cursor-pointer text-xs transition border", selected ? "bg-primary/10 border-primary/30" : "bg-surface border-transparent hover:border-outline-variant")}
                    >
                      <input type="checkbox" checked={selected} readOnly className="cursor-pointer accent-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-on-surface truncate">{u.name || u.email.split("@")[0]}</div>
                        <div className="text-on-surface-variant text-[10px] truncate">{u.email}</div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="text-[10px] text-on-surface-variant mt-1 text-right">Đã chọn: {memberIds.length} member</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3 shrink-0 pt-4 border-t">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low cursor-pointer">
            Hủy
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting || !nameTeam.trim() || !leaderId} className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-on-primary-fixed-variant cursor-pointer disabled:opacity-50">
            {isSubmitting ? "Đang lưu..." : "Cập nhật"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export function CategoryManagement() {
  const [activeTab, setActiveTab] = useState<CategoryType>("intent");

  // States for Categories (intent, industry, tier, icp)
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingCategory, setEditingCategory] = useState<Category | undefined>();
  const [catModalOpen, setCatModalOpen] = useState(false);

  // States for Teams
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [editingTeam, setEditingTeam] = useState<any>();
  const [teamModalOpen, setTeamModalOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (activeTab === "team") {
        const res = await teamsService.getAll();
        setTeams(res.success && res.data ? res.data : []);
      } else {
        const res = await allPlatformCategoriesService.getAll(activeTab);
        setCategories(res.success && res.data ? res.data as Category[] : []);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CATEGORY Handlers
  const handleSaveCategory = async (payload: Partial<Category>) => {
    if (payload.id) {
      await allPlatformCategoriesService.update(payload as any);
    } else {
      await allPlatformCategoriesService.add(payload as any);
    }
    await fetchData();
  };
  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Xóa danh mục này?")) return;
    await allPlatformCategoriesService.delete(id);
    await fetchData();
  };

  // TEAM Handlers
  const handleSaveTeam = async (payload: any) => {
    if (payload.isEdit) {
      await teamsService.update(payload);
    } else {
      await teamsService.create(payload);
    }
    await fetchData();
  };
  const handleDeleteTeam = async (name: string, leaderId: string) => {
    if (!confirm(`Xóa team ${name}?`)) return;
    await teamsService.delete(name, leaderId);
    await fetchData();
  };

  // Group teams for display
  const groupedTeams = useMemo(() => {
    if (activeTab !== "team") return [];
    const map = new Map<string, any>();
    teams.forEach(t => {
      const leaderId = String((t as any).id_leader || "");
      const key = `${t.name_team}_${leaderId}`;
      if (!map.has(key)) {
        map.set(key, {
          name_team: t.name_team,
          id_leader: leaderId,
          member_ids: [],
        });
      }
      const mid = (t as any).id_member;
      if (mid) {
        map.get(key).member_ids.push(String(mid));
      }
    });
    return Array.from(map.values());
  }, [teams, activeTab]);

  const filteredTeams = groupedTeams.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(t.name_team || "").toLowerCase().includes(q) || String(t.id_leader || "").toLowerCase().includes(q);
  });

  const filteredCategories = categories.filter((cat) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const code = String((cat as any).code || "").toLowerCase();
    const name = String((cat as any).name || "").toLowerCase();
    return code.includes(q) || name.includes(q);
  });

  const cols = CATEGORY_TYPE_COLS[activeTab];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-on-surface">Quản lý danh mục</h2>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-outline-variant pb-2">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.type}
            type="button"
            onClick={() => {
              setActiveTab(tab.type);
              setSearch("");
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              activeTab === tab.type
                ? "bg-primary text-white shadow-sm"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
            )}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Tìm kiếm..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-outline-variant px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        <button
          type="button"
          onClick={() => {
            if (activeTab === "team") {
              setEditingTeam(undefined);
              setTeamModalOpen(true);
            } else {
              setEditingCategory(undefined);
              setCatModalOpen(true);
            }
          }}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-on-primary-fixed-variant cursor-pointer flex items-center gap-2"
        >
          <MaterialIcon name="add" className="text-lg" />
          Thêm mới
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-outline-variant shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              {cols.map((col) => (
                <th key={col} className="px-4 py-3.5 text-left font-bold text-on-surface-variant uppercase text-xs">
                  {col.replace(/_/g, " ")}
                </th>
              ))}
              <th className="px-4 py-3.5 text-right font-bold text-on-surface-variant uppercase text-xs">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant bg-surface">
            {isLoading ? (
              <tr>
                <td colSpan={cols.length + 1} className="px-4 py-12 text-center text-on-surface-variant">
                  <div className="w-6 h-6 border-2 border-outline-variant border-t-primary rounded-full animate-spin mx-auto mb-2" />
                  Đang tải dữ liệu...
                </td>
              </tr>
            ) : activeTab === "team" ? (
              filteredTeams.length === 0 ? (
                <tr><td colSpan={cols.length + 1} className="px-4 py-8 text-center text-on-surface-variant">Không có dữ liệu</td></tr>
              ) : (
                filteredTeams.map((t) => (
                  <tr key={`${t.name_team}_${t.leader_email}`} className="hover:bg-surface-container-low">
                    <td className="px-4 py-3 font-semibold text-on-surface">{t.name_team}</td>
                    <td className="px-4 py-3 text-on-surface-variant">{t.leader_email}</td>
                    <td className="px-4 py-3 text-on-surface font-bold">{t.number_of_member} <span className="font-normal text-on-surface-variant text-xs">members</span></td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => { setEditingTeam(t); setTeamModalOpen(true); }}
                        className="mr-3 text-xs font-bold text-primary hover:text-on-primary-fixed-variant hover:underline cursor-pointer"
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTeam(t.name_team, t.leader_email)}
                        className="text-xs font-bold text-on-surface-variant hover:text-primary hover:underline cursor-pointer"
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))
              )
            ) : (
              filteredCategories.length === 0 ? (
                <tr><td colSpan={cols.length + 1} className="px-4 py-8 text-center text-on-surface-variant">Không có dữ liệu</td></tr>
              ) : (
                filteredCategories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-surface-container-low">
                    {cols.map((col) => (
                      <td key={col} className={cn("px-4 py-3 text-on-surface", col === "code" && "font-semibold")}>
                        {(cat as any)[col] || "-"}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => { setEditingCategory(cat); setCatModalOpen(true); }}
                        className="mr-3 text-xs font-bold text-primary hover:text-on-primary-fixed-variant hover:underline cursor-pointer"
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="text-xs font-bold text-on-surface-variant hover:text-primary hover:underline cursor-pointer"
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))
              )
            )}
          </tbody>
        </table>
      </div>

      <CategoryModal
        isOpen={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        onSave={handleSaveCategory}
        editing={editingCategory}
        categoryType={activeTab}
      />

      <TeamModal
        isOpen={teamModalOpen}
        onClose={() => setTeamModalOpen(false)}
        onSave={handleSaveTeam}
        editing={editingTeam}
      />
    </div>
  );
}
