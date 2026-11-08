import { API_BASE_URL } from "@/lib/env";
import type { ApiResponse } from "@/types/unified.types";
import type { TelegramAccount, TelegramDialog, TelegramLoginStepResult, TelegramMessage } from "@/types/telegram-api";

const BASE = `${API_BASE_URL}/api/all-platform/telegram`;

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

export const telegramService = {
  listAccounts: (): Promise<ApiResponse<TelegramAccount[]>> => requestJson(`${BASE}/accounts`),

  disconnectAccount: (accountId: string, revoke: boolean): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/accounts/${accountId}?revoke=${revoke ? "true" : "false"}`, { method: "DELETE" }),

  sendCode: (phone: string): Promise<ApiResponse<TelegramLoginStepResult>> =>
    requestJson(`${BASE}/auth/send-code`, { method: "POST", body: JSON.stringify({ phone }) }),

  verifyCode: (accountId: string, code: string): Promise<ApiResponse<TelegramLoginStepResult>> =>
    requestJson(`${BASE}/auth/verify-code`, { method: "POST", body: JSON.stringify({ account_id: accountId, code }) }),

  verifyPassword: (accountId: string, password: string): Promise<ApiResponse<TelegramLoginStepResult>> =>
    requestJson(`${BASE}/auth/verify-password`, { method: "POST", body: JSON.stringify({ account_id: accountId, password }) }),

  botLogin: (botToken: string, label?: string): Promise<ApiResponse<TelegramLoginStepResult>> =>
    requestJson(`${BASE}/auth/bot-login`, { method: "POST", body: JSON.stringify({ bot_token: botToken, label }) }),

  listDialogs: (accountId: string, refresh = false): Promise<ApiResponse<TelegramDialog[]>> =>
    requestJson(`${BASE}/accounts/${accountId}/dialogs?refresh=${refresh ? "true" : "false"}`),

  listMessages: (accountId: string, dialogId: number, opts?: { limit?: number; beforeMessageId?: number }): Promise<ApiResponse<TelegramMessage[]>> => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.beforeMessageId) params.set("before_message_id", String(opts.beforeMessageId));
    const qs = params.toString();
    return requestJson(`${BASE}/accounts/${accountId}/dialogs/${dialogId}/messages${qs ? `?${qs}` : ""}`);
  },

  sendText: (accountId: string, dialogId: number, text: string, replyTo?: number): Promise<ApiResponse<TelegramMessage>> =>
    requestJson(`${BASE}/messages/send`, {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, dialog_id: dialogId, text, reply_to: replyTo ?? null }),
    }),

  sendMedia: (accountId: string, dialogId: number, file: File, opts?: { caption?: string; replyTo?: number }): Promise<ApiResponse<TelegramMessage>> => {
    const form = new FormData();
    form.set("account_id", accountId);
    form.set("dialog_id", String(dialogId));
    if (opts?.caption) form.set("caption", opts.caption);
    if (opts?.replyTo) form.set("reply_to", String(opts.replyTo));
    form.set("file", file);
    return requestJson(`${BASE}/messages/send-media`, { method: "POST", body: form });
  },

  editMessage: (accountId: string, dialogId: number, messageId: number, text: string): Promise<ApiResponse<TelegramMessage>> =>
    requestJson(`${BASE}/messages/edit`, {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, dialog_id: dialogId, message_id: messageId, text }),
    }),

  deleteMessage: (accountId: string, dialogId: number, messageId: number, revoke = true): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/messages/delete`, {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, dialog_id: dialogId, message_id: messageId, revoke }),
    }),

  forwardMessage: (accountId: string, fromDialogId: number, messageId: number, toDialogId: number): Promise<ApiResponse<TelegramMessage>> =>
    requestJson(`${BASE}/messages/forward`, {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, from_dialog_id: fromDialogId, message_id: messageId, to_dialog_id: toDialogId }),
    }),

  pinMessage: (accountId: string, dialogId: number, messageId: number, unpin = false): Promise<ApiResponse<null>> =>
    requestJson(`${BASE}/messages/pin`, {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, dialog_id: dialogId, message_id: messageId, unpin }),
    }),

  streamUrl: (): string => `${BASE}/events/stream`,
};
