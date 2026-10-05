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

export const GOOGLE_OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
