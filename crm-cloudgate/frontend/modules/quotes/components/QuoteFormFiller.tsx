'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { BundleSnapshotComponent, QuoteData, QuoteField, QuoteItem, QuoteSchema, VillaSolutionItem } from '../types';
import {
  calculateItemAfterDiscount,
  calculateItemDiscount,
  calculateItemSubtotal,
  calculateItemTotal,
  calculateItemVat,
  calculateQuoteTotals,
  calculateVillaTotals,
  clampDiscountPercent,
  formatVnd,
  sanitizeMoneyInput,
} from '../utils/quoteCalculations';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import { serviceCatalogRepository } from '../../service-catalog/repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem, ServiceCatalogOptions } from '../../service-catalog/types';
import { SearchableSelect } from '../../crm/components/SearchableSelect';
import { CatalogPickerModal, type CatalogPickerListItem } from '../../service-catalog/CatalogPickerModal';
import { useCatalogItemAdd } from '../../service-catalog/useCatalogItemAdd';
import { ConfirmModal } from '../../crm/components/ConfirmModal';
import { CurrencyInput } from '@/components/CurrencyInput';
import { PaymentPlanEditor } from './PaymentPlanEditor';
import { calculateOverallDiscountSummary, formatMoney } from '../utils/quoteCalculations';
import { localizeCurrencyLabel, normalizeQuoteCurrency, type QuoteCurrency } from '@/lib/currency';
import { VND_FX, convertQuoteItemsCurrency, type QuoteFx } from '../utils/quoteCurrency';
import { describeSystemRate, fetchSystemUsdVndRate, fetchSystemUsdVndRateInfo } from '../../service-catalog/useSystemExchangeRate';
import type { SystemExchangeRate } from '../repositories/QuoteRepository';

export interface QuoteFillValue {
  data: QuoteData;
  items: QuoteItem[];
  solutionItems: VillaSolutionItem[];
  overallDiscountPercent?: number | null;
  /** Ty gia (VND / 1 USD) da chot khi data.currency = 'USD'; null = VND. */
  exchangeRate?: number | null;
}

/** Tien te + ty gia cua bao gia dang soan - DUNG CHUNG logic quy doi voi Quote Workspace
 * (lib/currency + utils/quoteCurrency), khong co logic rieng. */
const QuoteCurrencyContext = createContext<QuoteFx>(VND_FX);
const moneyInputProps = (currency: QuoteCurrency) => (currency === 'USD' ? ({ decimals: 2, locale: 'en-US' } as const) : ({} as const));

interface Props {
  schema: QuoteSchema;
  value: QuoteFillValue;
  onChange: (next: QuoteFillValue) => void;
  quoteFormId?: string;
  /** Ép hiện/ẩn khối Tạm tính/VAT/Tổng cộng bất kể layoutType — dùng khi bước 2
   * wizard ("Hạng mục báo giá") cần LUÔN hiện khối này kể cả với mẫu villa (mặc
   * định trước đây villa không hiện khối này ở màn điền, chỉ hiện ở preview).
   * undefined = giữ hành vi cũ (ẩn với villa, hiện với các mẫu khác). */
  showTotals?: boolean;
  /** false = khong tu chen control tien te canh bang hang muc (khi cho khac cua cung man da co,
   * vd FillQuoteStep combined hien o khoi 'Thong tin bao gia'). Mac dinh true. */
  showCurrencyInItems?: boolean;
}

type RowRecord = Record<string, unknown>;

const WIDE_FIELD_KEYS = new Set([
  'quoteTitle',
  'quoteSubtitle',
  'quoteBenefitLine',
  'customerNeed',
  'customerRequirement',
  'proposedSolution',
  'solutionOverview',
  'projectScope',
]);

function emptyItemRow(): QuoteItem {
  return {
    description: '',
    serviceDescription: '',
    unit: '',
    quantity: 1,
    unitPrice: 0,
    discountPercent: 0,
    vatRate: 10,
    children: [],
  };
}

function emptySolutionRow(): VillaSolutionItem {
  return { name: '', description: '', originalPrice: 0, offerPrice: 0, note: '' };
}

function countQuoteItemRows(items: QuoteItem[]): number {
  return items.reduce(
    (count, item) => count + (item.rowType === 'section' ? countQuoteItemRows(item.children || []) : 1),
    0
  );
}

function coerceNumber(value: string) {
  return Number(value) || 0;
}

function coercePercent(value: string) {
  return clampDiscountPercent(Number(value) || 0);
}

export function QuoteFormFiller({ schema, value, onChange, quoteFormId, showTotals, showCurrencyInItems = true }: Props) {
  const layoutType = schema.layoutType;
  const sections = schema.sections || [];
  const isVillaLayout = layoutType === 'villa_solution_package';
  // Villa (solutionItems) luon VND; mau thuong theo data.currency (chi 'USD' moi la USD).
  const currency: QuoteCurrency = isVillaLayout ? 'VND' : normalizeQuoteCurrency(value.data.currency);
  const fx: QuoteFx = { currency, rate: currency === 'USD' ? value.exchangeRate ?? null : null };
  const totals = isVillaLayout ? calculateVillaTotals(value.solutionItems) : calculateQuoteTotals(value.items, 0, currency);
  const shouldShowTotals = typeof showTotals === 'boolean' ? showTotals : layoutType !== 'villa_solution_package';
  const fmt = (amount: unknown) => formatMoney(amount, currency);
  const [pendingSwitch, setPendingSwitch] = useState<{ target: QuoteCurrency; rateInput: number | null; custom?: boolean } | null>(null);
  const [systemRate, setSystemRate] = useState<number | null>(null);
  const [systemRateInfo, setSystemRateInfo] = useState<SystemExchangeRate | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchSystemUsdVndRate().then(rate => {
      if (alive) setSystemRate(rate);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!systemRate) return;
    setPendingSwitch(current => (current && current.target === 'USD' && !(current.rateInput && current.rateInput > 0) ? { ...current, rateInput: systemRate } : current));
  }, [systemRate, pendingSwitch?.target]);

  function applyCurrency(target: QuoteCurrency, rate: number | null) {
    const to: QuoteFx = { currency: target, rate: target === 'USD' ? rate : null };
    onChange({
      ...value,
      data: { ...value.data, currency: target },
      exchangeRate: to.rate,
      items: convertQuoteItemsCurrency(value.items, fx, to),
    });
  }

  async function requestCurrency(target: QuoteCurrency) {
    if (target === currency) return;
    // Chon USD: lay TY GIA HE THONG MOI NHAT de khong bat nhap tay (bao gia da tao giu ty gia da chot).
    const info = target === 'USD' ? await fetchSystemUsdVndRateInfo(true) : null;
    const rate = info?.rate ?? null;
    if (target === 'USD') {
      setSystemRate(rate);
      setSystemRateInfo(info);
    }
    const hasItems = value.items.length > 0;
    if (!hasItems && (target === 'VND' || (rate && rate > 0))) {
      applyCurrency(target, rate);
      return;
    }
    setPendingSwitch({ target, rateInput: rate });
  }

  const currencyControl = isVillaLayout ? (
    <strong>VND</strong>
  ) : (
    <div className="quote-currency-switch" role="group" aria-label="Tiền tệ báo giá" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {(['VND', 'USD'] as const).map(code => (
          <button
            key={code}
            type="button"
            className="quote-add-parent-button quote-add-parent-button--secondary"
            style={{
              width: 'auto',
              flex: '0 0 auto',
              padding: '6px 18px',
              fontWeight: 700,
              ...(currency === code ? { background: '#c2185b', color: '#fff', borderColor: '#c2185b' } : {}),
            }}
            aria-pressed={currency === code}
            onClick={() => requestCurrency(code)}
          >
            {code}
          </button>
        ))}
        {currency === 'USD' && fx.rate ? <em>1 USD = {fx.rate.toLocaleString('vi-VN')} VND (tỷ giá đã chốt)</em> : null}
      </span>
      {pendingSwitch ? (
        <span className="quote-currency-confirm" role="alertdialog" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <span>
            {value.items.length
              ? `Giá vốn và đơn giá của ${value.items.length} hạng mục sẽ được quy đổi sang ${pendingSwitch.target}, tổng tiền tính lại. Giá gốc trong danh mục (VND) không đổi.`
              : `Báo giá sẽ chuyển sang ${pendingSwitch.target}.`}
          </span>
          {pendingSwitch.target === 'USD' ? (
            systemRate && !pendingSwitch.custom ? (
              <span>
                Tỷ giá hệ thống: <strong>1 USD = {systemRate.toLocaleString('vi-VN')} VND</strong> — sẽ được chốt cho báo giá này.
                {systemRateInfo ? <small style={{ display: 'block' }}>{describeSystemRate(systemRateInfo)}</small> : null}
                {systemRateInfo?.stale ? <small style={{ display: 'block' }}>Chưa lấy được tỷ giá mới — đang dùng tỷ giá gần nhất.</small> : null}{' '}
                <button type="button" onClick={() => setPendingSwitch(current => (current ? { ...current, custom: true } : current))}>
                  Dùng tỷ giá khác
                </button>
              </span>
            ) : (
              <label>
                Tỷ giá (1 USD = ? VND) — chốt cho báo giá này
                <CurrencyInput
                  decimals={2}
                  locale="en-US"
                  value={pendingSwitch.rateInput}
                  placeholder={systemRate ? undefined : 'Chưa có tỷ giá hệ thống - nhập tỷ giá'}
                  onChange={next => setPendingSwitch(current => (current ? { ...current, rateInput: next } : current))}
                />
                {!systemRate ? <small>Chưa lấy được tỷ giá tự động — nhập tỷ giá, hoặc Admin vào Cài đặt báo giá → Tỷ giá USD/VND để cập nhật.</small> : null}
              </label>
            )
          ) : (
            <span>Quy đổi ngược theo tỷ giá đã chốt: 1 USD = {(fx.rate ?? 0).toLocaleString('vi-VN')} VND.</span>
          )}
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              className="quote-add-parent-button"
              disabled={pendingSwitch.target === 'USD' && !(pendingSwitch.rateInput && pendingSwitch.rateInput >= 1000 && pendingSwitch.rateInput <= 100000)}
              onClick={() => {
                applyCurrency(pendingSwitch.target, pendingSwitch.rateInput);
                setPendingSwitch(null);
              }}
            >
              Đổi sang {pendingSwitch.target}
            </button>
            <button type="button" className="quote-add-parent-button quote-add-parent-button--secondary" onClick={() => setPendingSwitch(null)}>
              Huỷ
            </button>
          </span>
        </span>
      ) : null}
    </div>
  );

  function setData(key: string, fieldValue: unknown) {
    onChange({ ...value, data: { ...value.data, [key]: fieldValue } });
  }

  return (
    <QuoteCurrencyContext.Provider value={fx}>
    <div className="quote-form-filler">
      {sections.map(section => {
        const repeaterField = section.fields.find(field => field.type === 'repeater-table');
        if (repeaterField) {
          const isSolutionTable = repeaterField.key === 'solutionItems';
          const isQuoteItemsTable = repeaterField.key === 'quoteItems';
          const itemCount = isQuoteItemsTable ? countQuoteItemRows(value.items) : isSolutionTable ? value.solutionItems.length : 0;
          return (
            <section key={section.key} className="quote-section-card">
              <div className="quote-section-head">
                <h4>
                  {section.title}
                  {isQuoteItemsTable || isSolutionTable ? <span className="quote-section-count-badge">{itemCount} hạng mục</span> : null}
                </h4>
              </div>
              {isQuoteItemsTable && showCurrencyInItems && !schema.sections.some(sec => sec.fields.some(f => f.key === 'currency')) ? (
                <div className="quote-currency-row" style={{ marginBottom: 8 }}>
                  <span>Tiền tệ: </span>
                  {currencyControl}
                </div>
              ) : null}
              {isQuoteItemsTable || isSolutionTable ? (
                <p className="quote-section-hint">
                  Chọn các sản phẩm đang kinh doanh từ danh mục. Giá và mô tả sẽ được sao chép vào báo giá.
                </p>
              ) : null}
              {isQuoteItemsTable ? (
                <QuoteItemsEditor
                  items={value.items}
                  columns={repeaterField.config?.columns || []}
                  onChange={items => onChange({ ...value, items })}
                  quoteFormId={quoteFormId}
                />
              ) : isSolutionTable ? (
                <SolutionItemsEditor
                  items={value.solutionItems}
                  onChange={solutionItems => onChange({ ...value, solutionItems })}
                  quoteFormId={quoteFormId}
                />
              ) : (
                <RepeaterTable
                  columns={repeaterField.config?.columns || []}
                  rows={value.items as unknown as RowRecord[]}
                  emptyRow={() => emptyItemRow() as unknown as RowRecord}
                  emptyLabel="Chưa có dòng dịch vụ."
                  onChange={rows => onChange({ ...value, items: rows as unknown as QuoteItem[] })}
                />
              )}
            </section>
          );
        }
        return (
          <section key={section.key} className="quote-section-card">
            <div className="quote-section-head">
              <h4>{section.title}</h4>
            </div>
            <div className="quote-filler-field-grid">
              {section.fields.map(field => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={value.data[field.key]}
                  data={value.data}
                  totals={totals}
                  currencyControl={currencyControl}
                  onChange={fieldValue => setData(field.key, fieldValue)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {!shouldShowTotals ? null : (
        <section className="quote-section-card quote-totals-card">
          <div className="quote-total-row">
            <span>Tạm tính</span>
            <strong>{fmt(totals.subtotalAmount)}</strong>
          </div>
          {totals.discountAmount ? (
            <div className="quote-total-row quote-total-row--discount">
              <span>Giảm giá</span>
              <strong>-{fmt(totals.discountAmount)}</strong>
            </div>
          ) : null}
          <div className="quote-total-row">
            <span>VAT</span>
            <strong>{fmt(totals.totalVatAmount)}</strong>
          </div>
          <div className="quote-total-row quote-total-row--grand">
            <span>Tổng cộng</span>
            <strong>{fmt(totals.totalAmount)}</strong>
          </div>
        </section>
      )}
      {shouldShowTotals && schema.enableDynamicPaymentPlan && layoutType !== 'villa_solution_package' ? (
        <PaymentPlanEditor rows={value.data.paymentPlan || []}
          finalPayable={calculateOverallDiscountSummary(totals, value.overallDiscountPercent, currency).grandTotal}
          currency={currency}
          onChange={paymentPlan => setData('paymentPlan', paymentPlan)} />
      ) : null}
    </div>
    </QuoteCurrencyContext.Provider>
  );
}

function FieldInput({
  field,
  value,
  data,
  totals,
  currencyControl,
  onChange,
}: {
  field: QuoteField;
  value: unknown;
  data: QuoteData;
  totals: { subtotalAmount: number; discountAmount?: number; totalVatAmount: number; totalAmount: number };
  currencyControl?: React.ReactNode;
  onChange: (value: unknown) => void;
}) {
  const { currency: ctxCurrency } = useContext(QuoteCurrencyContext);
  if (field.visible === false) return null;
  if (field.key === 'currency') {
    // Tien te la lua chon he thong (VND | USD), khong con la o text tu do.
    return (
      <div className={`crm-field`}>
        <span>{field.label}</span>
        {currencyControl}
      </div>
    );
  }
  const disabled = field.editable === false;
  const fieldClass = `crm-field ${field.type === 'textarea' || field.type === 'repeatable-textarea' || WIDE_FIELD_KEYS.has(field.key) ? 'crm-field--full' : ''}`;
  const label = (
    <>
      <span>
        {field.label} {field.required ? <b>*</b> : null}
      </span>
      {field.helpText ? <p className="crm-help-text">{field.helpText}</p> : null}
    </>
  );

  if (field.type === 'calculated') {
    let computed = 0;
    if (field.key === 'subtotalAmount') computed = totals.subtotalAmount;
    else if (field.key === 'totalVatAmount') computed = totals.totalVatAmount;
    else if (field.key === 'totalAmount') computed = totals.totalAmount;
    else if (field.key === 'setupTotalAmount') computed = totals.totalAmount;
    else if (field.key === 'paymentPhaseOneAmount')
      computed = (totals.totalAmount * sanitizeMoneyInput(data.paymentPhaseOnePercent)) / 100;
    else if (field.key === 'paymentPhaseTwoAmount')
      computed = (totals.totalAmount * sanitizeMoneyInput(data.paymentPhaseTwoPercent)) / 100;
    return (
      <label className={fieldClass}>
        {label}
        <input value={formatMoney(computed, ctxCurrency)} disabled readOnly />
      </label>
    );
  }

  if (field.type === 'auto-number' || field.config?.generatedWhenCreatingQuote) {
    return (
      <label className={fieldClass}>
        {label}
        <input value="Sẽ sinh khi lưu" disabled readOnly />
      </label>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <label className={`${fieldClass} quote-switch`}>
        <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={event => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className={fieldClass}>
        {label}
        <select value={String(value ?? field.defaultValue ?? '')} disabled={disabled} onChange={event => onChange(event.target.value)}>
          <option value="">-- Chọn --</option>
          {(field.options || []).map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className={fieldClass}>
        {label}
        <textarea value={String(value ?? field.defaultValue ?? '')} placeholder={field.placeholder} disabled={disabled} onChange={event => onChange(event.target.value)} />
      </label>
    );
  }

  if (field.type === 'repeatable-textarea') {
    const rows = Array.isArray(value) ? value : Array.isArray(field.defaultValue) ? field.defaultValue : [];
    return (
      <label className={fieldClass}>
        {label}
        <textarea value={(rows as string[]).join('\n')} placeholder={field.placeholder} disabled={disabled} onChange={event => onChange(event.target.value.split('\n'))} />
      </label>
    );
  }

  if (field.type === 'currency') {
    const numericValue =
      typeof value === 'number'
        ? value
        : value === undefined || value === null || value === ''
          ? (typeof field.defaultValue === 'number' ? field.defaultValue : null)
          : Number(value) || 0;
    return (
      <label className={fieldClass}>
        {label}
        <CurrencyInput
          {...moneyInputProps(ctxCurrency)}
          value={numericValue}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={next => onChange(next ?? 0)}
        />
      </label>
    );
  }

  const inputType =
    field.type === 'number'
      ? 'number'
      : field.type === 'email'
        ? 'email'
        : field.type === 'phone'
          ? 'tel'
          : field.type === 'date'
            ? 'date'
            : 'text';

  return (
    <label className={fieldClass}>
      {label}
      <input
        type={inputType}
        value={value === undefined || value === null ? String(field.defaultValue ?? '') : String(value)}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={event => onChange(field.type === 'number' ? Number(event.target.value) || 0 : event.target.value)}
      />
    </label>
  );
}

/** "SKU – Tên" nhưng bỏ phần SKU nếu trùng hệt tên (vd bundle SZ-VPS đặt tên
 * cũng là "SZ-VPS" — hiển thị "SZ-VPS – SZ-VPS" bị lặp thừa, chỉ cần "SZ-VPS"). */
function formatSkuName(sku: string | undefined, name: string): string {
  if (!sku || sku.trim().toLowerCase() === name.trim().toLowerCase()) return name;
  return `${sku} – ${name}`;
}

/** Nhãn ngắn cho dropdown — nhiều tên dịch vụ (vd SZ-SSD, SZ-BW...) nhét luôn mô
 * tả dài phía sau dấu "-" khiến option tràn ngang màn hình. Chỉ cắt phần hiển
 * thị trong dropdown, không đụng tới dữ liệu thật lưu vào báo giá. */
function shortDropdownLabel(name: string): string {
  const dashIndex = name.indexOf(' - ');
  const short = dashIndex === -1 ? name : name.slice(0, dashIndex);
  return short.length > 60 ? `${short.slice(0, 60)}…` : short;
}

function bundleToQuoteItem(bundle: ServiceCatalogItem): QuoteItem {
  const components = bundle.components || [];
  const seenPools = new Set<string>();
  const visibleComponents = components.filter(component => {
    if (component.showOnQuote === false) return false;
    if (!component.quotaPoolKey) return true;
    if (seenPools.has(component.quotaPoolKey)) return false;
    seenPools.add(component.quotaPoolKey);
    return true;
  });
  const includedDescription = visibleComponents
    .map(component => {
      if (component.quotaPoolKey) return `${component.quotaPoolName || component.customerDisplayName || component.name}: ${component.quotaPoolQuota || component.quota || component.displayText}`;
      if (component.customerDisplayName) return component.quota ? `${component.customerDisplayName}: ${component.quota}` : component.customerDisplayName;
      return component.description ? `${component.displayText} - ${component.description}` : component.displayText;
    })
    .join('\n');
  const description = [
    bundle.quoteDescription || bundle.description,
    bundle.quoteCta,
    includedDescription ? `Bao gồm:\n${includedDescription}` : null,
  ].filter(Boolean).join('\n\n');
  const bundleSnapshot: BundleSnapshotComponent[] = components.map(component => ({
    componentId: component.componentId,
    sku: component.sku,
    name: component.name,
    description: component.description,
    unit: component.unit,
    quantity: component.quantity,
    computedQuantity: component.computedQuantity,
    displayText: component.displayText,
    unitPriceVnd: component.unitPriceVnd,
    defaultCostPriceVnd: component.defaultCostPriceVnd,
    defaultMarkupPercent: component.defaultCostPriceVnd != null && (component.defaultCustomerPriceVnd ?? component.unitPriceVnd) != null && component.defaultCostPriceVnd > 0
      ? (((component.defaultCustomerPriceVnd ?? component.unitPriceVnd) - component.defaultCostPriceVnd) / component.defaultCostPriceVnd) * 100
      : null,
    defaultCustomerPriceVnd: component.defaultCustomerPriceVnd ?? component.unitPriceVnd,
    quota: component.quota,
    customerDisplayName: component.customerDisplayName,
    crmNote: component.crmNote,
    quotaPoolKey: component.quotaPoolKey,
    quotaPoolName: component.quotaPoolName,
    quotaPoolQuota: component.quotaPoolQuota,
    quotaPoolLimit: component.quotaPoolLimit,
    required: component.required,
    overagePolicy: component.overagePolicy,
    showOnQuote: component.showOnQuote,
    sortOrder: component.sortOrder,
  }));
  return {
    serviceDescription: bundle.quoteDisplayName || formatSkuName(bundle.sku, bundle.name),
    description,
    unit: bundle.unit || '',
    quantity: 1,
    unitPrice: bundle.defaultUnitPriceVnd,
    discountPercent: bundle.defaultDiscountPercent || 0,
    vatRate: bundle.defaultVatRate ?? 0,
    children: [],
    catalogItemId: bundle.id,
    bundleSnapshot,
    listPriceUsd: bundle.listPriceUsd,
    unitPriceUsd: bundle.unitPriceUsd,
    exchangeRate: bundle.exchangeRateSnapshot,
    unitPriceVnd: bundle.defaultUnitPriceVnd,
  };
}

function componentToQuoteItem(component: ServiceCatalogItem): QuoteItem {
  return {
    serviceDescription: formatSkuName(component.sku, component.name),
    description: component.description || '',
    unit: component.unit || '',
    quantity: 1,
    unitPrice: component.defaultUnitPriceVnd,
    discountPercent: component.defaultDiscountPercent || 0,
    vatRate: component.defaultVatRate ?? 0,
    children: [],
    catalogItemId: component.id,
    listPriceUsd: component.listPriceUsd,
    unitPriceUsd: component.unitPriceUsd,
    exchangeRate: component.exchangeRateSnapshot,
    unitPriceVnd: component.defaultUnitPriceVnd,
  };
}

function bundleToSolutionItem(bundle: ServiceCatalogItem): VillaSolutionItem {
  const components = bundle.components || [];
  const seenPools = new Set<string>();
  const visibleComponents = components
    .filter(component => component.showOnQuote !== false)
    .filter(component => {
      if (!component.quotaPoolKey) return true;
      if (seenPools.has(component.quotaPoolKey)) return false;
      seenPools.add(component.quotaPoolKey);
      return true;
    });
  const included = visibleComponents
    .map(component => {
      if (component.quotaPoolKey) return `${component.quotaPoolName || component.customerDisplayName || component.name}: ${component.quotaPoolQuota || component.quota || component.displayText}`;
      if (component.customerDisplayName) return component.quota ? `${component.customerDisplayName}: ${component.quota}` : component.customerDisplayName;
      return component.description ? `${component.displayText} - ${component.description}` : component.displayText;
    })
    .filter(Boolean)
    .join('\n');
  const description = [
    bundle.quoteDescription || bundle.description,
    bundle.quoteCta,
    included ? `Bao gồm:\n${included}` : null,
  ].filter(Boolean).join('\n\n');
  return {
    name: bundle.quoteDisplayName || formatSkuName(bundle.sku, bundle.name),
    description,
    originalPrice: bundle.defaultUnitPriceVnd,
    offerPrice: bundle.defaultUnitPriceVnd,
    note: '',
    catalogItemId: bundle.id,
  };
}

function componentToSolutionItem(component: ServiceCatalogItem): VillaSolutionItem {
  return {
    name: formatSkuName(component.sku, component.name),
    description: component.description || '',
    originalPrice: component.defaultUnitPriceVnd,
    offerPrice: component.defaultUnitPriceVnd,
    note: '',
    catalogItemId: component.id,
  };
}

/** Danh mục dịch vụ (cây group/bundle/component từ trang /all-platform/service-catalog,
 * dùng chung API — không tạo nguồn dữ liệu thứ 2) phẳng hoá thành {bundles,components}
 * CHỈ gồm item đang "Đang kinh doanh" (status active), gắn kèm groupId/groupName
 * của group cha gần nhất — cùng hình dạng với getServiceCatalogOptions(formId) để
 * CatalogItemPicker dùng chung 1 kiểu dữ liệu dù nguồn khác nhau. */
function flattenActiveCatalogTree(tree: ServiceCatalogItem[]): ServiceCatalogOptions {
  const bundles: ServiceCatalogItem[] = [];
  const components: ServiceCatalogItem[] = [];
  function walk(nodes: ServiceCatalogItem[], groupId?: string, groupName?: string) {
    for (const node of nodes) {
      if (node.itemType === 'group') {
        walk(node.children || [], node.id, node.name);
        continue;
      }
      if (node.status !== 'active') continue;
      const withGroup = { ...node, groupId, groupName };
      if (node.itemType === 'bundle') bundles.push(withGroup);
      else if (node.itemType === 'component') components.push(withGroup);
    }
  }
  walk(tree);
  return { bundles, components };
}

/** Danh mục dịch vụ cho popup "+ Chọn từ danh mục" — LUÔN có sẵn cho MỌI mẫu báo
 * giá, không phụ thuộc mẫu này đã được admin liên kết nhóm dịch vụ nào chưa (xem
 * quote_form_catalog_links): ưu tiên options đã liên kết riêng cho mẫu (đúng ý đồ
 * admin đã cấu hình phạm vi hẹp hơn), CHỈ khi mẫu chưa liên kết nhóm nào (rỗng) mới
 * dùng toàn bộ danh mục đang kinh doanh làm nguồn mặc định — để "chọn từ danh mục"
 * luôn là luồng chính, không bắt buộc phải cấu hình liên kết trước mới dùng được. */
function useCatalogOptions(quoteFormId?: string): ServiceCatalogOptions | null {
  const [options, setOptions] = useState<ServiceCatalogOptions | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      let scoped: ServiceCatalogOptions | null = null;
      if (quoteFormId) {
        scoped = await seedingQuoteRepository.getServiceCatalogOptions(quoteFormId).catch(() => null);
      }
      if (scoped && (scoped.bundles.length > 0 || scoped.components.length > 0)) {
        if (!cancelled) setOptions(scoped);
        return;
      }
      const tree = await serviceCatalogRepository.list().catch(() => null);
      if (!cancelled) setOptions(tree ? flattenActiveCatalogTree(tree) : scoped);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [quoteFormId]);
  return options;
}

/** So khớp không dấu, không phân biệt hoa/thường — tìm "cpu" vẫn ra "SZ-CPU". */
function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Khoá định danh dòng trong panel — phân biệt bundle/component vì 2 bảng khác nhau
 * nhưng có thể trùng id (id là uuid nên thực tế không trùng, nhưng khoá rõ ràng
 * giúp code dễ đọc và tránh phụ thuộc ngầm). */
function pickerKey(kind: 'bundle' | 'component', id: string): string {
  return `${kind}:${id}`;
}

function CatalogItemPicker<T>({
  options,
  existingCatalogItemIds,
  mapBundle,
  mapComponent,
  onAddMany,
}: {
  options: ServiceCatalogOptions;
  existingCatalogItemIds: Set<string>;
  /** Chuyển 1 gói/hạng mục Danh mục dịch vụ thành đúng hình dạng dữ liệu của
   * mẫu báo giá đang điền (QuoteItem cho quoteItems, VillaSolutionItem cho
   * solutionItems...) — giữ UI/logic tìm-lọc-chọn của picker này DÙNG CHUNG cho
   * mọi mẫu, chỉ đổi phần mapping theo từng mẫu (xem bundleToQuoteItem/
   * bundleToSolutionItem và cặp component tương ứng). */
  mapBundle: (bundle: ServiceCatalogItem) => T;
  mapComponent: (component: ServiceCatalogItem) => T;
  onAddMany: (items: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!options.bundles.length && !options.components.length) return null;

  const term = normalizeSearch(search);
  const matches = (sku: string | undefined, name: string) =>
    !term || normalizeSearch(name).includes(term) || normalizeSearch(sku || '').includes(term);
  const matchesGroup = (groupId: string | undefined) => !groupFilter || groupId === groupFilter;
  const filteredBundles = options.bundles.filter(bundle => matches(bundle.sku, bundle.name) && matchesGroup(bundle.groupId));
  const filteredComponents = options.components.filter(
    component => matches(component.sku, component.name) && matchesGroup(component.groupId)
  );

  const groupOptions = new Map<string, string>();
  for (const item of [...options.bundles, ...options.components]) {
    if (item.groupId && item.groupName) groupOptions.set(item.groupId, item.groupName);
  }

  function toggleSelect(key: string, alreadyInQuote: boolean) {
    if (alreadyInQuote) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closePanel() {
    setOpen(false);
    setSearch('');
    setGroupFilter('');
    setSelected(new Set());
  }

  function handleAddSelected() {
    const toAdd: T[] = [];
    for (const bundle of options.bundles) {
      if (selected.has(pickerKey('bundle', bundle.id))) toAdd.push(mapBundle(bundle));
    }
    for (const component of options.components) {
      if (selected.has(pickerKey('component', component.id))) toAdd.push(mapComponent(component));
    }
    if (toAdd.length) onAddMany(toAdd);
    closePanel();
  }

  return (
    <div className="quote-catalog-picker">
      <button type="button" className="quote-catalog-picker-trigger" onClick={() => setOpen(true)}>
        + Chọn từ Sản phẩm & dịch vụ
      </button>

      {open ? (
        <div className="quote-catalog-picker-backdrop" onClick={closePanel}>
          <div className="quote-catalog-picker-panel" onClick={event => event.stopPropagation()}>
            <header className="quote-catalog-picker-panel-head">
              <div>
                <strong>Chọn từ Danh mục dịch vụ</strong>
                <p>Tick chọn 1 hoặc nhiều gói/hạng mục rồi bấm &quot;Thêm vào báo giá&quot;.</p>
              </div>
              <div className="quote-catalog-picker-head-actions">
                <a
                  className="quote-catalog-picker-manage-link"
                  href="/all-platform/service-catalog"
                  target="_blank"
                  rel="noopener"
                >
                  Quản lý danh mục
                </a>
                <button type="button" className="quote-catalog-picker-close" onClick={closePanel} aria-label="Đóng">
                  ×
                </button>
              </div>
            </header>
            <div className="quote-catalog-picker-filters">
              <input
                autoFocus
                className="quote-catalog-picker-search"
                placeholder="Tìm theo tên hoặc mã..."
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
              {groupOptions.size > 0 ? (
                <div className="quote-catalog-picker-group-filter">
                  <SearchableSelect
                    value={groupFilter}
                    onChange={setGroupFilter}
                    placeholder="Tất cả nhóm"
                    options={Array.from(groupOptions.entries()).map(([id, name]) => ({ value: id, label: name }))}
                  />
                </div>
              ) : null}
            </div>
            <div className="quote-catalog-picker-list">
              {filteredBundles.length === 0 && filteredComponents.length === 0 ? (
                <div className="quote-catalog-picker-empty">Không tìm thấy dịch vụ phù hợp.</div>
              ) : null}
              {filteredBundles.length ? (
                <>
                  <h4>🎁 Gói</h4>
                  {filteredBundles.map(bundle => {
                    const key = pickerKey('bundle', bundle.id);
                    const already = existingCatalogItemIds.has(bundle.id);
                    return (
                      <label
                        key={bundle.id}
                        className={`quote-catalog-picker-row${already ? ' quote-catalog-picker-row--disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={already || selected.has(key)}
                          disabled={already}
                          onChange={() => toggleSelect(key, already)}
                        />
                        <span className="quote-catalog-picker-item-name">{formatSkuName(bundle.sku, shortDropdownLabel(bundle.name))}</span>
                        <span className="quote-catalog-picker-item-meta">{bundle.groupName || ''}</span>
                        <span className="quote-catalog-picker-item-meta">{bundle.unit || ''}</span>
                        <span className="quote-catalog-picker-item-meta">{bundle.defaultVatRate != null ? `${bundle.defaultVatRate}%` : '—'}</span>
                        <span className="quote-catalog-picker-item-price">{formatVnd(bundle.defaultUnitPriceVnd)}</span>
                        {already ? <span className="quote-catalog-picker-badge">Đã có trong báo giá</span> : null}
                      </label>
                    );
                  })}
                </>
              ) : null}
              {filteredComponents.length ? (
                <>
                  <h4>🔧 Hạng mục lẻ</h4>
                  {filteredComponents.map(component => {
                    const key = pickerKey('component', component.id);
                    const already = existingCatalogItemIds.has(component.id);
                    return (
                      <label
                        key={component.id}
                        className={`quote-catalog-picker-row${already ? ' quote-catalog-picker-row--disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={already || selected.has(key)}
                          disabled={already}
                          onChange={() => toggleSelect(key, already)}
                        />
                        <span className="quote-catalog-picker-item-name">{formatSkuName(component.sku, shortDropdownLabel(component.name))}</span>
                        <span className="quote-catalog-picker-item-meta">{component.groupName || ''}</span>
                        <span className="quote-catalog-picker-item-meta">{component.unit || ''}</span>
                        <span className="quote-catalog-picker-item-meta">{component.defaultVatRate != null ? `${component.defaultVatRate}%` : '—'}</span>
                        <span className="quote-catalog-picker-item-price">{formatVnd(component.defaultUnitPriceVnd)}</span>
                        {already ? <span className="quote-catalog-picker-badge">Đã có trong báo giá</span> : null}
                      </label>
                    );
                  })}
                </>
              ) : null}
            </div>
            <footer className="quote-catalog-picker-foot">
              <span>{selected.size > 0 ? `Đã chọn ${selected.size} mục` : 'Tick vào ô để chọn'}</span>
              <button type="button" className="quote-add-parent-button" disabled={selected.size === 0} onClick={handleAddSelected}>
                + Thêm vào báo giá
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Picker dung CHUNG voi QuoteWorkspaceModal (xem CatalogPickerModal +
 * useCatalogItemAdd, module service-catalog) cho luong "Tao bao gia nhanh"
 * (che do co Danh muc dich vu lien ket, KHONG phai Villa) - thay the
 * CatalogItemPicker<T> noi bo cu von CHI disable dong da co, khong co
 * ConfirmModal tang SL/them dong moi nhu QuoteWorkspaceModal (da bi audit
 * bat loi hanh vi khac nhau giua 2 diem goi). CatalogItemPicker<T> van GIU
 * NGUYEN cho rieng Villa (mapBundle/mapComponent -> VillaSolutionItem, kieu
 * du lieu khac hoan toan, ngoai pham vi yeu cau nay). */
function QuoteCatalogPicker({
  options,
  items,
  onAddMany,
  onIncreaseQuantity,
}: {
  options: ServiceCatalogOptions;
  items: QuoteItem[];
  onAddMany: (items: QuoteItem[]) => void;
  /** Tang SL cua 1 dong DA CO trong bang (dedup "Tang so luong") - tach
   * rieng khoi onAddMany (chi lo them dong MOI), tranh nham lan 2 hanh vi. */
  onIncreaseQuantity: (existingIndex: number, addQuantity: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const fxCtx = useContext(QuoteCurrencyContext);
  // Gia danh muc luon VND -> quy doi sang tien te quote khi them (khong sua danh muc).
  const addConverted = (newItems: QuoteItem[]) => onAddMany(convertQuoteItemsCurrency(newItems, VND_FX, fxCtx));

  // Rules of Hooks: useCatalogItemAdd (goi useState ben trong) PHAI nam
  // TRUOC moi early-return co dieu kien - khong duoc dat sau
  // `if (!options...) return null` (se lam so luong hook goi thay doi giua
  // cac lan render neu options rong/co du lieu xen ke).
  const existingKeys = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.catalogItemId) existingKeys.set(item.catalogItemId, index);
  });
  const catalogAdd = useCatalogItemAdd<QuoteItem>({ existingKeys, onAdd: addConverted });

  if (!options.bundles.length && !options.components.length) return null;

  const pickerItems: CatalogPickerListItem[] = [
    ...options.bundles.map(bundle => ({
      id: bundle.id,
      itemType: 'bundle' as const,
      sku: bundle.sku,
      name: bundle.name,
      description: bundle.description,
      quoteDisplayName: bundle.quoteDisplayName,
      quoteDescription: bundle.quoteDescription,
      quoteCta: bundle.quoteCta,
      groupName: bundle.groupName,
      unit: bundle.unit,
      vatRate: bundle.defaultVatRate,
      customerPriceVnd: bundle.defaultUnitPriceVnd || 0,
      monthlyPriceVnd: bundle.monthlyPriceVnd,
      annualCommitMonthlyPriceVnd: bundle.annualCommitMonthlyPriceVnd,
      annualTotalPriceVnd: bundle.annualTotalPriceVnd,
      status: bundle.status,
      alreadyAdded: existingKeys.has(bundle.id),
      components: bundle.components,
    })),
    ...options.components.map(component => ({
      id: component.id,
      itemType: 'component' as const,
      sku: component.sku,
      name: component.name,
      description: component.description,
      groupName: component.groupName,
      unit: component.unit,
      vatRate: component.defaultVatRate,
      customerPriceVnd: component.defaultUnitPriceVnd || 0,
      monthlyPriceVnd: component.monthlyPriceVnd,
      annualCommitMonthlyPriceVnd: component.annualCommitMonthlyPriceVnd,
      annualTotalPriceVnd: component.annualTotalPriceVnd,
      status: component.status,
      alreadyAdded: existingKeys.has(component.id),
    })),
  ];

  function handleAddSelected(ids: string[]) {
    const selectedBundles = options.bundles.filter(b => ids.includes(b.id));
    const selectedComponents = options.components.filter(c => ids.includes(c.id));
    const dedupCount = catalogAdd.handleAddSelected([
      ...selectedBundles.map(b => ({ key: b.id, item: bundleToQuoteItem(b), label: b.name })),
      ...selectedComponents.map(c => ({ key: c.id, item: componentToQuoteItem(c), label: c.name })),
    ]);
    if (dedupCount === 0) setOpen(false);
  }

  return (
    <div className="quote-catalog-picker">
      <button type="button" className="quote-catalog-picker-trigger" onClick={() => setOpen(true)}>
        + Chọn từ Sản phẩm & dịch vụ
      </button>
      <CatalogPickerModal
        open={open}
        onClose={() => setOpen(false)}
        title="Chọn từ Danh mục dịch vụ"
        subtitle="Tick chọn 1 hoặc nhiều gói/hạng mục rồi bấm &quot;Thêm vào báo giá&quot;."
        showZoneTab={false}
        activeSource="internal"
        onSourceChange={() => {}}
        loading={false}
        items={pickerItems}
        onAddSelected={handleAddSelected}
        quoteCurrency={fxCtx.currency}
        exchangeRate={fxCtx.rate}
        onIncreaseExisting={id => {
          const existingIndex = existingKeys.get(id);
          if (existingIndex != null) onIncreaseQuantity(existingIndex, 1);
        }}
        onAddAnother={id => {
          const bundle = options.bundles.find(b => b.id === id);
          if (bundle) {
            addConverted([bundleToQuoteItem(bundle)]);
            return;
          }
          const component = options.components.find(c => c.id === id);
          if (component) addConverted([componentToQuoteItem(component)]);
        }}
      />
      <ConfirmModal
        open={catalogAdd.dedupQueue.length > 0}
        title="Sản phẩm đã có trong báo giá"
        message={
          catalogAdd.dedupQueue[0]
            ? `"${catalogAdd.dedupQueue[0].label}" đã có sẵn 1 dòng trong báo giá. Bạn muốn tăng số lượng dòng có sẵn hay vẫn thêm thành dòng mới?`
            : ''
        }
        onClose={() => catalogAdd.cancelDedup()}
        actions={[
          {
            label: 'Tăng số lượng dòng có sẵn',
            variant: 'primary',
            onClick: () => {
              const entry = catalogAdd.dedupQueue[0];
              catalogAdd.resolveDedup('increase', existingIndex => onIncreaseQuantity(existingIndex, entry?.candidate.item.quantity || 1));
            },
          },
          { label: 'Vẫn thêm dòng mới', onClick: () => catalogAdd.resolveDedup('addNew', () => {}) },
        ]}
      />
    </div>
  );
}

function QuoteItemsEditor({
  items,
  columns,
  onChange,
  quoteFormId,
}: {
  items: QuoteItem[];
  columns: QuoteField[];
  onChange: (items: QuoteItem[]) => void;
  quoteFormId?: string;
}) {
  const catalogOptions = useCatalogOptions(quoteFormId);
  const { currency: ctxCurrencyForGroup } = useContext(QuoteCurrencyContext);

  function updateParent(index: number, patch: Partial<QuoteItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addParent() {
    onChange([...items, emptyItemRow()]);
  }
  function removeParent(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  function moveParent(index: number, offset: number) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    onChange(next);
  }
  function updateChild(parentIndex: number, childIndex: number, patch: Partial<QuoteItem>) {
    const parent = items[parentIndex];
    const children = parent.children || [];
    updateParent(parentIndex, { children: children.map((child, i) => (i === childIndex ? { ...child, ...patch } : child)) });
  }
  function addChild(parentIndex: number) {
    const parent = items[parentIndex];
    onChange(items.map((item, i) => (i === parentIndex ? { ...parent, children: [...(parent.children || []), emptyItemRow()] } : item)));
  }
  function removeChild(parentIndex: number, childIndex: number) {
    const parent = items[parentIndex];
    updateParent(parentIndex, { children: (parent.children || []).filter((_, i) => i !== childIndex) });
  }
  function moveChild(parentIndex: number, childIndex: number, offset: number) {
    const parent = items[parentIndex];
    const children = [...(parent.children || [])];
    const nextIndex = childIndex + offset;
    if (nextIndex < 0 || nextIndex >= children.length) return;
    const [child] = children.splice(childIndex, 1);
    children.splice(nextIndex, 0, child);
    updateParent(parentIndex, { children });
  }

  // Mẫu có liên kết Danh mục dịch vụ (vd VPS): mỗi dòng là 1 gói (SZ-VPS) hoặc 1
  // hạng mục lẻ, KHÔNG dùng khái niệm "dịch vụ cha/con" của mẫu cũ (Douyin) — cấu
  // hình/thành phần của gói đã nằm gọn trong Description Items của chính dòng đó
  // (xem bundleToQuoteItem), không tách thành dòng con riêng. Ẩn hẳn nút "+ Thêm
  // dịch vụ con" trong chế độ này để tránh tạo cấu trúc lồng không cần thiết.
  // LƯU Ý: getServiceCatalogOptions() luôn trả về {bundles:[], components:[]}
  // (object rỗng, không phải null) khi mẫu KHÔNG liên kết nhóm dịch vụ nào - phải
  // kiểm tra thật sự có dữ liệu, không chỉ check catalogOptions truthy, không thì
  // mẫu Douyin (không có catalog) cũng bị coi là "mẫu catalog" oan.
  const hasCatalogItems = Boolean(catalogOptions && (catalogOptions.bundles.length > 0 || catalogOptions.components.length > 0));
  const useFlatTerms = hasCatalogItems;

  if (useFlatTerms) {
    // Bảng chỉnh sửa phải dùng đúng cấu hình cột của mẫu đã chọn. Dữ liệu báo
    // giá cũ có thể chứa section -> children, nên không được map các section
    // thành dòng dịch vụ rồi làm rơi toàn bộ children như bảng compact cũ.
    return (
      <div className="quote-items-editor">
        {catalogOptions ? (
          <QuoteCatalogPicker
            options={catalogOptions}
            items={items}
            onAddMany={newItems => onChange([...items, ...newItems])}
            onIncreaseQuantity={(index, addQuantity) => updateParent(index, { quantity: (items[index].quantity || 0) + addQuantity })}
          />
        ) : null}
        {items.length === 0 ? (
          <div className="empty-row quote-items-empty">Chưa có dòng báo giá. Chọn gói hoặc thêm hạng mục để bắt đầu.</div>
        ) : (
          <SchemaQuoteItemsTable
            items={items}
            columns={columns}
            onUpdateParent={updateParent}
            onUpdateChild={updateChild}
            onRemoveParent={removeParent}
            onRemoveChild={removeChild}
          />
        )}
        <div className="quote-items-divider">hoặc</div>
        <button type="button" className="quote-add-parent-button quote-add-parent-button--secondary" onClick={addParent}>
          + Thêm hạng mục ngoài danh mục
        </button>
        <p className="quote-snapshot-hint">
          ℹ Dữ liệu sản phẩm được lưu theo báo giá; thay đổi giá trong danh mục không làm thay đổi báo giá đã tạo.
        </p>
      </div>
    );
  }

  return (
    <div className="quote-items-editor">
      {items.length === 0 ? (
        <div className="empty-row quote-items-empty">Chưa có dòng dịch vụ. Bấm &quot;Thêm dịch vụ cha&quot; để bắt đầu.</div>
      ) : null}
      {items.map((item, index) => (
        <div key={item.id || index} className="quote-parent-item">
          <div className="quote-item-toolbar">
            <div className="quote-item-title">
              <span>{index + 1}</span>
              <strong>Dịch vụ cha</strong>
              {(item.children || []).length ? <em>{(item.children || []).length} dịch vụ con</em> : null}
            </div>
            <div className="quote-item-actions">
              <button type="button" onClick={() => moveParent(index, -1)} disabled={index === 0}>↑</button>
              <button type="button" onClick={() => moveParent(index, 1)} disabled={index === items.length - 1}>↓</button>
              <button type="button" className="quote-danger-button" onClick={() => removeParent(index)}>Xóa</button>
            </div>
          </div>
          <QuoteItemFields item={item} prefix="parent" onChange={patch => updateParent(index, patch)} />
          {(item.children || []).length ? (
            <div className="quote-child-list">
              {(item.children || []).map((child, childIndex) => (
                <div key={child.id || childIndex} className="quote-child-item">
                  <div className="quote-item-toolbar quote-item-toolbar--child">
                    <div className="quote-item-title quote-item-title--child">
                      <span>{index + 1}.{childIndex + 1}</span>
                      <strong>Dịch vụ con</strong>
                    </div>
                    <div className="quote-item-actions">
                      <button type="button" onClick={() => moveChild(index, childIndex, -1)} disabled={childIndex === 0}>↑</button>
                      <button type="button" onClick={() => moveChild(index, childIndex, 1)} disabled={childIndex === (item.children || []).length - 1}>↓</button>
                      <button type="button" className="quote-danger-button" onClick={() => removeChild(index, childIndex)}>Xóa</button>
                    </div>
                  </div>
                  <QuoteItemFields item={child} prefix="child" onChange={patch => updateChild(index, childIndex, patch)} />
                </div>
              ))}
            </div>
          ) : null}
          <div className="quote-item-footer">
            <button type="button" className="quote-add-child-button" onClick={() => addChild(index)}>
              + Thêm dịch vụ con
            </button>
            <div className="quote-group-subtotal">
              <span>Tạm tính nhóm</span>
              <strong>{formatMoney([item, ...(item.children || [])].reduce((sum, row) => sum + calculateItemTotal(row, ctxCurrencyForGroup), 0), ctxCurrencyForGroup)}</strong>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="quote-add-parent-button" onClick={addParent}>
        + Thêm dịch vụ cha
      </button>
    </div>
  );
}

const QUOTE_ITEM_EDITOR_FALLBACK_COLUMNS: QuoteField[] = [
  { key: 'order', label: 'STT', type: 'auto-number', editable: false },
  { key: 'serviceDescription', label: 'Hạng mục', type: 'textarea' },
  { key: 'description', label: 'Mô tả', type: 'textarea' },
  { key: 'unit', label: 'ĐVT', type: 'text' },
  { key: 'quantity', label: 'SL', type: 'number' },
  { key: 'unitPrice', label: 'Đơn giá', type: 'currency' },
  { key: 'discountPercent', label: 'Giảm giá (%)', type: 'number' },
  { key: 'vatRate', label: 'VAT (%)', type: 'number' },
  { key: 'total', label: 'Thành tiền', type: 'calculated', editable: false },
];

type QuoteItemEditorRow =
  | { kind: 'section'; item: QuoteItem; parentIndex: number; number: string }
  | { kind: 'item'; item: QuoteItem; parentIndex: number; childIndex?: number; number: string };

function toRomanNumeral(value: number) {
  const numerals: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let remaining = value;
  return numerals.reduce((result, [amount, numeral]) => {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
    return result;
  }, '');
}

function SchemaQuoteItemsTable({
  items,
  columns,
  onUpdateParent,
  onUpdateChild,
  onRemoveParent,
  onRemoveChild,
}: {
  items: QuoteItem[];
  columns: QuoteField[];
  onUpdateParent: (index: number, patch: Partial<QuoteItem>) => void;
  onUpdateChild: (parentIndex: number, childIndex: number, patch: Partial<QuoteItem>) => void;
  onRemoveParent: (index: number) => void;
  onRemoveChild: (parentIndex: number, childIndex: number) => void;
}) {
  const { currency: tableCurrency } = useContext(QuoteCurrencyContext);
  const [detailRow, setDetailRow] = useState<Extract<QuoteItemEditorRow, { kind: 'item' }> | null>(null);
  const [detailDescription, setDetailDescription] = useState('');
  const [detailWarranty, setDetailWarranty] = useState('');
  const visibleColumns = columns.filter(column => column.visible !== false);
  const editorColumns = visibleColumns.length ? visibleColumns : QUOTE_ITEM_EDITOR_FALLBACK_COLUMNS;
  let sectionNumber = 0;
  let itemNumber = 0;
  const rows: QuoteItemEditorRow[] = items.flatMap((item, parentIndex) => {
    if (item.rowType === 'section') {
      sectionNumber += 1;
      const sectionRow: QuoteItemEditorRow = {
        kind: 'section', item, parentIndex, number: toRomanNumeral(sectionNumber),
      };
      const childRows: QuoteItemEditorRow[] = (item.children || []).map((child, childIndex) => {
        itemNumber += 1;
        return { kind: 'item', item: child, parentIndex, childIndex, number: String(itemNumber).padStart(2, '0') };
      });
      return [sectionRow, ...childRows];
    }
    itemNumber += 1;
    return [{ kind: 'item', item, parentIndex, number: String(itemNumber).padStart(2, '0') }];
  });

  return (
    <div className="quote-table-wrap quote-schema-items-wrap">
      <table className="quote-table quote-table--editable quote-schema-items-table">
        <thead>
          <tr>
            {editorColumns.map(column => <th key={column.key}>{localizeCurrencyLabel(column.label, tableCurrency)}</th>)}
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => row.kind === 'section' ? (
            <tr key={row.item.id || `section-${row.parentIndex}`} className="quote-schema-section-row">
              <td colSpan={editorColumns.length + 1}>
                <span>{row.number}</span>
                <input
                  value={row.item.description || row.item.serviceDescription || ''}
                  aria-label="Tên mục cha"
                  onChange={event => onUpdateParent(row.parentIndex, { description: event.target.value })}
                />
                <button type="button" onClick={() => onRemoveParent(row.parentIndex)} aria-label="Xóa mục cha">×</button>
              </td>
            </tr>
          ) : (
            <tr key={row.item.id || `item-${row.parentIndex}-${row.childIndex ?? 'root'}`}>
              {editorColumns.map(column => (
                <td key={column.key} data-label={localizeCurrencyLabel(column.label, tableCurrency)}>
                  <SchemaQuoteItemCell
                    item={row.item}
                    column={column}
                    number={row.number}
                    onChange={patch => row.childIndex === undefined
                      ? onUpdateParent(row.parentIndex, patch)
                      : onUpdateChild(row.parentIndex, row.childIndex, patch)}
                  />
                </td>
              ))}
              <td className="quote-schema-item-action">
                <button type="button" aria-label="Chi tiết hạng mục" onClick={() => {
                  setDetailRow(row); setDetailDescription(row.item.description || ''); setDetailWarranty(row.item.warrantyScope || '');
                }}>▤</button>
                <button
                  type="button"
                  onClick={() => row.childIndex === undefined
                    ? onRemoveParent(row.parentIndex)
                    : onRemoveChild(row.parentIndex, row.childIndex)}
                  aria-label="Xóa dòng"
                >×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detailRow ? (
        <div className="crm-modal-backdrop" onClick={() => setDetailRow(null)}>
          <div className="crm-modal" role="dialog" aria-modal="true" aria-label="Chi tiết hạng mục" onClick={e => e.stopPropagation()}>
            <div className="crm-modal-header"><h3>Chi tiết hạng mục</h3></div>
            <div className="crm-modal-body">
            <p>{detailRow.item.serviceDescription}</p>
            <label className="crm-field"><span>Nội dung công việc</span><textarea rows={5} value={detailDescription} onChange={e => setDetailDescription(e.target.value)} /></label>
            <label className="crm-field"><span>Phạm vi bảo hành</span><textarea rows={5} value={detailWarranty} onChange={e => setDetailWarranty(e.target.value)} /></label>
            </div>
            <div className="crm-modal-footer">
            <button type="button" className="crm-secondary-button" onClick={() => setDetailRow(null)}>Hủy</button>
            <button type="button" onClick={() => {
              const patch = { description: detailDescription, warrantyScope: detailWarranty.trim() || null };
              if (detailRow.childIndex === undefined) onUpdateParent(detailRow.parentIndex, patch);
              else onUpdateChild(detailRow.parentIndex, detailRow.childIndex, patch);
              setDetailRow(null);
            }} className="crm-primary-button">Lưu</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SchemaQuoteItemCell({
  item,
  column,
  number,
  onChange,
}: {
  item: QuoteItem;
  column: QuoteField;
  number: string;
  onChange: (patch: Partial<QuoteItem>) => void;
}) {
  const { currency: cellCurrency } = useContext(QuoteCurrencyContext);
  if (column.type === 'auto-number' || column.key === 'order') return <span className="quote-schema-row-number">{number}</span>;

  const calculatedValues: Record<string, number> = {
    subtotal: calculateItemSubtotal(item, cellCurrency),
    amountAfterDiscount: calculateItemAfterDiscount(item, cellCurrency),
    vatAmount: calculateItemVat(item, cellCurrency),
    total: calculateItemTotal(item, cellCurrency),
  };
  if (column.type === 'calculated' || Object.prototype.hasOwnProperty.call(calculatedValues, column.key)) {
    return <span className="quote-schema-calculated">{formatMoney(calculatedValues[column.key] ?? 0, cellCurrency)}</span>;
  }

  const record = item as unknown as Record<string, unknown>;
  const rawValue = record[column.key] ?? column.defaultValue ?? '';
  const setValue = (next: unknown) => onChange({ [column.key]: next } as Partial<QuoteItem>);
  if (column.type === 'select') {
    return (
      <select value={String(rawValue)} disabled={column.editable === false} onChange={event => setValue(event.target.value)}>
        {(column.options || []).map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (column.type === 'textarea') {
    return (
      <textarea
        value={String(rawValue)}
        placeholder={column.placeholder}
        disabled={column.editable === false}
        onChange={event => setValue(event.target.value)}
      />
    );
  }
  if (column.type === 'currency') {
    const numericValue =
      typeof rawValue === 'number'
        ? rawValue
        : rawValue === null || rawValue === undefined || rawValue === ''
          ? null
          : Number(rawValue) || 0;
    return (
      <CurrencyInput
        {...moneyInputProps(cellCurrency)}
        value={numericValue}
        placeholder={column.placeholder}
        disabled={column.editable === false}
        onChange={next => setValue(next ?? 0)}
      />
    );
  }

  const numeric = column.type === 'number';
  return (
    <input
      type={numeric ? 'number' : 'text'}
      min={numeric ? 0 : undefined}
      value={String(rawValue)}
      placeholder={column.placeholder}
      disabled={column.editable === false}
      onChange={event => setValue(numeric ? coerceNumber(event.target.value) : event.target.value)}
    />
  );
}

/** Bảng "Danh sách giải pháp" của mẫu villa (solutionItems) - CHỌN TỪ DANH MỤC
 * dịch vụ là luồng chính (giống QuoteItemsEditor cho quoteItems), "+ Thêm hạng
 * mục ngoài danh mục" chỉ là lối phụ, KHÔNG tự tạo dòng trống khi mở component -
 * người dùng phải chủ động bấm 1 trong 2 nút mới có dòng mới. */
function SolutionItemsEditor({
  items,
  onChange,
  quoteFormId,
}: {
  items: VillaSolutionItem[];
  onChange: (items: VillaSolutionItem[]) => void;
  quoteFormId?: string;
}) {
  const catalogOptions = useCatalogOptions(quoteFormId);

  function updateRow(index: number, patch: Partial<VillaSolutionItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addManualRow() {
    onChange([...items, emptySolutionRow()]);
  }
  function removeRow(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="quote-items-editor">
      {catalogOptions ? (
        <CatalogItemPicker
          options={catalogOptions}
          existingCatalogItemIds={new Set(items.map(item => item.catalogItemId).filter((id): id is string => Boolean(id)))}
          mapBundle={bundleToSolutionItem}
          mapComponent={componentToSolutionItem}
          onAddMany={newItems => onChange([...items, ...newItems])}
        />
      ) : null}
      {items.length === 0 ? (
        <div className="empty-row quote-items-empty">Chưa có giải pháp nào. Chọn từ danh mục hoặc thêm hạng mục ngoài danh mục để bắt đầu.</div>
      ) : (
        <div className="quote-compact-table quote-compact-table--solution">
          <div className="quote-compact-head">
            <span>Tên giải pháp</span>
            <span>Mô tả</span>
            <span>Giá gốc</span>
            <span>Giá đề xuất</span>
            <span>Ghi chú</span>
            <span />
          </div>
          {items.map((item, index) => (
            <CompactSolutionRow key={index} item={item} onChange={patch => updateRow(index, patch)} onRemove={() => removeRow(index)} />
          ))}
        </div>
      )}
      <div className="quote-items-divider">hoặc</div>
      <button type="button" className="quote-add-parent-button quote-add-parent-button--secondary" onClick={addManualRow}>
        + Thêm hạng mục ngoài danh mục
      </button>
      <p className="quote-snapshot-hint">
        ℹ Dữ liệu sản phẩm được lưu theo báo giá; thay đổi giá trong danh mục không làm thay đổi báo giá đã tạo.
      </p>
    </div>
  );
}

function CompactSolutionRow({
  item,
  onChange,
  onRemove,
}: {
  item: VillaSolutionItem;
  onChange: (patch: Partial<VillaSolutionItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="quote-compact-row quote-compact-row--solution">
      <span className="quote-compact-cell quote-compact-cell--name">
        <input value={item.name || ''} placeholder="Tên giải pháp" onChange={event => onChange({ name: event.target.value })} />
      </span>
      <span className="quote-compact-cell quote-compact-cell--description">
        <textarea
          className="quote-compact-description"
          value={item.description || ''}
          placeholder="Mô tả"
          onChange={event => onChange({ description: event.target.value })}
        />
      </span>
      <span className="quote-compact-cell">
        <CurrencyInput
          className="quote-compact-price"
          value={item.originalPrice || 0}
          onChange={next => onChange({ originalPrice: next ?? 0 })}
        />
      </span>
      <span className="quote-compact-cell">
        <CurrencyInput
          className="quote-compact-price"
          value={item.offerPrice || 0}
          onChange={next => onChange({ offerPrice: next ?? 0 })}
        />
      </span>
      <span className="quote-compact-cell quote-compact-cell--description">
        <input value={item.note || ''} placeholder="Ghi chú" onChange={event => onChange({ note: event.target.value })} />
      </span>
      <button type="button" className="quote-compact-remove" onClick={onRemove} aria-label="Xoá dòng">
        ×
      </button>
    </div>
  );
}

function QuoteItemFields({ item, prefix, onChange }: { item: QuoteItem; prefix: 'parent' | 'child'; onChange: (patch: Partial<QuoteItem>) => void }) {
  const { currency: rowCurrency } = useContext(QuoteCurrencyContext);
  const subtotal = calculateItemSubtotal(item, rowCurrency);
  const discount = calculateItemDiscount(item, rowCurrency);
  const afterDiscount = calculateItemAfterDiscount(item, rowCurrency);
  const vat = calculateItemVat(item, rowCurrency);
  const total = calculateItemTotal(item, rowCurrency);
  const nameLabel = prefix === 'parent' ? 'Tên dịch vụ' : 'Tên dịch vụ con';
  return (
    <div className="quote-item-fields">
      <label className="crm-field crm-field--full">
        <span>{nameLabel} <b>*</b></span>
        <input value={item.serviceDescription || ''} onChange={event => onChange({ serviceDescription: event.target.value })} />
      </label>
      <label className="crm-field crm-field--full">
        <span>{prefix === 'parent' ? 'Mô tả chung' : 'Mô tả'}</span>
        <textarea value={item.description || ''} onChange={event => onChange({ description: event.target.value })} />
      </label>
      <label className="crm-field">
        <span>Đơn vị tính</span>
        <input value={item.unit || ''} onChange={event => onChange({ unit: event.target.value })} />
      </label>
      <label className="crm-field">
        <span>Số lượng</span>
        <input type="number" min={0} value={item.quantity || 0} onChange={event => onChange({ quantity: coerceNumber(event.target.value) })} />
      </label>
      <label className="crm-field">
        <span>Đơn giá</span>
        <CurrencyInput {...moneyInputProps(rowCurrency)} value={item.unitPrice || 0} onChange={next => onChange({ unitPrice: next ?? 0 })} />
      </label>
      <label className="crm-field">
        <span>Giảm giá (%)</span>
        <input type="number" min={0} max={100} value={item.discountPercent ?? 0} onChange={event => onChange({ discountPercent: coercePercent(event.target.value) })} />
      </label>
      <label className="crm-field">
        <span>VAT (%)</span>
        <input type="number" min={0} max={100} value={item.vatRate || 0} onChange={event => onChange({ vatRate: coercePercent(event.target.value) })} />
      </label>
      <div className="quote-item-calculation">
        <span>Gốc: {formatMoney(subtotal, rowCurrency)}</span>
        <span>Giảm: {discount ? `-${formatMoney(discount, rowCurrency)}` : '—'}</span>
        <span>Sau giảm: {formatMoney(afterDiscount, rowCurrency)}</span>
        <span>VAT: {formatMoney(vat, rowCurrency)}</span>
        <strong>Thành tiền: {formatMoney(total, rowCurrency)}</strong>
      </div>
    </div>
  );
}

function RepeaterTable({
  columns,
  rows,
  emptyRow,
  emptyLabel,
  onChange,
}: {
  columns: QuoteField[];
  rows: RowRecord[];
  emptyRow: () => RowRecord;
  emptyLabel: string;
  onChange: (rows: RowRecord[]) => void;
}) {
  const visibleColumns = columns.filter(column => column.visible !== false);

  function updateRow(index: number, key: string, fieldValue: unknown) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: fieldValue } : row)));
  }
  function addRow() {
    onChange([...rows, emptyRow()]);
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }
  function moveRow(index: number, offset: number) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(nextIndex, 0, row);
    onChange(next);
  }

  return (
    <div className="quote-table-wrap">
      <table className="quote-table quote-table--editable">
        <thead>
          <tr>
            {visibleColumns.map(column => (
              <th key={column.key}>
                {column.label} {column.required ? <b>*</b> : null}
              </th>
            ))}
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={visibleColumns.length + 1} className="empty-row">
                {emptyLabel} Bấm &quot;Thêm dòng&quot; để bắt đầu.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {visibleColumns.map(column => (
                  <td key={column.key}>
                    {column.type === 'auto-number' ? (
                      <input value={index + 1} disabled readOnly />
                    ) : column.type === 'currency' ? (
                      <CurrencyInput
                        value={
                          typeof row[column.key] === 'number'
                            ? row[column.key] as number
                            : row[column.key] === null || row[column.key] === undefined || row[column.key] === ''
                              ? null
                              : Number(row[column.key]) || 0
                        }
                        placeholder={column.placeholder}
                        onChange={next => updateRow(index, column.key, next ?? 0)}
                      />
                    ) : (
                      <input
                        type={column.type === 'number' ? 'number' : 'text'}
                        value={String(row[column.key] ?? '')}
                        placeholder={column.placeholder}
                        onChange={event =>
                          updateRow(
                            index,
                            column.key,
                            column.type === 'number'
                              ? Number(event.target.value) || 0
                              : event.target.value
                          )
                        }
                      />
                    )}
                  </td>
                ))}
                <td className="quote-row-actions">
                  <button type="button" onClick={() => moveRow(index, -1)} disabled={index === 0} aria-label="Lên">
                    ↑
                  </button>
                  <button type="button" onClick={() => moveRow(index, 1)} disabled={index === rows.length - 1} aria-label="Xuống">
                    ↓
                  </button>
                  <button type="button" onClick={() => removeRow(index)} aria-label="Xóa dòng">
                    Xóa
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <button type="button" className="quote-button quote-button--secondary" onClick={addRow}>
        + Thêm dòng
      </button>
    </div>
  );
}
