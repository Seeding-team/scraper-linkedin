/** Preview cong thuc phia FE - CHI de hien thi truoc khi Luu, KHONG phai
 * nguon tinh chinh thuc (backend luon tinh lai bang Decimal khi luu, xem
 * price_book_service.compute_item_pricing() o backend - phai giu 2 ham nay
 * CUNG cong thuc neu sua 1 ben). */
export interface PriceBookPreviewInput {
  costMode: 'usd' | 'vnd';
  unitPriceUsd?: number | null;
  exchangeRate?: number | null;
  unitPriceVndDirect?: number | null;
  importDutyPercent?: number | null;
  vatInPercent?: number | null;
  vatEuPercent?: number | null;
  defaultQuantity?: number | null;
  defaultRatePercent?: number | null;
  referencePrice?: number | null;
}

export interface PriceBookPreviewResult {
  costUnit: number | null;
  costTotal: number | null;
  vatInAmount: number | null;
  inAfterVat: number | null;
  unitPrice: number | null;
  amountBeforeVat: number | null;
  vatEuAmount: number | null;
  totalAmount: number | null;
  profitBeforeVat: number | null;
  marginPercent: number | null;
  referenceDiffPercent: number | null;
}

function safeDiv(a: number, b: number | null | undefined): number | null {
  if (b === null || b === undefined || b === 0) return null;
  return a / b;
}

export function previewPriceBookItem(input: PriceBookPreviewInput): PriceBookPreviewResult {
  const qty = input.defaultQuantity ?? 1;
  const duty = input.importDutyPercent ?? 0;
  const vatIn = input.vatInPercent ?? 0;
  const vatEu = input.vatEuPercent ?? 0;
  const rate = input.defaultRatePercent ?? 0;

  const costUnit =
    input.costMode === 'usd'
      ? input.unitPriceUsd != null && input.exchangeRate != null
        ? input.unitPriceUsd * input.exchangeRate * (1 + duty / 100)
        : null
      : input.unitPriceVndDirect ?? null;

  const costTotal = costUnit != null ? qty * costUnit : null;
  const vatInAmount = costTotal != null ? (costTotal * vatIn) / 100 : null;
  const inAfterVat = costTotal != null && vatInAmount != null ? costTotal + vatInAmount : null;

  const unitPrice = costUnit != null ? costUnit * (1 + rate / 100) : null;
  const amountBeforeVat = unitPrice != null ? qty * unitPrice : null;
  const vatEuAmount = amountBeforeVat != null ? (amountBeforeVat * vatEu) / 100 : null;
  const totalAmount = amountBeforeVat != null && vatEuAmount != null ? amountBeforeVat + vatEuAmount : null;

  const profitBeforeVat = amountBeforeVat != null && costTotal != null ? amountBeforeVat - costTotal : null;
  const marginPercent = profitBeforeVat != null ? safeDiv(profitBeforeVat, amountBeforeVat) : null;

  const referenceDiffPercent =
    unitPrice != null && input.referencePrice ? safeDiv(unitPrice, input.referencePrice)! - 1 : null;

  return {
    costUnit,
    costTotal,
    vatInAmount,
    inAfterVat,
    unitPrice,
    amountBeforeVat,
    vatEuAmount,
    totalAmount,
    profitBeforeVat,
    marginPercent: marginPercent != null ? marginPercent * 100 : null,
    referenceDiffPercent: referenceDiffPercent != null ? referenceDiffPercent * 100 : null,
  };
}

export function formatVnd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  // BUG THAT DA GAP ("Không dính ký hiệu đ sát số") - them 1 khoang trang
  // truoc "đ" (vd "1.754.891 đ" thay vi "1.754.891đ" dinh lien).
  return `${Math.round(value).toLocaleString('vi-VN')} đ`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
}

/** Hien so USD quy doi (tham khao) - 2 chu so thap phan, khong lam tron nhu
 * formatVnd (VND lam tron ve so nguyen la dung quy uoc tien te, USD giu 2
 * chu so thap phan la dung quy uoc tien te cua no). */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
