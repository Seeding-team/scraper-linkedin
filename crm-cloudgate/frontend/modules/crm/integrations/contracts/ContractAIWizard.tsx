'use client';

import { useEffect, useState } from 'react';
import { customerLeadService } from '@/services/customer-lead.service';
import type { Customer } from '@/services/customer-lead.service';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import { seedingContractRepository } from '@/modules/contracts/repositories/SeedingContractRepository';
import { CONTRACT_TEMPLATE_OPTIONS, extractPaymentTermsFromClauses } from '@/modules/contracts/constants/contractConfig';
import type { ContractClause, ContractTemplateType } from '@/modules/contracts/types';
import { seedingContractTemplateRepository } from '@/modules/contract-templates';
import type { ContractTemplate } from '@/modules/contract-templates';
import { formatVnd } from '@/modules/quotes/utils/quoteCalculations';
import { CurrencyInput } from '@/components/CurrencyInput';
import { DEAL_STAGE_META } from '../../constants/crmConfig';
import type { DealStage } from '../../types';
import { X } from '../../components/icons';

type WizardStep = 1 | 2 | 3;

const CLOSED_QUOTE_STATUSES = new Set(['approved', 'confirmed']);

const DETAIL_LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'standard', label: 'Tiêu chuẩn · Khuyến nghị' },
  { value: 'concise', label: 'Tinh gọn' },
  { value: 'legal', label: 'Chi tiết pháp lý' },
];

export function ContractAIWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (contractId: string) => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [deals, setDeals] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loadingSource, setLoadingSource] = useState(false);
  const [dealId, setDealId] = useState('');
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [quoteId, setQuoteId] = useState('');
  // Gia tri hop dong - mac dinh dong bo theo bao gia da chon, nhung LUON sua tay
  // duoc (bat buoc phai sua neu "Khong dinh kem bao gia" vi khong co nguon nao khac).
  const [manualContractValue, setManualContractValue] = useState<number | null>(null);
  // Khong con cho chon "Loai hop dong" tren UI (trung y voi "Mau hop dong" -
  // gay nham lan), luon mac dinh 'service'; AI van soan du 7 dieu khoan chuan.
  const templateType: ContractTemplateType = 'service';
  const [detailLevel, setDetailLevel] = useState('standard');
  const [referenceTemplates, setReferenceTemplates] = useState<ContractTemplate[]>([]);
  const [referenceTemplateId, setReferenceTemplateId] = useState('');
  const [extraPrompt, setExtraPrompt] = useState(
    'Thanh toán 50% khi ký, 40% khi bàn giao và 10% sau nghiệm thu. Thời gian triển khai 45 ngày.'
  );

  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [clauses, setClauses] = useState<ContractClause[]>([]);
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [aiFindings, setAiFindings] = useState<Array<{ severity: 'ok' | 'warn'; title: string; detail: string }>>([]);
  const [aiFixApplied, setAiFixApplied] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdContractId, setCreatedContractId] = useState('');
  const [createdContractNumber, setCreatedContractNumber] = useState('');
  const [statusActionMessage, setStatusActionMessage] = useState('');
  const [refreshingTemplates, setRefreshingTemplates] = useState(false);

  function loadReferenceTemplates() {
    setRefreshingTemplates(true);
    return seedingContractTemplateRepository
      .getTemplates()
      .then(setReferenceTemplates)
      .catch(() => setReferenceTemplates([]))
      .finally(() => setRefreshingTemplates(false));
  }

  useEffect(() => {
    if (!open) return;
    setLoadingSource(true);
    customerLeadService
      .getAll({ page_size: 200 })
      .then(res => setDeals(res.items))
      .catch(() => setDeals([]))
      .finally(() => setLoadingSource(false));
    void loadReferenceTemplates();
  }, [open]);

  useEffect(() => {
    if (!dealId) {
      setQuotes([]);
      setQuoteId('');
      return;
    }
    seedingQuoteRepository
      .getQuotes()
      .then(all => {
        const dealQuotes = all.filter(q => q.dealId === dealId && CLOSED_QUOTE_STATUSES.has(q.status));
        setQuotes(dealQuotes);
        setQuoteId(dealQuotes[0]?.id || '');
      })
      .catch(() => setQuotes([]));
  }, [dealId]);

  function resetAndClose() {
    if (generating || saving) return;
    setStep(1);
    setDealId('');
    setManualCustomerName('');
    setQuoteId('');
    setManualContractValue(null);
    setReferenceTemplateId('');
    setClauses([]);
    setAiScore(null);
    setAiFindings([]);
    setAiFixApplied(false);
    setGeneratedAt(null);
    setTitle('');
    setStartDate('');
    setEndDate('');
    setError('');
    setCreatedContractId('');
    setCreatedContractNumber('');
    setStatusActionMessage('');
    onClose();
  }

  const selectedDeal = deals.find(d => d.id === dealId) || null;
  const selectedQuote = quotes.find(q => q.id === quoteId) || null;
  // Dong bo o nhap tay theo bao gia MOI ĐUỢC CHỌN (khong ghi de neu user da tung
  // sua tay o cung 1 bao gia) - dung selectedQuote?.id lam dependency, khong phai
  // ca object, de tranh chay lai vo ich khi quotes re-fetch nhung id khong doi.
  useEffect(() => {
    setManualContractValue(selectedQuote ? selectedQuote.totalAmount : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuote?.id]);
  const effectiveContractValue = manualContractValue ?? 0;

  async function handleGenerate() {
    setError('');
    setStep(2);
    setGenerating(true);
    try {
      const draft = await seedingContractRepository.generateDraft({
        dealId: dealId || undefined,
        manualCustomerName: dealId ? undefined : manualCustomerName.trim() || undefined,
        quoteId: quoteId || undefined,
        templateType,
        detailLevel,
        extraPrompt,
        referenceTemplateId: referenceTemplateId || undefined,
      });
      setClauses(draft.clauses);
      setGeneratedAt(new Date());
      const templateLabel = CONTRACT_TEMPLATE_OPTIONS.find(o => o.value === templateType)?.label || '';
      const customerName = selectedDeal?.customer_name || manualCustomerName.trim();
      setTitle(customerName ? `${templateLabel} — ${customerName}` : templateLabel);
      setGenerating(false);
      setReviewing(true);
      const review = await seedingContractRepository.reviewRisk({
        clauses: draft.clauses,
        quoteId: quoteId || undefined,
        contractValue: effectiveContractValue,
        paymentTerms: extractPaymentTermsFromClauses(draft.clauses),
      });
      setAiScore(review.score);
      setAiFindings(review.findings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI soạn thảo thất bại.');
      setStep(1);
    } finally {
      setGenerating(false);
      setReviewing(false);
    }
  }

  async function handleRefine() {
    setRefining(true);
    setError('');
    try {
      const refined = await seedingContractRepository.refineDraft({ clauses, findings: aiFindings });
      setClauses(refined.clauses);
      setAiFixApplied(true);
      setReviewing(true);
      const review = await seedingContractRepository.reviewRisk({
        clauses: refined.clauses,
        quoteId: quoteId || undefined,
        contractValue: effectiveContractValue,
        paymentTerms: extractPaymentTermsFromClauses(refined.clauses),
      });
      setAiScore(review.score);
      setAiFindings(review.findings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI chỉnh sửa thất bại.');
    } finally {
      setRefining(false);
      setReviewing(false);
    }
  }

  function updateClause(index: number, field: 'title' | 'body', value: string) {
    setClauses(current => current.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const contract = await seedingContractRepository.createContract({
        dealId: dealId || undefined,
        manualCustomerName: dealId ? undefined : manualCustomerName.trim() || undefined,
        quoteId: quoteId || undefined,
        title: title || 'Hợp đồng cung cấp dịch vụ',
        templateType,
        contractValue: effectiveContractValue,
        currency: selectedQuote?.currency || 'VND',
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        paymentTerms: extractPaymentTermsFromClauses(clauses),
        clauses,
        aiGenerated: true,
        aiRiskScore: aiScore ?? undefined,
        aiReview: aiFindings,
        aiPrompt: extraPrompt,
      });
      setCreatedContractId(contract.id);
      setCreatedContractNumber(contract.contractNumber);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được hợp đồng.');
    } finally {
      setSaving(false);
    }
  }

  function pdfSafe(value: string) {
    return value
      .normalize('NFD')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function buildSimplePdf(lines: string[]) {
    const content = [
      'BT',
      '/F1 13 Tf',
      '50 790 Td',
      ...lines.flatMap((line, index) => [index === 0 ? `(${pdfSafe(line)}) Tj` : `0 -20 Td (${pdfSafe(line)}) Tj`]),
      'ET',
    ].join('\n');
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(object => {
      offsets.push(pdf.length);
      pdf += object;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }

  function downloadBlob(content: string, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function downloadPdf() {
    const lines = [createdContractNumber, title, ...clauses.flatMap(c => [c.title, c.body, ''])];
    downloadBlob(buildSimplePdf(lines), `${createdContractNumber.replace(/[\\/:*?"<>|]/g, '-')}.pdf`, 'application/pdf');
  }

  function downloadWord() {
    const bodyHtml = clauses
      .map(c => `<h4>${escapeHtml(c.title)}</h4><p>${escapeHtml(c.body).replace(/\n/g, '<br/>')}</p>`)
      .join('');
    const html = `<html><head><meta charset="utf-8"></head><body><h2 style="text-align:center">${escapeHtml(title)}</h2><p style="text-align:center">Số: ${escapeHtml(createdContractNumber)}</p>${bodyHtml}</body></html>`;
    downloadBlob(html, `${createdContractNumber.replace(/[\\/:*?"<>|]/g, '-')}.doc`, 'application/msword');
  }

  function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c] as string));
  }

  async function sendForLegalReview() {
    if (!createdContractId) return;
    try {
      await seedingContractRepository.updateStatus(createdContractId, 'pending_legal');
      setStatusActionMessage('Đã gửi Pháp chế duyệt.');
    } catch (err) {
      setStatusActionMessage(err instanceof Error ? err.message : 'Không gửi được.');
    }
  }

  async function sendForSignature() {
    if (!createdContractId) return;
    try {
      await seedingContractRepository.updateStatus(createdContractId, 'pending_signature');
      setStatusActionMessage('Đã gửi yêu cầu ký điện tử.');
    } catch (err) {
      setStatusActionMessage(err instanceof Error ? err.message : 'Không gửi được.');
    }
  }

  if (!open) return null;

  return (
    <div className="crm-modal-backdrop" onClick={resetAndClose}>
      <div className="crm-modal crm-wizard-modal" onClick={event => event.stopPropagation()} style={{ maxWidth: '1100px' }}>
        <header className="crm-modal-header">
          <div>
            <h2 className="crm-modal-title">AI Contract Copilot</h2>
            <p className="crm-modal-subtitle">Soạn hợp đồng từ dữ liệu CRM và báo giá đã chốt.</p>
          </div>
          <button type="button" className="crm-modal-close" onClick={resetAndClose} aria-label="Đóng" disabled={generating || saving}>
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-modal-body crm-wizard-body">
          <div className="crm-wizard-content">
            {step === 1 ? (
              <div className="contract-source">
                <section className="contract-card">
                  <h3>Nguồn tạo hợp đồng</h3>
                  <p>Chọn một giao dịch, AI sẽ tự lấy dữ liệu đã có thay vì yêu cầu Sale nhập lại.</p>
                  <div className="contract-form">
                    <label>
                      Khách hàng CRM (tuỳ chọn)
                      <select value={dealId} onChange={event => setDealId(event.target.value)} disabled={loadingSource}>
                        <option value="">-- Không gắn CRM --</option>
                        {deals.map(deal => (
                          <option key={deal.id} value={deal.id}>
                            {deal.customer_name}{deal.company_name ? ` — ${deal.company_name}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!dealId ? (
                      <label>
                        Tên khách hàng (nhập tay)
                        <input
                          type="text"
                          value={manualCustomerName}
                          onChange={event => setManualCustomerName(event.target.value)}
                          placeholder="Không chọn khách hàng CRM ở trên thì nhập tên ở đây"
                        />
                      </label>
                    ) : null}

                    <div className="two">
                      <label>
                        Cơ hội bán hàng
                        <input
                          type="text"
                          readOnly
                          value={
                            selectedDeal
                              ? DEAL_STAGE_META[(selectedDeal.deal_stage || 'new_lead') as DealStage]?.label || selectedDeal.deal_stage || ''
                              : 'Chưa chọn khách hàng'
                          }
                          style={{ background: '#f8fafc', color: '#596477' }}
                        />
                      </label>
                      <label>
                        Báo giá đã chốt
                        <select value={quoteId} onChange={event => setQuoteId(event.target.value)} disabled={!dealId}>
                          <option value="">-- Không đính kèm báo giá --</option>
                          {quotes.map(quote => (
                            <option key={quote.id} value={quote.id}>
                              {quote.quoteNumber} · {formatVnd(quote.totalAmount)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      Giá trị hợp đồng (VND)
                      <CurrencyInput value={manualContractValue} onChange={setManualContractValue} />
                      {!selectedQuote ? (
                        <small style={{ color: '#bf7810' }}>Không đính kèm báo giá — bắt buộc nhập tay giá trị thật, nếu không hợp đồng sẽ lưu 0đ.</small>
                      ) : null}
                    </label>
                    {dealId && quotes.length === 0 ? (
                      <p style={{ color: '#bf7810', fontSize: '0.7rem', margin: 0 }}>
                        Khách hàng này chưa có báo giá đã duyệt — AI vẫn soạn được nhưng sẽ thiếu ngữ cảnh giá trị.
                      </p>
                    ) : null}

                    <label>
                      Mức độ chi tiết
                      <select value={detailLevel} onChange={event => setDetailLevel(event.target.value)}>
                        {DETAIL_LEVEL_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Mẫu hợp đồng (tuỳ chọn)
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                        <select
                          value={referenceTemplateId}
                          onChange={event => setReferenceTemplateId(event.target.value)}
                          style={{ flex: 1, marginTop: 0 }}
                        >
                          <option value="">-- Không dùng mẫu nào --</option>
                          {referenceTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="contract-button contract-button--secondary"
                          style={{ whiteSpace: 'nowrap' }}
                          disabled={refreshingTemplates}
                          onClick={() => void loadReferenceTemplates()}
                          title="Tải lại danh sách mẫu (vd. sau khi vừa upload mẫu mới)"
                        >
                          {refreshingTemplates ? '...' : '🔄 Làm mới'}
                        </button>
                        <a
                          href="/all-platform/contract-templates"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="contract-button contract-button--secondary"
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          Quản lý mẫu →
                        </a>
                      </div>
                    </label>
                    {referenceTemplates.length === 0 ? (
                      <p style={{ color: '#8791a0', fontSize: '0.68rem', margin: 0 }}>
                        Chưa có mẫu nào — bấm "Quản lý mẫu →" ở trên để tải lên (mở tab mới, không mất dữ liệu đang nhập).
                      </p>
                    ) : null}

                    <label>
                      Yêu cầu thêm cho AI
                      <textarea value={extraPrompt} onChange={event => setExtraPrompt(event.target.value)} />
                    </label>
                  </div>
                </section>
                <aside className="contract-card">
                  <h3>AI đã thu thập đủ ngữ cảnh</h3>
                  <p>Dữ liệu nguồn được liên kết và có thể truy vết khi cần kiểm tra.</p>
                  <div className="ai-context">
                    <div className="ai-context-row">
                      <b className="ai-context-row-icon">♙</b>
                      <span>
                        <strong>Hồ sơ pháp lý khách hàng</strong>
                        <small>{selectedDeal?.customer_name || manualCustomerName.trim() || 'Chưa có tên khách hàng'}</small>
                      </span>
                      <em>{selectedDeal || manualCustomerName.trim() ? 'Đủ' : '—'}</em>
                    </div>
                    <div className={`ai-context-row ${selectedQuote ? '' : 'warn'}`}>
                      <b className="ai-context-row-icon">▤</b>
                      <span>
                        <strong>Báo giá đã chốt</strong>
                        <small>{selectedQuote ? `${selectedQuote.quoteNumber} · ${formatVnd(selectedQuote.totalAmount)}` : 'Chưa đính kèm báo giá'}</small>
                      </span>
                      <em>{selectedQuote ? 'Đã chốt' : 'Thiếu'}</em>
                    </div>
                    <div className="ai-context-row">
                      <b className="ai-context-row-icon">⌁</b>
                      <span>
                        <strong>Cơ hội bán hàng</strong>
                        <small>
                          {selectedDeal
                            ? `${DEAL_STAGE_META[(selectedDeal.deal_stage || 'new_lead') as DealStage]?.label || selectedDeal.deal_stage} · phạm vi và ghi chú đàm phán`
                            : 'Chưa chọn khách hàng'}
                        </small>
                      </span>
                      <em>{selectedDeal ? 'Đã đồng bộ' : '—'}</em>
                    </div>
                    <div className="ai-context-row">
                      <b className="ai-context-row-icon">▣</b>
                      <span>
                        <strong>Điều khoản chuẩn Markee</strong>
                        <small>Thanh toán, nghiệm thu, bảo mật, trách nhiệm</small>
                      </span>
                      <em>V3.2</em>
                    </div>
                  </div>
                  <div className="ai-note">
                    ⚠ AI hỗ trợ soạn thảo và phát hiện rủi ro. Sale vẫn cần kiểm tra thông tin thương mại; Pháp chế duyệt các điều khoản có cảnh báo.
                  </div>
                </aside>
              </div>
            ) : null}

            {step === 2 ? (
              generating || (reviewing && clauses.length === 0) ? (
                <div className="contract-generating">
                  <div className="contract-ai-orb">✦</div>
                  <h3>AI đang soạn hợp đồng…</h3>
                  <p>Đối chiếu CRM, báo giá, mẫu chuẩn và chính sách phê duyệt</p>
                </div>
              ) : (
                <div className="contract-editor">
                  <aside className="contract-clause-nav">
                    <h3>Mục lục điều khoản</h3>
                    {clauses.map((clause, index) => (
                      <button
                        key={index}
                        type="button"
                        className="contract-clause-nav-item"
                        onClick={() => document.getElementById(`wizard-clause-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      >
                        {clause.title || `Điều khoản ${index + 1}`}
                        <span>{clause.body.trim().length > 0 ? '✓' : '!'}</span>
                      </button>
                    ))}
                  </aside>
                  <article className="contract-paper">
                    <header>
                      <small>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</small>
                      <h2>{title}</h2>
                      {generatedAt ? (
                        <p>
                          Dự thảo bởi AI lúc {generatedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })},{' '}
                          {generatedAt.toLocaleDateString('vi-VN')}
                        </p>
                      ) : null}
                      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          Ngày bắt đầu
                          <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
                        </label>
                        <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          Ngày kết thúc
                          <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
                        </label>
                      </div>
                    </header>
                    {clauses.map((clause, index) => (
                      <div key={index} id={`wizard-clause-${index}`} style={{ marginBottom: '0.8rem', scrollMarginTop: '1rem' }}>
                        <input
                          className="contract-clause-title"
                          value={clause.title}
                          onChange={event => updateClause(index, 'title', event.target.value)}
                        />
                        <textarea
                          className="contract-clause-body"
                          value={clause.body}
                          onChange={event => updateClause(index, 'body', event.target.value)}
                        />
                      </div>
                    ))}
                  </article>
                  <aside className="contract-ai-review">
                    <h3>AI kiểm tra rủi ro</h3>
                    {reviewing ? <p style={{ fontSize: '0.78rem', color: '#64748b' }}>Đang chấm điểm rủi ro...</p> : null}
                    {aiScore != null ? (
                      <div className="contract-review-score">
                        <b>{aiScore}</b>
                        <span>/ 100<br />{aiScore >= 80 ? 'Mức an toàn tốt' : aiScore >= 50 ? 'Cần lưu ý' : 'Rủi ro cao'}</span>
                      </div>
                    ) : null}
                    {aiFindings.map((finding, index) => (
                      <div key={index} className={`contract-review-item ${finding.severity}`}>
                        <strong>{finding.severity === 'ok' ? '✓' : '!'} {finding.title}</strong>
                        <small>{finding.detail}</small>
                      </div>
                    ))}
                    {aiFindings.some(f => f.severity === 'warn') ? (
                      <button
                        type="button"
                        className="contract-button contract-button--full"
                        disabled={refining || reviewing}
                        onClick={() => void handleRefine()}
                      >
                        {refining ? 'Đang chỉnh sửa...' : aiFixApplied ? '✓ Đã áp dụng đề xuất' : '✦ AI đề xuất chỉnh sửa'}
                      </button>
                    ) : null}
                  </aside>
                </div>
              )
            ) : null}

            {step === 3 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem 1rem' }}>
                <div style={{
                  width: '3.5rem', height: '3.5rem', margin: '0 auto', borderRadius: '50%',
                  background: '#e7f8f0', color: '#16845d', display: 'grid', placeItems: 'center', fontSize: '1.6rem',
                }}>✓</div>
                <h3 style={{ margin: '0.9rem 0 0.4rem' }}>Hợp đồng đã sẵn sàng để duyệt</h3>
                <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                  {createdContractNumber} đã lưu vào CRM và liên kết với khách hàng{selectedQuote ? ', báo giá' : ''}.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.6rem', margin: '1.4rem 0 0.8rem', flexWrap: 'wrap' }}>
                  <button type="button" className="contract-button contract-button--secondary" onClick={downloadWord}>↓ Tải Word</button>
                  <button type="button" className="contract-button contract-button--secondary" onClick={downloadPdf}>↓ Tải PDF</button>
                  <button type="button" className="contract-button contract-button--secondary" onClick={() => void sendForLegalReview()}>Gửi Pháp chế duyệt</button>
                  <button type="button" className="contract-button contract-button--primary" onClick={() => void sendForSignature()}>Gửi ký điện tử</button>
                </div>
                {statusActionMessage ? <small style={{ color: '#16845d' }}>{statusActionMessage}</small> : null}
              </div>
            ) : null}

            {error ? <p className="crm-error">{error}</p> : null}
          </div>
        </div>

        <footer className="crm-modal-footer">
          <div className="crm-footer-left">
            <button type="button" className="crm-cancel-button" onClick={resetAndClose} disabled={generating || saving}>
              {step === 3 ? 'Đóng' : 'Hủy'}
            </button>
          </div>
          <div className="crm-footer-right">
            {step === 1 ? (
              <button type="button" className="crm-save-button" onClick={() => void handleGenerate()}>
                ✦ AI soạn hợp đồng
              </button>
            ) : null}
            {step === 2 && !generating && !reviewing && clauses.length > 0 ? (
              <button type="button" className="crm-save-button crm-save-button--large" disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Đang lưu...' : 'Duyệt & lưu hợp đồng'}
              </button>
            ) : null}
            {step === 3 ? (
              <button
                type="button"
                className="crm-save-button"
                onClick={() => {
                  onCreated(createdContractId);
                  resetAndClose();
                }}
              >
                Xem hợp đồng
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
