"use client";

import { API_BASE_URL, API_KEY } from "@/lib/env";
import type { ApiResponse } from "@/types/unified.types";
import type {
  AlertForwardConfig,
  AlertForwardConfigCreatePayload,
  AlertForwardConfigUpdatePayload,
  AlertForwardConfigsResponse,
  AlertForwardLog,
  AlertForwardTestResult,
  LiveSlaBadgesResponse,
  SlaBackfillResult,
  SlaConfig,
  SlaConfigBundle,
  SlaDashboardData,
  SlaTurnsListData,
  ZaloGroupOption,
} from "@/types/sla-alerts";

const BASE = `${API_BASE_URL}/api/all-platform/sla-alerts`;

function getAuthTokenFromBrowser(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)crawlpro_access_token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  try {
    return localStorage.getItem("token") || localStorage.getItem("access_token");
  } catch {
    return null;
  }
}

function getCallerEmailFromBrowser(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage?.getItem("app_user_email") || null;
  } catch {
    return null;
  }
}

function buildSlaHeaders(extra?: HeadersInit, callerEmailOverride?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
    headers["x-api-key"] = API_KEY;
  }
  const token = getAuthTokenFromBrowser();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const callerEmail = callerEmailOverride || getCallerEmailFromBrowser();
  if (callerEmail) {
    headers["X-Caller-Email"] = callerEmail;
  }
  if (extra) {
    const extraObj = extra instanceof Headers ? Object.fromEntries(extra.entries()) : (extra as Record<string, string>);
    Object.assign(headers, extraObj);
  }
  return headers;
}

async function requestSlaJson<T>(
  path: string,
  init?: RequestInit & { callerEmail?: string | null; timeoutMs?: number },
): Promise<ApiResponse<T>> {
  const timeoutMs = init?.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: buildSlaHeaders(init?.headers, init?.callerEmail),
      signal: init?.signal ?? controller.signal,
    });

    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail =
        typeof raw.detail === "string"
          ? raw.detail
          : typeof raw.message === "string"
            ? raw.message
            : typeof raw.error === "string"
              ? raw.error
              : `Lỗi máy chủ (${res.status})`;
      return { success: false, message: detail } as ApiResponse<T>;
    }

    if (raw.success === undefined) {
      return { success: true, data: raw as unknown as T };
    }
    return raw as unknown as ApiResponse<T>;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      success: false,
      message: isAbort
        ? "Hết thời gian chờ phản hồi từ máy chủ SLA."
        : err instanceof Error
          ? err.message
          : "Không thể kết nối máy chủ SLA.",
    } as ApiResponse<T>;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function enc(val: string): string {
  return encodeURIComponent(val);
}

export interface ListSlaTurnsParams {
  status?: string;
  channel?: string;
  staff_email?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export const slaAlertsService = {
  // ── SLA Config ──────────────────────────────────────────────────────────────
  getSlaConfig: (callerEmail?: string | null): Promise<ApiResponse<SlaConfigBundle>> =>
    requestSlaJson<SlaConfigBundle>("/config/sla", { method: "GET", callerEmail }),

  upsertSlaConfig: (
    payload: SlaConfig,
    callerEmail?: string | null,
  ): Promise<ApiResponse<SlaConfig>> =>
    requestSlaJson<SlaConfig>("/config/sla", {
      method: "PUT",
      body: JSON.stringify(payload),
      callerEmail,
    }),

  // ── Dashboard & Turns ───────────────────────────────────────────────────────
  getDashboard: (
    params: { start_date: string; end_date: string; channel?: string },
    callerEmail?: string | null,
  ): Promise<ApiResponse<SlaDashboardData>> => {
    const qs = new URLSearchParams({
      start_date: params.start_date,
      end_date: params.end_date,
      channel: params.channel || "all",
    });
    return requestSlaJson<SlaDashboardData>(`/dashboard?${qs.toString()}`, {
      method: "GET",
      callerEmail,
    });
  },

  listTurns: (
    params: ListSlaTurnsParams = {},
    callerEmail?: string | null,
  ): Promise<ApiResponse<SlaTurnsListData>> => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.channel) qs.set("channel", params.channel);
    if (params.staff_email) qs.set("staff_email", params.staff_email);
    if (params.start_date) qs.set("start_date", params.start_date);
    if (params.end_date) qs.set("end_date", params.end_date);
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    return requestSlaJson<SlaTurnsListData>(`/turns?${qs.toString()}`, {
      method: "GET",
      callerEmail,
    });
  },

  dismissTurn: (
    turnId: string,
    reason: string,
    callerEmail?: string | null,
  ): Promise<ApiResponse<Record<string, unknown>>> =>
    requestSlaJson<Record<string, unknown>>(`/turns/${enc(turnId)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ reason }),
      callerEmail,
    }),

  backfillHistory: (
    payload: { days: number; channels: string[] },
    callerEmail?: string | null,
  ): Promise<ApiResponse<SlaBackfillResult>> =>
    requestSlaJson<SlaBackfillResult>("/backfill", {
      method: "POST",
      body: JSON.stringify(payload),
      callerEmail,
      timeoutMs: 90_000,
    }),

  // ── Live SLA Badges ─────────────────────────────────────────────────────────
  getLiveBadges: (
    channel = "all",
    callerEmail?: string | null,
    signal?: AbortSignal,
  ): Promise<ApiResponse<LiveSlaBadgesResponse>> => {
    const qs = new URLSearchParams({ channel: channel || "all" });
    return requestSlaJson<LiveSlaBadgesResponse>(`/live-badges?${qs.toString()}`, {
      method: "GET",
      callerEmail,
      signal,
      timeoutMs: 10_000,
    });
  },

  // ── Zalo Group Alert Forward Configs & Logs ─────────────────────────────────
  listForwardConfigs: (
    callerEmail?: string | null,
  ): Promise<ApiResponse<AlertForwardConfigsResponse>> =>
    requestSlaJson<AlertForwardConfigsResponse>("/forward-configs", {
      method: "GET",
      callerEmail,
    }),

  createForwardConfig: (
    payload: AlertForwardConfigCreatePayload,
    callerEmail?: string | null,
  ): Promise<ApiResponse<AlertForwardConfig>> =>
    requestSlaJson<AlertForwardConfig>("/forward-configs", {
      method: "POST",
      body: JSON.stringify(payload),
      callerEmail,
    }),

  updateForwardConfig: (
    configId: string,
    payload: AlertForwardConfigUpdatePayload,
    callerEmail?: string | null,
  ): Promise<ApiResponse<AlertForwardConfig>> =>
    requestSlaJson<AlertForwardConfig>(`/forward-configs/${enc(configId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      callerEmail,
    }),

  deleteForwardConfig: (
    configId: string,
    callerEmail?: string | null,
  ): Promise<ApiResponse<Record<string, unknown>>> =>
    requestSlaJson<Record<string, unknown>>(`/forward-configs/${enc(configId)}`, {
      method: "DELETE",
      callerEmail,
    }),

  testForwardConfig: (
    configId: string,
    callerEmail?: string | null,
  ): Promise<ApiResponse<AlertForwardTestResult>> =>
    requestSlaJson<AlertForwardTestResult>(`/forward-configs/${enc(configId)}/test`, {
      method: "POST",
      body: JSON.stringify({}),
      callerEmail,
      timeoutMs: 30_000,
    }),

  listZaloGroupsForAccount: (
    accountId: string,
    callerEmail?: string | null,
  ): Promise<ApiResponse<{ groups: ZaloGroupOption[] }>> => {
    const qs = new URLSearchParams({ account_id: accountId });
    return requestSlaJson<{ groups: ZaloGroupOption[] }>(
      `/forward-configs/zalo-groups?${qs.toString()}`,
      { method: "GET", callerEmail },
    );
  },

  listForwardLogs: (
    params: { config_id?: string; limit?: number } = {},
    callerEmail?: string | null,
  ): Promise<ApiResponse<{ items: AlertForwardLog[] }>> => {
    const qs = new URLSearchParams();
    if (params.config_id) qs.set("config_id", params.config_id);
    qs.set("limit", String(params.limit ?? 50));
    return requestSlaJson<{ items: AlertForwardLog[] }>(`/forward-logs?${qs.toString()}`, {
      method: "GET",
      callerEmail,
    });
  },
};
