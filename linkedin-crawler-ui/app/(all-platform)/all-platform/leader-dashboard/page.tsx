"use client";

import { useState } from "react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { MemberOnlineTimeWidget } from "@/components/all-platform/feed/MemberOnlineTimeWidget";
import { FilterBar } from "@/components/all-platform/leader-dashboard/FilterBar";
import { KpiCardGrid } from "@/components/all-platform/leader-dashboard/KpiCardGrid";
import { TabOverview } from "@/components/all-platform/leader-dashboard/TabOverview";
import { TabContactResults } from "@/components/all-platform/leader-dashboard/TabContactResults";
import { TabMessages } from "@/components/all-platform/leader-dashboard/TabMessages";
import { TabComments } from "@/components/all-platform/leader-dashboard/TabComments";
import { TabMembers } from "@/components/all-platform/leader-dashboard/TabMembers";
import { FlatListDrawer, type FlatListQuery } from "@/components/all-platform/leader-dashboard/FlatListDrawer";
import { Member360Drawer } from "@/components/all-platform/leader-dashboard/Member360Drawer";
import { useLeaderDashboardFilters } from "@/components/all-platform/leader-dashboard/useLeaderDashboardFilters";
import { useLeaderDashboardData } from "@/components/all-platform/leader-dashboard/useLeaderDashboardData";
import { exportActivityLogCsv } from "@/components/all-platform/leader-dashboard/exportCsv";
import { PERIOD_LABEL } from "@/components/all-platform/leader-dashboard/shared";

type Tab = "overview" | "contact" | "messages" | "comments" | "members";

const TABS: [Tab, string][] = [
  ["overview", "Tổng quan"],
  ["contact", "Kết quả liên hệ"],
  ["messages", "Tin nhắn"],
  ["comments", "Comment"],
  ["members", "Thành viên"],
];

export default function LeaderDashboardPage() {
  const { user } = useAppAuth();
  const isLeaderOrAdmin = user?.role === "admin" || user?.role === "leader";

  const filters = useLeaderDashboardFilters(user?.id, user?.role);
  const data = useLeaderDashboardData(filters);

  const [tab, setTab] = useState<Tab>("overview");
  const [flatList, setFlatList] = useState<{ open: boolean; title: string; query: FlatListQuery | null }>({
    open: false, title: "", query: null,
  });
  const [member360, setMember360] = useState<{ open: boolean; memberId: string | null; memberName: string | null }>({
    open: false, memberId: null, memberName: null,
  });

  const openFlatList = (title: string, query: FlatListQuery) => setFlatList({ open: true, title, query });
  const openMember360 = (memberId: string, memberName: string | null) =>
    setMember360({ open: true, memberId, memberName });

  const exportQuery = {
    date_from: filters.date_from, date_to: filters.date_to,
    platform: filters.platform || undefined, team_id: filters.teamId || undefined, member_id: filters.memberId || undefined,
    search: filters.search || undefined,
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[24px] text-[#be123c] mt-0.5">bolt</span>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Dashboard Leader</h1>
            <p className="text-xs text-gray-500 mt-1 font-medium">
              Giám sát hiệu suất Team: cuộc gọi, tin Zalo, comment và khách cần chăm sóc. Bấm vào số liệu để xem chi tiết.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Đang hoạt động
          </span>
          <button
            type="button"
            onClick={() => void exportActivityLogCsv(exportQuery)}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-[12.5px] font-bold hover:opacity-90 transition cursor-pointer inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Xuất báo cáo CSV
          </button>
        </div>
      </div>

      {!isLeaderOrAdmin ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-500 shadow-xs">
          <span className="material-symbols-outlined text-[48px] text-gray-300 block mb-2">shield_person</span>
          <p className="font-semibold text-sm text-gray-700">Dữ liệu Dashboard Leader chỉ dành cho Leader và Quản trị viên.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <FilterBar filters={filters} />

          <div className="bg-card border border-border rounded-2xl p-5">
            <KpiCardGrid
              data={data}
              period={filters.period}
              dateFrom={filters.date_from}
              dateTo={filters.date_to}
              platform={filters.platform}
              teamId={filters.teamId}
              memberId={filters.memberId}
              search={filters.search}
              onOpenDrawer={openFlatList}
            />
          </div>

          <div className="bg-card border border-border rounded-2xl p-1.5">
            <div className="flex gap-1 overflow-x-auto">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-3.5 py-2 rounded-xl text-[13px] font-bold whitespace-nowrap transition cursor-pointer ${
                    tab === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {tab === "overview" && (
            <TabOverview filters={filters} data={data} onOpenFlatList={openFlatList} onOpenMember360={openMember360} />
          )}
          {tab === "contact" && (
            <TabContactResults filters={filters} data={data} onOpenFlatList={openFlatList} />
          )}
          {tab === "messages" && <TabMessages filters={filters} data={data} onOpenFlatList={openFlatList} />}
          {tab === "comments" && <TabComments filters={filters} data={data} />}
          {tab === "members" && <TabMembers data={data} onOpenMember360={openMember360} exportQuery={exportQuery} />}

          <p className="text-[11px] text-muted-foreground text-center">
            Dữ liệu thật từ hệ thống — seeding/bình luận được tính chung 1 hành động (không tách
            &quot;lỗi đăng&quot;/&quot;khách đã phản hồi&quot;); &quot;quá hạn&quot; suy ra theo
            thời gian, chưa có lịch hẹn gọi lại cụ thể trong hệ thống.
          </p>

          <MemberOnlineTimeWidget email={user?.email || ""} />
        </div>
      )}

      <FlatListDrawer
        open={flatList.open}
        onOpenChange={(open) => setFlatList((s) => ({ ...s, open }))}
        title={flatList.title}
        subtitle={PERIOD_LABEL[filters.period]}
        query={flatList.query}
      />
      <Member360Drawer
        open={member360.open}
        onOpenChange={(open) => setMember360((s) => ({ ...s, open }))}
        memberId={member360.memberId}
        memberName={member360.memberName}
        dateFrom={filters.date_from}
        dateTo={filters.date_to}
        platform={filters.platform}
        periodLabel={PERIOD_LABEL[filters.period]}
      />
    </div>
  );
}
