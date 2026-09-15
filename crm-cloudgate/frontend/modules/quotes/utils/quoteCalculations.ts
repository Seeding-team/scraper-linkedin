import type { QuoteItem, VillaSolutionItem } from '../types';
import { formatCurrencyDisplay } from '@/lib/currency';

export const parseCurrencyInput = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  const parsed = Number.parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const toSafeNumber = (value: unknown) => parseCurrencyInput(value);

const toSafePercent = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  const normalized = String(value).replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const calculateItemSubtotal = (item?: Partial<QuoteItem>) =>
  toSafeNumber(item?.quantity) * toSafeNumber(item?.unitPrice);

export const calculateItemDiscount = (item?: Partial<QuoteItem>) =>
  (calculateItemSubtotal(item) * clampDiscountPercent(item?.discountPercent)) / 100;

export const calculateItemAfterDiscount = (item?: Partial<QuoteItem>) =>
  calculateItemSubtotal(item) - calculateItemDiscount(item);

export const calculateItemVat = (item?: Partial<QuoteItem>) =>
  (calculateItemAfterDiscount(item) * toSafeNumber(item?.vatRate)) / 100;

export const calculateItemTotal = (item?: Partial<QuoteItem>) =>
  calculateItemAfterDiscount(item) + calculateItemVat(item);

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
  _discountPercent: unknown = 0
) => {
  void _discountPercent;
  const allItems = flattenQuoteItems(items);
  const discountAmount = allItems.reduce(
    (sum, item) => sum + calculateItemDiscount(item),
    0
  );
  const totalVatAmount = allItems.reduce(
    (sum, item) => sum + calculateItemVat(item),
    0
  );
  return {
    subtotalAmount: allItems.reduce((sum, item) => sum + calculateItemSubtotal(item), 0),
    discountAmount,
    totalVatAmount,
    totalAmount: allItems.reduce((sum, item) => sum + calculateItemTotal(item), 0),
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
  overallDiscountPercent?: number | null
) => {
  const pct = clampDiscountPercent(overallDiscountPercent ?? 0);
  const subtotalBeforeVat = toSafeNumber(totals.totalAmount) - toSafeNumber(totals.totalVatAmount);
  const overallDiscountAmount = (subtotalBeforeVat * pct) / 100;
  const subtotalAfterDiscount = subtotalBeforeVat - overallDiscountAmount;
  const vatAfterDiscount = toSafeNumber(totals.totalVatAmount) * (1 - pct / 100);
  return {
    subtotalBeforeVat,
    overallDiscountAmount,
    subtotalAfterDiscount,
    vatAfterDiscount,
    grandTotal: subtotalAfterDiscount + vatAfterDiscount,
  };
};

// Wrapper mong quanh formatCurrencyDisplay() dung chung (lib/currency.ts) -
// giu nguyen dinh dang output cu ("5.000.000 đ"), khong tu goi toLocaleString
// rieng nua.
export const formatVnd = (value: unknown) =>
  `${formatCurrencyDisplay(toSafeNumber(value))} đ`;

export const sanitizeMoneyInput = (value: unknown) => toSafeNumber(value);
