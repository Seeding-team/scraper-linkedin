export type BillingType = 'one_time' | 'monthly' | 'yearly';

export type DealStage =
  | 'new_lead'
  | 'contacted'
  | 'qualified'
  | 'requirement'
  | 'proposal_sent'
  | 'negotiation'
  | 'contract_sent'
  | 'on_hold'
  | 'won'
  | 'lost';

export type ContractStatus =
  | 'moi_tiep_nhan'
  | 'dang_xu_ly'
  | 'da_bao_gia'
  | 'dang_dam_phan'
  | 'da_chot'
  | 'tam_dung'
  | 'khong_hoat_dong'
  | '';

export type PaymentStatus =
  | 'chua_thanh_toan'
  | 'thanh_toan_mot_phan'
  | 'da_thanh_toan'
  | 'qua_han'
  | '';

export interface QuoteReference {
  id?: string;
  number?: string;
  url?: string;
  totalAmount?: number;
  /** 'draft' = Chưa duyệt, 'approved' = Đã duyệt, 'confirmed' = báo giá cũ (tương thích ngược). */
  status?: 'draft' | 'confirmed' | 'approved' | 'cancelled';
  /** V1/V2/V3... trong chuỗi phiên bản (mặc định 1 nếu báo giá cũ chưa có chuỗi). */
  versionNumber?: number;
  versionChainId?: string;
}

export interface Contact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  companyName?: string;
  avatarUrl?: string;
}

export interface StageHistory {
  id: string;
  createdAt: string;
  action: 'created' | 'stage_change' | 'updated';
  fromStage?: DealStage | '';
  toStage?: DealStage;
  note?: string;
  actor?: string;
}

export interface Assignment {
  ownerUserId?: string;
  createdById?: string;
  assignedUserId?: string;
  sdrId?: string;
  sdrName?: string;
  sdrNameHint?: string;
  leadedById?: string;
  leadName?: string;
  leadedByNameHint?: string;
  ownerName?: string;
}

export interface CrmUserOption {
  id: string;
  name: string;
  role?: string;
}

export interface ContractInfo {
  code?: string;
  status?: ContractStatus;
  paymentStatus?: PaymentStatus;
  paymentDueDate?: string;
  signedAt?: string;
  warrantyExpiresAt?: string;
  customerSince?: string;
  lastCareAt?: string;
  title?: string;
  url?: string;
  note?: string;
}

export interface OutcomeInfo {
  reasonText?: string;
  note?: string;
  reviewedAt?: string;
  reviewType?: 'won' | 'lost' | '';
  result?: string;
  confidence?: string;
  reasons?: string[];
  rootCause?: string;
  evidence?: string;
  competitor?: string;
  influencer?: string;
  trigger?: string;
  objection?: string;
  fitScore?: string;
  salesScore?: string;
  priceScore?: string;
  trustScore?: string;
  speedScore?: string;
  repeat?: string;
  improve?: string;
  reuseSegment?: string;
  reuseLevel?: string;
  knowledgeTags?: string;
  kbOwner?: string;
  kbReviewer?: string;
  kbStatus?: string;
  kbScope?: string;
}

export interface Deal {
  id: string;
  contactId: string;
  dealId: string;
  customerId?: string;
  customerName: string;
  position?: string;
  positionCategoryId?: string;
  positionLabelSnapshot?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  zalo?: string;
  facebook?: string;
  telegram?: string;
  website?: string;
  taxCode?: string;
  address?: string;
  city?: string;
  industry?: string;
  sourcePlatform: string;
  servicePackage?: string;
  package?: string;
  stage: DealStage;
  prevStage?: DealStage | '';
  stageEnteredAt: string;
  daysInStage: number;
  stageHistory: StageHistory[];
  decisionMaker?: string;
  estimatedBudget?: number;
  lifetimeValue?: number;
  /** Loại thanh toán: một lần / theo tháng / theo năm (migration 052). */
  billingType?: BillingType;
  followUpDate?: string;
  /** Việc cần làm tiếp theo cho deal này — bắt buộc lúc tạo mới trong popup gọn. */
  nextStep?: string;
  contract: ContractInfo;
  outcome: OutcomeInfo;
  quote?: QuoteReference;
  assignment: Assignment;
  note?: string;
  pauseReason?: string;
  closedAt?: string;
  closedReason?: string;
  crmStatus?: 'open' | 'won' | 'lost';
  createdAt: string;
  updatedAt: string;
  /** Team gán cho deal này (chọn tay trong form deal, migration 050). */
  teamId?: string;
  teamName?: string;
  teamType?: string;
  customerProfileMessage?: string;
}

export type CrmCustomerStatus = 'new_lead' | 'following' | 'current_customer' | 'not_fit';

export interface CrmCustomerSummary {
  id: string;
  customerName: string;
  companyName?: string;
  position?: string;
  positionCategoryId?: string;
  positionLabelSnapshot?: string;
  phone?: string;
  email?: string;
  source?: string;
  status?: CrmCustomerStatus;
  ownerId?: string;
  canEdit?: boolean;
  dealCount?: number;
  totalValue?: number;
  lastDealAt?: string;
  /** So Contact that thuoc khach hang nay (migration khong can - backend gan
   * them field nay o _attach_customer_metrics, xem crm_customer_service.py). */
  contactCount?: number;
}

/**
 * Hồ sơ khách hàng đầy đủ (khớp CrmCustomerResponse ở backend
 * app/modules/all_platform/schemas/crm_customer.py) — dùng cho trang danh
 * sách/chi tiết hồ sơ khách hàng (`crm_customers`, KHÁC `customer_leads`/Deal).
 * Mở rộng CrmCustomerSummary (không phá vỡ chỗ đang dùng CrmCustomerSummary
 * cho combobox chọn khách hàng lúc tạo deal).
 */
export interface CrmCustomerRow extends CrmCustomerSummary {
  zalo?: string;
  facebook?: string;
  telegram?: string;
  website?: string;
  taxCode?: string;
  address?: string;
  city?: string;
  industry?: string;
  note?: string;
  phoneNormalized?: string;
  emailNormalized?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CrmCustomerKpi {
  total: number;
  new_lead: number;
  following: number;
  current_customer: number;
  not_fit: number;
}

export interface CrmCustomerListResult {
  items: CrmCustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  kpi: CrmCustomerKpi;
}

/**
 * Contact (người liên hệ) thuộc 1 hồ sơ khách hàng (`crm_contacts`) — khớp
 * CrmContactResponse ở backend (app/modules/all_platform/schemas/crm_contact.py).
 * Khác CrmCustomerRow: hồ sơ khách hàng đại diện cho DOANH NGHIỆP, còn contact
 * là 1 người cụ thể (có thể có nhiều contact/khách hàng).
 */
export interface CrmContact {
  id: string;
  customerId: string;
  name: string;
  position?: string;
  positionCategoryId?: string;
  positionLabelSnapshot?: string;
  phone?: string;
  email?: string;
  zalo?: string;
  facebook?: string;
  isPrimary?: boolean;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CrmRelatedDeal {
  id: string;
  customerName?: string;
  dealStage?: string;
  estimatedBudget?: number;
  lifetimeValue?: number;
  updatedAt?: string;
}

export interface CrmRelatedQuote {
  id: string;
  quoteNumber?: string;
  status?: string;
  totalAmount?: number;
  dealId?: string;
}

export interface CrmRelatedContract {
  id: string;
  contractNumber?: string;
  status?: string;
  dealId?: string;
}

export interface CrmCustomerRelated {
  customer: CrmCustomerRow | null;
  deals: CrmRelatedDeal[];
  quotes: CrmRelatedQuote[];
  contracts: CrmRelatedContract[];
  kpi: {
    dealCount: number;
    quoteCount: number;
    contractCount: number;
    totalValue: number;
  };
}

export interface DealFilters {
  search?: string;
  source?: string;
  city?: string;
  industry?: string;
  stages?: DealStage[];
}

export interface AnalyticsFilters {
  period?: 'all' | 'month' | 'quarter';
  industry?: string;
  city?: string;
  source?: string;
  owner?: string;
}

export type CreateDealInput = Omit<
  Deal,
  | 'id'
  | 'contactId'
  | 'dealId'
  | 'stageEnteredAt'
  | 'daysInStage'
  | 'stageHistory'
  | 'createdAt'
  | 'updatedAt'
  | 'contract'
  | 'outcome'
  | 'assignment'
> & {
  customerId?: string;
  updateCustomerProfile?: boolean;
  idempotencyKey?: string;
  contract?: ContractInfo;
  outcome?: OutcomeInfo;
  assignment?: Assignment;
};

export type UpdateDealInput = Partial<CreateDealInput> & {
  contract?: Partial<ContractInfo>;
  outcome?: Partial<OutcomeInfo>;
  assignment?: Partial<Assignment>;
};

export interface StageTransitionInput {
  note?: string;
  pauseReason?: string;
  attachmentUrl?: string;
  decisionMaker?: string;
  estimatedBudget?: number;
  followUpDate?: string;
  outcome?: Partial<OutcomeInfo>;
}

export interface RevenueRow {
  label: string;
  value: number;
  percent: number;
  color: string;
}

// ===== Leads (crm_leads) — trang riêng /all-platform/crm/leads, KHÁC hẳn
// CrmCustomerRow (crm_customers) và Deal (customer_leads). Khớp
// CrmLeadResponse ở backend (app/modules/all_platform/schemas/crm_lead.py). =====
export type CrmLeadStatus = 'new_lead' | 'qualifying' | 'qualified' | 'nurture' | 'converted' | 'disqualified';

export interface CrmLeadRow {
  id: string;
  leadName: string;
  companyName?: string;
  position?: string;
  positionCategoryId?: string;
  positionLabelSnapshot?: string;
  phone?: string;
  email?: string;
  zalo?: string;
  facebook?: string;
  telegram?: string;
  website?: string;
  source?: string;
  status: CrmLeadStatus;
  score?: number | null;
  sdrId?: string;
  note?: string;
  qualificationNeed?: string;
  qualificationIcpFit?: boolean | null;
  qualificationEstimatedValue?: number | null;
  qualificationDecisionMaker?: string;
  qualificationExpectedTimeline?: string;
  qualificationAeId?: string;
  nextStep?: string;
  followUpDate?: string;
  convertedCustomerId?: string;
  convertedContactId?: string;
  convertedDealId?: string;
  convertedAt?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  canWrite?: boolean;
}

export interface CrmLeadKpi {
  total: number;
  new_lead: number;
  qualifying: number;
  qualified: number;
}

export interface CrmAnalytics {
  totalDeals: number;
  openDeals: number;
  wonDeals: number;
  winRate: number;
  wonValue: number;
  pipelineValue: number;
  industryRows: RevenueRow[];
  regionRows: RevenueRow[];
  categoryRows: RevenueRow[];
  marketingTips: string[];
  executiveNotes: string[];
  topIndustry: string;
  topRegion: string;
  topCategory: string;
}
