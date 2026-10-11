'use client';

import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { QuoteActivityLogEntry } from '@/modules/quotes';
import { seedingCrmRepository } from '../../repositories/SeedingCrmRepository';
import { formatVND } from '../../constants/crmConfig';
import { computeQuoteSla } from '../../utils/quoteSla';
import { QUOTE_PHASE_TONE, formatSinceDuration } from './progressLabels';
import type { ProgressQuoteItem } from './progress.types';

const PHASE_ORDER = ['presale', 'sale_markup', 'admin_review', 'ready_to_send', 'sent'] as const;
const PHASE_LABELS: Record<string, string> = {
  presale: 'Presale',
  sale_markup: 'Sale markup',
  admin_review: 'Admin review',
  ready_to_send: 'Sẵn sàng gửi',
  sent: 'Đã gửi',
};

const ACTION_LABELS: Record<string, string> = {
  created: 'Tạo báo giá',
  updated: 'Cập nhật thông tin',
  approved: 'Duyệt báo giá',
  cancelled: 'Huỷ báo giá',
  version_created: 'Tạo phiên bản mới',
  handoff_updated: 'Cập nhật bàn giao',
  owner_assigned: 'Gán người phụ trách',
  stage_changed: 'Chuyển bước xử lý',
};

function describeActivity(entry: QuoteActivityLogEntry): string {
  const base = ACTION_LABELS[entry.action] || entry.action;
  if (entry.action === 'stage_changed') {
    const stage = String((entry.changes as { stage?: string } | null)?.stage || '');
    const stageLabel = PHASE_LABELS[stage] || stage;
    return stageLabel ? `${base}: ${stageLabel}` : base;
  }
  return base;
}

/** Quote Quick View - pure content, no own drawer chrome; the parent
 * `ProgressDrawer` in ProgressDashboardView.tsx owns the single
 * ProgressRightDrawer + breadcrumb/back for the whole navigation stack. */
export function ProgressQuoteDrawer({ item }: { item: ProgressQuoteItem }) {
  const [activity, setActivity] = useState<QuoteActivityLogEntry[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([seedingQuoteRepository.getQuoteActivityLog(item.quoteId), seedingCrmRepository.getAgents()])
      .then(([log, agents]) => {
        if (!alive) return;
        setActivity([...log].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
        setActorNames(Object.fromEntries(agents.map(a => [a.id, a.name])));
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [item.quoteId]);

  const sla = computeQuoteSla({
    slaStartedAt: item.sla.startedAt,
    slaDueAt: item.sla.dueAt,
    completedAt: item.sla.completedAt,
  });
  const currentPhaseIndex = PHASE_ORDER.indexOf(item.processingStage as (typeof PHASE_ORDER)[number]);

  return (
    <div className="progress-panel">
      <div className="progress-mini-grid progress-mini-grid-2">
        <InfoBox label="Khách hàng" value={item.customerName || '—'} />
        <InfoBox label="Dự án" value={item.projectName || '—'} />
        <InfoBox label="Presale" value={item.technicalOwnerName || '—'} />
        <InfoBox label="Sale" value={item.quoteOwnerName || '—'} />
        <InfoBox label="Giá trị" value={formatVND(item.totalAmountVnd) || '0 đ'} />
        <InfoBox label="Ở bước này" value={formatSinceDuration(item.timeInCurrentStage.sinceAt)} />
      </div>

      <div className="progress-quote-badges">
        <span className={`qc-badge ${QUOTE_PHASE_TONE[item.processingStage] || 'qc-badge-neutral'}`}>{item.processingStageLabel}</span>
        <span className={`qc-badge ${sla.tone === 'danger' ? 'qc-badge-danger' : sla.tone === 'warning' ? 'qc-badge-warning' : sla.tone === 'success' ? 'qc-badge-success' : 'qc-badge-neutral'}`}>
          SLA: {sla.label}{sla.relativeText ? ` · ${sla.relativeText}` : ''}
        </span>
      </div>

      <section className="progress-drawer-section">
        <h3>Timeline xử lý</h3>
        <div className="progress-phase-line">
          {PHASE_ORDER.map((phase, idx) => {
            const done = currentPhaseIndex >= 0 && idx < currentPhaseIndex;
            const current = idx === currentPhaseIndex;
            return (
              <span key={phase} className={current ? 'current' : done ? 'done' : ''}>
                {PHASE_LABELS[phase]}
              </span>
            );
          })}
        </div>
      </section>

      <section className="progress-drawer-section">
        <h3>Lịch sử xử lý</h3>
        {loading ? (
          <p className="crm-empty-log">Đang tải...</p>
        ) : activity.length === 0 ? (
          <p className="crm-empty-log">Chưa có lịch sử.</p>
        ) : (
          <ol className="crm-timeline progress-timeline">
            {activity.map(entry => (
              <li key={entry.id}>
                <span className="crm-timeline-dot" />
                <div className="crm-timeline-time">
                  {new Date(entry.createdAt).toLocaleString('vi-VN')} {entry.actorId && actorNames[entry.actorId] ? `- ${actorNames[entry.actorId]}` : ''}
                </div>
                <div className="crm-timeline-action">{describeActivity(entry)}</div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <a href={`/all-platform/quotes/${item.quoteId}`} className="qc-btn qc-btn-primary progress-open-full">
        Mở báo giá đầy đủ
      </a>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="progress-info-box">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
