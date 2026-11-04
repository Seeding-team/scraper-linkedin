import { API_BASE_URL, API_KEY } from '@/lib/env';
import type { ContractTemplate } from '../types';

type ApiResponse<T> = { success?: boolean; message?: string; data?: T };

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
  if (!res.ok) throw new Error(body.message || `Lỗi máy chủ (${res.status})`);
  if (body.success === false) throw new Error(body.message || 'Không thực hiện được yêu cầu.');
  return body.data as T;
}

export class SeedingContractTemplateRepository {
  async getTemplates(): Promise<ContractTemplate[]> {
    return apiFetch<ContractTemplate[]>('/api/all-platform/contract-templates');
  }

  async getTemplate(id: string): Promise<ContractTemplate> {
    return apiFetch<ContractTemplate>(`/api/all-platform/contract-templates/${encodeURIComponent(id)}`);
  }

  /** Upload file mẫu (.docx/.pdf/.txt) — backend tự trích xuất text. */
  async uploadTemplate(name: string, description: string, file: File): Promise<ContractTemplate> {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('description', description);
    fd.append('file', file);

    const headers: Record<string, string> = {};
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    // KHÔNG set Content-Type thủ công cho FormData — browser tự thêm boundary.
    const res = await fetch(`${API_BASE_URL}/api/all-platform/contract-templates`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: fd,
    });
    const body = (await res.json()) as ApiResponse<ContractTemplate>;
    if (!res.ok) throw new Error(body.message || `Lỗi máy chủ (${res.status})`);
    if (body.success === false) throw new Error(body.message || 'Tải mẫu hợp đồng thất bại.');
    return body.data as ContractTemplate;
  }

  async deleteTemplate(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/all-platform/contract-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

export const seedingContractTemplateRepository = new SeedingContractTemplateRepository();
