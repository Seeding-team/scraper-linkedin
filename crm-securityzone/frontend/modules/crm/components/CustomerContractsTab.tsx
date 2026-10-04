'use client';

import { useState } from 'react';
import { FileCheck, Pencil, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatVND } from '../constants/crmConfig';
import { CONTRACT_STATUS_LABELS, contractStatusLabel } from '@/modules/contracts/constants/contractConfig';
import { seedingContractRepository } from '@/modules/contracts/repositories/SeedingContractRepository';
import type { ContractStatus } from '@/modules/contracts/types';
import { ContactAssignCell, contractSourceBadge, formatContractDate } from './CrmCustomerDetailPage';
import type { RelatedPayload } from './CrmCustomerDetailPage';

type ContractRow = NonNullable<RelatedPayload['contracts']>[number];
type ContractEditForm = {
  title: string;
  fileUrl: string;
  contractValue: string;
  signedAt: string;
  status: ContractStatus;
  source: 'crm' | 'external';
};

const CONTRACT_STATUS_OPTIONS = Object.entries(CONTRACT_STATUS_LABELS) as Array<[ContractStatus, string]>;

function toDateInput(value?: string | null) {
  return value ? String(value).slice(0, 10) : '';
}

function moneyInputToNumber(value: string) {
  return Number(value.replace(/[^\d.-]/g, '') || 0);
}

function ContractsTable({
  contracts,
  deals,
  allContacts,
  setReloadTick,
  showPhaseColumn,
}: {
  contracts: ContractRow[];
  deals: RelatedPayload['deals'];
  allContacts: Array<{ id: string; name: string }>;
  setReloadTick: React.Dispatch<React.SetStateAction<number>>;
  showPhaseColumn: boolean;
}) {
  const [editingContract, setEditingContract] = useState<ContractRow | null>(null);
  const [editForm, setEditForm] = useState<ContractEditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  function openEdit(contract: ContractRow) {
    setEditingContract(contract);
    setEditForm({
      title: contract.title || '',
      fileUrl: contract.file_url || '',
      contractValue: String(Number(contract.contract_value || 0) || ''),
      signedAt: toDateInput(contract.signed_at),
      status: (contract.status || 'draft') as ContractStatus,
      source: contract.source === 'external' ? 'external' : 'crm',
    });
    setSaveError('');
  }

  async function saveContractEdit() {
    if (!editingContract || !editForm) return;
    setSaving(true);
    setSaveError('');
    try {
      await seedingContractRepository.updateContract(editingContract.id, {
        title: editForm.title.trim() || editingContract.contract_number || editingContract.id,
        fileUrl: editForm.fileUrl.trim() || null,
        contractValue: moneyInputToNumber(editForm.contractValue),
        signedAt: editForm.signedAt || null,
        status: editForm.status,
        source: editForm.source,
      });
      setEditingContract(null);
      setEditForm(null);
      setReloadTick(t => t + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Không lưu được hợp đồng.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <table className="w-full text-xs text-left">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
          <tr>
            <th className="py-2.5 px-3 font-semibold">Hợp đồng</th>
            {showPhaseColumn ? <th className="py-2.5 px-3 font-semibold">Loại</th> : null}
            <th className="py-2.5 px-3 font-semibold">Nguồn</th>
            <th className="py-2.5 px-3 font-semibold">Trạng thái</th>
            <th className="py-2.5 px-3 font-semibold">Liên hệ chính</th>
            <th className="py-2.5 px-3 font-semibold text-right">Giá trị</th>
            <th className="py-2.5 px-3 font-semibold">Ngày ký</th>
            <th className="py-2.5 px-3 font-semibold text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {contracts.map(contract => {
            const contractDeal = deals?.find(d => d.id === contract.deal_id);
            const contractPrimaryContactName = contractDeal?.primary_contact_id
              ? allContacts.find(c => c.id === contractDeal.primary_contact_id)?.name || 'Liên hệ ẩn'
              : 'Chưa có';
            return (
              <tr key={contract.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="py-2.5 px-3">
                  <div className="flex flex-col">
                    <strong className="text-slate-800 font-medium truncate">{contract.title || contract.contract_number || contract.id}</strong>
                    {contract.contract_number ? <span className="text-[11px] text-slate-500">{contract.contract_number}</span> : null}
                  </div>
                </td>
                {showPhaseColumn ? (
                  <td className="py-2.5 px-3">
                    {contract.deal_phase === 'purchase' ? (
                      <Badge className="bg-sky-500 hover:bg-sky-600 text-white border-transparent text-[10px] font-semibold px-2 py-0.5">Mua vào</Badge>
                    ) : contract.deal_phase === 'sale' ? (
                      <Badge className="bg-violet-500 hover:bg-violet-600 text-white border-transparent text-[10px] font-semibold px-2 py-0.5">Bán ra</Badge>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                ) : null}
                <td className="py-2.5 px-3">{contractSourceBadge(contract.source)}</td>
                <td className="py-2.5 px-3">
                  <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white border-transparent text-[10px] font-semibold px-2 py-0.5">
                    {contractStatusLabel(contract.status || '')}
                  </Badge>
                </td>
                <td className="py-2.5 px-3 text-slate-500 truncate">{contractPrimaryContactName}</td>
                <td className="py-2.5 px-3 text-right font-semibold text-emerald-600">{formatVND(Number(contract.contract_value || 0)) || '0 đ'}</td>
                <td className="py-2.5 px-3 text-slate-500">{contract.signed_at ? formatContractDate(contract.signed_at) : '-'}</td>
                <td className="py-2.5 px-3 text-right">
                  <div className="flex items-center justify-end gap-2 text-xs">
                    {contract.file_url ? (
                      <a className="text-[#c2185b] hover:underline font-medium" href={contract.file_url} target="_blank" rel="noreferrer">
                        {contract.source === 'external' ? 'File/link' : 'File'}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-600 hover:border-[#c2185b] hover:text-[#c2185b]"
                      onClick={() => openEdit(contract)}
                    >
                      <Pencil className="size-3" /> Sửa
                    </button>
                    <div onClick={(e) => e.stopPropagation()}>
                      <ContactAssignCell
                        dealId={contract.deal_id}
                        currentContactId={contractDeal?.primary_contact_id}
                        contacts={allContacts}
                        onAssigned={() => setReloadTick(t => t + 1)}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editingContract && editForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4" onMouseDown={() => !saving && setEditingContract(null)}>
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Sửa hợp đồng</h3>
                <p className="mt-1 text-xs text-slate-500">{editingContract.contract_number || 'Hợp đồng chưa có mã'}</p>
              </div>
              <button type="button" className="text-xl leading-none text-slate-400 hover:text-slate-700" onClick={() => !saving && setEditingContract(null)}>x</button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 sm:col-span-2">
                Tên hợp đồng
                <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-[#c2185b]" value={editForm.title} onChange={event => setEditForm({ ...editForm, title: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 sm:col-span-2">
                File/link
                <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-[#c2185b]" value={editForm.fileUrl} onChange={event => setEditForm({ ...editForm, fileUrl: event.target.value })} placeholder="https://..." />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Giá trị
                <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-[#c2185b]" value={editForm.contractValue} onChange={event => setEditForm({ ...editForm, contractValue: event.target.value })} inputMode="numeric" />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Ngày ký
                <input type="date" className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-[#c2185b]" value={editForm.signedAt} onChange={event => setEditForm({ ...editForm, signedAt: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Trạng thái
                <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-[#c2185b]" value={editForm.status} onChange={event => setEditForm({ ...editForm, status: event.target.value as ContractStatus })}>
                  {CONTRACT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Nguồn
                <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-[#c2185b]" value={editForm.source} onChange={event => setEditForm({ ...editForm, source: event.target.value as 'crm' | 'external' })}>
                  <option value="crm">CRM</option>
                  <option value="external">Bên ngoài</option>
                </select>
              </label>
              {saveError ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 sm:col-span-2">{saveError}</div> : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-4">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setEditingContract(null)}>Hủy</Button>
              <Button type="button" disabled={saving} className="bg-[#c2185b] text-white hover:bg-[#a91549]" onClick={() => void saveContractEdit()}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function CustomerContractsTab({
  data,
  loading,
  allContacts,
  registerContractLoading,
  openRegisterContractForActiveDeal,
  setReloadTick,
}: {
  data: RelatedPayload | null;
  loading: boolean;
  allContacts: Array<{ id: string; name: string }>;
  registerContractLoading: boolean;
  openRegisterContractForActiveDeal: () => void;
  setReloadTick: React.Dispatch<React.SetStateAction<number>>;
}) {
  const allContracts = data?.contracts ?? [];
  const recordedContracts = allContracts.filter(c => !c.deal_phase);
  const phaseContracts = allContracts.filter(c => !!c.deal_phase);

  return (
    <div className="space-y-6 bg-white py-1">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileCheck className="size-4 text-[#c2185b]" />
            <span className="font-semibold text-sm text-slate-800">Hợp đồng ghi nhận ({recordedContracts.length})</span>
          </div>
          <Button
            size="sm"
            className="gap-1 text-xs h-8 bg-[#c2185b] hover:bg-[#a91549] text-white shadow-2xs font-medium"
            disabled={registerContractLoading}
            onClick={() => void openRegisterContractForActiveDeal()}
          >
            <Plus className="size-3.5" />
            <span>{registerContractLoading ? 'Đang tải...' : 'Ghi nhận hợp đồng có sẵn'}</span>
          </Button>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500">Đang tải...</div>
          ) : recordedContracts.length ? (
            <ContractsTable
              contracts={recordedContracts}
              deals={data?.deals}
              allContacts={allContacts}
              setReloadTick={setReloadTick}
              showPhaseColumn={false}
            />
          ) : (
            <div className="p-8 text-center text-xs text-slate-500">
              Chưa có hợp đồng nào được ghi nhận trong CRM.
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileCheck className="size-4 text-slate-400" />
            <span className="font-semibold text-sm text-slate-800">Hợp đồng Mua vào / Bán ra ({phaseContracts.length})</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500">Đang tải...</div>
          ) : phaseContracts.length ? (
            <ContractsTable
              contracts={phaseContracts}
              deals={data?.deals}
              allContacts={allContacts}
              setReloadTick={setReloadTick}
              showPhaseColumn={true}
            />
          ) : (
            <div className="p-8 text-center text-xs text-slate-500">
              Chưa có link hợp đồng/báo giá mua-bán nào.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
