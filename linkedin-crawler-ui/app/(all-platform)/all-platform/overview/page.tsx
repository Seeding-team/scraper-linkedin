"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { internalEngagementService, allPlatformPostsService } from "@/services/all-platform.service";
import { TeamPerformancePanel } from "@/components/all-platform/internal-engagement/TeamPerformancePanel";
import type { InternalEngagementPost, FeedPlatform } from "@/types/unified.types";
import { cn } from "@/lib/utils";

export default function AllPlatformOverviewPage() {
  const { user } = useAppAuth();
  const [posts, setPosts] = useState<InternalEngagementPost[]>([]);
  const [customPosts, setCustomPosts] = useState<InternalEngagementPost[]>([]);
  const [isLoadingInternal, setIsLoadingInternal] = useState(true);

  // External seeding stats state
  const [externalPlatform, setExternalPlatform] = useState<FeedPlatform>("facebook");
  const [externalStats, setExternalStats] = useState({
    todayPosts: 0,
    yesterdayPosts: 0,
    kpiProgressPercent: 0,
    kpiProgress: 0,
    kpiTarget: 0,
    seededToday: 0,
    totalCount: 0,
  });
  const [isLoadingExternal, setIsLoadingExternal] = useState(true);

  const canSeeTeamInteractions = user?.role === "admin" || user?.role === "leader";

  // Load Internal Engagement Posts
  useEffect(() => {
    let mounted = true;
    Promise.all([
      internalEngagementService.listPosts(1, 100, user?.email),
      internalEngagementService.listCustomPosts(1, 100),
    ])
      .then(([res, customRes]) => {
        if (!mounted) return;
        const markeeItems = res.success && res.data ? res.data.items || [] : [];
        const customItems = customRes.success && customRes.data ? customRes.data.items || [] : [];
        setPosts(markeeItems);
        setCustomPosts(customItems);
      })
      .finally(() => {
        if (mounted) setIsLoadingInternal(false);
      });

    return () => {
      mounted = false;
    };
  }, [user?.email]);

  // Load External Seeding Stats
  const fetchExternalStats = useCallback(async () => {
    if (!user?.email) return;
    setIsLoadingExternal(true);
    try {
      const res = await allPlatformPostsService.getStats({
        email: user.email,
        platform: externalPlatform,
      });
      if (res.success && res.data) {
        setExternalStats({
          todayPosts: res.data.totalPostsToday || 0,
          yesterdayPosts: res.data.postsYesterday || 0,
          kpiProgressPercent: res.data.kpiProgressPercent || 0,
          kpiProgress: res.data.kpiProgress || 0,
          kpiTarget: res.data.kpiTarget || 0,
          seededToday: res.data.seededToday || 0,
          totalCount: res.data.totalPosts || res.data.totalVisible || 0,
        });
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingExternal(false);
    }
  }, [user?.email, externalPlatform]);

  useEffect(() => {
    fetchExternalStats();
  }, [fetchExternalStats]);

  // Internal metrics calculation
  const allPosts = [...posts, ...customPosts];
  const totalTasks = allPosts.length;
  const completedTasks = allPosts.filter((p: any) => p.is_completed || p.status === "completed").length;
  const overdueTasks = allPosts.filter((p: any) => p.is_overdue || p.status === "overdue").length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[28px] text-[#be123c]">analytics</span>
            Tổng quan báo cáo Seeding & Tương tác
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Báo cáo hợp nhất hiệu quả chiến dịch tương tác nội bộ và hiệu suất cào bài seeding đa nền tảng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-rose-50 text-[#be123c] font-bold text-xs border border-rose-100 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#be123c] animate-pulse"></span>
            Realtime DB Sync
          </span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* SECTION 1: HIỆU QUẢ SEEDING & TƯƠNG TÁC NỘI BỘ          */}
      {/* ======================================================== */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-rose-100 text-[#be123c] font-black text-xs">
              1
            </span>
            <div>
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                Hiệu quả Seeding & Tương tác Nội bộ
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-[#be123c]">
                  Nhiệm vụ nội bộ
                </span>
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Theo dõi tiến độ nhận bài, tương tác Like/Comment chéo và tỷ lệ vi phạm của thành viên.
              </p>
            </div>
          </div>
          <Link
            href="/all-platform/internal-engagement"
            className="text-xs font-bold text-[#be123c] hover:underline flex items-center gap-1"
          >
            Đến trang Tương tác nội bộ →
          </Link>
        </div>

        {/* 5 Stats Cards Nội bộ */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md">
            <span className="text-xs font-semibold text-gray-500 block">Tổng nhiệm vụ</span>
            <div className="text-3xl font-black text-gray-900 mt-2">
              {isLoadingInternal ? "..." : totalTasks}
            </div>
            <span className="text-[11px] text-gray-400 font-medium mt-1 block">Bài viết cần tương tác</span>
          </div>

          <div className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md bg-emerald-50/10">
            <span className="text-xs font-semibold text-emerald-700 block">Đã hoàn thành</span>
            <div className="text-3xl font-black text-emerald-700 mt-2">
              {isLoadingInternal ? "..." : completedTasks}
            </div>
            <span className="text-[11px] text-emerald-600 font-medium mt-1 block">Minh chứng đã duyệt</span>
          </div>

          <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md bg-blue-50/10">
            <span className="text-xs font-semibold text-blue-700 block">Tỷ lệ hoàn thành</span>
            <div className="text-3xl font-black text-blue-700 mt-2">
              {isLoadingInternal ? "..." : `${completionRate}%`}
            </div>
            <span className="text-[11px] text-blue-600 font-medium mt-1 block">Hiệu suất toàn đội</span>
          </div>

          <div className="bg-white border border-rose-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md bg-rose-50/10">
            <span className="text-xs font-semibold text-rose-700 block">Vi phạm quá hạn</span>
            <div className="text-3xl font-black text-rose-700 mt-2">
              {isLoadingInternal ? "..." : overdueTasks}
            </div>
            <span className="text-[11px] text-rose-600 font-medium mt-1 block">Chưa tương tác kịp</span>
          </div>

          <div className="bg-white border border-purple-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md bg-purple-50/10">
            <span className="text-xs font-semibold text-purple-700 block">Điểm thưởng KPI</span>
            <div className="text-3xl font-black text-purple-700 mt-2">
              {isLoadingInternal ? "..." : `+${completedTasks * 5}`}
            </div>
            <span className="text-[11px] text-purple-600 font-medium mt-1 block">Tích lũy tháng này</span>
          </div>
        </div>

        {/* Chi tiết hiệu suất các Team */}
        {canSeeTeamInteractions ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-xs">
            <TeamPerformancePanel email={user?.email} />
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-500 shadow-xs">
            <span className="material-symbols-outlined text-[48px] text-gray-300 block mb-2">shield_person</span>
            <p className="font-semibold text-sm text-gray-700">Dữ liệu phân tích team chuyên sâu chỉ dành cho Leader và Admin.</p>
            <p className="text-xs text-gray-400 mt-1">Bạn có thể theo dõi tiến độ cá nhân của mình trong trang Tương tác nội bộ.</p>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* SECTION 2: HIỆU QUẢ CÀO BÀI & SEEDING BÊN NGOÀI          */}
      {/* ======================================================== */}
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-700 font-black text-xs">
              2
            </span>
            <div>
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                Hiệu quả Cào bài &amp; Seeding Bên ngoài
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  Đa nền tảng
                </span>
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Theo dõi số lượng bài cào từ các Group mục tiêu, tiến độ comment seeding và trạng thái bài viết.
              </p>
            </div>
          </div>

          {/* Chọn nền tảng */}
          <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl border border-gray-200">
            {(["facebook", "linkedin", "threads", "youtube"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setExternalPlatform(p)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition cursor-pointer",
                  externalPlatform === p
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-500 hover:text-gray-900"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 4 Stats Cards Bên ngoài */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Tổng bài cào hôm nay</span>
              <span className="material-symbols-outlined text-blue-500 text-[20px]">feed</span>
            </div>
            <div className="text-3xl font-black text-gray-900 mt-2">
              {isLoadingExternal ? "..." : externalStats.todayPosts}
            </div>
            <div className="mt-2 text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
              <span>↑</span> So với hôm qua ({externalStats.yesterdayPosts} bài)
            </div>
          </div>

          <div className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md bg-emerald-50/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700">Tiến độ KPI</span>
              <span className="material-symbols-outlined text-emerald-600 text-[20px]">task_alt</span>
            </div>
            <div className="text-3xl font-black text-emerald-700 mt-2">
              {isLoadingExternal ? "..." : `${externalStats.kpiProgressPercent}%`}
            </div>
            <div className="mt-2 h-1.5 w-full bg-emerald-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, externalStats.kpiProgressPercent)}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-white border border-amber-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md bg-amber-50/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700">Đã seeded hôm nay</span>
              <span className="material-symbols-outlined text-amber-600 text-[20px]">rocket_launch</span>
            </div>
            <div className="text-3xl font-black text-amber-700 mt-2">
              {isLoadingExternal ? "..." : externalStats.seededToday}
            </div>
            <span className="text-[11px] text-amber-600 font-medium mt-1 block">Comment từ batch hôm nay</span>
          </div>

          <div className="bg-white border border-indigo-100 rounded-2xl p-5 shadow-xs transition hover:shadow-md bg-indigo-50/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-700">Tổng bài trong CSDL</span>
              <span className="material-symbols-outlined text-indigo-600 text-[20px]">database</span>
            </div>
            <div className="text-3xl font-black text-indigo-700 mt-2">
              {isLoadingExternal ? "..." : externalStats.totalCount}
            </div>
            <span className="text-[11px] text-indigo-600 font-medium mt-1 block">Tập dữ liệu cào lưu trữ</span>
          </div>
        </div>

        {/* Quick Links vào các phân hệ Seeding bên ngoài */}
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-xs">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Truy cập nhanh các phân hệ Seeding bên ngoài</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <Link
              href="/all-platform/post-feed"
              className="p-4 rounded-xl border border-gray-200 hover:border-[#be123c] hover:bg-rose-50/30 transition group flex flex-col justify-between"
            >
              <div>
                <span className="material-symbols-outlined text-[#be123c] text-[24px] mb-1">bolt</span>
                <h4 className="font-bold text-sm text-gray-900 group-hover:text-[#be123c]">Hoạt động seeding</h4>
                <p className="text-xs text-gray-500 mt-1">Xem feed bài viết Facebook, LinkedIn, Threads, YouTube và comment.</p>
              </div>
              <span className="text-xs font-bold text-[#be123c] mt-3 block">Mở trang →</span>
            </Link>

            <Link
              href="/all-platform/quan-ly-nhom"
              className="p-4 rounded-xl border border-gray-200 hover:border-[#be123c] hover:bg-rose-50/30 transition group flex flex-col justify-between"
            >
              <div>
                <span className="material-symbols-outlined text-[#be123c] text-[24px] mb-1">folder_open</span>
                <h4 className="font-bold text-sm text-gray-900 group-hover:text-[#be123c]">Kho thư viện Group</h4>
                <p className="text-xs text-gray-500 mt-1">Quản lý danh sách các nhóm Facebook, LinkedIn mục tiêu cần cào bài.</p>
              </div>
              <span className="text-xs font-bold text-[#be123c] mt-3 block">Mở trang →</span>
            </Link>

            <Link
              href="/all-platform/lich-cao-hang-doi"
              className="p-4 rounded-xl border border-gray-200 hover:border-[#be123c] hover:bg-rose-50/30 transition group flex flex-col justify-between"
            >
              <div>
                <span className="material-symbols-outlined text-[#be123c] text-[24px] mb-1">schedule</span>
                <h4 className="font-bold text-sm text-gray-900 group-hover:text-[#be123c]">Lịch cào &amp; Hàng đợi</h4>
                <p className="text-xs text-gray-500 mt-1">Cài đặt lịch cào xoay vòng tự động và giám sát hàng đợi VPS.</p>
              </div>
              <span className="text-xs font-bold text-[#be123c] mt-3 block">Mở trang →</span>
            </Link>

            <Link
              href="/all-platform/leader-dashboard"
              className="p-4 rounded-xl border border-gray-200 hover:border-[#be123c] hover:bg-rose-50/30 transition group flex flex-col justify-between"
            >
              <div>
                <span className="material-symbols-outlined text-[#be123c] text-[24px] mb-1">leaderboard</span>
                <h4 className="font-bold text-sm text-gray-900 group-hover:text-[#be123c]">Dashboard leader</h4>
                <p className="text-xs text-gray-500 mt-1">Biểu đồ xu hướng 14 ngày, phân tích hiệu suất và thời gian online.</p>
              </div>
              <span className="text-xs font-bold text-[#be123c] mt-3 block">Mở trang →</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
