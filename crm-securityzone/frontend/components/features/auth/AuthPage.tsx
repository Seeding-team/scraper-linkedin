"use client";

import { useEffect, useState, type FormEvent, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { GOOGLE_OAUTH_CLIENT_ID } from "@/lib/env";
import { getDashboardHrefForRole } from "@/components/all-platform/layout/AllPlatformSidebar";

/* -------------------------------------------------------------------------- */
/*  Material Symbols — class already defined in globals.css                    */
/* -------------------------------------------------------------------------- */
const Icon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */
type AuthMode = "login" | "register";

/* -------------------------------------------------------------------------- */
/*  AuthPage                                                                   */
/* -------------------------------------------------------------------------- */
export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "success">("idle");

  // Forgot password states
  const [forgotStep, setForgotStep] = useState<"hidden" | "email" | "password">("hidden");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotNewPass, setForgotNewPass] = useState("");
  const [forgotConfirmPass, setForgotConfirmPass] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const { user, isAuthenticated, isLoading: authLoading, login, loginWithGoogle, register, setLwuuSession } = useAppAuth();
  const router = useRouter();

  // Nếu đã đăng nhập (vd bấm nút Back của trình duyệt quay lại /auth/login sau
  // khi login xong, hoặc mở lại tab cũ còn cookie hợp lệ) thì đưa thẳng vào
  // đúng dashboard theo role thay vì hiện lại form login. Phải đợi authLoading
  // xong (AppAuthProvider gọi /auth/me lúc mount) rồi mới quyết định — nếu
  // check ngay khi isLoading còn true sẽ luôn thấy isAuthenticated=false (state
  // chưa kịp cập nhật) và không bao giờ redirect được.
  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated && user) {
      router.replace(getDashboardHrefForRole(user.role));
    }
  }, [authLoading, isAuthenticated, user, router]);

  const handleGoogleSuccess = useCallback(
    async (credentialResponse: CredentialResponse) => {
      setGoogleError(null);
      if (!credentialResponse.credential) {
        setGoogleError("Không nhận được thông tin đăng nhập từ Google.");
        return;
      }
      try {
        const user = await loginWithGoogle(credentialResponse.credential);
        router.push(getDashboardHrefForRole(user.role));
      } catch (err) {
        setGoogleError(err instanceof Error ? err.message : "Đăng nhập Google thất bại.");
      }
    },
    [loginWithGoogle, router],
  );

  const switchMode = useCallback((m: AuthMode) => {
    setMode(m);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setSubmitStatus("loading");

    try {
      const user = mode === "login"
        ? await login(email.trim(), password)
        : await register(email.trim(), password, name.trim() || undefined);
      localStorage.setItem("linkedin_crawler_email", email.trim());
      if (remember) {
        setLwuuSession(email.trim(), true);
      }
      router.push(getDashboardHrefForRole(user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra");
      setSubmitStatus("idle");
    } finally {
      setSubmitting(false);
    }
  }, [mode, email, password, name, login, register, setLwuuSession, router]);

  const handleCheckEmail = async (e: FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotLoading(true);
    try {
      const { API_BASE_URL } = await import("@/lib/env");
      const res = await fetch(`${API_BASE_URL}/api/all-platform/auth/check-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() })
      });
      const data = await res.json();
      if (data.success && data.data?.exists) {
        setForgotStep("password");
      } else {
        setForgotError(data.message || "Email không tồn tại.");
      }
    } catch (err) {
      setForgotError("Lỗi kết nối máy chủ");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    if (forgotNewPass !== forgotConfirmPass) {
      setForgotError("Mật khẩu xác nhận không khớp");
      return;
    }
    setForgotLoading(true);
    try {
      const { API_BASE_URL } = await import("@/lib/env");
      const res = await fetch(`${API_BASE_URL}/api/all-platform/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim(), new_password: forgotNewPass })
      });
      const data = await res.json();
      if (data.success) {
        alert("Đổi mật khẩu thành công! Vui lòng đăng nhập lại bằng mật khẩu mới.");
        setForgotStep("hidden");
        setForgotEmail("");
        setForgotNewPass("");
        setForgotConfirmPass("");
        setEmail(forgotEmail.trim()); // Điền sẵn email vào form login
      } else {
        setForgotError(data.message || "Lỗi khi đổi mật khẩu.");
      }
    } catch (err) {
      setForgotError("Lỗi kết nối máy chủ");
    } finally {
      setForgotLoading(false);
    }
  };

  const isLoading = submitStatus === "loading";
  const isSuccess = submitStatus === "success";

  return (
    <GoogleOAuthProvider clientId={GOOGLE_OAUTH_CLIENT_ID}>
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "var(--color-background)" }}
    >



      {/* Animated orbs */}
      <div
        className="absolute rounded-full pointer-events-none z-0"
          style={{
          width: 500, height: 500,
          background: "var(--color-primary)",
          filter: "blur(100px)",
          opacity: 0.5,
          top: -100, left: -100,
          animation: "orb-float 25s infinite alternate ease-in-out",
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none z-0"
        style={{
          width: 600, height: 600,
          background: "var(--color-primary-container)",
          filter: "blur(100px)",
          opacity: 0.4,
          bottom: -200, right: -150,
          animation: "orb-float2 25s infinite alternate ease-in-out",
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none z-0"
        style={{
          width: 400, height: 400,
          background: "var(--color-on-primary-fixed-variant)",
          filter: "blur(100px)",
          opacity: 0.35,
          top: "30%", left: "55%",
          animation: "orb-float3 25s infinite alternate ease-in-out",
        }}
      />

      {/* Noise overlay */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-[0.04]" />

      <style>{`
        @keyframes orb-float {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(60px, 40px) scale(1.1); }
          100% { transform: translate(-30px, 80px) scale(0.95); }
        }
        @keyframes orb-float2 {
          0% { transform: translate(0, 0) rotate(0deg) scale(1); }
          50% { transform: translate(-40px, -30px) rotate(10deg) scale(1.05); }
          100% { transform: translate(30px, 60px) rotate(-5deg) scale(1); }
        }
        @keyframes orb-float3 {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, -20px) scale(1.08); }
          100% { transform: translate(-20px, 40px) scale(0.92); }
        }
        .card-glow {
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3), 0 25px 50px -12px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.1);
        }
        .input-glow:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(227,0,15,0.12);
          outline: none;
        }
        .tab-login.active {
          color: var(--color-primary);
          background: #fff0f0;
          border-bottom: 3px solid var(--color-on-primary-fixed-variant);
        }
        .tab-register.active {
          color: var(--color-primary);
          background: #fff0f0;
          border-bottom: 3px solid var(--color-on-primary-fixed-variant);
        }
      `}</style>

      {/* Main Card */}
      <main className="relative z-10 w-full max-w-[448px] mx-4">
        <div
          className="bg-surface rounded-xl card-glow overflow-hidden flex flex-col"
          style={{ border: "1px solid rgba(255,255,255,0.4)" }}
        >
          {/* ── Header ── */}
          <div
            className="flex flex-col items-center justify-center gap-4 px-6 py-8"
            style={{ background: "linear-gradient(135deg, var(--color-on-primary-fixed-variant) 0%, var(--color-primary) 100%)" }}
          >
            <div
              className="relative w-16 h-16 bg-surface rounded-xl flex items-center justify-center shadow-xl overflow-hidden"
              style={{ transform: "rotate(3deg)", transition: "transform 0.3s" }}
            >
              <Image
                src="/securityzone_logo.png"
                alt="SecurityZone"
                fill
                sizes="64px"
                className="object-contain p-2"
                priority
              />
            </div>
            <h1 className="text-white font-semibold text-xl leading-tight">
              {mode === "login" ? "Chào mừng trở lại" : "Tạo tài khoản mới"}
            </h1>
          </div>

          {/* ── Đăng nhập bằng Google (mặc định) ── */}
          {!showPasswordForm && (
            <div className="px-6 py-8 flex flex-col items-center gap-4">
              <p className="text-sm text-on-surface-variant text-center">
                Đăng nhập bằng tài khoản Google được cấp cho công việc tại Markee.
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setGoogleError("Đăng nhập Google thất bại. Vui lòng thử lại.")}
                  text="signin_with"
                  shape="pill"
                  width={280}
                />
              </div>
              {googleError && (
                <div className="w-full flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 font-medium">
                  <Icon name="error" className="text-red-500 text-base" />
                  {googleError}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowPasswordForm(true)}
                className="text-xs text-on-surface-variant hover:underline bg-transparent border-0 p-0 cursor-pointer mt-2"
              >
                Đăng nhập bằng mật khẩu (dev/test)
              </button>
            </div>
          )}

          {/* ── Tabs ── */}
          {showPasswordForm && (
          <>
          <div className="flex" style={{ borderBottom: "1px solid #e1e3e4" }}>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`flex-1 py-4 text-sm font-medium transition-all cursor-pointer border-0 ${
                mode === "login"
                  ? "tab-login active"
                  : "text-on-surface hover:bg-surface-container-low"
              }`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`flex-1 py-4 text-sm font-medium transition-all cursor-pointer border-0 ${
                mode === "register"
                  ? "tab-register active"
                  : "text-on-surface hover:bg-surface-container-low"
              }`}
            >
              Đăng ký
            </button>
          </div>

          {/* ── Form ── */}
          <div className="px-6 py-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">

              {/* Họ tên — chỉ register */}
              {mode === "register" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-on-surface">Họ tên</label>
                  <div className="relative">
                    <Icon
                      name="badge"
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
                    />
                    <input
                      type="text"
                      placeholder="Nhập họ và tên"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-surface border border-outline-variant rounded-xl text-sm input-glow transition-all placeholder:text-on-surface-variant/60"
                    />
                  </div>
                </div>
              )}

              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-on-surface">
                  Email <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Icon
                    name="mail"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
                  />
                  <input
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-3.5 py-2.5 bg-surface border border-outline-variant rounded-xl text-sm input-glow transition-all placeholder:text-on-surface-variant/60"
                  />
                </div>
              </div>

              {/* Mật khẩu */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-on-surface">
                    Mật khẩu <span className="text-red-500">*</span>
                  </label>
                  {mode === "login" && (
                    <button type="button" onClick={() => { setForgotStep("email"); setForgotEmail(""); setForgotError(null); }} className="text-xs text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer">
                      Quên mật khẩu?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Icon
                    name="lock"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
                  />
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full pl-10 pr-3.5 py-2.5 bg-surface border border-outline-variant rounded-xl text-sm input-glow transition-all placeholder:text-on-surface-variant/60"
                  />
                </div>
              </div>

              {/* Ghi nhớ — chỉ login */}
              {mode === "login" && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-4 h-4 rounded border-outline-variant text-primary cursor-pointer"
                  />
                  <label htmlFor="remember" className="text-sm text-on-surface cursor-pointer select-none">
                    Ghi nhớ đăng nhập
                  </label>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 font-medium">
                  <Icon name="error" className="text-red-500 text-base" />
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 text-white font-semibold text-base rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer border-0 mt-1"
                style={{
                  background: isLoading
                    ? "#ff9999"
                    : isSuccess
                    ? "#16a34a"
                    : "linear-gradient(135deg, var(--color-on-primary-fixed-variant) 0%, var(--color-primary) 100%)",
                  boxShadow: isLoading ? "none" : "0 4px 14px rgba(227,0,15,0.3)",
                  transition: "all 0.3s ease",
                }}
              >
                {isLoading ? (
                  <>
                    <Icon name="progress_activity" className="text-base animate-spin" />
                    <span>{mode === "login" ? "Đang đăng nhập..." : "Đang đăng ký..."}</span>
                  </>
                ) : isSuccess ? (
                  <>
                    <Icon name="check_circle" className="text-base" />
                    <span>Thành công!</span>
                  </>
                ) : (
                  <>
                    <span>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</span>
                    <Icon name="arrow_forward" className="text-base" />
                  </>
                )}
              </button>
            </form>

            {/* ── Social Divider — chỉ login ── */}
            {mode === "login" && (
              <>
                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t" style={{ borderColor: "#e1e3e4" }} />
                  </div>
                  <div className="relative flex justify-center">
                    <span
                      className="px-4 bg-surface text-on-surface-variant text-xs font-medium uppercase"
                      style={{ fontSize: 11 }}
                    >
                      Hoặc tiếp tục với
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="flex items-center justify-center gap-2 py-2 px-3 border rounded-xl transition-colors cursor-pointer bg-surface border-outline-variant hover:bg-surface-container-low"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 48 48">
                      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                      <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
                    </svg>
                    <span className="text-xs font-medium text-on-surface">Google</span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-2 py-2 px-3 border rounded-xl transition-colors cursor-pointer bg-surface border-outline-variant hover:bg-surface-container-low"
                  >
                    <svg className="w-5 h-5 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                    <span className="text-xs font-medium text-on-surface">Facebook</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Footer link ── */}
          <div
            className="px-6 pb-6 pt-0 text-center"
            style={{ background: "#f3f4f5" }}
          >
            <p className="text-sm text-on-surface">
              {mode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}{" "}
              <button
                type="button"
                onClick={() => switchMode(mode === "login" ? "register" : "login")}
                className="text-primary font-bold hover:underline bg-transparent border-none cursor-pointer p-0 text-sm"
              >
                {mode === "login" ? "Đăng ký ngay" : "Đăng nhập"}
              </button>
            </p>
            <button
              type="button"
              onClick={() => { setShowPasswordForm(false); setError(null); }}
              className="text-xs text-on-surface-variant hover:underline bg-transparent border-0 p-0 cursor-pointer mt-2"
            >
              Quay lại đăng nhập bằng Google
            </button>
          </div>
          </>
          )}
        </div>

        {/* ── System footer ── */}
        <footer className="mt-6 flex flex-col md:flex-row justify-center items-center gap-3 text-white/60 text-xs">
          <span>© 2026 MarkeeAI. All rights reserved.</span>
          <div className="flex gap-4">
            <a href="#" className="hover:text-white transition-colors">Điều khoản</a>
            <a href="#" className="hover:text-white transition-colors">Chính sách</a>
            <a href="#" className="hover:text-white transition-colors">Hỗ trợ</a>
          </div>
        </footer>
      </main>

      {/* ── Forgot Password Popup ── */}
      {forgotStep !== "hidden" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-surface rounded-xl w-[400px] max-w-[90vw] p-6 shadow-2xl animate-in zoom-in-95 fade-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-[#1f1c24]">
                {forgotStep === "email" ? "Quên mật khẩu" : "Đặt lại mật khẩu"}
              </h3>
              <button 
                onClick={() => setForgotStep("hidden")}
                className="text-on-surface-variant hover:bg-surface-container-low p-1 rounded-lg transition-colors border-0 bg-transparent cursor-pointer"
              >
                <Icon name="close" />
              </button>
            </div>

            {forgotStep === "email" && (
              <form onSubmit={handleCheckEmail} className="flex flex-col gap-4">
                <p className="text-sm text-on-surface-variant">Vui lòng nhập địa chỉ email bạn đã đăng ký để đặt lại mật khẩu.</p>
                <div className="relative">
                  <Icon name="mail" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl" />
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    className="w-full pl-10 pr-3 py-2.5 bg-surface border border-outline-variant rounded-xl text-sm focus:border-primary focus:ring-1 focus:ring-primary transition-all outline-none"
                  />
                </div>
                {forgotError && <p className="text-red-500 text-xs font-medium">{forgotError}</p>}
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-2.5 bg-gradient-to-r from-primary to-primary-container text-white rounded-xl font-semibold disabled:opacity-70 transition-all active:scale-95 border-0 cursor-pointer flex items-center justify-center gap-2"
                >
                  {forgotLoading ? <Icon name="progress_activity" className="animate-spin text-sm" /> : null}
                  Xác nhận
                </button>
              </form>
            )}

            {forgotStep === "password" && (
              <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
                <p className="text-sm text-on-surface-variant">Nhập mật khẩu mới cho tài khoản <b>{forgotEmail}</b></p>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-on-surface">Mật khẩu mới</label>
                  <div className="relative">
                    <Icon name="lock" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl" />
                    <input
                      type="password"
                      value={forgotNewPass}
                      onChange={(e) => setForgotNewPass(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full pl-10 pr-3 py-2 bg-surface border border-outline-variant rounded-xl text-sm focus:border-primary outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-on-surface">Xác nhận mật khẩu mới</label>
                  <div className="relative">
                    <Icon name="lock_reset" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl" />
                    <input
                      type="password"
                      value={forgotConfirmPass}
                      onChange={(e) => setForgotConfirmPass(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full pl-10 pr-3 py-2 bg-surface border border-outline-variant rounded-xl text-sm focus:border-primary outline-none"
                    />
                  </div>
                </div>

                {forgotError && <p className="text-red-500 text-xs font-medium">{forgotError}</p>}
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-2.5 mt-2 bg-gradient-to-r from-primary to-primary-container text-white rounded-xl font-semibold disabled:opacity-70 transition-all active:scale-95 border-0 cursor-pointer flex items-center justify-center gap-2"
                >
                  {forgotLoading ? <Icon name="progress_activity" className="animate-spin text-sm" /> : null}
                  Đổi mật khẩu
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
    </GoogleOAuthProvider>
  );
}
