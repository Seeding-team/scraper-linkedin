'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import type { IssuerCompany, QuoteForm } from '@/modules/quotes';
import { seedingQuoteRepository, TelegramSendButton } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import { buildDealPayload, dealFormFromDeal, emptyDealForm } from '../../components/DealFormFields';
import type { DealFormState } from '../../components/DealFormFields';
import { Building2, CheckCircle2, Loader2, Sparkles, User, X } from '../../components/icons';
import { seedingCrmRepository } from '../../repositories/SeedingCrmRepository';
import type { CreateDealInput, CrmUserOption, Deal } from '../../types';
import { FillQuoteStep } from './FillQuoteStep';
import { IssuerCompanySection } from './IssuerCompanySection';
import { ReviewQuoteStep } from './ReviewQuoteStep';
import { SelectCustomerStep } from './SelectCustomerStep';
import { applyIssuerCompanySnapshot, emptyQuoteDraft, quoteDraftFromExistingQuote, quoteDraftFromForm } from './types';
import type { QuoteDraft } from './types';
import { clearVisibleColumnsDraft } from './quoteColumnsDraft';

type CreateQuoteStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<CreateQuoteStep, string> = {
  1: 'Khách hàng',
  2: 'Đơn vị phát hành',
  3: 'Hạng mục báo giá',
  4: 'Xác nhận',
};

// Nháp wizard tạo báo giá đang tạo (chưa bấm "Tạo báo giá") — cùng quy ước với
// CRM_DEAL_DRAFT_KEY (DealFormModal.tsx): lưu localStorage, đọc/ghi/try-catch
// giống hệt, chỉ xoá sau khi tạo báo giá THÀNH CÔNG. CHỈ áp dụng cho luồng
// "+ Tạo báo giá" tự do (không editQuote/initialDeal/initialQuoteFormId) — các
// luồng có ngữ cảnh sẵn (sửa báo giá, tạo từ 1 deal cụ thể, mở từ mẫu dùng
// nhanh) không cần/không nên tự ý khôi phục nháp cũ đè lên ngữ cảnh đang mở.
const QUOTE_WIZARD_DRAFT_KEY = 'crm:quote-wizard-draft:v1';

interface QuoteWizardDraftShape {
  step: CreateQuoteStep;
  customer: DealFormState;
  quoteDraft: QuoteDraft;
  selectedIssuerCompanyId?: string;
  selectedFormId?: string;
}

function loadQuoteWizardDraft(): QuoteWizardDraftShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(QUOTE_WIZARD_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as QuoteWizardDraftShape) : null;
  } catch {
    return null;
  }
}

function clearQuoteWizardDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(QUOTE_WIZARD_DRAFT_KEY);
}

export function CreateQuoteModal({
  open,
  deals,
  agents = [],
  initialDeal,
  editQuote,
  canApproveQuotes = false,
  initialQuoteFormId,
  onClose,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  deals: Deal[];
  agents?: CrmUserOption[];
  /** Nếu mở từ nút "Tạo báo giá cho deal này" trong chi tiết deal — điền sẵn khách
   * hàng + gắn thẳng deal đó, không cần tìm lại. */
  initialDeal?: Deal | null;
  /** Nếu có — modal mở ở CHẾ ĐỘ SỬA 1 báo giá đã tồn tại (chưa duyệt) thay vì
   * tạo mới. Load đầy đủ dữ liệu đã lưu, không tạo báo giá mới, không đổi mã. */
  editQuote?: Quote | null;
  /** Mở từ 1 card "Mẫu dùng nhanh" — chọn sẵn mẫu này, vẫn qua bước 1 (khách
   * hàng) bình thường rồi nhảy thẳng bước 3, bỏ qua bước 2 (chọn mẫu). Bỏ qua
   * hoàn toàn nếu đang ở chế độ sửa. */
  initialQuoteFormId?: string;
  /** User hiện tại có quyền duyệt báo giá không (admin hoặc can_approve_quotes) -
   * quyết định có hiện nút "Duyệt báo giá" trong chế độ sửa hay không. */
  canApproveQuotes?: boolean;
  onClose: () => void;
  onCreated: (quote: Quote) => void;
  /** Gọi sau khi "Cập nhật báo giá"/"Duyệt báo giá" xong (chỉ chế độ sửa). */
  onUpdated?: (quote: Quote) => void;
}) {
  useBodyScrollLock(open);
  const isEditMode = Boolean(editQuote);
  const [step, setStep] = useState<CreateQuoteStep>(1);
  const [customer, setCustomer] = useState<DealFormState>(emptyDealForm);
  // Co hoi CRM da co san nguoi dung tu chon o Buoc 1 (khoi "Lien ket co hoi
  // CRM" > "Doi co hoi") cho luong bao gia TU DO (khong bi khoa boi
  // initialDeal) - null = chua chon, se tu tao co hoi moi luc luu (hanh vi cu).
  const [manualLinkedDeal, setManualLinkedDeal] = useState<Deal | null>(null);
  const [selectedForm, setSelectedForm] = useState<QuoteForm | null>(null);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft>(emptyQuoteDraft);
  // quoteDraftFromForm() chỉ được gọi 1 LẦN cho mỗi lần tạo mới (khi rời Bước 2
  // "Đơn vị phát hành" lần đầu) — nếu người dùng bấm "Quay lại" rồi "Tiếp theo"
  // lần nữa (vd đổi công ty phát hành), KHÔNG được dựng lại quoteDraft từ đầu vì
  // sẽ xoá mất hạng mục đã chọn ở Bước 3 (vi phạm yêu cầu "giữ dữ liệu khi qua
  // lại giữa các bước"). Reset về false khi đóng modal (resetAndClose).
  const initializedDraftRef = useRef(false);
  // Luồng "+ Tạo báo giá" tự do mới bật nháp tự động lưu - các luồng có ngữ
  // cảnh sẵn (sửa báo giá/tạo cho 1 deal cụ thể/mở từ mẫu dùng nhanh) không nên
  // tự khôi phục nháp cũ đè lên ngữ cảnh đang mở.
  const draftEligible = !editQuote && !initialDeal && !initialQuoteFormId;
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // Nut "Luu nhap" (header) - nhap da tu dong luu san (xem effect autosave
  // ben duoi) nen bam nut nay chi can XAC NHAN LAI thoi diem luu + doi nhan nut
  // sang "Da luu" trong chop nhoang, khong goi API rieng.
  const [draftJustSaved, setDraftJustSaved] = useState(false);
  const modalBodyRef = useRef<HTMLDivElement>(null);
  const restoredDraftRef = useRef(false);

  // Đơn vị phát hành báo giá (bên bán) — dropdown Bước 1. Danh sách công ty +
  // toàn bộ mẫu báo giá (để tìm mẫu mặc định chuẩn khi công ty chưa gán mẫu
  // riêng) fetch 1 lần khi mở modal.
  const [issuerCompanies, setIssuerCompanies] = useState<IssuerCompany[]>([]);
  const [selectedIssuerCompany, setSelectedIssuerCompany] = useState<IssuerCompany | null>(null);
  const [allForms, setAllForms] = useState<QuoteForm[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    seedingQuoteRepository.getIssuerCompanies().then(rows => {
      if (!cancelled) setIssuerCompanies(rows);
    }).catch(() => {});
    seedingQuoteRepository.getForms().then(rows => {
      if (!cancelled) setAllForms(rows);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  // Khoi phuc nhap da luu (localStorage) - chi 1 lan/1 lan mo modal, va chi sau
  // khi da fetch xong issuerCompanies/allForms (can de resolve lai object cong
  // ty/mau tu id da luu). Neu id da luu khong con ton tai (bi xoa khoi danh
  // muc) thi bo qua truong do, khong loi ca nhap.
  useEffect(() => {
    if (!open || !draftEligible || restoredDraftRef.current) return;
    if (!issuerCompanies.length || !allForms.length) return;
    restoredDraftRef.current = true;
    const draft = loadQuoteWizardDraft();
    if (!draft) return;
    if (draft.customer) setCustomer(draft.customer);
    if (draft.quoteDraft) {
      setQuoteDraft(draft.quoteDraft);
      initializedDraftRef.current = true;
    }
    if (draft.selectedIssuerCompanyId) {
      const company = issuerCompanies.find(c => c.id === draft.selectedIssuerCompanyId);
      if (company) setSelectedIssuerCompany(company);
    }
    if (draft.selectedFormId) {
      const form = allForms.find(f => f.id === draft.selectedFormId);
      if (form) setSelectedForm(form);
    }
    if (draft.step) setStep(draft.step);
  }, [open, draftEligible, issuerCompanies, allForms]);

  // Tu dong luu nhap moi khi du lieu doi - cung quy uoc CRM_DEAL_DRAFT_KEY
  // (DealFormModal.tsx): ghi thang, khong debounce, boc try/catch vi
  // localStorage co the day/bi chan.
  useEffect(() => {
    if (!open || !draftEligible) return;
    try {
      window.localStorage.setItem(
        QUOTE_WIZARD_DRAFT_KEY,
        JSON.stringify({
          step,
          customer,
          quoteDraft,
          selectedIssuerCompanyId: selectedIssuerCompany?.id,
          selectedFormId: selectedForm?.id,
        })
      );
      setLastSavedAt(new Date());
    } catch {
      // localStorage day/bi chan - bo qua, khong phai loi nghiem trong.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftEligible, step, customer, quoteDraft, selectedIssuerCompany?.id, selectedForm?.id]);

  // Nut "Luu nhap" tren header - nhap da tu dong luu (effect tren) nen chi can
  // xac nhan lai + doi nhan nut sang "Da luu" 1.5s cho nguoi dung yen tam.
  function handleSaveDraftNow() {
    setLastSavedAt(new Date());
    setDraftJustSaved(true);
    window.setTimeout(() => setDraftJustSaved(false), 1500);
  }

  // Che do sua: gan lai cong ty phat hanh da luu (theo issuerCompanyId) mot khi
  // danh sach cong ty da fetch xong, de Buoc 1 hien dung cong ty dang dung. Ghi
  // de cac field hien thi bang dung SNAPSHOT da luu trong quoteDraft.data (co the
  // khac voi du lieu cong ty hien tai neu ai do da sua danh muc sau khi tao bao
  // gia nay) - chi dung ban ghi cong ty de biet dong nao dang chon trong dropdown.
  useEffect(() => {
    if (!open || !editQuote?.issuerCompanyId || !issuerCompanies.length) return;
    const match = issuerCompanies.find(c => c.id === editQuote.issuerCompanyId);
    if (!match) return;
    setSelectedIssuerCompany({
      ...match,
      legalName: (quoteDraft.data.sellerCompanyName as string) || match.legalName,
      taxCode: (quoteDraft.data.sellerTaxCode as string) || match.taxCode,
      address: (quoteDraft.data.sellerAddress as string) || match.address,
      contactName: (quoteDraft.data.sellerContactName as string) || match.contactName,
      phone: (quoteDraft.data.sellerPhone as string) || match.phone,
      email: (quoteDraft.data.sellerEmail as string) || match.email,
      website: (quoteDraft.data.sellerWebsite as string) || match.website,
      logoUrl: (quoteDraft.data.sellerLogo as string) || match.logoUrl,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editQuote?.issuerCompanyId, issuerCompanies]);
  // Theo dõi ĐÚNG nút nào đang chạy (không dùng 1 boolean chung) - trước đây
  // 1 boolean khiến cả 2 nút "Cập nhật báo giá"/"Duyệt báo giá" cùng xoay
  // spinner dù chỉ bấm 1 nút, nhìn rất kỳ.
  const [submittingAction, setSubmittingAction] = useState<'create' | 'update' | 'approve' | null>(null);
  const submitting = submittingAction !== null;
  const [submitError, setSubmitError] = useState('');

  // Tất cả báo giá thật, tự fetch khi mở modal — dùng cho khối thống kê CRM ở
  // bước 1 (số báo giá/giá trị/đã chốt/tỷ lệ chuyển đổi theo khách hàng).
  const [allQuotes, setAllQuotes] = useState<Quote[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    seedingQuoteRepository.getQuotes().then(rows => {
      if (!cancelled) setAllQuotes(rows);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  // Báo giá vừa tạo xong (draft) — hiện màn "Đã tạo báo giá thành công" thay vì
  // đóng modal ngay. null = chưa tạo/đang ở các bước 1-4.
  const [createdQuote, setCreatedQuote] = useState<Quote | null>(null);
  // Cuon than modal (.crm-modal-body) ve dau moi lan doi buoc/hien man thanh
  // cong - truoc day scrollTop cu bi giu nguyen khi chuyen buoc (vd cuon het
  // Buoc 3 roi bam "Tiep theo" se vao Buoc 4 giua chung, khong thay checklist
  // xac nhan o dau man) - bug thuc te phat hien khi tu kiem tra man hinh.
  useEffect(() => {
    modalBodyRef.current?.scrollTo({ top: 0 });
  }, [step, createdQuote]);
  const [approveError, setApproveError] = useState('');

  // Chế độ sửa: nạp dữ liệu báo giá đã lưu (mẫu + khách hàng liên kết + nội
  // dung) mỗi khi mở modal cho 1 báo giá khác. Không chạy lại khi đóng modal.
  useEffect(() => {
    if (!open || !editQuote) return;
    let cancelled = false;
    setStep(3);
    setQuoteDraft(quoteDraftFromExistingQuote(editQuote));
    seedingQuoteRepository.getForm(editQuote.quoteFormId).then(form => {
      if (!cancelled) setSelectedForm(form);
    }).catch(() => {});
    const linkedDeal = editQuote.dealId ? deals.find(d => d.id === editQuote.dealId) : undefined;
    if (linkedDeal) {
      setCustomer(dealFormFromDeal(linkedDeal));
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editQuote?.id]);

  // Mở từ "Mẫu dùng nhanh" — chỉ lưu mẫu vào initialForm, KHÔNG set thẳng
  // selectedForm nữa. Mẫu này chỉ thực sự được dùng nếu đúng công ty phát hành
  // sẽ chọn ở Bước 1 (xem effect chọn mẫu theo công ty bên dưới) - nếu người
  // dùng chọn công ty KHÁC công ty sở hữu mẫu này thì bỏ qua, không âm thầm
  // dùng nhầm mẫu của công ty khác.
  const [initialForm, setInitialForm] = useState<QuoteForm | null>(null);
  useEffect(() => {
    if (!open || editQuote || !initialQuoteFormId) return;
    let cancelled = false;
    seedingQuoteRepository.getForm(initialQuoteFormId).then(form => {
      if (!cancelled) setInitialForm(form);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, editQuote, initialQuoteFormId]);

  // Mau bao gia thuoc dung cong ty phat hanh dang chon - loc tu allForms.
  const companyForms = useMemo(
    () => (selectedIssuerCompany ? allForms.filter(f => f.issuerCompanyId === selectedIssuerCompany.id) : []),
    [allForms, selectedIssuerCompany]
  );

  // Tu chon mau theo dung thu tu uu tien: initialQuoteFormId (neu dung cong ty)
  // -> mau mac dinh cua cong ty -> mau dau tien cua cong ty -> Mau bao gia
  // chuan toan he thong. Chay lai MOI KHI doi cong ty (id doi) - reset lua chon
  // mau cu, nap lai danh sach mau cua cong ty moi, dung y "khong duoc am tham
  // dung nham mau cong ty khac".
  useEffect(() => {
    if (!open || isEditMode || !selectedIssuerCompany) return;
    const companyId = selectedIssuerCompany.id;
    const scopedForms = allForms.filter(f => f.issuerCompanyId === companyId);
    const globalDefault = allForms.find(f => f.isDefaultTemplate) || null;
    let resolved: QuoteForm | null = null;
    if (initialForm && initialForm.issuerCompanyId === companyId) {
      resolved = initialForm;
    } else if (scopedForms.length === 1) {
      resolved = scopedForms[0];
    } else if (scopedForms.length > 1) {
      resolved = scopedForms.find(f => f.id === selectedIssuerCompany.defaultQuoteFormId) || scopedForms[0];
    } else {
      resolved = globalDefault;
    }
    setSelectedForm(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditMode, selectedIssuerCompany?.id, allForms, initialForm]);

  function resetAndClose() {
    if (submitting) return;
    setStep(1);
    setCustomer(emptyDealForm());
    setManualLinkedDeal(null);
    setSelectedForm(null);
    setSelectedIssuerCompany(null);
    setQuoteDraft(emptyQuoteDraft());
    setSubmitError('');
    setCreatedQuote(null);
    setApproveError('');
    initializedDraftRef.current = false;
    restoredDraftRef.current = false;
    setLastSavedAt(null);
    onClose();
  }

  if (!open) return null;

  // Chế độ sửa: khách hàng lấy từ deal đã gắn sẵn với báo giá này (nếu có) -
  // step 1 chỉ để XEM, không có chỗ nào lưu lại thay đổi customer khi bấm Cập
  // nhật/Duyệt (update_quote không có field đổi deal_id), nên khoá luôn giống
  // initialDeal để tránh gây hiểu nhầm là sửa được.
  const editLinkedDeal = isEditMode && editQuote?.dealId ? deals.find(d => d.id === editQuote.dealId) : undefined;
  const lockedDealForStep1 = editLinkedDeal || initialDeal;

  const activeCustomer =
    lockedDealForStep1 && !customer.customerName.trim()
      ? { ...customer, customerName: lockedDealForStep1.customerName, companyName: lockedDealForStep1.companyName || '', phone: lockedDealForStep1.phone || '', email: lockedDealForStep1.email || '', address: lockedDealForStep1.address || '' }
      : customer;
  // Gan deal co san khi mo tu "Tao bao gia cho deal nay" (initialDeal co
  // dinh), HOAC khi nguoi dung tu chon 1 co hoi co san qua "Doi co hoi" (Buoc
  // 1) trong luong tu do - khong chon gi thi van tu tao deal moi o buoc submit
  // nhu truoc (khong doi hanh vi mac dinh).
  const activeLinkedDealId = initialDeal?.id || manualLinkedDeal?.id || '';

  // Gia tri tom tat dung o Buoc 3 (2 the recap "Khach hang"/"Don vi phat
  // hanh") va Buoc 5 (checklist xac nhan) - tinh 1 lan dung chung 2 noi, tranh
  // lech chu neu sua rieng tung cho.
  const customerRecapValue = [activeCustomer.companyName, activeCustomer.customerName].filter(Boolean).join(' · ') || 'Chưa nhập';
  const issuerRecapValue = selectedIssuerCompany
    ? [selectedIssuerCompany.brandName || selectedIssuerCompany.legalName, selectedForm?.name].filter(Boolean).join(' · ')
    : 'Chưa chọn';

  // Buoc 1 "Khach hang" - Tiep theo: chi con validate + luu ten khach, KHONG
  // dong gi lien quan don vi phat hanh nua (da tach rieng sang Buoc 2).
  function handleCustomerNext() {
    setSubmitError('');
    if (!activeCustomer.customerName.trim()) {
      window.alert('Vui lòng nhập tên khách hàng.');
      return;
    }
    setCustomer(activeCustomer);
    setStep(2);
  }

  // Buoc 2 "Don vi phat hanh" - Tiep theo: validate da chon cong ty, roi dung
  // mau da tu resolve theo cong ty (effect rieng o tren). quoteDraftFromForm()
  // CHI goi 1 LAN DAU tao moi (initializedDraftRef) - neu nguoi dung quay lai
  // buoc nay roi bam Tiep theo lan nua (vd doi cong ty phat hanh sau khi da
  // chon vai hang muc o Buoc 3), CHI ghi de lai snapshot thong tin cong ty vao
  // quoteDraft.data, KHONG dung lai tu dau (se mat het hang muc da chon).
  function handleIssuerNext() {
    setSubmitError('');
    if (!selectedIssuerCompany) {
      window.alert('Vui lòng chọn công ty báo giá (đơn vị phát hành).');
      return;
    }

    if (isEditMode) {
      // Che do sua: KHONG doi mau (backend chua ho tro doi quote_form_id/
      // form_snapshot sau khi da tao) - selectedForm da duoc nap san o effect
      // rieng, chi can ghi lai snapshot cong ty neu nguoi dung co sua.
      setQuoteDraft(current => {
        const nextData = { ...current.data };
        applyIssuerCompanySnapshot(nextData, selectedIssuerCompany);
        return { ...current, data: nextData };
      });
      setStep(3);
      return;
    }

    // selectedForm da duoc tu chon ngam theo dung cong ty (xem effect resolve
    // mau theo cong ty o tren) - o day chi con validate, khong tu resolve lai.
    if (!selectedForm) {
      setSubmitError('Chưa cấu hình mẫu báo giá mặc định — liên hệ admin.');
      return;
    }

    if (!initializedDraftRef.current) {
      setQuoteDraft(quoteDraftFromForm(selectedForm, activeCustomer, selectedIssuerCompany));
      initializedDraftRef.current = true;
    } else {
      setQuoteDraft(current => {
        const nextData = { ...current.data };
        applyIssuerCompanySnapshot(nextData, selectedIssuerCompany);
        return { ...current, data: nextData };
      });
    }
    setStep(3);
  }

  function buildDraftPayload() {
    const isVilla = selectedForm?.schemaJson.layoutType === 'villa_solution_package';
    // Loc bo khoi noi dung tu do RONG (tieu de/noi dung deu trim rong) CHI o day
    // (luc luu that su) - khong loc ngay trong CustomBlocksEditor's onChange, vi
    // khoi vua bam "+ Them noi dung" chua kip go gi se bi coi la rong va bien mat
    // truoc khi Sale kip nhap.
    const customBlocks = (quoteDraft.data.customBlocks || []).filter(
      block => block.title.trim() || block.content.trim()
    );
    const data = { ...quoteDraft.data, customBlocks };
    return {
      data: isVilla ? { ...data, solutionItems: quoteDraft.solutionItems } : data,
      items: isVilla ? [] : quoteDraft.items,
    };
  }

  async function handleSubmit() {
    if (!selectedForm) return;
    setSubmittingAction('create');
    setSubmitError('');
    let createdQuoteId: string | null = null;
    let createdDealId: string | null = null;
    try {
      let dealId = activeLinkedDealId;
      if (!dealId) {
        // Không gắn vào deal có sẵn nào (khách hoàn toàn mới, hoặc bỏ trống ô
        // "Gắn vào Deal") — tự tạo deal mới ở "Khách mới" cho khách này, không
        // thì báo giá tạo xong không có chỗ nào trên pipeline để theo dõi tiếp.
        const newDeal = await seedingCrmRepository.createDeal(
          buildDealPayload(activeCustomer, agents) as CreateDealInput
        );
        dealId = newDeal.id;
        createdDealId = newDeal.id;
      }
      // Chi tao bao gia (luon ra status='draft', chua co link public) - KHONG
      // con tu dong "publish/approve" ngay sau khi tao nua. Duyet la 1 hanh
      // dong rieng, co kiem tra quyen (xem handleApprove).
      const quote = await seedingQuoteRepository.createQuote({
        quoteFormId: selectedForm.id,
        dealId,
        issuerCompanyId: selectedIssuerCompany?.id,
        ...buildDraftPayload(),
      });
      createdQuoteId = quote.id;
      onCreated(quote);
      // Tao thanh cong - xoa nhap "Cot hien thi" cua mau nay (khong con la ban
      // "dang tao" nua, bao gia that da luu voi visibleColumns rieng cua no).
      clearVisibleColumnsDraft(selectedForm.id);
      // Khong dong modal ngay - hien man "Da tao bao gia thanh cong" (bao gia
      // van la draft, chua co public link cho toi khi duyet - xem handleApproveNow).
      setCreatedQuote(quote);
      if (draftEligible) clearQuoteWizardDraft();
    } catch (err) {
      if (createdQuoteId) await seedingQuoteRepository.deleteQuote(createdQuoteId).catch(() => {});
      if (createdDealId) await seedingCrmRepository.deleteDeal(createdDealId).catch(() => {});
      setSubmitError(err instanceof Error ? err.message : 'Không thể tạo báo giá.');
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleUpdate() {
    if (!editQuote) return;
    setSubmittingAction('update');
    setSubmitError('');
    try {
      const updated = await seedingQuoteRepository.updateQuote(editQuote.id, {
        ...buildDraftPayload(),
        issuerCompanyId: selectedIssuerCompany?.id,
      });
      onUpdated?.(updated);
      if (selectedForm) clearVisibleColumnsDraft(selectedForm.id);
      resetAndClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Không thể cập nhật báo giá.');
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleApprove() {
    if (!editQuote) return;
    if (!window.confirm('Sau khi duyệt, báo giá sẽ bị khóa và không thể chỉnh sửa. Bạn có chắc chắn muốn duyệt không?')) return;
    setSubmittingAction('approve');
    setSubmitError('');
    try {
      // Luu thay doi cuoi + duyet ATOMIC trong 1 request (khong tach 2 lenh
      // rieng - tranh nua voi khi 1 trong 2 buoc loi).
      const approved = await seedingQuoteRepository.updateAndApproveQuote(editQuote.id, {
        ...buildDraftPayload(),
        issuerCompanyId: selectedIssuerCompany?.id,
      });
      onUpdated?.(approved);
      if (selectedForm) clearVisibleColumnsDraft(selectedForm.id);
      resetAndClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Không thể duyệt báo giá.');
    } finally {
      setSubmittingAction(null);
    }
  }

  /** Nút "Duyệt ngay" trên màn "Đã tạo báo giá thành công" - duyệt NGAY báo
   * giá vừa tạo (còn nguyên draft, không có thay đổi chưa lưu vì vừa submit
   * xong nên chỉ cần approveQuote thường, không cần update+approve gộp). Lỗi
   * thì giữ nguyên trạng thái draft, không tự chuyển sang "đã duyệt" khi chưa
   * chắc chắn. Sau khi duyệt xong mà response thiếu publicUrl thì refetch lại
   * bản đầy đủ - không bao giờ bật nút public bằng dữ liệu rỗng/suy đoán. */
  async function handleApproveNow() {
    if (!createdQuote) return;
    setSubmittingAction('approve');
    setApproveError('');
    try {
      let approved = await seedingQuoteRepository.approveQuote(createdQuote.id);
      if (!approved.publicUrl) {
        approved = await seedingQuoteRepository.getQuote(createdQuote.id);
      }
      setCreatedQuote(approved);
      onUpdated?.(approved);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Không thể duyệt báo giá.');
    } finally {
      setSubmittingAction(null);
    }
  }

  return (
    <div className="crm-modal-backdrop" onClick={resetAndClose}>
      <div className="crm-modal crm-wizard-modal" onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header">
          <div>
            <h2 className="crm-modal-title">
              {!createdQuote && !isEditMode ? <Sparkles className="crm-icon crm-quote-title-sparkle" /> : null}
              {createdQuote ? 'Đã tạo báo giá thành công' : isEditMode ? `Sửa báo giá ${editQuote?.quoteNumber || ''}` : 'Tạo báo giá nhanh'}
            </h2>
            <p className="crm-modal-subtitle">
              {createdQuote
                ? `Báo giá ${createdQuote.quoteNumber} đã được lưu.`
                : isEditMode
                  ? 'Chỉnh sửa nội dung — chưa duyệt thì còn sửa được không giới hạn.'
                  : 'Điền hạng mục trước, các thông tin còn lại đã được tối ưu mặc định.'}
            </p>
          </div>
          <div className="crm-modal-header-actions">
            {!createdQuote && draftEligible ? (
              <button type="button" className="crm-secondary-inline crm-quote-save-draft-button" onClick={handleSaveDraftNow}>
                {draftJustSaved ? '✓ Đã lưu' : 'Lưu nháp'}
              </button>
            ) : null}
            <button type="button" className="crm-modal-close" onClick={resetAndClose} aria-label="Đóng" disabled={submitting}>
              <X className="crm-icon" />
            </button>
          </div>
        </header>

        {createdQuote ? null : (
          <div className="crm-wizard-stepper-container">
            <div className="crm-wizard-stepper-inner">
              {([1, 2, 3, 4] as CreateQuoteStep[]).map((item, index) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center' }}>
                  <div
                    className={`crm-wizard-step-item ${item === step ? 'crm-wizard-step-item--active' : ''} ${item < step ? 'crm-wizard-step-item--done' : ''}`}
                    onClick={() => item < step && setStep(item)}
                  >
                    <div className="crm-wizard-step-circle">
                      {item < step ? <CheckCircle2 className="w-3 h-3" /> : <span>{item}</span>}
                    </div>
                    <span className="crm-wizard-step-label">{STEP_LABELS[item]}</span>
                  </div>
                  {index < 3 ? (
                    <div className={`crm-wizard-step-line ${item < step ? 'crm-wizard-step-line--done' : ''}`} />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="crm-modal-body crm-wizard-body" ref={modalBodyRef}>
          <div className="crm-wizard-content">
            {createdQuote ? (
              <QuoteSuccessPanel
                quote={createdQuote}
                canApprove={canApproveQuotes}
                approving={submittingAction === 'approve'}
                approveError={approveError}
                customerEmail={activeCustomer.email}
                onApproveNow={() => void handleApproveNow()}
              />
            ) : (
              <>
                {step === 1 ? (
                  <div className="crm-wizard-step1-layout">
                    <SelectCustomerStep
                      deals={deals}
                      customer={activeCustomer}
                      onChangeCustomer={setCustomer}
                      lockedDeal={lockedDealForStep1}
                      quotes={allQuotes}
                      agents={agents}
                      linkedDeal={manualLinkedDeal}
                      onChangeLinkedDeal={setManualLinkedDeal}
                    />
                  </div>
                ) : null}
                {step === 2 ? (
                  <div className="crm-wizard-step1-layout">
                    <IssuerCompanySection
                      companies={issuerCompanies}
                      selected={selectedIssuerCompany}
                      onSelect={setSelectedIssuerCompany}
                      companyForms={companyForms}
                      selectedFormId={selectedForm?.id}
                      onSelectForm={formId => setSelectedForm(companyForms.find(f => f.id === formId) || null)}
                    />
                    <p className="crm-wizard-step1-hint">
                      Chọn công ty sẽ tự điền logo, thông tin pháp lý và mẫu báo giá mặc định của công ty đó — vẫn có thể sửa riêng cho báo giá này.
                    </p>
                  </div>
                ) : null}
                {step === 3 && selectedForm ? (
                  <>
                    <div className="crm-quote-recap-row">
                      <RecapCard icon={<User className="crm-icon" />} label="Khách hàng" value={customerRecapValue} onChange={() => setStep(1)} />
                      <RecapCard icon={<Building2 className="crm-icon" />} label="Đơn vị phát hành" value={issuerRecapValue} onChange={() => setStep(2)} />
                    </div>
                    <FillQuoteStep
                      schema={selectedForm.schemaJson}
                      value={quoteDraft}
                      onChange={setQuoteDraft}
                      quoteFormId={selectedForm.id}
                      section="combined"
                    />
                  </>
                ) : null}
                {step === 3 && !selectedForm && isEditMode ? (
                  // Dang cho getForm() tai xong (che do sua) - giu 1 khoi placeholder
                  // co chieu cao thay vi de trong, tranh modal "giat" phinh to dot
                  // ngot khi form load xong.
                  <div className="crm-wizard-loading-placeholder">Đang tải báo giá...</div>
                ) : null}
                {step === 4 && selectedForm ? (
                  <>
                    <ConfirmChecklist
                      customerValue={customerRecapValue}
                      issuerValue={issuerRecapValue}
                      itemCount={selectedForm.schemaJson.layoutType === 'villa_solution_package' ? quoteDraft.solutionItems.length : quoteDraft.items.length}
                      notes={typeof quoteDraft.data.notes === 'string' ? quoteDraft.data.notes : ''}
                    />
                    <ReviewQuoteStep
                      schema={selectedForm.schemaJson}
                      draft={quoteDraft}
                      onChange={setQuoteDraft}
                      quoteFormId={selectedForm.id}
                    />
                  </>
                ) : null}
                {submitError ? <p className="crm-error">{submitError}</p> : null}
              </>
            )}
          </div>
        </div>

        <footer className="crm-modal-footer">
          {createdQuote ? (
            <div className="crm-footer-right" style={{ marginLeft: 'auto' }}>
              <button type="button" className="crm-save-button crm-save-button--large" onClick={resetAndClose}>
                Đóng
              </button>
            </div>
          ) : (
            <>
              <div className="crm-footer-left">
                <button type="button" className="crm-cancel-button" onClick={resetAndClose} disabled={submitting}>
                  Hủy
                </button>
              </div>
              {draftEligible ? (
                <div className="crm-footer-center crm-quote-autosave-indicator">
                  {lastSavedAt
                    ? `✓ Đã tự động lưu ${lastSavedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </div>
              ) : null}
              <div className="crm-footer-right">
                {step > 1 ? (
                  <button
                    type="button"
                    className="crm-cancel-button"
                    disabled={submitting}
                    onClick={() => setStep(current => (current - 1) as CreateQuoteStep)}
                  >
                    Quay lại
                  </button>
                ) : null}
                {step === 1 ? (
                  <button type="button" className="crm-save-button" onClick={handleCustomerNext}>
                    Tiếp theo →
                  </button>
                ) : null}
                {step === 2 ? (
                  <button type="button" className="crm-save-button" onClick={handleIssuerNext}>
                    Tiếp theo →
                  </button>
                ) : null}
                {step === 3 ? (
                  <button type="button" className="crm-save-button" onClick={() => setStep(4)}>
                    Tiếp theo →
                  </button>
                ) : null}
                {step === 4 && !isEditMode ? (
                  <button type="button" className="crm-save-button crm-save-button--large" disabled={submitting} onClick={() => void handleSubmit()}>
                    {submittingAction === 'create' ? <Loader2 className="crm-save-spinner" /> : null}
                    {submittingAction === 'create' ? 'Đang tạo...' : 'Tạo báo giá'}
                  </button>
                ) : null}
                {step === 4 && isEditMode ? (
                  <>
                    <button type="button" className="crm-save-button crm-save-button--update" disabled={submitting} onClick={() => void handleUpdate()}>
                      {submittingAction === 'update' ? <Loader2 className="crm-save-spinner" /> : null}
                      Cập nhật báo giá
                    </button>
                    {canApproveQuotes ? (
                      <button type="button" className="crm-save-button crm-save-button--large crm-save-button--approve" disabled={submitting} onClick={() => void handleApprove()}>
                        {submittingAction === 'approve' ? <Loader2 className="crm-save-spinner" /> : null}
                        Duyệt báo giá
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The nho o dau Buoc 3 "Hang muc bao gia" - nhac lai khach hang/don vi phat
 * hanh da chon o Buoc 1/2, kem link "Thay doi" nhay thang ve dung buoc do
 * (khong mat du lieu dang nhap o Buoc 3 vi quoteDraft khong bi dong lai). */
function RecapCard({
  icon,
  label,
  value,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: () => void;
}) {
  return (
    <div className="crm-quote-recap-card">
      <span className="crm-quote-recap-icon">{icon}</span>
      <div className="crm-quote-recap-body">
        <span className="crm-quote-recap-label">{label}</span>
        <strong className="crm-quote-recap-value">{value}</strong>
      </div>
      <button type="button" className="crm-secondary-inline" onClick={onChange}>
        Thay đổi
      </button>
    </div>
  );
}

/** Buoc 4 "Xac nhan" - checklist tom tat nhung gi da xac nhan truoc khi tao
 * bao gia (mo rong tu recap Buoc 3 them dong Hang muc & Ghi chu) - thuan hien
 * thi, khong co hanh dong sua (sua thi bam "Quay lai" dung nut co san). */
function ConfirmChecklist({
  customerValue,
  issuerValue,
  itemCount,
  notes,
}: {
  customerValue: string;
  issuerValue: string;
  itemCount: number;
  notes: string;
}) {
  return (
    <div className="crm-quote-confirm-checklist">
      <div className="crm-quote-confirm-row">
        <CheckCircle2 className="crm-icon crm-quote-confirm-check" />
        <span>Khách hàng: <b>{customerValue}</b></span>
      </div>
      <div className="crm-quote-confirm-row">
        <CheckCircle2 className="crm-icon crm-quote-confirm-check" />
        <span>Đơn vị phát hành: <b>{issuerValue}</b></span>
      </div>
      <div className="crm-quote-confirm-row">
        <CheckCircle2 className="crm-icon crm-quote-confirm-check" />
        <span>Hạng mục & tổng tiền: <b>{itemCount} hạng mục</b></span>
      </div>
      <div className="crm-quote-confirm-row">
        <CheckCircle2 className="crm-icon crm-quote-confirm-check" />
        <span>Ghi chú/điều khoản: <b>{notes.trim() ? 'Đã nhập' : 'Chưa nhập (không bắt buộc)'}</b></span>
      </div>
    </div>
  );
}

function QuoteSuccessPanel({
  quote,
  canApprove,
  approving,
  approveError,
  customerEmail,
  onApproveNow,
}: {
  quote: Quote;
  canApprove: boolean;
  approving: boolean;
  approveError: string;
  customerEmail?: string;
  onApproveNow: () => void;
}) {
  const isApproved = quote.status === 'approved' && Boolean(quote.publicUrl);
  const publicFullUrl = quote.publicUrl && typeof window !== 'undefined' ? `${window.location.origin}${quote.publicUrl}` : '';

  async function copyLink() {
    if (!publicFullUrl) return;
    await navigator.clipboard.writeText(publicFullUrl);
  }
  function openPdf() {
    if (!publicFullUrl) return;
    window.open(`${publicFullUrl}?print=true`, '_blank', 'noopener');
  }
  const mailtoHref = publicFullUrl
    ? `mailto:${customerEmail || ''}?subject=${encodeURIComponent(`Báo giá ${quote.quoteNumber}`)}&body=${encodeURIComponent(`Kính gửi Quý khách,\n\nMời Quý khách xem báo giá tại: ${publicFullUrl}\n\nTrân trọng.`)}`
    : undefined;

  return (
    <div className="crm-quote-success-panel">
      <div className="crm-quote-success-icon">
        <CheckCircle2 className="w-6 h-6" />
      </div>
      <p className="crm-quote-success-status">
        {isApproved
          ? 'Báo giá đã được duyệt — khách hàng có thể xem link công khai.'
          : 'Báo giá đang ở trạng thái chờ duyệt — link công khai chỉ có sau khi được duyệt.'}
      </p>

      {!isApproved && canApprove ? (
        <button type="button" className="crm-save-button crm-save-button--approve" disabled={approving} onClick={onApproveNow}>
          {approving ? <Loader2 className="crm-save-spinner" /> : null}
          {approving ? 'Đang duyệt...' : 'Duyệt ngay'}
        </button>
      ) : null}
      {approveError ? <p className="crm-error">{approveError}</p> : null}

      <div className="crm-quote-success-actions">
        <button type="button" className="crm-cancel-button" disabled={!isApproved} onClick={() => void copyLink()}>
          Sao chép link
        </button>
        <button type="button" className="crm-cancel-button" disabled={!isApproved} onClick={openPdf}>
          Tải PDF
        </button>
        <a
          className={`crm-cancel-button ${!isApproved ? 'crm-cancel-button--disabled' : ''}`}
          href={isApproved ? mailtoHref : undefined}
          aria-disabled={!isApproved}
          onClick={event => {
            if (!isApproved) event.preventDefault();
          }}
        >
          Gửi email khách hàng
        </a>
        <TelegramSendButton quoteId={quote.id} status={quote.status} className="crm-cancel-button" />
      </div>
      {!isApproved ? <small className="crm-quote-success-hint">Chỉ dùng được sau khi báo giá được duyệt.</small> : null}
    </div>
  );
}
