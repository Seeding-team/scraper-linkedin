"use client";

import { useCallback, useState } from "react";
import { searchZaloStickers } from "@/services/zaloCrawlerService";
import type { ZaloStickerDetail } from "@/types/zalo-api";

const QUICK_KEYWORDS = ["haha", "yêu", "buồn", "ok", "chúc mừng", "khóc", "tim", "cảm ơn"];

/** Picker sticker đầy đủ: tìm theo từ khoá thật (giống thanh tìm sticker
 * trong app Zalo, qua zca-js searchSticker) + hiện thumbnail ảnh thật, thay
 * cho UI cũ phải tự biết trước sticker id. Dùng chung cho ZaloChatView +
 * ZaloInboxAdminShell. */
export function ZaloStickerPicker({
  accountId,
  onPick,
}: {
  accountId: string;
  onPick: (sticker: ZaloStickerDetail) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<ZaloStickerDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(
    async (kw: string) => {
      const trimmed = kw.trim();
      if (!trimmed || !accountId) return;
      setLoading(true);
      setError(null);
      setSearched(true);
      try {
        const res = await searchZaloStickers(accountId, trimmed);
        setResults(res.stickers || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không thể tìm sticker.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [accountId],
  );

  return (
    <div className="w-72 rounded-lg border border-outline-variant bg-surface p-2.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1.5">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch(keyword);
          }}
          placeholder="Tìm sticker (vd: haha, yêu, buồn...)"
          className="h-8 flex-1 rounded border border-outline-variant px-2 text-[12px] outline-none focus:border-primary"
          autoFocus
        />
        <button
          type="button"
          onClick={() => void runSearch(keyword)}
          disabled={loading}
          className="h-8 shrink-0 rounded bg-surface-container-low px-2.5 text-[12px] font-semibold hover:bg-surface-container disabled:opacity-50"
        >
          Tìm
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {QUICK_KEYWORDS.map((kw) => (
          <button
            key={kw}
            type="button"
            onClick={() => {
              setKeyword(kw);
              void runSearch(kw);
            }}
            className="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] text-on-surface-variant hover:bg-surface-container"
          >
            {kw}
          </button>
        ))}
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto">
        {loading ? (
          <p className="py-4 text-center text-[11px] text-on-surface-variant">Đang tìm...</p>
        ) : error ? (
          <p className="py-4 text-center text-[11px] text-red-600">{error}</p>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-4 gap-1.5">
            {results.map((s) => {
              const url = s.stickerWebpUrl || s.stickerUrl;
              if (!url) return null;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick(s)}
                  className="rounded border border-outline-variant p-0.5 transition hover:border-primary hover:bg-brand-subtle"
                  title={s.text || `Sticker #${s.id}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={s.text || "sticker"} className="h-12 w-12 object-contain" loading="lazy" />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-center text-[11px] text-on-surface-variant">
            {searched ? "Không tìm thấy sticker phù hợp." : "Nhập từ khoá hoặc bấm gợi ý rồi Tìm."}
          </p>
        )}
      </div>
    </div>
  );
}
