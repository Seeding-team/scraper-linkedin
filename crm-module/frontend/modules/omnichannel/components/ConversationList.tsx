"use client";

import React from "react";
import { ConversationItem } from "../types";
import { Search, SlidersHorizontal, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationListProps {
  conversations: ConversationItem[];
  selectedConvId: string | null;
  onSelectConv: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterTab: "all" | "unread" | "crm";
  onFilterTabChange: (tab: "all" | "unread" | "crm") => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  selectedConvId,
  onSelectConv,
  searchQuery,
  onSearchChange,
  filterTab,
  onFilterTabChange,
}) => {
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = React.useState(false);
  const [filterChannel, setFilterChannel] = React.useState<string>("all");
  const [filterCrm, setFilterCrm] = React.useState<string>("all");

  const unreadTotal = conversations.reduce((acc, c) => acc + (c.unreadCount > 0 ? 1 : 0), 0);
  const crmTotal = conversations.reduce((acc, c) => acc + (c.isCrmMatched ? 1 : 0), 0);

  const displayedConversations = conversations.filter((c) => {
    if (filterChannel !== "all" && c.channel !== filterChannel) return false;
    if (filterCrm === "linked" && !c.isCrmMatched) return false;
    if (filterCrm === "unlinked" && c.isCrmMatched) return false;
    return true;
  });

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-r border-slate-200 bg-white font-sans select-none relative">
      {/* Header */}
      <div className="flex h-11 items-center justify-between border-b border-slate-100 px-3 py-1.5">
        <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <span>Hội thoại</span>
          <span className="text-[11px] text-slate-400 font-normal">({displayedConversations.length})</span>
        </h2>
        <button
          onClick={() => setIsFilterPopoverOpen((prev) => !prev)}
          className={cn(
            "rounded p-1 transition cursor-pointer",
            isFilterPopoverOpen
              ? "bg-rose-100 text-[var(--color-markee-primary,#c2185b)]"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          )}
          title="Tùy chọn lọc nâng cao"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Compact Filter Popover */}
      {isFilterPopoverOpen && (
        <div className="absolute top-11 right-3 z-30 w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-xl space-y-3 animate-in fade-in duration-150 font-sans">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
            <h3 className="text-xs font-bold text-slate-800">Bộ lọc hội thoại</h3>
            <button
              onClick={() => setIsFilterPopoverOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold"
            >
              ✕
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Kênh xã hội</label>
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800 bg-slate-50 focus:outline-none"
            >
              <option value="all">Tất cả kênh</option>
              <option value="facebook">Facebook</option>
              <option value="zalo">Zalo</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">Trạng thái CRM</label>
            <select
              value={filterCrm}
              onChange={(e) => setFilterCrm(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800 bg-slate-50 focus:outline-none"
            >
              <option value="all">Tất cả</option>
              <option value="linked">Đã liên kết CRM</option>
              <option value="unlinked">Chưa liên kết</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100">
            <button
              onClick={() => {
                setFilterChannel("all");
                setFilterCrm("all");
                setIsFilterPopoverOpen(false);
              }}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Đặt lại
            </button>
            <button
              onClick={() => setIsFilterPopoverOpen(false)}
              className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3 py-1 text-[11px] font-bold text-white hover:opacity-95"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="p-2 pb-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm tên, SĐT, nội dung..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-8 pr-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-[var(--color-markee-primary,#c2185b)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary,#c2185b)]"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-100 px-2 pb-1.5 gap-1">
        {[
          { id: "all", label: "Tất cả", count: conversations.length },
          { id: "unread", label: "Chưa đọc", count: unreadTotal },
          { id: "crm", label: "CRM", count: crmTotal },
        ].map((tab) => {
          const isActive = filterTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onFilterTabChange(tab.id as "all" | "unread" | "crm")}
              className={cn(
                "flex-1 rounded-md py-1 px-1.5 text-center transition flex items-center justify-center gap-1 text-[11px] font-semibold",
                isActive
                  ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] font-bold"
                  : "text-slate-500 hover:bg-slate-100"
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[9px]",
                  isActive ? "bg-[var(--color-markee-primary,#c2185b)] text-white" : "bg-slate-200 text-slate-600"
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Conversation Cards Feed */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 no-scrollbar">
        {displayedConversations.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Không tìm thấy hội thoại phù hợp
          </div>
        ) : (
          displayedConversations.map((conv) => {
            const isSelected = selectedConvId === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => onSelectConv(conv.id)}
                className={cn(
                  "relative flex cursor-pointer p-2.5 transition gap-2.5 hover:bg-slate-50/80",
                  isSelected && "bg-rose-50/70 border-l-3 border-l-[var(--color-markee-primary,#c2185b)]"
                )}
              >
                {/* Avatar with Channel Badge Overlay */}
                <div className="relative shrink-0">
                  <img
                    src={conv.customerAvatar}
                    alt={conv.customerName}
                    className="h-9.5 w-9.5 rounded-full object-cover border border-slate-200"
                  />
                  <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white shadow-2xs">
                    {conv.channel === "facebook" && (
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-[#1877F2] text-[8px] font-black text-white">
                        f
                      </span>
                    )}
                    {conv.channel === "zalo" && (
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-[#0068FF] text-[7px] font-black text-white">
                        z
                      </span>
                    )}
                    {conv.channel === "telegram" && (
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-[#229ED9] text-[7px] font-bold text-white">
                        ✈
                      </span>
                    )}
                    {conv.channel === "linkedin" && (
                      <span className="flex h-full w-full items-center justify-center rounded-full bg-[#0A66C2] text-[7px] font-black text-white">
                        in
                      </span>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 truncate">
                      <h3
                        className={cn(
                          "truncate text-xs font-bold text-slate-800",
                          conv.unreadCount > 0 && "text-slate-900 font-extrabold"
                        )}
                      >
                        {conv.customerName}
                      </h3>
                      {conv.isCrmMatched && (
                        <span title="Đã liên kết CRM">
                          <UserCheck className="h-3 w-3 shrink-0 text-emerald-600" />
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {conv.lastMessageTime}
                    </span>
                  </div>

                  <p
                    className={cn(
                      "truncate text-[11px] text-slate-500 leading-tight",
                      conv.unreadCount > 0 && "font-semibold text-slate-700"
                    )}
                  >
                    {conv.lastMessageText}
                  </p>

                  {/* Tags & Unread Counter */}
                  <div className="flex items-center justify-between pt-0.5">
                    <div className="flex flex-wrap gap-1">
                      {conv.tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            "rounded px-1.5 py-0.2 text-[9px] font-semibold tracking-tight",
                            tag.includes("Hot") || tag.includes("báo giá")
                              ? "bg-rose-100 text-[var(--color-markee-primary,#c2185b)]"
                              : "bg-amber-100 text-amber-700"
                          )}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {conv.unreadCount > 0 && (
                      <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--color-markee-primary,#c2185b)] px-1 text-[9px] font-bold text-white shadow-2xs">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
