'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuoteSchema } from '@/modules/quotes';
import { getLockedColumnKeys, resolveDefaultVisibleColumnKeys, resolveQuoteItemColumns, resolveToggleableColumns } from '@/modules/quotes/utils/quoteColumns';
import {
  getCustomerDisplayFields,
  resolveVisibleCustomerFieldKeys,
} from '@/modules/quotes/utils/quoteCustomerFields';
import {
  getLockedSummaryFieldKeys,
  getSupportedSummaryFields,
  resolveToggleableSummaryFields,
  resolveVisibleSummaryFieldKeys,
} from '@/modules/quotes/utils/quoteSummaryFields';
import {
  loadVisibleColumnsDraft,
  loadVisibleCustomerFieldsDraft,
  loadVisibleSummaryFieldsDraft,
  saveVisibleColumnsDraft,
  saveVisibleCustomerFieldsDraft,
  saveVisibleSummaryFieldsDraft,
} from './quoteColumnsDraft';
import type { QuoteDraft } from './types';

export function QuoteColumnVisibilityPicker({
  schema,
  draft,
  onChange,
  quoteFormId,
  readOnly = false,
}: {
  schema: QuoteSchema;
  draft: QuoteDraft;
  onChange: (next: QuoteDraft) => void;
  quoteFormId?: string;
  readOnly?: boolean;
}) {
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [openSection, setOpenSection] = useState<'customer' | 'columns' | 'summary' | null>('customer');
  const schemaInvalid = !schema || !Array.isArray(schema.sections);
  const allColumns = useMemo(
    () => (schemaInvalid ? [] : resolveQuoteItemColumns(schema, draft.items)),
    [schema, schemaInvalid, draft.items]
  );
  const requiredColumnKeys = useMemo(
    () => (schemaInvalid ? new Set<string>() : new Set(getLockedColumnKeys(schema))),
    [schema, schemaInvalid]
  );
  const requiredColumns = useMemo(
    () => allColumns.filter(column => requiredColumnKeys.has(column.key)),
    [allColumns, requiredColumnKeys]
  );
  const optionalColumns = useMemo(
    () => (schemaInvalid ? [] : resolveToggleableColumns(schema, draft.items)),
    [schema, schemaInvalid, draft.items]
  );
  const optionalColumnKeys = useMemo(() => optionalColumns.map(column => column.key), [optionalColumns]);
  const savedVisibleColumns = Array.isArray(draft.data.visibleColumns) ? draft.data.visibleColumns : null;
  const visibleColumns = (savedVisibleColumns || resolveDefaultVisibleColumnKeys(schema, draft.items)).filter(key => optionalColumnKeys.includes(key));
  const visibleCount = visibleColumns.length;
  const optionalTotal = optionalColumnKeys.length;

  function setVisibleColumns(next: string[]) {
    if (readOnly) return;
    onChange({ ...draft, data: { ...draft.data, visibleColumns: next } });
    saveVisibleColumnsDraft(quoteFormId, next);
  }

  function toggleColumn(key: string) {
    setVisibleColumns(
      visibleColumns.includes(key) ? visibleColumns.filter(item => item !== key) : [...visibleColumns, key]
    );
  }

  const restoredForFormId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (readOnly || !quoteFormId || schemaInvalid) return;
    if (restoredForFormId.current === quoteFormId) return;
    restoredForFormId.current = quoteFormId;
    if (savedVisibleColumns) return;
    const draftColumns = loadVisibleColumnsDraft(quoteFormId);
    if (!draftColumns) return;
    const reconciled = draftColumns.filter(key => optionalColumnKeys.includes(key));
    if (reconciled.length) setVisibleColumns(reconciled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteFormId, schemaInvalid, readOnly]);

  const optionalKeysSignature = optionalColumnKeys.join('|');
  const previousSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const previousSignature = previousSignatureRef.current;
    previousSignatureRef.current = optionalKeysSignature;
    if (previousSignature === null || previousSignature === optionalKeysSignature) return;
    if (readOnly || schemaInvalid || optionalTotal === 0 || !savedVisibleColumns) return;
    const staleKeys = savedVisibleColumns.filter(key => !optionalColumnKeys.includes(key));
    const missingKeys = optionalColumnKeys.filter(key => !savedVisibleColumns.includes(key));
    if (!staleKeys.length && !missingKeys.length) return;
    setVisibleColumns([...savedVisibleColumns.filter(key => optionalColumnKeys.includes(key)), ...missingKeys]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionalKeysSignature, schemaInvalid, readOnly]);

  // Nhóm "Tổng hợp giá" (5 dòng khối tổng tiền) - RIÊNG BIỆT với cột bảng hạng
  // mục ở trên (resolver khác, key khác, lưu vào draft.data.visibleSummaryFields
  // khác draft.data.visibleColumns) - chỉ dùng chung component/state mở-đóng
  // popover theo đúng yêu cầu "1 component, không viết version 2".
  const summarySupportedFields = useMemo(
    () => (schemaInvalid ? [] : getSupportedSummaryFields(schema)),
    [schema, schemaInvalid]
  );
  const summaryLockedKeys = useMemo(
    () => (schemaInvalid ? new Set<string>() : new Set(getLockedSummaryFieldKeys(schema))),
    [schema, schemaInvalid]
  );
  const summaryRequiredFields = useMemo(
    () => summarySupportedFields.filter(field => summaryLockedKeys.has(field.key)),
    [summarySupportedFields, summaryLockedKeys]
  );
  const summaryOptionalFields = useMemo(
    () => (schemaInvalid ? [] : resolveToggleableSummaryFields(schema)),
    [schema, schemaInvalid]
  );
  const summaryOptionalKeys: string[] = useMemo(() => summaryOptionalFields.map(field => field.key), [summaryOptionalFields]);
  const savedVisibleSummaryFields = Array.isArray(draft.data.visibleSummaryFields) ? draft.data.visibleSummaryFields : null;
  const visibleSummaryFields = schemaInvalid
    ? []
    : resolveVisibleSummaryFieldKeys(schema, savedVisibleSummaryFields).filter(key => summaryOptionalKeys.includes(key));
  const summaryVisibleCount = visibleSummaryFields.length;
  const summaryOptionalTotal = summaryOptionalKeys.length;

  function setVisibleSummaryFields(next: string[]) {
    if (readOnly) return;
    onChange({ ...draft, data: { ...draft.data, visibleSummaryFields: next } });
    saveVisibleSummaryFieldsDraft(quoteFormId, next);
  }

  function toggleSummaryField(key: string) {
    setVisibleSummaryFields(
      visibleSummaryFields.includes(key)
        ? visibleSummaryFields.filter(item => item !== key)
        : [...visibleSummaryFields, key]
    );
  }

  const restoredSummaryForFormId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (readOnly || !quoteFormId || schemaInvalid) return;
    if (restoredSummaryForFormId.current === quoteFormId) return;
    restoredSummaryForFormId.current = quoteFormId;
    if (savedVisibleSummaryFields) return;
    const draftFields = loadVisibleSummaryFieldsDraft(quoteFormId);
    if (!draftFields) return;
    const reconciled = draftFields.filter(key => summaryOptionalKeys.includes(key));
    if (reconciled.length) setVisibleSummaryFields(reconciled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteFormId, schemaInvalid, readOnly]);

  const customerFields = useMemo(
    () => (schemaInvalid ? [] : getCustomerDisplayFields(schema)),
    [schema, schemaInvalid]
  );
  const customerFieldKeys = useMemo(() => customerFields.map(field => field.key), [customerFields]);
  const customerKeysSignature = customerFieldKeys.join('|');
  const savedVisibleCustomerFields = Array.isArray(draft.data.visibleCustomerFields) ? draft.data.visibleCustomerFields : null;
  const visibleCustomerFields = schemaInvalid
    ? []
    : resolveVisibleCustomerFieldKeys(schema, savedVisibleCustomerFields);
  const customerVisibleCount = visibleCustomerFields.length;
  const customerTotal = customerFieldKeys.length;

  function setVisibleCustomerFields(next: string[]) {
    if (readOnly) return;
    onChange({ ...draft, data: { ...draft.data, visibleCustomerFields: next } });
    saveVisibleCustomerFieldsDraft(quoteFormId, next);
  }

  function toggleCustomerField(key: string) {
    setVisibleCustomerFields(
      visibleCustomerFields.includes(key)
        ? visibleCustomerFields.filter(item => item !== key)
        : [...visibleCustomerFields, key]
    );
  }

  const restoredCustomerForFormId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (readOnly || !quoteFormId || schemaInvalid) return;
    if (restoredCustomerForFormId.current === quoteFormId) return;
    restoredCustomerForFormId.current = quoteFormId;
    if (savedVisibleCustomerFields) return;
    const draftFields = loadVisibleCustomerFieldsDraft(quoteFormId);
    if (!draftFields) return;
    const reconciled = draftFields.filter(key => customerFieldKeys.includes(key));
    if (reconciled.length) setVisibleCustomerFields(reconciled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteFormId, schemaInvalid, readOnly, customerKeysSignature]);

  const canOpenMenu = optionalTotal > 0 || summaryOptionalTotal > 0 || customerTotal > 0;
  const toggleSection = (section: 'customer' | 'columns' | 'summary') => {
    setOpenSection(current => (current === section ? null : section));
  };

  return (
    <div className="crm-quote-column-picker">
      {schemaInvalid ? (
        <div className="crm-quote-column-warning">⚠ Không đọc được cấu hình mẫu báo giá này.</div>
      ) : (
        <>
          <button
            type="button"
            className="crm-cancel-button"
            onClick={() => setColumnMenuOpen(open => !open)}
            disabled={!canOpenMenu}
          >
            Cột hiển thị{' '}
            <span className="crm-quote-column-count">
              {optionalTotal === 0 ? '—' : `${visibleCount}/${optionalTotal}`}
            </span>
          </button>
          {!canOpenMenu ? (
            <p className="crm-quote-column-empty-hint">Mẫu này không có cột/trường tùy chỉnh.</p>
          ) : null}
          {columnMenuOpen && canOpenMenu ? (
            <div className="crm-quote-column-menu">
              <div className="crm-quote-column-menu-head">
                <strong>Cột hiển thị</strong>
                <span className="crm-quote-column-count">{optionalTotal === 0 ? '—' : `${visibleCount}/${optionalTotal}`}</span>
              </div>
              <div className="crm-quote-column-menu-body">
                <p className="crm-quote-column-menu-note">Chỉ ảnh hưởng bản gửi khách, không xoá dữ liệu nội bộ.</p>

                {customerTotal > 0 ? (
                  <section className="crm-quote-column-group">
                    <button type="button" className="crm-quote-column-group-title" onClick={() => toggleSection('customer')}>
                      <span>Thông tin khách hàng</span>
                      <span className="crm-quote-column-group-meta">
                        <span className="crm-quote-column-count">{customerVisibleCount}/{customerTotal}</span>
                        <span className="crm-quote-column-chevron">{openSection === 'customer' ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {openSection === 'customer' ? (
                      <div className="crm-quote-column-group-body">
                        <div className="crm-quote-column-section-actions">
                          <button type="button" disabled={readOnly} onClick={() => setVisibleCustomerFields([...customerFieldKeys])}>
                            Hiện tất cả
                          </button>
                        </div>
                        {customerFields.map(field => (
                          <label key={field.key} className="crm-quote-column-option">
                            <input
                              type="checkbox"
                              checked={visibleCustomerFields.includes(field.key)}
                              disabled={readOnly}
                              onChange={() => toggleCustomerField(field.key)}
                            />
                            {field.label}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {optionalTotal > 0 ? (
                  <section className="crm-quote-column-group">
                    <button type="button" className="crm-quote-column-group-title" onClick={() => toggleSection('columns')}>
                      <span>Cột bảng hạng mục</span>
                      <span className="crm-quote-column-group-meta">
                        <span className="crm-quote-column-count">{visibleCount}/{optionalTotal}</span>
                        <span className="crm-quote-column-chevron">{openSection === 'columns' ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {openSection === 'columns' ? (
                      <div className="crm-quote-column-group-body">
                        <div className="crm-quote-column-section-actions">
                          <button type="button" disabled={readOnly} onClick={() => setVisibleColumns([...optionalColumnKeys])}>
                            Hiện tất cả
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() =>
                              setVisibleColumns(
                                optionalColumns.filter(column => column.type !== 'number' && column.type !== 'currency').map(column => column.key)
                              )
                            }
                          >
                            Ẩn thông tin giá
                          </button>
                        </div>
                        {requiredColumns.map(option => (
                          <label key={option.key} className="crm-quote-column-option crm-quote-column-option--locked">
                            <input type="checkbox" checked disabled />
                            🔒 {option.label} <span className="crm-quote-column-required-badge">Bắt buộc</span>
                          </label>
                        ))}
                        {optionalColumns.map(option => (
                          <label key={option.key} className="crm-quote-column-option">
                            <input
                              type="checkbox"
                              checked={visibleColumns.includes(option.key)}
                              disabled={readOnly}
                              onChange={() => toggleColumn(option.key)}
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {summaryOptionalTotal > 0 ? (
                  <section className="crm-quote-column-group crm-quote-column-group--summary">
                    <button type="button" className="crm-quote-column-group-title" onClick={() => toggleSection('summary')}>
                      <span>Tổng hợp giá</span>
                      <span className="crm-quote-column-group-meta">
                        <span className="crm-quote-column-count">{summaryVisibleCount}/{summaryOptionalTotal}</span>
                        <span className="crm-quote-column-chevron">{openSection === 'summary' ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {openSection === 'summary' ? (
                      <div className="crm-quote-column-group-body">
                        <div className="crm-quote-column-section-actions">
                          <button type="button" disabled={readOnly} onClick={() => setVisibleSummaryFields([...summaryOptionalKeys])}>
                            Hiện tất cả
                          </button>
                        </div>
                        {summaryRequiredFields.map(field => (
                          <label key={field.key} className="crm-quote-column-option crm-quote-column-option--locked">
                            <input type="checkbox" checked disabled />
                            🔒 {field.label} <span className="crm-quote-column-required-badge">Bắt buộc</span>
                          </label>
                        ))}
                        {summaryOptionalFields.map(field => (
                          <label key={field.key} className="crm-quote-column-option">
                            <input
                              type="checkbox"
                              checked={visibleSummaryFields.includes(field.key)}
                              disabled={readOnly}
                              onChange={() => toggleSummaryField(field.key)}
                            />
                            {field.label}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
