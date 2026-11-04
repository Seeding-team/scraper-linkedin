'use client';

/** "+ Tạo cơ hội" mở từ Omnichannel Inbox (Zalo/Email/Facebook/Telegram...) khi hội thoại
 * CHƯA liên kết sẵn 1 Customer CRM nào - wrapper điều phối, KHÔNG viết lại DealFormModal/
 * DealFormFields/LeadFormDrawer/LeadDetailDrawer. Yêu cầu nghiệp vụ (mentor, 2026-10-31,
 * cập nhật lại cùng ngày thành wizard 4 bước tường minh sau khi phát hiện bản đầu "tạo Lead
 * xong tự đóng popup, không qua Xác minh"):
 *
 *   Bước 1 "Tạo Lead" -> Bước 2 "Xác minh Lead" -> Bước 3 "Chuyển thành khách hàng"
 *   -> Bước 4 "Tạo cơ hội".
 *
 * Bước 2 + Bước 3 dùng CHUNG 1 màn hình (`LeadDetailDrawer`, initialMode="qualify",
 * embedded) - đây CHÍNH LÀ nghiệp vụ Xác minh/Convert đã có (rule engine SQL +
 * RPC `crm_convert_lead`), KHÔNG viết lại. Wizard chỉ đổi nhãn bước active trên stepper và
 * chèn 1 màn hình "interstitial" của riêng wizard (thông báo + nút) giữa mỗi bước - KHÔNG
 * tự động nhảy bước, không tự đóng popup.
 *
 * Nếu hội thoại ĐÃ liên kết CRM (`prefill.customerId` có giá trị) hoặc tìm thấy đúng 1
 * Customer khớp SĐT/Email/tên công ty -> bỏ qua hết Lead, vào thẳng Bước 4 (y hệt "Tạo cơ
 * hội nhanh" cũ, dùng RPC `with-deal` dùng chung - KHÔNG đổi gì, các luồng tạo Deal khác
 * trong CRM như CreateOpportunityDrawer ở Chi tiết khách hàng không đi qua component này).
 *
 * Resume: nếu Lead tìm thấy đã convert xong (`convertedCustomerId` có giá trị) -> vào thẳng
 * Bước 4 luôn (không bắt xác minh lại). Nếu Lead tìm thấy CHƯA convert -> vào thẳng Bước 2
 * (không tạo Lead trùng, không hiện lại banner "vừa tạo xong").
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { DealFormModal } from '@/modules/crm/components/DealFormModal';
import { LeadFormDrawer } from '@/modules/crm/components/LeadFormDrawer';
import { LeadDetailDrawer } from '@/modules/crm/components/LeadDetailDrawer';
import { QuoteWorkspaceModal } from '@/modules/crm/components/QuoteWorkspaceModal';
import { RegisterExternalContractModal } from '@/components/all-platform/customers/RegisterExternalContractModal';
import { mapLead } from '@/modules/crm/components/LeadsDirectory';
import { seedingCrmRepository } from '@/modules/crm/repositories/SeedingCrmRepository';
import { notifyDealsChanged } from '@/modules/crm/utils/dealSync';
import { customerLeadService, type Customer as CustomerLeadRow } from '@/services/customer-lead.service';
import { CheckCircle2, Loader2 } from '@/modules/crm/components/icons';
import type { CreateDealInput, CrmCustomerSummary, CrmLeadRow, CrmUserOption, Deal, UpdateDealInput } from '@/modules/crm/types';
import type { QuoteForm } from '@/modules/quotes';
import type { Contract } from '@/modules/contracts';
import type { AppUser } from '@/types/unified.types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

export type QuickOpportunityPrefill = {
  name?: string;
  phone?: string;
  email?: string;
  companyName?: string;
  /** Hội thoại ĐÃ liên kết sẵn 1 Customer CRM (vd `currentLead.customer_id` ở
   * ZaloInboxAdminShell) - có giá trị thì bỏ qua hẳn luồng Lead-first. */
  customerId?: string | null;
};

/** 'deal'/'quote' nhu truoc. 'contract' = sau Buoc 3 "Chuyen thanh khach hang" con can
 * THEM 1 Co hoi (Deal) that - RegisterExternalContractModal bat buoc 1 dong Deal day du
 * de dien san Khach hang/Du an (xem CrmCustomerDetailPage.openRegisterContractForActiveDeal)
 * - Buoc 4 "Tao co hoi" dung lai y het mode='deal' (tu tao Deal neu Khach hang chua co Deal
 * nao), Buoc 5 moi mo RegisterExternalContractModal. 'find-customer' = dung cho nut "Tim
 * khach hang"/"+ Tao moi" o CRM 360 - CHI can Lead-first + xac minh + Customer san sang la
 * xong (KHONG tao Deal/Quote/Contract gi them), dung lai Buoc 3 "Chuyen thanh khach hang"
 * lam man hinh ket thuc luon (khong co Buoc 4). */
type WizardMode = 'deal' | 'quote' | 'contract' | 'find-customer';

type Phase =
  | 'resolving'
  | 'picker'
  | 'lead-form'
  | 'lead-created'
  | 'verify'
  | 'customer-linked'
  | 'deal-form'
  | 'deal-created'
  | 'quote-form'
  | 'contract-deal-check'
  | 'contract-form';

function stepLabels(mode: WizardMode): string[] {
  if (mode === 'find-customer') return ['Tạo Lead', 'Xác minh Lead', 'Chuyển thành khách hàng'];
  const step4 = mode === 'quote' ? 'Tạo báo giá' : 'Tạo cơ hội';
  if (mode === 'contract') return ['Tạo Lead', 'Xác minh Lead', 'Chuyển thành khách hàng', step4, 'Tạo hợp đồng'];
  return ['Tạo Lead', 'Xác minh Lead', 'Chuyển thành khách hàng', step4];
}

function stepNumberForPhase(phase: Phase): number {
  switch (phase) {
    case 'lead-form':
    case 'lead-created':
      return 1;
    case 'verify':
      return 2;
    case 'customer-linked':
      return 3;
    case 'deal-form':
    case 'deal-created':
    case 'quote-form':
      return 4;
    case 'contract-deal-check':
    case 'contract-form':
      return 5;
    default:
      return 0;
  }
}

function WizardStepper({ phase, mode }: { phase: Phase; mode: WizardMode }) {
  const current = stepNumberForPhase(phase);
  if (!current) return null;
  const labels = stepLabels(mode);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.7rem 0.85rem', borderBottom: '1px solid #eef1f5', background: '#fafbfc', flexWrap: 'nowrap', overflowX: 'auto' }}>
      {labels.map((label, idx) => {
        const n = idx + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: '50%', fontSize: '0.65rem', fontWeight: 800, flexShrink: 0,
                background: done ? '#16a34a' : active ? '#2f6fed' : '#e2e8f0',
                color: done || active ? '#fff' : '#94a3b8',
              }}
            >
              {done ? '✓' : n}
            </span>
            <span style={{ fontSize: '0.68rem', fontWeight: active ? 800 : 600, color: active ? '#1e293b' : '#94a3b8', whiteSpace: 'nowrap' }}>{label}</span>
            {n < labels.length ? <span style={{ width: 12, height: 1, background: '#dbe2ea', margin: '0 0.15rem', flexShrink: 0 }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function InterstitialScreen({
  title,
  message,
  note,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  message?: string;
  note?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div style={{ padding: '2.25rem 1.75rem', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
        <CheckCircle2 style={{ width: 40, height: 40, color: '#16a34a' }} />
      </div>
      <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>{title}</h3>
      {message ? <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0.5rem 0 0' }}>{message}</p> : null}
      {note ? <p style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '0.4rem' }}>{note}</p> : null}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.4rem' }}>
        {secondaryLabel && onSecondary ? (
          <button type="button" className="crm-secondary-button" onClick={onSecondary}>{secondaryLabel}</button>
        ) : null}
        <button type="button" className="crm-primary-button" onClick={onPrimary}>{primaryLabel}</button>
      </div>
    </div>
  );
}

export function QuickCreateOpportunityFromInbox({
  open,
  onClose,
  prefill,
  currentUser = null,
  agents = [],
  onCreated,
  mode = 'deal',
  quoteForms = [],
  defaultQuoteFormId,
  onQuoteChanged,
  onContractCreated,
  onCustomerLinked,
}: {
  open: boolean;
  onClose: () => void;
  prefill: QuickOpportunityPrefill;
  currentUser?: AppUser | null;
  agents?: CrmUserOption[];
  onCreated?: (deal: Deal) => void;
  /** 'deal' (mac dinh) = Buoc 4 mo DealFormModal nhu truoc. 'quote' = Buoc 4
   * mo thang QuoteWorkspaceModal (dung popup "+ Tao bao gia" chuan o tab Bao
   * gia cua Chi tiet khach hang) - khong bat buoc phai co Deal, chi can
   * Customer da xac minh/chuyen doi xong (chot voi mentor 2026-11-01).
   * 'contract'/'find-customer' xem comment tren type WizardMode. */
  mode?: WizardMode;
  quoteForms?: QuoteForm[];
  defaultQuoteFormId?: string;
  /** Forward tu QuoteWorkspaceModal.onChanged (CHI dung khi mode='quote') -
   * workspace tu luu/quan ly vong doi rieng (khong auto-dong nhu DealFormModal),
   * goi callback nay de trang Inbox cap nhat UI (vd toast, lam moi hoi thoai). */
  onQuoteChanged?: () => void;
  /** CHI dung khi mode='contract' - goi sau khi RegisterExternalContractModal tao
   * Contract that xong. */
  onContractCreated?: (contract: Contract) => void;
  /** CHI dung khi mode='find-customer' - goi khi Customer da san sang (moi tao/da co
   * san), de trang Inbox cap nhat lai crmData.matched cua hoi thoai (CRM 360 refresh). */
  onCustomerLinked?: (customer: CrmCustomerSummary) => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('resolving');
  const [customerMatches, setCustomerMatches] = useState<CrmCustomerSummary[]>([]);
  const [leadMatches, setLeadMatches] = useState<CrmLeadRow[]>([]);
  const [resolveError, setResolveError] = useState('');
  const [resolvedCustomer, setResolvedCustomer] = useState<CrmCustomerSummary | null>(null);
  const [resolvedLead, setResolvedLead] = useState<CrmLeadRow | null>(null);
  const [resolvedDeal, setResolvedDeal] = useState<CustomerLeadRow | null>(null);
  const [resumeNote, setResumeNote] = useState('');
  const [createdDeal, setCreatedDeal] = useState<Deal | null>(null);
  const [resolvingLabel, setResolvingLabel] = useState('Đang kiểm tra Khách hàng/Lead đã có…');
  const seqRef = useRef(0);
  const finalPhase: Phase = mode === 'quote' ? 'quote-form' : mode === 'contract' ? 'contract-deal-check' : mode === 'find-customer' ? 'customer-linked' : 'deal-form';

  useEffect(() => {
    if (!open) return;
    setResolvedCustomer(null);
    setResolvedLead(null);
    setResolvedDeal(null);
    setCustomerMatches([]);
    setLeadMatches([]);
    setResolveError('');
    setResumeNote('');
    setCreatedDeal(null);

    if (prefill.customerId) {
      setResolvedCustomer({
        id: prefill.customerId,
        customerName: prefill.name || '',
        companyName: prefill.companyName,
        phone: prefill.phone,
        email: prefill.email,
      });
      setPhase(finalPhase);
      return;
    }

    const phone = (prefill.phone || '').trim();
    const email = (prefill.email || '').trim();
    const companyQuery = (prefill.companyName || prefill.name || '').trim();
    if (!phone && !email && !companyQuery) {
      // Khong co gi de tim - khong the ket luan "da co san", di thang vao tao Lead.
      setPhase('lead-form');
      return;
    }

    setPhase('resolving');
    const seq = ++seqRef.current;
    void resolveMatches({ phone, email, companyQuery }).then(({ customers, leads, error }) => {
      if (seq !== seqRef.current) return;
      if (error) {
        setResolveError(error);
        setPhase('lead-form');
        return;
      }
      setCustomerMatches(customers);
      setLeadMatches(leads);
      if (customers.length === 1 && leads.length === 0) {
        setResolvedCustomer(customers[0]);
        setPhase(finalPhase);
      } else if (customers.length === 0 && leads.length === 1) {
        routeLeadMatch(leads[0]);
      } else if (customers.length === 0 && leads.length === 0) {
        setPhase('lead-form');
      } else {
        setPhase('picker');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill.customerId, prefill.phone, prefill.email, prefill.companyName, prefill.name]);

  /** mode='contract' - Buoc "Tao hop dong" (RegisterExternalContractModal) bat buoc 1 Deal
   * that. Khi vua vao phase nay (tu nut "Tiep tuc tao hop dong" HOAC tu cac nhanh resolve-
   * som nhay thang vao finalPhase), kiem tra Khach hang da co san Deal nao chua (GET .../
   * related, nguon du lieu THAT CrmCustomerDetailPage dung cho activeDeal) - co thi mo
   * thang Buoc 5, chua co thi quay ve Buoc 4 de tu tao Deal truoc (handleCreateViaCustomer
   * se tu dua tiep sang Buoc 5 sau khi tao xong, xem duoi). */
  useEffect(() => {
    if (phase !== 'contract-deal-check') return;
    const customerId = resolvedCustomer?.id;
    if (!customerId) { setPhase('deal-form'); return; }
    let cancelled = false;
    setResolvingLabel('Đang kiểm tra Cơ hội đã có…');
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/related`, {
          credentials: 'include',
          headers: headers(),
        });
        const body = await res.json();
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deals = (res.ok && body.success !== false ? (body.data?.deals || []) : []) as any[];
        if (deals.length > 0) {
          const full = await customerLeadService.getById(deals[0].id);
          if (cancelled) return;
          setResolvedDeal(full);
          setPhase('contract-form');
        } else {
          setResumeNote('Khách hàng chưa có Cơ hội nào — vui lòng tạo Cơ hội trước khi ghi nhận hợp đồng.');
          setPhase('deal-form');
        }
      } catch {
        if (cancelled) return;
        setResumeNote('Không kiểm tra được Cơ hội có sẵn — vui lòng tạo Cơ hội mới.');
        setPhase('deal-form');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, resolvedCustomer?.id]);

  async function resolveMatches(params: { phone: string; email: string; companyQuery: string }): Promise<{
    customers: CrmCustomerSummary[];
    leads: CrmLeadRow[];
    error?: string;
  }> {
    const { phone, email, companyQuery } = params;
    try {
      const customerQueries = [phone, email, companyQuery].filter(Boolean);
      const customerResults = await Promise.all(
        customerQueries.map(q => seedingCrmRepository.quickSearchCustomers(q, 5).catch(() => [] as CrmCustomerSummary[])),
      );
      const customersById = new Map<string, CrmCustomerSummary>();
      for (const list of customerResults) for (const row of list) customersById.set(row.id, row);

      const leadsById = new Map<string, CrmLeadRow>();
      if (phone || email) {
        const dupParams = new URLSearchParams();
        if (phone) dupParams.set('phone', phone);
        if (email) dupParams.set('email', email);
        const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/duplicate-check?${dupParams.toString()}`, {
          credentials: 'include',
          headers: headers(),
        });
        const body = await res.json();
        if (res.ok && body.success !== false) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const row of (body.data?.matches || []) as any[]) {
            const lead = mapLead(row);
            leadsById.set(lead.id, lead);
          }
        }
      }
      // "Ho tro tim theo ten cong ty" - CHI dung lead list-search lam fallback khi chua
      // tim duoc gi qua phone/email (tranh qua nhieu ket qua mo ho khi da co tin hieu
      // chinh xac hon).
      if (companyQuery && leadsById.size === 0 && customersById.size === 0) {
        const res = await fetch(
          `${API_BASE_URL}/api/all-platform/crm/leads?search=${encodeURIComponent(companyQuery)}&page_size=5`,
          { credentials: 'include', headers: headers() },
        );
        const body = await res.json();
        if (res.ok && body.success !== false) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const row of (body.data?.items || []) as any[]) {
            const lead = mapLead(row);
            leadsById.set(lead.id, lead);
          }
        }
      }
      return { customers: Array.from(customersById.values()), leads: Array.from(leadsById.values()) };
    } catch (err) {
      return {
        customers: [],
        leads: [],
        error: err instanceof Error ? err.message : 'Không kiểm tra được Khách hàng/Lead đã có — vui lòng kiểm tra lại thủ công.',
      };
    }
  }

  /** Quyet dinh buoc tiep theo tu 1 Lead tim thay (resolve/picker) hoac vua tao (Buoc 1) -
   * trung tam cua logic "resume" + "khong tao Lead trung". */
  function routeLeadMatch(lead: CrmLeadRow, opts?: { justCreated?: boolean }) {
    setResolvedLead(lead);
    if (lead.convertedCustomerId) {
      // Lead nay DA convert tu truoc (vd phien truoc dong popup sau Buoc 3, truoc khi
      // tao Deal) - khong bat xac minh lai, vao thang Buoc 4.
      setResolvedCustomer({
        id: lead.convertedCustomerId,
        customerName: lead.companyName || lead.leadName || '',
        companyName: lead.companyName,
        phone: lead.phone,
        email: lead.email,
      });
      setResumeNote(mode === 'quote' ? 'Đã nhận diện Lead/Khách hàng có sẵn — tiếp tục tạo báo giá.' : 'Đã nhận diện Lead/Khách hàng có sẵn — tiếp tục tạo cơ hội.');
      setPhase(finalPhase);
      return;
    }
    if (opts?.justCreated) {
      setPhase('lead-created');
      return;
    }
    setResumeNote('Đã tìm thấy Lead có sẵn — tiếp tục xác minh.');
    setPhase('verify');
  }

  function handleClose() {
    setPhase('resolving');
    onClose();
  }

  async function handleCreateViaCustomer(input: CreateDealInput) {
    try {
      const deal = await seedingCrmRepository.createDeal(input);
      setCreatedDeal(deal);
      if (mode === 'contract') {
        // mode='contract' dung Buoc 4 "Tao co hoi" nhu 1 buoc trung gian (Khach hang chua
        // co Deal nao) - tao xong di thang sang Buoc 5 "Tao hop dong", KHONG dung o man
        // hinh "Da tao co hoi thanh cong" (man hinh do chi danh cho mode='deal' thuc su).
        const full = await customerLeadService.getById(deal.id);
        setResolvedDeal(full);
        setPhase('contract-form');
        return;
      }
      setPhase('deal-created');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tạo được deal. Vui lòng kiểm tra lại thông tin.');
    }
  }

  function handleLeadConverted(result: { customerId: string; contactId: string; dealId: string }) {
    setResolvedCustomer({
      id: result.customerId,
      customerName: resolvedLead?.companyName || resolvedLead?.leadName || prefill.name || '',
      companyName: resolvedLead?.companyName || prefill.companyName,
      phone: resolvedLead?.phone || prefill.phone,
      email: resolvedLead?.email || prefill.email,
    });
    notifyDealsChanged();
    setPhase('customer-linked');
  }

  function handleViewOpportunity() {
    const deal = createdDeal;
    const customerId = resolvedCustomer?.id;
    if (deal) onCreated?.(deal);
    handleClose();
    if (customerId) router.push(`/all-platform/crm/customers/${encodeURIComponent(customerId)}?tab=quotes`);
  }

  function handleFinish() {
    const deal = createdDeal;
    if (deal) onCreated?.(deal);
    handleClose();
  }

  /** mode='find-customer' - "customer-linked" la man hinh KET THUC (khong co Buoc 4) - goi
   * callback rieng (KHAC onCreated, vi khong co Deal nao duoc tao) de trang Inbox danh dau
   * lai hoi thoai da lien ket CRM va lam moi CRM 360. */
  function handleFindCustomerFinish() {
    if (resolvedCustomer) onCustomerLinked?.(resolvedCustomer);
    handleClose();
  }

  function handleUpdateNoop(_id: string, _input: UpdateDealInput) {
    // Wrapper nay chi phuc vu tao moi - khong co nhanh "Sua deal".
  }

  if (!open) return null;

  if (phase === 'resolving' || phase === 'contract-deal-check') {
    return (
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={handleClose}>
        <div className="crm-modal" style={{ maxWidth: 360, margin: '20vh auto', padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
          <Loader2 className="crm-save-spinner" style={{ margin: '0 auto 0.6rem' }} />
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>{phase === 'resolving' ? 'Đang kiểm tra Khách hàng/Lead đã có…' : resolvingLabel}</p>
        </div>
      </div>
    );
  }

  if (phase === 'picker') {
    return (
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={handleClose}>
        <div className="crm-modal" style={{ maxWidth: 480, margin: '10vh auto', padding: '1.25rem', maxHeight: '75vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.25rem' }}>Chọn hồ sơ đã có</h2>
          <p style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.9rem' }}>
            Tìm thấy nhiều Khách hàng/Lead có thể khớp — chọn đúng hồ sơ để tiếp tục tạo cơ hội, tránh tạo Lead trùng.
          </p>
          {resolveError ? <p className="crm-error">{resolveError}</p> : null}
          {customerMatches.length ? (
            <>
              <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', margin: '0.5rem 0' }}>Khách hàng</p>
              {customerMatches.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setResolvedCustomer(c); setPhase(finalPhase); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.7rem', border: '1px solid #e2e8f0', borderRadius: '0.6rem', marginBottom: '0.4rem', background: '#fff', cursor: 'pointer' }}
                >
                  <b style={{ fontSize: '0.82rem' }}>{c.customerName || c.companyName || 'Khách hàng'}</b>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{[c.phone, c.email].filter(Boolean).join(' · ') || 'Chưa có SĐT/Email'}</div>
                </button>
              ))}
            </>
          ) : null}
          {leadMatches.length ? (
            <>
              <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', margin: '0.5rem 0' }}>Lead</p>
              {leadMatches.map(l => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => routeLeadMatch(l)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.7rem', border: '1px solid #e2e8f0', borderRadius: '0.6rem', marginBottom: '0.4rem', background: '#fff', cursor: 'pointer' }}
                >
                  <b style={{ fontSize: '0.82rem' }}>{l.leadName}</b>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{[l.phone, l.email].filter(Boolean).join(' · ') || 'Chưa có SĐT/Email'}</div>
                </button>
              ))}
            </>
          ) : null}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" className="crm-secondary-button" onClick={handleClose}>Hủy</button>
            <button type="button" className="crm-primary-button" onClick={() => setPhase('lead-form')}>
              Không có hồ sơ nào đúng, tạo Lead mới
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'lead-form') {
    return (
      <>
        <div
          style={{
            position: 'fixed', top: '0.6rem', left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
            background: '#1e293b', color: '#fff', fontSize: '0.7rem', fontWeight: 700,
            padding: '0.3rem 0.75rem', borderRadius: '999px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          }}
        >
          Bước 1/4 · Tạo Lead
        </div>
        <LeadFormDrawer
          open
          currentUser={currentUser}
          onClose={handleClose}
          onSaved={lead => routeLeadMatch(lead, { justCreated: true })}
          onOpenQualification={lead => routeLeadMatch(lead, { justCreated: true })}
          onOpenExistingLead={lead => routeLeadMatch(lead)}
          suppressAutoCloseOnSave
          initialValues={{
            leadName: prefill.name,
            phone: prefill.phone,
            email: prefill.email,
            companyName: prefill.companyName,
          }}
        />
      </>
    );
  }

  if (phase === 'lead-created') {
    return (
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={handleClose}>
        <div className="crm-modal" style={{ maxWidth: 600, margin: '14vh auto', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
          <WizardStepper phase={phase} mode={mode} />
          <InterstitialScreen
            title="Đã tạo Lead thành công."
            message="Tiếp theo, vui lòng xác minh Lead."
            primaryLabel="Tiếp tục xác minh"
            onPrimary={() => { setResumeNote(''); setPhase('verify'); }}
            secondaryLabel="Đóng"
            onSecondary={handleClose}
          />
        </div>
      </div>
    );
  }

  if (phase === 'verify') {
    return (
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={handleClose}>
        <div className="crm-modal" style={{ width: 'min(1120px, calc(100vw - 4rem))', maxWidth: 'min(1120px, calc(100vw - 4rem))', margin: '2vh auto', padding: 0, maxHeight: '96vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
          <WizardStepper phase={phase} mode={mode} />
          {resumeNote ? (
            <p style={{ fontSize: '0.74rem', color: '#2f6fed', background: '#eef4ff', margin: 0, padding: '0.5rem 1.1rem' }}>{resumeNote}</p>
          ) : null}
          <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
            <LeadDetailDrawer
              embedded
              lead={resolvedLead}
              open
              initialMode="qualify"
              currentUser={currentUser}
              onClose={handleClose}
              onSaved={lead => setResolvedLead(lead)}
              suppressNavigation
              onConverted={handleLeadConverted}
            />
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'customer-linked') {
    const isTerminal = mode === 'find-customer';
    const primaryLabel = isTerminal
      ? 'Hoàn tất'
      : mode === 'quote' ? 'Tiếp tục tạo báo giá' : mode === 'contract' ? 'Tiếp tục tạo hợp đồng' : 'Tiếp tục tạo cơ hội';
    return (
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={handleClose}>
        <div className="crm-modal" style={{ maxWidth: 600, margin: '14vh auto', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
          <WizardStepper phase={phase} mode={mode} />
          <InterstitialScreen
            title="Đã tạo/liên kết khách hàng thành công."
            message={resolvedCustomer?.customerName ? `Khách hàng: ${resolvedCustomer.customerName}` : undefined}
            primaryLabel={primaryLabel}
            onPrimary={isTerminal ? handleFindCustomerFinish : () => setPhase(finalPhase)}
            secondaryLabel={isTerminal ? (resolvedCustomer?.id ? 'Xem hồ sơ khách hàng' : undefined) : 'Đóng'}
            onSecondary={isTerminal
              ? (resolvedCustomer?.id ? () => {
                  const customerId = resolvedCustomer.id;
                  handleFindCustomerFinish();
                  router.push(`/all-platform/crm/customers/${encodeURIComponent(customerId)}`);
                } : undefined)
              : handleClose}
          />
        </div>
      </div>
    );
  }

  if (phase === 'deal-created') {
    return (
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={handleFinish}>
        <div className="crm-modal" style={{ maxWidth: 600, margin: '14vh auto', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
          <WizardStepper phase={phase} mode={mode} />
          <InterstitialScreen
            title="Đã tạo cơ hội thành công."
            message={createdDeal?.customerName ? `Khách hàng: ${createdDeal.customerName}` : undefined}
            primaryLabel="Hoàn tất"
            onPrimary={handleFinish}
            secondaryLabel="Xem cơ hội"
            onSecondary={handleViewOpportunity}
          />
        </div>
      </div>
    );
  }

  if (phase === 'quote-form') {
    // QuoteWorkspaceModal tu ve backdrop/chrome rieng VA tu quan ly vong doi (luu tai
    // cho, khong auto-dong sau khi luu nhu DealFormModal) - dung DUNG popup nguon chuan
    // o tab "Báo giá" cua Chi tiet khach hang (CrmCustomerDetailPage), chi khac
    // initialCustomerId = Customer THAT da resolve/convert o cac buoc truoc (khong con
    // dung nham conversation id lam customer id nhu ban truoc). Khong bat buoc phai co
    // Deal - initialCustomerId du de mo, "deals"/"dealsById" de trong nhu tai trang Inbox.
    return (
      <>
        <div
          style={{
            position: 'fixed', top: '0.6rem', left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
            background: '#1e293b', color: '#fff', fontSize: '0.7rem', fontWeight: 700,
            padding: '0.3rem 0.75rem', borderRadius: '999px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          }}
        >
          Bước 4/4 · Tạo báo giá
        </div>
        <QuoteWorkspaceModal
          quoteId={null}
          deals={[]}
          dealsById={new Map()}
          agents={agents}
          user={currentUser}
          defaultFormId={defaultQuoteFormId}
          quoteForms={quoteForms}
          initialCustomerId={resolvedCustomer?.id}
          lockCustomer
          onClose={handleClose}
          onChanged={() => { onQuoteChanged?.(); }}
          onEditDraft={() => {}}
        />
      </>
    );
  }

  if (phase === 'contract-form') {
    // RegisterExternalContractModal tu ve chrome rieng - dung DUNG popup "Ghi nhan hop
    // dong co san" da dung o tab Hop dong cua Chi tiet khach hang (CrmCustomerDetailPage.
    // openRegisterContractForActiveDeal), KHONG viet lai. "deal" prop that ra la 1 dong
    // Deal day du (type Customer trong customer-lead.service.ts) - da fetch day du o buoc
    // "contract-deal-check"/handleCreateViaCustomer truoc khi vao phase nay.
    if (!resolvedDeal) {
      return (
        <div className="crm-drawer-backdrop crm-lead-verify-backdrop" onClick={handleClose}>
          <div className="crm-modal" style={{ maxWidth: 360, margin: '20vh auto', padding: '1.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <Loader2 className="crm-save-spinner" style={{ margin: '0 auto 0.6rem' }} />
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Đang chuẩn bị thông tin Cơ hội…</p>
          </div>
        </div>
      );
    }
    return (
      <>
        <div
          style={{
            position: 'fixed', top: '0.6rem', left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
            background: '#1e293b', color: '#fff', fontSize: '0.7rem', fontWeight: 700,
            padding: '0.3rem 0.75rem', borderRadius: '999px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          }}
        >
          Bước 5/5 · Tạo hợp đồng
        </div>
        <RegisterExternalContractModal
          open
          deal={resolvedDeal}
          customerLabel={resolvedCustomer?.customerName}
          onClose={handleClose}
          onCreated={contract => {
            notifyDealsChanged();
            onContractCreated?.(contract);
            handleClose();
          }}
        />
      </>
    );
  }

  // phase === 'deal-form' — DealFormModal tu ve backdrop/chrome rieng (khong chen Stepper
  // vao trong duoc ma khong sua file do) - chi gan 1 badge nho goc tren bao buoc dang o.
  // mode='contract' cung di qua day khi Khach hang chua co Deal nao (xem comment o
  // handleCreateViaCustomer) - badge ghi dung buoc 4/5 thay vi 4/4 cho dung ngu canh.
  return (
    <>
      <div
        style={{
          position: 'fixed', top: '0.6rem', left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
          background: '#1e293b', color: '#fff', fontSize: '0.7rem', fontWeight: 700,
          padding: '0.3rem 0.75rem', borderRadius: '999px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        }}
      >
        {mode === 'contract' ? 'Bước 4/5 · Tạo cơ hội' : 'Bước 4/4 · Tạo cơ hội'}
      </div>
      <DealFormModal
        open
        onClose={handleClose}
        onCreate={input => void handleCreateViaCustomer(input)}
        onUpdate={handleUpdateNoop}
        agents={agents}
        currentUser={currentUser}
        initialCustomer={resolvedCustomer ? {
          id: resolvedCustomer.id,
          name: resolvedCustomer.customerName,
          companyName: resolvedCustomer.companyName,
          phone: resolvedCustomer.phone,
          email: resolvedCustomer.email,
        } : null}
      />
    </>
  );
}
