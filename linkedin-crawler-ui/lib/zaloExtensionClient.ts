/**
 * Zalo Extension Client Bridge Helper
 * Cung cấp API gọi extension từ Web UI một cách an toàn và tin cậy
 * thông qua window.postMessage RPC protocol.
 */

export interface ZaloExtensionSessionOptions {
  account_id: string;
  owner_id: string;
  backend_url: string;
  login_timeout_ms?: number;
  api_key?: string;
  chatwoot_account_id?: string;
}

export interface ZaloExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

declare global {
  interface Window {
    __zaloExtensionAvailable?: boolean;
    __zaloExtension?: {
      ping?: () => Promise<{ installed: boolean; version?: string }>;
      importSession?: (opts: ZaloExtensionSessionOptions) => Promise<ZaloExtensionResponse>;
      cancelImport?: () => Promise<ZaloExtensionResponse>;
      checkLogin?: () => Promise<{ is_logged_in: boolean; cookies_count?: number; missing?: string[] }>;
    };
  }
}

/**
 * Đăng ký client bridge nếu chưa có
 */
export function ensureZaloExtensionBridge(): void {
  if (typeof window === "undefined") return;

  if (!(window as any).__zaloBridgeReadyListenerAdded) {
    (window as any).__zaloBridgeReadyListenerAdded = true;
    window.addEventListener("message", (e) => {
      if (e.source === window && e.data && e.data.__zaloExt && e.data.type === "BRIDGE_READY") {
        window.__zaloExtensionAvailable = true;
      }
    });
  }

  if (!window.__zaloExtension) {
    window.__zaloExtension = {
      ping: () => {
        return new Promise((resolve, reject) => {
          const requestId = "ping_" + Date.now() + "_" + Math.random().toString(36).slice(2);
          const timeout = setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error("Không tìm thấy extension Zalo hoặc extension chưa phản hồi."));
          }, 4500);

          const handler = (e: MessageEvent) => {
            if (e.source !== window || !e.data || e.data.requestId !== requestId) return;
            clearTimeout(timeout);
            window.removeEventListener("message", handler);
            if (e.data.success) {
              window.__zaloExtensionAvailable = true;
              resolve(e.data.data as { installed: boolean; version?: string });
            } else {
              reject(new Error(e.data.error || "Extension ping thất bại"));
            }
          };

          window.addEventListener("message", handler);
          window.postMessage({ __zaloExt: true, type: "PING", requestId }, "*");
        });
      },

      importSession: (opts: ZaloExtensionSessionOptions) => {
        return new Promise((resolve, reject) => {
          const requestId = "import_" + Date.now() + "_" + Math.random().toString(36).slice(2);
          const timeoutMs = (opts.login_timeout_ms || 90000) + 15000;

          const timeout = setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error("Hết thời gian chờ đăng nhập Zalo qua Extension (" + Math.round(timeoutMs / 1000) + "s)."));
          }, timeoutMs);

          const handler = (e: MessageEvent) => {
            if (e.source !== window || !e.data || e.data.requestId !== requestId) return;
            clearTimeout(timeout);
            window.removeEventListener("message", handler);
            if (e.data.success) {
              resolve({ success: true, data: e.data.data });
            } else {
              resolve({ success: false, error: e.data.error || "Kết nối tài khoản Zalo thất bại" });
            }
          };

          window.addEventListener("message", handler);
          window.postMessage({ __zaloExt: true, type: "IMPORT_ZALO_SESSION", requestId, data: opts }, "*");
        });
      },

      cancelImport: () => {
        return new Promise((resolve) => {
          const requestId = "cancel_" + Date.now();
          window.postMessage({ __zaloExt: true, type: "CANCEL_IMPORT", requestId }, "*");
          resolve({ success: true });
        });
      },

      checkLogin: () => {
        return new Promise((resolve, reject) => {
          const requestId = "check_" + Date.now() + "_" + Math.random().toString(36).slice(2);
          const timeout = setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error("Timeout kiểm tra trạng thái Zalo"));
          }, 8000);

          const handler = (e: MessageEvent) => {
            if (e.source !== window || !e.data || e.data.requestId !== requestId) return;
            clearTimeout(timeout);
            window.removeEventListener("message", handler);
            if (e.data.success) {
              resolve(e.data.data);
            } else {
              reject(new Error(e.data.error || "Lỗi kiểm tra Zalo"));
            }
          };

          window.addEventListener("message", handler);
          window.postMessage({ __zaloExt: true, type: "CHECK_ZALO_LOGIN", requestId }, "*");
        });
      },
    };
  }
}

/**
 * Kiểm tra xem Extension đã được cài đặt và hoạt động hay chưa
 */
export async function isZaloExtensionInstalled(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  ensureZaloExtensionBridge();
  try {
    const res = await window.__zaloExtension?.ping?.();
    return !!res?.installed;
  } catch {
    return false;
  }
}

