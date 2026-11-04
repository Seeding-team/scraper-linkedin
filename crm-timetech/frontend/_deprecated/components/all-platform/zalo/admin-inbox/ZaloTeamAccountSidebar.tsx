"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ZaloMemberAccount,
  TeamRow,
} from "@/hooks/useZaloAdminInbox";
import type { ZaloAccountInfo, ZaloConversationSummary } from "@/types/zalo-api";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccountStatus = "online" | "connecting" | "expired" | "offline";

interface Props {
  teams: TeamRow[];
  selectedTeamId: string;
  onSelectTeam: (id: string) => void;
  memberAccounts: ZaloMemberAccount[];
  ownerNames: Record<string, string>;
  onlineAccounts: Set<string>;
  expiredAccounts: Set<string>;
  selectedAccountId: string;
  onSelectAccount: (ownerId: string, accountId: string) => void;
  kpiByOwner: Record<string, number>;
  getAccountStatus: (accountId: string) => AccountStatus;
  loadingAccounts: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: AccountStatus }) {
  const classes: Record<AccountStatus, string> = {
    online: "bg-green-500 shadow-green-400",
    connecting: "bg-amber-400 animate-pulse",
    expired: "bg-red-500",
    offline: "bg-slate-300",
  };
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm flex-shrink-0",
        classes[status]
      )}
    />
  );
}

function AccountStatusLabel({ status }: { status: AccountStatus }) {
  const labels: Record<AccountStatus, { text: string; cls: string }> = {
    online: { text: "Online", cls: "text-green-600" },
    connecting: { text: "Kết nối...", cls: "text-amber-600" },
    expired: { text: "Hết phiên", cls: "text-red-600" },
    offline: { text: "Offline", cls: "text-slate-400" },
  };
  const { text, cls } = labels[status];
  return <span className={cn("text-[10px] font-medium", cls)}>{text}</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ZaloTeamAccountSidebar({
  teams,
  selectedTeamId,
  onSelectTeam,
  memberAccounts,
  ownerNames,
  onlineAccounts,
  expiredAccounts,
  selectedAccountId,
  onSelectAccount,
  kpiByOwner,
  getAccountStatus,
  loadingAccounts,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedOwners, setCollapsedOwners] = useState<Record<string, boolean>>({});

  const toggleOwner = useCallback((ownerId: string) => {
    setCollapsedOwners((prev) => ({ ...prev, [ownerId]: !prev[ownerId] }));
  }, []);

  // Total online count
  const totalOnline = useMemo(
    () => memberAccounts.flatMap((g) => g.accounts).filter((a) => onlineAccounts.has(a.account_id)).length,
    [memberAccounts, onlineAccounts]
  );
  const totalAccounts = useMemo(
    () => memberAccounts.flatMap((g) => g.accounts).length,
    [memberAccounts]
  );

  // Filter by search
  const filtered = useMemo<ZaloMemberAccount[]>(() => {
    if (!searchQuery.trim()) return memberAccounts;
    const q = searchQuery.toLowerCase();
    return memberAccounts
      .map((group) => ({
        ...group,
        accounts: group.accounts.filter(
          (a) =>
            (a.label ?? "").toLowerCase().includes(q) ||
            (a.phone ?? "").includes(q) ||
            (a.account_id ?? "").toLowerCase().includes(q) ||
            group.ownerName.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.accounts.length > 0 || g.ownerName.toLowerCase().includes(q));
  }, [memberAccounts, searchQuery]);

  return (
    <aside
      className="flex flex-col h-full bg-white border-r border-slate-200 overflow-hidden"
      style={{ minWidth: 240, maxWidth: 280 }}
    >
      {/* ── Header ── */}
      <div className="px-3 pt-4 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-sm flex-shrink-0">
            <MaterialIcon name="chat" className="text-white text-[18px]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-bold text-slate-800 leading-tight">Zalo Inbox</h2>
            <p className="text-[10px] text-slate-500 leading-tight">
              {totalOnline}/{totalAccounts} online
            </p>
          </div>
        </div>

        {/* Team filter */}
        <select
          className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition"
          value={selectedTeamId}
          onChange={(e) => onSelectTeam(e.target.value)}
        >
          <option value="">Tất cả team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id ?? ""}>
              {t.name_team ?? t.id}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative mt-2">
          <MaterialIcon
            name="search"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]"
          />
          <input
            type="text"
            placeholder="Tìm nhân viên, tài khoản..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-[12px] border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* ── Account list ── */}
      <div className="flex-1 overflow-y-auto">
        {loadingAccounts && memberAccounts.length === 0 ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-3 bg-slate-100 rounded w-1/2 mb-2" />
                <div className="h-8 bg-slate-50 rounded mb-1" />
                <div className="h-8 bg-slate-50 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center">
            <MaterialIcon name="group_off" className="text-slate-300 text-[32px] mb-2" />
            <p className="text-[12px] text-slate-400">
              {searchQuery ? "Không tìm thấy" : "Chưa có nhân viên"}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((group) => {
              const isCollapsed = collapsedOwners[group.ownerId] ?? false;
              const groupOnline = group.accounts.filter((a) => onlineAccounts.has(a.account_id)).length;
              const kpiCount = kpiByOwner[group.ownerEmail] ?? 0;

              return (
                <div key={group.ownerId} className="mb-0.5">
                  {/* Member header */}
                  <button
                    onClick={() => toggleOwner(group.ownerId)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 transition text-left"
                  >
                    {/* Avatar */}
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                      {(group.ownerName[0] ?? "U").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-slate-700 truncate leading-tight">
                        {group.ownerName}
                      </div>
                      <div className="text-[10px] text-slate-400 leading-tight">
                        {groupOnline}/{group.accounts.length} online
                        {kpiCount > 0 && (
                          <span className="ml-1.5 text-green-600 font-semibold">
                            • KPI {kpiCount}
                          </span>
                        )}
                      </div>
                    </div>
                    <MaterialIcon
                      name={isCollapsed ? "navigate_next" : "keyboard_arrow_down"}
                      className="text-slate-400 text-[16px] flex-shrink-0"
                    />

                  </button>

                  {/* Account list (collapsible) */}
                  {!isCollapsed && (
                    <div className="pl-4 pr-2 pb-1">
                      {group.accounts.length === 0 ? (
                        <div className="py-1 px-2 text-[11px] text-slate-400 italic">
                          Chưa có tài khoản Zalo
                        </div>
                      ) : (
                        group.accounts.map((acc) => {
                          const status = getAccountStatus(acc.account_id);
                          const isSelected = acc.account_id === selectedAccountId;

                          return (
                            <button
                              key={acc.account_id}
                              onClick={() => onSelectAccount(group.ownerId, acc.account_id)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-0.5 transition text-left",
                                isSelected
                                  ? "bg-red-50 border border-red-200"
                                  : "hover:bg-slate-50 border border-transparent"
                              )}
                            >
                              <StatusDot status={status} />
                              <div className="flex-1 min-w-0">
                                <div
                                  className={cn(
                                    "text-[12px] font-medium truncate leading-tight",
                                    isSelected ? "text-red-700" : "text-slate-700"
                                  )}
                                >
                                  {acc.label || acc.phone || acc.account_id}
                                </div>
                                <AccountStatusLabel status={status} />
                              </div>
                              {status === "expired" && (
                                <MaterialIcon
                                  name="warning"
                                  className="text-red-400 text-[14px] flex-shrink-0"
                                />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
