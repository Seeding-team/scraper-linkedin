import { API_BASE_URL, API_KEY } from '@/lib/env';

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
    throw new Error(body.message || 'Không thực hiện được yêu cầu Bảng giá VPS Zone.');
  }
  return body.data as T;
}

export interface PriceBookItem {
  id: string;
  priceBookVersionId: string;
  sectionId: string | null;
  sourceSheet: string;
  sourceStt: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string | null;
  defaultQuantity: number;
  status: 'active' | 'discontinued';
  productImageUrl: string | null;
  costMode: 'usd' | 'vnd';
  vendorName: string | null;
  listPriceUsd: number | null;
  unitPriceUsd: number | null;
  unitPriceVndDirect: number | null;
  exchangeRate: number | null;
  importDutyPercent: number;
  vatInPercent: number;
  quoteReceivedDate: string | null;
  quoteLink: string | null;
  defaultRatePercent: number;
  vatEuPercent: number;
  referencePrice: number | null;
  referenceLink: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Lop XEM QUY DOI USD (tham khao, KHONG phai bao gia chinh thuc bang USD) -
   * backend tinh that bang Decimal (price_book_service.compute_item_pricing),
   * KHONG tu tinh o FE. costUsd la gia von (bi an neu khong du quyen xem gia
   * von - se la `undefined` khi field bi strip); customerPriceUsd la gia
   * khach quy doi, luon co neu co exchangeRate. */
  costUsd?: number | null;
  customerPriceUsd?: number | null;
}

export interface PriceBookVersion {
  id: string;
  price_book_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  effective_date: string | null;
  published_by: string | null;
  published_at: string | null;
}

export interface PriceBookItemInput {
  sourceSheet: string;
  sourceStt: string;
  sourceGroupLabel: string;
  sku: string;
  name: string;
  description?: string | null;
  unit?: string | null;
  defaultQuantity?: number;
  productImageUrl?: string | null;
  costMode: 'usd' | 'vnd';
  vendorName?: string | null;
  listPriceUsd?: number | null;
  unitPriceUsd?: number | null;
  unitPriceVndDirect?: number | null;
  exchangeRate?: number | null;
  importDutyPercent?: number;
  vatInPercent?: number;
  quoteReceivedDate?: string | null;
  quoteLink?: string | null;
  defaultRatePercent?: number;
  vatEuPercent?: number;
  referencePrice?: number | null;
  referenceLink?: string | null;
}

export interface PriceBookAuditLogEntry {
  id: string;
  price_book_item_id: string | null;
  price_book_version_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  changes: unknown;
  created_at: string;
}

export class PriceBookZoneRepository {
  async listItems(status: 'draft' | 'published'): Promise<{ version: PriceBookVersion | null; items: PriceBookItem[] }> {
    return apiFetch(`/api/all-platform/price-book-admin/items?status=${status}`);
  }

  async createItem(input: PriceBookItemInput): Promise<PriceBookItem> {
    return apiFetch('/api/all-platform/price-book-admin/items', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateItem(id: string, input: PriceBookItemInput): Promise<PriceBookItem> {
    return apiFetch(`/api/all-platform/price-book-admin/items/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async discontinueItem(id: string): Promise<PriceBookItem> {
    return apiFetch(`/api/all-platform/price-book-admin/items/${encodeURIComponent(id)}/discontinue`, {
      method: 'POST',
    });
  }

  async deleteItem(id: string): Promise<{ deleted: boolean; discontinued: boolean }> {
    return apiFetch(`/api/all-platform/price-book-admin/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async publish(): Promise<PriceBookVersion> {
    return apiFetch('/api/all-platform/price-book-admin/publish', { method: 'POST' });
  }

  async auditLog(): Promise<PriceBookAuditLogEntry[]> {
    return apiFetch('/api/all-platform/price-book-admin/audit-log');
  }

  /** Dung trong Quote Workspace picker - CHI doc version published, dung
   * chung moi issuer_company_id (xem router). quoteId optional - che do
   * TAO MOI (chua co quote that) van goi duoc de xem danh sach san pham,
   * chi khong co gia von/markup (backend tu an an toan khi thieu quote_id -
   * "SAO ĐANG TẠO CÁI MỚI MÀ BÊN VPS ZONE K HIỂN DANH MỤC TA"). */
  async listPublishedForQuote(quoteId?: string | null): Promise<PriceBookItem[]> {
    const qs = quoteId ? `?quote_id=${encodeURIComponent(quoteId)}` : '';
    return apiFetch(`/api/all-platform/price-book-items${qs}`);
  }
}

export const priceBookZoneRepository = new PriceBookZoneRepository();
