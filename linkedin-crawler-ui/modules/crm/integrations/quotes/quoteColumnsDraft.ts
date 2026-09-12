// Nháp lựa chọn "Cột hiển thị" (visibleColumns) của báo giá ĐANG TẠO (chưa lưu)
// trong wizard — lưu localStorage theo đúng mẫu báo giá (quoteFormId) để lỡ
// refresh trang / đóng modal giữa chừng vẫn không mất lựa chọn cột đã tuỳ
// chỉnh, và lần sau tạo báo giá mới cùng mẫu này sẽ tự khôi phục lại đúng lựa
// chọn cũ thay vì luôn reset về "hiện tất cả". Mirror đúng pattern
// CRM_DEAL_DRAFT_KEY trong DealFormModal.tsx (đọc/ghi/try-catch giống hệt),
// KHÔNG phải cơ chế mới. Đây KHÔNG phải persistence chính thức của báo giá đã
// lưu — visibleColumns của báo giá đã lưu nằm trong quotes.data (JSONB), tự
// round-trip qua create/update API bình thường, không liên quan file này.
const QUOTE_VISIBLE_COLUMNS_DRAFT_PREFIX = 'crm:quote-visible-columns-draft:v1:';

function draftKey(quoteFormId: string): string {
  return `${QUOTE_VISIBLE_COLUMNS_DRAFT_PREFIX}${quoteFormId}`;
}

export function loadVisibleColumnsDraft(quoteFormId?: string): string[] | null {
  if (typeof window === 'undefined' || !quoteFormId) return null;
  try {
    const raw = window.localStorage.getItem(draftKey(quoteFormId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export function saveVisibleColumnsDraft(quoteFormId: string | undefined, columns: string[]): void {
  if (typeof window === 'undefined' || !quoteFormId) return;
  try {
    window.localStorage.setItem(draftKey(quoteFormId), JSON.stringify(columns));
  } catch {
    // localStorage đầy/bị chặn - bỏ qua, không phải lỗi nghiêm trọng.
  }
}

export function clearVisibleColumnsDraft(quoteFormId?: string): void {
  if (typeof window === 'undefined' || !quoteFormId) return;
  try {
    window.localStorage.removeItem(draftKey(quoteFormId));
  } catch {
    // ignore
  }
}

// Nháp lựa chọn "Tổng hợp giá" (visibleSummaryFields) - mirror y hệt pattern
// visibleColumns ở trên, prefix key riêng để không lẫn 2 nhóm. CHỈ dùng làm
// nháp TRƯỚC KHI lưu quote - visibleSummaryFields của quote đã lưu nằm trong
// quotes.data (JSONB), round-trip qua create/update API bình thường như
// visibleColumns, không liên quan file này.
const QUOTE_VISIBLE_SUMMARY_FIELDS_DRAFT_PREFIX = 'crm:quote-visible-summary-fields-draft:v1:';

function summaryFieldsDraftKey(quoteFormId: string): string {
  return `${QUOTE_VISIBLE_SUMMARY_FIELDS_DRAFT_PREFIX}${quoteFormId}`;
}

export function loadVisibleSummaryFieldsDraft(quoteFormId?: string): string[] | null {
  if (typeof window === 'undefined' || !quoteFormId) return null;
  try {
    const raw = window.localStorage.getItem(summaryFieldsDraftKey(quoteFormId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export function saveVisibleSummaryFieldsDraft(quoteFormId: string | undefined, keys: string[]): void {
  if (typeof window === 'undefined' || !quoteFormId) return;
  try {
    window.localStorage.setItem(summaryFieldsDraftKey(quoteFormId), JSON.stringify(keys));
  } catch {
    // localStorage đầy/bị chặn - bỏ qua, không phải lỗi nghiêm trọng.
  }
}

export function clearVisibleSummaryFieldsDraft(quoteFormId?: string): void {
  if (typeof window === 'undefined' || !quoteFormId) return;
  try {
    window.localStorage.removeItem(summaryFieldsDraftKey(quoteFormId));
  } catch {
    // ignore
  }
}
