import { API_BASE_URL, API_KEY } from '@/lib/env';
import type {
  CreateIssuerCompanyInput,
  CreateQuoteFormInput,
  CreateQuoteInput,
  IssuerCompany,
  Quote,
  QuoteActivityLogEntry,
  QuoteForm,
  QuoteHandoffChecklist,
  QuotePhase,
  QuoteProcessingStage,
  QuoteTelegramLog,
  QuoteVersionResult,
  QuotesByPhaseResult,
  UpdateIssuerCompanyInput,
  UpdateQuoteFormInput,
  UpdateQuoteHandoffChecklistInput,
  UpdateQuoteInput,
} from '../types';
import type { QuoteRepository } from './QuoteRepository';
import type { ServiceCatalogOptions } from '../../service-catalog/types';

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

/** Section 5 - Admin duyet ngoai le theo version. Backend tra
 * message === 'quote_requires_exception_reason' (KHONG phai loi chung
 * chung) khi Rule Engine gan nhat cua quote nay khong dat VA chua co
 * exception_reason - FE bat throw nay de MO modal "Phê duyệt ngoại lệ" thay
 * vi hien alert loi. `evaluation` la snapshot ket qua rule (result/details)
 * de modal hien ro dang chan vi ly do gi. */
export class QuoteApprovalRequiresExceptionError extends Error {
  evaluation: { result?: string; details?: unknown } | null;
  constructor(evaluation: { result?: string; details?: unknown } | null) {
    super('quote_requires_exception_reason');
    this.name = 'QuoteApprovalRequiresExceptionError';
    this.evaluation = evaluation;
  }
}

type QuoteItemPayload = {
  row_type?: 'section' | 'item';
  description: string;
  service_description: string | null;
  unit?: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  children: QuoteItemPayload[];
  catalog_item_id?: string | null;
  bundle_snapshot?: unknown[] | null;
  list_price_usd?: number | null;
  unit_price_usd?: number | null;
  exchange_rate?: number | null;
  unit_price_vnd?: number | null;
  cost_price?: number | null;
  markup_percent?: number | null;
  cost_not_applicable?: boolean;
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
  const body = (await res.json()) as ApiResponse<T> & { detail?: string };
  if (!res.ok) {
    // FastAPI HTTPException (403/422 that - vd require_quote_email_manager,
    // RuleValidationError) tra ve {"detail": "..."} thay vi {"message": "..."}
    // cua BaseResponse thuong dung trong file nay - doc ca 2 de khong hien
    // "Lỗi máy chủ (403)" chung chung khi that ra da co ly do ro rang.
    throw new Error(body.message || body.detail || `Lỗi máy chủ (${res.status})`);
  }
  if (body.success === false) {
    if (body.message === 'quote_requires_exception_reason') {
      const evaluation = (body.data as { evaluation?: { result?: string; details?: unknown } } | undefined)?.evaluation;
      throw new QuoteApprovalRequiresExceptionError(evaluation || null);
    }
    throw new Error(body.message || 'Không thực hiện được yêu cầu báo giá.');
  }
  return body.data as T;
}

function toCreateFormPayload(input: CreateQuoteFormInput) {
  return {
    name: input.name,
    description: input.description,
    status: input.status,
    layout_type: input.layoutType,
    schema_version: input.schemaVersion,
    schema_json: input.schemaJson,
    issuer_company_id: input.issuerCompanyId,
  };
}

function toUpdateFormPayload(input: UpdateQuoteFormInput) {
  return {
    name: input.name,
    description: input.description,
    status: input.status,
    layout_type: input.layoutType,
    schema_version: input.schemaVersion,
    schema_json: input.schemaJson,
    issuer_company_id: input.issuerCompanyId,
  };
}

function toIssuerCompanyPayload(input: CreateIssuerCompanyInput | UpdateIssuerCompanyInput) {
  return {
    code: input.code,
    legal_name: input.legalName,
    brand_name: input.brandName,
    address: input.address,
    contact_name: input.contactName,
    phone: input.phone,
    email: input.email,
    website: input.website,
    tax_code: input.taxCode,
    logo_url: input.logoUrl,
    default_quote_form_id: input.defaultQuoteFormId,
    status: input.status,
    sort_order: input.sortOrder,
  };
}

function toCreateQuotePayload(input: CreateQuoteInput) {
  return {
    deal_id: input.dealId,
    quote_form_id: input.quoteFormId,
    issuer_company_id: input.issuerCompanyId ?? null,
    data: input.data,
    items: (input.items || []).map(toQuoteItemPayload),
    project_id: input.projectId ?? null,
    sla_due_at: input.slaDueAt ?? null,
  };
}

function toUpdateQuotePayload(input: UpdateQuoteInput) {
  // BUG THAT DA GAP (data loss): backend (quotes_update, routers/quote.py)
  // dung `model_fields_set` de phan biet "khong gui field nay" (giu nguyen
  // gia tri cu) voi "gui null CO Y" (xoa gia tri) - CHI cho rieng project_id
  // va sla_due_at. Truoc day ham nay LUON gui ca 2 key nay (`?? null`) du
  // caller (vd persistQuote() khi luu hang muc, handoffToPricing() khi bam
  // "Bàn giao xử lý giá") khong he dinh doi chung - khien MOI LAN luu hang
  // muc/gia von/markup deu VO TINH xoa sach SLA/Du an da dat truoc do (nguoi
  // dung bao "truoc do da dat SLA r ma sao lai chua dat" - dung nguyen nhan
  // nay). CHI dua project_id/sla_due_at vao payload khi caller THAT SU co
  // truyen field do (dung 'in' de phan biet "khong truyen" voi "truyen null
  // co y" - vd updateQuoteProject('') truyen projectId='' CO Y de bo gan).
  const payload: Record<string, unknown> = {
    data: input.data,
    items: input.items?.map(toQuoteItemPayload),
    issuer_company_id: input.issuerCompanyId ?? null,
  };
  if ('projectId' in input) payload.project_id = input.projectId ?? null;
  if ('slaDueAt' in input) payload.sla_due_at = input.slaDueAt ?? null;
  return payload;
}

function toQuoteItemPayload(item: NonNullable<CreateQuoteInput['items']>[number]): QuoteItemPayload {
  return {
    row_type: item.rowType === 'section' ? 'section' : 'item',
    description: item.description ?? '',
    service_description: item.serviceDescription ?? null,
    unit: item.unit,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    discount_percent: item.discountPercent ?? 0,
    vat_rate: item.vatRate,
    children: (item.children || []).map(toQuoteItemPayload),
    catalog_item_id: item.catalogItemId ?? null,
    bundle_snapshot: item.bundleSnapshot ?? null,
    list_price_usd: item.listPriceUsd ?? null,
    unit_price_usd: item.unitPriceUsd ?? null,
    exchange_rate: item.exchangeRate ?? null,
    unit_price_vnd: item.unitPriceVnd ?? null,
    cost_price: item.costPrice ?? null,
    markup_percent: item.markupPercent ?? null,
    cost_not_applicable: item.costNotApplicable ?? false,
  };
}

export class SeedingQuoteRepository implements QuoteRepository {
  async getForms(): Promise<QuoteForm[]> {
    return apiFetch<QuoteForm[]>('/api/all-platform/quote-forms?status=active');
  }

  async getForm(id: string): Promise<QuoteForm> {
    return apiFetch<QuoteForm>(`/api/all-platform/quote-forms/${encodeURIComponent(id)}`);
  }

  async getPublicForm(token: string): Promise<QuoteForm> {
    return apiFetch<QuoteForm>(`/api/all-platform/quote-forms/public/${encodeURIComponent(token)}`);
  }

  async createForm(input: CreateQuoteFormInput): Promise<QuoteForm> {
    return apiFetch<QuoteForm>('/api/all-platform/quote-forms', {
      method: 'POST',
      body: JSON.stringify(toCreateFormPayload(input)),
    });
  }

  async updateForm(id: string, input: UpdateQuoteFormInput): Promise<QuoteForm> {
    return apiFetch<QuoteForm>(`/api/all-platform/quote-forms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(toUpdateFormPayload(input)),
    });
  }

  async deleteForm(id: string): Promise<{ deleted: boolean; archived: boolean; form?: QuoteForm }> {
    return apiFetch(`/api/all-platform/quote-forms/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async duplicateForm(id: string): Promise<QuoteForm> {
    return apiFetch<QuoteForm>(`/api/all-platform/quote-forms/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
    });
  }

  async shareForm(id: string, enabled = true): Promise<QuoteForm> {
    return apiFetch<QuoteForm>(
      `/api/all-platform/quote-forms/${encodeURIComponent(id)}/share?enabled=${enabled ? 'true' : 'false'}`,
      { method: 'POST' }
    );
  }

  async getQuotes(): Promise<Quote[]> {
    return apiFetch<Quote[]>('/api/all-platform/quotes');
  }

  /** Quote Center THAT (backend gom theo version_chain_id + loc/dem/phan
   * trang/tim kiem TOAN BO o server, xem list_quotes_by_phase()) - KHONG
   * load het roi loc client-side nua. phase=undefined nghia la tab "Tất cả".
   * Moi filter (customer/project/owner/team/mine/thoi gian) ap dung TRUOC
   * pagination o backend - khong con bug "loc tren 1 trang da tra ve". */
  async getQuotesByPhase(params: {
    phase?: QuotePhase;
    search?: string;
    customerId?: string;
    projectId?: string;
    ownerId?: string;
    mine?: boolean;
    teamId?: string;
    dateFrom?: string;
    dateTo?: string;
    /** Section 7 - KPI SLA Quote Center, loc TRUOC pagination o backend. */
    sla?: 'overdue' | 'due_soon';
    page?: number;
    pageSize?: number;
  }): Promise<QuotesByPhaseResult> {
    const qs = new URLSearchParams();
    if (params.phase) qs.set('phase', params.phase);
    if (params.search && params.search.trim()) qs.set('search', params.search.trim());
    if (params.customerId) qs.set('customer_id', params.customerId);
    if (params.projectId) qs.set('project_id', params.projectId);
    if (params.ownerId) qs.set('owner_id', params.ownerId);
    if (params.mine) qs.set('mine', 'true');
    if (params.teamId) qs.set('team_id', params.teamId);
    if (params.dateFrom) qs.set('date_from', params.dateFrom);
    if (params.dateTo) qs.set('date_to', params.dateTo);
    if (params.sla) qs.set('sla', params.sla);
    qs.set('page', String(params.page || 1));
    qs.set('page_size', String(params.pageSize || 10));
    return apiFetch<QuotesByPhaseResult>(`/api/all-platform/quotes/by-phase?${qs.toString()}`);
  }

  async getQuote(id: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(id)}`);
  }

  async getPublicQuote(token: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/public/${encodeURIComponent(token)}`);
  }

  async createQuote(input: CreateQuoteInput): Promise<Quote> {
    return apiFetch<Quote>('/api/all-platform/quotes', {
      method: 'POST',
      body: JSON.stringify(toCreateQuotePayload(input)),
    });
  }

  async updateQuote(id: string, input: UpdateQuoteInput): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(toUpdateQuotePayload(input)),
    });
  }

  async deleteQuote(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/all-platform/quotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async approveQuote(id: string, exceptionReason?: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ exception_reason: exceptionReason || null }),
    });
  }

  async updateAndApproveQuote(id: string, input: UpdateQuoteInput, exceptionReason?: string): Promise<Quote> {
    const qs = exceptionReason ? `?exception_reason=${encodeURIComponent(exceptionReason)}` : '';
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(id)}/update-and-approve${qs}`, {
      method: 'POST',
      body: JSON.stringify(toUpdateQuotePayload(input)),
    });
  }

  async createQuoteVersion(id: string): Promise<QuoteVersionResult> {
    return apiFetch<QuoteVersionResult>(`/api/all-platform/quotes/${encodeURIComponent(id)}/create-version`, {
      method: 'POST',
    });
  }

  async getQuoteVersions(id: string): Promise<Quote[]> {
    return apiFetch<Quote[]>(`/api/all-platform/quotes/${encodeURIComponent(id)}/versions`);
  }

  async getFormCatalogLinks(formId: string): Promise<string[]> {
    return apiFetch<string[]>(`/api/all-platform/quote-forms/${encodeURIComponent(formId)}/catalog-links`);
  }

  async setFormCatalogLinks(formId: string, catalogItemIds: string[]): Promise<string[]> {
    return apiFetch<string[]>(`/api/all-platform/quote-forms/${encodeURIComponent(formId)}/catalog-links`, {
      method: 'PUT',
      body: JSON.stringify({ catalog_item_ids: catalogItemIds }),
    });
  }

  async getServiceCatalogOptions(formId: string): Promise<ServiceCatalogOptions> {
    return apiFetch<ServiceCatalogOptions>(
      `/api/all-platform/quotes/service-catalog-options?formId=${encodeURIComponent(formId)}`
    );
  }

  async getIssuerCompanies(includeInactive = false): Promise<IssuerCompany[]> {
    return apiFetch<IssuerCompany[]>(
      `/api/all-platform/quotes/issuer-companies${includeInactive ? '?include_inactive=true' : ''}`
    );
  }

  async createIssuerCompany(input: CreateIssuerCompanyInput): Promise<IssuerCompany> {
    return apiFetch<IssuerCompany>('/api/all-platform/quotes/issuer-companies', {
      method: 'POST',
      body: JSON.stringify(toIssuerCompanyPayload(input)),
    });
  }

  async updateIssuerCompany(id: string, input: UpdateIssuerCompanyInput): Promise<IssuerCompany> {
    return apiFetch<IssuerCompany>(`/api/all-platform/quotes/issuer-companies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(toIssuerCompanyPayload(input)),
    });
  }

  async sendQuoteTelegram(quoteId: string): Promise<QuoteTelegramLog> {
    return apiFetch<QuoteTelegramLog>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/send-telegram`, {
      method: 'POST',
    });
  }

  async getQuoteTelegramLog(quoteId: string): Promise<QuoteTelegramLog[]> {
    return apiFetch<QuoteTelegramLog[]>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/telegram-log`);
  }

  async setQuoteProcessingStage(quoteId: string, stage: QuoteProcessingStage): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/processing-stage`, {
      method: 'POST',
      body: JSON.stringify({ stage }),
    });
  }

  async assignQuoteOwners(
    quoteId: string,
    input: { technicalOwnerId?: string | null; quoteOwnerId?: string | null }
  ): Promise<Quote> {
    const payload: Record<string, string | null> = {};
    if ('technicalOwnerId' in input) payload.technical_owner_id = input.technicalOwnerId ?? null;
    if ('quoteOwnerId' in input) payload.quote_owner_id = input.quoteOwnerId ?? null;
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/owners`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getQuoteHandoffChecklist(quoteId: string): Promise<QuoteHandoffChecklist> {
    return apiFetch<QuoteHandoffChecklist>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/handoff-checklist`);
  }

  async saveQuoteHandoffChecklist(
    quoteId: string,
    input: UpdateQuoteHandoffChecklistInput
  ): Promise<QuoteHandoffChecklist> {
    return apiFetch<QuoteHandoffChecklist>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/handoff-checklist`, {
      method: 'PUT',
      body: JSON.stringify({
        scope_confirmed: input.scopeConfirmed,
        scope_note: input.scopeNote ?? null,
        cost_confirmed: input.costConfirmed,
        cost_note: input.costNote ?? null,
        timeline_confirmed: input.timelineConfirmed,
        timeline_note: input.timelineNote ?? null,
        assumption_confirmed: input.assumptionConfirmed,
        assumption_note: input.assumptionNote ?? null,
        handoff_note: input.handoffNote ?? null,
      }),
    });
  }

  async getQuoteActivityLog(quoteId: string): Promise<QuoteActivityLogEntry[]> {
    return apiFetch<QuoteActivityLogEntry[]>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/activity-log`);
  }

  async logQuoteVersionReason(quoteId: string, reason: string): Promise<QuoteActivityLogEntry[]> {
    return apiFetch<QuoteActivityLogEntry[]>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/version-reason`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // ── Phase 1/3 lifecycle (migration 087/089) ──────────────────────────────

  async cancelQuote(quoteId: string, reason: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async revokePublicQuote(quoteId: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/revoke-public`, {
      method: 'POST',
    });
  }

  async softDeleteQuote(quoteId: string, reason?: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/soft-delete`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? null }),
    });
  }

  async restoreQuote(quoteId: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/restore`, {
      method: 'POST',
    });
  }

  async requestQuoteChanges(quoteId: string, targetStage: 'technical' | 'pricing', reason: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({ target_stage: targetStage, reason }),
    });
  }

  async publishQuote(quoteId: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(quoteId)}/publish`, {
      method: 'POST',
    });
  }

  async getQuoteRecipientSuggestion(quoteId: string) {
    return apiFetch<{ name: string | null; email: string | null; source: string | null }>(
      `/api/all-platform/quotes/${encodeURIComponent(quoteId)}/recipient-suggestion`
    );
  }

  async getQuoteSendAvailability(quoteId: string) {
    return apiFetch<{ available: boolean; reason: string | null }>(
      `/api/all-platform/quotes/${encodeURIComponent(quoteId)}/send-availability`
    );
  }

  async getQuoteDeliveryLog(quoteId: string) {
    return apiFetch<import('./QuoteRepository').QuoteDeliveryLogEntry[]>(
      `/api/all-platform/quotes/${encodeURIComponent(quoteId)}/delivery-log`
    );
  }

  async getActiveQuoteApprovalRuleSet() {
    return apiFetch<import('./QuoteRepository').QuoteApprovalRuleSet | null>(
      `/api/all-platform/quote-approval-rules/active`
    );
  }

  async saveQuoteApprovalRuleSet(input: import('./QuoteRepository').SaveQuoteApprovalRuleSetInput) {
    return apiFetch<import('./QuoteRepository').QuoteApprovalRuleSet>(
      `/api/all-platform/quote-approval-rules/active`,
      {
        method: 'PUT',
        body: JSON.stringify({
          rules: input.rules.map(r => ({
            ruleType: r.ruleType,
            thresholdValue: r.thresholdValue,
            isRequired: r.isRequired ?? true,
            isActive: r.isActive ?? true,
          })),
          autoApproveEnabled: input.autoApproveEnabled,
          idempotencyKey: input.idempotencyKey,
        }),
      }
    );
  }

  async evaluateQuoteRules(quoteId: string) {
    return apiFetch<import('./QuoteRepository').QuoteRuleEvaluation | null>(
      `/api/all-platform/quotes/${encodeURIComponent(quoteId)}/evaluate-rules`,
      { method: 'POST' }
    );
  }

  async getQuoteRuleEvaluation(quoteId: string) {
    return apiFetch<import('./QuoteRepository').QuoteRuleEvaluation | null>(
      `/api/all-platform/quotes/${encodeURIComponent(quoteId)}/rule-evaluation`
    );
  }

  async sendQuoteEmail(quoteId: string, input: import('./QuoteRepository').SendQuoteEmailInput) {
    return apiFetch<import('./QuoteRepository').QuoteDeliveryLogEntry>(
      `/api/all-platform/quotes/${encodeURIComponent(quoteId)}/send`,
      {
        method: 'POST',
        body: JSON.stringify({
          recipient_name: input.recipientName ?? null,
          recipient_email: input.recipientEmail,
          recipient_source: input.recipientSource ?? null,
          subject: input.subject ?? null,
          message: input.message ?? '',
          attach_pdf: Boolean(input.attachPdf),
          idempotency_key: input.idempotencyKey,
        }),
      }
    );
  }
}

export const seedingQuoteRepository = new SeedingQuoteRepository();
