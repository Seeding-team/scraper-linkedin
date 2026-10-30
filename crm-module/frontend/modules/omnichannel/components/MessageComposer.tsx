"use client";

import React, { useState, useRef } from "react";
import {
  Paperclip,
  Image as ImageIcon,
  Smile,
  FileText,
  Sparkles,
  Send,
  Pin,
  FileEdit,
  ClipboardList,
  FilePlus,
  Reply,
  ReplyAll,
  Forward,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OutgoingEmailAttachment } from "../types";

interface MessageComposerProps {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onOpenQuickReplies: () => void;
  onOpenAiAssist: () => void;
  onOpenAddNote: () => void;
  onOpenCreateDeal: () => void;
  onOpenCreateQuote: () => void;
  isEmailChannel?: boolean;
  emailSubject?: string;
  onChangeEmailSubject?: (subject: string) => void;
  emailRecipient?: string;
  onChangeEmailRecipient?: (recipient: string) => void;
  emailCc?: string[];
  onChangeEmailCc?: (cc: string[]) => void;
  emailAttachments?: OutgoingEmailAttachment[];
  onChangeEmailAttachments?: (attachments: OutgoingEmailAttachment[]) => void;
  replyMode?: "reply" | "reply_all" | "forward" | null;
  onCancelReplyMode?: () => void;
  isSending?: boolean;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  text,
  onChangeText,
  onSend,
  onOpenQuickReplies,
  onOpenAiAssist,
  onOpenAddNote,
  onOpenCreateDeal,
  onOpenCreateQuote,
  isEmailChannel,
  emailSubject,
  onChangeEmailSubject,
  emailRecipient,
  onChangeEmailRecipient,
  emailCc = [],
  onChangeEmailCc,
  emailAttachments = [],
  onChangeEmailAttachments,
  replyMode = "reply",
  onCancelReplyMode,
  isSending = false,
}) => {
  const [activeTab, setActiveTab] = useState<"message" | "note" | "task" | "quote">("message");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCcInput, setShowCcInput] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ name: string; type: "file" | "image" } | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const encodeEmailFiles = async (files: File[]) => {
    const maxFileBytes = 20 * 1024 * 1024;
    const maxMessageBytes = 25 * 1024 * 1024;
    const existingBytes = emailAttachments.reduce((sum, item) => sum + item.size_bytes, 0);
    if (
      files.some((file) => file.size > maxFileBytes) ||
      existingBytes + files.reduce((sum, file) => sum + file.size, 0) > maxMessageBytes
    ) {
      setAttachmentError("Tối đa 20 MB/file và 25 MB/email.");
      return;
    }
    const encoded = await Promise.all(
      files.map(async (file): Promise<OutgoingEmailAttachment> => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const contentType = file.type || "application/octet-stream";
        return {
          name: file.name,
          size:
            file.size >= 1024 * 1024
              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
              : `${Math.max(1, Math.round(file.size / 1024))} KB`,
          type: contentType === "application/pdf" ? "pdf" : contentType.startsWith("image/") ? "image" : "file",
          content_type: contentType,
          size_bytes: file.size,
          content_base64: dataUrl.split(",", 2)[1] || "",
        };
      })
    );
    setAttachmentError(null);
    onChangeEmailAttachments?.([...emailAttachments, ...encoded]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    if (isEmailChannel) {
      await encodeEmailFiles(files);
      return;
    }
    const file = files[0];
    setAttachmentPreview({ name: file.name, type: "file" });
    onChangeText(`${text ? text + "\n" : ""}📎 ${file.name}`);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    if (isEmailChannel) {
      await encodeEmailFiles(files);
      return;
    }
    const file = files[0];
    setAttachmentPreview({ name: file.name, type: "image" });
    onChangeText(`${text ? text + "\n" : ""}🖼️ ${file.name}`);
  };

  const insertEmoji = (emoji: string) => {
    onChangeText(text + emoji);
    setShowEmojiPicker(false);
  };

  return (
    <div className="border-t border-slate-200 bg-white p-2.5 font-sans shrink-0 space-y-2 relative">
      {/* Hidden File Inputs */}
      <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
      <input type="file" multiple ref={imageInputRef} accept="image/*" onChange={handleImageUpload} className="hidden" />

      {/* Attachment Preview Badge Bar for non-email */}
      {attachmentPreview && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 font-medium">
          <span className="truncate">
            {attachmentPreview.type === "image" ? "🖼️ Ảnh đính kèm:" : "📎 File đính kèm:"} <strong>{attachmentPreview.name}</strong>
          </span>
          <button
            onClick={() => setAttachmentPreview(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-2"
            title="Xóa đính kèm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Attachments chips for Email channel */}
      {isEmailChannel &&
        emailAttachments.map((attachment, index) => (
          <div
            key={`${attachment.name}-${index}`}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 font-medium"
          >
            <span className="truncate">
              {attachment.type === "image" ? "🖼️" : "📎"} <strong>{attachment.name}</strong> · {attachment.size}
            </span>
            <button
              onClick={() => onChangeEmailAttachments?.(emailAttachments.filter((_, itemIndex) => itemIndex !== index))}
              className="text-slate-400 hover:text-slate-600 font-bold ml-2 cursor-pointer"
              title="Xóa đính kèm"
            >
              ✕
            </button>
          </div>
        ))}
      {attachmentError && <div className="text-[11px] font-medium text-red-600">{attachmentError}</div>}

      {/* Emoji Picker Popover */}
      {showEmojiPicker && (
        <div className="absolute bottom-16 left-4 z-30 flex flex-wrap items-center gap-1.5 max-w-[240px] rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl animate-in fade-in duration-150">
          {["👍", "😊", "🙏", "❤️", "✅", "📑", "📞", "🤝", "🚀", "🔥", "🎉", "💡"].map((emoji) => (
            <button
              key={emoji}
              onClick={() => insertEmoji(emoji)}
              className="rounded p-1 text-base hover:bg-slate-100 transition cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Quick Action Bar above Composer */}
      <div className="flex items-center gap-1.5 border-b border-slate-100 pb-1.5 text-[11px] font-semibold">
        <button
          onClick={() => setActiveTab("message")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5 transition cursor-pointer",
            activeTab === "message"
              ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] font-bold shadow-2xs border border-rose-200/60"
              : "text-slate-600 hover:bg-slate-100"
          )}
        >
          <Pin className="h-3 w-3" />
          <span>Tin nhắn</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("note");
            onOpenAddNote();
          }}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5 transition cursor-pointer",
            activeTab === "note"
              ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] font-bold shadow-2xs border border-rose-200/60"
              : "text-slate-600 hover:bg-slate-100"
          )}
        >
          <FileEdit className="h-3 w-3" />
          <span>Ghi chú nội bộ</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("task");
            onOpenCreateDeal();
          }}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5 transition cursor-pointer",
            activeTab === "task"
              ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] font-bold shadow-2xs border border-rose-200/60"
              : "text-slate-600 hover:bg-slate-100"
          )}
        >
          <ClipboardList className="h-3 w-3" />
          <span>Tạo việc</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("quote");
            onOpenCreateQuote();
          }}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5 transition cursor-pointer",
            activeTab === "quote"
              ? "bg-rose-50 text-[var(--color-markee-primary,#c2185b)] font-bold shadow-2xs border border-rose-200/60"
              : "text-slate-600 hover:bg-slate-100"
          )}
        >
          <FilePlus className="h-3 w-3" />
          <span>Tạo báo giá</span>
        </button>
      </div>

      {/* Gmail-style Reply / Header Section (for Email channel) */}
      {isEmailChannel && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-200/90 bg-amber-50/60 p-2 text-xs font-sans">
          {/* Reply Mode Indicator */}
          <div className="flex items-center justify-between border-b border-amber-200/50 pb-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-900 text-[11px]">
              {replyMode === "reply_all" ? (
                <>
                  <ReplyAll className="h-3.5 w-3.5 text-amber-700" />
                  <span>Trả lời tất cả</span>
                </>
              ) : replyMode === "forward" ? (
                <>
                  <Forward className="h-3.5 w-3.5 text-amber-700" />
                  <span>Chuyển tiếp thư</span>
                </>
              ) : (
                <>
                  <Reply className="h-3.5 w-3.5 text-amber-700" />
                  <span>Trả lời email</span>
                </>
              )}
            </div>
            {onCancelReplyMode && (
              <button
                type="button"
                onClick={onCancelReplyMode}
                className="text-[10px] text-amber-700 hover:text-amber-900 font-semibold cursor-pointer"
              >
                Đặt lại
              </button>
            )}
          </div>

          {/* Recipient Row */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[11px] text-slate-500 w-12 shrink-0">Tới:</span>
            {replyMode === "forward" ? (
              <input
                type="email"
                value={emailRecipient || ""}
                onChange={(e) => onChangeEmailRecipient?.(e.target.value)}
                placeholder="Nhập email người nhận chuyển tiếp..."
                className="flex-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-800 placeholder-slate-400 focus:border-amber-500 focus:outline-none"
              />
            ) : (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="font-semibold text-slate-800 text-[11px] bg-white border border-slate-200 px-2 py-0.5 rounded truncate">
                  {emailRecipient || "(Chưa có người nhận)"}
                </span>
                {!showCcInput && (
                  <button
                    type="button"
                    onClick={() => setShowCcInput(true)}
                    className="text-[10px] text-slate-500 hover:text-slate-800 underline font-medium cursor-pointer shrink-0"
                  >
                    + Thêm Cc
                  </button>
                )}
              </div>
            )}
          </div>

          {/* CC Row */}
          {(showCcInput || (emailCc && emailCc.length > 0)) && (
            <div className="flex items-center gap-2 animate-in fade-in duration-100">
              <span className="font-semibold text-[11px] text-slate-500 w-12 shrink-0">Cc:</span>
              <input
                type="text"
                value={(emailCc || []).join(", ")}
                onChange={(e) => {
                  const list = e.target.value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
                  onChangeEmailCc?.(list);
                }}
                placeholder="email1@domain.com, email2@domain.com"
                className="flex-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-800 placeholder-slate-400 focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}

          {/* Subject Row */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[11px] text-slate-500 w-12 shrink-0">Tiêu đề:</span>
            <input
              type="text"
              value={emailSubject || ""}
              onChange={(e) => onChangeEmailSubject && onChangeEmailSubject(e.target.value)}
              placeholder="Tiêu đề email..."
              className="flex-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-800 placeholder-slate-400 focus:border-amber-500 focus:outline-none font-medium"
            />
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="relative">
        <textarea
          rows={isEmailChannel ? 4 : 2}
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isEmailChannel
              ? replyMode === "forward"
                ? "Thêm lời nhắn trước nội dung chuyển tiếp... (Shift + Enter để xuống dòng)"
                : "Soạn nội dung email phản hồi... (Shift + Enter để xuống dòng)"
              : "Nhập tin nhắn... (Shift + Enter để xuống dòng)"
          }
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 p-2 text-xs text-slate-800 placeholder-slate-400 focus:border-[var(--color-markee-primary,#c2185b)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary,#c2185b)]"
        />
      </div>

      {/* Toolbar & Send */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
            title="Đính kèm file"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => imageInputRef.current?.click()}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
            title="Gửi hình ảnh"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowEmojiPicker((v) => !v)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
            title="Biểu tượng cảm xúc"
          >
            <Smile className="h-3.5 w-3.5" />
          </button>

          <div className="h-3.5 w-px bg-slate-200 mx-1" />

          <button
            onClick={onOpenQuickReplies}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition"
          >
            <FileText className="h-3 w-3 text-slate-500" />
            <span>Mẫu nhanh</span>
          </button>

          <button
            onClick={onOpenAiAssist}
            className="flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 hover:bg-purple-100 transition"
          >
            <Sparkles className="h-3 w-3 text-purple-600" />
            <span>AI</span>
          </button>
        </div>

        <button
          onClick={onSend}
          disabled={!text.trim() || isSending || (isEmailChannel && replyMode === "forward" && !emailRecipient?.trim())}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs cursor-pointer",
            isEmailChannel
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-[var(--color-markee-primary,#c2185b)] hover:bg-[#a3134c]"
          )}
        >
          {isSending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Đang gửi...</span>
            </>
          ) : (
            <>
              <Send className="h-3 w-3" />
              <span>{isEmailChannel ? (replyMode === "forward" ? "Chuyển tiếp" : "Gửi Email") : "Gửi"}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
