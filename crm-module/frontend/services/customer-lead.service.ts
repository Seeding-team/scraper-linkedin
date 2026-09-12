import { API_BASE_URL, API_KEY } from "@/lib/env";

/* =============================================================
   CRM Customer Interface — full schema
   ============================================================= */

export type ContractStatus =
  | "active"
  | "completed"
  | "maintenance"
  | "da_bao_gia"
  | "dang_xu_ly"
  | "da_chot";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type ActivityStatus = "active" | "paused" | "churned";
export type LeadStatus = "pending" | "closed" | "rejected";
export type ReviewResult = "Qualify" | "Disqualify" | "Chua_xem_xet";
export type SourcePlatform = "FB_Inbox" | "FB_Group" | "Zalo" | "Manual";
export type RejectReasonType =
  | "Khong_lien_lac_duoc"
  | "Chua_co_nhu_cau"
  | "Cham_trai_nghiem"
  | "Thieu_nhan_su"
  | "Chia_tay_doi_tac_cu"
  | "Khong_du_tai_chinh"
  | "Chua_phu_hop_thoi_diem"
  | "Khac";

/* =============================================================
   CRM Sales Pipeline (state machine theo quy tắc nghiệp vụ)
   ---------------------------------------------------------------
   1. New Lead            → Contacted | Lost
   2. Contacted           → Qualified | On Hold | Lost
   3. Qualified           → Requirement Gathering | On Hold | Lost
   4. Requirement Gathering → Proposal Sent | On Hold | Lost
   5. Proposal Sent       → Negotiation | On Hold | Lost
   6. Negotiation         → Contract Sent | On Hold | Lost
   7. Contract Sent       → Won | Lost (không quay về Negotiation trừ khi On Hold trước)
   8. On Hold             → Quay lại stage trước | Lost
   9. Won                 → terminal
   10. Lost               → terminal (bất kỳ stage nào trừ Won đều có thể vào Lost)
   ============================================================= */

export type DealStage =
  | "new_lead"
  | "contacted"
  | "qualified"
  | "requirement"
  | "proposal_sent"
  | "negotiation"
  | "contract_sent"
  | "on_hold"
  | "won"
  | "lost";

/**
 * Stage rời/rớt hợp lệ cho stage hiện tại (khi kéo-thả / chọn stage mới).
 *
 * Lưu ý nghiệp vụ: KHÔNG PHẢI mọi khách đều cần qua `requirement`. Có 2 nhánh:
 *
 *   Nhánh "CÓ BRIEF RIÊNG" (custom package, khách có yêu cầu riêng):
 *     qualified → requirement → proposal_sent
 *
 *   Nhánh "GÓI CÓ SẴN" (standard package, khách đăng ký template):
 *     contacted hoặc qualified → proposal_sent (NHẢY CÓC qua requirement)
 *
 * → Để giảm tải thao tác, `contacted` và `qualified` được phép skip thẳng
 *   sang `proposal_sent`. `requirement` vẫn là stage hợp lệ nếu khách
 *   thực sự cần thu thập brief (kéo từ qualified sang requirement như cũ).
 */
const ALL_STAGES: DealStage[] = [
  "new_lead", "contacted", "qualified", "requirement",
  "proposal_sent", "negotiation", "contract_sent",
  "on_hold", "won", "lost"
];

export const DEAL_STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  new_lead:       ALL_STAGES.filter(s => s !== "new_lead"),
  contacted:      ALL_STAGES.filter(s => s !== "contacted"),
  qualified:      ALL_STAGES.filter(s => s !== "qualified"),
  requirement:    ALL_STAGES.filter(s => s !== "requirement"),
  proposal_sent:  ALL_STAGES.filter(s => s !== "proposal_sent"),
  negotiation:    ALL_STAGES.filter(s => s !== "negotiation"),
  contract_sent:  ALL_STAGES.filter(s => s !== "contract_sent"),
  on_hold:        ALL_STAGES.filter(s => s !== "on_hold"),
  won:            [], // terminal
  lost:           [], // terminal
};

/** Stage terminal — không cho phép đổi tiếp bằng drag thường, chỉ "reopen" qua quy trình riêng. */
export const TERMINAL_STAGES: DealStage[] = ["won", "lost"];

/** Stage trung gian có thể tạm dừng. */
export const PAUSABLE_FROM: DealStage[] = [
  "contacted",
  "qualified",
  "requirement",
  "proposal_sent",
  "negotiation",
  "contract_sent",
];

/** Field bắt buộc đi kèm khi chuyển sang stage mới (để lưu thành công). */
export interface StageRequirements {
  /** Note buộc phải có (VD: ghi chú buổi liên hệ, điều khoản đàm phán). */
  requireNote?: boolean;
  /** Buộc phải có số điện thoại / liên hệ. */
  requireContact?: boolean;
  /** Buộc phải có file / link đính kèm (proposal, brief, contract). */
  requireAttachment?: boolean;
  /** Buộc phải chọn lý do từ dropdown cố định. */
  requireRejectReason?: boolean;
  /** Buộc phải có ngân sách dự kiến (chỉ qualified). */
  requireBudget?: boolean;
  /** Buộc phải có người quyết định (chỉ qualified). */
  requireDecisionMaker?: boolean;
  /** Ngày chuyển stage (để tracking thời gian trung bình). */
  trackTransitionDate?: boolean;
}

export const STAGE_REQUIREMENTS: Record<DealStage, StageRequirements> = {
  new_lead:       { requireContact: false, trackTransitionDate: true },
  contacted:      { requireNote: true, trackTransitionDate: true },
  qualified:      { requireNote: true, requireBudget: true, requireDecisionMaker: true, trackTransitionDate: true },
  requirement:    { requireNote: true, requireAttachment: true, trackTransitionDate: true },
  proposal_sent:  { requireAttachment: true, trackTransitionDate: true },
  negotiation:    { requireNote: true, trackTransitionDate: true },
  contract_sent:  { requireAttachment: true, trackTransitionDate: true },
  on_hold:        { requireNote: true, trackTransitionDate: true },
  won:            { trackTransitionDate: true },
  lost:           { requireNote: true, requireRejectReason: true, trackTransitionDate: true },
};

/** Lý do Lost — cố định (KHÔNG cho nhập tự do) theo yêu cầu nghiệp vụ. */
export const LOST_REASON_OPTIONS: { value: RejectReasonType; label: string }[] = [
  { value: "Khong_lien_lac_duoc",     label: "Không liên lạc được (im lặng)" },
  { value: "Chua_co_nhu_cau",         label: "Khách chưa có nhu cầu" },
  { value: "Khong_du_tai_chinh",      label: "Không đủ ngân sách / tài chính" },
  { value: "Chua_phu_hop_thoi_diem",  label: "Chưa phù hợp thời điểm" },
  { value: "Cham_trai_nghiem",        label: "Trải nghiệm không tốt" },
  { value: "Thieu_nhan_su",           label: "Thiếu nhân sự phụ trách" },
  { value: "Chia_tay_doi_tac_cu",     label: "Chia tay đối tác cũ / không còn hợp tác" },
  { value: "Khac",                    label: "Khác (ghi rõ trong ghi chú)" },
];

export const DEAL_STAGE_META: Record<
  DealStage,
  { label: string; description: string; color: string; ringClass: string; headerClass: string; badgeClass: string; order: number }
> = {
  new_lead: {
    label: "Khách mới",
    description: "Deal mới - chưa có tương tác",
    color: "#3b82f6",
    ringClass: "ring-blue-500/40",
    headerClass: "bg-blue-500",
    badgeClass: "bg-blue-100 text-blue-700 border-blue-200",
    order: 1,
  },
  contacted: {
    label: "Đã liên hệ",
    description: "Đã liên hệ ít nhất 1 lần",
    color: "#6366f1",
    ringClass: "ring-indigo-500/40",
    headerClass: "bg-indigo-500",
    badgeClass: "bg-indigo-100 text-indigo-700 border-indigo-200",
    order: 2,
  },
  qualified: {
    label: "Đủ điều kiện",
    description: "Có nhu cầu, ngân sách, người quyết định",
    color: "#8b5cf6",
    ringClass: "ring-violet-500/40",
    headerClass: "bg-violet-500",
    badgeClass: "bg-violet-100 text-violet-700 border-violet-200",
    order: 3,
  },
  requirement: {
    label: "Lấy yêu cầu",
    description: "Đang thu thập brief/yêu cầu",
    color: "#a855f7",
    ringClass: "ring-purple-500/40",
    headerClass: "bg-purple-500",
    badgeClass: "bg-purple-100 text-purple-700 border-purple-200",
    order: 4,
  },
  proposal_sent: {
    label: "Đã báo giá",
    description: "Đã gửi báo giá chính thức",
    color: "#f59e0b",
    ringClass: "ring-amber-500/40",
    headerClass: "bg-amber-500",
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
    order: 5,
  },
  negotiation: {
    label: "Đàm phán",
    description: "Đang đàm phán điều khoản",
    color: "#ea580c",
    ringClass: "ring-orange-500/40",
    headerClass: "bg-orange-500",
    badgeClass: "bg-orange-100 text-orange-700 border-orange-200",
    order: 6,
  },
  contract_sent: {
    label: "Đã gửi hợp đồng",
    description: "Đã gửi hợp đồng chờ ký",
    color: "#0ea5e9",
    ringClass: "ring-sky-500/40",
    headerClass: "bg-sky-500",
    badgeClass: "bg-sky-100 text-sky-700 border-sky-200",
    order: 7,
  },
  on_hold: {
    label: "Tạm dừng",
    description: "Tạm dừng - không phải step chính",
    color: "#64748b",
    ringClass: "ring-slate-500/40",
    headerClass: "bg-slate-500",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    order: 8,
  },
  won: {
    label: "Hoàn thành",
    description: "Đã ký hợp đồng - terminal",
    color: "#16a34a",
    ringClass: "ring-green-500/40",
    headerClass: "bg-green-600",
    badgeClass: "bg-green-100 text-green-800 border-green-300",
    order: 9,
  },
  lost: {
    label: "Từ chối",
    description: "Rớt - terminal, không đổi tiếp",
    color: "#dc2626",
    ringClass: "ring-red-500/40",
    headerClass: "bg-red-600",
    badgeClass: "bg-red-100 text-red-800 border-red-300",
    order: 10,
  },
};

/** Pipeline view — 8 cột hiển thị trên Kanban (Won/Lost tách riêng cuối). */
export const PIPELINE_COLUMNS: DealStage[] = [
  "new_lead",
  "contacted",
  "qualified",
  "requirement",
  "proposal_sent",
  "negotiation",
  "contract_sent",
  "on_hold",
];

/** Một dòng activity log (audit trail). */
export interface ActivityLogEntry {
  id: string;
  customer_id: string;
  action: string;            // "stage_change" | "note_added" | "created" | "attachment_added" | ...
  from_stage?: DealStage;
  to_stage?: DealStage;
  field?: string;
  old_value?: string | null;
  new_value?: string | null;
  actor?: string;
  actor_id?: string;
  note?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  created_at: string;
}

/** Payload gửi khi chuyển stage (gom cả required fields + audit log). */
export interface StageTransitionPayload {
  to_stage: DealStage;
  note?: string;
  attachment_url?: string;
  attachment_name?: string;
  reject_reason_type?: RejectReasonType;
  reject_reason_text?: string;
  prev_stage?: DealStage;
  follow_up_date?: string; // cho on_hold
  decision_maker?: string; // cho qualified
  estimated_budget?: number; // cho qualified
}

export interface Customer {
  id: string;
  customer_name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  website: string | null;
  industry: string | null;
  tax_code: string | null;
  leaded_by: string | null;
  conv_id: string | null;
  source_platform: SourcePlatform;
  is_assigned: boolean;
  sdr_id: string | null;
  status: LeadStatus;
  activity_status: ActivityStatus;
  // ── CRM Pipeline mở rộng theo quy tắc nghiệp vụ ──────────
  /** Stage trong pipeline bán hàng (ưu tiên dùng cái này cho Kanban). */
  deal_stage?: DealStage | null;
  /** Stage trước khi vào On Hold, để khi resume quay lại đúng chỗ. */
  prev_stage?: DealStage | null;
  /** Ngày dự kiến follow-up lại (cho On Hold / follow-up reminders). */
  follow_up_date?: string | null;
  /** Người ra quyết định cuối cùng. */
  decision_maker?: string | null;
  /** Ngân sách dự kiến (qualified). */
  estimated_budget?: number | null;
  /** Ngày vào stage hiện tại (track time-in-stage). */
  stage_entered_at?: string | null;
  /** Số ngày đã nằm ở stage hiện tại (server-side tính hoặc fallback client). */
  days_in_stage?: number | null;
  customer_since: string | null;
  service_package: string | null;
  lifetime_value: number | null;
  contract_signed_at: string | null;
  contract_status: ContractStatus;
  warranty_expires_at: string | null;
  care_note: string | null;
  last_care_at: string | null;
  /** Ngày khách hàng cần thanh toán (hạn thu tiền kỳ hiện tại/tiếp theo). */
  payment_due_date?: string | null;
  /** unpaid (chưa thanh toán) | partial (một phần) | paid (đã thanh toán đủ). */
  payment_status?: PaymentStatus | null;
  last_attachment_url?: string | null;
  last_attachment_name?: string | null;
  tags: string[];
  has_budget: boolean;
  note: string | null;
  reject_reason: string | null;
  reject_reason_type: RejectReasonType | null;
  review_result: ReviewResult | null;
  created_at: string;
  updated_at: string;
  leader_name?: string | null;
  sdr_name?: string | null;
  team_name?: string | null;
  team_type?: string | null;
}

export interface CustomerListResponse {
  items: Customer[];
  total: number;
  page: number;
  page_size: number;
}

export interface SDRUser {
  id: string;
  name: string;
  role: string;
}

/* =============================================================
   Option lists (from UI screenshots)
   ============================================================= */

export const SOURCE_PLATFORM_OPTIONS: { value: SourcePlatform; label: string }[] = [
  { value: "FB_Inbox", label: "FB Inbox" },
  { value: "FB_Group", label: "FB Group" },
  { value: "Zalo", label: "Zalo" },
  { value: "Manual", label: "Nhập tay" },
];

// 3 gói dịch vụ chính — dropdown trong form thêm/sửa lead. Optional.
// Khớp với cột `service_package TEXT` trong bảng customer_leads.
export const SERVICE_PACKAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "Goi_co_ban",       label: "Gói Cơ bản" },
  { value: "Goi_doanh_nghiep", label: "Gói Doanh nghiệp" },
  { value: "Goi_premium",      label: "Gói Premium" },
];

export const INDUSTRY_OPTIONS = [
  "Kinh doanh bất động sản",
  "Kinh doanh ô tô",
  "Kinh doanh thời trang",
  "Kinh doanh mỹ phẩm",
  "Kinh doanh thực phẩm",
  "Kinh doanh điện máy / điện thoại",
  "Kinh doanh nội thất / trang trí",
  "Kinh doanh nha khoa",
  "Kinh doanh phòng khám / bệnh viện",
  "Kinh doanh giáo dục / đào tạo",
  "Kinh doanh logistics / vận chuyển",
  "Kinh doanh du lịch / lữ hành",
  "Kinh doanh tài chính / bảo hiểm",
  "Kinh doanh phần mềm / CNTT",
  "Kinh doanh xây dựng / nội thất",
  "Kinh doanh khác",
];

export const CITY_OPTIONS = [
  "Hà Nội",
  "Hồ Chí Minh",
  "Đà Nẵng",
  "Hải Phòng",
  "Cần Thơ",
  "An Giang",
  "Bà Rịa – Vũng Tàu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bạc Liêu",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Định",
  "Bình Dương",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cao Bằng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Tĩnh",
  "Hải Dương",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên Huế",
  "Tiền Giang",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

export const PAYMENT_STATUS_OPTIONS: {
  value: PaymentStatus;
  label: string;
  badgeClass: string;
}[] = [
  { value: "unpaid", label: "Chưa thanh toán", badgeClass: "bg-red-100 text-red-700 border-red-200" },
  { value: "partial", label: "Thanh toán một phần", badgeClass: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "paid", label: "Đã thanh toán", badgeClass: "bg-green-100 text-green-700 border-green-200" },
];

export const HAS_BUDGET_OPTIONS: { value: boolean; label: string }[] = [
  { value: true, label: "Có ngân sách" },
  { value: false, label: "Chưa có ngân sách" },
];

export const CARE_NOTE_OPTIONS = [
  "Gọi lại sau 1 tuần",
  "Gọi lại sau 2 tuần",
  "Gọi lại sau 1 tháng",
  "Gửi báo giá qua email",
  "Gửi báo giá qua Zalo",
  "Hẹn gặp trực tiếp",
  "Chuyển nhân sự phụ trách",
  "Gia hạn hợp đồng",
  "Tư vấn upsell",
  "Theo dõi bảo hành",
  "Đã chốt đơn",
  "Khách từ chối — theo dõi lại sau",
];

/** @deprecated Dùng LOST_REASON_OPTIONS — cùng giá trị, đã gộp về 1 nguồn nhãn duy nhất. */
export const REJECT_REASON_TYPE_OPTIONS = LOST_REASON_OPTIONS;

export const REVIEW_RESULT_OPTIONS: { value: ReviewResult; label: string }[] = [
  { value: "Qualify", label: "Qualify ✓" },
  { value: "Disqualify", label: "Disqualify ✗" },
  { value: "Chua_xem_xet", label: "Chưa xem xét" },
];

/* =============================================================
   API helpers
   ============================================================= */

function getDefaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  return headers;
}

async function apiFetch(path: string, options?: RequestInit, retries: number = 1): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        credentials: "include",
        headers: getDefaultHeaders(),
        ...options,
      });
      const data = await res.json();
      // HTTP loi that (401/500/503...) khac voi "success:false" nghiep vu (van la 200) -
      // truoc day bi nuot am tham thanh du lieu rong, nhin giong "trang trong, F5 lai co".
      if (!res.ok) {
        throw new Error(data?.message || data?.detail || `Loi may chu (${res.status})`);
      }
      return data;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Mat ket noi toi may chu");
}

export const customerLeadService = {
  getAll: async (params?: {
    search?: string;
    status?: string;
    deal_stage?: string;
    city?: string;
    industry?: string;
    source_platform?: string;
    exclude_terminal?: boolean;
    page?: number;
    page_size?: number;
  }): Promise<CustomerListResponse> => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.deal_stage) q.set("deal_stage", params.deal_stage);
    if (params?.city) q.set("city", params.city);
    if (params?.industry) q.set("industry", params.industry);
    if (params?.source_platform) q.set("source_platform", params.source_platform);
    if (params?.exclude_terminal) q.set("exclude_terminal", "true");
    if (params?.page) q.set("page", String(params.page));
    if (params?.page_size) q.set("page_size", String(params.page_size));
    const qs = q.toString() ? `?${q.toString()}` : "";
    const data = await apiFetch(`/api/all-platform/customer-leads${qs}`);
    // success:false van la HTTP 200 (BaseResponse) nen apiFetch khong tu throw —
    // truoc day rot xuong fallback {items:[]} lang le, nhin giong "khong co khach
    // hang nao" thay vi loi that (vd schema mismatch tren 1 Supabase project khac).
    if (data?.success === false) {
      throw new Error(data?.message || "Không tải được danh sách khách hàng");
    }
    return data?.data as CustomerListResponse ?? { items: [], total: 0, page: 1, page_size: 50 };
  },

  /** Số deal ở mỗi stage — cho header KPI / tab counts. */
  getStageCounts: async (): Promise<Record<string, number>> => {
    const data = await apiFetch(`/api/all-platform/customer-leads/stage-counts`);
    if (data?.success === false) {
      throw new Error(data?.message || "Không tải được số liệu theo stage");
    }
    return data?.data ?? {};
  },

  getByConvId: async (convId: string): Promise<Customer | null> => {
    const data = await apiFetch(`/api/all-platform/customer-leads/by-conv/${encodeURIComponent(convId)}`);
    return data?.data ?? null;
  },

  getSdrs: async (): Promise<SDRUser[]> => {
    const data = await apiFetch(`/api/all-platform/customer-leads/sdrs`);
    return (data?.data as SDRUser[]) ?? [];
  },

  create: async (payload: Partial<Customer>): Promise<any> => {
    return apiFetch("/api/all-platform/customer-leads", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  update: async (id: string, payload: Partial<Customer>): Promise<any> => {
    return apiFetch(`/api/all-platform/customer-leads/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  delete: async (id: string): Promise<any> => {
    return apiFetch(`/api/all-platform/customer-leads/${id}`, {
      method: "DELETE",
    });
  },

  /**
   * Upload 1 file đính kèm lên Supabase Storage (qua backend) trước khi gọi
   * transition. Trả về `{ url, name, size, content_type }`. Caller dán `url`
   * vào `attachment_url` của payload transition.
   *
   * Prefix:
   *   - "requirement" stage (need brief)        → prefix = "brief"
   *   - "proposal_sent" stage                    → prefix = "proposal"
   *   - "contract_sent" stage                    → prefix = "contract"
   */
  uploadAttachment: async (
    file: File,
    prefix: "brief" | "proposal" | "contract" | "logo",
    customerId?: string,
  ): Promise<{ url: string; name: string; size: number; content_type: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("prefix", prefix);
    if (customerId) fd.append("customer_id", customerId);

    const headers: Record<string, string> = {};
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    // QUAN TRỌNG: KHÔNG set Content-Type thủ công cho FormData — browser tự
    // thêm boundary. Set thủ công sẽ phá multipart parsing bên server.
    const res = await fetch(`${API_BASE_URL}/api/all-platform/customer-leads/upload`, {
      method: "POST",
      credentials: "include",
      headers,
      body: fd,
    });
    const data = await res.json();
    if (!data?.success) {
      throw new Error(data?.message || "Upload thất bại");
    }
    return data.data as { url: string; name: string; size: number; content_type: string };
  },

  /**
   * Chuyển stage CRM cho 1 deal — server sẽ validate + ghi log.
   * Trả về { success, data?, message?, missing_fields? }.
   * Backend đã map sang /api/all-platform/customer-leads/{id}/transition.
   */
  transitionStage: async (id: string, payload: StageTransitionPayload): Promise<any> => {
    return apiFetch(`/api/all-platform/customer-leads/${id}/transition`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** Lấy activity log cho 1 deal (audit trail: stage changes, notes…). */
  getActivityLog: async (
    id: string,
    params?: { limit?: number; offset?: number },
  ): Promise<{ items: ActivityLogEntry[]; total: number }> => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString() ? `?${q.toString()}` : "";
    const data = await apiFetch(`/api/all-platform/customer-leads/${id}/activity-log${qs}`);
    return data?.data ?? { items: [], total: 0 };
  },
};
