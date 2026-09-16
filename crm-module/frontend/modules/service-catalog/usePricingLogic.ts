import { useState } from 'react';

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

export function usePricingLogic(initialState?: Partial<PricingState>) {
  const [state, setState] = useState<PricingState>({
    pricingInputMode: 'cost',
    supplierCurrency: 'VND',
    supplierListPrice: 0,
    supplierDiscountPercent: 0,
    supplierNetPrice: 0,
    supplierExchangeRate: 25400,
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
    setState((prev) => {
      const next = { ...prev, [field]: value };
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
          next.customerPriceVnd = next.costPriceVnd * (1 + next.markupPercent / 100);
        } else if (next.pricingInputMode === 'price') {
          next.markupPercent = next.costPriceVnd > 0 ? ((next.customerPriceVnd - next.costPriceVnd) / next.costPriceVnd) * 100 : 0;
        }
      }

      if (field === 'markupPercent') {
        next.pricingInputMode = 'markup';
        next.customerPriceVnd = next.costPriceVnd * (1 + next.markupPercent / 100);
      }

      if (field === 'customerPriceVnd') {
        next.pricingInputMode = 'price';
        next.markupPercent = next.costPriceVnd > 0 ? ((next.customerPriceVnd - next.costPriceVnd) / next.costPriceVnd) * 100 : 0;
      }

      return next;
    });
  };

  const getProfit = () => state.customerPriceVnd - state.costPriceVnd;
  const getMargin = () => state.customerPriceVnd > 0 ? (getProfit() / state.customerPriceVnd) * 100 : 0;

  return { state, setState, updateField, getProfit, getMargin };
}
