function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL?.replace(/\/+$/, "") || "";
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    const origin = window.location.origin.replace(/\/+$/, "");
    try {
      if (!configured) return origin;
      const configuredUrl = new URL(configured);
      const isLocalRuntime = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      if (!isLocalRuntime && configuredUrl.origin !== origin) return origin;
    } catch {
      return origin;
    }
  }
  return configured || "http://localhost:8000";
}

export const API_BASE_URL = resolveApiBaseUrl();

export const API_KEY = process.env.NEXT_PUBLIC_LINKEDIN_CRAWLER_API_KEY ?? "";

// OAuth client IDs are public identifiers. Keep a Dev fallback aligned with
// the backend so Google Identity Services can open the account chooser even
// when a standalone clone has an empty NEXT_PUBLIC build arg.
export const GOOGLE_OAUTH_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "674669134021-dk8gikthiul7hnvqinoob6p59mirhtd9.apps.googleusercontent.com";
export const GMAIL_OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_GMAIL_OAUTH_CLIENT_ID || "";

/**
 * TÍCH HỢP BỘ LỌC WORKSPACE:
 * - crm-cloudgate là module CRM Standalone (CloudGate instance).
 * - Khóa cố định workspace vào "cloudgate", ẩn hoàn toàn nút bộ lọc trên giao diện.
 */
export const IS_STANDALONE_CRM = true;

export const CURRENT_WORKSPACE_INSTANCE = (process.env.NEXT_PUBLIC_CRM_INSTANCE || "cloudgate").toLowerCase();
