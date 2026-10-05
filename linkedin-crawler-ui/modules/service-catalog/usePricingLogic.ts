import { useState } from 'react';
import { customerPriceFromMarkup, markupFromCustomerPrice } from './pricing-math';

export interface PricingState {
  // Input mode
  pricingInputMode: 'cost' | 'markup' | 'price';

  // Vendor Fields
  supplierCurrency: 'VND' | 'USD';
  supplierListPrice: number;
  supplierDiscountPercent: number;
  supplierNetPrice: number;
  supplierExchangeRate: number;
  supplierConvertedPrice: number;
  supplierVendorId?: string;
  supplierQuoteRef?: string;
  supplierQuoteSource?: string;
  supplierQuoteDate?: string;
  supplierValidUntil?: string;

  // Extra Costs
  shippingCost: number;
  importFee: number;
  otherCost: number;
  pricingPolicy?: string;

  // Final Cost & Sales
  costPriceVnd: number;
  markupPercent: number;
  customerPriceVnd: number;
}

/** Reducer THUAN cho form gia SP/DV (test duoc, khong phu thuoc React). Doi supplierCurrency
 * USD <-> VND quy doi gia list/net theo ty gia THAT trong state (vd 27.5 USD x 26.000 = 715.000 VND),
 * khong giu nguyen so cu va khong hard-code ty gia. */
export function reducePricing<K extends keyof PricingState>(prev: PricingState, field: K, value: PricingState[K]): PricingState {

  const next = { ...prev, [field]: value };

  if (field === 'supplierCurrency' && value !== prev.supplierCurrency) {
    const rate = prev.supplierExchangeRate > 0 ? prev.supplierExchangeRate : next.supplierExchangeRate;
    // Co gia can quy doi nhung CHUA co ty gia -> khong doi tien te (tranh giu nguyen so cu nhung
    // gan nhan tien te moi, vd "27.5" thanh 27.5 VND). Nguoi dung nhap ty gia truoc.
    if (!(rate > 0) && ((prev.supplierListPrice || 0) !== 0 || (prev.supplierNetPrice || 0) !== 0)) {
      return prev;
    }
    if (rate > 0) {
      if (prev.supplierCurrency === 'USD' && value === 'VND') {
        next.supplierListPrice = Math.round((prev.supplierListPrice || 0) * rate);
        next.supplierNetPrice = Math.round((prev.supplierNetPrice || 0) * rate);
      } else if (prev.supplierCurrency === 'VND' && value === 'USD') {
        next.supplierListPrice = (prev.supplierListPrice || 0) / rate;
        next.supplierNetPrice = (prev.supplierNetPrice || 0) / rate;
      }
    }
  }

  const extraCosts = (next.shippingCost || 0) + (next.importFee || 0) + (next.otherCost || 0);

  // Calculate Net Price
  if (['supplierListPrice', 'supplierDiscountPercent'].includes(field)) {
    next.supplierNetPrice = next.supplierListPrice * (1 - next.supplierDiscountPercent / 100);
  }
  if (field === 'costPriceVnd') {
    next.costPriceVnd = Number(value) || 0;
    next.supplierConvertedPrice = Math.max(next.costPriceVnd - extraCosts, 0);
    next.supplierNetPrice = next.supplierCurrency === 'USD' && next.supplierExchangeRate > 0
      ? next.supplierConvertedPrice / next.supplierExchangeRate
      : next.supplierConvertedPrice;
  } else {
    next.supplierConvertedPrice = next.supplierCurrency === 'USD'
      ? next.supplierNetPrice * next.supplierExchangeRate
      : next.supplierNetPrice;
    next.costPriceVnd = next.supplierConvertedPrice + extraCosts;
  }

  // Forward compute pricing based on Input Mode
  if (field !== 'markupPercent' && field !== 'customerPriceVnd') {
    if (next.pricingInputMode === 'markup' || prev.pricingInputMode === 'cost') {
      next.customerPriceVnd = customerPriceFromMarkup(next.costPriceVnd, next.markupPercent) ?? 0;
    } else if (next.pricingInputMode === 'price') {
      next.markupPercent = markupFromCustomerPrice(next.costPriceVnd, next.customerPriceVnd) ?? 0;
    }
  }

  if (field === 'markupPercent') {
    next.pricingInputMode = 'markup';
    next.customerPriceVnd = customerPriceFromMarkup(next.costPriceVnd, next.markupPercent) ?? 0;
  }

  if (field === 'customerPriceVnd') {
    next.pricingInputMode = 'price';
    next.markupPercent = markupFromCustomerPrice(next.costPriceVnd, next.customerPriceVnd) ?? 0;
  }

  return next;
}

export function usePricingLogic(initialState?: Partial<PricingState>) {
  const [state, setState] = useState<PricingState>({
    pricingInputMode: 'cost',
    supplierCurrency: 'VND',
    supplierListPrice: 0,
    supplierDiscountPercent: 0,
    supplierNetPrice: 0,
    // Khong hard-code ty gia: 0 = chua co, form tu dien ty gia he thong (useSystemUsdVndRate)
    // hoac nguoi dung nhap tay.
    supplierExchangeRate: 0,
    supplierConvertedPrice: 0,
    shippingCost: 0,
    importFee: 0,
    otherCost: 0,
    costPriceVnd: 0,
    markupPercent: 0,
    customerPriceVnd: 0,
    ...initialState,
  });

  const updateField = <K extends keyof PricingState>(field: K, value: PricingState[K]) => {
    setState((prev) => reducePricing(prev, field, value));
  };

  const getProfit = () => state.customerPriceVnd - state.costPriceVnd;
  const getMargin = () => state.customerPriceVnd > 0 ? (getProfit() / state.customerPriceVnd) * 100 : 0;

  return { state, setState, updateField, getProfit, getMargin };
}
