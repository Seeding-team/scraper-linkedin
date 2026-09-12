/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type {
  UnifiedPost,
  SeedingMark,
  SeedingCountResult,
  KpiMember,
  KpiAssignment,
  Category,
  MemberProfile,
  Skill,
  QuickCommentTemplate,
  QuickInboxTemplate,
  FacebookGroup,
  LinkedInGroup,
  ApiResponse,
  AppUser,
  AuthLoginResponse,
  SocialAccount,
  SocialAccountSummary,
  InternalEngagementPost,
  InternalEngagementMarkStatus,
  InternalEngagementPostTeamCountsData,
  InternalEngagementPostInteractionsData,
  InternalEngagementTeamTrendData,
  InternalEngagementTeamTotalsData,
} from "@/types/unified.types";
import { API_BASE_URL, API_KEY } from "@/lib/env";

const BASE = `${API_BASE_URL}/api/all-platform`;
const authHeaders = () => ({});
const AUTH_SUBMIT_TIMEOUT_MS = 12000;

/**
 * Lightweight in-memory TTL cache for read-mostly taxonomies & teams.
 *
 * - Avoids re-fetching categories + teams every time user changes platform or filter
 * - Works across React component instances (module-level singleton)
 * - Per-key TTL so different cache buckets expire independently
 * - SSR-safe: returns `null` on server (component is "use client" so this is rare)
 *
 * Not for: anything that must reflect real-time writes (post lists, stats).
 */
interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const taxonomyCache = new Map<string, CacheEntry<unknown>>();

/**
 * Get-or-fetch helper. Caches the resolved value of `fetcher()` under `key`
 * for `ttlMs` milliseconds. Concurrent callers share a single in-flight request.
 */
const inflightRequests = new Map<string, Promise<unknown>>();

async function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") {
    return fetcher(); // SSR
  }
  const now = Date.now();
  const cached = taxonomyCache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  // Coalesce concurrent requests
  const inflight = inflightRequests.get(key);
  if (inflight) {
    return (await inflight) as T;
  }
  const promise = (async () => {
    try {
      const data = await fetcher();
      taxonomyCache.set(key, { data, expiresAt: Date.now() + ttlMs });
      return data;
    } finally {
      inflightRequests.delete(key);
    }
  })();
  inflightRequests.set(key, promise);
  return promise;
}

/**
 * Invalidate one (or all) cache buckets.
 * - `invalidateTaxonomyCache()` — clear everything (after admin edit)
 * - `invalidateTaxonomyCache('categories')` — clear specific bucket
 */
export function invalidateTaxonomyCache(key?: string): void {
  if (!key) {
    taxonomyCache.clear();
    return;
  }
  taxonomyCache.delete(key);
}

/**
 * Trả về header mặc định cho mọi request — bao gồm:
 *  - X-API-Key: backend yêu cầu (verify_zalo_api_key), đọc từ NEXT_PUBLIC_LINKEDIN_CRAWLER_API_KEY
 *  - Có thể bị override bởi `init.headers` nếu caller cần custom
 */
function getDefaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }
  return headers;
}

const CONNECTION_ERROR_MESSAGE = "Mất kết nối tới máy chủ, vui lòng thử lại.";

// Backend đôi khi trả HTTP 200 kèm success:false mang nguyên văn lỗi httpx
// (vd "Server disconnected without sending a response."). Đó là lỗi hạ tầng
// tạm thời, phải thử lại chứ không phải hiển thị cho người dùng.
const TRANSIENT_MESSAGE_MARKERS = ["server disconnected", "remoteprotocolerror", "connectionterminated", "pooltimeout", "readtimeout", "connecttimeout", "timed out", "502 bad gateway", "503 service unavailable", "504 gateway"];

function isTransientMessage(message: unknown): boolean {
  if (typeof message !== "string" || !message) return false;
  const lower = message.toLowerCase();
  return TRANSIENT_MESSAGE_MARKERS.some((marker) => lower.includes(marker));
}

async function requestJson<T = any>(path: string, init?: RequestInit, retries: number = 2): Promise<ApiResponse<T>> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(path, {
        ...init,
        credentials: "include",
        headers: {
          ...getDefaultHeaders(),
          ...(init?.headers || {}),
        },
      });

      // Nếu server trả về lỗi 5xx, có thể do đang khởi động lại hoặc load balancer ngắt kết nối
      if (!res.ok && res.status >= 500) {
        throw new Error(`Lỗi máy chủ (${res.status})`);
      }

      const rawBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      // Endpoint không tự trả BaseResponse (vd 401/403/422 do FastAPI tự sinh từ
      // HTTPException/Depends) có body dạng {"detail": "..."} chứ KHÔNG có
      // success/message — nếu trả thẳng body này, mọi nơi gọi requestJson() sẽ
      // thấy res.success/res.message đều undefined và rơi vào thông báo lỗi
      // chung chung ("Không tạo được tài khoản"...), che mất lý do thật (vd
      // "Forbidden: Admin role required", "Missing or invalid authorization
      // header"). Chuẩn hoá detail -> message ở đây để lỗi thật luôn hiện ra.
      if (!res.ok && rawBody.success === undefined) {
        return {
          success: false,
          message: (rawBody.detail as string) || (rawBody.message as string) || `Lỗi máy chủ (${res.status})`,
        } as ApiResponse<T>;
      }

      const body = rawBody as unknown as ApiResponse<T>;

      // 200 nhưng backend báo lỗi hạ tầng tạm thời -> thử lại như với 5xx.
      if (body && body.success === false && isTransientMessage(body.message)) {
        throw new Error(body.message as string);
      }

      return body;
    } catch (err) {
      lastError = err;
      // Request bị huỷ chủ động (timeout, đổi tab, unmount): không phải lỗi hạ
      // tầng -> dừng ngay, không retry. Vẫn RETURN (không throw) để
      // requestJsonWithTimeout còn đọc được controller.signal.aborted.
      if (err instanceof Error && err.name === "AbortError") {
        break;
      }
      if (attempt < retries) {
        // Backoff tăng dần: 400ms, 800ms...
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }

  // Không bao giờ đổ nguyên văn lỗi httpx/tiếng Anh ra UI.
  const rawMessage = lastError instanceof Error ? lastError.message : "";
  return {
    success: false,
    message: !rawMessage || isTransientMessage(rawMessage) ? CONNECTION_ERROR_MESSAGE : rawMessage,
  };
}

async function requestJsonWithTimeout<T = any>(path: string, init: RequestInit | undefined, timeoutMs: number, timeoutMessage: string): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await requestJson<T>(path, {
      ...init,
      signal: controller.signal,
    });
    if (!res.success && controller.signal.aborted) {
      return {
        ...res,
        message: timeoutMessage,
      };
    }
    return res;
  } finally {
    window.clearTimeout(timer);
  }
}

// ── SEEDING (Facebook) ────────────────────────────────────────────────────────

export const allPlatformSeedingService = {
  mark: (payload: { email_member: string; link_post: string; platform: string; name?: string; link_comment?: string; name_profile?: string; content?: string; profile_id?: string; facebook_name?: string; current_day?: string }): Promise<ApiResponse<SeedingMark>> => {
    return requestJson(`${BASE}/facebook/seeding-mark/save`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  verify: (payload: {
    email_member: string;
    link_post: string;
    platform: string;
    name?: string;
    link_comment?: string;
    name_profile?: string;
    content?: string;
    profile_id?: string;
    facebook_name?: string;
    id_post?: string;
    id_social_account?: string;
    id_platform?: number;
  }): Promise<ApiResponse<SeedingMark>> => {
    return requestJson(`${BASE}/facebook/seeding-mark/verify`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getAll: (email_member: string): Promise<ApiResponse<SeedingMark[]>> => {
    return requestJson(`${BASE}/facebook/seeding-mark/get-all`, {
      method: "POST",
      body: JSON.stringify({ email_member }),
    });
  },

  getUnverified: (email_member: string): Promise<ApiResponse<SeedingMark[]>> => {
    return requestJson(`${BASE}/facebook/seeding-mark/get-unverified`, {
      method: "POST",
      body: JSON.stringify({ email_member }),
    });
  },

  getActualCount: (payload: { email_member: string; date_from?: string; date_to?: string; profile_id?: string; facebook_name?: string; platform: string }): Promise<ApiResponse<SeedingCountResult>> => {
    return requestJson(`${BASE}/${payload.platform}/seeding-mark/get-actual-count`, { method: "POST", body: JSON.stringify(payload) });
  },

  getKpiTarget: (payload: { email_member: string; date_from?: string; date_to?: string; platform: string }): Promise<ApiResponse<SeedingCountResult>> => {
    return requestJson(`${BASE}/${payload.platform}/seeding-mark/get-kpi-target`, { method: "POST", body: JSON.stringify(payload) });
  },
};

// ── Internal Engagement (Tương tác nội bộ — MarkeeAI FB Page posts) ─────────────

export const internalEngagementService = {
  addCustomPost: (linkOrPayload: string | {
    link?: string;
    link_post?: string;
    url?: string;
    email: string;
    content?: string;
    fanpage_name?: string;
    media_urls?: string[];
    campaign_id?: string;
    campaign_name?: string;
    deadline?: string;
    target_likes?: number;
    target_comments?: number;
    target_shares?: number;
    assigned_team_ids?: string[];
    platform?: string;
    likes?: number;
    comments?: number;
    shares?: number;
  }, emailParam?: string): Promise<ApiResponse<any>> => {
    const payload = typeof linkOrPayload === "string"
      ? { link: linkOrPayload, email: emailParam || "" }
      : linkOrPayload;

    return requestJson(`${BASE}/internal-engagement/add-custom-post`, {
      method: "POST",
      body: JSON.stringify({
        link_post: payload.link || payload.link_post || payload.url,
        url: payload.link || payload.link_post || payload.url,
        email: payload.email,
        content: payload.content,
        fanpage_name: payload.fanpage_name,
        media_urls: payload.media_urls,
        campaign_id: payload.campaign_id,
        campaign_name: payload.campaign_name,
        deadline: payload.deadline,
        target_likes: payload.target_likes,
        target_comments: payload.target_comments,
        target_shares: payload.target_shares,
        assigned_team_ids: payload.assigned_team_ids,
        platform: payload.platform,
        likes: payload.likes,
        comments: payload.comments,
        shares: payload.shares,
      }),
    });
  },
  debugFetchMeta: (url: string, cookie?: string): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/custom-posts/debug-fetch`, {
      method: "POST",
      body: JSON.stringify({ url, cookie }),
    });
  },
  listPosts: (page: number = 1, pageSize: number = 20, email?: string): Promise<ApiResponse<{ items: InternalEngagementPost[]; total: number; page: number; page_size: number }>> => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (email) params.set("email", email);
    return requestJson(`${BASE}/internal-engagement/posts?${params.toString()}`);
  },

  listCustomPosts: (page: number = 1, pageSize: number = 20): Promise<ApiResponse<{ items: InternalEngagementPost[]; total: number; page: number; page_size: number }>> => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    return requestJson(`${BASE}/internal-engagement/custom-posts?${params.toString()}`);
  },

  updateCustomPost: (id: string, payload: {
    email: string;
    content?: string;
    fanpage_name?: string;
    media_urls?: string[];
    campaign_id?: string;
    campaign_name?: string;
    deadline?: string;
    target_likes?: number;
    target_comments?: number;
    target_shares?: number;
    assigned_team_ids?: string[];
  }): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/custom-posts/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deleteCustomPost: (id: string, email: string): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/custom-posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ email }),
    });
  },

  overrideMarkeePost: (id: string, payload: {
    email: string;
    content?: string;
    fanpage_name?: string;
    media_urls?: string[];
    campaign_id?: string;
    campaign_name?: string;
    deadline?: string;
    target_likes?: number;
    target_comments?: number;
    target_shares?: number;
    assigned_team_ids?: string[];
  }): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/markee-posts/${encodeURIComponent(id)}/override`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  hideMarkeePost: (id: string, email: string): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/markee-posts/${encodeURIComponent(id)}/override`, {
      method: "DELETE",
      body: JSON.stringify({ email }),
    });
  },

  syncPostMetrics: (postId: string, metrics?: { likes?: number; comments?: number; shares?: number }): Promise<ApiResponse<any>> => {
    const params = new URLSearchParams();
    if (metrics?.likes !== undefined) params.set("likes", String(metrics.likes));
    if (metrics?.comments !== undefined) params.set("comments", String(metrics.comments));
    if (metrics?.shares !== undefined) params.set("shares", String(metrics.shares));
    const qs = params.toString();
    return requestJson(`${BASE}/internal-engagement/custom-posts/${encodeURIComponent(postId)}/sync${qs ? `?${qs}` : ""}`, {
      method: "POST",
    });
  },

  // Đồng bộ LinkedIn hoàn toàn server-side (Playwright + account đã đăng ký), không cần Extension.
  // Trả success:false kèm data.error_code === "NO_LINKEDIN_ACCOUNT" nếu người tạo bài chưa có
  // tài khoản LinkedIn nào — FE nên tự fallback sang syncPostMetrics (qua extension) khi đó.
  syncLinkedInPlaywright: (postId: string): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/custom-posts/${encodeURIComponent(postId)}/sync-playwright`, {
      method: "POST",
    });
  },

  getMyMarks: (emailMember: string, linkPosts: string[]): Promise<ApiResponse<{ marks: Record<string, InternalEngagementMarkStatus> }>> => {
    return requestJson(`${BASE}/internal-engagement/my-marks`, {
      method: "POST",
      body: JSON.stringify({ email_member: emailMember, link_posts: linkPosts }),
    });
  },

  getPostTeamCounts: (linkPost: string, email: string, teamId?: string): Promise<ApiResponse<InternalEngagementPostTeamCountsData>> => {
    const params = new URLSearchParams({ link_post: linkPost, email });
    if (teamId) params.set("team_id", teamId);
    return requestJson(`${BASE}/internal-engagement/kpi/post-team-counts?${params.toString()}`);
  },

  getPostInteractions: (linkPost: string, email: string, teamId?: string): Promise<ApiResponse<InternalEngagementPostInteractionsData>> => {
    return requestJson(`${BASE}/internal-engagement/kpi/post-interactions`, {
      method: "POST",
      body: JSON.stringify({ link_post: linkPost, email, team_id: teamId }),
    });
  },

  getTeamTrend: (email: string, days: number = 14, teamId?: string): Promise<ApiResponse<InternalEngagementTeamTrendData>> => {
    return requestJson(`${BASE}/internal-engagement/kpi/team-trend`, {
      method: "POST",
      body: JSON.stringify({ email, days, team_id: teamId }),
    });
  },

  getCampaigns: (): Promise<ApiResponse<Array<{ id: string; name: string; color_code?: string; start_date?: string; end_date?: string }>>> => {
    return requestJson(`${BASE}/internal-engagement/seeding/campaigns`);
  },

  createCampaign: (payload: { name: string; description?: string; color_code?: string; start_date?: string; end_date?: string; created_by_email?: string }): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/seeding/campaigns`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteCampaign: (id: string): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/internal-engagement/seeding/campaigns/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  getLeaderboard: (): Promise<ApiResponse<Array<{ user_id: string; member_name: string; member_email: string; team_name: string; total_assigned: number; total_completed: number; total_ontime: number; completion_rate: number; score: number }>>> => {
    return requestJson(`${BASE}/internal-engagement/seeding/leaderboard`);
  },

  getTeamTotals: (email: string, dateFrom?: string, dateTo?: string, teamId?: string): Promise<ApiResponse<InternalEngagementTeamTotalsData>> => {
    return requestJson(`${BASE}/internal-engagement/kpi/team-totals`, {
      method: "POST",
      body: JSON.stringify({ email, date_from: dateFrom, date_to: dateTo, team_id: teamId }),
    });
  },
};

// ── KPI ───────────────────────────────────────────────────────────────────────

export const allPlatformKpiService = {
  assign: (payload: {
    leader_role: string;
    role: string;
    email: string;
    profile_slug: string;
    email_leader: string;
    id_team?: string;
    kpi: Array<{
      start_day: string;
      end_day: string;
      kpi_comment?: number;
      kpi_post?: number;
      kpi_lead?: number;
      kpi_inbox?: number;
      total_reaction?: number;
      total_comment?: number;
      total_post_crawl?: number;
      total_session_crawl?: number;
      platform?: string;
    }>;
    platform: string;
  }): Promise<ApiResponse<KpiAssignment>> => {
    return requestJson(`${BASE}/kpi/assign`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Leader giao KPI hàng loạt cho nhiều thành viên cùng lúc.
   * Nhanh hơn gọi /assign N lần vì chỉ 1 HTTP request.
   */
  bulkAssignKpi: (payload: {
    leader_email: string;
    id_team: string;
    start_day: string;
    end_day: string;
    members: Array<{
      email: string;
      profile_slug?: string;
      kpi_comment?: number;
      kpi_post?: number;
      kpi_lead?: number;
      kpi_inbox?: number;
    }>;
    platform?: string;
  }): Promise<
    ApiResponse<{
      total: number;
      success_count: number;
      failed_count: number;
      results: Array<{ email: string; success: boolean; message: string }>;
      message: string;
    }>
  > => {
    return requestJson(`${BASE}/kpi/bulk-assign`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getAll: (leader_email: string, id_team?: string, start_date?: string, end_date?: string): Promise<ApiResponse<{ total: number; members: KpiMember[] }>> => {
    return requestJson(`${BASE}/kpi/get-all`, {
      method: "POST",
      body: JSON.stringify({ email_leader: leader_email, id_team, start_date, end_date }),
    });
  },

  /**
   * Phase 3 — gọi endpoint backend tối ưu (RPC hoặc batch fallback).
   * Schema trả về tương thích với `getAll`. FE nên chuyển sang method này.
   */
  getTeamOverviewV3: (leader_email: string, id_team?: string, start_date?: string, end_date?: string): Promise<ApiResponse<{ total: number; members: KpiMember[] }>> => {
    return requestJson(`${BASE}/kpi/get-team-overview-v3`, {
      method: "POST",
      body: JSON.stringify({ email_leader: leader_email, id_team, start_date, end_date }),
    });
  },

  /**
   * Phase 1 — batch queries endpoint.
   */
  getTeamOverviewV2: (leader_email: string, id_team?: string, start_date?: string, end_date?: string): Promise<ApiResponse<{ total: number; members: KpiMember[] }>> => {
    return requestJson(`${BASE}/kpi/get-team-overview-v2`, {
      method: "POST",
      body: JSON.stringify({ email_leader: leader_email, id_team, start_date, end_date }),
    });
  },

  getByEmail: (email: string): Promise<ApiResponse<KpiMember>> => {
    return requestJson(`${BASE}/kpi/get-by-email`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  getZaloInboxProgress: (
    email: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    ApiResponse<{
      kpi_inbox_current: number;
      account_ids: string[];
      range: { start: string; end: string };
    }>
  > => {
    return requestJson(`${BASE}/kpi/zalo-inbox-progress`, {
      method: "POST",
      body: JSON.stringify({ email, start_date: startDate, end_date: endDate }),
    });
  },

  getFbInboxProgress: (
    email: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    ApiResponse<{
      kpi_fb_inbox_count: number;
      range: { start: string; end: string };
    }>
  > => {
    return requestJson(`${BASE}/kpi/fb-inbox-progress`, {
      method: "POST",
      body: JSON.stringify({ email, start_date: startDate, end_date: endDate }),
    });
  },

  /** "Khách reply" — số tin nhắn thực tế khách gửi tới từng member (bulk, 1 request cho cả team). */
  getFbInboxProgressBulk: (emails: string[], startDate?: string, endDate?: string): Promise<ApiResponse<Record<string, { kpi_fb_inbox_count: number; range: { start: string; end: string } }>>> => {
    return requestJson(`${BASE}/kpi/fb-inbox-progress-bulk`, {
      method: "POST",
      body: JSON.stringify({ emails, start_date: startDate, end_date: endDate }),
    });
  },

  getFbPostKpiSummary: (
    email: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    ApiResponse<{
      post_count: number;
      profile_count: number;
      group_count: number;
      page_count: number;
      posts: Array<{
        id: string;
        job_id: string;
        post_url: string | null;
        content: string | null;
        target_type: string;
        target_id: string | null;
        posted_at: string;
      }>;
      range: { start: string; end: string };
    }>
  > => {
    return requestJson(`${BASE}/fb/post-kpi/summary`, {
      method: "POST",
      body: JSON.stringify({ email, start_date: startDate, end_date: endDate }),
    });
  },

  syncAll: (email: string, posts: Array<{ post_url: string; reactions?: number; comments?: number; shares?: number }>): Promise<ApiResponse<{ updated: number }>> => {
    return requestJson(`${BASE}/kpi/sync-all`, {
      method: "POST",
      body: JSON.stringify({ email, posts }),
    });
  },

  getTeamHistory: (
    leaderEmail?: string,
    weeks = 4,
  ): Promise<
    ApiResponse<
      Array<{
        week_name: string;
        teams: Array<{
          team_id: string;
          team_name: string;
          lead_actual: number;
          lead_target: number;
          inbox_actual: number;
          inbox_target: number;
          post_actual: number;
          post_target: number;
          comment_actual: number;
          comment_target: number;
        }>;
      }>
    >
  > => {
    return requestJson(`${BASE}/kpi/team-history`, {
      method: "POST",
      body: JSON.stringify({ leader_email: leaderEmail ?? null, weeks }),
    });
  },

  /**
   * Phase 4 — phiên bản tối ưu của getTeamHistory.
   * Ưu tiên dùng cho admin (nhiều team × nhiều tuần). Có cache 30s phía backend.
   * Schema trả về giống hệt getTeamHistory.
   */
  getTeamHistoryV2: (
    leaderEmail?: string,
    weeks = 4,
  ): Promise<
    ApiResponse<
      Array<{
        week_name: string;
        teams: Array<{
          team_id: string;
          team_name: string;
          lead_actual: number;
          lead_target: number;
          inbox_actual: number;
          inbox_target: number;
          post_actual: number;
          post_target: number;
          comment_actual: number;
          comment_target: number;
        }>;
      }>
    >
  > => {
    return requestJson(`${BASE}/kpi/team-history-v2`, {
      method: "POST",
      body: JSON.stringify({ leader_email: leaderEmail ?? null, weeks }),
    });
  },

  checkPermission: (email: string): Promise<ApiResponse<{ role: string; email_leader?: string; name?: string }>> => {
    return requestJson(`${BASE}/kpi/auth/check-permission`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  verifyLeaderCode: (code: string): Promise<ApiResponse<{ valid: boolean }>> => {
    return requestJson(`${BASE}/kpi/auth/verify-leader-code`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },

  /**
   * Đếm/tính inbox KPI cho 1 hoặc nhiều hội thoại FB.
   * Gọi khi leader/admin bấm nút "Tính Inbox" trên hộp thoại FB.
   * @param is_lead - đánh dấu là lead tiềm năng
   */
  syncFbInbox: (payload: { leader_email: string; member_email: string; conv_ids: string[]; user_id: string; is_lead?: boolean }): Promise<ApiResponse<{ synced: number; lead: number; member_email: string }>> => {
    return requestJson(`${BASE}/kpi/fb-inbox-sync`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Leader tính KPI hàng loạt cho team trong một ngày cụ thể.
   * Chuyển các đề xuất có is_confirmed=False thành True.
   */
  bulkVerifyFbInbox: (payload: { leader_email: string; target_date: string }): Promise<ApiResponse<{ synced: number; message: string }>> => {
    return requestJson(`${BASE}/kpi/fb-inbox-bulk-verify`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Lấy tổng hợp inbox KPI từ bảng fb_inbox_kpi (Supabase).
   * Chỉ lấy inbox ĐÃ XÁC NHẬN (is_confirmed=True).
   */
  getFbInboxSummary: (
    email: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    ApiResponse<{
      inbox_count: number;
      lead_count: number;
      conv_ids: string[];
      range: { start: string; end: string };
    }>
  > => {
    return requestJson(`${BASE}/kpi/fb-inbox-summary`, {
      method: "POST",
      body: JSON.stringify({ email, start_date: startDate, end_date: endDate }),
    });
  },

  /**
   * Lấy danh sách inbox KPI CHƯA XÁC NHẬN từ bảng fb_inbox_kpi (Supabase).
   * Dùng cho filter "Chưa xác minh" - hiển thị inbox member đã đề xuất
   * nhưng leader/admin chưa duyệt (is_confirmed=False).
   */
  getPendingFbInbox: (
    email: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    ApiResponse<{
      pending_count: number;
      pending_conv_ids: string[];
      range: { start: string; end: string };
    }>
  > => {
    return requestJson(`${BASE}/kpi/fb-inbox-pending`, {
      method: "POST",
      body: JSON.stringify({ email, start_date: startDate, end_date: endDate }),
    });
  },

  /**
   * Lấy danh sách conv_ids đã xác nhận KPI inbox trong tuần hiện tại.
   * Dùng cho frontend filter "Chưa tính KPI" trong inbox page.
   * Trả về cả confirmed (đã duyệt) và pending (chờ duyệt).
   */
  getVerifiedConvIds: (
    leaderEmail: string,
    idTeam?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    ApiResponse<{
      confirmed_conv_ids: string[];
      confirmed_at_by_conv?: Record<string, string>;
      inbox_confirmed_at_by_conv?: Record<string, string>;
      pending_conv_ids: string[];
      range: { start: string; end: string };
      member_count: number;
    }>
  > => {
    return requestJson(`${BASE}/kpi/fb-inbox-verified-ids`, {
      method: "POST",
      body: JSON.stringify({
        leader_email: leaderEmail,
        id_team: idTeam,
        start_date: startDate || "",
        end_date: endDate || "",
      }),
    });
  },

  /**
   * Member tự đề xuất KPI inbox cho mình.
   */
  suggestFbInbox: (payload: {
    member_email: string;
    conv_ids: string[];
    user_id: string;
  }): Promise<
    ApiResponse<{
      synced: number;
      member_email: string;
      conv_ids: string[];
      message: string;
    }>
  > => {
    return requestJson(`${BASE}/kpi/fb-inbox-suggest`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

// ── Zalo Inbox Share (Tin nhắn KPI verification) ─────────────────────────────

export type KpiRewardMetric = "lead" | "inbox" | "post" | "comment" | "total_bonus";
export type KpiRewardStatus = "draft" | "pending" | "approved" | "rejected";
export type KpiGoalStatus = "dat" | "gan_dat" | "chua_dat";
export type KpiRuleSource = "current" | "copied" | "default";

export interface KpiRewardRule {
  id?: string;
  teamId: string;
  teamName?: string;
  leaderEmail?: string;
  leaderName?: string;
  startDate: string;
  endDate: string;
  metric: KpiRewardMetric;
  weight: number;
  thresholdValue: number;
  rewardPerUnit: number;
  maxReward: number | null;
  maxRate: number;
  status: KpiRewardStatus;
  leaderNote?: string;
  adminNote?: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  updatedAt?: string | null;
}

export interface KpiRewardMemberSummary {
  teamId: string;
  teamName: string;
  leaderEmail: string;
  memberId: string;
  memberEmail: string;
  memberName: string;
  actuals: Record<"lead" | "inbox" | "post" | "comment", number>;
  targets: Record<"lead" | "inbox" | "post" | "comment", number>;
  metricPercents: Record<"lead" | "inbox" | "post" | "comment", number>;
  metricStatuses: Record<"lead" | "inbox" | "post" | "comment", KpiGoalStatus>;
  kpiPercent: number;
  kpiStatus: KpiGoalStatus;
  rewards: Record<KpiRewardMetric, number>;
  totalReward: number;
  status: KpiRewardStatus;
  isEstimate: boolean;
}

export interface KpiRewardTeamSummary {
  teamId: string;
  teamName: string;
  leaderEmail: string;
  totalReward: number;
  memberCount: number;
  status: KpiRewardStatus;
  isEstimate: boolean;
  kpiPercent: number;
  kpiStatus: KpiGoalStatus;
}

export interface KpiRewardSummary {
  rules: KpiRewardRule[];
  teamSummaries: KpiRewardTeamSummary[];
  memberSummaries: KpiRewardMemberSummary[];
  totals: {
    totalReward: number;
    teamCount: number;
    memberCount: number;
    approvedReward: number;
    estimatedReward: number;
  };
  range: { start: string; end: string };
}

export interface KpiRewardRuleLogChange {
  metric: KpiRewardMetric;
  metricLabel: string;
  field: string;
  fieldLabel: string;
  oldValue: number | null;
  newValue: number | null;
}

export interface KpiRewardRuleLog {
  id: string;
  changedByName: string;
  changedByEmail?: string;
  changes: KpiRewardRuleLogChange[];
  createdAt: string;
}

export interface KpiRewardEffectiveRules {
  rules: KpiRewardRule[];
  source: KpiRuleSource;
  sourceWeek: { start: string; end: string } | null;
}

export const kpiRewardsService = {
  listRules: (
    params: {
      startDate?: string;
      endDate?: string;
      teamId?: string;
      status?: KpiRewardStatus;
    } = {},
  ): Promise<ApiResponse<KpiRewardRule[]>> => {
    const qs = new URLSearchParams();
    if (params.startDate) qs.set("start_date", params.startDate);
    if (params.endDate) qs.set("end_date", params.endDate);
    if (params.teamId) qs.set("team_id", params.teamId);
    if (params.status) qs.set("status", params.status);
    const query = qs.toString();
    return requestJson(`${BASE}/kpi-rewards/rules${query ? `?${query}` : ""}`);
  },

  // Rule "dang co hieu luc" cho tuan: uu tien rule da luu dung tuan, neu chua co
  // thi tu dong sao chep tu tuan gan nhat truoc do (leader khong phai tao lai tu dau).
  effectiveRules: (params: { teamId: string; startDate: string; endDate: string }): Promise<ApiResponse<KpiRewardEffectiveRules>> => {
    const qs = new URLSearchParams({
      team_id: params.teamId,
      start_date: params.startDate,
      end_date: params.endDate,
    });
    return requestJson(`${BASE}/kpi-rewards/rules/effective?${qs.toString()}`);
  },

  saveDraft: (payload: {
    team_id: string;
    start_date: string;
    end_date: string;
    leader_note?: string;
    rules: Array<{
      metric: KpiRewardMetric;
      weight: number;
      threshold_value: number;
      reward_per_unit: number;
      max_reward?: number | null;
      max_rate?: number;
    }>;
  }): Promise<ApiResponse<KpiRewardRule[]>> => {
    return requestJson(`${BASE}/kpi-rewards/rules/save-draft`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  saveActive: (payload: {
    team_id: string;
    start_date: string;
    end_date: string;
    leader_note?: string;
    admin_note?: string;
    rules: Array<{
      metric: KpiRewardMetric;
      weight: number;
      threshold_value: number;
      reward_per_unit: number;
      max_reward?: number | null;
      max_rate?: number;
    }>;
  }): Promise<ApiResponse<KpiRewardRule[]>> => {
    return requestJson(`${BASE}/kpi-rewards/rules/save-active`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  submit: (payload: { team_id: string; start_date: string; end_date: string; leader_note?: string }): Promise<ApiResponse<KpiRewardRule[]>> => {
    return requestJson(`${BASE}/kpi-rewards/rules/submit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  approve: (payload: { team_id: string; start_date: string; end_date: string; admin_note?: string }): Promise<ApiResponse<KpiRewardRule[]>> => {
    return requestJson(`${BASE}/kpi-rewards/rules/approve`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  reject: (payload: { team_id: string; start_date: string; end_date: string; admin_note?: string }): Promise<ApiResponse<KpiRewardRule[]>> => {
    return requestJson(`${BASE}/kpi-rewards/rules/reject`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  summary: (params: { startDate: string; endDate: string; teamId?: string }): Promise<ApiResponse<KpiRewardSummary>> => {
    const qs = new URLSearchParams({
      start_date: params.startDate,
      end_date: params.endDate,
    });
    if (params.teamId) qs.set("team_id", params.teamId);
    return requestJson(`${BASE}/kpi-rewards/summary?${qs.toString()}`);
  },

  logs: (params: { teamId: string; startDate: string; endDate: string }): Promise<ApiResponse<KpiRewardRuleLog[]>> => {
    const qs = new URLSearchParams({
      team_id: params.teamId,
      start_date: params.startDate,
      end_date: params.endDate,
    });
    return requestJson(`${BASE}/kpi-rewards/rules/logs?${qs.toString()}`);
  },
};

export const zaloInboxShareService = {
  /**
   * Member bật/tắt share cho 1 conversation.
   * @param is_active true = bật, false = tắt
   */
  toggle: (payload: { account_id: string; conversation_id: string; member_email: string; is_active: boolean; shared_role?: "leader" | "admin"; note?: string }): Promise<ApiResponse<{ is_active: boolean; row: any }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/toggle`, {
      method: "POST",
      body: JSON.stringify({
        shared_role: "leader",
        ...payload,
      }),
    });
  },

  /** Liệt kê conversations mà member này đã share. */
  listMine: (member_email: string, is_active: boolean | null = true): Promise<ApiResponse<{ items: any[]; total: number }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/list`, {
      method: "POST",
      body: JSON.stringify({ member_email, is_active }),
    });
  },

  /** Liệt kê conversations mà leader có quyền xem (đã join account info). */
  leaderView: (leader_email: string, member_email?: string): Promise<ApiResponse<{ items: any[]; total: number }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/leader-view`, {
      method: "POST",
      body: JSON.stringify({ leader_email, member_email }),
    });
  },

  /** Bulk sync (khi member thay đổi nhiều tick cùng lúc). */
  bulkSync: (member_email: string, shares: Array<{ account_id: string; conversation_id: string; is_active: boolean; note?: string }>): Promise<ApiResponse<{ synced: number; failed: number; errors: string[] }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/bulk-sync`, {
      method: "POST",
      body: JSON.stringify({ member_email, shares }),
    });
  },

  /** Leader xác minh 1 share → tính KPI inbox. */
  verify: (row_id: number, leader_email: string, note?: string): Promise<ApiResponse<{ row: any }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/verify`, {
      method: "POST",
      body: JSON.stringify({ row_id, leader_email, note }),
    });
  },

  /** Leader thu hồi verify (set verified_at = NULL). */
  unverify: (row_id: number): Promise<ApiResponse<{ row: any }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/unverify`, {
      method: "POST",
      body: JSON.stringify({ row_id }),
    });
  },

  /** Leader đánh dấu tiềm năng (is_lead) */
  toggleLead: (row_id: number, leader_email: string, is_lead: boolean): Promise<ApiResponse<{ row: any }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/toggle-lead`, {
      method: "POST",
      body: JSON.stringify({ row_id, leader_email, is_lead }),
    });
  },

  /** Đếm số share đã verify trong khoảng [start_date, end_date]. */
  countVerified: (member_email: string, start_date: string, end_date: string): Promise<ApiResponse<{ count: number; items: any[] }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/count-verified`, {
      method: "POST",
      body: JSON.stringify({ member_email, start_date, end_date }),
    });
  },

  /** Hủy chia sẻ tất cả các cuộc hội thoại chưa được duyệt KPI. */
  revokeAll: (payload: { account_id: string; member_email: string }): Promise<ApiResponse<{ count: number }>> => {
    return requestJson(`${BASE}/zalo/inbox-share/revoke-all`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

// ── UNIFIED POSTS (Tong-hop — no cache, all server-side) ─────────────────────

export const allPlatformPostsService = {
  /** Fetch + filter in one call — server-side, no cache */
  getAll: (payload: {
    email: string;
    platform: string;
    date_from?: string;
    date_to?: string;
    intent?: string;
    industry?: string;
    team?: string;
    tier?: string;
    sort?: string;
    page?: number;
    page_size?: number;
  }): Promise<ApiResponse<{ posts: UnifiedPost[]; total: number; page: number; page_size: number; total_pages: number }>> => {
    return requestJson(`${BASE}/unified/posts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** Full filter — server-side, no client-side merge */
  filter: (payload: {
    email: string;
    platform: string;
    date?: string;
    date_from?: string;
    date_to?: string;
    intent?: string;
    industry?: string;
    team?: string;
    tier?: string;
    icp?: string;
    content_type?: string;
    product_seeding?: string;
    id_member?: string;
    search?: string;
    sort?: string;
    page?: number;
    page_size?: number;
  }): Promise<
    ApiResponse<{
      posts: UnifiedPost[];
      total: number;
      page: number;
      page_size: number;
      total_pages: number;
      /**
       * Phase 6: dashboard stats gộp vào response (thay vì gọi /unified/stats riêng).
       * FE có thể fallback /unified/stats nếu backend cũ chưa trả field này.
       */
      quick_stats?: {
        totalPostsToday: number;
        postsYesterday: number;
        totalPosts: number;
        highScoreCount: number;
        highScorePercent: number;
        seededToday: number;
        totalVisible: number;
        kpiProgress: number;
        kpiTarget: number;
        kpiProgressPercent: number;
      };
    }>
  > => {
    return requestJson(`${BASE}/unified/posts/filter`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Stats from database — no cache.
   * NOTE: từ Phase 6, FE nên ưu tiên đọc `quick_stats` từ /unified/posts/filter
   * (gộp vào 1 round-trip). Method này vẫn dùng cho page load lần đầu hoặc
   * fallback nếu backend cũ.
   */
  getStats: (payload: {
    email: string;
    platform: string;
  }): Promise<
    ApiResponse<{
      totalPostsToday: number;
      postsYesterday: number;
      totalPosts: number;
      highScoreCount: number;
      highScorePercent: number;
      seededToday: number;
      totalVisible: number;
      kpiProgress: number;
      kpiTarget: number;
      kpiProgressPercent: number;
    }>
  > => {
    return requestJson(`${BASE}/unified/stats`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Xu huong tong bai/comment/inbox theo tung ngay (14 ngay gan nhat) - dung
   * cho khoi dashboard xu huong o trang Post Feed.
   */
  getDailyTrend: (payload: { email: string; platform: string }): Promise<ApiResponse<Array<{ date: string; posts: number; comments: number; inbox: number }>>> => {
    return requestJson(`${BASE}/unified/stats/daily-trend`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Phase 6: single RPC call for unified feed dashboard.
   * Returns: quick_stats + my_kpi (member) | team_kpi (leader) +
   *   top_seeding_today + top_seeders_today (admin/leader).
   * Called in parallel with `filter()` — saves N+ round-trips.
   */
  getFeedOverview: (payload: {
    email: string;
    platform?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }): Promise<
    ApiResponse<{
      quick_stats?: {
        totalPostsToday: number;
        postsYesterday: number;
        totalPosts: number;
        highScoreCount: number;
        highScorePercent: number;
        seededToday: number;
        totalVisible: number;
        kpiProgress: number;
        kpiTarget: number;
        kpiProgressPercent: number;
      };
      my_kpi?: null | {
        kpi_comment_target: number;
        kpi_comment_current: number;
        remaining: number;
        percent: number;
      };
      team_kpi?: null | {
        team_id: string;
        team_name: string;
        total_members: number;
        total_seeded_today: number;
        total_verified_today: number;
        active_members_today: number;
      };
      top_seeding_today?: Array<{
        post_id: string;
        post_url: string;
        content: string;
        group_name: string;
        seeding_count: number;
        verified_count: number;
        unique_members: number;
      }>;
      top_seeders_today?: Array<{
        member_id: string;
        member_email: string;
        member_name: string;
        team_name: string;
        seeding_count: number;
        verified_count: number;
      }>;
      range?: { start: string; end: string };
    }>
  > => {
    return requestJson(`${BASE}/unified/feed/overview`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  syncProgress: (email: string, posts: Array<{ post_url: string; reactions?: number; comments?: number; shares?: number }>, platform: string): Promise<ApiResponse<{ updated: number }>> => {
    return requestJson(`${BASE}/${platform}/posts/sync-progress`, {
      method: "POST",
      body: JSON.stringify({ email, posts }),
    });
  },
};

// ── CATEGORIES ────────────────────────────────────────────────────────────────

export const allPlatformCategoriesService = {
  getAll: (category_type?: string, options?: { activeOnly?: boolean }): Promise<ApiResponse<Category[]>> => {
    const params = new URLSearchParams();
    if (category_type) params.set("category_type", category_type);
    if (options?.activeOnly) params.set("active_only", "true");
    const qs = params.toString();
    const url = qs ? `${BASE}/categories?${qs}` : `${BASE}/categories`;
    // Cache the entire categories list for 30s. Categories rarely change;
    // admin can invalidateTaxonomyCache() after edits.
    return cachedFetch(`categories:${category_type || "all"}:${options?.activeOnly ? "active" : "all"}`, 30_000, () => requestJson<Category[]>(url));
  },

  add: (payload: { category_type: string; code: string; name?: string; description?: string; leader?: string; geo?: string; platform?: string; is_active?: boolean; sort_order?: number }): Promise<ApiResponse<Category>> => {
    return requestJson(`${BASE}/categories/add`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  update: (payload: { id: string; category_type?: string; code?: string; name?: string; description?: string; leader?: string; geo?: string; platform?: string; is_active?: boolean; sort_order?: number }): Promise<ApiResponse<Category>> => {
    return requestJson(`${BASE}/categories/update`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  delete: (id: string): Promise<ApiResponse<{ deleted: number }>> => {
    return requestJson(`${BASE}/categories/delete?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

// ── MEMBERS (HR roster, nguồn dữ liệu DUY NHẤT cho mọi dropdown nhân sự) ──────

export const allPlatformMembersService = {
  getAll: (filters?: { search?: string; team?: string; position?: string; department?: string; skill_id?: string }): Promise<ApiResponse<MemberProfile[]>> => {
    const params = new URLSearchParams();
    if (filters?.search) params.set("search", filters.search);
    if (filters?.team) params.set("team", filters.team);
    if (filters?.position) params.set("position", filters.position);
    if (filters?.department) params.set("department", filters.department);
    if (filters?.skill_id) params.set("skill_id", filters.skill_id);
    const qs = params.toString();
    return requestJson<MemberProfile[]>(`${BASE}/members${qs ? `?${qs}` : ""}`);
  },

  add: (payload: Partial<MemberProfile> & { display_name: string; full_name: string }): Promise<ApiResponse<MemberProfile>> => {
    return requestJson(`${BASE}/members/add`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  update: (payload: Partial<MemberProfile> & { id: string }): Promise<ApiResponse<MemberProfile>> => {
    return requestJson(`${BASE}/members/update`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  delete: (id: string): Promise<ApiResponse<{ deleted: number }>> => {
    return requestJson(`${BASE}/members/delete?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  importExcel: async (file: File): Promise<{ created: number; updated: number; skipped: Array<{ row: number; reason: string }> }> => {
    const fd = new FormData();
    fd.append("file", file);

    const headers: Record<string, string> = {};
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    // KHÔNG set Content-Type thủ công cho FormData — browser tự thêm boundary.
    const res = await fetch(`${BASE}/members/import-excel`, {
      method: "POST",
      credentials: "include",
      headers,
      body: fd,
    });
    const data = await res.json();
    if (!data?.success) {
      throw new Error(data?.message || "Import thất bại");
    }
    return data.data;
  },

  getSkills: (): Promise<ApiResponse<Skill[]>> => {
    return requestJson<Skill[]>(`${BASE}/members/skills`);
  },

  addSkill: (name: string, category?: string): Promise<ApiResponse<Skill>> => {
    return requestJson(`${BASE}/members/skills/add`, {
      method: "POST",
      body: JSON.stringify({ name, category }),
    });
  },

  updateSkill: (id: string, name?: string, category?: string): Promise<ApiResponse<Skill>> => {
    return requestJson(`${BASE}/members/skills/update`, {
      method: "PUT",
      body: JSON.stringify({ id, name, category }),
    });
  },

  deleteSkill: (id: string): Promise<ApiResponse<{ deleted: number }>> => {
    return requestJson(`${BASE}/members/skills/delete?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

// ── QUICK COMMENT LIBRARY ─────────────────────────────────────────────────────

export const allPlatformQuickCommentService = {
  getAll: (platform?: string): Promise<ApiResponse<QuickCommentTemplate[]>> => {
    const url = platform ? `${BASE}/quick-comments?platform=${encodeURIComponent(platform)}` : `${BASE}/quick-comments`;
    return requestJson<QuickCommentTemplate[]>(url);
  },

  add: (payload: { title: string; label?: string; content: string; platform?: string; id_member?: string }): Promise<ApiResponse<QuickCommentTemplate>> => {
    return requestJson(`${BASE}/quick-comments/add`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  update: (payload: { id: string; title?: string; label?: string; content?: string; platform?: string }): Promise<ApiResponse<QuickCommentTemplate>> => {
    return requestJson(`${BASE}/quick-comments/update`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  delete: (id: string): Promise<ApiResponse<{ deleted: number }>> => {
    return requestJson(`${BASE}/quick-comments/delete?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  reorder: (id: string, direction: "up" | "down"): Promise<ApiResponse<QuickCommentTemplate[]>> => {
    return requestJson(`${BASE}/quick-comments/reorder`, {
      method: "PUT",
      body: JSON.stringify({ id, direction }),
    });
  },
};

// ── QUICK INBOX LIBRARY ───────────────────────────────────────────────────────

export const allPlatformQuickInboxService = {
  getAll: (): Promise<ApiResponse<QuickInboxTemplate[]>> => {
    return requestJson<QuickInboxTemplate[]>(`${BASE}/quick-inbox`);
  },

  add: (payload: { title: string; label?: string; content: string; content_with_post?: string; id_member?: string }): Promise<ApiResponse<QuickInboxTemplate>> => {
    return requestJson(`${BASE}/quick-inbox/add`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  update: (payload: { id: string; title?: string; label?: string; content?: string; content_with_post?: string }): Promise<ApiResponse<QuickInboxTemplate>> => {
    return requestJson(`${BASE}/quick-inbox/update`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  delete: (id: string): Promise<ApiResponse<{ deleted: number }>> => {
    return requestJson(`${BASE}/quick-inbox/delete?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  reorder: (id: string, direction: "up" | "down"): Promise<ApiResponse<QuickInboxTemplate[]>> => {
    return requestJson(`${BASE}/quick-inbox/reorder`, {
      method: "PUT",
      body: JSON.stringify({ id, direction }),
    });
  },
};

// ── GROUPS (Facebook + LinkedIn) ─────────────────────────────────────────────

export const allPlatformGroupsService = {
  getAll: (platform: string, params?: { intent?: string; team?: string; tier?: number; status?: string; id_member?: string }): Promise<ApiResponse<(FacebookGroup | LinkedInGroup)[]>> => {
    const searchParams = new URLSearchParams();
    if (params?.intent) searchParams.set("intent", params.intent);
    if (params?.team) searchParams.set("team", params.team);
    if (params?.tier) searchParams.set("tier", String(params.tier));
    if (params?.status) searchParams.set("status", params.status);
    if (params?.id_member) searchParams.set("id_member", params.id_member);
    const qs = searchParams.toString();
    const url = `${BASE}/${platform}/groups${qs ? `?${qs}` : ""}`;
    return requestJson(url);
  },

  /**
   * Lấy groups cho Extension Launcher.
   * Backend tự động filter theo id_member từ auth token.
   */
  getForExtension: (): Promise<ApiResponse<FacebookGroup[]>> => {
    return requestJson(`${BASE}/facebook/groups?for_extension=true`);
  },

  add: (payload: Record<string, unknown>, platform: string): Promise<ApiResponse<FacebookGroup | LinkedInGroup>> => {
    return requestJson(`${BASE}/${platform}/groups/add`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  update: (payload: Record<string, unknown>, platform: string): Promise<ApiResponse<FacebookGroup | LinkedInGroup>> => {
    return requestJson(`${BASE}/${platform}/groups/update`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  delete: (id: string, platform: string): Promise<ApiResponse<{ deleted: number }>> => {
    return requestJson(`${BASE}/${platform}/groups/delete?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

// ── USERS & TEAMS ─────────────────────────────────────────────────────────────

export const allPlatformUsersService = {
  getMe: (email: string): Promise<ApiResponse<TeamMember>> => {
    return requestJson(`${BASE}/users/me?email=${encodeURIComponent(email)}`);
  },

  updateSlug: (email: string, slug: string): Promise<ApiResponse<TeamMember>> => {
    return requestJson(`${BASE}/users/update-slug`, {
      method: "POST",
      body: JSON.stringify({ email, slug }),
    });
  },

  updateRole: (email: string, role: string): Promise<ApiResponse<TeamMember>> => {
    return requestJson(`${BASE}/users/update-role`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
  },

  getAllProfiles: (): Promise<ApiResponse<TeamMember[]>> => {
    return requestJson(`${BASE}/users/all-profiles`);
  },
};

export const allPlatformTeamsService = {
  getMembers: (leader_email: string): Promise<ApiResponse<TeamMember[]>> => {
    return requestJson(`${BASE}/teams/members?leader_email=${encodeURIComponent(leader_email)}`);
  },

  addMember: (leader_email: string, member_email: string): Promise<ApiResponse<{ leader_email: string; member_email: string }>> => {
    return requestJson(`${BASE}/teams/add-member`, {
      method: "POST",
      body: JSON.stringify({ leader_email, member_email }),
    });
  },
};

// ── AUTH ────────────────────────────────────────────────────────────────────────

export const authService = {
  register: (payload: { email: string; password: string; name?: string }): Promise<ApiResponse<AuthLoginResponse>> => {
    return requestJsonWithTimeout(
      `${BASE}/auth/register`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      AUTH_SUBMIT_TIMEOUT_MS,
      "Đăng ký quá lâu, vui lòng thử lại.",
    );
  },

  login: (payload: { email: string; password: string }): Promise<ApiResponse<AuthLoginResponse>> => {
    return requestJsonWithTimeout(
      `${BASE}/auth/login`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      AUTH_SUBMIT_TIMEOUT_MS,
      "Đăng nhập quá lâu, vui lòng thử lại.",
    );
  },

  loginWithGoogle: (credential: string): Promise<ApiResponse<AuthLoginResponse>> => {
    return requestJsonWithTimeout(
      `${BASE}/auth/google`,
      {
        method: "POST",
        body: JSON.stringify({ credential }),
      },
      AUTH_SUBMIT_TIMEOUT_MS,
      "Đăng nhập quá lâu, vui lòng thử lại.",
    );
  },

  logout: (): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/auth/logout`, {
      method: "POST",
    });
  },

  me: (): Promise<ApiResponse<AppUser>> => {
    return requestJson(`${BASE}/auth/me`);
  },

  updateProfile: (payload: { name?: string }): Promise<ApiResponse<AppUser>> => {
    return requestJson(`${BASE}/auth/me/profile`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  promoteToLeader: (leader_code: string): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/auth/promote-to-leader`, {
      method: "POST",
      body: JSON.stringify({ leader_code }),
    });
  },

  verifyLeaderCode: (code: string): Promise<ApiResponse<{ valid: boolean }>> => {
    return requestJson(`${BASE}/auth/verify-leader-code?code=${encodeURIComponent(code)}`);
  },

  getSessions: (): Promise<ApiResponse<any[]>> => {
    return requestJson(`${BASE}/auth/sessions`);
  },

  deleteSession: (sessionId: string): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/auth/sessions/${sessionId}`, {
      method: "DELETE",
    });
  },

  deleteAllSessions: (): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/auth/sessions`, {
      method: "DELETE",
    });
  },

  changePassword: (payload: { current_password: string; new_password: string }): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/auth/me/password`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deactivateAccount: (payload: { password: string }): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/auth/me/deactivate`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

// ── SOCIAL ACCOUNTS ──────────────────────────────────────────────────────────────

export const socialAccountsService = {
  getAll: (platform?: string): Promise<ApiResponse<SocialAccount[]>> => {
    const url = platform ? `${BASE}/social-accounts?platform=${encodeURIComponent(platform)}` : `${BASE}/social-accounts`;
    return requestJson(url, { headers: authHeaders() });
  },

  getSummary: (): Promise<ApiResponse<SocialAccountSummary>> => {
    return requestJson(`${BASE}/social-accounts/summary`, {
      headers: authHeaders(),
    });
  },

  getPrimary: (platform: string): Promise<ApiResponse<SocialAccount | null>> => {
    return requestJson(`${BASE}/social-accounts/primary/${platform}`, {
      headers: authHeaders(),
    });
  },

  create: (payload: { platform: string; account_name: string; account_email?: string; account_password?: string; two_fa_secret?: string; session_cookie?: string; is_primary?: boolean; notes?: string }): Promise<ApiResponse<SocialAccount>> => {
    return requestJson(`${BASE}/social-accounts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
  },

  update: (payload: {
    id: string;
    account_name?: string;
    account_email?: string | null;
    account_password?: string | null;
    two_fa_secret?: string | null;
    two_fa_enabled?: boolean;
    session_cookie?: string | null;
    is_active?: boolean;
    is_primary?: boolean;
    notes?: string | null;
    account_profile_id?: string | null;
    id_platform?: number | null;
  }): Promise<ApiResponse<SocialAccount>> => {
    return requestJson(`${BASE}/social-accounts`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
  },

  delete: (accountId: string): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/social-accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  setPrimary: (accountId: string): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/social-accounts/${encodeURIComponent(accountId)}/set-primary`, {
      method: "POST",
      headers: authHeaders(),
    });
  },
};

// ── LinkedIn Account Management ───────────────────────────────────────────────

export interface LinkedInAccount {
  id: string;
  email_member: string;
  email_linkedin: string;
  created_at: string;
}

export interface LinkedInCrawlRequest {
  email_linkedin: string;
  group_urls: string[];
  target_date?: string;
  max_items?: number;
  fallback_recent_count?: number;
}

export interface LinkedInCrawlResult {
  total_groups_ok: number;
  total_groups_failed: number;
  total_sessions_saved: number;
  total_posts_saved: number;
  errors: Array<{ group_url: string; error: string }>;
  groups_results: Array<{
    group_url: string;
    success: boolean;
    posts_count: number;
    error?: string;
  }>;
}

export const linkedInAccountService = {
  getAll: (): Promise<ApiResponse<LinkedInAccount[]>> => {
    return requestJson(`${BASE}/linkedin/accounts`, { method: "GET" });
  },

  create: (payload: { email_member: string; email_linkedin: string; password: string }): Promise<ApiResponse<LinkedInAccount>> => {
    return requestJson(`${BASE}/linkedin/accounts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  update: (accountId: string, payload: { email_member?: string; email_linkedin?: string; password?: string }): Promise<ApiResponse<LinkedInAccount>> => {
    return requestJson(`${BASE}/linkedin/accounts/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  delete: (accountId: string): Promise<ApiResponse<{ deleted: number }>> => {
    return requestJson(`${BASE}/linkedin/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    });
  },
};

export const linkedInCrawlService = {
  crawl: (payload: LinkedInCrawlRequest): Promise<ApiResponse<LinkedInCrawlResult>> => {
    return requestJson(`${BASE}/linkedin/crawl-linkedin-post`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  deleteSession: (sessionId: string): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/linkedin/crawl-sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  },
};

export interface LinkedInLoginResult {
  status: "success" | "need_otp";
  session_id: string;
  checkpoint_url?: string;
  email: string;
}

export interface LinkedInVerifyOtpResult {
  session_id: string;
  state_path: string;
  email: string;
  success: boolean;
}

export const linkedInAuthService = {
  login: (payload: { email: string; password: string; session_id?: string }): Promise<ApiResponse<LinkedInLoginResult>> => {
    return requestJson(`${BASE}/linkedin/login`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  verifyOtp: (payload: { pending_session_id: string; otp_code: string; checkpoint_url?: string }): Promise<ApiResponse<LinkedInVerifyOtpResult>> => {
    return requestJson(`${BASE}/linkedin/verify-otp`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

// ── Users & Teams Services ────────────────────────────────────────────────────

export interface AppUserProfile {
  id: string;
  email: string;
  name?: string;
  role?: string;
  is_active?: boolean;
  created_at?: string;
  can_approve_quotes?: boolean;
  /** Vai trò NGHIỆP VỤ báo giá (migration 095) — presale/sale/both/null, TÁCH
   * BIỆT hoàn toàn với `role` (system role admin/leader/member). */
  quote_business_role?: "presale" | "sale" | "both" | null;
}

export interface QuoteBusinessRoleUser {
  id: string;
  name: string;
  role?: string;
  quote_business_role?: "presale" | "sale" | "both" | null;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
}

export interface TeamRow {
  id: string;
  name_team: string;
  /** Loại team (migration 049) — dev/marketing/sale/presales/technical/back_office/intern/freelancer/khac. */
  team_type?: string;
  id_leader: string;
  /** members.id của người được chọn làm Leader — nguồn thật, luôn có dù
   * chưa liên kết tài khoản đăng nhập (id_leader khi đó là ""). */
  leader_member_id?: string;
  leader_email: string;
  leader_name: string;
  /** true nếu Leader đã liên kết tài khoản đăng nhập (id_leader có giá trị thật). */
  leader_linked?: boolean;
  members: TeamMember[];
  number_of_member: number;
}

export const usersService = {
  getAllProfiles: (): Promise<ApiResponse<AppUserProfile[]>> => {
    return requestJson(`${BASE}/users/all-profiles`);
  },
  getByRole: (role: string): Promise<ApiResponse<AppUserProfile[]>> => {
    return requestJson(`${BASE}/users/by-role?role=${encodeURIComponent(role)}`);
  },
  updateRole: (email: string, role: string): Promise<ApiResponse<any>> => {
    return requestJson(`${BASE}/users/update-role`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
  },
  /** Admin-only: tạo tài khoản đăng nhập mới (chưa có mật khẩu dùng được — chỉ
   * đăng nhập qua Google). Dùng khi thêm 1 email chưa từng có trong hệ thống. */
  createAccount: (payload: { email: string; name?: string; role: string }): Promise<ApiResponse<AppUserProfile>> => {
    return requestJson(`${BASE}/users/create`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  /** Admin-only: kích hoạt/vô hiệu hóa tài khoản — khoá đăng nhập ngay lập tức. */
  setActive: (email: string, is_active: boolean): Promise<ApiResponse<AppUserProfile>> => {
    return requestJson(`${BASE}/users/set-active`, {
      method: "POST",
      body: JSON.stringify({ email, is_active }),
    });
  },
  /** Admin-only: bật/tắt quyền duyệt Báo giá (migration 053). */
  updateQuoteApprover: (email: string, can_approve_quotes: boolean): Promise<ApiResponse<AppUserProfile>> => {
    return requestJson(`${BASE}/users/update-quote-approver`, {
      method: "POST",
      body: JSON.stringify({ email, can_approve_quotes }),
    });
  },
  /** Admin-ONLY (backend trả 403 thật cho Leader/Member — migration 095):
   * gán vai trò NGHIỆP VỤ báo giá (Presale/Sale/Both/không tham gia). */
  updateQuoteBusinessRole: (
    email: string,
    quote_business_role: "presale" | "sale" | "both" | null
  ): Promise<ApiResponse<AppUserProfile>> => {
    return requestJson(`${BASE}/users/update-quote-business-role`, {
      method: "POST",
      body: JSON.stringify({ email, quote_business_role }),
    });
  },
  /** Danh sách người đủ điều kiện làm Presale/Sale phụ trách 1 báo giá — ai
   * đăng nhập cũng gọi được (owner-picker), không phải endpoint quản trị. */
  getUsersByQuoteBusinessRole: (role: "presale" | "sale"): Promise<ApiResponse<QuoteBusinessRoleUser[]>> => {
    return requestJson(`${BASE}/users/by-quote-business-role?role=${encodeURIComponent(role)}`);
  },
};

export interface MemberOption {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  systemRole: string;
  quoteBusinessRole: "presale" | "sale" | "both" | null;
  teamNames: string[];
  isActive: boolean;
}

export const memberOptionsService = {
  /** Picker "Người phụ trách dự án" (và picker tương tự) - allowlist DTO
   * DUY NHẤT nguồn từ Quản lý thành viên thật (app_users), KHÔNG bao giờ
   * trả email/password/token. `includeIds` ép trả thêm 1 vài id cụ thể dù
   * đang bị vô hiệu hoá - dùng khi Sửa 1 project mà người phụ trách hiện tại
   * đã ngừng hoạt động (vẫn phải hiện tên + badge, không được biến mất). */
  /** `teamType` (vd 'sale'): loc CHI giu nguoi thuoc dung team_type nay (backend
   * whitelist gia tri hop le - xem routers/users.py _ALLOWED_TEAM_TYPE_FILTERS,
   * gui gia tri khac se bi tu choi ro rang). */
  getOptions: (opts?: { active?: boolean; includeIds?: string[]; teamType?: string }): Promise<ApiResponse<{ items: MemberOption[] }>> => {
    const params = new URLSearchParams();
    if (opts?.active === false) params.set("active", "false");
    if (opts?.includeIds?.length) params.set("include_id", opts.includeIds.join(","));
    if (opts?.teamType) params.set("team_type", opts.teamType);
    const qs = params.toString();
    return requestJson(`${BASE}/users/member-options${qs ? `?${qs}` : ""}`);
  },
};

// ── Projects (migration 097) ─────────────────────────────────────────────────

export interface Project {
  id: string;
  projectCode: string;
  name: string;
  customerId: string;
  description?: string | null;
  status: "planning" | "active" | "completed" | "cancelled";
  managerId?: string | null;
  teamId?: string | null;
  createdById?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProjectInput {
  // "Mã dự án tự sinh hoàn toàn ở backend" - KHÔNG còn field project_code ở
  // đây nữa, frontend không tự dựng mã (xem preview_project_code() +
  // create_project() ở backend).
  name: string;
  customer_id: string;
  description?: string;
  status?: Project["status"];
  manager_id?: string | null;
  team_id?: string | null;
}

export interface ProjectCodePreview {
  projectCode: string;
  isCustomerCodeNew: boolean;
}

export const projectsService = {
  /** Ai dang nhap cung goi duoc (dropdown chon Du an) - DTO da la allowlist
   * that (khong lo field nhay cam). */
  list: (customerId?: string): Promise<ApiResponse<Project[]>> => {
    const qs = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : "";
    return requestJson(`${BASE}/projects${qs}`);
  },
  get: (id: string): Promise<ApiResponse<Project>> => {
    return requestJson(`${BASE}/projects/${encodeURIComponent(id)}`);
  },
  /** CHỈ tính "Dự kiến" để hiển thị trên form - KHÔNG insert/persist gì (xem
   * preview_project_code() ở backend). Mã chính thức luôn do create() cấp lại
   * lúc tạo thật. */
  previewCode: (customerId: string): Promise<ApiResponse<ProjectCodePreview>> => {
    return requestJson(`${BASE}/projects/preview-code?customer_id=${encodeURIComponent(customerId)}`);
  },
  /** Chi Admin/Leader tao duoc (backend tu choi that neu goi sai quyen -
   * can_manage_project(), xem crm_permission_service.py). */
  create: (payload: CreateProjectInput): Promise<ApiResponse<Project>> => {
    return requestJson(`${BASE}/projects`, { method: "POST", body: JSON.stringify(payload) });
  },
  update: (id: string, payload: Partial<CreateProjectInput>): Promise<ApiResponse<Project>> => {
    return requestJson(`${BASE}/projects/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
  },
};

export interface ProjectSummaryCard extends Project {
  opportunityCount: number;
  quoteCaseCount: number;
  versionCount: number;
  processingCount: number;
  sentCount: number;
  currentQuoteValue: number;
}

export interface CustomerProjectsSummary {
  projectCount: number;
  activeProjectCount: number;
  opportunityCount: number;
  quoteCaseCount: number;
  currentQuoteValue: number;
  projects: ProjectSummaryCard[];
}

export const customerProjectsSummaryService = {
  /** Tab "Dự án" trong Hồ sơ khách hàng - 1 goi API tong hop (backend gom
   * san, KHONG N+1 tu client). */
  get: (customerId: string): Promise<ApiResponse<CustomerProjectsSummary>> => {
    return requestJson(`${BASE}/crm/customers/${encodeURIComponent(customerId)}/projects-summary`);
  },
};

export const teamsService = {
  getAll: (): Promise<ApiResponse<TeamRow[]>> => {
    // Teams change infrequently — cache 30s to avoid refetch on every
    // platform toggle or filter change in the dashboard.
    return cachedFetch("teams:all", 30_000, () => requestJson<TeamRow[]>(`${BASE}/teams`));
  },

  /**
   * Phase 5: trả về teams + KPI combined trong 1 round-trip.
   * Thay thế 1 + N HTTP request (1 × /teams + N × /kpi/get-team-overview-v3).
   * Cache 30s phía backend.
   */
  getWithKpi: (
    startDate?: string,
    endDate?: string,
  ): Promise<
    ApiResponse<{
      teams: TeamRow[];
      kpi_data: Array<{
        team_id: string;
        team_name: string;
        leader_email: string;
        member_id: string;
        member_email: string;
        member_name: string;
        kpi_post: number;
        kpi_lead: number;
        kpi_inbox: number;
        kpi_comment: number;
        verified_count: number;
        post_count: number;
        inbox_count: number;
        lead_count: number;
        kpi_post_current: number;
        kpi_inbox_current: number;
        kpi_lead_current: number;
        kpi_inbox_range?: { start: string; end: string };
      }>;
      range: { start: string; end: string };
    }>
  > => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    const qs = params.toString();
    return requestJson(`${BASE}/teams/with-kpi${qs ? `?${qs}` : ""}`);
  },
  create: (payload: {
    name_team: string;
    // ID của member (danh bạ 140 người) được chọn làm Leader — nguồn thật,
    // không phụ thuộc việc người đó đã có tài khoản đăng nhập. Bắt buộc phải
    // có 1 trong 2 (leader_member_id hoặc leader_id) — backend validate.
    leader_member_id?: string;
    // app_users.id hoặc email — chỉ cần khi Leader ĐÃ liên kết tài khoản đăng
    // nhập, hoặc khi gọi từ luồng cũ chưa biết leader_member_id (vd leader tự
    // tạo team cho chính mình — luôn có tài khoản thật).
    leader_id?: string;
    member_ids: string[];
    team_type?: string;
  }): Promise<ApiResponse<TeamRow[]>> => {
    return requestJson(`${BASE}/teams`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update: (payload: {
    name_team: string;
    leader_member_id?: string;
    leader_id?: string;
    member_ids: string[];
    // Truyen kem khi sua team da biet id, de backend tim theo id thay vi theo name_team -
    // cho phep doi ten team an toan (khong bi hieu nham la tao team moi).
    team_id?: string;
    team_type?: string;
  }): Promise<ApiResponse<TeamRow[]>> => {
    return requestJson(`${BASE}/teams`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  /** team_id là cách xoá đáng tin cậy duy nhất khi Leader chưa liên kết tài
   * khoản đăng nhập (không có id_leader thật để tra) — luôn truyền kèm khi có. */
  delete: (name_team: string, leader_id: string, team_id?: string): Promise<ApiResponse<{ deleted: number }>> => {
    const params = new URLSearchParams({ name_team, leader: leader_id || "" });
    if (team_id) params.set("team_id", team_id);
    return requestJson(`${BASE}/teams?${params.toString()}`, { method: "DELETE" });
  },
};

// ── PLATFORMS ────────────────────────────────────────────────────────────────

export interface SocialPlatform {
  id: number;
  name: string;
  slug: string;
  description?: string;
  display_order?: number;
  is_active?: boolean;
  icon_url?: string;
}

export const platformsService = {
  getAll: (): Promise<ApiResponse<SocialPlatform[]>> => {
    return requestJson(`${BASE}/platforms`);
  },
};

// ── FACEBOOK CRAWL ─────────────────────────────────────────────────────────────

export interface CrawlFacebookGroupItem {
  name: string;
  url: string;
  intent?: string;
}

export interface CrawlFacebookTkFB {
  useName?: string;
  password?: string;
}

export interface CrawlFacebookGroupResult {
  group_url: string;
  success: boolean;
  posts_count: number;
  error?: string;
}

export interface CrawlFacebookResponse {
  success: boolean;
  message: string;
  data?: {
    total_groups_ok: number;
    total_groups_failed: number;
    total_sessions_saved: number;
    total_posts_saved: number;
    groups_results: CrawlFacebookGroupResult[];
    errors: string[];
  };
}

export const crawlFacebookService = {
  crawl: (payload: { groups: CrawlFacebookGroupItem[]; tkFB?: CrawlFacebookTkFB }): Promise<ApiResponse<CrawlFacebookResponse>> => {
    return requestJson(`${BASE}/facebook/crawl`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export interface AdminDashboardSummaryData {
  total_crawled_posts: number;
  total_seeding_comments: number;
  approval_rate: number;
  kpi_rate: number;
}

export interface AdminKpiPerformanceData {
  team_name: string;
  target: number;
  actual: number;
}

export interface AdminLeaderboardsData {
  top_seeders: Array<{
    name: string;
    email: string;
    count: number;
  }>;
  top_groups: Array<{
    name: string;
    url: string;
    interactions: number;
  }>;
}

export interface HighInteractionPost {
  post_id: string;
  post_url: string;
  content: string;
  group_name: string;
  score: number;
  interactions: number;
  time_ago: string;
  platform: "facebook" | "linkedin";
}

export interface GroupsHealthStats {
  total_groups: number;
  alive: number;
  low_activity: number;
  dead: number;
  no_taxonomy: number;
  by_tier: Array<{ tier_name: string; count: number }>;
}

export interface AdminTeamDailyTrendPoint {
  date: string;
  posts: number;
  comments: number;
  inbox: number;
  leads: number;
  total_kpi: number;
}

export interface AdminTeamDailyTrendSeries {
  team_id: string;
  team_name: string;
  series: AdminTeamDailyTrendPoint[];
}

export interface AdminTeamDailyTrendData {
  days: number;
  range: { start: string; end: string };
  filters?: {
    team_ids?: string[];
    metric?: string;
  };
  teams: AdminTeamDailyTrendSeries[];
}

export interface HighInteractionPostsData {
  posts: HighInteractionPost[];
  total: number;
}

export const adminDashboardService = {
  getSummary: (): Promise<ApiResponse<AdminDashboardSummaryData>> => {
    return requestJson(`${BASE}/admin/dashboard/summary`);
  },
  getKpiPerformance: (): Promise<ApiResponse<AdminKpiPerformanceData[]>> => {
    return requestJson(`${BASE}/admin/dashboard/kpi-performance`);
  },
  getLeaderboards: (): Promise<ApiResponse<AdminLeaderboardsData>> => {
    return requestJson(`${BASE}/admin/dashboard/leaderboards`);
  },

  /**
   * Phase 4: 1 RPC duy nhất trả về tất cả dữ liệu admin dashboard
   * (summary + kpi_performance + leaderboards + weekly_history).
   * Thay thế 3 endpoint song song ở trên. Nhanh hơn 5-10x.
   */
  getOverview: (
    weeks = 4,
  ): Promise<
    ApiResponse<{
      summary: AdminDashboardSummaryData;
      kpi_performance: AdminKpiPerformanceData[];
      leaderboards: AdminLeaderboardsData;
      weekly_history: Array<{
        week_name: string;
        teams: Array<{
          team_id: string;
          team_name: string;
          lead_actual: number;
          lead_target: number;
          inbox_actual: number;
          inbox_target: number;
          post_actual: number;
          post_target: number;
          comment_actual: number;
          comment_target: number;
        }>;
      }>;
      range: { start: string; end: string };
    }>
  > => {
    return requestJson(`${BASE}/admin/dashboard/overview?weeks=${weeks}`);
  },

  /**
   * Phase 7: Lấy các bài post có tương tác cao (score>=60) nhưng chưa seeding.
   * Dùng cho widget "Bài post có lượt tương tác cao chưa seeding".
   * Cache 60s ở backend — FE nên debounce request.
   */
  getHighInteractionUnseeded: (limit = 10): Promise<ApiResponse<HighInteractionPost[]>> => {
    return requestJson(`${BASE}/admin/dashboard/high-interaction-unseeded?limit=${limit}`);
  },

  /**
   * Phase 7b: Lấy thống kê sức khoẻ groups (alive/dead/low_activity/no_taxonomy).
   * Dùng cho Groups Health widget trong admin dashboard.
   */
  getGroupsHealth: (): Promise<ApiResponse<GroupsHealthStats>> => {
    return requestJson(`${BASE}/admin/dashboard/groups-health`);
  },

  getTeamDailyTrend: (
    params?:
      | number
      | {
          days?: number;
          startDate?: string;
          endDate?: string;
          metric?: string;
          teamIds?: string[];
        },
  ): Promise<ApiResponse<AdminTeamDailyTrendData>> => {
    const normalized = typeof params === "number" ? { days: params } : (params ?? {});
    const searchParams = new URLSearchParams();
    if (normalized.days) {
      searchParams.set("days", String(normalized.days));
    }
    if (normalized.startDate) {
      searchParams.set("start_date", normalized.startDate);
    }
    if (normalized.endDate) {
      searchParams.set("end_date", normalized.endDate);
    }
    if (normalized.metric) {
      searchParams.set("metric", normalized.metric);
    }
    for (const teamId of normalized.teamIds ?? []) {
      searchParams.append("team_ids", teamId);
    }
    const query = searchParams.toString();
    return requestJson(`${BASE}/admin/dashboard/team-daily-trend${query ? `?${query}` : ""}`);
  },
};

// ── FB INBOX ACCOUNTS ─────────────────────────────────────────────────────────

export interface FbInboxAccount {
  id: string;
  id_member: string;
  user_id: string; // Seeder service user_id (VD: "fb_10001")
  fb_user_id?: string; // Facebook UID thật
  account_label?: string; // Tên hiển thị
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export const fbInboxAccountService = {
  /**
   * Link FB inbox account với tài khoản của member.
   * Member gọi API này để thêm FB account vào app.
   * Backend sẽ decode JWT để lấy id_member và lưu vào bảng fb_inbox_accounts.
   */
  create: (payload: { user_id: string; fb_user_id?: string; account_label?: string }): Promise<ApiResponse<FbInboxAccount>> => {
    return requestJson(`${BASE}/inbox-accounts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Lấy danh sách FB inbox accounts của member hiện tại.
   */
  list: (): Promise<ApiResponse<{ accounts: FbInboxAccount[]; total: number }>> => {
    return requestJson(`${BASE}/inbox-accounts`);
  },

  /**
   * Lấy thông tin 1 FB inbox account theo seeder user_id.
   */
  getByUserId: (userId: string): Promise<ApiResponse<FbInboxAccount | null>> => {
    return requestJson(`${BASE}/inbox-accounts/${encodeURIComponent(userId)}`);
  },

  /**
   * Resolve seeder user_id -> id_member.
   * Dùng để kiểm tra xem 1 seeder user_id thuộc về member nào.
   */
  resolve: (
    userId: string,
  ): Promise<
    ApiResponse<{
      user_id: string;
      id_member: string | null;
      found: boolean;
      message: string;
    }>
  > => {
    return requestJson(`${BASE}/inbox-accounts/resolve/${encodeURIComponent(userId)}`);
  },

  /**
   * Cập nhật FB inbox account.
   */
  update: (
    accountId: string,
    payload: {
      fb_user_id?: string;
      account_label?: string;
      is_active?: boolean;
    },
  ): Promise<ApiResponse<FbInboxAccount>> => {
    return requestJson(`${BASE}/inbox-accounts/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Xóa FB inbox account.
   */
  delete: (accountId: string): Promise<ApiResponse<void>> => {
    return requestJson(`${BASE}/inbox-accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    });
  },
};

// ── Hàng đợi cào Facebook đa VPS (crawl_jobs/crawl_fb_accounts) ─────────────────
// Khác với FbInboxAccountsTab (KPI inbox, dùng extension "Markee" riêng) -- đây là
// pool acc cho hệ thống hàng đợi VPS worker (extension api-facebook-get-extension).

// standalone_login_api/check-phone-approval/submit-otp trả về JSON thô {status, message,
// session_id}, KHÔNG theo khuôn {success, message, data} như các endpoint all-platform
// khác -- nên dùng fetch riêng, không qua requestJson (tránh khai báo sai kiểu ApiResponse).
const FB_LOGIN_BASE = `${API_BASE_URL}/facebook/api/v1`;

export interface FbCrawlLoginResult {
  status: "success" | "need_otp" | "need_phone_approval" | "processing" | "error" | "error_bot_blocked";
  message?: string;
  session_id?: string;
}

async function fbLoginFetch(path: string, body: unknown): Promise<FbCrawlLoginResult> {
  try {
    const res = await fetch(`${FB_LOGIN_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { status: "error", message: "Lỗi kết nối đến máy chủ." };
  }
}

export const crawlFbLoginService = {
  /** Đăng nhập 1 acc Facebook vào pool, kèm id_member = chủ sở hữu (nhân viên hiện tại). */
  login: (payload: { email: string; password: string; secret_2fa?: string; id_member?: string }) => fbLoginFetch("/auth/login", payload),
  /** Gọi khi status="need_phone_approval"/"processing" -- backend tự poll tới 60s. */
  checkPhoneApproval: (session_id: string) => fbLoginFetch("/auth/check-phone-approval", { session_id }),
  /** Gọi khi status="need_otp". */
  submitOtp: (session_id: string, otp_code: string) => fbLoginFetch("/auth/submit-otp", { session_id, otp_code }),
};

export interface CrawlFbAccount {
  id: string;
  email: string;
  status: "available" | "assigned" | "invalid";
  last_used_at: string | null;
  error_message: string | null;
  updated_at: string;
}

export const crawlFbAccountService = {
  /** Danh sách acc trong pool thuộc về chính nhân viên đang đăng nhập. */
  list: (): Promise<ApiResponse<{ accounts: CrawlFbAccount[] }>> => {
    return requestJson(`${BASE}/facebook/crawl-accounts`);
  },
  /** Ngắt kết nối 1 acc của chính mình. */
  disconnect: (accountId: string): Promise<ApiResponse<null>> => {
    return requestJson(`${BASE}/facebook/crawl-accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    });
  },
};

export interface CrawlQueueWorker {
  worker_id: string;
  name: string | null;
  status: "idle" | "busy" | "offline";
  last_heartbeat: string | null;
  current_job_id: string | null;
}

export interface CrawlQueueRecentJob {
  id: string;
  group_name: string | null;
  group_url: string;
  status: "pending" | "assigned" | "processing" | "done" | "failed";
  assigned_worker_id: string | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CrawlQueueOverview {
  job_counts: Record<string, number>;
  account_counts: Record<string, number>;
  workers: CrawlQueueWorker[];
  recent_jobs: CrawlQueueRecentJob[];
}

export const crawlQueueService = {
  /** Tổng quan sức khoẻ hàng đợi cào đa VPS -- dùng cho trang giám sát. */
  overview: (): Promise<ApiResponse<CrawlQueueOverview>> => {
    return requestJson(`${BASE}/facebook/crawl-queue/overview`);
  },
};

export interface PlatformOnlineAccount {
  label: string;
  online: boolean;
}

export interface PlatformOnlineTotal {
  platform: "facebook" | "zalo";
  online: number;
  total: number;
  available: boolean;
  error: string | null;
  accounts: PlatformOnlineAccount[];
}

export interface AccountOnlineSummary {
  facebook: PlatformOnlineTotal;
  zalo: PlatformOnlineTotal;
  total: { online: number; total: number };
}

export const accountOnlineSummaryService = {
  /**
   * Tổng hợp Online/Total theo từng nền tảng (Facebook + Zalo).
   * Admin thấy toàn hệ thống, Leader thấy theo team, Member thấy tài khoản của mình.
   * Co timeout rieng (10s): Markee proxy o backend co the retry toi 45s x3 khi
   * cham/loi - widget nay chi hien 1 con so, khong duoc de nguoi dung cho lau,
   * timeout thi coi nhu "khong kha dung" thay vi treo "Dang tai..." vo han.
   */
  get: (): Promise<ApiResponse<AccountOnlineSummary>> => {
    return requestJsonWithTimeout(`${BASE}/accounts/online-summary`, undefined, 10000, "Không tải được dữ liệu online, thử lại sau.");
  },
};

export const customerLeadsService = {
  async getLeads() {
    return requestJson<import("@/types/unified.types").CustomerLead[]>("/customer-leads");
  },
  async getSDRs() {
    return requestJson<any[]>("/customer-leads/sdrs");
  },
  async createLead(data: any) {
    return requestJson("/customer-leads", { method: "POST", body: JSON.stringify(data) });
  },
  async updateLead(id: string, data: any) {
    return requestJson("/customer-leads/" + id, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteLead(id: string) {
    return requestJson("/customer-leads/" + id, { method: "DELETE" });
  },
};

export type { QuickCommentTemplate } from "@/types/unified.types";
