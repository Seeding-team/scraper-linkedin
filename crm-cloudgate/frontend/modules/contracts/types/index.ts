export type ContractStatus =
  | 'draft'
  | 'pending_legal'
  | 'pending_signature'
  | 'signed'
  | 'active'
  | 'completed'
  | 'expiring'
  | 'expired'
  | 'terminated';

export type ContractTemplateType = 'service' | 'principle' | 'marketing';

export interface ContractClause {
  id?: string;
  title: string;
  body: string;
}

export interface ContractReviewFinding {
  severity: 'ok' | 'warn';
  title: string;
  detail: string;
}

export interface Contract {
  id: string;
  contractNumber: string;
  dealId?: string | null;
  dealCustomerName?: string | null;
  dealCompanyName?: string | null;
  /** Khách hàng CRM thật (crm_customers.id) — dùng khi hợp đồng không gắn
   * deal nhưng vẫn chọn được 1 khách hàng có sẵn. */
  customerId?: string | null;
  /** Tên khách hàng nhập tay — fallback khi khách hàng chưa tồn tại trong CRM. */
  manualCustomerName?: string | null;
  quoteId?: string | null;
  title: string;
  /** Khoá cũ (service/principle/marketing) HOẶC nhãn tự do do người dùng/AI đặt (vd 'Hợp đồng cung cấp thiết bị'). */
  templateType: ContractTemplateType | string;
  status: ContractStatus;
  contractValue: number;
  currency: string;
  startDate?: string | null;
  endDate?: string | null;
  signedAt?: string | null;
  paymentTerms?: string;
  /** Tiến độ thực hiện hợp đồng (0-100), hiện dạng progress bar ở danh sách. */
  progressPercent: number;
  /** % giá trị hợp đồng đã thu, dùng tính "Công nợ đến hạn" ở dashboard. */
  paymentCollectedPercent: number;
  ownerId?: string | null;
  ownerName?: string | null;
  clauses: ContractClause[];
  aiGenerated: boolean;
  aiRiskScore?: number | null;
  aiReview: ContractReviewFinding[];
  aiPrompt?: string | null;
  version: number;
  createdById?: string | null;
  updatedById?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Migration 136 — "Ghi nhận hợp đồng có sẵn" (hợp đồng ký/tạo bên ngoài
   * CRM, không phải wizard/manual tạo mới trong CRM). 'crm' = tạo trong CRM
   * (mặc định, mọi hợp đồng trước migration này đều thuộc loại này). */
  source: 'crm' | 'external';
  fileUrl?: string | null;
  note?: string | null;
  /** Migration 162 — "Hợp đồng báo giá mua (Phase 1)" / "bán (Phase 2)" tạo
   * từ form Sửa Deal (CrmCustomerModal.tsx). null cho mọi hợp đồng tạo từ
   * luồng khác (wizard CRM, Ghi nhận hợp đồng có sẵn độc lập). */
  dealPhase?: 'purchase' | 'sale' | null;
  /** Migration 167 — người liên hệ chọn trên hợp đồng (null = liên hệ chính của deal). */
  contactId?: string | null;
}

export interface ContractDashboardStats {
  activeCount: number;
  activeValue: number;
  pendingSignatureCount: number;
  expiringCount: number;
  expiringValue: number;
  outstandingValue: number;
  outstandingCount: number;
}

export interface CreateContractInput {
  /** Tên viết tắt công ty dùng cho mã hợp đồng ({SHORT}); chỉ để sinh số. */
  numberShort?: string | null;
  /** Chỉ dùng cho "Ghi nhận hợp đồng có sẵn" (hợp đồng bên ngoài đã có số
   * riêng) - bỏ trống thì backend tự sinh số như mọi luồng tạo khác. */
  contractNumber?: string | null;
  dealId?: string | null;
  customerId?: string | null;
  manualCustomerName?: string | null;
  quoteId?: string | null;
  title: string;
  templateType?: ContractTemplateType | string;
  /** Hợp đồng ngoài thường được ghi lại SAU khi đã ký thật ngoài đời — cho
   * phép chọn trạng thái/ngày ký ngay lúc tạo thay vì luôn mặc định 'draft'. */
  status?: ContractStatus;
  signedAt?: string | null;
  contractValue?: number;
  currency?: string;
  startDate?: string | null;
  endDate?: string | null;
  paymentTerms?: string;
  progressPercent?: number;
  paymentCollectedPercent?: number;
  ownerId?: string | null;
  clauses?: ContractClause[];
  aiGenerated?: boolean;
  aiRiskScore?: number | null;
  aiReview?: ContractReviewFinding[];
  aiPrompt?: string | null;
  /** Migration 136 — 'external' cho luồng "Ghi nhận hợp đồng có sẵn". Bỏ
   * trống = 'crm' (mặc định ở backend). */
  source?: 'crm' | 'external';
  fileUrl?: string | null;
  note?: string | null;
  /** Phân biệt hợp đồng Mua vào (Phase 1) / Bán ra (Phase 2) — bắt buộc chọn
   * khi tạo qua "Ghi nhận hợp đồng có sẵn" (feedback mentor 2026-10-03). */
  dealPhase?: 'purchase' | 'sale' | null;
  contactId?: string | null;
  /** Người đại diện ký đã được Sale xác nhận ở AI Copilot (không phải checkbox "Tôi đã hiểu" vượt qua) - điều kiện gửi duyệt/ký. */
  representativeConfirmed?: boolean;
  /** Ảnh chụp pháp lý 2 bên lúc tạo/xác nhận hợp đồng (dùng khi Sale chọn "Chỉ dùng cho hợp đồng này") - xem build_parties() backend. */
  legalSnapshot?: Record<string, unknown> | null;
}

export interface UpdateContractInput {
  title?: string;
  manualCustomerName?: string | null;
  templateType?: ContractTemplateType | string;
  status?: ContractStatus;
  contractValue?: number;
  currency?: string;
  signedAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  paymentTerms?: string;
  progressPercent?: number;
  paymentCollectedPercent?: number;
  ownerId?: string | null;
  clauses?: ContractClause[];
  aiRiskScore?: number | null;
  aiReview?: ContractReviewFinding[];
  source?: 'crm' | 'external';
  fileUrl?: string | null;
  /** Sửa hợp đồng bằng form đầy đủ. Chuỗi rỗng "" = gỡ giá trị (dealPhase/contactId/quoteId). */
  note?: string | null;
  quoteId?: string | null;
  dealId?: string | null;
  contactId?: string | null;
  dealPhase?: 'purchase' | 'sale' | '' | null;
  contractNumber?: string | null;
  representativeConfirmed?: boolean;
  legalSnapshot?: Record<string, unknown> | null;
}

export interface GenerateContractDraftInput {
  /** Không bắt buộc — hợp đồng không nhất thiết phải gắn CRM. */
  dealId?: string;
  /** Tên khách hàng nhập tay — dùng khi không chọn dealId. */
  manualCustomerName?: string;
  quoteId?: string | null;
  templateType?: ContractTemplateType | string;
  detailLevel?: string;
  extraPrompt?: string;
  /** Mẫu hợp đồng tham chiếu (từ modules/contract-templates) — AI bám văn phong/cấu trúc mẫu này. */
  referenceTemplateId?: string;
  /** Customer 360: backend bắt buộc có dealId hợp lệ. */
  customerId?: string;
  /** Người dùng đã xác nhận để trống (………) các trường pháp lý còn thiếu. */
  acknowledgeMissing?: boolean;
  /** Text trích từ PDF mẫu vừa tải lên (chỉ tham chiếu văn phong). */
  referenceText?: string;
  /** Tuỳ chọn nâng cao (chỉ ảnh hưởng văn phong). */
  language?: string;
  style?: string;
  /** Khách có nhiều Contact: Sale chọn tường minh người liên hệ cho hợp đồng này. */
  contactId?: string | null;
  /** Người đại diện ký đã chọn/nhập + xác nhận ở Copilot (không mặc nhiên = Người liên hệ). */
  representative?: { name: string; position?: string; phone?: string; email?: string; contactId?: string | null } | null;
  /** "Bổ sung tại chỗ": áp dụng cho phiên soạn thảo này (ghi CRM thật khi saveOverridesToCrm=true). */
  legalOverrides?: {
    companyName?: string; taxCode?: string; address?: string;
    contactName?: string; contactPosition?: string; contactPhone?: string; contactEmail?: string;
  } | null;
  saveOverridesToCrm?: boolean;
}

export interface ReviewContractRiskInput {
  clauses: ContractClause[];
  quoteId?: string | null;
  contractValue?: number;
  paymentTerms?: string;
}

export interface ContractRiskReview {
  score: number | null;
  findings: ContractReviewFinding[];
}

/** "Ghi nhận hợp đồng có sẵn" — đối chiếu file hợp đồng đã upload (OCR/text
 * extraction best-effort) với số liệu THẬT của báo giá đã chọn. Xem
 * RegisterExternalContractModal.tsx + contract_ocr_service.py. */
export interface ContractOcrExtracted {
  contractNumber: string | null;
  signedAt: string | null;
  subtotalAmount: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
  extractionMethod: "ai" | "heuristic";
  extractable: boolean;
}

export interface ContractOcrComparisonRow {
  label: string;
  contractValue: number | null;
  quoteValue: number | null;
  matched: boolean;
}

export interface ContractOcrReconcileResult {
  extracted: ContractOcrExtracted;
  comparison: ContractOcrComparisonRow[];
  allMatched: boolean;
  extractable: boolean;
}
