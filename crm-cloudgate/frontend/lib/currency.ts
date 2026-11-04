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
  locale: CurrencyLocale = 'vi-VN',
  decimals = 0
): string {
  if (value === null || value === undefined || value === '') return '';
  const numeric = typeof value === 'number' ? value : parseCurrencyInput(value);
  if (numeric === null || !Number.isFinite(numeric)) return '';
  if (decimals > 0) {
    const factor = 10 ** decimals;
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(
      Math.round(numeric * factor) / factor
    );
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(numeric));
}

// ---------------------------------------------------------------------------
// Tien te CAP QUOTE (multi-currency, migration 169). Gia goc Service Catalog /
// Price Book luon la VND; quote USD dung `quote.exchangeRate` (so VND cho 1 USD)
// DA DONG BANG luc tao/chuyen currency: gia USD = gia VND / exchangeRate.
// ---------------------------------------------------------------------------
export type QuoteCurrency = 'VND' | 'USD';

export function normalizeQuoteCurrency(value: unknown): QuoteCurrency {
  return String(value ?? '').trim().toUpperCase() === 'USD' ? 'USD' : 'VND';
}

export function quoteCurrencyDecimals(currency: unknown): number {
  return normalizeQuoteCurrency(currency) === 'USD' ? 2 : 0;
}

/** Lam tron theo quy uoc tien te cua quote (VND = dong nguyen, USD = 2 so le) -
 * khop RPC quote_update / _round_vnd ben backend. */
export function roundQuoteMoney(value: number, currency: unknown): number {
  const factor = 10 ** quoteCurrencyDecimals(currency);
  const scaled = Number(((Number.isFinite(value) ? value : 0) * factor).toPrecision(15));
  return Math.round(scaled) / factor;
}

/** Dinh dang tien theo tien te cua quote: VND "1.250.000 đ", USD "$48.08". */
export function formatQuoteMoney(value: unknown, currency: unknown = 'VND'): string {
  const numeric = typeof value === 'number' ? value : parseCurrencyInput(value as string | null | undefined);
  const safe = numeric !== null && Number.isFinite(numeric) ? numeric : 0;
  if (normalizeQuoteCurrency(currency) === 'USD') {
    return `$${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${formatCurrencyDisplay(safe)} đ`;
}

/** Gia VND goc -> tien te cua quote theo ty gia da dong bang. null neu thieu gia
 * tri / thieu ty gia (USD). */
export function vndToQuoteCurrency(
  amountVnd: number | null | undefined,
  currency: unknown,
  exchangeRate: number | null | undefined
): number | null {
  if (amountVnd === null || amountVnd === undefined || !Number.isFinite(amountVnd)) return null;
  if (normalizeQuoteCurrency(currency) === 'VND') return roundQuoteMoney(amountVnd, 'VND');
  if (!exchangeRate || exchangeRate <= 0) return null;
  return roundQuoteMoney(amountVnd / exchangeRate, 'USD');
}

/** Nguoc lai: so tien theo tien te quote -> VND (khong lam tron VND de giu do
 * chinh xac khi dung lam "gia goc"; noi can so nguyen tu lam tron). */
export function quoteCurrencyToVnd(
  amount: number | null | undefined,
  currency: unknown,
  exchangeRate: number | null | undefined
): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  if (normalizeQuoteCurrency(currency) === 'VND') return amount;
  if (!exchangeRate || exchangeRate <= 0) return null;
  return amount * exchangeRate;
}

/** Doi hau to tien te trong nhan cot/tieu de: "Đơn giá (VND)" -> "Đơn giá (USD)".
 * Nhan khong co hau to tien te giu nguyen. VND giu nguyen nhan goc (bao gia cu
 * render y nhu truoc). */
export function localizeCurrencyLabel(label: string, currency: unknown): string {
  if (normalizeQuoteCurrency(currency) === 'VND') return label;
  return label.replace(/\((?:VND|VNĐ|vnd|vnđ)\)/g, '(USD)').replace(/(?:VNĐ|VND)/g, 'USD');
}

/** Dung o cac danh sach/tab hien tong tien cua 1 quote voi formatter VND rieng cua tung
 * man hinh (formatVND/formatMoney...): quote USD -> "$48.08", con lai giu NGUYEN formatter
 * VND cu cua man hinh do (bao gia cu render y nhu truoc). */
export function formatQuoteAmountOr(
  amount: number | string | null | undefined,
  currency: unknown,
  vndFormat: (value: any) => string | null | undefined
): string {
  if (normalizeQuoteCurrency(currency) !== 'USD') return vndFormat(amount) ?? '';
  const numeric = typeof amount === 'number' ? amount : parseCurrencyInput(amount as string | null | undefined);
  return formatQuoteMoney(numeric ?? 0, 'USD');
}
