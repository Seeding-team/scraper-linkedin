import { API_BASE_URL, API_KEY } from '@/lib/env';

export interface CrmVendor {
  id: string;
  code: string | null;
  name: string;
  short_name: string | null;
  tax_code: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  note: string | null;
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
  if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
  return res.json();
}

export const VendorRepository = {
  async listVendors(params?: { search?: string; status?: string; limit?: number }): Promise<CrmVendor[]> {
    const q = new URLSearchParams();
    if (params?.search) q.append('search', params.search);
    if (params?.status) q.append('status', params.status);
    if (params?.limit) q.append('limit', String(params.limit));
    return apiFetch<CrmVendor[]>(`/api/all-platform/crm/vendors?${q.toString()}`);
  },

  async createVendor(data: Partial<CrmVendor>): Promise<CrmVendor> {
    return apiFetch<CrmVendor>(`/api/all-platform/crm/vendors`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateVendor(id: string, data: Partial<CrmVendor>): Promise<CrmVendor> {
    return apiFetch<CrmVendor>(`/api/all-platform/crm/vendors/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deactivateVendor(id: string): Promise<CrmVendor> {
    return apiFetch<CrmVendor>(`/api/all-platform/crm/vendors/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
    });
  }
};
