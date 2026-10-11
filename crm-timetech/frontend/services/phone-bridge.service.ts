import type {
  PhoneBridgeActionResponse,
  PhoneBridgeConversation,
  PhoneBridgeConversationsResponse,
  PhoneBridgeDevice,
  PhoneBridgeDevicesResponse,
  PhoneBridgePlatform,
  PhoneBridgeStatus,
} from "@/types/phone-bridge";

const PHONE_BRIDGE_BASE = "/api/all-platform/admin/phone-bridge";

function segment(value: string): string {
  return encodeURIComponent(value);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PHONE_BRIDGE_BASE}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const rawDetail =
      payload && typeof payload === "object"
        ? ("detail" in payload && payload.detail) ||
          ("message" in payload && payload.message)
        : payload;
    const detail =
      rawDetail &&
      typeof rawDetail === "object" &&
      "message" in rawDetail &&
      typeof rawDetail.message === "string"
        ? rawDetail.message
        : rawDetail;
    throw new Error(
      typeof detail === "string" && detail
        ? detail
        : `Phone Bridge request failed (${response.status})`,
    );
  }

  return payload as T;
}

function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export const phoneBridgeService = {
  getStatus: () => request<PhoneBridgeStatus>("/status"),

  async getDevices(): Promise<PhoneBridgeDevicesResponse> {
    const payload = await request<
      PhoneBridgeDevicesResponse | PhoneBridgeDevice[]
    >("/devices");
    return Array.isArray(payload) ? { devices: payload } : payload;
  },

  async getConversations(
    serial: string,
    platform: PhoneBridgePlatform,
  ): Promise<PhoneBridgeConversationsResponse> {
    const payload = await request<
      PhoneBridgeConversationsResponse | PhoneBridgeConversation[]
    >(`/devices/${segment(serial)}/${platform}/conversations`);
    if (Array.isArray(payload)) return { conversations: payload };
    return {
      ...payload,
      conversations: payload.conversations ?? payload.items ?? [],
    };
  },

  scanAll: (serial: string, platform: PhoneBridgePlatform) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/${platform}/scan-all`,
    ),

  openConversation: (
    serial: string,
    platform: PhoneBridgePlatform,
    title: string,
  ) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/${platform}/conversations/open`,
      { title },
    ),

  sendMessage: (
    serial: string,
    platform: PhoneBridgePlatform,
    body: { text: string; dryRun: boolean; confirmed: boolean },
  ) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/${platform}/send`,
      body,
    ),

  openFacebookPost: (serial: string, url: string) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/facebook/open-post`,
      { url },
    ),

  prepareFacebookLike: (serial: string, url?: string) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/facebook/prepare-like`,
      url ? { url } : {},
    ),

  confirmFacebookLike: (serial: string, confirmationToken: string) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/facebook/confirm-like`,
      { confirmationToken, humanConfirmed: true, confirmed: true },
    ),

  commentOnFacebookPost: (serial: string, text: string) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/facebook/comment`,
      { text, confirmed: true },
    ),

  previewFacebookPost: (serial: string, text: string) =>
    post<PhoneBridgeActionResponse>(
      `/devices/${segment(serial)}/facebook/create-post`,
      { text, dryRun: true },
    ),

  eventsUrl: `${PHONE_BRIDGE_BASE}/events/stream`,
};
