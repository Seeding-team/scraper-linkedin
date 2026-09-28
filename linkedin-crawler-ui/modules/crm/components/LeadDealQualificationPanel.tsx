'use client';

import { CurrencyInput } from '@/components/CurrencyInput';
import { formatVND, PIPELINE_COLUMNS, DEAL_STAGE_META } from '../constants/crmConfig';
import { CrmCategorySelect } from './CrmCategorySelect';
import { SearchableSelect } from './SearchableSelect';
import { AlertTriangle, CheckCircle2, XCircle } from './icons';
import {
  ICP_OPTIONS,
  INTEREST_LEVEL_OPTIONS,
  type IcpFit,
  type InterestLevel,
  type VerificationOutcome,
} from '../utils/leadQualificationRules';

/** "Giai đoạn" cho Deal sap tao (feedback WIP full-flow, mucE.2 "Bàn giao
 * Sale": layout `Giai đoạn | Kết quả Lead`) - chi cho chon trong cac stage
 * PIPELINE THAT (khong gom on_hold/lost, khong hop ly cho 1 co hoi vua tao). */
const DEAL_STAGE_OPTIONS = PIPELINE_COLUMNS.map(stage => ({ value: stage, label: DEAL_STAGE_META[stage].label }));

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

  /** Deal (CreateOpportunityDrawer) đã có sẵn field "Sản phẩm / dịch vụ"
   * riêng ở section "Cơ hội" (dùng CrmCategoryCodeSelect, khác kiểu value với
   * CrmCategorySelect ở đây) - ẩn field "interest" ở panel này để tránh 2 ô
   * chọn sản phẩm trùng nhau, `hasProduct` vẫn được cha truyền vào để tính
   * rule engine dùng chung. */
  showProductField?: boolean;
  interest: string;
  onInterestChange: (value: string) => void;
  estimatedValue: number | null;
  onEstimatedValueChange: (value: number | null) => void;
  interestLevel: InterestLevel | '';
  onInterestLevelChange: (value: InterestLevel) => void;
  timeline: string;
  onTimelineChange: (value: string) => void;
  icpFit: IcpFit;
  onIcpFitChange: (value: IcpFit) => void;
  project: string;
  onProjectChange: (value: string) => void;
  note: string;
  onNoteChange: (value: string) => void;

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
  return (
    <div className="crm-verify-compact-grid">
      <section className="crm-form-section crm-verify-section crm-verify-panel" id="crm-verify-quick">
        <p className="crm-form-title">Thông tin then chốt</p>
        <div className="crm-verify-compact-fields">
          {props.showProductField !== false ? (
            <Field label="Khách đang quan tâm gì?" required>
              <CrmCategorySelect
                categoryType="crm_service_package"
                value={props.interest}
                disabled={!canWrite}
                placeholder="-- Chọn sản phẩm/dịch vụ --"
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
            <Field label="Đúng nhóm khách hàng?">
              <select disabled={!canWrite} value={props.icpFit} onChange={e => props.onIcpFitChange(e.target.value as IcpFit)}>
                {ICP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
              <select disabled={!canWrite} value="" onChange={() => {}}>
                <option value="">-- Chọn --</option>
              </select>
            </Field>
            <Field label="Sale phụ trách">
              <SearchableSelect disabled={!canWrite} value={props.aeId} onChange={props.onAeIdChange} options={props.aeOptions} placeholder="Chờ Sales Manager phân" />
            </Field>
          </div>
          <div className="crm-inline-pair">
            <Field label="Việc tiếp theo" required>
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
          <div className="crm-inline-pair">
            <Field label="Giai đoạn" required>
              <select disabled={!canWrite} value={props.dealStage} onChange={e => props.onDealStageChange(e.target.value)}>
                {DEAL_STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Dự án" hint="tùy chọn">
              <input
                disabled={!canWrite}
                value={props.project}
                onChange={e => props.onProjectChange(e.target.value)}
                placeholder="VD: Website 2026"
              />
            </Field>
          </div>
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
          <div className="crm-verify-outcome-head">
            <span className="crm-verify-outcome-dot" />
            {props.verificationOutcome === 'sql' && 'Đạt chuẩn — SQL'}
            {props.verificationOutcome === 'nurturing' && 'Nuôi dưỡng'}
            {props.verificationOutcome === 'unqualified' && 'Không đạt chuẩn'}
            {props.verificationOutcome === 'pending' && 'Chưa đủ dữ liệu'}
          </div>

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
      <span>{label}{required ? ' *' : ''}</span>
      {children}
      {hint ? <small className="crm-verify-hint">{hint}</small> : null}
    </label>
  );
}
