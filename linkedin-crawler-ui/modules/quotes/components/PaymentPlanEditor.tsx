'use client';

import { useEffect, useState } from 'react';
import type { PaymentPlanRow } from '../types';
import { formatVnd } from '../utils/quoteCalculations';
import { clampPercentValue, paymentPlanAmount, paymentPlanPercent, sanitizePercentDraft } from '../utils/paymentPlan';

/** Text input (not type="number") for phase percent - a controlled number
 * input doesn't repaint its DOM value when the parsed number is unchanged
 * (e.g. typing a second "0" while the value stays 0), which piles up stray
 * leading zeros in the field. Keeps its own draft string while focused so
 * sanitizing doesn't fight the user's cursor, and only clamps/reformats the
 * display on blur - see sanitizePercentDraft/clampPercentValue. */
function PercentInput({ index, value, disabled, onCommit }: {
  index: number;
  value: number;
  disabled: boolean;
  onCommit: (percent: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  return (
    <span className="quote-percent-input-wrap">
      <input
        aria-label={`Tỷ lệ đợt ${index + 1}`}
        disabled={disabled}
        type="text"
        inputMode="decimal"
        className="quote-percent-input"
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={e => {
          const next = sanitizePercentDraft(e.target.value);
          setDraft(next);
          onCommit(next === '' ? 0 : clampPercentValue(Number(next)));
        }}
        onBlur={() => {
          setFocused(false);
          const clamped = clampPercentValue(Number(sanitizePercentDraft(draft)) || 0);
          setDraft(String(clamped));
          onCommit(clamped);
        }}
      />
      <span className="quote-percent-suffix">%</span>
    </span>
  );
}

export function PaymentPlanEditor({ rows, finalPayable, onChange, disabled = false }: {
  rows: PaymentPlanRow[];
  finalPayable: number;
  onChange: (rows: PaymentPlanRow[]) => void;
  disabled?: boolean;
}) {
  const percent = paymentPlanPercent(rows);
  function update(index: number, patch: Partial<PaymentPlanRow>) {
    onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  return (
    <section className="quote-section-card">
      <div className="quote-section-head">
        <h4>Kế hoạch thanh toán</h4>
        <button type="button" disabled={disabled} onClick={() => onChange([...rows, {
          id: crypto.randomUUID(), phase: `Đợt ${rows.length + 1}`, percent: 0, condition: '', note: '',
        }])}>+ Thêm đợt</button>
      </div>
      <div className="quote-table-wrap">
        <table className="quote-table quote-table--editable">
          <thead><tr><th>Đợt</th><th>Tỷ lệ (%)</th><th>Số tiền</th><th>Điều kiện thanh toán</th><th>Ghi chú</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={row.id}>
              <td><input aria-label={`Tên đợt ${index + 1}`} disabled={disabled} value={row.phase} onChange={e => update(index, { phase: e.target.value })} /></td>
              <td className="money-cell"><PercentInput index={index} value={row.percent} disabled={disabled} onCommit={percent => update(index, { percent })} /></td>
              <td className="money-cell">{formatVnd(paymentPlanAmount(finalPayable, row.percent))}</td>
              <td><input aria-label={`Điều kiện đợt ${index + 1}`} disabled={disabled} value={row.condition} onChange={e => update(index, { condition: e.target.value })} /></td>
              <td><input aria-label={`Ghi chú đợt ${index + 1}`} disabled={disabled} value={row.note} onChange={e => update(index, { note: e.target.value })} /></td>
              <td><button type="button" disabled={disabled} aria-label={`Xóa đợt ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>×</button></td>
            </tr>
          ))}</tbody>
          {rows.length > 0 ? <tfoot><tr><th>Tổng</th><th className="money-cell">{percent}%</th><th className="money-cell">{formatVnd(rows.reduce((sum, row) => sum + paymentPlanAmount(finalPayable, row.percent), 0))}</th><td colSpan={3} /></tr></tfoot> : null}
        </table>
      </div>
      {rows.length > 0 && percent !== 100 ? <p role="alert" className="crm-help-text">Tổng tỷ lệ hiện tại là {percent}%, cần đủ 100%.</p> : null}
      <p className="crm-help-text">Số tiền tự tính theo tổng khách thanh toán sau chiết khấu. Không thêm đợt thì không in phần này.</p>
    </section>
  );
}
