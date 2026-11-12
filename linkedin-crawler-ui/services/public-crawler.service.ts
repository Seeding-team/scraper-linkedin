import type {
  CrawledPostsOverviewResponse,
  ProxyTestResponse,
  PublicCrawlActionResponse,
  PublicCrawlConfig,
  PublicCrawlGroupItem,
  PublicCrawlStatusResponse,
} from "@/types/public-crawler";

const BASE = "/api/all-platform/public-crawler";

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

export const publicCrawlerService = {
  getStatus: () => request<PublicCrawlStatusResponse>("/status"),

  runNow: (body?: {
    group_ids?: string[];
    keywords?: string[];
    only_due?: boolean;
    limit_groups?: number;
  }) =>
    request<PublicCrawlActionResponse>("/run", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  stop: () =>
    request<PublicCrawlActionResponse>("/stop", {
      method: "POST",
      body: "{}",
    }),

  updateConfig: (patch: Partial<PublicCrawlConfig>) =>
    request<{ success: boolean; config: PublicCrawlConfig }>("/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  listGroups: (visibility?: "public" | "private") => {
    const qs = visibility ? `?visibility=${encodeURIComponent(visibility)}` : "";
    return request<{ success: boolean; groups: PublicCrawlGroupItem[] }>(`/groups${qs}`);
  },

  updateGroup: (
    groupId: string,
    patch: {
      visibility?: "public" | "private";
      public_crawl_enabled?: boolean;
      public_crawl_interval_min?: number;
    },
  ) =>
    request<{ success: boolean; group: PublicCrawlGroupItem }>(
      `/groups/${encodeURIComponent(groupId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
    ),

  bulkToggleGroups: (body: {
    group_ids: string[];
    public_crawl_enabled?: boolean;
    visibility?: "public" | "private";
  }) =>
    request<{ success: boolean; updated_count: number }>("/groups/bulk-toggle", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  testProxy: (body?: { node_id?: string; do_rotate?: boolean }) =>
    request<ProxyTestResponse>("/proxy/test", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  getCrawledPosts: (params?: {
    time_range?: "today" | "7d" | "all";
    search?: string;
    ai_filter?: "all" | "lead_high" | "kept" | "deleted" | "pending";
    source_filter?: "all" | "public_4g" | "extension";
    limit?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.time_range) searchParams.set("time_range", params.time_range);
    if (params?.search?.trim()) searchParams.set("search", params.search.trim());
    if (params?.ai_filter) searchParams.set("ai_filter", params.ai_filter);
    if (params?.source_filter) searchParams.set("source_filter", params.source_filter);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const qs = searchParams.toString();
    return request<CrawledPostsOverviewResponse>(`/crawled-posts${qs ? `?${qs}` : ""}`);
  },
};
