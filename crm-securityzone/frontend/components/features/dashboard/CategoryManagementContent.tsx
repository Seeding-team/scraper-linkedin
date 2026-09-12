"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { useAppAuth } from "@/contexts/AppAuthContext";
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
    key: "crm_city",
    label: "Thanh pho",
    description: "Thanh pho/tinh dung trong ho so Khach hang, Lead va Deal.",
    placeholderCode: "Vd: Da_Nang",
    placeholderName: "Vd: Da Nang",
  },
  {
    key: "crm_expected_timeline",
    label: "Thời gian triển khai",
    description: "Mốc thời gian dự kiến triển khai trong form Xác minh Lead.",
    placeholderCode: "Vd: Trong_1_thang",
    placeholderName: "Vd: Trong 1 tháng",
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
    key: "crm_nurture_reason",
    label: "Lý do nuôi dưỡng",
    description: "Lý do giữ Lead ở nhánh Nuôi dưỡng trong form Xác minh Lead.",
    placeholderCode: "Vd: Chua_co_ngan_sach",
    placeholderName: "Vd: Chưa có ngân sách",
  },
  {
    key: "crm_follow_up_channel",
    label: "Kênh chăm sóc lại",
    description: "Kênh dự kiến dùng để chăm sóc lại Lead nuôi dưỡng.",
    placeholderCode: "Vd: Zalo",
    placeholderName: "Vd: Zalo",
  },
  {
    key: "crm_unqualified_reason",
    label: "Lý do không đạt chuẩn",
    description: "Lý do chốt Lead không đạt chuẩn trong form Xác minh Lead.",
    placeholderCode: "Vd: Sai_thong_tin",
    placeholderName: "Vd: Sai thông tin",
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
  { key: "crm_contract_status", label: "Tinh trang hop dong", description: "Cac lua chon tinh trang hop dong trong Deal/Hop dong.", placeholderCode: "Vd: dang_xu_ly", placeholderName: "Vd: Dang xu ly" },
  { key: "crm_payment_status", label: "Trang thai thanh toan", description: "Cac lua chon trang thai thanh toan trong Deal/Hop dong.", placeholderCode: "Vd: chua_thanh_toan", placeholderName: "Vd: Chua thanh toan" },
  { key: "crm_billing_type", label: "Loai thanh toan", description: "Cac lua chon chu ky/loai thanh toan cua hop dong.", placeholderCode: "Vd: one_time", placeholderName: "Vd: Mot lan" },
  { key: "crm_won_reason", label: "Ly do thang deal", description: "Ly do chuan hoa khi chot thang Deal.", placeholderCode: "Vd: solution_fit", placeholderName: "Vd: Giai phap phu hop" },
  { key: "crm_lost_reason", label: "Ly do thua deal", description: "Ly do chuan hoa khi chot thua Deal.", placeholderCode: "Vd: no_budget", placeholderName: "Vd: Khach chua co ngan sach" },
  { key: "crm_outcome_confidence", label: "Do chac chan danh gia", description: "Muc do chac chan cua ket luan thang/thua.", placeholderCode: "Vd: high_confirmed", placeholderName: "Vd: Cao - Co khach hang xac nhan" },
  { key: "crm_outcome_trigger", label: "Trigger hanh dong", description: "Boi canh khien khach hang hanh dong trong danh gia Deal.", placeholderCode: "Vd: deadline", placeholderName: "Vd: Can go-live theo deadline" },
  { key: "crm_outcome_objection", label: "Objection", description: "Cac phan doi/lo ngai chinh trong danh gia Deal.", placeholderCode: "Vd: price", placeholderName: "Vd: Lo ngai gia / ngan sach" },
  { key: "crm_kb_reuse_level", label: "Muc tai su dung KB", description: "Muc do co the tai su dung bai hoc sau khi dong Deal.", placeholderCode: "Vd: high_playbook", placeholderName: "Vd: Cao - Co the thanh playbook" },
  { key: "crm_kb_owner", label: "Owner KB", description: "Nhom/nguoi phu trach bai hoc Knowledge Base.", placeholderCode: "Vd: sales_manager", placeholderName: "Vd: Quan ly sales" },
  { key: "crm_kb_status", label: "Trang thai KB", description: "Trang thai duyet bai hoc Knowledge Base.", placeholderCode: "Vd: approved", placeholderName: "Vd: Approved - Da duyet" },
];

// Chỉ category_type='crm_position'/'crm_quote_type' dùng NGỪNG DÙNG
// (is_active=false) thay vì xóa cứng — Loại báo giá đã gắn vào báo giá cũ
// (quotes.quote_type_codes lưu THEO CODE) không được xóa cứng, khớp yêu cầu
// "Không xóa cứng loại đã được báo giá sử dụng". 3 mục kia (Lĩnh vực/Nguồn/
// Danh mục sản phẩm/Gói) giữ nguyên hành vi xóa cứng đã có từ trước (ngoài
// phạm vi task này, xem migration 079).
const DEACTIVATABLE_SECTIONS = new Set<CategoryType>(CRM_SECTIONS.map(section => section.key));

const CRM_SECTION_GROUPS = [
  "Lead & Khách hàng",
  "Xác minh & Chăm sóc",
  "Deal & Báo giá",
  "Hợp đồng & Thanh toán",
  "Đánh giá & Knowledge Base",
] as const;

const CRM_SECTION_PRESENTATION: Partial<Record<CategoryType, { group: (typeof CRM_SECTION_GROUPS)[number]; icon: MaterialSymbolName }>> = {
  crm_industry: { group: "Lead & Khách hàng", icon: "domain" },
  crm_source: { group: "Lead & Khách hàng", icon: "travel_explore" },
  crm_service_package: { group: "Lead & Khách hàng", icon: "category" },
  crm_package: { group: "Lead & Khách hàng", icon: "folder" },
  crm_position: { group: "Lead & Khách hàng", icon: "person" },
  crm_city: { group: "Lead & Khách hàng", icon: "domain" },
  crm_expected_timeline: { group: "Xác minh & Chăm sóc", icon: "calendar_month" },
  crm_next_step: { group: "Xác minh & Chăm sóc", icon: "arrow_forward" },
  crm_nurture_reason: { group: "Xác minh & Chăm sóc", icon: "lightbulb" },
  crm_follow_up_channel: { group: "Xác minh & Chăm sóc", icon: "forum" },
  crm_unqualified_reason: { group: "Xác minh & Chăm sóc", icon: "block" },
  crm_quote_type: { group: "Deal & Báo giá", icon: "request_quote" },
  crm_won_reason: { group: "Deal & Báo giá", icon: "military_tech" },
  crm_lost_reason: { group: "Deal & Báo giá", icon: "block" },
  crm_contract_status: { group: "Hợp đồng & Thanh toán", icon: "assignment" },
  crm_payment_status: { group: "Hợp đồng & Thanh toán", icon: "paid" },
  crm_billing_type: { group: "Hợp đồng & Thanh toán", icon: "description" },
  crm_outcome_confidence: { group: "Đánh giá & Knowledge Base", icon: "verified" },
  crm_outcome_trigger: { group: "Đánh giá & Knowledge Base", icon: "bolt" },
  crm_outcome_objection: { group: "Đánh giá & Knowledge Base", icon: "comment" },
  crm_kb_reuse_level: { group: "Đánh giá & Knowledge Base", icon: "sync" },
  crm_kb_owner: { group: "Đánh giá & Knowledge Base", icon: "manage_accounts" },
  crm_kb_status: { group: "Đánh giá & Knowledge Base", icon: "check_circle" },
};

type CrmCategoryStatusFilter = "all" | "active" | "inactive";

function CrmCategorySections({
  categories,
  onChanged,
  isLoading,
  errorMsg,
  canManage,
}: {
  categories: Record<string, Category[]>;
  onChanged: () => Promise<void>;
  isLoading: boolean;
  errorMsg: string | null;
  canManage: boolean;
}) {
  const [activeSection, setActiveSection] = useState<CategoryType>(CRM_SECTIONS[0].key);
  const [sectionSearch, setSectionSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<CrmCategoryStatusFilter>("all");
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

  const activeMeta = CRM_SECTIONS.find(s => s.key === activeSection) || CRM_SECTIONS[0];
  const activePresentation = CRM_SECTION_PRESENTATION[activeSection] || { group: CRM_SECTION_GROUPS[0], icon: "folder" };
  const sectionItems = useMemo(
    () => [...(categories[activeSection] || [])].sort((a, b) => {
      const orderA = typeof a.sort_order === "number" ? a.sort_order : 0;
      const orderB = typeof b.sort_order === "number" ? b.sort_order : 0;
      return orderA - orderB || (a.code || "").localeCompare(b.code || "");
    }),
    [activeSection, categories],
  );

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return sectionItems.filter(item => {
      const isInactive = item.is_active === false;
      if (statusFilter === "active" && isInactive) return false;
      if (statusFilter === "inactive" && !isInactive) return false;
      if (!term) return true;
      return (item.code || "").toLowerCase().includes(term) || (item.name || "").toLowerCase().includes(term);
    });
  }, [sectionItems, searchTerm, statusFilter]);

  const visibleSectionsByGroup = useMemo(() => {
    const term = sectionSearch.trim().toLowerCase();
    const grouped = new Map<(typeof CRM_SECTION_GROUPS)[number], typeof CRM_SECTIONS>();
    CRM_SECTION_GROUPS.forEach(group => grouped.set(group, []));
    CRM_SECTIONS.forEach(section => {
      const presentation = CRM_SECTION_PRESENTATION[section.key] || { group: CRM_SECTION_GROUPS[0] };
      const count = categories[section.key]?.length || 0;
      const haystack = `${section.label} ${section.description} ${section.key}`.toLowerCase();
      if (term && !haystack.includes(term)) return;
      grouped.set(presentation.group, [...(grouped.get(presentation.group) || []), section]);
    });
    return grouped;
  }, [categories, sectionSearch]);

  const handleSelectSection = (sectionKey: CategoryType) => {
    setActiveSection(sectionKey);
    setSearchTerm("");
    setStatusFilter("all");
  };

  const handleOpenAdd = () => {
    setModal({ sectionKey: activeSection, mode: "add", code: "", name: "" });
    setModalError(null);
  };

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

  const handleMove = async (item: Category, direction: "up" | "down") => {
    const index = sectionItems.findIndex(row => row.id === item.id);
    const target = sectionItems[direction === "up" ? index - 1 : index + 1];
    if (!target) return;
    const currentOrder = typeof item.sort_order === "number" ? item.sort_order : index;
    const targetOrder = typeof target.sort_order === "number" ? target.sort_order : direction === "up" ? index - 1 : index + 1;
    const [first, second] = await Promise.all([
      allPlatformCategoriesService.update({ id: item.id, sort_order: targetOrder }),
      allPlatformCategoriesService.update({ id: target.id, sort_order: currentOrder }),
    ]);
    if (!first.success || !second.success) {
      alert(first.message || second.message || "Không thể sắp xếp danh mục. Hãy kiểm tra migration 124 đã được chạy chưa.");
      return;
    }
    invalidateCrmCategoryCache(activeSection);
    await onChanged();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface text-on-surface shadow-sm">
      <div className="grid min-h-[560px] grid-cols-1 lg:h-[calc(100vh-170px)] lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
        <aside className="hidden min-h-0 border-r border-outline-variant bg-surface-container-low/30 lg:flex lg:flex-col">
          <div className="border-b border-outline-variant p-4">
            <label className="relative block">
              <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
              <input
                type="text"
                value={sectionSearch}
                onChange={e => setSectionSearch(e.target.value)}
                placeholder="Tìm danh mục..."
                className="h-10 w-full rounded-lg border border-outline-variant bg-surface px-9 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {CRM_SECTION_GROUPS.map(group => {
              const sections = visibleSectionsByGroup.get(group) || [];
              if (sections.length === 0) return null;
              return (
                <div key={group} className="mb-4 last:mb-0">
                  <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                    {group}
                  </div>
                  <div className="space-y-1">
                    {sections.map(section => {
                      const isActive = activeSection === section.key;
                      const count = categories[section.key]?.length || 0;
                      const icon = CRM_SECTION_PRESENTATION[section.key]?.icon || "folder";
                      return (
                        <button
                          key={section.key}
                          type="button"
                          onClick={() => handleSelectSection(section.key)}
                          className={cn(
                            "flex h-11 w-full items-center gap-2 rounded-lg border px-2.5 text-left text-sm transition",
                            isActive
                              ? "border-primary/35 bg-primary/5 text-primary shadow-[inset_3px_0_0_rgba(194,24,91,0.9)]"
                              : "border-transparent text-on-surface hover:border-outline-variant hover:bg-surface",
                          )}
                        >
                          <MaterialIcon name={icon} className="text-[18px] text-current" />
                          <span className="min-w-0 flex-1 truncate font-semibold">{section.label}</span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-bold",
                            isActive ? "bg-primary/10 text-primary" : "bg-surface text-on-surface-variant",
                          )}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {[...visibleSectionsByGroup.values()].every(sections => sections.length === 0) ? (
              <div className="rounded-lg border border-dashed border-outline-variant bg-surface p-4 text-center text-sm text-on-surface-variant">
                Không tìm thấy nhóm phù hợp.
              </div>
            ) : null}
          </div>
        </aside>

        <section className="min-w-0 bg-surface lg:min-h-0 lg:overflow-y-auto">
          <div className="border-b border-outline-variant p-4 lg:hidden">
            <label className="mb-2 block text-xs font-bold uppercase text-on-surface-variant">Danh mục</label>
            <select
              value={activeSection}
              onChange={e => handleSelectSection(e.target.value as CategoryType)}
              className="h-11 w-full rounded-lg border border-outline-variant bg-surface px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              {CRM_SECTION_GROUPS.map(group => (
                <optgroup key={group} label={group}>
                  {CRM_SECTIONS.filter(section => (CRM_SECTION_PRESENTATION[section.key]?.group || CRM_SECTION_GROUPS[0]) === group).map(section => (
                    <option key={section.key} value={section.key}>{section.label} ({categories[section.key]?.length || 0})</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-4 border-b border-outline-variant p-5 md:flex-row md:items-start md:justify-between md:p-6">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
                <MaterialIcon name={activePresentation.icon} className="text-[18px]" />
                <span>{activePresentation.group}</span>
              </div>
              <h2 className="text-xl font-bold text-on-surface">{activeMeta.label}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-on-surface-variant">{activeMeta.description}</p>
              <p className="mt-2 text-sm font-semibold text-on-surface-variant">{sectionItems.length} giá trị</p>
            </div>
            {canManage ? (
              <button type="button" onClick={handleOpenAdd} className="crm-primary-button shrink-0">
                <MaterialIcon name="add" className="text-[18px]" />
                Thêm {activeMeta.label.toLowerCase()}
              </button>
            ) : null}
          </div>

          <div className="space-y-4 p-4 md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <label className="relative block w-full md:max-w-md">
                <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Tìm theo tên hoặc mã..."
                  className="h-10 w-full rounded-lg border border-outline-variant bg-surface px-9 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </label>
              <div className="inline-flex rounded-lg border border-outline-variant bg-surface-container-low p-1">
                {[
                  ["all", "Tất cả"],
                  ["active", "Đang sử dụng"],
                  ["inactive", "Ngừng sử dụng"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value as CrmCategoryStatusFilter)}
                    className={cn(
                      "h-8 rounded-md px-3 text-xs font-bold transition",
                      statusFilter === value ? "bg-surface text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[660px] border-collapse text-left text-sm">
                  <thead className="border-b border-outline-variant bg-surface-container-low text-[11px] font-bold uppercase text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-3">Tên</th>
                      <th className="px-4 py-3">Mã</th>
                      <th className="px-4 py-3">Trạng thái</th>
                      <th className="w-24 px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {isLoading ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-sm text-on-surface-variant">
                          <span className="inline-flex items-center gap-2 font-semibold">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            Đang tải danh sách...
                          </span>
                        </td>
                      </tr>
                    ) : errorMsg ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-sm font-semibold text-red-600">{errorMsg}</td>
                      </tr>
                    ) : filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12">
                          <div className="mx-auto max-w-sm text-center">
                            <MaterialIcon name="inbox" className="mx-auto mb-2 text-[28px] text-on-surface-variant" />
                            <p className="font-bold text-on-surface">
                              {searchTerm.trim() || statusFilter !== "all" ? "Không có giá trị phù hợp" : `Chưa có ${activeMeta.label.toLowerCase()}`}
                            </p>
                            <p className="mt-1 text-sm leading-5 text-on-surface-variant">
                              {searchTerm.trim() || statusFilter !== "all"
                                ? "Thay đổi từ khóa hoặc trạng thái lọc."
                                : canManage
                                  ? `Bấm Thêm ${activeMeta.label.toLowerCase()} để tạo giá trị đầu tiên.`
                                  : "Danh mục này chưa có giá trị đang hiển thị."}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map(item => {
                        const isDeactivatable = DEACTIVATABLE_SECTIONS.has(activeSection);
                        const isInactive = item.is_active === false;
                        return (
                          <tr key={item.id} className="h-14 transition hover:bg-surface-container-low/60">
                            <td className="max-w-[360px] px-4 py-3">
                              <div className="truncate font-semibold text-on-surface" title={item.name || ""}>{item.name}</div>
                            </td>
                            <td className="max-w-[260px] px-4 py-3">
                              <code className="block truncate rounded bg-surface-container-low px-2 py-1 font-mono text-xs text-on-surface-variant" title={item.code || ""}>{item.code}</code>
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                "inline-flex rounded-full border px-2.5 py-1 text-xs font-bold",
                                isInactive
                                  ? "border-outline-variant bg-surface-container-low text-on-surface-variant"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
                              )}>
                                {isInactive ? "Ngừng sử dụng" : "Đang sử dụng"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {canManage ? (
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
                                    {
                                      key: "move-up",
                                      label: "Đưa lên",
                                      disabled: sectionItems[0]?.id === item.id,
                                      onSelect: () => void handleMove(item, "up"),
                                    },
                                    {
                                      key: "move-down",
                                      label: "Đưa xuống",
                                      disabled: sectionItems[sectionItems.length - 1]?.id === item.id,
                                      onSelect: () => void handleMove(item, "down"),
                                    },
                                    isDeactivatable
                                      ? {
                                          key: "toggle-active",
                                          label: isInactive ? "Kích hoạt lại" : "Ngừng sử dụng",
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
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px] animate-in fade-in duration-200">
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
                  Mã <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  placeholder={CRM_SECTIONS.find(s => s.key === modal.sectionKey)?.placeholderCode}
                  value={modal.code}
                  onChange={e => setModal({ ...modal, code: e.target.value })}
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2 text-xs text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase text-on-surface-variant">
                  Tên hiển thị <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  placeholder={CRM_SECTIONS.find(s => s.key === modal.sectionKey)?.placeholderName}
                  value={modal.name}
                  onChange={e => setModal({ ...modal, name: e.target.value })}
                  className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2 text-xs text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
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
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-white shadow-sm transition hover:bg-on-primary-fixed-variant disabled:opacity-60"
                >
                  {isSubmitting && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
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
        const title = isDeactivatable ? (isReactivate ? "Kích hoạt lại giá trị" : "Ngừng sử dụng giá trị") : "Xóa giá trị";
        const actionLabel = isDeactivatable ? (isReactivate ? "Kích hoạt lại" : "Ngừng sử dụng") : "Xóa";
        const busyLabel = isDeactivatable ? "Đang lưu..." : "Đang xóa...";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px] animate-in fade-in duration-200">
            <div style={{ width: "100%", maxWidth: "420px" }} className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-4">
                <h3 className="flex items-center gap-2 font-bold text-on-surface">
                  <MaterialIcon name="warning" className="text-xl text-amber-600" /> {title}
                </h3>
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-low"
                  disabled={isDeleting}
                  aria-label="Đóng"
                >
                  <MaterialIcon name="close" className="text-xl" />
                </button>
              </div>
              <div className="space-y-4 p-6">
                <p className="text-xs leading-relaxed text-on-surface">
                  Bạn có chắc chắn muốn {isDeactivatable ? (isReactivate ? "kích hoạt lại" : "ngừng sử dụng") : "xóa"}{" "}
                  <span className="font-semibold">{deleteTarget.item.name} ({deleteTarget.item.code})</span>{" "}
                  trong danh mục &quot;{CRM_SECTIONS.find(s => s.key === deleteTarget.sectionKey)?.label}&quot; không?
                </p>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-medium leading-relaxed text-amber-800">
                  {isDeactivatable
                    ? isReactivate
                      ? "Giá trị này sẽ xuất hiện lại trong các ô chọn mới."
                      : "Record cũ vẫn giữ dữ liệu lịch sử; giá trị này sẽ không còn xuất hiện trong lựa chọn mới."
                    : "Hành động xóa không thể hoàn tác nếu backend cho phép xóa cứng giá trị này."}
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-outline-variant bg-surface-container-low px-6 py-4">
                <button type="button" onClick={() => setDeleteTarget(null)} className="crm-cancel-button" disabled={isDeleting}>
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
  const { user } = useAppAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManageMasterData = Boolean(
    user &&
      (user.role === "admin" ||
        user.role === "leader" ||
        user.quote_business_role === "sale" ||
        user.quote_business_role === "presale" ||
        user.quote_business_role === "both"),
  );

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
    crm_expected_timeline: [],
    crm_next_step: [],
    crm_nurture_reason: [],
    crm_follow_up_channel: [],
    crm_unqualified_reason: [],
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
        crm_expected_timeline: [],
        crm_next_step: [],
        crm_nurture_reason: [],
        crm_follow_up_channel: [],
        crm_unqualified_reason: [],
        crm_quote_type: [],
      };
      CRM_SECTIONS.forEach(section => {
        if (!grouped[section.key]) grouped[section.key] = [];
      });

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
          canManage={canManageMasterData}
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
