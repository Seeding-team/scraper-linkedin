'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMembers } from '@/hooks/useMembers';
import { teamsService, projectsService, crmTeamsService, usersService, type TeamRow, type Project, type CrmTeam, type AppUserProfile } from '@/services/all-platform.service';
import { SearchableSelect, type SelectAction } from './SearchableSelect';
import { PositionSelect } from './PositionSelect';
import { CrmCategoryCodeSelect, CrmCategorySelect, useCrmCategoryLabels } from './CrmCategorySelect';
import { LeadDealQualificationPanel, formatEstimatedValue } from './LeadDealQualificationPanel';
import { CrmTeamFormModal } from './CrmTeamFormModal';
import { useLeadQualificationEngine } from '../hooks/useLeadQualificationEngine';
import { ICP_OPTIONS, type InterestLevel } from '../utils/leadQualificationRules';
import type { MemberProfile } from '@/types/unified.types';
import {
  CRM_PACKAGE_OPTIONS,
  DEAL_STAGE_META,
  DEAL_STAGES,
  INDUSTRY_OPTIONS,
  SERVICE_PACKAGE_OPTIONS,
  SOURCE_OPTIONS,
  parseMoney,
} from '../constants/crmConfig';
import type { CreateDealInput, CrmCustomerSummary, CrmUserOption, Deal, UpdateDealInput } from '../types';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { AppUser } from '@/types/unified.types';
import { CurrencyInput } from '@/components/CurrencyInput';
import { formatCurrencyDisplay, parseCurrencyInput } from '@/lib/currency';
import { contactValues, hydrationConflicts, type ContactOption, type EditableIdentity } from './dealHydration';

const DEFAULT_INDUSTRY_OPTIONS = INDUSTRY_OPTIONS.map(value => ({ value, label: value }));

export type DealFormState = {
  customerId: string;
  customerLocked: boolean;
  primaryContactId: string;
  primaryContactLocked: boolean;
  contactPrefillPending: boolean;
  updateCustomerProfile: boolean;
  customerProfileCanEdit: boolean;
  customerName: string;
  contactName: string;
  manuallyEditedIdentity: EditableIdentity[];
  dealName: string;
  projectId: string;
  projectLocked: boolean;
  positionCategoryId: string;
  positionLabel: string;
  companyName: string;
  phone: string;
  email: string;
  zalo: string;
  facebook: string;
  telegram: string;
  website: string;
  taxCode: string;
  address: string;
  city: string;
  industry: string;
  sourcePlatform: string;
  servicePackage: string;
  package: string;
  stage: Deal['stage'];
  decisionMaker: string;
  estimatedBudget: string;
  followUpDate: string;
  nextStep: string;
  quoteUrl: string;
  quoteNumber: string;
  quoteTotalAmount: string;
  contractCode: string;
  contractTitle: string;
  contractUrl: string;
  contractStatus: string;
  paymentStatus: string;
  paymentDueDate: string;
  lifetimeValue: string;
  billingType: string;
  contractSignedAt: string;
  warrantyExpiresAt: string;
  customerSince: string;
  lastCareAt: string;
  contractNote: string;
  pauseReason: string;
  note: string;
  leadedBy: string;
  leadedByNameHint: string;
  sdrId: string;
  sdrNameHint: string;
  teamId: string;
  /** "Team Sale" (Team CRM - crm_teams) - filter cascading rieng cho "Sale
   * phu trach" (KHAC HAN `teamId` o tren la Team KPI/seeding noi bo qua
   * teamsService). Chi dung de loc UI, KHONG co cot rieng nao luu gia tri
   * nay - lay ra khoi payload o buildDealPayload(). Dat trong DealFormState
   * (thay vi local state rieng trong DealFormFields) de DealFormModal (cha)
   * doc duoc, dung lam dieu kien bat buoc luc "Tạo cơ hội nhanh" (feedback
   * leader 2026-09-29: "những cái dấu sao đỏ là bắt buộc á"). */
  crmTeamId: string;
};

export function emptyDealForm(): DealFormState {
  return {
    customerId: '',
    customerLocked: false,
    primaryContactId: '',
    primaryContactLocked: false,
    contactPrefillPending: false,
    updateCustomerProfile: false,
    customerProfileCanEdit: false,
    customerName: '',
    contactName: '',
    manuallyEditedIdentity: [],
    dealName: '',
    projectId: '',
    projectLocked: false,
    positionCategoryId: '',
    positionLabel: '',
    companyName: '',
    phone: '',
    email: '',
    zalo: '',
    facebook: '',
    telegram: '',
    website: '',
    taxCode: '',
    address: '',
    city: '',
    industry: '',
    sourcePlatform: 'Manual',
    servicePackage: '',
    package: '',
    stage: 'dealing',
    decisionMaker: '',
    estimatedBudget: '',
    followUpDate: '',
    nextStep: '',
    quoteUrl: '',
    quoteNumber: '',
    quoteTotalAmount: '',
    contractCode: '',
    contractTitle: '',
    contractUrl: '',
    contractStatus: '',
    paymentStatus: 'chua_thanh_toan',
    paymentDueDate: '',
    lifetimeValue: '',
    billingType: 'one_time',
    contractSignedAt: '',
    warrantyExpiresAt: '',
    customerSince: '',
    lastCareAt: '',
    contractNote: '',
    pauseReason: '',
    note: '',
    leadedBy: '',
    leadedByNameHint: '',
    sdrId: '',
    sdrNameHint: '',
    teamId: '',
    crmTeamId: '',
  };
}

function toDateInput(value?: string) {
  return value ? String(value).slice(0, 10) : '';
}

function toDateTimeInput(value?: string) {
  return value ? String(value).slice(0, 16) : '';
}

export function dealFormFromDeal(deal: Deal): DealFormState {
  return {
    ...emptyDealForm(),
    customerId: deal.customerId || '',
    customerLocked: false,
    updateCustomerProfile: false,
    customerProfileCanEdit: false,
    customerName: deal.companyName || '', dealName: deal.customerName,
    primaryContactId: deal.primaryContactId || '', primaryContactLocked: false, projectId: deal.projectId || '',
    projectLocked: false,
    positionCategoryId: deal.positionCategoryId || '',
    positionLabel: deal.positionLabelSnapshot || deal.position || '',
    companyName: deal.companyName || '',
    phone: deal.phone || '',
    email: deal.email || '',
    zalo: deal.zalo || '',
    facebook: deal.facebook || '',
    telegram: deal.telegram || '',
    website: deal.website || '',
    taxCode: deal.taxCode || '',
    address: deal.address || '',
    city: deal.city || '',
    industry: deal.industry || '',
    sourcePlatform: deal.sourcePlatform || 'Manual',
    servicePackage: deal.servicePackage || '',
    package: deal.package || '',
    stage: deal.stage || 'dealing',
    decisionMaker: deal.decisionMaker || '',
    estimatedBudget: String(deal.estimatedBudget || ''),
    followUpDate: toDateTimeInput(deal.followUpDate),
    nextStep: deal.nextStep || '',
    quoteUrl: deal.quote?.url || '',
    quoteNumber: deal.quote?.number || '',
    quoteTotalAmount: String(deal.quote?.totalAmount || ''),
    contractCode: deal.contract.code || '',
    contractTitle: deal.contract.title || '',
    contractUrl: deal.contract.url || '',
    contractStatus: deal.contract.status || '',
    paymentStatus: deal.contract.paymentStatus || 'chua_thanh_toan',
    paymentDueDate: toDateInput(deal.contract.paymentDueDate),
    lifetimeValue: String(deal.lifetimeValue || ''),
    billingType: deal.billingType || 'one_time',
    contractSignedAt: toDateInput(deal.contract.signedAt),
    warrantyExpiresAt: toDateInput(deal.contract.warrantyExpiresAt),
    customerSince: toDateInput(deal.contract.customerSince),
    lastCareAt: toDateTimeInput(deal.contract.lastCareAt),
    contractNote: deal.contract.note || '',
    pauseReason: deal.pauseReason || '',
    note: deal.note || '',
    leadedBy: deal.assignment.leadedById || '',
    leadedByNameHint: deal.assignment.leadedByNameHint || deal.assignment.leadName || '',
    sdrId: deal.assignment.sdrId || '',
    sdrNameHint: deal.assignment.sdrNameHint || deal.assignment.sdrName || '',
    teamId: deal.teamId || '',
    // Luon bat dau rong - khong co cot rieng nao tren Deal luu "Team Sale",
    // hieu ung auto-load (suy nguoc tu sdrId da luu qua
    // crmTeamsService.getTeamIdForUser) se tu dien lai dung Team ngay sau khi
    // form nay mount (xem effect trong DealFormFields).
    crmTeamId: '',
  };
}

export function getSourceLabel(sourcePlatform: string) {
  return SOURCE_OPTIONS.find(option => option.value === sourcePlatform)?.label || sourcePlatform;
}

export function validateDealForm(form: DealFormState, opts?: { requireTeamSale?: boolean }): string | null {
  if (!form.dealName.trim()) return 'Vui lòng chọn hoặc nhập tên dự án.';
  if (!form.customerName.trim()) return 'Vui lòng nhập tên khách hàng.';
  if (!form.email.trim() && !form.phone.trim()) return 'Cần nhập email hoặc số điện thoại để tạo contact.';
  if (!form.servicePackage.trim()) return 'Vui lòng chọn sản phẩm/dịch vụ.';
  if (!form.nextStep.trim()) return 'Vui lòng nhập Next step (việc cần làm tiếp theo).';
  if (!form.followUpDate.trim()) return 'Vui lòng chọn hạn follow-up.';
  // "Team Sale" + "Sale phụ trách" bắt buộc CHỈ ở nhánh "Tạo cơ hội nhanh"
  // (isCreate) - feedback leader 2026-09-29: "áp dụng cùng flow Team Sale ->
  // Sale phụ trách như 2 form còn lại... những cái dấu sao đỏ là bắt buộc
  // á". Nhánh Sửa deal (isCreate=false) và DealQuoteWizard (khong truyen cờ
  // này) KHÔNG bắt buộc - Team Sale ở đó chỉ là bộ lọc UI, không phải field
  // nghiệp vụ mới bắt buộc phải chọn.
  if (opts?.requireTeamSale) {
    if (!form.crmTeamId.trim()) return 'Vui lòng chọn Team Sale.';
    if (!form.sdrId.trim()) return 'Vui lòng chọn Sale phụ trách.';
  }
  return null;
}

/** Deal Health — điểm 0-100 tự tính thuần từ field đã chắc chắn có trong form (không suy
 * đoán field backend chưa trả, vd stage đứng bao lâu). Trừ điểm theo đúng field còn thiếu,
 * sinh mô tả liệt kê rõ đã có gì / còn thiếu gì để Manager đọc là hiểu ngay. */
export type DealHealthLevel = 'good' | 'fair' | 'warning' | 'risk';

export interface DealHealthResult {
  score: number;
  level: DealHealthLevel;
  label: string;
  description: string;
}

export function computeDealHealth(
  form: Pick<DealFormState, 'followUpDate' | 'nextStep' | 'decisionMaker' | 'estimatedBudget' | 'phone' | 'email'>
): DealHealthResult {
  let score = 100;
  const have: string[] = [];
  const missing: string[] = [];
  let overdue = false;

  if (form.phone.trim() || form.email.trim()) have.push('liên hệ');
  if (form.estimatedBudget.trim()) have.push('giá trị');
  else {
    score -= 15;
    missing.push('ngân sách được xác nhận');
  }
  if (form.nextStep.trim()) have.push('next step');
  else score -= 35;

  if (!form.followUpDate.trim()) {
    score -= 35;
  } else {
    const due = new Date(form.followUpDate);
    if (!Number.isNaN(due.getTime()) && due.getTime() < Date.now()) {
      overdue = true;
      score -= 25;
    }
  }
  if (!form.decisionMaker.trim()) {
    score -= 15;
    missing.push('người quyết định');
  }

  score = Math.max(0, Math.min(100, score));
  const level: DealHealthLevel = score >= 85 ? 'good' : score >= 60 ? 'fair' : score >= 35 ? 'warning' : 'risk';
  const label = { good: 'Tốt', fair: 'Khá', warning: 'Cần chú ý', risk: 'Có nguy cơ' }[level];

  const parts: string[] = [];
  if (have.length) parts.push(`Có ${have.join(' + ')}`);
  if (overdue) parts.push('Follow-up đã quá hạn');
  if (missing.length) parts.push(`Chưa xác định ${missing.join(' và ')}`);
  const description = parts.length ? `${parts.join('. ')}.` : 'Chưa đủ thông tin để đánh giá.';

  return { score, level, label, description };
}

export function buildDealPayload(form: DealFormState, _agents: CrmUserOption[] = []): CreateDealInput | UpdateDealInput {
  const quote =
    form.quoteUrl || form.quoteNumber || form.quoteTotalAmount
      ? {
          url: form.quoteUrl.trim() || undefined,
          number: form.quoteNumber.trim() || undefined,
          totalAmount: parseMoney(form.quoteTotalAmount) || undefined,
        }
      : undefined;
  return {
    customerId: form.customerId || undefined,
    projectId: form.projectId || null,
    // "Cơ hội" khong con nhap ten rieng - lay theo Du an da chon (feedback
    // 2026-09-25). form.dealName vua la ten hien thi cua deal (cot
    // customer_name legacy) VUA la ten Du an dang go/da chon (xem
    // ProjectPicker). Neu chua co projectId (Du an MOI go tay, chua tung
    // luu) thi gui projectName de backend tu tao Du an that.
    projectName: !form.projectId ? (form.dealName.trim() || undefined) : undefined,
    primaryContactId: form.primaryContactId || null,
    updateCustomerProfile: form.updateCustomerProfile,
    customerName: form.dealName.trim(),
    customerProfileName: form.customerName.trim(),
    positionCategoryId: form.positionCategoryId || undefined,
    companyName: form.companyName.trim(),
    phone: form.phone.trim(),
    email: form.email.trim(),
    zalo: form.zalo.trim(),
    facebook: form.facebook.trim(),
    telegram: form.telegram.trim(),
    website: form.website.trim(),
    taxCode: form.taxCode.trim(),
    address: form.address.trim(),
    city: form.city,
    industry: form.industry,
    sourcePlatform: form.sourcePlatform || 'Manual',
    servicePackage: form.servicePackage,
    package: form.package,
    stage: form.stage,
    decisionMaker: form.decisionMaker.trim(),
    estimatedBudget: parseMoney(form.estimatedBudget),
    lifetimeValue: parseMoney(form.lifetimeValue),
    billingType: form.billingType as Deal['billingType'],
    followUpDate: form.followUpDate ? new Date(form.followUpDate).toISOString() : '',
    nextStep: form.nextStep.trim(),
    quote,
    contract: {
      code: form.contractCode.trim(),
      status: form.contractStatus as Deal['contract']['status'],
      paymentStatus: form.paymentStatus as Deal['contract']['paymentStatus'],
      paymentDueDate: form.paymentDueDate,
      signedAt: form.contractSignedAt,
      warrantyExpiresAt: form.warrantyExpiresAt,
      customerSince: form.customerSince,
      lastCareAt: form.lastCareAt ? new Date(form.lastCareAt).toISOString() : '',
      title: form.contractTitle.trim(),
      url: form.contractUrl.trim(),
      note: form.contractNote.trim(),
    },
    pauseReason: form.pauseReason.trim(),
    note: form.note.trim(),
    teamId: form.teamId || undefined,
    assignment: {
      ownerUserId: form.leadedBy,
      createdById: form.leadedBy,
      assignedUserId: form.sdrId,
      sdrId: form.sdrId,
      sdrName: form.sdrNameHint,
      sdrNameHint: form.sdrNameHint,
      leadedById: form.leadedBy,
      leadName: form.leadedByNameHint,
      leadedByNameHint: form.leadedByNameHint,
    },
  };
}

export function CustomerProfileCombobox({
  form,
  setValue,
  disabled = false,
  locked = false,
  hideProfileUpdateToggle = false,
}: {
  form: DealFormState;
  setValue: <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => void;
  disabled?: boolean;
  /** Block 1: mo tu "Tạo cơ hội" o Ho so khach hang/Project card - Customer
   * PHAI tu dien va khoa, an nut "Đổi" (khong cho doi sang khach khac). */
  locked?: boolean;
  /** An han checkbox "Cập nhật thông tin này vào hồ sơ khách hàng" - dung cho
   * CreateOpportunityDrawer (feedback leader 2026-09-27: "mặc định cập nhật
   * vào hồ sơ đi, không cần chọn tick") - luon cap nhat, khong can nguoi
   * dung tu bat. Man sua Deal (DealFormFields chinh) VAN giu checkbox nhu
   * cu, khong doi hanh vi o do. */
  hideProfileUpdateToggle?: boolean;
}) {
  const [query, setQuery] = useState(form.customerName);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CrmCustomerSummary[]>([]);
  const [resultsQuery, setResultsQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // AI/company input only supplies a search term, never a customer ID.
  const suggestedQuery = !form.customerId ? (form.companyName.trim() || form.customerName.trim()) : '';
  useEffect(() => {
    if (!suggestedQuery || locked) return;
    const timer = window.setTimeout(() => { setQuery(suggestedQuery); setOpen(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [suggestedQuery, locked]);

  useEffect(() => {
    const keyword = query.trim();
    if (!open || keyword.length < 2) {
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      setLoading(true);
      void seedingCrmRepository.quickSearchCustomers(keyword, 8)
        .then(result => {
          if (alive) {
            setItems(result);
            setResultsQuery(keyword);
            setActiveIndex(-1);
          }
        })
        .catch(() => {
          if (alive) setItems([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  // Click ben ngoai combobox -> dong menu (khong xoa lua chon dang co).
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  // Xoa sach du lieu lien he da autofill tu khach hang truoc do (cong ty/chuc
  // vu/SDT/email/nguon) - tranh cong don du lieu cua khach A khi doi sang go
  // ten khach moi hoac bam "Doi".
  function clearAutofilledContact() {
    setValue('primaryContactId', '');
    setValue('contactPrefillPending', false);
    setValue('contactName', '');
    setValue('manuallyEditedIdentity', []);
    setValue('companyName', '');
    setValue('positionCategoryId', '');
    setValue('positionLabel', '');
    setValue('phone', '');
    setValue('email', '');
    for (const field of ['zalo', 'facebook', 'telegram', 'website', 'taxCode', 'address', 'city', 'industry'] as const) setValue(field, '');
    setValue('sourcePlatform', 'Manual');
  }

  function typeName(value: string) {
    if (form.customerId && form.manuallyEditedIdentity.length &&
      !window.confirm('Đổi khách hàng sẽ xóa thông tin liên hệ đã sửa tay. Tiếp tục?')) return;
    setQuery(value);
    setOpen(true);
    setValue('customerName', value);
    if (form.customerId) {
      setValue('customerId', '');
      setValue('projectId', ''); // doi Customer -> Project cu (thuoc Customer khac) khong con hop le
      setValue('dealName', ''); // Ten co hoi lay theo Du an - Du an cu cung khong con hop le
      setValue('updateCustomerProfile', hideProfileUpdateToggle);
      setValue('customerProfileCanEdit', false);
      clearAutofilledContact();
    }
  }

  function pick(customer: CrmCustomerSummary) {
    if (resultsQuery !== query.trim()) return;
    if (customer.id === form.customerId) { setOpen(false); return; }
    const next = { companyName: customer.companyName || customer.customerName || '',
      contactName: '', phone: customer.phone || '', email: customer.email || '' };
    if (hydrationConflicts(form, form.manuallyEditedIdentity, next).length &&
      !window.confirm('Thông tin đã sửa tay khác hồ sơ CRM. Dùng dữ liệu của khách hàng đã chọn?')) return;
    clearAutofilledContact();
    setValue('customerId', customer.id);
    setValue('projectId', ''); // Customer moi -> Project cu (neu co) thuoc Customer khac, khong con hop le
    setValue('dealName', ''); // Ten co hoi lay theo Du an - Du an cu cung khong con hop le
    setValue('customerProfileCanEdit', Boolean(customer.canEdit));
    setValue('updateCustomerProfile', hideProfileUpdateToggle);
    setValue('customerName', customer.customerName || '');
    setValue('companyName', next.companyName);
    setValue('positionCategoryId', customer.positionCategoryId || '');
    setValue('positionLabel', customer.positionLabelSnapshot || customer.position || '');
    setValue('phone', next.phone);
    setValue('email', next.email);
    // Person name is populated only after Sale confirms a Contact.
    setValue('sourcePlatform', customer.source || form.sourcePlatform || 'Manual');
    setQuery(customer.customerName || '');
    setOpen(false);
    setActiveIndex(-1);
  }

  function clearPickedCustomer() {
    if (form.manuallyEditedIdentity.length &&
      !window.confirm('Đổi khách hàng sẽ xóa thông tin liên hệ đã sửa tay. Tiếp tục?')) return;
    setValue('customerId', '');
    setValue('projectId', '');
    setValue('dealName', ''); // Ten co hoi lay theo Du an - Du an cu cung khong con hop le
    setValue('updateCustomerProfile', false);
    setValue('customerProfileCanEdit', false);
    setValue('customerName', '');
    clearAutofilledContact();
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => (index + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => (index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        pick(items[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="crm-customer-combobox" ref={containerRef}>
      <div className="crm-customer-combobox-row">
        <input
          id="crm-deal-customer-name"
          value={open ? query : form.customerName}
          onFocus={() => {
            setQuery(form.customerName);
            setOpen(true);
          }}
          onChange={event => typeName(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || locked}
          placeholder="Tìm Customer / tên công ty"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="crm-deal-customer-combobox-menu"
        />
        {form.customerId && !locked ? (
          <button type="button" className="crm-inline-link-btn" onClick={clearPickedCustomer}>
            Đổi
          </button>
        ) : null}
      </div>
      {open && query.trim().length >= 2 ? (
        <div className="crm-customer-combobox-menu" id="crm-deal-customer-combobox-menu" role="listbox">
          {loading ? <p>Đang tìm...</p> : null}
          {!loading && !items.length ? <p>Không tìm thấy hồ sơ phù hợp</p> : null}
          {(resultsQuery === query.trim() ? items : []).map((customer, index) => (
            <button
              type="button"
              key={customer.id}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => pick(customer)}
            >
              <strong>{customer.customerName || 'Khách hàng chưa tên'}</strong>
              <span>{[customer.companyName, customer.phone, customer.email].filter(Boolean).join(' · ') || 'Chưa có liên hệ'}</span>
            </button>
          ))}
        </div>
      ) : null}
      {form.customerId && !hideProfileUpdateToggle ? (
        <label className={`crm-customer-profile-checkbox ${!form.customerProfileCanEdit ? 'is-disabled' : ''}`}>
          <input
            type="checkbox"
            checked={form.updateCustomerProfile}
            disabled={!form.customerProfileCanEdit}
            onChange={event => setValue('updateCustomerProfile', event.target.checked)}
          />
          <span>Cập nhật thông tin này vào hồ sơ khách hàng</span>
        </label>
      ) : null}
    </div>
  );
}

/** "Dự án" cua Co hoi (Block 1) - feedback 2026-09-25: khong con o "Tên cơ
 * hội" rieng, deal LAY TEN THEO DU AN - combobox nay VUA chon Du an co san
 * (thuoc DUNG Customer dang chon) VUA cho go ten de TAO Du an moi (backend
 * tu tao khi luu deal, xem buildDealPayload() projectName). Rong/khoa khi
 * chua chon Customer. */
function ProjectPicker({
  form,
  setValue,
  locked = false,
}: {
  form: DealFormState;
  setValue: <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => void;
  locked?: boolean;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsCustomerId, setProjectsCustomerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!form.customerId) {
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
    setLoading(true);
    void projectsService.list(form.customerId).then(res => {
      if (alive && res.success && res.data) { setProjects(res.data); setProjectsCustomerId(form.customerId); }
    }).catch(() => { if (alive) setProjects([]); }).finally(() => {
      if (alive) setLoading(false);
    });
    }, 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [form.customerId]);

  // Khoa (mo tu Project card, vd "Tạo cơ hội") - projectId da co san nhung ten
  // chi biet duoc SAU KHI danh sach projects tai xong - tu dien dealName ngay
  // luc do (chi khi dealName con rong, khong ghi de deal dang sua).
  useEffect(() => {
    if (!locked || !form.projectId || form.dealName) return;
    const current = projects.find(p => p.id === form.projectId);
    if (current) setValue('dealName', current.name);
  }, [locked, form.projectId, form.dealName, projects]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  if (!form.customerId) {
    return <input value="" disabled placeholder="Chọn khách hàng trước" />;
  }

  const options = projectsCustomerId === form.customerId ? projects : [];

  if (locked) {
    const current = options.find(p => p.id === form.projectId);
    return <input value={form.dealName || current?.name || 'Dự án đã chọn'} disabled readOnly />;
  }

  const keyword = query.trim().toLowerCase();
  const filtered = keyword
    ? options.filter(p => p.name.toLowerCase().includes(keyword) || p.projectCode.toLowerCase().includes(keyword))
    : options;
  const exactMatch = options.some(p => p.name.trim().toLowerCase() === query.trim().toLowerCase());

  function pick(project: Project) {
    setValue('projectId', project.id);
    setValue('dealName', project.name);
    setQuery('');
    setOpen(false);
  }

  function createNew() {
    const name = query.trim();
    if (!name) return;
    setValue('projectId', '');
    setValue('dealName', name);
    setOpen(false);
  }

  return (
    <div className="crm-customer-combobox" ref={containerRef}>
      <input
        value={open ? query : form.dealName}
        onFocus={() => { setQuery(form.dealName); setOpen(true); }}
        onChange={event => {
          setQuery(event.target.value);
          setOpen(true);
          setValue('projectId', '');
          setValue('dealName', event.target.value);
        }}
        placeholder={loading ? 'Đang tải dự án...' : 'Chọn dự án có sẵn hoặc gõ tên dự án mới'}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {open ? (
        <div className="crm-customer-combobox-menu">
          {filtered.map(project => (
            <button type="button" key={project.id} onMouseDown={event => event.preventDefault()} onClick={() => pick(project)}>
              <strong>{project.name}</strong>
              <span>{project.projectCode}</span>
            </button>
          ))}
          {query.trim() && !exactMatch ? (
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={createNew}>
              + Tạo dự án mới: “{query.trim()}”
            </button>
          ) : null}
          {!filtered.length && !query.trim() ? <p>Chưa có dự án nào — gõ để tạo dự án mới</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ContactPicker({
  form,
  setValue,
  locked = false,
}: {
  form: DealFormState;
  setValue: <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => void;
  locked?: boolean;
}) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loadedCustomerId, setLoadedCustomerId] = useState('');
  const [contactError, setContactError] = useState('');
  const currentContactForm = useRef(form);
  useLayoutEffect(() => { currentContactForm.current = form; }, [form]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!form.customerId) {
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
    setContacts([]);
    setLoadedCustomerId('');
    setContactError('');
    setLoading(true);
    void seedingCrmRepository.listContacts(form.customerId).then(res => {
      if (!alive) return;
      setContacts(res);
      setLoadedCustomerId(form.customerId);
      const selected = res.find(c => c.id === currentContactForm.current.primaryContactId);
      // Reopening a saved Deal resolves the name by canonical linked ID;
      // do not overwrite its saved/edited phone/email on a list refresh.
      if (selected && currentContactForm.current.primaryContactId === selected.id &&
        !currentContactForm.current.contactName) setValue('contactName', selected.name || '');
      const current = currentContactForm.current;
      if (selected && current.primaryContactId === selected.id && current.contactPrefillPending) {
        const next = contactValues(selected);
        if (!hydrationConflicts(current, current.manuallyEditedIdentity, next).length ||
          window.confirm('Dùng SĐT/Email của Contact đã chọn thay dữ liệu đã sửa tay?')) {
          setValue('phone', next.phone);
          setValue('email', next.email);
          setValue('contactName', next.contactName);
          setValue('manuallyEditedIdentity', current.manuallyEditedIdentity.filter(field => field === 'companyName'));
        }
        setValue('contactPrefillPending', false);
      }
    }).catch(() => {
      if (alive) setContactError('Không tải được người liên hệ. Vui lòng chọn lại khách hàng để thử lại.');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    }, 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [form.customerId]);

  // BUG THAT DA GAP ("2 dong Chua chon trong dropdown"): xem giai thich o
  // ProjectPicker.options ben tren - cung 1 nguyen nhan, cung 1 cach fix.
  const options = loadedCustomerId === form.customerId
    ? contacts.map(c => ({ value: c.id, label: c.name + (c.is_primary === true ? ' · Chính' : '') })) : [];

  function chooseContact(id: string) {
    if (loading || loadedCustomerId !== form.customerId) return;
    const contact = contacts.find(c => c.id === id);
    if (id === form.primaryContactId) return;
    if (id && !contact) return;
    const next = contactValues(contact);
    if (hydrationConflicts(form, form.manuallyEditedIdentity, next).length &&
      !window.confirm('Tên/SĐT/Email đã sửa tay khác dữ liệu CRM. Thay bằng thông tin người liên hệ đã chọn?')) return;
    // No ID changes until conflict confirmation; missing values clear old data.
    setValue('primaryContactId', id);
    setValue('contactName', next.contactName);
    setValue('phone', next.phone);
    setValue('email', next.email);
    setValue('manuallyEditedIdentity', form.manuallyEditedIdentity.filter(field => field === 'companyName'));
  }

  if (!form.customerId) return <input disabled readOnly placeholder="Chọn khách hàng trước" />;

  if (locked) {
    const current = options.find(o => o.value === form.primaryContactId);
    return <input value={current ? current.label : form.primaryContactId ? 'Người liên hệ đã chọn' : 'Chưa chọn'} disabled readOnly />;
  }

  return (
    <>
    <SearchableSelect
      value={form.primaryContactId}
      onChange={chooseContact}
      options={options}
      placeholder={loading ? 'Đang tải người liên hệ...' : 'Chưa chọn'}
    />
    {contactError ? <p className="crm-error">{contactError}</p> : null}
    </>
  );
}

export function DealFormFields({
  form,
  setValue,
  agents = [],
  variant = 'edit',
  sourceOptions = SOURCE_OPTIONS,
  servicePackageOptions = SERVICE_PACKAGE_OPTIONS,
  packageOptions = CRM_PACKAGE_OPTIONS,
  industryOptions = DEFAULT_INDUSTRY_OPTIONS,
  isCreate = false,
  currentUser = null,
  showTeamSaleInEditBranch = false,
}: {
  form: DealFormState;
  setValue: <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => void;
  sourceOptions?: Array<{ value: string; label: string }>;
  servicePackageOptions?: Array<{ value: string; label: string }>;
  packageOptions?: Array<{ value: string; label: string }>;
  industryOptions?: Array<{ value: string; label: string }>;
  agents?: CrmUserOption[];
  /** 'wizard' hides manual contract/quote link fields — the deal+quote wizard generates the quote link automatically. */
  variant?: 'edit' | 'wizard';
  /** true = popup "Thêm deal" (tạo mới): dùng chip picker 5 giai đoạn + khối AI + mặc định
   * Người phụ trách theo currentUser. false = sửa deal có sẵn: giữ nguyên select đầy đủ
   * DEAL_STAGES (kể cả on_hold/won/lost) như hành vi cũ. */
  isCreate?: boolean;
  currentUser?: AppUser | null;
  /** true = cũng bật "Team Sale" (Team CRM) ở nhánh SỬA deal (isCreate=false)
   * — dropdown lọc "Người phụ trách" + auto-load Team từ sdrId đã lưu, giống
   * hệt luồng lúc "Tạo cơ hội nhanh". Mặc định false để KHÔNG đổi hành vi của
   * các nơi khác đang dùng chung DealFormFields ở nhánh sửa (vd
   * DealQuoteWizard) — chỉ DealFormModal (form "Sửa deal" thật) bật cờ này. */
  showTeamSaleInEditBranch?: boolean;
}) {
  // Nguồn dữ liệu DUY NHẤT cho dropdown Quản lý/Phụ trách — GET /members,
  // không hard-code / không tự tạo danh sách riêng. Chọn tự do trên toàn bộ
  // 140 người, kể cả người CHƯA liên kết tài khoản đăng nhập — leaded_by/
  // sdr_id (FK tới app_users.id) sẽ NULL cho tới khi người đó liên kết, nhưng
  // tên vẫn luôn hiển thị nhờ leaded_by_name_hint/sdr_name_hint.
  const { members } = useMembers();

  // Dropdown "Team" trên deal — lấy từ GET /teams (DB-driven), không hard-code.
  // Team gán vào deal là CHỌN TAY, không tự suy ra từ người phụ trách.
  const [teams, setTeams] = useState<TeamRow[]>([]);
  useEffect(() => {
    let alive = true;
    void teamsService.getAll().then(res => {
      if (alive && res.success && res.data) setTeams(res.data);
    });
    return () => { alive = false; };
  }, []);
  // "Team Sale" (Team CRM - crm_teams, KHAC HAN "Team" o tren dung teamsService
  // KPI noi bo) - filter cascading rieng cho "Sale phu trach" trong panel
  // LeadDealQualificationPanel (luc isCreate) + (khi showTeamSaleInEditBranch)
  // trong nhanh Sua deal - khong luu cot rieng nao, chi filter danh sach hien
  // thi. Gia tri dang chon nam trong form.crmTeamId (KHONG phai local state
  // rieng) de DealFormModal (cha) doc duoc, dung lam dieu kien bat buoc luc
  // "Tạo cơ hội nhanh".
  const enableCrmTeamSale = isCreate || showTeamSaleInEditBranch;
  const [crmTeamOptions, setCrmTeamOptions] = useState<CrmTeam[]>([]);
  const crmTeamId = form.crmTeamId;
  const [crmTeamMembers, setCrmTeamMembers] = useState<AppUserProfile[] | null>(null);
  // "+ Thêm Team mới" trong dropdown Team Sale (feedback leader 2026-09-29:
  // "tái sử dụng lại bên chỗ team crm") - tai su dung CHINH modal tao/sua
  // Team CRM da tach ra CrmTeamFormModal.tsx (dung chung voi CrmTeamsShell).
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [crmTeamLeaders, setCrmTeamLeaders] = useState<AppUserProfile[]>([]);
  const [crmAllUsers, setCrmAllUsers] = useState<AppUserProfile[]>([]);
  useEffect(() => {
    if (!enableCrmTeamSale) return;
    let alive = true;
    usersService.getAllProfiles().then(res => {
      if (!alive || !res.success) return;
      const rows = res.data || [];
      setCrmTeamLeaders(rows.filter(u => u.role === 'leader' || u.role === 'admin'));
      setCrmAllUsers(rows);
    });
    return () => { alive = false; };
  }, [enableCrmTeamSale]);
  useEffect(() => {
    let alive = true;
    crmTeamsService.list()
      .then(res => {
        if (!alive) return;
        const rows = res.success ? res.data || [] : [];
        setCrmTeamOptions(rows.filter(t => t.status === 'active'));
      })
      .catch(() => {
        if (alive) setCrmTeamOptions([]);
      });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!crmTeamId) {
      setCrmTeamMembers(null);
      return;
    }
    let alive = true;
    crmTeamsService.get(crmTeamId)
      .then(res => {
        if (!alive) return;
        const members = res.success ? res.data?.members || [] : [];
        // Leader KHONG nam trong `members` - nhung van phai chon duoc lam
        // Sale phu trach (feedback 2026-09-30: "leader cũng làm việc ở đó
        // thì lúc này không thể chọn leader").
        const leaderId = res.success ? res.data?.leader_user_id : undefined;
        const leaderName = res.success ? res.data?.leader_name : undefined;
        const hasLeader = leaderId && members.some(u => u.id === leaderId);
        setCrmTeamMembers(
          leaderId && !hasLeader
            ? [...members, { id: leaderId, name: leaderName || '', email: '' } as AppUserProfile]
            : members
        );
      })
      .catch(() => {
        if (alive) setCrmTeamMembers([]);
      });
    return () => { alive = false; };
  }, [crmTeamId]);

  const assignableMembers = [...members].sort((a, b) => a.display_name.localeCompare(b.display_name));

  // Value trên <option> phải LUÔN duy nhất (kể cả người chưa liên kết) —
  // dùng linked_user_id nếu có, else fallback về member.id của danh bạ.
  const selectionKeyOf = (m: MemberProfile) => m.linked_user_id || m.linked_user_id_2 || m.id;

  // User đang đăng nhập có thể CHƯA có trong danh bạ members (vd tài khoản mới tự đăng ký,
  // chưa được thêm vào trang Quản lý thành viên) — nếu vậy select "Người phụ trách" sẽ
  // không tìm thấy option khớp form.sdrId và hiện sai thành "-- Chưa giao --" dù DB đã lưu
  // đúng ID. Chèn 1 option ảo đại diện currentUser để select luôn hiện đúng tên đã chọn.
  const currentUserMissingFromMembers =
    Boolean(currentUser?.id) && !assignableMembers.some(m => selectionKeyOf(m) === currentUser!.id);

  // form.leadedBy/sdrId chỉ lưu app_users.id THẬT (rỗng nếu chưa liên kết),
  // nên suy ngược lại "đang chọn ai" để control <select> phải dò qua tên hint
  // khi id thật rỗng.
  const findSelectionKey = (realId: string, nameHint: string) => {
    if (realId) return realId;
    if (!nameHint) return '';
    const match = assignableMembers.find(m => !(m.linked_user_id || m.linked_user_id_2) && m.display_name === nameHint);
    return match ? match.id : '';
  };

  // Team của member này (nếu có) — dò qua team.members (member_of_teams, khớp
  // theo app_users.id đã liên kết) hoặc team.leader_member_id (khớp trường hợp
  // member này chính là Leader của team, kể cả khi chưa liên kết tài khoản).
  const findTeamForMember = (member: MemberProfile | undefined) => {
    if (!member) return undefined;
    const linkedId = member.linked_user_id || member.linked_user_id_2;
    return teams.find(t =>
      (linkedId && t.members?.some(m => m.id === linkedId)) ||
      t.leader_member_id === member.id
    );
  };

  // Member hiện đang được chọn ở "Quản lý" — dò qua id thật hoặc name hint
  // (deal cũ có thể chỉ có leadedByNameHint nếu người đó chưa liên kết).
  const resolvedLeadedByMember = assignableMembers.find(
    m => (m.linked_user_id || m.linked_user_id_2) === form.leadedBy
  ) || assignableMembers.find(m => !(m.linked_user_id || m.linked_user_id_2) && m.display_name === form.leadedByNameHint);
  const autoTeam = findTeamForMember(resolvedLeadedByMember);
  const autoTeamName = autoTeam?.name_team || '';

  // Đồng bộ teamId theo Quản lý mỗi khi dữ liệu đổi — kể cả khi mở sửa 1 deal
  // cũ đã có leadedBy từ trước (không cần người dùng chọn lại Quản lý).
  useEffect(() => {
    if (autoTeam && autoTeam.id !== form.teamId) {
      setValue('teamId', autoTeam.id);
    }
  }, [autoTeam?.id]);

  const handlePick = (value: string, idKey: 'leadedBy' | 'sdrId', hintKey: 'leadedByNameHint' | 'sdrNameHint') => {
    if (!value) {
      setValue(idKey, '');
      setValue(hintKey, '');
      // Bỏ chọn Quản lý → không còn nguồn để suy team, xoá luôn teamId
      // (useEffect autoTeam sẽ không tự set lại vì resolvedLeadedByMember rỗng).
      if (idKey === 'leadedBy') setValue('teamId', '');
      return;
    }
    const member = assignableMembers.find(m => selectionKeyOf(m) === value);
    setValue(idKey, member ? (member.linked_user_id || member.linked_user_id_2 || '') : '');
    setValue(hintKey, member ? member.display_name : '');
    // Team giờ HOÀN TOÀN tự động theo Quản lý (đã bỏ dropdown Team) —
    // useEffect autoTeam ở trên sẽ tự đồng bộ form.teamId ngay sau khi state
    // leadedBy/leadedByNameHint cập nhật.
  };

  const leadedBySelectionKey = findSelectionKey(form.leadedBy, form.leadedByNameHint);
  const sdrSelectionKey = findSelectionKey(form.sdrId, form.sdrNameHint);

  // Mặc định "Người phụ trách" = user đang đăng nhập lúc tạo deal mới — CHỈ chạy 1 lần khi
  // chưa có Phụ trách nào (kể cả từ nháp cũ đã lưu sẵn), lưu ĐÚNG app_users.id thật (không
  // chỉ tên hiển thị). Ưu tiên tìm đúng member khớp (đồng bộ cách hiển thị với handlePick),
  // fallback tên/email từ chính currentUser nếu chưa có trong danh bạ.
  useEffect(() => {
    if (!isCreate || !currentUser?.id || form.sdrId) return;
    const match = assignableMembers.find(m => (m.linked_user_id || m.linked_user_id_2) === currentUser.id);
    setValue('sdrId', currentUser.id);
    setValue('sdrNameHint', match ? match.display_name : currentUser.name || currentUser.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, currentUser?.id, assignableMembers.length]);

  // "Auto-load" Team Sale khi da co Sale duoc gan san (vd default currentUser
  // luc tao moi, hoac sdrId da luu san tren 1 Deal dang mo sua khi
  // showTeamSaleInEditBranch) - CHI khi crmTeamId con rong (khong ghi de luc
  // nguoi dung tu chon Team qua handleCrmTeamIdChange, vi luc do sdrId da bi
  // reset ve rong nen effect nay khong chay lai). Guard "tra loi tre": effect
  // deps gom form.sdrId nen moi lan sdrId doi (vd mo sang 1 Deal khac), cleanup
  // (alive=false) tu dong huy ket qua cua request cu truoc khi request moi
  // chay - khong can ref rieng vi crmTeamId gio nam trong `form` (tu reset ve
  // rong moi lan dealFormFromDeal() nap 1 Deal khac).
  useEffect(() => {
    if (!enableCrmTeamSale || !form.sdrId || crmTeamId) return;
    let alive = true;
    crmTeamsService.getTeamIdForUser(form.sdrId)
      .then(res => {
        if (!alive) return;
        const foundTeamId = res.success ? res.data?.crm_team_id : null;
        if (foundTeamId) setValue('crmTeamId', foundTeamId);
      })
      .catch(() => { /* khong co Team CRM cho nguoi nay - bo qua */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableCrmTeamSale, form.sdrId]);

  /** Doi Team do NGUOI DUNG tu bam trong panel - reset Sale phu trach dang
   * chon (khac voi auto-load o tren) vi co the khong con thuoc Team moi. */
  function handleCrmTeamIdChange(value: string) {
    setValue('crmTeamId', value);
    handlePick('', 'sdrId', 'sdrNameHint');
  }

  function editIdentity(field: EditableIdentity, value: string) {
    setValue(field, value);
    setValue('manuallyEditedIdentity', [...new Set([...form.manuallyEditedIdentity, field])]);
  }

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const dealHealth = computeDealHealth(form);

  // Field UI-only (chua co cot rieng tren Deal, giong het cach
  // CreateOpportunityDrawer/LeadDetailDrawer xu ly) - dung de tinh ICP/Ket
  // qua tu dong cho dung bo "1 form 1 luon" (feedback leader: "form Tạo cơ
  // hội nhanh chưa giống 2 form kia") - CHI dung luc isCreate.
  const [interestLevel, setInterestLevel] = useState<InterestLevel | ''>('');
  const [timeline, setTimeline] = useState('');
  const [nurtureReason, setNurtureReason] = useState('');
  const [unqualifiedReason, setUnqualifiedReason] = useState('');
  const { labels: knownProductLabels } = useCrmCategoryLabels('crm_service_package');
  const {
    ruleConditions, verificationOutcome, outcomeReasons, outcomeMissing, sqlProgress, icpFit,
  } = useLeadQualificationEngine({
    open: isCreate,
    productValue: form.servicePackage,
    knownProductLabels,
    hasInterestLevel: Boolean(interestLevel),
    hasValue: Boolean(form.estimatedBudget.trim()),
    hasTeam: Boolean(sdrSelectionKey),
    hasNext: Boolean(form.nextStep.trim()),
    hasFollow: Boolean(form.followUpDate.trim()),
    hasContact: Boolean(form.phone.trim() || form.email.trim()),
  });
  const nextStepWarning = verificationOutcome === 'sql' &&
    (Boolean(form.nextStep.trim()) !== Boolean(form.followUpDate.trim()) ||
      (!form.nextStep.trim() && !form.followUpDate.trim()));

  // Khi DA chon Team CRM: lay TRUC TIEP tu `crmTeamMembers` (app_users thuc su
  // cua Team, da gom Leader - xem fix o tren) THAY VI loc danh ba HR
  // (assignableMembers) - vi nhieu tai khoan CRM (dac biet tai khoan test)
  // KHONG co ho so lien ket ben "Quan ly thanh vien" (feedback 2026-09-30:
  // "member sao ko thay ai trong nay" - dropdown trong rong dù Team co nguoi
  // that, chi vi loc theo linked_user_id cua ho so HR). Khong chon Team ->
  // giu nguyen hanh vi cu (toan he thong, loc tu danh ba HR).
  const aeOptionsForPanel = crmTeamId
    ? (crmTeamMembers || [])
        .filter(u => u.id === sdrSelectionKey || u.id !== leadedBySelectionKey)
        .map(u => ({
          value: u.id,
          label: u.name || u.email || '',
          searchText: [u.name, u.email].filter(Boolean).join(' '),
        }))
    : [
        ...(currentUserMissingFromMembers && currentUser ? [{
          value: currentUser.id,
          label: currentUser.name || currentUser.email || '',
          searchText: [currentUser.name, currentUser.email].filter(Boolean).join(' '),
        }] : []),
        ...assignableMembers
          .filter(m => selectionKeyOf(m) === sdrSelectionKey || selectionKeyOf(m) !== leadedBySelectionKey)
          .map(m => {
            return {
              value: selectionKeyOf(m),
              label: m.display_name,
              searchText: [m.display_name, m.email].filter(Boolean).join(' '),
            };
          }),
      ];
  const crmTeamOptionsForSelect = crmTeamOptions.map(team => ({ value: team.id, label: team.name }));
  // "+ Thêm Team mới" trong dropdown Team Sale - mo CrmTeamFormModal, chon
  // luon Team vua tao khi tao xong (handleCrmTeamIdChange reset sdrId, dung
  // vi Team moi chua co thanh vien nao tu truoc).
  const crmTeamActions: SelectAction[] = enableCrmTeamSale
    ? [{ key: 'add-team', label: '+ Thêm Team mới', type: 'add', onSelect: () => setAddTeamOpen(true) }]
    : [];

  // "Tóm tắt quyết định" cho luc TAO NHANH (isCreate) - cung mau UI/logic voi
  // crm-verify-readiness-panel cua LeadDetailDrawer (Xac minh Lead) va
  // CreateOpportunityDrawer (Tao co hoi), them dong ICP/Gia tri/Giai doan cho
  // du bo (feedback: form nay phai giong 2 form kia). Checklist READINESS
  // (gate nut Tao deal) van CHINH LA dieu kien cua validateDealForm() o tren
  // (khong doi logic that) - CHI dung cho nhanh isCreate, KHONG anh huong man
  // Sua deal (isCreate=false van giu nguyen layout/section cu ben duoi).
  const createReviewChecks = [
    { key: 'name', label: 'Tên dự án / cơ hội', ok: Boolean(form.dealName.trim()) },
    { key: 'product', label: 'Sản phẩm / dịch vụ', ok: Boolean(form.servicePackage.trim()) },
    { key: 'next', label: 'Tiếp theo', ok: Boolean(form.nextStep.trim()) },
    { key: 'follow', label: 'Hạn follow-up', ok: Boolean(form.followUpDate.trim()) },
    // "Team Sale"/"Sale phụ trách" bắt buộc (feedback leader 2026-09-29) -
    // thêm vào đây để "Tóm tắt quyết định" phản ánh đúng, dù gate thật sự
    // nằm ở validateDealForm({ requireTeamSale: isCreate }) trong DealFormModal.
    { key: 'team', label: 'Team Sale', ok: Boolean(form.crmTeamId) },
    { key: 'ae', label: 'Sale phụ trách', ok: Boolean(sdrSelectionKey) },
  ];
  const createReviewOkCount = createReviewChecks.filter(c => c.ok).length;
  const createReviewReady = createReviewOkCount === createReviewChecks.length;
  const createReadinessLabel = createReviewReady ? 'Sẵn sàng tạo deal' : createReviewOkCount >= 3 ? 'Cần bổ sung thêm' : 'Chưa sẵn sàng';
  const createReadinessTone = createReviewReady ? 'ready' : createReviewOkCount >= 3 ? 'partial' : 'blocked';

  // Giong het decisionRows cua LeadDetailDrawer (Xac minh Lead) - bo cac dong
  // dinh danh khach hang (khong con UI chon/nhap khach hang o day nua theo
  // feedback "bo mục Khách hàng & liên hệ, đem nguyên form của lead").
  const decisionRows = [
    { key: 'need', label: 'Nhu cầu', value: form.servicePackage.trim() || '—', ok: Boolean(form.servicePackage.trim()) },
    { key: 'value', label: 'Giá trị ước tính', value: formatEstimatedValue(parseCurrencyInput(form.estimatedBudget)), ok: Boolean(form.estimatedBudget.trim()) },
    { key: 'icp', label: 'ICP', value: ICP_OPTIONS.find(o => o.value === icpFit)?.label || '—', ok: icpFit !== 'unknown' },
    { key: 'timeline', label: 'Thời gian triển khai', value: timeline || '—', ok: Boolean(timeline) },
    {
      key: 'next',
      label: 'Tiếp theo',
      value: form.nextStep.trim()
        ? `${form.nextStep}${form.followUpDate ? ' · ' + new Date(form.followUpDate).toLocaleString('vi-VN') : ''}`
        : '—',
      ok: Boolean(form.nextStep.trim()) && Boolean(form.followUpDate),
    },
    { key: 'ae', label: 'Sale nhận bàn giao', value: form.sdrNameHint || '—', ok: Boolean(sdrSelectionKey) },
    { key: 'stage', label: 'Giai đoạn', value: DEAL_STAGE_META[form.stage]?.label || form.stage, ok: true },
    { key: 'ai_score', label: 'AI score', value: `${dealHealth.score}/100 · ${dealHealth.label}`, ok: dealHealth.score >= 60 },
  ];

  // Next step: dropdown gợi ý thao tác phổ biến, vẫn cho gõ tự do — bắt đầu ở chế độ tuỳ
  // chỉnh nếu giá trị đang có (vd deal cũ) không khớp preset nào.
  return (
    <>
      {isCreate ? (
        <>
          {/* Bê nguyên form "Xác minh Lead"/"Tạo cơ hội bán hàng" sang đây
           * (feedback leader: "bỏ mục Khách hàng & liên hệ, đem nguyên form
           * của lead là được") - bỏ hẳn panel "Khách hàng & liên hệ" +
           * "Dán thông tin khách hàng" (AI điền nhanh) cũ, dùng thẳng
           * LeadDealQualificationPanel không thêm/bớt gì. Khách hàng cho deal
           * này (nếu có) đến từ prop `initialCustomer` (đã đổ sẵn vào
           * form.customerId/customerName/phone/email lúc mở modal), không
           * còn UI để xem/sửa lại ở đây nữa.
           *
           * Fix (2026-10-03): giả định trên chỉ đúng khi mở từ Hồ sơ khách
           * hàng (luôn có initialCustomer -> customerLocked=true). Mở từ
           * trang "Cơ hội" (Kanban "+ Thêm deal") KHÔNG có initialCustomer
           * (customerLocked=false, customerName rỗng) và vốn không có UI
           * nào để nhập - bấm Tạo deal luôn báo "Vui lòng nhập tên khách
           * hàng" dù form đã điền đủ mọi thứ khác. Hiện lại ĐÚNG
           * CustomerProfileCombobox đã dùng ở nhánh Sửa deal bên dưới (tái
           * dùng y hệt, pick() của nó đã tự map Company/SĐT/Email/Nguồn và
           * xoá Dự án/Contact cũ không còn hợp lệ) - CHỈ khi chưa bị khoá
           * khách hàng sẵn.
           *
           * Thêm Dự án + Người liên hệ (feedback kế tiếp, cùng ngày): cũng
           * tái dùng ĐÚNG ProjectPicker/ContactPicker của nhánh Sửa deal -
           * CHỈ render được SAU khi đã có customerId (2 picker này tự khoá/
           * rỗng khi chưa có khách hàng, xem ProjectPicker ở trên). Khác với
           * nhánh Sửa deal: Dự án ở đây KHÔNG bắt buộc (hint "tùy chọn" thay
           * vì required) - nhánh tạo nhanh này vẫn còn ô "Dự án" tự do trong
           * LeadDealQualificationPanel bên dưới (ghi cùng form.dealName) nên
           * không ép chọn lại 1 dự án có sẵn ở đây. */}
          {!form.customerLocked ? (
            <section className="crm-form-section">
              <div className="crm-form-grid">
                <Field label="Customer / Công ty" required>
                  <CustomerProfileCombobox form={form} setValue={setValue} hideProfileUpdateToggle />
                </Field>
                <Field label="Công ty" hint="tùy chọn">
                  <input value={form.companyName} onChange={event => editIdentity('companyName', event.target.value)} placeholder="Công ty TNHH ABC" />
                </Field>
                {/* Fix (2026-10-03): nhanh "Tạo cơ hội nhanh" truoc day KHONG
                 * co o nhap Email/SDT nao ca - go ten khach hang MOI (chua co
                 * trong CRM) xong bam "Tạo deal" luon bao "Cần nhập email
                 * hoặc số điện thoại" ma khong co cho de dien (bug nguoi dung
                 * bao cao thuc te). CustomerProfileCombobox.pick() CO tu dien
                 * phone/email neu chon 1 KHACH HANG CO SAN, nhung go ten MOI
                 * thi 2 field nay van rong - phai co o nhap thu cong o day,
                 * dung y het field "Liên hệ" cua nhanh Sua deal ben duoi. */}
                <Field full label="Liên hệ" required hint="chỉ cần SĐT hoặc Email">
                  <div className="crm-inline-pair">
                    <input value={form.phone} onChange={event => editIdentity('phone', event.target.value)} type="tel" placeholder="Số điện thoại" />
                    <input value={form.email} onChange={event => editIdentity('email', event.target.value)} type="email" placeholder="Email" />
                  </div>
                </Field>
                {form.customerId ? (
                  <>
                    <Field label="Dự án" hint="tùy chọn — chọn có sẵn hoặc gõ tên mới">
                      <ProjectPicker form={form} setValue={setValue} />
                    </Field>
                    <Field label="Người liên hệ chính" hint="tùy chọn">
                      <ContactPicker form={form} setValue={setValue} />
                    </Field>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}
          <LeadDealQualificationPanel
            canWrite
            interest={form.servicePackage}
            onInterestChange={value => setValue('servicePackage', value)}
            estimatedValue={parseCurrencyInput(form.estimatedBudget)}
            onEstimatedValueChange={value => setValue('estimatedBudget', value != null ? String(value) : '')}
            interestLevel={interestLevel}
            onInterestLevelChange={setInterestLevel}
            timeline={timeline}
            onTimelineChange={setTimeline}
            project={form.dealName}
            onProjectChange={value => { setValue('projectId', ''); setValue('dealName', value); }}
            note={form.note}
            onNoteChange={value => setValue('note', value)}
            teamId={crmTeamId}
            onTeamIdChange={handleCrmTeamIdChange}
            teamOptions={crmTeamOptionsForSelect}
            teamActions={crmTeamActions}
            aeId={sdrSelectionKey}
            onAeIdChange={value => handlePick(value, 'sdrId', 'sdrNameHint')}
            aeOptions={aeOptionsForPanel}
            contactName={form.contactName}
            nextStep={form.nextStep}
            onNextStepChange={value => setValue('nextStep', value)}
            nextStepAt={form.followUpDate}
            onNextStepAtChange={value => setValue('followUpDate', value)}
            dealStage={form.stage}
            onDealStageChange={value => setValue('stage', value as Deal['stage'])}
            verificationOutcome={verificationOutcome}
            ruleConditions={ruleConditions}
            outcomeReasons={outcomeReasons}
            outcomeMissing={outcomeMissing}
            sqlProgress={sqlProgress}
            nurtureReason={nurtureReason}
            onNurtureReasonChange={setNurtureReason}
            unqualifiedReason={unqualifiedReason}
            onUnqualifiedReasonChange={setUnqualifiedReason}
            followUpChannel=""
            onFollowUpChannelChange={() => {}}
            nextStepWarning={nextStepWarning}
            decisionRows={decisionRows}
            readinessLabel={createReadinessLabel}
            readinessTone={createReadinessTone}
          />
        </>
      ) : (
        <>
          <section className="crm-form-section">
            <h3 className="crm-form-title">1. Khách hàng &amp; Cơ hội</h3>
            <div className="crm-form-grid">
              <Field label="Customer / Công ty" required>
                <CustomerProfileCombobox form={form} setValue={setValue} locked={form.customerLocked} />
              </Field>
              <Field label="Dự án" required hint={form.projectLocked ? undefined : 'chọn có sẵn hoặc gõ tên mới — cơ hội lấy tên theo dự án'}>
                <ProjectPicker form={form} setValue={setValue} locked={form.projectLocked} />
              </Field>
              <Field label="Người liên hệ chính" hint={form.primaryContactLocked ? undefined : 'tùy chọn'}>
                <ContactPicker form={form} setValue={setValue} locked={form.primaryContactLocked} />
              </Field>
              <Field label="Công ty" hint="tùy chọn">
                <input value={form.companyName} onChange={event => editIdentity('companyName', event.target.value)} placeholder="Công ty TNHH ABC" />
              </Field>
              <Field label="Tên người liên hệ" hint={form.primaryContactId ? 'từ Contact đã chọn; không sửa hồ sơ CRM' : 'tùy chọn'}>
                <input value={form.contactName} readOnly placeholder="Chọn Contact để lấy tên người liên hệ" />
              </Field>
              <Field full label="Liên hệ" required hint="chỉ cần SĐT hoặc Email">
                <div className="crm-inline-pair">
                  <input value={form.phone} onChange={event => editIdentity('phone', event.target.value)} type="tel" placeholder="Số điện thoại" />
                  <input value={form.email} onChange={event => editIdentity('email', event.target.value)} type="email" placeholder="Email" />
                </div>
              </Field>
              <Field label="Sản phẩm / dịch vụ" required>
                <CrmCategoryCodeSelect categoryType="crm_service_package" value={form.servicePackage} onChange={value => setValue('servicePackage', value)} fallbackOptions={servicePackageOptions} placeholder="-- Chọn --" />
              </Field>
              <Field label="Giá trị ước tính (VND)">
                <CurrencyInput
                  value={parseCurrencyInput(form.estimatedBudget)}
                  onChange={value => setValue('estimatedBudget', value != null ? String(value) : '')}
                  placeholder="VD: 50.000.000"
                />
              </Field>
            </div>
          </section>

          <section className="crm-form-section">
            <h3 className="crm-form-title">2. Deal đang ở đâu?</h3>
            <div className="crm-form-grid">
              <Field full label="Giai đoạn deal">
                <select value={form.stage} onChange={event => setValue('stage', event.target.value as Deal['stage'])}>
                  {DEAL_STAGES.map(stage => (
                    <option key={stage} value={stage}>
                      {DEAL_STAGE_META[stage].label} - {DEAL_STAGE_META[stage].description}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Next step" required>
                <CrmCategorySelect categoryType="crm_next_step" value={form.nextStep} onChange={value => setValue('nextStep', value)} placeholder="-- Chọn --" excludeLabels={["Khác", "Khac"]} />
              </Field>
              <Field label="Hạn follow-up" required>
                <input value={form.followUpDate} onChange={event => setValue('followUpDate', event.target.value)} type="datetime-local" />
              </Field>
              {form.stage === 'on_hold' ? (
                <Field full label="Lý do tạm dừng">
                  <textarea value={form.pauseReason} onChange={event => setValue('pauseReason', event.target.value)} placeholder="Ghi rõ lý do deal bị tạm dừng..." />
                </Field>
              ) : null}
            </div>

            <div className="crm-deal-cards">
              <div className={`crm-deal-card crm-deal-card--health-${dealHealth.level}`}>
                <span className="crm-deal-card-label">Deal Health – tự tính để manager đánh giá chất lượng</span>
                <strong className="crm-deal-card-score">{dealHealth.score}/100 · {dealHealth.label}</strong>
                <p className="crm-deal-card-desc">{dealHealth.description}</p>
              </div>
              {showTeamSaleInEditBranch ? (
                <div className="crm-deal-card">
                  <span className="crm-deal-card-label">Team Sale</span>
                  <SearchableSelect
                    value={crmTeamId}
                    onChange={handleCrmTeamIdChange}
                    options={crmTeamOptionsForSelect}
                    actions={crmTeamActions}
                    placeholder="-- Chọn --"
                  />
                  <p className="crm-deal-card-desc">Lọc "Người phụ trách" bên dưới theo đúng Team đã chọn.</p>
                </div>
              ) : null}
              <div className="crm-deal-card">
                <span className="crm-deal-card-label">Người phụ trách</span>
                <select
                  className="crm-deal-card-select"
                  value={sdrSelectionKey}
                  onChange={event => handlePick(event.target.value, 'sdrId', 'sdrNameHint')}
                >
                  <option value="">-- Chưa giao --</option>
                  {/* Da chon Team CRM -> lay TRUC TIEP tu crmTeamMembers (xem
                      giai thich o aeOptionsForPanel phia tren) thay vi loc
                      danh ba HR - tranh dropdown trong voi tai khoan CRM
                      chua co ho so HR lien ket. */}
                  {crmTeamId ? (
                    (crmTeamMembers || [])
                      .filter(u => u.id === sdrSelectionKey || u.id !== leadedBySelectionKey)
                      .map(u => (
                        <option key={u.id} value={u.id}>
                          {u.name ? `${u.name}${u.email ? ` (${u.email})` : ''}` : u.email}
                        </option>
                      ))
                  ) : (
                    <>
                      {currentUserMissingFromMembers && currentUser ? (
                        <option value={currentUser.id}>{currentUser.name || currentUser.email}</option>
                      ) : null}
                      {assignableMembers
                        .filter(m => selectionKeyOf(m) === sdrSelectionKey || selectionKeyOf(m) !== leadedBySelectionKey)
                        .map(m => {
                          const linked = !!(m.linked_user_id || m.linked_user_id_2);
                          return (
                            <option key={m.id} value={selectionKeyOf(m)}>
                              {linked ? `${m.display_name}${m.email ? ` (${m.email})` : ''}` : m.display_name}
                            </option>
                          );
                        })}
                    </>
                  )}
                </select>
                <p className="crm-deal-card-desc">Tự động lấy sale đang đăng nhập. Manager có thể đổi sau.</p>
              </div>
            </div>
          </section>
        </>
      )}

      <section className="crm-advanced">
        <button type="button" className="crm-advanced-toggle" onClick={() => setAdvancedOpen(open => !open)}>
          {advancedOpen ? '− Ẩn thông tin nâng cao' : '+ Thêm thông tin nâng cao'}
        </button>
        {advancedOpen ? (
          <div className="crm-advanced-body">
            <section className="crm-form-section">
              <h3 className="crm-form-title">Thông tin nâng cao – không bắt buộc khi tạo deal</h3>
              <div className="crm-form-grid">
                <Field label="Nguồn">
                  <CrmCategoryCodeSelect categoryType="crm_source" value={form.sourcePlatform} onChange={value => setValue('sourcePlatform', value)} fallbackOptions={sourceOptions} />
                </Field>
                <Field label="Người quyết định (DM)">
                  <input value={form.decisionMaker} onChange={event => setValue('decisionMaker', event.target.value)} placeholder="VD: CEO / Marketing Director" />
                </Field>
                <Field label="Ngân sách xác nhận">
                  <CurrencyInput
                    value={parseCurrencyInput(form.estimatedBudget)}
                    onChange={value => setValue('estimatedBudget', value != null ? String(value) : '')}
                    placeholder="VD: 50.000.000"
                  />
                </Field>
                <Field label="Xác suất chốt">
                  <select value="auto" disabled title="Tự tính theo giai đoạn, chưa chỉnh tay được">
                    <option value="auto">Tự động theo stage</option>
                  </select>
                </Field>
                <Field full label="Ghi chú nhu cầu">
                  <textarea value={form.note} onChange={event => setValue('note', event.target.value)} placeholder="Pain point, yêu cầu chính, timeline, insight cần nhớ..." />
                </Field>
                <Field label="Mã số thuế">
                  <input value={form.taxCode} onChange={event => setValue('taxCode', event.target.value)} placeholder="Chỉ bổ sung khi cần báo giá/hợp đồng" />
                </Field>
                <Field label="Địa chỉ">
                  <input value={form.address} onChange={event => setValue('address', event.target.value)} placeholder="Chỉ bổ sung khi cần" />
                </Field>
                <Field full label="Link báo giá / hợp đồng">
                  <input value={form.quoteUrl} readOnly placeholder="Tự liên kết khi báo giá/hợp đồng được tạo trong CRM" title="Tham chiếu chỉ đọc, đồng bộ từ báo giá đã gắn với deal." />
                </Field>
              </div>
            </section>

            <section className="crm-form-section">
              <h3 className="crm-form-title">Thông tin liên hệ khác</h3>
              <div className="crm-form-grid">
                <Field label="Chức vụ">
                  <PositionSelect
                    value={form.positionCategoryId}
                    labelSnapshot={form.positionLabel}
                    onChange={(id, label) => {
                      setValue('positionCategoryId', id);
                      setValue('positionLabel', label);
                    }}
                  />
                </Field>
                <Field label="Zalo">
                  <input value={form.zalo} onChange={event => setValue('zalo', event.target.value)} placeholder="Số Zalo hoặc link Zalo" />
                </Field>
                <Field label="Facebook">
                  <input value={form.facebook} onChange={event => setValue('facebook', event.target.value)} placeholder="Link Facebook" />
                </Field>
                <Field label="Telegram">
                  <input value={form.telegram} onChange={event => setValue('telegram', event.target.value)} placeholder="@username hoặc link Telegram" />
                </Field>
                <Field label="Website">
                  <input value={form.website} onChange={event => setValue('website', event.target.value)} placeholder="https://..." />
                </Field>
                <Field label="Thành phố">
                  <CrmCategorySelect categoryType="crm_city" value={form.city} onChange={value => setValue('city', value)} />
                </Field>
                <Field label="Lĩnh vực">
                  <CrmCategoryCodeSelect categoryType="crm_industry" value={form.industry} onChange={value => setValue('industry', value)} fallbackOptions={industryOptions} />
                </Field>
                <Field label="Gói" hint="tùy chọn">
                  <CrmCategoryCodeSelect categoryType="crm_package" value={form.package} onChange={value => setValue('package', value)} fallbackOptions={packageOptions} placeholder="-- Chưa chọn --" />
                </Field>
              </div>
            </section>

            <section className="crm-form-section">
              <h3 className="crm-form-title">Hợp đồng &amp; thanh toán</h3>
              <div className="crm-form-grid">
                <Field label="Tình trạng hợp đồng">
                  <CrmCategoryCodeSelect categoryType="crm_contract_status" value={form.contractStatus} onChange={value => setValue('contractStatus', value)} placeholder="-- Chưa chọn --" />
                </Field>
                {variant === 'edit' ? (
                  <>
                    <Field label="Mã HĐ/BG">
                      <input value={form.contractCode} onChange={event => setValue('contractCode', event.target.value)} placeholder="HĐ/BG-2026-..." />
                    </Field>
                    <Field label="Tên hợp đồng / báo giá">
                      <input value={form.contractTitle} onChange={event => setValue('contractTitle', event.target.value)} placeholder="Bao_gia_ABC.pdf hoặc tên hợp đồng" />
                    </Field>
                    <Field full label="Link hợp đồng / file PDF">
                      <input value={form.contractUrl} onChange={event => setValue('contractUrl', event.target.value)} placeholder="https://... hoặc /public/quotes/..." />
                    </Field>
                  </>
                ) : null}
                <Field label="Trạng thái thanh toán">
                  <CrmCategoryCodeSelect categoryType="crm_payment_status" value={form.paymentStatus} onChange={value => setValue('paymentStatus', value)} />
                </Field>
                <Field label="Ngày cần thanh toán">
                  <input value={form.paymentDueDate} onChange={event => setValue('paymentDueDate', event.target.value)} type="date" />
                </Field>
                <Field label="Loại thanh toán">
                  <CrmCategoryCodeSelect categoryType="crm_billing_type" value={form.billingType} onChange={value => setValue('billingType', value)} />
                </Field>
                <Field
                  label={
                    form.billingType === 'monthly'
                      ? 'Giá trị hợp đồng / LTV (VND mỗi tháng)'
                      : form.billingType === 'yearly'
                      ? 'Giá trị hợp đồng / LTV (VND mỗi năm)'
                      : 'Giá trị hợp đồng / LTV (VND)'
                  }
                >
                  <CurrencyInput
                    value={parseCurrencyInput(form.lifetimeValue)}
                    onChange={value => setValue('lifetimeValue', value != null ? String(value) : '')}
                    placeholder="0"
                  />
                </Field>
                <Field label="Ngày ký hợp đồng">
                  <input value={form.contractSignedAt} onChange={event => setValue('contractSignedAt', event.target.value)} type="date" />
                </Field>
                <Field label="Hết hạn bảo hành">
                  <input value={form.warrantyExpiresAt} onChange={event => setValue('warrantyExpiresAt', event.target.value)} type="date" />
                </Field>
                <Field label="Ngày thành khách hàng">
                  <input value={form.customerSince} onChange={event => setValue('customerSince', event.target.value)} type="date" />
                </Field>
                <Field label="Lần chăm sóc gần nhất">
                  <input value={form.lastCareAt} onChange={event => setValue('lastCareAt', event.target.value)} type="datetime-local" />
                </Field>
                <Field full label="Ghi chú chăm sóc / hợp đồng">
                  <textarea value={form.contractNote} onChange={event => setValue('contractNote', event.target.value)} placeholder="Tình trạng hợp đồng, ngày tháng cần theo dõi..." />
                </Field>
              </div>
            </section>

            {variant === 'edit' ? (
              <section className="crm-form-section">
                <h3 className="crm-form-title">Tham chiếu báo giá</h3>
                <div className="crm-form-grid">
                  <Field label="Số báo giá">
                    <input value={form.quoteNumber} readOnly placeholder="Chưa có báo giá" title="Tham chiếu báo giá chỉ đọc, được đồng bộ từ báo giá đã gắn với deal." />
                  </Field>
                  <Field label="Tổng tiền báo giá">
                    <input value={form.quoteTotalAmount ? formatCurrencyDisplay(form.quoteTotalAmount) : ''} readOnly placeholder="0" title="Tham chiếu báo giá chỉ đọc, được đồng bộ từ báo giá đã gắn với deal." />
                  </Field>
                </div>
              </section>
            ) : null}

            <section className="crm-form-section">
              <h3 className="crm-form-title">Quản lý</h3>
              {autoTeamName ? (
                <p className="mb-2 text-xs text-on-surface-variant">
                  Team: <span className="crm-service-tag crm-service-tag--team" style={{ display: 'inline-flex' }}>{autoTeamName}</span>
                  {' '}(tự động theo Quản lý)
                </p>
              ) : null}
              <div className="crm-form-grid">
                <Field label="Quản lý">
                  <select value={leadedBySelectionKey} onChange={event => handlePick(event.target.value, 'leadedBy', 'leadedByNameHint')}>
                    <option value="">-- Chưa gán --</option>
                    {assignableMembers
                      .filter(m => selectionKeyOf(m) === leadedBySelectionKey || selectionKeyOf(m) !== sdrSelectionKey)
                      .map(m => {
                        const linked = !!(m.linked_user_id || m.linked_user_id_2);
                        return (
                          <option key={m.id} value={selectionKeyOf(m)}>
                            {linked ? `${m.display_name}${m.email ? ` (${m.email})` : ''}` : m.display_name}
                          </option>
                        );
                      })}
                  </select>
                </Field>
              </div>
            </section>
          </div>
        ) : null}
      </section>

      {enableCrmTeamSale ? (
        <CrmTeamFormModal
          open={addTeamOpen}
          editingId={null}
          initialTeam={null}
          leaders={crmTeamLeaders}
          allUsers={crmAllUsers}
          allowAddMembersAfterCreate
          onClose={() => setAddTeamOpen(false)}
          onSaved={newTeam => {
            setAddTeamOpen(false);
            setCrmTeamOptions(prev => [...prev, newTeam]);
            handleCrmTeamIdChange(newTeam.id);
          }}
        />
      ) : null}
    </>
  );
}

/** 5 giai đoạn cho chip picker lúc TẠO MỚI — cố ý không gồm on_hold/won/lost (3 stage đó chỉ
 * đạt tới qua kanban/sửa deal, không hợp lý chọn ngay lúc tạo nhanh) và bỏ qua 'requirement'
 * (Lấy yêu cầu) để khớp đúng 5 bước rút gọn của form nhanh. */
export const CREATE_STAGE_CHIPS: Deal['stage'][] = ['dealing', 'proposal_sent', 'negotiation', 'contract_signed', 'payment_1'];

/** Nhãn hiển thị RIÊNG cho chip picker của form nhanh — khác nhãn dùng chung
 * DEAL_STAGE_META (vd 'new_lead' vẫn là "Khách mới" ở kanban/nơi khác, chỉ ở đây gọi "Lead
 * mới") — cùng 1 giá trị stage lưu xuống DB, chỉ đổi CHỮ hiển thị tại đúng chỗ này. */
export const CREATE_STAGE_LABELS: Partial<Record<Deal['stage'], string>> = {
  dealing: 'Đang deal',
  proposal_sent: 'Lên Proposal',
  negotiation: 'Chăm sóc/Đàm phán',
  contract_signed: 'Lên hợp đồng',
  payment_1: 'Thanh toán đợt 1',
};

/** Gợi ý Next step phổ biến — vẫn cho gõ tự do qua "Tuỳ chỉnh...". */
export const NEXT_STEP_PRESETS = [
  'Gọi xác nhận nhu cầu',
  'Gửi báo giá',
  'Gửi hợp đồng',
  'Đặt lịch demo / tư vấn',
  'Chờ khách phản hồi',
  'Follow-up sau demo',
  'Xác nhận ngân sách',
];

function Field({
  label,
  hint,
  required,
  full,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`crm-field ${full ? 'crm-field--full' : ''}`}>
      {label ? (
        <span>
          {label} {hint ? <em>({hint})</em> : null} {required ? <b>*</b> : null}
        </span>
      ) : null}
      {children}
    </label>
  );
}
