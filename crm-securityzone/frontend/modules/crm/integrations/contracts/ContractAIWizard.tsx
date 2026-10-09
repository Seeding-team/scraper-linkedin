'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { customerLeadService } from '@/services/customer-lead.service';
import type { Customer } from '@/services/customer-lead.service';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import { seedingContractRepository } from '@/modules/contracts/repositories/SeedingContractRepository';
import { extractPaymentTermsFromClauses } from '@/modules/contracts/constants/contractConfig';
import type { ContractClause } from '@/modules/contracts/types';
import { seedingContractTemplateRepository } from '@/modules/contract-templates';
import type { ContractTemplate } from '@/modules/contract-templates';
import { ContractTemplateLibrary } from '@/modules/contract-templates/components/ContractTemplateLibrary';
import { formatVnd } from '@/modules/quotes/utils/quoteCalculations';
import { formatQuoteAmountOr, quoteCurrencyToVnd } from '@/lib/currency';
import { DEAL_STAGE_META } from '../../constants/crmConfig';
import type { DealStage } from '../../types';
import { SearchableSelect } from '../../components/SearchableSelect';
import { PrecheckPanel, ClauseAiEditPanel, IssuerSummaryLine, LegalInfoEditor, TemplateParagraphEditor } from './ContractCopilotParts';
import type { LegalInfoSave } from './ContractCopilotParts';
import type { EditHistoryItem } from './ContractCopilotParts';
import { TemplatePreviewPanel } from './TemplatePreviewPanel';
import {
  analyzeDraftRisk, base64ToBlob, docxFromClauses, extractReference, fetchVersionBlob, getContractReadiness, getNumberSettings, getVersionParagraphs, listContractTypes,
  listContractVersionsFull, precheckContract, renderTemplate, runVersionRisk, saveBlobAs, saveContractVersionFull, suggestContractType,
} from '@/modules/contracts/repositories/contractDocs';
import type { ApplyParagraphResult, DocVersion, LegalOverrideInput, NumberSettings, PrecheckResult, Readiness, RepresentativeOverrideInput, TemplateRenderResult, TypeSuggestion, VersionRisk } from '@/modules/contracts/repositories/contractDocs';
import '../../styles/copilot.css';

type Step = 1 | 2 | 3;
type Tab3 = 'preview' | 'edit' | 'risk' | 'versions';

const CLOSED_QUOTE_STATUSES = new Set(['approved', 'confirmed']);
const CHIPS: Array<{ label: string; text: string }> = [
  { label: 'Thanh toán', text: 'Thanh toán: ' },
  { label: 'Bảo hành', text: 'Bảo hành: ' },
  { label: 'Tiến độ', text: 'Tiến độ triển khai: ' },
  { label: 'Nghiệm thu', text: 'Nghiệm thu: ' },
  { label: 'Trách nhiệm', text: 'Trách nhiệm hai bên: ' },
  { label: 'Khác', text: 'Yêu cầu khác: ' },
];

const STEP_TITLES: Record<Step, { title: string; sub: string }> = {
  1: { title: 'Thông tin & nguồn hợp đồng', sub: 'Chọn báo giá, mẫu (nếu có) và loại hợp đồng. AI sẽ gợi ý loại phù hợp.' },
  2: { title: 'Nhập yêu cầu và điều kiện hợp đồng', sub: 'Mô tả yêu cầu, điều khoản đặc biệt hoặc chọn các gợi ý nhanh.' },
  3: { title: 'Xem trước & hoàn thiện', sub: 'Đúng file PDF sẽ xuất. Chỉnh từng điều khoản, kiểm tra rủi ro, lưu phiên bản và gửi duyệt.' },
};

function fmtMoney(v: number | null | undefined, currency?: string) {
  return formatQuoteAmountOr(v ?? 0, currency, formatVnd);
}

export function ContractAIWizard({
  open, onClose, onCreated, defaultCustomerId, customerNameHint, editVersion, openToClause,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (contractId: string) => void;
  /** Mở từ Customer 360: khóa đúng khách hàng đang xem. */
  defaultCustomerId?: string;
  customerNameHint?: string;
  /** Giữ để tương thích chỗ gọi cũ; luồng AI nay luôn là luồng thật. */
  uiOnly?: boolean;
  /** Mở THẲNG Bước 3 với đúng nội dung 1 phiên bản ĐÃ LƯU để sửa (thay vì tạo mới) - "Sửa nội dung" ở trang chi tiết
   * hợp đồng dùng cờ này để tái sử dụng NGUYÊN popup/Bước 3 "Xem trước & hoàn thiện" thay vì 1 editor riêng. Lưu sau
   * đó tự tạo PHIÊN BẢN MỚI cho ĐÚNG hợp đồng này (nhờ `saved` được nạp sẵn id/version - xem saveDraft()). */
  editVersion?: { contractId: string; version: number; contractNumber: string; dealId?: string; quoteId?: string; customerId?: string };
  /** Dùng CÙNG editVersion - mở xong thì nhảy thẳng tab Chỉnh sửa, tự mở đúng mục (Legal Check "Xem & xử lý" bấm từ
   * trang Chi tiết hợp đồng, nơi chưa có sẵn state `draftRisk` của wizard, nên truyền tiêu đề điều khoản qua prop này). */
  openToClause?: string;
}) {
  const [step, setStep] = useState<Step>(1);
  // ── Bước 1: nguồn ──
  const [allDeals, setAllDeals] = useState<Customer[]>([]);
  const [loadingSource, setLoadingSource] = useState(false);
  const [customerKey, setCustomerKey] = useState('');
  const [dealId, setDealId] = useState('');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteId, setQuoteId] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [typeText, setTypeText] = useState('');
  const [typeConfirmed, setTypeConfirmed] = useState(false);
  const [suggestion, setSuggestion] = useState<TypeSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateFile, setTemplateFile] = useState<{ name: string; size: number; file?: File } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [referenceText, setReferenceText] = useState('');
  const [referenceNote, setReferenceNote] = useState('');
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(false);
  const [ack, setAck] = useState(false);
  // "Bổ sung tại chỗ" Bên A (xem LegalInfoEditor) - giữ nguyên lựa chọn khi precheck chạy lại, không mất khi đổi tab.
  const [contactId, setContactId] = useState<string | null>(null);
  const [representative, setRepresentative] = useState<RepresentativeOverrideInput | null>(null);
  const [legalOverrides, setLegalOverrides] = useState<LegalOverrideInput | null>(null);
  const [saveOverridesToCrm, setSaveOverridesToCrm] = useState(false);
  // ── Bước 2: yêu cầu ──
  const [prompt, setPrompt] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detailLevel, setDetailLevel] = useState('standard');
  const [language, setLanguage] = useState('Tiếng Việt');
  const [style, setStyle] = useState('Chính thức');
  const [direction, setDirection] = useState<'sell' | 'buy'>('sell');
  const [shortName, setShortName] = useState('');
  const [numberInfo, setNumberInfo] = useState<NumberSettings | null>(null);
  // ── Bước 3: bản nháp ──
  const [mode, setMode] = useState<'template' | 'clauses'>('clauses');
  const [generating, setGenerating] = useState(false);
  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [tplResult, setTplResult] = useState<TemplateRenderResult | null>(null);
  const [docx, setDocx] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [originalPdfUrl, setOriginalPdfUrl] = useState<string | null>(null);
  const [pdfInfo, setPdfInfo] = useState<{ pages: number | null; error: string | null; warnings: string[] }>({ pages: null, error: null, warnings: [] });
  const [dirtyClauses, setDirtyClauses] = useState(false);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [tab, setTab] = useState<Tab3>('preview');
  const [clauseEditIndex, setClauseEditIndex] = useState<number | null>(null);
  const [jumpToClause, setJumpToClause] = useState<string | null>(null);
  const [jumpFinding, setJumpFinding] = useState<{ title: string; detail: string } | null>(null);
  const [draftRisk, setDraftRisk] = useState<VersionRisk | null>(null);
  const [riskBusy, setRiskBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; number: string; version: number } | null>(null);
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [approvalMsg, setApprovalMsg] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const saveKeyRef = useRef('');
  // Nội dung tài liệu đã đổi kể từ lần lưu gần nhất? (gửi duyệt KHÔNG được tạo phiên bản trùng khi chưa có thay đổi)
  const dirtySinceSaveRef = useRef(true);
  const pdfUrlRef = useRef<string | null>(null);
  const originalUrlRef = useRef<string | null>(null);
  const defaultAppliedRef = useRef(false);
  const editSeededRef = useRef(false);

  const crmCustomerId = customerKey && !customerKey.startsWith('deal:') ? customerKey : undefined;

  // ───────── editVersion: mở thẳng Bước 3 với 1 phiên bản ĐÃ LƯU để sửa ─────────
  // Khóa khách hàng giống hệt defaultCustomerId (dùng lại effect/logic sẵn có - không viết lại).
  useEffect(() => {
    if (!open || !editVersion) return;
    if (editVersion.customerId && !customerKey) setCustomerKey(editVersion.customerId);
  }, [open, editVersion, customerKey]);
  // Nội dung tài liệu (docx/pdf/paragraphs) + đánh dấu "đã lưu" (saved) chỉ cần nạp 1 LẦN khi mở - không phụ thuộc
  // deal/báo giá nạp xong hay chưa, nên tách effect riêng, có cờ chống chạy lại nhiều lần trong cùng 1 lần mở popup.
  useEffect(() => {
    if (!open || !editVersion) { editSeededRef.current = false; return; }
    if (editSeededRef.current) return;
    editSeededRef.current = true;
    let alive = true;
    (async () => {
      try {
        const [p, pdfBlob] = await Promise.all([
          getVersionParagraphs(editVersion.contractId, editVersion.version),
          fetchVersionBlob(editVersion.contractId, editVersion.version, 'pdf').catch(() => null),
        ]);
        if (!alive) return;
        setStep(3); setMode('template');
        if (openToClause) { setTab('edit'); setJumpToClause(openToClause); } else { setTab('preview'); }
        setDocx(p.docxBase64);
        setSaved({ id: editVersion.contractId, number: editVersion.contractNumber, version: editVersion.version });
        setTplResult({
          mode: 'template-docx', layoutPreserved: true, docxBase64: p.docxBase64, pdfBase64: null, pdfError: null,
          originalPdfBase64: null, pages: null, originalPages: null, edits: [], rejectedEdits: [], missingPlaceholders: [],
          itemsTable: { filled: false, rows: 0, warnings: [], candidates: [] }, partyTables: { filled: [], unresolvedTables: 0 },
          structure: { preserved: true, differences: [], rowCountChanged: [] }, fonts: { missing: [], metricCompatible: [] },
          warnings: [], paragraphs: p.paragraphs,
        });
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = pdfBlob ? URL.createObjectURL(pdfBlob) : null;
        setPdfUrl(pdfUrlRef.current);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Không nạp được phiên bản để sửa.');
      }
    })();
    return () => { alive = false; };
  }, [open, editVersion]);

  // ───────── nạp dữ liệu nguồn ─────────
  useEffect(() => {
    if (!open) return;
    setLoadingSource(true);
    customerLeadService
      .getAll({ page_size: 200 })
      .then(res => setAllDeals(res.items))
      .catch(() => setAllDeals([]))
      .finally(() => setLoadingSource(false));
    seedingContractTemplateRepository.getTemplates().then(setTemplates).catch(() => setTemplates([]));
    listContractTypes().then(r => setTypeOptions(r.types)).catch(() => setTypeOptions([]));
  }, [open]);

  useEffect(() => {
    if (!open) { defaultAppliedRef.current = false; return; }
    if (defaultCustomerId && !customerKey) setCustomerKey(defaultCustomerId);
  }, [open, defaultCustomerId, customerKey]);

  const customerOptions = useMemo(() => {
    const seen = new Map<string, Customer>();
    allDeals.forEach(d => { const k = d.customer_id || `deal:${d.id}`; if (!seen.has(k)) seen.set(k, d); });
    return Array.from(seen.entries()).map(([key, d]) => {
      const label = d.company_name || d.customer_name || 'Khách hàng';
      return { value: key, label, searchText: `${d.customer_name} ${d.company_name || ''}`, richLabel: <span>{label}</span> };
    });
  }, [allDeals]);

  const deals = useMemo(() => allDeals.filter(d => (d.customer_id || `deal:${d.id}`) === customerKey), [allDeals, customerKey]);
  const customerName = defaultCustomerId ? (customerNameHint || deals[0]?.company_name || deals[0]?.customer_name || 'Khách hàng đang xem')
    : (customerOptions.find(o => o.value === customerKey)?.label || '');

  // Một Deal hợp lệ: tự chọn; nhiều Deal: bắt buộc chọn
  useEffect(() => {
    if (!open || defaultAppliedRef.current || deals.length === 0) return;
    defaultAppliedRef.current = true;
    if (deals.length === 1) setDealId(deals[0].id);
  }, [open, deals]);
  useEffect(() => { setDealId(prev => (deals.some(d => d.id === prev) ? prev : '')); defaultAppliedRef.current = false; }, [customerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // editVersion: dealId của hợp đồng đang sửa phải được set ĐÚNG, nhưng effect reset ở trên (theo customerKey) sẽ xoá
  // bất kỳ dealId nào đặt TRƯỚC KHI allDeals/deals kịp nạp xong - nên chờ đến khi deal đó THỰC SỰ xuất hiện trong
  // danh sách đã nạp rồi mới set, tránh bị effect kia ghi đè lại thành rỗng.
  useEffect(() => {
    if (!open || !editVersion?.dealId) return;
    if (dealId === editVersion.dealId) return;
    if (deals.some(d => d.id === editVersion.dealId)) setDealId(editVersion.dealId);
  }, [open, editVersion, deals, dealId]);

  // Báo giá: CHỈ báo giá đã duyệt của đúng Deal (backend kiểm tra lại)
  useEffect(() => {
    if (!dealId) { setQuotes([]); setQuoteId(''); setQuote(null); return; }
    seedingQuoteRepository.getQuotes({ dealId }).then(all => {
      const ok = all.filter(q => q.dealId === dealId && CLOSED_QUOTE_STATUSES.has(q.status) && q.customerOutcome !== 'lost' && !q.deletedAt);
      setQuotes(ok);
      setQuoteId(ok.length === 1 ? ok[0].id : '');
    }).catch(() => setQuotes([]));
  }, [dealId]);
  // editVersion: báo giá của hợp đồng đang sửa - cùng lý do với dealId ở trên, chờ nạp xong rồi mới ép đúng giá trị
  // (quote-loading effect ở trên có thể tự chọn khác nếu Deal có nhiều báo giá đã duyệt).
  useEffect(() => {
    if (!open || !editVersion?.quoteId) return;
    if (quoteId === editVersion.quoteId) return;
    if (quotes.some(q => q.id === editVersion.quoteId)) setQuoteId(editVersion.quoteId);
  }, [open, editVersion, quotes, quoteId]);
  useEffect(() => {
    if (!quoteId) { setQuote(null); return; }
    let alive = true;
    seedingQuoteRepository.getQuote(quoteId).then(q => { if (alive) setQuote(q); }).catch(() => { if (alive) setQuote(null); });
    return () => { alive = false; };
  }, [quoteId]);

  const contractValueVnd = useMemo(() => {
    if (!quote) return 0;
    return quote.currency === 'USD' ? Math.round(quoteCurrencyToVnd(quote.totalAmount, 'USD', quote.exchangeRate) ?? quote.totalAmount) : quote.totalAmount;
  }, [quote]);

  // Kiểm tra nguồn + pháp lý ở backend. precheckTick: tăng để chạy lại NGAY (sau khi bổ sung tại chỗ, hoặc quay lại tab sau khi
  // sửa Customer 360/Đơn vị phát hành ở tab khác) - không cần F5.
  const [precheckTick, setPrecheckTick] = useState(0);
  // Chỉ reset "đã xác nhận để trống" khi THỰC SỰ đổi Deal/báo giá/khách hàng (nguồn khác thì ack cũ không còn hợp lệ nữa).
  // Precheck còn tự chạy lại khi cửa sổ lấy lại focus/đổi tab (xem effect bên dưới, để không cần F5) - nếu reset ack mỗi
  // lần đó thì đúng lúc người dùng bấm tích xong quay lại tab, 1 sự kiện focus trùng thời điểm sẽ xoá mất lựa chọn vừa
  // bấm (bug "bấm 1 lần không ăn, bấm lần 2 mới ăn" đã báo) - phải PHÂN BIỆT đổi nguồn thật với refresh ngầm do tick.
  const prevAckSourceRef = useRef<string>('');
  useEffect(() => {
    if (!open || !dealId) { setPrecheck(null); return undefined; }
    let alive = true;
    setPrecheckLoading(true);
    const ackSource = `${dealId}|${quoteId}|${crmCustomerId || ''}`;
    if (prevAckSourceRef.current !== ackSource) {
      prevAckSourceRef.current = ackSource;
      setAck(false);
    }
    const appliedToCrm = saveOverridesToCrm;   // chụp lại tại thời điểm gọi - dùng để dọn state MỘT LẦN sau khi áp xong (xem bên dưới)
    precheckContract({
      customerId: crmCustomerId, dealId, quoteId: quoteId || undefined, contactId,
      representative, legalOverrides, saveOverridesToCrm,
    })
      .then(r => {
        if (!alive) return;
        setPrecheck(r);
        // Backend trả đúng contact_id đã dùng (kể cả Contact vừa tạo) - đồng bộ lại để lần precheck SAU (vd focus lại tab)
        // dùng update_contact thay vì tạo trùng Contact mới mỗi lần chạy lại.
        if (r.contactId !== undefined && r.contactId !== contactId) setContactId(r.contactId ?? null);
        // Đã áp overrides vào CRM thành công 1 lần - dữ liệu giờ nằm trong CRM, enrich_deal() sẽ tự lấy ở các lần sau.
        // Dọn legalOverrides/saveOverridesToCrm để KHÔNG ghi đè/tạo trùng lặp lại mỗi khi precheck tự chạy lại (tick, focus tab).
        if (appliedToCrm) { setLegalOverrides(null); setSaveOverridesToCrm(false); }
      })
      .catch(err => alive && setPrecheck({ ok: false, blockers: [{ side: '', field: 'source', label: err instanceof Error ? err.message : 'Không kiểm tra được dữ liệu CRM', source: '' }], required: [], optional: [] }))
      .finally(() => alive && setPrecheckLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contactId/representative/legalOverrides/saveOverridesToCrm chỉ đổi qua LegalInfoEditor (kèm precheckTick++)
  }, [open, dealId, quoteId, crmCustomerId, precheckTick]);

  // Quay lại tab sau khi sửa dữ liệu ở nơi khác (Customer 360, Đơn vị phát hành) -> tự kiểm tra lại, không cần F5.
  useEffect(() => {
    if (!open || !dealId) return undefined;
    const onFocus = () => { if (document.visibilityState !== 'hidden') setPrecheckTick(t => t + 1); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [open, dealId]);

  // AI đề xuất loại hợp đồng (không ghi đè loại người dùng đã xác nhận)
  const chosenTemplate = templates.find(t => t.id === templateId);
  const templateName = templateFile?.name || chosenTemplate?.name || '';
  useEffect(() => {
    if (!open || !dealId || !quoteId) { setSuggestion(null); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setSuggesting(true);
      suggestContractType({ customerId: crmCustomerId, dealId, quoteId, templateName: templateName || undefined })
        .then(s => {
          if (!alive) return;
          setSuggestion(s);
          if (!typeConfirmed && s.label && !s.needsConfirmation) setTypeText(s.label);
        })
        .catch(() => alive && setSuggestion(null))
        .finally(() => alive && setSuggesting(false));
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, dealId, quoteId, crmCustomerId, templateName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mẫu PDF: trích text làm tham chiếu; scan: chưa hỗ trợ; không bao giờ giữ nguyên form PDF
  useEffect(() => {
    setReferenceText(''); setReferenceNote('');
    const f = templateFile?.file;
    if (!f || !/\.pdf$/i.test(templateFile?.name || '')) return undefined;
    let alive = true;
    extractReference(f).then(r => { if (alive) { setReferenceText(r.text); setReferenceNote(`${r.warning} Nội dung PDF chỉ để AI tham chiếu văn phong; số tiền và thông tin pháp lý vẫn lấy từ CRM.`); } })
      .catch(err => { if (alive) { setTemplateFile(null); setNotice(err instanceof Error ? err.message : 'Không đọc được PDF mẫu.'); } });
    return () => { alive = false; };
  }, [templateFile]);

  const docxTemplateMode = templateFile?.file ? /\.docx$/i.test(templateFile.name) : (!templateFile && chosenTemplate?.fileType === 'docx');
  const needDeal = deals.length > 0 && !dealId;
  const noDeals = !loadingSource && !!customerKey && deals.length === 0;
  const needCustomer = !customerKey;
  const typeEmpty = !typeText.trim();
  const blocked = precheck ? precheck.blockers.length > 0 : false;
  const needAck = !!precheck && precheck.required.length > 0 && !ack;
  const step1Block = needCustomer ? 'Chọn khách hàng' : noDeals ? 'Khách hàng chưa có Deal' : needDeal ? 'Chọn Deal để tiếp tục' : precheckLoading || !precheck ? 'Đang kiểm tra dữ liệu CRM…'
    : blocked ? 'Có thông tin bắt buộc chưa hợp lệ' : needAck ? 'Xác nhận các trường pháp lý còn thiếu' : typeEmpty ? 'Chọn hoặc nhập loại hợp đồng' : '';

  // ───────── PDF blob URL ─────────
  const setPdf = useCallback((b64: string | null, orig?: string | null) => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = b64 ? URL.createObjectURL(base64ToBlob(b64, 'application/pdf')) : null;
    setPdfUrl(pdfUrlRef.current);
    if (orig !== undefined) {
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
      originalUrlRef.current = orig ? URL.createObjectURL(base64ToBlob(orig, 'application/pdf')) : null;
      setOriginalPdfUrl(originalUrlRef.current);
    }
  }, []);
  useEffect(() => () => { if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current); if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current); }, []);

  // ───────── bước 2: mã dự kiến ─────────
  useEffect(() => {
    if (!open || step !== 2) return;
    const sn = shortName || precheck?.issuer?.code || '';
    if (!shortName && sn) setShortName(sn);
    getNumberSettings(sn || undefined).then(setNumberInfo).catch(() => setNumberInfo(null));
  }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildTitle() {
    return `${typeText.trim() || 'Hợp đồng'}${customerName ? ` — ${customerName}` : ''}`;
  }

  function fullPrompt() {
    return prompt.trim();
  }

  // ───────── tạo bản nháp ─────────
  async function generate(itemsTableIndex?: number) {
    // Đã có bản nháp (có thể đã chỉnh sửa tay) - tạo lại bằng AI sẽ THAY THẾ toàn bộ, không gộp. Hỏi lại để không mất chỉnh sửa cũ.
    if (clauses.length > 0 && itemsTableIndex === undefined) {
      if (!window.confirm('Đã có bản nháp (có thể đã chỉnh sửa). Tạo lại bằng AI sẽ THAY THẾ toàn bộ nội dung hiện tại, kể cả các chỉnh sửa tay. Tiếp tục?')) return;
    }
    setError(''); setNotice(''); setApprovalMsg(''); setSaved(null); setVersions([]); setHistory([]); setDraftRisk(null); setReadiness(null);
    setGenerating(true); setStep(3); setTab('preview'); setDirtyClauses(false);
    saveKeyRef.current = crypto.randomUUID();
    dirtySinceSaveRef.current = true;
    try {
      if (docxTemplateMode) {
        const res = await renderTemplate({
          file: templateFile?.file || null, templateId: templateFile?.file ? undefined : templateId || undefined,
          dealId, quoteId: quoteId || undefined, extraPrompt: fullPrompt(), contractValue: contractValueVnd, customerId: crmCustomerId, acknowledgeMissing: ack, itemsTableIndex,
        });
        if (res.mode !== 'template-docx') { setNotice(res.warning); setStep(2); return; }
        setMode('template'); setTplResult(res); setClauses([]); setDocx(res.docxBase64);
        setPdf(res.pdfBase64, res.originalPdfBase64);
        setPdfInfo({ pages: res.pages, error: res.pdfError, warnings: res.warnings });
        void runDraftRisk(res.docxBase64);
        return;
      }
      const draft = await seedingContractRepository.generateDraft({
        dealId, quoteId: quoteId || undefined, templateType: typeText.trim(), detailLevel, extraPrompt: fullPrompt() || undefined,
        referenceTemplateId: templateFile ? undefined : templateId || undefined, customerId: crmCustomerId, acknowledgeMissing: ack,
        referenceText: referenceText || undefined, language, style,
        contactId, representative, legalOverrides, saveOverridesToCrm,
      });
      setMode('clauses'); setTplResult(null); setClauses(draft.clauses);
      if (draft.warnings?.length) setNotice(draft.warnings.join(' '));
      await rebuildFromClauses(draft.clauses, '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI soạn hợp đồng thất bại.');
      setStep(2);
    } finally {
      setGenerating(false);
    }
  }

  async function rebuildFromClauses(
    list: ContractClause[], number: string,
    overrideContactId?: string | null, overrideRepresentative?: RepresentativeOverrideInput | null,
  ): Promise<string | null> {
    const doc = await docxFromClauses({
      title: buildTitle(), contractNumber: number, clauses: list, dealId, quoteId: quoteId || undefined, customerId: crmCustomerId,
      contractType: typeText.trim(), direction,
      contactId: overrideContactId !== undefined ? overrideContactId : contactId,
      representative: overrideRepresentative !== undefined ? overrideRepresentative : representative,
    });
    setDocx(doc.docxBase64);
    setPdf(doc.pdfBase64);
    setPdfInfo({ pages: doc.pages, error: doc.pdfError, warnings: doc.warnings || [] });
    setDirtyClauses(false);
    void runDraftRisk(doc.docxBase64);
    return doc.docxBase64;
  }

  async function runDraftRisk(docxB64: string) {
    setRiskBusy(true);
    try {
      setDraftRisk(await analyzeDraftRisk({ docxBase64: docxB64, dealId, quoteId: quoteId || undefined, customerId: crmCustomerId, contractValue: contractValueVnd }));
    } catch (err) {
      setDraftRisk(null);
      setNotice(`AI kiểm tra rủi ro chưa chạy được: ${err instanceof Error ? err.message : 'lỗi'} — bấm "Kiểm tra lại" để thử lại.`);
    } finally {
      setRiskBusy(false);
    }
  }

  async function applyClauseEdits() {
    setGenerating(true); setError(''); dirtySinceSaveRef.current = true;
    try { await rebuildFromClauses(clauses, saved?.number || ''); } catch (err) { setError(err instanceof Error ? err.message : 'Không cập nhật được bản xem trước.'); } finally { setGenerating(false); }
  }

  function onParagraphApplied(r: ApplyParagraphResult) {
    dirtySinceSaveRef.current = true;
    setTplResult(prev => (prev ? { ...prev, docxBase64: r.docxBase64, pdfBase64: r.pdfBase64, pdfError: r.pdfError, pages: r.pages, paragraphs: r.paragraphs, layoutPreserved: r.layoutPreserved } : prev));
    setDocx(r.docxBase64); setPdf(r.pdfBase64);
    setPdfInfo(p => ({ ...p, pages: r.pages, error: r.pdfError }));
    setHistory(h => [...h, { id: r.applied.id, before: r.applied.before, after: r.applied.after, at: new Date().toLocaleTimeString('vi-VN') }]);
    void runDraftRisk(r.docxBase64);
  }

  // ───────── lưu nháp / phiên bản ─────────
  async function saveDraft(): Promise<{ id: string; number: string; version: number } | null> {
    if (!docx) return null;
    if (saved && !dirtySinceSaveRef.current) return saved;      // không đổi gì kể từ lần lưu trước: giữ nguyên phiên bản, không tạo bản trùng
    setSaving(true); setError('');
    try {
      let id = saved?.id || '';
      let number = saved?.number || '';
      if (!id) {
        const contract = await seedingContractRepository.createContract({
          dealId, quoteId: quoteId || undefined, title: buildTitle(), templateType: typeText.trim(), contractValue: contractValueVnd, currency: 'VND',
          clauses: mode === 'clauses' ? clauses : [], paymentTerms: mode === 'clauses' ? extractPaymentTermsFromClauses(clauses) : undefined,
          aiGenerated: true, aiPrompt: fullPrompt() || undefined, numberShort: shortName || undefined, customerId: crmCustomerId,
          contactId: contactId || undefined, representativeConfirmed: !!precheck?.representative?.confirmed,
          legalSnapshot: precheck?.parties ? { parties: precheck.parties, representative: precheck.representative } : undefined,
        }, { idempotencyKey: saveKeyRef.current || undefined });
        id = contract.id; number = contract.contractNumber;
      }
      let body = docx;
      if (mode === 'clauses') body = (await rebuildFromClauses(clauses, number)) || docx;      // DOCX có số hợp đồng thật
      const v = await saveContractVersionFull(id, body, { contractNumber: number, source: mode === 'template' ? 'template' : (saved ? 'manual-edit' : 'ai-new'), note: history.length ? `${history.length} chỉnh sửa điều khoản bằng AI` : '' });
      const next = { id, number, version: v.version };
      dirtySinceSaveRef.current = false;
      setSaved(next);
      listContractVersionsFull(id).then(setVersions).catch(() => undefined);
      // rủi ro CHÍNH THỨC chạy ở server trên đúng phiên bản vừa lưu
      setRiskBusy(true);
      runVersionRisk(id, v.version).then(r => { setDraftRisk(r); listContractVersionsFull(id).then(setVersions).catch(() => undefined); }).catch(err => setNotice(`AI chưa phân tích được phiên bản v${v.version}: ${err instanceof Error ? err.message : 'lỗi'}`)).finally(() => setRiskBusy(false));
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được hợp đồng.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  const [confirmRepBusy, setConfirmRepBusy] = useState(false);
  // Xac nhan nhanh ngay tren danh sach "Dieu kien gui duyet" (feedback: nut bam o nam o cho khac/khong co, phai
  // "de ngoai cho de bam") - Sale van thay ro TEN nguoi duoc xac nhan qua dong detail cua check nay truoc khi bam.
  async function confirmRepresentative() {
    if (!saved) return;
    setConfirmRepBusy(true); setError('');
    try {
      await seedingContractRepository.updateContract(saved.id, { representativeConfirmed: true });
      setReadiness(await getContractReadiness(saved.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xác nhận được người đại diện.');
    } finally {
      setConfirmRepBusy(false);
    }
  }

  async function submitForApproval() {
    setApprovalMsg(''); setError('');
    const s = (await saveDraft()) || saved;
    if (!s) return;
    try {
      // đợi AI rủi ro của phiên bản vừa lưu rồi hỏi backend điều kiện gửi duyệt
      await runVersionRisk(s.id, s.version).then(r => setDraftRisk(r)).catch(() => undefined);
      const r = await getContractReadiness(s.id);
      setReadiness(r);
      if (!r.ready) { setApprovalMsg('Chưa đủ điều kiện gửi duyệt — xem danh sách bên dưới.'); setTab('risk'); return; }
      await seedingContractRepository.updateStatus(s.id, 'pending_legal', undefined, s.version);
      setApprovalMsg(`Đã gửi pháp chế duyệt phiên bản v${s.version}.`);
    } catch (err) {
      setApprovalMsg(err instanceof Error ? err.message : 'Không gửi duyệt được.');
    }
  }

  async function downloadSaved(fmt: 'docx' | 'pdf', v?: number) {
    if (!saved) return;
    try {
      saveBlobAs(await fetchVersionBlob(saved.id, v ?? saved.version, fmt), `${saved.number.replace(/[\\/:*?"<>|]/g, '-')}-v${v ?? saved.version}.${fmt}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Không tải được tệp.'); }
  }

  async function onLegalInfoSaved(input: LegalInfoSave) {
    setContactId(input.contactId);
    setLegalOverrides(input.legalOverrides);
    setRepresentative(input.representative);
    setSaveOverridesToCrm(input.saveToCrm);
    // Goi precheck NGAY voi DUNG gia tri vua xac nhan (khong dua vao effect doc state qua closure+tick - setState
    // dong thoi SE duoc React batch chung 1 render nhung effect o duoi van co the chay voi du lieu tu 1 cycle khac
    // neu co fetch truoc do dang bay (vd window focus) - gay bug "bam Xac nhan nhanh phai bam 2-3 lan moi an").
    // Goi truc tiep bang gia tri input (khong doc tu state) la cach chac chan dung NGAY LAN DAU, khong phu thuoc timing.
    if (dealId) {
      setPrecheckLoading(true);
      try {
        const r = await precheckContract({
          customerId: crmCustomerId, dealId, quoteId: quoteId || undefined, contactId: input.contactId,
          representative: input.representative, legalOverrides: input.legalOverrides, saveOverridesToCrm: input.saveToCrm,
        });
        setPrecheck(r);
        if (r.contactId !== undefined && r.contactId !== input.contactId) setContactId(r.contactId ?? null);
        if (input.saveToCrm) { setLegalOverrides(null); setSaveOverridesToCrm(false); }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không kiểm tra lại được dữ liệu CRM.');
      } finally {
        setPrecheckLoading(false);
      }
    }
    // Đã có bản nháp (Bước 3) - dựng lại NGAY với dữ liệu vừa xác nhận: Điều 1, Preview, DOCX/PDF, Legal Check đều cập nhật,
    // không cần F5, không phải generate lại bằng AI (chỉ dựng lại DOCX từ đúng các điều khoản Sale đang có).
    if (mode === 'clauses' && clauses.length > 0) {
      dirtySinceSaveRef.current = true;
      void rebuildFromClauses(clauses, saved?.number || '', input.contactId, input.representative).catch(err => setNotice(err instanceof Error ? err.message : 'Không cập nhật được Điều 1 sau khi lưu thông tin.'));
    }
  }

  function resetAndClose() {
    if (generating || saving) return;
    setStep(1); setCustomerKey(''); setDealId(''); setQuoteId(''); setQuote(null); setTypeText(''); setTypeConfirmed(false); setSuggestion(null); setTemplateId('');
    setTemplateFile(null); setPrompt(''); setClauses([]); setTplResult(null); setDocx(''); setPdf(null, null); setSaved(null); setVersions([]); setHistory([]);
    setDraftRisk(null); setReadiness(null); setApprovalMsg(''); setError(''); setNotice(''); setAck(false); setPrecheck(null); setShortName(''); setNumberInfo(null);
    setMode('clauses'); setLibraryOpen(false);
    setContactId(null); setRepresentative(null); setLegalOverrides(null); setSaveOverridesToCrm(false);
    editSeededRef.current = false;
    onClose();
  }

  if (!open) return null;

  const dealOptions = deals.map(d => {
    const stage = DEAL_STAGE_META[(d.deal_stage || 'new_lead') as DealStage]?.label || d.deal_stage || '';
    const extra = (d as { service_package?: string | null }).service_package;
    const budget = (d as { estimated_budget?: number | null }).estimated_budget;
    const label = [stage, extra, budget ? formatVnd(Number(budget)) : ''].filter(Boolean).join(' · ') || 'Cơ hội';
    return { value: d.id, label, searchText: label, richLabel: <span title={label}>{label}</span> };
  });
  const quoteOptions = quotes.map(q => {
    const label = `${q.quoteNumber} · ${fmtMoney(q.totalAmount, q.currency)}`;
    return { value: q.id, label, searchText: q.quoteNumber, richLabel: <span title={label}>{label}</span> };
  });
  const templateOptions = templates.map(t => ({ value: t.id, label: t.name, searchText: t.name, richLabel: <span title={t.name}>{t.name}</span> }));
  const items = (quote?.items || []).filter(i => i.rowType !== 'section');
  const typeListId = 'copilot-type-options';
  const riskScore = draftRisk?.score ?? null;

  return (
    <div className="cp-backdrop" onClick={resetAndClose}>
      <div className={`copilot-modal${step === 3 && mode === 'template' && tab === 'preview' ? ' copilot-modal--wide' : ''}`} data-testid="copilot-modal" onClick={e => e.stopPropagation()}>
        <aside className="cp-steps">
          <h2>AI Contract Copilot</h2>
          {([1, 2, 3] as Step[]).map(n => (
            <button key={n} type="button" data-testid={`copilot-step-${n}`} className={`cp-step ${step === n ? 'is-active' : step > n ? 'is-done' : ''}`}
              onClick={() => { if (step > n && !generating) setStep(n); }}>
              <span className="cp-step-dot">{step > n ? '✓' : n}</span>
              {n === 1 ? 'Thông tin & nguồn' : n === 2 ? 'Yêu cầu AI' : 'Xem trước & hoàn thiện'}
            </button>
          ))}
        </aside>

        <section className="copilot-body">
          <header className="copilot-head">
            <div>
              <h3>{STEP_TITLES[step].title}</h3>
              <p>{STEP_TITLES[step].sub}</p>
            </div>
            <button type="button" className="cp-close" aria-label="Đóng" onClick={resetAndClose}>✕</button>
          </header>

          {/* ───────── BƯỚC 1 ───────── */}
          {step === 1 && !libraryOpen ? (
            <div className="cp-main" data-testid="copilot-step1">
              <div className="cp-grid3">
                <label className="cp-field"><span>Khách hàng</span>
                  {defaultCustomerId ? (
                    <input className="cp-input" readOnly value={customerName} data-testid="copilot-customer-locked" title={customerName} />
                  ) : (
                    <SearchableSelect value={customerKey} onChange={setCustomerKey} options={customerOptions} loading={loadingSource} placeholder="-- Chọn khách hàng --" searchPlaceholder="Tìm khách hàng…" emptyText="Không có khách hàng" testId="copilot-customer-select" />
                  )}
                </label>
                <label className="cp-field"><span>Cơ hội / Deal</span>
                  <SearchableSelect value={dealId} onChange={setDealId} options={dealOptions} disabled={!customerKey} hideClearOption
                    placeholder={!customerKey ? 'Chọn khách hàng trước' : dealOptions.length > 1 ? `Chọn 1 trong ${dealOptions.length} cơ hội` : dealOptions.length === 0 ? 'Khách chưa có cơ hội' : '-- Chọn cơ hội --'}
                    searchPlaceholder="Tìm cơ hội…" emptyText="Không có cơ hội" testId="copilot-deal-select" />
                </label>
                <label className="cp-field"><span>Báo giá đã duyệt</span>
                  <SearchableSelect value={quoteId} onChange={setQuoteId} options={quoteOptions} disabled={!dealId}
                    placeholder={!dealId ? 'Chọn Deal trước' : quotes.length === 0 ? 'Deal chưa có báo giá đã duyệt' : '-- Chọn báo giá --'} searchPlaceholder="Tìm số báo giá…" emptyText="Không có báo giá" testId="copilot-quote-select" />
                </label>
              </div>

              <div className="cp-field">
                <span>Loại hợp đồng {suggestion?.label && !typeConfirmed ? <em className="cp-badge" data-testid="copilot-ai-badge">✦ AI đề xuất</em> : null}</span>
                <input className="cp-input" data-testid="copilot-type-input" list={typeListId} value={typeText} placeholder="Nhập hoặc chọn loại hợp đồng (không giới hạn danh sách)"
                  onChange={e => { setTypeText(e.target.value); setTypeConfirmed(true); }} />
                <datalist id={typeListId}>{Array.from(new Set([...(suggestion?.label ? [suggestion.label] : []), ...(suggestion?.alternatives || []), ...typeOptions])).map(t => <option key={t} value={t} />)}</datalist>
                {suggesting ? <small style={{ color: '#64748b' }}>AI đang phân tích hạng mục báo giá…</small> : null}
                {suggestion?.label && !suggestion.needsConfirmation ? (
                  <small data-testid="copilot-type-suggestion" style={{ color: '#475569' }}>
                    AI đề xuất: <b>{suggestion.label}</b> (độ tin cậy {Math.round(suggestion.confidence * 100)}%) — {suggestion.reason}
                    {typeConfirmed && typeText.trim() !== suggestion.label ? <button type="button" className="cp-chip" style={{ marginLeft: 8 }} onClick={() => { setTypeText(suggestion.label || ''); setTypeConfirmed(false); }}>Dùng đề xuất</button> : null}
                  </small>
                ) : null}
                {suggestion && suggestion.needsConfirmation ? (
                  <small data-testid="copilot-type-unsure" style={{ color: '#9a3412' }}>
                    AI chưa đủ chắc chắn về loại hợp đồng{suggestion.label ? ` (gần nhất: ${suggestion.label}, ${Math.round(suggestion.confidence * 100)}%)` : ''} — hãy chọn hoặc nhập loại phù hợp.
                    {suggestion.aiError ? ` (AI lỗi: ${suggestion.aiError})` : ''}
                    {suggestion.alternatives.slice(0, 3).map(a => <button key={a} type="button" className="cp-chip" style={{ marginLeft: 6 }} onClick={() => { setTypeText(a); setTypeConfirmed(true); }}>{a}</button>)}
                  </small>
                ) : null}
              </div>

              <div className="cp-field">
                <span>Mẫu hợp đồng (tùy chọn) — không chọn thì AI soạn mới</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label className="cp-btn" style={{ display: 'inline-flex', alignItems: 'center', cursor: templateId ? 'not-allowed' : 'pointer', opacity: templateId ? 0.5 : 1 }}>
                    <input type="file" hidden disabled={!!templateId} accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={e => { const f = e.target.files?.[0]; setTemplateFile(f ? { name: f.name, size: f.size, file: f } : null); if (f) setTemplateId(''); e.target.value = ''; }} />
                    ⬆ {templateFile ? templateFile.name : 'Chọn mẫu DOCX/PDF'}
                  </label>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <SearchableSelect value={templateId} onChange={id => { setTemplateId(id); if (id) setTemplateFile(null); }} options={templateOptions} disabled={!!templateFile} placeholder="-- Hoặc chọn mẫu đã lưu --" searchPlaceholder="Tìm mẫu…" emptyText="Chưa có mẫu" testId="copilot-template-select" />
                  </div>
                  <button type="button" className="cp-btn" onClick={() => setLibraryOpen(true)} disabled={!!templateFile} data-testid="copilot-open-library">Thư viện</button>
                  {templateFile || templateId ? <button type="button" className="cp-btn" data-testid="copilot-template-clear" onClick={() => { setTemplateFile(null); setTemplateId(''); }}>Bỏ mẫu</button> : null}
                </div>
                {docxTemplateMode ? <small style={{ color: '#16845d' }}>Mẫu .docx được chỉnh trực tiếp, giữ nguyên bố cục.</small> : null}
                {referenceNote ? <small data-testid="copilot-reference-note" style={{ color: '#9a3412' }}>{referenceNote}</small> : null}
              </div>

              {quote ? (
                <div className="cp-card" data-testid="copilot-quote-summary">
                  <b style={{ fontSize: '0.84rem' }}>Tóm tắt báo giá {quote.quoteNumber}</b>
                  <div style={{ overflowX: 'auto', marginTop: 6 }}>
                    <table className="cp-table">
                      <thead><tr><th>STT</th><th>Hạng mục</th><th>Đơn vị</th><th className="num">Số lượng</th><th className="num">Đơn giá</th><th className="num">VAT (%)</th><th className="num">Thành tiền</th></tr></thead>
                      <tbody>
                        {items.map((i, idx) => (
                          <tr key={i.id || idx}><td>{idx + 1}</td><td>{i.description}</td><td>{i.unit || ''}</td><td className="num">{i.quantity}</td>
                            <td className="num">{i.unitPrice != null ? fmtMoney(i.unitPrice, quote.currency) : ''}</td><td className="num">{(i as { vatRate?: number }).vatRate ?? 0}%</td>
                            <td className="num">{fmtMoney((i as { totalAmount?: number }).totalAmount ?? i.amountAfterDiscount, quote.currency)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.84rem', marginTop: 6 }}>Tổng thanh toán: <b style={{ color: '#16845d' }}>{fmtMoney(quote.totalAmount, quote.currency)}</b></div>
                  <IssuerSummaryLine issuer={precheck?.issuer} />
                </div>
              ) : null}

              <PrecheckPanel precheck={precheck} loading={precheckLoading} needDeal={needDeal} noDeals={noDeals} ack={ack} onAck={setAck}
                onIssuerSaved={() => setPrecheckTick(t => t + 1)} onLegalInfoSaved={onLegalInfoSaved} />
              {notice ? <p data-testid="copilot-notice" style={{ margin: 0, fontSize: '0.78rem', color: '#9a3412' }}>{notice}</p> : null}
            </div>
          ) : null}

          {step === 1 && libraryOpen ? (
            <div className="cp-main">
              <button type="button" className="cp-btn small" style={{ justifySelf: 'start' }} data-testid="copilot-library-back" onClick={() => setLibraryOpen(false)}>← Quay lại Copilot</button>
              <ContractTemplateLibrary selectedId={templateId} onChanged={() => void seedingContractTemplateRepository.getTemplates().then(setTemplates)}
                onSelect={t => { setTemplateId(t.id); setTemplateFile(null); setLibraryOpen(false); void seedingContractTemplateRepository.getTemplates().then(setTemplates); }} />
            </div>
          ) : null}

          {/* ───────── BƯỚC 2 ───────── */}
          {step === 2 ? (
            <div className="cp-main" data-testid="copilot-step2">
              <textarea className="cp-textarea" data-testid="copilot-prompt" value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder="VD: Thanh toán 50% khi ký, 40% khi bàn giao, 10% sau nghiệm thu. Thời gian triển khai 45 ngày. Có điều khoản bảo hành 12 tháng." />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {CHIPS.map(c => <button key={c.label} type="button" className="cp-chip" data-testid={`copilot-chip-${c.label}`} onClick={() => setPrompt(p => (p.trim() ? `${p.trim()}\n${c.text}` : c.text))}>+ {c.label}</button>)}
              </div>
              <small style={{ color: '#64748b' }}>AI chỉ dùng số tiền, VAT, hạng mục từ báo giá; tỷ lệ/thời hạn thanh toán chỉ lấy từ nội dung bạn nhập. AI không tự tạo ngày ký hay thông tin pháp nhân.</small>
              <button type="button" className="cp-btn" style={{ justifySelf: 'start' }} data-testid="copilot-advanced-toggle" onClick={() => setAdvancedOpen(o => !o)}>{advancedOpen ? '▾' : '▸'} Tùy chọn nâng cao</button>
              {advancedOpen ? (
                <div className="cp-card" data-testid="copilot-advanced" style={{ display: 'grid', gap: 12 }}>
                  <div className="cp-grid3">
                    <label className="cp-field"><span>Mức độ chi tiết</span>
                      <select className="cp-select" value={detailLevel} onChange={e => setDetailLevel(e.target.value)}><option value="standard">Tiêu chuẩn · Khuyến nghị</option><option value="concise">Tinh gọn</option><option value="legal">Chi tiết pháp lý</option></select></label>
                    <label className="cp-field"><span>Ngôn ngữ</span>
                      <select className="cp-select" value={language} onChange={e => setLanguage(e.target.value)}><option>Tiếng Việt</option><option>Tiếng Việt + English</option></select></label>
                    <label className="cp-field"><span>Phong cách</span>
                      <select className="cp-select" value={style} onChange={e => setStyle(e.target.value)}><option>Chính thức</option><option>Ngắn gọn</option><option>Thân thiện</option></select></label>
                    <label className="cp-field"><span>Hướng giao dịch</span>
                      <select className="cp-select" data-testid="copilot-direction" value={direction} onChange={e => setDirection(e.target.value as 'sell' | 'buy')}><option value="sell">Bán ra (khách hàng là Bên A)</option><option value="buy">Mua vào (công ty là Bên A)</option></select></label>
                  </div>
                  <div className="cp-grid3">
                    <label className="cp-field"><span>Tên viết tắt công ty (dùng cho mã hợp đồng)</span>
                      <input className="cp-input" data-testid="copilot-short-name" value={shortName} placeholder={precheck?.issuer?.code ? `Hồ sơ công ty: ${precheck.issuer.code}` : 'Chưa có — nhập để dùng trong mã'}
                        onChange={e => { setShortName(e.target.value); }} onBlur={() => getNumberSettings(shortName || undefined).then(setNumberInfo).catch(() => undefined)} /></label>
                    <div className="cp-field"><span>Mã hợp đồng dự kiến</span>
                      <input className="cp-input" readOnly data-testid="copilot-number-preview" value={numberInfo?.example || '—'} />
                      <small style={{ color: '#64748b' }}>Quy tắc: {numberInfo?.format || 'HD/{YYYY}/{SEQ}'}{numberInfo && !numberInfo.schemaReady ? ' (mặc định — chưa cấu hình theo workspace)' : ''}. Mã chính thức cấp khi lưu.</small></div>
                  </div>
                </div>
              ) : null}
              {error ? <p className="crm-error" data-testid="copilot-error">{error}</p> : null}
              {notice ? <p style={{ margin: 0, fontSize: '0.78rem', color: '#9a3412' }}>{notice}</p> : null}
            </div>
          ) : null}

          {/* ───────── BƯỚC 3 ───────── */}
          {step === 3 ? (
            <>
              <div className="copilot-tabs" role="tablist">
                {([['preview', 'Xem trước tài liệu'], ['edit', 'Chỉnh sửa điều khoản'], ['risk', 'Kiểm tra rủi ro'], ['versions', 'Phiên bản']] as Array<[Tab3, string]>).map(([id, label]) => (
                  <button key={id} type="button" role="tab" data-testid={`copilot-tab-${id}`} className={`cp-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
                ))}
              </div>
              <div className="cp-main" data-testid="copilot-step3">
                {generating && !docx ? (
                  <div className="cp-card" data-testid="copilot-generating" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                    <div style={{ fontSize: '1.6rem' }}>✦</div><b>AI đang soạn hợp đồng…</b>
                    <p style={{ color: '#64748b', fontSize: '0.8rem' }}>Đối chiếu CRM, báo giá và yêu cầu của bạn. Có thể mất vài chục giây.</p>
                  </div>
                ) : (
                  <>
                    {saved ? (
                      <div className="cp-card" data-testid="copilot-saved" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.82rem' }}>
                        ✓ Đã lưu <b>{saved.number}</b> · phiên bản v{saved.version}
                        <button type="button" className="cp-btn small" onClick={() => void downloadSaved('docx')}>↓ DOCX</button>
                        <button type="button" className="cp-btn small" onClick={() => void downloadSaved('pdf')}>↓ PDF</button>
                        <button type="button" className="cp-btn small primary" data-testid="copilot-open-contract" onClick={() => { onCreated(saved.id); resetAndClose(); }}>Mở hợp đồng</button>
                      </div>
                    ) : null}
                    {error ? <p className="crm-error" data-testid="copilot-error">{error}</p> : null}
                    {notice ? <p data-testid="copilot-notice" style={{ margin: 0, fontSize: '0.78rem', color: '#9a3412' }}>{notice}</p> : null}
                    {approvalMsg ? <p data-testid="copilot-approval-msg" style={{ margin: 0, fontSize: '0.82rem', color: approvalMsg.startsWith('Đã gửi') ? '#16845d' : '#b91c1c' }}>{approvalMsg}</p> : null}

                    <div className="cp-step3">
                      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
                        {tab === 'preview' ? (
                          mode === 'template' && tplResult ? (
                            <TemplatePreviewPanel result={tplResult} editedUrl={pdfUrl} originalUrl={originalPdfUrl} onChooseItemsTable={idx => void generate(idx)} />
                          ) : (
                            <div style={{ display: 'grid', gap: 8 }}>
                              <small data-testid="copilot-pdf-info" style={{ color: '#475569' }}>Đúng file PDF sẽ xuất{pdfInfo.pages ? ` · ${pdfInfo.pages} trang` : ''}{dirtyClauses ? ' · có thay đổi chưa cập nhật' : ''}</small>
                              {pdfInfo.warnings.length > 0 ? <ul data-testid="copilot-warnings" style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.76rem', color: '#9a3412' }}>{pdfInfo.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
                              {pdfUrl ? <iframe className="cp-pdf" title="Xem trước PDF" src={pdfUrl} data-testid="copilot-pdf" /> : <div className="cp-card" style={{ color: '#b45309', fontSize: '0.82rem' }}>{pdfInfo.error || 'Server chưa tạo được PDF.'}</div>}
                            </div>
                          )
                        ) : null}

                        {tab === 'edit' ? (
                          mode === 'template' && tplResult ? (
                            <TemplateParagraphEditor paragraphs={tplResult.paragraphs || []} docxBase64={docx} history={history}
                              ctx={{ dealId, quoteId: quoteId || undefined, customerId: crmCustomerId }} onApplied={onParagraphApplied}
                              // Truoc day chi bat khi sua hop dong DA TAO (editVersion) - luc render mau LAN DAU bi khoa so
                              // dong de "giu dung bo cuc mau". Backend pipeline mau DOCX gio da ho tro chen/xoa dieu khoan
                              // that su (insert/delete + tu danh so lai "DIEU n.") nen khong can khoa nua, kieu bo cuc nao
                              // (lan dau hay da luu) cung sua tu do duoc (feedback "Bước 3 cho sửa toàn văn bản tự do").
                              allowFreeform
                              jumpToClause={jumpToClause} jumpFinding={jumpFinding} onJumpHandled={() => setJumpToClause(null)} />
                          ) : (
                            <div style={{ display: 'grid', gap: 10 }}>
                              {clauses.map((c, idx) => (
                                <div key={idx} className="cp-card" style={{ display: 'grid', gap: 6 }}>
                                  <input className="cp-input" value={c.title} onChange={e => { setClauses(cur => cur.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x))); setDirtyClauses(true); }} />
                                  <textarea className="cp-textarea" style={{ minHeight: 220, resize: 'vertical' }} rows={Math.max(8, c.body.split('\n').length + 1)}
                                    value={c.body} data-testid={`copilot-clause-body-${idx}`} onChange={e => { setClauses(cur => cur.map((x, i) => (i === idx ? { ...x, body: e.target.value } : x))); setDirtyClauses(true); }} />
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <button type="button" className="cp-btn small" data-testid={`clause-ai-open-${idx}`} onClick={() => setClauseEditIndex(clauseEditIndex === idx ? null : idx)}>✦ AI chỉnh điều khoản này</button>
                                    {idx === 0 && precheck?.parties ? (
                                      <LegalInfoEditor party={precheck.parties.a} representative={precheck.representative} contacts={precheck.contacts || []} contactId={precheck.contactId} onSaved={onLegalInfoSaved} />
                                    ) : null}
                                  </div>
                                  {clauseEditIndex === idx ? (
                                    <ClauseAiEditPanel label={c.title} text={c.body} ctx={{ dealId, quoteId: quoteId || undefined, customerId: crmCustomerId }} onClose={() => setClauseEditIndex(null)}
                                      onAccept={newText => { setClauses(cur => cur.map((x, i) => (i === idx ? { ...x, body: newText } : x))); setDirtyClauses(true); setHistory(h => [...h, { id: `c${idx}`, before: c.body, after: newText, at: new Date().toLocaleTimeString('vi-VN') }]); }} />
                                  ) : null}
                                </div>
                              ))}
                              <div><button type="button" className="cp-btn primary" data-testid="copilot-apply-clauses" disabled={!dirtyClauses || generating} onClick={() => void applyClauseEdits()}>{generating ? 'Đang cập nhật…' : 'Cập nhật bản xem trước'}</button></div>
                            </div>
                          )
                        ) : null}

                        {tab === 'risk' ? (
                          <div style={{ display: 'grid', gap: 10 }} data-testid="copilot-risk-tab">
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                              <button type="button" className="cp-btn" disabled={riskBusy || !docx} data-testid="copilot-run-risk" onClick={() => (saved ? runVersionRisk(saved.id, saved.version).then(setDraftRisk).catch(e => setError(e instanceof Error ? e.message : 'Lỗi AI')) : runDraftRisk(docx))}>{riskBusy ? 'Đang phân tích…' : '✦ Kiểm tra lại rủi ro'}</button>
                              <small style={{ color: '#64748b' }}>{draftRisk?.preliminary ? 'Kết quả sơ bộ cho bản nháp chưa lưu — sau khi lưu, hệ thống phân tích lại đúng phiên bản.' : draftRisk ? `Gắn với phiên bản v${saved?.version ?? '?'} · ${draftRisk.model || 'AI'} · ${draftRisk.analyzedAt ? new Date(draftRisk.analyzedAt).toLocaleString('vi-VN') : ''}` : ''}</small>
                            </div>
                            {readiness ? (
                              <div className="cp-card" data-testid="copilot-readiness">
                                <b style={{ fontSize: '0.84rem' }}>Điều kiện gửi duyệt</b>
                                <ul style={{ margin: '6px 0 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                                  {readiness.checks.map(c => <li key={c.key} style={{ color: c.ok ? '#166534' : '#b91c1c' }}>{c.ok ? '✓' : '✗'} {c.label}{c.detail ? ` — ${c.detail}` : ''}
                                    {!c.ok && c.action?.kind === 'fix_legal' && c.action.customerId ? <button type="button" className="cp-chip" style={{ marginLeft: 6 }} onClick={() => window.open(`/all-platform/crm/customers/${c.action?.customerId}`, '_blank', 'noopener')}>Bổ sung thông tin ↗</button> : null}
                                    {!c.ok && c.action?.kind === 'confirm_representative' ? <button type="button" className="cp-chip" style={{ marginLeft: 6 }} disabled={confirmRepBusy} onClick={() => void confirmRepresentative()}>{confirmRepBusy ? 'Đang xác nhận…' : '✓ Xác nhận người đại diện'}</button> : null}</li>)}
                                </ul>
                              </div>
                            ) : null}
                            {draftRisk?.verifiedFindings && draftRisk.verifiedFindings.length > 0 ? (
                              <div data-testid="copilot-risk-verified" style={{ display: 'grid', gap: 4 }}>
                                <small style={{ fontWeight: 700, color: '#b91c1c' }}>✓ Đã xác minh bằng số liệu thật (không qua AI):</small>
                                {draftRisk.verifiedFindings.map((f, i) => (
                                  <div key={i} className="cp-finding warn" style={{ borderLeft: '3px solid #b91c1c' }}><b>⚠ {f.title}</b><div>{f.detail}</div></div>
                                ))}
                              </div>
                            ) : null}
                            {(draftRisk?.findings || []).length > 0 ? <small style={{ color: '#64748b' }}>AI nhận định (chưa xác minh bằng số liệu):</small> : null}
                            {(draftRisk?.findings || []).map((f, i) => (
                              <div key={i} className={`cp-finding ${f.severity}`}>
                                <b>{f.severity === 'ok' ? '✓' : '!'} {f.title}</b><div>{f.detail}</div>
                                {f.clause ? (
                                  <button type="button" className="cp-chip" style={{ marginTop: 4 }} data-testid={`risk-fix-${i}`}
                                    onClick={() => { setJumpFinding({ title: f.title, detail: f.detail }); setJumpToClause(f.clause || null); setTab('edit'); }}>
                                    Xem & xử lý →
                                  </button>
                                ) : null}
                              </div>
                            ))}
                            {!draftRisk && !riskBusy ? <small style={{ color: '#94a3b8' }}>Chưa có kết quả phân tích.</small> : null}
                          </div>
                        ) : null}

                        {tab === 'versions' ? (
                          <div style={{ display: 'grid', gap: 10 }} data-testid="copilot-versions-tab">
                            {versions.length === 0 ? <small style={{ color: '#64748b' }}>Chưa lưu phiên bản nào. Bấm "Lưu bản nháp" để tạo phiên bản đầu tiên.</small> : (
                              <table className="cp-table"><thead><tr><th>Phiên bản</th><th>Thời điểm</th><th>Người tạo</th><th>Rủi ro</th><th /></tr></thead>
                                <tbody>{versions.map(v => (
                                  <tr key={v.version}><td>v{v.version}</td><td>{v.createdAt ? new Date(v.createdAt).toLocaleString('vi-VN') : ''}</td><td>{v.createdByName || '—'}</td><td>{v.risk?.score ?? '—'}</td>
                                    <td><button type="button" className="cp-btn small" onClick={() => void downloadSaved('docx', v.version)}>DOCX</button> <button type="button" className="cp-btn small" onClick={() => void downloadSaved('pdf', v.version)}>PDF</button></td></tr>
                                ))}</tbody></table>
                            )}
                            {history.length > 0 ? <div className="cp-card" style={{ fontSize: '0.78rem' }}><b>Chỉnh sửa trong phiên làm việc ({history.length})</b>{history.map((h, i) => <div key={i} style={{ borderTop: '1px solid #f1f5f9', padding: '4px 0' }}>{h.at} · {h.before.slice(0, 60)}… → {h.after.slice(0, 60)}…</div>)}</div> : null}
                          </div>
                        ) : null}
                      </div>

                      <aside className="cp-risk" data-testid="copilot-risk-panel">
                        <b style={{ fontSize: '0.88rem' }}>AI kiểm tra rủi ro</b>
                        {riskBusy ? <small>Đang phân tích…</small> : riskScore != null ? (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div className="cp-score" data-testid="copilot-risk-score" style={{ borderColor: riskScore >= 80 ? '#16a34a' : riskScore >= 50 ? '#f59e0b' : '#dc2626' }}>{riskScore}</div>
                            <div style={{ fontSize: '0.78rem' }}>/ 100<br />{riskScore >= 80 ? 'An toàn tốt' : riskScore >= 50 ? 'Cần lưu ý' : 'Rủi ro cao'}</div>
                          </div>
                        ) : <small style={{ color: '#94a3b8' }}>Chưa có kết quả.</small>}
                        {(draftRisk?.verifiedFindings || []).map((f, i) => <div key={i} className="cp-finding warn" style={{ borderLeft: '3px solid #b91c1c' }}><b>✓ (xác minh) {f.title}</b></div>)}
                        {(draftRisk?.findings || []).filter(f => f.severity === 'warn').slice(0, 3).map((f, i) => <div key={i} className="cp-finding"><b>{f.title}</b></div>)}
                        <button type="button" className="cp-chip" onClick={() => setTab('risk')}>Xem chi tiết phân tích →</button>
                      </aside>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : null}

          <footer className="cp-foot">
            {step === 1 && step1Block ? <span className="cp-hint" data-testid="copilot-block-reason">{step1Block}</span> : null}
            {step === 1 ? (
              <>
                <button type="button" className="cp-btn" onClick={resetAndClose}>Hủy</button>
                <button type="button" className="cp-btn primary" data-testid="copilot-next-1" disabled={!!step1Block || libraryOpen} onClick={() => { setError(''); setStep(2); }}>Tiếp theo →</button>
              </>
            ) : null}
            {step === 2 ? (
              <>
                <button type="button" className="cp-btn" onClick={() => setStep(1)}>Quay lại</button>
                <button type="button" className="cp-btn primary" data-testid="copilot-generate" disabled={generating} onClick={() => void generate()}>✦ Tạo bản nháp AI →</button>
              </>
            ) : null}
            {step === 3 ? (
              <>
                <button type="button" className="cp-btn" disabled={generating || saving} onClick={() => setStep(2)}>Quay lại</button>
                <button type="button" className="cp-btn" data-testid="copilot-save" disabled={!docx || saving || generating || dirtyClauses} title={dirtyClauses ? 'Cập nhật bản xem trước trước khi lưu' : undefined} onClick={() => void saveDraft()}>{saving ? 'Đang lưu…' : saved ? 'Lưu phiên bản mới' : 'Lưu bản nháp'}</button>
                <button type="button" className="cp-btn primary" data-testid="copilot-submit" disabled={!docx || saving || generating || dirtyClauses} onClick={() => void submitForApproval()}>Gửi duyệt</button>
              </>
            ) : null}
          </footer>
        </section>
      </div>
    </div>
  );
}
