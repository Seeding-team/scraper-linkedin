"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  AdminTeamDailyTrendData,
  AdminTeamDailyTrendPoint,
  AdminTeamDailyTrendSeries,
} from "@/services/all-platform.service";

type MetricKey = "posts" | "comments" | "inbox";

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: "posts", label: "Tổng bài" },
  { key: "comments", label: "Comment" },
  { key: "inbox", label: "Inbox" },
];

const LINE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
];

function formatDayLabel(value: string): string {
  const day = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return day || "-";
  }
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number") {
    return value.toLocaleString("vi-VN");
  }
  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return parsed.toLocaleString("vi-VN");
  }
  return String(value ?? 0);
}

function sumMetric(series: AdminTeamDailyTrendSeries, metric: MetricKey): number {
  return series.series.reduce((total, point) => total + (point[metric] || 0), 0);
}

interface Props {
  data: AdminTeamDailyTrendData | null;
  isLoading: boolean;
}

export function AdminTeamTrendChart({ data, isLoading }: Props) {
  const [metric, setMetric] = useState<MetricKey>("posts");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");

  const teams = data?.teams ?? [];

  const rankedTeams = useMemo(() => {
    return [...teams].sort((left, right) => sumMetric(right, metric) - sumMetric(left, metric));
  }, [teams, metric]);

  const visibleTeams = useMemo(() => {
    if (selectedTeamId !== "all") {
      return rankedTeams.filter((team) => team.team_id === selectedTeamId);
    }
    return rankedTeams.slice(0, 5);
  }, [rankedTeams, selectedTeamId]);

  const chartData = useMemo(() => {
    if (visibleTeams.length === 0) return [];
    const allDays = new Set<string>();
    for (const team of visibleTeams) {
      for (const point of team.series) {
        allDays.add(point.date);
      }
    }

    return [...allDays]
      .sort()
      .map((date) => {
        const row: Record<string, string | number> = { date };
        for (const team of visibleTeams) {
          const point = team.series.find((item) => item.date === date) as AdminTeamDailyTrendPoint | undefined;
          row[team.team_name] = point?.[metric] ?? 0;
        }
        return row;
      });
  }, [metric, visibleTeams]);

  const empty = !isLoading && chartData.length === 0;

  return (
    <div className="rounded-xl border border-outline-variant bg-surface overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-outline-variant px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-on-surface">Xu hướng 14 ngày theo team</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            So sánh theo từng ngày giữa các team để thấy team nào đang lên xuống rõ nhất.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-1">
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setMetric(option.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  metric === option.key
                    ? "bg-primary text-white"
                    : "text-on-surface-variant hover:bg-surface"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <select
            value={selectedTeamId}
            onChange={(event) => setSelectedTeamId(event.target.value)}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm font-medium text-on-surface outline-none"
          >
            <option value="all">Top 5 team</option>
            {rankedTeams.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.team_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center text-sm text-on-surface-variant">
          Đang tải biểu đồ team...
        </div>
      ) : null}

      {empty ? (
        <div className="flex min-h-[320px] items-center justify-center text-sm text-on-surface-variant">
          Chưa có dữ liệu xu hướng theo team.
        </div>
      ) : null}

      {!isLoading && !empty ? (
        <div className="px-4 py-5">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayLabel}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatMetricValue(value),
                  String(name ?? ""),
                ]}
                labelFormatter={(value) => `Ngày ${formatDayLabel(String(value ?? ""))}`}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {visibleTeams.map((team, index) => (
                <Line
                  key={team.team_id}
                  type="monotone"
                  dataKey={team.team_name}
                  name={team.team_name}
                  stroke={LINE_COLORS[index % LINE_COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}
