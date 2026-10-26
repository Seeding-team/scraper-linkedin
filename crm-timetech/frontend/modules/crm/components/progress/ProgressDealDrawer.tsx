'use client';

import type { ReactNode } from 'react';
import { formatDate, formatVND } from '../../constants/crmConfig';
import { dealFollowUpState, dealStageLabel, formatSinceDuration } from './progressLabels';
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
  const followUpState = dealFollowUpState(item.dealStage, item.followUpDate);
  const e: DealDrawerExtra = extra || {};
  const steps = e.steps?.length ? e.steps : buildDealSteps(item.dealStage);
  const followUpBadge =
    e.followUpBadge ??
    (followUpState === 'overdue' ? (
      <span className="qc-badge qc-badge-danger" style={{ marginLeft: 6 }}>Quá follow-up</span>
    ) : followUpState === 'soon' ? (
      <span className="qc-badge qc-badge-amber" style={{ marginLeft: 6 }}>Sắp follow-up</span>
    ) : null);

  return (
    <div className="progress-panel progress-panel--compact">
      <div className="progress-compact-head">
        <span className={`qc-badge ${item.dealStage === 'lost' ? 'qc-badge-danger' : 'qc-badge-blue'}`}>{item.dealStageLabel || '—'}</span>
        <span className="progress-compact-money">{formatVND(item.estimatedBudgetVnd) || '0 đ'}</span>
        <span className="progress-compact-sub">Đã ở giai đoạn: {formatSinceDuration(item.sinceAt)}</span>
      </div>

      <dl className="progress-key-value progress-key-value--compact">
        <div><dt>Khách hàng</dt><dd>{item.customerName || '—'}</dd></div>
        <div><dt>Công ty</dt><dd>{item.companyName || '—'}</dd></div>
        {extra ? (
          <div><dt>Người liên hệ</dt><dd>{e.contactName || '—'}{e.contactPosition ? ` · ${e.contactPosition}` : ''}</dd></div>
        ) : null}
        <div><dt>Giá trị / ngân sách</dt><dd>{formatVND(item.estimatedBudgetVnd) || '0 đ'}</dd></div>
        {extra ? <div><dt>Dự án</dt><dd>{e.projectName || 'Chưa gắn dự án'}</dd></div> : null}
        <div><dt>Sale phụ trách{e.teamName ? ' / Team' : ''}</dt><dd>{item.sdrName || '—'}{e.teamName ? ` · ${e.teamName}` : ''}</dd></div>
        <div><dt>Người dẫn dắt</dt><dd>{item.leadedByName || '—'}</dd></div>
        {e.createdAt ? <div><dt>Ngày tạo</dt><dd>{formatDate(e.createdAt) || '—'}</dd></div> : null}
        <div className="wide">
          <dt>Follow-up</dt>
          <dd>{formatDate(item.followUpDate) || '—'} {followUpBadge}</dd>
        </div>
        {extra ? <div className="wide"><dt>Việc tiếp theo</dt><dd>{e.nextStep || '—'}</dd></div> : null}
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

      {e.related ? (
        <section className="progress-compact-section">
          <h3>Record liên quan</h3>
          {e.related}
        </section>
      ) : item.quoteId || item.projectId ? (
        <section className="progress-compact-section">
          <h3>Record liên quan</h3>
          <div className="progress-linked-actions">
            {item.quoteId ? <span className="qc-badge qc-badge-neutral">Có báo giá liên quan — xem trong tab Báo giá</span> : null}
            {item.projectId ? <span className="qc-badge qc-badge-neutral">Có dự án liên quan</span> : null}
          </div>
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

/** Các giai đoạn pipeline theo thứ tự (khớp DEAL_STAGE_LABELS) - dựng chip tiến độ khi caller không truyền steps. */
const PIPELINE_ORDER = ['dealing', 'proposal_sent', 'negotiation', 'contract_signed', 'payment_1', 'implementation', 'acceptance', 'payment_final', 'post_sale_care'];

function buildDealSteps(stage: string | null): NonNullable<DealDrawerExtra['steps']> {
  if (!stage) return [];
  if (stage === 'lost') return PIPELINE_ORDER.slice(0, 3).map(k => ({ key: k, label: dealStageLabel(k), state: 'out' as const }));
  const idx = PIPELINE_ORDER.indexOf(stage);
  if (idx < 0) return [];
  return PIPELINE_ORDER.map((k, i) => ({
    key: k,
    label: dealStageLabel(k),
    state: i < idx ? ('done' as const) : i === idx ? ('current' as const) : ('pending' as const),
  }));
}
