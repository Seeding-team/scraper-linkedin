import { API_BASE_URL, API_KEY } from '@/lib/env';
import type { ServiceCatalogItem, ServiceCatalogItemInput, BundleComponentInput } from '../types';

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
    throw new Error(body.message || 'Không thực hiện được yêu cầu danh mục dịch vụ.');
  }
  return body.data as T;
}

function toItemPayload(input: ServiceCatalogItemInput) {
  return {
    item_type: input.itemType,
    parent_id: input.parentId,
    sku: input.sku,
    name: input.name,
    description: input.description,
    unit: input.unit,
    list_price_usd: input.listPriceUsd,
    unit_price_usd: input.unitPriceUsd,
    exchange_rate_snapshot: input.exchangeRateSnapshot,
    default_unit_price_vnd: input.defaultUnitPriceVnd,
    default_discount_percent: input.defaultDiscountPercent,
    default_vat_rate: input.defaultVatRate,
    spec_quantity_per_unit: input.specQuantityPerUnit,
    spec_unit_label: input.specUnitLabel,
    note: input.note,
    status: input.status,
  };
}

export class ServiceCatalogRepository {
  async list(): Promise<ServiceCatalogItem[]> {
    return apiFetch<ServiceCatalogItem[]>('/api/all-platform/service-catalog');
  }

  /** Tra cuu nhieu san pham theo id cung luc (vd de "Ap gia de xuat" o Buoc 2
   * dua tren catalogItemId da luu tren dong hang muc) - luon goi lai server,
   * khong dua vao state cua modal chon danh muc da dong. */
  async lookupByIds(ids: string[]): Promise<ServiceCatalogItem[]> {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    return apiFetch<ServiceCatalogItem[]>(`/api/all-platform/service-catalog/lookup?ids=${encodeURIComponent(unique.join(','))}`);
  }

  async create(input: ServiceCatalogItemInput): Promise<ServiceCatalogItem> {
    return apiFetch<ServiceCatalogItem>('/api/all-platform/service-catalog/add', {
      method: 'POST',
      body: JSON.stringify(toItemPayload(input)),
    });
  }

  async update(id: string, input: Partial<ServiceCatalogItemInput>): Promise<ServiceCatalogItem> {
    return apiFetch<ServiceCatalogItem>('/api/all-platform/service-catalog/update', {
      method: 'PUT',
      body: JSON.stringify({ id, ...toItemPayload(input as ServiceCatalogItemInput) }),
    });
  }

  async delete(id: string): Promise<{ deleted: boolean }> {
    return apiFetch(`/api/all-platform/service-catalog/delete?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async reorder(id: string, direction: 'up' | 'down'): Promise<ServiceCatalogItem[]> {
    return apiFetch<ServiceCatalogItem[]>('/api/all-platform/service-catalog/reorder', {
      method: 'PUT',
      body: JSON.stringify({ id, direction }),
    });
  }

  async setBundleComponents(bundleId: string, items: BundleComponentInput[]): Promise<ServiceCatalogItem> {
    return apiFetch<ServiceCatalogItem>(
      `/api/all-platform/service-catalog/${encodeURIComponent(bundleId)}/components`,
      {
        method: 'PUT',
        body: JSON.stringify({
          items: items.map(item => ({
            component_id: item.componentId,
            quantity: item.quantity,
            sort_order: item.sortOrder,
          })),
        }),
      }
    );
  }
}

export const serviceCatalogRepository = new ServiceCatalogRepository();
