"use client";

import { ScrollText, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ZaloBotConfigBrief } from "@/lib/zaloBotClient";

export type ZaloBotMode = "off" | "dry_run" | "live";

export function zaloBotModeOf(cfg: ZaloBotConfigBrief | null | undefined): ZaloBotMode {
  if (!cfg || !cfg.is_enabled) return "off";
  return cfg.dry_run ? "dry_run" : "live";
}

const MODE_LABEL: Record<ZaloBotMode, string> = {
  off: "Tắt",
  dry_run: "Chạy thử",
  live: "Đang chạy",
};

const MODE_CLASS: Record<ZaloBotMode, string> = {
  off: "border-border bg-muted text-muted-foreground",
  dry_run: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  live: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
};

/** Chip nhỏ hiển thị chế độ bot (dùng ở cây tài khoản). */
export function ZaloBotModeBadge({ mode, className }: { mode: ZaloBotMode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[9px] font-bold leading-none",
        MODE_CLASS[mode],
        className,
      )}
      title={`Bot AI: ${MODE_LABEL[mode]}`}
    >
      🤖 {MODE_LABEL[mode]}
    </span>
  );
}

type Props = {
  mode: ZaloBotMode;
  disabled?: boolean;
  onOpenSettings: () => void;
  onOpenLogs: () => void;
};

/** Chip "Bot AI" + nút cài đặt + nút nhật ký, đặt cạnh tên tài khoản đang chọn. */
export default function ZaloBotChip({ mode, disabled, onOpenSettings, onOpenLogs }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onOpenSettings}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-xs font-bold transition disabled:opacity-50",
          MODE_CLASS[mode],
        )}
        title="Mở cài đặt Bot AI"
      >
        <span>🤖 Bot AI: {MODE_LABEL[mode]}</span>
      </button>
      {/* <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8 rounded-xl"
        disabled={disabled}
        onClick={onOpenSettings}
        title="Cài đặt Bot AI"
        aria-label="Cài đặt Bot AI"
      >
        <Settings2 />
      </Button> */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-xl px-2.5 text-xs"
        disabled={disabled}
        onClick={onOpenLogs}
        title="Xem nhật ký Bot AI"
      >
        <ScrollText />
        <span className="hidden lg:inline">Nhật ký bot</span>
      </Button>
    </div>
  );
}
