/** Formatter/parser tiền tệ DÙNG CHUNG cho toàn app (input lẫn hiển thị chỉ
 * đọc) - nguồn duy nhất chứa logic thêm/bớt dấu phân cách hàng nghìn. Mọi hàm
 * `formatVnd`/`formatVND`/`parseMoney`... rải rác ở các module khác đều phải
 * là wrapper mỏng gọi 2 hàm dưới đây, không tự làm `toLocaleString`/
 * `Intl.NumberFormat`/regex riêng nữa.
 *
 * Tham số hoá locale (mặc định 'vi-VN') để sẵn sàng chạy đúng cho cả 2 locale
 * khi cần - KHÔNG có nghĩa là app đã có UI chọn ngôn ngữ (chưa có, toàn app
 * vẫn 100% vi-VN như hiện tại). */
export type CurrencyLocale = 'vi-VN' | 'en-US';

/** Tách số khỏi mọi ký tự khác, tự nhận diện "." hay "," là ngăn cách thập
 * phân hay hàng nghìn - hỗ trợ đúng cả 3 dạng paste bất kể locale hiện tại:
 * "5000000", "5.000.000", "5,000,000" đều ra 5000000. Mirror đúng heuristic
 * đã dùng trong `parseMoney()` (modules/crm/constants/crmConfig.ts, bản gốc
 * trước khi tổng quát hoá vào đây):
 * - Có cả "." và ",": dấu xuất hiện SAU CÙNG là thập phân, dấu còn lại là
 *   ngăn cách hàng nghìn (bị xoá).
 * - Chỉ có "," : nếu có >2 nhóm phân tách bởi "," hoặc nhóm cuối dài đúng 3
 *   ký tự -> "," là ngăn cách hàng nghìn (xoá); ngược lại "," là thập phân.
 * - Chỉ có "." : coi "." theo sau bởi đúng 3 chữ số là ngăn cách hàng nghìn
 *   (xoá); "." theo sau bởi số chữ số khác 3 (hoặc ở cuối chuỗi) là thập phân.
 * Trả `null` nếu chuỗi rỗng hoặc không parse được số nào. */
export function parseCurrencyInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  const integerCandidate = cleaned.replace(/[.,]/g, '');
  if (/^-?\d+$/.test(integerCandidate)) {
    return Number(integerCandidate);
  }
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    const parts = cleaned.split(',');
    normalized =
      parts.length > 2 || parts.at(-1)?.length === 3
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(',', '.');
  } else if (hasDot) {
    normalized = cleaned.replace(/\.(?=\d{3}(\D|$))/g, '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Format số nguyên theo locale, KHÔNG kèm ký hiệu tiền tệ (đ/VND/USD là
 * prefix/suffix riêng do nơi gọi tự thêm) - làm tròn về số nguyên (tiền VNĐ
 * không có phần thập phân hiển thị). Trả rỗng nếu value null/undefined/NaN
 * (ô trống khác 0, không tự hiện "0"). */
export function formatCurrencyDisplay(
  value: number | string | null | undefined,
  locale: CurrencyLocale = 'vi-VN'
): string {
  if (value === null || value === undefined || value === '') return '';
  const numeric = typeof value === 'number' ? value : parseCurrencyInput(value);
  if (numeric === null || !Number.isFinite(numeric)) return '';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(numeric));
}
