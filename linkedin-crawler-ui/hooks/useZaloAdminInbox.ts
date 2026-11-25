"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  getZaloAccounts,
  getZaloConversations,
  getZaloConversationMessages,
  sendZaloMessage,
  sendZaloMessageWithFiles,
  sendZaloMessageWithMentions,
  buildZaloRealtimeStreamUrl,
  markZaloConversationAsRead,
  syncZaloRecentConversations,
  syncZaloConversationMessages,
  recallZaloMessage,
  getZaloFriendStatus,
  sendZaloFriendRequest,
  acceptZaloFriendRequest,
  getZaloGroupMembers,
  sendZaloSticker,
  sendZaloVoiceMessage,
  reactToZaloMessage,
  restartZaloAccountListener,
  type BuildZaloRealtimeStreamOptions,
  type ZaloReplyToPayload,
} from "@/services/zaloCrawlerService";
import { allPlatformKpiService, zaloInboxShareService } from "@/services/all-platform.service";
import { formatConversationSidebarPreview } from "@/components/all-platform/zalo/centralized-shared/zaloUi";
import type {
  ZaloAccountInfo,
  ZaloConversationSummary,
  ZaloLibraryMessage,
  ZaloMention,
  ZaloFriendStatusResponse,
  ZaloGroupMembersResponse,
} from "@/types/zalo-api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id?: string;
  email?: string;
  name?: string;
}

export interface TeamRow {
  id?: string;
  name_team?: string;
  id_leader?: string;
  leader_name?: string;
  leader_email?: string;
  members?: UserRow[];
}

export interface ZaloMemberAccount {
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  accounts: ZaloAccountInfo[];
}

export type ZaloAccountOnlineStatus = "online" | "connecting" | "expired" | "offline";

export type ZaloInboxFilter = "all" | "unread" | "customer" | "need_reply" | "need_verify";
export type ZaloInboxViewMode = "inbox" | "archive";

export interface ZaloAdminConvFilter {
  tab: "all" | "unread" | "shared";
  query: string;
}

export interface ZaloConv {
  conv_id: string;
  name: string;
  preview: string;
  latest_sender_name?: string | null;
  unread: boolean;
  time: string;
  is_customer: boolean;
  pushed_to_zalo: boolean;
  deleted: boolean;
  archived?: boolean;
  archived_at?: string;
  avatar_url?: string | null;
  zalo_kpi_status?: string | null;
  zalo_kpi_source?: string | null;
  zalo_kpi_confirmed?: boolean | null;
  zalo_kpi_is_lead?: boolean | null;
  zalo_kpi_post_url?: string | null;
  zalo_kpi_phone?: string | null;
}

export interface ZaloArchiveConv {
  conv_id: string;
  name: string;
  preview?: string;
  time?: string;
  archived_at?: string;
  last_saved_at?: string;
  note?: string;
  is_customer?: boolean;
  pushed_to_zalo?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNTS_POLL_MS = 20_000;
const CONVERSATIONS_POLL_MS = 5_000;
const CONVERSATIONS_SSE_POLL_MS = 20_000;
const MESSAGES_POLL_MS = 7_000;
const MESSAGES_SSE_POLL_MS = 22_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useZaloAdminInbox() {
  const { user } = useAppAuth();
  const role = user?.role ?? "member";
  const leaderEmail = user?.email ?? "";

  // ── Teams & Members ─────────────────────────────────────────────────────────
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({});
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});
  const [loadingTeams, setLoadingTeams] = useState(false);

  // ── Zalo Accounts (grouped by owner) ────────────────────────────────────────
  const [memberAccounts, setMemberAccounts] = useState<ZaloMemberAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // ── Selected state ───────────────────────────────────────────────────────────
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  // ── Conversations ────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<ZaloConversationSummary[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);

  // ── Modern View Mode & Filters (FB Inbox Style) ─────────────────────────────
  const [viewMode, setViewMode] = useState<ZaloInboxViewMode>("inbox");
  const [filter, setFilter] = useState<ZaloInboxFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Share & KPI metadata from zaloInboxShareService ──────────────────────────
  const [verifiedConvIds, setVerifiedConvIds] = useState<Set<string>>(new Set());
  const [isSyncingMessages, setIsSyncingMessages] = useState<Record<string, boolean>>({});
  const [suggestedConvIds, setSuggestedConvIds] = useState<Set<string>>(new Set());
  const [customerNotes, setCustomerNotes] = useState<Record<string, string>>({});
  const [isCustomerSet, setIsCustomerSet] = useState<Set<string>>(new Set());
  const [shareIdsMap, setShareIdsMap] = useState<Record<string, number>>({}); // conv_id -> share row_id

  // ── Local hidden list for Archiving ──────────────────────────────────────────
  const [hiddenConvIds, setHiddenConvIds] = useState<Set<string>>(new Set());

  // ── Messages ────────────────────────────────────────────────────────────────
  const [selectedConvId, setSelectedConvId] = useState<string>("");
  const [messages, setMessages] = useState<ZaloLibraryMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messageTotal, setMessageTotal] = useState(0);

  // ── Send Reply ──────────────────────────────────────────────────────────────
  const [reply, setReply] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Online status ───────────────────────────────────────────────────────────
  const [onlineAccounts, setOnlineAccounts] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("zalo_online_accounts");
        if (saved) return new Set(JSON.parse(saved));
      } catch { /* no-op */ }
    }
    return new Set();
  });
  const [expiredAccounts, setExpiredAccounts] = useState<Set<string>>(new Set());
  const inFlightFetchRef = useRef<string | null>(null);

  // ── KPI stats & weekly progress ─────────────────────────────────────────────
  const [kpiByOwner, setKpiByOwner] = useState<Record<string, number>>({});
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [isBulkVerifying, setIsBulkVerifying] = useState(false);
  const [isBulkSuggesting, setIsBulkSuggesting] = useState(false);

  // ── Scanning ────────────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);

  // ── Zalo tập trung: recall / mentions / friend-status / sticker / group-scan ──
  const [pendingMentions, setPendingMentions] = useState<ZaloMention[]>([]);
  const [replyingTo, setReplyingTo] = useState<ZaloLibraryMessage | null>(null);
  const [friendStatus, setFriendStatus] = useState<ZaloFriendStatusResponse | null>(null);
  const [loadingFriendStatus, setLoadingFriendStatus] = useState(false);
  const [friendActionLoading, setFriendActionLoading] = useState(false);
  const [groupMembers, setGroupMembers] = useState<ZaloGroupMembersResponse | null>(null);
  const [loadingGroupMembers, setLoadingGroupMembers] = useState(false);

  // ── Error & Toast ───────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [savingNoteConv, setSavingNoteConv] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const convPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accountPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedAccountsRef = useRef(false);
  const convSignatureRef = useRef("");
  const messageLoadSeqRef = useRef(0);
  const messageSignatureRef = useRef("");
  const selectedAccountIdRef = useRef(selectedAccountId);
  const selectedConvIdRef = useRef(selectedConvId);
  // Bộ đệm client-side in-memory (khóa theo `${accountId}:${convId}`) để chuyển đổi hội thoại 0ms tức thì
  const convMessagesCacheRef = useRef<Map<string, ZaloLibraryMessage[]>>(new Map());

  useEffect(() => { selectedAccountIdRef.current = selectedAccountId; }, [selectedAccountId]);
  useEffect(() => { selectedConvIdRef.current = selectedConvId; }, [selectedConvId]);

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Load hidden list from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("zalo_hidden_convs");
      if (saved) {
        try {
          setHiddenConvIds(new Set(JSON.parse(saved)));
        } catch { /* no-op */ }
      }
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Load share status from DB
  // ─────────────────────────────────────────────────────────────────────────────
  const fetchShareStatus = useCallback(async () => {
    const ownerEmail = ownerEmails[selectedOwnerId] || "";
    if (!ownerEmail && !user?.email) return;
    try {
      let items: any[] = [];
      if (role === "admin" || role === "leader") {
        const res = await zaloInboxShareService.leaderView(user?.email || "", ownerEmail || undefined);
        items = res.success ? (res.data?.items || (res as any).items || []) : [];
      } else {
        const res = await zaloInboxShareService.listMine(user?.email || "", null);
        items = res.success ? (res.data?.items || (res as any).items || []) : [];
      }

      const verified = new Set<string>();
      const suggested = new Set<string>();
      const notes: Record<string, string> = {};
      const customers = new Set<string>();
      const idsMap: Record<string, number> = {};

      for (const item of items) {
        const convId = item.conversation_id;
        if (!convId) continue;
        idsMap[convId] = item.id;
        if (item.verified_at) {
          verified.add(convId);
        } else if (item.is_active) {
          suggested.add(convId);
        }
        if (item.note) {
          notes[convId] = item.note;
        }
        if (item.is_lead) {
          customers.add(convId);
        }
      }

      setVerifiedConvIds(verified);
      setSuggestedConvIds(suggested);
      setCustomerNotes(notes);
      setIsCustomerSet(customers);
      setShareIdsMap(idsMap);
    } catch (e) {
      console.warn("Failed to fetch share status:", e);
    }
  }, [user?.email, ownerEmails, selectedOwnerId, role]);

  useEffect(() => {
    if (selectedAccountId) {
      void fetchShareStatus();
    }
  }, [selectedAccountId, fetchShareStatus]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 1 — Load teams
  // ─────────────────────────────────────────────────────────────────────────────
  const loadTeams = useCallback(async () => {
    if (!leaderEmail) return;
    setLoadingTeams(true);
    try {
      const res = await allPlatformKpiService.getAll(leaderEmail);
      if (res.success) {
        let members = res.data?.members ?? [];

        // Add current leader if not present
        if (user && user.email && !members.some((m) => m.email === user.email)) {
          members.unshift({
            email: user.email,
            name: user.name || "Leader",
            member_id: user.id || user.email,
            id_team: "__self__",
            team_name: "Cá nhân",
          } as any);
        }

        const teamMap = new Map<string, TeamRow>();
        const names: Record<string, string> = {};
        const emails: Record<string, string> = {};

        for (const m of members) {
          const mAny = m as unknown as Record<string, unknown>;
          const teamId = (mAny.id_team as string | undefined) ?? "__all__";
          const teamName = (mAny.team_name as string | undefined) ?? "Tất cả";
          if (!teamMap.has(teamId)) {
            teamMap.set(teamId, {
              id: teamId,
              name_team: teamName,
              members: [],
            });
          }
          const memberRow: UserRow = {
            id: (mAny.member_id as string | undefined) ?? m.email,
            email: m.email,
            name: m.name,
          };
          teamMap.get(teamId)!.members!.push(memberRow);

          if (memberRow.id) {
            names[memberRow.id] = memberRow.name ?? memberRow.email ?? memberRow.id;
            emails[memberRow.id] = memberRow.email ?? "";
          }
        }

        setTeams(Array.from(teamMap.values()));
        setOwnerNames(names);
        setOwnerEmails(emails);
      }
    } catch (e) {
      console.error("loadTeams error", e);
    } finally {
      setLoadingTeams(false);
    }
  }, [leaderEmail]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 2 — Load Zalo accounts for members in selected team
  // ─────────────────────────────────────────────────────────────────────────────
  const selectedTeamMembers = useMemo<UserRow[]>(() => {
    if (!selectedTeamId || selectedTeamId === "__all__") {
      return teams.flatMap(t => t.members ?? []);
    }
    return teams.find(t => t.id === selectedTeamId)?.members ?? [];
  }, [teams, selectedTeamId]);

  const loadMemberAccounts = useCallback(async () => {
    if (!hasLoadedAccountsRef.current) {
      setLoadingAccounts(true);
    }
    try {
      const loaded: ZaloMemberAccount[] = [];
      const seenAccountIds = new Set<string>();
      const onlineSet = new Set<string>();
      const expiredSet = new Set<string>();

      const trackAccountOnlineState = (acc: ZaloAccountInfo) => {
        const isOnline = Boolean(
          acc.listener?.connected ||
          (acc.listener?.running && acc.status === "confirmed" && !acc.listener?.auth_expired)
        );
        if (isOnline) {
          onlineSet.add(acc.account_id);
          expiredSet.delete(acc.account_id);
        } else if (acc.listener?.auth_expired || acc.status === "session_expired") {
          expiredSet.add(acc.account_id);
        }
      };

      // Tối ưu chống N+1: Với Admin, 1 request getZaloAccounts("default") đã trả toàn bộ tài khoản công ty!
      if (role === "admin") {
        const platformRes = await getZaloAccounts("default").catch(() => null);
        const allPlatformAccounts = (platformRes?.accounts ?? []) as ZaloAccountInfo[];
        const byOwner = new Map<string, ZaloAccountInfo[]>();
        for (const acc of allPlatformAccounts) {
          trackAccountOnlineState(acc);
          const ownerKey = String((acc as any).id_member || acc.owner_id || "default").trim() || "default";
          const arr = byOwner.get(ownerKey) ?? [];
          arr.push(acc);
          byOwner.set(ownerKey, arr);
        }

        for (const member of selectedTeamMembers) {
          const ownerId = member.id ?? member.email ?? "";
          if (!ownerId) continue;
          const accs = (byOwner.get(ownerId) ?? []).filter((a) => !seenAccountIds.has(a.account_id));
          accs.forEach((a) => seenAccountIds.add(a.account_id));
          loaded.push({
            ownerId,
            ownerName: member.name ?? member.email ?? ownerId,
            ownerEmail: member.email ?? "",
            accounts: accs,
          });
        }

        const unassignedAccounts = allPlatformAccounts.filter((a) => !seenAccountIds.has(a.account_id));
        if (unassignedAccounts.length > 0) {
          loaded.push({
            ownerId: "default",
            ownerName: "Tài khoản Zalo",
            ownerEmail: "",
            accounts: unassignedAccounts,
          });
        }
      } else {
        // Leader / Member: fetch song song có kiểm soát
        const memberPromises = selectedTeamMembers.map(async (member) => {
          const ownerId = member.id ?? member.email ?? "";
          const email = member.email ?? "";
          if (!ownerId) return null;
          const res = await getZaloAccounts(ownerId, undefined, email);
          const accounts = res?.accounts ?? [];
          return {
            ownerId,
            ownerName: member.name ?? member.email ?? ownerId,
            ownerEmail: email,
            accounts: accounts as ZaloAccountInfo[],
          } satisfies ZaloMemberAccount;
        });

        const platformPromise = getZaloAccounts("default").catch(() => null);
        const [memberResults, platformRes] = await Promise.all([
          Promise.allSettled(memberPromises),
          platformPromise,
        ]);

        for (const r of memberResults) {
          if (r.status === "fulfilled" && r.value) {
            const uniqueAccs = r.value.accounts.filter((a) => !seenAccountIds.has(a.account_id));
            uniqueAccs.forEach((acc) => {
              seenAccountIds.add(acc.account_id);
              trackAccountOnlineState(acc);
            });
            loaded.push({ ...r.value, accounts: uniqueAccs });
          }
        }

        const platformAccounts = (platformRes?.accounts ?? []) as ZaloAccountInfo[];
        const unassignedAccounts = platformAccounts.filter((a) => !seenAccountIds.has(a.account_id));
        if (unassignedAccounts.length > 0) {
          unassignedAccounts.forEach(trackAccountOnlineState);
          loaded.push({
            ownerId: "default",
            ownerName: "Tài khoản Zalo",
            ownerEmail: "",
            accounts: unassignedAccounts,
          });
        }
      }

      hasLoadedAccountsRef.current = true;
      setMemberAccounts(loaded);
      setOnlineAccounts(onlineSet);
      setExpiredAccounts(expiredSet);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("zalo_online_accounts", JSON.stringify(Array.from(onlineSet)));
        } catch { /* no-op */ }
      }
    } catch (e) {
      console.error("loadMemberAccounts error", e);
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedTeamMembers, role]);

  useEffect(() => {
    void loadMemberAccounts();
    if (accountPollRef.current) clearInterval(accountPollRef.current);
    accountPollRef.current = setInterval(() => void loadMemberAccounts(), ACCOUNTS_POLL_MS);
    return () => {
      if (accountPollRef.current) clearInterval(accountPollRef.current);
    };
  }, [loadMemberAccounts]);

  // All active sessions list
  const allSessions = useMemo<ZaloAccountInfo[]>(() => {
    return memberAccounts.flatMap(g => g.accounts);
  }, [memberAccounts]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Select account → load conversations
  // ─────────────────────────────────────────────────────────────────────────────
  const [isReconnecting, setIsReconnecting] = useState(false);

  const reconnectAccount = useCallback(async (accountId?: string) => {
    const targetId = accountId || selectedAccountIdRef.current;
    if (!targetId) return;
    setIsReconnecting(true);
    try {
      await restartZaloAccountListener(targetId);
      showToast("Đang kết nối lại tài khoản Zalo...", true);
      // Đợi ngắn để tiến trình nền Node khởi động và kết nối WebSocket
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await loadMemberAccounts();
      showToast("Đã gửi tín hiệu kết nối lại tài khoản Zalo thành công!", true);
    } catch (err: any) {
      showToast(`Không thể kết nối lại: ${err?.message || "Lỗi máy chủ"}`, false);
    } finally {
      setIsReconnecting(false);
    }
  }, [showToast, loadMemberAccounts]);

  const onSelectAccount = useCallback((accountId: string) => {
    let ownerId = "";
    for (const group of memberAccounts) {
      if (group.accounts.some(a => a.account_id === accountId)) {
        ownerId = group.ownerId;
        break;
      }
    }
    setSelectedOwnerId(ownerId);
    setSelectedAccountId(accountId);
    setSelectedConvId("");
    convSignatureRef.current = "";
    messageSignatureRef.current = "";
    setMessages([]);
    setConversations([]);
  }, [memberAccounts]);

  const loadConversations = useCallback(async (accountId: string, silent = false) => {
    if (!accountId) return;
    if (!silent) {
      setLoadingConvs(true);
    }
    try {
      const res = await getZaloConversations(accountId);
      if (res && selectedAccountIdRef.current === accountId) {
        const list = Array.isArray(res.conversations) ? res.conversations : [];
        const sig = list
          .map(
            (c) =>
              `${c.conversation_id}:${c.latest_message_at || ""}:${c.unread_count || 0}:${c.latest_content || ""}:${c.zalo_kpi_status || ""}:${c.zalo_kpi_is_lead ? 1 : 0}`,
          )
          .join("|");
        if (!silent || sig !== convSignatureRef.current) {
          convSignatureRef.current = sig;
          setConversations(list);
        }
      }
    } catch (e) {
      console.error("loadConversations error", e);
    } finally {
      if (!silent) {
        setLoadingConvs(false);
      }
    }
  }, []);

  useEffect(() => {
    if (convPollRef.current) clearInterval(convPollRef.current);
    if (!selectedAccountId) return;

    void loadConversations(selectedAccountId, false);
    const pollInterval = sseConnected ? CONVERSATIONS_SSE_POLL_MS : CONVERSATIONS_POLL_MS;
    convPollRef.current = setInterval(() => {
      void loadConversations(selectedAccountIdRef.current, true);
    }, pollInterval);

    return () => {
      if (convPollRef.current) clearInterval(convPollRef.current);
    };
  }, [selectedAccountId, sseConnected, loadConversations]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Select conversation → load messages (Tối ưu 0ms tức thì qua Client Cache)
  // ─────────────────────────────────────────────────────────────────────────────
  const loadMoreMessages = useCallback(async () => {
    const accountId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    if (!accountId || !convId || loadingMore || !hasMoreMessages) return;

    setLoadingMore(true);
    try {
      const currentCount = messages.length;
      const res = await getZaloConversationMessages(accountId, convId, 50, currentCount);
      if (res?.messages && res.messages.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.source_message_id || m.id));
          const uniqueNew = res.messages.filter((m) => !existingIds.has(m.source_message_id || m.id));
          return [...uniqueNew, ...prev];
        });
        const totalCount = res.total ?? (currentCount + res.messages.length);
        setMessageTotal(totalCount);
        setHasMoreMessages(currentCount + res.messages.length < totalCount);
      } else {
        setHasMoreMessages(false);
      }
    } catch (e) {
      console.error("loadMoreMessages error", e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreMessages, messages.length]);

  const onSelectConv = useCallback((convId: string) => {
    setSelectedConvId(convId);
    messageSignatureRef.current = "";
    setGroupMembers(null);
    setPendingMentions([]);
    setReplyingTo(null);
    setSendError(null);

    const accId = selectedAccountIdRef.current || "default";
    const scopedCacheKey = `${accId}:${convId}`;

    // ⚡ 0ms Instant Response: Bộ đệm đa tầng (RAM Cache -> SessionStorage) khóa theo accountId:convId
    let cached = convMessagesCacheRef.current.get(scopedCacheKey);
    if ((!cached || cached.length === 0) && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(`zalo_conv_msgs_${scopedCacheKey}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            cached = parsed;
            convMessagesCacheRef.current.set(scopedCacheKey, parsed);
          }
        }
      } catch { /* no-op */ }
    }

    if (cached && cached.length > 0) {
      setMessages(cached);
      setLoadingMessages(false);
    } else {
      setMessages([]);
      setLoadingMessages(true);
    }
  }, []);

  const loadMessages = useCallback(async (accountId: string, convId: string, append = false) => {
    if (!accountId || !convId) return;
    const scopedCacheKey = `${accountId}:${convId}`;
    const fetchKey = `${scopedCacheKey}:${append ? "bg" : "fg"}`;
    if (inFlightFetchRef.current === fetchKey) return;
    inFlightFetchRef.current = fetchKey;
    const requestSeq = ++messageLoadSeqRef.current;
    if (!append && !convMessagesCacheRef.current.has(scopedCacheKey)) {
      setLoadingMessages(true);
    }
    try {
      // ⚡ Tối ưu tải tức thì (<150ms): Lần đầu chỉ nạp 50 tin mới nhất
      const res = await getZaloConversationMessages(accountId, convId, 50, 0);
      if (selectedAccountIdRef.current !== accountId || selectedConvIdRef.current !== convId) return;
      if (requestSeq !== messageLoadSeqRef.current && !append) return;
      if (res?.messages) {
        // Lưu vào bộ đệm cache client-side (RAM + SessionStorage) theo khóa accountId:convId
        convMessagesCacheRef.current.set(scopedCacheKey, res.messages);
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem(`zalo_conv_msgs_${scopedCacheKey}`, JSON.stringify(res.messages.slice(-50)));
          } catch { /* no-op */ }
        }

        const signature = res.messages
          .map((m) => `${m.source_message_id || m.id || ""}:${m.timestamp_text || m.time_text || ""}:${m.is_deleted ? 1 : 0}:${m.msg_kind || ""}:${JSON.stringify(m.reactions || null)}`)
          .join("|");
        if (signature !== messageSignatureRef.current) {
          messageSignatureRef.current = signature;
          setMessages((prev) => {
            // Giữ lại các tin nhắn lạc quan (optimistic) đang gửi chưa kịp đồng bộ vào DB
            const pendingOptimistic = prev.filter(
              (m) => String(m.id).startsWith("optimistic_") && !res.messages.some((rm) => rm.content === m.content)
            );
            return pendingOptimistic.length > 0 ? [...res.messages, ...pendingOptimistic] : res.messages;
          });
        }
        const totalCount = res.total ?? res.messages.length;
        setMessageTotal(totalCount);
        setHasMoreMessages(res.messages.length < totalCount);
      }
    } catch (e) {
      console.error("loadMessages error", e);
    } finally {
      if (inFlightFetchRef.current === fetchKey) {
        inFlightFetchRef.current = null;
      }
      if (selectedAccountIdRef.current === accountId && selectedConvIdRef.current === convId) {
        setLoadingMessages(false);
      }
    }
    // Chỉ mark-read khi mở hội thoại/lần tải chính, chạy ngầm non-blocking để không cản trở render UI
    if (!append && selectedAccountIdRef.current === accountId && selectedConvIdRef.current === convId) {
      markZaloConversationAsRead(accountId, convId).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (msgPollRef.current) clearInterval(msgPollRef.current);
    if (!selectedAccountId || !selectedConvId) return;

    void loadMessages(selectedAccountId, selectedConvId);
    const pollInterval = sseConnected ? MESSAGES_SSE_POLL_MS : MESSAGES_POLL_MS;
    msgPollRef.current = setInterval(() => {
      void loadMessages(selectedAccountIdRef.current, selectedConvIdRef.current, true);
    }, pollInterval);

    return () => {
      if (msgPollRef.current) clearInterval(msgPollRef.current);
    };
  }, [selectedAccountId, selectedConvId, sseConnected, loadMessages]);

  // ─────────────────────────────────────────────────────────────────────────────
  // SSE realtime for selected account
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setSseConnected(false);
    if (!selectedAccountId) return;

    const voipRefreshTimers: ReturnType<typeof setTimeout>[] = [];
    const clearVoipTimers = () => {
      while (voipRefreshTimers.length > 0) {
        const t = voipRefreshTimers.pop();
        if (t) clearTimeout(t);
      }
    };

    try {
      const streamOptions: BuildZaloRealtimeStreamOptions = { userId: selectedAccountId };
      const url = buildZaloRealtimeStreamUrl(streamOptions);
      const es = new EventSource(url);
      sseRef.current = es;

      es.onopen = () => {
        setSseConnected(true);
      };

      es.addEventListener("ready", () => {
        setSseConnected(true);
      });

      const applyRecallInPlace = (targetGroupId: string, sourceMsgId: string, cliMsgId: string) => {
        if (!sourceMsgId && !cliMsgId) return;
        const currentAccId = selectedAccountIdRef.current;
        const currentConvId = selectedConvIdRef.current;
        if (targetGroupId && currentConvId && targetGroupId !== currentConvId) return;

        const matchesRecalled = (m: ZaloLibraryMessage) =>
          (Boolean(sourceMsgId) && (m.source_message_id === sourceMsgId || String(m.id) === sourceMsgId)) ||
          (Boolean(cliMsgId) && m.cli_msg_id === cliMsgId);

        messageSignatureRef.current = "";
        setMessages((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            if (!matchesRecalled(m) || m.is_deleted) return m;
            changed = true;
            // Giữ nguyên msg_kind & raw_content, chỉ đánh dấu is_deleted: true tại chỗ
            return { ...m, is_deleted: true };
          });
          if (changed && currentAccId && currentConvId) {
            const cacheKey = `${currentAccId}:${currentConvId}`;
            convMessagesCacheRef.current.set(cacheKey, next);
            if (typeof window !== "undefined") {
              try {
                sessionStorage.setItem(`zalo_conv_msgs_${cacheKey}`, JSON.stringify(next.slice(-50)));
              } catch { /* no-op */ }
            }
          }
          return changed ? next : prev;
        });
      };

      const refreshFriendStatusForConv = (targetGroupId: string) => {
        const currentAccId = selectedAccountIdRef.current;
        const currentConvId = selectedConvIdRef.current;
        if (!currentAccId || !currentConvId) return;
        if (targetGroupId && targetGroupId !== currentConvId) return;
        getZaloFriendStatus(currentAccId, currentConvId)
          .then((res) => {
            if (selectedAccountIdRef.current === currentAccId && selectedConvIdRef.current === currentConvId) {
              setFriendStatus(res);
            }
          })
          .catch(() => {});
      };

      const handleNormalizedRealtimePayload = (
        payload: Record<string, unknown>,
        fallbackEventType?: string,
      ) => {
        const payloadType = String(payload?.type || fallbackEventType || "").toLowerCase();
        const eventSubtype = String(payload?.event_subtype || "").toLowerCase();
        const payloadGroupId = String(
          payload?.group_id || payload?.thread_id || payload?.conversation_id || "",
        ).trim();

        if (payloadType === "voip_signal") {
          const act = String(payload.act || "").toLowerCase();
          const status = String(payload.status || "").toLowerCase();
          if (act === "request" || act === "group_request" || status === "incoming") {
            showToast("📞 Có cuộc gọi đến trên Zalo", true);
          }
          if (
            ["cancel", "reject", "endcall", "end_call", "busy"].includes(act) ||
            ["cancelled", "rejected", "ended", "busy"].includes(status)
          ) {
            // Zalo thường đẩy tin nhắn thẻ cuộc gọi (recommened.misscall / calltime) sau tín hiệu kết thúc 1-3s
            voipRefreshTimers.push(
              setTimeout(() => {
                void loadMessages(selectedAccountIdRef.current, selectedConvIdRef.current, true);
                void loadConversations(selectedAccountIdRef.current, true);
              }, 1500),
              setTimeout(() => {
                void loadMessages(selectedAccountIdRef.current, selectedConvIdRef.current, true);
                void loadConversations(selectedAccountIdRef.current, true);
              }, 3800),
            );
          }
          return;
        }

        if (payloadType === "message_recalled" || payloadType === "undo") {
          const sourceMsgId = String(
            payload.source_message_id || payload.message_id || payload.msg_id || payload.global_msg_id || "",
          ).trim();
          const cliMsgId = String(payload.cli_msg_id || "").trim();
          applyRecallInPlace(payloadGroupId, sourceMsgId, cliMsgId);
          return;
        }

        if (
          payloadType === "friend_event" ||
          (payloadType === "new_messages" && eventSubtype === "friend_event")
        ) {
          messageSignatureRef.current = "";
          refreshFriendStatusForConv(payloadGroupId);
          return;
        }

        if (
          payloadType === "group_event" ||
          (payloadType === "new_messages" && eventSubtype === "group_event")
        ) {
          messageSignatureRef.current = "";
        }
      };

      const onZaloRealtimeEvent = (event: Event, fallbackEventType?: string) => {
        setSseConnected(true);
        try {
          const payload = JSON.parse((event as MessageEvent).data || "{}") as Record<string, unknown>;
          handleNormalizedRealtimePayload(payload, fallbackEventType);
        } catch {
          /* ignore non-json SSE data */
        }
        void loadMessages(selectedAccountIdRef.current, selectedConvIdRef.current, true);
        void loadConversations(selectedAccountIdRef.current, true);
      };

      es.addEventListener("zalo-message", (event) => onZaloRealtimeEvent(event));
      es.addEventListener("message_recalled", (event) => onZaloRealtimeEvent(event, "message_recalled"));
      es.addEventListener("undo", (event) => onZaloRealtimeEvent(event, "undo"));
      es.addEventListener("friend_event", (event) => onZaloRealtimeEvent(event, "friend_event"));
      es.addEventListener("group_event", (event) => onZaloRealtimeEvent(event, "group_event"));

      es.addEventListener("auth_expired", (event) => {
        let eventAccountId = selectedAccountId;
        try {
          const payload = JSON.parse((event as MessageEvent).data || "{}");
          eventAccountId = String(payload.account_id || payload.user_id || payload.userId || eventAccountId);
        } catch {
          // Older backend events may not include JSON; keep the selected account fallback.
        }
        const currentAccountId = selectedAccountIdRef.current;
        if (!eventAccountId || eventAccountId !== currentAccountId) return;
        setExpiredAccounts((prev) => new Set([...prev, eventAccountId]));
        setOnlineAccounts((prev) => {
          const next = new Set(prev);
          next.delete(eventAccountId);
          return next;
        });
      });

      es.onerror = () => {
        setSseConnected(false);
      };
    } catch {
      setSseConnected(false);
    }

    return () => {
      clearVoipTimers();
      setSseConnected(false);
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [selectedAccountId, loadMessages, loadConversations, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // KPI verified counts load
  // ─────────────────────────────────────────────────────────────────────────────
  const loadKpi = useCallback(async () => {
    if (selectedTeamMembers.length === 0) return;
    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const endDate = now.toISOString().slice(0, 10);

    const results = await Promise.allSettled(
      selectedTeamMembers.map(async (m) => {
        const email = m.email ?? "";
        if (!email) return null;
        const res = await zaloInboxShareService.countVerified(email, startDate, endDate);
        return { email, count: res?.data?.count ?? 0 };
      })
    );

    const kpi: Record<string, number> = {};
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        kpi[r.value.email] = r.value.count;
      }
    }
    setKpiByOwner(kpi);
  }, [selectedTeamMembers]);

  useEffect(() => {
    void loadKpi();
  }, [loadKpi]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Scan deep (Quét ngay)
  // ─────────────────────────────────────────────────────────────────────────────
  const scan = useCallback(async () => {
    if (!selectedAccountId) return showToast("Chưa chọn tài khoản Zalo", false);
    setScanning(true);
    try {
      await syncZaloRecentConversations(selectedAccountId, 50, 50);
      showToast("Đang đồng bộ tin nhắn Zalo gần đây...", true);
      void loadConversations(selectedAccountId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Đồng bộ thất bại", false);
    } finally {
      setScanning(false);
    }
  }, [selectedAccountId, loadConversations, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Mark is_customer / push_to_zalo / hide
  // ─────────────────────────────────────────────────────────────────────────────
  const mark = useCallback(async (convId: string, field: string, value: boolean) => {
    if (!selectedAccountId) return;
    const ownerEmail = ownerEmails[selectedOwnerId] || user?.email || "";

    try {
      if (field === "is_customer") {
        let shareId = shareIdsMap[convId];
        if (!shareId) {
          const res = await zaloInboxShareService.toggle({
            account_id: selectedAccountId,
            conversation_id: convId,
            member_email: ownerEmail,
            is_active: true,
          });
          if (res.success && (res.data as any)?.row?.id) {
            shareId = (res.data as any).row.id;
            setShareIdsMap(prev => ({ ...prev, [convId]: shareId }));
          }
        }
        if (shareId) {
          await zaloInboxShareService.toggleLead(shareId, user?.email || "", value);
          setIsCustomerSet(prev => {
            const next = new Set(prev);
            if (value) next.add(convId);
            else next.delete(convId);
            return next;
          });
          showToast(value ? "Đã đánh dấu khách hàng" : "Đã bỏ đánh dấu khách hàng", true);
        } else {
          showToast("Lỗi khi kết nối", false);
        }
      }
    } catch {
      showToast("Lỗi khi cập nhật trạng thái", false);
    }
  }, [selectedAccountId, selectedOwnerId, ownerEmails, user?.email, shareIdsMap, showToast]);

  const saveArchive = useCallback(async (convId: string, hide = false) => {
    if (!convId) return;
    if (hide) {
      setHiddenConvIds(prev => {
        const next = new Set(prev);
        next.add(convId);
        if (typeof window !== "undefined") {
          localStorage.setItem("zalo_hidden_convs", JSON.stringify(Array.from(next)));
        }
        return next;
      });
      showToast("Đã ẩn hội thoại khỏi hộp thư", true);
      if (selectedConvIdRef.current === convId) {
        setSelectedConvId("");
      }
    } else {
      await mark(convId, "is_customer", true);
    }
  }, [mark, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Save Customer Note
  // ─────────────────────────────────────────────────────────────────────────────
  const saveCustomerNote = useCallback(async (convId: string, note: string) => {
    if (!selectedAccountId) return;
    const ownerEmail = ownerEmails[selectedOwnerId] || user?.email || "";
    setSavingNoteConv(convId);
    try {
      await zaloInboxShareService.toggle({
        account_id: selectedAccountId,
        conversation_id: convId,
        member_email: ownerEmail,
        is_active: true,
        note: note,
      });
      setCustomerNotes(prev => ({ ...prev, [convId]: note }));
      showToast("Đã lưu ghi chú khách hàng", true);
      void fetchShareStatus();
    } catch {
      showToast("Lỗi khi lưu ghi chú", false);
    } finally {
      setSavingNoteConv("");
    }
  }, [selectedAccountId, selectedOwnerId, ownerEmails, user?.email, showToast, fetchShareStatus]);

  // ─────────────────────────────────────────────────────────────────────────────
  // KPI verification (Fb style)
  // ─────────────────────────────────────────────────────────────────────────────
  const suggestKpi = useCallback(async (payload: { member_email: string; conv_ids: string[]; user_id: string }) => {
    setSuggestedConvIds(prev => new Set([...prev, ...payload.conv_ids]));
    try {
      await Promise.all(
        payload.conv_ids.map(id =>
          zaloInboxShareService.toggle({
            account_id: payload.user_id,
            conversation_id: id,
            member_email: payload.member_email,
            is_active: true,
          })
        )
      );
      showToast(`Đã đề xuất ${payload.conv_ids.length} inbox để tính KPI`, true);
      void fetchShareStatus();
    } catch {
      showToast("Lỗi đề xuất KPI Zalo", false);
    }
  }, [fetchShareStatus, showToast]);

  const toggleShare = useCallback(async (convId: string) => {
    if (!selectedAccountId) return;
    const ownerEmail = ownerEmails[selectedOwnerId] || user?.email || "";
    if (!ownerEmail) return;

    const currentlyShared = suggestedConvIds.has(convId) || verifiedConvIds.has(convId);
    const newActiveState = !currentlyShared;

    try {
      const res = await zaloInboxShareService.toggle({
        account_id: selectedAccountId,
        conversation_id: convId,
        member_email: ownerEmail,
        is_active: newActiveState,
      });

      if (res.success) {
        showToast(newActiveState ? "Đã chia sẻ hội thoại với leader/admin" : "Đã hủy chia sẻ hội thoại", true);
        await fetchShareStatus();
      } else {
        showToast(res.message || "Lỗi khi cập nhật quyền chia sẻ", false);
      }
    } catch (e) {
      showToast("Lỗi kết nối máy chủ", false);
    }
  }, [selectedAccountId, selectedOwnerId, ownerEmails, user?.email, suggestedConvIds, verifiedConvIds, fetchShareStatus, showToast]);

  const revokeAllShares = useCallback(async () => {
    if (!selectedAccountId) return;
    const ownerEmail = ownerEmails[selectedOwnerId] || user?.email || "";
    if (!ownerEmail) return;

    if (!window.confirm("Bạn có chắc chắn muốn HỦY CHIA SẺ tất cả các hội thoại chưa được duyệt KPI của tài khoản này?")) {
      return;
    }

    try {
      const res = await zaloInboxShareService.revokeAll({
        account_id: selectedAccountId,
        member_email: ownerEmail,
      });

      if (res.success) {
        showToast(`Đã thu hồi chia sẻ thành công cho ${res.data?.count ?? 0} hội thoại`, true);
        await fetchShareStatus();
      } else {
        showToast(res.message || "Lỗi khi hủy chia sẻ tất cả", false);
      }
    } catch (e) {
      showToast("Lỗi kết nối máy chủ", false);
    }
  }, [selectedAccountId, selectedOwnerId, ownerEmails, user?.email, fetchShareStatus, showToast]);

  const syncConversationMessages = useCallback(async (convId: string) => {
    if (!selectedAccountId || !convId) return;
    setIsSyncingMessages(prev => ({ ...prev, [convId]: true }));
    try {
      const res = await syncZaloConversationMessages(selectedAccountId, convId);
      if (res?.ok) {
        showToast("Đã bắt đầu đồng bộ tin nhắn cũ. Lịch sử sẽ cập nhật sau giây lát.", true);
        await loadMessages(selectedAccountId, convId);
      } else {
        showToast(res?.message || "Lỗi đồng bộ lịch sử tin nhắn", false);
      }
    } catch (e) {
      showToast("Lỗi đồng bộ lịch sử tin nhắn", false);
    } finally {
      setIsSyncingMessages(prev => ({ ...prev, [convId]: false }));
    }
  }, [selectedAccountId, loadMessages, showToast]);



  const verifyConvKpi = useCallback(async (
    accountId: string,
    convId: string,
    opts: { is_confirmed?: boolean; is_lead?: boolean; member_email?: string; note?: string },
  ) => {
    if (!accountId || !convId) return false;
    const ownerEmail = opts.member_email || ownerEmails[selectedOwnerId] || user?.email || undefined;
    try {
      const res = await allPlatformKpiService.verifyZaloInbox({
        account_id: accountId,
        conversation_id: convId,
        member_email: ownerEmail,
        is_confirmed: opts.is_confirmed,
        is_lead: opts.is_lead,
        note: opts.note,
      });
      if (res?.success) {
        const msg =
          opts.is_confirmed !== undefined
            ? (opts.is_confirmed ? "Đã duyệt +1 KPI Inbox Zalo" : "Đã hủy duyệt KPI Inbox Zalo")
            : (opts.is_lead ? "Đã gắn nhãn Lead Zalo" : "Đã bỏ nhãn Lead Zalo");
        showToast(msg, true);
        void loadConversations(accountId);
        void loadKpi();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("zalo-kpi-updated"));
        }
        return true;
      }
      showToast(res?.message || "Cập nhật KPI Zalo thất bại", false);
      return false;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Lỗi cập nhật KPI Zalo", false);
      return false;
    }
  }, [ownerEmails, selectedOwnerId, user?.email, showToast, loadConversations, loadKpi]);

  const verifyKpi = useCallback(async (payload: { leader_email: string; conv_ids: string[] }) => {
    try {
      await Promise.all(
        payload.conv_ids.map(id => {
          const rowId = shareIdsMap[id];
          if (rowId) {
            return zaloInboxShareService.verify(rowId, payload.leader_email);
          }
          return Promise.resolve();
        })
      );
      showToast("Đã xác minh KPI thành công!", true);
      void fetchShareStatus();
    } catch {
      showToast("Lỗi xác minh KPI", false);
    }
  }, [shareIdsMap, fetchShareStatus, showToast]);

  const bulkVerifyKpi = useCallback(async (payload: { leader_email: string; target_date: string }) => {
    setIsBulkVerifying(true);
    const toVerify = Array.from(suggestedConvIds);
    if (toVerify.length === 0) {
      showToast("Không có đề xuất KPI nào cần duyệt", false);
      setIsBulkVerifying(false);
      return;
    }
    try {
      await verifyKpi({ leader_email: payload.leader_email, conv_ids: toVerify });
      showToast("Đã duyệt KPI hàng loạt thành công!", true);
    } finally {
      setIsBulkVerifying(false);
    }
  }, [suggestedConvIds, verifyKpi, showToast]);

  const bulkSuggestKpi = useCallback(async () => {
    if (!selectedAccountId) return;
    const ownerEmail = ownerEmails[selectedOwnerId] || user?.email || "";
    const toSuggest = conversations
      .map(c => c.conversation_id)
      .filter(id => !verifiedConvIds.has(id) && !suggestedConvIds.has(id));

    if (toSuggest.length === 0) {
      showToast("Không có hội thoại nào cần đề xuất tính KPI", false);
      return;
    }
    setIsBulkSuggesting(true);
    try {
      await suggestKpi({ member_email: ownerEmail, conv_ids: toSuggest, user_id: selectedAccountId });
    } finally {
      setIsBulkSuggesting(false);
    }
  }, [conversations, selectedAccountId, selectedOwnerId, ownerEmails, user?.email, verifiedConvIds, suggestedConvIds, suggestKpi, showToast]);

  // UID Zalo thật của account đang xem — suy từ sender_id của tin CHÍNH MÌNH đã gửi
  const myZaloUid = useMemo(
    () => messages.find((m) => m.is_sent && m.sender_id)?.sender_id || null,
    [messages],
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Send reply message (Tối ưu 0ms Optimistic UI)
  // ─────────────────────────────────────────────────────────────────────────────
  const sendReply = useCallback(async () => {
    const text = reply.trim();
    if (!text) return;
    setReply("");
    setIsSending(true);
    setSendError(null);
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    if (!accId || !convId) {
      setIsSending(false);
      return;
    }

    const tempId = `optimistic_${Date.now()}`;
    const now = new Date();
    const timeText = now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const optimisticMsg: ZaloLibraryMessage = {
      id: tempId,
      user_id: accId,
      source_message_id: tempId,
      sender_id: myZaloUid || "me",
      sender_name: "Bạn",
      is_sent: true,
      is_deleted: false,
      type: "chat",
      content: text,
      timestamp_text: "Vừa xong",
      time_text: timeText,
      ts: now.getTime(),
      staff_name: user?.name || "Bạn",
      staff_avatar: (user as any)?.avatar_url || (user as any)?.avatar || null,
      staff_email: user?.email || null,
      assets: [],
    };

    // 0ms Optimistic UI: Hiển thị ngay trên màn hình chat và preview hội thoại
    setMessages((prev) => [...prev, optimisticMsg]);
    setConversations((prev) =>
      prev.map((c) =>
        c.conversation_id === convId
          ? { ...c, preview: text, time: timeText, unread: false }
          : c
      )
    );

    try {
      await sendZaloMessage(accId, convId, {
        text,
        staff_name: user?.name,
        staff_avatar: (user as any)?.avatar_url || (user as any)?.avatar,
        staff_email: user?.email,
      });
      await loadMessages(accId, convId, true);
      void loadConversations(accId);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zalo-kpi-updated"));
      }
    } catch (e) {
      // Nếu gửi lỗi, rút lại tin nhắn lạc quan
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      const rawMsg = e instanceof Error ? e.message : "Gửi tin nhắn thất bại";
      let userFriendlyMsg = rawMsg;
      if (rawMsg.includes("zca_session_expired") || rawMsg.includes("hết hạn") || rawMsg.includes("đăng xuất")) {
        userFriendlyMsg = "Phiên đăng nhập Zalo của tài khoản này đã hết hạn hoặc bị đăng xuất. Vui lòng mở Chrome Extension để đăng nhập lại!";
      } else if (rawMsg.includes("502") || rawMsg.includes("504") || rawMsg.includes("Bad Gateway") || rawMsg.includes("tạm ngắt")) {
        userFriendlyMsg = "Máy chủ hoặc tiến trình Zalo tạm ngắt kết nối. Đang thử kích hoạt lại...";
        if (accId) void restartZaloAccountListener(accId).catch(() => {});
      } else if (rawMsg.includes("Unexpected token") || rawMsg.includes("is not valid JSON") || rawMsg.includes("<html") || rawMsg.includes("413")) {
        userFriendlyMsg = "Không thể gửi: Tệp/ảnh quá lớn hoặc máy chủ phản hồi lỗi HTML. Vui lòng kiểm tra lại!";
      }
      setSendError(userFriendlyMsg);
      showToast(userFriendlyMsg, false);
      setReply(text); // restore text để người dùng không bị mất nội dung
    } finally {
      setIsSending(false);
    }
  }, [reply, myZaloUid, loadMessages, loadConversations, showToast]);

  // "Trả lời tin nhắn" — áp dụng cho CẢ tin của mình lẫn của đối phương (khác
  // recall, chỉ cho tin mình gửi). Preview hiện phía trên ô nhập (do shell tự
  // render dựa vào replyingTo), huỷ được, tự xoá ngay khi bắt đầu gửi (optimistic)
  // và được phục hồi lại nếu gửi lỗi để không mất ngữ cảnh đang trả lời.
  const sendMessage = useCallback(async (text: string, files?: File[]) => {
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    if (!accId || !convId) return;
    setIsSending(true);
    setSendError(null);
    // Chỉ áp dụng quote cho tin text đi qua /send (media dùng /send-media, BE
    // chưa hỗ trợ quote ở đó). message_id là bắt buộc, các field còn lại bỏ
    // qua nếu thiếu thay vì gửi null/undefined tường minh.
    const capturedReplyingTo = replyingTo;
    const msgIdForQuote = capturedReplyingTo?.source_message_id || capturedReplyingTo?.id;
    const replyTo: ZaloReplyToPayload | undefined =
      msgIdForQuote && !(files && files.length > 0)
        ? {
            message_id: msgIdForQuote,
            cli_msg_id: capturedReplyingTo.cli_msg_id || undefined,
            sender_id: capturedReplyingTo.sender_id || undefined,
            content: capturedReplyingTo.content || undefined,
            ts: capturedReplyingTo.ts || undefined,
          }
        : undefined;
    setReplyingTo(null);

    // 0ms Optimistic UI: Tạo ngay tin nhắn hiển thị tức thì trên giao diện
    const tempId = `optimistic_${Date.now()}`;
    const now = new Date();
    const timeText = now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const contentPreview = text || (files?.length ? `[${files.length} tệp đính kèm]` : "");
    const optimisticMsg: ZaloLibraryMessage = {
      id: tempId,
      user_id: accId,
      source_message_id: tempId,
      sender_id: myZaloUid || "me",
      sender_name: "Bạn",
      is_sent: true,
      is_deleted: false,
      type: "chat",
      content: text,
      timestamp_text: "Vừa xong",
      time_text: timeText,
      ts: now.getTime(),
      staff_name: user?.name || "Bạn",
      staff_avatar: (user as any)?.avatar_url || (user as any)?.avatar || null,
      staff_email: user?.email || null,
      reply_to_id: replyTo?.message_id,
      assets: (files?.map((f) => ({
        url: URL.createObjectURL(f),
        storage_url: URL.createObjectURL(f),
        filename: f.name,
        filesize: f.size,
        mime_type: f.type,
        status: "ready" as const,
      })) || []) as any,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setConversations((prev) =>
      prev.map((c) =>
        c.conversation_id === convId
          ? { ...c, preview: contentPreview, time: timeText, unread: false }
          : c
      )
    );

    try {
      if (files && files.length > 0) {
        await sendZaloMessageWithFiles(accId, convId, text, files, undefined, user?.name, (user as any)?.avatar_url || (user as any)?.avatar);
      } else if (pendingMentions.length > 0) {
        // Tin có @tag/@All — dùng route riêng hỗ trợ mentions (Mục 3.3.5 guide).
        await sendZaloMessageWithMentions(accId, convId, text, pendingMentions, replyTo, user?.name, (user as any)?.avatar_url || (user as any)?.avatar, user?.email);
      } else {
        await sendZaloMessage(accId, convId, {
          text,
          reply_to: replyTo,
          staff_name: user?.name,
          staff_avatar: (user as any)?.avatar_url || (user as any)?.avatar,
          staff_email: user?.email,
        });
      }
      setPendingMentions([]);
      await loadMessages(accId, convId, true);
      void loadConversations(accId);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zalo-kpi-updated"));
      }
    } catch (e) {
      // Rút lại tin nhắn lạc quan khi có lỗi
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      const rawMsg = e instanceof Error ? e.message : "Gửi tin nhắn thất bại";
      let userFriendlyMsg = rawMsg;
      if (rawMsg.includes("zca_session_expired") || rawMsg.includes("hết hạn") || rawMsg.includes("đăng xuất")) {
        userFriendlyMsg = "Phiên đăng nhập Zalo của tài khoản này đã hết hạn hoặc bị đăng xuất. Vui lòng mở Chrome Extension để đăng nhập lại!";
      } else if (rawMsg.includes("502") || rawMsg.includes("504") || rawMsg.includes("Bad Gateway") || rawMsg.includes("tạm ngắt")) {
        userFriendlyMsg = "Máy chủ hoặc tiến trình Zalo tạm ngắt kết nối. Đang thử kích hoạt lại...";
        if (accId) void restartZaloAccountListener(accId).catch(() => {});
      } else if (rawMsg.includes("Unexpected token") || rawMsg.includes("is not valid JSON") || rawMsg.includes("<html") || rawMsg.includes("413")) {
        userFriendlyMsg = "Không thể gửi: Tệp/ảnh quá lớn hoặc máy chủ phản hồi lỗi HTML. Vui lòng kiểm tra lại!";
      }
      setSendError(userFriendlyMsg);
      showToast(userFriendlyMsg, false);
      if (replyTo) setReplyingTo(capturedReplyingTo);
    } finally {
      setIsSending(false);
    }
  }, [loadMessages, loadConversations, pendingMentions, replyingTo, myZaloUid, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Thu hồi tin nhắn thật (api.undo) — chỉ khả dụng cho tin do chính mình gửi,
  // yêu cầu cả message_id thật lẫn cli_msg_id (id lúc gửi) trên message row.
  // ─────────────────────────────────────────────────────────────────────────────
  const recallMessage = useCallback(async (message: ZaloLibraryMessage) => {
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    const msgId = message.source_message_id || String(message.id || "");
    const cliMsgId = (message as unknown as { cli_msg_id?: string }).cli_msg_id;
    if (!accId || !convId || !msgId || !cliMsgId) {
      showToast("Tin này không thể thu hồi (thiếu cli_msg_id).", false);
      return;
    }
    try {
      await recallZaloMessage(accId, convId, { source_message_id: msgId });
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, is_deleted: true } : m)));
      showToast("Đã thu hồi tin nhắn", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Thu hồi tin nhắn thất bại", false);
    }
  }, [showToast]);

  // Thả cảm xúc — CHỈ gửi lên Zalo thật, KHÔNG tự ghi DB (listener xử lý khi
  // nhận event "reaction" echo lại, xem comment route POST /react phía
  // backend) — tự hiện tạm (optimistic) ngay bằng myZaloUid nếu đã biết.
  const reactToMessage = useCallback(async (message: ZaloLibraryMessage, icon: string) => {
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    const msgId = message.source_message_id || String(message.id || "");
    const cliMsgId = (message as unknown as { cli_msg_id?: string }).cli_msg_id;
    if (!accId || !convId || !msgId || !cliMsgId) return;
    const reactorKey = myZaloUid || "__me__";
    const existing = message.reactions?.[reactorKey];
    const nextIcon = existing === icon ? "NONE" : icon;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== message.id) return m;
        const nextReactions = { ...(m.reactions || {}) };
        if (nextIcon === "NONE") delete nextReactions[reactorKey];
        else nextReactions[reactorKey] = nextIcon;
        return { ...m, reactions: nextReactions };
      }),
    );
    try {
      await reactToZaloMessage(accId, convId, { source_message_id: msgId, icon: nextIcon });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Không thể thả cảm xúc", false);
    }
  }, [myZaloUid, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Trạng thái bạn bè — tự tải khi mở 1 hội thoại (best-effort: nếu convId là
  // 1 group (không phải uid cá nhân), backend/zca-js sẽ trả lỗi và ta chỉ cần
  // im lặng bỏ qua, không có cách nào rẻ để phân biệt group/user ở tầng FE này
  // mà không thêm 1 round-trip riêng).
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setFriendStatus(null);
    if (!selectedAccountId || !selectedConvId) return;
    let cancelled = false;
    setLoadingFriendStatus(true);
    getZaloFriendStatus(selectedAccountId, selectedConvId)
      .then((res) => { if (!cancelled) setFriendStatus(res); })
      .catch(() => { if (!cancelled) setFriendStatus(null); })
      .finally(() => { if (!cancelled) setLoadingFriendStatus(false); });
    return () => { cancelled = true; };
  }, [selectedAccountId, selectedConvId]);

  const sendFriendRequestAction = useCallback(async (message = "") => {
    if (!selectedAccountId || !selectedConvId) return;
    setFriendActionLoading(true);
    try {
      await sendZaloFriendRequest(selectedAccountId, selectedConvId, message);
      showToast("Đã gửi lời mời kết bạn", true);
      const res = await getZaloFriendStatus(selectedAccountId, selectedConvId);
      setFriendStatus(res);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gửi lời mời kết bạn thất bại", false);
    } finally {
      setFriendActionLoading(false);
    }
  }, [selectedAccountId, selectedConvId, showToast]);

  const acceptFriendRequestAction = useCallback(async () => {
    if (!selectedAccountId || !selectedConvId) return;
    setFriendActionLoading(true);
    try {
      await acceptZaloFriendRequest(selectedAccountId, selectedConvId);
      showToast("Đã chấp nhận lời mời kết bạn", true);
      const res = await getZaloFriendStatus(selectedAccountId, selectedConvId);
      setFriendStatus(res);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Chấp nhận lời mời kết bạn thất bại", false);
    } finally {
      setFriendActionLoading(false);
    }
  }, [selectedAccountId, selectedConvId, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Quét thành viên nhóm — chỉ gọi tay (nút "Quét thành viên"), dùng để tạo
  // bulk-send job ở trang riêng (Mục 8(i) guide) — trang đó tự điều hướng sang
  // /all-platform/zalo-bulk-send với kết quả này, không xử lý bulk-send ở đây.
  // ─────────────────────────────────────────────────────────────────────────────
  const loadGroupMembers = useCallback(async () => {
    const accountId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    if (!accountId || !convId) return;
    setLoadingGroupMembers(true);
    try {
      const res = await getZaloGroupMembers(accountId, convId);
      if (selectedAccountIdRef.current === accountId && selectedConvIdRef.current === convId) {
        setGroupMembers(res);
      }
    } catch (e) {
      if (selectedAccountIdRef.current === accountId && selectedConvIdRef.current === convId) {
        showToast(e instanceof Error ? e.message : "Quét thành viên nhóm thất bại", false);
      }
    } finally {
      if (selectedAccountIdRef.current === accountId && selectedConvIdRef.current === convId) {
        setLoadingGroupMembers(false);
      }
    }
  }, [showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Sticker — tìm theo từ khoá thật (searchZaloStickers, giống ô tìm sticker
  // trong app Zalo) qua <ZaloStickerPicker> (component tự quản lý state tìm
  // kiếm riêng), hook chỉ cần expose hành động GỬI.
  // ─────────────────────────────────────────────────────────────────────────────
  const sendStickerAction = useCallback(async (sticker: { id: number; cateId: number }) => {
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    if (!accId || !convId) return;
    setIsSending(true);
    try {
      await sendZaloSticker(accId, convId, { id: sticker.id, cate_id: sticker.cateId });
      await loadMessages(accId, convId, true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gửi sticker thất bại", false);
    } finally {
      setIsSending(false);
    }
  }, [loadMessages, showToast]);

  const sendVoiceAction = useCallback(async (audioBlob: Blob, durationSec?: number, filename = "voice-note.m4a") => {
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    if (!accId || !convId) return false;

    const tempId = `optimistic_${Date.now()}`;
    const now = new Date();
    const timeText = now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const durLabel = durationSec && durationSec > 0 ? ` (${Math.round(durationSec)}s)` : "";
    const contentLabel = `[Tin nhắn thoại${durLabel}]`;
    const blobUrl = URL.createObjectURL(audioBlob);

    const optimisticMsg: ZaloLibraryMessage = {
      id: tempId,
      user_id: accId,
      source_message_id: tempId,
      sender_id: myZaloUid || "me",
      sender_name: "Bạn",
      is_sent: true,
      is_deleted: false,
      type: "chat.voice",
      content: contentLabel,
      timestamp_text: "Vừa xong",
      time_text: timeText,
      ts: now.getTime(),
      staff_name: user?.name || "Bạn",
      staff_avatar: (user as any)?.avatar_url || (user as any)?.avatar || null,
      staff_email: user?.email || null,
      assets: [
        {
          url: blobUrl,
          storage_url: blobUrl,
          filename,
          filesize: audioBlob.size,
          mime_type: audioBlob.type || "audio/mp4",
          status: "ready" as const,
        } as any,
      ],
    };

    setIsSending(true);
    setMessages((prev) => [...prev, optimisticMsg]);
    setConversations((prev) =>
      prev.map((c) =>
        c.conversation_id === convId
          ? { ...c, latest_content: contentLabel, unread_count: 0 }
          : c,
      ),
    );

    try {
      await sendZaloVoiceMessage(accId, convId, audioBlob, filename, {
        durationSec,
        staffName: user?.name,
        staffAvatar: (user as any)?.avatar_url || (user as any)?.avatar,
      });
      await loadMessages(accId, convId, true);
      void loadConversations(accId, true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zalo-kpi-updated"));
      }
      showToast("Đã gửi tin nhắn thoại Zalo thành công!", true);
      return true;
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      const msg = e instanceof Error ? e.message : "Gửi tin nhắn thoại thất bại";
      showToast(msg, false);
      return false;
    } finally {
      setIsSending(false);
    }
  }, [myZaloUid, user, loadMessages, loadConversations, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Derived: map conversations to FB style ZaloConv
  // ─────────────────────────────────────────────────────────────────────────────
  const activeConvs = useMemo<ZaloConv[]>(() => {
    return conversations.map((c) => {
      const isCust = isCustomerSet.has(c.conversation_id);
      const isHidden = hiddenConvIds.has(c.conversation_id);
      const hasUnread = (c.unread_count ?? 0) > 0;

      let timeStr = "";
      if (c.latest_message_at) {
        const num = Number(c.latest_message_at);
        const ms = !Number.isNaN(num) ? (num < 1e11 ? num * 1000 : num) : Date.parse(c.latest_message_at);
        if (ms && !Number.isNaN(ms)) {
          timeStr = new Date(ms).toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        }
      }

      const rawName = (c.conversation_name || "").trim();
      const lastSender = (c.latest_sender_name || "").trim();
      const isBadName = !rawName || ["markee", "zalo", "user", "dm", "người dùng zalo"].includes(rawName.toLowerCase()) || rawName === c.conversation_id;
      const finalName = (isBadName && lastSender && !["markee", "__me__", "me", "bạn", "ban"].includes(lastSender.toLowerCase()))
        ? lastSender
        : (rawName || lastSender || "Người dùng Zalo");

      const isSelfSender = ["__me__", "me", "bạn", "ban"].includes(lastSender.toLowerCase());
      return {
        conv_id: c.conversation_id,
        name: finalName,
        preview: formatConversationSidebarPreview(c, { isSelf: isSelfSender }),
        latest_sender_name: c.latest_sender_name ?? null,
        unread: hasUnread,
        time: timeStr,
        is_customer: isCust,
        pushed_to_zalo: true,
        deleted: isHidden,
        archived: isHidden,
        avatar_url: c.avatar_url ?? null,
        zalo_kpi_status: c.zalo_kpi_status ?? null,
        zalo_kpi_source: c.zalo_kpi_source ?? null,
        zalo_kpi_confirmed: c.zalo_kpi_confirmed ?? null,
        zalo_kpi_is_lead: c.zalo_kpi_is_lead ?? null,
        zalo_kpi_post_url: c.zalo_kpi_post_url ?? null,
        zalo_kpi_phone: c.zalo_kpi_phone ?? null,
      };
    });
  }, [conversations, isCustomerSet, hiddenConvIds]);

  const filtered = useMemo<ZaloConv[]>(() => {
    let list = activeConvs.filter(c => !c.archived);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.conv_id.toLowerCase().includes(q));
    }

    if (filter === "unread") {
      list = list.filter(c => c.unread);
    } else if (filter === "customer") {
      list = list.filter(c => c.is_customer);
    } else if (filter === "need_reply") {
      list = list.filter(c => c.unread || c.preview !== "");
    } else if (filter === "need_verify") {
      list = list.filter(c => suggestedConvIds.has(c.conv_id));
    }

    return list;
  }, [activeConvs, filter, searchQuery, suggestedConvIds]);

  const archives = useMemo<ZaloArchiveConv[]>(() => {
    return activeConvs
      .filter(c => c.archived)
      .map(c => ({
        conv_id: c.conv_id,
        name: c.name,
        preview: c.preview,
        time: c.time,
        note: customerNotes[c.conv_id] || "",
        is_customer: c.is_customer,
        pushed_to_zalo: c.pushed_to_zalo,
      }));
  }, [activeConvs, customerNotes]);

  const getAccountStatus = useCallback(
    (accountId: string): ZaloAccountOnlineStatus => {
      if (!accountId) return "offline";
      if (onlineAccounts.has(accountId)) return "online";
      if (expiredAccounts.has(accountId)) return "expired";
      for (const group of memberAccounts) {
        const accInfo = group.accounts.find((a) => a.account_id === accountId);
        if (accInfo) {
          if (accInfo.listener?.auth_expired || accInfo.status === "session_expired") return "expired";
          if (accInfo.listener?.connected || (accInfo.listener?.running && accInfo.status === "confirmed" && !accInfo.listener?.auth_expired)) {
            return "online";
          }
          if (accInfo.listener?.running) return "connecting";
          return "offline";
        }
      }
      // Khi đang nạp accounts và chưa tìm thấy account, trả về connecting để không bị giật banner offline
      if (loadingAccounts) return "connecting";
      return "offline";
    },
    [expiredAccounts, onlineAccounts, memberAccounts, loadingAccounts]
  );

  const selectedAccountInfo = useMemo<ZaloAccountInfo | undefined>(() => {
    return allSessions.find((a) => a.account_id === selectedAccountId);
  }, [allSessions, selectedAccountId]);

  const selectedOwnerInfo = useMemo<ZaloMemberAccount | undefined>(() => {
    return memberAccounts.find((g) => g.ownerId === selectedOwnerId);
  }, [memberAccounts, selectedOwnerId]);

  return {
    role,
    leaderEmail,

    // Teams
    teams,
    selectedTeamId,
    setSelectedTeamId,
    loadingTeams,
    ownerNames,
    ownerEmails,

    // Sessions & Accounts
    sessions: allSessions,
    loadingAccounts,
    memberAccounts,
    acc: selectedAccountId,
    accOnline: onlineAccounts.has(selectedAccountId),
    accPaused: false,
    needRelogin: Boolean(selectedAccountId && expiredAccounts.has(selectedAccountId) && !onlineAccounts.has(selectedAccountId)),
    connErr: false,
    extInstalled: true,

    // Modern filters
    viewMode,
    setViewMode,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,

    // Conversations lists
    conversations, // raw ZaloConversationSummary[] - dùng cho ZaloForwardModal (props đúng shape này)
    activeConvs,
    filtered,
    archives,
    loadingConvs,
    loadingArchives: false,

    // KPI verification states
    verifiedConvIds,
    suggestedConvIds,
    customerNotes,
    savingNoteConv,
    isCustomerSet,

    // Messages
    openConv: selectedConvId,
    openChat: onSelectConv,
    openArchive: onSelectConv,
    messages,
    loadingMessages,
    loadingChat: loadingMessages,
    loadingFresh: false,
    messageTotal,
    hasMoreMessages,
    loadingMore,
    loadMoreMessages,

    // Actions
    scan,
    scanning,
    mark,
    saveArchive,
    saveCustomerNote,
    onSuggestKpi: suggestKpi,
    onToggleShare: toggleShare,
    onRevokeAllShares: revokeAllShares,
    onSyncConversationMessages: syncConversationMessages,
    isSyncingMessages,
    onBulkVerifyKpi: bulkVerifyKpi,
    verifyConvKpi,
    bulkSuggestKpi,
    sendMessage,
    reply,
    setReply,
    sendReply,
    isSending,
    sendError,
    setSendError,

    // Zalo tập trung: recall / mentions / friend-status / sticker / group-scan
    pendingMentions,
    setPendingMentions,
    recallMessage,
    replyingTo,
    setReplyingTo,
    friendStatus,
    loadingFriendStatus,
    friendActionLoading,
    sendFriendRequestAction,
    acceptFriendRequestAction,
    groupMembers,
    loadingGroupMembers,
    loadGroupMembers,
    sendStickerAction,
    sendVoiceAction,
    sseConnected,
    myZaloUid,
    reactToMessage,

    // Account stats
    selectedOwnerId,
    selectedAccountId,
    selectedAccountInfo,
    selectedOwnerInfo,
    onSelectAccount,
    getAccountStatus,
    onlineAccounts,
    expiredAccounts,
    kpiByOwner,
    targetDate,
    setTargetDate,
    isBulkVerifying,
    isBulkSuggesting,
    isReconnecting,
    reconnectAccount,

    // Toast
    toast,
    showToast,
    error,
    setError,
    archiveReading: viewMode === "archive",
    setArchiveReading: (val: boolean) => setViewMode(val ? "archive" : "inbox"),
    refreshConversations: () => loadConversations(selectedAccountId),
    refreshAccounts: loadMemberAccounts,
  };
}

