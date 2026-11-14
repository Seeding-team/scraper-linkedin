"use client";

import type { LeaderDashboardFilters } from "./useLeaderDashboardFilters";
import type { LeaderDashboardData } from "./useLeaderDashboardData";
import type { FlatListQuery } from "./FlatListDrawer";
import { TrendChart } from "./TrendChart";
import { FunnelCard } from "./FunnelCard";
import { AlertsPanel } from "./AlertsPanel";
import { MemberTable } from "./MemberTable";
import { exportActivityLogCsv } from "./exportCsv";
import { OK_CALL_CODES, pct } from "./shared";

export function TabOverview({
  filters,
  data,
  onOpenFlatList,
  onOpenMember360,
}: {
  filters: LeaderDashboardFilters;
  data: LeaderDashboardData;
  onOpenFlatList: (title: string, query: FlatListQuery) => void;
  onOpenMember360: (memberId: string, memberName: string | null) => void;
}) {
  const common = {
    date_from: filters.date_from, date_to: filters.date_to,
    platform: filters.platform || undefined, team_id: filters.teamId || undefined, member_id: filters.memberId || undefined,
    search: filters.search || undefined,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-4">
        <TrendChart platform={filters.platform} teamId={filters.teamId} memberId={filters.memberId} />

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">call</span>
              <h3 className="text-sm font-bold">Kết quả cuộc gọi</h3>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground mb-4">
            {filters.period === "today" ? "hôm nay" : filters.period === "7" ? "7 ngày qua" : "30 ngày qua"} · mỗi lượt gọi thuộc đúng một nhóm
          </p>
          <div className="flex flex-col gap-2.5">
            {(data.callStats?.by_type || []).map((t) => (
              <div key={t.code} className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-[12px]">
                <span className="truncate">{t.name}</span>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${OK_CALL_CODES.has(t.code) ? "bg-emerald-400" : "bg-rose-400"}`}
                    style={{ width: `${pct(t.count, data.callTotal)}%` }}
                  />
                </div>
                <b className="text-right">{t.count}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FunnelCard data={data} />
        <AlertsPanel
          data={data}
          dateFrom={filters.date_from} dateTo={filters.date_to}
          platform={filters.platform} teamId={filters.teamId} memberId={filters.memberId} search={filters.search}
          onOpenDrawer={onOpenFlatList}
        />
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <MemberTable
          rows={data.memberRows}
          isLoading={data.isLoading}
          onOpenMember360={onOpenMember360}
          onExportCsv={() => void exportActivityLogCsv(common)}
        />
      </div>
    </div>
  );
}
