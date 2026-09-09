"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MaterialIcon } from "@/components/ui";
import { useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { useMembers } from "@/hooks/useMembers";
import {
  allPlatformCategoriesService,
  teamsService,
  usersService,
  type AppUserProfile,
  type TeamRow,
} from "@/services/all-platform.service";
import type { Category, CategoryType } from "@/types/unified.types";
import { cn } from "@/lib/utils";
import { TEAM_TYPE_OPTIONS, type TeamType } from "@/lib/teamTypes";
import {
  PlatformStatCard,
  PlatformStatsRow,
} from "@/components/features/shared/PlatformStatCard";
import { ActionMenu } from "@/modules/crm/components/ActionMenu";
import { invalidatePositionOptionsCache } from "@/modules/crm/components/PositionSelect";
import { invalidateCrmCategoryCache } from "@/modules/crm/components/CrmCategorySelect";

// ── TEAM MODAL (Multi-select members, Leader dropdown) ──────────────────────
function TeamModal({ isOpen, onClose, onSave, editing }: { isOpen: boolean; onClose: () => void; onSave: (p: any) => Promise<void>; editing?: any }) {
  const [nameTeam, setNameTeam] = useState("");
  // leaderKey lưu selection key của roster (email nếu đã liên kết, else memberId)
  // — LUÔN duy nhất kể cả người chưa liên kết, để dropdown hiện đủ 140 người và
  // chọn tự do, không chặn ai (chỉ chặn ở bước submit vì backend cần email/id thật).
  const [leaderKey, setLeaderKey] = useState("");
  // Lưu theo memberId (roster) thay vì email trực tiếp — cho phép tích cả người
  // chưa liên kết tài khoản, chỉ resolve sang email thật lúc submit.
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [teamType, setTeamType] = useState<TeamType>("khac");

  const [allUsers, setAllUsers] = useState<AppUserProfile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hiện ĐẦY ĐỦ toàn bộ danh bạ (140 người) — GET /api/all-platform/members —
  // tích tự do không chặn ai. Người chưa liên kết tài khoản vẫn tích được bình
  // thường; lúc lưu sẽ tự lọc ra ai có email thật để gửi lên, phần còn lại chờ
  // họ tự liên kết sau.
  const { members } = useMembers();

  useEffect(() => {
    if (isOpen) {
      // getAllProfiles (không lọc role) — roster cần map linked_user_id sang
      // email bất kể người đó đang là member hay leader trong app_users.
      usersService.getAllProfiles().then(r => r.success && setAllUsers(r.data || []));
    }
  }, [isOpen]);

  const memberRosterEntries = useMemo(() => {
    return members
      .map(m => {
        const linkedUserId = m.linked_user_id || m.linked_user_id_2 || null;
        const user = linkedUserId ? allUsers.find(u => u.id === linkedUserId) : undefined;
        return { memberId: m.id, displayName: m.display_name, email: user?.email || null };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members, allUsers]);

  const leaderKeyOf = (e: (typeof memberRosterEntries)[number]) => e.email || e.memberId;
  const selectedLeaderEntry = memberRosterEntries.find(e => leaderKeyOf(e) === leaderKey);

  useEffect(() => {
    if (editing) {
      setNameTeam(editing.name_team || "");
      setTeamType((editing.team_type as TeamType) || "khac");
      // editing.leader_email là email thật đã lưu trong DB — map ngược sang
      // selection key tương ứng trong roster; nếu không tìm thấy (leader không
      // nằm trong 140 người) fallback dùng thẳng email để không mất lựa chọn.
      const leaderEntry = memberRosterEntries.find(e => e.email === editing.leader_email);
      setLeaderKey(leaderEntry ? leaderKeyOf(leaderEntry) : (editing.leader_email || ""));
      // editing.members là email thật đã lưu trong DB — map ngược sang memberId
      // tương ứng trong roster để tích đúng checkbox.
      const existingEmails = new Set<string>(editing.members || []);
      const matched = memberRosterEntries.filter(e => e.email && existingEmails.has(e.email)).map(e => e.memberId);
      setSelectedMemberIds(matched);
    } else {
      setNameTeam("");
      setTeamType("khac");
      setLeaderKey("");
      setSelectedMemberIds([]);
    }
  }, [editing, isOpen, memberRosterEntries]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameTeam.trim() || !leaderKey || !selectedLeaderEntry) return;
    setIsSubmitting(true);
    try {
      // members (danh bạ) và app_users (tài khoản đăng nhập) là 2 nghiệp vụ
      // độc lập — Leader được chọn tự do từ danh bạ, không cần đã liên kết
      // tài khoản đăng nhập mới lưu được (leader_member_id là nguồn thật).
      const resolvedEmails = selectedMemberIds
        .map(mid => memberRosterEntries.find(m => m.memberId === mid)?.email)
        .filter((email): email is string => Boolean(email));

      await onSave({
        name_team: nameTeam.trim(),
        leader_member_id: selectedLeaderEntry.memberId,
        leader_email: selectedLeaderEntry.email || undefined,
        member_emails: resolvedEmails,
        team_type: teamType,
        isEdit: !!editing
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMember = (memberId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
      <div style={{ width: "100%", maxWidth: "448px" }} className="rounded-xl bg-surface border border-outline-variant shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low shrink-0">
          <h3 className="font-bold text-on-surface">
            {editing ? "Sửa Team" : "Thêm Team"}
          </h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface-variant p-1.5 rounded-lg hover:bg-surface-container-low">
            <MaterialIcon name="close" className="text-xl" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
              Tên Team {editing ? "(không đổi)" : "*"}
            </label>
            <input
              type="text"
              value={nameTeam}
              onChange={(e) => setNameTeam(e.target.value)}
              disabled={!!editing}
              placeholder="Vd: Growth Team"
              className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
              Loại team
            </label>
            <select
              value={teamType}
              onChange={(e) => setTeamType(e.target.value as TeamType)}
              className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition cursor-pointer"
            >
              {TEAM_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
              Trưởng nhóm (Leader) {editing ? "(không đổi)" : "*"}
            </label>
            <select
              value={leaderKey}
              onChange={(e) => setLeaderKey(e.target.value)}
              disabled={!!editing}
              className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition cursor-pointer disabled:opacity-50"
            >
              <option value="">-- Chọn Leader --</option>
              {memberRosterEntries.map(e => (
                <option key={leaderKeyOf(e)} value={leaderKeyOf(e)}>
                  {e.email ? `${e.displayName} (${e.email})` : e.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Thành viên (Members)</label>
            <div className="border border-outline-variant rounded-xl max-h-48 overflow-y-auto bg-surface-container-low p-2 space-y-1">
              {memberRosterEntries.length === 0 ? (
                <div className="text-xs text-center p-2 text-on-surface-variant">Đang tải tài khoản...</div>
              ) : (
                memberRosterEntries.map(e => {
                  const selected = selectedMemberIds.includes(e.memberId);
                  return (
                    <div
                      key={e.memberId}
                      onClick={() => toggleMember(e.memberId)}
                      className={cn("flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs transition border", selected ? "bg-primary/10 border-primary/30" : "bg-surface border-transparent hover:border-outline-variant")}
                    >
                      <input type="checkbox" checked={selected} readOnly className="cursor-pointer accent-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-on-surface truncate">{e.displayName}</div>
                        <div className="text-on-surface-variant text-[10px] truncate">{e.email || "Chưa liên kết tài khoản"}</div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="text-[10px] text-on-surface-variant mt-1 text-right font-medium">Đã chọn: {selectedMemberIds.length} người</div>
          </div>

          <div className="flex gap-3 pt-3 border-t border-outline-variant shrink-0">
            <button type="button" onClick={onClose} className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface font-bold py-2 rounded-xl text-xs transition">
              Hủy bỏ
            </button>
            <button type="submit" disabled={isSubmitting || !nameTeam.trim() || !leaderKey} className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2 rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
              {isSubmitting ? "Đang lưu..." : (editing ? "Lưu thay đổi" : "Thêm mới")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CategoryMeta {
  key: CategoryType;
  label: string;
  emoji: string;
  description: string;
  placeholderValue: string;
  placeholderName: string;
  valueKey: string;
  nameKey: string;
  valueLabel: string;
  nameLabel: string;
}

const CATEGORIES_METADATA: CategoryMeta[] = [
  {
    key: "intent",
    label: "Lĩnh vực",
    emoji: "🏷️",
    description: "Mục đích cào dữ liệu của nhóm (Facebook synced với Google Sheet Intents, LinkedIn forward qua n8n).",
    placeholderValue: "Vd: KOL_INFLUENCER",
    placeholderName: "Vd: Cá nhân có sức ảnh hưởng lớn",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "Mã (code)",
    nameLabel: "Tên mô tả (name)",
  },
  {
    key: "industry",
    label: "Ngành (Industry)",
    emoji: "📂",
    description: "Các lĩnh vực hoạt động của nhóm (vd: Công Nghệ, Marketing).",
    placeholderValue: "Vd: IT",
    placeholderName: "Vd: Information Technology",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "Mã ngành (code)",
    nameLabel: "Tên ngành (name)",
  },
  {
    key: "tier",
    label: "Tier",
    emoji: "🔥",
    description: "Độ ưu tiên theo dõi và tương tác của nhóm.",
    placeholderValue: "Vd: 1",
    placeholderName: "Vd: High Priority",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "Mã cấp độ (code)",
    nameLabel: "Tên cấp độ (name)",
  },
  {
    key: "team",
    label: "Team",
    emoji: "👥",
    description: "Các bộ phận phụ trách khai thác nhóm (vd: Sales, Marketing).",
    placeholderValue: "Vd: Growth Team",
    placeholderName: "Vd: Nguyễn Văn A",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "Tên Team (team_name)",
    nameLabel: "Trưởng nhóm (leader)",
  },
  {
    key: "icp",
    label: "ICP Target",
    emoji: "🎯",
    description: "Chân dung khách hàng mục tiêu trong nhóm.",
    placeholderValue: "Vd: Founder / CEO",
    placeholderName: "Vd: US/UK",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "Đối tượng (target)",
    nameLabel: "Khu vực (geo)",
  },
  {
    key: "content_type",
    label: "Loại nội dung",
    emoji: "📄",
    description: "Phân loại nội dung thường xuyên đăng tải (vd: Bài viết, Video).",
    placeholderValue: "Vd: VIDEO",
    placeholderName: "Vd: Video Ngắn",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "Mã loại (code)",
    nameLabel: "Tên hiển thị (name)",
  },
  {
    key: "product_seeding",
    label: "Sản phẩm Seeding",
    emoji: "📦",
    description: "Sản phẩm hoặc dịch vụ dùng để seeding trong nhóm.",
    placeholderValue: "Vd: CRM",
    placeholderName: "Vd: Phần mềm CRM",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "Mã sản phẩm (code)",
    nameLabel: "Tên sản phẩm (name)",
  },
  {
    // Tab gộp 3 danh mục dùng trong form "Thêm deal" CRM (Nguồn, Danh mục sản
    // phẩm, Gói) — cho leader tự thêm/sửa/xóa thay vì hardcode cứng trong code.
    // Dùng "crm_source" làm key đại diện cho cả tab (xem CrmCategorySections).
    key: "crm_source",
    label: "Danh mục CRM",
    emoji: "🧾",
    description: "Nguồn, Danh mục sản phẩm và Gói dùng trong form Thêm deal CRM.",
    placeholderValue: "",
    placeholderName: "",
    valueKey: "code",
    nameKey: "name",
    valueLabel: "",
    nameLabel: "",
  },
];

const CRM_TAB_KEY: CategoryType = "crm_source";
const CRM_SECTIONS: Array<{ key: CategoryType; label: string; description: string; placeholderCode: string; placeholderName: string }> = [
  {
    key: "crm_industry",
    label: "Lĩnh vực",
    description: "Lĩnh vực kinh doanh của khách hàng trong deal (vd: Bất động sản, Thời trang...).",
    placeholderCode: "Vd: Bat_dong_san",
    placeholderName: "Vd: Kinh doanh bất động sản",
  },
  {
    key: "crm_source",
    label: "Nguồn",
    description: "Nguồn phát sinh deal (vd: FB Inbox, Zalo, Giới thiệu...).",
    placeholderCode: "Vd: Zalo_Ads",
    placeholderName: "Vd: Zalo Ads",
  },
  {
    key: "crm_service_package",
    label: "Danh mục sản phẩm",
    description: "Sản phẩm / dịch vụ chào bán trong deal (vd: Làm Web, Markee CRM...).",
    placeholderCode: "Vd: Landing_Page",
    placeholderName: "Vd: Landing Page",
  },
  {
    key: "crm_package",
    label: "Gói",
    description: "Gói dịch vụ CRM bán cho khách (vd: Gói cơ bản, Gói nâng cao...).",
    placeholderCode: "Vd: Goi_vip",
    placeholderName: "Vd: Gói VIP",
  },
  {
    key: "crm_position",
    label: "Chức vụ",
    description: "Chức vụ của người liên hệ trong deal/khách hàng (vd: Giám đốc, Trưởng phòng Marketing...). Mục này dùng NGỪNG DÙNG thay vì xóa — bản ghi cũ đã chọn 1 chức vụ vẫn hiển thị đúng kể cả sau khi ngừng dùng.",
    placeholderCode: "Vd: Truong_phong_Kinh_doanh",
    placeholderName: "Vd: Trưởng phòng Kinh doanh",
  },
  {
    // migration 080 — dropdown "SDR/Sale cần làm gì tiếp" trong drawer
    // "Xác minh Lead" (LeadDetailDrawer.tsx). Nhãn của mục được chọn lưu
    // thẳng vào crm_leads.next_step (cột TEXT đã có), không thêm cột mới.
    key: "crm_next_step",
    label: "Việc tiếp theo",
    description: "Việc SDR/Sale cần làm tiếp sau khi xác minh Lead (vd: Gọi lại, Gửi báo giá...).",
    placeholderCode: "Vd: Gui_bao_gia",
    placeholderName: "Vd: Gửi báo giá",
  },
  {
    // Category type MOI, RIENG (khong dung chung voi crm_industry) - "Loại
    // báo giá" phan loai GIAI PHAP/DICH VU dang chao trong 1 bao gia (multi-
    // select tren Quote Workspace), khac hoan toan "Lĩnh vực" (nganh nghe
    // khach hang). Dung dung 1 co che categories generic da co san, KHONG
    // tao bang/man quan tri rieng - chi them 1 category_type moi.
    key: "crm_quote_type",
    label: "Loại báo giá",
    description: "Loại giải pháp/dịch vụ đang chào trong báo giá (vd: Thiết kế website, Hạ tầng/VPS/Cloud...) — độc lập với Lĩnh vực (ngành nghề khách hàng).",
    placeholderCode: "Vd: Thiet_ke_website",
    placeholderName: "Vd: Thiết kế website",
  },
];

// Chỉ category_type='crm_position'/'crm_quote_type' dùng NGỪNG DÙNG
// (is_active=false) thay vì xóa cứng — Loại báo giá đã gắn vào báo giá cũ
// (quotes.quote_type_codes lưu THEO CODE) không được xóa cứng, khớp yêu cầu
// "Không xóa cứng loại đã được báo giá sử dụng". 3 mục kia (Lĩnh vực/Nguồn/
// Danh mục sản phẩm/Gói) giữ nguyên hành vi xóa cứng đã có từ trước (ngoài
// phạm vi task này, xem migration 079).
const DEACTIVATABLE_SECTIONS = new Set<CategoryType>(["crm_position", "crm_quote_type"]);

function CrmCategorySections({
  categories,
  onChanged,
  isLoading,
  errorMsg,
}: {
  categories: Record<string, Category[]>;
  onChanged: () => Promise<void>;
  isLoading: boolean;
  errorMsg: string | null;
}) {
  const [activeSection, setActiveSection] = useState<CategoryType>(CRM_SECTIONS[0].key);
  const [searchTerm, setSearchTerm] = useState("");
  const [modal, setModal] = useState<{
    sectionKey: CategoryType;
    mode: "add" | "edit";
    id?: string;
    code: string;
    name: string;
  } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ sectionKey: CategoryType; item: Category } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeMeta = CRM_SECTIONS.find(s => s.key === activeSection)!;
  const sectionItems = categories[activeSection] || [];
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return sectionItems;
    const term = searchTerm.trim().toLowerCase();
    return sectionItems.filter(
      item => item.code.toLowerCase().includes(term) || (item.name || "").toLowerCase().includes(term)
    );
  }, [sectionItems, searchTerm]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    const code = modal.code.trim();
    const name = modal.name.trim();
    if (!code || !name) {
      setModalError("Vui lòng nhập đầy đủ Mã và Tên hiển thị.");
      return;
    }
    setIsSubmitting(true);
    setModalError(null);
    try {
      const res =
        modal.mode === "add"
          ? await allPlatformCategoriesService.add({ category_type: modal.sectionKey, code, name, platform: "all" })
          : await allPlatformCategoriesService.update({ id: modal.id!, category_type: modal.sectionKey, code, name });
      if (!res.success) {
        setModalError(res.message || "Lưu thất bại. Vui lòng thử lại.");
        return;
      }
      if (modal.sectionKey === "crm_position") invalidatePositionOptionsCache();
      // Combobox danh muc CRM dung chung (vd "Viec tiep theo") cache theo
      // category_type — xoa cache cua dung muc vua sua de moi dropdown dang
      // mo load lai ngay, khong can reload trang.
      invalidateCrmCategoryCache(modal.sectionKey);
      setModal(null);
      await onChanged();
    } catch {
      setModalError("Lỗi hệ thống khi gửi yêu cầu.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      // "Chức vụ" (crm_position) không xóa cứng — bản ghi cũ (deal/khách hàng/
      // contact) đã lưu category này vẫn phải hiển thị đúng tên qua
      // position_label_snapshot ngay cả sau khi mục này ngừng dùng, nên chỉ
      // toggle is_active thay vì DELETE (xem migration 079).
      const isDeactivatable = DEACTIVATABLE_SECTIONS.has(deleteTarget.sectionKey);
      const nextActive = isDeactivatable ? deleteTarget.item.is_active === false : undefined;
      const res = isDeactivatable
        ? await allPlatformCategoriesService.update({ id: deleteTarget.item.id, is_active: nextActive })
        : await allPlatformCategoriesService.delete(deleteTarget.item.id);
      if (res.success) {
        if (isDeactivatable) invalidatePositionOptionsCache();
        invalidateCrmCategoryCache(deleteTarget.sectionKey);
        setDeleteTarget(null);
        await onChanged();
      } else {
        alert(res.message || "Lỗi khi thực hiện");
      }
    } catch {
      alert("Lỗi kết nối khi thực hiện");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div>
      {/* ── 4 TABS: Lĩnh vực / Nguồn / Danh mục sản phẩm / Gói ── */}
      <div className="crm-page-tabs">
        {CRM_SECTIONS.map(section => {
          const count = categories[section.key]?.length || 0;
          const isActive = activeSection === section.key;
          return (
            <button
              key={section.key}
              type="button"
              onClick={() => {
                setActiveSection(section.key);
                setSearchTerm("");
              }}
              className={cn("crm-page-tab", isActive && "crm-page-tab--active")}
            >
              {section.label}
              <span className="crm-page-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── TOOLBAR: search + "+ Thêm danh mục" ── */}
      <div className="crm-toolbar">
        <div className="crm-toolbar-filters">
          <div className="crm-toolbar-search">
            <MaterialIcon name="search" className="text-[20px]" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={`Tìm theo tên hoặc mã trong "${activeMeta.label}"...`}
              className="crm-input"
            />
          </div>
        </div>
        <div className="crm-toolbar-actions">
          <button
            type="button"
            onClick={() => {
              setModal({ sectionKey: activeSection, mode: "add", code: "", name: "" });
              setModalError(null);
            }}
            className="crm-primary-button crm-primary-button--compact"
          >
            Thêm danh mục
          </button>
        </div>
      </div>
      <p className="crm-toolbar-hint" style={{ marginTop: "-0.4rem", marginBottom: "0.9rem" }}>
        {activeMeta.description}
      </p>

      {/* ── TABLE ── */}
      <div className="crm-table-card">
        <div className="crm-table-scroll">
          <table className="crm-table" style={{ tableLayout: "auto" }}>
            <thead>
              <tr>
                <th className="crm-th">Tên</th>
                <th className="crm-th">Mã</th>
                <th className="crm-th crm-th--right" style={{ width: "7rem" }}>
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="crm-td" style={{ padding: "2.5rem 0", textAlign: "center" }}>
                    <span className="crm-muted">Đang tải danh sách...</span>
                  </td>
                </tr>
              ) : errorMsg ? (
                <tr>
                  <td colSpan={3} className="crm-td" style={{ padding: "2.5rem 0", textAlign: "center" }}>
                    <span className="crm-error">{errorMsg}</span>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="crm-empty-state">
                      <span className="crm-empty-state-icon">
                        <MaterialIcon name="inbox" />
                      </span>
                      <p className="crm-empty-state-title">
                        {searchTerm.trim() ? "Không tìm thấy danh mục phù hợp" : `Chưa có "${activeMeta.label}" nào`}
                      </p>
                      <p className="crm-empty-state-desc">
                        {searchTerm.trim()
                          ? "Thử tìm với từ khóa khác hoặc xóa bộ lọc tìm kiếm."
                          : `Bấm "Thêm danh mục" để tạo mục ${activeMeta.label.toLowerCase()} đầu tiên.`}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const isDeactivatable = DEACTIVATABLE_SECTIONS.has(activeSection);
                  const isInactive = isDeactivatable && item.is_active === false;
                  return (
                  <tr key={item.id} className="crm-row">
                    <td className="crm-td">
                      <span className="crm-customer-name crm-truncate" title={item.name}>{item.name}</span>
                      {isInactive ? <span className="crm-badge crm-badge--neutral" style={{ marginLeft: "0.5rem" }}>Đã ngừng dùng</span> : null}
                    </td>
                    <td className="crm-td">
                      <span className="crm-truncate crm-mono-code" title={item.code}>{item.code}</span>
                    </td>
                    <td className="crm-td crm-td--right">
                      <div className="crm-icon-action-group">
                        <ActionMenu
                          items={[
                            {
                              key: "edit",
                              label: "Sửa",
                              onSelect: () => {
                                setModal({ sectionKey: activeSection, mode: "edit", id: item.id, code: item.code, name: item.name || "" });
                                setModalError(null);
                              },
                            },
                            isDeactivatable
                              ? {
                                  key: "toggle-active",
                                  label: isInactive ? "Kích hoạt lại" : "Ngừng dùng",
                                  danger: !isInactive,
                                  onSelect: () => setDeleteTarget({ sectionKey: activeSection, item }),
                                }
                              : {
                                  key: "delete",
                                  label: "Xóa",
                                  danger: true,
                                  onSelect: () => setDeleteTarget({ sectionKey: activeSection, item }),
                                },
                          ]}
                        />
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

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div
            style={{ width: "100%", maxWidth: "420px" }}
            className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-4">
              <h3 className="font-bold text-on-surface">
                {modal.mode === "add" ? "Thêm" : "Sửa"} {CRM_SECTIONS.find(s => s.key === modal.sectionKey)?.label}
              </h3>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-low"
                aria-label="Đóng"
              >
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <form onSubmit={e => void handleSave(e)} className="space-y-4 p-6">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-on-surface-variant">
                  Mã (code) <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  placeholder={CRM_SECTIONS.find(s => s.key === modal.sectionKey)?.placeholderCode}
                  value={modal.code}
                  onChange={e => setModal({ ...modal, code: e.target.value })}
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2 text-xs text-on-surface outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-on-surface-variant">
                  Tên hiển thị (name) <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  placeholder={CRM_SECTIONS.find(s => s.key === modal.sectionKey)?.placeholderName}
                  value={modal.name}
                  onChange={e => setModal({ ...modal, name: e.target.value })}
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2 text-xs text-on-surface outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                />
              </div>
              {modalError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-600">{modalError}</div>
              )}
              <div className="flex gap-3 border-t border-outline-variant pt-3">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="flex-1 rounded-xl border border-outline-variant py-2 text-xs font-bold text-on-surface transition hover:bg-surface-container-low"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-white shadow-sm transition hover:bg-on-primary-fixed-variant"
                >
                  {isSubmitting && <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  {modal.mode === "add" ? "Thêm mới" : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (() => {
        const isDeactivatable = DEACTIVATABLE_SECTIONS.has(deleteTarget.sectionKey);
        const isCurrentlyActive = deleteTarget.item.is_active !== false;
        const isReactivate = isDeactivatable && !isCurrentlyActive;
        const title = isDeactivatable ? (isReactivate ? "Xác nhận kích hoạt lại" : "Xác nhận ngừng dùng") : "Xác nhận xóa";
        const actionLabel = isDeactivatable ? (isReactivate ? "Kích hoạt lại" : "Ngừng dùng") : "Xác nhận xóa";
        const busyLabel = isDeactivatable ? "Đang lưu..." : "Đang xóa...";
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div style={{ width: "100%", maxWidth: "420px" }} className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-4">
              <h3 className="flex items-center gap-2 font-bold text-on-surface">
                <span className="text-xl">⚠️</span> {title}
              </h3>
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-low"
                disabled={isDeleting}
              >
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-xs leading-relaxed text-on-surface">
                Bạn có chắc chắn muốn {isDeactivatable ? (isReactivate ? "kích hoạt lại" : "ngừng dùng") : "xóa"}{" "}
                <span className="font-semibold">
                  {deleteTarget.item.name} ({deleteTarget.item.code})
                </span>{" "}
                khỏi danh mục &quot;{CRM_SECTIONS.find(s => s.key === deleteTarget.sectionKey)?.label}&quot; không?
              </p>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-medium leading-relaxed text-amber-800">
                {isDeactivatable ? (
                  isReactivate
                    ? "⚠️ Mục này sẽ xuất hiện lại trong ô chọn Chức vụ cho các lựa chọn MỚI."
                    : "⚠️ Các bản ghi đã chọn Chức vụ này vẫn giữ nguyên hiển thị đúng tên cũ, nhưng mục này sẽ KHÔNG còn xuất hiện trong ô chọn Chức vụ cho các lựa chọn mới."
                ) : (
                  <>
                    ⚠️ Nếu mã &quot;{deleteTarget.item.code}&quot; đang được dùng ở khách hàng/deal hiện có, các bản ghi đó vẫn giữ
                    nguyên giá trị cũ nhưng sẽ không còn chọn lại được mã này trong form thêm/sửa deal. Hành động này
                    không thể hoàn tác.
                  </>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-outline-variant bg-surface-container-low px-6 py-4">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="crm-cancel-button"
                disabled={isDeleting}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
              >
                {isDeleting ? busyLabel : actionLabel}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

export function CategoryManagementContent({
  crmOnly = false,
  excludeCrm = false,
}: { crmOnly?: boolean; excludeCrm?: boolean } = {}) {
  const { platform } = useAppPlatform();
  const router = useRouter();
  const queryClient = useQueryClient();

  // State quản lý danh mục
  const [categories, setCategories] = useState<Record<string, Category[]>>({
    intent: [],
    industry: [],
    tier: [],
    team: [],
    icp: [],
    content_type: [],
    product_seeding: [],
    crm_source: [],
    crm_service_package: [],
    crm_package: [],
    crm_industry: [],
    crm_position: [],
    crm_next_step: [],
    crm_quote_type: [],
  });

  const [selectedTab, setSelectedTab] = useState<CategoryType>(crmOnly ? CRM_TAB_KEY : "intent");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentMetadata = useMemo(() => {
    return CATEGORIES_METADATA.find((m) => m.key === selectedTab)!;
  }, [selectedTab]);
  const visibleMetadata = useMemo(() => {
    if (crmOnly) return CATEGORIES_METADATA.filter((meta) => meta.key === CRM_TAB_KEY);
    if (excludeCrm) return CATEGORIES_METADATA.filter((meta) => meta.key !== CRM_TAB_KEY);
    return CATEGORIES_METADATA;
  }, [crmOnly, excludeCrm]);

  // Neu tab CRM dang chon nhung bi loai (excludeCrm) - chuyen ve tab dau tien
  // con lai, tranh render trang trong/lech voi danh sach tab hien thi.
  useEffect(() => {
    if (excludeCrm && selectedTab === CRM_TAB_KEY && visibleMetadata.length) {
      setSelectedTab(visibleMetadata[0].key);
    }
  }, [excludeCrm, selectedTab, visibleMetadata]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [modalId, setModalId] = useState("");
  const [modalValue, setModalValue] = useState("");
  const [modalName, setModalName] = useState("");
  const [modalPlatform, setModalPlatform] = useState<string>("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Modal Delete State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isAllowedPlatform = platform === "general";

  // Redirect if not General
  useEffect(() => {
    if (!isAllowedPlatform) {
      router.replace("/");
    }
  }, [platform, router, isAllowedPlatform]);

  // Fetch categories from backend (Supabase categories table)
  const fetchCategories = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [catRes, teamRes] = await Promise.all([
        allPlatformCategoriesService.getAll(),
        teamsService.getAll()
      ]);
      const list = catRes?.data ?? [];
      const teamsList = teamRes?.data ?? [];

      const grouped: Record<string, any[]> = {
        intent: [],
        industry: [],
        tier: [],
        team: [],
        icp: [],
        content_type: [],
        product_seeding: [],
        crm_source: [],
        crm_service_package: [],
        crm_package: [],
        crm_industry: [],
        crm_position: [],
        crm_next_step: [],
        crm_quote_type: [],
      };

      list.forEach((item) => {
        if (grouped[item.category_type]) {
          grouped[item.category_type].push(item);
        }
      });

      // Backend trả enriched teams với leader_email + members array
      const teamMap = new Map<string, any>();
      teamsList.forEach((t: any) => {
        const key = `${t.name_team}_${t.id_leader}`;
        if (!teamMap.has(key)) {
          teamMap.set(key, {
            id: t.id || key,
            category_type: "team",
            code: t.name_team,
            name: t.leader_email || "",
            platform: "general",
            members: Array.isArray(t.members) ? t.members.map((m: any) => typeof m === "string" ? m : m.email).filter(Boolean) : [],
            number_of_member: t.number_of_member || 0,
            team_type: t.team_type || "khac",
          });
        }
      });
      grouped.team = Array.from(teamMap.values());

      setCategories(grouped);
    } catch (err) {
      console.error("Lỗi khi tải danh mục:", err);
      setErrorMsg("Không thể tải danh sách danh mục từ máy chủ. Vui lòng thử lại sau.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAllowedPlatform) {
      void fetchCategories();
    }
  }, [platform, isAllowedPlatform]);

  const filteredOptions = useMemo(() => {
    const options = categories[selectedTab] || [];
    if (!searchTerm.trim()) return options;
    const term = searchTerm.toLowerCase();
    const { valueKey, nameKey } = currentMetadata;
    return options.filter((opt: any) => {
      const val = String(opt[valueKey] || "").toLowerCase();
      const name = String(opt[nameKey] || "").toLowerCase();
      return val.includes(term) || name.includes(term);
    });
  }, [categories, selectedTab, searchTerm, currentMetadata]);

  // Tính thống kê ở top
  const totalOptionsCount = useMemo(() => {
    return Object.values(categories).reduce((sum, list) => sum + list.length, 0);
  }, [categories]);

  // Hành động Add / Edit
  const handleOpenAddModal = () => {
    setModalMode("add");
    setModalId("");
    setModalValue("");
    setModalName("");
    setModalPlatform("all");
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: Category) => {
    setModalMode("edit");
    setModalId(item.id);
    const { valueKey, nameKey } = currentMetadata;
    setModalValue((item as any)[valueKey] || "");
    setModalName((item as any)[nameKey] || "");
    setModalPlatform(item.platform || "all");
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = modalValue.trim();
    const name = modalName.trim();

    if (!val || !name) {
      setModalError(`Vui lòng nhập đầy đủ ${currentMetadata.valueLabel} và ${currentMetadata.nameLabel}.`);
      return;
    }

    // Validate Value format
    if (modalMode === "add" && (selectedTab === "intent" || selectedTab === "industry" || selectedTab === "tier")) {
      if (!/^[a-zA-Z0-9_\-\s\/.]+$/.test(val)) {
        setModalError("Giá trị chỉ chứa ký tự chữ, số, khoảng trắng, gạch ngang (-), gạch dưới (_) hoặc dấu gạch chéo (/).");
        return;
      }
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      if (modalMode === "add") {
        const res = await allPlatformCategoriesService.add({
          category_type: selectedTab,
          code: val,
          name: name,
          platform: modalPlatform,
        });
        if (res.success) {
          setIsModalOpen(false);
          await fetchCategories();
        } else {
          setModalError(res.message || "Thêm mới thất bại. Vui lòng kiểm tra lại.");
        }
      } else {
        const res = await allPlatformCategoriesService.update({
          id: modalId,
          category_type: selectedTab,
          code: val,
          name: name,
          platform: modalPlatform,
        } as any);
        if (res.success) {
          setIsModalOpen(false);
          await fetchCategories();
          queryClient.invalidateQueries({ queryKey: ["categories"] });
        } else {
          setModalError(res.message || "Cập nhật thất bại. Vui lòng thử lại.");
        }
      }
    } catch (err) {
      console.error("Lỗi khi lưu danh mục:", err);
      setModalError("Lỗi hệ thống khi gửi yêu cầu. Vui lòng thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveTeam = async (payload: any) => {
    if (payload.isEdit) {
      await teamsService.update(payload);
    } else {
      await teamsService.create(payload);
    }
    await fetchCategories();
  };

  const handleDeleteClick = (item: Category) => {
    setCategoryToDelete(item);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!categoryToDelete) return;
    setIsDeleting(true);
    try {
      if (selectedTab === "team") {
        const res = await teamsService.delete(categoryToDelete.code, categoryToDelete.name || "", categoryToDelete.id);
        if (res.success) {
          await fetchCategories();
          setDeleteModalOpen(false);
          setCategoryToDelete(null);
        } else {
          alert(res.message || "Lỗi khi xóa team");
        }
      } else {
        const res = await allPlatformCategoriesService.delete(categoryToDelete.id);
        if (res.success) {
          await fetchCategories();
          setDeleteModalOpen(false);
          setCategoryToDelete(null);
          queryClient.invalidateQueries({ queryKey: ["categories"] });
        } else {
          alert(res.message || "Lỗi khi xóa danh mục");
        }
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi kết nối khi xóa");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isAllowedPlatform) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-md">
        <div className="border-primary h-10 w-10 animate-spin rounded-full border-2 border-t-transparent" />
        <p className="text-body-md font-medium text-on-surface-variant">
          Đang chuyển hướng về trang chủ…
        </p>
      </div>
    );
  }

  const getPlatformName = (pf?: string) => {
    if (!pf || pf === "all") return "Tổng hợp";
    if (pf === "facebook") return "Facebook";
    if (pf === "linkedin") return "LinkedIn";
    return pf;
  };

  // Trang "Danh mục CRM" (crmOnly) đã được thiết kế lại thành 4 tab +
  // bảng gọn (Part 3) — topbar đã hiện tên trang nên KHÔNG lặp lại hero
  // header/description/KPI/"Supabase DB" ở đây nữa. Trang chung
  // "Quản lý danh mục" (excludeCrm, /all-platform/quan-ly-danh-muc) cũng
  // không cần lặp lại tiêu đề topbar — chỉ giữ lại KPI + tab-selector
  // vốn có, hữu ích cho use case đó.
  return (
    <div className="w-full min-w-0 space-y-6 font-sans">
      {!crmOnly && (
        <>
          {/* ── STATS ROW ───────────────────────────────────────── */}
          <PlatformStatsRow>
            <PlatformStatCard
              label="Tổng loại danh mục"
              value={5}
              hint="Type, Industry, Tier, Team, ICP"
              accent="primary"
            />
            <PlatformStatCard
              label="Tổng số tùy chọn"
              value={totalOptionsCount}
              hint="Đã cấu hình trên toàn hệ thống"
              accent="success"
            />
            <PlatformStatCard
              label="Tùy chọn hiện tại"
              value={categories[selectedTab]?.length || 0}
              hint={`Trong mục "${currentMetadata.label}"`}
              accent="warning"
            />
            <PlatformStatCard
              label="Kênh đồng bộ"
              value="Supabase DB"
              hint="Đồng bộ trực tiếp qua categories hệ thống"
              accent="primary"
            />
          </PlatformStatsRow>
        </>
      )}

      {/* ── TABS SELECTOR (chỉ dùng cho trang chung, không phải CRM) ── */}
      {!crmOnly && (
      <div className="border-b border-outline-variant overflow-x-auto whitespace-nowrap">
        <div className="flex gap-8 px-2">
          {visibleMetadata.map((meta) => {
            const isActive = selectedTab === meta.key;
            const count =
              meta.key === CRM_TAB_KEY
                ? CRM_SECTIONS.reduce((sum, section) => sum + (categories[section.key]?.length || 0), 0)
                : categories[meta.key]?.length || 0;
            return (
              <button
                key={meta.key}
                type="button"
                onClick={() => {
                  setSelectedTab(meta.key);
                  setSearchTerm("");
                }}
                className={cn(
                  "py-4 text-xs font-bold border-b-2 transition-all uppercase cursor-pointer flex items-center gap-1.5",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-primary",
                )}
              >
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-[9px] font-black",
                  isActive ? "bg-primary/10 text-primary" : "bg-surface-container-low text-on-surface-variant"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* ── MAIN CRUD CARD ──────────────────────────────────── */}
      {crmOnly || selectedTab === CRM_TAB_KEY ? (
        <CrmCategorySections
          categories={categories}
          onChanged={fetchCategories}
          isLoading={isLoading}
          errorMsg={errorMsg}
        />
      ) : (
      <div className="rounded-xl border border-outline-variant bg-surface p-6 shadow-sm space-y-6">
        {/* Description box */}
        <div className="bg-surface-container-low border border-outline-variant rounded-xl px-4 py-2.5 flex items-center gap-2">
          <MaterialIcon name="info" className="text-primary" />
          <p className="text-on-surface-variant text-xs font-medium leading-normal">
            {currentMetadata.description}
          </p>
        </div>

        {/* Filter & Action bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="relative w-full sm:max-w-[280px] flex items-center">
            <span className="material-symbols-outlined absolute left-3 text-on-surface-variant text-[20px] pointer-events-none select-none">
              search
            </span>
            <input
              type="text"
              placeholder={`Tìm kiếm ${currentMetadata.label.toLowerCase()}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
            />
          </div>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition active:scale-95 shadow-sm cursor-pointer"
          >
            <MaterialIcon name="add" className="text-base" />
            Thêm tùy chọn
          </button>
        </div>

        {/* Table representation */}
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
              <tr>
                <th className="py-3 px-4">{currentMetadata.valueLabel}</th>
                <th className="py-3 px-4">{currentMetadata.nameLabel}</th>
                <th className="py-3 px-4">Nền tảng</th>
                <th className="py-3 px-4 text-center">Hành động</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-outline-variant text-on-surface-variant">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-on-surface-variant">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải danh sách danh mục...</span>
                    </div>
                  </td>
                </tr>
              ) : errorMsg ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-red-600 font-medium">
                    {errorMsg}
                  </td>
                </tr>
              ) : filteredOptions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-on-surface-variant italic">
                    Chưa có tùy chọn nào. Bấm nút "Thêm tùy chọn" để đăng ký mới.
                  </td>
                </tr>
              ) : (
                filteredOptions.map((item: Category) => {
                  const { valueKey, nameKey } = currentMetadata;
                  const itemVal = (item as any)[valueKey] || "";
                  const itemName = (item as any)[nameKey] || "";
                  return (
                    <tr key={item.id} className="hover:bg-surface-container-low transition">
                      <td className="py-3.5 px-4 font-mono text-[11px] font-semibold text-on-surface">
                        {itemVal}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-on-surface">
                        {itemName}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase",
                          !item.platform || item.platform === "all"
                            ? "bg-surface-container-low text-on-surface-variant border-outline-variant"
                            : item.platform === "facebook"
                            ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                            : "bg-sky-50 text-sky-700 border-sky-100"
                        )}>
                          {getPlatformName(item.platform)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(item)}
                            className="p-1.5 text-on-surface-variant hover:bg-surface-container-low rounded-lg transition cursor-pointer"
                            title="Sửa"
                          >
                            <MaterialIcon name="edit" className="text-base" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(item)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                            title="Xóa"
                          >
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
      )}

      {/* ── DIALOG / MODAL FORM ──────────────────────────────── */}
      {isModalOpen && selectedTab === "team" && (
        <TeamModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveTeam}
          editing={modalMode === "edit" ? { name_team: modalValue, leader_email: modalName, members: (categories.team.find(t => t.id === modalId) as any)?.members, team_type: (categories.team.find(t => t.id === modalId) as any)?.team_type } : undefined}
        />
      )}

      {isModalOpen && selectedTab !== "team" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div
            style={{ width: "100%", maxWidth: "448px" }}
            className="bg-surface rounded-xl border border-outline-variant shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
              <h3 className="font-bold text-on-surface">
                {modalMode === "add" ? `Thêm ${currentMetadata.label}` : `Sửa ${currentMetadata.label}`}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface-variant transition-colors p-1.5 rounded-lg hover:bg-surface-container-low"
                aria-label="Đóng"
              >
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveCategory(e)} className="p-6 space-y-4">
              {/* Platform dropdown */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                  Nền tảng (Platform) <span className="text-error">*</span>
                </label>
                <select
                  value={modalPlatform}
                  onChange={(e) => setModalPlatform(e.target.value)}
                  className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition cursor-pointer"
                >
                  <option value="all">Tổng hợp (Cả hai)</option>
                  <option value="facebook">Facebook</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
              </div>

              {/* Value / Key Input */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                  {currentMetadata.valueLabel} <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  placeholder={currentMetadata.placeholderValue}
                  value={modalValue}
                  onChange={(e) => setModalValue(e.target.value)}
                  disabled={modalMode === "edit"}
                  className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {modalMode === "add" && (selectedTab === "intent" || selectedTab === "industry" || selectedTab === "tier") && (
                  <p className="text-[9px] text-on-surface-variant mt-1 italic">
                    Gồm chữ cái viết liền, số, dấu gạch ngang (-), gạch dưới (_) hoặc gạch chéo (/).
                  </p>
                )}
              </div>

              {/* Name / Display label Input */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                  {currentMetadata.nameLabel} <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  placeholder={currentMetadata.placeholderName}
                  value={modalName}
                  onChange={(e) => setModalName(e.target.value)}
                  className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  autoFocus
                />
              </div>

              {modalError && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-xs font-medium">
                  {modalError}
                </div>
              )}

              {/* Footer controls */}
              <div className="flex gap-3 pt-3 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface font-bold py-2 rounded-xl text-xs transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2 rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting && (
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {modalMode === "add" ? "Thêm mới" : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div
            style={{ width: "100%", maxWidth: "448px" }}
            className="bg-surface rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-outline-variant"
          >
            <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-on-surface flex items-center gap-2">
                <span className="text-xl">⚠️</span> Xác nhận xóa
              </h3>
              <button
                onClick={() => setDeleteModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface-variant transition-colors p-1.5 rounded-lg hover:bg-surface-container-low"
                disabled={isDeleting}
              >
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-on-surface text-xs leading-relaxed">
                Bạn có chắc chắn muốn xóa danh mục{" "}
                <span className="font-semibold text-on-surface">
                  {categoryToDelete?.name}
                </span>{" "}
                không?
              </p>
              <div className="p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs leading-relaxed font-semibold">
                ⚠️ Cảnh báo: Việc xóa danh mục này sẽ đồng thời xóa các dữ liệu liên quan. Hành động này không thể hoàn tác.
              </div>
            </div>

            <div className="px-6 py-4 bg-surface-container-low flex justify-end gap-3 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-2 bg-surface border border-outline-variant hover:bg-surface-container-low text-on-surface rounded-xl text-xs font-semibold transition"
                disabled={isDeleting}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <MaterialIcon name="sync" className="animate-spin text-sm" />
                    Đang xóa...
                  </>
                ) : (
                  "Xác nhận xóa"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
