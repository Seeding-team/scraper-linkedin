/** SLA noi bo THAT (migration 097: sla_started_at/sla_due_at/completed_at) -
 * HAM THUAN dung chung cho Workspace va Quote Center, KHONG goi API, KHONG
 * dung valid_until (hieu luc bao gia VOI KHACH HANG - khac hoan toan SLA
 * XU LY NOI BO). So sanh bang timestamp that (Date), KHONG so sanh chuoi
 * ngay. */

export type QuoteSlaStatus =
  | 'not_set'
  | 'in_progress'
  | 'due_soon'
  | 'overdue'
  | 'completed_on_time'
  | 'completed_late';

export type QuoteSlaTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface QuoteSlaPresentation {
  status: QuoteSlaStatus;
  label: string;
  relativeText: string;
  tone: QuoteSlaTone;
}

export interface QuoteSlaInput {
  slaStartedAt?: string | null;
  slaDueAt?: string | null;
  completedAt?: string | null;
  /** Fallback cho bao gia cu chua co completedAt that - dung sentAt neu co. */
  sentAt?: string | null;
  now?: Date;
}

// "Sap den han" khi con <= nguong nay (4 gio) va CHUA hoan thanh.
export const QUOTE_SLA_DUE_SOON_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function formatRelativeDuration(diffMs: number): string {
  const abs = Math.abs(diffMs);
  const minutes = abs / (1000 * 60);
  if (minutes < 60) return `${Math.round(minutes)} phút`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} giờ`;
  const days = hours / 24;
  return `${days.toFixed(1)} ngày`;
}

/** Tinh trang thai SLA realtime tu 3 timestamp that (khong luu text trang
 * thai o DB, tranh lech du lieu - dung yeu cau "suy trang thai SLA
 * realtime, khong can luu text"). */
export function computeQuoteSla(input: QuoteSlaInput): QuoteSlaPresentation {
  const now = input.now || new Date();
  const dueAt = input.slaDueAt ? new Date(input.slaDueAt) : null;
  const completedAt = input.completedAt
    ? new Date(input.completedAt)
    : input.sentAt
      ? new Date(input.sentAt)
      : null;

  if (!dueAt || Number.isNaN(dueAt.getTime())) {
    return { status: 'not_set', label: 'Chưa đặt SLA', relativeText: '', tone: 'neutral' };
  }

  if (completedAt && !Number.isNaN(completedAt.getTime())) {
    if (completedAt.getTime() <= dueAt.getTime()) {
      return { status: 'completed_on_time', label: 'Hoàn thành đúng hạn', relativeText: '', tone: 'success' };
    }
    return {
      status: 'completed_late',
      label: 'Hoàn thành trễ',
      relativeText: `Trễ ${formatRelativeDuration(completedAt.getTime() - dueAt.getTime())}`,
      tone: 'danger',
    };
  }

  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs < 0) {
    return { status: 'overdue', label: 'Quá hạn', relativeText: `Quá hạn ${formatRelativeDuration(diffMs)}`, tone: 'danger' };
  }
  if (diffMs <= QUOTE_SLA_DUE_SOON_THRESHOLD_MS) {
    return { status: 'due_soon', label: 'Sắp đến hạn', relativeText: `Còn ${formatRelativeDuration(diffMs)}`, tone: 'warning' };
  }
  return { status: 'in_progress', label: 'Đang trong SLA', relativeText: `Còn ${formatRelativeDuration(diffMs)}`, tone: 'neutral' };
}
