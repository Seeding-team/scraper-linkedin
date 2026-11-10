"use client";

import { useMemo } from "react";
import { MaterialIcon } from "@/components/ui";
import { BarChart3, PieChart as PieChartIcon, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface TeamKpiChartsProps {
  membersWithKpi: any[];
  kpiSummary: {
    comment: { target: number; actual: number; pct: number };
    call: { target: number; actual: number; pct: number };
    inbox: { target: number; actual: number; pct: number };
    lead: { target: number; actual: number; pct: number };
  };
}

export function TeamKpiCharts({ membersWithKpi, kpiSummary }: TeamKpiChartsProps) {
  // Bar Chart Data (Top 10 members)
  const barChartData = useMemo(() => {
    return membersWithKpi.slice(0, 10).map((m) => {
      const tgt = (m.kpiCommentTarget || 0) + (m.kpiCallTarget || 0) + (m.kpiInboxTarget || 0) + (m.kpiLeadTarget || 0);
      const act = (m.kpiCommentCurrent || 0) + (m.kpiCallCurrent || 0) + (m.kpiInboxCurrent || 0) + (m.kpiLeadCurrent || 0);
      const rawName = m.name || m.email || "";
      const shortName = rawName.includes("@") ? rawName.split("@")[0] : rawName;
      return {
        name: shortName.length > 10 ? shortName.slice(0, 10) + "…" : shortName,
        "Thực đạt": act,
        "Chỉ tiêu": tgt,
      };
    });
  }, [membersWithKpi]);

  // Donut Chart Data
  const donutChartData = useMemo(() => {
    const list = [
      { name: "Cuộc gọi (CALL)", value: kpiSummary.call.actual, color: "#ba244a" },
      { name: "Bình luận (CMT)", value: kpiSummary.comment.actual, color: "#3b82f6" },
      { name: "Inbox Zalo", value: kpiSummary.inbox.actual, color: "#f97316" },
      { name: "Khách tiềm năng (LEAD)", value: kpiSummary.lead.actual, color: "#8b5cf6" },
    ].filter((item) => item.value > 0);
    return list.length > 0 ? list : [{ name: "Chưa có dữ liệu", value: 1, color: "#e2e8f0" }];
  }, [kpiSummary]);

  // Top 3 Performers
  const topPerformers = useMemo(() => {
    return [...membersWithKpi]
      .map((m) => {
        const totalTarget = (m.kpiCommentTarget || 0) + (m.kpiCallTarget || 0) + (m.kpiInboxTarget || 0) + (m.kpiLeadTarget || 0);
        const totalActual = (m.kpiCommentCurrent || 0) + (m.kpiCallCurrent || 0) + (m.kpiInboxCurrent || 0) + (m.kpiLeadCurrent || 0);
        const pct = totalTarget === 0 ? 0 : Math.round((totalActual / totalTarget) * 100);
        return { ...m, totalTarget, totalActual, pct };
      })
      .sort((a, b) => b.pct - a.pct || b.totalActual - a.totalActual)
      .slice(0, 3);
  }, [membersWithKpi]);

  if (membersWithKpi.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Biểu đồ Cột: Thực đạt vs Chỉ tiêu theo thành viên */}
      <div className="lg:col-span-8 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="text-[#ba244a] w-5 h-5 shrink-0" />
              So sánh Tiến độ KPI Thành viên (Top 10)
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Tổng hợp kết quả Thực đạt so với Chỉ tiêu giao tuần này</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#ba244a]" />
              <span className="text-slate-600 font-medium">Thực đạt</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-200" />
              <span className="text-slate-600 font-medium">Chỉ tiêu</span>
            </div>
          </div>
        </div>

        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  fontSize: "12px",
                  boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                }}
              />
              <Bar dataKey="Thực đạt" fill="#ba244a" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="Chỉ tiêu" fill="#e2e8f0" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Biểu đồ Tròn: Phân bổ 4 loại KPI + Bảng Top Performers */}
      <div className="lg:col-span-4 flex flex-col gap-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex-1">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
            <PieChartIcon className="text-[#ba244a] w-5 h-5 shrink-0" />
            Phân bổ Nỗ lực 4 Chỉ số
          </h3>
          <div className="h-[130px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={36}
                  outerRadius={54}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {donutChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-50">
            {donutChartData.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-[10px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="truncate text-slate-600 font-medium">{item.name}</span>
                <span className="ml-auto font-bold text-slate-900">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top 3 Performers */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mb-2.5">
            <Trophy className="text-amber-500 w-4 h-4 shrink-0" />
            Top Performers Tuần
          </h4>
          <div className="space-y-1.5">
            {topPerformers.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-50/70 border border-slate-100 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0",
                      idx === 0
                        ? "bg-amber-100 text-amber-700"
                        : idx === 1
                        ? "bg-slate-200 text-slate-700"
                        : "bg-orange-100 text-orange-700"
                    )}
                  >
                    {idx + 1}
                  </span>
                  <span className="font-bold text-slate-800 truncate">{p.name || p.email}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-extrabold text-[#ba244a]">{p.pct}%</span>
                  <span className="text-[10px] text-slate-400">
                    ({p.totalActual}/{p.totalTarget})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
