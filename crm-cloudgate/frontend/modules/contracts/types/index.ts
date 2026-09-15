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
  templateType: ContractTemplateType;
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
  /** Chỉ dùng cho "Ghi nhận hợp đồng có sẵn" (hợp đồng bên ngoài đã có số
   * riêng) - bỏ trống thì backend tự sinh số như mọi luồng tạo khác. */
  contractNumber?: string | null;
  dealId?: string | null;
  customerId?: string | null;
  manualCustomerName?: string | null;
  quoteId?: string | null;
  title: string;
  templateType?: ContractTemplateType;
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
}

export interface UpdateContractInput {
  title?: string;
  manualCustomerName?: string | null;
  templateType?: ContractTemplateType;
  contractValue?: number;
  currency?: string;
  startDate?: string | null;
  endDate?: string | null;
  paymentTerms?: string;
  progressPercent?: number;
  paymentCollectedPercent?: number;
  ownerId?: string | null;
  clauses?: ContractClause[];
  aiRiskScore?: number | null;
  aiReview?: ContractReviewFinding[];
}

export interface GenerateContractDraftInput {
  /** Không bắt buộc — hợp đồng không nhất thiết phải gắn CRM. */
  dealId?: string;
  /** Tên khách hàng nhập tay — dùng khi không chọn dealId. */
  manualCustomerName?: string;
  quoteId?: string | null;
  templateType?: ContractTemplateType;
  detailLevel?: string;
  extraPrompt?: string;
  /** Mẫu hợp đồng tham chiếu (từ modules/contract-templates) — AI bám văn phong/cấu trúc mẫu này. */
  referenceTemplateId?: string;
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
