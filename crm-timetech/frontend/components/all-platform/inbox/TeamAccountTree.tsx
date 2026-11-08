"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TreeSession {
  user_id: string;
  label?: string;
  owner?: string;
  status?: string;
}

export interface TeamMember {
  id?: string;
  email?: string;
  name?: string;
}

export interface TeamInfo {
  id?: string;
  name_team?: string;
  id_leader?: string;
  leader_name?: string;
  leader_email?: string;
  members?: TeamMember[];
}

interface Props {
  sessions: TreeSession[];
  ownerNames: Record<string, string>;
  teams: TeamInfo[];
  selectedAcc: string;
  onSelect: (userId: string) => void;
  role: string;
  owner: string;
}

interface OwnerGroup {
  ownerId: string;
  name: string;
  roleLabel: string;
  accounts: TreeSession[];
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

export default function TeamAccountTree({ sessions, ownerNames, teams, selectedAcc, onSelect, role, owner }: Props) {
  const [q, setQ] = useState("");
  const [teamId, setTeamId] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const shortFbId = (id: string) => {
    const raw = id.replace(/^fb_/, "");
    return raw.length > 10 ? `fb ${raw.slice(0, 4)}...${raw.slice(-4)}` : id;
  };
  const isOnline = (s: TreeSession) => s.status === "online";
  const isPaused = (s: TreeSession) => s.status === "paused";
  const statusLabel = (s: TreeSession) => isOnline(s) ? "online" : isPaused(s) ? "paused" : "offline";
  const ownerLabel = useCallback((ownerId: string, fallback?: string) =>
    ownerNames[ownerId] || fallback || (ownerId === owner ? "Tài khoản của tôi" : ownerId || "Chưa gán nhân viên"), [ownerNames, owner]);
  const accountLabel = useCallback((s: TreeSession) => {
    const explicit = (s.label || "").trim();
    if (explicit && explicit !== s.user_id) return explicit;
    return (s.owner && ownerLabel(s.owner)) || "Tài khoản Facebook";
  }, [ownerLabel]);
  const accountSubLabel = (s: TreeSession) => `${shortFbId(s.user_id)} - ${statusLabel(s)}`;

  const teamOptions = useMemo<TeamOption[]>(() => {
    const accountsByOwner = new Map<string, TreeSession[]>();
    for (const session of sessions) {
      const key = session.owner || "";
      if (!accountsByOwner.has(key)) accountsByOwner.set(key, []);
      accountsByOwner.get(key)!.push(session);
    }

    const assignedOwners = new Set<string>();
    const buildGroup = (ownerId: string, fallbackName: string | undefined, roleLabel: string): OwnerGroup => {
      const accounts = [...(accountsByOwner.get(ownerId) || [])].sort(
        (a, b) => Number(isOnline(b)) - Number(isOnline(a)) || Number(isPaused(a)) - Number(isPaused(b)) || accountLabel(a).localeCompare(accountLabel(b)),
      );
      return {
        ownerId,
        name: ownerLabel(ownerId, fallbackName),
        roleLabel,
        accounts,
        online: accounts.filter(isOnline).length,
        offline: accounts.filter(s => !isOnline(s)).length,
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
      const unassignedOwners = Array.from(accountsByOwner.keys()).filter(ownerId => ownerId && !assignedOwners.has(ownerId));
      if (unassignedOwners.length > 0) {
        const groups = unassignedOwners
          .map(ownerId => buildGroup(ownerId, undefined, "Chưa thuộc team"))
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
        .map(ownerId => buildGroup(ownerId, undefined, ownerId === owner ? "Tôi" : "User"))
        .sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
      options.push({
        id: "accounts",
        name: role === "leader" ? "Team của tôi" : "Tài khoản",
        leaderName: ownerLabel(owner),
        groups,
        total: sessions.length,
        online: sessions.filter(isOnline).length,
      });
    }

    return options
      .filter(option => option.groups.length > 0)
      .sort((a, b) => {
        const selectedA = a.groups.some(group => group.accounts.some(s => s.user_id === selectedAcc));
        const selectedB = b.groups.some(group => group.accounts.some(s => s.user_id === selectedAcc));
        if (selectedA !== selectedB) return Number(selectedB) - Number(selectedA);
        if (a.id === UNASSIGNED_TEAM_ID) return 1;
        if (b.id === UNASSIGNED_TEAM_ID) return -1;
        return b.online - a.online || a.name.localeCompare(b.name);
      });
  }, [sessions, teams, owner, selectedAcc, role, accountLabel, ownerLabel]);

  const selectedTeam = teamOptions.find(option => option.groups.some(group => group.accounts.some(s => s.user_id === selectedAcc)));
  const activeTeamId = teamId && teamOptions.some(option => option.id === teamId)
    ? teamId
    : selectedTeam?.id || teamOptions[0]?.id || "";
  const activeTeam = teamOptions.find(option => option.id === activeTeamId) || teamOptions[0];
  const query = q.trim().toLowerCase();
  const visibleGroups = (activeTeam?.groups || []).map(group => ({
    ...group,
    accounts: group.accounts.filter(session => {
      const haystack = `${activeTeam?.name || ""} ${group.name} ${accountLabel(session)} ${session.user_id}`.toLowerCase();
      return !query || haystack.includes(query);
    }),
  }));
  const visibleAccounts = visibleGroups.flatMap(group => group.accounts);
  const onlineCount = sessions.filter(isOnline).length;
  const pausedCount = sessions.filter(isPaused).length;
  const offlineCount = sessions.length - onlineCount - pausedCount;
  const selected = sessions.find(s => s.user_id === selectedAcc);
  const selectedOwnerName = selected ? ownerLabel(selected.owner || "") : "";

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
    const nextTeam = teamOptions.find(option => option.id === nextTeamId);
    const firstAccount = nextTeam?.groups.flatMap(group => group.accounts)[0];
    onSelect(firstAccount?.user_id || "");
  };

  return (
    <div className="w-full space-y-2">
      <div className="grid gap-2 xl:grid-cols-[minmax(190px,260px)_minmax(280px,1fr)_minmax(200px,280px)_auto] xl:items-center">
        <select
          value={activeTeam?.id || ""}
          onChange={e => selectTeam(e.target.value)}
          className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        >
          {teamOptions.map(option => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.total})
            </option>
          ))}
        </select>

        <div ref={pickerRef} className="relative">
          <button
            type="button"
            onClick={() => setAccountOpen(v => !v)}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 text-left text-sm outline-none transition hover:border-primary/60 focus:border-primary focus:ring-2 focus:ring-primary/15"
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline(selected) ? "bg-green-500" : isPaused(selected) ? "bg-amber-400" : "bg-muted"}`} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{accountLabel(selected)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{accountSubLabel(selected)}</span>
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Chọn tài khoản</span>
            )}
            <span className="material-symbols-outlined text-[20px] text-muted-foreground">arrow_drop_down</span>
          </button>

          {accountOpen && (
            <div className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              {visibleAccounts.length === 0 ? (
                <div className="px-3 py-3 text-center text-xs text-muted-foreground">Không có tài khoản phù hợp</div>
              ) : visibleGroups.map(group => (
                <div key={group.ownerId || "__no_owner__"} className="py-1">
                  <div className="px-2 py-1 text-[11px] font-bold uppercase text-muted-foreground">
                    {group.name} - {group.roleLabel}
                  </div>
                  {group.accounts.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Chưa có tài khoản Facebook</div>
                  ) : group.accounts.map(session => {
                    const active = session.user_id === selectedAcc;
                    return (
                      <button
                        key={session.user_id}
                        type="button"
                        onClick={() => {
                          onSelect(session.user_id);
                          setAccountOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition ${
                          active ? "bg-primary/5 text-primary-foreground-fixed-variant" : "hover:bg-muted text-foreground"
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline(session) ? "bg-green-500" : isPaused(session) ? "bg-amber-400" : "bg-muted"}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{accountLabel(session)}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{accountSubLabel(session)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Tìm user / acc..."
          className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />

        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted-foreground xl:justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />{onlineCount}
          </span>
          {pausedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-400" />{pausedCount}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-muted" />{offlineCount}
          </span>
        </div>
      </div>

      {activeTeam && (
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{activeTeam.name}</span>
          <span>Leader: <b className="text-muted-foreground">{activeTeam.leaderName}</b></span>
          {selected && (
            <>
              <span className="text-muted-foreground/50">|</span>
              <span className="font-bold text-primary-foreground-fixed-variant">Đang chọn</span>
              <span className={`h-2 w-2 rounded-full ${isOnline(selected) ? "bg-green-500" : isPaused(selected) ? "bg-amber-400" : "bg-muted"}`} />
              <span className="font-semibold text-foreground">{accountLabel(selected)}</span>
              <span>của</span>
              <span className="font-semibold text-muted-foreground">{selectedOwnerName}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
