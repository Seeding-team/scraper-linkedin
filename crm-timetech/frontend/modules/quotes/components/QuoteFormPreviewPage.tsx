'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { QuoteForm, QuoteItem, VillaSolutionItem } from '../types';
import { calculateQuoteTotals, calculateVillaTotals } from '../utils/quoteCalculations';
import { QuoteDocumentRenderer } from './QuoteDocumentRenderer';

interface Props {
  formId: string;
}

/** Dữ liệu minh hoạ CHUNG cho mọi mẫu báo giá khi chưa có defaultValue riêng
 * (mẫu mới tạo, quoteItems chưa gán sẵn dữ liệu) — chỉ để xem thử bố cục/cột,
 * không gắn với nghiệp vụ cụ thể nào, tránh gây hiểu nhầm là dữ liệu thật của
 * mẫu đang xem (trước đây hard-code nội dung Douyin nên hiện sai ở mẫu khác). */
function sampleItems(vatRate = 10): QuoteItem[] {
  return [
    {
      serviceDescription: '[Ví dụ] Tên dịch vụ 1',
      description: '[Ví dụ] Mô tả dịch vụ 1',
      unit: 'Gói',
      quantity: 1,
      unitPrice: 5000000,
      discountPercent: 0,
      vatRate,
    },
    {
      serviceDescription: '[Ví dụ] Tên dịch vụ 2',
      description: '[Ví dụ] Mô tả dịch vụ 2',
      unit: 'Cái',
      quantity: 2,
      unitPrice: 1000000,
      discountPercent: 10,
      vatRate,
    },
  ];
}

export function QuoteFormPreviewPage({ formId }: Props) {
  const [form, setForm] = useState<QuoteForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    seedingQuoteRepository
      .getForm(formId)
      .then(setForm)
      .catch(err => setError(err instanceof Error ? err.message : 'Không tải được mẫu báo giá.'))
      .finally(() => setLoading(false));
  }, [formId]);

  if (loading) return <main className="quote-preview-page"><section className="quote-state">Đang tải bản xem trước...</section></main>;
  if (error || !form) return <main className="quote-preview-page"><section className="quote-state quote-state--error">{error || 'Không tìm thấy mẫu.'}</section></main>;

  const quoteData = Object.fromEntries(
    form.schemaJson.sections
      .flatMap(section => section.fields)
      .filter(field => field.key !== 'quoteItems' && field.key !== 'solutionItems')
      .map(field => [field.key, field.defaultValue || ''])
  );
  quoteData.quoteDate ||= new Date().toISOString().slice(0, 10);
  quoteData.quoteNumber ||= 'Sẽ sinh khi lưu';
  const fields = form.schemaJson.sections.flatMap(section => section.fields);
  const solutionItems = (fields.find(field => field.key === 'solutionItems')?.defaultValue || []) as VillaSolutionItem[];
  const defaultQuoteItems = fields.find(field => field.key === 'quoteItems')?.defaultValue;
  const items = Array.isArray(defaultQuoteItems)
    ? (defaultQuoteItems as QuoteItem[])
    : sampleItems(Number(quoteData.defaultVatRate || 10));
  const totals =
    form.schemaJson.layoutType === 'villa_solution_package'
      ? calculateVillaTotals(solutionItems)
      : calculateQuoteTotals(items);

  return (
    <main className="quote-preview-page">
      <header className="quote-head">
        <div>
          <h1>Xem trước mẫu báo giá</h1>
          <p>{form.name}</p>
        </div>
        <div className="quote-head-actions">
          <Link href="/all-platform/quotes" className="quote-button quote-button--secondary">Quay lại danh sách</Link>
          <Link href={`/all-platform/quotes/${form.id}/edit`} className="quote-button quote-button--primary">Chỉnh sửa</Link>
        </div>
      </header>
      <QuoteDocumentRenderer
        schemaSnapshot={form.schemaJson}
        quoteData={quoteData}
        quoteItems={items}
        solutionItems={solutionItems}
        totals={totals}
        mode="preview"
      />
    </main>
  );
}
