'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMembers } from '@/hooks/useMembers';
import { teamsService, projectsService, type TeamRow, type Project } from '@/services/all-platform.service';
import { SearchableSelect } from './SearchableSelect';
import { PositionSelect } from './PositionSelect';
import { CrmCategoryCodeSelect, CrmCategorySelect } from './CrmCategorySelect';
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

const DEFAULT_INDUSTRY_OPTIONS = INDUSTRY_OPTIONS.map(value => ({ value, label: value }));

export type DealFormState = {
  customerId: string;
  /** Ho so Khach hang bi khoa (khong cho doi sang khach khac) - khi mo tu
   * nut "Tạo cơ hội" o Ho so khach hang/Project card (Block 1), Customer
   * PHAI tu dien va khoa, khong duoc doi giua chung. */
  customerLocked: boolean;
  updateCustomerProfile: boolean;
  customerProfileCanEdit: boolean;
  customerName: string;
  /** Du an that (migration 097) - '' = Chua thuoc du an. */
  projectId: string;
  /** Khoa Du an (khong cho doi) - khi mo tu nut "Tạo cơ hội" tren 1 Project
   * card cu the (Block 1: "tự điền Project; không cho chọn Project khác"). */
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
};

export function emptyDealForm(): DealFormState {
  return {
    customerId: '',
    customerLocked: false,
    updateCustomerProfile: false,
    customerProfileCanEdit: false,
    customerName: '',
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
    customerName: deal.customerName,
    projectId: deal.projectId || '',
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
  };
}

export function getSourceLabel(sourcePlatform: string) {
  return SOURCE_OPTIONS.find(option => option.value === sourcePlatform)?.label || sourcePlatform;
}

export function validateDealForm(form: DealFormState): string | null {
  if (!form.customerName.trim()) return 'Vui lòng nhập tên khách hàng.';
  if (!form.email.trim() && !form.phone.trim()) return 'Cần nhập email hoặc số điện thoại để tạo contact.';
  if (!form.servicePackage.trim()) return 'Vui lòng chọn sản phẩm/dịch vụ.';
  if (!form.nextStep.trim()) return 'Vui lòng nhập Next step (việc cần làm tiếp theo).';
  if (!form.followUpDate.trim()) return 'Vui lòng chọn hạn follow-up.';
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
    updateCustomerProfile: form.updateCustomerProfile,
    customerName: form.customerName.trim(),
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
}: {
  form: DealFormState;
  setValue: <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => void;
  disabled?: boolean;
  /** Block 1: mo tu "Tạo cơ hội" o Ho so khach hang/Project card - Customer
   * PHAI tu dien va khoa, an nut "Đổi" (khong cho doi sang khach khac). */
  locked?: boolean;
}) {
  const [query, setQuery] = useState(form.customerName);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CrmCustomerSummary[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

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
    setValue('companyName', '');
    setValue('positionCategoryId', '');
    setValue('positionLabel', '');
    setValue('phone', '');
    setValue('email', '');
  }

  function typeName(value: string) {
    setQuery(value);
    setOpen(true);
    setValue('customerName', value);
    if (form.customerId) {
      setValue('customerId', '');
      setValue('projectId', ''); // doi Customer -> Project cu (thuoc Customer khac) khong con hop le
      setValue('updateCustomerProfile', false);
      setValue('customerProfileCanEdit', false);
      clearAutofilledContact();
    }
  }

  function pick(customer: CrmCustomerSummary) {
    setValue('customerId', customer.id);
    setValue('projectId', ''); // Customer moi -> Project cu (neu co) thuoc Customer khac, khong con hop le
    setValue('customerProfileCanEdit', Boolean(customer.canEdit));
    setValue('updateCustomerProfile', false);
    setValue('customerName', customer.customerName || '');
    setValue('companyName', customer.companyName || '');
    setValue('positionCategoryId', customer.positionCategoryId || '');
    setValue('positionLabel', customer.positionLabelSnapshot || customer.position || '');
    setValue('phone', customer.phone || '');
    setValue('email', customer.email || '');
    setValue('sourcePlatform', customer.source || form.sourcePlatform || 'Manual');
    setQuery(customer.customerName || '');
    setOpen(false);
    setActiveIndex(-1);
  }

  function clearPickedCustomer() {
    setValue('customerId', '');
    setValue('projectId', '');
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
          placeholder="Nguyễn Văn A"
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
          {items.map((customer, index) => (
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
      {form.customerId ? (
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

/** Dropdown "Dự án" cua Co hoi (Block 1) - CHI hien Project THUOC DUNG
 * Customer dang chon (khong cho chon Project cua Customer khac). Rong khi
 * chua chon Customer. Luon co option "Chưa thuộc dự án" (project_id=null
 * that su, khong phai bo qua). */
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!form.customerId) {
      setProjects([]);
      return;
    }
    let alive = true;
    setLoading(true);
    void projectsService.list(form.customerId).then(res => {
      if (alive && res.success && res.data) setProjects(res.data);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [form.customerId]);

  if (!form.customerId) {
    return <input value="" disabled placeholder="Chọn khách hàng trước" />;
  }

  const options = [{ value: '', label: 'Chưa thuộc dự án' }, ...projects.map(p => ({ value: p.id, label: `${p.projectCode} · ${p.name}` }))];

  if (locked) {
    const current = projects.find(p => p.id === form.projectId);
    return (
      <input
        value={form.projectId ? (current ? `${current.projectCode} · ${current.name}` : 'Dự án đã chọn') : 'Chưa thuộc dự án'}
        disabled
        readOnly
      />
    );
  }

  return (
    <SearchableSelect
      value={form.projectId}
      onChange={value => setValue('projectId', value)}
      options={options}
      placeholder={loading ? 'Đang tải dự án...' : 'Chưa thuộc dự án'}
    />
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

  // Khối "AI điền nhanh" — kiểm tra 1 lần lúc mount xem backend có cấu hình AI thật
  // (OPENAI_API_KEY) hay không, KHÔNG gọi thử AI thật để check. Thiếu cấu hình → ẩn hẳn
  // khối này, không hiện nút rồi mới báo lỗi.
  const [aiConfigured, setAiConfigured] = useState(false);
  useEffect(() => {
    if (!isCreate) return;
    let alive = true;
    void seedingCrmRepository.getAiParseDealStatus().then(configured => {
      if (alive) setAiConfigured(configured);
    });
    return () => { alive = false; };
  }, [isCreate]);

  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  async function handleAiParse() {
    if (aiLoading || !aiText.trim()) return;
    setAiLoading(true);
    setAiError('');
    try {
      const result = await seedingCrmRepository.parseDealText(aiText.trim());
      // Chỉ điền field ĐANG RỖNG — không âm thầm ghi đè field Sale đã tự gõ tay.
      if (result.customerName && !form.customerName.trim()) setValue('customerName', String(result.customerName));
      if (result.companyName && !form.companyName.trim()) setValue('companyName', String(result.companyName));
      if (result.phone && !form.phone.trim()) setValue('phone', String(result.phone));
      if (result.email && !form.email.trim()) setValue('email', String(result.email));
      if (result.servicePackage && !form.servicePackage.trim()) setValue('servicePackage', String(result.servicePackage));
      if (result.estimatedBudget != null && !form.estimatedBudget.trim()) setValue('estimatedBudget', String(result.estimatedBudget));
      if (result.nextStep && !form.nextStep.trim()) setValue('nextStep', String(result.nextStep));
      if (result.note && !form.note.trim()) setValue('note', String(result.note));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI điền nhanh thất bại, vui lòng nhập tay.');
    } finally {
      setAiLoading(false);
    }
  }

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const dealHealth = computeDealHealth(form);

  // Next step: dropdown gợi ý thao tác phổ biến, vẫn cho gõ tự do — bắt đầu ở chế độ tuỳ
  // chỉnh nếu giá trị đang có (vd deal cũ) không khớp preset nào.
  return (
    <>
      {isCreate ? (
        <section className="crm-ai-fill">
          <h3 className="crm-form-title">Dán thông tin khách hàng <em className="crm-optional-hint">(tùy chọn)</em></h3>
          <div className="crm-ai-fill-row">
            <textarea
              className="crm-ai-fill-textarea"
              value={aiText}
              onChange={event => setAiText(event.target.value)}
              placeholder="VD: Nguyễn Văn A - CEO ABC, 0912345678, cần làm website, ngân sách ~80 triệu"
              rows={2}
            />
            <button
              type="button"
              className="crm-ai-fill-btn"
              disabled={aiLoading || !aiText.trim() || !aiConfigured}
              title={!aiConfigured ? 'Chưa cấu hình AI' : undefined}
              onClick={() => void handleAiParse()}
            >
              ✨ {aiLoading ? 'Đang phân tích...' : 'AI điền nhanh'}
            </button>
          </div>
          <p className="crm-ai-fill-hint">Dán tin nhắn/email/ghi chú cuộc gọi — AI sẽ tự điền các ô còn trống bên dưới, bạn vẫn sửa lại được.</p>
          {aiError ? <p className="crm-error crm-ai-fill-error">{aiError}</p> : null}
        </section>
      ) : null}

      <section className="crm-form-section">
        <h3 className="crm-form-title">1. Khách hàng &amp; Cơ hội</h3>
        <div className="crm-form-grid">
          <Field label="Tên khách hàng" required>
            <CustomerProfileCombobox form={form} setValue={setValue} locked={form.customerLocked} />
          </Field>
          <Field label="Dự án" hint={form.projectLocked ? undefined : 'tùy chọn'}>
            <ProjectPicker form={form} setValue={setValue} locked={form.projectLocked} />
          </Field>
          <Field label="Công ty" hint="tùy chọn">
            <input value={form.companyName} onChange={event => setValue('companyName', event.target.value)} placeholder="Công ty TNHH ABC" />
          </Field>
          <Field full label="Liên hệ" required hint="chỉ cần SĐT hoặc Email">
            <div className="crm-inline-pair">
              <input value={form.phone} onChange={event => setValue('phone', event.target.value)} type="tel" placeholder="Số điện thoại" />
              <input value={form.email} onChange={event => setValue('email', event.target.value)} type="email" placeholder="Email" />
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
          {isCreate ? (
            <Field full label="Giai đoạn" required>
              <div className="crm-stage-filter">
                {CREATE_STAGE_CHIPS.map(stage => {
                  const selected = form.stage === stage;
                  return (
                    <button
                      type="button"
                      key={stage}
                      className={`crm-stage-pill ${selected ? 'crm-stage-pill--selected' : 'crm-stage-pill--idle'}`}
                      style={selected ? { background: DEAL_STAGE_META[stage].color, borderColor: DEAL_STAGE_META[stage].color, color: '#fff' } : undefined}
                      onClick={() => setValue('stage', stage)}
                    >
                      {CREATE_STAGE_LABELS[stage]}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : (
            <Field full label="Giai đoạn deal">
              <select value={form.stage} onChange={event => setValue('stage', event.target.value as Deal['stage'])}>
                {DEAL_STAGES.map(stage => (
                  <option key={stage} value={stage}>
                    {DEAL_STAGE_META[stage].label} - {DEAL_STAGE_META[stage].description}
                  </option>
                ))}
              </select>
            </Field>
          )}
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
          <div className="crm-deal-card">
            <span className="crm-deal-card-label">Người phụ trách</span>
            <select
              className="crm-deal-card-select"
              value={sdrSelectionKey}
              onChange={event => handlePick(event.target.value, 'sdrId', 'sdrNameHint')}
            >
              <option value="">-- Chưa giao --</option>
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
            </select>
            <p className="crm-deal-card-desc">Tự động lấy sale đang đăng nhập. Manager có thể đổi sau.</p>
          </div>
        </div>
      </section>

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
