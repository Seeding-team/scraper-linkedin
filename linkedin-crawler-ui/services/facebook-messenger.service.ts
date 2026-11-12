/**
 * Facebook Messenger Service — Frontend API Client
 * Kết nối các API /facebook/api/v1/messenger/*: Tài khoản, Hội thoại, Gửi tin và SSE Bus.
 */

import { API_BASE_URL } from "@/lib/env";

export interface FbMessengerAccount {
  id: string;
  fb_user_id: string;
  name: string;
  avatar_url?: string;
  status: "connected" | "checkpoint" | "frozen" | "expired" | "disconnected";
  warm_up_tier: number;
  daily_sent_count: number;
  daily_sent_limit: number;
  last_sent_at?: string;
  frozen_until?: string;
  checkpoint_reason?: string;
  is_active: boolean;
  is_shared_with_all: boolean;
  created_at: string;
  updated_at: string;
}

export type FbMessengerAccountStatus = FbMessengerAccount["status"];

export const FB_ACCOUNT_STATUS_LABELS: Record<FbMessengerAccountStatus, string> = {
  connected: "Đang kết nối",
  disconnected: "Mất kết nối",
  checkpoint: "Bị checkpoint",
  frozen: "Tạm đóng băng",
  expired: "Cookie hết hạn — đăng nhập lại",
};

/**
 * Trích xuất UID Facebook từ chuỗi nhập vào:
 * - Dạng số thuần túy (VD: 100012345678)
 * - facebook.com/profile.php?id=<digits>
 * - facebook.com/messages/t/<digits>
 * - facebook.com/messages/e2ee/t/<digits>
 * - m.me/<digits>
 *
 * Nếu là vanity username hoặc không trích xuất được UID số -> trả về lỗi tiếng Việt.
 */
export function extractFbUid(input: string): { uid: string | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { uid: null, error: "Vui lòng nhập UID hoặc link Facebook." };
  }

  // 1. Dạng số thuần túy (yêu cầu tối thiểu 5 chữ số)
  if (/^\d{5,}$/.test(trimmed)) {
    return { uid: trimmed, error: null };
  }

  // 2. facebook.com/profile.php?id=<digits>
  if (trimmed.includes("profile.php")) {
    const match = /[?&]id=(\d+)(?:[/?#&]|$)/.exec(trimmed);
    if (match) {
      return { uid: match[1], error: null };
    }
  }

  // 3. facebook.com/messages/e2ee/t/<digits> hoặc facebook.com/messages/t/<digits>
  const msgMatch = /(?:messages\/(?:e2ee\/)?t\/)(\d+)(?:[/?#&]|$)/.exec(trimmed);
  if (msgMatch) {
    return { uid: msgMatch[1], error: null };
  }

  // 4. m.me/<digits>
  const mmeMatch = /(?:^|\/\/|\.)(?:www\.)?m\.me\/(\d+)(?:[/?#]|$)/i.exec(trimmed);
  if (mmeMatch) {
    return { uid: mmeMatch[1], error: null };
  }

  // Trường hợp vanity username hoặc định dạng không hợp lệ
  return {
    uid: null,
    error:
      "Không thể trích xuất UID dạng số. Hệ thống chưa hỗ trợ tên người dùng (vanity username), vui lòng nhập UID bằng số hoặc link Facebook chứa UID số.",
  };
}

export interface FbMessengerThread {
  id: string;
  account_id: string;
  thread_id: string;
  recipient_id: string;
  recipient_name?: string;
  recipient_avatar?: string;
  last_message?: string;
  last_message_at?: string;
  unread_count: number;
  is_pinned?: boolean;
  created_at: string;
  updated_at: string;
}

export interface FbMessengerMessage {
  id: string;
  account_id: string;
  thread_id: string;
  sender_id: string;
  sender_name?: string;
  recipient_id: string;
  content: string;
  attachments?: any[];
  is_self: boolean;
  is_echo: boolean;
  status: "sending" | "sent" | "failed";
  offline_threading_id?: string;
  created_at: string;
}

export interface ConnectMessengerAccountPayload {
  cookie: string;
  name?: string;
  proxy_url?: string;
  user_agent?: string;
  fb_user_id?: string;
  is_shared_with_all?: boolean;
}

export interface SendMessengerMessagePayload {
  account_id: string;
  recipient_id: string;
  recipient_name?: string;
  recipient_avatar?: string;
  content: string;
  attachments?: {
    url: string;
    name: string;
    size?: number;
    mime_type?: string;
    kind?: "image" | "file";
  }[];
  simulate_human?: boolean;
}

const BASE = `${API_BASE_URL}/api/all-platform/messenger`;

async function requestApi<T>(url: string, options: RequestInit = {}): Promise<{ success: boolean; message: string; data?: T }> {
  try {
    const res = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        message: json.message || json.detail || `Lỗi máy chủ (${res.status})`,
      };
    }
    return json;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Lỗi kết nối máy chủ",
    };
  }
}

export const fbMessengerService = {
  /** Lấy danh sách tài khoản Messenger */
  getAccounts: async (email?: string): Promise<{ success: boolean; message: string; data?: FbMessengerAccount[] }> => {
    const url = email ? `${BASE}/accounts?email=${encodeURIComponent(email)}` : `${BASE}/accounts`;
    return requestApi<FbMessengerAccount[]>(url);
  },

  /** Kết nối tài khoản Messenger mới qua Cookie */
  connectAccount: async (payload: ConnectMessengerAccountPayload): Promise<{ success: boolean; message: string; data?: FbMessengerAccount }> => {
    return requestApi<FbMessengerAccount>(`${BASE}/accounts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** Xóa / ngắt kết nối tài khoản Messenger */
  deleteAccount: async (accountId: string): Promise<{ success: boolean; message: string }> => {
    return requestApi(`${BASE}/accounts/${accountId}`, {
      method: "DELETE",
    });
  },

  /** Mở đóng băng thủ công cho nick */
  unfreezeAccount: async (accountId: string): Promise<{ success: boolean; message: string }> => {
    return requestApi(`${BASE}/accounts/${accountId}/unfreeze`, {
      method: "POST",
    });
  },

  /** Lấy danh sách hội thoại của tài khoản */
  getThreads: async (accountId: string, limit: number = 50): Promise<{ success: boolean; message: string; data?: FbMessengerThread[] }> => {
    return requestApi<FbMessengerThread[]>(`${BASE}/threads?account_id=${encodeURIComponent(accountId)}&limit=${limit}`);
  },

  /** Lấy tin nhắn chi tiết trong 1 cuộc hội thoại */
  getThreadMessages: async (accountId: string, threadId: string, limit: number = 50): Promise<{ success: boolean; message: string; data?: FbMessengerMessage[] }> => {
    return requestApi<FbMessengerMessage[]>(`${BASE}/threads/${encodeURIComponent(threadId)}/messages?account_id=${encodeURIComponent(accountId)}&limit=${limit}`);
  },

  /** Gửi tin nhắn nhịp sinh học người thật */
  sendMessage: async (payload: SendMessengerMessagePayload): Promise<{ success: boolean; message: string; data?: { message: FbMessengerMessage; thread_id: string } }> => {
    return requestApi(`${BASE}/send`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** Tải lên hình ảnh hoặc tài liệu đính kèm */
  uploadMedia: async (
    file: File,
    accountId?: string
  ): Promise<{
    success: boolean;
    message: string;
    data?: {
      url: string;
      name: string;
      size: number;
      mime_type: string;
      kind: "image" | "file";
    };
  }> => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (accountId) formData.append("account_id", accountId);

      const res = await fetch(`${BASE}/upload`, {
        credentials: "include",
        method: "POST",
        body: formData,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          message: json.message || json.detail || `Lỗi tải file (${res.status})`,
        };
      }
      return json;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Lỗi kết nối khi tải file",
      };
    }
  },

  /** Tạo kết nối SSE lắng nghe sự kiện tin nhắn mới thời gian thực */
  subscribeEvents: (onMessage: (event: any) => void): (() => void) => {
    const eventSource = new EventSource(`${BASE}/events`, { withCredentials: true });
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch (err) {
        console.error("Error parsing Messenger SSE event:", err);
      }
    };
    eventSource.onerror = (err) => {
      console.warn("Messenger SSE connection warning/reconnecting:", err);
    };
    return () => eventSource.close();
  },
};
