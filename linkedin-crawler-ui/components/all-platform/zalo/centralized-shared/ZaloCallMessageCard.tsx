"use client";

import React from "react";
import {
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Video,
  VideoOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ZaloCallMessageInfo } from "@/lib/zaloCallMessage";

export interface ZaloCallMessageCardProps {
  info: ZaloCallMessageInfo;
  /** Tin gửi đi (căn phải) hay tin nhận (căn trái) */
  isSent?: boolean;
  /** Thời gian gửi (tùy chọn, hiển thị gọn trong thẻ nếu truyền vào) */
  timeLabel?: string | null;
  /** Khi bấm nút "Gọi lại" trên thẻ cuộc gọi */
  onCallback?: (mode: "voice" | "video") => void;
  /** Đang được chọn (checkbox broadcast) */
  isSelected?: boolean;
  /** Phiên bản gọn cho panel hẹp (vd Omnichannel) */
  compact?: boolean;
  className?: string;
}

/**
 * Thẻ tin nhắn cuộc gọi Zalo chuẩn UX native (Cuộc gọi đến / Cuộc gọi đi / Cuộc gọi nhỡ / Video / Từ chối / Đã hủy).
 * Không chứa bất kỳ logic điều khiển VoIP nào — chỉ nhận dữ liệu đã chuẩn hóa và gọi callback mở modal có sẵn.
 */
export function ZaloCallMessageCard({
  info,
  isSent = false,
  timeLabel,
  onCallback,
  isSelected = false,
  compact = false,
  className,
}: ZaloCallMessageCardProps) {
  const isVideo = info.mediaType === "video";
  const isMissedIncoming = info.isMissed;
  const isNegative =
    isMissedIncoming ||
    info.status === "rejected" ||
    info.status === "cancelled" ||
    info.status === "busy" ||
    info.status === "missed";

  // Chọn icon khớp chuẩn trạng thái & chiều cuộc gọi
  const renderIcon = () => {
    const iconCls = compact ? "h-4 w-4" : "h-[18px] w-[18px]";
    if (isVideo) {
      if (isNegative) return <VideoOff className={iconCls} />;
      return <Video className={iconCls} />;
    }
    if (isMissedIncoming) {
      return <PhoneMissed className={iconCls} />;
    }
    if (info.status === "rejected" || info.status === "cancelled" || info.status === "busy") {
      return <PhoneOff className={iconCls} />;
    }
    if (info.direction === "outgoing") {
      return <PhoneOutgoing className={iconCls} />;
    }
    return <PhoneIncoming className={iconCls} />;
  };

  // Bảng màu rõ ràng:
  // - Nhỡ (đến): nền trắng viền hồng nhạt, icon đỏ, tiêu đề đỏ nổi bật
  // - Đi (hoàn thành / bình thường): nền xanh nhạt chuẩn Zalo (#e5efff) hoặc trắng viền xanh nhạt
  // - Đến (hoàn thành): nền trắng viền xám nhạt, icon xanh Zalo
  const cardToneClass = isMissedIncoming
    ? "bg-white border-rose-200/90 text-slate-900"
    : isSent
      ? "bg-[#e5efff] border-blue-200/90 text-slate-900"
      : "bg-white border-slate-200/90 text-slate-900";

  const iconBgClass = isMissedIncoming
    ? "bg-rose-100 text-rose-600"
    : info.status === "rejected" || info.status === "busy"
      ? "bg-amber-100 text-amber-700"
      : info.status === "cancelled" || info.status === "missed"
        ? "bg-slate-200/80 text-slate-600"
        : info.direction === "outgoing"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-blue-100 text-[#0068FF]";

  const titleClass = isMissedIncoming
    ? "text-rose-600 font-bold"
    : "text-slate-900 font-semibold";

  const dividerClass = isMissedIncoming
    ? "border-rose-100"
    : isSent
      ? "border-blue-200/70"
      : "border-slate-100";

  const showCallbackBtn = Boolean(onCallback && info.enableCallback);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border text-left shadow-2xs transition-all duration-150 select-none",
        compact ? "min-w-[196px] max-w-[244px]" : "min-w-[220px] max-w-[268px]",
        isSent ? "rounded-tr-xs" : "rounded-tl-xs",
        cardToneClass,
        isSelected && "ring-2 ring-blue-400 ring-offset-2",
        className,
      )}
    >
      {/* Phần thông tin chính của cuộc gọi */}
      <div className={cn("flex items-center gap-3", compact ? "px-3 py-2.5" : "px-3.5 py-3")}>
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full shadow-2xs",
            compact ? "h-9 w-9" : "h-10 w-10",
            iconBgClass,
          )}
        >
          {renderIcon()}
        </div>

        <div className="min-w-0 flex-1">
          <div className={cn("truncate leading-snug", compact ? "text-[12.5px]" : "text-[13.5px]", titleClass)}>
            {info.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-slate-500">
            <span className="truncate">{info.subtitle}</span>
            {info.durationClock && info.status === "completed" && (
              <span className="shrink-0 rounded bg-slate-900/5 px-1.5 py-0.2 font-mono text-[10.5px] font-semibold text-slate-600 tabular-nums">
                {info.durationClock}
              </span>
            )}
          </div>
          {timeLabel && (
            <div className="mt-1 text-[10px] font-medium text-slate-400 tabular-nums">
              {timeLabel}
            </div>
          )}
        </div>
      </div>

      {/* Nút hành động "Gọi lại" chuẩn giao diện Zalo */}
      {showCallbackBtn && (
        <div className={cn("border-t", dividerClass)}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCallback?.(isVideo ? "video" : "voice");
            }}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 font-semibold transition cursor-pointer active:scale-[0.99]",
              compact ? "py-1.5 text-[11.5px]" : "py-2 text-[12.5px]",
              isMissedIncoming
                ? "text-rose-600 hover:bg-rose-50/80"
                : "text-[#0068FF] hover:bg-blue-50/70",
            )}
            aria-label={isVideo ? "Gọi video lại" : "Gọi thoại lại"}
          >
            {isVideo ? <Video className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
            <span>{isVideo ? "Gọi video lại" : "Gọi lại"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
