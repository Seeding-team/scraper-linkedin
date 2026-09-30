"use client";

/**
 * Trang chat Telegram FULL-SCREEN cho 1 tài khoản (/telegram-chat/{accountId}) — giống
 * tinh thần ZaloChatView: rộng rãi, không có sidebar menu con, chỉ 2 khung (hội thoại +
 * tin nhắn) cuộn độc lập bên trong 1 khung có chiều cao cố định (AllPlatformShell tự cho
 * route này `h-[calc(100svh-3rem)] overflow-hidden` — xem isChatPage).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { telegramService } from "@/services/telegramService";
import type { TelegramAccount, TelegramDialog, TelegramMessage } from "@/types/telegram-api";
import { Avatar, DIALOG_TYPE_LABEL, formatMessageTime } from "./telegram-ui";

const STATUS_LABEL: Record<TelegramAccount["status"], string> = {
  pending: "Đang khởi tạo",
  awaiting_code: "Đang chờ mã OTP",
  awaiting_password: "Đang chờ mật khẩu 2FA",
  connected: "Đang hoạt động",
  disconnected: "Đã ngắt kết nối",
  error: "Lỗi kết nối",
};

export function TelegramChatFullScreen({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [account, setAccount] = useState<TelegramAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    telegramService.listAccounts().then((res) => {
      if (cancelled) return;
      const found = (res.data || []).find((a) => a.id === accountId) || null;
      setAccount(found);
      setNotFound(!found);
      setLoadingAccount(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (loadingAccount) {
    return (
      <div className="h-[calc(100vh-3rem)] w-full flex items-center justify-center overflow-hidden">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !account) {
    return (
      <div className="h-[calc(100vh-3rem)] w-full flex flex-col items-center justify-center gap-3 text-center px-6 overflow-hidden">
        <span className="material-symbols-outlined text-[40px] text-muted-foreground">error</span>
        <p className="text-sm text-muted-foreground">Không tìm thấy tài khoản Telegram này hoặc bạn không có quyền truy cập.</p>
        <button
          type="button"
          onClick={() => router.push("/all-platform/telegram-chat")}
          className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold"
        >
          Quay lại danh sách tài khoản
        </button>
      </div>
    );
  }

  return <ConnectedChat account={account} onBack={() => router.push("/all-platform/telegram-chat")} />;
}

function ConnectedChat({ account, onBack }: { account: TelegramAccount; onBack: () => void }) {
  const [dialogs, setDialogs] = useState<TelegramDialog[]>([]);
  const [loadingDialogs, setLoadingDialogs] = useState(true);
  const [selectedDialogId, setSelectedDialogId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

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

  const filteredDialogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dialogs;
    return dialogs.filter((d) => (d.title || "").toLowerCase().includes(q));
  }, [dialogs, search]);

  const selectedDialog = dialogs.find((d) => d.dialog_id === selectedDialogId) || null;

  return (
    <div className="h-[calc(100vh-3rem)] w-full flex bg-muted/20 overflow-hidden">
      {/* ── Panel hội thoại ── */}
      <div className="w-[300px] shrink-0 border-r border-border flex flex-col h-full min-h-0 overflow-hidden bg-card">
        <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
          <button type="button" onClick={onBack} className="p-1.5 rounded-xl hover:bg-muted shrink-0" title="Quay lại danh sách tài khoản">
            <span className="material-symbols-outlined text-[20px] text-muted-foreground">arrow_back</span>
          </button>
          <Avatar name={account.display_name || account.username || account.phone} size={36} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground truncate">{account.display_name || account.username || account.phone}</div>
            <div className="flex items-center gap-1">
              <span className={cn("w-1.5 h-1.5 rounded-full", account.status === "connected" ? "bg-emerald-500" : "bg-red-500")} />
              <span className="text-[10px] text-muted-foreground">{STATUS_LABEL[account.status]}</span>
            </div>
          </div>
          <button type="button" title="Làm mới" onClick={() => loadDialogs(true)} className="p-1.5 rounded-xl hover:bg-muted shrink-0">
            <span className="material-symbols-outlined text-[18px] text-muted-foreground">refresh</span>
          </button>
        </div>

        <div className="p-2.5 border-b border-border shrink-0">
          <div className="relative">
            <span className="material-symbols-outlined text-[16px] text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm hội thoại..."
              className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingDialogs ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Đang tải hội thoại...</div>
          ) : filteredDialogs.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {dialogs.length === 0 ? "Chưa có hội thoại nào." : "Không tìm thấy hội thoại phù hợp."}
            </div>
          ) : (
            filteredDialogs.map((d) => (
              <button
                key={d.dialog_id}
                type="button"
                onClick={() => setSelectedDialogId(d.dialog_id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/40 hover:bg-muted/60 transition flex items-center gap-2.5",
                  selectedDialogId === d.dialog_id && "bg-primary/10 hover:bg-primary/10",
                )}
              >
                <Avatar name={d.title} type={d.dialog_type} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-foreground truncate">{d.title || "Không tên"}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatMessageTime(d.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <span className="text-[11px] text-muted-foreground truncate">{d.last_message_preview || "Chưa có tin nhắn"}</span>
                    {d.unread_count > 0 ? (
                      <span className="shrink-0 min-w-[17px] h-[17px] px-1 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
                        {d.unread_count > 99 ? "99+" : d.unread_count}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Panel tin nhắn ── */}
      <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col overflow-hidden">
        {selectedDialog ? (
          <MessageThread key={selectedDialog.dialog_id} account={account} dialog={selectedDialog} refreshTick={messageRefreshTick} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <span className="material-symbols-outlined text-[48px]">forum</span>
            <p className="text-sm">Chọn 1 hội thoại bên trái để bắt đầu trò chuyện</p>
          </div>
        )}
      </div>
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
    // Gioi han 30 (thay vi 50+) cho lan mo dau tien de tra ve nhanh hon - lich su cu
    // hon nap them qua nut "Tai tin cu" (chua lam trong MVP nay, xem ghi chu cuoi file).
    const res = await telegramService.listMessages(account.id, dialog.dialog_id, { limit: 30 });
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
    <>
      <div className="px-4 py-3 border-b border-border bg-card flex items-center gap-3 shrink-0">
        <Avatar name={dialog.title} type={dialog.dialog_type} size={38} />
        <div className="min-w-0">
          <div className="font-bold text-sm text-foreground truncate">{dialog.title || "Hội thoại"}</div>
          <div className="text-[11px] text-muted-foreground">{DIALOG_TYPE_LABEL[dialog.dialog_type]}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 flex flex-col gap-2.5 bg-muted/10">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">Đang tải tin nhắn...</div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <span className="material-symbols-outlined text-[36px]">chat_bubble</span>
            <p className="text-xs">Chưa có tin nhắn nào.</p>
          </div>
        ) : (
          messages.map((m) => {
            const replySrc = m.reply_to_message_id ? messageById.get(m.reply_to_message_id) : null;
            return (
              <div key={m.message_id} className={cn("group flex flex-col max-w-[68%]", m.is_outgoing ? "self-end items-end" : "self-start items-start")}>
                {!m.is_outgoing && m.sender_name && dialog.dialog_type !== "user" ? (
                  <div className="text-[10px] font-semibold text-primary mb-0.5 ml-1">{m.sender_name}</div>
                ) : null}
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2 relative shadow-sm",
                    m.is_outgoing ? "bg-primary text-white rounded-br-md" : "bg-card border border-border text-foreground rounded-bl-md",
                  )}
                >
                  {replySrc ? (
                    <div
                      className={cn(
                        "text-[10px] rounded-lg px-2 py-1 mb-1.5 border-l-2 flex items-center gap-1",
                        m.is_outgoing ? "border-white/60 bg-white/10" : "border-primary/50 bg-muted/60",
                      )}
                    >
                      <span className="material-symbols-outlined text-[12px]">reply</span>
                      <span className="truncate">{replySrc.text || (replySrc.media_type ? `[${replySrc.media_type}]` : "")}</span>
                    </div>
                  ) : null}
                  {m.media_type === "photo" && m.media_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.media_url} alt="" className="rounded-xl max-w-[240px] mb-1.5" />
                  ) : m.media_url ? (
                    <a href={m.media_url} target="_blank" rel="noreferrer" className={cn("text-xs underline flex items-center gap-1.5 mb-1.5", m.is_outgoing ? "text-white" : "text-primary")}>
                      <span className="material-symbols-outlined text-[16px]">
                        {m.media_type === "video" ? "videocam" : m.media_type === "voice" ? "mic" : "description"}
                      </span>
                      Tải file ({m.media_type})
                    </a>
                  ) : null}
                  {m.text ? <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.text}</div> : null}
                  <div className={cn("text-[9.5px] mt-1 flex items-center gap-1 justify-end", m.is_outgoing ? "text-white/70" : "text-muted-foreground")}>
                    {m.is_pinned ? <span className="material-symbols-outlined text-[11px]">push_pin</span> : null}
                    {m.is_edited ? <span>đã sửa</span> : null}
                    <span>{formatMessageTime(m.sent_at)}</span>
                    {m.is_outgoing ? <span className="material-symbols-outlined text-[13px]">done_all</span> : null}
                  </div>
                </div>
                <div className="hidden group-hover:flex items-center gap-2.5 mt-1 text-[10px] text-muted-foreground px-1">
                  <button type="button" className="hover:text-primary inline-flex items-center gap-0.5" onClick={() => setReplyTo(m)}>
                    <span className="material-symbols-outlined text-[13px]">reply</span>Trả lời
                  </button>
                  {m.is_outgoing && m.text ? (
                    <button
                      type="button"
                      className="hover:text-primary inline-flex items-center gap-0.5"
                      onClick={() => {
                        setEditing(m);
                        setText(m.text || "");
                      }}
                    >
                      <span className="material-symbols-outlined text-[13px]">edit</span>Sửa
                    </button>
                  ) : null}
                  <button type="button" className="hover:text-primary inline-flex items-center gap-0.5" onClick={() => handlePin(m)}>
                    <span className="material-symbols-outlined text-[13px]">push_pin</span>
                    {m.is_pinned ? "Bỏ ghim" : "Ghim"}
                  </button>
                  <button type="button" className="hover:text-red-500 inline-flex items-center gap-0.5" onClick={() => handleDelete(m)}>
                    <span className="material-symbols-outlined text-[13px]">delete</span>Xoá
                  </button>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {replyTo || editing ? (
        <div className="px-4 py-2 bg-primary/5 border-t border-border flex items-center justify-between text-[11px] shrink-0">
          <span className="text-foreground/80 truncate inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px] text-primary">{editing ? "edit" : "reply"}</span>
            {editing ? "Đang sửa tin nhắn" : `Trả lời: ${replyTo?.text?.slice(0, 60) || `[${replyTo?.media_type}]`}`}
          </span>
          <button
            type="button"
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              setText("");
            }}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted"
          >
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      ) : null}

      <div className="p-3 border-t border-border bg-card flex items-end gap-2 shrink-0">
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="p-2.5 rounded-xl hover:bg-muted shrink-0"
          title="Gửi ảnh/tệp"
        >
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
          className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 max-h-28"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="w-10 h-10 rounded-full bg-primary text-white disabled:opacity-50 shrink-0 flex items-center justify-center"
          title="Gửi"
        >
          {sending ? (
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <span className="material-symbols-outlined text-[19px]">send</span>
          )}
        </button>
      </div>
    </>
  );
}
