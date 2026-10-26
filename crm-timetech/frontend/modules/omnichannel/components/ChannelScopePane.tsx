"use client";

import React from "react";
import { ChannelType, ChannelAccount } from "../types";
import { MessageSquare, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHANNEL_CAPABILITIES } from "../constants/channelCapabilities";

interface ChannelScopePaneProps {
  selectedChannel: ChannelType;
  onSelectChannel: (channel: ChannelType) => void;
  selectedAccount: string | null;
  onSelectAccount: (accId: string | null) => void;
  accounts: ChannelAccount[];
  channelCounts?: Record<ChannelType, number>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  scopeFilter: "my" | "team" | "all";
  onSelectScopeFilter: (scope: "my" | "team" | "all") => void;
  onConnectAccountModal: () => void;
}

const CHANNEL_LABELS: Record<ChannelType, string> = {
  all: "Tất cả kênh",
  facebook: "Facebook",
  zalo: "Zalo",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  viber: "Viber",
  linkedin: "LinkedIn",
};

export const ChannelScopePane: React.FC<ChannelScopePaneProps> = ({
  selectedChannel,
  onSelectChannel,
  selectedAccount,
  onSelectAccount,
  accounts,
  channelCounts,
  isCollapsed,
  onToggleCollapse,
  scopeFilter,
  onSelectScopeFilter,
  onConnectAccountModal,
}) => {
  const getCount = (ch: ChannelType) => {
    if (channelCounts && typeof channelCounts[ch] === "number") {
      return channelCounts[ch];
    }
    return 0;
  };

  if (isCollapsed) {
    return (
      <div className="flex h-full w-12 flex-col items-center border-r border-slate-200 bg-slate-50 py-3 gap-2 shrink-0 select-none">
        <button
          onClick={onToggleCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition shadow-2xs"
          title="Mở rộng Kênh & Tài khoản"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onConnectAccountModal}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-markee-primary,#c2185b)] text-white hover:opacity-90 transition shadow-2xs"
          title="Kết nối tài khoản mới"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="h-px w-6 bg-slate-200 my-0.5" />
        {(["all", "facebook", "zalo", "telegram", "whatsapp", "viber", "linkedin"] as ChannelType[]).map((ch) => {
          const active = selectedChannel === ch && !selectedAccount;
          return (
            <button
              key={ch}
              onClick={() => {
                onSelectChannel(ch);
                onSelectAccount(null);
              }}
              className={cn(
                "relative flex h-7.5 w-7.5 items-center justify-center rounded-lg transition text-xs font-bold",
                active
                  ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] ring-1 ring-[var(--color-markee-primary,#c2185b)]/30 font-bold"
                  : "text-slate-600 hover:bg-slate-100"
              )}
              title={CHANNEL_LABELS[ch]}
            >
              {ch === "all" && <MessageSquare className="h-3.5 w-3.5 text-[var(--color-markee-primary,#c2185b)]" />}
              {ch === "facebook" && <span className="text-xs font-black text-[#1877F2]">f</span>}
              {ch === "zalo" && <span className="text-[9px] font-black text-[#0068FF]">Zalo</span>}
              {ch === "telegram" && <span className="text-[10px] font-bold text-[#229ED9]">Tg</span>}
              {ch === "whatsapp" && <span className="text-[10px] font-bold text-[#25D366]">WA</span>}
              {ch === "viber" && <span className="text-[10px] font-bold text-[#7360F2]">Vb</span>}
              {ch === "linkedin" && <span className="text-[10px] font-black text-[#0A66C2]">in</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full w-[185px] shrink-0 flex-col border-r border-slate-200 bg-white font-sans select-none">
      {/* Pane Header */}
      <div className="flex h-11 items-center justify-between border-b border-slate-100 px-2.5 py-1.5">
        <h2 className="text-xs font-bold text-slate-800">Kênh & Tài khoản</h2>
        <button
          onClick={onToggleCollapse}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          title="Thu gọn thanh bên"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-2.5 no-scrollbar">
        {/* + Kết nối tài khoản CTA Button */}
        <button
          onClick={onConnectAccountModal}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-markee-primary,#c2185b)] py-1.5 px-2 text-xs font-bold text-white transition hover:opacity-95 shadow-2xs"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Kết nối tài khoản</span>
        </button>

        {/* Channel Navigation */}
        <div className="space-y-0.5">
          {(["all", "facebook", "zalo", "telegram", "whatsapp", "viber", "linkedin"] as ChannelType[]).map((ch) => {
            const label = CHANNEL_LABELS[ch];
            const cap = CHANNEL_CAPABILITIES[ch];
            const count = getCount(ch);
            const isSelected = selectedChannel === ch && !selectedAccount;
            return (
              <button
                key={ch}
                onClick={() => {
                  onSelectChannel(ch);
                  onSelectAccount(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] font-semibold transition",
                  isSelected
                    ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] font-bold shadow-2xs"
                    : cap.isAvailable
                    ? "text-slate-700 hover:bg-slate-100"
                    : "text-slate-400 hover:bg-slate-50"
                )}
                title={!cap.isAvailable ? "Kênh này đang được phát triển" : undefined}
              >
                <div className="flex items-center gap-1.5 truncate">
                  {ch === "all" && (
                    <div className="flex h-4 w-4 items-center justify-center rounded bg-rose-100 text-[var(--color-markee-primary,#c2185b)]">
                      <MessageSquare className="h-2.5 w-2.5" />
                    </div>
                  )}
                  {ch === "facebook" && (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1877F2] text-white text-[9px] font-black">
                      f
                    </div>
                  )}
                  {ch === "zalo" && (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0068FF] text-white text-[6.5px] font-black tracking-tighter">
                      Zalo
                    </div>
                  )}
                  {ch === "telegram" && (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#229ED9] text-white text-[7.5px] font-bold">
                      ✈
                    </div>
                  )}
                  {ch === "whatsapp" && (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#25D366] text-white text-[7.5px] font-bold opacity-60">
                      WA
                    </div>
                  )}
                  {ch === "viber" && (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#7360F2] text-white text-[7.5px] font-bold opacity-60">
                      Vb
                    </div>
                  )}
                  {ch === "linkedin" && (
                    <div className="flex h-4 w-4 items-center justify-center rounded bg-[#0A66C2] text-white text-[7.5px] font-black opacity-60">
                      in
                    </div>
                  )}
                  <span className={cn("truncate", !cap.isAvailable && "opacity-75")}>{label}</span>
                </div>

                {cap.isAvailable ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[9px] font-bold",
                      isSelected
                        ? "bg-[var(--color-markee-primary,#c2185b)] text-white"
                        : "bg-slate-100 text-slate-500"
                    )}
                  >
                    {count}
                  </span>
                ) : (
                  <span className="rounded bg-amber-100/80 px-1 py-0.2 text-[8px] font-bold text-amber-800">
                    Sắp có
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Section: Accounts */}
        <div className="border-t border-slate-100 pt-2">
          <div className="flex items-center justify-between px-1.5 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Tài khoản
            </span>
          </div>

          {accounts.length === 0 ? (
            <div className="px-1.5 py-2 text-[10px] text-slate-400 italic">
              Chưa có tài khoản được kết nối
            </div>
          ) : (
            <div className="space-y-0.5">
              {accounts.map((acc) => {
                const isAccSelected = selectedAccount === acc.id;
                return (
                  <button
                    key={acc.id}
                    onClick={() => {
                      onSelectChannel(acc.channel);
                      onSelectAccount(acc.id);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] font-medium transition",
                      isAccSelected
                        ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] font-semibold"
                        : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          acc.status === "online"
                            ? "bg-emerald-500"
                            : acc.status === "paused"
                            ? "bg-amber-400"
                            : "bg-slate-300"
                        )}
                      />
                      <span className="truncate">{acc.name}</span>
                    </div>
                    {acc.count !== undefined && acc.count > 0 && (
                      <span className="text-[9px] text-slate-400 font-normal">
                        {acc.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section: Scope Filter */}
        <div className="border-t border-slate-100 pt-2">
          <div className="px-1.5 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Phạm vi hiển thị
            </span>
          </div>

          <div className="space-y-0.5 px-0.5">
            {[
              { id: "my", label: "Của tôi" },
              { id: "team", label: "Team Sales" },
              { id: "all", label: "Tất cả" },
            ].map((scope) => (
              <label
                key={scope.id}
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="radio"
                  name="scopeFilter"
                  checked={scopeFilter === scope.id}
                  onChange={() => onSelectScopeFilter(scope.id as "my" | "team" | "all")}
                  className="h-3 w-3 accent-[var(--color-markee-primary,#c2185b)]"
                />
                <span className={scopeFilter === scope.id ? "font-semibold text-slate-900" : ""}>
                  {scope.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
