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

// Nhap deal cu (localStorage key "crm:deal-draft:v1") tung tu dong luu/nap
// da bi BO HOAN TOAN o duoi (xem ghi chu tai noi setForm(emptyDealForm())) -
// no tung khien deal moi bi "an" nham thong tin khach hang cu chua bao gio
// duoc bam luu. clearDealDraft() giu lai (khong xoa) CHI de don rac key cu
// con sot trong trinh duyet cua nguoi dung tu ban truoc, va de khong pha vo
// cac noi da goi ham nay sau moi lan tao deal thanh cong o nhieu file khac.
const CRM_DEAL_DRAFT_KEY = 'crm:deal-draft:v1';

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
  initialContact = null,
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
  /** Prefill + KHOÁ Người liên hệ chính khi mở "Tạo cơ hội" từ Contact 360
   * (contact.customerId + contact.id đã xác định sẵn, khoá cả 2 — không cho
   * đổi sang Customer/Contact khác). CHỈ áp dụng lúc tạo mới. */
  initialContact?: { id: string } | null;
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
        primaryContactId: initialContact?.id || '',
        primaryContactLocked: Boolean(initialContact?.id),
      });
      return;
    }
    // BUG THAT DA GAP (nghiem trong): truoc day o day tu dong nap lai "nhap"
    // tu localStorage (loadDealDraft()) MOI LAN mo form tao moi khong co
    // initialCustomer — nghia la CHI GO CHU (chua bam Luu/Tao deal nao ca)
    // cung tu dong duoc luu thanh "nhap" (xem effect ben duoi da bi xoa) va
    // tu dong dien lai cho lan mo "+ Them deal" TIEP THEO o BAT KY dau (ke ca
    // trang Co hoi toan cuc, khong lien quan khach hang nao), lam ro data
    // (ten/SDT/email/nguoi lien he) cua 1 khach hang cu bi gan nham sang deal
    // moi cua khach khac. Yeu cau nghiep vu ro rang: CHI tinh la du lieu that
    // khi nguoi dung THAT SU bam luu (Tao deal / Luu & them tiep) - khong
    // duoc tu y "nho" bat ky thu gi nguoi dung moi go, chua bam gi ca. Bo hoan
    // toan co che tu luu/tu nap nhap - luon bat dau tu form trang.
    setForm(emptyDealForm());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, open, initialCustomer?.id, initialProject?.id, initialContact?.id]);

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
    if (deal) {
      onUpdate(deal.id, payload);
    } else {
      // BUG THAT DA GAP: nhanh "Tạo deal" (khác "Lưu & thêm tiếp") KHÔNG xoá
      // nháp localStorage sau khi tạo — lần mở "+ Thêm deal" TIẾP THEO (kể cả
      // ở trang Cơ hội toàn cục, không liên quan Customer nào) sẽ tự điền lại
      // NGUYÊN VẸN dữ liệu khách hàng cũ đã tạo xong từ trước, dễ gây nhầm gán
      // deal mới cho sai khách hàng. Xoá nháp ngay khi bấm tạo (modal đường
      // nào cũng đóng theo đúng luồng hiện tại của nút "Tạo deal").
      clearDealDraft();
      onCreate(payload as CreateDealInput);
    }
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
