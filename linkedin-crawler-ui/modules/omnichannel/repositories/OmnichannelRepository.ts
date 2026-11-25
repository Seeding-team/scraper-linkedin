import { API_BASE_URL, API_KEY } from "@/lib/env";
import { ChannelAccount, ConversationItem, MessageItem, CrmCustomerMatch, CrmOpportunity, CrmQuote, ChannelType } from "../types";
import { seedingCrmRepository } from "@/modules/crm/repositories/SeedingCrmRepository";
import {
  formatZaloAnySidebarPreview,
  normalizeStoredMessage,
} from "@/lib/zaloMessageContent";
import {
  formatConversationSidebarPreview,
  type ZaloSidebarConversationFields,
} from "@/components/all-platform/zalo/centralized-shared/zaloUi";

const commonHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
};

interface RawZaloAsset {
  id?: string;
  storage_url?: string | null;
  source_url?: string | null;
}

interface RawZaloMessage {
  id?: string;
  msg_id?: string;
  source_message_id?: string;
  cli_msg_id?: string;
  from_uid?: string;
  sender_id?: string;
  sender_type?: string;
  sender_name?: string;
  is_sent?: boolean;
  is_deleted?: boolean;
  type?: string;
  msg_kind?: string;
  message_text?: string;
  text?: string;
  content?: string | null;
  raw_content?: unknown;
  attachments?: unknown;
  image_urls?: unknown;
  assets?: RawZaloAsset[];
  quote?: unknown;
  reply_to_id?: string | null;
  reply_to_msg_id?: string | null;
  ts?: number | string;
  created_at?: string | number;
  time_text?: string | number;
  timestamp_text?: string | number;
  media_url?: string;
  media_type?: string;
  media_name?: string;
  media_size?: string;
}

interface RawZaloConversation {
  conversation_id?: string;
  conv_id?: string;
  id?: string;
  thread_type?: string | null;
  has_messages?: boolean | null;
  conversation_name?: string;
  peer_name?: string;
  group_name?: string;
  name?: string;
  avatar_url?: string;
  peer_avatar?: string;
  avatar?: string;
  latest_content?: string | null;
  last_message_content?: string | null;
  last_message_text?: string | null;
  content?: string | null;
  message?: string | null;
  latest_sender_name?: string | null;
  latest_is_self?: boolean | null;
  last_message_is_self?: boolean | null;
  is_sent?: boolean | null;
  latest_is_deleted?: boolean | null;
  last_message_is_deleted?: boolean | null;
  is_deleted?: boolean | null;
  latest_type?: string | null;
  latest_msg_type?: string | null;
  last_message_type?: string | null;
  type?: string | null;
  latest_msg_kind?: string | null;
  last_message_kind?: string | null;
  msg_kind?: string | null;
  latest_raw_content?: unknown;
  last_message_raw_content?: unknown;
  raw_content?: unknown;
  latest_message_at?: string | number | null;
  time?: string | null;
  unread_count?: number | string | null;
  tag?: string | null;
  tags?: string[] | null;
  crm_customer_id?: string | null;
  matched_customer_id?: string | null;
  crm_customer_name?: string | null;
  customer_name?: string | null;
  phone_number?: string | null;
  phone?: string | null;
  email?: string | null;
  owner_name?: string | null;
}

const CLI_MSG_TYPE_MAP: Readonly<Record<number, string>> = {
  1: "webchat",
  31: "chat.voice",
  32: "chat.photo",
  36: "chat.sticker",
  38: "chat.recommended",
  43: "chat.location.new",
  44: "chat.video.msg",
  46: "share.file",
  49: "chat.gif",
};

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readFirstNonEmptyString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function readFirstId(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function resolveCliMsgType(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return CLI_MSG_TYPE_MAP[value];
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return CLI_MSG_TYPE_MAP[Number(value.trim())];
  }
  return undefined;
}

function extractZaloMessageQuote(
  row: RawZaloMessage,
  lookupById: Map<string, RawZaloMessage>,
  accountId: string,
): MessageItem["quote"] {
  const rowQuote = asPlainRecord(row.quote);
  const rawObj = asPlainRecord(row.raw_content);
  const dataObj = asPlainRecord(rawObj?.data);
  const wireQuote = asPlainRecord(dataObj?.quote) || asPlainRecord(rawObj?.quote);
  const q = rowQuote || wireQuote;

  if (q) {
    const quoteId = readFirstId(
      q.global_msg_id,
      q.globalMsgId,
      q.cli_msg_id,
      q.cliMsgId,
      q.id,
      q.msg_id,
      q.msgId,
      row.reply_to_id,
      row.reply_to_msg_id,
    );
    const referenced = quoteId ? lookupById.get(quoteId) : undefined;
    const senderName =
      readFirstNonEmptyString(
        q.from_name,
        q.fromName,
        q.fromD,
        q.sender_name,
        q.senderName,
        q.ownerName,
      ) || referenced?.sender_name;
    const attachObj = asPlainRecord(q.attach);
    const quoteRaw = attachObj ?? q.raw_content;
    const quoteType =
      readFirstNonEmptyString(q.msgType, q.type) || resolveCliMsgType(q.cliMsgType);
    const quoteContent = readFirstNonEmptyString(
      q.previewText,
      q.preview_text,
      q.text,
      q.msg,
      q.content,
    );
    let previewText = formatZaloAnySidebarPreview({
      content: quoteContent,
      type: quoteType,
      msg_kind: readFirstNonEmptyString(q.msg_kind),
      raw_content: quoteRaw,
      attachments: q.attachments,
      is_deleted: Boolean(q.is_deleted),
    });

    if (!previewText && referenced) {
      const refIsMe =
        referenced.from_uid === accountId ||
        referenced.sender_type === "me" ||
        Boolean(referenced.is_sent);
      previewText = formatZaloAnySidebarPreview({
        content: referenced.message_text || referenced.text || referenced.content,
        type: referenced.type,
        msg_kind: referenced.msg_kind,
        raw_content: referenced.raw_content,
        attachments: referenced.attachments,
        is_sent: refIsMe,
        is_deleted: referenced.is_deleted,
      });
    }

    if (previewText || senderName) {
      return {
        ...(quoteId ? { id: quoteId } : {}),
        ...(senderName ? { senderName } : {}),
        previewText: previewText || "Tin nhắn",
      };
    }
  }

  const replyId = readFirstId(row.reply_to_id, row.reply_to_msg_id);
  if (replyId) {
    const referenced = lookupById.get(replyId);
    if (referenced) {
      const refIsMe =
        referenced.from_uid === accountId ||
        referenced.sender_type === "me" ||
        Boolean(referenced.is_sent);
      const previewText =
        formatZaloAnySidebarPreview({
          content: referenced.message_text || referenced.text || referenced.content,
          type: referenced.type,
          msg_kind: referenced.msg_kind,
          raw_content: referenced.raw_content,
          attachments: referenced.attachments,
          is_sent: refIsMe,
          is_deleted: referenced.is_deleted,
        }) || "Tin nhắn";
      const senderName = referenced.sender_name || (refIsMe ? "Bạn" : "Khách");
      return {
        id: replyId,
        senderName,
        previewText,
      };
    }
  }

  return undefined;
}

export class OmnichannelRepository {
  /**
   * Load real accounts from Zalo, Facebook, and Telegram endpoints
   */
  /**
   * Load real accounts from Zalo, Facebook, and Telegram endpoints
   */
  async fetchChannelAccounts(): Promise<ChannelAccount[]> {
    const accounts: ChannelAccount[] = [];

    // 1. Zalo accounts
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/zalo/accounts`, { credentials: "include", headers: commonHeaders });
      if (res.ok) {
        const json = await res.json();
        const zaloAccs = json.accounts || json.data || [];
        for (const a of zaloAccs) {
          const accountId = a.account_id || a.user_id || a.id;
          const accountName = a.label || a.name || a.display_name || (a.phone ? `Zalo (${a.phone})` : "") || accountId || "Zalo Account";
          const isOnline = Boolean(a.listener?.connected || a.has_auth || a.status === "active" || a.status === "online" || a.status === "confirmed");
          accounts.push({
            id: accountId,
            name: accountName,
            channel: "zalo",
            status: isOnline ? "online" : "offline",
            count: a.conversations_count || 0,
          });
        }
      }
    } catch (e) {
      console.warn("Failed to fetch Zalo accounts:", e);
    }

    // 2. Facebook sessions / accounts
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/fb/sessions`, { credentials: "include", headers: commonHeaders });
      if (res.ok) {
        const json = await res.json();
        const fbSessions = json.sessions || [];
        for (const s of fbSessions) {
          accounts.push({
            id: s.user_id,
            name: s.label || s.user_id || "Facebook Page",
            channel: "facebook",
            status: s.online ? "online" : "offline",
            count: 0,
          });
        }
      }
    } catch (e) {
      console.warn("Failed to fetch Facebook accounts:", e);
    }

    // 3. Telegram accounts
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/telegram/accounts`, { credentials: "include", headers: commonHeaders });
      if (res.ok) {
        const json = await res.json();
        const teleAccs = json.accounts || json.data || [];
        for (const a of teleAccs) {
          accounts.push({
            id: a.account_id || a.id,
            name: a.phone_number || a.username || "Telegram Account",
            channel: "telegram",
            status: a.status === "connected" ? "online" : "offline",
            count: 0,
          });
        }
      }
    } catch (e) {
      console.warn("Failed to fetch Telegram accounts:", e);
    }

    // 4. Email accounts (IMAP/SMTP & Google OAuth)
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/email-inbox/accounts`, { credentials: "include", headers: commonHeaders });
      if (res.ok) {
        const emailAccs = await res.json();
        for (const a of emailAccs) {
          accounts.push({
            id: a.id,
            name: a.name,
            channel: "email",
            status: (a.status || "online") as "online" | "offline" | "error" | "syncing" | "expired",
            count: typeof a.total_threads === "number" ? a.total_threads : (a.unread_count || 0),
            email: a.email,
            lastSyncedAt: a.last_synced_at,
            lastSyncError: a.last_sync_error,
            totalThreads: a.total_threads,
            providerType: a.provider_type,
            reconnectRequired: a.reconnect_required,
            isDefault: a.is_default,
          });
        }
      }
    } catch (e) {
      console.warn("Failed to fetch Email accounts:", e);
    }

    return accounts;
  }

  /**
   * Get a short-lived, user/workspace/origin-bound state for GIS popup OAuth.
   */
  async getGoogleOAuthState(origin: string): Promise<{ state: string; origin: string; expires_in: number }> {
    const params = new URLSearchParams({ origin });
    const res = await fetch(`${API_BASE_URL}/api/all-platform/email-inbox/oauth/google/state?${params.toString()}`, {
      credentials: "include",
      headers: commonHeaders,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || "Không thể khởi tạo phiên Google OAuth.");
    }
    return res.json();
  }

  /**
   * Get Google OAuth authorization URL from backend
   */
  async getGoogleOAuthUrl(redirectUri: string, state?: string): Promise<{ auth_url: string; client_id: string; redirect_uri: string }> {
    const params = new URLSearchParams({ redirect_uri: redirectUri });
    if (state) params.set("state", state);
    const res = await fetch(`${API_BASE_URL}/api/all-platform/email-inbox/oauth/google/auth-url?${params.toString()}`, {
      credentials: "include",
      headers: commonHeaders,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || "Không thể lấy liên kết đăng nhập Google OAuth.");
    }
    return res.json();
  }

  /**
   * Exchange Google OAuth authorization code for verified tokens and register account
   */
  async exchangeGoogleOAuth(code: string, redirectUri: string, state?: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/email-inbox/oauth/google/callback`, {
      method: "POST",
      credentials: "include",
      headers: { ...commonHeaders, "X-Requested-With": "XmlHttpRequest" },
      body: JSON.stringify({ code, redirect_uri: redirectUri, state }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || "Xác thực Google OAuth thất bại.");
    }
    return res.json();
  }

  /**
   * Connect an IMAP/SMTP email account manually with password check
   */
  async connectImapAccount(payload: {
    email: string;
    name?: string;
    app_password: string;
    imap_host?: string;
    imap_port?: number;
    smtp_host?: string;
    smtp_port?: number;
  }): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/email-inbox/accounts/connect-imap`, {
      method: "POST",
      credentials: "include",
      headers: commonHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || "Không thể kết nối tài khoản IMAP/SMTP.");
    }
    return res.json();
  }

  /**
   * Disconnect a specific connected email account without affecting others
   */
  async disconnectEmailAccount(accountId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/email-inbox/accounts/${encodeURIComponent(accountId)}/disconnect`, {
      method: "POST",
      credentials: "include",
      headers: commonHeaders,
    });
    return res.ok;
  }

  /**
   * Trigger IMAP / Gmail API sync for workspace or specific account
   */
  async syncEmailMailbox(accountEmail?: string): Promise<{ ok: boolean; imported?: number; error?: string }> {
    try {
      const url = accountEmail
        ? `${API_BASE_URL}/api/all-platform/email-inbox/sync?account_email=${encodeURIComponent(accountEmail)}`
        : `${API_BASE_URL}/api/all-platform/email-inbox/sync`;
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: commonHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, imported: data.imported ?? 0 };
      }
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail || err.message || "Không thể đồng bộ hộp thư." };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Lỗi kết nối khi đồng bộ." };
    }
  }

  /**
   * Load real conversations for a given channel and account
   */
  async fetchConversations(
    channel: ChannelType,
    accountId?: string,
    allAccounts: ChannelAccount[] = [],
    selectedAccountEmail?: string
  ): Promise<ConversationItem[]> {
    const results: ConversationItem[] = [];

    // Filter target accounts based on selection
    const targetAccounts = accountId
      ? allAccounts.filter((a) => a.id === accountId)
      : allAccounts.filter((a) => channel === "all" || a.channel === channel);

    // 1. Fetch Email conversations ONCE if applicable
    const shouldFetchEmail = channel === "all" || channel === "email" || targetAccounts.some((a) => a.channel === "email");
    if (shouldFetchEmail) {
      try {
        const targetEmail = selectedAccountEmail || (accountId ? allAccounts.find(a => a.id === accountId)?.email : undefined);
        const url = targetEmail
          ? `${API_BASE_URL}/api/all-platform/email-inbox/conversations?account_email=${encodeURIComponent(targetEmail)}`
          : `${API_BASE_URL}/api/all-platform/email-inbox/conversations`;
        const res = await fetch(url, { credentials: "include", headers: commonHeaders });
        if (res.ok) {
          const list = await res.json();
          results.push(...list.map((c: any) => this.mapEmailConversation(c, c.account_id || accountId || "email", c.account_label || "Email")));
        }
      } catch (e) {
        console.error("Error fetching Email conversations:", e);
      }
    }

    // 2. Fetch Zalo and Facebook for non-email target accounts
    for (const acc of targetAccounts) {
      if (acc.channel === "zalo") {
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/all-platform/zalo/conversations?account_id=${encodeURIComponent(acc.id)}`,
            {
              credentials: "include",
              headers: { ...commonHeaders, "X-User-ID": acc.id },
            }
          );
          if (res.ok) {
            const json = await res.json();
            const list: RawZaloConversation[] = json.conversations || json.data || [];
            results.push(...list.map((c) => this.mapZaloConversation(c, acc.id, acc.name)));
          }
        } catch (e) {
          console.error("Error fetching Zalo conversations:", e);
        }
      } else if (acc.channel === "facebook") {
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/all-platform/fb/inbox/conversations?user_id=${encodeURIComponent(acc.id)}`,
            { credentials: "include", headers: commonHeaders }
          );
          if (res.ok) {
            const json = await res.json();
            const list = json.conversations || json.data || [];
            results.push(...list.map((c: any) => this.mapFbConversation(c, acc.id, acc.name)));
          }
        } catch (e) {
          console.error("Error fetching FB conversations:", e);
        }
      }
    }

    return results;
  }

  /**
   * Fetch real messages for a conversation
   */
  async fetchMessages(channel: ChannelType, accountId: string, convId: string): Promise<MessageItem[]> {
    if (channel === "email") {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/all-platform/email-inbox/conversations/${encodeURIComponent(convId)}/messages`,
          { credentials: "include", headers: commonHeaders }
        );
        if (res.ok) {
          const list = await res.json();
          return list.map((m: any) => ({
            id: m.id || m.message_id || `eml-msg-${Date.now()}`,
            sender: m.sender || "them",
            senderName: m.sender_name || (m.sender === "me" ? "Tôi" : m.sender_email),
            senderEmail: m.sender_email,
            recipientEmails: m.recipient_emails || [],
            ccEmails: m.cc_emails || [],
            subject: m.subject,
            text: m.text || "",
            html: m.html,
            time: m.time || "vừa xong",
            status: m.status || "delivered",
            attachments: m.attachments || [],
            attachment: m.attachments && m.attachments.length > 0 ? m.attachments[0] : undefined,
            messageId: m.message_id,
            inReplyTo: m.in_reply_to,
            referencesHeader: m.references_header,
          }));
        }
      } catch (e) {
        console.error("Error fetching Email messages:", e);
      }
    }

    if (channel === "zalo") {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/all-platform/zalo/conversations/${encodeURIComponent(convId)}/messages?account_id=${encodeURIComponent(accountId)}`,
          {
            credentials: "include",
            headers: { ...commonHeaders, "X-User-ID": accountId },
          }
        );
        if (res.ok) {
          const json = await res.json();
          const list: RawZaloMessage[] = json.messages || json.data || [];
          const lookupById = new Map<string, RawZaloMessage>();
          for (const item of list) {
            for (const key of [item.source_message_id, item.msg_id, item.id, item.cli_msg_id]) {
              if (typeof key === "string" && key.trim()) {
                lookupById.set(key.trim(), item);
              }
            }
          }

          return list.map((m) => {
            const isMe = m.from_uid === accountId || m.sender_type === "me" || Boolean(m.is_sent);
            const rawText = m.message_text || m.text || m.content || "";
            const assetUrls = Array.isArray(m.assets)
              ? m.assets
                  .map((a) => a?.storage_url || a?.source_url || "")
                  .filter((u): u is string => Boolean(u))
              : [];
            const existingImageUrls = Array.isArray(m.image_urls)
              ? m.image_urls.filter((u): u is string => typeof u === "string" && u.length > 0)
              : [];
            const isLegacyNonImageMedia =
              Boolean(m.media_url) && Boolean(m.media_type) && m.media_type !== "image";
            const legacyMediaImageUrls =
              m.media_url && !isLegacyNonImageMedia ? [m.media_url] : [];
            const mergedImageUrls = Array.from(
              new Set([...existingImageUrls, ...assetUrls, ...legacyMediaImageUrls]),
            );
            const effectiveAttachments =
              m.attachments !== undefined
                ? m.attachments
                : !m.raw_content && isLegacyNonImageMedia && m.media_url
                  ? [{ kind: "file", url: m.media_url, name: m.media_name || "Attachment" }]
                  : undefined;

            const normalized = normalizeStoredMessage({
              msg_kind: m.msg_kind,
              type: m.type,
              is_sent: isMe,
              is_deleted: m.is_deleted,
              attachments: effectiveAttachments,
              raw_content: m.raw_content,
              image_urls: mergedImageUrls.length > 0 ? mergedImageUrls : undefined,
              content: rawText,
            });
            const quote = extractZaloMessageQuote(m, lookupById, accountId);

            const rawTime = m.created_at || m.time_text || m.timestamp_text || m.ts;
            const parsedTime = rawTime
              ? (() => {
                  const num = Number(rawTime);
                  const dt =
                    !Number.isNaN(num) && /^\d+$/.test(String(rawTime).trim())
                      ? new Date(num < 1e11 ? num * 1000 : num)
                      : new Date(rawTime);
                  return Number.isNaN(dt.getTime())
                    ? "vừa xong"
                    : dt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
                })()
              : "vừa xong";
            return {
              id: m.msg_id || m.source_message_id || m.id || `msg-${Date.now()}`,
              sender: isMe ? "me" : "them",
              senderName: m.sender_name || (isMe ? "Tôi" : "Khách"),
              text: normalized.text || normalized.previewText,
              time: parsedTime,
              callInfo: normalized.callInfo || undefined,
              normalizedZalo: normalized,
              ...(quote ? { quote } : {}),
              attachment: m.media_url
                ? {
                    type: m.media_type === "image" ? "image" : "pdf",
                    name: m.media_name || "Attachment",
                    size: m.media_size || "1.0 MB",
                    url: m.media_url,
                  }
                : undefined,
            };
          });
        }
      } catch (e) {
        console.error("Error fetching Zalo messages:", e);
      }
    }

    if (channel === "facebook") {
      try {
        const res = await fetch(`${API_BASE_URL}/api/all-platform/fb/inbox/thread?user_id=${encodeURIComponent(accountId)}&conv_id=${encodeURIComponent(convId)}`, { credentials: "include", headers: commonHeaders });
        if (res.ok) {
          const json = await res.json();
          const list = json.messages || [];
          return list.map((m: any, idx: number) => ({
            id: `fb-msg-${idx}-${Date.now()}`,
            sender: m.from === "me" ? "me" : "them",
            text: m.text || "",
            time: m.time || "vừa xong",
          }));
        }
      } catch (e) {
        console.error("Error fetching FB thread:", e);
      }
    }

    return [];
  }

  /**
   * Send a real text / email message
   */
  async sendMessage(
    channel: ChannelType,
    accountId: string,
    convId: string,
    text: string,
    options?: {
      subject?: string;
      attachments?: any[];
      recipient_email?: string;
      cc_emails?: string[];
      reply_to_message_id?: string;
      mode?: "reply" | "reply_all" | "forward";
      idempotency_key?: string;
      from_email?: string;
    }
  ): Promise<{ ok: boolean; message?: MessageItem; error?: string }> {
    if (channel === "email") {
      try {
        const idempKey = options?.idempotency_key || `send-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const res = await fetch(
          `${API_BASE_URL}/api/all-platform/email-inbox/conversations/${encodeURIComponent(convId)}/send`,
          {
            method: "POST",
            credentials: "include",
            headers: commonHeaders,
            body: JSON.stringify({
              text,
              subject: options?.subject,
              attachments: options?.attachments,
              recipient_email: options?.recipient_email,
              cc_emails: options?.cc_emails,
              reply_to_message_id: options?.reply_to_message_id,
              mode: options?.mode || "reply",
              idempotency_key: idempKey,
              from_email: options?.from_email,
            }),
          }
        );
        if (res.ok) {
          const m = await res.json();
          const mappedMsg: MessageItem = {
            id: m.id || m.message_id,
            sender: "me",
            senderName: m.sender_name || "Tôi",
            senderEmail: m.sender_email,
            recipientEmails: m.recipient_emails || [],
            ccEmails: m.cc_emails || [],
            subject: m.subject,
            text: m.text || text,
            html: m.html,
            time: m.time || new Date().toISOString(),
            status: "sent",
            attachments: m.attachments || [],
            attachment: m.attachments && m.attachments.length > 0 ? m.attachments[0] : undefined,
            messageId: m.message_id,
            inReplyTo: m.in_reply_to,
            referencesHeader: m.references_header,
            idempotencyKey: idempKey,
          };
          return { ok: true, message: mappedMsg };
        }
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail || "Không thể gửi email phản hồi." };
      } catch (e: any) {
        console.error("Failed to send Email message:", e);
        return { ok: false, error: e.message || "Lỗi mạng khi gửi email phản hồi." };
      }
    }

    if (channel === "zalo") {
      try {
        const res = await fetch(`${API_BASE_URL}/api/all-platform/zalo/conversations/${encodeURIComponent(convId)}/send`, {
          method: "POST",
          credentials: "include",
          headers: { ...commonHeaders, "X-User-ID": accountId },
          body: JSON.stringify({
            account_id: accountId,
            user_id: accountId,
            message: text,
          }),
        });
        return { ok: res.ok };
      } catch (e: any) {
        console.error("Failed to send Zalo message:", e);
        return { ok: false, error: e.message };
      }
    }

    if (channel === "facebook") {
      try {
        const res = await fetch(`${API_BASE_URL}/api/all-platform/fb/inbox/reply`, {
          method: "POST",
          credentials: "include",
          headers: commonHeaders,
          body: JSON.stringify({
            user_id: accountId,
            conv_id: convId,
            text,
          }),
        });
        return { ok: res.ok };
      } catch (e: any) {
        console.error("Failed to send FB message:", e);
        return { ok: false, error: e.message };
      }
    }

    return { ok: false, error: "Kênh không hỗ trợ." };
  }

  /**
   * Compose brand new email thread
   */
  async composeEmail(payload: {
    recipient_email: string;
    cc_emails?: string[];
    subject: string;
    text: string;
    html?: string;
    attachments?: any[];
    idempotency_key?: string;
    from_email?: string;
  }): Promise<{ ok: boolean; conversation?: ConversationItem; error?: string }> {
    try {
      const idempKey = payload.idempotency_key || `compose-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const res = await fetch(`${API_BASE_URL}/api/all-platform/email-inbox/compose`, {
        method: "POST",
        credentials: "include",
        headers: commonHeaders,
        body: JSON.stringify({ ...payload, idempotency_key: idempKey }),
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, conversation: this.mapEmailConversation(data, data.account_id, data.account_label) };
      }
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail || "Không thể gửi email mới." };
    } catch (e: any) {
      return { ok: false, error: e.message || "Lỗi mạng khi gửi email mới." };
    }
  }

  /**
   * Mark email conversation as read
   */
  async markEmailRead(convId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/all-platform/email-inbox/conversations/${encodeURIComponent(convId)}/read`,
        {
          method: "POST",
          credentials: "include",
          headers: commonHeaders,
        }
      );
      return res.ok;
    } catch (e) {
      console.error("Failed to mark email read:", e);
      return false;
    }
  }

  /**
   * Map Email conversation record from backend to Unified ConversationItem
   */
  private mapEmailConversation(c: any, accountId: string, accountName?: string): ConversationItem {
    return {
      id: c.id,
      channel: "email",
      accountId: c.account_id || accountId,
      accountLabel: c.account_label || accountName || "Email Inbox",
      customerName: c.customer_name || c.customer_email,
      customerAvatar:
        c.customer_avatar ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(c.customer_name || "Email")}&background=random`,
      customerEmail: c.customer_email,
      subject: c.subject || (c.messages && c.messages[0]?.subject ? c.messages[0].subject : undefined),
      unreadCount: Number(c.unread_count || 0),
      lastMessageText: c.last_message_text || "",
      lastMessageTime: c.last_message_time || "",
      tags: c.tags || ["Email"],
      isCrmMatched: Boolean(c.is_crm_matched),
      crmData: c.crm_data || { matched: false },
      opportunity: c.opportunity,
      quote: c.quote,
      contracts: (c.contracts || []).map((ct: any) => ({
        id: ct.id,
        code: ct.code,
        title: ct.title,
        status: ct.status,
        amount: ct.amount,
        signedAt: ct.signed_at,
        effectiveDate: ct.effective_date,
      })),
      messages: (c.messages || []).map((m: any) => ({
        id: m.id,
        sender: m.sender || "them",
        senderName: m.sender_name,
        senderEmail: m.sender_email,
        recipientEmails: m.recipient_emails || [],
        ccEmails: m.cc_emails || [],
        subject: m.subject,
        text: m.text || "",
        html: m.html,
        time: m.time || "vừa xong",
        status: m.status || "delivered",
        attachments: m.attachments || [],
        attachment: m.attachments && m.attachments.length > 0 ? m.attachments[0] : undefined,
      })),
    };
  }


  /**
   * Map Zalo conversation record from backend to Unified ConversationItem
   */
  private mapZaloConversation(c: RawZaloConversation, accountId: string, accountName?: string): ConversationItem {
    const customerName = c.conversation_name || c.peer_name || c.group_name || c.name || c.conversation_id || "Khách hàng Zalo";
    const customerAvatar = c.avatar_url || c.peer_avatar || c.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=random`;
    const rawLastContent =
      readFirstNonEmptyString(
        c.latest_content,
        c.last_message_content,
        c.last_message_text,
        c.content,
        c.message,
      ) ?? null;
    const lastSenderLower = String(c.latest_sender_name || "").trim().toLowerCase();
    const isSelf =
      typeof c.latest_is_self === "boolean"
        ? c.latest_is_self
        : typeof c.last_message_is_self === "boolean"
          ? c.last_message_is_self
          : typeof c.is_sent === "boolean"
            ? c.is_sent
            : ["__me__", "me", "bạn", "ban"].includes(lastSenderLower);

    const sidebarConv: ZaloSidebarConversationFields = {
      conversation_id: c.conversation_id || c.conv_id || c.id || null,
      thread_type: c.thread_type ?? null,
      has_messages: c.has_messages ?? null,
      latest_content: rawLastContent,
      last_message_content: c.last_message_content ?? rawLastContent,
      latest_sender_name: c.latest_sender_name ?? null,
      latest_is_self: isSelf,
      latest_is_deleted: Boolean(c.latest_is_deleted ?? c.last_message_is_deleted ?? c.is_deleted),
      last_message_is_deleted: Boolean(c.last_message_is_deleted ?? c.is_deleted),
      latest_type: c.latest_type || c.latest_msg_type || c.last_message_type || c.type || null,
      latest_msg_type: c.latest_msg_type ?? null,
      last_message_type: c.last_message_type || c.type || null,
      latest_msg_kind: c.latest_msg_kind || c.last_message_kind || c.msg_kind || null,
      last_message_kind: c.last_message_kind || c.msg_kind || null,
      latest_raw_content:
        c.latest_raw_content !== undefined
          ? c.latest_raw_content
          : c.last_message_raw_content !== undefined
            ? c.last_message_raw_content
            : c.raw_content,
      last_message_raw_content:
        c.last_message_raw_content !== undefined ? c.last_message_raw_content : c.raw_content,
    };

    const lastMessageText = formatConversationSidebarPreview(sidebarConv, { isSelf });
    const lastMessageTime = c.latest_message_at
      ? new Date(c.latest_message_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
      : (c.time || "");

    return {
      id: c.conversation_id || c.conv_id || c.id || `zalo-conv-${Date.now()}`,
      channel: "zalo",
      accountId,
      accountLabel: accountName || "Zalo Account",
      customerName,
      customerAvatar,
      unreadCount: Number(c.unread_count || 0),
      lastMessageText,
      lastMessageTime,
      tags: c.tag ? [c.tag] : (c.tags || []),
      isCrmMatched: !!c.crm_customer_id || !!c.matched_customer_id,
      crmData: {
        matched: !!c.crm_customer_id || !!c.matched_customer_id,
        customerId: c.crm_customer_id || c.matched_customer_id || undefined,
        name: c.crm_customer_name || c.customer_name || customerName,
        phone: c.phone_number || c.phone || undefined,
        email: c.email || undefined,
        ownerName: c.owner_name || "Nguyễn Thị Mai",
      },
      messages: [],
    };
  }

  /**
   * Map FB conversation record
   */
  private mapFbConversation(c: any, accountId: string, accountName?: string): ConversationItem {
    return {
      id: c.conv_id || c.id,
      channel: "facebook",
      accountId,
      accountLabel: accountName || "Facebook Page",
      customerName: c.name || "FB User",
      customerAvatar: c.avatar || "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
      unreadCount: c.unread ? 1 : 0,
      lastMessageText: c.preview || "",
      lastMessageTime: c.time || "",
      tags: c.is_customer ? ["Khách hàng"] : [],
      isCrmMatched: !!c.is_customer,
      crmData: {
        matched: !!c.is_customer,
        name: c.name,
      },
      messages: [],
    };
  }

  /**
   * Fetch real quick replies / templates from /api/all-platform/quick-comments
   */
  async fetchQuickReplies(): Promise<{ id: string; category: string; title: string; text: string }[]> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/quick-comments`, { credentials: "include", headers: commonHeaders });
      if (res.ok) {
        const json = await res.json();
        const list = json.data || json.comments || [];
        return list.map((item: any) => ({
          id: item.id || `qr-${Date.now()}`,
          category: item.category || "chao_hoi",
          title: item.title || item.comment_text?.substring(0, 20) || "Mẫu tin nhắn",
          text: item.comment_text || item.text || "",
        }));
      }
    } catch (e) {
      console.warn("Failed to fetch quick replies:", e);
    }
    return [];
  }

  /** Fix (2026-11-13, "vẫn chưa fill dc sđt... bên đa kênh chỗ omni á") - tra
   * cuu SDT 1 hoi thoai Zalo qua endpoint dung CHUNG voi ZaloInboxAdminShell.tsx
   * (man Zalo rieng, da fix truoc do - muc 61 thao/CRM_KNOWN_BUGS_FIXED.md).
   * Dat o day (khong phai 1 service rieng) vi OmnichannelInboxView.tsx chi
   * goi API qua omnichannelRepository, giu dong nhat pattern voi cac method
   * khac trong file nay. */
  async getZaloConversationPhone(convId: string, name?: string): Promise<{ success: boolean; phone: string | null }> {
    try {
      const url = `${API_BASE_URL}/api/all-platform/zalo/conversations/${encodeURIComponent(convId)}/phone${name ? `?name=${encodeURIComponent(name)}` : ""}`;
      const res = await fetch(url, { credentials: "include", headers: commonHeaders });
      if (!res.ok) return { success: false, phone: null };
      const data = await res.json();
      return { success: Boolean(data?.success), phone: data?.phone || null };
    } catch (e) {
      console.warn("Failed to fetch Zalo conversation phone:", e);
      return { success: false, phone: null };
    }
  }
}

export const omnichannelRepository = new OmnichannelRepository();
