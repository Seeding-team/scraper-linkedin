"use client";

import { PlatformStatCard, PlatformStatsRow } from "@/components/features/shared/PlatformStatCard";

interface AdminTeamStatsProps {
  totalMembers: number;
  totalPosts: number;
  completedKpiCount: number;
  failedKpiCount: number;
  totalKpiTarget?: number;
}

export function AdminTeamStats({
  totalMembers,
  totalPosts,
  completedKpiCount,
  failedKpiCount,
  totalKpiTarget = 0,
}: AdminTeamStatsProps) {
  return (
    <PlatformStatsRow>
      <PlatformStatCard
        label="THÀNH VIÊN"
        value={totalMembers}
        hint="Thành viên trong đội ngũ"
        accent="primary"
      />
      <PlatformStatCard
        label="SEEDING THỰC TẾ"
        value={totalPosts}
        hint={`Đã xác minh có comment`}
        accent="success"
      />
      {totalKpiTarget > 0 && (
        <PlatformStatCard
          label="KPI MỤC TIÊU"
          value={totalKpiTarget}
          hint="Tổng KPI per week"
          accent="secondary"
        />
      )}
      <PlatformStatCard
        label="ĐÃ HOÀN THÀNH KPI"
        value={completedKpiCount}
        hint={`${completedKpiCount}/${totalMembers} thành viên đạt KPI`}
        hintTone="up"
        accent="warning"
      />
      <PlatformStatCard
        label="ĐANG XỬ LÝ"
        value={failedKpiCount}
        hint={`${failedKpiCount}/${totalMembers} thành viên chưa đạt`}
        hintTone="down"
        accent="error"
      />
    </PlatformStatsRow>
  );
}



