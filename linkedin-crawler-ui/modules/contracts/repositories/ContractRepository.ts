import type {
  Contract,
  ContractDashboardStats,
  ContractOcrReconcileResult,
  ContractRiskReview,
  CreateContractInput,
  GenerateContractDraftInput,
  ReviewContractRiskInput,
  UpdateContractInput,
} from '../types';

export interface ContractRepository {
  getContracts(params?: { dealId?: string; status?: string; quoteId?: string }): Promise<Contract[]>;
  getContract(id: string): Promise<Contract>;
  getDashboardStats(): Promise<ContractDashboardStats>;
  createContract(input: CreateContractInput, options?: { idempotencyKey?: string }): Promise<Contract>;
  updateContract(id: string, input: UpdateContractInput): Promise<Contract>;
  updateStatus(id: string, status: string, signedAt?: string, version?: number): Promise<Contract>;
  deleteContract(id: string): Promise<void>;

  /** AI soạn thảo — không tạo row DB, chỉ trả clauses tạm để review trước khi lưu. */
  generateDraft(input: GenerateContractDraftInput): Promise<{ clauses: import('../types').ContractClause[]; warnings?: string[] }>;
  /** AI chấm điểm rủi ro cho bản đang sửa (chưa lưu hoặc đã lưu đều gọi được). */
  reviewRisk(input: ReviewContractRiskInput): Promise<ContractRiskReview>;
  /** "✦ AI đề xuất chỉnh sửa" — soạn lại nội dung điều khoản để khắc phục rủi ro vừa phát hiện. */
  refineDraft(input: {
    clauses: import('../types').ContractClause[];
    findings: import('../types').ContractReviewFinding[];
  }): Promise<{ clauses: import('../types').ContractClause[] }>;

  /** "Ghi nhận hợp đồng có sẵn" — đối chiếu file hợp đồng vừa upload với số
   * liệu THẬT của báo giá `quoteId` (best-effort OCR/text extraction, xem
   * contract_ocr_service.py — không bịa dữ liệu, `extractable=false` là kết
   * quả hợp lệ khi không đọc được nội dung). */
  ocrReconcile(file: File, quoteId: string): Promise<ContractOcrReconcileResult>;
}
