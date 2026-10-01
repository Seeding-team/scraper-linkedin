'use client';

import { formatDate, formatVND } from '../../constants/crmConfig';
import { formatSinceDuration } from './progressLabels';
import type { ProgressDealItem } from './progress.types';

/** Deal (Cơ hội) Quick View - Deal KHÔNG có route CRM riêng (mở qua drawer từ
 * /all-platform/crm, đã audit thật), nên đây là dữ liệu tiến độ đầy đủ hiện
 * có. quoteId/projectId chỉ hiện dạng tham chiếu (không đủ dữ liệu để dựng
 * Quick View lồng cho 2 record đó tại đây mà không suy đoán field). */
export function ProgressDealDrawer({ item, onOpenCustomer }: { item: ProgressDealItem; onOpenCustomer?: (customerId: string, customerName: string) => void }) {
  const followUpOverdue = Boolean(item.followUpDate && new Date(item.followUpDate).getTime() < Date.now());
  return (
    <div className="progress-panel">
      <span className="qc-badge qc-badge-blue" style={{ width: 'fit-content' }}>{item.dealStageLabel}</span>

      <dl className="progress-key-value">
        <div className="full"><dt>Khách hàng</dt><dd>{item.customerName || '—'}</dd></div>
        <div><dt>Công ty</dt><dd>{item.companyName || '—'}</dd></div>
        <div><dt>SDR</dt><dd>{item.sdrName || '—'}</dd></div>
        <div><dt>Người dẫn dắt</dt><dd>{item.leadedByName || '—'}</dd></div>
        <div><dt>Đã ở giai đoạn</dt><dd>{formatSinceDuration(item.sinceAt)}</dd></div>
        <div><dt>Ngân sách</dt><dd>{formatVND(item.estimatedBudgetVnd) || '0 đ'}</dd></div>
        <div>
          <dt>Follow-up</dt>
          <dd>
            {formatDate(item.followUpDate) || '—'}
            {followUpOverdue ? <span className="qc-badge qc-badge-danger" style={{ marginLeft: 6 }}>Quá hạn follow-up</span> : null}
          </dd>
        </div>
      </dl>

      {item.quoteId || item.projectId ? (
        <div className="progress-linked-actions">
          {item.quoteId ? <span className="qc-badge qc-badge-neutral">Có báo giá liên quan — tìm trong tab Báo giá &amp; SLA</span> : null}
          {item.projectId ? <span className="qc-badge qc-badge-neutral">Có dự án liên quan</span> : null}
        </div>
      ) : null}

      {item.customerId ? (
        <button type="button" className="qc-btn qc-btn-soft progress-open-full" onClick={() => onOpenCustomer?.(item.customerId!, item.customerName || 'Khách hàng')}>
          Xem khách hàng tại chỗ
        </button>
      ) : null}
    </div>
  );
}
