'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { formatVND, getStageMeta, SOURCE_OPTIONS, SERVICE_PACKAGE_OPTIONS, CRM_PACKAGE_OPTIONS, INDUSTRY_OPTIONS } from '../constants/crmConfig';
import type { CreateDealInput, CrmUserOption, DealStage } from '../types';
import { CustomerFormModal } from './CustomerFormModal';
import { CrmContactsPanel } from './CrmContactsPanel';
import { ProjectFormModal } from './ProjectFormModal';
import { DealFormModal, clearDealDraft } from './DealFormModal';
import { mergeCategoryOptions } from '../hooks/useCrm';
import { Loader2, Plus, Pencil, Trash2 } from './icons';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import type { CrmCustomerRow } from '../types';
import { customerProjectsSummaryService, allPlatformCategoriesService, projectsService, type CustomerProjectsSummary, type Project } from '@/services/all-platform.service';
import { formatMoney, relativeTime } from '../utils/quoteDisplay';
import { useMembers } from '@/hooks/useMembers';
import { QuoteWorkspaceModal } from './QuoteWorkspaceModal';
import { CreateQuoteModal } from '../integrations/quotes/CreateQuoteModal';
import { seedingQuoteRepository } from '@/modules/quotes';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { Deal } from '../types';
import { DealDetailDrawer } from '@/components/all-platform/customers/DealDetailDrawer';
import { ContactDetailDrawer } from '@/components/all-platform/customers/ContactDetailDrawer';
import { StageTransitionModal } from '@/components/all-platform/customers/StageTransitionModal';
import { CrmCustomerModal } from '@/components/all-platform/components/CrmCustomerModal';
import { customerLeadService, type Customer as LiveDealRow, type DealStage as LiveDealStage } from '@/services/customer-lead.service';
import { ManualContractModal } from '@/modules/contracts/components/ManualContractModal';
import { RegisterExternalContractModal } from '@/components/all-platform/customers/RegisterExternalContractModal';
import { contractStatusLabel } from '@/modules/contracts/constants/contractConfig';
import { cascadeSummaryFromBody, cascadeWarningText } from '../utils/cascadeDelete';

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
  const [manualContractOpen, setManualContractOpen] = useState(false);
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
      .catch(() => {});
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
          <div className="crm-header-actions">
            {canEdit ? (
              <button type="button" className="crm-secondary-button" onClick={() => setEditOpen(true)}>
                Sửa khách hàng
              </button>
            ) : null}
            {canManageProject ? (
              <button type="button" className="crm-secondary-button" onClick={() => setProjectModal({ open: true, project: null })}>
                + Tạo dự án
              </button>
            ) : null}
            <button type="button" className="crm-secondary-button" onClick={() => setDealModal({ open: true, project: null, contactId: null })}>
              + Tạo cơ hội
            </button>
            {/* "Luồng từ Khách hàng → Báo giá" (feedback): truoc day la <Link>
             * dieu huong sang /all-platform/quote-center, roi khoi han trang
             * chi tiet khach hang. Gio mo THANG QuoteWorkspaceModal ngay tai
             * day (giong "Tạo yêu cầu báo giá" tren Project card), tu chuyen
             * sang tab "Báo giá" truoc - tao xong VAN o lai đúng tab nay, vi
             * modal chi la 1 overlay tren cung trang, khong navigate di dau. */}
            <button
              type="button"
              className="crm-primary-button"
              onClick={() => {
                setTab('quotes');
                setQuoteWorkspace({ quoteId: null, deal: null });
              }}
            >
              + Tạo báo giá
            </button>
          </div>
        </div>

        <section className="crm-content-section">
          {/* [CHỨC NĂNG: Thanh menu điều hướng tab hồ sơ khách hàng]
              - Gồm 7 tab: Tổng quan, Hoạt động, Người liên hệ, Dự án, Cơ hội, Báo giá, Hợp đồng.
              - Đã cấu hình class .crm-customer-tabs (flex: 1) để kéo giãn đều 100% toàn chiều rộng,
                ngang hàng cân xứng với bảng bên dưới mà không ảnh hưởng tới menu con. */}
          <div className="crm-segment crm-customer-tabs">
            <button type="button" className={`crm-segment-button ${tab === 'overview' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('overview')}>
              Tổng quan
            </button>
            <button type="button" className={`crm-segment-button ${tab === 'activity' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('activity')}>
              Hoạt động
            </button>
            <button type="button" className={`crm-segment-button ${tab === 'contacts' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('contacts')}>
              Người liên hệ ({contactCountOverride ?? customer?.contact_count ?? 0})
            </button>
            <button type="button" className={`crm-segment-button ${tab === 'projects' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('projects')}>
              Dự án ({projectsSummary?.projectCount || 0})
            </button>
            <button type="button" className={`crm-segment-button ${tab === 'deals' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('deals')}>
              Cơ hội ({data?.deals?.length || 0})
            </button>
            <button
              type="button"
              className={`crm-segment-button ${tab === 'quotes' ? 'crm-segment-button--active' : ''}`}
              onClick={() => { setTab('quotes'); setQuoteProjectFilter(null); }}
            >
              Báo giá ({allQuoteChains.length})
            </button>
            <button type="button" className={`crm-segment-button ${tab === 'contracts' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('contracts')}>
              Hợp đồng ({data?.contracts?.length || 0})
            </button>
          </div>

          {tab === 'overview' && (
            <>
              <div className="crm-stat-grid">
                <div className="crm-stat-card"><p className="crm-stat-label">Dự án</p><p className="crm-stat-value">{projectsSummary?.projectCount || 0}</p></div>
                <div className="crm-stat-card"><p className="crm-stat-label">Quote Cases</p><p className="crm-stat-value">{projectsSummary?.quoteCaseCount ?? data?.kpi?.quote_count ?? 0}</p></div>
                <div className="crm-stat-card"><p className="crm-stat-label">Hợp đồng</p><p className="crm-stat-value">{data?.kpi?.contract_count || 0}</p></div>
                <div className="crm-stat-card"><p className="crm-stat-label">Giá đang quote</p><p className="crm-stat-value">{formatVND(projectsSummary?.currentQuoteValue || 0) || '0 đ'}</p></div>
              </div>

              {activeDeal ? (
                <section className="crm-detail-info-grid">
                  <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500" style={{ gridColumn: '1 / -1' }}>
                    Cơ hội đang xử lý
                  </h4>
                  <InfoItem label="Deal" value={activeDeal.customer_name || activeDeal.id} />
                  <InfoItem label="Dự án" value={projectLabel(activeDeal.project_id)} />
                  <InfoItem label="Giai đoạn" value={getStageMeta((activeDeal.deal_stage as DealStage) || 'new_lead').label} />
                  <InfoItem label="Giá trị" value={formatVND(Number(activeDeal.estimated_budget || activeDeal.lifetime_value || 0)) || '0 đ'} />
                  <button type="button" className="crm-secondary-button" onClick={() => openDealWorkspace(activeDeal.id)}>
                    Mở Deal Workspace
                  </button>
                </section>
              ) : null}

              {customer ? (
                <section className="crm-detail-info-grid">
                  {customer.owner_id ? <InfoItem label="Người phụ trách" value={memberName(customer.owner_id)} /> : null}
                  {customer.position ? <InfoItem label="Chức vụ" value={customer.position} /> : null}
                  {customer.address ? <InfoItem label="Địa chỉ" value={customer.address} /> : null}
                  {customer.city ? <InfoItem label="Thành phố" value={customer.city} /> : null}
                  {customer.industry ? <InfoItem label="Lĩnh vực" value={customer.industry} /> : null}
                  {customer.source ? <InfoItem label="Nguồn" value={customer.source} /> : null}
                  {customer.zalo ? <InfoItem label="Zalo" value={customer.zalo} /> : null}
                  {customer.facebook ? <InfoItem label="Facebook" value={customer.facebook} /> : null}
                  {customer.telegram ? <InfoItem label="Telegram" value={customer.telegram} /> : null}
                  {customer.website ? <InfoItem label="Website" value={customer.website} /> : null}
                  {customer.tax_code ? <InfoItem label="Mã số thuế" value={customer.tax_code} /> : null}
                  {customer.note ? <InfoItem label="Ghi chú" value={customer.note} full /> : null}
                </section>
              ) : null}

            </>
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
            <section className="crm-contacts-panel crm-activity-panel">
              <div className="crm-contacts-panel-head">
                <div>
                  <p className="crm-section-title">Hoạt động ({activityItems.length})</p>
                  <p className="crm-small crm-muted" style={{ marginTop: '0.2rem' }}>
                    Hoạt động bán hàng — gộp từ các Cơ hội của khách hàng này.
                  </p>
                </div>
              </div>

              {activityError ? <p className="crm-error">{activityError}</p> : null}

              {activityLoading ? (
                <p className="crm-small"><Loader2 className="crm-spin-icon" /> Đang tải hoạt động...</p>
              ) : activityItems.length ? (
                <div className="crm-contacts-list crm-activity-list">
                  {activityItems.map(entry => {
                    const fromMeta = entry.from_stage ? getStageMeta(entry.from_stage as DealStage) : null;
                    const toMeta = entry.to_stage ? getStageMeta(entry.to_stage as DealStage) : null;

                    return (
                       <div key={entry.id} className="crm-contact-row crm-activity-row">
                        <div className="crm-activity-row-main">
                          <div className="crm-activity-row-header">
                            {entry.from_stage && entry.to_stage ? (
                              <span className="crm-activity-stage-flow">
                                <span
                                  className="crm-activity-stage-pill"
                                  style={{ borderColor: fromMeta?.color, color: fromMeta?.color }}
                                >
                                  {fromMeta?.label || entry.from_stage}
                                </span>
                                <span className="crm-activity-stage-arrow">→</span>
                                <span
                                  className="crm-activity-stage-pill"
                                  style={{ borderColor: toMeta?.color, color: toMeta?.color }}
                                >
                                  {toMeta?.label || entry.to_stage}
                                </span>
                              </span>
                            ) : (
                              <span className="crm-activity-action-name">{entry.action}</span>
                            )}
                            {entry.actor_name ? (
                              <span className="crm-activity-actor-badge">
                                {entry.actor_name}
                              </span>
                            ) : null}
                          </div>
                          {entry.note ? (
                            <p className="crm-activity-note">{entry.note}</p>
                          ) : null}
                        </div>
                        <div className="crm-activity-row-meta">
                          <span className="crm-small crm-muted">
                            {new Date(entry.created_at).toLocaleString('vi-VN')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="crm-small crm-muted">Chưa có hoạt động nào.</p>
              )}
            </section>
          )}

          {tab === 'projects' ? (
            <div className="crm-projects-tab">
              <div className="crm-projects-tab-head">
                <div>
                  <h3>Dự án của khách hàng</h3>
                  <p>Dự án là lớp quản lý giữa Khách hàng và Cơ hội/Báo giá.</p>
                </div>
                {canManageProject ? (
                  <button type="button" className="crm-primary-button" onClick={() => setProjectModal({ open: true, project: null })}>
                    <Plus className="crm-icon" /> Tạo dự án mới
                  </button>
                ) : null}
              </div>

              {projectsLoading ? (
                <div className="crm-loading"><Loader2 className="crm-spin-icon" /><span>Đang tải dự án...</span></div>
              ) : projectsError ? (
                <div className="crm-empty"><p>{projectsError}</p></div>
              ) : !projectsSummary || projectsSummary.projectCount === 0 ? (
                <div className="crm-empty">
                  <div>
                    <h3>Khách hàng này chưa có dự án nào.</h3>
                    {canManageProject ? (
                      <button type="button" className="crm-primary-button crm-empty-action" onClick={() => setProjectModal({ open: true, project: null })}>
                        Tạo dự án đầu tiên
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <div className="crm-stat-grid crm-projects-summary-grid">
                    <div className="crm-stat-card"><p className="crm-stat-label">Tổng dự án</p><p className="crm-stat-value">{projectsSummary.projectCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Đang hoạt động</p><p className="crm-stat-value">{projectsSummary.activeProjectCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Quote Cases</p><p className="crm-stat-value">{projectsSummary.quoteCaseCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Cơ hội CRM</p><p className="crm-stat-value">{projectsSummary.opportunityCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Giá trị quote hiện tại</p><p className="crm-stat-value">{formatMoney(projectsSummary.currentQuoteValue)}</p></div>
                  </div>

                  <div className="crm-projects-grid">
                    {projectsSummary.projects.map(project => (
                      <div key={project.id} className="crm-project-card">
                        <div className="crm-project-card-head">
                          <div>
                            <span className="crm-project-code">{project.projectCode}</span>
                            <h4>{project.name}</h4>
                          </div>
                          <span className={`crm-project-status crm-project-status--${project.status}`}>{PROJECT_STATUS_LABELS[project.status] || project.status}</span>
                        </div>
                        <div className="crm-project-card-meta">
                          <span>Owner: {memberName(project.managerId)}</span>
                          <span>{project.opportunityCount} cơ hội</span>
                          <span>{project.quoteCaseCount} Quote Case · {project.versionCount} version</span>
                          <span>{project.processingCount} đang xử lý</span>
                          <span>Giá quote hiện tại: {formatMoney(project.currentQuoteValue)}</span>
                        </div>
                        <div className="crm-project-card-actions">
                          <button
                            type="button"
                            className="crm-secondary-button"
                            onClick={() => { setQuoteProjectFilter(project.id); setTab('quotes'); }}
                          >
                            Xem báo giá
                          </button>
                          <button type="button" className="crm-secondary-button" onClick={() => openQuoteRequestForProject(project.id)}>
                            Tạo yêu cầu báo giá
                          </button>
                          <button
                            type="button"
                            className="crm-secondary-button"
                            disabled={quickQuoteLoading}
                            onClick={() => void openQuickQuoteForProject(project.id)}
                          >
                            {quickQuoteLoading ? 'Đang tải...' : 'Tạo báo giá nhanh'}
                          </button>
                          <button type="button" className="crm-secondary-button" onClick={() => setDealModal({ open: true, project, contactId: null })}>
                            Tạo cơ hội
                          </button>
                          {canManageProject ? (
                            <button type="button" className="crm-secondary-button" onClick={() => setProjectModal({ open: true, project })}>
                              Sửa dự án
                            </button>
                          ) : null}
                          {canManageProject && project.status !== 'cancelled' ? (
                            <button type="button" className="crm-secondary-button crm-danger-button" onClick={() => void cancelProject(project)}>
                              Hủy dự án
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === 'projects' || tab === 'overview' || tab === 'activity' ? null : (
          <div className="crm-table-card">
            <div className="crm-table-scroll">
              {tab === 'deals' ? (
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
              ) : null}

              {tab === 'quotes' ? (
                <>
                  <div className="crm-quote-filter-pill" style={{ justifyContent: 'space-between' }}>
                    <span className="crm-sr-only">
                      {quoteStatusFilter === 'active'
                        ? `Đang ẩn báo giá đã huỷ${hiddenCancelledQuoteCount ? ` (${hiddenCancelledQuoteCount})` : ''}`
                        : 'Đang hiển thị tất cả báo giá, gồm cả đã huỷ'}
                    </span>
                    <span>{quoteStatusFilterSummary}</span>
                    <div className="crm-quote-filter-controls">
                      <select
                        className="crm-quote-status-select"
                        value={quoteStatusFilter}
                        aria-label="Lọc trạng thái báo giá"
                        onChange={event => setQuoteStatusFilter(event.target.value as QuoteStatusFilter)}
                      >
                        {(['active', 'presale', 'pricing', 'review', 'ready', 'sent', 'cancelled', 'all'] as QuoteStatusFilter[]).map(option => (
                          <option key={option} value={option}>{QUOTE_STATUS_FILTER_LABELS[option]}</option>
                        ))}
                      </select>
                      {/* [FIX UI UX] Chuyển đổi từ text link đơn sơ sang Nút bấm cố định (Fixed Button):
                          1. Gom nút vào bên trong cụm controls bên phải (.crm-quote-filter-controls) để căn lề sát phải cùng dropdown.
                          2. Cố định kích thước (width: 8rem, min-width: 8rem) để khi bấm thay đổi văn bản giữa "Hiện cả đã huỷ"
                             và "Ẩn đã huỷ", vị trí nút và dropdown hoàn toàn cố định, không bị xê dịch hay nhảy vị trí. */}
                      <button
                        type="button"
                        className="crm-quote-toggle-cancelled-btn"
                        onClick={() => setQuoteStatusFilter(prev => (prev === 'active' ? 'all' : 'active'))}
                        title={quoteStatusFilter === 'active' ? 'Hiện cả các báo giá đã huỷ' : 'Ẩn các báo giá đã huỷ'}
                      >
                        {quoteStatusFilter === 'active' ? 'Hiện cả đã huỷ' : 'Ẩn đã huỷ'}
                      </button>
                    </div>
                  </div>
                  {quoteProjectFilter ? (
                    <div className="crm-quote-filter-pill">
                      <span>Đang lọc theo dự án: {projectLabel(quoteProjectFilter)}</span>
                      <button type="button" className="crm-inline-link-btn" onClick={() => setQuoteProjectFilter(null)}>
                        Bỏ lọc — xem tất cả báo giá
                      </button>
                    </div>
                  ) : null}
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
                          return (
                            <tr key={current.version_chain_id || current.id} className="crm-row">
                              <td className="crm-td">
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
                              <td className="crm-td crm-td--right crm-budget">{formatVND(Number(current.total_amount || 0)) || '0 đ'}</td>
                              <td className="crm-td crm-td--right crm-muted" title="Chưa có dữ liệu giá vốn ở tab này">—</td>
                              <td className="crm-td crm-muted">{current.sla_due_at ? relativeTime(current.sla_due_at) : 'Chưa đặt SLA'}</td>
                              <td className="crm-td crm-td--right">
                                {/* BUG THAT DA GAP: nhoi 4 nut thang vao o "Thao
                                 * tac" (table-layout:fixed, cot hep) khien Xem/Sua
                                 * tran ra ngoai va bi .crm-table-card{overflow:hidden}
                                 * cat mat, chi con thay Xoa/Doi lien he - dung
                                 * ActionMenu (Portal, khong bi cat) nhu moi bang
                                 * khac trong CRM thay vi nut roi. */}
                                <div className="crm-row-actions">
                                  <ActionMenu
                                    items={[
                                      // Feedback goc chi yeu cau "nut sua xoa" - gop
                                      // "Xem" vao chung "Sua" (modal tu quyet dinh
                                      // editable/read-only theo quyen), khong tach
                                      // rieng 2 nut trung hanh vi nhu truoc.
                                      { key: 'edit', label: 'Sửa', icon: Pencil, group: 1, onSelect: () => void viewQuoteInNewWorkspace(current) },
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
                                  <ContactAssignCell
                                    dealId={current.deal_id}
                                    currentContactId={relatedDeal?.primary_contact_id}
                                    contacts={allContacts}
                                    onAssigned={() => setReloadTick(t => t + 1)}
                                  />
                                </div>
                              </td>
                            </tr>
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
                <>
                  <div className="crm-quote-filter-pill" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span>Hợp đồng có thể tạo trực tiếp trong CRM hoặc ghi nhận từ hợp đồng đã ký bên ngoài — cùng 1 danh sách với tab Hợp đồng trong Deal Workspace.</span>
                    {/* [CHỨC NĂNG: Chuyển đổi thao tác hợp đồng từ Text Link sang Button]
                        - Mục đích: Nâng cao UX, làm cho 2 hành động tạo/ghi nhận hợp đồng nổi bật và dễ bấm hơn.
                        - Thay đổi: Thay link chữ mờ bằng Button thực thụ .crm-btn--blue (nền xanh dương #2563eb,
                          chữ trắng, bo góc 0.45rem, hover #1d4ed8), giữ nguyên logic mở modal. */}
                    <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                      <button type="button" className="crm-btn--blue" onClick={() => setManualContractOpen(true)}>
                        + Tạo hợp đồng
                      </button>
                      <button
                        type="button"
                        className="crm-btn--blue"
                        disabled={registerContractLoading}
                        onClick={() => void openRegisterContractForActiveDeal()}
                      >
                        {registerContractLoading ? 'Đang tải...' : '+ Ghi nhận hợp đồng có sẵn'}
                      </button>
                    </div>
                  </div>
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
                            <tr key={contract.id} className="crm-row">
                              <td className="crm-td">
                                <strong>{contract.title || contract.contract_number || contract.id}</strong>
                                {contract.contract_number ? <div className="crm-row-sub">{contract.contract_number}</div> : null}
                              </td>
                              <td className="crm-td">{contractSourceBadge(contract.source)}</td>
                              <td className="crm-td">
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  {contractStatusLabel(contract.status || '')}
                                </span>
                              </td>
                              <td className="crm-td crm-muted">{contractPrimaryContactName}</td>
                              <td className="crm-td crm-td--right crm-budget">{formatVND(Number(contract.contract_value || 0)) || '0 đ'}</td>
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
                </>
              ) : null}
            </div>
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
      <ManualContractModal
        open={manualContractOpen}
        onClose={() => setManualContractOpen(false)}
        onCreated={() => { setManualContractOpen(false); setReloadTick(t => t + 1); }}
        lockedCustomerId={customerId}
        lockedCustomerLabel={customer?.customer_name || customer?.company_name || 'Khách hàng hiện tại'}
      />
      {registerContractDeal ? (
        <RegisterExternalContractModal
          open={registerContractOpen}
          deal={registerContractDeal}
          customerLabel={customer?.customer_name || customer?.company_name || undefined}
          dealOptions={data?.deals}
          contactOptions={allContacts}
          projectOptions={projectsSummary?.projects}
          onClose={() => setRegisterContractOpen(false)}
          onCreated={() => { setRegisterContractOpen(false); setReloadTick(t => t + 1); }}
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
      {quoteWorkspace ? (
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
