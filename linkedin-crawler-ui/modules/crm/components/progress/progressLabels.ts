/** Shared labels and tones for the CRM Progress dashboard. Quote is the only
 * record with real SLA here; other records only show their normal CRM status. */

export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  new_lead: 'Tiềm năng',
  following: 'Đang bán',
  current_customer: 'Đã mua',
  not_fit: 'Ngừng hoạt động',
};

export const CUSTOMER_STATUS_TONE: Record<string, string> = {
  new_lead: 'qc-badge-neutral',
  following: 'qc-badge-blue',
  current_customer: 'qc-badge-success',
  not_fit: 'qc-badge-danger',
};

export function customerStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return CUSTOMER_STATUS_LABELS[status] || status;
}

export const LEAD_STATUS_TONE: Record<string, string> = {
  mql: 'qc-badge-neutral',
  sql: 'qc-badge-success',
  nurturing: 'qc-badge-amber',
  unqualified: 'qc-badge-neutral',
};

export const CONTRACT_STATUS_TONE: Record<string, string> = {
  draft: 'qc-badge-neutral',
  pending_legal: 'qc-badge-amber',
  pending_signature: 'qc-badge-amber',
  signed: 'qc-badge-success',
  active: 'qc-badge-success',
  completed: 'qc-badge-success',
  expiring: 'qc-badge-warning',
  expired: 'qc-badge-danger',
  terminated: 'qc-badge-danger',
};

export const PROJECT_STATUS_TONE: Record<string, string> = {
  planning: 'qc-badge-neutral',
  active: 'qc-badge-blue',
  completed: 'qc-badge-success',
  cancelled: 'qc-badge-danger',
};

/** Mirror DEAL_STAGE_META (modules/crm/constants/crmConfig.ts) - dùng cho Deal
 * Quick View và Customer Quick View (deal thô từ /crm/customers/{id}/related,
 * chỉ có raw deal_stage, không có label kèm sẵn như ProgressDealItem). */
export const DEAL_STAGE_LABELS: Record<string, string> = {
  dealing: 'Đang deal',
  proposal_sent: 'Lên Proposal',
  negotiation: 'Chăm sóc/Đàm phán',
  contract_signed: 'Lên hợp đồng',
  payment_1: 'Thanh toán đợt 1',
  implementation: 'Triển khai',
  acceptance: 'Nghiệm thu',
  payment_final: 'Thanh toán còn lại',
  post_sale_care: 'Chăm sóc sau bán',
  on_hold: 'Tiếp tục chăm sóc',
  lost: 'Out',
  new_lead: 'Đang deal',
  contacted: 'Đang deal',
  qualified: 'Đang deal',
  requirement: 'Đang deal',
  contract_sent: 'Lên Proposal',
  won: 'Chăm sóc sau bán',
};

export function dealStageLabel(stage: string | null | undefined): string {
  if (!stage) return '—';
  return DEAL_STAGE_LABELS[stage] || stage;
}

export const QUOTE_PHASE_TONE: Record<string, string> = {
  presale: 'qc-badge-neutral',
  sale_markup: 'qc-badge-blue',
  admin_review: 'qc-badge-amber',
  ready_to_send: 'qc-badge-purple',
  sent: 'qc-badge-success',
};

export function formatSinceDuration(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const abs = Math.abs(diffMs);
  const minutes = abs / (1000 * 60);
  let text: string;

  if (minutes < 60) {
    text = `${Math.max(1, Math.round(minutes))} phút`;
  } else {
    const hours = minutes / 60;
    if (hours < 24) {
      text = `${Math.round(hours)} giờ`;
    } else {
      const days = Math.floor(hours / 24);
      const remHours = Math.round(hours % 24);
      text = remHours > 0 ? `${days} ngày ${remHours} giờ` : `${days} ngày`;
    }
  }

  return diffMs < 0 ? `${text} (tương lai)` : text;
}
