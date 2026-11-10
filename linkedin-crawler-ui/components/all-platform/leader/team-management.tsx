"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import dynamic from "next/dynamic";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { teamsService, allPlatformKpiService } from "@/services/all-platform.service";
import { cn } from "@/lib/utils";
import type { TeamRow } from "@/services/all-platform.service";
import { PlatformStatsRow, PlatformStatCard } from "@/components/features/shared/PlatformStatCard";
import { KpiRewardRuleTable, LeaderKpiRewardSections } from "@/components/all-platform/kpi-rewards/KpiRewardSections";
import { AssignKpiModal } from "./AssignKpiModal";
import { BulkAssignKpiModal } from "./BulkAssignKpiModal";
import { TeamModal } from "./TeamModal";
import { toast } from "sonner";
import { useKpiRefresh, dispatchKpiRefresh } from "@/lib/useKpiRefresh";
import { BarChart3, PieChart as PieChartIcon, Trophy } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// Phase 3: dynamic import cho các modal nặng (chỉ tải khi cần mở).
const SeedingModal = dynamic(
  () => import("./SeedingModal").then((m) => ({ default: m.SeedingModal })),
  { ssr: false },
);
const LeaderInboxView = dynamic(
  () => import("./LeaderInboxView").then((m) => ({ default: m.LeaderInboxView })),
  { ssr: false },
);
const LeaderPostView = dynamic(
  () => import("./LeaderPostView").then((m) => ({ default: m.LeaderPostView })),
  { ssr: false },
);

// Phase 3: skeleton row khi đang fetch KPI — tránh "đứng hình" toàn bảng.
function MemberRowSkeleton() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, idx) => (
        <td key={idx} className="px-3 py-2.5">
          <div
            className={cn(
              "h-3 w-full animate-pulse rounded bg-slate-100",
              idx === 0 ? "max-w-[140px]" : "max-w-[60px] mx-auto",
            )}
          />
        </td>
      ))}
    </tr>
  );
}

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
    const valStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    const valEnd = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    
    weeks.push({
      label: `Tuần ${weekNo} (${fmt(monday)} - ${fmt(sunday)})`,
      value: `${valStart}_${valEnd}`
    });
  }
  return weeks;
}

export function TeamManagement() {
  const { user } = useAppAuth();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [kpiData, setKpiData] = useState<any[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  
  const [seedingModalOpen, setSeedingModalOpen] = useState(false);
  const [selectedMemberSeeding, setSelectedMemberSeeding] = useState<any>(null);

  // Inbox KPI verification modal
  const [inboxModalOpen, setInboxModalOpen] = useState(false);
  const [inboxMember, setInboxMember] = useState<{ email: string; name: string } | null>(null);

  // Bulk Assign KPI modal
  const [bulkAssignModalOpen, setBulkAssignModalOpen] = useState(false);

  // FB Post KPI modal
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [postMember, setPostMember] = useState<{ email: string; name: string } | null>(null);
  const [postDateRange, setPostDateRange] = useState<{ start: string; end: string } | null>(null);

  // Team Management Modals
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [isEditingTeam, setIsEditingTeam] = useState(false);

  const recentWeeks = useMemo(() => getRecentWeeks(8), []);
  const [selectedWeek, setSelectedWeek] = useState(recentWeeks[0].value);

  // Effect 1: Fetch teams when user loads page
  useEffect(() => {
    if (!user?.id || !["leader", "admin", "superadmin"].includes(user.role || "")) return;
    
    const loadTeams = async () => {
      try {
        const teamsRes = await teamsService.getAll();
        if (teamsRes.success && teamsRes.data) {
          let myTeams: TeamRow[] = [];
          if ((user.role as string) === "admin" || (user.role as string) === "superadmin") {
            myTeams = teamsRes.data;
          } else {
            myTeams = teamsRes.data.filter(t => t.id_leader === user.id);
          }
          setTeams(myTeams);
          // Auto-select first team if none selected
          if (myTeams.length > 0 && !selectedTeamId) {
            setSelectedTeamId(myTeams[0].id);
          }
        }
      } catch (err) {
        console.error("Error fetching teams:", err);
      }
    };
    
    loadTeams();
  }, [user?.id, user?.role]);

  // Effect 2: Fetch KPI when team or week changes (uses current selectedTeamId from state)
  useEffect(() => {
    if (!user?.email || !selectedTeamId) {
      setKpiData([]);
      return;
    }

    const [startDate, endDate] = selectedWeek.split("_");

    setIsLoading(true);
    // Phase 3: dùng endpoint V3 (RPC + cache). Giữ data cũ trong state để UI không nháy trắng.
    allPlatformKpiService
      .getTeamOverviewV3(user.email, selectedTeamId, startDate, endDate)
      .then((kpiRes) => {
        if (kpiRes.success && kpiRes.data?.members) {
          setKpiData(kpiRes.data.members);
        } else {
          setKpiData([]);
        }
      })
      .catch((err) => {
        console.error("Error fetching KPI:", err);
        setKpiData([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [user?.email, selectedTeamId, selectedWeek]);

  // Effect: "Khach reply" - so tin nhan THUC TE khach gui toi tung member,
  // khong phu thuoc da xac nhan tinh KPI hay chua (khac voi cot Inbox o tren,
  // von chi tinh hoi thoai DA duoc leader xac nhan qua fb_inbox_kpi).
  useEffect(() => {
    const team = teams.find(t => t.id === selectedTeamId);
    if (!team) {
      setReplyCounts({});
      return;
    }
    const emails = Array.from(
      new Set([team.leader_email, ...(team.members || []).map(m => m.email)].filter(Boolean)),
    );
    if (emails.length === 0) {
      setReplyCounts({});
      return;
    }
    const [startDate, endDate] = selectedWeek.split("_");
    allPlatformKpiService
      .getFbInboxProgressBulk(emails, startDate, endDate)
      .then((res) => {
        if (!res.success || !res.data) {
          setReplyCounts({});
          return;
        }
        const next: Record<string, number> = {};
        for (const [email, info] of Object.entries(res.data)) {
          next[email] = info?.kpi_fb_inbox_count || 0;
        }
        setReplyCounts(next);
      })
      .catch(() => setReplyCounts({}));
  }, [teams, selectedTeamId, selectedWeek]);

  // Get KPI date range for post view (from first member with KPI)
  useEffect(() => {
    if (kpiData.length > 0) {
      const firstMemberWithKpi = kpiData.find(k => k.seeding_stats?.kpi_inbox_range);
      if (firstMemberWithKpi?.seeding_stats?.kpi_inbox_range) {
        setPostDateRange(firstMemberWithKpi.seeding_stats.kpi_inbox_range);
      } else {
        // Default: current week
        const today = new Date();
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const formatLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        setPostDateRange({
          start: formatLocal(monday),
          end: formatLocal(sunday),
        });
      }
    }
  }, [kpiData]);

  const handleAssignKpi = (member: any) => {
    setSelectedMember(member);
    setAssignModalOpen(true);
  };

  const handleViewSeeding = (member: any) => {
    setSelectedMemberSeeding(member);
    setSeedingModalOpen(true);
  };

  // Helper to refresh KPI data
  const refreshKpi = useCallback(() => {
    if (user?.email && selectedTeamId) {
      const [startDate, endDate] = selectedWeek.split("_");
      setIsLoading(true);
      allPlatformKpiService
        .getTeamOverviewV3(user.email, selectedTeamId, startDate, endDate)
        .then((kpiRes) => {
          if (kpiRes.success && kpiRes.data?.members) {
            setKpiData(kpiRes.data.members);
          }
        })
        .finally(() => setIsLoading(false));
    }
  }, [user?.email, selectedTeamId, selectedWeek]);

  const handleKpiAssigned = () => {
    refreshKpi();
  };

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Sua KPI truc tiep tai bang (bam vao so muc tieu la hien input, khong can mo modal).
  const [editingCell, setEditingCell] = useState<{ memberId: string; field: "kpiCallTarget" | "kpiPostTarget" | "kpiCommentTarget" | "kpiInboxTarget" | "kpiLeadTarget" } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const submitInlineKpiEdit = async (member: any) => {
    if (!editingCell || editingCell.memberId !== member.id) return;
    const field = editingCell.field;
    const newVal = Math.max(0, parseInt(editingValue, 10) || 0);
    setEditingCell(null);
    if (newVal === member[field]) return;
    try {
      const [startDate, endDate] = selectedWeek.split("_");
      const callVal = (field === "kpiCallTarget" || field === "kpiPostTarget") ? newVal : (member.kpiCallTarget || member.kpiPostTarget || 0);
      const payload = {
        leader_role: "leader",
        role: "member",
        email: member.email,
        profile_slug: member.profile_slug || member.email,
        email_leader: user?.email || "",
        id_team: selectedTeamId,
        kpi: [{
          start_day: startDate,
          end_day: endDate,
          kpi_comment: field === "kpiCommentTarget" ? newVal : member.kpiCommentTarget,
          kpi_call: callVal,
          kpi_post: callVal,
          kpi_lead: field === "kpiLeadTarget" ? newVal : member.kpiLeadTarget,
          kpi_inbox: field === "kpiInboxTarget" ? newVal : member.kpiInboxTarget,
        }],
        platform: "All",
      };
      const res = await allPlatformKpiService.assign(payload);
      if (res.success) {
        toast.success("Đã cập nhật KPI");
        refreshKpi();
      } else {
        toast.error(res.message || "Không thể cập nhật KPI");
      }
    } catch {
      toast.error("Lỗi hệ thống, vui lòng thử lại.");
    }
  };

  function InlineKpiTarget({ member, field, value }: { member: any; field: "kpiCallTarget" | "kpiPostTarget" | "kpiCommentTarget" | "kpiInboxTarget" | "kpiLeadTarget"; value: number }) {
    const isEditing = editingCell?.memberId === member.id && editingCell?.field === field;
    if (isEditing) {
      return (
        <input
          type="number"
          min={0}
          autoFocus
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => void submitInlineKpiEdit(member)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditingCell(null);
          }}
          className="w-10 text-center text-[10px] font-bold border border-primary rounded px-0.5 py-0 outline-none focus:ring-2 focus:ring-primary/20"
        />
      );
    }
    return (
      <span
        className="text-[10px] text-slate-400 cursor-pointer hover:underline hover:text-primary transition"
        title="Bấm để sửa nhanh chỉ tiêu"
        onClick={() => { setEditingCell({ memberId: member.id, field }); setEditingValue(String(value)); }}
      >
        {" "}/ {value}
      </span>
    );
  }

  // Listen for KPI refresh events (from bulk verify inbox, bulk assign, etc.)
  useKpiRefresh(refreshKpi);

  const selectedTeam = teams.find(t => t.id === selectedTeamId);
  const teamMembers = selectedTeam?.members || [];

  // teamMembers (roster) khong bao gio chua leader (xem comment o membersWithKpi
  // ben duoi) - dung chung logic nay cho danh sach "Giao KPI hang loat" de leader
  // khong bi thieu khoi modal.
  const teamMembersWithLeader = useMemo(() => {
    if (!selectedTeam) return teamMembers;
    const hasLeaderAlready = teamMembers.some(m => m.id === selectedTeam.id_leader);
    if (hasLeaderAlready) return teamMembers;
    return [
      ...teamMembers,
      {
        id: selectedTeam.id_leader,
        email: selectedTeam.leader_email,
        name: selectedTeam.leader_name,
      },
    ];
  }, [teamMembers, selectedTeam]);

  // Map KPI data to members
  const membersWithKpi = useMemo(() => {
    if (!selectedTeam) return [];
    const hasLeaderAlready = teamMembers.some(m => m.id === selectedTeam.id_leader);
    const allMembers = hasLeaderAlready
      ? teamMembers
      : [
          ...teamMembers,
          {
            id: selectedTeam.id_leader,
            email: selectedTeam.leader_email,
            name: selectedTeam.leader_name,
          },
        ];
    return allMembers.map(member => {
      const kpiInfo = kpiData.find(k => k.id === member.id) || {};
      const stats = kpiInfo.seeding_stats || {};
      const kpiCallTarget = stats.kpi_call !== undefined ? stats.kpi_call : (stats.kpi_post || 0);
      const kpiCallCurrent = stats.kpi_call_current !== undefined ? stats.kpi_call_current : (stats.kpi_post_current || 0);
      return {
        ...member,
        kpiCommentTarget: stats.kpi_target || 0,
        kpiCommentCurrent: stats.verified_count || 0,
        kpiCallTarget,
        kpiCallCurrent,
        kpiPostTarget: kpiCallTarget,
        kpiPostCurrent: kpiCallCurrent,
        kpiLeadTarget: stats.kpi_lead || 0,
        kpiLeadCurrent: stats.kpi_lead_current || 0,
        kpiInboxTarget: stats.kpi_inbox || 0,
        kpiInboxCurrent: stats.kpi_inbox_current || 0,
        kpiInboxZalo: stats.kpi_inbox_zalo || 0,
        kpiInboxFbSeeder: stats.kpi_inbox_fb_seeder || 0,
        kpiInboxFbKpi: stats.kpi_inbox_fb_kpi || 0,
        kpiInboxRange: stats.kpi_inbox_range || null,
        seedingItems: kpiInfo.seeding_items || [],
        replyCurrent: replyCounts[(member.email || "").toLowerCase()] || 0,
      };
    });
  }, [teamMembers, kpiData, selectedTeam, replyCounts]);

  // Overall Stats
  const totalKPIProgress = useMemo(() => {
    if (membersWithKpi.length === 0) return 0;
    let sumCurrent = 0;
    let sumTarget = 0;
    membersWithKpi.forEach(m => {
      sumCurrent += m.kpiCommentCurrent + m.kpiCallCurrent + m.kpiLeadCurrent + m.kpiInboxCurrent;
      sumTarget += m.kpiCommentTarget + m.kpiCallTarget + m.kpiLeadTarget + m.kpiInboxTarget;
    });
    if (sumTarget === 0) return 0;
    return Math.min(100, Math.round((sumCurrent / sumTarget) * 100));
  }, [membersWithKpi]);

  // 4 KPI Summary Pillars
  const kpiSummary = useMemo(() => {
    let commentTarget = 0, commentActual = 0;
    let callTarget = 0, callActual = 0;
    let inboxTarget = 0, inboxActual = 0;
    let leadTarget = 0, leadActual = 0;

    membersWithKpi.forEach(m => {
      commentTarget += m.kpiCommentTarget || 0;
      commentActual += m.kpiCommentCurrent || 0;
      callTarget += m.kpiCallTarget || 0;
      callActual += m.kpiCallCurrent || 0;
      inboxTarget += m.kpiInboxTarget || 0;
      inboxActual += m.kpiInboxCurrent || 0;
      leadTarget += m.kpiLeadTarget || 0;
      leadActual += m.kpiLeadCurrent || 0;
    });

    const getPct = (act: number, tgt: number) => tgt === 0 ? (act > 0 ? 100 : 0) : Math.min(100, Math.round((act / tgt) * 100));

    return {
      comment: { target: commentTarget, actual: commentActual, pct: getPct(commentActual, commentTarget) },
      call: { target: callTarget, actual: callActual, pct: getPct(callActual, callTarget) },
      inbox: { target: inboxTarget, actual: inboxActual, pct: getPct(inboxActual, inboxTarget) },
      lead: { target: leadTarget, actual: leadActual, pct: getPct(leadActual, leadTarget) },
    };
  }, [membersWithKpi]);

  // Bar Chart Data
  const barChartData = useMemo(() => {
    return membersWithKpi.slice(0, 10).map(m => {
      const tgt = m.kpiCommentTarget + m.kpiCallTarget + m.kpiInboxTarget + m.kpiLeadTarget;
      const act = m.kpiCommentCurrent + m.kpiCallCurrent + m.kpiInboxCurrent + m.kpiLeadCurrent;
      const rawName = m.name || m.email || "";
      const shortName = rawName.includes("@") ? rawName.split("@")[0] : rawName;
      return {
        name: shortName.length > 10 ? shortName.slice(0, 10) + "…" : shortName,
        "Thực đạt": act,
        "Chỉ tiêu": tgt,
        "Cuộc gọi": m.kpiCallCurrent,
        "Comment": m.kpiCommentCurrent,
        "Inbox": m.kpiInboxCurrent,
        "Lead": m.kpiLeadCurrent,
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
    ].filter(item => item.value > 0);
    return list.length > 0 ? list : [{ name: "Chưa có dữ liệu", value: 1, color: "#e2e8f0" }];
  }, [kpiSummary]);

  // Top 3 Performers
  const topPerformers = useMemo(() => {
    return [...membersWithKpi]
      .map(m => {
        const totalTarget = m.kpiCommentTarget + m.kpiCallTarget + m.kpiInboxTarget + m.kpiLeadTarget;
        const totalActual = m.kpiCommentCurrent + m.kpiCallCurrent + m.kpiInboxCurrent + m.kpiLeadCurrent;
        const pct = totalTarget === 0 ? 0 : Math.round((totalActual / totalTarget) * 100);
        return { ...m, totalTarget, totalActual, pct };
      })
      .sort((a, b) => b.pct - a.pct || b.totalActual - a.totalActual)
      .slice(0, 3);
  }, [membersWithKpi]);

  const toolbarButtonClass =
    "inline-flex min-h-[42px] min-w-[132px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95 cursor-pointer";
  const memberActionButtonClass =
    "inline-flex h-9 min-w-[78px] items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-[10px] font-bold transition";

  const handleDeleteTeam = async () => {
    if (!selectedTeam || !user?.id) return;
    
    const confirmDelete = window.confirm(`Bạn có chắc chắn muốn xóa team "${selectedTeam.name_team}" không?`);
    if (!confirmDelete) return;

    const deletePromise = async () => {
      const res = await teamsService.delete(selectedTeam.name_team, user.id, selectedTeam.id);
      if (!res.success) {
        throw new Error(res.message || "Xóa thất bại");
      }
      setSelectedTeamId("");
      setKpiData([]);
      // Refresh teams list
      const teamsRes = await teamsService.getAll();
      if (teamsRes.success && teamsRes.data) {
        let myTeams: TeamRow[] = [];
        if ((user.role as string) === "admin" || (user.role as string) === "superadmin") {
          myTeams = teamsRes.data;
        } else {
          myTeams = teamsRes.data.filter(t => t.id_leader === user.id);
        }
        setTeams(myTeams);
        // Auto-select first team if available
        if (myTeams.length > 0) {
          setSelectedTeamId(myTeams[0].id);
        }
      }
      return res;
    };

    toast.promise(deletePromise(), {
      loading: "Đang xóa team...",
      success: "Xóa team thành công!",
      error: (err) => err.message || "Xóa team thất bại"
    });
  };

  return (
    <div className="mx-auto w-full max-w-none min-w-0 space-y-6 font-sans">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#E3000F]/10">
          <MaterialIcon name="groups" className="text-[#E3000F] text-3xl" />
        </div>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] text-slate-900">
            Quản lý Team KPI
          </h1>
          <p className="text-sm text-[#A0A0A0]">
            Theo dõi tiến độ KPI và phân công nhiệm vụ cho các thành viên
          </p>
        </div>
      </div>

      <PlatformStatsRow>
        <PlatformStatCard
          label="Tổng số Team"
          value={teams.length}
          hint="Do bạn quản lý"
          accent="primary"
        />
        <PlatformStatCard
          label="Thành viên"
          value={teamMembers.length}
          hint={`Trong team đang chọn`}
          accent="success"
        />
        <PlatformStatCard
          label="Tiến độ KPI"
          value={`${totalKPIProgress}%`}
          hint="Trung bình team"
          accent={totalKPIProgress >= 100 ? "success" : totalKPIProgress > 50 ? "warning" : "error"}
        />
      </PlatformStatsRow>

      {/* 4 Trụ Cột KPI Cốt Lõi (CMT, INBOX, CALL, LEAD) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Cuộc gọi (CALL) - Trọng tâm mới */}
        <div className="rounded-2xl border border-red-100 bg-gradient-to-br from-white to-red-50/30 p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ba244a]/10 text-[#ba244a]">
              <MaterialIcon name="call" className="text-2xl" />
            </div>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-bold",
              kpiSummary.call.pct >= 100 ? "bg-emerald-100 text-emerald-700" :
              kpiSummary.call.pct >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
            )}>
              {kpiSummary.call.pct}%
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cuộc gọi (CALL)</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-slate-900">{kpiSummary.call.actual}</span>
              <span className="text-xs font-semibold text-slate-400">/ {kpiSummary.call.target} chỉ tiêu</span>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#ba244a] transition-all duration-500"
              style={{ width: `${kpiSummary.call.pct}%` }}
            />
          </div>
        </div>

        {/* Card 2: Comment Seeding */}
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/30 p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <MaterialIcon name="comment" className="text-2xl" />
            </div>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-bold",
              kpiSummary.comment.pct >= 100 ? "bg-emerald-100 text-emerald-700" :
              kpiSummary.comment.pct >= 50 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
            )}>
              {kpiSummary.comment.pct}%
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Bình luận (CMT)</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-slate-900">{kpiSummary.comment.actual}</span>
              <span className="text-xs font-semibold text-slate-400">/ {kpiSummary.comment.target} chỉ tiêu</span>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${kpiSummary.comment.pct}%` }}
            />
          </div>
        </div>

        {/* Card 3: Inbox Zalo */}
        <div className="rounded-2xl border border-orange-100 bg-gradient-to-br from-white to-orange-50/30 p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
              <MaterialIcon name="forum" className="text-2xl" />
            </div>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-bold",
              kpiSummary.inbox.pct >= 100 ? "bg-emerald-100 text-emerald-700" :
              kpiSummary.inbox.pct >= 50 ? "bg-amber-100 text-amber-700" : "bg-orange-100 text-orange-700"
            )}>
              {kpiSummary.inbox.pct}%
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Inbox (Zalo Care)</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-slate-900">{kpiSummary.inbox.actual}</span>
              <span className="text-xs font-semibold text-slate-400">/ {kpiSummary.inbox.target} chỉ tiêu</span>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-500"
              style={{ width: `${kpiSummary.inbox.pct}%` }}
            />
          </div>
        </div>

        {/* Card 4: Khách tiềm năng (LEAD) */}
        <div className="rounded-2xl border border-purple-100 bg-gradient-to-br from-white to-purple-50/30 p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <MaterialIcon name="person_add" className="text-2xl" />
            </div>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-bold",
              kpiSummary.lead.pct >= 100 ? "bg-emerald-100 text-emerald-700" :
              kpiSummary.lead.pct >= 50 ? "bg-amber-100 text-amber-700" : "bg-purple-100 text-purple-700"
            )}>
              {kpiSummary.lead.pct}%
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Khách tiềm năng (LEAD)</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-slate-900">{kpiSummary.lead.actual}</span>
              <span className="text-xs font-semibold text-slate-400">/ {kpiSummary.lead.target} chỉ tiêu</span>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-purple-500 transition-all duration-500"
              style={{ width: `${kpiSummary.lead.pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Analytics & Charts Grid */}
      {isMounted && membersWithKpi.length > 0 && (
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

            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: "12px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }}
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
              <div className="h-[140px] w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={38}
                      outerRadius={58}
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
              <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5 mb-3">
                <Trophy className="text-amber-500 w-4 h-4 shrink-0" />
                Top Performers Tuần
              </h4>
              <div className="space-y-2">
                {topPerformers.map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-50/70 border border-slate-100 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0",
                        idx === 0 ? "bg-amber-100 text-amber-700" :
                        idx === 1 ? "bg-slate-200 text-slate-700" : "bg-orange-100 text-orange-700"
                      )}>
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-800 truncate">{p.name || p.email}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-extrabold text-[#ba244a]">{p.pct}%</span>
                      <span className="text-[10px] text-slate-400">({p.totalActual}/{p.totalTarget})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-none">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-600">
              <span>Chọn Team:</span>
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20"
            >
              {teams.length === 0 && <option value="">Chưa có team</option>}
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_team}
                </option>
              ))}
            </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-600">
              <span>Tuần:</span>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20"
            >
              {recentWeeks.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {((user?.role as string) === "admin" || (user?.role as string) === "superadmin") && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setInboxMember({ email: "", name: "Toàn bộ" });
                    setInboxModalOpen(true);
                  }}
                  className={cn(
                    toolbarButtonClass,
                    "border border-orange-100 bg-orange-50 text-orange-700 hover:bg-orange-100",
                  )}
                >
                  <MaterialIcon name="forum" className="text-[16px]" />
                  Xem Tất Cả Inbox
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPostMember({ email: "", name: "Toàn bộ" });
                    setPostModalOpen(true);
                  }}
                  className={cn(
                    toolbarButtonClass,
                    "border border-red-100 bg-red-50 text-[#ba244a] hover:bg-red-100",
                  )}
                >
                  <MaterialIcon name="call" className="text-[16px]" />
                  Xem Tất Cả Cuộc Gọi
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setIsEditingTeam(false);
                setTeamModalOpen(true);
              }}
              className={cn(
                toolbarButtonClass,
                "bg-[#E3000F] text-white hover:bg-[#C40009]",
              )}
            >
              <MaterialIcon name="add" className="text-[16px]" />
              Thêm Team Mới
            </button>

            {selectedTeam && (
              <>
                <button
                  type="button"
                  onClick={() => setBulkAssignModalOpen(true)}
                  className={cn(
                    toolbarButtonClass,
                    "bg-blue-600 text-white hover:bg-blue-700",
                  )}
                >
                  <MaterialIcon name="group_add" className="text-[16px]" />
                  Giao KPI Hàng Loạt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingTeam(true);
                    setTeamModalOpen(true);
                  }}
                  className={cn(
                    toolbarButtonClass,
                    "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  <MaterialIcon name="edit" className="text-[16px]" />
                  Sửa Team
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTeam}
                  className={cn(
                    toolbarButtonClass,
                    "border border-red-100 bg-red-50 text-red-600 hover:bg-red-100",
                  )}
                >
                  <MaterialIcon name="delete" className="text-[16px]" />
                  Xóa Team
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3 p-4 md:hidden">
          {isLoading ? (
            // Phase 3: skeleton thay vì spinner — giữ layout, tránh nháy
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 animate-pulse">
                  <div className="flex justify-between gap-3">
                    <div className="space-y-2 flex-1">
                      <div className="h-3 w-32 rounded bg-slate-100" />
                      <div className="h-2 w-44 rounded bg-slate-100" />
                    </div>
                    <div className="h-5 w-12 rounded-full bg-slate-100" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="h-2 w-10 rounded bg-slate-100" />
                        <div className="mt-2 h-3 w-14 rounded bg-slate-100" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : membersWithKpi.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Chưa có thành viên nào trong team này.
            </div>
          ) : (
            membersWithKpi.map((member) => {
              const totalTarget =
                member.kpiCommentTarget +
                member.kpiCallTarget +
                member.kpiLeadTarget +
                member.kpiInboxTarget;
              const totalCurrent =
                member.kpiCommentCurrent +
                member.kpiCallCurrent +
                member.kpiLeadCurrent +
                member.kpiInboxCurrent;
              const percent =
                totalTarget === 0 ? 0 : Math.min(100, Math.round((totalCurrent / totalTarget) * 100));

              return (
                <div key={member.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{member.name || "N/A"}</p>
                      <p className="truncate text-[11px] text-slate-400">{member.email}</p>
                    </div>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {percent}%
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {[
                      { label: "Cuộc gọi (CALL)", current: member.kpiCallCurrent, target: member.kpiCallTarget, hasTarget: true },
                      { label: "Comment", current: member.kpiCommentCurrent, target: member.kpiCommentTarget, hasTarget: true },
                      { label: "Inbox", current: member.kpiInboxCurrent, target: member.kpiInboxTarget, hasTarget: true },
                      { label: "Khách reply (tham khảo)", current: member.replyCurrent, target: 0, hasTarget: false },
                      { label: "Lead", current: member.kpiLeadCurrent, target: member.kpiLeadTarget, hasTarget: true },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold text-slate-400">{item.label}</p>
                        <p className="mt-1 text-sm font-bold text-slate-900">
                          {item.current}
                          {item.hasTarget && <span className="ml-1 text-xs font-medium text-slate-400">/ {item.target}</span>}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        percent >= 100 ? "bg-emerald-500" : percent > 50 ? "bg-amber-500" : "bg-[#ba244a]",
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleViewSeeding(member)}
                      className={cn(
                        memberActionButtonClass,
                        "border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100",
                      )}
                    >
                      <MaterialIcon name="visibility" className="text-[12px]" />
                      Seeding
                    </button>
                    <button
                      onClick={() => {
                        setInboxMember({ email: member.email, name: member.name || member.email });
                        setInboxModalOpen(true);
                      }}
                      className={cn(
                        memberActionButtonClass,
                        "border border-orange-100 bg-orange-50 text-orange-700 hover:bg-orange-100",
                      )}
                    >
                      <MaterialIcon name="forum" className="text-[12px]" />
                      Inbox
                    </button>
                    <button
                      onClick={() => {
                        setPostMember({ email: member.email, name: member.name || member.email });
                        setPostModalOpen(true);
                      }}
                      className={cn(
                        memberActionButtonClass,
                        "border border-red-100 bg-red-50 text-[#ba244a] hover:bg-red-100",
                      )}
                    >
                      <MaterialIcon name="call" className="text-[12px]" />
                      Cuộc gọi
                    </button>
                    <button
                      onClick={() => handleAssignKpi(member)}
                      className={cn(
                        memberActionButtonClass,
                        "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200",
                      )}
                    >
                      <MaterialIcon name="assignment" className="text-[12px]" />
                      KPI
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden w-full overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-[12px]">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">Thành viên</th>
                <th className="px-1 py-2.5 text-center whitespace-nowrap text-[#ba244a]" title="Số cuộc gọi tư vấn khách hàng ghi nhận từ Post Call Results">Cuộc gọi (CALL)</th>
                <th className="px-1 py-2.5 text-center whitespace-nowrap">Comment</th>
                <th className="px-1 py-2.5 text-center whitespace-nowrap" title="Số HỘI THOẠI tính KPI: Zalo đã xác minh + Facebook đã tính KPI">Inbox</th>
                <th className="px-1 py-2.5 text-center whitespace-nowrap" title="Số TIN NHẮN khách gửi tới. Chỉ tham khảo — không cộng vào KPI Inbox.">Khách reply (tham khảo)</th>
                <th className="px-1 py-2.5 text-center whitespace-nowrap">Lead</th>
                <th className="px-2 py-2.5 text-center whitespace-nowrap">Tiến độ</th>
                <th className="px-2 py-2.5 text-center whitespace-nowrap">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                // Phase 3: skeleton rows giữ layout, không nháy
                Array.from({ length: 6 }).map((_, i) => <MemberRowSkeleton key={`sk-${i}`} />)
              ) : membersWithKpi.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-slate-400 italic">
                    Chưa có thành viên nào trong team này.
                  </td>
                </tr>
              ) : (
                membersWithKpi.map((member) => {
                  const totalTarget =
                    member.kpiCommentTarget +
                    member.kpiCallTarget +
                    member.kpiLeadTarget +
                    member.kpiInboxTarget;
                  const totalCurrent =
                    member.kpiCommentCurrent +
                    member.kpiCallCurrent +
                    member.kpiLeadCurrent +
                    member.kpiInboxCurrent;
                  const percent = totalTarget === 0 ? 0 : Math.min(100, Math.round((totalCurrent / totalTarget) * 100));

                  return (
                    <tr key={member.id} className="transition hover:bg-slate-50/50">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="whitespace-nowrap text-xs font-bold text-slate-800">{member.name || "N/A"}</span>
                          {totalTarget === 0 && (
                            <span
                              className="whitespace-nowrap rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700"
                              title="Tuần này chưa giao chỉ tiêu KPI cho thành viên này"
                            >
                              Chưa giao KPI
                            </span>
                          )}
                        </div>
                        <div className="max-w-[120px] truncate text-[10px] font-medium text-slate-400" title={member.email}>{member.email}</div>
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span className={cn("text-[11px] font-bold", member.kpiCallCurrent > 0 ? "text-[#ba244a]" : "text-slate-800")}>{member.kpiCallCurrent}</span>
                        <InlineKpiTarget member={member} field="kpiCallTarget" value={member.kpiCallTarget} />
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span className="text-[11px] font-bold text-slate-800">{member.kpiCommentCurrent}</span>
                        <InlineKpiTarget member={member} field="kpiCommentTarget" value={member.kpiCommentTarget} />
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span
                          className={cn("text-[11px] font-bold", member.kpiInboxCurrent >= member.kpiInboxTarget && member.kpiInboxTarget > 0 ? "text-emerald-600" : "text-slate-800")}
                          title={`Tổng ${member.kpiInboxCurrent} hội thoại — Zalo đã xác minh: ${member.kpiInboxZalo}, Facebook đã tính KPI: ${member.kpiInboxFbKpi}`}
                        >
                          {member.kpiInboxCurrent}
                        </span>
                        <InlineKpiTarget member={member} field="kpiInboxTarget" value={member.kpiInboxTarget} />
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span
                          className="text-[11px] font-bold text-slate-500"
                          title="Số tin nhắn khách gửi tới trong tuần. Chỉ để tham khảo — KHÔNG cộng vào KPI Inbox."
                        >
                          {member.replyCurrent}
                        </span>
                      </td>
                      <td className="px-1 py-2.5 text-center">
                        <span className="text-[11px] font-bold text-slate-800">{member.kpiLeadCurrent}</span>
                        <InlineKpiTarget member={member} field="kpiLeadTarget" value={member.kpiLeadTarget} />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn("h-full rounded-full transition-all duration-500", percent >= 100 ? "bg-emerald-500" : percent > 50 ? "bg-amber-500" : "bg-[#ba244a]")}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                              percent >= 100 ? "bg-emerald-100 text-emerald-700" :
                              percent > 50 ? "bg-amber-100 text-amber-700" :
                              "bg-slate-100 text-slate-600",
                            )}
                          >
                            {percent}%
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <button onClick={() => handleViewSeeding(member)}
                            className={cn(
                              memberActionButtonClass,
                              "border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100",
                            )}>
                            <MaterialIcon name="visibility" className="text-[12px]" />Seeding
                          </button>
                          <button onClick={() => {
                            setInboxMember({ email: member.email, name: member.name || member.email });
                            setInboxModalOpen(true);
                          }}
                            className={cn(
                              memberActionButtonClass,
                              "border border-orange-100 bg-orange-50 text-orange-700 hover:bg-orange-100",
                            )}>
                            <MaterialIcon name="forum" className="text-[12px]" />Inbox
                          </button>
                          <button onClick={() => {
                            setPostMember({ email: member.email, name: member.name || member.email });
                            setPostModalOpen(true);
                          }}
                            className={cn(
                              memberActionButtonClass,
                              "border border-red-100 bg-red-50 text-[#ba244a] hover:bg-red-100",
                            )}>
                            <MaterialIcon name="call" className="text-[12px]" />Cuộc gọi
                          </button>
                          <button onClick={() => handleAssignKpi(member)}
                            className={cn(
                              memberActionButtonClass,
                              "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200",
                            )}>
                            <MaterialIcon name="assignment" className="text-[12px]" />KPI
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTeamId && (
        <div className="mt-5 space-y-5">
          <KpiRewardRuleTable teamId={selectedTeamId} selectedWeek={selectedWeek} />
        </div>
      )}

      {selectedTeamId && (
        <LeaderKpiRewardSections
          teamId={selectedTeamId}
          selectedWeek={selectedWeek}
        />
      )}

      {assignModalOpen && selectedMember && (
        <AssignKpiModal
          isOpen={assignModalOpen}
          onClose={() => setAssignModalOpen(false)}
          member={selectedMember}
          teamId={selectedTeamId}
          selectedWeekValue={selectedWeek}
          onSuccess={handleKpiAssigned}
        />
      )}

      {bulkAssignModalOpen && selectedTeam && (
        <BulkAssignKpiModal
          isOpen={bulkAssignModalOpen}
          onClose={() => setBulkAssignModalOpen(false)}
          members={teamMembersWithLeader}
          teamId={selectedTeamId}
          selectedWeekValue={selectedWeek}
          onSuccess={handleKpiAssigned}
        />
      )}

      {seedingModalOpen && selectedMemberSeeding && (
        <SeedingModal
          isOpen={seedingModalOpen}
          onClose={() => setSeedingModalOpen(false)}
          member={selectedMemberSeeding}
        />
      )}

      {inboxModalOpen && inboxMember && (
        <LeaderInboxView
          isOpen={inboxModalOpen}
          onClose={() => setInboxModalOpen(false)}
          memberEmail={inboxMember.email}
          memberName={inboxMember.name}
          onStatusChange={refreshKpi}
        />
      )}

      {postModalOpen && postMember && (
        <LeaderPostView
          isOpen={postModalOpen}
          onClose={() => setPostModalOpen(false)}
          memberEmail={postMember.email}
          memberName={postMember.name}
          startDate={postDateRange?.start}
          endDate={postDateRange?.end}
          onStatusChange={refreshKpi}
        />
      )}

      {teamModalOpen && user?.id && (
        <TeamModal
          isOpen={teamModalOpen}
          onClose={() => setTeamModalOpen(false)}
          team={isEditingTeam ? selectedTeam || null : null}
          leaderId={user.id}
          onSuccess={() => {
            // Refresh teams list by re-triggering the teams effect
            if (!["leader", "admin", "superadmin"].includes(user.role || "")) return;
            
            teamsService.getAll()
              .then(teamsRes => {
                if (teamsRes.success && teamsRes.data) {
                  let myTeams: TeamRow[] = [];
                  if ((user.role as string) === "admin" || (user.role as string) === "superadmin") {
                    myTeams = teamsRes.data;
                  } else {
                    myTeams = teamsRes.data.filter(t => t.id_leader === user.id);
                  }
                  setTeams(myTeams);
                  // Auto-select first team if none selected
                  if (myTeams.length > 0 && !selectedTeamId) {
                    setSelectedTeamId(myTeams[0].id);
                  }
                }
              });
          }}
        />
      )}
    </div>
  );
}
