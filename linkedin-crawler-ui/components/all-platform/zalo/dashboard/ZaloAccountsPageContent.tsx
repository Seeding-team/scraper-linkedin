"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useZaloCrawlerFlow } from "@/hooks/useZaloCrawlerFlow";
import { ZaloAccountsModal } from "../chat/ZaloAccountsModal";
import { ZaloDashboardView } from "./ZaloDashboardView";

interface ZaloAccountsPageContentProps {
  onEnterChat?: (accountId: string) => void;
}

export function ZaloAccountsPageContent({ onEnterChat }: ZaloAccountsPageContentProps = {}) {
  const flow = useZaloCrawlerFlow();
  const router = useRouter();
  const [connectModalAccountId, setConnectModalAccountId] = useState<string | null>(null);
  const [dismissedStartingOverlay, setDismissedStartingOverlay] = useState(false);

  function handleEnterChat(accountId: string) {
    if (onEnterChat) {
      onEnterChat(accountId);
    } else {
      // Điều hướng sang trang quản lý inbox chính (có sidebar hội thoại, gán
      // nhãn, share leader...) thay vì trang /zalo-chat full-screen cũ.
      router.push(`/all-platform/zalo-inbox?account=${encodeURIComponent(accountId)}`);
    }
  }

  function handleConnectAccount(accountId: string) {
    setDismissedStartingOverlay(false);
    setConnectModalAccountId(accountId);
  }

  function handleCloseStartingOverlay() {
    // CHỈ đóng trạng thái UI và hủy tiến trình đợi Extension — TUYỆT ĐỐI KHÔNG gọi flow.endSession() / deleteZaloAccountFull()!
    setDismissedStartingOverlay(true);
    try {
      void window.__zaloExtension?.cancelImport?.();
    } catch {
      // ignore if extension bridge is not loaded
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <ZaloDashboardView
        flow={flow}
        onEnterChat={handleEnterChat}
        onConnectAccount={handleConnectAccount}
      />

      {/* Unified 3-Zone Zalo Connect Modal (Server QR + Extension 1-Chạm) */}
      {connectModalAccountId !== null && (
        <ZaloAccountsModal
          initialAccountId={connectModalAccountId || null}
          initialTab="qr"
          onClose={() => setConnectModalAccountId(null)}
          onChanged={() => {
            void flow.refreshLoginStatus();
          }}
        />
      )}

      {/* Overlay đang kết nối Extension (chỉ hiện nếu flow.isStartingSession được kích hoạt trực tiếp) */}
      {flow.isStartingSession && !dismissedStartingOverlay && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[360px] rounded-xl bg-white p-6 shadow-2xl flex flex-col items-center">
            <button
              type="button"
              onClick={handleCloseStartingOverlay}
              className="self-end -mt-2 -mr-2 mb-1 text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              title="Đóng hộp thoại (không xóa tài khoản)"
            >
              ✕
            </button>

            <div className="w-48 h-48 bg-white rounded-xl mb-2 flex items-center justify-center border-2 border-dashed border-slate-200 shadow-sm">
              <div className="flex flex-col items-center gap-2 text-slate-500">
                <span className="material-symbols-outlined text-3xl animate-pulse">sync</span>
                <span className="text-[12px] font-semibold animate-pulse text-center px-2">
                  Đang kết nối qua Chrome Extension...
                </span>
              </div>
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1.5 mt-2 text-center">
              Đăng nhập lại Zalo
            </h3>
            <p className="text-slate-500 text-[11px] text-center mb-2 leading-relaxed">
              Extension sẽ mở tab chat.zalo.me, trích xuất phiên và tự động đóng tab sau khi đồng
              bộ xong.
            </p>
            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] font-medium text-amber-900 text-center">
              ⚠️ Kết nối xong HÃY ĐÓNG TAB (✕), TUYỆT ĐỐI KHÔNG bấm Đăng xuất trên chat.zalo.me.
            </div>

            {flow.warningMessage && (
              <p className="mt-3 text-[11px] text-red-600 text-center">{flow.warningMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
