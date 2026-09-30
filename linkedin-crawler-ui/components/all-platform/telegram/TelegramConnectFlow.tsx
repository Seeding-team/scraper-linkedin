"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { telegramService } from "@/services/telegramService";

export function TelegramConnectFlow({ onDone, onCancel }: { onDone: (accountId: string) => void; onCancel?: () => void }) {
  const [mode, setMode] = useState<"phone" | "bot">("phone");
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [botToken, setBotToken] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep("phone");
    setPhone("");
    setCode("");
    setPassword("");
    setAccountId(null);
    setError(null);
  };

  const handleSendCode = async () => {
    setBusy(true);
    setError(null);
    const res = await telegramService.sendCode(phone.trim());
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.message || "Không gửi được mã xác thực.");
      return;
    }
    setAccountId(res.data.account_id);
    setStep("code");
  };

  const handleVerifyCode = async () => {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    const res = await telegramService.verifyCode(accountId, code.trim());
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.message || "Mã xác thực không đúng.");
      return;
    }
    if (res.data.status === "awaiting_password") {
      setStep("password");
      return;
    }
    onDone(accountId);
  };

  const handleVerifyPassword = async () => {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    const res = await telegramService.verifyPassword(accountId, password);
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.message || "Sai mật khẩu xác thực 2 lớp.");
      return;
    }
    onDone(accountId);
  };

  const handleBotLogin = async () => {
    setBusy(true);
    setError(null);
    const res = await telegramService.botLogin(botToken.trim());
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.message || "Đăng nhập bot thất bại.");
      return;
    }
    onDone(res.data.account_id);
  };

  return (
    <div className="w-full max-w-sm mx-auto bg-card border border-border rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
          <span className="material-symbols-outlined text-primary text-[22px]">send</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base text-foreground">Kết nối Telegram</h3>
          <p className="text-[11px] text-muted-foreground">Số điện thoại + OTP, hoặc Bot Token</p>
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted shrink-0">
            <span className="material-symbols-outlined text-[18px] text-muted-foreground">close</span>
          </button>
        ) : null}
      </div>

      <div className="flex gap-1 mb-4 rounded-xl bg-muted p-1">
        <button
          type="button"
          onClick={() => {
            setMode("phone");
            reset();
          }}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1",
            mode === "phone" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="material-symbols-outlined text-[15px]">smartphone</span>
          Số điện thoại
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("bot");
            reset();
          }}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1",
            mode === "bot" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="material-symbols-outlined text-[15px]">smart_toy</span>
          Bot Token
        </button>
      </div>

      {mode === "phone" ? (
        <div className="flex flex-col gap-3">
          {step === "phone" ? (
            <>
              <label className="text-xs font-bold text-foreground">Số điện thoại (kèm mã quốc gia, VD +84...)</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+84901234567"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                disabled={busy || !phone.trim()}
                onClick={handleSendCode}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {busy ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">sms</span>}
                {busy ? "Đang gửi..." : "Gửi mã xác thực"}
              </button>
            </>
          ) : step === "code" ? (
            <>
              <label className="text-xs font-bold text-foreground">Nhập mã Telegram vừa gửi tới {phone}</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="12345"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                disabled={busy || !code.trim()}
                onClick={handleVerifyCode}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {busy ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">check_circle</span>}
                {busy ? "Đang xác thực..." : "Xác nhận mã"}
              </button>
              <button type="button" onClick={reset} className="text-xs text-muted-foreground hover:underline self-start inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                Đổi số điện thoại
              </button>
            </>
          ) : (
            <>
              <label className="text-xs font-bold text-foreground">Tài khoản này bật xác thực 2 lớp — nhập mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                disabled={busy || !password}
                onClick={handleVerifyPassword}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {busy ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">lock</span>}
                {busy ? "Đang xác thực..." : "Xác nhận mật khẩu"}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="text-xs font-bold text-foreground">Bot Token (lấy từ @BotFather trên Telegram)</label>
          <input
            type="text"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            disabled={busy || !botToken.trim()}
            onClick={handleBotLogin}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            {busy ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">smart_toy</span>}
            {busy ? "Đang kết nối..." : "Kết nối Bot"}
          </button>
        </div>
      )}

      {error ? (
        <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5 flex items-start gap-1.5">
          <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
          {error}
        </div>
      ) : null}
    </div>
  );
}
