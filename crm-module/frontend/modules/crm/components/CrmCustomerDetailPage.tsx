'use client';

import { CustomerProjectsTab } from './CustomerProjectsTab';
import { CustomerQuotesTab } from './CustomerQuotesTab';
import { CustomerContractsTab } from './CustomerContractsTab';
import { CustomerActivityTab } from './CustomerActivityTab';


import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { formatVND, getStageMeta, SOURCE_OPTIONS, SERVICE_PACKAGE_OPTIONS, CRM_PACKAGE_OPTIONS, INDUSTRY_OPTIONS } from '../constants/crmConfig';
import { customerDisplay } from '../utils/customerNames';
import type { CreateDealInput, CrmUserOption, DealStage } from '../types';
import { CustomerFormModal } from './CustomerFormModal';
import { useDealsChanged } from '../utils/dealSync';
import { HandoverDocsCard, type HandoverDoc } from './HandoverDocsCard';
import { CrmContactsPanel } from './CrmContactsPanel';
import { ProjectFormModal } from './ProjectFormModal';
import { DealFormModal, clearDealDraft } from './DealFormModal';
import { CreateOpportunityDrawer } from './CreateOpportunityDrawer';
import { mergeCategoryOptions } from '../hooks/useCrm';
import { Loader2, Plus, Trash2, ChevronDown, ChevronUp, UserCog, X } from './icons';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { SearchableSelect } from './SearchableSelect';
import type { CrmCustomerRow } from '../types';
import { customerProjectsSummaryService, allPlatformCategoriesService, projectsService, type CustomerProjectsSummary, type Project } from '@/services/all-platform.service';
import { formatMoney, relativeTime } from '../utils/quoteDisplay';
import { useMembers } from '@/hooks/useMembers';
import { QuoteWorkspaceModal } from './QuoteWorkspaceModal';
import { CreateQuoteModal } from '../integrations/quotes/CreateQuoteModal';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { IssuerCompany, Quote, QuoteForm } from '@/modules/quotes';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { Deal } from '../types';
import { DealDetailDrawer } from '@/components/all-platform/customers/DealDetailDrawer';
import { ContactDetailDrawer } from '@/components/all-platform/customers/ContactDetailDrawer';
import { StageTransitionModal } from '@/components/all-platform/customers/StageTransitionModal';
import { CrmCustomerModal } from '@/components/all-platform/components/CrmCustomerModal';
import { customerLeadService, type Customer as LiveDealRow, type DealStage as LiveDealStage, type StageTransitionPayload } from '@/services/customer-lead.service';
import { RegisterExternalContractModal } from '@/components/all-platform/customers/RegisterExternalContractModal';
import { contractStatusLabel } from '@/modules/contracts/constants/contractConfig';
import { cascadeSummaryFromBody, cascadeWarningText } from '../utils/cascadeDelete';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CustomerProjectCrmOverview } from './CustomerProjectCrmOverview';
import { CustomerDealSplitTab } from './CustomerDealSplitTab';
import { CustomerOverviewTab } from './CustomerOverviewTab';
import {
  Briefcase,
  TrendingUp,
  FileText,
  Banknote,
  Sparkles,
  Building2,
  UserCheck,
  ExternalLink,
  Phone,
  Mail,
  Edit3,
  ArrowRight,
  ArrowLeft,
  FolderKanban,
  LayoutDashboard,
  Users,
  Target,
  FileCheck,
  Activity,
  Clock,
  Layers,
  CheckCircle2,
  Calendar,
  MoreHorizontal,
  MessageCircle,
} from 'lucide-react';

export function formatContractDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN');
}

// Tai su dung DUNG 1 kieu badge nguon hop dong voi ContractTab (Deal
// Workspace, DealWorkspaceTabs.tsx) - "Hợp đồng" o Customer 360 va o Deal
// Workspace phai hien THONG NHAT vi cung 1 bang `contracts` (Phase 1: hop
// dong resolve qua deal_id HOAC customer_id truc tiep).
export function contractSourceBadge(source?: 'crm' | 'external' | null) {
  return source === 'external' ? (
    <span className="rounded-full bg-slate-500 px-2 py-0.5 text-[10px] font-semibold text-white">Bên ngoài</span>
  ) : (
    <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white">Tạo trong CRM</span>
  );
}

export function getStageSolidBgClass(stage?: string | null): string {
  if (!stage) return 'bg-slate-500';
  const s = stage.toLowerCase();
  if (s === 'new_lead' || s === 'lead' || s === 'potential' || s === 'tiem_nang') return 'bg-slate-500';
  if (s === 'evaluating' || s === 'qualified' || s === 'dealing' || s === 'contacted' || s === 'danh_gia') return 'bg-blue-500';
  if (s === 'proposal_sent' || s === 'requirement' || s === 'quote' || s === 'bao_gia') return 'bg-purple-500';
  if (s === 'negotiation' || s === 'dang_dam_phan' || s === 'contract_sent' || s === 'dam_phan') return 'bg-orange-500';
  if (s === 'won' || s === 'contract_signed' || s === 'payment_1' || s === 'implementation' || s === 'acceptance' || s === 'payment_final' || s === 'post_sale_care' || s === 'thang') return 'bg-green-500';
  if (s === 'lost' || s === 'on_hold' || s === 'thua') return 'bg-red-500';
  return 'bg-blue-500';
}

export type CustomerActivityEntry = {
  id: string;
  action: string;
  from_stage?: string | null;
  to_stage?: string | null;
  note?: string | null;
  actor_name?: string | null;
  created_at: string;
};

export type RelatedPayload = {
  customer?: {
    id: string;
    customer_name?: string | null;
    short_name?: string | null;
    short_name_manual?: boolean | null;
    position_category_id?: string | null;
    company_name?: string | null;
    position?: string | null;
    phone?: string | null;
    email?: string | null;
    zalo?: string | null;
    facebook?: string | null;
    telegram?: string | null;
    website?: string | null;
    tax_code?: string | null;
    address?: string | null;
    city?: string | null;
    industry?: string | null;
    source?: string | null;
    status?: CrmCustomerRow['status'] | null;
    owner_id?: string | null;
    note?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    contact_count?: number | null;
    deal_count?: number | null;
  };
  deals?: Array<{
    id: string;
    customer_name?: string | null;
    short_name?: string | null;
    short_name_manual?: boolean | null;
    position_category_id?: string | null;
    deal_stage?: string | null;
    estimated_budget?: number | string | null;
    lifetime_value?: number | string | null;
    updated_at?: string | null;
    created_at?: string | null;
    project_id?: string | null;
    primary_contact_id?: string | null;
    leader_name?: string | null;
    sdr_name?: string | null;
  }>;
  projects?: Array<{
    id: string;
    name?: string | null;
    project_code?: string | null;
    status?: string | null;
    current_phase?: string | null;
    contract_value?: number | string | null;
    current_quote_value?: number | string | null;
    updated_at?: string | null;
  }>;
  // Nguon: related_records() (crm_customer_service.py) -> supabase.table("quotes").select("*")
  // - TRA VE NGUYEN raw row cua bang quotes (snake_case that, KHONG qua lop
  // chuan hoa camelCase dung o /quotes/by-phase) - dung DUNG ten cot that.
  quotes?: Array<{
    id: string;
    quote_number?: string | null;
    status?: string | null;
    total_amount?: number | string | null;
    deal_id?: string | null;
    project_id?: string | null;
    version_chain_id?: string | null;
    version_number?: number | null;
    processing_stage?: string | null;
    technical_owner_id?: string | null;
    quote_owner_id?: string | null;
    sla_due_at?: string | null;
    approved_at?: string | null;
    published_at?: string | null;
    sent_at?: string | null;
    deleted_at?: string | null;
    updated_at?: string | null;
  }>;
  contracts?: Array<{
    id: string;
    title?: string | null;
    contract_number?: string | null;
    status?: string | null;
    deal_id?: string | null;
    customer_id?: string | null;
    contract_value?: number | string | null;
    signed_at?: string | null;
    end_date?: string | null;
    source?: 'crm' | 'external' | null;
    file_url?: string | null;
    note?: string | null;
    deal_phase?: 'purchase' | 'sale' | null;
    quote_id?: string | null;
    contact_id?: string | null;
  }>;
  kpi?: {
    deal_count?: number;
    quote_count?: number;
    contract_count?: number;
    total_value?: number;
  };
};

const STATUS_LABEL: Record<string, string> = {
  new_lead: 'Tiềm năng',
  following: 'Đang bán',
  current_customer: 'Đã mua',
  not_fit: 'Ngừng hoạt động',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  new_lead: 'bg-blue-500 text-white border-transparent',
  following: 'bg-orange-500 text-white border-transparent',
  current_customer: 'bg-green-500 text-white border-transparent',
  not_fit: 'bg-slate-500 text-white border-transparent',
};

type RelatedQuoteRow = NonNullable<RelatedPayload['quotes']>[number];
type QuoteStatusFilter = 'active' | 'all' | 'cancelled' | 'presale' | 'pricing' | 'review' | 'ready' | 'sent';

// Cung DUNG 1 thu tu uu tien voi _derive_quote_phase() (backend,
// supabase_quote_service.py) va phaseCellLabel() (QuoteCenterPage.tsx) -
// KHONG duoc de status ghi de tin hieu sent/published (xem lich su fix
// "Admin review 4" trong phien nay).
function quoteChainPhaseLabel(row: RelatedQuoteRow): string {
  if (row.deleted_at || row.status === 'cancelled') return 'Đã huỷ';
  if (row.sent_at) return 'Đã gửi';
  if (row.published_at || row.processing_stage === 'published') return 'Sẵn sàng gửi';
  if (row.status === 'approved' || row.approved_at) return 'Sẵn sàng gửi';
  if (row.processing_stage === 'review') return 'Admin review';
  if (row.processing_stage === 'pricing') return 'Sale markup';
  return 'Presale';
}

function quoteChainPhaseKey(row: RelatedQuoteRow): QuoteStatusFilter {
  if (row.deleted_at || row.status === 'cancelled') return 'cancelled';
  if (row.sent_at) return 'sent';
  if (row.published_at || row.processing_stage === 'published' || row.status === 'approved' || row.approved_at) return 'ready';
  if (row.processing_stage === 'review') return 'review';
  if (row.processing_stage === 'pricing') return 'pricing';
  return 'presale';
}

const QUOTE_PHASE_COLOR: Record<QuoteStatusFilter, string> = {
  cancelled: 'bg-red-500 text-white',
  sent: 'bg-emerald-600 text-white',
  ready: 'bg-teal-500 text-white',
  review: 'bg-rose-500 text-white',
  pricing: 'bg-amber-500 text-white',
  presale: 'bg-blue-500 text-white',
  active: 'bg-slate-500 text-white',
  all: 'bg-indigo-600 text-white',
};
function quotePhaseBadgeClass(key: QuoteStatusFilter): string {
  return `inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${QUOTE_PHASE_COLOR[key] || 'bg-slate-500 text-white'}`;
}

const QUOTE_STATUS_FILTER_LABELS: Record<QuoteStatusFilter, string> = {
  active: 'Đang hoạt động',
  all: 'Tất cả báo giá',
  cancelled: 'Đã huỷ',
  presale: 'Presale',
  pricing: 'Sale markup',
  review: 'Admin review',
  ready: 'Sẵn sàng gửi',
  sent: 'Đã gửi',
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: 'Lên kế hoạch',
  active: 'Đang triển khai',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

/** Nut "Thao tác" gan nhanh Người liên hệ chính cho 1 Deal - dung chung cho
 * ca 3 tab Cơ hội/Báo giá/Hợp đồng o Customer 360 (ca 3 deu quy ve cung 1
 * Deal qua deal_id, primary_contact_id NAM TREN Deal - customer_leads, khong
 * phai tren Quote/Contract - nen thao tac that su la PUT /customer-leads/
 * {dealId} y het luc sua trong Deal Workspace, chi la lam tat, khong can mo
 * ca Deal Workspace). Bao giá can Người liên hệ chính vi yeu cau nghiep vu
 * "tao bao gia phai co lien he chinh". An han neu row nay khong co dealId
 * that (vd 1 Contract tao truc tiep tren Customer, khong qua Deal nao). */
export function ContactAssignCell({
  dealId,
  currentContactId,
  contacts,
  onAssigned,
}: {
  dealId?: string | null;
  currentContactId?: string | null;
  contacts: Array<{ id: string; name: string }>;
  onAssigned: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!dealId) return <span className="crm-muted">—</span>;

  if (!editing) {
    return (
      <button
        type="button"
        className="crm-row-action"
        onClick={event => { event.stopPropagation(); setEditing(true); }}
      >
        {currentContactId ? 'Đổi liên hệ' : '+ Liên hệ chính'}
      </button>
    );
  }

  return (
    <select
      autoFocus
      className="crm-inline-assign-select"
      disabled={saving}
      defaultValue={currentContactId || ''}
      onClick={event => event.stopPropagation()}
      onBlur={() => setEditing(false)}
      onChange={async event => {
        event.stopPropagation();
        const value = event.target.value;
        setSaving(true);
        try {
          const res = await fetch(`${API_BASE_URL}/api/all-platform/customer-leads/${encodeURIComponent(dealId)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: headers(),
            body: JSON.stringify({ primary_contact_id: value || null }),
          });
          const body = await res.json();
          if (!res.ok || body?.success === false) throw new Error(body?.message || 'Không gán được liên hệ chính.');
          onAssigned();
        } catch (err) {
          window.alert(err instanceof Error ? err.message : 'Không gán được liên hệ chính.');
        } finally {
          setSaving(false);
          setEditing(false);
        }
      }}
    >
      <option value="">— Chưa gán —</option>
      {contacts.map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

function customerDetailErrorMessage(status: number, body: unknown, fallback: string): string {
  const payload = body as { message?: unknown; detail?: unknown } | null;
  const raw = typeof payload?.message === 'string'
    ? payload.message
    : typeof payload?.detail === 'string'
      ? payload.detail
      : '';
  if (raw) return raw;
  if (status === 403) return 'Không có quyền xem hồ sơ khách hàng này.';
  if (status === 404) return 'Không tìm thấy hồ sơ khách hàng này.';
  return fallback;
}

function isAdminOrLeader(role?: string) {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'admin' || normalized === 'leader';
}

function toCustomerRow(customer: RelatedPayload['customer']): CrmCustomerRow | null {
  if (!customer) return null;
  return {
    id: customer.id,
    customerName: customer.customer_name || '',
    companyName: customer.company_name || '',
    shortName: customer.short_name || null,
    shortNameManual: Boolean(customer.short_name_manual),
    positionCategoryId: customer.position_category_id || undefined,
    position: customer.position || '',
    phone: customer.phone || '',
    email: customer.email || '',
    zalo: customer.zalo || '',
    facebook: customer.facebook || '',
    telegram: customer.telegram || '',
    website: customer.website || '',
    taxCode: customer.tax_code || '',
    address: customer.address || '',
    city: customer.city || '',
    industry: customer.industry || '',
    source: customer.source || '',
    status: customer.status || undefined,
    ownerId: customer.owner_id || '',
    note: customer.note || '',
    createdAt: customer.created_at || '',
    updatedAt: customer.updated_at || '',
  };
}

type Tab = 'overview' | 'activity' | 'contacts' | 'projects' | 'deals' | 'quotes' | 'contracts' | 'documents';

export function CrmCustomerDetailPage({ customerId }: { customerId: string }) {
  const { user } = useAppAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<RelatedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quoteForms, setQuoteForms] = useState<QuoteForm[]>([]);
  const [issuerCompanies, setIssuerCompanies] = useState<IssuerCompany[]>([]);
  // Cho phep deep-link tu trang khac (vd cot "Dự án" o Trung tâm báo giá):
  // ?tab=quotes&projectId=xxx -> mo dung tab + loc dung Du an ngay khi vao
  // trang, khong bat nguoi dung tu bam lai. Chi doc 1 LAN luc mount (gia tri
  // ban dau cua useState) - doi tab/filter sau do van la tuong tac binh
  // thuong cua nguoi dung, khong bi query string cu ghi de lai.
  const initialTabParam = searchParams.get('tab');
  const initialTab: Tab =
    initialTabParam === 'quotes' || initialTabParam === 'deals' || initialTabParam === 'contracts' || initialTabParam === 'projects' || initialTabParam === 'activity' || initialTabParam === 'contacts' || initialTabParam === 'documents'
      ? (initialTabParam as Tab)
      : 'overview';
  
  const [tab, setTabState] = useState<Tab>(initialTab);

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/all-platform/crm/customers');
  };

  useEffect(() => {
    setTabState(initialTab);
  }, [customerId, initialTabParam]);

  const setTab = (newTab: Tab) => {
    setTabState(newTab);
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', newTab);
        window.history.replaceState({}, '', url.toString());
      } catch (e) {}
    }
  };
  const [editOpen, setEditOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // Bao gia/hop dong doi -> backend tu cap nhat stage Deal -> tai lai Customer 360 tu du lieu that.
  useDealsChanged(() => setReloadTick(t => t + 1));
  // Link Doc/Sheet bàn giao Lead (crm_leads.handover_links) của các Lead đã convert thành khách hàng này.
  const [handoverDocs, setHandoverDocs] = useState<HandoverDoc[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/handover-docs`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(API_KEY ? { 'X-API-Key': API_KEY } : {}) } })
      .then(res => res.json())
      .then(body => { if (alive && body.success !== false && Array.isArray(body.data)) setHandoverDocs(body.data); })
      .catch(() => { /* chi la thong tin phu */ });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  // Tab "Hợp đồng" o Customer 360 - TAI SU DUNG dung 2 modal Deal Workspace
  // dang dung (ManualContractModal/RegisterExternalContractModal), khong tu
  // viet lai UI tao hop dong lan 2. "+ Tạo hợp đồng" khoa theo customerId
  // (Phase 1: contracts.customer_id truc tiep, khong bat buoc qua Deal).
  // "+ Ghi nhận hợp đồng có sẵn" dung lai dung component cua Deal Workspace -
  // component nay yeu cau 1 Deal day du (khong chi la Customer) de dien san
  // Khach hang/Co hoi/Du an, nen phai fetch full row cua activeDeal truoc khi
  // mo (registerContractDeal), KHONG dung chung state voi Deal Workspace
  // overlay (openDeal) de tranh vo tinh mo nham drawer Deal Workspace.
  const [registerContractOpen, setRegisterContractOpen] = useState(false);
  const [registerContractDeal, setRegisterContractDeal] = useState<LiveDealRow | null>(null);
  const [registerContractLoading, setRegisterContractLoading] = useState(false);
  // Sua hop dong = mo chinh form Thêm hợp đồng o che do Sua.
  const [editingContract, setEditingContract] = useState<NonNullable<RelatedPayload['contracts']>[number] | null>(null);

  // Tab "Du an" (Checkpoint C) - 1 API tong hop rieng (khong nam trong
  // /related cu, tranh phinh to payload cho nhung trang khac khong can Du an).
  const [projectsSummary, setProjectsSummary] = useState<CustomerProjectsSummary | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [projectModal, setProjectModal] = useState<{ open: boolean; project: Project | null; contactId?: string }>({ open: false, project: null });

  // BUG THAT DA GAP ("tạo cơ hội ở trang chi tiết khách hàng bị nhảy qua
  // /all-platform/crm"): nut "+ Tạo cơ hội" (header + tren tung Project card)
  // truoc day la <Link href="/all-platform/crm?openDeal=new&...">, dieu
  // huong THAT su roi cho CrmShell.tsx mo modal ben do - dung y DealFormModal
  // da co san prop initialCustomer/initialProject de mo NGAY tai day (cung
  // pattern voi "+ Tạo dự án" o ngay ben canh dung ProjectFormModal inline),
  // nhung chua tung duoc noi day. Tu fetch agents/danh muc rieng (KHONG dung
  // ca useCrm() - hook do con tu fetch toan bo danh sach deal cua he thong,
  // thua thai cho 1 trang Ho so 1 khach hang).
  const [dealModal, setDealModal] = useState<{ open: boolean; project: Project | null; contactId: string | null }>({ open: false, project: null, contactId: null });
  // "Tạo cơ hội" KHONG gan san nguoi lien he (nut chung o tab Tong quan/Co hoi) - dung CreateOpportunityDrawer
  // (feedback "tạo cơ hội trong chi tiết khách hàng nó phải là form của +deal upsell chứ ta") thay vi DealFormModal:
  // giao dien day du hon (the tom tat khach hang, dem "Cơ hội hiện có", chip Nguon/Trang thai/Owner/Lien he), dung
  // chung 1 backend contract (buildDealPayload + createDeal) nen an toan de doi UI ma khong doi logic luu. Rieng 2
  // nut "Tạo cơ hội" GAN SAN 1 nguoi lien he cu the (tab Nguoi lien he) VAN giu DealFormModal vi CreateOpportunityDrawer
  // chua ho tro gan contactId that (chi co o ten tu do) - doi se mat lien ket Contact that su.
  const [createOpportunityOpen, setCreateOpportunityOpen] = useState(false);
  const [dealSaving, setDealSaving] = useState(false);
  const [dealAgents, setDealAgents] = useState<CrmUserOption[]>([]);
  const [dealSourceOptions, setDealSourceOptions] = useState(SOURCE_OPTIONS);
  const [dealServicePackageOptions, setDealServicePackageOptions] = useState(SERVICE_PACKAGE_OPTIONS);
  const [dealPackageOptions, setDealPackageOptions] = useState(CRM_PACKAGE_OPTIONS);
  const [dealIndustryOptions, setDealIndustryOptions] = useState(INDUSTRY_OPTIONS.map(v => ({ value: v, label: v })));
  useEffect(() => {
    let alive = true;
    seedingCrmRepository.getAgents().then(res => { if (alive) setDealAgents(res); }).catch(() => { if (alive) setDealAgents([]); });
    Promise.all([
      allPlatformCategoriesService.getAll('crm_source'),
      allPlatformCategoriesService.getAll('crm_service_package'),
      allPlatformCategoriesService.getAll('crm_package'),
      allPlatformCategoriesService.getAll('crm_industry'),
    ])
      .then(([sourceRes, servicePackageRes, packageRes, industryRes]) => {
        if (!alive) return;
        setDealSourceOptions(mergeCategoryOptions(SOURCE_OPTIONS, sourceRes.data));
        setDealServicePackageOptions(mergeCategoryOptions(SERVICE_PACKAGE_OPTIONS, servicePackageRes.data));
        setDealPackageOptions(mergeCategoryOptions(CRM_PACKAGE_OPTIONS, packageRes.data));
        setDealIndustryOptions(mergeCategoryOptions(INDUSTRY_OPTIONS.map(v => ({ value: v, label: v })), industryRes.data));
      })
      .catch(() => { });
    return () => { alive = false; };
  }, []);
  async function handleCreateDeal(input: CreateDealInput) {
    setDealSaving(true);
    try {
      await seedingCrmRepository.createDeal(input);
      clearDealDraft();
      setDealModal({ open: false, project: null, contactId: null });
      setReloadTick(t => t + 1);
      setTab('deals');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tạo được cơ hội. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setDealSaving(false);
    }
  }

  // Tab "Hoạt động" (Phase 3) - CHI gom Deal/Sales activity qua moi Deal cua
  // Customer nay (GET /crm/customers/{id}/activity), KHONG phai Activity
  // Timeline hop nhat (chua gom Quote/Contract/Customer event) - UI phai noi
  // ro pham vi. Lazy-fetch khi nguoi dung thuc su mo tab, khong eager.
  const [activityItems, setActivityItems] = useState<CustomerActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  useEffect(() => {
    if (tab !== 'activity') return;
    let alive = true;
    setActivityLoading(true);
    setActivityError('');
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/activity`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok || body?.success === false) {
          throw new Error(body?.message || 'Không tải được hoạt động.');
        }
        return (body.data as CustomerActivityEntry[]) || [];
      })
      .then(items => { if (alive) setActivityItems(items); })
      .catch(err => { if (alive) setActivityError(err instanceof Error ? err.message : 'Không tải được hoạt động.'); })
      .finally(() => { if (alive) setActivityLoading(false); });
    return () => { alive = false; };
  }, [tab, customerId, reloadTick]);

  // Tab "Cơ hội" -> click 1 deal mo THANG Deal Workspace V2 (Phase 2,
  // DealDetailDrawer) ngay tai day, KHONG dieu huong sang /all-platform/crm -
  // giu nguyen context Customer 360. `/related`'s deals[] chi co vai field
  // nong nen phai goi rieng GET /customer-leads/{id} de lay du du lieu.
  const [openDeal, setOpenDeal] = useState<LiveDealRow | null>(null);
  const [openDealLoading, setOpenDealLoading] = useState(false);
  const [dealTransitionTarget, setDealTransitionTarget] = useState<{ customer: LiveDealRow; toStage: LiveDealStage } | null>(null);
  const [editingDealRow, setEditingDealRow] = useState<LiveDealRow | null>(null);

  // Tab "Người liên hệ" -> click 1 Contact mo ContactDetailDrawer ngay tai
  // day (khong dieu huong) - Contact 360's tab "Cơ hội" tai su dung LAI
  // chinh instance DealDetailDrawer da mount o duoi (openDealWorkspace),
  // KHONG dung UI Deal thu 2.
  //
  // BUG THAT DA GAP ("Người liên hệ (0)" luc F5/mo trang, dung lai thanh (1)
  // SAU KHI bam vao tab"): dem cu chi lay tu 1 state rieng (contactCount,
  // mac dinh 0) do CHINH CrmContactsPanel tu fetch va bao ve qua
  // onCountChange - panel do CHI duoc mount khi tab === 'contacts', nen truoc
  // do dem luon la 0 gia, khong phai du lieu that. Trong khi API /related da
  // tra san `customer.contact_count` (tinh tu _attach_customer_metrics(), y
  // het deal_count) - dung NGAY gia tri that nay lam mac dinh, contactCountOverride
  // chi dung de cap nhat NGAY sau khi tao/xoa Contact (khong cho F5) ma
  // khong can goi lai /related.
  const [contactCountOverride, setContactCountOverride] = useState<number | null>(null);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [allContacts, setAllContacts] = useState<Array<{ id: string; name: string }>>([]);

  async function openDealWorkspace(dealId: string) {
    setOpenDealLoading(true);
    try {
      const full = await customerLeadService.getById(dealId);
      setOpenDeal(full);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được cơ hội này.');
    } finally {
      setOpenDealLoading(false);
    }
  }

  async function openEditContract(contract: NonNullable<RelatedPayload['contracts']>[number]) {
    const dealId = contract.deal_id || activeDeal?.id;
    if (!dealId) {
      window.alert('Hợp đồng này chưa gắn Cơ hội nên chưa mở được form sửa.');
      return;
    }
    setRegisterContractLoading(true);
    try {
      const full = await customerLeadService.getById(dealId);
      setEditingContract(contract);
      setRegisterContractDeal(full);
      setRegisterContractOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được cơ hội này.');
    } finally {
      setRegisterContractLoading(false);
    }
  }

  /** Mở "Ghi nhận hợp đồng có sẵn" ngay tại tab Hợp đồng của Customer 360 -
   * component dùng lại (RegisterExternalContractModal) cần 1 Deal đầy đủ để
   * điền sẵn Khách hàng/Cơ hội/Dự án, nên phải fetch full row của activeDeal
   * (heuristic "Cơ hội đang xử lý" đã tính sẵn cho tab Tổng quan) trước khi
   * mở - KHÔNG tái dùng state `openDeal` (Deal Workspace) để tránh mở nhầm. */
  async function openRegisterContractForActiveDeal() {
    if (!activeDeal) {
      window.alert('Khách hàng này chưa có Cơ hội nào — cần ít nhất 1 Cơ hội để ghi nhận hợp đồng đã ký bên ngoài.');
      return;
    }
    setRegisterContractLoading(true);
    try {
      const full = await customerLeadService.getById(activeDeal.id);
      setRegisterContractDeal(full);
      setRegisterContractOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được cơ hội này.');
    } finally {
      setRegisterContractLoading(false);
    }
  }

  // Bug thuc te (2026-10-10, audit thao/crm/SHARED_COMPONENT_MAP.md + REGRESSION_CHECKLIST.md Known
  // gaps #7): nut "Tạo hợp đồng" tren Project card (tab "Hợp đồng") truoc day dung chung handler
  // setDealModal voi nut "Tạo cơ hội" ben canh - bam vao mo nham form Tao Co hoi, khong tao hop dong
  // nao ca. Dung y het resolve-Deal cua openQuickQuoteForProject() o tren (uu tien Deal thuoc dung
  // project, fallback activeDeal) roi mo dung RegisterExternalContractModal.
  async function openRegisterContractForProject(projectId: string) {
    const candidate = data?.deals?.find(d => d.project_id === projectId) || activeDeal;
    if (!candidate) {
      window.alert('Dự án này chưa có Cơ hội (Deal) nào để ghi nhận hợp đồng. Hãy tạo Cơ hội trước.');
      return;
    }
    setRegisterContractLoading(true);
    try {
      const full = await customerLeadService.getById(candidate.id);
      setRegisterContractDeal(full);
      setRegisterContractOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được cơ hội này.');
    } finally {
      setRegisterContractLoading(false);
    }
  }

  async function submitDealTransition(payload: StageTransitionPayload) {
    if (!dealTransitionTarget) return;
    try {
      const res = await customerLeadService.transitionStage(dealTransitionTarget.customer.id, payload);
      if (res?.success === false) throw new Error(res?.message || 'Chuyển giai đoạn thất bại');
      const fresh = await customerLeadService.getById(dealTransitionTarget.customer.id);
      setOpenDeal(fresh);
      setDealTransitionTarget(null);
      setReloadTick(t => t + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không chuyển được giai đoạn.');
    }
  }

  async function deleteOpenDeal(c: LiveDealRow) {
    if (!confirm(`Xóa cơ hội "${c.customer_name}"?\nHành động này không thể hoàn tác.`)) return;
    try {
      let res = await customerLeadService.delete(c.id);
      // Co hoi con Bao gia/Hop dong: hoi ro truoc khi xoa kem (feedback 2026-09-23).
      const summary = cascadeSummaryFromBody(res);
      if (summary) {
        if (!confirm(cascadeWarningText('Cơ hội này', summary))) return;
        res = await customerLeadService.delete(c.id, true);
      }
      if (res?.success === false) throw new Error(res?.message || 'Xóa thất bại');
      setOpenDeal(null);
      setReloadTick(t => t + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xóa được cơ hội này.');
    }
  }

  // Phase 3.5 A6/A7: Project chua co hard-delete an toan (khong the chung
  // minh zero dependency tu frontend) - dung dung status='cancelled' da co
  // san trong CHECK constraint (migration 097) + update_project() thay vi
  // buoc nguoi dung phai mo "Sửa dự án" roi tu tim option trong dropdown.
  async function cancelProject(project: { id: string; name: string }) {
    if (!confirm(`Hủy dự án "${project.name}"?\nDự án sẽ chuyển sang trạng thái "Đã huỷ", không xóa dữ liệu.`)) return;
    try {
      const res = await projectsService.update(project.id, { status: 'cancelled' });
      if (res?.success === false) throw new Error(res?.message || 'Hủy dự án thất bại');
      setReloadTick(t => t + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không hủy được dự án này.');
    }
  }

  // Tab "Báo giá" - filter theo 1 Project cu the (Block 1, muc 7: "Xem báo
  // giá" tren Project card phai THAT SU chuyen tab + loc, khong chi navigate).
  const [quoteProjectFilter, setQuoteProjectFilter] = useState<string | null>(searchParams.get('projectId'));
  // "Xem" tren 1 dong Bao gia -> mo 1 QuoteWorkspaceModal instance MOI (Block
  // 1, muc 9) - deal that duoc nap lazy (1 lan, dung luc bam Xem) de modal co
  // du du lieu Khach hang/Co hoi hien dung, khong dung ban Deal rut gon cua
  // trang nay.
  const [quoteWorkspace, setQuoteWorkspace] = useState<{ quoteId: string | null; deal: Deal | null; initialProjectId?: string; initialDealId?: string; lockProject?: boolean } | null>(null);
  const [quoteWorkspaceLoading, setQuoteWorkspaceLoading] = useState(false);
  const [customerQuoteDeals, setCustomerQuoteDeals] = useState<Deal[]>([]);
  // "Tạo báo giá nhanh" tren Project card (Block 1) - mo thang CreateQuoteModal
  // voi 1 Deal that lien quan toi project, khong navigate sang trang khac.
  const [quickQuoteDeal, setQuickQuoteDeal] = useState<Deal | null>(null);
  const [quickQuoteLoading, setQuickQuoteLoading] = useState(false);
  // Presale/Sale hien ten that (technical_owner_id/quote_owner_id la
  // app_users.id that) - dung DUNG 1 nguon voi moi noi khac trong app
  // (useMembers(), khop linked_user_id).
  const { members } = useMembers();
  function projectLabel(projectId?: string | null): string {
    if (!projectId) return 'Chưa thuộc dự án';
    const found = projectsSummary?.projects.find(p => p.id === projectId);
    return found ? `${found.projectCode} · ${found.name}` : 'Đang tải…';
  }
  function memberName(userId?: string | null): string {
    if (!userId) return 'Chưa gán';
    const match = members.find(m => (m.linked_user_id || m.linked_user_id_2) === userId);
    return match?.display_name || 'Chưa gán';
  }

  async function viewQuoteInNewWorkspace(row: { id: string; deal_id?: string | null }) {
    setQuoteWorkspaceLoading(true);
    try {
      const deal = row.deal_id ? await seedingCrmRepository.getDeal(row.deal_id).catch(() => null) : null;
      setQuoteWorkspace({ quoteId: row.id, deal });
    } finally {
      setQuoteWorkspaceLoading(false);
    }
  }

  // "Sửa"/"Xóa" đầy đủ ở tab Báo giá (feedback) - "Sửa" mo dung workspace
  // (QuoteWorkspaceModal tu quyet dinh editable/read-only theo quyen that
  // cua nguoi dang nhap, khong can man rieng). "Xóa" dung dung pattern +
  // message xac nhan "chấp nhận mất" da ap dung o QuoteCenterPage.tsx
  // (deleteChainNow) - khong chan quyen/khong chan da duyet, chi hoi xac
  // nhan (user decision 2026-09-23) - xoa CA chuoi version (includeVersions=true).
  const [quoteDeleteBusy, setQuoteDeleteBusy] = useState<string | null>(null);
  async function deleteQuoteChainOnCustomerPage(row: RelatedQuoteRow, versionCount: number) {
    const versionText = versionCount > 1 ? ` (gồm ${versionCount} phiên bản)` : '';
    const isApprovedLike = row.status === 'approved' || row.status === 'confirmed' || Boolean(row.approved_at);
    const message = isApprovedLike
      ? `Báo giá ${row.quote_number || row.id} này đã duyệt, bạn có chắc muốn xóa${versionText}?`
      : `Xoá báo giá ${row.quote_number || row.id}${versionText}?`;
    if (!window.confirm(`${message}\nBạn chấp nhận mất báo giá này? (Báo giá bị ẩn khỏi danh sách, Admin có thể khôi phục nếu cần.)`)) return;
    setQuoteDeleteBusy(row.id);
    try {
      const result = await seedingQuoteRepository.bulkDeleteQuotes([row.id], true);
      if (result.failed.length) window.alert(`Không xoá được ${result.failed.length} phiên bản: ${result.failed[0].message}`);
      setReloadTick(t => t + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được báo giá.');
    } finally {
      setQuoteDeleteBusy(null);
    }
  }

  // Feedback (2026-09-24): "Đổi liên hệ" o tab Bao gia gop VAO trong menu
  // "⋯" (ActionMenu) thay vi 1 nut/select roi nam canh no (nhu ContactAssignCell
  // cu, van con dung nguyen o tab Co hoi/Hop dong) - dung 1 modal nho rieng
  // (dung y het pattern .crm-modal-backdrop/.crm-modal cua ConfirmModal) vi
  // ActionMenu item chi la nut bam don, khong nhung duoc <select> ben trong.
  const [contactAssignTarget, setContactAssignTarget] = useState<{ dealId: string; quoteNumber: string } | null>(null);
  const [contactAssignValue, setContactAssignValue] = useState('');
  const [contactAssignSaving, setContactAssignSaving] = useState(false);
  function openContactAssignModal(dealId: string, quoteNumber: string, currentContactId?: string | null) {
    setContactAssignTarget({ dealId, quoteNumber });
    setContactAssignValue(currentContactId || '');
  }
  async function saveContactAssign() {
    if (!contactAssignTarget) return;
    setContactAssignSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/customer-leads/${encodeURIComponent(contactAssignTarget.dealId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify({ primary_contact_id: contactAssignValue || null }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.message || 'Không gán được liên hệ chính.');
      setReloadTick(t => t + 1);
      setContactAssignTarget(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gán được liên hệ chính.');
    } finally {
      setContactAssignSaving(false);
    }
  }

  // Dropdown xem phien ban cu ngay tai bang Bao gia (giong trang
  // /all-platform/quote-center - toggleExpandVersions/renderOlderVersionRows)
  // - bam mui ten canh "V{n} · X version" de mo rong danh sach cac version cu
  // hon cua CHINH chuoi bao gia do, khong can nhay sang trang Bao gia rieng.
  const [expandedQuoteVersions, setExpandedQuoteVersions] = useState<
    Record<string, { loading: boolean; versions: Quote[]; error?: string }>
  >({});
  async function toggleExpandQuoteVersions(row: RelatedQuoteRow) {
    const key = row.id;
    if (expandedQuoteVersions[key]) {
      setExpandedQuoteVersions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setExpandedQuoteVersions(prev => ({ ...prev, [key]: { loading: true, versions: [] } }));
    try {
      const versions = await seedingQuoteRepository.getQuoteVersions(key);
      setExpandedQuoteVersions(prev =>
        prev[key] ? { ...prev, [key]: { loading: false, versions: versions.filter(v => v.id !== key) } } : prev
      );
    } catch (err) {
      setExpandedQuoteVersions(prev =>
        prev[key]
          ? { ...prev, [key]: { loading: false, versions: [], error: err instanceof Error ? err.message : 'Không tải được phiên bản cũ.' } }
          : prev
      );
    }
  }
  /** Xoa RIENG 1 version cu (giu nguyen cac version khac trong chuoi) - dung
   * pattern deleteVersionNow() cua QuoteCenterPage.tsx. */
  async function deleteQuoteVersionOnCustomerPage(version: Quote) {
    const label = `V${version.versionNumber || 1} (${version.quoteNumber})`;
    if (!window.confirm(`Xoá riêng ${label}? Các phiên bản khác trong chuỗi vẫn giữ nguyên.`)) return;
    try {
      const result = await seedingQuoteRepository.bulkDeleteQuotes([version.id], false);
      if (result.failed.length) {
        window.alert(result.failed[0].message || 'Không xoá được phiên bản này.');
        return;
      }
      setExpandedQuoteVersions(prev => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          next[key] = { ...next[key], versions: next[key].versions.filter(v => v.id !== version.id) };
        }
        return next;
      });
      setReloadTick(t => t + 1);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được phiên bản này.');
    }
  }
  function quoteVersionStatusLabel(version: Quote): string {
    if (version.deletedAt || version.status === 'cancelled') return 'Đã huỷ';
    if (version.sentAt) return 'Đã gửi';
    if (version.publishedAt || version.processingStage === 'published' || version.status === 'approved' || version.approvedAt) return 'Sẵn sàng gửi';
    if (version.processingStage === 'review') return 'Admin review';
    if (version.processingStage === 'pricing') return 'Sale markup';
    return 'Presale';
  }

  // "Tạo yêu cầu báo giá" tren Project card - mo QuoteWorkspaceModal o CHE DO
  // TAO MOI (quoteId=null), khoa san Khach hang + Du an theo dung project vua
  // bam, khong can chon lai.
  function openQuoteRequestForProject(projectId: string) {
    setQuoteWorkspace({ quoteId: null, deal: null, initialProjectId: projectId, lockProject: true });
  }

  // "Tạo báo giá nhanh" tren Project card - can 1 Deal that gan voi project de
  // dua vao CreateQuoteModal (modal nay khong co prop khoa Project rieng, chi
  // nhan initialDeal). Uu tien Deal thuoc dung project; neu project chua co
  // Deal nao thi fallback activeDeal cua Customer, bao loi neu khong co Deal.
  async function openQuickQuoteForProject(projectId: string) {
    const candidate = data?.deals?.find(d => d.project_id === projectId) || activeDeal;
    if (!candidate) {
      window.alert('Khách hàng chưa có Cơ hội (Deal) nào để tạo báo giá nhanh. Hãy tạo Cơ hội trước.');
      return;
    }
    setQuickQuoteLoading(true);
    try {
      const deal = await seedingCrmRepository.getDeal(candidate.id);
      setQuickQuoteDeal(deal);
    } catch {
      window.alert('Không tải được thông tin Cơ hội để tạo báo giá nhanh.');
    } finally {
      setQuickQuoteLoading(false);
    }
  }

  // "Báo giá nhanh" o dau tab "Báo giá" (feedback "tạo thêm 1 nút báo giá
  // nhanh, nút màu trắng") - khong gan voi 1 project cu the nhu ban tren
  // Project card, nen lay activeDeal cua Customer (fallback Deal dau tien neu
  // chua co activeDeal) lam Deal de mo CreateQuoteModal.
  async function openQuickQuoteForCustomer() {
    const candidate = activeDeal || data?.deals?.[0];
    if (!candidate) {
      window.alert('Khách hàng chưa có Cơ hội (Deal) nào để tạo báo giá nhanh. Hãy tạo Cơ hội trước.');
      return;
    }
    setQuickQuoteLoading(true);
    try {
      const deal = await seedingCrmRepository.getDeal(candidate.id);
      setQuickQuoteDeal(deal);
    } catch {
      window.alert('Không tải được thông tin Cơ hội để tạo báo giá nhanh.');
    } finally {
      setQuickQuoteLoading(false);
    }
  }

  // Bao gia tab: gom theo version_chain_id (fallback ve id neu chua co
  // chuoi), CHI giu ban CURRENT (version_number lon nhat) trong moi chuoi -
  // dung nguyen tac da dung o get_customer_projects_summary() backend.
  const allQuoteChains = useMemo(() => {
    const rows = data?.quotes || [];
    const byChain = new Map<string, RelatedQuoteRow[]>();
    for (const row of rows) {
      const key = row.version_chain_id || row.id;
      const list = byChain.get(key) || [];
      list.push(row);
      byChain.set(key, list);
    }
    return [...byChain.values()].map(list => {
      const sorted = [...list].sort((a, b) => (b.version_number || 1) - (a.version_number || 1));
      return { current: sorted[0], versionCount: list.length };
    });
  }, [data?.quotes]);
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<QuoteStatusFilter>('active');
  const quoteChains = useMemo(
    () => {
      const scoped = quoteProjectFilter ? allQuoteChains.filter(c => c.current.project_id === quoteProjectFilter) : allQuoteChains;
      if (quoteStatusFilter === 'all') return scoped;
      if (quoteStatusFilter === 'active') return scoped.filter(c => quoteChainPhaseKey(c.current) !== 'cancelled');
      return scoped.filter(c => quoteChainPhaseKey(c.current) === quoteStatusFilter);
    },
    [allQuoteChains, quoteProjectFilter, quoteStatusFilter]
  );
  const hiddenCancelledQuoteCount = useMemo(
    () => {
      const scoped = quoteProjectFilter ? allQuoteChains.filter(c => c.current.project_id === quoteProjectFilter) : allQuoteChains;
      return scoped.filter(c => quoteChainPhaseKey(c.current) === 'cancelled').length;
    },
    [allQuoteChains, quoteProjectFilter]
  );
  const quoteStatusFilterSummary = quoteStatusFilter === 'active'
    ? `Đang ẩn báo giá đã huỷ${hiddenCancelledQuoteCount ? ` (${hiddenCancelledQuoteCount})` : ''}`
    : `Đang lọc: ${QUOTE_STATUS_FILTER_LABELS[quoteStatusFilter]}`;

  useEffect(() => {
    let alive = true;
    setProjectsLoading(true);
    customerProjectsSummaryService.get(customerId).then(res => {
      if (!alive) return;
      if (res.success && res.data) {
        setProjectsSummary(res.data);
        setProjectsError('');
      } else {
        setProjectsError(res.message || 'Không tải được danh sách dự án.');
      }
    }).catch(err => {
      if (alive) setProjectsError(err instanceof Error ? err.message : 'Không tải được danh sách dự án.');
    }).finally(() => {
      if (alive) setProjectsLoading(false);
    });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  useEffect(() => {
    setContactCountOverride(null);
  }, [customerId]);

  useEffect(() => {
    setOpenDeal(null);
  }, [tab]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Đồng thời tải contacts để hiện tên Người liên hệ chính trong bảng Deal.
    void seedingCrmRepository.listContacts(customerId).then(contacts => {
      if (alive) setAllContacts(contacts || []);
    }).catch(() => {
      if (alive) setAllContacts([]);
    });

    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/related`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok || body?.success === false) {
          throw new Error(customerDetailErrorMessage(res.status, body, 'Không tải được hồ sơ khách hàng.'));
        }
        return body.data as RelatedPayload;
      })
      .then(payload => {
        if (alive) {
          setData(payload);
          setError('');
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được hồ sơ khách hàng.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  const customer = data?.customer;
  const customerRow = useMemo(() => toCustomerRow(customer), [customer]);
  const customerQuoteDealsById = useMemo(() => new Map(customerQuoteDeals.map(deal => [deal.id, deal])), [customerQuoteDeals]);
  const defaultQuoteFormId = useMemo(() => {
    const nonVillaForms = quoteForms.filter(f => f.schemaJson?.layoutType !== 'villa_solution_package');
    const primaryIssuer = issuerCompanies[0];
    const issuerDefault = primaryIssuer?.defaultQuoteFormId
      ? nonVillaForms.find(f => f.id === primaryIssuer.defaultQuoteFormId)?.id
      : undefined;
    if (issuerDefault) return issuerDefault;
    const globalDefault = nonVillaForms.find(f => f.isDefaultTemplate)?.id;
    return globalDefault || nonVillaForms[0]?.id;
  }, [quoteForms, issuerCompanies]);

  useEffect(() => {
    let alive = true;
    void seedingQuoteRepository.getForms()
      .then(rows => { if (alive) setQuoteForms(rows); })
      .catch(() => { if (alive) setQuoteForms([]); });
    void seedingQuoteRepository.getIssuerCompanies()
      .then(rows => { if (alive) setIssuerCompanies(rows); })
      .catch(() => { if (alive) setIssuerCompanies([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void seedingCrmRepository.getDeals()
      .then(rows => {
        if (!alive) return;
        setCustomerQuoteDeals(rows.filter(deal => deal.customerId === customerId));
      })
      .catch(() => {
        if (alive) setCustomerQuoteDeals([]);
      });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  // "Active Deal" cho tab Tổng quan - KHÔNG có field DB nào đánh dấu 1 deal
  // là "chính" (1 Customer có thể có nhiều Deal, xem audit Phase 3) nên đây
  // CHỈ là heuristic hiển thị, không persist gì: ưu tiên deal chưa terminal
  // (không phải won/lost), mới cập nhật nhất; nếu tất cả đã terminal thì lấy
  // deal cập nhật gần nhất.
  const activeDeal = useMemo(() => {
    const deals = data?.deals || [];
    if (!deals.length) return null;
    const nonTerminal = deals.filter(d => d.deal_stage !== 'won' && d.deal_stage !== 'lost');
    const pool = nonTerminal.length ? nonTerminal : deals;
    return [...pool].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())[0];
  }, [data?.deals]);

  const totalDealsBudget = useMemo(() => {
    const deals = data?.deals || [];
    return deals.reduce((sum, d) => sum + Number(d.estimated_budget || d.lifetime_value || 0), 0);
  }, [data?.deals]);

  const recentProjects = useMemo(() => {
    return (projectsSummary?.projects || []).slice(0, 3);
  }, [projectsSummary?.projects]);

  const recentQuotes = useMemo(() => {
    return allQuoteChains.slice(0, 3);
  }, [allQuoteChains]);

  // can_edit KHÔNG được /related trả kèm (chỉ list_customers() mới attach) —
  // suy lại đúng quy tắc can_edit_customer() ở backend (crm_customer_service.py):
  // admin/leader luôn sửa được; còn lại chỉ khi owner_id === chính mình. Đây
  // chỉ là UX (ẩn/hiện nút Sửa) — server vẫn tự enforce lại khi PUT.
  const canEdit = Boolean(
    customer &&
    user &&
    (isAdminOrLeader(user.role) || String(customer.owner_id || '') === String(user.id || ''))
  );

  // Mirror can_manage_project(user, project=None) o backend cho TAO MOI -
  // CHI Admin/Leader (sale-team membership KHONG cap quyen tao Project, xem
  // crm_permission_service.py) - server van tu enforce lai khi POST.
  const canManageProject = Boolean(user && isAdminOrLeader(user.role));

  if (loading && !data) {
    return (
      <div className="crm-shell">
        <div className="crm-loading">
          <Loader2 className="crm-spin-icon" />
          <span>Đang tải hồ sơ khách hàng...</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="crm-shell">
        <div className="crm-empty">
          <div>
            <h3>Không tải được hồ sơ khách hàng</h3>
            <p>{error}</p>
            <button type="button" className="crm-primary-button crm-empty-action" onClick={() => setReloadTick(t => t + 1)}>
              Thử lại
            </button>
            <Link className="crm-secondary-button crm-empty-action" href="/all-platform/crm/customers">
              Quay về danh sách
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Feedback "chưa lấy tên viết tắt hiển thị nè bro" - truoc day header luon hien ten DAY DU (company_name), bo qua
  // han short_name du da fetch san (chi dung lam tooltip). Dung chung customerDisplay() (da co san, dang dung dung o
  // QuoteWorkspaceModal) de uu tien short_name, fallback ten day du khi chua co short_name.
  const headerDisplay = customerDisplay({ shortName: customer?.short_name, companyName: customer?.company_name, customerName: customer?.customer_name });

  return (
    <div className="crm-shell">
      <section className="crm-page-card crm-customers-page-shell bg-slate-50/70">
        <div className="bg-white border-b border-slate-200 mb-4">
          <div className="px-4 pt-3 text-xs text-slate-500">
            <button type="button" onClick={goBack} className="inline-flex items-center gap-1 hover:text-[#c2185b]">
              <ArrowLeft className="size-3.5" />
              Khách hàng
            </button>
            <span className="mx-1.5">/</span>
            <span>{headerDisplay.title}</span>
          </div>

          <div className="px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-xl font-bold text-slate-900 truncate" title={headerDisplay.sub ? `Tên đầy đủ: ${headerDisplay.sub}` : undefined}>{headerDisplay.title}</h1>
                  {customer?.status ? (
                    <span className="px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-semibold">
                      {STATUS_LABEL[customer.status] || customer.status}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {customer?.phone ? <span>{customer.phone}</span> : null}
                  {customer?.phone && customer?.source ? <span>•</span> : null}
                  {customer?.source ? <span>{customer.source}</span> : null}
                  <span>•</span>
                  <span>Owner: {memberName(customer?.owner_id)}</span>
                </div>
                {error ? <p className="crm-error mt-2">{error}</p> : null}
              </div>
            </div>
          </div>

          <div className="px-4 border-t border-slate-100">
            <div className="flex items-center gap-6 overflow-x-auto">
              {[
                { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
                { id: 'contacts', label: 'Người liên hệ', icon: Users, count: contactCountOverride ?? customer?.contact_count ?? 0 },
                { id: 'projects', label: 'Dự án', icon: FolderKanban, count: projectsSummary?.projectCount || 0 },
                { id: 'deals', label: 'Cơ hội', icon: Target, count: data?.deals?.length || 0 },
                { id: 'quotes', label: 'Báo giá', icon: FileText, count: allQuoteChains.length },
                { id: 'contracts', label: 'Hợp đồng', icon: FileCheck, count: data?.contracts?.length || 0 },
                { id: 'activity', label: 'Hoạt động', icon: Activity, count: activityItems.length },
                { id: 'documents', label: 'Tài liệu', icon: FileText, count: 0 },
              ].map(item => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setOpenDeal(null);
                      setTab(item.id as Tab);
                      if (item.id === 'quotes') setQuoteProjectFilter(null);
                    }}
                    className={`relative h-14 inline-flex items-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                      active ? 'text-[#c2185b]' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                    {item.count !== undefined ? (
                      <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] inline-flex items-center justify-center ${
                        active ? 'bg-rose-100 text-[#c2185b]' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {item.count}
                      </span>
                    ) : null}
                    {active ? <span className="absolute left-0 right-0 bottom-0 h-0.5 rounded-t-full bg-[#c2185b]" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <section className="crm-content-section !p-0 !border-0 !bg-transparent !shadow-none">

          {tab === 'overview' && handoverDocs.length ? <HandoverDocsCard docs={handoverDocs} /> : null}
          {tab === 'overview' && (
            <CustomerOverviewTab
              data={data}
              customerId={customerId}
              allContacts={allContacts}
              members={members}
              projectsSummary={projectsSummary}
              activityItems={activityItems}
              setTab={setTab}
              onCreateDeal={() => setCreateOpportunityOpen(true)}
              onEditCustomer={() => setEditOpen(true)}
            />
          )}

          {tab === 'contacts' && (
            customer ? (
              <CrmContactsPanel
                customerId={customer.id}
                canEdit={canEdit}
                onCountChange={setContactCountOverride}
                onOpenContact={contactId => setOpenContactId(contactId)}
                onCreateDeal={contactId => setDealModal({ open: true, project: null, contactId })}
                onCreateProject={contactId => setProjectModal({ open: true, project: null, contactId })}
              />
            ) : null
          )}

          {tab === 'projects' && (
            <CustomerProjectsTab
              deals={data?.deals || []}
              quotes={allQuoteChains.map(c => c.current)}
              contracts={data?.contracts || []}
              projectsSummary={projectsSummary}
              projectsLoading={projectsLoading}
              projectsError={projectsError}
              canManageProject={canManageProject}
              setTab={setTab}
              openDealWorkspace={openDealWorkspace}
              viewQuoteInNewWorkspace={viewQuoteInNewWorkspace}
              setProjectModal={setProjectModal}
              setDealModal={setDealModal}
              onCreateQuote={openQuoteRequestForProject}
              onCreateContract={projectId => void openRegisterContractForProject(projectId)}
              memberName={memberName}
              allContacts={allContacts}
              activityItems={activityItems}
            />
          )}

          {tab === 'deals' && (
            <CustomerDealSplitTab
              deals={data?.deals || []}
              customerId={customerId}
              customerName={customer?.company_name || customer?.customer_name || ''}
              allContacts={allContacts}
              members={members}
              projectsSummary={projectsSummary}
              quotes={data?.quotes || []}
              activityItems={activityItems}
              handoverDocs={handoverDocs}
              onCreateDeal={() => setCreateOpportunityOpen(true)}
              onCreateQuote={(dealId: string) => {
                const deal = customerQuoteDealsById.get(dealId) || null;
                setQuoteWorkspace({ quoteId: null, deal, initialDealId: dealId });
              }}
              onOpenQuote={(quoteId: string, dealId: string) => {
                const deal = customerQuoteDealsById.get(dealId) || null;
                setQuoteWorkspace({ quoteId, deal });
              }}
              onEditDeal={deal => setEditingDealRow(deal)}
              onChanged={() => setReloadTick(t => t + 1)}
            />
          )}

          {tab === 'quotes' && (
            <CustomerQuotesTab
              customerName={customer?.company_name || customer?.customer_name || ''}
              projectsSummary={projectsSummary}
              members={members}
              allQuoteChains={allQuoteChains}
              quoteChains={quoteChains}
              deals={data?.deals || []}
              allContacts={allContacts}
              loading={loading}
              quickQuoteLoading={quickQuoteLoading}
              quoteStatusFilter={quoteStatusFilter}
              quoteStatusFilterSummary={quoteStatusFilterSummary}
              quoteProjectFilter={quoteProjectFilter}
              expandedQuoteVersions={expandedQuoteVersions}
              quoteDeleteBusy={quoteDeleteBusy}
              QUOTE_STATUS_FILTER_LABELS={QUOTE_STATUS_FILTER_LABELS}
              setQuoteWorkspace={setQuoteWorkspace}
              openQuickQuoteForCustomer={openQuickQuoteForCustomer}
              setQuoteStatusFilter={setQuoteStatusFilter}
              projectLabel={projectLabel}
              setQuoteProjectFilter={setQuoteProjectFilter}
              viewQuoteInNewWorkspace={viewQuoteInNewWorkspace}
              toggleExpandQuoteVersions={toggleExpandQuoteVersions}
              quoteChainPhaseKey={quoteChainPhaseKey}
              quoteChainPhaseBadgeClass={quotePhaseBadgeClass}
              quoteChainPhaseLabel={quoteChainPhaseLabel}
              memberName={memberName}
              formatVND={formatVND}
              relativeTime={relativeTime}
              openContactAssignModal={openContactAssignModal}
              deleteQuoteChainOnCustomerPage={deleteQuoteChainOnCustomerPage}
              quoteVersionStatusLabel={quoteVersionStatusLabel}
              deleteQuoteVersionOnCustomerPage={deleteQuoteVersionOnCustomerPage}
              columnWorkspaceId={API_BASE_URL || null}
              columnUserId={user?.id || null}
            />
          )}

          {tab === 'contracts' && (
            <CustomerContractsTab
              data={data}
              loading={loading}
              allContacts={allContacts}
              registerContractLoading={registerContractLoading}
              openRegisterContractForActiveDeal={() => { setEditingContract(null); return openRegisterContractForActiveDeal(); }}
              onEditContract={openEditContract}
              setReloadTick={setReloadTick}
              customerRef={customer ? { id: customerId, name: customer.company_name || customer.customer_name || 'Khách hàng' } : undefined}
            />
          )}

          {tab === 'activity' && (
            <CustomerActivityTab
              activityItems={activityItems}
              activityLoading={activityLoading}
              activityError={activityError}
            />
          )}

          {tab === 'documents' && (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
              <FileText className="size-10 mx-auto mb-3 text-slate-300 stroke-1" />
              <h3 className="font-bold text-sm text-slate-700">Chưa có tài liệu</h3>
              <p className="text-xs text-slate-400 mt-1">API quản lý tài liệu chưa được triển khai.</p>
            </div>
          )}



        </section>
      </section>

      <CustomerFormModal
        open={editOpen}
        customer={customerRow}
        currentUser={user}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); setReloadTick(t => t + 1); }}
      />
      {contactAssignTarget ? (
        <div className="crm-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !contactAssignSaving) setContactAssignTarget(null); }}>
          <div className="crm-modal crm-modal--confirm" onClick={event => event.stopPropagation()}>
            <header className="crm-modal-header">
              <h2 className="crm-modal-title">Đổi liên hệ chính</h2>
              <button type="button" className="crm-modal-close" onClick={() => !contactAssignSaving && setContactAssignTarget(null)} aria-label="Đóng">
                <X className="crm-icon" />
              </button>
            </header>
            <div className="crm-modal-body">
              <p className="crm-row-sub" style={{ marginTop: 0 }}>Báo giá {contactAssignTarget.quoteNumber}</p>
              <label className="crm-field">
                <span>Người liên hệ chính</span>
                <SearchableSelect
                  value={contactAssignValue}
                  onChange={setContactAssignValue}
                  options={allContacts.map(c => ({ value: c.id, label: c.name }))}
                  placeholder="— Chưa gán —"
                />
              </label>
            </div>
            <footer className="crm-modal-footer">
              <div className="crm-deal-footer-actions">
                <button type="button" className="crm-cancel-button" disabled={contactAssignSaving} onClick={() => setContactAssignTarget(null)}>Huỷ</button>
                <button type="button" className="crm-save-button" disabled={contactAssignSaving} onClick={() => void saveContactAssign()}>
                  {contactAssignSaving ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
      {registerContractDeal ? (
        <RegisterExternalContractModal
          contract={editingContract}
          open={registerContractOpen}
          deal={registerContractDeal}
          customerLabel={customer?.customer_name || customer?.company_name || undefined}
          dealOptions={data?.deals}
          contactOptions={allContacts}
          projectOptions={projectsSummary?.projects}
          // Bao gia da huy/xoa khong nen hien de gan vao Hop dong (feedback
          // 2026-10-01: "báo giá đã hủy đã xóa thì k hiển thị trong dropdown")
          // - dung DUNG dieu kien "cancelled" cua quoteChainPhaseKey (huy
          // TAY hoac deleted_at), giong nhu quoteChains (tab Bao gia) da loc
          // mac dinh, chi khac o day KHONG can toggle "Dang hoat dong" vi
          // day la dropdown chon-de-gan, khong phai bang liet ke.
          quoteOptions={allQuoteChains
            .filter(c => quoteChainPhaseKey(c.current) !== 'cancelled')
            .map(c => ({
              id: c.current.id,
              label: c.current.quote_number || c.current.id,
              dealId: c.current.deal_id,
              projectId: c.current.project_id,
              versionCount: c.versionCount,
            }))}
          onClose={() => { setRegisterContractOpen(false); setEditingContract(null); }}
          onCreated={() => { setRegisterContractOpen(false); setEditingContract(null); setReloadTick(t => t + 1); }}
        />
      ) : null}
      <ProjectFormModal
        open={projectModal.open}
        customerId={customerId}
        customerName={customer?.customer_name || 'Khách hàng chưa tên'}
        currentUserId={user?.id ?? null}
        project={projectModal.project}
        initialContactId={projectModal.contactId}
        onClose={() => setProjectModal({ open: false, project: null })}
        onSaved={() => { setProjectModal({ open: false, project: null }); setReloadTick(t => t + 1); }}
      />
      {dealModal.open && customer ? (
        <DealFormModal
          open={dealModal.open}
          onClose={() => setDealModal({ open: false, project: null, contactId: null })}
          onCreate={input => void handleCreateDeal(input)}
          onUpdate={() => {}}
          agents={dealAgents}
          sourceOptions={dealSourceOptions}
          servicePackageOptions={dealServicePackageOptions}
          packageOptions={dealPackageOptions}
          industryOptions={dealIndustryOptions}
          currentUser={user}
          loading={dealSaving}
          initialCustomer={{
            id: customer.id,
            name: customer.customer_name || '',
            companyName: customer.company_name || undefined,
            phone: customer.phone || undefined,
            email: customer.email || undefined,
          }}
          initialProject={dealModal.project ? { id: dealModal.project.id } : null}
          initialContact={dealModal.contactId ? { id: dealModal.contactId } : null}
        />
      ) : null}
      <CreateOpportunityDrawer
        open={createOpportunityOpen}
        customer={customerRow ? { ...customerRow, canEdit } : null}
        currentUser={user}
        onClose={() => setCreateOpportunityOpen(false)}
        onCreated={() => { setCreateOpportunityOpen(false); setReloadTick(t => t + 1); setTab('deals'); }}
      />
      {quoteWorkspace ? (
        <QuoteWorkspaceModal
          quoteId={quoteWorkspace.quoteId}
          deals={customerQuoteDeals.length ? customerQuoteDeals : quoteWorkspace.deal ? [quoteWorkspace.deal] : []}
          dealsById={customerQuoteDeals.length ? customerQuoteDealsById : new Map(quoteWorkspace.deal ? [[quoteWorkspace.deal.id, quoteWorkspace.deal]] : [])}
          agents={dealAgents}
          user={user}
          defaultFormId={defaultQuoteFormId}
          quoteForms={quoteForms}
          initialCustomerId={customerId}
          initialProjectId={quoteWorkspace.initialProjectId}
          initialDealId={quoteWorkspace.initialDealId}
          lockCustomer={quoteWorkspace.quoteId === null}
          lockProject={quoteWorkspace.lockProject}
          onClose={() => setQuoteWorkspace(null)}
          onChanged={() => setReloadTick(t => t + 1)}
          onEditDraft={editQuote => setQuoteWorkspace({ quoteId: editQuote.id, deal: quoteWorkspace.deal, initialDealId: quoteWorkspace.initialDealId })}
        />
      ) : null}
      {quickQuoteDeal ? (
        <CreateQuoteModal
          open
          deals={[quickQuoteDeal]}
          initialDeal={quickQuoteDeal}
          onClose={() => setQuickQuoteDeal(null)}
          onCreated={() => { setQuickQuoteDeal(null); setReloadTick(t => t + 1); }}
          onUpdated={() => { setQuickQuoteDeal(null); setReloadTick(t => t + 1); }}
        />
      ) : null}

      {/* Cơ hội tab -> mở THẲNG Deal Workspace V2 (Phase 2, DealDetailDrawer) làm
          overlay ngay trong Customer 360, không điều hướng sang /all-platform/crm -
          tái sử dụng nguyên component, không tạo detail UI Deal thứ hai. */}
      <DealDetailDrawer
        customer={openDeal}
        open={Boolean(openDeal) || openDealLoading}
        onClose={() => setOpenDeal(null)}
        onRequestTransition={(c, to) => setDealTransitionTarget({ customer: c, toStage: to })}
        onEditCustomer={c => setEditingDealRow(c)}
        onDeleteCustomer={c => void deleteOpenDeal(c)}
        onCustomerUpdated={updated => {
          setOpenDeal(updated);
          setReloadTick(t => t + 1);
        }}
      />
      {dealTransitionTarget && (
        <StageTransitionModal
          customer={dealTransitionTarget.customer}
          toStage={dealTransitionTarget.toStage}
          isOpen={!!dealTransitionTarget}
          onClose={() => setDealTransitionTarget(null)}
          onSubmit={submitDealTransition}
        />
      )}
      <CrmCustomerModal
        isOpen={!!editingDealRow}
        customer={editingDealRow}
        onClose={() => setEditingDealRow(null)}
        onSuccess={updated => {
          setEditingDealRow(null);
          setOpenDeal(prev => (prev ? updated : null));
          setReloadTick(t => t + 1);
        }}
      />

      <ContactDetailDrawer
        contactId={openContactId}
        open={Boolean(openContactId)}
        onClose={() => setOpenContactId(null)}
        onOpenDeal={openDealWorkspace}
        onOpenCompany={() => setOpenContactId(null)}
        onCreateDeal={contactId => setDealModal({ open: true, project: null, contactId })}
        onCreateProject={contactId => setProjectModal({ open: true, project: null, contactId })}
      />
    </div>
  );
}

function InfoItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`crm-detail-info-item ${full ? 'crm-detail-info-item--full' : ''}`}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

// HMR Touch 1790529193.9471252
