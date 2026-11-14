import { postContactActivityService, type ActivityLogActionType } from "@/services/all-platform.service";

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function esc(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const ACTION_LABEL: Record<ActivityLogActionType, string> = {
  seed: "Seeding/Bình luận",
  call: "Gọi điện",
  zalo: "Nhắn Zalo",
};

export interface ExportCsvQuery {
  date_from: string;
  date_to: string;
  platform?: string;
  team_id?: string;
  member_id?: string;
  action_type?: ActivityLogActionType;
  search?: string;
}

/** Xuất CSV toàn bộ nhật ký hoạt động khớp bộ lọc hiện tại (lấy tối đa 2000 dòng, không phân
 * trang theo UI) — theo đúng pattern Blob/text-csv đã dùng ở các nơi khác trong app. */
export async function exportActivityLogCsv(query: ExportCsvQuery): Promise<{ count: number }> {
  const res = await postContactActivityService.getActivityLog({ ...query, page: 1, page_size: 2000 });
  const items = res.data?.items || [];
  const header = "Thời gian,Hành động,Nhân viên,Khách / Bài viết,Kết quả";
  const rows = items.map((e) =>
    [
      new Date(e.ts).toLocaleString("vi-VN"),
      ACTION_LABEL[e.action_type],
      e.member_name || "",
      e.post_label || "",
      e.result_label,
    ]
      .map((v) => esc(String(v)))
      .join(",")
  );
  const csv = "﻿" + [header, ...rows].join("\r\n");
  downloadText(`dashboard-leader-${query.date_from}_${query.date_to}.csv`, csv, "text/csv;charset=utf-8");
  return { count: items.length };
}
