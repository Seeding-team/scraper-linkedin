'use client';

import {
  Building2,
  CalendarDays,
  Clock,
  FileText,
  Mail,
  MapPin,
  MoreVertical,
  PauseCircle,
  Phone,
  Tag,
  UserCog,
  Wallet,
} from './icons';
import {
  formatDate,
  formatVND,
  getContractLabel,
  getContractUrl,
  getContractStatusText,
  getPackageText,
  getServicePackageText,
  getBillingTypeLabel,
} from '../constants/crmConfig';
import type { Deal } from '../types';
import { getTeamTypeLabel } from '@/lib/teamTypes';

type DealCardProps = {
  deal: Deal;
  terminal?: boolean;
  onClick: (deal: Deal) => void;
  onContractClick: (deal: Deal) => void;
  onCreateQuote?: (deal: Deal) => void;
  onDragStart?: (event: React.DragEvent, deal: Deal) => void;
};

function normalizePhone(value?: string) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function ensureUrl(value?: string, fallbackBase = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return fallbackBase ? `${fallbackBase}${raw.replace(/^@/, '')}` : raw;
}

function getZaloHref(deal: Deal) {
  if (/^https?:\/\//i.test(deal.zalo || '')) return deal.zalo || '';
  const phone = normalizePhone(deal.zalo || deal.phone);
  return phone ? `https://zalo.me/${phone.replace(/^\+84/, '0')}` : '';
}

function getDisplayName(deal: Deal) {
  return deal.customerName;
}

function getOwnerInitial(deal: Deal) {
  return String(deal.assignment.sdrName || deal.assignment.leadName || '')
    .charAt(0)
    .toUpperCase();
}

function isPaymentDueWarning(deal: Deal) {
  if (!deal.contract.paymentDueDate || deal.contract.paymentStatus === 'da_thanh_toan') {
    return false;
  }
  const due = new Date(deal.contract.paymentDueDate);
  due.setHours(23, 59, 59, 999);
  return due.getTime() <= Date.now();
}

export function DealCard({ deal, terminal, onClick, onCreateQuote, onDragStart }: DealCardProps) {
  const value = Number(deal.quote?.totalAmount || deal.estimatedBudget || deal.lifetimeValue || 0);
  const contractUrl = getContractUrl(deal);
  const contractLabel = getContractLabel(deal) || (contractUrl ? 'Mở link' : '');
  const contactActions = [
    deal.phone && { key: 'phone', label: 'Gọi điện', href: `tel:${normalizePhone(deal.phone)}`, icon: Phone },
    getZaloHref(deal) && { key: 'zalo', label: 'Zalo', href: getZaloHref(deal), mark: 'Z' },
    ensureUrl(deal.facebook, 'https://facebook.com/') && {
      key: 'facebook',
      label: 'Facebook',
      href: ensureUrl(deal.facebook, 'https://facebook.com/'),
      mark: 'f',
    },
    ensureUrl(deal.telegram, 'https://t.me/') && {
      key: 'telegram',
      label: 'Telegram',
      href: ensureUrl(deal.telegram, 'https://t.me/'),
      mark: 'TG',
    },
    deal.email && { key: 'email', label: 'Email', href: `mailto:${deal.email}`, icon: Mail },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    href: string;
    icon?: typeof Phone;
    mark?: string;
  }>;

  return (
    <article
      className={`crm-deal-card ${terminal ? 'crm-deal-card--terminal' : ''} ${
        isPaymentDueWarning(deal) ? 'crm-deal-card--payment-due' : ''
      }`}
      data-crm-deal-row="true"
      draggable
      onDragStart={event => onDragStart?.(event, deal)}
      onClick={() => onClick(deal)}
    >
      {deal.teamType ? (
        <div className="crm-team-ribbon" title={deal.teamName ? `Team: ${deal.teamName}` : undefined}>
          {getTeamTypeLabel(deal.teamType)}
        </div>
      ) : null}

      <div className="crm-card-header">
        <div className="crm-card-title">
          <h4 title={getDisplayName(deal)}>{getDisplayName(deal)}</h4>
          <p title={deal.companyName}>{deal.companyName || 'Chưa có công ty'}</p>
        </div>
        <button type="button" className="crm-card-menu" aria-label="Thao tác deal">
          <MoreVertical className="crm-card-menu-icon" />
        </button>
      </div>

      <div className="crm-card-tags">
        {deal.servicePackage ? (
          <div className="crm-service-tag crm-service-tag--category" title={getServicePackageText(deal.servicePackage)}>
            <Tag className="crm-line-icon" />
            <span>Danh mục: {getServicePackageText(deal.servicePackage)}</span>
          </div>
        ) : null}
        {deal.package ? (
          <div className="crm-service-tag crm-service-tag--package" title={`Gói: ${getPackageText(deal.package)}`}>
            <Tag className="crm-line-icon" />
            <span>Gói: {getPackageText(deal.package)}</span>
          </div>
        ) : null}
      </div>

      {contactActions.length || (onCreateQuote && !deal.quote) ? (
        <div className="crm-contact-actions">
          {contactActions.map(action => {
            const Icon = action.icon;
            return (
              <a
                key={action.key}
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                title={action.label}
                className={`crm-contact-action crm-contact-action--${action.key}`}
                onClick={event => event.stopPropagation()}
              >
                {Icon ? <Icon className="crm-line-icon" /> : <span className="crm-social-mark">{action.mark}</span>}
              </a>
            );
          })}
          {onCreateQuote && !deal.quote ? (
            <button
              type="button"
              title="Tạo báo giá cho deal này"
              className="crm-contact-action crm-contact-action--quote"
              onClick={event => {
                event.stopPropagation();
                onCreateQuote(deal);
              }}
            >
              <FileText className="crm-line-icon" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="crm-extra-lines">
        {deal.position ? (
          <div title={deal.position}>
            <UserCog className="crm-line-icon" />
            Chức vụ: {deal.position}
          </div>
        ) : null}
        {deal.city ? (
          <div title={deal.city}>
            <MapPin className="crm-line-icon" />
            {deal.city}
          </div>
        ) : null}
        {deal.industry ? (
          <div title={deal.industry}>
            <Building2 className="crm-line-icon" />
            {deal.industry}
          </div>
        ) : null}
        {deal.decisionMaker ? (
          <div title={deal.decisionMaker}>
            <UserCog className="crm-line-icon" />
            {deal.decisionMaker}
          </div>
        ) : null}
      </div>

      <div className="crm-assignee-lines">
        <div title={`Quản lý: ${deal.assignment.leadName || 'Chưa phân công'}`}>
          <UserCog className="crm-line-icon" />
          <span>Quản lý: {deal.assignment.leadName || 'Chưa phân công'}</span>
        </div>
        <div title={`Phụ trách: ${deal.assignment.sdrName || deal.assignment.leadName || 'Chưa phân công'}`}>
          <UserCog className="crm-line-icon" />
          <span>Phụ trách: {deal.assignment.sdrName || deal.assignment.leadName || 'Chưa phân công'}</span>
        </div>
      </div>

      {deal.stage === 'on_hold' && deal.pauseReason ? (
        <div className="crm-pause-reason" title={deal.pauseReason}>
          <PauseCircle className="crm-line-icon" />
          <span>Lý do tạm dừng: {deal.pauseReason}</span>
        </div>
      ) : null}

      <div className="crm-deal-meta-lines">
        {contractLabel || contractUrl ? (
          <button
            type="button"
            className="crm-deal-meta-link crm-deal-contract-link"
            title={contractUrl ? `Mở link ${contractLabel}` : 'Deal này chưa có link HĐ/BG.'}
            onClick={event => {
              event.stopPropagation();
              if (!contractUrl) {
                window.alert('Deal này chưa có link HĐ/BG.');
                return;
              }
              window.open(contractUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            <FileText className="crm-line-icon" />
            <span>HĐ/BG: {contractLabel}</span>
          </button>
        ) : null}
        {deal.contract.status ? (
          <div className="crm-deal-meta-status">
            <FileText className="crm-line-icon" />
            <span>Hợp đồng: {getContractStatusText(deal.contract.status)}</span>
          </div>
        ) : null}
        <div className="crm-deal-meta-status">
          <Wallet className="crm-line-icon" />
          <span>Thanh toán: {getBillingTypeLabel(deal.billingType)}</span>
        </div>
      </div>

      {value > 0 ? (
        <div className="crm-budget-row">
          <Wallet className="crm-budget-icon" />
          <span>{formatVND(value)}</span>
          <b>Giá trị</b>
        </div>
      ) : null}

      {isPaymentDueWarning(deal) ? (
        <div className="crm-payment-warning-row">
          <CalendarDays className="crm-line-icon" />
          <span>Tới hạn thanh toán: {formatDate(deal.contract.paymentDueDate)}</span>
          <b>Cần xử lý</b>
        </div>
      ) : null}

      <div className="crm-card-footer">
        <div className="crm-days">
          <Clock className="crm-days-icon" />
          {deal.daysInStage} ngày
        </div>
        {getOwnerInitial(deal) ? (
          <div className="crm-owner-avatar" title={deal.assignment.sdrName || deal.assignment.leadName}>
            {getOwnerInitial(deal)}
          </div>
        ) : (
          <div className="crm-owner-empty">?</div>
        )}
      </div>
    </article>
  );
}
