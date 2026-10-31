"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { crawlScheduleHistoryService } from "@/services/all-platform.service";
import type {
  CrawlScheduleHistoryData,
  CrawlScheduleRoundItem,
} from "@/types/unified.types";

export type TimeRangeKey =
  | "all"
  | "today"
  | "yesterday"
  | "last_week"
  | "last_month"
  | "last_year"
  | "custom";

export function CrawlScheduleHistoryPanel() {
  const { user } = useAppAuth();
  const [data, setData] = useState<CrawlScheduleHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedMember, setSelectedMember] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("all");
  const [specificDate, setSpecificDate] = useState<string>("");

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await crawlScheduleHistoryService.getHistory({
        email: user?.email,
        id_member: selectedMember === "all" ? undefined : selectedMember,
        time_range: timeRange,
        specific_date: timeRange === "custom" ? specificDate : undefined,
        limit: 150,
      });
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.message || "Không thể tải lịch sử vòng cào.");
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Đã có lỗi xảy ra khi nạp lịch sử cào."
      );
    } finally {
      setLoading(false);
    }
  }, [user?.email, selectedMember, timeRange, specificDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset về trang 1 khi đổi bộ lọc
  const handleFilterChange = (newMember?: string, newRange?: TimeRangeKey, newDate?: string) => {
    if (newMember !== undefined) setSelectedMember(newMember);
    if (newRange !== undefined) setTimeRange(newRange);
    if (newDate !== undefined) setSpecificDate(newDate);
    setCurrentPage(1);
  };

  const summary = data?.summary || {
    total_rounds: 0,
    total_posts: 0,
    total_ai_passed: 0,
    facebook_total: 0,
    linkedin_total: 0,
    threads_total: 0,
    overall_ai_pass_rate: 0,
  };

  const allRounds = useMemo(() => data?.rounds || [], [data?.rounds]);
  const members = data?.members || [];

  // Tính toán phân trang
  const totalRounds = allRounds.length;
  const totalPages = Math.max(1, Math.ceil(totalRounds / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedRounds = useMemo(() => {
    const startIndex = (activePage - 1) * pageSize;
    return allRounds.slice(startIndex, startIndex + pageSize);
  }, [allRounds, activePage, pageSize]);

  // Danh sách nút số trang hiển thị thông minh
  const pageNumbers = useMemo(() => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (activePage > 3) pages.push("...");
      const start = Math.max(2, activePage - 1);
      const end = Math.min(totalPages - 1, activePage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (activePage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, activePage]);

  const handlePageChange = (p: number) => {
    if (p >= 1 && p <= totalPages) {
      setCurrentPage(p);
      // Cuộn nhẹ lên đầu danh sách vòng
      const el = document.getElementById("rounds-list-container");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* 1. Header Overview & KPI Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-[#be123c]">
              history
            </span>
            TỔNG SỐ VÒNG CÀO
          </div>
          <div className="text-2xl font-black text-gray-900 tracking-tight">
            {summary.total_rounds}{" "}
            <span className="text-xs font-normal text-gray-500">vòng</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">
            Đợt cào theo lịch tự động
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-blue-600">
              newspaper
            </span>
            TỔNG BÀI THU ĐƯỢC
          </div>
          <div className="text-2xl font-black text-blue-700 tracking-tight">
            {summary.total_posts}{" "}
            <span className="text-xs font-normal text-gray-500">bài viết</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">
            FB {summary.facebook_total} · LI {summary.linkedin_total} · TH{" "}
            {summary.threads_total}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-emerald-600">
              bolt
            </span>
            BÀI VƯỢT AI CHECK
          </div>
          <div className="text-2xl font-black text-emerald-700 tracking-tight">
            {summary.total_ai_passed}{" "}
            <span className="text-xs font-normal text-gray-500">
              ({summary.overall_ai_pass_rate}%)
            </span>
          </div>
          <div className="text-[11px] text-emerald-600 mt-1 font-medium">
            Đạt điểm chất lượng ≥ 40
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-purple-600">
              dns
            </span>
            PHÂN LOẠI TÀI KHOẢN
          </div>
          <div className="text-sm font-bold text-gray-800 tracking-tight mt-1 flex flex-col gap-0.5">
            <span className="text-xs text-purple-700 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span>{" "}
              accsystem crawler (VPS)
            </span>
            <span className="text-xs text-blue-700 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span> Tài
              khoản thành viên
            </span>
          </div>
        </div>
      </div>

      {/* 2. Bộ Lọc Thời Gian & Người Dùng Mở Rộng */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Hàng 1: Dropdown User + Quick Filters Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Dropdown User Picker */}
            <div className="relative min-w-[240px] max-w-[320px]">
              <select
                value={selectedMember}
                onChange={(e) => handleFilterChange(e.target.value, undefined, undefined)}
                className="w-full text-xs font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-[#be123c]/20 focus:border-[#be123c] cursor-pointer"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.is_system
                      ? `🤖 [Hệ thống] ${m.name}`
                      : `👤 ${m.name} (${m.email})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Time range buttons switcher */}
            <div className="flex flex-wrap items-center bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs gap-0.5">
              {(
                [
                  { key: "all", label: "Tất cả" },
                  { key: "today", label: "Hôm nay" },
                  { key: "yesterday", label: "Ngày qua" },
                  { key: "last_week", label: "Tuần qua" },
                  { key: "last_month", label: "Tháng qua" },
                  { key: "last_year", label: "Năm qua" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    handleFilterChange(undefined, t.key, "");
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-semibold transition cursor-pointer",
                    timeRange === t.key && !specificDate
                      ? "bg-white text-[#be123c] shadow-2xs"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hàng 2 bên phải: Chọn ngày bất kỳ + Reload */}
          <div className="flex items-center gap-2">
            {/* Custom Specific Date Picker */}
            <div className="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200 text-xs">
              <span className="material-symbols-outlined text-[16px] text-gray-500">
                calendar_today
              </span>
              <span className="text-[11px] font-semibold text-gray-500">
                Chọn ngày:
              </span>
              <input
                type="date"
                value={specificDate}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    handleFilterChange(undefined, "custom", val);
                  } else {
                    handleFilterChange(undefined, "all", "");
                  }
                }}
                className={cn(
                  "bg-transparent text-xs font-semibold focus:outline-none cursor-pointer",
                  specificDate ? "text-[#be123c]" : "text-gray-700"
                )}
              />
              {specificDate && (
                <button
                  type="button"
                  onClick={() => handleFilterChange(undefined, "all", "")}
                  title="Xoá chọn ngày"
                  className="text-gray-400 hover:text-rose-600 text-xs px-1 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Reload button */}
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer disabled:opacity-50 transition"
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[16px]",
                  loading && "animate-spin"
                )}
              >
                refresh
              </span>
              Làm mới
            </button>
          </div>
        </div>

        {/* Thông báo trạng thái bộ lọc đang chọn */}
        <div className="text-[11px] text-gray-500 flex items-center justify-between pt-2 border-t border-gray-100">
          <div>
            Đang lọc:{" "}
            <span className="font-bold text-gray-800">
              {specificDate
                ? `Ngày cụ thể ${specificDate}`
                : timeRange === "all"
                ? "Tất cả thời gian"
                : timeRange === "today"
                ? "Hôm nay"
                : timeRange === "yesterday"
                ? "Ngày qua (Hôm qua)"
                : timeRange === "last_week"
                ? "Tuần qua (7 ngày gần nhất)"
                : timeRange === "last_month"
                ? "Tháng qua (30 ngày gần nhất)"
                : timeRange === "last_year"
                ? "Năm qua (365 ngày gần nhất)"
                : timeRange}
            </span>
            {" · "}
            Tổng tìm thấy:{" "}
            <span className="font-bold text-blue-700">{totalRounds} vòng</span>
          </div>

          {/* Chọn số mục hiển thị trên mỗi trang */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">Hiển thị:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="text-[11px] font-semibold bg-gray-50 border border-gray-200 rounded px-2 py-0.5 cursor-pointer text-gray-700 focus:outline-none"
            >
              <option value={10}>10 vòng / trang</option>
              <option value={20}>20 vòng / trang</option>
              <option value={50}>50 vòng / trang</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Error Banner */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {error}
        </div>
      )}

      {/* 4. Danh Sách Vòng Cào & Phân Trang */}
      <div id="rounds-list-container" className="space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-white p-5 rounded-2xl border border-gray-100 shadow-2xs animate-pulse space-y-3"
              >
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                <div className="h-8 bg-gray-100 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : totalRounds === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center shadow-2xs">
            <div className="w-14 h-14 bg-rose-50 text-[#be123c] rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="material-symbols-outlined text-[28px]">
                schedule
              </span>
            </div>
            <h3 className="text-base font-bold text-gray-900">
              Không có lịch sử vòng cào phù hợp
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              Không tìm thấy đợt cào nào trong khoảng thời gian hoặc tài khoản đã
              chọn. Hãy thử chuyển sang{" "}
              <span className="font-semibold text-gray-700">"Tất cả"</span> hoặc
              chọn ngày khác.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {paginatedRounds.map((round) => (
                <RoundCard key={round.id} round={round} />
              ))}
            </div>

            {/* 5. Khối Phân Trang (Pagination Control) */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
                {/* Thông tin số lượng trang */}
                <div className="text-xs text-gray-600 font-medium">
                  Hiển thị từ{" "}
                  <span className="font-bold text-gray-900">
                    {(activePage - 1) * pageSize + 1}
                  </span>{" "}
                  đến{" "}
                  <span className="font-bold text-gray-900">
                    {Math.min(activePage * pageSize, totalRounds)}
                  </span>{" "}
                  trên tổng số{" "}
                  <span className="font-bold text-[#be123c]">{totalRounds}</span>{" "}
                  vòng cào
                </div>

                {/* Các nút bấm phân trang */}
                <div className="flex items-center gap-1 text-xs">
                  {/* Nút Về Đầu */}
                  <button
                    type="button"
                    onClick={() => handlePageChange(1)}
                    disabled={activePage === 1}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-gray-700 transition cursor-pointer"
                    title="Về trang đầu"
                  >
                    « Đầu
                  </button>

                  {/* Nút Lùi 1 trang */}
                  <button
                    type="button"
                    onClick={() => handlePageChange(activePage - 1)}
                    disabled={activePage === 1}
                    className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-gray-700 transition cursor-pointer flex items-center justify-center"
                    title="Trang trước"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      chevron_left
                    </span>
                  </button>

                  {/* Danh sách các số trang */}
                  {pageNumbers.map((p, idx) =>
                    p === "..." ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-2 py-1 text-gray-400 select-none"
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={`page-${p}`}
                        type="button"
                        onClick={() => handlePageChange(p)}
                        className={cn(
                          "min-w-[32px] h-8 rounded-lg font-bold text-xs transition cursor-pointer",
                          activePage === p
                            ? "bg-[#be123c] text-white shadow-xs"
                            : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                        )}
                      >
                        {p}
                      </button>
                    )
                  )}

                  {/* Nút Tiếp theo */}
                  <button
                    type="button"
                    onClick={() => handlePageChange(activePage + 1)}
                    disabled={activePage === totalPages}
                    className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-gray-700 transition cursor-pointer flex items-center justify-center"
                    title="Trang tiếp"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      chevron_right
                    </span>
                  </button>

                  {/* Nút Đến Cuối */}
                  <button
                    type="button"
                    onClick={() => handlePageChange(totalPages)}
                    disabled={activePage === totalPages}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-gray-700 transition cursor-pointer"
                    title="Đến trang cuối"
                  >
                    Cuối »
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RoundCard({ round }: { round: CrawlScheduleRoundItem }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs hover:border-rose-100 transition duration-150 space-y-4">
      {/* Top row: Vòng #, Tiêu đề lịch, Status, Ngày giờ, Thời lượng */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-gray-100">
        <div className="flex flex-wrap items-center gap-2">
          {/* Badge Vòng */}
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black bg-rose-50 text-[#be123c] border border-rose-200 tracking-tight">
            <span className="material-symbols-outlined text-[14px]">autorenew</span>
            {round.round_label}
          </span>

          <span className="text-xs font-bold text-gray-800">
            {round.schedule_label}
          </span>

          {/* Status Badge */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Hoàn tất
          </span>
        </div>

        {/* Ngày giờ & Duration */}
        <div className="flex items-center gap-3 text-xs text-gray-600 font-medium">
          <span className="inline-flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200/60 font-semibold text-gray-800">
            <span className="material-symbols-outlined text-[15px] text-[#be123c]">
              calendar_month
            </span>
            {round.started_at_formatted}
          </span>
          <span className="inline-flex items-center gap-1 bg-amber-50/80 px-2.5 py-1 rounded-lg border border-amber-200/60 font-semibold text-amber-900">
            <span className="material-symbols-outlined text-[15px] text-amber-600">
              timer
            </span>
            Cào trong: {round.duration_formatted}
          </span>
        </div>
      </div>

      {/* Middle row: Thông tin người dùng / Hệ thống */}
      <div className="flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center font-black text-xs",
              round.is_system
                ? "bg-purple-100 text-purple-700 border border-purple-200"
                : "bg-rose-100 text-[#be123c] border border-rose-200"
            )}
          >
            {round.is_system ? (
              <span className="material-symbols-outlined text-[16px]">dns</span>
            ) : (
              (round.user_name || "U").charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-gray-900 text-xs">
                {round.user_name}
              </span>
              {round.is_system ? (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                  accsystem crawler
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  Thành viên
                </span>
              )}
            </div>
            {round.user_email && (
              <div className="text-[11px] text-gray-400 font-normal">
                {round.user_email}
              </div>
            )}
          </div>
        </div>

        {/* Tổng bài tóm tắt */}
        <div className="text-right">
          <div className="text-xs font-bold text-gray-900">
            Tổng cộng:{" "}
            <span className="text-blue-700 font-black">
              {round.total_posts} bài
            </span>
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 justify-end">
            <span className="material-symbols-outlined text-[13px]">bolt</span>
            {round.total_ai_passed} bài vượt AI ({round.ai_pass_rate}%)
          </div>
        </div>
      </div>

      {/* Bottom row: Chi tiết 3 kênh: Facebook, LinkedIn, Threads */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        {/* Facebook */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/50 border border-blue-100/70">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-[10px]">
              FB
            </div>
            <div>
              <div className="font-bold text-gray-900 text-xs">Facebook</div>
              <div className="text-[11px] text-gray-500 font-normal">
                {round.facebook.posts_count} bài viết
              </div>
            </div>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold",
                round.facebook.ai_passed_count > 0
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              <span className="material-symbols-outlined text-[13px]">bolt</span>
              {round.facebook.ai_passed_count} đạt AI
            </span>
          </div>
        </div>

        {/* LinkedIn */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-sky-50/50 border border-sky-100/70">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#0077b5] text-white flex items-center justify-center font-bold text-[10px]">
              LI
            </div>
            <div>
              <div className="font-bold text-gray-900 text-xs">LinkedIn</div>
              <div className="text-[11px] text-gray-500 font-normal">
                {round.linkedin.posts_count} bài viết
              </div>
            </div>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold",
                round.linkedin.ai_passed_count > 0
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              <span className="material-symbols-outlined text-[13px]">bolt</span>
              {round.linkedin.ai_passed_count} đạt AI
            </span>
          </div>
        </div>

        {/* Threads */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-200/70">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-black text-white flex items-center justify-center font-bold text-[10px]">
              TH
            </div>
            <div>
              <div className="font-bold text-gray-900 text-xs">Threads</div>
              <div className="text-[11px] text-gray-500 font-normal">
                {round.threads.posts_count} bài viết
              </div>
            </div>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold",
                round.threads.ai_passed_count > 0
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              <span className="material-symbols-outlined text-[13px]">bolt</span>
              {round.threads.ai_passed_count} đạt AI
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
