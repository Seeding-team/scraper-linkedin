"use client";

import { useZaloCrawlerFlow } from "@/hooks/useZaloCrawlerFlow";
import { ZaloDashboardView } from "./ZaloDashboardView";
import { useRouter } from "next/navigation";

export function ZaloAccountsPageContent() {
  const flow = useZaloCrawlerFlow();
  const router = useRouter();

  function handleEnterChat(accountId: string) {
    // Điều hướng sang trang quản lý inbox chính (có sidebar hội thoại, gán
    // nhãn, share leader...) thay vì trang /zalo-chat full-screen cũ.
    router.push(`/all-platform/zalo-inbox?account=${encodeURIComponent(accountId)}`);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#f8f9fa]">
      <ZaloDashboardView flow={flow} onEnterChat={handleEnterChat} />

      {/* Modal "Đăng nhập lại" (Zalo tập trung — đăng nhập CHỈ còn qua Extension,
          đã bỏ hẳn QR/Playwright, xem restartSession() trong useZaloCrawlerFlow.ts).
          Chỉ còn hiện trạng thái đang kết nối Extension + cảnh báo nếu có. */}
      {flow.isStartingSession && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[340px] rounded-xl bg-white p-6 shadow-2xl flex flex-col items-center">
            <button
              onClick={() => void flow.endSession()}
              className="self-end -mt-2 -mr-2 mb-1 text-slate-400 hover:text-slate-600 text-sm font-bold"
              title="Đóng"
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
            <h3 className="text-base font-bold text-slate-800 mb-1.5 mt-2 text-center">Đăng nhập lại Zalo</h3>
            <p className="text-slate-500 text-[11px] text-center mb-1 leading-relaxed">
              Extension sẽ mở tab chat.zalo.me và tự lấy phiên đăng nhập hiện có.
            </p>

            {flow.warningMessage && (
              <p className="mt-3 text-[11px] text-red-600 text-center">{flow.warningMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
