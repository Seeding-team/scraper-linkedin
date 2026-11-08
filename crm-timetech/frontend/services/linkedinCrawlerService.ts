import { API_BASE_URL, API_KEY } from "@/lib/env";
import type {
  AddListGroupRequest,
  AddMemberRequest,
  AddMemberResponse,
  AddN8nGroupRequest,
  GroupTaxonomyFields,
  ApiResponse,
  AssignKpiRequest,
  BulkGroupImportResponse,
  CheckPermissionRequest,
  CheckPermissionResponse,
  EnsureProfileSlugResponse,
  CrawlGroupRequest,
  CrawlResponse,
  FilterDataRequest,
  FilterDataResponse,
  GetAllKpiRequest,
  GetAllKpiResponse,
  GetAllN8nGroupsRequest,
  GetAllPostsRequest,
  GetAllPostsResponse,
  GetKpiByEmailRequest,
  GetKpiByEmailResponse,
  LoginRequest,
  LoginResponse,
  N8nGroupOperationResponse,
  RemoveN8nGroupRequest,
  StartWorkflowRequest,
  StartWorkflowResponse,
  StatusResponse,
  UpdateN8nGroupRequest,
  VerifyLeaderCodeRequest,
  VerifyLoginRequest,
  VerifyLoginResponse,
  ProfileSlugSheetCheckResponse,
  GetMyProfileSlugResponse,
  LinkedinAppStatsRequest,
  LinkedinAppStatsResponse,
  GetProfilesRequest,
  UpdateProfileSlugRequest,
} from "@/types/api";

const JSON_HEADERS = {
  "Content-Type": "application/json",
} as const;

function appendTaxonomyFields(
  body: Record<string, unknown>,
  tax: GroupTaxonomyFields | undefined,
  prefix: "" | "new_" = "",
): void {
  if (!tax) return;
  const p = prefix;
  if (tax.industry?.trim()) body[`${p}industry`] = tax.industry.trim();
  if (tax.tier != null && tax.tier >= 1 && tax.tier <= 3) body[`${p}tier`] = tax.tier;
  if (tax.team?.trim()) body[`${p}team`] = tax.team.trim();
  if (tax.icp?.trim()) body[`${p}icp`] = tax.icp.trim();
  if (tax.icp_desc?.trim()) body[`${p}icp_desc`] = tax.icp_desc.trim();
  if (tax.platform?.trim()) body[`${p}platform`] = tax.platform.trim();
}

function buildHeaders(): HeadersInit {
  if (!API_KEY) {
    return JSON_HEADERS;
  }
  return {
    ...JSON_HEADERS,
    "x-api-key": API_KEY,
  };
}

async function requestJson<TResponse>(
  path: string,
  init?: RequestInit,
  timeoutMs = 10000,
): Promise<TResponse> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Chain signals: dùng AbortSignal.any() nếu có, hoặc fallback về internal signal
  let finalSignal: AbortSignal | undefined = controller.signal;
  const externalSignal = init?.signal;
  if (externalSignal && typeof AbortSignal.any === "function") {
    finalSignal = AbortSignal.any([controller.signal, externalSignal]);
  }

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: finalSignal,
      credentials: "omit",
      headers: {
        ...buildHeaders(),
        ...init?.headers,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw error; // re-throw AbortError as-is, don't wrap
    }
    const hint = error instanceof Error ? error.message : String(error);
    throw new Error(`Không kết nối được API (${API_BASE_URL}${path}): ${hint}`);
  } finally {
    clearTimeout(timeoutId);
  }

  let payload: TResponse;
  try {
    payload = (await response.json()) as TResponse;
  } catch {
    throw new Error(
      `API ${response.status}: phản hồi không phải JSON (${API_BASE_URL}${path})`,
    );
  }
  if (!response.ok) {
    const errorPayload = payload as
      | { message?: string; detail?: string }
      | undefined;
    const backendMessage =
      errorPayload?.message?.trim() || errorPayload?.detail?.trim();
    throw new Error(
      backendMessage
        ? `API ${response.status}: ${backendMessage}`
        : `API ${response.status}: ${response.statusText}`,
    );
  }
  return payload;
}

export function fetchCrawlerStatus(): Promise<StatusResponse> {
  return requestJson<StatusResponse>("/api/all-platform/linkedin/status", { method: "GET" });
}

export async function deleteLinkedinCategory(
  payload: { category_type: string; value: string; platform?: string },
) {
  return requestJson<ApiResponse<null>>("/facebook/api/v1/sheet-management/categories/delete", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function loginLinkedIn(payload: LoginRequest): Promise<LoginResponse> {
  return requestJson<LoginResponse>("/api/all-platform/linkedin/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function checkProfileSlugInSheet(payload: {
  email: string;
}): Promise<ProfileSlugSheetCheckResponse> {
  return requestJson<ProfileSlugSheetCheckResponse>(
    "/api/all-platform/linkedin/me/profile-slug-sheet-check",
    {
      method: "POST",
      body: JSON.stringify({ email: payload.email.trim() }),
    },
  );
}

/** Sau login / verify: kiểm tra sheet → nếu chưa có email thì cào slug + webhook add. */
export function ensureProfileSlugIfMissing(payload: {
  email: string;
  sessionId?: string | null;
}): Promise<EnsureProfileSlugResponse> {
  const body: Record<string, unknown> = { email: payload.email.trim() };
  const sid = payload.sessionId?.trim();
  if (sid) body.session_id = sid;
  return requestJson<EnsureProfileSlugResponse>(
    "/api/all-platform/linkedin/me/ensure-profile-slug",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

/** Lấy profile slug qua Playwright (menu Me → View profile). Cần ít nhất một trong sessionId, email. */
export function getMyProfileSlug(payload: {
  sessionId?: string | null;
  email?: string | null;
}): Promise<GetMyProfileSlugResponse> {
  const session_id = payload.sessionId?.trim() || undefined;
  const email = payload.email?.trim() || undefined;
  const body: Record<string, unknown> = {};
  if (session_id) body.session_id = session_id;
  if (email) body.email = email;
  return requestJson<GetMyProfileSlugResponse>(
    "/api/all-platform/linkedin/me/profile-slug",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function verifyLinkedInOtp(
  payload: VerifyLoginRequest,
): Promise<VerifyLoginResponse> {
  return requestJson<VerifyLoginResponse>("/api/all-platform/linkedin/verify", {
    method: "POST",
    body: JSON.stringify({
      session_id: payload.sessionId,
      otp: payload.otp,
      checkpoint_url: payload.checkpointUrl,
    }),
  });
}

export function startN8nWorkflow(
  payload: StartWorkflowRequest,
): Promise<StartWorkflowResponse> {
  return requestJson<StartWorkflowResponse>("/api/all-platform/linkedin/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function crawlLinkedInGroup(
  payload: CrawlGroupRequest,
): Promise<CrawlResponse> {
  return requestJson<CrawlResponse>("/api/all-platform/linkedin/crawl-linkedin-group", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function filterLinkedInPosts(
  payload: FilterDataRequest,
): Promise<FilterDataResponse> {
  return requestJson<FilterDataResponse>("/api/all-platform/linkedin/posts/filter", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAllLinkedInPosts(
  payload: GetAllPostsRequest,
): Promise<GetAllPostsResponse> {
  return requestJson<GetAllPostsResponse>("/api/all-platform/linkedin/posts/get-all", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAllN8nGroups(
  payload: GetAllN8nGroupsRequest,
  /** Timeout cho n8n webhook — mặc định 120s vì n8n có thể cào nhiều group. */
  timeoutMs = 120_000,
): Promise<N8nGroupOperationResponse> {
  return requestJson<N8nGroupOperationResponse>(
    "/api/all-platform/linkedin/groups/n8n-get-all",
    {
      method: "POST",
      body: JSON.stringify({ email: payload.email.trim() }),
    },
    timeoutMs,
  );
}

export function addListGroupBulk(
  payload: AddListGroupRequest,
): Promise<BulkGroupImportResponse> {
  const body: Record<string, unknown> = {
    group_urls: payload.group_urls.map((u) => u.trim()).filter(Boolean),
    post_to_webhook: payload.post_to_webhook ?? true,
    delay_min_sec: payload.delay_min_sec ?? 2,
    delay_max_sec: payload.delay_max_sec ?? 5,
  };
  if (payload.email?.trim()) body.email = payload.email.trim();
  body.type = (payload.type || "").trim();
  if (payload.webhook_timeout_sec != null)
    body.webhook_timeout_sec = payload.webhook_timeout_sec;
  return requestJson<BulkGroupImportResponse>(
    "/api/all-platform/linkedin/groups/add-list-group",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function addN8nGroup(
  payload: AddN8nGroupRequest,
): Promise<N8nGroupOperationResponse> {
  const body: Record<string, unknown> = {
    url_group: payload.url_group.trim(),
    name_group: payload.name_group.trim(),
    member: payload.member,
  };
  if (payload.email?.trim()) body.email = payload.email.trim();
  body.type = (payload.type || "").trim();
  appendTaxonomyFields(body, payload);
  if (!body.platform) body.platform = "linkedin";
  return requestJson<N8nGroupOperationResponse>("/api/all-platform/linkedin/groups/add", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeN8nGroup(
  payload: RemoveN8nGroupRequest,
): Promise<N8nGroupOperationResponse> {
  const body: Record<string, unknown> = {
    url_group: payload.url_group.trim(),
  };
  if (payload.email?.trim()) body.email = payload.email.trim();
  return requestJson<N8nGroupOperationResponse>("/api/all-platform/linkedin/groups/remove", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateN8nGroup(
  payload: UpdateN8nGroupRequest,
): Promise<N8nGroupOperationResponse> {
  const body: Record<string, unknown> = {
    url_group_need_update: payload.url_group_need_update.trim(),
    name_group: payload.name_group.trim(),
    member: payload.member,
  };
  if (payload.new_url_group != null && payload.new_url_group !== "")
    body.new_url_group = payload.new_url_group.trim();
  if (payload.new_name_group != null && payload.new_name_group !== "")
    body.new_name_group = payload.new_name_group.trim();
  if (payload.new_member != null) body.new_member = payload.new_member;
  if (payload.new_type != null && payload.new_type !== "")
    body.new_type = payload.new_type.trim();
  if (payload.email?.trim()) body.email = payload.email.trim();
  appendTaxonomyFields(body, payload);
  appendTaxonomyFields(
    body,
    {
      industry: payload.new_industry ?? undefined,
      tier: payload.new_tier ?? undefined,
      team: payload.new_team ?? undefined,
      icp: payload.new_icp ?? undefined,
      icp_desc: payload.new_icp_desc ?? undefined,
      platform: payload.new_platform ?? undefined,
    },
    "new_",
  );
  return requestJson<N8nGroupOperationResponse>("/api/all-platform/linkedin/groups/update", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Đọc lại tiến độ (reaction/comments) cho 1 bài viết. */
export function syncPostProgress(payload: {
  post_url: string;
  profile_slug: string;
  Email_crawl: string;
  ID_session_crawl: string;
  row_number: number;
  sheet_row?: Record<string, unknown> | null;
  session_id?: string | null;
  email?: string | null;
  password?: string | null;
  auto_login?: boolean;
  post_to_webhook?: boolean;
  timeout_ms?: number;
}): Promise<import("@/types/api").SyncPostProgressResponse> {
  return requestJson<import("@/types/api").SyncPostProgressResponse>(
    "/api/all-platform/linkedin/post/sync-progress",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/** Đọc lại tiến độ cho toàn bộ bài viết của user. */
export function syncAllProgress(payload: {
  email_crawl: string;
  profile_slug: string;
  session_id?: string | null;
  email?: string | null;
  password?: string | null;
  auto_login?: boolean;
  timeout_ms_per_post?: number;
  limit_posts?: number;
}): Promise<import("@/types/api").SyncAllProgressResponse> {
  return requestJson<import("@/types/api").SyncAllProgressResponse>(
    "/api/all-platform/linkedin/sync-all-progress",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getLinkedInStats(
  payload: LinkedinAppStatsRequest,
): Promise<LinkedinAppStatsResponse> {
  return requestJson<LinkedinAppStatsResponse>("/api/all-platform/linkedin/app/stats", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Leader gán KPI cho member. */
export function assignKpi(
  payload: AssignKpiRequest,
): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>("/api/all-platform/linkedin/kpi/assign", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Kiểm tra quyền leader/member. */
export function checkPermission(
  payload: CheckPermissionRequest,
): Promise<CheckPermissionResponse> {
  return requestJson<CheckPermissionResponse>(
    "/api/all-platform/linkedin/auth/check-permission",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/** Lấy toàn bộ KPI cho leader. */
export function getAllKpi(
  payload: GetAllKpiRequest,
): Promise<GetAllKpiResponse> {
  return requestJson<GetAllKpiResponse>("/api/all-platform/linkedin/kpi/get-all", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Lấy KPI cho member theo email. */
export function getKpiByEmail(
  payload: GetKpiByEmailRequest,
): Promise<GetKpiByEmailResponse> {
  return requestJson<GetKpiByEmailResponse>("/api/all-platform/linkedin/kpi/get-by-email", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Thêm thành viên mới vào đội ngũ. */
export function addMember(
  payload: AddMemberRequest,
): Promise<AddMemberResponse> {
  return requestJson<AddMemberResponse>("/api/all-platform/linkedin/team/add-member", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Xác nhận mã code leader. */
export function verifyLeaderCode(
  payload: VerifyLeaderCodeRequest,
): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/auth/verify-leader-code",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/** Cập nhật vai trò member cho tài khoản. */
export function updateRoleToMember(
  payload: { email: string },
): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/auth/update-role-to-member",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}
export const getAllProfiles = async (
  payload: GetProfilesRequest,
): Promise<ApiResponse<any[]>> => {
  const response = await fetch(`${API_BASE_URL}/api/all-platform/linkedin/all-profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(payload),
  });
  return response.json();
};
export function updateProfileSlug(
  payload: UpdateProfileSlugRequest,
): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/me/profile-slug-update",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export interface LinkedinCategoryPayload {
  category_type: string;
  value: string;
  name?: string;
}

export function addLinkedinCategory(
  payload: LinkedinCategoryPayload,
): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/categories/add",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function updateLinkedinCategory(
  payload: LinkedinCategoryPayload,
): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/categories/update",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}



export interface GetLinkedinCategoriesResponse {
  status: string;
  message: string;
  data: Record<string, any[]>;
}

export function getLinkedinCategories(): Promise<GetLinkedinCategoriesResponse> {
  return requestJson<GetLinkedinCategoriesResponse>(
    "/api/all-platform/linkedin/categories",
    {
      method: "GET",
    },
  );
}

export interface SeedingKpiItem {
  email_member: string;
  name: string;
  url_profile: string;
  platform: string;
  content: string;
  link_post: string;
  verify: string;
  day: string;
  link_comment?: string;
  /** Facebook/LinkedIn profile ID — dùng để lọc chính xác */
  profile_id?: string;
  /** Tên Facebook hiển thị trên web — dùng để lọc dự phòng */
  facebook_name?: string;
}

export function getSeedingKpis(payload: {
  email_member?: string;
  profile_id?: string;
  facebook_name?: string;
}): Promise<ApiResponse<SeedingKpiItem[]>> {
  return requestJson<ApiResponse<SeedingKpiItem[]>>(
    "/api/all-platform/linkedin/seeding-kpi/get-all",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function saveSeedingKpi(payload: {
  email_member: string;
  name: string;
  name_profile: string;
  platform: string;
  content: string;
  link_post: string;
  verify: string;
  link_comment?: string;
  profile_id?: string;
  facebook_name?: string;
  day?: string;
}): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/seeding-kpi/save",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/** Step 1: Đánh dấu seeding — chỉ lưu email + link_post (verify='pending') */
export function markSeeding(payload: {
  email_member: string;
  link_post: string;
}): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/seeding-mark/save",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/** Lấy danh sách seeding marks chưa verify của 1 member */
export function getUnverifiedSeedingMarks(
  payload: { email_member: string },
  init?: RequestInit,
): Promise<ApiResponse<SeedingKpiItem[]>> {
  return requestJson<ApiResponse<SeedingKpiItem[]>>(
    "/api/all-platform/linkedin/seeding-mark/get-unverified",
    {
      method: "POST",
      body: JSON.stringify(payload),
      ...init,
    },
  );
}

/** Lấy TẤT CẢ seeding marks của 1 member (cả verified và chưa verified)
 * Trả về dict: key=link_post, value=verify status ("yes"/"pending") */
export function getAllSeedingMarks(
  payload: { email_member: string },
  init?: RequestInit,
): Promise<ApiResponse<Record<string, string>>> {
  return requestJson<ApiResponse<Record<string, string>>>(
    "/api/all-platform/linkedin/seeding-mark/get-all",
    {
      method: "POST",
      body: JSON.stringify(payload),
      ...init,
    },
  );
}

/** Lấy số bài seeding thực tế đã xác minh của 1 member (dùng cho leader xem KPI)
 * Trả về { verified_count, total_count, items } */
export function getMemberActualSeedingCount(
  payload: { email_member: string; profile_id?: string; facebook_name?: string; date_from?: string; date_to?: string },
  init?: RequestInit,
): Promise<ApiResponse<{ verified_count: number; total_count: number; items: SeedingKpiItem[] }>> {
  return requestJson<ApiResponse<{ verified_count: number; total_count: number; items: SeedingKpiItem[] }>>(
    "/api/all-platform/linkedin/seeding-mark/get-actual-count",
    {
      method: "POST",
      body: JSON.stringify(payload),
      ...init,
    },
  );
}

/** Step 2: Verify dòng đã mark — fill đầy đủ columns */
export function verifySeedingMark(payload: {
  email_member: string;
  link_post: string;
  name?: string;
  link_comment?: string;
  name_profile?: string;
  platform?: string;
  content?: string;
  profile_id?: string;
  facebook_name?: string;
  verify?: string;
}): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(
    "/api/all-platform/linkedin/seeding-mark/verify",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/** Lấy KPI target (kpi_comment) của member trong khoảng ngày */
export function getMemberKpiTarget(
  payload: { email_member: string; date_from?: string; date_to?: string },
  init?: RequestInit,
): Promise<ApiResponse<{ kpi_target: number; kpi_rows: { start: string; end: string; kpi_comment: number; platform: string; status: string }[] }>> {
  return requestJson<ApiResponse<{ kpi_target: number; kpi_rows: { start: string; end: string; kpi_comment: number; platform: string; status: string }[] }>>(
    "/api/all-platform/linkedin/seeding-mark/get-kpi-target",
    {
      method: "POST",
      body: JSON.stringify(payload),
      ...init,
    },
  );
}

export interface TeamDto {
  id: string;
  name_team: string;
  id_leader: string;
  leader_email: string;
  leader_name: string;
  members: { id: string; email: string; name?: string }[];
  number_of_member: number;
}

export function getAllTeams(): Promise<ApiResponse<TeamDto[]>> {
  return requestJson<ApiResponse<TeamDto[]>>("/api/all-platform/teams", { method: "GET" });
}

export function createTeam(payload: { name_team: string; leader_id?: string; leader_email?: string; member_emails: string[] }): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>("/api/all-platform/teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTeam(payload: { name_team: string; leader_id?: string; leader_email?: string; member_emails: string[] }): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>("/api/all-platform/teams", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteTeam(name_team: string, leader_id_or_email: string): Promise<ApiResponse<unknown>> {
  return requestJson<ApiResponse<unknown>>(`/api/all-platform/teams?name_team=${encodeURIComponent(name_team)}&leader=${encodeURIComponent(leader_id_or_email)}`, {
    method: "DELETE",
  });
}

export function getUsersByRole(role: string): Promise<ApiResponse<import("@/types/unified.types").AppUser[]>> {
  return requestJson<ApiResponse<import("@/types/unified.types").AppUser[]>>(`/api/all-platform/users/by-role?role=${role}`, { method: "GET" });
}
