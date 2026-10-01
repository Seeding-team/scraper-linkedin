'use client';

import React, { useState } from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function ProgressDonut({
  segments,
  centerLabel,
  centerSubtext = 'Tổng số',
  onSegmentClick,
  activeLabel,
}: {
  segments: DonutSegment[];
  centerLabel?: string;
  centerSubtext?: string;
  onSegmentClick?: (label: string) => void;
  activeLabel?: string;
}) {
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  // SVG dimensions for Donut Ring
  const size = 104;
  const strokeWidth = 19;
  const radius = 42.5; // (size - strokeWidth) / 2 = (104 - 19) / 2 = 42.5
  const cx = size / 2; // 52
  const cy = size / 2; // 52
  const circumference = 2 * Math.PI * radius; // ~267.035

  let accumulatedLength = 0;
  const svgSlices = segments.map(s => {
    const ratio = total > 0 ? s.value / total : 0;
    const length = ratio * circumference;
    const offset = accumulatedLength;
    accumulatedLength += length;
    return {
      ...s,
      ratio,
      length,
      offset,
    };
  });

  const currentLabel = hoveredLabel || activeLabel;
  const activeSeg = segments.find(s => s.label === currentLabel);

  const handleRingMouseEnter = (seg: DonutSegment) => {
    setHoveredLabel(seg.label);
  };

  const handleRingMouseLeave = () => {
    setHoveredLabel(null);
  };

  return (
    <div
      className="progress-donut-layout"
      onMouseLeave={handleRingMouseLeave}
    >
      <div
        className="progress-donut-ring"
        role="img"
        aria-label={`Biểu đồ tròn cơ cấu với tổng số ${centerLabel || total}`}
        onMouseLeave={handleRingMouseLeave}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="progress-donut-svg"
          style={{ overflow: 'visible', pointerEvents: 'none' }}
          onMouseLeave={handleRingMouseLeave}
        >
          {total === 0 ? (
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={strokeWidth}
            />
          ) : (
            svgSlices.map(s => {
              if (s.value <= 0) return null;
              const isHovered = currentLabel === s.label;
              return (
                <circle
                  key={s.label}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={`${s.length} ${circumference - s.length}`}
                  strokeDashoffset={-s.offset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                  style={{
                    cursor: 'pointer',
                    pointerEvents: 'stroke',
                    transition: 'stroke-width 0.15s ease, opacity 0.15s ease',
                    opacity: currentLabel && !isHovered ? 0.45 : 1,
                  }}
                  onMouseEnter={() => handleRingMouseEnter(s)}
                  onClick={onSegmentClick ? () => onSegmentClick(s.label) : undefined}
                />
              );
            })
          )}
        </svg>

        <div className="progress-donut-hole">
          <div className="progress-donut-center">
            <div className="progress-donut-total">
              {activeSeg ? activeSeg.value : (centerLabel ?? total)}
            </div>
            <div
              className="progress-donut-subtext"
              title={activeSeg ? activeSeg.label : centerSubtext}
            >
              {activeSeg ? activeSeg.label : centerSubtext}
            </div>
          </div>
        </div>
      </div>

      <div className="progress-donut-legend">
        {segments.map(s => {
          const pct = total > 0 ? ((s.value / total) * 100).toFixed(1) : '0.0';
          const isActive = currentLabel === s.label;
          return (
            <div
              key={s.label}
              className={`progress-donut-legend-item${onSegmentClick ? ' clickable' : ''}${isActive ? ' active' : ''}`}
              onClick={onSegmentClick ? () => onSegmentClick(s.label) : undefined}
              onMouseEnter={() => setHoveredLabel(s.label)}
              onMouseLeave={handleRingMouseLeave}
              title={`${s.label}: ${s.value} (${pct}%)`}
            >
              <span className="progress-donut-legend-square" style={{ backgroundColor: s.color }} />
              <span className="progress-donut-legend-label">{s.label}</span>
              <span className="progress-donut-legend-percent">{pct}%</span>
            </div>
          );
        })}
      </div>

      {/* Floating Tooltip Menu - Positioned strictly OUTSIDE the donut ring */}
      {hoveredLabel && activeSeg && (
        <div className="progress-donut-tooltip">
          <div className="progress-donut-tooltip-header">
            <span
              className="progress-donut-tooltip-dot"
              style={{ backgroundColor: activeSeg.color }}
            />
            <strong className="progress-donut-tooltip-title">{activeSeg.label}</strong>
            <span className="progress-donut-tooltip-badge">
              {total > 0 ? ((activeSeg.value / total) * 100).toFixed(1) : '0.0'}%
            </span>
          </div>

          <div className="progress-donut-tooltip-stat">
            <span>Số lượng:</span>
            <strong>{activeSeg.value} bản ghi</strong>
          </div>

          <div className="progress-donut-tooltip-divider" />

          <div className="progress-donut-tooltip-breakdown-title">
            <span>Số liệu theo từng phần:</span>
            <span className="breakdown-total">{total} tổng</span>
          </div>

          <div className="progress-donut-tooltip-list">
            {segments.map(s => {
              const sPct = total > 0 ? ((s.value / total) * 100).toFixed(1) : '0.0';
              const isCurrent = s.label === activeSeg.label;
              return (
                <div
                  key={s.label}
                  className={`progress-donut-tooltip-row ${isCurrent ? 'is-active' : ''}`}
                >
                  <span className="row-dot" style={{ backgroundColor: s.color }} />
                  <span className="row-name">{s.label}</span>
                  <span className="row-val">{s.value}</span>
                  <span className="row-pct">({sPct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
