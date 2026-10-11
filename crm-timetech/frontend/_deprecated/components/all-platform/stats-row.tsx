"use client";

import { PlatformStatsRow } from "@/components/features/shared/PlatformStatCard";

interface StatsRowProps {
  totalPostsToday: number;
  postsYesterday: number;
  highScoreCount?: number;
  seededToday: number;
  totalVisible: number;
  highScorePercent?: number;
  kpiProgress?: number;
  kpiProgressPercent?: number;
}

export function StatsRow({
  totalPostsToday,
  postsYesterday,
  highScoreCount,
  seededToday,
  totalVisible,
  highScorePercent,
  kpiProgress,
  kpiProgressPercent,
}: StatsRowProps) {
  const diff = totalPostsToday - postsYesterday;
  const hint =
    diff === 0
      ? "Không thay đổi so với hôm qua"
      : diff > 0
        ? `+${diff} so với hôm qua`
        : `${diff} so với hôm qua`;

  return (
    <PlatformStatsRow>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-outline-variant bg-surface p-md shadow-sm">
          <p className="text-body-sm font-semibold text-on-surface-variant">
            Tổng bài hôm nay
          </p>
          <p className="mt-1 text-h1 text-on-surface">{totalPostsToday}</p>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">{hint}</p>
        </div>

        <div className="rounded-xl border border-outline-variant bg-surface p-md shadow-sm">
          <p className="text-body-sm font-semibold text-on-surface-variant">
            Tiến độ KPI
          </p>
          <p className="mt-1 text-2xl font-bold text-green-600">{kpiProgress !== undefined ? kpiProgress : (highScoreCount || 0)}</p>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">
            {kpiProgressPercent !== undefined
              ? `${kpiProgressPercent}% hoàn thành`
              : highScorePercent !== undefined
                ? `${highScorePercent}% bài đạt`
                : "hoàn thành"}
          </p>
        </div>

        <div className="rounded-xl border border-outline-variant bg-surface p-md shadow-sm">
          <p className="text-body-sm font-semibold text-on-surface-variant">
            Đã seeded hôm nay
          </p>
          <p className="mt-1 text-h1 text-primary">{seededToday}</p>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">bài đã xác minh</p>
        </div>

        <div className="rounded-xl border border-outline-variant bg-surface p-md shadow-sm">
          <p className="text-body-sm font-semibold text-on-surface-variant">
            Tổng bài đang hiển thị
          </p>
          <p className="mt-1 text-h1 text-on-surface">{totalVisible}</p>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">trên tổng bài</p>
        </div>
      </div>
    </PlatformStatsRow>
  );
}
