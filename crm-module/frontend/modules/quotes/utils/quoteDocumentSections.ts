import type { CustomBlock, QuoteData, QuoteSchema } from '../types';

export const QUOTE_DOCUMENT_SECTION_KEYS = {
  paymentPlan: 'paymentPlan',
  notes: 'notes',
  signatures: 'signatures',
} as const;

export interface QuoteDocumentSectionOption {
  key: string;
  label: string;
}

export function quoteCustomBlockSectionKey(block: Pick<CustomBlock, 'id'>, index: number): string {
  return `customBlock:${block.id || index}`;
}

export function isQuoteDocumentSectionVisible(data: QuoteData, key: string): boolean {
  const hidden = Array.isArray(data.hiddenDocumentSections) ? data.hiddenDocumentSections : [];
  return !hidden.includes(key);
}

export function getQuoteDocumentSectionOptions(schema: QuoteSchema, data: QuoteData): QuoteDocumentSectionOption[] {
  const options: QuoteDocumentSectionOption[] = [];
  if (schema.enableDynamicPaymentPlan || Array.isArray(data.paymentPlan)) {
    options.push({ key: QUOTE_DOCUMENT_SECTION_KEYS.paymentPlan, label: 'Kế hoạch thanh toán' });
  }
  const fields = schema.sections.flatMap(section => section.fields || []);
  if (fields.some(field => field.key === 'notes') || data.notes != null) {
    options.push({ key: QUOTE_DOCUMENT_SECTION_KEYS.notes, label: 'Ghi chú' });
  }
  if (Array.isArray(data.customBlocks)) {
    data.customBlocks.forEach((block, index) => {
      if (!block || !String(block.content || '').trim()) return;
      options.push({ key: quoteCustomBlockSectionKey(block, index), label: String(block.title || '').trim() || 'Nội dung bổ sung' });
    });
  }
  if (schema.layoutType !== 'villa_solution_package') options.push({ key: QUOTE_DOCUMENT_SECTION_KEYS.signatures, label: 'Chữ ký' });
  return options;
}
