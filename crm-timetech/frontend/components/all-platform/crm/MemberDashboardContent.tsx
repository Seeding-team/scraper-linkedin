"use client";

import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { useCrm } from "@/modules/crm/hooks/useCrm";
import { DEAL_STAGES, DEAL_STAGE_META } from "@/modules/crm/constants/crmConfig";
import type { Deal } from "@/modules/crm/types";
import { teamsService, type TeamRow } from "@/services/all-platform.service";
import {
  PlatformStatCard,
  PlatformStatsRow,
} from "@/components/features/shared/PlatformStatCard";

type ScopeFilter = "mine" | "all" | string; // string khác = team.id

function isOverdue(deal: Deal): boolean {
  // "Trễ hạn" = deal chưa ở stage won/lost VÀ follow_up_date đã qua hiện tại.
  if (deal.stage === "won" || deal.stage === "lost") return false;
  if (!deal.followUpDate) return false;
  const due = new Date(deal.followUpDate).getTime();
  return Number.isFinite(due) && due < Date.now();
}

export function MemberDashboardContent() {
  const { user } = useAppAuth();
  const { deals, loading } = useCrm();
  const [scope, setScope] = useState<ScopeFilter>("mine");
  const [teams, setTeams] = useState<TeamRow[]>([]);

  useEffect(() => {
    let alive = true;
    void teamsService.getAll().then(res => {
      if (alive && res.success && res.data) setTeams(res.data);
    });
    return () => { alive = false; };
  }, []);

  const scopedDeals = useMemo(() => {
    if (scope === "all") return deals;
    if (scope === "mine") {
      const uid = user?.id;
      if (!uid) return [];
      return deals.filter(d => d.assignment.leadedById === uid || d.assignment.sdrId === uid);
    }
    // scope = team.id
    return deals.filter(d => d.teamId === scope);
  }, [deals, scope, user?.id]);

  const scopeLabel = useMemo(() => {
    if (scope === "mine") return "Của tôi";
    if (scope === "all") return "Tất cả";
    return teams.find(t => t.id === scope)?.name_team || "Team";
  }, [scope, teams]);

  const total = scopedDeals.length;
  const wonCount = scopedDeals.filter(d => d.stage === "won").length;
  const lostCount = scopedDeals.filter(d => d.stage === "lost").length;
  const inProgressCount = Math.max(total - wonCount - lostCount, 0);
  const overdueCount = scopedDeals.filter(isOverdue).length;

  const perPhase = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const stage of DEAL_STAGES) counts[stage] = 0;
    for (const deal of scopedDeals) counts[deal.stage] = (counts[deal.stage] || 0) + 1;
    return counts;
  }, [scopedDeals]);

  // Tỷ lệ chuyển đổi theo phase — xấp xỉ theo count hiện tại (không dùng activity
  // log lịch sử): % deal đang ở stage này hoặc các stage SAU nó (theo thứ tự
  // DEAL_STAGE_META.order) trên tổng số deal đang xem — cho biết bao nhiêu % đã
  // "đi qua" mốc này trong phễu.
  const stagesByOrder = useMemo(
    () => [...DEAL_STAGES].sort((a, b) => DEAL_STAGE_META[a].order - DEAL_STAGE_META[b].order),
    []
  );
  const conversionByPhase = useMemo(() => {
    if (total === 0) return stagesByOrder.map(stage => ({ stage, pct: 0 }));
    return stagesByOrder.map(stage => {
      const atOrPast = scopedDeals.filter(
        d => DEAL_STAGE_META[d.stage].order >= DEAL_STAGE_META[stage].order
      ).length;
      return { stage, pct: Math.round((atOrPast / total) * 100) };
    });
  }, [scopedDeals, stagesByOrder, total]);

  return (
    <div className="mx-auto w-full max-w-none space-y-5 font-sans">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
            <MaterialIcon name="trending_up" className="text-2xl text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-on-surface">Dashboard của tôi</h1>
            <p className="text-sm text-on-surface-variant">Số liệu Pipeline bán hàng — {scopeLabel}</p>
          </div>
        </div>

        <select
          value={scope}
          onChange={e => setScope(e.target.value)}
          className="h-10 rounded-xl border border-outline-variant bg-surface px-3 text-sm text-on-surface outline-none focus:border-primary"
        >
          <option value="mine">Của tôi</option>
          <option value="all">Tất cả</option>
          {teams.map(t => (
            <option key={t.id} value={t.id}>{t.name_team}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-on-surface-variant">
          <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
          Đang tải dữ liệu Pipeline...
        </div>
      ) : (
        <>
          <PlatformStatsRow>
            <PlatformStatCard label="Tổng số deal" value={total} accent="primary" />
            <PlatformStatCard label="Đang xử lý" value={inProgressCount} accent="secondary" />
            <PlatformStatCard label="Đã hoàn thành" value={wonCount} accent="success" />
            <PlatformStatCard
              label="Trễ hạn"
              value={overdueCount}
              accent={overdueCount > 0 ? "error" : "secondary"}
              hint={overdueCount > 0 ? "Quá hạn follow-up, chưa kết thúc" : undefined}
              hintTone={overdueCount > 0 ? "down" : "neutral"}
            />
          </PlatformStatsRow>

          <section className="rounded-2xl border border-outline-variant bg-surface p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-on-surface-variant">
              Số deal ở từng giai đoạn
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {DEAL_STAGES.map(stage => (
                <div key={stage} className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
                  <p className="text-[11px] font-bold uppercase text-on-surface-variant">{DEAL_STAGE_META[stage].label}</p>
                  <p className="mt-1 text-xl font-extrabold text-on-surface">{perPhase[stage] || 0}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-outline-variant bg-surface p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-on-surface-variant">
              Tỷ lệ chuyển đổi theo phase
            </h2>
            <div className="space-y-2">
              {conversionByPhase.map(({ stage, pct }) => (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-xs font-semibold text-on-surface-variant">
                    {DEAL_STAGE_META[stage].label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-low">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-bold text-on-surface">{pct}%</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
