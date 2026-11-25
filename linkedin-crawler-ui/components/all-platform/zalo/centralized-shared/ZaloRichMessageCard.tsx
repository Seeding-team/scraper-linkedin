"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  BarChart2,
  Bell,
  Cake,
  CalendarClock,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Contact,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  Gift,
  Globe,
  HeartHandshake,
  Image as ImageIcon,
  Info,
  Landmark,
  Link2,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Newspaper,
  Phone,
  Pin,
  Play,
  PlayCircle,
  Presentation,
  QrCode,
  RotateCcw,
  Settings,
  Shield,
  ShieldAlert,
  ShieldBan,
  Smile,
  Sparkles,
  StickyNote,
  Timer,
  User,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE_URL, API_KEY } from "@/lib/env";
import { isSendBubblePlaceholder, type ZaloCallMessageInfo } from "@/lib/zaloCallMessage";
import {
  extractFreeTextBankAccounts,
  extractVietnamesePhones,
  formatBytes,
  formatDuration,
  kindLabel,
  lookupVietnamBankByBin,
  lookupVietnamBankByKeyword,
  normalizeStoredMessage,
  type ExtractedFreeTextBankAccount,
  type ExtractedVietnamesePhone,
  type NormalizedZaloMessage,
  type StoredMessageRow,
  type ZaloAttachment,
  type ZaloLinkSubType,
  type ZaloMessageKind,
  type ZaloSystemEventCategory,
  type ZaloSystemEventIconKind,
  type ZaloSystemEventMeta,
} from "@/lib/zaloMessageContent";
import { ZaloCallMessageCard } from "./ZaloCallMessageCard";

// ---------------------------------------------------------------------------
// Shared helpers & safe hooks
// ---------------------------------------------------------------------------

function isSafeHttpUrl(url?: string | null): url is string {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeDomainOf(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function buildDownloadProxyUrl(url: string, filename?: string): string {
  if (!url) return "";
  const name = filename || "attachment";
  return `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(name)}`;
}

function ensureFilenameWithExt(name?: string, ext?: string): string {
  const cleanName = (name || "").trim();
  const cleanExt = (ext || "").trim().replace(/^\./, "").toLowerCase();
  if (!cleanName) return cleanExt ? `Tệp đính kèm.${cleanExt}` : "Tệp đính kèm";
  if (!cleanExt) return cleanName;
  if (cleanName.toLowerCase().endsWith(`.${cleanExt}`)) return cleanName;
  return `${cleanName}.${cleanExt}`;
}

function formatPhoneReadable(raw?: string | null): { display: string; clean: string } {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { display: "", clean: "" };
  const hasPlus84 = /^\+?84/.test(trimmed.replace(/[\s.-]/g, ""));
  let digits = trimmed.replace(/\D/g, "");
  if (hasPlus84 && digits.startsWith("84") && digits.length >= 10 && digits.length <= 12) {
    digits = `0${digits.slice(2)}`;
  }
  if (/^0\d{9}$/.test(digits)) {
    return {
      display: `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`,
      clean: digits,
    };
  }
  if (/^0\d{10}$/.test(digits)) {
    return {
      display: `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`,
      clean: digits,
    };
  }
  return { display: trimmed, clean: digits || trimmed };
}

function formatDueTimeLabel(dueTime?: string | number): string {
  if (dueTime === undefined || dueTime === null || dueTime === "") return "";
  if (typeof dueTime === "number" || /^\d{10,13}$/.test(String(dueTime).trim())) {
    const rawNum = Number(dueTime);
    if (!Number.isFinite(rawNum) || rawNum <= 0) return "";
    const ms = rawNum < 1e12 ? rawNum * 1000 : rawNum;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  const str = String(dueTime).trim();
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}-\d{2}-\d{2}/.test(str)) {
    return parsed.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  return str;
}

function sanitizeUiText(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (isSendBubblePlaceholder(trimmed)) return "";
  if (/—\s*mở\s*zalo\s*để\s*xem/i.test(trimmed)) {
    const cleaned = trimmed.replace(/\s*—\s*mở\s*zalo\s*để\s*xem\s*/gi, "").trim();
    if (!cleaned || /^tin nhắn dạng/i.test(cleaned)) return "";
    return cleaned;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        obj &&
        typeof obj === "object" &&
        ("msgType" in obj || "action" in obj || "cliMsgId" in obj || "zinstantdata_id" in obj || "data" in obj)
      ) {
        return "";
      }
    } catch {
      // keep normal text
    }
  }
  return raw;
}

function useCopyFeedback(durationMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text) return;
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else if (typeof document !== "undefined") {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), durationMs);
      } catch {
        // Ignore clipboard errors; value remains select-all for manual copy.
      }
    },
    [durationMs],
  );

  return { copied, copy };
}

function SafeMediaImage({
  src,
  alt,
  className,
  fallback,
  onLoad,
}: {
  src: string;
  alt: string;
  className: string;
  fallback?: React.ReactNode;
  onLoad?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return <>{fallback ?? null}</>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailedSrc(src)}
      onLoad={onLoad}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// 1. ZaloFileCard (file & folder)
// ---------------------------------------------------------------------------

type FileVisualCategory = "pdf" | "docx" | "xlsx" | "pptx" | "zip" | "media" | "folder" | "default";

const FILE_VISUAL_STYLES: Record<
  FileVisualCategory,
  {
    iconBox: string;
    badge: string;
    label: string;
  }
> = {
  pdf: {
    iconBox: "bg-rose-50 text-rose-600 border border-rose-200/80",
    badge: "bg-rose-100 text-rose-700",
    label: "PDF",
  },
  docx: {
    iconBox: "bg-blue-50 text-blue-600 border border-blue-200/80",
    badge: "bg-blue-100 text-blue-700",
    label: "DOC",
  },
  xlsx: {
    iconBox: "bg-emerald-50 text-emerald-600 border border-emerald-200/80",
    badge: "bg-emerald-100 text-emerald-700",
    label: "XLS",
  },
  pptx: {
    iconBox: "bg-orange-50 text-orange-600 border border-orange-200/80",
    badge: "bg-orange-100 text-orange-700",
    label: "PPT",
  },
  zip: {
    iconBox: "bg-amber-50 text-amber-700 border border-amber-200/80",
    badge: "bg-amber-100 text-amber-800",
    label: "ZIP",
  },
  media: {
    iconBox: "bg-violet-50 text-violet-600 border border-violet-200/80",
    badge: "bg-violet-100 text-violet-700",
    label: "MEDIA",
  },
  folder: {
    iconBox: "bg-sky-50 text-sky-600 border border-sky-200/80",
    badge: "bg-sky-100 text-sky-700",
    label: "THƯ MỤC",
  },
  default: {
    iconBox: "bg-slate-100 text-slate-600 border border-slate-200/80",
    badge: "bg-slate-100 text-slate-600",
    label: "FILE",
  },
};

function resolveFileCategory(ext: string, isFolder: boolean): FileVisualCategory {
  if (isFolder) return "folder";
  const lower = ext.toLowerCase();
  if (lower === "pdf") return "pdf";
  if (["doc", "docx", "rtf", "odt", "txt", "md"].includes(lower)) return "docx";
  if (["xls", "xlsx", "csv", "ods", "tsv"].includes(lower)) return "xlsx";
  if (["ppt", "pptx", "key", "odp"].includes(lower)) return "pptx";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(lower)) return "zip";
  if (
    [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "gif",
      "svg",
      "bmp",
      "heic",
      "mp4",
      "mov",
      "m4v",
      "webm",
      "mkv",
      "avi",
      "mp3",
      "m4a",
      "wav",
      "ogg",
      "aac",
    ].includes(lower)
  ) {
    return "media";
  }
  return "default";
}

function renderFileCategoryIcon(category: FileVisualCategory, compact: boolean) {
  const cls = compact ? "h-4 w-4" : "h-[18px] w-[18px]";
  switch (category) {
    case "folder":
      return <FolderOpen className={cls} />;
    case "pdf":
    case "docx":
      return <FileText className={cls} />;
    case "xlsx":
      return <FileSpreadsheet className={cls} />;
    case "pptx":
      return <Presentation className={cls} />;
    case "zip":
      return <FileArchive className={cls} />;
    case "media":
      return <FileVideo className={cls} />;
    default:
      return <FileIcon className={cls} />;
  }
}

export interface ZaloFileCardProps {
  attachment?: ZaloAttachment;
  name?: string;
  url?: string;
  ext?: string;
  sizeBytes?: number;
  isFolder?: boolean;
  expired?: boolean;
  isOwn?: boolean;
  compact?: boolean;
  className?: string;
}

export function ZaloFileCard({
  attachment,
  name,
  url,
  ext,
  sizeBytes,
  isFolder,
  expired,
  isOwn = false,
  compact = false,
  className,
}: ZaloFileCardProps) {
  const resolvedFolder = Boolean(isFolder ?? attachment?.is_folder ?? attachment?.kind === "folder");
  const resolvedUrl = url ?? attachment?.url;
  const hasValidUrl = isSafeHttpUrl(resolvedUrl);
  const isExpired = Boolean(expired ?? attachment?.expired ?? !hasValidUrl);
  const resolvedExt = (ext ?? attachment?.ext ?? "").replace(/^\./, "").toLowerCase();
  const displayName = resolvedFolder
    ? (name ?? attachment?.name ?? attachment?.title ?? "Thư mục được chia sẻ").trim()
    : ensureFilenameWithExt(name ?? attachment?.name ?? attachment?.title, resolvedExt);
  const sizeLabel = formatBytes(sizeBytes ?? attachment?.size_bytes);
  const category = resolveFileCategory(resolvedExt, resolvedFolder);
  const visual = FILE_VISUAL_STYLES[category];
  const extBadgeText = resolvedFolder ? "THƯ MỤC" : (resolvedExt ? resolvedExt.toUpperCase().slice(0, 6) : visual.label);
  const downloadHref = hasValidUrl
    ? resolvedFolder
      ? resolvedUrl
      : buildDownloadProxyUrl(resolvedUrl, displayName)
    : undefined;

  return (
    <div
      data-slot="zalo-file-card"
      className={cn(
        "overflow-hidden rounded-2xl border text-left shadow-2xs transition-all duration-150",
        compact ? "min-w-[200px] max-w-[264px]" : "min-w-[232px] max-w-[316px]",
        isOwn
          ? "rounded-tr-xs border-blue-200/90 bg-[#f4f8ff] text-slate-900"
          : "rounded-tl-xs border-slate-200/90 bg-white text-slate-900",
        !isExpired && "hover:border-blue-300/90 hover:shadow-xs",
        className,
      )}
    >
      <div className={cn("flex items-center gap-2.5", compact ? "p-2.5" : "p-3")}>
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl shadow-2xs",
            compact ? "h-9 w-9" : "h-10 w-10",
            visual.iconBox,
          )}
        >
          {renderFileCategoryIcon(category, compact)}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate font-semibold leading-snug text-slate-900",
              compact ? "text-[12.5px]" : "text-[13px]",
            )}
            title={displayName}
          >
            {displayName}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide",
                visual.badge,
              )}
            >
              {extBadgeText}
            </span>
            {sizeLabel && (
              <span className="text-[11px] font-medium text-slate-500 tabular-nums">{sizeLabel}</span>
            )}
          </div>

          {isExpired && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 border border-amber-200/70">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Tệp đã hết hạn trên Zalo</span>
            </div>
          )}
        </div>

        {!isExpired && downloadHref && (
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={downloadHref}
              download={resolvedFolder ? undefined : displayName}
              target={resolvedFolder ? "_blank" : undefined}
              rel={resolvedFolder ? "noopener noreferrer" : undefined}
              onClick={(e) => e.stopPropagation()}
              aria-label={resolvedFolder ? `Mở thư mục ${displayName}` : `Tải xuống ${displayName}`}
              title={resolvedFolder ? "Mở thư mục" : "Tải xuống tệp"}
              className={cn(
                "inline-flex items-center justify-center rounded-xl border border-blue-200/80 bg-white text-[#0068FF] shadow-2xs transition hover:bg-[#0068FF] hover:text-white hover:border-[#0068FF] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0068FF]/40",
                compact ? "h-7 w-7" : "h-8 w-8",
              )}
            >
              {resolvedFolder ? <ExternalLink className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. ZaloContactCard (Danh thiếp & SĐT)
// ---------------------------------------------------------------------------

export interface ZaloContactCardProps {
  attachment?: ZaloAttachment;
  name?: string;
  phone?: string;
  avatarUrl?: string;
  userId?: string;
  profileUrl?: string;
  variant?: "contact" | "oa" | "profile";
  isOwn?: boolean;
  compact?: boolean;
  onMessage?: (attachment: ZaloAttachment) => void;
  onOpenProfile?: (attachment: ZaloAttachment) => void;
  className?: string;
}

export function ZaloContactCard({
  attachment,
  name,
  phone,
  avatarUrl,
  userId,
  profileUrl,
  variant,
  isOwn = false,
  compact = false,
  onMessage,
  onOpenProfile,
  className,
}: ZaloContactCardProps) {
  const { copied, copy } = useCopyFeedback(1500);
  const resolvedName = (name ?? attachment?.name ?? attachment?.title ?? "Danh thiếp Zalo").trim();
  const rawPhone = (phone ?? attachment?.phone ?? "").trim();
  const { display: formattedPhone, clean: cleanPhone } = formatPhoneReadable(rawPhone);
  const resolvedAvatar = avatarUrl ?? attachment?.avatar_url ?? attachment?.thumb_url;
  const resolvedUrl = profileUrl ?? attachment?.url;
  const hasSafeUrl = isSafeHttpUrl(resolvedUrl);
  const resolvedUserId = userId ?? attachment?.user_id;

  const resolvedVariant: "contact" | "oa" | "profile" =
    variant ??
    (attachment?.title && /hồ sơ/i.test(attachment.title)
      ? "profile"
      : attachment?.description && /\boa\b|official/i.test(attachment.description)
        ? "oa"
        : "contact");

  const headerLabel =
    resolvedVariant === "profile"
      ? "Hồ sơ Zalo"
      : resolvedVariant === "oa"
        ? "Danh thiếp OA"
        : "Danh thiếp Zalo";

  const initial = resolvedName ? resolvedName.charAt(0).toUpperCase() : "";

  const effectiveAttachment: ZaloAttachment = useMemo(
    () => ({
      ...(attachment ?? { kind: "contact" }),
      kind: "contact",
      name: resolvedName,
      phone: cleanPhone || rawPhone || undefined,
      avatar_url: resolvedAvatar,
      url: hasSafeUrl ? resolvedUrl : undefined,
      user_id: resolvedUserId,
    }),
    [attachment, resolvedName, cleanPhone, rawPhone, resolvedAvatar, hasSafeUrl, resolvedUrl, resolvedUserId],
  );

  const hasFooter = Boolean((cleanPhone && onMessage) || onOpenProfile || hasSafeUrl);

  return (
    <div
      data-slot="zalo-contact-card"
      className={cn(
        "overflow-hidden rounded-2xl border text-left shadow-2xs transition-all duration-150",
        compact ? "min-w-[208px] max-w-[264px]" : "min-w-[236px] max-w-[308px]",
        isOwn
          ? "rounded-tr-xs border-blue-200/90 bg-white text-slate-900"
          : "rounded-tl-xs border-slate-200/90 bg-white text-slate-900",
        className,
      )}
    >
      {/* Header badge */}
      <div className="flex items-center justify-between gap-2 border-b border-blue-100/80 bg-gradient-to-r from-[#eef5ff] via-[#f7faff] to-white px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0068FF]">
          {resolvedVariant === "oa" ? (
            <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Contact className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{headerLabel}</span>
        </div>
        {cleanPhone && (
          <a
            href={`tel:${cleanPhone}`}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Gọi ${formattedPhone}`}
            title={`Gọi ${formattedPhone}`}
            className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 border border-emerald-200/80 transition hover:bg-emerald-50"
          >
            <Phone className="h-2.5 w-2.5" />
            <span>Gọi</span>
          </a>
        )}
      </div>

      {/* Main identity */}
      <div className={cn("flex items-center gap-3", compact ? "p-2.5" : "p-3")}>
        <div
          className={cn(
            "relative shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-blue-100 to-sky-100 ring-2 ring-blue-100/80",
            compact ? "h-10 w-10" : "h-11 w-11",
          )}
        >
          <SafeMediaImage
            src={resolvedAvatar || ""}
            alt={resolvedName}
            className="h-full w-full object-cover"
            fallback={
              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[#0068FF] select-none">
                {initial || <User className="h-4 w-4" />}
              </div>
            }
          />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate font-bold leading-snug text-slate-900",
              compact ? "text-[13px]" : "text-[13.5px]",
            )}
            title={resolvedName}
          >
            {resolvedName}
          </div>

          {formattedPhone ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[14px] font-semibold tracking-tight text-slate-800 select-all">
                {formattedPhone}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void copy(cleanPhone || rawPhone);
                }}
                aria-label="Sao chép số điện thoại"
                title="Sao chép số điện thoại"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0068FF]/40",
                  copied
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-blue-200/80 bg-blue-50/80 text-[#0068FF] hover:bg-blue-100/80",
                )}
              >
                {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
                <span>{copied ? "Đã chép" : "Sao chép SĐT"}</span>
              </button>
            </div>
          ) : (
            <div className="mt-0.5 text-[11.5px] text-slate-500">Liên hệ Zalo</div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      {hasFooter && (
        <div className="flex divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/50">
          {cleanPhone && onMessage && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMessage(effectiveAttachment);
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 font-semibold text-[#0068FF] transition hover:bg-blue-50/80 cursor-pointer active:scale-[0.99]",
                compact ? "py-1.5 text-[11.5px]" : "py-2 text-[12px]",
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>Nhắn tin</span>
            </button>
          )}
          {onOpenProfile ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenProfile(effectiveAttachment);
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 font-semibold text-slate-700 transition hover:bg-slate-100/80 cursor-pointer active:scale-[0.99]",
                compact ? "py-1.5 text-[11.5px]" : "py-2 text-[12px]",
              )}
            >
              <User className="h-3.5 w-3.5" />
              <span>Xem hồ sơ</span>
            </button>
          ) : hasSafeUrl ? (
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 font-semibold text-[#0068FF] transition hover:bg-blue-50/80",
                compact ? "py-1.5 text-[11.5px]" : "py-2 text-[12px]",
              )}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Xem hồ sơ</span>
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. ZaloBankCard & ZaloBankAccountChip (Thẻ ngân hàng & VietQR)
// ---------------------------------------------------------------------------

interface ResolvedBankcardData {
  bin?: string;
  bank_name?: string;
  bank_short_name?: string;
  account_number?: string;
  account_name?: string;
  logo_url?: string;
  bg_url?: string;
  qr_url?: string;
}

const BANKCARD_CACHE = new Map<string, ResolvedBankcardData>();
const BANKCARD_INFLIGHT = new Map<string, Promise<ResolvedBankcardData>>();

function enrichBankData(raw: ResolvedBankcardData): ResolvedBankcardData {
  const byBin = raw.bin ? lookupVietnamBankByBin(raw.bin) : null;
  const byName = !byBin && raw.bank_name ? lookupVietnamBankByKeyword(raw.bank_name) : null;
  const matched = byBin || byName;

  return {
    bin: raw.bin || matched?.bin,
    bank_short_name: raw.bank_short_name || matched?.shortName,
    bank_name: raw.bank_name || matched?.fullName || matched?.shortName,
    account_number: raw.account_number,
    account_name: raw.account_name,
    logo_url: raw.logo_url,
    bg_url: raw.bg_url,
    qr_url: raw.qr_url,
  };
}

function extractBankcardFromHtml(html: string): ResolvedBankcardData {
  const clean = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  const texts: string[] = [];
  for (const m of clean.matchAll(/>([^<]+)</g)) {
    const t = m[1].trim();
    if (t) texts.push(t);
  }

  const urls: string[] = [];
  for (const m of html.matchAll(/url\((.*?)\)/gi)) {
    const u = m[1].trim().replace(/^['"]|['"]$/g, "");
    if (u) urls.push(u);
  }
  for (const m of html.matchAll(/src=["']([^"']+)["']/gi)) {
    const u = m[1].trim();
    if (u) urls.push(u);
  }

  const logo_url = urls.find((u) => /logo/i.test(u));
  const bg_url = urls.find((u) => /bg/i.test(u));
  const qr_url = urls.find((u) => /group-qr|vietqr|\bqr\b/i.test(u));

  const bin = texts.find((t) => /^\d{6,7}$/.test(t) && Boolean(lookupVietnamBankByBin(t)))
    || (texts[0] && /^\d{6,7}$/.test(texts[0]) ? texts[0] : undefined);

  const bank_name =
    texts.find((t) => t !== bin && (/ngân\s*hàng|bank/i.test(t) || Boolean(lookupVietnamBankByKeyword(t))))
    || (texts[1] && texts[1] !== bin ? texts[1] : undefined);

  let account_number =
    texts[2] && /^[0-9A-Za-z]{6,20}$/.test(texts[2]) && /\d{5,}/.test(texts[2]) && texts[2] !== bin
      ? texts[2]
      : undefined;

  if (!account_number) {
    for (const t of texts) {
      const compactVal = t.replace(/\s+/g, "");
      if (/^[0-9A-Za-z]{6,20}$/.test(compactVal) && /\d{5,}/.test(compactVal) && compactVal !== bin) {
        account_number = compactVal;
        break;
      }
    }
  }

  const account_name = texts.find(
    (t) =>
      t !== bin &&
      t !== bank_name &&
      t !== account_number &&
      /^[A-ZÀ-Ỹ][A-ZÀ-Ỹ\s]{3,48}$/.test(t) &&
      !/NGÂN HÀNG|BANK|VIETQR|ZALO/i.test(t),
  );

  return enrichBankData({
    bin,
    bank_name,
    account_number,
    account_name,
    logo_url,
    bg_url,
    qr_url,
  });
}

async function fetchBankcardPreview(rawDataUrl: string): Promise<ResolvedBankcardData> {
  const cached = BANKCARD_CACHE.get(rawDataUrl);
  if (cached) return cached;

  const inflight = BANKCARD_INFLIGHT.get(rawDataUrl);
  if (inflight) return inflight;

  const task = (async (): Promise<ResolvedBankcardData> => {
    let directParsed: ResolvedBankcardData = {};

    // 1. Try direct CDN fetch first (zinst-stc.zadn.vn serves ACAO: *)
    if (isSafeHttpUrl(rawDataUrl)) {
      const htmlUrl = rawDataUrl.includes("data=html")
        ? rawDataUrl
        : rawDataUrl.includes("?")
          ? `${rawDataUrl}&data=html`
          : `${rawDataUrl}?data=html`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(htmlUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const html = await res.text();
          directParsed = extractBankcardFromHtml(html);
        }
      } catch {
        // Fallback to backend proxy below
      }
    }

    if (directParsed.account_number) {
      BANKCARD_CACHE.set(rawDataUrl, directParsed);
      return directParsed;
    }

    // 2. Reliable backend fallback: GET /api/all-platform/zalo/bankcard-preview?url=...
    try {
      const headers: Record<string, string> = {};
      if (API_KEY) headers["X-API-Key"] = API_KEY;
      const endpoint = `${API_BASE_URL}/api/all-platform/zalo/bankcard-preview?url=${encodeURIComponent(rawDataUrl)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as {
          ok?: boolean;
          bin?: string | null;
          bank_name?: string | null;
          bank_short_name?: string | null;
          account_no?: string | null;
          account_number?: string | null;
          account_name?: string | null;
          logo_url?: string | null;
          qr_url?: string | null;
        };
        if (json && (json.ok !== false)) {
          const merged = enrichBankData({
            bin: json.bin || directParsed.bin,
            bank_name: json.bank_name || directParsed.bank_name,
            bank_short_name: json.bank_short_name || directParsed.bank_short_name,
            account_number: json.account_no || json.account_number || directParsed.account_number,
            account_name: json.account_name || directParsed.account_name,
            logo_url: json.logo_url || directParsed.logo_url,
            bg_url: directParsed.bg_url,
            qr_url: json.qr_url || directParsed.qr_url,
          });
          BANKCARD_CACHE.set(rawDataUrl, merged);
          return merged;
        }
      }
    } catch {
      // Fall back to whatever direct fetch returned
    }

    BANKCARD_CACHE.set(rawDataUrl, directParsed);
    return directParsed;
  })();

  BANKCARD_INFLIGHT.set(rawDataUrl, task);
  try {
    return await task;
  } finally {
    BANKCARD_INFLIGHT.delete(rawDataUrl);
  }
}

export interface ZaloBankCardProps {
  attachment?: ZaloAttachment;
  bin?: string;
  bankName?: string;
  bankShortName?: string;
  accountNumber?: string;
  accountName?: string;
  logoUrl?: string;
  bgUrl?: string;
  qrUrl?: string;
  dataUrl?: string;
  isOwn?: boolean;
  compact?: boolean;
  onOpenImage?: (url: string) => void;
  className?: string;
}

export function ZaloBankCard({
  attachment,
  bin,
  bankName,
  bankShortName,
  accountNumber,
  accountName,
  logoUrl,
  bgUrl,
  qrUrl,
  dataUrl,
  isOwn = false,
  compact = false,
  onOpenImage,
  className,
}: ZaloBankCardProps) {
  const resolvedDataUrl = (dataUrl ?? attachment?.data_url ?? attachment?.url ?? "").trim();
  const initialInline = useMemo(
    () =>
      enrichBankData({
        bin: bin ?? attachment?.bin,
        bank_name: bankName ?? attachment?.bank_name,
        bank_short_name: bankShortName ?? attachment?.bank_short_name,
        account_number: accountNumber ?? attachment?.account_number,
        account_name: accountName ?? attachment?.account_name,
        logo_url: logoUrl ?? attachment?.logo_url,
        bg_url: bgUrl ?? attachment?.bg_url,
        qr_url: qrUrl ?? attachment?.qr_url,
      }),
    [
      bin,
      bankName,
      bankShortName,
      accountNumber,
      accountName,
      logoUrl,
      bgUrl,
      qrUrl,
      attachment?.bin,
      attachment?.bank_name,
      attachment?.bank_short_name,
      attachment?.account_number,
      attachment?.account_name,
      attachment?.logo_url,
      attachment?.bg_url,
      attachment?.qr_url,
    ],
  );

  const cachedEntry = resolvedDataUrl ? BANKCARD_CACHE.get(resolvedDataUrl) : undefined;
  const needsRemoteFetch = Boolean(
    resolvedDataUrl && !initialInline.account_number && !cachedEntry,
  );

  const [fetched, setFetched] = useState<{ url: string; data: ResolvedBankcardData } | null>(null);
  const [qrExpanded, setQrExpanded] = useState(!compact);
  const [qrBrokenUrl, setQrBrokenUrl] = useState<string | null>(null);
  const { copied, copy } = useCopyFeedback(1500);

  useEffect(() => {
    if (!needsRemoteFetch || !resolvedDataUrl) return;
    let cancelled = false;
    void fetchBankcardPreview(resolvedDataUrl).then((resolved) => {
      if (!cancelled) {
        setFetched({ url: resolvedDataUrl, data: resolved });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needsRemoteFetch, resolvedDataUrl]);

  const remoteData =
    cachedEntry ?? (fetched && fetched.url === resolvedDataUrl ? fetched.data : undefined);
  const isLoading = Boolean(needsRemoteFetch && !remoteData);

  const merged = useMemo(
    () =>
      enrichBankData({
        bin: initialInline.bin || remoteData?.bin,
        bank_name: initialInline.bank_name || remoteData?.bank_name,
        bank_short_name: initialInline.bank_short_name || remoteData?.bank_short_name,
        account_number: initialInline.account_number || remoteData?.account_number,
        account_name: initialInline.account_name || remoteData?.account_name,
        logo_url: initialInline.logo_url || remoteData?.logo_url,
        bg_url: initialInline.bg_url || remoteData?.bg_url,
        qr_url: initialInline.qr_url || remoteData?.qr_url,
      }),
    [initialInline, remoteData],
  );

  const displayBankLabel = merged.bank_short_name || merged.bank_name || "Tài khoản ngân hàng";
  const displayBankSub =
    merged.bank_short_name && merged.bank_name && merged.bank_name !== merged.bank_short_name
      ? merged.bank_name
      : undefined;
  const accNum = merged.account_number?.trim();
  const hasQr = Boolean(merged.qr_url && isSafeHttpUrl(merged.qr_url) && qrBrokenUrl !== merged.qr_url);

  return (
    <div
      data-slot="zalo-bank-card"
      className={cn(
        "overflow-hidden rounded-2xl border text-left shadow-2xs transition-all duration-150",
        compact ? "min-w-[210px] max-w-[268px]" : "min-w-[244px] max-w-[316px]",
        isOwn
          ? "rounded-tr-xs border-blue-200/90 bg-white text-slate-900"
          : "rounded-tl-xs border-slate-200/90 bg-white text-slate-900",
        className,
      )}
    >
      {/* Header bank strip */}
      <div className="flex items-center justify-between gap-2 border-b border-blue-100/80 bg-gradient-to-r from-[#eaf3ff] via-[#f6faff] to-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-blue-100 bg-white shadow-2xs">
            <SafeMediaImage
              src={merged.logo_url || ""}
              alt={displayBankLabel}
              className="h-5 w-5 object-contain"
              fallback={<Landmark className="h-4 w-4 text-[#0068FF]" />}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-bold text-slate-900" title={displayBankSub || displayBankLabel}>
              {displayBankLabel}
            </div>
            {displayBankSub && !compact && (
              <div className="truncate text-[10.5px] text-slate-500" title={displayBankSub}>
                {displayBankSub}
              </div>
            )}
          </div>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-[#0068FF] border border-blue-200/70">
          <CreditCard className="h-2.5 w-2.5" />
          <span>VietQR</span>
        </span>
      </div>

      {/* Body */}
      <div className={cn("space-y-2", compact ? "p-2.5" : "p-3")}>
        {isLoading ? (
          <div className="flex items-center gap-2 py-1 text-xs text-slate-500 animate-pulse">
            <CreditCard className="h-4 w-4 shrink-0 text-[#0068FF]" />
            <span>Đang nạp thông tin tài khoản...</span>
          </div>
        ) : (
          <>
            {merged.account_name && (
              <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {merged.account_name}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2">
              <div className="min-w-0">
                <div className="text-[10px] font-medium text-slate-400">Số tài khoản</div>
                <div
                  className={cn(
                    "font-mono font-bold tracking-wider select-all break-all",
                    compact ? "text-[14px]" : "text-[15px]",
                    accNum ? "text-[#0068FF]" : "text-slate-600 font-sans text-[12.5px] font-semibold",
                  )}
                >
                  {accNum || "Thẻ tài khoản ngân hàng"}
                </div>
              </div>

              {accNum && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void copy(accNum.replace(/\s+/g, ""));
                  }}
                  aria-label="Sao chép số tài khoản"
                  title="Sao chép số tài khoản"
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] font-semibold transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0068FF]/40",
                    copied
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-blue-200/90 bg-white text-[#0068FF] hover:bg-blue-50",
                  )}
                >
                  {copied ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
                  <span>{copied ? "Đã chép" : "Sao chép"}</span>
                </button>
              )}
            </div>

            {hasQr && merged.qr_url && (
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQrExpanded((prev) => !prev);
                  }}
                  aria-expanded={qrExpanded}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-[#0068FF] transition cursor-pointer"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{qrExpanded ? "Ẩn mã VietQR" : "Hiện mã VietQR"}</span>
                  {qrExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>

                {qrExpanded && (
                  <div className="mt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onOpenImage) {
                          onOpenImage(merged.qr_url!);
                        } else {
                          window.open(merged.qr_url!, "_blank", "noopener,noreferrer");
                        }
                      }}
                      title="Bấm để phóng to mã VietQR"
                      className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xs transition hover:border-blue-300 hover:shadow-sm cursor-zoom-in"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={merged.qr_url}
                        alt={`Mã VietQR ${displayBankLabel}`}
                        loading="lazy"
                        onError={() => setQrBrokenUrl(merged.qr_url || null)}
                        className={cn("rounded-lg object-contain", compact ? "h-28 w-28" : "h-36 w-36")}
                      />
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export interface ZaloBankAccountChipProps {
  accountNo: string;
  bankShortName?: string;
  bankFullName?: string;
  bin?: string;
  accountName?: string;
  compact?: boolean;
  className?: string;
}

export function ZaloBankAccountChip({
  accountNo,
  bankShortName,
  bankFullName,
  bin,
  accountName,
  compact = false,
  className,
}: ZaloBankAccountChipProps) {
  const { copied, copy } = useCopyFeedback(1500);
  const matched = bin ? lookupVietnamBankByBin(bin) : undefined;
  const resolvedBank = bankShortName || matched?.shortName || bankFullName;
  const cleanDigits = accountNo.replace(/\s+/g, "");

  return (
    <div
      data-slot="zalo-bank-account-chip"
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-blue-200/90 bg-white text-slate-900 shadow-2xs",
        compact ? "px-2 py-1" : "px-2.5 py-1.5",
        className,
      )}
    >
      <span
        className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10.5px] font-bold text-[#0068FF] border border-blue-200/70"
        title={bankFullName || resolvedBank || "Số tài khoản ngân hàng"}
      >
        <Landmark className="h-3 w-3 shrink-0" />
        <span>{resolvedBank || "STK"}</span>
      </span>

      <span
        className={cn(
          "font-mono font-bold tracking-wider text-slate-900 select-all",
          compact ? "text-[12.5px]" : "text-[13.5px]",
        )}
      >
        {accountNo}
      </span>

      {accountName && !compact && (
        <span className="truncate max-w-[140px] text-[10.5px] font-medium text-slate-500">
          · {accountName}
        </span>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copy(cleanDigits);
        }}
        aria-label={`Sao chép số tài khoản ${accountNo}`}
        title="Sao chép số tài khoản"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0068FF]/40",
          copied
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-blue-200/80 bg-blue-50/70 text-[#0068FF] hover:bg-blue-100/80",
        )}
      >
        {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
        <span>{copied ? "Đã chép" : "Sao chép"}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. ZaloLinkCard (Rich Link / MiniApp / OA / Video Share)
// ---------------------------------------------------------------------------

const LINK_SUBTYPE_META: Record<
  ZaloLinkSubType,
  { label: string; chipClass: string }
> = {
  link: { label: "Liên kết", chipClass: "bg-slate-100 text-slate-600 border-slate-200/80" },
  minisite: { label: "Liên kết", chipClass: "bg-slate-100 text-slate-600 border-slate-200/80" },
  miniapp: { label: "Mini App", chipClass: "bg-violet-50 text-violet-700 border-violet-200/80" },
  oa: { label: "Zalo OA", chipClass: "bg-blue-50 text-[#0068FF] border-blue-200/80" },
  zvideo: { label: "Zalo Video", chipClass: "bg-rose-50 text-rose-600 border-rose-200/80" },
  article: { label: "Bài viết", chipClass: "bg-amber-50 text-amber-700 border-amber-200/80" },
  post: { label: "Bài đăng", chipClass: "bg-amber-50 text-amber-700 border-amber-200/80" },
};

function renderLinkSubTypeIcon(subType: ZaloLinkSubType) {
  switch (subType) {
    case "miniapp":
      return <Sparkles className="h-3 w-3 shrink-0" />;
    case "oa":
      return <BadgeCheck className="h-3 w-3 shrink-0" />;
    case "zvideo":
      return <PlayCircle className="h-3 w-3 shrink-0" />;
    case "article":
    case "post":
      return <Newspaper className="h-3 w-3 shrink-0" />;
    default:
      return <Globe className="h-3 w-3 shrink-0" />;
  }
}

export interface ZaloLinkCardProps {
  attachment?: ZaloAttachment;
  url?: string;
  title?: string;
  description?: string;
  thumbUrl?: string;
  domain?: string;
  subType?: ZaloLinkSubType;
  isOwn?: boolean;
  compact?: boolean;
  className?: string;
}

export function ZaloLinkCard({
  attachment,
  url,
  title,
  description,
  thumbUrl,
  domain,
  subType,
  isOwn = false,
  compact = false,
  className,
}: ZaloLinkCardProps) {
  const resolvedUrl = (url ?? attachment?.url ?? "").trim();
  const hasSafeUrl = isSafeHttpUrl(resolvedUrl);
  const resolvedDomain = (domain ?? attachment?.domain ?? safeDomainOf(resolvedUrl)).trim();
  const resolvedTitle = sanitizeUiText(title ?? attachment?.title) || resolvedDomain || resolvedUrl || "Liên kết";
  const resolvedDesc = sanitizeUiText(description ?? attachment?.description);
  const resolvedThumb = thumbUrl ?? attachment?.thumb_url;
  const resolvedSubType: ZaloLinkSubType = subType ?? attachment?.link_subtype ?? "link";
  const meta = LINK_SUBTYPE_META[resolvedSubType] || LINK_SUBTYPE_META.link;

  const cardInner = (
    <div
      data-slot="zalo-link-card"
      className={cn(
        "overflow-hidden rounded-2xl border text-left shadow-2xs transition-all duration-150",
        compact ? "min-w-[208px] max-w-[264px]" : "min-w-[236px] max-w-[316px]",
        isOwn
          ? "rounded-tr-xs border-blue-200/90 bg-white text-slate-900"
          : "rounded-tl-xs border-slate-200/90 bg-white text-slate-900",
        hasSafeUrl && "group hover:border-blue-300/90 hover:shadow-xs",
        className,
      )}
    >
      {resolvedThumb && isSafeHttpUrl(resolvedThumb) && (
        <SafeMediaImage
          src={resolvedThumb}
          alt={resolvedTitle}
          className={cn("w-full object-cover bg-slate-100", compact ? "h-28" : "h-36")}
        />
      )}

      <div className={cn("space-y-1.5", compact ? "p-2.5" : "p-3")}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              meta.chipClass,
            )}
          >
            {renderLinkSubTypeIcon(resolvedSubType)}
            <span>{meta.label}</span>
          </span>
          {resolvedDomain && (
            <span className="truncate text-[11px] font-medium text-slate-500 max-w-[160px]">
              {resolvedDomain}
            </span>
          )}
        </div>

        <div
          className={cn(
            "line-clamp-2 font-semibold leading-snug text-slate-900 group-hover:text-[#0068FF] transition-colors",
            compact ? "text-[12.5px]" : "text-[13px]",
          )}
        >
          {resolvedTitle}
        </div>

        {resolvedDesc && (
          <div className="line-clamp-2 text-[11.5px] leading-relaxed text-slate-500">
            {resolvedDesc}
          </div>
        )}

        {hasSafeUrl && (
          <div className="flex items-center gap-1 pt-0.5 text-[11px] font-semibold text-[#0068FF]">
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span>Mở liên kết</span>
          </div>
        )}
      </div>
    </div>
  );

  if (!hasSafeUrl) return cardInner;

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0068FF]/40 rounded-2xl"
    >
      {cardInner}
    </a>
  );
}

// ---------------------------------------------------------------------------
// 5. ZaloSystemEventBanner (Friend / Group / eCard / Poll / Reminder / Todo / Undo)
// ---------------------------------------------------------------------------

function renderSystemEventIcon(iconKind: ZaloSystemEventIconKind, cls = "h-3.5 w-3.5 shrink-0") {
  switch (iconKind) {
    case "friend_accept":
      return <HeartHandshake className={cls} />;
    case "friend_request":
      return <UserPlus className={cls} />;
    case "friend_remove":
      return <UserX className={cls} />;
    case "friend_block":
      return <ShieldBan className={cls} />;
    case "stranger":
      return <ShieldAlert className={cls} />;
    case "birthday":
      return <Cake className={cls} />;
    case "ecard":
      return <Gift className={cls} />;
    case "group_join":
      return <UserPlus className={cls} />;
    case "group_leave":
      return <LogOut className={cls} />;
    case "group_remove":
      return <UserMinus className={cls} />;
    case "group_admin":
      return <Shield className={cls} />;
    case "group_rename":
    case "group_avatar":
      return <Users className={cls} />;
    case "group_link":
      return <Link2 className={cls} />;
    case "group_setting":
      return <Settings className={cls} />;
    case "group_disband":
      return <ShieldAlert className={cls} />;
    case "pin":
    case "unpin":
      return <Pin className={cls} />;
    case "poll":
      return <BarChart2 className={cls} />;
    case "reminder":
      return <Bell className={cls} />;
    case "todo":
      return <CheckSquare className={cls} />;
    case "note":
      return <StickyNote className={cls} />;
    case "vanish":
      return <Timer className={cls} />;
    case "e2ee":
      return <Lock className={cls} />;
    case "recall":
      return <RotateCcw className={cls} />;
    default:
      return <Info className={cls} />;
  }
}

const FRIEND_PILL_STYLES: Partial<Record<ZaloSystemEventIconKind, string>> = {
  friend_accept: "border-emerald-200/80 bg-emerald-50/90 text-emerald-800",
  friend_request: "border-blue-200/80 bg-blue-50/90 text-[#0057D9]",
  friend_remove: "border-slate-200/90 bg-slate-100/90 text-slate-600",
  friend_block: "border-rose-200/80 bg-rose-50/90 text-rose-700",
  stranger: "border-amber-200/80 bg-amber-50/90 text-amber-800",
};

const STRUCTURED_EVENT_STYLES: Record<
  "poll" | "reminder" | "todo",
  { header: string; badge: string; label: string; border: string }
> = {
  poll: {
    header: "bg-indigo-50/85 border-b border-indigo-100 text-indigo-700",
    badge: "bg-indigo-100 text-indigo-700",
    label: "Bình chọn",
    border: "border-indigo-200/80",
  },
  reminder: {
    header: "bg-amber-50/85 border-b border-amber-100 text-amber-800",
    badge: "bg-amber-100 text-amber-800",
    label: "Nhắc hẹn",
    border: "border-amber-200/80",
  },
  todo: {
    header: "bg-emerald-50/85 border-b border-emerald-100 text-emerald-800",
    badge: "bg-emerald-100 text-emerald-800",
    label: "Zalo To-Do",
    border: "border-emerald-200/80",
  },
};

export interface ZaloSystemEventBannerProps {
  event?: ZaloSystemEventMeta;
  title?: string;
  subtitle?: string;
  category?: ZaloSystemEventCategory;
  iconKind?: ZaloSystemEventIconKind;
  compact?: boolean;
  className?: string;
}

export function ZaloSystemEventBanner({
  event,
  title,
  subtitle,
  category,
  iconKind,
  compact = false,
  className,
}: ZaloSystemEventBannerProps) {
  const resolvedCategory: ZaloSystemEventCategory = category ?? event?.category ?? "info";
  const resolvedIcon: ZaloSystemEventIconKind =
    iconKind ??
    event?.iconKind ??
    (resolvedCategory === "undo"
      ? "recall"
      : resolvedCategory === "poll"
        ? "poll"
        : resolvedCategory === "reminder"
          ? "reminder"
          : resolvedCategory === "todo"
            ? "todo"
            : resolvedCategory === "ecard"
              ? "ecard"
              : resolvedCategory === "friend"
                ? "friend_accept"
                : "info");
  const resolvedTitle =
    sanitizeUiText(title ?? event?.title) ||
    (resolvedCategory === "undo" ? "Tin nhắn đã được thu hồi" : "Thông báo hệ thống");
  const resolvedSubtitle = sanitizeUiText(subtitle ?? event?.subtitle);

  // 1. Recalled / Undo pill
  if (resolvedCategory === "undo" || resolvedIcon === "recall") {
    return (
      <div data-slot="zalo-system-banner" className={cn("flex w-full justify-center py-1", className)}>
        <div className="inline-flex max-w-[92%] items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-100/90 px-3 py-1 text-[11.5px] italic text-slate-500 shadow-2xs">
          <RotateCcw className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="text-center">{resolvedTitle}</span>
        </div>
      </div>
    );
  }

  // 2. eCard / Greeting festive mini-card
  if (resolvedCategory === "ecard" || resolvedIcon === "ecard" || resolvedIcon === "birthday") {
    const artwork = event?.bannerUrl || event?.thumb;
    const isBirthday = resolvedIcon === "birthday" || event?.ecardType === 1;
    const isFriendCard = event?.ecardType === 2 || event?.ecardType === 3;
    return (
      <div data-slot="zalo-system-banner" className={cn("flex w-full justify-center py-1.5", className)}>
        <div
          className={cn(
            "w-full overflow-hidden rounded-2xl border text-center shadow-2xs",
            compact ? "max-w-[256px]" : "max-w-[304px]",
            isBirthday
              ? "border-rose-200/80 bg-gradient-to-br from-rose-50/90 via-white to-amber-50/80"
              : isFriendCard
                ? "border-sky-200/80 bg-gradient-to-br from-sky-50/90 via-white to-blue-50/70"
                : "border-amber-200/80 bg-gradient-to-br from-amber-50/80 via-white to-rose-50/60",
          )}
        >
          {artwork && isSafeHttpUrl(artwork) && (
            <SafeMediaImage
              src={artwork}
              alt={resolvedTitle}
              className={cn("w-full object-cover", compact ? "h-24" : "h-32")}
            />
          )}
          <div className={cn("flex flex-col items-center gap-1.5", compact ? "p-2.5" : "p-3.5")}>
            <span
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full shadow-2xs",
                isBirthday
                  ? "bg-rose-100 text-rose-600"
                  : isFriendCard
                    ? "bg-blue-100 text-[#0068FF]"
                    : "bg-amber-100 text-amber-700",
              )}
            >
              {isFriendCard ? <UserCheck className="h-4 w-4" /> : renderSystemEventIcon(resolvedIcon, "h-4 w-4")}
            </span>
            <div className="text-[12.5px] font-semibold leading-snug text-slate-800">{resolvedTitle}</div>
            {resolvedSubtitle && (
              <div className="text-[11.5px] leading-relaxed text-slate-600">{resolvedSubtitle}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. Poll / Reminder / Todo structured mini-card
  if (resolvedCategory === "poll" || resolvedCategory === "reminder" || resolvedCategory === "todo") {
    const theme = STRUCTURED_EVENT_STYLES[resolvedCategory];
    const options = event?.options?.filter((opt) => typeof opt === "string" && opt.trim()) || [];
    const dueLabel = formatDueTimeLabel(event?.dueTime);

    return (
      <div data-slot="zalo-system-banner" className={cn("flex w-full justify-center py-1.5", className)}>
        <div
          className={cn(
            "w-full overflow-hidden rounded-2xl border bg-white text-left shadow-2xs",
            compact ? "max-w-[264px]" : "max-w-[320px]",
            theme.border,
          )}
        >
          <div className={cn("flex items-center justify-between gap-2 px-3 py-1.5", theme.header)}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {renderSystemEventIcon(resolvedIcon, "h-3.5 w-3.5 shrink-0")}
              <span>{theme.label}</span>
            </div>
            {dueLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                <CalendarClock className="h-3 w-3 shrink-0" />
                <span className="tabular-nums">{dueLabel}</span>
              </span>
            )}
          </div>

          <div className={cn("space-y-1.5", compact ? "p-2.5" : "p-3")}>
            <div className="text-[12.5px] font-semibold leading-snug text-slate-900">{resolvedTitle}</div>
            {resolvedSubtitle && (
              <div className="text-[11.5px] leading-relaxed text-slate-600">{resolvedSubtitle}</div>
            )}
            {options.length > 0 && (
              <div className="space-y-1 pt-1">
                {options.slice(0, 4).map((opt) => (
                  <div
                    key={opt}
                    className="truncate rounded-lg border border-indigo-100 bg-indigo-50/40 px-2.5 py-1 text-[11.5px] font-medium text-slate-700"
                  >
                    {opt}
                  </div>
                ))}
                {options.length > 4 && (
                  <div className="text-[10.5px] font-medium text-slate-400">
                    +{options.length - 4} lựa chọn khác
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 4. Friend events / Group events / msginfo.actionlist / general system pill
  const pillStyle =
    resolvedCategory === "friend"
      ? FRIEND_PILL_STYLES[resolvedIcon] || "border-blue-200/80 bg-blue-50/90 text-[#0057D9]"
      : resolvedIcon === "group_disband"
        ? "border-rose-200/80 bg-rose-50/90 text-rose-700"
        : resolvedIcon === "pin"
          ? "border-sky-200/80 bg-sky-50/90 text-sky-800"
          : "border-slate-200/80 bg-slate-100/90 text-slate-600";

  return (
    <div data-slot="zalo-system-banner" className={cn("flex w-full justify-center py-1", className)}>
      <div
        className={cn(
          "inline-flex max-w-[92%] items-center gap-1.5 rounded-full border px-3 py-1 text-center font-medium shadow-2xs",
          compact ? "text-[11px]" : "text-[12px]",
          pillStyle,
        )}
      >
        {renderSystemEventIcon(resolvedIcon, "h-3.5 w-3.5 shrink-0")}
        <span className="leading-snug">
          {resolvedTitle}
          {resolvedSubtitle ? <span className="opacity-80"> · {resolvedSubtitle}</span> : null}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. ZaloLocationCard
// ---------------------------------------------------------------------------

export interface ZaloLocationCardProps {
  attachment?: ZaloAttachment;
  title?: string;
  address?: string;
  lat?: number;
  lon?: number;
  url?: string;
  isOwn?: boolean;
  compact?: boolean;
  className?: string;
}

export function ZaloLocationCard({
  attachment,
  title,
  address,
  lat,
  lon,
  url,
  isOwn = false,
  compact = false,
  className,
}: ZaloLocationCardProps) {
  const resolvedLat = lat ?? attachment?.lat;
  const resolvedLon = lon ?? attachment?.lon;
  const hasCoords =
    typeof resolvedLat === "number" &&
    typeof resolvedLon === "number" &&
    Number.isFinite(resolvedLat) &&
    Number.isFinite(resolvedLon);
  const coordsLabel = hasCoords ? `${resolvedLat.toFixed(5)}, ${resolvedLon.toFixed(5)}` : "";
  const resolvedUrl =
    url ??
    attachment?.url ??
    (hasCoords ? `https://www.google.com/maps?q=${resolvedLat},${resolvedLon}` : undefined);
  const hasSafeUrl = isSafeHttpUrl(resolvedUrl);
  const resolvedTitle = sanitizeUiText(title ?? attachment?.title) || "Vị trí được chia sẻ";
  const resolvedAddress = sanitizeUiText(address ?? attachment?.address ?? attachment?.description);

  return (
    <div
      data-slot="zalo-location-card"
      className={cn(
        "overflow-hidden rounded-2xl border text-left shadow-2xs transition-all duration-150",
        compact ? "min-w-[208px] max-w-[264px]" : "min-w-[236px] max-w-[308px]",
        isOwn
          ? "rounded-tr-xs border-blue-200/90 bg-white text-slate-900"
          : "rounded-tl-xs border-slate-200/90 bg-white text-slate-900",
        className,
      )}
    >
      <div className={cn("flex items-start gap-2.5", compact ? "p-2.5" : "p-3")}>
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-200/80 shadow-2xs",
            compact ? "h-9 w-9" : "h-10 w-10",
          )}
        >
          <MapPin className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"} />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={cn("truncate font-semibold text-slate-900", compact ? "text-[12.5px]" : "text-[13px]")}
            title={resolvedTitle}
          >
            {resolvedTitle}
          </div>
          {resolvedAddress && (
            <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-slate-600">
              {resolvedAddress}
            </div>
          )}
          {coordsLabel && (
            <div className="mt-1 font-mono text-[10.5px] font-medium text-slate-400 tabular-nums">
              {coordsLabel}
            </div>
          )}
        </div>
      </div>

      {hasSafeUrl && (
        <div className="border-t border-slate-100 bg-slate-50/50">
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 font-semibold text-[#0068FF] transition hover:bg-blue-50/80",
              compact ? "py-1.5 text-[11.5px]" : "py-2 text-[12px]",
            )}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Mở trên Google Maps</span>
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media sub-cards (Image/GIF/Doodle Grid, Video, Voice, Sticker)
// ---------------------------------------------------------------------------

export function ZaloImageGrid({
  items,
  compact = false,
  onLoad,
  onOpenImage,
  className,
}: {
  items: ZaloAttachment[];
  compact?: boolean;
  onLoad?: () => void;
  onOpenImage?: (url: string, index?: number) => void;
  className?: string;
}) {
  const validItems = items.filter((a) => isSafeHttpUrl(a.url));
  if (validItems.length === 0) return null;

  return (
    <div
      data-slot="zalo-image-grid"
      className={cn(
        "grid gap-1.5",
        validItems.length > 1 ? "grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {validItems.map((item, idx) => {
        const url = item.url!;
        const imgClass = cn(
          "max-w-full rounded-xl object-cover border border-slate-200/70 bg-slate-100 transition hover:opacity-95",
          validItems.length > 1
            ? compact
              ? "h-28 w-full"
              : "h-36 w-full"
            : compact
              ? "max-h-48"
              : "max-h-64",
        );

        const placeholder = (
          <div className={cn("grid place-items-center rounded-xl bg-slate-100 text-slate-400 p-6", imgClass)}>
            <ImageIcon className="h-6 w-6" />
          </div>
        );

        if (onOpenImage) {
          return (
            <button
              key={`${url}-${idx}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenImage(url, idx);
              }}
              className="block overflow-hidden rounded-xl text-left cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0068FF]/40"
              aria-label={`Xem hình ảnh ${idx + 1}`}
            >
              <SafeMediaImage src={url} alt={`Hình ảnh ${idx + 1}`} className={imgClass} fallback={placeholder} onLoad={onLoad} />
            </button>
          );
        }

        return (
          <a
            key={`${url}-${idx}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="block overflow-hidden rounded-xl"
          >
            <SafeMediaImage src={url} alt={`Hình ảnh ${idx + 1}`} className={imgClass} fallback={placeholder} onLoad={onLoad} />
          </a>
        );
      })}
    </div>
  );
}

export function ZaloVideoCard({
  attachment,
  compact = false,
  onLoad,
  className,
}: {
  attachment: ZaloAttachment;
  compact?: boolean;
  onLoad?: () => void;
  className?: string;
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const url = attachment.url;
  if (!isSafeHttpUrl(url)) return null;

  const isHls = /\.m3u8(\?|#|$)/i.test(url);
  const isSafari = typeof navigator !== "undefined" && /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent);
  const duration = formatDuration(attachment.duration_ms);
  const title = sanitizeUiText(attachment.title) || "Video";

  if (brokenUrl === url || (isHls && !isSafari)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-white p-2.5 text-slate-900 shadow-2xs transition hover:border-blue-300 hover:bg-slate-50",
          compact ? "min-w-[200px] max-w-[256px]" : "min-w-[232px] max-w-[308px]",
          className,
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0068FF] text-white shadow-2xs">
          <Play className="h-4 w-4 fill-current" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{title}</span>
          <span className="block text-[11px] text-slate-500">
            {[duration, formatBytes(attachment.size_bytes), "Mở để xem"].filter(Boolean).join(" · ")}
          </span>
        </span>
      </a>
    );
  }

  return (
    <div
      data-slot="zalo-video-card"
      className={cn("overflow-hidden rounded-2xl border border-slate-200/80 bg-black shadow-2xs", className)}
    >
      <video
        src={url}
        poster={isSafeHttpUrl(attachment.thumb_url) ? attachment.thumb_url : undefined}
        controls
        playsInline
        preload="metadata"
        onError={() => setBrokenUrl(url)}
        onLoadedMetadata={onLoad}
        className={cn("w-full bg-black", compact ? "max-h-52 max-w-[256px]" : "max-h-72 max-w-[320px]")}
      />
      {(attachment.title || duration) && (
        <div className="flex items-center justify-between gap-2 bg-black/85 px-2.5 py-1 text-[11px] text-white/90">
          <span className="truncate">{title}</span>
          {duration ? <span className="shrink-0 font-mono tabular-nums">{duration}</span> : null}
        </div>
      )}
    </div>
  );
}

export function ZaloVoiceCard({
  attachment,
  compact = false,
  className,
}: {
  attachment: ZaloAttachment;
  compact?: boolean;
  className?: string;
}) {
  if (!isSafeHttpUrl(attachment.url)) return null;
  const duration = formatDuration(attachment.duration_ms);

  return (
    <div
      data-slot="zalo-voice-card"
      className={cn(
        "rounded-2xl border border-slate-200/90 bg-white p-2 text-slate-900 shadow-2xs",
        compact ? "min-w-[200px] max-w-[252px]" : "min-w-[232px] max-w-[280px]",
        className,
      )}
    >
      <audio src={attachment.url} controls preload="metadata" className="h-9 w-full" />
      <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-slate-500">
        <span>Tin nhắn thoại</span>
        {duration ? <span className="font-mono font-medium tabular-nums">{duration}</span> : null}
      </div>
    </div>
  );
}

export function ZaloStickerCard({
  attachment,
  compact = false,
  className,
}: {
  attachment: ZaloAttachment;
  compact?: boolean;
  className?: string;
}) {
  if (isSafeHttpUrl(attachment.url)) {
    return (
      <SafeMediaImage
        src={attachment.url}
        alt="Nhãn dán Zalo"
        className={cn("object-contain select-none", compact ? "h-24 w-24" : "h-28 w-28", className)}
        fallback={
          <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-600 shadow-2xs">
            <Smile className="h-4 w-4 text-amber-500" />
            <span>Nhãn dán{attachment.sticker_id ? ` #${attachment.sticker_id}` : ""}</span>
          </div>
        }
      />
    );
  }
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-600 shadow-2xs",
        className,
      )}
    >
      <Smile className="h-4 w-4 text-amber-500" />
      <span>Nhãn dán{attachment.sticker_id ? ` #${attachment.sticker_id}` : ""}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. ZaloInlineSmartText (Clickable URLs + Inline Phone Pills + Bank Chip Strip)
// ---------------------------------------------------------------------------

const INLINE_URL_RE = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+\.[a-z]{2,}[^\s<>"'()]*)/gi;

function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  const m = raw.match(/^(.*?)([.,;:!?]+)$/);
  return m && m[1] ? { url: m[1], trailing: m[2] } : { url: raw, trailing: "" };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function InlinePhonePill({
  raw,
  normalized,
  display,
  onDarkSurface,
}: {
  raw: string;
  normalized: string;
  display: string;
  onDarkSurface: boolean;
}) {
  const { copied, copy } = useCopyFeedback(1500);
  const cleanDigits = normalized || raw.replace(/\D/g, "");

  return (
    <span
      className={cn(
        "mx-0.5 inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 align-baseline text-[12.5px] transition",
        onDarkSurface
          ? "border-white/30 bg-white/15 text-white"
          : "border-blue-200/80 bg-blue-50/75 text-[#0057D9]",
      )}
    >
      <a
        href={`tel:${cleanDigits}`}
        onClick={(e) => e.stopPropagation()}
        title={`Gọi ${display || raw}`}
        className="inline-flex items-center gap-1 font-mono font-semibold hover:underline"
      >
        <Phone className="h-3 w-3 shrink-0" />
        <span className="select-all">{raw}</span>
      </a>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copy(cleanDigits);
        }}
        aria-label={`Sao chép số điện thoại ${raw}`}
        title={copied ? "Đã chép" : "Sao chép SĐT"}
        className={cn(
          "inline-flex items-center rounded px-1 py-0.5 text-[10.5px] font-semibold transition cursor-pointer active:scale-95",
          copied
            ? "bg-emerald-500 text-white"
            : onDarkSurface
              ? "bg-white/20 text-white hover:bg-white/30"
              : "bg-white text-[#0068FF] hover:bg-blue-100/80",
        )}
      >
        {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
      </button>
    </span>
  );
}

export interface ZaloInlineSmartTextProps {
  text: string;
  inlineBanks?: ExtractedFreeTextBankAccount[];
  inlinePhones?: ExtractedVietnamesePhone[];
  isOwn?: boolean;
  onDarkSurface?: boolean;
  compact?: boolean;
  className?: string;
}

export function ZaloInlineSmartText({
  text,
  inlineBanks,
  inlinePhones,
  onDarkSurface = false,
  compact = false,
  className,
}: ZaloInlineSmartTextProps) {
  const cleanText = sanitizeUiText(text);

  const resolvedBanks = useMemo(
    () => (inlineBanks !== undefined ? inlineBanks : extractFreeTextBankAccounts(cleanText)),
    [inlineBanks, cleanText],
  );

  const resolvedPhones = useMemo(() => {
    const rawPhones = inlinePhones !== undefined ? inlinePhones : extractVietnamesePhones(cleanText);
    if (rawPhones.length === 0) return [];
    const bankDigitSet = new Set(resolvedBanks.map((b) => b.accountNo.replace(/\D/g, "")));
    return rawPhones.filter((p) => !bankDigitSet.has(p.normalized.replace(/\D/g, "")));
  }, [inlinePhones, cleanText, resolvedBanks]);

  const phoneRegex = useMemo(() => {
    if (resolvedPhones.length === 0) return null;
    const uniqueRaw = Array.from(new Set(resolvedPhones.map((p) => p.raw).filter(Boolean))).sort(
      (a, b) => b.length - a.length,
    );
    if (uniqueRaw.length === 0) return null;
    return new RegExp(`(${uniqueRaw.map(escapeRegExp).join("|")})`, "g");
  }, [resolvedPhones]);

  const phoneLookup = useMemo(() => {
    const map = new Map<string, ExtractedVietnamesePhone>();
    for (const p of resolvedPhones) {
      map.set(p.raw, p);
    }
    return map;
  }, [resolvedPhones]);

  if (!cleanText) return null;

  const renderTextWithPhones = (segment: string, segOffset: number) => {
    if (!phoneRegex) return segment;
    const subParts = segment.split(phoneRegex);
    return subParts.map((sub, subIdx) => {
      if (!sub) return null;
      if (subIdx % 2 === 1) {
        const info = phoneLookup.get(sub);
        if (info) {
          return (
            <InlinePhonePill
              key={`ph-${segOffset}-${subIdx}-${info.normalized}`}
              raw={sub}
              normalized={info.normalized}
              display={info.display}
              onDarkSurface={onDarkSurface}
            />
          );
        }
      }
      return <React.Fragment key={`tx-${segOffset}-${subIdx}`}>{sub}</React.Fragment>;
    });
  };

  const urlParts = cleanText.split(INLINE_URL_RE);

  return (
    <div data-slot="zalo-inline-smart-text" className={cn("min-w-0", className)}>
      <div className="whitespace-pre-wrap break-words">
        {urlParts.map((part, idx) => {
          if (!part) return null;
          if (idx % 2 === 1) {
            const { url, trailing } = splitTrailingPunctuation(part);
            const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
            if (!isSafeHttpUrl(href)) {
              return <React.Fragment key={`u-${idx}`}>{part}</React.Fragment>;
            }
            return (
              <React.Fragment key={`u-${idx}-${url}`}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "underline underline-offset-2 break-all font-medium transition-opacity hover:opacity-85",
                    onDarkSurface ? "text-white decoration-white/75" : "text-[#0068FF] decoration-blue-300",
                  )}
                >
                  {url}
                </a>
                {trailing}
              </React.Fragment>
            );
          }
          return <React.Fragment key={`p-${idx}`}>{renderTextWithPhones(part, idx)}</React.Fragment>;
        })}
      </div>

      {resolvedBanks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {resolvedBanks.map((bank) => (
            <ZaloBankAccountChip
              key={`${bank.bin || bank.bankShortName || "stk"}-${bank.accountNo}`}
              accountNo={bank.accountNo}
              bankShortName={bank.bankShortName}
              bankFullName={bank.bankFullName}
              bin={bank.bin}
              accountName={bank.accountName}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. ZaloRichMessageContent (Unified Drop-in Renderer for ALL 4 Zalo Surfaces)
// ---------------------------------------------------------------------------

/** Trả về `true` nếu tin nhắn nên hiển thị dạng banner căn giữa (không bọc bubble trái/phải). */
export function isCenteredZaloSystemMessage(msg: NormalizedZaloMessage): boolean {
  return Boolean(
    msg.isRecalled ||
      msg.kind === "undo" ||
      msg.kind === "system_notice" ||
      msg.kind === "ecard" ||
      msg.kind === "poll" ||
      msg.kind === "reminder" ||
      msg.kind === "todo" ||
      msg.systemEvent,
  );
}

/** Trả về `true` nếu thẻ đã tự có khung bề mặt hoàn chỉnh (không cần bubble nền bọc ngoài). */
export function isBareZaloRichMessage(msg: NormalizedZaloMessage): boolean {
  if (isCenteredZaloSystemMessage(msg)) return true;
  if (msg.kind === "call" || msg.callInfo) return true;
  if (msg.text.trim()) return false;
  if (msg.attachments.length === 0) return false;
  return msg.attachments.every(
    (a) =>
      a.kind === "image" ||
      a.kind === "gif" ||
      a.kind === "doodle" ||
      a.kind === "sticker" ||
      a.kind === "contact" ||
      a.kind === "bankcard" ||
      a.kind === "file" ||
      a.kind === "folder" ||
      a.kind === "link" ||
      a.kind === "location" ||
      a.kind === "video" ||
      a.kind === "call",
  );
}

function buildFallbackCallInfo(a: ZaloAttachment, isOwn: boolean): ZaloCallMessageInfo {
  return (
    a.call_info || {
      direction: isOwn ? "outgoing" : "incoming",
      mediaType: "audio",
      status: "completed",
      title: a.title || (isOwn ? "Cuộc gọi thoại đi" : "Cuộc gọi thoại đến"),
      subtitle: a.description || "Cuộc gọi Zalo",
      previewLabel: a.title || "Cuộc gọi",
      durationSec: a.duration_ms ? Math.round(a.duration_ms / 1000) : 0,
      durationClock: a.duration_ms ? formatDuration(a.duration_ms) : "",
      durationHuman: a.duration_ms ? formatDuration(a.duration_ms) : "",
      enableCallback: false,
      isMissed: false,
    }
  );
}

export interface ZaloRichMessageContentProps {
  /** Tin nhắn đã chuẩn hóa từ `normalizeStoredMessage(row)` */
  normalized?: NormalizedZaloMessage;
  /** Hoặc truyền thẳng raw row từ DB/API — tự động chuẩn hóa qua `normalizeStoredMessage` */
  message?: StoredMessageRow;
  isOwn?: boolean;
  /** True khi văn bản đặt trên nền bubble đậm (#0068FF / #c62828 / #c2185b) */
  onDarkSurface?: boolean;
  compact?: boolean;
  isSelected?: boolean;
  timeLabel?: string | null;
  onCallBack?: (mode: "voice" | "video") => void;
  onOpenImage?: (url: string, index?: number) => void;
  onContactMessage?: (attachment: ZaloAttachment) => void;
  onOpenProfile?: (attachment: ZaloAttachment) => void;
  onMediaLoad?: () => void;
  className?: string;
}

export function ZaloRichMessageContent({
  normalized,
  message,
  isOwn = false,
  onDarkSurface = false,
  compact = false,
  isSelected = false,
  timeLabel,
  onCallBack,
  onOpenImage,
  onContactMessage,
  onOpenProfile,
  onMediaLoad,
  className,
}: ZaloRichMessageContentProps) {
  const msg = useMemo<NormalizedZaloMessage | null>(() => {
    if (normalized) return normalized;
    if (message) return normalizeStoredMessage(message);
    return null;
  }, [normalized, message]);

  if (!msg) return null;

  // 1. Call bubble — delegates directly to existing ZaloCallMessageCard
  const callAttachment = msg.attachments.find((a) => a.kind === "call");
  if (msg.kind === "call" || msg.callInfo || callAttachment) {
    const info = msg.callInfo || (callAttachment ? buildFallbackCallInfo(callAttachment, isOwn) : null);
    if (info) {
      return (
        <ZaloCallMessageCard
          info={info}
          isSent={isOwn}
          compact={compact}
          isSelected={isSelected}
          timeLabel={timeLabel}
          onCallback={onCallBack}
          className={className}
        />
      );
    }
  }

  // 2. Centered system / friend / group / eCard / poll / reminder / todo / recalled
  if (isCenteredZaloSystemMessage(msg)) {
    const fallbackCategory: ZaloSystemEventCategory =
      msg.isRecalled || msg.kind === "undo"
        ? "undo"
        : msg.kind === "ecard" || msg.kind === "poll" || msg.kind === "reminder" || msg.kind === "todo"
          ? msg.kind
          : "info";

    return (
      <ZaloSystemEventBanner
        event={msg.systemEvent}
        title={msg.systemEvent?.title || msg.system_text || msg.text || (msg.isRecalled ? "Tin nhắn đã được thu hồi" : "Thông báo hệ thống")}
        category={msg.systemEvent?.category || fallbackCategory}
        iconKind={msg.systemEvent?.iconKind}
        compact={compact}
        className={className}
      />
    );
  }

  // 3. Partition image-like attachments vs structured cards
  const imageItems = msg.attachments.filter(
    (a) => a.kind === "image" || a.kind === "gif" || a.kind === "doodle",
  );
  const otherItems = msg.attachments.filter(
    (a) => a.kind !== "image" && a.kind !== "gif" && a.kind !== "doodle",
  );

  // Suppress redundant text labels when an authoritative rich card already conveys it
  const cleanText = sanitizeUiText(msg.text);
  const suppressRedundantText =
    msg.attachments.length > 0 &&
    Boolean(cleanText) &&
    ((msg.kind === "bankcard" && /^\[?(thẻ ngân hàng|tài khoản ngân hàng|bank account)\]?$/i.test(cleanText.trim())) ||
      (msg.kind === "link" && otherItems.some((a) => a.url && a.url.trim() === cleanText.trim())) ||
      ((msg.kind === "file" || msg.kind === "folder") &&
        otherItems.some((a) => a.name && a.name.trim() === cleanText.trim())));

  const shouldShowText = Boolean(cleanText) && !suppressRedundantText;

  // 4. Non-text message whose attachments couldn't be hydrated (no ugly "— mở Zalo để xem")
  if (msg.attachments.length === 0 && !shouldShowText) {
    if (msg.kind === "bankcard") {
      return <ZaloBankCard isOwn={isOwn} compact={compact} onOpenImage={onOpenImage} className={className} />;
    }
    if (msg.kind === "file" || msg.kind === "folder") {
      return (
        <ZaloFileCard
          isFolder={msg.kind === "folder"}
          expired
          isOwn={isOwn}
          compact={compact}
          className={className}
        />
      );
    }
    if (msg.kind === "sticker") {
      return <ZaloStickerCard attachment={{ kind: "sticker" }} compact={compact} className={className} />;
    }
    if (msg.kind === "text") return null;

    const cleanKindText = sanitizeUiText(msg.unknown_label) || kindLabel(msg.kind) || "[Tin nhắn]";
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[12px] font-medium",
          onDarkSurface
            ? "border-white/25 bg-white/15 text-white/90"
            : "border-slate-200/80 bg-slate-50 text-slate-600",
          className,
        )}
      >
        <Info className="h-3.5 w-3.5 shrink-0 opacity-75" />
        <span>{cleanKindText}</span>
      </div>
    );
  }

  return (
    <div data-slot="zalo-rich-message-content" className={cn("flex flex-col gap-1.5", className)}>
      {imageItems.length > 0 && (
        <ZaloImageGrid items={imageItems} compact={compact} onLoad={onMediaLoad} onOpenImage={onOpenImage} />
      )}

      {otherItems.map((a, idx) => {
        const key = `${a.kind}-${a.url || a.data_url || a.sticker_id || a.phone || a.name || idx}`;
        switch (a.kind) {
          case "file":
          case "folder":
            return <ZaloFileCard key={key} attachment={a} isOwn={isOwn} compact={compact} />;
          case "contact":
            return (
              <ZaloContactCard
                key={key}
                attachment={a}
                isOwn={isOwn}
                compact={compact}
                onMessage={onContactMessage}
                onOpenProfile={onOpenProfile}
              />
            );
          case "bankcard":
            return (
              <ZaloBankCard
                key={key}
                attachment={a}
                isOwn={isOwn}
                compact={compact}
                onOpenImage={onOpenImage}
              />
            );
          case "link":
            return <ZaloLinkCard key={key} attachment={a} isOwn={isOwn} compact={compact} />;
          case "location":
            return <ZaloLocationCard key={key} attachment={a} isOwn={isOwn} compact={compact} />;
          case "video":
            return <ZaloVideoCard key={key} attachment={a} compact={compact} onLoad={onMediaLoad} />;
          case "voice":
            return <ZaloVoiceCard key={key} attachment={a} compact={compact} />;
          case "sticker":
            return <ZaloStickerCard key={key} attachment={a} compact={compact} />;
          case "call":
            return (
              <ZaloCallMessageCard
                key={key}
                info={buildFallbackCallInfo(a, isOwn)}
                isSent={isOwn}
                compact={compact}
                isSelected={isSelected}
                timeLabel={timeLabel}
                onCallback={onCallBack}
              />
            );
          case "ecard":
          case "poll":
          case "reminder":
          case "todo":
            return (
              <ZaloSystemEventBanner
                key={key}
                title={a.title || kindLabel(a.kind)}
                subtitle={a.description}
                category={a.kind}
                compact={compact}
              />
            );
          default:
            return null;
        }
      })}

      {shouldShowText && (
        <ZaloInlineSmartText
          text={cleanText}
          inlineBanks={msg.inlineBanks}
          inlinePhones={msg.inlinePhones}
          isOwn={isOwn}
          onDarkSurface={onDarkSurface}
          compact={compact}
        />
      )}
    </div>
  );
}

// Re-export key types for convenient single-file imports across Phase 2B surfaces
export type {
  ExtractedFreeTextBankAccount,
  ExtractedVietnamesePhone,
  NormalizedZaloMessage,
  StoredMessageRow,
  ZaloAttachment,
  ZaloLinkSubType,
  ZaloMessageKind,
  ZaloSystemEventCategory,
  ZaloSystemEventIconKind,
  ZaloSystemEventMeta,
};
