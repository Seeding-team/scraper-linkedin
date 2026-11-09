"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  fbMessengerService,
  FbMessengerAccount,
  FbMessengerThread,
  FbMessengerMessage,
} from "@/services/facebook-messenger.service";
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
  const [sending, setSending] = useState(false);

  // Bộ theo dõi từng bước mô phỏng người thật theo thời gian thực (Live Simulation Step Tracker)
  const [simulationStep, setSimulationStep] = useState<number>(0);
  const [simulationText, setSimulationText] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState("");
  const [inputText, setInputText] = useState("");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

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
            const [item] = updated.splice(idx, 1);
            return [item, ...updated];
          }
          return prev;
        });
      }
    });

    return () => unsubscribe();
  }, [selectedThread]);

  // 5. Gửi tin nhắn với bộ đếm mô phỏng người thật trực quan & hỗ trợ đa phương tiện
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && pendingFiles.length === 0) || !selectedAccountId || !selectedThread) return;

    const content = inputText.trim();
    const filesToUpload = [...pendingFiles];
    setInputText("");
    setPendingFiles([]);
    setShowTemplateMenu(false);

    setSending(true);

    // 1. Upload các file đính kèm (nếu có)
    const uploadedAttachments: {
      url: string;
      name: string;
      size?: number;
      mime_type?: string;
      kind?: "image" | "file";
    }[] = [];

    if (filesToUpload.length > 0) {
      setSimulationStep(1);
      setSimulationText(`Đang tải lên ${filesToUpload.length} tệp đính kèm...`);
      for (const pf of filesToUpload) {
        try {
          const upRes = await fbMessengerService.uploadMedia(pf.file, selectedAccountId);
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
      account_id: selectedAccountId,
      thread_id: selectedThread.thread_id,
      sender_id: selectedAccountId,
      recipient_id: selectedThread.thread_id,
      content,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
      is_self: true,
      is_echo: false,
      status: "sending",
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    // Kích hoạt chuỗi bước mô phỏng thị giác (Visual Simulation Stepper)
    setSimulationStep(1);
    setSimulationText("Bước 1/5: Đang đọc ngữ cảnh tin nhắn cũ (Độ trễ 1.8s)...");

    const timer1 = setTimeout(() => {
      setSimulationStep(2);
      setSimulationText("Bước 2/5: Đang phát tín hiệu Typing lên Facebook (typ.php)...");
    }, 1800);

    const timer2 = setTimeout(() => {
      setSimulationStep(3);
      setSimulationText("Bước 3/5: Đang gõ phím mô phỏng WPM 42 từ/phút (trễ ngẫu nhiên dấu câu)...");
    }, 3200);

    const timer3 = setTimeout(() => {
      setSimulationStep(4);
      setSimulationText("Bước 4/5: Đang gửi gói tin Direct API an toàn (offline_threading_id)...");
    }, 6000);

    try {
      const res = await fbMessengerService.sendMessage({
        account_id: selectedAccountId,
        recipient_id: selectedThread.thread_id,
        recipient_name: selectedThread.recipient_name,
        content,
        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
        simulate_human: true,
      });

      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);

      if (!res.success) {
        toast.error(res.message || "Gửi tin nhắn thất bại.");
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? { ...m, status: "failed" } : m))
        );
        setSimulationStep(0);
        return;
      }

      setSimulationStep(5);
      setSimulationText("Bước 5/5: Đã gửi an toàn! Nán lại 1.5s & đồng bộ 2 chiều hoàn tất.");

      if (res.data?.message) {
        const saved = res.data.message;
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? saved : m))
        );
      }

      setTimeout(() => {
        setSimulationStep(0);
        setSimulationText("");
      }, 2500);

      // Cập nhật lại số lượng tin đã gửi của tài khoản
      loadAccounts();
    } catch {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      toast.error("Lỗi mạng khi gửi tin nhắn.");
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticMsg.id ? { ...m, status: "failed" } : m))
      );
      setSimulationStep(0);
    } finally {
      setSending(false);
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
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                <span className="material-symbols-outlined text-[18px]">chat</span>
              </div>
              <span className="font-bold text-sm text-on-surface">Messenger Nick</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAccountModal(true)}
              className="px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 cursor-pointer transition shadow-xs"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              Thêm nick
            </button>
          </div>

          {/* Hộp chọn nick */}
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full text-xs font-semibold p-2.5 bg-surface border border-outline-variant rounded-xl cursor-pointer focus:ring-2 focus:ring-blue-500/20 text-on-surface"
          >
            {accounts.length === 0 ? (
              <option value="">Chưa có tài khoản Messenger nào</option>
            ) : (
              accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.status === "frozen" ? "Đóng băng" : acc.status === "connected" ? "Hoạt động" : acc.status})
                </option>
              ))
            )}
          </select>

          {/* Chi tiết tài khoản & Thanh Quota */}
          {selectedAccount && (
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className={cn(
                  "inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-[10px]",
                  selectedAccount.status === "connected" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                  selectedAccount.status === "frozen" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                  "bg-rose-50 text-rose-700 border border-rose-200"
                )}>
                  ● {selectedAccount.status === "connected" ? "Đang kết nối an toàn" :
                      selectedAccount.status === "frozen" ? "Đóng băng bảo vệ" : selectedAccount.status}
                </span>

                {selectedAccount.status === "frozen" && (
                  <button
                    type="button"
                    onClick={() => handleUnfreeze(selectedAccount.id)}
                    className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
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
                        : "bg-blue-600"
                    )}
                    style={{
                      width: `${Math.min(100, (selectedAccount.daily_sent_count / (selectedAccount.daily_sent_limit || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Ô tìm kiếm hội thoại */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-muted-foreground text-[16px]">
              search
            </span>
            <input
              type="text"
              placeholder="Tìm theo tên hoặc ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-outline-variant bg-surface text-on-surface placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
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
                  onClick={() => setSelectedThread(t)}
                  className={cn(
                    "p-3.5 flex items-start gap-3 cursor-pointer transition",
                    isSelected
                      ? "bg-blue-500/10 border-l-4 border-blue-600"
                      : "hover:bg-surface-container"
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-blue-600/10 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-200">
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
                <div className="w-9 h-9 rounded-full bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-200">
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
                      className="text-blue-600 hover:underline flex items-center gap-0.5"
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
                            ? "bg-blue-600 text-white rounded-br-xs"
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
                                      isMe ? "bg-white/20 text-white" : "bg-blue-500/10 text-blue-600"
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

            {/* Banner theo dõi mô phỏng người thật theo thời gian thực (Step Tracker) */}
            {simulationStep > 0 && (
              <div className="px-4 py-2.5 bg-blue-50 border-t border-b border-blue-200 text-xs text-blue-900 font-medium flex items-center justify-between animate-pulse">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-blue-600">
                    {simulationStep === 1
                      ? "visibility"
                      : simulationStep === 2
                      ? "edit"
                      : simulationStep === 3
                      ? "keyboard"
                      : simulationStep === 4
                      ? "send"
                      : "verified"}
                  </span>
                  <span>{simulationText}</span>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((step) => (
                    <div
                      key={step}
                      className={cn(
                        "w-2 h-2 rounded-full",
                        step <= simulationStep ? "bg-blue-600" : "bg-blue-200"
                      )}
                    />
                  ))}
                </div>
              </div>
            )}

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
                        className="p-2 text-left text-xs bg-surface border border-outline-variant rounded-lg hover:border-blue-500 hover:bg-blue-50/30 transition cursor-pointer"
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
                      <span className="material-symbols-outlined text-[16px] text-blue-600">draft</span>
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
                disabled={sending}
                className="p-2.5 rounded-xl border border-outline-variant bg-surface hover:bg-surface-container text-on-surface text-xs font-bold flex items-center justify-center cursor-pointer transition shrink-0"
                title="Gửi hình ảnh"
              >
                <span className="material-symbols-outlined text-[18px] text-blue-600">image</span>
              </button>

              {/* Nút đính kèm file */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
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
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-surface hover:bg-surface-container text-on-surface"
                )}
                title="Chọn mẫu câu nhanh"
              >
                <span className="material-symbols-outlined text-[16px]">library_books</span>
                <span className="hidden sm:inline">Mẫu câu</span>
              </button>

              <input
                type="text"
                placeholder="Nhập tin nhắn Messenger... (Hệ thống tự động kích hoạt nhịp sinh học con người 5 bước)"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={sending}
                className="flex-1 text-xs px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 font-sans"
              />

              <button
                type="submit"
                disabled={sending || (!inputText.trim() && pendingFiles.length === 0)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition shadow-xs shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                {sending ? "Đang xử lý..." : "Gửi tin"}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold mb-3 shadow-xs">
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
    </div>
  );
}
