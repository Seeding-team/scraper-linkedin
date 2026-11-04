'use client';

import React, { useMemo } from 'react';

export interface TimeSeriesTotals {
  lead: number;
  customer: number;
  deal: number;
  project: number;
  quote: number;
  quoteOverdue: number;
  contract: number;
}

const SERIES_CONFIG = [
  { key: 'lead' as const, label: 'Lead', color: '#2563eb' },
  { key: 'customer' as const, label: 'Khách hàng', color: '#e11d48' },
  { key: 'deal' as const, label: 'Cơ hội', color: '#16a34a' },
  { key: 'project' as const, label: 'Dự án', color: '#9333ea' },
  { key: 'quote' as const, label: 'Báo giá', color: '#ea580c' },
  { key: 'quoteOverdue' as const, label: 'Báo giá quá SLA', color: '#7f1d1d' },
  { key: 'contract' as const, label: 'Hợp đồng theo dõi', color: '#0d9488' },
];

export type ChartRange = 'today' | 'week' | 'month' | 'year' | 'all';

const RANGE_OPTIONS: Array<{ value: ChartRange; label: string }> = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'week', label: 'Trong tuần' },
  { value: 'month', label: 'Trong tháng' },
  { value: 'year', label: 'Trong năm' },
  { value: 'all', label: 'Tất cả' },
];

export function ProgressTimeSeriesChart({
  totals,
  range,
  onRangeChange,
  ready = true,
}: {
  totals: TimeSeriesTotals;
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  ready?: boolean;
}) {
  const { rows, maxValue } = useMemo(() => {
    const list = SERIES_CONFIG.map(s => ({ ...s, value: totals[s.key] || 0 }));
    // Thang đo = đúng giá trị lớn nhất (cột dài nhất luôn gần đầy khung) -> dùng tốt cho mọi quy mô (5, 50, 500, 5.000...).
    // Không còn trục số 0/4/8/12: mỗi cột đã ghi sẵn số của nó.
    const max = Math.max(1, ...list.map(r => r.value));
    return { rows: list, maxValue: max };
  }, [totals]);

  // Vạch lưới chia đều (không ghi số)
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="progress-timeseries-container">
      <div className="progress-timeseries-header">
        <div className="progress-timeseries-title-wrap">
          <h2 className="progress-timeseries-title">Tổng quan tiến độ theo thời gian</h2>
        </div>
        <div className="progress-timeseries-controls">
          <select
            className="progress-timeseries-range-select"
            value={range}
            onChange={e => onRangeChange(e.target.value as ChartRange)}
            aria-label="Chọn khoảng thời gian"
          >
            {RANGE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {!ready ? <div className="pbar-chart" style={{ minHeight: 360 }} /> : (
      <>
      <div className="pbar-chart">
        <div className="pbar-plot">
          <div className="pbar-grid" aria-hidden="true">
            {gridFractions.map((f, i) => (
              <span key={i} className="pbar-grid-line" style={{ left: `${f * 100}%` }} />
            ))}
          </div>
          <div className="pbar-rows">
            {rows.map((r, i) => (
              <div key={r.key} className="pbar-row" title={`${r.label}: ${r.value}`}>
                <div className="pbar-track">
                  <div
                    className="pbar-bar"
                    style={{
                      width: `${Math.min(100, (r.value / maxValue) * 100)}%`,
                      // cột nhỏ vẫn đủ chỗ chứa số (kể cả 5-6 chữ số)
                      minWidth: `${String(r.value).length * 9 + 24}px`,
                      ['--bar-main' as string]: r.color,
                      animationDelay: `${i * 80}ms`,
                    }}
                  >
                    <span className="pbar-value" style={{ animationDelay: `${i * 80 + 450}ms` }}>{r.value}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="progress-timeseries-legend">
        {SERIES_CONFIG.map(s => (
          <span key={s.key} className="progress-timeseries-legend-item">
            <span className="progress-legend-dot" style={{ backgroundColor: s.color }} />
            <span className="progress-legend-name">{s.label}</span>
          </span>
        ))}
      </div>
      </>
      )}
    </div>
  );
}
