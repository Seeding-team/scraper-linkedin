'use client';

import { useEffect, useState } from 'react';
import { progressRepository } from '../../repositories/ProgressRepository';
import { formatDate, formatVND } from '../../constants/crmConfig';
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONE, formatSinceDuration } from './progressLabels';
import type { ContractActivityLogItem, ProgressContractItem } from './progress.types';

const CONTRACT_ACTION_LABELS: Record<string, string> = {
  created: 'Tạo hợp đồng',
  updated: 'Cập nhật thông tin',
};

function describeContractActivity(entry: ContractActivityLogItem): string {
  if (entry.action?.startsWith('status_changed:')) {
    const status = entry.action.split(':')[1];
    return `Chuyển trạng thái → ${CONTRACT_STATUS_LABELS[status] || status}`;
  }
  return CONTRACT_ACTION_LABELS[entry.action || ''] || entry.action || '—';
}

const STEP_STATE_LABEL = { done: 'Xong', current: 'Đang xử lý', pending: 'Chưa tới', overdue: 'Sắp hết hạn', out: 'Kết thúc' } as const;
const CONTRACT_FLOW = ['draft', 'pending_legal', 'pending_signature', 'signed', 'active', 'completed'];
const TEMPLATE_LABELS: Record<string, string> = { service: 'Dịch vụ' };

function buildSteps(status: string | null) {
  if (status === 'expired' || status === 'terminated') {
    return CONTRACT_FLOW.map(k => ({ key: k, label: CONTRACT_STATUS_LABELS[k], state: 'out' as const }));
  }
  const key = status === 'expiring' ? 'active' : status;
  const idx = CONTRACT_FLOW.indexOf(key || '');
  if (idx < 0) return [];
  return CONTRACT_FLOW.map((k, i) => ({
    key: k,
    label: CONTRACT_STATUS_LABELS[k],
    state:
      i < idx || (status === 'completed' && i === idx)
        ? ('done' as const)
        : i === idx
          ? (status === 'expiring' ? ('overdue' as const) : ('current' as const))
          : ('pending' as const),
  }));
}

/** Contract Quick View - status history THẬT từ contract_activity_log (đã có
 * sẵn route GET, không phải endpoint mới), KHÔNG gọi "quá SLA" vì Contract
 * không có SLA thật (chỉ Quote mới có). */
export function ProgressContractDrawer({ item, teamNameFallback }: { item: ProgressContractItem; teamNameFallback?: string | null }) {
  const steps = buildSteps(item.status);
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
    <div className="progress-panel progress-panel--compact">
      <div className="progress-compact-head">
        <span className={`qc-badge ${CONTRACT_STATUS_TONE[item.status || ''] || 'qc-badge-neutral'}`}>{item.statusLabel || '—'}</span>
        <span className="progress-compact-money">{formatVND(item.contractValueVnd) || '0 đ'}</span>
        <span className="progress-compact-sub">Đã ở trạng thái: {formatSinceDuration(item.sinceAt)}</span>
      </div>

      <dl className="progress-key-value progress-key-value--compact">
        <div className="wide"><dt>Tiêu đề</dt><dd>{item.title || '—'}</dd></div>
        <div><dt>Số hợp đồng</dt><dd>{item.contractNumber || '—'}</dd></div>
        <div><dt>Loại hợp đồng</dt><dd>{(item.templateType && TEMPLATE_LABELS[item.templateType]) || item.templateType || '—'}</dd></div>
        <div><dt>Khách hàng</dt><dd>{item.customerName || '—'}</dd></div>
        <div><dt>Giá trị</dt><dd>{formatVND(item.contractValueVnd) || '0 đ'}</dd></div>
        <div><dt>Owner</dt><dd>{item.ownerName || '—'}</dd></div>
        <div><dt>Team</dt><dd>{item.teamName || teamNameFallback || '—'}</dd></div>
        <div><dt>Báo giá liên quan</dt><dd>{item.quoteNumber || (item.quoteId ? 'Có' : '—')}</dd></div>
        <div><dt>Cơ hội liên quan</dt><dd>{item.dealId ? 'Có' : '—'}</dd></div>
        <div><dt>Ngày bắt đầu</dt><dd>{formatDate(item.startDate) || '—'}</dd></div>
        <div><dt>Ngày kết thúc</dt><dd>{formatDate(item.endDate) || '—'}</dd></div>
        <div><dt>Ngày ký</dt><dd>{formatDate(item.signedAt) || '—'}</dd></div>
        <div><dt>Ngày tạo</dt><dd>{formatDate(item.createdAt) || '—'}</dd></div>
        <div className="wide"><dt>Điều khoản thanh toán</dt><dd>{item.paymentTerms?.trim() || '—'}</dd></div>
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

      <section className="progress-drawer-section">
        <h3>Lịch sử trạng thái</h3>
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
