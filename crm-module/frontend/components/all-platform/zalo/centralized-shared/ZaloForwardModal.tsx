"use client";

import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { forwardZaloMessage, type ZaloForwardMessageResult } from "@/services/zaloCrawlerService";
import type { ZaloConversationSummary, ZaloLibraryMessage } from "@/types/zalo-api";

const MAX_TARGETS = 20;

interface ZaloForwardModalProps {
  open: boolean;
  accountId: string;
  sourceConversationId: string;
  message: ZaloLibraryMessage | null;
  conversations: ZaloConversationSummary[];
  onClose: () => void;
}

/** Modal "Chuyển tiếp tin nhắn" — chọn nhiều hội thoại đích từ danh sách đã có
 * sẵn trong state (không gọi API mới để lấy list), gọi POST .../forward 1 lần
 * duy nhất với tất cả target đã chọn. BE trả kết quả THÀNH CÔNG/THẤT BẠI riêng
 * cho từng đích (có thể partial-success) nên hiện danh sách kết quả, không
 * phải 1 toast chung chung. Dùng chung được cho cả ZaloChatView lẫn
 * ZaloInboxAdminShell — chỉ cần truyền đúng props. */
export function ZaloForwardModal({
  open,
  accountId,
  sourceConversationId,
  message,
  conversations,
  onClose,
}: ZaloForwardModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<ZaloForwardMessageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(new Set());
      setSending(false);
      setResults(null);
      setError(null);
    }
  }, [open]);

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => c.conversation_id !== sourceConversationId)
      .filter((c) => !q || (c.conversation_name || "").toLowerCase().includes(q));
  }, [conversations, query, sourceConversationId]);

  if (!open || !message) return null;

  const sourceId = message.source_message_id;
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_TARGETS) {
        next.add(id);
      }
      return next;
    });
  };

  const handleForward = async () => {
    if (!sourceId || selected.size === 0 || sending) return;
    setSending(true);
    setError(null);
    setResults(null);
    try {
      const res = await forwardZaloMessage(accountId, sourceConversationId, {
        source_message_id: sourceId,
        target_conversation_ids: Array.from(selected),
      });
      setResults(res.results || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể chuyển tiếp tin nhắn.");
    } finally {
      setSending(false);
    }
  };

  const nameOf = (id: string) =>
    conversations.find((c) => c.conversation_id === id)?.conversation_name || id;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[1px] px-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface rounded-xl w-full max-w-[420px] max-h-[80vh] flex flex-col shadow-2xl border border-outline-variant"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-outline-variant shrink-0">
          <h2 className="text-[15px] font-semibold text-on-surface flex items-center gap-2">
            <MaterialIcon name="forward" className="text-primary text-base" />
            Chuyển tiếp tin nhắn
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-container-low rounded-lg transition shrink-0" aria-label="Đóng">
            <MaterialIcon name="close" className="text-base text-on-surface-variant" />
          </button>
        </div>

        {!sourceId ? (
          <div className="px-5 py-4 text-[12.5px] text-red-700">
            Tin nhắn này chưa có ID hợp lệ, không thể chuyển tiếp.
          </div>
        ) : !results ? (
          <>
            <div className="px-5 pt-3 pb-1 shrink-0">
              <div className="text-[11px] text-on-surface-variant mb-2 rounded-lg bg-surface-container-low px-2.5 py-1.5 line-clamp-2">
                {message.content || (message.assets?.length ? "📷 Ảnh đính kèm" : "Tin nhắn")}
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm hội thoại đích..."
                className="w-full px-3 py-2 text-[13px] border border-outline-variant bg-surface rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-[10.5px] text-on-surface-variant mt-1">
                Đã chọn {selected.size}/{MAX_TARGETS}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2 space-y-1 min-h-[120px]">
              {targets.length === 0 ? (
                <p className="text-[12px] text-on-surface-variant text-center py-6">Không tìm thấy hội thoại phù hợp.</p>
              ) : (
                targets.map((c) => (
                  <label
                    key={c.conversation_id}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-container-low cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.conversation_id)}
                      onChange={() => toggle(c.conversation_id)}
                      className="w-3.5 h-3.5 cursor-pointer shrink-0"
                    />
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-300 flex items-center justify-center text-white text-[12px] font-semibold shrink-0">
                        {(c.conversation_name || "?")[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-[12.5px] text-on-surface truncate">{c.conversation_name}</span>
                  </label>
                ))
              )}
            </div>
            {error && (
              <div className="mx-5 mb-2 text-[11.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg p-2.5 shrink-0">
                {error}
              </div>
            )}
            <div className="px-5 py-3 border-t border-outline-variant shrink-0 flex justify-end gap-2">
              <button onClick={onClose} className="px-3.5 py-2 text-[12px] font-medium rounded-lg border border-outline-variant hover:bg-surface-container-low transition">
                Huỷ
              </button>
              <button
                onClick={() => void handleForward()}
                disabled={selected.size === 0 || sending}
                className="px-3.5 py-2 bg-primary text-white text-[12px] font-medium rounded-lg hover:opacity-90 disabled:opacity-40 transition flex items-center gap-1.5"
              >
                {sending ? (
                  <>
                    <MaterialIcon name="sync" className="text-[14px] animate-spin" />
                    Đang gửi
                  </>
                ) : (
                  `Chuyển tiếp (${selected.size})`
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="px-5 py-4 space-y-1.5 overflow-y-auto">
            {results.map((r) => (
              <div key={r.conversation_id} className="flex items-center gap-2 text-[12.5px]">
                <MaterialIcon
                  name={r.ok ? "check_circle" : "cancel"}
                  className={`text-[16px] shrink-0 ${r.ok ? "text-emerald-600" : "text-red-600"}`}
                />
                <span className="truncate flex-1">{nameOf(r.conversation_id)}</span>
                {!r.ok && r.error && <span className="text-[10.5px] text-red-600 truncate max-w-[140px]">{r.error}</span>}
              </div>
            ))}
            <div className="pt-3 flex justify-end">
              <button onClick={onClose} className="px-3.5 py-2 bg-primary text-white text-[12px] font-medium rounded-lg hover:opacity-90 transition">
                Xong
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
