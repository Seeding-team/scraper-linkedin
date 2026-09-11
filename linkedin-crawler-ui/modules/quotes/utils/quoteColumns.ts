import type { QuoteField, QuoteItem, QuoteSchema } from '../types';

/** Cột mặc định khi mẫu KHÔNG khai báo cột nào trong schema (repeater-table
 * quoteItems trống config.columns) — chỉ dùng làm fallback cuối cùng, KHÔNG
 * phải danh sách cột cố định áp cho mọi mẫu. */
const FALLBACK_COLUMNS: QuoteField[] = [
  { key: 'order', label: 'STT', type: 'auto-number' },
  { key: 'serviceDescription', label: 'Hạng mục', type: 'text' },
  { key: 'unit', label: 'ĐVT', type: 'text' },
  { key: 'quantity', label: 'SL', type: 'number' },
  { key: 'unitPrice', label: 'Đơn giá', type: 'currency' },
  { key: 'vatRate', label: 'VAT', type: 'number' },
  { key: 'total', label: 'Thành tiền', type: 'currency' },
];

/** BUG THAT DA GAP ("cột hiển thị lấy sai kìa"/"cột không thuộc mẫu tuyệt đối
 * không xuất hiện"): 3 cot nay TRUOC DAY duoc TU DONG chen vao bat ke mau
 * bao gia co khai bao hay khong, chi vi hang muc co catalogItemId (lay tu
 * "Sản phẩm & dịch vụ") - vi pham nguyen tac "mẫu báo giá quyết định cột
 * nào duoc phep xuat hien". Khong co mau bao gia THAT nao trong seed data
 * khai bao 3 cot nay ca (da xac nhan qua audit) - DA XOA HAN logic tu chen,
 * chi con hien thi neu CHINH mau dang chon THAT SU khai bao trong
 * config.columns cua no. */

/** Tìm field bảng hạng mục THẬT của mẫu báo giá — không còn hardcode key
 * 'quoteItems'. Ưu tiên field key đúng 'quoteItems' nếu có (giữ nguyên hành vi
 * cũ tuyệt đối cho SecurityZone/Cloudgate/standard), nếu không có thì lấy field
 * repeater-table ĐẦU TIÊN tìm thấy trong schema (vd 'solutionItems' của mẫu
 * villa_solution_package). Tất cả mẫu hiện có (đã kiểm tra seed_quote_forms.py)
 * chỉ khai báo TỐI ĐA 1 field repeater-table mỗi schema, nên "đầu tiên tìm
 * thấy" không có rủi ro nhập nhằng thực tế — nếu sau này có mẫu khai 2 bảng
 * repeater-table, field xuất hiện trước trong danh sách section sẽ thắng. */
function findItemTableField(schema: QuoteSchema): QuoteField | undefined {
  const allFields = schema.sections.flatMap(section => section.fields);
  return allFields.find(field => field.key === 'quoteItems') || allFields.find(field => field.type === 'repeater-table');
}

/** Cột bảng hạng mục thật của MẪU này (đọc từ schema, không phải danh sách cố
 * định) — dùng chung cho cả QuoteDocumentRenderer (khi render) và
 * ReviewQuoteStep (khi dựng checkbox "Cột hiển thị"), để 2 nơi luôn khớp nhau.
 * `quoteItems` giữ lại trong chữ ký (khong xoa param, tranh doi API o moi
 * noi goi) nhung KHONG con dung de tu chen cot nao nua - "Mẫu báo giá quyết
 * định những cột nào được phép xuất hiện", du lieu hang muc co ton tai
 * khong dong nghia cot phai duoc hien thi (yeu cau ro rang). */
export function resolveQuoteItemColumns(schema: QuoteSchema, _quoteItems: QuoteItem[] = []): QuoteField[] {
  const itemField = findItemTableField(schema);
  const isQuoteItemsField = !itemField || itemField.key === 'quoteItems';

  if (!isQuoteItemsField) {
    // Bảng hạng mục KHÔNG phải quoteItems (vd solutionItems của villa) - cấu
    // trúc cột hoàn toàn khác (không có unitPrice/unit/vatRate/description...),
    // nên KHÔNG áp các phép bổ sung riêng của quoteItems bên dưới (mo ta/
    // discountPercent auto-insert) - trả đúng cột đã khai báo trong schema,
    // filter chỉ ẩn cột visible:false rõ ràng.
    const declaredColumns = itemField.config?.columns?.filter(column => column.visible !== false) || [];
    return declaredColumns.length ? declaredColumns : [...FALLBACK_COLUMNS];
  }

  // BUG THAT DA GAP ("List price USD/Unit Price USD/Unit price VND xuất
  // hiện dù mẫu không khai báo"): TRUOC DAY tu chen them CATALOG_PRICING_COLUMNS
  // vao day chi vi hang muc co catalogItemId, BAT KE mau co khai bao 3 cot
  // nay hay khong. DA BO HAN buoc chen nay - `baseColumns` (tu chinh
  // config.columns cua mau) la nguon DUY NHAT, mau nao khai bao 3 cot nay
  // that su thi chung da nam san trong baseColumns roi, khong can chen tay.
  const baseColumns = itemField?.config?.columns?.filter(column => column.visible !== false) || [];

  const columns = (baseColumns.length ? [...baseColumns] : [...FALLBACK_COLUMNS]).filter(
    column => !['subtotal', 'vatAmount'].includes(column.key)
  );
  if (!columns.some(column => column.key === 'order' || column.type === 'auto-number')) {
    columns.unshift({ key: 'order', label: 'STT', type: 'auto-number' });
  }
  if (!columns.some(column => column.key === 'description')) {
    const unitIndex = columns.findIndex(column => column.key === 'unit');
    columns.splice(unitIndex >= 0 ? unitIndex : 2, 0, { key: 'description', label: 'Mô tả', type: 'textarea' });
  }
  if (!columns.some(column => column.key === 'discountPercent')) {
    const vatIndex = columns.findIndex(column => column.key === 'vatRate');
    columns.splice(vatIndex >= 0 ? vatIndex : columns.length - 1, 0, { key: 'discountPercent', label: 'Giảm giá', type: 'number' });
  }
  return columns;
}

/** Cột "khoá" (STT + tên hạng mục chính) không bao giờ được ẩn khỏi khách —
 * quy tắc nghiệp vụ đã chốt: CHỈ khoá STT + 1 cột tên hạng mục, KHÔNG suy theo
 * cờ required:true trong schema (vd solutionItems có customerBenefit/
 * includedFeatures/offerPrice đều required:true ở nghĩa "bắt buộc điền form"
 * nhưng vẫn phải toggle được bình thường khi gửi khách — required:true chỉ
 * kiểm soát validate lúc điền form, không liên quan hiển thị/ẩn cột lúc gửi).
 * Khoá theo field key của BẢNG hạng mục (xem findItemTableField), không phải
 * danh sách cố định toàn cục — mẫu mới thêm bảng khác cần khai thêm 1 dòng ở
 * đây (mặc định fallback chỉ khoá 'order' nếu không khai). */
const LOCKED_COLUMN_KEYS_BY_ITEM_FIELD_KEY: Record<string, string[]> = {
  quoteItems: ['order', 'serviceDescription'],
  solutionItems: ['order', 'solutionName'],
};

/** Cột ẩn hẳn khỏi khối "Cột hiển thị" (không phải khoá bắt buộc, cũng không
 * phải tuỳ chọn — đơn giản không hiện trong picker).
 * "discountPercent" (Giảm giá) TRƯỚC ĐÂY bị ẩn ở đây (luôn hiện trong bảng,
 * không cho toggle) - QA thực tế phát hiện điều này khiến khối "Cột hiển thị"
 * KHÔNG khớp với các cột thật sự có trên bảng gửi khách (thiếu hẳn 1 dòng
 * checkbox cho cột đang hiển thị), gây hiểu lầm. Đã bỏ exception này - xem
 * QuoteDocumentRenderer.tsx (AUTO_INCLUDE_LEGACY_COLUMN_KEYS) để biết cách xử
 * lý tương thích ngược cho báo giá CŨ đã lưu visibleColumns từ trước khi
 * 'discountPercent' là toggle option. */
const HIDDEN_FROM_PICKER_KEYS_BY_ITEM_FIELD_KEY: Record<string, string[]> = {};

/** Key của field bảng hạng mục thật của mẫu này ('quoteItems'/'solutionItems'/
 * ... ) - dùng để tra LOCKED_COLUMN_KEYS_BY_ITEM_FIELD_KEY ở cả quoteColumns.ts
 * và ReviewQuoteStep.tsx (khối "Cột hiển thị"), tránh trùng lặp logic. */
export function getItemTableFieldKey(schema: QuoteSchema): string {
  return findItemTableField(schema)?.key || 'quoteItems';
}

/** Cột khoá (STT + tên hạng mục) của mẫu này - dùng để hiện dòng 🔒 "Bắt buộc"
 * trong khối "Cột hiển thị" (ReviewQuoteStep.tsx). */
export function getLockedColumnKeys(schema: QuoteSchema): string[] {
  return LOCKED_COLUMN_KEYS_BY_ITEM_FIELD_KEY[getItemTableFieldKey(schema)] || ['order'];
}

export function resolveToggleableColumns(schema: QuoteSchema, quoteItems: QuoteItem[] = []): QuoteField[] {
  const itemFieldKey = getItemTableFieldKey(schema);
  const lockedKeys = new Set(LOCKED_COLUMN_KEYS_BY_ITEM_FIELD_KEY[itemFieldKey] || ['order']);
  const hiddenKeys = new Set(HIDDEN_FROM_PICKER_KEYS_BY_ITEM_FIELD_KEY[itemFieldKey] || []);
  return resolveQuoteItemColumns(schema, quoteItems).filter(
    column =>
      !lockedKeys.has(column.key) &&
      !hiddenKeys.has(column.key) &&
      column.type !== 'auto-number' &&
      column.type !== 'calculated'
  );
}
