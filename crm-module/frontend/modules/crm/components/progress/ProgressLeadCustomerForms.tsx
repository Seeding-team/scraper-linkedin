'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { useMembers } from '@/hooks/useMembers';
import { LeadDetailDrawer } from '../LeadDetailDrawer';
import { CustomerQuickViewPanel } from '../CustomerQuickViewPanel';
import { mapLead } from '../LeadsDirectory';
import { mapCustomer } from '../CrmCustomersDirectory';
import type { CrmCustomerRow, CrmLeadRow } from '../../types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', headers: headers() });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(body?.message || 'Không tải được dữ liệu.');
  return body.data as T;
}

/** Form chi tiết Lead GIỐNG HỆT trang Leads ("Xác minh Lead" + "Sửa thông tin Lead"),
 * nhúng trong Quản lý tiến độ - tải lại Lead theo id rồi dùng đúng LeadDetailDrawer/LeadEditDrawer. */
export function ProgressLeadForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const { user } = useAppAuth();
  const [lead, setLead] = useState<CrmLeadRow | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLead(null);
    setError('');
    getJson<Parameters<typeof mapLead>[0]>(`/api/all-platform/crm/leads/${encodeURIComponent(leadId)}`)
      .then(row => {
        if (alive) setLead(mapLead(row));
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được Lead.');
      });
    return () => {
      alive = false;
    };
  }, [leadId]);

  if (error) return <p className="progress-error">{error}</p>;
  if (!lead) return <p className="crm-empty-log">Đang tải...</p>;

  return (
    <>
      <div className="progress-lead-form-actions">
        {/* Mở trang Leads và tự mở đúng form của lead này (deep link ?lead=<id> của LeadsDirectory) */}
        <button
          type="button"
          className="progress-view-in-leads-btn"
          onClick={() => router.push(`/all-platform/crm/leads?lead=${encodeURIComponent(lead.id)}`)}
        >
          Xem trong Leads <ExternalLink size={13} />
        </button>
      </div>
      {/* Chỉ xem: cùng nội dung "Xác minh Lead" của trang Leads, không sửa/lưu được ở đây */}
      <LeadDetailDrawer
        embedded
        readOnly
        lead={lead}
        open
        initialMode="view"
        currentUser={user}
        onClose={() => undefined}
        onSaved={() => undefined}
      />
    </>
  );
}

/** Form xem nhanh Khách hàng GIỐNG HỆT trang Khách hàng (CustomerQuickViewPanel). */
export function ProgressCustomerQuickView({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const router = useRouter();
  const { user } = useAppAuth();
  const { members } = useMembers();
  const [customer, setCustomer] = useState<CrmCustomerRow | null>(null);

  useEffect(() => {
    let alive = true;
    setCustomer(null);
    getJson<Parameters<typeof mapCustomer>[0]>(`/api/all-platform/crm/customers/${encodeURIComponent(customerId)}`)
      .then(row => {
        if (alive) setCustomer(mapCustomer(row));
      })
      .catch(() => {
        if (alive) setCustomer(null);
      });
    return () => {
      alive = false;
    };
  }, [customerId]);

  const ownerName = useMemo(() => {
    const m = (members || []).find(x => x.linked_user_id === customer?.ownerId || x.linked_user_id_2 === customer?.ownerId);
    if (m?.display_name) return m.display_name;
    if (user?.id && user.id === customer?.ownerId) return user.name || user.email || 'Chưa gán';
    return 'Chưa gán';
  }, [members, customer?.ownerId, user]);

  const returnUrl = () => `${window.location.pathname}${window.location.search}`;

  return (
    <>
    <CustomerQuickViewPanel
      open={Boolean(customer)}
      customer={customer}
      ownerName={ownerName}
      onClose={onClose}
      embedded
      onCreateOpportunity={() => undefined}
      onOpenDetail={(id, tab) => router.push(`/all-platform/crm/customers/${id}${tab ? `?tab=${tab}` : ''}`)}
      onOpenQuote={(quoteId, id) =>
        router.push(
          `/all-platform/crm/quotes/${encodeURIComponent(quoteId)}?${new URLSearchParams({ customerId: id, returnUrl: returnUrl() }).toString()}`
        )
      }
      onOpenContract={contractId =>
        router.push(`/all-platform/contracts/${encodeURIComponent(contractId)}?${new URLSearchParams({ returnUrl: returnUrl() }).toString()}`)
      }
      currentUser={user}
      onCustomerUpdated={updated => setCustomer(updated)}
    />
    </>
  );
}
