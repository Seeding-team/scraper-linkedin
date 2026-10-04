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
  onEditContract,
}: {
  contracts: ContractRow[];
  deals: RelatedPayload['deals'];
  allContacts: Array<{ id: string; name: string }>;
  setReloadTick: React.Dispatch<React.SetStateAction<number>>;
  showPhaseColumn: boolean;
  onEditContract: (contract: ContractRow) => void;
}) {
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
            // Lien he luu rieng tren hop dong (contact_id) uu tien, fallback lien he chinh cua Co hoi.
            const shownContactId = contract.contact_id || contractDeal?.primary_contact_id;
            const contractPrimaryContactName = shownContactId
              ? allContacts.find(c => c.id === shownContactId)?.name || 'Liên hệ ẩn'
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
                      onClick={() => onEditContract(contract)}
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

    </>
  );
}

export function CustomerContractsTab({
  data,
  loading,
  allContacts,
  registerContractLoading,
  openRegisterContractForActiveDeal,
  onEditContract,
  setReloadTick,
}: {
  data: RelatedPayload | null;
  loading: boolean;
  allContacts: Array<{ id: string; name: string }>;
  registerContractLoading: boolean;
  openRegisterContractForActiveDeal: () => void;
  onEditContract: (contract: ContractRow) => void;
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
            <span>{registerContractLoading ? 'Đang tải...' : 'Thêm hợp đồng'}</span>
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
              onEditContract={onEditContract}
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
              onEditContract={onEditContract}
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
