'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Check,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Building2,
  Folder,
  User,
  ShieldCheck,
  FileText,
  DollarSign,
  ArrowRight,
} from 'lucide-react';
import { seedingQuoteRepository, type QuoteActivityLogEntry } from '@/modules/quotes';
import { seedingCrmRepository } from '../../repositories/SeedingCrmRepository';
import { formatVND } from '../../constants/crmConfig';
import { computeQuoteSla } from '../../utils/quoteSla';
import { formatSinceDuration } from './progressLabels';
import type { ProgressQuoteItem } from './progress.types';

const WORKFLOW_STEPS = [
  { key: 'request', label: 'Request' },
  { key: 'technical', altKey: 'presale', label: 'Kỹ thuật' },
  { key: 'sale_markup', altKey: 'pricing', label: 'Sale markup' },
  { key: 'admin_review', altKey: 'review', label: 'Admin review' },
  { key: 'ready_to_send', altKey: 'ready_to_publish', label: 'Sẵn sàng gửi' },
  { key: 'sent', altKey: 'published', label: 'Đã gửi' },
] as const;

const PHASE_LABELS: Record<string, string> = {
  request: 'Request',
  presale: 'Kỹ thuật / Presale',
  technical: 'Kỹ thuật / Presale',
  sale_markup: 'Sale markup',
  pricing: 'Sale markup',
  admin_review: 'Admin review',
  review: 'Admin review',
  ready_to_send: 'Sẵn sàng gửi',
  ready_to_publish: 'Sẵn sàng gửi',
  sent: 'Đã gửi',
  published: 'Đã gửi',
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

const AVATAR_COLORS = [
  '#f43f5e',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#6366f1',
];

function formatStepDateTime(dateStr?: string | null): string {
  if (!dateStr) return '---';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '---';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hours}:${mins}`;
  } catch {
    return '---';
  }
}

function formatDueAtDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${mins}`;
  } catch {
    return '—';
  }
}

function getStageStyle(stage?: string | null) {
  const s = (stage || '').toLowerCase();
  if (s.includes('admin') || s.includes('review')) {
    return { bg: '#fef3c7', text: '#b45309', border: '#fde68a' };
  }
  if (s.includes('sale') || s.includes('markup') || s.includes('giá bán')) {
    return { bg: '#dbeafe', text: '#1d4ed8', border: '#bfdbfe' };
  }
  if (s.includes('sẵn sàng') || s.includes('ready')) {
    return { bg: '#f3e8ff', text: '#7e22ce', border: '#e9d5ff' };
  }
  if (s.includes('presale') || s.includes('kỹ thuật') || s.includes('technical')) {
    return { bg: '#e0e7ff', text: '#4338ca', border: '#c7d2fe' };
  }
  if (s.includes('đã gửi') || s.includes('sent')) {
    return { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' };
  }
  return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
}

function describeActivity(entry: QuoteActivityLogEntry): string {
  const base = ACTION_LABELS[entry.action] || entry.action;
  if (entry.action === 'stage_changed') {
    const stage = String((entry.changes as { stage?: string } | null)?.stage || '');
    const stageLabel = PHASE_LABELS[stage] || stage;
    return stageLabel ? `${base}: ${stageLabel}` : base;
  }
  return base;
}

export function ProgressQuoteDrawer({ item }: { item: ProgressQuoteItem }) {
  const [activity, setActivity] = useState<QuoteActivityLogEntry[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      seedingQuoteRepository.getQuoteActivityLog(item.quoteId),
      seedingCrmRepository.getAgents(),
    ])
      .then(([log, agents]) => {
        if (!alive) return;
        setActivity(
          [...log].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
        );
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

  // Stepper calculations
  const stepperData = useMemo(() => {
    const currentPhase = item.processingStage || 'request';

    let currentIndex = WORKFLOW_STEPS.findIndex(
      step => step.key === currentPhase || (step as any).altKey === currentPhase
    );
    if (currentIndex < 0) {
      if (currentPhase.includes('review')) currentIndex = 3;
      else if (currentPhase.includes('markup') || currentPhase.includes('pricing')) currentIndex = 2;
      else if (currentPhase.includes('ready')) currentIndex = 4;
      else if (currentPhase.includes('sent')) currentIndex = 5;
      else currentIndex = 1;
    }

    const stepsWithDates = WORKFLOW_STEPS.map((step, idx) => {
      const isDone = idx < currentIndex;
      const isCurrent = idx === currentIndex;
      const isUpcoming = idx > currentIndex;

      let dateText = '---';

      if (idx === 0) {
        const createLog = activity.find(l => l.action === 'created');
        dateText = formatStepDateTime(createLog?.createdAt || item.sla.startedAt);
      } else if (idx <= currentIndex) {
        const stepLog = activity.find(l => {
          if (l.action !== 'stage_changed') return false;
          const target = (l.changes as any)?.stage;
          return target === step.key || target === (step as any).altKey;
        });

        if (stepLog?.createdAt) {
          dateText = formatStepDateTime(stepLog.createdAt);
        } else if (idx === currentIndex) {
          dateText = formatStepDateTime(
            item.timeInCurrentStage?.sinceAt || item.sla.startedAt
          );
        } else {
          dateText = formatStepDateTime(item.sla.startedAt);
        }
      }

      return {
        ...step,
        index: idx,
        isDone,
        isCurrent,
        isUpcoming,
        dateText,
      };
    });

    const isOverdue =
      item.sla.status === 'overdue' || item.sla.status === 'completed_late';
    const isDueSoon = item.sla.status === 'due_soon';

    return {
      currentIndex,
      steps: stepsWithDates,
      isOverdue,
      isDueSoon,
    };
  }, [item, activity]);

  // SLA Alert calculations
  const slaAlert = useMemo(() => {
    const sla = item.sla;
    const isOverdue = sla.status === 'overdue' || sla.status === 'completed_late';
    const isDueSoon = sla.status === 'due_soon';
    const isNotSet = sla.status === 'not_set';

    let overdueHours = 0;
    let overdueMins = 0;

    if (sla.dueAt) {
      const diffMs = Date.now() - new Date(sla.dueAt).getTime();
      if (diffMs > 0) {
        overdueHours = Math.floor(diffMs / (1000 * 60 * 60));
        overdueMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      }
    }

    return {
      isOverdue,
      isDueSoon,
      isNotSet,
      overdueHours: Math.max(1, overdueHours),
      overdueMins,
      dueAtFormatted: formatDueAtDateTime(sla.dueAt),
      durationText: formatSinceDuration(sla.dueAt),
    };
  }, [item]);

  const stageStyle = getStageStyle(item.processingStageLabel);
  const presaleInitial = (item.technicalOwnerName || 'P').trim().slice(0, 1).toUpperCase();
  const saleInitial = (item.quoteOwnerName || 'S').trim().slice(0, 1).toUpperCase();

  return (
    <div className="progress-quote-detail-container">
      {/* 1. Hero Card: Thông tin cơ bản & Giá trị báo giá */}
      <div className="progress-quote-hero-card">
        <div className="quote-hero-header">
          <div className="quote-hero-title-group">
            <div className="quote-code-row">
              <span className="quote-code-text">
                #{item.quoteNumber || item.quoteId.slice(0, 8)}
              </span>
              <span
                className="quote-stage-pill"
                style={{
                  backgroundColor: stageStyle.bg,
                  color: stageStyle.text,
                  borderColor: stageStyle.border,
                }}
              >
                {item.processingStageLabel}
              </span>
            </div>
            <p className="quote-created-meta">
              Bắt đầu: {formatDueAtDateTime(item.sla.startedAt)}
            </p>
          </div>

          <div className="quote-hero-amount-box">
            <span className="quote-amount-lbl">Giá trị báo giá</span>
            <span className="quote-amount-val">{formatVND(item.totalAmountVnd)}</span>
          </div>
        </div>

        {/* Customer & Project metadata pills */}
        <div className="quote-hero-meta-grid">
          <div className="quote-meta-item">
            <Building2 size={15} className="meta-icon" />
            <div className="meta-content">
              <span className="meta-lbl">Khách hàng</span>
              <span className="meta-val" title={item.customerName || 'Chưa có'}>
                {item.customerName || '—'}
              </span>
            </div>
          </div>

          <div className="quote-meta-item">
            <Folder size={15} className="meta-icon" />
            <div className="meta-content">
              <span className="meta-lbl">Dự án</span>
              <span className="meta-val" title={item.projectName || 'Chưa có'}>
                {item.projectName || '—'}
              </span>
            </div>
          </div>

          <div className="quote-meta-item">
            <Clock size={15} className="meta-icon" />
            <div className="meta-content">
              <span className="meta-lbl">Ở bước này</span>
              <span className="meta-val">
                {formatSinceDuration(item.timeInCurrentStage.sinceAt)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Thẻ SLA Alert Box Nổi Bật */}
      {slaAlert && (
        <div
          className={`progress-member-sla-alert-box ${
            slaAlert.isOverdue
              ? 'alert-overdue'
              : slaAlert.isDueSoon
                ? 'alert-duesoon'
                : slaAlert.isNotSet
                  ? 'alert-notset'
                  : 'alert-ontime'
          }`}
        >
          <div className="sla-alert-left">
            <div className="sla-alert-icon-square">
              {slaAlert.isOverdue ? (
                <AlertTriangle size={18} />
              ) : slaAlert.isDueSoon ? (
                <Clock size={18} />
              ) : slaAlert.isNotSet ? (
                <Clock size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
            </div>
            <div className="sla-alert-text-block">
              <h5 className="sla-alert-title">
                {slaAlert.isOverdue
                  ? `Quá SLA ${slaAlert.overdueHours} giờ ${slaAlert.overdueMins > 0 ? `${slaAlert.overdueMins} phút` : ''}`
                  : slaAlert.isDueSoon
                    ? 'Sắp đến hạn SLA'
                    : slaAlert.isNotSet
                      ? 'Chưa thiết lập SLA'
                      : 'Đúng hạn SLA'}
              </h5>
              <p className="sla-alert-sub">
                Hạn hoàn tất: {slaAlert.dueAtFormatted}
                {slaAlert.isOverdue
                  ? ` | Trễ ${slaAlert.overdueHours} giờ ${slaAlert.overdueMins} phút`
                  : ''}
              </p>
            </div>
          </div>

          <a
            href={`/all-platform/quotes/${item.quoteId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sla-alert-action-btn"
          >
            <span>Mở CRM</span>
            <ExternalLink size={13} />
          </a>
        </div>
      )}

      {/* 3. Khối Nhân Sự Phụ Trách (Personnel Cards) */}
      <div className="progress-quote-personnel-grid">
        <div className="quote-personnel-card">
          <div className="personnel-avatar" style={{ backgroundColor: '#e0e7ff', color: '#4338ca' }}>
            {presaleInitial}
          </div>
          <div className="personnel-info">
            <span className="personnel-role-tag tag-presale">Kỹ thuật / Presale</span>
            <span className="personnel-name">{item.technicalOwnerName || 'Chưa phân công'}</span>
          </div>
        </div>

        <div className="quote-personnel-card">
          <div className="personnel-avatar" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>
            {saleInitial}
          </div>
          <div className="personnel-info">
            <span className="personnel-role-tag tag-sale">Kinh doanh / Sale</span>
            <span className="personnel-name">{item.quoteOwnerName || 'Chưa phân công'}</span>
          </div>
        </div>
      </div>

      {/* 4. Quy Trình 6 Bước (Horizontal Stepper) */}
      <div className="progress-quote-stepper-section">
        <div className="section-title-row">
          <h4>Quy trình xử lý báo giá (6 bước)</h4>
          <span className="current-step-indicator">
            Bước {stepperData.currentIndex + 1}/6
          </span>
        </div>

        <div className="progress-member-stepper-wrap">
          <div className="progress-member-stepper">
            {stepperData.steps.map((step, idx) => {
              const isLast = idx === stepperData.steps.length - 1;
              const nextStep = stepperData.steps[idx + 1];

              let lineColorClass = 'line-upcoming';
              if (step.isDone && (nextStep?.isDone || nextStep?.isCurrent)) {
                lineColorClass =
                  nextStep?.isCurrent && stepperData.isOverdue ? 'line-red' : 'line-blue';
              }

              return (
                <div key={step.key} className="progress-step-item">
                  <div className="progress-step-node-row">
                    <div
                      className={`progress-step-circle ${
                        step.isDone
                          ? 'step-done'
                          : step.isCurrent
                            ? stepperData.isOverdue
                              ? 'step-current-overdue'
                              : 'step-current-blue'
                            : 'step-upcoming'
                      }`}
                    >
                      {step.isDone ? (
                        <Check size={12} strokeWidth={3} />
                      ) : step.isCurrent ? (
                        <span className="step-current-inner-dot" />
                      ) : (
                        <span className="step-upcoming-inner-dot" />
                      )}
                    </div>

                    {!isLast ? (
                      <div className={`progress-step-line ${lineColorClass}`} />
                    ) : null}
                  </div>

                  <div className="progress-step-text-wrap">
                    <span
                      className={`progress-step-label ${
                        step.isCurrent
                          ? stepperData.isOverdue
                            ? 'label-current-red'
                            : 'label-current'
                          : step.isDone
                            ? 'label-done'
                            : 'label-upcoming'
                      }`}
                    >
                      {step.label}
                    </span>
                    <span className="progress-step-date">{step.dateText}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. Lịch Sử Xử Lý (Activity Log) */}
      <div className="progress-quote-activity-section">
        <h4>Lịch sử xử lý ({activity.length})</h4>

        {loading ? (
          <p className="crm-empty-log">Đang tải lịch sử xử lý...</p>
        ) : activity.length === 0 ? (
          <p className="crm-empty-log">Chưa có bản ghi lịch sử xử lý nào.</p>
        ) : (
          <div className="progress-quote-timeline">
            {activity.map((entry, idx) => {
              const actorName = (entry.actorId && actorNames[entry.actorId]) || 'Hệ thống';
              const isLast = idx === activity.length - 1;

              return (
                <div key={entry.id} className="timeline-entry-row">
                  <div className="timeline-node-col">
                    <div className="timeline-dot" />
                    {!isLast && <div className="timeline-track" />}
                  </div>

                  <div className="timeline-entry-body">
                    <div className="timeline-header-line">
                      <span className="timeline-action-desc">
                        {describeActivity(entry)}
                      </span>
                      <span className="timeline-timestamp">
                        {formatStepDateTime(entry.createdAt)}
                      </span>
                    </div>

                    <div className="timeline-actor-row">
                      <span className="timeline-actor-pill">
                        <User size={11} />
                        <span>{actorName}</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Footer Action Button */}
      <div className="progress-quote-footer-actions">
        <a
          href={`/all-platform/quotes/${item.quoteId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="quote-open-full-btn"
        >
          <span>Mở báo giá đầy đủ trong CRM</span>
          <ExternalLink size={15} />
        </a>
      </div>
    </div>
  );
}
