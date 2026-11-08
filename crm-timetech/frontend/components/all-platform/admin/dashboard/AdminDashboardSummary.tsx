"use client";

import type { AdminDashboardSummaryData } from "@/services/all-platform.service";
import {
  LuFileText,
  LuMessageSquare,
  LuBadgeCheck,
  LuTrendingUp,
} from "react-icons/lu";

interface AdminDashboardSummaryProps {
  data: AdminDashboardSummaryData | null;
  isLoading: boolean;
}

export function AdminDashboardSummary({
  data,
  isLoading,
}: AdminDashboardSummaryProps) {
  const cards = [
    {
      title: "TỔNG BÀI VIẾT",
      value: isLoading || !data ? "..." : data.total_crawled_posts,
      icon: LuFileText,
      iconClassName: "bg-blue-50 text-blue-600",
    },
    {
      title: "TỔNG SEEDING",
      value: isLoading || !data ? "..." : data.total_seeding_comments,
      icon: LuMessageSquare,
      iconClassName: "bg-green-50 text-green-600",
    },
    {
      title: "TỶ LỆ DUYỆT",
      value: isLoading || !data ? "..." : `${data.approval_rate}%`,
      icon: LuBadgeCheck,
      iconClassName: "bg-violet-50 text-violet-600",
    },
    {
      title: "HIỆU SUẤT KPI",
      value: isLoading || !data ? "..." : `${data.kpi_rate}%`,
      icon: LuTrendingUp,
      iconClassName: "bg-orange-50 text-orange-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
      {cards.map((card, idx) => (
        <div
          key={idx}
          className="bg-surface rounded-xl border border-outline-variant p-5 flex flex-col justify-between min-h-[120px]"
        >
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-on-surface-variant">
                {card.title}
              </p>

              <p className="mt-3 text-3xl font-bold text-on-surface leading-none tabular-nums">
                {typeof card.value === "number"
                  ? card.value.toLocaleString("vi-VN")
                  : card.value}
              </p>
            </div>

            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${card.iconClassName}`}
            >
              <card.icon className="text-xl" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
