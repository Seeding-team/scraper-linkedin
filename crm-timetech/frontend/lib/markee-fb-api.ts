import { API_BASE_URL } from "@/lib/env";

export const FB_API_BASE = `${API_BASE_URL}/api/all-platform/fb`;

export interface FbProvisionConfig {
  serverUrl: string;
  extensionApiKey: string;
  extensionKeyConfigured: boolean;
  owner: string;
}

export function fbHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export function fbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { headers, ...rest } = init;
  return fetch(`${FB_API_BASE}${path}`, {
    credentials: "include",
    ...rest,
    headers,
  });
}

export async function getFbProvisionConfig(): Promise<FbProvisionConfig> {
  const res = await fbFetch("/config");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.serverUrl) {
    throw new Error(data?.detail || "Khong lay duoc cau hinh FB extension");
  }
  return {
    serverUrl: data.serverUrl,
    extensionApiKey: data.extensionApiKey || "",
    extensionKeyConfigured: !!data.extensionKeyConfigured,
    owner: data.owner || "",
  };
}
