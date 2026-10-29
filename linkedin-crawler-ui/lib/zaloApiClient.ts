/**
 * Ported từ lib/zalo-api.ts của app chính — client gọi THẲNG zalo-bridge từ
 * browser (không qua Next.js server), dùng cho phần chat (nhắn tin/nhận tin)
 * mới thêm vào module này. Có port phần broadcast (xem sendBroadcast/
 * getBroadcastStatus bên dưới, dùng cho trang "Đăng nhiều nhóm") — module
 * này ĐA TÀI KHOẢN nên trang đó tự lặp gọi sendBroadcast() 1 lần/tài khoản
 * đã chọn (broadcast ở bridge vốn chỉ scope theo 1 accountId/request).
 *
 * BRIDGE_URL đọc từ NEXT_PUBLIC_ZALO_BRIDGE_URL — phải là URL bridge mà TRÌNH
 * DUYỆT gọi thẳng được (khác ZALO_BRIDGE_URL server-side dùng cho các route
 * proxy /api/accounts). Local: http://localhost:3001. Production: qua nginx
 * (vd https://timetech.markeeai.com/zalo-bridge) vì bridge không publish port
 * ra ngoài — xem ALLOWED_ORIGINS ở services/zalo-bridge phải whitelist origin
 * của module này.
 */

import type { ZaloAttachment, ZaloMessageKind } from "./zaloMessageContent";

function getClientBridgeUrl(): string {
  const envUrl = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ZALO_BRIDGE_URL : undefined;
  if (envUrl && envUrl.trim() && !envUrl.includes("localhost")) {
    return envUrl.replace(/\/+$/, "");
  }
  return "/api/all-platform/zalo";
}

const BRIDGE_URL = getClientBridgeUrl();

/**
 * URL bridge dạng TUYỆT ĐỐI — chỉ dùng khi đưa cho extension (`backend_url`),
 * và CHỈ dùng làm fallback (xem fetchJsonViaTab() trong background.js của
 * extension — đường chính giờ chạy fetch NGAY TRONG tab đang mở, không cần
 * URL tuyệt đối nữa, xem chi tiết bên dưới). BRIDGE_URL có thể là đường dẫn
 * tương đối ("/zalo-bridge") để fetch cùng origin trong trang, nhưng
 * extension fetch từ service worker của chính nó (origin chrome-extension://)
 * nên đường dẫn tương đối resolve sai và báo "Failed to fetch" — phải nối
 * với origin của trang trước khi truyền sang.
 *
 * LƯU Ý (2026-09-08, ĐỪNG lặp lại sai lầm này): domain chat.timetech.vn
 * đứng sau 1 WAF bên thứ 3 ("Oneshield") CHẶN mọi request có header
 * `Origin: chrome-extension://...`. Từng "fix" bằng cách trả về thẳng IP
 * nội bộ của bridge (http://10.30.195.41:8080/zalo-bridge) để né domain có
 * WAF — SAI, vì IP đó chỉ định tuyến được trong mạng nội bộ/VPN của hạ
 * tầng; máy có VPN đó test "thấy chạy" nhưng máy khách thật (không có VPN)
 * bị "Failed to fetch" (không kết nối được tới IP, không phải lỗi app).
 * Cách đúng đã chuyển sang xử lý ở PHÍA EXTENSION (chạy fetch ngay trong tab
 * đang mở để mang Origin thật của trang, né WAF mà không cần IP nội bộ nào
 * — xem fetchJsonViaTab() trong extensions/extension-login-zalo/background.js).
 * Hàm này CHỈ còn dùng làm URL fallback khi extension không relay qua tab
 * được — luôn phải resolve theo origin THẬT của trang (window.location),
 * KHÔNG hardcode IP nội bộ ở đây nữa.
 */
export function absoluteBridgeUrl(): string {
  if (/^https?:\/\//i.test(BRIDGE_URL)) return BRIDGE_URL;
  if (typeof window === "undefined") return BRIDGE_URL;
  return `${window.location.origin}${BRIDGE_URL.startsWith("/") ? "" : "/"}${BRIDGE_URL}`;
}

export class ZaloApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ZaloApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  formData?: FormData;
  timeoutMs?: number;
  accountId?: string;
};

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, formData, timeoutMs = 60_000, accountId } = opts;

  const finalHeaders: Record<string, string> = {
    "X-User-ID": accountId || "shop-owner",
  };
  if (!formData && !finalHeaders["Content-Type"]) {
    finalHeaders["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Thông báo chung cho MỌI lỗi ở tầng kết nối/bridge (timeout, bridge crash/
  // không phản hồi, zca-js lỗi nội bộ 5xx) — trước đây các lỗi này lộ ra
  // nguyên văn ("Failed to fetch", "The operation was aborted", stacktrace
  // zca-js...) khiến nhân viên không biết phải làm gì. Yêu cầu người dùng
  // 2026-09-22: "khi nào gửi tin nhắn hay hình qua mà bị lỗi ko đồng bộ bên
  // zalo thì báo lỗi là 'Kết nối không ổn định do bridge quá tải'". KHÔNG áp
  // dụng cho lỗi 4xx (validation hợp lệ như "text is required") — những lỗi
  // đó cần giữ nguyên để còn sửa được input.
  const BRIDGE_OVERLOAD_MESSAGE = "Kết nối không ổn định do bridge quá tải, vui lòng thử lại sau ít phút.";

  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: formData ? formData : body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // fetch() ném lỗi khi: hết timeoutMs (AbortError), bridge không phản hồi
    // được kết nối (connection refused/reset), mất mạng... — không phân biệt
    // được nguyên nhân cụ thể từ phía client, nên gộp chung 1 thông báo.
    throw new ZaloApiError(BRIDGE_OVERLOAD_MESSAGE, 0);
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    // Bridge CÓ phản hồi (không phải lỗi kết nối ở catch() phía trên) — nếu
    // trả kèm lý do cụ thể (vd "người này chặn tin nhắn từ người lạ", lỗi
    // thật từ Zalo) thì PHẢI hiện đúng lý do đó. Bug thật đã xác nhận qua log
    // production 2026-10-06: mọi lỗi ≥500 trước đây bị thay cứng thành
    // "Kết nối không ổn định do bridge quá tải" dù bridge đã trả rõ nguyên
    // nhân thật trong body — làm sai lệch hẳn chẩn đoán (tưởng hạ tầng quá
    // tải, thực ra là Zalo chặn/từ chối 1 hành động cụ thể). Chỉ fallback về
    // thông báo chung khi bridge KHÔNG kèm được lý do gì (crash/treo thật sự).
    const bodyMsg =
      (isJson && (payload?.detail || payload?.message || payload?.error)) ||
      (typeof payload === "string" && payload.trim() ? payload : null);
    if (res.status >= 500) {
      throw new ZaloApiError(bodyMsg ? String(bodyMsg) : BRIDGE_OVERLOAD_MESSAGE, res.status, isJson ? payload?.code : undefined, isJson ? payload : undefined);
    }
    throw new ZaloApiError(bodyMsg ? String(bodyMsg) : `HTTP ${res.status}`, res.status, isJson ? payload?.code : undefined, isJson ? payload : undefined);
  }
  return payload as T;
}

export type ZaloLoginStatus = {
  user_id: string;
  session_id: string | null;
  status: "not_logged_in" | "waiting_scan" | "confirmed" | "session_expired";
  is_logged_in: boolean;
  session_expired: boolean;
  qr_base64?: string | null;
  zalo_id?: string;
  display_name?: string;
  inbox_id?: number | string | null;
};

/** Kết quả tra số điện thoại — có thể là người CHƯA kết bạn. */
export type ZaloStrangerUser = {
  uid: string;
  /** Dạng "u:<uid>" — dùng thẳng làm conversation_id khi gửi tin. */
  conversation_id: string;
  display_name: string;
  avatar: string | null;
  /** Số đã chuẩn hoá về dạng 84... */
  phone: string;
  /** null = không xác định được trạng thái bạn bè. */
  is_friend: boolean | null;
  /** true = MÌNH đã gửi lời mời kết bạn, đang chờ họ chấp nhận. */
  is_requesting?: boolean | null;
  /** true = HỌ đã gửi lời mời kết bạn, đang chờ mình chấp nhận. */
  is_requested?: boolean | null;
};

/** Trạng thái bạn bè tra theo uid đã biết (dùng cho header hội thoại đang mở). */
export type ZaloFriendStatus = {
  ok: boolean;
  uid: string;
  is_friend: boolean | null;
  is_requesting: boolean | null;
  is_requested: boolean | null;
};

export type ZaloConversation = {
  conversation_id: string;
  conversation_name: string;
  account_id: string;
  thread_id: string;
  thread_type: "user" | "group";
  message_count: number;
  latest_message_at?: string | null;
  latest_content?: string | null;
  latest_sender_name?: string | null;
  latest_is_self?: boolean;
  has_messages: boolean;
  avatar_url?: string | null;
  unread_count: number;
  last_message_ts?: string | number | null;
  /** Nhãn phân loại khách hàng do nhân viên tự gắn (vd "Khách VIP", "Đã mua")
   *  — dùng để lọc lại danh sách bạn bè khi gửi tin mời mua hàng hàng loạt,
   *  xem TagEditor.tsx + bulk-send/page.tsx. */
  tags?: string[];
  /** Ghim lên đầu danh sách (giống Zalo) — cột có sẵn từ lâu
   *  (migrations/2026-09-06_chat.sql) nhưng trước đây chỉ ĐỌC được, chưa có
   *  API/UI để GHI, xem .../[conversationId]/pin/route.ts. */
  is_pinned?: boolean;
};

export type ZaloMessage = {
  message_id: string;
  sender_id?: string | null;
  sender_name?: string | null;
  timestamp?: string | null;
  time_text?: string | null;
  /** Epoch ms — dùng để "nhảy tới" 1 tin cụ thể từ kết quả tìm kiếm (xem
   *  jumpToMessage ở useZalo.ts, tham số `around_ts` ở app/api/zalo/messages). */
  ts?: number | string | null;
  /** ThreadType của row ('group' | 'webchat') — KHÔNG phải loại tin nhắn. */
  type: string;
  content?: string | null;
  image_urls?: string[];
  /**
   * Loại tin nhắn đã chuẩn hoá + đính kèm đã dựng sẵn (API /api/zalo/messages
   * trả về, xem normalizeStoredMessage ở src/lib/zaloMessageContent.ts).
   * UI chat render theo 2 field này; `image_urls` chỉ còn là dữ liệu thô.
   */
  msg_kind?: ZaloMessageKind;
  attachments?: ZaloAttachment[];
  /** Chỉ có khi msg_kind === "system_notice" — dòng chữ hiện căn giữa
   *  (vd "Bạn vừa kết bạn với Võ Hường", "Lan đang bình chọn"), xem
   *  ZaloChatPanel.tsx MessageBubble. */
  system_text?: string | null;
  /** Chỉ có khi msg_kind === "unknown" và tin là thẻ "zinstant" (vd danh
   *  thiếp ngân hàng) — nhãn cụ thể Zalo tự cung cấp, thay cho "Tin nhắn
   *  dạng đặc biệt" chung chung, xem zinstantFallbackLabel(). */
  unknown_label?: string | null;
  /**
   * id do CLIENT sinh khi gửi — cần kèm `message_id` (msgId do server Zalo
   * gán) để gọi thu hồi (zaloApi.recallMessage). null/undefined = tin CŨ gửi
   * trước khi bridge persist cột này, hoặc tin của NGƯỜI KHÁC (chỉ tự thu hồi
   * được tin của mình) — ẩn nút "Thu hồi" trong 2 trường hợp này.
   */
  cli_msg_id?: string | null;
  is_sent: boolean;
  is_deleted: boolean;
  group_id?: string | null;
  /** Tổng hợp cảm xúc đã thả vào tin này, vd {like: 2, heart: 1} — null nếu
   *  chưa ai thả. Xem app/api/zalo/messages/route.ts. */
  reactions?: Record<string, number> | null;
  /** Cảm xúc CHÍNH TÀI KHOẢN ZALO này đã thả (không phải nhân viên đang đăng
   *  nhập) — null nếu chưa thả gì. */
  my_reaction?: string | null;
  /**
   * Preview của tin ĐANG ĐƯỢC TRẢ LỜI (nếu tin này là 1 reply) — dựng sẵn ở
   * bridge từ `data.quote` thô của Zalo (xem buildQuotePreview() ở
   * supabaseSync.js). null = tin thường, không phải reply.
   */
  quote?: {
    from_uid?: string | null;
    from_name?: string | null;
    cli_msg_id?: string | null;
    global_msg_id?: string | null;
    ts?: number | null;
    text?: string | null;
  } | null;
};

/**
 * Tin đang được TRẢ LỜI (quote) — chọn bằng cách kéo 1 tin từ trái sang phải
 * trong khung chat (xem MessageBubble ở ZaloChatPanel.tsx). Đủ field để bridge
 * dựng lại đối tượng `quote` mà zca-js `sendMessage()` cần (uidFrom/msgId/
 * cliMsgId/ts/content) — xem POST .../send route ở zalo-bridge.
 */
export type ZaloReplyTarget = {
  message_id: string;
  cli_msg_id: string;
  sender_id: string;
  /** Preview ngắn hiện trong thanh "Đang trả lời" — text thật, hoặc nhãn
   *  dạng "[Hình ảnh]" cho tin không phải text (xem kindLabel ở
   *  zaloMessageContent.ts). Cũng CHÍNH LÀ nội dung Zalo hiện trong khung
   *  trích dẫn ở tin trả lời thật — cố ý luôn là string để tránh nhánh lỗi
   *  của zca-js khi content không phải string (xem ghi chú ở bridge route). */
  preview: string;
  sender_name?: string | null;
  ts?: number | string | null;
};

/** Đúng 6 loại cảm xúc UI cho thả — khớp REACTION_MAP ở
 *  services/zalo-bridge/src/routes/zalo-client.js, đổi 1 bên nhớ đổi bên kia. */
export const REACTION_OPTIONS: { key: string; emoji: string; label: string }[] = [
  { key: "like", emoji: "👍", label: "Thích" },
  { key: "heart", emoji: "❤️", label: "Yêu thích" },
  { key: "haha", emoji: "😆", label: "Haha" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "sad", emoji: "😢", label: "Buồn" },
  { key: "angry", emoji: "😠", label: "Phẫn nộ" },
];
const REACTION_EMOJI: Record<string, string> = Object.fromEntries(REACTION_OPTIONS.map((r) => [r.key, r.emoji]));
export function emojiForReaction(key: string): string {
  return REACTION_EMOJI[key] || "👍";
}

export type ZaloSticker = { id: number; cateId: number; type: number; url?: string | null };

export const zaloApi = {
  async getLoginStatus(accountId: string): Promise<ZaloLoginStatus> {
    return request<ZaloLoginStatus>(`/api/all-platform/zalo/auth/status?account_id=${encodeURIComponent(accountId)}`, {
      accountId,
    });
  },

  async logout(accountId: string): Promise<{ success: boolean }> {
    return request(`/auth/logout/${encodeURIComponent(accountId)}`, { method: "DELETE", accountId });
  },

  async reconnect(accountId: string): Promise<{
    ok: boolean;
    before: string | null;
    after: string | null;
    is_logged_in: boolean;
    is_ws_connected: boolean;
    error?: string;
  }> {
    return request("/api/all-platform/zalo/auth/reconnect", { method: "POST", body: { account_id: accountId }, accountId });
  },

  async getConversations(limit: number, accountId: string): Promise<{ account_id: string; conversations: ZaloConversation[]; total: number }> {
    return request(`/api/all-platform/zalo/conversations?account_id=${encodeURIComponent(accountId)}&limit=${limit}`, { accountId });
  },

  async getMessages(conversationId: string, limit: number = 100, accountId: string, threadType?: "user" | "group"): Promise<{ messages: ZaloMessage[] }> {
    const qs = `limit=${limit}&account_id=${encodeURIComponent(accountId)}${threadType ? `&thread_type=${threadType}` : ""}`;
    return request(
      `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/messages?${qs}`,
      { accountId }
    );
  },

  async syncConversations(accountId: string): Promise<{ account_id: string; groups_count: number; friends_count: number; total: number }> {
    return request(`/api/all-platform/zalo/conversations/sync?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      accountId,
    });
  },

  async getGroupInfo(groupId: string, accountId: string): Promise<{ ok: boolean; thread_id: string; thread_type: "group"; group_name: string; avatar_url: string | null } | null> {
    if (!groupId) return null;
    try {
      const data = await request<{ ok: boolean; thread_id: string; thread_type: "group"; group_name: string; avatar_url: string | null }>(
        `/api/all-platform/zalo/group-info?account_id=${encodeURIComponent(accountId)}&group_id=${encodeURIComponent(groupId)}`,
        { timeoutMs: 10_000, accountId }
      );
      return data && data.ok ? data : null;
    } catch {
      return null;
    }
  },

  /**
   * Quét TOÀN BỘ thành viên 1 nhóm (không bị giới hạn lazy-load như app Zalo)
   * — dùng cho trang "Quét thành viên nhóm". zca-js không phân biệt được
   * thành viên "ẩn" (không có khái niệm này trong thư viện, đã rà soát kỹ —
   * chỉ có "ẩn hội thoại" là tính năng khác hẳn) nên trả về TẤT CẢ thành
   * viên nhóm, không lọc theo tiêu chí riêng tư nào.
   *
   * 2 cách chỉ định nhóm (đúng 1 trong 2): `group_id` (chọn từ danh sách
   * nhóm tài khoản đang tham gia) hoặc `group_link` (dán link mời tham gia
   * — quét được cả nhóm mà tài khoản CHƯA là thành viên, xem `joinIfNeeded`).
   *
   * ĐÃ VƯỢT ĐƯỢC giới hạn cũ (2026-09-09): bridge giờ quét qua endpoint
   * `group/link/ginfo` (phân trang thật bằng `mpage`, xem
   * services/zalo-bridge/src/routes/zalo-client.js scanAllMembersViaLink())
   * thay vì `getGroupInfo` (Zalo tự cắt còn vài người với nhóm > ~155-200
   * thành viên).
   *
   * GIỚI HẠN THẬT KHÁC (xác nhận trực tiếp trên production, nhóm 354 người):
   * endpoint group/link/ginfo CHỦ Ý ẨN danh sách thành viên (chỉ trả
   * total_member, currentMems rỗng) với tài khoản CHƯA tham gia nhóm — đây
   * là Zalo bảo vệ riêng tư, không phải bug. Cách duy nhất vượt được: tài
   * khoản phải THẬT SỰ tham gia nhóm trước khi quét được — set
   * `joinIfNeeded: true` để bridge tự gọi joinGroupLink() rồi quét lại (side
   * effect thật: nhóm sẽ thấy tài khoản mới tham gia — CHỈ bật khi người
   * dùng chủ động chọn, xem checkbox ở scan-group-members/page.tsx). Nhóm
   * bật duyệt thành viên thì join xong vẫn cần admin duyệt — response trả
   * `needs_approval: true` cho trường hợp này.
   *
   * GIỚI HẠN KHÔNG THỂ VƯỢT (xác nhận thật, nhóm "Cộng Đồng Fanzone Event",
   * type=2/GroupType.Community): "Cộng đồng" Zalo (khác Nhóm thường) có cấu
   * trúc chi nhánh/kênh riêng — group/link/ginfo KHÔNG trả danh sách thành
   * viên phẳng cho loại này, KỂ CẢ SAU KHI tự tham gia (đã test: join xong
   * vẫn chỉ thấy 1/355 người — chính tài khoản vừa vào). zca-js hiện không
   * có API nào khác đọc được thành viên Cộng đồng — lỗi `is_community: true`
   * cho trường hợp này, không phải bug, không có cách vượt qua ở bản này.
   */
  async getGroupMembers(
    target: { group_id: string } | { group_link: string; joinIfNeeded?: boolean },
    accountId: string
  ): Promise<{
    ok: boolean;
    group_id: string;
    group_name: string;
    total_member: number;
    members: Array<{
      uid: string;
      display_name: string | null;
      avatar: string | null;
      is_admin: boolean;
      role?: string;
      zalo_name?: string;
    }>;
    truncated: boolean;
    scan_method?: string;
    joined_now?: boolean;
    needs_approval?: boolean;
    is_community?: boolean;
    error?: string;
  }> {
    const qs =
      "group_id" in target
        ? `group_id=${encodeURIComponent(target.group_id)}`
        : `group_link=${encodeURIComponent(target.group_link)}${target.joinIfNeeded ? "&join_if_needed=1" : ""}`;
    return request(
      `/api/all-platform/zalo/group-members?account_id=${encodeURIComponent(accountId)}&${qs}`,
      // Quét nhóm rất đông có thể cần lặp hàng chục/hàng trăm trang (mỗi
      // trang cách nhau ~350ms phía bridge) — 30s cũ không đủ, nới lên 3 phút.
      { timeoutMs: 180_000, accountId }
    );
  },

  async getUserInfo(userId: string, accountId: string): Promise<{ ok: boolean; thread_id: string; thread_type: "user"; user_name: string; avatar_url: string | null } | null> {
    if (!userId) return null;
    try {
      const data = await request<{ ok: boolean; thread_id: string; thread_type: "user"; user_name: string; avatar_url: string | null }>(
        `/api/all-platform/zalo/user-info?account_id=${encodeURIComponent(accountId)}&user_id=${encodeURIComponent(userId)}`,
        { timeoutMs: 10_000, accountId }
      );
      return data && data.ok ? data : null;
    } catch {
      return null;
    }
  },

  async syncMessages(): Promise<{ synced: number }> {
    // Bridge không có route /sync-messages riêng — no-op, giữ để giữ đúng
    // signature gọi từ hook (matching hành vi bản gốc).
    return { synced: 0 };
  },

  /**
   * Tìm người theo SỐ ĐIỆN THOẠI — dùng được cả với người CHƯA kết bạn
   * (bridge gọi zca-js `findUser`, xem GET /all-platform/zalo/find-user).
   * Trả về null khi số không có tài khoản Zalo hoặc người đó bật ẩn thông tin
   * (bridge trả 404) — phân biệt với lỗi thật để UI hiện đúng thông báo.
   */
  async findUserByPhone(phone: string, accountId: string): Promise<ZaloStrangerUser | null> {
    try {
      const res = await request<{ ok: boolean; user: ZaloStrangerUser }>(
        `/api/all-platform/zalo/find-user?phone=${encodeURIComponent(phone)}&account_id=${encodeURIComponent(accountId)}`,
        { accountId }
      );
      return res?.user ?? null;
    } catch (e) {
      if (e instanceof ZaloApiError && e.status === 404) return null;
      throw e;
    }
  },

  /**
   * Gửi lời mời kết bạn (KHÔNG kèm tin nhắn) tới 1 uid đã biết — dùng cho nút
   * "Kết bạn" trên kết quả tra số điện thoại (bridge route
   * friend-request-only-by-uid, xem services/zalo-bridge/src/routes/zalo-client.js).
   * Bridge tự coi "đã là bạn bè/đã gửi lời mời" là thành công (ok:true), nên
   * lỗi ném ra ở đây là lỗi thật (mạng, tài khoản chưa login, Zalo từ chối...).
   */
  async sendFriendRequest(uid: string, accountId: string, message?: string): Promise<{ ok: boolean; uid: string }> {
    return request(`/api/all-platform/zalo/action/friend-request-only-by-uid?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      body: { uid, ...(message ? { message } : {}) },
      accountId,
    });
  },

  /**
   * Chấp nhận lời mời kết bạn HỌ đã gửi cho mình (khác sendFriendRequest —
   * đây là khi getFriendStatus trả `is_requesting: true`, xem ghi chú ở
   * FriendStatusBadge trong ZaloChatPanel.tsx).
   */
  async acceptFriendRequest(uid: string, accountId: string): Promise<{ ok: boolean; uid: string }> {
    return request(`/api/all-platform/zalo/action/accept-friend-request-by-uid?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      body: { uid },
      accountId,
    });
  },

  /**
   * Tra trạng thái bạn bè theo uid đã biết — dùng để hiện huy hiệu "Bạn bè /
   * Chưa kết bạn / Đã gửi lời mời" trên header hội thoại đang mở (khác
   * findUserByPhone: không cần biết số điện thoại, chỉ cần uid đã có sẵn từ
   * ZaloConversation.thread_id).
   */
  async getFriendStatus(uid: string, accountId: string): Promise<ZaloFriendStatus | null> {
    try {
      return await request<ZaloFriendStatus>(
        `/api/all-platform/zalo/friend-status?uid=${encodeURIComponent(uid)}&account_id=${encodeURIComponent(accountId)}`,
        { accountId }
      );
    } catch {
      return null;
    }
  },

  async sendMessage(
    conversationId: string,
    text: string,
    threadType: "user" | "group",
    accountId: string,
    /** Tag thành viên/@All đã chèn qua MentionPicker — {pos,uid,len} theo
     *  đúng offset ký tự trong `text` (xem resolvePendingMentions ở
     *  src/lib/mentionUtils.ts). Chỉ có tác dụng với tin nhóm — bridge/zca-js
     *  tự bỏ qua nếu threadType khác 'group'. */
    mentions?: Array<{ uid: string; pos: number; len: number }>,
    /** Trả lời (quote) 1 tin đã có — kéo tin từ trái sang phải trong khung
     *  chat để chọn (xem ZaloChatPanel.tsx). Cần cả msg_id lẫn cli_msg_id
     *  (giống recall/react — tin quá cũ thiếu cli_msg_id thì không quote được). */
    replyTo?: ZaloReplyTarget
  ): Promise<{ ok: boolean; conversation_id: string; message: string }> {
    return request(
      `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/send?account_id=${encodeURIComponent(accountId)}`,
      {
        method: "POST",
        body: {
          text,
          thread_type: threadType,
          ...(mentions && mentions.length > 0 ? { mentions } : {}),
          ...(replyTo ? { reply_to: replyTo } : {}),
        },
        accountId,
      }
    );
  },

  /**
   * THU HỒI 1 tin nhắn của MÌNH đã gửi — khác hẳn "xoá ở phía tôi" (thu hồi
   * làm tin biến mất ở CẢ HAI bên thật sự trên Zalo). Cần cả `msgId` (=
   * message_id/source_message_id) lẫn `cliMsgId` (chỉ tin nhắn gửi SAU khi
   * bridge bắt đầu persist cột này mới có — xem ZaloMessage.cli_msg_id).
   */
  async recallMessage(conversationId: string, msgId: string, cliMsgId: string, threadType: "user" | "group", accountId: string): Promise<{ ok: boolean }> {
    return request(
      `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/recall?account_id=${encodeURIComponent(accountId)}`,
      {
        method: "POST",
        body: { msg_id: msgId, cli_msg_id: cliMsgId, thread_type: threadType },
        accountId,
      }
    );
  },

  /**
   * Thả cảm xúc vào 1 tin — `reaction` là 1 key trong REACTION_OPTIONS, hoặc
   * `"none"` để GỠ cảm xúc đã thả trước đó. Cần cả `msgId`+`cliMsgId` (giống
   * hệt recallMessage — tin quá cũ chưa có cli_msg_id thì không thả được).
   */
  async reactToMessage(conversationId: string, msgId: string, cliMsgId: string, reaction: string, threadType: "user" | "group", accountId: string): Promise<{ ok: boolean }> {
    return request(
      `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/react?account_id=${encodeURIComponent(accountId)}`,
      {
        method: "POST",
        body: { msg_id: msgId, cli_msg_id: cliMsgId, reaction, thread_type: threadType },
        accountId,
      }
    );
  },

  /** Tìm nhãn dán theo từ khoá (picker gửi sticker) — chưa kèm URL ảnh, gọi
   *  `resolveStickerUrls()` sau đó để có ảnh hiện lên picker. */
  async searchStickers(query: string, accountId: string): Promise<ZaloSticker[]> {
    const res = await request<{ ok: boolean; stickers: ZaloSticker[] }>(
      `/api/all-platform/zalo/sticker-search?q=${encodeURIComponent(query)}&account_id=${encodeURIComponent(accountId)}`,
      { accountId }
    );
    return res?.stickers || [];
  },

  /** Resolve URL ảnh cho 1 danh sách sticker id (tái dùng đúng endpoint dùng
   *  để hiện sticker trong lịch sử chat). */
  async resolveStickerUrls(ids: number[], accountId: string): Promise<Record<number, string>> {
    if (ids.length === 0) return {};
    const res = await request<{ stickers: Record<string, string> }>(
      `/api/all-platform/zalo/stickers?ids=${ids.join(",")}&account_id=${encodeURIComponent(accountId)}`,
      { accountId }
    ).catch(() => null);
    const out: Record<number, string> = {};
    for (const [id, url] of Object.entries(res?.stickers || {})) out[Number(id)] = url;
    return out;
  },

  /** Gửi 1 nhãn dán (chọn từ picker) vào ĐÚNG 1 hội thoại đang mở — tin gửi ra
   *  tự về qua SSE `new_message` bình thường, không cần xử lý response ở đây. */
  async sendSticker(conversationId: string, sticker: { id: number; cateId: number; type: number }, threadType: "user" | "group", accountId: string): Promise<{ ok: boolean }> {
    return request(
      `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/send-sticker?account_id=${encodeURIComponent(accountId)}`,
      { method: "POST", body: { sticker, thread_type: threadType }, accountId }
    );
  },

  async sendMedia(conversationId: string, files: File[], text: string | undefined, threadType: "user" | "group", accountId: string): Promise<{ ok: boolean; files_sent: number; message: string }> {
    const fd = new FormData();
    if (text) fd.append("text", text);
    fd.append("thread_type", threadType);
    files.forEach((f) => fd.append("files", f, f.name));
    return request(
      `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/send-media?account_id=${encodeURIComponent(accountId)}`,
      { method: "POST", formData: fd, timeoutMs: 120_000, accountId }
    );
  },

  /**
   * Chuyển tiếp THỦ CÔNG 1 tin nhắn (nội dung + đính kèm) tới NHIỀU hội thoại
   * tự chọn — bấm nút "Chuyển tiếp" trên 1 bong bóng chat rồi tick chọn đích
   * (ForwardMessageModal.tsx). KHÁC HẲN tính năng "Chuyển tiếp" tự động của
   * services/zalo-forward-module (rule nhóm→nhóm chạy nền) — đây là 1 lần,
   * do nhân viên chủ động chọn ngay lúc đang xem tin.
   */
  async forwardMessage(
    targets: Array<{ thread_id: string; thread_type: "user" | "group" }>,
    text: string,
    attachments: ZaloAttachment[] | undefined,
    accountId: string
  ): Promise<{ success: Array<{ threadId: string }>; fail: Array<{ threadId: string; error: string }> }> {
    return request(`/api/all-platform/zalo/forward-message?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      body: { targets, text, ...(attachments && attachments.length > 0 ? { attachments } : {}) },
      accountId,
      timeoutMs: 120_000,
    });
  },

  async markRead(conversationId: string, accountId: string): Promise<{ ok: boolean }> {
    return request(
      `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/read?account_id=${encodeURIComponent(accountId)}`,
      { method: "POST", accountId }
    );
  },

  openEventSource(accountId: string): EventSource {
    const url = `${BRIDGE_URL}/api/all-platform/zalo/events?account_id=${encodeURIComponent(accountId)}`;
    return new EventSource(url, { withCredentials: false });
  },

  /**
   * Gửi 1 tin (chữ + ảnh, tuỳ chọn) tới NHIỀU nhóm/người cùng lúc, cho 1 tài
   * khoản. Bridge xử lý ASYNC (trả về ngay campaign_id, gửi nền tuần tự có
   * giãn cách — xem ZALO_BROADCAST_DELAY_MS ở services/zalo-bridge), poll
   * tiến độ bằng getBroadcastStatus(). Đa tài khoản = gọi hàm này nhiều lần,
   * mỗi lần 1 accountId khác nhau (xem BroadcastGroupsPage).
   */
  async sendBroadcast(
    targets: Array<{ id: string; thread_type: "user" | "group" }>,
    text: string,
    images: File[],
    accountId: string
  ): Promise<{ campaign_id: string; status: string; total_targets: number; total_messages: number; total_jobs: number }> {
    const fd = new FormData();
    fd.append("meta", JSON.stringify({ messages: [{ text }], targets }));
    images.forEach((f) => fd.append("attachments_0", f, f.name));
    return request(`/api/all-platform/zalo/broadcasts?account_id=${encodeURIComponent(accountId)}`, {
      method: "POST",
      formData: fd,
      timeoutMs: 120_000,
      accountId,
    });
  },

  async getBroadcastStatus(
    campaignId: string,
    accountId: string
  ): Promise<{
    campaign_id: string;
    status: "pending" | "running" | "completed";
    total: number;
    sent: number;
    failed: number;
    errors: string[];
    current_message: number;
    total_messages: number;
  }> {
    return request(
      `/api/all-platform/zalo/broadcasts/${encodeURIComponent(campaignId)}?account_id=${encodeURIComponent(accountId)}`,
      { accountId }
    );
  },

  /** Quản lý danh sách tài khoản Zalo đa người dùng */
  async listAccounts(): Promise<{ accounts: any[] }> {
    return request(`/auth/accounts`);
  },

  async createAccount(data: { accountId: string; displayName?: string; phone?: string }): Promise<{ account: any }> {
    return request(`/auth/accounts`, {
      method: "POST",
      body: data,
    });
  },

  async updateAccount(accountId: string, patch: { displayName?: string; phone?: string }): Promise<{ account: any }> {
    return request(`/auth/accounts/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: patch,
      accountId,
    });
  },

  async deleteAccount(accountId: string): Promise<{ removed: boolean }> {
    return request(`/auth/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      accountId,
    });
  },

  async getAccountStatus(accountId: string): Promise<any> {
    return request(`/auth/accounts/${encodeURIComponent(accountId)}`, { accountId });
  },
};
