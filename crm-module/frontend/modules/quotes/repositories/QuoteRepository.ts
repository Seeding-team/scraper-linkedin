import type {
  CreateIssuerCompanyInput,
  CreateQuoteFormInput,
  CreateQuoteInput,
  IssuerCompany,
  Quote,
  QuoteActivityLogEntry,
  QuoteForm,
  QuoteHandoffChecklist,
  QuoteProcessingStage,
  QuoteTelegramLog,
  QuoteVersionResult,
  UpdateIssuerCompanyInput,
  UpdateQuoteFormInput,
  UpdateQuoteHandoffChecklistInput,
  UpdateQuoteInput,
} from '../types';
import type { ServiceCatalogOptions } from '../../service-catalog/types';

export interface QuoteRepository {
  getForms(): Promise<QuoteForm[]>;
  getForm(id: string): Promise<QuoteForm>;
  getPublicForm(token: string): Promise<QuoteForm>;
  createForm(input: CreateQuoteFormInput): Promise<QuoteForm>;
  updateForm(id: string, input: UpdateQuoteFormInput): Promise<QuoteForm>;
  deleteForm(id: string): Promise<{ deleted: boolean; archived: boolean; form?: QuoteForm }>;
  duplicateForm(id: string): Promise<QuoteForm>;
  shareForm(id: string, enabled?: boolean): Promise<QuoteForm>;

  getQuotes(): Promise<Quote[]>;
  getQuote(id: string): Promise<Quote>;
  getPublicQuote(token: string, email?: string): Promise<Quote>;
  createQuote(input: CreateQuoteInput): Promise<Quote>;
  updateQuote(id: string, input: UpdateQuoteInput): Promise<Quote>;
  deleteQuote(id: string): Promise<void>;
  /** Duyệt báo giá — khoá chỉnh sửa vĩnh viễn, sinh public link. */
  approveQuote(id: string, exceptionReason?: string): Promise<Quote>;
  /** Lưu thay đổi cuối + duyệt atomic (dùng khi bấm "Duyệt báo giá" trong modal đang sửa). */
  updateAndApproveQuote(id: string, input: UpdateQuoteInput, exceptionReason?: string): Promise<Quote>;
  /** Tạo phiên bản mới (V2/V3...) từ bản ĐÃ DUYỆT mới nhất trong chuỗi của
   * id được truyền vào — có thể redirect (created=false, trả về bản nháp có
   * sẵn) hoặc nguồn copy thật khác id được bấm (redirectedFromClickedQuote). */
  createQuoteVersion(id: string): Promise<QuoteVersionResult>;
  /** Toàn bộ phiên bản (V1..Vn) cùng chuỗi với id này, mới nhất trước. */
  getQuoteVersions(id: string): Promise<Quote[]>;

  /** Danh mục dịch vụ liên kết với 1 mẫu báo giá (danh sách id nhóm). */
  getFormCatalogLinks(formId: string): Promise<string[]>;
  setFormCatalogLinks(formId: string, catalogItemIds: string[]): Promise<string[]>;
  /** Gói bán + dịch vụ thành phần khả dụng cho 1 mẫu báo giá, dùng dựng dropdown khi điền báo giá. */
  getServiceCatalogOptions(formId: string): Promise<ServiceCatalogOptions>;

  /** Danh sách công ty phát hành báo giá (bên bán) — dropdown "Đơn vị phát hành
   * báo giá" ở Bước 1 wizard tạo báo giá. includeInactive=true dùng cho trang
   * quản trị danh mục công ty. */
  getIssuerCompanies(includeInactive?: boolean): Promise<IssuerCompany[]>;
  createIssuerCompany(input: CreateIssuerCompanyInput): Promise<IssuerCompany>;
  updateIssuerCompany(id: string, input: UpdateIssuerCompanyInput): Promise<IssuerCompany>;

  /** Gửi 1 báo giá ĐÃ DUYỆT qua Telegram (group/topic cố định, cấu hình ở backend). */
  sendQuoteTelegram(quoteId: string): Promise<QuoteTelegramLog>;
  /** Lịch sử gửi Telegram của 1 báo giá, mới nhất trước. */
  getQuoteTelegramLog(quoteId: string): Promise<QuoteTelegramLog[]>;

  /** Phase 2 "Workspace xử lý báo giá" (migration 085). Chuyển bước xử lý nội
   * bộ — chỉ tiến, chỉ áp dụng khi status='draft' (RPC tự chặn ở backend). */
  setQuoteProcessingStage(quoteId: string, stage: QuoteProcessingStage): Promise<Quote>;
  /** Gán người phụ trách kỹ thuật/báo giá — field không truyền = không đổi,
   * truyền `null` = bỏ gán. */
  assignQuoteOwners(quoteId: string, input: { technicalOwnerId?: string | null; quoteOwnerId?: string | null }): Promise<Quote>;
  getQuoteHandoffChecklist(quoteId: string): Promise<QuoteHandoffChecklist>;
  saveQuoteHandoffChecklist(quoteId: string, input: UpdateQuoteHandoffChecklistInput): Promise<QuoteHandoffChecklist>;
  /** Lịch sử hoạt động thật (created/updated/approved/version_created/
   * stage_changed/handoff_updated/owner_assigned), mới nhất trước. */
  getQuoteActivityLog(quoteId: string): Promise<QuoteActivityLogEntry[]>;
  /** Ghi lý do tạo phiên bản (popup "Tạo phiên bản mới") vào activity log —
   * gọi SAU KHI version mới đã tạo xong, gắn vào id của bản MỚI. */
  logQuoteVersionReason(quoteId: string, reason: string): Promise<QuoteActivityLogEntry[]>;

  // ── Phase 1/3 lifecycle (migration 087/089) ──────────────────────────────
  /** Huỷ báo giá (không hard-delete) — bắt buộc lý do, tự tắt public link. */
  cancelQuote(quoteId: string, reason: string): Promise<Quote>;
  /** Huỷ công khai — tắt public link, KHÔNG xoá quote. */
  revokePublicQuote(quoteId: string): Promise<Quote>;
  /** Mở lại link báo giá — chiều ngược của revokePublicQuote(), giữ nguyên public_token cũ. */
  enablePublicQuote(quoteId: string): Promise<Quote>;
  /** Giới hạn xem link công khai theo danh sách email cụ thể của quote này. */
  setPublicEmailGate(quoteId: string, enabled: boolean, allowedEmails: string[]): Promise<Quote>;
  /** Xoá mềm — khôi phục được qua restoreQuote(). */
  softDeleteQuote(quoteId: string, reason?: string): Promise<Quote>;
  restoreQuote(quoteId: string): Promise<Quote>;
  /** Yêu cầu chỉnh sửa (Phase 3) — trả báo giá đang ở 'review' lùi về
   * 'technical' hoặc 'pricing', bắt buộc lý do. */
  requestQuoteChanges(quoteId: string, targetStage: 'technical' | 'pricing', reason: string): Promise<Quote>;
  /** Phát hành báo giá đã duyệt (tách riêng khỏi approve) — sinh/bật public
   * link thật, processingStage -> 'published'. */
  publishQuote(quoteId: string): Promise<Quote>;

  // ── Gửi báo giá qua email (migration 093) ────────────────────────────────
  /** Gợi ý người nhận (ưu tiên deal.email, rồi crm_customers.email) — có thể
   * rỗng, không đoán. */
  getQuoteRecipientSuggestion(quoteId: string): Promise<{ name: string | null; email: string | null; source: string | null }>;
  /** Kênh gửi email đã sẵn sàng chưa (không lộ host/port/email kỹ thuật) —
   * dùng để bật/tắt nút "Gửi khách hàng", gọi được bởi bất kỳ ai có quyền
   * gửi báo giá này (không chỉ Admin/Leader). */
  getQuoteSendAvailability(quoteId: string): Promise<{ available: boolean; reason: string | null }>;
  /** Lịch sử gửi email của báo giá, mới nhất trước. */
  getQuoteDeliveryLog(quoteId: string): Promise<QuoteDeliveryLogEntry[]>;
  /** Gửi báo giá THẬT qua email — idempotencyKey chống double-submit. */
  sendQuoteEmail(quoteId: string, input: SendQuoteEmailInput): Promise<QuoteDeliveryLogEntry>;

  // ── Rule engine duyệt báo giá (migration 091) ────────────────────────────
  /** Bộ quy tắc đang active — null nếu chưa cấu hình (mọi người xem được). */
  getActiveQuoteApprovalRuleSet(): Promise<QuoteApprovalRuleSet | null>;
  /** Lưu bộ quy tắc mới — LUÔN tạo version mới, chỉ Admin/Leader (403 nếu không). */
  saveQuoteApprovalRuleSet(input: SaveQuoteApprovalRuleSetInput): Promise<QuoteApprovalRuleSet>;
  /** Đánh giá lại rule engine cho 1 báo giá cụ thể (không đổi trạng thái, chỉ ghi snapshot mới). */
  evaluateQuoteRules(quoteId: string): Promise<QuoteRuleEvaluation | null>;
  /** Snapshot đánh giá GẦN NHẤT đã lưu cho báo giá này. */
  getQuoteRuleEvaluation(quoteId: string): Promise<QuoteRuleEvaluation | null>;
}

export type QuoteApprovalRuleType = 'gross_margin_percent' | 'gross_profit_amount' | 'discount_percent' | 'payment_terms_days';

export interface QuoteApprovalRule {
  ruleType: QuoteApprovalRuleType;
  operator: 'gte' | 'lte' | 'gt' | 'lt' | 'eq';
  thresholdValue: number;
  unit: 'percent' | 'vnd' | 'days';
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
}

export interface QuoteApprovalRuleSet {
  id: string;
  name: string;
  version: number;
  autoApproveEnabled: boolean;
  rules: QuoteApprovalRule[];
}

export interface SaveQuoteApprovalRuleSetInput {
  rules: { ruleType: QuoteApprovalRuleType; thresholdValue: number; isRequired?: boolean; isActive?: boolean }[];
  autoApproveEnabled: boolean;
  /** Chong double-submit - cung key goi lai (double-click/network retry) tra ve DUNG ban da tao, khong tao them version. */
  idempotencyKey: string;
}

export interface QuoteRuleEvaluationDetail {
  ruleType: QuoteApprovalRuleType;
  label: string;
  actualValue: number | null;
  actualDisplay: string;
  threshold: number;
  thresholdDisplay: string;
  operator: string;
  isRequired: boolean;
  status: 'pass' | 'fail' | 'insufficient_data';
  reason: string;
}

export interface QuoteRuleEvaluation {
  ruleSetId: string;
  ruleSetName: string;
  ruleSetVersion: number;
  autoApproveEnabled?: boolean;
  result: 'pass' | 'fail' | 'insufficient_data';
  details: QuoteRuleEvaluationDetail[];
  evaluatedAt?: string;
  isSystemActor?: boolean;
}

export interface SendQuoteEmailInput {
  recipientName?: string | null;
  recipientEmail: string;
  recipientSource?: string | null;
  subject?: string | null;
  message?: string;
  attachPdf?: boolean;
  idempotencyKey: string;
}

export interface QuoteDeliveryLogEntry {
  id: string;
  quoteId: string;
  quoteVersion?: number | null;
  channel: string;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientSource?: string | null;
  subject?: string | null;
  status: "queued" | "sending" | "sent" | "failed";
  attemptCount?: number | null;
  errorMessage?: string | null;
  requestedAt?: string | null;
  requestedById?: string | null;
  sentAt?: string | null;
}
