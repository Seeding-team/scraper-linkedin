/**
 * Client cho tính năng "Bot AI tự trả lời Zalo" — gọi cùng prefix
 * /api/all-platform/zalo và cùng khuôn xác thực với lib/zaloApiClient.ts
 * (cookie phiên cùng origin + header X-User-ID).
 */

const BASE = "/api/all-platform/zalo/zalo-bot";

export class ZaloBotApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ZaloBotApiError";
    this.status = status;
  }
}

export type ZaloBotReadiness = {
  zca_logged_in: boolean;
  n8n_incoming_configured: boolean;
  shared_secret_configured: boolean;
  chatwoot_sync_configured: boolean;
  bridge_enabled: boolean;
  config_complete: boolean;
};

/** all = trả lời mọi người (trừ người đã tắt) | selected = chỉ trả lời những người đã bật. */
export type ZaloBotScopeMode = "all" | "selected";

export type ZaloBotScopeSummary = { scope_mode: ZaloBotScopeMode; on_count: number; off_count: number };

export type ZaloBotConfig = {
  account_id: string;
  exists: boolean;
  is_enabled: boolean;
  dry_run: boolean;
  chatwoot_account_id: number | null;
  chatwoot_inbox_id: number | null;
  auto_pause_on_staff_reply: boolean;
  pause_minutes: number;
  chatwoot_sync: boolean;
  scope_mode: ZaloBotScopeMode;
  scope: ZaloBotScopeSummary;
  /** Chờ khách im lặng bấy nhiêu giây rồi gộp các tin liên tiếp thành 1 câu hỏi (0 = tắt gom tin). */
  batch_wait_seconds: number;
  updated_at: string | null;
  readiness: ZaloBotReadiness;
};

export type ZaloBotConfigUpdate = Partial<
  Pick<
    ZaloBotConfig,
    | "is_enabled"
    | "dry_run"
    | "chatwoot_account_id"
    | "chatwoot_inbox_id"
    | "auto_pause_on_staff_reply"
    | "pause_minutes"
    | "chatwoot_sync"
    | "scope_mode"
    | "batch_wait_seconds"
  >
>;

export type ZaloBotConfigBrief = { is_enabled: boolean; dry_run: boolean };

export type ZaloBotThreadState = "off" | "active" | "paused" | "handed_off" | "out_of_scope";

export type ZaloBotThreadStatus = {
  account_id: string;
  thread_id: string;
  bot_applicable: boolean;
  bot_enabled: boolean;
  scope_mode: ZaloBotScopeMode;
  /** true = bật tay, false = tắt tay, null = theo mặc định của phạm vi */
  rule: boolean | null;
  /** bot có được phép trả lời hội thoại này không */
  in_scope: boolean;
  dry_run: boolean;
  state: ZaloBotThreadState;
  paused: boolean;
  paused_until: string | null;
  reason: "manual" | "staff_reply" | null;
  paused_by: string | null;
  chatwoot_handed_off: boolean | null;
};

export type ZaloBotScopeRule = { thread_id: string; name: string; bot_on: boolean };

export type ZaloBotScope = {
  scope_mode: ZaloBotScopeMode;
  on_count: number;
  off_count: number;
  rules: ZaloBotScopeRule[];
};

export type ZaloBotCandidate = { thread_id: string; name: string; avatar_url: string | null; rule: boolean | null };

export type ZaloBotLogDirection = "in" | "out";
export type ZaloBotLogStatus = "forwarded" | "sent" | "dry_run" | "skipped" | "paused" | "error";

export type ZaloBotLogItem = {
  id: number;
  account_id: string;
  thread_id: string;
  thread_name: string | null;
  direction: ZaloBotLogDirection;
  source_msg_id: string | null;
  content: string | null;
  status: ZaloBotLogStatus;
  error: string | null;
  created_at: string;
};

export type ZaloBotLogsResponse = {
  items: ZaloBotLogItem[];
  has_more: boolean;
  next_before_id: number | null;
};

export type ZaloBotLogsQuery = {
  account_id?: string;
  thread_id?: string;
  direction?: ZaloBotLogDirection;
  status?: ZaloBotLogStatus;
  q?: string;
  limit?: number;
  before_id?: number | null;
};

export type ZaloBotStats = {
  days: number;
  totals: Record<"forwarded" | "sent" | "dry_run" | "skipped" | "paused" | "error", number>;
  threads_handled: number;
  by_day: { date: string; in: number; out: number; error: number }[];
};

type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  accountId?: string;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, accountId, signal } = opts;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "X-User-ID": accountId || "shop-owner", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ZaloBotApiError("Không kết nối được máy chủ, vui lòng thử lại.", 0);
  }

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload: unknown = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const detail =
      isJson && payload && typeof payload === "object" && "detail" in payload
        ? (payload as { detail?: unknown }).detail
        : null;
    const msg = typeof detail === "string" && detail ? detail : `HTTP ${res.status}`;
    throw new ZaloBotApiError(msg, res.status);
  }
  return payload as T;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

function toQuery(params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const zaloBotApi = {
  getConfig(accountId: string, signal?: AbortSignal) {
    return request<ZaloBotConfig>(`/config/${enc(accountId)}`, { accountId, signal });
  },
  updateConfig(accountId: string, body: ZaloBotConfigUpdate) {
    return request<ZaloBotConfig>(`/config/${enc(accountId)}`, { method: "PUT", body, accountId });
  },
  getConfigs(accountIds: string[], signal?: AbortSignal) {
    return request<{ configs: Record<string, ZaloBotConfigBrief> }>(
      `/configs${toQuery({ account_ids: accountIds.join(",") })}`,
      { signal },
    );
  },
  getThreadStatus(accountId: string, threadId: string, signal?: AbortSignal) {
    return request<ZaloBotThreadStatus>(`/threads/${enc(accountId)}/${enc(threadId)}/status`, { accountId, signal });
  },
  takeover(accountId: string, threadId: string, minutes?: number | null) {
    return request<ZaloBotThreadStatus>(`/threads/${enc(accountId)}/${enc(threadId)}/takeover`, {
      method: "POST",
      body: { minutes: minutes ?? null },
      accountId,
    });
  },
  resume(accountId: string, threadId: string) {
    return request<ZaloBotThreadStatus>(`/threads/${enc(accountId)}/${enc(threadId)}/resume`, {
      method: "POST",
      accountId,
    });
  },
  getPausedThreads(accountId: string, signal?: AbortSignal) {
    return request<{ paused_thread_ids: string[] }>(`/threads/${enc(accountId)}/paused`, { accountId, signal });
  },
  getScope(accountId: string, signal?: AbortSignal) {
    return request<ZaloBotScope>(`/scope/${enc(accountId)}`, { accountId, signal });
  },
  getScopeCandidates(accountId: string, q: string, limit = 60, signal?: AbortSignal) {
    return request<{ items: ZaloBotCandidate[] }>(
      `/scope/${enc(accountId)}/candidates${toQuery({ q, limit })}`,
      { accountId, signal },
    );
  },
  /** botOn: true = bật, false = tắt, null = bỏ rule (về mặc định của phạm vi). */
  setScopeRules(accountId: string, threadIds: string[], botOn: boolean | null) {
    return request<{ changed: number; skipped_not_direct: number }>(`/scope/${enc(accountId)}/rules`, {
      method: "POST",
      body: { thread_ids: threadIds, bot_on: botOn },
      accountId,
    });
  },
  clearScopeRules(accountId: string) {
    return request<{ ok: boolean }>(`/scope/${enc(accountId)}/clear`, { method: "POST", accountId });
  },
  setThreadRule(accountId: string, threadId: string, botOn: boolean | null) {
    return request<ZaloBotThreadStatus>(`/threads/${enc(accountId)}/${enc(threadId)}/rule`, {
      method: "POST",
      body: { bot_on: botOn },
      accountId,
    });
  },
  getLogs(query: ZaloBotLogsQuery, signal?: AbortSignal) {
    return request<ZaloBotLogsResponse>(`/logs${toQuery({ ...query })}`, { accountId: query.account_id, signal });
  },
  getStats(accountId: string, days: number, signal?: AbortSignal) {
    return request<ZaloBotStats>(`/stats${toQuery({ account_id: accountId, days })}`, { accountId, signal });
  },
};

/** thread_id của Zalo từ conversation_id của inbox (bỏ tiền tố "u:" nếu có). */
export function zaloThreadIdFromConversationId(conversationId: string): string {
  return conversationId.startsWith("u:") ? conversationId.slice(2) : conversationId;
}

/** Hội thoại nhóm (id dạng "g:...") — bot chỉ áp dụng chat 1-1. */
export function isZaloGroupConversationId(conversationId: string): boolean {
  return conversationId.startsWith("g:");
}
