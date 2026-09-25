import type {
  Contract,
  ContractDashboardStats,
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
  createContract(input: CreateContractInput): Promise<Contract>;
  updateContract(id: string, input: UpdateContractInput): Promise<Contract>;
  updateStatus(id: string, status: string, signedAt?: string): Promise<Contract>;
  deleteContract(id: string): Promise<void>;

  /** AI soạn thảo — không tạo row DB, chỉ trả clauses tạm để review trước khi lưu. */
  generateDraft(input: GenerateContractDraftInput): Promise<{ clauses: import('../types').ContractClause[] }>;
  /** AI chấm điểm rủi ro cho bản đang sửa (chưa lưu hoặc đã lưu đều gọi được). */
  reviewRisk(input: ReviewContractRiskInput): Promise<ContractRiskReview>;
  /** "✦ AI đề xuất chỉnh sửa" — soạn lại nội dung điều khoản để khắc phục rủi ro vừa phát hiện. */
  refineDraft(input: {
    clauses: import('../types').ContractClause[];
    findings: import('../types').ContractReviewFinding[];
  }): Promise<{ clauses: import('../types').ContractClause[] }>;
}
