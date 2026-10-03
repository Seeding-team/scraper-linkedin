'use client';

import Link from 'next/link';
import { FileCheck, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatVND } from '../constants/crmConfig';
import { contractStatusLabel } from '@/modules/contracts/constants/contractConfig';
import { ContactAssignCell, contractSourceBadge, formatContractDate } from './CrmCustomerDetailPage';
import type { RelatedPayload } from './CrmCustomerDetailPage';

type ContractRow = NonNullable<RelatedPayload['contracts']>[number];

/** 1 bảng hợp đồng dùng chung cho cả 2 khu vực (Ghi nhận / Mua vào-Bán ra) -
 * feedback mentor 2026-10-03: "chia bảng ra, bảng trên là hợp đồng ghi nhận,
 * bảng dưới là cho hợp đồng mua vào bán ra, tại 2 cái đó chỉ là đường link
 * không quét được giá trị á" - 2 nhom nay khac ban chat (hop dong day du co
 * gia tri/trang thai that vs link tham chieu Phase 1/2 khong co gia tri) nen
 * tach rieng, khong con gop 1 bang + cot "Loại" nhu truoc. */
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
  return (
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
                    <span className="text-slate-400">—</span>
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
              <td className="py-2.5 px-3 text-slate-500">{contract.signed_at ? formatContractDate(contract.signed_at) : '—'}</td>
              <td className="py-2.5 px-3 text-right">
                <div className="flex items-center justify-end gap-2 text-xs">
                  <Link className="text-[#c2185b] hover:underline font-medium" href={`/all-platform/contracts/${contract.id}`}>Xem</Link>
                  {contract.file_url ? (
                    <a className="text-[#c2185b] hover:underline font-medium" href={contract.file_url} target="_blank" rel="noreferrer">
                      {contract.source === 'external' ? 'File/link' : 'File'}
                    </a>
                  ) : null}
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
  // "Hợp đồng ghi nhận" = hợp đồng đầy đủ ("Ghi nhận hợp đồng có sẵn" - có
  // giá trị/trạng thái thật). "Mua vào / Bán ra" = link tham chiếu Phase 1/2
  // (CrmCustomerModal.tsx), nhận biết qua deal_phase - không có giá trị thật.
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
              Chưa có link hợp đồng/báo giá mua-bán nào (xem mục "Hợp đồng báo giá mua/bán" trong Sửa Khách hàng).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
