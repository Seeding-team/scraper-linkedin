'use client';

import { formatDate } from '../../constants/crmConfig';
import { LEAD_STATUS_TONE, formatSinceDuration } from './progressLabels';
import type { ProgressLeadItem } from './progress.types';

/** Lead Quick View - Lead KHÔNG có route CRM riêng (đã audit thật), nên đây
 * là toàn bộ dữ liệu tiến độ sẵn có, không invent thêm field/route giả. */
export function ProgressLeadDrawer({ item }: { item: ProgressLeadItem }) {
  return (
    <div className="progress-panel">
      <span className={`qc-badge ${LEAD_STATUS_TONE[item.status || ''] || 'qc-badge-neutral'}`} style={{ width: 'fit-content' }}>
        {item.statusLabel}
      </span>

      <dl className="progress-key-value">
        <div><dt>Công ty</dt><dd>{item.companyName || '—'}</dd></div>
        <div><dt>SDR phụ trách</dt><dd>{item.sdrName || '—'}</dd></div>
        <div><dt>Đã ở trạng thái</dt><dd>{formatSinceDuration(item.sinceAt)}</dd></div>
        <div><dt>Follow-up</dt><dd>{formatDate(item.followUpDate) || '—'}</dd></div>
        <div className="full"><dt>Next step</dt><dd>{item.nextStep || '—'}</dd></div>
      </dl>

      <p className="crm-empty-log">Lead chưa có trang chi tiết CRM riêng — mở danh sách Lead để tìm đúng bản ghi và xử lý tiếp.</p>
      <a href={item.deepLink} className="qc-btn qc-btn-soft progress-open-full">Mở danh sách Lead</a>
    </div>
  );
}
