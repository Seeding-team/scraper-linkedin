import { API_BASE_URL, API_KEY } from '@/lib/env';
import type {
  CreateIssuerCompanyInput,
  CreateQuoteFormInput,
  CreateQuoteInput,
  IssuerCompany,
  Quote,
  QuoteForm,
  QuoteTelegramLog,
  QuoteVersionResult,
  UpdateIssuerCompanyInput,
  UpdateQuoteFormInput,
  UpdateQuoteInput,
} from '../types';
import type { QuoteRepository } from './QuoteRepository';
import type { ServiceCatalogOptions } from '../../service-catalog/types';

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type QuoteItemPayload = {
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
  };
}

function toUpdateQuotePayload(input: UpdateQuoteInput) {
  return {
    data: input.data,
    items: input.items?.map(toQuoteItemPayload),
    issuer_company_id: input.issuerCompanyId ?? null,
  };
}

function toQuoteItemPayload(item: NonNullable<CreateQuoteInput['items']>[number]): QuoteItemPayload {
  return {
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

  async approveQuote(id: string): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  }

  async updateAndApproveQuote(id: string, input: UpdateQuoteInput): Promise<Quote> {
    return apiFetch<Quote>(`/api/all-platform/quotes/${encodeURIComponent(id)}/update-and-approve`, {
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
}

export const seedingQuoteRepository = new SeedingQuoteRepository();
