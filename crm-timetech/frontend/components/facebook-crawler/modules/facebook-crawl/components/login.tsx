"use client";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { Login_Schemas, LoginFormValues } from "../schemas/login_shemas";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useAuthHook } from "../hooks/use-login";
import { MaterialIcon } from "@/components/ui";

export default function LoginPage() {
  const [isEye, setIsEye] = useState<boolean>(false);
  const [otpInput, setOtpInput] = useState<string>("");

  // Nạp Custom Hook xử lý API
  const {
    isLoading,
    errorMessage,
    successMessage,
    isOtpModalOpen,
    setIsOtpModalOpen,
    handleLogin,
    handleVerifyOtp,
  } = useAuthHook();

  const { register, handleSubmit, getValues, formState: { errors } } = useForm<LoginFormValues>({
    resolver: zodResolver(Login_Schemas),
    defaultValues: { email: "", password: "", secret_2fa: "" },
  });

  return (
    <div className="min-h-screen w-full min-w-[100vw] flex items-center justify-center bg-surface-container-lowest p-lg relative">
      <div className="w-full max-w-[384px] min-w-[320px] sm:w-[384px] shrink-0 bg-surface rounded-xl border border-outline-variant shadow-xl p-lg">

        {/* Logo/Brand */}
        <div className="flex flex-col items-center text-center mb-lg">
          <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center shadow-lg mb-md">
            <MaterialIcon name="radar" className="text-on-primary text-[32px]" />
          </div>
          <h1 className="text-h2 text-on-surface font-black">CrawlFB</h1>
          <p className="text-body-sm text-on-surface-variant mt-xs">Hệ thống tự động hóa thu thập dữ liệu</p>
        </div>

        {/* Thông báo */}
        {errorMessage && (
          <div className="mb-md p-sm bg-error-container/40 text-error text-body-sm rounded-lg border border-error-container">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="mb-md p-sm bg-secondary-container/20 text-on-secondary-container text-body-sm rounded-lg border border-secondary-container">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit(handleLogin)} className="flex flex-col gap-md">
          {/* Email */}
          <div className="flex flex-col gap-base">
            <label htmlFor="userName" className="text-label-md text-on-surface-variant font-semibold uppercase">
              Email đăng nhập
            </label>
            <input
              id="userName"
              placeholder="email or phone"
              className="w-full border border-outline-variant rounded-lg px-md py-sm outline-none transition-colors bg-surface text-on-surface focus:border-primary"
              {...register("email")}
            />
            {errors.email && (
              <span className="text-xs text-error font-medium">{errors.email.message}</span>
            )}
          </div>

          {/* Mật khẩu */}
          <div className="flex flex-col gap-base">
            <label htmlFor="password" className="text-label-md text-on-surface-variant font-semibold uppercase">
              Mật khẩu
            </label>
            <div className="relative">
              <input
                id="password"
                type={isEye ? "text" : "password"}
                placeholder={isEye ? "Nhập mật khẩu" : "••••••••"}
                className="w-full border border-outline-variant rounded-lg px-md py-sm pr-12 outline-none transition-colors bg-surface text-on-surface focus:border-primary"
                {...register("password")}
              />
              <button
                type="button"
                className="absolute right-md top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors text-xs font-bold uppercase"
                onClick={() => setIsEye(!isEye)}
                aria-label={isEye ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {isEye ? <FaEye className="text-lg" /> : <FaEyeSlash className="text-lg" />}
              </button>
            </div>
            {errors.password && (
              <span className="text-xs text-error font-medium">{errors.password.message}</span>
            )}
          </div>

          {/* Secret 2FA */}
          <div className="flex flex-col gap-base">
            <label htmlFor="secret_2fa" className="text-label-md text-on-surface-variant font-semibold uppercase">
              Mã Secret 2FA{" "}
              <span className="normal-case font-normal text-on-surface-variant/60">(Tùy chọn)</span>
            </label>
            <input
              id="secret_2fa"
              placeholder="JBSWY3DPEHPK3PXP..."
              className="w-full border border-outline-variant rounded-lg px-md py-sm outline-none transition-colors bg-surface-container-low text-on-surface focus:border-primary text-sm"
              {...register("secret_2fa")}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary text-on-primary hover:bg-primary/90 font-bold py-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide text-sm mt-xs"
          >
            {isLoading ? "Đang xử lý..." : "Đăng nhập"}
          </button>
        </form>
      </div>

      {/* MODAL OTP */}
      {isOtpModalOpen && (
        <div
          className="fixed inset-0 bg-black/45 backdrop-blur-[1px] flex items-center justify-center z-50 p-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="otp-modal-title"
        >
          <div className="border-outline-variant bg-surface w-full max-w-[384px] rounded-xl border p-lg shadow-xl flex flex-col items-center">
            {/* Icon cảnh báo */}
            <div className="w-12 h-12 rounded-full bg-secondary-container/30 flex items-center justify-center text-secondary mb-md">
              <MaterialIcon name="lock" className="text-[24px]" />
            </div>

            <h3 id="otp-modal-title" className="text-h3 text-on-surface font-semibold mb-xs">
              Yêu cầu xác thực OTP
            </h3>
            <p className="text-body-sm text-on-surface-variant text-center mb-md">
              Facebook đang yêu cầu nhập mã gửi về điện thoại/email của bạn.
            </p>

            <input
              type="text"
              maxLength={8}
              placeholder="Nhập mã 6–8 số"
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value)}
              className="w-full border border-outline-variant focus:border-primary rounded-lg px-md py-sm text-center text-lg font-bold tracking-widest outline-none transition-colors bg-surface mb-md"
            />

            <div className="flex w-full gap-sm">
              <button
                type="button"
                onClick={() => setIsOtpModalOpen(false)}
                className="flex-1 rounded-lg px-md py-sm text-sm font-bold uppercase text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => handleVerifyOtp(otpInput, getValues())}
                className="flex-1 bg-primary text-on-primary hover:bg-primary/90 rounded-lg px-md py-sm text-sm font-bold uppercase transition-colors disabled:opacity-50"
              >
                {isLoading ? "Đang gửi..." : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}