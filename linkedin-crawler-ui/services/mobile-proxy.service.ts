import type {
  MobileProxyConfigResponse,
  MobileProxyRotateResponse,
  MobileProxySmsResponse,
} from "@/types/mobile-proxy";

const BASE = "/api/all-platform/admin/mobile-proxy";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return payload as T;
}

export const mobileProxyService = {
  getStatus: () => request<MobileProxyConfigResponse>("/status"),
  rotate: (nodeId?: string) =>
    request<MobileProxyRotateResponse>(
      `/rotate${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ""}`,
      { method: "POST", body: "{}" },
    ),
  getSms: (nodeId?: string) =>
    request<MobileProxySmsResponse>(`/sms${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ""}`),
};
