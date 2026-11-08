"use client";

import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import type { CrawlSessionGroup } from "@/types/api";
import { assignKpi, getMemberActualSeedingCount, type SeedingKpiItem } from "@/services/linkedinCrawlerService";
import type { KpiItem } from "@/types/api";
import {
  buildWeekPickerOptionsAroundDate,
  findKpiOverlappingWindow,
  getMonthWeekWindowContaining,
  normalizeKpiList,
  toYmd,
  type NormalizedKpiEntry,
  type WeekPickerOption,
} from "@/lib/kpi-month-weeks";

export type KpiModalMode = "assign" | "edit" | "view";

interface AssignKpiModalProps {
  isOpen: boolean;
  onClose: () => void;
  leaderEmail: string;
  memberEmail: string;
  profileSlug: string;
  mode: KpiModalMode;
  sheetKpi: unknown[];
  allPostsResult: CrawlSessionGroup[] | null;
  /** Date range từ page filter — dùng để seeding query khớp với table stats */
  pageDateRange?: { start: string; end: string };
  /** Seeding items đã fetch sẵn từ page — KHÔNG tự fetch lại để tránh lệch data */
  preloadedSeedingItems?: SeedingKpiItem[];
  /** Stats đã tính sẵn — verified_count / total_count */
  seedingStats?: { verified_count: number; total_count: number };
  onSuccess?: () => void | Promise<void>;
}

export function AssignKpiModal({
  isOpen,
  onClose,
  leaderEmail,
  memberEmail,
  profileSlug,
  mode,
  sheetKpi,
  allPostsResult,
  pageDateRange,
  preloadedSeedingItems,
  seedingStats,
  onSuccess,
}: AssignKpiModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowLabel, setWindowLabel] = useState("");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetPosts, setTargetPosts] = useState(20);
  const [platform, setPlatform] = useState("Facebook");

  const [viewWeekStart, setViewWeekStart] = useState("");
  const [viewWeekEnd, setViewWeekEnd] = useState("");
  // Dùng seedingItems từ props — populate khi modal mở
  const [seedingItems, setSeedingItems] = useState<SeedingKpiItem[]>([]);
  const [loadingSeeding, setLoadingSeeding] = useState(false);

  // Convert date format from DD-MM-YYYY to YYYY-MM-DD for HTML input
  const dmyToYmd = (str: string): string => {
    if (!str) return "";
    const cleanStr = str.replace(/\//g, "-").trim();
    const parts = cleanStr.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) return cleanStr; // already YYYY-MM-DD
      const dd = parts[0].padStart(2, "0");
      const mm = parts[1].padStart(2, "0");
      let yyyy = parts[2];
      if (yyyy.length === 2) yyyy = "20" + yyyy;
      return `${yyyy}-${mm}-${dd}`; // DD-MM-YYYY -> YYYY-MM-DD
    }
    return cleanStr;
  };

  // Convert date format from YYYY-MM-DD to DD-MM-YYYY for Sheet
  const ymdToDmy = (str: string): string => {
    if (!str) return "";
    const cleanStr = str.replace(/\//g, "-").trim();
    const parts = cleanStr.split("-");
    if (parts.length === 3) {
      if (parts[2].length === 4) return cleanStr; // already DD-MM-YYYY
      const yyyy = parts[0];
      const mm = parts[1].padStart(2, "0");
      const dd = parts[2].padStart(2, "0");
      return `${dd}-${mm}-${yyyy}`; // YYYY-MM-DD -> DD-MM-YYYY
    }
    return cleanStr;
  };

  const weekPickerOptions = useMemo((): WeekPickerOption[] => {
    const seen = new Set<string>();
    const out: WeekPickerOption[] = [];
    for (const o of buildWeekPickerOptionsAroundDate(new Date(), 3, 3)) {
      const k = `${o.startYmd}|${o.endYmd}`;
      seen.add(k);
      out.push(o);
    }
    for (const e of normalizeKpiList(sheetKpi)) {
      const k = `${e.start_day}|${e.end_day}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        startYmd: e.start_day,
        endYmd: e.end_day,
        labelVi: `KPI Sheet (${ymdToDmy(e.start_day)} → ${ymdToDmy(e.end_day)})`,
      });
    }
    out.sort((a, b) => a.startYmd.localeCompare(b.startYmd));
    return out;
  }, [sheetKpi]);

  useEffect(() => {
    if (!isOpen) return;
    // Ưu tiên dùng pageDateRange từ page filter để khớp với table stats
    const win = pageDateRange
      ? { startYmd: pageDateRange.start, endYmd: pageDateRange.end, labelVi: `${pageDateRange.start} → ${pageDateRange.end}` }
      : getMonthWeekWindowContaining();
    setViewWeekStart(win.startYmd);
    setViewWeekEnd(win.endYmd);
    setWindowLabel(win.labelVi);
    const overlap = findKpiOverlappingWindow(sheetKpi, win);

    if ((mode === "view" || mode === "edit") && overlap) {
      setStartDate(dmyToYmd(overlap.start_day));
      setEndDate(dmyToYmd(overlap.end_day));
      setTargetPosts(overlap.total_post_crawl);
      setPlatform(overlap.platform || "Facebook");
    } else if (mode === "assign") {
      setStartDate(dmyToYmd(win.startYmd));
      setEndDate(dmyToYmd(win.endYmd));
      setTargetPosts(20);
      setPlatform("Facebook");
    }
    setError(null);
  }, [isOpen, mode, memberEmail, sheetKpi, pageDateRange]);

  // Populate seedingItems từ props khi modal mở — KHÔNG tự fetch lại để tránh lệch data
  useEffect(() => {
    if (!isOpen || !memberEmail) return;
    if (preloadedSeedingItems) {
      setSeedingItems(preloadedSeedingItems);
    }
    setLoadingSeeding(false);
  }, [isOpen, memberEmail, preloadedSeedingItems]);

  const viewWeekOverlap = useMemo((): NormalizedKpiEntry | null => {
    if (!viewWeekStart || !viewWeekEnd) return null;
    return findKpiOverlappingWindow(sheetKpi, {
      startYmd: viewWeekStart,
      endYmd: viewWeekEnd,
    });
  }, [sheetKpi, viewWeekStart, viewWeekEnd]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const leader = (leaderEmail || "").trim();
      if (!leader) {
        setError("Thiếu email leader. Vui lòng đăng nhập lại.");
        return;
      }
      const slug = (profileSlug || "").trim() || memberEmail.split("@")[0] || "member";
      
      const startDmy = ymdToDmy(startDate);
      const endDmy = ymdToDmy(endDate);

      const kpi: KpiItem[] = [
        {
          start_day: startDmy,
          end_day: endDmy,
          total_post_crawl: targetPosts,
          total_session_crawl: 0,
          total_comment: 0,
          total_reaction: 0,
          platform: platform,
        },
      ];

      const res = await assignKpi({
        leader_role: "leader",
        role: "member",
        email: memberEmail,
        profile_slug: slug,
        email_leader: leader,
        kpi,
      });

      if (res.success) {
        await onSuccess?.();
        onClose();
      } else {
        setError(res.message || "Không lưu được KPI.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi hệ thống.");
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const inputClass =
    "w-full rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50";

  if (mode === "view") {
    const selectedWeekOption = weekPickerOptions.find(
      (o) => o.startYmd === viewWeekStart && o.endYmd === viewWeekEnd
    );
    const displayWeekLabel =
      selectedWeekOption?.labelVi ||
      (viewWeekStart && viewWeekEnd
        ? `${ymdToDmy(viewWeekStart)} → ${ymdToDmy(viewWeekEnd)}`
        : windowLabel);

    // Dùng verified_count trực tiếp từ seedingStats (đã được backend filter đúng date + verify logic)
    // KHÔNG filter local vì items là tất cả rows, chỉ verified_count là đúng
    const actual = seedingStats?.verified_count ?? 0;
    const target = viewWeekOverlap?.total_post_crawl || 0;
    const ratio = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;

    // Filter verified items từ preloadedSeedingItems (đã fetch với date range đúng)
    // Dùng pageDateRange để filter cho khớp với table
    const effectiveStart = pageDateRange?.start || viewWeekStart;
    const effectiveEnd = pageDateRange?.end || viewWeekEnd;
    const verifiedPosts = (preloadedSeedingItems || []).filter(item => {
      const itemYmd = dmyToYmd(item.day);
      return itemYmd >= effectiveStart && itemYmd <= effectiveEnd;
    });
    
    // Calculate status dynamically based on current date
    let status = "Proccess";
    if (viewWeekOverlap) {
      if (actual >= target) {
        status = "Done";
      } else {
        const todayYmd = toYmd(new Date());
        if (todayYmd > viewWeekEnd) {
          status = "Trễ deadline";
        } else {
          status = "Proccess";
        }
      }
    }

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-md">
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity cursor-pointer"
          onClick={onClose}
        />

        <div className="relative z-10 w-[min(94vw,640px)] rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="border-b border-outline-variant pb-md flex justify-between items-start">
            <div>
              <h3 className="text-h3 font-bold text-on-surface">Chi tiết KPI Thành viên</h3>
              <p className="mt-xs text-body-md text-on-surface-variant font-medium">{memberEmail}</p>
            </div>
            <button
              onClick={onClose}
              type="button"
              className="p-xs hover:bg-surface-container-high rounded-full transition-colors flex items-center justify-center cursor-pointer"
            >
              <span className="material-symbols-outlined text-outline">close</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-md space-y-lg pr-1">
            {/* Week Selector */}
            <div className="flex flex-col gap-xs sm:flex-row sm:items-center sm:justify-between bg-surface-container-low p-md rounded-xl border border-outline-variant">
              <div className="flex items-center gap-xs text-primary font-semibold">
                <span className="material-symbols-outlined">calendar_today</span>
                <span className="text-body-md">{displayWeekLabel}</span>
              </div>
              <div className="w-full sm:w-60">
                <select
                  className="w-full bg-surface border border-outline rounded-lg px-md py-sm font-body-sm text-body-sm focus:ring-2 focus:ring-primary outline-none cursor-pointer"
                  value={`${viewWeekStart}|${viewWeekEnd}`}
                  onChange={(e) => {
                    const [s, en] = e.target.value.split("|");
                    if (s && en) {
                      setViewWeekStart(s);
                      setViewWeekEnd(en);
                    }
                  }}
                >
                  {weekPickerOptions.map((o) => (
                    <option key={`${o.startYmd}|${o.endYmd}`} value={`${o.startYmd}|${o.endYmd}`}>
                      {o.labelVi}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* KPI Performance Card */}
            {loadingSeeding ? (
              <div className="flex flex-col items-center justify-center py-xl space-y-sm bg-surface-container-low border border-outline-variant rounded-xl">
                <span className="material-symbols-outlined text-4xl text-primary animate-spin">sync</span>
                <p className="text-body-md text-on-surface-variant animate-pulse font-medium">Đang tính toán hiệu suất seeding...</p>
              </div>
            ) : !viewWeekOverlap ? (
              <div className="text-center py-xl border border-dashed border-outline-variant rounded-xl bg-surface-container-low">
                <span className="material-symbols-outlined text-[48px] text-outline opacity-40 mb-xs">
                  assignment_late
                </span>
                <p className="text-body-md font-medium text-on-surface-variant">
                  Không tìm thấy KPI của thành viên này trong tuần đã chọn.
                </p>
              </div>
            ) : (
              <div className="space-y-md">
                <div className="bg-surface-container-low p-lg rounded-xl border border-outline-variant space-y-md relative overflow-hidden">
                  {/* Decorative background logo */}
                  <span className="material-symbols-outlined absolute right-4 top-4 text-[120px] text-primary/5 pointer-events-none">
                    trending_up
                  </span>

                  <div className="flex items-center justify-between">
                    <span className="text-label-md font-bold text-on-surface-variant uppercase tracking-wider">
                      Hiệu suất tuần
                    </span>
                    <span
                      className={`px-md py-0.5 rounded-full font-bold text-xs uppercase tracking-wide border ${
                        status === "Done"
                          ? "bg-success/10 border-success/30 text-success"
                          : status === "Trễ deadline"
                            ? "bg-error/10 border-error/30 text-error"
                            : "bg-warning/10 border-warning/30 text-warning"
                      }`}
                    >
                      {status === "Done"
                        ? "Hoàn thành"
                        : status === "Trễ deadline"
                          ? "Trễ deadline"
                          : "Đang chạy"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-md pt-xs">
                    <div>
                      <p className="text-body-xs text-on-surface-variant">Nền tảng</p>
                      <div className="flex items-center gap-xs mt-base font-bold text-body-lg text-on-surface">
                        <span
                          className={`material-symbols-outlined ${
                            viewWeekOverlap.platform?.toLowerCase() === "facebook"
                              ? "text-primary"
                              : "text-secondary"
                          }`}
                        >
                          {viewWeekOverlap.platform?.toLowerCase() === "facebook" ? "public" : "hub"}
                        </span>
                        {viewWeekOverlap.platform}
                      </div>
                    </div>
                    <div>
                      <p className="text-body-xs text-on-surface-variant">Bài Seeding</p>
                      <p className="font-bold text-body-lg text-on-surface mt-base">
                        {actual} / {target} bài viết
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-base pt-xs">
                    <div className="flex justify-between text-body-xs font-semibold text-on-surface-variant">
                      <span>Tiến độ seeding</span>
                      <span>{ratio}%</span>
                    </div>
                    <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${
                          status === "Done"
                            ? "bg-success"
                            : status === "Trễ deadline"
                              ? "bg-error"
                              : "bg-primary"
                        }`}
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* List of Matched Posts */}
                <div className="space-y-xs">
                  <h4 className="text-label-md font-bold text-on-surface-variant uppercase tracking-wider">
                    Danh sách bài seeding đã duyệt ({verifiedPosts.length})
                  </h4>

                  <div className="max-h-60 overflow-y-auto space-y-xs border border-outline-variant rounded-xl p-sm bg-surface-container-low">
                    {verifiedPosts.length === 0 ? (
                      <div className="text-center py-lg text-on-surface-variant italic text-body-sm">
                        Chưa có bài viết seeding nào được duyệt trong tuần này.
                      </div>
                    ) : (
                      verifiedPosts.map((post: any, pIdx: number) => (
                        <div
                          key={pIdx}
                          className="bg-surface-container-lowest p-md rounded-lg border border-outline-variant flex justify-between items-start gap-md hover:border-outline transition-colors"
                        >
                          <div className="flex-1 min-w-0 space-y-base">
                            <div className="flex items-center gap-sm">
                              <span className="text-[10px] bg-success/10 text-success font-bold px-sm py-0.5 rounded border border-success/30">
                                Đã seeding
                              </span>
                              <span className="text-body-xs text-on-surface-variant font-mono">
                                Ngày: {post.day}
                              </span>
                            </div>
                            <p className="text-body-sm text-on-surface font-medium line-clamp-2 leading-relaxed">
                              {post.content}
                            </p>
                          </div>

                          <div className="flex gap-xs shrink-0 flex-wrap items-center">
                            {post.link_post && (
                              <a
                                href={post.link_post}
                                target="_blank"
                                rel="noreferrer"
                                className="border border-outline-variant hover:bg-surface-container-high px-md py-xs rounded-lg text-[10px] font-bold text-on-surface flex items-center gap-1 transition-colors w-fit"
                                title="Xem bài viết"
                              >
                                <span>Xem bài viết</span>
                                <MaterialIcon name="open_in_new" className="text-xs" />
                              </a>
                            )}
                            {post.link_comment && (
                              <a
                                href={post.link_comment}
                                target="_blank"
                                rel="noreferrer"
                                className="bg-primary/10 hover:bg-primary/20 px-md py-xs rounded-lg text-[10px] font-bold text-primary flex items-center gap-1 transition-colors w-fit border border-primary/20"
                                title="Xem comment"
                              >
                                <span>Xem comment</span>
                                <MaterialIcon name="open_in_new" className="text-xs" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-outline-variant pt-md flex justify-end">
            <button
              onClick={onClose}
              type="button"
              className="bg-primary text-on-primary hover:bg-primary-container px-lg py-sm rounded-lg font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-sm active:scale-95"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    );
  }

  const title = mode === "edit" ? "Chỉnh sửa KPI" : "Giao KPI";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-md">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity cursor-pointer"
        onClick={onClose}
      />

      <div className="relative z-10 w-[min(94vw,480px)] rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg shadow-2xl">
        <div className="mb-md border-b border-outline-variant pb-md flex justify-between items-start">
          <div>
            <h3 className="text-h3 font-bold text-on-surface">{title}</h3>
            <p className="mt-xs text-body-sm text-on-surface-variant font-medium">{memberEmail}</p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-xs hover:bg-surface-container-high rounded-full transition-colors flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined text-outline">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-md">
          {/* Platform selection */}
          <div className="flex flex-col gap-xs">
            <label className="text-label-md font-bold text-on-surface-variant">Nền tảng</label>
            <div className="relative">
              <select
                className={`${inputClass} appearance-none pr-xl cursor-pointer`}
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                disabled={busy}
              >
                <option value="Facebook">Facebook</option>
                <option value="LinkedIn">LinkedIn</option>
              </select>
              <span className="material-symbols-outlined absolute right-md top-1/2 -translate-y-1/2 pointer-events-none text-outline">
                expand_more
              </span>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-md">
            <div className="flex flex-col gap-xs">
              <label className="text-label-md font-bold text-on-surface-variant">Từ ngày</label>
              <input
                type="date"
                className={inputClass}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="text-label-md font-bold text-on-surface-variant">Đến ngày</label>
              <input
                type="date"
                className={inputClass}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                disabled={busy}
              />
            </div>
          </div>

          {/* Seeding count */}
          <div className="flex flex-col gap-xs">
            <label className="text-label-md font-bold text-on-surface-variant">KPI Seeding / tuần</label>
            <input
              type="number"
              min="1"
              className={inputClass}
              value={targetPosts}
              onChange={(e) => setTargetPosts(parseInt(e.target.value, 10) || 0)}
              required
              disabled={busy}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-error/20 bg-error/10 p-sm text-body-sm text-error font-medium">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-sm pt-md border-t border-outline-variant">
            <button
              type="button"
              className="rounded-lg border border-outline bg-surface text-on-surface hover:bg-surface-container-high px-lg py-sm text-body-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer"
              onClick={onClose}
              disabled={busy}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="rounded-lg bg-primary text-on-primary hover:bg-primary-container px-xl py-sm text-body-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-sm active:scale-95"
              disabled={busy}
            >
              {busy ? "Đang lưu…" : mode === "edit" ? "Lưu KPI" : "Giao KPI"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
