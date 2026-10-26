"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { allPlatformKpiService, allPlatformSeedingService } from "@/services/all-platform.service";

/** ─── KPI Type definitions ─────────────────────────────────────────────── */
export type KpiType = "comment" | "post" | "inbox" | "lead";

interface KpiProgressData {
  target: number;
  current: number;
  startDate?: string;
  endDate?: string;
}

interface KpiProgressCardProps {
  /** Email của member cần hiển thị KPI */
  email: string;
  /** Loại KPI muốn hiển thị */
  type: KpiType;
  /** Icon hiển thị trên header */
  icon?: MaterialSymbolName;
  /** Nhãn tiêu đề */
  label?: string;
  /** Tự truyền data thay vì tự động fetch (để parent kiểm soát) */
  data?: KpiProgressData;
  /** Class tùy chỉnh wrapper */
  className?: string;
  /** Có hiện animation không */
  animated?: boolean;
  /** Tự fetch không? Mặc định true */
  autoFetch?: boolean;
  /** Callback khi refetch được gọi (sau khi assign KPI thành công) */
  onRefresh?: () => void;
}

/** ─── Label & icon config ─────────────────────────────────────────────── */
const KPI_CONFIG: Record<KpiType, { title: string; subtitle: string; unit: string }> = {
  comment: { title: "TIẾN ĐỘ HOÀN THÀNH KPI COMMENT TUẦN NÀY", subtitle: "KPI được tính dựa trên số lượng comment seeding thành công", unit: "comment" },
  post:    { title: "TIẾN ĐỘ HOÀN THÀNH KPI ĐĂNG BÀI TUẦN NÀY", subtitle: "KPI được tính dựa trên số lượng bài đăng thành công lưu nhận trong bảng fb_post_kpi",  unit: "bài đăng" },
  inbox:   { title: "TIẾN ĐỘ HOÀN THÀNH KPI INBOX TUẦN NÀY", subtitle: "KPI được tính dựa trên số lượng tài khoản inbox thành công", unit: "inbox" },
  lead:    { title: "TIẾN ĐỘ HOÀN THÀNH KPI LEAD TUẦN NÀY", subtitle: "KPI được tính dựa trên số lượng khách hàng tiềm năng mang về", unit: "lead" },
};

/** ─── Fetch KPI data helper ───────────────────────────────────────────── */
/**
 * Combines data from:
 *   - GET_BY_EMAIL  → KPI targets (kpi_comment, kpi_post, kpi_inbox, kpi_lead) + inbox progress
 *   - GET_FB_POST_KPI_SUMMARY → FB post actuals (post_count)
 *
 * Note: "verified_count" (seeding actual) and lead actuals live in seeding_stats
 * which is not returned by GET_BY_EMAIL — those use 0 for now as proxy.
 */
async function fetchKpiData(
  email: string,
  type: KpiType,
): Promise<KpiProgressData | null> {
  try {
    const [kpiRes] = await Promise.all([
      allPlatformKpiService.getByEmail(email),
    ]);
    if (!kpiRes?.success) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kpiData = (kpiRes.data as any) || {};
    const activeKpi: Record<string, unknown> | null =
      Array.isArray(kpiData.kpi) && kpiData.kpi.length > 0 ? kpiData.kpi[0] : null;

    if (!activeKpi) return null;

    const startDate = (activeKpi.start_date || activeKpi.start_day || undefined) as string | undefined;
    const endDate   = (activeKpi.end_date   || activeKpi.end_day   || undefined) as string | undefined;

    let target = 0;
    let current = 0;

    if (type === "comment") {
      target  = Number(activeKpi.kpi_comment || 0);
      if (target > 0 && startDate && endDate) {
        try {
          const commentRes = await allPlatformSeedingService.getActualCount({
            email_member: email,
            date_from: startDate,
            date_to: endDate,
            platform: "facebook"
          });
          if (commentRes?.success && commentRes.data) {
            current = Number(commentRes.data.verified_count || 0);
          }
        } catch { /* ignore */ }
      }
    } else if (type === "post") {
      target  = Number(activeKpi.kpi_post || 0);
      // actual FB posts posted in KPI period → call getFbPostKpiSummary
      if (target > 0 && startDate && endDate) {
        try {
          const postRes = await allPlatformKpiService.getFbPostKpiSummary(email, startDate, endDate);
          if (postRes?.success && postRes.data) {
            current = Number((postRes.data as { post_count: number }).post_count || 0);
          }
        } catch { /* ignore */ }
      }
    } else if (type === "inbox") {
      target  = Number(activeKpi.kpi_inbox || 0);
      current = Number(kpiData.kpi_inbox_current || 0);
    } else if (type === "lead") {
      target  = Number(activeKpi.kpi_lead || 0);
      current = 0; // lead actual requires separate seeding_stats fetch
    }

    return { target, current, startDate, endDate };
  } catch {
    return null;
  }
}

/** ─── Progress bar color logic ─────────────────────────────────────────── */
function getProgressColor(percent: number): { bar: string; text: string; bg: string } {
  if (percent >= 100) return { bar: "bg-green-500",  text: "text-green-700", bg: "bg-green-50"  };
  if (percent >= 80)  return { bar: "bg-blue-500",   text: "text-blue-700",  bg: "bg-blue-50"   };
  if (percent >= 50)  return { bar: "bg-amber-500",   text: "text-amber-700", bg: "bg-amber-50"  };
  return                       { bar: "bg-primary",    text: "text-primary",   bg: "bg-red-50"    };
}

/** ─── Skeleton loading ─────────────────────────────────────────────── */
function KpiProgressSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card shadow-[0_2px_10px_rgba(0,0,0,0.02)] p-5 animate-pulse mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="w-64 h-4 rounded bg-muted" />
          <div className="w-96 h-3 rounded bg-muted mt-2" />
        </div>
        <div className="w-32 h-8 rounded-xl bg-muted" />
      </div>
      <div className="w-full h-2.5 rounded-full bg-muted" />
    </div>
  );
}

/** ─── Main Component ────────────────────────────────────────────────── */
export function KpiProgressCard({
  email,
  type,
  icon,
  label,
  data,
  className,
  animated = true,
  autoFetch = true,
  onRefresh,
}: KpiProgressCardProps) {
  const cfg = KPI_CONFIG[type];
  const displayTitle = label || cfg.title;

  const [snap, setSnap] = useState<{
    target: number;
    current: number;
    startDate?: string;
    endDate?: string;
    loading: boolean;
    error: string | null;
  }>({ target: 0, current: 0, loading: autoFetch && !data, error: null });

  const doFetch = useCallback(async () => {
    if (!email) return;
    setSnap(prev => ({ ...prev, loading: true, error: null }));
    try {
      const result = await fetchKpiData(email, type);
      if (!result) {
        setSnap({ target: 0, current: 0, loading: false, error: "Chưa có KPI tuần này" });
      } else {
        setSnap({ ...result, loading: false, error: null });
      }
    } catch (err) {
      setSnap(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Lỗi tải KPI",
      }));
    }
  }, [email, type]);

  useEffect(() => {
    if (autoFetch && !data) {
      void doFetch();
    } else if (data) {
      setSnap({ ...data, loading: false, error: null });
    }
  }, [autoFetch, data, doFetch]);

  // Refresh when parent signals
  useEffect(() => {
    if (onRefresh) {
      void doFetch();
    }
  }, [onRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  if (snap.loading) {
    return <KpiProgressSkeleton />;
  }

  if (snap.target <= 0 || snap.error === "Chưa có KPI tuần này") {
    return null;
  }

  const percent = Math.min(100, Math.round((snap.current / snap.target) * 100));
  const colors = getProgressColor(percent);

  return (
    <div className={cn("bg-card p-5 rounded-xl border border-border shadow-[0_2px_10px_rgba(0,0,0,0.02)]", className)}>
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0 pr-0 xl:pr-4">
          <h3 className="text-[13px] font-bold text-[#1E293B] uppercase break-words">
            {displayTitle}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {cfg.subtitle}
          </p>
          {(snap.startDate || snap.endDate) && (
            <p className="text-[10px] text-muted-foreground mt-1 font-medium">
              Tuần: {snap.startDate} → {snap.endDate}
            </p>
          )}
        </div>
        <div className={cn("px-3 py-1.5 rounded-xl flex items-baseline gap-1.5 shrink-0 whitespace-nowrap self-start xl:self-center", colors.bg)}>
          <span className={cn("text-lg font-black", colors.text)}>
            {snap.current.toLocaleString("vi-VN")}
          </span>
          <span className="text-[11px] text-muted-foreground font-medium">
            / {snap.target} {cfg.unit}
          </span>
          <span className={cn("text-xs font-bold ml-1", colors.text)}>
            ({percent}%)
          </span>
        </div>
      </div>

      <div className="w-full h-2.5 rounded-full overflow-hidden bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000 ease-out",
            colors.bar,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Compact version: inline bar + label (for header / stats row) ──── */
interface KpiProgressCompactProps {
  email: string;
  type: KpiType;
  icon?: MaterialSymbolName;
  label?: string;
  className?: string;
}

export function KpiProgressCompact({
  email,
  type,
  icon,
  label,
  className,
}: KpiProgressCompactProps) {
  const cfg = KPI_CONFIG[type];
  const [snap, setSnap] = useState<{ target: number; current: number; loading: boolean }>({
    target: 0, current: 0, loading: true,
  });

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    setSnap(prev => ({ ...prev, loading: true }));
    void (async () => {
      const result = await fetchKpiData(email, type);
      if (!cancelled) {
        setSnap(result ? { ...result, loading: false } : { target: 0, current: 0, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [email, type]);

  if (snap.loading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="w-4 h-4 rounded bg-muted animate-pulse" />
        <div className="h-1.5 w-16 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (snap.target <= 0) return null;

  const percent = Math.min(100, Math.round((snap.current / snap.target) * 100));
  const colors = getProgressColor(percent);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {icon && (
        <MaterialIcon name={icon as MaterialSymbolName} className={cn("text-[14px]", colors.text)} />
      )}
      <div className="flex items-center gap-1 text-[11px] font-bold">
        <span className={colors.text}>{snap.current}/{snap.target}</span>
        {label && <span className="text-muted-foreground font-medium">{label}</span>}
      </div>
      <div className="relative w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", colors.bar)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cn("text-[10px] font-black tabular-nums", colors.text)}>{percent}%</span>
    </div>
  );
}
