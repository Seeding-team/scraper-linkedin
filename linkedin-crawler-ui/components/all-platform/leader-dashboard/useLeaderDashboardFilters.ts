"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { teamsService, type TeamMember, type TeamRow } from "@/services/all-platform.service";
import { periodRange, prevPeriodRange, type Period } from "./shared";

export interface LeaderDashboardFilters {
  period: Period;
  setPeriod: (p: Period) => void;
  teamId: string | null;
  setTeamId: (id: string | null) => void;
  memberId: string | null;
  setMemberId: (id: string | null) => void;
  platform: string | null;
  setPlatform: (p: string | null) => void;
  search: string;
  setSearch: (s: string) => void;
  reset: () => void;

  teams: TeamRow[];
  memberOptions: TeamMember[];
  isLoadingTeams: boolean;

  date_from: string;
  date_to: string;
  prev_date_from: string;
  prev_date_to: string;
}

/** State bộ lọc chung của Dashboard Leader (kỳ/Team/thành viên/nền tảng/tìm kiếm) + danh sách
 * Team/thành viên dùng cho dropdown — tái dùng `teamsService.getAll()` đã có sẵn (không cần
 * endpoint mới), lọc theo role: leader chỉ thấy (các) team mình là `id_leader`. */
export function useLeaderDashboardFilters(currentUserId: string | undefined, role: string | undefined): LeaderDashboardFilters {
  const [period, setPeriod] = useState<Period>("7");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingTeams(true);
      try {
        const res = await teamsService.getAll();
        if (!cancelled && res.success && res.data) {
          const isLeader = (role || "").toLowerCase() === "leader";
          const scoped = isLeader && currentUserId
            ? res.data.filter((t) => t.id_leader === currentUserId)
            : res.data;
          setTeams(scoped);
        }
      } catch {
        // ignore — bộ lọc Team chỉ là tiện ích, không chặn trang chính nếu lỗi
      } finally {
        if (!cancelled) setIsLoadingTeams(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserId, role]);

  const memberOptions = useMemo<TeamMember[]>(() => {
    const pool = teamId ? teams.filter((t) => t.id === teamId) : teams;
    const dedup = new Map<string, TeamMember>();
    pool.forEach((t) => (t.members || []).forEach((m) => dedup.set(m.id, m)));
    return Array.from(dedup.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [teams, teamId]);

  // Đổi Team -> nếu thành viên đang chọn không còn thuộc team mới, bỏ chọn thành viên.
  useEffect(() => {
    if (memberId && !memberOptions.some((m) => m.id === memberId)) {
      setMemberId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const reset = useCallback(() => {
    setPeriod("7");
    setTeamId(null);
    setMemberId(null);
    setPlatform(null);
    setSearch("");
  }, []);

  const { date_from, date_to } = useMemo(() => periodRange(period), [period]);
  const { date_from: prev_date_from, date_to: prev_date_to } = useMemo(() => prevPeriodRange(period), [period]);

  return {
    period, setPeriod,
    teamId, setTeamId,
    memberId, setMemberId,
    platform, setPlatform,
    search, setSearch,
    reset,
    teams, memberOptions, isLoadingTeams,
    date_from, date_to, prev_date_from, prev_date_to,
  };
}
