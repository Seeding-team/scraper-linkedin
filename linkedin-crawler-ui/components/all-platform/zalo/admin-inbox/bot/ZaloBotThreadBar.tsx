"use client";

import { Bot, BotOff, Loader2, Pause, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ZaloBotThreadStatus } from "@/lib/zaloBotClient";

type Props = {
  status: ZaloBotThreadStatus | null;
  busy: boolean;
  error: string | null;
  onTakeover: () => void;
  onResume: () => void;
  /** Bật (true) / tắt (false) / về mặc định phạm vi (null) bot cho riêng người này. */
  onSetRule: (botOn: boolean | null) => void;
};

function formatUntil(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `đến ${hhmm}` : `đến ${hhmm} ${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })}`;
}

function pausedDetail(status: ZaloBotThreadStatus): string {
  const parts: string[] = [];
  const until = formatUntil(status.paused_until);
  parts.push(until || "đến khi bật lại bot");
  if (status.reason === "staff_reply") parts.push("tự động vì bạn vừa nhắn");
  else if (status.reason === "manual") parts.push("tiếp quản thủ công");
  return parts.join(" • ");
}

/** Thanh trạng thái bot trong khung chat 1-1. state = off (bot chưa bật cho tài khoản) thì không hiện. */
export default function ZaloBotThreadBar({ status, busy, error, onTakeover, onResume, onSetRule }: Props) {
  if (!status || !status.bot_applicable || status.state === "off") return null;

  const { state } = status;
  const selectedMode = status.scope_mode === "selected";

  // Bật bot cho người này: chế độ "chỉ người đã chọn" => đặt rule bật; chế độ "tất cả" => bỏ rule tắt.
  const enableForThread = () => onSetRule(selectedMode ? true : null);
  // Tắt bot cho người này: chế độ "tất cả" => đặt rule tắt; chế độ "chỉ người đã chọn" => bỏ rule bật.
  const disableForThread = () => onSetRule(selectedMode ? null : false);

  if (state === "out_of_scope") {
    return (
      <div
        className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-1.5 text-xs text-muted-foreground"
        role="status"
      >
        <BotOff className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">
            {selectedMode ? "Bot không trả lời người này (chưa được bật)" : "Bot đã tắt cho người này"}
          </span>
          {error && <span className="ml-2 font-medium text-red-600 dark:text-red-400">{error}</span>}
        </div>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={busy} onClick={enableForThread}>
          {busy && <Loader2 className="animate-spin" />}
          Bật bot cho người này
        </Button>
      </div>
    );
  }

  const tone =
    state === "active"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      : state === "paused"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200";

  const Icon = state === "active" ? Bot : state === "paused" ? Pause : UserRound;
  const title =
    state === "active"
      ? status.dry_run
        ? "Bot đang trả lời (chạy thử, chưa gửi thật)"
        : "Bot đang trả lời"
      : state === "paused"
        ? "Nhân viên đang tiếp quản"
        : "Bot đã chuyển cho nhân viên";
  const detail = state === "paused" ? pausedDetail(status) : null;

  return (
    <div className={cn("flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs", tone)} role="status">
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{title}</span>
        {detail && <span className="ml-1.5 opacity-80">({detail})</span>}
        {error && <span className="ml-2 font-medium text-red-600 dark:text-red-400">{error}</span>}
      </div>
      {state === "active" ? (
        <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={busy} onClick={onTakeover}>
          {busy && <Loader2 className="animate-spin" />}
          Tiếp quản
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" disabled={busy} onClick={onResume}>
          {busy && <Loader2 className="animate-spin" />}
          Bật lại bot
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs opacity-80 hover:opacity-100"
        disabled={busy}
        onClick={disableForThread}
        title="Bot sẽ không tự trả lời người này nữa (có thể bật lại bất cứ lúc nào)"
      >
        <BotOff />
        Tắt bot cho người này
      </Button>
    </div>
  );
}

/** Huy hiệu nhỏ trên bubble tin do bot gửi. */
export function ZaloBotMessageBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full bg-violet-100 px-1.5 py-px text-[9px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300"
      title="Tin do Bot AI trả lời"
    >
      🤖 Bot
    </span>
  );
}
