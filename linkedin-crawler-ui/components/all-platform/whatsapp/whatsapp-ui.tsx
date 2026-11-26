"use client";

import React, { useState } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WhatsAppAccount, WhatsAppConversation, WhatsAppMessage } from "@/types/whatsapp";

const AVATAR_GRADIENTS = [
  "from-emerald-500 to-teal-600",
  "from-teal-500 to-cyan-600",
  "from-sky-500 to-blue-600",
  "from-indigo-500 to-violet-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-green-600 to-emerald-700",
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getInitials(name?: string | null): string {
  const clean = (name || "").trim();
  if (!clean) return "WA";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function WhatsAppAvatar({
  src,
  name,
  isGroup = false,
  size = 40,
  online = false,
  className,
}: {
  src?: string | null;
  name?: string | null;
  isGroup?: boolean;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const gradient = AVATAR_GRADIENTS[hashString(name || "wa") % AVATAR_GRADIENTS.length];
  const validSrc = src && failedSrc !== src ? src : null;

  return (
    <div
      className={cn("relative shrink-0 select-none", className)}
      style={{ width: size, height: size }}
    >
      {validSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={validSrc}
          alt={name || "WhatsApp"}
          onError={() => setFailedSrc(validSrc)}
          className="h-full w-full rounded-full object-cover border border-slate-200/80"
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br text-white font-bold shadow-2xs",
            gradient,
          )}
          style={{ fontSize: Math.max(11, Math.round(size * 0.34)) }}
        >
          {isGroup ? (
            <Users style={{ width: Math.round(size * 0.48), height: Math.round(size * 0.48) }} />
          ) : (
            getInitials(name)
          )}
        </div>
      )}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
      )}
    </div>
  );
}

export function getAccountStatusMeta(status?: string | null): {
  label: string;
  dotClass: string;
  badgeClass: string;
  isConnected: boolean;
} {
  switch (status) {
    case "connected":
      return {
        label: "Đang kết nối",
        dotClass: "bg-emerald-500",
        badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        isConnected: true,
      };
    case "qr_ready":
      return {
        label: "Chờ quét QR",
        dotClass: "bg-amber-500 animate-pulse",
        badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
        isConnected: false,
      };
    case "pairing_ready":
      return {
        label: "Chờ nhập mã 8 ký tự",
        dotClass: "bg-amber-500 animate-pulse",
        badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
        isConnected: false,
      };
    case "connecting":
    case "pending":
      return {
        label: "Đang kết nối...",
        dotClass: "bg-sky-500 animate-pulse",
        badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
        isConnected: false,
      };
    case "logged_out":
      return {
        label: "Đã đăng xuất",
        dotClass: "bg-rose-500",
        badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
        isConnected: false,
      };
    case "error":
      return {
        label: "Lỗi kết nối",
        dotClass: "bg-rose-500",
        badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
        isConnected: false,
      };
    default:
      return {
        label: "Ngắt kết nối",
        dotClass: "bg-slate-400",
        badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
        isConnected: false,
      };
  }
}

export function normalizeWaPhoneDigits(raw?: string | null): string {
  if (!raw) return "";
  const cleaned = raw.trim();
  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) {
    return `84${digits.slice(1)}`;
  }
  return digits;
}

export function extractPhoneFromJid(jid?: string | null): string {
  if (!jid) return "";
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) return "";
  const left = jid.split("@")[0] || "";
  const base = left.split(":")[0] || "";
  return /^\d{7,15}$/.test(base) ? base : "";
}

export function formatPhoneDisplay(raw?: string | null): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("84") && digits.length >= 11 && digits.length <= 12) {
    const local = `0${digits.slice(2)}`;
    return `+84 ${local.slice(1, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  if (digits.length >= 10) {
    return `+${digits}`;
  }
  return raw || digits;
}

export function formatAccountName(acc: WhatsAppAccount): string {
  return (
    acc.label?.trim() ||
    acc.display_name?.trim() ||
    (acc.phone_number ? formatPhoneDisplay(acc.phone_number) : "") ||
    "Tài khoản WhatsApp"
  );
}

export function formatConversationTitle(conv: WhatsAppConversation): string {
  if (conv.title?.trim()) return conv.title.trim();
  const phone = conv.phone_number || extractPhoneFromJid(conv.chat_alt_jid) || extractPhoneFromJid(conv.chat_jid);
  if (phone) return formatPhoneDisplay(phone);
  return conv.chat_jid;
}

export function formatRelativeTimeVi(dateStr?: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "Vừa xong";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}p`;
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) {
    return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  const diffDays = Math.floor(diffSec / 86400);
  if (diffDays === 1) return "Hôm qua";
  if (diffDays < 7) return `${diffDays} ngày`;
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

export function formatTimeClock(dateStr?: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDaySeparator(dateStr?: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) return "Hôm nay";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "Hôm qua";
  return date.toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDurationSeconds(seconds?: number | null): string {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getMessagePreviewText(msg: Partial<WhatsAppMessage>): string {
  if (msg.is_deleted || msg.msg_type === "revoked") return "Tin nhắn đã được thu hồi";
  const txt = msg.text?.trim();
  switch (msg.msg_type) {
    case "image":
      return txt ? `[Hình ảnh] ${txt}` : "[Hình ảnh]";
    case "video":
      return txt ? `[Video] ${txt}` : "[Video]";
    case "voice":
      return "[Tin nhắn thoại]";
    case "audio":
      return "[Âm thanh]";
    case "document":
      return msg.media_filename ? `[Tệp] ${msg.media_filename}` : "[Tệp đính kèm]";
    case "sticker":
      return "[Nhãn dán]";
    case "contact":
      return "[Danh thiếp]";
    case "location":
      return "[Vị trí]";
    case "poll":
      return txt ? `[Bình chọn] ${txt}` : "[Bình chọn]";
    case "call_log":
      return txt || "[Cuộc gọi]";
    default:
      return txt || "[Tin nhắn]";
  }
}

export function formatPairingCodeSpaced(code?: string | null): string {
  const clean = (code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  }
  return code || "";
}

export function isSafeHttpUrl(url?: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
