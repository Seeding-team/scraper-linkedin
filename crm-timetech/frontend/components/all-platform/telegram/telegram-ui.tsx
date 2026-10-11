import { cn } from "@/lib/utils";
import type { TelegramDialogType } from "@/types/telegram-api";

const AVATAR_PALETTE = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
];

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarColorClass(name: string | null | undefined): string {
  return AVATAR_PALETTE[hashString(name || "?") % AVATAR_PALETTE.length];
}

export const DIALOG_TYPE_ICON: Record<TelegramDialogType, string> = {
  user: "person",
  group: "group",
  channel: "campaign",
  bot: "smart_toy",
};

export const DIALOG_TYPE_LABEL: Record<TelegramDialogType, string> = {
  user: "Người dùng",
  group: "Nhóm",
  channel: "Kênh",
  bot: "Bot",
};

export function Avatar({
  name,
  type,
  size = 40,
  className,
}: {
  name: string | null | undefined;
  type?: TelegramDialogType;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <div
        className={cn("w-full h-full rounded-full flex items-center justify-center text-white font-bold", avatarColorClass(name))}
        style={{ fontSize: Math.max(10, size * 0.36) }}
      >
        {initialsOf(name)}
      </div>
      {type && type !== "user" ? (
        <div
          className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card border border-border flex items-center justify-center"
          style={{ width: size * 0.46, height: size * 0.46 }}
        >
          <span className="material-symbols-outlined text-foreground" style={{ fontSize: size * 0.3 }}>
            {DIALOG_TYPE_ICON[type]}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Hôm qua";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}
