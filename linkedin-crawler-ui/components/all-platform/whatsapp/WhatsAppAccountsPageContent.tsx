"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  BarChart2,
  Contact,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircle,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
  Unplug,
  Video,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { whatsappService } from "@/services/whatsapp.service";
import type {
  WhatsAppAccount,
  WhatsAppCallLog,
  WhatsAppConversation,
  WhatsAppConversationFilter,
  WhatsAppConversationPatch,
  WhatsAppMediaSendType,
  WhatsAppMessage,
  WhatsAppPresenceState,
  WhatsAppQuickReply,
  WhatsAppSseAccountStatusPayload,
  WhatsAppSseCallEventPayload,
  WhatsAppSseConversationUpdatePayload,
  WhatsAppSseMessagePayload,
  WhatsAppSseMessageUpdatePayload,
  WhatsAppSsePresencePayload,
} from "@/types/whatsapp";
import { WhatsAppCallModal, type ActiveWhatsAppCallSession } from "./WhatsAppCallModal";
import {
  WhatsAppContactModal,
  WhatsAppForwardModal,
  WhatsAppLightboxModal,
  WhatsAppLocationModal,
  WhatsAppPollModal,
  WhatsAppQuickRepliesModal,
  WhatsAppSlashMenu,
} from "./WhatsAppComposerModals";
import { WhatsAppConnectModal, type WhatsAppModalTab } from "./WhatsAppConnectModal";
import { WhatsAppConversationList } from "./WhatsAppConversationList";
import { WhatsAppInfoDrawer } from "./WhatsAppInfoDrawer";
import { WhatsAppRichMessageCard } from "./WhatsAppRichMessageCard";
import {
  extractPhoneFromJid,
  formatAccountName,
  formatConversationTitle,
  formatDaySeparator,
  formatDurationSeconds,
  formatPhoneDisplay,
  getAccountStatusMeta,
  getMessagePreviewText,
  normalizeWaPhoneDigits,
  WhatsAppAvatar,
} from "./whatsapp-ui";

function normalizeSseMessage(raw: WhatsAppSseMessagePayload): WhatsAppMessage | null {
  const candidate = (raw.message ?? raw) as Partial<WhatsAppMessage>;
  if (!candidate || !candidate.message_id || !candidate.chat_jid) return null;
  return {
    account_id: candidate.account_id || raw.account_id,
    chat_jid: candidate.chat_jid,
    message_id: candidate.message_id,
    sender_jid: candidate.sender_jid ?? null,
    sender_phone: candidate.sender_phone ?? null,
    sender_name: candidate.sender_name ?? null,
    is_outgoing: Boolean(candidate.is_outgoing),
    msg_type: candidate.msg_type || "text",
    text: candidate.text ?? null,
    media_url: candidate.media_url ?? null,
    media_local_path: candidate.media_local_path ?? null,
    media_mime: candidate.media_mime ?? null,
    media_filename: candidate.media_filename ?? null,
    media_size: candidate.media_size ?? null,
    media_duration_s: candidate.media_duration_s ?? null,
    reply_to_message_id: candidate.reply_to_message_id ?? null,
    quoted_text: candidate.quoted_text ?? null,
    metadata: candidate.metadata ?? null,
    reactions: Array.isArray(candidate.reactions) ? candidate.reactions : [],
    raw_key: candidate.raw_key ?? null,
    ack_status: candidate.ack_status ?? "sent",
    is_edited: Boolean(candidate.is_edited),
    is_deleted: Boolean(candidate.is_deleted),
    sent_at: candidate.sent_at || new Date().toISOString(),
    created_at: candidate.created_at ?? null,
    id: candidate.id,
  };
}

function mergeIncomingMessage(prev: WhatsAppMessage[], incoming: WhatsAppMessage): WhatsAppMessage[] {
  const existingIdx = prev.findIndex((m) => m.message_id === incoming.message_id);
  if (existingIdx >= 0) {
    const next = [...prev];
    next[existingIdx] = { ...next[existingIdx], ...incoming, _optimistic: false, _optimistic_status: undefined };
    return next;
  }

  // Reconcile optimistic outgoing bubble with server/SSE echo (0ms flicker-free)
  if (incoming.is_outgoing) {
    const incTime = new Date(incoming.sent_at).getTime();
    const optIdx = prev.findIndex((m) => {
      if (!m._optimistic) return false;
      if (m.msg_type !== incoming.msg_type) return false;
      const optTime = new Date(m.sent_at).getTime();
      const closeInTime = Math.abs(incTime - optTime) < 25000;
      if (!closeInTime) return false;
      if (incoming.msg_type === "text") {
        return (m.text || "").trim() === (incoming.text || "").trim();
      }
      return true;
    });
    if (optIdx >= 0) {
      const next = [...prev];
      next[optIdx] = { ...incoming, _optimistic: false, _optimistic_status: undefined };
      return next;
    }
  }

  return [...prev, incoming].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
  );
}

export function WhatsAppAccountsPageContent() {
  // ── Accounts ───────────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{
    open: boolean;
    tab: WhatsAppModalTab;
    account: WhatsAppAccount | null;
  }>({ open: false, tab: "qr", account: null });

  // ── Conversations ──────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [syncingConvs, setSyncingConvs] = useState(false);
  const [selectedChatJid, setSelectedChatJid] = useState<string | null>(null);
  const [convFilter, setConvFilter] = useState<WhatsAppConversationFilter>("all");
  const [convSearch, setConvSearch] = useState("");
  const [presenceMap, setPresenceMap] = useState<Record<string, WhatsAppPresenceState>>({});

  // ── Messages & Timeline ────────────────────────────────────────────────────
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [inChatSearch, setInChatSearch] = useState("");
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // ── Composer State ─────────────────────────────────────────────────────────
  const [draftText, setDraftText] = useState("");
  const [replyingTo, setReplyingTo] = useState<WhatsAppMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<WhatsAppMessage | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File;
    mediaType: WhatsAppMediaSendType;
    previewUrl: string | null;
  } | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);

  // Voice Note Recorder
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // Sub-modals & Drawer
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; caption?: string | null } | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<WhatsAppMessage | null>(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showQuickRepliesModal, setShowQuickRepliesModal] = useState(false);

  // Quick Replies & Calls
  const [quickReplies, setQuickReplies] = useState<WhatsAppQuickReply[]>([]);
  const [callLogs, setCallLogs] = useState<WhatsAppCallLog[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveWhatsAppCallSession | null>(null);
  const [lastCallEvent, setLastCallEvent] = useState<WhatsAppSseCallEventPayload | null>(null);

  // Refs synced in effects (React 19 strict compliant)
  const activeAccountIdRef = useRef<string | null>(null);
  const selectedChatJidRef = useRef<string | null>(null);
  const conversationsRef = useRef<WhatsAppConversation[]>([]);
  const accountsRef = useRef<WhatsAppAccount[]>([]);
  const fetchFilterRef = useRef<WhatsAppConversationFilter>("all");
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  const serverConvFilter: WhatsAppConversationFilter =
    convFilter === "archived" ? "archived" : "all";

  useEffect(() => {
    activeAccountIdRef.current = activeAccountId;
  }, [activeAccountId]);

  useEffect(() => {
    selectedChatJidRef.current = selectedChatJid;
  }, [selectedChatJid]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    fetchFilterRef.current = serverConvFilter;
  }, [serverConvFilter]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId],
  );

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.chat_jid === selectedChatJid) ?? null,
    [conversations, selectedChatJid],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    });
  }, []);

  // ── Initial Load: Accounts & Quick Replies ─────────────────────────────────
  const reloadAccounts = useCallback(async (preferredAccountId?: string) => {
    const res = await whatsappService.listAccounts();
    if (res.success) {
      const list = res.data || [];
      setAccounts(list);
      setActiveAccountId((prev) => {
        if (preferredAccountId && list.some((a) => a.id === preferredAccountId)) {
          return preferredAccountId;
        }
        if (prev && list.some((a) => a.id === prev)) return prev;
        const connected = list.find((a) => a.status === "connected");
        return connected?.id || list[0]?.id || null;
      });
    }
    setLoadingAccounts(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [accRes, qrRes] = await Promise.all([
        whatsappService.listAccounts(),
        whatsappService.listQuickReplies(),
      ]);
      if (cancelled) return;
      if (accRes.success) {
        const list = accRes.data || [];
        setAccounts(list);
        const preferred = list.find((a) => a.status === "connected") || list[0] || null;
        if (preferred) setActiveAccountId(preferred.id);
      }
      if (qrRes.success) {
        setQuickReplies(qrRes.data || []);
      }
      setLoadingAccounts(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load Conversations & Call Logs when Active Account / Archive tab changes
  const fetchConversationsForAccount = useCallback(
    async (accId: string, filterMode?: WhatsAppConversationFilter) => {
      const effectiveFilter = filterMode ?? fetchFilterRef.current;
      setLoadingConvs(true);
      const res = await whatsappService.listConversations(accId, {
        filter: effectiveFilter,
        limit: 100,
      });
      if (activeAccountIdRef.current !== accId) return;
      if (res.success) {
        setConversations(res.data || []);
      }
      setLoadingConvs(false);
    },
    [],
  );

  const fetchCallsForAccount = useCallback(async (accId: string) => {
    setLoadingCalls(true);
    const res = await whatsappService.listCalls(accId, 50);
    if (activeAccountIdRef.current !== accId) return;
    if (res.success) {
      setCallLogs(res.data || []);
    }
    setLoadingCalls(false);
  }, []);

  useEffect(() => {
    if (!activeAccountId) return;
    let cancelled = false;
    (async () => {
      const res = await whatsappService.listConversations(activeAccountId, {
        filter: serverConvFilter,
        limit: 100,
      });
      if (cancelled) return;
      if (res.success) {
        setConversations(res.data || []);
      }
      setLoadingConvs(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, serverConvFilter]);

  useEffect(() => {
    if (!activeAccountId) return;
    let cancelled = false;
    (async () => {
      const callRes = await whatsappService.listCalls(activeAccountId, 50);
      if (cancelled) return;
      if (callRes.success) {
        setCallLogs(callRes.data || []);
      }
      setLoadingCalls(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccountId]);

  // ── Load Messages when Selected Conversation changes ───────────────────────
  useEffect(() => {
    if (!activeAccountId || !selectedChatJid) return;
    let cancelled = false;
    (async () => {
      const res = await whatsappService.listMessages(activeAccountId, selectedChatJid, { limit: 60 });
      if (cancelled) return;
      if (res.success) {
        const fetched = (res.data || []).sort(
          (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        );
        setMessages((prev) => {
          // Keep any still-pending optimistic bubbles for this same chat
          const stillOptimistic = prev.filter(
            (m) => m._optimistic && m.chat_jid === selectedChatJid,
          );
          let merged = [...fetched];
          for (const opt of stillOptimistic) {
            const matched = merged.some(
              (r) =>
                r.is_outgoing &&
                r.msg_type === opt.msg_type &&
                (r.text || "").trim() === (opt.text || "").trim(),
            );
            if (!matched) merged = [...merged, opt];
          }
          return merged;
        });
        setHasMoreMessages(fetched.length >= 60);
        scrollToBottom("auto");
      }
      setLoadingMessages(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, selectedChatJid, scrollToBottom]);

  // ── Realtime SSE Subscription (all 6 events + call_answer_sdp) ─────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(whatsappService.streamUrl(), { withCredentials: true });
    } catch {
      return;
    }

    const handleAccountStatus = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as WhatsAppSseAccountStatusPayload;
        if (!data?.account_id) return;
        setAccounts((prev) => {
          const exists = prev.some((a) => a.id === data.account_id);
          if (!exists && data.account) return [data.account, ...prev];
          return prev.map((a) => {
            if (a.id !== data.account_id) return a;
            const merged = { ...a, ...(data.account || {}) };
            return {
              ...merged,
              status: data.status ?? merged.status,
              qr_data_url:
                data.qr_data_url !== undefined ? data.qr_data_url : merged.qr_data_url,
              pairing_code:
                data.pairing_code !== undefined ? data.pairing_code : merged.pairing_code,
              phone_number: data.phone_number ?? merged.phone_number,
              display_name: data.display_name ?? merged.display_name,
              last_error: data.last_error !== undefined ? data.last_error : merged.last_error,
            };
          });
        });
      } catch {
        // ignore malformed event
      }
    };

    const handleMessageEvent = (ev: MessageEvent) => {
      try {
        const raw = JSON.parse(ev.data) as WhatsAppSseMessagePayload;
        const msg = normalizeSseMessage(raw);
        if (!msg) return;

        if (msg.account_id === activeAccountIdRef.current) {
          // Update sidebar conversation preview & unread count
          const isOpenChat = msg.chat_jid === selectedChatJidRef.current;
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.chat_jid === msg.chat_jid);
            const preview = getMessagePreviewText(msg);
            if (idx >= 0) {
              const target = prev[idx];
              const updated: WhatsAppConversation = {
                ...target,
                last_message_at: msg.sent_at,
                last_message_preview: preview,
                unread_count:
                  msg.is_outgoing || isOpenChat ? 0 : (target.unread_count || 0) + 1,
              };
              const next = [...prev];
              next[idx] = updated;
              return next;
            }
            const created: WhatsAppConversation = {
              account_id: msg.account_id,
              chat_jid: msg.chat_jid,
              chat_type: msg.chat_jid.endsWith("@g.us") ? "group" : "direct",
              title: msg.sender_name || extractPhoneFromJid(msg.chat_jid) || msg.chat_jid,
              phone_number: msg.sender_phone || extractPhoneFromJid(msg.chat_jid) || null,
              last_message_at: msg.sent_at,
              last_message_preview: preview,
              unread_count: msg.is_outgoing || isOpenChat ? 0 : 1,
            };
            return [created, ...prev];
          });

          if (isOpenChat) {
            setMessages((prev) => mergeIncomingMessage(prev, msg));
            scrollToBottom("smooth");
            if (!msg.is_outgoing) {
              void whatsappService.markRead(msg.account_id, msg.chat_jid);
            }
          }
        }
      } catch {
        // ignore malformed event
      }
    };

    const handleMessageUpdate = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as WhatsAppSseMessageUpdatePayload;
        if (!data?.message_id) return;
        if (data.account_id !== activeAccountIdRef.current) return;
        if (data.chat_jid && data.chat_jid !== selectedChatJidRef.current) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.message_id !== data.message_id) return m;
            let nextReactions = m.reactions || [];
            const incomingReactions = Array.isArray(data.reactions)
              ? data.reactions
              : Array.isArray(data.message?.reactions)
                ? data.message.reactions
                : null;
            if (incomingReactions !== null) {
              nextReactions = incomingReactions;
            } else if (data.reaction) {
              const senderKey = data.reaction.sender_jid || "peer";
              nextReactions = nextReactions.filter((r) => (r.sender_jid || "peer") !== senderKey);
              if (data.reaction.emoji) {
                nextReactions = [
                  ...nextReactions,
                  { sender_jid: senderKey, emoji: data.reaction.emoji },
                ];
              }
            }
            return {
              ...m,
              ack_status: data.ack_status ?? data.message?.ack_status ?? m.ack_status,
              is_deleted:
                data.is_deleted !== undefined
                  ? data.is_deleted
                  : data.message?.is_deleted !== undefined
                    ? data.message.is_deleted
                    : m.is_deleted,
              is_edited:
                data.is_edited !== undefined
                  ? data.is_edited
                  : data.message?.is_edited !== undefined
                    ? data.message.is_edited
                    : m.is_edited,
              text:
                data.text !== undefined
                  ? data.text
                  : data.message?.text !== undefined
                    ? data.message.text
                    : m.text,
              reactions: nextReactions,
            };
          }),
        );
      } catch {
        // ignore
      }
    };

    const handleConversationUpdate = (ev: MessageEvent) => {
      try {
        const raw = JSON.parse(ev.data) as WhatsAppSseConversationUpdatePayload;
        const accId = raw.conversation?.account_id || raw.account_id;
        if (accId !== activeAccountIdRef.current) return;
        if (raw.action === "sync" && !raw.conversation) {
          void fetchConversationsForAccount(accId);
          return;
        }
        const conv = (raw.conversation ?? raw) as Partial<WhatsAppConversation>;
        if (!conv?.chat_jid) return;
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.chat_jid === conv.chat_jid);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...conv };
            return next;
          }
          return [
            {
              account_id: accId,
              chat_jid: conv.chat_jid!,
              chat_type: conv.chat_type || "direct",
              title: conv.title || conv.chat_jid!,
              unread_count: conv.unread_count ?? 0,
              ...conv,
            },
            ...prev,
          ];
        });
      } catch {
        // ignore
      }
    };

    const handlePresence = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as WhatsAppSsePresencePayload;
        if (!data?.chat_jid || data.account_id !== activeAccountIdRef.current) return;
        const now = Date.now();
        setPresenceMap((prev) => ({
          ...prev,
          [data.chat_jid]: {
            chat_jid: data.chat_jid,
            participant_jid: data.participant_jid,
            state: data.state,
            updated_at: now,
          },
        }));
        if (data.state === "composing" || data.state === "recording") {
          window.setTimeout(() => {
            setPresenceMap((prev) => {
              const cur = prev[data.chat_jid];
              if (!cur || cur.updated_at !== now) return prev;
              return { ...prev, [data.chat_jid]: { ...cur, state: "paused" } };
            });
          }, 8000);
        }
      } catch {
        // ignore
      }
    };

    const handleCallEvent = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as WhatsAppSseCallEventPayload;
        if (!data?.call_id || !data?.account_id) return;
        setLastCallEvent(data);

        // Refresh call history list when active account matches
        const callRecord = data.call || data.call_log;
        if (data.account_id === activeAccountIdRef.current && callRecord) {
          setCallLogs((prev) => {
            const idx = prev.findIndex((c) => c.call_id === data.call_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...callRecord };
              return next;
            }
            return [callRecord, ...prev];
          });
        }

        const statusLower = String(data.status || "").toLowerCase();
        const resolvedDirection = data.direction || callRecord?.direction;
        const isIncomingOffer =
          !data.offline &&
          (data.sub_event === "incoming_call" ||
            ((resolvedDirection === "inbound" || !resolvedDirection) &&
              (statusLower === "offer" || statusLower === "ringing" || Boolean(data.sdp_offer))));

        if (isIncomingOffer) {
          const matchedConv = conversationsRef.current.find(
            (c) =>
              c.chat_jid === data.chat_jid ||
              c.chat_jid === data.caller_jid ||
              c.chat_jid === data.peer_jid,
          );
          const peerPhone =
            data.caller_phone ||
            data.peer_phone ||
            data.caller_pn ||
            callRecord?.peer_phone ||
            matchedConv?.phone_number ||
            extractPhoneFromJid(data.caller_jid || data.peer_jid || data.chat_jid);
          const peerName =
            data.caller_name ||
            data.peer_name ||
            callRecord?.peer_name ||
            (matchedConv ? formatConversationTitle(matchedConv) : "") ||
            formatPhoneDisplay(peerPhone) ||
            "Cuộc gọi WhatsApp đến";

          setActiveCall((prev) => {
            if (prev && prev.callId === data.call_id) {
              return {
                ...prev,
                sdpOffer: data.sdp_offer ?? prev.sdpOffer,
                sdpAnswer: data.sdp_answer ?? data.call_answer_sdp ?? prev.sdpAnswer,
                remoteStatus: data.status ?? prev.remoteStatus,
              };
            }
            return {
              direction: "inbound",
              accountId: data.account_id,
              callId: data.call_id,
              chatJid: data.chat_jid || data.caller_jid || data.peer_jid || "",
              callerJid: data.caller_jid || data.peer_jid || data.chat_jid || "",
              peerName,
              peerPhone,
              peerAvatar: matchedConv?.avatar_url ?? null,
              isVideo: Boolean(data.is_video || data.call_type === "video"),
              callMode: data.call_mode || (data.sdp_offer ? "cloud_webrtc" : "baileys_signal"),
              sdpOffer: data.sdp_offer ?? null,
              sdpAnswer: data.sdp_answer ?? data.call_answer_sdp ?? null,
              remoteStatus: data.status ?? "ringing",
            };
          });
        }
      } catch {
        // ignore
      }
    };

    es.addEventListener("account_status", handleAccountStatus);
    es.addEventListener("message", handleMessageEvent);
    es.addEventListener("message_update", handleMessageUpdate);
    es.addEventListener("conversation_update", handleConversationUpdate);
    es.addEventListener("presence", handlePresence);
    es.addEventListener("call_event", handleCallEvent);
    es.addEventListener("call_answer_sdp", handleCallEvent);

    return () => {
      es?.close();
    };
  }, [scrollToBottom, fetchConversationsForAccount]);

  // ── Account Actions ────────────────────────────────────────────────────────
  const handleSelectAccount = (accId: string) => {
    if (accId === activeAccountId) return;
    setActiveAccountId(accId);
    setSelectedChatJid(null);
    setConversations([]);
    setMessages([]);
    setLoadingConvs(true);
    setReplyingTo(null);
    setEditingMessage(null);
    setPendingAttachment(null);
    setDraftText("");
  };

  const handleSyncConversations = async () => {
    if (!activeAccountId) return;
    setSyncingConvs(true);
    const res = await whatsappService.syncConversations(activeAccountId);
    setSyncingConvs(false);
    if (!res.success) {
      toast.error(res.message || "Không thể đồng bộ hội thoại WhatsApp.");
      return;
    }
    toast.success("Đã gửi yêu cầu đồng bộ hội thoại WhatsApp.");
    await fetchConversationsForAccount(activeAccountId);
  };

  const handleReconnectAccount = async () => {
    if (!activeAccount) return;
    if (activeAccount.status === "logged_out" || activeAccount.status === "qr_ready") {
      setModalState({ open: true, tab: "qr", account: activeAccount });
      return;
    }
    const res = await whatsappService.reconnectAccount(activeAccount.id);
    if (!res.success) {
      toast.error(res.message || "Kết nối lại thất bại.");
      return;
    }
    toast.success("Đang kết nối lại tài khoản WhatsApp...");
    await reloadAccounts(activeAccount.id);
  };

  const handleDisconnectAccount = async (logoutDevice: boolean) => {
    if (!activeAccount) return;
    const msg = logoutDevice
      ? `Đăng xuất hoàn toàn "${formatAccountName(activeAccount)}" khỏi điện thoại và gỡ khỏi hệ thống?`
      : `Ngắt kết nối và gỡ tài khoản "${formatAccountName(activeAccount)}" khỏi công cụ?`;
    if (!window.confirm(msg)) return;
    const res = await whatsappService.disconnectAccount(activeAccount.id, logoutDevice);
    if (!res.success) {
      toast.error(res.message || "Ngắt kết nối thất bại.");
      return;
    }
    toast.success("Đã gỡ tài khoản WhatsApp.");
    setSelectedChatJid(null);
    setConversations([]);
    setMessages([]);
    await reloadAccounts();
  };

  // ── Conversation Actions ───────────────────────────────────────────────────
  const handleSelectConversation = (conv: WhatsAppConversation) => {
    if (conv.chat_jid === selectedChatJid) return;
    setSelectedChatJid(conv.chat_jid);
    setLoadingMessages(true);
    setMessages([]);
    setReplyingTo(null);
    setEditingMessage(null);
    setShowInChatSearch(false);
    setInChatSearch("");

    if ((conv.unread_count || 0) > 0 && activeAccountId) {
      setConversations((prev) =>
        prev.map((c) => (c.chat_jid === conv.chat_jid ? { ...c, unread_count: 0 } : c)),
      );
      void whatsappService.markRead(activeAccountId, conv.chat_jid);
    }
  };

  const handlePatchConversation = async (chatJid: string, patch: WhatsAppConversationPatch) => {
    if (!activeAccountId) return;
    setConversations((prev) =>
      prev.map((c) => (c.chat_jid === chatJid ? { ...c, ...patch } : c)),
    );
    const res = await whatsappService.updateConversation(activeAccountId, chatJid, patch);
    if (!res.success) {
      toast.error(res.message || "Cập nhật hội thoại thất bại.");
      await fetchConversationsForAccount(activeAccountId);
    }
  };

  const handleStartChatWithPhone = async (rawPhone: string) => {
    if (!activeAccountId) return;
    const digits = normalizeWaPhoneDigits(rawPhone);
    if (!digits) {
      toast.error("Số điện thoại không hợp lệ.");
      return;
    }
    const res = await whatsappService.startChat(activeAccountId, digits);
    if (!res.success || !res.data) {
      toast.error(res.message || "Không mở được hội thoại với số này.");
      return;
    }
    const conv = res.data;
    setConversations((prev) => {
      if (prev.some((c) => c.chat_jid === conv.chat_jid)) return prev;
      return [conv, ...prev];
    });
    handleSelectConversation(conv);
  };

  const handleLoadOlderMessages = async () => {
    if (!activeAccountId || !selectedChatJid || loadingOlder || messages.length === 0) return;
    const oldest = messages[0];
    setLoadingOlder(true);
    const res = await whatsappService.listMessages(activeAccountId, selectedChatJid, {
      limit: 60,
      beforeTs: oldest.sent_at,
    });
    setLoadingOlder(false);
    if (res.success && res.data) {
      const older = res.data;
      setHasMoreMessages(older.length >= 60);
      if (older.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.message_id));
          const fresh = older.filter((m) => !existingIds.has(m.message_id));
          return [...fresh, ...prev].sort(
            (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
          );
        });
      }
    }
  };

  // ── Optimistic 0ms Message Sending & Editing ───────────────────────────────
  const notifyTyping = (text: string) => {
    if (!activeAccountId || !selectedChatJid) return;
    const now = Date.now();
    if (text.trim() && now - lastTypingSentRef.current > 3500) {
      lastTypingSentRef.current = now;
      void whatsappService.sendTyping(activeAccountId, selectedChatJid, "composing");
    }
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      if (activeAccountIdRef.current && selectedChatJidRef.current) {
        void whatsappService.sendTyping(
          activeAccountIdRef.current,
          selectedChatJidRef.current,
          "paused",
        );
      }
    }, 3000);
  };

  const clearPendingAttachment = () => {
    if (pendingAttachment?.previewUrl) {
      URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
    setPendingAttachment(null);
  };

  const handleSend = async () => {
    if (!activeAccountId || !selectedChatJid) return;
    const trimmed = draftText.trim();

    // 1) Editing existing message
    if (editingMessage) {
      if (!trimmed) return;
      const target = editingMessage;
      setEditingMessage(null);
      setDraftText("");
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === target.message_id ? { ...m, text: trimmed, is_edited: true } : m,
        ),
      );
      const res = await whatsappService.editMessage({
        account_id: activeAccountId,
        chat_jid: selectedChatJid,
        message_id: target.message_id,
        text: trimmed,
      });
      if (!res.success) {
        toast.error(res.message || "Chỉnh sửa tin nhắn thất bại.");
      }
      return;
    }

    // 2) Sending Media Attachment (Image / Video / Document / Voice Note)
    if (pendingAttachment) {
      const att = pendingAttachment;
      const replyRef = replyingTo;
      const caption = trimmed || undefined;
      const optimisticId = `optimistic_${Date.now()}`;
      const nowIso = new Date().toISOString();

      const optimisticMsg: WhatsAppMessage = {
        account_id: activeAccountId,
        chat_jid: selectedChatJid,
        message_id: optimisticId,
        is_outgoing: true,
        msg_type: att.mediaType,
        text: caption || null,
        media_url: att.previewUrl,
        media_filename: att.file.name,
        media_size: att.file.size,
        media_mime: att.file.type,
        reply_to_message_id: replyRef?.message_id ?? null,
        quoted_text: replyRef ? getMessagePreviewText(replyRef) : null,
        ack_status: "sending",
        sent_at: nowIso,
        _optimistic: true,
        _optimistic_status: "sending",
      };

      setMessages((prev) => [...prev, optimisticMsg]);
      setDraftText("");
      setReplyingTo(null);
      setPendingAttachment(null);
      setSendingMedia(true);
      scrollToBottom("smooth");

      const res = await whatsappService.sendMedia({
        account_id: activeAccountId,
        chat_jid: selectedChatJid,
        file: att.file,
        media_type: att.mediaType,
        caption,
        reply_to_message_id: replyRef?.message_id ?? null,
      });
      setSendingMedia(false);

      if (res.success && res.data) {
        const real = res.data;
        setMessages((prev) => {
          const withoutOpt = prev.filter((m) => m.message_id !== optimisticId);
          return mergeIncomingMessage(withoutOpt, real);
        });
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.message_id === optimisticId
              ? { ...m, _optimistic_status: "failed", ack_status: "failed" }
              : m,
          ),
        );
        toast.error(res.message || "Gửi tệp phương tiện thất bại.");
      }
      return;
    }

    // 3) Sending Plain / Quoted Text (0ms Optimistic UI)
    if (!trimmed) return;
    const replyRef = replyingTo;
    const optimisticId = `optimistic_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const quotedText = replyRef ? getMessagePreviewText(replyRef) : null;

    const optimisticMsg: WhatsAppMessage = {
      account_id: activeAccountId,
      chat_jid: selectedChatJid,
      message_id: optimisticId,
      is_outgoing: true,
      msg_type: "text",
      text: trimmed,
      reply_to_message_id: replyRef?.message_id ?? null,
      quoted_text: quotedText,
      ack_status: "sending",
      sent_at: nowIso,
      _optimistic: true,
      _optimistic_status: "sending",
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setConversations((prev) =>
      prev.map((c) =>
        c.chat_jid === selectedChatJid
          ? { ...c, last_message_at: nowIso, last_message_preview: trimmed }
          : c,
      ),
    );
    setDraftText("");
    setReplyingTo(null);
    scrollToBottom("smooth");

    const res = await whatsappService.sendText({
      account_id: activeAccountId,
      chat_jid: selectedChatJid,
      text: trimmed,
      reply_to_message_id: replyRef?.message_id ?? null,
      quoted_text: quotedText,
    });

    if (res.success && res.data) {
      const real = res.data;
      setMessages((prev) => {
        const withoutOpt = prev.filter((m) => m.message_id !== optimisticId);
        return mergeIncomingMessage(withoutOpt, real);
      });
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === optimisticId
            ? { ...m, _optimistic_status: "failed", ack_status: "failed" }
            : m,
        ),
      );
      toast.error(res.message || "Gửi tin nhắn thất bại.");
    }
  };

  // ── Voice Note Recording (MediaRecorder) ───────────────────────────────────
  const stopVoiceRecording = (discard: boolean) => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const rec = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    setIsRecordingVoice(false);
    if (!rec) return;

    if (discard) {
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        rec.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      recordChunksRef.current = [];
      setRecordSeconds(0);
      return;
    }

    try {
      rec.stop();
    } catch {
      // ignore
    }
  };

  const handleStartVoiceRecording = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Trình duyệt không hỗ trợ ghi âm Microphone.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: preferredMime });
      recordChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: preferredMime });
        const ext = preferredMime.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: preferredMime });
        const previewUrl = URL.createObjectURL(blob);
        setPendingAttachment({ file, mediaType: "voice", previewUrl });
        setRecordSeconds(0);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingVoice(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
      if (activeAccountId && selectedChatJid) {
        void whatsappService.sendTyping(activeAccountId, selectedChatJid, "recording");
      }
    } catch {
      toast.error("Không thể truy cập Microphone để ghi âm.");
    }
  };

  // ── Message Actions (React, Delete, Forward, Location, Contact, Poll) ──────
  const handleReactMessage = async (msg: WhatsAppMessage, emoji: string) => {
    if (!activeAccountId) return;
    const mySenderJid = activeAccount?.jid || "me";
    const alreadyMine = (Array.isArray(msg.reactions) ? msg.reactions : []).some(
      (r) => (r.sender_jid === mySenderJid || r.sender_jid === "me") && r.emoji === emoji,
    );
    const wireEmoji = alreadyMine ? "" : emoji;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.message_id !== msg.message_id) return m;
        const cur = Array.isArray(m.reactions) ? m.reactions : [];
        const filtered = cur.filter(
          (r) => r.sender_jid !== mySenderJid && r.sender_jid !== "me",
        );
        return {
          ...m,
          reactions: wireEmoji ? [...filtered, { sender_jid: mySenderJid, emoji: wireEmoji }] : filtered,
        };
      }),
    );
    const res = await whatsappService.reactMessage({
      account_id: activeAccountId,
      chat_jid: msg.chat_jid,
      message_id: msg.message_id,
      emoji: wireEmoji,
    });
    if (!res.success) toast.error(res.message || "Không thể thả cảm xúc.");
  };

  const handleDeleteMessage = async (msg: WhatsAppMessage) => {
    if (!activeAccountId) return;
    const forEveryone = Boolean(msg.is_outgoing);
    const confirmMsg = forEveryone
      ? "Thu hồi tin nhắn này cho tất cả mọi người?"
      : "Xóa tin nhắn này khỏi lịch sử cục bộ?";
    if (!window.confirm(confirmMsg)) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.message_id === msg.message_id ? { ...m, is_deleted: true, msg_type: "revoked" } : m,
      ),
    );
    const res = await whatsappService.deleteMessage({
      account_id: activeAccountId,
      chat_jid: msg.chat_jid,
      message_id: msg.message_id,
      for_everyone: forEveryone,
    });
    if (!res.success) toast.error(res.message || "Không thể thu hồi tin nhắn.");
  };

  const handleConfirmForward = async (toChatJid: string) => {
    if (!activeAccountId || !forwardingMsg) return;
    const res = await whatsappService.forwardMessage({
      account_id: activeAccountId,
      from_chat_jid: forwardingMsg.chat_jid,
      message_id: forwardingMsg.message_id,
      to_chat_jid: toChatJid,
    });
    if (!res.success) {
      toast.error(res.message || "Chuyển tiếp tin nhắn thất bại.");
      return;
    }
    toast.success("Đã chuyển tiếp tin nhắn.");
    setForwardingMsg(null);
  };

  const handleOpenCall = (mode: "audio" | "video", targetConv?: WhatsAppConversation | null) => {
    const conv = targetConv || selectedConversation;
    if (!activeAccount || !conv) return;
    if (conv.chat_type === "group") {
      toast.info("Gọi nhóm WhatsApp chưa hỗ trợ trực tiếp trên Web.");
      return;
    }
    const phone =
      conv.phone_number ||
      extractPhoneFromJid(conv.chat_alt_jid) ||
      extractPhoneFromJid(conv.chat_jid);
    setActiveCall({
      direction: "outbound",
      accountId: activeAccount.id,
      callId: `local_${Date.now()}`,
      chatJid: conv.chat_jid,
      peerName: formatConversationTitle(conv),
      peerPhone: phone,
      peerAvatar: conv.avatar_url ?? null,
      isVideo: mode === "video",
      callMode: activeAccount.cloud_calling_enabled ? "cloud_webrtc" : "linked_device_handoff",
    });
  };

  // ── Slash Quick Replies matching ───────────────────────────────────────────
  const slashMatches = useMemo(() => {
    if (!draftText.startsWith("/")) return [];
    const query = draftText.slice(1).toLowerCase();
    return quickReplies.filter(
      (q) =>
        q.shortcut.toLowerCase().includes(query) ||
        q.title.toLowerCase().includes(query) ||
        q.content.toLowerCase().includes(query),
    );
  }, [draftText, quickReplies]);

  // ── Filtered timeline messages & day separators ────────────────────────────
  const displayedMessages = useMemo(() => {
    const q = inChatSearch.trim().toLowerCase();
    if (!showInChatSearch || !q) return messages;
    return messages.filter(
      (m) =>
        (m.text || "").toLowerCase().includes(q) ||
        (m.media_filename || "").toLowerCase().includes(q),
    );
  }, [messages, showInChatSearch, inChatSearch]);

  const activePresence = selectedChatJid ? presenceMap[selectedChatJid] : undefined;
  const isPeerTyping =
    activePresence?.state === "composing" || activePresence?.state === "recording";

  const handleJumpToMessage = (messageId: string) => {
    const el = document.getElementById(`wa-msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMsgId(messageId);
      window.setTimeout(() => setHighlightedMsgId(null), 1800);
    }
  };

  const handleFilePicked = (file: File | null, mediaType: WhatsAppMediaSendType) => {
    if (!file) return;
    clearPendingAttachment();
    const previewUrl =
      mediaType === "image" || mediaType === "video" || mediaType === "voice" || mediaType === "audio"
        ? URL.createObjectURL(file)
        : null;
    setPendingAttachment({ file, mediaType, previewUrl });
    setShowAttachMenu(false);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      {/* ── TOP ACCOUNT SWITCHER BAR ───────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/90 bg-white px-3.5 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <div className="flex shrink-0 items-center gap-2 pr-2 border-r border-slate-200">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-2xs">
              <MessageCircle className="h-4.5 w-4.5" />
            </div>
            <div className="hidden sm:block leading-tight">
              <div className="text-xs font-extrabold text-slate-900">WhatsApp Chat &amp; Call</div>
              <div className="text-[10px] text-slate-500">Multi-Device + Cloud WebRTC</div>
            </div>
          </div>

          {loadingAccounts ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
              Đang tải tài khoản...
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              {accounts.map((acc) => {
                const active = acc.id === activeAccountId;
                const st = getAccountStatusMeta(acc.status);
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => handleSelectAccount(acc.id)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition cursor-pointer",
                      active
                        ? "border-emerald-500 bg-emerald-50/90 text-emerald-950 shadow-2xs"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", st.dotClass)} />
                    <div className="leading-tight max-w-[140px]">
                      <div className="truncate text-xs font-bold">{formatAccountName(acc)}</div>
                      <div className="truncate text-[10px] text-slate-500">
                        {acc.phone_number ? formatPhoneDisplay(acc.phone_number) : st.label}
                      </div>
                    </div>
                    {acc.cloud_calling_enabled && (
                      <span
                        title="Đã bật Meta Cloud Calling WebRTC"
                        className="rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold text-sky-700"
                      >
                        VoIP
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Account Toolbar Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setModalState({ open: true, tab: "qr", account: null })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-2xs cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Kết nối WhatsApp</span>
          </button>

          {activeAccount && (
            <>
              <button
                type="button"
                onClick={() => setModalState({ open: true, tab: "settings", account: activeAccount })}
                title="Cài đặt cuộc gọi & Meta Cloud Calling API"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-emerald-700 transition cursor-pointer"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void handleSyncConversations()}
                disabled={syncingConvs}
                title="Đồng bộ hội thoại"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-emerald-700 disabled:opacity-50 transition cursor-pointer"
              >
                <RefreshCw className={cn("h-4 w-4", syncingConvs && "animate-spin text-emerald-600")} />
              </button>
              <button
                type="button"
                onClick={() => void handleReconnectAccount()}
                title="Kết nối lại phiên WhatsApp"
                className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-emerald-700 transition cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Kết nối lại</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnectAccount(false)}
                title="Ngắt kết nối / Gỡ tài khoản"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
              >
                <Unplug className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── MAIN WORKSPACE ─────────────────────────────────────────────────── */}
      {!loadingAccounts && accounts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center bg-[#f8fafc] p-6">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
              <MessageCircle className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Kết nối WhatsApp đầu tiên của bạn
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                Quản lý tập trung toàn bộ hội thoại cá nhân &amp; nhóm WhatsApp, gửi media/ghi âm/bình chọn, nhận cảnh báo cuộc gọi đến tức thì và hỗ trợ gọi WebRTC 2 chiều qua Meta Cloud Calling API.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setModalState({ open: true, tab: "qr", account: null })}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 shadow-xs transition cursor-pointer"
              >
                <QrCode className="h-4.5 w-4.5" />
                Quét mã QR
              </button>
              <button
                type="button"
                onClick={() => setModalState({ open: true, tab: "pairing", account: null })}
                className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
              >
                <Smartphone className="h-4.5 w-4.5" />
                Mã ghép nối 8 ký tự
              </button>
            </div>
          </div>
        </div>
      ) : activeAccount ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* COLUMN 1: CONVERSATIONS SIDEBAR */}
          <div
            className={cn(
              "h-full shrink-0 min-h-0",
              selectedConversation ? "hidden md:block md:w-[310px] lg:w-[330px]" : "w-full md:w-[310px] lg:w-[330px]",
            )}
          >
            <WhatsAppConversationList
              accountId={activeAccount.id}
              conversations={conversations}
              loading={loadingConvs}
              syncing={syncingConvs}
              selectedChatJid={selectedChatJid}
              filter={convFilter}
              searchQuery={convSearch}
              presenceMap={presenceMap}
              onSearchChange={setConvSearch}
              onFilterChange={(nextFilter) => {
                const prevServerFilter = convFilter === "archived" ? "archived" : "all";
                const nextServerFilter = nextFilter === "archived" ? "archived" : "all";
                if (prevServerFilter !== nextServerFilter) {
                  setLoadingConvs(true);
                }
                setConvFilter(nextFilter);
              }}
              onSelectConversation={handleSelectConversation}
              onSync={() => void handleSyncConversations()}
              onConversationStarted={(conv) => {
                setConversations((prev) => {
                  if (prev.some((c) => c.chat_jid === conv.chat_jid)) return prev;
                  return [conv, ...prev];
                });
                handleSelectConversation(conv);
              }}
              onPatchConversation={handlePatchConversation}
            />
          </div>

          {/* COLUMN 2: ACTIVE CHAT TIMELINE + COMPOSER */}
          <div
            className={cn(
              "flex flex-1 flex-col min-w-0 min-h-0 bg-[#efeae2]/55",
              !selectedConversation && "hidden md:flex",
            )}
          >
            {/* Status warning banner when account not connected */}
            {activeAccount.status !== "connected" && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      getAccountStatusMeta(activeAccount.status).dotClass,
                    )}
                  />
                  <span className="truncate font-medium">
                    Trạng thái phiên: <strong>{getAccountStatusMeta(activeAccount.status).label}</strong>
                    {activeAccount.last_error ? ` — ${activeAccount.last_error}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setModalState({
                      open: true,
                      tab: activeAccount.status === "pairing_ready" ? "pairing" : "qr",
                      account: activeAccount,
                    })
                  }
                  className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700 cursor-pointer"
                >
                  Liên kết ngay
                </button>
              </div>
            )}

            {selectedConversation ? (
              <>
                {/* Chat Header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/90 bg-white px-4 py-2.5 shadow-2xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedChatJid(null)}
                      className="md:hidden rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
                      aria-label="Quay lại danh sách"
                    >
                      <ArrowLeft className="h-4.5 w-4.5" />
                    </button>
                    <WhatsAppAvatar
                      src={selectedConversation.avatar_url}
                      name={formatConversationTitle(selectedConversation)}
                      isGroup={selectedConversation.chat_type === "group"}
                      size={40}
                      online={activePresence?.state === "available" || isPeerTyping}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h2 className="truncate text-sm font-bold text-slate-900">
                          {formatConversationTitle(selectedConversation)}
                        </h2>
                        {selectedConversation.custom_label && (
                          <span className="hidden sm:inline-flex rounded-full bg-teal-50 border border-teal-200 px-2 py-0.2 text-[10px] font-semibold text-teal-700">
                            {selectedConversation.custom_label}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">
                        {isPeerTyping ? (
                          <span className="font-semibold text-emerald-600 animate-pulse">
                            {activePresence?.state === "recording"
                              ? "đang ghi âm tin nhắn thoại..."
                              : "đang nhập tin nhắn..."}
                          </span>
                        ) : selectedConversation.chat_type === "group" ? (
                          `${selectedConversation.participant_count || 0} thành viên nhóm`
                        ) : (
                          formatPhoneDisplay(
                            selectedConversation.phone_number ||
                              extractPhoneFromJid(selectedConversation.chat_alt_jid) ||
                              extractPhoneFromJid(selectedConversation.chat_jid),
                          ) || selectedConversation.chat_jid
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Header Actions */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {selectedConversation.chat_type !== "group" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenCall("audio")}
                          title={
                            activeAccount.cloud_calling_enabled
                              ? "Gọi thoại WebRTC 2 chiều"
                              : "Gọi thoại WhatsApp"
                          }
                          className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          <span className="hidden lg:inline">Gọi thoại</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCall("video")}
                          title="Gọi video WhatsApp"
                          className="inline-flex h-8.5 w-8.5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-emerald-700 transition cursor-pointer"
                        >
                          <Video className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowInChatSearch((v) => !v);
                        setInChatSearch("");
                      }}
                      title="Tìm trong hội thoại"
                      className={cn(
                        "inline-flex h-8.5 w-8.5 items-center justify-center rounded-full border transition cursor-pointer",
                        showInChatSearch
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <Search className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowInfoDrawer((v) => !v)}
                      title="Thông tin & Lịch sử cuộc gọi"
                      className={cn(
                        "inline-flex h-8.5 w-8.5 items-center justify-center rounded-full border transition cursor-pointer",
                        showInfoDrawer
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {showInfoDrawer ? (
                        <PanelRightClose className="h-4 w-4" />
                      ) : (
                        <PanelRightOpen className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* In-chat Search Bar */}
                {showInChatSearch && (
                  <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
                    <Search className="h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={inChatSearch}
                      onChange={(e) => setInChatSearch(e.target.value)}
                      placeholder="Tìm nội dung tin nhắn hoặc tên tệp..."
                      autoFocus
                      className="flex-1 bg-transparent text-xs outline-none"
                    />
                    <span className="text-[11px] text-slate-400">
                      {displayedMessages.length} kết quả
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowInChatSearch(false);
                        setInChatSearch("");
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-200 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Message Timeline */}
                <div
                  ref={timelineRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                    setShowScrollBottom(distFromBottom > 260);
                  }}
                  className="relative flex-1 overflow-y-auto py-3 custom-scrollbar min-h-0"
                >
                  {hasMoreMessages && !showInChatSearch && (
                    <div className="mb-3 flex justify-center">
                      <button
                        type="button"
                        onClick={() => void handleLoadOlderMessages()}
                        disabled={loadingOlder}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                      >
                        {loadingOlder && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />}
                        Tải tin nhắn cũ hơn
                      </button>
                    </div>
                  )}

                  {loadingMessages ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                      <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                      <span className="text-xs">Đang tải lịch sử tin nhắn...</span>
                    </div>
                  ) : displayedMessages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-500">
                      <div className="rounded-2xl bg-white/90 border border-slate-200/80 px-5 py-4 shadow-2xs max-w-xs">
                        <p className="text-xs font-semibold text-slate-700">
                          {showInChatSearch
                            ? "Không tìm thấy tin nhắn khớp từ khóa."
                            : "Chưa có tin nhắn nào trong hội thoại này."}
                        </p>
                        {!showInChatSearch && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            Gửi tin nhắn, hình ảnh, ghi âm hoặc gõ <code>/</code> để dùng mẫu trả lời nhanh.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    displayedMessages.map((msg, idx) => {
                      const prev = idx > 0 ? displayedMessages[idx - 1] : null;
                      const prevDay = prev ? formatDaySeparator(prev.sent_at) : null;
                      const curDay = formatDaySeparator(msg.sent_at);
                      const showDatePill = curDay && curDay !== prevDay;
                      return (
                        <React.Fragment key={msg.message_id || `${idx}-${msg.sent_at}`}>
                          {showDatePill && (
                            <div className="my-3 flex justify-center">
                              <span className="rounded-full border border-slate-200/80 bg-white/95 px-3 py-0.5 text-[10.5px] font-semibold text-slate-500 shadow-2xs">
                                {curDay}
                              </span>
                            </div>
                          )}
                          <WhatsAppRichMessageCard
                            message={msg}
                            isGroup={selectedConversation.chat_type === "group"}
                            onReply={(m) => {
                              setEditingMessage(null);
                              setReplyingTo(m);
                            }}
                            onEdit={(m) => {
                              setReplyingTo(null);
                              setEditingMessage(m);
                              setDraftText(m.text || "");
                            }}
                            onDelete={(m) => void handleDeleteMessage(m)}
                            onForward={(m) => setForwardingMsg(m)}
                            onReact={(m, emoji) => void handleReactMessage(m, emoji)}
                            onOpenLightbox={(url, caption) => setLightbox({ url, caption })}
                            onStartChatWithPhone={(phone) => void handleStartChatWithPhone(phone)}
                            onCallBack={(mode) => handleOpenCall(mode)}
                            onJumpToReply={handleJumpToMessage}
                            isHighlighted={highlightedMsgId === msg.message_id}
                          />
                        </React.Fragment>
                      );
                    })
                  )}

                  {isPeerTyping && (
                    <div className="px-4 py-1.5">
                      <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-xs border border-slate-200 bg-white px-3.5 py-2 text-xs text-emerald-700 shadow-2xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" />
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:120ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:240ms]" />
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>

                {showScrollBottom && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => scrollToBottom("smooth")}
                      className="absolute bottom-3 right-5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-lg hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer"
                      title="Cuộn xuống tin mới nhất"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* ── COMPOSER AREA ────────────────────────────────────────── */}
                <div className="relative shrink-0 border-t border-slate-200/90 bg-white px-3.5 py-2.5">
                  {/* Slash Quick Replies Autocomplete */}
                  {slashMatches.length > 0 && (
                    <WhatsAppSlashMenu
                      items={slashMatches}
                      onSelect={(qr) => setDraftText(qr.content)}
                    />
                  )}

                  {/* Hidden file inputs */}
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      handleFilePicked(e.target.files?.[0] ?? null, "image");
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      handleFilePicked(e.target.files?.[0] ?? null, "video");
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={docInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      handleFilePicked(e.target.files?.[0] ?? null, "document");
                      e.target.value = "";
                    }}
                  />

                  {/* Reply / Edit Banner */}
                  {(replyingTo || editingMessage) && (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border-l-4 border-emerald-600 bg-emerald-50/70 px-3 py-1.5 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-emerald-800">
                          {editingMessage ? "Đang chỉnh sửa tin nhắn" : "Đang trả lời tin nhắn"}
                        </div>
                        <div className="truncate text-slate-600">
                          {getMessagePreviewText(editingMessage || replyingTo!)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingTo(null);
                          if (editingMessage) {
                            setEditingMessage(null);
                            setDraftText("");
                          }
                        }}
                        className="rounded-lg p-1 text-slate-500 hover:bg-white cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Pending Attachment Preview */}
                  {pendingAttachment && (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {pendingAttachment.mediaType === "image" && pendingAttachment.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={pendingAttachment.previewUrl}
                            alt="Preview"
                            className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                          />
                        ) : pendingAttachment.mediaType === "voice" && pendingAttachment.previewUrl ? (
                          <audio src={pendingAttachment.previewUrl} controls className="h-8 max-w-[240px]" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                            <FileText className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-800">
                            {pendingAttachment.file.name}
                          </div>
                          <div className="text-[10.5px] text-slate-500">
                            Loại: {pendingAttachment.mediaType}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={clearPendingAttachment}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {/* Voice Recording Mode OR Normal Input Row */}
                  {isRecordingVoice ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-600 animate-ping" />
                        <span className="text-xs font-bold text-rose-700">
                          Đang ghi âm tin nhắn thoại... {formatDurationSeconds(recordSeconds)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => stopVoiceRecording(true)}
                          className="rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={() => stopVoiceRecording(false)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                        >
                          <Square className="h-3 w-3 fill-current" />
                          Dừng &amp; đính kèm
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-end gap-2">
                      {/* Attachment Popover Trigger */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowAttachMenu((v) => !v)}
                          title="Đính kèm tệp, ảnh, vị trí, danh thiếp, bình chọn"
                          className={cn(
                            "flex h-9.5 w-9.5 items-center justify-center rounded-full border transition cursor-pointer",
                            showAttachMenu
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
                          )}
                        >
                          <Paperclip className="h-4.5 w-4.5" />
                        </button>

                        {showAttachMenu && (
                          <div className="absolute bottom-12 left-0 z-30 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 shadow-xl text-xs">
                            <button
                              type="button"
                              onClick={() => imageInputRef.current?.click()}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <ImageIcon className="h-4 w-4 text-emerald-600" />
                              <span>Gửi hình ảnh</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => videoInputRef.current?.click()}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <Video className="h-4 w-4 text-sky-600" />
                              <span>Gửi video</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => docInputRef.current?.click()}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <FileText className="h-4 w-4 text-indigo-600" />
                              <span>Gửi tài liệu / Tệp</span>
                            </button>
                            <div className="my-1 border-t border-slate-100" />
                            <button
                              type="button"
                              onClick={() => {
                                setShowAttachMenu(false);
                                setShowLocationModal(true);
                              }}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <MapPin className="h-4 w-4 text-rose-500" />
                              <span>Gửi vị trí (Location)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowAttachMenu(false);
                                setShowContactModal(true);
                              }}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <Contact className="h-4 w-4 text-teal-600" />
                              <span>Gửi danh thiếp (vCard)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowAttachMenu(false);
                                setShowPollModal(true);
                              }}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <BarChart2 className="h-4 w-4 text-amber-600" />
                              <span>Tạo bình chọn (Poll)</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Quick Replies Trigger */}
                      <button
                        type="button"
                        onClick={() => setShowQuickRepliesModal(true)}
                        title="Mẫu trả lời nhanh (gõ /)"
                        className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-amber-600 hover:bg-amber-50 transition cursor-pointer"
                      >
                        <Zap className="h-4 w-4" />
                      </button>

                      {/* Main Textarea */}
                      <div className="flex-1 min-w-0">
                        <textarea
                          rows={1}
                          value={draftText}
                          onChange={(e) => {
                            setDraftText(e.target.value);
                            notifyTyping(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              void handleSend();
                            }
                          }}
                          placeholder={
                            pendingAttachment
                              ? "Thêm chú thích cho tệp (tùy chọn)..."
                              : "Nhập tin nhắn... (Enter gửi, Shift+Enter xuống dòng, / trả lời nhanh)"
                          }
                          className="max-h-32 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:bg-white transition"
                        />
                      </div>

                      {/* Voice Note Mic OR Send Button */}
                      {!draftText.trim() && !pendingAttachment && !editingMessage ? (
                        <button
                          type="button"
                          onClick={() => void handleStartVoiceRecording()}
                          title="Ghi âm tin nhắn thoại (PTT)"
                          className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition cursor-pointer"
                        >
                          <Mic className="h-4.5 w-4.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={sendingMedia}
                          onClick={() => void handleSend()}
                          title="Gửi tin nhắn"
                          className="flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 transition cursor-pointer"
                        >
                          {sendingMedia ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="max-w-sm rounded-3xl border border-slate-200/80 bg-white/95 p-7 shadow-xs space-y-3">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                    <MessageCircle className="h-7 w-7" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">
                    Chọn một hội thoại WhatsApp
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-500">
                    Chọn hội thoại từ danh sách bên trái hoặc bấm <strong>SĐT mới</strong> để bắt đầu trò chuyện, gửi tài liệu và thực hiện cuộc gọi.
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-emerald-700">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Mã hóa đầu cuối &amp; đồng bộ thời gian thực</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* COLUMN 3: OPTIONAL INFO / GROUP / CALL HISTORY DRAWER */}
          {showInfoDrawer && (
            <div className="hidden lg:block w-[305px] shrink-0 h-full min-h-0">
              <WhatsAppInfoDrawer
                key={`${activeAccount.id}:${selectedConversation?.chat_jid || "none"}`}
                accountId={activeAccount.id}
                conversation={selectedConversation}
                messages={messages}
                callLogs={callLogs}
                loadingCalls={loadingCalls}
                onClose={() => setShowInfoDrawer(false)}
                onPatchConversation={handlePatchConversation}
                onInitiateCall={(mode, conv) => handleOpenCall(mode, conv)}
                onOpenLightbox={(url, caption) => setLightbox({ url, caption })}
                onRefreshCalls={() => void fetchCallsForAccount(activeAccount.id)}
              />
            </div>
          )}
        </div>
      ) : null}

      {/* ── MODALS & OVERLAYS ──────────────────────────────────────────────── */}
      {modalState.open && (
        <WhatsAppConnectModal
          key={`${modalState.tab}:${modalState.account?.id || "new"}`}
          initialTab={modalState.tab}
          account={modalState.account}
          liveAccounts={accounts}
          onClose={() => setModalState((prev) => ({ ...prev, open: false }))}
          onConnected={(accId) => {
            setModalState((prev) => ({ ...prev, open: false }));
            void reloadAccounts(accId);
          }}
          onSettingsSaved={(updated) => {
            setAccounts((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
          }}
        />
      )}

      {activeCall && (
        <WhatsAppCallModal
          key={`${activeCall.callId}:${activeCall.direction}`}
          session={activeCall}
          account={accounts.find((a) => a.id === activeCall.accountId) || activeAccount}
          lastCallEvent={lastCallEvent}
          onClose={() => setActiveCall(null)}
          onOpenCloudSettings={() => {
            const acc = accounts.find((a) => a.id === activeCall.accountId) || activeAccount;
            if (acc) setModalState({ open: true, tab: "settings", account: acc });
          }}
          onCallLogged={() => {
            if (activeAccountId) void fetchCallsForAccount(activeAccountId);
          }}
        />
      )}

      {lightbox && (
        <WhatsAppLightboxModal
          url={lightbox.url}
          caption={lightbox.caption}
          onClose={() => setLightbox(null)}
        />
      )}

      {forwardingMsg && (
        <WhatsAppForwardModal
          message={forwardingMsg}
          conversations={conversations}
          onClose={() => setForwardingMsg(null)}
          onConfirm={handleConfirmForward}
        />
      )}

      {showLocationModal && activeAccountId && selectedChatJid && (
        <WhatsAppLocationModal
          onClose={() => setShowLocationModal(false)}
          onSend={async (payload) => {
            const res = await whatsappService.sendLocation({
              account_id: activeAccountId,
              chat_jid: selectedChatJid,
              ...payload,
            });
            if (!res.success) {
              toast.error(res.message || "Gửi vị trí thất bại.");
              return;
            }
            if (res.data) setMessages((prev) => mergeIncomingMessage(prev, res.data!));
            setShowLocationModal(false);
            scrollToBottom("smooth");
          }}
        />
      )}

      {showContactModal && activeAccountId && selectedChatJid && (
        <WhatsAppContactModal
          onClose={() => setShowContactModal(false)}
          onSend={async (payload) => {
            const res = await whatsappService.sendContact({
              account_id: activeAccountId,
              chat_jid: selectedChatJid,
              ...payload,
            });
            if (!res.success) {
              toast.error(res.message || "Gửi danh thiếp thất bại.");
              return;
            }
            if (res.data) setMessages((prev) => mergeIncomingMessage(prev, res.data!));
            setShowContactModal(false);
            scrollToBottom("smooth");
          }}
        />
      )}

      {showPollModal && activeAccountId && selectedChatJid && (
        <WhatsAppPollModal
          onClose={() => setShowPollModal(false)}
          onSend={async (payload) => {
            const res = await whatsappService.sendPoll({
              account_id: activeAccountId,
              chat_jid: selectedChatJid,
              ...payload,
            });
            if (!res.success) {
              toast.error(res.message || "Tạo bình chọn thất bại.");
              return;
            }
            if (res.data) setMessages((prev) => mergeIncomingMessage(prev, res.data!));
            setShowPollModal(false);
            scrollToBottom("smooth");
          }}
        />
      )}

      {showQuickRepliesModal && (
        <WhatsAppQuickRepliesModal
          quickReplies={quickReplies}
          onClose={() => setShowQuickRepliesModal(false)}
          onCreate={async (payload) => {
            const res = await whatsappService.createQuickReply(payload);
            if (!res.success) {
              toast.error(res.message || "Không thể thêm mẫu câu.");
              return;
            }
            if (res.data) setQuickReplies((prev) => [res.data!, ...prev]);
            toast.success("Đã thêm mẫu trả lời nhanh.");
          }}
          onDelete={async (id) => {
            const res = await whatsappService.deleteQuickReply(id);
            if (!res.success) {
              toast.error(res.message || "Không thể xóa mẫu câu.");
              return;
            }
            setQuickReplies((prev) => prev.filter((q) => q.id !== id));
          }}
          onPick={(content) => setDraftText((prev) => (prev ? `${prev}\n${content}` : content))}
        />
      )}
    </div>
  );
}
