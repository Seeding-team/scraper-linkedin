'use client';

import { useEffect, useState } from 'react';
import { customerLeadService } from '@/services/customer-lead.service';
import type { Customer } from '@/services/customer-lead.service';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import { seedingContractRepository } from '../repositories/SeedingContractRepository';
import { CONTRACT_TEMPLATE_OPTIONS } from '../constants/contractConfig';
import type { ContractTemplateType } from '../types';
import { CurrencyInput } from '@/components/CurrencyInput';

interface UserOption {
  id: string;
  name: string;
}

export function ManualContractModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (contractId: string) => void;
}) {
  const [deals, setDeals] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [dealId, setDealId] = useState('');
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [title, setTitle] = useState('');
  const [templateType, setTemplateType] = useState<ContractTemplateType>('service');
  const [contractValue, setContractValue] = useState<number | null>(null);
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
    customerLeadService.getAll({ page_size: 200 }).then(res => setDeals(res.items)).catch(() => setDeals([]));
    fetch('/api/all-platform/users/all-profiles', { credentials: 'include' })
      .then(res => res.json())
      .then(body => setUsers((body?.data || []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))))
      .catch(() => setUsers([]));
  }, [open]);

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
    const deal = deals.find(d => d.id === dealId);
    if (deal && !title) setTitle(`Hợp đồng cung cấp dịch vụ — ${deal.customer_name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  function reset() {
    setDealId('');
    setManualCustomerName('');
    setQuoteId('');
    setTitle('');
    setTemplateType('service');
    setContractValue(null);
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
        manualCustomerName: dealId ? undefined : manualCustomerName.trim() || undefined,
        quoteId: quoteId || undefined,
        title: title.trim(),
        templateType,
        contractValue: contractValue ?? 0,
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

  return (
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
                Khách hàng CRM
                <select style={inputStyle} value={dealId} onChange={e => setDealId(e.target.value)}>
                  <option value="">-- Không liên kết --</option>
                  {deals.map(d => (
                    <option key={d.id} value={d.id}>{d.customer_name}{d.company_name ? ` — ${d.company_name}` : ''}</option>
                  ))}
                </select>
              </label>
              {!dealId ? (
                <label style={labelStyle}>
                  Tên khách hàng (nhập tay)
                  <input
                    style={inputStyle}
                    value={manualCustomerName}
                    onChange={e => setManualCustomerName(e.target.value)}
                    placeholder="Không chọn CRM ở trên thì nhập tên ở đây"
                  />
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
    </div>
  );
}
