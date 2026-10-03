"use client";

import React, { useState } from "react";
import { ConversationItem } from "../types";
import { Star, UserPlus, Phone, Video, MoreHorizontal, User, Mail, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationHeaderProps {
  conversation: ConversationItem;
  onOpenAssignUser?: () => void;
  onViewCustomerProfile?: () => void;
  onCopyConvId?: () => void;
  onToggleUnread?: () => void;
}

export const ConversationHeader: React.FC<ConversationHeaderProps> = ({
  conversation,
  onOpenAssignUser,
  onViewCustomerProfile,
  onCopyConvId,
  onToggleUnread,
}) => {
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    if (typeof window !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(conversation.id);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
    if (onCopyConvId) onCopyConvId();
    setIsMoreMenuOpen(false);
  };

  return (
    <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-3 py-1.5 font-sans shrink-0 select-none relative">
      {/* Customer Info */}
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <img
            src={conversation.customerAvatar}
            alt={conversation.customerName}
            className="h-8.5 w-8.5 rounded-full object-cover border border-slate-200"
          />
          <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white shadow-2xs">
            {conversation.channel === "facebook" && (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-[#1877F2] text-[8px] font-black text-white">
                f
              </span>
            )}
            {conversation.channel === "zalo" && (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-[#0068FF] text-[7px] font-black text-white">
                z
              </span>
            )}
            {conversation.channel === "telegram" && (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-[#229ED9] text-[7px] font-bold text-white">
                ✈
              </span>
            )}
            {conversation.channel === "linkedin" && (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-[#0A66C2] text-[7px] font-black text-white">
                in
              </span>
            )}
          </div>
        </div>

        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs font-bold text-slate-800">{conversation.customerName}</h2>
            <button className="text-amber-400 hover:text-amber-500" title="Đánh dấu sao">
              <Star className="h-3 w-3 fill-amber-400" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
              <span className="capitalize">{conversation.channel}</span>
              <span>·</span>
              <span>{conversation.accountLabel}</span>
            </span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span className="flex items-center gap-1 text-emerald-600 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Đang online
            </span>
          </div>
        </div>
      </div>

      {/* Tags & Action Bar */}
      <div className="flex items-center gap-1.5">
        <div className="hidden sm:flex items-center gap-1 mr-1">
          {conversation.tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "rounded px-1.5 py-0.2 text-[10px] font-semibold tracking-wide",
                tag.includes("Hot") || tag.includes("báo giá")
                  ? "bg-rose-100 text-[var(--color-markee-primary,#c2185b)]"
                  : "bg-amber-100 text-amber-700"
              )}
            >
              {tag}
            </span>
          ))}
        </div>

        <button
          onClick={onOpenAssignUser}
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition cursor-pointer"
        >
          <UserPlus className="h-3 w-3 text-slate-500" />
          <span className="hidden md:inline">Gán người</span>
        </button>

        <button
          disabled
          className="rounded-md p-1 text-slate-300 cursor-not-allowed"
          title={`Chưa hỗ trợ cuộc gọi API trên kênh ${conversation.channel}`}
        >
          <Phone className="h-3.5 w-3.5" />
        </button>
        <button
          disabled
          className="rounded-md p-1 text-slate-300 cursor-not-allowed"
          title={`Chưa hỗ trợ gọi video API trên kênh ${conversation.channel}`}
        >
          <Video className="h-3.5 w-3.5" />
        </button>

        {/* More Actions Menu */}
        <div className="relative">
          <button
            onClick={() => setIsMoreMenuOpen((prev) => !prev)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
            title="Thao tác khác"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {isMoreMenuOpen && (
            <div className="absolute right-0 top-8 z-30 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-xl animate-in fade-in duration-150 text-xs font-sans">
              <button
                onClick={() => {
                  if (onViewCustomerProfile) onViewCustomerProfile();
                  setIsMoreMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-slate-700 font-medium transition text-left cursor-pointer"
              >
                <User className="h-3.5 w-3.5 text-slate-400" />
                <span>Xem hồ sơ khách hàng</span>
              </button>

              <button
                onClick={() => {
                  if (onToggleUnread) onToggleUnread();
                  setIsMoreMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-slate-700 font-medium transition text-left cursor-pointer"
              >
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span>Đánh dấu chưa đọc</span>
              </button>

              <button
                onClick={() => {
                  if (onOpenAssignUser) onOpenAssignUser();
                  setIsMoreMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-slate-700 font-medium transition text-left cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5 text-slate-400" />
                <span>Gắn người phụ trách</span>
              </button>

              <div className="my-1 border-t border-slate-100" />

              <button
                onClick={handleCopy}
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-slate-700 font-medium transition text-left cursor-pointer"
              >
                {isCopied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span>{isCopied ? "Đã sao chép!" : "Sao chép ID hội thoại"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
