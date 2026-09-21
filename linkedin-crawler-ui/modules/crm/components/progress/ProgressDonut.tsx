'use client';

/** Donut chart nhỏ, CSS conic-gradient - CHỈ vẽ từ số liệu THẬT truyền vào
 * (không có time-series/trend nào ở đây, backend chưa có nguồn đó). */
export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function ProgressDonut({
  segments,
  centerLabel,
  onSegmentClick,
  activeLabel,
}: {
  segments: DonutSegment[];
  centerLabel?: string;
  onSegmentClick?: (label: string) => void;
  activeLabel?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let acc = 0;
  const stops: string[] = [];
  for (const s of segments) {
    if (s.value <= 0) continue;
    const start = total > 0 ? (acc / total) * 360 : 0;
    acc += s.value;
    const end = total > 0 ? (acc / total) * 360 : 0;
    stops.push(`${s.color} ${start}deg ${end}deg`);
  }
  const gradient = stops.length ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#eef1f5 0deg 360deg)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        style={{
          width: 108,
          height: 108,
          borderRadius: '50%',
          background: gradient,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{total}</div>
            {centerLabel ? <div style={{ fontSize: 10, color: '#667085' }}>{centerLabel}</div> : null}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {segments.map(s => (
          <div
            key={s.label}
            className={onSegmentClick ? 'progress-rank-row' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: onSegmentClick ? 'pointer' : undefined }}
            onClick={onSegmentClick ? () => onSegmentClick(s.label) : undefined}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ color: activeLabel === s.label ? '#c2185b' : '#5b6576', fontWeight: activeLabel === s.label ? 700 : 400 }}>{s.label}</span>
            <b style={{ marginLeft: 'auto' }}>{s.value}</b>
            {total > 0 ? <span style={{ color: '#9099a7', fontSize: 11 }}>({Math.round((s.value / total) * 100)}%)</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
