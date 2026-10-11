'use client';

import { useEffect, useState } from 'react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { formatVND } from '../../constants/crmConfig';
import { CONTRACT_STATUS_TONE, formatSinceDuration } from './progressLabels';
import type { ContractActivityLogItem, ProgressContractItem } from './progress.types';

const CONTRACT_ACTION_LABELS: Record<string, string> = {
  created: 'Tạo hợp đồng',
  updated: 'Cập nhật thông tin',
};

function describeContractActivity(entry: ContractActivityLogItem): string {
  if (entry.action?.startsWith('status_changed:')) {
    const status = entry.action.split(':')[1];
    return `Chuyển trạng thái → ${status}`;
  }
  return CONTRACT_ACTION_LABELS[entry.action || ''] || entry.action || '—';
}

/** Contract Quick View - status history THẬT từ contract_activity_log (đã có
 * sẵn route GET, không phải endpoint mới), KHÔNG gọi "quá SLA" vì Contract
 * không có SLA thật (chỉ Quote mới có). */
export function ProgressContractDrawer({ item }: { item: ProgressContractItem }) {
  const [activity, setActivity] = useState<ContractActivityLogItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    setActivity(null);
    progressRepository
      .getContractActivityLog(item.contractId)
      .then(log => {
        if (alive) setActivity([...log].sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime()));
      })
      .catch(() => {
        if (alive) setActivity([]);
      });
    return () => {
      alive = false;
    };
  }, [item.contractId]);

  return (
    <div className="progress-panel">
      <span className={`qc-badge ${CONTRACT_STATUS_TONE[item.status || ''] || 'qc-badge-neutral'}`} style={{ width: 'fit-content' }}>
        {item.statusLabel}
      </span>

      <dl className="progress-key-value">
        <div className="full"><dt>Tiêu đề</dt><dd>{item.title || '—'}</dd></div>
        <div><dt>Owner</dt><dd>{item.ownerName || '—'}</dd></div>
        <div><dt>Đã ở trạng thái</dt><dd>{formatSinceDuration(item.sinceAt)}</dd></div>
        <div><dt>Giá trị</dt><dd>{formatVND(item.contractValueVnd) || '0 đ'}</dd></div>
      </dl>

      {item.dealId || item.quoteId ? (
        <div className="progress-linked-actions">
          {item.dealId ? <span className="qc-badge qc-badge-neutral">Có cơ hội liên quan</span> : null}
          {item.quoteId ? <span className="qc-badge qc-badge-neutral">Có báo giá liên quan</span> : null}
        </div>
      ) : null}

      <section className="progress-drawer-section">
        <h3>Lịch sử trạng thái (thật, từ activity log)</h3>
        {activity === null ? (
          <p className="crm-empty-log">Đang tải...</p>
        ) : activity.length === 0 ? (
          <p className="crm-empty-log">Chưa có lịch sử.</p>
        ) : (
          <ol className="crm-timeline progress-timeline">
            {activity.map(entry => (
              <li key={entry.id}>
                <span className="crm-timeline-dot" />
                <div className="crm-timeline-time">{entry.createdAt ? new Date(entry.createdAt).toLocaleString('vi-VN') : '—'}</div>
                <div className="crm-timeline-action">{describeContractActivity(entry)}</div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <a href={`/all-platform/contracts/${item.contractId}`} className="qc-btn qc-btn-primary progress-open-full">
        Mở hợp đồng đầy đủ
      </a>
    </div>
  );
}
