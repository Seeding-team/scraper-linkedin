"use client";

import { cn } from "@/lib/utils";

export type ZaloKpiVisualStatus = "confirmed" | "waiting_reply" | "inbound_pending" | "locked_30d";

interface BadgeSpec {
  label: string;
  compactLabel: string;
  className: string;
  title: string;
}

const BADGE_MAP: Record<ZaloKpiVisualStatus, BadgeSpec> = {
  confirmed: {
    label: "✓ Khách đã rep · Đã tính +1 KPI",
    compactLabel: "✓ +1 KPI",
    className: "bg-emerald-600 text-white border-emerald-700/40",
    title: "Hội thoại Zalo đã có tương tác 2 chiều hoặc được duyệt — đã cộng vào KPI tuần",
  },
  waiting_reply: {
    label: "⏳ Chờ khách rep để tính +1 KPI",
    compactLabel: "⏳ Chờ rep",
    className: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300",
    title: "Đã gửi tin Zalo mở đầu; hệ thống sẽ tự động +1 KPI ngay khi khách trả lời",
  },
  inbound_pending: {
    label: "💬 Khách nhắn Zalo · Chờ nhân viên rep",
    compactLabel: "💬 Khách nhắn",
    className: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300",
    title: "Khách đã chủ động nhắn Zalo (khớp từ Post Feed); nhân viên phản hồi sẽ được +1 KPI",
  },
  locked_30d: {
    label: "🔒 SĐT đã tính KPI (30 ngày)",
    compactLabel: "🔒 Khóa 30d",
    className: "bg-slate-200 text-slate-700 border-slate-300/70 dark:bg-slate-800 dark:text-slate-300",
    title: "Số điện thoại / hội thoại này đã được tính KPI trong 30 ngày gần nhất nên không tính trùng",
  },
};

export function resolveZaloKpiVisualStatus(
  kpiStatus?: string | null,
  zaloStatus?: string | null,
): ZaloKpiVisualStatus | null {
  if (kpiStatus && kpiStatus in BADGE_MAP) {
    return kpiStatus as ZaloKpiVisualStatus;
  }
  if (zaloStatus === "sent") {
    return "waiting_reply";
  }
  return null;
}

export function ZaloKpiStatusBadge({
  kpiStatus,
  zaloStatus,
  compact = false,
  className,
}: {
  kpiStatus?: string | null;
  zaloStatus?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const resolved = resolveZaloKpiVisualStatus(kpiStatus, zaloStatus);
  if (!resolved) return null;
  const spec = BADGE_MAP[resolved];
  return (
    <span
      title={spec.title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-bold shadow-2xs",
        compact ? "px-2 py-0.2 text-[9px]" : "px-2.5 py-0.5 text-[11px]",
        spec.className,
        className,
      )}
    >
      {compact ? spec.compactLabel : spec.label}
    </span>
  );
}
