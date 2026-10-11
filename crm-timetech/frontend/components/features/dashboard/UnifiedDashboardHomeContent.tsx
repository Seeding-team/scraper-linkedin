"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ApiExtensionLauncher } from "@/components/all-platform/components/api-extension-launcher";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { FilterBar, type FilterState } from "@/components/all-platform/components/filter-bar";
import { PostCard } from "@/components/all-platform/components/post-card";
import { toast } from "sonner";
import { allPlatformPostsDeleteService } from "@/services/all-platform-posts-delete.service";

import { PostDetailModal } from "@/components/all-platform/components/post-detail-modal";
import { VerifyAccountModal } from "@/components/all-platform/components/verify-account-modal";
import { KpiProgressCard } from "@/components/all-platform/components/kpi-progress-card";
import { MemberKpiRewardOverview } from "@/components/all-platform/kpi-rewards/KpiRewardSections";
import { BulkCommentLauncher } from "@/components/all-platform/components/bulk-comment-launcher";
import { SeedingActivityPanel } from "@/components/all-platform/feed/SeedingActivityPanel";
import { ScheduleCommentModal } from "@/components/all-platform/feed/ScheduleCommentModal";
import { ScheduledCommentsPanel } from "@/components/all-platform/feed/ScheduledCommentsPanel";
import { PostFeedSkeleton } from "@/components/all-platform/feed/PostFeedSkeleton";
import { allPlatformPostsService, allPlatformCategoriesService, teamsService, socialAccountsService } from "@/services/all-platform.service";
import type { UnifiedPost, UnifiedStats, Category, FeedPlatform, SocialAccount } from "@/types/unified.types";

// â”€â”€â”€ Retry helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
    }
  }
  throw lastError;
}

// â”€â”€â”€ Timezone Helpers (Vietnam UTC+7) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VIETNAM_OFFSET_HOURS = 7;

function getVietnamNow(): Date {
  return new Date(Date.now() + VIETNAM_OFFSET_HOURS * 60 * 60 * 1000);
}

function getVietnamDateStr(): string {
  return getVietnamNow().toISOString().split("T")[0];
}

function getVietnamYesterdayStr(): string {
  const d = getVietnamNow();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

const getDatePart = (dateInput?: Date | string | null) => {
  if (!dateInput) return "";
  if (typeof dateInput === "string") {
    const normalized = dateInput.replace(" ", "T");
    const datePart = normalized.split("T")[0];
    if (datePart.length === 10) {
      return datePart;
    }
    return normalized.substring(0, 10);
  }
  try {
    return dateInput.toISOString().split("T")[0];
  } catch (e) {
    return "";
  }
};

// â”€â”€â”€ Stats Card (Redesigned & Premium & Softer) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  accent?: "blue" | "green" | "amber" | "indigo" | string;
  progress?: { value: number; label: string };
  trend?: { value: number; isUp: boolean; label: string };
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
  progress,
  trend,
}: StatCardProps) {
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = (y - centerY) / 25;
    const rotateY = (centerX - x) / 25;
    setCoords({ x: rotateY, y: rotateX });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setCoords({ x: 0, y: 0 });
  };

  const transformStyle = isHovered
    ? {
        transform: `perspective(1000px) rotateX(${coords.y}deg) rotateY(${coords.x}deg)`,
        transition: "transform 0.05s ease",
      }
    : {
        transform: "perspective(1000px) rotateX(0deg) rotateY(0deg)",
        transition: "transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)",
      };

  let iconCls = "bg-muted text-muted-foreground";
  let barColor = "bg-muted-foreground/60";

  if (accent === "blue") {
    iconCls = "bg-blue-50/80 text-blue-500 dark:bg-blue-950/20 dark:text-blue-400";
    barColor = "bg-blue-500";
  } else if (accent === "green") {
    iconCls = "bg-emerald-50/80 text-emerald-500 dark:bg-emerald-950/20 dark:text-emerald-400";
    barColor = "bg-emerald-500";
  } else if (accent === "amber") {
    iconCls = "bg-amber-50/80 text-amber-500 dark:bg-amber-950/20 dark:text-amber-400";
    barColor = "bg-amber-500";
  } else if (accent === "indigo") {
    iconCls = "bg-indigo-50/80 text-indigo-500 dark:bg-indigo-950/20 dark:text-indigo-400";
    barColor = "bg-indigo-500";
  }

  return (
    <div
      className="bg-card border border-border p-4 rounded-xl shadow-none flex flex-col justify-between relative overflow-hidden group select-none"
    >
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-muted-foreground capitalize">{label}</p>
          <h3 className="text-xl font-bold text-foreground tracking-tight mt-1">
            {typeof value === "number" ? value.toLocaleString("vi-VN") : value}
          </h3>
        </div>
        <div
          className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-105",
            iconCls,
          )}
        >
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
        {trend ? (
          <span
            className={cn(
              "text-[11px] font-bold flex items-center gap-1",
              trend.isUp ? "text-emerald-500" : "text-amber-500",
            )}
          >
            <span className="material-symbols-outlined text-[14px]">
              {trend.isUp ? "arrow_upward" : "arrow_downward"}
            </span>
            {trend.label}
          </span>
        ) : progress ? (
          <div className="flex-1 max-w-[140px]">
            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", barColor)}
                style={{ width: `${progress.value}%` }}
              />
            </div>
            <span className="text-[9px] font-semibold text-muted-foreground mt-1 block leading-none">
              {progress.label}
            </span>
          </div>
        ) : sub ? (
          <span className="text-[10px] text-muted-foreground font-medium leading-none">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}

// â”€â”€â”€ Menu doc lap theo mang dich vu (2026-07-04) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Yeu cau Thanh: "trong post feed chia làm 2,3 menu độc lập theo từng mảng
// dịch vụ" (CNTT rieng, luu tru/hotel rieng). Category "industry" hien chi
// co 4 gia tri (IT & Software, Artificial Intelligence, Finance & Banking,
// Marketing & Digital) - CHUA co danh muc "luu tru/hotel" nao ca (se rong
// cho toi khi admin them danh muc + co bai crawl thuoc nhom do). Dung so
// khop TU KHOA (khong phai danh sach ten co dinh) de tu dong nhan dien danh
// muc moi duoc them sau nay ma khong can sua code lai.
type ServiceAreaKey = "all" | "tech" | "hospitality" | "other";
const SERVICE_AREA_TABS: { key: ServiceAreaKey; label: string; keywords?: string[] }[] = [
  { key: "all", label: "Tất cả" },
  { key: "tech", label: "CNTT / Công nghệ", keywords: ["it", "software", "công nghệ", "cong nghe", "ai", "artificial intelligence", "phần mềm", "phan mem", "tech"] },
  { key: "hospitality", label: "Lưu trú / Hotel", keywords: ["hotel", "khách sạn", "khach san", "lưu trú", "luu tru", "resort", "du lịch", "du lich", "nhà nghỉ", "nha nghi", "homestay"] },
  { key: "other", label: "Khác" },
];

function matchesServiceArea(industry: string | undefined, area: ServiceAreaKey): boolean {
  if (area === "all") return true;
  const name = (industry || "").toLowerCase();
  if (area === "other") {
    // "Khac" = khong khop tech VA khong khop hospitality
    const techKw = SERVICE_AREA_TABS.find(t => t.key === "tech")?.keywords || [];
    const hospKw = SERVICE_AREA_TABS.find(t => t.key === "hospitality")?.keywords || [];
    return !techKw.some(k => name.includes(k)) && !hospKw.some(k => name.includes(k));
  }
  const keywords = SERVICE_AREA_TABS.find(t => t.key === area)?.keywords || [];
  return keywords.some(k => name.includes(k));
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function UnifiedDashboardHomeContent({ hideHeader }: { hideHeader?: boolean }) {
  const { user } = useAppAuth();
  const CURRENT_USER_EMAIL = user?.email || "";

  const [feedPlatform, setFeedPlatform] = useState<FeedPlatform>("facebook");
  const [serviceArea, setServiceArea] = useState<ServiceAreaKey>("all");
  const [showBulkCommentModal, setShowBulkCommentModal] = useState(false);

  const [detailModalPost, setDetailModalPost] = useState<UnifiedPost | null>(null);
  const [verifyModalPost, setVerifyModalPost] = useState<UnifiedPost | null>(null);
  const [scheduleModalPost, setScheduleModalPost] = useState<UnifiedPost | null>(null);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);

  // Result Modals
  const [showCrawlResultModal, setShowCrawlResultModal] = useState(false);
  const [crawlResultsSummary, setCrawlResultsSummary] = useState<{ totalPosts: number, groups: { groupUrl: string, count: number }[], launchedGroups: string[], crawledPostUrls: string[] }>({ totalPosts: 0, groups: [], launchedGroups: [], crawledPostUrls: [] });
  const [showSeedingResultModal, setShowSeedingResultModal] = useState(false);
  const [recentlySeededUrls, setRecentlySeededUrls] = useState<string[]>([]);

  // States
  const [posts, setPosts] = useState<UnifiedPost[]>([]);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  const [stats, setStats] = useState<UnifiedStats>({
    totalPostsToday: 0,
    postsYesterday: 0,
    highScoreCount: 0,
    highScorePercent: 0,
    seededToday: 0,
    kpiProgress: 0,
    kpiTarget: 0,
    kpiProgressPercent: 0,
  });
  // Mac dinh true (khong phai false): luc moi mount, user/CURRENT_USER_EMAIL tu
  // AppAuthContext chua kip load xong nen fetchPosts() se return som (guard
  // !CURRENT_USER_EMAIL) va KHONG bao gio set isLoadingPosts=true - neu khoi
  // tao false, khoang thoi gian cho auth check xong se hien nham thanh "chua
  // co bai dang" (trong) thay vi dang tai, nhin giong trang bi loi.
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filter & Taxonomy States
  const [categories, setCategories] = useState<Category[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    intent: "",
    industry: "",
    team: "",
    tier: "",
    icp: "",
    content_type: "",
    product_seeding: "",
    member: "",
    sort: "latest",
    dateRange: "",
    seeding_status: "all",
  });
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch Taxonomy
  const fetchCategories = useCallback(async () => {
    try {
      const [catRes, teamRes] = await Promise.all([
        allPlatformCategoriesService.getAll(),
        teamsService.getAll(),
      ]);
      if (catRes.success && catRes.data) setCategories(catRes.data as Category[]);
      if (teamRes.success && teamRes.data) {
        const seen = new Set<string>();
        const list: { id: string; name: string }[] = [];
        for (const t of teamRes.data as any[]) {
          if (t.id && t.name_team && !seen.has(t.id)) {
            seen.add(t.id);
            list.push({ id: t.id, name: t.name_team });
          }
        }
        setTeams(list);
      }
    } catch {}
  }, []);

  // Fetch Stats
  const fetchStats = useCallback(async () => {
    if (!CURRENT_USER_EMAIL) return;
    try {
      const res = await allPlatformPostsService.getStats({
        email: CURRENT_USER_EMAIL,
        platform: feedPlatform,
      });
      if (res.success && res.data) {
        setStats(res.data as UnifiedStats);
      }
    } catch {}
  }, [CURRENT_USER_EMAIL, feedPlatform]);

  // Fetch Posts (Phase 6: dùng luôn quick_stats từ response, tiết kiệm 1 round-trip)

  const fetchPosts = useCallback(async () => {
    // Tránh stuck spinner khi auth chưa load xong / user không có email.
    if (!CURRENT_USER_EMAIL) {
      setIsLoadingPosts(false);
      setPosts([]);
      setTotalCount(0);
      setTotalPages(1);
      setPostsError(null);
      return;
    }
    setIsLoadingPosts(true);
    setPostsError(null);
    try {
      let dateFrom: string | undefined;
      let dateTo: string | undefined;

      if (filters.dateRange === "today") {
        dateFrom = new Date().toISOString().split("T")[0];
      } else if (filters.dateRange === "yesterday") {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        dateFrom = d.toISOString().split("T")[0];
        dateTo = dateFrom;
      } else if (filters.dateRange === "7days") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        dateFrom = d.toISOString().split("T")[0];
      } else if (filters.dateRange === "30days") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        dateFrom = d.toISOString().split("T")[0];
      }

      const res = await fetchWithRetry(() =>
        allPlatformPostsService.filter({
          email: CURRENT_USER_EMAIL,
          platform: feedPlatform,
          date_from: dateFrom,
          date_to: dateTo,
          intent: filters.intent || undefined,
          industry: filters.industry || undefined,
          team: filters.team || undefined,
          tier: filters.tier || undefined,
          icp: filters.icp || undefined,
          content_type: filters.content_type || undefined,
          product_seeding: filters.product_seeding || undefined,
          search: filters.search || undefined,
          sort: filters.sort,
          page,
          page_size: 15,
        })
      );

      if (res.success && res.data) {
        let posts = res.data.posts || [];

        // Phase 6: FE-side seeding filter + sort
        // Backend trả đủ posts với all_seedings → FE filter/sort không cần refetch
        if (filters.seeding_status && filters.seeding_status !== "all") {
          posts = posts.filter((p) => {
            const seedings = p.all_seedings ?? [];
            if (filters.seeding_status === "seeded") {
              return seedings.length > 0;
            }
            if (filters.seeding_status === "verified") {
              return seedings.some(
                (s) => s.verify_status === "yes" && !s.link_comment?.startsWith("Bị từ chối"),
              );
            }
            if (filters.seeding_status === "pending") {
              return seedings.some(
                (s) => s.verify_status !== "yes" && !s.link_comment?.startsWith("Bị từ chối"),
              );
            }
            if (filters.seeding_status === "rejected") {
              return seedings.some(
                (s) => s.link_comment?.startsWith("Bị từ chối") || s.verify_status === "no",
              );
            }
            return true;
          });
        }

        // FE-side sort by seeding (backend chưa hỗ trợ sort=most_seeded/verified_first)
        if (filters.sort === "most_seeded") {
          posts = [...posts].sort(
            (a, b) => (b.all_seedings?.length ?? 0) - (a.all_seedings?.length ?? 0),
          );
        } else if (filters.sort === "verified_first") {
          posts = [...posts].sort((a, b) => {
            const verCount = (p: typeof posts[0]) =>
              (p.all_seedings ?? []).filter(
                (s) => s.verify_status === "yes" && !s.link_comment?.startsWith("Bị từ chối"),
              ).length;
            return verCount(b) - verCount(a);
          });
        }

        setPosts(posts);
        setTotalCount(res.data.total || 0);
        // Khi filter seeding: totalPages = 1 vì FE-side filter không có pagination thực
        setTotalPages(filters.seeding_status && filters.seeding_status !== "all" ? 1 : res.data.total_pages || 1);
        // Phase 6: ưu tiên quick_stats từ response (1 round-trip), fallback /stats nếu thiếu
        if (res.data.quick_stats) {
          setStats(res.data.quick_stats as UnifiedStats);
        } else {
          // Backend cũ chưa trả quick_stats → gọi /unified/stats riêng
          fetchStats();
        }
      } else {
        setPostsError(res.message || "Không thể tải bài viết.");
      }
    } catch (err) {
      setPostsError(err instanceof Error ? err.message : "Lỗi khi tải bài viết.");
    } finally {
      setIsLoadingPosts(false);
    }
  }, [CURRENT_USER_EMAIL, feedPlatform, filters, page]);

  // Xu huong 14 ngay gan nhat (tong bai/comment/inbox) — bo sung cho 4 the chi
  // co so hom nay, theo yeu cau Thanh: "cần thêm dashboard để biết tổng

  // comment, inbox... các ngày ra sao".
  const [dailyTrend, setDailyTrend] = useState<Array<{ date: string; posts: number; comments: number; inbox: number }>>([]);
  // Cung ly do voi isLoadingPosts o tren: fetchDailyTrend cung guard
  // !CURRENT_USER_EMAIL nen phai khoi tao true, khong la false.
  const [isLoadingTrend, setIsLoadingTrend] = useState(true);
  const fetchDailyTrend = useCallback(async () => {
    if (!CURRENT_USER_EMAIL) return;
    setIsLoadingTrend(true);
    try {
      const res = await allPlatformPostsService.getDailyTrend({
        email: CURRENT_USER_EMAIL,
        platform: feedPlatform,
      });
      if (res.success && res.data) {
        setDailyTrend(res.data);
      }
    } catch {
      // im lang: khoi xu huong la thong tin bo sung, khong chan trang chinh
    } finally {
      setIsLoadingTrend(false);
    }
  }, [CURRENT_USER_EMAIL, feedPlatform]);

  useEffect(() => {
    if (!CURRENT_USER_EMAIL) return;
    fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    if (!CURRENT_USER_EMAIL) return;
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (!CURRENT_USER_EMAIL) return;
    fetchDailyTrend();
  }, [fetchDailyTrend]);

  useEffect(() => {
    if (!CURRENT_USER_EMAIL) return;
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (!CURRENT_USER_EMAIL) return;
    socialAccountsService.getAll().then((res) => {
      if (res.success) setSocialAccounts(res.data || []);
    }).catch(() => {});
  }, [CURRENT_USER_EMAIL]);

  const handleFilter = useCallback((f: FilterState) => {
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      setFilters(f);
      setPage(1);
      // Phase 6: persist filter state in URL (refresh won't lose filters)
      if (typeof window !== "undefined") {
        const params = new URLSearchParams();
        if (f.search) params.set("q", f.search);
        if (f.intent) params.set("intent", f.intent);
        if (f.industry) params.set("industry", f.industry);
        if (f.team) params.set("team", f.team);
        if (f.sort !== "latest") params.set("sort", f.sort);
        if (f.dateRange) params.set("date", f.dateRange);
        if (f.seeding_status && f.seeding_status !== "all")
          params.set("seeding", f.seeding_status);
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        window.history.replaceState(null, "", newUrl);
      }
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
  }, []);

  // Phase 6: restore filter state from URL on mount (F5 won't lose filters)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const hasParams = Array.from(params.keys()).length > 0;
    if (!hasParams) return;
    setFilters((prev) => ({
      ...prev,
      search: params.get("q") || "",
      intent: params.get("intent") || "",
      industry: params.get("industry") || "",
      team: params.get("team") || "",
      sort: (params.get("sort") as typeof prev.sort) || "latest",
      dateRange: params.get("date") || "",
      seeding_status: (params.get("seeding") as typeof prev.seeding_status) || "all",
    }));
  }, []);

  const intents = categories.filter((c) => c.category_type === "intent");
  const industries = categories.filter((c) => c.category_type === "industry");
  const tiers = categories.filter((c) => c.category_type === "tier");
  const icps = categories.filter((c) => c.category_type === "icp");
  const contentTypes = categories.filter((c) => c.category_type === "content_type");
  const productSeedings = categories.filter((c) => c.category_type === "product_seeding");
  const teamCategories: Category[] = teams.map((t) => ({
    id: t.id,
    code: t.name,
    name: t.name,
    category_type: "team",
    platform: "all",
  }));

  const fbDiff = stats.totalPostsToday - stats.postsYesterday;

  const handleDeletePost = useCallback(
    async (post: UnifiedPost) => {
      if (!post?.id) {
        toast.error("Không có id bài viết để xóa");
        return;
      }

      // Optimistic + rollback
      const prevPosts = posts;
      const prevTotal = totalCount;

      setDeletingPostId(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setTotalCount((c) => Math.max(0, c - 1));

      try {
        const res = await allPlatformPostsDeleteService.deleteFacebookPost({ id: post.id });
        if (!res?.success) {
          throw new Error(res?.message || "Xóa thất bại");
        }
      } catch (e) {
        // rollback UI
        setPosts(prevPosts);
        setTotalCount(prevTotal);
        toast.error(e instanceof Error ? e.message : "Xóa thất bại");
      } finally {
        setDeletingPostId(null);
      }
    },
    [posts, totalCount],
  );


  // Loc client-side theo mang dich vu da chon (xem SERVICE_AREA_TABS o dau
  // file) - khong doi lai backend/pagination, chi an/hien trong trang hien
  // tai. Neu can loc dung tren toan bo du lieu (khong chi trang dang xem),
  // viec nay nen chuyen xuong backend (them tham so service_area) o phien sau.
  const visiblePosts = useMemo(
    () => posts.filter(p => matchesServiceArea(p.industry, serviceArea)),
    [posts, serviceArea],
  );

  return (
    <div className="w-full space-y-6">
      {!hideHeader && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Unified Post Feed</h1>
            <p className="text-sm text-muted-foreground">
              Quản lý và theo dõi bài viết đa nền tảng với trí tuệ nhân tạo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="bg-muted p-0.5 rounded-lg flex gap-0.5">
              {([
                { key: "facebook", label: "Facebook" },
                { key: "linkedin", label: "LinkedIn" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setFeedPlatform(t.key); setPage(1); }}
                  className={cn(
                    "px-4 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer",
                    feedPlatform === t.key
                      ? "bg-white text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon="description"
            label="Tổng bài hôm nay"
            value={stats.totalPostsToday}
            trend={{
              value: Math.abs(fbDiff),
              isUp: fbDiff >= 0,
              label: `${fbDiff >= 0 ? "+" : ""}${fbDiff} so với hôm qua`,
            }}
            accent="blue"
          />
          <StatCard
            icon="trending_up"
            label="Tiến độ KPI"
            value={stats.kpiProgress || 0}
            progress={{
              value: stats.kpiProgressPercent || 0,
              label: `${stats.kpiProgressPercent || 0}% trong tập bài`,
            }}
            accent="green"
          />
          <StatCard
            icon="rocket_launch"
            label="Đã seeded hôm nay"
            value={stats.seededToday}
            sub="Ước tính từ batch hôm nay"
            accent="amber"
          />
          <StatCard
            icon="visibility"
            label="Tổng bài hiển thị"
            value={totalCount}
            sub={`${totalCount} bài trong cơ sở dữ liệu`}
            accent="indigo"
          />
        </div>
      </div>

      {/* Dashboard xu huong 14 ngay gan nhat (2026-07-04) — theo yeu cau Thanh:
          4 the o tren chi co so HOM NAY, khong biet cac ngay truoc ra sao.
          Chart nhe (khong chan trang neu loi/rong), dat ngay sau 4 the so lieu. */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">Xu hướng 14 ngày gần nhất</h3>
            <p className="text-xs text-muted-foreground">Tổng bài cào được · Comment đã verify · Inbox nhận được, theo từng ngày.</p>
          </div>
          {isLoadingTrend && <span className="text-xs text-muted-foreground">Đang tải...</span>}
        </div>
        {dailyTrend.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            {isLoadingTrend ? "Đang tải dữ liệu xu hướng..." : "Chưa có dữ liệu xu hướng."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorPosts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorComments" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorInbox" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
                tick={{ fontSize: 11, fill: "#737373" }}
                axisLine={{ stroke: "#e5e5e5" }}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 11, fill: "#737373" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                labelFormatter={(d) => `Ngày ${String(d ?? "").slice(5).replace("-", "/")}`}
                contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e5e5" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="posts" name="Tổng bài" stroke="#2563eb" fill="url(#colorPosts)" strokeWidth={2} />
              <Area type="monotone" dataKey="comments" name="Comment" stroke="#16a34a" fill="url(#colorComments)" strokeWidth={2} />
              <Area type="monotone" dataKey="inbox" name="Inbox" stroke="#f59e0b" fill="url(#colorInbox)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Phase 6: KPI personal progress — hiển thị cho cả member VÀ leader */}
      {CURRENT_USER_EMAIL && (user?.role === "member" || user?.role === "leader") && (
        <KpiProgressCard
          email={CURRENT_USER_EMAIL}
          type="comment"
        />
      )}
      {CURRENT_USER_EMAIL && user?.role === "member" && (
        <MemberKpiRewardOverview />
      )}
      {/* Phase 6: "Da seeding ai" - panel cho admin/leader.
          Dat sau KpiProgressCard, truoc FilterBar de leader/admin
          thay ngay tong quan seeding ma khong can mo tung PostCard. */}
      {(user?.role === "admin" || user?.role === "leader") && (
        <SeedingActivityPanel email={CURRENT_USER_EMAIL} />
      )}

      {CURRENT_USER_EMAIL && (
        <ScheduledCommentsPanel refreshKey={scheduleRefreshKey} />
      )}
      {/* Phase 6: Siêu Tốc Cào Dữ Liệu + Bulk Comment — hiển thị cho cả 3 role
          (admin/leader/member) khi đang ở tab Facebook. SeedingActivityPanel
          vẫn chỉ admin/leader vì là panel tổng quan nhóm. */}
      {CURRENT_USER_EMAIL && feedPlatform === "facebook" && (
        <>
          <ApiExtensionLauncher
            onComplete={(totalPosts) => {
              fetchPosts();
              fetchStats();
              setCrawlResultsSummary(prev => {
                const realTotal = prev.groups.reduce((sum, g) => sum + g.count, 0);
                return { ...prev, totalPosts: realTotal > 0 ? realTotal : (totalPosts || 0) };
              });
              setShowCrawlResultModal(true);
            }}
            onCrawlSaved={(data) => {
              setCrawlResultsSummary(prev => {
                const exists = prev.groups.find(g => g.groupUrl === data.groupUrl);
                let newGroups = prev.groups;
                if (exists) {
                  newGroups = prev.groups.map(g => g.groupUrl === data.groupUrl ? { ...g, count: g.count + data.count } : g);
                } else {
                  newGroups = [...prev.groups, { groupUrl: data.groupUrl, count: data.count }];
                }
                return { ...prev, groups: newGroups };
              });
            }}
          />
          <BulkCommentLauncher
            posts={posts}
            onComplete={(seededUrls) => {
              fetchPosts();
              fetchStats();
              if (seededUrls) setRecentlySeededUrls(seededUrls);
              setShowSeedingResultModal(true);
            }}
          />
        </>
      )}

      {/* Menu doc lap theo mang dich vu (2026-07-04) — loc theo industry, xem
          ghi chu SERVICE_AREA_TABS o dau file. Tab "Lưu trú / Hotel" hien se
          rong vi he thong chua co danh muc nao thuoc mang nay - se tu dong
          co du lieu khi admin them danh muc + co bai crawl thuoc nhom do. */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-1.5">
        {SERVICE_AREA_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setServiceArea(tab.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              serviceArea === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FilterBar
        intents={intents}
        industries={industries}
        teams={teamCategories}
        tiers={tiers}
        icps={icps}
        contentTypes={contentTypes}
        productSeedings={productSeedings}
        onFilter={handleFilter}
        isLoading={isLoadingPosts}
      />

      {isLoadingPosts ? (
        <PostFeedSkeleton />
      ) : postsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {postsError}
          <button type="button" onClick={fetchPosts} className="ml-3 underline">
            Thử lại
          </button>
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          {posts.length === 0
            ? "Không có bài viết nào phù hợp với bộ lọc."
            : "Không có bài viết nào trong mảng dịch vụ này."}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {visiblePosts.map((post) => (
                <PostCard
                  key={post.id || post.post_url}
                  post={post}
                  userRole={user?.role}
                  seeded={!!post.verify_status && post.verify_status !== "no"}
                  verifyStatus={post.verify_status as "pending" | "yes" | "no"}
                  onSeeding={() => {}}
                  onVerify={() => {}}
                  onSchedule={(post) => setScheduleModalPost(post)}
                  onViewDetail={(post) => setDetailModalPost(post)}
                  onDelete={(p) => void handleDeletePost(p)}
                />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-center">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                ‹ Trước
              </button>
              <span className="w-full whitespace-nowrap text-sm text-muted-foreground sm:w-auto">
                Trang {page} / {totalPages} ({totalCount} bài)
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                Sau ›
              </button>
            </div>
          )}
        </>
      )}

      <PostDetailModal
        post={detailModalPost}
        isOpen={!!detailModalPost}
        onClose={() => setDetailModalPost(null)}
        onVerify={(post) => {
          setVerifyModalPost(post);
        }}
        verifyStatus={detailModalPost?.verify_status as any}
      />

      {verifyModalPost && (
        <VerifyAccountModal
          isOpen={!!verifyModalPost}
          onClose={() => setVerifyModalPost(null)}
          postUrl={verifyModalPost.post_url}
          postId={verifyModalPost.id}
          platform={verifyModalPost.platform}
          memberEmail={CURRENT_USER_EMAIL}
        />
      )}

      <ScheduleCommentModal
        post={scheduleModalPost}
        isOpen={!!scheduleModalPost}
        onClose={() => setScheduleModalPost(null)}
        socialAccounts={socialAccounts}
        onScheduled={() => setScheduleRefreshKey((k) => k + 1)}
      />

      {/* MODAL KẾT QUẢ CÀO */}
      {showCrawlResultModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card rounded-2xl shadow-xl w-[400px] max-w-[90vw] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-green-600 text-3xl">check_circle</span>
              </div>
              <h3 className="text-xl font-black text-foreground mb-2">Hoàn tất cào dữ liệu!</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Đã cào thành công tổng cộng <strong className="text-green-600">{crawlResultsSummary.totalPosts}</strong> bài viết mới.
              </p>

              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-md transition-all active:scale-95"
              >
                Đồng ý & Tải lại trang
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL KẾT QUẢ SEEDING */}
      {showSeedingResultModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card rounded-2xl shadow-xl w-[400px] max-w-[90vw] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-blue-600 text-3xl">task_alt</span>
              </div>
              <h3 className="text-xl font-black text-foreground mb-2">Hoàn tất Seeding!</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Tiến trình seeding comment ngầm đã kết thúc. Các bài viết đã được cập nhật trạng thái mới nhất.
              </p>
              
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-md transition-all active:scale-95"
              >
                Đồng ý & Tải lại trang
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

