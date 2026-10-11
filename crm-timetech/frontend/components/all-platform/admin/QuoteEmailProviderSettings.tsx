"use client";

import { useCallback, useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { API_BASE_URL, API_KEY } from "@/lib/env";

type EmailProviderSettings = {
  channelType: string;
  isEnabled: boolean;
  senderName: string | null;
  senderAddress: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  credentialConfigured: boolean;
  credentialUpdatedAt: string | null;
  imapConnectionStatus: "unknown" | "ok" | "error";
  imapLastTestedAt: string | null;
  smtpConnectionStatus: "unknown" | "ok" | "error";
  smtpLastTestedAt: string | null;
};

type ApiResponse<T> = { success?: boolean; message?: string; data?: T };

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

async function callApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/all-platform/quotes-email-provider${path}`, {
    credentials: "include",
    headers: headers(),
    ...options,
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Lỗi máy chủ (${res.status})`);
  }
  return body.data as T;
}

const inputClass =
  "w-full px-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all outline-none";
const labelClass = "text-[10px] font-bold text-on-surface-variant uppercase";
const primaryBtnClass =
  "px-4 py-2 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold text-xs rounded-xl active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 shadow-sm cursor-pointer whitespace-nowrap";
const secondaryBtnClass =
  "px-4 py-2 border border-outline-variant text-on-surface font-bold text-xs rounded-xl hover:bg-surface-container-low active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 cursor-pointer whitespace-nowrap";
const dangerBtnClass =
  "px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 font-bold text-xs rounded-xl active:scale-95 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap";
const linkBtnClass = "text-xs font-bold text-primary hover:underline disabled:opacity-50 disabled:no-underline cursor-pointer whitespace-nowrap";

function StatusBadge({ status }: { status: "unknown" | "ok" | "error" }) {
  const label = status === "ok" ? "Đã kết nối" : status === "error" ? "Lỗi kết nối" : "Chưa kiểm tra";
  const icon = status === "ok" ? "check_circle" : status === "error" ? "error" : "help";
  const classes =
    status === "ok"
      ? "bg-green-50 text-green-700 border-green-200"
      : status === "error"
        ? "bg-primary-container/10 text-primary-container border-primary-container/20"
        : "bg-surface-container-low text-on-surface-variant border-outline-variant";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-bold", classes)}>
      <MaterialIcon name={icon as never} className="text-xs" />
      {label}
    </span>
  );
}

/** Admin → Cài đặt kết nối → Email gửi báo giá (Gmail IMAP+SMTP).
 * Bảo mật: App Password KHÔNG BAO GIỜ được gửi ngược từ server, chỉ nhập 1
 * chiều rồi để trống - server tự hiểu là "giữ nguyên credential cũ" khi sửa
 * From Name/email test. Không lưu vào localStorage/sessionStorage - state
 * password chỉ tồn tại trong React state của form, mất khi rời trang. */
export function QuoteEmailProviderSettings() {
  const { user } = useAppAuth();
  // Admin va Leader deu quan ly duoc kenh gui email bao gia (khong chi
  // Admin) - mirror can_manage_quote_email_settings() o backend
  // (crm_permission_service.py). Member KHONG duoc vao trang nay du go
  // dung URL - backend cung tu choi 403 that, day chi la lop UX.
  const canManage = user?.role === "admin" || user?.role === "leader";

  const [settings, setSettings] = useState<EmailProviderSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [senderAddress, setSenderAddress] = useState("");
  const [senderName, setSenderName] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await callApi<EmailProviderSettings>("");
      setSettings(data);
      setSenderAddress(data.senderAddress || "");
      setSenderName(data.senderName || "");
      setShowPasswordField(!data.credentialConfigured);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được cấu hình.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  // "Trang khong co quyen" that su - KHONG chi ẩn menu (dung yeu cau "Nếu
  // truy cập trực tiếp URL... Frontend hiển thị trang không có quyền").
  if (!canManage) {
    return (
      <div className="rounded-xl border border-red-100 bg-surface p-6 text-xs font-medium text-red-600">
        Bạn không có quyền truy cập trang này. Chỉ Admin hoặc Leader mới được cấu hình kênh gửi email báo giá.
      </div>
    );
  }

  async function handleSave() {
    if (!senderAddress.trim()) {
      setNotice({ ok: false, message: "Vui lòng nhập email gửi." });
      return;
    }
    setBusy("save");
    setNotice(null);
    try {
      const data = await callApi<EmailProviderSettings>("", {
        method: "PUT",
        body: JSON.stringify({
          sender_address: senderAddress.trim(),
          sender_name: senderName.trim(),
          // rỗng = giữ nguyên App Password đã lưu — KHÔNG gửi field nếu
          // người dùng không gõ gì vào ô mật khẩu.
          app_password: appPassword.trim() || null,
        }),
      });
      setSettings(data);
      setAppPassword("");
      setShowPasswordField(!data.credentialConfigured);
      setNotice({ ok: true, message: "Đã lưu cấu hình." });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : "Không lưu được cấu hình." });
    } finally {
      setBusy(null);
    }
  }

  async function handleClearCredentials() {
    if (!window.confirm("Xoá thông tin xác thực email đã lưu? Kênh gửi sẽ tự tắt.")) return;
    setBusy("clear");
    setNotice(null);
    try {
      const data = await callApi<EmailProviderSettings>("/credentials", { method: "DELETE" });
      setSettings(data);
      setAppPassword("");
      setShowPasswordField(true);
      setNotice({ ok: true, message: "Đã xoá thông tin xác thực." });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : "Không xoá được." });
    } finally {
      setBusy(null);
    }
  }

  async function handleTest(kind: "imap" | "smtp") {
    // Dang nhap App Password MOI (chua luu) ma chua co email gui -> chan
    // ngay o FE voi thong bao ro rang, khong de backend tra loi mo ho
    // "Thiếu email để test kết nối" (dung khi appPassword co gia tri nhung
    // senderAddress rong).
    if (appPassword.trim() && !senderAddress.trim()) {
      setNotice({ ok: false, message: "Vui lòng nhập Email gửi trước khi kiểm tra." });
      return;
    }
    setBusy(`test-${kind}`);
    setNotice(null);
    try {
      // Neu dang go App Password moi (chua luu) thi test tam bang gia tri
      // do, khong ghi DB - cho phep "Kiem tra truoc khi Luu".
      const payload = appPassword.trim()
        ? { sender_address: senderAddress.trim(), app_password: appPassword.trim() }
        : {};
      await callApi<null>(`/test-${kind}`, { method: "POST", body: JSON.stringify(payload) });
      setNotice({ ok: true, message: `Kiểm tra ${kind.toUpperCase()} thành công.` });
      await load();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : `Kiểm tra ${kind.toUpperCase()} thất bại.` });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function handleSendTest() {
    if (!testRecipient.trim()) {
      setNotice({ ok: false, message: "Vui lòng nhập email nhận thử." });
      return;
    }
    setBusy("send-test");
    setNotice(null);
    try {
      await callApi<null>("/send-test", {
        method: "POST",
        body: JSON.stringify({ test_recipient: testRecipient.trim() }),
      });
      setNotice({ ok: true, message: `Đã gửi email thử tới ${testRecipient.trim()}.` });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : "Gửi email thử thất bại." });
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleEnabled() {
    if (!settings) return;
    setBusy("toggle");
    setNotice(null);
    try {
      const data = await callApi<EmailProviderSettings>(settings.isEnabled ? "/disable" : "/enable", { method: "POST" });
      setSettings(data);
      setNotice({ ok: true, message: data.isEnabled ? "Đã bật kênh gửi báo giá qua email." : "Đã tắt kênh gửi báo giá qua email." });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : "Không đổi được trạng thái." });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="rounded-xl border border-outline-variant bg-surface p-6 text-xs text-on-surface-variant">Đang tải…</div>;
  }
  if (loadError) {
    return <div className="rounded-xl border border-red-100 bg-surface p-6 text-xs font-medium text-red-600">{loadError}</div>;
  }
  if (!settings) return null;

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h2 className="text-sm font-bold text-on-surface">Email gửi báo giá</h2>
        <p className="text-xs text-on-surface-variant mt-1">
          Cấu hình hộp thư dùng chung để gửi báo giá và nhận phản hồi khách hàng.
        </p>
      </div>

      {notice ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-xs font-medium",
            notice.ok
              ? "bg-green-50 text-green-800 border-green-200"
              : "bg-primary-container/10 text-primary-container border-primary-container/20",
          )}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 min-w-0 space-y-6">
          {/* Thong tin ket noi Gmail */}
          <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-5 shadow-sm">
            <h3 className="text-xs font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
              <MaterialIcon name="mail" className="text-primary" />
              Kết nối Gmail
            </h3>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1">
                <label className={labelClass}>Email gửi</label>
                <input
                  type="email"
                  value={senderAddress}
                  onChange={e => setSenderAddress(e.target.value)}
                  placeholder="sale@congty.com"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Tên người gửi</label>
                <input
                  type="text"
                  value={senderName}
                  onChange={e => setSenderName(e.target.value)}
                  placeholder="Phòng Kinh doanh"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className={labelClass}>App Password</label>
              {settings.credentialConfigured && !showPasswordField ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low/30 px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                    <MaterialIcon name="check_circle" className="text-sm" />
                    App Password đã được cấu hình
                  </span>
                  <span className="flex-1" />
                  <button type="button" className={linkBtnClass} onClick={() => setShowPasswordField(true)}>
                    Thay đổi App Password
                  </button>
                  <button type="button" className={cn(linkBtnClass, "text-red-600")} onClick={() => void handleClearCredentials()} disabled={busy === "clear"}>
                    Xoá thông tin xác thực
                  </button>
                </div>
              ) : (
                <input
                  type="password"
                  value={appPassword}
                  onChange={e => setAppPassword(e.target.value)}
                  placeholder="Dán App Password 16 ký tự từ Google"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  className={inputClass}
                />
              )}
            </div>

            <details className="group rounded-xl border border-outline-variant/60 bg-surface-container-low/20 px-4 py-2.5">
              <summary className="cursor-pointer text-xs font-bold text-on-surface-variant select-none flex items-center gap-1.5">
                <MaterialIcon name="tune" className="text-sm" />
                Cấu hình nâng cao (chỉ đọc — preset Gmail)
              </summary>
              <div className="text-[11px] text-on-surface-variant mt-2 space-y-0.5 leading-relaxed">
                <p>IMAP: {settings.imapHost}:{settings.imapPort} ({settings.imapSecurity.toUpperCase()})</p>
                <p>SMTP: {settings.smtpHost}:{settings.smtpPort} ({settings.smtpSecurity.toUpperCase()})</p>
              </div>
            </details>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button type="button" className={primaryBtnClass} onClick={() => void handleSave()} disabled={busy === "save"}>
                {busy === "save" ? "Đang lưu..." : "Lưu cấu hình"}
              </button>
              <button type="button" className={secondaryBtnClass} onClick={() => void handleTest("imap")} disabled={busy === "test-imap"}>
                {busy === "test-imap" ? "Đang kiểm tra..." : "Kiểm tra IMAP"}
              </button>
              <button type="button" className={secondaryBtnClass} onClick={() => void handleTest("smtp")} disabled={busy === "test-smtp"}>
                {busy === "test-smtp" ? "Đang kiểm tra..." : "Kiểm tra SMTP"}
              </button>
              <span className="flex-1" />
              <div className="flex items-center gap-2 text-[11px] font-bold text-on-surface-variant">
                <span>IMAP</span>
                <StatusBadge status={settings.imapConnectionStatus} />
                <span className="mx-1 text-outline-variant">·</span>
                <span>SMTP</span>
                <StatusBadge status={settings.smtpConnectionStatus} />
              </div>
            </div>
          </div>

          {/* Gui thu that de test */}
          <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-on-surface border-b border-outline-variant pb-3 flex items-center gap-2">
              <MaterialIcon name="send" className="text-primary" />
              Gửi email thử
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px] space-y-1">
                <label className={labelClass}>Email nhận thử</label>
                <input
                  type="email"
                  value={testRecipient}
                  onChange={e => setTestRecipient(e.target.value)}
                  placeholder="ban@congty.com"
                  className={inputClass}
                />
              </div>
              <button type="button" className={secondaryBtnClass} onClick={() => void handleSendTest()} disabled={busy === "send-test"}>
                {busy === "send-test" ? "Đang gửi..." : "Gửi email thử"}
              </button>
            </div>
          </div>
        </div>

        {/* Cot phai: bat/tat kenh */}
        <div className="col-span-12 lg:col-span-4 min-w-0">
          <div className="rounded-xl border border-outline-variant bg-surface p-6 sticky top-24 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-on-surface border-b border-outline-variant pb-2 flex items-center gap-2">
              <MaterialIcon name="bolt" className="text-primary" />
              Kênh gửi báo giá
            </h3>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.isEnabled}
                disabled={busy === "toggle" || !settings.credentialConfigured}
                onChange={() => void handleToggleEnabled()}
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="text-xs font-semibold text-on-surface">
                Sử dụng kênh này để gửi báo giá cho khách hàng
              </span>
            </label>
            {!settings.credentialConfigured ? (
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Cần lưu App Password và kiểm tra SMTP thành công trước khi bật.
              </p>
            ) : settings.isEnabled ? (
              <p className="text-[11px] text-green-700 font-semibold leading-relaxed flex items-center gap-1">
                <MaterialIcon name="check_circle" className="text-xs" />
                Đang dùng để gửi báo giá.
              </p>
            ) : (
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Đang tắt — nhân viên chưa gửi được báo giá qua email cho tới khi bật.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
