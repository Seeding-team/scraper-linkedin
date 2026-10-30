import { API_BASE_URL } from "@/lib/env";
import type { ApiResponse } from "@/types/unified.types";
import type { ViberAccount, ViberDialog, ViberMessage } from "@/types/viber-api";

const BASE = `${API_BASE_URL}/api/all-platform/viber`;

async function requestJson<T = unknown>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
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
      return { success: false, message: (raw.detail as string) || (raw.message as string) || `Lỗi máy chủ (${res.status})` } as ApiResponse<T>;
    }
    return raw as unknown as ApiResponse<T>;
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Không kết nối được máy chủ." } as ApiResponse<T>;
  }
}

export const viberService = {
  listAccounts: (): Promise<ApiResponse<ViberAccount[]>> => requestJson(`${BASE}/accounts`),

  connectBot: (authToken: string, label?: string): Promise<ApiResponse<ViberAccount>> =>
    requestJson(`${BASE}/accounts/connect`, { method: "POST", body: JSON.stringify({ auth_token: authToken, label: label || null }) }),

  reconnect: (accountId: string): Promise<ApiResponse<ViberAccount>> =>
    requestJson(`${BASE}/accounts/${accountId}/reconnect`, { method: "POST" }),

  disconnectAccount: (accountId: string): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/accounts/${accountId}`, { method: "DELETE" }),

  listDialogs: (accountId: string): Promise<ApiResponse<ViberDialog[]>> => requestJson(`${BASE}/accounts/${accountId}/dialogs`),

  listMessages: (accountId: string, viberUserId: string, opts?: { limit?: number; before?: string }): Promise<ApiResponse<ViberMessage[]>> => {
    const params = new URLSearchParams({ viber_user_id: viberUserId });
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", opts.before);
    return requestJson(`${BASE}/accounts/${accountId}/messages?${params.toString()}`);
  },

  sendText: (accountId: string, viberUserId: string, text: string): Promise<ApiResponse<ViberMessage[]>> =>
    requestJson(`${BASE}/messages/send`, {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, viber_user_id: viberUserId, text }),
    }),

  sendMedia: (accountId: string, viberUserId: string, file: File, caption?: string): Promise<ApiResponse<ViberMessage[]>> => {
    const form = new FormData();
    form.set("account_id", accountId);
    form.set("viber_user_id", viberUserId);
    if (caption) form.set("caption", caption);
    form.set("file", file);
    return requestJson(`${BASE}/messages/send-media`, { method: "POST", body: form });
  },

  streamUrl: (): string => `${BASE}/events/stream`,
};
