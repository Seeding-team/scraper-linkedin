"use client";

import React from "react";
import { ConversationItem } from "../types";
import { FileText, Download, CheckCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageThreadProps {
  conversation: ConversationItem;
}

export const MessageThread: React.FC<MessageThreadProps> = ({ conversation }) => {
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
              {/* Attachment Card if present */}
              {msg.attachment && msg.attachment.type === "image" && (
                <div className="overflow-hidden rounded-lg border border-slate-200/40 my-1 max-w-xs">
                  <img
                    src={msg.attachment.url || "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=80"}
                    alt={msg.attachment.name}
                    className="w-full h-32 object-cover transition hover:scale-105"
                  />
                  <div className="bg-black/40 p-1 text-[9px] text-white truncate font-medium">
                    {msg.attachment.name} ({msg.attachment.size})
                  </div>
                </div>
              )}

              {msg.attachment && msg.attachment.type === "pdf" && (
                <div
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
                    <p className="truncate font-semibold text-[11px]">{msg.attachment.name}</p>
                    <p className="text-[9px] opacity-80">{msg.attachment.size}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (msg.attachment?.url) {
                        window.open(msg.attachment.url, "_blank");
                      } else {
                        const fileName = msg.attachment?.name || "document.pdf";
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
                    title="Tải xuống"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

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
                {isMe && <CheckCheck className="h-3 w-3 text-rose-100" />}
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
