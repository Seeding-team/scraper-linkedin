"use client";

import React, { useMemo, useState } from "react";
import {
  AlertOctagon,
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  Flame,
  Hourglass,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { card, table } from "@/components/all-platform/zalo/centralized-shared/zaloUi";
import {
  formatDurationVi,
  getChannelMeta,
  PRIMARY_SLA_CHANNELS,
  type SlaChannelStat,
  type SlaDailyTrendPoint,
  type SlaDashboardData,
  type SlaStaffStat,
} from "@/types/sla-alerts";

export interface SlaOverviewTabProps {
  data: SlaDashboardData | null;
  loading: boolean;
  onJumpToWaitingQueue?: (onlyBreached?: boolean) => void;
}

function complianceColorClass(pct: number): string {
  if (pct >= 85) return "text-[#0d857f]";
  if (pct >= 70) return "text-amber-600";
  return "text-brand";
}

function complianceBarClass(pct: number): string {
  if (pct >= 85) return "bg-[#10a39c]";
  if (pct >= 70) return "bg-amber-500";
  return "bg-brand";
}

function formatDayShort(dayStr: string): string {
  if (!dayStr) return "";
  const parts = dayStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}`;
  }
  return dayStr;
}

export function SlaOverviewTab({
  data,
  loading,
  onJumpToWaitingQueue,
}: SlaOverviewTabProps) {
  const [chartMetric, setChartMetric] = useState<"compliance" | "response">("compliance");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const kpis = data?.kpis ?? {
    total_turns: 0,
    met_count: 0,
    breached_count: 0,
    waiting_count: 0,
    waiting_breached_count: 0,
    waiting_warning_count: 0,
    sla_compliance_pct: 0,
    avg_frt_seconds: 0,
    avg_response_seconds: 0,
    p50_response_seconds: 0,
    p90_response_seconds: 0,
  };

  const dailyTrend: SlaDailyTrendPoint[] = useMemo(
    () => (Array.isArray(data?.daily_trend) ? data!.daily_trend : []),
    [data],
  );

  const byChannel: SlaChannelStat[] = useMemo(() => {
    const raw = Array.isArray(data?.by_channel) ? data!.by_channel : [];
    const byKey = new Map<string, SlaChannelStat>();
    for (const item of raw) {
      byKey.set(item.channel.toLowerCase(), item);
    }
    const ordered: SlaChannelStat[] = PRIMARY_SLA_CHANNELS.map((ch) => {
      const existing = byKey.get(ch.id);
      if (existing) return existing;
      return {
        channel: ch.id,
        total: 0,
        met: 0,
        breached: 0,
        waiting: 0,
        compliance_pct: 0,
        avg_response_seconds: 0,
      };
    });
    for (const item of raw) {
      const k = item.channel.toLowerCase();
      if (!PRIMARY_SLA_CHANNELS.some((p) => p.id === k) && item.total > 0) {
        ordered.push(item);
      }
    }
    return ordered;
  }, [data]);

  const byStaff: SlaStaffStat[] = useMemo(() => {
    const raw = Array.isArray(data?.by_staff) ? data!.by_staff : [];
    return [...raw].sort((a, b) => {
      if (b.compliance_pct !== a.compliance_pct) return b.compliance_pct - a.compliance_pct;
      return b.total - a.total;
    });
  }, [data]);

  // SVG Chart dimensions & computed points
  const chartStats = useMemo(() => {
    const maxTotal = Math.max(1, ...dailyTrend.map((d) => d.total || 0));
    const maxAvgResp = Math.max(60, ...dailyTrend.map((d) => d.avg_response_seconds || 0));
    return { maxTotal, maxAvgResp };
  }, [dailyTrend]);

  const hoveredDay = hoveredIdx !== null ? dailyTrend[hoveredIdx] ?? null : null;

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`${card} animate-pulse p-5`}>
              <div className="h-3.5 w-24 rounded bg-slate-200" />
              <div className="mt-4 h-8 w-20 rounded bg-slate-200" />
              <div className="mt-3 h-3 w-32 rounded bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className={`${card} h-72 animate-pulse p-5 lg:col-span-7`} />
          <div className={`${card} h-72 animate-pulse p-5 lg:col-span-5`} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 5 KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {/* Card 1: Tỷ lệ đạt SLA (%) */}
        <div className={`${card} relative overflow-hidden p-5 shadow-2xs transition hover:shadow-sm`}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Tỷ lệ đạt SLA
            </span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#10a39c]/10 text-[#10a39c]">
              <CheckCircle2 className="h-4.5 w-4.5" />
            </span>
          </div>
          <div
            className={cn(
              "mt-2 text-3xl font-extrabold tracking-tight tabular-nums",
              kpis.met_count + kpis.breached_count > 0
                ? complianceColorClass(kpis.sla_compliance_pct)
                : "text-slate-800",
            )}
          >
            {kpis.met_count + kpis.breached_count > 0
              ? `${Number(kpis.sla_compliance_pct || 0).toFixed(1)}%`
              : "—"}
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-[#0d857f]">{kpis.met_count} đạt</span>
            <span>·</span>
            <span className="font-semibold text-brand">{kpis.breached_count} quá hạn</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                complianceBarClass(kpis.sla_compliance_pct || 0),
              )}
              style={{ width: `${Math.min(100, Math.max(0, kpis.sla_compliance_pct || 0))}%` }}
            />
          </div>
        </div>

        {/* Card 2: Phản hồi TB (ART) */}
        <div className={`${card} p-5 shadow-2xs transition hover:shadow-sm`}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Phản hồi TB (ART)
            </span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <Timer className="h-4.5 w-4.5" />
            </span>
          </div>
          <div className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
            {formatDurationVi(kpis.avg_response_seconds)}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span>
              P50: <strong className="text-slate-700">{formatDurationVi(kpis.p50_response_seconds)}</strong>
            </span>
            <span>·</span>
            <span>
              P90: <strong className="text-slate-700">{formatDurationVi(kpis.p90_response_seconds)}</strong>
            </span>
          </div>
        </div>

        {/* Card 3: Phản hồi lần đầu (FRT) */}
        <div className={`${card} p-5 shadow-2xs transition hover:shadow-sm`}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Phản hồi lần đầu (FRT)
            </span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <Clock className="h-4.5 w-4.5" />
            </span>
          </div>
          <div className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
            {formatDurationVi(kpis.avg_frt_seconds)}
          </div>
          <div className="mt-2.5 text-xs text-slate-500">
            Tổng lượt khách hỏi:{" "}
            <strong className="font-semibold text-slate-800 tabular-nums">{kpis.total_turns}</strong>
          </div>
        </div>

        {/* Card 4: Đang chờ phản hồi (Live) */}
        <button
          type="button"
          onClick={() => onJumpToWaitingQueue?.(false)}
          className={cn(
            `${card} p-5 text-left shadow-2xs transition hover:shadow-sm`,
            onJumpToWaitingQueue && "cursor-pointer hover:border-amber-300",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Đang chờ phản hồi
            </span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <Hourglass className="h-4.5 w-4.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
              {kpis.waiting_count}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
              Live
            </span>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">
            {kpis.waiting_warning_count > 0 ? (
              <span className="font-semibold text-amber-700">
                ⚠ {kpis.waiting_warning_count} lượt sắp chạm hạn SLA
              </span>
            ) : (
              <span>Không có lượt sắp chạm hạn</span>
            )}
          </div>
        </button>

        {/* Card 5: Đang quá hạn SLA (Live - Đỏ nổi bật) */}
        <button
          type="button"
          onClick={() => onJumpToWaitingQueue?.(true)}
          className={cn(
            "rounded-2xl border p-5 text-left transition",
            kpis.waiting_breached_count > 0
              ? "border-rose-300 bg-gradient-to-br from-rose-50 via-white to-rose-50/70 shadow-sm shadow-rose-100 hover:border-rose-400"
              : "border-[#eef1f5] bg-white shadow-2xs hover:shadow-sm",
            onJumpToWaitingQueue && "cursor-pointer",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                kpis.waiting_breached_count > 0 ? "text-rose-700" : "text-slate-500",
              )}
            >
              Đang quá hạn SLA
            </span>
            <span
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                kpis.waiting_breached_count > 0
                  ? "bg-brand text-white shadow-xs shadow-brand/30"
                  : "bg-emerald-50 text-emerald-600",
              )}
            >
              {kpis.waiting_breached_count > 0 ? (
                <Flame className="h-4.5 w-4.5 animate-pulse" />
              ) : (
                <AlertOctagon className="h-4.5 w-4.5" />
              )}
            </span>
          </div>
          <div
            className={cn(
              "mt-2 flex items-baseline gap-2 text-3xl font-extrabold tracking-tight tabular-nums",
              kpis.waiting_breached_count > 0 ? "text-brand" : "text-emerald-700",
            )}
          >
            <span>{kpis.waiting_breached_count}</span>
            {kpis.waiting_breached_count > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                Cần xử lý ngay
              </span>
            )}
          </div>
          <div className="mt-2.5 text-xs text-slate-600">
            {kpis.waiting_breached_count > 0
              ? "Bấm để mở hàng đợi xử lý ngay →"
              : "Tuyệt vời! Không có hội thoại quá hạn"}
          </div>
        </button>
      </div>

      {/* ── Trend Chart + Channel Breakdown ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Daily Trend Chart (Pure SVG + CSS) */}
        <section className={`${card} p-5 shadow-2xs lg:col-span-7`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <TrendingUp className="h-4 w-4 text-brand" />
                Xu hướng SLA theo ngày
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {chartMetric === "compliance"
                  ? "Tỷ lệ đạt SLA (%) cùng số lượt đạt / quá hạn mỗi ngày"
                  : "Thời gian phản hồi trung bình (giờ hành chính) mỗi ngày"}
              </p>
            </div>
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setChartMetric("compliance")}
                className={cn(
                  "rounded-full px-3 py-1 font-semibold transition cursor-pointer",
                  chartMetric === "compliance"
                    ? "bg-brand text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                % Đạt SLA
              </button>
              <button
                type="button"
                onClick={() => setChartMetric("response")}
                className={cn(
                  "rounded-full px-3 py-1 font-semibold transition cursor-pointer",
                  chartMetric === "response"
                    ? "bg-brand text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                Phản hồi TB
              </button>
            </div>
          </div>

          {dailyTrend.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center text-xs text-slate-400">
              <BarChart3 className="h-8 w-8 text-slate-300" />
              <p>Chưa có dữ liệu xu hướng trong khoảng thời gian đã chọn.</p>
              <p className="text-[11px]">
                Bạn có thể chạy Backfill ở tab Cài đặt SLA để tái dựng lịch sử 7–30 ngày.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              {/* Hover / Summary bar */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs">
                {hoveredDay ? (
                  <>
                    <span className="font-bold text-slate-800">Ngày {hoveredDay.day}</span>
                    <div className="flex flex-wrap items-center gap-3 tabular-nums">
                      <span className="text-slate-600">
                        Tổng: <strong className="text-slate-900">{hoveredDay.total}</strong>
                      </span>
                      <span className="text-[#0d857f]">
                        Đạt: <strong>{hoveredDay.met}</strong>
                      </span>
                      <span className="text-brand">
                        Quá hạn: <strong>{hoveredDay.breached}</strong>
                      </span>
                      <span className="font-bold text-slate-900">
                        SLA: {Number(hoveredDay.compliance_pct || 0).toFixed(1)}%
                      </span>
                      <span className="text-blue-700">
                        TB: <strong>{formatDurationVi(hoveredDay.avg_response_seconds)}</strong>
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-slate-500">Di chuột vào từng cột để xem chi tiết ngày</span>
                    <div className="flex items-center gap-3 text-[11px] font-medium text-slate-600">
                      {chartMetric === "compliance" ? (
                        <>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm bg-[#10a39c]" />
                            Đạt SLA
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-sm bg-brand" />
                            Quá hạn
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-0.5 w-3.5 rounded bg-slate-800" />
                            % Đạt
                          </span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
                          Thời gian phản hồi TB (giờ LV)
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Pure SVG Responsive Chart */}
              <div className="relative h-56 w-full">
                <svg
                  viewBox="0 0 600 220"
                  className="h-full w-full overflow-visible"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Biểu đồ xu hướng SLA theo ngày"
                >
                  {/* Horizontal gridlines */}
                  {[0, 25, 50, 75, 100].map((pct) => {
                    const y = 185 - (pct / 100) * 165;
                    return (
                      <g key={pct}>
                        <line
                          x1={0}
                          y1={y}
                          x2={600}
                          y2={y}
                          stroke="#e2e8f0"
                          strokeDasharray={pct === 0 ? undefined : "3 3"}
                          strokeWidth={1}
                        />
                      </g>
                    );
                  })}

                  {/* Bars */}
                  {dailyTrend.map((pt, idx) => {
                    const slotW = 600 / dailyTrend.length;
                    const barW = Math.min(34, Math.max(8, slotW * 0.54));
                    const x = idx * slotW + (slotW - barW) / 2;

                    if (chartMetric === "compliance") {
                      const totalH = (pt.total / chartStats.maxTotal) * 155;
                      const metH = pt.total > 0 ? (pt.met / pt.total) * totalH : 0;
                      const breachH = pt.total > 0 ? (pt.breached / pt.total) * totalH : 0;
                      const isHover = hoveredIdx === idx;
                      return (
                        <g
                          key={pt.day}
                          onMouseEnter={() => setHoveredIdx(idx)}
                          onMouseLeave={() => setHoveredIdx(null)}
                          className="cursor-pointer"
                        >
                          <rect
                            x={idx * slotW}
                            y={10}
                            width={slotW}
                            height={180}
                            fill={isHover ? "rgba(186,36,74,0.05)" : "transparent"}
                            rx={6}
                          />
                          {/* Met bar (bottom) */}
                          {metH > 0 && (
                            <rect
                              x={x}
                              y={185 - metH}
                              width={barW}
                              height={metH}
                              fill="#10a39c"
                              opacity={isHover ? 1 : 0.88}
                              rx={breachH > 0 ? 0 : 4}
                            />
                          )}
                          {/* Breached bar (top) */}
                          {breachH > 0 && (
                            <rect
                              x={x}
                              y={185 - metH - breachH}
                              width={barW}
                              height={breachH}
                              fill="#ba244a"
                              opacity={isHover ? 1 : 0.9}
                              rx={4}
                            />
                          )}
                        </g>
                      );
                    }

                    const respH = ((pt.avg_response_seconds || 0) / chartStats.maxAvgResp) * 160;
                    const isHover = hoveredIdx === idx;
                    return (
                      <g
                        key={pt.day}
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        className="cursor-pointer"
                      >
                        <rect
                          x={idx * slotW}
                          y={10}
                          width={slotW}
                          height={180}
                          fill={isHover ? "rgba(59,130,246,0.06)" : "transparent"}
                          rx={6}
                        />
                        <rect
                          x={x}
                          y={185 - Math.max(2, respH)}
                          width={barW}
                          height={Math.max(2, respH)}
                          fill="#3b82f6"
                          opacity={isHover ? 1 : 0.85}
                          rx={4}
                        />
                      </g>
                    );
                  })}

                  {/* Compliance % polyline overlay */}
                  {chartMetric === "compliance" && dailyTrend.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#1e293b"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={dailyTrend
                        .map((pt, idx) => {
                          const slotW = 600 / dailyTrend.length;
                          const cx = idx * slotW + slotW / 2;
                          const cy = 185 - (Math.min(100, Math.max(0, pt.compliance_pct || 0)) / 100) * 165;
                          return `${cx},${cy}`;
                        })
                        .join(" ")}
                    />
                  )}
                  {chartMetric === "compliance" &&
                    dailyTrend.map((pt, idx) => {
                      const slotW = 600 / dailyTrend.length;
                      const cx = idx * slotW + slotW / 2;
                      const cy = 185 - (Math.min(100, Math.max(0, pt.compliance_pct || 0)) / 100) * 165;
                      return (
                        <circle
                          key={`dot-${pt.day}`}
                          cx={cx}
                          cy={cy}
                          r={hoveredIdx === idx ? 4.5 : 3}
                          fill="#ffffff"
                          stroke="#1e293b"
                          strokeWidth={2}
                        />
                      );
                    })}
                </svg>

                {/* X-axis day labels */}
                <div className="mt-1 flex items-center justify-between gap-1 text-[10.5px] font-medium text-slate-500">
                  {dailyTrend.map((pt, idx) => {
                    const step = dailyTrend.length > 14 ? 3 : dailyTrend.length > 9 ? 2 : 1;
                    const show = idx === 0 || idx === dailyTrend.length - 1 || idx % step === 0;
                    return (
                      <span
                        key={`lbl-${pt.day}`}
                        className={cn(
                          "flex-1 truncate text-center tabular-nums",
                          hoveredIdx === idx && "font-bold text-brand",
                        )}
                      >
                        {show ? formatDayShort(pt.day) : ""}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right: Channel Breakdown */}
        <section className={`${card} p-5 shadow-2xs lg:col-span-5`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <BarChart3 className="h-4 w-4 text-[#10a39c]" />
                Hiệu suất SLA theo kênh
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                So sánh tốc độ phản hồi giữa Zalo, Messenger, Telegram, WhatsApp
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3.5">
            {byChannel.map((ch) => {
              const meta = getChannelMeta(ch.channel);
              const closedCount = ch.met + ch.breached;
              const pct = closedCount > 0 ? Number(ch.compliance_pct || 0) : 0;
              return (
                <div
                  key={ch.channel}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 transition hover:border-slate-200 hover:bg-white"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-extrabold text-white shadow-2xs"
                        style={{ backgroundColor: meta.color }}
                      >
                        {meta.short}
                      </span>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{meta.label}</div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {ch.total} lượt · TB {formatDurationVi(ch.avg_response_seconds)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={cn(
                          "text-base font-extrabold tabular-nums",
                          closedCount > 0 ? complianceColorClass(pct) : "text-slate-400",
                        )}
                      >
                        {closedCount > 0 ? `${pct.toFixed(1)}%` : "—"}
                      </div>
                      <div className="flex items-center justify-end gap-1.5 text-[10.5px] tabular-nums">
                        <span className="text-[#0d857f]">{ch.met} đạt</span>
                        <span className="text-slate-300">·</span>
                        <span className="text-brand">{ch.breached} trễ</span>
                        {ch.waiting > 0 && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="font-semibold text-amber-600">{ch.waiting} chờ</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200/70">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", complianceBarClass(pct))}
                      style={{ width: `${closedCount > 0 ? Math.min(100, Math.max(0, pct)) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── Staff Leaderboard ──────────────────────────────────────────────── */}
      <section className={`${card} overflow-hidden shadow-2xs`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Award className="h-4 w-4 text-brand" />
              Bảng xếp hạng SLA theo nhân viên
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Thống kê tốc độ trả lời khách hàng (ART &amp; P90 trong giờ hành chính) theo từng nhân sự
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            <Users className="h-3.5 w-3.5 text-slate-500" />
            {byStaff.length} nhân viên
          </span>
        </div>

        {byStaff.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Chưa có lượt phản hồi nào của nhân viên trong khoảng thời gian này.
          </div>
        ) : (
          <div className={table.wrapper}>
            <table className={table.root}>
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  <th className={`${table.head} pl-5`}>#</th>
                  <th className={table.head}>Nhân viên</th>
                  <th className={`${table.head} text-right`}>Tổng lượt</th>
                  <th className={`${table.head} text-right`}>Đạt SLA</th>
                  <th className={`${table.head} text-right`}>Quá hạn</th>
                  <th className={table.head}>% Đạt SLA</th>
                  <th className={`${table.head} text-right`}>TB phản hồi</th>
                  <th className={`${table.head} pr-5 text-right`}>P90</th>
                </tr>
              </thead>
              <tbody>
                {byStaff.map((staff, index) => {
                  const pct = Number(staff.compliance_pct || 0);
                  const displayName = staff.name || staff.email || "Chưa gán nhân sự";
                  const rankBadge =
                    index === 0
                      ? "bg-amber-100 text-amber-800 border-amber-200"
                      : index === 1
                        ? "bg-slate-200 text-slate-700 border-slate-300"
                        : index === 2
                          ? "bg-orange-100 text-orange-800 border-orange-200"
                          : "bg-slate-100 text-slate-500 border-slate-200";

                  return (
                    <tr
                      key={staff.user_id || staff.email || `staff-${index}`}
                      className={table.row}
                    >
                      <td className={`${table.cell} pl-5`}>
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold tabular-nums",
                            rankBadge,
                          )}
                        >
                          {index + 1}
                        </span>
                      </td>
                      <td className={table.cell}>
                        <div className="font-semibold text-slate-900">{displayName}</div>
                        {staff.email && staff.name && (
                          <div className="text-xs text-slate-500">{staff.email}</div>
                        )}
                      </td>
                      <td className={`${table.cell} text-right font-semibold tabular-nums`}>
                        {staff.total}
                      </td>
                      <td className={`${table.cell} text-right font-semibold text-[#0d857f] tabular-nums`}>
                        {staff.met}
                      </td>
                      <td className={`${table.cell} text-right font-semibold text-brand tabular-nums`}>
                        {staff.breached}
                      </td>
                      <td className={`${table.cell} min-w-[180px]`}>
                        <div className="flex items-center gap-2.5">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn("h-full rounded-full", complianceBarClass(pct))}
                              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              "w-12 text-right text-xs font-bold tabular-nums",
                              complianceColorClass(pct),
                            )}
                          >
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className={`${table.cell} text-right font-medium text-slate-800 tabular-nums`}>
                        {formatDurationVi(staff.avg_response_seconds)}
                      </td>
                      <td className={`${table.cell} pr-5 text-right font-medium text-slate-600 tabular-nums`}>
                        {formatDurationVi(staff.p90_response_seconds)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
