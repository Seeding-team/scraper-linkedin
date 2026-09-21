/** Types khớp CHÍNH XÁC response shape của backend `/api/all-platform/progress/*`
 * (đã runtime-test PASS trên DB thật — xem progress_service.py). Đây là dashboard
 * ĐỌC (Quản lý tiến độ), không phải task management — không có input tạo/sửa
 * tiến độ nào ở đây, chỉ hiển thị dữ liệu CRM hiện có. */

export interface ProgressScope {
  role: 'admin' | 'leader';
  teamIds: string[] | null;
}

export interface ProgressOverviewKpis {
  leadsInProgress: { count: number };
  customersBeingCared: { count: number };
  dealsOpen: { count: number; pipelineValueVnd: number };
  projectsActive: { count: number };
  quotesInProgress: { count: number; byPhase: Record<string, number> };
  quotesOverSla: { count: number };
  contractsTracked: { count: number };
  onTimeCompletionRate: { percent: number | null; sampleSize: number };
}

export interface ProgressOverview {
  scope: ProgressScope;
  kpis: ProgressOverviewKpis;
}

export interface ProgressTeamSummary {
  /** Từ bản redesign (2026-09-21): giá trị THẬT là tên phòng ban trong
   * `members` (HR roster: Sales/Technical/Marketing/Presales/Dev/Intern
   * L1/Intern L1 Tech/Intern L2/Back-Office/Freelancer) — KHÔNG còn là UUID
   * của bảng `teams` (CRM) nữa. Permission vẫn dựa 100% vào `teams`/
   * `member_of_teams` phía backend, chỉ đổi khoá gom nhóm hiển thị. Vì vậy
   * `leaderId`/`leaderName` luôn null (HR roster không có field leader) và
   * `teamType` luôn null. */
  teamId: string;
  teamName: string | null;
  teamType: string | null;
  leaderId: string | null;
  leaderName: string | null;
  memberCount: number;
  leadCount: number;
  customerCount: number;
  dealCount: number;
  projectCount: number;
  quoteCount: number;
  contractCount: number;
  quotesOverSlaCount: number;
  pipelineValueVnd: number;
}

export interface ProgressTeamsResponse {
  scope: ProgressScope;
  teams: ProgressTeamSummary[];
}

export interface ProgressMemberSummaryRow {
  userId: string;
  userName: string | null;
  role: string | null;
  quoteBusinessRole: string | null;
  leadCount: number;
  customerCount: number;
  dealCount: number;
  projectCount: number;
  quoteCount: number;
  contractCount: number;
  quotesOverSlaCount: number;
  pipelineValueVnd: number;
}

export interface ProgressTeamDetail {
  team: ProgressTeamSummary;
  members: ProgressMemberSummaryRow[];
}

export interface ProgressMemberSummaryResponse {
  member: {
    userId: string;
    userName: string | null;
    role: string | null;
    quoteBusinessRole: string | null;
    teamId: string | null;
    teamName: string | null;
  };
  summary: {
    leadCount: number;
    customerCount: number;
    dealCount: number;
    projectCount: number;
    quoteCount: number;
    contractCount: number;
    quotesOverSlaCount: number;
    pipelineValueVnd: number;
  };
}

export interface ProgressLeadItem {
  leadId: string;
  leadName: string | null;
  companyName: string | null;
  status: string | null;
  statusLabel: string | null;
  sinceAt: string | null;
  sdrName: string | null;
  nextStep: string | null;
  followUpDate: string | null;
  deepLink: string;
}

export interface ProgressCustomerItem {
  customerId: string;
  customerName: string | null;
  companyName: string | null;
  status: string | null;
  dealCount: number;
  pipelineValueVnd: number;
  deepLink: string;
}

export interface ProgressDealItem {
  dealId: string;
  customerName: string | null;
  companyName: string | null;
  dealStage: string | null;
  dealStageLabel: string | null;
  sinceAt: string | null;
  estimatedBudgetVnd: number;
  followUpDate: string | null;
  quoteId: string | null;
  projectId: string | null;
  customerId: string | null;
  sdrId: string | null;
  sdrName: string | null;
  leadedById: string | null;
  leadedByName: string | null;
  deepLink: string;
}

export interface ProgressProjectItem {
  projectId: string;
  projectCode: string | null;
  projectName: string | null;
  customerId: string | null;
  customerName: string | null;
  status: string | null;
  statusLabel: string | null;
  managerName: string | null;
  deepLink: string;
}

export type QuoteSlaStatus = 'not_set' | 'in_progress' | 'due_soon' | 'overdue' | 'completed_on_time' | 'completed_late';

export interface ProgressQuoteSla {
  startedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  status: QuoteSlaStatus;
}

export interface ProgressQuoteItem {
  quoteId: string;
  quoteNumber: string | null;
  dealId: string | null;
  projectId: string | null;
  customerName: string | null;
  projectName: string | null;
  processingStage: string;
  processingStageLabel: string;
  technicalOwnerId: string | null;
  technicalOwnerName: string | null;
  quoteOwnerId: string | null;
  quoteOwnerName: string | null;
  timeInCurrentStage: { sinceAt: string | null };
  sla: ProgressQuoteSla;
  totalAmountVnd: number;
  currency: string;
  deepLink: string;
}

export interface ProgressContractItem {
  contractId: string;
  contractNumber: string | null;
  title: string | null;
  status: string | null;
  statusLabel: string | null;
  sinceAt: string | null;
  contractValueVnd: number;
  currency: string;
  dealId: string | null;
  quoteId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  deepLink: string;
}

export interface ProgressListResponse<T> {
  total: number;
  items: T[];
}

export interface ProgressQuotesResponse extends ProgressListResponse<ProgressQuoteItem> {
  scope: ProgressScope;
}

export interface ProgressRecordItem {
  customerId: string;
  customerName: string | null;
  companyName: string | null;
  status: string | null;
  ownerName: string | null;
  deepLink: string;
}

export interface ProgressRecordsResponse extends ProgressListResponse<ProgressRecordItem> {
  scope: ProgressScope;
}

/** Reuse THẲNG endpoint Customer 360 đã có sẵn (`/crm/customers/{id}/related`,
 * dùng chung bởi CrmCustomerDetailPage.tsx) cho Customer Quick View trong
 * module Quản lý tiến độ - không phải endpoint mới, response raw snake_case
 * (khác các type camelCase khác trong file này vì đây là service khác,
 * KHÔNG đi qua progress_service.py). Chỉ khai báo đúng field thật sự dùng để
 * render, phần còn lại đọc optional. */
export interface CustomerRelatedRow {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  owner_id?: string | null;
  note?: string | null;
}

export interface CustomerRelatedDeal {
  id: string;
  customer_name?: string | null;
  deal_stage?: string | null;
  estimated_budget?: number | null;
  follow_up_date?: string | null;
  stage_entered_at?: string | null;
}

export interface CustomerRelatedProject {
  id: string;
  name?: string | null;
  project_code?: string | null;
  status?: string | null;
  manager_id?: string | null;
}

export interface CustomerRelatedQuote {
  id: string;
  quote_number?: string | null;
  processing_stage?: string | null;
  status?: string | null;
  total_amount?: number | null;
  currency?: string | null;
}

export interface CustomerRelatedContract {
  id: string;
  contract_number?: string | null;
  title?: string | null;
  status?: string | null;
  contract_value?: number | null;
  currency?: string | null;
}

export interface CustomerRelatedRecords {
  customer: CustomerRelatedRow;
  deals: CustomerRelatedDeal[];
  projects: CustomerRelatedProject[];
  quotes: CustomerRelatedQuote[];
  contracts: CustomerRelatedContract[];
  kpi: { deal_count: number; quote_count: number; contract_count: number; total_value: number };
}

export interface ContractActivityLogItem {
  id: string;
  contractId: string | null;
  actorId: string | null;
  action: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string | null;
}

/** "Cảnh báo cấp quản lý" (GET /progress/alerts) - CHỈ gom vấn đề có nguồn dữ
 * liệu thật (SLA thật cho Quote, follow_up_date thật cho Deal, sinceAt thuần
 * cho Lead/Contract - không suy diễn "quá hạn" cho 2 loại sau). */
export interface ProgressAlerts {
  scope: ProgressScope;
  quotesOverdue: ProgressQuoteItem[];
  quotesDueSoon: ProgressQuoteItem[];
  quotesNotSet: ProgressQuoteItem[];
  overdueFollowUpDeals: ProgressDealItem[];
  longStandingLeads: ProgressLeadItem[];
  longStandingContracts: ProgressContractItem[];
}

/** GET /progress/search?q=... - Team/Member/Customer trả id+tên tối thiểu
 * (Quick View của chúng tự fetch theo id); Lead/Deal/Project/Quote/Contract
 * trả full item để mở Quick View tại chỗ không cần gọi thêm API. */
export interface ProgressSearchTeamHit {
  teamId: string;
  teamName: string | null;
}

export interface ProgressSearchMemberHit {
  userId: string;
  userName: string | null;
  teamName: string | null;
}

export interface ProgressSearchCustomerHit {
  customerId: string;
  customerName: string | null;
  companyName: string | null;
}

export interface ProgressSearchResults {
  teams: ProgressSearchTeamHit[];
  members: ProgressSearchMemberHit[];
  leads: ProgressLeadItem[];
  customers: ProgressSearchCustomerHit[];
  deals: ProgressDealItem[];
  projects: ProgressProjectItem[];
  quotes: ProgressQuoteItem[];
  contracts: ProgressContractItem[];
}
