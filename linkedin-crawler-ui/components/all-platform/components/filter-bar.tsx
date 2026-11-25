"use client";

import { useEffect, useRef, useState } from "react";
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

/** Option cho dropdown "Team" (gộp từ hàng tab team thật cũ — serviceArea). Đây là dropdown
 * Team DUY NHẤT còn lại — dropdown "Tất cả Team" (Category, lọc server-side theo id_team của
 * group) đã bị xoá hẳn khỏi UI (2026-11-21), xem UnifiedDashboardHomeContent.tsx. */
export interface TeamTabOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  intents: Category[];
  industries: Category[];
  tiers: Category[];
  icps: Category[];
  contentTypes?: Category[];
  productSeedings?: Category[];
  members?: { id: string; name: string; code?: string }[];
  onFilter: (filters: FilterState) => void;
  isLoading?: boolean;
  /** Dropdown "Trạng thái liên hệ" — ghim ngoài hàng filter chính. */
  leadStatusOptions: LeadStatusOption[];
  leadStatusValue: string;
  onLeadStatusChange: (value: string) => void;
  /** Dropdown "Team" (tab team thật) — ghim ngoài hàng filter chính. */
  teamTabOptions: TeamTabOption[];
  teamTabValue: string;
  onTeamTabChange: (value: string) => void;
}

export interface FilterState {
  search: string;
  intent: string;
  industry: string;
  tier: string;
  icp: string;
  content_type: string;
  product_seeding: string;
  member: string;
  sort: SortOption;
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

const SEEDING_STATUS_OPTIONS: { value: SeedingStatusFilter; label: string; color: string }[] = [
  { value: "all", label: "Tất cả", color: "slate" },
  { value: "seeded", label: "Đã seeding", color: "emerald" },
  { value: "verified", label: "Đã verify", color: "green" },
  { value: "pending", label: "Chờ verify", color: "amber" },
  { value: "rejected", label: "Bị từ chối", color: "red" },
];

const selectCls =
  "border border-[#E5E5E5] bg-[#FFFFFF] hover:bg-[#F5F5F5] focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A] outline-none transition cursor-pointer shadow-sm";

export function FilterBar({
  intents,
  industries,
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
  const [tier, setTier] = useState("");
  const [icp, setIcp] = useState("");
  const [contentType, setContentType] = useState("");
  const [productSeeding, setProductSeeding] = useState("");
  const [member, setMember] = useState("");
  const [sort, setSort] = useState<SortOption>("lead_score_high");
  // Phase 6: seeding status filter (admin/leader)
  const [seedingStatus, setSeedingStatus] = useState<SeedingStatusFilter>("all");

  // Việc 2 (2026-11-21): 7 filter ít dùng hơn gom vào popover "Thêm bộ lọc" (lưới 2 cột) —
  // Lĩnh vực (intent) + Ngành (industry) đã ghim ra hàng filter chính, không còn ở đây.
  // state/logic lọc underneath giữ nguyên, chỉ đổi UI từ hiện sẵn sang ẩn trong popover.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreOpen]);

  const hasMoreFilterActive =
    sort !== "lead_score_high" ||
    seedingStatus !== "all" ||
    !!intent ||
    !!industry ||
    !!tier ||
    !!icp ||
    !!contentType ||
    !!productSeeding ||
    !!member;

  const handleChange = (updates: Partial<FilterState>) => {
    const s = updates.search !== undefined ? updates.search : search;
    const i = updates.intent !== undefined ? updates.intent : intent;
    const ind = updates.industry !== undefined ? updates.industry : industry;
    const ti = updates.tier !== undefined ? updates.tier : tier;
    const ic = updates.icp !== undefined ? updates.icp : icp;
    const ct = updates.content_type !== undefined ? updates.content_type : contentType;
    const ps = updates.product_seeding !== undefined ? updates.product_seeding : productSeeding;
    const m = updates.member !== undefined ? updates.member : member;
    const so = updates.sort !== undefined ? updates.sort : sort;
    const ss = updates.seeding_status !== undefined ? updates.seeding_status : seedingStatus;

    onFilter({
      search: s,
      intent: i,
      industry: ind,
      tier: ti,
      icp: ic,
      content_type: ct,
      product_seeding: ps,
      member: m,
      sort: so,
      seeding_status: ss,
    });
  };

  const clearFilters = () => {
    setSearch("");
    setIntent("");
    setIndustry("");
    setTier("");
    setIcp("");
    setContentType("");
    setProductSeeding("");
    setMember("");
    setSort("lead_score_high");
    setSeedingStatus("all");
    onFilter({
      search: "",
      intent: "",
      industry: "",
      tier: "",
      icp: "",
      content_type: "",
      product_seeding: "",
      member: "",
      sort: "lead_score_high",
      seeding_status: "all",
    });
  };

  return (
    <>
      <div className="relative w-[200px] sm:w-[220px] shrink-0">
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
          liên hệ/Đã liên hệ/Chưa phù hợp cũ. */}
      <select
        value={leadStatusValue}
        onChange={(e) => onLeadStatusChange(e.target.value)}
        className={cn(selectCls, "min-w-[170px]")}
        title="Lọc theo trạng thái liên hệ"
      >
        {leadStatusOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>

      {/* Dropdown "Team" — gộp từ hàng tab team thật cũ (serviceArea). Dropdown Team duy nhất
          còn lại (dropdown Category team theo id_team đã xoá hẳn — xem ghi chú ở trên). */}
      <select
        value={teamTabValue}
        onChange={(e) => onTeamTabChange(e.target.value)}
        className={cn(selectCls, "min-w-[140px]")}
        title="Lọc theo team"
      >
        {teamTabOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Dropdown "Lĩnh vực" — ghim ra hàng filter chính (Việc 2, 2026-11-21). */}
      <select
        value={intent}
        onChange={(e) => {
          setIntent(e.target.value);
          handleChange({ intent: e.target.value });
        }}
        className={cn(selectCls, "min-w-[140px]")}
      >
        <option value="">Tất cả Lĩnh vực</option>
        {intents.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name || i.code}
          </option>
        ))}
      </select>

      {/* Dropdown "Ngành" — ghim ra hàng filter chính (Việc 2, 2026-11-21). */}
      <select
        value={industry}
        onChange={(e) => {
          setIndustry(e.target.value);
          handleChange({ industry: e.target.value });
        }}
        className={cn(selectCls, "min-w-[140px]")}
      >
        <option value="">Tất cả Ngành</option>
        {industries.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name || i.code}
          </option>
        ))}
      </select>

      {/* "Thêm bộ lọc" — popover lưới 2 cột chứa 7 filter còn lại. */}
      <div className="relative" ref={moreRef}>
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition cursor-pointer shadow-sm border",
            moreOpen || hasMoreFilterActive
              ? "border-[#E3000F]/40 bg-[#E3000F]/5 text-[#E3000F]"
              : "border-[#E5E5E5] bg-white text-[#1A1A1A] hover:bg-[#F5F5F5]"
          )}
        >
          <span className="material-symbols-outlined text-[16px]">tune</span>
          Thêm bộ lọc
        </button>

        {moreOpen && (
          <div
            className="absolute left-0 top-full mt-1.5 z-50 w-[min(560px,90vw)] p-3 rounded-2xl border border-[#E5E5E5] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortOption);
                  handleChange({ sort: e.target.value as SortOption });
                }}
                className={cn(selectCls, "w-full")}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <select
                value={seedingStatus}
                onChange={(e) => {
                  const val = e.target.value as SeedingStatusFilter;
                  setSeedingStatus(val);
                  handleChange({ seeding_status: val });
                }}
                className={cn(selectCls, "w-full")}
                title="Lọc theo trạng thái seeding"
              >
                {SEEDING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <select
                value={tier}
                onChange={(e) => {
                  setTier(e.target.value);
                  handleChange({ tier: e.target.value });
                }}
                className={cn(selectCls, "w-full")}
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
                  className={cn(selectCls, "w-full")}
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
                  className={cn(selectCls, "w-full")}
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
                  className={cn(selectCls, "w-full")}
                >
                  <option value="">Sản phẩm Seeding</option>
                  {productSeedings.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.code}
                    </option>
                  ))}
                </select>
              )}

              {members.length > 0 && (
                <select
                  value={member}
                  onChange={(e) => {
                    setMember(e.target.value);
                    handleChange({ member: e.target.value });
                  }}
                  className={cn(selectCls, "w-full")}
                >
                  <option value="">Tất cả Thành viên</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.code}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
      </div>

      {/* "Xóa lọc" — text link, không viền (Việc 2: đổi từ nút viền sang link chữ). */}
      <button
        type="button"
        onClick={clearFilters}
        disabled={isLoading}
        className="text-xs font-bold text-[#E3000F] hover:underline cursor-pointer disabled:opacity-50 shrink-0"
      >
        Xóa lọc
      </button>
    </>
  );
}
