'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuoteSchema } from '@/modules/quotes';
import { getLockedColumnKeys, resolveQuoteItemColumns, resolveToggleableColumns } from '@/modules/quotes/utils/quoteColumns';
import { loadVisibleColumnsDraft, saveVisibleColumnsDraft } from './quoteColumnsDraft';
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
  const visibleColumns = (savedVisibleColumns || optionalColumnKeys).filter(key => optionalColumnKeys.includes(key));
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
            disabled={optionalTotal === 0}
          >
            Cột hiển thị{' '}
            <span className="crm-quote-column-count">
              {optionalTotal === 0 ? '—' : `${visibleCount}/${optionalTotal}`}
            </span>
          </button>
          {optionalTotal === 0 ? (
            <p className="crm-quote-column-empty-hint">Mẫu này không có cột tùy chỉnh.</p>
          ) : null}
          {columnMenuOpen && optionalTotal > 0 ? (
            <div className="crm-quote-column-menu">
              <p>Chỉ ảnh hưởng bản gửi khách, không xoá dữ liệu nội bộ.</p>
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
              <div className="crm-quote-column-menu-foot">
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
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
