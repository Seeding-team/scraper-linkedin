'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { parseCurrencyInput } from '@/lib/currency';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useMembers } from '@/hooks/useMembers';
import { allPlatformCategoriesService, usersService, type QuoteBusinessRoleUser } from '@/services/all-platform.service';
import { DEAL_STAGE_META } from '../constants/crmConfig';
import {
  CustomerProfileCombobox,
  emptyDealForm,
  buildDealPayload,
  getSourceLabel,
  type DealFormState,
} from './DealFormFields';
import { HelpCircle, Loader2, X } from './icons';
import { LeadDealQualificationPanel, formatEstimatedValue } from './LeadDealQualificationPanel';
import { useLeadQualificationEngine } from '../hooks/useLeadQualificationEngine';
import { ICP_OPTIONS, INTEREST_LEVEL_OPTIONS, type IcpFit, type InterestLevel } from '../utils/leadQualificationRules';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { CreateDealInput, CrmCustomerRow } from '../types';
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
}: {
  open: boolean;
  customer: CrmCustomerRow | null;
  currentUser: AppUser | null;
  onClose: () => void;
  /** Tạo xong (Lưu nháp), ở lại danh sách (đóng drawer + báo cho trang cha reload số liệu). */
  onCreated: () => void;
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
  const [icpFit, setIcpFit] = useState<IcpFit>('unknown');
  const [timeline, setTimeline] = useState('');
  const [project, setProject] = useState('');
  const [note, setNote] = useState('');
  const [nurtureReason, setNurtureReason] = useState('');
  const [unqualifiedReason, setUnqualifiedReason] = useState('');
  const [aeOptions, setAeOptions] = useState<QuoteBusinessRoleUser[]>([]);

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
    setIcpFit('unknown');
    setTimeline('');
    setProject('');
    setNote('');
    setNurtureReason('');
    setUnqualifiedReason('');
    setError('');
    setSaving('');
    setConfirmOpen(false);
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
        if (!customerForm.sdrId && data.owner_id) setCustomerFormValue('sdrId', data.owner_id);
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

  const aeOptionsForSelect = useMemo(
    () => aeOptions.map(user => ({ value: user.id, label: user.name })),
    [aeOptions],
  );

  const {
    ruleConditions, verificationOutcome, outcomeReasons, outcomeMissing, sqlProgress,
  } = useLeadQualificationEngine({
    open,
    hasProduct: Boolean(productValue),
    hasInterestLevel: Boolean(interestLevel),
    hasValue: Boolean(estimatedBudget),
    hasTeam: Boolean(customerForm.sdrId),
    hasNext: Boolean(customerForm.nextStep.trim()),
    hasFollow: Boolean(customerForm.followUpDate),
    hasContact: Boolean(customerForm.phone?.trim() || customerForm.email?.trim()),
    icpFit,
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
    { key: 'next', label: 'Việc tiếp theo', value: customerForm.nextStep || '—', ok: Boolean(customerForm.nextStep.trim()) },
    {
      key: 'follow',
      label: 'Ngày follow-up',
      value: customerForm.followUpDate ? customerForm.followUpDate.replace('T', ' ') : '—',
      ok: Boolean(customerForm.followUpDate),
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
    if (project.trim()) noteLines.push(`Dự án: ${project.trim()}`);
    if (note.trim()) noteLines.push(note.trim());
    const form: DealFormState = {
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
      await seedingCrmRepository.createDeal(payload);
      if (mode === 'stay') {
        onCreated();
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
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={onClose} />
      <aside className="crm-drawer crm-lead-detail-drawer crm-verify-drawer">
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
                icpFit={icpFit}
                onIcpFitChange={setIcpFit}
                project={project}
                onProjectChange={setProject}
                note={note}
                onNoteChange={setNote}
                aeId={customerForm.sdrId}
                onAeIdChange={value => {
                  const match = aeOptions.find(user => user.id === value);
                  setCustomerFormValue('sdrId', value);
                  setCustomerFormValue('sdrNameHint', match ? match.name : '');
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
              <button type="button" className="crm-primary-button" disabled={!reviewReady || saving !== ''} onClick={openConfirm}>
                Tạo cơ hội
              </button>
            </div>
          </footer>
        )}
      </aside>
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
