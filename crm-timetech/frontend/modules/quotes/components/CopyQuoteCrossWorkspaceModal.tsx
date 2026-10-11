'use client';

/**
 * "Copy báo giá sang khách hàng khác hoặc workspace khác" (2026-10-03, Phase
 * 1 — chỉ Copy, Move để sau; hỗ trợ chọn NHIỀU báo giá cùng lúc, copy sang
 * CÙNG 1 ngữ cảnh đích). Chỉ admin có `allowed_instances` chứa workspace đích
 * (hoặc workspace đích = workspace hiện tại, không cần cấp thêm) mới dùng
 * được - backend tự chặn (403/message rõ), modal này KHÔNG tự kiểm tra
 * quyền, chỉ ẩn nút trigger khi role khác admin (xem nơi gọi).
 */

import { useEffect, useRef, useState } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import { DealFormModal } from '../../crm/components/DealFormModal';
import { seedingCrmRepository } from '../../crm/repositories/SeedingCrmRepository';
import type { Quote } from '../types';

const WORKSPACE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'markee', label: 'Markee' },
  { value: 'cloudgate', label: 'CloudGate' },
  { value: 'SECURITYZONE', label: 'SecurityZone' },
];

type TargetCustomer = { id: string; customer_name: string; company_name?: string | null; phone?: string | null; email?: string | null };
type TargetProject = { id: string; name: string; project_code?: string | null };
type TargetDeal = { id: string; customer_name?: string | null; company_name?: string | null; deal_stage?: string | null; project_id?: string | null };
type TargetContact = { id: string; name: string; phone?: string | null; email?: string | null };

/** Reusable custom dropdown to replace ugly native browser HTML select */
function CustomSelect<T extends string>({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; subtext?: string }>;
  placeholder: string;
  disabled?: boolean;
  onChange: (val: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const selectedOpt = options.find(o => o.value === value);

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`w-full h-10 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl shadow-sm flex items-center justify-between transition-all text-left ${
          disabled
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200'
            : 'hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#c2185b]/20 focus:border-[#c2185b] cursor-pointer text-slate-800'
        }`}
      >
        <span className={selectedOpt ? 'font-medium text-slate-800' : 'text-slate-400'}>
          {selectedOpt ? selectedOpt.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-[#c2185b]' : ''}`} />
      </button>

      {open && !disabled ? (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-56 overflow-y-auto p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
            onClick={() => { onChange('' as T); setOpen(false); }}
          >
            {placeholder}
          </button>
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-pink-50 text-[#c2185b] font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex flex-col">
                  <span>{opt.label}</span>
                  {opt.subtext ? <span className="text-xs text-slate-400 font-normal">{opt.subtext}</span> : null}
                </div>
                {isSelected ? <Check className="w-4 h-4 text-[#c2185b]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Combobox tìm khách hàng đích */
function TargetCustomerCombobox({
  targetInstance,
  onPick,
  onCreateNew,
}: {
  targetInstance: string;
  onPick: (customer: TargetCustomer) => void;
  onCreateNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TargetCustomer[]>([]);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      seedingQuoteRepository
        .searchCrossWorkspaceCustomers(targetInstance, query.trim())
        .then(setResults)
        .catch(err => {
          setError(err instanceof Error ? err.message : 'Không tìm được khách hàng.');
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, targetInstance]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="crm-customer-combobox relative w-full" ref={containerRef}>
      <input
        type="search"
        className="w-full h-10 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#c2185b]/20 focus:border-[#c2185b] text-slate-800 placeholder-slate-400"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        placeholder="Tìm theo tên, SĐT hoặc email..."
        autoComplete="new-password"
        name="xws_customer_search_query_no_autofill"
        role="combobox"
        aria-expanded={open}
        data-1p-ignore="true"
        data-lpignore="true"
      />
      {open ? (
        <div className="crm-customer-combobox-menu absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-60 overflow-y-auto p-1.5 flex flex-col gap-0.5 divide-y divide-slate-100 text-sm">
          {loading ? <p className="px-3 py-2 text-xs text-slate-500 italic">Đang tìm khách hàng...</p> : null}
          {!loading && error ? <p className="px-3 py-2 text-xs text-red-500">{error}</p> : null}
          {!loading && !error && !results.length ? <p className="px-3 py-2 text-xs text-slate-500">Không tìm thấy khách hàng nào khớp.</p> : null}
          {!loading && results.map(c => (
            <button
              type="button"
              key={c.id}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex flex-col transition-colors cursor-pointer"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(c); setOpen(false); setQuery(''); }}
            >
              <strong className="text-slate-800 font-medium text-sm">{c.customer_name}</strong>
              <span className="text-xs text-slate-500 font-normal mt-0.5">{[c.company_name, c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span>
            </button>
          ))}
          <button
            type="button"
            className="w-full text-left px-3 py-2.5 text-xs font-semibold text-[#c2185b] hover:bg-pink-50/60 rounded-lg flex items-center gap-1 cursor-pointer transition-colors border-t border-slate-100 mt-1"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onCreateNew(); setOpen(false); }}
          >
            + Tạo khách hàng mới ở workspace này
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CopyQuoteCrossWorkspaceModal({
  quotes,
  onClose,
  onCopied,
}: {
  quotes: Quote[];
  onClose: () => void;
  onCopied: (newQuotes: Quote[]) => void;
}) {
  const [targetInstance, setTargetInstance] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<TargetCustomer | null>(null);

  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerCompany, setNewCustomerCompany] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const [showCreateDeal, setShowCreateDeal] = useState(false);
  const [newDealName, setNewDealName] = useState('');
  const [newDealStage, setNewDealStage] = useState('Báo giá');
  const [creatingDeal, setCreatingDeal] = useState(false);

  const [projects, setProjects] = useState<TargetProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const [deals, setDeals] = useState<TargetDeal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState('');

  const [contacts, setContacts] = useState<TargetContact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState('');

  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Array<{ quote: Quote; ok: boolean; message: string; created?: Quote }> | null>(null);

  const isBulk = quotes.length > 1;

  // Doi Workspace -> RESET SACH toan bo ngu canh ben duoi.
  function handleWorkspaceChange(value: string) {
    setTargetInstance(value);
    setSelectedCustomer(null);
    setShowCreateCustomer(false);
    setShowCreateDeal(false);
    setProjects([]);
    setSelectedProjectId('');
    setDeals([]);
    setSelectedDealId('');
    setContacts([]);
    setSelectedContactId('');
    setError('');
  }

  function clearCustomerContext() {
    setSelectedCustomer(null);
    setProjects([]);
    setSelectedProjectId('');
    setDeals([]);
    setSelectedDealId('');
    setContacts([]);
    setSelectedContactId('');
    setShowCreateDeal(false);
  }

  // Doi Customer -> RESET Project/Deal/Contact cua customer cu, load lai cua customer MOI.
  async function pickCustomer(customer: TargetCustomer) {
    setSelectedCustomer(customer);
    setShowCreateCustomer(false);
    setShowCreateDeal(false);
    setSelectedProjectId('');
    setDeals([]);
    setSelectedDealId('');
    setSelectedContactId('');
    setLoadingDeals(true);
    try {
      const [projectRows, dealRows, contactRows] = await Promise.all([
        seedingQuoteRepository.listCrossWorkspaceProjects(targetInstance, customer.id),
        seedingQuoteRepository.listCrossWorkspaceDeals(targetInstance, customer.id),
        seedingQuoteRepository.listCrossWorkspaceContacts(targetInstance, customer.id),
      ]);
      setProjects(projectRows);
      setDeals(dealRows);
      setContacts(contactRows);
    } catch {
      setProjects([]);
      setDeals([]);
      setContacts([]);
    } finally {
      setLoadingDeals(false);
    }
  }

  useEffect(() => {
    if (!selectedProjectId) return;
    const stillValid = deals.some(d => d.id === selectedDealId && d.project_id === selectedProjectId);
    if (!stillValid) setSelectedDealId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const visibleDeals = selectedProjectId ? deals.filter(d => d.project_id === selectedProjectId) : deals;

  async function createCustomer() {
    if (!newCustomerName.trim()) {
      setError('Vui lòng nhập tên khách hàng mới.');
      return;
    }
    setCreatingCustomer(true);
    setError('');
    try {
      const created = await seedingQuoteRepository.createCrossWorkspaceCustomer(targetInstance, {
        customer_name: newCustomerName.trim(),
        company_name: newCustomerCompany.trim() || undefined,
        phone: newCustomerPhone.trim() || undefined,
        email: newCustomerEmail.trim() || undefined,
      });
      await pickCustomer({ id: created.id, customer_name: created.customer_name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được khách hàng mới.');
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function createDeal() {
    if (!selectedCustomer) return;
    setCreatingDeal(true);
    setError('');
    try {
      const created = await seedingQuoteRepository.createCrossWorkspaceDeal(
        targetInstance,
        selectedCustomer.id,
        {
          dealName: newDealName.trim() || `Cơ hội - ${selectedCustomer.customer_name}`,
          targetProjectId: selectedProjectId || undefined,
          dealStage: newDealStage,
        }
      );
      const newDealRow: TargetDeal = {
        id: created.id,
        customer_name: created.customer_name || selectedCustomer.customer_name,
        company_name: created.company_name,
        deal_stage: created.deal_stage || newDealStage,
        project_id: created.project_id || selectedProjectId || undefined,
      };
      setDeals(prev => [newDealRow, ...prev]);
      setSelectedDealId(created.id);
      setShowCreateDeal(false);
      setNewDealName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được cơ hội mới.');
    } finally {
      setCreatingDeal(false);
    }
  }

  async function confirmCopy() {
    if (!targetInstance || !selectedCustomer || !selectedDealId) return;
    setCopying(true);
    setError('');
    const outcomes: Array<{ quote: Quote; ok: boolean; message: string; created?: Quote }> = [];
    for (const q of quotes) {
      try {
        const created = await seedingQuoteRepository.copyQuoteToWorkspace(
          q.id, targetInstance, selectedCustomer.id, selectedDealId, selectedContactId || null
        );
        outcomes.push({ quote: q, ok: true, message: `Đã tạo ${created.quoteNumber}`, created });
      } catch (err) {
        outcomes.push({ quote: q, ok: false, message: err instanceof Error ? err.message : 'Thất bại.' });
      }
    }
    setResults(outcomes);
    setCopying(false);
    const createdQuotes = outcomes.filter(o => o.ok && o.created).map(o => o.created as Quote);
    if (createdQuotes.length) onCopied(createdQuotes);
  }

  const projectOptions = projects.map(p => ({
    value: p.id,
    label: p.name,
    subtext: p.project_code || undefined,
  }));

  const dealOptions = visibleDeals.map(d => ({
    value: d.id,
    label: d.customer_name || d.company_name || d.id,
    subtext: d.deal_stage ? `Giai đoạn: ${d.deal_stage}` : undefined,
  }));

  const contactOptions = contacts.map(c => ({
    value: c.id,
    label: c.name,
    subtext: c.phone || c.email || undefined,
  }));

  return (
    <div className="crm-modal-backdrop fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="crm-modal bg-white rounded-2xl shadow-2xl border border-slate-200 w-full flex flex-col" style={{ maxWidth: 640, minHeight: 420 }} onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="crm-modal-title text-base font-semibold text-slate-800">{isBulk ? `Sao chép ${quotes.length} báo giá` : 'Sao chép báo giá'}</h2>
            <p className="crm-modal-subtitle text-xs text-slate-500 mt-0.5">Chọn nơi báo giá sẽ được tạo và cơ hội nhận báo giá.</p>
          </div>
          <button type="button" className="crm-modal-close p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer" onClick={onClose} aria-label="Đóng">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="crm-modal-body p-6 overflow-y-auto flex-1 flex flex-col gap-4 min-h-[300px]">
          {results ? (
            <div className="flex flex-col gap-2">
              {results.map(r => (
                <div key={r.quote.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{r.quote.quoteNumber}</span>
                  <span className={r.ok ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{r.message}</span>
                </div>
              ))}
              <p className="text-xs text-slate-500 mt-1">
                Báo giá nguồn được giữ nguyên — mở workspace {targetInstance} để xem tiếp các bản vừa tạo.
              </p>
            </div>
          ) : (
            <>
              <div className="crm-field flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Workspace đích *</span>
                <CustomSelect
                  value={targetInstance}
                  options={WORKSPACE_OPTIONS}
                  placeholder="-- Chọn workspace --"
                  onChange={val => handleWorkspaceChange(val)}
                />
              </div>

              {targetInstance ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Khách hàng đích *</span>
                  {selectedCustomer ? (
                    <div className="flex items-center justify-between p-3 border border-slate-200 rounded-xl bg-slate-50">
                      <div>
                        <strong className="text-sm font-semibold text-slate-800">{selectedCustomer.customer_name}</strong>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {[selectedCustomer.company_name, selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      <button type="button" onClick={clearCustomerContext} className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-[#c2185b] hover:bg-pink-50 rounded-lg transition-colors cursor-pointer">
                        Đổi
                      </button>
                    </div>
                  ) : (
                    <>
                      <TargetCustomerCombobox
                        targetInstance={targetInstance}
                        onPick={c => void pickCustomer(c)}
                        onCreateNew={() => setShowCreateCustomer(true)}
                      />
                      {showCreateCustomer ? (
                        <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200 mt-2">
                          <label className="flex flex-col gap-1 col-span-2">
                            <span className="text-xs font-medium text-slate-700">Tên khách hàng *</span>
                            <input
                              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c2185b]/20 focus:border-[#c2185b]"
                              value={newCustomerName}
                              onChange={e => setNewCustomerName(e.target.value)}
                              placeholder={quotes[0]?.data?.customerName as string || ''}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-700">Công ty</span>
                            <input
                              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c2185b]/20 focus:border-[#c2185b]"
                              value={newCustomerCompany}
                              onChange={e => setNewCustomerCompany(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-700">SĐT</span>
                            <input
                              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c2185b]/20 focus:border-[#c2185b]"
                              value={newCustomerPhone}
                              onChange={e => setNewCustomerPhone(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 col-span-2">
                            <span className="text-xs font-medium text-slate-700">Email</span>
                            <input
                              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c2185b]/20 focus:border-[#c2185b]"
                              value={newCustomerEmail}
                              onChange={e => setNewCustomerEmail(e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="col-span-2 mt-1 h-9 px-4 text-xs font-semibold text-white bg-[#c2185b] hover:bg-[#a3134c] rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                            disabled={creatingCustomer}
                            onClick={() => void createCustomer()}
                          >
                            {creatingCustomer ? 'Đang tạo...' : 'Tạo khách hàng ở workspace đích'}
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {selectedCustomer ? (
                <div className="crm-field flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Dự án <em className="text-slate-400 font-normal lowercase">(không bắt buộc)</em></span>
                  <CustomSelect
                    value={selectedProjectId}
                    options={projectOptions}
                    placeholder="Chọn dự án (không bắt buộc)"
                    onChange={val => setSelectedProjectId(val)}
                  />
                </div>
              ) : null}

              {selectedCustomer ? (
                <div className="crm-field flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Cơ hội *</span>

                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <CustomSelect
                        value={selectedDealId}
                        options={dealOptions}
                        placeholder={loadingDeals ? 'Đang tải cơ hội...' : 'Chọn cơ hội'}
                        disabled={loadingDeals}
                        onChange={val => setSelectedDealId(val)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCreateDeal(true)}
                      className="h-10 px-3.5 text-xs font-semibold text-white bg-[#c2185b] hover:bg-[#a3134c] rounded-xl shrink-0 flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                    >
                      + Tạo cơ hội
                    </button>
                  </div>

                  {!loadingDeals && !visibleDeals.length ? (
                    <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200 mt-1 flex items-center justify-between gap-2">
                      <span>{selectedProjectId ? 'Dự án này chưa có Cơ hội nào — tạo Cơ hội để copy.' : 'Khách hàng này chưa có Cơ hội nào — tạo Cơ hội để copy.'}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedCustomer ? (
                <div className="crm-field flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Liên hệ chính <em className="text-slate-400 font-normal lowercase">(không bắt buộc)</em></span>
                  <CustomSelect
                    value={selectedContactId}
                    options={contactOptions}
                    placeholder="Chọn liên hệ"
                    onChange={val => setSelectedContactId(val)}
                  />
                </div>
              ) : null}

              {error ? <p className="text-xs font-medium text-red-600 bg-red-50 p-3 rounded-xl border border-red-200">{error}</p> : null}
            </>
          )}
        </div>

        <footer className="crm-modal-footer px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
          <button
            type="button"
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-sm transition-colors cursor-pointer"
            onClick={onClose}
          >
            {results ? 'Đóng' : 'Hủy'}
          </button>
          {!results ? (
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#c2185b] hover:bg-[#a3134c] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors cursor-pointer"
              disabled={!targetInstance || !selectedCustomer || !selectedDealId || copying}
              onClick={() => void confirmCopy()}
            >
              {copying ? 'Đang sao chép...' : isBulk ? `Sao chép báo giá (${quotes.length})` : 'Sao chép báo giá'}
            </button>
          ) : null}
        </footer>
      </div>
      {showCreateDeal && selectedCustomer ? (
        <DealFormModal
          open={showCreateDeal}
          initialCustomer={{
            id: selectedCustomer.id,
            name: selectedCustomer.customer_name,
            companyName: selectedCustomer.company_name || undefined,
            phone: selectedCustomer.phone || undefined,
            email: selectedCustomer.email || undefined,
          }}
          initialProject={selectedProjectId ? { id: selectedProjectId } : null}
          onClose={() => setShowCreateDeal(false)}
          onCreate={async input => {
            try {
              const created = await seedingCrmRepository.createDeal(input);
              const newDealRow: TargetDeal = {
                id: created.id,
                customer_name: created.customerName || selectedCustomer.customer_name,
                company_name: created.companyName || selectedCustomer.company_name,
                deal_stage: created.stage,
                project_id: created.projectId || selectedProjectId || undefined,
              };
              setDeals(prev => [newDealRow, ...prev]);
              setSelectedDealId(created.id);
              setShowCreateDeal(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Không tạo được cơ hội mới.');
            }
          }}
          onUpdate={() => {}}
        />
      ) : null}
    </div>
  );
}




