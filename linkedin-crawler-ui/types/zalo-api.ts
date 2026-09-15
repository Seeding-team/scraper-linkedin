export type ZaloAuthStatus =
  | "waiting_scan"
  | "confirmed"
  | "qr_expired"
  | "session_expired"
  | "not_logged_in";

export type ZaloJobStatus = "queued" | "running" | "completed" | "failed";

export interface ZaloAuthInitResponse {
  session_id: string;
  qr_base64: string;
  status: ZaloAuthStatus;
  expires_in: number;
}

export interface ZaloAuthStatusResponse {
  session_id: string;
  status: ZaloAuthStatus;
}

export interface ZaloCurrentStatusResponse {
  user_id: string;
  session_id: string | null;
  status: ZaloAuthStatus;
  is_logged_in: boolean;
  can_crawl: boolean;
  session_expired?: boolean;
  login_url: string | null;
  manual_viewer_url?: string | null;
  qr_base64?: string | null;
}

export interface ZaloManualLoginResponse {
  session_id: string;
  status: ZaloAuthStatus;
  can_crawl: boolean;
  manual_viewer_url?: string | null;
}

export interface ZaloDeleteSessionResponse {
  message: string;
}

export type ZaloWorkerStatus = "online" | "degraded" | "offline" | "unknown";

export interface ZaloWorkerInfo {
  id: string;
  label: string;
  status: ZaloWorkerStatus | string;
  is_default: boolean;
  queue_state: string;
}

export interface ZaloWorkersResponse {
  workers: ZaloWorkerInfo[];
  selected_worker_id: string | null;
}

export interface ZaloAccountInfo {
  account_id: string;
  owner_id?: string | null;
  label: string;
  phone?: string | null;
  status?: string | null;
  is_active?: boolean;
  has_auth?: boolean;
  is_shared_with_all?: boolean;
  listener?: {
    running: boolean;
    connected: boolean;
    pid?: number | null;
    last_event_at?: string | null;
    last_error?: string | null;
    messages_seen?: number;
    auth_expired?: boolean;
  };
}

export interface ZaloAccountsResponse {
  owner_id: string;
  accounts: ZaloAccountInfo[];
}

export interface ZaloInboxReportAccount {
  account_id: string;
  label: string;
  owner_id: string;
  message_count: number;
  customer_count: number;
  latest_message_at?: string | null;
}

export interface ZaloInboxReportCustomer {
  account_id: string;
  account_label: string;
  customer_id: string;
  customer_name: string;
  conversation_id?: string | null;
  conversation_name?: string | null;
  message_count: number;
  sent_count: number;
  received_count: number;
  latest_message_at?: string | null;
  latest_content?: string | null;
}

export interface ZaloInboxReportResponse {
  accounts: ZaloInboxReportAccount[];
  customers: ZaloInboxReportCustomer[];
  total_messages: number;
  total_customers: number;
}

export interface ZaloConversationSummary {
  conversation_id: string;
  conversation_name: string;
  account_id: string;
  message_count: number;
  image_count: number;
  sent_count: number;
  received_count: number;
  latest_message_at?: string | null;
  latest_content?: string | null;
  latest_sender_name?: string | null;
  has_messages?: boolean;
  sync_status?: "has_messages" | "known_empty" | string;
  avatar_url?: string | null;
  unread_count?: number;
  is_pinned?: boolean;
}

export interface ZaloConversationListResponse {
  account_id: string;
  conversations: ZaloConversationSummary[];
  total: number;
}

export interface ZaloSyncRecentGroupResult {
  group_id: string;
  group_name: string;
  messages_saved: number;
  status: "has_messages" | "empty" | "error" | string;
  error?: string | null;
}

export interface ZaloSyncRecentResponse {
  account_id: string;
  scanned: number;
  groups_with_messages: number;
  messages_saved: number;
  errors: number;
  results: ZaloSyncRecentGroupResult[];
}

export interface ZaloStartCrawlRequest {
  sessionId?: string | null;
  userId?: string;
  group_name: string;
  group_id?: string | null;
  sheet_tab?: string;
  max_messages?: number;
}

export interface ZaloStartCrawlResponse {
  job_id: string;
  status: "queued" | "running";
  sheet_url: string | null;
}

export interface ZaloCrawledGroupItem {
  group_name: string;
  sheet_tab: string;
  message_count: number;
}

export interface ZaloCrawledGroupsResponse {
  sheet_id: string;
  sheet_url: string;
  total_groups: number;
  groups: ZaloCrawledGroupItem[];
}

export interface ZaloJobProgress {
  messages_collected: number;
  images_found: number;
  oldest_message_date: string | null;
}

export interface ZaloMessage {
  id?: string | number;
  sender: string;
  time_text: string;
  is_sent?: boolean;
  content: string;
  image_urls?: string[];
}

export interface ZaloJobData {
  job_id: string;
  user_id?: string;
  group_id?: string | null;
  group_name: string;
  sheet_id?: string | null;
  sheet_tab?: string | null;
  status: ZaloJobStatus;
  progress: ZaloJobProgress;
  started_at: string;
  completed_at?: string | null;
  error?: string | null;
  sheet_url?: string | null;
  messages?: ZaloMessage[] | null;
}

export interface ZaloStoredAsset {
  id?: string;
  message_id?: string | null;
  source_url?: string | null;
  storage_path?: string | null;
  storage_url?: string | null;
  status: "pending" | "uploaded" | "failed" | string;
  error?: string | null;
}

export interface ZaloLibraryMessage {
  id: string;
  user_id: string;
  job_id?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  source_message_id?: string | null;
  sender_id?: string | null;
  sender_name?: string | null;
  timestamp_text?: string | null;
  time_text?: string | null;
  type: string;
  content?: string | null;
  is_sent: boolean;
  is_deleted: boolean;
  role?: "leader" | "staff" | "client" | string | null;
  assets: ZaloStoredAsset[];
  // Zalo tập trung (Mục 7.1 guide) — trả về bởi fn_get_zalo_conversation_messages
  // (migration 128). cli_msg_id bắt buộc để thu hồi tin (chỉ có ở tin mình gửi).
  ts?: number | null;
  cli_msg_id?: string | null;
  mentions?: ZaloMention[] | null;
  msg_kind?: string | null;
  raw_content?: Record<string, unknown> | null;
}

export type ZaloLibraryContentKind = "all" | "text" | "image";

export interface ZaloLibraryGroupSummary {
  group_name: string;
  sheet_tab?: string | null;
  message_count: number;
  image_count: number;
  latest_message_at?: string | null;
}

export interface ZaloLibraryListResponse {
  messages: ZaloLibraryMessage[];
  groups: ZaloLibraryGroupSummary[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ZaloLibraryBulkDeleteRequest {
  message_ids?: string[];
  group_name?: string;
  delete_all_matching?: boolean;
}

export interface ZaloLibraryBulkDeleteResponse {
  deleted_count: number;
}

export interface ZaloLibraryMessageCreateRequest {
  group_name?: string;
  sender_name?: string;
  time_text?: string;
  type?: string;
  content?: string;
  asset_urls?: string[];
}

export interface ZaloLibraryMessageUpdateRequest {
  group_name?: string;
  sender_name?: string;
  time_text?: string;
  type?: string;
  content?: string;
  is_deleted?: boolean;
}

export interface ZaloLiveGroup {
  group_id: string;
  name: string;
  avatar_url?: string | null;
  last_message?: string | null;
  unread_count: number;
}

export type ZaloGroupVerifyStatus =
  | "unchecked"
  | "verified"
  | "not_found"
  | "personal_chat"
  | "zalo_not_ready"
  | "message_panel_missing"
  | "duplicate"
  | "failed";

export interface ZaloVerifyGroupRequestItem {
  group_name: string;
  group_id?: string | null;
  sheet_tab?: string | null;
}

export interface ZaloVerifiedGroupItem {
  group_name: string;
  group_id?: string | null;
  sheet_tab?: string | null;
  current_title?: string | null;
  member_count?: number | null;
  message_count: number;
  warnings: string[];
}

export interface ZaloRejectedGroupItem {
  group_name: string;
  group_id?: string | null;
  reason: ZaloGroupVerifyStatus | string;
  detail: string;
  current_title?: string | null;
  member_count?: number | null;
  warnings: string[];
}

export interface ZaloVerifyGroupsResponse {
  verified: ZaloVerifiedGroupItem[];
  rejected: ZaloRejectedGroupItem[];
}

export type ZaloBroadcastContentMode = "text" | "image" | "both";

export interface ZaloBroadcastTarget {
  group_id?: string | null;
  group_name: string;
}

export interface ZaloBroadcastRequest {
  user_id?: string;
  /** Luồng cũ: chọn tin đã lưu Library. Bỏ trống nếu dùng text/image_urls bên dưới. */
  message_ids?: string[];
  /** Luồng mới (Zalo tập trung) — gõ trực tiếp, không cần lưu Library trước. */
  text?: string;
  image_urls?: string[];
  targets: ZaloBroadcastTarget[];
  content_mode: ZaloBroadcastContentMode;
  text_overrides?: Record<string, string>;
}

export interface ZaloBroadcastPreviewItem {
  message_id: string;
  content?: string | null;
  image_count: number;
  image_urls?: string[];
  send_text: boolean;
  send_images: boolean;
  warnings: string[];
}

export interface ZaloBroadcastPreviewResponse {
  target_count: number;
  message_count: number;
  items: ZaloBroadcastPreviewItem[];
  warnings: string[];
}

export interface ZaloBroadcastResponse {
  campaign_id: string;
  status: string;
}

export interface ZaloBroadcastStatusResponse {
  campaign: Record<string, unknown>;
  targets: Record<string, unknown>[];
  items: Record<string, unknown>[];
  logs: Record<string, unknown>[];
}

// ── Zalo tập trung (port ZALO_CENTRALIZED_MODULE_GUIDE.md) ─────────────────────

export interface ZaloMention {
  pos: number;
  uid: string;
  len: number;
}

export interface ZaloRecallMessageRequest {
  msg_id: string;
  cli_msg_id: string;
}

export interface ZaloFriendStatusResponse {
  uid: string;
  /** true = MÌNH đã gửi lời mời (chờ họ chấp nhận). KHÔNG đảo nghĩa field này. */
  is_requested?: number | boolean;
  /** true = HỌ đang gửi lời mời cho MÌNH (chờ mình chấp nhận). KHÔNG đảo nghĩa field này. */
  is_requesting?: number | boolean;
  is_friend?: number | boolean;
  [key: string]: unknown;
}

export interface ZaloGroupMember {
  uid: string;
  display_name: string;
  avatar_url?: string | null;
  role: "admin" | "member" | string;
}

export interface ZaloGroupMembersResponse {
  group_id: string;
  total_member: number;
  members: ZaloGroupMember[];
}

export interface ZaloStickerDetail {
  id: number;
  cateId: number;
  [key: string]: unknown;
}

export interface ZaloAccountAssignment {
  id: number;
  app_user_id: string;
  account_id: string;
  can_view: boolean;
  can_send: boolean;
  can_broadcast: boolean;
}

// Forward rules

export interface ZaloForwardTarget {
  id?: number;
  target_thread_id: string;
  target_thread_name?: string | null;
  is_enabled?: boolean;
}

export interface ZaloForwardRule {
  id: number;
  account_id: string;
  name?: string | null;
  master_thread_id: string;
  master_thread_name?: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  zalo_forward_targets?: ZaloForwardTarget[];
}

export interface ZaloForwardRuleCreateRequest {
  account_id: string;
  name?: string;
  master_thread_id: string;
  master_thread_name?: string;
  target_thread_ids: string[];
  target_thread_names?: Record<string, string>;
}

export interface ZaloForwardLog {
  id: number;
  rule_id: number | null;
  account_id: string;
  source_thread_id: string;
  source_msg_id?: string | null;
  target_thread_id: string;
  content_type: string;
  status: "success" | "failed" | "dry_run" | "skipped" | "rate_limited";
  error?: string | null;
  created_at: string;
}

// Bulk-send

export type ZaloBulkJobType = "send_message" | "add_friend" | "invite_group";
export type ZaloBulkJobStatus = "pending" | "running" | "completed" | "paused" | "cancelled";

export interface ZaloBulkJobRecipient {
  phone?: string | null;
  uid?: string | null;
  display_name?: string | null;
}

export interface ZaloBulkJob {
  id: number;
  account_id: string;
  job_type: ZaloBulkJobType;
  status: ZaloBulkJobStatus;
  message?: string | null;
  friend_message?: string | null;
  image_urls: string[];
  target_group_id?: string | null;
  target_group_name?: string | null;
  delay_seconds_min: number;
  delay_seconds_max: number;
  total_count: number;
  sent_count: number;
  success_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export interface ZaloBulkJobItem {
  id: number;
  job_id: number;
  phone?: string | null;
  uid?: string | null;
  display_name?: string | null;
  status: "pending" | "sent" | "failed" | "not_found" | "skipped";
  error?: string | null;
  processed_at?: string | null;
}

export interface ZaloBulkJobCreateRequest {
  account_id: string;
  job_type: ZaloBulkJobType;
  recipients: ZaloBulkJobRecipient[];
  message?: string;
  friend_message?: string;
  image_urls?: string[];
  target_group_id?: string;
  target_group_name?: string;
  delay_seconds_min?: number;
  delay_seconds_max?: number;
  scheduled_at?: string;
}

// Campaigns

export interface ZaloCampaign {
  id: number;
  account_id: string;
  name: string;
  is_enabled: boolean;
  start_time?: string | null;
  end_time?: string | null;
  days_of_week?: number[] | null;
  interval_seconds_min: number;
  interval_seconds_max: number;
  daily_limit: number;
  message_templates: string[];
  next_template_index: number;
  repeat_cycle_seconds: number;
  sent_today: number;
  sent_today_date?: string | null;
  last_sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZaloCampaignCreateRequest {
  account_id: string;
  name: string;
  is_enabled?: boolean;
  start_time?: string;
  end_time?: string;
  days_of_week?: number[];
  interval_seconds_min?: number;
  interval_seconds_max?: number;
  daily_limit?: number;
  message_templates: string[];
  repeat_cycle_seconds?: number;
  recipients?: ZaloBulkJobRecipient[];
}

export interface ZaloCampaignRecipient {
  id: number;
  campaign_id: number;
  phone?: string | null;
  uid?: string | null;
  display_name?: string | null;
  status: string;
  last_error?: string | null;
  sent_at?: string | null;
}

export interface ZaloCampaignLog {
  id: number;
  campaign_id: number;
  recipient_id?: number | null;
  phone?: string | null;
  status: "success" | "failed";
  error?: string | null;
  message_sent?: string | null;
  created_at: string;
}

// Web Push

export interface ZaloPushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
}
