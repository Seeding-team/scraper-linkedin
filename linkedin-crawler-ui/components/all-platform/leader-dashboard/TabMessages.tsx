"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import { postContactActivityService, type ActivityLogItem } from "@/services/all-platform.service";
import type { LeaderDashboardFilters } from "./useLeaderDashboardFilters";
import type { LeaderDashboardData } from "./useLeaderDashboardData";
import type { FlatListQuery } from "./FlatListDrawer";
import { ActivityFlatTable } from "./ActivityFlatTable";
import { pct } from "./shared";

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div className="grid grid-cols-[130px_1fr_44px] items-center gap-2 text-[12px]">
      <span>{label}</span>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${pct(value, total)}%`, background: color }} />
      </div>
      <b className="text-right">{value}</b>
    </div>
  );
}

export function TabMessages({
  filters,
  data,
  onOpenFlatList,
}: {
  filters: LeaderDashboardFilters;
  data: LeaderDashboardData;
  onOpenFlatList: (title: string, query: FlatListQuery) => void;
}) {
  const [history, setHistory] = useState<ActivityLogItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const common = {
    date_from: filters.date_from, date_to: filters.date_to,
    platform: filters.platform || undefined, team_id: filters.teamId || undefined, member_id: filters.memberId || undefined,
    search: filters.search || undefined,
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoadingHistory(true);
    postContactActivityService
      .getActivityLog({ ...common, action_type: "zalo", page: 1, page_size: 10 })
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

  const sent = data.zaloStats?.sent || 0;
  const replied = data.zaloStats?.replied || 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-[18px] text-primary">chat</span>
            <h3 className="text-sm font-bold">Hiệu quả tin nhắn Zalo</h3>
          </div>
          <p className="text-[12px] text-muted-foreground mb-4">Tính theo hội thoại trong kỳ</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Đã gửi</div>
              <div className="text-[18px] font-extrabold">{sent}</div>
            </div>
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Khách trả lời</div>
              <div className="text-[18px] font-extrabold text-emerald-600">{replied}</div>
            </div>
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Tỷ lệ phản hồi</div>
              <div className="text-[18px] font-extrabold">{pct(replied, sent)}%</div>
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            <Bar label="Có phản hồi" value={replied} total={sent} color="#10b981" />
            <Bar label="Chưa phản hồi" value={Math.max(0, sent - replied)} total={sent} color="#f59e0b" />
            <Bar label="Cần follow-up" value={data.followupCount} total={sent} color="#ef4444" />
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-[18px] text-primary">schedule</span>
            <h3 className="text-sm font-bold">Cần chăm sóc</h3>
          </div>
          <p className="text-[12px] text-muted-foreground mb-4">Hội thoại chưa có phản hồi trong 2 ngày gần đây</p>
          <div className="border border-border rounded-lg px-3 py-2 mb-3">
            <div className="text-[11px] text-muted-foreground font-semibold">Hội thoại cần follow-up</div>
            <div className="text-[18px] font-extrabold">{data.followupCount}</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenFlatList("Tin nhắn cần follow-up", { ...common, action_type: "zalo", needs_followup_only: true })}
            className="h-9 px-3 rounded-lg border border-border text-[12.5px] font-bold hover:bg-muted transition cursor-pointer"
          >
            Xem danh sách →
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="text-[12.5px] font-bold mb-1">Lịch sử tin nhắn</div>
        <p className="text-[12px] text-muted-foreground mb-3">Hiển thị 10 gần nhất</p>
        <ActivityFlatTable items={history} isLoading={isLoadingHistory} showActionColumn={false} />
      </div>
    </div>
  );
}
