"use client";

/**
 * Render đính kèm của 1 tin nhắn Zalo theo ĐÚNG LOẠI — uỷ thác toàn bộ sang bộ
 * thẻ hợp nhất `ZaloRichMessageCard.tsx` (Phase 2A) để giữ đồng bộ 100% trải
 * nghiệm trên mọi bề mặt chat Zalo, đồng thời giữ nguyên 100% tương thích ngược
 * cho các props cũ của `MessageAttachments`.
 */

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  kindLabel,
  type ZaloAttachment,
  type ZaloMessageKind,
  type ZaloSystemEventCategory,
  type ZaloSystemEventMeta,
} from "@/lib/zaloMessageContent";
import type { ZaloCallMessageInfo } from "@/lib/zaloCallMessage";
import { ZaloCallMessageCard } from "../centralized-shared/ZaloCallMessageCard";
import {
  ZaloBankAccountChip,
  ZaloBankCard,
  ZaloContactCard,
  ZaloFileCard,
  ZaloImageGrid,
  ZaloInlineSmartText,
  ZaloLinkCard,
  ZaloLocationCard,
  ZaloRichMessageContent,
  ZaloStickerCard,
  ZaloSystemEventBanner,
  ZaloVideoCard,
  ZaloVoiceCard,
  buildDownloadProxyUrl,
  isBareZaloRichMessage,
  isCenteredZaloSystemMessage,
} from "../centralized-shared/ZaloRichMessageCard";

export interface MessageAttachmentsProps {
  attachments: ZaloAttachment[];
  kind?: ZaloMessageKind;
  /** Bong bóng của mình — truyền xuống `isOwn` của các thẻ rich card. */
  mine?: boolean;
  /** Phiên bản gọn cho panel hẹp (Omnichannel / widget). */
  compact?: boolean;
  /** Bấm nút "Nhắn tin" trên danh thiếp có SĐT. */
  onContactMessage?: (a: ZaloAttachment) => void;
  /** Bấm nút "Xem hồ sơ" trên danh thiếp (tuỳ chọn). */
  onOpenProfile?: (a: ZaloAttachment) => void;
  /** Khi bấm nút "Gọi lại" trên thẻ cuộc gọi (tuỳ chọn). */
  onCallBack?: (mode: "voice" | "video") => void;
  /** Metadata sự kiện hệ thống nếu đã có sẵn. */
  systemEvent?: ZaloSystemEventMeta;
  /** Nhãn cụ thể hơn cho tin `kind === "unknown"` (tự động lọc bỏ "— mở Zalo để xem"). */
  unknownLabel?: string | null;
  /** Gọi khi ảnh/video load xong kích thước thật để khung chat tự cuộn đáy. */
  onMediaLoad?: () => void;
  /** Bấm vào 1 ảnh hoặc mã VietQR — tương thích cả `() => void` lẫn `(url: string) => void`. */
  onOpenGallery?: (url: string) => void;
}

function cleanFallbackLabel(raw?: string | null): string {
  if (!raw) return "";
  return raw.replace(/\s*—\s*mở\s*zalo\s*để\s*xem\s*/gi, "").trim();
}

export function MessageAttachments({
  attachments,
  kind,
  mine = false,
  compact = false,
  onContactMessage,
  onOpenProfile,
  onCallBack,
  systemEvent,
  unknownLabel,
  onMediaLoad,
  onOpenGallery,
}: MessageAttachmentsProps) {
  const safeUnknownLabel = cleanFallbackLabel(unknownLabel);

  // Không có đính kèm nào nhưng loại tin KHÔNG phải text → hiển thị thẻ/nhãn Zalo native sạch
  if (!attachments || attachments.length === 0) {
    if (!kind || kind === "text") return null;

    if (
      kind === "bankcard" ||
      (safeUnknownLabel && /tài khoản ngân hàng|thẻ ngân hàng|bank account/i.test(safeUnknownLabel))
    ) {
      return <ZaloBankCard isOwn={mine} compact={compact} onOpenImage={onOpenGallery} />;
    }

    if (kind === "file" || kind === "folder") {
      return <ZaloFileCard isFolder={kind === "folder"} expired isOwn={mine} compact={compact} />;
    }

    if (kind === "sticker") {
      return <ZaloStickerCard attachment={{ kind: "sticker" }} compact={compact} />;
    }

    if (
      kind === "undo" ||
      kind === "system_notice" ||
      kind === "ecard" ||
      kind === "poll" ||
      kind === "reminder" ||
      kind === "todo"
    ) {
      const cat: ZaloSystemEventCategory = kind === "system_notice" ? "info" : kind;
      return (
        <ZaloSystemEventBanner
          event={systemEvent}
          title={systemEvent?.title || safeUnknownLabel || kindLabel(kind)}
          category={systemEvent?.category || cat}
          iconKind={systemEvent?.iconKind}
          compact={compact}
        />
      );
    }

    const label = safeUnknownLabel || kindLabel(kind) || "[Tin nhắn]";
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[12px] font-medium",
          mine
            ? "border-white/25 bg-white/15 text-white/90"
            : "border-slate-200/80 bg-slate-50 text-slate-600",
        )}
      >
        <Info className="h-3.5 w-3.5 shrink-0 opacity-75" />
        <span>{label}</span>
      </div>
    );
  }

  // Ảnh / GIF / Vẽ hình gộp thành lưới album Zalo; các thẻ khác xếp dọc từng thẻ.
  const images = attachments.filter(
    (a) => a.kind === "image" || a.kind === "gif" || a.kind === "doodle",
  );
  const others = attachments.filter(
    (a) => a.kind !== "image" && a.kind !== "gif" && a.kind !== "doodle",
  );

  return (
    <div className="flex flex-col gap-1.5">
      {images.length > 0 ? (
        <ZaloImageGrid
          items={images}
          compact={compact}
          onLoad={onMediaLoad}
          onOpenImage={onOpenGallery}
        />
      ) : null}

      {others.map((a, i) => {
        const key = `${a.kind}-${a.url || a.data_url || a.sticker_id || a.phone || a.name || i}`;
        switch (a.kind) {
          case "video":
            return <ZaloVideoCard key={key} attachment={a} compact={compact} onLoad={onMediaLoad} />;
          case "voice":
            return <ZaloVoiceCard key={key} attachment={a} compact={compact} />;
          case "file":
          case "folder":
            return <ZaloFileCard key={key} attachment={a} isOwn={mine} compact={compact} />;
          case "link":
            return <ZaloLinkCard key={key} attachment={a} isOwn={mine} compact={compact} />;
          case "sticker":
            return <ZaloStickerCard key={key} attachment={a} compact={compact} onLoad={onMediaLoad} />;
          case "location":
            return <ZaloLocationCard key={key} attachment={a} isOwn={mine} compact={compact} />;
          case "contact":
            return (
              <ZaloContactCard
                key={key}
                attachment={a}
                isOwn={mine}
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
                isOwn={mine}
                compact={compact}
                onOpenImage={onOpenGallery}
              />
            );
          case "call": {
            const info: ZaloCallMessageInfo = a.call_info || {
              direction: mine ? "outgoing" : "incoming",
              mediaType: "audio",
              status: "completed",
              title: a.title || (mine ? "Cuộc gọi thoại đi" : "Cuộc gọi thoại đến"),
              subtitle: a.description || "Cuộc gọi Zalo",
              previewLabel: a.title || "Cuộc gọi",
              durationSec: a.duration_ms ? Math.round(a.duration_ms / 1000) : 0,
              durationClock: a.duration_ms ? formatDuration(a.duration_ms) : "",
              durationHuman: a.duration_ms ? formatDuration(a.duration_ms) : "",
              enableCallback: false,
              isMissed: false,
            };
            return (
              <ZaloCallMessageCard
                key={key}
                info={info}
                isSent={Boolean(mine)}
                compact={compact}
                onCallback={onCallBack}
              />
            );
          }
          case "ecard":
          case "poll":
          case "reminder":
          case "todo":
            return (
              <ZaloSystemEventBanner
                key={key}
                event={systemEvent}
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
    </div>
  );
}

// Re-export bộ thẻ mới để các consumer cũ hoặc mới đều có thể import thuận tiện
export {
  ZaloBankAccountChip,
  ZaloBankCard,
  ZaloContactCard,
  ZaloFileCard,
  ZaloImageGrid,
  ZaloInlineSmartText,
  ZaloLinkCard,
  ZaloLocationCard,
  ZaloRichMessageContent,
  ZaloStickerCard,
  ZaloSystemEventBanner,
  ZaloVideoCard,
  ZaloVoiceCard,
  buildDownloadProxyUrl,
  isBareZaloRichMessage,
  isCenteredZaloSystemMessage,
};
