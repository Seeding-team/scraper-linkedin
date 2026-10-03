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

      {/* Modal QR đăng nhập lại (2026-07-04): nút "Đăng nhập lại" ở
          ZaloDashboardView gọi flow.startSession() tạo mã QR, nhưng trang
          lưới tài khoản này trước đó KHÔNG hiển thị mã QR ở đâu cả — người
          dùng bấm xong không thấy gì xảy ra. Thêm modal hiển thị đúng
          flow.qrBase64 ngay tại đây (cùng flow instance, không cần điều
          hướng sang trang khác vì useZaloCrawlerFlow không dùng Context
          nên mỗi trang có state riêng — điều hướng sẽ mất mã QR vừa tạo). */}
      {(flow.qrBase64 || flow.isStartingSession) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[340px] rounded-xl bg-white p-6 shadow-2xl flex flex-col items-center">
            <button
              onClick={() => void flow.endSession()}
              className="self-end -mt-2 -mr-2 mb-1 text-slate-400 hover:text-slate-600 text-sm font-bold"
              title="Đóng"
            >
              ✕
            </button>

            {flow.qrBase64 ? (
              <>
                <div className="bg-white p-4 rounded-xl shadow-lg mb-4 border border-slate-200 relative">
                  <img
                    src={flow.qrBase64.startsWith("data:") ? flow.qrBase64 : `data:image/png;base64,${flow.qrBase64}`}
                    alt="Zalo QR"
                    className="w-48 h-48 object-fill"
                  />
                  {flow.authStatus === "waiting_scan" && (
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-primary text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-md animate-pulse whitespace-nowrap">
                      Đang chờ quét mã...
                    </div>
                  )}
                </div>
                <h3 className="text-base font-bold text-slate-800 mb-1.5 mt-2 text-center">Quét mã QR bằng Zalo</h3>
                <p className="text-slate-500 text-[11px] text-center mb-4 leading-relaxed">
                  Mở ứng dụng Zalo trên điện thoại → Quét QR → Xác nhận đăng nhập
                </p>
                <button
                  onClick={() => void flow.startSession()}
                  disabled={flow.isStartingSession}
                  className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-[12px] font-semibold hover:bg-slate-50 transition shadow-sm disabled:opacity-50"
                >
                  {flow.isStartingSession ? "Đang tạo..." : "Làm mới QR"}
                </button>
              </>
            ) : (
              <div className="w-48 h-48 bg-white rounded-xl mb-2 flex items-center justify-center border-2 border-dashed border-slate-200 shadow-sm">
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <span className="text-[12px] font-semibold animate-pulse">Đang tạo mã QR...</span>
                </div>
              </div>
            )}

            {flow.warningMessage && (
              <p className="mt-3 text-[11px] text-red-600 text-center">{flow.warningMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
