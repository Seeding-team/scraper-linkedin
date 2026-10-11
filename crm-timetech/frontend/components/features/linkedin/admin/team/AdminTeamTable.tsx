"use client";

import { useState, useMemo } from "react";
import { MaterialIcon } from "@/components/ui";
import type { CrawlSessionGroup } from "@/types/api";
import { AssignKpiModal, type KpiModalMode } from "./AssignKpiModal";
import { ViewSeedingModal } from "./ViewSeedingModal";

export interface MemberPerformance {
  email: string;
  /** Slug LinkedIn / sheet — bắt buộc khi gọi API giao KPI. */
  profile_slug: string;
  name: string;
  avatar?: string;
  status: "completed" | "processing" | "idle" | "error";
  sessions: number;
  posts: number;
  comments: number;
  interactions: number;
  /** KPI trên sheet (merge khi giao/sửa). */
  sheetKpi: unknown[];
  /** Đã có KPI giao nhau với tuần-hiện-tại-trong-tháng. */
  hasKpiCurrentWeek: boolean;
  kpiWindowLabel: string;
  /** Profile ID — dùng lọc seeding chuẩn xác */
  profile_id?: string;
  /** Tên Facebook hiển thị trên web — dùng lọc dự phòng */
  facebook_name?: string;
  /** Seeding data từ seeding_content_kpi (actual count từ API) */
  seedingData?: { verified_count: number; total_count: number };
}

interface AdminTeamTableProps {
  members: MemberPerformance[];
  /** Email leader — gửi kèm khi giao/sửa KPI (email_leader trên sheet/n8n). */
  leaderEmail: string;
  /** Feed get-all-posts — so sánh KPI / modal xem KPI. */
  allPostsResult: CrawlSessionGroup[] | null;
  /** Date range từ page filter — dùng để KPI modal khớp với table stats */
  pageDateRange?: { start: string; end: string };
  /** Full seeding items đã fetch sẵn từ page — truyền vào modal để tránh fetch lại */
  memberSeedingItems?: Record<string, import("@/services/linkedinCrawlerService").SeedingKpiItem[]>;
  /** Stats đã fetch sẵn từ page — truyền vào modal để hiển thị đúng số */
  memberSeedingStats?: Record<string, { verified_count: number; total_count: number; kpi_target: number }>;
  onRefresh?: () => void;
}

const kpiBtn =
  "inline-flex items-center gap-1 rounded-md border border-outline-variant bg-surface px-2.5 py-1.5 text-xs font-medium text-on-surface shadow-sm transition hover:bg-surface-container-high";

export function AdminTeamTable({
  members,
  leaderEmail,
  allPostsResult,
  pageDateRange,
  memberSeedingItems,
  memberSeedingStats,
  onRefresh,
}: AdminTeamTableProps) {
  const [kpiModal, setKpiModal] = useState<{
    email: string;
    profileSlug: string;
    sheetKpi: unknown[];
    mode: KpiModalMode;
  } | null>(null);
  const [seedingModalMember, setSeedingModalMember] = useState<{
    email: string;
    profile_id?: string;
    facebook_name?: string;
  } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<string>("default");

  const filteredAndSortedMembers = useMemo(() => {
    let result = [...members];

    // Filter by status
    if (filterStatus !== "all") {
      result = result.filter((m) => {
        if (filterStatus === "completed") return m.status === "completed";
        if (filterStatus === "processing") return m.status === "processing";
        if (filterStatus === "error") return m.status === "error";
        return true;
      });
    }

    // Sort by seeding count (posts) descending
    if (sortOrder === "seeding-desc") {
      result.sort((a, b) => b.posts - a.posts);
    }

    return result;
  }, [members, filterStatus, sortOrder]);

  const openKpiModal = (member: MemberPerformance, mode: KpiModalMode) => {
    setKpiModal({
      email: member.email,
      profileSlug: member.profile_slug,
      sheetKpi: member.sheetKpi,
      mode,
    });
  };

  const closeKpiModal = () => setKpiModal(null);
  const openSeedingModal = (member: MemberPerformance) =>
    setSeedingModalMember({
      email: member.email,
      profile_id: member.profile_id,
      facebook_name: member.facebook_name,
    });
  const closeSeedingModal = () => setSeedingModalMember(null);

  const exportCsv = () => {
    const headers = [
      "email",
      "profile_slug",
      "sessions",
      "posts",
      "comments",
      "interactions",
      "status",
      "has_kpi_week",
    ];
    const rows = members.map((m) =>
      [
        m.email,
        m.profile_slug,
        m.sessions,
        m.posts,
        m.comments,
        m.interactions,
        m.status,
        m.hasKpiCurrentWeek ? "yes" : "no",
      ].join(","),
    );
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-kpi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="border-outline-variant bg-surface-container-lowest mb-xl rounded-xl border p-lg shadow-sm">
        <div className="mb-lg flex flex-row flex-nowrap items-center justify-between border-b border-outline-variant/30 pb-md gap-md">
          <div className="min-w-0">
            <h2 className="text-h2 text-on-surface font-semibold truncate">Hiệu suất Đội ngũ</h2>
            <p className="text-body-xs text-on-surface-variant mt-0.5 hidden sm:block truncate">
              Danh sách các thành viên trong nhóm và tiến độ thực tế
            </p>
          </div>
          
          <div className="flex flex-row flex-nowrap items-center gap-xs shrink-0">
            {/* Filter by Status */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border-outline-variant bg-surface focus:border-primary text-on-surface rounded-lg border px-sm py-1.5 text-xs outline-none cursor-pointer hover:bg-surface-container-low transition-colors"
            >
              <option value="all">Tất cả</option>
              <option value="processing">Proccess</option>
              <option value="completed">Done</option>
              <option value="error">Trễ Deadline</option>
            </select>

            {/* Sort by Seeding */}
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="border-outline-variant bg-surface focus:border-primary text-on-surface rounded-lg border px-sm py-1.5 text-xs outline-none cursor-pointer hover:bg-surface-container-low transition-colors"
            >
              <option value="default">Mặc định</option>
              <option value="seeding-desc">Seeding nhiều nhất</option>
            </select>

            <button
              onClick={exportCsv}
              className="border-outline-variant bg-surface text-on-surface hover:bg-surface-container-high flex items-center gap-1 rounded-lg border px-sm py-1.5 text-xs font-bold uppercase tracking-wide transition-all cursor-pointer"
            >
              <MaterialIcon name="file_download" className="shrink-0 text-[16px]" />
              <span className="hidden md:inline">Xuất CSV</span>
            </button>
            
            <button
              onClick={onRefresh}
              className="bg-primary text-on-primary hover:bg-primary-container flex items-center gap-1 rounded-lg px-sm py-1.5 text-xs font-bold uppercase tracking-wide disabled:opacity-50 transition-all cursor-pointer"
            >
              <MaterialIcon name="sync" className="shrink-0 text-[16px]" />
              <span className="hidden md:inline">Làm mới</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-outline-variant">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-surface-container-low border-outline-variant border-b">
              <tr>
                <th className="px-md py-md font-semibold text-on-surface-variant uppercase tracking-wider">EMAIL</th>
                <th className="px-md py-md font-semibold text-on-surface-variant uppercase tracking-wider">TÊN</th>
                <th className="px-md py-md font-semibold text-on-surface-variant uppercase tracking-wider">PHIÊN</th>
                <th className="px-md py-md font-semibold text-on-surface-variant uppercase tracking-wider">BÀI VIẾT</th>
                <th className="px-md py-md font-semibold text-on-surface-variant uppercase tracking-wider">TRẠNG THÁI</th>
                <th className="px-md py-md font-semibold text-on-surface-variant uppercase tracking-wider">KPI </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filteredAndSortedMembers.map((m) => (
                <tr key={m.email} className="hover:bg-surface-container-lowest transition-colors">
                  <td className="px-md py-md text-body-md font-mono text-on-surface-variant truncate max-w-[200px]">
                    {m.email}
                  </td>
                  <td className="px-md py-md">
                    <div className="flex items-center gap-sm">
                      <div className="w-8 h-8 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-xs">
                        {m.avatar ? (
                          <img src={m.avatar} alt={m.name} className="h-full w-full object-cover rounded-full" />
                        ) : (
                          m.name.substring(0, 2).toUpperCase()
                        )}
                      </div>
                      <span className="font-h3 text-on-surface">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-md py-md text-body-md tabular-nums">{m.sessions}</td>
                  <td className="px-md py-md">
                    <div className="flex flex-col gap-1 min-w-[100px]">
                      <div className="flex items-center justify-between">
                        <span className="text-body-md tabular-nums font-bold text-on-surface">{m.posts}</span>
                        <span className="text-[10px] text-on-surface-variant">/ {m.comments || 0}</span>
                      </div>
                      {m.comments > 0 && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                          <div
                            className={`h-full rounded-full ${m.status === "completed" ? "bg-emerald-500" : "bg-primary"}`}
                            style={{ width: `${Math.min(100, Math.round((m.posts / m.comments) * 100))}%` }}
                          />
                        </div>
                      )}
                      {m.seedingData && m.seedingData.total_count > 0 && (
                        <span className="text-[10px] text-on-surface-variant">
                          ({m.seedingData.verified_count}/{m.seedingData.total_count} đã xác minh)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-md py-md">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-md py-md">
                    <div className="flex flex-col gap-xs">
                      {m.hasKpiCurrentWeek ? (
                        <>
                          <button
                            onClick={() => openKpiModal(m, "view")}
                            className="flex items-center gap-xs text-primary font-h3 text-body-sm hover:underline cursor-pointer"
                          >
                            <MaterialIcon name="visibility" className="text-sm" />
                            Xem KPI
                          </button>
                          <button
                            onClick={() => openKpiModal(m, "edit")}
                            className="flex items-center gap-xs text-on-surface-variant font-h3 text-body-sm hover:underline cursor-pointer"
                          >
                            <MaterialIcon name="edit" className="text-sm" />
                            Sửa KPI
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => openKpiModal(m, "assign")}
                          className="bg-primary text-on-primary px-md py-1.5 rounded-lg font-bold text-xs flex items-center gap-xs active:scale-95 transition-all w-fit cursor-pointer uppercase tracking-wider mb-1"
                        >
                          <MaterialIcon name="assignment" className="text-[14px]" filled />
                          Giao KPI
                        </button>
                      )}
                      <button
                        onClick={() => openSeedingModal(m)}
                        className="flex items-center gap-xs text-secondary font-h3 text-body-sm hover:underline cursor-pointer mt-0.5"
                      >
                        <MaterialIcon name="list_alt" className="text-sm" />
                        Xem Seeding
                      </button>
                      <p className="text-[10px] text-on-surface-variant italic mt-1">{m.kpiWindowLabel}</p>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredAndSortedMembers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-md py-lg text-center text-on-surface-variant opacity-60">
                    Không có thành viên nào trùng khớp với bộ lọc đã chọn.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="text-body-sm text-on-surface-variant mt-lg flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {filteredAndSortedMembers.length === members.length
              ? `Hiển thị tất cả ${members.length} thành viên`
              : `Hiển thị ${filteredAndSortedMembers.length} trên ${members.length} thành viên`}
          </span>
        </div>
      </section>

      {kpiModal ? (
        <AssignKpiModal
          isOpen
          onClose={closeKpiModal}
          leaderEmail={leaderEmail}
          memberEmail={kpiModal.email}
          profileSlug={kpiModal.profileSlug}
          mode={kpiModal.mode}
          sheetKpi={kpiModal.sheetKpi}
          allPostsResult={allPostsResult}
          pageDateRange={pageDateRange}
          preloadedSeedingItems={memberSeedingItems?.[kpiModal.email.trim().toLowerCase()]}
          seedingStats={memberSeedingStats?.[kpiModal.email.trim().toLowerCase()]}
          onSuccess={onRefresh}
        />
      ) : null}

      {seedingModalMember ? (
        <ViewSeedingModal
          isOpen
          onClose={closeSeedingModal}
          memberEmail={seedingModalMember.email}
          profileId={seedingModalMember.profile_id}
          facebookName={seedingModalMember.facebook_name}
        />
      ) : null}
    </>
  );
}

function StatusBadge({ status }: { status: MemberPerformance["status"] }) {
  const base = "px-2 py-0.5 rounded whitespace-nowrap font-label-md text-[10px] border border-transparent";
  switch (status) {
    case "completed":
      return (
        <span className={`${base} bg-secondary-container/30 text-on-secondary-container`}>
          Hoàn thành
        </span>
      );
    case "processing":
      return (
        <span className={`${base} bg-primary/10 text-primary`}>
          Đang thực hiện
        </span>
      );
    case "error":
      return (
        <span className={`${base} bg-error/15 text-error font-bold`}>
          Trễ deadline
        </span>
      );
    default:
      return (
        <span className={`${base} bg-surface-container-high text-on-surface-variant`}>
          Chưa bắt đầu
        </span>
      );
  }
}
