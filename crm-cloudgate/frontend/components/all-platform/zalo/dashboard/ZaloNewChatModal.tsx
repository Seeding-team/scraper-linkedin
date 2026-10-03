"use client";

import { useEffect, useRef, useState } from "react";

import { MaterialIcon } from "@/components/ui";
import {
  createZaloUserThread,
  findZaloUser,
  type ZaloFoundUser,
} from "@/services/zaloCrawlerService";

type SearchMode = "phone" | "username";

interface ZaloNewChatModalProps {
  open: boolean;
  accountId: string;
  onClose: () => void;
  onChatReady: (conversationId: string) => void;
  /** Thông báo toast/snackbar tuỳ chọn khi có lỗi */
  onError?: (message: string) => void;
  /** Thông báo thành công (tuỳ chọn) */
  onSuccess?: (displayName: string) => void;
}

const PHONE_EXAMPLES = ["0839108906", "+84939108906", "0084 939 108 906"];

export function ZaloNewChatModal({
  open,
  accountId,
  onClose,
  onChatReady,
  onError,
  onSuccess,
}: ZaloNewChatModalProps) {
  const [mode, setMode] = useState<SearchMode>("phone");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<ZaloFoundUser | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state khi modal đóng/mở
  useEffect(() => {
    if (open) {
      setQuery("");
      setFound(null);
      setError(null);
      setSearching(false);
      setCreating(false);
      // Focus input khi mở
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Đóng modal bằng ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length >= (mode === "phone" ? 8 : 2);

  const handleSearch = async () => {
    if (!canSearch || searching) return;
    setError(null);
    setFound(null);
    setSearching(true);
    try {
      const result = await findZaloUser(accountId, trimmedQuery, mode);
      setFound(result);
    } catch (e) {
      const msg = extractErrorMessage(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setSearching(false);
    }
  };

  const handleStartChat = async () => {
    if (!found || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createZaloUserThread(accountId, {
        user_id: found.user_id,
        display_name: found.display_name,
        avatar_url: found.avatar_url ?? null,
      });
      onSuccess?.(res.display_name);
      onChatReady(res.conversation_id);
      onClose();
    } catch (e) {
      const msg = extractErrorMessage(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setCreating(false);
    }
  };

  const switchMode = (next: SearchMode) => {
    if (next === mode) return;
    setMode(next);
    setQuery("");
    setFound(null);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[1px] px-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="zalo-new-chat-title"
    >
      <div
        className="bg-surface rounded-xl w-full max-w-[440px] shadow-2xl border border-outline-variant"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-outline-variant">
          <div>
            <h2
              id="zalo-new-chat-title"
              className="text-[15px] font-semibold text-on-surface flex items-center gap-2"
            >
              <MaterialIcon name="person_add" className="text-primary text-base" />
              Nhắn tin cho người lạ
            </h2>
            <p className="text-[11px] text-on-surface-variant mt-0.5">
              Tìm Zalo theo SĐT rồi gửi tin nhắn nếu user cho phép nhận.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-container-low rounded-lg transition shrink-0"
            title="Đóng"
            aria-label="Đóng"
          >
            <MaterialIcon name="close" className="text-base text-on-surface-variant" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-outline-variant px-5">
          <button
            onClick={() => switchMode("phone")}
            className={`flex-1 py-2.5 text-[12px] font-medium transition ${
              mode === "phone"
                ? "text-primary border-b-2 border-primary"
                : "text-on-surface-variant hover:text-on-surface-variant"
            }`}
          >
            Số điện thoại
          </button>
          <button
            onClick={() => switchMode("username")}
            className={`flex-1 py-2.5 text-[12px] font-medium transition ${
              mode === "username"
                ? "text-primary border-b-2 border-primary"
                : "text-on-surface-variant hover:text-on-surface-variant"
            }`}
          >
            Username Zalo
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[11px] text-on-surface-variant mb-1 block">
              {mode === "phone" ? "Số điện thoại Việt Nam" : "Username Zalo"}
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type={mode === "phone" ? "tel" : "text"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
                placeholder={
                  mode === "phone"
                    ? "0839108906, +84939108906, ..."
                    : "vd: nguyen.van.a"
                }
                className="flex-1 px-3 py-2 text-[13px] border border-outline-variant
                           bg-surface rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                autoComplete="off"
                inputMode={mode === "phone" ? "tel" : "text"}
              />
              <button
                onClick={handleSearch}
                disabled={!canSearch || searching}
                className="px-4 py-2 bg-primary text-white text-[12px] font-medium rounded-lg
                           hover:opacity-90 disabled:opacity-40 transition shrink-0 min-w-[72px]
                           flex items-center justify-center gap-1.5"
              >
                {searching ? (
                  <>
                    <MaterialIcon name="sync" className="text-[14px] animate-spin" />
                    Đang tìm
                  </>
                ) : (
                  <>
                    <MaterialIcon name="search" className="text-[14px]" />
                    Tìm
                  </>
                )}
              </button>
            </div>
            {mode === "phone" ? (
              <p className="text-[10.5px] text-on-surface-variant mt-1.5">
                Hỗ trợ nhiều định dạng: {PHONE_EXAMPLES.join(" · ")}
              </p>
            ) : (
              <p className="text-[10.5px] text-on-surface-variant mt-1.5">
                Nhập chính xác username Zalo (không có @).
              </p>
            )}
          </div>

          {error && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg p-3 leading-relaxed">
              <div className="flex items-start gap-2">
                <MaterialIcon name="error" className="text-base shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {found && (
            <div className="border border-outline-variant rounded-xl p-3.5 flex items-center gap-3 bg-surface-container-low">
              {found.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={found.avatar_url}
                  alt={found.display_name}
                  className="w-12 h-12 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-white text-[18px] font-semibold shrink-0">
                  {found.display_name?.[0]?.toUpperCase() || "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] text-on-surface truncate">
                  {found.display_name}
                </div>
                {found.zalo_name && (
                  <div className="text-[11px] text-on-surface-variant truncate">
                    @{found.zalo_name}
                  </div>
                )}
                <div className="text-[10.5px] text-emerald-600 mt-0.5 flex items-center gap-1">
                  <MaterialIcon name="check_circle" className="text-[12px]" />
                  Có thể nhận tin nhắn
                </div>
              </div>
              <button
                onClick={handleStartChat}
                disabled={creating}
                className="px-3.5 py-2 bg-emerald-600 text-white text-[12px] font-medium rounded-lg
                           hover:bg-emerald-700 disabled:opacity-40 transition shrink-0
                           flex items-center gap-1.5"
              >
                {creating ? (
                  <>
                    <MaterialIcon name="sync" className="text-[14px] animate-spin" />
                    Đang mở
                  </>
                ) : (
                  <>
                    <MaterialIcon name="chat" className="text-[14px]" />
                    Nhắn tin
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="px-5 pb-4">
          <p className="text-[10.5px] text-on-surface-variant leading-relaxed">
            ⚠️ Tính năng này chỉ dùng cho khách hàng thân thiết. Nếu user đã tắt
            "Nhận tin nhắn từ người lạ" trong cài đặt Zalo, bạn sẽ nhận thông báo
            lỗi và không thể gửi.
          </p>
        </div>
      </div>
    </div>
  );
}

function extractErrorMessage(err: unknown): string {
  if (!err) return "Đã xảy ra lỗi không xác định";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    // requestJson ném Error(message) với message đã được chuẩn hoá
    return err.message || "Đã xảy ra lỗi không xác định";
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "Đã xảy ra lỗi không xác định";
}
