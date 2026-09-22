/** Xoa Khach hang / Co hoi / Lead kem du lieu lien quan - HOI XAC NHAN truoc.
 *
 * Feedback 2026-09-23: "Nếu xóa Customer mà Customer đang có dữ liệu liên quan
 * thì phải hỏi rõ trước khi xóa luôn các dữ liệu liên quan, đặc biệt
 * Lead/Deal/Báo giá và các relation khác; không cascade âm thầm."
 *
 * Backend (crm_delete_cascade_service.py) tra success:false +
 * data.requiresCascadeConfirm + so dem khi con du lieu lien quan va chua gui
 * confirm_cascade=true. FE dung cac helper duoi day de dung noi dung popup
 * liet ke ro se mat gi, roi goi lai voi confirm_cascade=true. */

export type CascadeSummary = {
  deal_count?: number;
  lead_count?: number;
  contact_count?: number;
  project_count?: number;
  quote_count?: number;
  contract_count?: number;
  blocked_contracts?: Array<{ id: string; contract_number?: string | null; title?: string | null; status?: string | null }>;
};

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

const PARTS: Array<[keyof CascadeSummary, string]> = [
  ['deal_count', 'cơ hội'],
  ['lead_count', 'lead'],
  ['contact_count', 'người liên hệ'],
  ['project_count', 'dự án'],
  ['quote_count', 'báo giá'],
  ['contract_count', 'hợp đồng'],
];

/** "2 cơ hội, 1 người liên hệ và 3 báo giá" - chi liet ke loai co so > 0. */
export function describeCascadeSummary(summary: CascadeSummary): string {
  const parts = PARTS.map(([key, label]) => {
    const count = Number(summary[key] || 0);
    return count > 0 ? `${count} ${label}` : '';
  }).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} và ${parts[parts.length - 1]}`;
}

/** Hop dong da ky/dang thuc hien chan viec xoa (guard delete_contract o
 * backend, khong force-delete vuot guard). Tra ve thong bao neu co, null neu
 * khong - FE hien thong bao nay THAY cho nut "Xoá toàn bộ". */
export function blockedContractsMessage(summary: CascadeSummary): string | null {
  const blocked = summary.blocked_contracts || [];
  if (!blocked.length) return null;
  const names = blocked.slice(0, 5).map(c => c.contract_number || c.title || c.id).join(', ');
  return `Không thể xoá: còn ${blocked.length} hợp đồng đã ký/đang thực hiện (${names}). Hợp đồng ở trạng thái này không được xoá — hãy xử lý hợp đồng trước.`;
}

/** Cau canh bao day du cho popup xac nhan buoc 2. entityLabel vd "Khách hàng
 * này" / "Cơ hội này". */
export function cascadeWarningText(entityLabel: string, summary: CascadeSummary): string {
  return [
    `${entityLabel} còn liên kết ${describeCascadeSummary(summary)}.`,
    'Nếu tiếp tục, TOÀN BỘ dữ liệu liên quan trên sẽ bị xoá theo: báo giá chuyển sang trạng thái đã xoá (Admin khôi phục được); cơ hội, lead, người liên hệ, dự án và hợp đồng nháp bị xoá vĩnh viễn.',
    'Bạn có chắc muốn xoá toàn bộ?',
  ].join(' ');
}
