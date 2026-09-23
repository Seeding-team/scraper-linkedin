"use client";

/**
 * Cách A: UI nằm trong dashboard, gọi thẳng MARKEE SERVICE (inbox server-side Playwright + cookie).
 *
 * Luồng: chọn acc (có cookie) -> "Quét ngay" -> hiện hội thoại CHƯA ĐỌC
 *   -> đánh dấu "Là khách" -> "Mở chat" (tải full) -> trả lời / đẩy Zalo.
 */

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { Inbox as InboxIcon, TriangleAlert, Lock, Info, CirclePause, Moon, RefreshCw } from "lucide-react";
import { provisionExtension, pingExtension } from "@/lib/markee-ext-provision";
import { fbFetch, fbHeaders, getFbProvisionConfig } from "@/lib/markee-fb-api";
import { API_BASE_URL } from "@/lib/env";
import { idbSetThread, idbGetAllThreadsForAcc, idbSetConvs, idbGetConvs, idbPruneOld } from "@/lib/inbox-cache";
import TeamAccountTree from "@/components/all-platform/inbox/TeamAccountTree";
import InboxModernLayout from "@/components/all-platform/inbox/InboxModernLayout";
import { allPlatformKpiService } from "@/services/all-platform.service";

interface Session { user_id: string; fb_user_id?: string; label?: string; owner?: string; online?: boolean; inbox_enabled?: boolean; status?: string; }
interface Conv { conv_id: string; name: string; preview: string; unread: boolean; time: string; is_customer: boolean; pushed_to_zalo: boolean; deleted: boolean; archived?: boolean; archived_at?: string; }
interface ArchiveConv { conv_id: string; name: string; preview?: string; time?: string; archived_at?: string; last_saved_at?: string; archive_reason?: string; outcome?: string; note?: string; messages_count?: number; archived_by_name?: string; is_customer?: boolean; pushed_to_zalo?: boolean; }
interface Msg { from: "me" | "them"; text: string; time: string; clientId?: string; }
interface UserRow { id?: string; email?: string; name?: string; }
interface TeamRow { id?: string; name_team?: string; id_leader?: string; leader_name?: string; leader_email?: string; members?: UserRow[]; }

const ACTIVE_INBOX_DAYS = 7;
const SESSION_POLL_ACTIVE_MS = 12000;
const SESSION_POLL_HIDDEN_MS = 30000;
const CONVERSATION_POLL_ACTIVE_MS = 5000;
const CONVERSATION_POLL_HIDDEN_MS = 30000;
const THREAD_DELTA_POLL_MS = 5000;
const SILENT_SCAN_MS = 45000;

async function fetchJsonWithRetry(url: string, attempts = 3): Promise<Record<string, unknown>> {
  let lastData: Record<string, unknown> | null = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (data) lastData = data;
      if (res.ok && data && data.success !== false) return data;
    } catch {
      lastData = null;
    }
    if (i < attempts - 1) {
      await new Promise(resolve => window.setTimeout(resolve, 350 * (i + 1)));
    }
  }
  return lastData || {};
}

function foldVietnamese(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function isRecentMessengerTime(time: string, days = ACTIVE_INBOX_DAYS): boolean {
  const s = foldVietnamese(time.trim());
  if (!s) return true;
  if (/(vua xong|just now|hom qua|yesterday)/i.test(s)) return true;
  if (/^\d+\s*(m|min|phut|h|gio|hour)$/i.test(s)) return true;
  const m = s.match(/(\d+)\s*(ngay|day|d|tuan|week|w|thg|thang|month|nam|year)\b/i);
  if (!m) return false;
  const n = Number(m[1] || 0);
  const unit = m[2] || "";
  if (["ngay", "day", "d"].includes(unit)) return n <= days;
  return false;
}

function convListSignature(conv: Conv): string {
  return `${conv.conv_id}|${conv.preview || ""}|${conv.time || ""}|${conv.unread ? 1 : 0}`;
}

function normalizeMsgText(value: string): string {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function exactMsgKey(message: Msg): string {
  return `${message.from}|${normalizeMsgText(message.text)}|${(message.time || "").trim()}|${message.clientId || ""}`;
}

const MESSAGE_ECHO_LOOKBACK = 8;

function isSendingStatus(time: string): boolean {
  const raw = (time || "").toLowerCase();
  const value = foldVietnamese(time || "");
  return (
    raw.includes("đang gửi") ||
    raw.includes("đã gửi") ||
    raw.includes("dang gui") ||
    raw.includes("da gui") ||
    raw.includes("sent") ||
    value.includes("dang gui") ||
    value.includes("da gui") ||
    value.includes("sent")
  );
}

function isOppositeEcho(current: Msg, previous: Msg, isAdjacent: boolean): boolean {
  if (!current.text || !previous.text || current.from === previous.from) return false;
  if (normalizeMsgText(current.text) !== normalizeMsgText(previous.text)) return false;
  if (current.clientId || previous.clientId) return true;
  if (isSendingStatus(current.time) || isSendingStatus(previous.time) || !current.time || !previous.time) return true;
  // Messenger/extension can echo our just-sent text back as an incoming bubble.
  // When the same text appears immediately after our outgoing bubble, keep the outgoing one.
  return previous.from === "me" && current.from === "them" && isAdjacent;
}

function isSameDirectionPendingEcho(current: Msg, previous: Msg): boolean {
  if (!current.text || !previous.text || current.from !== previous.from) return false;
  if (normalizeMsgText(current.text) !== normalizeMsgText(previous.text)) return false;
  if (current.clientId && previous.clientId && current.clientId !== previous.clientId) return false;
  if (current.clientId || previous.clientId) return true;
  return !current.time || !previous.time;
}

function preferCurrentThreadMessage(current: Msg, previous: Msg): boolean {
  const currentStable = !!current.time && !isSendingStatus(current.time);
  const previousStable = !!previous.time && !isSendingStatus(previous.time);
  if (currentStable !== previousStable) return currentStable;
  return !previous.clientId && !!current.clientId;
}

function normalizeThreadMessages(list: Msg[]): Msg[] {
  const out: Msg[] = [];
  const exact = new Set<string>();

  for (const raw of list || []) {
    const msg: Msg = {
      from: raw?.from === "me" ? "me" : "them",
      text: (raw?.text || "").trim(),
      time: raw?.time || "",
      clientId: raw?.clientId,
    };
    if (!msg.text) continue;

    const exactKey = exactMsgKey(msg);
    if (exact.has(exactKey)) continue;

    let sameDirectionIndex = -1;
    for (let i = out.length - 1, looked = 0; i >= 0 && looked < MESSAGE_ECHO_LOOKBACK; i -= 1, looked += 1) {
      if (isSameDirectionPendingEcho(msg, out[i])) {
        sameDirectionIndex = i;
        break;
      }
    }
    if (sameDirectionIndex >= 0) {
      if (preferCurrentThreadMessage(msg, out[sameDirectionIndex])) {
        exact.delete(exactMsgKey(out[sameDirectionIndex]));
        const replacement = { ...msg, clientId: msg.clientId || out[sameDirectionIndex].clientId };
        out[sameDirectionIndex] = replacement;
        exact.add(exactMsgKey(replacement));
      }
      continue;
    }

    let echoIndex = -1;
    for (let i = out.length - 1, looked = 0; i >= 0 && looked < MESSAGE_ECHO_LOOKBACK; i -= 1, looked += 1) {
      if (isOppositeEcho(msg, out[i], i === out.length - 1)) {
        echoIndex = i;
        break;
      }
    }
    if (echoIndex >= 0) {
      if (msg.from === "me" && out[echoIndex]?.from === "them") {
        exact.delete(exactMsgKey(out[echoIndex]));
        const replacement = { ...msg, clientId: msg.clientId || out[echoIndex].clientId };
        out[echoIndex] = replacement;
        exact.add(exactMsgKey(replacement));
      }
      continue;
    }

    out.push(msg);
    exact.add(exactKey);
  }

  return out;
}

function mergeThreadMessages(current: Msg[], incoming: Msg[]): Msg[] {
  if (!current?.length) return normalizeThreadMessages(incoming || []);
  if (!incoming?.length) return normalizeThreadMessages(current || []);
  return normalizeThreadMessages([...(current || []), ...(incoming || [])]);
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Đang tải...</div>}>
      <InboxPageContent />
    </Suspense>
  );
}

function InboxPageContent() {
  const { user } = useAppAuth();
  const searchParams = useSearchParams();
  const owner = user?.id || "";
  const role = user?.role || "member";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [rawSessions, setRawSessions] = useState<Session[]>([]); // TOÀN BỘ acc (chưa lọc theo scope) — dùng cho picker "thêm tài khoản khác"
  const [extraAccountIds, setExtraAccountIds] = useState<Set<string>>(new Set()); // acc admin/leader tự chọn thêm ngoài scope mặc định
  const [showAddAccountPicker, setShowAddAccountPicker] = useState(false);
  const [acc, setAcc] = useState("");
  const [scopeReady, setScopeReady] = useState(false);
  const [allowedOwnerIds, setAllowedOwnerIds] = useState<Set<string> | null>(new Set());
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({});
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  // Danh sach hoi thoai DAY DU (khong loc 7 ngay) - chi tai khi can (mo "Theo doi nguoi cu"),
  // tranh tai toan bo lich su moi lan doi acc (co the rat nang ve sau vi da tat auto-delete).
  const [allConvsFull, setAllConvsFull] = useState<Conv[]>([]);
  const [loadingAllConvs, setLoadingAllConvs] = useState(false);
  const allConvsFullAccRef = useRef<string>("");
  const [archives, setArchives] = useState<ArchiveConv[]>([]);
  const [customerNotes, setCustomerNotes] = useState<Record<string, string>>({});
  const [savingNoteConv, setSavingNoteConv] = useState("");
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "customer" | "need_reply" | "need_verify">("all");
  const [viewMode, setViewMode] = useState<"inbox" | "archive">("inbox");
  const [loadingArchives, setLoadingArchives] = useState(false);
  const [verifiedConvIds, setVerifiedConvIds] = useState<Set<string>>(new Set());
  // conv_id -> thoi diem xac nhan Lead (ISO string) - de hien "Da xac nhan KPI
  // tuan X" dung tuan LUC XAC NHAN, khong phai tuan dang xem lai hoi thoai.
  const [verifiedConvDates, setVerifiedConvDates] = useState<Record<string, string>>({});
  // conv_id -> created_at cua dong KPI Inbox tuong ung - de hien "KPI Inbox
  // tinh vao tuan X" cho BAT KY hoi thoai nao da duoc tinh (khong chi Lead).
  const [inboxKpiWeekDates, setInboxKpiWeekDates] = useState<Record<string, string>>({});
  const [suggestedConvIds, setSuggestedConvIds] = useState<Set<string>>(new Set()); // local state for optimistic updates
  const [archiveReading, setArchiveReading] = useState(false);
  const [openConv, setOpenConv] = useState(() => searchParams.get("conv") || "");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [threadLastFrom, setThreadLastFrom] = useState<Record<string, Msg["from"]>>({});
  const [reply, setReply] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingFresh, setLoadingFresh] = useState(false);
  const [needRelogin, setNeedRelogin] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [needsPinMessage, setNeedsPinMessage] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [connErr, setConnErr] = useState(false);
  const openConvRef = useRef("");
  const msgsRef = useRef<Msg[]>([]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrollConvRef = useRef("");
  const openConvListSigRef = useRef("");
  const autoThreadRefreshAtRef = useRef<Record<string, number>>({});
  const selectedAccRef = useRef("");
  const convsRequestSeqRef = useRef(0);
  const archivesRequestSeqRef = useRef(0);
  const threadRequestSeqRef = useRef(0);
  const clientCacheRef = useRef<Map<string, Msg[]>>(new Map());
  const loadedAtRef = useRef<Map<string, string | null>>(new Map());
  // Chống chồng lệnh silent scan (1 lệnh đang chạy thì bỏ qua lần kế)
  const scanInFlightRef = useRef(false);
  const lastSilentScanAtRef = useRef<Record<string, number>>({});
  const sessionsInFlightRef = useRef(false);
  const convsInFlightRef = useRef(false);
  const sessionsErrorStreakRef = useRef(0);
  const convsErrorStreakRef = useRef(0);
  const convsAbortRef = useRef<AbortController | null>(null);
  const replyInFlightRef = useRef(false);
  const threadDeltaInFlightRef = useRef(false);
  const lastFocusLoadAtRef = useRef(0);
  // Preview hội thoại lần cuối nhìn thấy — để phát hiện có tin mới mà không cần quét lại mù quáng
  const lastSeenPreviewRef = useRef<Record<string, string>>({});

  const showToast = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadAllConvsFull = useCallback(async () => {
    if (!acc || loadingAllConvs) return;
    if (allConvsFullAccRef.current === acc && allConvsFull.length > 0) return;
    setLoadingAllConvs(true);
    try {
      const r = await fbFetch(`/inbox/conversations?user_id=${encodeURIComponent(acc)}&all=1`);
      const d = await r.json();
      if (r.ok) {
        allConvsFullAccRef.current = acc;
        setAllConvsFull(d.conversations || []);
      }
    } catch {
      // im lang: "Theo doi nguoi cu" se chi tim duoc trong danh sach da tai
    } finally {
      setLoadingAllConvs(false);
    }
  }, [acc, loadingAllConvs, allConvsFull.length]);

  const resetAccountView = (uid: string) => {
    allConvsFullAccRef.current = "";
    setAllConvsFull([]);
    convsAbortRef.current?.abort();
    convsInFlightRef.current = false;
    convsErrorStreakRef.current = 0;
    selectedAccRef.current = uid;
    convsRequestSeqRef.current += 1;
    archivesRequestSeqRef.current += 1;
    threadRequestSeqRef.current += 1;
    setOpenConv(""); openConvRef.current = "";
    openConvListSigRef.current = "";
    lastScrollConvRef.current = "";
    setArchiveReading(false);
    setMsgs([]); msgsRef.current = [];
    setReply("");
    setThreadLastFrom({});
    setConvs([]); setArchives([]);
    setCustomerNotes({});
    setNeedRelogin(false);
    lastSeenPreviewRef.current = {};
    setLoadingChat(false); setLoadingFresh(false); setLoadingArchives(false);
    setLoadingConvs(!!uid);
  };

  // Lưu cache thread vào CẢ RAM (clientCacheRef) lẫn IndexedDB (bền qua reload).
  // loadedAt: nếu không truyền, giữ lại loaded_at đã biết của hội thoại đó.
  const saveThreadCache = useCallback((convId: string, list: Msg[], loadedAt?: string | null) => {
    const cleanList = normalizeThreadMessages(list);
    clientCacheRef.current.set(convId, cleanList);
    const lastFrom = cleanList[cleanList.length - 1]?.from;
    if (lastFrom) {
      setThreadLastFrom(prev => prev[convId] === lastFrom ? prev : { ...prev, [convId]: lastFrom });
    }
    const la = loadedAt === undefined ? (loadedAtRef.current.get(convId) ?? null) : loadedAt;
    loadedAtRef.current.set(convId, la);
    void idbSetThread(acc, convId, cleanList, la);
  }, [acc]);

  // Hover preload: khi chuột di vào hội thoại, tải trước thread vào cache (không block UI).
  const hoverConv = useCallback((conv_id: string) => {
    if (clientCacheRef.current.has(conv_id)) return;
    const accountId = selectedAccRef.current || acc;
    if (!accountId) return;
    void fbFetch(`/inbox/thread?user_id=${encodeURIComponent(accountId)}&conv_id=${encodeURIComponent(conv_id)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.messages?.length || selectedAccRef.current !== accountId) return;
        const preloaded = normalizeThreadMessages(d.messages as Msg[]);
        const current = clientCacheRef.current.get(conv_id);
        if (!current || current.length < preloaded.length) {
          saveThreadCache(conv_id, preloaded, d.loaded_at ?? null);
        }
      })
      .catch(() => {});
  }, [acc, saveThreadCache]);

  // Dọn cache thread cũ (>30 ngày) 1 lần khi vào trang để IndexedDB không phình mãi.
  useEffect(() => { void idbPruneOld(); }, []);

  // Fetch verified conv IDs when user changes
  useEffect(() => {
    if (user?.email) {
      void fetchVerifiedConvIds();
    }
  }, [user?.email]);

  // Chọn 1 tài khoản: xóa NGAY hộp thư + chat của acc cũ và bật loading (tránh "trơ trơ" hiện data cũ).
  const selectAcc = (uid: string) => {
    if (uid === acc) return;
    setAcc(uid);
    resetAccountView(uid);
  };

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    const myName = user?.name || user?.email || owner;
    const myEmail = user?.email || "";
    const buildMap = (rows: UserRow[]): Record<string, string> => {
      const m: Record<string, string> = { [owner]: myName };
      for (const u of rows || []) {
        if (u?.id) m[u.id] = u.name || u.email || u.id;
      }
      return m;
    };
    // Song song voi ownerNames - can email that su cua chu tai khoan dang xem
    // de xac nhan KPI cho DUNG member, khong bi nham thanh email cua nguoi
    // dang dang nhap (leader/admin) khi ho dang xem tai khoan cua member khac.
    const buildEmailMap = (rows: UserRow[]): Record<string, string> => {
      const m: Record<string, string> = { [owner]: myEmail };
      for (const u of rows || []) {
        if (u?.id && u?.email) m[u.id] = u.email;
      }
      return m;
    };
    (async () => {
      setScopeReady(false);
      setTeams([]);
      setAllowedOwnerIds(new Set());
      if (role === "admin") {
        try {
          const [usersRes, teamsRes] = await Promise.all([
            fetchJsonWithRetry(`${API_BASE_URL}/api/all-platform/users/all-profiles`, 2),
            fetchJsonWithRetry(`${API_BASE_URL}/api/all-platform/teams`, 4),
          ]);
          const usersData = usersRes || {};
          const teamsData = teamsRes || {};
          if (!cancelled) {
            const rows = Array.isArray(usersData?.data) ? usersData.data : [];
            setOwnerNames(buildMap(rows));
            setOwnerEmails(buildEmailMap(rows));
            setTeams(Array.isArray(teamsData?.data) ? teamsData.data : []);
            setAllowedOwnerIds(null);
            setScopeReady(true);
          }
        } catch {
          if (!cancelled) {
            setOwnerNames({ [owner]: myName });
            setOwnerEmails({ [owner]: myEmail });
            setTeams([]);
            setAllowedOwnerIds(null);
            setScopeReady(true);
          }
        }
        return;
      }
      if (role === "leader") {
        try {
          const r = await fetch(`${API_BASE_URL}/api/all-platform/teams/members?leader_id=${encodeURIComponent(owner)}`, { credentials: "include" });
          const d = await r.json().catch(() => ({}));
          const rows: UserRow[] = Array.isArray(d?.data) ? d.data : [];
          const ids = rows.map(m => m?.id).filter(Boolean);
          const all = Array.from(new Set([owner, ...ids])) as string[];
          if (!cancelled) {
            setAllowedOwnerIds(new Set(all));
            setOwnerNames(buildMap(rows));
            setOwnerEmails(buildEmailMap(rows));
            setTeams([{ id: `leader-${owner}`, name_team: "Team của tôi", id_leader: owner, leader_name: myName, members: rows }]);
            setScopeReady(true);
          }
        } catch {
          if (!cancelled) {
            setAllowedOwnerIds(new Set([owner]));
            setOwnerNames({ [owner]: myName });
            setOwnerEmails({ [owner]: myEmail });
            setTeams([{ id: `leader-${owner}`, name_team: "Team của tôi", id_leader: owner, leader_name: myName, members: [] }]);
            setScopeReady(true);
          }
        }
        return;
      }
      // member
      if (!cancelled) {
        setAllowedOwnerIds(new Set([owner]));
        setOwnerNames({ [owner]: myName });
        setOwnerEmails({ [owner]: myEmail });
        setTeams([]);
        setScopeReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [owner, role, user?.email, user?.name]);

  // Inbox đọc DOM Messenger ĐÃ GIẢI MÃ trên máy seeder (giải được e2ee) -> cần extension ONLINE.
  useEffect(() => {
    if (!owner) return;
    (async () => {
      const { installed } = await pingExtension();
      setExtInstalled(installed);
      const myLabel = user?.name || user?.email || owner;
      if (installed) {
        const cfg = await getFbProvisionConfig();
        await provisionExtension({ serverUrl: cfg.serverUrl, owner, apiKey: cfg.extensionApiKey, label: myLabel });
      }
    })();
  }, [owner, user?.name, user?.email]);

  const sessionInScope = useCallback((session: Session) => {
    if (!scopeReady) return false;
    if (extraAccountIds.has(session.user_id)) return true; // admin/leader tự thêm ngoài scope
    if (allowedOwnerIds === null) return true;
    return !!session.owner && allowedOwnerIds.has(String(session.owner));
  }, [allowedOwnerIds, scopeReady, extraAccountIds]);

  // Nạp danh sách acc admin/leader tự chọn thêm (lưu theo trình duyệt, key theo owner hiện tại)
  useEffect(() => {
    if (!owner) return;
    try {
      const raw = localStorage.getItem(`markee_inbox_extra_accounts_${owner}`);
      setExtraAccountIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setExtraAccountIds(new Set());
    }
  }, [owner]);

  const toggleExtraAccount = useCallback((userId: string) => {
    setExtraAccountIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      if (owner) {
        try { localStorage.setItem(`markee_inbox_extra_accounts_${owner}`, JSON.stringify(Array.from(next))); } catch {}
      }
      return next;
    });
  }, [owner]);

  const loadSessions = useCallback(async () => {
    if (!scopeReady) return;
    if (sessionsInFlightRef.current) return;
    sessionsInFlightRef.current = true;
    try {
      // Nguồn acc = /sessions (BỀN, đọc từ file cookie) -> acc OFFLINE (nhân viên tắt máy) VẪN HIỆN
      const r = await fbFetch("/sessions");
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail || "sessions failed");
      const mapped: Session[] = (d.sessions || []).map((s: Session) => ({
        ...s,
        status: s.online ? (s.inbox_enabled === false ? "paused" : "online") : "offline",
      }));
      setRawSessions(mapped);
      const list: Session[] = mapped.filter(sessionInScope);
      setSessions(list);
      setConnErr(false);
      sessionsErrorStreakRef.current = 0;
      // Tự chọn: ưu tiên giữ acc đang chọn; nếu chưa có thì chọn acc ONLINE đầu, không có online thì acc đầu
      setAcc(prev => {
        if (prev && (list.length === 0 || list.some(e => e.user_id === prev))) {
          selectedAccRef.current = prev;
          return prev;
        }
        const firstOnline = list.find(e => e.status === "online");
        const next = (firstOnline || list[0])?.user_id || "";
        if (next !== prev) {
          resetAccountView(next);
        }
        return next;
      });
    } catch {
      sessionsErrorStreakRef.current += 1;
      setConnErr(true);
    } finally {
      sessionsInFlightRef.current = false;
    }
  }, [scopeReady, sessionInScope]);

  const loadConvs = useCallback(async () => {
    if (!acc) return;
    if (convsInFlightRef.current) return;
    const requestAcc = acc;
    const requestSeq = ++convsRequestSeqRef.current;
    const controller = new AbortController();
    convsInFlightRef.current = true;
    convsAbortRef.current = controller;
    if (sessions.length > 0 && !sessions.some(s => s.user_id === requestAcc)) {
      if (selectedAccRef.current !== requestAcc || convsRequestSeqRef.current !== requestSeq) return;
      setConvs([]);
      setOpenConv(""); openConvRef.current = "";
      setMsgs([]); msgsRef.current = [];
      setLoadingConvs(false);
      convsInFlightRef.current = false;
      if (convsAbortRef.current === controller) convsAbortRef.current = null;
      return;
    }
    try {
      const r = await fbFetch(`/inbox/conversations?user_id=${encodeURIComponent(requestAcc)}`, { signal: controller.signal });
      const d = await r.json();
      if (selectedAccRef.current !== requestAcc || convsRequestSeqRef.current !== requestSeq) return;
      if (!r.ok) {
        convsErrorStreakRef.current += 1;
        return;
      }
      const list: Conv[] = d.conversations || [];
      setConvs(list);
      setNeedRelogin(!!d.needs_relogin);
      setNeedsPin(!!d.needs_pin);
      setNeedsPinMessage(d.needs_pin_message || "");
      convsErrorStreakRef.current = 0;
      void idbSetConvs(requestAcc, list);
      // Backend giờ tự tính KPI Inbox cho MỌI hội thoại ngay khi tải danh sách
      // (không cần mở từng cái) - refetch trạng thái KPI sau 1 nhịp để UI cập
      // nhật kịp các dòng KPI mới vừa được ghi ở lần load này.
      setTimeout(() => { void fetchVerifiedConvIds(); }, 1500);

      // Background preload: tải trước thread cho 3 hội thoại chưa đọc đầu tiên
      // Không block UI, không hiện spinner — khi user bấm vào sẽ hiện ngay từ cache
      const toPreload = list
        .filter(c => !c.deleted && c.unread && !clientCacheRef.current.has(c.conv_id))
        .slice(0, 3);
      for (const pConv of toPreload) {
        void fbFetch(`/inbox/thread?user_id=${encodeURIComponent(requestAcc)}&conv_id=${encodeURIComponent(pConv.conv_id)}`)
          .then(r => r.json())
          .then(d2 => {
            if (!d2.messages?.length || selectedAccRef.current !== requestAcc) return;
            const preloaded = normalizeThreadMessages(d2.messages as Msg[]);
            const current = clientCacheRef.current.get(pConv.conv_id);
            if (!current || current.length < preloaded.length) {
              clientCacheRef.current.set(pConv.conv_id, preloaded);
              loadedAtRef.current.set(pConv.conv_id, d2.loaded_at ?? null);
              const lastFrom = preloaded[preloaded.length - 1]?.from;
              if (lastFrom) setThreadLastFrom(prev => ({ ...prev, [pConv.conv_id]: lastFrom }));
              void idbSetThread(requestAcc, pConv.conv_id, preloaded, d2.loaded_at ?? null);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) convsErrorStreakRef.current += 1;
    }
    finally {
      if (convsAbortRef.current === controller) {
        convsAbortRef.current = null;
        convsInFlightRef.current = false;
      }
      if (selectedAccRef.current === requestAcc && convsRequestSeqRef.current === requestSeq) {
        setLoadingConvs(false);
      }
    }
  }, [acc, sessions]);

  const loadArchives = useCallback(async () => {
    if (!acc) return;
    const requestAcc = acc;
    const requestSeq = ++archivesRequestSeqRef.current;
    setLoadingArchives(true);
    try {
      const r = await fbFetch(`/inbox/archive?user_id=${encodeURIComponent(requestAcc)}&limit=200`);
      const d = await r.json();
      if (selectedAccRef.current !== requestAcc || archivesRequestSeqRef.current !== requestSeq) return;
      const list: ArchiveConv[] = d.archives || [];
      setArchives(list);
      setCustomerNotes(prev => {
        const next = { ...prev };
        for (const item of list) {
          if (item?.conv_id && typeof item.note === "string") next[item.conv_id] = item.note;
        }
        return next;
      });
    } catch { /* ignore */ }
    finally {
      if (selectedAccRef.current === requestAcc && archivesRequestSeqRef.current === requestSeq) {
        setLoadingArchives(false);
      }
    }
  }, [acc]);

  useEffect(() => {
    if (!acc) return;
    let cancelled = false;
    clientCacheRef.current = new Map();
    loadedAtRef.current = new Map();
    (async () => {
      const [threads, cachedConvs] = await Promise.all([
        idbGetAllThreadsForAcc<Msg>(acc),
        idbGetConvs<Conv>(acc),
      ]);
      if (cancelled) return;
      const lastFromByConv: Record<string, Msg["from"]> = {};
      for (const [cid, t] of Object.entries(threads)) {
        const cachedMessages = t.messages || [];
        clientCacheRef.current.set(cid, cachedMessages);
        loadedAtRef.current.set(cid, t.loaded_at ?? null);
        const lastFrom = cachedMessages[cachedMessages.length - 1]?.from;
        if (lastFrom) lastFromByConv[cid] = lastFrom;
      }
      setThreadLastFrom(lastFromByConv);
      if (cachedConvs?.length) setConvs(prev => (prev.length ? prev : cachedConvs));
    })();
    return () => { cancelled = true; };
  }, [acc]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      await loadSessions();
      if (stopped) return;
      const base = document.hidden ? SESSION_POLL_HIDDEN_MS : SESSION_POLL_ACTIVE_MS;
      const backoff = Math.min(sessionsErrorStreakRef.current * 6000, 30000);
      timer = setTimeout(tick, base + backoff);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadSessions]);
  useEffect(() => {
    if (!acc) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      await loadConvs();
      if (stopped) return;
      const base = document.hidden ? CONVERSATION_POLL_HIDDEN_MS : CONVERSATION_POLL_ACTIVE_MS;
      const backoff = Math.min(convsErrorStreakRef.current * 5000, 25000);
      timer = setTimeout(tick, base + backoff);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [acc, loadConvs]);
  useEffect(() => {
    if (!acc) return;
    loadArchives();
  }, [acc, loadArchives]);

  useEffect(() => {
    if (!acc) return;
    const evtSource = new EventSource(`${API_BASE_URL}/api/all-platform/sse/dashboard?user_id=${encodeURIComponent(acc)}`);
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === "threads_updated") {
          loadConvs();
        } else if (data.event === "messages_updated") {
          if (data.conv_id) {
            hoverConv(data.conv_id);
            if (openConvRef.current === data.conv_id) {
              setMsgs(prev => {
                const updated = mergeThreadMessages(prev, data.messages || []);
                msgsRef.current = updated;
                return updated;
              });
            }
          }
        }
      } catch (err) {}
    };
    return () => evtSource.close();
  }, [acc, loadConvs, hoverConv]);

  useEffect(() => {
    if (!acc || viewMode !== "archive") return;
    loadArchives();
  }, [acc, viewMode, loadArchives]);

  useEffect(() => {
    if (!acc) return;
    const isOnline = sessions.find(s => s.user_id === acc)?.status === "online";
    if (!isOnline || needRelogin) return;
    const silentScan = () => {
      if (document.hidden) return;
      if (scanInFlightRef.current) return;
      const now = Date.now();
      const last = lastSilentScanAtRef.current[acc] || 0;
      if (now - last < SILENT_SCAN_MS) return;
      lastSilentScanAtRef.current[acc] = now;
      scanInFlightRef.current = true;
      fbFetch("/inbox/scan", { method: "POST", headers: fbHeaders(), body: JSON.stringify({ user_id: acc }) })
        .catch(() => {})
        .finally(() => { scanInFlightRef.current = false; });
    };
    silentScan();
    const t = setInterval(silentScan, SILENT_SCAN_MS);
    return () => clearInterval(t);
  }, [acc, sessions, needRelogin]);

  // Khi user quay lại tab (window focus), refresh hộp thư — debounce 4s tránh gọi liên tục khi alt-tab
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusLoadAtRef.current < 4000) return;
      lastFocusLoadAtRef.current = now;
      void loadConvs();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadConvs]);

  // Phát hiện KHÁCH mới nhắn → badge tab + sound + browser notification
  const prevConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { prevConvIdsRef.current = new Set(); }, [acc]);
  useEffect(() => {
    if (!convs.length) return;
    const customerUnread = convs.filter(c => !c.deleted && c.unread && c.is_customer);
    const newCustomers = customerUnread.filter(c => !prevConvIdsRef.current.has(c.conv_id));
    if (newCustomers.length > 0 && prevConvIdsRef.current.size > 0) {
      // Sound notification (Web Audio API)
      try {
        const ctx = new AudioContext();
        [0, 0.18].forEach(delay => {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = delay === 0 ? 784 : 1047; osc.type = "sine";
          gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
          osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.3);
        });
      } catch { /* ignore */ }
      // Browser notification
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        newCustomers.forEach(c => new Notification(`Khách nhắn: ${c.name || ""}`, { body: c.preview || "Có tin nhắn mới", icon: "/favicon.ico", tag: c.conv_id }));
      } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
    prevConvIdsRef.current = new Set(convs.map(c => c.conv_id));
    // Tab title badge — chỉ đếm khách chưa đọc
    const count = customerUnread.length;
    document.title = count > 0 ? `(${count}) Khách mới — Inbox` : "Inbox FB — Seeding";
    return () => { document.title = "Seeding"; };
  }, [convs]);

  async function scan() {
    if (!acc) return showToast("Chưa chọn tài khoản", false);
    const selected = sessions.find(s => s.user_id === acc);
    if (selected?.status === "paused") return showToast("Inbox realtime đang tạm dừng trên extension — bật lại trước khi quét.", false);
    if (selected?.status !== "online") return showToast("Tài khoản đang offline — chưa quét được.", false);
    if (needRelogin) return showToast("Cookie tài khoản đã hết hạn — đăng nhập lại trước khi quét.", false);
    setScanning(true);
    try {
      const r = await fbFetch("/inbox/scan_deep", { method: "POST", headers: fbHeaders(), body: JSON.stringify({ user_id: acc }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        showToast("Đang quét sâu... extension tải nội dung tin nhắn 3 ngày gần nhất (1-2 phút).", true);
        // Poll nhiều lần để bắt kết quả từng thread khi extension gửi về dần
        [8000, 16000, 30000, 45000, 60000].forEach(ms => setTimeout(loadConvs, ms));
      } else {
        showToast(d.detail || "Lỗi quét", false);
      }
    } catch { showToast("Không kết nối được Markee", false); }
    setScanning(false);
  }

  async function mark(conv_id: string, field: string, value: boolean) {
    try {
      const r = await fbFetch("/inbox/mark", { method: "POST", headers: fbHeaders(), body: JSON.stringify({ user_id: acc, conv_id, field, value }) });
      if (r.ok) {
        setConvs(prev => prev.map(c => c.conv_id === conv_id ? { ...c, [field]: value } : c));
        // Tu dong xac nhan KPI Inbox ngay khi hoi thoai duoc danh dau "la khach" -
        // bo han buoc de xuat/xac nhan thu cong (theo yeu cau leader ban ron).
        // Leader/member van xem duoc trang thai va bam "Xac nhan Inbox" thu cong
        // neu can sua/bo sung rieng le.
        if (field === "is_customer" && value === true) {
          void autoConfirmInboxKpi(conv_id);
        }
      }
      else { const d = await r.json().catch(() => ({})); showToast(d.detail || "Lỗi", false); }
    } catch { showToast("Không kết nối được", false); }
  }

  async function autoConfirmInboxKpi(conv_id: string) {
    if (!acc || !user?.email) return;
    try {
      await allPlatformKpiService.syncFbInbox({
        leader_email: user.email,
        member_email: selectedAccountOwnerEmail || user.email,
        conv_ids: [conv_id],
        user_id: acc,
        is_lead: false,
      });
      await fetchVerifiedConvIds();
    } catch {
      // Im lang - day la tu dong hoa nen, khong lam gian doan thao tac chinh
      // (leader/member van thay trang thai qua tab KPI, co the bam xac nhan
      // thu cong lai neu tu dong bi loi).
    }
  }

  async function saveArchive(conv_id: string, hide = false) {
    try {
      const r = await fbFetch("/inbox/archive", {
        method: "POST",
        headers: fbHeaders(),
        body: JSON.stringify({
          user_id: acc,
          conv_id,
          archive_reason: hide ? "hidden_from_inbox" : "saved_customer",
          mark_customer: !hide,
          hide,
          note: customerNotes[conv_id] || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(d.detail || "Lỗi lưu trữ", false); return; }
      setConvs(prev => prev.map(c => c.conv_id === conv_id ? { ...c, archived: true, is_customer: hide ? c.is_customer : true, deleted: hide ? true : c.deleted } : c));
      // "Luu khach" (khong hide) cung dan den is_customer = true - tu dong xac
      // nhan KPI Inbox luon, giong het hanh vi trong mark() o tren.
      if (!hide) {
        void autoConfirmInboxKpi(conv_id);
      }
      setArchives(prev => {
        const entry = d.archive as ArchiveConv | undefined;
        if (!entry) return prev;
        return [entry, ...prev.filter(x => x.conv_id !== conv_id)];
      });
      if (typeof (d.archive as ArchiveConv | undefined)?.note === "string") {
        setCustomerNotes(prev => ({ ...prev, [conv_id]: (d.archive as ArchiveConv).note || "" }));
      }
      if (hide && openConvRef.current === conv_id) {
        setOpenConv(""); openConvRef.current = ""; openConvListSigRef.current = ""; setArchiveReading(false); setMsgs([]); msgsRef.current = [];
      }
      showToast(hide ? "Đã ẩn khỏi hộp thư và lưu trữ" : "Đã lưu khách vào kho lưu trữ", true);
      if (viewMode === "archive") loadArchives();
    } catch { showToast("Không kết nối được", false); }
  }

  async function saveCustomerNote(conv_id: string, note: string) {
    const accountId = selectedAccRef.current || acc;
    if (!accountId || !conv_id) return;
    const previous = customerNotes[conv_id] || "";
    const cleanNote = note.trim();
    setSavingNoteConv(conv_id);
    setCustomerNotes(prev => ({ ...prev, [conv_id]: cleanNote }));
    try {
      const currentConv = convs.find(c => c.conv_id === conv_id);
      const currentArchive = archives.find(a => a.conv_id === conv_id);
      const r = await fbFetch("/inbox/archive", {
        method: "POST",
        headers: fbHeaders(),
        body: JSON.stringify({
          user_id: accountId,
          conv_id,
          archive_reason: currentArchive?.archive_reason || "customer_note",
          mark_customer: false,
          hide: false,
          note: cleanNote,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCustomerNotes(prev => ({ ...prev, [conv_id]: previous }));
        showToast(d.detail || "Không lưu được ghi chú", false);
        return;
      }
      const entry = d.archive as ArchiveConv | undefined;
      setArchives(prev => {
        const fallback: ArchiveConv = {
          ...(currentArchive || {}),
          conv_id,
          name: currentArchive?.name || currentConv?.name || conv_id,
          preview: currentArchive?.preview || currentConv?.preview || "",
          time: currentArchive?.time || currentConv?.time || "",
          archive_reason: currentArchive?.archive_reason || "customer_note",
          note: cleanNote,
          last_saved_at: new Date().toISOString(),
          is_customer: currentArchive?.is_customer ?? currentConv?.is_customer,
          pushed_to_zalo: currentArchive?.pushed_to_zalo ?? currentConv?.pushed_to_zalo,
        };
        const saved = entry || fallback;
        return [saved, ...prev.filter(x => x.conv_id !== conv_id)];
      });
      setCustomerNotes(prev => ({ ...prev, [conv_id]: typeof entry?.note === "string" ? entry.note : cleanNote }));
      showToast(cleanNote ? "Đã lưu ghi chú khách" : "Đã xóa ghi chú khách", true);
    } catch {
      setCustomerNotes(prev => ({ ...prev, [conv_id]: previous }));
      showToast("Không kết nối được", false);
    } finally {
      setSavingNoteConv(prev => prev === conv_id ? "" : prev);
    }
  }

  async function syncFbInboxKpi(payload: {
    leader_email: string;
    member_email: string;
    conv_ids: string[];
    user_id: string;
    is_lead: boolean;
  }) {
    try {
      await allPlatformKpiService.syncFbInbox(payload);
      // Cap nhat UI ngay (khong doi refetch) - nut "Xac nhan Lead" phai doi
      // trang thai tuc thi sau khi bam, khong bat nguoi dung phai F5 moi thay.
      if (payload.is_lead) {
        setVerifiedConvIds(prev => new Set([...prev, ...payload.conv_ids]));
        const now = new Date().toISOString();
        setVerifiedConvDates(prev => {
          const next = { ...prev };
          payload.conv_ids.forEach(id => { next[id] = now; });
          return next;
        });
      }
      // Van refetch nen (best-effort) de dong bo lai voi server, phong khi co
      // sai lech (vd nguoi khac cung xac nhan) - khong chan UI, khong throw.
      void fetchVerifiedConvIds();
    } catch {
      showToast("Lỗi xác nhận KPI inbox", false);
      throw new Error("KPI sync failed");
    }
  }

  async function fetchVerifiedConvIds() {
    if (!user?.email) return;
    try {
      const res = await allPlatformKpiService.getVerifiedConvIds(user.email);
      if (res.success) {
        // confirmed = đã được leader duyệt
        setVerifiedConvIds(new Set(res.data?.confirmed_conv_ids || []));
        setVerifiedConvDates(res.data?.confirmed_at_by_conv || {});
        setInboxKpiWeekDates(res.data?.inbox_confirmed_at_by_conv || {});
        // pending = đã đề xuất nhưng chưa được duyệt
        setSuggestedConvIds(new Set(res.data?.pending_conv_ids || []));
      }
    } catch (e) {
      console.warn("Failed to fetch verified conv IDs:", e);
    }
  }

  async function openArchive(conv_id: string) {
    const accountId = selectedAccRef.current || acc;
    const requestSeq = ++threadRequestSeqRef.current;
    setArchiveReading(true);
    setOpenConv(conv_id); openConvRef.current = conv_id; openConvListSigRef.current = ""; setMsgs([]); msgsRef.current = []; setLoadingChat(true); setLoadingFresh(false);
    try {
      const r = await fbFetch(`/inbox/archive/thread?user_id=${encodeURIComponent(accountId)}&conv_id=${encodeURIComponent(conv_id)}`);
      const d = await r.json();
      if (selectedAccRef.current !== accountId || threadRequestSeqRef.current !== requestSeq || openConvRef.current !== conv_id) return;
      const archivedMsgs = normalizeThreadMessages(d.messages || []);
      setMsgs(archivedMsgs); msgsRef.current = archivedMsgs;
    } catch { showToast("Không tải được bản lưu", false); }
    finally {
      if (selectedAccRef.current === accountId && threadRequestSeqRef.current === requestSeq && openConvRef.current === conv_id) {
        setLoadingChat(false);
      }
    }
  }

  // Hỏi lại mỗi 3s tới khi extension trả nội dung. Hiện tin NGAY khi có (theo số tin tăng),
  const pollFreshThread = useCallback(async function pollFreshThreadInner(conv_id: string, prevLoadedAt: string | null, attemptsLeft: number) {
    if (openConvRef.current !== conv_id) return;
    try {
      const r = await fbFetch(`/inbox/thread?user_id=${encodeURIComponent(acc)}&conv_id=${encodeURIComponent(conv_id)}`);
      const d = await r.json();
      const fresh: Msg[] = d.messages || [];
      // Có nhiều tin hơn hiện tại → hiện ngay (kể cả khi loaded_at chưa đổi)
      if (fresh.length > msgsRef.current.length) {
        const merged = mergeThreadMessages(msgsRef.current, fresh);
        setMsgs(merged); msgsRef.current = merged;
        saveThreadCache(conv_id, merged, d.loaded_at ?? undefined);
        setLoadingChat(false);
      }
      if (d.loaded_at && d.loaded_at !== prevLoadedAt) {
        setLoadingChat(false); setLoadingFresh(false); return;
      }
    } catch { /* ignore, thử lại */ }
    if (attemptsLeft === 10 && msgsRef.current.length === 0) {
      fbFetch("/inbox/thread", { method: "POST", headers: fbHeaders(), body: JSON.stringify({ user_id: acc, conv_id }) }).catch(() => {});
    }
    if (attemptsLeft <= 1) { setLoadingChat(false); setLoadingFresh(false); return; }
    setTimeout(() => pollFreshThreadInner(conv_id, prevLoadedAt, attemptsLeft - 1), 3000);
  }, [acc, saveThreadCache]);


  async function openChat(conv_id: string) {
    const accountId = selectedAccRef.current || acc;
    const requestSeq = ++threadRequestSeqRef.current;
    setArchiveReading(false);
    setOpenConv(conv_id); openConvRef.current = conv_id;
    // Tinh KPI Inbox tu dong ngay khi MO hoi thoai - goi rieng, khong phu thuoc
    // nhanh cache/scan ben duoi (hoi thoai da doc/da co cache se SKIP goi
    // /inbox/thread POST, khien auto-count bi bo lo du user vua bam mo that).
    void fbFetch("/inbox/mark-opened", { method: "POST", headers: fbHeaders(), body: JSON.stringify({ user_id: accountId, conv_id }) }).catch(() => {});
    // Backend tinh KPI (background task) khong co tin hieu dong bo ve ket qua,
    // nen refetch inboxKpiWeekDates sau 1 nhip de UI bat kip dong KPI moi vua
    // duoc ghi (thay vi phai F5 tay).
    setTimeout(() => { if (openConvRef.current === conv_id) void fetchVerifiedConvIds(); }, 1500);
    const currentConv = convs.find(c => c.conv_id === conv_id);
    openConvListSigRef.current = currentConv ? convListSignature(currentConv) : "";

    // Capture signals TRƯỚC KHI thay đổi state
    const isUnread = !!currentConv?.unread;
    const convPreview = currentConv?.preview || "";
    const previewChanged = conv_id in lastSeenPreviewRef.current
      && lastSeenPreviewRef.current[conv_id] !== convPreview;
    lastSeenPreviewRef.current[conv_id] = convPreview;

    setMsgs([]); msgsRef.current = []; setLoadingChat(true); setLoadingFresh(false);

    // Optimistic mark-as-read: cập nhật UI ngay, không chờ server
    if (isUnread) {
      setConvs(prev => prev.map(c => c.conv_id === conv_id ? { ...c, unread: false } : c));
    }

    // 1. Hiện cache ngay — KHÔNG bật loadingFresh (không hiện "Đang cập nhật...")
    const clientCached = clientCacheRef.current.get(conv_id);
    if (clientCached?.length) {
      setMsgs(clientCached); msgsRef.current = clientCached; setLoadingChat(false);
    }

    // 2. Lấy cache từ server disk (có thể nhiều tin hơn RAM)
    let prevLoadedAt: string | null = null;
    try {
      const r0 = await fbFetch(`/inbox/thread?user_id=${encodeURIComponent(accountId)}&conv_id=${encodeURIComponent(conv_id)}`);
      const d0 = await r0.json().catch(() => ({}));
      if (selectedAccRef.current !== accountId || threadRequestSeqRef.current !== requestSeq || openConvRef.current !== conv_id) return;
      prevLoadedAt = d0.loaded_at || null;
      loadedAtRef.current.set(conv_id, prevLoadedAt);
      if (d0.messages?.length) {
        const merged = mergeThreadMessages(msgsRef.current, d0.messages);
        setMsgs(merged); msgsRef.current = merged;
        saveThreadCache(conv_id, merged, prevLoadedAt);
        setLoadingChat(false);
      }
    } catch { /* ignore */ }

    // 3. Quyết định có cần quét extension không (signal-based)
    // Chỉ quét khi: chưa có cache | hội thoại có tin chưa đọc | preview vừa đổi (tin mới đến)
    const shouldScan = msgsRef.current.length === 0 || isUnread || previewChanged;
    if (!shouldScan) {
      setLoadingChat(false); setLoadingFresh(false); return;
    }

    // 4. Kích hoạt quét extension — chỉ bật loadingFresh khi đã có data để hiện
    if (msgsRef.current.length > 0) setLoadingFresh(true);
    try {
      const r = await fbFetch("/inbox/thread", { method: "POST", headers: fbHeaders(), body: JSON.stringify({ user_id: accountId, conv_id }) });
      if (selectedAccRef.current !== accountId || threadRequestSeqRef.current !== requestSeq || openConvRef.current !== conv_id) return;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        showToast(d.detail || "Không tải được hội thoại", false);
        setLoadingChat(false); setLoadingFresh(false); return;
      }
      pollFreshThread(conv_id, prevLoadedAt, 20);
    } catch { setLoadingChat(false); setLoadingFresh(false); }
  }

  async function fetchThread(conv_id: string) {
    if (openConvRef.current !== conv_id) return;
    const accountId = selectedAccRef.current || acc;
    try {
      const r = await fbFetch(`/inbox/thread?user_id=${encodeURIComponent(accountId)}&conv_id=${encodeURIComponent(conv_id)}`);
      const d = await r.json();
      if (selectedAccRef.current !== accountId || openConvRef.current !== conv_id) return;
      const fetched: Msg[] = d.messages || [];
      // Luon merge (khong con dieu kien "fetched dai hon moi merge") - mergeThreadMessages da
      // tu dedup/union an toan, gate cu co the bo sot tin da gui khi ban scan tra ve it hon tam thoi.
      if (fetched.length) {
        const merged = mergeThreadMessages(msgsRef.current, fetched);
        setMsgs(merged); msgsRef.current = merged;
        saveThreadCache(conv_id, merged, d.loaded_at ?? undefined);
      }
    } catch { /* ignore */ }
    finally {
      if (selectedAccRef.current === accountId && openConvRef.current === conv_id) {
        setLoadingFresh(false);
      }
    }
  }

  useEffect(() => {
    if (!openConv || !acc) return;
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        await new Promise(r => window.setTimeout(r, THREAD_DELTA_POLL_MS));
        if (cancelled) break;
        if (document.hidden) continue;
        if (threadDeltaInFlightRef.current) continue;
        threadDeltaInFlightRef.current = true;
        const reqN = msgsRef.current.length;
        try {
          const url = reqN === 0
            ? `/inbox/thread?user_id=${encodeURIComponent(acc)}&conv_id=${encodeURIComponent(openConv)}`
            : `/inbox/thread?user_id=${encodeURIComponent(acc)}&conv_id=${encodeURIComponent(openConv)}&since_n=${reqN}`;
          const r = await fbFetch(url);
          const d = await r.json();
          if (cancelled) break;
          if (!Array.isArray(d.messages) || d.messages.length === 0) continue;
          // Nếu list đã thay đổi (poll chính vừa thay) thì bỏ delta cũ — vòng sau sẽ bắt đúng since_n.
          if (msgsRef.current.length !== reqN) continue;
          if (reqN === 0) {
            const fresh = normalizeThreadMessages(d.messages);
            setMsgs(fresh); msgsRef.current = fresh; saveThreadCache(openConv, fresh, d.loaded_at ?? undefined);
          } else {
            setMsgs(prev => {
              const next = mergeThreadMessages(prev, d.messages);
              msgsRef.current = next;
              saveThreadCache(openConv, next, d.loaded_at ?? undefined);
              return next;
            });
          }
        } catch { /* ignore */ } finally {
          threadDeltaInFlightRef.current = false;
        }
      }
    };

    void poll();
    return () => { cancelled = true; threadDeltaInFlightRef.current = false; };
  }, [openConv, acc, saveThreadCache]);

  useEffect(() => {
    if (!openConv) return;
    const el = chatScrollRef.current;
    const changedConv = lastScrollConvRef.current !== openConv;
    const lastMsg = msgs[msgs.length - 1];
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    const shouldScroll = changedConv || nearBottom || lastMsg?.from === "me";
    lastScrollConvRef.current = openConv;
    if (!shouldScroll) return;
    requestAnimationFrame(() => {
      const node = chatScrollRef.current;
      if (!node) return;
      node.scrollTo({ top: node.scrollHeight, behavior: changedConv ? "auto" : "smooth" });
    });
  }, [openConv, msgs.length, msgs]);

  async function sendReply() {
    const text = reply.trim();
    if (!text || !openConv) return;
    if (replyInFlightRef.current) { showToast("Tin truoc dang gui, doi xac nhan roi gui tiep.", false); return; }
    if (archiveReading) { showToast("Đang xem bản lưu trữ, mở inbox live để trả lời", false); return; }
    const convIdForSend = openConv;
    const selectedSession = sessions.find(s => s.user_id === acc);
    const accOnline = selectedSession?.status === "online";
    if (selectedSession?.status === "paused") { showToast("Inbox realtime đang tạm dừng trên extension — bật lại trước khi gửi.", false); return; }
    if (!accOnline) { showToast("Tài khoản đang offline (máy nhân viên chưa mở) — chưa gửi được.", false); return; }
    if (needRelogin) { showToast("Cookie tài khoản đã hết hạn — đăng nhập lại trước khi gửi.", false); return; }
    replyInFlightRef.current = true;
    setReply("");
    const clientId = `reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Msg = { from: "me", text, time: "Đang gửi...", clientId };
    setMsgs(prev => {
      const next = normalizeThreadMessages([...prev, optimistic]);
      msgsRef.current = next;
      return next;
    });
    const setStatus = (t: string) => {
      if (openConvRef.current !== convIdForSend) return;
      setMsgs(prev => {
        const next = normalizeThreadMessages(prev.map(m => {
          const sameOptimistic =
            m === optimistic ||
            m.clientId === clientId ||
            (m.from === "me" && normalizeMsgText(m.text) === normalizeMsgText(text) && isSendingStatus(m.time));
          return sameOptimistic ? { ...m, time: t, clientId: m.clientId || clientId } : m;
        }));
        msgsRef.current = next;
        return next;
      });
    };
    try {
      const r = await fbFetch("/inbox/reply", { method: "POST", headers: fbHeaders(), body: JSON.stringify({ user_id: acc, conv_id: convIdForSend, text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(d.detail || "Lỗi gửi", false); setStatus("Gửi lỗi"); replyInFlightRef.current = false; return; }
      const cmd = d.command_id;
      if (!cmd) { setStatus("Đã gửi (đang xác nhận)"); replyInFlightRef.current = false; return; }
      pollReplyStatus(cmd, setStatus, 12, acc, convIdForSend, text, () => { replyInFlightRef.current = false; });
    } catch {
      showToast("Không kết nối được", false); setStatus("Gửi lỗi");
      replyInFlightRef.current = false;
    }
  }

  async function pollReplyStatus(cmd: string, setStatus: (t: string) => void, attemptsLeft: number, accountId: string, convId: string, sentText: string, finish: () => void) {
    try {
      const r = await fbFetch(`/inbox/reply_status?command_id=${encodeURIComponent(cmd)}&user_id=${encodeURIComponent(accountId)}`);
      const d = await r.json();
      if (d.done) {
        if (d.sent) {
          setStatus("Đã gửi");
          setConvs(prev => {
            const next = prev.map(c => c.conv_id === convId ? { ...c, preview: sentText, unread: false, time: "Vừa xong" } : c);
            const sentConv = next.find(c => c.conv_id === convId);
            return sentConv ? [sentConv, ...next.filter(c => c.conv_id !== convId)] : next;
          });
          if (openConvRef.current === convId) {
            saveThreadCache(convId, msgsRef.current);
            setLoadingFresh(true);
            setTimeout(() => { void fetchThread(convId); }, 1200);
            setTimeout(() => { void fetchThread(convId); }, 7000);
          }
          showToast("Đã gửi tin thành công", true);
        }
        else { setStatus("Gửi thất bại"); showToast("FB chưa gửi được — thử lại", false); }
        finish();
        return;
      }
    } catch { /* ignore, thử lại */ }
    if (attemptsLeft <= 1) { setStatus("Đã gửi (chưa rõ kết quả)"); finish(); return; }
    setTimeout(() => pollReplyStatus(cmd, setStatus, attemptsLeft - 1, accountId, convId, sentText, finish), 2000);
  }

  // chưa có cache → tạm dựa vào cờ unread (chưa đọc thường là khách vừa nhắn).
  const needsReply = (c: Conv): boolean => {
    if (c.unread) return true;
    if (threadLastFrom[c.conv_id]) return threadLastFrom[c.conv_id] === "them";
    return c.unread;
  };

  const isActiveInboxConv = (c: Conv): boolean =>
    c.is_customer ||
    c.pushed_to_zalo ||
    c.conv_id === openConv ||
    isRecentMessengerTime(c.time || "");

  const activeConvs = convs.filter(c => !c.deleted && (filter === "all" || isActiveInboxConv(c)));
  const visible = activeConvs.filter(c => (
    filter === "unread" ? c.unread :
    filter === "customer" ? c.is_customer :
    filter === "need_reply" ? needsReply(c) :
    filter === "need_verify" ? (!verifiedConvIds.has(c.conv_id) && !suggestedConvIds.has(c.conv_id)) :
    true
  ));
  // Nổi ưu tiên lên đầu: cần trả lời > chưa đọc > khách; giữ thứ tự gốc trong cùng nhóm.
  const rank = (c: Conv) => (needsReply(c) ? 4 : 0) + (c.unread ? 2 : 0) + (c.is_customer ? 1 : 0);
  const filtered = visible
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(b.c) - rank(a.c) || a.i - b.i)
    .map(x => x.c);
  // Nhãn chip = TÊN NHÂN VIÊN (map từ owner id). Fallback: label cũ -> fb_id. Để admin/leader biết acc CỦA AI.
  const accLabel = (s: Session) => (s.owner && ownerNames[s.owner]) || s.label || s.user_id;
  const selectedSession = sessions.find(s => s.user_id === acc);
  const accOnline = selectedSession?.status === "online";
  const accPaused = selectedSession?.status === "paused";
  // Email cua CHU tai khoan FB dang xem (vd Le Hai) - khac voi user?.email (nguoi
  // dang dang nhap, vd leader) khi leader dang xem tai khoan cua 1 member khac.
  // Dung cho xac nhan/hien thi KPI dung nguoi, khong bi gan nham cho leader.
  const selectedAccountOwnerEmail =
    (selectedSession?.owner && ownerEmails[selectedSession.owner]) || user?.email || "";

  useEffect(() => {
    if (!openConv || archiveReading) return;
    const current = convs.find(c => c.conv_id === openConv);
    if (!current) return;
    const sig = convListSignature(current);
    const previousSig = openConvListSigRef.current;
    openConvListSigRef.current = sig;
    if (!previousSig || previousSig === sig) return;

    if (!accOnline || needRelogin) return;

    const now = Number(new Date());
    const last = autoThreadRefreshAtRef.current[openConv] || 0;
    if (now - last < 12000) return;
    autoThreadRefreshAtRef.current[openConv] = now;
    const prevLoadedAt = loadedAtRef.current.get(openConv) ?? null;
    setLoadingFresh(true);
    fbFetch("/inbox/thread", {
      method: "POST",
      headers: fbHeaders(),
      body: JSON.stringify({ user_id: acc, conv_id: openConv }),
    })
      .then(r => {
        if (r.ok) pollFreshThread(openConv, prevLoadedAt, 8);
        else setLoadingFresh(false);
      })
      .catch(() => setLoadingFresh(false));
  }, [convs, openConv, archiveReading, accOnline, needRelogin, acc, pollFreshThread]);

  if (process.env.NEXT_PUBLIC_INBOX_LEGACY_UI !== "1") {
    return (
      <InboxModernLayout
        role={role}
        owner={owner}
        sessions={sessions}
        rawSessions={rawSessions}
        allowedOwnerIds={allowedOwnerIds}
        extraAccountIds={extraAccountIds}
        toggleExtraAccount={toggleExtraAccount}
        ownerNames={ownerNames}
        teams={teams}
        acc={acc}
        accOnline={!!accOnline}
        accPaused={!!accPaused}
        needRelogin={needRelogin}
        needsPin={needsPin}
        needsPinMessage={needsPinMessage}
        connErr={connErr}
        extInstalled={extInstalled}
        scanning={scanning}
        loadingConvs={loadingConvs}
        loadingArchives={loadingArchives}
        loadingChat={loadingChat}
        loadingFresh={loadingFresh}
        archiveReading={archiveReading}
        viewMode={viewMode}
        filter={filter}
        activeConvs={activeConvs}
        filtered={filtered}
        allConvs={allConvsFull}
        loadingAllConvs={loadingAllConvs}
        onRequestAllConvs={loadAllConvsFull}
        archives={archives}
        openConv={openConv}
        msgs={msgs}
        reply={reply}
        customerNotes={customerNotes}
        savingNoteConv={savingNoteConv}
        toast={toast}
        chatScrollRef={chatScrollRef}
        selectAcc={selectAcc}
        scan={scan}
        setViewMode={setViewMode}
        setArchiveReading={setArchiveReading}
        setFilter={setFilter}
        setReply={setReply}
        openChat={openChat}
        hoverConv={hoverConv}
        openArchive={openArchive}
        mark={mark}
        saveArchive={saveArchive}
        saveCustomerNote={saveCustomerNote}
        sendReply={sendReply}
        needsReply={needsReply}
        accLabel={accLabel}
        syncFbInbox={syncFbInboxKpi}
        verifiedConvIds={verifiedConvIds}
        verifiedConvDates={verifiedConvDates}
        inboxKpiWeekDates={inboxKpiWeekDates}
        userEmail={user?.email || ""}
        ownerEmail={user?.email || ""}
        accountOwnerEmail={selectedAccountOwnerEmail}
      />
    );
  }

  return (
    <div className="p-6 w-full">
      <div className="flex items-center gap-2 mb-1">
        <InboxIcon className="size-5 text-primary" />
        <h1 className="text-xl font-black text-foreground">Inbox Facebook</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">Tin nhắn Messenger tự cập nhật gần như tức thời khi extension đang mở (đọc ngay trên trình duyệt seeder, giải được mã hóa đầu cuối). Đánh dấu khách và trả lời, ưu tiên đẩy khách sang Zalo.</p>

      {connErr && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-700">
          <TriangleAlert className="size-[18px] shrink-0" />
          <span>Không kết nối được Facebook automation service. Kiểm tra backend product và Markee service.</span>
        </div>
      )}
      {needRelogin && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-700">
          <Lock className="size-[18px] shrink-0" />
          <span>Cookie tài khoản này đã hết hạn — vào tab Tài khoản đăng nhập lại.</span>
        </div>
      )}

      {role === "member" && extInstalled !== null && !sessions.some(s => s.owner === owner) && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-300 px-4 py-3 text-sm text-blue-800">
          <Info className="size-[18px] shrink-0 mt-0.5" />
          <span>
            {extInstalled === false
              ? "Bạn chưa cài (hoặc chưa mở) extension Markee trên trình duyệt này. Cài + mở extension rồi đăng nhập Facebook — tài khoản của bạn sẽ tự kết nối về đây, không cần thao tác gì thêm."
              : "Extension đã sẵn sàng nhưng tài khoản Facebook của bạn chưa kết nối. Mở extension (biểu tượng góc phải trình duyệt) và đăng nhập Facebook để kết nối. Giữ 1 tab Messenger mở trong giờ làm để tin nhắn tự về."}
          </span>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border p-3 mb-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <label className="text-xs font-bold text-muted-foreground">Tài khoản nhân viên</label>
          <div className="flex items-center gap-2">
            {(role === "admin" || role === "leader") && (
              <div className="relative">
                <button onClick={() => setShowAddAccountPicker(v => !v)} className="text-xs font-bold px-3 py-1.5 rounded-xl border border-border text-muted-foreground hover:border-primary hover:text-primary transition">
                  + Thêm tài khoản khác
                </button>
                {showAddAccountPicker && (
                  <div className="absolute right-0 mt-1 w-72 max-h-80 overflow-auto bg-card border border-border rounded-xl shadow-lg z-20 p-2">
                    <div className="text-[11px] text-muted-foreground px-1 pb-1.5">Chọn thêm acc ngoài phạm vi mặc định (team/của bạn) để hiện trong Inbox — chỉ lưu trên trình duyệt này.</div>
                    {rawSessions.length === 0 ? (
                      <div className="text-xs text-muted-foreground px-1 py-2">Chưa có acc nào.</div>
                    ) : (
                      rawSessions.map(s => {
                        const inDefaultScope = allowedOwnerIds === null || (!!s.owner && allowedOwnerIds!.has(String(s.owner)));
                        const checked = extraAccountIds.has(s.user_id);
                        return (
                          <label key={s.user_id} className={`flex items-center gap-2 px-1.5 py-1 rounded text-xs cursor-pointer hover:bg-muted ${inDefaultScope ? "opacity-50" : ""}`}>
                            <input type="checkbox" checked={checked || inDefaultScope} disabled={inDefaultScope} onChange={() => toggleExtraAccount(s.user_id)} />
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.status === "online" ? "bg-green-500" : "bg-muted"}`} />
                            <span className="truncate">{accLabel(s)}</span>
                            {inDefaultScope && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">(mặc định)</span>}
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
            <button onClick={scan} disabled={scanning || !acc || !accOnline || needRelogin} className="text-xs font-bold px-3 py-1.5 rounded-xl bg-primary text-white hover:bg-primary/90 transition disabled:opacity-50">
              {scanning ? "Đang quét..." : "Quét ngay"}
            </button>
          </div>
        </div>
        {sessions.length === 0 ? (
          <span className="text-sm text-muted-foreground">{extInstalled === false ? 'Chưa thấy extension. Hãy cài + mở extension trên trình duyệt này.' : 'Chưa có tài khoản nào. Nhân viên cài extension + đăng nhập Facebook để tài khoản hiện ra.'}</span>
        ) : (role === "admin" || role === "leader") ? (
          <div className="w-full">
            <TeamAccountTree
              sessions={sessions}
              ownerNames={ownerNames}
              teams={teams}
              selectedAcc={acc}
              role={role}
              owner={owner}
              onSelect={selectAcc}
            />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sessions.map(s => {
              const isOnline = s.status === "online";
              const isPaused = s.status === "paused";
              return (
                <button key={s.user_id} onClick={() => selectAcc(s.user_id)}
                  title={isOnline ? "Đang online — đọc/trả lời được" : isPaused ? "Inbox realtime đang tạm dừng trên extension" : "Offline (nhân viên tắt máy) — chỉ xem tin cũ"}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold border transition ${acc === s.user_id ? "bg-primary text-white border-primary" : `border-border hover:border-primary ${isOnline ? "text-foreground" : isPaused ? "text-amber-700" : "text-muted-foreground"}`}`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : isPaused ? "bg-amber-400" : "bg-muted"}`} />{accLabel(s)}{!isOnline && <span className="text-[10px] opacity-70">({isPaused ? "paused" : "offline"})</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground mt-1.5">Online: đọc + trả lời realtime. Offline: chỉ xem tin cũ tới khi máy nhân viên bật lại.</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-foreground">Hộp thư</h2>
            <select value={filter} onChange={e => setFilter(e.target.value as "all" | "unread" | "customer" | "need_reply" | "need_verify")} className="text-sm border border-border rounded-xl px-2 py-1 outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-foreground bg-card">
              <option value="all">Tất cả</option>
              <option value="need_reply">Cần trả lời</option>
              <option value="unread">Chưa đọc</option>
              <option value="customer">Khách</option>
              <option value="need_verify">Chưa tính KPI</option>
            </select>
          </div>
          <div className="inline-flex rounded-xl border border-border bg-muted p-0.5 mb-3">
            <button onClick={() => { setViewMode("inbox"); setArchiveReading(false); }} className={`text-xs font-bold px-3 py-1.5 rounded-xl transition ${viewMode === "inbox" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Hộp thư</button>
            <button onClick={() => setViewMode("archive")} className={`text-xs font-bold px-3 py-1.5 rounded-xl transition ${viewMode === "archive" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Lưu trữ</button>
          </div>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {viewMode === "archive" ? (
              loadingArchives && archives.length === 0
                ? <div className="text-center text-muted-foreground py-10 text-sm animate-pulse">Đang tải lưu trữ...</div>
                : archives.length === 0 ? <div className="text-center text-muted-foreground py-10 text-sm">Chưa có hội thoại lưu trữ.</div> :
                archives.map(a => (
                  <div key={a.conv_id} className={`border rounded-xl p-3 transition ${openConv === a.conv_id && archiveReading ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div onClick={() => openArchive(a.conv_id)} title="Xem bản lưu" className="flex justify-between gap-2 cursor-pointer">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">{a.name || a.conv_id}</div>
                        <div className="text-xs text-muted-foreground truncate">{a.preview || "(không có preview)"}</div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">{a.messages_count || 0} tin</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {a.is_customer && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">khách</span>}
                      {a.pushed_to_zalo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">đã đẩy Zalo</span>}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-bold">{a.archive_reason === "hidden_from_inbox" ? "đã ẩn" : "đã lưu"}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button onClick={() => openArchive(a.conv_id)} className="text-xs px-2.5 py-1 rounded-xl border border-border hover:border-primary text-foreground font-semibold transition">Xem lại</button>
                      <button onClick={() => { setViewMode("inbox"); openChat(a.conv_id); }} className="text-xs px-2.5 py-1 rounded-xl border border-border hover:border-primary text-foreground font-semibold transition">Mở inbox</button>
                    </div>
                  </div>
                ))
            ) : (loadingConvs && filtered.length === 0
              ? <div className="text-center text-muted-foreground py-10 text-sm animate-pulse">Đang tải hộp thư của tài khoản...</div>
              : filtered.length === 0 ? <div className="text-center text-muted-foreground py-10 text-sm">Chưa có hội thoại gần đây. Tin cũ nên lưu khách hoặc để ở lưu trữ.</div> :
              filtered.map(c => (
                <div key={c.conv_id} className={`border rounded-xl p-3 transition ${openConv === c.conv_id && !archiveReading ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div onClick={() => openChat(c.conv_id)} title="Bấm để mở hội thoại" className="flex justify-between gap-2 cursor-pointer">
                    <div className="min-w-0">
                      <div className={`truncate ${c.unread ? "font-extrabold" : "font-semibold"} text-foreground`}>{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.preview || "(không có preview)"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">{c.time}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {needsReply(c) && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">cần trả lời</span>}
                    {c.unread && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">chưa đọc</span>}
                    {c.is_customer && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">khách</span>}
                    {c.pushed_to_zalo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">đã đẩy Zalo</span>}
                    {c.archived && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-bold">đã lưu</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <button onClick={() => openChat(c.conv_id)} className="text-xs px-2.5 py-1 rounded-xl border border-border hover:border-primary text-foreground font-semibold transition">Mở chat</button>
                    <button onClick={() => mark(c.conv_id, "is_customer", !c.is_customer)} className="text-xs px-2.5 py-1 rounded-xl border border-border hover:border-primary text-foreground font-semibold transition">{c.is_customer ? "Bỏ khách" : "Là khách"}</button>
                    {c.is_customer && <button onClick={() => mark(c.conv_id, "pushed_to_zalo", !c.pushed_to_zalo)} className="text-xs px-2.5 py-1 rounded-xl border border-border hover:border-primary text-foreground font-semibold transition">{c.pushed_to_zalo ? "Bỏ Zalo" : "Đã đẩy Zalo"}</button>}
                    <button onClick={() => saveArchive(c.conv_id, false)} className="text-xs px-2.5 py-1 rounded-xl border border-border hover:border-primary text-foreground font-semibold transition">Lưu khách</button>
                    <button onClick={() => { if (window.confirm(`Ẩn "${c.name || "hội thoại này"}" khỏi hộp thư? Markee sẽ lưu lại bản archive, không xóa trên Messenger.`)) saveArchive(c.conv_id, true); }} className="text-xs px-2.5 py-1 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 font-semibold transition">Ẩn</button>
                  </div>
                </div>
              ))) }
          </div>
        </div>

        {/* Khung chat */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-base font-bold text-foreground mb-3">Hội thoại</h2>
          {!openConv ? <div className="text-center text-muted-foreground py-10 text-sm">Chọn 1 hội thoại để xem tin nhắn.</div> : (
            <>
              <div ref={chatScrollRef} className="max-h-[430px] overflow-auto mb-3 space-y-2 p-1">
                {loadingChat && msgs.length === 0
                  ? <div className="text-sm text-muted-foreground">Đang tải hội thoại (extension đang mở Messenger quét)... lần đầu có thể chờ 30–60s.</div>
                  : msgs.length === 0
                    ? <div className="text-sm rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-amber-800 space-y-2">
                        {archiveReading
                          ? <div>Bản lưu này chưa có nội dung tin nhắn. Hãy mở hội thoại live một lần để tải thread rồi lưu lại.</div>
                          : needRelogin
                          ? <div className="flex items-start gap-1.5"><Lock className="size-4 shrink-0 mt-0.5" /><span>Cookie tài khoản đã hết hạn — vào tab <b>Tài khoản</b> đăng nhập lại rồi mở lại hội thoại.</span></div>
                          : accPaused
                            ? <div className="flex items-start gap-1.5"><CirclePause className="size-4 shrink-0 mt-0.5" /><span>Inbox realtime đang <b>tạm dừng</b> trong extension của nhân viên. Bật lại công tắc Inbox realtime trong popup extension để lấy tin mới.</span></div>
                          : !accOnline
                            ? <div className="flex items-start gap-1.5"><Moon className="size-4 shrink-0 mt-0.5" /><span>Tài khoản đang <b>offline</b> — nhân viên cần mở máy + extension và giữ 1 tab Messenger để lấy được tin.</span></div>
                            : <div>Chưa lấy được tin nhắn. Đảm bảo extension đang bật và mở 1 tab <b>Messenger</b> trên máy nhân viên, rồi bấm <b>Quét lại</b>.</div>}
                        {!archiveReading && accOnline && !needRelogin && (
                          <button onClick={() => openChat(openConv)} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold transition"><RefreshCw className="size-3.5" />Quét lại hội thoại</button>
                        )}
                      </div>
                    : msgs.map((m, i) => {
                        const mt = m.text.match(/^Tin nhắn do .+? gửi lúc (.+?):\s*([\s\S]*)$/i);
                        let content = mt ? (mt[2] || "").trim() : m.text;
                        const time = mt ? (mt[1] || "").trim() : (m.time || "");
                        if (content) {
                          // Strip time format VN đầu content: "03sáng: text", "47ch: text", "8:47chiều\ntext"
                          const stripped = content.replace(/^(?:(?:Thứ\s+\S+\s+)?\d{1,2}(?::\d{2})?(?:sáng|chiều|ch|sa|CH|SA|AM|PM)?)\s*[:\n]+\s*/i, "").trim();
                          if (stripped) content = stripped;
                        }
                        return (
                          <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[78%] flex flex-col ${m.from === "me" ? "items-end" : "items-start"}`}>
                              <div className={`px-3 py-2 rounded-xl text-sm ${m.from === "me" ? "bg-primary text-white" : "bg-muted text-foreground"}`}>{content}</div>
                              {time && <div className="text-[10px] text-muted-foreground mt-0.5 px-1">{time}</div>}
                            </div>
                          </div>
                        );
                      })}
                {loadingFresh && <div className="text-[11px] text-muted-foreground text-center pt-1 animate-pulse">Đang cập nhật tin mới nhất...</div>}
              </div>
              <div className="flex gap-2">
                <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === "Enter") sendReply(); }}
                  disabled={archiveReading || !accOnline || needRelogin}
                  placeholder={archiveReading ? "Đang xem bản lưu trữ — mở inbox live để trả lời" : needRelogin ? "Cookie hết hạn — đăng nhập lại để gửi" : accPaused ? "Inbox realtime đang tạm dừng — chưa gửi được" : !accOnline ? "Tài khoản offline — không gửi được" : "Nhập trả lời..."}
                  className="flex-1 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-foreground disabled:bg-muted disabled:cursor-not-allowed" />
                <button onClick={sendReply} disabled={archiveReading || !accOnline || needRelogin} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed">Gửi</button>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && <div className={`fixed bottom-6 right-6 px-5 py-3.5 rounded-xl text-white font-semibold shadow-lg ${toast.ok ? "bg-green-600" : "bg-red-600"}`}>{toast.msg}</div>}
    </div>
  );
}
