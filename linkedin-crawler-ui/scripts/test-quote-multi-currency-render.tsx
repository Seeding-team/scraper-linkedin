/* Test render (SSR) multi-currency: QuoteDocumentRenderer / PaymentPlanEditor / CatalogPickerModal.
 * Chay:  npx tsx --require ./scripts/css-stub.cjs scripts/test-quote-multi-currency-render.tsx
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuoteDocumentRenderer } from '../modules/quotes/components/QuoteDocumentRenderer';
import { PaymentPlanEditor } from '../modules/quotes/components/PaymentPlanEditor';
import { CatalogPickerModal, type CatalogPickerListItem } from '../modules/service-catalog/CatalogPickerModal';
import { QuoteFormFiller } from '../modules/quotes/components/QuoteFormFiller';
import { calculateQuoteTotals } from '../modules/quotes/utils/quoteCalculations';
import type { QuoteItem, QuoteSchema } from '../modules/quotes/types';

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

const schema = {
  version: 1,
  layoutType: 'cloudgate_standard_quote',
  enableDynamicPaymentPlan: true,
  sections: [
    {
      key: 'items',
      title: 'Hạng mục',
      fields: [
        {
          key: 'quoteItems',
          label: 'Hạng mục',
          type: 'repeater-table',
          visible: true,
          editable: true,
          config: {
            columns: [
              { key: 'order', label: 'STT', type: 'auto-number' },
              { key: 'serviceDescription', label: 'Hạng mục', type: 'text' },
              { key: 'quantity', label: 'SL', type: 'number' },
              { key: 'unitPrice', label: 'Đơn giá (VND)', type: 'currency' },
              { key: 'total', label: 'Thành tiền bao gồm VAT (VND)', type: 'calculated' },
            ],
          },
        },
      ],
    },
  ],
} as unknown as QuoteSchema;

const usdItems: QuoteItem[] = [
  { rowType: 'item', serviceDescription: 'Dich vu A', quantity: 3, unitPrice: 48.08, vatRate: 10, discountPercent: 0 },
];
const vndItems: QuoteItem[] = [
  { rowType: 'item', serviceDescription: 'Dich vu A', quantity: 3, unitPrice: 1250000, vatRate: 10, discountPercent: 0 },
];

function render(items: QuoteItem[], currency: string | undefined, paymentPlan = false) {
  const totals = calculateQuoteTotals(items, 0, currency);
  return renderToStaticMarkup(
    <QuoteDocumentRenderer
      schemaSnapshot={schema}
      quoteData={paymentPlan ? { paymentPlan: [{ id: '1', phase: 'Đợt 1', percent: 30, condition: '', note: '' }] } : {}}
      quoteItems={items}
      totals={totals}
      mode="public"
      currency={currency}
    />
  );
}

test('Renderer VND (quote cu, khong truyen currency): giu nguyen header (VND), so dang 1.250.000', () => {
  const html = render(vndItems, undefined);
  assert.match(html, /Đơn giá \(VND\)/);
  assert.match(html, /1\.250\.000/);
  assert.doesNotMatch(html, /\$/);
});

test('Renderer USD: header doi (USD), don gia $48.08, thanh tien $158.66, khong con "(VND)"', () => {
  const html = render(usdItems, 'USD');
  assert.match(html, /Đơn giá \(USD\)/);
  assert.match(html, /Thành tiền \(gồm VAT\)/); // cot total luon dung nhan chuan hoa, khong con (VND)
  assert.doesNotMatch(html, /\(VND\)/);
  assert.match(html, /\$48\.08/);
  assert.match(html, /\$158\.66/);
  assert.match(html, /\$144\.24/); // tong cong chua thue
  assert.match(html, /\$14\.42/); // VAT
});

test('Renderer USD + ke hoach thanh toan: so tien tung dot theo USD', () => {
  const html = render(usdItems, 'USD', true);
  assert.match(html, /\$47\.60/); // 30% x 158.66 = 47.598
});

test('PaymentPlanEditor USD hien $, VND giu dang cu', () => {
  const rows = [{ id: '1', phase: 'Đợt 1', percent: 50, condition: '', note: '' }];
  const usd = renderToStaticMarkup(<PaymentPlanEditor rows={rows} finalPayable={158.66} onChange={() => {}} currency="USD" />);
  assert.match(usd, /\$79\.33/);
  const vnd = renderToStaticMarkup(<PaymentPlanEditor rows={rows} finalPayable={4125000} onChange={() => {}} />);
  assert.match(vnd, /2\.062\.500/);
});

const pickerItems: CatalogPickerListItem[] = [
  { id: 'a', name: 'San pham da co', sku: 'SKU-A', customerPriceVnd: 1250000, costPriceVnd: 1000000, status: 'active', alreadyAdded: true, itemType: 'component' },
  { id: 'b', name: 'San pham moi', sku: 'SKU-B', customerPriceVnd: 2600000, costPriceVnd: 2000000, status: 'active', alreadyAdded: false, itemType: 'component' },
];

function renderPicker(props: Partial<React.ComponentProps<typeof CatalogPickerModal>> = {}) {
  return renderToStaticMarkup(
    <CatalogPickerModal
      open
      onClose={() => {}}
      showZoneTab={false}
      activeSource="internal"
      onSourceChange={() => {}}
      loading={false}
      items={pickerItems}
      onAddSelected={() => {}}
      {...props}
    />
  );
}

test('Picker VND: gia VND goc; co toggle VND|USD khi host cho phep doi', () => {
  const html = renderPicker({ quoteCurrency: 'VND', onQuoteCurrencyChange: () => {} });
  assert.match(html, /1\.250\.000/);
  assert.match(html, /aria-label="Tiền tệ báo giá"/);
  assert.match(html, />VND</);
  assert.match(html, />USD</);
});

test('Picker USD: gia quy doi theo ty gia (1.250.000 -> $48.08, 2.600.000 -> $100.00), khong sua gia goc', () => {
  const html = renderPicker({ quoteCurrency: 'USD', exchangeRate: 26000, onQuoteCurrencyChange: () => {} });
  assert.match(html, /\$48\.08/);
  assert.match(html, /\$100\.00/);
  assert.doesNotMatch(html, /1\.250\.000/);
  assert.match(html, /1 USD = 26\.000 VND/);
});

test('Picker USD thieu ty gia: khong bia gia, hien "—"', () => {
  const html = renderPicker({ quoteCurrency: 'USD', exchangeRate: null });
  assert.doesNotMatch(html, /\$/);
});

test('Picker alreadyAdded: badge "Đã có trong báo giá", checkbox disabled + KHONG checked, co Tăng SL / Thêm dòng mới', () => {
  const html = renderPicker({ onIncreaseExisting: () => {}, onAddAnother: () => {} });
  assert.match(html, /Đã có trong báo giá/);
  assert.match(html, />Tăng SL</);
  assert.match(html, />Thêm dòng mới</);
  // dong SKU-A (da co): checkbox disabled va khong checked
  const rowA = html.split('<tr').find(chunk => chunk.includes('San pham da co')) || '';
  assert.match(rowA, /type="checkbox"[^>]*disabled/);
  assert.doesNotMatch(rowA, /checked=""/);
  // dong SKU-B (chua co): khong co badge
  const rowB = html.split('<tr').find(chunk => chunk.includes('San pham moi')) || '';
  assert.doesNotMatch(rowB, /Đã có trong báo giá/);
  // khong tinh vao so luong chon
  assert.match(html, /Chưa chọn sản phẩm nào/);
  assert.match(html, /\+ Thêm vào báo giá \(0\)/);
});

// ---- Luong "Tao bao gia nhanh" (QuoteFormFiller) dung CHUNG logic tien te
const fillerSchema = schema;

function renderFiller(currency: string, rate: number | null, items: QuoteItem[], sch: QuoteSchema = fillerSchema) {
  return renderToStaticMarkup(
    <QuoteFormFiller
      schema={sch}
      value={{ data: { currency }, items, solutionItems: [], exchangeRate: rate }}
      onChange={() => {}}
      showTotals
    />
  );
}

test('Filler USD: tong $144.24 / VAT $14.42 / $158.66, header (USD), co control VND|USD + ty gia chot', () => {
  const html = renderFiller('USD', 26000, usdItems);
  assert.match(html, /\$144\.24/);
  assert.match(html, /\$14\.42/);
  assert.match(html, /\$158\.66/);
  assert.match(html, /aria-label="Tiền tệ báo giá"/);
  assert.match(html, /1 USD = 26\.000 VND/);
  assert.match(html, /Thành tiền: \$158\.66/); // dong hang muc theo USD
  assert.doesNotMatch(html, /đ</);
});

test('Filler VND (mac dinh / data.currency la text "VNĐ" hoac rong): giu nguyen 3.750.000, khong co $', () => {
  for (const cur of ['VND', 'VNĐ', '']) {
    const html = renderFiller(cur, null, vndItems);
    assert.match(html, /3\.750\.000/);
    assert.match(html, /Thành tiền: 4\.125\.000/);
    assert.doesNotMatch(html, /\$/);
  }
});

test('Filler: mau Villa luon VND, khong ep USD', () => {
  const html = renderFiller('USD', 26000, [], { ...schema, layoutType: 'villa_solution_package' } as unknown as QuoteSchema);
  assert.doesNotMatch(html, /\$/);
});

console.log(`\n${passed} test PASS${process.exitCode ? ' (co test FAIL)' : ''}`);
