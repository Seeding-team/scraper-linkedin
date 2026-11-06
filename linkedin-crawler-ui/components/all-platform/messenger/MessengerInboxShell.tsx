"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  fbMessengerService,
  FbMessengerAccount,
  FbMessengerThread,
  FbMessengerMessage,
} from "@/services/facebook-messenger.service";
import { MessengerAccountModal } from "./MessengerAccountModal";
import { toast } from "sonner";

export function MessengerInboxShell() {
  const [accounts, setAccounts] = useState<FbMessengerAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [threads, setThreads] = useState<FbMessengerThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<FbMessengerThread | null>(null);
  const [messages, setMessages] = useState<FbMessengerMessage[]>([]);

  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  const [inputText, setInputText] = useState("");
  const [showAccountModal, setShowAccountModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Tự động cuộn xuống cuối khi có tin nhắn mới
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 1. Tải danh sách tài khoản
  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fbMessengerService.getAccounts();
      if (res.success && res.data) {
        setAccounts(res.data);
        if (res.data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(res.data[0].id);
        }
      }
    } catch {
      toast.error("Không tải được danh sách tài khoản Messenger.");
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // 2. Tải danh sách threads khi chọn account
  const loadThreads = useCallback(async (accId: string) => {
    if (!accId) return;
    setLoadingThreads(true);
    try {
      const res = await fbMessengerService.getThreads(accId);
      if (res.success && res.data) {
        setThreads(res.data);
        if (res.data.length > 0) {
          setSelectedThread(res.data[0]);
        } else {
          setSelectedThread(null);
          setMessages([]);
        }
      }
    } catch {
      toast.error("Không tải được danh sách hội thoại.");
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      loadThreads(selectedAccountId);
    }
  }, [selectedAccountId, loadThreads]);

  // 3. Tải tin nhắn khi chọn thread
  const loadMessages = useCallback(async (accId: string, threadId: string) => {
    if (!accId || !threadId) return;
    setLoadingMessages(true);
    try {
      const res = await fbMessengerService.getThreadMessages(accId, threadId);
      if (res.success && res.data) {
        setMessages(res.data);
      }
    } catch {
      toast.error("Không tải được tin nhắn hội thoại.");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAccountId && selectedThread) {
      loadMessages(selectedAccountId, selectedThread.thread_id);
    }
  }, [selectedAccountId, selectedThread, loadMessages]);

  // 4. Lắng nghe SSE thời gian thực (Realtime 2-Way Sync)
  useEffect(() => {
    const unsubscribe = fbMessengerService.subscribeEvents((event) => {
      if (event.type === "fb_message_new" && event.message) {
        const incomingMsg: FbMessengerMessage = event.message;

        // Nếu tin thuộc thread đang mở -> Đẩy trực tiếp vào tin nhắn
        if (selectedThread && incomingMsg.thread_id === selectedThread.thread_id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === incomingMsg.id || (m.offline_threading_id && m.offline_threading_id === incomingMsg.offline_threading_id))) {
              return prev;
            }
            return [...prev, incomingMsg];
          });
        }

        // Cập nhật lại vị trí hội thoại lên đầu
        setThreads((prev) => {
          const idx = prev.findIndex((t) => t.thread_id === incomingMsg.thread_id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              last_message: incomingMsg.content,
              last_message_at: incomingMsg.created_at,
            };
            // Đưa lên đầu
            const [item] = updated.splice(idx, 1);
            return [item, ...updated];
          }
          return prev;
        });
      }
    });

    return () => unsubscribe();
  }, [selectedThread]);

  // 5. Gửi tin nhắn Optimistic UI
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedAccountId || !selectedThread) return;

    const content = inputText.trim();
    setInputText("");

    // Optimistic UI Message (Hiện ngay trong 0ms)
    const optimisticMsg: FbMessengerMessage = {
      id: `opt_${Date.now()}`,
      account_id: selectedAccountId,
      thread_id: selectedThread.thread_id,
      sender_id: selectedAccountId,
      recipient_id: selectedThread.thread_id,
      content,
      is_self: true,
      is_echo: false,
      status: "sending",
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setSending(true);

    try {
      const res = await fbMessengerService.sendMessage({
        account_id: selectedAccountId,
        recipient_id: selectedThread.thread_id,
        recipient_name: selectedThread.recipient_name,
        content,
        simulate_human: true,
      });

      if (!res.success) {
        toast.error(res.message || "Gửi tin nhắn thất bại.");
        // Đánh dấu tin failed
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? { ...m, status: "failed" } : m))
        );
        return;
      }

      // Cập nhật tin thành công từ server
      if (res.data?.message) {
        const saved = res.data.message;
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? saved : m))
        );
      }
    } catch {
      toast.error("Lỗi mạng khi gửi tin nhắn.");
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticMsg.id ? { ...m, status: "failed" } : m))
      );
    } finally {
      setSending(false);
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="flex h-full w-full bg-surface border border-outline-variant rounded-2xl overflow-hidden font-sans shadow-sm">
      {/* CỘT 1: DANH SÁCH TÀI KHOẢN & HỘI THOẠI */}
      <div className="w-80 border-r border-outline-variant flex flex-col bg-surface-container-low">
        {/* Header chọn tài khoản */}
        <div className="p-3 border-b border-outline-variant bg-surface space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-sm text-foreground">
              <span className="material-symbols-outlined text-blue-600 text-[20px]">chat</span>
              Messenger Nick
            </div>
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              className="px-2 py-1 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 cursor-pointer transition"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Thêm nick
            </button>
          </div>

          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full text-xs font-semibold p-2 bg-surface border border-outline-variant rounded-lg cursor-pointer focus:ring-1 focus:ring-blue-500"
          >
            {accounts.length === 0 ? (
              <option value="">Chưa có tài khoản nào</option>
            ) : (
              accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.status === "frozen" ? "Đóng băng" : acc.status}) — {acc.daily_sent_count}/{acc.daily_sent_limit} tin
                </option>
              ))
            )}
          </select>

          {/* Badge trạng thái nick */}
          {selectedAccount && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
              <span className={cn(
                "inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded",
                selectedAccount.status === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              )}>
                ● {selectedAccount.status === "connected" ? "Đang kết nối" : selectedAccount.status}
              </span>
              <span>Quota: {selectedAccount.daily_sent_count}/{selectedAccount.daily_sent_limit} tin/ngày</span>
            </div>
          )}
        </div>

        {/* Danh sách các cuộc trò chuyện (Threads) */}
        <div className="flex-1 overflow-y-auto divide-y divide-outline-variant">
          {loadingThreads ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Đang tải hội thoại...</div>
          ) : threads.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Chưa có cuộc trò chuyện nào.</div>
          ) : (
            threads.map((t) => {
              const isSelected = selectedThread?.thread_id === t.thread_id;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedThread(t)}
                  className={cn(
                    "p-3 flex items-start gap-2.5 cursor-pointer transition",
                    isSelected ? "bg-blue-500/10 border-l-4 border-blue-600" : "hover:bg-surface-container"
                  )}
                >
                  <div className="w-9 h-9 rounded-full bg-blue-500/15 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {t.recipient_name?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-xs text-foreground truncate">{t.recipient_name || t.recipient_id}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {t.last_message_at ? new Date(t.last_message_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{t.last_message || "(Chưa có tin nhắn)"}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* CỘT 2: KHUNG CHAT VÀ GỬI TIN */}
      <div className="flex-1 flex flex-col bg-surface">
        {selectedThread ? (
          <>
            {/* Header khung chat */}
            <div className="p-3 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-blue-600/15 text-blue-600 flex items-center justify-center font-bold text-xs">
                  {selectedThread.recipient_name?.charAt(0).toUpperCase() || "U"}
                </div>
                <div>
                  <h3 className="font-bold text-xs text-foreground">{selectedThread.recipient_name || selectedThread.recipient_id}</h3>
                  <p className="text-[10px] text-muted-foreground font-mono">ID: {selectedThread.recipient_id}</p>
                </div>
              </div>

              {/* Thông tin nhịp sinh học */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                  <span className="material-symbols-outlined text-[13px]">shield</span>
                  Anti-Checkpoint (Typing WPM)
                </span>
              </div>
            </div>

            {/* Vùng tin nhắn */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface">
              {loadingMessages ? (
                <div className="p-8 text-center text-xs text-muted-foreground">Đang tải tin nhắn...</div>
              ) : messages.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">Chưa có tin nhắn nào trong hội thoại này.</div>
              ) : (
                messages.map((m) => {
                  const isMe = m.is_self;
                  return (
                    <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                      <div
                        className={cn(
                          "max-w-[75%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed font-sans shadow-xs",
                          isMe
                            ? "bg-blue-600 text-white rounded-br-xs"
                            : "bg-surface-container border border-outline-variant text-foreground rounded-bl-xs"
                        )}
                      >
                        {m.content}
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-0.5 px-1 font-medium">
                        <span>{new Date(m.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
                        {isMe && (
                          <span>
                            {m.status === "sending" ? "· Đang gửi..." : m.status === "failed" ? "· ❌ Lỗi" : "· ✓"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Ô soạn thảo và gửi tin */}
            <form onSubmit={handleSend} className="p-3 border-t border-outline-variant bg-surface-container-low flex items-center gap-2">
              <input
                type="text"
                placeholder="Nhập tin nhắn Messenger... (Hệ thống tự động mô phỏng nhịp gõ phím con người)"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={sending}
                className="flex-1 text-xs px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface focus:outline-hidden focus:ring-1 focus:ring-blue-500 font-sans"
              />
              <button
                type="submit"
                disabled={sending || !inputText.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition shadow-xs shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                {sending ? "Đang gửi..." : "Gửi tin"}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
            <span className="material-symbols-outlined text-[48px] text-blue-500/30 mb-2">chat_bubble</span>
            <p className="text-sm font-bold text-foreground">Chọn một cuộc trò chuyện để bắt đầu</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Hệ thống kết nối trực tiếp với Facebook Messenger, tự động đồng bộ 2 chiều giữa điện thoại và máy tính.
            </p>
          </div>
        )}
      </div>

      <MessengerAccountModal
        open={showAccountModal}
        onOpenChange={setShowAccountModal}
        onSuccess={loadAccounts}
      />
    </div>
  );
}
