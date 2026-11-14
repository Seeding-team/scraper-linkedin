"use client";

import { cn } from "@/lib/utils";
import type { ActivityLogActionType, ActivityLogItem } from "@/services/all-platform.service";

const ACTION_META: Record<ActivityLogActionType, { label: string; badge: string }> = {
  seed: { label: "Seeding/Bình luận", badge: "bg-violet-50 text-violet-700 border-violet-200" },
  call: { label: "Gọi điện", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  zalo: { label: "Nhắn Zalo", badge: "bg-sky-50 text-sky-700 border-sky-200" },
};

export function ActivityFlatTable({
  items,
  isLoading,
  showActionColumn = true,
}: {
  items: ActivityLogItem[];
  isLoading?: boolean;
  /** Tắt cột "Hành động" khi bảng đã được lọc cố định theo 1 loại (vd trong Member 360). */
  showActionColumn?: boolean;
}) {
  return (
    <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-border rounded-lg">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground font-bold text-left sticky top-0 bg-card">
            <th className="py-2 px-2.5">Thời gian</th>
            <th className="py-2 px-2.5">Nhân viên</th>
            {showActionColumn && <th className="py-2 px-2.5">Hành động</th>}
            <th className="py-2 px-2.5">Khách / Bài viết</th>
            <th className="py-2 px-2.5">Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={showActionColumn ? 5 : 4} className="py-6 text-center text-muted-foreground">
                Đang tải...
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={showActionColumn ? 5 : 4} className="py-6 text-center text-muted-foreground">
                Không có bản ghi
              </td>
            </tr>
          ) : (
            items.map((item, idx) => (
              <tr key={`${item.ts}-${idx}`} className="border-t border-border/60">
                <td className="py-1.5 px-2.5 whitespace-nowrap">{new Date(item.ts).toLocaleString("vi-VN")}</td>
                <td className="py-1.5 px-2.5 whitespace-nowrap">{item.member_name || "—"}</td>
                {showActionColumn && (
                  <td className="py-1.5 px-2.5 whitespace-nowrap">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
                        ACTION_META[item.action_type].badge
                      )}
                    >
                      {ACTION_META[item.action_type].label}
                    </span>
                  </td>
                )}
                <td className="py-1.5 px-2.5 max-w-[220px] truncate" title={item.post_label || undefined}>
                  {item.post_label || "—"}
                </td>
                <td className="py-1.5 px-2.5">{item.result_label}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {items.length >= 100 && (
        <p className="text-[11px] text-muted-foreground px-2.5 py-2 border-t border-border">
          Hiển thị 100 bản ghi gần nhất.
        </p>
      )}
    </div>
  );
}
