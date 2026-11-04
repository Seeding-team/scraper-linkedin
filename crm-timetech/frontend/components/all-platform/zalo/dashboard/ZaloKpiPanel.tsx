"use client";

import { useEffect, useState } from "react";

import { MaterialIcon } from "@/components/ui";
import { allPlatformKpiService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";

interface ZaloKpiPanelProps {
  /** account_id Zalo đang chat. Panel sẽ lookup email member từ account này. */
  accountId: string;
  /** Tuỳ chọn: nếu đã biết email member thì truyền vào, tiết kiệm 1 round trip */
  memberEmail?: string;
  /** Nhỏ gọn cho header/sidebar; mặc định = true */
  compact?: boolean;
}

interface KpiSnapshot {
  target: number;
  current: number;
  range: { start: string; end: string };
  loading: boolean;
  error: string | null;
  email: string | null;
  accountIds: string[];
}

const EMPTY: KpiSnapshot = {
  target: 0,
  current: 0,
  range: { start: "", end: "" },
  loading: false,
  error: null,
  email: null,
  accountIds: [],
};

/**
 * Hiển thị progress "Tin nhắn KPI" = số tin nhắn khách gửi tới / target tuần.
 *
 * Flow:
 *   1. Lấy email member từ app_users qua current user / hoặc prop
 *   2. Gọi `getZaloInboxProgress(email)` để đếm is_sent=false trong zalo_messages
 *   3. Lấy target từ `getKpiByEmail(email)` -> kpi[0].kpi_inbox
 */
export function ZaloKpiPanel({ accountId, memberEmail, compact = true }: ZaloKpiPanelProps) {
  const { user } = useAppAuth();
  const [snap, setSnap] = useState<KpiSnapshot>(EMPTY);

  const resolvedEmail = (memberEmail || user?.email || "").trim().toLowerCase();

  useEffect(() => {
    if (!resolvedEmail) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnap({ ...EMPTY, error: "Chưa đăng nhập — không thể tải KPI." });
      return;
    }

    let cancelled = false;
    setSnap((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        // Lấy target trước để lấy chính xác start_date và end_date
        const kpiRes = await allPlatformKpiService.getByEmail(resolvedEmail);
        if (cancelled) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kpiMember = (kpiRes?.data as any) || {};
        const activeKpi = Array.isArray(kpiMember.kpi) && kpiMember.kpi.length > 0 ? kpiMember.kpi[0] : null;
        const target = activeKpi ? Number(activeKpi.kpi_inbox || 0) : 0;

        const startDate = activeKpi?.start_date || undefined;
        const endDate = activeKpi?.end_date || undefined;

        // Lấy progress dựa trên khoảng thời gian của KPI
        const progressRes = await allPlatformKpiService.getZaloInboxProgress(resolvedEmail, startDate, endDate);
        if (cancelled) return;

        const progress = progressRes?.data;

        if (!progressRes?.success) {
          setSnap({
            ...EMPTY,
            loading: false,
            error: progressRes?.message || "Không tải được progress",
            email: resolvedEmail,
          });
          return;
        }

        setSnap({
          target,
          current: Number(progress?.kpi_inbox_current || 0),
          range: progress?.range || { start: "", end: "" },
          loading: false,
          error: null,
          email: resolvedEmail,
          accountIds: progress?.account_ids || [],
        });
      } catch (err) {
        if (cancelled) return;
        setSnap({
          ...EMPTY,
          loading: false,
          error: err instanceof Error ? err.message : "Lỗi không xác định",
          email: resolvedEmail,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedEmail, accountId]);

  if (!resolvedEmail) {
    return null;
  }

  // Trạng thái loading
  if (snap.loading) {
    return (
      <div className="flex items-center gap-1.5 text-[10.5px] text-on-surface-variant">
        <MaterialIcon name="sync" className="text-[12px] animate-spin" />
        <span>Đang tải KPI…</span>
      </div>
    );
  }

  // Trạng thái lỗi — gọn, không chiếm chỗ
  if (snap.error) {
    return (
      <div
        className="flex items-center gap-1.5 text-[10.5px] text-amber-600"
        title={snap.error}
      >
        <MaterialIcon name="warning" className="text-[12px]" />
        <span>KPI lỗi</span>
      </div>
    );
  }

  // Không có target KPI inbox = 0 → ẩn (không phụ trách inbox)
  if (snap.target <= 0) {
    return null;
  }

  const percent = snap.target > 0 ? Math.min(100, Math.round((snap.current / snap.target) * 100)) : 0;
  const isOverTarget = snap.current >= snap.target;
  const isNear = percent >= 70 && !isOverTarget;

  const accent = isOverTarget
    ? "text-emerald-700"
    : isNear
      ? "text-amber-700"
      : "text-on-surface-variant";

  const progressColor = isOverTarget
    ? "bg-emerald-500"
    : isNear
      ? "bg-amber-500"
      : "bg-orange-500";

  if (compact) {
    return (
      <div
        className="flex items-center gap-2"
        title={`KPI Inbox tuần ${snap.range.start} → ${snap.range.end}: ${snap.current}/${snap.target} tin nhắn khách gửi tới`}
      >
        <div className="flex items-center gap-1 text-[10.5px]">
          <MaterialIcon name="chat" className={`text-[12px] ${accent}`} />
          <span className={`font-bold ${accent}`}>
            {snap.current}/{snap.target}
          </span>
          <span className="text-on-surface-variant">inbox</span>
        </div>
        <div className="relative w-16 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 ${progressColor} transition-all`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className={`text-[9.5px] font-bold ${accent}`}>{percent}%</span>
      </div>
    );
  }

  // Full-size (fallback nếu sau này muốn dùng)
  return (
    <div className="p-3 rounded-xl border border-orange-200 bg-orange-50/60 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-orange-800">
          <MaterialIcon name="chat" className="text-[14px]" />
          <span>Tin nhắn KPI tuần này</span>
        </div>
        <span className={`text-[11px] font-bold ${accent}`}>{percent}%</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-on-surface">{snap.current}</span>
        <span className="text-xs text-on-surface-variant">/ {snap.target} tin nhắn từ khách</span>
      </div>
      <div className="relative w-full h-2 bg-orange-100 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${progressColor} transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {snap.range.start && (
        <p className="text-[10px] text-on-surface-variant">
          {snap.range.start} → {snap.range.end} · {snap.accountIds.length} Zalo account
        </p>
      )}
    </div>
  );
}
