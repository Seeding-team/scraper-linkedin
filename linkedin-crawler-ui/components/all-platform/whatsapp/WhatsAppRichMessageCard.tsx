"use client";

import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Ban,
  BarChart2,
  Check,
  CheckCheck,
  Clock,
  Contact,
  Copy,
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Forward,
  MapPin,
  MessageCircle,
  Mic,
  Music,
  Pencil,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Reply,
  SmilePlus,
  Trash2,
  Video,
  VideoOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { resolveWhatsAppMediaUrl } from "@/services/whatsapp.service";
import type { WhatsAppMessage, WhatsAppMessageMetadata, WhatsAppReaction } from "@/types/whatsapp";
import {
  formatDurationSeconds,
  formatFileSize,
  formatPhoneDisplay,
  formatTimeClock,
  isSafeHttpUrl,
  WhatsAppAvatar,
} from "./whatsapp-ui";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export interface WhatsAppRichMessageCardProps {
  message: WhatsAppMessage;
  isGroup: boolean;
  onReply: (msg: WhatsAppMessage) => void;
  onEdit: (msg: WhatsAppMessage) => void;
  onDelete: (msg: WhatsAppMessage) => void;
  onForward: (msg: WhatsAppMessage) => void;
  onReact: (msg: WhatsAppMessage, emoji: string) => void;
  onOpenLightbox: (url: string, caption?: string | null) => void;
  onStartChatWithPhone: (phone: string) => void;
  onCallBack: (mode: "audio" | "video") => void;
  onJumpToReply?: (messageId: string) => void;
  isHighlighted?: boolean;
}

function renderLinkedText(text: string): React.ReactNode {
  const urlRegex = /(https?:\/\/[^\s<]+)/gi;
  const parts = text.split(urlRegex);
  return parts.map((part, idx) => {
    if (urlRegex.test(part) && isSafeHttpUrl(part)) {
      return (
        <a
          key={`${idx}-${part.slice(0, 12)}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-emerald-600/60 text-emerald-700 hover:text-emerald-900 break-all"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function parseVcard(vcard?: string | null): { name?: string; phone?: string } {
  if (!vcard) return {};
  const fnMatch = vcard.match(/^FN[^:]*:(.+)$/im);
  const telMatch = vcard.match(/^TEL[^:]*:(.+)$/im);
  return {
    name: fnMatch?.[1]?.trim(),
    phone: telMatch?.[1]?.trim(),
  };
}

function getFileBadgeStyle(filename?: string | null, mime?: string | null) {
  const lower = `${filename || ""} ${mime || ""}`.toLowerCase();
  if (lower.includes("pdf")) {
    return {
      icon: FileText,
      box: "bg-rose-50 text-rose-600 border-rose-200/80",
      tag: "bg-rose-100 text-rose-700",
      label: "PDF",
    };
  }
  if (lower.includes("xls") || lower.includes("sheet") || lower.includes("csv")) {
    return {
      icon: FileSpreadsheet,
      box: "bg-emerald-50 text-emerald-600 border-emerald-200/80",
      tag: "bg-emerald-100 text-emerald-700",
      label: "XLS",
    };
  }
  if (lower.includes("doc") || lower.includes("word")) {
    return {
      icon: FileText,
      box: "bg-blue-50 text-blue-600 border-blue-200/80",
      tag: "bg-blue-100 text-blue-700",
      label: "DOC",
    };
  }
  if (lower.includes("zip") || lower.includes("rar") || lower.includes("7z")) {
    return {
      icon: FileArchive,
      box: "bg-amber-50 text-amber-700 border-amber-200/80",
      tag: "bg-amber-100 text-amber-800",
      label: "ZIP",
    };
  }
  return {
    icon: FileIcon,
    box: "bg-slate-100 text-slate-600 border-slate-200",
    tag: "bg-slate-200 text-slate-700",
    label: "FILE",
  };
}

function DeliveryTicks({ message }: { message: WhatsAppMessage }) {
  if (!message.is_outgoing) return null;
  if (message._optimistic_status === "failed" || message.ack_status === "failed") {
    return (
      <span title="Gửi thất bại" className="text-rose-500">
        <AlertCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (message._optimistic || message.ack_status === "pending" || message.ack_status === "sending") {
    return (
      <span title="Đang gửi..." className="text-slate-400">
        <Clock className="h-3 w-3" />
      </span>
    );
  }
  if (message.ack_status === "read" || message.ack_status === "played") {
    return (
      <span title="Đã xem" className="text-[#53bdeb]">
        <CheckCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (message.ack_status === "delivered") {
    return (
      <span title="Đã nhận" className="text-slate-500">
        <CheckCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span title="Đã gửi" className="text-slate-400">
      <Check className="h-3.5 w-3.5" />
    </span>
  );
}

function CallLogCard({
  message,
  onCallBack,
}: {
  message: WhatsAppMessage;
  onCallBack: (mode: "audio" | "video") => void;
}) {
  const meta: WhatsAppMessageMetadata = message.metadata || {};
  const nested = meta.call_log;
  const isVideo = Boolean(
    nested?.is_video ??
      meta.is_video ??
      (nested?.call_type || meta.call_type) === "video",
  );
  const direction = String(
    nested?.direction || meta.direction || (message.is_outgoing ? "outbound" : "inbound"),
  );
  const status = String(
    nested?.call_status || nested?.status || meta.call_status || meta.status || "ended",
  ).toLowerCase();
  const duration = Number(nested?.duration_seconds ?? meta.duration_seconds ?? 0);

  const isMissed =
    status === "missed" || status === "timeout" || (status === "offer" && direction === "inbound");
  const isRejected = status === "rejected" || status === "reject";
  const isOutgoing = direction === "outbound" || message.is_outgoing;

  const title = isMissed
    ? isVideo
      ? "Cuộc gọi video nhỡ"
      : "Cuộc gọi thoại nhỡ"
    : isRejected
      ? "Cuộc gọi bị từ chối"
      : isOutgoing
        ? isVideo
          ? "Cuộc gọi video đi"
          : "Cuộc gọi thoại đi"
        : isVideo
          ? "Cuộc gọi video đến"
          : "Cuộc gọi thoại đến";

  const subtitle =
    duration > 0
      ? `Thời lượng ${formatDurationSeconds(duration)}`
      : isMissed
        ? "Không trả lời"
        : isRejected
          ? "Đã từ chối"
          : status === "connected" || status === "accept"
            ? "Đang kết nối"
            : message.text || "Cuộc gọi WhatsApp";

  const iconBg = isMissed
    ? "bg-rose-100 text-rose-600"
    : isRejected
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border shadow-2xs min-w-[228px] max-w-[276px] select-none",
        isMissed
          ? "border-rose-200 bg-white"
          : message.is_outgoing
            ? "border-emerald-200/90 bg-[#e7ffdb]"
            : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", iconBg)}>
          {isVideo ? (
            isMissed || isRejected ? (
              <VideoOff className="h-[18px] w-[18px]" />
            ) : (
              <Video className="h-[18px] w-[18px]" />
            )
          ) : isMissed ? (
            <PhoneMissed className="h-[18px] w-[18px]" />
          ) : isRejected ? (
            <PhoneOff className="h-[18px] w-[18px]" />
          ) : isOutgoing ? (
            <PhoneOutgoing className="h-[18px] w-[18px]" />
          ) : (
            <PhoneIncoming className="h-[18px] w-[18px]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[13px] font-bold", isMissed ? "text-rose-600" : "text-slate-900")}>
            {title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="truncate">{subtitle}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400 tabular-nums">
            <span>{formatTimeClock(message.sent_at)}</span>
            <DeliveryTicks message={message} />
          </div>
        </div>
      </div>
      <div className={cn("border-t", isMissed ? "border-rose-100" : "border-slate-200/70")}>
        <button
          type="button"
          onClick={() => onCallBack(isVideo ? "video" : "audio")}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 py-2 text-xs font-bold transition cursor-pointer",
            isMissed
              ? "text-rose-600 hover:bg-rose-50"
              : "text-emerald-700 hover:bg-emerald-50/80",
          )}
        >
          {isVideo ? <Video className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
          <span>{isVideo ? "Gọi video lại" : "Gọi lại"}</span>
        </button>
      </div>
    </div>
  );
}

export function WhatsAppRichMessageCard({
  message,
  isGroup,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onReact,
  onOpenLightbox,
  onStartChatWithPhone,
  onCallBack,
  onJumpToReply,
  isHighlighted = false,
}: WhatsAppRichMessageCardProps) {
  const [showReactBar, setShowReactBar] = useState(false);

  const groupedReactions = useMemo(() => {
    const map = new Map<string, number>();
    const list: WhatsAppReaction[] = Array.isArray(message.reactions) ? message.reactions : [];
    for (const r of list) {
      if (!r?.emoji) continue;
      map.set(r.emoji, (map.get(r.emoji) || 0) + 1);
    }
    return Array.from(map.entries());
  }, [message.reactions]);

  // System message centered pill
  if (message.msg_type === "system") {
    return (
      <div className="my-2 flex justify-center px-4">
        <span className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-2xs">
          {message.text || "Thông báo hệ thống"}
        </span>
      </div>
    );
  }

  const isOut = Boolean(message.is_outgoing);
  const isRevoked = Boolean(message.is_deleted || message.msg_type === "revoked");
  const isSticker = !isRevoked && message.msg_type === "sticker";
  const isCallLog = !isRevoked && message.msg_type === "call_log";
  const mediaSrc = resolveWhatsAppMediaUrl(message.media_url, message.account_id, message.message_id);
  const meta: WhatsAppMessageMetadata = message.metadata || {};

  // Contact metadata extraction
  const vcardParsed = parseVcard(meta.contact?.vcard || meta.vcard);
  const contactName =
    meta.contact?.display_name ||
    meta.contact?.contact_name ||
    meta.display_name ||
    meta.contact_name ||
    vcardParsed.name ||
    message.text ||
    "Danh thiếp";
  const contactPhone =
    meta.contact?.phone_number ||
    meta.contact?.contact_phone ||
    meta.contact_phone ||
    meta.phone ||
    vcardParsed.phone ||
    "";

  // Location metadata extraction
  const lat = Number(meta.location?.latitude ?? meta.latitude ?? NaN);
  const lng = Number(meta.location?.longitude ?? meta.longitude ?? NaN);
  const locName = meta.location?.name || meta.name || "Vị trí được chia sẻ";
  const locAddress = meta.location?.address || meta.address || "";
  const mapsUrl =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : null;

  // Poll metadata extraction
  const pollQuestion = meta.poll?.question || meta.question || message.text || "Cuộc bình chọn";
  const pollOptions = (meta.poll?.options || meta.options || []).map((opt) =>
    typeof opt === "string" ? { name: opt, votes: undefined } : opt,
  );

  const canEdit = isOut && !isRevoked && message.msg_type === "text" && !message._optimistic;

  return (
    <div
      id={`wa-msg-${message.message_id}`}
      className={cn(
        "group relative flex w-full gap-2 px-4 py-1 transition-colors",
        isOut ? "justify-end" : "justify-start",
        isHighlighted && "bg-amber-100/70 rounded-xl",
      )}
    >
      {/* Incoming avatar for group chats */}
      {!isOut && isGroup && (
        <div className="mt-1 shrink-0">
          <WhatsAppAvatar name={message.sender_name || message.sender_phone || "?"} size={30} />
        </div>
      )}

      <div className={cn("relative flex max-w-[78%] sm:max-w-[68%] flex-col", isOut ? "items-end" : "items-start")}>
        {/* Sender label in group */}
        {!isOut && isGroup && (message.sender_name || message.sender_phone) && (
          <span className="mb-0.5 ml-1 text-[11px] font-bold text-teal-700">
            {message.sender_name || formatPhoneDisplay(message.sender_phone)}
          </span>
        )}

        <div className={cn("relative flex items-center gap-1.5", isOut ? "flex-row-reverse" : "flex-row")}>
          {/* Main Bubble / Card */}
          {isCallLog ? (
            <CallLogCard message={message} onCallBack={onCallBack} />
          ) : isRevoked ? (
            <div className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white/80 px-3.5 py-2 text-xs italic text-slate-400">
              <Ban className="h-3.5 w-3.5 shrink-0" />
              <span>Tin nhắn đã được thu hồi</span>
              <span className="ml-1 text-[10px] not-italic tabular-nums">
                {formatTimeClock(message.sent_at)}
              </span>
            </div>
          ) : isSticker && mediaSrc ? (
            <div className="flex flex-col items-end">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaSrc}
                alt="Sticker"
                className="h-32 w-32 object-contain drop-shadow-xs"
              />
              <div className="mt-0.5 flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[10px] text-slate-500 shadow-2xs">
                <span>{formatTimeClock(message.sent_at)}</span>
                <DeliveryTicks message={message} />
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "relative overflow-hidden rounded-2xl border px-3 py-2 text-[13.5px] leading-relaxed shadow-2xs",
                isOut
                  ? "rounded-tr-xs border-emerald-200/90 bg-[#d9fdd3] text-slate-900"
                  : "rounded-tl-xs border-slate-200/90 bg-white text-slate-900",
                message._optimistic && "opacity-85",
              )}
            >
              {/* Quoted Reply Header */}
              {(message.reply_to_message_id || message.quoted_text) && (
                <button
                  type="button"
                  onClick={() =>
                    message.reply_to_message_id && onJumpToReply?.(message.reply_to_message_id)
                  }
                  className={cn(
                    "mb-1.5 flex w-full flex-col rounded-lg border-l-[3px] border-emerald-600 px-2.5 py-1 text-left transition cursor-pointer",
                    isOut ? "bg-emerald-900/5 hover:bg-emerald-900/10" : "bg-slate-100 hover:bg-slate-200/70",
                  )}
                >
                  <span className="text-[10.5px] font-bold text-emerald-700">Trả lời tin nhắn</span>
                  <span className="line-clamp-2 text-[11.5px] text-slate-600">
                    {message.quoted_text || "Tin nhắn gốc"}
                  </span>
                </button>
              )}

              {/* IMAGE */}
              {message.msg_type === "image" && (
                <div className="space-y-1.5">
                  {mediaSrc ? (
                    <button
                      type="button"
                      onClick={() => onOpenLightbox(mediaSrc, message.text)}
                      className="block overflow-hidden rounded-xl border border-black/5 cursor-zoom-in"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mediaSrc}
                        alt={message.media_filename || "Hình ảnh WhatsApp"}
                        className="max-h-72 max-w-[280px] sm:max-w-[320px] object-cover transition hover:opacity-95"
                      />
                    </button>
                  ) : (
                    <div className="rounded-xl bg-slate-100 px-3 py-4 text-xs text-slate-500">
                      [Hình ảnh không khả dụng]
                    </div>
                  )}
                  {message.text && (
                    <div className="whitespace-pre-wrap break-words text-[13.5px]">
                      {renderLinkedText(message.text)}
                    </div>
                  )}
                </div>
              )}

              {/* VIDEO */}
              {message.msg_type === "video" && (
                <div className="space-y-1.5">
                  {mediaSrc ? (
                    <video
                      src={mediaSrc}
                      controls
                      preload="metadata"
                      className="max-h-72 max-w-[300px] rounded-xl bg-black"
                    />
                  ) : (
                    <div className="rounded-xl bg-slate-100 px-3 py-4 text-xs text-slate-500">
                      [Video không khả dụng]
                    </div>
                  )}
                  {message.text && (
                    <div className="whitespace-pre-wrap break-words text-[13.5px]">
                      {renderLinkedText(message.text)}
                    </div>
                  )}
                </div>
              )}

              {/* VOICE / AUDIO */}
              {(message.msg_type === "voice" || message.msg_type === "audio") && (
                <div className="min-w-[230px] space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                      {message.msg_type === "voice" ? (
                        <Mic className="h-4 w-4" />
                      ) : (
                        <Music className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                        <span>{message.msg_type === "voice" ? "Tin nhắn thoại" : "Tệp âm thanh"}</span>
                        {typeof message.media_duration_s === "number" && message.media_duration_s > 0 && (
                          <span className="rounded bg-black/5 px-1.5 py-0.2 font-mono text-[10px]">
                            {formatDurationSeconds(message.media_duration_s)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {mediaSrc ? (
                    <audio src={mediaSrc} controls preload="metadata" className="h-8 w-full max-w-[260px]" />
                  ) : (
                    <span className="text-xs text-slate-500">[Âm thanh chưa tải xuống]</span>
                  )}
                </div>
              )}

              {/* DOCUMENT */}
              {message.msg_type === "document" && (() => {
                const badge = getFileBadgeStyle(message.media_filename, message.media_mime);
                const IconComp = badge.icon;
                return (
                  <div className="space-y-1.5 min-w-[220px]">
                    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/80 p-2.5">
                      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", badge.box)}>
                        <IconComp className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-slate-900">
                          {message.media_filename || "Tài liệu đính kèm"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-500">
                          <span className={cn("rounded px-1.5 py-0.2 font-bold text-[9.5px]", badge.tag)}>
                            {badge.label}
                          </span>
                          {message.media_size ? <span>{formatFileSize(message.media_size)}</span> : null}
                        </div>
                      </div>
                      {mediaSrc && (
                        <a
                          href={mediaSrc}
                          download={message.media_filename || "file"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition"
                          title="Tải xuống"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    {message.text && (
                      <div className="whitespace-pre-wrap break-words text-[13px]">
                        {renderLinkedText(message.text)}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* CONTACT VCARD */}
              {message.msg_type === "contact" && (
                <div className="min-w-[230px] overflow-hidden rounded-xl border border-slate-200/90 bg-white">
                  <div className="flex items-center gap-2.5 p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                      <Contact className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-slate-900">{contactName}</div>
                      {contactPhone && (
                        <div className="mt-0.5 text-[11px] font-mono text-slate-600">
                          {formatPhoneDisplay(contactPhone)}
                        </div>
                      )}
                    </div>
                  </div>
                  {contactPhone && (
                    <div className="grid grid-cols-2 border-t border-slate-100 divide-x divide-slate-100 text-[11.5px] font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(contactPhone);
                          toast.success("Đã copy số điện thoại.");
                        }}
                        className="flex items-center justify-center gap-1 py-2 text-slate-600 hover:bg-slate-50 cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy SĐT
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartChatWithPhone(contactPhone)}
                        className="flex items-center justify-center gap-1 py-2 text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Nhắn tin
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* LOCATION */}
              {message.msg_type === "location" && (
                <div className="min-w-[230px] overflow-hidden rounded-xl border border-slate-200/90 bg-white">
                  <div className="flex items-start gap-2.5 bg-gradient-to-br from-emerald-50 to-teal-50 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white shadow-xs">
                      <MapPin className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-slate-900">{locName}</div>
                      {locAddress && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">{locAddress}</div>
                      )}
                      {Number.isFinite(lat) && Number.isFinite(lng) && (
                        <div className="mt-1 font-mono text-[10px] text-slate-500">
                          {lat.toFixed(5)}, {lng.toFixed(5)}
                        </div>
                      )}
                    </div>
                  </div>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 border-t border-slate-100 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Mở trên Google Maps
                    </a>
                  )}
                </div>
              )}

              {/* POLL */}
              {message.msg_type === "poll" && (
                <div className="min-w-[235px] space-y-2 rounded-xl border border-slate-200/80 bg-white/90 p-3">
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <BarChart2 className="h-4 w-4 shrink-0" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">Bình chọn</span>
                  </div>
                  <div className="text-xs font-bold text-slate-900">{pollQuestion}</div>
                  {pollOptions.length > 0 && (
                    <div className="space-y-1.5">
                      {pollOptions.map((opt, i) => (
                        <div
                          key={`${i}-${opt.name}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800"
                        >
                          <span className="truncate">{opt.name}</span>
                          {typeof opt.votes === "number" && (
                            <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">
                              {opt.votes}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* DEFAULT / TEXT */}
              {(message.msg_type === "text" ||
                message.msg_type === "unknown" ||
                ![
                  "image",
                  "video",
                  "voice",
                  "audio",
                  "document",
                  "contact",
                  "location",
                  "poll",
                ].includes(message.msg_type)) && (
                <div className="whitespace-pre-wrap break-words">
                  {message.text ? renderLinkedText(message.text) : <span className="italic text-slate-400">[Nội dung trống]</span>}
                </div>
              )}

              {/* Footer timestamp + edited + ticks */}
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500/90 tabular-nums select-none">
                {message.is_edited && <span className="italic">đã chỉnh sửa</span>}
                <span>{formatTimeClock(message.sent_at)}</span>
                <DeliveryTicks message={message} />
              </div>
            </div>
          )}

          {/* Hover Action Toolbar */}
          {!isRevoked && !message._optimistic && (
            <div
              className={cn(
                "flex items-center gap-0.5 rounded-full border border-slate-200/90 bg-white/95 px-1 py-0.5 shadow-sm transition-opacity",
                showReactBar ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowReactBar((v) => !v)}
                  title="Thả cảm xúc"
                  className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-amber-600 cursor-pointer"
                >
                  <SmilePlus className="h-3.5 w-3.5" />
                </button>
                {showReactBar && (
                  <div
                    className={cn(
                      "absolute bottom-8 z-30 flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-1 shadow-xl",
                      isOut ? "right-0" : "left-0",
                    )}
                  >
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          setShowReactBar(false);
                          onReact(message, emoji);
                        }}
                        className="rounded-full p-1 text-base leading-none hover:scale-125 hover:bg-slate-100 transition cursor-pointer"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onReply(message)}
                title="Trả lời"
                className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-emerald-700 cursor-pointer"
              >
                <Reply className="h-3.5 w-3.5" />
              </button>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(message)}
                  title="Chỉnh sửa"
                  className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-sky-600 cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => onForward(message)}
                title="Chuyển tiếp"
                className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 cursor-pointer"
              >
                <Forward className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onDelete(message)}
                title={isOut ? "Thu hồi tin nhắn" : "Xóa tin nhắn"}
                className="rounded-full p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Emoji Reaction Pills */}
        {groupedReactions.length > 0 && !isRevoked && (
          <div className={cn("mt-0.5 flex flex-wrap gap-1", isOut ? "justify-end" : "justify-start")}>
            {groupedReactions.map(([emoji, count]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(message, emoji)}
                className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] shadow-2xs hover:border-emerald-300 hover:bg-emerald-50 transition cursor-pointer"
              >
                <span>{emoji}</span>
                {count > 1 && <span className="text-[10px] font-bold text-slate-600">{count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
