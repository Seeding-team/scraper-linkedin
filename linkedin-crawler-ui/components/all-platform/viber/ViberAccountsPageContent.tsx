"use client";

/**
 * Trang "Viber Chat" (/all-platform/viber-chat) — list các Viber Bot đã kết nối, chọn 1
 * bot để sang trang chat full-screen (/viber-chat/{id}), cùng khuôn Telegram Chat.
 *
 * Viber không có API cho tài khoản cá nhân -> mỗi "tài khoản" ở đây là 1 Viber Bot (tạo ở
 * partners.viber.com, lấy auth token). Khách nhắn bot -> hiện trong tool; trả lời trong
 * tool -> khách nhận trên Viber.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { viberService } from "@/services/viberService";
import type { ViberAccount } from "@/types/viber-api";
import { ViberAvatar } from "./viber-ui";

const STATUS_LABEL: Record<ViberAccount["status"], string> = {
  pending: "Đang khởi tạo",
  connected: "Đã kết nối",
  disconnected: "Đã ngắt kết nối",
  error: "Lỗi — cần kết nối lại",
};

const STATUS_DOT: Record<ViberAccount["status"], string> = {
  pending: "bg-slate-400",
  connected: "bg-emerald-500",
  disconnected: "bg-slate-400",
  error: "bg-red-500",
};

export function ViberAccountsPageContent() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ViberAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const applyAccounts = useCallback((res: Awaited<ReturnType<typeof viberService.listAccounts>>) => {
    if (res.success) setAccounts(res.data || []);
    setLoading(false);
  }, []);

  const load = useCallback(() => viberService.listAccounts().then(applyAccounts), [applyAccounts]);

  useEffect(() => {
    let cancelled = false;
    viberService.listAccounts().then((res) => !cancelled && applyAccounts(res));
    return () => {
      cancelled = true;
    };
  }, [applyAccounts]);

  const handleDelete = async (e: React.MouseEvent, acc: ViberAccount) => {
    e.stopPropagation();
    if (!window.confirm(`Gỡ bot "${acc.display_name || acc.label || acc.bot_uri}" khỏi tool? (tool sẽ ngừng nhận tin nhắn của bot này)`)) return;
    await viberService.disconnectAccount(acc.id);
    load();
  };

  const handleReconnect = async (e: React.MouseEvent, acc: ViberAccount) => {
    e.stopPropagation();
    setBusyId(acc.id);
    const res = await viberService.reconnect(acc.id);
    setBusyId(null);
    if (!res.success) window.alert(res.message || "Kết nối lại thất bại.");
    load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white min-h-screen">
      <div className="max-w-5xl mx-auto w-full flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
            <span className="material-symbols-outlined text-violet-600 text-[24px]">phone_in_talk</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Viber Chat</h1>
            <p className="text-xs text-muted-foreground">Kết nối Viber Bot và trò chuyện với khách hàng ngay trong tool</p>
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
                <div
                  key={acc.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => acc.status === "connected" && router.push(`/viber-chat/${acc.id}`)}
                  onKeyDown={(e) => e.key === "Enter" && acc.status === "connected" && router.push(`/viber-chat/${acc.id}`)}
                  className={cn(
                    "text-left bg-card border border-border rounded-2xl p-4 flex items-center gap-3 transition shadow-sm",
                    acc.status === "connected" ? "hover:border-primary hover:shadow-md cursor-pointer" : "opacity-80",
                  )}
                >
                  <ViberAvatar name={acc.display_name || acc.label} url={acc.avatar_url} size={48} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-foreground truncate">{acc.display_name || acc.label || "Viber Bot"}</div>
                    {acc.bot_uri ? <div className="text-[11px] text-muted-foreground truncate">@{acc.bot_uri}</div> : null}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[acc.status])} />
                      <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[acc.status]}</span>
                      {acc.subscribers_count != null ? (
                        <span className="text-[11px] text-muted-foreground">· {acc.subscribers_count} người theo dõi</span>
                      ) : null}
                    </div>
                    {acc.last_error && acc.status !== "connected" ? (
                      <div className="text-[10px] text-red-500 mt-1 line-clamp-2">{acc.last_error}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {acc.status === "connected" ? (
                      <span className="material-symbols-outlined text-muted-foreground text-[18px]">chevron_right</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleReconnect(e, acc)}
                        disabled={busyId === acc.id}
                        className="text-[11px] font-bold text-primary hover:underline disabled:opacity-50"
                      >
                        {busyId === acc.id ? "Đang kết nối..." : "Kết nối lại"}
                      </button>
                    )}
                    <button type="button" onClick={(e) => handleDelete(e, acc)} className="p-1 rounded-lg hover:bg-red-50" title="Gỡ bot">
                      <span className="material-symbols-outlined text-[16px] text-red-400 hover:text-red-600">close</span>
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="border-2 border-dashed border-border rounded-2xl p-4 flex items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition min-h-[84px]"
              >
                <span className="material-symbols-outlined text-[22px]">add_circle</span>
                <span className="text-sm font-bold">Kết nối Viber Bot mới</span>
              </button>
            </div>

            {showConnect ? (
              <ViberConnectForm
                onCancel={() => setShowConnect(false)}
                onDone={(accountId) => {
                  setShowConnect(false);
                  load();
                  router.push(`/viber-chat/${accountId}`);
                }}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ViberConnectForm({ onCancel, onDone }: { onCancel: () => void; onDone: (accountId: string) => void }) {
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await viberService.connectBot(token.trim(), label.trim() || undefined);
    setSubmitting(false);
    if (res.success && res.data) onDone(res.data.id);
    else setError(res.message || "Kết nối thất bại.");
  };

  return (
    <form onSubmit={submit} className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-sm">
      <div>
        <h2 className="text-sm font-bold text-foreground">Kết nối Viber Bot</h2>
        <ol className="text-xs text-muted-foreground mt-2 list-decimal pl-4 space-y-1">
          <li>
            Tạo bot tại{" "}
            <a href="https://partners.viber.com" target="_blank" rel="noreferrer" className="text-primary underline">
              partners.viber.com
            </a>{" "}
            (hoặc dùng bot sẵn có của công ty).
          </li>
          <li>Trong trang quản lý bot, sao chép <b>Token</b> (auth token) và dán vào ô dưới.</li>
          <li>Tool tự đăng ký webhook — từ lúc này khách nhắn bot sẽ hiện trong tool, bạn trả lời ngay tại đây.</li>
        </ol>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-foreground">Auth token</span>
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="4453b6ac12345678-e02c5f12174805f9-..."
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-foreground">Tên gợi nhớ (không bắt buộc)</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="VD: Viber CSKH Markee"
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>
      {error ? <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-semibold hover:bg-muted">
          Huỷ
        </button>
        <button
          type="submit"
          disabled={!token.trim() || submitting}
          className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
        >
          {submitting ? "Đang kết nối..." : "Kết nối"}
        </button>
      </div>
    </form>
  );
}
