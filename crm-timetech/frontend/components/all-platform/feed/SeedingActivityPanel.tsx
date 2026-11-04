"use client";

import { useCallback, useEffect, useState, useRef, memo } from "react";
import { cn } from "@/lib/utils";
import { allPlatformPostsService } from "@/services/all-platform.service";
import { FiRefreshCw, FiAward } from "react-icons/fi";
import { FaUsers } from "react-icons/fa";
import { MaterialIcon } from "@/components/ui";

const PAGE_SIZE = 5;

interface SeedingActivityPanelProps {
  email: string;
  /** Force render dù role != admin/leader (test mode) */
  forceShow?: boolean;
}

interface SeederInfo {
  member_id: string;
  member_name: string;
  member_email: string;
  team_name: string;
  verify: string;
  comment_url: string | null;
  seeding_time: string;
}

interface TopSeedingPost {
  post_id: string;
  post_url: string;
  content: string;
  group_name: string;
  seeding_count: number;
  verified_count: number;
  unique_members: number;
  seeders?: SeederInfo[];
}

interface TopSeeder {
  member_id: string;
  member_email: string;
  member_name: string;
  team_name: string;
  seeding_count: number;
  verified_count: number;
}

interface OverviewData {
  top_seeding_today?: TopSeedingPost[];
  top_seeders_today?: TopSeeder[];
  seededToday?: number;
}

/**
 * Phase 6: "Đã seeding ai" overview panel cho admin/leader.
 *
 * - Hiển thị ngay trên feed dashboard (collapsible)
 * - Data lấy từ /unified/feed/overview RPC (Phase B1) — 1 round-trip
 * - Cache 60s trong component state; manual refresh button
 * - Loading skeleton + error fallback
 */
export const SeedingActivityPanel = memo(function SeedingActivityPanel({ email, forceShow }: SeedingActivityPanelProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const lastFetchedAt = useRef<number | null>(null);
  const [postsPage, setPostsPage] = useState(1);

  const fetchOverview = useCallback(
    async (force = false) => {
      if (!email) return;
      if (!force && lastFetchedAt.current && Date.now() - lastFetchedAt.current < 60_000) {
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const res = await allPlatformPostsService.getFeedOverview({ email });
        if (res.success && res.data) {
          setData(res.data as OverviewData);
          lastFetchedAt.current = Date.now();
        } else {
          setError(res.message || "Không thể tải dữ liệu seeding.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Lỗi không xác định.");
      } finally {
        setIsLoading(false);
      }
    },
    [email],
  );

  useEffect(() => {
    fetchOverview(true);
  }, [fetchOverview]);

  const topSeeders = data?.top_seeders_today ?? [];
  const topSeeding = data?.top_seeding_today ?? [];
  const seededToday = data?.seededToday ?? 0;

  // Pagination for top seeding posts
  const totalPostPages = Math.ceil(topSeeding.length / PAGE_SIZE);
  const paginatedPosts = topSeeding.slice((postsPage - 1) * PAGE_SIZE, postsPage * PAGE_SIZE);

  // Reset page when data changes
  useEffect(() => {
    setPostsPage(1);
  }, [data?.top_seeding_today?.length]);

  // Medal emoji cho top 3
  const medal = (idx: number): string => {
    if (idx === 0) return "🥇";
    if (idx === 1) return "🥈";
    if (idx === 2) return "🥉";
    return `#${idx + 1}`;
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
      {/* Header — collapsible */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setIsOpen(!isOpen);
        }}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-slate-50/50 transition cursor-pointer select-none"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 flex items-center justify-center shrink-0">
            <FaUsers className="text-emerald-600" />
          </div>
          <div className="text-left min-w-0">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              Hoạt động seeding hôm nay
              {!isLoading && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                  {seededToday} bài
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-500">
              Top thành viên và bài viết được seeding nhiều nhất
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fetchOverview(true);
            }}
            disabled={isLoading}
            className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 disabled:opacity-50 transition cursor-pointer"
            title="Làm mới"
          >
            <FiRefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </button>
          <span
            className={cn(
              "text-[10px] font-bold text-slate-400 transition-transform",
              isOpen && "rotate-180",
            )}
          >
            ▼
          </span>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-slate-100 px-5 py-4">
          {isLoading && !data ? (
            <Skeleton />
          ) : error ? (
            <ErrorBox message={error} onRetry={() => fetchOverview(true)} />
          ) : topSeeders.length === 0 && topSeeding.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Seeders */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <FiAward className="text-amber-500 w-3.5 h-3.5" />
                  <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Top thành viên seeding
                  </h4>
                </div>
                {topSeeders.map((s, idx) => {
                  const pct = s.seeding_count > 0
                    ? Math.round((s.verified_count / s.seeding_count) * 100)
                    : 0;
                  return (
                    <div
                      key={`${s.member_id}-${s.team_name}-${idx}`}
                      className="px-3 py-2 rounded-lg border border-slate-100 bg-slate-50/40 hover:bg-slate-50 transition flex items-center gap-2.5"
                    >
                      <span className="text-base shrink-0 w-6 text-center" aria-hidden>
                        {medal(idx)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[12px] font-bold text-slate-800 truncate">
                            {s.member_name || s.member_email}
                          </span>
                          {s.team_name && (
                            <span className="text-[9px] font-medium text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded shrink-0">
                              {s.team_name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[120px] bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 shrink-0">
                            {s.verified_count}/{s.seeding_count}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Top Seeding Posts */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="material-symbols-outlined text-rose-500 text-[14px]">
                    campaign
                  </span>
                  <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    Top bài viết được seeding
                  </h4>
                  {totalPostPages > 1 && (
                    <span className="text-[10px] text-slate-400 ml-auto">
                      {postsPage}/{totalPostPages}
                    </span>
                  )}
                </div>
                {paginatedPosts.map((p, idx) => (
                  <div
                    key={p.post_id}
                    className="px-3 py-2.5 rounded-lg border border-slate-100 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-200 transition"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-base shrink-0 w-6 text-center" aria-hidden>
                        {medal((postsPage - 1) * PAGE_SIZE + idx)}
                      </span>
                      <span className="text-[11px] font-bold text-slate-800 truncate flex-1 min-w-0">
                        {p.group_name || "Bài viết"}
                      </span>
                      <a
                        href={p.post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 shrink-0 transition"
                        onClick={(e) => e.stopPropagation()}
                        title="Mở bài viết"
                      >
                        <MaterialIcon name="open_in_new" className="text-[10px]" />
                        Bài viết
                      </a>
                      <a
                        href={p.post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 shrink-0 transition"
                        onClick={(e) => e.stopPropagation()}
                        title="Xem bình luận trên Facebook"
                      >
                        <MaterialIcon name="chat" className="text-[10px]" />
                        Bình luận
                      </a>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 shrink-0">
                        {p.seeding_count} lượt
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed pl-7">
                      {p.content || "(không có nội dung)"}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 pl-7">
                      <span className="text-[10px] text-slate-500">
                        {p.unique_members} người
                      </span>
                      <span className="text-[10px] text-green-600 font-semibold">
                        ✓ {p.verified_count} verify
                      </span>
                    </div>

                    {/* Danh sách seeders chi tiết */}
                    {p.seeders && p.seeders.length > 0 && (
                      <div className="mt-2.5 pl-7 border-t border-slate-100 pt-2">
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                            Đã seeding ({p.seeders.length})
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          {p.seeders.slice(0, 5).map((seeder, sIdx) => (
                            <div
                              key={`${seeder.member_id}-${sIdx}`}
                              className="flex items-center justify-between gap-2 text-[10px]"
                            >
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <span className="shrink-0">
                                  {seeder.verify && ['yes', 'đã seeding', 'xác minh', 'verified'].includes(seeder.verify.toLowerCase()) ? (
                                    <span className="text-emerald-500" title="Đã verify">✓</span>
                                  ) : (
                                    <span className="text-slate-300" title="Chưa verify">○</span>
                                  )}
                                </span>
                                <span className="truncate font-medium text-slate-700">
                                  {seeder.member_name || seeder.member_email}
                                </span>
                                {seeder.team_name && (
                                  <span className="shrink-0 text-[9px] text-blue-500 bg-blue-50 px-1 py-0.5 rounded">
                                    {seeder.team_name}
                                  </span>
                                )}
                              </div>
                              {seeder.comment_url ? (
                                <a
                                  href={seeder.comment_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-700 font-semibold hover:underline transition"
                                  title="Mở comment"
                                >
                                  <MaterialIcon name="chat" className="text-[10px]" />
                                  Xem
                                </a>
                              ) : (
                                <span className="shrink-0 text-slate-300">-</span>
                              )}
                            </div>
                          ))}
                          {p.seeders.length > 5 && (
                            <span className="text-[10px] text-slate-400 text-center pt-1">
                              +{p.seeders.length - 5} người khác
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Pagination */}
                {totalPostPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setPostsPage((p) => Math.max(1, p - 1))}
                      disabled={postsPage === 1}
                      className="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      <MaterialIcon name="chevron_left" className="text-[14px]" />
                    </button>
                    {Array.from({ length: totalPostPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setPostsPage(page)}
                        className={cn(
                          "w-7 h-7 rounded-lg text-[11px] font-bold transition cursor-pointer",
                          postsPage === page
                            ? "bg-[#E3000F] text-white"
                            : "border border-slate-200 hover:bg-slate-50 text-slate-600"
                        )}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPostsPage((p) => Math.min(totalPostPages, p + 1))}
                      disabled={postsPage === totalPostPages}
                      className="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      <MaterialIcon name="chevron_right" className="text-[14px]" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {lastFetchedAt.current && (
            <p className="text-[10px] text-slate-400 text-right mt-3">
              Cập nhật {new Date(lastFetchedAt.current).toLocaleTimeString("vi-VN")}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

function Skeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-pulse">
      {[0, 1].map((col) => (
        <div key={col} className="space-y-2">
          <div className="h-3 w-32 bg-slate-100 rounded" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-12 bg-slate-50 rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2.5 flex items-center justify-between gap-3">
      <span className="text-[11px] text-red-700">⚠️ {message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-[11px] font-bold text-red-700 hover:underline shrink-0"
      >
        Thử lại
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-8 text-center text-slate-400">
      <p className="text-sm">Chưa có hoạt động seeding nào hôm nay.</p>
      <p className="text-[11px] mt-1">Sẽ cập nhật khi thành viên verify seeding.</p>
    </div>
  );
}