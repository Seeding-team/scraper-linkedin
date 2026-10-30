"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  onError?: (message: string) => void;
  onSuccess?: (displayName: string) => void;
  initialQuery?: string;
}

const PHONE_EXAMPLES = ["0839108906", "+84939108906", "0084 939 108 906"];

export function ZaloNewChatModal({
  open,
  accountId,
  onClose,
  onChatReady,
  onError,
  onSuccess,
  initialQuery,
}: ZaloNewChatModalProps) {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<SearchMode>("phone");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<ZaloFoundUser | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (open) {
      const seedQuery = initialQuery?.trim() || "";
      setMode("phone");
      setQuery(seedQuery);
      setFound(null);
      setError(null);
      setSearching(false);
      setCreating(false);
      if (seedQuery.length >= 8 && accountId) {
        setSearching(true);
        findZaloUser(accountId, seedQuery, "phone")
          .then((result) => setFound(result))
          .catch((e) => {
            const msg = extractErrorMessage(e);
            setError(msg);
            onError?.(msg);
          })
          .finally(() => setSearching(false));
      } else {
        const t = window.setTimeout(() => inputRef.current?.focus(), 60);
        return () => window.clearTimeout(t);
      }
    }
  }, [open, initialQuery, accountId, onError]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length >= (mode === "phone" ? 8 : 2);

  const handleSearch = async () => {
    if (!accountId) {
      setError("Vui lòng chọn một tài khoản Zalo đang hoạt động ở thanh trên trước khi tìm kiếm.");
      return;
    }
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
    if (!accountId) {
      setError("Chưa xác định được tài khoản Zalo gửi tin. Vui lòng chọn tài khoản ở góc trên.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await createZaloUserThread(accountId, {
        user_id: found.user_id,
        display_name: found.display_name,
        avatar_url: found.avatar_url ?? null,
      });
      if (res?.conversation_id) {
        onSuccess?.(found.display_name);
        onChatReady(res.conversation_id);
      } else {
        throw new Error("Không nhận được mã cuộc trò chuyện từ Zalo");
      }
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

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 font-sans text-slate-800 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="zalo-new-chat-title"
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[460px] shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <div>
            <h2
              id="zalo-new-chat-title"
              className="text-base font-bold text-slate-900 flex items-center gap-2"
            >
              <MaterialIcon name="person_search" className="text-[#0068FF] text-xl" />
              Tìm người lạ & Nhắn tin mới
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tìm tài khoản Zalo theo Số điện thoại hoặc Username để bắt đầu trò chuyện.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-xl transition text-slate-400 hover:text-slate-600 cursor-pointer"
            title="Đóng"
          >
            <MaterialIcon name="close" className="text-lg" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-5 bg-slate-50/50">
          <button
            onClick={() => switchMode("phone")}
            className={`flex-1 py-2.5 text-xs font-bold transition cursor-pointer ${
              mode === "phone"
                ? "text-[#0068FF] border-b-2 border-[#0068FF]"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Số điện thoại
          </button>
          <button
            onClick={() => switchMode("username")}
            className={`flex-1 py-2.5 text-xs font-bold transition cursor-pointer ${
              mode === "username"
                ? "text-[#0068FF] border-b-2 border-[#0068FF]"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Username Zalo
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-700 mb-1.5 block">
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
                    ? "Nhập số điện thoại (VD: 0987654321)..."
                    : "vd: nguyen.van.a"
                }
                className="flex-1 px-3 py-2 text-xs border border-slate-200 bg-white rounded-xl focus:outline-none focus:border-[#0068FF]"
                autoComplete="off"
                inputMode={mode === "phone" ? "tel" : "text"}
              />
              <button
                onClick={handleSearch}
                disabled={!canSearch || searching}
                className="px-4 py-2 bg-[#0068FF] hover:bg-[#0052cc] text-white text-xs font-bold rounded-xl disabled:opacity-40 transition shrink-0 min-w-[76px] flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                {searching ? (
                  <>
                    <MaterialIcon name="sync" className="text-[14px] animate-spin" />
                    Đang tìm
                  </>
                ) : (
                  <>
                    <MaterialIcon name="search" className="text-[14px]" />
                    Tìm kiếm
                  </>
                )}
              </button>
            </div>
            {mode === "phone" ? (
              <p className="text-[11px] text-slate-400 mt-1.5">
                Định dạng: {PHONE_EXAMPLES.join(" · ")}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 mt-1.5">
                Nhập chính xác username Zalo (không bao gồm ký tự @).
              </p>
            )}
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 leading-relaxed">
              <div className="flex items-start gap-2">
                <MaterialIcon name="error" className="text-base shrink-0 mt-0.5 text-red-600" />
                <span className="font-medium">{error}</span>
              </div>
            </div>
          )}

          {found && (
            <div className="border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 bg-slate-50/70">
              {found.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={found.avatar_url}
                  alt={found.display_name}
                  className="w-12 h-12 rounded-full object-cover shrink-0 border border-slate-200"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#0068FF] to-[#0040aa] flex items-center justify-center text-white text-base font-bold shrink-0">
                  {found.display_name?.[0]?.toUpperCase() || "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-slate-900 truncate">
                  {found.display_name}
                </div>
                {found.zalo_name && (
                  <div className="text-xs text-slate-500 truncate">
                    @{found.zalo_name}
                  </div>
                )}
                <div className="text-[11px] text-emerald-600 mt-0.5 flex items-center gap-1 font-semibold">
                  <MaterialIcon name="check_circle" className="text-[13px]" />
                  Có thể gửi tin nhắn
                </div>
              </div>
              <button
                onClick={handleStartChat}
                disabled={creating}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-40 transition shrink-0 flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                {creating ? (
                  <>
                    <MaterialIcon name="sync" className="text-[14px] animate-spin" />
                    Đang mở
                  </>
                ) : (
                  <>
                    <MaterialIcon name="chat" className="text-[14px]" />
                    Nhắn tin ngay
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="px-5 pb-4">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            💡 Lưu ý: Nếu người dùng đã tắt cài đặt "Nhận tin nhắn từ người lạ" trên Zalo cá nhân, tin nhắn đầu tiên có thể không gửi được.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

function extractErrorMessage(err: unknown): string {
  if (!err) return "Đã xảy ra lỗi không xác định";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    return err.message || "Đã xảy ra lỗi không xác định";
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "Không tìm thấy người dùng này trên Zalo hoặc số điện thoại chưa đăng ký.";
}
