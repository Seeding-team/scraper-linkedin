"use client";

/**
 * Trang "Telegram Chat" (/all-platform/telegram-chat) — list các tài khoản Telegram đã
 * kết nối, chọn 1 tài khoản để nhảy sang trang chat full-screen riêng (/telegram-chat/{id}),
 * giống hệt luồng "Zalo Chat" (trang /all-platform/tai-khoan chọn account -> /zalo-chat).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { telegramService } from "@/services/telegramService";
import type { TelegramAccount } from "@/types/telegram-api";
import { TelegramConnectFlow } from "./TelegramConnectFlow";
import { Avatar } from "./telegram-ui";

const STATUS_LABEL: Record<TelegramAccount["status"], string> = {
  pending: "Đang khởi tạo",
  awaiting_code: "Đang chờ mã OTP",
  awaiting_password: "Đang chờ mật khẩu 2FA",
  connected: "Đã kết nối",
  disconnected: "Đã ngắt kết nối",
  error: "Lỗi — cần kết nối lại",
};

const STATUS_DOT: Record<TelegramAccount["status"], string> = {
  pending: "bg-slate-400",
  awaiting_code: "bg-amber-500",
  awaiting_password: "bg-amber-500",
  connected: "bg-emerald-500",
  disconnected: "bg-slate-400",
  error: "bg-red-500",
};

export function TelegramAccountsPageContent() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);

  const load = useCallback(async () => {
    const res = await telegramService.listAccounts();
    if (res.success) setAccounts(res.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (e: React.MouseEvent, acc: TelegramAccount) => {
    e.stopPropagation();
    if (!window.confirm(`Gỡ tài khoản "${acc.display_name || acc.username || acc.phone}" khỏi tool?`)) return;
    await telegramService.disconnectAccount(acc.id, false);
    load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white min-h-screen">
      <div className="max-w-5xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
          <span className="material-symbols-outlined text-primary text-[24px]">send</span>
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Telegram Chat</h1>
          <p className="text-xs text-muted-foreground">Kết nối tài khoản Telegram và trò chuyện ngay trong tool</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {accounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => acc.status === "connected" && router.push(`/telegram-chat/${acc.id}`)}
                disabled={acc.status !== "connected"}
                className={cn(
                  "text-left bg-card border border-border rounded-2xl p-4 flex items-center gap-3 transition shadow-sm",
                  acc.status === "connected" ? "hover:border-primary hover:shadow-md cursor-pointer" : "opacity-70 cursor-not-allowed",
                )}
              >
                <Avatar name={(acc.display_name || acc.username || acc.phone) ?? undefined} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-foreground truncate">
                    {acc.display_name || acc.username || acc.phone || acc.label || "Tài khoản Telegram"}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[acc.status])} />
                    <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[acc.status]}</span>
                  </div>
                  {acc.last_error && acc.status === "error" ? (
                    <div className="text-[10px] text-red-500 mt-1 line-clamp-2">{acc.last_error}</div>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {acc.status === "connected" ? <span className="material-symbols-outlined text-muted-foreground text-[18px]">chevron_right</span> : null}
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, acc)}
                    className="p-1 rounded-lg hover:bg-red-50"
                    title="Gỡ tài khoản"
                  >
                    <span className="material-symbols-outlined text-[16px] text-red-400 hover:text-red-600">close</span>
                  </button>
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="border-2 border-dashed border-border rounded-2xl p-4 flex items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition min-h-[84px]"
            >
              <span className="material-symbols-outlined text-[22px]">add_circle</span>
              <span className="text-sm font-bold">Kết nối tài khoản mới</span>
            </button>
          </div>

          {showConnect ? (
            <div className="mt-2">
              <TelegramConnectFlow
                onCancel={() => setShowConnect(false)}
                onDone={(accountId) => {
                  setShowConnect(false);
                  load();
                  router.push(`/telegram-chat/${accountId}`);
                }}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
    </div>
  );
}
