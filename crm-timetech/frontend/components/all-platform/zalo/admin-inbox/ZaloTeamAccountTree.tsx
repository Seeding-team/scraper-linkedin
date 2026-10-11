"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ZaloAccountInfo } from "@/types/zalo-api";
import type { TeamRow } from "@/hooks/useZaloAdminInbox";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

export type AccountStatus = "online" | "connecting" | "expired" | "offline";

interface Props {
  sessions: ZaloAccountInfo[];
  ownerNames: Record<string, string>;
  teams: TeamRow[];
  selectedAcc: string;
  onSelect: (accountId: string) => void;
  role: string;
  owner: string;
}

interface OwnerGroup {
  ownerId: string;
  name: string;
  roleLabel: string;
  accounts: ZaloAccountInfo[];
  online: number;
  offline: number;
}

interface TeamOption {
  id: string;
  name: string;
  leaderName: string;
  groups: OwnerGroup[];
  total: number;
  online: number;
}

const UNASSIGNED_TEAM_ID = "__unassigned__";

export default function ZaloTeamAccountTree({
  sessions,
  ownerNames,
  teams,
  selectedAcc,
  onSelect,
  role,
  owner,
}: Props) {
  const [q, setQ] = useState("");
  const [teamId, setTeamId] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const getAccountStatus = useCallback((s: ZaloAccountInfo): AccountStatus => {
    if (s.listener?.auth_expired) return "expired";
    if (s.listener?.connected) return "online";
    if (s.listener?.running) return "connecting";
    return "offline";
  }, []);

  const statusClasses = (status: AccountStatus) => {
    if (status === "online") return "bg-green-500 shadow-green-400";
    if (status === "connecting") return "bg-amber-400 animate-pulse";
    if (status === "expired") return "bg-red-500";
    return "bg-gray-300";
  };

  const ownerLabel = useCallback(
    (ownerId: string, fallback?: string) =>
      ownerNames[ownerId] ||
      fallback ||
      (ownerId === owner ? "Tài khoản của tôi" : ownerId || "Chưa gán nhân viên"),
    [ownerNames, owner]
  );

  const accountLabel = useCallback(
    (s: ZaloAccountInfo) => {
      const explicit = (s.label || "").trim();
      if (explicit && explicit !== s.account_id) return explicit;
      return (s.owner_id && ownerLabel(s.owner_id)) || "Tài khoản Zalo";
    },
    [ownerLabel]
  );

  const accountSubLabel = (s: ZaloAccountInfo) => {
    const status = getAccountStatus(s);
    const phone = s.phone ? `(${s.phone})` : s.account_id;
    return `${phone} - ${status}`;
  };

  const teamOptions = useMemo<TeamOption[]>(() => {
    const accountsByOwner = new Map<string, ZaloAccountInfo[]>();
    for (const session of sessions) {
      const key = session.owner_id || "";
      if (!accountsByOwner.has(key)) accountsByOwner.set(key, []);
      accountsByOwner.get(key)!.push(session);
    }

    const assignedOwners = new Set<string>();
    const buildGroup = (ownerId: string, fallbackName: string | undefined, roleLabel: string): OwnerGroup => {
      const accounts = [...(accountsByOwner.get(ownerId) || [])].sort((a, b) => {
        const statA = getAccountStatus(a) === "online" ? 1 : 0;
        const statB = getAccountStatus(b) === "online" ? 1 : 0;
        return statB - statA || accountLabel(a).localeCompare(accountLabel(b));
      });
      return {
        ownerId,
        name: ownerLabel(ownerId, fallbackName),
        roleLabel,
        accounts,
        online: accounts.filter((s) => getAccountStatus(s) === "online").length,
        offline: accounts.filter((s) => getAccountStatus(s) !== "online").length,
      };
    };

    const options: TeamOption[] = [];
    for (const team of teams) {
      const id = team.id || team.id_leader || `team-${options.length}`;
      const leaderId = team.id_leader || "";
      const groups: OwnerGroup[] = [];

      if (leaderId) {
        assignedOwners.add(leaderId);
        groups.push(buildGroup(leaderId, team.leader_name || team.leader_email, "Leader"));
      }

      for (const member of team.members || []) {
        const memberId = member.id || "";
        if (!memberId || memberId === leaderId) continue;
        assignedOwners.add(memberId);
        groups.push(buildGroup(memberId, member.name || member.email, "User"));
      }

      const total = groups.reduce((sum, group) => sum + group.accounts.length, 0);
      options.push({
        id,
        name: team.name_team || (role === "leader" ? "Team của tôi" : "Team chưa đặt tên"),
        leaderName: ownerLabel(leaderId, team.leader_name || team.leader_email),
        groups,
        total,
        online: groups.reduce((sum, group) => sum + group.online, 0),
      });
    }

    if (role === "admin") {
      const unassignedOwners = Array.from(accountsByOwner.keys()).filter(
        (ownerId) => ownerId && !assignedOwners.has(ownerId)
      );
      if (unassignedOwners.length > 0) {
        const groups = unassignedOwners
          .map((ownerId) => buildGroup(ownerId, undefined, "Chưa thuộc team"))
          .sort((a, b) => a.name.localeCompare(b.name));
        options.push({
          id: UNASSIGNED_TEAM_ID,
          name: "Chưa thuộc team",
          leaderName: "Chưa có leader",
          groups,
          total: groups.reduce((sum, group) => sum + group.accounts.length, 0),
          online: groups.reduce((sum, group) => sum + group.online, 0),
        });
      }
    }

    if (options.length === 0 && sessions.length > 0) {
      const groups = Array.from(accountsByOwner.keys())
        .map((ownerId) => buildGroup(ownerId, undefined, ownerId === owner ? "Tôi" : "User"))
        .sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
      options.push({
        id: "accounts",
        name: role === "leader" ? "Team của tôi" : "Tài khoản",
        leaderName: ownerLabel(owner),
        groups,
        total: sessions.length,
        online: sessions.filter((s) => getAccountStatus(s) === "online").length,
      });
    }

    return options
      .filter((option) => option.groups.length > 0)
      .sort((a, b) => {
        const selectedA = a.groups.some((group) => group.accounts.some((s) => s.account_id === selectedAcc));
        const selectedB = b.groups.some((group) => group.accounts.some((s) => s.account_id === selectedAcc));
        if (selectedA !== selectedB) return Number(selectedB) - Number(selectedA);
        if (a.id === UNASSIGNED_TEAM_ID) return 1;
        if (b.id === UNASSIGNED_TEAM_ID) return -1;
        return b.online - a.online || a.name.localeCompare(b.name);
      });
  }, [sessions, teams, owner, selectedAcc, role, accountLabel, ownerLabel, getAccountStatus]);

  const selectedTeam = teamOptions.find((option) =>
    option.groups.some((group) => group.accounts.some((s) => s.account_id === selectedAcc))
  );

  const activeTeamId =
    teamId && teamOptions.some((option) => option.id === teamId)
      ? teamId
      : selectedTeam?.id || teamOptions[0]?.id || "";

  const activeTeam = teamOptions.find((option) => option.id === activeTeamId) || teamOptions[0];
  const query = q.trim().toLowerCase();

  const visibleGroups = (activeTeam?.groups || []).map((group) => ({
    ...group,
    accounts: group.accounts.filter((session) => {
      const haystack = `${activeTeam?.name || ""} ${group.name} ${accountLabel(session)} ${session.account_id}`.toLowerCase();
      return !query || haystack.includes(query);
    }),
  }));

  const visibleAccounts = visibleGroups.flatMap((group) => group.accounts);

  const onlineCount = sessions.filter((s) => getAccountStatus(s) === "online").length;
  const connectingCount = sessions.filter((s) => getAccountStatus(s) === "connecting").length;
  const expiredCount = sessions.filter((s) => getAccountStatus(s) === "expired").length;
  const offlineCount = sessions.length - onlineCount - connectingCount - expiredCount;

  const selected = sessions.find((s) => s.account_id === selectedAcc);
  const selectedOwnerName = selected ? ownerLabel(selected.owner_id || "") : "";

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const selectTeam = (nextTeamId: string) => {
    setTeamId(nextTeamId);
    setAccountOpen(false);
    const nextTeam = teamOptions.find((option) => option.id === nextTeamId);
    const firstAccount = nextTeam?.groups.flatMap((group) => group.accounts)[0];
    onSelect(firstAccount?.account_id || "");
  };

  return (
    <div className="w-full space-y-2">
      <div className="grid gap-2 xl:grid-cols-[minmax(190px,260px)_minmax(280px,1fr)_minmax(200px,280px)_auto] xl:items-center">
        {/* Team selector dropdown */}
        <select
          value={activeTeam?.id || ""}
          onChange={(e) => selectTeam(e.target.value)}
          className="h-9 w-full rounded-lg border border-[#E5E5E5] bg-white px-3 text-sm font-semibold text-[#1A1A1A] outline-none focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20"
        >
          {teamOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.total})
            </option>
          ))}
        </select>

        {/* Account picker dropup/dropdown */}
        <div ref={pickerRef} className="relative">
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-[#E5E5E5] bg-white px-3 text-left text-sm outline-none transition hover:border-[#E3000F]/60 focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20"
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", statusClasses(getAccountStatus(selected)))} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[#1A1A1A]">{accountLabel(selected)}</span>
                  <span className="block truncate text-[11px] text-[#A0A0A0]">{accountSubLabel(selected)}</span>
                </span>
              </span>
            ) : (
              <span className="text-[#A0A0A0]">Chọn tài khoản Zalo</span>
            )}
            <MaterialIcon name="arrow_drop_down" className="text-[20px] text-[#777777]" />
          </button>

          {accountOpen && (
            <div className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[#E5E5E5] bg-white p-1 shadow-lg">
              {visibleAccounts.length === 0 ? (
                <div className="px-3 py-3 text-center text-xs text-[#A0A0A0]">Không có tài khoản phù hợp</div>
              ) : (
                visibleGroups.map((group) => (
                  <div key={group.ownerId || "__no_owner__"} className="py-1">
                    <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#A0A0A0]">
                      {group.name} - {group.roleLabel}
                    </div>
                    {group.accounts.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[#A0A0A0]">Chưa có tài khoản Zalo</div>
                    ) : (
                      group.accounts.map((session) => {
                        const active = session.account_id === selectedAcc;
                        const status = getAccountStatus(session);
                        return (
                          <button
                            key={session.account_id}
                            type="button"
                            onClick={() => {
                              onSelect(session.account_id);
                              setAccountOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition",
                              active ? "bg-[#FFF5F5] text-[#C40009]" : "hover:bg-[#F5F5F5] text-[#1A1A1A]"
                            )}
                          >
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", statusClasses(status))} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{accountLabel(session)}</span>
                              <span className="block truncate text-[11px] text-[#A0A0A0]">
                                {accountSubLabel(session)}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Account search */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm user / acc..."
          className="h-9 w-full rounded-lg border border-[#E5E5E5] bg-white px-3 text-sm text-[#1A1A1A] outline-none focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20"
        />

        {/* Counter badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#666666] xl:justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {onlineCount}
          </span>
          {connectingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              {connectingCount}
            </span>
          )}
          {expiredCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-red-700">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {expiredCount}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F5] px-2.5 py-1 text-[#777777]">
            <span className="h-2 w-2 rounded-full bg-gray-300" />
            {offlineCount}
          </span>
        </div>
      </div>

      {/* Selected Account Detail line */}
      {activeTeam && (
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#777777]">
          <span className="font-semibold text-[#1A1A1A]">{activeTeam.name}</span>
          <span>
            Leader: <b className="text-[#666666]">{activeTeam.leaderName}</b>
          </span>
          {selected && (
            <>
              <span className="text-[#D6D6D6]">|</span>
              <span className="font-bold text-[#C40009]">Đang chọn</span>
              <span className={cn("h-2 w-2 rounded-full", statusClasses(getAccountStatus(selected)))} />
              <span className="font-semibold text-[#1A1A1A]">{accountLabel(selected)}</span>
              <span>của</span>
              <span className="font-semibold text-[#666666]">{selectedOwnerName}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
