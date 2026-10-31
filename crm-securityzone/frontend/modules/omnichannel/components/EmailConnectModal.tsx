"use client";

import React, { useState, useEffect } from "react";
import { GoogleOAuthProvider, useGoogleLogin } from "@react-oauth/google";
import { X, ArrowLeft, Mail, ChevronRight, CheckCircle2, AlertCircle, Loader2, KeyRound, RefreshCw, Trash2, ShieldCheck } from "lucide-react";
import { GMAIL_OAUTH_CLIENT_ID } from "@/lib/env";
import { OmnichannelRepository } from "../repositories/OmnichannelRepository";
import { ChannelAccount } from "../types";

interface EmailConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (connectedAccount?: { email: string; name: string }) => void;
  initialEmail?: string;
  initialName?: string;
}

type Step = "provider" | "imap_smtp";

const omnichannelRepository = new OmnichannelRepository();

const EmailConnectModalContent: React.FC<EmailConnectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialEmail,
  initialName,
}) => {
  const [step, setStep] = useState<Step>("provider");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [syncingEmail, setSyncingEmail] = useState<string | null>(null);
  const [oauthState, setOauthState] = useState("");
  const [oauthOrigin, setOauthOrigin] = useState("");

  // Detect current workspace
  // Bug that (2026-10-31): truoc day chi check nhi phan isCloudGate, moi workspace
  // khac (securityzone, timetech) deu bi hien sai thanh "Markee" trong modal nay.
  const crmInstance = (process.env.NEXT_PUBLIC_CRM_INSTANCE || "markee").toLowerCase();
  const WORKSPACE_DISPLAY_NAMES: Record<string, string> = {
    markee: "Markee",
    cloudgate: "CloudGate",
    securityzone: "SecurityZone",
    timetech: "TimeTech",
  };
  const workspaceName = WORKSPACE_DISPLAY_NAMES[crmInstance] || crmInstance;

  // IMAP/SMTP form state
  const [senderAddress, setSenderAddress] = useState("");
  const [senderName, setSenderName] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [imapHost, setImapHost] = useState("imap.gmail.com");
  const [imapPort, setImapPort] = useState(993);
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(587);

  // Load accounts when modal opens
  const loadAccounts = async () => {
    try {
      const allAccs = await omnichannelRepository.fetchChannelAccounts();
      const emailAccs = allAccs.filter((a) => a.channel === "email");
      setAccounts(emailAccs);
    } catch (e) {
      // quiet fallback
    }
  };

  useEffect(() => {
    if (isOpen) {
      setStep("provider");
      setError(null);
      setLoading(false);
      loadAccounts();
      setOauthState("");
      setOauthOrigin("");
      if (typeof window !== "undefined" && GMAIL_OAUTH_CLIENT_ID) {
        omnichannelRepository.getGoogleOAuthState(window.location.origin)
          .then((result) => {
            setOauthState(result.state);
            setOauthOrigin(result.origin);
          })
          .catch((err) => setError(err?.message || "Không thể khởi tạo Google OAuth."));
      }
      setSenderAddress(initialEmail || "");
      setSenderName(initialName || "");
    }
  }, [isOpen, initialEmail, initialName]);

  const handleClose = () => {
    setStep("provider");
    setError(null);
    setLoading(false);
    onClose();
  };

  const startGoogleLogin = useGoogleLogin({
    flow: "auth-code",
    ux_mode: "popup",
    select_account: true,
    state: oauthState,
    scope: "openid email profile https://www.googleapis.com/auth/gmail.modify",
    onSuccess: async (response) => {
      try {
        const account = await omnichannelRepository.exchangeGoogleOAuth(
          response.code,
          oauthOrigin,
          oauthState
        );
        setLoading(false);
        onSuccess({ email: account.email, name: account.name });
        handleClose();
      } catch (err: any) {
        setLoading(false);
        setError(err?.message || "Lỗi khi trao đổi token Google OAuth.");
      }
    },
    onError: (response) => {
      setLoading(false);
      setError(response?.error_description || "Đăng nhập Google thất bại. Vui lòng thử lại.");
    },
    onNonOAuthError: () => {
      setLoading(false);
      setError("Cửa sổ chọn tài khoản Google đã bị đóng hoặc bị trình duyệt chặn.");
    },
  });

  const handleStartGoogleOAuth = () => {
    if (!oauthState || !oauthOrigin) {
      setError("Phiên Google OAuth chưa sẵn sàng. Vui lòng đóng và mở lại cửa sổ kết nối.");
      return;
    }
    setLoading(true);
    setError(null);
    startGoogleLogin();
  };

  if (!isOpen) return null;

  const handleSaveImapSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddress = senderAddress.trim().toLowerCase();
    if (!cleanAddress) {
      setError("Vui lòng nhập địa chỉ email.");
      return;
    }
    if (!appPassword.trim()) {
      setError("Vui lòng nhập Mật khẩu ứng dụng (App Password).");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await omnichannelRepository.connectImapAccount({
        email: cleanAddress,
        name: senderName.trim() || cleanAddress,
        app_password: appPassword.trim(),
        imap_host: imapHost.trim(),
        imap_port: Number(imapPort) || 993,
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort) || 587,
      });

      setLoading(false);
      onSuccess({ email: cleanAddress, name: senderName.trim() || cleanAddress });
      handleClose();
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "Lỗi khi kết nối IMAP/SMTP.");
    }
  };

  const handleDisconnect = async (accountId: string) => {
    if (!confirm("Bạn có chắc chắn muốn ngắt kết nối tài khoản email này?")) return;
    try {
      await omnichannelRepository.disconnectEmailAccount(accountId);
      await loadAccounts();
    } catch (e: any) {
      alert(e?.message || "Lỗi khi ngắt kết nối tài khoản.");
    }
  };

  const handleSyncAccount = async (email?: string) => {
    if (!email) return;
    setSyncingEmail(email);
    try {
      await omnichannelRepository.syncEmailMailbox(email);
      await loadAccounts();
    } catch (e) {
      // quiet
    } finally {
      setSyncingEmail(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-2xs p-4 select-none animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-100 font-sans overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step 1: Provider selection & Connected Accounts list */}
        {step === "provider" && (
          <div className="p-5 space-y-4 overflow-y-auto max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Quản lý Tài khoản Email</h3>
                <p className="text-xs text-slate-500">Workspace: <span className="font-semibold text-slate-700">{workspaceName}</span></p>
              </div>
              <button
                onClick={handleClose}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* List of currently connected accounts */}
            {accounts.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Tài khoản đang kết nối ({accounts.length})
                </h4>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                  {accounts.map((acc) => {
                    const isSyncing = syncingEmail === acc.email;
                    return (
                      <div
                        key={acc.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition text-xs"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span
                            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                              acc.status === "online"
                                ? "bg-emerald-500"
                                : acc.status === "expired"
                                ? "bg-amber-500 ring-2 ring-amber-200"
                                : acc.status === "error"
                                ? "bg-rose-500"
                                : "bg-sky-500 animate-pulse"
                            }`}
                          />
                          <div className="truncate">
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="font-bold text-slate-800 truncate">{acc.email}</span>
                              {acc.providerType === "google_oauth" && (
                                <span className="text-[9.5px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded-full">
                                  OAuth
                                </span>
                              )}
                              {acc.isDefault && (
                                <span className="text-[9.5px] font-bold bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded-full">
                                  Mặc định
                                </span>
                              )}
                            </div>
                            <span className="text-[10.5px] text-slate-400">
                              {acc.status === "online"
                                ? "Đang hoạt động"
                                : acc.status === "expired"
                                ? "Hết quyền truy cập · Cần kết nối lại"
                                : acc.status === "error"
                                ? `Lỗi: ${acc.lastSyncError || "Không xác định"}`
                                : "Đang đồng bộ"}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {acc.status === "expired" && (
                            <button
                              type="button"
                              onClick={handleStartGoogleOAuth}
                              className="px-2 py-1 rounded-lg bg-amber-500 text-white font-bold text-[10px] hover:bg-amber-600 transition"
                            >
                              Kết nối lại
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => handleSyncAccount(acc.email)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition"
                            title="Đồng bộ ngay"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin text-sky-600" : ""}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDisconnect(acc.id)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                            title="Ngắt kết nối"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Provider Options */}
            <div className="space-y-2.5 pt-1">
              {/* Option 1: Google Workspace / Gmail OAuth */}
              <button
                type="button"
                disabled={loading || !GMAIL_OAUTH_CLIENT_ID || !oauthState}
                onClick={handleStartGoogleOAuth}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-rose-300 bg-rose-50/40 hover:border-[#c2185b] hover:bg-rose-50/70 transition cursor-pointer shadow-2xs group text-left disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0 shadow-2xs">
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900 group-hover:text-[#c2185b] transition">
                        Google Workspace / Gmail (OAuth)
                      </h4>
                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        Khuyến nghị
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Đăng nhập trực tiếp bằng Google cá nhân hoặc Workspace, không cần App Password
                    </p>
                  </div>
                </div>
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[#c2185b]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-[#c2185b] transition" />
                )}
              </button>

              {/* Option 2: IMAP / SMTP Manual */}
              <button
                type="button"
                onClick={() => {
                  setStep("imap_smtp");
                  setError(null);
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-white hover:border-[#c2185b] hover:bg-rose-50/20 transition cursor-pointer shadow-2xs group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 shadow-2xs text-slate-600">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-[#c2185b] transition">
                      Email máy chủ khác (IMAP / SMTP)
                    </h4>
                    <p className="text-xs text-slate-500">
                      Kết nối bằng App Password cho Gmail, Zimbra, cPanel, email hosting riêng
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-[#c2185b] transition" />
              </button>
            </div>

            {/* Note box */}
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-800 text-xs">
              <ShieldCheck className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />
              <p className="leading-relaxed">
                Tokens và thông tin đăng nhập được mã hóa an toàn ở máy chủ. Mỗi email đồng bộ hộp thư riêng biệt và không ghi đè dữ liệu cũ.
              </p>
            </div>
          </div>
        )}

        {/* Step 2: IMAP / SMTP Form */}
        {step === "imap_smtp" && (
          <form onSubmit={handleSaveImapSmtp} className="p-5 space-y-3.5 overflow-y-auto max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <button
                type="button"
                onClick={() => setStep("provider")}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Quay lại</span>
              </button>
              <h3 className="text-xs font-bold text-slate-700">Cấu hình Email (IMAP / SMTP)</h3>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Địa chỉ Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={senderAddress}
                  onChange={(e) => setSenderAddress(e.target.value)}
                  placeholder="vd: user@gmail.com hoặc mail@congty.com"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-xs focus:outline-none focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Tên hiển thị người gửi
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="vd: Thảo Nguyễn / CSKH"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-xs focus:outline-none focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Mật khẩu ứng dụng (App Password) <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-xs focus:outline-none focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]"
                />
                <p className="text-[10.5px] text-slate-400 mt-1 leading-normal">
                  Với Gmail: Tạo mật khẩu 16 ký tự tại{" "}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#c2185b] underline font-medium hover:text-[#a3134c]"
                  >
                    Google App Passwords
                  </a>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Máy chủ IMAP</label>
                  <input
                    type="text"
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-800 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Cổng IMAP (SSL)</label>
                  <input
                    type="number"
                    value={imapPort}
                    onChange={(e) => setImapPort(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-800 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Máy chủ SMTP</label>
                  <input
                    type="text"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-800 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Cổng SMTP (TLS)</label>
                  <input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-800 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 rounded-xl bg-[#c2185b] text-white text-xs font-bold hover:opacity-95 transition shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Kiểm tra & Kết nối</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export const EmailConnectModal: React.FC<EmailConnectModalProps> = (props) => {
  return (
    <GoogleOAuthProvider clientId={GMAIL_OAUTH_CLIENT_ID || "gmail-oauth-not-configured"}>
      <EmailConnectModalContent {...props} />
    </GoogleOAuthProvider>
  );
};
