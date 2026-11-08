"use client";

import React, { useState, useEffect } from "react";
import { ConversationItem, MessageItem } from "../types";
import {
  FileText,
  Download,
  CheckCheck,
  Info,
  Reply,
  ReplyAll,
  Forward,
  ChevronDown,
  ChevronUp,
  Mail,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  conversation: ConversationItem;
  onReplyMessage?: (msg: MessageItem, mode: "reply" | "reply_all" | "forward") => void;
}

export const MessageThread: React.FC<MessageThreadProps> = ({
  conversation,
  onReplyMessage,
}) => {
  const isEmail = conversation.channel === "email";

  // For Email threads: track which messages are expanded
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Track open detail dropdown per message
  const [detailsOpenIds, setDetailsOpenIds] = useState<Set<string>>(new Set());

  // Expand the latest message by default whenever conversation changes
  useEffect(() => {
    if (isEmail && conversation.messages.length > 0) {
      const last = conversation.messages[conversation.messages.length - 1];
      setExpandedIds(new Set([last.id]));
    }
  }, [conversation.id, isEmail, conversation.messages.length]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDetails = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDetailsOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // -------------------------------------------------------------
  // GMAIL-STYLE EMAIL THREAD VIEW
  // -------------------------------------------------------------
  if (isEmail) {
    const latestMsg =
      conversation.messages.length > 0
        ? conversation.messages[conversation.messages.length - 1]
        : null;

    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/70 font-sans no-scrollbar">
        {/* Thread Title Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800 shrink-0">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 truncate">
                {conversation.subject || "(Không có tiêu đề)"}
              </h2>
              <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
                <span className="font-medium text-slate-700">
                  {conversation.customerName}
                </span>
                <span>·</span>
                <span>{conversation.customerEmail}</span>
              </div>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {conversation.messages.length} thư
          </span>
        </div>

        {/* Chronological Stack of Email Messages */}
        <div className="space-y-2.5">
          {conversation.messages.map((msg, index) => {
            const isMe = msg.sender === "me";
            const isLast = index === conversation.messages.length - 1;
            const isExpanded = expandedIds.has(msg.id) || (conversation.messages.length === 1);
            const isDetailsOpen = detailsOpenIds.has(msg.id);

            // Collapsed Message Card
            if (!isExpanded) {
              return (
                <div
                  key={msg.id}
                  onClick={() => toggleExpand(msg.id)}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs shadow-2xs hover:bg-slate-50/80 cursor-pointer transition select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
                        isMe ? "bg-[var(--color-markee-primary,#c2185b)]" : "bg-amber-600"
                      )}
                    >
                      {isMe ? "Tôi" : (msg.senderName || msg.senderEmail || "K").charAt(0).toUpperCase()}
                    </div>
                    <span className="font-semibold text-slate-800 shrink-0">
                      {isMe ? "Tôi" : msg.senderName || msg.senderEmail}
                    </span>
                    <span className="text-slate-400 truncate text-[11px] max-w-md">
                      {msg.text.replace(/\s+/g, " ") || "(Không có nội dung văn bản)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 shrink-0">
                    <span>{msg.time}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                </div>
              );
            }

            // Expanded Message Card
            return (
              <div
                key={msg.id}
                className={cn(
                  "rounded-2xl border bg-white shadow-2xs overflow-hidden transition font-sans",
                  isLast ? "border-amber-300/80 ring-1 ring-amber-100" : "border-slate-200"
                )}
              >
                {/* Email Header Bar */}
                <div
                  onClick={() => toggleExpand(msg.id)}
                  className="flex items-center justify-between border-b border-slate-100 bg-slate-50/40 px-4 py-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-2xs",
                        isMe ? "bg-[var(--color-markee-primary,#c2185b)]" : "bg-amber-600"
                      )}
                    >
                      {isMe ? "Tôi" : (msg.senderName || msg.senderEmail || "K").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-800 text-xs">
                          {isMe ? "Tôi" : msg.senderName || msg.senderEmail}
                        </span>
                        <span className="text-[10.5px] text-slate-400">
                          &lt;{msg.senderEmail}&gt;
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
                        <span>
                          tới {msg.recipientEmails && msg.recipientEmails.length > 0 ? msg.recipientEmails.join(", ") : conversation.customerEmail}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => toggleDetails(msg.id, e)}
                          className="text-[10px] text-slate-400 hover:text-slate-600 underline font-medium"
                        >
                          {isDetailsOpen ? "Ẩn chi tiết" : "Chi tiết"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {msg.status === "sending" ? (
                      <span className="flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 animate-pulse mr-2 border border-amber-200">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        Đang gửi...
                      </span>
                    ) : msg.status === "failed" ? (
                      <span className="flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 mr-2 border border-rose-200">
                        <AlertCircle className="h-2.5 w-2.5" />
                        Gửi thất bại
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 mr-2">{msg.time}</span>
                    )}

                    {/* Action Buttons: Reply, Reply All, Forward */}
                    <button
                      type="button"
                      onClick={() => onReplyMessage && onReplyMessage(msg, "reply")}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
                      title="Trả lời người gửi"
                    >
                      <Reply className="h-3 w-3 text-slate-600" />
                      <span className="hidden sm:inline">Trả lời</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onReplyMessage && onReplyMessage(msg, "reply_all")}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
                      title="Trả lời tất cả người nhận"
                    >
                      <ReplyAll className="h-3 w-3 text-slate-600" />
                      <span className="hidden sm:inline">Tất cả</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onReplyMessage && onReplyMessage(msg, "forward")}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
                      title="Chuyển tiếp thư"
                    >
                      <Forward className="h-3 w-3 text-slate-600" />
                      <span className="hidden sm:inline">Chuyển tiếp</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleExpand(msg.id)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Details Dropdown */}
                {isDetailsOpen && (
                  <div className="border-b border-slate-100 bg-slate-50/70 p-3 text-[11px] text-slate-600 space-y-1 animate-in fade-in duration-100">
                    <div>
                      <strong className="text-slate-700">Từ:</strong> {msg.senderName ? `${msg.senderName} <${msg.senderEmail}>` : msg.senderEmail}
                    </div>
                    <div>
                      <strong className="text-slate-700">Đến:</strong> {msg.recipientEmails?.join(", ") || conversation.customerEmail || "(Chưa rõ)"}
                    </div>
                    {msg.ccEmails && msg.ccEmails.length > 0 && (
                      <div>
                        <strong className="text-slate-700">Cc:</strong> {msg.ccEmails.join(", ")}
                      </div>
                    )}
                    <div>
                      <strong className="text-slate-700">Ngày:</strong> {msg.time}
                    </div>
                    <div>
                      <strong className="text-slate-700">Tiêu đề:</strong> {msg.subject || conversation.subject || "(Không có tiêu đề)"}
                    </div>
                    {msg.messageId && (
                      <div className="text-[10px] text-slate-400 font-mono truncate">
                        Message-ID: {msg.messageId}
                      </div>
                    )}
                  </div>
                )}

                {/* Email Body */}
                <div className="p-4 text-xs text-slate-800 leading-relaxed font-sans">
                  {msg.html ? (
                    <div
                      className="prose prose-sm max-w-none email-html-content"
                      dangerouslySetInnerHTML={{ __html: msg.html }}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  )}
                </div>

                {/* Attachments Section */}
                {(msg.attachments || (msg.attachment ? [msg.attachment] : [])).length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50/40 p-3 space-y-1.5">
                    <span className="text-[10.5px] font-bold text-slate-600">
                      Tập tin đính kèm ({(msg.attachments || [msg.attachment]).length}):
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {(msg.attachments || (msg.attachment ? [msg.attachment] : [])).map((att, attIdx) => (
                        <div
                          key={attIdx}
                          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-2xs hover:bg-slate-50 transition"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white">
                            <FileText className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 max-w-[200px]">
                            <p className="truncate font-semibold text-[11px] text-slate-800">{att.name}</p>
                            <p className="text-[9px] text-slate-400">{att.size}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (att.url) {
                                window.open(att.url, "_blank");
                              } else {
                                const blob = new Blob([`Tập tin: ${att.name}`], { type: "text/plain;charset=utf-8" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = att.name;
                                a.click();
                                URL.revokeObjectURL(url);
                              }
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                            title="Tải xuống"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Quick Reply Buttons Bar */}
        {latestMsg && (
          <div className="flex items-center gap-2 pt-2 pb-1">
            <button
              type="button"
              onClick={() => onReplyMessage && onReplyMessage(latestMsg, "reply")}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition cursor-pointer"
            >
              <Reply className="h-3.5 w-3.5 text-slate-600" />
              <span>Trả lời</span>
            </button>
            <button
              type="button"
              onClick={() => onReplyMessage && onReplyMessage(latestMsg, "reply_all")}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition cursor-pointer"
            >
              <ReplyAll className="h-3.5 w-3.5 text-slate-600" />
              <span>Trả lời tất cả</span>
            </button>
            <button
              type="button"
              onClick={() => onReplyMessage && onReplyMessage(latestMsg, "forward")}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 transition cursor-pointer"
            >
              <Forward className="h-3.5 w-3.5 text-slate-600" />
              <span>Chuyển tiếp</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // STANDARD CHAT VIEW (Zalo, Facebook, Telegram, etc.)
  // -------------------------------------------------------------
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/50 font-sans no-scrollbar">
      {/* Date Divider */}
      <div className="flex items-center justify-center my-1">
        <span className="rounded-full bg-slate-200/70 px-2.5 py-0.2 text-[9px] font-semibold text-slate-600">
          Hôm nay
        </span>
      </div>

      {/* Message Feed */}
      {conversation.messages.map((msg) => {
        if (msg.sender === "system") {
          return (
            <div key={msg.id} className="flex items-center justify-center my-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200/60 px-3 py-0.5 text-[10px] font-medium text-slate-500 shadow-2xs">
                <Info className="h-3 w-3 text-slate-400 shrink-0" />
                <span>{msg.text}</span>
              </span>
            </div>
          );
        }

        const isMe = msg.sender === "me";

        return (
          <div
            key={msg.id}
            className={cn("flex items-end gap-1.5", isMe ? "justify-end" : "justify-start")}
          >
            {/* Avatar for Incoming Messages */}
            {!isMe && (
              <img
                src={conversation.customerAvatar}
                alt={conversation.customerName}
                className="h-6 w-6 rounded-full object-cover shrink-0 border border-slate-200 mb-0.5"
              />
            )}

            <div
              className={cn(
                "group relative max-w-[75%] space-y-1 rounded-2xl px-3 py-1.5 text-xs shadow-2xs",
                isMe
                  ? "bg-[var(--color-markee-primary,#c2185b)] text-white rounded-br-xs"
                  : "bg-white text-slate-800 border border-slate-200/80 rounded-bl-xs"
              )}
            >
              {/* Attachments */}
              {(msg.attachments || (msg.attachment ? [msg.attachment] : [])).map((att, attIdx) => {
                if (att.type === "image") {
                  return (
                    <div key={attIdx} className="overflow-hidden rounded-lg border border-slate-200/40 my-1 max-w-xs">
                      <img
                        src={att.url || "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80"}
                        alt={att.name}
                        className="w-full h-32 object-cover transition hover:scale-105"
                      />
                      <div className="bg-black/40 p-1 text-[9px] text-white truncate font-medium">
                        {att.name} ({att.size})
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={attIdx}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg p-2 mb-1 border transition",
                      isMe
                        ? "bg-white/10 border-white/20 text-white hover:bg-white/20"
                        : "bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100"
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-rose-500 text-white">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[11px]">{att.name}</p>
                      <p className="text-[9px] opacity-80">{att.size}</p>
                    </div>
                    <button
                      onClick={() => {
                        if (att.url) {
                          window.open(att.url, "_blank");
                        } else {
                          const fileName = att.name || "document.pdf";
                          const blob = new Blob([`Tập tin: ${fileName}`], { type: "text/plain;charset=utf-8" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = fileName;
                          a.click();
                          URL.revokeObjectURL(url);
                        }
                      }}
                      className={cn(
                        "rounded p-1 transition",
                        isMe ? "hover:bg-white/20" : "hover:bg-slate-200"
                      )}
                      title="Tải xuống tập tin"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              {/* Message Text */}
              <p className="whitespace-pre-wrap leading-relaxed text-[11px]">{msg.text}</p>

              {/* Timestamp & Status */}
              <div
                className={cn(
                  "flex items-center gap-1 text-[9px] pt-0.5 opacity-80",
                  isMe ? "justify-end text-rose-100" : "justify-start text-slate-400"
                )}
              >
                <span>{msg.time}</span>
                {isMe && (
                  msg.status === "sending" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-rose-100" />
                  ) : msg.status === "failed" ? (
                    <span title="Gửi thất bại">
                      <AlertCircle className="h-2.5 w-2.5 text-rose-300" />
                    </span>
                  ) : (
                    <CheckCheck className="h-3 w-3 text-rose-100" />
                  )
                )}
              </div>
            </div>

            {/* Avatar badge for Outgoing Messages */}
            {isMe && (
              <div
                className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-slate-200 text-[8px] font-bold text-slate-600 shrink-0 mb-0.5"
                title="TV"
              >
                TV
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
