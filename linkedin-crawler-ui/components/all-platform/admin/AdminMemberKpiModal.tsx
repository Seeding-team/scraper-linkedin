"use client";

import { useState, useEffect, useMemo } from "react";
import { MaterialIcon } from "@/components/ui";
import { allPlatformKpiService } from "@/services/all-platform.service";
import { SeedingModal } from "@/components/all-platform/leader/SeedingModal";
import { LeaderInboxView } from "@/components/all-platform/leader/LeaderInboxView";
import { cn } from "@/lib/utils";
import type { TeamRow } from "@/services/all-platform.service";

function getRecentWeeks(numWeeks = 8) {
  const weeks = [];
  const curr = new Date();
  for (let i = 0; i < numWeeks; i++) {
    const d = new Date(curr.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const yearStart = new Date(monday.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((monday.getTime() - yearStart.getTime()) / 86400000) + yearStart.getDay() + 1) / 7);

    const fmt = (dt: Date) => dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
    const valStart = monday.toISOString().split("T")[0];
    const valEnd = sunday.toISOString().split("T")[0];

    weeks.push({
      label: `Tuần ${weekNo} (${fmt(monday)} - ${fmt(sunday)})`,
      value: `${valStart}_${valEnd}`
    });
  }
  return weeks;
}

interface AdminMemberKpiModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: TeamRow | null;
  initialKpiData?: any[];
}

export function AdminMemberKpiModal({ isOpen, onClose, team, initialKpiData }: AdminMemberKpiModalProps) {
  // Map initialKpiData nếu có để mở modal 0ms mà không phải chờ spinner
  const parsedInitial = useMemo(() => {
    if (!initialKpiData || initialKpiData.length === 0) return [];
    return initialKpiData.map((row) => ({
      id: row.member_id,
      email: row.member_email,
      name: row.member_name,
      seeding_stats: {
        verified_count: row.verified_count || 0,
        kpi_target: row.kpi_comment || 0,
        kpi_call: row.kpi_call !== undefined ? row.kpi_call : (row.kpi_post || 0),
        kpi_call_current: row.kpi_call_current !== undefined ? row.kpi_call_current : (row.kpi_post_current || 0),
        kpi_post: row.kpi_call !== undefined ? row.kpi_call : (row.kpi_post || 0),
        kpi_post_current: row.kpi_call_current !== undefined ? row.kpi_call_current : (row.kpi_post_current || 0),
        kpi_inbox: row.kpi_inbox || 0,
        kpi_inbox_current: row.kpi_inbox_current || 0,
        kpi_lead: row.kpi_lead || 0,
        kpi_lead_current: row.kpi_lead_current || 0,
        kpi_inbox_range: row.kpi_inbox_range,
      },
    }));
  }, [initialKpiData]);

  const [kpiData, setKpiData] = useState<any[]>([]);
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inboxModalOpen, setInboxModalOpen] = useState(false);
  const [inboxMember, setInboxMember] = useState<{ email: string; name: string } | null>(null);

  const [seedingModalOpen, setSeedingModalOpen] = useState(false);
  const [selectedMemberSeeding, setSelectedMemberSeeding] = useState<any>(null);

  const recentWeeks = useMemo(() => getRecentWeeks(8), []);
  const [selectedWeek, setSelectedWeek] = useState(recentWeeks[0].value);

  // Khi chuyển sang team khác, reset state chi tiết để lấy parsedInitial mới 0ms
  useEffect(() => {
    if (team?.id !== currentTeamId) {
      setCurrentTeamId(team?.id || null);
      setKpiData([]);
    }
  }, [team?.id, currentTeamId]);

  // Nguồn dữ liệu KPI hiện hành: ưu tiên chi tiết remote kpiData, nếu chưa có thì lấy parsedInitial 0ms
  const activeKpiData = useMemo(() => {
    return kpiData.length > 0 ? kpiData : parsedInitial;
  }, [kpiData, parsedInitial]);

  useEffect(() => {
    async function loadKpiData() {
      if (!team?.leader_email) return;
      // Chỉ bật loading spinner nếu cả 2 nguồn đều chưa có dữ liệu ban đầu
      const hasInitialData = parsedInitial.length > 0 || kpiData.length > 0;
      if (!hasInitialData) {
        setIsLoading(true);
      }
      setError(null);
      try {
        const [startDate, endDate] = selectedWeek.split("_");
        // Phase 3: Dùng getTeamOverviewV3 (Postgres RPC) thay cho getAll (legacy N+1 loops) để nạp siêu tốc
        const res = await allPlatformKpiService.getTeamOverviewV3(team.leader_email, team.id, startDate, endDate);
        if (res.success && res.data?.members) {
          setKpiData(res.data.members);
        } else {
          // Fallback graceful
          const fallbackRes = await allPlatformKpiService.getAll(team.leader_email, team.id, startDate, endDate);
          if (fallbackRes.success && fallbackRes.data?.members) {
            setKpiData(fallbackRes.data.members);
          } else if (!hasInitialData) {
            setError(res.message || fallbackRes.message || "Không thể tải dữ liệu KPI của nhóm");
          }
        }
      } catch (err) {
        console.error("Lỗi khi tải KPI:", err);
        if (!hasInitialData) {
          setError("Lỗi kết nối máy chủ");
        }
      } finally {
        setIsLoading(false);
      }
    }
    if (isOpen && team) {
      loadKpiData();
    }
  }, [isOpen, team, selectedWeek]);

  const membersWithKpi = useMemo(() => {
    if (!team) return [];
    const teamMembers = team.members || [];
    const hasLeaderAlready = teamMembers.some(m => m.id === team.id_leader);
    const allMembers = team.id_leader && !hasLeaderAlready
      ? [...teamMembers, { id: team.id_leader, email: team.leader_email, name: team.leader_name || team.leader_email }]
      : teamMembers;

    // Bổ sung các thành viên từ activeKpiData nếu chưa có trong team.members
    const membersMap = new Map<string, { id: string; email: string; name: string }>();
    allMembers.forEach(m => {
      const key = (m.id || m.email || "").toString().toLowerCase();
      if (key) membersMap.set(key, m);
    });
    activeKpiData.forEach(p => {
      const keyId = (p.id || "").toString().toLowerCase();
      const keyEmail = (p.email || "").toString().toLowerCase();
      if ((keyId && !membersMap.has(keyId)) && (keyEmail && !membersMap.has(keyEmail))) {
        membersMap.set(keyId || keyEmail, { id: p.id, email: p.email, name: p.name || p.email });
      }
    });

    const combinedMembers = Array.from(membersMap.values());

    return combinedMembers.map(member => {
      const kpiInfo = activeKpiData.find(k =>
        (k.id && member.id && k.id === member.id) ||
        (k.email && member.email && k.email.toLowerCase() === member.email.toLowerCase())
      ) || {};
      const stats = kpiInfo.seeding_stats || {};
      const commentTarget = stats.kpi_target || 0;
      const commentCurrent = stats.verified_count || 0;
      const callTarget = stats.kpi_call !== undefined ? stats.kpi_call : (stats.kpi_post || 0);
      const callCurrent = stats.kpi_call_current !== undefined ? stats.kpi_call_current : (stats.kpi_post_current || 0);
      const postTarget = callTarget;
      const postCurrent = callCurrent;
      const leadTarget = stats.kpi_lead || 0;
      const leadCurrent = stats.kpi_lead_current || 0;
      const inboxTarget = stats.kpi_inbox || 0;
      const inboxCurrent = stats.kpi_inbox_current || 0;
      const inboxRange = stats.kpi_inbox_range || null;

      const totalTarget = commentTarget + callTarget + leadTarget + inboxTarget;
      const totalCurrent = commentCurrent + callCurrent + leadCurrent + inboxCurrent;
      const percent = totalTarget > 0 ? Math.min(Math.round((totalCurrent / totalTarget) * 100), 100) : 0;

      return {
        ...member,
        commentTarget, commentCurrent,
        callTarget, callCurrent,
        postTarget, postCurrent,
        leadTarget, leadCurrent,
        inboxTarget, inboxCurrent,
        percent,
        seedingItems: kpiInfo.seeding_items || [],
        kpiInboxRange: inboxRange,
      };
    });
  }, [team, activeKpiData]);

  if (!isOpen || !team) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          position: "relative", zIndex: 10, width: "100%", maxWidth: 900,
          backgroundColor: "#ffffff", borderRadius: 20,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column", maxHeight: "90vh", overflow: "hidden",
        }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <MaterialIcon name="visibility" className="text-primary" />
              Thành viên & KPI — {team.name_team}
            </h2>
            <p className="text-[11px] text-on-surface-variant font-medium mt-0.5">
              Leader: {team.leader_name} ({team.leader_email})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-on-surface-variant">Tuần:</label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-outline-variant rounded-lg text-sm font-semibold text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition shadow-sm"
            >
              {recentWeeks.map(w => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
            <button onClick={onClose}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface-variant hover:bg-surface-container-highest/50 transition ml-2">
              <MaterialIcon name="close" className="text-[20px]" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-surface-container-low">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-on-surface-variant flex flex-col items-center justify-center gap-3 bg-surface rounded-xl border border-outline-variant shadow-sm">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <span>Đang tải KPI...</span>
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-xs font-medium flex items-start gap-2 border border-red-100">
              <MaterialIcon name="error" className="text-[16px] shrink-0" />
              <span>{error}</span>
            </div>
          ) : membersWithKpi.length === 0 ? (
            <div className="text-center py-16 flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-xl bg-surface">
              <MaterialIcon name="inbox" className="text-outline text-5xl mb-2" />
              <p className="text-sm font-medium text-on-surface-variant">Team chưa có thành viên.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-low border-b border-outline-variant text-on-surface-variant">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-bold text-[10px] uppercase">Thành viên</th>
                    <th className="text-center px-1 py-2.5 font-bold text-[10px] uppercase text-[#ba244a]" title="Số cuộc gọi tư vấn khách hàng (CALL)">Cuộc gọi (CALL)</th>
                    <th className="text-center px-1 py-2.5 font-bold text-[10px] uppercase">Comment</th>
                    <th className="text-center px-1 py-2.5 font-bold text-[10px] uppercase">Inbox</th>
                    <th className="text-center px-1 py-2.5 font-bold text-[10px] uppercase">Lead</th>
                    <th className="text-center px-2 py-2.5 font-bold text-[10px] uppercase">Tiến độ</th>
                    <th className="text-center px-2 py-2.5 font-bold text-[10px] uppercase">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant text-on-surface">
                  {membersWithKpi.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-container-low transition">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-on-surface text-xs">{m.name || "N/A"}</span>
                          {team && m.id === team.id_leader && (
                            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">Leader</span>
                          )}
                        </div>
                        <div className="text-[10px] text-on-surface-variant font-medium">{m.email}</div>
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span className={m.callCurrent > 0 ? "font-bold text-[#ba244a] text-[11px]" : "font-bold text-on-surface text-[11px]"}>{m.callCurrent}</span>
                        <span className="text-on-surface-variant text-[10px]"> / {m.callTarget}</span>
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span className="font-bold text-on-surface text-[11px]">{m.commentCurrent}</span>
                        <span className="text-on-surface-variant text-[10px]"> / {m.commentTarget}</span>
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span className={m.inboxCurrent >= m.inboxTarget && m.inboxTarget > 0 ? "font-bold text-emerald-600 text-[11px]" : "font-bold text-on-surface text-[11px]"}>{m.inboxCurrent}</span>
                        <span className="text-on-surface-variant text-[10px]"> / {m.inboxTarget}</span>
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span className="font-bold text-on-surface text-[11px]">{m.leadCurrent}</span>
                        <span className="text-on-surface-variant text-[10px]"> / {m.leadTarget}</span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 bg-surface-container-low rounded-full h-1.5 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-300",
                                m.percent >= 100 ? "bg-emerald-500" : m.percent > 50 ? "bg-amber-500" : "bg-primary"
                              )}
                              style={{ width: `${m.percent}%` }}
                            />
                          </div>
                          <span className={cn(
                            "font-bold text-[10px]",
                            m.percent >= 100 ? "text-emerald-700" : m.percent > 50 ? "text-amber-700" : "text-on-surface-variant"
                          )}>
                            {m.percent}%
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5 justify-center">
                          <button
                            onClick={() => {
                              setSelectedMemberSeeding(m);
                              setSeedingModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded-md text-[10px] transition border border-blue-200 cursor-pointer shadow-2xs"
                            title="Xem chi tiết các bài viết đã seeding"
                          >
                            <MaterialIcon name="visibility" className="text-[12px]" />
                            Xem seeding
                          </button>
                          <button
                            onClick={() => {
                              setInboxMember({ email: m.email, name: m.name || m.email });
                              setInboxModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded-md text-[10px] transition border border-emerald-200 cursor-pointer shadow-2xs"
                            title="Xem hộp thoại Zalo thành viên đã nhắn với khách hàng"
                          >
                            <MaterialIcon name="chat" className="text-[12px]" />
                            Xem hộp thoại Zalo
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-outline-variant bg-surface">
          <button type="button" onClick={onClose}
            className="px-5 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container-low hover:bg-surface-container-highest transition cursor-pointer">
            Đóng
          </button>
        </div>
      </div>

      {inboxModalOpen && inboxMember && (
        <LeaderInboxView
          isOpen={inboxModalOpen}
          onClose={() => setInboxModalOpen(false)}
          memberEmail={inboxMember.email}
          memberName={inboxMember.name}
          leaderEmail={team?.leader_email}
        />
      )}

      {seedingModalOpen && selectedMemberSeeding && (
        <SeedingModal
          isOpen={seedingModalOpen}
          onClose={() => setSeedingModalOpen(false)}
          member={{ ...selectedMemberSeeding, seedingItems: selectedMemberSeeding.seedingItems || [] }}
        />
      )}
    </div>
  );
}
