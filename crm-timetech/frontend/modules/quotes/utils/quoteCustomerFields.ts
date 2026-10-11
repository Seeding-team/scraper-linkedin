import type { QuoteField, QuoteSchema } from '../types';

export interface CustomerDisplayField {
  key: string;
  label: string;
}

// Mac dinh 3 truong (Kinh gui/Khach hang/Email) - da BO customerPhone khoi
// mac dinh (yeu cau "3+3 field") - CHI anh huong bao gia/mau MOI chua tung
// luu visibleCustomerFields; bao gia/mau da luu lua chon rieng van giu
// nguyen qua resolveVisibleCustomerFieldKeys (doc `saved` truoc, chi fallback
// ve day khi saved null/undefined).
export const DEFAULT_VISIBLE_CUSTOMER_FIELD_KEYS = [
  'customerRecipient',
  'customerCompanyName',
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
