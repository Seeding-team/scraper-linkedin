"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  LuCalendarDays,
  LuChartBar,
  LuChevronDown,
  LuListFilter,
  LuUsers,
} from "react-icons/lu";

import { cn } from "@/lib/utils";
import {
  adminDashboardService,
  type AdminTeamDailyTrendData,
  type TeamRow,
} from "@/services/all-platform.service";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MetricKey = "total_kpi" | "leads" | "inbox" | "comments" | "posts";
type RangePreset = "7d" | "14d" | "30d" | "custom";

const RANGE_OPTIONS: Array<{ value: RangePreset; label: string; days?: number }> = [
  { value: "7d", label: "7 ngày", days: 7 },
  { value: "14d", label: "14 ngày", days: 14 },
  { value: "30d", label: "30 ngày", days: 30 },
  { value: "custom", label: "Tùy chọn" },
];

const METRIC_OPTIONS: Array<{ value: MetricKey; label: string }> = [
  { value: "total_kpi", label: "Tổng KPI" },
  { value: "leads", label: "Lead" },
  { value: "inbox", label: "Inbox" },
  { value: "comments", label: "Comment" },
  { value: "posts", label: "Post" },
];

const LINE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#0f766e",
  "#be123c",
  "#4f46e5",
];

function formatDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getDefaultCustomRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 13);
  return {
    start: formatDateInput(start),
    end: formatDateInput(end),
  };
}

function formatDayLabel(value: string): string {
  const day = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return day || "-";
  }
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function formatMetricValue(value: number): string {
  return value.toLocaleString("vi-VN");
}

function getMetricLabel(metric: MetricKey): string {
  return (
    METRIC_OPTIONS.find((option) => option.value === metric)?.label ?? "Tổng KPI"
  );
}

interface Props {
  teams: TeamRow[];
}

export function TeamPerformanceTrendSection({ teams }: Props) {
  const defaultCustomRange = useMemo(() => getDefaultCustomRange(), []);
  const [rangePreset, setRangePreset] = useState<RangePreset>("14d");
  const [metric, setMetric] = useState<MetricKey>("total_kpi");
  const [selectedTeamIdsState, setSelectedTeamIdsState] = useState<string[] | null>(null);
  const [hiddenTeamIds, setHiddenTeamIds] = useState<string[]>([]);
  const [customStart, setCustomStart] = useState(defaultCustomRange.start);
  const [customEnd, setCustomEnd] = useState(defaultCustomRange.end);

  const availableTeams = useMemo(
    () =>
      [...teams]
        .map((team) => ({ id: team.id, name: team.name_team || "Chưa đặt tên" }))
        .sort((left, right) => left.name.localeCompare(right.name, "vi")),
    [teams],
  );

  const allTeamIds = useMemo(
    () => availableTeams.map((team) => team.id),
    [availableTeams],
  );

  const selectedTeamIds = useMemo(() => {
    if (allTeamIds.length === 0) {
      return [];
    }
    if (!selectedTeamIdsState || selectedTeamIdsState.length === 0) {
      return allTeamIds;
    }
    const allowedIds = new Set(allTeamIds);
    const filtered = selectedTeamIdsState.filter((teamId) =>
      allowedIds.has(teamId),
    );
    return filtered.length > 0 ? filtered : allTeamIds;
  }, [allTeamIds, selectedTeamIdsState]);

  const isCustomRangeValid =
    rangePreset !== "custom" ||
    (Boolean(customStart) && Boolean(customEnd) && customStart <= customEnd);

  const requestParams = useMemo(() => {
    const params: {
      days?: number;
      startDate?: string;
      endDate?: string;
      metric?: string;
      teamIds?: string[];
    } = {
      metric,
    };

    const selectedAllTeams =
      selectedTeamIds.length > 0 && selectedTeamIds.length === allTeamIds.length;
    if (!selectedAllTeams && selectedTeamIds.length > 0) {
      params.teamIds = [...selectedTeamIds].sort();
    }

    if (rangePreset === "custom" && isCustomRangeValid) {
      params.startDate = customStart;
      params.endDate = customEnd;
      return params;
    }

    const preset = RANGE_OPTIONS.find((option) => option.value === rangePreset);
    params.days = preset?.days ?? 14;
    return params;
  }, [
    allTeamIds.length,
    customEnd,
    customStart,
    isCustomRangeValid,
    metric,
    rangePreset,
    selectedTeamIds,
  ]);

  const trendQuery = useQuery<AdminTeamDailyTrendData>({
    queryKey: [
      "teams-performance-trend",
      rangePreset,
      customStart,
      customEnd,
      metric,
      [...selectedTeamIds].sort().join(","),
    ],
    enabled: isCustomRangeValid && selectedTeamIds.length > 0,
    queryFn: async () => {
      const response = await adminDashboardService.getTeamDailyTrend(requestParams);
      if (!response.success || !response.data) {
        throw new Error(response.message || "Không thể tải dữ liệu biểu đồ.");
      }
      return response.data;
    },
    staleTime: 30_000,
  });

  const teamsInChart = useMemo(
    () => trendQuery.data?.teams ?? [],
    [trendQuery.data],
  );
  const colorByTeamId = useMemo(
    () =>
      Object.fromEntries(
        teamsInChart.map((team, index) => [
          team.team_id,
          LINE_COLORS[index % LINE_COLORS.length],
        ]),
      ) as Record<string, string>,
    [teamsInChart],
  );
  const effectiveHiddenTeamIds = useMemo(
    () => hiddenTeamIds.filter((teamId) => selectedTeamIds.includes(teamId)),
    [hiddenTeamIds, selectedTeamIds],
  );

  const visibleSeries = useMemo(
    () =>
      teamsInChart.filter((team) => !effectiveHiddenTeamIds.includes(team.team_id)),
    [effectiveHiddenTeamIds, teamsInChart],
  );

  const chartData = useMemo(() => {
    if (visibleSeries.length === 0) {
      return [];
    }

    const dayMap = new Map<string, Record<string, number | string>>();
    for (const team of visibleSeries) {
      for (const point of team.series) {
        const existing = dayMap.get(point.date) ?? { date: point.date };
        existing[team.team_id] = point[metric] ?? 0;
        dayMap.set(point.date, existing);
      }
    }

    return [...dayMap.values()].sort((left, right) =>
      String(left.date).localeCompare(String(right.date)),
    );
  }, [metric, visibleSeries]);

  const hasNoSelectedTeams = selectedTeamIds.length === 0;
  const allSeriesHidden = teamsInChart.length > 0 && visibleSeries.length === 0;
  const hasNoData =
    !trendQuery.isLoading &&
    !trendQuery.isError &&
    !hasNoSelectedTeams &&
    !allSeriesHidden &&
    chartData.length === 0;

  const teamLabel = useMemo(() => {
    if (selectedTeamIds.length === allTeamIds.length) {
      return "Tất cả Team";
    }
    if (selectedTeamIds.length === 1) {
      return (
        availableTeams.find((team) => team.id === selectedTeamIds[0])?.name ??
        "1 Team"
      );
    }
    return `${selectedTeamIds.length} Team`;
  }, [allTeamIds.length, availableTeams, selectedTeamIds]);

  const handleToggleTeam = (
    teamId: string,
    checked: boolean | "indeterminate",
  ) => {
    setSelectedTeamIdsState((currentState) => {
      const current = currentState ?? allTeamIds;
      if (checked) {
        return current.includes(teamId) ? current : [...current, teamId];
      }
      if (current.length === 1 && current.includes(teamId)) {
        return current;
      }
      return current.filter((value) => value !== teamId);
    });
  };

  const handleToggleLegend = (teamId: string) => {
    setHiddenTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((value) => value !== teamId)
        : [...current, teamId],
    );
  };

  return (
    <section className="rounded-xl border border-border bg-white shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LuChartBar size={17} className="text-foreground" />
              <h2 className="text-base font-bold text-foreground">
                Xu hướng hiệu suất giữa các Team
              </h2>
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Dữ liệu thật theo từng ngày cho KPI tổng, Lead, Inbox, Comment và
              Post để so sánh nhịp làm việc giữa các Team.
            </p>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-auto xl:grid-cols-[auto_auto_auto]">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
                <LuCalendarDays size={14} />
                Khoảng thời gian
              </div>
              <div className="flex flex-wrap gap-2">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRangePreset(option.value)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                      rangePreset === option.value
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-white text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {rangePreset === "custom" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    aria-label="Ngày bắt đầu"
                  />
                  <Input
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    aria-label="Ngày kết thúc"
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
                <LuListFilter size={14} />
                Chỉ số
              </div>
              <Select
                value={metric}
                onValueChange={(value) => setMetric(value as MetricKey)}
              >
                <SelectTrigger className="w-full min-w-[160px] bg-white">
                  <SelectValue placeholder="Chọn chỉ số" />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
                <LuUsers size={14} />
                Team
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-w-[170px] justify-between"
                  >
                    <span className="truncate">{teamLabel}</span>
                    <LuChevronDown size={14} className="text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[280px] p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      Chọn Team
                    </span>
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary"
                      onClick={() => setSelectedTeamIdsState(allTeamIds)}
                    >
                      Tất cả
                    </button>
                  </div>

                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {availableTeams.map((team) => {
                      const checked = selectedTeamIds.includes(team.id);
                      return (
                        <label
                          key={team.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              handleToggleTeam(team.id, value)
                            }
                          />
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {team.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {rangePreset === "custom" && !isCustomRangeValid ? (
          <p className="mt-3 text-sm text-destructive">
            Khoảng ngày tùy chọn chưa hợp lệ. Vui lòng chọn ngày bắt đầu nhỏ hơn
            hoặc bằng ngày kết thúc.
          </p>
        ) : null}
      </div>

      <div className="px-4 py-5">
        {trendQuery.isLoading ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
            Đang tải dữ liệu hiệu suất theo Team...
          </div>
        ) : null}

        {!trendQuery.isLoading && trendQuery.isError ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-destructive/30 bg-destructive/5 px-4 text-center text-sm text-destructive">
            {trendQuery.error instanceof Error
              ? trendQuery.error.message
              : "Không thể tải dữ liệu hiệu suất."}
          </div>
        ) : null}

        {!trendQuery.isLoading && !trendQuery.isError && hasNoSelectedTeams ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 text-center text-sm text-muted-foreground">
            Chọn ít nhất 1 Team để xem biểu đồ.
          </div>
        ) : null}

        {!trendQuery.isLoading && !trendQuery.isError && allSeriesHidden ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 text-center text-sm text-muted-foreground">
            Bạn đang ẩn toàn bộ Team trên legend. Bật lại ít nhất 1 Team để xem biểu đồ.
          </div>
        ) : null}

        {!trendQuery.isLoading && !trendQuery.isError && hasNoData ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 text-center text-sm text-muted-foreground">
            Chưa có dữ liệu hiệu suất trong khoảng thời gian đã chọn.
          </div>
        ) : null}

        {!trendQuery.isLoading &&
        !trendQuery.isError &&
        !hasNoSelectedTeams &&
        chartData.length > 0 ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Đang xem <span className="font-semibold text-foreground">{getMetricLabel(metric)}</span>
              {" "}từ {formatDayLabel(trendQuery.data?.range.start ?? "")} đến{" "}
              {formatDayLabel(trendQuery.data?.range.end ?? "")}.
            </div>

            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                >
                  <defs>
                    {visibleSeries.map((team) => {
                      const color = colorByTeamId[team.team_id] ?? LINE_COLORS[0];
                      return (
                        <linearGradient
                          key={`gradient-${team.team_id}`}
                          id={`team-gradient-${team.team_id}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e5e5e5"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDayLabel}
                    tick={{ fontSize: 11, fill: "#737373" }}
                    axisLine={{ stroke: "#e5e5e5" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#737373" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatMetricValue(Number(value || 0)),
                      String(name || ""),
                    ]}
                    labelFormatter={(value) =>
                      `Ngày ${formatDayLabel(String(value || ""))}`
                    }
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e5e5e5",
                      fontSize: 12,
                    }}
                  />
                  {visibleSeries.map((team) => (
                    <Area
                      key={team.team_id}
                      type="monotone"
                      dataKey={team.team_id}
                      name={team.team_name}
                      stroke={colorByTeamId[team.team_id] ?? LINE_COLORS[0]}
                      fill={`url(#team-gradient-${team.team_id})`}
                      strokeWidth={2}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap gap-2">
              {teamsInChart.map((team) => {
                const hidden = hiddenTeamIds.includes(team.team_id);
                const color = colorByTeamId[team.team_id] ?? LINE_COLORS[0];
                return (
                  <button
                    key={team.team_id}
                    type="button"
                    onClick={() => handleToggleLegend(team.team_id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      hidden
                        ? "border-border bg-muted text-muted-foreground"
                        : "border-border bg-white text-foreground hover:bg-muted",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color, opacity: hidden ? 0.35 : 1 }}
                    />
                    <span className="max-w-[140px] truncate">{team.team_name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
