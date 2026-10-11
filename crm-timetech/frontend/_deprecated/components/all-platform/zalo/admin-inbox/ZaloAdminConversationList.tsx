"use client";

import { useMemo } from "react";
import type { ZaloConversationSummary } from "@/types/zalo-api";
import type { ZaloAdminConvFilter } from "@/hooks/useZaloAdminInbox";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  conversations: ZaloConversationSummary[];
  filteredConversations: ZaloConversationSummary[];
  selectedConvId: string;
  onSelectConv: (convId: string) => void;
  loadingConvs: boolean;
  convFilter: ZaloAdminConvFilter;
  setConvFilter: (f: ZaloAdminConvFilter) => void;
  ownerName: string;
  accountLabel: string;
  accountStatus: "online" | "connecting" | "expired" | "offline";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const num = Number(value);
  const ms = !Number.isNaN(num) && String(num) === String(value).trim()
    ? (num < 1e11 ? num * 1000 : num)
    : Date.parse(value);

  if (!ms || Number.isNaN(ms)) return value.toString();

  const diffMs = Date.now() - ms;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Vừa xong";
  if (diffMins < 60) return `${diffMins}p`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(ms).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function ConvInitials({ name }: { name: string }) {
  const words = (name || "?")
    .replace(/^\[|\]$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "Z";
  const second = words.length > 1 ? words[words.length - 1]?.[0] : "";
  const initials = `${first}${second}`.toUpperCase();

  // Color based on first char
  const colors = [
    "from-violet-400 to-purple-600",
    "from-blue-400 to-indigo-600",
    "from-emerald-400 to-teal-600",
    "from-rose-400 to-pink-600",
    "from-amber-400 to-orange-600",
    "from-cyan-400 to-sky-600",
  ];
  const colorIdx = (name.charCodeAt(0) ?? 0) % colors.length;

  return (
    <div
      className={cn(
        "h-10 w-10 rounded-full bg-gradient-to-br flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0 shadow-sm",
        colors[colorIdx]
      )}
    >
      {initials}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const TABS: { key: ZaloAdminConvFilter["tab"]; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "unread", label: "Chưa đọc" },
  { key: "shared", label: "Đã chia sẻ" },
];

export function ZaloAdminConversationList({
  conversations,
  filteredConversations,
  selectedConvId,
  onSelectConv,
  loadingConvs,
  convFilter,
  setConvFilter,
  ownerName,
  accountLabel,
  accountStatus,
}: Props) {
  const unreadCount = useMemo(
    () => conversations.filter((c) => (c.unread_count ?? 0) > 0).length,
    [conversations]
  );

  const statusColors: Record<string, string> = {
    online: "text-green-600",
    connecting: "text-amber-500",
    expired: "text-red-500",
    offline: "text-slate-400",
  };
  const statusLabels: Record<string, string> = {
    online: "Online",
    connecting: "Đang kết nối",
    expired: "Hết phiên",
    offline: "Offline",
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 overflow-hidden">
      {/* ── Header ── */}
      <div className="px-3 pt-3 pb-0 border-b border-slate-100">
        {/* Account info */}
        <div className="flex items-center gap-2 mb-2.5">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-red-400 to-red-700 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
            {(ownerName[0] ?? "Z").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-slate-800 truncate leading-tight">
              {ownerName}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-500 truncate">{accountLabel}</span>
              <span className="text-slate-300">·</span>
              <span className={cn("text-[11px] font-semibold", statusColors[accountStatus])}>
                {statusLabels[accountStatus]}
              </span>
            </div>
          </div>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
              {unreadCount}
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <MaterialIcon
            name="search"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]"
          />
          <input
            type="text"
            placeholder="Tìm hội thoại..."
            value={convFilter.query}
            onChange={(e) =>
              setConvFilter({ ...convFilter, query: e.target.value })
            }
            className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition placeholder:text-slate-400"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-100 -mx-3 px-3">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setConvFilter({ ...convFilter, tab: tab.key })}
              className={cn(
                "flex-1 text-[12px] font-semibold py-1.5 border-b-2 transition-colors",
                convFilter.tab === tab.key
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Conversation list ── */}
      <div className="flex-1 overflow-y-auto">
        {!accountLabel ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <MaterialIcon name="forum" className="text-slate-200 text-[36px]" />
            <p className="text-[12px] text-slate-400">Chọn tài khoản Zalo để xem hội thoại</p>
          </div>
        ) : loadingConvs && conversations.length === 0 ? (
          <div className="p-3 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-2 animate-pulse">
                <div className="h-10 w-10 bg-slate-100 rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <div className="h-3 bg-slate-100 rounded w-3/4 mb-1.5" />
                  <div className="h-2.5 bg-slate-50 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <MaterialIcon name="inbox" className="text-slate-200 text-[36px]" />
            <p className="text-[12px] text-slate-400">
              {convFilter.query ? "Không tìm thấy hội thoại" : "Chưa có hội thoại"}
            </p>
          </div>
        ) : (
          <div>
            {filteredConversations.map((conv) => {
              const isSelected = conv.conversation_id === selectedConvId;
              const hasUnread = (conv.unread_count ?? 0) > 0;
              const lastMsgTime = formatRelativeTime(conv.latest_message_at);
              const title =
                conv.conversation_name && conv.conversation_name !== conv.conversation_id
                  ? conv.conversation_name
                  : "Hội thoại";
              const preview = (conv.latest_content ?? "").slice(0, 60);

              return (
                <button
                  key={conv.conversation_id}
                  onClick={() => onSelectConv(conv.conversation_id)}
                  className={cn(
                    "w-full flex items-start gap-2.5 px-3 py-2.5 transition text-left border-b border-slate-50",
                    isSelected
                      ? "bg-red-50"
                      : "hover:bg-slate-50"
                  )}
                >
                  <ConvInitials name={title} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span
                        className={cn(
                          "text-[13px] truncate leading-tight",
                          hasUnread ? "font-bold text-slate-900" : "font-medium text-slate-700"
                        )}
                      >
                        {title}
                      </span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {lastMsgTime}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "text-[11px] truncate",
                          hasUnread ? "text-slate-700 font-medium" : "text-slate-400"
                        )}
                      >
                        {preview || "Chưa có tin nhắn"}
                      </span>
                      {hasUnread && (
                        <span className="bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-1 flex-shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
