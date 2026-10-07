'use client';

/** Mo QUOTE WORKSPACE THAT (QuoteWorkspaceModal hien co) dang overlay tren Lead 360.
 *
 * Khong viet lai UI bao gia, khong navigate sang trang khac: chi nap cac du lieu ma Workspace can
 * (co hoi, mau bao gia, cong ty phat hanh) bang chinh cac repository hien co roi render modal nhu CrmCustomerDetailPage.
 * User xem/chinh sua/hoan thien gia/duyet theo QUYEN hien tai cua Workspace.
 * Dong Workspace -> goi onClose (Lead 360 refetch overview ngay de tien do, viec hien tai, gia/trang thai bao gia, timeline cap nhat). */

import { useEffect, useMemo, useState } from 'react';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { IssuerCompany, QuoteForm } from '@/modules/quotes';
import { seedingCrmRepository } from '../../repositories/SeedingCrmRepository';
import type { Deal } from '../../types';
import { QuoteWorkspaceModal } from '../QuoteWorkspaceModal';

export function LeadQuoteWorkspaceHost({
  quoteId,
  dealId,
  customerId,
  onClose,
  onChanged,
}: {
  /** Id bao gia, hoac 'new' = tao yeu cau bao gia MOI cho co hoi cua Lead (create-mode cua Workspace). */
  quoteId: string;
  dealId: string | null;
  customerId: string | null;
  onClose: () => void;
  /** Quote Workspace bao "du lieu da doi" (luu/duyet/doi buoc...) -> Lead 360 refetch ngay. */
  onChanged: () => void;
}) {
  const { user } = useAppAuth();
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(quoteId === 'new' ? null : quoteId);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [forms, setForms] = useState<QuoteForm[]>([]);
  const [issuers, setIssuers] = useState<IssuerCompany[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setReady(false);
    setError('');
    Promise.all([
      dealId ? seedingCrmRepository.getDeal(dealId).catch(() => null) : Promise.resolve(null),
      seedingQuoteRepository.getForms().catch(() => [] as QuoteForm[]),
      seedingQuoteRepository.getIssuerCompanies().catch(() => [] as IssuerCompany[]),
    ]).then(([dealRow, formRows, issuerRows]) => {
      if (!alive) return;
      setDeal(dealRow);
      setForms(formRows);
      setIssuers(issuerRows);
      setReady(true);
    }).catch(() => {
      if (alive) setError('Không tải được dữ liệu để mở báo giá.');
    });
    return () => { alive = false; };
  }, [dealId]);

  const dealsById = useMemo(() => new Map<string, Deal>(deal ? [[deal.id, deal]] : []), [deal]);

  // Mau bao gia mac dinh: cung quy tac voi trang Khach hang (mau cong ty phat hanh dau tien -> mau mac dinh -> mau dau tien khong phai villa).
  const defaultFormId = useMemo(() => {
    const nonVilla = forms.filter(f => f.schemaJson?.layoutType !== 'villa_solution_package');
    const issuerDefault = issuers[0]?.defaultQuoteFormId ? nonVilla.find(f => f.id === issuers[0].defaultQuoteFormId)?.id : undefined;
    return issuerDefault || nonVilla.find(f => f.isDefaultTemplate)?.id || nonVilla[0]?.id;
  }, [forms, issuers]);

  if (error) {
    return (
      <div className="crm-modal-backdrop" style={{ zIndex: 100200 }} onClick={onClose}>
        <div className="crm-modal" onClick={e => e.stopPropagation()} style={{ padding: 20 }}>
          <p>{error}</p>
          <button type="button" className="qc-btn" onClick={onClose}>Đóng</button>
        </div>
      </div>
    );
  }
  if (!ready) return null;

  return (
    <QuoteWorkspaceModal
      quoteId={activeQuoteId}
      deals={deal ? [deal] : []}
      dealsById={dealsById}
      agents={[]}
      user={user}
      defaultFormId={defaultFormId}
      quoteForms={forms}
      initialCustomerId={customerId || undefined}
      initialDealId={dealId || undefined}
      lockCustomer
      onClose={onClose}
      onChanged={onChanged}
      onEditDraft={editQuote => setActiveQuoteId(editQuote.id)}
    />
  );
}
