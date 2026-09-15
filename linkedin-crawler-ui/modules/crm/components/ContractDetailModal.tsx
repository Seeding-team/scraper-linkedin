'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, FileText, Wallet, X } from './icons';
import { formatDate, formatVND } from '../constants/crmConfig';
import type { Deal } from '../types';
import { seedingContractRepository } from '@/modules/contracts/repositories/SeedingContractRepository';
import type { Contract } from '@/modules/contracts';
import { contractStatusLabel } from '@/modules/contracts/constants/contractConfig';

type Props = {
  deal: Deal | null;
  open: boolean;
  onClose: () => void;
};

/** Nguon that: bang `contracts` canonical (xem docs/CRM_QUOTES_CONTRACTS_OVERVIEW.md).
 * KHONG con doc `deal.contract.*` (customer_leads.contract_status/last_attachment_*) -
 * do la field legacy, chi dung lam fallback hien thi khi deal chua co ban ghi
 * contracts nao, tranh 2 noi (Deal Workspace vs Customer 360) hien 2 trang thai khac
 * nhau cho cung 1 hop dong (xem CRM_CUSTOMER_360_PRD Phase 1 Foundation). */
function contractRows(contract: Contract) {
  return [
    { label: 'Số hợp đồng', value: contract.contractNumber, icon: FileText },
    { label: 'Tên hợp đồng', value: contract.title, icon: FileText },
    { label: 'Trạng thái', value: contractStatusLabel(contract.status), icon: FileText },
    { label: 'Giá trị hợp đồng', value: formatVND(contract.contractValue || 0), icon: Wallet },
    { label: '% đã thu', value: `${contract.paymentCollectedPercent || 0}%`, icon: Wallet },
    { label: 'Ngày bắt đầu', value: formatDate(contract.startDate), icon: CalendarDays },
    { label: 'Ngày kết thúc', value: formatDate(contract.endDate), icon: CalendarDays },
    { label: 'Ngày ký', value: formatDate(contract.signedAt), icon: CalendarDays },
  ];
}

export function ContractDetailModal({ deal, open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !deal) {
      setContracts([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    seedingContractRepository
      .getContracts({ dealId: deal.id })
      .then(rows => { if (alive) setContracts(rows); })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Không tải được hợp đồng.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, deal]);

  if (!open || !deal) return null;

  const contract = contracts[0] || null;

  return (
    <div className="crm-modal-backdrop crm-contract-detail-backdrop" onClick={onClose}>
      <section className="crm-contract-detail-modal" onClick={event => event.stopPropagation()}>
        <header className="crm-contract-detail-header">
          <div>
            <span>Chi tiết hợp đồng</span>
            <h2>{contract ? contract.contractNumber : 'Chưa có hợp đồng chính thức'}</h2>
            <p>{deal.position ? `${deal.customerName} - ${deal.position}` : deal.customerName}</p>
          </div>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>

        <div className="crm-contract-detail-body">
          {loading ? (
            <div className="crm-contract-detail-summary"><span>Đang tải...</span></div>
          ) : error ? (
            <div className="crm-contract-detail-summary"><span>{error}</span></div>
          ) : contract ? (
            <>
              <div className="crm-contract-detail-summary">
                <strong>{deal.companyName || 'Chưa có công ty'}</strong>
                <span>{contract.paymentTerms || 'Chưa có điều khoản thanh toán.'}</span>
              </div>
              <div className="crm-contract-detail-grid">
                {contractRows(contract).map(row => {
                  const Icon = row.icon;
                  return (
                    <article key={row.label} className="crm-contract-detail-card">
                      <span><Icon className="crm-line-icon" /> {row.label}</span>
                      <b>{row.value || 'Chưa cập nhật'}</b>
                    </article>
                  );
                })}
              </div>
              <a className="crm-contract-source-link" href={`/all-platform/contracts/${contract.id}`} target="_blank" rel="noopener noreferrer">
                <FileText className="crm-line-icon" />
                Mở trang chi tiết hợp đồng
              </a>
            </>
          ) : (
            <div className="crm-contract-detail-summary">
              <span>
                Deal này chưa có hợp đồng chính thức trong module Hợp đồng.
                {deal.contract?.status || deal.contract?.url ? (
                  <>
                    {' '}Dữ liệu cũ (chưa được tạo lại thành hợp đồng chính thức):{' '}
                    {deal.contract.status ? `trạng thái "${deal.contract.status}"` : ''}
                    {deal.contract?.url ? ' — có link/tệp đính kèm cũ' : ''}.
                  </>
                ) : null}
              </span>
            </div>
          )}
        </div>

        <footer className="crm-contract-detail-footer">
          <button type="button" className="crm-secondary-button" onClick={onClose}>Đóng</button>
        </footer>
      </section>
    </div>
  );
}
