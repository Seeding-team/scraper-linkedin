import { API_BASE_URL, API_KEY } from '@/lib/env';
import type {
  ContractActivityLogItem,
  CustomerRelatedRecords,
  ProgressContractItem,
  ProgressCustomerItem,
  ProgressDealItem,
  ProgressLeadItem,
  ProgressListResponse,
  ProgressMemberSummaryResponse,
  ProgressOverview,
  ProgressAlerts,
  ProgressProjectItem,
  ProgressQuoteItem,
  ProgressQuotesResponse,
  ProgressRecordsResponse,
  ProgressSearchResults,
  ProgressTeamDetail,
  ProgressTeamsResponse,
} from '../components/progress/progress.types';

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
    throw new Error(body.message || 'Không lấy được dữ liệu tiến độ.');
  }
  return body.data as T;
}

/** `/api/all-platform/progress/*` — dashboard đọc, không có method tạo/sửa
 * nào ở đây (đúng yêu cầu "không phải task management"). */
export const progressRepository = {
  getOverview(): Promise<ProgressOverview> {
    return apiFetch<ProgressOverview>('/api/all-platform/progress/overview');
  },

  listTeams(): Promise<ProgressTeamsResponse> {
    return apiFetch<ProgressTeamsResponse>('/api/all-platform/progress/teams');
  },

  getTeamDetail(teamId: string): Promise<ProgressTeamDetail> {
    return apiFetch<ProgressTeamDetail>(`/api/all-platform/progress/teams/${encodeURIComponent(teamId)}`);
  },

  getMemberSummary(userId: string): Promise<ProgressMemberSummaryResponse> {
    return apiFetch<ProgressMemberSummaryResponse>(`/api/all-platform/progress/members/${encodeURIComponent(userId)}`);
  },

  listMemberLeads(userId: string): Promise<ProgressListResponse<ProgressLeadItem>> {
    return apiFetch(`/api/all-platform/progress/members/${encodeURIComponent(userId)}/leads`);
  },

  listMemberCustomers(userId: string): Promise<ProgressListResponse<ProgressCustomerItem>> {
    return apiFetch(`/api/all-platform/progress/members/${encodeURIComponent(userId)}/customers`);
  },

  listMemberDeals(userId: string): Promise<ProgressListResponse<ProgressDealItem>> {
    return apiFetch(`/api/all-platform/progress/members/${encodeURIComponent(userId)}/deals`);
  },

  listMemberProjects(userId: string): Promise<ProgressListResponse<ProgressProjectItem>> {
    return apiFetch(`/api/all-platform/progress/members/${encodeURIComponent(userId)}/projects`);
  },

  listMemberQuotes(userId: string): Promise<ProgressListResponse<ProgressQuoteItem>> {
    return apiFetch(`/api/all-platform/progress/members/${encodeURIComponent(userId)}/quotes`);
  },

  listMemberContracts(userId: string): Promise<ProgressListResponse<ProgressContractItem>> {
    return apiFetch(`/api/all-platform/progress/members/${encodeURIComponent(userId)}/contracts`);
  },

  listQuotes(params?: { teamId?: string; ownerId?: string; slaStatus?: string }): Promise<ProgressQuotesResponse> {
    const qs = new URLSearchParams();
    if (params?.teamId) qs.set('team_id', params.teamId);
    if (params?.ownerId) qs.set('owner_id', params.ownerId);
    if (params?.slaStatus) qs.set('sla_status', params.slaStatus);
    const suffix = qs.toString();
    return apiFetch<ProgressQuotesResponse>(`/api/all-platform/progress/quotes${suffix ? `?${suffix}` : ''}`);
  },

  listRecords(): Promise<ProgressRecordsResponse> {
    return apiFetch<ProgressRecordsResponse>('/api/all-platform/progress/records');
  },

  getContractActivityLog(contractId: string): Promise<ContractActivityLogItem[]> {
    return apiFetch<ContractActivityLogItem[]>(`/api/all-platform/contracts/${encodeURIComponent(contractId)}/activity-log`);
  },

  /** Reuse endpoint Customer 360 đã có sẵn (CrmCustomerDetailPage.tsx dùng
   * chung) cho Customer Quick View - KHÔNG phải endpoint /progress/* mới. */
  getCustomerRelated(customerId: string): Promise<CustomerRelatedRecords> {
    return apiFetch<CustomerRelatedRecords>(`/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/related`);
  },

  getAlerts(): Promise<ProgressAlerts> {
    return apiFetch<ProgressAlerts>('/api/all-platform/progress/alerts');
  },

  search(query: string): Promise<ProgressSearchResults> {
    return apiFetch<ProgressSearchResults>(`/api/all-platform/progress/search?q=${encodeURIComponent(query)}`);
  },
};
