'use client';

import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { QuoteForm, QuoteItem, VillaSolutionItem } from '../types';
import { calculateQuoteTotals, calculateVillaTotals } from '../utils/quoteCalculations';
import { QuoteDocumentRenderer } from './QuoteDocumentRenderer';

interface Props {
  token: string;
}

export function PublicQuoteFormPage({ token }: Props) {
  const [form, setForm] = useState<QuoteForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    seedingQuoteRepository
      .getPublicForm(token)
      .then(row => {
        setForm(row);
        document.title = row.name || 'Mẫu báo giá';
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Không tải được mẫu báo giá.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <main className="public-form-page"><section className="quote-state">Đang tải mẫu báo giá...</section></main>;
  if (error || !form) return <main className="public-form-page"><section className="quote-state quote-state--error">{error || 'Không tìm thấy mẫu báo giá.'}</section></main>;

  const fields = form.schemaJson.sections.flatMap(section => section.fields);
  const quoteData = Object.fromEntries(fields.map(field => [field.key, field.defaultValue || '']));
  const defaultQuoteItems = fields.find(field => field.key === 'quoteItems')?.defaultValue;
  const items = (Array.isArray(defaultQuoteItems) ? defaultQuoteItems : []) as QuoteItem[];
  const solutionItems = (fields.find(field => field.key === 'solutionItems')?.defaultValue || []) as VillaSolutionItem[];
  const totals =
    form.schemaJson.layoutType === 'villa_solution_package'
      ? calculateVillaTotals(solutionItems)
      : calculateQuoteTotals(items);

  return (
    <main className="public-form-page">
      <header className="public-toolbar no-print">
        <div>
          <h1>{form.name}</h1>
          <p>{form.description}</p>
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
