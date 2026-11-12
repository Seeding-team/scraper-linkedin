"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { postCallResultService, type CallResultStats, type CallResultStatsByDay } from "@/services/all-platform.service";
import { getInitials } from "@/components/all-platform/layout/AllPlatformSidebar";

interface CallResultStatsWidgetProps {
  selectedCode: string | null;
  onSelectCode: (code: string | null) => void;
  platform?: string;
  userRole?: string;
  className?: string;
}

function MiniSparkline({ data }: { data: CallResultStatsByDay[] }) {
  const width = 300;
  const height = 36;
  const pad = 2;
  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = height - pad - (d.count / max) * (height - pad * 2);
    return `${x},${y}`;
  });
  const linePoints = points.join(" ");
  const areaPoints = `${pad},${height - pad} ${linePoints} ${width - pad},${height - pad}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-9" preserveAspectRatio="none">
      <polygon points={areaPoints} fill="var(--color-primary)" opacity={0.12} stroke="none" />
      <polyline
        points={linePoints}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CallResultStatsWidget({
  selectedCode,
  onSelectCode,
  platform,
  userRole,
  className,
}: CallResultStatsWidgetProps) {
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);
  const [stats, setStats] = useState<CallResultStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const today = new Date();
      const dateTo = today.toISOString().slice(0, 10);
      const from = new Date(today);
      from.setDate(from.getDate() - (rangeDays - 1));
      const dateFrom = from.toISOString().slice(0, 10);

      const res = await postCallResultService.getStats({
        date_from: dateFrom,
        date_to: dateTo,
        platform: platform && platform !== "all" ? platform : undefined,
        result_code: selectedCode || undefined,
      });
      if (res.success && res.data) {
        setStats(res.data);
      }
    } catch {
      // ignore — widget chỉ là bổ trợ, không chặn feed chính nếu lỗi
    } finally {
      setIsLoading(false);
    }
  }, [rangeDays, platform, selectedCode]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const canSeeMemberBreakdown = userRole === "admin" || userRole === "leader";

  return (
    <div className={cn("bg-card border border-border rounded-2xl p-5", className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">call</span>
          <h3 className="text-sm font-bold text-foreground">Kết quả liên hệ</h3>
        </div>

        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setRangeDays(d)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer",
                rangeDays === d ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {d} ngày
            </button>
          ))}
        </div>
      </div>

      {isLoading && !stats ? (
        <div className="h-[60px] flex items-center justify-center text-xs text-muted-foreground">Đang tải...</div>
      ) : !stats || stats.by_type.length === 0 ? (
        <div className="h-[60px] flex items-center justify-center text-xs text-muted-foreground">
          Chưa cấu hình danh mục Kết quả liên hệ.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {stats.by_type.map((t) => {
              const isActive = selectedCode === t.code;
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => onSelectCode(isActive ? null : t.code)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/60 text-foreground border-border hover:bg-muted"
                  )}
                >
                  <span>{t.name}</span>
                  <span className={cn("text-[11px] font-bold", isActive ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {t.count}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => onSelectCode(null)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition cursor-pointer",
                selectedCode === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/60 text-foreground border-border hover:bg-muted"
              )}
            >
              <span>Tổng</span>
              <span className={cn("text-[11px] font-bold", selectedCode === null ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {stats.total}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            Xem theo thành viên và theo ngày
            <svg
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expanded ? (
            <div className="mt-3 pt-3 border-t border-border/60 space-y-3">
              {canSeeMemberBreakdown && stats.by_member.length > 0 ? (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Theo thành viên
                  </p>
                  <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                    {stats.by_member.map((m) => (
                      <div key={m.member_id} className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex items-center justify-center w-[19px] h-[19px] rounded-full bg-primary/10 text-primary text-[9px] font-bold shrink-0 select-none">
                            {getInitials(m.name || m.email || undefined)}
                          </div>
                          <span className="text-[12px] font-medium text-foreground truncate">
                            {m.name || m.email || m.member_id}
                          </span>
                        </div>
                        <span className="text-[12px] font-semibold text-foreground shrink-0">{m.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {stats.by_day.length > 0 ? (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Theo ngày
                  </p>
                  <MiniSparkline data={stats.by_day} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
