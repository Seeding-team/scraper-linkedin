import type { PaymentPlanRow } from '../types';

/** Basis points avoid floating point equality errors for two-decimal percentages. */
export function paymentPlanPercent(rows: PaymentPlanRow[]): number {
  return rows.reduce((sum, row) => sum + Math.round((Number(row.percent) || 0) * 100), 0) / 100;
}

export function paymentPlanAmount(finalPayable: number, percent: number): number {
  return Math.round(finalPayable * percent / 100);
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
