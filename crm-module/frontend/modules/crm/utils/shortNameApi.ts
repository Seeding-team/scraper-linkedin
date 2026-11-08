import { API_BASE_URL, API_KEY } from '@/lib/env';
import { deriveShortName } from './customerNames';

/** Đề xuất tên viết tắt từ backend (thương hiệu đã có → quy tắc → AI nếu cần); lỗi mạng/AI → fallback quy tắc cục bộ (cùng logic). */
export async function requestShortNameSuggestion(company: string, options?: { customerId?: string; useAi?: boolean }): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  try {
    const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers/suggest-short-name`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ company_name: company, customer_id: options?.customerId, use_ai: options?.useAi ?? true }),
    });
    const body = await res.json();
    const value = body?.data?.suggestion;
    if (res.ok && body.success !== false && typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    /* backend/AI lỗi -> fallback quy tắc cục bộ */
  }
  return deriveShortName(company);
}
