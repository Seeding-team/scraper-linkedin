'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { parseCurrencyInput } from '@/lib/currency';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useMembers } from '@/hooks/useMembers';
import { allPlatformCategoriesService, usersService, crmTeamsService, type QuoteBusinessRoleUser, type CrmTeam, type AppUserProfile } from '@/services/all-platform.service';
import { DEAL_STAGE_META } from '../constants/crmConfig';
import {
  CustomerProfileCombobox,
  ProjectPicker,
  emptyDealForm,
  buildDealPayload,
  getSourceLabel,
  type DealFormState,
} from './DealFormFields';
import { HelpCircle, Loader2, X } from './icons';
import { LeadDealQualificationPanel, formatEstimatedValue } from './LeadDealQualificationPanel';
import { CrmTeamFormModal } from './CrmTeamFormModal';
import type { SelectAction } from './SearchableSelect';
import { useCrmCategoryLabels } from './CrmCategorySelect';
import { useLeadQualificationEngine } from '../hooks/useLeadQualificationEngine';
import { ICP_OPTIONS, INTEREST_LEVEL_OPTIONS, type InterestLevel } from '../utils/leadQualificationRules';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { CreateDealInput, CrmCustomerRow, Deal } from '../types';
import type { AppUser } from '@/types/unified.types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function isAdminOrLeader(user: AppUser | null) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'leader';
}

type ProductOption = { value: string; label: string };

function customerRowToForm(customer: CrmCustomerRow, ownerId: string): DealFormState {
  return {
    ...emptyDealForm(),
    customerId: customer.id,
    // Feedback leader 2026-09-27: "cho là mặc định cập nhật vào hồ sơ đi,
    // không cần chọn tick làm gì" - luon cap nhat thong tin vao ho so Khach
    // hang, khong can nguoi dung tu bat checkbox (da an checkbox nay o
    // CustomerProfileCombobox qua prop hideProfileUpdateToggle ben duoi).
    updateCustomerProfile: true,
    customerProfileCanEdit: Boolean(customer.canEdit),
    customerName: customer.customerName || '',
    companyName: customer.companyName || '',
    taxCode: customer.taxCode || '',
    phone: customer.phone || '',
    email: customer.email || '',
    sourcePlatform: 'Existing_Customer',
    sdrId: ownerId || customer.ownerId || '',
  };
}

export function CreateOpportunityDrawer({
  open,
  customer,
  currentUser,
  onClose,
  onCreated,
  // Nhung noi nhung drawer nay vao 1 modal/workspace khac dang mo (vd
  // "+ Tạo cơ hội mới" trong QuoteWorkspaceModal) KHONG duoc dieu huong di
  // dau ca khi bam "Xác nhận tạo cơ hội" - Sale dang dang do mot bao gia,
  // dieu huong se mat du lieu dang nhap. true = luon cu xu nhu nhanh "Lưu
  // nháp" (dong + goi onCreated, khong router.push), bat ke mode nao.
  suppressNavigation = false,
}: {
  open: boolean;
  customer: CrmCustomerRow | null;
  currentUser: AppUser | null;
  onClose: () => void;
  /** Tạo xong (Lưu nháp hoặc Tạo cơ hội), đóng drawer + báo cho trang cha reload số liệu.
   * Nhận kèm Deal vừa tạo (khi cha cần dùng ngay, vd tự chọn vào 1 dropdown "Cơ hội CRM" -
   * tham số optional để các nơi gọi cũ không cần đổi gì). */
  onCreated: (deal?: Deal) => void;
  suppressNavigation?: boolean;
}) {
  useBodyScrollLock(open);
  const router = useRouter();
  const { members } = useMembers();
  const canSwitchCustomer = isAdminOrLeader(currentUser);

  const [customerForm, setCustomerForm] = useState<DealFormState>(() => emptyDealForm());
  const [dealCount, setDealCount] = useState(0);
  const [ownerNameHint, setOwnerNameHint] = useState('');
  // Buoc 2 "Xac nhan tao co hoi & ban giao Sale" - khop voi flow Xac minh
  // Lead (LeadDetailDrawer) theo yeu cau leader "2 form giong nhau hoan
  // toan, dung chung" (2026-09-27): buoc 1 dien form -> buoc 2 xac nhan KPI
  // summary -> tao that + dieu huong sang trang chi tiet Khach hang.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Dau '?' canh nut chinh o footer (dong bo voi Xac minh Lead): bam de xem giai thich.
  const [footerHelp, setFooterHelp] = useState(false);
  useEffect(() => {
    if (!footerHelp) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest?.('.crm-footer-btn-wrap')) setFooterHelp(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [footerHelp]);

  // "Người liên hệ" - GIONG HET field cua form Xac minh Lead (chi go ten,
  // khong chon tu danh sach Contact co san/khong gan vai tro) - leader yeu
  // cau 2 form phai giong hoan toan (2026-09-27), bo han UI quan ly Contact
  // rieng (select Contact co san + vai tro + them Contact moi) truoc day.
  const [contactName, setContactName] = useState('');

  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productValue, setProductValue] = useState('');
  const [estimatedBudget, setEstimatedBudget] = useState('');

  // Field giong het form "Xac minh Lead" - leader yeu cau 2 form la "1 form
  // 1 luon" (2026-09-27). customer_leads chua co cot rieng cho may field nay
  // (interestLevel/score, icpFit, timeline, project) - gop vao dau `note` luc
  // submit thay vi fabricate migration moi cho field UI-only.
  const [interestLevel, setInterestLevel] = useState<InterestLevel | ''>('');
  const [timeline, setTimeline] = useState('');
  const [note, setNote] = useState('');
  const [nurtureReason, setNurtureReason] = useState('');
  const [unqualifiedReason, setUnqualifiedReason] = useState('');
  const [aeOptions, setAeOptions] = useState<QuoteBusinessRoleUser[]>([]);
  // "Team Sale" - filter cascading rieng (khong luu vao Lead/Deal, chi filter
  // "Sale phu trach"), cung pattern voi LeadDetailDrawer.
  const [teamOptions, setTeamOptions] = useState<CrmTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [teamMembers, setTeamMembers] = useState<AppUserProfile[] | null>(null);
  // "+ Thêm Team mới" trong dropdown Team Sale (feedback leader 2026-09-29) -
  // tai su dung CrmTeamFormModal (dung chung voi CrmTeamsShell/trang Team CRM).
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [teamLeaders, setTeamLeaders] = useState<AppUserProfile[]>([]);
  const [teamAllUsers, setTeamAllUsers] = useState<AppUserProfile[]>([]);
  // Guard chong "tra loi tre" (stale response) khi doi Customer nhanh - fetch
  // getTeamIdForUser cu tra ve sau khi Customer da doi khong duoc ghi de teamId.
  const teamAutoLoadTargetRef = useRef('');

  const [saving, setSaving] = useState<'' | 'stay' | 'deal'>('');
  const [error, setError] = useState('');

  const setCustomerFormValue = <K extends keyof DealFormState>(key: K, value: DealFormState[K]) => {
    setCustomerForm(current => ({ ...current, [key]: value }));
  };

  // Reset toan bo state moi lan mo drawer voi 1 khach hang (row) khac.
  useEffect(() => {
    if (!open || !customer) return;
    const ownerId = customer.ownerId || currentUser?.id || '';
    setCustomerForm(customerRowToForm(customer, ownerId));
    setDealCount(customer.dealCount || 0);
    setOwnerNameHint('');
    setContactName('');
    setProductValue('');
    setEstimatedBudget('');
    setInterestLevel('');
    setTimeline('');
    setNote('');
    setNurtureReason('');
    setUnqualifiedReason('');
    setError('');
    setSaving('');
    setConfirmOpen(false);
    // Component KHONG unmount that su khi open=false (chi return null) nen
    // addTeamOpen (modal "+ Thêm Team mới") khong tu mat - phai reset tay o
    // day, tranh loi mo lai drawer van con thay modal tao Team cua lan truoc.
    setAddTeamOpen(false);

    // Auto-load Team Sale tu Owner da co san (KHONG reset lai sdrId vua nap o
    // customerRowToForm) - chi suy nguoc de hien dung Team dang gan.
    setTeamId('');
    setTeamMembers(null);
    teamAutoLoadTargetRef.current = customer.id;
    if (ownerId) {
      crmTeamsService.getTeamIdForUser(ownerId)
        .then(res => {
          if (teamAutoLoadTargetRef.current !== customer.id) return;
          const foundTeamId = res.success ? res.data?.crm_team_id : null;
          if (foundTeamId) setTeamId(foundTeamId);
        })
        .catch(() => { /* khong co Team CRM cho nguoi nay - bo qua */ });
    }
  }, [open, customer?.id]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    usersService.getUsersByQuoteBusinessRole('sale')
      .then(res => {
        if (!alive) return;
        const rows = res.success ? res.data || [] : [];
        setAeOptions([...rows].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (alive) setAeOptions([]);
      });
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    crmTeamsService.list()
      .then(res => {
        if (!alive) return;
        const rows = res.success ? res.data || [] : [];
        setTeamOptions(rows.filter(t => t.status === 'active'));
      })
      .catch(() => {
        if (alive) setTeamOptions([]);
      });
    return () => { alive = false; };
  }, [open]);

  // Danh sach Leader/user cho modal "+ Thêm Team mới" (CrmTeamFormModal).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    usersService.getAllProfiles().then(res => {
      if (!alive || !res.success) return;
      const rows = res.data || [];
      setTeamLeaders(rows.filter(u => u.role === 'leader' || u.role === 'admin'));
      setTeamAllUsers(rows);
    });
    return () => { alive = false; };
  }, [open]);

  // Doi Team -> tai lai thanh vien Team do, THAY THANG cho danh sach Sale he
  // thong (yeu cau "CHI xo cac thanh vien thuoc Team do"). teamId rong -> lui
  // ve danh sach he thong (aeOptionsForSelect ben duoi).
  useEffect(() => {
    if (!teamId) {
      setTeamMembers(null);
      return;
    }
    let alive = true;
    crmTeamsService.get(teamId)
      .then(res => {
        if (!alive) return;
        const members = res.success ? res.data?.members || [] : [];
        // Leader KHONG nam trong `members` (luu rieng o `leader_user_id`) -
        // nhung Leader van "lam viec o do" that su nen van phai chon duoc lam
        // Sale phu trach (feedback 2026-09-30: "leader cũng làm việc ở đó
        // thì lúc này không thể chọn leader"). Them Leader vao danh sach
        // neu chua co (tranh trung khi BE lo them Leader vao members sau nay).
        const leaderId = res.success ? res.data?.leader_user_id : undefined;
        const leaderName = res.success ? res.data?.leader_name : undefined;
        const hasLeader = leaderId && members.some(m => m.id === leaderId);
        setTeamMembers(
          leaderId && !hasLeader
            ? [...members, { id: leaderId, name: leaderName || '', email: '' } as AppUserProfile]
            : members
        );
      })
      .catch(() => {
        if (alive) setTeamMembers([]);
      });
    return () => { alive = false; };
  }, [teamId]);

  // Ten hien thi Owner - tra cuu qua useMembers (cung nguon voi cac noi khac trong CRM).
  useEffect(() => {
    const key = customerForm.sdrId;
    if (!key) {
      setOwnerNameHint('');
      return;
    }
    const match = members.find(m => (m.linked_user_id || m.linked_user_id_2) === key);
    setOwnerNameHint(match ? match.display_name : customerForm.sdrNameHint || '');
  }, [customerForm.sdrId, members, customerForm.sdrNameHint]);

  // Khi doi sang khach hang khac (qua combobox "Doi") - tai lai contact count/
  // deal count/owner that cua khach hang do, khong dung so cu cua row trigger.
  useEffect(() => {
    if (!open || !customerForm.customerId) return;
    let alive = true;
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerForm.customerId)}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được hồ sơ khách hàng.');
        return body.data as { deal_count?: number; contact_count?: number; owner_id?: string };
      })
      .then(data => {
        if (!alive) return;
        setDealCount(Number(data.deal_count || 0));
        if (!customerForm.sdrId && data.owner_id) {
          setCustomerFormValue('sdrId', data.owner_id);
          // Owner that vua tai lai (khach hang doi qua combobox "Doi") - suy
          // Team tuong tu buoc mo drawer, CHI khi nguoi dung CHUA tu chon Team.
          if (!teamId) {
            const ownerIdAtRequest = data.owner_id;
            teamAutoLoadTargetRef.current = customerForm.customerId;
            crmTeamsService.getTeamIdForUser(ownerIdAtRequest)
              .then(teamRes => {
                if (teamAutoLoadTargetRef.current !== customerForm.customerId) return;
                const foundTeamId = teamRes.success ? teamRes.data?.crm_team_id : null;
                if (foundTeamId) setTeamId(foundTeamId);
              })
              .catch(() => { /* khong co Team CRM cho nguoi nay - bo qua */ });
          }
        }
      })
      .catch(() => {
        /* im lang - khong chan luong chinh vi 1 so lieu phu tai khong duoc */
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerForm.customerId]);

  // Danh muc san pham/dich vu (category_type=crm_service_package) - goi thang
  // API categories, khong cho luong nay bi block boi component share cua agent
  // song song neu chua xong.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void allPlatformCategoriesService.getAll('crm_service_package', { activeOnly: true }).then(res => {
      if (!alive) return;
      setProductOptions((res.data || []).map(c => ({ value: c.code, label: c.name || c.code })));
    });
    return () => { alive = false; };
  }, [open]);

  // Chua chon Team -> giu danh sach Sale toan he thong nhu cu; da chon Team ->
  // THAY THANG bang dung thanh vien Team do.
  // Presale cung duoc lam Sale phu trach (vd chi Thao Vu): luon co trong danh sach, tim theo ten khong phu thuoc Team dang chon.
  const [presaleUsers, setPresaleUsers] = useState<QuoteBusinessRoleUser[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    usersService.getUsersByQuoteBusinessRole('presale')
      .then(res => { if (alive) setPresaleUsers(res.success ? res.data || [] : []); })
      .catch(() => { if (alive) setPresaleUsers([]); });
    return () => { alive = false; };
  }, [open]);
  const aeOptionsForSelect = useMemo(() => {
    const base = teamId
      ? (teamMembers || []).map(user => ({ value: user.id, label: user.name || user.email }))
      : aeOptions.map(user => ({ value: user.id, label: user.name }));
    const seen = new Set(base.map(o => o.value));
    return [...base, ...presaleUsers.filter(u => u?.id && !seen.has(u.id)).map(u => ({ value: u.id, label: u.name || u.id }))];
  }, [teamId, teamMembers, aeOptions, presaleUsers]);
  const teamOptionsForSelect = useMemo(
    () => teamOptions.map(team => ({ value: team.id, label: team.name })),
    [teamOptions],
  );
  const teamActions: SelectAction[] = useMemo(
    () => [{ key: 'add-team', label: '+ Thêm Team mới', type: 'add', onSelect: () => setAddTeamOpen(true) }],
    [],
  );
  /** Doi Team do NGUOI DUNG tu bam - reset Sale phu trach dang chon vi co the
   * khong con thuoc Team moi (khac voi auto-load luc mo drawer/doi khach hang). */
  function handleTeamIdChange(value: string) {
    setTeamId(value);
    setCustomerFormValue('sdrId', '');
    setCustomerFormValue('sdrNameHint', '');
  }

  const { labels: knownProductLabels } = useCrmCategoryLabels('crm_service_package');

  const {
    ruleConditions, verificationOutcome, outcomeReasons, outcomeMissing, sqlProgress, icpFit,
  } = useLeadQualificationEngine({
    open,
    productValue,
    knownProductLabels,
    hasInterestLevel: Boolean(interestLevel),
    hasValue: Boolean(estimatedBudget),
    hasTeam: Boolean(customerForm.sdrId),
    hasNext: Boolean(customerForm.nextStep.trim()),
    hasFollow: Boolean(customerForm.followUpDate),
    hasContact: Boolean(customerForm.phone?.trim() || customerForm.email?.trim()),
  });
  const nextStepWarning = verificationOutcome === 'sql' &&
    (Boolean(customerForm.nextStep.trim()) !== Boolean(customerForm.followUpDate) ||
      (!customerForm.nextStep.trim() && !customerForm.followUpDate));

  // "Tóm tắt quyết định" - cung mau UI/logic voi crm-verify-readiness-panel cua
  // LeadDetailDrawer (Xac minh Lead), dieu kien nay CHINH LA dieu kien cua
  // reviewReady cu (khong doi logic, chi tach thanh mang de render checklist),
  // them "ae" (Sale nhan ban giao) cho dung "1 form 1 luon" (leader 2026-09-27).
  const reviewChecks = [
    {
      key: 'customer',
      label: 'Đã chọn khách hàng',
      value: customerForm.companyName || customerForm.customerName || '—',
      ok: Boolean(customerForm.customerId),
    },
    { key: 'next', label: 'Tiếp theo', value: customerForm.nextStep || '—', ok: Boolean(customerForm.nextStep.trim()) },
    {
      key: 'follow',
      label: 'Ngày follow-up',
      value: customerForm.followUpDate ? customerForm.followUpDate.replace('T', ' ') : '—',
      ok: Boolean(customerForm.followUpDate),
    },
    {
      key: 'team',
      label: 'Team Sale',
      value: teamOptionsForSelect.find(o => o.value === teamId)?.label || '—',
      ok: Boolean(teamId),
    },
    {
      key: 'ae',
      label: 'Sale nhận bàn giao',
      value: aeOptionsForSelect.find(o => o.value === customerForm.sdrId)?.label || ownerNameHint || '—',
      ok: Boolean(customerForm.sdrId),
    },
  ];
  const reviewOkCount = reviewChecks.filter(c => c.ok).length;
  const reviewReady = reviewOkCount === reviewChecks.length;
  const readinessLabel = reviewReady ? 'Sẵn sàng tạo cơ hội' : reviewOkCount >= 3 ? 'Cần bổ sung thêm' : 'Chưa sẵn sàng';
  const readinessTone: 'ready' | 'partial' | 'blocked' = reviewReady ? 'ready' : reviewOkCount >= 3 ? 'partial' : 'blocked';

  function validate(): string | null {
    if (!customerForm.customerId) return 'Vui lòng chọn khách hàng.';
    if (!customerForm.nextStep.trim()) return 'Vui lòng chọn/nhập việc tiếp theo.';
    if (!customerForm.followUpDate.trim()) return 'Vui lòng chọn ngày follow-up cho việc tiếp theo.';
    return null;
  }

  function buildPayload() {
    // Cac field mang qua tu form "Xac minh Lead" (ICP/Timeline/Du an) chua co
    // cot rieng nao tren customer_leads - judgment call: KHONG fabricate
    // migration moi cho field UI-only, gop vao dau `note` thay vi mat thong tin.
    const noteLines: string[] = [];
    if (timeline) noteLines.push(`Dự kiến triển khai: ${timeline}`);
    if (icpFit !== 'unknown') noteLines.push(`ICP: ${ICP_OPTIONS.find(o => o.value === icpFit)?.label}`);
    if (note.trim()) noteLines.push(note.trim());
    const form: DealFormState = {
      // projectId/dealName da duoc ProjectPicker ghi thang vao customerForm
      // (giong het +Deal that) - khong con can ghi de rieng o day nua.
      ...customerForm,
      servicePackage: productValue,
      estimatedBudget,
      decisionMaker: contactName.trim(),
      note: noteLines.join('\n'),
    };
    // buildDealPayload() luon tra ve du field cho tao moi (chi khai bao kieu
    // hop nhat CreateDealInput|UpdateDealInput vi dung chung cho ca sua deal) -
    // ep kieu ve CreateDealInput vi drawer nay chi bao gio TAO moi.
    return buildDealPayload(form) as CreateDealInput;
  }

  async function handleCreate(mode: 'stay' | 'deal') {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(mode);
    try {
      const payload = buildPayload();
      const created = await seedingCrmRepository.createDeal(payload);
      // Luon bao cho trang cha reload (bump reloadTick) bat ke mode nao - rieng
      // nhanh 'deal' ben duoi chi router.push SANG CUNG 1 trang (doi query
      // ?tab=deals), Next.js KHONG tu fetch lai du lieu vi customerId khong
      // doi -> thieu onCreated() o day la ly do "tạo xong k update liền mà
      // f5 mới thấy" (bug thuc te nguoi dung bao cao).
      onCreated(created);
      if (mode === 'stay' || suppressNavigation) {
        // da goi onCreated() o tren - suppressNavigation (nhung trong modal
        // khac) khong duoc dieu huong di dau du dang o nhanh 'deal'.
        if (mode === 'deal') {
          setConfirmOpen(false);
          onClose();
        }
      } else {
        // Feedback leader 2026-09-27: "xác nhận tạo cơ hội xong thì tự trỏ về
        // đúng trang chi tiết khách hàng" - giong het hanh vi handleConvert()
        // cua LeadDetailDrawer (Xac minh Lead), thay vi mo Deal Workspace tren
        // board CRM nhu truoc (`/all-platform/crm?openDeal=<id>`).
        setConfirmOpen(false);
        onClose();
        router.push(`/all-platform/crm/customers/${encodeURIComponent(customerForm.customerId)}?tab=deals`);
      }
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : 'Không tạo được cơ hội.');
    } finally {
      setSaving('');
    }
  }

  /** Mo buoc 2 "Xac nhan tao co hoi & ban giao Sale" - deal/co hoi CHUA ton
   * tai trong DB cho toi khi bam nut xac nhan cuoi o buoc 2, nen o day chi
   * validate + chuyen man hinh, khong goi API luu tam (khac Lead - noi da co
   * san Lead trong DB de PATCH "Luu nhap"). */
  function openConfirm() {
    setError('');
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setConfirmOpen(true);
  }

  if (!open || !customer) return null;

  return (
    <>
      {/* Cung khuon UI voi crm-verify-drawer cua LeadDetailDrawer (Xac minh
       * Lead) - leader yeu cau Tao co hoi dung chung form/kieu voi Xac minh
       * Lead de de dung, chi giu dung field da co san cua Tao co hoi, khong
       * them field lead-only (ICP fit, AI score...) vi Co hoi da co san Khach
       * hang, khong can lai. */}
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop crm-lead-verify-backdrop--passive" />
      <aside className="crm-drawer crm-lead-detail-drawer crm-verify-drawer" data-crm-create-opportunity-drawer="true">
        <header className="crm-lead-drawer-header crm-verify-header">
          <div className="crm-verify-header-text">
            <h2>
              Tạo cơ hội bán hàng
              <span
                className="crm-help-icon"
                tabIndex={0}
                title="Chọn khách hàng → chọn sản phẩm → xác nhận việc tiếp theo. Phần còn lại hệ thống tự điền."
              >
                <HelpCircle className="crm-icon" />
              </span>
            </h2>
          </div>
          <div className="crm-lead-drawer-header-actions">
            <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
              <X className="crm-icon" />
            </button>
          </div>
        </header>

        <div className="crm-drawer-body crm-lead-drawer-body crm-verify-body">
          {error ? <p className="crm-error">{error}</p> : null}

          {confirmOpen ? (
            <section className="crm-form-section crm-lead-convert-section" id="crm-opportunity-convert">
              <p className="crm-form-title">Xác nhận tạo cơ hội &amp; bàn giao Sale</p>
              <div className="crm-lead-convert-confirm">
                <div className="crm-lead-convert-summary">
                  <b>Deal sẽ được tạo với:</b>
                  <div className="crm-convert-kpi-grid">
                    <div className="crm-convert-kpi-card">
                      <span>Tên cơ hội</span>
                      <b>{[customerForm.companyName || customerForm.customerName, productOptions.find(o => o.value === productValue)?.label || productValue].filter(Boolean).join(' - ')}</b>
                    </div>
                    <div className="crm-convert-kpi-card">
                      <span>Giá trị dự kiến</span>
                      <b>{formatEstimatedValue(parseCurrencyInput(estimatedBudget))}</b>
                    </div>
                    <div className="crm-convert-kpi-card">
                      <span>Giai đoạn</span>
                      <b>{DEAL_STAGE_META[customerForm.stage as keyof typeof DEAL_STAGE_META]?.label || customerForm.stage}</b>
                    </div>
                    <div className="crm-convert-kpi-card">
                      <span>Mức quan tâm</span>
                      <b>{INTEREST_LEVEL_OPTIONS.find(o => o.value === interestLevel)?.label || 'Chưa có'}</b>
                    </div>
                  </div>
                  <div className="crm-convert-columns">
                    <div className="crm-convert-column">
                      <p className="crm-convert-column-title">Sale cần xử lý</p>
                      <div className="crm-convert-row"><span>Sale nhận bàn giao</span><b>{aeOptionsForSelect.find(o => o.value === customerForm.sdrId)?.label || ownerNameHint || 'Chưa gán'}</b></div>
                      <div className="crm-convert-row"><span>Việc tiếp theo</span><b>{customerForm.nextStep || 'Chưa có'}</b></div>
                      <div className="crm-convert-row"><span>Hạn follow-up</span><b>{customerForm.followUpDate ? new Date(customerForm.followUpDate).toLocaleString('vi-VN') : 'Chưa có'}</b></div>
                      <div className="crm-convert-row"><span>Người liên hệ</span><b>{contactName.trim() || customerForm.customerName || 'Chưa có'}</b></div>
                    </div>
                    <div className="crm-convert-column">
                      <p className="crm-convert-column-title">Khách hàng</p>
                      <div className="crm-convert-row"><span>Tên khách hàng</span><b>{customerForm.companyName || customerForm.customerName}</b></div>
                      <div className="crm-convert-row"><span>SĐT</span><b>{customerForm.phone || 'Chưa có'}</b></div>
                      <div className="crm-convert-row"><span>Nguồn</span><b>{getSourceLabel(customerForm.sourcePlatform || 'Manual')}</b></div>
                      <div className="crm-convert-row"><span>MST</span><b>{customerForm.taxCode || 'Chưa có'}</b></div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="crm-verify-summary">
                <div className="crm-verify-summary-main">
                  <p className="crm-verify-name">{customerForm.companyName || customerForm.customerName || 'Chưa chọn khách hàng'}</p>
                  <p className="crm-verify-sub">MST: {customerForm.taxCode || '—'}</p>
                  <p className="crm-verify-sub">
                    {customerForm.phone ? <a href={`tel:${customerForm.phone}`}>{customerForm.phone}</a> : <span>Chưa có SĐT</span>}
                    <span className="crm-verify-dot">·</span>
                    {customerForm.email ? <a href={`mailto:${customerForm.email}`}>{customerForm.email}</a> : <span>Chưa có email</span>}
                  </p>
                  <div style={{ marginTop: '0.45rem' }}>
                    <CustomerProfileCombobox form={customerForm} setValue={setCustomerFormValue} disabled={!canSwitchCustomer} hideProfileUpdateToggle />
                    {!canSwitchCustomer ? (
                      <p className="crm-customer-form-hint">Chỉ admin/leader mới đổi được sang khách hàng khác.</p>
                    ) : null}
                  </div>
                </div>
                <div className="crm-verify-score">
                  <b>{dealCount}</b>
                  <span>CƠ HỘI HIỆN CÓ</span>
                </div>
              </section>

              <div className="crm-verify-kpi-strip">
                <div><span>Nguồn</span><b>{getSourceLabel(customerForm.sourcePlatform || 'Manual')}</b></div>
                <div><span>Trạng thái</span><b>{verificationOutcome === 'sql' ? 'SQL' : verificationOutcome === 'nurturing' ? 'Nuôi dưỡng' : verificationOutcome === 'unqualified' ? 'Không đạt' : 'Chưa đủ dữ liệu'}</b></div>
                <div><span>Owner</span><b>{aeOptionsForSelect.find(o => o.value === customerForm.sdrId)?.label || ownerNameHint || 'Chưa gán'}</b></div>
                <div><span>Liên hệ</span><b>{contactName.trim() ? contactName : 'Chưa có'}</b></div>
              </div>

              <LeadDealQualificationPanel
                canWrite
                interest={productValue}
                onInterestChange={setProductValue}
                estimatedValue={parseCurrencyInput(estimatedBudget)}
                onEstimatedValueChange={value => setEstimatedBudget(value != null ? String(value) : '')}
                interestLevel={interestLevel}
                onInterestLevelChange={setInterestLevel}
                timeline={timeline}
                onTimelineChange={setTimeline}
                project={customerForm.dealName}
                onProjectChange={() => {}}
                projectField={<ProjectPicker form={customerForm} setValue={setCustomerFormValue} />}
                note={note}
                onNoteChange={setNote}
                teamId={teamId}
                onTeamIdChange={handleTeamIdChange}
                teamOptions={teamOptionsForSelect}
                teamActions={teamActions}
                aeId={customerForm.sdrId}
                onAeIdChange={value => {
                  const nameHint = teamId
                    ? (teamMembers || []).find(user => user.id === value)?.name
                      || (teamMembers || []).find(user => user.id === value)?.email
                    : aeOptions.find(user => user.id === value)?.name;
                  setCustomerFormValue('sdrId', value);
                  setCustomerFormValue('sdrNameHint', nameHint || '');
                }}
                aeOptions={aeOptionsForSelect}
                contactName={contactName}
                onContactNameChange={setContactName}
                nextStep={customerForm.nextStep}
                onNextStepChange={value => setCustomerFormValue('nextStep', value)}
                nextStepAt={customerForm.followUpDate}
                onNextStepAtChange={value => setCustomerFormValue('followUpDate', value)}
                dealStage={customerForm.stage}
                onDealStageChange={value => setCustomerFormValue('stage', value as DealFormState['stage'])}
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
                decisionRows={reviewChecks}
                readinessLabel={readinessLabel}
                readinessTone={readinessTone}
              />
            </>
          )}
        </div>

        {confirmOpen ? (
          <footer className="crm-drawer-footer crm-verify-footer">
            <div className="crm-lead-qualification-actions">
              <button type="button" className="crm-secondary-button" disabled={saving !== ''} onClick={() => setConfirmOpen(false)}>
                Quay lại
              </button>
              <button type="button" className="crm-primary-button" disabled={saving !== ''} onClick={() => void handleCreate('deal')}>
                {saving === 'deal' ? <Loader2 className="crm-save-spinner" /> : null} Xác nhận tạo cơ hội
              </button>
            </div>
          </footer>
        ) : (
          <footer className="crm-drawer-footer crm-verify-footer">
            {!reviewReady ? (
              <p className="crm-footer-reason" data-testid="deal-footer-reason">
                Chưa thể tạo cơ hội — còn thiếu: {reviewChecks.filter(c => !c.ok).map(c => c.label).join(', ')}.
              </p>
            ) : null}
            {/* 2 nut giong het footer buoc 1 cua LeadDetailDrawer (Lưu nháp |
             * nut chinh mo buoc xac nhan) - leader yeu cau 2 form giong nhau
             * hoan toan (2026-09-27). "Lưu nháp" o day tao Deal that luon (deal
             * chua ton tai trong DB de PATCH tam nhu Lead) nhung KHONG dieu
             * huong di dau, chi dong drawer + o lai danh sach. Nut chinh mo
             * buoc 2 xac nhan roi moi thuc su tao + dieu huong sang trang chi
             * tiet Khach hang - bo han nut "Tạo và mở Deal" thua/trung nghia
             * truoc day. */}
            <div className="crm-footer-actions">
              <button type="button" className="crm-secondary-button" disabled={!reviewReady || saving !== ''} onClick={() => void handleCreate('stay')}>
                {saving === 'stay' ? <Loader2 className="crm-save-spinner" /> : null}
                Lưu nháp
              </button>
              <span className="crm-footer-btn-wrap">
                <button type="button" className="crm-primary-button" disabled={!reviewReady || saving !== ''} onClick={openConfirm}>
                  Tạo cơ hội
                </button>
                <button type="button" className="crm-footer-help" aria-label="Giải thích nút này" aria-expanded={footerHelp} data-testid="deal-footer-help" onClick={() => setFooterHelp(v => !v)}>?</button>
                {footerHelp ? (
                  <div className="crm-footer-help-pop" role="dialog" data-testid="deal-footer-help-pop">
                    Tạo cơ hội: mở bước xác nhận rồi tạo Cơ hội mới cho khách hàng đã chọn, giao cho Sale nhận bàn giao và chuyển sang trang Chi tiết khách hàng. Cần đủ khách hàng, Team Sale, Sale nhận bàn giao, việc tiếp theo và hạn follow-up.
                  </div>
                ) : null}
              </span>
            </div>
          </footer>
        )}
      </aside>

      <CrmTeamFormModal
        open={addTeamOpen}
        editingId={null}
        initialTeam={null}
        leaders={teamLeaders}
        allUsers={teamAllUsers}
        allowAddMembersAfterCreate
        onClose={() => setAddTeamOpen(false)}
        onSaved={newTeam => {
          setAddTeamOpen(false);
          setTeamOptions(prev => [...prev, newTeam]);
          handleTeamIdChange(newTeam.id);
        }}
      />
    </>
  );
}

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
      <span>
        {label} {hint ? <em>({hint})</em> : null} {required ? <b>*</b> : null}
      </span>
      {children}
    </label>
  );
}
