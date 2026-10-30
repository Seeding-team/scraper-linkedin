/**
 * useZalo — ported từ components/zalo/chat/useZalo.ts (app chính). Cùng logic
 * polling login/conversations/messages + SSE realtime + dedupe. Khác bản gốc:
 *
 *   - accountId là THAM SỐ truyền vào (không đọc từ AppProvider — module này
 *     không có context multi-account, chọn account qua dropdown cục bộ +
 *     localStorage ở page.tsx, giống pattern AccountPicker của
 *     zalo-forward-module).
 *   - KHÔNG có broadcast (ngoài scope module này — xem forward-rules ở
 *     zalo-forward-module cho gửi hàng loạt/tự động).
 *   - KHÔNG có fallback "requestExtensionDomSync" (scrape DOM qua extension
 *     khi bridge /group-info, /user-info không trả data) — đơn giản hoá,
 *     chấp nhận tên hiển thị tạm "Group <id>"/"Zalo <id>" cho trường hợp hiếm
 *     bridge không resolve được tên thật.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { zaloApi, absoluteBridgeUrl, ZaloApiError, ZaloConversation, ZaloLoginStatus, ZaloMessage } from "@/lib/zaloApiClient";
import { isZaloExtensionAvailable, importZaloSessionViaExtension } from "@/services/zaloExtension";
import { previewText, type ZaloAttachment, type ZaloMessageKind } from "@/lib/zaloMessageContent";
import { resolvePendingMentions, type PendingMention } from "@/lib/mentionUtils";

const POLL_INTERVAL_MS = 5_000;

// ── Watchdog "đứng hình" cho SSE (2026-09-30) ────────────────────────────────
// Heartbeat server gửi mỗi 25s (xem services/zalo-bridge .../events) — nếu
// quá lâu không nhận được GÌ (kể cả heartbeat) thì coi là kết nối đã "treo
// xác" (còn mở về mặt OS nhưng không còn truyền dữ liệu — hay gặp qua NAT/
// proxy di động/công ty) và tự đóng+mở lại, KHÔNG đợi browser tự báo lỗi
// (có thể không bao giờ báo). 70s = hơn 2 lần chu kỳ heartbeat, đủ dung sai
// jitter nhưng không quá chậm để phát hiện.
const SSE_STALE_THRESHOLD_MS = 70_000;
const SSE_STALE_CHECK_INTERVAL_MS = 15_000;
// Lưới an toàn ĐỘC LẬP với SSE — tự refetch hội thoại/tin nhắn định kỳ bất kể
// SSE có "tưởng như" đang sống hay không, để UI luôn tự hồi phục về đúng dữ
// liệu thật sau tối đa ~1 phút ngay cả khi có lỗi SSE nào khác chưa lường
// hết (yêu cầu người dùng 2026-09-30: tin nhắn nhóm bị "đứng" nhiều ngày).
const RECONCILE_POLL_INTERVAL_MS = 45_000;

function dedupeMessages(list: ZaloMessage[]): ZaloMessage[] {
  if (!Array.isArray(list) || list.length <= 1) return list;
  const seenById = new Map<string, ZaloMessage>();
  const seenByTimeContent = new Set<string>();
  const out: ZaloMessage[] = [];
  for (const m of list) {
    const id = m.message_id ? String(m.message_id).trim() : "";
    if (id && id.length > 0 && !id.startsWith("sse_") && !id.startsWith("local_") && !id.startsWith("live_") && !id.startsWith("optimistic_")) {
      const existing = seenById.get(id);
      if (existing) {
        const curContent = (existing.content ?? "").length;
        const newContent = (m.content ?? "").length;
        const winner = newContent >= curContent ? m : existing;
        const idx = out.indexOf(existing);
        if (idx >= 0) out[idx] = winner;
        seenById.set(id, winner);
        continue;
      }
      seenById.set(id, m);
    }
    const tsRaw = m.timestamp ? new Date(m.timestamp).getTime() : 0;
    const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : (Number(m.ts) || 0);
    // Block thời gian 3 giây để chống trùng lặp giữa SSE và DB fetch
    const tsBlock = Math.floor(ts / 3000);
    const sender = String(m.sender_id ?? "");
    const content = String(m.content ?? "").trim();
    const key = `${tsBlock}|${sender}|${content}`;
    if (content && seenByTimeContent.has(key)) continue;
    if (content) seenByTimeContent.add(key);
    out.push(m);
  }
  return out;
}

function sortConversationsByLatestMessage(list: ZaloConversation[]): ZaloConversation[] {
  if (!Array.isArray(list) || list.length <= 1) return list;

  const tsOf = (c: ZaloConversation): number => {
    let tIso = 0;
    if (c.latest_message_at) {
      const t = new Date(c.latest_message_at).getTime();
      if (Number.isFinite(t) && t > 0) tIso = t;
    }
    let tRaw = 0;
    if (c.last_message_ts !== undefined && c.last_message_ts !== null && c.last_message_ts !== "") {
      let n = Number(c.last_message_ts);
      if (Number.isFinite(n) && n > 0) {
        if (n < 1e11) n *= 1000;
        tRaw = n;
      }
    }
    return Math.max(tIso, tRaw);
  };

  return [...list].sort((a, b) => {
    const tsA = tsOf(a);
    const tsB = tsOf(b);

    // 1. So sánh mốc thời gian tin nhắn mới nhất (giảm dần):
    // Ai có tin nhắn (gửi đi hoặc nhận về) gần đây nhất sẽ đứng trên đầu!
    if (tsA > 0 && tsB > 0) {
      if (tsB !== tsA) return tsB - tsA;
      // Cùng mốc thời gian: Ưu tiên ghim
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
    }

    // 2. Hội thoại đã có tin nhắn luôn đứng trước hội thoại chưa có tin nhắn
    if (tsA > 0 && tsB === 0) return -1;
    if (tsB > 0 && tsA === 0) return 1;

    // 3. Nếu cả 2 đều chưa có tin nhắn: Ưu tiên hội thoại ghim
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;

    // 4. Ưu tiên cờ has_messages
    if (a.has_messages && !b.has_messages) return -1;
    if (!a.has_messages && b.has_messages) return 1;

    // 5. Sắp xếp theo tên ABC tiếng Việt
    return (a.conversation_name || "").localeCompare(b.conversation_name || "", "vi");
  });
}

async function saveConversationsToSupabase(list: ZaloConversation[], accountId: string) {
  if (typeof window === "undefined" || !Array.isArray(list) || list.length === 0) return;
  try {
    await fetch("/api/zalo/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversations: list, account_id: accountId }),
      keepalive: true,
    });
  } catch {
    // cache fallback — bỏ qua lỗi mạng
  }
}

const FALLBACK_NAME_RE = /^(Group|Zalo|Nhóm)\s+\d+$/i;

function isFallbackName(name?: string | null): boolean {
  if (!name) return true;
  return FALLBACK_NAME_RE.test(name.trim());
}

/**
 * `known` = danh tính ĐÃ BIẾT CHẮC của thread (tên + avatar), dùng cho luồng
 * tìm người lạ theo số điện thoại: lúc đó ta đã có tên thật từ kết quả tra số,
 * trong khi getUserInfo() KHÔNG resolve được người chưa kết bạn nên nếu để tự
 * tra lại thì tên hội thoại rơi về fallback "Zalo <uid>" dù tìm kiếm đúng.
 */
async function ensureConversationInSupabase(
  threadId: string,
  threadType: "user" | "group",
  accountId: string,
  fallbackName?: string,
  latest?: { ts?: number | null; content?: string | null; senderId?: string | null; senderName?: string | null; isSelf?: boolean },
  known?: { name?: string | null; avatar?: string | null },
  /**
   * Tên CHỦ TÀI KHOẢN đang đăng nhập. Dùng để tự chữa các bản ghi đã bị bug cũ
   * đặt tên hội thoại = tên của chính mình (tin tự gửi quay về qua selfListen
   * mang sender_name là tên mình). Tên đó không khớp mẫu fallback nên nếu không
   * xét riêng thì hàm sẽ thoát sớm và không bao giờ sửa lại được.
   */
  ownName?: string | null
): Promise<void> {
  if (typeof window === "undefined" || !threadId) return;
  try {
    const check = await fetch(`/api/zalo/conversations?account_id=${encodeURIComponent(accountId)}&limit=1000`, { cache: "no-store" });
    let existing: { conversation_id?: string; thread_id?: string; conversation_name?: string | null; avatar_url?: string | null; thread_type?: string | null } | null = null;
    if (check.ok) {
      const data = await check.json();
      existing =
        (data?.conversations || []).find((c: { conversation_id?: string; thread_id?: string }) => c.conversation_id === threadId || c.thread_id === threadId) || null;
    }
    const isFallbackName =
      !existing?.conversation_name ||
      FALLBACK_NAME_RE.test(existing.conversation_name.trim()) ||
      (!!fallbackName && existing.conversation_name.trim() === fallbackName.trim()) ||
      // Bản ghi bị bug cũ đặt thành tên của chính mình → coi như cần resolve lại.
      (!!ownName && threadType === "user" && existing.conversation_name.trim() === ownName.trim());
    const hasWrongType = threadType === "group" && !!existing?.thread_type && existing.thread_type !== "group";
    // Hội thoại ĐÃ tồn tại nhưng chưa có avatar (null/rỗng) → cũng cần resolve
    // lại, không chỉ khi tên bị fallback. Trước đây thiếu điều kiện này nên
    // hội thoại 'user' có tên đúng nhưng avatar null sẽ KẸT avatar null vĩnh
    // viễn — nhóm thì không bị vì nhánh group bên dưới luôn gọi lại
    // getGroupInfo mỗi khi needsResolve=true (do lý do nào cũng vậy).
    const needsAvatarResolve = !!existing && !existing.avatar_url;
    const needsResolve = isFallbackName || hasWrongType || needsAvatarResolve;
    const effectiveThreadType: "user" | "group" = existing?.thread_type === "group" ? "group" : threadType;
    if (existing && !needsResolve) return;

    let resolvedName: string | undefined = known?.name || fallbackName;
    let resolvedAvatar: string | null = known?.avatar ?? existing?.avatar_url ?? null;
    if (known?.name) {
      // Đã biết chắc tên → bỏ qua toàn bộ bước tra lại bên dưới.
    } else if (effectiveThreadType === "group") {
      const info = await zaloApi.getGroupInfo(threadId, accountId).catch(() => null);
      if (info?.ok) {
        resolvedName = info.group_name;
        resolvedAvatar = info.avatar_url;
      }
    } else if (!resolvedName || FALLBACK_NAME_RE.test(resolvedName.trim()) || !resolvedAvatar) {
      // Trước đây chỉ tra lại khi TÊN lỗi — dù needsResolve đã đúng vì thiếu
      // avatar, nhánh này vẫn bị bỏ qua nên user không bao giờ được backfill
      // avatar. Thêm `|| !resolvedAvatar` để tra lại đúng lúc cần.
      const info = await zaloApi.getUserInfo(threadId, accountId).catch(() => null);
      if (info?.ok) {
        resolvedName = info.user_name;
        resolvedAvatar = info.avatar_url;
      }
    }
    const finalName = resolvedName || (effectiveThreadType === "group" ? `Group ${threadId}` : `Zalo ${threadId}`);
    const conv = {
      conversation_id: threadId,
      thread_id: threadId,
      thread_type: effectiveThreadType,
      conversation_name: finalName,
      account_id: accountId,
      avatar_url: resolvedAvatar,
      last_message_ts: latest?.ts || Date.now(),
      latest_message_at: new Date(latest?.ts || Date.now()).toISOString(),
      latest_content: latest?.content || null,
      latest_sender_id: latest?.senderId || null,
      // Bug thật (2026-10-05): hàm này luôn upsert FULL (has_messages:true →
      // đi vào fullRows ở app/api/zalo/conversations POST, ghi đè MỌI cột),
      // nên nếu không mang theo tên người gửi ở đây, nó sẽ XOÁ MẤT giá trị
      // latest_sender_name mà saveMessagesToSupabase() vừa ghi đúng xong ngay
      // trước đó (2 request chạy song song, request này có thêm 1 vòng GET
      // "existing" trước nên thường về ĐÍCH SAU, thắng ghi đè null).
      latest_sender_name: latest?.senderName || null,
      latest_is_self: !!latest?.isSelf,
      unread_count: latest?.isSelf ? 0 : 1,
      has_messages: true,
    };
    await fetch("/api/zalo/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversations: [conv], account_id: accountId }),
      keepalive: true,
    });
  } catch {
    // best-effort — không crash UI nếu ensure thất bại
  }
}

async function saveMessagesToSupabase(threadId: string, list: unknown[], accountId: string, opts: { insertOnly?: boolean; threadType?: "user" | "group" } = {}) {
  if (typeof window === "undefined" || !threadId || !Array.isArray(list) || list.length === 0) return;
  try {
    await fetch("/api/zalo/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        thread_id: threadId,
        thread_type: opts.threadType || "user",
        messages: list,
        insert_only: !!opts.insertOnly,
      }),
      keepalive: true,
    });
  } catch {
    // cache fallback — bỏ qua lỗi mạng
  }
}

export function useZalo(accountId: string) {
  const [loginStatus, setLoginStatus] = useState<ZaloLoginStatus | null>(null);
  // Ten chu tai khoan — dung de tu chua hoi thoai bi bug cu dat thanh ten minh.
  const ownNameRef = useRef<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ZaloConversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);

  const [openConvId, setOpenConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ZaloMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);

  const [replyText, setReplyText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Mention đã chèn vào replyText qua MentionPicker (gõ "@" chọn thành viên/
  // @All) — chỉ giữ {uid, token}, KHÔNG giữ vị trí sống vì replyText có thể
  // bị sửa tự do sau đó. Resolve lại thành {pos,uid,len} thật ngay lúc gửi,
  // xem resolvePendingMentions() trong sendCurrentMessage bên dưới.
  const [pendingMentions, setPendingMentions] = useState<PendingMention[]>([]);

  const accountIdRef = useRef(accountId);
  useEffect(() => {
    accountIdRef.current = accountId;
  }, [accountId]);

  const openConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    openConvIdRef.current = openConvId;
  }, [openConvId]);

  const activeFetchIdRef = useRef(0);

  const conversationsRef = useRef<ZaloConversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const pollAuth = useCallback(async () => {
    try {
      const status = await zaloApi.getLoginStatus(accountIdRef.current);
      setLoginStatus(status);
      ownNameRef.current = status?.display_name ? String(status.display_name) : null;
      setAuthError(null);
    } catch (e) {
      if (e instanceof ZaloApiError) setAuthError(e.message);
    }
  }, []);

  useEffect(() => {
    pollAuth();
    const id = setInterval(pollAuth, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollAuth]);

  // Đổi account (dropdown ở page.tsx) → reset state + refetch.
  const prevAccountIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevAccountIdRef.current === accountId) return;
    const isFirstMount = prevAccountIdRef.current === null;
    prevAccountIdRef.current = accountId;
    if (isFirstMount) return;
    setConversations([]);
    setMessages([]);
    setOpenConvId(null);
    setLoginStatus(null);
    setAuthError(null);
    void pollAuth();
  }, [accountId, pollAuth]);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/zalo/conversations?account_id=${encodeURIComponent(accountIdRef.current)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list: ZaloConversation[] = Array.isArray(data?.conversations) ? data.conversations : [];
      if (list.length > 0) {
        setConversations((prev) => {
          if (prev.length === 0) return sortConversationsByLatestMessage(list);
          const map = new Map<string, ZaloConversation>();
          prev.forEach((c) => map.set(c.conversation_id, c));
          list.forEach((c) => {
            const old = map.get(c.conversation_id);
            if (!old) {
              map.set(c.conversation_id, c);
            } else {
              // Smart merge: Tuyệt đối không để tên fallback hoặc nội dung rỗng từ cache đè lên dữ liệu tốt đã có
              const bestName = !isFallbackName(c.conversation_name)
                ? c.conversation_name
                : (!isFallbackName(old.conversation_name) ? old.conversation_name : c.conversation_name);
              const bestAvatar = c.avatar_url || old.avatar_url;
              const bestLatestContent = c.latest_content || old.latest_content;
              const bestSenderName = c.latest_sender_name || old.latest_sender_name;
              const bestTs = Math.max(Number(c.last_message_ts) || 0, Number(old.last_message_ts) || 0);

              map.set(c.conversation_id, {
                ...old,
                ...c,
                conversation_name: bestName,
                avatar_url: bestAvatar,
                latest_content: bestLatestContent,
                latest_sender_name: bestSenderName,
                last_message_ts: bestTs || old.last_message_ts || c.last_message_ts,
              });
            }
          });
          return sortConversationsByLatestMessage(Array.from(map.values()));
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchConversations = useCallback(async (silent = false) => {
    // Chỉ hiện loading spinner khi danh sách rỗng (lần đầu tải trang) để tránh giật lag UI
    if (!silent && conversationsRef.current.length === 0) {
      setLoadingConvs(true);
    }
    try {
      const res = await zaloApi.getConversations(200, accountIdRef.current);
      const list = res.conversations || [];
      if (list.length > 0) {
        setConversations(sortConversationsByLatestMessage(list));
        void saveConversationsToSupabase(list, accountIdRef.current);
      } else {
        await refreshConversations();
      }
    } catch {
      await refreshConversations();
    } finally {
      setLoadingConvs(false);
    }
  }, [refreshConversations]);

  useEffect(() => {
    // Tự động tải danh sách hội thoại từ cache Supabase ngay lập tức khi mở trang/chọn account
    if (accountIdRef.current) {
      void refreshConversations();
    }
  }, [accountId, refreshConversations]);

  const prevLoggedInRef = useRef<boolean>(false);
  useEffect(() => {
    const isAvailable = Boolean(loginStatus?.is_logged_in || (loginStatus?.status as string) === "confirmed" || (loginStatus?.status as string) === "connected");
    if (isAvailable) {
      // Chỉ tự động fetch toàn bộ conversations khi vừa chuyển sang trạng thái đã đăng nhập
      // Tuyệt đối không refetch liên tục mỗi 5s làm đơ server và nhảy UI
      if (!prevLoggedInRef.current || conversationsRef.current.length === 0) {
        void fetchConversations(conversationsRef.current.length > 0);
      }
    } else if (loginStatus !== null && loginStatus?.session_expired) {
      // Chỉ xóa danh sách khi xác nhận chắc chắn là đã hết hạn phiên hoặc đăng xuất thật sự
      setConversations([]);
      setOpenConvId(null);
    }
    prevLoggedInRef.current = isAvailable;
  }, [loginStatus?.is_logged_in, loginStatus?.status, loginStatus?.session_expired, fetchConversations]);

  const syncConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      await zaloApi.syncConversations(accountIdRef.current);
      await fetchConversations();
      showToast("Đồng bộ conversations thành công!", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Lỗi đồng bộ Zalo", false);
    } finally {
      setLoadingConvs(false);
    }
  }, [fetchConversations, showToast]);

  const openConversation = useCallback(
    async (convId: string, known?: { name?: string | null; avatar?: string | null }) => {
      const threadId = convId.includes(":") ? convId.split(":").slice(1).join(":") : convId;
      const currentFetchId = ++activeFetchIdRef.current;

      setMessages([]);
      setOpenConvId(threadId);
      openConvIdRef.current = threadId;

      // Optimistic: Giảm ngay số unread về 0 trên UI không cần chờ round-trip
      setConversations((prev) => prev.map((c) => (c.conversation_id === threadId ? { ...c, unread_count: 0 } : c)));

      const existing = conversationsRef.current.find((c) => c.conversation_id === threadId || c.thread_id === threadId);
      if (!existing) {
        void ensureConversationInSupabase(
          threadId,
          "user",
          accountIdRef.current,
          `Zalo ${threadId}`,
          { ts: Date.now(), content: null, isSelf: false },
          known,
          ownNameRef.current
        );
        // Hiện ngay trong danh sách với tên thật (nếu đã biết) thay vì chờ sync
        if (known?.name) {
          setConversations((prev) =>
            prev.some((c) => c.thread_id === threadId)
              ? prev
              : [
                  {
                    conversation_id: threadId,
                    thread_id: threadId,
                    thread_type: "user",
                    conversation_name: known.name as string,
                    account_id: accountIdRef.current,
                    avatar_url: known.avatar ?? null,
                    unread_count: 0,
                    message_count: 0,
                    has_messages: true,
                    last_message_ts: Date.now(),
                    latest_message_at: new Date().toISOString()
                  } as ZaloConversation,
                  ...prev
                ]
          );
        }
      }

      setLoadingChat(true);
      try {
        const targetConv = conversationsRef.current.find((c) => c.conversation_id === threadId || c.thread_id === threadId || c.conversation_id === convId);
        const tType = (targetConv?.thread_type as "user" | "group") || (threadId.startsWith("g") ? "group" : "user");
        const data = await zaloApi.getMessages(convId || threadId, 200, accountIdRef.current, tType);

        // 🛡️ CHỐNG RACE CONDITION TRIỆT ĐỂ:
        if (activeFetchIdRef.current !== currentFetchId || openConvIdRef.current !== threadId) {
          return;
        }

        const list: ZaloMessage[] = Array.isArray(data?.messages) ? data.messages : [];
        setMessages(dedupeMessages(list));

        void zaloApi.markRead(convId, accountIdRef.current).catch(() => undefined);
      } catch (e) {
        if (activeFetchIdRef.current === currentFetchId && openConvIdRef.current === threadId) {
          showToast(e instanceof Error ? e.message : "Lỗi tải tin nhắn", false);
        }
      } finally {
        if (activeFetchIdRef.current === currentFetchId) {
          setLoadingChat(false);
        }
      }
    },
    [showToast]
  );

  /**
   * Đảm bảo 1 hội thoại 'user' TỒN TẠI với ĐÚNG TÊN đã biết chắc — dùng cho
   * hành động "Kết bạn" trên kết quả tra số điện thoại (KHÔNG mở/chuyển sang
   * hội thoại đó, khác `openConversation`). Không gọi hàm này thì tin nhắn
   * mời kết bạn tự động (Zalo gửi kèm lời chào mặc định) sẽ vọng lại qua SSE
   * với `is_self:true` → `nameFromSender` luôn rỗng ở nhánh đó (xem
   * "new_message" listener bên dưới) → `getUserInfo()` không resolve được
   * người CHƯA kết bạn → hội thoại kẹt tên fallback "Zalo <uid>" vĩnh viễn.
   */
  const registerStrangerConversation = useCallback(
    (rawThreadId: string, known: { name?: string | null; avatar?: string | null }) => {
      // ZaloStrangerUser.conversation_id tới dạng "u:<uid>" (định dạng dành
      // riêng cho gửi tin, xem parseThreadId ở bridge) — PHẢI bóc tiền tố
      // trước khi lưu làm conversation_id/thread_id "thật", nếu không hội
      // thoại này sẽ mãi mãi có thread_id sai (kèm "u:") khiến mọi API cần
      // uid thô (friend-status, user-info...) gọi luôn thất bại âm thầm —
      // đây chính là lý do trạng thái "Đã gửi lời mời" không bao giờ hiện ra
      // sau khi gửi kết bạn cho người lạ.
      const threadId = rawThreadId.includes(":") ? rawThreadId.split(":").slice(1).join(":") : rawThreadId;
      const existing = conversationsRef.current.find((c) => c.conversation_id === threadId || c.thread_id === threadId);
      if (existing) return;
      void ensureConversationInSupabase(
        threadId,
        "user",
        accountIdRef.current,
        `Zalo ${threadId}`,
        { ts: Date.now(), content: null, isSelf: true },
        known,
        ownNameRef.current
      );
      if (known?.name) {
        setConversations((prev) =>
          prev.some((c) => c.thread_id === threadId)
            ? prev
            : [
                {
                  conversation_id: threadId,
                  thread_id: threadId,
                  thread_type: "user",
                  conversation_name: known.name as string,
                  account_id: accountIdRef.current,
                  avatar_url: known.avatar ?? null,
                  unread_count: 0,
                  message_count: 0,
                  has_messages: true,
                  last_message_ts: Date.now(),
                  latest_message_at: new Date().toISOString(),
                } as ZaloConversation,
                ...prev,
              ]
        );
      }
    },
    []
  );

  const refreshCurrentThread = useCallback(async () => {
    const convId = openConvIdRef.current;
    if (!convId) return;
    const threadId = convId.includes(":") ? convId.split(":").slice(1).join(":") : convId;
    try {
      const data = await zaloApi.getMessages(threadId, 200, accountIdRef.current);
      const list: ZaloMessage[] = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(dedupeMessages(list));
    } catch {
      // ignore
    }
  }, []);

  /**
   * Cập nhật NGAY 1 tin đã THU HỒI thành công trong `messages` cục bộ (không
   * đợi refetch) — bridge đã trả ok:true nghĩa là đã thật sự thu hồi trên
   * Zalo + cập nhật is_deleted=true ở DB, nên hiện luôn "Tin nhắn đã bị thu
   * hồi" thay vì đợi 1 round-trip fetch mới thấy, để cảm giác đồng bộ tức
   * thì. Vẫn gọi refreshCurrentThread() sau đó (xem handleMessageRecalled ở
   * ZaloPageContent.tsx) để chắc chắn khớp lại với server thật.
   */
  const markMessageRecalledLocally = useCallback((messageId: string) => {
    setMessages((prev) => prev.map((m) => (m.message_id === messageId ? { ...m, is_deleted: true } : m)));
  }, []);

  /**
   * Cập nhật NGAY tổng hợp cảm xúc của 1 tin sau khi thả/gỡ thành công —
   * không đợi refetch (bridge không trả msgId/cliMsgId mới, và cảm xúc từ
   * người khác chỉ đồng bộ lại ở lần mở/làm mới hội thoại kế tiếp, xem ghi
   * chú ở ZaloChatPanel.tsx). `reaction=null` = vừa GỠ cảm xúc của mình.
   */
  const applyReactionLocally = useCallback((messageId: string, reaction: string | null) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.message_id !== messageId) return m;
        const counts = { ...(m.reactions || {}) };
        const prevMine = m.my_reaction || null;
        if (prevMine && counts[prevMine]) {
          counts[prevMine] -= 1;
          if (counts[prevMine] <= 0) delete counts[prevMine];
        }
        if (reaction) counts[reaction] = (counts[reaction] || 0) + 1;
        return { ...m, reactions: Object.keys(counts).length > 0 ? counts : null, my_reaction: reaction };
      })
    );
  }, []);

  /**
   * Tìm tin nhắn cũ theo nội dung TRONG hội thoại đang mở (không đụng tới
   * `messages` state — chỉ trả danh sách kết quả rời để UI hiện dropdown,
   * xem ô tìm kiếm ở header ZaloChatPanel.tsx). Server lo phần ILIKE, xem
   * app/api/zalo/messages/route.ts (tham số `q`).
   */
  const searchMessagesInThread = useCallback(async (query: string): Promise<ZaloMessage[]> => {
    const convId = openConvIdRef.current;
    const q = query.trim();
    if (!convId || !q) return [];
    const threadId = convId.includes(":") ? convId.split(":").slice(1).join(":") : convId;
    try {
      const res = await fetch(
        `/api/zalo/messages?account_id=${encodeURIComponent(accountIdRef.current)}&thread_id=${encodeURIComponent(threadId)}&q=${encodeURIComponent(q)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.messages) ? data.messages : [];
    } catch {
      return [];
    }
  }, []);

  /**
   * Cập nhật NGAY danh sách nhãn của 1 hội thoại (lạc quan, không đợi
   * response) rồi ghi xuống self-host DB — xem TagEditor.tsx. Rollback lại
   * giá trị cũ nếu request lỗi, tránh UI hiện sai trạng thái thật.
   */
  const updateConversationTags = useCallback(
    async (conversationId: string, tags: string[]) => {
      const prevTags = conversationsRef.current.find((c) => c.conversation_id === conversationId)?.tags || [];
      setConversations((prev) => prev.map((c) => (c.conversation_id === conversationId ? { ...c, tags } : c)));
      try {
        const res = await fetch(`/api/zalo/conversations/${encodeURIComponent(conversationId)}/tags`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountIdRef.current, tags }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      } catch (e) {
        setConversations((prev) => prev.map((c) => (c.conversation_id === conversationId ? { ...c, tags: prevTags } : c)));
        showToast(e instanceof Error ? e.message : "Cập nhật nhãn thất bại", false);
      }
    },
    [showToast]
  );

  /**
   * Ghim/bỏ ghim 1 hội thoại lên đầu danh sách (giống Zalo) — cùng pattern lạc
   * quan + rollback với updateConversationTags ở trên. Xem
   * .../[conversationId]/pin/route.ts.
   */
  const updateConversationPin = useCallback(
    async (conversationId: string, isPinned: boolean) => {
      const prevPinned = conversationsRef.current.find((c) => c.conversation_id === conversationId)?.is_pinned ?? false;
      setConversations((prev) => prev.map((c) => (c.conversation_id === conversationId ? { ...c, is_pinned: isPinned } : c)));
      try {
        const res = await fetch(`/api/zalo/conversations/${encodeURIComponent(conversationId)}/pin`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountIdRef.current, is_pinned: isPinned }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      } catch (e) {
        setConversations((prev) => prev.map((c) => (c.conversation_id === conversationId ? { ...c, is_pinned: prevPinned } : c)));
        showToast(e instanceof Error ? e.message : "Ghim hội thoại thất bại", false);
      }
    },
    [showToast]
  );

  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  /**
   * "Nhảy tới" 1 tin cụ thể (bấm vào 1 kết quả tìm kiếm) — tin đó có thể nằm
   * NGOÀI 200 tin gần nhất đang hiển thị mặc định, nên phải tải lại 1 cửa sổ
   * mới quanh mốc `ts` đó (server lo qua tham số `around_ts`) rồi thay hẳn
   * `messages` hiện tại bằng cửa sổ mới này. `highlightedMessageId` để
   * ZaloChatPanel tự cuộn tới + chớp sáng đúng bong bóng tin đó.
   */
  const jumpToMessage = useCallback(async (ts: number | string, messageId: string) => {
    const convId = openConvIdRef.current;
    if (!convId) return;
    const threadId = convId.includes(":") ? convId.split(":").slice(1).join(":") : convId;
    try {
      const res = await fetch(
        `/api/zalo/messages?account_id=${encodeURIComponent(accountIdRef.current)}&thread_id=${encodeURIComponent(threadId)}&around_ts=${encodeURIComponent(String(ts))}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      const list: ZaloMessage[] = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(dedupeMessages(list));
      setHighlightedMessageId(messageId);
      setTimeout(() => setHighlightedMessageId((prev) => (prev === messageId ? null : prev)), 2500);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const isAvailable = Boolean(loginStatus?.is_logged_in || (loginStatus?.status as string) === "confirmed" || (loginStatus?.status as string) === "connected");
    if (!isAvailable) return;
    const onVisibleOrFocus = () => {
      const isVisible = typeof document === "undefined" || document.visibilityState === "visible";
      const isFocused = typeof document === "undefined" || document.hasFocus();
      if (!isVisible && !isFocused) return;
      void refreshConversations();
      void refreshCurrentThread();
      // Xem docstring reconnect() ở effect SSE phía dưới — tab vừa active lại
      // mà SSE không "open" thì buộc kết nối lại ngay, không đợi backoff.
      if (sseStateRef.current !== "open") sseRef.current?.reconnect?.();
    };
    document.addEventListener("visibilitychange", onVisibleOrFocus);
    window.addEventListener("focus", onVisibleOrFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
      window.removeEventListener("focus", onVisibleOrFocus);
    };
  }, [loginStatus?.is_logged_in, refreshConversations, refreshCurrentThread]);

  const syncCurrentChat = useCallback(async () => {
    if (!openConvId) return;
    try {
      await zaloApi.syncMessages().catch(() => undefined);
      await refreshCurrentThread();
      await refreshConversations();
      showToast("Đã đồng bộ tin nhắn mới!", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Lỗi đồng bộ tin nhắn", false);
    }
  }, [openConvId, refreshCurrentThread, refreshConversations, showToast]);

  /** Tin đang được TRẢ LỜI (quote) — chọn bằng cách kéo 1 tin từ trái sang
   *  phải trong khung chat (xem MessageBubble ở ZaloChatPanel.tsx). */
  const [replyingTo, setReplyingTo] = useState<ZaloMessage | null>(null);
  const cancelReply = useCallback(() => setReplyingTo(null), []);

  // Đổi hội thoại → huỷ luôn tin đang trả lời dở của hội thoại cũ, tránh gửi
  // nhầm quote sang hội thoại khác.
  useEffect(() => {
    setReplyingTo(null);
  }, [openConvId]);

  const sendCurrentMessage = useCallback(async () => {
    if (!openConvId) return;
    const text = replyText.trim();
    if (!text && pendingFiles.length === 0) return;

    const openConv = conversations.find((c) => c.conversation_id === openConvId || c.thread_id === openConvId);
    const sendThreadType: "user" | "group" = (openConv?.thread_type as "user" | "group" | undefined) || (openConvId.startsWith("g:") ? "group" : "user");

    // Quy đổi các mention đã chèn (token text "@Tên"/"@All") thành {pos,uid,len}
    // theo đúng vị trí trong `text` CUỐI CÙNG lúc gửi — xem resolvePendingMentions.
    // Media đính kèm gửi kèm caption không hỗ trợ mention riêng ở bridge, nên
    // chỉ áp dụng cho luồng gửi text thuần.
    const mentions = pendingFiles.length === 0 ? resolvePendingMentions(text, pendingMentions) : [];

    // Trả lời (quote) chỉ áp dụng cho tin TEXT thuần (không kèm ảnh/file) —
    // xem ghi chú ở ZaloChatPanel.tsx vì sao giới hạn vậy.
    const replyTo =
      pendingFiles.length === 0 && replyingTo?.cli_msg_id
        ? {
            message_id: replyingTo.message_id,
            cli_msg_id: replyingTo.cli_msg_id,
            sender_id: replyingTo.sender_id || "",
            preview:
              replyingTo.content?.trim() ||
              previewText({ text: replyingTo.content, kind: replyingTo.msg_kind, attachments: replyingTo.attachments }) ||
              "[Tin nhắn]",
            sender_name: replyingTo.sender_name,
            ts: replyingTo.ts,
          }
        : undefined;

    setSending(true);
    try {
      if (pendingFiles.length > 0) {
        await zaloApi.sendMedia(openConvId, pendingFiles, text, sendThreadType, accountIdRef.current);
      } else {
        await zaloApi.sendMessage(openConvId, text, sendThreadType, accountIdRef.current, mentions, replyTo);
      
      }
      setReplyText("");
      setPendingFiles([]);
      setPendingMentions([]);
      setReplyingTo(null);

      const nowTs = Date.now();
      const nowIso = new Date(nowTs).toISOString();
      const previewSnippet = text || (pendingFiles.length > 0 ? "[Tệp tin]" : "[Tin nhắn]");

      // Cập nhật ngay mốc thời gian để hội thoại vừa gửi tin nhảy lên đầu danh sách
      setConversations((prev) =>
        sortConversationsByLatestMessage(
          prev.map((c) =>
            c.conversation_id === openConvId || c.thread_id === openConvId
              ? {
                  ...c,
                  latest_message_at: nowIso,
                  last_message_ts: nowTs,
                  latest_content: previewSnippet,
                  latest_is_self: true,
                  has_messages: true,
                }
              : c
          )
        )
      );

      await new Promise((r) => setTimeout(r, 400));
      await refreshCurrentThread();
      void refreshConversations();
      setTimeout(() => {
        void refreshCurrentThread();
        void refreshConversations();
      }, 1500);

      showToast("Đã gửi!", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Lỗi gửi tin nhắn", false);
    } finally {
      setSending(false);
    }
  }, [openConvId, replyText, pendingFiles, pendingMentions, refreshConversations, refreshCurrentThread, showToast, replyingTo]);

  const closeConversation = useCallback(() => {
    setOpenConvId(null);
    openConvIdRef.current = null;
    setMessages([]);
    setLoadingChat(false);
    setReplyText("");
    setPendingFiles([]);
    setPendingMentions([]);
  }, []);

  const logout = useCallback(async () => {
    if (!window.confirm("Đăng xuất Zalo? Bạn sẽ cần quét QR lại.")) return;
    try {
      await zaloApi.logout(accountIdRef.current);
      setLoginStatus(null);
      setConversations([]);
      setMessages([]);
      setOpenConvId(null);
      showToast("Đã đăng xuất Zalo", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Lỗi đăng xuất", false);
    }
  }, [showToast]);

  const [reconnecting, setReconnecting] = useState(false);
  const reconnectBridge = useCallback(async () => {
    setReconnecting(true);
    try {
      const result = await zaloApi.reconnect(accountIdRef.current);
      if (result?.ok) {
        showToast(`Đã reconnect Zalo (${result.before || "?"} → ${result.after || "?"}, WS: ${result.is_ws_connected ? "online" : "offline"})`, true);
        await pollAuth();
        await fetchConversations();
      } else {
        showToast(result?.error || "Reconnect thất bại", false);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Lỗi khi reconnect", false);
    } finally {
      setReconnecting(false);
    }
  }, [showToast, pollAuth, fetchConversations]);

  const SSE_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 30_000];
  const [sseState, setSseState] = useState<"connecting" | "open" | "closed" | "reconnecting">("closed");
  const sseRef = useRef<{ close: () => void; reconnect: () => void } | null>(null);
  const sseStateRef = useRef<"connecting" | "open" | "closed" | "reconnecting">("closed");
  useEffect(() => {
    sseStateRef.current = sseState;
  }, [sseState]);

  useEffect(() => {
    const isAvailable = Boolean(loginStatus?.is_logged_in || (loginStatus?.status as string) === "confirmed" || (loginStatus?.status as string) === "connected");
    if (!isAvailable) {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      setSseState("closed");
      return;
    }

    let cancelled = false;
    let retryAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let currentSource: EventSource | null = null;
    let lastEventAt = Date.now();
    let staleCheckTimer: ReturnType<typeof setInterval> | null = null;

    function cleanup() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (staleCheckTimer) {
        clearInterval(staleCheckTimer);
        staleCheckTimer = null;
      }
      if (currentSource) {
        currentSource.close();
        currentSource = null;
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const delay = SSE_RETRY_DELAYS_MS[Math.min(retryAttempt, SSE_RETRY_DELAYS_MS.length - 1)];
      retryAttempt += 1;
      setSseState("reconnecting");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function attach(source: EventSource) {
      source.addEventListener("open", () => {
        if (cancelled) return;
        retryAttempt = 0;
        lastEventAt = Date.now();
        setSseState("open");
      });

      // Named event thật (không phải comment `:heartbeat` — xem docstring
      // sửa ở services/zalo-bridge .../events) → client ĐO ĐƯỢC "bao lâu rồi
      // chưa nhận gì", làm nền cho watchdog treo-xác bên dưới.
      source.addEventListener("heartbeat", () => {
        if (cancelled) return;
        lastEventAt = Date.now();
      });
      source.addEventListener("ping", () => {
        if (cancelled) return;
        lastEventAt = Date.now();
      });

      const dispatch = (type: string, rawData: string | null) => {
        if (cancelled || !rawData) return;
        lastEventAt = Date.now();
        try {
          const data = JSON.parse(rawData);
          if (type === "new_message") {
            const target = (data && (data.thread_id ?? data.group_id ?? data.threadId ?? data.idTo)) ?? null;
            const targetThread = target ? String(target) : null;
            if (!targetThread) {
              void refreshConversations();
              return;
            }

            const messageIdFromSse = (() => {
              const candidates = [data?.message_id, data?.id, data?.msg_id, data?.msgId];
              for (const c of candidates) {
                if (c == null) continue;
                const s = String(c).trim();
                if (s.length === 0) continue;
                if (s.startsWith("sse_") || s.startsWith("local_")) continue;
                return s;
              }
              return null;
            })();

            const sseThreadType = data?.thread_type === "group" || data?.isGroup ? "group" : "user";
            const tsFromSse = data?.ts ? Number(data.ts) : Date.now();
            const isoNow = Number.isFinite(tsFromSse) && tsFromSse > 0 ? new Date(tsFromSse).toISOString() : new Date().toISOString();
            const isOwn = data?.is_self === true || data?.isSelf === true || data?.is_self === 1;
            // Tin đính kèm không có content dạng chữ → lấy nhãn theo loại
            // ("[Hình ảnh]", "[Video]", "[Liên kết] <tiêu đề>"…) để dòng preview ở
            // danh sách hội thoại không bị trắng trơn.
            const sseAttachments: ZaloAttachment[] = Array.isArray(data?.attachments) ? (data.attachments as ZaloAttachment[]) : [];
            const sseKind = (typeof data?.msg_kind === "string" ? data.msg_kind : null) as ZaloMessageKind | null;
            const latestContent =
              previewText({ text: typeof data?.content === "string" ? data.content : null, kind: sseKind, attachments: sseAttachments }) || null;

            /**
             * Tên để ĐẶT/SỬA tên hội thoại — chỉ lấy từ sender_name khi tin do
             * NGƯỜI KHÁC gửi. Bridge chạy với selfListen: true nên tin mình vừa
             * gửi cũng quay về qua listener; lúc đó sender_name chính là tên
             * CHỦ TÀI KHOẢN, dùng nó sẽ đổi tên hội thoại thành tên của mình.
             */
            const nameFromSender = !isOwn && data?.sender_name ? String(data.sender_name) : undefined;

            // ⚡ Hiển thị tin nhắn tức thời vào khung chat đang mở (Optimistic 0ms UI)
            const cleanId = (s?: string | null) => (s ? String(s).replace(/^[ug]:/, "") : "");
            const isCurrentOpen = Boolean(
              openConvIdRef.current && (
                cleanId(openConvIdRef.current) === cleanId(targetThread) ||
                (data?.sender_id && cleanId(openConvIdRef.current) === cleanId(data.sender_id)) ||
                (data?.thread_id && cleanId(openConvIdRef.current) === cleanId(data.thread_id))
              )
            );

            if (isCurrentOpen) {
              const liveMessage: ZaloMessage = {
                message_id: messageIdFromSse || `live_${tsFromSse}_${Math.random().toString(36).slice(2, 6)}`,
                                sender_id: data?.sender_id || null,
                sender_name: data?.sender_name || null,
                content: typeof data?.content === "string" ? data.content : "",
                ts: tsFromSse,
                timestamp: isoNow,
                time_text: new Date(tsFromSse).toLocaleTimeString("vi-VN"),
                type: data?.type || "webchat",
                is_sent: isOwn,
                is_deleted: false,
                attachments: sseAttachments.length > 0 ? sseAttachments : undefined,
                msg_kind: sseKind || (sseAttachments.length > 0 ? sseAttachments[0].kind : "text"),
                image_urls: Array.isArray(data?.image_urls) ? data.image_urls : [],
                group_id: sseThreadType === "group" ? targetThread : null,
              };
              setMessages((prev) => dedupeMessages([...prev, liveMessage]));
            }

            const applyLocalState = () => {
              setConversations((prev) => {
                const exists = prev.some((c) => c.conversation_id === targetThread);
                let next: ZaloConversation[];
                if (exists) {
                  next = prev.map((c) =>
                    c.conversation_id !== targetThread
                      ? c
                      : {
                          ...c,
                          latest_message_at: isoNow,
                          last_message_ts: tsFromSse,
                          latest_content: latestContent ?? c.latest_content,
                          latest_sender_name: data?.sender_name ?? c.latest_sender_name,
                          latest_is_self: isOwn,
                          unread_count: isOwn ? 0 : Math.max(0, Number(c.unread_count || 0) + (targetThread === openConvIdRef.current ? 0 : 1)),
                          has_messages: true,
                        }
                  );
                } else {
                  next = [
                    ...prev,
                    {
                      conversation_id: targetThread,
                                            thread_type: sseThreadType,
                      conversation_name: sseThreadType === "group" ? `Group ${targetThread}` : nameFromSender || `Zalo ${targetThread}`,
                      account_id: accountIdRef.current,
                      latest_message_at: isoNow,
                      last_message_ts: tsFromSse,
                      latest_content: latestContent,
                      latest_sender_name: data?.sender_name ?? null,
                      latest_is_self: isOwn,
                      message_count: 1,
                      has_messages: true,
                      unread_count: isOwn ? 0 : 1,
                      avatar_url: null,
                    } as ZaloConversation,
                  ];
                }
                return sortConversationsByLatestMessage(next);
              });
              if (targetThread && openConvIdRef.current && String(openConvIdRef.current) === targetThread) {
                void refreshCurrentThread();
                setTimeout(() => void refreshCurrentThread(), 2500);
              }
            };

            if (!messageIdFromSse) {
              // Bridge đã tự persist theo msgId — chỉ ensure conversation row + refetch.
              void ensureConversationInSupabase(targetThread, sseThreadType, accountIdRef.current, nameFromSender, {
                ts: tsFromSse,
                content: latestContent,
                senderId: data?.sender_id || null,
                senderName: data?.sender_name || null,
                isSelf: isOwn,
              }, undefined, ownNameRef.current).finally(() => {
                applyLocalState();
                void refreshConversations();
              });
              return;
            }

            const messageRow = {
              message_id: messageIdFromSse,
                            thread_type: sseThreadType,
              sender_id: data?.sender_id || null,
              sender_name: data?.sender_name || null,
              content: data?.content ?? "",
              ts: tsFromSse,
              type: data?.type || "webchat",
              is_self: isOwn,
              // Bridge gửi kèm attachments đã chuẩn hoá + loại tin (msg_kind)
              // trong payload SSE — giữ nguyên để row chèn từ đây cũng hiển thị
              // đúng loại (ảnh/video/link/file/sticker), không phải đợi refetch.
              attachments: Array.isArray(data?.attachments) ? data.attachments : null,
              msg_kind: typeof data?.msg_kind === "string" ? data.msg_kind : null,
              image_urls: Array.isArray(data?.image_urls) ? data.image_urls : [],
              reply_to_id: data?.reply_to_id ?? null,
              time_text: data?.time_text || null,
            };

            const savePromise = saveMessagesToSupabase(targetThread, [messageRow], accountIdRef.current, { insertOnly: true, threadType: sseThreadType });
            const ensurePromise = ensureConversationInSupabase(targetThread, sseThreadType, accountIdRef.current, nameFromSender, {
              ts: tsFromSse,
              content: latestContent,
              senderId: data?.sender_id || null,
              senderName: data?.sender_name || null,
              isSelf: isOwn,
            }, undefined, ownNameRef.current);

            Promise.all([savePromise, ensurePromise]).finally(() => {
              applyLocalState();
              const exists = conversationsRef.current.some((c) => c.conversation_id === targetThread);
              if (!exists) {
                void fetchConversations().then(() => refreshConversations());
              } else {
                void refreshConversations();
              }
            });
          } else if (type === "session_expired") {
            showToast("Phiên Zalo đã hết hạn. Vui lòng đăng nhập lại.", false);
            void pollAuth();
          }
        } catch {
          // payload không hợp lệ — bỏ qua, không crash subscription.
        }
      };

      source.addEventListener("new_message", (e) => dispatch("new_message", (e as MessageEvent).data));
      source.addEventListener("session_expired", (e) => dispatch("session_expired", (e as MessageEvent).data));
      source.addEventListener("error", () => {
        if (cancelled) return;
        try {
          source.close();
        } catch {
          /* noop */
        }
        currentSource = null;
        scheduleReconnect();
      });
    }

    function connect() {
      if (cancelled) return;
      setSseState("connecting");
      lastEventAt = Date.now();
      try {
        const source = zaloApi.openEventSource(accountIdRef.current);
        currentSource = source;
        attach(source);
      } catch {
        scheduleReconnect();
      }

      // Watchdog treo-xác: browser EventSource có thể KHÔNG BAO GIỜ tự báo
      // lỗi nếu kết nối bị 1 middlebox âm thầm treo (xem docstring heartbeat
      // sửa ở services/zalo-bridge) — chủ động đóng+mở lại nếu quá lâu không
      // nhận được gì, thay vì trông chờ browser phát hiện hộ.
      if (staleCheckTimer) clearInterval(staleCheckTimer);
      staleCheckTimer = setInterval(() => {
        if (cancelled) return;
        if (Date.now() - lastEventAt > SSE_STALE_THRESHOLD_MS) {
          if (staleCheckTimer) {
            clearInterval(staleCheckTimer);
            staleCheckTimer = null;
          }
          if (currentSource) {
            try {
              currentSource.close();
            } catch {
              /* noop */
            }
            currentSource = null;
          }
          scheduleReconnect();
        }
      }, SSE_STALE_CHECK_INTERVAL_MS);
    }

    connect();
    sseRef.current = {
      close: () => {
        cancelled = true;
        cleanup();
        setSseState("closed");
      },
      // Buộc đóng + mở lại NGAY (bỏ qua hàng chờ backoff) — dùng khi tab lấy
      // lại focus mà SSE đang không "open" (xem effect visibilitychange bên
      // dưới). Phát hiện 2026-10-02: 1 tab/account có thể không hề có kết nối
      // SSE sống trong thời gian dài nếu tab không active (reconnect bị trì
      // hoãn/huỷ bởi trình duyệt khi ở nền) — tin nhóm vẫn vào DB bình thường
      // (bridge tự ghi thẳng, không phụ thuộc FE) nhưng UI không thấy cập
      // nhật tới khi tự refetch (lưới an toàn 45s) hoặc người dùng tải lại
      // trang. Reconnect ngay lúc focus giúp UI bắt kịp gần như tức thì.
      reconnect: () => {
        if (cancelled) return;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        retryAttempt = 0;
        if (currentSource) {
          try {
            currentSource.close();
          } catch {
            /* noop */
          }
          currentSource = null;
        }
        connect();
      },
    };

    return () => {
      cancelled = true;
      cleanup();
      setSseState("closed");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginStatus?.is_logged_in, accountId]);

  // ── Lưới an toàn: tự refetch định kỳ, ĐỘC LẬP với trạng thái SSE ───────────
  // (2026-09-30, cùng đợt fix "tin nhắn nhóm bị đứng ở ngày cũ" — xem watchdog
  // treo-xác ở effect trên). Dù SSE có tưởng như đang "open" hay không, cứ
  // mỗi RECONCILE_POLL_INTERVAL_MS lại refetch danh sách hội thoại + tin của
  // hội thoại đang mở 1 lần — đảm bảo UI tự về đúng dữ liệu thật trong tối đa
  // ~1 phút bất kể lỗi gì xảy ra ở tầng SSE (kể cả những ca chưa lường hết),
  // thay vì phụ thuộc HOÀN TOÀN vào push realtime như trước.
  useEffect(() => {
    const isAvailable = Boolean(loginStatus?.is_logged_in || (loginStatus?.status as string) === "confirmed" || (loginStatus?.status as string) === "connected");
    if (!isAvailable) return;
    const id = setInterval(() => {
      void refreshConversations();
      void refreshCurrentThread();
    }, RECONCILE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loginStatus?.is_logged_in, accountId, refreshConversations, refreshCurrentThread]);

  // true = user đã bấm "Huỷ kết nối" — importFromExtension() vẫn còn chạy dở
  // dưới nền (không có cách abort() nửa chừng chrome.runtime.sendMessage) nên
  // khi promise đó cuối cùng cũng settle (thành công/thất bại/timeout), phải
  // tự biết mà BỎ QUA kết quả trễ đó thay vì hiện toast/setAuthLoading gây
  // giật lại UI đã được user chủ động huỷ từ trước.
  const importCancelledRef = useRef(false);

  const importFromExtension = useCallback(async () => {
    const extApi = window as unknown as {
      __zaloExtension?: {
        isAvailable: () => boolean;
        ping: () => Promise<{ installed: boolean; version: string }>;
        importSession: (opts?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;
      };
      zaloExtension?: { importSession: (opts?: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }> };
    };

    let ext =
      extApi.__zaloExtension ??
      (extApi.zaloExtension
        ? {
            isAvailable: () => true,
            ping: () => Promise.resolve({ installed: true, version: "legacy" }),
            importSession: extApi.zaloExtension.importSession.bind(extApi.zaloExtension),
          }
        : null);

    if (!ext) {
      const isDomMarked = typeof document !== "undefined" && document.documentElement.getAttribute("data-zalo-extension-installed") === "true";
      const available = isDomMarked || (await isZaloExtensionAvailable());
      if (available) {
        ext = {
          isAvailable: () => true,
          ping: () => Promise.resolve({ installed: true, version: "1.2.4" }),
          importSession: async (opts?: Record<string, unknown>) => {
            try {
              const res = await importZaloSessionViaExtension({
                account_id: String(opts?.account_id || accountIdRef.current),
                owner_id: String(opts?.owner_id || accountIdRef.current),
                backend_url: String(opts?.backend_url || absoluteBridgeUrl()),
              });
              return { success: true, data: res };
            } catch (err: any) {
              return { success: false, error: err.message };
            }
          }
        };
      }
    }

    if (!ext) {
      showToast("Chưa cài extension Zalo. Cài extension từ thư mục extensions/extension-login-zalo (Chrome → Load unpacked).", false);
      return;
    }

    importCancelledRef.current = false;
    setAuthLoading(true);
    try {
      await ext.ping().catch(() => undefined);
      const bridgeUrl = absoluteBridgeUrl();
      const result = await ext.importSession({
        account_id: accountIdRef.current,
        owner_id: accountIdRef.current,
        backend_url: bridgeUrl,
        login_timeout_ms: 90_000,
      });
      if (importCancelledRef.current) return;
      if (result.success) {
        showToast("Đăng nhập Zalo thành công! Đang đồng bộ...", true);
        await pollAuth();
      } else {
        showToast(result.error || "Đăng nhập thất bại", false);
      }
    } catch (e) {
      if (importCancelledRef.current) return;
      showToast(e instanceof Error ? e.message : "Lỗi kết nối extension", false);
    } finally {
      if (!importCancelledRef.current) setAuthLoading(false);
    }
  }, [pollAuth, showToast]);

  /**
   * Huỷ 1 lượt importFromExtension() đang chạy dở — vd user lỡ đóng tab Zalo
   * giữa chừng, không muốn đợi tới hết login_timeout_ms (90s, có thể lâu hơn
   * nếu extension bị chậm) mới thấy nút "Đăng nhập Zalo" dùng lại được. Reset
   * UI NGAY LẬP TỨC + báo extension tự dọn cờ `importZaloInProgress` phía nó
   * (best-effort — thiếu bước này thì lần bấm "Đăng nhập Zalo" tiếp theo sẽ
   * dính lỗi "Import already in progress" cho tới khi extension tự nhả ra).
   */
  const cancelImportFromExtension = useCallback(async () => {
    importCancelledRef.current = true;
    setAuthLoading(false);
    showToast("Đã huỷ kết nối Zalo.", true);
    try {
      const extApi = window as unknown as { __zaloExtension?: { cancelImport?: () => Promise<unknown> } };
      await extApi.__zaloExtension?.cancelImport?.();
    } catch {
      // best-effort — extension cũ (không có cancelImport) hoặc lỗi mạng thì
      // vẫn đã huỷ được ở phía UI, chỉ là cờ phía extension sẽ tự nhả chậm hơn.
    }
  }, [showToast]);

  return {
    loginStatus,
    authLoading,
    authError,
    isLoggedIn: !!loginStatus?.is_logged_in,
    importFromExtension,
    cancelImportFromExtension,
    logout,
    refreshAuth: pollAuth,

    conversations,
    loadingConvs,
    fetchConversations,
    syncConversations,

    openConvId,
    openConversation,
    registerStrangerConversation,
    closeConversation,
    messages,
    loadingChat,
    sending,
    replyText,
    setReplyText,
    pendingFiles,
    setPendingFiles,
    pendingMentions,
    setPendingMentions,
    sendCurrentMessage,
    syncCurrentChat,
    refreshCurrentThread,
    markMessageRecalledLocally,
    applyReactionLocally,
    searchMessagesInThread,
    jumpToMessage,
    highlightedMessageId,
    updateConversationTags,
    updateConversationPin,
    replyingTo,
    setReplyingTo,
    cancelReply,

    sseState,
    reconnecting,
    reconnectBridge,

    toast,
    showToast,
  };
}
