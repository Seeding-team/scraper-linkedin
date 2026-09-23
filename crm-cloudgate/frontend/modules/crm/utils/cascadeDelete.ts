/** Xoa Khach hang / Co hoi / Lead kem du lieu lien quan - HOI XAC NHAN truoc.
 *
 * Feedback 2026-09-23: "hỏi chấp nhận mất [dữ liệu] thì mới ok, không cần
 * chặn quyền xóa", "khi bấm xóa khách hàng, nếu khách hàng có báo giá cơ hội
 * thì cũng cho hỏi rồi xóa tất cả liên quan [...] tương tự lead", "nhớ hỏi
 * trước khi xóa là được".
 *
 * Backend (crm_delete_cascade_service.py) tra success:false +
 * data.requiresCascadeConfirm + so dem khi con du lieu lien quan va chua gui
 * confirm_cascade=true. FE dung cac helper duoi day de dung noi dung popup
 * liet ke ro se mat gi, roi goi lai voi confirm_cascade=true. */

export type CascadeSummary = {
  customer_count?: number;
  deal_count?: number;
  lead_count?: number;
  contact_count?: number;
  project_count?: number;
  quote_count?: number;
  contract_count?: number;
  /** Hop dong da ky/dang thuc hien trong so se bi xoa - chi de canh bao ro. */
  signed_contracts?: Array<{ id: string; contract_number?: string | null; title?: string | null; status?: string | null }>;
};

export const CASCADE_COUNT_KEYS = [
  'customer_count', 'deal_count', 'lead_count', 'contact_count', 'project_count', 'quote_count', 'contract_count',
] as const;

export class CascadeConfirmRequiredError extends Error {
  summary: CascadeSummary;
  constructor(message: string, summary: CascadeSummary) {
    super(message);
    this.name = 'CascadeConfirmRequiredError';
    this.summary = summary;
  }
}

/** body = JSON tra ve tu API. Tra ve summary neu backend yeu cau xac nhan. */
export function cascadeSummaryFromBody(body: unknown): CascadeSummary | null {
  const data = (body as { data?: (CascadeSummary & { requiresCascadeConfirm?: boolean }) | null } | null)?.data;
  return data && data.requiresCascadeConfirm ? data : null;
}

const LABELS: Record<(typeof CASCADE_COUNT_KEYS)[number], string> = {
  customer_count: 'khách hàng',
  deal_count: 'cơ hội',
  lead_count: 'lead',
  contact_count: 'người liên hệ',
  project_count: 'dự án',
  quote_count: 'báo giá',
  contract_count: 'hợp đồng',
};

/** Cong don so dem cua nhieu ban ghi (xoa hang loat). */
export function sumCascadeSummaries(summaries: CascadeSummary[]): CascadeSummary {
  const total: CascadeSummary = { signed_contracts: [] };
  for (const summary of summaries) {
    for (const key of CASCADE_COUNT_KEYS) total[key] = (total[key] || 0) + Number(summary[key] || 0);
    total.signed_contracts = [...(total.signed_contracts || []), ...(summary.signed_contracts || [])];
  }
  return total;
}

/** "2 cơ hội, 1 người liên hệ và 3 báo giá" - chi liet ke loai co so > 0. */
export function describeCascadeSummary(summary: CascadeSummary): string {
  const parts = CASCADE_COUNT_KEYS.map(key => {
    const count = Number(summary[key] || 0);
    return count > 0 ? `${count} ${LABELS[key]}` : '';
  }).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} và ${parts[parts.length - 1]}`;
}

/** Cau canh bao "se mat gi" cho popup xac nhan buoc 2. */
export function cascadeLossText(summary: CascadeSummary): string {
  const signed = summary.signed_contracts?.length || 0;
  return [
    'Nếu tiếp tục, TOÀN BỘ dữ liệu liên quan trên sẽ bị xoá theo: báo giá chuyển sang trạng thái đã xoá (Admin khôi phục được); cơ hội, lead, người liên hệ, dự án, hợp đồng và khách hàng bị xoá vĩnh viễn.',
    signed ? `Trong đó có ${signed} hợp đồng đã ký/đang thực hiện.` : '',
  ].filter(Boolean).join(' ');
}

/** Cau hoi day du cho window.confirm. entityLabel vd "Khách hàng này". */
export function cascadeWarningText(entityLabel: string, summary: CascadeSummary): string {
  return `${entityLabel} còn liên kết ${describeCascadeSummary(summary)}. ${cascadeLossText(summary)} Bạn có chấp nhận mất toàn bộ dữ liệu này và xoá không?`;
}
