"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Globe,
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
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { whatsappService } from "@/services/whatsapp.service";
import type { ApiResponse } from "@/types/unified.types";
import type {
  WhatsAppAccount,
  WhatsAppAccountStatusResult,
  WhatsAppSettingsPatch,
} from "@/types/whatsapp";
import {
  formatAccountName,
  formatPairingCodeSpaced,
  getAccountStatusMeta,
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

const PROXY_SCHEME_RE = /^(https?|socks4|socks5h?):\/\/\S+$/i;

function isProxyHintError(message?: string | null): boolean {
  if (!message) return false;
  return /(?:\b(?:405|403|408)\b|proxy)/i.test(message);
}

function normalizePairingPhone(raw: string): {
  digits: string;
  e164Preview: string;
  valid: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { digits: "", e164Preview: "", valid: false };
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00") && digits.length > 4) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `84${digits.slice(1)}`;
  }
  const valid = digits.length >= 9 && digits.length <= 15;
  let e164Preview = "";
  if (digits) {
    if (digits.startsWith("84") && digits.length >= 10) {
      const rest = digits.slice(2);
      e164Preview = `+84 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`.trim();
    } else {
      e164Preview = `+${digits}`;
    }
  }
  return { digits, e164Preview, valid };
}

function resolveStatusMeta(status?: string | null) {
  if (status === "qr_expired") {
    return {
      label: "Mã QR hết hạn",
      dotClass: "bg-amber-500",
      badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
      isConnected: false,
    };
  }
  if (status === "reconnecting") {
    return {
      label: "Đang xác thực...",
      dotClass: "bg-sky-500 animate-pulse",
      badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
      isConnected: false,
    };
  }
  return getAccountStatusMeta(status);
}

const PROGRESS_STEPS = [
  { id: 1, label: "Khởi tạo" },
  { id: 2, label: "Chờ quét / nhập mã" },
  { id: 3, label: "Xác thực" },
  { id: 4, label: "Sẵn sàng" },
] as const;

export function WhatsAppConnectModal({
  initialTab = "qr",
  account = null,
  liveAccounts,
  onClose,
  onConnected,
  onSettingsSaved,
}: WhatsAppConnectModalProps) {
  const resolvedInitialTab: WhatsAppModalTab =
    initialTab === "settings" && !account ? "qr" : initialTab;
  const shouldAutoStartQr = resolvedInitialTab === "qr" && !account;

  const [activeTab, setActiveTab] = useState<WhatsAppModalTab>(resolvedInitialTab);

  // ── Connect state (QR & Pairing) ───────────────────────────────────────────
  const [label, setLabel] = useState(account?.label || "");
  const [phoneInput, setPhoneInput] = useState(account?.phone_number || "");
  const [workingAccountId, setWorkingAccountId] = useState<string | null>(
    resolvedInitialTab !== "settings" ? (account?.id ?? null) : null,
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(account?.qr_data_url || null);
  const [pairingCode, setPairingCode] = useState<string | null>(account?.pairing_code || null);
  const [connectStatus, setConnectStatus] = useState<string>(
    shouldAutoStartQr ? "connecting" : account?.status || "idle",
  );
  const [connectError, setConnectError] = useState<string | null>(
    !shouldAutoStartQr && account?.last_error ? account.last_error : null,
  );
  const [requesting, setRequesting] = useState<boolean>(shouldAutoStartQr);
  const [hasRequestedOnce, setHasRequestedOnce] = useState<boolean>(shouldAutoStartQr);

  // Keyed countdown state — resets dynamically on every new QR/code WITHOUT setState in useEffect
  const [qrCountdown, setQrCountdown] = useState<{ qrKey: string; remaining: number }>({
    qrKey: account?.qr_data_url || "",
    remaining: 60,
  });
  const [pairingCountdown, setPairingCountdown] = useState<{ codeKey: string; remaining: number }>({
    codeKey: account?.pairing_code || "",
    remaining: 120,
  });
  const [retryCooldownLeft, setRetryCooldownLeft] = useState(0);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // ── Proxy state (Connect tabs & Settings tab) ──────────────────────────────
  const [connectProxyInput, setConnectProxyInput] = useState("");
  const [clearConnectProxy, setClearConnectProxy] = useState(false);
  const [proxyAccordionManual, setProxyAccordionManual] = useState<boolean | null>(null);

  const [settingsProxyInput, setSettingsProxyInput] = useState("");
  const [clearSettingsProxy, setClearSettingsProxy] = useState(false);
  const [settingsProxyAccordionOpen, setSettingsProxyAccordionOpen] = useState<boolean>(
    Boolean(account?.has_proxy || account?.proxy_masked),
  );

  // ── Settings state (Call & Meta Cloud Calling API) ─────────────────────────
  const [settingsLabel, setSettingsLabel] = useState(account?.label || "");
  const [autoRejectCalls, setAutoRejectCalls] = useState(Boolean(account?.auto_reject_calls));
  const [autoRejectMessage, setAutoRejectMessage] = useState(
    account?.auto_reject_message ||
      "Xin lỗi, hiện tại mình đang bận nên chưa nghe máy được. Bạn để lại tin nhắn mình phản hồi ngay nhé!",
  );
  const [cloudEnabled, setCloudEnabled] = useState(Boolean(account?.cloud_calling_enabled));
  const [cloudPhoneNumberId, setCloudPhoneNumberId] = useState(
    account?.cloud_phone_number_id || "",
  );
  const [cloudWabaId, setCloudWabaId] = useState(account?.cloud_waba_id || "");
  const [cloudAccessToken, setCloudAccessToken] = useState("");
  const [showCloudToken, setShowCloudToken] = useState(false);
  const [cloudVerifyToken, setCloudVerifyToken] = useState(
    account?.cloud_webhook_verify_token || "",
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Guard single auto-start request across React 19 StrictMode double mount
  const autoStartPromiseRef = useRef<Promise<ApiResponse<WhatsAppAccountStatusResult>> | null>(
    null,
  );
  const activeTabRef = useRef<WhatsAppModalTab>(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Derive live SSE state for the account being connected
  const liveWorkingAccount = useMemo(
    () => (workingAccountId ? liveAccounts.find((a) => a.id === workingAccountId) ?? null : null),
    [workingAccountId, liveAccounts],
  );
  const livePropAccount = useMemo(
    () => (account?.id ? liveAccounts.find((a) => a.id === account.id) ?? account : null),
    [account, liveAccounts],
  );

  const effectiveQr =
    activeTab === "qr" ? liveWorkingAccount?.qr_data_url || qrDataUrl : null;
  const effectivePairingCode =
    activeTab === "pairing" ? liveWorkingAccount?.pairing_code || pairingCode : null;
  const effectiveStatus = liveWorkingAccount?.status || connectStatus;
  const isNowConnected = effectiveStatus === "connected";

  const savedHasProxy = Boolean(
    !clearConnectProxy &&
      (liveWorkingAccount?.has_proxy ??
        livePropAccount?.has_proxy ??
        Boolean(liveWorkingAccount?.proxy_masked || livePropAccount?.proxy_masked)),
  );
  const savedProxyMasked = !clearConnectProxy
    ? liveWorkingAccount?.proxy_masked || livePropAccount?.proxy_masked || null
    : null;

  const settingsHasProxy = Boolean(
    !clearSettingsProxy &&
      (livePropAccount?.has_proxy || Boolean(livePropAccount?.proxy_masked)),
  );
  const settingsProxyMasked = !clearSettingsProxy
    ? livePropAccount?.proxy_masked || null
    : null;

  // Always surface last_error cleanly (never hidden during qr_ready / pairing_ready)
  const effectiveError = isNowConnected
    ? null
    : connectError ||
      liveWorkingAccount?.last_error ||
      (!hasRequestedOnce ? account?.last_error ?? null : null);

  const hasProxyErrorHint = isProxyHintError(effectiveError);
  const isProxyAccordionOpen =
    proxyAccordionManual !== null ? proxyAccordionManual : hasProxyErrorHint;

  // Keyed countdown derivations (instant reset when QR or Pairing code rotates)
  const qrSecondsLeft = effectiveQr
    ? qrCountdown.qrKey === effectiveQr
      ? qrCountdown.remaining
      : 60
    : 0;
  const pairingSecondsLeft = effectivePairingCode
    ? pairingCountdown.codeKey === effectivePairingCode
      ? pairingCountdown.remaining
      : 120
    : 0;

  const isFailedStatus =
    effectiveStatus === "error" ||
    effectiveStatus === "disconnected" ||
    effectiveStatus === "logged_out";
  const isQrExpired =
    effectiveStatus === "qr_expired" ||
    (Boolean(effectiveQr) && qrSecondsLeft === 0 && !isNowConnected && !requesting);

  const isWaitingForQr =
    !isNowConnected &&
    !isFailedStatus &&
    !isQrExpired &&
    !effectiveQr &&
    (requesting ||
      (Boolean(workingAccountId) &&
        (effectiveStatus === "pending" ||
          effectiveStatus === "connecting" ||
          effectiveStatus === "reconnecting" ||
          effectiveStatus === "idle")));

  const isWaitingForPairing =
    !isNowConnected &&
    !isFailedStatus &&
    !effectivePairingCode &&
    (requesting ||
      (Boolean(workingAccountId) &&
        (effectiveStatus === "pending" ||
          effectiveStatus === "connecting" ||
          effectiveStatus === "reconnecting")));

  // 4-step progress bar state (1..4)
  const currentStep = useMemo<1 | 2 | 3 | 4>(() => {
    if (isNowConnected) return 4;
    if (
      effectiveStatus === "reconnecting" ||
      (effectiveStatus === "connecting" && (Boolean(effectiveQr) || Boolean(effectivePairingCode)))
    ) {
      return 3;
    }
    if (
      effectiveStatus === "qr_ready" ||
      effectiveStatus === "pairing_ready" ||
      (activeTab === "qr" && Boolean(effectiveQr) && !isQrExpired && !isFailedStatus) ||
      (activeTab === "pairing" && Boolean(effectivePairingCode) && !isFailedStatus)
    ) {
      return 2;
    }
    return 1;
  }, [
    isNowConnected,
    effectiveStatus,
    effectiveQr,
    effectivePairingCode,
    activeTab,
    isQrExpired,
    isFailedStatus,
  ]);

  const phonePreview = useMemo(() => normalizePairingPhone(phoneInput), [phoneInput]);

  // 1-click Auto-start QR generation on modal open for new connections (zero sync setState)
  useEffect(() => {
    if (!shouldAutoStartQr) return;
    let active = true;
    if (!autoStartPromiseRef.current) {
      autoStartPromiseRef.current = whatsappService.connectQr({});
    }
    void autoStartPromiseRef.current.then((res) => {
      if (!active || activeTabRef.current !== "qr") return;
      setRequesting(false);
      if (!res.success) {
        setConnectStatus("error");
        setConnectError(res.message || "Không thể khởi tạo phiên mã QR WhatsApp.");
        return;
      }
      const payload = res.data;
      const accId = payload?.account?.id || payload?.id || null;
      if (accId) setWorkingAccountId(accId);
      const nextStatus = payload?.status || payload?.account?.status || "connecting";
      setConnectStatus(nextStatus);
      const nextQr = payload?.qr_data_url || payload?.account?.qr_data_url || null;
      if (nextQr) {
        setQrDataUrl(nextQr);
        setQrCountdown({ qrKey: nextQr, remaining: 60 });
      }
      const nextErr = payload?.last_error || payload?.account?.last_error || null;
      if (nextErr) setConnectError(nextErr);
    });
    return () => {
      active = false;
    };
  }, [shouldAutoStartQr]);

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
      const nextQr = st.qr_data_url ?? acc?.qr_data_url ?? null;
      const nextCode = st.pairing_code ?? acc?.pairing_code ?? null;
      const nextErr = st.last_error ?? acc?.last_error ?? null;

      if (nextStatus) {
        setConnectStatus(nextStatus);
        if (
          nextStatus === "error" ||
          nextStatus === "disconnected" ||
          nextStatus === "logged_out" ||
          nextStatus === "qr_expired"
        ) {
          setRequesting(false);
        }
      }
      if (activeTab === "qr" && nextQr) {
        setQrDataUrl(nextQr);
      }
      if (activeTab === "pairing" && nextCode) {
        setPairingCode(nextCode);
      }
      if (nextErr) {
        setConnectError(nextErr);
      } else if (nextStatus === "connected") {
        setConnectError(null);
      }
    };

    const intervalId = window.setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [workingAccountId, activeTab, isNowConnected]);

  // QR 60s countdown tick (keyed to current QR string — auto-resets on rotation)
  useEffect(() => {
    if (
      !effectiveQr ||
      activeTab !== "qr" ||
      isNowConnected ||
      isFailedStatus ||
      effectiveStatus === "qr_expired"
    ) {
      return;
    }
    const currentQr = effectiveQr;
    const id = window.setInterval(() => {
      setQrCountdown((prev) => {
        if (prev.qrKey !== currentQr) {
          return { qrKey: currentQr, remaining: 59 };
        }
        return { qrKey: currentQr, remaining: prev.remaining > 0 ? prev.remaining - 1 : 0 };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [effectiveQr, activeTab, isNowConnected, isFailedStatus, effectiveStatus]);

  // Pairing code 120s countdown tick (keyed to current pairing code)
  useEffect(() => {
    if (!effectivePairingCode || activeTab !== "pairing" || isNowConnected || isFailedStatus) {
      return;
    }
    const currentCode = effectivePairingCode;
    const id = window.setInterval(() => {
      setPairingCountdown((prev) => {
        if (prev.codeKey !== currentCode) {
          return { codeKey: currentCode, remaining: 119 };
        }
        return { codeKey: currentCode, remaining: prev.remaining > 0 ? prev.remaining - 1 : 0 };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [effectivePairingCode, activeTab, isNowConnected, isFailedStatus]);

  // 15s anti-429 retry cooldown ticker for Pairing Code requests
  useEffect(() => {
    if (retryCooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      setRetryCooldownLeft((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [retryCooldownLeft]);

  const resolveProxyForConnect = useCallback((): {
    proxyUrl: string | undefined;
    error: string | null;
  } => {
    const trimmed = connectProxyInput.trim();
    if (trimmed) {
      if (!PROXY_SCHEME_RE.test(trimmed)) {
        return {
          proxyUrl: undefined,
          error:
            "Định dạng Proxy không hợp lệ. Vui lòng nhập dạng http://user:pass@host:port hoặc socks5://user:pass@host:port.",
        };
      }
      return { proxyUrl: trimmed, error: null };
    }
    if (clearConnectProxy) {
      return { proxyUrl: "", error: null };
    }
    return { proxyUrl: undefined, error: null };
  }, [connectProxyInput, clearConnectProxy]);

  const handleSwitchTab = (nextTab: WhatsAppModalTab) => {
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    if (nextTab === "qr" || nextTab === "pairing") {
      // Reset stale workingAccountId & transient connect state between qr <-> pairing
      setWorkingAccountId(null);
      setQrDataUrl(null);
      setPairingCode(null);
      setConnectError(null);
      setConnectStatus("idle");
      setRequesting(false);
    }
  };

  const handleStartQr = useCallback(async () => {
    const { proxyUrl, error: proxyErr } = resolveProxyForConnect();
    if (proxyErr) {
      setConnectError(proxyErr);
      setProxyAccordionManual(true);
      return;
    }

    setHasRequestedOnce(true);
    setRequesting(true);
    setConnectError(null);
    setQrDataUrl(null);
    setConnectStatus("connecting");

    const payload: { label?: string; account_id?: string; proxy_url?: string } = {
      label: label.trim() || undefined,
      account_id: workingAccountId || account?.id || undefined,
    };
    if (proxyUrl !== undefined) {
      payload.proxy_url = proxyUrl;
    }

    const res = await whatsappService.connectQr(payload);
    setRequesting(false);
    if (!res.success) {
      setConnectStatus("error");
      setConnectError(res.message || "Không thể khởi tạo phiên mã QR WhatsApp.");
      return;
    }
    const data = res.data;
    const accId = data?.account?.id || data?.id || workingAccountId || account?.id || null;
    if (accId) setWorkingAccountId(accId);
    const nextStatus = data?.status || data?.account?.status || "connecting";
    setConnectStatus(nextStatus);
    const nextQr = data?.qr_data_url || data?.account?.qr_data_url || null;
    if (nextQr) {
      setQrDataUrl(nextQr);
      setQrCountdown({ qrKey: nextQr, remaining: 60 });
    }
    const nextErr = data?.last_error || data?.account?.last_error || null;
    if (nextErr) setConnectError(nextErr);
    if (proxyUrl === "") {
      setClearConnectProxy(false);
    }
  }, [label, workingAccountId, account?.id, resolveProxyForConnect]);

  const handleStartPairing = useCallback(async () => {
    if (retryCooldownLeft > 0) return;

    const { digits, valid } = normalizePairingPhone(phoneInput);
    if (!valid) {
      setConnectError(
        "Vui lòng nhập số điện thoại hợp lệ kèm mã quốc gia (vd: 0901234567 hoặc 84901234567).",
      );
      return;
    }

    const { proxyUrl, error: proxyErr } = resolveProxyForConnect();
    if (proxyErr) {
      setConnectError(proxyErr);
      setProxyAccordionManual(true);
      return;
    }

    setHasRequestedOnce(true);
    setRequesting(true);
    setRetryCooldownLeft(15);
    setConnectError(null);
    setPairingCode(null);
    setConnectStatus("connecting");

    const payload: {
      phone_number: string;
      label?: string;
      account_id?: string;
      proxy_url?: string;
    } = {
      phone_number: digits,
      label: label.trim() || undefined,
      account_id: workingAccountId || account?.id || undefined,
    };
    if (proxyUrl !== undefined) {
      payload.proxy_url = proxyUrl;
    }

    const res = await whatsappService.connectPairing(payload);
    setRequesting(false);
    if (!res.success) {
      setConnectStatus("error");
      setConnectError(res.message || "Không thể lấy mã ghép nối 8 ký tự.");
      return;
    }
    const data = res.data;
    const accId = data?.account?.id || data?.id || workingAccountId || account?.id || null;
    if (accId) setWorkingAccountId(accId);
    const nextStatus = data?.status || data?.account?.status || "connecting";
    setConnectStatus(nextStatus);
    const code = data?.pairing_code || data?.account?.pairing_code || null;
    if (code) {
      setPairingCode(code);
      setPairingCountdown({ codeKey: code, remaining: 120 });
    }
    const nextErr = data?.last_error || data?.account?.last_error || null;
    if (nextErr) setConnectError(nextErr);
    if (proxyUrl === "") {
      setClearConnectProxy(false);
    }
  }, [phoneInput, label, workingAccountId, account?.id, retryCooldownLeft, resolveProxyForConnect]);

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

      const trimmedProxy = settingsProxyInput.trim();
      if (trimmedProxy && !PROXY_SCHEME_RE.test(trimmedProxy)) {
        toast.error(
          "Proxy không hợp lệ. Dùng định dạng http://user:pass@host:port hoặc socks5://user:pass@host:port.",
        );
        return;
      }

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
      if (trimmedProxy) {
        patch.proxy_url = trimmedProxy;
      } else if (clearSettingsProxy) {
        patch.proxy_url = "";
      }

      const res = await whatsappService.updateAccountSettings(account.id, patch);
      setSavingSettings(false);
      if (!res.success) {
        toast.error(res.message || "Lưu cài đặt WhatsApp thất bại.");
        return;
      }
      toast.success("Đã lưu cài đặt tài khoản, Proxy & cuộc gọi WhatsApp.");
      if (res.data) {
        onSettingsSaved(res.data);
      } else {
        onSettingsSaved({
          ...account,
          label: patch.label,
          auto_reject_calls: patch.auto_reject_calls,
          auto_reject_message: patch.auto_reject_message,
          cloud_calling_enabled: patch.cloud_calling_enabled,
          cloud_phone_number_id: patch.cloud_phone_number_id,
          cloud_waba_id: patch.cloud_waba_id,
          cloud_webhook_verify_token: patch.cloud_webhook_verify_token,
          has_cloud_token: account.has_cloud_token || Boolean(cloudAccessToken.trim()),
          has_proxy:
            patch.proxy_url === ""
              ? false
              : patch.proxy_url
                ? true
                : account.has_proxy,
          proxy_masked:
            patch.proxy_url === ""
              ? null
              : account.proxy_masked,
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
      settingsProxyInput,
      clearSettingsProxy,
      onSettingsSaved,
      onClose,
    ],
  );

  const statusMeta = resolveStatusMeta(effectiveStatus);
  const webhookUrl = whatsappService.webhookUrlHint();

  const renderConnectProxyAccordion = () => (
    <div
      className={cn(
        "rounded-2xl border transition-colors",
        hasProxyErrorHint
          ? "border-amber-300 bg-amber-50/60"
          : "border-slate-200 bg-slate-50/60",
      )}
    >
      <button
        type="button"
        onClick={() => setProxyAccordionManual(!isProxyAccordionOpen)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Globe
            className={cn(
              "h-4 w-4 shrink-0",
              hasProxyErrorHint ? "text-amber-600" : "text-slate-500",
            )}
          />
          <span className="truncate text-xs font-semibold text-slate-800">
            Cấu hình Proxy riêng (tùy chọn — dùng nếu IP VPS bị hạn chế)
          </span>
          {savedHasProxy && (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              Đã cấu hình
            </span>
          )}
        </div>
        {isProxyAccordionOpen ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>

      {isProxyAccordionOpen && (
        <div className="space-y-2.5 border-t border-slate-200/80 px-3.5 py-3">
          {hasProxyErrorHint && (
            <div className="rounded-xl border border-amber-300 bg-amber-100/80 px-3 py-2 text-[11px] font-medium text-amber-950">
              💡 IP máy chủ có thể đang bị WhatsApp giới hạn (lỗi 405/403/408). Hãy nhập Proxy riêng
              (Residential/4G) rồi bấm thử tạo lại mã!
            </div>
          )}

          {savedHasProxy && savedProxyMasked && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs">
              <div className="min-w-0 truncate">
                <span className="text-slate-500">Proxy đang lưu: </span>
                <code className="font-mono font-semibold text-emerald-800">
                  {savedProxyMasked}
                </code>
              </div>
              <button
                type="button"
                onClick={() => {
                  setClearConnectProxy(true);
                  setConnectProxyInput("");
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                Xóa Proxy
              </button>
            </div>
          )}

          {clearConnectProxy && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              <span>Proxy cũ sẽ bị xóa khi bạn bấm Tạo mã / Ghép nối.</span>
              <button
                type="button"
                onClick={() => setClearConnectProxy(false)}
                className="font-bold underline cursor-pointer"
              >
                Hoàn tác
              </button>
            </div>
          )}

          <div>
            <input
              type="text"
              value={connectProxyInput}
              onChange={(e) => {
                setConnectProxyInput(e.target.value);
                if (e.target.value.trim()) setClearConnectProxy(false);
              }}
              placeholder="http://user:pass@host:port hoặc socks5://user:pass@host:port"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Hỗ trợ HTTP/HTTPS và SOCKS5. Để trống sẽ giữ nguyên Proxy đã lưu (hoặc kết nối trực
              tiếp).
            </p>
          </div>
        </div>
      )}
    </div>
  );

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
                  ? "Proxy riêng, tự động từ chối cuộc gọi & Meta Cloud Calling API"
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

        {/* Zone A — Pinned Emerald Multi-Device Safety Pill */}
        <div className="border-b border-emerald-200 bg-emerald-50/95 px-5 py-2.5 text-xs font-medium text-emerald-900">
          ✅ Độc lập 4 thiết bị (Multi-Device) — Thoải mái dùng hoặc đăng xuất WhatsApp PC/Web mà
          KHÔNG làm rớt phiên hệ thống.
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-slate-200 bg-slate-50/80 px-3 pt-2 gap-1">
          <button
            type="button"
            onClick={() => handleSwitchTab("qr")}
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
            onClick={() => handleSwitchTab("pairing")}
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
              onClick={() => handleSwitchTab("settings")}
              className={cn(
                "flex items-center gap-1.5 rounded-t-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer",
                activeTab === "settings"
                  ? "bg-white text-emerald-700 border border-b-white border-slate-200 -mb-px"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <PhoneCall className="h-3.5 w-3.5" />
              Proxy, Cuộc gọi &amp; Cloud API
            </button>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[72vh] overflow-y-auto p-5">
          {/* Zone B — 4-Step Live Progress Bar (QR & Pairing Tabs) */}
          {activeTab !== "settings" && (
            <div className="mb-4 rounded-2xl border border-slate-200/90 bg-slate-50/70 px-3.5 py-3">
              <div className="grid grid-cols-4 gap-2">
                {PROGRESS_STEPS.map((step) => {
                  const isDone = currentStep > step.id || isNowConnected;
                  const isActive = currentStep === step.id && !isNowConnected;
                  const isStepError = isActive && (isFailedStatus || isQrExpired);
                  return (
                    <div key={step.id} className="flex flex-col items-center text-center gap-1">
                      <div
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition",
                          isDone
                            ? "bg-emerald-600 text-white"
                            : isStepError
                              ? "bg-rose-600 text-white"
                              : isActive
                                ? "bg-emerald-100 text-emerald-800 ring-2 ring-emerald-500"
                                : "bg-slate-200 text-slate-500",
                        )}
                      >
                        {isDone ? <Check className="h-3.5 w-3.5" /> : step.id}
                      </div>
                      <span
                        className={cn(
                          "text-[10.5px] leading-tight font-semibold",
                          isDone
                            ? "text-emerald-700"
                            : isStepError
                              ? "text-rose-700"
                              : isActive
                                ? "text-slate-900"
                                : "text-slate-400",
                        )}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 1: QR CODE */}
          {activeTab === "qr" && (
            <div className="space-y-4">
              {isNowConnected ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/70 py-10 text-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-600 mb-2" />
                  <p className="text-base font-bold text-emerald-900">
                    Đã kết nối WhatsApp thành công!
                  </p>
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
                      ) : effectiveQr || isQrExpired ? (
                        <RefreshCw className="h-4 w-4" />
                      ) : (
                        <QrCode className="h-4 w-4" />
                      )}
                      <span>
                        {isQrExpired
                          ? "Tạo mã QR mới"
                          : effectiveQr
                            ? "Làm mới mã QR"
                            : "Tạo mã QR"}
                      </span>
                    </button>
                  </div>

                  {effectiveError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                      <span className="break-words">{effectiveError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-[224px_1fr] gap-5 items-center rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-col items-center justify-center">
                      <div className="relative flex h-52 w-52 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xs">
                        {effectiveQr ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={effectiveQr}
                              alt="WhatsApp QR Code"
                              className={cn(
                                "h-full w-full object-contain transition",
                                isQrExpired && "opacity-25 blur-[2px]",
                              )}
                            />
                            {isQrExpired && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 p-4 text-center backdrop-blur-[1px]">
                                <AlertTriangle className="h-7 w-7 text-amber-600 mb-1.5" />
                                <p className="text-xs font-bold text-slate-800 mb-2">
                                  Mã QR đã hết hạn
                                </p>
                                <button
                                  type="button"
                                  onClick={() => void handleStartQr()}
                                  disabled={requesting}
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Tạo mã QR mới
                                </button>
                              </div>
                            )}
                          </>
                        ) : isWaitingForQr ? (
                          <div className="flex flex-col items-center gap-2 text-center px-4">
                            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                            <span className="text-xs font-medium text-slate-600">
                              Đang khởi tạo mã QR từ WhatsApp...
                            </span>
                          </div>
                        ) : isQrExpired ? (
                          <div className="flex flex-col items-center gap-2 text-center px-4">
                            <AlertTriangle className="h-8 w-8 text-amber-500" />
                            <span className="text-xs font-semibold text-slate-700">
                              Mã QR đã hết hạn
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleStartQr()}
                              disabled={requesting}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Tạo mã QR mới
                            </button>
                          </div>
                        ) : isFailedStatus ? (
                          <div className="flex flex-col items-center gap-2 text-center px-4">
                            <AlertTriangle className="h-8 w-8 text-rose-500" />
                            <span className="text-xs font-semibold text-rose-700">
                              {statusMeta.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleStartQr()}
                              disabled={requesting}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Thử tạo mã QR lại
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-center px-4 text-slate-400">
                            <QrCode className="h-12 w-12 opacity-40" />
                            <span className="text-xs">
                              Nhấn &ldquo;Tạo mã QR&rdquo; để bắt đầu liên kết
                            </span>
                          </div>
                        )}
                      </div>

                      {effectiveQr && !isQrExpired && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-slate-600">
                          <span className={cn("h-2 w-2 rounded-full", statusMeta.dotClass)} />
                          <span>Tự làm mới sau {qrSecondsLeft}s</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5 text-xs text-slate-700">
                      <p className="font-bold text-slate-900 text-sm">
                        Hướng dẫn quét trên điện thoại:
                      </p>
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
                        Phiên đăng nhập được lưu cục bộ an toàn và tự động đồng bộ tin nhắn, danh bạ
                        theo thời gian thực.
                      </div>
                    </div>
                  </div>

                  {/* Zone C — Collapsible Sticky Proxy Accordion */}
                  {renderConnectProxyAccordion()}
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
                  <p className="text-base font-bold text-emerald-900">
                    Ghép nối WhatsApp thành công!
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    Đang chuyển vào giao diện trò chuyện...
                  </p>
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
                        placeholder="Vd: 0901234567 hoặc 84901234567"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                      />
                      {phoneInput.trim() ? (
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono font-semibold",
                              phonePreview.valid
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-amber-200 bg-amber-50 text-amber-800",
                            )}
                          >
                            {phonePreview.valid ? "✓ E.164:" : "Đang nhập:"}{" "}
                            {phonePreview.e164Preview || "..."}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Tự động chuẩn hóa đầu 0 Việt Nam sang +84 (E.164).
                        </p>
                      )}
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

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      {retryCooldownLeft > 0
                        ? `Chống giới hạn tần suất (429): chờ ${retryCooldownLeft}s trước khi yêu cầu mã mới`
                        : "Hiệu lực mã ghép nối: 120 giây sau khi tạo"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleStartPairing()}
                      disabled={requesting || retryCooldownLeft > 0}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition cursor-pointer"
                    >
                      {requesting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <KeyRound className="h-4 w-4" />
                      )}
                      <span>
                        {requesting
                          ? "Đang tạo mã 8 ký tự..."
                          : retryCooldownLeft > 0
                            ? `Thử lại sau ${retryCooldownLeft}s`
                            : effectivePairingCode
                              ? "Lấy lại mã 8 ký tự"
                              : "Lấy mã ghép nối 8 ký tự"}
                      </span>
                    </button>
                  </div>

                  {effectiveError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                      <span className="break-words">{effectiveError}</span>
                    </div>
                  )}

                  {effectivePairingCode ? (
                    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 p-5 text-center space-y-3">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-0.5 text-[11px] font-bold text-emerald-800">
                          <Sparkles className="h-3.5 w-3.5" />
                          Nhập mã này trên điện thoại WhatsApp của bạn
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
                            pairingSecondsLeft > 0
                              ? "border-emerald-200 bg-white text-emerald-700"
                              : "border-amber-300 bg-amber-50 text-amber-800",
                          )}
                        >
                          {pairingSecondsLeft > 0
                            ? `Hết hạn sau ${pairingSecondsLeft}s`
                            : "Mã đã hết hạn — bấm Lấy lại mã"}
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-3">
                        <div className="rounded-xl border border-emerald-300 bg-white px-6 py-3 font-mono text-3xl font-extrabold tracking-[0.22em] text-slate-900 shadow-2xs select-all">
                          {formatPairingCodeSpaced(effectivePairingCode)}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyText(effectivePairingCode, "code")}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3.5 py-3 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                        >
                          {copiedCode ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          {copiedCode ? "Đã copy" : "Copy"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-600">
                        Trên điện thoại:{" "}
                        <strong>
                          Thiết bị đã liên kết → Liên kết thiết bị → Liên kết bằng số điện thoại
                        </strong>{" "}
                        rồi nhập 8 ký tự trên.
                      </p>
                    </div>
                  ) : isWaitingForPairing ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 text-center">
                      <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
                      <p className="text-xs font-bold text-emerald-900">
                        Đang tạo mã 8 ký tự...
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Đang kết nối máy chủ WhatsApp và chờ phản hồi mã ghép nối cho số{" "}
                        <span className="font-mono font-semibold text-slate-700">
                          {phonePreview.e164Preview || phoneInput}
                        </span>
                        .
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-600 space-y-1.5">
                      <p className="font-semibold text-slate-800">
                        Khi nào nên dùng Mã ghép nối 8 ký tự?
                      </p>
                      <p>
                        Rất tiện khi điện thoại không tiện quét camera hoặc bạn đang đăng nhập từ xa
                        qua máy chủ. WhatsApp sẽ gửi thông báo trực tiếp lên điện thoại để bạn nhập
                        mã 8 ký tự.
                      </p>
                    </div>
                  )}

                  {/* Zone C — Collapsible Sticky Proxy Accordion */}
                  {renderConnectProxyAccordion()}
                </>
              )}
            </div>
          )}

          {/* TAB 3: SETTINGS (PROXY, CALLS & META CLOUD CALLING API) */}
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

              {/* Zone C in Settings — Collapsible Sticky Proxy Accordion */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70">
                <button
                  type="button"
                  onClick={() => setSettingsProxyAccordionOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="h-4 w-4 shrink-0 text-emerald-700" />
                    <span className="truncate text-xs font-bold text-slate-900">
                      Cấu hình Proxy riêng (tùy chọn — dùng nếu IP VPS bị hạn chế)
                    </span>
                    {settingsHasProxy && (
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        Đang bật
                      </span>
                    )}
                  </div>
                  {settingsProxyAccordionOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                </button>

                {settingsProxyAccordionOpen && (
                  <div className="space-y-2.5 border-t border-slate-200 px-4 py-3">
                    {settingsHasProxy && settingsProxyMasked && (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs">
                        <div className="min-w-0 truncate">
                          <span className="text-slate-500">Proxy hiện tại: </span>
                          <code className="font-mono font-semibold text-emerald-800">
                            {settingsProxyMasked}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setClearSettingsProxy(true);
                            setSettingsProxyInput("");
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                          Xóa Proxy
                        </button>
                      </div>
                    )}

                    {clearSettingsProxy && (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
                        <span>Proxy sẽ bị gỡ khi bấm Lưu cài đặt.</span>
                        <button
                          type="button"
                          onClick={() => setClearSettingsProxy(false)}
                          className="font-bold underline cursor-pointer"
                        >
                          Hoàn tác
                        </button>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        URL Proxy mới{" "}
                        {settingsHasProxy && (
                          <span className="font-normal text-slate-500">
                            (để trống để giữ nguyên Proxy đang mã hóa)
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={settingsProxyInput}
                        onChange={(e) => {
                          setSettingsProxyInput(e.target.value);
                          if (e.target.value.trim()) setClearSettingsProxy(false);
                        }}
                        placeholder="http://user:pass@host:port hoặc socks5://user:pass@host:port"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Khi thay đổi Proxy trên tài khoản đang chạy, bridge sẽ tự khởi động lại với
                        Proxy mới.
                      </p>
                    </div>
                  </div>
                )}
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
                        Khi có khách gọi tới số cá nhân (Baileys), tự động từ chối và nhắn tin phản
                        hồi lịch sự.
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
                        Bật tính năng gọi đi &amp; nghe máy WebRTC Opus 2 chiều trực tiếp trên trình
                        duyệt qua API chính chủ Meta Business.
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
                          placeholder={
                            account.has_cloud_token ? "••••••••••••••••••••••••" : "EAAG..."
                          }
                          className="w-full rounded-xl border border-slate-200 bg-white pl-3 pr-9 py-1.5 text-xs font-mono outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCloudToken((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label={showCloudToken ? "Ẩn token" : "Hiện token"}
                        >
                          {showCloudToken ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
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
                          {copiedWebhook ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
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
