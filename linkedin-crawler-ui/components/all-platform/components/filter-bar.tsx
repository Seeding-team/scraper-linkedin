"use client";

import { useState } from "react";
import { FaSearch } from "react-icons/fa";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/unified.types";

export type SortOption = "lead_score_high" | "latest" | "score_high" | "score_low" | "comments_high" | "crawler" | "most_seeded" | "verified_first";

export type SeedingStatusFilter = "all" | "seeded" | "verified" | "pending" | "rejected";

/** Option cho dropdown "Trạng thái liên hệ" (gộp từ hàng pill cũ) — count hiện kèm trong ngoặc. */
export interface LeadStatusOption {
  value: string;
  label: string;
  count: number;
}

/** Option cho dropdown "Team" (gộp từ hàng tab team thật cũ — serviceArea, KHÁC với dropdown
 * "Tất cả Team" (prop `teams`) vốn là danh mục Category chung, không liên quan 2 khái niệm này). */
export interface TeamTabOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  intents: Category[];
  industries: Category[];
  teams: Category[];
  tiers: Category[];
  icps: Category[];
  contentTypes?: Category[];
  productSeedings?: Category[];
  members?: { id: string; name: string; code?: string }[];
  onFilter: (filters: FilterState) => void;
  isLoading?: boolean;
  /** Dropdown "Trạng thái liên hệ" — chỉ hiện khi truyền đủ 3 prop này (trang khác dùng
   * FilterBar không truyền thì không đổi gì). */
  leadStatusOptions?: LeadStatusOption[];
  leadStatusValue?: string;
  onLeadStatusChange?: (value: string) => void;
  /** Dropdown "Team" (tab team thật trước đây) — chỉ hiện khi truyền đủ 3 prop này. */
  teamTabOptions?: TeamTabOption[];
  teamTabValue?: string;
  onTeamTabChange?: (value: string) => void;
}

export interface FilterState {
  search: string;
  intent: string;
  industry: string;
  team: string;
  tier: string;
  icp: string;
  content_type: string;
  product_seeding: string;
  member: string;
  sort: SortOption;
  dateRange: string;
  /** Phase 6: filter posts by seeding status (admin/leader) */
  seeding_status: SeedingStatusFilter;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "lead_score_high", label: "Đạt chuẩn AI (≥40) — mới nhất trước (mặc định)" },
  { value: "latest", label: "Mới nhất" },
  { value: "score_high", label: "Score cao nhất" },
  { value: "score_low", label: "Score thấp nhất" },
  { value: "comments_high", label: "Bình luận nhiều nhất" },
  { value: "crawler", label: "Theo người cào (Team & Tên)" },
  // Phase 6: sort by seeding
  { value: "most_seeded", label: "Nhiều seeding nhất" },
  { value: "verified_first", label: "Verified nhiều nhất" },
];

const DATE_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "today", label: "Hôm nay" },
  { value: "yesterday", label: "Hôm qua" },
  { value: "7days", label: "7 ngày" },
  { value: "30days", label: "30 ngày" },
];

const SEEDING_STATUS_OPTIONS: { value: SeedingStatusFilter; label: string; color: string }[] = [
  { value: "all", label: "Tất cả", color: "slate" },
  { value: "seeded", label: "Đã seeding", color: "emerald" },
  { value: "verified", label: "Đã verify", color: "green" },
  { value: "pending", label: "Chờ verify", color: "amber" },
  { value: "rejected", label: "Bị từ chối", color: "red" },
];

export function FilterBar({
  intents,
  industries,
  teams,
  tiers,
  icps,
  contentTypes = [],
  productSeedings = [],
  members = [],
  onFilter,
  isLoading,
  leadStatusOptions,
  leadStatusValue,
  onLeadStatusChange,
  teamTabOptions,
  teamTabValue,
  onTeamTabChange,
}: FilterBarProps) {
  const [search, setSearch] = useState("");
  const [intent, setIntent] = useState("");
  const [industry, setIndustry] = useState("");
  const [team, setTeam] = useState("");
  const [tier, setTier] = useState("");
  const [icp, setIcp] = useState("");
  const [contentType, setContentType] = useState("");
  const [productSeeding, setProductSeeding] = useState("");
  const [member, setMember] = useState("");
  const [sort, setSort] = useState<SortOption>("lead_score_high");
  const [dateRange, setDateRange] = useState("");
  // Phase 6: seeding status filter (admin/leader)
  const [seedingStatus, setSeedingStatus] = useState<SeedingStatusFilter>("all");

  const handleChange = (updates: Partial<FilterState>) => {
    const s = updates.search !== undefined ? updates.search : search;
    const i = updates.intent !== undefined ? updates.intent : intent;
    const ind = updates.industry !== undefined ? updates.industry : industry;
    const t = updates.team !== undefined ? updates.team : team;
    const ti = updates.tier !== undefined ? updates.tier : tier;
    const ic = updates.icp !== undefined ? updates.icp : icp;
    const ct = updates.content_type !== undefined ? updates.content_type : contentType;
    const ps = updates.product_seeding !== undefined ? updates.product_seeding : productSeeding;
    const m = updates.member !== undefined ? updates.member : member;
    const so = updates.sort !== undefined ? updates.sort : sort;
    const dr = updates.dateRange !== undefined ? updates.dateRange : dateRange;
    const ss = updates.seeding_status !== undefined ? updates.seeding_status : seedingStatus;

    onFilter({
      search: s,
      intent: i,
      industry: ind,
      team: t,
      tier: ti,
      icp: ic,
      content_type: ct,
      product_seeding: ps,
      member: m,
      sort: so,
      dateRange: dr,
      seeding_status: ss,
    });
  };

  const clearFilters = () => {
    setSearch("");
    setIntent("");
    setIndustry("");
    setTeam("");
    setTier("");
    setIcp("");
    setContentType("");
    setProductSeeding("");
    setMember("");
    setSort("lead_score_high");
    setDateRange("");
    setSeedingStatus("all");
    onFilter({
      search: "",
      intent: "",
      industry: "",
      team: "",
      tier: "",
      icp: "",
      content_type: "",
      product_seeding: "",
      member: "",
      sort: "lead_score_high",
      dateRange: "",
      seeding_status: "all",
    });
  };

  return (
    <div className="bg-[#F5F5F5]/50 flex flex-wrap items-center gap-3 rounded-2xl border border-[#E5E5E5] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
      <div className="relative min-w-[200px] flex-1">
        <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A0A0] text-sm" />
        <input
          type="text"
          placeholder="Tìm kiếm nội dung, tên nhóm..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            handleChange({ search: e.target.value });
          }}
          className="w-full border border-[#333333] bg-[#FFFFFF] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl pl-9 pr-4 py-2 text-xs font-semibold text-[#1A1A1A] outline-none transition shadow-sm"
        />
      </div>

      {/* Dropdown "Trạng thái liên hệ" — gộp từ hàng pill Tất cả bài viết/Cần liên hệ/Đang
          liên hệ/Đã liên hệ/Chưa phù hợp cũ. State/logic lọc underneath không đổi, chỉ đổi
          UI chọn (xem UnifiedDashboardHomeContent.tsx — leadStatusValue = seedingStatusFilter). */}
      {leadStatusOptions && leadStatusOptions.length > 0 && (
        <select
          value={leadStatusValue}
          onChange={(e) => onLeadStatusChange?.(e.target.value)}
          className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[170px]"
          title="Lọc theo trạng thái liên hệ"
        >
          {leadStatusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      )}

      {/* Dropdown "Team" — gộp từ hàng tab team thật cũ (serviceArea). KHÁC với dropdown
          "Tất cả Team" bên dưới (prop `teams`, danh mục Category chung). */}
      {teamTabOptions && teamTabOptions.length > 0 && (
        <select
          value={teamTabValue}
          onChange={(e) => onTeamTabChange?.(e.target.value)}
          className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[140px]"
          title="Lọc theo team"
        >
          {teamTabOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      <select
        value={dateRange}
        onChange={(e) => {
          setDateRange(e.target.value);
          handleChange({ dateRange: e.target.value });
        }}
        className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[110px]"
      >
        {DATE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={sort}
        onChange={(e) => {
          setSort(e.target.value as SortOption);
          handleChange({ sort: e.target.value as SortOption });
        }}
        className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[130px]"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Phase 6: seeding status filter */}
      <select
        value={seedingStatus}
        onChange={(e) => {
          const val = e.target.value as SeedingStatusFilter;
          setSeedingStatus(val);
          handleChange({ seeding_status: val });
        }}
        className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[130px]"
        title="Lọc theo trạng thái seeding"
      >
        {SEEDING_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={intent}
        onChange={(e) => {
          setIntent(e.target.value);
          handleChange({ intent: e.target.value });
        }}
        className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[120px]"
      >
        <option value="">Tất cả Lĩnh vực</option>
        {intents.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name || i.code}
          </option>
        ))}
      </select>

      <select
        value={industry}
        onChange={(e) => {
          setIndustry(e.target.value);
          handleChange({ industry: e.target.value });
        }}
        className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[120px]"
      >
        <option value="">Tất cả Ngành</option>
        {industries.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name || i.code}
          </option>
        ))}
      </select>

      <select
        value={team}
        onChange={(e) => {
          setTeam(e.target.value);
          handleChange({ team: e.target.value });
        }}
        className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[120px]"
      >
        <option value="">Tất cả Team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name || t.code}
          </option>
        ))}
      </select>

      <select
        value={tier}
        onChange={(e) => {
          setTier(e.target.value);
          handleChange({ tier: e.target.value });
        }}
        className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[110px]"
      >
        <option value="">Tất cả Tier</option>
        {tiers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name || t.code}
          </option>
        ))}
      </select>

      {icps.length > 0 && (
        <select
          value={icp}
          onChange={(e) => {
            setIcp(e.target.value);
            handleChange({ icp: e.target.value });
          }}
          className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[110px]"
        >
          <option value="">Tất cả ICP</option>
          {icps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.code}
            </option>
          ))}
        </select>
      )}

      {contentTypes.length > 0 && (
        <select
          value={contentType}
          onChange={(e) => {
            setContentType(e.target.value);
            handleChange({ content_type: e.target.value });
          }}
          className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[120px]"
        >
          <option value="">Loại nội dung</option>
          {contentTypes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.code}
            </option>
          ))}
        </select>
      )}

      {productSeedings.length > 0 && (
        <select
          value={productSeeding}
          onChange={(e) => {
            setProductSeeding(e.target.value);
            handleChange({ product_seeding: e.target.value });
          }}
          className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[130px]"
        >
          <option value="">Sản phẩm Seeding</option>
          {productSeedings.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.code}
            </option>
          ))}
        </select>
      )}

      {members && members.length > 0 && (
        <select
          value={member}
          onChange={(e) => {
            setMember(e.target.value);
            handleChange({ member: e.target.value });
          }}
          className="border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm min-w-[130px]"
        >
          <option value="">Tất cả Thành viên</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.code}
            </option>
          ))}
        </select>
      )}

      {/* Cụm Xóa Lọc */}
      <button
        type="button"
        onClick={clearFilters}
        disabled={isLoading}
        className="ml-auto rounded-xl bg-white border border-[#E5E5E5] px-4 py-2 text-xs font-bold text-[#E3000F] hover:bg-[#E3000F]/5 hover:border-[#E3000F]/30 transition shadow-sm cursor-pointer disabled:opacity-50"
      >
        Xóa lọc
      </button>
    </div>
  );
}
