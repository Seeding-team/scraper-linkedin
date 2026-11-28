"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Calendar,
  Cpu,
  ListChecks,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { slaAlertsService } from "@/services/slaAlertsService";
import {
  alert as uiAlert,
  btn,
  btnSize,
  select as uiSelect,
} from "@/components/all-platform/zalo/centralized-shared/zaloUi";
import { SlaOverviewTab } from "./SlaOverviewTab";
import { SlaTurnsQueueTab } from "./SlaTurnsQueueTab";
import { ZaloGroupAlertConfigTab } from "./ZaloGroupAlertConfigTab";
import { SlaSettingsTab } from "./SlaSettingsTab";
import {
  isJsEngineOnline,
  PRIMARY_SLA_CHANNELS,
  type JsEngineStatus,
  type SlaDashboardData,
} from "@/types/sla-alerts";

type MonitorTab = "overview" | "queue" | "alerts" | "settings";
type DatePreset = "today" | "7d" | "14d" | "30d" | "custom";

function formatYmdVn(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function getDateRangeForPreset(preset: Exclude<DatePreset, "custom">): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const endDate = formatYmdVn(now);
  const offsetDays = preset === "today" ? 0 : preset === "7d" ? 6 : preset === "14d" ? 13 : 29;
  const start = new Date(now.getTime() - offsetDays * 86_400_000);
  return { startDate: formatYmdVn(start), endDate };
}

function formatUptime(ms?: number | null): string {
  if (!ms || ms < 0) return "";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}p`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}g ${mins % 60}p`;
}

export function SlaMonitorShell() {
  const { user } = useAppAuth();
  const userEmail = user?.email ?? null;

  const [activeTab, setActiveTab] = useState<MonitorTab>("overview");
  const [queueInitialStatus, setQueueInitialStatus] = useState<string>("all");

  // Date & Channel filters
  const [datePreset, setDatePreset] = useState<DatePreset>("7d");
  const initialRange = useMemo(() => getDateRangeForPreset("7d"), []);
  const [startDate, setStartDate] = useState<string>(initialRange.startDate);
  const [endDate, setEndDate] = useState<string>(initialRange.endDate);
  const [channelFilter, setChannelFilter] = useState<string>("all");

  // Shared state
  const [dashboard, setDashboard] = useState<SlaDashboardData | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState<boolean>(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<JsEngineStatus | null>(null);
  const [refreshSignal, setRefreshSignal] = useState<number>(0);

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== "custom") {
      const range = getDateRangeForPreset(preset);
      setStartDate(range.startDate);
      setEndDate(range.endDate);
    }
  };

  const fetchOverviewAndEngine = useCallback(async () => {
    setLoadingDashboard(true);
    setDashboardError(null);
    try {
      const [dashRes, liveRes] = await Promise.all([
        slaAlertsService.getDashboard(
          { start_date: startDate, end_date: endDate, channel: channelFilter },
          userEmail,
        ),
        slaAlertsService.getLiveBadges("all", userEmail),
      ]);

      if (dashRes.success && dashRes.data) {
        setDashboard(dashRes.data);
      } else {
        setDashboardError(dashRes.message || "Không tải được dữ liệu tổng quan SLA.");
      }

      if (liveRes.success && liveRes.data && liveRes.data.engine_status !== undefined) {
        setEngineStatus(liveRes.data.engine_status ?? null);
      }
    } catch (e) {
      setDashboardError(e instanceof Error ? e.message : "Lỗi kết nối máy chủ SLA.");
    } finally {
      setLoadingDashboard(false);
    }
  }, [startDate, endDate, channelFilter, userEmail]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void fetchOverviewAndEngine();
    });
    return () => {
      alive = false;
    };
  }, [fetchOverviewAndEngine, refreshSignal]);

  const handleRefreshAll = () => {
    setRefreshSignal((prev) => prev + 1);
  };

  const handleJumpToWaitingQueue = (onlyBreached?: boolean) => {
    setQueueInitialStatus(onlyBreached ? "waiting_breached" : "waiting");
    setActiveTab("queue");
  };

  const engineLive = isJsEngineOnline(engineStatus);
  const engineStats = engineStatus?.stats;
  const engineTooltip = engineLive
    ? [
        `Node.js Alert Forward Engine đang hoạt động`,
        engineStatus?.pid ? `PID: ${engineStatus.pid}` : null,
        engineStatus?.uptime_ms ? `Uptime: ${formatUptime(engineStatus.uptime_ms)}` : null,
        engineStats?.sent_total != null ? `Đã gửi: ${engineStats.sent_total}` : null,
        engineStats?.coalesced_total != null ? `Đã gom: ${engineStats.coalesced_total}` : null,
        engineStats?.pending_debounce != null ? `Đang debounce: ${engineStats.pending_debounce}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : engineStatus?.error ||
      engineStatus?.last_error ||
      "Node.js Alert Engine đang offline — hệ thống sẽ tự chuyển dự phòng qua Python Fallback.";

  const waitingCount = dashboard?.kpis?.waiting_count ?? 0;
  const waitingBreachedCount = dashboard?.kpis?.waiting_breached_count ?? 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ── Page Header ──────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-4 rounded-2xl border border-[#eef1f5] bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-sm shadow-brand/25">
                <Activity className="h-5.5 w-5.5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
                    Giám sát SLA &amp; Thông báo Nhóm
                  </h1>

                  {/* Live Node.js Alert Engine Status Badge */}
                  <span
                    title={engineTooltip}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition",
                      engineLive
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-300 bg-amber-50 text-amber-800",
                    )}
                  >
                    <span className="relative flex h-2 w-2">
                      {engineLive && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      )}
                      <span
                        className={cn(
                          "relative inline-flex h-2 w-2 rounded-full",
                          engineLive ? "bg-emerald-500" : "bg-amber-500",
                        )}
                      />
                    </span>
                    <Cpu className="h-3 w-3 shrink-0" />
                    {engineLive
                      ? `JS Engine Live${engineStatus?.pid ? ` · PID ${engineStatus.pid}` : ""}`
                      : "JS Engine Offline"}
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                  Đo lường tốc độ phản hồi khách hàng đa kênh (Zalo, Messenger, Telegram, WhatsApp) theo giờ hành chính &amp; bắn thông báo tự động về nhóm Zalo chung.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={loadingDashboard}
              className={`${btn.outline} ${btnSize.sm} cursor-pointer`}
            >
              {loadingDashboard ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Làm mới
            </button>
          </div>

          {/* ── Filter Controls Bar ────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
            {/* Date Range Presets + Custom */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs">
                {(
                  [
                    { id: "today", label: "Hôm nay" },
                    { id: "7d", label: "7 ngày" },
                    { id: "14d", label: "14 ngày" },
                    { id: "30d", label: "30 ngày" },
                    { id: "custom", label: "Tùy chọn" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePresetChange(p.id)}
                    className={cn(
                      "rounded-full px-3 py-1 font-semibold transition cursor-pointer",
                      datePreset === p.id
                        ? "bg-brand text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {datePreset === "custom" ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none focus:border-brand"
                    aria-label="Từ ngày"
                  />
                  <span className="text-slate-400">→</span>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none focus:border-brand"
                    aria-label="Đến ngày"
                  />
                </div>
              ) : (
                <span className="hidden text-xs font-medium text-slate-500 tabular-nums md:inline">
                  {startDate} → {endDate}
                </span>
              )}
            </div>

            {/* Channel Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Kênh:</span>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className={`${uiSelect} h-8 text-xs`}
                aria-label="Chọn kênh theo dõi"
              >
                <option value="all">Tất cả kênh</option>
                {PRIMARY_SLA_CHANNELS.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        {/* ── 4-Tab Navigation ─────────────────────────────────────────────── */}
        <nav
          aria-label="Các mục Giám sát SLA"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#eef1f5] bg-white p-1.5 shadow-2xs"
        >
          {(
            [
              {
                id: "overview" as const,
                label: "Tổng quan SLA",
                icon: BarChart3,
              },
              {
                id: "queue" as const,
                label: "Hàng đợi & Lịch sử",
                icon: ListChecks,
                badgeCount: waitingBreachedCount > 0 ? waitingBreachedCount : waitingCount,
                badgeDanger: waitingBreachedCount > 0,
              },
              {
                id: "alerts" as const,
                label: "Thông báo Zalo Group",
                icon: Bell,
              },
              {
                id: "settings" as const,
                label: "Cài đặt SLA & Backfill",
                icon: Settings2,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const badgeCount = "badgeCount" in tab ? tab.badgeCount : 0;
            const badgeDanger = "badgeDanger" in tab ? tab.badgeDanger : false;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex flex-1 min-w-[160px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition sm:flex-none sm:text-sm cursor-pointer",
                  active
                    ? "bg-brand text-white shadow-xs shadow-brand/25"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{tab.label}</span>
                {badgeCount > 0 && (
                  <span
                    className={cn(
                      "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums",
                      active
                        ? "bg-white text-brand"
                        : badgeDanger
                          ? "bg-rose-600 text-white animate-pulse"
                          : "bg-amber-100 text-amber-800",
                    )}
                  >
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Dashboard-level error alert */}
        {dashboardError && activeTab === "overview" && (
          <div className={uiAlert.error}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{dashboardError}</span>
            <button
              type="button"
              onClick={handleRefreshAll}
              className="text-xs font-semibold underline cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* ── Active Tab Content ───────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <SlaOverviewTab
            data={dashboard}
            loading={loadingDashboard}
            onJumpToWaitingQueue={handleJumpToWaitingQueue}
          />
        )}

        {activeTab === "queue" && (
          <SlaTurnsQueueTab
            key={`${queueInitialStatus}-${channelFilter}`}
            startDate={startDate}
            endDate={endDate}
            channelFilter={channelFilter}
            initialStatusFilter={queueInitialStatus}
            refreshSignal={refreshSignal}
            onMutated={handleRefreshAll}
          />
        )}

        {activeTab === "alerts" && (
          <ZaloGroupAlertConfigTab
            refreshSignal={refreshSignal}
            onEngineStatus={setEngineStatus}
          />
        )}

        {activeTab === "settings" && (
          <SlaSettingsTab
            refreshSignal={refreshSignal}
            onSaved={handleRefreshAll}
          />
        )}

        {/* Subtle footer note */}
        <footer className="flex flex-wrap items-center justify-between gap-2 pb-4 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#10a39c]" />
            SLA Watchdog kiểm tra tự động mỗi 15 giây · Anti-Loop Guard đang bảo vệ toàn bộ luồng Zalo Group
          </span>
          <span>Múi giờ: Asia/Ho_Chi_Minh (UTC+7)</span>
        </footer>
      </div>
    </div>
  );
}
