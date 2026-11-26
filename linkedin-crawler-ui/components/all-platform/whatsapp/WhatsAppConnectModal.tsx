"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  Loader2,
  PhoneCall,
  PhoneOff,
  QrCode,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { whatsappService } from "@/services/whatsapp.service";
import type { WhatsAppAccount, WhatsAppSettingsPatch } from "@/types/whatsapp";
import {
  formatAccountName,
  formatPairingCodeSpaced,
  getAccountStatusMeta,
  normalizeWaPhoneDigits,
} from "./whatsapp-ui";

export type WhatsAppModalTab = "qr" | "pairing" | "settings";

export interface WhatsAppConnectModalProps {
  initialTab?: WhatsAppModalTab;
  account?: WhatsAppAccount | null;
  liveAccounts: WhatsAppAccount[];
  onClose: () => void;
  onConnected: (accountId: string) => void;
  onSettingsSaved: (updated: WhatsAppAccount) => void;
}

export function WhatsAppConnectModal({
  initialTab = "qr",
  account = null,
  liveAccounts,
  onClose,
  onConnected,
  onSettingsSaved,
}: WhatsAppConnectModalProps) {
  const [activeTab, setActiveTab] = useState<WhatsAppModalTab>(
    initialTab === "settings" && !account ? "qr" : initialTab,
  );

  // ── Connect state (QR & Pairing) ───────────────────────────────────────────
  const [label, setLabel] = useState(account?.label || "");
  const [phoneInput, setPhoneInput] = useState(account?.phone_number || "");
  const [workingAccountId, setWorkingAccountId] = useState<string | null>(
    initialTab !== "settings" ? (account?.id ?? null) : null,
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(account?.qr_data_url || null);
  const [pairingCode, setPairingCode] = useState<string | null>(account?.pairing_code || null);
  const [connectStatus, setConnectStatus] = useState<string>(account?.status || "idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [qrSecondsLeft, setQrSecondsLeft] = useState(60);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // ── Settings state (Call & Meta Cloud Calling API) ─────────────────────────
  const [settingsLabel, setSettingsLabel] = useState(account?.label || "");
  const [autoRejectCalls, setAutoRejectCalls] = useState(Boolean(account?.auto_reject_calls));
  const [autoRejectMessage, setAutoRejectMessage] = useState(
    account?.auto_reject_message ||
      "Xin lỗi, hiện tại mình đang bận nên chưa nghe máy được. Bạn để lại tin nhắn mình phản hồi ngay nhé!",
  );
  const [cloudEnabled, setCloudEnabled] = useState(Boolean(account?.cloud_calling_enabled));
  const [cloudPhoneNumberId, setCloudPhoneNumberId] = useState(account?.cloud_phone_number_id || "");
  const [cloudWabaId, setCloudWabaId] = useState(account?.cloud_waba_id || "");
  const [cloudAccessToken, setCloudAccessToken] = useState("");
  const [showCloudToken, setShowCloudToken] = useState(false);
  const [cloudVerifyToken, setCloudVerifyToken] = useState(account?.cloud_webhook_verify_token || "");
  const [savingSettings, setSavingSettings] = useState(false);

  // Derive live SSE state for the account being connected
  const liveWorkingAccount = workingAccountId
    ? liveAccounts.find((a) => a.id === workingAccountId) ?? null
    : null;

  const effectiveQr = liveWorkingAccount?.qr_data_url || qrDataUrl;
  const effectivePairingCode = liveWorkingAccount?.pairing_code || pairingCode;
  const effectiveStatus = liveWorkingAccount?.status || connectStatus;
  const isNowConnected = effectiveStatus === "connected";

  // Notify parent when SSE or poll flips status to connected
  useEffect(() => {
    if (!workingAccountId || !isNowConnected || activeTab === "settings") return;
    const timer = window.setTimeout(() => {
      toast.success("Kết nối WhatsApp thành công!");
      onConnected(workingAccountId);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [workingAccountId, isNowConnected, activeTab, onConnected]);

  // Poll status every 2.5s while waiting for QR scan or Pairing Code confirmation
  useEffect(() => {
    if (!workingAccountId || activeTab === "settings" || isNowConnected) return;
    let cancelled = false;
    const poll = async () => {
      const res = await whatsappService.getAccountStatus(workingAccountId);
      if (cancelled || !res.success || !res.data) return;
      const st = res.data;
      const acc = st.account;
      const nextStatus = st.status || acc?.status;
      const nextQr = st.qr_data_url || acc?.qr_data_url || null;
      const nextCode = st.pairing_code || acc?.pairing_code || null;
      const nextErr = st.last_error || acc?.last_error || null;

      if (nextStatus) setConnectStatus(nextStatus);
      if (nextQr) setQrDataUrl(nextQr);
      if (nextCode) setPairingCode(nextCode);
      if (nextErr && nextStatus === "error") setConnectError(nextErr);
    };

    const intervalId = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [workingAccountId, activeTab, isNowConnected]);

  // QR 60s countdown tick
  useEffect(() => {
    if (!effectiveQr || activeTab !== "qr" || isNowConnected) return;
    const id = window.setInterval(() => {
      setQrSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [effectiveQr, activeTab, isNowConnected]);

  const handleStartQr = useCallback(async () => {
    setRequesting(true);
    setConnectError(null);
    setQrDataUrl(null);
    setQrSecondsLeft(60);
    const res = await whatsappService.connectQr({
      label: label.trim() || undefined,
      account_id: workingAccountId || account?.id || undefined,
    });
    setRequesting(false);
    if (!res.success) {
      setConnectError(res.message || "Không thể khởi tạo phiên mã QR WhatsApp.");
      return;
    }
    const payload = res.data;
    const accId = payload?.account?.id || payload?.id || workingAccountId || account?.id || null;
    if (accId) setWorkingAccountId(accId);
    setConnectStatus(payload?.status || payload?.account?.status || "connecting");
    if (payload?.qr_data_url || payload?.account?.qr_data_url) {
      setQrDataUrl(payload.qr_data_url || payload.account?.qr_data_url || null);
      setQrSecondsLeft(60);
    }
  }, [label, workingAccountId, account?.id]);

  const handleStartPairing = useCallback(async () => {
    const digits = normalizeWaPhoneDigits(phoneInput);
    if (digits.length < 9 || digits.length > 15) {
      setConnectError("Vui lòng nhập số điện thoại hợp lệ kèm mã quốc gia (vd: 84901234567 hoặc 0901234567).");
      return;
    }
    setRequesting(true);
    setConnectError(null);
    setPairingCode(null);
    const res = await whatsappService.connectPairing({
      phone_number: digits,
      label: label.trim() || undefined,
      account_id: workingAccountId || account?.id || undefined,
    });
    setRequesting(false);
    if (!res.success) {
      setConnectError(res.message || "Không thể lấy mã ghép nối 8 ký tự.");
      return;
    }
    const payload = res.data;
    const accId = payload?.account?.id || payload?.id || workingAccountId || account?.id || null;
    if (accId) setWorkingAccountId(accId);
    setConnectStatus(payload?.status || payload?.account?.status || "connecting");
    const code = payload?.pairing_code || payload?.account?.pairing_code || null;
    if (code) setPairingCode(code);
  }, [phoneInput, label, workingAccountId, account?.id]);

  const handleCopyText = useCallback(async (text: string, which: "code" | "webhook") => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "code") {
        setCopiedCode(true);
        window.setTimeout(() => setCopiedCode(false), 1800);
      } else {
        setCopiedWebhook(true);
        window.setTimeout(() => setCopiedWebhook(false), 1800);
      }
      toast.success("Đã sao chép vào bộ nhớ tạm.");
    } catch {
      toast.error("Không thể sao chép tự động, vui lòng bôi đen để copy.");
    }
  }, []);

  const handleSaveSettings = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!account) return;
      setSavingSettings(true);
      const patch: WhatsAppSettingsPatch = {
        label: settingsLabel.trim() || null,
        auto_reject_calls: autoRejectCalls,
        auto_reject_message: autoRejectMessage.trim() || null,
        cloud_calling_enabled: cloudEnabled,
        cloud_phone_number_id: cloudPhoneNumberId.trim() || null,
        cloud_waba_id: cloudWabaId.trim() || null,
        cloud_webhook_verify_token: cloudVerifyToken.trim() || null,
      };
      if (cloudAccessToken.trim()) {
        patch.cloud_access_token = cloudAccessToken.trim();
      }
      const res = await whatsappService.updateAccountSettings(account.id, patch);
      setSavingSettings(false);
      if (!res.success) {
        toast.error(res.message || "Lưu cài đặt WhatsApp thất bại.");
        return;
      }
      toast.success("Đã lưu cài đặt tài khoản & cuộc gọi WhatsApp.");
      if (res.data) {
        onSettingsSaved(res.data);
      } else {
        onSettingsSaved({
          ...account,
          ...patch,
          has_cloud_token: account.has_cloud_token || Boolean(cloudAccessToken.trim()),
        });
      }
      onClose();
    },
    [
      account,
      settingsLabel,
      autoRejectCalls,
      autoRejectMessage,
      cloudEnabled,
      cloudPhoneNumberId,
      cloudWabaId,
      cloudVerifyToken,
      cloudAccessToken,
      onSettingsSaved,
      onClose,
    ],
  );

  const statusMeta = getAccountStatusMeta(effectiveStatus);
  const webhookUrl = whatsappService.webhookUrlHint();

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-xs">
              {activeTab === "settings" ? (
                <Settings2 className="h-5 w-5" />
              ) : activeTab === "pairing" ? (
                <Hash className="h-5 w-5" />
              ) : (
                <QrCode className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">
                {activeTab === "settings"
                  ? `Cài đặt: ${account ? formatAccountName(account) : "WhatsApp"}`
                  : "Kết nối tài khoản WhatsApp"}
              </h2>
              <p className="text-xs text-emerald-50/90">
                {activeTab === "settings"
                  ? "Tự động từ chối cuộc gọi & cấu hình Meta Cloud Calling API (WebRTC 2 chiều)"
                  : "Liên kết đa thiết bị (Multi-Device) trực tiếp qua mã QR hoặc mã 8 ký tự"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white transition cursor-pointer"
            aria-label="Đóng hộp thoại"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-slate-200 bg-slate-50/80 px-3 pt-2 gap-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab("qr");
              setConnectError(null);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-t-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer",
              activeTab === "qr"
                ? "bg-white text-emerald-700 border border-b-white border-slate-200 -mb-px"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <QrCode className="h-3.5 w-3.5" />
            Quét mã QR
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("pairing");
              setConnectError(null);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-t-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer",
              activeTab === "pairing"
                ? "bg-white text-emerald-700 border border-b-white border-slate-200 -mb-px"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <Smartphone className="h-3.5 w-3.5" />
            Mã ghép nối 8 ký tự
          </button>
          {account && (
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className={cn(
                "flex items-center gap-1.5 rounded-t-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer",
                activeTab === "settings"
                  ? "bg-white text-emerald-700 border border-b-white border-slate-200 -mb-px"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <PhoneCall className="h-3.5 w-3.5" />
              Cuộc gọi & Cloud API
            </button>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[75vh] overflow-y-auto p-5">
          {/* TAB 1: QR CODE */}
          {activeTab === "qr" && (
            <div className="space-y-4">
              {isNowConnected ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/70 py-10 text-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-600 mb-2" />
                  <p className="text-base font-bold text-emerald-900">Đã kết nối WhatsApp thành công!</p>
                  <p className="mt-1 text-xs text-emerald-700">
                    Đang mở không gian trò chuyện và đồng bộ hội thoại...
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tên gợi nhớ tài khoản (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Vd: Hotline Sale HCM, CSKH WhatsApp..."
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleStartQr()}
                      disabled={requesting}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition cursor-pointer"
                    >
                      {requesting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : effectiveQr ? (
                        <RefreshCw className="h-4 w-4" />
                      ) : (
                        <QrCode className="h-4 w-4" />
                      )}
                      <span>{effectiveQr ? "Làm mới mã QR" : "Tạo mã QR"}</span>
                    </button>
                  </div>

                  {connectError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                      {connectError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-[224px_1fr] gap-5 items-center rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-col items-center justify-center">
                      <div className="relative flex h-52 w-52 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xs">
                        {effectiveQr ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={effectiveQr}
                            alt="WhatsApp QR Code"
                            className="h-full w-full object-contain"
                          />
                        ) : requesting || workingAccountId ? (
                          <div className="flex flex-col items-center gap-2 text-center px-4">
                            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                            <span className="text-xs font-medium text-slate-600">
                              Đang khởi tạo mã QR từ WhatsApp...
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-center px-4 text-slate-400">
                            <QrCode className="h-12 w-12 opacity-40" />
                            <span className="text-xs">Nhấn &ldquo;Tạo mã QR&rdquo; để bắt đầu liên kết</span>
                          </div>
                        )}
                      </div>
                      {effectiveQr && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                          <span className={cn("h-2 w-2 rounded-full", statusMeta.dotClass)} />
                          <span>
                            {qrSecondsLeft > 0
                              ? `Tự làm mới sau ${qrSecondsLeft}s`
                              : "Mã QR sắp hết hạn — bấm Làm mới"}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5 text-xs text-slate-700">
                      <p className="font-bold text-slate-900 text-sm">Hướng dẫn quét trên điện thoại:</p>
                      <ol className="space-y-2 list-decimal pl-4">
                        <li>
                          Mở ứng dụng <strong>WhatsApp</strong> trên điện thoại của bạn.
                        </li>
                        <li>
                          Chọn <strong>Cài đặt (Settings)</strong> trên iOS hoặc biểu tượng{" "}
                          <strong>3 chấm (⋮)</strong> trên Android.
                        </li>
                        <li>
                          Chạm <strong>Thiết bị đã liên kết (Linked Devices)</strong> →{" "}
                          <strong>Liên kết thiết bị (Link a Device)</strong>.
                        </li>
                        <li>Hướng camera vào mã QR bên trái để hoàn tất đăng nhập tức thì.</li>
                      </ol>
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200/80 px-3 py-2 text-[11px] text-emerald-800">
                        Phiên đăng nhập được lưu cục bộ an toàn và tự động đồng bộ tin nhắn, danh bạ theo thời gian thực.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 2: 8-CHAR PAIRING CODE */}
          {activeTab === "pairing" && (
            <div className="space-y-4">
              {isNowConnected ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/70 py-10 text-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-600 mb-2" />
                  <p className="text-base font-bold text-emerald-900">Ghép nối WhatsApp thành công!</p>
                  <p className="mt-1 text-xs text-emerald-700">Đang chuyển vào giao diện trò chuyện...</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Số điện thoại WhatsApp <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="Vd: 84901234567 hoặc 0901234567"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Tự động chuẩn hóa đầu 0 Việt Nam thành 84 (không cần dấu +).
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tên gợi nhớ tài khoản (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Vd: Sale B2B Global"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleStartPairing()}
                      disabled={requesting}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition cursor-pointer"
                    >
                      {requesting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <KeyRound className="h-4 w-4" />
                      )}
                      <span>{effectivePairingCode ? "Lấy lại mã 8 ký tự" : "Lấy mã ghép nối 8 ký tự"}</span>
                    </button>
                  </div>

                  {connectError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                      {connectError}
                    </div>
                  )}

                  {effectivePairingCode ? (
                    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 p-5 text-center space-y-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-0.5 text-[11px] font-bold text-emerald-800">
                        <Sparkles className="h-3.5 w-3.5" />
                        Nhập mã này trên điện thoại WhatsApp của bạn
                      </span>
                      <div className="flex items-center justify-center gap-3">
                        <div className="rounded-xl border border-emerald-300 bg-white px-6 py-3 font-mono text-3xl font-extrabold tracking-[0.22em] text-slate-900 shadow-2xs select-all">
                          {formatPairingCodeSpaced(effectivePairingCode)}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyText(effectivePairingCode, "code")}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3.5 py-3 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                        >
                          {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          {copiedCode ? "Đã copy" : "Copy"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-600">
                        Trên điện thoại: <strong>Thiết bị đã liên kết → Liên kết thiết bị → Liên kết bằng số điện thoại</strong> rồi nhập 8 ký tự trên.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600 space-y-1.5">
                      <p className="font-semibold text-slate-800">Khi nào nên dùng Mã ghép nối 8 ký tự?</p>
                      <p>
                        Rất tiện khi điện thoại không tiện quét camera hoặc bạn đang đăng nhập từ xa qua máy chủ. WhatsApp sẽ gửi thông báo trực tiếp lên điện thoại để bạn nhập mã 8 ký tự.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 3: SETTINGS (CALLS & META CLOUD CALLING API) */}
          {activeTab === "settings" && account && (
            <form onSubmit={(e) => void handleSaveSettings(e)} className="space-y-5">
              {/* General Label */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tên hiển thị nội bộ (Label)
                </label>
                <input
                  type="text"
                  value={settingsLabel}
                  onChange={(e) => setSettingsLabel(e.target.value)}
                  placeholder="Vd: WhatsApp Sale 01"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                />
              </div>

              {/* Auto-reject incoming calls */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                      <PhoneOff className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        Tự động từ chối cuộc gọi đến
                      </div>
                      <p className="text-xs text-slate-500">
                        Khi có khách gọi tới số cá nhân (Baileys), tự động từ chối và nhắn tin phản hồi lịch sự.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoRejectCalls}
                    onClick={() => setAutoRejectCalls((v) => !v)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer",
                      autoRejectCalls ? "bg-emerald-600" : "bg-slate-300",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5",
                        autoRejectCalls ? "translate-x-5.5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tin nhắn tự động gửi khi từ chối cuộc gọi
                  </label>
                  <textarea
                    rows={2}
                    value={autoRejectMessage}
                    onChange={(e) => setAutoRejectMessage(e.target.value)}
                    placeholder="Nhập nội dung tin nhắn phản hồi tự động..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                  />
                </div>
              </div>

              {/* Meta Official Cloud Calling API (WebRTC 2-way audio) */}
              <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/40 p-4 space-y-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          Meta Cloud Calling API (Gọi WebRTC 2 chiều)
                        </span>
                        {account.has_cloud_token && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            Đã có Token
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">
                        Bật tính năng gọi đi & nghe máy WebRTC Opus 2 chiều trực tiếp trên trình duyệt qua API chính chủ Meta Business.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={cloudEnabled}
                    onClick={() => setCloudEnabled((v) => !v)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer",
                      cloudEnabled ? "bg-emerald-600" : "bg-slate-300",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5",
                        cloudEnabled ? "translate-x-5.5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>

                {cloudEnabled && (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Phone Number ID
                        </label>
                        <input
                          type="text"
                          value={cloudPhoneNumberId}
                          onChange={(e) => setCloudPhoneNumberId(e.target.value)}
                          placeholder="Vd: 109283746512345"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          WABA ID
                        </label>
                        <input
                          type="text"
                          value={cloudWabaId}
                          onChange={(e) => setCloudWabaId(e.target.value)}
                          placeholder="Vd: 201928374651234"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Meta System User Access Token{" "}
                        {account.has_cloud_token && (
                          <span className="font-normal text-slate-500">
                            (để trống để giữ nguyên token đã mã hóa)
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type={showCloudToken ? "text" : "password"}
                          value={cloudAccessToken}
                          onChange={(e) => setCloudAccessToken(e.target.value)}
                          placeholder={account.has_cloud_token ? "••••••••••••••••••••••••" : "EAAG..."}
                          className="w-full rounded-xl border border-slate-200 bg-white pl-3 pr-9 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCloudToken((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label={showCloudToken ? "Ẩn token" : "Hiện token"}
                        >
                          {showCloudToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Webhook Verify Token
                      </label>
                      <input
                        type="text"
                        value={cloudVerifyToken}
                        onChange={(e) => setCloudVerifyToken(e.target.value)}
                        placeholder="Chuỗi bí mật xác thực Webhook trên Meta App"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-white p-2.5">
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">
                        Callback URL khai báo trong Meta Developer Dashboard:
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] text-slate-800">
                          {webhookUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => void handleCopyText(webhookUrl, "webhook")}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          {copiedWebhook ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                >
                  {savingSettings ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Lưu cài đặt
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
}
