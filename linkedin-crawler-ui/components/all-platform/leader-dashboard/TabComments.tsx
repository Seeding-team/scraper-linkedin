"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import {
  postContactActivityService,
  type ActivityLogItem,
  type SeedingGroupCoverageItem,
} from "@/services/all-platform.service";
import type { LeaderDashboardFilters } from "./useLeaderDashboardFilters";
import type { LeaderDashboardData } from "./useLeaderDashboardData";
import { ActivityFlatTable } from "./ActivityFlatTable";
import { pct } from "./shared";

export function TabComments({ filters, data }: { filters: LeaderDashboardFilters; data: LeaderDashboardData }) {
  const [coverage, setCoverage] = useState<SeedingGroupCoverageItem[]>([]);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(true);
  const [history, setHistory] = useState<ActivityLogItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const common = {
    date_from: filters.date_from, date_to: filters.date_to,
    platform: filters.platform || undefined, team_id: filters.teamId || undefined, member_id: filters.memberId || undefined,
    search: filters.search || undefined,
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoadingCoverage(true);
    postContactActivityService
      .getSeedingGroupCoverage(common)
      .then((res) => {
        if (!cancelled && res.success) setCoverage(res.data || []);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCoverage(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.date_from, filters.date_to, filters.platform, filters.teamId, filters.memberId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingHistory(true);
    postContactActivityService
      .getActivityLog({ ...common, action_type: "seed", page: 1, page_size: 10 })
      .then((res) => {
        if (!cancelled && res.success) setHistory(res.data?.items || []);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.date_from, filters.date_to, filters.platform, filters.teamId, filters.memberId, filters.search]);

  const maxCoverage = Math.max(1, ...coverage.map((c) => c.count));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-[18px] text-primary">forum</span>
            <h3 className="text-sm font-bold">Hiệu quả seeding / bình luận</h3>
          </div>
          <p className="text-[12px] text-muted-foreground mb-4">
            {filters.period === "today" ? "hôm nay" : filters.period === "7" ? "7 ngày qua" : "30 ngày qua"}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Tổng lượt</div>
              <div className="text-[18px] font-extrabold">{data.seedTotal}</div>
            </div>
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Đã verify</div>
              <div className="text-[18px] font-extrabold text-emerald-600">
                {data.seedVerifiedTotal} ({pct(data.seedVerifiedTotal, data.seedTotal)}%)
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Seeding và bình luận là cùng 1 hành động trong hệ thống (bảng seeding_content_kpi) —
            không tách riêng &quot;lỗi đăng&quot; hay &quot;khách đã phản hồi&quot; vì không có dữ
            liệu thật tương ứng.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-[18px] text-primary">public</span>
            <h3 className="text-sm font-bold">Độ phủ</h3>
          </div>
          <p className="text-[12px] text-muted-foreground mb-4">Nơi đã bình luận trong kỳ</p>
          {isLoadingCoverage ? (
            <div className="text-[12px] text-muted-foreground">Đang tải...</div>
          ) : coverage.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">Chưa có dữ liệu</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {coverage.map((c) => (
                <div key={c.group_name} className="grid grid-cols-[1fr_44px] items-center gap-2 text-[12px]">
                  <div>
                    <div className="truncate mb-1">{c.group_name}</div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <span
                        className="block h-full rounded-full bg-sky-400"
                        style={{ width: `${(c.count / maxCoverage) * 100}%` }}
                      />
                    </div>
                  </div>
                  <b className="text-right">{c.count}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="text-[12.5px] font-bold mb-1">Lịch sử comment</div>
        <p className="text-[12px] text-muted-foreground mb-3">Hiển thị 10 gần nhất</p>
        <ActivityFlatTable items={history} isLoading={isLoadingHistory} showActionColumn={false} />
      </div>
    </div>
  );
}
