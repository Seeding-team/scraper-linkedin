import { API_BASE_URL, API_KEY } from '@/lib/env';
import {
  CRM_PACKAGE_OPTIONS,
  getContractStatusForStage,
  getServicePackageText,
  isCrmDocumentUrl,
  parseMoney,
} from '../constants/crmConfig';
import type {
  AnalyticsFilters,
  ContractStatus,
  CreateDealInput,
  CrmAnalytics,
  CrmCustomerSummary,
  CrmUserOption,
  Deal,
  DealFilters,
  DealStage,
  OutcomeInfo,
  PaymentStatus,
  QuoteReference,
  RevenueRow,
  StageHistory,
  StageTransitionInput,
  UpdateDealInput,
} from '../types';
import type { CrmRepository } from './CrmRepository';

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type ValidationErrorPayload = {
  errors?: string[];
};

type CustomerLeadRow = {
  id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  website?: string | null;
  industry?: string | null;
  tax_code?: string | null;
  leaded_by?: string | null;
  leaded_by_name_hint?: string | null;
  source_platform?: string | null;
  sdr_id?: string | null;
  sdr_name_hint?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  team_type?: string | null;
  status?: 'pending' | 'closed' | 'rejected' | string | null;
  activity_status?: string | null;
  deal_stage?: DealStage | null;
  prev_stage?: DealStage | null;
  follow_up_date?: string | null;
  decision_maker?: string | null;
  estimated_budget?: number | string | null;
  stage_entered_at?: string | null;
  days_in_stage?: number | null;
  customer_since?: string | null;
  service_package?: string | null;
  lifetime_value?: number | string | null;
  billing_type?: string | null;
  contract_signed_at?: string | null;
  contract_status?: string | null;
  warranty_expires_at?: string | null;
  care_note?: string | null;
  last_care_at?: string | null;
  payment_due_date?: string | null;
  payment_status?: string | null;
  last_attachment_url?: string | null;
  last_attachment_name?: string | null;
  note?: string | null;
  reject_reason?: string | null;
  reject_reason_type?: string | null;
  review_result?: string | null;
  closed_reason?: string | null;
  tags?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  leader_name?: string | null;
  sdr_name?: string | null;
  position?: string | null;
  position_category_id?: string | null;
  position_label_snapshot?: string | null;
  crm_package?: string | null;
  zalo?: string | null;
  facebook?: string | null;
  telegram?: string | null;
  pause_reason?: string | null;
  next_step?: string | null;
  closed_at?: string | null;
  outcome_detail?: Record<string, unknown> | null;
  quote_id?: string | null;
  quote_number?: string | null;
  quote_total_amount?: number | string | null;
  quote_public_url?: string | null;
  quote_status?: string | null;
  quote_version_number?: number | null;
  quote_version_chain_id?: string | null;
};

type CustomerLeadList = {
  items?: CustomerLeadRow[];
  total?: number;
  page?: number;
  page_size?: number;
};

type CrmCustomerRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  position?: string | null;
  position_category_id?: string | null;
  position_label_snapshot?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  status?: CrmCustomerSummary['status'] | null;
  owner_id?: string | null;
  can_edit?: boolean | null;
  deal_count?: number | null;
  total_value?: number | string | null;
  last_deal_at?: string | null;
};

type CreateCustomerWithDealResponse = {
  customer?: CrmCustomerRow;
  deal?: CustomerLeadRow;
  partial?: boolean;
  partial_message?: string;
};

type ActivityLogRow = {
  id: string;
  action: string;
  from_stage?: DealStage | null;
  to_stage?: DealStage | null;
  actor_name?: string | null;
  actor?: string | null;
  note?: string | null;
  created_at: string;
};

// Ban đầu khớp với CHECK constraint source_platform ở migration
// 032_expand_source_platform.sql, nhưng migration 056 đã GỠ hẳn constraint đó
// và giao việc kiểm soát danh mục nguồn hợp lệ cho bảng `categories`
// (category_type='crm_source') — whitelist cứng dưới đây từ đó đã LỖI THỜI
// (chặn nhầm mọi nguồn thêm mới qua trang Danh mục hoặc migration data, dù
// backend/DB đã chấp nhận). Thêm 3 giá trị của "Nguồn cơ hội"
// (CreateOpportunityDrawer.tsx, migration 080_crm_source_opportunity_values.sql)
// vào đây — KHÔNG xoá hẳn assertSupportedSource() để giữ nguyên hành vi chặn
// lỗi gõ tay hiện có, nằm ngoài phạm vi task này.
const SUPPORTED_SOURCE_PLATFORMS = new Set([
  'Manual', 'FB_Inbox', 'FB_Group', 'Zalo', 'Website', 'Referral', 'MarkeeChat',
  'Existing_Customer', 'Lead_Convert', 'Upsell',
]);
// Migration 041 mo rong CHECK constraint contract_status ho tro du 7 gia tri
// cua crm-next (truoc day DB chi nhan 3 gia tri legacy active/completed/
// maintenance, cac gia tri con lai bi contractStatusToDb() am tham bo qua).
const CRM_CONTRACT_STATUSES = new Set([
  'moi_tiep_nhan',
  'dang_xu_ly',
  'da_bao_gia',
  'dang_dam_phan',
  'da_chot',
  'tam_dung',
  'khong_hoat_dong',
  'active',
  'completed',
  'maintenance',
]);
const INTERNAL_HIDDEN_TAG = 'crm_internal_hidden';
const CRM_PACKAGE_VALUES = new Set(CRM_PACKAGE_OPTIONS.map(option => option.value));

function getDefaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: getDefaultHeaders(),
    ...options,
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok) {
    const errors = (body.data as ValidationErrorPayload | undefined)?.errors;
    const detail = Array.isArray(errors) && errors.length ? `: ${errors.join('; ')}` : '';
    throw new Error(
      body.message === 'Invalid request body'
        ? `Thông tin gửi lên chưa hợp lệ${detail}`
        : body.message || `Lỗi máy chủ (${res.status})`
    );
  }
  if (body.success === false) {
    throw new Error(body.message || 'Khong thuc hien duoc yeu cau CRM.');
  }
  return body;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const body = await apiRequest<T>(path, options);
  return body.data as T;
}

function asText(value: unknown): string {
  return String(value || '').trim();
}

function asDocumentUrl(value: unknown): string {
  const raw = asText(value);
  return isCrmDocumentUrl(raw) ? raw : '';
}

function asNumber(value: unknown): number {
  const numeric = typeof value === 'string' ? parseMoney(value) : Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function cleanDateValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const raw = String(value).trim();
  return raw ? raw : null;
}

function fallbackDate(...values: Array<string | null | undefined>) {
  return values.find(value => Boolean(value)) || new Date().toISOString();
}

function daysInStage(row: CustomerLeadRow): number {
  if (typeof row.days_in_stage === 'number') return row.days_in_stage;
  const raw = row.stage_entered_at;
  if (!raw) return 0;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function normalizeStage(value?: string | null): DealStage {
  const stages: DealStage[] = [
    'new_lead',
    'contacted',
    'qualified',
    'requirement',
    'proposal_sent',
    'negotiation',
    'contract_sent',
    'on_hold',
    'won',
    'lost',
  ];
  return stages.includes(value as DealStage) ? (value as DealStage) : 'new_lead';
}

function contractStatusFromRow(row: CustomerLeadRow, stage: DealStage): ContractStatus {
  const raw = asText(row.contract_status);
  if (CRM_CONTRACT_STATUSES.has(raw)) {
    return raw as ContractStatus;
  }
  return getContractStatusForStage(stage);
}

function paymentStatusFromRow(row: CustomerLeadRow, stage: DealStage): PaymentStatus {
  // Deal đã ở "Hoàn thành" (won) thì ngầm hiểu là đã thanh toán — không hiện lại
  // cảnh báo "Chưa thanh toán/Tới hạn thanh toán" cho deal đã chốt xong nữa.
  if (stage === 'won') return 'da_thanh_toan';
  const raw = asText(row.payment_status);
  const due = row.payment_due_date ? new Date(row.payment_due_date) : null;
  const overdue =
    due &&
    !Number.isNaN(due.getTime()) &&
    due.getTime() < Date.now() &&
    raw !== 'paid';
  if (overdue) return 'qua_han';
  if (raw === 'partial') return 'thanh_toan_mot_phan';
  if (raw === 'paid') return 'da_thanh_toan';
  if (raw === 'unpaid') return 'chua_thanh_toan';
  return '';
}

function paymentStatusToDb(value?: PaymentStatus): 'unpaid' | 'partial' | 'paid' | undefined {
  if (value === 'chua_thanh_toan') return 'unpaid';
  if (value === 'thanh_toan_mot_phan') return 'partial';
  if (value === 'da_thanh_toan') return 'paid';
  return undefined;
}

function assertSupportedSource(value?: string) {
  if (value && !SUPPORTED_SOURCE_PLATFORMS.has(value)) {
    throw new Error(`Nguon lead "${value}" chua duoc database Seeding ho tro persist.`);
  }
}

function contractStatusToDb(value?: string): string | undefined {
  if (value && CRM_CONTRACT_STATUSES.has(value)) return value;
  return undefined;
}

function normalizeTags(value?: string[] | null) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getDealPackage(row: CustomerLeadRow) {
  const crmPackage = asText(row.crm_package);
  if (crmPackage) return crmPackage;
  const servicePackage = asText(row.service_package);
  return CRM_PACKAGE_VALUES.has(servicePackage) ? servicePackage : '';
}

function getDealServicePackage(row: CustomerLeadRow) {
  const servicePackage = asText(row.service_package);
  return CRM_PACKAGE_VALUES.has(servicePackage) ? '' : servicePackage;
}

function reviewResultForOutcome(outcome?: Partial<OutcomeInfo>): string | undefined {
  if (outcome?.reviewType === 'won') return 'Qualify';
  if (outcome?.reviewType === 'lost') return 'Disqualify';
  return undefined;
}

// Migration 041 them cot outcome_detail (JSONB) luu nguyen OutcomeInfo (25
// truong: confidence, reasons, rootCause, evidence, cac diem so, cac truong
// knowledge-base...) - thay cho cach cu nhet JSON string co prefix
// "CRM_OUTCOME_V1:" vao closed_reason (closed_reason gio chi con la text ly
// do ngan, dung dung nghia cot).
function serializeOutcome(outcome?: Partial<OutcomeInfo>): Record<string, unknown> | undefined {
  if (!outcome) return undefined;
  return {
    ...outcome,
    reviewedAt: outcome.reviewedAt || new Date().toISOString(),
  };
}

function parseOutcomeFromRow(row: CustomerLeadRow, stage: DealStage): OutcomeInfo {
  if (row.outcome_detail && typeof row.outcome_detail === 'object') {
    const parsed = row.outcome_detail as OutcomeInfo;
    return {
      ...parsed,
      reviewType: (parsed.reviewType || (stage === 'won' || stage === 'lost' ? stage : '')) as OutcomeInfo['reviewType'],
      reasonText: parsed.reasonText || asText(row.reject_reason),
    };
  }

  const reviewType = stage === 'won' || stage === 'lost' ? stage : '';
  const legacyClosedReason = asText(row.closed_reason);
  const legacyResult = asText(row.review_result);
  return {
    reasonText: asText(row.reject_reason) || legacyClosedReason,
    rootCause: asText(row.reject_reason) || legacyClosedReason,
    result: legacyResult === 'Qualify' || legacyResult === 'Disqualify' || legacyResult === 'Chua_xem_xet'
      ? ''
      : legacyResult,
    reviewType,
  };
}

function activityToHistory(row: ActivityLogRow): StageHistory {
  return {
    id: row.id,
    action: row.action === 'stage_change' ? 'stage_change' : row.action === 'created' ? 'created' : 'updated',
    fromStage: row.from_stage || '',
    toStage: normalizeStage(row.to_stage),
    note: row.note || '',
    actor: row.actor_name || row.actor || '',
    createdAt: row.created_at,
  };
}

function rowToDeal(row: CustomerLeadRow, history: StageHistory[] = []): Deal {
  const stage = normalizeStage(row.deal_stage);
  const estimatedBudget = asNumber(row.estimated_budget);
  const lifetimeValue = asNumber(row.lifetime_value);
  const attachmentUrl = asDocumentUrl(row.last_attachment_url);
  const attachmentName = asText(row.last_attachment_name);
  const createdAt = fallbackDate(row.created_at, row.updated_at);
  const updatedAt = fallbackDate(row.updated_at, row.created_at);
  const quoteTotal = asNumber(row.quote_total_amount) || estimatedBudget || lifetimeValue || undefined;

  return {
    id: row.id,
    contactId: row.id,
    dealId: row.id,
    customerId: asText(row.customer_id),
    position: asText(row.position),
    positionCategoryId: asText(row.position_category_id),
    positionLabelSnapshot: asText(row.position_label_snapshot),
    customerName: asText(row.customer_name) || 'Khách hàng chưa tên',
    companyName: asText(row.company_name),
    phone: asText(row.phone),
    email: asText(row.email),
    zalo: asText(row.zalo),
    facebook: asText(row.facebook),
    telegram: asText(row.telegram),
    website: asText(row.website),
    taxCode: asText(row.tax_code),
    address: asText(row.address),
    city: asText(row.city),
    industry: asText(row.industry),
    sourcePlatform: asText(row.source_platform) || 'Manual',
    servicePackage: getDealServicePackage(row),
    package: getDealPackage(row),
    stage,
    prevStage: row.prev_stage || '',
    stageEnteredAt: fallbackDate(row.stage_entered_at, row.updated_at, row.created_at),
    daysInStage: daysInStage(row),
    stageHistory: history,
    decisionMaker: asText(row.decision_maker),
    estimatedBudget,
    lifetimeValue,
    billingType: (row.billing_type as Deal['billingType']) || 'one_time',
    followUpDate: asText(row.follow_up_date),
    contract: {
      status: contractStatusFromRow(row, stage),
      paymentStatus: paymentStatusFromRow(row, stage),
      paymentDueDate: asText(row.payment_due_date),
      signedAt: asText(row.contract_signed_at),
      warrantyExpiresAt: asText(row.warranty_expires_at),
      customerSince: asText(row.customer_since),
      lastCareAt: asText(row.last_care_at),
      title: attachmentName,
      url: attachmentUrl,
      note: asText(row.care_note),
    },
    outcome: parseOutcomeFromRow(row, stage),
    quote: row.quote_id || attachmentUrl || quoteTotal
      ? {
          id: row.quote_id || undefined,
          url: asText(row.quote_public_url) || attachmentUrl || undefined,
          number: asText(row.quote_number) || attachmentName || undefined,
          totalAmount: quoteTotal,
          status: (asText(row.quote_status) || undefined) as QuoteReference['status'],
          versionNumber: row.quote_version_number || undefined,
          versionChainId: asText(row.quote_version_chain_id) || undefined,
        }
      : undefined,
    assignment: {
      sdrId: asText(row.sdr_id),
      sdrName: asText(row.sdr_name),
      sdrNameHint: asText(row.sdr_name_hint),
      leadedById: asText(row.leaded_by),
      leadName: asText(row.leader_name),
      leadedByNameHint: asText(row.leaded_by_name_hint),
      ownerUserId: asText(row.leaded_by),
      ownerName: asText(row.leader_name),
      assignedUserId: asText(row.sdr_id),
    },
    note: asText(row.note),
    nextStep: asText(row.next_step),
    pauseReason: asText(row.pause_reason) || (stage === 'on_hold' ? asText(row.note) : ''),
    closedAt: asText(row.closed_at) || (stage === 'won' || stage === 'lost' ? fallbackDate(row.customer_since, row.updated_at) : ''),
    closedReason: asText(row.closed_reason),
    crmStatus: stage === 'won' || stage === 'lost' ? stage : 'open',
    teamId: asText(row.team_id),
    teamName: asText(row.team_name),
    teamType: asText(row.team_type),
    createdAt,
    updatedAt,
  };
}

function rowToCustomer(row: CrmCustomerRow): CrmCustomerSummary {
  return {
    id: row.id,
    customerName: asText(row.customer_name),
    companyName: asText(row.company_name),
    position: asText(row.position),
    positionCategoryId: asText(row.position_category_id),
    positionLabelSnapshot: asText(row.position_label_snapshot),
    phone: asText(row.phone),
    email: asText(row.email),
    source: asText(row.source),
    status: row.status || undefined,
    ownerId: asText(row.owner_id),
    canEdit: Boolean(row.can_edit),
    dealCount: Number(row.deal_count || 0),
    totalValue: asNumber(row.total_value),
    lastDealAt: asText(row.last_deal_at),
  };
}

function toCrmCustomerPayload(input: CreateDealInput): Partial<CrmCustomerRow> {
  return {
    customer_name: input.customerName,
    company_name: input.companyName,
    position_category_id: input.positionCategoryId,
    phone: input.phone,
    email: input.email,
    source: input.sourcePlatform || 'Manual',
    owner_id: input.assignment?.sdrId || input.assignment?.leadedById || undefined,
  };
}

function toCustomerPayload(input: CreateDealInput | UpdateDealInput): Partial<CustomerLeadRow> {
  assertSupportedSource(input.sourcePlatform);

  const paymentStatus = paymentStatusToDb(input.contract?.paymentStatus);
  const contractStatus = contractStatusToDb(input.contract?.status);
  const payload: Partial<CustomerLeadRow> = {};

  if ('customerName' in input) payload.customer_name = input.customerName;
  if ('companyName' in input) payload.company_name = input.companyName;
  if ('phone' in input) payload.phone = input.phone;
  if ('email' in input) payload.email = input.email;
  if ('zalo' in input) payload.zalo = input.zalo;
  if ('facebook' in input) payload.facebook = input.facebook;
  if ('telegram' in input) payload.telegram = input.telegram;
  if ('address' in input) payload.address = input.address;
  if ('city' in input) payload.city = input.city;
  if ('website' in input) payload.website = input.website;
  if ('industry' in input) payload.industry = input.industry;
  if ('taxCode' in input) payload.tax_code = input.taxCode;
  if ('sourcePlatform' in input) payload.source_platform = input.sourcePlatform;
  if ('servicePackage' in input) payload.service_package = input.servicePackage;
  if ('package' in input) payload.crm_package = input.package;
  if ('positionCategoryId' in input) payload.position_category_id = input.positionCategoryId;
  if ('stage' in input) payload.deal_stage = input.stage;
  if ('decisionMaker' in input) payload.decision_maker = input.decisionMaker;
  if ('estimatedBudget' in input) payload.estimated_budget = input.estimatedBudget;
  if ('lifetimeValue' in input) payload.lifetime_value = input.lifetimeValue;
  if ('billingType' in input) payload.billing_type = input.billingType;
  if ('followUpDate' in input) payload.follow_up_date = cleanDateValue(input.followUpDate);
  if ('note' in input) payload.note = input.note;
  if ('nextStep' in input) payload.next_step = input.nextStep;
  if ('pauseReason' in input) payload.pause_reason = input.pauseReason;
  if ('closedAt' in input) payload.closed_at = cleanDateValue(input.closedAt);
  if ('teamId' in input) payload.team_id = input.teamId || null;

  if (input.assignment) {
    if ('leadedById' in input.assignment) payload.leaded_by = input.assignment.leadedById;
    if ('leadedByNameHint' in input.assignment) payload.leaded_by_name_hint = input.assignment.leadedByNameHint;
    if ('sdrId' in input.assignment) payload.sdr_id = input.assignment.sdrId;
    if ('sdrNameHint' in input.assignment) payload.sdr_name_hint = input.assignment.sdrNameHint;
  }

  if (input.contract) {
    if ('signedAt' in input.contract) payload.contract_signed_at = cleanDateValue(input.contract.signedAt);
    if ('warrantyExpiresAt' in input.contract) payload.warranty_expires_at = cleanDateValue(input.contract.warrantyExpiresAt);
    if ('customerSince' in input.contract) payload.customer_since = cleanDateValue(input.contract.customerSince);
    if ('lastCareAt' in input.contract) payload.last_care_at = cleanDateValue(input.contract.lastCareAt);
    if ('paymentDueDate' in input.contract) payload.payment_due_date = cleanDateValue(input.contract.paymentDueDate);
    if (contractStatus) payload.contract_status = contractStatus;
    if (paymentStatus) payload.payment_status = paymentStatus;
    if ('url' in input.contract) payload.last_attachment_url = asDocumentUrl(input.contract.url);
    if ('title' in input.contract) payload.last_attachment_name = input.contract.title;
    if ('note' in input.contract) payload.care_note = input.contract.note;
  }

  if (input.quote) {
    // quote.id that = deal da lien ket 1 ban ghi quotes that (tao qua wizard
    // bao gia) - uu tien gan quote_id that thay vi nhet url/so vao
    // last_attachment_*. Van giu fallback last_attachment_* cho truong hop
    // nhap tay 1 link ngoai (khong qua module Quote).
    if (input.quote.id) {
      payload.quote_id = input.quote.id;
    } else {
      if (input.quote.url) payload.last_attachment_url = asDocumentUrl(input.quote.url);
      if (input.quote.number) payload.last_attachment_name = input.quote.number;
    }
    if (input.quote.totalAmount && !payload.estimated_budget) {
      payload.estimated_budget = input.quote.totalAmount;
    }
  }

  if (input.outcome) {
    const reviewType = input.outcome.reviewType || (input.stage === 'won' || input.stage === 'lost' ? input.stage : '');
    const normalizedOutcome: Partial<OutcomeInfo> = {
      ...input.outcome,
      reviewType,
      reviewedAt: input.outcome.reviewedAt || new Date().toISOString(),
    };
    const reviewResult = reviewResultForOutcome(normalizedOutcome);
    if (reviewResult) payload.review_result = reviewResult;
    payload.outcome_detail = serializeOutcome(normalizedOutcome);
    payload.closed_reason = normalizedOutcome.reasonText || normalizedOutcome.rootCause || undefined;
    if (reviewType === 'lost' && (normalizedOutcome.reasonText || normalizedOutcome.rootCause)) {
      payload.reject_reason = normalizedOutcome.reasonText || normalizedOutcome.rootCause;
    }
    const reasonType = normalizedOutcome.result || normalizedOutcome.reasons?.[0];
    if (reviewType === 'lost' && reasonType) payload.reject_reason_type = rejectReasonToDb(reasonType);
  }

  return payload;
}

function getDealValue(deal: Deal) {
  return Number(deal.quote?.totalAmount || deal.estimatedBudget || deal.lifetimeValue || 0);
}

function periodMatch(deal: Deal, period?: AnalyticsFilters['period']) {
  if (!period || period === 'all') return true;
  const raw = deal.closedAt || deal.updatedAt || deal.createdAt;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (period === 'month') {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  const quarter = Math.floor(now.getMonth() / 3);
  return date.getFullYear() === now.getFullYear() && Math.floor(date.getMonth() / 3) === quarter;
}

function withPercent(rows: Array<{ label: string; value: number }>): RevenueRow[] {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#14b8a6', '#ef4444'];
  return rows.slice(0, 6).map((row, index) => ({
    ...row,
    percent: total ? Math.round((row.value / total) * 100) : 0,
    color: colors[index % colors.length],
  }));
}

function groupRevenue(deals: Deal[], getter: (deal: Deal) => string | undefined, fallback: string) {
  const map = new Map<string, number>();
  deals.forEach(deal => {
    const label = getter(deal) || fallback;
    map.set(label, (map.get(label) || 0) + getDealValue(deal));
  });
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function rejectReasonToDb(value?: string): string | undefined {
  if (value === 'no_response') return 'Khong_lien_lac_duoc';
  if (value === 'no_budget') return 'Khong_du_tai_chinh';
  if (value === 'timing') return 'Chua_phu_hop_thoi_diem';
  if (value) return 'Khac';
  return undefined;
}

export class SeedingCrmRepository implements CrmRepository {
  async getDeals(filters?: DealFilters): Promise<Deal[]> {
    const query = new URLSearchParams();
    if (filters?.search) query.set('search', filters.search);
    if (filters?.city) query.set('city', filters.city);
    if (filters?.industry) query.set('industry', filters.industry);
    if (filters?.source) query.set('source_platform', filters.source);
    if (filters?.stages?.length === 1) query.set('deal_stage', filters.stages[0]);
    query.set('page_size', '500');
    const qs = query.toString() ? `?${query.toString()}` : '';
    const list = await apiFetch<CustomerLeadList>(`/api/all-platform/customer-leads${qs}`);
    let deals = (list.items || [])
      .filter(row => !normalizeTags(row.tags).includes(INTERNAL_HIDDEN_TAG))
      .map(row => rowToDeal(row));
    if (filters?.stages?.length && filters.stages.length > 1) {
      deals = deals.filter(deal => filters.stages?.includes(deal.stage));
    }
    return deals;
  }

  async getDeal(id: string): Promise<Deal> {
    const deals = await this.getDeals();
    const deal = deals.find(item => item.id === id);
    if (!deal) throw new Error('Khong tim thay deal.');
    const log = await apiFetch<{ items?: ActivityLogRow[]; total?: number }>(
      `/api/all-platform/customer-leads/${encodeURIComponent(id)}/activity-log?limit=100`
    );
    return {
      ...deal,
      stageHistory: (log.items || []).map(activityToHistory),
    };
  }

  async createDeal(input: CreateDealInput): Promise<Deal> {
    const dealPayload = toCustomerPayload(input);
    const body = await apiRequest<CreateCustomerWithDealResponse>('/api/all-platform/crm/customers/with-deal', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: input.customerId || undefined,
        update_customer_profile: Boolean(input.updateCustomerProfile),
        idempotency_key: input.idempotencyKey || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined),
        customer: toCrmCustomerPayload(input),
        deal: dealPayload,
      }),
    });
    const row = body.data?.deal;
    if (!row) throw new Error('Backend khong tra ve deal vua tao.');
    return {
      ...rowToDeal(row),
      customerId: asText(body.data?.customer?.id) || asText(row.customer_id),
      customerProfileMessage: body.data?.partial_message || body.message,
    };
  }

  async updateDeal(id: string, input: UpdateDealInput): Promise<Deal> {
    const payload = toCustomerPayload(input);
    const row = await apiFetch<CustomerLeadRow>(`/api/all-platform/customer-leads/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return rowToDeal(row);
  }

  async deleteDeal(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/all-platform/customer-leads/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /** true nếu backend đã cấu hình AI thật (OPENAI_API_KEY) — gọi 1 lần lúc mount để quyết
   * định có hiện khối "AI điền nhanh" hay không, không gọi thử AI thật để check. */
  async getAiParseDealStatus(): Promise<boolean> {
    try {
      const data = await apiFetch<{ configured: boolean }>('/api/all-platform/customer-leads/ai-parse-deal/status');
      return Boolean(data?.configured);
    } catch {
      return false;
    }
  }

  /** Dán văn bản khách hàng → AI trích field cho popup "Thêm deal". Trả về đúng camelCase
   * khớp DealFormState (customerName/companyName/phone/email/servicePackage/
   * estimatedBudget/nextStep/note) — field không suy ra được là null. */
  async parseDealText(text: string): Promise<Partial<Record<
    'customerName' | 'companyName' | 'phone' | 'email' | 'servicePackage' | 'estimatedBudget' | 'nextStep' | 'note',
    string | number | null
  >>> {
    return apiFetch('/api/all-platform/customer-leads/ai-parse-deal', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async moveDeal(id: string, stage: DealStage, payload: StageTransitionInput = {}): Promise<Deal> {
    const isOutcomeStage = stage === 'won' || stage === 'lost';
    const outcome = payload.outcome
      ? ({
          ...payload.outcome,
          reviewType: stage as OutcomeInfo['reviewType'],
          reviewedAt: payload.outcome.reviewedAt || new Date().toISOString(),
        } satisfies Partial<OutcomeInfo>)
      : undefined;
    const transitionPayload = {
      to_stage: stage,
      note: payload.note || payload.pauseReason || outcome?.reasonText || outcome?.rootCause || undefined,
      attachment_url: payload.attachmentUrl || undefined,
      follow_up_date: payload.followUpDate || undefined,
      decision_maker: payload.decisionMaker || undefined,
      estimated_budget: payload.estimatedBudget,
      closed_reason: isOutcomeStage ? (outcome?.reasonText || outcome?.rootCause || undefined) : undefined,
      outcome_detail: isOutcomeStage ? serializeOutcome(outcome) : undefined,
      pause_reason: stage === 'on_hold' ? payload.pauseReason || undefined : undefined,
      reject_reason_type: stage === 'lost'
        ? rejectReasonToDb(outcome?.result || outcome?.reasons?.[0])
        : undefined,
      reject_reason_text: stage === 'lost'
        ? outcome?.reasonText || outcome?.rootCause || payload.note
        : undefined,
    };
    const row = await apiFetch<CustomerLeadRow>(
      `/api/all-platform/customer-leads/${encodeURIComponent(id)}/transition`,
      {
        method: 'POST',
        body: JSON.stringify(transitionPayload),
      }
    );
    if (isOutcomeStage && outcome) {
      return this.updateDeal(id, {
        outcome,
        decisionMaker: payload.decisionMaker,
        estimatedBudget: payload.estimatedBudget,
        followUpDate: payload.followUpDate,
      });
    }
    return rowToDeal(row);
  }

  async getAnalytics(filters?: AnalyticsFilters): Promise<CrmAnalytics> {
    const deals = (await this.getDeals()).filter(deal => {
      if (!periodMatch(deal, filters?.period)) return false;
      if (filters?.industry && deal.industry !== filters.industry) return false;
      if (filters?.city && deal.city !== filters.city) return false;
      if (filters?.source && deal.sourcePlatform !== filters.source) return false;
      if (
        filters?.owner &&
        deal.assignment.sdrId !== filters.owner &&
        deal.assignment.leadedById !== filters.owner
      ) {
        return false;
      }
      return true;
    });
    const wonDeals = deals.filter(deal => deal.stage === 'won');
    const openDeals = deals.filter(deal => !['won', 'lost', 'on_hold'].includes(deal.stage));
    const industryRows = withPercent(groupRevenue(wonDeals, deal => deal.industry, 'Chưa rõ ngành'));
    const regionRows = withPercent(groupRevenue(wonDeals, deal => deal.city, 'Chưa rõ khu vực'));
    const categoryRows = withPercent(groupRevenue(wonDeals, deal => getServicePackageText(deal.servicePackage), 'Chưa rõ danh mục'));
    const wonValue = wonDeals.reduce((sum, deal) => sum + getDealValue(deal), 0);
    const pipelineValue = openDeals.reduce((sum, deal) => sum + getDealValue(deal), 0);
    const topIndustry = industryRows[0]?.label || 'Chưa đủ dữ liệu';
    const topRegion = regionRows[0]?.label || 'Chưa đủ dữ liệu';
    const topCategory = categoryRows[0]?.label || 'Chưa đủ dữ liệu';

    return {
      totalDeals: deals.length,
      openDeals: openDeals.length,
      wonDeals: wonDeals.length,
      winRate: deals.length ? Math.round((wonDeals.length / deals.length) * 1000) / 10 : 0,
      wonValue,
      pipelineValue,
      industryRows,
      regionRows,
      categoryRows,
      marketingTips: [
        industryRows[0] && regionRows[0]
          ? `Tăng chiến dịch cho nhóm ${industryRows[0].label} tại ${regionRows[0].label}.`
          : 'Cần thêm deal hoàn thành để sinh insight marketing chính xác hơn.',
        `Pipeline mở hiện còn ${openDeals.length} deal.`,
      ],
      executiveNotes: [
        `Doanh thu tập trung tốt nhất ở ${topRegion}.`,
        `Ngành đóng góp doanh thu tốt nhất: ${topIndustry}.`,
        `Danh mục có tín hiệu tốt nhất: ${topCategory}.`,
      ],
      topIndustry,
      topRegion,
      topCategory,
    };
  }

  async getAgents(): Promise<CrmUserOption[]> {
    const rows = await apiFetch<Array<{ id: string; name?: string; role?: string }>>(
      '/api/all-platform/customer-leads/sdrs'
    );
    return rows.map(row => ({
      id: row.id,
      name: row.name || row.id,
      role: row.role,
    }));
  }

  async quickSearchCustomers(query: string, limit = 8): Promise<CrmCustomerSummary[]> {
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    const rows = await apiFetch<CrmCustomerRow[]>(`/api/all-platform/crm/customers/quick-search?${qs.toString()}`);
    return (rows || []).map(rowToCustomer);
  }
}

export const seedingCrmRepository = new SeedingCrmRepository();
