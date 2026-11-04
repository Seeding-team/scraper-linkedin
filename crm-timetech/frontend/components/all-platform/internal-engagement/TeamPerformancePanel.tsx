"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { internalEngagementService } from "@/services/all-platform.service";
import type {
  InternalEngagementTeamTotal,
  InternalEngagementTeamTrendSeries,
} from "@/types/unified.types";

const LINE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#ea580c"];

function formatDayLabel(value: string): string {
  const day = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day || "-";
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

interface Props {
  email?: string;
}

export function TeamPerformancePanel({ email }: Props) {
  const [totals, setTotals] = useState<InternalEngagementTeamTotal[]>([]);
  const [trend, setTrend] = useState<InternalEngagementTeamTrendSeries[]>([]);
  const [role, setRole] = useState<string>("member");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");

  useEffect(() => {
    if (!email) return;
    setIsLoading(true);
    Promise.all([
      internalEngagementService.getTeamTotals(email),
      internalEngagementService.getTeamTrend(email, 14),
    ]).then(([totalsRes, trendRes]) => {
      if (totalsRes.success && totalsRes.data) {
        setTotals(totalsRes.data.teams);
        setRole(totalsRes.data.role);
      }
      if (trendRes.success && trendRes.data) {
        setTrend(trendRes.data.teams);
      }
      setIsLoading(false);
    });
  }, [email]);

  const visibleTrend = useMemo(() => {
    if (selectedTeamId !== "all") {
      return trend.filter((t) => t.team_id === selectedTeamId);
    }
    return trend.slice(0, 5);
  }, [trend, selectedTeamId]);

  const trendChartData = useMemo(() => {
    if (visibleTrend.length === 0) return [];
    const allDays = new Set<string>();
    visibleTrend.forEach((t) => t.series.forEach((p) => allDays.add(p.date)));
    return [...allDays].sort().map((date) => {
      const row: Record<string, string | number> = { date };
      visibleTrend.forEach((t) => {
        const point = t.series.find((p) => p.date === date);
        row[t.team_name] = point?.total ?? 0;
      });
      return row;
    });
  }, [visibleTrend]);

  const barChartData = useMemo(
    () => totals.map((t) => ({ name: t.team_name, total: t.total })),
    [totals],
  );

  const mostStable = totals[0];

  if (role !== "admin" && role !== "leader") {
    return null;
  }

  return (
    <div className="bg-white border border-[#e7e9ef] rounded-2xl shadow-[0_1px_3px_rgba(20,25,40,.08),0_8px_24px_rgba(20,25,40,.04)] overflow-hidden mb-4">
      <div className="p-[15px] px-4 border-b border-[#e7e9ef] flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="m-0 text-[15px] font-bold">Hiệu suất tương tác theo team</h3>
          <p className="m-0 text-[12px] text-[#737785] mt-1">
            {role === "admin" ? "Toàn bộ team" : "Team bạn quản lý"} — xếp hạng theo mức độ ổn định (tỷ lệ ngày có tương tác).
          </p>
        </div>
        {totals.length > 1 ? (
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="border border-[#dde0e7] rounded-xl px-3 py-2 text-[12px]"
          >
            <option value="all">Top 5 team (biểu đồ xu hướng)</option>
            {totals.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.team_name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {isLoading ? (
        <div className="p-6 text-center text-[#737785] text-sm">Đang tải dữ liệu team...</div>
      ) : totals.length === 0 ? (
        <div className="p-6 text-center text-[#737785] text-sm">Chưa có dữ liệu tương tác.</div>
      ) : (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] font-bold mb-2">Tổng tương tác theo team</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} />
                <Bar dataKey="total" name="Tổng tương tác" fill="#c71f4d" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div>
            <div className="text-[12px] font-bold mb-2">Xu hướng 14 ngày</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(v) => `Ngày ${formatDayLabel(String(v ?? ""))}`}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {visibleTrend.map((t, idx) => (
                  <Line
                    key={t.team_id}
                    type="monotone"
                    dataKey={t.team_name}
                    name={t.team_name}
                    stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                    strokeWidth={2.5}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="lg:col-span-2">
            <div className="text-[12px] font-bold mb-2">Xếp hạng độ ổn định</div>
            <div className="divide-y divide-[#f0f1f4] border border-[#e7e9ef] rounded-xl overflow-hidden">
              {totals.map((t, idx) => (
                <div key={t.team_id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#eef1f6] grid place-items-center text-[11px] font-bold text-[#59606e]">
                      {idx + 1}
                    </span>
                    <span className="font-semibold">{t.team_name}</span>
                    {t.team_id === mostStable?.team_id ? (
                      <span className="text-[10px] rounded-lg px-1.5 py-0.5 bg-[#eafaf3] text-[#087a50] font-bold">
                        Ổn định nhất
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-4 text-[#5d616c]">
                    <span>{t.number_of_member} thành viên</span>
                    <span>{t.total} tương tác</span>
                    <span>{t.active_days}/{t.range_days} ngày hoạt động</span>
                    <span className="font-bold text-[#c71f4d]">{Math.round(t.stability_score * 100)}% ổn định</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
