import type {
  ThreadsKeywordLibraryItem,
  CrawledPostsOverviewResponse,
  FbEaaTokenItem,
  FbEaaTokenTestResponse,
  InstagramTargetItem,
  LinkedInNoAccTargetItem,
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
    platform?: "auto" | "facebook" | "threads" | "instagram" | "linkedin_no_acc";
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
  getThreadsKeywords: () =>
    request<{ success: boolean; items: ThreadsKeywordLibraryItem[]; topics: string[] }>("/threads-keywords"),

  addThreadsKeywords: (body: { topic: string; keywords: string[] }) =>
    request<{ success: boolean; message: string; added_count: number; new_keywords: string[]; topic: string }>(
      "/threads-keywords",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  deleteThreadsKeyword: (id: string) =>
    request<{ success: boolean }>(`/threads-keywords/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  toggleThreadsKeyword: (id: string, is_active?: boolean) =>
    request<{ success: boolean }>(`/threads-keywords/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ is_active }),
    }),

  // ── Phase 2: Instagram No-Acc Targets ────────────────────────────────────
  getInstagramTargets: () =>
    request<{ success: boolean; items: InstagramTargetItem[] }>("/instagram-targets"),

  addInstagramTargets: (body: { target_type: "keyword" | "profile"; values: string[]; topic?: string }) =>
    request<{ success: boolean; added_count: number; items: InstagramTargetItem[]; message: string }>(
      "/instagram-targets",
      { method: "POST", body: JSON.stringify(body) },
    ),

  deleteInstagramTarget: (id: string) =>
    request<{ success: boolean }>(`/instagram-targets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  toggleInstagramTarget: (id: string, is_active?: boolean) =>
    request<{ success: boolean }>(`/instagram-targets/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ is_active }),
    }),

  // ── Phase 3: LinkedIn No-Acc Targets ─────────────────────────────────────
  getLinkedInNoAccTargets: () =>
    request<{ success: boolean; items: LinkedInNoAccTargetItem[] }>("/linkedin-no-acc-targets"),

  addLinkedInNoAccTargets: (body: {
    keywords: string[];
    location?: string;
    channel?: "jobs_guest" | "search_index" | "both";
  }) =>
    request<{ success: boolean; added_count: number; items: LinkedInNoAccTargetItem[]; message: string }>(
      "/linkedin-no-acc-targets",
      { method: "POST", body: JSON.stringify(body) },
    ),

  deleteLinkedInNoAccTarget: (id: string) =>
    request<{ success: boolean }>(`/linkedin-no-acc-targets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  toggleLinkedInNoAccTarget: (id: string, is_active?: boolean) =>
    request<{ success: boolean }>(`/linkedin-no-acc-targets/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ is_active }),
    }),

  // ── Phase 4: Facebook EAA Token Fast-Lane Pool ───────────────────────────
  getEaaTokens: () =>
    request<{ success: boolean; items: FbEaaTokenItem[] }>("/eaa-tokens"),

  createEaaToken: (body: {
    label: string;
    access_token: string;
    sticky_proxy_url?: string;
    hourly_quota?: number;
  }) =>
    request<{ success: boolean; item: FbEaaTokenItem }>("/eaa-tokens", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateEaaToken: (
    id: string,
    patch: {
      label?: string;
      sticky_proxy_url?: string;
      hourly_quota?: number;
      status?: "active" | "disabled" | "cooldown" | "quarantined";
    },
  ) =>
    request<{ success: boolean; item: FbEaaTokenItem }>(`/eaa-tokens/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteEaaToken: (id: string) =>
    request<{ success: boolean }>(`/eaa-tokens/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  testEaaToken: (id: string, testGroupIdOrUrl?: string) =>
    request<FbEaaTokenTestResponse>(`/eaa-tokens/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({ test_group_id_or_url: testGroupIdOrUrl || null }),
    }),

  testRawEaaToken: (body: {
    access_token: string;
    sticky_proxy_url?: string;
    test_group_id_or_url?: string;
  }) =>
    request<FbEaaTokenTestResponse>("/eaa-tokens/test-raw", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};