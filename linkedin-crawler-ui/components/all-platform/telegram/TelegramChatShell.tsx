"use client";

/**
 * Telegram Chat — "Quản lý kênh & CSKH" (dùng Telethon ở backend, xem
 * app/modules/all_platform/telegram/). Cùng tinh thần luồng Zalo (kết nối tài khoản,
 * nhận/gửi tin nhắn realtime, gửi ảnh/media) nhưng gọn hơn: 1 trang duy nhất, không có
 * campaign/broadcast/forward-rules riêng.
 *
 * BẮT BUỘC: server phải cấu hình TELEGRAM_API_ID/TELEGRAM_API_HASH (lấy tại
 * https://my.telegram.org/apps) — thiếu 2 giá trị này thì KHÔNG kết nối được bất kỳ
 * tài khoản Telegram nào (báo lỗi rõ ràng khi bấm "Gửi mã").
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { telegramService } from "@/services/telegramService";
import type { TelegramAccount, TelegramDialog, TelegramMessage } from "@/types/telegram-api";

const STATUS_LABEL: Record<TelegramAccount["status"], string> = {
  pending: "Đang khởi tạo",
  awaiting_code: "Đang chờ mã OTP",
  awaiting_password: "Đang chờ mật khẩu 2FA",
  connected: "Đã kết nối",
  disconnected: "Đã ngắt kết nối",
  error: "Lỗi — cần kết nối lại",
};

const STATUS_COLOR: Record<TelegramAccount["status"], string> = {
  pending: "bg-slate-400",
  awaiting_code: "bg-amber-500",
  awaiting_password: "bg-amber-500",
  connected: "bg-emerald-500",
  disconnected: "bg-slate-400",
  error: "bg-red-500",
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("vi-VN");
}

export function TelegramChatShell() {
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showConnectFlow, setShowConnectFlow] = useState(false);

  const loadAccounts = useCallback(async (preferId?: string) => {
    const res = await telegramService.listAccounts();
    if (res.success) {
      const list = res.data || [];
      setAccounts(list);
      setSelectedAccountId((prev) => {
        const want = preferId || prev;
        if (want && list.some((a) => a.id === want)) return want;
        return list.find((a) => a.status === "connected")?.id ?? list[0]?.id ?? null;
      });
    }
    setLoadingAccounts(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  if (loadingAccounts) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 overflow-hidden bg-card">
      <div className="w-72 shrink-0 border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-sm text-foreground">Tài khoản Telegram</h2>
          <button
            type="button"
            onClick={() => setShowConnectFlow(true)}
            className="text-xs font-bold text-primary hover:underline"
          >
            + Kết nối
          </button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          {accounts.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">Chưa có tài khoản Telegram nào được kết nối.</div>
          ) : (
            accounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => {
                  setSelectedAccountId(acc.id);
                  setShowConnectFlow(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/50 transition",
                  selectedAccountId === acc.id && !showConnectFlow && "bg-primary/10",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_COLOR[acc.status])} />
                  <span className="text-sm font-semibold text-foreground truncate">
                    {acc.display_name || acc.username || acc.phone || acc.label || "Tài khoản Telegram"}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 ml-4">{STATUS_LABEL[acc.status]}</div>
                {acc.last_error && acc.status === "error" ? (
                  <div className="text-[10px] text-red-500 mt-0.5 ml-4 line-clamp-2">{acc.last_error}</div>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex">
        {showConnectFlow || !selectedAccount ? (
          <ConnectAccountFlow
            onDone={(accountId) => {
              setShowConnectFlow(false);
              loadAccounts(accountId);
            }}
            onCancel={accounts.length > 0 ? () => setShowConnectFlow(false) : undefined}
          />
        ) : (
          <ChatPanel key={selectedAccount.id} account={selectedAccount} onAccountRemoved={() => loadAccounts()} />
        )}
      </div>
    </div>
  );
}

// ── Kết nối tài khoản (số điện thoại + OTP + 2FA, hoặc bot token) ──────────────

function ConnectAccountFlow({ onDone, onCancel }: { onDone: (accountId: string) => void; onCancel?: () => void }) {
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
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-foreground">Kết nối Telegram</h3>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:underline">
              Đóng
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
            className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold", mode === "phone" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}
          >
            Số điện thoại
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("bot");
              reset();
            }}
            className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold", mode === "bot" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}
          >
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={busy || !phone.trim()}
                  onClick={handleSendCode}
                  className="w-full py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
                >
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={busy || !code.trim()}
                  onClick={handleVerifyCode}
                  className="w-full py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
                >
                  {busy ? "Đang xác thực..." : "Xác nhận mã"}
                </button>
                <button type="button" onClick={reset} className="text-xs text-muted-foreground hover:underline self-start">
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={busy || !password}
                  onClick={handleVerifyPassword}
                  className="w-full py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
                >
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
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={busy || !botToken.trim()}
              onClick={handleBotLogin}
              className="w-full py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
            >
              {busy ? "Đang kết nối..." : "Kết nối Bot"}
            </button>
          </div>
        )}

        {error ? <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div> : null}
      </div>
    </div>
  );
}

// ── Danh sách hội thoại + khung chat ────────────────────────────────────────────

function ChatPanel({ account, onAccountRemoved }: { account: TelegramAccount; onAccountRemoved: () => void }) {
  const [dialogs, setDialogs] = useState<TelegramDialog[]>([]);
  const [loadingDialogs, setLoadingDialogs] = useState(true);
  const [selectedDialogId, setSelectedDialogId] = useState<number | null>(null);

  const loadDialogs = useCallback(
    async (refresh = false) => {
      const res = await telegramService.listDialogs(account.id, refresh);
      if (res.success) setDialogs(res.data || []);
      setLoadingDialogs(false);
    },
    [account.id],
  );

  useEffect(() => {
    loadDialogs();
  }, [loadDialogs]);

  // SSE realtime — 1 kết nối cho account đang xem, refetch nhẹ khi có sự kiện thay vì
  // tự vá state tay (đơn giản, ít lỗi vặt hơn với khối lượng tin nhắn của 1 inbox CSKH).
  const selectedDialogIdRef = useRef<number | null>(null);
  selectedDialogIdRef.current = selectedDialogId;
  const [messageRefreshTick, setMessageRefreshTick] = useState(0);

  useEffect(() => {
    if (account.status !== "connected") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(telegramService.streamUrl());
    } catch {
      return;
    }
    const onMsg = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.account_id !== account.id) return;
        loadDialogs(false);
        if (payload.dialog_id === selectedDialogIdRef.current || payload.message?.dialog_id === selectedDialogIdRef.current) {
          setMessageRefreshTick((t) => t + 1);
        }
      } catch {
        // ignore malformed event
      }
    };
    es.addEventListener("telegram-message", onMsg);
    const timer = window.setInterval(() => loadDialogs(false), 20000);
    return () => {
      es?.close();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, account.status, loadDialogs]);

  const selectedDialog = dialogs.find((d) => d.dialog_id === selectedDialogId) || null;

  const handleDisconnect = async (revoke: boolean) => {
    if (!window.confirm(revoke ? "Đăng xuất hẳn tài khoản này khỏi Telegram?" : "Gỡ tài khoản này khỏi tool (vẫn đăng nhập Telegram trên máy khác)?")) return;
    await telegramService.disconnectAccount(account.id, revoke);
    onAccountRemoved();
  };

  return (
    <div className="flex flex-1 min-w-0">
      <div className="w-72 shrink-0 border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground truncate">{account.display_name || account.username || account.phone}</div>
            <div className="text-[10px] text-muted-foreground">{STATUS_LABEL[account.status]}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" title="Làm mới" onClick={() => loadDialogs(true)} className="p-1.5 rounded-lg hover:bg-muted">
              <span className="material-symbols-outlined text-[16px] text-muted-foreground">refresh</span>
            </button>
            <button type="button" title="Gỡ tài khoản" onClick={() => handleDisconnect(false)} className="p-1.5 rounded-lg hover:bg-muted">
              <span className="material-symbols-outlined text-[16px] text-red-500">link_off</span>
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          {loadingDialogs ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Đang tải hội thoại...</div>
          ) : dialogs.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Chưa có hội thoại nào.</div>
          ) : (
            dialogs.map((d) => (
              <button
                key={d.dialog_id}
                type="button"
                onClick={() => setSelectedDialogId(d.dialog_id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/50 transition",
                  selectedDialogId === d.dialog_id && "bg-primary/10",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">{d.title || "Không tên"}</span>
                  {d.unread_count > 0 ? (
                    <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                      {d.unread_count}
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">{d.last_message_preview || ""}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {selectedDialog ? (
        <MessageThread key={selectedDialog.dialog_id} account={account} dialog={selectedDialog} refreshTick={messageRefreshTick} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Chọn 1 hội thoại để xem tin nhắn</div>
      )}
    </div>
  );
}

function MessageThread({ account, dialog, refreshTick }: { account: TelegramAccount; dialog: TelegramDialog; refreshTick: number }) {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<TelegramMessage | null>(null);
  const [editing, setEditing] = useState<TelegramMessage | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await telegramService.listMessages(account.id, dialog.dialog_id, { limit: 60 });
    if (res.success) setMessages(res.data || []);
    setLoading(false);
  }, [account.id, dialog.dialog_id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (refreshTick > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const handleSend = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    if (editing) {
      const res = await telegramService.editMessage(account.id, dialog.dialog_id, editing.message_id, value);
      if (res.success && res.data) setMessages((prev) => prev.map((m) => (m.message_id === editing.message_id ? res.data! : m)));
      setEditing(null);
    } else {
      const res = await telegramService.sendText(account.id, dialog.dialog_id, value, replyTo?.message_id);
      if (res.success && res.data) setMessages((prev) => [...prev, res.data!]);
      setReplyTo(null);
    }
    setText("");
    setSending(false);
  };

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSending(true);
    const res = await telegramService.sendMedia(account.id, dialog.dialog_id, file, { replyTo: replyTo?.message_id });
    if (res.success && res.data) setMessages((prev) => [...prev, res.data!]);
    setReplyTo(null);
    setSending(false);
  };

  const handleDelete = async (m: TelegramMessage) => {
    if (!window.confirm("Xoá tin nhắn này?")) return;
    const res = await telegramService.deleteMessage(account.id, dialog.dialog_id, m.message_id);
    if (res.success) setMessages((prev) => prev.filter((x) => x.message_id !== m.message_id));
  };

  const handlePin = async (m: TelegramMessage) => {
    await telegramService.pinMessage(account.id, dialog.dialog_id, m.message_id, m.is_pinned);
    setMessages((prev) => prev.map((x) => (x.message_id === m.message_id ? { ...x, is_pinned: !x.is_pinned } : x)));
  };

  const messageById = useMemo(() => new Map(messages.map((m) => [m.message_id, m])), [messages]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="px-4 py-3 border-b border-border font-bold text-sm text-foreground">{dialog.title || "Hội thoại"}</div>
      <div className="flex-1 overflow-y-auto min-h-0 p-4 flex flex-col gap-2">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground">Đang tải tin nhắn...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground">Chưa có tin nhắn nào.</div>
        ) : (
          messages.map((m) => {
            const replySrc = m.reply_to_message_id ? messageById.get(m.reply_to_message_id) : null;
            return (
              <div key={m.message_id} className={cn("group flex flex-col max-w-[70%]", m.is_outgoing ? "self-end items-end" : "self-start items-start")}>
                {!m.is_outgoing && m.sender_name ? <div className="text-[10px] text-muted-foreground mb-0.5 ml-1">{m.sender_name}</div> : null}
                <div className={cn("rounded-2xl px-3 py-2 relative", m.is_outgoing ? "bg-primary text-white" : "bg-muted text-foreground")}>
                  {replySrc ? (
                    <div className={cn("text-[10px] rounded-lg px-2 py-1 mb-1 border-l-2", m.is_outgoing ? "border-white/50 bg-white/10" : "border-primary/50 bg-background/60")}>
                      {replySrc.text || (replySrc.media_type ? `[${replySrc.media_type}]` : "")}
                    </div>
                  ) : null}
                  {m.media_type === "photo" && m.media_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.media_url} alt="" className="rounded-lg max-w-[220px] mb-1" />
                  ) : m.media_url ? (
                    <a href={m.media_url} target="_blank" rel="noreferrer" className="text-xs underline block mb-1">
                      📎 Tải file ({m.media_type})
                    </a>
                  ) : null}
                  {m.text ? <div className="text-sm whitespace-pre-wrap break-words">{m.text}</div> : null}
                  <div className={cn("text-[9px] mt-1 flex items-center gap-1", m.is_outgoing ? "text-white/70" : "text-muted-foreground")}>
                    {m.is_pinned ? <span className="material-symbols-outlined text-[11px]">push_pin</span> : null}
                    {m.is_edited ? "đã sửa · " : ""}
                    {formatTime(m.sent_at)}
                  </div>
                </div>
                <div className="hidden group-hover:flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                  <button type="button" className="hover:underline" onClick={() => setReplyTo(m)}>
                    Trả lời
                  </button>
                  {m.is_outgoing && m.text ? (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => {
                        setEditing(m);
                        setText(m.text || "");
                      }}
                    >
                      Sửa
                    </button>
                  ) : null}
                  <button type="button" className="hover:underline" onClick={() => handlePin(m)}>
                    {m.is_pinned ? "Bỏ ghim" : "Ghim"}
                  </button>
                  <button type="button" className="hover:underline text-red-500" onClick={() => handleDelete(m)}>
                    Xoá
                  </button>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {(replyTo || editing) ? (
        <div className="px-4 py-1.5 bg-muted/60 border-t border-border flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground truncate">
            {editing ? "Đang sửa tin nhắn" : `Trả lời: ${replyTo?.text?.slice(0, 60) || `[${replyTo?.media_type}]`}`}
          </span>
          <button
            type="button"
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              setText("");
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="p-3 border-t border-border flex items-end gap-2">
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        <button type="button" onClick={handlePickFile} disabled={sending} className="p-2 rounded-xl hover:bg-muted shrink-0" title="Gửi ảnh/tệp">
          <span className="material-symbols-outlined text-[20px] text-muted-foreground">attach_file</span>
        </button>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Nhập tin nhắn..."
          className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary max-h-28"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 shrink-0"
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
