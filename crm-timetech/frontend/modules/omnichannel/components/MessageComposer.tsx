"use client";

import React, { useState, useRef } from "react";
import { Paperclip, Image as ImageIcon, Smile, FileText, Sparkles, Send, Pin, FileEdit, ClipboardList, FilePlus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageComposerProps {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onOpenQuickReplies: () => void;
  onOpenAiAssist: () => void;
  onOpenAddNote: () => void;
  onOpenCreateDeal: () => void;
  onOpenCreateQuote: () => void;
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
}) => {
  const [activeTab, setActiveTab] = useState<"message" | "note" | "task" | "quote">("message");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ name: string; type: "file" | "image" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setAttachmentPreview({ name: file.name, type: "file" });
      onChangeText(`${text ? text + "\n" : ""}📎 ${file.name}`);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setAttachmentPreview({ name: file.name, type: "image" });
      onChangeText(`${text ? text + "\n" : ""}🖼️ ${file.name}`);
    }
  };

  const insertEmoji = (emoji: string) => {
    onChangeText(text + emoji);
    setShowEmojiPicker(false);
  };

  return (
    <div className="border-t border-slate-200 bg-white p-2.5 font-sans shrink-0 space-y-2 relative">
      {/* Hidden File Inputs */}
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
      <input type="file" ref={imageInputRef} accept="image/*" onChange={handleImageUpload} className="hidden" />

      {/* Attachment Preview Badge Bar */}
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

      {/* Quick Action Bar above Composer (Reference media_1790996133364.jpg) */}
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

      {/* Input Area */}
      <div className="relative">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nhập tin nhắn... (Shift + Enter để xuống dòng)"
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
          disabled={!text.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3.5 py-1 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
        >
          <Send className="h-3 w-3" />
          <span>Gửi</span>
        </button>
      </div>
    </div>
  );
};
