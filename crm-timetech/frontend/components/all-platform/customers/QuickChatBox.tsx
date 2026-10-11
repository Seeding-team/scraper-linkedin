"use client";

/**
 * QuickChatBox — box chat nổi góc phải màn hình (kiểu Messenger popup) cho trang CRM.
 *
 * Cho phép nhắn nhanh với khách ngay tại trang Khách hàng, không cần chuyển qua
 * trang Inbox Facebook. Dùng đúng API Markee service như trang Inbox:
 *   GET  /sessions                                → tìm acc FB nào đang giữ hội thoại
 *   GET  /inbox/thread?user_id=&conv_id=          → tải tin nhắn
 *   POST /inbox/reply {user_id, conv_id, text}    → gửi trả lời
 *   GET  /inbox/reply_status?command_id=&user_id= → xác nhận đã gửi
 *
 * CRM chỉ lưu conv_id (không lưu acc FB sở hữu hội thoại) nên box sẽ dò lần lượt
 * các acc trong /sessions cho tới khi acc nào trả về tin nhắn của conv_id này.
 * Acc tìm được sẽ được cache lại theo conv_id cho lần mở sau.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Send, ExternalLink, Loader2, WifiOff } from "lucide-react";
import { fbFetch, fbHeaders } from "@/lib/markee-fb-api";
import { cn } from "@/lib/utils";

interface Msg {
  from: "me" | "them";
  text: string;
  time: string;
  clientId?: string;
}

interface Session {
  user_id: string;
  label?: string;
  owner?: string;
  status?: string;
}

interface QuickChatBoxProps {
  convId: string;
  customerName: string;
  onClose: () => void;
}

const THREAD_POLL_MS = 5000;

// Cache module-level: conv_id -> user_id (acc FB) đã dò được, sống trong phiên trang.
const convAccountCache = new Map<string, string>();

export function QuickChatBox({ convId, customerName, onClose }: QuickChatBoxProps) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [acc, setAcc] = useState<string>("");
  const [accStatus, setAccStatus] = useState<string>("");
  const [phase, setPhase] = useState<"finding" | "ready" | "not_found" | "error">("finding");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const closedRef = useRef(false);

  const fetchThread = useCallback(async (accountId: string): Promise<Msg[] | null> => {
    try {
      const r = await fbFetch(
        `/inbox/thread?user_id=${encodeURIComponent(accountId)}&conv_id=${encodeURIComponent(convId)}`,
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(d.messages) && d.messages.length > 0) {
        return d.messages as Msg[];
      }
      return null;
    } catch {
      return null;
    }
  }, [convId]);

  // Dò acc giữ hội thoại rồi tải tin nhắn lần đầu
  useEffect(() => {
    closedRef.current = false;
    (async () => {
      try {
        const r = await fbFetch("/sessions");
        const d = await r.json().catch(() => ({}));
        const sessions: Session[] = d.sessions || [];
        if (!sessions.length) { setPhase("not_found"); return; }

        // Ưu tiên: acc đã cache cho conv này -> acc online -> còn lại
        const cached = convAccountCache.get(convId);
        const ordered = [
          ...sessions.filter(s => s.user_id === cached),
          ...sessions.filter(s => s.user_id !== cached && s.status === "online"),
          ...sessions.filter(s => s.user_id !== cached && s.status !== "online"),
        ];
        for (const s of ordered) {
          if (closedRef.current) return;
          const list = await fetchThread(s.user_id);
          if (list) {
            convAccountCache.set(convId, s.user_id);
            setAcc(s.user_id);
            setAccStatus(s.status || "");
            setMsgs(list);
            setPhase("ready");
            return;
          }
        }
        setPhase("not_found");
      } catch {
        setPhase("error");
      }
    })();
    return () => { closedRef.current = true; };
  }, [convId, fetchThread]);

  // Poll tin mới khi đang mở
  useEffect(() => {
    if (phase !== "ready" || !acc) return;
    const t = window.setInterval(async () => {
      const list = await fetchThread(acc);
      if (list && !closedRef.current) {
        setMsgs(prev => {
          // Giữ bubble optimistic "Đang gửi..." nếu server chưa echo lại
          const pending = prev.filter(
            m => m.clientId && !list.some(x => x.from === "me" && x.text.trim() === m.text.trim()),
          );
          return [...list, ...pending];
        });
      }
    }, THREAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [phase, acc, fetchThread]);

  // Auto scroll xuống cuối khi có tin mới
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, phase]);

  async function pollReplyStatus(cmd: string, attemptsLeft: number, markDone: (ok: boolean) => void) {
    try {
      const r = await fbFetch(
        `/inbox/reply_status?command_id=${encodeURIComponent(cmd)}&user_id=${encodeURIComponent(acc)}`,
      );
      const d = await r.json();
      if (d.done) { markDone(!!d.sent); return; }
    } catch { /* thử lại */ }
    if (attemptsLeft <= 1) { markDone(true); return; }
    setTimeout(() => pollReplyStatus(cmd, attemptsLeft - 1, markDone), 2000);
  }

  async function handleSend() {
    const t = text.trim();
    if (!t || sending || !acc) return;
    setSending(true);
    setText("");
    const clientId = `qc-${Date.now()}`;
    const optimistic: Msg = { from: "me", text: t, time: "Đang gửi...", clientId };
    setMsgs(prev => [...prev, optimistic]);
    const setStatus = (time: string) =>
      setMsgs(prev => prev.map(m => (m.clientId === clientId ? { ...m, time } : m)));
    try {
      const r = await fbFetch("/inbox/reply", {
        method: "POST",
        headers: fbHeaders(),
        body: JSON.stringify({ user_id: acc, conv_id: convId, text: t }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setStatus("Gửi lỗi"); setSending(false); return; }
      if (!d.command_id) { setStatus("Đã gửi (đang xác nhận)"); setSending(false); return; }
      pollReplyStatus(d.command_id, 12, (ok) => {
        setStatus(ok ? "Đã gửi" : "Gửi thất bại");
        setSending(false);
        if (ok) setTimeout(async () => {
          const list = await fetchThread(acc);
          if (list && !closedRef.current) setMsgs(list);
        }, 1500);
      });
    } catch {
      setStatus("Gửi lỗi");
      setSending(false);
    }
  }

  const offline = accStatus !== "online";

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex w-[340px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-primary px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 text-sm font-bold text-primary-foreground">
            {customerName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-primary-foreground">{customerName}</div>
            {phase === "ready" && (
              <div className="text-[10px] text-primary-foreground/70">
                {offline ? "Acc seeder đang offline — chỉ xem" : "Kết nối trực tiếp Messenger"}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <a
            href={`/all-platform/inbox?conv=${encodeURIComponent(convId)}`}
            target="_blank"
            rel="noreferrer"
            title="Mở trong Inbox đầy đủ"
            className="rounded p-1.5 text-primary-foreground/80 transition hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <ExternalLink className="size-4" />
          </a>
          <button
            onClick={onClose}
            title="Đóng"
            className="rounded p-1.5 text-primary-foreground/80 transition hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-[320px] space-y-2 overflow-y-auto bg-background p-3">
        {phase === "finding" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-xs">Đang tìm hội thoại trên các tài khoản seeder…</span>
          </div>
        )}
        {(phase === "not_found" || phase === "error") && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <WifiOff className="size-5" />
            <span className="text-xs">
              {phase === "error"
                ? "Không kết nối được Markee service."
                : "Không tìm thấy hội thoại này trên các tài khoản đang kết nối (acc giữ hội thoại có thể đang offline)."}
            </span>
            <a
              href={`/all-platform/inbox?conv=${encodeURIComponent(convId)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Mở trang Inbox đầy đủ →
            </a>
          </div>
        )}
        {phase === "ready" &&
          msgs.map((m, i) => (
            <div key={m.clientId || i} className={cn("flex", m.from === "me" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  m.from === "me"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm bg-muted text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                {m.time && (
                  <p className={cn("mt-0.5 text-[9px]", m.from === "me" ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {m.time}
                  </p>
                )}
              </div>
            </div>
          ))}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder={phase !== "ready" ? "Chưa sẵn sàng…" : offline ? "Acc offline — không gửi được" : "Nhập tin nhắn…"}
          disabled={phase !== "ready" || offline || sending}
          className="h-9 flex-1 rounded-full border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
        />
        <button
          onClick={() => void handleSend()}
          disabled={phase !== "ready" || offline || sending || !text.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          title="Gửi"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
    </div>
  );
}
