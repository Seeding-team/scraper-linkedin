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
  onManageAccounts?: () => void;
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
  onManageAccounts,
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
    if (status === "online") return "bg-emerald-500 shadow-emerald-400";
    if (status === "connecting") return "bg-amber-400 animate-pulse";
    if (status === "expired") return "bg-red-500";
    return "bg-slate-300";
  };

  const ownerLabel = useCallback(
    (ownerId: string, fallback?: string) => {
      if (ownerId && ownerNames[ownerId]) return ownerNames[ownerId];
      if (fallback) return fallback;
      if (!ownerId) return "Chưa gán";
      return ownerId.includes("@") ? ownerId.split("@")[0] : ownerId;
    },
    [ownerNames]
  );

  const accountLabel = useCallback((s: ZaloAccountInfo) => {
    return s.label || (s as any).profile?.display_name || s.phone || s.account_id;
  }, []);

  const accountSubLabel = useCallback((s: ZaloAccountInfo) => {
    const parts: string[] = [];
    if (s.phone) parts.push(s.phone);
    if (s.listener?.auth_expired) parts.push("hết phiên");
    else if (s.listener?.connected) parts.push("online");
    else if (s.listener?.running) parts.push("connecting");
    else parts.push("offline");
    return parts.join(" - ");
  }, []);

  // Filter accounts
  const query = q.trim().toLowerCase();

  const filteredSessions = useMemo(() => {
    if (!query) return sessions;
    return sessions.filter((s) => {
      const label = accountLabel(s).toLowerCase();
      const phone = (s.phone || "").toLowerCase();
      const accId = s.account_id.toLowerCase();
      return label.includes(query) || phone.includes(query) || accId.includes(query);
    });
  }, [sessions, query, accountLabel]);

  // Build Team options
  const teamOptions = useMemo<TeamOption[]>(() => {
    const accountsByOwner = new Map<string, ZaloAccountInfo[]>();
    for (const session of sessions) {
      const ownerId = (session as any).assigned_user_id || session.owner_id || "";
      const current = accountsByOwner.get(ownerId) || [];
      current.push(session);
      accountsByOwner.set(ownerId, current);
    }

    const assignedOwners = new Set<string>();
    const options: TeamOption[] = [];

    const buildGroup = (ownerId: string, customName?: string, customRole?: string): OwnerGroup => {
      const accs = accountsByOwner.get(ownerId) || [];
      return {
        ownerId,
        name: customName || ownerLabel(ownerId),
        roleLabel: customRole || (ownerId === owner ? "Leader" : "Member"),
        accounts: accs,
        online: accs.filter((s) => getAccountStatus(s) === "online").length,
        offline: accs.filter((s) => getAccountStatus(s) !== "online").length,
      };
    };

    for (const team of teams) {
      const members = team.members || [];
      const groups: OwnerGroup[] = [];
      let total = 0;

      for (const member of members) {
        const ownerId = member.id || member.email || "";
        if (!ownerId) continue;
        assignedOwners.add(ownerId);
        const group = buildGroup(ownerId, member.name || member.email || ownerId);
        if (group.accounts.length > 0) {
          groups.push(group);
          total += group.accounts.length;
        }
      }

      options.push({
        id: team.id || `team_${Math.random()}`,
        name: team.name_team || "Team",
        leaderName: "Leader",
        groups,
        total,
        online: groups.reduce((sum, group) => sum + group.online, 0),
      });
    }

    if (options.length === 0 || sessions.length > 0) {
      const groups = Array.from(accountsByOwner.keys()).map((ownerId) =>
        buildGroup(ownerId, undefined, ownerId === owner ? "Tôi" : "User")
      );
      options.push({
        id: "all_accounts",
        name: "Tất cả",
        leaderName: "Chung",
        groups,
        total: sessions.length,
        online: sessions.filter((s) => getAccountStatus(s) === "online").length,
      });
    }

    return options.filter((o) => o.total > 0 || o.id === "all_accounts");
  }, [sessions, teams, owner, accountLabel, ownerLabel, getAccountStatus]);

  const selected = sessions.find((s) => s.account_id === selectedAcc);

  // Close picker on outside click
  useEffect(() => {
    if (!accountOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [accountOpen]);

  const onlineCount = sessions.filter((s) => s.listener?.connected).length;
  const expiredCount = sessions.filter((s) => s.listener?.auth_expired).length;
  const offlineCount = sessions.length - onlineCount - expiredCount;

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      {/* Team Dropdown */}
      {teamOptions.length > 1 && (
        <select
          value={teamId || teamOptions[0]?.id || ""}
          onChange={(e) => setTeamId(e.target.value)}
          className="h-8 max-w-[150px] truncate rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-[#0068FF] shadow-2xs"
        >
          {teamOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name} ({opt.total})
            </option>
          ))}
        </select>
      )}

      {/* Account Picker */}
      <div ref={pickerRef} className="relative min-w-[200px] max-w-[280px]">
        <button
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          className="flex h-8 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-left text-xs outline-none hover:border-[#0068FF] focus:border-[#0068FF] shadow-2xs transition cursor-pointer"
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", statusClasses(getAccountStatus(selected)))} />
              <span className="truncate font-bold text-slate-800">{accountLabel(selected)}</span>
              {selected.phone && <span className="text-[11px] text-slate-400 truncate hidden sm:inline">({selected.phone})</span>}
            </span>
          ) : (
            <span className="text-slate-400">Chọn tài khoản Zalo</span>
          )}
          <MaterialIcon name="arrow_drop_down" className="text-base text-slate-400 shrink-0" />
        </button>

        {accountOpen && (
          <div className="absolute z-50 mt-1 max-h-72 w-full min-w-[260px] overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {filteredSessions.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-slate-400">Không có tài khoản phù hợp</div>
            ) : (
              filteredSessions.map((session) => {
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
                      "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer",
                      active ? "bg-blue-50 text-[#0068FF] font-bold" : "hover:bg-slate-50 text-slate-700"
                    )}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", statusClasses(status))} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="block truncate font-bold">{accountLabel(session)}</span>
                      <span className="block truncate text-[10px] text-slate-400">{accountSubLabel(session)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Search Account input */}
      <div className="relative w-28 sm:w-32 hidden md:block">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm acc..."
          className="h-8 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-[#0068FF] shadow-2xs"
        />
      </div>

      {/* Online / Offline status pills */}
      <div className="flex items-center gap-1 text-[11px] font-bold shrink-0">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {onlineCount}
        </span>
        {expiredCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            {expiredCount}
          </span>
        )}
      </div>

      {/* Quản lý tài khoản button */}
      {onManageAccounts && (
        <button
          type="button"
          onClick={onManageAccounts}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-xl text-xs font-bold text-white bg-[#0068FF] hover:bg-[#0052cc] shadow-xs hover:shadow-md transition cursor-pointer shrink-0"
          title="Quản lý tài khoản Zalo, Đăng nhập 1-chạm & Cấp quyền"
        >
          <MaterialIcon name="manage_accounts" className="text-[15px]" />
          <span>Quản lý tài khoản</span>
        </button>
      )}
    </div>
  );
}
