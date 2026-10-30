/**
 * Shared JSON shapes giữa API routes và UI — đối chiếu với
 * lib/zalo-api.ts (app chính) quanh dòng 522 (ZaloAccountSummary) và
 * dòng 592-608 (StaffRecord/StaffAssignment) để giữ nguyên hình dạng dữ
 * liệu, tránh lệch schema giữa 2 app cùng gọi 1 bridge/Supabase.
 */

export type ZaloAccountSummary = {
  account_id: string;
  display_name: string;
  status: "connected" | "waiting_qr" | "disconnected" | "error";
  zalo_user_id?: string | null;
  zalo_display_name?: string | null;
  inbox_id?: number | string | null;
  is_ws_connected?: boolean;
  owner_staff_id?: string | null;
  phone?: string | null;
  last_seen_at?: string | null;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
  /** "Tắt load tin nhắn" — tạm dừng thông báo đẩy (Web Push) cho account này,
   *  KHÔNG tắt sync/forward/campaign (xem app/api/accounts/[id]/pause-messages). */
  messages_paused?: boolean;
  /** Workspace hiện tại của tài khoản này (cột `zalo_accounts.workspace_id`
   *  self-host, bridge không biết khái niệm này) — chỉ GET /api/accounts mới
   *  merge thêm field này (2026-10-07, cho super admin thấy + chuyển workspace
   *  qua PATCH /api/accounts/[id]/workspace). */
  workspace_id?: string | null;
};

export type StaffRecord = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "staff";
  is_active: boolean;
  avatar_url?: string | null;
  /** Workspace ("doanh nghiệp") staff này thuộc về — 2026-09-29, xem
   *  migrations/2026-09-29_workspaces.sql. null = ca hiếm gặp (chưa gắn). */
  workspace_id?: string | null;
  /** Tầng vận hành toàn app, độc lập workspace — xem src/lib/zaloAuth.ts. */
  is_super_admin?: boolean;
  created_at: string;
};

/**
 * can_view/can_send/can_broadcast — GIỮ NGUYÊN (không đổi tên/ý nghĩa):
 * services/zalo-forward-module đọc thẳng 3 cột này bằng tên cột cứng.
 * can_broadcast giờ là cột SUY RA TỰ ĐỘNG (trigger) từ can_forward/
 * can_campaign/can_bulk_send — vẫn đọc/ghi được như cũ, chỉ không còn là
 * nguồn sự thật (xem 8 cờ mới bên dưới, đúng 1:1 từng tính năng/nav item).
 */
export type StaffAssignment = {
  staff_id: string;
  account_id: string;
  can_view: boolean;
  can_send: boolean;
  can_broadcast: boolean;
  can_view_chat: boolean;
  can_send_chat: boolean;
  can_bulk_send: boolean;
  can_sync: boolean;
  can_forward: boolean;
  can_campaign: boolean;
  can_broadcast_groups: boolean;
  can_scan_group_members: boolean;
};

/**
 * "Người quản lý" 1 tài khoản Zalo — dùng RIÊNG để định tuyến thông báo đẩy
 * (worker/pushNotifier.js), KHÔNG liên quan tới StaffAssignment ở trên (xem
 * migrations/2026-10-02_zalo_account_managers.sql để biết lý do tách riêng).
 */
export type ZaloAccountManager = {
  account_id: string;
  staff_id: string;
};

/**
 * "Chiến dịch nhắn tin tự động" — đối chiếu supabase/migrations/
 * 2026-09-07_zalo_bulk_and_campaigns.sql (bảng zalo_campaigns/
 * zalo_campaign_recipients/zalo_campaign_logs) và worker/automationWorker.js
 * (processCampaignOnce) để giữ đúng hình dạng dữ liệu — API route chỉ CRUD
 * quanh 2 file đó, không đổi schema/hợp đồng dữ liệu.
 */
export type MessageTemplate = {
  text: string;
  image_urls: string[];
};

export type ZaloCampaign = {
  id: number;
  account_id: string;
  name: string;
  is_enabled: boolean;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  interval_seconds_min: number;
  interval_seconds_max: number;
  daily_limit: number;
  /** Chu kỳ lặp lại gửi cho toàn bộ danh sách người nhận (giây) — mặc định 86400 (1 ngày). */
  repeat_cycle_seconds: number;
  /** "phone_list" (mặc định, danh sách SĐT dán tay) | "tag" (tự động lấy từ
   *  bạn bè mang 1 trong các nhãn ở target_tags — xem syncTagRecipients() ở
   *  worker/automationWorker.js). */
  target_mode?: "phone_list" | "tag";
  target_tags?: string[];
  message_templates: MessageTemplate[];
  next_template_index: number;
  sent_today: number;
  sent_today_date: string | null;
  last_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ZaloCampaignRecipient = {
  id: number;
  campaign_id: number;
  phone: string;
  uid: string | null;
  display_name: string | null;
  status: "pending" | "sent" | "failed" | "not_found" | "skipped";
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
};

export type ZaloCampaignLog = {
  id: number;
  campaign_id: number | null;
  recipient_id: number | null;
  phone: string | null;
  status: "success" | "failed";
  error: string | null;
  message_sent: string | null;
  created_at: string;
};

// ── Chuyển tiếp tin nhắn — port từ services/zalo-forward-module/src/lib/types.ts,
// giữ nguyên schema (2 module cùng đọc/ghi bảng zalo_forward_rules/targets/logs). ──
export type ZaloForwardTarget = {
  id?: number;
  rule_id?: number;
  target_thread_id: string;
  target_thread_name?: string | null;
  is_enabled?: boolean;
};

export type ZaloForwardRule = {
  id: number;
  account_id: string;
  name: string | null;
  master_thread_id: string;
  master_thread_name: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  targets: ZaloForwardTarget[];
};

export type ZaloForwardLog = {
  id: number;
  rule_id: number | null;
  account_id: string;
  source_thread_id: string;
  source_msg_id: string | null;
  target_thread_id: string;
  content_type: string;
  status: string;
  error: string | null;
  created_at: string;
};

// ── Gửi hàng loạt theo số điện thoại — đối chiếu app/api/bulk-jobs/**
// (bảng zalo_bulk_jobs/zalo_bulk_job_items) và worker/automationWorker.js
// (processBulkJobOnce) để giữ đúng hình dạng dữ liệu. ──
export type BulkJobType = "send_message" | "add_friend" | "invite_group";
export type BulkJobStatus = "pending" | "running" | "paused" | "cancelled" | "completed";

export type BulkJob = {
  id: number;
  account_id: string;
  /** Cột cũ — nay chỉ còn ý nghĩa hiển thị/tương thích ngược, = actions[0]. */
  job_type: BulkJobType;
  /** Nguồn thật worker dùng để quyết định chạy hành động nào — có thể kết
   * hợp nhiều hành động trong 1 job (vd ["send_message","invite_group"]).
   * Rỗng ở job tạo trước khi có tính năng này — worker tự fallback [job_type]. */
  actions: BulkJobType[];
  status: BulkJobStatus;
  message: string | null;
  /** Nội dung RIÊNG cho hành động "Kết bạn" — tách khỏi `message`. */
  friend_message: string | null;
  image_urls: string[];
  /** Cột cũ (1 nhóm) — nay chỉ còn ý nghĩa hiển thị/tương thích ngược, = target_group_ids?.[0]. */
  target_group_id: string | null;
  target_group_name: string | null;
  /** Nguồn thật khi mời nhiều nhóm cùng lúc — rỗng/null ở job tạo trước tính năng này. */
  target_group_ids?: Array<{ id: string; name: string | null }> | null;
  /** Tối đa số tin/ngày (1-15) — null = không giới hạn. Đạt giới hạn thì
   * worker tự dừng, hôm sau tự chạy tiếp phần còn lại (xem MAX_DAILY_LIMIT ở
   * worker/automationWorker.js). */
  daily_limit?: number | null;
  sent_today?: number;
  sent_today_date?: string | null;
  delay_seconds_min: number;
  delay_seconds_max: number;
  total_count: number;
  sent_count: number;
  success_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  scheduled_at?: string | null;
};

export type BulkJobItemStatus = "pending" | "sent" | "failed" | "not_found" | "skipped";

export type BulkJobItem = {
  id: number;
  job_id: number;
  /** null khi item đến từ "Quét thành viên nhóm" (chỉ có uid, không có SĐT). */
  phone: string | null;
  uid: string | null;
  display_name: string | null;
  status: BulkJobItemStatus;
  error: string | null;
  processed_at: string | null;
};
