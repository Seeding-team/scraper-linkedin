import { API_BASE_URL } from "@/lib/env";
import type { ApiResponse } from "@/types/unified.types";
import type {
  WhatsAppAccount,
  WhatsAppAccountStatusResult,
  WhatsAppCallLog,
  WhatsAppConversation,
  WhatsAppConversationFilter,
  WhatsAppConversationPatch,
  WhatsAppGroupInfo,
  WhatsAppMediaSendType,
  WhatsAppMessage,
  WhatsAppOutboundCallResult,
  WhatsAppQuickReply,
  WhatsAppSettingsPatch,
} from "@/types/whatsapp";

const BASE = `${API_BASE_URL}/api/all-platform/whatsapp`;

function enc(val: string): string {
  return encodeURIComponent(val);
}

async function requestJson<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  try {
    const isFormData = init?.body instanceof FormData;
    const res = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers || {}),
      },
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && raw.success === undefined) {
      const detail =
        typeof raw.detail === "string"
          ? raw.detail
          : typeof raw.message === "string"
            ? raw.message
            : `Lỗi máy chủ (${res.status})`;
      return { success: false, message: detail } as ApiResponse<T>;
    }
    if (raw.success === undefined) {
      return { success: res.ok, data: raw as unknown as T } as ApiResponse<T>;
    }
    return raw as unknown as ApiResponse<T>;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Không kết nối được máy chủ WhatsApp.",
    } as ApiResponse<T>;
  }
}

export function extractArray<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (key && Array.isArray(obj[key])) return obj[key] as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
  }
  return [];
}

export function resolveWhatsAppMediaUrl(
  mediaUrl?: string | null,
  accountId?: string | null,
  messageId?: string | null,
): string | null {
  if (mediaUrl && mediaUrl.trim()) {
    const trimmed = mediaUrl.trim();
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return `${API_BASE_URL}${trimmed}`;
    }
    return `${BASE}/${trimmed}`;
  }
  if (accountId && messageId) {
    return `${BASE}/media/${enc(accountId)}/${enc(messageId)}`;
  }
  return null;
}

export const whatsappService = {
  // ── Accounts & Auth ────────────────────────────────────────────────────────
  listAccounts: async (): Promise<ApiResponse<WhatsAppAccount[]>> => {
    const res = await requestJson<WhatsAppAccount[] | { accounts?: WhatsAppAccount[]; items?: WhatsAppAccount[] }>(
      `${BASE}/accounts`,
    );
    if (!res.success) return { success: false, message: res.message, data: [] };
    return { success: true, message: res.message, data: extractArray<WhatsAppAccount>(res.data, "accounts") };
  },

  connectQr: (payload?: { label?: string; account_id?: string }): Promise<ApiResponse<WhatsAppAccountStatusResult>> =>
    requestJson(`${BASE}/auth/connect-qr`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),

  connectPairing: (payload: {
    phone_number: string;
    label?: string;
    account_id?: string;
  }): Promise<ApiResponse<WhatsAppAccountStatusResult>> =>
    requestJson(`${BASE}/auth/connect-pairing`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getAccountStatus: (accountId: string): Promise<ApiResponse<WhatsAppAccountStatusResult>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/status`),

  updateAccountSettings: (
    accountId: string,
    patch: WhatsAppSettingsPatch,
  ): Promise<ApiResponse<WhatsAppAccount>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/settings`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  reconnectAccount: (accountId: string): Promise<ApiResponse<WhatsAppAccountStatusResult>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/reconnect`, {
      method: "POST",
    }),

  disconnectAccount: (accountId: string, logout = false): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}?logout=${logout ? "true" : "false"}`, {
      method: "DELETE",
    }),

  // ── Conversations ──────────────────────────────────────────────────────────
  listConversations: async (
    accountId: string,
    opts?: { search?: string; filter?: WhatsAppConversationFilter; limit?: number },
  ): Promise<ApiResponse<WhatsAppConversation[]>> => {
    const params = new URLSearchParams();
    if (opts?.search?.trim()) params.set("search", opts.search.trim());
    if (opts?.filter && opts.filter !== "all") params.set("filter", opts.filter);
    else params.set("filter", "all");
    params.set("limit", String(opts?.limit ?? 100));
    const res = await requestJson<
      WhatsAppConversation[] | { conversations?: WhatsAppConversation[]; items?: WhatsAppConversation[] }
    >(`${BASE}/accounts/${enc(accountId)}/conversations?${params.toString()}`);
    if (!res.success) return { success: false, message: res.message, data: [] };
    return {
      success: true,
      message: res.message,
      data: extractArray<WhatsAppConversation>(res.data, "conversations"),
    };
  },

  syncConversations: (accountId: string): Promise<ApiResponse<Record<string, unknown>>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/conversations/sync`, {
      method: "POST",
    }),

  startChat: (
    accountId: string,
    phoneNumber: string,
  ): Promise<ApiResponse<WhatsAppConversation>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/conversations/start-chat`, {
      method: "POST",
      body: JSON.stringify({ phone_number: phoneNumber }),
    }),

  markRead: (accountId: string, chatJid: string): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/conversations/${enc(chatJid)}/read`, {
      method: "POST",
    }),

  updateConversation: (
    accountId: string,
    chatJid: string,
    patch: WhatsAppConversationPatch,
  ): Promise<ApiResponse<WhatsAppConversation>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/conversations/${enc(chatJid)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  sendTyping: (
    accountId: string,
    chatJid: string,
    state: "composing" | "paused" | "recording",
  ): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/conversations/${enc(chatJid)}/typing`, {
      method: "POST",
      body: JSON.stringify({ state }),
    }),

  getGroupInfo: (accountId: string, chatJid: string): Promise<ApiResponse<WhatsAppGroupInfo>> =>
    requestJson(`${BASE}/accounts/${enc(accountId)}/conversations/${enc(chatJid)}/group-info`),

  // ── Messages ───────────────────────────────────────────────────────────────
  listMessages: async (
    accountId: string,
    chatJid: string,
    opts?: { limit?: number; beforeTs?: string | null },
  ): Promise<ApiResponse<WhatsAppMessage[]>> => {
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 60));
    if (opts?.beforeTs) params.set("before_ts", opts.beforeTs);
    const res = await requestJson<
      WhatsAppMessage[] | { messages?: WhatsAppMessage[]; items?: WhatsAppMessage[] }
    >(`${BASE}/accounts/${enc(accountId)}/conversations/${enc(chatJid)}/messages?${params.toString()}`);
    if (!res.success) return { success: false, message: res.message, data: [] };
    return {
      success: true,
      message: res.message,
      data: extractArray<WhatsAppMessage>(res.data, "messages"),
    };
  },

  sendText: (payload: {
    account_id: string;
    chat_jid: string;
    text: string;
    reply_to_message_id?: string | null;
    quoted_text?: string | null;
  }): Promise<ApiResponse<WhatsAppMessage>> =>
    requestJson(`${BASE}/messages/send`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  sendMedia: (payload: {
    account_id: string;
    chat_jid: string;
    file: File;
    media_type: WhatsAppMediaSendType;
    caption?: string;
    reply_to_message_id?: string | null;
  }): Promise<ApiResponse<WhatsAppMessage>> => {
    const form = new FormData();
    form.set("account_id", payload.account_id);
    form.set("chat_jid", payload.chat_jid);
    form.set("media_type", payload.media_type);
    if (payload.caption) form.set("caption", payload.caption);
    if (payload.reply_to_message_id) form.set("reply_to_message_id", payload.reply_to_message_id);
    form.set("file", payload.file);
    return requestJson(`${BASE}/messages/send-media`, {
      method: "POST",
      body: form,
    });
  },

  sendLocation: (payload: {
    account_id: string;
    chat_jid: string;
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }): Promise<ApiResponse<WhatsAppMessage>> =>
    requestJson(`${BASE}/messages/send-location`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  sendContact: (payload: {
    account_id: string;
    chat_jid: string;
    contact_name: string;
    contact_phone: string;
  }): Promise<ApiResponse<WhatsAppMessage>> =>
    requestJson(`${BASE}/messages/send-contact`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  sendPoll: (payload: {
    account_id: string;
    chat_jid: string;
    question: string;
    options: string[];
    selectable_count?: number;
  }): Promise<ApiResponse<WhatsAppMessage>> =>
    requestJson(`${BASE}/messages/send-poll`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  reactMessage: (payload: {
    account_id: string;
    chat_jid: string;
    message_id: string;
    emoji: string;
  }): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/messages/react`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  editMessage: (payload: {
    account_id: string;
    chat_jid: string;
    message_id: string;
    text: string;
  }): Promise<ApiResponse<WhatsAppMessage>> =>
    requestJson(`${BASE}/messages/edit`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteMessage: (payload: {
    account_id: string;
    chat_jid: string;
    message_id: string;
    for_everyone: boolean;
  }): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/messages/delete`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  forwardMessage: (payload: {
    account_id: string;
    from_chat_jid: string;
    message_id: string;
    to_chat_jid: string;
  }): Promise<ApiResponse<WhatsAppMessage>> =>
    requestJson(`${BASE}/messages/forward`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ── Quick Replies ──────────────────────────────────────────────────────────
  listQuickReplies: async (): Promise<ApiResponse<WhatsAppQuickReply[]>> => {
    const res = await requestJson<
      WhatsAppQuickReply[] | { quick_replies?: WhatsAppQuickReply[]; items?: WhatsAppQuickReply[] }
    >(`${BASE}/quick-replies`);
    if (!res.success) return { success: false, message: res.message, data: [] };
    return {
      success: true,
      message: res.message,
      data: extractArray<WhatsAppQuickReply>(res.data, "quick_replies"),
    };
  },

  createQuickReply: (payload: {
    shortcut: string;
    title: string;
    content: string;
    category?: string;
  }): Promise<ApiResponse<WhatsAppQuickReply>> =>
    requestJson(`${BASE}/quick-replies`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateQuickReply: (
    id: string,
    payload: Partial<{ shortcut: string; title: string; content: string; category: string }>,
  ): Promise<ApiResponse<WhatsAppQuickReply>> =>
    requestJson(`${BASE}/quick-replies/${enc(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteQuickReply: (id: string): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/quick-replies/${enc(id)}`, {
      method: "DELETE",
    }),

  // ── Calls ──────────────────────────────────────────────────────────────────
  listCalls: async (accountId: string, limit = 50): Promise<ApiResponse<WhatsAppCallLog[]>> => {
    const res = await requestJson<
      WhatsAppCallLog[] | { calls?: WhatsAppCallLog[]; items?: WhatsAppCallLog[] }
    >(`${BASE}/accounts/${enc(accountId)}/calls?limit=${limit}`);
    if (!res.success) return { success: false, message: res.message, data: [] };
    return {
      success: true,
      message: res.message,
      data: extractArray<WhatsAppCallLog>(res.data, "calls"),
    };
  },

  rejectCall: (payload: {
    account_id: string;
    call_id: string;
    caller_jid: string;
    auto_reply_text?: string;
  }): Promise<ApiResponse<Record<string, unknown>>> =>
    requestJson(`${BASE}/calls/reject`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  initiateOutboundCall: (payload: {
    account_id: string;
    chat_jid: string;
    target_phone: string;
    is_video?: boolean;
    sdp_offer?: string;
  }): Promise<ApiResponse<WhatsAppOutboundCallResult>> =>
    requestJson(`${BASE}/calls/outbound`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  acceptCall: (
    callId: string,
    payload: { account_id: string; sdp_answer: string },
  ): Promise<ApiResponse<Record<string, unknown>>> =>
    requestJson(`${BASE}/calls/${enc(callId)}/accept`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  terminateCall: (
    callId: string,
    payload: { account_id: string },
  ): Promise<ApiResponse<Record<string, unknown>>> =>
    requestJson(`${BASE}/calls/${enc(callId)}/terminate`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ── SSE Realtime Stream ────────────────────────────────────────────────────
  streamUrl: (accountId?: string): string =>
    accountId ? `${BASE}/events/stream?account_id=${enc(accountId)}` : `${BASE}/events/stream`,

  webhookUrlHint: (): string => `${BASE}/calls/webhook`,
};
