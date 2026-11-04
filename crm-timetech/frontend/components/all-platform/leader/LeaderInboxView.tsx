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
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiTab, setActiveEmojiTab] = useState(0);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

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

  // Group theo account_id
  const grouped = useMemo(() => {
    const map = new Map<string, { account: SharedRow["zalo_accounts"]; rows: SharedRow[] }>();
    for (const row of sharedList) {
      if (!map.has(row.account_id)) {
        map.set(row.account_id, { account: row.zalo_accounts, rows: [] });
      }
      map.get(row.account_id)!.rows.push(row);
    }
    return Array.from(map.entries());
  }, [sharedList]);

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

  // Leader xác minh 1 share — share đó mới được tính vào kpi_inbox
  const handleVerify = useCallback(
    async (rowId: number, currentlyVerified: boolean) => {
      if (!leaderEmail) return;
      setVerifyingId(rowId);
      try {
        if (currentlyVerified) {
          // Đã verify → bấm lại để thu hồi
          const res = await zaloInboxShareService.unverify(rowId);
          if (res?.success) {
            if (onStatusChange) onStatusChange();
            setSharedList((prev) =>
              prev.map((r) =>
                r.id === rowId
                  ? { ...r, is_verify: false, verified_at: null, verified_by: null }
                  : r,
              ),
            );
          }
        } else {
          // Chưa verify → xác minh
          const res = await zaloInboxShareService.verify(rowId, leaderEmail);
            if (res?.success) {
              if (onStatusChange) onStatusChange();
              // BE trả {success, row} phẳng — fallback data.row cho tương thích
              const row = (res as { row?: { is_verify?: boolean; verified_at?: string; verified_by?: string } })?.row
                || (res as { data?: { row?: { is_verify?: boolean; verified_at?: string; verified_by?: string } } })?.data?.row;
              setSharedList((prev) =>
                prev.map((r) =>
                  r.id === rowId
                    ? {
                        ...r,
                        is_verify: true,
                        verified_at: row?.verified_at || new Date().toISOString(),
                        verified_by: row?.verified_by || leaderEmail,
                      }
                    : r,
                ),
              );
            }
        }
      } finally {
        setVerifyingId(null);
      }
    },
    [leaderEmail],
  );

  const [togglingLeadId, setTogglingLeadId] = useState<number | null>(null);

  const [showLeadModal, setShowLeadModal] = useState(false);
  const { user: appUser } = useAppAuth();

  const handleToggleLead = useCallback(
    async (rowId: number, currentlyLead: boolean) => {
      if (!leaderEmail) return;
      setTogglingLeadId(rowId);
      try {
        const res = await zaloInboxShareService.toggleLead(rowId, leaderEmail, !currentlyLead);
        if (res?.success) {
          if (onStatusChange) onStatusChange();
          setSharedList((prev) =>
            prev.map((r) =>
              r.id === rowId ? { ...r, is_lead: !currentlyLead } : r
            )
          );
        }
      } finally {
        setTogglingLeadId(null);
      }
    },
    [leaderEmail]
  );

  // Đếm số share đã verify trong nhóm hiện tại
  const verifiedCount = useMemo(
    () => sharedList.filter((r) => r.is_verify || r.verified_at).length,
    [sharedList],
  );
  const totalCount = sharedList.length;

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
              <MaterialIcon name="visibility" className="text-red-600 text-[20px]" />
              Xem Inbox (KPI verification)
            </h2>
            <p className="text-[11px] text-on-surface-variant mt-0.5">
              {memberName || memberEmail || "—"} · {sharedList.length} hội thoại đã share
              {totalCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">
                  <MaterialIcon name="verified" className="text-[12px]" />
                  {verifiedCount}/{totalCount} đã xác minh
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-on-surface-variant cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh 10s
            </label>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface-variant hover:bg-surface-container-highest/50"
              title="Đóng"
            >
              <MaterialIcon name="close" className="text-[20px]" />
            </button>
          </div>
        </div>

        {/* Body: sidebar + chat */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <div className={`w-full md:w-72 border-r border-outline-variant flex-col bg-surface-container-low ${activeConversationId ? "hidden md:flex" : "flex"}`}>
            <div className="p-3 border-b border-outline-variant">
              <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                Member
              </label>
              <input
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value.toLowerCase())}
                placeholder="email@company.com"
                className="w-full mt-1 bg-surface border border-outline-variant rounded-lg px-2 py-1.5 text-xs outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/20"
              />
              <button
                onClick={refreshList}
                disabled={loadingList || !memberEmail}
                className="mt-2 w-full rounded-lg bg-red-600 text-white text-xs font-bold py-1.5 hover:bg-red-700 transition disabled:opacity-50"
              >
                {loadingList ? "Đang tải…" : "Tải danh sách share"}
              </button>
              {listError && (
                <p className="mt-1 text-[10px] text-red-600">{listError}</p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {grouped.length === 0 && !loadingList && (
                <p className="text-center text-[11px] text-on-surface-variant py-8 leading-relaxed">
                  Member này chưa share hội thoại nào với bạn.
                  <br />
                  Nhắc member tick 👁 ở Zalo Chat.
                </p>
              )}
              {grouped.map(([accId, group]) => (
                <div key={accId} className="space-y-1">
                  <div className="text-[10px] font-bold text-on-surface-variant uppercase px-1.5 pt-1">
                    {group.account?.label || accId.slice(0, 10)}…
                  </div>
                  {group.rows.map((row) => {
                    const isActive = row.conversation_id === activeConversationId;
                    const isVerified = row.is_verify ?? !!row.verified_at;
                    return (
                      <div
                        key={row.conversation_id}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition ${
                          isActive
                            ? "bg-red-50 text-red-600 font-bold"
                            : "hover:bg-surface-container-highest/50 text-on-surface"
                        }`}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setActiveAccountId(row.account_id);
                            setActiveConversationId(row.conversation_id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setActiveAccountId(row.account_id);
                              setActiveConversationId(row.conversation_id);
                            }
                          }}
                          className="w-full text-left cursor-pointer outline-none"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className={`truncate flex-1 text-[13px] ${isActive ? "font-semibold" : ""}`}>
                              💬 {row.group_name || `${row.conversation_id.slice(0, 14)}…`}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleVerify(row.id, isVerified);
                              }}
                              disabled={verifyingId === row.id}
                              className={`inline-flex items-center justify-center shrink-0 w-7 h-7 rounded-full transition cursor-pointer disabled:opacity-50 ${
                                isVerified
                                  ? "text-emerald-500 hover:bg-emerald-50"
                                  : "text-outline hover:text-on-surface-variant hover:bg-surface-container-low"
                              }`}
                              title={
                                isVerified
                                  ? `Đã xác minh lúc ${new Date(row.verified_at!).toLocaleString("vi-VN")}. Bấm để thu hồi.`
                                  : "Bấm để xác minh KPI hội thoại này"
                              }
                            >
                              {verifyingId === row.id ? (
                                <MaterialIcon name="pending" className="text-[18px] animate-pulse" />
                              ) : isVerified ? (
                                <MaterialIcon name="verified" className="text-[20px]" />
                              ) : (
                                <MaterialIcon name="check_circle" className="text-[20px]" />
                              )}
                            </button>
                          </div>
                          {row.note && (
                            <div className="text-[11px] text-on-surface-variant mt-0.5 truncate pr-8">
                              “{row.note}”
                            </div>
                          )}
                        </div>
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
                <div className="px-4 py-2 border-b border-outline-variant bg-surface">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setActiveConversationId(null)}
                      className="md:hidden p-1.5 -ml-2 rounded-lg text-on-surface-variant hover:bg-surface-container-low shrink-0"
                      title="Quay lại danh sách"
                    >
                      <MaterialIcon name="arrow_back" className="text-[20px]" />
                    </button>
                    <p className="text-xs font-bold text-on-surface truncate max-w-[160px] sm:max-w-[250px]">
                      {sharedList.find((r) => r.conversation_id === activeConversationId)?.group_name || activeConversationId}
                    </p>
                    <button
                      onClick={() => setShowLeadModal(true)}
                      className="ml-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-yellow-100 text-yellow-800 hover:bg-yellow-200 text-xs font-bold transition-colors"
                      title="Lưu khách hàng (Lead) này"
                    >
                      <MaterialIcon name="person_add" className="text-[14px]" />
                      Lưu Lead
                    </button>
                    {(() => {
                      const active = sharedList.find(
                        (r) => r.conversation_id === activeConversationId,
                      );
                      if (!active) return null;
                      const isVerified = active.is_verify ?? !!active.verified_at;
                      return (
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVerify(active.id, isVerified);
                            }}
                            disabled={verifyingId === active.id}
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-bold transition disabled:opacity-50 ${
                              isVerified
                                ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                                : "bg-red-700 hover:bg-red-800 text-white border border-red-700"
                            }`}
                            title={
                              isVerified
                                ? "Bấm để thu hồi xác minh"
                                : "Bấm để xác minh KPI cho hội thoại này"
                            }
                          >
                            <MaterialIcon
                              name={isVerified ? "check_circle" : "verified"}
                              className="text-[14px]"
                            />
                            {verifyingId === active.id
                              ? "Đang xử lý..."
                              : isVerified
                                ? "Đã xác minh KPI"
                                : "Xác minh KPI Inbox"}
                          </button>

                          {isVerified && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleLead(active.id, !!active.is_lead);
                              }}
                              disabled={togglingLeadId === active.id}
                              className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-bold transition disabled:opacity-50 ${
                                active.is_lead
                                  ? "bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200"
                                  : "bg-surface hover:bg-surface-container-low text-on-surface-variant border border-outline-variant"
                              }`}
                              title="Đánh dấu hội thoại này là có tiềm năng"
                            >
                              <MaterialIcon
                                name={active.is_lead ? "star" : "star_border"}
                                className={`text-[14px] ${active.is_lead ? "text-blue-500" : "text-on-surface-variant"}`}
                              />
                              {togglingLeadId === active.id
                                ? "Đang xử lý..."
                                : active.is_lead
                                  ? "Khách Tiềm Năng"
                                  : "Đánh dấu Tiềm Năng"}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <p className="text-[10px] text-on-surface-variant">
                    Account: {activeAccountId}
                  </p>
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
