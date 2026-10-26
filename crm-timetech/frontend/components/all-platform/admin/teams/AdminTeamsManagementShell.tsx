"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { getTeamTypeLabel } from "@/lib/teamTypes";
import { teamsService } from "@/services/all-platform.service";
import type { TeamRow } from "@/services/all-platform.service";
import { AdminTeamModal } from "@/components/all-platform/admin/AdminTeamModal";
import { AdminMemberKpiModal } from "@/components/all-platform/admin/AdminMemberKpiModal";
import { TeamPerformanceTrendSection } from "@/components/all-platform/admin/TeamPerformanceTrendSection";
import { AdminKpiRewardsPanel } from "@/components/all-platform/kpi-rewards/KpiRewardSections";
import {
  LuLayoutGrid,
  LuUsers,
  LuTarget,
  LuTrendingUp,
  LuUserPlus,
  LuEye,
  LuMessageSquare,
  LuFileText,
  LuInbox,
  LuPencil,
  LuTrash2,
  LuChartBar,
  LuChevronRight,
} from "react-icons/lu";
import { LeaderInboxView } from "@/components/all-platform/leader/LeaderInboxView";

// Trong so KPI theo yeu cau nghiep vu: Lead quan trong nhat -> Inbox -> Comment -> Post.
// % hoan thanh tong cua team = trung binh CO TRONG SO cua ty le hoan thanh tung chi so
// (chi tinh cac chi so da co chi tieu > 0, ty le moi chi so gioi han toi da 100%).
const KPI_WEIGHTS = {
  lead: 0.45,
  inbox: 0.4,
  comment: 0.05,
  post: 0.1,
} as const;

function computeWeightedPercentage(t: {
  post: number;
  postTarget: number;
  comment: number;
  commentTarget: number;
  lead: number;
  leadTarget: number;
  inbox: number;
  inboxTarget: number;
}): { percentage: number; hasTarget: boolean } {
  const parts = [
    { w: KPI_WEIGHTS.lead, cur: t.lead, tgt: t.leadTarget },
    { w: KPI_WEIGHTS.inbox, cur: t.inbox, tgt: t.inboxTarget },
    { w: KPI_WEIGHTS.comment, cur: t.comment, tgt: t.commentTarget },
    { w: KPI_WEIGHTS.post, cur: t.post, tgt: t.postTarget },
  ];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const p of parts) {
    if (p.tgt > 0) {
      weightedSum += p.w * Math.min(p.cur / p.tgt, 1);
      weightTotal += p.w;
    }
  }
  const hasTarget = weightTotal > 0;
  return {
    percentage: hasTarget ? Math.round((weightedSum / weightTotal) * 100) : 0,
    hasTarget,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trang nay dung he mau/thiet ke rieng, lay mau 1:1 tu app.markeeai.com de dong
// bo dan voi ben app. Cac gia tri hex hardcode co chu dich (tach biet khoi token
// Material cua phan con lai trong seeding). He mau toi gian: xam trung tinh +
// mot mau nhan hieu #ba244a cho hanh dong + mot mau emerald cho tien do. Cac o
// icon nho tren the thong ke la pastel nhat (giong app), khong dung mau tran lan.
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  iconClassName,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string | number;
  hint?: string;
  iconClassName?: string;
}) {
  return (
    <div className="h-full rounded-xl border border-border bg-white shadow-sm transition-all">
      <div className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            iconClassName,
          )}
        >
          <Icon size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>

          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {typeof value === "number" ? value.toLocaleString("vi-VN") : value}
          </p>

          {hint && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function getRecentWeeks(numWeeks = 8) {
  const weeks = [];
  const curr = new Date();
  for (let i = 0; i < numWeeks; i++) {
    const d = new Date(curr.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const yearStart = new Date(monday.getFullYear(), 0, 1);
    const weekNo = Math.ceil(
      ((monday.getTime() - yearStart.getTime()) / 86400000 +
        yearStart.getDay() +
        1) /
        7,
    );

    const fmt = (dt: Date) =>
      dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
    const valStart = monday.toISOString().split("T")[0];
    const valEnd = sunday.toISOString().split("T")[0];

    weeks.push({
      label: `Tuần ${weekNo} (${fmt(monday)} - ${fmt(sunday)})`,
      value: `${valStart}_${valEnd}`,
    });
  }
  return weeks;
}

export type AdminTeamsManagementView = "overview" | "teams" | "kpi-rules" | "kpi-summary";

const VIEW_META: Record<AdminTeamsManagementView, { label: string; title: string; description: string }> = {
  overview: {
    label: "Teams",
    title: "Teams",
    description: "Theo dõi tổng quan, xếp hạng và quản lý từng team trên cùng một trang",
  },
  teams: {
    label: "Quản lý từng Team",
    title: "Quản lý từng Team",
    description: "Quản lý danh sách team, leader, thành viên và KPI hiện tại",
  },
  "kpi-rules": {
    label: "Rule KPI & Thưởng",
    title: "Rule KPI & Thưởng",
    description: "Cài ngưỡng, đơn giá và trần thưởng theo team và tuần",
  },
  "kpi-summary": {
    label: "Tổng hợp KPI & Thưởng",
    title: "Tổng hợp KPI & Thưởng",
    description: "Khung tổng hợp tiền thưởng theo tuần, team và thành viên",
  },
};

export function AdminTeamsManagementShell({ view = "overview" }: { view?: AdminTeamsManagementView }) {
  const { user } = useAppAuth();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [kpiRows, setKpiRows] = useState<
    Array<{
      team_id: string;
      member_id: string;
      member_name?: string;
      kpi_post: number;
      kpi_lead: number;
      kpi_inbox: number;
      kpi_comment: number;
      verified_count: number;
      kpi_post_current: number;
      kpi_lead_current: number;
      kpi_inbox_current: number;
      is_leader?: boolean;
    }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modals
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [selectedTeamForEdit, setSelectedTeamForEdit] =
    useState<TeamRow | null>(null);

  const [kpiModalOpen, setKpiModalOpen] = useState(false);
  const [selectedTeamForKpi, setSelectedTeamForKpi] = useState<TeamRow | null>(
    null,
  );

  const [inboxModalOpen, setInboxModalOpen] = useState(false);
  const [selectedLeaderForInbox, setSelectedLeaderForInbox] = useState<{
    email: string;
    name: string;
  } | null>(null);

  const recentWeeks = useMemo(() => getRecentWeeks(8), []);
  const [selectedWeek, setSelectedWeek] = useState(recentWeeks[0].value);

  // Chi dung cho bo loc team o thanh tieu de trang (view kpi-summary) - tach rieng
  // khoi "teams" (dung cho overview/quan ly tung team) de khong doi logic cu.
  const [summaryTeamOptions, setSummaryTeamOptions] = useState<TeamRow[]>([]);
  const [selectedSummaryTeamId, setSelectedSummaryTeamId] = useState("");

  const isAdmin =
    (user?.role as string) === "admin" ||
    (user?.role as string) === "superadmin";
  const viewMeta = VIEW_META[view];
  const isOverviewView = view === "overview";
  const showTeamsManagement = view === "overview" || view === "teams";
  const isKpiRewardView = view === "kpi-rules" || view === "kpi-summary";

  // Dung 1 RPC gop teams+KPI duy nhat (get_admin_teams_kpi_overview qua /teams/with-kpi)
  // thay cho kieu cu 1 + N request song song (N = so team, moi request lai keo theo ca
  // lich su seeding_items rat nang) - do la nguyen nhan trang load cham va luc len luc
  // khong: 1 trong N request cham/loi se bi nuot lang le, team do hien 0 sai lech.
  const fetchTeams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [startDate, endDate] = selectedWeek.split("_");
      const res = await teamsService.getWithKpi(startDate, endDate);
      if (res.success && res.data) {
        setTeams(res.data.teams || []);
        setKpiRows(res.data.kpi_data || []);
      } else {
        setError(res.message || "Không thể tải danh sách team");
      }
    } catch {
      setError("Lỗi kết nối máy chủ");
    } finally {
      setIsLoading(false);
    }
  }, [selectedWeek]);

  useEffect(() => {
    if (!isAdmin || isKpiRewardView) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchTeams();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isAdmin, isKpiRewardView, fetchTeams]);

  useEffect(() => {
    if (!isAdmin || view !== "kpi-summary") return;
    const timer = window.setTimeout(() => {
      void teamsService.getAll().then((res) => {
        if (res.success && res.data) setSummaryTeamOptions(res.data);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isAdmin, view]);

  // Tong hop KPI (Post/Comment/Lead/Inbox) + % hoan thanh CO TRONG SO cho tung team -
  // tinh 1 lan, dung chung cho ca bang so sanh, cac card chi tiet va thong ke tong.
  //
  // 2026-07-04: RPC (migration 020) gio tra them 1 dong is_leader=true cho chinh
  // leader cua team (truoc day KPI cua leader "mat tich" hoan toan khoi trang nay).
  //
  // 2026-07-07: truoc day loai dong leader ra khoi tong % cua TEAM - nhung leader
  // phan anh (vd team "Thao NT" da co 15 comment thuc te tu leader) rang % cua
  // team khong nhich len du team da lam viec, gay hieu lam "khong len du lieu".
  // Gio CONG ca hoat dong cua leader vao tong cua team (giong 1 thanh vien binh
  // thuong) - phan anh dung cong suc thuc te ca team (leader + member) dong gop.
  const teamKpiSummaries = useMemo(() => {
    return teams.map((team) => {
      const totals = {
        post: 0,
        postTarget: 0,
        comment: 0,
        commentTarget: 0,
        lead: 0,
        leadTarget: 0,
        inbox: 0,
        inboxTarget: 0,
      };

      // Phong ve: RPC backend co the tra >1 dong cho cung 1 member (du lieu
      // kpi_tracker mo coi/trung khoang ngay o phia DB) - dedupe theo member_id
      // truoc khi cong don, tranh nhan doi target/actual cua thanh vien do.
      const seenMembers = new Set<string>();
      kpiRows
        .filter((r) => r.team_id === team.id)
        .forEach((r) => {
          if (seenMembers.has(r.member_id)) return;
          seenMembers.add(r.member_id);
          totals.post += r.kpi_post_current || 0;
          totals.postTarget += r.kpi_post || 0;
          totals.comment += r.verified_count || 0;
          totals.commentTarget += r.kpi_comment || 0;
          totals.lead += r.kpi_lead_current || 0;
          totals.leadTarget += r.kpi_lead || 0;
          totals.inbox += r.kpi_inbox_current || 0;
          totals.inboxTarget += r.kpi_inbox || 0;
        });

      const { percentage, hasTarget } = computeWeightedPercentage(totals);

      // KPI rieng cua leader (dong is_leader=true, neu co) - van hien tach biet o
      // day de xem rieng dong gop cua leader, dong thoi da duoc cong vao "totals"
      // cua ca team o tren (khong loai truong nay nua, xem comment 2026-07-07).
      const leaderRow = kpiRows.find(
        (r) => r.team_id === team.id && r.is_leader,
      );
      const leaderKpi = leaderRow
        ? {
            post: leaderRow.kpi_post_current || 0,
            postTarget: leaderRow.kpi_post || 0,
            comment: leaderRow.verified_count || 0,
            commentTarget: leaderRow.kpi_comment || 0,
            lead: leaderRow.kpi_lead_current || 0,
            leadTarget: leaderRow.kpi_lead || 0,
            inbox: leaderRow.kpi_inbox_current || 0,
            inboxTarget: leaderRow.kpi_inbox || 0,
          }
        : null;
      const leaderPct = leaderKpi ? computeWeightedPercentage(leaderKpi) : null;

      return {
        team,
        totals,
        hasTarget,
        percentage,
        leaderKpi,
        leaderHasTarget: leaderPct?.hasTarget ?? false,
        leaderPercentage: leaderPct?.percentage ?? 0,
      };
    });
  }, [teams, kpiRows]);

  const teamKpiSummariesRanked = useMemo(
    () => [...teamKpiSummaries].sort((a, b) => b.percentage - a.percentage),
    [teamKpiSummaries],
  );

  // Thong ke tong - suy ra tu teamKpiSummaries (dung chung cong thuc co trong so).
  const stats = useMemo(() => {
    const totalTeams = teams.length;
    const totalMembers = teams.reduce(
      (acc, t) => acc + (t.number_of_member || 0),
      0,
    );
    const withTarget = teamKpiSummaries.filter((s) => s.hasTarget);
    const achievedTeams = withTarget.filter((s) => s.percentage >= 100).length;
    const completionRate =
      withTarget.length > 0
        ? Math.round(
            withTarget.reduce((acc, s) => acc + s.percentage, 0) /
              withTarget.length,
          )
        : 0;
    return { totalTeams, totalMembers, achievedTeams, completionRate };
  }, [teams, teamKpiSummaries]);

  const handleDeleteTeam = async (team: TeamRow) => {
    if (
      !window.confirm(`Bạn có chắc chắn muốn xóa team "${team.name_team}"?`)
    ) {
      return;
    }

    try {
      const res = await teamsService.delete(team.name_team, team.id_leader, team.id);
      if (res.success) {
        setSuccess(`Đã xóa team "${team.name_team}" thành công`);
        fetchTeams();
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setError(res.message || "Xóa thất bại");
        setTimeout(() => setError(null), 4000);
      }
    } catch {
      setError("Lỗi kết nối máy chủ");
      setTimeout(() => setError(null), 4000);
    }
  };

  const handleEditTeam = (team: TeamRow) => {
    setSelectedTeamForEdit(team);
    setTeamModalOpen(true);
  };

  const handleCreateTeam = () => {
    setSelectedTeamForEdit(null);
    setTeamModalOpen(true);
  };

  const handleViewMembers = (team: TeamRow) => {
    setSelectedTeamForKpi(team);
    setKpiModalOpen(true);
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-2">
        <MaterialIcon name="block" className="text-5xl text-primary" />
        <p className="font-semibold text-base text-foreground">
          Quyền truy cập bị từ chối
        </p>
        <p className="text-sm">
          Trang này chỉ khả dụng đối với tài khoản Admin.
        </p>
      </div>
    );
  }

  // Thu tu hien thi theo do quan trong (trong so): Lead -> Inbox -> Comment -> Post.
  // Moi chi so co 1 icon mau nhat rieng cho card chi tiet do mat, khong don dieu.
  const metricDefs = [
    {
      key: "lead" as const,
      label: "Lead",
      weight: "45%",
      icon: LuUserPlus,
      tone: "bg-violet-50 text-violet-500",
    },
    {
      key: "inbox" as const,
      label: "Inbox",
      weight: "40%",
      icon: LuInbox,
      tone: "bg-orange-50 text-orange-600",
    },
    {
      key: "comment" as const,
      label: "Comment",
      weight: "5%",
      icon: LuMessageSquare,
      tone: "bg-blue-50 text-blue-600",
    },
    {
      key: "post" as const,
      label: "Post",
      weight: "10%",
      icon: LuFileText,
      tone: "bg-green-50 text-green-600",
    },
  ];

  return (
    <div className="space-y-5 text-foreground">
      {/* ── Thanh tieu de trang (hien muc dang xem, giong app) ─────────────── */}
      <div className="rounded-xl border border-border bg-white p-5">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span>Quản lý</span>

          <LuChevronRight size={13} />

          <span className="font-medium text-primary">{viewMeta.label}</span>
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">
              {viewMeta.title}
            </h1>

            <p className="mt-1 text-[13px] text-muted-foreground">
              {viewMeta.description}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-white px-3">
              <MaterialIcon name="calendar_month" className="text-base text-muted-foreground" />

              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="bg-transparent text-[13px] font-medium outline-none"
              >
                {recentWeeks.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            {view === "kpi-summary" && (
              <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-white px-3">
                <MaterialIcon name="groups" className="text-base text-muted-foreground" />
                <select
                  value={selectedSummaryTeamId}
                  onChange={(e) => setSelectedSummaryTeamId(e.target.value)}
                  className="bg-transparent text-[13px] font-medium outline-none"
                >
                  <option value="">Tất cả team</option>
                  {summaryTeamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name_team}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showTeamsManagement && (
              <button
                onClick={handleCreateTeam}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white transition hover:bg-primary/90 sm:w-auto"
              >
                <LuUserPlus size={16} />
                Thêm Team
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {isOverviewView && (
          <>
        {/* ── The thong ke tong (icon chip pastel nhat, giong MetricCard cua app) ── */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            icon={LuLayoutGrid}
            label="Tổng số Team"
            value={stats.totalTeams}
            iconClassName="bg-violet-50 text-violet-500"
          />
          <StatCard
            icon={LuUsers}
            label="Tổng số Thành viên"
            value={stats.totalMembers}
            iconClassName="bg-green-50 text-green-600"
          />
          <StatCard
            icon={LuTarget}
            label="Team đạt KPI tuần này"
            value={`${stats.achievedTeams} / ${stats.totalTeams}`}
            hint="Đạt ≥ 100% KPI chỉ tiêu"
            iconClassName="bg-blue-50 text-blue-600"
          />
          <StatCard
            icon={LuTrendingUp}
            label="Hoàn thành KPI hệ thống"
            value={`${stats.completionRate}%`}
            hint="Tiến độ của tất cả team"
            iconClassName="bg-primary/10 text-primary"
          />
        </div>

        {/* ── So sanh chi tiet giua cac team (bang, xep hang theo % hoan thanh) ── */}
        {!isLoading && teams.length > 0 && (
          <TeamPerformanceTrendSection teams={teams} />
        )}

        {!isLoading && teamKpiSummariesRanked.length > 0 && (
          <div className="rounded-xl border border-border bg-white overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-border bg-muted/50">
              <div className="flex items-center gap-2">
                <LuChartBar size={17} className="text-foreground" />
                <span className="text-base font-bold text-foreground">
                  So sánh & xếp hạng Team
                </span>
              </div>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                Xếp theo % hoàn thành KPI có trọng số: Lead 45% · Inbox 40% ·
                Comment 5% · Post 10%
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-muted">
                    <th className="text-left px-5 py-2.5 text-[11px] font-bold text-muted-foreground uppercase w-12">
                      #
                    </th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-foreground uppercase">
                      Team
                    </th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-foreground uppercase hidden md:table-cell">
                      Leader
                    </th>
                    <th className="text-center px-3 py-2.5 text-[11px] font-bold text-muted-foreground uppercase">
                      Thành viên
                    </th>
                    <th className="text-left px-5 py-2.5 text-[11px] font-bold text-muted-foreground uppercase w-[45%]">
                      Tiến độ hoàn thành
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teamKpiSummariesRanked.map((s, idx) => (
                    <tr
                      key={s.team.id}
                      className="border-t border-border hover:bg-muted transition"
                    >
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold",
                            idx === 0 && s.hasTarget
                              ? "bg-green-600 text-white"
                              : "bg-zinc-200 text-muted-foreground",
                          )}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-bold text-foreground whitespace-nowrap">
                        {s.team.name_team}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                        {s.team.leader_name || "Chưa đặt tên"}
                      </td>
                      <td className="px-3 py-3 text-center font-semibold text-foreground">
                        {s.team.number_of_member || 0}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-200">
                            <div
                              className="h-full rounded-full bg-green-600 transition-all duration-500"
                              style={{ width: `${s.percentage}%` }}
                            />
                          </div>
                          <span className="w-11 text-right text-base font-bold text-foreground tabular-nums">
                            {s.hasTarget ? `${s.percentage}%` : "—"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
          </>
        )}

        {/* ── Quan ly tung team (card + hanh dong) ─────────────────────────── */}
        {showTeamsManagement && !isLoading && teams.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <LuLayoutGrid size={17} className="text-foreground" />
              <span className="text-base font-bold text-foreground">
                Quản lý từng Team
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {teamKpiSummaries.map(
                ({
                  team,
                  totals,
                  hasTarget,
                  percentage,
                  leaderKpi,
                  leaderHasTarget,
                  leaderPercentage,
                }) => {
                  const initial = (team.name_team || "?")
                    .trim()
                    .charAt(0)
                    .toUpperCase();
                  return (
                    <div
                      key={team.id}
                      className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5 shadow-sm transition-all hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-bold text-primary">
                            {initial}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-foreground text-base truncate">
                              {team.name_team}
                            </div>
                            <div className="text-muted-foreground text-xs truncate">
                              {team.leader_name || "Chưa đặt tên"} ·{" "}
                              {team.number_of_member || 0} thành viên
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11.5px] font-bold text-primary">
                            {getTeamTypeLabel(team.team_type)}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold",
                              hasTarget
                                ? "bg-green-600/10 text-green-700"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {hasTarget ? `${percentage}%` : "Chưa giao KPI"}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1 h-2 w-full bg-zinc-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-600 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {metricDefs.map((m) => (
                          <div
                            key={m.label}
                            className="rounded-xl border border-border bg-muted/30 p-3"
                          >
                            <div
                              className={cn(
                                "mb-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg",
                                m.tone,
                              )}
                            >
                              <m.icon size={14} />
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                                {m.label}
                              </span>
                              <span className="text-[11px] font-bold text-muted-foreground">
                                {m.weight}
                              </span>
                            </div>
                            <div className="text-lg font-bold text-foreground tabular-nums leading-none mt-1">
                              {totals[m.key]}
                              <span className="text-[11px] font-normal text-muted-foreground">
                                {" "}
                                /{" "}
                                {
                                  totals[
                                    `${m.key}Target` as keyof typeof totals
                                  ]
                                }
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* KPI rieng cua leader (2026-07-04) - tach biet khoi tong cua team,
                        luon hien so lieu thuc te (comment/inbox/lead/post da lam) du
                        chua duoc giao target, tranh an het hoat dong that cua leader
                        sau nhan "Chua giao KPI" (leader van co the da lam viec that su). */}
                      {leaderKpi && (
                        <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0 text-[12px] font-semibold text-violet-700">
                              <LuUsers size={13} className="shrink-0" />
                              <span className="truncate">
                                KPI của Leader (
                                {team.leader_name || "chưa đặt tên"})
                              </span>
                            </div>
                            <span className="shrink-0 text-[12px] font-bold text-violet-700">
                              {leaderHasTarget
                                ? `${leaderPercentage}%`
                                : "Chưa giao KPI"}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-violet-700/80">
                            <span>
                              Comment: {leaderKpi.comment}
                              {leaderKpi.commentTarget > 0
                                ? `/${leaderKpi.commentTarget}`
                                : ""}
                            </span>
                            <span>
                              Inbox: {leaderKpi.inbox}
                              {leaderKpi.inboxTarget > 0
                                ? `/${leaderKpi.inboxTarget}`
                                : ""}
                            </span>
                            <span>
                              Lead: {leaderKpi.lead}
                              {leaderKpi.leadTarget > 0
                                ? `/${leaderKpi.leadTarget}`
                                : ""}
                            </span>
                            <span>
                              Post: {leaderKpi.post}
                              {leaderKpi.postTarget > 0
                                ? `/${leaderKpi.postTarget}`
                                : ""}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-4">
                        <button
                          onClick={() => handleViewMembers(team)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-200 px-2 py-2 text-[12.5px] font-semibold text-foreground transition hover:bg-primary hover:text-white cursor-pointer"
                        >
                          <LuEye size={13} /> Xem TV
                        </button>
                        <button
                          onClick={() => {
                            setSelectedLeaderForInbox({
                              email: team.leader_email,
                              name: team.name_team,
                            });
                            setInboxModalOpen(true);
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-200 px-2 py-2 text-[12.5px] font-semibold text-foreground transition hover:bg-primary hover:text-white cursor-pointer"
                          title="Xem toàn bộ Inbox của Team này"
                        >
                          <LuMessageSquare size={13} /> Inbox
                        </button>
                        <button
                          onClick={() => handleEditTeam(team)}
                          className="inline-flex items-center justify-center rounded-lg bg-zinc-950 px-2.5 py-2 text-white transition hover:bg-primary cursor-pointer"
                          title="Sửa team"
                        >
                          <LuPencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteTeam(team)}
                          className="inline-flex items-center justify-center rounded-lg bg-primary/10 px-2.5 py-2 text-primary transition hover:bg-primary hover:text-white cursor-pointer"
                          title="Xóa team"
                        >
                          <LuTrash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}

        {isKpiRewardView && (
          <AdminKpiRewardsPanel
            view={view}
            selectedWeek={selectedWeek}
            selectedTeamId={selectedSummaryTeamId}
          />
        )}

        {/* ── Thong bao ──────────────────────────────────────────────────── */}
        {success && (
          <div className="bg-green-50 text-green-700 border border-green-200 px-4 py-2.5 rounded-xl text-[13px] font-medium flex items-center gap-2">
            <MaterialIcon name="check_circle" className="text-lg shrink-0" />
            <span>{success}</span>
          </div>
        )}
        {error && (
          <div className="bg-primary/10 text-primary border border-primary/20 px-4 py-2.5 rounded-xl text-[13px] font-medium flex items-center gap-2">
            <MaterialIcon name="error" className="text-lg shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Trang thai loading / rong ──────────────────────────────────── */}
        {!isKpiRewardView && isLoading && (
          <div className="text-center py-24 text-muted-foreground flex flex-col items-center justify-center gap-2 bg-white rounded-xl border border-border">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-[13px] font-medium">
              Đang tải danh sách team...
            </p>
          </div>
        )}
        {!isKpiRewardView && !isLoading && teams.length === 0 && (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-border flex flex-col items-center justify-center">
            <LuLayoutGrid size={36} className="text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-[13px] font-medium">
              Chưa có team nào
            </p>
            <button
              onClick={handleCreateTeam}
              className="mt-5 text-primary text-[13px] font-semibold hover:underline cursor-pointer"
            >
              + Tạo team đầu tiên
            </button>
          </div>
        )}
      </div>

      {/* Admin Team Creation / Edit Modal */}
      <AdminTeamModal
        isOpen={teamModalOpen}
        onClose={() => {
          setTeamModalOpen(false);
          setSelectedTeamForEdit(null);
        }}
        team={selectedTeamForEdit}
        onSuccess={() => {
          fetchTeams();
          setSuccess(
            selectedTeamForEdit
              ? "Cập nhật team thành công"
              : "Tạo team mới thành công",
          );
          setTimeout(() => setSuccess(null), 4000);
        }}
      />

      {/* Member KPI Overview Modal */}
      <AdminMemberKpiModal
        isOpen={kpiModalOpen}
        onClose={() => {
          setKpiModalOpen(false);
          setSelectedTeamForKpi(null);
        }}
        team={selectedTeamForKpi}
      />

      {/* Admin Inbox View Modal */}
      {inboxModalOpen && selectedLeaderForInbox && (
        <LeaderInboxView
          isOpen={inboxModalOpen}
          onClose={() => setInboxModalOpen(false)}
          leaderEmail={selectedLeaderForInbox.email}
          memberName={`Toàn bộ team ${selectedLeaderForInbox.name}`}
        />
      )}
    </div>
  );
}
