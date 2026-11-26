"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode } from "lucide-react";
import { MaterialIcon } from "@/components/ui";
import {
  cancelZaloQrLogin,
  getZaloQrStatus,
  importZaloSessionViaExtension,
  isZaloExtensionAvailable,
  startZaloQrLogin,
  type ZaloQrSessionStatus,
} from "@/services/zaloExtension";

interface Props {
  accountId: string;
  ownerName: string;
  autoTrigger?: boolean;
  onSuccess: () => void;
}

type LoginMethod = "none" | "qr" | "extension";

export default function ZaloAccountAuthView({
  accountId,
  ownerName,
  autoTrigger,
  onSuccess,
}: Props) {
  const [method, setMethod] = useState<LoginMethod>("none");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Server QR state
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<ZaloQrSessionStatus | "idle">("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrAttempt, setQrAttempt] = useState(1);
  const [qrMaxAttempts, setQrMaxAttempts] = useState(3);
  const [scannedName, setScannedName] = useState<string | null>(null);

  const hasTriggeredRef = useRef(false);
  const isConnectingRef = useRef(false);
  const activeQrSessionIdRef = useRef<string | null>(null);
  const activeQrStatusRef = useRef<ZaloQrSessionStatus | "idle">("idle");

  useEffect(() => {
    activeQrSessionIdRef.current = qrSessionId;
  }, [qrSessionId]);

  useEffect(() => {
    activeQrStatusRef.current = qrStatus;
  }, [qrStatus]);

  useEffect(() => {
    return () => {
      const sid = activeQrSessionIdRef.current;
      const st = activeQrStatusRef.current;
      if (sid && (st === "starting" || st === "qr_ready" || st === "scanned")) {
        void cancelZaloQrLogin(sid).catch(() => {});
      }
    };
  }, []);

  const cancelCurrentQr = useCallback(async () => {
    const sid = activeQrSessionIdRef.current;
    if (!sid) return;
    activeQrSessionIdRef.current = null;
    try {
      await cancelZaloQrLogin(sid);
    } catch {
      // ignore cancel errors
    }
  }, []);

  const startQrLogin = useCallback(async () => {
    setLoading(true);
    setWarning(null);
    setFeedback("Đang khởi tạo mã QR trực tiếp từ máy chủ...");
    setMethod("qr");
    setQrDataUrl(null);
    setScannedName(null);
    setQrStatus("starting");

    try {
      const res = await startZaloQrLogin({ account_id: accountId });
      setQrSessionId(res.qr_session_id);
      setQrStatus(res.status || "starting");
      setQrAttempt(res.attempt || 1);
      setQrMaxAttempts(res.max_attempts || 3);
      if (res.qr_data_url) setQrDataUrl(res.qr_data_url);
      if (res.error) setWarning(res.error);
      else setFeedback("Quét mã QR bằng Zalo trên điện thoại rồi bấm Xác nhận.");
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "Không thể tạo mã QR đăng nhập Zalo.");
      setQrStatus("error");
      setMethod("none");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  // Poll Server QR status every 1.8s
  useEffect(() => {
    if (
      method !== "qr" ||
      !qrSessionId ||
      (qrStatus !== "starting" && qrStatus !== "qr_ready" && qrStatus !== "scanned")
    ) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const st = await getZaloQrStatus(qrSessionId);
        if (cancelled) return;
        setQrStatus(st.status);
        if (st.attempt) setQrAttempt(st.attempt);
        if (st.max_attempts) setQrMaxAttempts(st.max_attempts);
        if (st.qr_data_url) setQrDataUrl(st.qr_data_url);
        if (st.status === "scanned") {
          setScannedName(st.scanned_user?.display_name || st.display_name || null);
          setFeedback("Đã quét trên ĐT — hãy bấm Xác nhận đăng nhập trên điện thoại.");
        }
        if (st.status === "confirmed") {
          setFeedback("✅ Đăng nhập Zalo thành công! Đang tải lại hội thoại...");
          window.setTimeout(() => onSuccess(), 1200);
        }
        if (st.status === "expired") {
          setWarning("Mã QR đã hết hạn. Vui lòng tạo mã mới.");
        }
        if (st.status === "declined") {
          setWarning("Bạn đã từ chối đăng nhập trên điện thoại.");
        }
        if (st.error) {
          setWarning(st.error);
        }
      } catch (e) {
        if (!cancelled) {
          setWarning(e instanceof Error ? e.message : "Mất kết nối kiểm tra QR.");
          setQrStatus("error");
        }
      }
    };
    const id = window.setInterval(() => {
      void poll();
    }, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [method, qrSessionId, qrStatus, onSuccess]);

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
          "Chưa cài đặt Chrome Extension lấy Zalo cookies.\nVui lòng tải /extension-login-zalo.zip, giải nén, mở chrome://extensions → bật Developer mode → Load unpacked rồi F5 tải lại trang.",
        );
      }

      setFeedback(
        "Extension đang mở tab Zalo Web và trích xuất phiên (tab sẽ tự đóng sau khi đồng bộ xong)...",
      );

      const result = await importZaloSessionViaExtension({
        account_id: accountId,
        user_id: accountId,
        owner_id: accountId,
      });

      if (result.backend && (result.backend.status === "confirmed" || result.backend.ok)) {
        setFeedback("✅ Đăng nhập & đồng bộ Zalo thành công!");
        window.setTimeout(() => {
          onSuccess();
        }, 1200);
      } else {
        throw new Error("Không thể xác thực phiên đăng nhập từ Extension.");
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
      void isZaloExtensionAvailable().then((avail) => {
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
      <p className="text-[12px] text-slate-500 text-center mb-4">
        Tài khoản <strong>{accountId}</strong> của nhân sự <strong>{ownerName}</strong> đã hết phiên
        hoặc chưa đăng nhập.
      </p>

      {/* 1-Web-Slot Safety Warning */}
      <div className="w-full mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] font-medium text-amber-950 leading-relaxed">
        ⚠️ Zalo chỉ cho 1 phiên Web — Kết nối xong HÃY ĐÓNG TAB (✕), TUYỆT ĐỐI KHÔNG bấm Đăng xuất
        trên chat.zalo.me. Dùng Zalo PC &amp; Mobile thoải mái!
      </div>

      {warning && (
        <div className="w-full mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[11px] text-red-800 font-medium whitespace-pre-line">
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
            type="button"
            onClick={() => void startQrLogin()}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0068ff] hover:bg-[#0052cc] text-white font-bold py-3 text-sm transition shadow-sm cursor-pointer disabled:opacity-60"
          >
            <QrCode className="h-4.5 w-4.5" />
            Quét mã QR trực tiếp (Khuyên dùng)
          </button>
          <button
            type="button"
            onClick={() => void startExtensionLogin()}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 hover:border-blue-300 text-slate-700 font-bold py-2.5 text-xs transition shadow-2xs cursor-pointer disabled:opacity-60"
          >
            <MaterialIcon name="sync" className="text-[16px]" />
            Đăng nhập qua Extension 1-Chạm (Dự phòng)
          </button>
          <a
            href="/extension-login-zalo.zip"
            download
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-2 text-xs transition"
          >
            <MaterialIcon name="download" className="text-[16px]" />
            Tải extension Zalo (giải nén rồi Load unpacked ở chrome://extensions)
          </a>
        </div>
      )}

      {method === "qr" && (
        <div className="flex flex-col items-center w-full py-2 text-center gap-3">
          <div className="flex h-48 w-48 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-2">
            {qrStatus === "scanned" ? (
              <div className="px-3 text-xs font-bold text-[#0052cc]">
                {scannedName ? `${scannedName}: ` : ""}Đã quét trên ĐT — hãy bấm Xác nhận
              </div>
            ) : qrDataUrl && qrStatus === "qr_ready" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Zalo QR Code"
                className="h-full w-full object-contain rounded-xl bg-white"
              />
            ) : qrStatus === "starting" || loading ? (
              <div className="h-8 w-8 rounded-full border-4 border-[#0068ff] border-t-transparent animate-spin" />
            ) : (
              <button
                type="button"
                onClick={() => void startQrLogin()}
                className="rounded-xl bg-[#0068ff] px-3 py-2 text-xs font-bold text-white cursor-pointer"
              >
                Tạo mã QR mới
              </button>
            )}
          </div>
          {qrStatus === "qr_ready" && (
            <span className="text-[11px] font-semibold text-slate-600">
              Lần {qrAttempt}/{qrMaxAttempts} — Quét bằng ứng dụng Zalo trên điện thoại
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              void cancelCurrentQr();
              setMethod("none");
              setQrStatus("idle");
              setQrSessionId(null);
              setFeedback(null);
            }}
            className="w-full rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 font-bold py-2.5 text-xs transition cursor-pointer"
          >
            Hủy bỏ / Quay lại
          </button>
        </div>
      )}

      {method === "extension" && (
        <div className="flex flex-col items-center w-full py-4 text-center">
          <div className="h-16 w-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <div className="h-8 w-8 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
          </div>
          <p className="text-xs text-slate-600 leading-relaxed max-w-[280px] mb-6">
            Extension đang mở tab Zalo Web để trích xuất phiên và sẽ tự động đóng tab sau khi đồng
            bộ xong.
          </p>
          <button
            type="button"
            onClick={() => {
              setMethod("none");
              setFeedback(null);
              setWarning(null);
            }}
            className="w-full rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 font-bold py-2.5 text-xs transition cursor-pointer"
          >
            Hủy bỏ / Quay lại
          </button>
        </div>
      )}
    </div>
  );
}
