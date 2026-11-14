"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { postContactActivityService, type ActivityLogItem } from "@/services/all-platform.service";
import type { LeaderDashboardFilters } from "./useLeaderDashboardFilters";
import type { LeaderDashboardData } from "./useLeaderDashboardData";
import type { FlatListQuery } from "./FlatListDrawer";
import { ActivityFlatTable } from "./ActivityFlatTable";
import { BAD_CALL_CODES, OK_CALL_CODES, pct } from "./shared";

/** Tab "Kết quả liên hệ" của Dashboard Leader: chi tiết gọi điện + Zalo theo bộ lọc chung (kỳ/
 * Team/thành viên/nền tảng/tìm kiếm). Bảng "Theo thành viên"/"Theo ngày" đã có đủ ở tab Tổng
 * quan (MemberTable) + biểu đồ xu hướng — tab này tập trung vào phần RIÊNG: chi tiết 8 mã kết
 * quả gọi + nhật ký gộp Gọi điện/Zalo (không gồm seeding — đã có tab Comment). */
export function TabContactResults({
  filters,
  data,
  onOpenFlatList,
}: {
  filters: LeaderDashboardFilters;
  data: LeaderDashboardData;
  onOpenFlatList: (title: string, query: FlatListQuery) => void;
}) {
  const [logItems, setLogItems] = useState<ActivityLogItem[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const PAGE_SIZE = 10;

  const common = useMemo(
    () => ({
      date_from: filters.date_from, date_to: filters.date_to,
      platform: filters.platform || undefined, team_id: filters.teamId || undefined, member_id: filters.memberId || undefined,
      search: filters.search || undefined,
    }),
    [filters.date_from, filters.date_to, filters.platform, filters.teamId, filters.memberId, filters.search]
  );

  useEffect(() => {
    setLogPage(1);
  }, [common]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingLog(true);
    Promise.all([
      postContactActivityService.getActivityLog({ ...common, action_type: "call", page: 1, page_size: 500 }),
      postContactActivityService.getActivityLog({ ...common, action_type: "zalo", page: 1, page_size: 500 }),
    ])
      .then(([callRes, zaloRes]) => {
        if (cancelled) return;
        const merged = [...(callRes.data?.items || []), ...(zaloRes.data?.items || [])].sort(
          (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
        );
        setLogTotal(merged.length);
        setLogItems(merged.slice((logPage - 1) * PAGE_SIZE, logPage * PAGE_SIZE));
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [common, logPage]);

  const logTotalPages = Math.max(1, Math.ceil(logTotal / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-[18px] text-primary">call</span>
          <h3 className="text-sm font-bold">Kết quả liên hệ</h3>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4">
          {filters.period === "today" ? "hôm nay" : filters.period === "7" ? "7 ngày qua" : "30 ngày qua"} · gọi điện và nhắn Zalo
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 border border-border rounded-xl overflow-hidden mb-4">
          <div className="p-4 border-b sm:border-b-0 sm:border-r border-border">
            <div className="text-[12px] font-semibold text-muted-foreground mb-1">Cuộc gọi</div>
            <div className="text-[24px] font-extrabold">{data.callTotal}</div>
          </div>
          <div className="p-4 border-b sm:border-b-0 sm:border-r border-border">
            <div className="text-[12px] font-semibold text-muted-foreground mb-1">Thành công / thất bại</div>
            <div className="text-[24px] font-extrabold">{pct(data.callOk, data.callTotal)}%</div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-muted my-1.5">
              <span className="bg-emerald-500" style={{ width: `${pct(data.callOk, data.callTotal)}%` }} />
              <span className="bg-rose-400" style={{ width: `${pct(data.callBad, data.callTotal)}%` }} />
            </div>
            <div className="flex gap-3 text-[12px] font-bold">
              <span className="text-emerald-600">{data.callOk} thành công</span>
              <span className="text-rose-600">{data.callBad} thất bại</span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-[12px] font-semibold text-muted-foreground mb-1">Tin Zalo đã gửi</div>
            <div className="text-[24px] font-extrabold">{data.zaloStats?.sent ?? 0}</div>
            <div className="text-[12px] text-muted-foreground">
              {data.zaloStats?.replied ?? 0} khách đã trả lời ({pct(data.zaloStats?.replied || 0, data.zaloStats?.sent || 0)}%)
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([
            ["ok", "THÀNH CÔNG", "text-emerald-600", OK_CALL_CODES],
            ["bad", "THẤT BẠI", "text-rose-600", BAD_CALL_CODES],
          ] as const).map(([grp, label, colorClass, codeSet]) => (
            <div key={grp}>
              <div className={cn("text-[11px] font-extrabold tracking-wide mb-1.5", colorClass)}>{label}</div>
              <div className="flex flex-wrap gap-1.5">
                {(data.callStats?.by_type || [])
                  .filter((t) => codeSet.has(t.code))
                  .map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() =>
                        onOpenFlatList(t.name, { ...common, action_type: "call", result_code: t.code })
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border border-border h-7 pl-2.5 pr-1 text-[12px] font-semibold hover:bg-muted transition cursor-pointer"
                    >
                      <span>{t.name}</span>
                      <span
                        className={cn(
                          "min-w-[20px] h-5 rounded-full grid place-items-center text-[11px] font-bold",
                          grp === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                        )}
                      >
                        {t.count}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="text-[12.5px] font-bold mb-3">Nhật ký Gọi điện &amp; Nhắn Zalo</div>
        <ActivityFlatTable items={logItems} isLoading={isLoadingLog} />
        {logTotal > 0 && (
          <div className="flex items-center justify-between gap-2 pt-3 text-[12px] text-muted-foreground">
            <span>
              Trang {logPage}/{logTotalPages} · {logTotal} bản ghi
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={logPage <= 1}
                onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                className="h-7 px-2.5 rounded-md border border-border text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted cursor-pointer"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={logPage >= logTotalPages}
                onClick={() => setLogPage((p) => Math.min(logTotalPages, p + 1))}
                className="h-7 px-2.5 rounded-md border border-border text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted cursor-pointer"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        <b>Thành công</b> = nói chuyện được với khách (Có nhu cầu, Đang tư vấn, Hẹn gọi lại, Chờ phản hồi).{" "}
        <b>Thất bại</b> = Không nghe máy, Từ chối, Không có nhu cầu, Không phù hợp.
      </p>
    </div>
  );
}
