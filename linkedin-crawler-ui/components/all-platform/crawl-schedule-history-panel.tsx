"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  crawlScheduleHistoryService,
} from "@/services/all-platform.service";
import type {
  CrawlScheduleHistoryData,
  CrawlScheduleRoundItem,
} from "@/types/unified.types";

export function CrawlScheduleHistoryPanel() {
  const { user } = useAppAuth();
  const [data, setData] = useState<CrawlScheduleHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedMember, setSelectedMember] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<"all" | "today" | "this_week" | "this_month">("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await crawlScheduleHistoryService.getHistory({
        email: user?.email,
        id_member: selectedMember === "all" ? undefined : selectedMember,
        time_range: timeRange,
        limit: 80,
      });
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.message || "Không thể tải lịch sử vòng cào.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra khi nạp lịch sử cào.");
    } finally {
      setLoading(false);
    }
  }, [user?.email, selectedMember, timeRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = data?.summary || {
    total_rounds: 0,
    total_posts: 0,
    total_ai_passed: 0,
    facebook_total: 0,
    linkedin_total: 0,
    threads_total: 0,
    overall_ai_pass_rate: 0,
  };

  const rounds = data?.rounds || [];
  const members = data?.members || [];

  return (
    <div className="w-full space-y-6">
      {/* 1. Header Overview & KPI Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-[#be123c]">history</span>
            TỔNG SỐ VÒNG CÀO
          </div>
          <div className="text-2xl font-black text-gray-900 tracking-tight">
            {summary.total_rounds}{" "}
            <span className="text-xs font-normal text-gray-500">vòng</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Đợt cào theo lịch tự động</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-blue-600">newspaper</span>
            TỔNG BÀI THU ĐƯỢC
          </div>
          <div className="text-2xl font-black text-blue-700 tracking-tight">
            {summary.total_posts}{" "}
            <span className="text-xs font-normal text-gray-500">bài viết</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">FB {summary.facebook_total} · LI {summary.linkedin_total} · TH {summary.threads_total}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-emerald-600">bolt</span>
            BÀI VƯỢT AI CHECK
          </div>
          <div className="text-2xl font-black text-emerald-700 tracking-tight">
            {summary.total_ai_passed}{" "}
            <span className="text-xs font-normal text-gray-500">
              ({summary.overall_ai_pass_rate}%)
            </span>
          </div>
          <div className="text-[11px] text-emerald-600 mt-1 font-medium">Đạt điểm chất lượng ≥ 40</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
          <div className="flex items-center gap-2 text-gray-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px] text-purple-600">dns</span>
            PHÂN LOẠI TÀI KHOẢN
          </div>
          <div className="text-sm font-bold text-gray-800 tracking-tight mt-1 flex flex-col gap-0.5">
            <span className="text-xs text-purple-700 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span> accsystem crawler (VPS)
            </span>
            <span className="text-xs text-blue-700 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span> Tài khoản thành viên
            </span>
          </div>
        </div>
      </div>

      {/* 2. Bộ Lọc (Filters) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Dropdown User */}
          <div className="relative min-w-[240px]">
            <select
              value={selectedMember}
              onChange={(e) => setSelectedMember(e.target.value)}
              className="w-full text-xs font-medium text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-[#be123c]/20 focus:border-[#be123c] cursor-pointer"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.is_system ? `🤖 [Hệ thống] ${m.name}` : `👤 ${m.name} (${m.email})`}
                </option>
              ))}
            </select>
          </div>

          {/* Time range switcher */}
          <div className="flex items-center bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs">
            {(
              [
                { key: "all", label: "Tất cả" },
                { key: "today", label: "Hôm nay" },
                { key: "this_week", label: "Tuần này" },
                { key: "this_month", label: "Tháng này" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTimeRange(t.key)}
                className={cn(
                  "px-2.5 py-1 rounded-md font-semibold transition cursor-pointer",
                  timeRange === t.key
                    ? "bg-white text-gray-900 shadow-2xs"
                    : "text-gray-500 hover:text-gray-900"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reload button */}
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer disabled:opacity-50 transition"
        >
          <span className={cn("material-symbols-outlined text-[16px]", loading && "animate-spin")}>
            refresh
          </span>
          Làm mới
        </button>
      </div>

      {/* 3. Error Banner */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {error}
        </div>
      )}

      {/* 4. Danh Sách Vòng Cào */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-2xs animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-8 bg-gray-100 rounded"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      ) : rounds.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center shadow-2xs">
          <div className="w-14 h-14 bg-rose-50 text-[#be123c] rounded-2xl flex items-center justify-center mx-auto mb-3">
            <span className="material-symbols-outlined text-[28px]">schedule</span>
          </div>
          <h3 className="text-base font-bold text-gray-900">Chưa có lịch sử vòng cào</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            Không tìm thấy đợt cào nào cho bộ lọc hiện tại. Hãy kiểm tra các nhóm đã cài đặt trong tab{" "}
            <span className="font-semibold text-gray-700">"Lịch cào xoay vòng"</span> hoặc chọn tài khoản khác.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rounds.map((round) => (
            <RoundCard key={round.id} round={round} />
          ))}
        </div>
      )}
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
            <span className="material-symbols-outlined text-[15px] text-[#be123c]">calendar_month</span>
            {round.started_at_formatted}
          </span>
          <span className="inline-flex items-center gap-1 bg-amber-50/80 px-2.5 py-1 rounded-lg border border-amber-200/60 font-semibold text-amber-900">
            <span className="material-symbols-outlined text-[15px] text-amber-600">timer</span>
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
              <span className="font-bold text-gray-900 text-xs">{round.user_name}</span>
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
              <div className="text-[11px] text-gray-400 font-normal">{round.user_email}</div>
            )}
          </div>
        </div>

        {/* Tổng bài tóm tắt */}
        <div className="text-right">
          <div className="text-xs font-bold text-gray-900">
            Tổng cộng: <span className="text-blue-700 font-black">{round.total_posts} bài</span>
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 justify-end">
            <span className="material-symbols-outlined text-[13px]">bolt</span>
            {round.total_ai_passed} bài vượt AI ({round.ai_pass_rate}%)
          </div>
        </div>
      </div>

      {/* 3 Nền tảng Breakdown Cards (Facebook, LinkedIn, Threads) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Facebook */}
        <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-[11px]">
              FB
            </div>
            <div>
              <div className="text-xs font-bold text-gray-900">Facebook</div>
              <div className="text-[11px] text-gray-500">{round.facebook.posts_count} bài viết</div>
            </div>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold",
                round.facebook.ai_passed_count > 0
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              <span className="material-symbols-outlined text-[11px]">bolt</span>
              {round.facebook.ai_passed_count} đạt AI
            </span>
          </div>
        </div>

        {/* LinkedIn */}
        <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-[11px]">
              LI
            </div>
            <div>
              <div className="text-xs font-bold text-gray-900">LinkedIn</div>
              <div className="text-[11px] text-gray-500">{round.linkedin.posts_count} bài viết</div>
            </div>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold",
                round.linkedin.ai_passed_count > 0
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              <span className="material-symbols-outlined text-[11px]">bolt</span>
              {round.linkedin.ai_passed_count} đạt AI
            </span>
          </div>
        </div>

        {/* Threads */}
        <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gray-200 flex items-center justify-center text-gray-900 font-bold text-[11px]">
              TH
            </div>
            <div>
              <div className="text-xs font-bold text-gray-900">Threads</div>
              <div className="text-[11px] text-gray-500">{round.threads.posts_count} bài viết</div>
            </div>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold",
                round.threads.ai_passed_count > 0
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              <span className="material-symbols-outlined text-[11px]">bolt</span>
              {round.threads.ai_passed_count} đạt AI
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
