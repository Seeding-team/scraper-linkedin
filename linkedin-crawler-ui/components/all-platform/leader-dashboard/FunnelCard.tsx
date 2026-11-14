"use client";

import type { LeaderDashboardData } from "./useLeaderDashboardData";
import { pct } from "./shared";

export function FunnelCard({ data }: { data: LeaderDashboardData }) {
  const needCallback = data.leadTotal + data.callbackTotal;
  const steps: [string, number, string][] = [
    ["Đã gọi", data.callTotal, "bg-sky-400"],
    ["Nói chuyện được", data.callOk, "bg-emerald-400"],
    ["Có nhu cầu / hẹn gọi lại", needCallback, "bg-amber-400"],
    ["Có nhu cầu", data.leadTotal, "bg-primary"],
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-[18px] text-primary">filter_alt</span>
        <h3 className="text-sm font-bold">Phễu Seeding → Lead</h3>
      </div>
      <p className="text-[12px] text-muted-foreground mb-4">Theo kết quả cuộc gọi trong kỳ</p>

      <div className="flex flex-col gap-3">
        {steps.map(([label, value, color]) => (
          <div key={label}>
            <div className="flex items-center justify-between text-[12.5px] mb-1">
              <span>{label}</span>
              <b>
                {value} · {pct(value, data.callTotal)}%
              </b>
            </div>
            <div className="h-2.5 rounded-md bg-muted overflow-hidden">
              <span className={`block h-full rounded-md ${color}`} style={{ width: `${pct(value, data.callTotal)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground mt-3">
        Phễu theo kết quả cuộc gọi. Bước &quot;chuyển Sales&quot; cần nối CRM (Lead ID) nên chưa hiển thị.
      </p>
    </div>
  );
}
