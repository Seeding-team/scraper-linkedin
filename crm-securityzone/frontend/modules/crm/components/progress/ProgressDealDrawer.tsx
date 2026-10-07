'use client';

import type { ReactNode } from 'react';
import { formatDate, formatVND } from '../../constants/crmConfig';
import { formatSinceDuration } from './progressLabels';
import type { ProgressDealItem } from './progress.types';

/** Du lieu THAT bo sung khi Co hoi duoc mo BEN TRONG drawer (vd tu Lead 360) de dung bo cuc compact:
 * khong tao nguon du lieu moi - caller (Lead 360) truyen cac gia tri da lay tu relation/API co san. */
export interface DealDrawerExtra {
  contactName?: string | null;
  contactPosition?: string | null;
  projectName?: string | null;
  teamName?: string | null;
  createdAt?: string | null;
  nextStep?: string | null;
  /** Huy hieu han follow-up (vd "Quá hạn 2 ngày") do caller dung dung logic han cua no. */
  followUpBadge?: ReactNode;
  /** Tien do/trang thai hien tai (chip tung buoc). */
  steps?: Array<{ key: string; label: string; state: 'done' | 'current' | 'pending' | 'overdue' | 'out' }>;
  /** Cac record lien quan (Yeu cau bao gia / Bao gia / Hop dong) da dung san o caller. */
  related?: ReactNode;
}

const STEP_STATE_LABEL = { done: 'Xong', current: 'Đang xử lý', pending: 'Chưa tới', overdue: 'Quá hạn', out: 'OUT' } as const;

/** Deal (Cơ hội) Quick View - Deal KHÔNG có route CRM riêng (mở qua drawer từ
 * /all-platform/crm, đã audit thật), nên đây là dữ liệu tiến độ đầy đủ hiện
 * có. quoteId/projectId chỉ hiện dạng tham chiếu (không đủ dữ liệu để dựng
 * Quick View lồng cho 2 record đó tại đây mà không suy đoán field).
 * Khi truyền `extra` (mở từ Lead 360) -> bố cục COMPACT dạng lưới, tận dụng chiều ngang drawer, không để khoảng trắng lớn. */
export function ProgressDealDrawer({
  item,
  onOpenCustomer,
  extra,
}: {
  item: ProgressDealItem;
  onOpenCustomer?: (customerId: string, customerName: string) => void;
  extra?: DealDrawerExtra;
}) {
  const followUpOverdue = Boolean(item.followUpDate && new Date(item.followUpDate).getTime() < Date.now());

  if (extra) {
    return (
      <div className="progress-panel progress-panel--compact">
        <div className="progress-compact-head">
          <span className="qc-badge qc-badge-blue">{item.dealStageLabel}</span>
          <span className="progress-compact-money">{formatVND(item.estimatedBudgetVnd) || '0 đ'}</span>
          <span className="progress-compact-sub">Đã ở giai đoạn: {formatSinceDuration(item.sinceAt)}</span>
        </div>

        <dl className="progress-key-value progress-key-value--compact">
          <div><dt>Khách hàng</dt><dd>{item.customerName || '—'}</dd></div>
          <div><dt>Người liên hệ</dt><dd>{extra.contactName || '—'}{extra.contactPosition ? ` · ${extra.contactPosition}` : ''}</dd></div>
          <div><dt>Giá trị / ngân sách</dt><dd>{formatVND(item.estimatedBudgetVnd) || '0 đ'}</dd></div>
          <div><dt>Dự án</dt><dd>{extra.projectName || 'Chưa gắn dự án'}</dd></div>
          <div><dt>Sale phụ trách / Team</dt><dd>{item.sdrName || '—'}{extra.teamName ? ` · ${extra.teamName}` : ''}</dd></div>
          <div><dt>Người dẫn dắt</dt><dd>{item.leadedByName || '—'}</dd></div>
          <div><dt>Ngày tạo</dt><dd>{formatDate(extra.createdAt) || '—'}</dd></div>
          <div className="wide">
            <dt>Follow-up</dt>
            <dd>{formatDate(item.followUpDate) || '—'} {extra.followUpBadge}</dd>
          </div>
          <div className="wide"><dt>Việc tiếp theo</dt><dd>{extra.nextStep || '—'}</dd></div>
        </dl>

        {extra.steps?.length ? (
          <section className="progress-compact-section">
            <h3>Tiến độ hiện tại</h3>
            <ol className="progress-compact-steps">
              {extra.steps.map(step => (
                <li key={step.key} className={`is-${step.state}`}>
                  <b>{step.label}</b>
                  <span>{STEP_STATE_LABEL[step.state]}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {extra.related ? (
          <section className="progress-compact-section">
            <h3>Record liên quan</h3>
            {extra.related}
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
