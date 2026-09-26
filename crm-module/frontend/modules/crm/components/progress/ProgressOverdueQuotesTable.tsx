'use client';

import React from 'react';
import { Eye } from 'lucide-react';
import { formatVND } from '../../constants/crmConfig';
import { formatSinceDuration } from './progressLabels';
import type { ProgressQuoteItem } from './progress.types';

export function ProgressOverdueQuotesTable({
  quotes,
  onOpenQuote,
  onSeeAll,
}: {
  quotes: ProgressQuoteItem[];
  onOpenQuote: (quote: ProgressQuoteItem) => void;
  onSeeAll?: () => void;
}) {
  const overdueQuotes = quotes.filter(q => q.sla?.status === 'overdue');
  const displayList = overdueQuotes.length > 0 ? overdueQuotes.slice(0, 5) : quotes.slice(0, 5);

  const getStageBadgeClass = (stage: string) => {
    switch (stage?.toLowerCase()) {
      case 'ready_to_send':
      case 'ready_to_publish':
        return 'qc-badge-ready';
      case 'admin_review':
      case 'review':
        return 'qc-badge-review';
      case 'sale_markup':
      case 'pricing':
        return 'qc-badge-pricing';
      case 'presale':
      case 'technical':
        return 'qc-badge-presale';
      default:
        return 'qc-badge-neutral';
    }
  };

  return (
    <section className="progress-card progress-card-full">
      <div className="progress-card-title">
        <div className="progress-title-with-badge">
          <h2>Báo giá quá SLA</h2>
          {overdueQuotes.length > 0 && (
            <span className="qc-badge qc-badge-danger" style={{ fontSize: '12px' }}>
              {overdueQuotes.length}
            </span>
          )}
        </div>
        {onSeeAll && (
          <button type="button" className="progress-see-all-btn" onClick={onSeeAll}>
            Xem tất cả →
          </button>
        )}
      </div>

      {displayList.length === 0 ? (
        <p className="crm-empty-log">Không có báo giá nào quá hạn SLA.</p>
      ) : (
        <div className="qc-table-wrap progress-table-wrap">
          <table className="qc-team-table progress-overdue-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Mã báo giá</th>
                <th>Khách hàng</th>
                <th>Project</th>
                <th>Presale</th>
                <th>Sale</th>
                <th>Bước hiện tại</th>
                <th>Ở bước này</th>
                <th>SLA</th>
                <th className="num-col">Giá trị</th>
                <th style={{ width: 120, textAlign: 'center' }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {displayList.map((q, idx) => {
                const duration = q.timeInCurrentStage?.sinceAt ? formatSinceDuration(q.timeInCurrentStage.sinceAt) : '—';
                return (
                  <tr key={q.quoteId} className="progress-row-clickable" onClick={() => onOpenQuote(q)}>
                    <td className="text-muted">{idx + 1}</td>
                    <td>
                      <span className="progress-quote-number-link">
                        {q.quoteNumber || q.quoteId.slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <b>{q.customerName || '—'}</b>
                    </td>
                    <td>
                      {q.projectName ? (
                        <span className="qc-badge qc-badge-neutral">{q.projectName}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{q.technicalOwnerName || '—'}</td>
                    <td>{q.quoteOwnerName || '—'}</td>
                    <td>
                      <span className={`qc-badge ${getStageBadgeClass(q.processingStage)}`}>
                        {q.processingStageLabel || q.processingStage}
                      </span>
                    </td>
                    <td className="text-secondary">{duration}</td>
                    <td>
                      <span className={`qc-badge ${q.sla?.status === 'overdue' ? 'qc-badge-danger' : 'qc-badge-neutral'}`}>
                        {q.sla?.status === 'overdue' ? 'Quá SLA' : 'Đang xử lý'}
                      </span>
                    </td>
                    <td className="num-col font-bold">
                      {formatVND(q.totalAmountVnd) || '0 đ'}
                    </td>
                    <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="progress-view-detail-btn"
                        onClick={() => onOpenQuote(q)}
                      >
                        <Eye size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: -2 }} />
                        Xem chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
