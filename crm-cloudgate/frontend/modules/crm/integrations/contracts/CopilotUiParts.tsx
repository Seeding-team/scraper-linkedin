'use client';

/**
 * Bo cuc MOT COT cua modal AI Contract Copilot khi mo tu Customer 360 (UI-first): Nguon hop dong -> Du lieu CRM -> Yeu cau AI.
 * Chi la lop trinh bay: toan bo state/ham lay du lieu (khach -> co hoi -> bao gia -> gia tri) van nam trong ContractAIWizard.
 * Dropdown dung SearchableSelect co san (portal, tim khong dau, phim tat, loading/empty). Chua noi AI/xu ly file.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Quote } from '@/modules/quotes';
import type { ContractTemplate } from '@/modules/contract-templates';
import type { Customer } from '@/services/customer-lead.service';
import { CurrencyInput } from '@/components/CurrencyInput';
import { formatVnd } from '@/modules/quotes/utils/quoteCalculations';
import { formatQuoteAmountOr } from '@/lib/currency';
import { SearchableSelect } from '../../components/SearchableSelect';
import { DEAL_STAGE_META } from '../../constants/crmConfig';
import { CONTRACT_TEMPLATE_OPTIONS } from '@/modules/contracts/constants/contractConfig';
import type { ContractTemplateType } from '@/modules/contracts/types';

export const DETAIL_LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'standard', label: 'Tiêu chuẩn · Khuyến nghị' },
  { value: 'concise', label: 'Tinh gọn' },
  { value: 'legal', label: 'Chi tiết pháp lý' },
];
import type { DealStage } from '../../types';

export const PROMPT_SUGGESTIONS: Array<{ label: string; text: string }> = [
  { label: 'Thanh toán', text: 'Thay điều khoản thanh toán: 50% khi ký, 40% khi bàn giao, 10% sau nghiệm thu.' },
  { label: 'Bảo hành', text: 'Bảo hành 12 tháng kể từ ngày nghiệm thu.' },
  { label: 'Tiến độ', text: 'Thời gian triển khai 45 ngày kể từ ngày ký.' },
  { label: 'Nghiệm thu', text: 'Điều chỉnh điều khoản nghiệm thu: nghiệm thu trong 7 ngày làm việc.' },
  { label: 'Trách nhiệm', text: 'Bổ sung trách nhiệm hai bên về bảo mật thông tin.' },
];

const ellipsis: React.CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };

function Group({ index, title, hint, children }: { index: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section style={{ padding: '1rem 0', borderTop: index === 1 ? 'none' : '1px solid #eef2f7' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: '0.6rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>{index}. {title}</h3>
        {hint ? <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  );
}

const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' };

export function UiOnlyBanner() {
  return (
    <p role="note" data-testid="copilot-uionly-banner" style={{ margin: '0.5rem auto 0', maxWidth: 860, width: '100%', fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center' }}>
      Mẫu .docx được chỉnh trực tiếp để giữ nguyên bố cục; PDF xuất ra từ chính file DOCX đã duyệt.
    </p>
  );
}

function dealLabel(deal: Customer): string {
  return deal.customer_name || deal.company_name || 'Khách hàng';
}

export function CopilotCustomerForm({
  deals, loadingSource, dealId, onDeal, selectedDeal,
  quotes, quoteId, onQuote, selectedQuote,
  contractValue, onContractValue,
  templates, templateId, onTemplate, refreshing, onRefreshTemplates,
  templateFile, onTemplateFile, templateType, onTemplateType, detailLevel, onDetailLevel, referenceNote,
  prompt, onPrompt, onOpenLibrary, lockedCustomerName,
}: {
  deals: Customer[]; loadingSource: boolean; dealId: string; onDeal: (id: string) => void; selectedDeal: Customer | null;
  quotes: Quote[]; quoteId: string; onQuote: (id: string) => void; selectedQuote: Quote | null;
  contractValue: number | null; onContractValue: (value: number | null) => void;
  templates: ContractTemplate[]; templateId: string; onTemplate: (id: string) => void; refreshing: boolean; onRefreshTemplates: () => void;
  templateFile: { name: string; size: number; file?: File } | null; onTemplateFile: (file: { name: string; size: number; file?: File } | null) => void;
  templateType: ContractTemplateType; onTemplateType: (value: ContractTemplateType) => void; detailLevel: string; onDetailLevel: (value: string) => void;
  /** Ghi chú cho mẫu PDF vừa chọn (chỉ tham chiếu, không giữ form / scan không hỗ trợ). */
  referenceNote?: string;
  prompt: string; onPrompt: (value: string) => void; onOpenLibrary: () => void;
  /** Co => khoa khach hang (Customer 360): hien readonly, khong cho doi sang khach khac. */
  lockedCustomerName?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Khach hang (gom theo customer_id) -> Co hoi cua khach do. Doi khach: bo co hoi/bao gia/gia tri cu; chi tu chon khi khach co DUNG 1 co hoi.
  const keyOf = (deal: Customer) => deal.customer_id || `deal:${deal.id}`;
  const [customerKey, setCustomerKey] = useState('');
  useEffect(() => { if (lockedCustomerName && deals[0]) setCustomerKey(keyOf(deals[0])); }, [lockedCustomerName, deals]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedDeal) setCustomerKey(keyOf(selectedDeal)); }, [selectedDeal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [itemsOpen, setItemsOpen] = useState(false);
  const items = (selectedQuote?.items || []).filter(i => i.rowType !== 'section');

  const customers = Array.from(new Map(deals.map(deal => [keyOf(deal), deal])).values());
  const dealsOfCustomer = deals.filter(deal => keyOf(deal) === customerKey);
  const customerOptions = customers.map(deal => {
    const label = dealLabel(deal);
    const sub = deal.company_name && deal.company_name !== deal.customer_name ? deal.company_name : '';
    const code = (deal as { customer_code?: string | null }).customer_code || '';
    return {
      value: keyOf(deal), label,
      searchText: [deal.customer_name, deal.company_name, code].filter(Boolean).join(' '),
      richLabel: (
        <span style={{ display: 'grid', minWidth: 0 }} title={`${label}${sub ? ` — ${sub}` : ''}`}>
          <b style={{ ...ellipsis, fontSize: '0.84rem' }}>{label}</b>
          {sub ? <small style={{ ...ellipsis, color: '#64748b' }}>{sub}</small> : null}
        </span>
      ),
    };
  });
  const dealOptions = dealsOfCustomer.map(deal => {
    const stage = DEAL_STAGE_META[(deal.deal_stage || 'new_lead') as DealStage]?.label || deal.deal_stage || '';
    const extra = [(deal as { service_package?: string | null }).service_package, (deal as { estimated_budget?: number | null }).estimated_budget ? formatVnd(Number((deal as { estimated_budget?: number }).estimated_budget)) : ''].filter(Boolean).join(' · ');
    const label = [stage, extra].filter(Boolean).join(' · ') || 'Cơ hội';
    return { value: deal.id, label, searchText: label, richLabel: <span style={ellipsis} title={label}>{label}</span> };
  });
  function pickCustomer(key: string) {
    setCustomerKey(key);
    if (!key) { onDeal(''); return; }
    const mine = deals.filter(deal => keyOf(deal) === key);
    onDeal(mine.length === 1 ? mine[0].id : '');
  }
  const quoteOptions = quotes.map(quote => {
    const label = `${quote.quoteNumber} · ${formatQuoteAmountOr(quote.totalAmount, quote.currency, formatVnd)}`;
    return { value: quote.id, label, searchText: `${quote.quoteNumber} ${quote.data?.quoteTitle || ''}`, richLabel: <span style={ellipsis} title={label}>{label}</span> };
  });
  const templateOptions = templates.map(t => ({ value: t.id, label: t.name, searchText: `${t.name} ${t.fileName || ''}`, richLabel: <span style={ellipsis} title={t.name}>{t.name}</span> }));

  return (
    <div data-testid="contract-copilot-form" style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <Group index={1} title="Mẫu hợp đồng" hint="Tải mẫu lên hoặc chọn từ thư viện">
        {(
          <div data-testid="copilot-template-extra">
            <div style={grid2}>
              <Field label="Tải mẫu DOCX / PDF">
                <input ref={fileRef} type="file" hidden accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={event => { const f = event.target.files?.[0]; onTemplateFile(f ? { name: f.name, size: f.size, file: f } : null); if (f) onTemplate(''); event.target.value = ''; }} />
                <button type="button" className="contract-button contract-button--secondary" onClick={() => fileRef.current?.click()} title={templateFile?.name}
                  style={{ justifyContent: 'flex-start', minWidth: 0, height: 40 }}>
                  <span data-testid="copilot-file" style={ellipsis}>{templateFile ? templateFile.name : '⬆ Chọn file từ máy'}</span>
                </button>
                {templateFile ? <button type="button" onClick={() => onTemplateFile(null)} data-testid="copilot-file-clear" style={{ justifySelf: 'start', background: 'none', border: 0, color: '#c2185b', fontSize: '0.72rem', cursor: 'pointer', padding: 0 }}>Bỏ file đã chọn</button> : null}
              </Field>
              <Field label={templateFile ? 'Mẫu đã lưu (bỏ file đã chọn để dùng)' : 'Hoặc chọn mẫu đã lưu'}>
                <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <SearchableSelect disabled={!!templateFile} value={templateId} onChange={id => { onTemplate(id); if (id) onTemplateFile(null); }} options={templateOptions} placeholder="-- Chọn mẫu --" searchPlaceholder="Tìm mẫu..." emptyText="Chưa có mẫu nào" />
                  </div>
                  <button type="button" className="contract-button contract-button--secondary" onClick={onOpenLibrary} disabled={!!templateFile} data-testid="copilot-open-library" title="Mở thư viện mẫu hợp đồng" style={{ height: 40, whiteSpace: 'nowrap' }}>Thư viện</button>
                </div>
              </Field>
            </div>
            {referenceNote ? <p data-testid="copilot-reference-note" style={{ margin: '0.5rem 0 0', fontSize: '0.76rem', color: '#9a3412' }}>{referenceNote}</p> : null}
            {!templateFile && !templateId ? (
              <div data-testid="copilot-newdraft-options" style={{ marginTop: '0.7rem' }}>
                <p style={{ margin: '0 0 0.4rem', fontSize: '0.76rem', color: '#475569' }}>Không chọn mẫu: AI soạn mới từ dữ liệu CRM, báo giá và yêu cầu của bạn.</p>
                <div style={grid2}>
                  <Field label="Loại hợp đồng">
                    <select data-testid="copilot-contract-type" value={templateType} onChange={event => onTemplateType(event.target.value as ContractTemplateType)} style={{ height: 40, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 0.6rem' }}>
                      {CONTRACT_TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Mức độ chi tiết">
                    <select data-testid="copilot-detail-level" value={detailLevel} onChange={event => onDetailLevel(event.target.value)} style={{ height: 40, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 0.6rem' }}>
                      {DETAIL_LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            ) : null}
            {templateFile && /\.docx$/i.test(templateFile.name) ? <p style={{ margin: '0.5rem 0 0', fontSize: '0.76rem', color: '#16845d' }}>Mẫu .docx được chỉnh trực tiếp, giữ nguyên bố cục.</p> : null}
          </div>
        )}
      </Group>

      <Group index={2} title="Dữ liệu CRM">
        <div style={grid2}>
          <Field label="Khách hàng">
            {lockedCustomerName ? (
              <input type="text" readOnly value={lockedCustomerName} title={lockedCustomerName} data-testid="copilot-customer-locked"
                style={{ height: 40, background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0 0.7rem', minWidth: 0, fontWeight: 600, textOverflow: 'ellipsis' }} />
            ) : (
              <SearchableSelect value={customerKey} onChange={pickCustomer} options={customerOptions} loading={loadingSource} placeholder="-- Không gắn CRM --" searchPlaceholder="Tìm tên khách, công ty, mã KH..." emptyText="Không tìm thấy khách hàng" testId="copilot-customer-select" />
            )}
          </Field>
          <Field label="Cơ hội bán hàng">
            <SearchableSelect value={dealId} onChange={onDeal} options={dealOptions} disabled={!customerKey} hideClearOption
              placeholder={!customerKey ? 'Chọn khách hàng trước' : dealOptions.length > 1 ? `Chọn 1 trong ${dealOptions.length} cơ hội` : dealOptions.length === 0 ? 'Khách hàng chưa có cơ hội' : '-- Chọn cơ hội --'}
              searchPlaceholder="Tìm cơ hội..." emptyText="Không có cơ hội" testId="copilot-deal-select" />
          </Field>
          <Field label="Báo giá đã chốt">
            <SearchableSelect value={quoteId} onChange={onQuote} options={quoteOptions} disabled={!dealId} placeholder={!dealId ? 'Chọn cơ hội trước' : quotes.length === 0 ? 'Cơ hội chưa có báo giá đã duyệt' : '-- Không đính kèm báo giá --'} searchPlaceholder="Tìm số báo giá..." emptyText="Không có báo giá" testId="copilot-quote-select" />
          </Field>
          {selectedQuote ? (
            <Field label="Giá trị hợp đồng (VND)">
              <CurrencyInput value={contractValue} onChange={onContractValue} />
            </Field>
          ) : null}
        </div>
        {selectedQuote ? (
          <div data-testid="copilot-quote-preview" style={{ marginTop: '0.7rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
            <button type="button" onClick={() => setItemsOpen(open => !open)} aria-expanded={itemsOpen}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '0.5rem 0.75rem', background: 'transparent', border: 0, cursor: 'pointer', fontSize: '0.8rem', color: '#334155', textAlign: 'left' }}>
              <span><b>{items.length} hạng mục</b> · Tổng {formatQuoteAmountOr(selectedQuote.totalAmount, selectedQuote.currency, formatVnd)}</span>
              <span style={{ color: '#c2185b', fontWeight: 700 }}>{itemsOpen ? 'Thu gọn ▴' : 'Xem chi tiết ▾'}</span>
            </button>
            {itemsOpen ? (
              <div style={{ overflowX: 'auto', padding: '0 0.75rem 0.6rem' }}>
                {items.length === 0 ? <small style={{ color: '#c2410c' }}>Báo giá chưa có hạng mục.</small> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                    <thead><tr style={{ textAlign: 'left', color: '#64748b' }}><th>#</th><th>Hạng mục</th><th style={{ textAlign: 'right' }}>SL</th><th style={{ textAlign: 'right' }}>Đơn giá</th><th style={{ textAlign: 'right' }}>VAT</th><th style={{ textAlign: 'right' }}>Thành tiền</th></tr></thead>
                    <tbody>
                      {items.map((item, index) => {
                        const line = item.amountAfterDiscount ?? (Number(item.unitPrice || 0) * Number(item.quantity || 0));
                        const vat = (item as { vatRate?: number | null }).vatRate;
                        return (
                          <tr key={item.id || index} style={{ borderTop: '1px solid #e8edf3' }}>
                            <td>{index + 1}</td><td>{item.description || item.serviceDescription || '—'}</td>
                            <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                            <td style={{ textAlign: 'right' }}>{item.unitPrice != null ? formatQuoteAmountOr(item.unitPrice, selectedQuote.currency, formatVnd) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{vat != null ? `${vat}%` : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{formatQuoteAmountOr(line, selectedQuote.currency, formatVnd)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Group>

      <Group index={3} title="Yêu cầu AI chỉnh sửa hợp đồng">
        <textarea
          data-testid="copilot-prompt"
          value={prompt}
          onChange={event => onPrompt(event.target.value)}
          placeholder="VD: Thanh toán 50% khi ký, 40% khi bàn giao và 10% sau nghiệm thu. Thời gian triển khai 45 ngày."
          style={{ width: '100%', minHeight: '8rem', resize: 'vertical', border: '1px solid #cbd5e1', borderRadius: 10, padding: '0.7rem 0.8rem', fontSize: '0.88rem', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {PROMPT_SUGGESTIONS.map(s => (
            <button key={s.label} type="button" onClick={() => onPrompt(prompt.trim() ? `${prompt.trim()}\n${s.text}` : s.text)}
              style={{ fontSize: '0.74rem', padding: '3px 10px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#334155', cursor: 'pointer' }}>
              + {s.label}
            </button>
          ))}
        </div>
      </Group>
    </div>
  );
}
