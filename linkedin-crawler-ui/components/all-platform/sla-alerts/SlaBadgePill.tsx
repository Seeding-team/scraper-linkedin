"use client";

import React from "react";
import { AlertTriangle, Clock, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDurationVi,
  formatShortWaitBadge,
  type LiveSlaBadge,
  type SlaLiveState,
} from "@/types/sla-alerts";

export interface SlaBadgePillProps {
  badge?: LiveSlaBadge | null;
  state?: SlaLiveState | null;
  waitSeconds?: number | null;
  targetSeconds?: number | null;
  unansweredCount?: number | null;
  /** Compact mode for tight conversation cards inside Zalo / Omnichannel Inbox */
  compact?: boolean;
  /** Show text label ("Chờ" / "Sắp hạn" / "Quá hạn") alongside elapsed time */
  showLabel?: boolean;
  className?: string;
}

export function SlaBadgePill({
  badge,
  state: stateProp,
  waitSeconds: waitProp,
  targetSeconds: targetProp,
  unansweredCount: unansweredProp,
  compact = false,
  showLabel = true,
  className,
}: SlaBadgePillProps) {
  const effectiveState: SlaLiveState =
    stateProp ?? badge?.state ?? badge?.live_state ?? "ok";

  const effectiveWait =
    waitProp ??
    badge?.wait_business_seconds ??
    badge?.current_wait_business_seconds ??
    0;

  const effectiveTarget = targetProp ?? badge?.target_seconds ?? 300;
  const effectiveUnanswered = unansweredProp ?? badge?.unanswered_msg_count ?? 1;

  if (!badge && stateProp == null && waitProp == null) {
    return null;
  }

  const timeText = compact
    ? formatShortWaitBadge(effectiveWait)
    : formatDurationVi(effectiveWait);

  const tooltip = [
    effectiveState === "breached"
      ? "Đã quá hạn SLA"
      : effectiveState === "warning"
        ? "Sắp đến hạn SLA"
        : "Đang chờ phản hồi trong hạn SLA",
    `Thời gian chờ (giờ LV): ${formatDurationVi(effectiveWait)}`,
    `Mục tiêu SLA: ${formatDurationVi(effectiveTarget)}`,
    effectiveUnanswered > 1 ? `${effectiveUnanswered} tin khách chưa trả lời` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (effectiveState === "breached") {
    return (
      <span
        title={tooltip}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-300 bg-rose-50 font-bold text-rose-700 shadow-2xs",
          compact ? "px-1.5 py-0.5 text-[9.5px] leading-none" : "px-2.5 py-1 text-xs",
          className,
        )}
      >
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-600" />
        </span>
        {!compact && <Flame className="h-3 w-3 shrink-0 text-rose-600" />}
        <span className="tabular-nums whitespace-nowrap">
          {showLabel ? (compact ? `Quá ${timeText}` : `Quá hạn · ${timeText}`) : timeText}
        </span>
      </span>
    );
  }

  if (effectiveState === "warning") {
    return (
      <span
        title={tooltip}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 font-bold text-amber-800",
          compact ? "px-1.5 py-0.5 text-[9.5px] leading-none" : "px-2.5 py-1 text-xs",
          className,
        )}
      >
        <AlertTriangle className={cn("shrink-0 text-amber-600", compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
        <span className="tabular-nums whitespace-nowrap">
          {showLabel ? (compact ? `Sắp hạn ${timeText}` : `Sắp hạn · ${timeText}`) : timeText}
        </span>
      </span>
    );
  }

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-[#10a39c]/30 bg-[#10a39c]/10 font-semibold text-[#0d7f79]",
        compact ? "px-1.5 py-0.5 text-[9.5px] leading-none" : "px-2.5 py-1 text-xs",
        className,
      )}
    >
      <Clock className={cn("shrink-0 text-[#10a39c]", compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
      <span className="tabular-nums whitespace-nowrap">
        {showLabel ? (compact ? `Chờ ${timeText}` : `Đang chờ · ${timeText}`) : timeText}
      </span>
    </span>
  );
}
