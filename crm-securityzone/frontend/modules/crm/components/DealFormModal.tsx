'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  DealFormFields,
  buildDealPayload,
  dealFormFromDeal,
  emptyDealForm,
  getSourceLabel,
  validateDealForm,
} from './DealFormFields';
import type { DealFormState } from './DealFormFields';
import { Loader2, X } from './icons';
import type { CreateDealInput, CrmUserOption, Deal, UpdateDealInput } from '../types';
import type { AppUser } from '@/types/unified.types';

// Nháp deal đang tạo (chưa bấm "Tạo deal") — lưu localStorage để lỡ tay
// click ra ngoài / đóng modal cũng không mất dữ liệu đã điền.
const CRM_DEAL_DRAFT_KEY = 'crm:deal-draft:v1';

function loadDealDraft(): Partial<DealFormState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CRM_DEAL_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<DealFormState>) : null;
  } catch {
    return null;
  }
}

export function clearDealDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CRM_DEAL_DRAFT_KEY);
}

export function DealFormModal({
  open,
  loading,
  deal,
  onClose,
  onCreate,
  onCreateAndContinue,
  onUpdate,
  agents = [],
  sourceOptions,
  servicePackageOptions,
  packageOptions,
  industryOptions,
  currentUser = null,
  initialCustomer = null,
  initialProject = null,
}: {
  open: boolean;
  loading?: boolean;
  deal?: Deal | null;
  onClose: () => void;
  onCreate: (input: CreateDealInput) => void;
  /** "Lưu & thêm tiếp" — chỉ dùng ở chế độ tạo mới. Ném lỗi ngược lại (không tự alert) để
   * modal giữ nguyên dữ liệu đang nhập khi thất bại thay vì reset nhầm. */
  onCreateAndContinue?: (input: CreateDealInput) => Promise<void>;
  onUpdate: (id: string, input: UpdateDealInput) => void;
  agents?: CrmUserOption[];
  sourceOptions?: Array<{ value: string; label: string }>;
  servicePackageOptions?: Array<{ value: string; label: string }>;
  packageOptions?: Array<{ value: string; label: string }>;
  industryOptions?: Array<{ value: string; label: string }>;
  currentUser?: AppUser | null;
  /** Prefill khi mở "Thêm deal nhanh" từ trang Hồ sơ khách hàng (nút "+ Deal"/"+ Tạo deal
   * mới") — CHỈ áp dụng lúc tạo mới (bỏ qua khi đang sửa deal có sẵn). Không tạo 1 form
   * tạo-deal riêng, chỉ prefill vào đúng form nhanh hiện có. */
  initialCustomer?: { id: string; name: string; companyName?: string; phone?: string; email?: string } | null;
  /** Prefill + KHOÁ Dự án khi mở "Tạo cơ hội" từ 1 Project card cụ thể
   * (Block 1, mục 3) — CHỈ áp dụng lúc tạo mới, đi kèm initialCustomer. */
  initialProject?: { id: string } | null;
}) {
  const isCreate = !deal;
  const [form, setForm] = useState<DealFormState>(emptyDealForm);
  const [savingContinue, setSavingContinue] = useState(false);
  const [continueMessage, setContinueMessage] = useState('');
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setContinueMessage('');
    if (deal) {
      setForm(dealFormFromDeal(deal));
      return;
    }
    if (initialCustomer) {
      setForm({
        ...emptyDealForm(),
        customerId: initialCustomer.id,
        customerLocked: true,
        customerProfileCanEdit: false,
        customerName: initialCustomer.name || '',
        companyName: initialCustomer.companyName || '',
        phone: initialCustomer.phone || '',
        email: initialCustomer.email || '',
        projectId: initialProject?.id || '',
        projectLocked: Boolean(initialProject?.id),
      });
      return;
    }
    // Merge với default để draft cũ (lưu từ trước khi có field mới như nextStep) không
    // thiếu key — tránh input bị undefined.
    setForm({ ...emptyDealForm(), ...(loadDealDraft() || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, open, initialCustomer?.id, initialProject?.id]);

  // Chỉ lưu nháp khi đang TẠO MỚI (không phải sửa deal có sẵn) — tránh
  // nháp cũ ghi đè lên dữ liệu deal thật khi mở form sửa.
  useEffect(() => {
    if (!open || deal) return;
    try {
      window.localStorage.setItem(CRM_DEAL_DRAFT_KEY, JSON.stringify(form));
    } catch {
      // localStorage đầy hoặc bị chặn — bỏ qua, không phải lỗi nghiêm trọng.
    }
  }, [form, open, deal]);

  function setValue<K extends keyof DealFormState>(key: K, value: DealFormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateDealForm(form);
    if (validationError) {
      window.alert(validationError);
      return;
    }
    const payload = buildDealPayload(form, agents);
    if (deal) onUpdate(deal.id, payload);
    else onCreate(payload as CreateDealInput);
  }

  async function handleSaveAndContinue() {
    if (!onCreateAndContinue || savingContinue || loading) return;
    const validationError = validateDealForm(form);
    if (validationError) {
      window.alert(validationError);
      return;
    }
    setSavingContinue(true);
    setContinueMessage('');
    try {
      const payload = buildDealPayload(form, agents) as CreateDealInput;
      await onCreateAndContinue(payload);
      // Thành công: reset form, giữ modal mở — áp lại default Người phụ trách theo
      // currentUser (không phải xoá trắng rồi để trống).
      clearDealDraft();
      setForm(emptyDealForm());
      setContinueMessage('Đã tạo deal — tiếp tục nhập deal mới.');
      document.getElementById('crm-deal-customer-name')?.focus();
    } catch (err) {
      // Lỗi: GIỮ NGUYÊN toàn bộ form đang nhập, không reset, không mất dữ liệu.
      window.alert(err instanceof Error ? err.message : 'Không tạo được deal. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setSavingContinue(false);
    }
  }

  if (!open) return null;

  return (
    <div className="crm-modal-backdrop" onClick={onClose}>
      <div className="crm-modal crm-modal--deal-compact" onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header">
          <div>
            <h2 className="crm-modal-title">{deal ? 'Chỉnh sửa deal' : 'Thêm deal nhanh'}</h2>
            <p className="crm-modal-subtitle">
              {deal
                ? `Nguồn: ${getSourceLabel(form.sourcePlatform)}`
                : 'Chỉ nhập thông tin cần để sale bắt đầu làm việc. Phần còn lại bổ sung sau.'}
            </p>
          </div>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <form id="crmDealForm" className="crm-modal-body" onSubmit={handleSubmit}>
          {continueMessage ? <p className="crm-deal-continue-toast">{continueMessage}</p> : null}
          <DealFormFields
            form={form}
            setValue={setValue}
            agents={agents}
            sourceOptions={sourceOptions}
            servicePackageOptions={servicePackageOptions}
            packageOptions={packageOptions}
            industryOptions={industryOptions}
            isCreate={isCreate}
            currentUser={currentUser}
          />
        </form>

        <footer className="crm-modal-footer crm-modal-footer--deal">
          {isCreate ? (
            <p className="crm-deal-footer-hint">Mục tiêu: tạo deal trong &lt; 45 giây, không biến form thành hồ sơ khách hàng hoàn chỉnh.</p>
          ) : null}
          <div className="crm-deal-footer-actions">
            {isCreate && onCreateAndContinue ? (
              <button type="button" className="crm-cancel-button" disabled={loading || savingContinue} onClick={() => void handleSaveAndContinue()}>
                {savingContinue ? <Loader2 className="crm-save-spinner" /> : null}
                {savingContinue ? 'Đang lưu...' : 'Lưu & thêm tiếp'}
              </button>
            ) : null}
            <button type="submit" form="crmDealForm" className="crm-save-button" disabled={loading || savingContinue}>
              {loading ? <Loader2 className="crm-save-spinner" /> : null}
              {loading ? 'Đang lưu...' : deal ? 'Lưu thay đổi' : 'Tạo deal'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
