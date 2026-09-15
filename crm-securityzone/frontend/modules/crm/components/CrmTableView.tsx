'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from './icons';
import { DEAL_STAGE_META, formatDate, formatVND, getContractLabel } from '../constants/crmConfig';
import type { Deal } from '../types';
import { getTeamTypeLabel } from '@/lib/teamTypes';

type SortKey = 'customerName' | 'sourcePlatform' | 'stage' | 'estimatedBudget' | 'createdAt';

export function CrmTableView({
  deals,
  onCardClick,
  onContractClick,
  onEdit,
  onDelete,
}: {
  deals: Deal[];
  onCardClick: (deal: Deal) => void;
  onContractClick: (deal: Deal) => void;
  onEdit: (deal: Deal) => void;
  onDelete: (deal: Deal) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedDeals = useMemo(() => {
    return [...deals].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : bv > av ? 1 : -1;
    });
  }, [deals, sortDir, sortKey]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? <ChevronUp className="crm-sort-icon" /> : <ChevronDown className="crm-sort-icon" />;
  }

  return (
    <div className="crm-table-card">
      <div className="crm-table-scroll">
        <table className="crm-table">
          <colgroup>
            <col className="crm-col-customer" />
            <col className="crm-col-contact" />
            <col className="crm-col-source" />
            <col className="crm-col-stage" />
            <col className="crm-col-budget" />
            <col className="crm-col-decision" />
            <col className="crm-col-contract" />
            <col className="crm-col-follow" />
            <col className="crm-col-created" />
            <col className="crm-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th className="crm-th crm-th--clickable" onClick={() => toggleSort('customerName')}>
                <span>Khách hàng {sortIcon('customerName')}</span>
              </th>
              <th className="crm-th">Liên hệ</th>
              <th className="crm-th crm-th--clickable" onClick={() => toggleSort('sourcePlatform')}>
                <span>Nguồn {sortIcon('sourcePlatform')}</span>
              </th>
              <th className="crm-th crm-th--clickable" onClick={() => toggleSort('stage')}>
                <span>Giai đoạn {sortIcon('stage')}</span>
              </th>
              <th className="crm-th crm-th--right crm-th--clickable" onClick={() => toggleSort('estimatedBudget')}>
                Ngân sách
              </th>
              <th className="crm-th">Người quyết định</th>
              <th className="crm-th">HĐ/BG</th>
              <th className="crm-th">Follow-up</th>
              <th className="crm-th crm-th--clickable" onClick={() => toggleSort('createdAt')}>
                Ngày tạo
              </th>
              <th className="crm-th crm-th--right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {sortedDeals.map(deal => (
              <tr key={deal.id} className="crm-row" onClick={() => onCardClick(deal)}>
                <td className="crm-td">
                  <div className="crm-customer-name">
                    {deal.position ? `${deal.customerName} - ${deal.position}` : deal.customerName}
                  </div>
                  <div className="crm-muted">{deal.companyName || 'Chưa có công ty'}</div>
                  {deal.teamType ? (
                    <div className="crm-service-tag crm-service-tag--team" style={{ marginTop: 4, display: 'inline-flex' }} title={deal.teamName ? `Team: ${deal.teamName}` : undefined}>
                      <span>{getTeamTypeLabel(deal.teamType)}</span>
                    </div>
                  ) : null}
                </td>
                <td className="crm-td crm-contact-cell">
                  {deal.phone ? (
                    <a className="crm-contact-link" href={`tel:${deal.phone.replace(/[^\d+]/g, '')}`} onClick={event => event.stopPropagation()}>
                      {deal.phone}
                    </a>
                  ) : (
                    <div className="crm-small">-</div>
                  )}
                  {deal.email ? (
                    <a className="crm-contact-link crm-muted crm-truncate" href={`mailto:${deal.email}`} onClick={event => event.stopPropagation()}>
                      {deal.email}
                    </a>
                  ) : (
                    <div className="crm-muted crm-truncate">-</div>
                  )}
                </td>
                <td className="crm-td">
                  <span className="crm-source-badge">{deal.sourcePlatform || 'Manual'}</span>
                </td>
                <td className="crm-td">
                  <span className={`crm-stage-badge ${DEAL_STAGE_META[deal.stage].badgeClass}`}>
                    {DEAL_STAGE_META[deal.stage].label}
                  </span>
                  <div className="crm-muted crm-stage-days">{deal.daysInStage} ngày ở giai đoạn</div>
                </td>
                <td className="crm-td crm-td--right crm-budget">{deal.estimatedBudget != null ? formatVND(deal.estimatedBudget) : '-'}</td>
                <td className="crm-td crm-small">{deal.decisionMaker || '-'}</td>
                <td className="crm-td crm-small">
                  {getContractLabel(deal) ? (
                    <button
                      type="button"
                      className="crm-table-contract-link"
                      onClick={event => {
                        event.stopPropagation();
                        onContractClick(deal);
                      }}
                    >
                      {getContractLabel(deal)}
                    </button>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="crm-td crm-small crm-follow-up">{formatDate(deal.followUpDate) || '-'}</td>
                <td className="crm-td crm-muted">{formatDate(deal.createdAt) || '-'}</td>
                <td className="crm-td">
                  <div className="crm-row-actions" onClick={event => event.stopPropagation()}>
                    <button type="button" className="crm-row-action" onClick={() => onEdit(deal)}>
                      Sửa
                    </button>
                    <button type="button" className="crm-row-action crm-row-action--delete" onClick={() => onDelete(deal)}>
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!sortedDeals.length ? (
              <tr>
                <td colSpan={10} className="crm-empty-cell">
                  Chưa có deal nào
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
