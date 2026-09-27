'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { usersService, type QuoteBusinessRoleUser } from '@/services/all-platform.service';
import { formatVND, parseMoney, PIPELINE_COLUMNS, DEAL_STAGE_META } from '../constants/crmConfig';
import { CurrencyInput } from '@/components/CurrencyInput';
import { mapLead } from './LeadsDirectory';
import { PositionSelect } from './PositionSelect';
import { CrmCategorySelect } from './CrmCategorySelect';
import { SearchableSelect } from './SearchableSelect';
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, X, XCircle } from './icons';
import type { AppUser } from '@/types/unified.types';
import type { CrmLeadRow } from '../types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

type CompanyMatchRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  match_reason?: string;
};

type IcpFit = 'unknown' | 'fit' | 'unfit';
/** 'pending' = chưa đủ dữ liệu để phân loại (không SQL, không Invalid, không
 * rơi vào điều kiện Nuôi dưỡng nào) - KHÁC với 'nurturing' thật (rơi đúng 1
 * trong 3 điều kiện Nuôi dưỡng của WIP). Trước đây 2 trường hợp này bị gộp
 * chung thành 'nurturing' (fallback ngầm định) - feedback leader: tách riêng
 * để không kết luận nhầm "Nuôi dưỡng" khi Lead chỉ đơn giản là chưa điền đủ. */
type VerificationOutcome = 'sql' | 'nurturing' | 'unqualified' | 'pending';
type InterestLevel = 'reference' | 'need' | 'evaluating' | 'quote';

const INTEREST_LEVEL_OPTIONS: Array<{ value: InterestLevel; label: string; score: number }> = [
  { value: 'reference', label: 'Tham khảo', score: 25 },
  { value: 'need', label: 'Có nhu cầu', score: 55 },
  { value: 'evaluating', label: 'Đang đánh giá', score: 75 },
  { value: 'quote', label: 'Cần báo giá', score: 90 },
];

function interestLevelFromScore(score: number | null | undefined): InterestLevel | '' {
  if (score == null || Number.isNaN(Number(score))) return '';
  if (score >= 85) return 'quote';
  if (score >= 65) return 'evaluating';
  if (score >= 40) return 'need';
  return 'reference';
}

/** 3 lua chon "Co dung nhom khach hang muc tieu?".
 *
 * Anh xa thang vao cot `crm_leads.qualification_icp_fit` (BOOLEAN NULLABLE, da
 * co tu migration 078) — KHONG can migration moi: NULL = chua ro, true = phu
 * hop, false = khong phu hop. Truoc day UI chi co 1 checkbox nen ep NULL ve
 * false ("chua xac dinh / khong phu hop" gop lam mot); tach lai dung 3 trang
 * thai chi la doc/ghi dung kieu du lieu von co cua cot. */
const ICP_OPTIONS: Array<{ value: IcpFit; label: string }> = [
  { value: 'unknown', label: 'Chưa rõ' },
  { value: 'fit', label: 'Phù hợp' },
  { value: 'unfit', label: 'Không phù hợp' },
];

function icpFromApi(value: boolean | null | undefined): IcpFit {
  if (value === true) return 'fit';
  if (value === false) return 'unfit';
  return 'unknown';
}
function icpToApi(value: IcpFit): boolean | null {
  if (value === 'fit') return true;
  if (value === 'unfit') return false;
  return null;
}

function toDatetimeLocal(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initialOf(name: string): string {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

type VerifyForm = {
  interest: string;
  interestLevel: InterestLevel | '';
  score: number | null;
  icpFit: IcpFit;
  timeline: string;
  estimatedValue: number | null;
  nextStep: string;
  nextStepAt: string;
  aeId: string;
  note: string;
  followUpChannel: string;
  dealStage: string;
  /** "Dự án (tùy chọn)" - feedback leader + WIP full-flow, section A "Thông
   * tin then chốt". Chỉ gõ TÊN (chưa có ProjectPicker chọn Dự án có sẵn ở
   * màn Xác minh Lead - Customer thường CHƯA xác định lúc này) - backend
   * (crm_lead_service.convert_lead) tự tạo Dự án THẬT sau khi convert xong,
   * gắn vào Deal vừa tạo (migration 153 + supabase_project_service). */
  project: string;
};

/** "Giai đoạn" cho Deal SAP tao (feedback WIP full-flow, mucE.2 "Bàn giao
 * Sale": layout `Giai đoạn | Kết quả Lead`) - chi cho chon trong cac stage
 * PIPELINE THAT (khong gom on_hold/lost, khong hop ly cho 1 co hoi vua tao). */
const DEAL_STAGE_OPTIONS = PIPELINE_COLUMNS.map(stage => ({ value: stage, label: DEAL_STAGE_META[stage].label }));

type LeadRuleFields = {
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
const SQL_FIELD_LABELS: Record<string, string> = {
  sql_product: 'Sản phẩm / dịch vụ',
  sql_interest: 'Mức độ quan tâm',
  sql_value: 'Giá trị dự kiến',
  sql_team: 'Sale nhận bàn giao',
  sql_next: 'Việc tiếp theo',
  sql_follow: 'Hạn follow-up',
  sql_fit: 'ICP phù hợp',
};

type LeadEvaluation = {
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
 * dieu kien nao trong 3 nhom tren - KHAC voi `!isSql -> nurturing`: 1 Lead
 * chi don gian chua dien du KHONG duoc mac dinh ket luan la Nuoi duong that
 * (Nuoi duong phai khop dung 1 trong 3 ly do rieng cua WIP). */
function evaluateLeadConditions(fields: LeadRuleFields, c: Record<string, boolean>): LeadEvaluation {
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

  // "Near-miss": 1 dieu kien Nuoi duong CHI duoc tinh la khop khi TAT CA cac
  // dieu kien SQL dang bat KHAC (ngoai dung field ma dieu kien nay nham toi)
  // da thoa - tuc Lead gan nhu du SQL, chi vuong dung 1 cho. Neu Lead con
  // thieu nhieu thu khac nua thi van la "pending" ("chưa đủ dữ liệu"), KHONG
  // phai Nuoi duong (feedback leader, doi chieu vi du muc 4 + Test A/D: Lead
  // moi mo/dien mot phan KHONG duoc tu dong ket luan la Nuoi duong chi vi 1
  // field dang trong - phai gan nhu hoan chinh moi tinh).
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

/**
 * Drawer "Xác minh Lead" — 1 luồng có dẫn dắt thay cho 3 khối rời rạc trước đây
 * (xem/sửa + form Qualification thô + nút Convert nổi). Vẫn thao tác trên đúng
 * 1 record crm_leads và vẫn dùng đúng 2 endpoint cũ:
 *   - PUT  /crm/leads/{id}          — lưu xác minh (KHÔNG BAO GIỜ tạo hồ sơ)
 *   - POST /crm/leads/{id}/convert  — tạo Customer+Contact+Deal+Activity
 *     nguyên tử qua RPC crm_convert_lead (migration 078), giữ nguyên
 *     idempotency_key như trước.
 *
 * "Mức sẵn sàng Convert" tính HOÀN TOÀN phía client từ 5 điều kiện thật của
 * form — không có cột/endpoint mới, và cũng không còn nút "Đủ điều kiện" đơn lẻ
 * nào có thể tự mở khoá Convert.
 */
export function LeadDetailDrawer({
  lead,
  open,
  initialMode,
  currentUser,
  onClose,
  onSaved,
  onEdit,
}: {
  lead: CrmLeadRow | null;
  open: boolean;
  initialMode: 'view' | 'qualify' | 'convert';
  currentUser: AppUser | null;
  onClose: () => void;
  onSaved: (lead: CrmLeadRow) => void;
  /** Mở form sửa hồ sơ Lead. Drawer này KHÔNG tự dựng form sửa riêng — nó đẩy
   * ngược lên LeadsDirectory để mở đúng LeadEditDrawer mà "Sửa nhanh" dùng,
   * nên chỉ tồn tại duy nhất 1 bản form sửa Lead trong toàn bộ ứng dụng. */
  onEdit?: (lead: CrmLeadRow) => void;
}) {
  useBodyScrollLock(open);
  const router = useRouter();
  const [saleOptions, setSaleOptions] = useState<QuoteBusinessRoleUser[]>([]);
  const [form, setForm] = useState<VerifyForm>({
    interest: '',
    interestLevel: '',
    score: null,
    icpFit: 'unknown',
    timeline: '',
    estimatedValue: null,
    nextStep: '',
    nextStepAt: '',
    aeId: '',
    note: '',
    followUpChannel: '',
    dealStage: 'dealing',
    project: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState('');
  const [suggestionUsed, setSuggestionUsed] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [companyMatches, setCompanyMatches] = useState<CompanyMatchRow[]>([]);
  const [dupChecked, setDupChecked] = useState(false);
  const [customerChoice, setCustomerChoice] = useState<'new' | string>('new');
  const [contact, setContact] = useState({ name: '', phone: '', email: '', positionCategoryId: '', positionLabel: '' });
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');
  const [verificationOutcome, setVerificationOutcome] = useState<VerificationOutcome>('pending');
  // "Điều kiện phân loại Lead" (migration 151) - tai 1 lan, chi doc (GET mo
  // cho moi nguoi dang nhap, sua rule la trang rieng chi Admin). Ket qua
  // xac minh CHI do rule engine tinh (evaluateLeadConditions), KHONG cho
  // SDR tu chon/override (feedback leader) - da bo state `outcomeTouched`
  // truoc day dung de tam dung auto-tinh khi SDR bam tay 1 radio.
  const [ruleConditions, setRuleConditions] = useState<Record<string, boolean> | null>(null);
  const [outcomeReasons, setOutcomeReasons] = useState<string[]>([]);
  const [outcomeMissing, setOutcomeMissing] = useState<string[]>([]);
  const [sqlProgress, setSqlProgress] = useState<{ ok: number; total: number }>({ ok: 0, total: 0 });
  const [nurtureReason, setNurtureReason] = useState('');
  const [unqualifiedReason, setUnqualifiedReason] = useState('');
  const idempotencyKeyRef = useRef<string>('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const readinessRef = useRef<HTMLElement>(null);

  const setField = <K extends keyof VerifyForm>(key: K, value: VerifyForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Chi khoi tao lai form khi mo 1 LEAD KHAC (hoac mo lai drawer), khong phai
  // moi lan prop `lead` doi tham chieu: sau khi "Lưu xác minh" thanh cong,
  // LeadsDirectory day xuong 1 object lead moi -> neu effect nay chay lai theo
  // tham chieu thi no se reset ca `convertOpen` vua bat, khien nut "Tạo cơ hội
  // & bàn giao Sale" bam xong khong mo duoc buoc xac nhan (bug thuc te bat
  // duoc luc chay Playwright, khong phai gia thuyet).
  const initializedLeadRef = useRef<string>('');

  useEffect(() => {
    if (!open || !lead) {
      initializedLeadRef.current = '';
      return;
    }
    if (initializedLeadRef.current === lead.id) return;
    initializedLeadRef.current = lead.id;
    setError('');
    setSavedOk('');
    setConvertError('');
    setSuggestionUsed(false);
    setConvertOpen(initialMode === 'convert');
    setVerificationOutcome('pending');
    setNurtureReason('');
    setUnqualifiedReason('');
    setOutcomeReasons([]);
    setOutcomeMissing([]);
    setSqlProgress({ ok: 0, total: 0 });
    setForm({
      interest: lead.qualificationNeed || '',
      interestLevel: interestLevelFromScore(lead.score),
      score: lead.score ?? null,
      icpFit: icpFromApi(lead.qualificationIcpFit),
      timeline: lead.qualificationExpectedTimeline || '',
      estimatedValue: lead.qualificationEstimatedValue ?? null,
      nextStep: lead.nextStep || '',
      nextStepAt: toDatetimeLocal(lead.followUpDate),
      aeId: lead.qualificationAeId || '',
      note: lead.note || '',
      followUpChannel: '',
      dealStage: 'dealing',
      project: '',
    });
    setContact({
      name: lead.leadName || '',
      phone: lead.phone || '',
      email: lead.email || '',
      positionCategoryId: lead.positionCategoryId || '',
      positionLabel: lead.positionLabelSnapshot || lead.position || '',
    });
    setCustomerChoice('new');
    idempotencyKeyRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `lead-convert-${lead.id}-${Date.now()}`;

    // Check trùng doanh nghiệp — đúng endpoint company-match đã dùng từ trước.
    // Khi lead không có công ty/website thì lùi về duplicate-check theo
    // SĐT/email để ô "đã được check trùng" phản ánh 1 lần kiểm tra THẬT chứ
    // không tự bật xanh.
    setCompanyMatches([]);
    setDupChecked(false);
    const hasCompanyKeys = Boolean(lead.companyName || lead.website);
    const url = hasCompanyKeys
      ? (() => {
          const params = new URLSearchParams();
          if (lead.website) params.set('website', lead.website);
          if (lead.companyName) params.set('name', lead.companyName);
          return `${API_BASE_URL}/api/all-platform/crm/leads/company-match?${params.toString()}`;
        })()
      : (() => {
          const params = new URLSearchParams();
          if (lead.phone) params.set('phone', lead.phone);
          if (lead.email) params.set('email', lead.email);
          return `${API_BASE_URL}/api/all-platform/crm/leads/duplicate-check?${params.toString()}`;
        })();
    fetch(url, { credentials: 'include', headers: headers() })
      .then(res => res.json())
      .then(body => {
        if (body.success === false) return;
        if (hasCompanyKeys) setCompanyMatches((body.data?.matches || []) as CompanyMatchRow[]);
        setDupChecked(true);
      })
      .catch(() => setDupChecked(false));
  }, [open, lead, initialMode]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    usersService.getUsersByQuoteBusinessRole('sale')
      .then(res => {
        if (!alive) return;
        const rows = res.success ? res.data || [] : [];
        setSaleOptions([...rows].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (alive) setSaleOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`${API_BASE_URL}/api/all-platform/crm/leads/classification-rules`, { credentials: 'include', headers: headers() })
      .then(res => res.json())
      .then(body => {
        if (!alive || body.success === false) return;
        setRuleConditions((body.data?.conditions as Record<string, boolean>) || null);
      })
      .catch(() => {
        // Im lang - khong co rule thi giu hanh vi cu (SDR tu chon tay), khong
        // chan luong xac minh chinh vi 1 API phu khong tai duoc.
      });
    return () => { alive = false; };
  }, [open]);

  // Tu dong tinh "Kết quả xác minh" theo dung rule Admin da cau hinh
  // (evaluateLeadConditions, mirror JS cua backend) - LUON chay lai moi khi
  // form doi, KHONG co co che tam dung/override nao nua (feedback leader:
  // "User khong duoc tu chon/override ket qua Lead").
  useEffect(() => {
    if (!ruleConditions) return;
    const fields: LeadRuleFields = {
      has_product: Boolean(form.interest.trim()),
      has_interest_level: Boolean(form.interestLevel),
      has_value: form.estimatedValue != null,
      has_team: Boolean(form.aeId),
      has_next: Boolean(form.nextStep.trim()),
      has_follow: Boolean(form.nextStepAt),
      has_contact: Boolean(contact.phone.trim() || contact.email.trim()),
      fit_unfit: form.icpFit === 'unfit',
      fit_known: form.icpFit !== 'unknown',
    };
    const computed = evaluateLeadConditions(fields, ruleConditions);
    setVerificationOutcome(computed.outcome);
    setOutcomeReasons(computed.reasons);
    setOutcomeMissing(computed.missing);
    setSqlProgress({ ok: computed.sqlOk, total: computed.sqlTotal });
  }, [
    ruleConditions, form.interest, form.interestLevel, form.estimatedValue,
    form.aeId, form.nextStep, form.nextStepAt, form.icpFit, contact.phone, contact.email,
  ]);

  const aeOptions = useMemo(
    () => saleOptions.map(user => ({ value: user.id, label: user.name })),
    [saleOptions],
  );
  const aeName = (id?: string) => {
    if (!id) return 'Chưa gán';
    if (id === currentUser?.id) return currentUser?.name || currentUser?.email || 'Bạn';
    return saleOptions.find(user => user.id === id)?.name || 'Chưa gán';
  };

  // ---- Mức sẵn sàng Convert: tính hoàn toàn client-side từ 5 điều kiện thật.
  const checks = useMemo(() => {
    const nextStepOk = Boolean(form.nextStep.trim()) && Boolean(form.nextStepAt);
    return [
      { key: 'need', label: 'Nhu cầu đã xác định', ok: Boolean(form.interest.trim()) },
      { key: 'icp', label: 'ICP đã xác định', ok: form.icpFit !== 'unknown' },
      { key: 'next', label: 'Việc tiếp theo đã có', ok: nextStepOk },
      { key: 'dup', label: 'Doanh nghiệp đã được check trùng', ok: dupChecked },
      { key: 'ae', label: 'Sale nhận bàn giao đã chọn', ok: Boolean(form.aeId) },
    ];
  }, [form, dupChecked]);

  const okCount = checks.filter(c => c.ok).length;
  const missingChecks = checks.filter(c => !c.ok);
  const isReady = okCount === checks.length;
  const readinessLabel = isReady ? 'Sẵn sàng tạo cơ hội' : okCount >= 3 ? 'Cần xác minh thêm' : 'Chưa sẵn sàng';
  const readinessTone = isReady ? 'ready' : okCount >= 3 ? 'partial' : 'blocked';

  const nextStepWarning = verificationOutcome === 'sql' && (Boolean(form.nextStep.trim()) !== Boolean(form.nextStepAt) || (!form.nextStep.trim() && !form.nextStepAt));

  // Nhảy tới phần liên quan nhất với trạng thái Lead lúc mở drawer.
  useEffect(() => {
    if (!open || !lead) return;
    if (initialMode !== 'convert' && lead.status !== 'sql' && lead.status !== 'qualified') return;
    const timer = window.setTimeout(() => {
      readinessRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, lead, initialMode]);

  if (!open || !lead) return null;
  const canWrite = Boolean(lead.canWrite);
  const isConverted = lead.status === 'sql' || lead.status === 'converted';
  const displayScore = form.score ?? lead.score ?? null;

  /** "Dùng gợi ý" — suy ra giá trị từ CHÍNH dữ liệu Lead đang có (ghi chú,
   * nguồn, công ty). Đây là gợi ý theo quy tắc, KHÔNG phải AI: khối này không
   * gọi model nào cả nên không được (và không) nói là "AI đã gợi ý". Chỉ điền
   * vào ô đang trống — không bao giờ ghi đè thứ SDR đã nhập, và không bịa ra
   * thông tin không có trong Lead. */
  function applySuggestion() {
    const haystack = `${lead?.note || ''} ${lead?.qualificationNeed || ''} ${lead?.source || ''}`.toLowerCase();
    setForm(prev => {
      const next = { ...prev };
      if (!next.interest.trim() && lead?.qualificationNeed) next.interest = lead.qualificationNeed;
      if (next.icpFit === 'unknown' && lead?.companyName) next.icpFit = 'fit';
      if (!next.timeline) {
        if (/(gấp|ngay|asap|luôn)/.test(haystack)) next.timeline = 'Ngay';
        else if (/(tháng này|trong tháng|1 tháng)/.test(haystack)) next.timeline = 'Trong 1 tháng';
        else if (/(quý|3 tháng)/.test(haystack)) next.timeline = '1-3 tháng';
      }
      if (next.estimatedValue == null) {
        const money = (lead?.note || '').match(/(\d[\d.,]{5,})/);
        if (money) next.estimatedValue = parseMoney(money[1]);
      }
      if (!next.nextStep.trim()) next.nextStep = lead?.phone ? 'Gọi lại' : 'Gửi tài liệu';
      if (!next.nextStepAt) {
        const when = new Date();
        when.setDate(when.getDate() + 1);
        when.setHours(9, 0, 0, 0);
        next.nextStepAt = toDatetimeLocal(when.toISOString());
      }
      if (!next.interestLevel && next.score == null) {
        next.interestLevel = 'need';
        next.score = 55;
      }
      if (!next.aeId) next.aeId = lead?.qualificationAeId || lead?.sdrId || currentUser?.id || '';
      return next;
    });
    setSuggestionUsed(true);
  }

  function resetSuggestion() {
    if (!lead) return;
    setForm({
      interest: lead.qualificationNeed || '',
      interestLevel: interestLevelFromScore(lead.score),
      score: lead.score ?? null,
      icpFit: icpFromApi(lead.qualificationIcpFit),
      timeline: lead.qualificationExpectedTimeline || '',
      estimatedValue: lead.qualificationEstimatedValue ?? null,
      nextStep: lead.nextStep || '',
      nextStepAt: toDatetimeLocal(lead.followUpDate),
      aeId: lead.qualificationAeId || '',
      note: lead.note || '',
      followUpChannel: '',
      dealStage: 'dealing',
      project: '',
    });
    setSuggestionUsed(false);
  }

  function setInterestLevel(value: InterestLevel) {
    const option = INTEREST_LEVEL_OPTIONS.find(item => item.value === value);
    setForm(prev => ({
      ...prev,
      interestLevel: value,
      score: option?.score ?? prev.score,
    }));
  }

  function buildQualificationPayload(): Record<string, unknown> {
    return {
      score: form.score ?? null,
      qualification_need: form.interest.trim() || null,
      qualification_icp_fit: icpToApi(form.icpFit),
      qualification_estimated_value: form.estimatedValue ?? null,
      qualification_expected_timeline: form.timeline || null,
      qualification_ae_id: form.aeId || null,
      next_step: form.nextStep.trim() || null,
      follow_up_date: form.nextStepAt ? new Date(form.nextStepAt).toISOString() : null,
      note: form.note.trim() || null,
    };
  }

  function noteWithVerification(prefix: string, reason?: string) {
    const details = [prefix, reason ? `Lý do: ${reason}` : '', form.note.trim()].filter(Boolean);
    return details.join('\n');
  }

  /** Lưu xác minh — PUT thường, TUYỆT ĐỐI không tạo Customer/Contact/Deal.
   * `status` chỉ đi lên theo đúng mức đã xác minh được (new_lead -> qualifying,
   * và chỉ lên 'qualified' khi checklist thật sự đủ 5/5) — thay cho nút "Đủ
   * điều kiện" cũ vốn bật qualified mà không kiểm tra gì. */
  async function saveVerification(overrideStatus?: string) {
    if (!lead) return false;
    if (!overrideStatus && form.nextStep.trim() && !form.nextStepAt) {
      setError('Đã chọn "Việc tiếp theo" thì phải chọn "Khi nào làm".');
      return false;
    }
    setSaving(true);
    setError('');
    setSavedOk('');
    try {
      const payload: Record<string, unknown> = overrideStatus
        ? { ...buildQualificationPayload(), status: overrideStatus }
        : buildQualificationPayload();
      if (!overrideStatus && (lead.status === 'mql' || lead.status === 'new_lead' || lead.status === 'qualifying')) payload.status = 'mql';
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không lưu được thông tin xác minh.');
      onSaved(mapLead(body.data));
      setSavedOk(overrideStatus ? 'Đã chốt kết quả xác minh.' : 'Đã lưu xác minh. Chưa tạo Cơ hội/Khách hàng nào.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được thông tin xác minh.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitNurturing() {
    if (!nurtureReason.trim()) {
      setError('Nuôi dưỡng cần chọn lý do nuôi dưỡng.');
      return;
    }
    if (!form.nextStepAt) {
      setError('Nuôi dưỡng cần chọn ngày chăm sóc lại.');
      return;
    }
    const payload = buildQualificationPayload();
    payload.status = 'nurturing';
    payload.next_step = nurtureReason.trim();
    payload.note = noteWithVerification(
      'Kết quả xác minh: Nuôi dưỡng',
      [nurtureReason.trim(), form.followUpChannel ? `Kênh chăm sóc: ${form.followUpChannel}` : ''].filter(Boolean).join('\n'),
    );
    await saveVerificationWithPayload(payload, 'Đã lưu Lead vào Nuôi dưỡng.');
  }

  async function submitUnqualified() {
    if (!unqualifiedReason) {
      setError('Vui lòng chọn lý do Không đạt chuẩn.');
      return;
    }
    const payload = buildQualificationPayload();
    payload.status = 'unqualified';
    payload.note = noteWithVerification('Kết quả xác minh: Không đạt chuẩn', unqualifiedReason);
    await saveVerificationWithPayload(payload, 'Đã xác nhận Lead Không đạt chuẩn.');
  }

  async function saveVerificationWithPayload(payload: Record<string, unknown>, okMessage: string) {
    if (!lead) return false;
    setSaving(true);
    setError('');
    setSavedOk('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không lưu được kết quả xác minh.');
      onSaved(mapLead(body.data));
      setSavedOk(okMessage);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được kết quả xác minh.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleConvert() {
    if (!lead || converting) return;
    setConverting(true);
    setConvertError('');
    try {
      const dealPayload: Record<string, unknown> = {};
      dealPayload.deal_stage = form.dealStage || 'dealing';
      if (form.aeId) dealPayload.sdr_id = form.aeId;
      if (form.nextStep.trim()) dealPayload.next_step = form.nextStep.trim();
      if (form.nextStepAt) dealPayload.follow_up_date = new Date(form.nextStepAt).toISOString();
      if (form.estimatedValue != null) dealPayload.estimated_budget = form.estimatedValue;
      // "Dự án" (feedback leader) - go TEN moi, backend tu tao Project that
      // sau khi convert xong (xem crm_lead_service.convert_lead(), migration
      // 153). Man Xac minh Lead chua co ProjectPicker chon Du an co san.
      if (form.project.trim()) dealPayload.project_name = form.project.trim();

      const payload: Record<string, unknown> = {
        deal: dealPayload,
        update_customer: false,
        idempotency_key: idempotencyKeyRef.current,
        contact: {
          name: contact.name.trim() || lead.leadName,
          phone: contact.phone.trim() || null,
          email: contact.email.trim() || null,
          position_category_id: contact.positionCategoryId || null,
          is_primary: true,
        },
      };
      if (customerChoice === 'new') {
        payload.customer = {
          // BUG THAT DA GAP: truoc day luon dung lead.leadName (ten CA NHAN)
          // lam customer_name - Khach hang (crm_customers) la TO CHUC/CONG TY
          // trong mo hinh B2B nay (company_name la field rieng, contact.name
          // moi la nguoi), nen tieu de Khach hang (CrmCustomerDetailPage/
          // CrmCustomersDirectory deu hien thi customer_name lam <h1> chinh)
          // bi doi lot thanh ten nguoi. Uu tien company_name neu Lead co cong
          // ty - dung CHINH pattern fallback da dung san o hien thi dropdown
          // "Doanh nghiep" ngay ben duoi (dong ~624/632: lead.companyName ||
          // lead.leadName) - chi Lead ca nhan/khong co cong ty moi fallback
          // ve leadName (customer_name NOT NULL, khong the de rong).
          customer_name: lead.companyName || lead.leadName,
          company_name: lead.companyName || null,
          position_category_id: lead.positionCategoryId || null,
          phone: lead.phone || null,
          email: lead.email || null,
          zalo: lead.zalo || null,
          facebook: lead.facebook || null,
          telegram: lead.telegram || null,
          website: lead.website || null,
          source: lead.source || null,
        };
      } else {
        payload.customer_id = customerChoice;
      }

      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}/convert`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Tạo cơ hội thất bại.');
      const result = body.data || {};
      const newCustomerId = result.customer?.id || result.customer_id || '';
      onSaved({
        ...lead,
        status: 'sql',
        convertedCustomerId: newCustomerId,
        convertedContactId: result.contact?.id || result.contact_id || '',
        convertedDealId: result.deal?.id || result.deal_id || '',
      });
      setConvertOpen(false);
      // Feedback 2026-09-26: "xác minh lead xong thì tự trỏ về đúng trang chi
      // tiết khách hàng" - truoc day chi hien man "Da tao co hoi" tinh, phai
      // tu bam link "Xem Khách hàng" moi qua duoc. Dong drawer + dieu huong
      // thang, khong can cho user bam them.
      if (newCustomerId) {
        onClose();
        router.push(`/all-platform/crm/customers/${newCustomerId}?tab=deals`);
      }
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Tạo cơ hội thất bại.');
    } finally {
      setConverting(false);
    }
  }

  /** Lưu xác minh trước rồi mới mở bước xác nhận Convert (giữ nguyên bước xác
   * nhận cũ, không dựng lại) — để dữ liệu vừa nhập chắc chắn đã nằm trên lead
   * trước khi RPC đọc nó. */
  async function openConvertConfirm() {
    if (!isReady) {
      setError('SQL cần hoàn thành đủ Mức sẵn sàng tạo cơ hội.');
      readinessRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (!form.aeId) {
      setError('SQL bắt buộc chọn Sale nhận bàn giao.');
      return;
    }
    const ok = await saveVerification();
    if (ok) setConvertOpen(true);
  }

  async function submitFinalOutcome() {
    // 'pending' = chua du du lieu de he thong ket luan - nut submit da bi
    // disable o footer, day chi la guard phong thu (khong duoc rot vao
    // nhanh Khong dat chuan mac dinh nhu truoc khi tach rieng 'pending').
    if (verificationOutcome === 'pending') return;
    if (verificationOutcome === 'sql') {
      await openConvertConfirm();
      return;
    }
    if (verificationOutcome === 'nurturing') {
      await submitNurturing();
      return;
    }
    await submitUnqualified();
  }

  const finalSubmitLabel =
    verificationOutcome === 'sql'
      ? 'Tạo cơ hội & bàn giao Sale'
      : verificationOutcome === 'nurturing'
        ? 'Lưu vào Nuôi dưỡng'
        : verificationOutcome === 'unqualified'
          ? 'Xác nhận không đạt chuẩn'
          : 'Chưa đủ dữ liệu để lưu kết quả';

  // "Tóm tắt quyết định" — cot phai KHONG con la checklist ky thuat (chi
  // dung/sai) ma hien gia tri that de SDR/Sale ra quyet dinh nhanh, dung thu
  // tu da chot: Nhu cau -> Gia tri -> ICP -> Thoi gian trien khai -> Viec tiep
  // theo -> Sale nhan ban giao -> Check trung.
  const decisionRows = [
    { key: 'need', label: 'Nhu cầu', value: form.interest.trim() || '—', ok: Boolean(form.interest.trim()) },
    {
      key: 'value',
      label: 'Giá trị ước tính',
      value: form.estimatedValue != null ? (formatVND(form.estimatedValue) || String(form.estimatedValue)) : '—',
      ok: form.estimatedValue != null,
    },
    {
      key: 'icp',
      label: 'ICP',
      value: ICP_OPTIONS.find(o => o.value === form.icpFit)?.label || '—',
      ok: form.icpFit !== 'unknown',
    },
    { key: 'timeline', label: 'Thời gian triển khai', value: form.timeline || '—', ok: Boolean(form.timeline) },
    {
      key: 'next',
      label: 'Việc tiếp theo',
      value: form.nextStep.trim()
        ? `${form.nextStep}${form.nextStepAt ? ' · ' + new Date(form.nextStepAt).toLocaleString('vi-VN') : ''}`
        : '—',
      ok: Boolean(form.nextStep.trim()) && Boolean(form.nextStepAt),
    },
    { key: 'ae', label: 'Sale nhận bàn giao', value: form.aeId ? aeName(form.aeId) : '—', ok: Boolean(form.aeId) },
    { key: 'stage', label: 'Giai đoạn', value: DEAL_STAGE_META[form.dealStage as keyof typeof DEAL_STAGE_META]?.label || form.dealStage, ok: true },
    {
      key: 'dup',
      label: 'Check trùng doanh nghiệp',
      value: dupChecked ? (companyMatches.length ? `${companyMatches.length} khả năng trùng` : 'Không trùng') : 'Chưa kiểm tra',
      ok: dupChecked,
    },
  ];

  const selectedMatch = companyMatches.find(m => m.id === customerChoice);
  return (
    <>
      {/* Click vao backdrop de dong drawer; click trong form khong bi anh huong. */}
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={onClose} />
      <aside className="crm-drawer crm-lead-detail-drawer crm-verify-drawer">
        <header className="crm-lead-drawer-header crm-verify-header">
          <div className="crm-verify-header-text">
            <h2>
              Xác minh Lead
              <span
                className="crm-help-icon"
                tabIndex={0}
                title="SDR chỉ cần xác nhận vài thông tin then chốt. Hệ thống tự chấm điểm Lead và dùng nội dung trao đổi, nguồn Lead, thông tin doanh nghiệp để gợi ý nhu cầu, mức phù hợp, giá trị và việc tiếp theo."
              >
                <HelpCircle className="crm-icon" />
              </span>
            </h2>
          </div>
          <div className="crm-lead-drawer-header-actions">
            {onEdit ? (
              <button
                type="button"
                className="crm-secondary-button crm-button-sm"
                data-testid="lead-detail-edit"
                onClick={() => onEdit(lead)}
              >
                Chỉnh sửa
              </button>
            ) : null}
            <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
              <X className="crm-icon" />
            </button>
          </div>
        </header>

        <div className="crm-drawer-body crm-lead-drawer-body crm-verify-body" ref={bodyRef}>
          {error ? <p className="crm-error">{error}</p> : null}
          {savedOk ? <p className="crm-verify-ok">{savedOk}</p> : null}

          <section className="crm-verify-summary">
            <span className="crm-verify-avatar" aria-hidden>{initialOf(lead.leadName)}</span>
            <div className="crm-verify-summary-main">
              <p className="crm-verify-name">{lead.leadName}</p>
              <p className="crm-verify-sub">
                {[lead.positionLabelSnapshot || lead.position, lead.companyName].filter(Boolean).join(' · ') || 'Chưa có chức vụ/công ty'}
              </p>
              <p className="crm-verify-sub">
                {lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : <span>Chưa có SĐT</span>}
                <span className="crm-verify-dot">·</span>
                {lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span>Chưa có email</span>}
              </p>
              <p className="crm-verify-sub">Công ty: {lead.companyName || 'Chưa có'} <span className="crm-verify-dot">·</span> SDR: {aeName(lead.sdrId)}</p>
            </div>
            <div className="crm-verify-score">
              <b>{displayScore == null ? '—' : displayScore}</b>
              <span>ĐIỂM LEAD</span>
            </div>
          </section>

          {isConverted ? (
            <section className="crm-terminal-note crm-terminal-note--won">
              <CheckCircle2 className="crm-line-icon" />
              <div>
                <strong>Lead đã được tạo cơ hội.</strong>
                {lead.convertedCustomerId ? (
                  <p><Link href={`/all-platform/crm/customers/${lead.convertedCustomerId}`} target="_blank">Xem Khách hàng</Link></p>
                ) : null}
              </div>
            </section>
          ) : convertOpen ? (
            <section className="crm-form-section crm-lead-convert-section" id="crm-lead-convert">
              <p className="crm-form-title">Xác nhận tạo cơ hội &amp; bàn giao Sale</p>
              <div className="crm-lead-convert-confirm">
                {convertError ? <p className="crm-error">{convertError}</p> : null}
                <div className="crm-lead-convert-row">
                  <b>Doanh nghiệp:</b>
                  {companyMatches.length ? (
                    <select value={customerChoice} onChange={e => setCustomerChoice(e.target.value)}>
                      <option value="new">Tạo doanh nghiệp mới ({lead.companyName || lead.leadName})</option>
                      {companyMatches.map(match => (
                        <option key={match.id} value={match.id}>
                          Liên kết: {match.customer_name || match.company_name} ({match.match_reason})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>Tạo doanh nghiệp mới — {lead.companyName || lead.leadName}</span>
                  )}
                </div>
                {selectedMatch ? <p className="crm-ai-fill-hint">Deal/Customer sẽ gắn vào hồ sơ đã có, không tạo trùng.</p> : null}

                <div className="crm-lead-convert-row crm-lead-convert-contact">
                  <b>Contact (tạo mới, có thể sửa):</b>
                  <div className="crm-form-grid">
                    <Field label="Tên"><input value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} /></Field>
                    <Field label="Chức vụ">
                      <PositionSelect
                        value={contact.positionCategoryId}
                        labelSnapshot={contact.positionLabel}
                        onChange={(id, label) => setContact(c => ({ ...c, positionCategoryId: id, positionLabel: label }))}
                      />
                    </Field>
                    <Field label="SĐT"><input value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} /></Field>
                    <Field label="Email"><input value={contact.email} onChange={e => setContact(c => ({ ...c, email: e.target.value }))} /></Field>
                  </div>
                </div>

                <div className="crm-lead-convert-summary">
                  <b>Deal sẽ được tạo với:</b>
                  <ul>
                    <li>Sale nhận bàn giao: {aeName(form.aeId || lead.sdrId)}</li>
                    <li>Người liên hệ: {contact.name || lead.leadName}</li>
                    <li>Giai đoạn: {DEAL_STAGE_META[form.dealStage as keyof typeof DEAL_STAGE_META]?.label || form.dealStage}</li>
                    <li>Nhu cầu: {form.interest || 'Chưa có'}</li>
                    <li>Giá trị dự kiến: {form.estimatedValue != null ? (formatVND(form.estimatedValue) || String(form.estimatedValue)) : 'Chưa có'}</li>
                    <li>Việc tiếp theo: {form.nextStep || 'Chưa có'}</li>
                    <li>Khi nào làm: {form.nextStepAt ? new Date(form.nextStepAt).toLocaleString('vi-VN') : 'Chưa có'}</li>
                  </ul>
                </div>

                <div className="crm-lead-qualification-actions">
                  <button type="button" className="crm-secondary-button" disabled={converting} onClick={() => setConvertOpen(false)}>
                    Quay lại
                  </button>
                  <button type="button" className="crm-primary-button" disabled={converting} onClick={() => void handleConvert()}>
                    {converting ? <Loader2 className="crm-save-spinner" /> : null} Xác nhận tạo cơ hội
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="crm-verify-suggest">
                <div className="crm-verify-suggest-head">
                  <p className="crm-form-title">
                    Gợi ý từ dữ liệu Lead
                    <span
                      className="crm-help-icon"
                      tabIndex={0}
                      title="Gợi ý theo quy tắc từ ghi chú, nguồn Lead và công ty đang có — không phải AI. Chỉ điền vào ô đang trống, không ghi đè dữ liệu SDR đã nhập."
                    >
                      <HelpCircle className="crm-icon" />
                    </span>
                  </p>
                  <span className={`crm-verify-suggest-pill ${suggestionUsed ? 'is-used' : ''}`}>
                    {suggestionUsed ? 'Đã dùng gợi ý' : 'Chưa dùng gợi ý'}
                  </span>
                </div>
                <div className="crm-verify-suggest-actions">
                  <button type="button" className="crm-secondary-button" disabled={!canWrite} onClick={applySuggestion}>
                    Dùng gợi ý
                  </button>
                  <button type="button" className="crm-ghost-button" disabled={!canWrite} onClick={resetSuggestion}>
                    Đặt lại
                  </button>
                </div>
              </section>

              <div className="crm-verify-kpi-strip">
                <div><span>Nguồn Lead</span><b>{lead.source || 'Manual'}</b></div>
                <div><span>Trạng thái</span><b>{lead.status || 'MQL'}</b></div>
                <div><span>Owner</span><b>{aeName(lead.sdrId)}</b></div>
                <div><span>Gợi ý</span><b>{suggestionUsed ? 'Đã dùng' : 'Chưa dùng'}</b></div>
              </div>

              <div className="crm-verify-compact-grid">
                <section className="crm-form-section crm-verify-section crm-verify-panel" id="crm-verify-quick">
                  <p className="crm-form-title">Thông tin then chốt</p>
                  {/* Thu tu + ghep cap da chot (feedback WIP xac minh Lead,
                   * "Layout đã thống nhất"): Giá trị dự kiến | Mức độ quan
                   * tâm, roi Dự kiến triển khai | ICP - "Mức độ quan tâm" va
                   * "Ghi chú" chuyen tu panel "Kết quả xác minh & bàn giao"
                   * len day cho dung nhom "thong tin ve nhu cau Lead". */}
                  <div className="crm-verify-compact-fields">
                    <Field label="Khách đang quan tâm gì?" hint="Chọn từ danh mục Sản phẩm/Dịch vụ.">
                      <CrmCategorySelect
                        categoryType="crm_service_package"
                        value={form.interest}
                        disabled={!canWrite}
                        placeholder="-- Chọn sản phẩm/dịch vụ --"
                        onChange={label => setField('interest', label)}
                      />
                    </Field>
                    <>
                      <Field label="Giá trị ước tính (VND)" hint="Tự thêm dấu chấm ngăn nghìn khi gõ.">
                        <CurrencyInput
                          disabled={!canWrite}
                          value={form.estimatedValue}
                          onChange={value => setField('estimatedValue', value)}
                          placeholder="VD: 50.000.000"
                        />
                      </Field>
                      <div className="crm-verify-interest-level">
                        <span>Mức độ quan tâm</span>
                        <div className="crm-verify-interest-level-chips">
                          {INTEREST_LEVEL_OPTIONS.map(option => (
                            <button
                              key={option.value}
                              type="button"
                              className={`crm-verify-interest-level-chip ${form.interestLevel === option.value ? 'is-selected' : ''}`}
                              disabled={!canWrite}
                              onClick={() => setInterestLevel(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                    <div className="crm-inline-pair">
                      <Field label="Dự kiến triển khai">
                        <CrmCategorySelect
                          categoryType="crm_expected_timeline"
                          value={form.timeline}
                          disabled={!canWrite}
                          placeholder="-- Chọn thời gian --"
                          onChange={label => setField('timeline', label)}
                        />
                      </Field>
                      <Field label="Đúng nhóm khách hàng?" hint="ICP.">
                        <select disabled={!canWrite} value={form.icpFit} onChange={e => setField('icpFit', e.target.value as IcpFit)}>
                          {ICP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field label="Dự án" hint="tùy chọn">
                      <input
                        disabled={!canWrite}
                        value={form.project}
                        onChange={e => setField('project', e.target.value)}
                        placeholder="VD: Website 2026"
                      />
                    </Field>
                    <Field label="Ghi chú ngắn">
                      <input disabled={!canWrite} value={form.note} onChange={e => setField('note', e.target.value)} placeholder="VD: khách đang so sánh 2 nhà cung cấp" />
                    </Field>
                  </div>
                </section>

                <section className="crm-form-section crm-verify-section crm-verify-panel" id="crm-verify-handoff">
                  {/* Feedback leader: KHONG con if/else theo outcome de an/hien
                   * form nghiep vu ("if outcome===SQL thi hien form SQL...").
                   * 5 field Ban giao Sale LUON hien thi, bat ke Ket qua Lead
                   * dang la gi - dung layout da chot (feedback WIP full-flow,
                   * muc E.2 "Bàn giao Sale"): Team Sale | Người liên hệ, Việc
                   * tiếp theo | Hạn follow-up, Giai đoạn. */}
                  <p className="crm-form-title">Bàn giao Sale</p>
                  <div className="crm-verify-compact-fields">
                    <div className="crm-inline-pair">
                      <Field label="Sale nhận bàn giao" required>
                        <SearchableSelect disabled={!canWrite} value={form.aeId} onChange={value => setField('aeId', value)} options={aeOptions} placeholder="-- Chưa chọn --" />
                      </Field>
                      <Field label="Người liên hệ">
                        <input
                          disabled={!canWrite}
                          value={contact.name}
                          onChange={e => setContact(c => ({ ...c, name: e.target.value }))}
                          placeholder="Tên người liên hệ"
                        />
                      </Field>
                    </div>
                    <div className="crm-inline-pair">
                      <Field label="Việc tiếp theo" required>
                        <CrmCategorySelect
                          categoryType="crm_next_step"
                          value={form.nextStep}
                          disabled={!canWrite}
                          placeholder="-- Chọn việc tiếp theo --"
                          excludeLabels={['Khác']}
                          onChange={label => setField('nextStep', label)}
                        />
                      </Field>
                      <Field label="Hạn follow-up" required>
                        <input disabled={!canWrite} type="datetime-local" value={form.nextStepAt} onChange={e => setField('nextStepAt', e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Giai đoạn" required>
                      <select disabled={!canWrite} value={form.dealStage} onChange={e => setField('dealStage', e.target.value)}>
                        {DEAL_STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                  </div>

                  {/* 2 field nay KHONG phai input cua rule engine (khong anh
                   * huong SQL/Nuoi duong/Khong dat) - la ghi chu SDR bo sung
                   * SAU KHI he thong da ket luan, chi hien khi lien quan tru
                   * tiep toi ket qua hien tai de tranh nhoi field khong dung
                   * luc (KHAC voi 5 field Ban giao Sale phia tren, luon hien). */}
                  {verificationOutcome === 'nurturing' ? (
                    <div className="crm-verify-compact-fields" style={{ marginTop: '0.7rem' }}>
                      <Field label="Lý do nuôi dưỡng" required>
                        <CrmCategorySelect categoryType="crm_nurture_reason" value={nurtureReason} disabled={!canWrite} placeholder="-- Chọn lý do --" onChange={setNurtureReason} />
                      </Field>
                      <Field label="Ngày chăm sóc lại" required>
                        <input disabled={!canWrite} type="datetime-local" value={form.nextStepAt} onChange={e => setField('nextStepAt', e.target.value)} />
                      </Field>
                      <Field label="Kênh chăm sóc">
                        <CrmCategorySelect categoryType="crm_follow_up_channel" value={form.followUpChannel} disabled={!canWrite} placeholder="-- Không chọn --" onChange={label => setField('followUpChannel', label)} />
                      </Field>
                    </div>
                  ) : null}

                  {verificationOutcome === 'unqualified' ? (
                    <div className="crm-verify-compact-fields" style={{ marginTop: '0.7rem' }}>
                      <Field label="Lý do không đạt chuẩn" required>
                        <CrmCategorySelect categoryType="crm_unqualified_reason" value={unqualifiedReason} disabled={!canWrite} placeholder="-- Chọn lý do --" onChange={setUnqualifiedReason} />
                      </Field>
                    </div>
                  ) : null}

                  {/* KẾT QUẢ LEAD - output card, KHONG phai input. He thong tu
                   * tinh (evaluateLeadConditions), SDR khong bam chon duoc. */}
                  <div className="crm-verify-handoff-extra crm-verify-interest-level">
                    <span>Kết quả Lead</span>
                    <div className={`crm-verify-outcome-card crm-verify-outcome-card--${verificationOutcome}`} role="status" aria-live="polite">
                      <div className="crm-verify-outcome-head">
                        <span className="crm-verify-outcome-dot" />
                        {verificationOutcome === 'sql' && 'Đạt chuẩn — SQL'}
                        {verificationOutcome === 'nurturing' && 'Nuôi dưỡng'}
                        {verificationOutcome === 'unqualified' && 'Không đạt chuẩn'}
                        {verificationOutcome === 'pending' && 'Chưa đủ dữ liệu'}
                      </div>

                      {verificationOutcome === 'sql' ? (
                        <p className="crm-verify-outcome-sub">Đã đủ điều kiện tạo cơ hội và bàn giao Sale.</p>
                      ) : null}

                      {verificationOutcome === 'pending' && outcomeMissing.length ? (
                        <>
                          <p className="crm-verify-outcome-list-title">Còn thiếu:</p>
                          <ul className="crm-verify-outcome-list">
                            {outcomeMissing.map(m => <li key={m}>{m}</li>)}
                          </ul>
                        </>
                      ) : null}

                      {(verificationOutcome === 'nurturing' || verificationOutcome === 'unqualified') && outcomeReasons.length ? (
                        <>
                          <p className="crm-verify-outcome-list-title">Lý do:</p>
                          <ul className="crm-verify-outcome-list">
                            {outcomeReasons.map(r => <li key={r}>{r}</li>)}
                          </ul>
                        </>
                      ) : null}

                      {ruleConditions ? (
                        <p className="crm-verify-outcome-progress">{sqlProgress.ok}/{sqlProgress.total} điều kiện SQL</p>
                      ) : null}
                    </div>
                  </div>

                  {nextStepWarning ? (
                    <p className="crm-verify-warning">
                      <AlertTriangle className="crm-line-icon" />
                      Deal không nên được tạo nếu chưa có Việc tiếp theo.
                    </p>
                  ) : null}
                </section>

                <section className="crm-form-section crm-verify-section crm-verify-panel crm-verify-readiness-panel" id="crm-verify-readiness" ref={readinessRef}>
                  <div className="crm-verify-suggest-head">
                    <p className="crm-form-title">Tóm tắt quyết định</p>
                    <span className={`crm-verify-readiness-pill crm-verify-readiness-pill--${readinessTone}`}>{readinessLabel}</span>
                  </div>
                  <ul className="crm-verify-checklist">
                    {decisionRows.map(row => (
                      <li key={row.key} className={row.ok ? 'is-ok' : ''}>
                        {row.ok ? <CheckCircle2 className="crm-line-icon" /> : <XCircle className="crm-line-icon" />}
                        <span>{row.label}</span>
                        <b className="crm-verify-check-value">{row.value}</b>
                      </li>
                    ))}
                  </ul>
                  {companyMatches.length ? (
                    <p className="crm-ai-fill-hint">
                      Tìm thấy {companyMatches.length} doanh nghiệp có thể trùng — chọn liên kết ở bước xác nhận thay vì tạo mới.
                    </p>
                  ) : null}
                  <div className="crm-verify-readiness-summary">
                    <div>
                      <span>Đã đạt</span>
                      <b>{okCount}/{checks.length} tiêu chí</b>
                    </div>
                    <div>
                      <span>Trạng thái</span>
                      <b>{readinessLabel}</b>
                    </div>
                    {missingChecks.length ? (
                      <p>Còn thiếu: {missingChecks.map(check => check.label).join(', ')}</p>
                    ) : (
                      <p>Đủ điều kiện để tạo cơ hội và bàn giao Sale.</p>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>

        {!isConverted && canWrite && !convertOpen ? (
          <footer className="crm-drawer-footer crm-verify-footer">
            <div className="crm-footer-actions">
              <button type="button" className="crm-secondary-button" disabled={saving} onClick={() => void saveVerification()}>
                {saving ? <Loader2 className="crm-save-spinner" /> : null} Lưu nháp
              </button>
              <button
                type="button"
                className="crm-primary-button"
                disabled={saving || verificationOutcome === 'pending'}
                title={
                  verificationOutcome === 'pending'
                    ? 'Hệ thống chưa đủ dữ liệu để phân loại Lead này — bổ sung thêm thông tin bên trên.'
                    : verificationOutcome === 'sql' && !isReady
                      ? 'Hoàn tất checklist "Mức sẵn sàng tạo cơ hội" trước'
                      : undefined
                }
                onClick={() => void submitFinalOutcome()}
              >
                {finalSubmitLabel}
              </button>
            </div>
          </footer>
        ) : null}
      </aside>
    </>
  );
}

function Field({
  label,
  full,
  hint,
  required,
  children,
}: {
  label: string;
  full?: boolean;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`crm-field ${full ? 'crm-field--full' : ''}`}>
      <span>{label}{required ? ' *' : ''}</span>
      {children}
      {hint ? <small className="crm-verify-hint">{hint}</small> : null}
    </label>
  );
}
