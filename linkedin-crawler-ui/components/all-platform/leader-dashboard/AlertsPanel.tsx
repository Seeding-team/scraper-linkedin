"use client";

import type { LeaderDashboardData } from "./useLeaderDashboardData";
import type { FlatListQuery } from "./FlatListDrawer";

export function AlertsPanel({
  data,
  dateFrom,
  dateTo,
  platform,
  teamId,
  memberId,
  search,
  onOpenDrawer,
}: {
  data: LeaderDashboardData;
  dateFrom: string;
  dateTo: string;
  platform?: string | null;
  teamId?: string | null;
  memberId?: string | null;
  search?: string | null;
  onOpenDrawer: (title: string, query: FlatListQuery) => void;
}) {
  const common = {
    date_from: dateFrom, date_to: dateTo, platform: platform || undefined, team_id: teamId || undefined,
    member_id: memberId || undefined, search: search || undefined,
  };

  const alerts = [
    {
      key: "over",
      label: "Hẹn gọi lại quá hạn",
      count: data.overdueCount,
      desc: "Khách có lịch gọi lại chưa hoàn tất",
      icon: "warning",
      bg: "bg-red-50", fg: "text-red-700", badge: "bg-red-50 text-red-700",
      query: { ...common, action_type: "call" as const, result_code: "callback", overdue_only: true },
    },
    {
      key: "fu",
      label: "Tin nhắn cần follow-up",
      count: data.followupCount,
      desc: "Chưa phản hồi, cần nhân viên xử lý tiếp",
      icon: "chat",
      bg: "bg-amber-50", fg: "text-amber-700", badge: "bg-amber-50 text-amber-700",
      query: { ...common, action_type: "zalo" as const, needs_followup_only: true },
    },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-[18px] text-primary">priority_high</span>
        <h3 className="text-sm font-bold">Leader cần chú ý</h3>
      </div>
      <p className="text-[12px] text-muted-foreground mb-4">Việc cần ưu tiên xử lý</p>

      <div className="flex flex-col gap-1.5">
        {alerts.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => onOpenDrawer(a.label, a.query)}
            className="flex items-center gap-3 p-2.5 rounded-xl border border-transparent hover:bg-muted/60 hover:border-border transition text-left cursor-pointer"
          >
            <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${a.bg} ${a.fg}`}>
              <span className="material-symbols-outlined text-[18px]">{a.icon}</span>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-bold">{a.label}</div>
              <div className="text-[11px] text-muted-foreground truncate">{a.desc}</div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${a.badge}`}>
              {data.isLoading ? "…" : a.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
