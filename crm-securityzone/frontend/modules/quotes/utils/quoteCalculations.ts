import type { QuoteItem, VillaSolutionItem } from '../types';
import { formatCurrencyDisplay, formatQuoteMoney, normalizeQuoteCurrency, roundQuoteMoney } from '@/lib/currency';

export const parseCurrencyInput = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  const parsed = Number.parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const toSafeNumber = (value: unknown) => parseCurrencyInput(value);

/** Don gia co the la so thap phan (USD): number giu nguyen; chuoi giu hanh vi cu. */
const toSafeDecimal = (value: unknown) => toSafeNumber(value);

const toSafePercent = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  const normalized = String(value).replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Lam tron tung buoc THEO TIEN TE CUA QUOTE, khop RPC quote_update (migration 169):
 * USD = 2 so le, tung dong. VND (mac dinh) KHONG lam tron o day de bao gia cu
 * hien thi y nhu truoc (server da tu lam tron dong khi luu). `currency` la
 * tham so TUY CHON cuoi cung - khong truyen = VND = hanh vi cu. */
const roundFor = (value: number, currency?: unknown) =>
  normalizeQuoteCurrency(currency) === 'VND' ? value : roundQuoteMoney(value, currency);

export const calculateItemSubtotal = (item?: Partial<QuoteItem>, currency?: unknown) =>
  roundFor(toSafeNumber(item?.quantity) * toSafeDecimal(item?.unitPrice), currency);

export const calculateItemDiscount = (item?: Partial<QuoteItem>, currency?: unknown) =>
  roundFor((calculateItemSubtotal(item, currency) * clampDiscountPercent(item?.discountPercent)) / 100, currency);

export const calculateItemAfterDiscount = (item?: Partial<QuoteItem>, currency?: unknown) =>
  calculateItemSubtotal(item, currency) - calculateItemDiscount(item, currency);

export const calculateItemVat = (item?: Partial<QuoteItem>, currency?: unknown) =>
  roundFor((calculateItemAfterDiscount(item, currency) * toSafeNumber(item?.vatRate)) / 100, currency);

export const calculateItemTotal = (item?: Partial<QuoteItem>, currency?: unknown) =>
  calculateItemAfterDiscount(item, currency) + calculateItemVat(item, currency);

/** Kẹp % giảm giá về [0, 100] - phòng người dùng gõ số âm hoặc >100% làm tổng
 * tiền ra số vô lý (âm hoặc lớn hơn cả tổng gốc). */
export const clampDiscountPercent = (value: unknown) => {
  const pct = toSafePercent(value);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
};

/**
 * Giảm giá % áp dụng trên TỔNG TRƯỚC THUẾ (subtotal), rồi VAT tính lại trên
 * phần đã giảm - không phải giảm sau khi đã cộng VAT. Vì giảm giá là 1 hệ số
 * NHÂN đều lên mọi dòng, và VAT mỗi dòng cũng tuyến tính theo subtotal dòng
 * đó, nên tổng VAT sau giảm = tổng VAT gốc (không giảm) × (1 - %/100) —
 * đúng cho mọi trường hợp kể cả các dòng có VAT % khác nhau, không cần tính
 * lại VAT từng dòng riêng. Xem chứng minh trong PR mô tả "Luồng duyệt báo giá".
 */
export const calculateQuoteTotals = (
  items: Partial<QuoteItem>[] = [],
  _discountPercent: unknown = 0,
  currency?: unknown
) => {
  void _discountPercent;
  const allItems = flattenQuoteItems(items);
  const sum = (fn: (item: Partial<QuoteItem>, cur?: unknown) => number) =>
    roundFor(allItems.reduce((acc, item) => acc + fn(item, currency), 0), currency);
  return {
    subtotalAmount: sum(calculateItemSubtotal),
    discountAmount: sum(calculateItemDiscount),
    totalVatAmount: sum(calculateItemVat),
    totalAmount: sum(calculateItemTotal),
  };
};

export const flattenQuoteItems = (items: Partial<QuoteItem>[] = []): Partial<QuoteItem>[] =>
  items.flatMap(item => [item, ...flattenQuoteItems(item.children || [])]);

export const calculateVillaTotals = (items: Partial<VillaSolutionItem>[] = []) => {
  const totalAmount = items.reduce(
    (sum, item) => sum + toSafeNumber(item.offerPrice),
    0
  );
  return {
    subtotalAmount: totalAmount,
    discountAmount: 0,
    totalVatAmount: 0,
    totalAmount,
  };
};

/** Chiet khau tong (overallDiscountPercent, migration 106) - tinh CHI o tang
 * hien thi (khong dung lai ket qua nay de ghi de totals goc/DB) de khoi tong
 * tien (QuoteDocumentRenderer) hien dung "Giam gia tong/Tong sau giam gia/Tong
 * thanh toan". `subtotalBeforeVat` lay tu totalAmount - totalVatAmount thay vi
 * doc thang subtotalAmount/discountAmount - vi 2 field sau KHONG phai luon co
 * mat o moi noi goi (da audit: QuoteWorkspaceModal popup/PublicQuotePage/
 * QuoteDetailPage chi truyen subtotalAmount/totalVatAmount/totalAmount, khong
 * truyen discountAmount) trong khi totalAmount/totalVatAmount thi LUON co -
 * hieu sai tru duoc dung phan da net giam gia TUNG DONG (neu co) san co trong
 * totals, khong can biet discountAmount co mat hay khong.
 * VAT hien thi co gian theo ty le giam gia tong (giong cach VAT tung dong da
 * co-gian theo % giam gia dong do, xem calculateItemVat/calculateQuoteTotals
 * o tren) - KHONG tinh lai VAT tu dau. */
export const calculateOverallDiscountSummary = (
  totals: { totalAmount: number; totalVatAmount: number },
  overallDiscountPercent?: number | null,
  currency?: unknown
) => {
  const pct = clampDiscountPercent(overallDiscountPercent ?? 0);
  const subtotalBeforeVat = toSafeDecimal(totals.totalAmount) - toSafeDecimal(totals.totalVatAmount);
  const overallDiscountAmount = roundFor((subtotalBeforeVat * pct) / 100, currency);
  const subtotalAfterDiscount = subtotalBeforeVat - overallDiscountAmount;
  const vatAfterDiscount = roundFor(toSafeDecimal(totals.totalVatAmount) * (1 - pct / 100), currency);
  return {
    subtotalBeforeVat,
    overallDiscountAmount,
    subtotalAfterDiscount,
    vatAfterDiscount,
    grandTotal: subtotalAfterDiscount + vatAfterDiscount,
  };
};

/** Tong tien 1 "mục cha"/section = SUM("Thành tiền" gồm VAT, tuc
 * calculateItemTotal) cua CAC HANG MUC CON TRUC TIEP (khong de quy sau hon 1
 * cap - section chi co 1 tang con duy nhat trong model hien tai, xem
 * QuoteItem.parentItemId/rowType o types/index.ts). Dung CHUNG 1 ham nay o
 * ca QuoteWorkspaceModal.tsx (loc children theo parentItemId === section.id
 * trong mang phang itemsDraft) VA QuoteDocumentRenderer.tsx (children la
 * item.children, da dung san cau truc long nhau) - tranh 2 noi tu tinh rieng
 * co the lech nhau. KHONG cong them cac dong bundle-component hien thi rieng
 * (__bundleComponent) cua tung child - cac dong do CHI la hien thi phu, gia
 * tri cua chung da nam TRONG unitPrice*quantity cua chinh item cha (bundle)
 * roi, cong them se bi tinh 2 lan. Chi la gia tri HIEN THI (khong luu DB),
 * tinh lai moi lan render tu du lieu hien tai - dung duoc cho ca bao gia cu
 * (khong can migrate/backfill gi ca). */
export const calculateSectionTotal = (children: Partial<QuoteItem>[] = [], currency?: unknown) =>
  children.reduce((sum, child) => sum + calculateItemTotal(child, currency), 0);

// Wrapper mong quanh formatCurrencyDisplay() dung chung (lib/currency.ts) -
// giu nguyen dinh dang output cu ("5.000.000 đ"), khong tu goi toLocaleString
// rieng nua.
export const formatVnd = (value: unknown) =>
  `${formatCurrencyDisplay(toSafeNumber(value))} đ`;

/** Format theo tien te cua quote ("1.250.000 đ" / "$48.08") - dung thay formatVnd
 * o moi noi hien thi tien cua 1 quote cu the. */
export const formatMoney = (value: unknown, currency?: unknown) =>
  normalizeQuoteCurrency(currency) === 'USD' ? formatQuoteMoney(toSafeDecimal(value), 'USD') : formatVnd(value);

export const sanitizeMoneyInput = (value: unknown) => toSafeNumber(value);
