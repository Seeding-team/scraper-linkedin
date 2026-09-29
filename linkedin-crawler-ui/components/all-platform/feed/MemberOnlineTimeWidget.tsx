"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { presenceService } from "@/services/all-platform.service";
import type { MemberOnlinePresence } from "@/types/unified.types";

interface MemberOnlineTimeWidgetProps {
  email: string;
}

type RangeKey = "today_minutes" | "week_minutes" | "month_minutes";
const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: "today_minutes", label: "Hôm nay" },
  { key: "week_minutes", label: "Tuần này" },
  { key: "month_minutes", label: "Tháng này" },
];

function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0 phút";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} phút`;
  if (minutes <= 0) return `${hours} giờ`;
  return `${hours} giờ ${minutes} phút`;
}

/** "Thời gian online" — Dashboard leader (Seeding bên ngoài). Dựa trên heartbeat mỗi
 * 45s gửi từ mọi trang trong app lúc tab đang hiển thị (xem AppAuthContext.tsx) —
 * độ chính xác ở mức PHÚT, không giả vờ chính xác tới giây. */
export function MemberOnlineTimeWidget({ email }: MemberOnlineTimeWidgetProps) {
  const [members, setMembers] = useState<MemberOnlinePresence[]>([]);
  const [range, setRange] = useState<RangeKey>("today_minutes");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!email) return;
    setError(null);
    try {
      const res = await presenceService.getOnlineSummary(email);
      if (res.success && res.data) {
        setMembers(res.data.members || []);
      } else {
        setError(res.message || "Không tải được thời gian online.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  useEffect(() => {
    load();
    // Tự làm mới mỗi 60s để "đang online" luôn đúng — nhẹ, chỉ 1 query gộp.
    const interval = window.setInterval(load, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const onlineCount = members.filter((m) => m.is_online).length;
  const maxMinutes = Math.max(1, ...members.map((m) => m[range]));

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <h4 className="text-sm font-bold text-foreground">Thời gian online</h4>
        {!isLoading && (
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
            {onlineCount} đang online
          </span>
        )}
        <div className="ml-auto flex gap-1 bg-muted rounded-lg p-0.5">
          {RANGE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setRange(t.key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer",
                range === t.key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 bg-muted rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="text-xs text-red-600">{error}</div>
        ) : members.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">Chưa có dữ liệu online.</div>
        ) : (
          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
            {members.map((m) => {
              const minutes = m[range];
              const pct = Math.round((minutes / maxMinutes) * 100);
              return (
                <div key={m.id_member} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      m.is_online ? "bg-emerald-500" : "bg-slate-300",
                    )}
                    title={m.is_online ? "Đang online" : "Không online"}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-foreground truncate">{m.name}</span>
                      <span className="text-xs font-bold text-foreground shrink-0">{formatDuration(minutes)}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
