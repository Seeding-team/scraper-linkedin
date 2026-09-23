"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useMembers } from "@/hooks/useMembers";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  allPlatformMembersService,
  usersService,
  type AppUserProfile,
} from "@/services/all-platform.service";
import type { MemberProfile, Skill } from "@/types/unified.types";
import {
  PlatformStatCard,
  PlatformStatsRow,
} from "@/components/features/shared/PlatformStatCard";
import { SearchableSelect } from "@/modules/crm/components/SearchableSelect";

type MemberFormState = {
  id?: string;
  display_name: string;
  full_name: string;
  email: string;
  telegram_username: string;
  phone: string;
  birth_date: string;
  gender: string;
  team: string;
  position: string;
  department: string;
  experience_year: string;
  linked_user_id: string;
  linked_user_id_2: string;
  leader_name: string;
  leader_email: string;
  skill_ids: string[];
};

type MemberTab = "accounts" | "members";

// Main la CRM markee co dinh, khong co endpoint /auth/workspaces (khong co
// workspace switcher o Main) - danh sach 3 workspace/clone doc lap dung
// chung bang app_users nay phai khai bao TINH tai day (chi dung de Admin gan
// quyen dang nhap o "Quan ly thanh vien", khac voi cac clone crm-module/
// crm-cloudgate/crm-securityzone lay danh sach dong tu authService.listWorkspaces()).
const WORKSPACE_OPTIONS: { instance: string }[] = [
  { instance: "markee" },
  { instance: "cloudgate" },
  { instance: "SECURITYZONE" },
];

const WORKSPACE_LABELS: Record<string, string> = {
  markee: "Markee",
  cloudgate: "CloudGate",
  SECURITYZONE: "SecurityZone",
};

function workspaceLabel(instance: string): string {
  return WORKSPACE_LABELS[instance] || instance;
}

// Gia tri MAC DINH luc TAO/GAN tai khoan (khong khoa cung - admin van doi
// tay duoc sau do qua dropdown Presale/Sale o tab Tai khoan):
//   - Team "Sale": moi role (Leader lan Member) -> Sale.
//   - Team "Marketing": CHI Leader -> Sale; Member Marketing KHONG tu gan
//     (phai admin cap tay).
//   - Team con lai: Leader -> Presale; Member KHONG tu gan.
function defaultQuoteBusinessRole(role: string, team: string | null | undefined): "sale" | "presale" | null {
  if (team === "Sale") return "sale";
  if (team === "Marketing") return role === "leader" ? "sale" : null;
  if (role === "leader") return "presale";
  return null;
}

function emptyMemberForm(): MemberFormState {
  return {
    display_name: "",
    full_name: "",
    email: "",
    telegram_username: "",
    phone: "",
    birth_date: "",
    gender: "",
    team: "",
    position: "",
    department: "",
    experience_year: "0",
    linked_user_id: "",
    linked_user_id_2: "",
    leader_name: "",
    leader_email: "",
    skill_ids: [],
  };
}

function memberToForm(m: MemberProfile): MemberFormState {
  return {
    id: m.id,
    display_name: m.display_name,
    full_name: m.full_name,
    email: m.email || "",
    telegram_username: m.telegram_username || "",
    phone: m.phone || "",
    birth_date: m.birth_date ? m.birth_date.slice(0, 10) : "",
    gender: m.gender || "",
    team: m.team || "",
    position: m.position || "",
    department: m.department || "",
    experience_year: String(m.experience_year ?? 0),
    linked_user_id: m.linked_user_id || "",
    linked_user_id_2: m.linked_user_id_2 || "",
    leader_name: m.leader_name || "",
    leader_email: m.leader_email || "",
    skill_ids: m.skill_ids || [],
  };
}

export function MemberManagementContent() {
  const { user: currentUser } = useAppAuth();
  const isAdmin = currentUser?.role === "admin";
  const { members, loading, error: membersError, loadMembers } = useMembers();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [appUsers, setAppUsers] = useState<AppUserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [teamFilter, setTeamFilter] = useState("");

  // 2 tab tách riêng — "Quản lý tài khoản" (đăng nhập/role/workspace) và
  // "Quản lý thành viên" (hồ sơ HR + đồng bộ tuyển dụng), theo đúng mẫu trang
  // /account của pm-new. Trước 2026-07-23 app này từng tách y hệt (Quản lý
  // người dùng riêng), sau đó gộp lại — nay tách lại thành 2 tab trên CÙNG 1
  // trang thay vì 2 route riêng, giữ nguyên toàn bộ logic/handler cũ.
  const [activeTab, setActiveTab] = useState<MemberTab>("accounts");
  const [accountSearch, setAccountSearch] = useState("");

  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [form, setForm] = useState<MemberFormState>(emptyMemberForm());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<MemberProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    created: number;
    updated: number;
    skipped: Array<{ row: number; reason: string }>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Đồng bộ ĐẦY ĐỦ như pm-new (accepted + resigned, tự khóa/mở tài khoản, tự
  // xóa member không còn trong hệ tuyển dụng) — xem
  // sync_members_from_recruitment() ở backend.
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<{
    created: number;
    updated: number;
    deleted: number;
    locked: number;
    unlocked: number;
    skipped: Array<{ row: string; reason: string }>;
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadAppUsers() {
    const res = await usersService.getAllProfiles();
    setAppUsers(res.data || []);
  }

  // Load skills + app_users 1 lần khi mount (không phụ thuộc filter).
  useEffect(() => {
    void (async () => {
      const res = await allPlatformMembersService.getSkills();
      setSkills(res.data || []);
    })();
    void loadAppUsers();
  }, []);

  const appUsersById = useMemo(() => {
    const map = new Map<string, AppUserProfile>();
    for (const u of appUsers) map.set(u.id, u);
    return map;
  }, [appUsers]);

  // Chiều ngược lại appUsersById — 1 tài khoản có thể được liên kết từ 1
  // thành viên (linked_user_id), dùng để hiện cột "Thành viên liên kết" ở
  // tab Quản lý tài khoản.
  const memberByLinkedUserId = useMemo(() => {
    const map = new Map<string, MemberProfile>();
    for (const m of members) if (m.linked_user_id) map.set(m.linked_user_id, m);
    return map;
  }, [members]);

  // Theo quyết định mới nhất: tab Thành viên CHỈ còn CRUD hồ sơ + đồng bộ từ
  // CV — không còn hành động "tạo/gán tài khoản" nào ở đây nữa (kể cả qua
  // modal). Tạo tài khoản đăng nhập giờ CHỈ làm ở tab Tài khoản (nút "Tạo
  // tài khoản mới" riêng, admin tự chọn liên kết Member nếu muốn) — đúng
  // luồng thật của pm-new (https://kpi.markeeai.com/accounts).
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [newAccountForm, setNewAccountForm] = useState({ email: "", full_name: "", role: "member", member_id: "" });
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);

  function openCreateAccountModal() {
    setNewAccountForm({ email: "", full_name: "", role: "member", member_id: "" });
    setCreateAccountError(null);
    setShowCreateAccountModal(true);
  }

  // Sửa/Xóa 1 tài khoản đã tồn tại — giống đúng nút "Sửa"/"Xóa" của pm-new
  // (accounts/page.tsx), thiếu ở lần port trước (chỉ có select/checkbox
  // inline, không sửa được email/họ tên/đổi Member liên kết, và không xóa
  // hẳn được — chỉ khóa/mở qua Switch).
  const [editAccountTarget, setEditAccountTarget] = useState<AppUserProfile | null>(null);
  const [editAccountForm, setEditAccountForm] = useState({ email: "", full_name: "", member_id: "" });
  const [savingEditAccount, setSavingEditAccount] = useState(false);
  const [editAccountError, setEditAccountError] = useState<string | null>(null);

  function openEditAccountModal(account: AppUserProfile) {
    const linked = memberByLinkedUserId.get(account.id);
    setEditAccountForm({ email: account.email, full_name: account.name || "", member_id: linked?.id || "" });
    setEditAccountError(null);
    setEditAccountTarget(account);
  }

  async function handleEditAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editAccountTarget) return;
    const email = editAccountForm.email.trim();
    if (!email) {
      setEditAccountError("Email không được để trống.");
      return;
    }
    setEditAccountError(null);
    setSavingEditAccount(true);
    try {
      const updates: { new_email?: string; full_name?: string; member_id?: string | null } = {
        full_name: editAccountForm.full_name.trim(),
        member_id: editAccountForm.member_id || null,
      };
      if (email.toLowerCase() !== editAccountTarget.email.toLowerCase()) {
        updates.new_email = email;
      }
      const res = await usersService.updateAccountProfile(editAccountTarget.email, updates);
      if (!res.success) throw new Error(res.message || "Không cập nhật được tài khoản");
      setEditAccountTarget(null);
      await Promise.all([loadAppUsers(), loadMembers()]);
    } catch (err) {
      setEditAccountError(err instanceof Error ? err.message : "Lỗi khi cập nhật tài khoản");
    } finally {
      setSavingEditAccount(false);
    }
  }

  async function handleDeleteAccount(account: AppUserProfile) {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản "${account.email}"?\nThành viên liên kết sẽ KHÔNG bị ảnh hưởng.`)) return;
    setSavingUserId(account.id);
    try {
      const res = await usersService.deleteAccount(account.email);
      if (!res.success) throw new Error(res.message || "Lỗi xóa tài khoản");
      await Promise.all([loadAppUsers(), loadMembers()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi xóa tài khoản");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleCreateNewAccount(e: React.FormEvent) {
    e.preventDefault();
    const email = newAccountForm.email.trim();
    if (!email) {
      setCreateAccountError("Nhập email trước.");
      return;
    }
    setCreateAccountError(null);
    setCreatingAccount(true);
    try {
      const res = await usersService.createAccount({
        email,
        name: newAccountForm.full_name.trim() || undefined,
        role: newAccountForm.role,
      });
      if (!res.success || !res.data) throw new Error(res.message || "Không tạo được tài khoản");
      const account = res.data as AppUserProfile;
      let linkedMember: MemberProfile | undefined;
      if (newAccountForm.member_id) {
        const linkRes = await allPlatformMembersService.update({ id: newAccountForm.member_id, linked_user_id: account.id });
        if (!linkRes.success) throw new Error(linkRes.message || "Tạo tài khoản thành công nhưng liên kết thất bại");
        linkedMember = members.find(m => m.id === newAccountForm.member_id);
      }
      const defaultRole = defaultQuoteBusinessRole(newAccountForm.role, linkedMember?.team);
      if (defaultRole) {
        await usersService.updateQuoteBusinessRole(account.email, defaultRole);
      }
      setShowCreateAccountModal(false);
      await Promise.all([loadAppUsers(), loadMembers()]);
    } catch (err) {
      setCreateAccountError(err instanceof Error ? err.message : "Lỗi khi tạo tài khoản");
    } finally {
      setCreatingAccount(false);
    }
  }

  async function handleRowRoleChange(account: AppUserProfile, role: string) {
    if (!isAdmin) return; // /update-role: chỉ admin
    setSavingUserId(account.id);
    try {
      const res = await usersService.updateRole(account.email, role);
      if (!res.success) throw new Error(res.message || "Không đổi được role");
      await loadAppUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không đổi được role");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleRowToggleQuoteApprover(account: AppUserProfile, canApprove: boolean) {
    if (!isAdmin) return; // /update-quote-approver: chỉ admin
    setSavingUserId(account.id);
    try {
      const res = await usersService.updateQuoteApprover(account.email, canApprove);
      if (!res.success) throw new Error(res.message || "Không cập nhật được quyền duyệt báo giá");
      await loadAppUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không cập nhật được quyền duyệt báo giá");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleRowChangeBusinessRole(account: AppUserProfile, value: string) {
    if (!isAdmin) return; // /update-quote-business-role: CHI admin (backend cung tu choi 403 that neu goi thang)
    const nextRole = value === "" ? null : (value as "presale" | "sale" | "both");
    setSavingUserId(account.id);
    try {
      const res = await usersService.updateQuoteBusinessRole(account.email, nextRole);
      if (!res.success) throw new Error(res.message || "Không cập nhật được vai trò báo giá");
      await loadAppUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không cập nhật được vai trò báo giá");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleRowToggleWorkspace(account: AppUserProfile, instance: string, checked: boolean) {
    if (!isAdmin) return; // /update-allowed-instances: chỉ admin
    const current = new Set(account.allowed_instances || []);
    if (checked) current.add(instance);
    else current.delete(instance);
    setSavingUserId(account.id);
    try {
      const res = await usersService.updateAllowedInstances(account.email, Array.from(current));
      if (!res.success) throw new Error(res.message || "Không cập nhật được workspace");
      await loadAppUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không cập nhật được workspace");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleRowToggleActive(account: AppUserProfile) {
    const nextActive = !(account.is_active !== false);
    if (!nextActive && !confirm(`Vô hiệu hóa tài khoản "${account.email}"? Người này sẽ bị đăng xuất và không đăng nhập lại được.`)) {
      return;
    }
    setSavingUserId(account.id);
    try {
      const res = await usersService.setActive(account.email, nextActive);
      if (!res.success) throw new Error(res.message || "Không cập nhật được trạng thái");
      await loadAppUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không cập nhật được trạng thái");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleSyncFromRecruitment() {
    if (!confirm("Đồng bộ ứng viên đã trúng tuyển từ hệ thống tuyển dụng (cv.markeeai.com) vào danh bạ thành viên?")) return;
    setSyncing(true);
    setSyncError(null);
    setSyncSummary(null);
    try {
      const res = await allPlatformMembersService.syncFromRecruitment();
      if (!res.success) throw new Error(res.message || "Đồng bộ thất bại");
      setSyncSummary(res.data || null);
      await loadMembers();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Đồng bộ thất bại");
    } finally {
      setSyncing(false);
    }
  }

  const teamOptions = useMemo(
    () => Array.from(new Set(members.map(m => m.team).filter(Boolean))) as string[],
    [members]
  );

  const skillsByCategory = useMemo(() => {
    const groups = new Map<string, Skill[]>();
    for (const skill of skills) {
      const key = skill.category || "Khác";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(skill);
    }
    return Array.from(groups.entries());
  }, [skills]);

  const filteredMembers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return members.filter(m => {
      if (teamFilter && m.team !== teamFilter) return false;
      if (!term) return true;
      return (
        m.display_name.toLowerCase().includes(term) ||
        m.full_name.toLowerCase().includes(term) ||
        (m.email || "").toLowerCase().includes(term)
      );
    });
  }, [members, searchTerm, teamFilter]);

  const filteredAccounts = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    if (!term) return appUsers;
    return appUsers.filter(a =>
      (a.email || "").toLowerCase().includes(term) || (a.name || "").toLowerCase().includes(term)
    );
  }, [appUsers, accountSearch]);

  function openAddModal() {
    setForm(emptyMemberForm());
    setModalError(null);
    setModalMode("add");
  }

  function openEditModal(member: MemberProfile) {
    setForm(memberToForm(member));
    setModalError(null);
    setModalMode("edit");
  }

  function toggleSkill(skillId: string) {
    setForm(current => ({
      ...current,
      skill_ids: current.skill_ids.includes(skillId)
        ? current.skill_ids.filter(id => id !== skillId)
        : [...current.skill_ids, skillId],
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.display_name.trim() || !form.full_name.trim()) {
      setModalError("Vui lòng nhập đầy đủ Display Name và Họ và tên.");
      return;
    }
    setIsSubmitting(true);
    setModalError(null);
    try {
      // Form Thành viên giờ CHỈ lưu hồ sơ — không còn tự tạo tài khoản đăng
      // nhập ở đây nữa (tạo tài khoản chỉ làm ở tab Tài khoản, xem
      // openCreateAccountModal/handleCreateNewAccount).
      const payload = {
        display_name: form.display_name.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim() || undefined,
        telegram_username: form.telegram_username.trim() || undefined,
        phone: form.phone.trim() || undefined,
        birth_date: form.birth_date || undefined,
        gender: form.gender || undefined,
        team: form.team.trim() || undefined,
        position: form.position.trim() || undefined,
        department: form.department.trim() || undefined,
        experience_year: Number(form.experience_year) || 0,
        linked_user_id: form.linked_user_id || undefined,
        linked_user_id_2: form.linked_user_id_2 || undefined,
        leader_name: form.leader_name.trim() || undefined,
        leader_email: form.leader_email.trim() || undefined,
        skill_ids: form.skill_ids,
      };
      const res =
        modalMode === "add"
          ? await allPlatformMembersService.add(payload)
          : await allPlatformMembersService.update({ ...payload, id: form.id! });
      if (!res.success) {
        setModalError(res.message || "Lưu thất bại. Vui lòng thử lại.");
        return;
      }
      setModalMode(null);
      await loadMembers();
    } catch {
      setModalError("Lỗi hệ thống khi gửi yêu cầu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await allPlatformMembersService.delete(deleteTarget.id);
      if (res.success) {
        setDeleteTarget(null);
        await loadMembers();
      } else {
        alert(res.message || "Lỗi khi xóa thành viên");
      }
    } catch {
      alert("Lỗi kết nối khi xóa");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportSummary(null);
    try {
      const summary = await allPlatformMembersService.importExcel(file);
      setImportSummary(summary);
      await loadMembers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import thất bại");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="w-full min-w-0 space-y-6 font-sans">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-primary/10 p-3">
          <MaterialIcon name="manage_accounts" className="text-primary text-3xl" />
        </div>
        <div>
          <h1 className="text-h1 text-on-background font-semibold">Tài khoản &amp; Thành viên</h1>
          <p className="text-body-md text-on-surface-variant">
            Quản lý tài khoản đăng nhập (role/workspace) và danh bạ nhân sự nội bộ — 2 khu vực tách riêng.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-outline-variant overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("accounts")}
          className={cn(
            "px-4 py-2.5 text-xs font-bold uppercase tracking-wide border-b-2 -mb-px transition",
            activeTab === "accounts"
              ? "border-primary text-primary"
              : "border-transparent text-on-surface-variant hover:text-on-background"
          )}
        >
          Quản lý tài khoản
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("members")}
          className={cn(
            "px-4 py-2.5 text-xs font-bold uppercase tracking-wide border-b-2 -mb-px transition",
            activeTab === "members"
              ? "border-primary text-primary"
              : "border-transparent text-on-surface-variant hover:text-on-background"
          )}
        >
          Quản lý thành viên
        </button>
      </div>

      {activeTab === "accounts" && (
        <>
          <PlatformStatsRow>
            <PlatformStatCard label="Tổng tài khoản" value={appUsers.length} accent="primary" />
            <PlatformStatCard label="Đang hoạt động" value={appUsers.filter(a => a.is_active !== false).length} accent="success" />
            <PlatformStatCard label="Đã vô hiệu hóa" value={appUsers.filter(a => a.is_active === false).length} accent="warning" />
            <PlatformStatCard label="Admin" value={appUsers.filter(a => a.role === "admin").length} accent="primary" />
          </PlatformStatsRow>

          {/* Section 6 (HTML parity round 3) - khoi giai thich THUAN UI, KHONG
              tao them role/quyen moi, chi mo ta lai dung ma tran da chot (system
              role Admin/Leader/Member x business role Presale/Sale/Both/Chua
              gan). Dat ngay tren bang de nguoi gan quote_business_role hieu ro
              quyen thuc te SE la gi truoc khi gan. */}
          <details className="rounded-xl border border-outline-variant bg-surface p-6 shadow-sm">
            <summary className="cursor-pointer text-body-md font-semibold text-on-background">
              Quyền trong quy trình báo giá — Presale / Sale / Both hoạt động thế nào?
            </summary>
            <div className="mt-4 space-y-3 text-body-sm text-on-surface-variant">
              <p>
                <strong className="text-on-background">Role hệ thống</strong> (Admin/Leader/Member) và{" "}
                <strong className="text-on-background">Vai trò nghiệp vụ báo giá</strong> (Presale/Sale/Presale &amp; Sale/Chưa gán) là
                2 khái niệm TÁCH BIỆT — không có role &quot;CEO&quot; riêng, Admin đóng vai trò duyệt cuối (Admin review). Chỉ{" "}
                <strong className="text-on-background">Admin</strong> được gán/đổi Vai trò nghiệp vụ báo giá cho Leader/Member; Leader
                và Member chỉ xem được (không tự đổi).
              </p>
              <p>
                Có Vai trò nghiệp vụ (kể cả &quot;Presale &amp; Sale&quot;) <strong className="text-on-background">chưa tự động</strong>{" "}
                có quyền trên MỌI báo giá — chỉ khi được phân công cụ thể (Người phụ trách kỹ thuật/Người phụ trách giá bán) trên đúng
                báo giá đó, quyền dưới đây mới áp dụng.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-outline-variant text-left text-on-surface-variant">
                      <th className="py-2 pr-4 font-semibold">Ai</th>
                      <th className="py-2 pr-4 font-semibold">Nhập Giá vốn</th>
                      <th className="py-2 pr-4 font-semibold">Nhập Giá bán (markup)</th>
                      <th className="py-2 pr-4 font-semibold">Duyệt báo giá</th>
                      <th className="py-2 font-semibold">Phát hành / Gửi khách</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-outline-variant/60">
                      <td className="py-2 pr-4 font-medium text-on-background">Admin</td>
                      <td className="py-2 pr-4">Có (mọi báo giá)</td>
                      <td className="py-2 pr-4">Có (mọi báo giá)</td>
                      <td className="py-2 pr-4">Có</td>
                      <td className="py-2">Có</td>
                    </tr>
                    <tr className="border-b border-outline-variant/60">
                      <td className="py-2 pr-4 font-medium text-on-background">Leader (chưa được phân công)</td>
                      <td className="py-2 pr-4 text-on-surface-variant">Không</td>
                      <td className="py-2 pr-4 text-on-surface-variant">Không</td>
                      <td className="py-2 pr-4">Có (nếu bật &quot;Được duyệt báo giá&quot;)</td>
                      <td className="py-2 text-on-surface-variant">Không</td>
                    </tr>
                    <tr className="border-b border-outline-variant/60">
                      <td className="py-2 pr-4 font-medium text-on-background">Presale (được gán làm Người phụ trách kỹ thuật)</td>
                      <td className="py-2 pr-4">Có (đúng báo giá được gán)</td>
                      <td className="py-2 pr-4 text-on-surface-variant">Không (chỉ xem, không sửa)</td>
                      <td className="py-2 pr-4 text-on-surface-variant">Không</td>
                      <td className="py-2 text-on-surface-variant">Không</td>
                    </tr>
                    <tr className="border-b border-outline-variant/60">
                      <td className="py-2 pr-4 font-medium text-on-background">Sale (được gán làm Người phụ trách giá bán)</td>
                      <td className="py-2 pr-4">Xem read-only (Presale đã chốt)</td>
                      <td className="py-2 pr-4">Có (đúng báo giá được gán)</td>
                      <td className="py-2 pr-4">Có (nếu bật &quot;Được duyệt báo giá&quot;)</td>
                      <td className="py-2">Có (đúng báo giá được gán)</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium text-on-background">Member chưa được phân công báo giá nào</td>
                      <td className="py-2 pr-4 text-on-surface-variant">Không</td>
                      <td className="py-2 pr-4 text-on-surface-variant">Không</td>
                      <td className="py-2 pr-4 text-on-surface-variant">Không</td>
                      <td className="py-2 text-on-surface-variant">Không</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] italic">
                &quot;Presale &amp; Sale&quot; (Both) chỉ nghĩa là 1 người CÓ THỂ được gán cả 2 vai trên các báo giá khác nhau — trên
                từng báo giá cụ thể, quyền vẫn tính theo đúng field <em>Người phụ trách kỹ thuật</em>/<em>Người phụ trách giá bán</em>{" "}
                của báo giá đó, không tự động có cả 2 quyền cùng lúc trừ khi được gán cả 2 trên chính báo giá này.
              </p>
            </div>
          </details>

          <div className="rounded-xl border border-outline-variant bg-surface p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full min-w-0 sm:max-w-[280px]">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] pointer-events-none">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Tìm theo email hoặc tên..."
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                />
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={openCreateAccountModal}
                  className="flex items-center justify-center gap-1.5 whitespace-nowrap bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm"
                >
                  <MaterialIcon name="add" className="text-base" /> Tạo tài khoản mới
                </button>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface shadow-sm">
              <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
                <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
                  <tr>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Họ tên</th>
                    <th className="py-3 px-4">Thành viên liên kết</th>
                    <th className="py-3 px-4">Team</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Vai trò báo giá</th>
                    <th className="py-3 px-4">Workspace</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4 text-center">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant text-on-surface-variant">
                  {filteredAccounts.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center italic">Chưa có tài khoản nào.</td></tr>
                  ) : (
                    filteredAccounts.map(account => {
                      const linkedMember = memberByLinkedUserId.get(account.id);
                      return (
                        <tr key={account.id} className="hover:bg-surface-container-low transition">
                          <td className="py-3 px-4 font-semibold text-on-surface">{account.email}</td>
                          <td className="py-3 px-4">{account.name || "—"}</td>
                          <td className="py-3 px-4">
                            {linkedMember ? linkedMember.display_name : <span className="italic text-on-surface-variant">Chưa liên kết</span>}
                          </td>
                          <td className="py-3 px-4">{linkedMember?.team || "—"}</td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-1.5">
                              <select
                                value={account.role || "member"}
                                disabled={!isAdmin || savingUserId === account.id}
                                onChange={e => handleRowRoleChange(account, e.target.value)}
                                className="px-2 py-1 bg-surface-container-low border border-outline-variant rounded-lg text-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                title={isAdmin ? undefined : "Chỉ admin mới đổi role tài khoản có sẵn"}
                              >
                                <option value="member">member</option>
                                <option value="leader">leader</option>
                                <option value="admin">admin</option>
                              </select>
                              <label
                                className="flex items-center gap-1.5 text-[10px] text-on-surface-variant cursor-pointer disabled:cursor-not-allowed"
                                title={isAdmin ? "Cho phép tài khoản này duyệt Báo giá (admin luôn duyệt được dù không bật)" : "Chỉ admin mới đổi được quyền này"}
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(account.can_approve_quotes) || account.role === "admin"}
                                  disabled={!isAdmin || savingUserId === account.id || account.role === "admin"}
                                  onChange={e => handleRowToggleQuoteApprover(account, e.target.checked)}
                                />
                                Được duyệt báo giá
                              </label>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {isAdmin ? (
                              <select
                                value={account.quote_business_role || ""}
                                disabled={savingUserId === account.id}
                                onChange={e => handleRowChangeBusinessRole(account, e.target.value)}
                                className="px-2 py-1 bg-surface-container-low border border-outline-variant rounded-lg text-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                title="Vai trò nghiệp vụ báo giá (Presale/Sale) — tách biệt với Role hệ thống, chỉ Admin gán được"
                              >
                                <option value="">Không tham gia báo giá</option>
                                <option value="presale">Presale</option>
                                <option value="sale">Sale</option>
                              </select>
                            ) : (
                              // Leader/Member: CHI xem badge, khong sua duoc (dung yeu cau
                              // "Leader chi xem badge, khong co select editable" - backend
                              // van tu choi 403 that neu Leader co goi thang API).
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-surface-container-low text-on-surface-variant border border-outline-variant">
                                {account.quote_business_role === "presale"
                                  ? "Presale"
                                  : account.quote_business_role === "sale"
                                    ? "Sale"
                                    : account.quote_business_role === "both"
                                      ? "Presale & Sale"
                                      : "Không tham gia"}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {account.role === "admin" ? (
                              <span
                                className="px-2 py-0.5 rounded-full text-[9px] font-bold border border-outline-variant bg-surface-container-low text-on-surface-variant"
                                title="Admin luôn vào được mọi workspace, không giới hạn"
                              >
                                Tất cả
                              </span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {WORKSPACE_OPTIONS.map(w => (
                                  <label key={w.instance} className="flex items-center gap-1.5 text-[10px] text-on-surface-variant cursor-pointer disabled:cursor-not-allowed">
                                    <input
                                      type="checkbox"
                                      checked={(account.allowed_instances || []).includes(w.instance)}
                                      disabled={!isAdmin || savingUserId === account.id}
                                      onChange={e => handleRowToggleWorkspace(account, w.instance, e.target.checked)}
                                    />
                                    {workspaceLabel(w.instance)}
                                  </label>
                                ))}
                                {!account.allowed_instances?.length && (
                                  <span className="text-[9px] italic text-on-surface-variant">
                                    Mặc định: chỉ site đã đăng ký
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                account.is_active !== false
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {account.is_active !== false ? "Đang hoạt động" : "Đã vô hiệu hóa"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-2">
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => openEditAccountModal(account)}
                                  className="p-1.5 hover:bg-surface-container-low rounded-lg transition"
                                  title="Sửa"
                                >
                                  <MaterialIcon name="edit" className="text-base" />
                                </button>
                              )}
                              <Switch
                                checked={account.is_active !== false}
                                disabled={savingUserId === account.id}
                                onCheckedChange={() => handleRowToggleActive(account)}
                                className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-slate-300"
                                title={account.is_active !== false ? "Bấm để vô hiệu hóa" : "Bấm để kích hoạt lại"}
                              />
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteAccount(account)}
                                  disabled={savingUserId === account.id || currentUser?.id === account.id}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={currentUser?.id === account.id ? "Không thể tự xóa tài khoản đang đăng nhập" : "Xóa"}
                                >
                                  <MaterialIcon name="delete" className="text-base" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "members" && (
        <>
          <PlatformStatsRow>
            <PlatformStatCard label="Tổng thành viên" value={members.length} accent="primary" />
            <PlatformStatCard label="Đã liên kết tài khoản" value={members.filter(m => m.linked_user_id).length} accent="success" />
            <PlatformStatCard label="Số team" value={teamOptions.length} accent="warning" />
            <PlatformStatCard label="Kỹ năng đã khai báo" value={skills.length} accent="primary" />
          </PlatformStatsRow>

          <div className="rounded-xl border border-outline-variant bg-surface p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full min-w-0 sm:max-w-[280px]">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    placeholder="Tìm theo tên hoặc email..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  />
                </div>
                <select
                  value={teamFilter}
                  onChange={e => setTeamFilter(e.target.value)}
                  className="shrink-0 px-3 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none cursor-pointer"
                >
                  <option value="">Tất cả Team</option>
                  {teamOptions.map(team => (
                    <option key={team} value={team}>{team}</option>
                  ))}
                </select>
              </div>
              <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void handleSyncFromRecruitment()}
                  className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border border-outline-variant hover:bg-surface-container-low text-on-surface px-4 py-2 rounded-xl text-xs font-bold transition sm:flex-none disabled:opacity-60"
                  title="Kéo ứng viên đã trúng tuyển từ hệ thống tuyển dụng (cv.markeeai.com) về danh bạ này"
                >
                  <MaterialIcon name="sync" className="text-base" /> {syncing ? "Đang đồng bộ..." : "Đồng bộ từ tuyển dụng"}
                </button>
                <button
                  type="button"
                  onClick={() => { setImportOpen(true); setImportSummary(null); }}
                  className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border border-outline-variant hover:bg-surface-container-low text-on-surface px-4 py-2 rounded-xl text-xs font-bold transition sm:flex-none"
                >
                  <MaterialIcon name="attach_file" className="text-base" /> Import Excel
                </button>
                <button
                  type="button"
                  onClick={openAddModal}
                  className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm sm:flex-none"
                >
                  <MaterialIcon name="add" className="text-base" /> Thêm thành viên
                </button>
              </div>
            </div>

            {syncError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-medium">{syncError}</div>
            )}
            {syncSummary && (
              <div className="space-y-1 rounded-xl border border-outline-variant bg-surface-container-low p-3 text-xs">
                <p>Đã tạo mới: <span className="font-bold text-emerald-600">{syncSummary.created}</span></p>
                <p>Đã cập nhật: <span className="font-bold text-sky-600">{syncSummary.updated}</span></p>
                <p>Đã gỡ bỏ (không còn trong hệ tuyển dụng): <span className="font-bold text-slate-600">{syncSummary.deleted}</span></p>
                <p>Đã khóa tài khoản (nghỉ việc): <span className="font-bold text-amber-600">{syncSummary.locked}</span></p>
                <p>Đã mở khóa tài khoản (đi làm lại): <span className="font-bold text-emerald-600">{syncSummary.unlocked}</span></p>
                <p>Bỏ qua: <span className="font-bold text-red-600">{syncSummary.skipped.length}</span></p>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface shadow-sm">
              <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
                <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
                  <tr>
                    <th className="py-3 px-4">STT</th>
                    <th className="py-3 px-4">Display Name</th>
                    <th className="py-3 px-4">Họ và tên</th>
                    <th className="py-3 px-4">Team</th>
                    <th className="py-3 px-4">Kỹ năng</th>
                    <th className="py-3 px-4">Telegram</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Leader</th>
                    <th className="py-3 px-4">Tài Khoản</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4 text-center">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant text-on-surface-variant">
                  {loading ? (
                    <tr><td colSpan={10} className="py-12 text-center">Đang tải danh sách thành viên...</td></tr>
                  ) : membersError ? (
                    <tr><td colSpan={10} className="py-12 text-center text-red-600 font-medium">{membersError}</td></tr>
                  ) : filteredMembers.length === 0 ? (
                    <tr><td colSpan={10} className="py-12 text-center italic">Chưa có thành viên nào.</td></tr>
                  ) : (
                    filteredMembers.map((m, index) => {
                      const account = m.linked_user_id ? appUsersById.get(m.linked_user_id) : undefined;
                      const skillNames = (m.skills || []).map(s => s.name);
                      const isOff = m.employment_status === "OFF";
                      return (
                        <tr key={m.id} className="hover:bg-surface-container-low transition">
                          <td className="py-3 px-4 text-on-surface-variant">{index + 1}</td>
                          <td className="py-3 px-4 font-semibold text-on-surface">{m.display_name}</td>
                          <td className="py-3 px-4">{m.full_name}</td>
                          <td className="py-3 px-4">{m.team || "—"}</td>
                          <td className="py-3 px-4 max-w-[200px] truncate" title={skillNames.join(", ")}>
                            {skillNames.length ? skillNames.join(", ") : "—"}
                          </td>
                          <td className="py-3 px-4">{m.telegram_username || "—"}</td>
                          <td className="py-3 px-4">{m.email || "—"}</td>
                          <td className="py-3 px-4">{m.leader_name || "—"}</td>
                          <td className="py-3 px-4">
                            {isOff ? (
                              <span className="text-on-surface-variant">OFF</span>
                            ) : account ? (
                              <span className="text-emerald-600 font-bold">Có</span>
                            ) : (
                              <span className="text-amber-600">Chưa có</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                isOff ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                              }`}
                            >
                              {isOff ? "OFF" : "ON"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-2">
                              <button type="button" onClick={() => openEditModal(m)} className="p-1.5 hover:bg-surface-container-low rounded-lg transition" title="Sửa">
                                <MaterialIcon name="edit" className="text-base" />
                              </button>
                              <button type="button" onClick={() => setDeleteTarget(m)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition" title="Xóa">
                                <MaterialIcon name="delete" className="text-base" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showCreateAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]">
          <div style={{ width: "100%", maxWidth: "420px" }} className="bg-surface rounded-xl border border-outline-variant shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-on-surface">Tạo tài khoản mới</h3>
              <button type="button" onClick={() => setShowCreateAccountModal(false)} className="p-1.5 rounded-lg hover:bg-surface-container-low">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <form onSubmit={e => void handleCreateNewAccount(e)} className="p-6 space-y-4">
              {createAccountError && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-medium">{createAccountError}</div>
              )}
              <Field label="Liên kết thành viên" hint="tùy chọn">
                <SearchableSelect
                  value={newAccountForm.member_id}
                  onChange={v => {
                    const linked = members.find(m => m.id === v);
                    setNewAccountForm(f => ({
                      ...f,
                      member_id: v,
                      full_name: linked ? linked.full_name : f.full_name,
                      email: linked?.email && !f.email ? linked.email : f.email,
                    }));
                  }}
                  placeholder="-- Không liên kết thành viên --"
                  options={members.filter(m => !m.linked_user_id).map(m => ({ value: m.id, label: `${m.display_name} — ${m.full_name}` }))}
                />
              </Field>
              <Field label="Email" required>
                <input type="email" value={newAccountForm.email} onChange={e => setNewAccountForm(f => ({ ...f, email: e.target.value }))} placeholder="email@company.com" />
              </Field>
              <Field label="Họ tên">
                <input value={newAccountForm.full_name} onChange={e => setNewAccountForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Nguyễn Văn A" />
              </Field>
              <Field label="Role">
                <select value={newAccountForm.role} onChange={e => setNewAccountForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="member">member</option>
                  <option value="leader">leader</option>
                  {isAdmin && <option value="admin">admin</option>}
                </select>
              </Field>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateAccountModal(false)} className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface font-bold py-2 rounded-xl text-xs transition">
                  Hủy
                </button>
                <button type="submit" disabled={creatingAccount} className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2 rounded-xl text-xs transition shadow-sm disabled:opacity-60">
                  {creatingAccount ? "Đang tạo..." : "Tạo tài khoản"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editAccountTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]">
          <div style={{ width: "100%", maxWidth: "420px" }} className="bg-surface rounded-xl border border-outline-variant shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-on-surface">Sửa tài khoản</h3>
              <button type="button" onClick={() => setEditAccountTarget(null)} className="p-1.5 rounded-lg hover:bg-surface-container-low">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <form onSubmit={e => void handleEditAccountSubmit(e)} className="p-6 space-y-4">
              {editAccountError && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-medium">{editAccountError}</div>
              )}
              <Field label="Email" required>
                <input type="email" value={editAccountForm.email} onChange={e => setEditAccountForm(f => ({ ...f, email: e.target.value }))} placeholder="email@company.com" />
              </Field>
              <Field label="Họ tên">
                <input value={editAccountForm.full_name} onChange={e => setEditAccountForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Nguyễn Văn A" />
              </Field>
              <Field label="Liên kết thành viên" hint="tùy chọn">
                <SearchableSelect
                  value={editAccountForm.member_id}
                  onChange={v => setEditAccountForm(f => ({ ...f, member_id: v }))}
                  placeholder="-- Không liên kết thành viên --"
                  options={members
                    .filter(m => !m.linked_user_id || m.linked_user_id === editAccountTarget.id)
                    .map(m => ({ value: m.id, label: `${m.display_name} — ${m.full_name}` }))}
                />
              </Field>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditAccountTarget(null)} className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface font-bold py-2 rounded-xl text-xs transition">
                  Hủy
                </button>
                <button type="submit" disabled={savingEditAccount} className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2 rounded-xl text-xs transition shadow-sm disabled:opacity-60">
                  {savingEditAccount ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]">
          <div style={{ width: "100%", maxWidth: "760px" }} className="bg-surface rounded-xl border border-outline-variant shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low shrink-0">
              <h3 className="font-bold text-on-surface uppercase text-sm">
                {modalMode === "add" ? "Thêm thành viên mới" : "Chỉnh sửa thành viên"}
              </h3>
              <button type="button" onClick={() => setModalMode(null)} className="p-1.5 rounded-lg hover:bg-surface-container-low">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>

            <form onSubmit={e => void handleSave(e)} className="p-6 space-y-5 overflow-y-auto flex-1">
              <section className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1">Thông tin cá nhân</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Display Name" required>
                    <input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="Vd: 1.Minhpn" />
                  </Field>
                  <Field label="Họ và tên" required>
                    <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Vd: Nguyễn Văn A" />
                  </Field>
                  <Field label="Email">
                    <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@company.com" />
                  </Field>
                  <Field label="Telegram">
                    <input value={form.telegram_username} onChange={e => setForm({ ...form, telegram_username: e.target.value })} placeholder="@username" />
                  </Field>
                  <Field label="Số điện thoại">
                    <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0901234567" />
                  </Field>
                  <Field label="Ngày sinh">
                    <input type="date" value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })} />
                  </Field>
                  <Field label="Giới tính">
                    <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                      <option value="">-- Chọn --</option>
                      <option value="male">Nam</option>
                      <option value="female">Nữ</option>
                      <option value="other">Khác</option>
                    </select>
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1">Thông tin tổ chức</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Team" required>
                    <input value={form.team} onChange={e => setForm({ ...form, team: e.target.value })} placeholder="Vd: Sales" list="member-team-options" />
                    <datalist id="member-team-options">
                      {teamOptions.map(t => <option key={t} value={t} />)}
                    </datalist>
                  </Field>
                  <Field label="Chức vụ">
                    <input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} placeholder="Vd: Nhân viên" />
                  </Field>
                  <Field label="Phòng ban">
                    <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="Vd: Kinh doanh" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Tên Leader">
                    <input value={form.leader_name} onChange={e => setForm({ ...form, leader_name: e.target.value })} placeholder="Vd: N.V. Thương" />
                  </Field>
                  <Field label="Email Leader">
                    <input type="email" value={form.leader_email} onChange={e => setForm({ ...form, leader_email: e.target.value })} placeholder="leader@company.com" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Liên kết tài khoản đăng nhập" hint="tùy chọn — chỉ để tham chiếu, tạo tài khoản làm ở tab Tài khoản">
                    <SearchableSelect
                      value={form.linked_user_id}
                      onChange={v => setForm({ ...form, linked_user_id: v })}
                      placeholder="-- Chưa liên kết --"
                      options={appUsers.map(u => ({ value: u.id, label: `${u.name || u.email} (${u.email})` }))}
                    />
                  </Field>
                  <Field label="Liên kết tài khoản đăng nhập (phụ)" hint="tùy chọn">
                    <SearchableSelect
                      value={form.linked_user_id_2}
                      onChange={v => setForm({ ...form, linked_user_id_2: v })}
                      placeholder="-- Chưa liên kết --"
                      options={appUsers.map(u => ({ value: u.id, label: `${u.name || u.email} (${u.email})` }))}
                    />
                    {/* Hint dài để dưới select thay vì nhét vô label — nhét
                     * vô label làm label 2 dòng, lệch hàng với ô bên cạnh. */}
                    <p className="text-[10px] text-on-surface-variant font-normal normal-case mt-1">
                      Dùng khi 1 người có 2 email
                    </p>
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant border-b border-outline-variant pb-1">Kỹ năng chuyên môn</h4>
                <Field label="Kinh nghiệm (năm)">
                  <input type="number" min={0} value={form.experience_year} onChange={e => setForm({ ...form, experience_year: e.target.value })} className="max-w-[160px]" />
                </Field>
                {skillsByCategory.length === 0 ? (
                  <p className="text-xs italic text-on-surface-variant">Chưa có kỹ năng nào được khai báo. Thêm kỹ năng ở trang Quản lý danh mục.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {skillsByCategory.map(([category, list]) => (
                      <div key={category} className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase text-on-surface-variant">{category}</p>
                        <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-outline-variant p-2">
                          {list.map(skill => (
                            <label key={skill.id} className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={form.skill_ids.includes(skill.id)}
                                onChange={() => toggleSkill(skill.id)}
                                className="cursor-pointer accent-primary"
                              />
                              {skill.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {modalError && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-medium">{modalError}</div>
              )}
            </form>

            <div className="flex gap-3 px-6 py-4 border-t border-outline-variant bg-surface-container-low shrink-0">
              <button type="button" onClick={() => setModalMode(null)} className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface font-bold py-2 rounded-xl text-xs transition">
                Hủy
              </button>
              <button type="submit" onClick={e => void handleSave(e as unknown as React.FormEvent)} disabled={isSubmitting} className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2 rounded-xl text-xs transition shadow-sm">
                {isSubmitting ? "Đang lưu..." : modalMode === "add" ? "Thêm thành viên" : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]">
          <div style={{ width: "100%", maxWidth: "420px" }} className="bg-surface rounded-xl border border-outline-variant shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-on-surface flex items-center gap-2"><span className="text-xl">⚠️</span> Xác nhận xóa</h3>
              <button onClick={() => setDeleteTarget(null)} className="p-1.5 rounded-lg hover:bg-surface-container-low" disabled={isDeleting}>
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-xs leading-relaxed text-on-surface">
                Bạn có chắc chắn muốn xóa thành viên <span className="font-semibold">{deleteTarget.display_name}</span> không?
              </p>
            </div>
            <div className="px-6 py-4 bg-surface-container-low flex justify-end gap-3 border-t border-outline-variant">
              <button type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-outline-variant hover:bg-surface-container-low text-on-surface rounded-xl text-xs font-semibold transition" disabled={isDeleting}>
                Hủy bỏ
              </button>
              <button type="button" onClick={() => void handleDelete()} disabled={isDeleting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition shadow-sm">
                {isDeleting ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]">
          <div style={{ width: "100%", maxWidth: "480px" }} className="bg-surface rounded-xl border border-outline-variant shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-on-surface">Import danh sách từ Excel</h3>
              <button onClick={() => setImportOpen(false)} className="p-1.5 rounded-lg hover:bg-surface-container-low">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-on-surface-variant leading-relaxed">
                File .xlsx với cột: Display Name, Họ tên, Team, Chức vụ, Phòng ban, Telegram, Email.
                Ghép theo email (nếu có) hoặc Display Name — dòng trùng sẽ được cập nhật, không tạo bản ghi mới.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                disabled={importing}
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }}
                className="w-full text-xs"
              />
              {importing && <p className="text-xs text-on-surface-variant">Đang import...</p>}
              {importSummary && (
                <div className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-low p-3 text-xs">
                  <p>Đã tạo mới: <span className="font-bold text-emerald-600">{importSummary.created}</span></p>
                  <p>Đã cập nhật: <span className="font-bold text-sky-600">{importSummary.updated}</span></p>
                  <p>Bỏ qua: <span className="font-bold text-red-600">{importSummary.skipped.length}</span></p>
                  {importSummary.skipped.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1 pt-2 border-t border-outline-variant">
                      {importSummary.skipped.map((s, i) => (
                        <p key={i} className="text-[11px] text-red-600">Dòng {s.row}: {s.reason}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-surface-container-low flex justify-end border-t border-outline-variant">
              <button type="button" onClick={() => setImportOpen(false)} className="px-4 py-2 border border-outline-variant hover:bg-surface-container-low text-on-surface rounded-xl text-xs font-semibold transition">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase text-on-surface-variant">
        {label} {hint ? <em className="normal-case font-normal">({hint})</em> : null} {required ? <b className="text-error">*</b> : null}
      </span>
      <div
        className={cn(
          "[&>input]:w-full [&>input]:px-3 [&>input]:py-2 [&>input]:bg-surface-container-low [&>input]:border [&>input]:border-outline-variant [&>input]:rounded-xl [&>input]:text-xs",
          "[&>select]:w-full [&>select]:px-3 [&>select]:py-2 [&>select]:bg-surface-container-low [&>select]:border [&>select]:border-outline-variant [&>select]:rounded-xl [&>select]:text-xs [&>select]:cursor-pointer"
        )}
      >
        {children}
      </div>
    </label>
  );
}
