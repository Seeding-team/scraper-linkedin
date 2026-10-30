"use client";

/**
 * Avatar dùng chung cho ZaloConversationList (hàng hội thoại) và ZaloChatPanel
 * (header hội thoại đang mở) — hiển thị ảnh thật (`avatar_url`) khi có, fallback
 * về vòng tròn màu + initials khi thiếu URL hoặc ảnh load lỗi.
 *
 * Bảng màu fallback lấy đúng theo thiết kế TimeTech Chat (timetich.html) —
 * mỗi hội thoại demo trong mockup có 1 màu nền pastel riêng (avatar không ảnh
 * đại diện). Ở đây không hard-code theo từng tên như mockup (dữ liệu thật thay
 * đổi liên tục) mà băm tên hội thoại để chọn 1 màu cố định trong đúng bảng màu
 * đó — cùng 1 hội thoại luôn ra cùng 1 màu giữa các lần render.
 *
 * `failed` là state cục bộ của từng instance component (mỗi hàng hội thoại tự
 * có 1 Avatar riêng, React key theo conversation_id) nên lỗi load ảnh của 1
 * hội thoại không ảnh hưởng tới các hội thoại khác. Reset khi `src` đổi để
 * header của ZaloChatPanel (1 instance dùng lại cho nhiều hội thoại được mở
 * lần lượt) không bị "kẹt" ở trạng thái lỗi của hội thoại trước đó.
 */

import { useEffect, useState } from "react";

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  /** Class kích thước + cỡ chữ, vd "h-12 w-12 text-base" — giữ đúng layout gốc. */
  className: string;
}

// Bảng màu nền avatar fallback — đúng 10 màu pastel dùng trong timetich.html
// (#d4e2ff, #ffd9b3, #b3d9ff, #d9d9d9, #ffb3b3, #b3ffb3, #ffccff, #ffb380,
// #b3ccff, #ffb3cc). Chữ initials dùng chung 1 màu tối #2f3e50 như mockup.
const AVATAR_COLORS = [
  "#d4e2ff",
  "#ffd9b3",
  "#b3d9ff",
  "#d9d9d9",
  "#ffb3b3",
  "#b3ffb3",
  "#ffccff",
  "#ffb380",
  "#b3ccff",
  "#ffb3cc"
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
  if (!name) return AVATAR_COLORS[3]; // #d9d9d9 — trung tính, giống avatar "Z" trong mockup
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

/** "Vận hành Sàn" -> "VS", "Trần Thu Thủy" -> "TT", "Zalo" -> "Z". */
function getInitials(name?: string | null): string {
  if (!name) return "?";
  const words = name
    .replace(/\(.*?\)/g, "") // bỏ phần trong ngoặc, vd "(chung)"
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
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-[#2f3e50] ${className}`}
      style={{ backgroundColor: pickColor(name || "") }}
    >
      {getInitials(name)}
    </div>
  );
}
