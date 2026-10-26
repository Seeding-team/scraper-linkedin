'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CurrencyInput } from '@/components/CurrencyInput';
import { formatVND, DEAL_STAGE_META, PIPELINE_COLUMNS } from '../constants/crmConfig';
import { CrmCategorySelect } from './CrmCategorySelect';
import { CrmProductMultiSelect } from './CrmProductMultiSelect';
import { SearchableSelect, type SelectAction } from './SearchableSelect';
import { AlertTriangle, CheckCircle2, XCircle } from './icons';
import {
  INTEREST_LEVEL_OPTIONS,
  type InterestLevel,
  type VerificationOutcome,
} from '../utils/leadQualificationRules';

/** "Giai đoạn" cho Deal sap tao (feedback WIP full-flow, mucE.2 "Bàn giao
 * Sale": layout `Giai đoạn | Kết quả Lead`) - chi cho chon trong cac stage
 * PIPELINE THAT (khong gom on_hold/lost, khong hop ly cho 1 co hoi vua tao).
 * TRUOC DAY doc Object.keys(DEAL_STAGE_META) - object nay con giu 6 key cu
 * (new_lead/contacted/qualified/contract_sent/won...) trung nhan voi cac stage
 * hien hanh (vd "Đang deal" x4, "Lên Proposal" x2) de tuong thich nguoc du
 * lieu cu, lam dropdown hien trung lap (bug "giai đoạn bị lặp"). PIPELINE_COLUMNS
 * da la danh sach DUNG 10 stage that, khong trung, dung thu tu, dung tinh than
 * comment ben tren tu truoc gio. */
const DEAL_STAGE_OPTIONS = PIPELINE_COLUMNS.map(stage => ({
  value: stage,
  label: DEAL_STAGE_META[stage]?.label || stage,
}));

/** Combobox "Dự án" dùng chung UX với ProjectPicker (DealFormFields.tsx) -
 * cùng class CSS `crm-customer-combobox`/`crm-customer-combobox-menu` để
 * đồng bộ giao diện, nhưng KHÔNG tự fetch (nhận `options` làm prop, giữ đúng
 * nguyên tắc "component này chỉ nhận input/callback" của cả panel). */
function ProjectComboField({
  value,
  options,
  disabled,
  onPick,
  onTypeNew,
}: {
  value: string;
  options: Array<{ id: string; name: string; code?: string }>;
  disabled?: boolean;
  onPick?: (project: { id: string; name: string }) => void;
  onTypeNew: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const keyword = query.trim().toLowerCase();
  const filtered = keyword
    ? options.filter(p => p.name.toLowerCase().includes(keyword) || (p.code || '').toLowerCase().includes(keyword))
    : options;
  const exactMatch = options.some(p => p.name.trim().toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="crm-customer-combobox" ref={containerRef}>
      <input
        disabled={disabled}
        value={open ? query : value}
        onFocus={() => { setQuery(value); setOpen(true); }}
        onChange={event => {
          setQuery(event.target.value);
          setOpen(true);
          onTypeNew(event.target.value);
        }}
        placeholder="Chọn dự án có sẵn hoặc gõ tên dự án mới"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {open ? (
        <div className="crm-customer-combobox-menu">
          {filtered.map(project => (
            <button
              type="button"
              key={project.id}
              onMouseDown={event => event.preventDefault()}
              onClick={() => { onPick?.(project); setQuery(''); setOpen(false); }}
            >
              <strong>{project.name}</strong>
              {project.code ? <span>{project.code}</span> : null}
            </button>
          ))}
          {query.trim() && !exactMatch ? (
            <button
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => { onTypeNew(query.trim()); setOpen(false); }}
            >
              + Tạo dự án mới: “{query.trim()}”
            </button>
          ) : null}
          {!filtered.length && !query.trim() ? <p>Chưa có dự án nào — gõ để tạo dự án mới</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Panel "Thông tin then chốt" + "Bàn giao Sale" (Sale nhận bàn giao - chọn 1
 * cá nhân, GIỮ NGUYÊN như cũ theo feedback leader 2026-09-27: chỉ gộp 2 form
 * làm 1, KHÔNG đổi field này sang chọn Team) + "Tóm tắt quyết định" - dùng
 * CHUNG NGUYÊN VĂN giữa LeadDetailDrawer (Xác minh Lead) và
 * CreateOpportunityDrawer (Tạo cơ hội trực tiếp từ Customer), để 2 form này
 * là "1 form 1 luôn" theo đúng yêu cầu leader. Component này chỉ nhận
 * input/callback, không tự fetch gì (cha vẫn fetch aeOptions + chạy
 * useLeadQualificationEngine như cũ).
 */
export function LeadDealQualificationPanel(props: {
  canWrite: boolean;

  /** Cho phép cha ẩn field "Khách đang quan tâm gì?" nếu tự dựng ô chọn sản
   * phẩm riêng - mặc định hiện (khác `false` mới ẩn). */
  showProductField?: boolean;
  interest: string;
  onInterestChange: (value: string) => void;
  estimatedValue: number | null;
  onEstimatedValueChange: (value: number | null) => void;
  interestLevel: InterestLevel | '';
  onInterestLevelChange: (value: InterestLevel) => void;
  timeline: string;
  onTimelineChange: (value: string) => void;
  project: string;
  onProjectChange: (value: string) => void;
  /** Khi cha truyền mảng này (kể cả rỗng) - field "Dự án" đổi sang combobox
   * chọn Dự án CÓ SẴN của khách hàng + gõ tên mới để tạo (giống ProjectPicker
   * ở DealFormFields.tsx, nhưng component này KHÔNG tự fetch - cha tự gọi
   * projectsService.list(customerId) rồi truyền xuống). Không truyền (undefined)
   * -> giữ nguyên ô nhập tay tự do như cũ (lead chưa convert, chưa có khách
   * hàng để tra Dự án có sẵn). */
  projectOptions?: Array<{ id: string; name: string; code?: string }>;
  onPickProject?: (project: { id: string; name: string }) => void;
  /** Khi cha truyền node này - RENDER THẲNG node đó thay cho input/combobox
   * dựng sẵn ở trên (vd cha muốn dùng lại nguyên `ProjectPicker` thật của
   * DealFormFields.tsx - tự fetch/tạo Dự án - thay vì bản combobox nhận
   * props rời của riêng panel này). `project`/`projectOptions` vẫn khai báo
   * required để không phá các nơi gọi cũ, nhưng bị bỏ qua khi có `projectField`. */
  projectField?: ReactNode;
  note: string;
  onNoteChange: (value: string) => void;

  /** "Team Sale" - filter cascading CHỈ dùng để thu hẹp "Sale phụ trách" theo
   * Team CRM (crm_team_service/crm_teams) - KHÔNG có cột lưu riêng nào trên
   * Lead/Deal, chỉ chọn cá nhân (aeId) mới thực sự được lưu. Cha tự fetch
   * danh sách Team + thành viên Team, panel này chỉ nhận input/callback. */
  teamId: string;
  onTeamIdChange: (value: string) => void;
  teamOptions: Array<{ value: string; label: string }>;
  /** "+ Thêm Team mới" (và tuỳ chọn khác) trong dropdown "Team Sale" - cùng
   * quy ước `actions` của SearchableSelect (xem CrmVendorSelect.tsx). Không
   * bắt buộc - cha nào không truyền thì dropdown không có action nào (hành vi
   * cũ, không đổi). */
  teamActions?: SelectAction[];

  aeId: string;
  onAeIdChange: (value: string) => void;
  aeOptions: Array<{ value: string; label: string }>;
  contactName: string;
  onContactNameChange?: (value: string) => void;
  contactNameDisabled?: boolean;
  nextStep: string;
  onNextStepChange: (value: string) => void;
  nextStepAt: string;
  onNextStepAtChange: (value: string) => void;
  dealStage: string;
  onDealStageChange: (value: string) => void;
  /** Cho phép cha ẩn field "Dự án" tự do nhập tay nếu đã có picker Dự án THẬT
   * riêng (vd DealFormModal đã có ProjectPicker chọn/tạo Dự án thật ở panel
   * "Khách hàng & liên hệ") - mặc định hiện (khác `false` mới ẩn). */
  showProjectField?: boolean;

  verificationOutcome: VerificationOutcome;
  ruleConditions: Record<string, boolean> | null;
  outcomeReasons: string[];
  outcomeMissing: string[];
  sqlProgress: { ok: number; total: number };
  nurtureReason: string;
  onNurtureReasonChange: (value: string) => void;
  unqualifiedReason: string;
  onUnqualifiedReasonChange: (value: string) => void;
  followUpChannel: string;
  onFollowUpChannelChange: (value: string) => void;
  nextStepWarning: boolean;

  decisionRows: Array<{ key: string; label: string; value: string; ok: boolean }>;
  readinessLabel: string;
  readinessTone: 'ready' | 'partial' | 'blocked';
  extraHint?: React.ReactNode;
  readinessRef?: React.RefObject<HTMLElement | null>;
}) {
  const { canWrite } = props;
  const activeDealStageOptions = DEAL_STAGE_OPTIONS.some(o => o.value === props.dealStage) || !props.dealStage
    ? DEAL_STAGE_OPTIONS
    : [...DEAL_STAGE_OPTIONS, { value: props.dealStage, label: props.dealStage }];

  return (
    <div className="crm-verify-compact-grid">
      <section className="crm-form-section crm-verify-section crm-verify-panel" id="crm-verify-quick">
        <p className="crm-form-title">Thông tin then chốt</p>
        {/* Hint giai thich vi sao khong con field ICP thu cong o day (dung
         * NGUYEN VAN mockup markee_crm_v38_icp_rule_and_summary.html: "ICP /
         * đúng nhóm khách hàng được hệ thống tự đánh giá theo rule cấu
         * hình.") - feedback leader khoanh do phan nay, truoc day moi CHI co
         * comment code, chua hien thi that len UI. */}
        <p className="crm-verify-section-hint">ICP / đúng nhóm khách hàng được hệ thống tự đánh giá theo rule cấu hình.</p>
        <div className="crm-verify-compact-fields">
          {props.showProductField !== false ? (
            <Field label="Khách đang quan tâm gì?" required>
              <CrmProductMultiSelect
                value={props.interest}
                disabled={!canWrite}
                placeholder="-- Chọn sản phẩm / dịch vụ --"
                onChange={props.onInterestChange}
              />
            </Field>
          ) : null}
          <div className="crm-inline-pair">
            <Field label="Giá trị dự kiến">
              <CurrencyInput
                disabled={!canWrite}
                value={props.estimatedValue}
                onChange={props.onEstimatedValueChange}
                placeholder="VD: 50.000.000"
              />
            </Field>
            <Field label="Mức độ quan tâm" required>
              <select disabled={!canWrite} value={props.interestLevel} onChange={e => props.onInterestLevelChange(e.target.value as InterestLevel)}>
                <option value="">-- Chọn --</option>
                {INTEREST_LEVEL_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>
          {/* "Đúng nhóm khách hàng?" (ICP) đã bỏ dropdown thủ công - hệ thống
           * tự đánh giá từ sản phẩm/dịch vụ đang chọn theo rule cấu hình ở
           * "Điều kiện phân loại Lead" (feedback leader, PDF góp ý màn Xác
           * minh Lead), hiển thị kết quả ở "Tóm tắt quyết định" bên dưới
           * thay vì cho SDR tự chọn - ô "Dự kiến triển khai | Giai đoạn"
           * thay vào đúng chỗ ICP cũ, cùng hàng (feedback: "thay chỗ này
           * bằng cái dropdown giai đoạn"; bố cục "Thông tin then chốt" gồm
           * Giai đoạn - KHÔNG phải "Bàn giao Sale" - đã được chốt qua 2 bản
           * feedback/wip liên tiếp). */}
          <div className="crm-inline-pair">
            <Field label="Dự kiến triển khai">
              <CrmCategorySelect
                categoryType="crm_expected_timeline"
                value={props.timeline}
                disabled={!canWrite}
                placeholder="-- Chọn thời gian --"
                onChange={props.onTimelineChange}
              />
            </Field>
            <Field label="Giai đoạn" required>
              <select disabled={!canWrite} value={props.dealStage} onChange={e => props.onDealStageChange(e.target.value)}>
                {activeDealStageOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Ghi chú" full>
            <textarea
              disabled={!canWrite}
              rows={4}
              value={props.note}
              onChange={e => props.onNoteChange(e.target.value)}
              placeholder="VD: khách đang so sánh 2 nhà cung cấp"
            />
          </Field>
        </div>
      </section>

      <section className="crm-form-section crm-verify-section crm-verify-panel" id="crm-verify-handoff">
        <p className="crm-form-title">Bàn giao Sale</p>
        <div className="crm-verify-compact-fields">
          <div className="crm-inline-pair">
            <Field label="Team Sale" required>
              <SearchableSelect disabled={!canWrite} value={props.teamId} onChange={props.onTeamIdChange} options={props.teamOptions} placeholder="-- Chọn --" actions={props.teamActions} />
            </Field>
            <Field label="Sale phụ trách">
              <SearchableSelect testId="lead-ae-select" disabled={!canWrite} value={props.aeId} onChange={props.onAeIdChange} options={props.aeOptions} placeholder="Chờ phân công" />
            </Field>
          </div>
          <div className="crm-inline-pair">
            <Field label="Tiếp theo" required>
              <CrmCategorySelect
                categoryType="crm_next_step"
                value={props.nextStep}
                disabled={!canWrite}
                placeholder="-- Chọn việc tiếp theo --"
                excludeLabels={['Khác']}
                onChange={props.onNextStepChange}
              />
            </Field>
            <Field label="Hạn follow-up" required>
              <input disabled={!canWrite} type="datetime-local" value={props.nextStepAt} onChange={e => props.onNextStepAtChange(e.target.value)} />
            </Field>
          </div>
          {props.showProjectField !== false ? (
            <Field label="Dự án" hint="tùy chọn">
              {props.projectField ? props.projectField : props.projectOptions ? (
                <ProjectComboField
                  disabled={!canWrite}
                  value={props.project}
                  options={props.projectOptions}
                  onPick={props.onPickProject}
                  onTypeNew={props.onProjectChange}
                />
              ) : (
                <input
                  disabled={!canWrite}
                  value={props.project}
                  onChange={e => props.onProjectChange(e.target.value)}
                  placeholder="VD: Website 2026"
                />
              )}
            </Field>
          ) : null}
        </div>

        {props.verificationOutcome === 'nurturing' ? (
          <div className="crm-verify-compact-fields" style={{ marginTop: '0.7rem' }}>
            <Field label="Lý do nuôi dưỡng" required>
              <CrmCategorySelect categoryType="crm_nurture_reason" value={props.nurtureReason} disabled={!canWrite} placeholder="-- Chọn lý do --" onChange={props.onNurtureReasonChange} />
            </Field>
            <Field label="Ngày chăm sóc lại" required>
              <input disabled={!canWrite} type="datetime-local" value={props.nextStepAt} onChange={e => props.onNextStepAtChange(e.target.value)} />
            </Field>
            <Field label="Kênh chăm sóc">
              <CrmCategorySelect categoryType="crm_follow_up_channel" value={props.followUpChannel} disabled={!canWrite} placeholder="-- Không chọn --" onChange={props.onFollowUpChannelChange} />
            </Field>
          </div>
        ) : null}

        {props.verificationOutcome === 'unqualified' ? (
          <div className="crm-verify-compact-fields" style={{ marginTop: '0.7rem' }}>
            <Field label="Lý do không đạt chuẩn" required>
              <CrmCategorySelect categoryType="crm_unqualified_reason" value={props.unqualifiedReason} disabled={!canWrite} placeholder="-- Chọn lý do --" onChange={props.onUnqualifiedReasonChange} />
            </Field>
          </div>
        ) : null}

        {props.nextStepWarning ? (
          <p className="crm-verify-warning">
            <AlertTriangle className="crm-line-icon" />
            Deal không nên được tạo nếu chưa có Việc tiếp theo.
          </p>
        ) : null}
      </section>

      <section className="crm-form-section crm-verify-section crm-verify-panel crm-verify-readiness-panel" id="crm-verify-readiness" ref={props.readinessRef}>
        <div className="crm-verify-suggest-head">
          <p className="crm-form-title">Tóm tắt quyết định</p>
          <span className={`crm-verify-readiness-pill crm-verify-readiness-pill--${props.readinessTone}`}>{props.readinessLabel}</span>
        </div>

        <ul className="crm-verify-checklist">
          {props.decisionRows.map(row => (
            <li key={row.key} className={row.ok ? 'is-ok' : ''}>
              {row.ok ? <CheckCircle2 className="crm-line-icon" /> : <XCircle className="crm-line-icon" />}
              <span>{row.label}</span>
              <b className="crm-verify-check-value">{row.value}</b>
            </li>
          ))}
        </ul>

        {props.extraHint}

        {/* "Kết quả Lead" - de xuong DUOI cung cho dep (feedback leader
         * 2026-09-27), kem chi tiet Con thieu/Ly do/tien do SQL di theo ngay
         * duoi (truoc day la 1 card rieng trong "Bàn giao Sale"). */}
        <div className={`crm-verify-outcome-card crm-verify-outcome-card--${props.verificationOutcome}`} role="status" aria-live="polite">
          {/* Thanh 3 buoc MQL -> Nuôi dưỡng -> SQL (dung nguyen bo cuc
           * markee_crm_v38_icp_rule_and_summary.html ".lead-level", feedback
           * leader khoanh do doan nay) - "Không đạt chuẩn" la nhanh loai
           * rieng, highlight do luon o buoc MQL thay vi them 1 buoc thu 4. */}
          <div className="crm-verify-level-bar">
            <span className={`crm-verify-level-step ${props.verificationOutcome === 'pending' ? 'crm-verify-level-step--active-mql' : props.verificationOutcome === 'unqualified' ? 'crm-verify-level-step--active-invalid' : ''}`}>MQL</span>
            <span className={`crm-verify-level-step ${props.verificationOutcome === 'nurturing' ? 'crm-verify-level-step--active-nurture' : ''}`}>Nuôi dưỡng</span>
            <span className={`crm-verify-level-step ${props.verificationOutcome === 'sql' ? 'crm-verify-level-step--active-sql' : ''}`}>SQL</span>
          </div>
          <div className="crm-verify-outcome-head">
            <span className="crm-verify-outcome-dot" />
            {props.verificationOutcome === 'sql' && 'Đạt chuẩn — SQL'}
            {props.verificationOutcome === 'nurturing' && 'Nuôi dưỡng'}
            {props.verificationOutcome === 'unqualified' && 'Không đạt chuẩn'}
            {props.verificationOutcome === 'pending' && 'MQL'}
          </div>
          <p className="crm-verify-outcome-sub">
            {props.verificationOutcome === 'sql' && 'Đủ điều kiện tạo Cơ hội và bàn giao Sale.'}
            {props.verificationOutcome === 'nurturing' && 'Đã vượt MQL nhưng chưa đủ điều kiện SQL.'}
            {props.verificationOutcome === 'unqualified' && 'Lead thỏa điều kiện loại trong cấu hình.'}
            {props.verificationOutcome === 'pending' && 'Lead đang ở mức mặc định. Bổ sung thông tin để hệ thống tự nâng trạng thái.'}
          </p>

          {props.verificationOutcome === 'pending' && props.outcomeMissing.length ? (
            <>
              <p className="crm-verify-outcome-list-title">Còn thiếu:</p>
              <ul className="crm-verify-outcome-list">
                {props.outcomeMissing.map(m => <li key={m}>{m}</li>)}
              </ul>
            </>
          ) : null}
          {(props.verificationOutcome === 'nurturing' || props.verificationOutcome === 'unqualified') && props.outcomeReasons.length ? (
            <>
              <p className="crm-verify-outcome-list-title">Lý do:</p>
              <ul className="crm-verify-outcome-list">
                {props.outcomeReasons.map(r => <li key={r}>{r}</li>)}
              </ul>
            </>
          ) : null}
          {props.ruleConditions ? (
            <p className="crm-verify-outcome-progress">{props.sqlProgress.ok}/{props.sqlProgress.total} điều kiện SQL</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function formatEstimatedValue(value: number | null): string {
  return value != null ? (formatVND(value) || String(value)) : '—';
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
      <span>{label}{required ? <> <b>*</b></> : null}</span>
      {children}
      {hint ? <small className="crm-verify-hint">{hint}</small> : null}
    </label>
  );
}
