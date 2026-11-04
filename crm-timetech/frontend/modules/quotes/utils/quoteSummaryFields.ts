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
  // "Giá gốc trước giảm" (2026-10-13) - TỔNG GỐC thật (truoc CA giam gia
  // hang muc lan toan bao gia, xem Totals.subtotalAmount) - CHI hien khi co
  // giam gia hang muc (QuoteDocumentRenderer tu an 'subtotalBeforeVat' luc
  // do de khong lap lai 2 dong gan nhu giong nhau) - tranh bug thuc te "hien
  // số đã giảm rồi (92,5tr) ngay phía trên dòng Giảm giá hạng mục (-17,4tr),
  // nhìn như bị trừ 2 lần" du tinh toan cuoi cung van dung.
  { key: 'grossSubtotal', label: 'Giá gốc trước giảm', order: 1, defaultVisible: true, required: false },
  { key: 'subtotalBeforeVat', label: 'Tổng cộng chưa bao gồm thuế GTGT', order: 2, defaultVisible: true, required: false },
  { key: 'overallDiscount', label: 'Giảm giá tổng (%)', order: 3, defaultVisible: true, required: false },
  // "Tổng tiền giảm = Giảm giá hạng mục + Giảm giá toàn báo giá" (2026-10-13,
  // gop lai thanh 1 dong duy nhat - BO rieng dong "Giảm giá hạng mục" theo
  // phan hoi "sếp thấy trùng với Tổng tiền giảm" khi khong co giam gia toan
  // bao gia, 2 dong hien y het nhau) - dong TONG HOP rieng, LUON hien mien
  // tong > 0 - xem cong thuc o totals.discountAmount +
  // discountSummary.overallDiscountAmount trong QuoteDocumentRenderer. Chuc
  // nang giam gia TUNG hang muc (cot "Giảm giá (%)" trong bang) KHONG doi gi.
  { key: 'totalDiscount', label: 'Tổng tiền giảm', order: 4, defaultVisible: true, required: false },
  // "chưa thấy tổng sau giảm giá" (2026-10-13) - truoc day CHI hien khi co
  // Giảm giá TOÀN báo giá (hasOverallDiscount), bo sot truong hop CHI co
  // giam gia hang muc (nhu quote 202610071107) - sua dieu kien thanh "co BAT
  // KY loai giam gia nao" trong QuoteDocumentRenderer.
  { key: 'subtotalAfterDiscount', label: 'Tổng sau giảm giá', order: 5, defaultVisible: true, required: false },
  { key: 'vatTotal', label: 'Thuế GTGT', order: 6, defaultVisible: true, required: false },
  { key: 'grandTotal', label: 'Tổng thanh toán', order: 7, defaultVisible: true, required: false },
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
