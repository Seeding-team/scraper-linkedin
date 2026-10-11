'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2, MessageSquare, UserCog, Wallet, X } from './icons';
import {
  DEAL_STAGE_META,
  LOST_REASON_OPTIONS,
  STAGE_REQUIREMENTS,
  WON_REASON_OPTIONS,
  formatVND,
} from '../constants/crmConfig';
import type { Deal, DealStage, StageTransitionInput } from '../types';
import { CurrencyInput } from '@/components/CurrencyInput';
import { useCrmCategoryCodeOptions } from './CrmCategorySelect';

const CONFIDENCE_OPTIONS = [
  { value: 'high_confirmed', label: 'Cao - Có khách hàng xác nhận' },
  { value: 'medium_inferred', label: 'Trung bình - Suy luận từ trao đổi' },
  { value: 'low_unclear', label: 'Thấp - Cần kiểm chứng thêm' },
];

const TRIGGER_OPTIONS = [
  { value: 'deadline', label: 'Cần go-live theo deadline' },
  { value: 'growth', label: 'Cần tăng trưởng doanh thu' },
  { value: 'operation', label: 'Cần tối ưu vận hành' },
  { value: 'replacement', label: 'Thay thế giải pháp cũ' },
  { value: 'unknown', label: 'Chưa rõ' },
];

const OBJECTION_OPTIONS = [
  { value: 'timeline', label: 'Lo ngại tiến độ triển khai' },
  { value: 'price', label: 'Lo ngại giá / ngân sách' },
  { value: 'trust', label: 'Cần thêm bằng chứng tin cậy' },
  { value: 'authority', label: 'Chưa có người quyết định' },
  { value: 'none', label: 'Không có objection lớn' },
];

const SCORE_OPTIONS = [
  { value: '5', label: '5 - Rất mạnh' },
  { value: '4', label: '4 - Mạnh' },
  { value: '3', label: '3 - Trung bình' },
  { value: '2', label: '2 - Yếu' },
  { value: '1', label: '1 - Rất yếu' },
];

const REUSE_LEVEL_OPTIONS = [
  { value: 'high_playbook', label: 'Cao - Có thể thành playbook' },
  { value: 'medium_reference', label: 'Trung bình - Dùng làm tham chiếu' },
  { value: 'low_context', label: 'Thấp - Chỉ dùng theo bối cảnh' },
];

const KB_OWNER_OPTIONS = [
  { value: 'deal_sdr', label: 'Sale phụ trách deal' },
  { value: 'sales_manager', label: 'Quản lý sales' },
  { value: 'marketing', label: 'Marketing' },
];

const KB_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft - Chờ duyệt' },
  { value: 'approved', label: 'Approved - Đã duyệt' },
  { value: 'rejected', label: 'Rejected - Không dùng' },
];

const OUTCOME_RESULT_OPTIONS = {
  won: [
    { value: 'signed', label: 'Hoàn thành - Đã ký / chốt mua' },
    { value: 'paid', label: 'Hoàn thành - Đã thanh toán' },
    { value: 'committed', label: 'Hoàn thành - Khách cam kết triển khai' },
  ],
  lost: [
    { value: 'competitor', label: 'Từ chối - Chọn nhà cung cấp khác' },
    { value: 'no_budget', label: 'Từ chối - Chưa có ngân sách' },
    { value: 'timing', label: 'Từ chối - Chưa đúng thời điểm' },
    { value: 'no_response', label: 'Từ chối - Không phản hồi' },
    { value: 'other', label: 'Từ chối - Lý do khác' },
  ],
};

function scoreDefault(stage: DealStage, field: 'fit' | 'sales' | 'price' | 'trust' | 'speed') {
  if (stage === 'lost') return field === 'price' ? '2' : '3';
  if (field === 'price') return '3';
  if (field === 'sales') return '4';
  return '5';
}

export function StageModal({
  open,
  deal,
  toStage,
  loading,
  readOnly = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  deal: Deal | null;
  toStage: DealStage;
  loading?: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onSubmit: (payload: StageTransitionInput) => void;
}) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [confidence, setConfidence] = useState('high_confirmed');
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [evidence, setEvidence] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [influencer, setInfluencer] = useState('');
  const [trigger, setTrigger] = useState('deadline');
  const [objection, setObjection] = useState('timeline');
  const [fitScore, setFitScore] = useState('');
  const [salesScore, setSalesScore] = useState('');
  const [priceScore, setPriceScore] = useState('');
  const [trustScore, setTrustScore] = useState('');
  const [speedScore, setSpeedScore] = useState('');
  const [repeat, setRepeat] = useState('');
  const [improve, setImprove] = useState('');
  const [reuseSegment, setReuseSegment] = useState('');
  const [reuseLevel, setReuseLevel] = useState('high_playbook');
  const [knowledgeTags, setKnowledgeTags] = useState('');
  const [kbOwner, setKbOwner] = useState('deal_sdr');
  const [kbReviewer, setKbReviewer] = useState('sales_manager');
  const [kbStatus, setKbStatus] = useState('draft');
  const [kbScope, setKbScope] = useState('Nội bộ Markee + AI Sales Coach');
  const [decisionMaker, setDecisionMaker] = useState('');
  const [budget, setBudget] = useState<number | null>(null);
  const [followUpDate, setFollowUpDate] = useState('');
  const req = STAGE_REQUIREMENTS[toStage] || {};
  const isOutcomeStage = toStage === 'won' || toStage === 'lost';
  const meta = DEAL_STAGE_META[toStage];
  const { options: wonReasonOptions } = useCrmCategoryCodeOptions('crm_won_reason', WON_REASON_OPTIONS);
  const { options: lostReasonOptions } = useCrmCategoryCodeOptions('crm_lost_reason', LOST_REASON_OPTIONS);
  const { options: confidenceOptions } = useCrmCategoryCodeOptions('crm_outcome_confidence', CONFIDENCE_OPTIONS);
  const { options: triggerOptions } = useCrmCategoryCodeOptions('crm_outcome_trigger', TRIGGER_OPTIONS);
  const { options: objectionOptions } = useCrmCategoryCodeOptions('crm_outcome_objection', OBJECTION_OPTIONS);
  const { options: reuseLevelOptions } = useCrmCategoryCodeOptions('crm_kb_reuse_level', REUSE_LEVEL_OPTIONS);
  const { options: kbOwnerOptions } = useCrmCategoryCodeOptions('crm_kb_owner', KB_OWNER_OPTIONS);
  const { options: kbStatusOptions } = useCrmCategoryCodeOptions('crm_kb_status', KB_STATUS_OPTIONS);
  const outcomeReasonOptions = toStage === 'won' ? wonReasonOptions : lostReasonOptions;

  useEffect(() => {
    if (!open || !deal) return;
    const outcome = deal.outcome || {};
    setNote('');
    setReason(outcome.reasonText || outcome.rootCause || '');
    setReasonCode(outcome.result || (toStage === 'won' ? 'signed' : 'competitor'));
    setConfidence(outcome.confidence || 'high_confirmed');
    setSelectedReasons(outcome.reasons || []);
    setEvidence(outcome.evidence || '');
    setCompetitor(outcome.competitor || '');
    setInfluencer(outcome.influencer || '');
    setTrigger(outcome.trigger || 'deadline');
    setObjection(outcome.objection || 'timeline');
    setFitScore(outcome.fitScore || scoreDefault(toStage, 'fit'));
    setSalesScore(outcome.salesScore || scoreDefault(toStage, 'sales'));
    setPriceScore(outcome.priceScore || scoreDefault(toStage, 'price'));
    setTrustScore(outcome.trustScore || scoreDefault(toStage, 'trust'));
    setSpeedScore(outcome.speedScore || scoreDefault(toStage, 'speed'));
    setRepeat(outcome.repeat || '');
    setImprove(outcome.improve || '');
    setReuseSegment(outcome.reuseSegment || '');
    setReuseLevel(outcome.reuseLevel || 'high_playbook');
    setKnowledgeTags(outcome.knowledgeTags || '');
    setKbOwner(outcome.kbOwner || 'deal_sdr');
    setKbReviewer(outcome.kbReviewer || 'sales_manager');
    setKbStatus(outcome.kbStatus || 'draft');
    setKbScope(outcome.kbScope || 'Nội bộ Markee + AI Sales Coach');
    setDecisionMaker(deal.decisionMaker || '');
    setBudget(deal.estimatedBudget ?? null);
    setFollowUpDate(deal.followUpDate ? String(deal.followUpDate).slice(0, 10) : '');
  }, [deal, open, toStage]);

  function toggleReason(value: string) {
    if (readOnly) return;
    setSelectedReasons(current => {
      if (current.includes(value)) return current.filter(item => item !== value);
      if (current.length >= 3) {
        window.alert('Chọn tối đa 3 lý do chính.');
        return current;
      }
      return [...current, value];
    });
  }

  function submit() {
    if (readOnly) {
      onClose();
      return;
    }
    if (req.requireNote && !note.trim()) {
      window.alert('Vui lòng nhập ghi chú.');
      return;
    }
    if (toStage === 'on_hold' && !note.trim()) {
      window.alert('Vui lòng nhập lý do tạm dừng.');
      return;
    }
    if (req.requireBudget && (budget ?? 0) <= 0) {
      window.alert('Vui lòng nhập ngân sách dự kiến lớn hơn 0.');
      return;
    }
    if (req.requireDecisionMaker && !decisionMaker.trim()) {
      window.alert('Vui lòng nhập người ra quyết định.');
      return;
    }
    if (isOutcomeStage && (!reason.trim() || !reasonCode || !selectedReasons.length)) {
      window.alert(toStage === 'won' ? 'Vui lòng hoàn tất đánh giá thắng.' : 'Vui lòng hoàn tất đánh giá thua.');
      return;
    }
    onSubmit({
      note: isOutcomeStage ? reason.trim() : note.trim(),
      pauseReason: toStage === 'on_hold' ? note.trim() : '',
      decisionMaker: decisionMaker.trim(),
      estimatedBudget: budget != null ? budget : undefined,
      followUpDate: followUpDate || '',
      outcome: isOutcomeStage
        ? {
            reasonText: reason.trim(),
            rootCause: reason.trim(),
            note: reason.trim(),
            evidence: evidence.trim(),
            competitor: competitor.trim(),
            influencer: influencer.trim(),
            trigger,
            objection,
            fitScore,
            salesScore,
            priceScore,
            trustScore,
            speedScore,
            repeat: repeat.trim(),
            improve: improve.trim(),
            reuseSegment: reuseSegment.trim(),
            reuseLevel,
            knowledgeTags: knowledgeTags.trim(),
            kbOwner,
            kbReviewer,
            kbStatus,
            kbScope: kbScope.trim(),
            result: reasonCode,
            confidence,
            reasons: selectedReasons,
          }
        : undefined,
    });
  }

  if (!open || !deal) return null;
  const scoreRows = [
    { label: 'Mức độ phù hợp sản phẩm / giải pháp', value: fitScore, setter: setFitScore },
    { label: 'Năng lực tư vấn của Sale', value: salesScore, setter: setSalesScore },
    { label: 'Giá & điều khoản thương mại', value: priceScore, setter: setPriceScore },
    { label: 'Uy tín / case study / thương hiệu', value: trustScore, setter: setTrustScore },
    { label: 'Tốc độ phản hồi & triển khai', value: speedScore, setter: setSpeedScore },
  ];

  return (
    <div className="crm-modal-backdrop crm-stage-modal-backdrop" onClick={onClose}>
      <div className={`crm-stage-modal ${isOutcomeStage ? 'crm-stage-modal--wide' : ''}`} onClick={event => event.stopPropagation()}>
        <header className="crm-stage-modal-header" style={{ backgroundColor: meta.color }}>
          <div>
            <div className="crm-stage-modal-kicker">
              {DEAL_STAGE_META[deal.stage].label} -&gt; {meta.label}
            </div>
            <h3>{isOutcomeStage ? (readOnly ? (toStage === 'won' ? 'XEM ĐÁNH GIÁ THẮNG' : 'XEM ĐÁNH GIÁ THUA') : (toStage === 'won' ? 'ĐÁNH GIÁ THẮNG' : 'ĐÁNH GIÁ THUA')) : `Chuyển sang ${meta.label}`}</h3>
            <p>{deal.customerName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-stage-modal-body">
          <fieldset className="crm-stage-modal-fieldset" disabled={readOnly}>
            {isOutcomeStage ? (
              <section className="crm-review-card">
                <div className="crm-review-header">
                  <div>
                    <h4>{toStage === 'won' ? 'ĐÁNH GIÁ THẮNG - BẮT BUỘC KHI ĐÓNG DEAL' : 'ĐÁNH GIÁ THUA - BẮT BUỘC KHI ĐÓNG DEAL'}</h4>
                    <p>Dữ liệu được chuẩn hóa để học nội bộ và huấn luyện AI Sales Coach.</p>
                  </div>
                  <span className={`crm-review-badge crm-review-badge--${toStage}`}>{toStage === 'won' ? 'ĐÁNH GIÁ THẮNG' : 'ĐÁNH GIÁ THUA'}</span>
                </div>

                <div className="crm-review-section">
                  <h5>1. Kết quả & lý do chính</h5>
                  <div className="crm-review-grid">
                    <label className="crm-review-field">
                      <span>Kết quả xác nhận <b>*</b></span>
                      <select value={reasonCode} onChange={event => setReasonCode(event.target.value)}>
                        {OUTCOME_RESULT_OPTIONS[toStage].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="crm-review-field">
                      <span>Mức độ chắc chắn của kết luận <b>*</b></span>
                      <select value={confidence} onChange={event => setConfidence(event.target.value)}>
                        {confidenceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <div className="crm-review-field crm-review-field--full">
                      <span>{toStage === 'won' ? 'Lý do thắng deal' : 'Lý do thua deal'} <b>*</b></span>
                      <div className="crm-review-checkbox-grid">
                        {outcomeReasonOptions.map(option => (
                          <label key={option.value} className="crm-review-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedReasons.includes(option.value)}
                              onChange={() => toggleReason(option.value)}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                      <em>Không dùng một ô ghi chú tự do duy nhất. Taxonomy giúp tổng hợp báo cáo và huấn luyện AI chính xác hơn.</em>
                    </div>
                    <label className="crm-review-field crm-review-field--full">
                      <span>Diễn giải nguyên nhân gốc <b>*</b></span>
                      <textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Mô tả nguyên nhân thật sự khiến khách chốt mua hoặc từ chối..." />
                    </label>
                  </div>
                </div>

                <div className="crm-review-section">
                  <h5>2. Bằng chứng & bối cảnh quyết định</h5>
                  <div className="crm-review-grid">
                    <label className="crm-review-field">
                      <span>Đối thủ / phương án thay thế</span>
                      <input value={competitor} onChange={event => setCompetitor(event.target.value)} placeholder="Tự làm nội bộ, freelancer địa phương..." />
                    </label>
                    <label className="crm-review-field">
                      <span>Người ảnh hưởng chính</span>
                      <input value={influencer} onChange={event => setInfluencer(event.target.value)} placeholder="Giám đốc + phụ trách kỹ thuật" />
                    </label>
                    <label className="crm-review-field">
                      <span>Trigger khiến khách hàng hành động</span>
                      <select value={trigger} onChange={event => setTrigger(event.target.value)}>
                        {triggerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="crm-review-field">
                      <span>Objection lớn nhất</span>
                      <select value={objection} onChange={event => setObjection(event.target.value)}>
                        {objectionOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="crm-review-field crm-review-field--full">
                      <span>Bằng chứng xác thực <b>*</b></span>
                      <textarea value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Nên gắn link email, tin nhắn, call note hoặc biên bản - không lưu dữ liệu nhạy cảm không cần thiết." />
                      <em>Nên gắn link email, tin nhắn, call note hoặc biên bản.</em>
                    </label>
                  </div>
                </div>

                <div className="crm-review-section">
                  <h5>3. Chấm điểm yếu tố quyết định</h5>
                  <div className="crm-review-score-list">
                    {scoreRows.map(row => (
                      <label key={row.label} className="crm-review-score-row">
                        <span>{row.label}</span>
                        <select value={row.value} onChange={event => row.setter(event.target.value)}>
                          {SCORE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="crm-review-section">
                  <h5>4. Bài học có thể tái sử dụng</h5>
                  <div className="crm-review-grid">
                    <label className="crm-review-field crm-review-field--full">
                      <span>Điều gì nên lặp lại? <b>*</b></span>
                      <textarea value={repeat} onChange={event => setRepeat(event.target.value)} placeholder="Ví dụ: gửi demo cùng ngành trong 24 giờ, xác nhận người ra quyết định ngay từ cuộc gọi đầu..." />
                    </label>
                    <label className="crm-review-field crm-review-field--full">
                      <span>Điều gì cần cải thiện?</span>
                      <textarea value={improve} onChange={event => setImprove(event.target.value)} placeholder="Ví dụ: hỏi sớm hơn về quy trình duyệt ngân sách..." />
                    </label>
                    <label className="crm-review-field">
                      <span>Use case / phân khúc áp dụng</span>
                      <input value={reuseSegment} onChange={event => setReuseSegment(event.target.value)} placeholder="SME CNTT - Website doanh nghiệp - Deal < 20" />
                    </label>
                    <label className="crm-review-field">
                      <span>Khả năng tái sử dụng</span>
                      <select value={reuseLevel} onChange={event => setReuseLevel(event.target.value)}>
                        {reuseLevelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="crm-review-field crm-review-field--full">
                      <span>Tags Knowledge Base</span>
                      <input value={knowledgeTags} onChange={event => setKnowledgeTags(event.target.value)} placeholder="SME, CNTT, website, fast-response, demo" />
                    </label>
                  </div>
                </div>

                <div className="crm-review-section">
                  <h5>5. Quy trình duyệt Knowledge Base</h5>
                  <div className="crm-review-grid crm-review-grid--three">
                    <label className="crm-review-field">
                      <span>Owner bài học</span>
                      <select value={kbOwner} onChange={event => setKbOwner(event.target.value)}>
                        {kbOwnerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="crm-review-field">
                      <span>Người duyệt</span>
                      <select value={kbReviewer} onChange={event => setKbReviewer(event.target.value)}>
                        {kbOwnerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="crm-review-field">
                      <span>Trạng thái tri thức</span>
                      <select value={kbStatus} onChange={event => setKbStatus(event.target.value)}>
                        {kbStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="crm-review-field crm-review-field--full">
                      <span>Phạm vi sử dụng</span>
                      <input value={kbScope} onChange={event => setKbScope(event.target.value)} />
                    </label>
                  </div>
                </div>
              </section>
            ) : null}

            <label className="crm-stage-field">
              <span><UserCog className="crm-line-icon" /> Người ra quyết định {req.requireDecisionMaker ? <b>*</b> : null}</span>
              <input value={decisionMaker} onChange={event => setDecisionMaker(event.target.value)} placeholder="Họ tên / chức danh" />
            </label>
            <label className="crm-stage-field">
              <span><Wallet className="crm-line-icon" /> Ngân sách dự kiến (VND) {req.requireBudget ? <b>*</b> : null}</span>
              <CurrencyInput value={budget} onChange={setBudget} placeholder={formatVND(deal.estimatedBudget) || 'VD: 50.000.000'} />
            </label>
            {deal.quote ? (
              <div className="crm-stage-quote-card">
                <div>
                  <span>Báo giá đã tạo từ form</span>
                  <b>{deal.quote.number || deal.quote.id || 'Chưa có mã báo giá'}</b>
                  <p>Hệ thống tự gắn link báo giá của deal, không cần nhập tay.</p>
                </div>
                {deal.quote.url ? (
                  <a href={deal.quote.url} target="_blank" rel="noopener noreferrer">Mở báo giá</a>
                ) : null}
              </div>
            ) : null}
            <label className="crm-stage-field">
              <span><CalendarDays className="crm-line-icon" /> Ngày follow-up lại</span>
              <input value={followUpDate} onChange={event => setFollowUpDate(event.target.value)} type="date" />
            </label>
            {!isOutcomeStage ? (
              <label className="crm-stage-field">
                <span><MessageSquare className="crm-line-icon" /> {toStage === 'on_hold' ? 'Lý do tạm dừng' : 'Ghi chú'} {req.requireNote || toStage === 'on_hold' ? <b>*</b> : null}</span>
                <textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Tóm tắt trao đổi, lý do chuyển giai đoạn, việc cần làm tiếp..." />
              </label>
            ) : null}
            {['won', 'lost', 'on_hold'].includes(toStage) ? (
              <div className="crm-terminal-warning">
                <AlertTriangle className="crm-line-icon" />
                <span><b>Trạng thái kết thúc.</b> Sau khi lưu, deal sẽ đóng vòng pipeline.</span>
              </div>
            ) : null}
          </fieldset>
        </div>

        <footer className="crm-stage-modal-footer">
          <button type="button" className="crm-cancel-button" onClick={onClose}>{readOnly ? 'Đóng' : 'Hủy'}</button>
          {!readOnly ? (
            <button type="button" className="crm-stage-submit" disabled={loading} onClick={submit}>
              {loading ? <Loader2 className="crm-save-spinner" /> : null}
              {loading ? 'Đang lưu...' : isOutcomeStage ? 'Xác nhận' : `Chuyển sang ${meta.label}`}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
