"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getZaloCurrentStatus,
  startZaloManualLogin,
  resumeZaloManualLogin,
} from "@/services/zaloCrawlerService";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  importZaloSessionViaExtension,
  isZaloExtensionAvailable,
} from "@/services/zaloExtension";

interface Props {
  accountId: string;
  ownerName: string;
  autoTrigger?: boolean;
  onSuccess: () => void;
}

type LoginMethod = "none" | "manual" | "extension";

export default function ZaloAccountAuthView({ accountId, ownerName, autoTrigger, onSuccess }: Props) {
  const [method, setMethod] = useState<LoginMethod>("none");
  const [loading, setLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<string>("none");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [manualViewerUrl, setManualViewerUrl] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accountIdRef = useRef(accountId);
  const hasTriggeredRef = useRef(false);
  const isConnectingRef = useRef(false);

  useEffect(() => {
    accountIdRef.current = accountId;
  }, [accountId]);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  // Poll Zalo auth status
  const pollAuthStatus = useCallback(async () => {
    try {
      const res = await getZaloCurrentStatus(accountIdRef.current);
      setAuthStatus(res.status || "none");
      if (res.is_logged_in && res.can_crawl) {
        setFeedback("Đăng nhập thành công! Đang tải lại hội thoại...");
        clearPolling();
        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
    } catch {
      // ignore check error
    }
  }, [clearPolling, onSuccess]);

  const startManualLogin = useCallback(async () => {
    setLoading(true);
    setWarning(null);
    setFeedback(null);
    setMethod("manual");
    clearPolling();

    try {
      const res = await startZaloManualLogin(accountId);
      setManualViewerUrl(res.manual_viewer_url || null);
      setAuthStatus(res.status || "manual_login_started");
      setFeedback("Đã khởi động phiên đăng nhập thủ công");

      if (res.manual_viewer_url) {
        window.open(res.manual_viewer_url, "_blank", "noopener,noreferrer");
      }

      // Start polling
      pollIntervalRef.current = setInterval(() => {
        void pollAuthStatus();
      }, 3000);
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Không thể bắt đầu phiên đăng nhập thủ công");
      setMethod("none");
    } finally {
      setLoading(false);
    }
  }, [accountId, clearPolling, pollAuthStatus]);

  const handleResumeManual = useCallback(async () => {
    setLoading(true);
    setWarning(null);
    setFeedback("Đang kích hoạt tài khoản Zalo...");
    try {
      const res = await resumeZaloManualLogin(accountId);
      if (res.can_crawl) {
        setFeedback("Kích hoạt thành công! Đang tải lại...");
        clearPolling();
        setTimeout(() => onSuccess(), 1500);
      } else {
        setWarning("Tài khoản chưa hoàn tất đăng nhập trên trình duyệt phụ.");
      }
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Lỗi kích hoạt");
    } finally {
      setLoading(false);
    }
  }, [accountId, clearPolling, onSuccess]);

  const startExtensionLogin = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setLoading(true);
    setWarning(null);
    setFeedback("Đang kết nối với Chrome Extension...");
    setMethod("extension");

    try {
      const extAvailable = await isZaloExtensionAvailable();
      if (!extAvailable) {
        throw new Error(
          "Chưa cài đặt Chrome Extension lấy Zalo cookies.\nVui lòng làm theo hướng dẫn:\n" +
          "1. Mở trang Quản lý Tiện ích mở rộng (chrome://extensions)\n" +
          "2. Bật 'Chế độ cho nhà phát triển' (Developer mode)\n" +
          "3. Bấm 'Tải tiện ích đã giải nén' (Load unpacked) -> Chọn thư mục 'extension-login-zalo'\n" +
          "4. F5 tải lại trang web này và chọn lại đăng nhập bằng Extension."
        );
      }

      setFeedback("Đang mở Zalo Web. Vui lòng đăng nhập trên tab mới nếu chưa đăng nhập...");
      
      const result = await importZaloSessionViaExtension({
        account_id: accountId,
        user_id: accountId,
        owner_id: accountId,
      });

      if (result.backend && (result.backend.status === "confirmed" || result.backend.ok)) {
        setFeedback("✅ Đăng nhập & đồng bộ Zalo thành công!");
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } else {
        throw new Error("Không thể xác thực phiên đăng nhập từ Extension");
      }
    } catch (e) {
      setWarning(e instanceof Error ? e.message : String(e));
      setMethod("none");
    } finally {
      setLoading(false);
      isConnectingRef.current = false;
    }
  }, [accountId, onSuccess]);

  // Auto trigger extension login if requested and available
  useEffect(() => {
    if (autoTrigger && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      void isZaloExtensionAvailable().then(avail => {
        if (avail) {
          void startExtensionLogin();
        } else {
          hasTriggeredRef.current = false;
        }
      });
    }
  }, [autoTrigger, startExtensionLogin]);

  return (
    <div className="w-full flex flex-col items-center p-6 bg-white min-h-[400px]">
        {/* Header icons */}
        <div className="h-14 w-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <MaterialIcon name="warning" className="text-red-500 text-[28px]" />
        </div>

        <h3 className="text-[16px] font-bold text-slate-800 text-center mb-1">
          Yêu cầu đăng nhập Zalo
        </h3>
        <p className="text-[12px] text-slate-500 text-center mb-6">
          Tài khoản <strong>{accountId}</strong> của nhân sự <strong>{ownerName}</strong> đã hết phiên hoặc chưa đăng nhập.
        </p>

        {warning && (
          <div className="w-full mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[11px] text-red-800 font-medium">
            {warning}
          </div>
        )}

        {feedback && (
          <div className="w-full mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-[11px] text-green-800 font-medium">
            {feedback}
          </div>
        )}

        {method === "none" && (
          <div className="w-full space-y-2.5">
            <button
              onClick={startExtensionLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 text-sm transition shadow-sm"
            >
              <MaterialIcon name="sync" className="text-[18px]" />
              Đăng nhập qua Extension (Khuyên dùng)
            </button>
            <a
              href="/extension-login-zalo.zip"
              download
              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-2 text-xs transition"
            >
              <MaterialIcon name="download" className="text-[16px]" />
              Tải extension Zalo (giải nén rồi Load unpacked ở chrome://extensions)
            </a>
            <button
              onClick={startManualLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 hover:border-[#E3000F] text-slate-700 font-bold py-3 text-sm transition shadow-sm"
            >
              <MaterialIcon name="support_agent" className="text-[18px]" />
              Đăng nhập OTP / Trình duyệt VPS (Chậm)
            </button>
          </div>
        )}

        {method === "extension" && (
          <div className="flex flex-col items-center w-full py-4 text-center">
            <div className="h-16 w-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
              <div className="h-8 w-8 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
            </div>
            <p className="text-xs text-slate-600 leading-relaxed max-w-[280px] mb-6">
              Hệ thống đang gọi Chrome Extension để mở tab Zalo Web. Vui lòng hoàn tất đăng nhập trên tab Zalo Web đó để đồng bộ tự động.
            </p>
            <button
              onClick={() => {
                setMethod("none");
                setFeedback(null);
                setWarning(null);
              }}
              className="w-full rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 font-bold py-2.5 text-xs transition"
            >
              Hủy bỏ / Quay lại
            </button>
          </div>
        )}

        {method === "manual" && (
          <div className="flex flex-col items-center w-full text-center">
            <div className="h-20 w-20 rounded-full bg-blue-50 flex items-center justify-center mb-4">
              <MaterialIcon name="support_agent" className="text-blue-500 text-[36px]" />
            </div>

            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Hệ thống đã mở một trình duyệt Zalo phụ trong container backend. Hãy click nút bên dưới để mở giao diện điều khiển trình duyệt và nhập số điện thoại, mật khẩu hoặc mã OTP.
            </p>

            {manualViewerUrl && (
              <a
                href={manualViewerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 text-sm transition shadow-sm mb-4"
              >
                <MaterialIcon name="open_in_new" className="text-[18px]" />
                Mở màn hình trình duyệt Zalo
              </a>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed mb-6">
              Sau khi đã đăng nhập thành công trên cửa sổ trình duyệt phụ Zalo, vui lòng bấm **Xác nhận hoàn tất** ở bên dưới để lưu phiên.
            </p>

            <div className="flex gap-2 w-full">
              <button
                onClick={handleResumeManual}
                disabled={loading}
                className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 text-xs transition shadow-sm"
              >
                Xác nhận hoàn tất
              </button>
              <button
                onClick={() => {
                  setMethod("none");
                  clearPolling();
                }}
                className="flex-1 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 font-bold py-2.5 text-xs transition"
              >
                Quay lại
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
