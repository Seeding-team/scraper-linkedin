"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { postContactActivityService, type DayBreakdownItem } from "@/services/all-platform.service";
import { formatDay, last14DaysRange } from "./shared";

export function TrendChart({
  platform,
  teamId,
  memberId,
}: {
  platform?: string | null;
  teamId?: string | null;
  memberId?: string | null;
}) {
  const [rows, setRows] = useState<DayBreakdownItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { date_from, date_to } = useMemo(() => last14DaysRange(), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    postContactActivityService
      .getDayBreakdown({
        date_from, date_to,
        platform: platform || undefined, team_id: teamId || undefined, member_id: memberId || undefined,
      })
      .then((res) => {
        if (!cancelled && res.success) setRows(res.data || []);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date_from, date_to, platform, teamId, memberId]);

  const chartData = rows.map((r) => ({
    day: formatDay(r.day),
    "Cuộc gọi": r.call_ok + r.call_bad,
    "Tin Zalo": r.zalo_sent,
    Comment: r.seed,
  }));

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-[18px] text-primary">show_chart</span>
        <h3 className="text-sm font-bold">Xu hướng 14 ngày</h3>
      </div>
      <p className="text-[12px] text-muted-foreground mb-3">
        Khối lượng cuộc gọi, tin Zalo và comment theo ngày (theo bộ lọc, không phụ thuộc kỳ)
      </p>
      {isLoading ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Đang tải...</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid var(--border)" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Cuộc gọi" stroke="#be123c" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Tin Zalo" stroke="#0284c7" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Comment" stroke="#16a34a" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
