import type { BillingType, ContractStatus, Deal, DealStage, PaymentStatus } from '../types';
import type { AppUser } from '@/types/unified.types';

/** Mirror của can_write_deal() bên backend (customer_lead_service.py) — chỉ
 * dùng để ẨN/DISABLE nút sửa/xóa/chuyển giai đoạn cho đúng UX, KHÔNG phải lớp
 * bảo mật (backend luôn tự kiểm tra lại, không tin client). admin/leader/sale
 * sửa được mọi deal; member thường chỉ sửa deal do mình tạo (leadedById) hoặc
 * được giao (sdrId) — không phải "cùng team" là sửa được hết.
 */
export function canWriteDeal(user: AppUser | null | undefined, deal: Deal | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'leader' || user.is_sale) return true;
  if (!deal) return false;
  return deal.assignment.leadedById === user.id || deal.assignment.sdrId === user.id;
}

/** Mirror của crm_permission_service.can_approve_quote (backend) - chỉ dùng để
 * ẩn/hiện nút "Duyệt báo giá" cho gọn UI, backend vẫn là nơi chặn thật.
 * Phase 1 "Nâng cấp Trung tâm báo giá" (đã xác nhận rõ ràng): Admin/Leader/
 * Member đều full quyền thao tác báo giá (tạo, sửa nháp, duyệt, tạo phiên
 * bản) — không còn giới hạn theo cờ `can_approve_quotes`/role riêng nữa. CHỈ
 * áp dụng cho quyền BÁO GIÁ — không dùng cho quyền Deal/Pipeline
 * (`canWriteDeal` giữ nguyên, không liên quan). */
export function canApproveQuote(user: AppUser | null | undefined): boolean {
  return Boolean(user);
}

type QuoteOwnerShape = { technicalOwnerId?: string | null; quoteOwnerId?: string | null } | null | undefined;

/** Mirror cua crm_permission_service.can_edit_technical_quote (backend) - CHI
 * dung de khoa/mo cell Giá vốn tren FE cho dung UX (bang hang muc thong nhat,
 * Section 4). Backend van la lop chan THAT (_check_item_field_level_permission),
 * ham nay khong bao gio la lop bao mat. */
export function canEditQuoteCost(user: AppUser | null | undefined, quote: QuoteOwnerShape): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'leader' || user.is_sale) return true;
  if (!quote) return false;
  return quote.technicalOwnerId === user.id;
}

/** Mirror cua crm_permission_service.can_edit_quote_pricing (backend) - CHI
 * dung de khoa/mo cell Markup/Giá khách tren FE. */
export function canEditQuotePricingFields(user: AppUser | null | undefined, quote: QuoteOwnerShape): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'leader' || user.is_sale) return true;
  if (!quote) return false;
  return quote.quoteOwnerId === user.id;
}

export const PIPELINE_COLUMNS: DealStage[] = [
  'new_lead',
  'contacted',
  'qualified',
  'requirement',
  'proposal_sent',
  'negotiation',
  'contract_sent',
];

export const TERMINAL_STAGES: DealStage[] = ['on_hold', 'won', 'lost'];
export const DEAL_STAGES: DealStage[] = [...PIPELINE_COLUMNS, ...TERMINAL_STAGES];

export const DEAL_STAGE_META: Record<
  DealStage,
  {
    order: number;
    label: string;
    color: string;
    badgeClass: string;
    description: string;
  }
> = {
  new_lead: {
    order: 1,
    label: 'Khách mới',
    color: '#2563eb',
    badgeClass: 'stage-badge-blue',
    description: 'Deal mới, chưa có tương tác',
  },
  contacted: {
    order: 2,
    label: 'Đã liên hệ',
    color: '#0891b2',
    badgeClass: 'stage-badge-cyan',
    description: 'Đã liên hệ khách hàng',
  },
  qualified: {
    order: 3,
    label: 'Đủ điều kiện',
    color: '#8b5cf6',
    badgeClass: 'stage-badge-violet',
    description: 'Có nhu cầu, ngân sách và người quyết định',
  },
  requirement: {
    order: 4,
    label: 'Lấy yêu cầu',
    color: '#c026d3',
    badgeClass: 'stage-badge-fuchsia',
    description: 'Đang thu thập yêu cầu',
  },
  proposal_sent: {
    order: 5,
    label: 'Đã báo giá',
    color: '#f59e0b',
    badgeClass: 'stage-badge-amber',
    description: 'Đã gửi báo giá',
  },
  negotiation: {
    order: 6,
    label: 'Đàm phán',
    color: '#fb923c',
    badgeClass: 'stage-badge-orange',
    description: 'Đang đàm phán',
  },
  contract_sent: {
    order: 7,
    label: 'Đã gửi hợp đồng',
    color: '#f43f5e',
    badgeClass: 'stage-badge-rose',
    description: 'Đã gửi hợp đồng',
  },
  on_hold: {
    order: 8,
    label: 'Tạm dừng',
    color: '#64748b',
    badgeClass: 'stage-badge-slate',
    description: 'Tạm dừng, cần follow-up sau',
  },
  won: {
    order: 9,
    label: 'Hoàn thành',
    color: '#059669',
    badgeClass: 'stage-badge-emerald',
    description: 'Deal đã thắng',
  },
  lost: {
    order: 10,
    label: 'Từ chối',
    color: '#dc2626',
    badgeClass: 'stage-badge-red',
    description: 'Deal đã mất',
  },
};

export const SOURCE_OPTIONS = [
  { value: 'Manual', label: 'Nhập tay' },
  { value: 'FB_Inbox', label: 'FB Inbox' },
  { value: 'FB_Group', label: 'FB Group' },
  { value: 'Zalo', label: 'Zalo' },
  { value: 'Website', label: 'Website' },
  { value: 'Referral', label: 'Giới thiệu' },
  { value: 'MarkeeChat', label: 'Markee Chat' },
];

// Đủ 63 tỉnh/thành Việt Nam — 5 thành phố trực thuộc trung ương trước, còn lại xếp theo bảng chữ cái.
export const CITY_OPTIONS = [
  'Hà Nội',
  'Hồ Chí Minh',
  'Hải Phòng',
  'Đà Nẵng',
  'Cần Thơ',
  'An Giang',
  'Bà Rịa - Vũng Tàu',
  'Bạc Liêu',
  'Bắc Giang',
  'Bắc Kạn',
  'Bắc Ninh',
  'Bến Tre',
  'Bình Định',
  'Bình Dương',
  'Bình Phước',
  'Bình Thuận',
  'Cà Mau',
  'Cao Bằng',
  'Đắk Lắk',
  'Đắk Nông',
  'Điện Biên',
  'Đồng Nai',
  'Đồng Tháp',
  'Gia Lai',
  'Hà Giang',
  'Hà Nam',
  'Hà Tĩnh',
  'Hải Dương',
  'Hậu Giang',
  'Hòa Bình',
  'Hưng Yên',
  'Khánh Hòa',
  'Kiên Giang',
  'Kon Tum',
  'Lai Châu',
  'Lâm Đồng',
  'Lạng Sơn',
  'Lào Cai',
  'Long An',
  'Nam Định',
  'Nghệ An',
  'Ninh Bình',
  'Ninh Thuận',
  'Phú Thọ',
  'Phú Yên',
  'Quảng Bình',
  'Quảng Nam',
  'Quảng Ngãi',
  'Quảng Ninh',
  'Quảng Trị',
  'Sóc Trăng',
  'Sơn La',
  'Tây Ninh',
  'Thái Bình',
  'Thái Nguyên',
  'Thanh Hóa',
  'Thừa Thiên Huế',
  'Tiền Giang',
  'Trà Vinh',
  'Tuyên Quang',
  'Vĩnh Long',
  'Vĩnh Phúc',
  'Yên Bái',
];

export const INDUSTRY_OPTIONS = [
  'Kinh doanh bất động sản',
  'Kinh doanh ô tô',
  'Kinh doanh thời trang',
  'Kinh doanh mỹ phẩm',
  'Kinh doanh thực phẩm',
  'Kinh doanh giáo dục / đào tạo',
  'Kinh doanh phần mềm / CNTT',
  'Kinh doanh xây dựng / nội thất',
  'Kinh doanh khác',
];

export const SERVICE_PACKAGE_OPTIONS = [
  { value: 'Lam_Web', label: 'Làm Web' },
  { value: 'Markee_Chat', label: 'Markee Chat' },
  { value: 'Markee_App', label: 'Markee App' },
  { value: 'Markee_CRM', label: 'Markee CRM' },
  { value: 'Marketing_Automation', label: 'Marketing Automation' },
  { value: 'Khac', label: 'Khác' },
];

export const CRM_PACKAGE_OPTIONS = [
  { value: 'Goi_co_ban', label: 'Gói cơ bản' },
  { value: 'Goi_nang_cao', label: 'Gói nâng cao' },
  { value: 'Goi_doanh_nghiep', label: 'Gói doanh nghiệp' },
];

export const CONTRACT_STATUS_OPTIONS: Array<{
  value: ContractStatus;
  label: string;
  color: string;
}> = [
  { value: 'moi_tiep_nhan', label: 'Mới tiếp nhận', color: '#2563eb' },
  { value: 'dang_xu_ly', label: 'Đang xử lý', color: '#7c3aed' },
  { value: 'da_bao_gia', label: 'Đã báo giá', color: '#0891b2' },
  { value: 'dang_dam_phan', label: 'Đang đàm phán', color: '#d97706' },
  { value: 'da_chot', label: 'Đã chốt', color: '#059669' },
  { value: 'tam_dung', label: 'Tạm dừng', color: '#64748b' },
  { value: 'khong_hoat_dong', label: 'Không hoạt động', color: '#dc2626' },
];

export const PAYMENT_STATUS_OPTIONS: Array<{ value: PaymentStatus; label: string }> = [
  { value: 'chua_thanh_toan', label: 'Chưa thanh toán' },
  { value: 'thanh_toan_mot_phan', label: 'Thanh toán một phần' },
  { value: 'da_thanh_toan', label: 'Đã thanh toán' },
  { value: 'qua_han', label: 'Quá hạn' },
];

export const BILLING_TYPE_OPTIONS: Array<{ value: BillingType; label: string }> = [
  { value: 'one_time', label: 'Một lần' },
  { value: 'monthly', label: 'Theo tháng' },
  { value: 'yearly', label: 'Theo năm' },
];

export function getBillingTypeLabel(value?: BillingType | string) {
  return BILLING_TYPE_OPTIONS.find(o => o.value === value)?.label || 'Một lần';
}

export const STAGE_CONTRACT_STATUS: Record<DealStage, ContractStatus> = {
  new_lead: 'moi_tiep_nhan',
  contacted: 'dang_xu_ly',
  qualified: 'dang_xu_ly',
  requirement: 'dang_xu_ly',
  proposal_sent: 'da_bao_gia',
  negotiation: 'dang_dam_phan',
  contract_sent: 'da_bao_gia',
  on_hold: 'tam_dung',
  won: 'da_chot',
  lost: 'khong_hoat_dong',
};

export const LOST_REASON_OPTIONS = [
  { value: 'no_budget', label: 'Khách chưa có ngân sách' },
  { value: 'competitor', label: 'Chọn đối thủ' },
  { value: 'timing', label: 'Chưa phù hợp thời điểm' },
  { value: 'no_response', label: 'Không phản hồi' },
  { value: 'other', label: 'Khác' },
];

export const WON_REASON_OPTIONS = [
  { value: 'solution_fit', label: 'Giải pháp phù hợp' },
  { value: 'trust_case_study', label: 'Uy tín / case study thuyết phục' },
  { value: 'competitive_price', label: 'Giá hợp lý' },
  { value: 'fast_response', label: 'Phản hồi nhanh' },
  { value: 'other', label: 'Khác' },
];

export const STAGE_REQUIREMENTS: Partial<
  Record<
    DealStage,
    {
      requireDecisionMaker?: boolean;
      requireBudget?: boolean;
      requireNote?: boolean;
      requireWonReason?: boolean;
      requireRejectReason?: boolean;
    }
  >
> = {
  contacted: { requireNote: true },
  qualified: { requireDecisionMaker: true, requireBudget: true, requireNote: true },
  requirement: { requireNote: true },
  proposal_sent: { requireBudget: true },
  negotiation: { requireNote: true },
  on_hold: { requireNote: true },
  won: { requireWonReason: true },
  lost: { requireRejectReason: true, requireNote: true },
};

// Nhãn tiếng Việt cho field key mà backend dùng trong message lỗi thô (vd
// "Thiếu thông tin bắt buộc cho stage 'contacted': note") — để humanizeCrmError
// dịch lại thành chữ người đọc được thay vì lộ tên cột DB.
const FIELD_LABELS: Record<string, string> = {
  note: 'Ghi chú',
  attachment_url: 'Link báo giá / hợp đồng',
  decision_maker: 'Người ra quyết định',
  estimated_budget: 'Ngân sách dự kiến',
  follow_up_date: 'Ngày follow-up',
  reject_reason_type: 'Lý do từ chối',
};

/**
 * Backend đôi khi trả message thô kèm stage key / field key (vd
 * `Thiếu thông tin bắt buộc cho stage 'contacted': note`) khi validate
 * client-side có khoảng trống chưa bắt kịp — dịch lại thành câu người đọc
 * được thay vì hiện thẳng key nội bộ cho user. Không match được thì trả
 * nguyên message gốc.
 */
export function humanizeCrmError(message: string): string {
  const missingMatch = message.match(/^Thiếu thông tin bắt buộc cho stage '([^']+)':\s*(.+)$/);
  if (missingMatch) {
    const [, stage, fieldsRaw] = missingMatch;
    const stageLabel = DEAL_STAGE_META[stage as DealStage]?.label || stage;
    const fields = fieldsRaw
      .split(',')
      .map(f => FIELD_LABELS[f.trim()] || f.trim())
      .join(', ');
    return `Thiếu thông tin bắt buộc để chuyển sang "${stageLabel}": ${fields}.`;
  }
  // Fallback chung: thay mọi 'stage_key' còn sót trong message bằng nhãn tiếng Việt.
  return message.replace(/'([a-z_]+)'/g, (match, key) => {
    const label = DEAL_STAGE_META[key as DealStage]?.label;
    return label ? `"${label}"` : match;
  });
}

export function getCurrentStage(deal?: Pick<Deal, 'stage'> | null): DealStage {
  return deal?.stage && DEAL_STAGES.includes(deal.stage) ? deal.stage : 'new_lead';
}

export function getStageMeta(stage: DealStage) {
  return DEAL_STAGE_META[stage] || DEAL_STAGE_META.new_lead;
}

export function formatVND(value?: number | string | null) {
  if (!Number(value || 0)) return null;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatCompactVND(value?: number | string | null) {
  const numeric = Number(value || 0);
  if (!numeric) return '0 đ';
  if (numeric >= 1000000000) {
    return `${(numeric / 1000000000).toFixed(numeric >= 10000000000 ? 0 : 1)} tỷ`;
  }
  if (numeric >= 1000000) {
    return `${(numeric / 1000000).toFixed(numeric >= 10000000 ? 0 : 1)} triệu`;
  }
  return formatVND(numeric) || '0 đ';
}

export function formatDate(dateStr?: string | null) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('vi-VN');
}

export function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getContractLabel(deal?: Pick<Deal, 'contract' | 'quote'> | null) {
  return deal?.contract?.code || deal?.quote?.number || deal?.contract?.title || deal?.quote?.id || '';
}

export function isCrmDocumentUrl(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  // Link báo giá thật sinh từ module Quotes là route nội bộ (cùng origin), không phải
  // file đính kèm ngoài — bỏ qua yêu cầu "http(s) + đuôi file" bên dưới cho 2 prefix này.
  if (/^\/public\/(quotes|quote-forms)\//i.test(raw)) return true;
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    const googleDocumentHosts = new Set([
      'drive.google.com',
      'docs.google.com',
      'sheets.google.com',
    ]);
    if (googleDocumentHosts.has(hostname) || hostname.endsWith('.googleusercontent.com')) {
      return true;
    }
    if (hostname === 'example.com' || hostname.endsWith('.example.com')) return false;
    return /\.(pdf|doc|docx|xls|xlsx|csv)(\?|#|$)/i.test(`${pathname}${url.search}${url.hash}`);
  } catch {
    return false;
  }
}

export function getContractUrl(deal?: Pick<Deal, 'contract' | 'quote'> | null) {
  const url = deal?.contract?.url || deal?.quote?.url || '';
  return isCrmDocumentUrl(url) ? url : '';
}

export function getServicePackageText(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return SERVICE_PACKAGE_OPTIONS.find(option => option.value === raw)?.label || raw;
}

export function getPackageText(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return CRM_PACKAGE_OPTIONS.find(option => option.value === raw)?.label || raw;
}

export function getContractStatusForStage(stage: DealStage): ContractStatus {
  return STAGE_CONTRACT_STATUS[stage] || '';
}

export function getContractStatusText(value?: ContractStatus | string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return CONTRACT_STATUS_OPTIONS.find(option => option.value === raw)?.label || raw;
}

export function getPaymentStatusText(value?: PaymentStatus | string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return PAYMENT_STATUS_OPTIONS.find(option => option.value === raw)?.label || raw;
}

/** Không ép thứ tự pipeline — cho chuyển tới bất kỳ giai đoạn nào khác giai đoạn
 * hiện tại (khớp với DEAL_STAGE_TRANSITIONS bên backend, cũng đã bỏ ràng buộc
 * thứ tự tương tự). Deal ở won/lost thì DetailDrawer tự ẩn cả khối này rồi
 * (xem `isTerminal`), nên không cần lọc riêng ở đây. */
export function allowedNextStages(currentStage: DealStage): DealStage[] {
  return DEAL_STAGES.filter(stage => stage !== currentStage);
}

export function parseMoney(value: string | number | undefined) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    const parts = cleaned.split(',');
    normalized =
      parts.length > 2 || parts.at(-1)?.length === 3
        ? cleaned.replace(/,/g, '')
        : cleaned.replace(',', '.');
  } else {
    normalized = cleaned.replace(/\.(?=\d{3}(\D|$))/g, '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Định dạng LIVE cho ô nhập tiền VND: thêm dấu chấm ngăn nghìn ngay khi gõ.
 *
 * Dùng chung `parseMoney` ở trên (đúng bộ quy tắc mà mọi ô tiền trong CRM —
 * `estimatedBudget` của DealFormFields, `budget` của StageModal — đang dùng để
 * đọc số ra khỏi chuỗi người dùng gõ), nên chuỗi hiển thị và số thật lưu
 * xuống luôn khớp nhau; không tự bịa 1 bộ regex tiền tệ thứ hai.
 *
 * Chuỗi rỗng vẫn trả về rỗng (ô trống ≠ 0) và phần "0" ở cuối khi người dùng
 * đang gõ dở (vd "50.000.0") được giữ nguyên vì parseMoney đọc nó ra số rồi
 * format lại — không nuốt ký tự nào của người dùng.
 */
export function formatMoneyInput(value: string): string {
  const raw = String(value ?? '');
  if (!raw.trim()) return '';
  // BUG THAT DA GAP: truoc day ham nay strip TOAN BO ky tu khong phai chu so
  // (`replace(/[^\d]/g, '')`) TRUOC KHI goi parseMoney() - voi 1 gia tri co
  // phan thap phan (vd unitPrice = 1428571.428571... sau khi tinh Margin muc
  // tieu, String() ra "1428571.4285714286"), buoc strip nay xoa luon dau "."
  // NGAN CACH THAP PHAN, bien "1428571.4285714286" thanh chuoi so nguyen
  // "14285714285714286" roi group lai thanh "14.285.714.285.714.286" - mot so
  // tien VNĐ khong lo, sai hoan toan (thay vi 1.428.571 dung). Goi thang
  // parseMoney() (da co san logic phan biet dau "." la thap phan hay ngan
  // nghin dua theo so chu so theo sau) roi lam tron ve DONG NGUYEN (VNĐ
  // khong co phan thap phan) TRUOC khi group - vua sua dung ca 2 truong hop:
  // (a) gia tri tho tu state (co the co thap phan) (b) chuoi nguoi dung dang
  // go do co dau cham ngan nghin ("1.500.000"/"50.000.0" dang go do).
  const numeric = parseMoney(raw);
  if (!Number.isFinite(numeric)) return '';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(numeric));
}
