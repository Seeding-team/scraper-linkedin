"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Globe,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { API_BASE_URL, API_KEY } from "@/lib/env";
import { cn } from "@/lib/utils";
import { ensureZaloExtensionBridge } from "@/lib/zaloExtensionClient";
import type { ZaloAccountSummary } from "@/lib/types";
import {
  cancelZaloQrLogin,
  getZaloQrStatus,
  importZaloSessionViaExtension,
  isZaloExtensionAvailable,
  startZaloQrLogin,
  type ZaloQrSessionStatus,
  type ZaloQrStatusResponse,
} from "@/services/zalo-extension.service";

export type ZaloModalConnectTab = "qr" | "extension";

interface Props {
  onClose: () => void;
  onChanged?: () => void;
  initialAccountId?: string | null;
  initialTab?: ZaloModalConnectTab;
}

interface NoticeMessage {
  text: string;
  isError?: boolean;
  actionUrl?: string;
  actionLabel?: string;
}

interface RawZaloAccountItem {
  account_id: string;
  label?: string | null;
  phone?: string | null;
  owner_id?: string | null;
  has_auth?: boolean;
  cookie_expiring_soon?: boolean;
  cookie_expires_at?: string | null;
  conflict_type?: string | null;
  web_slot_conflict?: boolean;
  has_proxy?: boolean;
  proxy_masked?: string | null;
  listener?: {
    running?: boolean;
    connected?: boolean;
    auth_expired?: boolean;
    last_error?: string | null;
    cookie_expiring_soon?: boolean;
    cookie_expires_at?: string | null;
    conflict_type?: string | null;
    web_slot_conflict?: boolean;
    has_proxy?: boolean;
    proxy_masked?: string | null;
  } | null;
}

interface EnrichedZaloAccount extends ZaloAccountSummary {
  has_auth: boolean;
  auth_expired: boolean;
  cookie_expiring_soon: boolean;
  cookie_expires_at?: string | null;
  web_slot_conflict: boolean;
  has_proxy: boolean;
  proxy_masked?: string | null;
}

const PROXY_SCHEME_RE = /^(https?|socks4|socks5h?):\/\/\S+$/i;

function isZaloProxyErrorHint(msg?: string | null): boolean {
  if (!msg) return false;
  return /(?:\b(?:403|405|408|429)\b|proxy|timeout|timed out|blocked|ip)/i.test(msg);
}

function buildApiHeaders(): Record<string, string> {
  const callerEmail =
    typeof window !== "undefined" ? window.localStorage?.getItem("app_user_email") : null;
  const headers: Record<string, string> = {};
  if (API_KEY) headers["x-api-key"] = API_KEY;
  if (callerEmail) headers["X-Caller-Email"] = callerEmail;
  return headers;
}

function normalizeRawAccounts(rawAccounts: RawZaloAccountItem[]): EnrichedZaloAccount[] {
  return rawAccounts.map((a) => {
    const isExpired = Boolean(a.listener?.auth_expired);
    const isOnline = Boolean(a.listener?.connected);
    const hasAuth = Boolean(a.has_auth);
    const lastErr = a.listener?.last_error || null;
    const isConflict = Boolean(
      a.web_slot_conflict ||
        a.conflict_type === "web_slot_conflict" ||
        a.listener?.web_slot_conflict ||
        a.listener?.conflict_type === "web_slot_conflict" ||
        (lastErr &&
          /web_slot_conflict|DuplicateConnection|Overlimit|cmd=3000|3003|chat\.zalo\.me/i.test(
            lastErr,
          )),
    );

    let status: "connected" | "waiting_qr" | "disconnected" | "error" = "disconnected";
    if (isExpired) status = "error";
    else if (isConflict && !isOnline) status = "disconnected";
    else if (isOnline || hasAuth) status = "connected";

    const proxyMasked = a.proxy_masked || a.listener?.proxy_masked || null;
    const hasProxy = Boolean(a.has_proxy || a.listener?.has_proxy || proxyMasked);

    return {
      account_id: a.account_id,
      display_name: a.label || a.account_id,
      status,
      has_auth: hasAuth,
      auth_expired: isExpired,
      is_ws_connected: isOnline,
      phone: a.phone || null,
      owner_staff_id: a.owner_id || null,
      last_error: lastErr,
      cookie_expiring_soon: Boolean(
        a.cookie_expiring_soon || a.listener?.cookie_expiring_soon,
      ),
      cookie_expires_at: a.cookie_expires_at || a.listener?.cookie_expires_at || null,
      web_slot_conflict: isConflict,
      has_proxy: hasProxy,
      proxy_masked: proxyMasked,
    };
  });
}

function isQrSessionActive(status: ZaloQrSessionStatus | "idle"): boolean {
  return status === "starting" || status === "qr_ready" || status === "scanned";
}

export function ZaloAccountsModal({
  onClose,
  onChanged,
  initialAccountId = null,
  initialTab = "qr",
}: Props) {
  const [activeTab, setActiveTab] = useState<ZaloModalConnectTab>(initialTab);
  const [accounts, setAccounts] = useState<EnrichedZaloAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [message, setMessage] = useState<NoticeMessage | null>(null);

  // ── Tab 1: Server-Side Zalo QR State ───────────────────────────────────────
  const [selectedQrAccountId, setSelectedQrAccountId] = useState<string>(initialAccountId || "");
  const [newQrLabel, setNewQrLabel] = useState("");
  const [qrProxyInput, setQrProxyInput] = useState("");
  const [qrProxyAccordionManual, setQrProxyAccordionManual] = useState<boolean | null>(null);
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<ZaloQrSessionStatus | "idle">("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrAttempt, setQrAttempt] = useState(1);
  const [qrMaxAttempts, setQrMaxAttempts] = useState(3);
  const [qrExpiresBase, setQrExpiresBase] = useState(100);
  const [qrHasProxy, setQrHasProxy] = useState(false);
  const [qrProxyMasked, setQrProxyMasked] = useState<string | null>(null);
  const [qrScannedUser, setQrScannedUser] = useState<{
    display_name?: string | null;
    avatar?: string | null;
  } | null>(null);
  const [qrConfirmedInfo, setQrConfirmedInfo] = useState<{
    account_id?: string | null;
    display_name?: string | null;
    avatar?: string | null;
  } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [startingQr, setStartingQr] = useState(false);

  // Keyed countdown state (zero set-state-in-effect)
  const [qrCountdown, setQrCountdown] = useState<{ qrKey: string; remaining: number }>({
    qrKey: "",
    remaining: 100,
  });

  const activeQrSessionIdRef = useRef<string | null>(null);
  const activeQrStatusRef = useRef<ZaloQrSessionStatus | "idle">("idle");

  useEffect(() => {
    activeQrSessionIdRef.current = qrSessionId;
  }, [qrSessionId]);

  useEffect(() => {
    activeQrStatusRef.current = qrStatus;
  }, [qrStatus]);

  const cancelActiveQrSession = useCallback(async (explicitId?: string | null) => {
    const sid = explicitId ?? activeQrSessionIdRef.current;
    if (!sid) return;
    if (!explicitId && !isQrSessionActive(activeQrStatusRef.current)) return;
    activeQrSessionIdRef.current = null;
    try {
      await cancelZaloQrLogin(sid);
    } catch {
      // ignore cancel errors on close/unmount
    }
  }, []);

  // Cancel any active QR session on unmount
  useEffect(() => {
    return () => {
      const sid = activeQrSessionIdRef.current;
      if (sid && isQrSessionActive(activeQrStatusRef.current)) {
        void cancelZaloQrLogin(sid).catch(() => {});
      }
    };
  }, []);

  const fetchAccountList = useCallback(async (): Promise<EnrichedZaloAccount[]> => {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/zalo/accounts?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "include",
      headers: buildApiHeaders(),
    });
    const data = (await res.json()) as { accounts?: RawZaloAccountItem[] };
    const rawAccounts = Array.isArray(data?.accounts) ? data.accounts : [];
    return normalizeRawAccounts(rawAccounts);
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const list = await fetchAccountList();
      setAccounts(list);
    } catch (e: unknown) {
      setMessage({
        text: e instanceof Error ? e.message : "Không thể tải danh sách tài khoản.",
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  }, [fetchAccountList]);

  useEffect(() => {
    ensureZaloExtensionBridge();
    let mounted = true;
    void fetchAccountList()
      .then((list) => {
        if (mounted) {
          setAccounts(list);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (mounted) {
          setMessage({
            text: e instanceof Error ? e.message : "Không thể tải danh sách tài khoản.",
            isError: true,
          });
          setLoading(false);
        }
      });

    const onStep = (e: Event) => {
      const detail = (e as CustomEvent<{ step?: string; details?: { hasLoginToken?: boolean } }>)
        .detail;
      if (!detail) return;
      if (detail.step === "import.waiting_for_login_cookies") {
        setMessage({
          text: "⏳ Đang chờ bạn quét mã QR hoặc xác nhận đăng nhập Zalo trên tab Extension vừa mở (tab sẽ tự đóng sau khi đồng bộ)...",
        });
      } else if (detail.step === "import.wait_done" && detail.details?.hasLoginToken) {
        setMessage({
          text: "⚡ Đã xác thực đăng nhập! Đang chuyển giao phiên về máy chủ Seeding...",
        });
      } else if (detail.step === "import.success") {
        setMessage({
          text: "✅ Đã nạp phiên Zalo thành công! Tab chat.zalo.me tự động đóng và hệ thống đang kích hoạt kết nối...",
        });
      }
    };

    window.addEventListener("zalo-ext-step", onStep);
    return () => {
      mounted = false;
      window.removeEventListener("zalo-ext-step", onStep);
    };
  }, [fetchAccountList]);

  const handleCloseModal = useCallback(() => {
    void cancelActiveQrSession();
    onClose();
  }, [cancelActiveQrSession, onClose]);

  const handleStartServerQr = useCallback(
    async (overrideAccountId?: string) => {
      const trimmedProxy = qrProxyInput.trim();
      if (trimmedProxy && !PROXY_SCHEME_RE.test(trimmedProxy)) {
        setQrError(
          "Định dạng Proxy không hợp lệ. Vui lòng nhập dạng http://user:pass@host:port hoặc socks5://user:pass@host:port.",
        );
        setQrProxyAccordionManual(true);
        return;
      }

      if (activeQrSessionIdRef.current && isQrSessionActive(activeQrStatusRef.current)) {
        await cancelActiveQrSession(activeQrSessionIdRef.current);
      }

      const targetAccId =
        overrideAccountId !== undefined ? overrideAccountId : selectedQrAccountId;
      if (overrideAccountId !== undefined) {
        setSelectedQrAccountId(overrideAccountId);
      }

      setStartingQr(true);
      setQrError(null);
      setQrDataUrl(null);
      setQrScannedUser(null);
      setQrConfirmedInfo(null);
      setQrStatus("starting");
      setQrSessionId(null);

      try {
        const res = await startZaloQrLogin({
          account_id: targetAccId || undefined,
          label: !targetAccId && newQrLabel.trim() ? newQrLabel.trim() : undefined,
          proxy_url: trimmedProxy || undefined,
        });
        setQrSessionId(res.qr_session_id);
        setQrStatus(res.status || "starting");
        setQrAttempt(res.attempt || 1);
        setQrMaxAttempts(res.max_attempts || 3);
        const expires = res.expires_in_s || 100;
        setQrExpiresBase(expires);
        setQrHasProxy(Boolean(res.has_proxy || res.proxy_masked));
        setQrProxyMasked(res.proxy_masked || null);
        if (res.qr_data_url) {
          setQrDataUrl(res.qr_data_url);
          setQrCountdown({ qrKey: res.qr_data_url, remaining: expires });
        }
        if (res.error) {
          setQrError(res.error);
        }
      } catch (err: unknown) {
        setQrStatus("error");
        setQrError(err instanceof Error ? err.message : "Không thể khởi tạo phiên QR Zalo.");
      } finally {
        setStartingQr(false);
      }
    },
    [qrProxyInput, selectedQrAccountId, newQrLabel, cancelActiveQrSession],
  );

  // Poll /api/all-platform/zalo/auth/qr/status/{id} every 1.8s while session is active
  useEffect(() => {
    if (!qrSessionId || !isQrSessionActive(qrStatus)) return;
    let cancelled = false;

    const applyStatus = (st: ZaloQrStatusResponse) => {
      setQrStatus(st.status);
      if (typeof st.attempt === "number" && st.attempt > 0) setQrAttempt(st.attempt);
      if (typeof st.max_attempts === "number" && st.max_attempts > 0) {
        setQrMaxAttempts(st.max_attempts);
      }
      if (typeof st.expires_in_s === "number" && st.expires_in_s > 0) {
        setQrExpiresBase(st.expires_in_s);
      }
      if (st.qr_data_url) {
        setQrDataUrl(st.qr_data_url);
      }
      if (st.has_proxy !== undefined) setQrHasProxy(Boolean(st.has_proxy));
      if (st.proxy_masked !== undefined) setQrProxyMasked(st.proxy_masked || null);

      if (st.status === "scanned") {
        setQrScannedUser(st.scanned_user || { display_name: st.display_name, avatar: st.avatar });
      }
      if (st.status === "confirmed") {
        setQrConfirmedInfo({
          account_id: st.account_id,
          display_name: st.display_name || st.scanned_user?.display_name,
          avatar: st.avatar || st.scanned_user?.avatar,
        });
        setQrError(null);
        setMessage({
          text: `✅ Đăng nhập Zalo thành công (${st.display_name || st.account_id || "Zalo"})! Phiên đã được lưu an toàn trên máy chủ.`,
        });
        void loadAccounts();
        onChanged?.();
      }
      if (st.error) {
        setQrError(st.error);
      }
    };

    const pollOnce = async () => {
      try {
        const st = await getZaloQrStatus(qrSessionId);
        if (cancelled) return;
        applyStatus(st);
      } catch (err: unknown) {
        if (cancelled) return;
        setQrStatus("error");
        setQrError(
          err instanceof Error ? err.message : "Mất kết nối khi kiểm tra trạng thái mã QR Zalo.",
        );
      }
    };

    const intervalId = window.setInterval(() => {
      void pollOnce();
    }, 1800);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [qrSessionId, qrStatus, loadAccounts, onChanged]);

  // Countdown tick for live QR image (keyed to qrDataUrl)
  useEffect(() => {
    if (!qrDataUrl || qrStatus !== "qr_ready") return;
    const currentKey = qrDataUrl;
    const baseSeconds = qrExpiresBase || 100;
    const id = window.setInterval(() => {
      setQrCountdown((prev) => {
        if (prev.qrKey !== currentKey) {
          return { qrKey: currentKey, remaining: Math.max(0, baseSeconds - 1) };
        }
        return { qrKey: currentKey, remaining: prev.remaining > 0 ? prev.remaining - 1 : 0 };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [qrDataUrl, qrStatus, qrExpiresBase]);

  const qrSecondsLeft = qrDataUrl
    ? qrCountdown.qrKey === qrDataUrl
      ? qrCountdown.remaining
      : qrExpiresBase
    : 0;

  const selectedQrAccount = useMemo(
    () => accounts.find((a) => a.account_id === selectedQrAccountId) ?? null,
    [accounts, selectedQrAccountId],
  );

  const hasQrProxyHint = isZaloProxyErrorHint(qrError);
  const isQrProxyAccordionOpen =
    qrProxyAccordionManual !== null ? qrProxyAccordionManual : hasQrProxyHint;

  const handleRestart = async (acc: EnrichedZaloAccount) => {
    setBusyId(acc.account_id);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/all-platform/zalo/accounts/${encodeURIComponent(acc.account_id)}/listener/restart`,
        {
          method: "POST",
          credentials: "include",
          headers: buildApiHeaders(),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Không thể khởi động lại kết nối.");
      }
      setMessage({
        text: `Đã gửi yêu cầu kết nối lại socket cho "${acc.display_name}". Vui lòng chờ vài giây...`,
      });
      await new Promise((r) => setTimeout(r, 2000));
      await loadAccounts();
      onChanged?.();
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "Lỗi khởi động lại kết nối.",
        isError: true,
      });
    } finally {
      setBusyId(null);
    }
  };

  // Tab 2: Extension 1-Chạm — NO duplicate window.open! Extension handles opening & auto-closing chat.zalo.me.
  const handleConnectViaExtension = async (acc: EnrichedZaloAccount) => {
    setConnectingId(acc.account_id);
    const accName = acc.display_name || acc.account_id;
    const bridgeUrl = typeof window !== "undefined" ? window.location.origin : API_BASE_URL;

    setMessage({
      text: `⏳ Đang kích hoạt Extension "Seeding Zalo Connector" cho "${accName}"... Extension sẽ tự mở tab chat.zalo.me, lấy phiên và tự đóng tab khi hoàn tất.`,
    });

    try {
      ensureZaloExtensionBridge();
      const installed = await isZaloExtensionAvailable();
      if (!installed) {
        throw new Error(
          'Chưa phát hiện Chrome Extension "Seeding Zalo Connector". Hãy tải file extension-login-zalo.zip, cài vào chrome://extensions (Load unpacked), rồi F5 tải lại trang — hoặc chuyển sang tab "Quét mã QR trực tiếp" không cần Extension!',
        );
      }

      if (window.__zaloExtension?.importSession) {
        const extRes = await window.__zaloExtension.importSession({
          account_id: acc.account_id,
          owner_id: acc.account_id,
          backend_url: bridgeUrl,
          api_key: API_KEY || undefined,
          login_timeout_ms: 95000,
        });
        if (!extRes.success) {
          throw new Error(extRes.error || "Extension không thể trích xuất phiên Zalo.");
        }
      } else {
        const result = await importZaloSessionViaExtension({
          account_id: acc.account_id,
          user_id: acc.account_id,
          owner_id: acc.account_id,
          backend_url: bridgeUrl,
          login_timeout_ms: 95000,
        });
        if (!result.backend || (result.backend.status !== "confirmed" && !result.backend.ok)) {
          throw new Error(
            String(
              result.backend?.detail ||
                result.backend?.message ||
                "Extension chưa xác thực được phiên đăng nhập Zalo.",
            ),
          );
        }
      }

      setMessage({
        text: `✅ Kết nối thành công tài khoản "${accName}"! Tab Zalo Web đã tự đóng và phiên đang hoạt động trên máy chủ.`,
      });
      await loadAccounts();
      onChanged?.();
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "Lỗi khi kết nối tài khoản qua Extension.",
        isError: true,
        actionUrl: "/extension-login-zalo.zip",
        actionLabel: "Tải Extension (.zip)",
      });
    } finally {
      setConnectingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/zalo/accounts`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...buildApiHeaders(),
        },
        body: JSON.stringify({
          account_id: accountId.trim(),
          label: displayName.trim() || accountId.trim(),
          phone: phone.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        account_id?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.message || data.error || "Không thể tạo tài khoản.");
      const createdId =
        typeof data.account_id === "string" && data.account_id.trim()
          ? data.account_id.trim()
          : accountId.trim();
      setMessage({
        text: `Đã tạo tài khoản "${createdId}". Bạn có thể quét mã QR trực tiếp hoặc dùng Extension 1-chạm để đăng nhập ngay.`,
      });
      setSelectedQrAccountId(createdId);
      setAccountId("");
      setDisplayName("");
      setPhone("");
      setShowAddForm(false);
      await loadAccounts();
      onChanged?.();
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "Không thể tạo tài khoản.",
        isError: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (acc: EnrichedZaloAccount) => {
    const name = acc.display_name || acc.account_id;
    const msg =
      `⚠️ XÁC NHẬN XÓA TÀI KHOẢN "${name}"?\n\n` +
      `Thao tác này sẽ xóa sạch session kết nối và dữ liệu liên quan. Bạn có chắc chắn muốn xóa vĩnh viễn không?`;

    if (!confirm(msg)) return;

    setBusyId(acc.account_id);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/all-platform/zalo/accounts/${encodeURIComponent(acc.account_id)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: buildApiHeaders(),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.message || data.error || "Không thể xóa tài khoản.");
      setMessage({ text: `Đã xóa tài khoản "${name}".` });
      if (selectedQrAccountId === acc.account_id) setSelectedQrAccountId("");
      await loadAccounts();
      onChanged?.();
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : "Không thể xóa tài khoản.",
        isError: true,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={handleCloseModal}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl border border-slate-200/80 overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0068ff] to-[#0052cc] text-white shadow-md">
              <QrCode size={21} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Kết nối &amp; Quản lý tài khoản Zalo
              </h2>
              <p className="text-xs text-slate-500">
                Quét mã QR trực tiếp trên máy chủ (Khuyên dùng) hoặc Extension 1-chạm dự phòng
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/extension-login-zalo.zip"
              download
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition shadow-2xs"
              title="Tải tiện ích Seeding Zalo Connector (.zip)"
            >
              <Download size={14} />
              <span>Tải Extension (Zip)</span>
            </a>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0068ff] hover:bg-[#0052cc] px-3.5 py-1.5 text-xs font-bold text-white transition shadow-sm cursor-pointer"
            >
              <Plus size={14} />
              <span>{showAddForm ? "Hủy" : "Thêm tài khoản"}</span>
            </button>
            <button
              type="button"
              onClick={handleCloseModal}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition cursor-pointer"
              title="Đóng"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Zone A — Amber 1-Web-Slot Safety Pill */}
        <div className="border-b border-amber-200 bg-amber-50/95 px-6 py-2.5 text-xs font-medium text-amber-950">
          ⚠️ Zalo chỉ cho 1 phiên Web — Kết nối xong HÃY ĐÓNG TAB (✕), TUYỆT ĐỐI KHÔNG bấm Đăng xuất
          trên chat.zalo.me. Dùng Zalo PC &amp; Mobile thoải mái!
        </div>

        {/* Zone B — 2 Clean Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50/80 px-6 pt-2.5">
          <button
            type="button"
            onClick={() => setActiveTab("qr")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-t-xl px-4 py-2 text-xs font-bold transition cursor-pointer",
              activeTab === "qr"
                ? "border border-b-white border-slate-200 bg-white text-[#0068ff] -mb-px"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <QrCode size={14} />
            <span>Quét mã QR trực tiếp</span>
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-[#0052cc]">
              Khuyên dùng
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              void cancelActiveQrSession();
              setActiveTab("extension");
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-t-xl px-4 py-2 text-xs font-bold transition cursor-pointer",
              activeTab === "extension"
                ? "border border-b-white border-slate-200 bg-white text-[#0068ff] -mb-px"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <Zap size={14} />
            <span>Extension 1-Chạm (Dự phòng)</span>
          </button>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={cn(
              "flex items-start justify-between gap-3 px-6 py-3 text-xs font-medium border-b",
              message.isError
                ? "bg-red-50 text-red-700 border-red-200"
                : "bg-emerald-50 text-emerald-800 border-emerald-200",
            )}
          >
            <div className="flex items-start gap-2 flex-1">
              {message.isError ? (
                <AlertTriangle size={16} className="shrink-0 text-red-600 mt-0.5" />
              ) : (
                <CheckCircle2 size={16} className="shrink-0 text-emerald-600 mt-0.5" />
              )}
              <div>
                <span>{message.text}</span>
                {message.actionUrl && (
                  <a
                    href={message.actionUrl}
                    download={message.actionUrl.endsWith(".zip")}
                    target={message.actionUrl.endsWith(".zip") ? undefined : "_blank"}
                    rel={message.actionUrl.endsWith(".zip") ? undefined : "noopener noreferrer"}
                    className="ml-2 font-bold underline hover:opacity-80"
                  >
                    {message.actionLabel || "Xem liên kết ↗"}
                  </a>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Form thêm tài khoản mới */}
        {showAddForm && (
          <form
            onSubmit={handleCreate}
            className="border-b border-slate-200/80 bg-slate-50/50 p-5 space-y-4 animate-in slide-in-from-top-2 duration-150"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Thêm tài khoản Zalo mới
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mã định danh (ID) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="vd: zl_markee_01"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-[#0068ff] focus:ring-1 focus:ring-[#0068ff]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên gợi nhớ (Display Name)
                </label>
                <input
                  type="text"
                  placeholder="vd: Markee CSKH 1"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-[#0068ff] focus:ring-1 focus:ring-[#0068ff]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Số điện thoại (SĐT)
                </label>
                <input
                  type="text"
                  placeholder="vd: 0765055708"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-[#0068ff] focus:ring-1 focus:ring-[#0068ff]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving || !accountId.trim()}
                className="rounded-xl bg-[#0068ff] hover:bg-[#0052cc] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50 shadow-sm cursor-pointer"
              >
                {saving ? "Đang tạo..." : "Tạo & Lưu"}
              </button>
            </div>
          </form>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* ── TAB 1 PANEL: SERVER-SIDE QR LOGIN ────────────────────────────── */}
          {activeTab === "qr" && (
            <div className="rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50/40 via-white to-slate-50/60 p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tài khoản cần liên kết
                  </label>
                  <select
                    value={selectedQrAccountId}
                    onChange={(e) => setSelectedQrAccountId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-[#0068ff]"
                  >
                    <option value="">+ Tạo tài khoản mới khi quét QR</option>
                    {accounts.map((acc) => (
                      <option key={acc.account_id} value={acc.account_id}>
                        {acc.display_name} ({acc.account_id})
                        {acc.status === "connected"
                          ? " — Online"
                          : acc.web_slot_conflict && !acc.is_ws_connected
                            ? " — Trùng phiên Web"
                            : " — Chưa/Hết hạn"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {selectedQrAccount ? "Đang gắn vào hồ sơ" : "Tên gợi nhớ mới (tùy chọn)"}
                  </label>
                  {selectedQrAccount ? (
                    <div className="flex h-[34px] items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700">
                      <span className="truncate font-semibold">
                        {selectedQrAccount.display_name}
                      </span>
                      {selectedQrAccount.proxy_masked && (
                        <span className="ml-2 shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                          Có Proxy
                        </span>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={newQrLabel}
                      onChange={(e) => setNewQrLabel(e.target.value)}
                      placeholder="Vd: Zalo CSKH 01..."
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-[#0068ff]"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleStartServerQr()}
                    disabled={startingQr}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0068ff] hover:bg-[#0052cc] px-4 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-60 transition cursor-pointer"
                  >
                    {startingQr ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : qrDataUrl ? (
                      <RefreshCw size={14} />
                    ) : (
                      <QrCode size={14} />
                    )}
                    <span>{qrDataUrl ? "Tạo mã QR mới" : "Tạo mã QR đăng nhập"}</span>
                  </button>
                  {qrSessionId && isQrSessionActive(qrStatus) && (
                    <button
                      type="button"
                      onClick={() => {
                        void cancelActiveQrSession();
                        setQrStatus("cancelled");
                        setQrSessionId(null);
                        setQrDataUrl(null);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                    >
                      Hủy
                    </button>
                  )}
                </div>
              </div>

              {qrError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-600" />
                  <span className="break-words">{qrError}</span>
                </div>
              )}

              {/* Live Server QR Stage */}
              <div className="grid grid-cols-1 md:grid-cols-[232px_1fr] gap-5 items-center rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col items-center justify-center">
                  <div className="relative flex h-52 w-52 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 p-2 shadow-2xs">
                    {qrStatus === "confirmed" ? (
                      <div className="flex flex-col items-center gap-2 text-center px-3">
                        {qrConfirmedInfo?.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={qrConfirmedInfo.avatar}
                            alt={qrConfirmedInfo.display_name || "Zalo"}
                            className="h-14 w-14 rounded-full object-cover border-2 border-emerald-400"
                          />
                        ) : (
                          <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                        )}
                        <span className="text-xs font-bold text-emerald-800">
                          Đã kết nối thành công!
                        </span>
                        {qrConfirmedInfo?.display_name && (
                          <span className="text-[11px] font-semibold text-slate-700">
                            {qrConfirmedInfo.display_name}
                          </span>
                        )}
                      </div>
                    ) : qrStatus === "scanned" ? (
                      <div className="flex flex-col items-center gap-2 text-center px-3">
                        {qrScannedUser?.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={qrScannedUser.avatar}
                            alt={qrScannedUser.display_name || "Zalo User"}
                            className="h-16 w-16 rounded-full object-cover border-2 border-blue-400 shadow-xs"
                          />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-lg font-extrabold text-[#0068ff]">
                            {(qrScannedUser?.display_name || "Z").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="text-xs font-bold text-slate-900">
                          {qrScannedUser?.display_name || "Tài khoản Zalo"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-[10.5px] font-bold text-[#0052cc]">
                          <Smartphone size={12} />
                          Đã quét trên ĐT — hãy bấm Xác nhận
                        </span>
                      </div>
                    ) : qrDataUrl && qrStatus === "qr_ready" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrDataUrl}
                        alt="Zalo Server QR Code"
                        className="h-full w-full object-contain rounded-xl bg-white"
                      />
                    ) : startingQr || qrStatus === "starting" ? (
                      <div className="flex flex-col items-center gap-2 text-center px-4">
                        <Loader2 className="h-8 w-8 animate-spin text-[#0068ff]" />
                        <span className="text-xs font-medium text-slate-600">
                          Đang khởi tạo mã QR trực tiếp từ máy chủ...
                        </span>
                      </div>
                    ) : qrStatus === "expired" || qrStatus === "declined" || qrStatus === "error" ? (
                      <div className="flex flex-col items-center gap-2 text-center px-3">
                        <AlertTriangle className="h-8 w-8 text-amber-500" />
                        <span className="text-xs font-bold text-slate-800">
                          {qrStatus === "expired"
                            ? "Mã QR đã hết hạn"
                            : qrStatus === "declined"
                              ? "Đã từ chối trên điện thoại"
                              : "Khởi tạo QR thất bại"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleStartServerQr()}
                          className="inline-flex items-center gap-1 rounded-xl bg-[#0068ff] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#0052cc] cursor-pointer"
                        >
                          <RefreshCw size={12} />
                          Tạo mã QR mới
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-center px-4 text-slate-400">
                        <QrCode className="h-12 w-12 opacity-40" />
                        <span className="text-xs">
                          Bấm &ldquo;Tạo mã QR đăng nhập&rdquo; để quét trực tiếp không cần mở tab
                          chat.zalo.me
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Auto-refresh attempt counter + countdown */}
                  {qrStatus === "qr_ready" && qrDataUrl && (
                    <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                      <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[#0052cc]">
                        Lần {qrAttempt}/{qrMaxAttempts}
                      </span>
                      <span>Còn {qrSecondsLeft}s</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2.5 text-xs text-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900 text-sm">
                      Đăng nhập độc lập 100% với trình duyệt cá nhân
                    </p>
                    {qrHasProxy && qrProxyMasked && (
                      <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-700">
                        Proxy: {qrProxyMasked}
                      </span>
                    )}
                  </div>
                  <ol className="list-decimal space-y-1.5 pl-4">
                    <li>
                      Mở ứng dụng <strong>Zalo</strong> trên điện thoại → chọn biểu tượng{" "}
                      <strong>Quét mã QR</strong>.
                    </li>
                    <li>
                      Hướng camera vào mã QR bên trái → bấm <strong>Đăng nhập / Xác nhận</strong>{" "}
                      trên điện thoại.
                    </li>
                    <li>
                      Phiên được giữ trực tiếp trên máy chủ với <strong>IMEI cố định</strong>, không
                      cần mở tab <code>chat.zalo.me</code> nên không lo bấm nhầm Đăng xuất.
                    </li>
                  </ol>
                  <div className="rounded-xl border border-blue-200/80 bg-blue-50/70 px-3 py-2 text-[11px] text-blue-900">
                    Nếu máy chủ tự làm mới QR khi hết hạn (tối đa {qrMaxAttempts} lần), mã mới sẽ
                    hiện tự động ngay trên khung bên trái.
                  </div>
                </div>
              </div>

              {/* Collapsible Sticky VN Proxy Accordion */}
              <div
                className={cn(
                  "rounded-2xl border transition-colors",
                  hasQrProxyHint
                    ? "border-amber-300 bg-amber-50/60"
                    : "border-slate-200 bg-white",
                )}
              >
                <button
                  type="button"
                  onClick={() => setQrProxyAccordionManual(!isQrProxyAccordionOpen)}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe
                      size={15}
                      className={hasQrProxyHint ? "text-amber-600 shrink-0" : "text-slate-500 shrink-0"}
                    />
                    <span className="truncate text-xs font-semibold text-slate-800">
                      Cấu hình Sticky VN Proxy (tùy chọn — khuyên dùng nếu IP VPS bị giới hạn)
                    </span>
                    {(qrHasProxy || selectedQrAccount?.has_proxy) && (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        Có Proxy
                      </span>
                    )}
                  </div>
                  {isQrProxyAccordionOpen ? (
                    <ChevronUp size={15} className="text-slate-500 shrink-0" />
                  ) : (
                    <ChevronDown size={15} className="text-slate-500 shrink-0" />
                  )}
                </button>

                {isQrProxyAccordionOpen && (
                  <div className="space-y-2 border-t border-slate-200/80 px-3.5 py-3">
                    {hasQrProxyHint && (
                      <div className="rounded-xl border border-amber-300 bg-amber-100/80 px-3 py-2 text-[11px] font-medium text-amber-950">
                        💡 IP máy chủ có thể bị Zalo hạn chế khi tạo QR. Hãy nhập Sticky VN Proxy
                        (Residential/4G) rồi bấm &ldquo;Tạo mã QR mới&rdquo;!
                      </div>
                    )}
                    {(qrProxyMasked || selectedQrAccount?.proxy_masked) && (
                      <div className="text-[11px] text-slate-600">
                        Proxy hiện tại:{" "}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-800">
                          {qrProxyMasked || selectedQrAccount?.proxy_masked}
                        </code>
                      </div>
                    )}
                    <input
                      type="text"
                      value={qrProxyInput}
                      onChange={(e) => setQrProxyInput(e.target.value)}
                      placeholder="http://user:pass@host:port hoặc socks5://user:pass@host:port"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-[#0068ff]"
                    />
                    <p className="text-[11px] text-slate-500">
                      Hỗ trợ HTTP/HTTPS và SOCKS5. Proxy sẽ được gắn cố định cho cả phiên QR lẫn
                      listener của tài khoản này.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 2 PANEL: EXTENSION 1-CHẠM (DỰ PHÒNG) ─────────────────────── */}
          {activeTab === "extension" && (
            <div className="rounded-2xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Zap size={15} className="text-[#0068ff]" />
                    <span>Kết nối 1-Chạm qua Chrome Extension (Dự phòng)</span>
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    Chọn nút <strong>⚡ Extension 1-chạm</strong> ở bất kỳ tài khoản nào bên dưới.
                    Extension sẽ tự mở duy nhất 1 tab <code>chat.zalo.me</code>, trích xuất cookie
                    và <strong>tự động đóng tab ngay sau khi đồng bộ xong</strong> để tránh xung đột
                    phiên Web.
                  </p>
                </div>
                <a
                  href="/extension-login-zalo.zip"
                  download
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#0068ff] hover:bg-[#0052cc] px-3.5 py-2 text-xs font-bold text-white shadow-xs transition"
                >
                  <Download size={14} />
                  <span>Tải extension-login-zalo.zip</span>
                </a>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-white/90 px-3 py-2 text-[11px] text-emerald-900">
                ✅ <strong>Tự động đóng tab an toàn:</strong> Sau khi bạn đăng nhập xong trên tab
                Zalo Web do Extension mở, tab sẽ tự đóng lại — tuyệt đối không bấm{" "}
                <strong>Đăng xuất</strong> trên Zalo Web để phiên trên hệ thống sống ổn định 24/7.
              </div>
            </div>
          )}

          {/* ── ZONE C: DANH SÁCH TÀI KHOẢN ZALO ─────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Danh sách tài khoản ({accounts.length})
              </h3>
              <button
                type="button"
                onClick={() => void loadAccounts()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-[#0068ff] cursor-pointer"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                <span>Làm mới</span>
              </button>
            </div>

            {loading ? (
              <div className="py-10 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                <RefreshCw size={20} className="animate-spin text-[#0068ff]" />
                <span>Đang tải danh sách tài khoản...</span>
              </div>
            ) : accounts.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-xs rounded-xl border border-dashed border-slate-200">
                Chưa có tài khoản Zalo nào. Hãy bấm <strong>&ldquo;+ Thêm tài khoản&rdquo;</strong>{" "}
                hoặc quét mã QR ở trên để tạo tài khoản đầu tiên!
              </div>
            ) : (
              accounts.map((acc) => {
                const isConnecting = connectingId === acc.account_id;
                const isBusy = busyId === acc.account_id;
                const isOnline = acc.status === "connected";
                const isAuthExpired = acc.auth_expired;
                const isConflictOffline = acc.web_slot_conflict && !acc.is_ws_connected;
                const isError = acc.status === "error";

                return (
                  <div
                    key={acc.account_id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="relative shrink-0">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 font-bold text-[#0068ff] text-base">
                          {acc.display_name.slice(0, 1).toUpperCase()}
                        </div>
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white",
                            isOnline
                              ? "bg-emerald-500 ring-1 ring-emerald-200"
                              : isAuthExpired || isError
                                ? "bg-red-500"
                                : isConflictOffline
                                  ? "bg-orange-500 ring-1 ring-orange-200"
                                  : "bg-slate-300",
                          )}
                          title={
                            isOnline
                              ? "Online (Đã kết nối)"
                              : isAuthExpired || isError
                                ? "Lỗi phiên đăng nhập"
                                : isConflictOffline
                                  ? "Trùng phiên chat.zalo.me — đóng tab rồi Kết nối lại"
                                  : "Offline"
                          }
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900 truncate">
                            {acc.display_name}
                          </span>
                          {isOnline ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              <ShieldCheck size={11} /> Đã kết nối
                            </span>
                          ) : isAuthExpired || isError ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-[10px] font-bold text-red-700">
                              <AlertTriangle size={11} /> Hết hạn phiên
                            </span>
                          ) : isConflictOffline ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-300 px-2.5 py-0.5 text-[10px] font-bold text-orange-800">
                              <AlertTriangle size={11} /> Trùng phiên Web
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-medium text-slate-600">
                              Chưa kết nối
                            </span>
                          )}
                          {acc.cookie_expiring_soon && (
                            <span
                              title={
                                acc.cookie_expires_at
                                  ? `Cookie hết hạn lúc: ${acc.cookie_expires_at}`
                                  : "Cookie sắp hết hạn trong <24h"
                              }
                              className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-800"
                            >
                              ⚠️ Cookie sắp hết hạn
                            </span>
                          )}
                          {acc.web_slot_conflict && (
                            <span
                              title="Phát hiện xung đột 1 phiên Web — hãy ĐÓNG tab chat.zalo.me (không Đăng xuất) rồi bấm Kết nối lại"
                              className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-300 px-2 py-0.5 text-[10px] font-bold text-orange-800"
                            >
                              ⚠️ Đóng tab chat.zalo.me rồi bấm Kết nối lại
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                          <span className="font-mono text-[11px] text-slate-600 font-semibold">
                            {acc.account_id}
                          </span>
                          {acc.phone && (
                            <span>
                              · SĐT: <strong className="text-slate-700">{acc.phone}</strong>
                            </span>
                          )}
                          {acc.proxy_masked && (
                            <span className="font-mono text-[10px] text-emerald-700">
                              · Proxy: {acc.proxy_masked}
                            </span>
                          )}
                        </div>
                        {acc.last_error && (isError || isAuthExpired || isConflictOffline) && (
                          <p
                            className={cn(
                              "text-[11px] mt-1 line-clamp-2",
                              isConflictOffline && !isAuthExpired
                                ? "text-orange-700"
                                : "text-red-600",
                            )}
                          >
                            {acc.last_error}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-center shrink-0">
                      {!isOnline && acc.has_auth && (
                        <button
                          type="button"
                          disabled={isConnecting || isBusy}
                          onClick={() => void handleRestart(acc)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-xl border px-2.5 py-2 text-xs font-semibold transition shadow-2xs cursor-pointer disabled:opacity-50",
                            isConflictOffline
                              ? "border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                          )}
                          title="Khởi động lại kết nối socket nếu phiên bị ngắt hoặc trùng phiên Web"
                        >
                          <RotateCcw
                            size={12}
                            className={isBusy ? "animate-spin text-[#0068ff]" : ""}
                          />
                          <span>Kết nối lại</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isConnecting || isBusy || startingQr}
                        onClick={() => {
                          setActiveTab("qr");
                          void handleStartServerQr(acc.account_id);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50",
                          !isOnline
                            ? "bg-gradient-to-r from-[#0068ff] to-[#0052cc] text-white hover:from-[#0052cc] hover:to-[#003d99]"
                            : "border border-blue-200 bg-blue-50 text-[#0052cc] hover:bg-blue-100",
                        )}
                        title="Quét mã QR trực tiếp trên máy chủ (Khuyên dùng)"
                      >
                        <QrCode size={13} />
                        <span>{isOnline ? "Quét QR lại" : "Quét QR"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isConnecting || isBusy}
                        onClick={() => {
                          setActiveTab("extension");
                          void handleConnectViaExtension(acc);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer disabled:opacity-50"
                        title="Kết nối dự phòng 1-chạm bằng Extension Chrome"
                      >
                        {isConnecting ? (
                          <>
                            <RefreshCw size={12} className="animate-spin text-[#0068ff]" />
                            <span>Đang kết nối...</span>
                          </>
                        ) : (
                          <>
                            <Zap size={13} className="text-amber-500 fill-amber-500" />
                            <span>Extension</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isBusy || isConnecting}
                        onClick={() => void handleDelete(acc)}
                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition cursor-pointer"
                        title="Xóa hoàn toàn tài khoản (Deep Purge)"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
