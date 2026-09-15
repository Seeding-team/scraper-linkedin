import { API_BASE_URL, API_KEY } from '@/lib/env';
import type {
  Contract,
  ContractClause,
  ContractDashboardStats,
  ContractRiskReview,
  CreateContractInput,
  GenerateContractDraftInput,
  ReviewContractRiskInput,
  UpdateContractInput,
} from '../types';
import type { ContractRepository } from './ContractRepository';

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function getDefaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: getDefaultHeaders(),
    ...options,
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok) {
    throw new Error(body.message || `Lỗi máy chủ (${res.status})`);
  }
  if (body.success === false) {
    throw new Error(body.message || 'Không thực hiện được yêu cầu hợp đồng.');
  }
  return body.data as T;
}

function toClausePayload(clause: ContractClause) {
  return { id: clause.id, title: clause.title, body: clause.body };
}

function toCreatePayload(input: CreateContractInput) {
  return {
    contract_number: input.contractNumber,
    deal_id: input.dealId,
    customer_id: input.customerId,
    manual_customer_name: input.manualCustomerName,
    quote_id: input.quoteId,
    title: input.title,
    template_type: input.templateType,
    status: input.status,
    signed_at: input.signedAt,
    contract_value: input.contractValue,
    currency: input.currency,
    start_date: input.startDate,
    end_date: input.endDate,
    payment_terms: input.paymentTerms,
    progress_percent: input.progressPercent,
    payment_collected_percent: input.paymentCollectedPercent,
    owner_id: input.ownerId,
    clauses: (input.clauses || []).map(toClausePayload),
    ai_generated: input.aiGenerated,
    ai_risk_score: input.aiRiskScore,
    ai_review: input.aiReview,
    ai_prompt: input.aiPrompt,
    source: input.source,
    file_url: input.fileUrl,
    note: input.note,
  };
}

function toUpdatePayload(input: UpdateContractInput) {
  return {
    title: input.title,
    manual_customer_name: input.manualCustomerName,
    template_type: input.templateType,
    contract_value: input.contractValue,
    currency: input.currency,
    start_date: input.startDate,
    end_date: input.endDate,
    payment_terms: input.paymentTerms,
    progress_percent: input.progressPercent,
    payment_collected_percent: input.paymentCollectedPercent,
    owner_id: input.ownerId,
    clauses: input.clauses?.map(toClausePayload),
    ai_risk_score: input.aiRiskScore,
    ai_review: input.aiReview,
  };
}

export class SeedingContractRepository implements ContractRepository {
  async getContracts(params?: { dealId?: string; status?: string }): Promise<Contract[]> {
    const q = new URLSearchParams();
    if (params?.dealId) q.set('deal_id', params.dealId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return apiFetch<Contract[]>(`/api/all-platform/contracts${qs}`);
  }

  async getContract(id: string): Promise<Contract> {
    return apiFetch<Contract>(`/api/all-platform/contracts/${encodeURIComponent(id)}`);
  }

  async getDashboardStats(): Promise<ContractDashboardStats> {
    return apiFetch<ContractDashboardStats>('/api/all-platform/contracts/dashboard-stats');
  }

  async createContract(input: CreateContractInput): Promise<Contract> {
    return apiFetch<Contract>('/api/all-platform/contracts', {
      method: 'POST',
      body: JSON.stringify(toCreatePayload(input)),
    });
  }

  async updateContract(id: string, input: UpdateContractInput): Promise<Contract> {
    return apiFetch<Contract>(`/api/all-platform/contracts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(toUpdatePayload(input)),
    });
  }

  async updateStatus(id: string, status: string, signedAt?: string): Promise<Contract> {
    return apiFetch<Contract>(`/api/all-platform/contracts/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, signed_at: signedAt }),
    });
  }

  async deleteContract(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/all-platform/contracts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async generateDraft(input: GenerateContractDraftInput): Promise<{ clauses: ContractClause[] }> {
    return apiFetch<{ clauses: ContractClause[] }>('/api/all-platform/contracts/generate-draft', {
      method: 'POST',
      body: JSON.stringify({
        deal_id: input.dealId,
        manual_customer_name: input.manualCustomerName,
        quote_id: input.quoteId,
        template_type: input.templateType,
        detail_level: input.detailLevel,
        extra_prompt: input.extraPrompt,
        reference_template_id: input.referenceTemplateId,
      }),
    });
  }

  async reviewRisk(input: ReviewContractRiskInput): Promise<ContractRiskReview> {
    return apiFetch<ContractRiskReview>('/api/all-platform/contracts/ai-review', {
      method: 'POST',
      body: JSON.stringify({
        clauses: input.clauses.map(toClausePayload),
        quote_id: input.quoteId,
        contract_value: input.contractValue,
        payment_terms: input.paymentTerms,
      }),
    });
  }

  async refineDraft(input: {
    clauses: ContractClause[];
    findings: import('../types').ContractReviewFinding[];
  }): Promise<{ clauses: ContractClause[] }> {
    return apiFetch<{ clauses: ContractClause[] }>('/api/all-platform/contracts/refine-draft', {
      method: 'POST',
      body: JSON.stringify({
        clauses: input.clauses.map(toClausePayload),
        findings: input.findings,
      }),
    });
  }
}

export const seedingContractRepository = new SeedingContractRepository();
