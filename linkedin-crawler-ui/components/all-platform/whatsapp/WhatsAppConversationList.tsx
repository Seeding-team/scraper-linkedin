"use client";

import React, { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Tag,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { whatsappService } from "@/services/whatsapp.service";
import type {
  WhatsAppConversation,
  WhatsAppConversationFilter,
  WhatsAppConversationPatch,
  WhatsAppPresenceState,
} from "@/types/whatsapp";
import {
  formatConversationTitle,
  formatRelativeTimeVi,
  normalizeWaPhoneDigits,
  WhatsAppAvatar,
} from "./whatsapp-ui";

export interface WhatsAppConversationListProps {
  accountId: string;
  conversations: WhatsAppConversation[];
  loading: boolean;
  syncing: boolean;
  selectedChatJid: string | null;
  filter: WhatsAppConversationFilter;
  searchQuery: string;
  presenceMap: Record<string, WhatsAppPresenceState>;
  onSearchChange: (q: string) => void;
  onFilterChange: (f: WhatsAppConversationFilter) => void;
  onSelectConversation: (conv: WhatsAppConversation) => void;
  onSync: () => void;
  onConversationStarted: (conv: WhatsAppConversation) => void;
  onPatchConversation: (chatJid: string, patch: WhatsAppConversationPatch) => Promise<void>;
}

const FILTER_PILLS: Array<{ id: WhatsAppConversationFilter; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "unread", label: "Chưa đọc" },
  { id: "direct", label: "Cá nhân" },
  { id: "groups", label: "Nhóm" },
  { id: "pinned", label: "Đã ghim" },
  { id: "archived", label: "Lưu trữ" },
];

export function WhatsAppConversationList({
  accountId,
  conversations,
  loading,
  syncing,
  selectedChatJid,
  filter,
  searchQuery,
  presenceMap,
  onSearchChange,
  onFilterChange,
  onSelectConversation,
  onSync,
  onConversationStarted,
  onPatchConversation,
}: WhatsAppConversationListProps) {
  const [showStartChat, setShowStartChat] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [startingChat, setStartingChat] = useState(false);
  const [menuOpenJid, setMenuOpenJid] = useState<string | null>(null);
  const [editingLabelJid, setEditingLabelJid] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const unreadTotal = useMemo(
    () => conversations.filter((c) => !c.is_archived && (c.unread_count || 0) > 0).length,
    [conversations],
  );

  const visibleList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = conversations;

    if (filter === "archived") {
      list = list.filter((c) => Boolean(c.is_archived));
    } else {
      list = list.filter((c) => !c.is_archived);
      if (filter === "unread") list = list.filter((c) => (c.unread_count || 0) > 0);
      else if (filter === "direct") list = list.filter((c) => c.chat_type === "direct");
      else if (filter === "groups") list = list.filter((c) => c.chat_type === "group");
      else if (filter === "pinned") list = list.filter((c) => Boolean(c.is_pinned));
    }

    if (q) {
      list = list.filter((c) => {
        const title = formatConversationTitle(c).toLowerCase();
        const phone = (c.phone_number || "").toLowerCase();
        const preview = (c.last_message_preview || "").toLowerCase();
        const label = (c.custom_label || "").toLowerCase();
        return title.includes(q) || phone.includes(q) || preview.includes(q) || label.includes(q);
      });
    }

    return [...list].sort((a, b) => {
      const pinDiff = Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned));
      if (pinDiff !== 0) return pinDiff;
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });
  }, [conversations, filter, searchQuery]);

  const handleStartChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = normalizeWaPhoneDigits(newPhone);
    if (digits.length < 8 || digits.length > 15) {
      toast.error("Nhập số điện thoại hợp lệ (vd: 0901234567 hoặc 84901234567).");
      return;
    }
    setStartingChat(true);
    const res = await whatsappService.startChat(accountId, digits);
    setStartingChat(false);
    if (!res.success || !res.data) {
      toast.error(res.message || "Không tìm thấy số điện thoại này trên WhatsApp.");
      return;
    }
    toast.success(`Đã mở hội thoại với ${formatConversationTitle(res.data)}`);
    setNewPhone("");
    setShowStartChat(false);
    onConversationStarted(res.data);
  };

  const handleSaveLabel = async (chatJid: string) => {
    await onPatchConversation(chatJid, { custom_label: labelDraft.trim() || null });
    setEditingLabelJid(null);
    setLabelDraft("");
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#f8fafc] border-r border-slate-200/90 min-h-0 overflow-hidden">
      {/* Top search + action buttons */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white p-3 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm tên, SĐT, nhãn..."
              className="w-full rounded-full border border-slate-200 bg-slate-50 pl-8 pr-7 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Xóa từ khóa"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowStartChat((v) => !v)}
            title="Chat SĐT mới"
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition cursor-pointer",
              showStartChat
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
            )}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">SĐT mới</span>
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            title="Đồng bộ hội thoại từ WhatsApp"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition cursor-pointer"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin text-emerald-600")} />
          </button>
        </div>

        {/* Inline Start Chat by Phone */}
        {showStartChat && (
          <form
            onSubmit={(e) => void handleStartChat(e)}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-2"
          >
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Nhập SĐT (vd: 0901234567)..."
              autoFocus
              className="flex-1 min-w-0 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={startingChat}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
            >
              {startingChat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mở chat"}
            </button>
          </form>
        )}

        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
          {FILTER_PILLS.map((pill) => {
            const active = filter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => onFilterChange(pill.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer",
                  active
                    ? "bg-emerald-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/80",
                )}
              >
                <span>{pill.label}</span>
                {pill.id === "unread" && unreadTotal > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-bold",
                      active ? "bg-white/25 text-white" : "bg-emerald-600 text-white",
                    )}
                  >
                    {unreadTotal}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation Items */}
      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <span className="text-xs">Đang tải hội thoại WhatsApp...</span>
          </div>
        ) : visibleList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-5 text-center text-slate-400">
            <MessageSquarePlus className="h-9 w-9 opacity-30 mb-2" />
            <p className="text-xs font-medium text-slate-600">
              {searchQuery
                ? "Không tìm thấy hội thoại phù hợp."
                : filter === "all"
                  ? "Chưa có hội thoại nào."
                  : "Không có hội thoại trong mục lọc này."}
            </p>
            {filter === "all" && !searchQuery && (
              <button
                type="button"
                onClick={() => setShowStartChat(true)}
                className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
              >
                + Bắt đầu chat bằng SĐT
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleList.map((conv) => {
              const isSelected = selectedChatJid === conv.chat_jid;
              const isGroup = conv.chat_type === "group";
              const title = formatConversationTitle(conv);
              const presence = presenceMap[conv.chat_jid];
              const isTyping = presence?.state === "composing" || presence?.state === "recording";
              const isOnline = presence?.state === "available";
              const menuOpen = menuOpenJid === conv.chat_jid;
              const editingLabel = editingLabelJid === conv.chat_jid;

              return (
                <div
                  key={conv.chat_jid}
                  onClick={() => {
                    setMenuOpenJid(null);
                    onSelectConversation(conv);
                  }}
                  className={cn(
                    "group relative flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition",
                    isSelected
                      ? "bg-emerald-50/90 border-l-[3px] border-l-emerald-600 pl-[9px]"
                      : "bg-white hover:bg-slate-50 border-l-[3px] border-l-transparent pl-[9px]",
                  )}
                >
                  <WhatsAppAvatar
                    src={conv.avatar_url}
                    name={title}
                    isGroup={isGroup}
                    size={42}
                    online={isOnline || isTyping}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1 min-w-0">
                        {isGroup && <Users className="h-3 w-3 shrink-0 text-slate-400" />}
                        <span
                          className={cn(
                            "truncate text-[13px]",
                            (conv.unread_count || 0) > 0
                              ? "font-bold text-slate-900"
                              : "font-semibold text-slate-800",
                          )}
                        >
                          {title}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10.5px] text-slate-400 tabular-nums">
                        {formatRelativeTimeVi(conv.last_message_at)}
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-1.5">
                      {isTyping ? (
                        <span className="truncate text-[11.5px] font-semibold text-emerald-600 animate-pulse">
                          {presence?.state === "recording" ? "đang ghi âm..." : "đang nhập..."}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "truncate text-[11.5px]",
                            (conv.unread_count || 0) > 0
                              ? "font-medium text-slate-700"
                              : "text-slate-500",
                          )}
                        >
                          {conv.last_message_preview || "Chưa có tin nhắn"}
                        </span>
                      )}

                      <div className="flex shrink-0 items-center gap-1">
                        {conv.is_muted && <BellOff className="h-3 w-3 text-slate-400" />}
                        {conv.is_pinned && <Pin className="h-3 w-3 text-emerald-600 rotate-45" />}
                        {(conv.unread_count || 0) > 0 && (
                          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white tabular-nums">
                            {conv.unread_count > 99 ? "99+" : conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>

                    {conv.custom_label && !editingLabel && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 border border-teal-200/80 px-1.5 py-0.2 text-[10px] font-semibold text-teal-700">
                          <Tag className="h-2.5 w-2.5" />
                          {conv.custom_label}
                        </span>
                      </div>
                    )}

                    {editingLabel && (
                      <div
                        className="mt-1.5 flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSaveLabel(conv.chat_jid);
                            if (e.key === "Escape") setEditingLabelJid(null);
                          }}
                          placeholder="Nhãn (vd: Khách VIP)..."
                          autoFocus
                          className="flex-1 min-w-0 rounded border border-emerald-300 bg-white px-2 py-0.5 text-[11px] outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveLabel(conv.chat_jid)}
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white cursor-pointer"
                        >
                          Lưu
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quick context trigger */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenJid(menuOpen ? null : conv.chat_jid);
                    }}
                    className={cn(
                      "rounded-lg p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 transition cursor-pointer",
                      menuOpen ? "opacity-100 bg-slate-200/70" : "opacity-0 group-hover:opacity-100",
                    )}
                    title="Tùy chọn hội thoại"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  {menuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-3 top-10 z-30 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpenJid(null);
                          void onPatchConversation(conv.chat_jid, { is_pinned: !conv.is_pinned });
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {conv.is_pinned ? (
                          <>
                            <PinOff className="h-3.5 w-3.5 text-slate-500" />
                            <span>Bỏ ghim</span>
                          </>
                        ) : (
                          <>
                            <Pin className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Ghim lên đầu</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpenJid(null);
                          void onPatchConversation(conv.chat_jid, { is_muted: !conv.is_muted });
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {conv.is_muted ? (
                          <>
                            <Bell className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Bật thông báo</span>
                          </>
                        ) : (
                          <>
                            <BellOff className="h-3.5 w-3.5 text-slate-500" />
                            <span>Tắt thông báo</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpenJid(null);
                          setEditingLabelJid(conv.chat_jid);
                          setLabelDraft(conv.custom_label || "");
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Tag className="h-3.5 w-3.5 text-teal-600" />
                        <span>Gắn nhãn CRM</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpenJid(null);
                          void onPatchConversation(conv.chat_jid, {
                            is_archived: !conv.is_archived,
                          });
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {conv.is_archived ? (
                          <>
                            <ArchiveRestore className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Bỏ lưu trữ</span>
                          </>
                        ) : (
                          <>
                            <Archive className="h-3.5 w-3.5 text-slate-500" />
                            <span>Lưu trữ hội thoại</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
