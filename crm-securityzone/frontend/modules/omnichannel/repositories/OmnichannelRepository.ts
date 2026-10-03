import { API_BASE_URL, API_KEY } from "@/lib/env";
import { ChannelAccount, ConversationItem, MessageItem, CrmCustomerMatch, CrmOpportunity, CrmQuote, ChannelType } from "../types";
import { seedingCrmRepository } from "@/modules/crm/repositories/SeedingCrmRepository";

const commonHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
};

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
      const res = await fetch(`${API_BASE_URL}/facebook/api/v1/sessions`, { credentials: "include", headers: commonHeaders });
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

    return accounts;
  }

  /**
   * Load real conversations for a given channel and account
   */
  async fetchConversations(
    channel: ChannelType,
    accountId?: string,
    allAccounts: ChannelAccount[] = []
  ): Promise<ConversationItem[]> {
    const results: ConversationItem[] = [];

    // Filter target accounts based on selection
    let targetAccounts = accountId
      ? allAccounts.filter((a) => a.id === accountId)
      : allAccounts.filter((a) => channel === "all" || a.channel === channel);

    // Fallback: if no matching account found in state but accountId is provided
    if (targetAccounts.length === 0 && accountId) {
      targetAccounts = [
        {
          id: accountId,
          name: "Account",
          channel: channel === "all" ? "zalo" : channel,
          status: "online",
        },
      ];
    }

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
            const list = json.conversations || json.data || [];
            results.push(...list.map((c: any) => this.mapZaloConversation(c, acc.id, acc.name)));
          }
        } catch (e) {
          console.error("Error fetching Zalo conversations:", e);
        }
      } else if (acc.channel === "facebook") {
        try {
          const res = await fetch(
            `${API_BASE_URL}/facebook/api/v1/inbox/conversations?user_id=${encodeURIComponent(acc.id)}`,
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
          const list = json.messages || json.data || [];
          return list.map((m: any) => ({
            id: m.msg_id || m.id || `msg-${Date.now()}`,
            sender: m.from_uid === accountId || m.sender_type === "me" || m.is_sent ? "me" : "them",
            senderName: m.sender_name || (m.from_uid === accountId ? "Tôi" : "Khách"),
            text: m.message_text || m.text || m.content || "",
            time: m.created_at ? new Date(m.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "vừa xong",
            attachment: m.media_url
              ? {
                  type: m.media_type === "image" ? "image" : "pdf",
                  name: m.media_name || "Attachment",
                  size: m.media_size || "1.0 MB",
                  url: m.media_url,
                }
              : undefined,
          }));
        }
      } catch (e) {
        console.error("Error fetching Zalo messages:", e);
      }
    }

    if (channel === "facebook") {
      try {
        const res = await fetch(`${API_BASE_URL}/facebook/api/v1/inbox/thread?user_id=${encodeURIComponent(accountId)}&conv_id=${encodeURIComponent(convId)}`, { credentials: "include", headers: commonHeaders });
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
   * Send a real text message
   */
  async sendMessage(channel: ChannelType, accountId: string, convId: string, text: string): Promise<boolean> {
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
        return res.ok;
      } catch (e) {
        console.error("Failed to send Zalo message:", e);
        return false;
      }
    }

    if (channel === "facebook") {
      try {
        const res = await fetch(`${API_BASE_URL}/facebook/api/v1/inbox/send`, {
          method: "POST",
          credentials: "include",
          headers: commonHeaders,
          body: JSON.stringify({
            user_id: accountId,
            conv_id: convId,
            text,
          }),
        });
        return res.ok;
      } catch (e) {
        console.error("Failed to send FB message:", e);
        return false;
      }
    }

    return false;
  }

  /**
   * Map Zalo conversation record from backend to Unified ConversationItem
   */
  private mapZaloConversation(c: any, accountId: string, accountName?: string): ConversationItem {
    const customerName = c.conversation_name || c.peer_name || c.group_name || c.name || c.conversation_id || "Khách hàng Zalo";
    const customerAvatar = c.avatar_url || c.peer_avatar || c.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=random`;
    const lastMessageText = c.latest_content || c.last_message_text || c.message || "";
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
        name: c.crm_customer_name || c.customer_name || customerName,
        phone: c.phone_number || c.phone,
        email: c.email,
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
}

export const omnichannelRepository = new OmnichannelRepository();
