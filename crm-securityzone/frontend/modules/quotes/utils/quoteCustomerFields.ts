import type { QuoteField, QuoteSchema } from '../types';

export interface CustomerDisplayField {
  key: string;
  label: string;
}

export const DEFAULT_VISIBLE_CUSTOMER_FIELD_KEYS = [
  'customerRecipient',
  'customerCompanyName',
  'customerPhone',
  'customerEmail',
];

const CUSTOMER_LABEL_OVERRIDES: Record<string, string> = {
  customerRecipient: 'Kính gửi',
  customerCompanyName: 'Khách hàng',
  customerPhone: 'SĐT liên hệ',
  customerEmail: 'Email liên hệ',
};

function normalizedCustomerLabel(field: Pick<QuoteField, 'key' | 'label'>): string {
  return CUSTOMER_LABEL_OVERRIDES[field.key] || field.label || field.key;
}

export function getCustomerDisplayFields(schema: QuoteSchema): CustomerDisplayField[] {
  const customerSection = schema.sections.find(section => section.key === 'customer');
  const fields = (customerSection?.fields || [])
    .filter(field => field.visible !== false)
    .map(field => ({ key: field.key, label: normalizedCustomerLabel(field) }));
  if (!fields.some(field => field.key === 'customerRecipient')) {
    fields.unshift({ key: 'customerRecipient', label: CUSTOMER_LABEL_OVERRIDES.customerRecipient });
  }
  return fields;
}

export function resolveVisibleCustomerFieldKeys(
  schema: QuoteSchema,
  saved?: string[] | null
): string[] {
  const supportedKeys = getCustomerDisplayFields(schema).map(field => field.key);
  const base = Array.isArray(saved) ? saved : DEFAULT_VISIBLE_CUSTOMER_FIELD_KEYS;
  return base.filter(key => supportedKeys.includes(key));
}
