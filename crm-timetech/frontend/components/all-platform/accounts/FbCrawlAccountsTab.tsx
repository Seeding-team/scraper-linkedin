"use client";

import { useState, useEffect, useCallback } from "react";
import { FaFacebook, FaPlus, FaLock } from "react-icons/fa";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  crawlFbAccountService,
  crawlFbLoginService,
  type CrawlFbAccount,
  type FbCrawlLoginResult,
} from "@/services/all-platform.service";

type Step = "form" | "waiting_phone" | "otp" | "done";

export function FbCrawlAccountsTab() {
  const { user } = useAppAuth();
  const idMember = user?.id || "";

  const [accounts, setAccounts] = useState<CrawlFbAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secret2fa, setSecret2fa] = useState("");
  const [otp, setOtp] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [waitMessage, setWaitMessage] = useState("");

  const showToast = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadAccounts = useCallback(async () => {
    if (!idMember) return;
    try {
      const res = await crawlFbAccountService.list();
      if (res.success && res.data) setAccounts(res.data.accounts);
    } catch {
      // Bỏ qua lỗi mạng lúc poll -- giữ danh sách cũ, thử lại ở lượt sau.
    } finally {
      setLoading(false);
    }
  }, [idMember]);

  useEffect(() => {
    loadAccounts();
    const t = setInterval(loadAccounts, 5000);
    return () => clearInterval(t);
  }, [loadAccounts]);

  function openModal() {
    setStep("form");
    setEmail(""); setPassword(""); setSecret2fa(""); setOtp(""); setSessionId("");
    setError(""); setWaitMessage("");
    setModalOpen(true);
  }

  async function handleLoginResult(res: FbCrawlLoginResult) {
    if (res.status === "success") {
      setStep("done");
      showToast("Đã kết nối tài khoản Facebook.", true);
      loadAccounts();
      return;
    }
    if (res.status === "need_otp") {
      setSessionId(res.session_id || "");
      setStep("otp");
      return;
    }
    if (res.status === "need_phone_approval" || res.status === "processing") {
      const currentSessionId = res.session_id || "";
      setSessionId(currentSessionId);
      setWaitMessage(
        res.status === "need_phone_approval"
          ? "Vui lòng mở điện thoại bấm xác nhận 'Đây là tôi'. Đang chờ đồng bộ (tối đa 60 giây)..."
          : "Hệ thống đang xử lý đăng nhập ngầm, vui lòng giữ nguyên hộp thoại..."
      );
      setStep("waiting_phone");
      const approvalRes = await crawlFbLoginService.checkPhoneApproval(currentSessionId);
      if (approvalRes.status === "success") {
        setStep("done");
        showToast("Đã kết nối tài khoản Facebook.", true);
        loadAccounts();
      } else if (approvalRes.status === "need_otp") {
        setSessionId(approvalRes.session_id || currentSessionId);
        setStep("otp");
      } else {
        setError(approvalRes.message || "Đăng nhập thất bại.");
        setStep("form");
      }
      return;
    }
    if (res.status === "error_bot_blocked") {
      setError("Facebook chặn xác minh Bot/CAPTCHA cho tài khoản này.");
      setStep("form");
      return;
    }
    setError(res.message || "Đăng nhập thất bại. Vui lòng kiểm tra lại email/mật khẩu.");
    setStep("form");
  }

  async function handleSubmitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }
    setSubmitting(true); setError("");
    try {
      const res = await crawlFbLoginService.login({
        email: email.trim(),
        password,
        secret_2fa: secret2fa.trim() || undefined,
        id_member: idMember || undefined,
      });
      await handleLoginResult(res);
    } catch {
      setError("Lỗi kết nối đến máy chủ.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim()) {
      setError("Vui lòng nhập mã OTP.");
      return;
    }
    setSubmitting(true); setError("");
    try {
      const res = await crawlFbLoginService.submitOtp(sessionId, otp.trim());
      if (res.status === "success") {
        setStep("done");
        showToast("Đã kết nối tài khoản Facebook.", true);
        loadAccounts();
      } else {
        setError(res.message || "Mã OTP không chính xác hoặc đã hết hạn.");
      }
    } catch {
      setError("Lỗi xác thực OTP với máy chủ.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect(acc: CrawlFbAccount) {
    if (!window.confirm(`Ngắt kết nối acc ${acc.email}? Job cần acc này sẽ chờ tới khi bạn kết nối lại.`)) return;
    try {
      const res = await crawlFbAccountService.disconnect(acc.id);
      if (res.success) {
        showToast("Đã ngắt kết nối tài khoản.", true);
        loadAccounts();
      } else {
        showToast(res.message || "Ngắt kết nối thất bại.", false);
      }
    } catch {
      showToast("Lỗi kết nối server.", false);
    }
  }

  const statusBadge = (status: CrawlFbAccount["status"]) => {
    if (status === "available") {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">🟢 Sẵn sàng</span>;
    }
    if (status === "assigned") {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">🟡 Đang dùng cào</span>;
    }
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-200">🔴 Cần đăng nhập lại</span>;
  };

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-xl border border-outline-variant p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-base font-bold text-on-surface">Kết nối tài khoản Facebook để cào bài</div>
            <div className="text-xs text-on-surface-variant mt-0.5">
              Dùng cho hàng đợi cào tự động đa VPS — mỗi acc chỉ cào được nhóm mà chính acc đó là thành viên.
            </div>
          </div>
          <button onClick={openModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-bold hover:bg-on-primary-fixed-variant transition cursor-pointer shadow-sm">
            <FaPlus size={12} />
            Thêm tài khoản
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="px-4 py-3 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <h2 className="text-sm font-bold text-on-surface">Acc Facebook đã kết nối</h2>
          <span className="text-xs font-semibold text-on-surface-variant px-2 py-0.5 bg-surface-container-highest rounded-full">{accounts.length} acc</span>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mx-auto mb-2" />
            <p className="text-on-surface-variant text-xs">Đang tải dữ liệu...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-16 bg-surface-container-low/60">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <FaFacebook className="text-3xl text-primary" />
            </div>
            <p className="text-on-surface font-semibold text-sm">Chưa kết nối tài khoản Facebook nào</p>
            <p className="text-on-surface-variant text-xs mt-1">Thêm acc để hệ thống tự cào các nhóm bạn phụ trách</p>
            <button onClick={openModal}
              className="mt-4 inline-flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-out active:scale-95 shadow-[0_2px_8px_-1px_rgba(217,55,55,0.35)] cursor-pointer">
              <FaPlus size={10} />
              Thêm tài khoản ngay
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
              <tr>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Cập nhật lần cuối</th>
                <th className="py-3 px-4 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-on-surface-variant">
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-surface-container-low/30 transition">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-[#0866FF]/10 text-[#0866FF] flex items-center justify-center shrink-0">
                        <FaFacebook size={12} />
                      </span>
                      <span className="font-bold text-on-surface truncate">{acc.email}</span>
                    </div>
                    {acc.status === "invalid" && acc.error_message && (
                      <div className="text-[10px] text-red-500 mt-1 truncate max-w-[240px]" title={acc.error_message}>
                        {acc.error_message}
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4">{statusBadge(acc.status)}</td>
                  <td className="py-3.5 px-4 text-[11px] font-mono">
                    {acc.last_used_at ? new Date(acc.last_used_at).toLocaleString("vi-VN") : "—"}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    {acc.status === "invalid" ? (
                      <button onClick={openModal}
                        className="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-lg text-[10px] font-bold transition cursor-pointer">
                        Đăng nhập lại
                      </button>
                    ) : (
                      <button onClick={() => void handleDisconnect(acc)}
                        className="px-2 py-1 bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 rounded-lg text-[10px] font-bold transition cursor-pointer">
                        Ngắt kết nối
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div style={{ width: "100%", maxWidth: "440px" }}
            className="bg-surface rounded-2xl border border-outline-variant shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
              <h3 className="font-bold text-on-surface flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FaLock size={14} />
                </span>
                Kết nối tài khoản Facebook
              </h3>
              <button onClick={() => setModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-xl p-1.5 transition-all duration-200 ease-out cursor-pointer">
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </div>

            {step === "done" ? (
              <div className="p-6 space-y-4 text-center">
                <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                  <MaterialIcon name="check_circle" className="text-green-500 text-4xl" />
                </div>
                <p className="text-sm font-bold text-on-surface">Đã kết nối tài khoản thành công!</p>
                <button onClick={() => setModalOpen(false)}
                  className="px-6 py-2.5 bg-primary hover:bg-on-primary-fixed-variant text-white rounded-2xl text-xs font-bold transition-all duration-200 ease-out cursor-pointer">
                  Đóng
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                {error && (
                  <div className="bg-red-50 text-red-600 text-xs p-3 rounded-xl border border-red-100 flex items-center gap-2">
                    <MaterialIcon name="error" className="text-sm shrink-0" /> {error}
                  </div>
                )}

                {step === "waiting_phone" ? (
                  <div className="py-8 text-center space-y-4">
                    <div className="w-14 h-14 border-4 border-outline-variant border-t-primary rounded-full animate-spin mx-auto" />
                    <p className="text-sm font-bold text-on-surface">Đang chờ xác nhận từ Facebook...</p>
                    <p className="text-[11px] text-on-surface-variant">{waitMessage}</p>
                  </div>
                ) : step === "otp" ? (
                  <form onSubmit={handleSubmitOtp} className="space-y-3">
                    <div className="text-center space-y-1">
                      <p className="text-xs font-bold text-on-surface">Nhập mã xác minh OTP</p>
                      <p className="text-[10px] text-on-surface-variant">
                        Mã đã được gửi tới {email} hoặc điện thoại đã đăng ký
                      </p>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      placeholder="• • • • • •"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant rounded-xl text-center text-2xl font-mono font-bold text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out"
                      autoFocus
                    />
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setStep("form")}
                        className="flex-1 border border-outline-variant hover:bg-surface-container-low text-on-surface-variant font-bold py-2.5 rounded-2xl text-xs transition-all duration-200 ease-out cursor-pointer">
                        ← Quay lại
                      </button>
                      <button type="submit" disabled={submitting || otp.trim().length < 6}
                        className="flex-[2] bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2.5 rounded-2xl text-xs transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                        {submitting
                          ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          : <><FaLock size={12} /> Xác minh</>}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleSubmitLogin} className="space-y-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                        Email Facebook <span className="text-primary">*</span>
                      </label>
                      <input type="email" required placeholder="name@example.com" value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out" />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                        Mật khẩu <span className="text-primary">*</span>
                      </label>
                      <input type="password" required placeholder="Mật khẩu Facebook" value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out" />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-on-surface-variant uppercase">
                        Mã bí mật 2FA (tuỳ chọn)
                      </label>
                      <input type="text" placeholder="Để trống nếu không bật xác thực 2 lớp bằng app" value={secret2fa}
                        onChange={(e) => setSecret2fa(e.target.value)}
                        className="w-full px-4 py-2 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all duration-200 ease-out" />
                    </div>
                    <button type="submit" disabled={submitting || !email.trim() || !password.trim()}
                      className="w-full bg-primary hover:bg-on-primary-fixed-variant text-white font-bold py-2.5 rounded-2xl text-xs transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                      {submitting
                        ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        : <><FaLock size={12} /> Đăng nhập &amp; kết nối</>}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={cn("fixed bottom-6 right-6 px-5 py-3.5 rounded-xl text-white font-bold shadow-xl animate-in slide-in-from-bottom-5 z-50 flex items-center gap-2", toast.ok ? "bg-emerald-600" : "bg-primary")}>
          <MaterialIcon name={toast.ok ? "check_circle" : "error"} className="text-lg" />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
