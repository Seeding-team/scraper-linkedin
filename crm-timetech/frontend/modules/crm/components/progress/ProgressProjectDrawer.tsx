'use client';

import { formatDate } from '../../constants/crmConfig';
import { formatSinceDuration, PROJECT_STATUS_TONE } from './progressLabels';
import type { ProgressProjectItem } from './progress.types';

const STEP_STATE_LABEL = { done: 'Xong', current: 'Đang xử lý', pending: 'Chưa tới', out: 'Đã hủy' } as const;
const PROJECT_FLOW = [
  { key: 'planning', label: 'Lên kế hoạch' },
  { key: 'active', label: 'Đang chạy' },
  { key: 'completed', label: 'Hoàn thành' },
];

function buildSteps(status: string | null) {
  if (status === 'cancelled') return PROJECT_FLOW.map(s => ({ ...s, state: 'out' as const }));
  const idx = PROJECT_FLOW.findIndex(s => s.key === status);
  if (idx < 0) return [];
  return PROJECT_FLOW.map((s, i) => ({
    ...s,
    // Dự án đã hoàn thành: bước cuối cũng tính là xong
    state: i < idx || (status === 'completed' && i === idx) ? ('done' as const) : i === idx ? ('current' as const) : ('pending' as const),
  }));
}

/** Project Quick View - compact giống Cơ hội. Dự án chưa có SLA/lịch sử đổi trạng thái đáng tin,
 * nên "Cập nhật gần nhất" lấy từ updated_at, KHÔNG suy đoán thời gian ở từng trạng thái. */
export function ProgressProjectDrawer({ item, onOpenCustomer, teamNameFallback }: { item: ProgressProjectItem; onOpenCustomer?: (customerId: string, customerName: string) => void; teamNameFallback?: string | null }) {
  const steps = buildSteps(item.status);
  return (
    <div className="progress-panel progress-panel--compact">
      <div className="progress-compact-head">
        <span className={`qc-badge ${PROJECT_STATUS_TONE[item.status || ''] || 'qc-badge-neutral'}`}>{item.statusLabel || '—'}</span>
        {item.projectCode ? <span className="progress-compact-money">{item.projectCode}</span> : null}
        {item.updatedAt ? <span className="progress-compact-sub">Cập nhật: {formatSinceDuration(item.updatedAt)} trước</span> : null}
      </div>

      <dl className="progress-key-value progress-key-value--compact">
        <div><dt>Tên dự án</dt><dd>{item.projectName || '—'}</dd></div>
        <div><dt>Mã dự án</dt><dd>{item.projectCode || '—'}</dd></div>
        <div><dt>Khách hàng</dt><dd>{item.customerName || '—'}</dd></div>
        <div><dt>Quản lý dự án</dt><dd>{item.managerName || '—'}</dd></div>
        <div><dt>Team</dt><dd>{item.teamName || teamNameFallback || '—'}</dd></div>
        <div><dt>Trạng thái</dt><dd>{item.statusLabel || '—'}</dd></div>
        <div><dt>Ngày tạo</dt><dd>{formatDate(item.createdAt) || '—'}</dd></div>
        <div><dt>Cập nhật gần nhất</dt><dd>{formatDate(item.updatedAt) || '—'}</dd></div>
        <div className="wide"><dt>Mô tả</dt><dd>{item.description?.trim() || '—'}</dd></div>
      </dl>

      {steps.length ? (
        <section className="progress-compact-section">
          <h3>Tiến độ hiện tại</h3>
          <ol className="progress-compact-steps">
            {steps.map(step => (
              <li key={step.key} className={`is-${step.state}`}>
                <b>{step.label}</b>
                <span>{STEP_STATE_LABEL[step.state]}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {item.customerId ? (
        <button type="button" className="qc-btn qc-btn-soft progress-compact-link" onClick={() => onOpenCustomer?.(item.customerId!, item.customerName || 'Khách hàng')}>
          Mở hồ sơ khách hàng ↗
        </button>
      ) : null}
    </div>
  );
}
