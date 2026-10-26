/** Dùng chung giữa LeadDetailDrawer (Xác minh Lead) và CreateOpportunityDrawer
 * (Tạo cơ hội trực tiếp từ Customer) - leader yêu cầu 2 form là "1 form 1
 * luôn" (2026-09-27), tách phần rule engine + type ra khỏi LeadDetailDrawer để
 * dùng chung, KHÔNG đổi logic so với bản gốc trong LeadDetailDrawer. */

export type IcpFit = 'unknown' | 'fit' | 'unfit';
/** 'pending' = chưa đủ dữ liệu để phân loại (không SQL, không Invalid, không
 * rơi vào điều kiện Nuôi dưỡng nào) - KHÁC với 'nurturing' thật (rơi đúng 1
 * trong 3 điều kiện Nuôi dưỡng của WIP). */
export type VerificationOutcome = 'sql' | 'nurturing' | 'unqualified' | 'pending';
export type InterestLevel = 'reference' | 'need' | 'evaluating' | 'quote';

export const INTEREST_LEVEL_OPTIONS: Array<{ value: InterestLevel; label: string; score: number }> = [
  { value: 'reference', label: 'Tham khảo', score: 25 },
  { value: 'need', label: 'Có nhu cầu', score: 55 },
  { value: 'evaluating', label: 'Đang đánh giá', score: 75 },
  { value: 'quote', label: 'Cần báo giá', score: 90 },
];

export function interestLevelFromScore(score: number | null | undefined): InterestLevel | '' {
  if (score == null || Number.isNaN(Number(score))) return '';
  if (score >= 85) return 'quote';
  if (score >= 65) return 'evaluating';
  if (score >= 40) return 'need';
  return 'reference';
}

/** 3 gia tri hien thi ket qua ICP (feedback: "ICP: Phù hợp / ICP: Chưa xác
 * định / sau này có thể có ICP: Không phù hợp") - dung DUNG CHU "Chưa xác
 * định" theo feedback, KHONG phai "Chưa rõ" (nham voi TRIGGER_OPTIONS o
 * StageModal.tsx, 1 danh sach khac khong lien quan ICP).
 *
 * Anh xa thang vao cot `crm_leads.qualification_icp_fit` (BOOLEAN NULLABLE, da
 * co tu migration 078). */
export const ICP_OPTIONS: Array<{ value: IcpFit; label: string }> = [
  { value: 'unknown', label: 'Chưa xác định' },
  { value: 'fit', label: 'Phù hợp' },
  { value: 'unfit', label: 'Không phù hợp' },
];

export function icpFromApi(value: boolean | null | undefined): IcpFit {
  if (value === true) return 'fit';
  if (value === false) return 'unfit';
  return 'unknown';
}
export function icpToApi(value: IcpFit): boolean | null {
  if (value === 'fit') return true;
  if (value === 'unfit') return false;
  return null;
}

/** "Khách đang quan tâm gì?" giờ cho chọn NHIỀU sản phẩm/dịch vụ + "Khác"
 * nhập tay (feedback leader, PDF góp ý màn Xác minh Lead) - vẫn lưu vào ĐÚNG
 * cột TEXT cũ `qualification_need` (migration 078, không phải mảng), dạng
 * "Markee CRM, Website doanh nghiệp, Khác: Zalo OA" giống hệt cách
 * markee_crm_v38_icp_rule_and_summary.html nối chuỗi - không cần migration
 * DB mới. */
export const OTHER_PRODUCT_PREFIX = 'Khác: ';
export const OTHER_PRODUCT_LABEL = 'Khác';

export function parseProductList(value: string): string[] {
  return (value || '').split(',').map(item => item.trim()).filter(Boolean);
}

export function hasAnyProduct(value: string): boolean {
  return parseProductList(value).length > 0;
}

/** Phần "Đúng nhóm khách hàng?" trước đây là dropdown SDR tự chọn - leader
 * yêu cầu bỏ hẳn, ICP giờ hệ thống TỰ đánh giá theo rule cấu hình được ở
 * "Điều kiện phân loại Lead" (LeadClassificationRuleSettings.tsx, 2 checkbox
 * `icp_product_in_catalog`/`icp_other_unknown` - cùng JSONB `conditions` với
 * rule SQL/Nuôi dưỡng/Không đạt sẵn có, không cần bảng/endpoint riêng).
 *
 * Rule 2 la dieu kien THAT (feedback: "nếu CHỈ chọn Khác và nhập tay → ICP =
 * Chưa xác định") - truoc day bi lam sai thanh nhanh "else" vo dieu kien,
 * khien checkbox icp_other_unknown tat/bat nhu nhau (khong dung y). Gio tách
 * rõ "chỉ chọn Khác" (onlyOther, khong co san pham nao trong danh muc) thanh
 * 1 nhanh rieng: BAT (mac dinh) -> "Chưa xác định" (cho Lead huong loi,
 * dung y "Không tự loại Lead khi sản phẩm chưa có trong danh mục"); TAT ->
 * "Không phù hợp" (Admin muon loai thang, day la duong DUY NHAT sinh ra
 * 'unfit' - truoc day "sau này có thể có ICP: Không phù hợp" khong bao gio
 * dat toi duoc vi thieu dung nhanh nay). */
export function evaluateIcpFitAuto(
  productValue: string,
  knownProductLabels: string[],
  ruleConditions: Record<string, boolean> | null,
): IcpFit {
  const items = parseProductList(productValue);
  if (!items.length) return 'unknown';
  const knownSet = new Set(knownProductLabels);
  const hasKnownProduct = items.some(item => knownSet.has(item));
  // Chưa tải được rule (vd network chậm) -> tạm coi như bật, khớp hành vi
  // DEFAULT_CONDITIONS bên backend (crm_lead_rule_service.py).
  const productInCatalogEnabled = ruleConditions ? Boolean(ruleConditions.icp_product_in_catalog) : true;
  const otherUnknownEnabled = ruleConditions ? Boolean(ruleConditions.icp_other_unknown) : true;

  if (productInCatalogEnabled && hasKnownProduct) return 'fit';

  const onlyOther = !hasKnownProduct;
  if (onlyOther) return otherUnknownEnabled ? 'unknown' : 'unfit';
  return 'unknown';
}

export function toDatetimeLocal(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type LeadRuleFields = {
  has_product: boolean;
  has_interest_level: boolean;
  has_value: boolean;
  has_team: boolean;
  has_next: boolean;
  has_follow: boolean;
  has_contact: boolean;
  fit_unfit: boolean;
  fit_known: boolean;
};

/** Nhan hien thi cho tung dieu kien SQL khi con thieu (Section 9/10 mockup
 * leader: "Còn thiếu: • Team Sale • Việc tiếp theo • Hạn follow-up") - CHI
 * dung de hien thi, khong anh huong logic (logic van doc key sql_* nhu cu). */
export const SQL_FIELD_LABELS: Record<string, string> = {
  sql_product: 'Sản phẩm / dịch vụ',
  sql_interest: 'Mức độ quan tâm',
  sql_value: 'Giá trị dự kiến',
  sql_team: 'Sale nhận bàn giao',
  sql_next: 'Việc tiếp theo',
  sql_follow: 'Hạn follow-up',
  sql_fit: 'ICP phù hợp',
};

export type LeadEvaluation = {
  outcome: VerificationOutcome;
  reason: string;
  /** Ly do cu the (Nuoi duong/Khong dat) de render bullet list - rong voi sql/pending. */
  reasons: string[];
  /** Ten field SQL dang bat nhung chua thoa - de render "Còn thiếu" luc pending. */
  missing: string[];
  sqlOk: number;
  sqlTotal: number;
};

/** Ban mirror THUAN JS cua evaluate_lead_conditions() (backend,
 * crm_lead_rule_service.py, migration 151 "Điều kiện phân loại Lead") - hien
 * thi "Kết quả Lead" trong drawer duoi dang OUTPUT CARD read-only (feedback
 * leader: "User khong duoc tu chon/override ket qua Lead", bo han radio).
 *
 * Thu tu uu tien: Khong dat chuan (OR) > Nuoi duong (OR, co the override ca
 * khi da du SQL) > SQL (AND) > 'pending' ("chưa đủ dữ liệu") neu khong khop
 * dieu kien nao trong 3 nhom tren. */
export function evaluateLeadConditions(fields: LeadRuleFields, c: Record<string, boolean>): LeadEvaluation {
  const invalidReasons: string[] = [];
  if (c.inv_fit && fields.fit_unfit) invalidReasons.push('Không phù hợp ICP');
  if (c.inv_no_contact && !fields.has_contact) invalidReasons.push('Không có thông tin liên hệ hợp lệ');
  const isInvalid = invalidReasons.length > 0;

  const sqlChecks: Array<{ key: keyof typeof SQL_FIELD_LABELS; ok: boolean }> = [];
  if (c.sql_product) sqlChecks.push({ key: 'sql_product', ok: fields.has_product });
  if (c.sql_interest) sqlChecks.push({ key: 'sql_interest', ok: fields.has_interest_level });
  if (c.sql_value) sqlChecks.push({ key: 'sql_value', ok: fields.has_value });
  if (c.sql_team) sqlChecks.push({ key: 'sql_team', ok: fields.has_team });
  if (c.sql_next) sqlChecks.push({ key: 'sql_next', ok: fields.has_next });
  if (c.sql_follow) sqlChecks.push({ key: 'sql_follow', ok: fields.has_follow });
  if (c.sql_fit) sqlChecks.push({ key: 'sql_fit', ok: !fields.fit_unfit });
  const sqlTotal = sqlChecks.length;
  const sqlOk = sqlChecks.filter(x => x.ok).length;
  const isSql = sqlTotal > 0 && sqlOk === sqlTotal;
  const missing = sqlChecks.filter(x => !x.ok).map(x => SQL_FIELD_LABELS[x.key]);

  const othersOk = (excludeKeys: Array<keyof typeof SQL_FIELD_LABELS>) =>
    sqlChecks.filter(x => !excludeKeys.includes(x.key)).every(x => x.ok);

  const nurtureReasons: string[] = [];
  if (c.nur_missing_value && !fields.has_value && othersOk(['sql_value'])) {
    nurtureReasons.push('Thiếu giá trị dự kiến');
  }
  if (c.nur_missing_handoff && !(fields.has_team && fields.has_next && fields.has_follow) &&
    othersOk(['sql_team', 'sql_next', 'sql_follow'])) {
    nurtureReasons.push('Thiếu thông tin bàn giao Sale');
  }
  if (c.nur_unknown_fit && !fields.fit_known && othersOk(['sql_fit'])) {
    nurtureReasons.push('Chưa xác định nhóm khách hàng');
  }
  const isNurtureForced = nurtureReasons.length > 0;

  if (isInvalid) {
    return { outcome: 'unqualified', reason: `Không đạt chuẩn: ${invalidReasons.join(', ')}.`, reasons: invalidReasons, missing, sqlOk, sqlTotal };
  }
  if (isNurtureForced) {
    return { outcome: 'nurturing', reason: `Nuôi dưỡng vì ${nurtureReasons.join(', ').toLowerCase()}.`, reasons: nurtureReasons, missing, sqlOk, sqlTotal };
  }
  if (isSql) {
    return { outcome: 'sql', reason: 'Đủ điều kiện SQL theo cấu hình hiện tại.', reasons: [], missing, sqlOk, sqlTotal };
  }
  return { outcome: 'pending', reason: 'Chưa đủ dữ liệu để phân loại.', reasons: [], missing, sqlOk, sqlTotal };
}
