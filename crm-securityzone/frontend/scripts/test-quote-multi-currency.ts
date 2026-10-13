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
  billingTermMultiplier,
  calculateItemSubtotal,
  calculateItemTotal,
  calculateOverallDiscountSummary,
  calculateQuoteTotals,
} from '../modules/quotes/utils/quoteCalculations';
import { paymentPlanAmount } from '../modules/quotes/utils/paymentPlan';
import { VND_FX, convertQuoteItemsCurrency, type QuoteFx } from '../modules/quotes/utils/quoteCurrency';
import { reducePricing, effectiveCostPriceVnd, type PricingState } from '../modules/service-catalog/usePricingLogic';
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
  costVatRate: 0,
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

// ---- "VAT giá vốn" (2026-10-13): gia von hien thi/Markup/Margin tinh tren
// gia von DA GOM VAT dau vao, costPriceVnd thuan khong doi.
test('VAT giá vốn: 5.800.000 + 10% VAT -> effectiveCostPriceVnd = 6.380.000', () => {
  const state: PricingState = { ...basePricing, costPriceVnd: 5800000, costVatRate: 10, markupPercent: 0, customerPriceVnd: 0 };
  assert.ok(Math.abs(effectiveCostPriceVnd(state) - 6380000) < 0.01);
});

// supplierCurrency='VND' + supplierNetPrice = costPriceVnd mong muon, de
// nhanh "tinh lai costPriceVnd tu supplier chain" trong reducePricing KHONG
// ghi de mat gia tri test chu dinh (field != 'costPriceVnd' se tu tinh lai
// costPriceVnd = supplierConvertedPrice + extraCosts).
const vndCostBase: PricingState = {
  ...basePricing,
  supplierCurrency: 'VND',
  supplierListPrice: 5800000,
  supplierDiscountPercent: 0,
  supplierNetPrice: 5800000,
  supplierExchangeRate: 0,
  supplierConvertedPrice: 5800000,
  costPriceVnd: 5800000,
  customerPriceVnd: 0,
};

test('VAT giá vốn: markup 20% tinh tren gia von DA GOM VAT, khong phai gia von thuan', () => {
  const withVat = reducePricing({ ...vndCostBase, costVatRate: 10 }, 'markupPercent', 20);
  // gia von thuan: 5.800.000, da gom VAT 10%: 6.380.000 -> gia ban = 6.380.000*1.2 = 7.656.000
  assert.ok(Math.abs(withVat.customerPriceVnd - 7656000) < 0.01, `customerPriceVnd=${withVat.customerPriceVnd}`);
  // costPriceVnd (thuan, truoc VAT) KHONG bi ghi de boi VAT - tranh cong don neu tinh lai nhieu lan
  assert.equal(withVat.costPriceVnd, 5800000);
});

test('VAT giá vốn: costVatRate=0 cho ket qua GIONG HET truoc khi co tinh nang nay', () => {
  const noVat = reducePricing({ ...vndCostBase, costVatRate: 0 }, 'markupPercent', 20);
  assert.equal(noVat.customerPriceVnd, 6960000); // 5.800.000 * 1.2
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

// ---- "Chu kỳ" cho Combo (2026-10-13, mo rong dung chung voi san pham le):
// billingTermMultiplier CHI doc item.billingCycle/billingTermMonths, khong
// phu thuoc itemType - xac nhan Combo khong bi nhan trung he so thoi han, va
// thanh phan con (khong nam trong mang tinh tong) khong lam lech tong.
test('Chu kỳ Combo: Trả năm nhân đúng 1 lần hệ số 12, không phụ thuộc itemType', () => {
  const comboAnnual = { itemType: 'bundle', quantity: 2, unitPrice: 500000, billingCycle: 'annual' as const, billingTermMonths: 12, vatRate: 0, discountPercent: 0 };
  // 2 bo x 500.000/thang x 12 thang = 12.000.000 - KHONG phai 500.000*2*12*12
  assert.equal(calculateItemSubtotal(comboAnnual, 'VND'), 12000000);
});

test('Chu kỳ Combo: Trả tháng (mặc định) KHÔNG nhân hệ số, giống hệt sản phẩm lẻ', () => {
  const comboMonthly = { itemType: 'bundle', quantity: 2, unitPrice: 500000, billingCycle: 'monthly' as const, billingTermMonths: 1, vatRate: 0, discountPercent: 0 };
  assert.equal(calculateItemSubtotal(comboMonthly, 'VND'), 1000000);
});

test('Chu kỳ Combo: tổng báo giá chỉ cộng dòng cha, không cộng dòng con hiển thị ảo', () => {
  // Dong con Combo la ROW HIEN THI RIENG (bundleComponentsToWorkspaceRows()),
  // KHONG nam trong itemsDraft/mang truyen vao calculateQuoteTotals - mo
  // phong dung thuc te: chi 1 dong cha duy nhat trong mang tinh tong.
  const items = [
    { itemType: 'bundle' as const, quantity: 2, unitPrice: 500000, billingCycle: 'annual' as const, billingTermMonths: 12, vatRate: 0, discountPercent: 0 },
  ];
  const totals = calculateQuoteTotals(items, 0, 'VND');
  assert.equal(totals.totalAmount, 12000000);
  assert.equal(totals.subtotalAmount, 12000000);
});

// ---- "Giá vốn định kỳ phải tính đủ thời gian sử dụng" (2026-10-14): Cost tổng
// (resolveQuoteItemCostTotal trong QuoteWorkspaceModal.tsx - KHONG export,
// khong import duoc truc tiep vao script nay giong cac ham noi bo khac cua
// file do) phai dung CHUNG billingTermMultiplier voi Thanh tien
// (calculateItemSubtotal) de margin khong bi lech khi Chu ky = Tra nam. Test
// o day xac nhan billingTermMultiplier (da export) tra dung he so, VA mo
// phong lai dung cong thuc moi cua resolveQuoteItemCostTotal (costPrice *
// quantity * billingTermMultiplier) de doi chieu bang tay voi doanh thu.
test('billingTermMultiplier: Trả năm (billingTermMonths=12) = 12; Trả tháng/không có Chu kỳ = 1', () => {
  assert.equal(billingTermMultiplier({ billingCycle: 'annual', billingTermMonths: 12 }), 12);
  assert.equal(billingTermMultiplier({ billingCycle: 'monthly', billingTermMonths: 1 }), 1);
  assert.equal(billingTermMultiplier({}), 1);
  assert.equal(billingTermMultiplier({ billingCycle: 'annual', billingTermMonths: 1 }), 1); // <=1 khong nhan
});

test('Combo target, Trả năm: Cost tổng và Thành tiền dùng CHUNG hệ số 12, margin không đổi', () => {
  // Gia lap 1 dong Combo costSource='target': costPrice/thang = 279.300,
  // unitPrice/thang (annual rate) = 499.000, quantity (so bo) = 1.
  const item = { itemType: 'bundle' as const, quantity: 1, unitPrice: 499000, costPrice: 279300, billingCycle: 'annual' as const, billingTermMonths: 12, vatRate: 0, discountPercent: 0 };
  const bt = billingTermMultiplier(item);
  const resolveQuoteItemCostTotalMirror = item.costPrice * item.quantity * bt; // cong thuc moi
  assert.equal(resolveQuoteItemCostTotalMirror, 279300 * 12); // 3.351.600 - DUNG 1 lan he so 12
  const subtotal = calculateItemSubtotal(item, 'VND'); // doanh thu, da co san tu truoc
  assert.equal(subtotal, 499000 * 12); // 5.988.000 - cung 1 nguon he so voi cost
  // Margin% tren CA 2 cach tinh (theo thang hay theo nam) phai GIONG NHAU vi
  // he so 12 duoc NHAN DEU ca tu so va mau so - dung chinh diem sep lo "margin sai".
  const marginPerMonth = ((item.unitPrice - item.costPrice) / item.unitPrice) * 100;
  const marginPerYear = ((subtotal - resolveQuoteItemCostTotalMirror) / subtotal) * 100;
  assert.ok(Math.abs(marginPerMonth - marginPerYear) < 1e-9, `marginPerMonth=${marginPerMonth} marginPerYear=${marginPerYear}`);
});

test('Combo rollup/sản phẩm lẻ không Chu kỳ: Cost tổng KHÔNG đổi so với code cũ (hệ số = 1)', () => {
  const item = { itemType: 'bundle' as const, quantity: 2, unitPrice: 500000, costPrice: 350000, vatRate: 0, discountPercent: 0 };
  const resolveQuoteItemCostTotalMirror = item.costPrice * item.quantity * billingTermMultiplier(item);
  assert.equal(resolveQuoteItemCostTotalMirror, 700000); // y het cost*quantity cu, khong co Chu ky nen he so 1
});

console.log(`\n${passed} test PASS${process.exitCode ? ' (co test FAIL)' : ''}`);
