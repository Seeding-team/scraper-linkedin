"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  MessageSquare,
  Phone,
  Radio,
  RefreshCw,
  Search,
  Share2,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { publicCrawlerService } from "@/services/public-crawler.service";
import type {
  CrawledPostAuditItem,
  CrawledPostsOverviewResponse,
} from "@/types/public-crawler";

type TimeRangeOption = "all" | "today" | "7d";
type AiFilterOption = "all" | "lead_high" | "kept" | "deleted" | "pending";
type SourceFilterOption = "all" | "public_4g" | "extension";

const NEED_CATEGORY_LABELS: Record<string, string> = {
  website: "Website",
  app: "Mobile App",
  landing_page: "Landing Page",
  software: "Phần mềm / Tool",
  other: "Khác",
};

const SOURCE_BADGE_STYLES: Record<string, { label: string; className: string }> = {
  public_4g: {
    label: "Xoay IP 4G",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  vps_queue: {
    label: "VPS Worker",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  extension: {
    label: "Extension",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  historical: {
    label: "Lịch sử DB",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

function formatVnDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return iso;
  }
}

function getAiStatusBadge(item: CrawledPostAuditItem): {
  label: string;
  className: string;
  kind: "lead" | "mid" | "deleted" | "pending" | "warn";
} {
  const status = item.ai_status || "pending";
  const score = item.lead_score ?? null;

  if (status === "deleted_competitor") {
    return {
      label: `Đối thủ (${score ?? 0}đ · Đã xóa)`,
      className: "bg-rose-50 text-rose-700 border-rose-200",
      kind: "deleted",
    };
  }
  if (status === "deleted_low_score") {
    return {
      label: `Điểm thấp (${score ?? 0}đ · Đã xóa)`,
      className: "bg-red-50 text-red-700 border-red-200",
      kind: "deleted",
    };
  }
  if (status === "kept") {
    if (score !== null && score >= 70) {
      return {
        label: `Lead xịn (${score}đ)`,
        className: "bg-emerald-100 text-emerald-800 border-emerald-300",
        kind: "lead",
      };
    }
    return {
      label: `Đạt giữ (${score ?? "—"}đ)`,
      className: "bg-amber-50 text-amber-800 border-amber-200",
      kind: "mid",
    };
  }
  if (status === "unconfigured") {
    return {
      label: "Chưa bật API AI",
      className: "bg-slate-100 text-slate-600 border-slate-200",
      kind: "warn",
    };
  }
  if (status === "error") {
    return {
      label: "AI tạm lỗi (vẫn giữ)",
      className: "bg-orange-50 text-orange-700 border-orange-200",
      kind: "warn",
    };
  }
  return {
    label: "Đang chờ AI check",
    className: "bg-sky-50 text-sky-700 border-sky-200",
    kind: "pending",
  };
}

function AiBadgeChip({ item }: { item: CrawledPostAuditItem }) {
  const badge = getAiStatusBadge(item);
  const IconComp =
    badge.kind === "lead"
      ? Sparkles
      : badge.kind === "mid"
        ? CheckCircle2
        : badge.kind === "deleted"
          ? Trash2
          : badge.kind === "pending"
            ? Clock
            : ShieldAlert;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap",
        badge.className,
      )}
    >
      <IconComp className="size-3 shrink-0" />
      {badge.label}
    </span>
  );
}

interface PaginationBarProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (next: number) => void;
}

function PaginationBar({ total, page, pageSize, onPageChange }: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const activePage = Math.min(page, totalPages);
  const fromIdx = (activePage - 1) * pageSize + 1;
  const toIdx = Math.min(activePage * pageSize, total);

  return (
    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-slate-600">
        Hiển thị <strong>{fromIdx}</strong>–<strong>{toIdx}</strong> / <strong>{total}</strong> bài
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={activePage <= 1}
          onClick={() => onPageChange(activePage - 1)}
          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer font-semibold"
        >
          ← Trước
        </button>
        <span className="px-2 text-slate-700 font-bold tabular-nums">
          Trang {activePage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={activePage >= totalPages}
          onClick={() => onPageChange(activePage + 1)}
          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer font-semibold"
        >
          Sau →
        </button>
      </div>
    </div>
  );
}

export function Public4GCrawledPostsPanel() {
  const [data, setData] = useState<CrawledPostsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [timeRange, setTimeRange] = useState<TimeRangeOption>("all");
  const [aiFilter, setAiFilter] = useState<AiFilterOption>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilterOption>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Independent pagination for Table 1 and Table 2
  const [page4g, setPage4g] = useState(1);
  const [pageAi, setPageAi] = useState(1);
  const pageSize = 10;

  // Detail modal
  const [selectedPost, setSelectedPost] = useState<CrawledPostAuditItem | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage4g(1);
      setPageAi(1);
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!selectedPost) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setSelectedPost(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPost]);

  const loadParams = useMemo(
    () => ({
      time_range: timeRange,
      search: debouncedSearch || undefined,
      ai_filter: aiFilter,
      source_filter: sourceFilter,
      limit: 150,
    }),
    [timeRange, debouncedSearch, aiFilter, sourceFilter],
  );

  const fetchOverview = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await publicCrawlerService.getCrawledPosts(loadParams);
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Không tải được danh sách bài viết cào được & AI check.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadParams]);

  useEffect(() => {
    let cancelled = false;
    publicCrawlerService
      .getCrawledPosts(loadParams)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Không tải được danh sách bài viết cào được & AI check.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadParams]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void fetchOverview();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchOverview]);

  const summary = data?.summary ?? {
    total_4g_posts: 0,
    today_4g_posts: 0,
    pending_ai_count: 0,
    ai_checked_total: 0,
    ai_lead_high_count: 0,
    ai_kept_mid_count: 0,
    ai_deleted_count: 0,
    auto_seeding_count: 0,
  };

  const posts4g = useMemo(() => data?.public_4g_posts ?? [], [data?.public_4g_posts]);
  const aiCheckedPosts = useMemo(
    () => data?.ai_checked_posts ?? [],
    [data?.ai_checked_posts],
  );

  const paged4g = useMemo(() => {
    const start = (page4g - 1) * pageSize;
    return posts4g.slice(start, start + pageSize);
  }, [posts4g, page4g]);

  const pagedAi = useMemo(() => {
    const start = (pageAi - 1) * pageSize;
    return aiCheckedPosts.slice(start, start + pageSize);
  }, [aiCheckedPosts, pageAi]);

  return (
    <div className="space-y-6">
      {/* Header & Thanh bộ lọc */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-emerald-50/50 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Bot className="size-5 text-emerald-600" />
              Theo dõi Bài viết Cào được &amp; Kết quả AI Check
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Đối chiếu trực tiếp bài vừa lưu từ <strong>Cào Xoay IP 4G</strong> (Bảng 1) và kết quả{" "}
              <strong>AI thẩm định Lead / lọc Đối thủ</strong> (Bảng 2 — giữ nguyên nhật ký kể cả các bài bị AI xóa khỏi Feed).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="size-3.5 accent-emerald-600 rounded"
              />
              <Radio className={cn("size-3.5", autoRefresh ? "text-emerald-600 animate-pulse" : "text-slate-400")} />
              Tự làm mới 10s
            </label>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void fetchOverview()}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer transition disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
              Làm mới
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-bold">
              {(
                [
                  { id: "all", label: "Tất cả" },
                  { id: "today", label: "Hôm nay" },
                  { id: "7d", label: "7 ngày" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setTimeRange(opt.id);
                    setPage4g(1);
                    setPageAi(1);
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-md cursor-pointer transition",
                    timeRange === opt.id
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <Filter className="size-3.5 text-slate-400" />
              <select
                aria-label="Lọc theo kết quả AI"
                value={aiFilter}
                onChange={(e) => {
                  setAiFilter(e.target.value as AiFilterOption);
                  setPage4g(1);
                  setPageAi(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <option value="all">Tất cả trạng thái AI</option>
                <option value="lead_high">Khách thật / Lead (≥ 70đ)</option>
                <option value="kept">Đã giữ (≥ 40đ)</option>
                <option value="deleted">AI đã xóa (Đối thủ / &lt;40đ)</option>
                <option value="pending">Đang chờ AI check</option>
              </select>
            </div>
          </div>

          <div className="relative w-full md:w-80">
            <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm nội dung, nhóm, tác giả, SĐT, lý do AI..."
              className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="text-[11px] font-bold text-emerald-700">Bài Cào Xoay IP 4G</div>
          <div className="text-2xl font-black text-emerald-900 mt-1 tabular-nums">
            {summary.total_4g_posts}
          </div>
          <div className="text-[11px] text-emerald-700/80 mt-0.5">
            Hôm nay: <strong>{summary.today_4g_posts}</strong> bài
          </div>
        </div>

        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <div className="text-[11px] font-bold text-sky-700">Đang chờ AI check</div>
          <div className="text-2xl font-black text-sky-900 mt-1 tabular-nums">
            {summary.pending_ai_count}
          </div>
          <div className="text-[11px] text-sky-700/80 mt-0.5">Hàng đợi nền bất đồng bộ</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-bold text-slate-600">Tổng bài AI đã Check</div>
          <div className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
            {summary.ai_checked_total}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Đạt giữ 40–69đ: <strong>{summary.ai_kept_mid_count}</strong>
          </div>
        </div>

        <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
          <div className="text-[11px] font-bold text-teal-700">Lead Khách thật (≥ 70đ)</div>
          <div className="text-2xl font-black text-teal-900 mt-1 tabular-nums">
            {summary.ai_lead_high_count}
          </div>
          <div className="text-[11px] text-teal-700/80 mt-0.5">
            Auto Comment: <strong>{summary.auto_seeding_count}</strong>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
          <div className="text-[11px] font-bold text-rose-700">AI loại (Đối thủ / &lt;40đ)</div>
          <div className="text-2xl font-black text-rose-900 mt-1 tabular-nums">
            {summary.ai_deleted_count}
          </div>
          <div className="text-[11px] text-rose-700/80 mt-0.5">Đã tự xóa khỏi Feed</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          ⚠️ {error}
        </div>
      )}

      {/* BẢNG 1: BÀI VIẾT CÀO ĐƯỢC TỪ CÀO XOAY IP 4G */}
      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 bg-emerald-50/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <span className="inline-flex items-center justify-center size-6 rounded-lg bg-emerald-600 text-white text-xs font-black">
                1
              </span>
              Bảng 1 · Bài viết cào được từ Cào Xoay IP 4G ({posts4g.length})
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Lưu vết toàn bộ bài mới thu thập qua Proxy Xoay 4G (cả bài đang chờ AI, bài giữ làm Lead lẫn bài bị AI xóa do là đối thủ).
            </p>
          </div>
        </div>

        {loading && !data ? (
          <div className="p-8 text-center text-xs text-slate-500">Đang tải dữ liệu Cào Xoay IP 4G...</div>
        ) : posts4g.length === 0 ? (
          <div className="p-8 text-center space-y-1.5">
            <div className="text-xs font-bold text-slate-700">
              Chưa ghi nhận bài viết mới nào từ Cào Xoay IP 4G trong bộ lọc hiện tại.
            </div>
            <p className="text-[11px] text-slate-500 max-w-lg mx-auto">
              Hãy qua tab <strong>Cào Public 4G (Không Acc)</strong> bấm{" "}
              <strong>Test Cào Nhanh 3 Nhóm</strong> hoặc bật Auto 24/24 — mỗi khi có nhóm{" "}
              <code>lưu mới &gt; 0 bài</code>, bài sẽ xuất hiện ngay tại đây.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-3 whitespace-nowrap">Thời gian cào &amp; Proxy</th>
                  <th className="py-2.5 px-3">Nhóm / Tác giả</th>
                  <th className="py-2.5 px-3 min-w-[280px]">Nội dung bài viết</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Tương tác</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Trạng thái AI</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged4g.map((item) => (
                  <tr
                    key={`4g:${item.platform}:${item.post_url}`}
                    className="hover:bg-slate-50/80 transition align-top"
                  >
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-mono text-[11px] font-semibold text-slate-700">
                        {formatVnDateTime(item.crawled_at)}
                      </div>
                      <span className="inline-block mt-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                        {item.proxy_node || "proxy-01"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 max-w-[210px]">
                      <div className="font-bold text-slate-900 truncate" title={item.group_name || ""}>
                        {item.group_name || "Nhóm Facebook Public"}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {item.author_name ? `Tác giả: ${item.author_name}` : "Chế độ Guest"}
                      </div>
                      {item.post_time && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Đăng: {formatVnDateTime(item.post_time)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 max-w-[420px]">
                      <p className="text-slate-700 line-clamp-3 leading-relaxed whitespace-pre-line">
                        {item.content || "[Không có nội dung text]"}
                      </p>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-[11px] text-slate-600 tabular-nums">
                        <span className="inline-flex items-center gap-0.5" title="Reactions">
                          <ThumbsUp className="size-3 text-slate-400" /> {item.reactions}
                        </span>
                        <span className="inline-flex items-center gap-0.5" title="Comments">
                          <MessageSquare className="size-3 text-slate-400" /> {item.comments}
                        </span>
                        <span className="inline-flex items-center gap-0.5" title="Shares">
                          <Share2 className="size-3 text-slate-400" /> {item.shares}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <AiBadgeChip item={item} />
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedPost(item)}
                          className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="size-3" /> Xem
                        </button>
                        <a
                          href={item.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-[11px] font-semibold text-sky-700 inline-flex items-center gap-1"
                        >
                          <ExternalLink className="size-3" /> Link
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar
          total={posts4g.length}
          page={page4g}
          pageSize={pageSize}
          onPageChange={setPage4g}
        />
      </section>

      {/* BẢNG 2: BÀI VIẾT ĐƯỢC AI CHECK */}
      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 bg-sky-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <span className="inline-flex items-center justify-center size-6 rounded-lg bg-sky-600 text-white text-xs font-black">
                2
              </span>
              Bảng 2 · Bài viết được AI Check ({aiCheckedPosts.length})
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Chi tiết điểm Lead, phân loại Khách thật / Đối thủ chào hàng, lý do AI đánh giá và hành động tự động (Giữ, Xóa, Auto Comment, Zalo).
            </p>
          </div>

          <div className="inline-flex rounded-lg bg-white border border-slate-200 p-0.5 text-[11px] font-bold shrink-0">
            {(
              [
                { id: "all", label: "Tất cả nguồn" },
                { id: "public_4g", label: "Chỉ Xoay IP 4G" },
                { id: "extension", label: "Extension / Khác" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setSourceFilter(opt.id);
                  setPageAi(1);
                }}
                className={cn(
                  "px-2.5 py-1 rounded-md cursor-pointer transition",
                  sourceFilter === opt.id
                    ? "bg-sky-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading && !data ? (
          <div className="p-8 text-center text-xs text-slate-500">Đang tải nhật ký AI Check...</div>
        ) : aiCheckedPosts.length === 0 ? (
          <div className="p-8 text-center space-y-1">
            <div className="text-xs font-bold text-slate-700">
              Chưa có bài viết nào khớp bộ lọc AI Check.
            </div>
            <p className="text-[11px] text-slate-500">
              Thử đổi bộ lọc <strong>&ldquo;Tất cả trạng thái AI&rdquo;</strong> hoặc <strong>&ldquo;Tất cả nguồn&rdquo;</strong> để xem thêm.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-3 whitespace-nowrap">Thời gian AI &amp; Nguồn</th>
                  <th className="py-2.5 px-3 min-w-[260px]">Nhóm &amp; Nội dung</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Điểm &amp; Nhu cầu</th>
                  <th className="py-2.5 px-3 min-w-[230px]">Phân loại &amp; Lý do AI</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Hành động</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedAi.map((item) => {
                  const srcMeta = SOURCE_BADGE_STYLES[item.crawl_source] ?? {
                    label: item.crawl_source || "Khác",
                    className: "bg-slate-100 text-slate-600 border-slate-200",
                  };
                  const needLabel = item.lead_need_category
                    ? NEED_CATEGORY_LABELS[item.lead_need_category] ?? item.lead_need_category
                    : null;
                  const isDeleted =
                    item.ai_status === "deleted_competitor" ||
                    item.ai_status === "deleted_low_score";

                  return (
                    <tr
                      key={`ai:${item.platform}:${item.post_url}`}
                      className={cn(
                        "transition align-top",
                        isDeleted ? "bg-rose-50/20 hover:bg-rose-50/40" : "hover:bg-slate-50/80",
                      )}
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-mono text-[11px] font-semibold text-slate-700">
                          {formatVnDateTime(item.ai_checked_at || item.crawled_at)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded border text-[10px] font-bold",
                              srcMeta.className,
                            )}
                          >
                            {srcMeta.label}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">
                            {item.platform}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 max-w-[340px]">
                        <div className="font-bold text-slate-900 truncate" title={item.group_name || ""}>
                          {item.group_name || "Nhóm / Nguồn dữ liệu"}
                        </div>
                        <p className="text-slate-600 line-clamp-2 mt-0.5 leading-relaxed whitespace-pre-line">
                          {item.content || "[Không có nội dung text]"}
                        </p>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <AiBadgeChip item={item} />
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {needLabel && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">
                              {needLabel}
                            </span>
                          )}
                          {item.contact_phone && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px] font-bold">
                              <Phone className="size-2.5" /> {item.contact_phone}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 max-w-[300px]">
                        <div className="text-[11px] font-semibold text-slate-800">
                          {item.ai_status === "deleted_competitor"
                            ? "Đối thủ / Agency chào dịch vụ"
                            : item.ai_status === "deleted_low_score"
                              ? "Không đúng nhu cầu / Điểm thấp"
                              : item.is_buyer
                                ? "Khách hàng thật đang tìm đơn vị"
                                : "Đạt ngưỡng giữ lại Feed"}
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-snug line-clamp-2">
                          {item.lead_score_reason || "—"}
                        </p>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1 text-[10px] font-bold">
                          {isDeleted ? (
                            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
                              Đã xóa khỏi DB
                            </span>
                          ) : item.ai_status === "kept" ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Đã giữ ở Feed
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              Giữ nguyên bài
                            </span>
                          )}
                          {item.auto_seeding_created && (
                            <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                              Đã tạo Auto Comment
                            </span>
                          )}
                          {item.zalo_triggered && (
                            <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                              Đã gửi Zalo tư vấn
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedPost(item)}
                            className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="size-3" /> Chi tiết
                          </button>
                          <a
                            href={item.post_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-[11px] font-semibold text-sky-700 inline-flex items-center gap-1"
                          >
                            <ExternalLink className="size-3" /> Link
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar
          total={aiCheckedPosts.length}
          page={pageAi}
          pageSize={pageSize}
          onPageChange={setPageAi}
        />
      </section>

      {/* Modal Chi tiết Bài viết & Kết quả AI */}
      {selectedPost && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedPost(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Chi tiết bài viết cào được và đánh giá AI"
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50">
              <div className="min-w-0">
                <h4 className="text-sm font-black text-slate-900 truncate">
                  {selectedPost.group_name || "Chi tiết bài viết"}
                </h4>
                <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                  <span>Cào lúc: {formatVnDateTime(selectedPost.crawled_at)}</span>
                  {selectedPost.ai_checked_at && (
                    <span>· AI check: {formatVnDateTime(selectedPost.ai_checked_at)}</span>
                  )}
                  {selectedPost.proxy_node && (
                    <span className="font-mono font-bold text-emerald-700">
                      · {selectedPost.proxy_node}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPost(null)}
                aria-label="Đóng chi tiết"
                className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-500 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <AiBadgeChip item={selectedPost} />
                {selectedPost.lead_need_category && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold">
                    Nhu cầu:{" "}
                    {NEED_CATEGORY_LABELS[selectedPost.lead_need_category] ??
                      selectedPost.lead_need_category}
                  </span>
                )}
                {selectedPost.contact_phone && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[11px] font-bold">
                    SĐT: {selectedPost.contact_phone}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                <div className="text-[11px] font-bold text-slate-700">Lý do AI đánh giá</div>
                <p className="text-slate-800 leading-relaxed">
                  {selectedPost.lead_score_reason || "Chưa có lý do AI (đang chờ hoặc chưa chấm)."}
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-bold text-slate-700">
                  Nội dung bài viết{selectedPost.author_name ? ` (${selectedPost.author_name})` : ""}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-slate-800 leading-relaxed whitespace-pre-line">
                  {selectedPost.content || "[Không có nội dung text]"}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
              <a
                href={selectedPost.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <ExternalLink className="size-3.5" /> Mở bài viết gốc
              </a>
              <button
                type="button"
                onClick={() => setSelectedPost(null)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
