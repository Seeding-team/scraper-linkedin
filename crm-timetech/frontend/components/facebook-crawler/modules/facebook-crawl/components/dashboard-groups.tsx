// src/modules/group/components/DashboardGroups.tsx
"use client";

import React, { useState, useEffect } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { useGetPresetGroups } from "../hooks/use-get-preset-groups";
import CreateGroupModal from "./create-group-form";
import { UpdateGroupModal } from "./update-group-modal";
import { useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { submitSharedDeleteGroup } from "@/lib/group-platform-api";
import {
  PlatformStatCard,
  PlatformStatsRow,
} from "@/components/features/shared/PlatformStatCard";
import { MaterialIcon } from "@/components/ui";
import {
  detectPlatformFromUrl,
  formatRelativeCrawl,
} from "@/lib/group-taxonomy";
import { useGetCategoriesQuery } from "../hooks/use-get-categories-query";
import { useQueryClient } from "@tanstack/react-query";
import type { AppPlatform } from "@/lib/app-platform";

import { FacebookGroupDTO } from "../types/data-fb.type";

function teamOrIcpToArray(value?: string[] | string): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const parseBackendDate = (dateInput?: string | Date | null): Date | null => {
  if (!dateInput) return null;
  if (dateInput instanceof Date) return dateInput;

  // Chuyển "2026-05-14 15:30:00" -> "2026-05-14T15:30:00" chuẩn ISO
  const safeDateStr = dateInput.replace(" ", "T");
  const parsedDate = new Date(safeDateStr);

  return isNaN(parsedDate.getTime()) ? null : parsedDate;
};

// Kiểm tra xem ngày crawl có nằm trong 7 ngày qua (1 tuần) hay không
const isWithinLastWeek = (dateInput?: string | Date | null) => {
  const crawlDate = parseBackendDate(dateInput);
  if (!crawlDate) return false;

  const now = new Date();
  const diffTime = now.getTime() - crawlDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  return diffDays <= 7; // Trong vòng 1 tuần
};

export function DashboardGroups({
  forcedPlatform = null,
}: {
  forcedPlatform?: AppPlatform | null;
}) {
  const { platform } = useAppPlatform();
  const d = useDashboard();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [intentFilter, setIntentFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");

  // State phân trang
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 6;

  // State cho Update Modal
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [selectedGroupForUpdate, setSelectedGroupForUpdate] =
    useState<FacebookGroupDTO | null>(null);

  const { data: categoriesData } = useGetCategoriesQuery();
  const dynCategories = categoriesData || {};

  const { presetGroups, isLoadingGroups, errorGroups } =
    useGetPresetGroups(d.email, d.dashboardReloadToken);

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (group: FacebookGroupDTO) => {
    if (
      !window.confirm(
        "Bạn có chắc chắn muốn xóa group này? Hành động này không thể hoàn tác.",
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      const res = await submitSharedDeleteGroup(group, d.email);
      if (res.ok) {
        alert(res.message || "Xóa group thành công");
        queryClient.invalidateQueries({ queryKey: ["presetGroups"] });
      } else {
        alert(res.message || "Có lỗi xảy ra khi xóa group");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Có lỗi xảy ra khi xóa group");
    } finally {
      setIsDeleting(false);
    }
  };



  // Tự động set platformFilter theo platform của workspace khi mount / thay đổi workspace
  useEffect(() => {
    if (forcedPlatform === "facebook" || forcedPlatform === "linkedin") {
      setPlatformFilter(forcedPlatform);
      return;
    }
    if (platform === "facebook") setPlatformFilter("facebook");
    else if (platform === "linkedin") setPlatformFilter("linkedin");
    else setPlatformFilter("all");
  }, [platform, forcedPlatform]);

  // Reset về trang 1 khi các tiêu chí lọc thay đổi
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    platformFilter,
    statusFilter,
    intentFilter,
    industryFilter,
    teamFilter,
    tierFilter,
  ]);

  // ==========================================
  // 1. TÍNH TOÁN CÁC CHỈ SỐ THỐNG KÊ (SUMMARY CARDS)
  // ==========================================
  const scopeGroups = presetGroups.filter((g) => {
    const p = g.platform || detectPlatformFromUrl(g.url);
    if (forcedPlatform && p !== forcedPlatform) return false;
    if (platformFilter !== "all" && p !== platformFilter) return false;
    return true;
  });

  const totalGroups = scopeGroups.length;
  const activeGroups = scopeGroups.filter((g) => g.status === "ACTIVE").length;
  const totalPostsPerWeek = scopeGroups.reduce(
    (sum, g) => sum + (g.posts_per_week || 0),
    0,
  );
  const needCheckCount = scopeGroups.filter(
    (g) =>
      g.status === "DEAD" ||
      teamOrIcpToArray(g.team).length === 0 ||
      !g.industry,
  ).length;

  // ==========================================
  // 2. HELPERS RENDER GIAO DIỆN
  // ==========================================
  const detectPlatform = (url: string) => {
    const p = detectPlatformFromUrl(url);
    return p === "linkedin" ? "LinkedIn" : "Facebook";
  };

  const renderTaxonomyTags = (group: FacebookGroupDTO) => {
    const tags: React.ReactNode[] = [];
    if (group.industry) {
      const match = dynCategories.industry?.find(
        (c) => (c.code || c.value || "").toLowerCase() === (group.industry || "").toLowerCase()
      );
      const indLabel = match ? match.name || match.value : group.industry;
      tags.push(
        <span
          key="ind"
          className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-800"
        >
          {indLabel}
        </span>,
      );
    }
    teamOrIcpToArray(group.team).forEach((t) =>
      tags.push(
        <span
          key={`team-${t}`}
          className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-800"
        >
          {t}
        </span>,
      ),
    );
    if (group.tier) {
      const tVal = String(group.tier);
      const match = dynCategories.tier?.find(
        (c) => (c.code || c.value || "").toLowerCase() === tVal.toLowerCase()
      );
      const name = match?.name || `Tier ${tVal}`;
      const icon = name.split(" ")[0] || "🔥";
      const title = name.substring(icon.length).trim() || `Tier ${tVal}`;
      tags.push(
        <span key={`tier-${tVal}`} className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-800">
          {icon} {title}
        </span>,
      );
    }
    teamOrIcpToArray(group.icp)
      .slice(0, 2)
      .forEach((t) =>
        tags.push(
          <span
            key={`icp-${t}`}
            className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-800"
          >
            {t}
          </span>,
        ),
      );
    if (tags.length === 0) {
      return (
        <span className="text-on-surface-variant text-[10px] italic">
          Chưa phân loại
        </span>
      );
    }
    return <div className="flex max-w-[180px] flex-wrap gap-1">{tags}</div>;
  };

  const renderPlatformIcon = (platform: string) => {
    if (platform === "LinkedIn") {
      return <FaLinkedin className="text-blue-700 text-base shrink-0" />;
    }
    return <FaFacebook className="text-blue-600 text-base shrink-0" />;
  };

  const renderHealthScore = (
    score: number,
    status?: "ACTIVE" | "IDLE" | "DEAD" | null,
  ) => {
    let bgColor = "bg-rose-500";
    let textColor = "text-rose-500";

    if (status === "ACTIVE") {
      bgColor = "bg-emerald-500";
      textColor = "text-emerald-500";
    } else if (status === "IDLE") {
      bgColor = "bg-amber-500";
      textColor = "text-amber-500";
    }

    const progressWidth = Math.min(Math.max(score, 0), 100);

    return (
      <div className="flex items-center gap-3">
        <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${bgColor} transition-all duration-300`}
            style={{ width: `${progressWidth}%` }}
          />
        </div>
        <span className={`text-xs font-bold ${textColor}`}>{score}</span>
      </div>
    );
  };

  const renderStatusBadge = (status?: "ACTIVE" | "IDLE" | "DEAD" | null) => {
    if (!status)
      return <span className="text-slate-400 italic text-xs">Chưa rõ</span>;

    switch (status) {
      case "ACTIVE":
        return (
          <span className="px-3 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full text-xs font-medium flex items-center gap-1.5 w-max">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Sống
          </span>
        );
      case "IDLE":
        return (
          <span className="px-3 py-1 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-xs font-medium flex items-center gap-1.5 w-max">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Ít HĐ
          </span>
        );
      case "DEAD":
        return (
          <span className="px-3 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-full text-xs font-medium flex items-center gap-1.5 w-max">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Chết
          </span>
        );
    }
  };

  // ==========================================
  // 3. LỌC VÀ PHÂN TRANG DỮ LIỆU
  // ==========================================
  // Lấy danh sách intent duy nhất từ dữ liệu (đã chuyển xuống dưới dùng intentChips)

  const filteredGroups = presetGroups.filter((group) => {
    const platform = detectPlatform(group.url);
    const matchSearch =
      (group.group_name || "")
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      (group.url || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchPlatform =
      platformFilter === "all" ||
      platform.toLowerCase() === platformFilter.toLowerCase();
    const matchStatus =
      statusFilter === "all" ||
      (group.status || "").toLowerCase() === statusFilter.toLowerCase();
    const matchIntent =
      intentFilter === "all" ||
      (group.intent || "").toLowerCase() === intentFilter.toLowerCase();
    const matchIndustry =
      industryFilter === "all" ||
      (group.industry || "").toLowerCase() === industryFilter.toLowerCase();
    const matchTeam =
      teamFilter === "all" ||
      teamOrIcpToArray(group.team).some(
        (t) => t.toLowerCase() === teamFilter.toLowerCase(),
      );
    const matchTier =
      tierFilter === "all" || String(group.tier ?? "") === tierFilter;

    return (
      matchSearch &&
      matchPlatform &&
      matchStatus &&
      matchIntent &&
      matchIndustry &&
      matchTeam &&
      matchTier
    );
  });

  // Tính toán tổng số trang
  const totalPages = Math.ceil(filteredGroups.length / itemsPerPage);

  // Cắt mảng dữ liệu cho trang hiện tại
  const paginatedGroups = filteredGroups.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  // Thuật toán tạo dải 5 nút phân trang dạng trượt (Sliding Window)
  const getPaginationNumbers = () => {
    const maxButtons = 5;
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, currentPage + 2);

    if (totalPages > maxButtons) {
      // Nếu bị sát dải đầu (trang 1, 2)
      if (currentPage <= 3) {
        start = 1;
        end = maxButtons;
      }
      // Nếu bị sát dải cuối
      else if (currentPage >= totalPages - 2) {
        start = totalPages - maxButtons + 1;
        end = totalPages;
      }
    } else {
      start = 1;
      end = totalPages;
    }

    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return { pages, start, end };
  };
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const {
    pages: pageNumbers,
    start: startPage,
    end: endPage,
  } = getPaginationNumbers();

  const intentChips = [
    { id: "all", label: "Tất cả Intent" },
    ...(dynCategories.intent || []).map((c) => ({
      id: (c.code || c.value || c.name || "").toLowerCase(),
      label: c.name || c.value || c.code || "",
    })),
  ];

  const industryChips = [
    { id: "all", label: "Tất cả Ngành" },
    ...(dynCategories.industry || []).map((c) => ({
      id: (c.code || c.value || c.name || "").toLowerCase(),
      label: `📂 ${c.name || c.value || c.code || ""}`,
    })),
  ];

  const teamChips = [
    { id: "all", label: "Tất cả Team" },
    ...(dynCategories.team || []).map((c) => ({
      id: (c.code || c.value || "").toLowerCase(),
      label: c.code || c.value || c.name || "",
    })),
  ];

  const tierChips = [
    { id: "all", label: "Tất cả Tier" },
    ...(dynCategories.tier || []).map((c) => {
      const v = c.code || c.value || c.name || "";
      const name = c.name || `Tier ${v}`;
      const icon = name.split(" ")[0] || "🔥";
      const title = name.substring(icon.length).trim() || `Tier ${v}`;
      return {
        id: String(v).toLowerCase(),
        label: `${icon} ${title}`,
      };
    }),
  ];

  return (
    <div className="flex w-full flex-col gap-lg font-sans">
      <PlatformStatsRow>
        <PlatformStatCard
          label="Tổng Groups"
          value={totalGroups}
          hint="Trong phạm vi lọc"
          accent="primary"
        />
        <PlatformStatCard
          label="Đang sống"
          value={activeGroups}
          hintTone="up"
          accent="success"
        />
        <PlatformStatCard
          label="Post mới / tuần"
          value={totalPostsPerWeek}
          accent="warning"
        />
        <PlatformStatCard
          label="Cần check"
          value={needCheckCount}
          hint="Thiếu taxonomy hoặc DEAD"
          hintTone="down"
          accent="error"
        />
      </PlatformStatsRow>

      <div className="flex items-center justify-end">
        <button
          type="button"
          className="bg-primary text-on-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-md py-sm text-sm font-bold transition"
          onClick={() => setIsCreateOpen(true)}
        >
          <MaterialIcon name="add" className="text-[18px]" />
          Thêm Group Mới
        </button>
      </div>

      <div className="border-outline-variant bg-surface flex flex-col overflow-hidden rounded-xl border">
        {/* THANH TÌM KIẾM & BỘ LỌC */}
        <div className="border-outline-variant flex flex-col gap-md border-b p-md">
          <div className="flex flex-col items-start justify-between gap-sm sm:flex-row sm:items-center">
            <h2 className="text-label-md text-on-surface font-bold">
              Danh sách Groups
            </h2>
            <p className="text-on-surface-variant text-[11px]">
              Hiển thị {filteredGroups.length} / {scopeGroups.length} groups
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-sm">
            <div className="relative min-w-[200px] flex-1 sm:flex-none sm:w-60">
              <input
                type="text"
                placeholder="Tìm group..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="border-outline-variant bg-surface focus:border-primary focus:ring-primary w-full rounded-lg border px-md py-sm text-xs outline-none focus:ring-1 transition-colors"
              />
            </div>
            {!forcedPlatform ? (
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="border-outline-variant bg-surface focus:border-primary focus:ring-primary rounded-lg border px-md py-sm text-xs outline-none focus:ring-1 cursor-pointer transition-colors"
              >
                <option value="all">Tất cả platform</option>
                <option value="facebook">Facebook</option>
                <option value="linkedin">LinkedIn</option>
              </select>
            ) : null}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border-outline-variant bg-surface focus:border-primary focus:ring-primary rounded-lg border px-md py-sm text-xs outline-none focus:ring-1 cursor-pointer transition-colors"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Sống</option>
              <option value="idle">Ít HĐ</option>
              <option value="dead">Chết</option>
            </select>
            <select
              value={intentFilter}
              onChange={(e) => setIntentFilter(e.target.value)}
              className="border-outline-variant bg-surface focus:border-primary focus:ring-primary rounded-lg border px-md py-sm text-xs outline-none focus:ring-1 cursor-pointer transition-colors"
            >
              {intentChips.map((chip) => (
                <option key={chip.id} value={chip.id}>
                  {chip.label}
                </option>
              ))}
            </select>
            
            {/* Bộ lọc Ngành */}
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="border-outline-variant bg-surface focus:border-primary focus:ring-primary rounded-lg border px-md py-sm text-xs outline-none focus:ring-1 cursor-pointer transition-colors"
            >
              <option value="all">Tất cả Ngành</option>
              {industryChips.filter(c => c.id !== "all").map((chip) => (
                <option key={chip.id} value={chip.id}>
                  {chip.label.replace("📂 ", "")}
                </option>
              ))}
            </select>

            {/* Bộ lọc Team */}
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="border-outline-variant bg-surface focus:border-primary focus:ring-primary rounded-lg border px-md py-sm text-xs outline-none focus:ring-1 cursor-pointer transition-colors"
            >
              <option value="all">Tất cả Team</option>
              {teamChips.filter(c => c.id !== "all").map((chip) => (
                <option key={chip.id} value={chip.id}>
                  {chip.label}
                </option>
              ))}
            </select>

            {/* Bộ lọc Tier */}
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="border-outline-variant bg-surface focus:border-primary focus:ring-primary rounded-lg border px-md py-sm text-xs outline-none focus:ring-1 cursor-pointer transition-colors"
            >
              <option value="all">Tất cả Tier</option>
              {tierChips.filter(c => c.id !== "all").map((chip) => (
                <option key={chip.id} value={chip.id}>
                  {chip.label}
                </option>
              ))}
            </select>

            {/* Nút Xóa bộ lọc */}
            {(searchTerm !== "" ||
              platformFilter !== (forcedPlatform || "all") ||
              statusFilter !== "all" ||
              intentFilter !== "all" ||
              industryFilter !== "all" ||
              teamFilter !== "all" ||
              tierFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setPlatformFilter(forcedPlatform || "all");
                  setStatusFilter("all");
                  setIntentFilter("all");
                  setIndustryFilter("all");
                  setTeamFilter("all");
                  setTierFilter("all");
                }}
                className="border-outline-variant hover:border-error hover:text-error text-on-surface-variant flex items-center gap-1 rounded-lg border px-md py-sm text-xs font-bold transition cursor-pointer"
              >
                <MaterialIcon name="filter_alt_off" className="text-[16px]" />
                Xóa bộ lọc
              </button>
            )}
          </div>
        </div>

        {/* THÔNG BÁO LỖI NẾU CÓ */}
        {errorGroups && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-medium">
            {errorGroups}
          </div>
        )}

        {/* BẢNG DỮ LIỆU */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-5">Tên Group</th>
                <th className="py-3 px-4">Platform</th>
                <th className="py-3 px-4">Taxonomy</th>
                <th className="py-3 px-4">Thành viên</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Intent</th>
                <th className="py-3 px-5 text-center">Hành động</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-xs text-slate-600">
              {isLoadingGroups ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải dữ liệu...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedGroups.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-12 text-center text-slate-400 italic"
                  >
                    Không tìm thấy Group nào phù hợp.
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group) => {
                  const platform = detectPlatform(group.url);
                  const isDead = group.status === "DEAD";

                  return (
                    <tr
                      key={group.url}
                      className="hover:bg-slate-50/50 transition duration-150"
                    >
                      <td className="py-4 px-5 max-w-[250px]">
                        <div className="font-bold text-slate-900 truncate">
                          {group.group_name}
                        </div>
                        <a
                          href={
                            group.url.startsWith("http")
                              ? group.url
                              : `https://${group.url}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-slate-400 hover:text-blue-600 hover:underline truncate block mt-0.5"
                        >
                          {group.url.replace(/^https?:\/\//, "")}
                        </a>
                      </td>
                      <td className="py-4 px-4 font-medium text-slate-700">
                        <div className="flex items-center gap-2">
                          {renderPlatformIcon(platform)}
                          <span>{platform}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">{renderTaxonomyTags(group)}</td>
                      <td className="py-4 px-4 font-medium text-slate-700">
                        {group.members?.toLocaleString() || "0"}
                      </td>
                      <td className="py-4 px-4">
                        {renderStatusBadge(group.status)}
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-medium text-slate-700">
                          {(() => {
                            if (!group.intent) return <span className="italic text-slate-400">-</span>;
                            const match = dynCategories.intent?.find(
                              (c) => (c.code || c.value || "").toLowerCase() === group.intent.toLowerCase()
                            );
                            return match ? match.name || match.value : group.intent;
                          })()}
                        </span>
                      </td>

                      <td className="py-4 px-5">
                        {isDead ? (
                          <span className="text-slate-400 text-xs italic">
                            Vô hiệu
                          </span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => {
                                setSelectedGroupForUpdate(group);
                                setIsUpdateModalOpen(true);
                              }}
                              title="Sửa group"
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition"
                              disabled={isDeleting}
                            >
                              <MaterialIcon
                                name="edit"
                                className="text-[16px]"
                              />
                            </button>
                            <button
                              onClick={() => void handleDelete(group)}
                              title="Xóa group"
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition"
                              disabled={isDeleting}
                            >
                              <MaterialIcon
                                name="delete"
                                className="text-[16px]"
                              />
                            </button>
                            <button
                              onClick={() => window.open(group.url, "_blank")}
                              title="Xem group trên nền tảng"
                              className="p-1.5 text-violet-600 hover:bg-violet-50 rounded-md transition"
                            >
                              <MaterialIcon
                                name="open_in_new"
                                className="text-[16px]"
                              />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* FOOTER PHÂN TRANG */}
        {!isLoadingGroups && totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white">
            <div className="text-xs text-slate-500">
              Hiển thị{" "}
              <span className="font-bold text-slate-700">
                {(currentPage - 1) * itemsPerPage + 1}
              </span>{" "}
              -{" "}
              <span className="font-bold text-slate-700">
                {Math.min(currentPage * itemsPerPage, filteredGroups.length)}
              </span>{" "}
              trong số{" "}
              <span className="font-bold text-slate-700">
                {filteredGroups.length}
              </span>{" "}
              groups
            </div>

            <div className="flex items-center gap-1">
              {/* Nút Previous */}
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Trước
              </button>

              {/* Dấu ... ở đầu nếu dải trang hiển thị không bắt đầu từ 1 */}
              {startPage > 1 && (
                <>
                  <button
                    onClick={() => setCurrentPage(1)}
                    className="w-7 h-7 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                  >
                    1
                  </button>
                  {startPage > 2 && (
                    <span className="px-1 text-slate-400 text-xs">...</span>
                  )}
                </>
              )}

              {/* Các nút số trong sliding window */}
              {pageNumbers.map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-7 h-7 text-xs font-medium rounded-lg transition ${
                    currentPage === page
                      ? "bg-violet-600 text-white font-bold shadow-sm shadow-violet-200"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {page}
                </button>
              ))}

              {/* Dấu ... ở cuối nếu dải trang hiển thị chưa tới trang cuối */}
              {endPage < totalPages && (
                <>
                  {endPage < totalPages - 1 && (
                    <span className="px-1 text-slate-400 text-xs">...</span>
                  )}
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    className="w-7 h-7 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                  >
                    {totalPages}
                  </button>
                </>
              )}

              {/* Nút Next */}
              <button
                onClick={() =>
                  setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                }
                disabled={currentPage === totalPages}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>
      <CreateGroupModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
      <UpdateGroupModal
        isOpen={isUpdateModalOpen}
        onClose={() => {
          setIsUpdateModalOpen(false);
          setSelectedGroupForUpdate(null);
        }}
        group={selectedGroupForUpdate}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["presetGroups"] });
        }}
      />
    </div>
  );
}
