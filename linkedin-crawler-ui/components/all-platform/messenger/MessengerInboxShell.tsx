"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  fbMessengerService,
  FbMessengerAccount,
  FbMessengerThread,
  FbMessengerMessage,
  extractFbUid,
  FB_ACCOUNT_STATUS_LABELS,
} from "@/services/facebook-messenger.service";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MessengerAccountModal } from "./MessengerAccountModal";
import { INBOX_TEMPLATES } from "@/components/all-platform/components/inbox-templates";
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


  const [searchQuery, setSearchQuery] = useState("");
  const [inputText, setInputText] = useState("");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  const selectedAccountIdRef = useRef(selectedAccountId);
  selectedAccountIdRef.current = selectedAccountId;

  const selectedThreadRef = useRef<FbMessengerThread | null>(selectedThread);
  useEffect(() => {
    selectedThreadRef.current = selectedThread;
  }, [selectedThread]);

  const loadThreadsReqIdRef = useRef(0);
  const loadMessagesReqIdRef = useRef(0);

  // Danh sách tệp đính kèm chờ gửi & lightbox phóng to ảnh
  const [pendingFiles, setPendingFiles] = useState<
    { file: File; previewUrl?: string; name: string; size: number; kind: "image" | "file" }[]
  >([]);
  const [previewLightboxUrl, setPreviewLightboxUrl] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, kind: "image" | "file") => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems = Array.from(files).map((f) => ({
      file: f,
      name: f.name,
      size: f.size,
      kind,
      previewUrl: kind === "image" ? URL.createObjectURL(f) : undefined,
    }));

    setPendingFiles((prev) => [...prev, ...newItems]);
    // Reset input value để có thể chọn lại cùng file
    e.target.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

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
        if (res.data.length > 0 && !selectedAccountIdRef.current) {
          setSelectedAccountId(res.data[0].id);
        }
      }
    } catch {
      toast.error("Không tải được danh sách tài khoản Messenger.");
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // 2. Tải danh sách threads khi chọn account
  const loadThreads = useCallback(async (accId: string, preferredThreadId?: string) => {
    if (!accId) return;
    const reqId = ++loadThreadsReqIdRef.current;
    setLoadingThreads(true);
    try {
      const res = await fbMessengerService.getThreads(accId);
      if (reqId !== loadThreadsReqIdRef.current || accId !== selectedAccountIdRef.current) return;
      if (res.success && res.data) {
        const fetchedThreads = res.data;
        const currentSelected =
          selectedThreadRef.current?.account_id === accId
            ? selectedThreadRef.current
            : null;
        const targetId = currentSelected?.thread_id ?? preferredThreadId;

        // Tìm thread tương ứng trong danh sách từ server (theo thread_id hoặc recipient_id)
        const matched = targetId
          ? fetchedThreads.find(
              (t) => t.thread_id === targetId || t.recipient_id === targetId
            )
          : null;

        if (matched) {
          // Server đã có thread thật -> thay thế thread tạm thời hoàn toàn, không duplicate
          setThreads(fetchedThreads);
          const isAlreadySelected =
            currentSelected &&
            !currentSelected.id.startsWith("temp_") &&
            currentSelected.thread_id === matched.thread_id;
          if (!isAlreadySelected) {
            setSelectedThread(matched);
          }
        } else if (currentSelected?.id.startsWith("temp_")) {
          // Server chưa kịp đồng bộ thread mới -> giữ thread tạm ở đầu danh sách nhưng lọc bỏ trùng
          setThreads([
            currentSelected,
            ...fetchedThreads.filter(
              (t) =>
                t.recipient_id !== currentSelected.recipient_id &&
                t.thread_id !== currentSelected.thread_id
            ),
          ]);
        } else {
          setThreads(fetchedThreads);
          const nextSelected = currentSelected
            ? (fetchedThreads.find((t) => t.thread_id === currentSelected.thread_id) ?? fetchedThreads[0] ?? null)
            : (fetchedThreads[0] ?? null);
          setSelectedThread(nextSelected);
          if (!nextSelected) {
            setMessages([]);
          }
        }
      }
    } catch {
      if (reqId === loadThreadsReqIdRef.current && accId === selectedAccountIdRef.current) {
        toast.error("Không tải được danh sách hội thoại.");
      }
    } finally {
      if (reqId === loadThreadsReqIdRef.current && accId === selectedAccountIdRef.current) {
        setLoadingThreads(false);
      }
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
    const reqId = ++loadMessagesReqIdRef.current;
    setLoadingMessages(true);
    try {
      const res = await fbMessengerService.getThreadMessages(accId, threadId);
      if (reqId !== loadMessagesReqIdRef.current || accId !== selectedAccountIdRef.current || threadId !== selectedThreadRef.current?.thread_id) return;
      if (res.success && res.data) {
        setMessages(res.data);
      }
    } catch {
      if (reqId === loadMessagesReqIdRef.current && accId === selectedAccountIdRef.current && threadId === selectedThreadRef.current?.thread_id) {
        toast.error("Không tải được tin nhắn hội thoại.");
      }
    } finally {
      if (reqId === loadMessagesReqIdRef.current) {
        setLoadingMessages(false);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedAccountId && selectedThread && selectedThread.account_id === selectedAccountId) {
      loadMessages(selectedAccountId, selectedThread.thread_id);
    } else {
      loadMessagesReqIdRef.current++;
      setLoadingMessages(false);
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
            const [item] = updated.splice(idx, 1);
            return [item, ...updated];
          }
          return prev;
        });
      }
    });

    return () => unsubscribe();
  }, [selectedThread]);

  // 4b. Tự làm mới im lặng mỗi 4s (dự phòng khi SSE rớt) — không bật spinner, giữ tin đang gửi dở
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      const accId = selectedAccountIdRef.current;
      const thread = selectedThreadRef.current;
      if (!accId) return;
      try {
        const tRes = await fbMessengerService.getThreads(accId);
        if (tRes.success && tRes.data && accId === selectedAccountIdRef.current) {
          const fetched = tRes.data;
          setThreads((prev) => (prev.some((t) => t.id.startsWith("temp_")) ? prev : fetched));
        }
        if (!thread || thread.id.startsWith("temp_") || thread.account_id !== accId) return;
        const mRes = await fbMessengerService.getThreadMessages(accId, thread.thread_id);
        if (!mRes.success || !mRes.data) return;
        if (accId !== selectedAccountIdRef.current || selectedThreadRef.current?.thread_id !== thread.thread_id) return;
        const fetched = mRes.data;
        setMessages((prev) => [
          ...fetched,
          ...prev.filter((m) => m.id.startsWith("opt_") && m.status === "sending"),
        ]);
      } catch {
        // im lặng: lần sau thử lại
      }
    };
    const id = setInterval(tick, 4000);
    document.addEventListener("visibilitychange", tick); // quay lại tab là cập nhật ngay
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  // 5. Gửi tin nhắn với bộ đếm mô phỏng người thật trực quan & hỗ trợ đa phương tiện
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && pendingFiles.length === 0) || !selectedAccountId || !selectedThread) return;

    const sendAccountId = selectedAccountId;
    const sentThreadId = selectedThread.thread_id;
    const sentRecipientName = selectedThread.recipient_name;
    const content = inputText.trim();
    const filesToUpload = [...pendingFiles];
    setInputText("");
    setPendingFiles([]);
    setShowTemplateMenu(false);


    const isCurrentThread = () =>
      selectedAccountIdRef.current === sendAccountId &&
      selectedThreadRef.current?.thread_id === sentThreadId;

    // 1. Upload các file đính kèm (nếu có)
    const uploadedAttachments: {
      url: string;
      name: string;
      size?: number;
      mime_type?: string;
      kind?: "image" | "file";
    }[] = [];

    if (filesToUpload.length > 0) {
      for (const pf of filesToUpload) {
        try {
          const upRes = await fbMessengerService.uploadMedia(pf.file, sendAccountId);
          if (upRes.success && upRes.data) {
            uploadedAttachments.push(upRes.data);
          } else {
            toast.error(`Không thể tải lên file ${pf.name}: ${upRes.message}`);
          }
        } catch {
          toast.error(`Lỗi tải lên file ${pf.name}`);
        }
      }
    }

    // Optimistic UI Message (Hiện ngay trong 0ms)
    const optimisticMsg: FbMessengerMessage = {
      id: `opt_${Date.now()}`,
      account_id: sendAccountId,
      thread_id: sentThreadId,
      sender_id: sendAccountId,
      recipient_id: sentThreadId,
      content,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
      is_self: true,
      is_echo: false,
      status: "sending",
      created_at: new Date().toISOString(),
    };

    if (isCurrentThread()) {
      setMessages((prev) => [...prev, optimisticMsg]);
    }

    try {
      const res = await fbMessengerService.sendMessage({
        account_id: sendAccountId,
        recipient_id: sentThreadId,
        recipient_name: sentRecipientName,
        content,
        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
        simulate_human: true,
      });


      if (!res.success) {
        toast.error(res.message || "Gửi tin nhắn thất bại.");
        if (isCurrentThread()) {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticMsg.id ? { ...m, status: "failed" } : m))
          );
        }
        return;
      }

      if (res.data?.message) {
        const saved = res.data.message;
        if (isCurrentThread()) {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticMsg.id ? saved : m))
          );
        }
      }

      // Cập nhật lại số lượng tin đã gửi của tài khoản
      loadAccounts();

      // Sau khi gửi thành công tin nhắn đầu tiên (hoặc bất kỳ tin nào),
      // reload lại threads để thay thế thread tạm thời bằng thread thật từ server (tránh trùng lặp)
      if (sendAccountId === selectedAccountIdRef.current) {
        if (selectedThreadRef.current?.thread_id === sentThreadId) {
          await loadThreads(sendAccountId, res.data?.thread_id || sentThreadId);
        } else {
          await loadThreads(sendAccountId);
        }
      }
    } catch {
      toast.error("Lỗi mạng khi gửi tin nhắn.");
      if (isCurrentThread()) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? { ...m, status: "failed" } : m))
        );
      }
    }
  };

  // Mở rã đông tài khoản
  const handleUnfreeze = async (accId: string) => {
    try {
      const res = await fbMessengerService.unfreezeAccount(accId);
      if (res.success) {
        toast.success("Đã rã đông tài khoản thành công!");
        loadAccounts();
      } else {
        toast.error(res.message || "Rã đông thất bại.");
      }
    } catch {
      toast.error("Lỗi khi gọi lệnh rã đông.");
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // Xử lý tạo cuộc trò chuyện mới hoặc chọn cuộc trò chuyện đã có
  const handleStartNewChat = (uid: string, nickname?: string) => {
    // 1. Nếu cuộc trò chuyện với recipient_id này đã tồn tại -> chọn luôn
    const existing = threads.find(
      (t) => t.recipient_id === uid || t.thread_id === uid
    );

    if (existing) {
      selectedThreadRef.current = existing;
      setSelectedThread(existing);
      setSearchQuery("");
      return;
    }

    // 2. Tạo đối tượng thread tạm thời trong bộ nhớ (cùng cấu trúc FbMessengerThread)
    const now = new Date().toISOString();
    const tempThread: FbMessengerThread = {
      id: `temp_${uid}`,
      account_id: selectedAccountId,
      thread_id: uid,
      recipient_id: uid,
      recipient_name: nickname || `Người dùng ${uid}`,
      unread_count: 0,
      created_at: now,
      updated_at: now,
    };

    setThreads((prev) => [
      tempThread,
      ...prev.filter((t) => t.recipient_id !== uid && t.thread_id !== uid),
    ]);
    selectedThreadRef.current = tempThread;
    setSelectedThread(tempThread);
    setMessages([]);
    setSearchQuery("");
  };

  const getAccountStatusBadge = (status: FbMessengerAccount["status"]) => {
    switch (status) {
      case "connected":
        return {
          label: FB_ACCOUNT_STATUS_LABELS.connected,
          className: "bg-emerald-50 text-emerald-700 border-emerald-200",
        };
      case "disconnected":
        return {
          label: FB_ACCOUNT_STATUS_LABELS.disconnected,
          className: "bg-gray-100 text-gray-700 border-gray-300",
        };
      case "checkpoint":
        return {
          label: FB_ACCOUNT_STATUS_LABELS.checkpoint,
          className: "bg-amber-50 text-amber-700 border-amber-200",
        };
      case "frozen":
        return {
          label: FB_ACCOUNT_STATUS_LABELS.frozen,
          className: "bg-blue-50 text-blue-700 border-blue-200",
        };
      case "expired":
        return {
          label: FB_ACCOUNT_STATUS_LABELS.expired,
          className: "bg-rose-50 text-rose-700 border-rose-200",
        };
      default:
        return {
          label: status,
          className: "bg-gray-100 text-gray-700 border-gray-200",
        };
    }
  };

  // Lọc hội thoại theo thanh tìm kiếm
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase().trim();
    return threads.filter(
      (t) =>
        (t.recipient_name && t.recipient_name.toLowerCase().includes(q)) ||
        t.recipient_id.includes(q) ||
        (t.last_message && t.last_message.toLowerCase().includes(q))
    );
  }, [threads, searchQuery]);

  return (
    <div className="flex h-full w-full bg-surface border border-outline-variant rounded-2xl overflow-hidden font-sans shadow-sm">
      {/* ── CỘT 1: DANH SÁCH TÀI KHOẢN & HỘI THOẠI ──────────────────────────── */}
      <div className="w-84 border-r border-outline-variant flex flex-col bg-surface-container-low shrink-0">
        {/* Header tài khoản */}
        <div className="p-3.5 border-b border-outline-variant bg-surface space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center font-bold text-xs shadow-xs">
                <span className="material-symbols-outlined text-[18px]">chat</span>
              </div>
              <span className="font-bold text-sm text-on-surface">Messenger Nick</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              className="px-2.5 py-1 text-xs font-bold bg-primary hover:bg-[#a01c3d] text-white rounded-lg flex items-center gap-1 cursor-pointer transition shadow-xs"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              Thêm nick
            </button>
          </div>

          {/* Hộp chọn nick */}
          <select
            value={selectedAccountId}
            onChange={(e) => {
              const val = e.target.value;
              selectedAccountIdRef.current = val;
              selectedThreadRef.current = null;
              setSelectedThread(null);
              setMessages([]);
              setSelectedAccountId(val);
            }}
            className="w-full text-xs font-semibold p-2.5 bg-surface border border-outline-variant rounded-xl cursor-pointer focus:ring-2 focus:ring-primary/20 text-on-surface"
          >
            {accounts.length === 0 ? (
              <option value="">Chưa có tài khoản Messenger nào</option>
            ) : (
              accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({FB_ACCOUNT_STATUS_LABELS[acc.status] || acc.status})
                </option>
              ))
            )}
          </select>

          {/* Chi tiết tài khoản & Thanh Quota */}
          {selectedAccount && (() => {
            const statusBadge = getAccountStatusBadge(selectedAccount.status);
            return (
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-2.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-[10px] border",
                      statusBadge.className
                    )}
                    title={
                      selectedAccount.status === "checkpoint" && selectedAccount.checkpoint_reason
                        ? selectedAccount.checkpoint_reason
                        : undefined
                    }
                  >
                    ● {statusBadge.label}
                  </span>

                  {selectedAccount.status === "frozen" && (
                    <button
                      type="button"
                      onClick={() => handleUnfreeze(selectedAccount.id)}
                      className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                    >
                      Rã đông ngay
                    </button>
                  )}
                </div>

                {/* Progress bar hạn mức ngày */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                    <span>Hạn mức ngày:</span>
                    <span className="font-bold text-on-surface">
                      {selectedAccount.daily_sent_count} / {selectedAccount.daily_sent_limit} tin
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-300",
                        selectedAccount.daily_sent_count >= selectedAccount.daily_sent_limit
                          ? "bg-amber-500"
                          : "bg-primary"
                      )}
                      style={{
                        width: `${Math.min(100, (selectedAccount.daily_sent_count / (selectedAccount.daily_sent_limit || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Ô tìm kiếm hội thoại và nút Tin nhắn mới */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-muted-foreground text-[16px]">
                search
              </span>
              <input
                type="text"
                placeholder="Tìm theo tên hoặc ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-xl border border-outline-variant bg-surface text-on-surface placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
            </div>
            <div
              title={
                !selectedAccountId
                  ? "Vui lòng chọn tài khoản để tạo tin nhắn mới"
                  : "Tạo tin nhắn mới"
              }
              className="shrink-0"
            >
              <button
                type="button"
                onClick={() => setShowNewMessageModal(true)}
                disabled={!selectedAccountId}
                className="px-2.5 py-1.5 text-xs font-bold bg-primary hover:bg-[#a01c3d] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl flex items-center gap-1 cursor-pointer transition shadow-xs"
              >
                <span className="material-symbols-outlined text-[15px]">edit_square</span>
                <span className="whitespace-nowrap">Tin nhắn mới</span>
              </button>
            </div>
          </div>
        </div>

        {/* Danh sách các cuộc trò chuyện (Threads) */}
        <div className="flex-1 overflow-y-auto divide-y divide-outline-variant">
          {loadingThreads ? (
            <div className="p-8 text-center text-xs text-muted-foreground">Đang tải hội thoại...</div>
          ) : filteredThreads.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {searchQuery ? "Không tìm thấy hội thoại phù hợp." : "Chưa có cuộc trò chuyện nào."}
            </div>
          ) : (
            filteredThreads.map((t) => {
              const isSelected = selectedThread?.thread_id === t.thread_id;
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    selectedThreadRef.current = t;
                    setSelectedThread(t);
                  }}
                  className={cn(
                    "p-3.5 flex items-start gap-3 cursor-pointer transition",
                    isSelected
                      ? "bg-primary/10 border-l-4 border-primary"
                      : "hover:bg-surface-container"
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 border border-primary/20">
                    {t.recipient_name?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-xs text-on-surface truncate">
                        {t.recipient_name || t.recipient_id}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                        {t.last_message_at
                          ? new Date(t.last_message_at).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-1">
                      {t.last_message || "(Chưa có tin nhắn)"}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── CỘT 2: KHUNG CHAT VÀ GỬI TIN ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-surface min-w-0">
        {selectedThread ? (
          <>
            {/* Header khung chat */}
            <div className="p-3.5 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 border border-primary/20">
                  {selectedThread.recipient_name?.charAt(0).toUpperCase() || "U"}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-on-surface truncate">
                    {selectedThread.recipient_name || selectedThread.recipient_id}
                  </h3>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">UID: {selectedThread.recipient_id}</span>
                    <span>·</span>
                    <a
                      href={`https://facebook.com/${selectedThread.recipient_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-0.5"
                    >
                      <span>Mở Profile</span>
                      <span className="material-symbols-outlined text-[11px]">open_in_new</span>
                    </a>
                  </div>
                </div>
              </div>

              {/* Huy hiệu bảo vệ Anti-Checkpoint */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold text-xs border border-emerald-200 shadow-2xs">
                  <span className="material-symbols-outlined text-[14px]">verified_user</span>
                  Anti-Checkpoint Active
                </span>
              </div>
            </div>

            {/* Vùng tin nhắn */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface">
              {loadingMessages ? (
                <div className="p-8 text-center text-xs text-muted-foreground">Đang tải tin nhắn...</div>
              ) : messages.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  Chưa có tin nhắn nào trong hội thoại này.
                </div>
              ) : (
                messages.map((m) => {
                  const isMe = m.is_self;
                  return (
                    <div
                      key={m.id}
                      className={cn("flex flex-col", isMe ? "items-end" : "items-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[75%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed font-sans shadow-xs",
                          isMe
                            ? "bg-primary text-white rounded-br-xs"
                            : "bg-surface-container border border-outline-variant text-on-surface rounded-bl-xs"
                        )}
                      >
                        {/* 1. Nhóm hình ảnh & tệp đính kèm */}
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="space-y-2 mb-2">
                            {/* Nhóm hình ảnh (Grid) */}
                            {m.attachments.filter((a) => a.kind === "image" || a.mime_type?.startsWith("image/")).length > 0 && (
                              <div
                                className={cn(
                                  "grid gap-1.5 rounded-xl overflow-hidden",
                                  m.attachments.filter((a) => a.kind === "image" || a.mime_type?.startsWith("image/")).length === 1
                                    ? "grid-cols-1 max-w-xs"
                                    : m.attachments.filter((a) => a.kind === "image" || a.mime_type?.startsWith("image/")).length === 2
                                    ? "grid-cols-2 max-w-sm"
                                    : "grid-cols-3 max-w-md"
                                )}
                              >
                                {m.attachments
                                  .filter((a) => a.kind === "image" || a.mime_type?.startsWith("image/"))
                                  .map((att, aIdx) => (
                                    <div
                                      key={aIdx}
                                      onClick={() => setPreviewLightboxUrl(att.url)}
                                      className="relative group cursor-pointer overflow-hidden rounded-lg bg-black/10 aspect-square flex items-center justify-center border border-black/10"
                                      title="Bấm để phóng to xem ảnh"
                                    >
                                      <img
                                        src={att.url}
                                        alt={att.name || "Hình ảnh"}
                                        className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                                        loading="lazy"
                                      />
                                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                                        <span className="material-symbols-outlined text-[20px]">zoom_in</span>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            )}

                            {/* Nhóm tệp tài liệu (PDF, Word, Excel, etc.) */}
                            {m.attachments
                              .filter((a) => a.kind !== "image" && !a.mime_type?.startsWith("image/"))
                              .map((att, aIdx) => (
                                <a
                                  key={aIdx}
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  download={att.name}
                                  className={cn(
                                    "flex items-center gap-2.5 p-2 rounded-xl border transition max-w-xs cursor-pointer",
                                    isMe
                                      ? "bg-white/10 hover:bg-white/20 border-white/20 text-white"
                                      : "bg-surface hover:bg-surface-container border-outline-variant text-on-surface"
                                  )}
                                >
                                  <div
                                    className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold",
                                      isMe ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                                    )}
                                  >
                                    <span className="material-symbols-outlined text-[20px]">
                                      {att.name?.endsWith(".pdf")
                                        ? "picture_as_pdf"
                                        : att.name?.match(/\.(doc|docx)$/i)
                                        ? "description"
                                        : att.name?.match(/\.(xls|xlsx)$/i)
                                        ? "table_chart"
                                        : "draft"}
                                    </span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-bold truncate leading-tight">{att.name || "Tệp đính kèm"}</p>
                                    <p className={cn("text-[10px] mt-0.5", isMe ? "text-white/70" : "text-muted-foreground")}>
                                      {att.size ? `${(att.size / 1024).toFixed(1)} KB` : "Tệp tin"} · Tải về
                                    </p>
                                  </div>
                                  <span className="material-symbols-outlined text-[16px] shrink-0 opacity-80">download</span>
                                </a>
                              ))}
                          </div>
                        )}

                        {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5 px-1 font-medium">
                        <span>
                          {new Date(m.created_at).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {isMe && (
                          <span>
                            {m.status === "sending"
                              ? "· ⏳ Đang gửi..."
                              : m.status === "failed"
                              ? "· ❌ Gửi lỗi"
                              : m.is_echo
                              ? "· 📱 Gửi từ điện thoại"
                              : "· ✓ Đã gửi an toàn"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Menu chọn Mẫu câu Facebook */}
            {showTemplateMenu && (
              <div className="p-3 bg-surface-container-low border-t border-outline-variant max-h-48 overflow-y-auto space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface">Chọn mẫu câu Facebook chuyên dụng:</span>
                  <button
                    type="button"
                    onClick={() => setShowTemplateMenu(false)}
                    className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {INBOX_TEMPLATES.filter((t) => t.category.includes("Facebook")).flatMap((cat) =>
                    cat.templates.map((tpl, idx) => (
                      <button
                        key={`${cat.category}-${idx}`}
                        type="button"
                        onClick={() => {
                          setInputText(tpl.content.replace("{post}", "bài viết của bạn"));
                          setShowTemplateMenu(false);
                        }}
                        className="p-2 text-left text-xs bg-surface border border-outline-variant rounded-lg hover:border-primary hover:bg-rose-50/50 transition cursor-pointer"
                      >
                        <div className="font-bold text-on-surface truncate">{tpl.title}</div>
                        <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                          {tpl.content}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Thanh hiển thị các tệp đính kèm đang chờ gửi */}
            {pendingFiles.length > 0 && (
              <div className="px-4 py-2 bg-surface-container border-t border-outline-variant flex items-center gap-2 overflow-x-auto">
                <span className="text-[11px] font-bold text-muted-foreground shrink-0">Đính kèm ({pendingFiles.length}):</span>
                {pendingFiles.map((pf, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-outline-variant text-xs shrink-0 max-w-xs shadow-2xs"
                  >
                    {pf.kind === "image" && pf.previewUrl ? (
                      <img src={pf.previewUrl} alt="preview" className="w-5 h-5 rounded object-cover" />
                    ) : (
                      <span className="material-symbols-outlined text-[16px] text-primary">draft</span>
                    )}
                    <span className="truncate max-w-[120px] font-medium">{pf.name}</span>
                    <button
                      type="button"
                      onClick={() => removePendingFile(idx)}
                      className="text-muted-foreground hover:text-red-500 cursor-pointer ml-1"
                      title="Bỏ tệp này"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input file ẩn */}
            <input
              type="file"
              ref={imageInputRef}
              accept="image/*"
              className="hidden"
              multiple
              onChange={(e) => handleFileSelect(e, "image")}
            />
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              onChange={(e) => handleFileSelect(e, "file")}
            />

            {/* Ô soạn thảo và gửi tin */}
            <form
              onSubmit={handleSend}
              className="p-3.5 border-t border-outline-variant bg-surface-container-low flex items-center gap-2"
            >
              {/* Nút đính kèm ảnh */}
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="p-2.5 rounded-xl border border-outline-variant bg-surface hover:bg-surface-container text-on-surface text-xs font-bold flex items-center justify-center cursor-pointer transition shrink-0"
                title="Gửi hình ảnh"
              >
                <span className="material-symbols-outlined text-[18px] text-primary">image</span>
              </button>

              {/* Nút đính kèm file */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl border border-outline-variant bg-surface hover:bg-surface-container text-on-surface text-xs font-bold flex items-center justify-center cursor-pointer transition shrink-0"
                title="Đính kèm tài liệu"
              >
                <span className="material-symbols-outlined text-[18px] text-amber-600">attach_file</span>
              </button>

              {/* Nút chọn mẫu câu nhanh */}
              <button
                type="button"
                onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                className={cn(
                  "px-3 py-2.5 rounded-xl border border-outline-variant text-xs font-bold flex items-center gap-1 cursor-pointer transition shrink-0",
                  showTemplateMenu
                    ? "bg-primary text-white border-primary"
                    : "bg-surface hover:bg-surface-container text-on-surface"
                )}
                title="Chọn mẫu câu nhanh"
              >
                <span className="material-symbols-outlined text-[16px]">library_books</span>
                <span className="hidden sm:inline">Mẫu câu</span>
              </button>

              <input
                type="text"
                placeholder="Nhập tin nhắn Messenger... (Enter để gửi)"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 text-xs px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 font-sans"
              />

              <button
                type="submit"
                disabled={!inputText.trim() && pendingFiles.length === 0}
                className="px-5 py-2.5 bg-primary hover:bg-[#a01c3d] disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition shadow-xs shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                Gửi tin
              </button>
            </form>
          </>
        ) : accounts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 max-w-xl mx-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold shadow-xs">
              <span className="material-symbols-outlined text-[36px]">mark_chat_unread</span>
            </div>
            
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-on-surface">
                Chưa có tài khoản Facebook Messenger nào được kết nối
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
                Hệ thống hỗ trợ gửi và nhận tin nhắn đa phương tiện (hình ảnh, tài liệu) kèm 5 lớp áo giáp mô phỏng người thật chống Checkpoint. Kết nối tài khoản chỉ mất chưa đầy 30 giây!
              </p>
            </div>

            {/* Khối tóm tắt 3 bước Onboarding */}
            <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-2.5 text-left p-3.5 bg-surface-container-low rounded-xl border border-outline-variant">
              <div className="space-y-1 p-2 rounded-lg bg-surface border border-outline-variant">
                <div className="flex items-center gap-1.5 font-bold text-xs text-primary">
                  <span className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center text-[9px]">1</span>
                  <span>Tải Extension</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Tải file .zip và giải nén ra thư mục máy tính.</p>
              </div>

              <div className="space-y-1 p-2 rounded-lg bg-surface border border-outline-variant">
                <div className="flex items-center gap-1.5 font-bold text-xs text-primary">
                  <span className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center text-[9px]">2</span>
                  <span>Cài vào Trình duyệt</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Vào chrome://extensions bật Developer mode và Load unpacked.</p>
              </div>

              <div className="space-y-1 p-2 rounded-lg bg-surface border border-outline-variant">
                <div className="flex items-center gap-1.5 font-bold text-xs text-primary">
                  <span className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center text-[9px]">3</span>
                  <span>1-Click Kết nối</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Đăng nhập FB và bấm nút Lấy tự động bằng Extension.</p>
              </div>
            </div>

            {/* Các nút hành động chính */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowAccountModal(true)}
                className="px-4 py-2.5 bg-primary hover:bg-[#a01c3d] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>+ Thêm tài khoản Facebook ngay</span>
              </button>

              <a
                href="/api-facebook-get-extension.zip"
                download="api-facebook-get-extension.zip"
                className="px-3.5 py-2.5 bg-surface hover:bg-surface-container border border-outline-variant text-on-surface font-bold text-xs rounded-xl flex items-center gap-1.5 transition"
                title="Tải gói tiện ích cài vào Chrome"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">download</span>
                <span>Tải Extension (.zip)</span>
              </a>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold mb-3 shadow-xs">
              <span className="material-symbols-outlined text-[36px]">forum</span>
            </div>
            <p className="text-base font-bold text-on-surface">Chọn một cuộc trò chuyện để bắt đầu</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-sm leading-relaxed">
              Hệ thống kết nối trực tiếp với Facebook Messenger, tự động đồng bộ 2 chiều giữa điện thoại và máy tính, áp dụng 5 lớp áo giáp chống Checkpoint.
            </p>
          </div>
        )}
      </div>

      {/* Lightbox phóng to ảnh */}
      {previewLightboxUrl && (
        <div
          onClick={() => setPreviewLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs cursor-zoom-out animate-in fade-in duration-200"
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewLightboxUrl}
              alt="Xem ảnh lớn"
              className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl"
            />
            <button
              onClick={() => setPreviewLightboxUrl(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-surface text-on-surface border border-outline-variant flex items-center justify-center shadow-lg hover:bg-surface-container cursor-pointer"
              title="Đóng xem ảnh"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      )}

      <MessengerAccountModal
        open={showAccountModal}
        onOpenChange={setShowAccountModal}
        onSuccess={loadAccounts}
      />

      <NewMessageModal
        open={showNewMessageModal}
        onOpenChange={setShowNewMessageModal}
        onConfirm={handleStartNewChat}
      />
    </div>
  );
}

interface NewMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (uid: string, nickname?: string) => void;
}

function NewMessageModal({ open, onOpenChange, onConfirm }: NewMessageModalProps) {
  const [targetInput, setTargetInput] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTargetInput("");
      setNickname("");
      setError(null);
    }
  }, [open]);

  const handleInputChange = (val: string) => {
    setTargetInput(val);
    if (error) {
      setError(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = targetInput.trim();
    if (!trimmed) {
      setError("Vui lòng nhập UID hoặc link Facebook.");
      inputRef.current?.focus();
      return;
    }

    const { uid, error: extractError } = extractFbUid(trimmed);
    if (extractError || !uid) {
      setError(extractError || "Không thể trích xuất UID hợp lệ.");
      inputRef.current?.focus();
      return;
    }

    onConfirm(uid, nickname.trim() || undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md font-sans p-6"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
              <span className="material-symbols-outlined text-[22px]">edit_square</span>
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Tin nhắn mới
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Nhập UID hoặc liên kết Facebook của người nhận
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label htmlFor="fb-target-uid" className="text-xs font-bold text-foreground">
              UID hoặc link Facebook <span className="text-primary">*</span>
            </label>
            <input
              id="fb-target-uid"
              ref={inputRef}
              type="text"
              placeholder="VD: 100012345678 hoặc link facebook.com/profile.php?id=..."
              value={targetInput}
              onChange={(e) => handleInputChange(e.target.value)}
              className={cn(
                "w-full text-xs px-3.5 py-2.5 rounded-xl border bg-surface text-on-surface placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 font-sans transition",
                error
                  ? "border-rose-500 focus:ring-rose-500/20"
                  : "border-outline-variant focus:ring-primary/20"
              )}
              aria-invalid={!!error}
              aria-describedby={error ? "uid-error" : undefined}
            />
            {error && (
              <p id="uid-error" className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                <span className="material-symbols-outlined text-[15px] shrink-0">error</span>
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fb-target-nickname" className="text-xs font-bold text-foreground">
              Tên gợi nhớ <span className="text-[11px] font-normal text-muted-foreground">(Không bắt buộc)</span>
            </label>
            <input
              id="fb-target-nickname"
              type="text"
              placeholder="VD: Khách hàng Nguyễn Văn A"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 font-sans transition"
            />
          </div>

          <DialogFooter className="pt-2 gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-outline-variant bg-surface hover:bg-surface-container text-on-surface transition cursor-pointer"
            >
              Huỷ
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold rounded-xl bg-primary hover:bg-[#a01c3d] text-white shadow-xs transition cursor-pointer"
            >
              Bắt đầu chat
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
