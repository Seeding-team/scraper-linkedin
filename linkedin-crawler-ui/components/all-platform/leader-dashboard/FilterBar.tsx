"use client";

import { cn } from "@/lib/utils";
import type { LeaderDashboardFilters } from "./useLeaderDashboardFilters";
import { PLATFORM_OPTIONS, type Period } from "./shared";

export function FilterBar({ filters }: { filters: LeaderDashboardFilters }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[11px] font-extrabold tracking-wider text-muted-foreground">BỘ LỌC CHUNG</span>

        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
          {([
            ["today", "Hôm nay"],
            ["7", "7 ngày"],
            ["30", "30 ngày"],
          ] as [Period, string][]).map(([p, label]) => (
            <button
              key={p}
              type="button"
              onClick={() => filters.setPeriod(p)}
              className={cn(
                "px-2.5 py-1.5 rounded-md text-[12px] font-bold transition cursor-pointer",
                filters.period === p ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={filters.teamId || "all"}
          onChange={(e) => filters.setTeamId(e.target.value === "all" ? null : e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-medium min-w-[150px]"
          disabled={filters.isLoadingTeams}
        >
          <option value="all">Tất cả Team</option>
          {filters.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name_team}
            </option>
          ))}
        </select>

        <select
          value={filters.memberId || "all"}
          onChange={(e) => filters.setMemberId(e.target.value === "all" ? null : e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-medium min-w-[150px]"
        >
          <option value="all">Tất cả thành viên</option>
          {filters.memberOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email}
            </option>
          ))}
        </select>

        <select
          value={filters.platform || "all"}
          onChange={(e) => filters.setPlatform(e.target.value === "all" ? null : e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-medium min-w-[130px]"
        >
          <option value="all">Tất cả nền tảng</option>
          {PLATFORM_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <input
          value={filters.search}
          onChange={(e) => filters.setSearch(e.target.value)}
          placeholder="Tìm thành viên, bài viết..."
          className="h-9 rounded-lg border border-border bg-card px-3 text-[12.5px] flex-1 min-w-[180px]"
        />

        <button
          type="button"
          onClick={filters.reset}
          className="h-9 px-3 rounded-lg text-[12.5px] font-bold text-primary hover:bg-primary/5 transition cursor-pointer"
        >
          Xóa lọc
        </button>
      </div>
    </div>
  );
}
