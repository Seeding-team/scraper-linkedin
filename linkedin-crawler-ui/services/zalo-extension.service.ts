/**
 * Helper gọi Chrome Extension để lấy Zalo cookies + import session,
 * và gọi API Server-Side Zalo QR Login (`/api/all-platform/zalo/auth/qr/*`).
 *
 * Cách hoạt động Extension (qua Content Script Bridge):
 *   1. Web page gọi: window.postMessage({ __zaloExt: true, type, requestId, data }, "*")
 *   2. content-script-bridge.js nhận và forward tới background: chrome.runtime.sendMessage(...)
 *   3. Background respond → Bridge postMessage về web với cùng requestId.
 */

import { API_BASE_URL, API_KEY } from "@/lib/env";

interface ZaloBridgeWindow extends Window {
  __zaloExtensionAvailable?: boolean;
}

function getBridgeWindow(): ZaloBridgeWindow | null {
  if (typeof window === "undefined") return null;
  return window as ZaloBridgeWindow;
}

export interface ZaloCookie {
  key: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

export interface ZaloCookiesFromExtension {
  cookies: ZaloCookie[];
  keys: string[];
  user_agent: string;
  imei: string;
  missing: string[];
  is_logged_in: boolean;
}

export interface ImportZaloSessionParams {
  account_id: string;
  user_id?: string;
  owner_id?: string;
  backend_url?: string;
  api_key?: string;
  login_timeout_ms?: number;
}

export interface ImportZaloSessionBackendResult {
  ok?: boolean;
  status?: string;
  session_id?: string;
  detail?: unknown;
  message?: string;
  [key: string]: unknown;
}

export interface ImportZaloSessionResult {
  status: number;
  backend: ImportZaloSessionBackendResult;
  cookies_count: number;
  keys: string[];
}

export interface SyncZaloDomMessagesParams {
  account_id: string;
  conversation_id?: string;
  limit?: number;
  conversation_limit?: number;
}

export interface SyncZaloDomMessagesResult {
  status: number;
  backend: {
    ok?: boolean;
    account_id?: string;
    scanned?: number;
    groups_with_messages?: number;
    messages_saved?: number;
    errors?: number;
    results?: Array<{
      group_id: string;
      group_name: string;
      messages_saved: number;
      status: string;
      error?: string | null;
    }>;
    [key: string]: unknown;
  };
  scraped?: {
    conversations_count?: number;
    messages_count?: number;
    active_group_id?: string | null;
    active_group_name?: string | null;
  };
}

// ── Zalo Server-Side QR Login Contracts (@zalo-session-be) ───────────────────

export type ZaloQrSessionStatus =
  | "starting"
  | "qr_ready"
  | "scanned"
  | "confirmed"
  | "expired"
  | "declined"
  | "cancelled"
  | "error";

export interface ZaloQrScannedUser {
  display_name?: string | null;
  avatar?: string | null;
}

export interface StartZaloQrLoginParams {
  account_id?: string;
  label?: string;
  proxy_url?: string | null;
}

export interface ZaloQrStartResponse {
  qr_session_id: string;
  status: ZaloQrSessionStatus;
  qr_data_url?: string | null;
  account_id?: string | null;
  attempt: number;
  max_attempts: number;
  expires_in_s: number;
  has_proxy: boolean;
  proxy_masked?: string | null;
  error?: string | null;
}

export interface ZaloQrStatusResponse {
  qr_session_id: string;
  status: ZaloQrSessionStatus;
  qr_data_url?: string | null;
  scanned_user?: ZaloQrScannedUser | null;
  account_id?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  attempt: number;
  max_attempts: number;
  expires_in_s: number;
  has_proxy?: boolean;
  proxy_masked?: string | null;
  error?: string | null;
}

export interface ZaloQrCancelResponse {
  ok: boolean;
  qr_session_id: string;
  status: "cancelled" | string;
}

export class ZaloExtensionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ZaloExtensionError";
  }
}

function makeExtensionMissingError(): ZaloExtensionError {
  return new ZaloExtensionError(
    "extension_missing",
    "Chưa cài Chrome Extension lấy Zalo cookies. Hãy:\n" +
      "  1. Tải file /extension-login-zalo.zip và giải nén\n" +
      "  2. Mở chrome://extensions/ → bật Developer mode\n" +
      "  3. Bấm 'Load unpacked' → chọn thư mục extension-login-zalo\n" +
      "  4. Reload lại trang web này rồi thử kết nối lại.",
  );
}

interface BridgePostPayload {
  __zaloExt?: boolean;
  type?: string;
  requestId?: string;
  installed?: boolean;
  success?: boolean;
  error?: string;
  data?: {
    installed?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Ping extension bridge để xác nhận đã cài.
 * Bridge tự set window.__zaloExtensionAvailable = true khi inject xong.
 */
export async function isZaloExtensionAvailable(): Promise<boolean> {
  const win = getBridgeWindow();
  if (!win) return false;
  if (win.__zaloExtensionAvailable === true) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const requestId = `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win) return;
      const data = event.data as BridgePostPayload | null | undefined;
      if (!data || data.__zaloExt !== true) return;
      const isPong = data.type === "PONG" && data.requestId === requestId;
      const isBridgeResponse = data.type === "RESPONSE" && data.requestId === requestId;
      if (isPong || isBridgeResponse) {
        win.removeEventListener("message", onMessage);
        win.__zaloExtensionAvailable = true;
        resolve(
          data.installed === true || data.data?.installed === true || data.success === true,
        );
      }
    };
    win.addEventListener("message", onMessage);
    try {
      win.postMessage({ __zaloExt: true, type: "PING", requestId }, "*");
    } catch {
      win.removeEventListener("message", onMessage);
      resolve(false);
      return;
    }
    setTimeout(() => {
      win.removeEventListener("message", onMessage);
      resolve(false);
    }, 1000);
  });
}

/**
 * Gửi message tới extension qua postMessage bridge, đợi response.
 */
async function sendViaBridge<T = unknown>(
  type: string,
  data?: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<T> {
  const win = getBridgeWindow();
  if (!win) {
    throw makeExtensionMissingError();
  }
  if (win.__zaloExtensionAvailable !== true) {
    const ok = await isZaloExtensionAvailable();
    if (!ok) throw makeExtensionMissingError();
  }
  const requestId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<T>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win) return;
      const payload = event.data as BridgePostPayload | null | undefined;
      if (!payload || payload.__zaloExt !== true) return;
      if (payload.type !== "RESPONSE") return;
      if (payload.requestId !== requestId) return;
      win.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (payload.success) {
        resolve(payload.data as T);
      } else {
        reject(new ZaloExtensionError("extension_error", payload.error || "Extension error"));
      }
    };
    win.addEventListener("message", onMessage);
    const timer = setTimeout(() => {
      win.removeEventListener("message", onMessage);
      reject(
        new ZaloExtensionError(
          "timeout",
          `Extension không phản hồi sau ${Math.round(timeoutMs / 1000)}s. Bridge có thể chưa sẵn sàng. Reload trang và thử lại.`,
        ),
      );
    }, timeoutMs);
    try {
      win.postMessage({ __zaloExt: true, type, requestId, data: data || {} }, "*");
    } catch {
      win.removeEventListener("message", onMessage);
      clearTimeout(timer);
      reject(makeExtensionMissingError());
    }
  });
}

/**
 * Lấy cookies Zalo từ extension.
 */
export async function getZaloCookiesFromExtension(): Promise<ZaloCookiesFromExtension> {
  return await sendViaBridge<ZaloCookiesFromExtension>("GET_ZALO_COOKIES", undefined, 20000);
}

/**
 * Kiểm tra user đã login Zalo chưa (cookie zppsid tồn tại).
 */
export async function checkZaloLoginViaExtension(): Promise<{
  is_logged_in: boolean;
  cookies_count: number;
  missing: string[];
  keys: string[];
}> {
  return await sendViaBridge("CHECK_ZALO_LOGIN", undefined, 15000);
}

/**
 * Gọi extension import session: extension tự mở tab chat.zalo.me, chờ đăng nhập (tối đa 90s),
 * trích xuất cookies, gửi lên backend và tự động đóng tab sau khi đồng bộ xong.
 * Timeout 115000ms (> 90000ms của extension) để không cắt ngang trước khi extension hoàn tất.
 */
export async function importZaloSessionViaExtension(
  params: ImportZaloSessionParams,
): Promise<ImportZaloSessionResult> {
  return await sendViaBridge<ImportZaloSessionResult>(
    "IMPORT_ZALO_SESSION",
    {
      ...params,
      backend_url: params.backend_url || API_BASE_URL,
      api_key: params.api_key ?? API_KEY,
    },
    115000,
  );
}

/**
 * Đồng bộ tin nhắn đang hiển thị trong Zalo Web DOM qua extension.
 * Không đụng tới realtime listener/gửi tin; extension chỉ scrape DOM rồi POST backend /sync-dom.
 */
export async function syncZaloDomMessagesViaExtension(
  params: SyncZaloDomMessagesParams,
): Promise<SyncZaloDomMessagesResult> {
  return await sendViaBridge<SyncZaloDomMessagesResult>(
    "SYNC_ZALO_DOM_MESSAGES",
    {
      ...params,
      backend_url: API_BASE_URL,
      api_key: API_KEY,
    },
    600000,
  );
}

// ── Zalo Server-Side QR API Helpers ──────────────────────────────────────────

function buildZaloQrHeaders(accountId?: string): HeadersInit {
  const callerEmail =
    typeof window !== "undefined" ? window.localStorage?.getItem("app_user_email") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) headers["x-api-key"] = API_KEY;
  if (callerEmail) headers["X-Caller-Email"] = callerEmail;
  if (accountId) headers["X-User-ID"] = accountId;
  return headers;
}

async function requestZaloQrJson<T>(
  path: string,
  init: RequestInit,
  accountId?: string,
  timeoutMs = 30000,
): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...buildZaloQrHeaders(accountId),
        ...(init.headers || {}),
      },
      signal: init.signal ?? controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Yêu cầu máy chủ Zalo QR quá thời gian (${Math.round(timeoutMs / 1000)}s).`);
    }
    throw err instanceof Error ? err : new Error("Không thể kết nối máy chủ Zalo QR.");
  } finally {
    globalThis.clearTimeout(timer);
  }

  const rawText = await response.text();
  let parsed: Record<string, unknown> | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const detail =
      (parsed &&
        (typeof parsed.detail === "string"
          ? parsed.detail
          : typeof parsed.error === "string"
            ? parsed.error
            : typeof parsed.message === "string"
              ? parsed.message
              : null)) ||
      (rawText.trim() || `Lỗi máy chủ Zalo QR (${response.status})`);
    throw new Error(detail);
  }

  return (parsed ?? {}) as T;
}

export async function startZaloQrLogin(
  params?: StartZaloQrLoginParams,
): Promise<ZaloQrStartResponse> {
  const body: Record<string, unknown> = {};
  if (params?.account_id?.trim()) body.account_id = params.account_id.trim();
  if (params?.label?.trim()) body.label = params.label.trim();
  if (params?.proxy_url !== undefined) body.proxy_url = params.proxy_url;

  return await requestZaloQrJson<ZaloQrStartResponse>(
    "/api/all-platform/zalo/auth/qr/start",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    params?.account_id,
    35000,
  );
}

export async function getZaloQrStatus(qrSessionId: string): Promise<ZaloQrStatusResponse> {
  return await requestZaloQrJson<ZaloQrStatusResponse>(
    `/api/all-platform/zalo/auth/qr/status/${encodeURIComponent(qrSessionId)}`,
    {
      method: "GET",
      cache: "no-store",
    },
    undefined,
    15000,
  );
}

export async function cancelZaloQrLogin(qrSessionId: string): Promise<ZaloQrCancelResponse> {
  return await requestZaloQrJson<ZaloQrCancelResponse>(
    `/api/all-platform/zalo/auth/qr/cancel/${encodeURIComponent(qrSessionId)}`,
    {
      method: "POST",
    },
    undefined,
    10000,
  );
}
