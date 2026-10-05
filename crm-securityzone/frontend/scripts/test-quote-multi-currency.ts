/* Self-test logic thuan cua multi-currency Quote (khong can DB/browser).
 * Chay:  npx tsx scripts/test-quote-multi-currency.ts
 */
import assert from 'node:assert/strict';
import {
  formatQuoteAmountOr,
  formatQuoteMoney,
  localizeCurrencyLabel,
  quoteCurrencyToVnd,
  roundQuoteMoney,
  vndToQuoteCurrency,
} from '../lib/currency';
import {
  calculateItemTotal,
  calculateOverallDiscountSummary,
  calculateQuoteTotals,
} from '../modules/quotes/utils/quoteCalculations';
import { paymentPlanAmount } from '../modules/quotes/utils/paymentPlan';
import { VND_FX, convertQuoteItemsCurrency, type QuoteFx } from '../modules/quotes/utils/quoteCurrency';
import { reducePricing, type PricingState } from '../modules/service-catalog/usePricingLogic';
import { customerPriceFromMarkup } from '../modules/service-catalog/pricing-math';
import type { Quote, QuoteItem } from '../modules/quotes/types';
import { quoteDraftFromExistingQuote } from '../modules/crm/integrations/quotes/types';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const RATE = 26000; // chi la tham so test - code that KHONG hard-code ty gia.
const USD_FX: QuoteFx = { currency: 'USD', rate: RATE };

// ---------------------------------------------------------------- format
test('formatQuoteMoney VND = "1.250.000 đ", USD = "$48.08"', () => {
  assert.equal(formatQuoteMoney(1250000, 'VND').replace(/\s/g, ' '), '1.250.000 đ');
  assert.equal(formatQuoteMoney(48.08, 'USD'), '$48.08');
  assert.equal(formatQuoteMoney(48, 'USD'), '$48.00');
  assert.equal(formatQuoteMoney(1250000, undefined).replace(/\s/g, ' '), '1.250.000 đ');
});

test('header "(VND)" doi dong sang "(USD)"; VND giu nguyen', () => {
  assert.equal(localizeCurrencyLabel('Đơn giá (VND)', 'USD'), 'Đơn giá (USD)');
  assert.equal(localizeCurrencyLabel('Thành tiền bao gồm VAT (VNĐ)', 'USD'), 'Thành tiền bao gồm VAT (USD)');
  assert.equal(localizeCurrencyLabel('Đơn giá (VND)', 'VND'), 'Đơn giá (VND)');
  assert.equal(localizeCurrencyLabel('Số lượng', 'USD'), 'Số lượng');
});

test('formatQuoteAmountOr: USD -> $, VND -> formatter cu cua man hinh', () => {
  assert.equal(formatQuoteAmountOr(158.66, 'USD', () => 'x'), '$158.66');
  assert.equal(formatQuoteAmountOr(5, 'VND', v => `vnd:${v}`), 'vnd:5');
  assert.equal(formatQuoteAmountOr(5, undefined, v => `vnd:${v}`), 'vnd:5');
});

// ------------------------------------------------------------ conversion
test('quy doi VND -> USD = VND / ty gia, lam tron 2 so le; VND giu nguyen', () => {
  assert.equal(vndToQuoteCurrency(1250000, 'USD', RATE), 48.08);
  assert.equal(vndToQuoteCurrency(1250000, 'VND', RATE), 1250000);
  assert.equal(vndToQuoteCurrency(1250000, 'USD', null), null); // khong co ty gia -> khong bia
  assert.equal(quoteCurrencyToVnd(27.5, 'USD', RATE), 715000);
});

test('roundQuoteMoney: VND nguyen, USD 2 so le', () => {
  assert.equal(roundQuoteMoney(1250000.4, 'VND'), 1250000);
  assert.equal(roundQuoteMoney(48.077, 'USD'), 48.08);
  assert.equal(roundQuoteMoney(1.005, 'USD'), 1.01);
});

// --------------------------------------------------------------- totals
const usdItem: Partial<QuoteItem> = { quantity: 3, unitPrice: 48.08, vatRate: 10, discountPercent: 0 };
test('tong tien USD khop RPC quote_update (3 x $48.08, VAT 10%)', () => {
  const totals = calculateQuoteTotals([usdItem], 0, 'USD');
  assert.equal(totals.subtotalAmount, 144.24);
  assert.equal(totals.totalVatAmount, 14.42);
  assert.equal(totals.totalAmount, 158.66);
  assert.equal(calculateItemTotal(usdItem, 'USD'), 158.66);
});

test('tong tien VND KHONG doi so voi hanh vi cu (khong lam tron o FE)', () => {
  const totals = calculateQuoteTotals([{ quantity: 3, unitPrice: 1250000, vatRate: 10, discountPercent: 0 }]);
  assert.equal(totals.subtotalAmount, 3750000);
  assert.equal(totals.totalVatAmount, 375000);
  assert.equal(totals.totalAmount, 4125000);
});

test('giam gia tong + thanh toan tung dot lam tron theo tien te', () => {
  const totals = calculateQuoteTotals([usdItem], 0, 'USD');
  const summary = calculateOverallDiscountSummary(totals, 10, 'USD');
  assert.equal(summary.overallDiscountAmount, 14.42); // 144.24 * 10% = 14.424
  assert.equal(summary.grandTotal, 142.8); // 129.82 + 12.98
  assert.equal(paymentPlanAmount(summary.grandTotal, 30, 'USD'), 42.84);
  assert.equal(paymentPlanAmount(1000001, 30), 300000); // VND: dong nguyen
});

// ------------------------------------------------------ currency switch
const vndItems: QuoteItem[] = [
  { rowType: 'section', description: 'I', quantity: 0, unitPrice: 0, vatRate: 0 },
  { rowType: 'item', quantity: 3, unitPrice: 1250000, costPrice: 1000000, markupPercent: 25, vatRate: 10 },
  { rowType: 'item', quantity: 1, unitPrice: null, costPrice: null, markupPercent: null, vatRate: 10 },
];

test('doi VND -> USD: quy doi gia von + gia khach, giu markup, luu goc VND', () => {
  const usd = convertQuoteItemsCurrency(vndItems, VND_FX, USD_FX);
  assert.equal(usd[0].rowType, 'section');
  assert.equal(usd[1].unitPrice, 48.08);
  assert.equal(usd[1].costPrice, 38.46);
  assert.equal(usd[1].markupPercent, 25);
  assert.equal(usd[1].unitPriceVnd, 1250000);
  assert.equal(usd[1].costPriceVnd, 1000000);
  assert.equal(usd[2].unitPrice, null); // gia trong khong bi bia thanh 0
});

test('doi USD -> VND khong troi do (dung goc VND khi chua sua tay)', () => {
  const usd = convertQuoteItemsCurrency(vndItems, VND_FX, USD_FX);
  const back = convertQuoteItemsCurrency(usd, USD_FX, VND_FX);
  assert.equal(back[1].unitPrice, 1250000);
  assert.equal(back[1].costPrice, 1000000);
});

test('dong USD da sua tay: quy doi theo ty gia chot, khong dung goc VND cu', () => {
  const usd = convertQuoteItemsCurrency(vndItems, VND_FX, USD_FX);
  const edited = usd.map((row, i) => (i === 1 ? { ...row, unitPrice: 50 } : row));
  const back = convertQuoteItemsCurrency(edited, USD_FX, VND_FX);
  assert.equal(back[1].unitPrice, 1300000); // 50 x 26000
  assert.equal(back[1].costPrice, 1000000); // chua sua -> van goc VND
});

test('markup 20% tren gia von USD van dung cong thuc (gia khach - gia von)/gia von', () => {
  const cost = 38.46;
  const price = roundQuoteMoney(customerPriceFromMarkup(cost, 20) ?? 0, 'USD');
  assert.equal(price, 46.15);
  const markup = ((price - cost) / cost) * 100;
  assert.ok(Math.abs(markup - 20) < 0.05, `markup=${markup}`);
});

// ------------------------------------------------- form SP/DV (bug USD/VND)
const basePricing: PricingState = {
  pricingInputMode: 'cost',
  supplierCurrency: 'USD',
  supplierListPrice: 27.5,
  supplierDiscountPercent: 0,
  supplierNetPrice: 27.5,
  supplierExchangeRate: RATE,
  supplierConvertedPrice: 27.5 * RATE,
  shippingCost: 0,
  importFee: 0,
  otherCost: 0,
  costPriceVnd: 27.5 * RATE,
  markupPercent: 0,
  customerPriceVnd: 0,
};

test('form SP/DV: 27.5 USD -> VND = 715.000 theo ty gia that (khong giu nguyen 27.5)', () => {
  const next = reducePricing(basePricing, 'supplierCurrency', 'VND');
  assert.equal(next.supplierCurrency, 'VND');
  assert.equal(next.supplierListPrice, 715000);
  assert.equal(next.supplierNetPrice, 715000);
  assert.equal(next.costPriceVnd, 715000);
});

test('form SP/DV: doi lai VND -> USD ra 27.5; ty gia khac cho ket qua khac (khong hard-code)', () => {
  const vnd = reducePricing(basePricing, 'supplierCurrency', 'VND');
  const back = reducePricing(vnd, 'supplierCurrency', 'USD');
  assert.equal(back.supplierListPrice, 27.5);
  const other = reducePricing({ ...basePricing, supplierExchangeRate: 25000 }, 'supplierCurrency', 'VND');
  assert.equal(other.supplierListPrice, 687500);
});

test('form SP/DV: chua co ty gia thi KHONG doi tien te de lam sai so', () => {
  const noRate = { ...basePricing, supplierExchangeRate: 0 };
  const next = reducePricing(noRate, 'supplierCurrency', 'VND');
  assert.equal(next.supplierCurrency, 'USD');
  assert.equal(next.supplierListPrice, 27.5);
});

// ---- Sua bao gia trong wizard "Tao bao gia nhanh": nap dung tien te + ty gia da chot
test('quoteDraftFromExistingQuote: USD giu tien te + ty gia chot; VND bo text tu do "VNĐ"', () => {
  const base = { formSnapshot: { version: 1, layoutType: 'cloudgate_standard_quote', sections: [] }, items: [], data: {} } as unknown as Quote;
  const usd = quoteDraftFromExistingQuote({ ...base, currency: 'USD', exchangeRate: 26000, data: { currency: 'VNĐ' } } as Quote);
  assert.equal(usd.data.currency, 'USD');
  assert.equal(usd.exchangeRate, 26000);
  const vnd = quoteDraftFromExistingQuote({ ...base, currency: 'VND', exchangeRate: null, data: { currency: 'đồng' } } as Quote);
  assert.equal(vnd.data.currency, 'VND');
  assert.equal(vnd.exchangeRate, null);
});

console.log(`\n${passed} test PASS${process.exitCode ? ' (co test FAIL)' : ''}`);
