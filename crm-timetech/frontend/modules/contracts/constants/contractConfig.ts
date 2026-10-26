import type { ContractClause, ContractStatus, ContractTemplateType } from '../types';

// Phai giong het _CANONICAL_CLAUSE_TITLES[2] trong contract_ai_service.py (backend
// LUON tra dieu khoan nay o vi tri thu 3, dung thu tu/tieu de - xem prompt AI).
const PAYMENT_CLAUSE_TITLE = 'ĐIỀU 3. GIÁ TRỊ & THANH TOÁN';

/** Trich noi dung dieu khoan "Gia tri & Thanh toan" THAT tu danh sach dieu khoan AI da
 * soan (hoac da duoc sua tay o buoc duyet) - dung lam payment_terms luu DB, thay vi
 * dung nguyen van o "Yeu cau them cho AI" (extraPrompt). extraPrompt chi la 1 goi y dau
 * vao cho AI, khong phai noi dung dieu khoan that trong hop dong - dung no lam
 * payment_terms se lech ngay khi sale sua tay dieu khoan nhung quen sua lai o do. */
export function extractPaymentTermsFromClauses(clauses: ContractClause[]): string {
  const byTitle = clauses.find(c => c.title === PAYMENT_CLAUSE_TITLE);
  if (byTitle) return byTitle.body;
  return clauses[2]?.body || '';
}

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Bản nháp',
  pending_legal: 'Chờ pháp chế duyệt',
  pending_signature: 'Chờ ký',
  signed: 'Đã ký',
  active: 'Đang thực hiện',
  completed: 'Đã hoàn thành',
  expiring: 'Sắp hết hạn',
  expired: 'Đã hết hạn',
  terminated: 'Đã chấm dứt',
};

export function contractStatusLabel(status: string): string {
  return CONTRACT_STATUS_LABELS[status as ContractStatus] || status;
}

export function contractStatusClass(status: string): string {
  if (status === 'active' || status === 'signed' || status === 'completed') return 'status-approved';
  if (status === 'pending_legal' || status === 'pending_signature' || status === 'expiring') return 'status-draft';
  if (status === 'expired' || status === 'terminated') return 'status-cancelled';
  return 'status-neutral';
}

export const CONTRACT_TEMPLATE_LABELS: Record<ContractTemplateType, string> = {
  service: 'Hợp đồng cung cấp dịch vụ CNTT',
  principle: 'Hợp đồng nguyên tắc',
  marketing: 'Hợp đồng dịch vụ Marketing',
};

export const CONTRACT_TEMPLATE_OPTIONS: Array<{ value: ContractTemplateType; label: string }> = [
  { value: 'service', label: CONTRACT_TEMPLATE_LABELS.service },
  { value: 'principle', label: CONTRACT_TEMPLATE_LABELS.principle },
  { value: 'marketing', label: CONTRACT_TEMPLATE_LABELS.marketing },
];

export const CONTRACT_STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['pending_legal', 'pending_signature'],
  pending_legal: ['pending_signature', 'draft'],
  pending_signature: ['signed', 'draft'],
  signed: ['active'],
  active: ['completed', 'terminated'],
  completed: [],
  expiring: ['active', 'terminated'],
  expired: ['terminated'],
  terminated: [],
};
