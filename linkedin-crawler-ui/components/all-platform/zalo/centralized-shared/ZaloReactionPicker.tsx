"use client";

import { ZALO_QUICK_REACTIONS } from "@/services/zaloCrawlerService";

/** Popup 6 icon cảm xúc nhanh — hiện khi hover/bấm vào 1 tin nhắn (bấm giữ
 * trên app Zalo thật). Dùng chung cho ZaloChatView + ZaloInboxAdminShell. */
export function ZaloReactionQuickPicker({
  onPick,
  activeIcon,
}: {
  onPick: (icon: string) => void;
  activeIcon?: string | null;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-outline-variant bg-surface px-1.5 py-1 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {ZALO_QUICK_REACTIONS.map((r) => (
        <button
          key={r.name}
          type="button"
          onClick={() => onPick(r.name)}
          className={`grid h-7 w-7 place-items-center rounded-full text-base transition-transform hover:scale-125 ${
            activeIcon === r.name ? "bg-brand-subtle" : ""
          }`}
          title={r.name}
        >
          {r.emoji}
        </button>
      ))}
    </div>
  );
}

/** Chip hiện bên dưới bubble, tổng hợp theo icon (giống Zalo: "❤️ 2 👍 1").
 * Bấm vào 1 chip = react luôn icon đó (đổi/bỏ nếu đang là icon của mình). */
export function ZaloReactionBadges({
  reactions,
  myUid,
  onClickIcon,
}: {
  reactions?: Record<string, string> | null;
  myUid?: string | null;
  onClickIcon?: (icon: string) => void;
}) {
  const entries = Object.entries(reactions || {});
  if (entries.length === 0) return null;

  const counts = new Map<string, number>();
  for (const [, icon] of entries) counts.set(icon, (counts.get(icon) || 0) + 1);
  const mine = myUid ? reactions?.[myUid] : null;

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      {Array.from(counts.entries()).map(([icon, count]) => {
        const emoji = ZALO_QUICK_REACTIONS.find((r) => r.name === icon)?.emoji || "•";
        const isMine = mine === icon;
        return (
          <button
            key={icon}
            type="button"
            onClick={() => onClickIcon?.(icon)}
            className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] shadow-sm transition ${
              isMine
                ? "border-brand bg-brand-subtle"
                : "border-outline-variant bg-surface hover:bg-surface-container-low"
            }`}
            title={icon}
          >
            <span>{emoji}</span>
            {count > 1 && <span className="font-semibold text-on-surface-variant">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
