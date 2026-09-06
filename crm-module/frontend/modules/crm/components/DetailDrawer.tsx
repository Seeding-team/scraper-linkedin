'use client';

import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Tag,
  Trash2,
  UserCog,
  Wallet,
  X,
} from './icons';
import {
  CONTRACT_STATUS_OPTIONS,
  DEAL_STAGE_META,
  allowedNextStages,
  canApproveQuote,
  canWriteDeal,
  formatDate,
  formatDateTime,
  formatVND,
  getContractLabel,
  getContractStatusText,
  getContractUrl,
  getPackageText,
  getPaymentStatusText,
  getServicePackageText,
} from '../constants/crmConfig';
import type { ContractStatus, Deal, DealStage } from '../types';
import { useAppAuth } from '@/contexts/AppAuthContext';

type Props = {
  deal: Deal | null;
  open: boolean;
  onClose: () => void;
  onRequestTransition: (deal: Deal, stage: DealStage) => void;
  onViewReview: (deal: Deal) => void;
  onEdit: (deal: Deal) => void;
  onDelete: (deal: Deal) => void;
  onUpdateContractStatus: (deal: Deal, status: ContractStatus) => void;
  onCreateQuote: (deal: Deal) => void;
  /** Mở modal sửa báo giá đang gắn với deal này (chỉ khi chưa duyệt). */
  onEditQuote: (deal: Deal) => void;
  /** Xoá hẳn báo giá đang gắn với deal này (chỉ khi chưa duyệt). */
  onDeleteQuote: (deal: Deal) => void;
  /** Tạo phiên bản mới (V2/V3...) từ báo giá ĐÃ DUYỆT đang gắn với deal này. */
  onCreateQuoteVersion: (deal: Deal) => void;
  /** Mở 1 phiên bản CỤ THỂ trong chuỗi (không nhất thiết là deal.quote hiện
   * tại) để xem/sửa — dùng cho khối "Lịch sử phiên bản" bên dưới. */
  onOpenQuoteVersion: (deal: Deal, quoteId: string) => void;
  /** Tăng dần sau mỗi lần tạo phiên bản mới — ép fetch lại "Lịch sử phiên
   * bản" vì deal.quote.id (vẫn là bản đã duyệt) không đổi khi có bản nháp mới. */
  quoteVersionsRefreshKey: number;
};

function tel(value?: string) {
  return String(value || '').replace(/[^\d+]/g, '');
}

export function DetailDrawer({
  deal,
  open,
  onClose,
  onRequestTransition,
  onViewReview,
  onEdit,
  onDelete,
  onUpdateContractStatus,
  onCreateQuote,
  onEditQuote,
  onDeleteQuote,
  onCreateQuoteVersion,
  onOpenQuoteVersion,
  quoteVersionsRefreshKey,
}: Props) {
  const { user } = useAppAuth();
  const [otherVersions, setOtherVersions] = useState<Quote[]>([]);

  useEffect(() => {
    setOtherVersions([]);
    if (!deal?.quote?.id) return;
    let alive = true;
    seedingQuoteRepository
      .getQuoteVersions(deal.quote.id)
      .then(rows => {
        if (alive) setOtherVersions(rows.filter(row => row.id !== deal.quote?.id));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.quote?.id, quoteVersionsRefreshKey]);

  if (!open || !deal) return null;
  // Deal khong phai cua minh/team minh phu trach VA minh khong phai admin/
  // leader/sale -> chi xem, khong duoc chuyen giai doan / sua / xoa.
  const canWrite = canWriteDeal(user, deal);
  const stageMeta = DEAL_STAGE_META[deal.stage];
  const contractLabel = getContractLabel(deal);
  const contractUrl = getContractUrl(deal);
  const isTerminal = deal.stage === 'won' || deal.stage === 'lost';
  const hasTerminalReview = isTerminal && Boolean(
    deal.outcome.reviewedAt ||
    deal.outcome.reasonText ||
    deal.outcome.rootCause ||
    deal.outcome.evidence ||
    deal.outcome.reasons?.length ||
    deal.outcome.result
  );
  const terminalResult =
    deal.stage === 'won'
      ? { label: 'Deal đã hoàn thành', variant: 'won' }
      : deal.stage === 'lost'
        ? { label: 'Deal đã từ chối', variant: 'lost' }
        : deal.stage === 'on_hold'
          ? { label: 'Deal tạm dừng', variant: 'hold' }
        : null;

  return (
    <>
      <div className="crm-drawer-backdrop" onClick={onClose} />
      <aside className="crm-drawer">
        <header className="crm-drawer-header" style={{ backgroundColor: stageMeta.color }}>
          <div className="min-w-0">
            <div className="crm-drawer-stage-line">
              <span>{stageMeta.label}</span>
              <b>{deal.daysInStage} ngày ở giai đoạn</b>
            </div>
            <h2>{deal.position ? `${deal.customerName} - ${deal.position}` : deal.customerName}</h2>
            {deal.companyName ? <p>{deal.companyName}</p> : null}
          </div>
          <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-drawer-body">
          <section className="crm-contact-box">
            <div className="crm-contact-action-row">
              {deal.phone ? (
                <a href={`tel:${tel(deal.phone)}`}>
                  <Phone className="crm-line-icon" />
                  {deal.phone}
                </a>
              ) : null}
              {deal.email ? (
                <a href={`mailto:${deal.email}`}>
                  <Mail className="crm-line-icon" />
                  {deal.email}
                </a>
              ) : null}
              {deal.zalo ? (
                <a href={`https://zalo.me/${tel(deal.zalo || deal.phone)}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="crm-line-icon" />
                  Zalo
                </a>
              ) : null}
            </div>
            {deal.companyName ? <InfoLine icon={Building2} text={deal.companyName} strong /> : null}
            {deal.city ? <InfoLine icon={MapPin} text={deal.city} /> : null}
            {deal.industry ? <InfoLine icon={Building2} text={deal.industry} /> : null}
            {deal.servicePackage ? <InfoLine icon={Tag} text={`Danh mục: ${getServicePackageText(deal.servicePackage)}`} /> : null}
            {deal.package ? <InfoLine icon={Tag} text={`Gói: ${getPackageText(deal.package)}`} /> : null}
            {deal.address ? <InfoLine icon={MapPin} text={deal.address} /> : null}
            {deal.sourcePlatform ? <InfoLine icon={MessageCircle} text={`Nguồn: ${deal.sourcePlatform}`} /> : null}
          </section>

          {terminalResult ? (
            <section className={`crm-terminal-note crm-terminal-note--${terminalResult.variant}`}>
              {terminalResult.variant === 'won' ? <CheckCircle2 className="crm-line-icon" /> : <AlertCircle className="crm-line-icon" />}
              <div>
                <strong>{terminalResult.label} ở trạng thái kết thúc.</strong>
                {deal.outcome.reasonText ? <p>Lý do: <b>{deal.outcome.reasonText}</b></p> : null}
                {deal.pauseReason && deal.stage === 'on_hold' ? <p>Lý do tạm dừng: <b>{deal.pauseReason}</b></p> : null}
              </div>
            </section>
          ) : null}

          <section className="crm-meta-grid">
            {deal.decisionMaker ? <MetaCard icon={UserCog} label="Người quyết định" value={deal.decisionMaker} /> : null}
            {deal.estimatedBudget ? <MetaCard icon={Wallet} label="Ngân sách" value={formatVND(deal.estimatedBudget) || ''} /> : null}
            {deal.followUpDate ? (
              <div className="crm-follow-up"><CalendarDays className="crm-line-icon" /> Follow-up dự kiến: <b>{formatDate(deal.followUpDate)}</b></div>
            ) : null}
            {deal.assignment.leadName ? <MetaCard icon={UserCog} label="Quản lý" value={deal.assignment.leadName} /> : null}
            {deal.assignment.sdrName ? <MetaCard icon={UserCog} label="Phụ trách" value={deal.assignment.sdrName} /> : null}
          </section>

          <section className="crm-contract-section">
            <h3 className="crm-section-title">Hợp đồng & ngày tháng</h3>
            <div className="crm-contract-action-row">
              {contractUrl ? (
                <a href={contractUrl} className="crm-contract-detail-button" target="_blank" rel="noopener noreferrer">
                  <FileText className="crm-line-icon" />
                  Mở link gốc
                </a>
              ) : null}
            </div>
            <div className="crm-contract-status-edit">
              <label>Tình trạng hợp đồng</label>
              <div className="crm-contract-status-control">
                <select
                  value={deal.contract.status || ''}
                  onChange={event => onUpdateContractStatus(deal, event.target.value as ContractStatus)}
                >
                  <option value="">-- Chưa chọn --</option>
                  {CONTRACT_STATUS_OPTIONS.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
                {deal.contract.status ? <span className="crm-contract-status-badge">{getContractStatusText(deal.contract.status)}</span> : null}
              </div>
            </div>
            <div className="crm-contract-grid">
              <ContractCard icon={Tag} label="Danh mục sản phẩm" value={getServicePackageText(deal.servicePackage)} />
              <ContractCard icon={Tag} label="Gói sản phẩm" value={getPackageText(deal.package)} />
              <ContractCard icon={Wallet} label="Giá trị hợp đồng" value={formatVND(deal.estimatedBudget || deal.lifetimeValue || 0)} />
              <ContractCard icon={FileText} label="Mã HĐ/BG" value={contractLabel} />
              <ContractCard icon={FileText} label="Tên hợp đồng" value={deal.contract.title} />
              <ContractCard icon={FileText} label="Trạng thái thanh toán" value={getPaymentStatusText(deal.contract.paymentStatus)} />
              <ContractCard icon={CalendarDays} label="Ngày cần thanh toán" value={formatDate(deal.contract.paymentDueDate)} />
              <ContractCard icon={CalendarDays} label="Ngày ký" value={formatDate(deal.contract.signedAt)} />
              <ContractCard icon={CalendarDays} label="Ngày đóng" value={formatDate(deal.closedAt)} />
              <ContractCard icon={CalendarDays} label="Bảo hành đến" value={formatDate(deal.contract.warrantyExpiresAt)} />
            </div>
            {deal.contract.note ? <p className="crm-note crm-contract-note">{deal.contract.note}</p> : null}
          </section>

          <section className="crm-quotes-section">
            <div className="crm-section-head-row">
              <h3 className="crm-section-title">BÁO GIÁ KHÁCH HÀNG</h3>
              {!deal.quote ? (
                <button type="button" className="crm-secondary-inline" onClick={() => onCreateQuote(deal)}>
                  Tạo báo giá cho deal này
                </button>
              ) : null}
            </div>
            {deal.quote ? (() => {
              // Bao gia THAT (co id, tao qua wizard moi) - chi 'approved' moi
              // coi la khoa. 'confirmed'/'draft' van la chua duyet, sua duoc -
              // ke ca bao gia cu tao truoc migration 053 (status='confirmed')
              // vi co the con loi du lieu can sua (vd ten dich vu bi lap mo ta)
              // truoc khi duyet chinh thuc. Bao gia THAM CHIEU cu (khong co id
              // - chi la link/doc dinh kem tay tu truoc khi co he thong nay)
              // thi coi nhu da "chot" san, khong con gi de sua/duyet nua.
              const isApproved = !deal.quote.id || deal.quote.status === 'approved';
              const canEditThisQuote = !isApproved && (canWriteDeal(user, deal) || canApproveQuote(user));
              // Gắn kèm dealId để trang chi tiết báo giá biết đường "Quay lại"
              // đúng deal này (xem QuoteDetailPage.tsx) - mở CÙNG tab (không
              // target="_blank") để nút Quay lại hoạt động như back thật.
              const internalUrl = deal.quote.id
                ? `/all-platform/quotes/${deal.quote.id}?dealId=${encodeURIComponent(deal.id)}`
                : undefined;
              return (
                <article className="crm-quote-row">
                  <div className="crm-quote-row-main">
                    <div>
                      <b>{deal.quote.number || deal.quote.id || 'Báo giá tham chiếu'}</b>
                      <span className="crm-quote-tag crm-quote-tag--version">V{deal.quote.versionNumber || 1}</span>
                      <span className={isApproved ? 'crm-quote-tag crm-quote-tag--approved' : 'crm-quote-tag crm-quote-tag--draft'}>
                        {isApproved ? '🟢 Đã duyệt' : '🟠 Chưa duyệt'}
                      </span>
                    </div>
                    <strong>{formatVND(deal.quote.totalAmount || 0) || 'Chưa có giá trị'}</strong>
                  </div>
                  <div className="crm-quote-row-actions">
                    {!isApproved && canEditThisQuote ? (
                      <button type="button" className="crm-quote-btn" onClick={() => onEditQuote(deal)}>
                        Chỉnh sửa
                      </button>
                    ) : null}
                    {deal.quote.id && !isApproved && canEditThisQuote ? (
                      <button
                        type="button"
                        className="crm-quote-btn crm-quote-btn--danger"
                        title="Xóa báo giá khỏi deal"
                        aria-label="Xóa báo giá khỏi deal"
                        onClick={() => onDeleteQuote(deal)}
                      >
                        Xóa báo giá
                      </button>
                    ) : null}
                    {isApproved && deal.quote.url ? (
                      <a href={deal.quote.url} className="crm-quote-btn" target="_blank" rel="noopener noreferrer">
                        Mở báo giá
                      </a>
                    ) : internalUrl ? (
                      <a href={internalUrl} className="crm-quote-btn">
                        Mở báo giá
                      </a>
                    ) : (
                      <span className="crm-quote-btn crm-quote-btn--disabled">Chưa có link</span>
                    )}
                    {isApproved && deal.quote.url ? (
                      <button
                        type="button"
                        className="crm-quote-btn"
                        onClick={() => {
                          const url = deal.quote?.url;
                          if (url) void navigator.clipboard.writeText(`${window.location.origin}${url}`);
                        }}
                      >
                        Sao chép link
                      </button>
                    ) : null}
                    {deal.quote.id && deal.quote.status === 'approved' && canWriteDeal(user, deal) ? (
                      <button
                        type="button"
                        className="crm-quote-btn crm-quote-btn--primary"
                        title="Tạo phiên bản mới từ báo giá đã duyệt này"
                        onClick={() => onCreateQuoteVersion(deal)}
                      >
                        + Tạo phiên bản mới
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })() : (
              <p className="crm-empty-log">Chưa có báo giá</p>
            )}
            {otherVersions.length ? (
              <div className="crm-quote-version-history">
                <span className="crm-quote-version-history__title">Lịch sử phiên bản</span>
                {otherVersions.map(version => {
                  const versionApproved = version.status === 'approved';
                  return (
                    <article className="crm-quote-row" key={version.id}>
                      <div className="crm-quote-row-main">
                        <div>
                          <b>{version.quoteNumber}</b>
                          <span className="crm-quote-tag crm-quote-tag--version">V{version.versionNumber || 1}</span>
                          <span className={versionApproved ? 'crm-quote-tag crm-quote-tag--approved' : 'crm-quote-tag crm-quote-tag--draft'}>
                            {versionApproved ? '🟢 Đã duyệt' : '🟠 Chưa duyệt'}
                          </span>
                        </div>
                        <strong>{formatVND(version.totalAmount || 0) || 'Chưa có giá trị'}</strong>
                      </div>
                      <div className="crm-quote-row-actions">
                        {versionApproved ? (
                          <a href={`/all-platform/quotes/${version.id}?dealId=${encodeURIComponent(deal.id)}`} className="crm-quote-btn">
                            Mở báo giá
                          </a>
                        ) : (
                          <button type="button" className="crm-quote-btn" onClick={() => onOpenQuoteVersion(deal, version.id)}>
                            Chỉnh sửa
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>

          {deal.note ? (
            <section>
              <h3 className="crm-section-title">Ghi chú</h3>
              <p className="crm-note">{deal.note}</p>
            </section>
          ) : null}

          {hasTerminalReview ? (
            <section id="crm-outcome-review" className="crm-outcome-review">
              <h3 className="crm-section-title">{deal.stage === 'won' ? 'Đánh giá thắng đã lưu' : 'Đánh giá thua đã lưu'}</h3>
              <div className="crm-outcome-review-grid">
                <OutcomeCard label="Kết quả" value={deal.outcome.result} />
                <OutcomeCard label="Độ chắc chắn" value={deal.outcome.confidence} />
                <OutcomeCard label="Lý do chính" value={deal.outcome.reasons?.join(', ')} />
                <OutcomeCard label="Trigger" value={deal.outcome.trigger} />
                <OutcomeCard label="Objection" value={deal.outcome.objection} />
                <OutcomeCard label="Ngày đánh giá" value={formatDateTime(deal.outcome.reviewedAt)} />
              </div>
              {deal.outcome.reasonText || deal.outcome.rootCause ? (
                <p className="crm-note crm-outcome-note">{deal.outcome.reasonText || deal.outcome.rootCause}</p>
              ) : null}
              {deal.outcome.evidence ? (
                <p className="crm-note crm-outcome-note"><b>Bằng chứng:</b> {deal.outcome.evidence}</p>
              ) : null}
              {deal.outcome.repeat || deal.outcome.improve ? (
                <div className="crm-outcome-review-grid">
                  <OutcomeCard label="Nên lặp lại" value={deal.outcome.repeat} />
                  <OutcomeCard label="Cần cải thiện" value={deal.outcome.improve} />
                  <OutcomeCard label="Use case" value={deal.outcome.reuseSegment} />
                  <OutcomeCard label="Knowledge tags" value={deal.outcome.knowledgeTags} />
                </div>
              ) : null}
            </section>
          ) : null}

          {!isTerminal && canWrite ? (
            <section>
              <h3 className="crm-section-title">Chuyển giai đoạn tiếp theo</h3>
              <div className="crm-current-stage">
                <span>Đang ở giai đoạn</span>
                <b>{stageMeta.label}</b>
              </div>
              <div className="crm-next-list">
                {allowedNextStages(deal.stage).map(stage => (
                  <button
                    key={stage}
                    type="button"
                    className={`crm-next-button ${DEAL_STAGE_META[stage].badgeClass}`}
                    onClick={() => onRequestTransition(deal, stage)}
                  >
                    <ArrowRight className="crm-line-icon" />
                    {DEAL_STAGE_META[stage].label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="crm-section-title">Lịch sử thay đổi giai đoạn</h3>
            {!deal.stageHistory.length ? <p className="crm-empty-log">Chưa có lịch sử.</p> : null}
            <ol className="crm-timeline">
              {deal.stageHistory.map(entry => (
                <li key={entry.id}>
                  <span className="crm-timeline-dot" />
                  <div className="crm-timeline-time">
                    {formatDateTime(entry.createdAt)} {entry.actor ? `- ${entry.actor}` : ''}
                  </div>
                  {entry.fromStage && entry.toStage ? (
                    <div className="crm-timeline-stage">
                      <b>{DEAL_STAGE_META[entry.fromStage].label}</b>
                      <ArrowRight className="crm-line-icon" />
                      <b>{DEAL_STAGE_META[entry.toStage].label}</b>
                    </div>
                  ) : (
                    <div className="crm-timeline-action">{entry.action}</div>
                  )}
                  {entry.note ? <p>{entry.note}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="crm-drawer-footer">
          <div className="crm-footer-actions">
            {isTerminal ? (
              <button
                type="button"
                className="crm-footer-button crm-footer-button--review"
                onClick={() => {
                  if (hasTerminalReview) onViewReview(deal);
                  else onRequestTransition(deal, deal.stage);
                }}
              >
                <CheckCircle2 className="crm-line-icon" />
                {hasTerminalReview ? (deal.stage === 'won' ? 'Xem đánh giá thắng' : 'Xem đánh giá thua') : (deal.stage === 'won' ? 'Đánh giá thắng' : 'Đánh giá thua')}
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="crm-footer-button" onClick={() => onEdit(deal)}>
                <UserCog className="crm-line-icon" /> Sửa thông tin
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="crm-footer-button crm-footer-button--delete" onClick={() => onDelete(deal)}>
                <Trash2 className="crm-line-icon" /> Xóa
              </button>
            ) : null}
          </div>
          <button type="button" className="crm-close-button" onClick={onClose}>Đóng</button>
        </footer>
      </aside>
    </>
  );
}

function InfoLine({ icon: Icon, text, strong }: { icon: typeof Building2; text?: string; strong?: boolean }) {
  return (
    <div className={`crm-info-line ${strong ? 'crm-info-line--strong' : ''}`}>
      <Icon className="crm-line-icon" />
      <span>{text}</span>
    </div>
  );
}

function MetaCard({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="crm-meta-card">
      <span><Icon className="crm-line-icon" /> {label}</span>
      <b>{value}</b>
    </div>
  );
}

function ContractCard({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value?: string | null }) {
  return (
    <div className="crm-contract-card">
      <span><Icon className="crm-line-icon" /> {label}</span>
      <b>{value || 'Chưa cập nhật'}</b>
    </div>
  );
}

function OutcomeCard({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="crm-outcome-card">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
