"use client";

import type { AdminKpiPerformanceData } from "@/services/all-platform.service";

interface AdminKpiPerformanceChartProps {
  data: AdminKpiPerformanceData[];
  isLoading: boolean;
}

export function AdminKpiPerformanceChart({
  data,
  isLoading,
}: AdminKpiPerformanceChartProps) {
  if (isLoading) {
    return (
      <div className="bg-surface p-6 rounded-xl border border-outline-variant min-h-[360px] flex flex-col items-center justify-center gap-2">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-on-surface-variant font-semibold">
          Đang tải biểu đồ hiệu suất...
        </span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-surface p-6 rounded-xl border border-outline-variant min-h-[360px] flex flex-col items-center justify-center text-on-surface-variant text-sm italic">
        Chưa có dữ liệu hiệu suất KPI của các Team.
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map((d) => Math.max(d.target, d.actual)),
    10,
  );

  return (
    <div className="rounded-xl border border-outline-variant bg-surface overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-outline-variant px-5 py-4">
        <div>
          <h3 className="text-base font-bold text-on-surface">
            Hiệu suất KPI các Team
          </h3>

          <p className="text-xs text-on-surface-variant font-medium">
            So sánh tiến độ thực tế đạt được với chỉ tiêu giao trong tuần
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-bold shrink-0">
          <div className="flex items-center gap-1.5 text-on-surface-variant">
            <div className="w-3 h-3 bg-[#E5E7EB] rounded-sm border border-outline-variant" />
            <span>Chỉ tiêu giao</span>
          </div>

          <div className="flex items-center gap-1.5 text-primary">
            <div className="w-3 h-3 bg-primary rounded-sm" />
            <span>Thực tế đạt được</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex flex-col space-y-6">
        {/* Custom CSS Grouped Bar Chart */}
        <div className="relative pt-6 border-b border-outline-variant pb-2">
          {/* Chart content grid */}
          <div className="flex items-end justify-around h-[240px] px-2 sm:px-6 relative">
            {/* Y-Axis Guidelines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none select-none text-[10px] text-on-surface-variant font-semibold">
              <div className="w-full border-t border-dashed border-outline-variant pt-1 flex justify-between">
                <span>{Math.round(maxValue)}</span>
              </div>

              <div className="w-full border-t border-dashed border-outline-variant pt-1 flex justify-between">
                <span>{Math.round(maxValue * 0.75)}</span>
              </div>

              <div className="w-full border-t border-dashed border-outline-variant pt-1 flex justify-between">
                <span>{Math.round(maxValue * 0.5)}</span>
              </div>

              <div className="w-full border-t border-dashed border-outline-variant pt-1 flex justify-between">
                <span>{Math.round(maxValue * 0.25)}</span>
              </div>

              <div className="w-full border-b border-outline-variant pb-0.5 flex justify-between">
                <span>0</span>
              </div>
            </div>

            {/* Bar Columns */}
            {data.map((team, idx) => {
              const targetHeight = (team.target / maxValue) * 100;
              const actualHeight = (team.actual / maxValue) * 100;

              return (
                <div
                  key={idx}
                  className="flex flex-col items-center group relative z-10 w-24"
                >
                  {/* Visual Bars Container */}
                  <div className="flex items-end gap-1.5 h-[200px] w-full justify-center">
                    {/* Target Bar */}
                    <div
                      style={{ height: `${targetHeight}%` }}
                      className="w-5 bg-[#E5E7EB] rounded-t-md transition-all duration-500 hover:opacity-90 relative group/target cursor-pointer"
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/target:block bg-slate-800 text-white text-[10px] font-bold py-1 px-2 rounded-lg whitespace-nowrap shadow-md z-30">
                        Chỉ tiêu: {team.target}
                      </div>
                    </div>

                    {/* Actual Bar */}
                    <div
                      style={{ height: `${actualHeight}%` }}
                      className="w-5 bg-primary rounded-t-md transition-all duration-500 hover:opacity-90 relative group/actual cursor-pointer"
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/actual:block bg-slate-800 text-white text-[10px] font-bold py-1 px-2 rounded-lg whitespace-nowrap shadow-md z-30">
                        Thực tế: {team.actual}
                      </div>
                    </div>
                  </div>

                  {/* Team Name Label */}
                  <span className="text-[10px] font-bold text-on-surface-variant truncate px-1 group-hover:text-on-surface transition-colors mt-2">
                    {team.team_name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
