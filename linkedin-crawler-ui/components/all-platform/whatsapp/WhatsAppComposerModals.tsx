"use client";

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart2,
  Contact,
  Download,
  Forward,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  Search,
  Send,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
} from "@/types/whatsapp";
import { formatConversationTitle, getMessagePreviewText, WhatsAppAvatar } from "./whatsapp-ui";

// ── 1. Lightbox Modal ────────────────────────────────────────────────────────
export function WhatsAppLightboxModal({
  url,
  caption,
  onClose,
}: {
  url: string;
  caption?: string | null;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex flex-col items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="mb-3 flex w-full max-w-4xl items-center justify-between text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate text-xs text-slate-300">{caption || "Xem ảnh chi tiết"}</span>
        <div className="flex items-center gap-2">
          <a
            href={url}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
          >
            <Download className="h-3.5 w-3.5" />
            Tải xuống
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/15 p-1.5 hover:bg-white/25 cursor-pointer"
            aria-label="Đóng xem ảnh"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={caption || "WhatsApp media"}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
      />
    </div>,
    document.body,
  );
}

// ── 2. Forward Message Modal ─────────────────────────────────────────────────
export function WhatsAppForwardModal({
  message,
  conversations,
  onClose,
  onConfirm,
}: {
  message: WhatsAppMessage;
  conversations: WhatsAppConversation[];
  onClose: () => void;
  onConfirm: (targetChatJid: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [submittingJid, setSubmittingJid] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (c.chat_jid === message.chat_jid) return false;
      if (!q) return true;
      return (
        formatConversationTitle(c).toLowerCase().includes(q) ||
        (c.phone_number || "").includes(q)
      );
    });
  }, [conversations, message.chat_jid, search]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Forward className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">Chuyển tiếp tin nhắn</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600 line-clamp-2">
          {getMessagePreviewText(message)}
        </div>

        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm hội thoại đích..."
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Không tìm thấy hội thoại đích phù hợp.
            </div>
          ) : (
            filtered.map((conv) => {
              const title = formatConversationTitle(conv);
              const busy = submittingJid === conv.chat_jid;
              return (
                <div
                  key={conv.chat_jid}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <WhatsAppAvatar
                      src={conv.avatar_url}
                      name={title}
                      isGroup={conv.chat_type === "group"}
                      size={34}
                    />
                    <span className="truncate text-xs font-semibold text-slate-800">{title}</span>
                  </div>
                  <button
                    type="button"
                    disabled={submittingJid !== null}
                    onClick={async () => {
                      setSubmittingJid(conv.chat_jid);
                      await onConfirm(conv.chat_jid);
                      setSubmittingJid(null);
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                  >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Gửi
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 3. Send Location Modal ───────────────────────────────────────────────────
export function WhatsAppLocationModal({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (payload: { latitude: number; longitude: number; name?: string; address?: string }) => Promise<void>;
}) {
  const [lat, setLat] = useState("10.776889");
  const [lng, setLng] = useState("106.700806");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [sending, setSending] = useState(false);

  const handleUseCurrentGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Trình duyệt không hỗ trợ định vị GPS.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
        toast.success("Đã lấy tọa độ hiện tại.");
      },
      () => {
        setLocating(false);
        toast.error("Không thể truy cập vị trí GPS.");
      },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numLat = Number(lat);
    const numLng = Number(lng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
      toast.error("Vui lòng nhập vĩ độ & kinh độ hợp lệ.");
      return;
    }
    setSending(true);
    await onSend({
      latitude: numLat,
      longitude: numLng,
      name: name.trim() || undefined,
      address: address.trim() || undefined,
    });
    setSending(false);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-rose-500" />
            <h3 className="text-sm font-bold text-slate-900">Gửi vị trí (Location)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <button
            type="button"
            onClick={handleUseCurrentGps}
            disabled={locating}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
          >
            {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
            Lấy tọa độ GPS hiện tại
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Vĩ độ (Latitude)</label>
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Kinh độ (Longitude)</label>
              <input
                type="text"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Tên địa điểm</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vd: Văn phòng công ty..."
              className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Địa chỉ chi tiết</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Số nhà, đường, quận/huyện..."
              className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Gửi vị trí
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// ── 4. Send Contact vCard Modal ──────────────────────────────────────────────
export function WhatsAppContactModal({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (payload: { contact_name: string; contact_phone: string }) => Promise<void>;
}) {
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactPhone.trim()) {
      toast.error("Vui lòng nhập đầy đủ tên và số điện thoại danh thiếp.");
      return;
    }
    setSending(true);
    await onSend({
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim(),
    });
    setSending(false);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Contact className="h-4 w-4 text-teal-600" />
            <h3 className="text-sm font-bold text-slate-900">Gửi danh thiếp (vCard)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Tên liên hệ</label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Vd: Nguyễn Văn A - Tư vấn"
              autoFocus
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Số điện thoại</label>
            <input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Vd: +84901234567"
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Gửi danh thiếp
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// ── 5. Create Poll Modal ─────────────────────────────────────────────────────
export function WhatsAppPollModal({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (payload: { question: string; options: string[]; selectable_count?: number }) => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleanOptions.length < 2) {
      toast.error("Nhập câu hỏi và ít nhất 2 lựa chọn bình chọn.");
      return;
    }
    setSending(true);
    await onSend({
      question: question.trim(),
      options: cleanOptions,
      selectable_count: allowMultiple ? cleanOptions.length : 1,
    });
    setSending(false);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">Tạo bình chọn (Poll)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Câu hỏi bình chọn</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Vd: Bạn muốn nhận báo giá theo gói nào?"
              autoFocus
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-slate-700">Các lựa chọn</label>
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) =>
                    setOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                  }
                  placeholder={`Lựa chọn ${idx + 1}`}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-emerald-500"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ""])}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Thêm lựa chọn
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={allowMultiple}
              onChange={(e) => setAllowMultiple(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span>Cho phép chọn nhiều đáp án</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Gửi bình chọn
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// ── 6. Quick Replies Manager Modal ───────────────────────────────────────────
export function WhatsAppQuickRepliesModal({
  quickReplies,
  onClose,
  onCreate,
  onDelete,
  onPick,
}: {
  quickReplies: WhatsAppQuickReply[];
  onClose: () => void;
  onCreate: (payload: { shortcut: string; title: string; content: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPick: (content: string) => void;
}) {
  const [shortcut, setShortcut] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanShortcut = shortcut.trim().replace(/^\/+/, "");
    if (!cleanShortcut || !content.trim()) {
      toast.error("Nhập phím tắt (vd: baogia) và nội dung mẫu câu.");
      return;
    }
    setCreating(true);
    await onCreate({
      shortcut: cleanShortcut,
      title: title.trim() || cleanShortcut,
      content: content.trim(),
    });
    setCreating(false);
    setShortcut("");
    setTitle("");
    setContent("");
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900">
              Thư viện trả lời nhanh (gõ <code className="rounded bg-slate-100 px-1">/</code> để chèn)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleAdd(e)} className="border-b border-slate-100 bg-slate-50/80 p-4 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="Phím tắt (vd: xinchao)"
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
            />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tiêu đề ngắn"
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>
          <textarea
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Nội dung tin nhắn mẫu..."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-emerald-500"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Thêm mẫu câu
            </button>
          </div>
        </form>

        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {quickReplies.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Chưa có mẫu trả lời nhanh nào. Thêm mẫu ở trên để dùng với lệnh <code>/</code>.
            </div>
          ) : (
            quickReplies.map((qr) => (
              <div
                key={qr.id}
                className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"
              >
                <button
                  type="button"
                  onClick={() => {
                    onPick(qr.content);
                    onClose();
                  }}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-emerald-800">
                      /{qr.shortcut}
                    </span>
                    <span className="truncate text-xs font-semibold text-slate-900">{qr.title}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] text-slate-600">{qr.content}</p>
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(qr.id)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                  title="Xóa mẫu câu"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 7. Slash Quick Reply Popover ─────────────────────────────────────────────
export function WhatsAppSlashMenu({
  items,
  onSelect,
}: {
  items: WhatsAppQuickReply[];
  onSelect: (qr: WhatsAppQuickReply) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="absolute bottom-full left-3 right-3 z-30 mb-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl divide-y divide-slate-100">
      <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 text-[10.5px] font-semibold text-slate-500">
        <span>Mẫu trả lời nhanh</span>
        <span>Nhấn chọn để chèn</span>
      </div>
      {items.map((qr) => (
        <button
          key={qr.id}
          type="button"
          onClick={() => onSelect(qr)}
          className={cn(
            "flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-emerald-50/70 transition cursor-pointer",
          )}
        >
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-emerald-800">
            /{qr.shortcut}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-slate-800">{qr.title}</div>
            <div className="truncate text-[11px] text-slate-500">{qr.content}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
