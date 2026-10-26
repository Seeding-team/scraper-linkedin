"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { AdminTeamStats } from "./AdminTeamStats";
import { AdminTeamTable, MemberPerformance } from "./AdminTeamTable";
import { MaterialIcon } from "@/components/ui";
import { AddMemberModal } from "./AddMemberModal";
import { cn } from "@/lib/utils";
import { getMemberActualSeedingCount, getMemberKpiTarget, type SeedingKpiItem } from "@/services/linkedinCrawlerService";
import {
  findKpiOverlappingWindow,
  getMonthWeekWindowContaining,
  hasKpiForCurrentMonthWeek,
  buildWeekPickerOptionsAroundDate,
  normalizeKpiList,
  rangesOverlap,
} from "@/lib/kpi-month-weeks";
import type { CrawlSessionGroup } from "@/types/api";

const NO_CRAWL_SESSIONS: CrawlSessionGroup[] = [];

function numKpi(v: unknown): number {
  const n = parseInt(String(v ?? 0), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tính tổng actual_seeding của một member trong khoảng ngày rangeStart→rangeEnd.
 * Đọc từ mảng KPI (đã có actual_seeding từ backend/seeding_content_kpi).
 */
function getMemberActualSeedingInRange(
  kpiList: unknown[],
  rangeStart: string,
  rangeEnd: string,
): number {
  const entries = normalizeKpiList(kpiList);
  let total = 0;
  for (const e of entries) {
    if (!e.start_day || !e.end_day) continue;
    if (rangesOverlap(e.start_day, e.end_day, rangeStart, rangeEnd)) {
      total += e.actual_seeding ?? 0;
    }
  }
  return total;
}

export function AdminTeamPageContent() {
  const {
    allPostsResult,
    teamMembersPostsResult,
    role,
    handleGetAllPosts,
    isGettingAllPosts,
    isGettingTeamMembersPosts,
    teamMembers,
    fetchTeamMembers,
    isTeamLoading,
    email,
  } = useDashboard();

  const postsDatasetForTeamKpi = useMemo((): CrawlSessionGroup[] => {
    if (role === "leader") return teamMembersPostsResult ?? NO_CRAWL_SESSIONS;
    return allPostsResult ?? NO_CRAWL_SESSIONS;
  }, [role, teamMembersPostsResult, allPostsResult]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  // Lưu seeding data cho mỗi member: email -> { verified_count, total_count, kpi_target }
  const [memberSeedingData, setMemberSeedingData] = useState<Record<string, { verified_count: number; total_count: number; kpi_target: number }>>({});
  // Lưu full seeding items cho mỗi member (để truyền vào modal, tránh fetch lại)
  const [memberSeedingItems, setMemberSeedingItems] = useState<Record<string, SeedingKpiItem[]>>({});

  const weekOptions = useMemo(() => {
    return buildWeekPickerOptionsAroundDate(new Date(), 4, 1);
  }, []);

  const [selectedWeekKey, setSelectedWeekKey] = useState<string>("custom");

  const handleWeekChange = (val: string) => {
    setSelectedWeekKey(val);
    if (val === "custom") {
      setDateFrom("");
      setDateTo("");
    } else {
      const [start, end] = val.split("|");
      setDateFrom(start);
      setDateTo(end);
    }
  };

  const handleDateFromChange = (val: string) => {
    setDateFrom(val);
    setSelectedWeekKey("custom");
  };

  const handleDateToChange = (val: string) => {
    setDateTo(val);
    setSelectedWeekKey("custom");
  };

  // Định nghĩa dedupedTeam TRƯỚC khi dùng trong fetchSeedingCounts
  const dedupedTeam = useMemo(() => {
    const map = new Map<string, (typeof teamMembers)[number]>();
    for (const tm of teamMembers) {
      const key = tm.email.trim().toLowerCase();
      if (!map.has(key)) map.set(key, tm);
    }
    return [...map.values()];
  }, [teamMembers]);

  // Khoảng lọc: nếu không có dateFrom/dateTo → tuần hiện tại
  const currentWeekWindow = useMemo(() => getMonthWeekWindowContaining(new Date()), []);
  const rangeStart = dateFrom.trim() || currentWeekWindow.startYmd;
  const rangeEnd = dateTo.trim() || currentWeekWindow.endYmd;

  useEffect(() => {
    void fetchTeamMembers();
    handleGetAllPosts({ skipLeaderTeamPosts: true });
  }, [fetchTeamMembers, handleGetAllPosts]);

  // Fetch actual seeding counts + KPI target cho mỗi member
  const fetchSeedingCounts = useCallback(async () => {
    const team = dedupedTeam;
    if (team.length === 0) return;

    const counts: Record<string, { verified_count: number; total_count: number; kpi_target: number }> = {};
    const allItems: Record<string, SeedingKpiItem[]> = {};
    await Promise.all(
      team.map(async (tm) => {
        try {
          // Gọi API lấy actual seeding count và KPI target song song
          const [countRes, kpiRes] = await Promise.all([
            getMemberActualSeedingCount({
              email_member: tm.email,
              profile_id: tm.profile_id || undefined,
              facebook_name: tm.facebook_name || undefined,
              date_from: rangeStart,
              date_to: rangeEnd,
            }),
            getMemberKpiTarget({
              email_member: tm.email,
              date_from: rangeStart,
              date_to: rangeEnd,
            }),
          ]);

          const verified_count = countRes.success && countRes.data ? countRes.data.verified_count : 0;
          const total_count = countRes.success && countRes.data ? countRes.data.total_count : 0;
          const kpi_target = kpiRes.success && kpiRes.data ? kpiRes.data.kpi_target : 0;
          const items = countRes.success && countRes.data ? (countRes.data.items || []) : [];

          const key = tm.email.trim().toLowerCase();
          counts[key] = { verified_count, total_count, kpi_target };
          allItems[key] = items;
        } catch (e) {
          console.error(`Lỗi fetch data cho ${tm.email}:`, e);
          const key = tm.email.trim().toLowerCase();
          counts[key] = { verified_count: 0, total_count: 0, kpi_target: 0 };
          allItems[key] = [];
        }
      })
    );
    setMemberSeedingData(counts);
    setMemberSeedingItems(allItems);
  }, [dedupedTeam, rangeStart, rangeEnd]);

  useEffect(() => {
    if (dedupedTeam.length > 0) {
      void fetchSeedingCounts();
    }
  }, [fetchSeedingCounts]);

  const members = useMemo(() => {
    return dedupedTeam.map((tm): MemberPerformance => {
      const slug =
        (typeof tm.profile_slug === "string" && tm.profile_slug.trim()) ||
        tm.email.split("@")[0] ||
        "member";

      const sheetKpi = Array.isArray(tm.kpi) ? tm.kpi : [];
      const win = getMonthWeekWindowContaining(new Date());
      const hasKpiCurrentWeek = hasKpiForCurrentMonthWeek(sheetKpi, new Date());

      // Tìm KPI giao với khoảng lọc hiện tại
      const kWindow = findKpiOverlappingWindow(sheetKpi, {
        startYmd: rangeStart,
        endYmd: rangeEnd,
      });

      // Lấy actual seeding count từ API seeding_content_kpi
      const seedingKey = tm.email.trim().toLowerCase();
      const seedingFromApi = memberSeedingData[seedingKey];
      const actualSeedingInRange = seedingFromApi?.verified_count ?? 0;

      // Mục tiêu seeding: ưu tiên KPI target từ API, fallback về sheet KPI overlap
      const kpiTargetFromApi = seedingFromApi?.kpi_target ?? 0;
      const kpiTargetInRange = kpiTargetFromApi > 0
        ? kpiTargetFromApi
        : (kWindow?.total_post_crawl ?? 0);

      // Trạng thái: so sánh actual seeding với KPI target
      let status: MemberPerformance["status"] = "idle";
      if (kpiTargetInRange > 0) {
        if (actualSeedingInRange >= kpiTargetInRange) {
          status = "completed";
        } else {
          status = "processing";
        }
      }

      const perf: MemberPerformance = {
        email: tm.email,
        profile_slug: slug,
        name: slug,
        status,
        // posts = số bài seeding thực tế từ seeding_content_kpi (API)
        sessions: actualSeedingInRange,
        posts: actualSeedingInRange,
        // comments = mục tiêu KPI để hiển thị tiến độ
        comments: kpiTargetInRange,
        interactions: 0,
        sheetKpi,
        hasKpiCurrentWeek,
        kpiWindowLabel: win.labelVi,
        // Lọc seeding chuẩn xác theo profile_id + facebook_name
        profile_id: tm.profile_id,
        facebook_name: tm.facebook_name,
        // Actual seeding data từ API
        seedingData: seedingFromApi,
      };

      return perf;
    });
  }, [dedupedTeam, rangeStart, rangeEnd, memberSeedingData]);

  const stats = useMemo(() => {
    const totalMembers = members.length;

    // Tổng seeding thực tế của toàn đội trong khoảng lọc
    const totalActualSeeding = members.reduce((acc, m) => acc + m.posts, 0);

    // Tổng KPI target của toàn đội
    const totalKpiTarget = Object.values(memberSeedingData).reduce((acc, d) => acc + (d.kpi_target || 0), 0);

    // Số thành viên hoàn thành KPI (Done) và đang xử lý
    const completedKpiCount = members.filter((m) => m.status === "completed").length;
    const failedKpiCount = members.filter((m) => m.status === "processing").length;

    return {
      totalMembers,
      totalPosts: totalActualSeeding,
      completedKpiCount,
      failedKpiCount,
      totalKpiTarget,
    };
  }, [members, memberSeedingData]);

  const refreshAll = () => {
    void (async () => {
      await fetchTeamMembers();
      handleGetAllPosts({ skipLeaderTeamPosts: true });
    })();
  };

  return (
    <div className="w-full space-y-lg">
      {/* Page Header */}
      <div className="mb-xl">
        <h1 className="text-h1 text-on-surface mb-xs font-semibold">
          Quản lý Đội ngũ & KPI
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Theo dõi thành viên, giao KPI và đối chiếu tiến độ thực tế với mục tiêu đã đề ra.
        </p>
      </div>

      {/* Action Bar */}
      <div className="border-outline-variant bg-surface-container-low/50 flex flex-col xl:flex-row items-center justify-between gap-md rounded-lg border px-md py-md mb-xl">
        <div className="flex flex-wrap items-center gap-sm w-full xl:w-auto">
          <button
            onClick={() => setAddModalOpen(true)}
            className="bg-primary text-on-primary hover:bg-primary-container flex items-center gap-2 rounded-lg px-md py-sm text-xs font-bold uppercase tracking-wide transition-all active:scale-[0.98] cursor-pointer"
          >
            <MaterialIcon name="person_add" className="shrink-0 text-[18px]" />
            Thêm thành viên
          </button>
          <button
            onClick={() => refreshAll()}
            disabled={isGettingAllPosts || isTeamLoading || (role === "leader" && isGettingTeamMembersPosts)}
            className="border-outline-variant bg-surface text-on-surface hover:bg-surface-container-high flex items-center gap-2 rounded-lg border px-md py-sm text-xs font-bold uppercase tracking-wide transition-all disabled:opacity-50"
          >
            <MaterialIcon
              name="refresh"
              className={cn("shrink-0 text-[18px]", (isGettingAllPosts || (role === "leader" && isGettingTeamMembersPosts)) ? "animate-spin" : "")}
            />
            Làm mới dữ liệu
          </button>
        </div>
        
        {/* Date Filters & Week Dropdown Selector */}
        <div className="flex flex-wrap items-center gap-sm w-full xl:w-auto">
          <div className="flex items-center gap-xs w-full sm:w-auto">
            <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">Xem theo:</span>
            <select
              className="border-outline-variant bg-surface-container-low focus:border-primary text-on-surface rounded-lg border px-md py-sm text-xs outline-none w-full sm:w-64 cursor-pointer"
              value={selectedWeekKey}
              onChange={(e) => handleWeekChange(e.target.value)}
            >
              <option value="custom">-- Tự chọn khoảng ngày --</option>
              {weekOptions.map((w) => (
                <option key={`${w.startYmd}|${w.endYmd}`} value={`${w.startYmd}|${w.endYmd}`}>
                  {w.labelVi}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-xs w-full sm:w-auto">
            <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider hidden sm:inline whitespace-nowrap">Từ:</span>
            <input
              type="date"
              className="border-outline-variant bg-surface-container-low focus:border-primary rounded-lg border px-md py-sm text-xs outline-none w-full sm:w-36 text-on-surface"
              value={dateFrom}
              onChange={(e) => handleDateFromChange(e.target.value)}
            />
            <span className="text-xs text-on-surface-variant">→</span>
            <input
              type="date"
              className="border-outline-variant bg-surface-container-low focus:border-primary rounded-lg border px-md py-sm text-xs outline-none w-full sm:w-36 text-on-surface"
              value={dateTo}
              onChange={(e) => handleDateToChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mb-xl">
        <AdminTeamStats
          totalMembers={stats.totalMembers}
          totalPosts={stats.totalPosts}
          completedKpiCount={stats.completedKpiCount}
          failedKpiCount={stats.failedKpiCount}
          totalKpiTarget={stats.totalKpiTarget}
        />
      </div>

      <div className="mb-xl">
        <AdminTeamTable
          members={members}
          leaderEmail={email}
          allPostsResult={postsDatasetForTeamKpi}
          pageDateRange={{ start: rangeStart, end: rangeEnd }}
          memberSeedingItems={memberSeedingItems}
          memberSeedingStats={memberSeedingData}
          onRefresh={() => refreshAll()}
        />
      </div>

      <AddMemberModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        leaderEmail={email}
        onSuccess={() => void fetchTeamMembers()}
      />

      {(isTeamLoading || isGettingTeamMembersPosts) && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm transition-opacity duration-300">
          <div className="bg-surface-container-highest border-outline-variant flex flex-col items-center gap-md rounded-2xl border p-xl shadow-2xl">
            <span className="material-symbols-outlined text-[40px] text-primary animate-spin">
              sync
            </span>
            <div className="flex flex-col items-center gap-xs text-center">
              <p className="text-body-md font-bold text-on-surface">
                Đang tính toán & tải dữ liệu...
              </p>
              <p className="text-body-sm text-on-surface-variant">
                Vui lòng đợi trong giây lát
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

