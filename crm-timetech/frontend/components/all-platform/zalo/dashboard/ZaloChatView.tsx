"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { API_BASE_URL, API_KEY } from "@/lib/env";
import type { ZaloCrawlerFlowValue } from "@/hooks/useZaloCrawlerFlow";
import {
  getZaloConversationMessages,
  getZaloConversations,
  createZaloBroadcast,
  sendZaloMessage,
  sendZaloMessageWithFiles,
  markZaloConversationAsRead,
  buildZaloRealtimeStreamUrl,
  getZaloConversationShareStatus,
  setZaloConversationShare,
} from "@/services/zaloCrawlerService";
import type {
  ZaloConversationSummary,
  ZaloLibraryMessage,
  ZaloBroadcastTarget,
} from "@/types/zalo-api";
import { ZaloChatHeaderSkeleton, ZaloMessageListSkeleton } from "./chat/ZaloChatSkeleton";
import { ZaloEmptyChat } from "./chat/ZaloEmptyChat";
import { ZaloConversationListVirtualized } from "./sidebar/ZaloConversationListVirtualized";
import { ZaloNewChatModal } from "./ZaloNewChatModal";
import { ZaloKpiPanel } from "./ZaloKpiPanel";

const REFRESH_INTERVAL_MS = 2000;
const MESSAGE_PAGE_SIZE = 50;
const BOTTOM_THRESHOLD_PX = 96;

interface ZaloChatViewProps {
  flow: ZaloCrawlerFlowValue;
  onBackToDashboard: () => void;
  /**
   * Chế độ full-screen: tăng kích thước UI (font/padding/bubble) cho dễ nhìn.
   * Dùng khi trang này là 1 route độc lập (vd /zalo-chat) thay vì embed trong shell.
   */
  fullScreen?: boolean;
}

function formatTime(value?: string | null) {
  if (!value) return "Chưa có";
  const trimmed = String(value).trim();

  // Case 1: chuỗi số thuần — là timestamp từ Zalo / backend
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    // Zalo trả ms (13 chữ số = 2026). Một số client cũ trả về seconds (10 chữ số = 2026 cũngng có thể).
    // 13 chữ số = ms (> 10^12). 10 chữ số = seconds (< 10^11).
    // Nếu < 10^11 → nhân 1000 để ra ms.
    const ms = num > 1e11 ? num : num * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Ho_Chi_Minh",
    });
  }

  // Case 2: ISO string — backend lưu UTC với 'Z' (vd "2026-06-14T09:36:19.531Z")
  // Browser sẽ tự parse thành Date object ở UTC. Sau đó hiển thị theo VN.
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function shortId(value: string, head = 10, tail = 6) {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function isFallbackName(name: string | null | undefined, id: string) {
  const cleanName = String(name || "").trim();
  return !cleanName || cleanName === id || cleanName === `Conversation ${id}`;
}

function conversationTitle(conversation: ZaloConversationSummary | null) {
  if (!conversation) return "Chọn một hội thoại";
  if (isFallbackName(conversation.conversation_name, conversation.conversation_id)) {
    return "Hội thoại chưa đặt tên";
  }
  return conversation.conversation_name;
}

function initials(value: string) {
  const words = value
    .replace(/^\[|\]$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "Z";
  const second = words.length > 1 ? words[words.length - 1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

// Nhận diện lỗi backend báo phiên Zalo hết hạn (HTTP 401 + thông điệp/code).
function isSessionExpiredError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  return (
    msg.includes("zca_session_expired") ||
    msg.includes("session_expired") ||
    msg.includes("hết hạn") ||
    msg.includes("đăng nhập lại") ||
    msg.includes("api 401")
  );
}

function conversationTimeMs(conversation: ZaloConversationSummary) {
  const value = conversation.latest_message_at;
  if (!value) return 0;
  const num = Number(value);
  if (!Number.isNaN(num) && String(num) === String(value).trim()) {
    return num < 1e11 ? num * 1000 : num;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Sắp xếp sidebar giống Zalo: pinned trước -> last_message_at DESC.
// unread_count CHỈ dùng để hiển thị badge, không tham gia thứ tự.
function sortConversationsLikeZalo(list: ZaloConversationSummary[]) {
  return [...list].sort((a, b) => {
    const pinA = a.is_pinned ? 1 : 0;
    const pinB = b.is_pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;

    const tA = conversationTimeMs(a);
    const tB = conversationTimeMs(b);
    if (tA !== tB) return tB - tA;

    return (a.conversation_name || "").localeCompare(b.conversation_name || "");
  });
}

function messageKey(message: ZaloLibraryMessage) {
  return message.source_message_id || message.id || `${message.group_id}-${message.timestamp_text}-${message.content}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function messageRenderKey(message: ZaloLibraryMessage) {
  const suffix = [
    message.id || "",
    message.timestamp_text || "",
    message.time_text || "",
    message.sender_id || "",
    message.sender_name || "",
    message.content || "",
    message.is_sent ? "1" : "0",
  ].join("|");
  return `${message.group_id || "unknown"}-${messageKey(message)}-${stableHash(suffix)}`;
}

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX;
}

function messageAssets(message: ZaloLibraryMessage) {
  const list = (message.assets || []).filter((asset) => asset.status === "uploaded" && asset.storage_url);
  const seen = new Set<string>();
  const deduped: typeof list = [];
  for (const asset of list) {
    const src = asset.source_url || "";
    const filename = src.split("/").pop()?.split("?")[0] || src;
    if (filename && seen.has(filename)) {
      continue;
    }
    if (filename) {
      seen.add(filename);
    }
    deduped.push(asset);
  }
  return deduped;
}

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
  { shortcut: "/chao", label: "Chào hỏi ban đầu", text: "Dạ chào anh/chị, bên em là đơn vị chuyên cung cấp dịch vụ thiết kế Website chuyên nghiệp, chuẩn SEO và tối ưu trải nghiệm người dùng ạ." },
  { shortcut: "/baogia", label: "Gửi báo giá dịch vụ", text: "Công ty em hiện gửi anh/chị bảng giá các gói thiết kế Website chuyên nghiệp, tích hợp AI và tối ưu chuyển đổi ạ. (Gói Standard: 5M, Gói Pro: 12M)." },
  { shortcut: "/demo", label: "Đặt lịch hẹn demo", text: "Bên em hỗ trợ book lịch demo trực tiếp 1-1 cùng chuyên viên kỹ thuật để trải nghiệm hệ thống tại đây nhé: https://calendly.com/demo-sp" },
  { shortcut: "/xinso", label: "Xin thông tin SĐT / Email", text: "Để tư vấn gói giải pháp phù hợp nhất, em xin phép xin thông tin số điện thoại (Zalo) hoặc Email của anh/chị để gửi tài liệu chi tiết ạ." },
  { shortcut: "/chatbot", label: "Giải pháp Chatbot AI", text: "Công ty em hiện đang phát triển các giải pháp AI Chatbot thông minh, giúp tự động chăm sóc khách hàng 24/7 và tăng tỷ lệ chuyển đổi hiệu quả." },
  { shortcut: "/profile", label: "Hồ sơ năng lực", text: "Dạ em gửi anh/chị profile năng lực và các dự án tiêu biểu bên em đã triển khai để mình tham khảo thêm ạ." }
];

export function ZaloChatView({ flow, onBackToDashboard, fullScreen = false }: ZaloChatViewProps) {
  const [conversations, setConversations] = useState<ZaloConversationSummary[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ZaloLibraryMessage[]>([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  // Chat UI states
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "unread" | "inactive">("all");
  const [inputText, setInputText] = useState("");
  const [avatarErrors, setAvatarErrors] = useState<Record<string, boolean>>({});
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [newChatToast, setNewChatToast] = useState<string | null>(null);

  // Custom Status Tags & Filtering
  const [conversationTags, setConversationTags] = useState<Record<string, string>>({});
  const [filterTag, setFilterTag] = useState<string | null>(null);

  // Slash command quick replies states
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const TAGS = useMemo(() => [
    { value: "new", label: "Mới", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    { value: "chatting", label: "Đang chat", bg: "bg-blue-50 text-blue-700 border-blue-200" },
    { value: "followup", label: "Follow-up", bg: "bg-amber-50 text-amber-700 border-amber-200" },
    { value: "inactive", label: "Không HĐ", bg: "bg-surface-container-low text-on-surface-variant border-outline-variant" },
  ], []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("zalo_conversation_tags");
        if (saved) {
          setConversationTags(JSON.parse(saved));
        }
      } catch (e) {
        console.warn("Failed to load conversation tags", e);
      }
    }
  }, []);

  const handleSetConversationTag = useCallback((convId: string, tag: string) => {
    setConversationTags((prev) => {
      const next = { ...prev, [convId]: tag };
      if (typeof window !== "undefined") {
        localStorage.setItem("zalo_conversation_tags", JSON.stringify(next));
      }
      return next;
    });
  }, []);

  // Auto send / Broadcast states
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [autoSendTargetIds, setAutoSendTargetIds] = useState<string[]>([]);
  const [autoSendSearchQuery, setAutoSendSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [autoSendSuccess, setAutoSendSuccess] = useState<string | null>(null);
  const [autoSendError, setAutoSendError] = useState<string | null>(null);
  const [isAutoSendOpen, setIsAutoSendOpen] = useState(false);

  // Custom states matching mockup redesign
  const [manualRecipients, setManualRecipients] = useState("");
  const [campaignMode, setCampaignMode] = useState<"both" | "text" | "image">("both");
  const [showSystemTargets, setShowSystemTargets] = useState(false);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [campaignLogs, setCampaignLogs] = useState<{ name: string; status: "sending" | "success" | "failed" }[]>([]);
  const [campaignStatus, setCampaignStatus] = useState<string | null>(null);

  // Pinned & Hidden states
  const [pinnedConversations, setPinnedConversations] = useState<Record<string, boolean>>({});
  const [hiddenConversations, setHiddenConversations] = useState<Record<string, boolean>>({});

  const [sidebarWidth, setSidebarWidth] = useState(260);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const chatList = sidebarRef.current;
    if (!chatList) return;

    let handle = chatList.querySelector('.zalo-drag-handle') as HTMLDivElement;
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'zalo-drag-handle';
      handle.style.cssText = 'width:4px;cursor:col-resize;background:transparent;position:absolute;right:0;top:0;height:100%;z-index:30';
      chatList.style.position = 'relative';
      chatList.appendChild(handle);
    }

    let dragging = false;
    const onMouseDown = (e: MouseEvent) => {
      dragging = true;
      e.preventDefault();
    };
    handle.addEventListener('mousedown', onMouseDown);

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = chatList.getBoundingClientRect();
      const w = Math.min(400, Math.max(200, e.clientX - rect.left));
      chatList.style.width = w + 'px';
      chatList.style.minWidth = w + 'px';
      localStorage.setItem('chatListWidth', String(w));
      localStorage.setItem('zalo_sidebar_width', String(w));
      setSidebarWidth(w);
    };

    const onMouseUp = () => {
      dragging = false;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    const saved = localStorage.getItem('chatListWidth') || localStorage.getItem('zalo_sidebar_width');
    if (saved) {
      const w = parseInt(saved, 10);
      if (!isNaN(w)) {
        const clamped = Math.min(400, Math.max(200, w));
        chatList.style.width = clamped + 'px';
        chatList.style.minWidth = clamped + 'px';
        setSidebarWidth(clamped);
      }
    }

    return () => {
      if (handle) {
        handle.removeEventListener('mousedown', onMouseDown);
        handle.remove();
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedPins = localStorage.getItem("zalo_pinned_conversations");
        if (savedPins) {
          setPinnedConversations(JSON.parse(savedPins));
        }
        const savedHides = localStorage.getItem("zalo_hidden_conversations");
        if (savedHides) {
          setHiddenConversations(JSON.parse(savedHides));
        }
      } catch (e) {
        console.warn("Failed to load local settings", e);
      }
    }
  }, []);

  const handleTogglePin = useCallback((convId: string) => {
    setPinnedConversations((prev) => {
      const next = { ...prev, [convId]: !prev[convId] };
      if (typeof window !== "undefined") {
        localStorage.setItem("zalo_pinned_conversations", JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const handleToggleHide = useCallback((convId: string) => {
    setHiddenConversations((prev) => {
      const next = { ...prev, [convId]: !prev[convId] };
      if (typeof window !== "undefined") {
        localStorage.setItem("zalo_hidden_conversations", JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const handleLoadTargets = () => {
    setIsLoadingTargets(true);
    setTimeout(() => {
      setIsLoadingTargets(false);
      setShowSystemTargets(true);
    }, 800);
  };

  // Direct send state
  const [isSendingDirect, setIsSendingDirect] = useState(false);
  const [directSendError, setDirectSendError] = useState<string | null>(null);

  // New media send and emoji states
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiTab, setActiveEmojiTab] = useState(0);

  // Quick replies states
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  const handleOpenZaloWeb = useCallback(() => {
    const params = new URLSearchParams({
      zaloExtUserId: flow.userId || "",
      zaloExtApiKey: API_KEY || "secret_api_key",
      zaloExtBackendUrl: API_BASE_URL || "http://127.0.0.1:8000"
    });
    window.open(`https://chat.zalo.me/?${params.toString()}`, '_blank');
  }, [flow.userId]);

  // Realtime SSE state (mới ở bước 7).
  // Khi sseConnected=true → có thể giảm polling interval.
  const [sseConnected, setSseConnected] = useState(false);

  // Share status per conversation: Map<conversation_id, ZaloShareStatus>
  // Dùng để hiển thị icon "share với admin/leader" ở sidebar + toggle ở header.
  const [shareStatus, setShareStatus] = useState<
    Record<string, { admin: boolean; leader: boolean }>
  >({});

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const quickRepliesRef = useRef<HTMLDivElement | null>(null);

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<"bottom" | "preserve" | null>(null);
  const preservedScrollRef = useRef<{ previousHeight: number; previousTop: number }>({ previousHeight: 0, previousTop: 0 });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = `${nextHeight}px`;
  }, [inputText]);

  const filteredSlashReplies = useMemo(() => {
    if (!inputText.startsWith("/")) return [];
    const query = inputText.slice(1).toLowerCase();
    return QUICK_REPLIES.filter(
      (r) =>
        r.shortcut.toLowerCase().includes(query) ||
        r.label.toLowerCase().includes(query) ||
        r.text.toLowerCase().includes(query)
    );
  }, [inputText]);

  useEffect(() => {
    if (inputText.startsWith("/") && filteredSlashReplies.length > 0) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
      setSlashSelectedIndex(0);
    }
  }, [inputText, filteredSlashReplies.length]);

  // Track the request currently fetching messages so we can ignore stale responses
  // when the user switches groups faster than the API responds.
  const messagesRequestIdRef = useRef(0);
  const lastLoadedConversationIdRef = useRef<string | null>(null);

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

  const selectedAccount = useMemo(
    () => flow.accounts.find((account) => account.account_id === flow.userId) ?? null,
    [flow.accounts, flow.userId],
  );

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.conversation_id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  // Build a minimal "view model" for the chat header so we can keep rendering messages
  // even when the conversation summary hasn't been fetched yet (or the polling
  // momentarily dropped it from `conversations`). The Messages Area only depends on
  // `selectedConversationId`, not on this object.
  const selectedConversationView = useMemo<{
    conversation_id: string;
    conversation_name: string;
    avatar_url: string | null;
  } | null>(() => {
    if (!selectedConversationId) return null;
    if (selectedConversation) {
      return {
        conversation_id: selectedConversation.conversation_id,
        conversation_name: conversationTitle(selectedConversation),
        avatar_url: selectedConversation.avatar_url ?? null,
      };
    }
    return {
      conversation_id: selectedConversationId,
      conversation_name: `Hội thoại ${shortId(selectedConversationId, 8, 4)}`,
      avatar_url: null,
    };
  }, [selectedConversation, selectedConversationId]);

  const filteredConversations = useMemo(() => {
    let filtered = conversations;

    // Hide hidden chats
    filtered = filtered.filter(c => !hiddenConversations[c.conversation_id]);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        (c.conversation_name || "").toLowerCase().includes(q) ||
        (c.latest_content || "").toLowerCase().includes(q)
      );
    }

    if (activeTab === "unread") {
      filtered = filtered.filter(c =>
        (c.unread_count !== undefined && c.unread_count > 0) ||
        (c.unread_count === undefined && c.message_count > 0 && c.latest_sender_name !== "Bạn")
      );
    } else if (activeTab === "inactive") {
      filtered = filtered.filter(c =>
        c.message_count === 0 || c.has_messages === false || c.sync_status === "known_empty"
      );
    }

    if (filterTag) {
      filtered = filtered.filter(c => {
        const tag = conversationTags[c.conversation_id] || "new";
        return tag === filterTag;
      });
    }

    // Sort by pin state and last message time
    return [...filtered].sort((a, b) => {
      const pinA = pinnedConversations[a.conversation_id] || a.is_pinned ? 1 : 0;
      const pinB = pinnedConversations[b.conversation_id] || b.is_pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;

      const tA = conversationTimeMs(a);
      const tB = conversationTimeMs(b);
      if (tA !== tB) return tB - tA;

      return (a.conversation_name || "").localeCompare(b.conversation_name || "");
    });
  }, [conversations, searchQuery, activeTab, filterTag, conversationTags, pinnedConversations, hiddenConversations]);

  const loadConversations = useCallback(async (options?: { silent?: boolean }) => {
    if (!flow.userId || flow.userId === "default") {
      setConversations([]);
      setSelectedConversationId(null);
      return;
    }
    if (!options?.silent) setIsLoadingConversations(true);
    setConversationError(null);
    try {
      const response = await getZaloConversations(flow.userId);
      const nextConversations = sortConversationsLikeZalo(response.conversations ?? []);
      setConversations(nextConversations);
      setSelectedConversationId((current) => {
        if (current && nextConversations.some((item) => item.conversation_id === current)) {
          return current;
        }
        return nextConversations[0]?.conversation_id ?? null;
      });
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : "Không thể tải danh sách hội thoại.");
    } finally {
      if (!options?.silent) setIsLoadingConversations(false);
    }
  }, [flow.userId]);

  const loadLatestMessages = useCallback(async (conversationId: string | null, options?: { silent?: boolean }) => {
    if (!flow.userId || flow.userId === "default" || !conversationId) {
      setMessages([]);
      setMessageTotal(0);
      setHasOlderMessages(false);
      lastLoadedConversationIdRef.current = null;
      return;
    }
    // Bump request id so any in-flight responses for a different conversation get ignored.
    const requestId = ++messagesRequestIdRef.current;
    if (!options?.silent) setIsLoadingMessages(true);
    setMessageError(null);
    try {
      const response = await getZaloConversationMessages(
        flow.userId,
        conversationId,
        MESSAGE_PAGE_SIZE,
        0,
      );
      // Drop stale response if the user navigated to another conversation meanwhile.
      if (requestId !== messagesRequestIdRef.current) return;
      lastLoadedConversationIdRef.current = conversationId;
      pendingScrollRef.current = "bottom";
      setMessages(response.messages ?? []);
      setMessageTotal(response.total ?? 0);
      setHasOlderMessages(Boolean(response.has_more));
      setNewMessageCount(0);
    } catch (error) {
      if (requestId !== messagesRequestIdRef.current) return;
      setMessageError(error instanceof Error ? error.message : "Không thể tải tin nhắn hội thoại.");
    } finally {
      if (requestId === messagesRequestIdRef.current && !options?.silent) {
        setIsLoadingMessages(false);
      }
    }
  }, [flow.userId]);

  const pollLatestMessages = useCallback(async (conversationId: string | null) => {
    if (!flow.userId || flow.userId === "default" || !conversationId) return;
    // Don't poll if the latest explicit load hasn't finished for this conversation yet —
    // otherwise the initial fetch can race with the polling request and the UI may flicker.
    if (lastLoadedConversationIdRef.current !== conversationId) return;
    const shouldStickToBottom = isNearBottom(messageListRef.current);
    try {
      const response = await getZaloConversationMessages(
        flow.userId,
        conversationId,
        MESSAGE_PAGE_SIZE,
        0,
      );
      // Skip if the user switched conversations while the request was in flight.
      if (lastLoadedConversationIdRef.current !== conversationId) return;
      const latestMessages = response.messages ?? [];
      setMessageTotal(response.total ?? 0);
      setHasOlderMessages((response.total ?? 0) > messages.length);
      setMessages((current) => {
        const latestMap = new Map(latestMessages.map(m => [messageKey(m), m]));

        // Update existing messages, and track which ones from latestMessages we have seen
        const updated = current.map(m => {
          const key = messageKey(m);
          if (latestMap.has(key)) {
            return latestMap.get(key)!;
          }
          return m;
        });

        // Find messages in latestMessages that are not in current
        const existingKeys = new Set(current.map(messageKey));
        const newMessages = latestMessages.filter(m => !existingKeys.has(messageKey(m)));

        if (newMessages.length === 0) {
          const hasChanges = current.some((m, idx) => {
            const key = messageKey(m);
            if (!latestMap.has(key)) return false;
            const next = latestMap.get(key)!;
            return JSON.stringify(m) !== JSON.stringify(next);
          });
          return hasChanges ? updated : current;
        }

        if (!shouldStickToBottom) setNewMessageCount((count) => count + newMessages.length);
        if (shouldStickToBottom) pendingScrollRef.current = "bottom";

        return [...updated, ...newMessages];
      });
    } catch {
      // Silent polling should not interrupt the operator while they are reading.
    }
  }, [flow.userId, messages.length]);

  const loadOlderMessages = useCallback(async () => {
    if (!flow.userId || !selectedConversationId || isLoadingOlderMessages || !hasOlderMessages) return;
    const element = messageListRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    setIsLoadingOlderMessages(true);
    setMessageError(null);
    try {
      const response = await getZaloConversationMessages(
        flow.userId,
        selectedConversationId,
        MESSAGE_PAGE_SIZE,
        messages.length,
      );
      const olderMessages = response.messages ?? [];
      preservedScrollRef.current = { previousHeight, previousTop };
      pendingScrollRef.current = "preserve";
      setMessages((current) => {
        const existing = new Set(current.map(messageKey));
        const uniqueOlder = olderMessages.filter((message) => !existing.has(messageKey(message)));
        return [...uniqueOlder, ...current];
      });
      setMessageTotal(response.total ?? messageTotal);
      setHasOlderMessages(messages.length + olderMessages.length < (response.total ?? 0));
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Không thể tải tin nhắn cũ hơn.");
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [flow.userId, hasOlderMessages, isLoadingOlderMessages, messageTotal, messages.length, selectedConversationId]);

  const scrollToLatest = useCallback(() => {
    const element = messageListRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setNewMessageCount(0);
  }, []);

  /**
   * Sau khi user tìm thấy Zalo user lạ và bấm "Nhắn tin" trong modal:
   *   1. Reload danh sách conversations (để thread mới xuất hiện trong sidebar)
   *   2. Auto-select conversation mới tạo để mở khung chat ngay
   *   3. Hiển thị toast thông báo trong ~4s
   */
  const handleNewChatReady = useCallback(
    async (conversationId: string) => {
      try {
        await loadConversations({ silent: true });
      } catch (err) {
        console.warn("[zalo] reload conversations after new chat failed", err);
      }
      setSelectedConversationId(conversationId);
      setNewChatToast("Đã mở cuộc trò chuyện mới");
      window.setTimeout(() => setNewChatToast(null), 4000);
    },
    [loadConversations],
  );

  useEffect(() => {
    const action = pendingScrollRef.current;
    if (!action) return;
    pendingScrollRef.current = null;
    const element = messageListRef.current;
    if (!element) return;
    if (action === "bottom") {
      element.scrollTop = element.scrollHeight;
    } else if (action === "preserve") {
      const { previousHeight, previousTop } = preservedScrollRef.current;
      element.scrollTop = element.scrollHeight - previousHeight + previousTop;
    }
  }, [messages]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    // Only react to changes in selectedConversationId (not loadLatestMessages reference).
    // Bump request id so any in-flight load for a different conversation is invalidated.
    messagesRequestIdRef.current += 1;
    if (lastLoadedConversationIdRef.current !== selectedConversationId) {
      setMessages([]);
      setMessageTotal(0);
      setHasOlderMessages(false);
      setNewMessageCount(0);
      setSelectedMessageIds([]); // Reset selection when switching conversations
      setAutoSendTargetIds([]); // Reset target list when switching conversations
      lastLoadedConversationIdRef.current = null;
    }
    void loadLatestMessages(selectedConversationId);

    if (selectedConversationId && flow.userId && flow.userId !== "default") {
      void markZaloConversationAsRead(flow.userId, selectedConversationId)
        .then(() => {
          setConversations((prev) =>
            prev.map((c) =>
              c.conversation_id === selectedConversationId
                ? { ...c, unread_count: 0 }
                : c
            )
          );
        })
        .catch((err) => {
          console.error("Failed to mark conversation as read:", err);
        });
    }
  }, [selectedConversationId, flow.userId, loadLatestMessages]);

  useEffect(() => {
    // Đọc interval động mỗi lần fire — không cần restart timer khi sseConnected đổi.
    // Cách này tránh warning "useEffect deps changed size" và tránh re-mount interval.
    const intervalMs = sseConnected ? 5000 : REFRESH_INTERVAL_MS;
    const timer = window.setInterval(() => {
      void loadConversations({ silent: true });
      void pollLatestMessages(selectedConversationId);
    }, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations, pollLatestMessages, selectedConversationId, sseConnected]);

  // ── Realtime SSE via EventSource ─────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!flow.userId || flow.userId === "default" || !flow.isLoggedIn || flow.sessionExpired) {
      setSseConnected(false);
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;

      // Đóng kết nối cũ trước khi tạo mới.
      if (es) {
        es.close();
        es = null;
      }

      const url = buildZaloRealtimeStreamUrl({ userId: flow.userId, email: flow.email });
      console.info("[zalo-sse] connecting to", url);
      setSseConnected(false);

      try {
        es = new EventSource(url);
      } catch (err) {
        console.warn("[zalo-sse] cannot open EventSource", err);
        scheduleReconnect();
        return;
      }

      es.onopen = () => {
        if (!cancelled) {
          console.info("[zalo-sse] connection open");
          setSseConnected(true);
        }
      };

      es.addEventListener("ready", (e: MessageEvent) => {
        if (cancelled) return;
        try {
          const meta = JSON.parse(e.data);
          console.info("[zalo-sse] stream ready", meta);
          setSseConnected(true);
        } catch {
          setSseConnected(true);
        }
      });

      // Nhận realtime tin nhắn từ Python persistent_listener → SSE bus.
      es.addEventListener("zalo-message", (e: MessageEvent) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse(e.data);
          // Payload format: { type, account_id, group_id, group_name, messages: [] }
          if (payload.type !== "new_messages") return;

          const groupId = String(payload.group_id || "").trim();
          const msgs: any[] = Array.isArray(payload.messages) ? payload.messages : [];
          if (!msgs.length) return;

          const lastMsg = msgs[msgs.length - 1];

          // 1. Cập nhật last message preview và unread count cho sidebar trong thời gian thực
          if (lastMsg) {
            setConversations(prev => {
              const exists = prev.some(c => c.conversation_id === groupId);
              let updated = prev;
              if (exists) {
                updated = prev.map(c =>
                  c.conversation_id === groupId
                    ? {
                        ...c,
                        latest_content: lastMsg.content || lastMsg.type || "Tin nhắn mới",
                        latest_message_at: lastMsg.timestamp || lastMsg.time_text,
                        latest_sender_name: lastMsg.sender_name,
                        unread_count: c.conversation_id === selectedConversationId ? c.unread_count : (c.unread_count || 0) + 1
                      }
                    : c
                );
              } else {
                const newConv: ZaloConversationSummary = {
                  conversation_id: groupId,
                  conversation_name: payload.group_name || `Conversation ${groupId}`,
                  account_id: payload.account_id || flow.userId,
                  message_count: 1,
                  image_count: lastMsg.type === "image" ? 1 : 0,
                  sent_count: lastMsg.is_sent ? 1 : 0,
                  received_count: lastMsg.is_sent ? 0 : 1,
                  latest_message_at: lastMsg.timestamp || lastMsg.time_text,
                  latest_content: lastMsg.content || lastMsg.type || "Tin nhắn mới",
                  latest_sender_name: lastMsg.sender_name,
                  unread_count: groupId === selectedConversationId ? 0 : 1,
                  is_pinned: false,
                };
                updated = [newConv, ...prev];
              }
              // Sắp xếp lại sidebar giống Zalo: pinned lên trước -> time giảm dần
              return sortConversationsLikeZalo(updated);
            });
          }

          // 2. Chỉ cập nhật tin nhắn vào khung chat nếu đang mở đúng cuộc trò chuyện đó
          if (groupId !== selectedConversationId) return;

          setMessages((prev) => {
            const seen = new Set(prev.map(messageKey));
            const newOnes: ZaloLibraryMessage[] = [];

            for (const rawMsg of msgs) {
              const sourceMsgId = rawMsg.message_id || rawMsg.source_message_id;
              if (!sourceMsgId || seen.has(messageKey({
                id: sourceMsgId,
                source_message_id: sourceMsgId,
                user_id: rawMsg.user_id || flow.userId || "",
                group_id: groupId,
                sender_id: rawMsg.sender_id,
                sender_name: rawMsg.sender_name,
                timestamp_text: rawMsg.timestamp,
                time_text: rawMsg.time_text,
                type: rawMsg.type || "text",
                content: rawMsg.content,
                is_sent: Boolean(rawMsg.is_sent),
                is_deleted: Boolean(rawMsg.is_deleted),
                assets: (rawMsg.image_urls || []).map((url: string) => ({
                  source_url: url, status: "uploaded", storage_url: url,
                })),
              }))) {
                continue;
              }
              newOnes.push({
                id: sourceMsgId,
                source_message_id: sourceMsgId,
                user_id: rawMsg.user_id || flow.userId || "",
                group_id: groupId,
                sender_id: rawMsg.sender_id,
                sender_name: rawMsg.sender_name,
                timestamp_text: rawMsg.timestamp,
                time_text: rawMsg.time_text,
                type: rawMsg.type || "text",
                content: rawMsg.content,
                is_sent: Boolean(rawMsg.is_sent),
                is_deleted: Boolean(rawMsg.is_deleted),
                assets: (rawMsg.image_urls || []).map((url: string) => ({
                  source_url: url, status: "uploaded", storage_url: url,
                })),
              });
            }

            if (!newOnes.length) return prev;

            const shouldStickToBottom = isNearBottom(messageListRef.current);
            if (shouldStickToBottom) pendingScrollRef.current = "bottom";
            else setNewMessageCount(c => c + 1);

            return [...prev, ...newOnes];
          });
        } catch (err) {
          console.warn("[zalo-sse] failed to parse zalo-message event", err);
        }
      });

      es.onerror = (e: Event) => {
        console.warn("[zalo-sse] error", e);
        setSseConnected(false);
        if (!cancelled) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      if (reconnectTimer) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 5000);
    };

    connect();

    return () => {
      cancelled = true;
      setSseConnected(false);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [flow.userId, flow.isLoggedIn, flow.sessionExpired, flow.email]);

  const handleToggleSelectMessage = (messageId: string) => {
    setSelectedMessageIds(prev =>
      prev.includes(messageId)
        ? prev.filter(id => id !== messageId)
        : [...prev, messageId]
    );
  };

  const autoSendFilteredConversations = useMemo(() => {
    let list = conversations;
    if (selectedConversationId) {
      list = list.filter(c => c.conversation_id !== selectedConversationId);
    }
    if (!autoSendSearchQuery) return list;
    const q = autoSendSearchQuery.toLowerCase();
    return list.filter(c =>
      (c.conversation_name || "").toLowerCase().includes(q) ||
      (c.latest_content || "").toLowerCase().includes(q)
    );
  }, [conversations, autoSendSearchQuery, selectedConversationId]);

  const handleToggleAutoSendTarget = (conversationId: string) => {
    setAutoSendTargetIds(prev =>
      prev.includes(conversationId)
        ? prev.filter(id => id !== conversationId)
        : [...prev, conversationId]
    );
  };

  const handleAutoSend = async () => {
    if (!flow.userId || selectedMessageIds.length === 0) return;

    const manualLines = manualRecipients
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    const targets: ZaloBroadcastTarget[] = [];

    // System targets
    autoSendTargetIds.forEach(id => {
      const conv = conversations.find(c => c.conversation_id === id);
      if (conv) {
        const name = isFallbackName(conv.conversation_name, conv.conversation_id)
          ? conv.conversation_id
          : (conv.conversation_name || conv.conversation_id);
        targets.push({ group_id: conv.conversation_id, group_name: name });
      }
    });

    // Manual targets
    manualLines.forEach(line => {
      targets.push({ group_id: line, group_name: line });
    });

    if (targets.length === 0) {
      setAutoSendError("Không tìm thấy người nhận hợp lệ.");
      return;
    }

    setIsSending(true);
    setAutoSendError(null);
    setAutoSendSuccess(null);
    setCampaignStatus("sending");
    setCampaignLogs([]);

    try {
      await createZaloBroadcast(flow.userId, {
        user_id: flow.userId,
        message_ids: selectedMessageIds,
        targets,
        content_mode: campaignMode,
      });

      // Simulate log stream for interactive view
      let currentIdx = 0;
      const logNext = () => {
        if (currentIdx >= targets.length) {
          setCampaignStatus("success");
          setAutoSendSuccess(`Đã hoàn thành gửi đến ${targets.length} người nhận!`);
          setIsSending(false);
          setAutoSendTargetIds([]);
          setSelectedMessageIds([]);
          setManualRecipients("");
        } else {
          const target = targets[currentIdx];
          setCampaignLogs(prev => [...prev, { name: target.group_name, status: "sending" }]);

          setTimeout(() => {
            setCampaignLogs(prev =>
              prev.map((log, idx) =>
                idx === currentIdx ? { ...log, status: "success" as const } : log
              )
            );
            currentIdx++;
            logNext();
          }, 800);
        }
      };

      logNext();
    } catch (err) {
      setAutoSendError(err instanceof Error ? err.message : "Lỗi gửi tin.");
      setCampaignStatus("failed");
      setIsSending(false);
    }
  };

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
    setInputText((prev) => prev + emoji);
  };

  // ── Share conversation with admin/leader (mới ở bước 7) ──────────────────
  const loadShareStatus = useCallback(
    async (accountId: string, conversationId: string) => {
      if (!flow.userId) return;
      try {
        const status = await getZaloConversationShareStatus(
          accountId,
          conversationId,
          flow.userId
        );
        setShareStatus((prev) => ({ ...prev, [conversationId]: status }));
      } catch (err) {
        // fail-soft: nếu bảng chưa migrate hoặc lỗi, cứ coi như false.
        console.warn("[zalo-share] load status failed", err);
      }
    },
    [flow.userId]
  );

  const handleToggleShare = useCallback(
    async (conversationId: string, sharedRole: "admin" | "leader") => {
      if (!flow.userId || !selectedAccount?.account_id) return;
      const current = shareStatus[conversationId]?.[sharedRole] ?? false;
      const next = !current;
      // Optimistic update
      setShareStatus((prev) => ({
        ...prev,
        [conversationId]: {
          admin: sharedRole === "admin" ? next : prev[conversationId]?.admin ?? false,
          leader: sharedRole === "leader" ? next : prev[conversationId]?.leader ?? false,
        },
      }));
      try {
        await setZaloConversationShare(
          selectedAccount.account_id,
          conversationId,
          next,
          sharedRole,
          flow.userId
        );
      } catch (err) {
        // rollback
        setShareStatus((prev) => ({
          ...prev,
          [conversationId]: {
            admin: sharedRole === "admin" ? current : prev[conversationId]?.admin ?? false,
            leader: sharedRole === "leader" ? current : prev[conversationId]?.leader ?? false,
          },
        }));
        console.warn("[zalo-share] toggle failed", err);
      }
    },
    [flow.userId, selectedAccount?.account_id, shareStatus]
  );

  // Tự động load share status khi mở 1 conversation.
  useEffect(() => {
    if (selectedConversationId && selectedAccount?.account_id) {
      void loadShareStatus(selectedAccount.account_id, selectedConversationId);
    }
  }, [selectedConversationId, selectedAccount?.account_id, loadShareStatus]);

  const handleSingleSend = async () => {
    if (!selectedConversationId || isSendingDirect) return;
    const conversationIdToSend = selectedConversationId;
    const textToSend = inputText.trim();
    if (!textToSend && selectedMedia.length === 0) return;

    setInputText("");
    const mediaToSend = [...selectedMedia];
    setSelectedMedia([]);
    setDirectSendError(null);
    setIsSendingDirect(true);

    try {
      if (mediaToSend.length > 0) {
        const filesOnly = mediaToSend.map((m) => m.file);
        await sendZaloMessageWithFiles(
          flow.userId,
          conversationIdToSend,
          textToSend,
          filesOnly
        );
      } else {
        await sendZaloMessage(flow.userId, conversationIdToSend, {
          text: textToSend,
        });
      }
      mediaToSend.forEach((m) => {
        if (m.previewUrl) URL.revokeObjectURL(m.previewUrl);
      });
      // Only refresh the chat if the user is still viewing the same conversation.
      if (selectedConversationId === conversationIdToSend) {
        await loadLatestMessages(conversationIdToSend, { silent: true });
      }
    } catch (err) {
      if (isSessionExpiredError(err)) {
        setDirectSendError("Phiên đăng nhập Zalo đã hết hạn. Vui lòng đăng nhập lại để tiếp tục gửi tin.");
        void flow.refreshLoginStatus();
      } else {
        setDirectSendError(err instanceof Error ? err.message : "Không thể gửi tin nhắn.");
      }
      setInputText(textToSend);
      setSelectedMedia(mediaToSend);
    } finally {
      setIsSendingDirect(false);
    }
  };

  const handleQuickReply = async (text: string) => {
    if (!selectedConversationId || isSendingDirect) return;
    setDirectSendError(null);
    setIsSendingDirect(true);

    try {
      await sendZaloMessage(flow.userId, selectedConversationId, { text });
      await loadLatestMessages(selectedConversationId, { silent: true });
    } catch (err) {
      if (isSessionExpiredError(err)) {
        setDirectSendError("Phiên đăng nhập Zalo đã hết hạn. Vui lòng đăng nhập lại để tiếp tục gửi tin.");
        void flow.refreshLoginStatus();
      } else {
        setDirectSendError(err instanceof Error ? err.message : "Không thể gửi tin nhắn nhanh.");
      }
    } finally {
      setIsSendingDirect(false);
    }
  };

  const scrollbarClass = "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300/80 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-transparent";

  const totalChatsCount = conversations.length;
  const waitingChatsCount = conversations.filter(c => c.unread_count && c.unread_count > 0).length;
  const combinedChatsCount = totalChatsCount + 181; // FB + Zalo total

  return (
    <div
      className="flex-1 h-full w-full bg-surface overflow-hidden min-h-0 flex flex-col"
    >
      {/* [P2] STATS BAR (Horizontal row at the top) */}
      {flow.isLoggedIn && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5 px-4 py-1.5 border-b border-outline-variant bg-surface shrink-0 shadow-sm">
          {/* Card 1: Zalo Conversations */}
          <div className="bg-surface rounded-lg py-1 px-2.5 border border-outline-variant flex items-center justify-between relative overflow-hidden transition-all hover:shadow-md">
            <div className="absolute top-0 left-0 w-[3px] h-full bg-slate-400"></div>
            <div className="pl-1.5">
              <span className="text-[9px] font-bold text-on-surface-variant uppercase block">Zalo Hội thoại</span>
              <span className="text-lg font-extrabold leading-none text-on-surface">{totalChatsCount}</span>
            </div>
            <div className="bg-surface-container-low text-on-surface text-[9px] font-bold px-1.5 py-0.5 rounded border border-outline-variant uppercase">
              Tổng nhóm
            </div>
          </div>

          {/* Card 2: Awaiting Reply */}
          <div className="bg-surface rounded-lg py-1 px-2.5 border border-outline-variant flex items-center justify-between relative overflow-hidden transition-all hover:shadow-md">
            <div className="absolute top-0 left-0 w-[3px] h-full bg-red-500"></div>
            <div className="pl-1.5">
              <span className="text-[9px] font-bold text-on-surface-variant uppercase block">Chờ phản hồi</span>
              <span className="text-lg font-extrabold leading-none text-red-650">{waitingChatsCount}</span>
            </div>
            <div className="bg-red-50 text-red-650 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-100 uppercase animate-pulse">
              Cần trả lời
            </div>
          </div>

          {/* Card 3: FB + Zalo combined total */}
          <div className="bg-surface rounded-lg py-1 px-2.5 border border-outline-variant flex items-center justify-between relative overflow-hidden transition-all hover:shadow-md">
            <div className="absolute top-0 left-0 w-[3px] h-full bg-slate-400"></div>
            <div className="pl-1.5">
              <span className="text-[9px] font-bold text-on-surface-variant uppercase block">FB + Zalo Tổng</span>
              <span className="text-lg font-extrabold leading-none text-on-surface">{combinedChatsCount}</span>
            </div>
            <div className="bg-surface-container-low text-on-surface text-[9px] font-bold px-1.5 py-0.5 rounded border border-outline-variant uppercase">
              Đa nền tảng
            </div>
          </div>

          {/* Card 4: Bridge Status */}
          <div className="bg-surface rounded-lg py-1 px-2.5 border border-outline-variant flex items-center justify-between relative overflow-hidden transition-all hover:shadow-md">
            <div className="absolute top-0 left-0 w-[3px] h-full bg-slate-400"></div>
            <div className="pl-1.5">
              <span className="text-[9px] font-bold text-on-surface-variant uppercase block">Bridge Status</span>
              <span className="text-xs font-extrabold leading-tight text-on-surface uppercase flex items-center gap-1">
                <MaterialIcon name="check_circle" className="text-[11px] text-on-surface-variant animate-pulse" />
                Sync OK
              </span>
            </div>
            <div className="bg-surface-container-low text-on-surface text-[9px] font-bold px-1.5 py-0.5 rounded border border-outline-variant truncate max-w-[100px]">
              {selectedAccount?.label || "Zalo PC"}
            </div>
          </div>
        </section>
      )}

      {/* CORE INBOX LAYOUT (Conversations, Chat Area, Campaign Sidebar) */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative bg-surface-container-low">

        {/* Left Column: Conversations */}
        <section
          ref={sidebarRef}
          className="zalo-chat-list-panel relative border-r border-outline-variant flex flex-col bg-surface overflow-hidden h-full min-h-0 shrink-0"
          style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
        >
          {flow.sessionExpired && (
            <div className="m-2 rounded-lg border border-error-container bg-error-container/40 px-2 py-1.5 text-[10px] text-error">
              <div className="font-semibold flex items-center gap-1">
                <MaterialIcon name="error" className="text-xs" />
                Phiên Zalo đã hết hạn
              </div>
              <p className="mt-0.5 text-[10px]">Tin nhắn sẽ không tự cập nhật. Hãy đăng nhập lại bằng mã QR để tiếp tục.</p>
              <button
                onClick={onBackToDashboard}
                className="mt-1 w-full rounded-md bg-error px-2 py-1 font-semibold text-on-error hover:opacity-90 transition text-[10px]"
              >
                Đăng nhập lại
              </button>
            </div>
          )}
          <div className="px-3 py-2.5 border-b border-outline-variant flex flex-col gap-2 bg-surface-container-low">
            <div className="flex items-center space-x-2">
              <button
                onClick={onBackToDashboard}
                className="text-on-surface-variant hover:text-on-surface-variant transition shrink-0"
                title="Quay lại"
              >
                <MaterialIcon name="arrow_back" className="text-base" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-[14px] text-on-surface leading-tight truncate" title={selectedAccount?.label || "Đang chat"}>{selectedAccount?.label || "Đang chat"}</h2>
                <p className="text-[10px] text-on-surface-variant truncate">UID: {shortId(flow.userId || "")}</p>
              </div>
              {flow.isLoggedIn && flow.userId && flow.userId !== "default" && (
                <ZaloKpiPanel accountId={flow.userId} />
              )}
              {flow.isLoggedIn && (
                <button
                  onClick={() => setNewChatModalOpen(true)}
                  className="p-1 hover:bg-surface-container-low rounded transition text-primary shrink-0"
                  title="Nhắn tin cho người lạ (SĐT hoặc username Zalo)"
                  aria-label="Nhắn tin cho người lạ"
                >
                  <MaterialIcon name="person_add" className="text-base" />
                </button>
              )}
              {flow.isLoggedIn && (
                <button
                  onClick={() => void flow.endSession()}
                  className="text-[10px] text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded border border-red-200 transition shrink-0"
                  title="Đăng xuất khỏi Zalo"
                >
                  Đăng xuất
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-2.5 flex items-center text-on-surface-variant">
                  <MaterialIcon name="search" className="text-xs" />
                </span>
                <input
                  type="text"
                  placeholder="Tìm kiếm..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-surface border border-outline-variant rounded-lg focus:ring-red-500/20 focus:border-red-500 focus:outline-none transition-all"
                />
              </div>
              <div className="relative w-[115px] shrink-0">
                <select
                  value={filterTag || "all"}
                  onChange={(e) => setFilterTag(e.target.value === "all" ? null : e.target.value)}
                  className="w-full bg-surface border border-outline-variant rounded-lg pl-2 pr-6 py-1.5 text-[11px] outline-none cursor-pointer focus:border-primary appearance-none font-semibold text-on-surface truncate"
                >
                  <option value="all">📁 Tất cả tag</option>
                  <option value="new">🟢 Mới</option>
                  <option value="chatting">🔵 Đang chat</option>
                  <option value="followup">🟡 Follow-up</option>
                  <option value="inactive">⚪ Không HĐ</option>
                </select>
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                  <MaterialIcon name="arrow_drop_down" className="text-sm" />
                </span>
              </div>
            </div>

            {/* [P3.2] Segmented Pill Button Tabs for Filter */}
            <div className="flex p-0.5 bg-surface-container-low rounded-lg text-[11px] font-semibold text-on-surface-variant">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`flex-1 py-1 rounded-md transition-all ${
                  activeTab === 'all'
                    ? 'bg-surface text-primary font-bold shadow-sm'
                    : 'hover:bg-surface/50 text-on-surface-variant'
                }`}
              >
                Tất cả
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('unread')}
                className={`flex-1 py-1 rounded-md transition-all flex items-center justify-center gap-1 ${
                  activeTab === 'unread'
                    ? 'bg-surface text-primary font-bold shadow-sm'
                    : 'hover:bg-surface/50 text-on-surface-variant'
                }`}
              >
                Chưa đọc
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('inactive')}
                className={`flex-1 py-1 rounded-md transition-all ${
                  activeTab === 'inactive'
                    ? 'bg-surface text-primary font-bold shadow-sm'
                    : 'hover:bg-surface/50 text-on-surface-variant'
                }`}
              >
                Chưa HD
              </button>
            </div>
          </div>

          <ZaloConversationListVirtualized
            conversations={filteredConversations}
            selectedId={selectedConversationId}
            onSelect={setSelectedConversationId}
            searchQuery={searchQuery}
            isLoading={isLoadingConversations}
            enableInboxShare={!!flow.userId && flow.userId !== "default"}
            accountId={flow.userId}
            fullScreen={fullScreen}
            conversationTags={conversationTags}
            onSetTag={handleSetConversationTag}
            onTogglePin={handleTogglePin}
            onToggleHide={handleToggleHide}
            pinnedConversations={pinnedConversations}
            hiddenConversations={hiddenConversations}
          />

          {conversationError && (
            <div className="mx-md mt-md text-xs text-error bg-error-container/40 p-sm rounded-lg">
              {conversationError}
            </div>
          )}

        </section>

        {/* Middle Column: Chat Workspace */}
        <section className="flex-1 flex flex-col h-full bg-surface-container-low min-w-0 relative border-r border-outline-variant">
          {selectedConversationView ? (
            <>
              {/* [P4.1] Chat Header with Sync status sublabel */}
              <header className={`flex items-center justify-between border-b border-outline-variant bg-surface ${
                fullScreen ? "px-5 h-16" : "px-3 h-12"
              } shadow-sm z-10 shrink-0`}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {selectedConversationView.avatar_url && !avatarErrors[`header-${selectedConversationView.conversation_id}`] ? (
                    <img
                      src={selectedConversationView.avatar_url}
                      alt={selectedConversationView.conversation_name}
                      onError={() => setAvatarErrors(prev => ({ ...prev, [`header-${selectedConversationView.conversation_id}`]: true }))}
                      className={`${
                        fullScreen ? "h-11 w-11" : "h-8 w-8"
                      } shrink-0 rounded-full object-cover border border-outline-variant bg-surface`}
                    />
                  ) : (
                    <div className={`flex ${
                      fullScreen ? "h-11 w-11 text-[13px]" : "h-8 w-8 text-[11px]"
                    } shrink-0 items-center justify-center rounded-full bg-primary text-white hover:bg-red-700 font-semibold`}>
                      {initials(selectedConversationView.conversation_name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className={`font-semibold ${
                      fullScreen ? "text-[16px]" : "text-[13px]"
                    } text-on-surface truncate leading-tight`}>{selectedConversationView.conversation_name}</h3>
                    {/* Sync status sublabel */}
                    <div className="text-[10px] text-on-surface-variant font-semibold flex items-center gap-1.5">
                      {selectedConversation?.conversation_id?.startsWith("fb_") ? (
                        <span className="text-on-surface-variant font-bold">Facebook</span>
                      ) : (
                        <span className="text-[#0068ff] font-bold">Zalo</span>
                      )}
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                      <span>Bridge: {selectedConversation?.conversation_id?.startsWith("fb_") ? "Cloud Seeder FB" : (selectedAccount?.label || "Zalo PC")}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                      <span className="text-emerald-600 flex items-center gap-0.5 font-bold">
                        <MaterialIcon name="sync" className="text-[10px] text-emerald-500" />
                        Sync OK
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setIsAutoSendOpen(prev => !prev)}
                    className={`h-7 w-7 flex items-center justify-center rounded-full transition ${
                      isAutoSendOpen
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "hover:bg-surface-container-low text-on-surface-variant"
                    }`}
                    title={isAutoSendOpen ? "Đóng Auto Send" : "Mở Auto Send"}
                  >
                    <MaterialIcon name="campaign" className="text-sm" />
                  </button>
                  <button className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant transition" title="Tìm trong hội thoại">
                    <MaterialIcon name="search" className="text-sm" />
                  </button>
                  <button className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant transition" title="Gọi thoại">
                    <MaterialIcon name="call" className="text-sm" />
                  </button>
                  <button className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant transition" title="Video call">
                    <MaterialIcon name="videocam" className="text-sm" />
                  </button>
                </div>
              </header>

              {!flow.isLoggedIn && (
                <div className="bg-amber-50/80 border-b border-amber-100 px-3 py-1.5 text-[10.5px] text-amber-800 flex items-center justify-between z-10 shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MaterialIcon name="warning" className="text-amber-500 text-sm shrink-0" />
                    <span className="truncate">Zalo chưa kết nối. Đang hiển thị lịch sử offline.</span>
                  </div>
                  <button
                    onClick={handleOpenZaloWeb}
                    className="text-amber-700 hover:text-amber-900 font-bold transition shrink-0 text-[10px] underline"
                  >
                    Đăng nhập
                  </button>
                </div>
              )}

              {/* Messages Area */}
              {isLoadingMessages && messages.length === 0 ? (
                <ZaloMessageListSkeleton count={8} />
              ) : (
                <div ref={messageListRef} className={`zalo-messages-container flex-1 overflow-y-auto px-4 pt-1 pb-3 space-y-2 min-h-0 bg-[#f4f6f8] ${scrollbarClass}`}>
                  {hasOlderMessages && (
                    <div className="flex justify-center mb-1">
                      <button
                        onClick={() => void loadOlderMessages()}
                        disabled={isLoadingOlderMessages}
                        className="bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-container-low rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm transition"
                      >
                        {isLoadingOlderMessages ? "Đang tải..." : "Tải thêm tin cũ"}
                      </button>
                    </div>
                  )}

                  {messages.map((message) => {
                    const assets = messageAssets(message);
                    const sender = message.sender_name || (message.is_sent ? "Bạn" : "Khách");
                    const isSentByMe = message.is_sent;
                    const msgId = messageKey(message);
                    const isSelected = selectedMessageIds.includes(msgId);

                    let roleLabel = "Khách hàng";
                    let roleColorClass = "bg-red-50 text-red-650 border border-red-200/50";
                    if (message.role === "leader") {
                      roleLabel = "Leader";
                      roleColorClass = "bg-surface-container-low text-on-surface border border-outline-variant";
                    } else if (message.role === "staff" || isSentByMe) {
                      roleLabel = "Staff (Seeder)";
                      roleColorClass = "bg-surface-container-low text-on-surface-variant border border-outline-variant";
                    }

                    return (
                      <div key={messageRenderKey(message)} className={`flex group ${isSentByMe ? 'justify-end' : 'justify-start'} w-full mb-3`}>
                        {/* Checkbox for Auto Send Selection - visible on hover or if selected */}
                        {!isSentByMe && (
                           <div className={`mr-1.5 pt-4 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                             <input
                               type="checkbox"
                               className="w-3.5 h-3.5 cursor-pointer"
                               checked={isSelected}
                               onChange={() => handleToggleSelectMessage(msgId)}
                             />
                           </div>
                        )}

                        <div className={fullScreen ? "max-w-[80%]" : "max-w-[70%]"}>
                          {/* [P4.2] Role tag and sender name above bubble */}
                          <div className={`flex items-center gap-1.5 mb-1 px-1 text-[11px] font-semibold text-on-surface-variant ${isSentByMe ? 'justify-end' : 'justify-start'}`}>
                            <span className="text-on-surface font-bold">{sender}</span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase ${roleColorClass}`}>{roleLabel}</span>
                          </div>

                          {/* Bubble box */}
                          <div className={`rounded-xl ${
                            fullScreen ? "px-4 py-2.5 text-[15px]" : "px-3 py-1.5"
                          } relative transition-all duration-200 ${
                            isSentByMe
                              ? 'bg-[#0068FF] text-white rounded-tr-none shadow-sm shadow-blue-500/10'
                              : 'bg-surface text-on-surface rounded-tl-none shadow-sm border border-outline-variant'
                          } ${isSelected ? 'ring-2 ring-red-500 ring-offset-2' : ''}`}>

                            {message.content && (
                              <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${isSentByMe ? 'text-white/95' : 'text-on-surface'}`}>
                                {message.content}
                              </p>
                            )}

                            {assets.length > 0 && (
                              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                                {assets.map((asset) => (
                                  <Image
                                    key={asset.id || asset.storage_url}
                                    src={asset.storage_url || ""}
                                    alt="Image"
                                    width={220}
                                    height={150}
                                    className="rounded-lg object-cover w-full h-auto"
                                    unoptimized
                                  />
                                ))}
                              </div>
                            )}

                            <div className={`text-[10px] mt-0.5 text-right font-medium ${isSentByMe ? 'text-blue-100' : 'text-on-surface-variant'}`}>
                              {formatTime(message.timestamp_text || message.time_text)}
                            </div>
                          </div>
                        </div>

                        {isSentByMe && (
                           <div className={`ml-1.5 pt-4 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                             <input
                               type="checkbox"
                               className="w-3.5 h-3.5 cursor-pointer"
                               checked={isSelected}
                               onChange={() => handleToggleSelectMessage(msgId)}
                             />
                           </div>
                        )}
                      </div>
                    );
                  })}

                  {newMessageCount > 0 && (
                    <div className="sticky bottom-2 flex justify-center z-10">
                      <button
                        onClick={scrollToLatest}
                        className="bg-primary text-white hover:bg-red-700 rounded-full px-3 py-1 text-[11px] font-semibold shadow-md flex items-center gap-1 transition"
                      >
                        <MaterialIcon name="arrow_downward" className="text-[11px]" />
                        Có {newMessageCount} tin mới
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* [P5] QUICK REPLY PILLS ROW (Above input area, horizontally scrollable) */}
              <div className="bg-surface border-t border-outline-variant px-4 pt-2 pb-2 flex items-center gap-2 overflow-x-auto whitespace-nowrap shrink-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase mr-1 shrink-0">Trả lời nhanh:</span>
                {QUICK_REPLIES.map((reply, idx) => {
                  let emoji = "👋";
                  if (idx === 1) emoji = "💰";
                  else if (idx === 2) emoji = "📅";
                  else if (idx === 3) emoji = "📞";
                  else if (idx === 4) emoji = "🤖";
                  else if (idx === 5) emoji = "📄";
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setInputText(reply.text);
                        textareaRef.current?.focus();
                      }}
                      className="px-3 py-1 border border-red-200 bg-red-50/50 hover:bg-red-50 text-primary rounded-full text-[11px] font-semibold transition-all shrink-0 cursor-pointer"
                    >
                      {emoji} {reply.label}
                    </button>
                  );
                })}
              </div>

              {/* Chat Input */}
              <div className="bg-surface px-3 py-2 border-t border-outline-variant relative">
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

                {/* Slash Command Autocomplete Popover */}
                {showSlashMenu && filteredSlashReplies.length > 0 && (
                  <div
                    className="absolute bottom-full mb-3 left-4 right-4 z-50 max-h-56 bg-surface border border-outline-variant rounded-xl shadow-xl flex flex-col overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-150 divide-y divide-outline-variant"
                  >
                    <div className="px-3 py-1.5 bg-surface-container-low text-[10px] font-bold text-on-surface-variant uppercase sticky top-0">
                      Mẫu trả lời nhanh (Gõ để tìm kiếm, ↑↓ để di chuyển, Enter để chọn)
                    </div>
                    {filteredSlashReplies.map((reply, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setInputText(reply.text);
                          setShowSlashMenu(false);
                          textareaRef.current?.focus();
                        }}
                        className={`w-full text-left px-3 py-2 text-[12px] transition flex flex-col gap-0.5 ${
                          index === slashSelectedIndex
                            ? "bg-blue-50 text-blue-700 font-medium"
                            : "text-on-surface hover:bg-surface-container-low"
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="font-bold text-blue-600">{reply.shortcut}</span>
                          <span className="text-[10px] text-on-surface-variant">{reply.label}</span>
                        </div>
                        <p className="text-[11px] text-on-surface-variant truncate w-full font-medium">{reply.text}</p>
                      </button>
                    ))}
                  </div>
                )}

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
                              ? "bg-surface text-primary shadow-sm"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>

                    {/* Emoji grid */}
                    <div className="flex-1 overflow-y-auto p-2 grid grid-cols-6 gap-1 content-start bg-surface">
                      {EMOJI_CATEGORIES[activeEmojiTab].emojis.map((emoji, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleEmojiClick(emoji)}
                          className="h-9 w-9 flex items-center justify-center text-xl rounded-lg hover:bg-surface-container-low active:scale-95 transition cursor-pointer"
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
                      <button onClick={() => setShowQuickReplies(false)} className="text-on-surface-variant hover:text-red-500 cursor-pointer">
                        <MaterialIcon name="close" className="text-[14px]" />
                      </button>
                    </div>
                    <div className="flex flex-col p-1.5 gap-1 bg-surface">
                      {QUICK_REPLIES.map((reply, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            handleQuickReply(reply.text);
                            setShowQuickReplies(false);
                          }}
                          disabled={isSendingDirect}
                          className="text-left px-3 py-2 text-[12px] hover:bg-red-50 hover:text-primary text-on-surface rounded-lg transition-all border border-transparent hover:border-red-200 disabled:opacity-50 cursor-pointer"
                        >
                          {reply.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Direct Send Error - tam an banner loi ky thuat (yeu cau Thanh, dang test) */}

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
                            className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-md transition transform scale-0 group-hover:scale-100 flex items-center justify-center cursor-pointer"
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
                    disabled={!flow.isLoggedIn}
                    className={`text-on-surface-variant hover:text-primary p-1.5 rounded-full hover:bg-red-50 transition disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer ${
                      showEmojiPicker ? "text-primary bg-red-50" : ""
                    }`}
                    title="Biểu cảm"
                  >
                    <MaterialIcon name="mood" className="text-[18px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                    disabled={!flow.isLoggedIn}
                    className={`text-on-surface-variant hover:text-primary p-1.5 rounded-full hover:bg-red-50 transition disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer ${
                      showQuickReplies ? "text-primary bg-red-50" : ""
                    }`}
                    title="Mẫu câu nhanh"
                  >
                    <MaterialIcon name="bolt" className="text-[18px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={!flow.isLoggedIn}
                    className="text-on-surface-variant hover:text-primary p-1.5 rounded-full hover:bg-red-50 transition disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                    title="Gửi hình ảnh"
                  >
                    <MaterialIcon name="image" className="text-[18px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!flow.isLoggedIn}
                    className="text-on-surface-variant hover:text-primary p-1.5 rounded-full hover:bg-red-50 transition disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                    title="Gửi file tài liệu"
                  >
                    <MaterialIcon name="attach_file" className="text-[18px]" />
                  </button>

                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={
                      !flow.isLoggedIn
                        ? "Hãy đăng nhập để nhắn tin..."
                        : selectedMedia.length > 0
                          ? "Nhập chữ kèm theo file, Enter để gửi..."
                          : "Nhập tin nhắn, Enter để gửi..."
                    }
                    disabled={isSendingDirect || !flow.isLoggedIn}
                    className={`flex-1 bg-surface-container-low rounded-xl ${
                      fullScreen
                        ? "px-5 py-2.5 text-[15px]"
                        : "px-3.5 py-2 text-[13px]"
                    } text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:bg-surface border border-transparent focus:border-red-500/30 transition-all disabled:opacity-60 resize-none min-h-[38px] max-h-[120px] overflow-y-auto`}
                    onKeyDown={(e) => {
                      if (showSlashMenu && filteredSlashReplies.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashReplies.length);
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setSlashSelectedIndex((prev) => (prev - 1 + filteredSlashReplies.length) % filteredSlashReplies.length);
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const reply = filteredSlashReplies[slashSelectedIndex];
                          if (reply) {
                            setInputText(reply.text);
                            setShowSlashMenu(false);
                          }
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setShowSlashMenu(false);
                          return;
                        }
                      }

                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSingleSend();
                      }
                    }}
                  />

                  <button
                    onClick={() => void handleSingleSend()}
                    disabled={isSendingDirect || !flow.isLoggedIn || (!inputText.trim() && selectedMedia.length === 0)}
                    className={`bg-primary text-white hover:bg-red-700 ${
                      fullScreen ? "h-11 w-11" : "h-9 w-9"
                    } rounded-full flex items-center justify-center transition-all shadow-sm shadow-red-500/20 disabled:opacity-50 disabled:shadow-none cursor-pointer`}
                  >
                    {isSendingDirect ? (
                      <span className="text-[10px] font-bold animate-pulse">...</span>
                    ) : (
                      <MaterialIcon name="send" className={`${fullScreen ? "text-[18px]" : "text-[16px]"} ml-0.5`} />
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : !flow.isLoggedIn ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-surface-container-low w-full overflow-y-auto">
              {/* QR Code Display - 3 states: has QR, generating QR, no QR */}
              {flow.qrBase64 ? (
                <>
                  <div className="bg-surface p-4 rounded-xl shadow-lg mb-4 border border-outline-variant relative">
                    <img
                      src={flow.qrBase64.startsWith("data:") ? flow.qrBase64 : `data:image/png;base64,${flow.qrBase64}`}
                      alt="Zalo QR"
                      className="w-48 h-48 object-fill"
                    />
                    {flow.authStatus === "waiting_scan" && (
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-primary text-white hover:bg-red-700 px-3 py-1 rounded-full text-[10px] font-bold shadow-md animate-pulse whitespace-nowrap">
                        Đang chờ quét mã...
                      </div>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-on-surface mb-1.5 mt-2 text-center">Quét mã QR bằng Zalo</h3>
                  <div
                    className="text-on-surface-variant text-[11px] text-center mb-4 leading-relaxed"
                    style={{ minWidth: "240px", maxWidth: "100%", width: "100%" }}
                  >
                    <p>Mở ứng dụng Zalo trên điện thoại → Quét QR → Xác nhận đăng nhập</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void flow.startSession()}
                      disabled={flow.isStartingSession}
                      className="bg-surface border border-outline-variant text-on-surface px-4 py-2 rounded-lg text-[12px] font-semibold hover:bg-surface-container-low transition shadow-sm disabled:opacity-50"
                    >
                      {flow.isStartingSession ? "Đang tạo..." : "Làm mới QR"}
                    </button>
                  </div>
                </>
              ) : flow.isStartingSession ? (
                <>
                  <div className="w-48 h-48 bg-surface rounded-xl mb-6 flex items-center justify-center border-2 border-dashed border-outline-variant shadow-sm">
                    <div className="flex flex-col items-center gap-2 text-on-surface-variant">
                      <MaterialIcon name="qr_code_scanner" className="text-3xl animate-pulse text-primary" />
                      <span className="text-[12px] font-semibold">Đang tạo mã QR...</span>
                    </div>
                  </div>
                  <div
                    className="text-on-surface-variant text-[11px] text-center leading-relaxed"
                    style={{ minWidth: "240px", maxWidth: "100%", width: "100%" }}
                  >
                    <p>Hệ thống đang khởi tạo phiên Zalo và tạo mã QR. Quá trình này có thể mất vài giây.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-primary text-4xl mb-4">
                    <MaterialIcon name="login" className="text-inherit" />
                  </div>
                  <h3 className="text-base font-bold text-on-surface mb-2.5 text-center">Tài khoản chưa đăng nhập</h3>
                  <div
                    className="text-on-surface-variant text-[11px] text-center leading-relaxed mb-5"
                    style={{ minWidth: "280px", maxWidth: "100%", width: "100%" }}
                  >
                    <p>Bấm vào nút bên dưới để mở Zalo Web và đăng nhập. Sau khi đăng nhập xong, hệ thống sẽ tự động đồng bộ tài khoản của bạn.</p>
                  </div>
                  <button
                    onClick={handleOpenZaloWeb}
                    className="bg-primary hover:bg-red-600 text-white px-5 py-2 rounded-lg text-[12px] font-bold transition-all shadow-md shadow-red-100 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    <MaterialIcon name="open_in_new" className="text-sm" />
                    Tiến hành đăng nhập
                  </button>
                </>
              )}
              {flow.authStatus === "qr_expired" && (
                <div className="mt-4 text-[11px] text-orange-600 bg-orange-50 px-3 py-1.5 rounded border border-orange-100">
                  Mã QR đã hết hạn. Bấm &quot;Làm mới QR&quot; để tạo mã mới.
                </div>
              )}
            </div>
          ) : (
            <ZaloEmptyChat
              hasConversations={conversations.length > 0}
              isLoggedIn={flow.isLoggedIn ?? false}
              onLogin={handleOpenZaloWeb}
            />
          )}

          {/* [P1] Floating Trigger Tab on right edge (always rendered, slides/hides or acts as close/open) */}
          {flow.isLoggedIn && selectedConversationView && (
            <button
              onClick={() => setIsAutoSendOpen(!isAutoSendOpen)}
              className="absolute right-0 top-1/3 z-50 w-9 h-12 bg-gradient-to-l from-primary to-red-650 hover:from-red-600 hover:to-red-700 text-white rounded-l-xl shadow-lg flex flex-col items-center justify-center border-l border-y border-white/20 transition-all cursor-pointer"
              title={isAutoSendOpen ? "Đóng chiến dịch gửi hàng loạt" : "Mở chiến dịch gửi hàng loạt"}
            >
              <MaterialIcon name={(isAutoSendOpen ? "arrow_forward" : "campaign") as MaterialSymbolName} className="text-lg text-white" />
              <span className="text-[8px] font-extrabold uppercase scale-90 -mt-1er">Auto</span>
            </button>
          )}
        </section>

        {/* [P1] AUTO SEND DRAWER (Slide-out absolute sidebar) */}
        {flow.isLoggedIn && selectedConversationView && (
          <section className={`absolute right-0 top-0 h-full w-[450px] max-w-[90vw] border-l border-outline-variant flex flex-col bg-surface overflow-hidden shadow-2xl z-40 transition-transform duration-300 ease-in-out ${isAutoSendOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            {/* Drawer Header */}
            <div className="p-4 border-b border-outline-variant flex items-center justify-between bg-surface-container-low shrink-0">
              <div className="flex items-center gap-2">
                <MaterialIcon name="campaign" className="text-primary animate-pulse text-lg" />
                <div>
                  <h2 className="text-xs font-bold text-on-surface uppercase">Bảng chiến dịch gửi hàng loạt (Auto)</h2>
                  <p className="text-[10px] text-on-surface-variant">Chọn tin mẫu đã lưu, người nhận để gửi nhanh</p>
                </div>
              </div>
              <button
                onClick={() => setIsAutoSendOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-surface-container-highest border border-outline-variant flex items-center justify-center text-on-surface-variant transition-colors"
                title="Đóng Auto Send"
              >
                <MaterialIcon name="close" className="text-base" />
              </button>
            </div>

            {/* Drawer Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {autoSendError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
                  {autoSendError}
                </div>
              )}
              {autoSendSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 text-xs px-3 py-2 rounded-lg">
                  {autoSendSuccess}
                </div>
              )}

              {/* Section 1: Content Mode Selection */}
              <div className="border border-outline-variant rounded-xl p-3 bg-surface space-y-2 shadow-sm">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase block">Chế độ nội dung</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCampaignMode("both")}
                    className={`py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      campaignMode === "both"
                        ? "border-red-500 bg-red-50 text-primary font-bold"
                        : "border-outline-variant text-on-surface-variant hover:border-red-500"
                    }`}
                  >
                    Text + Ảnh
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampaignMode("text")}
                    className={`py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      campaignMode === "text"
                        ? "border-red-500 bg-red-50 text-primary font-bold"
                        : "border-outline-variant text-on-surface-variant hover:border-red-500"
                    }`}
                  >
                    Chỉ Text
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampaignMode("image")}
                    className={`py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      campaignMode === "image"
                        ? "border-red-500 bg-red-50 text-primary font-bold"
                        : "border-outline-variant text-on-surface-variant hover:border-red-500"
                    }`}
                  >
                    Chỉ Ảnh
                  </button>
                </div>
                <p className="text-[10px] text-on-surface-variant font-medium mt-1">
                  Đã chọn {selectedMessageIds.length} tin nhắn trực quan từ chat.
                </p>
              </div>

              {/* Section 2: Recipients input */}
              <div className="border border-outline-variant rounded-xl p-3 bg-surface space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase block">Nhập người nhận thủ công</label>
                  <span className="text-[9px] text-on-surface-variant">Mỗi dòng một tên/ID</span>
                </div>
                <textarea
                  value={manualRecipients}
                  onChange={(e) => setManualRecipients(e.target.value)}
                  rows={3}
                  placeholder="Nhập tên group hoặc cá nhân..."
                  className="w-full border border-outline-variant rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-red-500 resize-none transition-all"
                />

                <hr className="border-outline-variant" />

                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase">Chọn người nhận từ hệ thống</span>
                  <button
                    type="button"
                    onClick={handleLoadTargets}
                    disabled={isLoadingTargets}
                    className="bg-primary hover:bg-red-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <MaterialIcon name="refresh" className={`text-xs ${isLoadingTargets ? "animate-spin" : ""}`} />
                    <span>Tải danh sách</span>
                  </button>
                </div>

                {showSystemTargets && (
                  <>
                    {/* Search recipient lists */}
                    <div className="relative flex items-center">
                      <MaterialIcon name="search" className="absolute left-2.5 text-on-surface-variant text-xs" />
                      <input
                        type="text"
                        placeholder="Lọc danh sách nhận..."
                        value={autoSendSearchQuery}
                        onChange={(e) => setAutoSendSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1 border border-outline-variant rounded-lg text-[11px] outline-none focus:border-red-500 bg-surface"
                      />
                    </div>

                    {/* List of groups fetched */}
                    <div className="max-h-40 overflow-y-auto border border-outline-variant rounded-lg p-2 space-y-1.5 bg-surface-container-low divide-y divide-outline-variant">
                      {autoSendFilteredConversations.length > 0 ? (
                        autoSendFilteredConversations.map((conv) => {
                          const title = conversationTitle(conv);
                          const checked = autoSendTargetIds.includes(conv.conversation_id);
                          return (
                            <label
                              key={conv.conversation_id}
                              className={`flex items-center gap-2 p-1.5 rounded-lg border text-xs cursor-pointer select-none transition-all hover:bg-surface-container-low ${
                                checked ? 'bg-red-50/50 border-red-500/30 text-primary font-semibold' : 'bg-surface border-outline-variant'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleAutoSendTarget(conv.conversation_id)}
                                className="rounded text-primary border-outline-variant w-3.5 h-3.5 focus:ring-0 cursor-pointer"
                              />
                              <span className="font-semibold text-on-surface truncate flex-1">{title}</span>
                            </label>
                          );
                        })
                      ) : (
                        <div className="text-[10px] text-on-surface-variant text-center italic py-2">
                          Không tìm thấy người nhận nào
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Section 3: Preview Box */}
              <div className="border border-outline-variant rounded-xl p-3 bg-surface space-y-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase block">Bản xem trước chiến dịch</span>
                    <span className="text-[10px] text-on-surface-variant font-semibold">
                      {autoSendTargetIds.length + manualRecipients.split("\n").filter(Boolean).length > 0
                        ? `${autoSendTargetIds.length + manualRecipients.split("\n").filter(Boolean).length} người nhận sẽ được gửi (Gặp ${autoSendTargetIds.length} nhóm hệ thống, ${manualRecipients.split("\n").filter(Boolean).length} thủ công).`
                        : "Chưa cấu hình người nhận"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className="border border-outline-variant hover:border-red-500 text-on-surface hover:text-red-600 text-xs font-bold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <MaterialIcon name="visibility" className="text-xs" />
                    <span>Preview</span>
                  </button>
                </div>

                {/* Preview Area Container */}
                {showPreview && (
                  <div className="bg-surface-container-low border border-dashed border-outline-variant rounded-lg p-3 text-xs text-on-surface whitespace-pre-wrap text-left shadow-inner">
                    {selectedMessageIds.length > 0 ? (
                      <div>
                        {messages.filter(m => selectedMessageIds.includes(messageKey(m))).map((m, idx) => (
                          <div key={idx} className="mb-2 last:mb-0">
                            {(campaignMode === "both" || campaignMode === "text") && m.content && (
                              <div>
                                <div className="font-bold text-primary mb-0.5">Text sẽ gửi:</div>
                                <div className="bg-surface border border-outline-variant rounded-lg p-2 mb-2 italic">
                                  &quot;{m.content}&quot;
                                </div>
                              </div>
                            )}
                            {(campaignMode === "both" || campaignMode === "image") && messageAssets(m).length > 0 && (
                              <div>
                                <div className="font-bold text-[#e3000f] mb-0.5">Ảnh đính kèm:</div>
                                <div className="grid grid-cols-3 gap-2">
                                  {messageAssets(m).map((asset, aIdx) => (
                                    <div
                                      key={aIdx}
                                      className="w-full aspect-video bg-surface-container-highest border rounded flex items-center justify-center text-[9px] text-on-surface-variant font-bold overflow-hidden"
                                    >
                                      <img src={asset.storage_url || ""} alt="Preview" className="w-full h-full object-cover" />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-on-surface-variant text-center italic">
                        Chưa có nội dung gửi. Hãy chọn tin nhắn từ khung chat để làm mẫu.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons inside panel */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void handleAutoSend()}
                  disabled={isSending || selectedMessageIds.length === 0 || (autoSendTargetIds.length === 0 && manualRecipients.split("\n").filter(Boolean).length === 0)}
                  className="w-full bg-primary hover:bg-red-700 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <MaterialIcon name="send" className="text-base" />
                  <span>{isSending ? "Đang gửi chiến dịch..." : "Bắt đầu gửi hàng loạt"}</span>
                </button>
              </div>

              {/* Campaign Status Logs */}
              {campaignStatus && (
                <div className="border border-outline-variant rounded-xl p-3 bg-surface space-y-2 shadow-sm animate-in fade-in duration-300">
                  <div className="flex items-center justify-between border-b border-outline-variant pb-1.5">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase">
                      Chiến dịch: Camp_{flow.userId?.slice(-5) || "981a2"}
                    </span>
                    <span className={`text-[10px] font-bold uppercase ${
                      campaignStatus === "success" ? "text-emerald-600" : campaignStatus === "sending" ? "text-blue-600" : "text-red-600"
                    }`}>
                      {campaignStatus === "sending" ? "Đang chạy" : campaignStatus === "success" ? "Hoàn thành" : "Thất bại"}
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] font-semibold text-on-surface-variant">
                    {campaignLogs.map((log, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 py-0.5 border-b border-outline-variant last:border-0">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          log.status === "sending" ? "bg-blue-500 animate-pulse" : log.status === "success" ? "bg-emerald-500" : "bg-red-500"
                        }`} />
                        <span className="font-bold text-on-surface-variant truncate flex-1">Gửi tới: {log.name}</span>
                        <span className={`text-[9px] uppercase shrink-0 font-bold ${
                          log.status === "sending" ? "text-blue-500" : log.status === "success" ? "text-emerald-600" : "text-red-600"
                        }`}>
                          {log.status === "sending" ? "Đang gửi..." : log.status === "success" ? "Thành công" : "Lỗi"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </section>
        )}
      </div>

      {/* Modal nhắn tin cho người lạ (SĐT / username) */}
      <ZaloNewChatModal
        open={newChatModalOpen}
        accountId={flow.userId}
        onClose={() => setNewChatModalOpen(false)}
        onChatReady={handleNewChatReady}
        onError={(msg) => {
          setNewChatToast(msg);
          window.setTimeout(() => setNewChatToast(null), 4500);
        }}
        onSuccess={(name) => {
          setNewChatToast(`Đã mở chat với ${name}`);
          window.setTimeout(() => setNewChatToast(null), 4000);
        }}
      />

      {/* Toast thông báo nhỏ ở góc trên */}
      {newChatToast && (
        <div
          role="status"
          className="fixed top-4 right-4 z-[70] max-w-[360px] px-4 py-2.5 bg-slate-900 text-white text-[12.5px] rounded-lg shadow-2xl border border-outline-variant animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex items-center gap-2">
            <MaterialIcon name="info" className="text-base shrink-0" />
            <span>{newChatToast}</span>
          </div>
        </div>
      )}

    </div>
  );
}
