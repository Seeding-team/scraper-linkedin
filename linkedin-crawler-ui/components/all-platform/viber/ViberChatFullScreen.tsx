"use client";

/**
 * Trang chat Viber FULL-SCREEN cho 1 bot (/viber-chat/{accountId}) — cùng bố cục
 * TelegramChatFullScreen (khung hội thoại + khung tin nhắn). Viber Bot API không có
 * sửa/xoá/ghim/trả lời trích dẫn nên chỉ có gửi text (link tự bấm được), ảnh, tệp.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { viberService } from "@/services/viberService";
import type { ViberAccount, ViberDialog, ViberMessage, ViberStreamEvent } from "@/types/viber-api";
import { LinkifiedText, ViberAvatar, formatFileSize, formatMessageTime } from "./viber-ui";

const MESSAGE_STATUS_ICON: Partial<Record<ViberMessage["status"], { icon: string; title: string }>> = {
  sent: { icon: "done", title: "Đã gửi" },
  delivered: { icon: "done_all", title: "Đã nhận" },
  seen: { icon: "done_all", title: "Đã xem" },
  failed: { icon: "error", title: "Gửi lỗi" },
};

export function ViberChatFullScreen({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [account, setAccount] = useState<ViberAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);

  useEffect(() => {
    let cancelled = false;
    viberService.listAccounts().then((res) => {
      if (cancelled) return;
      setAccount((res.data || []).find((a) => a.id === accountId) || null);
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

  if (!account) {
    return (
      <div className="h-[calc(100vh-3rem)] w-full flex flex-col items-center justify-center gap-3 text-center px-6 overflow-hidden">
        <span className="material-symbols-outlined text-[40px] text-muted-foreground">error</span>
        <p className="text-sm text-muted-foreground">Không tìm thấy Viber Bot này hoặc bạn không có quyền truy cập.</p>
        <button
          type="button"
          onClick={() => router.push("/all-platform/viber-chat")}
          className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold"
        >
          Quay lại danh sách bot
        </button>
      </div>
    );
  }

  return <ConnectedChat account={account} onBack={() => router.push("/all-platform/viber-chat")} />;
}

function ConnectedChat({ account, onBack }: { account: ViberAccount; onBack: () => void }) {
  const [dialogs, setDialogs] = useState<ViberDialog[]>([]);
  const [loadingDialogs, setLoadingDialogs] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // MessageThread đang mở đăng ký vào đây để nhận tin mới / trạng thái qua SSE.
  const threadListenerRef = useRef<((event: ViberStreamEvent) => void) | null>(null);

  const loadDialogs = useCallback(async () => {
    const res = await viberService.listDialogs(account.id);
    if (res.success) setDialogs(res.data || []);
    setLoadingDialogs(false);
  }, [account.id]);

  useEffect(() => {
    let es: EventSource | null = null;
    const initial = window.setTimeout(loadDialogs, 0);
    try {
      es = new EventSource(viberService.streamUrl(), { withCredentials: true });
    } catch {
      es = null;
    }
    const onEvent = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as ViberStreamEvent;
        if (payload.account_id !== account.id) return;
        if (payload.type !== "status") loadDialogs();
        threadListenerRef.current?.(payload);
      } catch {
        // bỏ qua event lỗi định dạng
      }
    };
    es?.addEventListener("viber-message", onEvent);
    // Dự phòng khi SSE bị proxy cắt: vẫn làm mới danh sách định kỳ.
    const timer = window.setInterval(loadDialogs, 20000);
    return () => {
      es?.close();
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [account.id, loadDialogs]);

  const filteredDialogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dialogs;
    return dialogs.filter((d) => (d.name || "").toLowerCase().includes(q));
  }, [dialogs, search]);

  const selectedDialog = dialogs.find((d) => d.viber_user_id === selectedUserId) || null;

  return (
    <div className="h-[calc(100vh-3rem)] w-full flex bg-muted/20 overflow-hidden">
      {/* ── Panel hội thoại ── */}
      <div
        className={cn(
          "w-full md:w-[300px] shrink-0 border-r border-border flex-col h-full min-h-0 overflow-hidden bg-card",
          selectedDialog ? "hidden md:flex" : "flex",
        )}
      >
        <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
          <button type="button" onClick={onBack} className="p-1.5 rounded-xl hover:bg-muted shrink-0" title="Quay lại danh sách bot">
            <span className="material-symbols-outlined text-[20px] text-muted-foreground">arrow_back</span>
          </button>
          <ViberAvatar name={account.display_name || account.label} url={account.avatar_url} size={36} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground truncate">{account.display_name || account.label || "Viber Bot"}</div>
            <div className="flex items-center gap-1">
              <span className={cn("w-1.5 h-1.5 rounded-full", account.status === "connected" ? "bg-emerald-500" : "bg-red-500")} />
              <span className="text-[10px] text-muted-foreground">{account.status === "connected" ? "Đang hoạt động" : "Lỗi kết nối"}</span>
            </div>
          </div>
          <button type="button" title="Làm mới" onClick={loadDialogs} className="p-1.5 rounded-xl hover:bg-muted shrink-0">
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
              placeholder="Tìm khách hàng..."
              className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loadingDialogs ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Đang tải hội thoại...</div>
          ) : filteredDialogs.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground leading-relaxed">
              {dialogs.length === 0
                ? "Chưa có hội thoại nào. Viber không cho bot đọc lịch sử cũ — hội thoại sẽ xuất hiện khi khách nhắn tin tới bot."
                : "Không tìm thấy hội thoại phù hợp."}
            </div>
          ) : (
            filteredDialogs.map((d) => (
              <button
                key={d.viber_user_id}
                type="button"
                onClick={() => setSelectedUserId(d.viber_user_id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/40 hover:bg-muted/60 transition flex items-center gap-2.5",
                  selectedUserId === d.viber_user_id && "bg-primary/10 hover:bg-primary/10",
                )}
              >
                <ViberAvatar name={d.name} url={d.avatar_url} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold text-foreground truncate">{d.name || "Khách Viber"}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatMessageTime(d.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <span className="text-[11px] text-muted-foreground truncate">
                      {!d.is_subscribed ? "(đã huỷ theo dõi) " : ""}
                      {d.last_message_preview || "Chưa có tin nhắn"}
                    </span>
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
      <div className={cn("flex-1 min-w-0 h-full min-h-0 flex-col overflow-hidden", selectedDialog ? "flex" : "hidden md:flex")}>
        {selectedDialog ? (
          <MessageThread
            key={selectedDialog.viber_user_id}
            account={account}
            dialog={selectedDialog}
            listenerRef={threadListenerRef}
            onBack={() => setSelectedUserId(null)}
            onSeen={loadDialogs}
          />
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

function mergeMessages(prev: ViberMessage[], incoming: ViberMessage[]): ViberMessage[] {
  const byToken = new Map(prev.map((m) => [m.message_token, m]));
  for (const m of incoming) byToken.set(m.message_token, m);
  return Array.from(byToken.values()).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
}

function MessageThread({
  account,
  dialog,
  listenerRef,
  onBack,
  onSeen,
}: {
  account: ViberAccount;
  dialog: ViberDialog;
  listenerRef: React.MutableRefObject<((event: ViberStreamEvent) => void) | null>;
  onBack: () => void;
  onSeen: () => void;
}) {
  const [messages, setMessages] = useState<ViberMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const PAGE = 40;

  useEffect(() => {
    let cancelled = false;
    viberService.listMessages(account.id, dialog.viber_user_id, { limit: PAGE }).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setMessages(res.data || []);
        setHasOlder((res.data || []).length >= PAGE);
      }
      setLoading(false);
      onSeen();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, dialog.viber_user_id]);

  // Tin mới / cập nhật trạng thái (đã nhận/đã xem) đẩy qua SSE -> ghép thẳng vào list.
  useEffect(() => {
    listenerRef.current = (event) => {
      const m = event.message;
      if (m && m.viber_user_id === dialog.viber_user_id) setMessages((prev) => mergeMessages(prev, [m]));
    };
    return () => {
      listenerRef.current = null;
    };
  }, [listenerRef, dialog.viber_user_id]);

  const lastToken = messages[messages.length - 1]?.message_token;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastToken]);

  const loadOlder = async () => {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const res = await viberService.listMessages(account.id, dialog.viber_user_id, { limit: PAGE, before: messages[0].sent_at });
    if (res.success) {
      setMessages((prev) => mergeMessages(prev, res.data || []));
      setHasOlder((res.data || []).length >= PAGE);
    }
    setLoadingOlder(false);
  };

  const handleSend = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    const res = await viberService.sendText(account.id, dialog.viber_user_id, value);
    if (res.success && res.data) {
      setMessages((prev) => mergeMessages(prev, res.data!));
      setText("");
    } else {
      setError(res.message || "Gửi tin nhắn thất bại.");
    }
    setSending(false);
  };

  const sendFile = async (file: File) => {
    setSending(true);
    setError(null);
    const res = await viberService.sendMedia(account.id, dialog.viber_user_id, file);
    if (res.success && res.data) setMessages((prev) => mergeMessages(prev, res.data!));
    else setError(res.message || "Gửi tệp thất bại.");
    setSending(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await sendFile(file);
  };

  // Dán ảnh (Ctrl+V) -> gửi ngay, giống Telegram Chat.
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || sending) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) await sendFile(file);
        return;
      }
    }
  };

  return (
    <>
      <div className="px-4 py-3 border-b border-border bg-card flex items-center gap-3 shrink-0">
        <button type="button" onClick={onBack} className="md:hidden p-1.5 rounded-xl hover:bg-muted shrink-0" title="Quay lại">
          <span className="material-symbols-outlined text-[20px] text-muted-foreground">arrow_back</span>
        </button>
        <ViberAvatar name={dialog.name} url={dialog.avatar_url} size={38} />
        <div className="min-w-0">
          <div className="font-bold text-sm text-foreground truncate">{dialog.name || "Khách Viber"}</div>
          <div className="text-[11px] text-muted-foreground">
            {dialog.is_subscribed ? "Đang theo dõi bot" : "Đã huỷ theo dõi bot — có thể không gửi được tin"}
            {dialog.country ? ` · ${dialog.country}` : ""}
          </div>
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
          <>
            {hasOlder ? (
              <button
                type="button"
                onClick={loadOlder}
                disabled={loadingOlder}
                className="self-center text-[11px] text-primary font-semibold px-3 py-1 rounded-full hover:bg-primary/10 disabled:opacity-50"
              >
                {loadingOlder ? "Đang tải..." : "Tải tin cũ hơn"}
              </button>
            ) : null}
            {messages.map((m) => (
              <MessageBubble key={m.message_token} m={m} />
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-[11px] text-red-600 flex items-center justify-between gap-2 shrink-0">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="p-1 rounded-lg hover:bg-red-100">
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      ) : null}

      <div className="p-3 border-t border-border bg-card flex items-end gap-2 shrink-0">
        <input ref={imageInputRef} type="file" accept="image/*,video/mp4" className="hidden" onChange={handleFileChange} />
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={sending}
          className="p-2.5 rounded-xl hover:bg-muted shrink-0"
          title="Gửi ảnh / video"
        >
          <span className="material-symbols-outlined text-[20px] text-muted-foreground">image</span>
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="p-2.5 rounded-xl hover:bg-muted shrink-0"
          title="Gửi tệp (tối đa 50MB)"
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
          onPaste={handlePaste}
          placeholder="Nhập tin nhắn hoặc dán link... (dán ảnh để gửi ngay)"
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

function MessageBubble({ m }: { m: ViberMessage }) {
  const statusIcon = m.is_outgoing ? MESSAGE_STATUS_ICON[m.status] : undefined;
  const isImage = (m.media_type === "picture" || m.media_type === "sticker") && m.media_url;
  return (
    <div className={cn("flex flex-col max-w-[80%] md:max-w-[68%]", m.is_outgoing ? "self-end items-end" : "self-start items-start")}>
      {m.is_outgoing && m.sender_name ? <div className="text-[10px] text-muted-foreground mb-0.5 mr-1">{m.sender_name}</div> : null}
      <div
        className={cn(
          "rounded-2xl px-3.5 py-2 shadow-sm",
          m.is_outgoing ? "bg-primary text-white rounded-br-md" : "bg-card border border-border text-foreground rounded-bl-md",
          m.status === "failed" && "ring-2 ring-red-400",
        )}
      >
        {isImage ? (
          <a href={m.media_url!} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.media_url!} alt="" className={cn("rounded-xl mb-1.5", m.media_type === "sticker" ? "max-w-[120px]" : "max-w-[240px]")} />
          </a>
        ) : m.media_type === "video" && m.media_url ? (
          <video src={m.media_url} controls className="rounded-xl max-w-[260px] mb-1.5" />
        ) : m.media_url ? (
          <a
            href={m.media_url}
            target="_blank"
            rel="noreferrer"
            className={cn("text-xs underline flex items-center gap-1.5 mb-1.5", m.is_outgoing ? "text-white" : "text-primary")}
          >
            <span className="material-symbols-outlined text-[16px]">{m.media_type === "location" ? "location_on" : "description"}</span>
            {m.media_type === "location" ? "Xem vị trí" : `${m.file_name || "Tải tệp"}${m.file_size ? ` (${formatFileSize(m.file_size)})` : ""}`}
          </a>
        ) : null}
        {m.text ? <LinkifiedText text={m.text} outgoing={m.is_outgoing} /> : null}
        <div className={cn("text-[9.5px] mt-1 flex items-center gap-1 justify-end", m.is_outgoing ? "text-white/70" : "text-muted-foreground")}>
          <span>{formatMessageTime(m.sent_at)}</span>
          {statusIcon ? (
            <span
              className={cn("material-symbols-outlined text-[13px]", m.status === "seen" && "text-sky-200", m.status === "failed" && "text-red-200")}
              title={m.error ? `${statusIcon.title}: ${m.error}` : statusIcon.title}
            >
              {statusIcon.icon}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
