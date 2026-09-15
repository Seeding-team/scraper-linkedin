import { API_BASE_URL, API_KEY } from "@/lib/env";
import type {
  ZaloAuthInitResponse,
  ZaloAccountsResponse,
  ZaloAuthStatusResponse,
  ZaloCurrentStatusResponse,
  ZaloCrawledGroupsResponse,
  ZaloDeleteSessionResponse,
  ZaloBroadcastPreviewResponse,
  ZaloBroadcastRequest,
  ZaloBroadcastResponse,
  ZaloBroadcastStatusResponse,
  ZaloJobData,
  ZaloConversationListResponse,
  ZaloLibraryContentKind,
  ZaloInboxReportResponse,
  ZaloLibraryListResponse,
  ZaloLibraryMessage,
  ZaloLibraryBulkDeleteRequest,
  ZaloLibraryBulkDeleteResponse,
  ZaloLibraryMessageCreateRequest,
  ZaloLibraryMessageUpdateRequest,
  ZaloLiveGroup,
  ZaloManualLoginResponse,
  ZaloStartCrawlRequest,
  ZaloStartCrawlResponse,
  ZaloSyncRecentResponse,
  ZaloVerifyGroupRequestItem,
  ZaloVerifyGroupsResponse,
  ZaloWorkersResponse,
  ZaloMention,
  ZaloRecallMessageRequest,
  ZaloFriendStatusResponse,
  ZaloGroupMembersResponse,
  ZaloStickerDetail,
  ZaloAccountAssignment,
  ZaloForwardRule,
  ZaloForwardRuleCreateRequest,
  ZaloForwardLog,
  ZaloBulkJob,
  ZaloBulkJobItem,
  ZaloBulkJobCreateRequest,
  ZaloBulkJobRecipient,
  ZaloCampaign,
  ZaloCampaignCreateRequest,
  ZaloCampaignRecipient,
  ZaloCampaignLog,
  ZaloPushSubscribeRequest,
} from "@/types/zalo-api";

const JSON_HEADERS = {
  "Content-Type": "application/json",
} as const;

export const ZALO_WORKER_STORAGE_KEY = "zalo_selected_worker_id";

export function normalizeZaloWorkerId(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/[^a-z0-9.-]/g, "");
}

export function getDefaultZaloWorkerId(): string {
  return "default";
}

export function getSelectedZaloWorkerId(): string {
  if (typeof window === "undefined") return getDefaultZaloWorkerId();
  const stored = normalizeZaloWorkerId(window.localStorage.getItem(ZALO_WORKER_STORAGE_KEY));
  if (stored) return stored;
  const fallback = getDefaultZaloWorkerId();
  window.localStorage.setItem(ZALO_WORKER_STORAGE_KEY, fallback);
  return fallback;
}

export function setSelectedZaloWorkerId(workerId: string): string {
  const normalized = normalizeZaloWorkerId(workerId) || getDefaultZaloWorkerId();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ZALO_WORKER_STORAGE_KEY, normalized);
  }
  return normalized;
}

export function getZaloWorkers(userId = "default"): Promise<ZaloWorkersResponse> {
  return requestJson<ZaloWorkersResponse>("/api/all-platform/zalo/workers", {
    method: "GET",
    headers: {
      "X-User-ID": userId,
    },
  }, 7000);
}

export function getZaloAccounts(ownerId = "default", idMember?: string, email?: string): Promise<ZaloAccountsResponse> {
  const params = new URLSearchParams({ owner_id: ownerId });
  if (idMember) params.append("id_member", idMember);
  if (email) params.append("email", email);
  return requestJson<ZaloAccountsResponse>(`/api/all-platform/zalo/accounts?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-User-ID": ownerId,
    },
  });
}

export function createZaloAccount(payload: {
  account_id?: string;
  owner_id?: string;
  id_member?: string;
  label: string;
  phone?: string;
}) {
  return requestJson<{ account_id: string; message?: string }>("/api/all-platform/zalo/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateZaloAccount(
  accountId: string,
  payload: {
    owner_id?: string;
    label?: string;
    phone?: string;
    status?: string;
  }
) {
  return requestJson(`/api/all-platform/zalo/accounts/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteZaloAccount(accountId: string, deleteAuth = false) {
  const params = new URLSearchParams({ delete_auth: String(deleteAuth) });
  return requestJson(`/api/all-platform/zalo/accounts/${encodeURIComponent(accountId)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export function restartZaloAccountListener(accountId: string) {
  return requestJson(`/api/all-platform/zalo/accounts/${encodeURIComponent(accountId)}/listener/restart`, {
    method: "POST",
  });
}

export function getZaloInboxReport(ownerId = "default", accountIds: string[] = []): Promise<ZaloInboxReportResponse> {
  const params = new URLSearchParams({ owner_id: ownerId });
  for (const accountId of accountIds) params.append("account_id", accountId);
  return requestJson<ZaloInboxReportResponse>(`/api/all-platform/zalo/accounts/inbox-report?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-User-ID": ownerId,
    },
  });
}

export function resolveZaloConversationAccount(convId: string): Promise<{ account_id: string; conv_id: string }> {
  const params = new URLSearchParams({ conv_id: convId });
  return requestJson<{ account_id: string; conv_id: string }>(`/api/all-platform/zalo/conversations/resolve-account?${params.toString()}`, {
    method: "GET",
  });
}

export function getZaloConversations(accountId = "default"): Promise<ZaloConversationListResponse> {
  const params = new URLSearchParams({ account_id: accountId });
  return requestJson<ZaloConversationListResponse>(`/api/all-platform/zalo/conversations?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-User-ID": accountId,
    },
  });
}

export function getZaloConversationMessages(
  accountId: string,
  conversationId: string,
  limit = 100,
  offset = 0,
): Promise<ZaloLibraryListResponse> {
  const params = new URLSearchParams({
    account_id: accountId,
    limit: String(limit),
    offset: String(offset),
  });
  return requestJson<ZaloLibraryListResponse>(
    `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "X-User-ID": accountId,
      },
    },
  );
}

export function syncZaloConversationMessages(
  accountId: string,
  conversationId: string,
): Promise<{ ok: boolean; message: string }> {
  const params = new URLSearchParams({ account_id: accountId });
  return requestJson<{ ok: boolean; message: string }>(
    `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/sync?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "X-User-ID": accountId,
      },
    },
  );
}

export function syncZaloRecentConversations(
  accountId: string,
  limit = 50,
  messagesPerConversation = 50,
): Promise<ZaloSyncRecentResponse> {
  return requestJson<ZaloSyncRecentResponse>("/api/all-platform/zalo/conversations/sync-recent", {
    method: "POST",
    headers: {
      "X-User-ID": accountId,
    },
    body: JSON.stringify({
      account_id: accountId,
      limit,
      messages_per_conversation: messagesPerConversation,
    }),
  });
}

function buildHeaders(extra?: HeadersInit, isFormData = false): HeadersInit {
  const callerEmail = typeof window !== "undefined" ? window.localStorage?.getItem("app_user_email") : null;
  const baseHeaders: HeadersInit = API_KEY
    ? {
        ...(isFormData ? {} : JSON_HEADERS),
        "x-api-key": API_KEY,
        ...(callerEmail ? { "X-Caller-Email": callerEmail } : {}),
      }
    : {
        ...(isFormData ? {} : JSON_HEADERS),
        ...(callerEmail ? { "X-Caller-Email": callerEmail } : {}),
      };

  return {
    ...baseHeaders,
    ...extra,
  };
}

async function requestJson<TResponse>(
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<TResponse> {
  const timeoutController = timeoutMs ? new AbortController() : null;
  const timeoutId = timeoutController
    ? globalThis.setTimeout(() => timeoutController.abort(), timeoutMs)
    : null;

  const isFormData = init?.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: init?.credentials ?? "include",
      headers: buildHeaders(init?.headers, isFormData),
      signal: init?.signal ?? timeoutController?.signal,
    });
  } catch (error) {
    if (timeoutController?.signal.aborted) {
      throw new Error(`Request timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s`);
    }
    throw error;
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  }

  const payload = (await response.json()) as TResponse;

  if (!response.ok) {
    const errorPayload = payload as
      | { message?: unknown; detail?: unknown }
      | undefined;
    const normalizeErrorValue = (value: unknown): string => {
      if (typeof value === "string") return value.trim();
      if (!value) return "";
      if (typeof value === "object") {
        const objectValue = value as { message?: unknown; detail?: unknown };
        const nestedMessage = normalizeErrorValue(objectValue.message);
        if (nestedMessage) return nestedMessage;
        const nestedDetail = normalizeErrorValue(objectValue.detail);
        if (nestedDetail) return nestedDetail;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value).trim();
    };
    const backendMessage =
      normalizeErrorValue(errorPayload?.message) || normalizeErrorValue(errorPayload?.detail);

    throw new Error(
      backendMessage
        ? `API ${response.status}: ${backendMessage}`
        : `API ${response.status}: ${response.statusText}`,
    );
  }

  return payload;
}

export function initZaloAuthSession(
  userId = "default",
): Promise<ZaloAuthInitResponse> {
  return requestJson<ZaloAuthInitResponse>("/api/all-platform/zalo/auth/init", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  }, 95000);
}

export function refreshZaloLoginQr(
  userId = "default",
): Promise<ZaloAuthInitResponse> {
  return requestJson<ZaloAuthInitResponse>("/api/all-platform/zalo/auth/qr/refresh", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  }, 95000);
}

export function getZaloAuthStatus(
  sessionId: string,
): Promise<ZaloAuthStatusResponse> {
  return requestJson<ZaloAuthStatusResponse>(
    `/api/all-platform/zalo/auth/status/${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
    },
  );
}

export function getZaloCurrentStatus(
  userId = "default",
): Promise<ZaloCurrentStatusResponse> {
  return requestJson<ZaloCurrentStatusResponse>(
    "/api/all-platform/zalo/auth/current-status",
    {
      method: "GET",
      headers: buildHeaders({
        "X-User-ID": userId,
      }),
    },
  );
}

export function startZaloManualLogin(
  userId = "default",
): Promise<ZaloManualLoginResponse> {
  return requestJson<ZaloManualLoginResponse>("/api/all-platform/zalo/auth/manual-login/start", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  });
}

export function resumeZaloManualLogin(
  userId = "default",
): Promise<ZaloManualLoginResponse> {
  return requestJson<ZaloManualLoginResponse>("/api/all-platform/zalo/auth/manual-login/resume", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  });
}

export function deleteZaloSession(
  sessionId: string,
): Promise<ZaloDeleteSessionResponse> {
  return requestJson<ZaloDeleteSessionResponse>(
    `/api/all-platform/zalo/auth/session/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
    },
  );
}

export function deleteAllZaloSessions(
  userId = "default",
): Promise<ZaloDeleteSessionResponse> {
  return requestJson<ZaloDeleteSessionResponse>("/api/all-platform/zalo/auth/sessions", {
    method: "DELETE",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  });
}

/**
 * Xoá HOÀN TOÀN 1 account Zalo: file auth local + 5 bảng Supabase
 * (zalo_accounts, zalo_sessions, zalo_users, zalo_groups, zalo_messages).
 *
 * Body: { account_id, owner_id? }
 */
export function deleteZaloAccountFull(
  accountId: string,
  ownerId?: string,
): Promise<{ success: boolean; data: { account_id: string; auth_file_deleted: boolean; listener_stopped: boolean; supabase: Record<string, number>; in_memory_sessions_cleared: number; } }> {
  return requestJson<{
    success: boolean;
    data: { account_id: string; auth_file_deleted: boolean; listener_stopped: boolean; supabase: Record<string, number>; in_memory_sessions_cleared: number; };
  }>("/api/all-platform/zalo/auth/delete-account-full", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": ownerId || accountId,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      account_id: accountId,
      owner_id: ownerId || accountId,
    }),
  });
}

/**
 * Dọn account rác trong Supabase (không có auth file + không có listener).
 */
export function cleanupZaloOrphanAccounts(): Promise<{
  success: boolean;
  deleted: any[];
  deleted_count: number;
  kept: any[];
  kept_count: number;
}> {
  return requestJson<{
    success: boolean;
    deleted: any[];
    deleted_count: number;
    kept: any[];
    kept_count: number;
  }>("/api/all-platform/zalo/auth/cleanup-orphan-accounts", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": "admin",
    }),
  });
}

export function startZaloCrawl(
  payload: ZaloStartCrawlRequest,
): Promise<ZaloStartCrawlResponse> {
  const headers: HeadersInit = {
    "X-User-ID": payload.userId?.trim() || "default",
  };
  if (payload.sessionId?.trim()) {
    headers["X-Session-ID"] = payload.sessionId.trim();
  }

  return requestJson<ZaloStartCrawlResponse>("/api/all-platform/zalo/crawl", {
    method: "POST",
    headers: buildHeaders(headers),
    body: JSON.stringify({
      group_name: payload.group_name.trim(),
      group_id: payload.group_id?.trim() || undefined,
      sheet_tab: payload.sheet_tab?.trim() || undefined,
      max_messages: Math.max(1, Math.min(payload.max_messages ?? 50, 500)),
    }),
  });
}

export function getZaloJob(jobId: string, userId = "default"): Promise<ZaloJobData> {
  return requestJson<ZaloJobData>(
    `/api/all-platform/zalo/jobs/${encodeURIComponent(jobId)}`,
    {
      method: "GET",
      headers: buildHeaders({
        "X-User-ID": userId,
      }),
    },
  );
}

export function getZaloJobs(userId = "default"): Promise<ZaloJobData[]> {
  return requestJson<ZaloJobData[]>("/api/all-platform/zalo/jobs", {
    method: "GET",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  });
}

export function buildZaloJobEventsUrl(userId = "default"): string {
  const params = new URLSearchParams({ user_id: userId });
  if (API_KEY) params.set("api_key", API_KEY);
  return `${API_BASE_URL}/api/all-platform/zalo/jobs/events?${params.toString()}`;
}

// ------------------------------------------------------------------------------------
// Realtime SSE stream cho Zalo messages (mới thêm ở bước 7).
// Vì EventSource của browser không cho set header, ta truyền user_id + api_key
// qua query string. Trả về URL đã build sẵn để caller khởi tạo EventSource.
// ------------------------------------------------------------------------------------

export interface BuildZaloRealtimeStreamOptions {
  userId?: string;
  email?: string | null;
}

export function buildZaloRealtimeWebSocketUrl(
  groupId: string,
  options: BuildZaloRealtimeStreamOptions = {}
): string {
  const params = new URLSearchParams();
  if (options.userId) params.set("user_id", options.userId);
  if (options.email) params.set("email", options.email);
  if (API_KEY) params.set("api_key", API_KEY);
  const qs = params.toString();
  
  // Convert http:// to ws:// and https:// to wss://
  const wsBaseUrl = API_BASE_URL.replace(/^http/, 'ws');
  return `${wsBaseUrl}/api/zalo/realtime/ws/${encodeURIComponent(groupId)}${qs ? `?${qs}` : ""}`;
}

export function buildZaloRealtimeStreamUrl(
  options: BuildZaloRealtimeStreamOptions = {}
): string {
  const params = new URLSearchParams();
  if (options.userId) params.set("user_id", options.userId);
  if (options.email) params.set("email", options.email);
  if (API_KEY) params.set("api_key", API_KEY);
  const qs = params.toString();
  return `${API_BASE_URL}/api/all-platform/zalo/events/stream${qs ? `?${qs}` : ""}`;
}

export interface ZaloShareStatus {
  admin: boolean;
  leader: boolean;
}

export async function getZaloConversationShareStatus(
  accountId: string,
  conversationId: string,
  userId = "default"
): Promise<ZaloShareStatus> {
  const params = new URLSearchParams({
    account_id: accountId,
    conversation_id: conversationId,
  });
  if (API_KEY) params.set("api_key", API_KEY);
  return requestJson<ZaloShareStatus>(
    `/api/all-platform/zalo/events/share-status?${params.toString()}`,
    {
      method: "GET",
      headers: buildHeaders({ "X-User-ID": userId }),
    }
  );
}

export async function setZaloConversationShare(
  accountId: string,
  conversationId: string,
  shared: boolean,
  sharedRole: "admin" | "leader" = "admin",
  userId = "default"
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/all-platform/zalo/events/share", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      account_id: accountId,
      conversation_id: conversationId,
      shared,
      shared_role: sharedRole,
    }),
  });
}

export function getZaloCrawledGroups(userId = "default"): Promise<ZaloCrawledGroupsResponse> {
  return requestJson<ZaloCrawledGroupsResponse>("/api/all-platform/zalo/groups/crawled", {
    method: "GET",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  });
}

export function getZaloLiveGroups(userId = "default"): Promise<ZaloLiveGroup[]> {
  return requestJson<ZaloLiveGroup[]>("/api/groups", {
    method: "GET",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
  });
}

export function verifyZaloGroups(
  userId = "default",
  groups: ZaloVerifyGroupRequestItem[],
  sessionId?: string | null,
): Promise<ZaloVerifyGroupsResponse> {
  const headers: HeadersInit = {
    "X-User-ID": userId,
  };
  if (sessionId?.trim()) {
    headers["X-Session-ID"] = sessionId.trim();
  }

  return requestJson<ZaloVerifyGroupsResponse>("/api/all-platform/zalo/groups/verify", {
    method: "POST",
    headers: buildHeaders(headers),
    body: JSON.stringify({ groups }),
  });
}

export function getZaloLibraryMessages(
  userId = "default",
  groupName?: string,
  limit = 50,
  offset = 0,
  contentKind: ZaloLibraryContentKind = "all",
): Promise<ZaloLibraryListResponse> {
  const params = new URLSearchParams();
  if (groupName?.trim()) params.set("group_name", groupName.trim());
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("content_kind", contentKind);
  const query = params.toString();
  return requestJson<ZaloLibraryListResponse>(
    `/api/all-platform/zalo/library/messages${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: buildHeaders({
        "X-User-ID": userId,
      }),
    },
  );
}

export function createZaloLibraryMessage(
  userId: string,
  payload: ZaloLibraryMessageCreateRequest,
): Promise<ZaloLibraryMessage> {
  return requestJson<ZaloLibraryMessage>("/api/all-platform/zalo/library/messages", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
    body: JSON.stringify(payload),
  });
}

export function updateZaloLibraryMessage(
  userId: string,
  messageId: string,
  payload: ZaloLibraryMessageUpdateRequest,
): Promise<ZaloLibraryMessage> {
  return requestJson<ZaloLibraryMessage>(
    `/api/all-platform/zalo/library/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: buildHeaders({
        "X-User-ID": userId,
      }),
      body: JSON.stringify(payload),
    },
  );
}

export function deleteZaloLibraryMessage(
  userId: string,
  messageId: string,
): Promise<ZaloLibraryMessage> {
  return requestJson<ZaloLibraryMessage>(
    `/api/all-platform/zalo/library/messages/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
      headers: buildHeaders({
        "X-User-ID": userId,
      }),
    },
  );
}

export function bulkDeleteZaloLibraryMessages(
  userId: string,
  payload: ZaloLibraryBulkDeleteRequest,
): Promise<ZaloLibraryBulkDeleteResponse> {
  return requestJson<ZaloLibraryBulkDeleteResponse>("/api/all-platform/zalo/library/messages/bulk-delete", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
    body: JSON.stringify(payload),
  });
}

export function previewZaloBroadcast(
  userId: string,
  payload: ZaloBroadcastRequest,
): Promise<ZaloBroadcastPreviewResponse> {
  return requestJson<ZaloBroadcastPreviewResponse>("/api/all-platform/zalo/broadcasts/preview", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
    body: JSON.stringify(payload),
  });
}

export function createZaloBroadcast(
  userId: string,
  payload: ZaloBroadcastRequest,
): Promise<ZaloBroadcastResponse> {
  return requestJson<ZaloBroadcastResponse>("/api/all-platform/zalo/broadcasts", {
    method: "POST",
    headers: buildHeaders({
      "X-User-ID": userId,
    }),
    body: JSON.stringify(payload),
  });
}

export function getZaloBroadcast(
  campaignId: string,
): Promise<ZaloBroadcastStatusResponse> {
  return requestJson<ZaloBroadcastStatusResponse>(
    `/api/all-platform/zalo/broadcasts/${encodeURIComponent(campaignId)}`,
    {
      method: "GET",
    },
  );
}

export interface ZaloSendMessageRequest {
  text: string;
  thread_type?: number;
}

export interface ZaloSendMessageResponse {
  ok: boolean;
  conversation_id: string;
  message: string;
}

export function sendZaloMessage(
  accountId: string,
  conversationId: string,
  payload: ZaloSendMessageRequest,
): Promise<ZaloSendMessageResponse> {
  return requestJson<ZaloSendMessageResponse>(
    `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/send`,
    {
      method: "POST",
      headers: buildHeaders({
        "X-User-ID": accountId,
      }),
      body: JSON.stringify(payload),
    },
  );
}

export function sendZaloMessageWithFiles(
  accountId: string,
  conversationId: string,
  text: string,
  files: File[],
  threadType?: number,
): Promise<ZaloSendMessageResponse> {
  const formData = new FormData();
  if (text) {
    formData.append("text", text);
  }
  if (threadType !== undefined) {
    formData.append("thread_type", String(threadType));
  }
  for (const file of files) {
    formData.append("files", file);
  }

  return requestJson<ZaloSendMessageResponse>(
    `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/send-media`,
    {
      method: "POST",
      headers: {
        "X-User-ID": accountId,
      },
      body: formData,
    },
    180000, // 3 minutes timeout for media uploads
  );
}

export interface ZaloMarkReadResponse {
  ok: boolean;
  conversation_id: string;
  message: string;
}

export function markZaloConversationAsRead(
  accountId: string,
  conversationId: string,
): Promise<ZaloMarkReadResponse> {
  return requestJson<ZaloMarkReadResponse>(
    `/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/read`,
    {
      method: "POST",
      headers: buildHeaders({
        "X-User-ID": accountId,
      }),
    },
  );
}

export interface ZaloFoundUser {
  user_id: string;
  display_name: string;
  zalo_name?: string | null;
  avatar_url?: string | null;
  phone_e164?: string | null;
  raw?: unknown;
}

export interface ZaloCreateUserThreadRequest {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
}

export interface ZaloCreateUserThreadResponse {
  ok: boolean;
  conversation_id: string;
  user_id: string;
  display_name: string;
  thread_type: number;
}

/** Tìm user Zalo (chưa từng chat) theo SĐT VN hoặc username Zalo. */
export function findZaloUser(
  accountId: string,
  query: string,
  by: "phone" | "username" = "phone",
): Promise<ZaloFoundUser> {
  const params = new URLSearchParams({ q: query, by });
  return requestJson<ZaloFoundUser>(
    `/api/all-platform/zalo/conversations/users/find?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "X-User-ID": accountId,
      },
    },
  );
}

/** Tạo (hoặc upsert) thread chat với user lạ trong zalo_groups, idempotent. */
export function createZaloUserThread(
  accountId: string,
  payload: ZaloCreateUserThreadRequest,
): Promise<ZaloCreateUserThreadResponse> {
  return requestJson<ZaloCreateUserThreadResponse>(
    "/api/all-platform/zalo/conversations/users/threads",
    {
      method: "POST",
      headers: buildHeaders({
        "X-User-ID": accountId,
      }),
      body: JSON.stringify(payload),
    },
  );
}

// ── Zalo tập trung (port ZALO_CENTRALIZED_MODULE_GUIDE.md) ─────────────────────

/** Thu hồi tin nhắn thật (api.undo) — chỉ khả dụng cho tin do chính account gửi. */
export function recallZaloMessage(
  accountId: string,
  conversationId: string,
  payload: ZaloRecallMessageRequest,
): Promise<{ ok: boolean }> {
  return requestJson(`/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/recall`, {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify(payload),
  });
}

export function getZaloFriendStatus(accountId: string, uid: string): Promise<ZaloFriendStatusResponse> {
  return requestJson(`/api/all-platform/zalo/conversations/users/${encodeURIComponent(uid)}/friend-status`, {
    method: "GET",
    headers: { "X-User-ID": accountId },
  });
}

export function sendZaloFriendRequest(accountId: string, uid: string, message = ""): Promise<{ ok: boolean }> {
  return requestJson(`/api/all-platform/zalo/conversations/users/${encodeURIComponent(uid)}/friend-request`, {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify({ message }),
  });
}

export function acceptZaloFriendRequest(accountId: string, uid: string): Promise<{ ok: boolean }> {
  return requestJson(`/api/all-platform/zalo/conversations/users/${encodeURIComponent(uid)}/friend-request/accept`, {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function getZaloGroupMembers(accountId: string, groupId: string): Promise<ZaloGroupMembersResponse> {
  return requestJson(
    `/api/all-platform/zalo/conversations/${encodeURIComponent(accountId)}/groups/${encodeURIComponent(groupId)}/members`,
    { method: "GET", headers: { "X-User-ID": accountId } },
  );
}

export function sendZaloSticker(
  accountId: string,
  conversationId: string,
  sticker: { id: number; cate_id: number; type?: number },
): Promise<{ ok: boolean }> {
  return requestJson(`/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/send-sticker`, {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify(sticker),
  });
}

export function getZaloStickersDetail(accountId: string, ids: number[]): Promise<{ stickers: ZaloStickerDetail[] }> {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return requestJson(`/api/all-platform/zalo/conversations/stickers?${params.toString()}`, {
    method: "GET",
    headers: { "X-User-ID": accountId },
  });
}

/** sendZaloMessage hiện có KHÔNG nhận mentions — dùng hàm riêng này cho tin có @tag/@All. */
export function sendZaloMessageWithMentions(
  accountId: string,
  conversationId: string,
  text: string,
  mentions: ZaloMention[],
): Promise<ZaloSendMessageResponse> {
  return requestJson(`/api/all-platform/zalo/conversations/${encodeURIComponent(conversationId)}/send`, {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify({ text, mentions }),
  });
}

// RBAC — gán quyền xem/gửi/broadcast theo tài khoản Zalo cho từng nhân viên

export function listZaloAccountAssignments(accountId: string): Promise<{ account_id: string; assignments: ZaloAccountAssignment[] }> {
  return requestJson(`/api/all-platform/zalo/accounts/${encodeURIComponent(accountId)}/assignments`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function upsertZaloAccountAssignment(
  accountId: string,
  payload: { app_user_id: string; can_view: boolean; can_send: boolean; can_broadcast: boolean },
): Promise<{ assignment: ZaloAccountAssignment }> {
  return requestJson(`/api/all-platform/zalo/accounts/${encodeURIComponent(accountId)}/assignments`, {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify(payload),
  });
}

export function deleteZaloAccountAssignment(accountId: string, appUserId: string): Promise<{ deleted: boolean }> {
  return requestJson(
    `/api/all-platform/zalo/accounts/${encodeURIComponent(accountId)}/assignments/${encodeURIComponent(appUserId)}`,
    { method: "DELETE", headers: buildHeaders({ "X-User-ID": accountId }) },
  );
}

// Forward rules

export function listZaloForwardRules(accountId: string): Promise<{ account_id: string; rules: ZaloForwardRule[] }> {
  const params = new URLSearchParams({ account_id: accountId });
  return requestJson(`/api/all-platform/zalo/forward-rules?${params.toString()}`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function createZaloForwardRule(payload: ZaloForwardRuleCreateRequest): Promise<{ rule: ZaloForwardRule }> {
  return requestJson("/api/all-platform/zalo/forward-rules", {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": payload.account_id }),
    body: JSON.stringify(payload),
  });
}

export function updateZaloForwardRule(
  accountId: string,
  ruleId: number,
  patch: { name?: string; is_enabled?: boolean },
): Promise<{ rule: ZaloForwardRule }> {
  return requestJson(`/api/all-platform/zalo/forward-rules/${ruleId}`, {
    method: "PATCH",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify(patch),
  });
}

export function deleteZaloForwardRule(accountId: string, ruleId: number): Promise<{ deleted: boolean }> {
  return requestJson(`/api/all-platform/zalo/forward-rules/${ruleId}`, {
    method: "DELETE",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function listZaloForwardLogs(accountId: string, ruleId: number): Promise<{ logs: ZaloForwardLog[] }> {
  return requestJson(`/api/all-platform/zalo/forward-rules/${ruleId}/logs`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

// Bulk-send

export function listZaloBulkJobs(accountId: string): Promise<{ jobs: ZaloBulkJob[] }> {
  const params = new URLSearchParams({ account_id: accountId });
  return requestJson(`/api/all-platform/zalo/bulk-jobs?${params.toString()}`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function createZaloBulkJob(payload: ZaloBulkJobCreateRequest): Promise<{ job: ZaloBulkJob }> {
  return requestJson("/api/all-platform/zalo/bulk-jobs", {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": payload.account_id }),
    body: JSON.stringify(payload),
  });
}

export function getZaloBulkJob(accountId: string, jobId: number): Promise<{ job: ZaloBulkJob; items: ZaloBulkJobItem[] }> {
  return requestJson(`/api/all-platform/zalo/bulk-jobs/${jobId}`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function patchZaloBulkJobStatus(accountId: string, jobId: number, status: string): Promise<{ job: ZaloBulkJob }> {
  return requestJson(`/api/all-platform/zalo/bulk-jobs/${jobId}`, {
    method: "PATCH",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify({ status }),
  });
}

export function deleteZaloBulkJob(accountId: string, jobId: number): Promise<{ deleted: boolean }> {
  return requestJson(`/api/all-platform/zalo/bulk-jobs/${jobId}`, {
    method: "DELETE",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

// Campaigns

export function listZaloCampaigns(accountId: string): Promise<{ campaigns: ZaloCampaign[] }> {
  const params = new URLSearchParams({ account_id: accountId });
  return requestJson(`/api/all-platform/zalo/campaigns?${params.toString()}`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function createZaloCampaign(payload: ZaloCampaignCreateRequest): Promise<{ campaign: ZaloCampaign }> {
  return requestJson("/api/all-platform/zalo/campaigns", {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": payload.account_id }),
    body: JSON.stringify(payload),
  });
}

export function getZaloCampaign(accountId: string, campaignId: number): Promise<{ campaign: ZaloCampaign }> {
  return requestJson(`/api/all-platform/zalo/campaigns/${campaignId}`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function patchZaloCampaign(
  accountId: string,
  campaignId: number,
  patch: Partial<ZaloCampaignCreateRequest>,
): Promise<{ campaign: ZaloCampaign }> {
  return requestJson(`/api/all-platform/zalo/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify(patch),
  });
}

export function deleteZaloCampaign(accountId: string, campaignId: number): Promise<{ deleted: boolean }> {
  return requestJson(`/api/all-platform/zalo/campaigns/${campaignId}`, {
    method: "DELETE",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function listZaloCampaignLogs(accountId: string, campaignId: number): Promise<{ logs: ZaloCampaignLog[] }> {
  return requestJson(`/api/all-platform/zalo/campaigns/${campaignId}/logs`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function listZaloCampaignRecipients(accountId: string, campaignId: number): Promise<{ recipients: ZaloCampaignRecipient[] }> {
  return requestJson(`/api/all-platform/zalo/campaigns/${campaignId}/recipients`, {
    method: "GET",
    headers: buildHeaders({ "X-User-ID": accountId }),
  });
}

export function addZaloCampaignRecipients(
  accountId: string,
  campaignId: number,
  recipients: ZaloBulkJobRecipient[],
): Promise<{ added: number }> {
  return requestJson(`/api/all-platform/zalo/campaigns/${campaignId}/recipients`, {
    method: "POST",
    headers: buildHeaders({ "X-User-ID": accountId }),
    body: JSON.stringify(recipients),
  });
}

export function suggestZaloCampaignTemplates(brief: string): Promise<{ templates: string[] }> {
  return requestJson("/api/all-platform/zalo/campaigns/ai-suggest", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ brief }),
  });
}

// Web Push

export function getZaloVapidPublicKey(): Promise<{ public_key: string }> {
  return requestJson("/api/all-platform/zalo/push/vapid-public-key", { method: "GET" });
}

export function subscribeZaloPush(payload: ZaloPushSubscribeRequest): Promise<{ subscribed: boolean }> {
  return requestJson("/api/all-platform/zalo/push/subscribe", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
}

export function unsubscribeZaloPush(endpoint: string): Promise<{ subscribed: boolean }> {
  return requestJson("/api/all-platform/zalo/push/subscribe", {
    method: "DELETE",
    headers: buildHeaders(),
    body: JSON.stringify({ endpoint }),
  });
}

