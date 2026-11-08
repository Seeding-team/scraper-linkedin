"use client";

/**
 * Avatar dùng chung cho danh sách hội thoại + header khung chat — hiển thị ảnh
 * thật (`avatar_url`) khi có, fallback về vòng tròn màu + initials khi thiếu URL
 * hoặc ảnh load lỗi. Port từ zalo-account-module/src/components/chat/Avatar.tsx
 * (InvoiceFlowManager) — giữ nguyên logic hash màu, chỉ đổi bảng màu fallback
 * sang các sắc pastel hài hoà với tông thương hiệu app này.
 */

import { useEffect, useState } from "react";

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  /** Class kích thước + cỡ chữ, vd "h-12 w-12 text-base". */
  className: string;
}

const AVATAR_COLORS = [
  "#fbe7ec",
  "#ffe4d6",
  "#e0f2fe",
  "#e5e7eb",
  "#fee2e2",
  "#dcfce7",
  "#fae8ff",
  "#ffedd5",
  "#e0e7ff",
  "#fbcfe8",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickColor(name: string): string {
  if (!name) return AVATAR_COLORS[3];
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

/** "Vận hành Sàn" -> "VS", "Trần Thu Thủy" -> "TT", "Zalo" -> "Z". */
function getInitials(name?: string | null): string {
  if (!name) return "?";
  const words = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]?.toUpperCase() || "?";
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function Avatar({ src, name, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || "avatar"}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full bg-slate-100 object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-[#7a3349] ${className}`}
      style={{ backgroundColor: pickColor(name || "") }}
    >
      {getInitials(name)}
    </div>
  );
}
