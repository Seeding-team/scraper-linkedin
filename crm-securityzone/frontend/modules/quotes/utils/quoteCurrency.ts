import { quoteCurrencyToVnd, roundQuoteMoney, vndToQuoteCurrency, type QuoteCurrency } from '@/lib/currency';
import type { QuoteItem } from '../types';

/** Tien te cap quote + ty gia (VND / 1 USD) DA DONG BANG luc tao/chuyen currency.
 * Gia danh muc/Bang gia va snapshot goi Combo luon la VND; moi so tien cua quote nam TRONG
 * tien te nay. */
export type QuoteFx = { currency: QuoteCurrency; rate: number | null };
export const VND_FX: QuoteFx = { currency: 'VND', rate: null };

/** Gia VND goc -> tien te cua quote (VND giu nguyen, USD = VND / ty gia, 2 so le). */
export function toQuoteMoney(vnd: number | null | undefined, fx: QuoteFx): number | null {
  if (vnd == null) return null;
  if (fx.currency === 'VND') return vnd;
  return vndToQuoteCurrency(vnd, fx.currency, fx.rate);
}

/** Nguoc lai: so tien theo tien te quote -> VND nguyen. */
export function fromQuoteMoney(value: number | null | undefined, fx: QuoteFx): number | null {
  if (value == null) return null;
  if (fx.currency === 'VND') return value;
  const vnd = quoteCurrencyToVnd(value, fx.currency, fx.rate);
  return vnd == null ? null : Math.round(vnd);
}

/** Quy doi toan bo dong hang muc giua 2 tien te cua quote.
 *  - Goc VND (unitPriceVnd / costPriceVnd) duoc dung lai neu dong CHUA bi sua tay (con khop gia
 *    USD hien tai) -> VND -> USD -> VND khong troi do lam tron 2 so le.
 *  - Dong da sua tay: quy doi theo ty gia dang chot cua quote.
 *  - Markup % giu nguyen (y dinh cua nguoi nhap); Muc cha (section) khong doi.
 *  - Snapshot combo (bundleSnapshot) luon VND nen khong doi. */
export function convertQuoteItemsCurrency(items: QuoteItem[], from: QuoteFx, to: QuoteFx): QuoteItem[] {
  if (from.currency === to.currency) return items;
  const matchesBase = (base: number | null | undefined, current: number | null | undefined) =>
    base != null && current != null && from.rate != null && from.rate > 0
      ? Math.abs(roundQuoteMoney(base / from.rate, from.currency) - current) < 0.005
      : false;
  const toTarget = (vnd: number | null) => {
    if (vnd == null) return null;
    return to.currency === 'VND' ? Math.round(vnd) : toQuoteMoney(vnd, to);
  };
  return items.map(row => {
    if (row.rowType === 'section') return row;
    let vndPrice: number | null;
    let vndCost: number | null;
    if (from.currency === 'VND') {
      vndPrice = row.unitPrice ?? null;
      vndCost = row.costPrice ?? null;
    } else {
      vndPrice = matchesBase(row.unitPriceVnd, row.unitPrice) ? (row.unitPriceVnd as number) : fromQuoteMoney(row.unitPrice, from);
      vndCost = matchesBase(row.costPriceVnd, row.costPrice) ? (row.costPriceVnd as number) : fromQuoteMoney(row.costPrice, from);
    }
    return {
      ...row,
      unitPrice: toTarget(vndPrice),
      costPrice: toTarget(vndCost),
      ...(to.currency === 'USD'
        ? { unitPriceVnd: vndPrice ?? undefined, costPriceVnd: vndCost }
        : { costPriceVnd: null }),
    };
  });
}
