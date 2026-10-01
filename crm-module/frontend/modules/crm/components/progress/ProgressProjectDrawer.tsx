'use client';

import { PROJECT_STATUS_TONE } from './progressLabels';
import type { ProgressProjectItem } from './progress.types';

/** Project Quick View - Project KHÔNG có route CRM riêng, chỉ nằm trong tab
 * Dự án của Deal Drawer gốc (đã audit thật) - chỉ hiện status hiện tại, KHÔNG
 * bịa thời gian ở trạng thái/SLA vì backend chưa có nguồn đáng tin cho Project. */
export function ProgressProjectDrawer({ item, onOpenCustomer }: { item: ProgressProjectItem; onOpenCustomer?: (customerId: string, customerName: string) => void }) {
  return (
    <div className="progress-panel">
      <span className={`qc-badge ${PROJECT_STATUS_TONE[item.status || ''] || 'qc-badge-neutral'}`} style={{ width: 'fit-content' }}>
        {item.statusLabel}
      </span>

      <dl className="progress-key-value">
        <div><dt>Mã dự án</dt><dd>{item.projectCode || '—'}</dd></div>
        <div><dt>Tên dự án</dt><dd>{item.projectName || '—'}</dd></div>
        <div className="full"><dt>Khách hàng</dt><dd>{item.customerName || '—'}</dd></div>
        <div><dt>Quản lý</dt><dd>{item.managerName || '—'}</dd></div>
      </dl>

      <p className="crm-empty-log">Dự án chưa có nguồn dữ liệu "ở trạng thái bao lâu"/SLA đáng tin — chỉ hiện trạng thái hiện tại, không suy đoán.</p>

      {item.customerId ? (
        <button type="button" className="qc-btn qc-btn-soft progress-open-full" onClick={() => onOpenCustomer?.(item.customerId!, item.customerName || 'Khách hàng')}>
          Xem khách hàng tại chỗ
        </button>
      ) : null}
    </div>
  );
}
