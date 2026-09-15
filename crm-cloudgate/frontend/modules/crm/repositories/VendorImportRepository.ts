import { API_BASE_URL, API_KEY } from '@/lib/env';

export interface VendorImportBatch {
  id: string;
  instance: string;
  vendor_id: string;
  project_id: string | null;
  exchange_rate: number;
  target_scope: string;
  source_file_path: string;
  source_file_name: string;
  source_file_size: number;
  source_file_type: string;
  source_file_pages: number | null;
  status: 'uploaded' | 'extracting' | 'review' | 'approved' | 'failed';
  error_message: string | null;
  extraction_meta: any;
  created_at: string;
  /** get_batch()/list_batches() select "*, crm_vendors(*)" - da co san, dung
   * hien Vendor that o Step 4 thay vi chi hien vendor_id. */
  crm_vendors?: { id?: string; name?: string; code?: string } | null;
  /** Migration 132 - "Nhom san pham mac dinh" chon o Step 1, ap dung cho
   * moi SKU MOI trich xuat tu file nay. */
  default_group_id?: string | null;
}

export interface VendorImportItem {
  id: string;
  batch_id: string;
  matched_catalog_item_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  quantity: number | null;
  uom: string | null;
  brand: string | null;
  currency: string;
  list_price: number | null;
  discount_percent: number | null;
  net_price: number | null;
  vat_rate: number | null;
  /** Migration 131 - truoc do KHONG co cot nao luu duoc (chi tinh tam trong
   * pricing hook o FE roi mat khi save). */
  shipping_cost: number | null;
  other_cost: number | null;
  quote_date: string | null;
  /** Migration 132 - nhom san pham (service_catalog_items.id) da resolve o
   * extraction time: SKU moi = tu "Nhom san pham mac dinh" cua batch, SKU
   * khop san pham co san = giu nguyen parent_id That cua san pham do. */
  group_id: string | null;
  confidence: number | null;
  warnings: any;
  raw_extraction: any;
  normalized_json: any;
  review_status: 'pending' | 'mapped' | 'new' | 'ignored';
  mapping_action: 'existing' | 'new' | 'ignored' | null;
}

function getDefaultHeaders(isFormData = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: getDefaultHeaders(options?.body instanceof FormData),
    ...options,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const json = await res.json(); if (json.detail) msg = json.detail; } catch (e) {}
    throw new Error(`API Error: ${msg}`);
  }
  return res.json();
}

export const VendorImportRepository = {
  async uploadBatch(data: FormData): Promise<VendorImportBatch> {
    return apiFetch<VendorImportBatch>(`/api/all-platform/crm/vendor-imports/batches`, {
      method: 'POST',
      body: data,
    });
  },

  async getBatch(batchId: string): Promise<VendorImportBatch> {
    return apiFetch<VendorImportBatch>(`/api/all-platform/crm/vendor-imports/batches/${batchId}`);
  },

  async getBatchItems(batchId: string): Promise<VendorImportItem[]> {
    return apiFetch<VendorImportItem[]>(`/api/all-platform/crm/vendor-imports/batches/${batchId}/items`);
  },

  async updateItem(batchId: string, itemId: string, data: Partial<VendorImportItem>): Promise<VendorImportItem> {
    return apiFetch<VendorImportItem>(`/api/all-platform/crm/vendor-imports/batches/${batchId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  async approveBatch(batchId: string): Promise<{status: string, processed?: number}> {
    return apiFetch<{status: string, processed?: number}>(`/api/all-platform/crm/vendor-imports/batches/${batchId}/approve`, {
      method: 'POST'
    });
  },

  /** Chay (hoac chay lai) OCR+AI that su qua endpoint /retry co san o backend
   * (chap nhan ca status 'uploaded' lam diem bat dau, khong chi 'failed'/
   * 'review') - dung lam nut "Chay OCR + AI" / "Chay lai OCR + AI" / "Thu
   * lai OCR + AI" o Step 2, khong tao API/flow gia. */
  async retryBatch(batchId: string): Promise<{ status: string }> {
    return apiFetch<{ status: string }>(`/api/all-platform/crm/vendor-imports/batches/${batchId}/retry`, {
      method: 'POST'
    });
  }
};
