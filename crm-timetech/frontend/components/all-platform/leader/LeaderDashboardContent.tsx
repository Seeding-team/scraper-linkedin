"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MaterialIcon } from "@/components/ui";
import { OnlineTotalWidget } from "@/components/all-platform/accounts/OnlineTotalWidget";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  allPlatformGroupsService,
  allPlatformKpiService,
  allPlatformPostsService,
  teamsService,
  type TeamRow,
} from "@/services/all-platform.service";
import type { FacebookGroup, LinkedInGroup, UnifiedPost } from "@/types/unified.types";

type GroupRecord = FacebookGroup | LinkedInGroup;

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

function buildDistribution(
  groups: GroupRecord[],
  getLabel: (group: GroupRecord) => string | undefined,
) {
  const map = new Map<string, number>();

  groups.forEach((group) => {
    const label = (getLabel(group) || "").trim() || "Chưa gắn";
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function getGroupHealthScore(group: GroupRecord) {
  return "health_score" in group && typeof group.health_score === "number"
    ? group.health_score
    : 60;
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface px-3 py-2 shadow-none">
      <p className="truncate text-xs font-semibold capitalize text-on-surface-variant">{label}</p>
      <p className="text-xl font-bold leading-tight text-on-surface">
        {typeof value === "number" ? value.toLocaleString("vi-VN") : value}
      </p>
      {hint ? <p className="text-xs leading-tight text-on-surface-variant">{hint}</p> : null}
    </div>
  );
}

function ProgressListCard({
  title,
  icon,
  items,
  emptyText,
}: {
  title: string;
  icon: string;
  items: Array<{ label: string; count: number }>;
  emptyText: string;
}) {
  const max = items[0]?.count || 1;

  return (
    <div className="rounded-lg border border-outline-variant bg-surface p-3 shadow-none">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
        <MaterialIcon name={icon as any} className="text-base text-primary" />
        {title}
      </h3>

      <div className="mt-2 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-on-surface-variant">{emptyText}</p>
        ) : (
          items.map((item) => {
            const percent = Math.max(10, Math.round((item.count / max) * 100));

            return (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-on-surface">{item.label}</span>
                  <span className="rounded-full bg-surface-container-low px-1.5 py-0.5 text-xs font-semibold text-on-surface-variant">
                    {item.count}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-low">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SideInfoCard({
  title,
  icon,
  children,
  href,
  actionLabel,
}: {
  title: string;
  icon: string;
  children: ReactNode;
  href: string;
  actionLabel: string;
}) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface p-3 shadow-none">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
        <MaterialIcon name={icon as any} className="text-base text-primary" />
        {title}
      </h3>
      <div className="mt-2 space-y-2">{children}</div>
      <Link
        href={href}
        className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-outline-variant py-1.5 text-xs font-semibold text-on-surface-variant transition-all hover:bg-surface-container-low"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

export function LeaderDashboardContent() {
  const { user } = useAppAuth();
  const router = useRouter();
  const recentWeeks = useMemo(() => getRecentWeeks(8), []);
  const [selectedWeek, setSelectedWeek] = useState(recentWeeks[0]?.value || "");
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [posts, setPosts] = useState<UnifiedPost[]>([]);
  const [kpiMembers, setKpiMembers] = useState<any[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id || user.role !== "leader") return;

    const loadTeams = async () => {
      const res = await teamsService.getAll();
      if (!res.success || !res.data) {
        setError(res.message || "Không thể tải danh sách team.");
        return;
      }

      const myTeams = res.data.filter((team) => team.id_leader === user.id);
      setTeams(myTeams);
      setSelectedTeamId((current) => current || myTeams[0]?.id || "");
    };

    void loadTeams();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user?.email || !selectedTeamId) return;

    const [startDate, endDate] = selectedWeek.split("_");
    const selectedTeam = teams.find((team) => team.id === selectedTeamId);
    if (!selectedTeam) return;

    const loadOverview = async () => {
      setLoading(true);
      setError(null);

      try {
        const memberEmails = Array.from(
          new Set([user.email, ...(selectedTeam.members || []).map((m) => m.email)].filter(Boolean)),
        );

        const [kpiRes, fbGroupsRes, liGroupsRes, fbPostsRes, liPostsRes, replyRes] = await Promise.all([
          allPlatformKpiService.getAll(user.email, selectedTeamId, startDate, endDate),
          allPlatformGroupsService.getAll("facebook"),
          allPlatformGroupsService.getAll("linkedin"),
          allPlatformPostsService.filter({
            email: user.email,
            platform: "facebook",
            team: selectedTeam.name_team,
            date_from: startDate,
            date_to: endDate,
            page: 1,
            page_size: 20,
          }),
          allPlatformPostsService.filter({
            email: user.email,
            platform: "linkedin",
            team: selectedTeam.name_team,
            date_from: startDate,
            date_to: endDate,
            page: 1,
            page_size: 20,
          }),
          allPlatformKpiService.getFbInboxProgressBulk(memberEmails, startDate, endDate),
        ]);

        setKpiMembers(kpiRes.success && kpiRes.data?.members ? kpiRes.data.members : []);

        const nextReplyCounts: Record<string, number> = {};
        if (replyRes.success && replyRes.data) {
          for (const [email, info] of Object.entries(replyRes.data)) {
            nextReplyCounts[email] = info?.kpi_fb_inbox_count || 0;
          }
        }
        setReplyCounts(nextReplyCounts);

        const allGroups = [
          ...((fbGroupsRes.success && fbGroupsRes.data ? fbGroupsRes.data : []) as FacebookGroup[]),
          ...((liGroupsRes.success && liGroupsRes.data ? liGroupsRes.data : []) as LinkedInGroup[]),
        ].filter((group) => {
          const matchesTeamId = String((group as FacebookGroup).id_team || "") === selectedTeamId;
          const matchesTeamName =
            String((group as FacebookGroup).team_name || "").trim() === selectedTeam.name_team;
          return matchesTeamId || matchesTeamName;
        });

        setGroups(allGroups);

        const combinedPosts = [
          ...(fbPostsRes.success && fbPostsRes.data?.posts ? fbPostsRes.data.posts : []),
          ...(liPostsRes.success && liPostsRes.data?.posts ? liPostsRes.data.posts : []),
        ].sort((a, b) => (b.score || 0) - (a.score || 0));

        setPosts(combinedPosts);
      } catch (overviewError) {
        console.error("Failed to load leader dashboard", overviewError);
        setError("Không thể tải dashboard leader.");
      } finally {
        setLoading(false);
      }
    };

    void loadOverview();
  }, [selectedTeamId, selectedWeek, teams, user?.email]);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [selectedTeamId, teams],
  );

  const memberMetrics = useMemo(() => {
    const teamMembers = selectedTeam?.members || [];
    // selectedTeam.members khong bao gio chua leader - them dong leader vao day
    // vi /kpi/get-all da tra ve KPI cua leader trong kpiMembers, neu khong
    // leader se "mat tich" khoi chinh dashboard cua minh (nhu team-management.tsx).
    const hasLeaderAlready = selectedTeam && teamMembers.some((m) => m.id === selectedTeam.id_leader);
    const allMembers =
      selectedTeam && !hasLeaderAlready
        ? [
            ...teamMembers,
            { id: selectedTeam.id_leader, email: selectedTeam.leader_email, name: selectedTeam.leader_name },
          ]
        : teamMembers;

    return allMembers.map((member) => {
      const kpiInfo = kpiMembers.find((row) => row.id === member.id) || {};
      const stats = kpiInfo.seeding_stats || {};
      const commentCurrent = stats.verified_count || 0;
      const commentTarget = stats.kpi_target || 0;
      const postCurrent = stats.kpi_post_current || 0;
      const postTarget = stats.kpi_post || 0;
      const leadCurrent = stats.kpi_lead_current || 0;
      const leadTarget = stats.kpi_lead || 0;
      const inboxCurrent = stats.kpi_inbox_current || 0;
      const inboxTarget = stats.kpi_inbox || 0;
      const traffic = commentCurrent + postCurrent + inboxCurrent;
      const totalCurrent = commentCurrent + postCurrent + leadCurrent + inboxCurrent;
      const totalTarget = commentTarget + postTarget + leadTarget + inboxTarget;

      return {
        ...member,
        commentCurrent,
        commentTarget,
        postCurrent,
        postTarget,
        leadCurrent,
        leadTarget,
        inboxCurrent,
        inboxTarget,
        traffic,
        totalCurrent,
        totalTarget,
      };
    });
  }, [kpiMembers, selectedTeam]);

  const totalGroups = groups.length;
  const totalComments = memberMetrics.reduce((sum, member) => sum + member.commentCurrent, 0);
  const totalLeads = memberMetrics.reduce((sum, member) => sum + member.leadCurrent, 0);
  const totalTraffic = memberMetrics.reduce((sum, member) => sum + member.traffic, 0);
  const totalInbox = memberMetrics.reduce((sum, member) => sum + member.inboxCurrent, 0);
  // "Khach reply" - so tin nhan THUC TE khach gui toi (khong phu thuoc da xac
  // nhan tinh KPI hay chua), khac voi "KPI Inbox" (chi tinh hoi thoai da duoc
  // leader xac nhan qua fb_inbox_kpi).
  const totalReply = Object.values(replyCounts).reduce((sum, c) => sum + (c || 0), 0);

  const industryDistribution = useMemo(
    () => buildDistribution(groups, (group) => group.industry_name || group.industry),
    [groups],
  );
  const tierDistribution = useMemo(
    () => buildDistribution(groups, (group) => group.tier_name || (group.tier ? `Tier ${group.tier}` : "")),
    [groups],
  );
  const icpDistribution = useMemo(
    () => buildDistribution(groups, (group) => group.icp_name || group.icp),
    [groups],
  );

  const unassignedPosts = useMemo(
    () => posts.filter((post) => !post.verify_status || post.verify_status === "pending").slice(0, 5),
    [posts],
  );

  const topTrafficMembers = useMemo(
    () =>
      [...memberMetrics]
        .sort((a, b) => b.traffic - a.traffic || b.leadCurrent - a.leadCurrent)
        .slice(0, 6),
    [memberMetrics],
  );

  const totalCurrent = memberMetrics.reduce((sum, member) => sum + member.totalCurrent, 0);
  const totalTarget = memberMetrics.reduce((sum, member) => sum + member.totalTarget, 0);
  const kpiPercent = totalTarget > 0 ? Math.min(100, Math.round((totalCurrent / totalTarget) * 100)) : 0;

  const healthyMembers = memberMetrics.filter(
    (member) => member.totalTarget > 0 && member.totalCurrent >= member.totalTarget,
  ).length;
  const stalledMembers = memberMetrics.filter(
    (member) => member.totalCurrent === 0 && member.totalTarget > 0,
  ).length;
  const reviewMembers = Math.max(memberMetrics.length - healthyMembers - stalledMembers, 0);

  const aliveGroups = groups.filter((group) => getGroupHealthScore(group) >= 60).length;
  const warningGroups = groups.filter((group) => {
    const score = getGroupHealthScore(group);
    return score >= 20 && score < 60;
  }).length;
  const atRiskGroups = groups.filter((group) => getGroupHealthScore(group) < 20).length;
  const missingTaxonomyGroups = groups.filter(
    (group) => !(group.intent_name || group.industry_name || group.icp_name || group.tier_name),
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-none flex-col gap-3 bg-surface font-sans">
      <div className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MaterialIcon name="dashboard" className="text-xl" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-on-surface">
              Dashboard leader
            </h1>
            <p className="text-xs leading-tight text-on-surface-variant">
              Tổng quan hiệu suất team, nhóm và nội dung cần xử lý trong tuần.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={selectedTeamId}
            onChange={(event) => setSelectedTeamId(event.target.value)}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm font-semibold text-on-surface outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/20"
          >
            {teams.length === 0 ? <option value="">Chưa có team</option> : null}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name_team}
              </option>
            ))}
          </select>

          <select
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm font-semibold text-on-surface outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/20"
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

      <OnlineTotalWidget />

      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        <MetricCard label="Tổng groups" value={loading ? "..." : totalGroups} />
        <MetricCard label="Comment tuần này" value={loading ? "..." : totalComments} />
        <MetricCard label="KPI Inbox" value={loading ? "..." : totalInbox} />
        <MetricCard label="Khách reply" value={loading ? "..." : totalReply} />
        <MetricCard label="Leads mang về" value={loading ? "..." : totalLeads} />
        <MetricCard label="UTM traffic" value={loading ? "..." : totalTraffic} />
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,2fr)_280px]">
        <div className="space-y-2">
          <div className="grid gap-2 lg:grid-cols-3">
            <ProgressListCard
              title="Groups theo ngành"
              icon="groups"
              items={industryDistribution}
              emptyText="Chưa có nhóm nào trong team này."
            />
            <ProgressListCard
              title="Phân bổ theo tier"
              icon="stacked_bar_chart"
              items={tierDistribution}
              emptyText="Chưa có dữ liệu tier."
            />
            <ProgressListCard
              title="ICP phổ biến"
              icon="person_search"
              items={icpDistribution}
              emptyText="Chưa có dữ liệu ICP."
            />
          </div>

          <div className="rounded-lg border border-outline-variant bg-surface p-3 shadow-none">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                <MaterialIcon name="assignment" className="text-base text-primary" />
                Bài post điểm cao chưa assign
              </h3>
              <span className="rounded-full bg-surface-container-low px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                {unassignedPosts.length} bài
              </span>
            </div>

            <div className="mt-1.5 divide-y divide-outline-variant">
              {unassignedPosts.length === 0 ? (
                <p className="py-3 text-xs text-on-surface-variant">Chưa có bài nổi bật cần assign.</p>
              ) : (
                unassignedPosts.slice(0, 3).map((post) => (
                  <div key={post.id} className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-on-surface">{post.group_name}</p>
                      <p className="line-clamp-1 text-xs text-on-surface-variant">{post.content}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant">
                        <span>Score {post.score}</span>
                        <span>{post.platform}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push("/all-platform/post-feed")}
                      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Assign
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-none">
            <div className="border-b border-outline-variant px-3 py-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                <MaterialIcon name="analytics" className="text-base text-primary" />
                UTM Top Performers tuần này
              </h3>
            </div>

            <div className="w-full">
              <table className="w-full table-fixed text-xs">
                <thead className="border-b border-outline-variant bg-surface-container-low">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs font-semibold capitalize text-on-surface-variant">Thành viên</th>
                    <th className="px-3 py-1.5 text-left text-xs font-semibold capitalize text-on-surface-variant">Team</th>
                    <th className="px-3 py-1.5 text-right text-xs font-semibold capitalize text-on-surface-variant">Traffic</th>
                    <th className="px-3 py-1.5 text-right text-xs font-semibold capitalize text-on-surface-variant">Leads</th>
                    <th className="px-3 py-1.5 text-right text-xs font-semibold capitalize text-on-surface-variant">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {topTrafficMembers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-3 text-center text-xs text-on-surface-variant">
                        Chưa có dữ liệu hiệu suất trong tuần này.
                      </td>
                    </tr>
                  ) : (
                    topTrafficMembers.slice(0, 4).map((member) => (
                      <tr key={member.id} className="border-b border-outline-variant last:border-b-0">
                        <td className="truncate px-3 py-1.5">
                          <div className="truncate font-semibold text-on-surface">{member.name || member.email}</div>
                          <div className="truncate text-xs text-on-surface-variant">{member.email}</div>
                        </td>
                        <td className="truncate px-3 py-1.5 text-on-surface-variant">{selectedTeam?.name_team || "-"}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-on-surface">{member.traffic}</td>
                        <td className="px-3 py-1.5 text-right text-on-surface-variant">{member.leadCurrent}</td>
                        <td className="px-3 py-1.5 text-right text-on-surface-variant">{member.commentCurrent}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <SideInfoCard
            title="Team KPI"
            icon="monitoring"
            href="/all-platform/leader/team"
            actionLabel="Xem Leaderboard"
          >
            <div className="rounded-lg bg-surface-container-low p-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-on-surface-variant">{selectedTeam?.name_team || "Chưa chọn team"}</p>
                  <p className="text-base font-bold leading-tight text-on-surface">{kpiPercent}%</p>
                </div>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-on-surface-variant">
                  {totalCurrent}/{totalTarget || 0}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                <div className="h-full rounded-full bg-primary" style={{ width: `${kpiPercent}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-surface-container-low px-1.5 py-1.5">
                <p className="text-xs text-on-surface-variant">Đạt KPI</p>
                <p className="text-xs font-bold text-on-surface">{healthyMembers}</p>
              </div>
              <div className="rounded-lg bg-surface-container-low px-1.5 py-1.5">
                <p className="text-xs text-on-surface-variant">Đang chạy</p>
                <p className="text-xs font-bold text-on-surface">{reviewMembers}</p>
              </div>
              <div className="rounded-lg bg-surface-container-low px-1.5 py-1.5">
                <p className="text-xs text-on-surface-variant">Chưa chạy</p>
                <p className="text-xs font-bold text-on-surface">{stalledMembers}</p>
              </div>
            </div>
          </SideInfoCard>

          <SideInfoCard
            title="Sức khỏe KPI thành viên"
            icon="shield"
            href="/all-platform/quan-ly-tai-khoan"
            actionLabel="Xem chi tiết"
          >
            <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-1.5">
              <span className="text-sm font-medium text-on-surface-variant">Ổn định</span>
              <span className="rounded-full bg-emerald-50 px-1.5 py-0 text-xs font-semibold text-emerald-600">
                {healthyMembers}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-1.5">
              <span className="text-sm font-medium text-on-surface-variant">Cần theo dõi</span>
              <span className="rounded-full bg-amber-50 px-1.5 py-0 text-xs font-semibold text-amber-600">
                {reviewMembers}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-1.5">
              <span className="text-sm font-medium text-on-surface-variant">Không hoạt động</span>
              <span className="rounded-full bg-red-50 px-1.5 py-0 text-xs font-semibold text-primary">
                {stalledMembers}
              </span>
            </div>
          </SideInfoCard>

          <SideInfoCard
            title="Groups Health"
            icon="folder"
            href="/all-platform/quan-ly-nhom"
            actionLabel="Xem chi tiết"
          >
            <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-1.5">
              <span className="text-sm font-medium text-on-surface-variant">Đang sống</span>
              <span className="rounded-full bg-emerald-50 px-1.5 py-0 text-xs font-semibold text-emerald-600">
                {aliveGroups}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-1.5">
              <span className="text-sm font-medium text-on-surface-variant">Cần theo dõi</span>
              <span className="rounded-full bg-amber-50 px-1.5 py-0 text-xs font-semibold text-amber-600">
                {warningGroups}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-1.5">
              <span className="text-sm font-medium text-on-surface-variant">Rủi ro</span>
              <span className="rounded-full bg-red-50 px-1.5 py-0 text-xs font-semibold text-primary">
                {atRiskGroups}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-2.5 py-1.5">
              <span className="text-sm font-medium text-on-surface-variant">Thiếu taxonomy</span>
              <span className="rounded-full bg-surface-container-highest px-1.5 py-0 text-xs font-semibold text-on-surface-variant">
                {missingTaxonomyGroups}
              </span>
            </div>
          </SideInfoCard>
        </div>
      </div>
    </div>
  );
}
