'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { formatVND, getStageMeta, SOURCE_OPTIONS, SERVICE_PACKAGE_OPTIONS, CRM_PACKAGE_OPTIONS, INDUSTRY_OPTIONS } from '../constants/crmConfig';
import type { CreateDealInput, CrmUserOption, DealStage } from '../types';
import { CustomerFormModal } from './CustomerFormModal';
import { CrmContactsPanel } from './CrmContactsPanel';
import { ProjectFormModal } from './ProjectFormModal';
import { DealFormModal, clearDealDraft } from './DealFormModal';
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
import type { Quote } from '@/modules/quotes';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { Deal } from '../types';
import { DealDetailDrawer } from '@/components/all-platform/customers/DealDetailDrawer';
import { ContactDetailDrawer } from '@/components/all-platform/customers/ContactDetailDrawer';
import { StageTransitionModal } from '@/components/all-platform/customers/StageTransitionModal';
import { CrmCustomerModal } from '@/components/all-platform/components/CrmCustomerModal';
import { customerLeadService, type Customer as LiveDealRow, type DealStage as LiveDealStage } from '@/services/customer-lead.service';
import { RegisterExternalContractModal } from '@/components/all-platform/customers/RegisterExternalContractModal';
import { contractStatusLabel } from '@/modules/contracts/constants/contractConfig';
import { cascadeSummaryFromBody, cascadeWarningText } from '../utils/cascadeDelete';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CustomerProjectCrmOverview } from './CustomerProjectCrmOverview';
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
} from 'lucide-react';

function formatContractDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN');
}

// Tai su dung DUNG 1 kieu badge nguon hop dong voi ContractTab (Deal
// Workspace, DealWorkspaceTabs.tsx) - "Hợp đồng" o Customer 360 va o Deal
// Workspace phai hien THONG NHAT vi cung 1 bang `contracts` (Phase 1: hop
// dong resolve qua deal_id HOAC customer_id truc tiep).
function contractSourceBadge(source?: 'crm' | 'external' | null) {
  return source === 'external' ? (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Bên ngoài</span>
  ) : (
    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Tạo trong CRM</span>
  );
}

type CustomerActivityEntry = {
  id: string;
  action: string;
  from_stage?: string | null;
  to_stage?: string | null;
  note?: string | null;
  actor_name?: string | null;
  created_at: string;
};

type RelatedPayload = {
  customer?: {
    id: string;
    customer_name?: string | null;
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
  new_lead: 'crm-customer-status--new',
  following: 'crm-customer-status--following',
  current_customer: 'crm-customer-status--current',
  not_fit: 'crm-customer-status--not-fit',
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

// Mau badge cot "Phase" (feedback "ở cột phase thì nút cho có màu giống như
// bên trang báo giá vậy") - dung dung bang mau qc-badge-<tone> ma
// phaseCellLabel() o QuoteCenterPage.tsx dang dung, chi khac o day khoa theo
// quoteChainPhaseKey (6 trang thai) thay vi tinh lai tu dau.
const QUOTE_PHASE_TONE: Partial<Record<QuoteStatusFilter, string>> = {
  cancelled: 'danger',
  sent: 'success',
  ready: 'teal',
  review: 'purple',
  pricing: 'amber',
  presale: 'blue',
};
function quotePhaseBadgeClass(key: QuoteStatusFilter): string {
  return `qc-badge qc-badge-${QUOTE_PHASE_TONE[key] || 'neutral'}`;
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
function ContactAssignCell({
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

type Tab = 'overview' | 'activity' | 'contacts' | 'projects' | 'deals' | 'quotes' | 'contracts';

export function CrmCustomerDetailPage({ customerId }: { customerId: string }) {
  const { user } = useAppAuth();
  const searchParams = useSearchParams();
  const [data, setData] = useState<RelatedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Cho phep deep-link tu trang khac (vd cot "Dự án" o Trung tâm báo giá):
  // ?tab=quotes&projectId=xxx -> mo dung tab + loc dung Du an ngay khi vao
  // trang, khong bat nguoi dung tu bam lai. Chi doc 1 LAN luc mount (gia tri
  // ban dau cua useState) - doi tab/filter sau do van la tuong tac binh
  // thuong cua nguoi dung, khong bi query string cu ghi de lai.
  const initialTabParam = searchParams.get('tab');
  const initialTab: Tab =
    initialTabParam === 'quotes' || initialTabParam === 'deals' || initialTabParam === 'contracts' || initialTabParam === 'projects' || initialTabParam === 'activity' || initialTabParam === 'contacts'
      ? initialTabParam
      : 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editOpen, setEditOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

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
  const [allContacts, setAllContacts] = useState<any[]>([]);

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

  async function submitDealTransition(payload: any) {
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
      const res = await projectsService.update(project.id, { status: 'cancelled' } as any);
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
  const [quoteWorkspace, setQuoteWorkspace] = useState<{ quoteId: string | null; deal: Deal | null; initialProjectId?: string; lockProject?: boolean } | null>(null);
  const [quoteWorkspaceLoading, setQuoteWorkspaceLoading] = useState(false);
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

  async function viewQuoteInNewWorkspace(row: RelatedQuoteRow) {
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

  const initial = (customer?.customer_name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="crm-shell">
      <section className="crm-page-card crm-customers-page-shell">
        <Link href="/all-platform/crm/customers" className="crm-back-button crm-customer-detail-back">
          ← Hồ sơ khách hàng
        </Link>
        <div className="crm-header">
          <div className="crm-customer-detail-header">
            <span className="crm-customer-avatar" aria-hidden="true">{initial}</span>
            <div className="crm-customer-detail-title">
              <h1>{customer?.customer_name || 'Khách hàng chưa tên'}</h1>
              <div className="crm-customer-detail-meta">
                <span>{[customer?.company_name, customer?.phone, customer?.email].filter(Boolean).join(' · ') || 'Chưa có thông tin liên hệ'}</span>
                {customer?.status ? (
                  <span className={`crm-customer-status-badge ${STATUS_BADGE_CLASS[customer.status] || ''}`}>
                    {STATUS_LABEL[customer.status] || customer.status}
                  </span>
                ) : null}
              </div>
              {error ? <p className="crm-error">{error}</p> : null}
            </div>
          </div>
          {/* "Sửa khách hàng" chuyển vào cuối tab Tổng quan, "+ Tạo dự án" /
           * "+ Tạo cơ hội" bị xoá khỏi day vi da co nut tuong duong ben
           * trong tab "Dự án" ("+ Tạo dự án mới" + "Tạo cơ hội" tren tung
           * project-card), "+ Tạo báo giá" chuyen vao dau noi dung tab "Báo
           * giá" - xem cac vi tri moi (feedback 2026-09-25, PDF muc 3/4/5). */}
        </div>

        <section className="crm-content-section">
          {/* [CHỨC NĂNG: Thanh menu điều hướng tab hồ sơ khách hàng hiện đại]
              - Gồm 7 tab: Tổng quan, Người liên hệ, Dự án, Cơ hội, Báo giá, Hợp đồng, Hoạt động.
              - Căn đều 100% toàn chiều rộng (flex-1 cho từng tab), căn giữa nội dung.
              - Tự động bật cuộn ngang (overflow-x-auto) khi kích thước màn hình nhỏ. */}
          <div className="w-full bg-muted/70 p-1.5 rounded-2xl border border-border/80 flex items-center gap-1.5 overflow-x-auto shadow-xs backdrop-blur-md mb-6 scroll-smooth">
            <button
              type="button"
              onClick={() => setTab('overview')}
              className={`flex-1 min-w-[110px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 select-none whitespace-nowrap ${tab === 'overview'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
            >
              <LayoutDashboard className={`size-3.5 transition-colors shrink-0 ${tab === 'overview' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>Tổng quan</span>
            </button>

            <button
              type="button"
              onClick={() => setTab('contacts')}
              className={`flex-1 min-w-[125px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 select-none whitespace-nowrap ${tab === 'contacts'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
            >
              <Users className={`size-3.5 transition-colors shrink-0 ${tab === 'contacts' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>Người liên hệ</span>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-full leading-tight transition-colors shrink-0 ${tab === 'contacts'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted-foreground/10 text-muted-foreground'
                  }`}
              >
                {contactCountOverride ?? customer?.contact_count ?? 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('projects')}
              className={`flex-1 min-w-[110px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 select-none whitespace-nowrap ${tab === 'projects'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
            >
              <FolderKanban className={`size-3.5 transition-colors shrink-0 ${tab === 'projects' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>Dự án</span>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-full leading-tight transition-colors shrink-0 ${tab === 'projects'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted-foreground/10 text-muted-foreground'
                  }`}
              >
                {projectsSummary?.projectCount || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('deals')}
              className={`flex-1 min-w-[110px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 select-none whitespace-nowrap ${tab === 'deals'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
            >
              <Target className={`size-3.5 transition-colors shrink-0 ${tab === 'deals' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>Cơ hội</span>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-full leading-tight transition-colors shrink-0 ${tab === 'deals'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted-foreground/10 text-muted-foreground'
                  }`}
              >
                {data?.deals?.length || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setTab('quotes'); setQuoteProjectFilter(null); }}
              className={`flex-1 min-w-[110px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 select-none whitespace-nowrap ${tab === 'quotes'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
            >
              <FileText className={`size-3.5 transition-colors shrink-0 ${tab === 'quotes' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>Báo giá</span>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-full leading-tight transition-colors shrink-0 ${tab === 'quotes'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted-foreground/10 text-muted-foreground'
                  }`}
              >
                {allQuoteChains.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('contracts')}
              className={`flex-1 min-w-[110px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 select-none whitespace-nowrap ${tab === 'contracts'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
            >
              <FileCheck className={`size-3.5 transition-colors shrink-0 ${tab === 'contracts' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>Hợp đồng</span>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-full leading-tight transition-colors shrink-0 ${tab === 'contracts'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted-foreground/10 text-muted-foreground'
                  }`}
              >
                {data?.contracts?.length || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('activity')}
              className={`flex-1 min-w-[110px] inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 select-none whitespace-nowrap ${tab === 'activity'
                ? 'bg-card text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
            >
              <Activity className={`size-3.5 transition-colors shrink-0 ${tab === 'activity' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>Hoạt động</span>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-full leading-tight transition-colors shrink-0 ${tab === 'activity'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted-foreground/10 text-muted-foreground'
                  }`}
              >
                {activityItems.length}
              </span>
            </button>
          </div>

          {tab === 'overview' && (
            <div className="space-y-6 pt-2">
              {/* 1. BỘ 4 THẺ CHỈ SỐ HERO METRICS (TƯƠNG TÁC ĐƯỢC) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card
                  onClick={() => setTab('projects')}
                  className="p-4 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/30 group bg-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
                      Dự án
                    </span>
                    <div className="size-9 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-105">
                      <Briefcase className="size-4.5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      {projectsSummary?.projectCount ?? 0}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <span>{projectsSummary?.activeProjectCount ?? 0} đang hoạt động</span>
                      <ArrowRight className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary ml-auto" />
                    </p>
                  </div>
                </Card>

                <Card
                  onClick={() => setTab('deals')}
                  className="p-4 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/30 group bg-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
                      Cơ hội (Deals)
                    </span>
                    <div className="size-9 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 flex items-center justify-center transition-transform group-hover:scale-105">
                      <TrendingUp className="size-4.5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      {data?.deals?.length ?? data?.kpi?.deal_count ?? 0}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <span>Tổng: {formatVND(totalDealsBudget)}</span>
                      <ArrowRight className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary ml-auto" />
                    </p>
                  </div>
                </Card>

                <Card
                  onClick={() => { setTab('quotes'); setQuoteProjectFilter(null); }}
                  className="p-4 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/30 group bg-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
                      Quote Cases
                    </span>
                    <div className="size-9 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 flex items-center justify-center transition-transform group-hover:scale-105">
                      <FileText className="size-4.5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      {projectsSummary?.quoteCaseCount ?? data?.kpi?.quote_count ?? allQuoteChains.length}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <span>{allQuoteChains.length} chuỗi báo giá</span>
                      <ArrowRight className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary ml-auto" />
                    </p>
                  </div>
                </Card>

                <Card
                  onClick={() => setTab('contracts')}
                  className="p-4 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/30 group bg-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
                      Giá đang quote
                    </span>
                    <div className="size-9 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 flex items-center justify-center transition-transform group-hover:scale-105">
                      <Banknote className="size-4.5" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold tracking-tight text-foreground truncate">
                      {formatVND(projectsSummary?.currentQuoteValue || data?.kpi?.total_value || 0) || '0 đ'}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <span>{data?.contracts?.length ?? data?.kpi?.contract_count ?? 0} hợp đồng</span>
                      <ArrowRight className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary ml-auto" />
                    </p>
                  </div>
                </Card>
              </div>

              {/* 2. CƠ HỘI ĐANG XÚC TIẾN (ACTIVE DEAL SPOTLIGHT) */}
              {activeDeal ? (
                <Card className="border-primary/20 bg-linear-to-r from-card to-primary/[0.02] shadow-xs">
                  <CardHeader className="py-4 px-6 border-b border-border/60 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        <Sparkles className="size-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold text-foreground">
                          Cơ hội đang xúc tiến
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">Deal đang được xử lý gần nhất của khách hàng</p>
                      </div>
                    </div>
                    {(() => {
                      const meta = getStageMeta((activeDeal.deal_stage as DealStage) || 'new_lead');
                      return (
                        <Badge
                          variant="outline"
                          style={{ borderColor: meta.color, color: meta.color }}
                          className="font-medium px-2.5 py-0.5"
                        >
                          {meta.label}
                        </Badge>
                      );
                    })()}
                  </CardHeader>
                  <CardContent className="py-4 px-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-0.5">
                          Tên cơ hội
                        </span>
                        <p className="text-sm font-semibold text-foreground truncate" title={activeDeal.customer_name || activeDeal.id}>
                          {activeDeal.customer_name || activeDeal.id}
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-0.5">
                          Dự án liên kết
                        </span>
                        <p className="text-sm text-foreground truncate" title={projectLabel(activeDeal.project_id)}>
                          {projectLabel(activeDeal.project_id)}
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-0.5">
                          Giá trị kỳ vọng
                        </span>
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {formatVND(Number(activeDeal.estimated_budget || activeDeal.lifetime_value || 0)) || '0 đ'}
                        </p>
                      </div>
                      <div className="flex sm:justify-end">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => openDealWorkspace(activeDeal.id)}
                          className="w-full sm:w-auto gap-1.5 shadow-xs"
                        >
                          <span>Mở Deal Workspace</span>
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* 3. THÔNG TIN KHÁCH HÀNG 360 (BỐ CỤC 2 CỘT HIỆN ĐẠI) */}
              {customer ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Cột 1: Thông tin Doanh nghiệp & Pháp lý */}
                  <Card className="bg-card shadow-xs">
                    <CardHeader className="py-3.5 px-5 border-b border-border/60 flex flex-row items-center gap-2">
                      <Building2 className="size-4 text-primary" />
                      <CardTitle className="text-sm font-semibold text-foreground">
                        Thông tin doanh nghiệp & Pháp lý
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-5 space-y-3.5 text-sm">
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Tên công ty</span>
                        <span className="font-medium text-foreground text-right">{customer.company_name || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Mã số thuế</span>
                        <span className="font-mono text-xs font-medium text-foreground text-right">{customer.tax_code || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Lĩnh vực</span>
                        <span>
                          {customer.industry ? (
                            <Badge variant="secondary" className="font-normal text-xs">{customer.industry}</Badge>
                          ) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Thành phố</span>
                        <span className="text-foreground text-right">{customer.city || '—'}</span>
                      </div>
                      <div className="flex items-start justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Địa chỉ</span>
                        <span className="text-foreground text-right max-w-[65%]">{customer.address || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Website</span>
                        <span>
                          {customer.website ? (
                            <a
                              href={customer.website.startsWith('http') ? customer.website : `https://${customer.website}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                            >
                              {customer.website} <ExternalLink className="size-3" />
                            </a>
                          ) : '—'}
                        </span>
                      </div>
                      {customer.note ? (
                        <div className="pt-1">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Ghi chú nội bộ</span>
                          <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground whitespace-pre-line border border-border/50">
                            {customer.note}
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  {/* Cột 2: Phụ trách & Kênh liên lạc */}
                  <Card className="bg-card shadow-xs">
                    <CardHeader className="py-3.5 px-5 border-b border-border/60 flex flex-row items-center gap-2">
                      <UserCheck className="size-4 text-primary" />
                      <CardTitle className="text-sm font-semibold text-foreground">
                        Nhân sự phụ trách & Kênh kết nối
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-5 space-y-3.5 text-sm">
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Người phụ trách</span>
                        <div className="flex items-center gap-2">
                          {customer.owner_id ? (
                            <>
                              <span className="size-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">
                                {memberName(customer.owner_id).charAt(0).toUpperCase()}
                              </span>
                              <span className="font-medium text-foreground">{memberName(customer.owner_id)}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground italic">Chưa phân công</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Chức vụ</span>
                        <span className="text-foreground">{customer.position || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Số điện thoại</span>
                        <span>
                          {customer.phone ? (
                            <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors">
                              <Phone className="size-3.5 text-muted-foreground" />
                              {customer.phone}
                            </a>
                          ) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Email</span>
                        <span>
                          {customer.email ? (
                            <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 text-foreground hover:text-primary transition-colors">
                              <Mail className="size-3.5 text-muted-foreground" />
                              {customer.email}
                            </a>
                          ) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Nguồn khách hàng</span>
                        <span>
                          {customer.source ? (
                            <Badge variant="outline" className="font-normal text-xs">{customer.source}</Badge>
                          ) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Zalo</span>
                        <span className="text-foreground">{customer.zalo || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between pb-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">Facebook</span>
                        <span>
                          {customer.facebook ? (
                            <a
                              href={customer.facebook.startsWith('http') ? customer.facebook : `https://${customer.facebook}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline font-medium inline-flex items-center gap-1"
                            >
                              Mở trang cá nhân <ExternalLink className="size-3" />
                            </a>
                          ) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Telegram</span>
                        <span className="text-foreground">{customer.telegram || '—'}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {/* 4. KHỐI TÓM TẮT DỰ ÁN & BÁO GIÁ GẦN NHẤT (KHÔNG BIỂU ĐỒ) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Danh sách Dự án gần đây */}
                <Card className="bg-card shadow-xs">
                  <CardHeader className="py-3 px-5 border-b border-border/60 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FolderKanban className="size-4 text-primary" />
                      <CardTitle className="text-sm font-semibold text-foreground">
                        Dự án gần đây
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTab('projects')}
                      className="text-xs h-7 text-primary hover:text-primary gap-1"
                    >
                      Xem tất cả ({projectsSummary?.projectCount || 0}) <ArrowRight className="size-3" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-4">
                    {recentProjects.length > 0 ? (
                      <div className="space-y-2.5">
                        {recentProjects.map(p => (
                          <div
                            key={p.id}
                            onClick={() => { setQuoteProjectFilter(p.id); setTab('quotes'); }}
                            className="p-3 rounded-lg border border-border/60 hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer flex items-center justify-between"
                          >
                            <div className="min-w-0 mr-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-semibold text-primary">{p.projectCode}</span>
                                <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {p.quoteCaseCount} Quote case · {p.opportunityCount} cơ hội
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[11px] shrink-0">
                              {PROJECT_STATUS_LABELS[p.status] || p.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        Khách hàng chưa có dự án nào
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Danh sách Báo giá gần nhất */}
                <Card className="bg-card shadow-xs">
                  <CardHeader className="py-3 px-5 border-b border-border/60 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-primary" />
                      <CardTitle className="text-sm font-semibold text-foreground">
                        Báo giá gần nhất
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setTab('quotes'); setQuoteProjectFilter(null); }}
                      className="text-xs h-7 text-primary hover:text-primary gap-1"
                    >
                      Xem tất cả ({allQuoteChains.length}) <ArrowRight className="size-3" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-4">
                    {recentQuotes.length > 0 ? (
                      <div className="space-y-2.5">
                        {recentQuotes.map(({ current, versionCount }) => (
                          <div
                            key={current.id}
                            onClick={() => viewQuoteInNewWorkspace(current)}
                            className="p-3 rounded-lg border border-border/60 hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer flex items-center justify-between"
                          >
                            <div className="min-w-0 mr-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-semibold text-foreground">
                                  {current.quote_number || 'Báo giá'}
                                </span>
                                {versionCount > 1 ? (
                                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                    {versionCount} versions
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Cập nhật: {current.updated_at ? relativeTime(current.updated_at) : '—'}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-bold text-foreground">
                                {formatVND(Number(current.total_amount || 0)) || '0 đ'}
                              </div>
                              <span className="text-[10px] text-muted-foreground">
                                {quoteChainPhaseLabel(current)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        Chưa có báo giá nào được tạo
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* 5. NÚT CHỈNH SỬA KHÁCH HÀNG */}
              {canEdit ? (
                <div className="flex justify-end pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setEditOpen(true)}
                    className="gap-2 shadow-xs"
                  >
                    <Edit3 className="size-3.5" />
                    <span>Sửa thông tin khách hàng</span>
                  </Button>
                </div>
              ) : null}
            </div>
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

          {/* [CHỨC NĂNG: Giao diện Tab Hoạt Động (Activity Tab) chuẩn hóa theo tab Người liên hệ]
              - Mục đích: Thay thế danh sách hoạt động trần trụi trước đây bằng giao diện chuẩn chỉnh.
              - Thay đổi:
                1. Khung panel bao ngoài: .crm-contacts-panel .crm-activity-panel viền bo tròn 0.85rem, nền trắng sạch sẽ.
                2. Header: Tiêu đề .crm-section-title "Hoạt động (N)" kèm mô tả phạm vi hoạt động bán hàng.
                3. Từng dòng hoạt động là một bảng/khung thẻ riêng biệt (.crm-activity-row):
                   - Nền xám nhạt #f8fafc, viền 1px solid #e2e8f0, bo góc 0.6rem, padding 0.75rem 0.9rem, hover đổi màu nhẹ.
                   - Luồng giai đoạn: Hiển thị thẻ pill màu sắc tương ứng theo stage meta (ví dụ: Đang deal → Lên Proposal).
                   - Người thực hiện: Badge pill actor_name nổi bật.
                   - Ghi chú: Khung riêng biệt nền trắng có viền và ngắt dòng rõ ràng.
                   - Thời gian: Căn lề trên phải, hiển thị định dạng ngày giờ tiếng Việt (vi-VN). */}
          {tab === 'activity' && (
            <Card className="bg-card shadow-xs">
              <CardHeader className="py-4 px-6 border-b border-border/60 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Activity className="size-4.5 text-primary" />
                    <span>Hoạt động bán hàng</span>
                    <Badge variant="secondary" className="text-xs px-2 py-0.5 font-bold">
                      {activityItems.length}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Nhật ký hoạt động — gộp từ tất cả các Cơ hội của khách hàng này.
                  </p>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                {activityError ? (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs mb-4">
                    {activityError}
                  </div>
                ) : null}

                {activityLoading ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span>Đang tải nhật ký hoạt động...</span>
                  </div>
                ) : activityItems.length ? (
                  <div className="space-y-3">
                    {activityItems.map(entry => {
                      const fromMeta = entry.from_stage ? getStageMeta(entry.from_stage as DealStage) : null;
                      const toMeta = entry.to_stage ? getStageMeta(entry.to_stage as DealStage) : null;

                      return (
                        <div
                          key={entry.id}
                          className="p-4 rounded-xl border border-border/70 bg-muted/20 hover:bg-card hover:border-primary/30 transition-all shadow-2xs space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {entry.from_stage && entry.to_stage ? (
                                <div className="inline-flex items-center gap-1.5 text-xs font-medium">
                                  <span
                                    className="px-2 py-0.5 rounded-full border text-[11px] font-semibold"
                                    style={{ borderColor: fromMeta?.color, color: fromMeta?.color }}
                                  >
                                    {fromMeta?.label || entry.from_stage}
                                  </span>
                                  <ArrowRight className="size-3 text-muted-foreground" />
                                  <span
                                    className="px-2 py-0.5 rounded-full border text-[11px] font-semibold"
                                    style={{ borderColor: toMeta?.color, color: toMeta?.color }}
                                  >
                                    {toMeta?.label || entry.to_stage}
                                  </span>
                                </div>
                              ) : (
                                <span className="font-semibold text-xs text-foreground">{entry.action}</span>
                              )}

                              {entry.actor_name ? (
                                <Badge variant="outline" className="text-[11px] font-normal gap-1 bg-background text-muted-foreground">
                                  <UserCheck className="size-3 text-primary" />
                                  <span>{entry.actor_name}</span>
                                </Badge>
                              ) : null}
                            </div>

                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="size-3" />
                              {new Date(entry.created_at).toLocaleString('vi-VN')}
                            </span>
                          </div>

                          {entry.note ? (
                            <div className="text-xs text-foreground bg-background/80 p-2.5 rounded-lg border border-border/60 leading-relaxed font-sans">
                              {entry.note}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                    <Activity className="size-8 text-muted-foreground/30 stroke-1" />
                    <span>Chưa có hoạt động bán hàng nào được ghi nhận.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {tab === 'projects' ? (
            <div className="space-y-6">
              {/* Tổng quan Cơ hội & Báo giá (vị trí giữa thanh điều hướng và khung tạo dự án mới) */}
              <CustomerProjectCrmOverview
                deals={data?.deals || []}
                quotes={allQuoteChains.map(c => c.current)}
                onNavigateTab={(targetTab) => {
                  if (targetTab === 'quotes') setQuoteProjectFilter(null);
                  setTab(targetTab);
                }}
                onOpenDeal={(dealId) => {
                  void openDealWorkspace(dealId);
                }}
                onOpenQuote={(quoteRow) => {
                  void viewQuoteInNewWorkspace(quoteRow as any);
                }}
              />

              {/* Header Tab Dự án */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-card border border-border/80 shadow-xs">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    <FolderKanban className="size-4.5 text-primary" />
                    <span>Dự án của khách hàng</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Lớp quản lý gắn kết giữa Khách hàng và các Cơ hội/Báo giá dự án.
                  </p>
                </div>
                {canManageProject ? (
                  <Button
                    size="sm"
                    className="gap-1.5 shadow-xs"
                    onClick={() => setProjectModal({ open: true, project: null })}
                  >
                    <Plus className="size-3.5" />
                    <span>Tạo dự án mới</span>
                  </Button>
                ) : null}
              </div>

              {projectsLoading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span>Đang tải dữ liệu dự án...</span>
                </div>
              ) : projectsError ? (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                  {projectsError}
                </div>
              ) : !projectsSummary || projectsSummary.projectCount === 0 ? (
                <div className="py-16 text-center rounded-2xl bg-card border border-border/80 shadow-xs flex flex-col items-center gap-3">
                  <FolderKanban className="size-10 text-muted-foreground/30 stroke-1" />
                  <div className="text-sm font-medium text-foreground">Khách hàng này chưa có dự án nào</div>
                  <p className="text-xs text-muted-foreground max-w-sm">Tạo dự án đầu tiên để theo dõi cơ hội và quy trình báo giá cho khách hàng.</p>
                  {canManageProject ? (
                    <Button
                      size="sm"
                      className="mt-2 gap-1.5"
                      onClick={() => setProjectModal({ open: true, project: null })}
                    >
                      <Plus className="size-3.5" /> Tạo dự án đầu tiên
                    </Button>
                  ) : null}
                </div>
              ) : (
                <>
                  {/* Dashboard 5 chỉ số tóm tắt dự án */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <Card className="p-3.5 bg-card shadow-xs">
                      <p className="text-xs font-medium text-muted-foreground">Tổng dự án</p>
                      <p className="text-xl font-bold text-foreground mt-1">{projectsSummary.projectCount}</p>
                    </Card>

                    <Card className="p-3.5 bg-card shadow-xs">
                      <p className="text-xs font-medium text-muted-foreground">Đang hoạt động</p>
                      <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{projectsSummary.activeProjectCount}</p>
                    </Card>

                    <Card
                      onClick={() => { setQuoteProjectFilter(null); setTab('quotes'); }}
                      className="p-3.5 bg-card shadow-xs cursor-pointer hover:border-primary/40 hover:shadow-md transition-all group"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
                        <span>Quote Cases</span>
                        <ArrowRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-xl font-bold text-foreground mt-1">{projectsSummary.quoteCaseCount}</p>
                    </Card>

                    <Card
                      onClick={() => setTab('deals')}
                      className="p-3.5 bg-card shadow-xs cursor-pointer hover:border-primary/40 hover:shadow-md transition-all group"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
                        <span>Cơ hội CRM</span>
                        <ArrowRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-xl font-bold text-foreground mt-1">{projectsSummary.opportunityCount}</p>
                    </Card>

                    <Card className="p-3.5 bg-card shadow-xs col-span-2 sm:col-span-1">
                      <p className="text-xs font-medium text-muted-foreground">Giá trị quote</p>
                      <p className="text-xl font-bold text-primary mt-1">{formatMoney(projectsSummary.currentQuoteValue)}</p>
                    </Card>
                  </div>

                  {/* Lưới thẻ dự án */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {projectsSummary.projects.map(project => (
                      <Card key={project.id} className="bg-card shadow-xs hover:shadow-md hover:border-primary/40 transition-all p-5 flex flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between gap-3 pb-3 border-b border-border/50">
                            <div>
                              <Badge variant="outline" className="font-mono text-[10px] mb-1.5 bg-muted/50">
                                {project.projectCode}
                              </Badge>
                              <h4 className="text-base font-bold text-foreground">{project.name}</h4>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-xs font-semibold shrink-0 ${project.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
                                : project.status === 'completed'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400'
                                  : project.status === 'cancelled'
                                    ? 'bg-destructive/10 text-destructive border-destructive/20'
                                    : 'bg-muted text-muted-foreground'
                                }`}
                            >
                              {PROJECT_STATUS_LABELS[project.status] || project.status}
                            </Badge>
                          </div>

                          <div className="py-3.5 space-y-2 text-xs text-muted-foreground">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1.5"><UserCheck className="size-3.5 text-primary" /> Phụ trách:</span>
                              <span className="font-medium text-foreground">{memberName(project.managerId)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1.5"><Target className="size-3.5 text-blue-500" /> Cơ hội:</span>
                              <span className="font-medium text-foreground">{project.opportunityCount} cơ hội</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1.5"><FileText className="size-3.5 text-amber-500" /> Báo giá & Version:</span>
                              <span className="font-medium text-foreground">{project.quoteCaseCount} Quote Case · {project.versionCount} version</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-indigo-500" /> Đang xử lý:</span>
                              <span className="font-medium text-foreground">{project.processingCount} case</span>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-border/40">
                              <span className="flex items-center gap-1.5 font-medium text-foreground"><Banknote className="size-3.5 text-emerald-500" /> Giá quote hiện tại:</span>
                              <span className="text-sm font-bold text-foreground">{formatMoney(project.currentQuoteValue)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-border/60">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => { setQuoteProjectFilter(project.id); setTab('quotes'); }}
                          >
                            Xem báo giá
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => openQuoteRequestForProject(project.id)}
                          >
                            Tạo yêu cầu báo giá
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            disabled={quickQuoteLoading}
                            onClick={() => void openQuickQuoteForProject(project.id)}
                          >
                            {quickQuoteLoading ? 'Đang tải...' : 'Báo giá nhanh'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => setDealModal({ open: true, project, contactId: null })}
                          >
                            Tạo cơ hội
                          </Button>
                          {canManageProject ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-8"
                              onClick={() => setProjectModal({ open: true, project })}
                            >
                              Sửa
                            </Button>
                          ) : null}
                          {canManageProject && project.status !== 'cancelled' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-8 text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto"
                              onClick={() => void cancelProject(project)}
                            >
                              Hủy
                            </Button>
                          ) : null}
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === 'projects' || tab === 'overview' || tab === 'activity' ? null : (
            <Card className="bg-card shadow-xs border border-border/80 overflow-hidden">
              <div className="crm-table-scroll">
                {tab === 'deals' ? (
                <div>
                  <div className="py-3 px-5 border-b border-border/60 flex items-center justify-between bg-muted/20">
                    <div className="flex items-center gap-2">
                      <Target className="size-4 text-primary" />
                      <span className="font-semibold text-sm text-foreground">Danh sách Cơ hội</span>
                      <Badge variant="secondary" className="text-xs font-bold px-2 py-0.5">
                        {data?.deals?.length || 0}
                      </Badge>
                    </div>
                  </div>
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th className="crm-th">Tên cơ hội</th>
                        <th className="crm-th">Liên hệ chính</th>
                        <th className="crm-th">Dự án</th>
                        <th className="crm-th">Giai đoạn</th>
                        <th className="crm-th crm-th--right">Giá trị</th>
                        <th className="crm-th">Cập nhật</th>
                        <th className="crm-th crm-th--right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={7} className="crm-empty-cell">Đang tải...</td></tr>
                      ) : data?.deals?.length ? (
                        data.deals.map(deal => {
                          const primaryContactName = deal.primary_contact_id
                            ? allContacts.find(c => c.id === deal.primary_contact_id)?.name || 'Liên hệ ẩn'
                            : 'Chưa có';
                          return (
                            <tr
                              key={deal.id}
                              className="crm-row hover:bg-muted/30 transition-colors"
                              style={{ cursor: 'pointer' }}
                              onClick={() => openDealWorkspace(deal.id)}
                              title="Mở Deal Workspace"
                            >
                              <td className="crm-td"><strong>{deal.customer_name || deal.id}</strong></td>
                              <td className="crm-td crm-muted">{primaryContactName}</td>
                              <td className="crm-td crm-muted">{projectLabel(deal.project_id)}</td>
                              <td className="crm-td">
                                {(() => {
                                  const meta = getStageMeta((deal.deal_stage as DealStage) || 'new_lead');
                                  return (
                                    <span className={`crm-stage-badge ${meta.badgeClass}`}>{meta.label}</span>
                                  );
                                })()}
                              </td>
                              <td className="crm-td crm-td--right font-semibold text-emerald-600 dark:text-emerald-400">{formatVND(Number(deal.estimated_budget || deal.lifetime_value || 0)) || '0 đ'}</td>
                              <td className="crm-td crm-muted crm-time-cell">
                                {relativeTime(deal.updated_at || deal.created_at || undefined)}
                              </td>
                              <td className="crm-td crm-td--right" onClick={event => event.stopPropagation()}>
                                <ContactAssignCell
                                  dealId={deal.id}
                                  currentContactId={deal.primary_contact_id}
                                  contacts={allContacts}
                                  onAssigned={() => setReloadTick(t => t + 1)}
                                />
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr><td colSpan={7} className="crm-empty-cell">Chưa có cơ hội nào.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <>
                  {/* "+ Tạo cơ hội" o dau tab (feedback "trước đó có làm nhưng
                   * giờ bỏ rồi, giờ thêm lại") - da bo o header trang tu
                   * 2026-09-25 vi tuong tu da co ben trong tab "Dự án", nhung
                   * user van muon co ngay trong tab "Cơ hội" - dung lai dung
                   * DealFormModal/dealModal da co san (project: null giong
                   * het nut "Tạo cơ hội" o tab Nguoi lien he). */}
                  <div className="crm-quotes-tab-head">
                    <button
                      type="button"
                      className="crm-primary-button"
                      onClick={() => setDealModal({ open: true, project: null, contactId: null })}
                    >
                      + Tạo cơ hội
                    </button>
                  </div>
                  <table className="crm-table">
                  <thead>
                    <tr>
                      <th className="crm-th">Tên cơ hội</th>
                      <th className="crm-th">Liên hệ chính</th>
                      <th className="crm-th">Dự án</th>
                      <th className="crm-th">Giai đoạn</th>
                      <th className="crm-th crm-th--right">Giá trị</th>
                      <th className="crm-th">Cập nhật</th>
                      <th className="crm-th crm-th--right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="crm-empty-cell">Đang tải...</td></tr>
                    ) : data?.deals?.length ? (
                      data.deals.map(deal => {
                        const primaryContactName = deal.primary_contact_id
                          ? allContacts.find(c => c.id === deal.primary_contact_id)?.name || 'Liên hệ ẩn'
                          : 'Chưa có';
                        return (
                          <tr
                            key={deal.id}
                            className="crm-row"
                            style={{ cursor: 'pointer' }}
                            onClick={() => openDealWorkspace(deal.id)}
                            title="Mở Deal Workspace"
                          >
                            <td className="crm-td"><strong>{deal.customer_name || deal.id}</strong></td>
                            <td className="crm-td crm-muted">{primaryContactName}</td>
                            <td className="crm-td crm-muted">{projectLabel(deal.project_id)}</td>
                            <td className="crm-td">
                              {(() => {
                                const meta = getStageMeta((deal.deal_stage as DealStage) || 'new_lead');
                                return (
                                  <span className={`crm-stage-badge ${meta.badgeClass}`}>{meta.label}</span>
                                );
                              })()}
                            </td>
                            <td className="crm-td crm-td--right crm-budget">{formatVND(Number(deal.estimated_budget || deal.lifetime_value || 0)) || '0 đ'}</td>
                            <td className="crm-td crm-muted crm-time-cell">
                              {relativeTime(deal.updated_at || deal.created_at || undefined)}
                            </td>
                            <td className="crm-td crm-td--right">
                              <ContactAssignCell
                                dealId={deal.id}
                                currentContactId={deal.primary_contact_id}
                                contacts={allContacts}
                                onAssigned={() => setReloadTick(t => t + 1)}
                              />
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr><td colSpan={7} className="crm-empty-cell">Chưa có cơ hội nào.</td></tr>
                    )}
                  </tbody>
                </table>
                </>
                ) : null}

                {tab === 'quotes' ? (
                <div className="p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-primary" />
                      <span className="font-semibold text-sm text-foreground">Danh sách Báo giá & Phiên bản</span>
                      <Badge variant="secondary" className="text-xs font-bold px-2 py-0.5">
                        {allQuoteChains.length}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      className="gap-1.5 shadow-xs"
                      onClick={() => setQuoteWorkspace({ quoteId: null, deal: null })}
                    >
                      <Plus className="size-3.5" />
                      <span>Tạo báo giá</span>
                    </Button>
                      + Tạo báo giá
                    </button>
                    <button
                      type="button"
                      className="crm-secondary-button"
                      disabled={quickQuoteLoading}
                      onClick={() => void openQuickQuoteForCustomer()}
                    >
                      {quickQuoteLoading ? 'Đang tải...' : 'Báo giá nhanh'}
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-muted/40 border border-border/70 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground font-medium">{quoteStatusFilterSummary}</span>
                    <div className="flex items-center gap-2">
                      <select
                        className="h-8 px-2.5 rounded-lg border border-border/80 bg-background text-xs text-foreground focus:ring-1 focus:ring-primary outline-hidden"
                        value={quoteStatusFilter}
                        aria-label="Lọc trạng thái báo giá"
                        onChange={event => setQuoteStatusFilter(event.target.value as QuoteStatusFilter)}
                      >
                        {(['active', 'presale', 'pricing', 'review', 'ready', 'sent', 'cancelled', 'all'] as QuoteStatusFilter[]).map(option => (
                          <option key={option} value={option}>{QUOTE_STATUS_FILTER_LABELS[option]}</option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-medium"
                        onClick={() => setQuoteStatusFilter(prev => (prev === 'active' ? 'all' : 'active'))}
                        title={quoteStatusFilter === 'active' ? 'Hiện cả các báo giá đã huỷ' : 'Ẩn các báo giá đã huỷ'}
                      >
                        {quoteStatusFilter === 'active' ? 'Hiện cả đã huỷ' : 'Ẩn đã huỷ'}
                      </Button>
                    </div>
                  </div>

                  {quoteProjectFilter ? (
                  <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-between gap-2 text-xs">
                    <span>Đang lọc theo dự án: <b>{projectLabel(quoteProjectFilter)}</b></span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-primary hover:bg-primary/20 px-2"
                      onClick={() => setQuoteProjectFilter(null)}
                    >
                      Bỏ lọc — xem tất cả báo giá
                    </Button>
                  </div>
                ) : null}

                <div className="rounded-xl border border-border/70 overflow-hidden">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th className="crm-th">Báo giá / Version</th>
                        <th className="crm-th">Dự án</th>
                        <th className="crm-th">Cơ hội</th>
                        <th className="crm-th">Liên hệ chính</th>
                        <th className="crm-th">Phase</th>
                        <th className="crm-th">Presale → Sale</th>
                        <th className="crm-th crm-th--right">Giá khách</th>
                        <th className="crm-th crm-th--right">Margin</th>
                        <th className="crm-th">SLA</th>
                        <th className="crm-th crm-th--right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={10} className="crm-empty-cell">Đang tải...</td></tr>
                      ) : quoteChains.length ? (
                        quoteChains.map(({ current, versionCount }) => {
                          const relatedDeal = data?.deals?.find(d => d.id === current.deal_id);
                          const quotePrimaryContactName = relatedDeal?.primary_contact_id
                            ? allContacts.find(c => c.id === relatedDeal.primary_contact_id)?.name || 'Liên hệ ẩn'
                            : 'Chưa có';
                          const expanded = expandedQuoteVersions[current.id];
                          return (
                            <Fragment key={current.version_chain_id || current.id}>
                              <tr
                                className="crm-row hover:bg-muted/30 transition-colors"
                                style={{ cursor: 'pointer' }}
                                onClick={() => void viewQuoteInNewWorkspace(current)}
                                title="Mở báo giá"
                              >
                                <td className="crm-td">
                                  {versionCount > 1 ? (
                                    <button
                                      type="button"
                                      className="crm-version-toggle"
                                      aria-expanded={Boolean(expanded)}
                                      title={expanded ? 'Thu gọn phiên bản cũ' : `Mở rộng ${versionCount - 1} phiên bản cũ`}
                                      onClick={event => { event.stopPropagation(); void toggleExpandQuoteVersions(current); }}
                                    >
                                      {expanded ? <ChevronUp className="crm-inline-icon" /> : <ChevronDown className="crm-inline-icon" />}
                                    </button>
                                  ) : null}
                                  {current.quote_number || current.id}
                                  <div className="crm-row-sub">V{current.version_number || 1} · {versionCount} version</div>
                                </td>
                                <td className="crm-td crm-muted">{projectLabel(current.project_id)}</td>
                                <td className="crm-td crm-muted">{relatedDeal?.customer_name || (current.deal_id ? 'Đang tải…' : 'Chưa gắn cơ hội')}</td>
                                <td className="crm-td crm-muted">{quotePrimaryContactName}</td>
                                <td className="crm-td"><span className="crm-source-badge">{quoteChainPhaseLabel(current)}</span></td>
                                <td className="crm-td crm-muted">
                                  {current.technical_owner_id ? memberName(current.technical_owner_id) : relatedDeal?.leader_name || 'Chưa gán'}
                                  {' → '}
                                  {current.quote_owner_id ? memberName(current.quote_owner_id) : relatedDeal?.sdr_name || 'Chưa gán'}
                                </td>
                                <td className="crm-td crm-td--right font-semibold text-emerald-600 dark:text-emerald-400">{formatVND(Number(current.total_amount || 0)) || '0 đ'}</td>
                                <td className="crm-td crm-td--right crm-muted" title="Chưa có dữ liệu giá vốn ở tab này">—</td>
                                <td className="crm-td crm-muted">{current.sla_due_at ? relativeTime(current.sla_due_at) : 'Chưa đặt SLA'}</td>
                                <td className="crm-td crm-td--right" onClick={event => event.stopPropagation()}>
                                  <div className="crm-row-actions">
                                    <ActionMenu
                                      items={[
                                        ...(current.deal_id
                                          ? [{
                                            key: 'contact',
                                            label: relatedDeal?.primary_contact_id ? 'Đổi liên hệ' : '+ Liên hệ chính',
                                            icon: UserCog,
                                            group: 1,
                                            onSelect: () => openContactAssignModal(current.deal_id!, current.quote_number || current.id, relatedDeal?.primary_contact_id),
                                          } satisfies ActionMenuItem]
                                          : []),
                                        {
                                          key: 'delete',
                                          label: quoteDeleteBusy === current.id ? 'Đang xoá...' : 'Xóa',
                                          icon: Trash2,
                                          group: 2,
                                          danger: true,
                                          disabled: quoteDeleteBusy === current.id,
                                          onSelect: () => void deleteQuoteChainOnCustomerPage(current, versionCount),
                                        },
                                      ] satisfies ActionMenuItem[]}
                                    />
                                  </div>
                                </td>
                              </tr>
                              {expanded ? (
                                expanded.loading || expanded.error || expanded.versions.length === 0 ? (
                                  <tr className="crm-row crm-row--version-old">
                                    <td colSpan={10} className="crm-empty-cell">
                                      {expanded.loading ? 'Đang tải phiên bản cũ…' : expanded.error || 'Không có phiên bản cũ nào khác.'}
                                    </td>
                                  </tr>
                                ) : (
                                  expanded.versions.map(version => {
                                    const versionDeal = version.dealId ? data?.deals?.find(d => d.id === version.dealId) : null;
                                    const versionContactName = versionDeal?.primary_contact_id
                                      ? allContacts.find(c => c.id === versionDeal.primary_contact_id)?.name || 'Liên hệ ẩn'
                                      : 'Chưa có';
                                    return (
                                      <tr
                                        key={version.id}
                                        className="crm-row crm-row--version-old hover:bg-muted/30 transition-colors"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => void viewQuoteInNewWorkspace({ ...current, id: version.id })}
                                        title="Mở báo giá"
                                      >
                                        <td className="crm-td">
                                          ↳ {version.quoteNumber}
                                          <div className="crm-row-sub">V{version.versionNumber || 1} · cập nhật {relativeTime(version.updatedAt || version.createdAt)}</div>
                                        </td>
                                        <td className="crm-td crm-muted">{projectLabel(version.projectId)}</td>
                                        <td className="crm-td crm-muted">{versionDeal?.customer_name || (version.dealId ? 'Đang tải…' : 'Chưa gắn cơ hội')}</td>
                                        <td className="crm-td crm-muted">{versionContactName}</td>
                                        <td className="crm-td"><span className="crm-source-badge">{quoteVersionStatusLabel(version)}</span></td>
                                        <td className="crm-td crm-muted">
                                          {version.technicalOwnerId ? memberName(version.technicalOwnerId) : versionDeal?.leader_name || 'Chưa gán'}
                                          {' → '}
                                          {version.quoteOwnerId ? memberName(version.quoteOwnerId) : versionDeal?.sdr_name || 'Chưa gán'}
                                        </td>
                                        <td className="crm-td crm-td--right font-semibold text-emerald-600 dark:text-emerald-400">{formatVND(Number(version.customerPriceBeforeVat ?? version.totalAmount ?? 0)) || '0 đ'}</td>
                                        <td className="crm-td crm-td--right crm-muted" title="Chưa có dữ liệu giá vốn ở tab này">—</td>
                                        <td className="crm-td crm-muted">{version.slaDueAt ? relativeTime(version.slaDueAt) : 'Chưa đặt SLA'}</td>
                                        <td className="crm-td crm-td--right" onClick={event => event.stopPropagation()}>
                                          <div className="crm-row-actions">
                                            <button
                                              type="button"
                                              className="crm-row-action-primary crm-row-action-icon crm-row-action-danger"
                                              title="Xóa"
                                              onClick={() => void deleteQuoteVersionOnCustomerPage(version)}
                                            >
                                              <Trash2 className="crm-button-icon" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })
                                )
                              ) : null}
                            </Fragment>
                          );
                        })
                      ) : (
                        <tr><td colSpan={10} className="crm-empty-cell">{quoteProjectFilter ? 'Dự án này chưa có báo giá nào.' : 'Chưa có báo giá liên quan.'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th className="crm-th">Báo giá / Version</th>
                    <th className="crm-th">Dự án</th>
                    <th className="crm-th">Cơ hội</th>
                    <th className="crm-th">Liên hệ chính</th>
                    <th className="crm-th">Phase</th>
                    <th className="crm-th">Presale → Sale</th>
                    <th className="crm-th crm-th--right">Giá khách</th>
                    <th className="crm-th crm-th--right">Margin</th>
                    <th className="crm-th">SLA</th>
                    <th className="crm-th crm-th--right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} className="crm-empty-cell">Đang tải...</td></tr>
                  ) : quoteChains.length ? (
                    quoteChains.map(({ current, versionCount }) => {
                      const relatedDeal = data?.deals?.find(d => d.id === current.deal_id);
                      const quotePrimaryContactName = relatedDeal?.primary_contact_id
                        ? allContacts.find(c => c.id === relatedDeal.primary_contact_id)?.name || 'Liên hệ ẩn'
                        : 'Chưa có';
                      const expanded = expandedQuoteVersions[current.id];
                      return (
                        <Fragment key={current.version_chain_id || current.id}>
                          <tr
                            className="crm-row"
                            style={{ cursor: 'pointer' }}
                            onClick={() => void viewQuoteInNewWorkspace(current)}
                            title="Mở báo giá"
                          >
                            <td className="crm-td">
                              {versionCount > 1 ? (
                                <button
                                  type="button"
                                  className="crm-version-toggle"
                                  aria-expanded={Boolean(expanded)}
                                  title={expanded ? 'Thu gọn phiên bản cũ' : `Mở rộng ${versionCount - 1} phiên bản cũ`}
                                  onClick={event => { event.stopPropagation(); void toggleExpandQuoteVersions(current); }}
                                >
                                  {expanded ? <ChevronUp className="crm-inline-icon" /> : <ChevronDown className="crm-inline-icon" />}
                                </button>
                              ) : null}
                              {current.quote_number || current.id}
                              <div className="crm-row-sub">V{current.version_number || 1} · {versionCount} version</div>
                            </td>
                            <td className="crm-td crm-muted">{projectLabel(current.project_id)}</td>
                            <td className="crm-td crm-muted">{relatedDeal?.customer_name || (current.deal_id ? 'Đang tải…' : 'Chưa gắn cơ hội')}</td>
                            <td className="crm-td crm-muted">{quotePrimaryContactName}</td>
                            <td className="crm-td"><span className={quotePhaseBadgeClass(quoteChainPhaseKey(current))}>{quoteChainPhaseLabel(current)}</span></td>
                            <td className="crm-td crm-muted">
                              {current.technical_owner_id ? memberName(current.technical_owner_id) : relatedDeal?.leader_name || 'Chưa gán'}
                              {' → '}
                              {current.quote_owner_id ? memberName(current.quote_owner_id) : relatedDeal?.sdr_name || 'Chưa gán'}
                            </td>
                            <td className="crm-td crm-td--right crm-budget">{formatVND(Number(current.total_amount || 0)) || '0 đ'}</td>
                            <td className="crm-td crm-td--right crm-muted" title="Chưa có dữ liệu giá vốn ở tab này">—</td>
                            <td className="crm-td crm-muted">{current.sla_due_at ? relativeTime(current.sla_due_at) : 'Chưa đặt SLA'}</td>
                            <td className="crm-td crm-td--right" onClick={event => event.stopPropagation()}>
                              {/* BUG THAT DA GAP: nhoi 4 nut thang vao o "Thao
                                 * tac" (table-layout:fixed, cot hep) khien Xem/Sua
                                 * tran ra ngoai va bi .crm-table-card{overflow:hidden}
                                 * cat mat, chi con thay Xoa/Doi lien he - dung
                                 * ActionMenu (Portal, khong bi cat) nhu moi bang
                                 * khac trong CRM thay vi nut roi. */}
                              <div className="crm-row-actions">
                                <ActionMenu
                                  items={[
                                    // "Sửa" bi bo khoi menu nay (feedback 2026-09-25,
                                    // sau khi them click-ca-dong mo thang
                                    // viewQuoteInNewWorkspace - xem onClick cua <tr>
                                    // ben tren) - giu lai trong menu se trung lap 100%
                                    // hanh vi voi click dong.
                                    // Feedback (2026-09-24): gop "Đổi liên hệ" VAO
                                    // menu "⋯" thay vi 1 nut/select rieng nam canh
                                    // no (ContactAssignCell cu, van con dung o tab
                                    // Co hoi/Hop dong) - chi hien khi quote da co
                                    // deal_id (giong dieu kien "return — " cu cua
                                    // ContactAssignCell khi chua co deal).
                                    ...(current.deal_id
                                      ? [{
                                        key: 'contact',
                                        label: relatedDeal?.primary_contact_id ? 'Đổi liên hệ' : '+ Liên hệ chính',
                                        icon: UserCog,
                                        group: 1,
                                        onSelect: () => openContactAssignModal(current.deal_id!, current.quote_number || current.id, relatedDeal?.primary_contact_id),
                                      } satisfies ActionMenuItem]
                                      : []),
                                    {
                                      key: 'delete',
                                      label: quoteDeleteBusy === current.id ? 'Đang xoá...' : 'Xóa',
                                      icon: Trash2,
                                      group: 2,
                                      danger: true,
                                      disabled: quoteDeleteBusy === current.id,
                                      onSelect: () => void deleteQuoteChainOnCustomerPage(current, versionCount),
                                    },
                                  ] satisfies ActionMenuItem[]}
                                />
                              </div>
                            </td>
                          </tr>
                          {expanded ? (
                            expanded.loading || expanded.error || expanded.versions.length === 0 ? (
                              <tr className="crm-row crm-row--version-old">
                                <td colSpan={10} className="crm-empty-cell">
                                  {expanded.loading ? 'Đang tải phiên bản cũ…' : expanded.error || 'Không có phiên bản cũ nào khác.'}
                                </td>
                              </tr>
                            ) : (
                              expanded.versions.map(version => {
                                // Feedback (2026-09-24): phien ban cu phai hien DU thong
                                // tin nhu phien ban hien tai (Du an/Co hoi/Lien he/Phase/
                                // Presale->Sale/Gia khach/SLA), khong chi trong trong -
                                // deal cua version co the khac deal cua `current` (hiem
                                // nhung co the xay ra), nen tra rieng theo version.dealId
                                // thay vi dung lai relatedDeal cua dong hien tai.
                                const versionDeal = version.dealId ? data?.deals?.find(d => d.id === version.dealId) : null;
                                const versionContactName = versionDeal?.primary_contact_id
                                  ? allContacts.find(c => c.id === versionDeal.primary_contact_id)?.name || 'Liên hệ ẩn'
                                  : 'Chưa có';
                                return (
                                  <tr
                                    key={version.id}
                                    className="crm-row crm-row--version-old"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => void viewQuoteInNewWorkspace({ ...current, id: version.id })}
                                    title="Mở báo giá"
                                  >
                                    <td className="crm-td">
                                      ↳ {version.quoteNumber}
                                      <div className="crm-row-sub">V{version.versionNumber || 1} · cập nhật {relativeTime(version.updatedAt || version.createdAt)}</div>
                                    </td>
                                    <td className="crm-td crm-muted">{projectLabel(version.projectId)}</td>
                                    <td className="crm-td crm-muted">{versionDeal?.customer_name || (version.dealId ? 'Đang tải…' : 'Chưa gắn cơ hội')}</td>
                                    <td className="crm-td crm-muted">{versionContactName}</td>
                                    {/* Version cu luon xam (feedback "các version cũ thì
                                       * set màu xám như vậy") - khong tinh lai tone that vi
                                       * day la ban ghi lich su, khong phai trang thai dang
                                       * xu ly. */}
                                    <td className="crm-td"><span className="qc-badge qc-badge-neutral">{quoteVersionStatusLabel(version)}</span></td>
                                    <td className="crm-td crm-muted">
                                      {version.technicalOwnerId ? memberName(version.technicalOwnerId) : versionDeal?.leader_name || 'Chưa gán'}
                                      {' → '}
                                      {version.quoteOwnerId ? memberName(version.quoteOwnerId) : versionDeal?.sdr_name || 'Chưa gán'}
                                    </td>
                                    <td className="crm-td crm-td--right crm-budget">{formatVND(Number(version.customerPriceBeforeVat ?? version.totalAmount ?? 0)) || '0 đ'}</td>
                                    <td className="crm-td crm-td--right crm-muted" title="Chưa có dữ liệu giá vốn ở tab này">—</td>
                                    <td className="crm-td crm-muted">{version.slaDueAt ? relativeTime(version.slaDueAt) : 'Chưa đặt SLA'}</td>
                                    <td className="crm-td crm-td--right" onClick={event => event.stopPropagation()}>
                                      {/* "Mở" bi bo (feedback 2026-09-25, trung lap voi
                                         * click ca dong) - chi con dung 1 hanh dong "Xóa"
                                         * nen hien thang nut icon thay vi dropdown ⋯ chi
                                         * de chon 1 lua chon duy nhat. */}
                                      <div className="crm-row-actions">
                                        <button
                                          type="button"
                                          className="crm-row-action-primary crm-row-action-icon crm-row-action-danger"
                                          title="Xóa"
                                          onClick={() => void deleteQuoteVersionOnCustomerPage(version)}
                                        >
                                          <Trash2 className="crm-button-icon" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )
                          ) : null}
                        </Fragment>
                      );
                    })
                  ) : (
                    <tr><td colSpan={10} className="crm-empty-cell">{quoteProjectFilter ? 'Dự án này chưa có báo giá nào.' : 'Chưa có báo giá liên quan.'}</td></tr>
                  )}
                </tbody>
              </table>
            </>
          ) : null}

          {tab === 'contracts' ? (
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileCheck className="size-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">Danh sách Hợp đồng</span>
                  <Badge variant="secondary" className="text-xs font-bold px-2 py-0.5">
                    {data?.contracts?.length || 0}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 shadow-xs"
                  disabled={registerContractLoading}
                  onClick={() => void openRegisterContractForActiveDeal()}
                >
                  <Plus className="size-3.5" />
                  <span>{registerContractLoading ? 'Đang tải...' : 'Ghi nhận hợp đồng có sẵn'}</span>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/50">
                Hợp đồng có thể tạo trực tiếp trong CRM hoặc ghi nhận từ hợp đồng đã ký bên ngoài — đồng bộ cùng danh sách với tab Hợp đồng trong Deal Workspace.
              </p>

              <div className="rounded-xl border border-border/70 overflow-hidden">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th className="crm-th">Hợp đồng</th>
                      <th className="crm-th">Nguồn</th>
                      <th className="crm-th">Trạng thái</th>
                      <th className="crm-th">Liên hệ chính</th>
                      <th className="crm-th crm-th--right">Giá trị</th>
                      <th className="crm-th">Ngày ký</th>
                      <th className="crm-th crm-th--right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="crm-empty-cell">Đang tải...</td></tr>
                    ) : data?.contracts?.length ? (
                      data.contracts.map(contract => {
                        const contractDeal = data?.deals?.find(d => d.id === contract.deal_id);
                        const contractPrimaryContactName = contractDeal?.primary_contact_id
                          ? allContacts.find(c => c.id === contractDeal.primary_contact_id)?.name || 'Liên hệ ẩn'
                          : 'Chưa có';
                        return (
                          <tr key={contract.id} className="crm-row hover:bg-muted/30 transition-colors">
                            <td className="crm-td">
                              <strong>{contract.title || contract.contract_number || contract.id}</strong>
                              {contract.contract_number ? <div className="crm-row-sub">{contract.contract_number}</div> : null}
                            </td>
                            <td className="crm-td">{contractSourceBadge(contract.source)}</td>
                            <td className="crm-td">
                              <Badge
                                variant="outline"
                                className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px] font-semibold"
                              >
                                {contractStatusLabel(contract.status || '')}
                              </Badge>
                            </td>
                            <td className="crm-td crm-muted">{contractPrimaryContactName}</td>
                            <td className="crm-td crm-td--right font-semibold text-emerald-600 dark:text-emerald-400">{formatVND(Number(contract.contract_value || 0)) || '0 đ'}</td>
                            <td className="crm-td crm-muted crm-time-cell">{contract.signed_at ? formatContractDate(contract.signed_at) : '—'}</td>
                            <td className="crm-td crm-td--right">
                              <div className="crm-row-actions">
                                <Link className="crm-row-action" href={`/all-platform/contracts/${contract.id}`}>Xem</Link>
                                {contract.file_url ? (
                                  <a className="crm-row-action" href={contract.file_url} target="_blank" rel="noreferrer">
                                    {contract.source === 'external' ? 'File/link' : 'File'}
                                  </a>
                                ) : null}
                                <ContactAssignCell
                                  dealId={contract.deal_id}
                                  currentContactId={contractDeal?.primary_contact_id}
                                  contacts={allContacts}
                                  onAssigned={() => setReloadTick(t => t + 1)}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr><td colSpan={7} className="crm-empty-cell">Chưa có hợp đồng nào được ghi nhận trong CRM.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
          )}
    </section>
      </section >

    <CustomerFormModal
      open={editOpen}
      customer={customerRow}
      currentUser={user}
      onClose={() => setEditOpen(false)}
      onSaved={() => { setEditOpen(false); setReloadTick(t => t + 1); }}
    />
  {
    contactAssignTarget ? (
      <div className="crm-modal-backdrop" onClick={() => !contactAssignSaving && setContactAssignTarget(null)}>
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
    ) : null
  }
  {
    registerContractDeal ? (
      <RegisterExternalContractModal
        open={registerContractOpen}
        deal={registerContractDeal}
        customerLabel={customer?.customer_name || customer?.company_name || undefined}
        dealOptions={data?.deals}
        contactOptions={allContacts}
        projectOptions={projectsSummary?.projects}
        quoteOptions={allQuoteChains.map(c => ({
          id: c.current.id,
          label: c.current.quote_number || c.current.id,
          dealId: c.current.deal_id,
        }))}
        onClose={() => setRegisterContractOpen(false)}
        onCreated={() => { setRegisterContractOpen(false); setReloadTick(t => t + 1); }}
      />
    ) : null
  }
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
  {
    dealModal.open && customer ? (
      <DealFormModal
        open={dealModal.open}
        onClose={() => setDealModal({ open: false, project: null, contactId: null })}
        onCreate={input => void handleCreateDeal(input)}
        onUpdate={() => { }}
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
    ) : null
  }
  {
    quoteWorkspace ? (
      <QuoteWorkspaceModal
        quoteId={quoteWorkspace.quoteId}
        deals={quoteWorkspace.deal ? [quoteWorkspace.deal] : []}
        dealsById={new Map(quoteWorkspace.deal ? [[quoteWorkspace.deal.id, quoteWorkspace.deal]] : [])}
        agents={[]}
        user={user}
        initialCustomerId={customerId}
        initialProjectId={quoteWorkspace.initialProjectId}
        lockCustomer={quoteWorkspace.quoteId === null}
        lockProject={quoteWorkspace.lockProject}
        onClose={() => setQuoteWorkspace(null)}
        onChanged={() => setReloadTick(t => t + 1)}
        onEditDraft={editQuote => setQuoteWorkspace({ quoteId: editQuote.id, deal: quoteWorkspace.deal })}
      />
    ) : null
  }
  {
    quickQuoteDeal ? (
      <CreateQuoteModal
        open
        deals={[quickQuoteDeal]}
        initialDeal={quickQuoteDeal}
        onClose={() => setQuickQuoteDeal(null)}
        onCreated={() => { setQuickQuoteDeal(null); setReloadTick(t => t + 1); }}
        onUpdated={() => { setQuickQuoteDeal(null); setReloadTick(t => t + 1); }}
      />
    ) : null
  }

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
  {
    dealTransitionTarget && (
      <StageTransitionModal
        customer={dealTransitionTarget.customer}
        toStage={dealTransitionTarget.toStage}
        isOpen={!!dealTransitionTarget}
        onClose={() => setDealTransitionTarget(null)}
        onSubmit={submitDealTransition}
      />
    )
  }
      <CrmCustomerModal
        isOpen={!!editingDealRow}
        customer={editingDealRow}
        onClose={() => setEditingDealRow(null)}
        onSuccess={updated => {
          setEditingDealRow(null);
          setOpenDeal(updated);
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
    </div >
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
