"use client";

import { useCallback, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { searchZaloConversationMessages } from "@/services/zaloCrawlerService";
import type { ZaloLibraryMessage } from "@/types/zalo-api";

function formatSearchTime(value?: string | null): string {
  if (!value) return "";
  const num = Number(value);
  const ms = !Number.isNaN(num) && /^\d+$/.test(String(value)) ? (num < 1e11 ? num * 1000 : num) : Date.parse(value);
  if (!ms || Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function highlightKeyword(text: string, kw: string) {
  const trimmed = kw.trim();
  if (!trimmed) return text;
  const idx = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-200 px-0.5 text-inherit">{text.slice(idx, idx + trimmed.length)}</mark>
      {text.slice(idx + trimmed.length)}
    </>
  );
}

/** Panel tìm tin nhắn cũ TRONG 1 hội thoại cụ thể (1 người/1 nhóm) — vd tìm
 * "Leo" trong nhóm KẾ TOÁN - VẬN HÀNH DENFOOD. Dùng chung cho ZaloChatView +
 * ZaloInboxAdminShell. `onJumpToMessage` là best-effort: nếu tin đang nằm
 * trong danh sách đã tải (data-msg-anchor khớp), cuộn tới + highlight; nếu
 * không (tin quá cũ, ngoài phạm vi đã tải), báo cho user biết tại sao. */
export function ZaloMessageSearchPanel({
  accountId,
  conversationId,
  onClose,
  onJumpToMessage,
}: {
  accountId: string;
  conversationId: string;
  onClose: () => void;
  onJumpToMessage?: (message: ZaloLibraryMessage) => boolean;
}) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<ZaloLibraryMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [jumpNotFoundId, setJumpNotFoundId] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    const trimmed = keyword.trim();
    if (!trimmed || !accountId || !conversationId) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    setJumpNotFoundId(null);
    try {
      const res = await searchZaloConversationMessages(accountId, conversationId, trimmed);
      setResults(res.messages || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tìm tin nhắn.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [accountId, conversationId, keyword]);

  return (
    <div
      className="z-30 flex max-h-[45vh] flex-col border-b border-outline-variant bg-surface shadow-md"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-outline-variant px-3 py-2">
        <MaterialIcon name="search" className="text-[16px] text-on-surface-variant" />
        <input
          autoFocus
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Tìm tin nhắn cũ trong hội thoại này..."
          className="flex-1 bg-transparent text-[13px] outline-none"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={loading || !keyword.trim()}
          className="shrink-0 rounded-lg bg-brand px-3 py-1 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Tìm
        </button>
        <button type="button" onClick={onClose} title="Đóng" className="shrink-0 text-on-surface-variant hover:text-on-surface">
          <MaterialIcon name="close" className="text-[16px]" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-4 text-center text-[12px] text-on-surface-variant">Đang tìm...</p>
        ) : error ? (
          <p className="p-4 text-center text-[12px] text-red-600">{error}</p>
        ) : results.length > 0 ? (
          <ul className="divide-y divide-outline-variant">
            {results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    const found = onJumpToMessage?.(m);
                    if (found) onClose();
                    else setJumpNotFoundId(m.id);
                  }}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-surface-container-low"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-on-surface">
                      {m.sender_name || (m.is_sent ? "Bạn" : "Khách")}
                    </span>
                    <span className="shrink-0 text-[10px] text-on-surface-variant">
                      {formatSearchTime(m.timestamp_text || m.time_text)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[12px] text-on-surface-variant">
                    {m.content ? highlightKeyword(m.content, keyword) : <em>[tin không có nội dung văn bản]</em>}
                  </p>
                  {jumpNotFoundId === m.id && (
                    <p className="text-[10px] italic text-orange-600">
                      Tin nhắn này ngoài phạm vi đã tải — bấm &quot;Tải thêm tin cũ&quot; ở khung chat rồi thử lại.
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : searched ? (
          <p className="p-4 text-center text-[12px] text-on-surface-variant">Không tìm thấy tin nhắn phù hợp.</p>
        ) : (
          <p className="p-4 text-center text-[12px] text-on-surface-variant">
            Nhập từ khoá rồi Enter để tìm trong hội thoại này.
          </p>
        )}
      </div>
    </div>
  );
}
