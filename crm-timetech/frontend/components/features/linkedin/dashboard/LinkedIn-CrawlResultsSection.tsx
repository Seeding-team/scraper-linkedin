"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/ui";

import {
  statusBadgeClasses,
  statusLabel,
} from "@/components/features/dashboard/dashboard-helpers";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { CrawlSessionsTableCore } from "@/components/features/linkedin/dashboard/LinkedIn-CrawlSessionsTableCore";
import { useGroupIntentMap } from "@/hooks/useGroupIntentMap";

export function CrawlResultsSection() {
  const d = useDashboard();
  const [filterMode, setFilterMode] = useState<string>("all");
  const { linkedinIntents, isLoading: isIntentLoading } = useGroupIntentMap(d.email);

  const isFiltered = d.crawlTableViewMode === "filtered";
  const isDataLoading = isIntentLoading || d.crawlSessionsForTable === null;

  useEffect(() => {
    if (!isFiltered) {
      setFilterMode("all");
    }
  }, [isFiltered]);

  const busyHint = isFiltered
    ? "Đang lọc dữ liệu (/filter-data)…"
    : "Đang tải dữ liệu phiên (/get-all-posts)…";

  const emptyAll =
    "Chưa có phiên cào từ n8n. Thử «Làm mới» để gọi lại /get-all-posts.";
  const emptyFiltered =
    "Không có phiên nào khớp điều kiện filter. Bấm «Xóa lọc» để quay lại danh sách đầy đủ.";

  if (isDataLoading) {
    return (
      <section className="border-outline-variant bg-surface-container-lowest rounded-xl border p-lg shadow-sm">
        <div className="mb-md">
          <h2 className="text-h2 text-on-surface font-semibold">Kết quả Crawl</h2>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-on-surface-variant text-sm font-medium">Đang tải dữ liệu...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm flex flex-col gap-6 font-sans">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Kết quả Crawl LinkedIn</h2>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide border ${
                isFiltered
                  ? "bg-amber-50 text-amber-700 border-amber-100"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              {isFiltered ? "Đang xem: đã lọc" : "Đang xem: tất cả phiên"}
            </span>
            <span className="text-sm text-slate-700 font-bold tabular-nums">
              {d.crawlSessionsTableBusy
                ? "…"
                : `${d.displayedCrawlSessionCount.toLocaleString("vi-VN")} phiên · ${d.displayedCrawlPostCount.toLocaleString("vi-VN")} bài`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isFiltered ? (
              <>
                <button
                  type="button"
                  className="border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-bold text-xs flex items-center gap-1.5 px-4 py-2 rounded-xl transition duration-150 shadow-sm"
                  onClick={d.showAllCrawlSessions}
                  disabled={d.isGettingAllPosts}
                >
                  Xem tất cả phiên
                </button>
                <button
                  type="button"
                  className="border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-bold text-xs flex items-center gap-1.5 px-4 py-2 rounded-xl transition duration-150 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={d.handleClearCrawlFilter}
                  disabled={d.isGettingAllPosts}
                >
                  <MaterialIcon
                    name="filter_alt_off"
                    className="shrink-0 text-[18px]"
                  />
                  Xóa lọc
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="bg-[#E3000F] hover:bg-[#C40009] active:bg-[#C40009] text-white font-bold text-xs flex items-center gap-1.5 px-4 py-2 rounded-xl transition duration-150 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                d.handleGetAllPosts();
              }}
              disabled={d.isGettingAllPosts || d.isSyncingAllProgress}
              title="Lấy danh sách phiên cào mới nhất từ Supabase"
            >
              <MaterialIcon name="refresh" className="shrink-0 text-[18px]" />
              Làm mới
            </button>
            <button
              type="button"
              className="border border-[#E3000F]/20 bg-white text-[#E3000F] hover:bg-[#E3000F]/10 hover:border-[#E3000F]/40 font-bold text-xs flex items-center gap-1.5 px-4 py-2 rounded-xl transition duration-150 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              onClick={d.handleSyncAllProgress}
              disabled={d.isSyncingAllProgress || d.isGettingAllPosts}
              title="Quét lại toàn bộ bài viết để cập nhật reaction và comment thực tế từ LinkedIn"
            >
              <MaterialIcon
                name="sync"
                className={`shrink-0 text-[18px] ${d.isSyncingAllProgress ? "animate-spin" : ""}`}
              />
              {d.isSyncingAllProgress ? "Đang đồng bộ…" : "Làm mới tiến độ"}
            </button>
          </div>
        </div>

        {/* THÀNH BỘ LỌC ĐỒNG BỘ STYLE VỚI FACEBOOK */}
        <div className="bg-slate-50/50 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          {/* Dropdown Chọn kiểu lọc ngày */}
          <select
            value={filterMode}
            onChange={(e) => {
              const val = e.target.value;
              setFilterMode(val);
              if (val === "all") {
                d.handleClearCrawlFilter();
              } else if (val === "today") {
                d.handleFilterToday();
              } else if (val === "yesterday") {
                d.handleFilterYesterday();
              } else if (val === "last_7_days") {
                d.handleFilterLast7Days();
              } else if (val === "last_30_days") {
                d.handleFilterLast30Days();
              }
            }}
            className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[150px]"
          >
            <option value="all">Thời gian: Tất cả</option>
            <option value="today">Thời gian: Hôm nay</option>
            <option value="yesterday">Thời gian: Hôm qua</option>
            <option value="last_7_days">Thời gian: 7 ngày gần nhất</option>
            <option value="last_30_days">Thời gian: 30 ngày gần nhất</option>
            <option value="custom_range">Thời gian: Khoảng ngày...</option>
            <option value="single_date">Thời gian: Một ngày...</option>
          </select>

          {/* Hiện input khoảng ngày nếu chọn custom_range */}
          {filterMode === "custom_range" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="border border-slate-200 bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none transition shadow-sm"
                value={d.filterDateFrom}
                onChange={(e) => d.setFilterDateFrom(e.target.value)}
                placeholder="Từ ngày"
                disabled={d.isFiltering || d.isGettingAllPosts}
              />
              <span className="text-xs text-slate-400">→</span>
              <input
                type="date"
                className="border border-slate-200 bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none transition shadow-sm"
                value={d.filterDateTo}
                onChange={(e) => d.setFilterDateTo(e.target.value)}
                placeholder="Đến ngày"
                disabled={d.isFiltering || d.isGettingAllPosts}
              />
              <button
                type="button"
                onClick={d.handleFilterDateRange}
                disabled={d.isFiltering}
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition shadow-sm"
              >
                {d.isFiltering ? "Đang lọc..." : "Lọc"}
              </button>
            </div>
          )}

          {/* Hiện input một ngày nếu chọn single_date */}
          {filterMode === "single_date" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="border border-slate-200 bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none transition shadow-sm"
                value={d.filterDate}
                onChange={(e) => d.setFilterDate(e.target.value)}
                disabled={d.isFiltering || d.isGettingAllPosts}
              />
              <button
                type="button"
                onClick={d.handleFilterSingleDate}
                disabled={d.isFiltering}
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition shadow-sm"
              >
                {d.isFiltering ? "Đang lọc..." : "Lọc"}
              </button>
            </div>
          )}

          {/* Dropdown Chọn Intent (Đồng bộ kiểu Facebook) */}
          <select
            value={d.filterIntent}
            onChange={(e) => d.handleFilterIntent(e.target.value)}
            className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[130px]"
            disabled={d.isFiltering || d.isGettingAllPosts}
          >
            <option value="all">Tất cả intent</option>
            {linkedinIntents.map((intentName, idx) => (
              <option key={idx} value={intentName}>
                {intentName}
              </option>
            ))}
          </select>

          {/* Nút Xóa lọc & reload */}
          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setFilterMode("all");
                d.handleClearCrawlFilter();
              }}
              disabled={d.isFiltering}
              className="border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-bold text-xs flex items-center gap-1.5 px-4 py-2 rounded-xl transition duration-150 shadow-sm disabled:opacity-50 sm:ml-auto"
              title="Xóa lọc và làm mới"
            >
              <MaterialIcon name="filter_alt_off" className="text-[18px]" />
              <span>Xóa lọc</span>
            </button>
          )}
        </div>

        {isFiltered ? (
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Điều kiện: </span>
            {d.filterAppliedLabel.trim() || "—"}
          </p>
        ) : null}
      </div>

      {d.filterError ? (
        <div
          className="border-error-container bg-error-container/40 text-error mb-md rounded-lg border px-md py-sm text-body-sm"
          role="alert"
        >
          {d.filterError}
        </div>
      ) : null}

      {d.allPostsError && d.crawlTableViewMode === "all" ? (
        <div
          className="border-error-container bg-error-container/40 text-error mb-md rounded-lg border px-md py-sm text-body-sm"
          role="alert"
        >
          {d.allPostsError}
        </div>
      ) : null}

      {d.allPostsMessage && d.crawlTableViewMode === "all" ? (
        <div
          className="border-secondary-container bg-secondary-container/20 text-on-secondary-container mb-md rounded-lg border px-md py-sm text-body-sm"
          role="status"
        >
          {d.allPostsMessage}
        </div>
      ) : null}

      {d.filterMessage && d.crawlTableViewMode === "filtered" ? (
        <div
          className="border-secondary-container bg-secondary-container/20 text-on-secondary-container mb-md rounded-lg border px-md py-sm text-body-sm"
          role="status"
        >
          {d.filterMessage}
        </div>
      ) : null}

      <CrawlSessionsTableCore
        sessions={d.crawlSessionsForTable}
        busy={d.crawlSessionsTableBusy}
        loadingHint={busyHint}
        emptyHint={isFiltered ? emptyFiltered : emptyAll}
        tableVariant={d.crawlTableViewMode}
        filterAppliedLabel={d.filterAppliedLabel}
        modalTitleSuffix={isFiltered ? "(filter-data)" : "(get-all-posts)"}
        dashboardEmail={d.email?.trim() || null}
        refreshSessionsAfterReaction={d.refreshDashboardData}
        refreshSessionsBusy={d.isGettingAllPosts}
      />
    </section>
  );
}
