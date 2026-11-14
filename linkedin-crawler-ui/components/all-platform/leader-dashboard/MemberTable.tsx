"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/components/all-platform/layout/AllPlatformSidebar";
import type { MemberTableRow } from "./useLeaderDashboardData";
import { pct } from "./shared";

type SortKey = "calls" | "rate" | "comments" | "leads";

const SORT_OPTIONS: [SortKey, string][] = [
  ["calls", "Sắp xếp: lượt gọi"],
  ["rate", "Sắp xếp: tỷ lệ gọi"],
  ["comments", "Sắp xếp: comment"],
  ["leads", "Sắp xếp: lead"],
];

const SORT_FN: Record<SortKey, (r: MemberTableRow) => number> = {
  calls: (r) => r.call,
  rate: (r) => pct(r.call_ok, r.call),
  comments: (r) => r.seed,
  leads: (r) => r.lead,
};

export function MemberTable({
  rows,
  isLoading,
  onOpenMember360,
  onExportCsv,
}: {
  rows: MemberTableRow[];
  isLoading?: boolean;
  onOpenMember360: (memberId: string, memberName: string | null) => void;
  onExportCsv?: () => void;
}) {
  const [sort, setSort] = useState<SortKey>("calls");

  const sortedRows = useMemo(() => [...rows].sort((a, b) => SORT_FN[sort](b) - SORT_FN[sort](a)), [rows, sort]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">groups</span>
          <h3 className="text-sm font-bold">Hiệu quả từng thành viên</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-[12px] font-medium"
          >
            {SORT_OPTIONS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          {onExportCsv && (
            <button
              type="button"
              onClick={onExportCsv}
              className="h-8 px-2.5 rounded-lg border border-border text-[12px] font-bold hover:bg-muted transition cursor-pointer inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[15px]">download</span>
              Xuất CSV
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-muted-foreground font-bold text-left bg-muted/40">
              <th className="py-2 px-3">Thành viên</th>
              <th className="py-2 px-3 text-right">Gọi TC / tổng</th>
              <th className="py-2 px-3 text-right">Tỷ lệ</th>
              <th className="py-2 px-3 text-right">Zalo phản hồi / gửi</th>
              <th className="py-2 px-3 text-right">Comment</th>
              <th className="py-2 px-3 text-right">Lead</th>
              <th className="py-2 px-3 text-right">Quá hạn</th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-muted-foreground">
                  Đang tải...
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-muted-foreground">
                  Không có thành viên phù hợp
                </td>
              </tr>
            ) : (
              sortedRows.map((r) => {
                const rate = pct(r.call_ok, r.call);
                return (
                  <tr key={r.member_id} className="border-t border-border/60">
                    <td className="py-1.5 px-3">
                      <button
                        type="button"
                        onClick={() => onOpenMember360(r.member_id, r.name || r.email)}
                        className="flex items-center gap-2 text-left hover:underline cursor-pointer"
                      >
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                          {getInitials(r.name || r.email || r.member_id)}
                        </span>
                        {r.name || r.email || r.member_id}
                      </button>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {r.call_ok} / {r.call}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <b className={cn(rate >= 50 && "text-emerald-600")}>{rate}%</b>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {r.zalo_replied} / {r.zalo}
                    </td>
                    <td className="py-1.5 px-3 text-right">{r.seed}</td>
                    <td className="py-1.5 px-3 text-right">
                      <b className="text-emerald-600">{r.lead}</b>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <b className={cn(r.overdue > 0 && "text-rose-600")}>{r.overdue}</b>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenMember360(r.member_id, r.name || r.email)}
                        className="h-7 px-2.5 rounded-lg border border-border text-[11.5px] font-bold hover:bg-muted transition cursor-pointer whitespace-nowrap"
                      >
                        Member 360 →
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        So sánh năng suất cần theo vai trò và mục tiêu được giao; số lượng không đủ để kết luận chất lượng.
      </p>
    </div>
  );
}
