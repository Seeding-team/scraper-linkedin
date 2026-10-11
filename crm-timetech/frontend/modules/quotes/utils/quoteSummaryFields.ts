import type { QuoteSchema, SummaryFieldConfig } from '../types';

/** 5 dòng của khối tổng tiền cuối báo giá ("Tổng hợp giá" trong Cột hiển thị) -
 * KHÁC HOÀN TOÀN cột bảng hạng mục (xem quoteColumns.ts). Đây là resolver
 * riêng theo đúng yêu cầu "không nhét 5 key này vào finalColumns của bảng".
 *
 * Mặc định KHÔNG khoá trường nào (required:false cho cả 5) - mẫu nào thực sự
 * cần bắt buộc 1 trường nào đó (vd không cho tắt "Tổng thanh toán") thì tự khai
 * riêng required:true trong CHÍNH schema.summaryFields của mẫu đó, không suy
 * diễn từ hằng số dùng chung này. */
export const DEFAULT_SUMMARY_FIELDS: SummaryFieldConfig[] = [
  { key: 'subtotalBeforeVat', label: 'Tổng cộng chưa bao gồm thuế GTGT', order: 1, defaultVisible: true, required: false },
  { key: 'overallDiscount', label: 'Giảm giá tổng (%)', order: 2, defaultVisible: true, required: false },
  { key: 'subtotalAfterDiscount', label: 'Tổng sau giảm giá', order: 3, defaultVisible: true, required: false },
  { key: 'vatTotal', label: 'Thuế GTGT', order: 4, defaultVisible: true, required: false },
  { key: 'grandTotal', label: 'Tổng thanh toán', order: 5, defaultVisible: true, required: false },
];

/** Trường "Tổng hợp giá" THẬT của mẫu này - đọc thẳng schema.summaryFields (mẫu
 * quyết định trường nào hỗ trợ/mặc định/bắt buộc), fallback DEFAULT_SUMMARY_FIELDS
 * CHỈ khi schema chưa khai (mẫu cũ chưa backfill / layoutType tương lai chưa
 * lường trước) - KHÔNG có nhánh if(layoutType===...) nào ở đây. */
const DEFAULT_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  DEFAULT_SUMMARY_FIELDS.map(field => [field.key, field.label as string])
);

export function getSupportedSummaryFields(schema: QuoteSchema): SummaryFieldConfig[] {
  const configured = Array.isArray(schema?.summaryFields) && schema.summaryFields.length
    ? schema.summaryFields
    : DEFAULT_SUMMARY_FIELDS;
  // `label` la optional trong SummaryFieldConfig (schema tuong lai co the chi
  // khai key/order/required ma khong lap lai nhan van) - fallback ve nhan mac
  // dinh theo key de khong bao gio render "undefined" trong Cot hien thi.
  return [...configured]
    .map(field => ({ ...field, label: field.label || DEFAULT_LABEL_BY_KEY[field.key] || field.key }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Trường bị khoá (required:true) - hiện dòng 🔒 "Bắt buộc" trong Cột hiển thị,
 * không có checkbox để tắt. */
export function getLockedSummaryFieldKeys(schema: QuoteSchema): string[] {
  return getSupportedSummaryFields(schema).filter(field => field.required).map(field => field.key);
}

export function resolveToggleableSummaryFields(schema: QuoteSchema): SummaryFieldConfig[] {
  return getSupportedSummaryFields(schema).filter(field => !field.required);
}

/** Danh sách key thật sự hiện cho khách - hợp: locked keys (luôn có mặt) +
 * (saved ∩ toggleable) nếu đã từng lưu, hoặc (defaultVisible ∩ toggleable) nếu
 * chưa lưu gì - mirror đúng logic reconciliation của visibleColumns
 * (QuoteColumnVisibilityPicker.tsx). */
export function resolveVisibleSummaryFieldKeys(
  schema: QuoteSchema,
  saved?: string[] | null
): string[] {
  const supported = getSupportedSummaryFields(schema);
  // Ep ve string[] tuong minh (thay vi de TS suy ra mang union hep tu
  // SummaryFieldConfig['key']) - can so sanh voi `saved`/key vong lap kieu
  // string thuan, ep kieu o day tranh loi "Argument of type 'string' is not
  // assignable to..." khi goi .includes(key) ben duoi.
  const supportedKeys: string[] = supported.map(field => field.key);
  const lockedKeys: string[] = supported.filter(field => field.required).map(field => field.key);
  const toggleableKeys: string[] = supported.filter(field => !field.required).map(field => field.key);
  const defaultVisibleKeys: string[] = supported.filter(field => field.defaultVisible !== false).map(field => field.key);
  const base = Array.isArray(saved)
    ? saved.filter(key => toggleableKeys.includes(key))
    : defaultVisibleKeys.filter(key => toggleableKeys.includes(key));
  return [...new Set([...lockedKeys, ...base])].filter(key => supportedKeys.includes(key));
}
