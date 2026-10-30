"use client";

/**
 * Picker "Chuyển tiếp" tin nhắn — bấm nút Forward trên 1 bong bóng chat rồi
 * chọn 1/nhiều hội thoại đích để gửi lại NGUYÊN nội dung/đính kèm tin đó.
 *
 * CỐ Ý tách khỏi ZaloChatPanel.tsx (đã rất dài) và KHÔNG liên quan gì tới
 * zalo-forward-module (rule tự động nhóm→nhóm chạy nền) — đây là thao tác
 * thủ công 1 lần, do nhân viên chủ động chọn ngay lúc đang xem tin nhắn.
 */

import { useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { ZaloConversation } from "@/lib/zaloApiClient";

const MAX_TARGETS = 20;

export function ForwardMessageModal({
  conversations,
  excludeConversationId,
  preview,
  sending,
  onCancel,
  onConfirm,
}: {
  conversations: ZaloConversation[];
  /** Hội thoại đang mở (nơi tin gốc nằm) — vẫn cho chọn lại (gửi lại vào
   *  chính hội thoại đó là hợp lệ), chỉ dùng để KHÔNG tự tick sẵn. */
  excludeConversationId?: string | null;
  /** Preview ngắn của tin sắp chuyển tiếp, hiện ở đầu modal cho dễ xác nhận. */
  preview: string;
  sending: boolean;
  onCancel: () => void;
  onConfirm: (targets: Array<{ thread_id: string; thread_type: "user" | "group"; conversation_id: string }>) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? conversations.filter((c) => c.conversation_name?.toLowerCase().includes(q)) : conversations;
    return list.slice(0, 200);
  }, [conversations, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_TARGETS) next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const targets = conversations
      .filter((c) => selected.has(c.conversation_id))
      .map((c) => ({ thread_id: c.thread_id, thread_type: c.thread_type, conversation_id: c.conversation_id }));
    if (targets.length === 0) return;
    onConfirm(targets);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#eef1f5] px-4 py-3">
          <div className="text-sm font-semibold text-[#0a1a2b]">Chuyển tiếp tin nhắn</div>
          <button type="button" onClick={onCancel} className="text-[#8a9aa8] hover:text-[#0a1a2b]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-[#eef1f5] px-4 py-2 text-xs text-[#6b7a8d]">
          <span className="line-clamp-2">{preview}</span>
        </div>
        <div className="border-b border-[#eef1f5] p-3">
          <div className="flex items-center gap-2 rounded-full bg-[#f1f4f8] px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-[#8a9aa8]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm hội thoại..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-[#8a9aa8]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#8a9aa8]">Không tìm thấy hội thoại nào.</div>
          ) : (
            filtered.map((c) => {
              const checked = selected.has(c.conversation_id);
              return (
                <label
                  key={c.conversation_id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-[#f8fafc]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.conversation_id)}
                    className="h-4 w-4 rounded border-[#dce1e8] text-[#0068ff]"
                  />
                  <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#dce1e8] text-xs font-bold text-[#2f3e50]">
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      c.conversation_name?.[0]?.toUpperCase() || "?"
                    )}
                  </div>
                  <div className="min-w-0 flex-1 truncate text-sm text-[#0a1a2b]">
                    {c.conversation_name || (c.conversation_id === excludeConversationId ? "Hội thoại hiện tại" : c.conversation_id)}
                  </div>
                </label>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#eef1f5] px-4 py-3">
          <span className="text-xs text-[#8a9aa8]">{selected.size > 0 ? `Đã chọn ${selected.size} hội thoại` : `Tối đa ${MAX_TARGETS} hội thoại`}</span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected.size === 0 || sending}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0068ff] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0055d4] disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Gửi
          </button>
        </div>
      </div>
    </div>
  );
}
