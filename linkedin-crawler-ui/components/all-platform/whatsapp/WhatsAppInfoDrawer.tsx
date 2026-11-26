"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bell,
  BellOff,
  Copy,
  FileText,
  History,
  Image as ImageIcon,
  Info,
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Pin,
  Shield,
  Tag,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { resolveWhatsAppMediaUrl, whatsappService } from "@/services/whatsapp.service";
import type {
  WhatsAppCallLog,
  WhatsAppConversation,
  WhatsAppConversationPatch,
  WhatsAppGroupInfo,
  WhatsAppMessage,
} from "@/types/whatsapp";
import {
  extractPhoneFromJid,
  formatConversationTitle,
  formatDurationSeconds,
  formatFileSize,
  formatPhoneDisplay,
  formatRelativeTimeVi,
  WhatsAppAvatar,
} from "./whatsapp-ui";

type DrawerTab = "info" | "media" | "calls";

export interface WhatsAppInfoDrawerProps {
  accountId: string;
  conversation: WhatsAppConversation | null;
  messages: WhatsAppMessage[];
  callLogs: WhatsAppCallLog[];
  loadingCalls: boolean;
  onClose: () => void;
  onPatchConversation: (chatJid: string, patch: WhatsAppConversationPatch) => Promise<void>;
  onInitiateCall: (mode: "audio" | "video", conv?: WhatsAppConversation) => void;
  onOpenLightbox: (url: string, caption?: string | null) => void;
  onRefreshCalls: () => void;
}

export function WhatsAppInfoDrawer({
  accountId,
  conversation,
  messages,
  callLogs,
  loadingCalls,
  onClose,
  onPatchConversation,
  onInitiateCall,
  onOpenLightbox,
  onRefreshCalls,
}: WhatsAppInfoDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>("info");
  const [groupInfo, setGroupInfo] = useState<WhatsAppGroupInfo | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(false);
  const [labelDraft, setLabelDraft] = useState(conversation?.custom_label || "");
  const [showAllAccountCalls, setShowAllAccountCalls] = useState(false);

  const isGroup = conversation?.chat_type === "group";
  const chatJid = conversation?.chat_jid || null;

  // Fetch live group info when viewing a group conversation
  useEffect(() => {
    if (!chatJid || !isGroup) return;
    let cancelled = false;
    (async () => {
      setLoadingGroup(true);
      const res = await whatsappService.getGroupInfo(accountId, chatJid);
      if (cancelled) return;
      if (res.success && res.data) {
        setGroupInfo(res.data);
      }
      setLoadingGroup(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, chatJid, isGroup]);

  const mediaImages = useMemo(
    () =>
      messages.filter(
        (m) => !m.is_deleted && (m.msg_type === "image" || m.msg_type === "video"),
      ),
    [messages],
  );

  const mediaFiles = useMemo(
    () => messages.filter((m) => !m.is_deleted && m.msg_type === "document"),
    [messages],
  );

  const displayedCalls = useMemo(() => {
    if (showAllAccountCalls || !conversation) return callLogs;
    return callLogs.filter(
      (c) =>
        c.chat_jid === conversation.chat_jid ||
        c.peer_jid === conversation.chat_jid ||
        (conversation.phone_number && c.peer_phone === conversation.phone_number),
    );
  }, [callLogs, conversation, showAllAccountCalls]);

  const title = conversation ? formatConversationTitle(conversation) : "Lịch sử cuộc gọi";
  const phone = conversation
    ? conversation.phone_number ||
      extractPhoneFromJid(conversation.chat_alt_jid) ||
      extractPhoneFromJid(conversation.chat_jid)
    : "";

  return (
    <div className="flex h-full w-full flex-col border-l border-slate-200/90 bg-white min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
          Chi tiết hội thoại
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          aria-label="Đóng bảng thông tin"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="grid shrink-0 grid-cols-3 border-b border-slate-200/80 bg-slate-50/70 p-1 gap-1">
        {(
          [
            { id: "info", label: "Thông tin", icon: Info },
            { id: "media", label: "Media", icon: ImageIcon },
            { id: "calls", label: "Cuộc gọi", icon: History },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                if (item.id === "calls") onRefreshCalls();
              }}
              className={cn(
                "flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition cursor-pointer",
                active
                  ? "bg-white text-emerald-700 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0">
        {tab === "info" && conversation && (
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center">
              <WhatsAppAvatar
                src={conversation.avatar_url}
                name={title}
                isGroup={isGroup}
                size={68}
              />
              <h3 className="mt-2.5 text-sm font-bold text-slate-900">{title}</h3>
              {phone && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(phone);
                    toast.success("Đã copy số điện thoại.");
                  }}
                  className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-slate-500 hover:text-emerald-700 cursor-pointer"
                >
                  <span>{formatPhoneDisplay(phone)}</span>
                  <Copy className="h-3 w-3" />
                </button>
              )}
              <span className="mt-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">
                {isGroup
                  ? `Nhóm • ${groupInfo?.participant_count || groupInfo?.size || conversation.participant_count || 0} thành viên`
                  : "Trò chuyện cá nhân"}
              </span>

              {/* Quick Call Actions */}
              {!isGroup && (
                <div className="mt-3 grid w-full grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onInitiateCall("audio", conversation)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Gọi thoại
                  </button>
                  <button
                    type="button"
                    onClick={() => onInitiateCall("video", conversation)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Video className="h-3.5 w-3.5" />
                    Gọi video
                  </button>
                </div>
              )}
            </div>

            {/* Quick Conversation Controls */}
            <div className="grid grid-cols-3 gap-1.5 border-y border-slate-100 py-3">
              <button
                type="button"
                onClick={() =>
                  void onPatchConversation(conversation.chat_jid, {
                    is_pinned: !conversation.is_pinned,
                  })
                }
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl p-2 text-[10.5px] font-semibold transition cursor-pointer",
                  conversation.is_pinned
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100",
                )}
              >
                <Pin className="h-4 w-4" />
                <span>{conversation.is_pinned ? "Bỏ ghim" : "Ghim"}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void onPatchConversation(conversation.chat_jid, {
                    is_muted: !conversation.is_muted,
                  })
                }
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl p-2 text-[10.5px] font-semibold transition cursor-pointer",
                  conversation.is_muted
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100",
                )}
              >
                {conversation.is_muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                <span>{conversation.is_muted ? "Đã tắt" : "Thông báo"}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void onPatchConversation(conversation.chat_jid, {
                    is_archived: !conversation.is_archived,
                  })
                }
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl p-2 text-[10.5px] font-semibold transition cursor-pointer",
                  conversation.is_archived
                    ? "bg-indigo-50 text-indigo-700"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100",
                )}
              >
                <Archive className="h-4 w-4" />
                <span>{conversation.is_archived ? "Khôi phục" : "Lưu trữ"}</span>
              </button>
            </div>

            {/* CRM Label Editor */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                <Tag className="h-3.5 w-3.5 text-teal-600" />
                Nhãn phân loại CRM
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  placeholder="Vd: Khách tiềm năng, Đã báo giá..."
                  className="flex-1 min-w-0 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() =>
                    void onPatchConversation(conversation.chat_jid, {
                      custom_label: labelDraft.trim() || null,
                    })
                  }
                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  Lưu
                </button>
              </div>
            </div>

            {/* Group Participants */}
            {isGroup && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <Users className="h-3.5 w-3.5 text-emerald-600" />
                    Thành viên nhóm
                  </span>
                  {loadingGroup && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />}
                </div>
                {groupInfo?.description && (
                  <p className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-600 whitespace-pre-wrap">
                    {groupInfo.description}
                  </p>
                )}
                {groupInfo && groupInfo.participants.length > 0 ? (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {groupInfo.participants.map((p, idx) => {
                      const pJid = p.jid || p.id || `member-${idx}`;
                      const pLabel =
                        p.name ||
                        (p.phone_number ? formatPhoneDisplay(p.phone_number) : "") ||
                        extractPhoneFromJid(pJid) ||
                        pJid;
                      return (
                        <div
                          key={pJid}
                          className="flex items-center justify-between gap-2 rounded-xl bg-slate-50/80 px-2.5 py-1.5"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <WhatsAppAvatar name={pLabel} size={26} />
                            <span className="truncate text-xs font-medium text-slate-800">{pLabel}</span>
                          </div>
                          {p.admin && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[9.5px] font-bold text-emerald-800">
                              <Shield className="h-2.5 w-2.5" />
                              Admin
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  !loadingGroup && (
                    <p className="text-[11px] text-slate-400">Chưa tải được danh sách thành viên.</p>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* MEDIA TAB */}
        {tab === "media" && (
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-xs font-bold text-slate-800">
                Ảnh & Video ({mediaImages.length})
              </h4>
              {mediaImages.length === 0 ? (
                <p className="rounded-xl bg-slate-50 py-6 text-center text-xs text-slate-400">
                  Chưa có ảnh/video nào trong đoạn chat này.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {mediaImages.map((m) => {
                    const src = resolveWhatsAppMediaUrl(m.media_url, m.account_id, m.message_id);
                    if (!src) return null;
                    return (
                      <button
                        key={m.message_id}
                        type="button"
                        onClick={() => onOpenLightbox(src, m.text)}
                        className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100 cursor-zoom-in"
                      >
                        {m.msg_type === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="Media" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-slate-900 text-white">
                            <Video className="h-5 w-5" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-xs font-bold text-slate-800">
                Tài liệu ({mediaFiles.length})
              </h4>
              {mediaFiles.length === 0 ? (
                <p className="rounded-xl bg-slate-50 py-5 text-center text-xs text-slate-400">
                  Chưa có tệp đính kèm nào.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {mediaFiles.map((f) => {
                    const src = resolveWhatsAppMediaUrl(f.media_url, f.account_id, f.message_id);
                    return (
                      <a
                        key={f.message_id}
                        href={src || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 hover:bg-emerald-50/60"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold text-slate-800">
                            {f.media_filename || "Tài liệu"}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {formatFileSize(f.media_size)} • {formatRelativeTimeVi(f.sent_at)}
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CALL HISTORY TAB */}
        {tab === "calls" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                Nhật ký cuộc gọi ({displayedCalls.length})
              </span>
              {conversation && (
                <button
                  type="button"
                  onClick={() => setShowAllAccountCalls((v) => !v)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {showAllAccountCalls ? "Chỉ hội thoại này" : "Toàn tài khoản"}
                </button>
              )}
            </div>

            {loadingCalls ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
              </div>
            ) : displayedCalls.length === 0 ? (
              <div className="rounded-xl bg-slate-50 py-8 text-center text-xs text-slate-400">
                Chưa có lịch sử cuộc gọi nào.
              </div>
            ) : (
              <div className="space-y-2">
                {displayedCalls.map((call) => {
                  const missed = call.status === "missed" || call.status === "timeout";
                  const rejected = call.status === "rejected" || call.status === "reject";
                  const isOut = call.direction === "outbound";
                  const isVid = call.call_type === "video";
                  return (
                    <div
                      key={call.id || call.call_id}
                      className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5"
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                          missed
                            ? "bg-rose-100 text-rose-600"
                            : rejected
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700",
                        )}
                      >
                        {missed ? (
                          <PhoneMissed className="h-4 w-4" />
                        ) : rejected ? (
                          <PhoneOff className="h-4 w-4" />
                        ) : isOut ? (
                          <PhoneOutgoing className="h-4 w-4" />
                        ) : (
                          <PhoneIncoming className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-slate-900">
                          {call.peer_name || formatPhoneDisplay(call.peer_phone) || call.peer_jid || "Cuộc gọi"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-500">
                          <span>{isVid ? "Video" : "Thoại"}</span>
                          <span>•</span>
                          <span>
                            {call.duration_seconds && call.duration_seconds > 0
                              ? formatDurationSeconds(call.duration_seconds)
                              : call.status}
                          </span>
                          <span>•</span>
                          <span>{formatRelativeTimeVi(call.started_at || call.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
