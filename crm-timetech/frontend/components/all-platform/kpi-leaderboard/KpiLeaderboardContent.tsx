"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  allPlatformKpiService,
  teamsService,
  type TeamRow,
} from "@/services/all-platform.service";

type MetricKey = "lead" | "inbox" | "post" | "comment";
type ViewMode = "overall" | MetricKey;

interface MetricStats {
  actual: number;
  target: number;
}

type MetricStatsMap = Record<MetricKey, MetricStats>;

interface LooseTeamMember {
  id?: string;
  email?: string;
  name?: string;
}

interface LooseKpiMember {
  id?: string;
  seeding_stats?: {
    kpi_lead_current?: number;
    kpi_lead?: number;
    kpi_inbox_current?: number;
    kpi_inbox?: number;
    kpi_post_current?: number;
    kpi_post?: number;
    verified_count?: number;
    kpi_target?: number;
  };
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  metrics: MetricStatsMap;
  score: number;
}

interface TeamAggregate {
  team: TeamRow;
  shortLabel: string;
  color: string;
  metrics: MetricStatsMap;
  score: number;
  memberCount: number;
  members: MemberRow[];
}

interface AlertData {
  teamName: string;
  leaderName: string;
  metric: MetricKey | null;
  deficit: number;
  noTarget: boolean;
}

const METRIC_KEYS: MetricKey[] = ["lead", "inbox", "post", "comment"];

const METRIC_LABELS: Record<MetricKey, string> = {
  lead: "Lead",
  inbox: "Inbox",
  post: "Post",
  comment: "Comment",
};

const METRIC_COLORS: Record<MetricKey, string> = {
  lead: "#6366f1",
  inbox: "#22c55e",
  post: "#f59e0b",
  comment: "#a855f7",
};

const BASE_WEIGHTS: Record<MetricKey, number> = {
  lead: 40,
  inbox: 30,
  comment: 20,
  post: 10,
};

const TEAM_COLORS = ["#4f46e5", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#dc2626"];

function emptyMetrics(): MetricStatsMap {
  return {
    lead: { actual: 0, target: 0 },
    inbox: { actual: 0, target: 0 },
    post: { actual: 0, target: 0 },
    comment: { actual: 0, target: 0 },
  };
}

function addMetrics(target: MetricStatsMap, source: MetricStatsMap) {
  METRIC_KEYS.forEach((key) => {
    target[key].actual += source[key].actual;
    target[key].target += source[key].target;
  });
}

function computeScore(metrics: MetricStatsMap): number {
  let weightSum = 0;
  const active: Partial<Record<MetricKey, number>> = {};

  METRIC_KEYS.forEach((key) => {
    if (metrics[key].target > 0) {
      active[key] = BASE_WEIGHTS[key];
      weightSum += BASE_WEIGHTS[key];
    }
  });

  if (weightSum === 0) return 0;

  let score = 0;
  METRIC_KEYS.forEach((key) => {
    const weight = active[key];
    if (!weight) return;
    const pct = metrics[key].target > 0 ? Math.min(100, (metrics[key].actual / metrics[key].target) * 100) : 0;
    score += pct * (weight / weightSum);
  });

  return Math.round(score);
}

function scoreTier(score: number): { label: string; tone: "risk" | "warn" | "ok" | "idle" } {
  if (score >= 70) return { label: "Đạt KPI", tone: "ok" };
  if (score >= 40) return { label: "Cần đẩy", tone: "warn" };
  if (score > 0) return { label: "Rủi ro", tone: "risk" };
  return { label: "Chưa bắt đầu", tone: "idle" };
}

function toneClasses(tone: "risk" | "warn" | "ok" | "idle") {
  if (tone === "ok") return { text: "text-emerald-600", bg: "bg-emerald-50", chip: "bg-emerald-50 text-emerald-600" };
  if (tone === "warn") return { text: "text-amber-600", bg: "bg-amber-50", chip: "bg-amber-50 text-amber-600" };
  if (tone === "idle") return { text: "text-on-surface-variant", bg: "bg-surface-container-low", chip: "bg-surface-container-low text-on-surface-variant" };
  return { text: "text-primary", bg: "bg-red-50", chip: "bg-red-50 text-primary" };
}

function getRecentWeeks(numWeeks = 8) {
  const weeks: Array<{ label: string; value: string }> = [];
  const curr = new Date();

  for (let i = 0; i < numWeeks; i += 1) {
    const d = new Date(curr.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const yearStart = new Date(monday.getFullYear(), 0, 1);
    const weekNo = Math.ceil(
      ((monday.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
    );

    const fmt = (dt: Date) => dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
    const valStart = monday.toISOString().split("T")[0];
    const valEnd = sunday.toISOString().split("T")[0];

    weeks.push({
      label: i === 0 ? `Tuần ${weekNo} (hiện tại)` : `Tuần ${weekNo} (${fmt(monday)} - ${fmt(sunday)})`,
      value: `${valStart}_${valEnd}`,
    });
  }

  return weeks;
}

function shortTeamLabel(index: number, leaderName?: string) {
  const last = (leaderName || "").trim().split(/\s+/).filter(Boolean).pop();
  return `T${index + 1}${last ? ` · ${last}` : ""}`;
}

function ProgressBar({ actual, target, color, thick = false }: { actual: number; target: number; color: string; thick?: boolean }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-slate-100", thick ? "h-2" : "h-1.5")}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// Segmented-control pill (Linear/Notion style): 1 track nen xam nhat chua het cac
// lua chon, lua chon active la 1 pill trang noi bat + shadow nhe - thay cho kieu
// "chip roi rac" truoc day.
function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-full bg-slate-100 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition",
            value === opt.value
              ? "bg-white text-on-surface shadow-sm"
              : "text-on-surface-variant hover:text-on-surface",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Donut({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const tier = scoreTier(score);
  const tone = toneClasses(tier.tone);
  const pct = Math.max(0, Math.min(100, score));
  const color =
    tier.tone === "ok" ? "#059669" : tier.tone === "warn" ? "#d97706" : tier.tone === "idle" ? "#94a3b8" : "#dc2626";
  const outer = size === "lg" ? "h-20 w-20" : "h-14 w-14";
  const inner = size === "lg" ? "h-16 w-16" : "h-11 w-11";
  const textSize = size === "lg" ? "text-base" : "text-xs";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full", outer)}
      style={{
        background: `conic-gradient(${color} ${pct}%, #e5e7eb ${pct}% 100%)`,
      }}
    >
      <div className={cn("flex items-center justify-center rounded-full bg-surface", inner)}>
        <span className={cn("font-black", textSize, tone.text)}>{score}%</span>
      </div>
    </div>
  );
}

const ALERT_SEVERITY_META = {
  high: { label: "Cao", chip: "bg-red-50 text-red-600", icon: "bg-red-50 text-red-600" },
  medium: { label: "Trung bình", chip: "bg-amber-50 text-amber-600", icon: "bg-amber-50 text-amber-600" },
  low: { label: "Thấp", chip: "bg-slate-100 text-on-surface-variant", icon: "bg-slate-100 text-on-surface-variant" },
} as const;

// Team chua co target (noTarget) luon la muc "Cao" - can giao KPI ngay, khong de
// bi lan vao thang hang theo deficit voi cac team da co target that. `rank` la thu
// hang trong so cac alert co target that (tinh o ngoai, truyen vao).
function AlertItem({ alert, rank }: { alert: AlertData; rank: number }) {
  const severity = alert.noTarget ? "high" : rank === 0 ? "high" : rank <= 2 ? "medium" : "low";
  const meta = ALERT_SEVERITY_META[severity];
  return (
    <div className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-slate-50">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.icon)}>
        <MaterialIcon name={alert.noTarget ? "error_outline" : "warning_amber"} className="text-base" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-on-surface">{alert.teamName}</p>
        <p className="mt-0.5 text-xs leading-snug text-on-surface-variant">
          {alert.noTarget ? (
            <>
              Chưa có mục tiêu KPI tuần này · Cần giao KPI cho leader{" "}
              <span className="font-semibold text-on-surface">{alert.leaderName}</span>.
            </>
          ) : (
            <>
              Thiếu {alert.deficit} {METRIC_LABELS[alert.metric as MetricKey]} · Ưu tiên leader{" "}
              <span className="font-semibold text-on-surface">{alert.leaderName}</span> đẩy hôm nay.
            </>
          )}
        </p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", meta.chip)}>{meta.label}</span>
    </div>
  );
}

export function KpiLeaderboardContent() {
  const recentWeeks = useMemo(() => getRecentWeeks(8), []);
  const [selectedWeek, setSelectedWeek] = useState(recentWeeks[0]?.value || "");
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamAggregates, setTeamAggregates] = useState<TeamAggregate[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("overall");
  const memberTableRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  // Portal modal ra <body> - trang nay nam trong layout co sidebar/card dung CSS
  // transform (hover, animation...), neu render "fixed inset-0" ngay tai cho thi
  // se bi "neo" vao ancestor co transform thay vi viewport, bop modal thanh 1 cot
  // moi vai chuc px (xem giai thich chi tiet o StageTransitionModal.tsx). Chi
  // portal sau khi mount tren client de tranh hydration mismatch.
  const [mountedModal, setMountedModal] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMountedModal(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showAllAlerts) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [showAllAlerts]);

  useEffect(() => {
    const loadTeams = async () => {
      const res = await teamsService.getAll();
      if (!res.success || !res.data) {
        setError(res.message || "Không thể tải danh sách team.");
        return;
      }
      setTeams(res.data);
    };
    void loadTeams();
  }, []);

  useEffect(() => {
    if (teams.length === 0) return;

    const [startDate, endDate] = selectedWeek.split("_");

    const loadOverview = async () => {
      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(
          teams.map((team) =>
            allPlatformKpiService.getAll(team.leader_email, team.id, startDate, endDate),
          ),
        );

        const aggregates: TeamAggregate[] = teams.map((team, index) => {
          const kpiRes = results[index];
          const kpiMembers = (kpiRes.success && kpiRes.data?.members ? kpiRes.data.members : []) as LooseKpiMember[];
          const teamColor = TEAM_COLORS[index % TEAM_COLORS.length];

          const teamMembersList: LooseTeamMember[] = team.members || [];
          const hasLeaderAlready = teamMembersList.some((m) => m.id === team.id_leader);
          const allMembersRaw = hasLeaderAlready
            ? teamMembersList
            : [...teamMembersList, { id: team.id_leader, email: team.leader_email, name: team.leader_name }];
          // De-dupe theo id (fallback email) - team.members tu API doi khi chua
          // dong bo (vd id kieu khac nhau giua team.members va id_leader lam
          // hasLeaderAlready so sanh sai), gay trung dong React key ("Encountered
          // two children with the same key"). Loc lai o day de chac chan moi
          // thanh vien chi xuat hien 1 lan trong 1 team, bat ke nguyen nhan trung.
          const seenMemberIds = new Set<string>();
          const allMembers = allMembersRaw.filter((member) => {
            const identity = String(member.id || member.email || "").trim();
            if (!identity || seenMemberIds.has(identity)) return false;
            seenMemberIds.add(identity);
            return true;
          });

          const teamMetrics = emptyMetrics();
          const members: MemberRow[] = allMembers.map((member) => {
            const kpiInfo = kpiMembers.find((row) => row.id === member.id) || {};
            const stats = kpiInfo.seeding_stats || {};

            const metrics: MetricStatsMap = {
              lead: { actual: stats.kpi_lead_current || 0, target: stats.kpi_lead || 0 },
              inbox: { actual: stats.kpi_inbox_current || 0, target: stats.kpi_inbox || 0 },
              post: { actual: stats.kpi_post_current || 0, target: stats.kpi_post || 0 },
              comment: { actual: stats.verified_count || 0, target: stats.kpi_target || 0 },
            };

            addMetrics(teamMetrics, metrics);

            return {
              id: member.id || member.email || "",
              name: member.name || member.email || "—",
              email: member.email || "",
              teamId: team.id,
              teamName: team.name_team,
              teamColor,
              metrics,
              score: computeScore(metrics),
            };
          });

          return {
            team,
            shortLabel: shortTeamLabel(index, team.leader_name),
            color: teamColor,
            metrics: teamMetrics,
            score: computeScore(teamMetrics),
            memberCount: allMembers.length,
            members,
          };
        });

        setTeamAggregates(aggregates);
      } catch (overviewError) {
        console.error("Failed to load KPI leaderboard", overviewError);
        setError("Không thể tải dữ liệu KPI leaderboard.");
      } finally {
        setLoading(false);
      }
    };

    void loadOverview();
  }, [teams, selectedWeek]);

  const overallMetrics = useMemo(() => {
    const metrics = emptyMetrics();
    teamAggregates.forEach((agg) => addMetrics(metrics, agg.metrics));
    return metrics;
  }, [teamAggregates]);

  const overallScore = useMemo(() => computeScore(overallMetrics), [overallMetrics]);
  const overallTier = scoreTier(overallScore);
  const overallTone = toneClasses(overallTier.tone);

  const alerts = useMemo(() => {
    const items: AlertData[] = [];
    teamAggregates.forEach((agg) => {
      let worstMetric: MetricKey | null = null;
      let worstDeficit = 0;
      let hasAnyTarget = false;
      METRIC_KEYS.forEach((key) => {
        const { actual, target } = agg.metrics[key];
        if (target > 0) hasAnyTarget = true;
        const deficit = target - actual;
        if (target > 0 && deficit > worstDeficit) {
          worstDeficit = deficit;
          worstMetric = key;
        }
      });
      // Team CHUA CO muc tieu KPI nao (target=0 het) truoc day bi bo qua hoan toan
      // khoi danh sach canh bao - trong khi day moi la truong hop can xu ly gap
      // nhat (team chua duoc giao KPI tuan nay), khong phai team dang lam do da co
      // target that chi con thieu mot phan.
      if (!hasAnyTarget) {
        items.push({ teamName: agg.team.name_team, leaderName: agg.team.leader_name, metric: null, deficit: Infinity, noTarget: true });
      } else if (worstMetric) {
        items.push({ teamName: agg.team.name_team, leaderName: agg.team.leader_name, metric: worstMetric, deficit: worstDeficit, noTarget: false });
      }
    });
    // Khong gioi han o day nua - danh sach day du de trong Modal "Xem tat ca", chi
    // rut gon o UI chinh (2 dong dau) qua showAllAlerts.
    return items.sort((a, b) => b.deficit - a.deficit);
  }, [teamAggregates]);

  const visibleTeamAggregates = useMemo(
    () => (selectedTeamId === "all" ? teamAggregates : teamAggregates.filter((agg) => agg.team.id === selectedTeamId)),
    [teamAggregates, selectedTeamId],
  );

  const memberRows = useMemo(() => {
    const rows = visibleTeamAggregates.flatMap((agg) => agg.members);
    return [...rows].sort((a, b) => a.score - b.score);
  }, [visibleTeamAggregates]);

  const visibleMetricKeys = viewMode === "overall" ? METRIC_KEYS : [viewMode];

  const handleExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");

      const teamSheetRows = teamAggregates.map((agg) => {
        const row: Record<string, string | number> = {
          Team: agg.team.name_team,
          Leader: agg.team.leader_name,
          "Số thành viên": agg.memberCount,
          "Điểm KPI (%)": agg.score,
        };
        METRIC_KEYS.forEach((key) => {
          row[`${METRIC_LABELS[key]} thực tế`] = agg.metrics[key].actual;
          row[`${METRIC_LABELS[key]} target`] = agg.metrics[key].target;
        });
        return row;
      });

      const memberSheetRows = teamAggregates
        .flatMap((agg) => agg.members)
        .map((member) => {
          const row: Record<string, string | number> = {
            Member: member.name,
            Email: member.email,
            Team: member.teamName,
            "Điểm KPI (%)": member.score,
          };
          METRIC_KEYS.forEach((key) => {
            row[`${METRIC_LABELS[key]} thực tế`] = member.metrics[key].actual;
            row[`${METRIC_LABELS[key]} target`] = member.metrics[key].target;
          });
          return row;
        });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teamSheetRows), "Tổng hợp Team");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(memberSheetRows), "Member");

      const weekLabel = recentWeeks.find((w) => w.value === selectedWeek)?.label || selectedWeek;
      XLSX.writeFile(wb, `kpi-leaderboard-${weekLabel.replace(/[^\w]+/g, "-")}.xlsx`);
    } catch (exportError) {
      console.error("Export KPI leaderboard failed", exportError);
      setError("Xuất báo cáo thất bại.");
    } finally {
      setExporting(false);
    }
  };

  const goToTeamMembers = (teamId: string) => {
    setSelectedTeamId(teamId);
    memberTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 bg-slate-50 font-sans">
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold leading-tight text-on-surface">KPI Dashboard — Leaderboard</h1>
          <p className="text-xs leading-tight text-on-surface-variant">
            KPI tuần theo Team &amp; Member · Lead / Inbox / Post / Comment
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || loading || teamAggregates.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-white px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/5 disabled:opacity-50"
          >
            <MaterialIcon name="file_download" className="text-base" />
            {exporting ? "Đang xuất..." : "Xuất báo cáo"}
          </button>

          <select
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-on-surface outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/20"
          >
            {recentWeeks.map((week) => (
              <option key={week.value} value={week.value}>
                {week.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-primary">
          {error}
        </div>
      ) : null}

      {/* Overview + alerts - nen trang/nhat thay cho khoi xanh den truoc day, 2 card
          cao bang nhau, bo goc lon + shadow nhe kieu SaaS hien dai. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">KPI tuần hiện tại</p>

          <div className="mt-3 flex items-center gap-4">
            <Donut score={overallScore} size="lg" />
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-on-surface">{loading ? "…" : `${overallScore}%`}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", overallTone.chip)}>{overallTier.label}</span>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">Tổng hợp toàn bộ team seeding</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {METRIC_KEYS.map((key) => (
              <div key={key} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-on-surface-variant">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: METRIC_COLORS[key] }} />
                  {METRIC_LABELS[key]}
                </p>
                <p className="mt-1 text-sm font-bold text-on-surface">
                  {overallMetrics[key].actual}/{overallMetrics[key].target}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Notification-center style: icon tron + noi dung + badge muc do, khong
            con khung xam to bao ngoai tung item. Chi hien 2 dong dau, con lai xem
            qua popup "Xem tat ca" de khong lam day card. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
              <MaterialIcon name="warning" className="text-base text-amber-600" />
              Việc cần xử lý hôm nay
            </h3>
            {alerts.length > 2 ? (
              <button
                type="button"
                onClick={() => setShowAllAlerts(true)}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                Xem tất cả ({alerts.length})
              </button>
            ) : null}
          </div>
          <div className="mt-3 space-y-1">
            {loading ? (
              <p className="text-xs text-on-surface-variant">Đang tải...</p>
            ) : alerts.length === 0 ? (
              <p className="text-xs text-on-surface-variant">Không có cảnh báo — tất cả team đang bám sát KPI.</p>
            ) : (
              alerts.slice(0, 2).map((alert, index) => {
                const rank = alerts.slice(0, index).filter((a) => !a.noTarget).length;
                return <AlertItem key={`${alert.teamName}-${alert.metric ?? "no-target"}`} alert={alert} rank={rank} />;
              })
            )}
          </div>
        </div>
      </div>

      {showAllAlerts && mountedModal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[99999] isolate flex items-center justify-center bg-slate-950/40 p-4"
              onClick={() => setShowAllAlerts(false)}
            >
              <div
                className="flex max-h-[80vh] w-[500px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                    <MaterialIcon name="warning" className="text-base text-amber-600" />
                    Việc cần xử lý hôm nay ({alerts.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAllAlerts(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant hover:bg-slate-100"
                  >
                    <MaterialIcon name="close" className="text-base" />
                  </button>
                </div>
                <div className="space-y-1 overflow-y-auto px-3 py-3">
                  {alerts.map((alert, index) => {
                    const rank = alerts.slice(0, index).filter((a) => !a.noTarget).length;
                    return <AlertItem key={`${alert.teamName}-${alert.metric ?? "no-target"}`} alert={alert} rank={rank} />;
                  })}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Filters - segmented control kieu Linear/Notion thay vi chip roi rac */}
      <div className="flex flex-col flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-on-surface-variant">Team</span>
          <SegmentedControl
            value={selectedTeamId}
            onChange={setSelectedTeamId}
            options={[
              { value: "all", label: "Tất cả" },
              ...teamAggregates.map((agg) => ({ value: agg.team.id, label: agg.shortLabel })),
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-on-surface-variant">Chế độ xem</span>
          <SegmentedControl
            value={viewMode}
            onChange={setViewMode}
            options={(["overall", ...METRIC_KEYS] as ViewMode[]).map((mode) => ({
              value: mode,
              label: mode === "overall" ? "Tổng hợp" : METRIC_LABELS[mode],
            }))}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-800">
        KPI được tính theo trọng số: Lead 40% · Inbox 30% · Comment 20% · Post 10%. Team nào không có KPI cho 1 chỉ số
        sẽ tự bỏ trọng số chỉ số đó để tránh méo điểm.
      </div>

      {/* Team cards - vien mong dong nhat + shadow nhe, mau nhan dien chi con o
          avatar (khong con vien mau to phia tren nhu truoc). */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))" }}>
        {(loading && teamAggregates.length === 0
          ? teams
          : visibleTeamAggregates.length > 0
            ? visibleTeamAggregates.map((a) => a.team)
            : []
        ).map((team) => {
          const index = teamAggregates.findIndex((a) => a.team.id === team.id);
          const agg = teamAggregates.find((a) => a.team.id === team.id);
          const color = agg?.color || TEAM_COLORS[(index < 0 ? 0 : index) % TEAM_COLORS.length];
          // Chi tinh la "can bu" khi deficit THAT SU duong (con thieu) - truoc day
          // khong loc nen team da lam VUOT target (deficit am) van bi hien nham
          // thanh "Can bu -1 Comment", vo ly.
          const worstMetric = agg
            ? visibleMetricKeys.reduce<{ key: MetricKey; deficit: number } | null>((worst, key) => {
                const deficit = agg.metrics[key].target - agg.metrics[key].actual;
                if (agg.metrics[key].target > 0 && deficit > 0 && deficit > (worst?.deficit ?? 0)) {
                  return { key, deficit };
                }
                return worst;
              }, null)
            : null;
          // "Vuot KPI" CHI khi co it nhat 1 chi so actual > target that su (deficit
          // am). Neu actual == target dung boc (deficit = 0) thi la "Dat KPI", KHONG
          // phai "Vuot" - truoc day khong phan biet 2 truong hop nay.
          const exceededAny = agg
            ? METRIC_KEYS.some((key) => agg.metrics[key].target > 0 && agg.metrics[key].actual > agg.metrics[key].target)
            : false;

          return (
            <div
              key={team.id}
              className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_12px_28px_rgba(15,23,42,0.09)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
                  >
                    T{(index < 0 ? 0 : index) + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-on-surface">{team.name_team}</p>
                    <p className="truncate text-[11px] text-on-surface-variant">
                      Leader: {team.leader_name} · {team.number_of_member ?? agg?.memberCount ?? 0} thành viên
                    </p>
                  </div>
                </div>
                {agg ? <Donut score={agg.score} /> : null}
              </div>

              <div className="mt-4 space-y-2.5">
                {visibleMetricKeys.map((key) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 font-medium text-on-surface-variant">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: METRIC_COLORS[key] }} />
                        {METRIC_LABELS[key]}
                      </span>
                      <span className="font-semibold text-on-surface tabular-nums">
                        {agg ? `${agg.metrics[key].actual} / ${agg.metrics[key].target}` : "…"}
                      </span>
                    </div>
                    <ProgressBar actual={agg?.metrics[key].actual ?? 0} target={agg?.metrics[key].target ?? 0} color={METRIC_COLORS[key]} />
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-[11px] text-on-surface-variant">
                  {worstMetric ? (
                    <>
                      Cần bù <span className="font-semibold text-on-surface">{worstMetric.deficit} {METRIC_LABELS[worstMetric.key]}</span>
                    </>
                  ) : exceededAny ? (
                    <span className="font-semibold text-emerald-600">Vượt KPI 🎉</span>
                  ) : agg && METRIC_KEYS.some((key) => agg.metrics[key].target > 0) ? (
                    <span className="font-semibold text-emerald-600">Đạt KPI</span>
                  ) : (
                    "Đang bám KPI"
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => goToTeamMembers(team.id)}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-on-surface-variant transition hover:bg-slate-50"
                >
                  Members →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Member table - header sticky, zebra row, badge Team pastel, progress bar
          thay khoang trang o cot KPI. */}
      <div ref={memberTableRef} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
            <MaterialIcon name="groups" className="text-base text-primary" />
            Member cần follow — {recentWeeks.find((w) => w.value === selectedWeek)?.label.split(" (")[0] || ""}
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={selectedTeamId}
              onChange={(event) => setSelectedTeamId(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-on-surface outline-none"
            >
              <option value="all">Tất cả team</option>
              {teamAggregates.map((agg) => (
                <option key={agg.team.id} value={agg.team.id}>
                  {agg.team.name_team}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || loading || memberRows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-white px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/5 disabled:opacity-50"
            >
              <MaterialIcon name="file_download" className="text-sm" />
              Export
            </button>
          </div>
        </div>

        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-on-surface-variant">Member</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-on-surface-variant">Team</th>
                {visibleMetricKeys.map((key) => (
                  <th key={key} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-on-surface-variant">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: METRIC_COLORS[key] }} />
                      {METRIC_LABELS[key]}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-on-surface-variant">Score</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-on-surface-variant">Ưu tiên xử lý</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={visibleMetricKeys.length + 4} className="px-4 py-6 text-center text-xs text-on-surface-variant">
                    Đang tải dữ liệu...
                  </td>
                </tr>
              ) : memberRows.length === 0 ? (
                <tr>
                  <td colSpan={visibleMetricKeys.length + 4} className="px-4 py-6 text-center text-xs text-on-surface-variant">
                    Không có dữ liệu.
                  </td>
                </tr>
              ) : (
                memberRows.map((member, rowIdx) => {
                  const tier = scoreTier(member.score);
                  const tone = toneClasses(tier.tone);
                  // Chi tinh la "Thieu" khi deficit THAT SU duong - truoc day khong
                  // loc nen member lam VUOT target (deficit am) bi hien nham thanh
                  // "Thieu -1 Comment" (vo ly, dang le phai la "Vuot KPI").
                  const worst = METRIC_KEYS.reduce<{ key: MetricKey; deficit: number } | null>((acc, key) => {
                    const deficit = member.metrics[key].target - member.metrics[key].actual;
                    if (member.metrics[key].target > 0 && deficit > 0 && deficit > (acc?.deficit ?? 0)) {
                      return { key, deficit };
                    }
                    return acc;
                  }, null);
                  const hasAnyTarget = METRIC_KEYS.some((key) => member.metrics[key].target > 0);
                  // "Vuot KPI" CHI khi actual > target that su o it nhat 1 chi so -
                  // actual == target dung boc thi la "Dat KPI", khong phai "Vuot".
                  const exceededAny = METRIC_KEYS.some((key) => member.metrics[key].target > 0 && member.metrics[key].actual > member.metrics[key].target);

                  return (
                    <tr
                      key={`${member.teamId}-${member.id}`}
                      className={cn(
                        "border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50",
                        rowIdx % 2 === 1 && "bg-slate-50/50",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
                            style={{ background: `linear-gradient(135deg, ${member.teamColor}, ${member.teamColor}cc)` }}
                          >
                            {(member.name || "?").trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate font-semibold text-on-surface">{member.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{ backgroundColor: `${member.teamColor}1a`, color: member.teamColor }}
                        >
                          {member.teamName}
                        </span>
                      </td>
                      {visibleMetricKeys.map((key) => (
                        <td key={key} className="px-4 py-2.5">
                          <div className="flex min-w-[100px] flex-col gap-1">
                            <span className="text-[11px] font-medium text-on-surface-variant">
                              {member.metrics[key].actual}/{member.metrics[key].target}
                            </span>
                            <div className="w-20">
                              <ProgressBar actual={member.metrics[key].actual} target={member.metrics[key].target} color={METRIC_COLORS[key]} />
                            </div>
                          </div>
                        </td>
                      ))}
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>
                          {member.score}% · {tier.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] font-medium">
                        {worst ? (
                          <span className="text-on-surface-variant">Thiếu {worst.deficit} {METRIC_LABELS[worst.key]}</span>
                        ) : exceededAny ? (
                          <span className="font-semibold text-emerald-600">Vượt KPI 🎉</span>
                        ) : hasAnyTarget ? (
                          <span className="font-semibold text-emerald-600">Đạt KPI</span>
                        ) : (
                          <span className="text-on-surface-variant">Đang bám KPI</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
