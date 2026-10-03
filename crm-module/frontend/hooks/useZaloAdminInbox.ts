"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  getZaloAccounts,
  getZaloConversations,
  getZaloConversationMessages,
  sendZaloMessage,
  sendZaloMessageWithFiles,
  buildZaloRealtimeStreamUrl,
  markZaloConversationAsRead,
  syncZaloRecentConversations,
  syncZaloConversationMessages,
  type BuildZaloRealtimeStreamOptions,
} from "@/services/zaloCrawlerService";
import { allPlatformKpiService, zaloInboxShareService } from "@/services/all-platform.service";
import type {
  ZaloAccountInfo,
  ZaloConversationSummary,
  ZaloLibraryMessage,
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
  unread: boolean;
  time: string;
  is_customer: boolean;
  pushed_to_zalo: boolean;
  deleted: boolean;
  archived?: boolean;
  archived_at?: string;
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

const ACCOUNTS_POLL_MS = 15_000;
const CONVERSATIONS_POLL_MS = 5_000;
const MESSAGES_POLL_MS = 3_000;

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
  const [messageTotal, setMessageTotal] = useState(0);

  // ── Send Reply ──────────────────────────────────────────────────────────────
  const [reply, setReply] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Online status ───────────────────────────────────────────────────────────
  const [onlineAccounts, setOnlineAccounts] = useState<Set<string>>(new Set());
  const [expiredAccounts, setExpiredAccounts] = useState<Set<string>>(new Set());

  // ── KPI stats & weekly progress ─────────────────────────────────────────────
  const [kpiByOwner, setKpiByOwner] = useState<Record<string, number>>({});
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [isBulkVerifying, setIsBulkVerifying] = useState(false);
  const [isBulkSuggesting, setIsBulkSuggesting] = useState(false);

  // ── Scanning ────────────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);

  // ── Error & Toast ───────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [savingNoteConv, setSavingNoteConv] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const sseRef = useRef<EventSource | null>(null);
  const convPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accountPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedAccountIdRef = useRef(selectedAccountId);
  const selectedConvIdRef = useRef(selectedConvId);

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
    if (selectedTeamMembers.length === 0) {
      setMemberAccounts([]);
      return;
    }
    setLoadingAccounts(true);
    try {
      const results = await Promise.allSettled(
        selectedTeamMembers.map(async (member) => {
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
        })
      );

      const loaded: ZaloMemberAccount[] = [];
      const onlineSet = new Set<string>();
      const expiredSet = new Set<string>();

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          loaded.push(r.value);
          for (const acc of r.value.accounts) {
            if (acc.listener?.connected) onlineSet.add(acc.account_id);
            if (acc.listener?.auth_expired) expiredSet.add(acc.account_id);
          }
        }
      }

      setMemberAccounts(loaded);
      setOnlineAccounts(onlineSet);
      setExpiredAccounts(expiredSet);
    } catch (e) {
      console.error("loadMemberAccounts error", e);
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedTeamMembers]);

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
    setMessages([]);
    setConversations([]);
  }, [memberAccounts]);

  const loadConversations = useCallback(async (accountId: string) => {
    if (!accountId) return;
    setLoadingConvs(true);
    try {
      const res = await getZaloConversations(accountId);
      if (res) {
        const list = Array.isArray(res.conversations) ? res.conversations : [];
        setConversations(list);
      }
    } catch (e) {
      console.error("loadConversations error", e);
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => {
    if (convPollRef.current) clearInterval(convPollRef.current);
    if (!selectedAccountId) return;

    void loadConversations(selectedAccountId);
    convPollRef.current = setInterval(() => {
      void loadConversations(selectedAccountIdRef.current);
    }, CONVERSATIONS_POLL_MS);

    return () => {
      if (convPollRef.current) clearInterval(convPollRef.current);
    };
  }, [selectedAccountId, loadConversations]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Select conversation → load messages
  // ─────────────────────────────────────────────────────────────────────────────
  const onSelectConv = useCallback((convId: string) => {
    setSelectedConvId(convId);
    setMessages([]);
  }, []);

  const loadMessages = useCallback(async (accountId: string, convId: string, append = false) => {
    if (!accountId || !convId) return;
    if (!append) setLoadingMessages(true);
    try {
      const res = await getZaloConversationMessages(accountId, convId, 50, 0);
      if (res?.messages) {
        setMessages(res.messages);
        setMessageTotal(res.total ?? res.messages.length);
      }
    } catch (e) {
      console.error("loadMessages error", e);
    } finally {
      setLoadingMessages(false);
    }
    // Mark as read
    try { await markZaloConversationAsRead(accountId, convId); } catch { /* no-op */ }
  }, []);

  useEffect(() => {
    if (msgPollRef.current) clearInterval(msgPollRef.current);
    if (!selectedAccountId || !selectedConvId) return;

    void loadMessages(selectedAccountId, selectedConvId);
    msgPollRef.current = setInterval(() => {
      void loadMessages(selectedAccountIdRef.current, selectedConvIdRef.current, true);
    }, MESSAGES_POLL_MS);

    return () => {
      if (msgPollRef.current) clearInterval(msgPollRef.current);
    };
  }, [selectedAccountId, selectedConvId, loadMessages]);

  // ─────────────────────────────────────────────────────────────────────────────
  // SSE realtime for selected account
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (!selectedAccountId) return;

    try {
      const streamOptions: BuildZaloRealtimeStreamOptions = { userId: selectedAccountId };
      const url = buildZaloRealtimeStreamUrl(streamOptions);
      const es = new EventSource(url);
      sseRef.current = es;

      es.addEventListener("zalo-message", () => {
        void loadMessages(selectedAccountIdRef.current, selectedConvIdRef.current, true);
        void loadConversations(selectedAccountIdRef.current);
      });

      es.addEventListener("auth_expired", () => {
        setExpiredAccounts((prev) => new Set([...prev, selectedAccountId]));
        setOnlineAccounts((prev) => {
          const next = new Set(prev);
          next.delete(selectedAccountId);
          return next;
        });
      });

      es.onerror = () => {
        // SSE auto-reconnects
      };
    } catch {
      // SSE not supported
    }

    return () => {
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [selectedAccountId, loadMessages, loadConversations]);

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

  // ─────────────────────────────────────────────────────────────────────────────
  // Send reply message
  // ─────────────────────────────────────────────────────────────────────────────
  const sendReply = useCallback(async () => {
    const text = reply.trim();
    if (!text) return;
    setReply("");
    setIsSending(true);
    setSendError(null);
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    try {
      await sendZaloMessage(accId, convId, { text });
      await loadMessages(accId, convId, true);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Gửi tin nhắn thất bại");
      setReply(text); // restore
    } finally {
      setIsSending(false);
    }
  }, [reply, loadMessages]);

  const sendMessage = useCallback(async (text: string, files?: File[]) => {
    const accId = selectedAccountIdRef.current;
    const convId = selectedConvIdRef.current;
    if (!accId || !convId) return;
    setIsSending(true);
    setSendError(null);
    try {
      if (files && files.length > 0) {
        await sendZaloMessageWithFiles(accId, convId, text, files);
      } else {
        await sendZaloMessage(accId, convId, { text });
      }
      await loadMessages(accId, convId, true);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Gửi tin nhắn thất bại");
    } finally {
      setIsSending(false);
    }
  }, [loadMessages]);

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

      return {
        conv_id: c.conversation_id,
        name: c.conversation_name || "Người dùng Zalo",
        preview: c.latest_content || "",
        unread: hasUnread,
        time: timeStr,
        is_customer: isCust,
        pushed_to_zalo: true,
        deleted: isHidden,
        archived: isHidden,
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
      if (expiredAccounts.has(accountId)) return "expired";
      if (onlineAccounts.has(accountId)) return "online";
      for (const group of memberAccounts) {
        const accInfo = group.accounts.find((a) => a.account_id === accountId);
        if (accInfo?.listener?.running) return "connecting";
      }
      return "offline";
    },
    [expiredAccounts, onlineAccounts, memberAccounts]
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
    needRelogin: expiredAccounts.has(selectedAccountId),
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
    bulkSuggestKpi,
    sendMessage,
    reply,
    setReply,
    sendReply,
    isSending,
    sendError,

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
