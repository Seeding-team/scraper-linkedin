import type { PaymentPlanRow } from '../types';
import { quoteCurrencyDecimals } from '@/lib/currency';

/** Basis points avoid floating point equality errors for two-decimal percentages. */
export function paymentPlanPercent(rows: PaymentPlanRow[]): number {
  return rows.reduce((sum, row) => sum + Math.round((Number(row.percent) || 0) * 100), 0) / 100;
}

/** So tien tung dot - lam tron theo tien te cua quote (VND = dong nguyen, USD = 2 so le). */
export function paymentPlanAmount(finalPayable: number, percent: number, currency?: unknown): number {
  const factor = 10 ** quoteCurrencyDecimals(currency);
  return Math.round(Number(((finalPayable * percent / 100) * factor).toPrecision(15))) / factor;
}

export function visiblePaymentPlan(rows: PaymentPlanRow[] | undefined): PaymentPlanRow[] {
  return (rows || []).filter(row => Boolean(row.phase?.trim() || row.percent || row.condition?.trim() || row.note?.trim()));
}

/** Sanitize a percent input's raw string WHILE TYPING: keep only digits/dot,
 * collapse extra dots, strip leading zeros ("00030" -> "30", "0033" -> "33"),
 * without touching valid decimals ("033.34" -> "33.34", "0.5" stays "0.5") or
 * forcing an empty field back to "0" (bug: React controlled <input type=number>
 * doesn't repaint the DOM value when the parsed number is unchanged, e.g. "0"
 * then "0" again, so raw leading zeros pile up in the DOM - hence plain text
 * input + manual sanitize instead of type="number"). No '-' can survive the
 * digit/dot-only strip, so negative percentages are already impossible here. */
export function sanitizePercentDraft(raw: string): string {
  let value = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const dotIndex = value.indexOf('.');
  if (dotIndex !== -1) {
    value = value.slice(0, dotIndex + 1) + value.slice(dotIndex + 1).replace(/\./g, '');
  }
  const [rawInt, rawDec] = value.split('.');
  const intPart = (rawInt || '').replace(/^0+(?=\d)/, '');
  return rawDec === undefined ? intPart : `${intPart || '0'}.${rawDec}`;
}

/** Clamp to the valid [0, 100] percent range; NaN/empty resolves to 0 (only
 * used at blur/commit time - an empty field stays empty while still focused,
 * see sanitizePercentDraft above and its caller in PaymentPlanEditor). */
export function clampPercentValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Chia DEU phan tram con lai (100 - tong cac dot da chinh tay) cho cac dot CHUA chinh tay, lam tron 2 so le,
 * dot cuoi nhan phan du de tong = 100. Moi dot da chinh tay (manualIds) giu nguyen. Khong co dot tu dong -> giu nguyen. */
export function distributePaymentPlan(rows: PaymentPlanRow[], manualIds: ReadonlySet<string>): PaymentPlanRow[] {
  const autoRows = rows.filter(row => !manualIds.has(row.id));
  if (autoRows.length === 0) return rows;
  const usedBp = rows.filter(row => manualIds.has(row.id)).reduce((sum, row) => sum + Math.round((Number(row.percent) || 0) * 100), 0);
  const remainingBp = Math.max(0, 10000 - usedBp);
  const shareBp = Math.floor(remainingBp / autoRows.length);
  let given = 0;
  return rows.map(row => {
    if (manualIds.has(row.id)) return row;
    const isLastAuto = row.id === autoRows[autoRows.length - 1].id;
    const bp = isLastAuto ? remainingBp - given : shareBp;
    given += bp;
    return { ...row, percent: bp / 100 };
  });
}
