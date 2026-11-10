"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MaterialIcon } from "@/components/ui";
import { zaloInboxShareService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { API_KEY } from "@/lib/env";
import { sendZaloMessage, sendZaloMessageWithFiles } from "@/services/zaloCrawlerService";
import { CrmCustomerModal } from "@/components/all-platform/components/CrmCustomerModal";

interface SelectedMedia {
  file: File;
  previewUrl?: string;
}

const EMOJI_CATEGORIES = [
  {
    name: "Cảm xúc",
    emojis: ["😊", "😂", "🥰", "😍", "😉", "😘", "😜", "😎", "🤩", "🥳", "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😇", "🙂", "🙃", "😌", "😋", "😛", "😝", "😜", "🤪", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤔", "🤭", "🤫", "🤥", "😬", "🙄"]
  },
  {
    name: "Cử chỉ",
    emojis: ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "👋", "🤚", "🖐️", "✋", "🖖", "✍️", "💅", "🤳", "💪"]
  },
  {
    name: "Yêu thích",
    emojis: ["❤️", "💖", "💘", "💝", "💕", "💞", "💓", "💗", "❣️", "💟", "💌", "💔", "❤️‍🔥", "❤️‍🩹", "🔥", "✨", "⭐", "🌟", "💫", "💥", "💯", "🎉", "🎁", "🎈", "🍻", "☕", "🍕", "🧁", "🍓", "🐱", "🐶", "🌸", "🍀"]
  }
];

const QUICK_REPLIES = [
  "Dạ chào anh/chị, bên em là đơn vị chuyên cung cấp dịch vụ thiết kế Website chuyên nghiệp, chuẩn SEO và tối ưu trải nghiệm người dùng ạ.",
  "Công ty em hiện đang phát triển các giải pháp AI Chatbot thông minh, giúp tự động chăm sóc khách hàng 24/7 và tăng tỷ lệ chuyển đổi hiệu quả.",
  "Bên em có các bộ Tool tự động hóa quy trình nghiệp vụ, hỗ trợ doanh nghiệp tiết kiệm chi phí nhân sự và tối ưu hiệu suất làm việc ạ.",
  "Anh/chị đang có nhu cầu xây dựng hệ thống phần mềm quản lý hay website thương mại điện tử? Bên em có thể tư vấn giải pháp chi tiết nhé.",
  "Dạ em gửi anh/chị profile năng lực và các dự án tiêu biểu bên em đã triển khai để mình tham khảo thêm ạ."
];

interface LeaderInboxViewProps {
  isOpen: boolean;
  onClose: () => void;
  /** Member mà leader muốn xem inbox (nếu trống thì leader chọn từ dropdown) */
  memberEmail?: string;
  memberName?: string;
  /** Override leaderEmail, dùng cho admin */
  leaderEmail?: string;
  onStatusChange?: () => void;
}

interface SharedRow {
  id: number;
  account_id: string;
  conversation_id: string;
  is_active: boolean;
  is_verify?: boolean;
  is_lead?: boolean;
  note?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  updated_at?: string | null;
  zalo_accounts?: { label?: string; phone?: string } | null;
  group_name?: string | null;
}

interface MessageItem {
  id?: string;
  type?: string;
  content?: string;
  sender_name?: string;
  is_sent?: boolean;
  created_at?: string;
  assets?: { source_url?: string; storage_url?: string; status?: string }[];
}

/**
 * Popup Zalo chat cho Leader — luồng "Tin nhắn KPI verification".
 *
 * - Dropdown: chọn member (nếu prop memberEmail chưa truyền).
 * - Sidebar: chỉ liệt kê conversation mà member đã share (is_active=true).
 * - Message area: load messages từ API + realtime qua SSE/poll.
 * - Leader vẫn có thể gõ gửi (ghi nhận qua Zalo backend).
 */
export function LeaderInboxView({
  isOpen,
  onClose,
  memberEmail: initialMemberEmail,
  memberName: initialMemberName,
  leaderEmail: overrideLeaderEmail,
  onStatusChange,
}: LeaderInboxViewProps) {
  const { user } = useAppAuth();
  const leaderEmail = (overrideLeaderEmail || user?.email || "").trim().toLowerCase();

  const [memberEmail, setMemberEmail] = useState((initialMemberEmail || "").trim().toLowerCase());
  const [memberName, setMemberName] = useState(initialMemberName || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [sharedList, setSharedList] = useState<SharedRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiTab, setActiveEmojiTab] = useState(0);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (initialMemberEmail) {
      setMemberEmail(initialMemberEmail.trim().toLowerCase());
    }
    if (initialMemberName) {
      setMemberName(initialMemberName);
    }
  }, [initialMemberEmail, initialMemberName]);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const quickRepliesRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom when messages or active conversation changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeConversationId]);

  // Click outside listener for emoji picker & quick replies
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (quickRepliesRef.current && !quickRepliesRef.current.contains(event.target as Node)) {
        setShowQuickReplies(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newMedia = Array.from(e.target.files).map((file) => {
        const isImage = file.type.startsWith("image/");
        return {
          file,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        };
      });
      setSelectedMedia((prev) => [...prev, ...newMedia]);
    }
    e.target.value = "";
  };

  const handleRemoveMedia = (index: number) => {
    setSelectedMedia((prev) => {
      const item = prev[index];
      if (item && item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleEmojiClick = (emoji: string) => {
    setDraft((prev) => prev + emoji);
  };

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return sharedList;
    const q = searchQuery.toLowerCase();
    return sharedList.filter(
      (r) =>
        (r.group_name || "").toLowerCase().includes(q) ||
        r.conversation_id.toLowerCase().includes(q)
    );
  }, [sharedList, searchQuery]);

  // Group theo account_id
  const grouped = useMemo(() => {
    const map = new Map<string, { account: SharedRow["zalo_accounts"]; rows: SharedRow[] }>();
    for (const row of filteredList) {
      if (!map.has(row.account_id)) {
        map.set(row.account_id, { account: row.zalo_accounts, rows: [] });
      }
      map.get(row.account_id)!.rows.push(row);
    }
    return Array.from(map.entries());
  }, [filteredList]);

  // Load share list khi mở popup hoặc đổi member
  const refreshList = useCallback(async () => {
    if (!leaderEmail) return;
    setLoadingList(true);
    setListError(null);
    try {
      const res = await zaloInboxShareService.leaderView(leaderEmail, memberEmail || undefined);
      if (res?.success) {
        // BE trả {success, items, total} phẳng — fallback data.items cho tương thích
        const items: SharedRow[] =
          (res as { items?: SharedRow[] })?.items ||
          (res as { data?: { items?: SharedRow[] } })?.data?.items ||
          [];
        if (process.env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.debug("[LeaderInboxView] leaderView", {
            leaderEmail, memberEmail, itemsCount: items.length, res,
          });
        }
        setSharedList(items);
        // Auto-select account đầu tiên nếu chưa chọn
        const first = items[0];
        if (first && !activeAccountId) {
          setActiveAccountId(first.account_id);
        }
      } else {
        setListError(res?.message || "Lỗi tải danh sách");
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.debug("[LeaderInboxView] leaderView FAILED", {
          leaderEmail, memberEmail, err: err instanceof Error ? err.message : err,
        });
      }
      setListError(err instanceof Error ? err.message : "unknown");
    } finally {
      setLoadingList(false);
    }
  }, [leaderEmail, memberEmail, activeAccountId]);

  useEffect(() => {
    if (isOpen) {
      if (initialMemberName) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMemberName(initialMemberName);
      }
      refreshList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, leaderEmail, memberEmail]);

  const [showLeadModal, setShowLeadModal] = useState(false);
  const { user: appUser } = useAppAuth();

  // Load messages khi chọn conversation
  useEffect(() => {
    if (!activeAccountId || !activeConversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingMessages(true);
      try {
        const items = await fetchMessagesFallback(activeAccountId, activeConversationId);
        if (!cancelled) setMessages(items);
      } catch (err) {
        if (!cancelled) {
          // Fallback cuối cùng
          const items = await fetchMessagesFallback(activeAccountId, activeConversationId);
          if (!cancelled) setMessages(items);
        }
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, activeConversationId]);

  // Auto refresh messages mỗi 10s khi conversation active
  useEffect(() => {
    if (!autoRefresh || !activeAccountId || !activeConversationId) return;
    const timer = setInterval(async () => {
      const items = await fetchMessagesFallback(activeAccountId, activeConversationId);
      setMessages(items);
    }, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, activeAccountId, activeConversationId]);

  if (!isOpen) return null;

  async function handleSend() {
    if (!activeAccountId || !activeConversationId || sending) return;
    const textToSend = draft.trim();
    if (!textToSend && selectedMedia.length === 0) return;

    setSending(true);
    setSendError(null);
    const mediaToSend = [...selectedMedia];

    // Clear inputs immediately for better UX
    setDraft("");
    setSelectedMedia([]);

    try {
      if (mediaToSend.length > 0) {
        const filesOnly = mediaToSend.map((m) => m.file);
        // Note: For LeaderInboxView, activeAccountId is the Member's account ID (returned by check_collaborator_owner)
        // thread_type: infer from conversation_id (starts with 'g' -> 1, else 0)
        const threadType = activeConversationId.trim().startsWith("g") ? 1 : 0;
        await sendZaloMessageWithFiles(
          activeAccountId,
          activeConversationId,
          textToSend,
          filesOnly,
          threadType
        );
      } else {
        await sendZaloMessage(activeAccountId, activeConversationId, {
          text: textToSend,
        });
      }

      mediaToSend.forEach((m) => {
        if (m.previewUrl) URL.revokeObjectURL(m.previewUrl);
      });

      // refresh messages
      const items = await fetchMessagesFallback(activeAccountId, activeConversationId);
      setMessages(items);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Không thể gửi tin nhắn.");
      setDraft(textToSend);
      setSelectedMedia(mediaToSend);
    } finally {
      setSending(false);
    }
  }

  const handleQuickReply = async (text: string) => {
    if (!activeAccountId || !activeConversationId || sending) return;
    setSending(true);
    setSendError(null);

    try {
      await sendZaloMessage(activeAccountId, activeConversationId, { text });
      const items = await fetchMessagesFallback(activeAccountId, activeConversationId);
      setMessages(items);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Không thể gửi tin nhắn nhanh.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          cursor: "pointer",
        }}
      />
      <div
        className="relative z-10 w-full h-full sm:h-[85vh] sm:max-w-4xl bg-surface sm:rounded-xl rounded-none sm:border border-outline-variant shadow-xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant bg-surface-container-low">
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <MaterialIcon name="chat" className="text-[#ba244a] text-[20px]" />
              Hộp thoại Zalo của thành viên
            </h2>
            <p className="text-[11px] text-on-surface-variant mt-0.5">
              <span className="font-bold text-slate-800">{memberName || memberEmail || "—"}</span>
              <span className="mx-1.5">·</span>
              <span className="text-[#ba244a] font-semibold">{filteredList.length} cuộc hội thoại</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-[11px] text-on-surface-variant cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded accent-[#ba244a]"
              />
              Auto-refresh 10s
            </label>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-slate-900 hover:bg-slate-200 transition cursor-pointer"
              title="Đóng"
            >
              <MaterialIcon name="close" className="text-[20px]" />
            </button>
          </div>
        </div>

        {/* Body: sidebar + chat */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <div className={`w-full md:w-80 border-r border-outline-variant flex flex-col bg-surface-container-low ${activeConversationId ? "hidden md:flex" : "flex"}`}>
            <div className="p-3 border-b border-outline-variant space-y-2">
              {!initialMemberEmail ? (
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                    Chọn Thành viên
                  </label>
                  <div className="flex gap-1.5 mt-1">
                    <input
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value.toLowerCase())}
                      placeholder="email@company.com"
                      className="flex-1 bg-surface border border-outline-variant rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#ba244a] focus:ring-2 focus:ring-[#ba244a]/20"
                    />
                    <button
                      onClick={refreshList}
                      disabled={loadingList || !memberEmail}
                      className="rounded-lg bg-[#ba244a] text-white text-xs font-bold px-3 py-1.5 hover:bg-[#a01c3e] transition disabled:opacity-50 cursor-pointer"
                    >
                      {loadingList ? "Đang tải…" : "Lọc"}
                    </button>
                  </div>
                </div>
              ) : null}
              {/* Thanh tìm kiếm nhanh cuộc trò chuyện */}
              <div>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="🔍 Tìm tên khách hoặc ID..."
                  className="w-full bg-surface border border-outline-variant rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#ba244a] focus:ring-2 focus:ring-[#ba244a]/20 transition"
                />
              </div>
              {listError && (
                <p className="mt-1 text-[10px] text-red-600">{listError}</p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {grouped.length === 0 && !loadingList && (
                <div className="text-center text-[11px] text-on-surface-variant py-12 px-4 leading-relaxed">
                  <MaterialIcon name="forum" className="text-slate-300 text-3xl mx-auto mb-2" />
                  <p className="font-semibold text-slate-600">Chưa có cuộc trò chuyện nào</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Hội thoại sẽ tự động xuất hiện khi thành viên nhắn tin qua Zalo hoặc PostFeed.
                  </p>
                </div>
              )}
              {grouped.map(([accId, group]) => (
                <div key={accId} className="space-y-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase px-2 pt-1 flex items-center justify-between">
                    <span>📱 {group.account?.label || group.account?.phone || accId.slice(0, 10)}</span>
                    <span className="text-[9px] font-normal text-slate-400">{group.rows.length} hội thoại</span>
                  </div>
                  {group.rows.map((row) => {
                    const isActive = row.conversation_id === activeConversationId;
                    return (
                      <div
                        key={`${row.account_id}_${row.conversation_id}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setActiveAccountId(row.account_id);
                          setActiveConversationId(row.conversation_id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setActiveAccountId(row.account_id);
                            setActiveConversationId(row.conversation_id);
                          }
                        }}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                          isActive
                            ? "bg-[#ba244a]/10 text-[#ba244a] font-bold border border-[#ba244a]/30 shadow-xs"
                            : "hover:bg-slate-100 text-slate-800 border border-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className={`truncate flex-1 text-[13px] ${isActive ? "font-bold text-[#ba244a]" : "font-medium text-slate-800"}`}>
                            💬 {row.group_name || `Khách: ${row.conversation_id.slice(0, 14)}…`}
                          </span>
                        </div>
                        {row.note && (
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                            “{row.note}”
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Message area */}
          <div className={`flex-1 flex-col min-w-0 bg-surface ${!activeConversationId ? "hidden md:flex" : "flex"}`}>
            {activeConversationId ? (
              <>
                <div className="px-4 py-2.5 border-b border-outline-variant bg-surface flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => setActiveConversationId(null)}
                      className="md:hidden p-1.5 -ml-2 rounded-lg text-on-surface-variant hover:bg-surface-container-low shrink-0"
                      title="Quay lại danh sách"
                    >
                      <MaterialIcon name="arrow_back" className="text-[20px]" />
                    </button>
                    <p className="text-sm font-bold text-slate-900 truncate max-w-[220px] sm:max-w-[320px]">
                      {sharedList.find((r) => r.conversation_id === activeConversationId)?.group_name || `Hội thoại: ${activeConversationId}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setShowLeadModal(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 hover:bg-yellow-100 text-xs font-bold transition cursor-pointer"
                      title="Lưu thông tin khách hàng tiềm năng vào CRM"
                    >
                      <MaterialIcon name="person_add" className="text-[14px]" />
                      Lưu Lead
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-surface-container-low">
                  {loadingMessages && messages.length === 0 ? (
                    <p className="text-center text-xs text-on-surface-variant py-8">Đang tải…</p>
                  ) : messages.length === 0 ? (
                    <p className="text-center text-xs text-on-surface-variant py-8">Chưa có tin nhắn</p>
                  ) : (
                    messages.map((m, idx) => (
                      <div
                        key={m.id || idx}
                        className={`flex ${m.is_sent ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-xl px-3 py-1.5 text-xs ${
                            m.is_sent
                              ? "bg-red-600 text-white"
                              : "bg-surface border border-outline-variant text-on-surface"
                          }`}
                        >
                          {m.sender_name && !m.is_sent && (
                            <div className="text-[10px] font-bold mb-0.5">{m.sender_name}</div>
                          )}
                          <div className="whitespace-pre-wrap break-words">
                            {m.type === "image" && m.assets && m.assets.length > 0 ? (
                              <div className="flex flex-col gap-2 mt-1">
                                {m.assets.map((asset, aidx) => (
                                  <img
                                    key={aidx}
                                    src={asset.storage_url || asset.source_url}
                                    alt="Zalo asset"
                                    className="max-w-[150px] object-cover rounded shadow-sm border border-outline-variant"
                                  />
                                ))}
                              </div>
                            ) : m.type === "image" ? (
                                <span className="italic text-on-surface-variant">[Hình ảnh]</span>
                            ) : (
                              m.content || "(trống)"
                            )}
                          </div>
                          <div
                            className={`text-[9px] mt-0.5 ${
                              m.is_sent ? "text-white/70" : "text-on-surface-variant"
                            }`}
                          >
                            {m.created_at ? new Date(m.created_at).toLocaleString("vi-VN") : ""}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <div className="border-t border-outline-variant p-3 bg-surface relative">
                  {/* Invisible Inputs */}
                  <input
                    type="file"
                    ref={imageInputRef}
                    multiple
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    accept="*/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {/* Emoji Picker Popup */}
                  {showEmojiPicker && (
                    <div
                      ref={emojiPickerRef}
                      className="absolute bottom-full mb-3 left-4 z-50 w-72 h-80 bg-surface border border-outline-variant rounded-xl shadow-xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200"
                      style={{ maxHeight: '320px' }}
                    >
                      {/* Category selector */}
                      <div className="flex border-b border-outline-variant bg-surface-container-low px-2 py-1">
                        {EMOJI_CATEGORIES.map((cat, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setActiveEmojiTab(i)}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
                              activeEmojiTab === i
                                ? "bg-surface text-red-600 shadow-sm"
                                : "text-on-surface-variant hover:text-on-surface"
                            }`}
                          >
                            {cat.name}
                          </button>
                        ))}
                      </div>

                      {/* Emoji grid */}
                      <div className="flex-1 overflow-y-auto p-2 grid grid-cols-6 gap-1 content-start">
                        {EMOJI_CATEGORIES[activeEmojiTab].emojis.map((emoji, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleEmojiClick(emoji)}
                            className="h-9 w-9 flex items-center justify-center text-xl rounded-lg hover:bg-surface-container-low active:scale-95 transition"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Replies Popup */}
                  {showQuickReplies && (
                    <div
                      ref={quickRepliesRef}
                      className="absolute bottom-full mb-3 left-14 z-50 w-80 max-h-80 bg-surface border border-outline-variant rounded-xl shadow-xl flex flex-col overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
                    >
                      <div className="px-3 py-2 border-b border-outline-variant bg-surface-container-low sticky top-0 z-10 flex justify-between items-center">
                        <span className="text-xs font-bold text-on-surface">Mẫu câu trả lời nhanh</span>
                        <button onClick={() => setShowQuickReplies(false)} className="text-on-surface-variant hover:text-red-500">
                          <MaterialIcon name="close" className="text-[14px]" />
                        </button>
                      </div>
                      <div className="flex md:flex-col overflow-x-auto md:overflow-x-visible p-1.5 gap-1.5 pb-2 md:pb-1.5 hide-scrollbar scroll-smooth">
                        {QUICK_REPLIES.map((text, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              handleQuickReply(text);
                              setShowQuickReplies(false);
                            }}
                            disabled={sending}
                            className="text-left shrink-0 w-[240px] md:w-auto px-3 py-2 text-[12px] hover:bg-red-50 hover:text-primary text-on-surface bg-surface border border-outline-variant md:border-transparent rounded-lg transition-all hover:border-red-200 disabled:opacity-50 whitespace-normal"
                          >
                            <span className="line-clamp-2 md:line-clamp-none">{text}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Send Error */}
                  {sendError && (
                    <div className="mb-1.5 text-[10px] text-red-600 bg-red-50 px-2 py-1 rounded">
                      {sendError}
                    </div>
                  )}

                  {/* Selected Media Previews */}
                  {selectedMedia.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-1.5 mb-2 rounded-lg border border-outline-variant bg-surface-container-low max-h-24 overflow-y-auto">
                      {selectedMedia.map((item, index) => {
                        const isImage = !!item.previewUrl;
                        return (
                          <div
                            key={index}
                            className="relative group w-10 h-10 rounded border border-outline-variant bg-surface overflow-hidden flex items-center justify-center shadow-sm hover:border-primary/50 transition"
                          >
                            {isImage ? (
                              <img
                                src={item.previewUrl}
                                alt={item.file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center p-0.5 text-center w-full h-full">
                                <MaterialIcon name="description" className="text-base text-primary" />
                                <span className="text-[8px] truncate w-full px-0.5 text-on-surface-variant font-medium">
                                  {item.file.name}
                                </span>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveMedia(index)}
                              className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-md transition transform scale-0 group-hover:scale-100 flex items-center justify-center"
                              style={{ width: '14px', height: '14px' }}
                            >
                              <MaterialIcon name="close" className="text-[8px] font-bold" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className={`text-on-surface-variant hover:text-blue-500 p-1.5 rounded-full hover:bg-blue-50 transition ${
                        showEmojiPicker ? "text-blue-600 bg-blue-100" : ""
                      }`}
                      title="Biểu cảm"
                    >
                      <MaterialIcon name="mood" className="text-[18px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQuickReplies(!showQuickReplies)}
                      className={`text-on-surface-variant hover:text-blue-500 p-1.5 rounded-full hover:bg-blue-50 transition ${
                        showQuickReplies ? "text-blue-600 bg-blue-100" : ""
                      }`}
                      title="Mẫu câu nhanh"
                    >
                      <MaterialIcon name="bolt" className="text-[18px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="text-on-surface-variant hover:text-blue-500 p-1.5 rounded-full hover:bg-blue-50 transition"
                      title="Gửi hình ảnh"
                    >
                      <MaterialIcon name="image" className="text-[18px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-on-surface-variant hover:text-blue-500 p-1.5 rounded-full hover:bg-blue-50 transition"
                      title="Gửi file tài liệu"
                    >
                      <MaterialIcon name="attach_file" className="text-[18px]" />
                    </button>

                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={
                        selectedMedia.length > 0
                          ? "Nhập chữ kèm theo file, Enter để gửi..."
                          : "Nhập tin nhắn, Enter để gửi..."
                      }
                      disabled={sending}
                      className="flex-1 bg-surface-container-low rounded-xl px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/15 focus:bg-surface border border-outline-variant focus:border-primary/30 transition-all disabled:opacity-60"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                    />

                    <button
                      onClick={() => void handleSend()}
                      disabled={sending || (!draft.trim() && selectedMedia.length === 0)}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-primary hover:bg-on-primary-fixed-variant transition disabled:opacity-50 flex items-center gap-1"
                    >
                      <MaterialIcon name="send" className="text-[14px]" />
                      Gửi
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div>
                  <MaterialIcon name="forum" className="text-[48px] text-outline" />
                  <p className="text-sm text-on-surface-variant mt-2">
                    Chọn 1 hội thoại ở sidebar để xem
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <CrmCustomerModal
        isOpen={showLeadModal}
        onClose={() => setShowLeadModal(false)}
        defaultConvId={activeConversationId || undefined}
        defaultCustomerName={sharedList.find((r) => r.conversation_id === activeConversationId)?.group_name || undefined}
        defaultSourcePlatform="Zalo"
      />
    </div>
  );
}

// ── Fallback fetchers (gọi trực tiếp Zalo API khi service chưa có) ──────────
const ZALO_API_BASE = (typeof window !== "undefined"
  ? ((window as unknown) as { __NEXT_DATA__?: { props?: { pageProps?: { apiBase?: string } } } }).__NEXT_DATA__?.props?.pageProps?.apiBase
  : null) || "/api";

async function fetchMessagesFallback(
  userId: string,
  conversationId: string,
): Promise<MessageItem[]> {
  try {
    const res = await fetch(
      `${ZALO_API_BASE}/all-platform/zalo/conversations/${encodeURIComponent(
        conversationId,
      )}/messages?account_id=${encodeURIComponent(userId)}&limit=50`,
      {
        headers: {
          "x-api-key": API_KEY || "",
        },
      }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const rawItems = Array.isArray(json?.messages) ? json.messages : Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];

    const seen = new Set<string>();
    const deduplicated = [];
    for (const m of rawItems) {
      const key = m.id || `${m.created_at}_${m.content}_${m.sender_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(m);
      }
    }

    if (deduplicated.length > 1) {
      const d1 = new Date(deduplicated[0].created_at || 0).getTime();
      const d2 = new Date(deduplicated[deduplicated.length - 1].created_at || 0).getTime();
      if (d1 > d2) {
        deduplicated.reverse();
      }
    }

    return deduplicated;
  } catch {
    return [];
  }
}
