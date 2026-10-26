"use client";

import React, { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { allPlatformKpiService } from "@/services/all-platform.service";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";

interface KpiTeamStats {
  team_id: string;
  team_name: string;
  lead_actual: number;
  lead_target: number;
  inbox_actual: number;
  inbox_target: number;
  post_actual: number;
  post_target: number;
  comment_actual: number;
  comment_target: number;
}

interface WeeklySnapshot {
  week_name: string;
  teams: KpiTeamStats[];
}

interface Props {
  /** Leader email — bỏ trống nếu admin (lấy tất cả team) */
  leaderEmail?: string;
  weeks?: number;
}

export function AdminKpiHistoryTable({ leaderEmail, weeks = 4 }: Props) {
  const [data, setData] = useState<WeeklySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    allPlatformKpiService
      .getTeamHistory(leaderEmail, weeks)
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setData(res.data);
        } else {
          setError(res.message || "Không lấy được dữ liệu");
        }
      })
      .catch(() => setError("Lỗi kết nối API"))
      .finally(() => setLoading(false));
  }, [leaderEmail, weeks]);

  const calcPct = (actual: number, target: number) => {
    if (target === 0) return 0;
    return Math.round((actual / target) * 100);
  };

  const PctCell = ({ pct }: { pct: number }) => {
    let colorClass = "text-[#000000] font-bold";
    let bgClass = "bg-surface";
    if (pct === 0) {
      colorClass = "text-primary font-black";
    } else if (pct >= 100) {
      bgClass = "bg-emerald-200";
      colorClass = "text-emerald-800 font-bold";
    }
    return (
      <td
        className={`border-b border-r border-outline-variant px-2 py-1.5 text-right ${colorClass} ${bgClass}`}
      >
        {pct}%
      </td>
    );
  };

  const renderMobileAccordion = () => {
    if (loading || error || data.length === 0) return null;
    return (
      <div className="block divide-y divide-outline-variant px-5 pb-5 lg:hidden">
        {data.map((snapshot) => (
          <div key={snapshot.week_name} className="py-2">
            <h4 className="text-xs font-bold text-on-surface-variant uppercase px-2 mb-2">
              {snapshot.week_name}
            </h4>
            <div className="flex flex-col gap-3">
              {snapshot.teams.map((team) => {
                const id = `${snapshot.week_name}-${team.team_id}`;
                const isOpen = openAccordion === id;

                const pctLead = calcPct(team.lead_actual, team.lead_target);
                const pctInbox = calcPct(team.inbox_actual, team.inbox_target);
                const pctPost = calcPct(team.post_actual, team.post_target);
                const pctCmm = calcPct(
                  team.comment_actual,
                  team.comment_target,
                );
                const cap = (v: number) => Math.min(v, 150);
                const totalPct = Math.round(
                  cap(pctLead) * 0.4 +
                    cap(pctInbox) * 0.4 +
                    cap(pctPost) * 0.15 +
                    cap(pctCmm) * 0.05,
                );

                const totalColor =
                  totalPct < 100 ? "text-red-600" : "text-emerald-600";

                return (
                  <div
                    key={team.team_id}
                    className="border-b border-r border-outline-variant rounded-lg overflow-hidden bg-surface"
                  >
                    {/* Header Card */}
                    <button
                      onClick={() => setOpenAccordion(isOpen ? null : id)}
                      className="w-full flex items-center justify-between p-3 bg-surface hover:bg-surface-container-low transition active:bg-surface-container-low cursor-pointer"
                    >
                      <div className="text-sm font-bold text-on-surface text-left">
                        {team.team_name}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${totalColor}`}>
                          Tổng: {totalPct}%
                        </span>
                        {isOpen ? (
                          <FaChevronUp className="text-on-surface-variant text-[10px]" />
                        ) : (
                          <FaChevronDown className="text-on-surface-variant text-[10px]" />
                        )}
                      </div>
                    </button>

                    {/* Content Card */}
                    {isOpen && (
                      <div className="grid grid-cols-2 gap-2 border-t border-outline-variant bg-surface-container-low p-3">
                        {/* Lead */}
                        <div className="rounded-xl border border-outline-variant bg-surface p-2.5 text-[10px] shadow-sm">
                          <div className="mb-1 font-bold uppercase text-amber-600">
                            Lead
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-on-surface font-medium">
                              Số: {team.lead_actual}
                            </span>
                            <span className="text-on-surface-variant font-medium">
                              KPI: {team.lead_target}
                            </span>
                          </div>
                          <div className="mt-1 font-black text-right text-on-surface">
                            %: {pctLead}%
                          </div>
                        </div>

                        {/* Inbox */}
                        <div className="rounded-xl border border-outline-variant bg-surface p-2.5 text-[10px] shadow-sm">
                          <div className="mb-1 font-bold uppercase text-sky-600">
                            Inbox
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-on-surface font-medium">
                              Số: {team.inbox_actual}
                            </span>
                            <span className="text-on-surface-variant font-medium">
                              KPI: {team.inbox_target}
                            </span>
                          </div>
                          <div className="mt-1 font-black text-right text-on-surface">
                            %: {pctInbox}%
                          </div>
                        </div>

                        {/* Post */}
                        <div className="rounded-xl border border-outline-variant bg-surface p-2.5 text-[10px] shadow-sm">
                          <div className="mb-1 font-bold uppercase text-violet-600">
                            Post
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-on-surface font-medium">
                              Số: {team.post_actual}
                            </span>
                            <span className="text-on-surface-variant font-medium">
                              KPI: {team.post_target}
                            </span>
                          </div>
                          <div className="mt-1 font-black text-right text-on-surface">
                            %: {pctPost}%
                          </div>
                        </div>

                        {/* Comment */}
                        <div className="rounded-xl border border-outline-variant bg-surface p-2.5 text-[10px] shadow-sm">
                          <div className="mb-1 font-bold uppercase text-emerald-600">
                            Comment
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-on-surface font-medium">
                              Số: {team.comment_actual}
                            </span>
                            <span className="text-on-surface-variant font-medium">
                              KPI: {team.comment_target}
                            </span>
                          </div>
                          <div className="mt-1 font-black text-right text-on-surface">
                            %: {pctCmm}%
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-outline-variant bg-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-on-surface">
            <MaterialIcon name="table_view" className="text-red-600" />
            Bảng Tổng hợp KPI theo Tuần
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {loading
              ? "Đang tải..."
              : error
                ? error
                : `${weeks} tuần gần nhất • Inbox + Post KPI thực tế`}
          </p>
        </div>
        {!loading && !error && (
          <span className="rounded-md bg-surface-container-low px-2 py-1 text-xs font-medium text-on-surface-variant">
            {data.length} tuần
          </span>
        )}
      </div>

      {loading && (
        <div className="p-8 text-center text-on-surface-variant text-sm">
          Đang tải dữ liệu...
        </div>
      )}
      {!loading && error && (
        <div className="p-8 text-center text-red-500 text-sm">{error}</div>
      )}
      {!loading && !error && data.length === 0 && (
        <div className="p-8 text-center text-on-surface-variant text-sm">
          Chưa có dữ liệu KPI
        </div>
      )}

      {/* Render Mobile Accordion */}
      {renderMobileAccordion()}

      {/* Render Desktop Table */}
      {!loading && !error && data.length > 0 && (
        <div className="hidden overflow-x-auto px-5 pb-5 lg:block">
          <table className="min-w-[1000px] w-full border-collapse text-[11px]">
            <thead className="bg-primary text-white">
              <tr>
                <th
                  className="text-white font-bold text-xs py-3 px-4 border-r border-white/20 text-center uppercase w-[80px]"
                  rowSpan={2}
                >
                  Tuần
                </th>
                <th
                  className="text-white font-bold text-xs py-3 px-4 border-r border-white/20 text-left uppercase min-w-[120px]"
                  rowSpan={2}
                >
                  Team
                </th>
                <th
                  className="text-white font-bold text-xs py-2 px-2 border-r border-b border-white/20 text-center uppercase"
                  colSpan={3}
                >
                  Lead (40%)
                </th>
                <th
                  className="text-white font-bold text-xs py-2 px-2 border-r border-b border-white/20 text-center uppercase"
                  colSpan={3}
                >
                  Inbox (40%)
                </th>
                <th
                  className="text-white font-bold text-xs py-2 px-2 border-r border-b border-white/20 text-center uppercase"
                  colSpan={3}
                >
                  Post (15%)
                </th>
                <th
                  className="text-white font-bold text-xs py-2 px-2 border-r border-b border-white/20 text-center uppercase"
                  colSpan={3}
                >
                  Comment (5%)
                </th>
                <th
                  className="text-white font-bold text-xs py-2 px-2 border-b border-white/20 text-center uppercase"
                  colSpan={2}
                >
                  Tổng kết
                </th>
              </tr>
              <tr>
                {[
                  "Số",
                  "KPI",
                  "%",
                  "Số",
                  "KPI",
                  "%",
                  "Số",
                  "KPI",
                  "%",
                  "Số",
                  "KPI",
                  "%",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="text-white font-bold text-[10px] py-1.5 px-2 border-r border-white/20 text-center uppercase w-[40px]"
                  >
                    {h}
                  </th>
                ))}
                <th className="text-white font-bold text-[10px] py-1.5 px-2 border-r border-white/20 text-center uppercase w-[60px]">
                  Tổng %
                </th>
                <th className="text-white font-bold text-[10px] py-1.5 px-2 text-center uppercase w-[80px]">
                  Thưởng
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((snapshot) => {
                const weekSum = snapshot.teams.reduce(
                  (acc, t) => {
                    acc.lead_a += t.lead_actual;
                    acc.lead_t += t.lead_target;
                    acc.inbox_a += t.inbox_actual;
                    acc.inbox_t += t.inbox_target;
                    acc.post_a += t.post_actual;
                    acc.post_t += t.post_target;
                    acc.cmm_a += t.comment_actual;
                    acc.cmm_t += t.comment_target;
                    return acc;
                  },
                  {
                    lead_a: 0,
                    lead_t: 0,
                    inbox_a: 0,
                    inbox_t: 0,
                    post_a: 0,
                    post_t: 0,
                    cmm_a: 0,
                    cmm_t: 0,
                  },
                );

                return (
                  <React.Fragment key={snapshot.week_name}>
                    {snapshot.teams.map((team, idx) => {
                      const pctLead = calcPct(
                        team.lead_actual,
                        team.lead_target,
                      );
                      const pctInbox = calcPct(
                        team.inbox_actual,
                        team.inbox_target,
                      );
                      const pctPost = calcPct(
                        team.post_actual,
                        team.post_target,
                      );
                      const pctCmm = calcPct(
                        team.comment_actual,
                        team.comment_target,
                      );
                      const cap = (v: number) => Math.min(v, 150);
                      const totalPct = Math.round(
                        cap(pctLead) * 0.4 +
                          cap(pctInbox) * 0.4 +
                          cap(pctPost) * 0.15 +
                          cap(pctCmm) * 0.05,
                      );
                      const bonus =
                        totalPct >= 100
                          ? "500.000đ"
                          : totalPct >= 80
                            ? "200.000đ"
                            : "0đ";
                      const bonusColor =
                        totalPct >= 100
                          ? "text-emerald-600 font-bold"
                          : totalPct >= 80
                            ? "text-amber-600 font-bold"
                            : "text-on-surface-variant";

                      return (
                        <tr
                          key={team.team_id}
                          className="bg-surface transition-colors hover:bg-surface-container"
                        >
                          {idx === 0 && (
                            <td
                              className="border-b border-r border-outline-variant px-2 py-1.5 text-center font-black text-on-surface align-middle bg-surface"
                              rowSpan={snapshot.teams.length + 1}
                            >
                              {snapshot.week_name}
                            </td>
                          )}
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-left font-bold text-on-surface">
                            {team.team_name}
                          </td>
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right font-medium">
                            {team.lead_actual}
                          </td>
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                            {team.lead_target}
                          </td>
                          <PctCell pct={pctLead} />
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right font-medium">
                            {team.inbox_actual}
                          </td>
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                            {team.inbox_target}
                          </td>
                          <PctCell pct={pctInbox} />
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right font-medium">
                            {team.post_actual}
                          </td>
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                            {team.post_target}
                          </td>
                          <PctCell pct={pctPost} />
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right font-medium">
                            {team.comment_actual}
                          </td>
                          <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                            {team.comment_target}
                          </td>
                          <PctCell pct={pctCmm} />
                          <td
                            className={`border-b border-r border-outline-variant px-2 py-1.5 text-center font-black ${totalPct >= 100 ? "text-emerald-800 bg-emerald-200" : totalPct >= 80 ? "text-amber-700 bg-amber-100" : "text-primary bg-surface"}`}
                          >
                            {totalPct}%
                          </td>
                          <td
                            className={`border-b border-r border-outline-variant px-2 py-1.5 text-right bg-surface-container-low ${bonusColor}`}
                          >
                            {bonus}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-surface-container-low font-bold text-on-surface">
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-[10px] uppercase">
                        Tổng {snapshot.week_name}
                      </td>
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right">
                        {weekSum.lead_a}
                      </td>
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                        {weekSum.lead_t}
                      </td>
                      <PctCell pct={calcPct(weekSum.lead_a, weekSum.lead_t)} />
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right">
                        {weekSum.inbox_a}
                      </td>
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                        {weekSum.inbox_t}
                      </td>
                      <PctCell
                        pct={calcPct(weekSum.inbox_a, weekSum.inbox_t)}
                      />
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right">
                        {weekSum.post_a}
                      </td>
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                        {weekSum.post_t}
                      </td>
                      <PctCell pct={calcPct(weekSum.post_a, weekSum.post_t)} />
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right">
                        {weekSum.cmm_a}
                      </td>
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-right text-on-surface-variant">
                        {weekSum.cmm_t}
                      </td>
                      <PctCell pct={calcPct(weekSum.cmm_a, weekSum.cmm_t)} />
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 text-center bg-surface-container-highest">
                        {Math.round(
                          calcPct(weekSum.lead_a, weekSum.lead_t) * 0.4 +
                            calcPct(weekSum.inbox_a, weekSum.inbox_t) * 0.4 +
                            calcPct(weekSum.post_a, weekSum.post_t) * 0.15 +
                            calcPct(weekSum.cmm_a, weekSum.cmm_t) * 0.05,
                        )}
                        %
                      </td>
                      <td className="border-b border-r border-outline-variant px-2 py-1.5 bg-surface-container-highest"></td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
