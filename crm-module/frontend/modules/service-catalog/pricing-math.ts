export function customerPriceFromMarkup(cost: number | null | undefined, markupPercent: number | null | undefined): number | null {
  if (cost == null || markupPercent == null) return null;
  if (!Number.isFinite(cost) || !Number.isFinite(markupPercent)) return null;
  const multiplier = 1 + markupPercent / 100;
  if (multiplier < 0) return null;
  return Math.max(0, cost * multiplier);
}

export function markupFromCustomerPrice(cost: number | null | undefined, customerPrice: number | null | undefined): number | null {
  if (cost == null || customerPrice == null) return null;
  if (!Number.isFinite(cost) || !Number.isFinite(customerPrice)) return null;
  if (cost <= 0) return null;
  return ((customerPrice - cost) / cost) * 100;
}

export function costFromMarkupAndCustomer(markupPercent: number | null | undefined, customerPrice: number | null | undefined): number | null {
  if (markupPercent == null || customerPrice == null) return null;
  if (!Number.isFinite(markupPercent) || !Number.isFinite(customerPrice)) return null;
  const divisor = 1 + markupPercent / 100;
  if (divisor <= 0) return null;
  return Math.max(0, customerPrice / divisor);
}

export function customerPriceFromTargetGrossMargin(cost: number | null | undefined, targetGrossMarginPercent: number | null | undefined): number | null {
  if (cost == null || targetGrossMarginPercent == null) return null;
  if (!Number.isFinite(cost) || !Number.isFinite(targetGrossMarginPercent)) return null;
  const divisor = 1 - targetGrossMarginPercent / 100;
  if (divisor <= 0) return null;
  return Math.max(0, cost / divisor);
}

export function targetGrossMarginFromCustomerPrice(cost: number | null | undefined, customerPrice: number | null | undefined): number | null {
  if (cost == null || customerPrice == null) return null;
  if (!Number.isFinite(cost) || !Number.isFinite(customerPrice)) return null;
  if (customerPrice <= 0) return null;
  return ((customerPrice - cost) / customerPrice) * 100;
}

export function costFromTargetGrossMarginAndCustomer(targetGrossMarginPercent: number | null | undefined, customerPrice: number | null | undefined): number | null {
  if (targetGrossMarginPercent == null || customerPrice == null) return null;
  if (!Number.isFinite(targetGrossMarginPercent) || !Number.isFinite(customerPrice)) return null;
  const multiplier = 1 - targetGrossMarginPercent / 100;
  if (multiplier < 0) return null;
  return Math.max(0, customerPrice * multiplier);
}
