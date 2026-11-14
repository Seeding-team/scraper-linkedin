"use client";

import { cn } from "@/lib/utils";
import type { LeaderDashboardData } from "./useLeaderDashboardData";
import type { FlatListQuery } from "./FlatListDrawer";
import { deltaLabel, pct, PERIOD_LABEL } from "./shared";
import type { Period } from "./shared";

interface KpiDef {
  key: string;
  label: string;
  value: string;
  sub: string;
  icon: string;
  bg: string;
  fg: string;
  barPct?: number;
  query: FlatListQuery;
}

export function KpiCardGrid({
  data,
  period,
  dateFrom,
  dateTo,
  platform,
  teamId,
  memberId,
  search,
  onOpenDrawer,
}: {
  data: LeaderDashboardData;
  period: Period;
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
  const callDelta = deltaLabel(data.callTotal, data.prevCallTotal);
  const periodLabel = PERIOD_LABEL[period];

  const cards: KpiDef[] = [
    {
      key: "call",
      label: "Cuộc gọi đã thực hiện",
      value: String(data.callTotal),
      sub: `${pct(data.callOk, data.callTotal)}% thành công · ${callDelta ? callDelta.text + " so với kỳ trước" : "tổng lượt gọi"}`,
      icon: "call",
      bg: "bg-emerald-50", fg: "text-emerald-700",
      barPct: pct(data.callOk, data.callTotal),
      query: { ...common, action_type: "call" },
    },
    {
      key: "msg",
      label: "Tin Zalo có phản hồi",
      value: `${data.zaloStats?.replied ?? 0}/${data.zaloStats?.sent ?? 0}`,
      sub: `${pct(data.zaloStats?.replied || 0, data.zaloStats?.sent || 0)}% đã trả lời`,
      icon: "chat",
      bg: "bg-sky-50", fg: "text-sky-700",
      barPct: pct(data.zaloStats?.replied || 0, data.zaloStats?.sent || 0),
      query: { ...common, action_type: "zalo" },
    },
    {
      key: "cmt",
      label: "Comment đăng thành công",
      value: String(data.seedVerifiedTotal),
      sub: `${data.seedTotal} tổng lượt · đã verify`,
      icon: "forum",
      bg: "bg-violet-50", fg: "text-violet-700",
      query: { ...common, action_type: "seed" },
    },
    {
      key: "lead",
      label: "Lead có nhu cầu",
      value: String(data.leadTotal),
      sub: "Từ kết quả cuộc gọi",
      icon: "person_add",
      bg: "bg-rose-50", fg: "text-rose-700",
      query: { ...common, action_type: "call", result_code: "interested" },
    },
    {
      key: "cb",
      label: "Hẹn gọi lại",
      value: String(data.callbackTotal),
      sub: "Cần tiếp tục chăm sóc",
      icon: "schedule",
      bg: "bg-amber-50", fg: "text-amber-700",
      query: { ...common, action_type: "call", result_code: "callback" },
    },
    {
      key: "over",
      label: "Follow-up quá hạn",
      value: String(data.overdueCount),
      sub: data.overdueCount ? "Cần xử lý ngay" : "Không có tồn đọng",
      icon: "warning",
      bg: "bg-red-50", fg: "text-red-700",
      query: { ...common, action_type: "call", result_code: "callback", overdue_only: true },
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {cards.map((k) => (
        <button
          key={k.key}
          type="button"
          onClick={() => onOpenDrawer(`${k.label} · ${periodLabel}`, k.query)}
          className="relative flex flex-col gap-0.5 text-left border border-border rounded-xl p-3 bg-card hover:border-foreground/20 hover:shadow-sm transition cursor-pointer min-h-[108px]"
        >
          <span className={cn("absolute right-2.5 top-2.5 w-7 h-7 rounded-lg grid place-items-center", k.bg, k.fg)}>
            <span className="material-symbols-outlined text-[16px]">{k.icon}</span>
          </span>
          <span className="text-[11.5px] font-bold text-foreground/80 pr-8">{k.label}</span>
          <span className="text-[22px] font-extrabold leading-tight mt-1">
            {data.isLoading ? "…" : k.value}
          </span>
          <span className="text-[11px] text-muted-foreground">{k.sub}</span>
          {k.barPct != null && (
            <div className="mt-auto h-1 rounded-full bg-muted overflow-hidden">
              <span className="block h-full bg-emerald-500" style={{ width: `${k.barPct}%` }} />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
