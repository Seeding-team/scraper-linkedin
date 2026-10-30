"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformPostsService } from "@/services/all-platform.service";
import { SeedingActivityPanel } from "@/components/all-platform/feed/SeedingActivityPanel";
import { TeamEfficiencyWidget } from "@/components/all-platform/feed/TeamEfficiencyWidget";
import { MemberOnlineTimeWidget } from "@/components/all-platform/feed/MemberOnlineTimeWidget";
import type { FeedPlatform } from "@/types/unified.types";

export default function LeaderDashboardPage() {
  const { user } = useAppAuth();
  const email = user?.email || "";
  const isLeaderOrAdmin = user?.role === "admin" || user?.role === "leader";

  const [platform, setPlatform] = useState<FeedPlatform>("facebook");
  const [dailyTrend, setDailyTrend] = useState<Array<{ date: string; posts: number; comments: number; inbox: number }>>([]);
  const [isLoadingTrend, setIsLoadingTrend] = useState(true);

  const fetchDailyTrend = useCallback(async () => {
    if (!email) return;
    setIsLoadingTrend(true);
    try {
      const res = await allPlatformPostsService.getDailyTrend({
        email,
        platform,
      });
      if (res.success && res.data) {
        setDailyTrend(res.data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingTrend(false);
    }
  }, [email, platform]);

  useEffect(() => {
    fetchDailyTrend();
  }, [fetchDailyTrend]);

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-6">
      {/* Header riêng biệt của trang */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[28px] text-[#be123c]">analytics</span>
            Dashboard Leader Seeding
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Báo cáo xu hướng 14 ngày, tổng bài cào được, comment đã verify, inbox nhận được của toàn đội ngũ.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-xl border border-gray-200">
          {(["facebook", "linkedin", "threads", "youtube"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition cursor-pointer ${
                platform === p
                  ? "bg-white text-gray-900 shadow-xs"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {!isLeaderOrAdmin ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-500 shadow-xs">
          <span className="material-symbols-outlined text-[48px] text-gray-300 block mb-2">shield_person</span>
          <p className="font-semibold text-sm text-gray-700">Dữ liệu Dashboard Leader chỉ dành cho Leader và Quản trị viên.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Biểu đồ xu hướng 14 ngày */}
          <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Xu hướng 14 ngày gần nhất ({platform.toUpperCase()})</h3>
                <p className="text-xs text-gray-500">Tổng bài cào được · Comment đã verify · Inbox nhận được, theo từng ngày.</p>
              </div>
              {isLoadingTrend && <span className="text-xs text-gray-400">Đang tải...</span>}
            </div>
            {dailyTrend.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center text-sm text-gray-400">
                {isLoadingTrend ? "Đang tải dữ liệu xu hướng..." : "Chưa có dữ liệu xu hướng."}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPosts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorComments" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorInbox" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
                    tick={{ fontSize: 11, fill: "#737373" }}
                    axisLine={{ stroke: "#e5e5e5" }}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#737373" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(d) => `Ngày ${String(d ?? "").slice(5).replace("-", "/")}`}
                    contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e5e5" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="posts" name="Tổng bài" stroke="#2563eb" fill="url(#colorPosts)" strokeWidth={2} />
                  <Area type="monotone" dataKey="comments" name="Comment" stroke="#16a34a" fill="url(#colorComments)" strokeWidth={2} />
                  <Area type="monotone" dataKey="inbox" name="Inbox" stroke="#f59e0b" fill="url(#colorInbox)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            <div className="xl:col-span-2">
              <SeedingActivityPanel email={email} />
            </div>
            <TeamEfficiencyWidget email={email} />
          </div>

          <MemberOnlineTimeWidget email={email} />
        </div>
      )}
    </div>
  );
}

