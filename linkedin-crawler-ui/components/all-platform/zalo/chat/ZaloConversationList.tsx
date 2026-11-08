"use client";

/**
 * Ported từ components/zalo/chat/ZaloConversationList.tsx (app chính) — bỏ
 * nút "Broadcast" (ngoài scope module này) và nút "Chuyển tiếp" (thuộc
 * zalo-forward-module riêng, module này không có trang /forward-rules).
 *
 * Giao diện (2026-09-10): reskin pixel-match theo mockup TimeTech Chat
 * (timetich.html, khối `.conversation-list` / `.conv-item`) — nền
 * #f8fafc, ô tìm kiếm dạng viên thuốc, hàng hội thoại active có viền trái
 * xanh #0068ff + nền #e3edff. Không đổi logic tra số điện thoại / gửi Hi.
 */

import { AlertTriangle, Check, Loader2, MessageSquare, Pin, RefreshCcw, Search, Send, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ZaloConversation, ZaloStrangerUser, zaloApi } from "@/lib/zaloApiClient";
import { Avatar } from "./Avatar";
import { TagEditor, TagPill } from "./TagEditor";

interface Props {
  conversations: ZaloConversation[];
  loading: boolean;
  openConvId: string | null;
  onOpen: (id: string, known?: { name?: string | null; avatar?: string | null }) => void;
  onSync: () => void;
  accountId: string;
  /**
   * Gọi sau khi đã gửi "Hi" thành công cho người lạ — parent mở hội thoại đó.
   * Truyền kèm tên + avatar đã tra được: getUserInfo() KHÔNG resolve được người
   * chưa kết bạn, thiếu 2 giá trị này thì tên hội thoại rơi về "Zalo <uid>".
   */
  onStrangerMessaged: (conversationId: string, known: { name: string; avatar: string | null }) => void;
  /**
   * Gọi sau khi đã GỬI LỜI MỜI KẾT BẠN thành công (không phải gửi tin) — vẫn
   * cần tên/avatar đã tra được vì lý do y hệt onStrangerMessaged: lời mời kết
   * bạn kèm lời chào mặc định của Zalo sẽ vọng lại qua SSE dạng tin tự gửi
   * (is_self:true), lúc đó bridge/getUserInfo không tự tra được tên người
   * CHƯA kết bạn → hội thoại kẹt tên fallback "Zalo <uid>" nếu thiếu bước này.
   */
  onFriendRequestSent: (conversationId: string, known: { name: string; avatar: string | null }) => void;
  /** Ghi đè toàn bộ nhãn của 1 hội thoại — xem TagEditor.tsx. */
  onUpdateTags: (conversationId: string, tags: string[]) => void;
  /** Ghim/bỏ ghim 1 hội thoại lên đầu danh sách (giống Zalo). */
  onUpdatePin: (conversationId: string, isPinned: boolean) => void;
}

/**
 * Chuỗi nhập có "trông giống" số điện thoại VN không. Chỉ khi giống mới đi tra
 * server, để gõ tên hội thoại bình thường không tạo request rác.
 */
function asPhoneNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 12) return null;
  // Loại chuỗi có ký tự chữ (đang tìm theo tên, không phải số).
  if (/[a-zA-ZÀ-ỹ]/.test(raw)) return null;
  return digits;
}

/**
 * Dòng tin nhắn cuối hiện trong danh sách hội thoại, giống Zalo thật: "Bạn:
 * ..." nếu MÌNH gửi tin cuối (mọi loại hội thoại), "<Tên người gửi>: ..." nếu
 * là tin nhóm do người khác gửi (biết ai vừa nhắn mà không cần mở hội thoại),
 * hoặc chỉ nội dung thuần nếu là hội thoại 1-1 do đối phương gửi (đã biết rõ
 * đang chat với ai qua tên hội thoại, không cần lặp lại tên).
 */
function lastMessageLabel(c: ZaloConversation): string {
  const content = c.latest_content || (c.has_messages ? "..." : "Chưa có tin nhắn");
  if (!c.has_messages) return content;
  if (c.latest_is_self) return `Bạn: ${content}`;
  if (c.thread_type === "group" && c.latest_sender_name) return `${c.latest_sender_name}: ${content}`;
  return content;
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return "";
  const now = Date.now();
  const diff = (now - t) / 1000;
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} ngày`;
  return new Date(dateStr).toLocaleDateString("vi-VN");
}

export function ZaloConversationList({
  conversations,
  loading,
  openConvId,
  onOpen,
  onSync,
  accountId,
  onStrangerMessaged,
  onFriendRequestSent,
  onUpdateTags,
  onUpdatePin
}: Props) {
  const [query, setQuery] = useState("");
  const [stranger, setStranger] = useState<ZaloStrangerUser | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "not_found" | "error">("idle");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [addingFriendTo, setAddingFriendTo] = useState<string | null>(null);
  const [friendRequestSentTo, setFriendRequestSentTo] = useState<string | null>(null);
  const [activeTagFilters, setActiveTagFilters] = useState<Set<string>>(new Set());
  // Hội thoại (thread_id) có TIN NHẮN khớp `query` — cho phép tìm "mình đã
  // nhắn/nhận câu này với ai" khi không nhớ chính xác tên người/nhóm, không
  // chỉ lọc theo tên như trước. null = chưa tìm/không áp dụng (query rỗng
  // hoặc trông giống số điện thoại — nhánh đó đã có luồng tra riêng bên dưới).
  const [messageMatchThreadIds, setMessageMatchThreadIds] = useState<Set<string> | null>(null);
  const [searchingMessages, setSearchingMessages] = useState(false);

  // Toàn bộ nhãn account này đang dùng — nguồn gợi ý cho TagEditor + hàng chip lọc bên dưới.
  const allTags = useMemo(() => Array.from(new Set(conversations.flatMap((c) => c.tags || []))).sort(), [conversations]);

  function toggleTagFilter(tag: string) {
    setActiveTagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  // Gõ/paste số điện thoại → tra người dùng Zalo (kể cả chưa kết bạn).
  const phone = asPhoneNumber(query);

  // Yêu cầu người dùng: gõ SĐT của khách ĐÃ từng chat thì phải ra thẳng hội
  // thoại đang chat với khách đó, không chỉ mỗi thẻ "tra người lạ" (vốn dành
  // cho SĐT hoàn toàn mới). thread_id của hội thoại 1-1 CHÍNH LÀ uid Zalo
  // của đối phương — so trực tiếp với stranger.uid sau khi tra xong là biết ngay đã từng chat chưa.
  const phoneMatchConv = useMemo(
    () => (stranger ? conversations.find((c) => c.thread_id === stranger.uid) || null : null),
    [stranger, conversations]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = conversations;
    if (q) {
      list = list.filter((c) => {
        const nameMatches = (c.conversation_name || "").toLowerCase().includes(q);
        const msgMatches = !!messageMatchThreadIds?.has(c.thread_id);
        const phoneMatch = phoneMatchConv && (c.conversation_id === phoneMatchConv.conversation_id || c.thread_id === phoneMatchConv.thread_id);
        const threadMatch = c.thread_id === q || (phone ? c.thread_id === phone : false);
        return nameMatches || msgMatches || phoneMatch || threadMatch;
      });
    }
    // Lọc theo nhãn — CHỌN NHIỀU nhãn thì hiện hội thoại có ÍT NHẤT 1 trong số
    // đó (OR), hữu ích hơn AND khi cần "khách VIP HOẶC khách sắp hết hạn".
    if (activeTagFilters.size > 0) {
      list = list.filter((c) => (c.tags || []).some((t) => activeTagFilters.has(t)));
    }
    // Hội thoại ĐÃ GHIM luôn lên đầu (giống Zalo)
    if (list.some((c) => c.is_pinned)) {
      list = [...list].sort((a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned));
    }
    return list;
  }, [conversations, query, activeTagFilters, messageMatchThreadIds, phone, phoneMatchConv]);

  useEffect(() => {
    if (!phone) {
      setStranger(null);
      setLookupState("idle");
      setLookupError(null);
      setFriendRequestSentTo(null);
      return;
    }
    let cancelled = false;
    setLookupState("loading");
    setLookupError(null);
    setFriendRequestSentTo(null);
    const timer = setTimeout(async () => {
      try {
        const user = await zaloApi.findUserByPhone(phone, accountId);
        if (cancelled) return;
        setStranger(user);
        setLookupState(user ? "idle" : "not_found");
      } catch (e) {
        if (cancelled) return;
        setStranger(null);
        setLookupState("error");
        setLookupError(e instanceof Error ? e.message : "Không tra được số này");
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phone, accountId]);

  // Gõ chữ (không phải số điện thoại) → thử tìm luôn theo NỘI DUNG tin nhắn
  // đã nhắn/nhận, không chỉ lọc theo tên hội thoại đang hiện — vd nhớ đã
  // nhắn "haha" cho ai đó (1-1 hoặc nhóm) nhưng không nhớ tên. Debounce 500ms
  // giống ô tra số điện thoại ở trên. Bỏ qua khi trông giống số điện thoại
  // (nhánh đó đã có luồng riêng, tìm theo SĐT không phải theo nội dung).
  useEffect(() => {
    const q = query.trim();
    if (!q || phone) {
      setMessageMatchThreadIds(null);
      setSearchingMessages(false);
      return;
    }
    let cancelled = false;
    setSearchingMessages(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/zalo/conversations/search-by-message?account_id=${encodeURIComponent(accountId)}&q=${encodeURIComponent(q)}`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setMessageMatchThreadIds(new Set<string>(Array.isArray(data?.thread_ids) ? data.thread_ids : []));
      } catch {
        if (!cancelled) setMessageMatchThreadIds(new Set());
      } finally {
        if (!cancelled) setSearchingMessages(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, phone, accountId]);

    const triggerSearchByPhone = async (targetPhone: string) => {
    if (!targetPhone) return;
    setLookupState("loading");
    setLookupError(null);
    setFriendRequestSentTo(null);
    try {
      const user = await zaloApi.findUserByPhone(targetPhone, accountId);
      setStranger(user);
      setLookupState(user ? "idle" : "not_found");
    } catch (e) {
      setStranger(null);
      setLookupState("error");
      setLookupError(e instanceof Error ? e.message : "Không tra được số này");
    }
  };

  function handleOpenStrangerChat(user: ZaloStrangerUser) {
    onOpen(user.conversation_id, { name: user.display_name, avatar: user.avatar });
    setQuery("");
    setStranger(null);
  }

  async function handleSendHi(user: ZaloStrangerUser) {
    setSendingTo(user.uid);
    setLookupError(null);
    try {
      await zaloApi.sendMessage(user.conversation_id, "Hi", "user", accountId);
      setQuery("");
      setStranger(null);
      onStrangerMessaged(user.conversation_id, { name: user.display_name, avatar: user.avatar });
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Gửi tin thất bại");
    } finally {
      setSendingTo(null);
    }
  }

  async function handleAddFriend(user: ZaloStrangerUser) {
    setAddingFriendTo(user.uid);
    setLookupError(null);
    try {
      await zaloApi.sendFriendRequest(user.uid, accountId);
      setFriendRequestSentTo(user.uid);
      onFriendRequestSent(user.conversation_id, { name: user.display_name, avatar: user.avatar });
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Gửi lời mời kết bạn thất bại");
    } finally {
      setAddingFriendTo(null);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f8fafc]">
      <div className="shrink-0 border-b border-[#eef1f5] px-5 py-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#0a1a2b]">
            Hội thoại
            <span className="ml-1 text-[11px] font-normal text-[#8a9aa8]">({filtered.length})</span>
          </h3>
          <button
            onClick={onSync}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-[30px] border border-[#dce1e8] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4f5f71] transition hover:bg-[#f1f4f8] disabled:opacity-50"
          >
            <RefreshCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Sync
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-[30px] border border-[#dce1e8] bg-white px-4 py-1.5 transition focus-within:border-[#0068ff] focus-within:shadow-[0_0_0_3px_rgba(0,104,255,0.08)]">
          <Search className="h-4 w-4 shrink-0 text-[#8a9aa8]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && phone) {
                e.preventDefault();
                void triggerSearchByPhone(phone);
              }
            }}
            placeholder="Tìm theo tên, SĐT tra người lạ hoặc tin nhắn..."
            className="flex-1 bg-transparent py-1.5 text-sm text-[#0a1a2b] outline-none placeholder:text-[#a0b0c0]"
          />
          {phone ? (
            <button
              type="button"
              onClick={() => void triggerSearchByPhone(phone)}
              disabled={lookupState === "loading"}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0068ff] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#0057d6] disabled:opacity-50"
            >
              {lookupState === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              Tra SĐT
            </button>
          ) : lookupState === "loading" || searchingMessages ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#8a9aa8]" />
          ) : null}
        </div>

        {/* Số này ĐÃ có hội thoại rồi (khách quen) — ưu tiên hiện thẳng nút mở
            lại hội thoại đó thay vì thẻ "tra người lạ" bên dưới (dành cho SĐT
            hoàn toàn mới, chưa từng nhắn tin). */}
        {phone && phoneMatchConv ? (
          <button
            type="button"
            onClick={() => {
              onOpen(phoneMatchConv.conversation_id, { name: phoneMatchConv.conversation_name, avatar: phoneMatchConv.avatar_url });
              setQuery("");
            }}
            className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-[#bcd6ff] bg-[#e3edff] px-3 py-2.5 text-left transition hover:bg-[#d5e6ff]"
          >
            <Avatar src={phoneMatchConv.avatar_url} name={phoneMatchConv.conversation_name} className="h-9 w-9 shrink-0 text-sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[#0a1a2b]">{phoneMatchConv.conversation_name}</div>
              <div className="truncate text-xs text-[#6b7a8d]">Đã có hội thoại với số này — bấm để mở</div>
            </div>
            <MessageSquare className="h-4 w-4 shrink-0 text-[#0068ff]" />
          </button>
        ) : null}

        {/* Kết quả tra số điện thoại — bấm vào sẽ gửi "Hi" cho người đó. */}
        {phone && !phoneMatchConv && lookupState === "not_found" ? (
          <div className="mt-2 rounded-lg border border-[#dce1e8] bg-white px-3 py-2 text-xs text-[#6b7a8d]">
            Không tìm thấy tài khoản Zalo cho số này.
          </div>
        ) : null}

        {lookupError ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{lookupError}</span>
          </div>
        ) : null}

        {stranger && !phoneMatchConv ? (
          <div
            onClick={() => handleOpenStrangerChat(stranger)}
            className="mt-2.5 flex cursor-pointer flex-col gap-2 rounded-xl border border-[#bcd6ff] bg-[#f0f6ff] p-3 transition hover:border-[#0068ff] hover:bg-[#e6f0ff] hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <Avatar src={stranger.avatar} name={stranger.display_name} className="h-10 w-10 shrink-0 text-sm ring-2 ring-white" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-[#0a1a2b]">{stranger.display_name}</span>
                  {stranger.is_friend === true ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Bạn bè
                    </span>
                  ) : stranger.is_requested === true || friendRequestSentTo === stranger.uid ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Đã gửi lời mời
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                      Người lạ
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[#6b7a8d]">
                  <span className="font-mono font-medium text-[#0068ff]">{stranger.phone}</span>
                  <span>·</span>
                  <span className="text-slate-500">Bấm để mở chat trực tiếp</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-1.5 border-t border-[#d8e6fa] pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenStrangerChat(stranger);
                }}
                title={`Mở khung chat trực tiếp với ${stranger.display_name}`}
                className="inline-flex items-center gap-1 rounded-[30px] bg-[#0068ff] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0057d6] active:scale-95"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Nhắn tin
              </button>

              {stranger.is_friend !== true ? (() => {
                const alreadyRequested = friendRequestSentTo === stranger.uid || stranger.is_requested === true;
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleAddFriend(stranger);
                    }}
                    disabled={addingFriendTo === stranger.uid || alreadyRequested}
                    title={alreadyRequested ? "Đã gửi lời mời kết bạn, đang chờ chấp nhận" : `Kết bạn với ${stranger.display_name}`}
                    className="inline-flex items-center gap-1 rounded-[30px] border border-[#0068ff] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0068ff] transition hover:bg-[#eaf2ff] disabled:opacity-60"
                  >
                    {addingFriendTo === stranger.uid ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : alreadyRequested ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5" />
                    )}
                    {alreadyRequested ? "Đã gửi lời mời" : "Kết bạn"}
                  </button>
                );
              })() : null}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleSendHi(stranger);
                }}
                disabled={sendingTo === stranger.uid}
                title={`Gửi tin chào "Hi" nhanh tới ${stranger.display_name}`}
                className="inline-flex items-center gap-1 rounded-[30px] border border-[#dce1e8] bg-white px-2.5 py-1.5 text-xs font-medium text-[#4f5f71] transition hover:bg-[#f1f4f8] disabled:opacity-60"
              >
                {sendingTo === stranger.uid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Gửi Hi
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {allTags.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[#eef1f5] px-5 py-2.5">
          {allTags.map((t) => {
            const on = activeTagFilters.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTagFilter(t)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  on ? "border-[#0068ff] bg-[#0068ff] text-white" : "border-[#dce1e8] bg-white text-[#6b7a8d] hover:border-[#0068ff] hover:text-[#0068ff]"
                }`}
              >
                {t}
              </button>
            );
          })}
          {activeTagFilters.size > 0 ? (
            <button type="button" onClick={() => setActiveTagFilters(new Set())} className="text-[11px] text-[#8a9aa8] underline hover:text-[#4f5f71]">
              Bỏ lọc
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto py-2 overscroll-contain">
        {loading && conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-xs text-[#6b7a8d]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Đang tải...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[#6b7a8d]">
            <MessageSquare className="h-8 w-8 text-[#dce1e8]" />
            <p>{conversations.length === 0 ? "Chưa có hội thoại nào" : "Không tìm thấy"}</p>
            {conversations.length === 0 && (
              <button onClick={onSync} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#0068ff] hover:underline">
                <RefreshCcw className="h-3 w-3" />
                Sync ngay
              </button>
            )}
          </div>
        ) : (
          filtered.map((c) => {
            const active = c.conversation_id === openConvId;
            const tags = c.tags || [];
            // Tin NHẮN/HỘI THOẠI còn chưa đọc → in đậm tên + tin cuối, giống Zalo
            // (yêu cầu người dùng 2026-10-05: "tin nhắn mới kèm tên in đậm kèm số
            // lượng tin nhắn mới để biết" — số lượng đã có sẵn ở badge đỏ bên dưới).
            const hasUnread = c.unread_count > 0;
            return (
              // `<div role="button">` thay vì `<button>` thật — hàng này giờ
              // chứa TagEditor (cũng là 1 nút bấm), mà HTML KHÔNG cho phép
              // lồng <button> trong <button>.
              <div
                key={c.conversation_id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(c.conversation_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(c.conversation_id);
                  }
                }}
                className={`flex w-full cursor-pointer items-center gap-3.5 border-l-[3px] px-5 py-3 text-left transition ${
                  active ? "border-l-[#0068ff] bg-[#e3edff]" : "border-l-transparent hover:bg-[#eef2f7]"
                }`}
              >
                <Avatar src={c.avatar_url} name={c.conversation_name} className="h-12 w-12 shrink-0 text-base" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex min-w-0 items-center gap-1">
                      {c.is_pinned ? (
                        <Pin className="h-3 w-3 shrink-0 fill-[#0068ff] text-[#0068ff]" aria-label="Đã ghim" />
                      ) : null}
                      <div className={`truncate text-[15px] text-[#0a1a2b] ${hasUnread ? "font-bold" : "font-medium"}`}>{c.conversation_name || "Không tên"}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdatePin(c.conversation_id, !c.is_pinned);
                        }}
                        title={c.is_pinned ? "Bỏ ghim hội thoại" : "Ghim hội thoại lên đầu"}
                        className={`rounded-full p-1 transition hover:bg-[#dce7fb] ${c.is_pinned ? "text-[#0068ff]" : "text-[#c3ccd6] hover:text-[#0068ff]"}`}
                      >
                        <Pin className={`h-3.5 w-3.5 ${c.is_pinned ? "fill-current" : ""}`} />
                      </button>
                      <div className="text-xs text-[#8a9aa8]">{formatRelativeTime(c.latest_message_at)}</div>
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <div className={`truncate text-[13px] ${hasUnread ? "font-semibold text-[#1f2a3a]" : "text-[#6b7a8d]"}`}>{lastMessageLabel(c)}</div>
                    {c.unread_count > 0 && (
                      <span className="shrink-0 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                  {/* Gắn nhãn cho CẢ nhóm lẫn hội thoại 1-1 (trước đây chỉ 1-1) —
                      hữu ích để phân loại nhóm khách hàng/đối tác, không chỉ
                      từng người. */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {tags.slice(0, 3).map((t) => (
                      <TagPill key={t} tag={t} />
                    ))}
                    {tags.length > 3 ? <span className="text-[10px] text-[#a0b0c0]">+{tags.length - 3}</span> : null}
                    <TagEditor tags={tags} allTags={allTags} onChange={(next) => onUpdateTags(c.conversation_id, next)} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
