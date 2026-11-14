"use client";

import type { LeaderDashboardData } from "./useLeaderDashboardData";
import { MemberTable } from "./MemberTable";
import { exportActivityLogCsv } from "./exportCsv";

const KPI_PROPOSAL = [
  ["Khối lượng", "25%", "Hoạt động hợp lệ / mục tiêu đã giao"],
  ["Hiệu quả tương tác", "30%", "Tỷ lệ kết nối, phản hồi, chất lượng trao đổi"],
  ["Kết quả khách hàng", "30%", "Lead đủ điều kiện, chuyển Sales hợp lệ"],
  ["Tuân thủ quy trình", "15%", "Follow-up đúng hạn, cập nhật dữ liệu, ít tồn đọng"],
];

export function TabMembers({
  data,
  onOpenMember360,
  exportQuery,
}: {
  data: LeaderDashboardData;
  onOpenMember360: (memberId: string, memberName: string | null) => void;
  exportQuery: { date_from: string; date_to: string; platform?: string; team_id?: string; member_id?: string };
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card border border-border rounded-2xl p-5">
        <MemberTable
          rows={data.memberRows}
          isLoading={data.isLoading}
          onOpenMember360={onOpenMember360}
          onExportCsv={() => void exportActivityLogCsv(exportQuery)}
        />
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-bold">Đề xuất nguyên tắc KPI theo vai trò</h3>
          <span className="rounded-full bg-sky-50 text-sky-700 px-2.5 py-0.5 text-[11px] font-bold">Đề xuất</span>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4">Cấu hình đề xuất, chưa tích hợp công thức KPI hiện hành</p>
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground font-bold text-left bg-muted/40">
                <th className="py-2 px-3">Tiêu chí</th>
                <th className="py-2 px-3">Trọng số gợi ý</th>
                <th className="py-2 px-3">Cách đo</th>
              </tr>
            </thead>
            <tbody>
              {KPI_PROPOSAL.map((row) => (
                <tr key={row[0]} className="border-t border-border/60">
                  <td className="py-1.5 px-3 font-bold">{row[0]}</td>
                  <td className="py-1.5 px-3 font-bold">{row[1]}</td>
                  <td className="py-1.5 px-3">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
