'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { customerLeadService } from '@/services/customer-lead.service';
import type { Customer } from '@/services/customer-lead.service';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import { seedingCrmRepository } from '@/modules/crm/repositories/SeedingCrmRepository';
import type { CrmCustomerSummary } from '@/modules/crm/types';
import { seedingContractRepository } from '../repositories/SeedingContractRepository';
import { CONTRACT_TEMPLATE_OPTIONS, CONTRACT_STATUS_LABELS } from '../constants/contractConfig';
import type { ContractTemplateType, ContractStatus } from '../types';

const CONTRACT_STATUS_OPTIONS_FOR_CREATE: ContractStatus[] = [
  'draft', 'pending_signature', 'signed', 'active',
];
import { CurrencyInput } from '@/components/CurrencyInput';

interface UserOption {
  id: string;
  name: string;
}

export function ManualContractModal({
  open,
  onClose,
  onCreated,
  lockedDealId,
  lockedDealLabel,
  lockedCustomerId,
  lockedCustomerLabel,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (contractId: string) => void;
  /** Mở từ trong 1 Deal Workspace cụ thể — khoá cứng dealId, ẩn hẳn dropdown
   * chọn deal VÀ khối "Khách hàng CRM (không cần Deal)" (deal đã có sẵn
   * customer_id thật, contracts.customer_id sẽ tự suy ra từ deal_id ở service
   * layer — xem _resolve_customer_id() — không cần chọn lại). */
  lockedDealId?: string;
  lockedDealLabel?: string;
  /** Mở trực tiếp từ tab "Hợp đồng" ở Customer 360 (không qua 1 Deal cụ thể
   * nào) — khoá cứng customerId, ẩn hẳn dropdown chọn Deal VÀ ô tìm khách
   * hàng (đã biết chắc đang ở đúng khách hàng nào). Hợp đồng tạo ra dùng
   * DUNG con duong contracts.customer_id truc tiep (Phase 1), khong bat buoc
   * phai co Deal. Bo qua khi co lockedDealId (uu tien khoa theo Deal). */
  lockedCustomerId?: string;
  lockedCustomerLabel?: string;
}) {
  const [deals, setDeals] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [dealId, setDealId] = useState(lockedDealId || '');
  const [customerId, setCustomerId] = useState(lockedDealId ? '' : lockedCustomerId || '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CrmCustomerSummary[]>([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerFieldRef = useRef<HTMLDivElement>(null);
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [title, setTitle] = useState('');
  const [templateType, setTemplateType] = useState<ContractTemplateType>('service');
  const [contractValue, setContractValue] = useState<number | null>(null);
  const [status, setStatus] = useState<ContractStatus>('draft');
  const [signedAt, setSignedAt] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [progressPercent, setProgressPercent] = useState('0');
  const [paymentCollectedPercent, setPaymentCollectedPercent] = useState('0');
  const [ownerId, setOwnerId] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDealId(lockedDealId || '');
    setCustomerId(lockedDealId ? '' : lockedCustomerId || '');
    if (!lockedDealId && !lockedCustomerId) {
      customerLeadService.getAll({ page_size: 200 }).then(res => setDeals(res.items)).catch(() => setDeals([]));
    }
    fetch('/api/all-platform/users/all-profiles', { credentials: 'include' })
      .then(res => res.json())
      .then(body => setUsers((body?.data || []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))))
      .catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockedDealId, lockedCustomerId]);

  useEffect(() => {
    if (open && lockedCustomerId && lockedCustomerLabel && !title) {
      setTitle(`Hợp đồng cung cấp dịch vụ — ${lockedCustomerLabel}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockedCustomerId, lockedCustomerLabel]);

  useEffect(() => {
    if (!dealId) {
      setQuotes([]);
      setQuoteId('');
      return;
    }
    seedingQuoteRepository
      .getQuotes()
      .then(all => setQuotes(all.filter(q => q.dealId === dealId)))
      .catch(() => setQuotes([]));
    const dealName = lockedDealLabel || deals.find(d => d.id === dealId)?.customer_name;
    if (dealName && !title) setTitle(`Hợp đồng cung cấp dịch vụ — ${dealName}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  // Tim khach hang CRM that (crm_customers) khi khong chon Deal - dung chung
  // repository voi combobox khach hang o form tao deal (CustomerProfileCombobox),
  // de hop dong tao ra co the resolve ve Customer 360 (contracts.customer_id,
  // xem migration 130) thay vi chi la 1 chuoi ten nhap tay.
  useEffect(() => {
    const keyword = customerQuery.trim();
    if (dealId || !customerDropdownOpen || keyword.length < 2) {
      setCustomerResults([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      seedingCrmRepository
        .quickSearchCustomers(keyword, 8)
        .then(rows => { if (alive) setCustomerResults(rows); })
        .catch(() => { if (alive) setCustomerResults([]); });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [customerQuery, customerDropdownOpen, dealId]);

  useEffect(() => {
    if (!customerDropdownOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (customerFieldRef.current && !customerFieldRef.current.contains(event.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [customerDropdownOpen]);

  function reset() {
    setDealId(lockedDealId || '');
    setCustomerId(lockedDealId ? '' : lockedCustomerId || '');
    setCustomerQuery('');
    setCustomerResults([]);
    setCustomerDropdownOpen(false);
    setManualCustomerName('');
    setQuoteId('');
    setTitle('');
    setTemplateType('service');
    setContractValue(null);
    setStatus('draft');
    setSignedAt('');
    setStartDate('');
    setEndDate('');
    setPaymentTerms('');
    setProgressPercent('0');
    setPaymentCollectedPercent('0');
    setOwnerId('');
    setError('');
  }

  function closeAndReset() {
    if (saving) return;
    reset();
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError('Vui lòng nhập tiêu đề hợp đồng.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const contract = await seedingContractRepository.createContract({
        dealId: dealId || undefined,
        customerId: dealId ? undefined : customerId || undefined,
        manualCustomerName: dealId || customerId ? undefined : manualCustomerName.trim() || undefined,
        quoteId: quoteId || undefined,
        title: title.trim(),
        templateType,
        contractValue: contractValue ?? 0,
        status,
        signedAt: signedAt || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        paymentTerms: paymentTerms || undefined,
        progressPercent: Number(progressPercent) || 0,
        paymentCollectedPercent: Number(paymentCollectedPercent) || 0,
        ownerId: ownerId || undefined,
        aiGenerated: false,
      });
      onCreated(contract.id);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được hợp đồng.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '2.4rem',
    marginTop: '0.3rem',
    marginBottom: '0.8rem',
    borderRadius: '0.5rem',
    border: '1px solid #dce2e9',
    padding: '0 0.6rem',
  };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.78rem', fontWeight: 700 };

  // Portal ra document.body - dung y het fix da ap dung o CreateQuoteModal.tsx
  // (transform cua DealDetailDrawer's <aside> lam containing block cho
  // position:fixed neu khong portal, ep modal vao kich thuoc drawer).
  return createPortal(
    <div className="crm-modal-backdrop" onClick={closeAndReset}>
      <div className="crm-modal" onClick={event => event.stopPropagation()} style={{ maxWidth: '640px' }}>
        <header className="crm-modal-header">
          <div>
            <h2 className="crm-modal-title">Tạo hợp đồng thủ công</h2>
            <p className="crm-modal-subtitle">Không dùng AI — tự nhập thông tin, điều khoản có thể bổ sung sau ở trang chi tiết.</p>
          </div>
          <button type="button" className="crm-modal-close" onClick={closeAndReset} aria-label="Đóng" disabled={saving}>×</button>
        </header>

        <form id="manualContractForm" onSubmit={handleSubmit}>
          <div className="crm-modal-body">
            <label style={labelStyle}>
              Tiêu đề hợp đồng *
              <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} required />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <label style={labelStyle}>
                Cơ hội (Deal) liên kết
                {lockedDealId ? (
                  <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', background: '#f4f6f8', color: '#4a5568' }}>
                    {lockedDealLabel || 'Deal hiện tại'}
                  </div>
                ) : lockedCustomerId ? (
                  <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', background: '#f4f6f8', color: '#4a5568' }}>
                    Không gắn Deal — hợp đồng cho toàn bộ khách hàng
                  </div>
                ) : (
                  <select
                    style={inputStyle}
                    value={dealId}
                    onChange={e => {
                      setDealId(e.target.value);
                      if (e.target.value) {
                        setCustomerId('');
                        setCustomerQuery('');
                      }
                    }}
                  >
                    <option value="">-- Không liên kết --</option>
                    {deals.map(d => (
                      <option key={d.id} value={d.id}>{d.customer_name}{d.company_name ? ` — ${d.company_name}` : ''}</option>
                    ))}
                  </select>
                )}
              </label>
              {lockedCustomerId ? (
                <label style={labelStyle}>
                  Khách hàng CRM
                  <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', background: '#f4f6f8', color: '#4a5568' }}>
                    {lockedCustomerLabel || 'Khách hàng hiện tại'}
                  </div>
                </label>
              ) : !dealId ? (
                <label style={labelStyle}>
                  Khách hàng CRM (không cần Deal)
                  <div ref={customerFieldRef} style={{ position: 'relative' }}>
                    <input
                      style={inputStyle}
                      value={customerQuery}
                      onChange={e => {
                        setCustomerId('');
                        setCustomerQuery(e.target.value);
                        setManualCustomerName(e.target.value);
                      }}
                      onFocus={() => setCustomerDropdownOpen(true)}
                      placeholder="Gõ tên khách hàng đã có trong CRM..."
                    />
                    {customerDropdownOpen && customerResults.length > 0 ? (
                      <ul
                        style={{
                          position: 'absolute', zIndex: 20, left: 0, right: 0, top: '2.6rem',
                          background: '#fff', border: '1px solid #dce2e9', borderRadius: '0.5rem',
                          maxHeight: '200px', overflowY: 'auto', listStyle: 'none', margin: 0, padding: '0.25rem 0',
                          boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
                        }}
                      >
                        {customerResults.map(c => (
                          <li key={c.id}>
                            <button
                              type="button"
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.4rem 0.6rem', border: 'none', background: 'transparent', cursor: 'pointer' }}
                              onClick={() => {
                                setCustomerId(c.id);
                                setCustomerQuery(c.customerName);
                                setManualCustomerName('');
                                setCustomerDropdownOpen(false);
                              }}
                            >
                              {c.customerName}{c.companyName ? ` — ${c.companyName}` : ''}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {!customerId && customerQuery.trim() ? (
                    <span style={{ fontSize: '0.72rem', color: '#8a8f98', fontWeight: 400 }}>
                      Chưa chọn khách hàng có sẵn — sẽ lưu như tên nhập tay, chưa gắn được vào Customer 360.
                    </span>
                  ) : null}
                </label>
              ) : null}
              <label style={labelStyle}>
                Báo giá liên quan
                <select style={inputStyle} value={quoteId} onChange={e => setQuoteId(e.target.value)} disabled={!dealId}>
                  <option value="">-- Không đính kèm --</option>
                  {quotes.map(q => (
                    <option key={q.id} value={q.id}>{q.quoteNumber}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <label style={labelStyle}>
                Mẫu hợp đồng
                <select style={inputStyle} value={templateType} onChange={e => setTemplateType(e.target.value as ContractTemplateType)}>
                  {CONTRACT_TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label style={labelStyle}>
                Giá trị hợp đồng (VND)
                <CurrencyInput style={inputStyle} value={contractValue} onChange={setContractValue} />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <label style={labelStyle}>
                Trạng thái
                <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as ContractStatus)}>
                  {CONTRACT_STATUS_OPTIONS_FOR_CREATE.map(s => (
                    <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Ngày ký
                <input style={inputStyle} type="date" value={signedAt} onChange={e => setSignedAt(e.target.value)} />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <label style={labelStyle}>
                Ngày bắt đầu
                <input style={inputStyle} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </label>
              <label style={labelStyle}>
                Ngày kết thúc
                <input style={inputStyle} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </label>
            </div>

            <label style={labelStyle}>
              Điều khoản thanh toán
              <input style={inputStyle} placeholder="Ví dụ: 50% khi ký, 50% sau nghiệm thu" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem' }}>
              <label style={labelStyle}>
                Tiến độ (%)
                <input style={inputStyle} type="number" min={0} max={100} value={progressPercent} onChange={e => setProgressPercent(e.target.value)} />
              </label>
              <label style={labelStyle}>
                Đã thu (%)
                <input style={inputStyle} type="number" min={0} max={100} value={paymentCollectedPercent} onChange={e => setPaymentCollectedPercent(e.target.value)} />
              </label>
              <label style={labelStyle}>
                Phụ trách
                <select style={inputStyle} value={ownerId} onChange={e => setOwnerId(e.target.value)}>
                  <option value="">-- Tôi --</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            </div>

            {error ? <p className="crm-error">{error}</p> : null}
          </div>

          <footer className="crm-modal-footer">
            <div className="crm-footer-left">
              <button type="button" className="crm-cancel-button" onClick={closeAndReset} disabled={saving}>Hủy</button>
            </div>
            <div className="crm-footer-right">
              <button type="submit" className="crm-save-button" disabled={saving}>
                {saving ? 'Đang tạo...' : 'Tạo hợp đồng'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
