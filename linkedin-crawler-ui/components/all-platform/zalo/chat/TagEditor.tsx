"use client";

/**
 * Nhãn phân loại (vd "Khách VIP", "Đã mua", "Quan tâm sản phẩm A") gắn lên 1
 * hội thoại BẤT KỲ — cả 1-1 lẫn NHÓM (vd phân loại nhóm khách hàng/đối tác) —
 * dùng để lọc lại danh sách bạn bè khi gửi tin mời mua hàng hàng loạt (xem
 * bulk-send/page.tsx, hiện chỉ lọc trong phạm vi bạn bè 1-1 vì gửi hàng loạt
 * theo uid chỉ áp dụng cho người, không gửi được vào nhóm theo cách đó). Cột
 * `tags` (TEXT[]) ở bảng zalo_conversations_ui, ghi qua PUT
 * /api/zalo/conversations/:id/tags.
 *
 * 2 export dùng ở nơi khác nhau:
 *  - `TagPill`: hiện 1 nhãn dạng viên thuốc màu (dùng trong ZaloConversationList
 *    để hiện nhãn đã gắn dưới tên hội thoại, không cần sửa được).
 *  - `TagEditor`: nút + popover để THÊM/GỠ nhãn (dùng ở hàng hội thoại và
 *    header khung chat).
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Tag as TagIcon, X } from "lucide-react";

/** Bảng màu cố định, băm theo tên nhãn — cùng 1 nhãn luôn ra cùng 1 màu ở mọi
 *  nơi hiển thị, không cần lưu màu riêng trong DB. */
const TAG_COLORS = [
  { bg: "#e3edff", text: "#0068ff" },
  { bg: "#e7f7ec", text: "#1a9c46" },
  { bg: "#fff4e0", text: "#b06a00" },
  { bg: "#fde8ec", text: "#c2185b" },
  { bg: "#f1e9ff", text: "#6b3fd4" },
  { bg: "#e0f7fa", text: "#00838f" },
];

function colorForTag(tag: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

export function TagPill({ tag, onRemove, className = "" }: { tag: string; onRemove?: () => void; className?: string }) {
  const c = colorForTag(tag);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="truncate">{tag}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 hover:opacity-60"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </span>
  );
}

export function TagEditor({
  tags,
  allTags,
  onChange,
  align = "left",
}: {
  tags: string[];
  /** Toàn bộ nhãn account này đang dùng (gợi ý nhanh, tránh gõ lại/gõ lệch
   *  chính tả tạo ra 2 nhãn na ná nhau). */
  allTags: string[];
  onChange: (tags: string[]) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setInput("");
      return;
    }
    onChange([...tags, t]);
    setInput("");
  }
  function removeTag(t: string) {
    onChange(tags.filter((x) => x !== t));
  }

  const suggestions = allTags.filter(
    (t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()) && (!input.trim() || t.toLowerCase().includes(input.trim().toLowerCase()))
  );

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Gắn nhãn phân loại khách hàng"
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[#8a9aa8] transition hover:bg-[#eef1f5] hover:text-[#0068ff] ${open ? "bg-[#eef1f5] text-[#0068ff]" : ""}`}
      >
        <TagIcon className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className={`absolute top-7 z-30 w-64 rounded-xl border border-[#dce1e8] bg-white p-3 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tags.length === 0 ? (
              <span className="text-[11px] text-[#a0b0c0]">Chưa có nhãn nào</span>
            ) : (
              tags.map((t) => <TagPill key={t} tag={t} onRemove={() => removeTag(t)} />)
            )}
          </div>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(input);
              }
            }}
            placeholder="Thêm nhãn mới, Enter để lưu..."
            className="w-full rounded-lg border border-[#dce1e8] px-2.5 py-1.5 text-xs text-[#0a1a2b] outline-none focus:border-[#0068ff]"
          />
          {suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[#f1f4f8] pt-2">
              {suggestions.slice(0, 8).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTag(t)}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-[#dce1e8] px-2 py-0.5 text-[11px] text-[#6b7a8d] transition hover:border-[#0068ff] hover:text-[#0068ff]"
                >
                  <Plus className="h-2.5 w-2.5" /> {t}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
