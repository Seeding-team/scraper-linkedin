'use client';

import { useState } from 'react';
import { FileCheck, Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatVND } from '../constants/crmConfig';
import { CONTRACT_STATUS_LABELS, contractStatusLabel } from '@/modules/contracts/constants/contractConfig';
import { seedingContractRepository } from '@/modules/contracts/repositories/SeedingContractRepository';
import type { ContractStatus } from '@/modules/contracts/types';
import { ContractAIWizard } from '@/modules/crm/integrations/contracts';
import { ContractDetailDrawer } from '@/modules/contracts/components/ContractDetailPage';
import { ContractTemplatesPanel } from '@/modules/contract-templates/components/ContractTemplatesPanel';
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

// Backend chi cho xoa hop dong con "Nhap"/"Cho phap che" (da xac nhan "Chua ky/dang thuc hien" la chan) - FE khong
// doan truoc, cu goi va hien loi tu backend neu bi chan (xem delete_contract() trong supabase_contract_service.py).
async function deleteContractRow(contract: ContractRow, onDone: () => void) {
  if (!confirm(`Xóa hợp đồng "${contract.title || contract.contract_number || contract.id}"?\nKhông thể khôi phục sau khi xóa.`)) return;
  try {
    await seedingContractRepository.deleteContract(contract.id);
    onDone();
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Không xóa được hợp đồng này.');
  }
}

function ContractsTable({
  contracts,
  deals,
  allContacts,
  setReloadTick,
  showPhaseColumn,
  onEditContract,
  onOpenDetail,
}: {
  contracts: ContractRow[];
  deals: RelatedPayload['deals'];
  allContacts: Array<{ id: string; name: string }>;
  setReloadTick: React.Dispatch<React.SetStateAction<number>>;
  showPhaseColumn: boolean;
  onEditContract: (contract: ContractRow) => void;
  /** Mở drawer chi tiết (không điều hướng trang). edit=true: mở sẵn khối chỉnh sửa. */
  onOpenDetail: (contract: ContractRow, edit?: boolean) => void;
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
                    <button type="button" data-testid={`contract-open-${contract.id}`} onClick={() => onOpenDetail(contract)} title="Xem chi tiết hợp đồng"
                      className="text-left text-slate-800 font-medium truncate hover:text-[#c2185b] hover:underline">{contract.title || contract.contract_number || contract.id}</button>
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
                      title="Sửa"
                      className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-600 hover:border-[#c2185b] hover:text-[#c2185b]"
                      data-testid={`contract-edit-${contract.id}`}
                      onClick={() => onOpenDetail(contract, true)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Xóa"
                      className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-600 hover:border-red-600 hover:text-red-600"
                      data-testid={`contract-delete-${contract.id}`}
                      onClick={() => void deleteContractRow(contract, () => setReloadTick(t => t + 1))}
                    >
                      <Trash2 className="size-3.5" />
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
  customerRef,
}: {
  /** Khach hang dang xem (Customer 360) - de modal AI Contract Copilot hien san ten khach. */
  customerRef?: { id: string; name: string };
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [detail, setDetail] = useState<{ id: string; edit: boolean; row: ContractRow | null } | null>(null);
  function openDetail(contract: ContractRow, edit = false) { setDetail({ id: contract.id, edit, row: contract }); }

  return (
    <div className="space-y-6 bg-white py-1">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileCheck className="size-4 text-[#c2185b]" />
            <span className="font-semibold text-sm text-slate-800">Hợp đồng ghi nhận ({recordedContracts.length})</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-8 font-medium"
              data-testid="contracts-upload-btn"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="size-3.5" />
              <span>Tải mẫu hợp đồng</span>
            </Button>
            <Button
              size="sm"
              className="gap-1 text-xs h-8 font-medium border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
              data-testid="contracts-add-btn"
              disabled={registerContractLoading}
              onClick={() => void openRegisterContractForActiveDeal()}
            >
              <Plus className="size-3.5" />
              <span>{registerContractLoading ? 'Đang tải...' : 'Thêm hợp đồng'}</span>
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs h-8 bg-[#c2185b] hover:bg-[#a91549] text-white shadow-2xs font-medium"
              data-testid="contracts-ai-btn"
              onClick={() => setAiOpen(true)}
            >
              <Sparkles className="size-3.5" />
              <span>Soạn hợp đồng AI</span>
            </Button>
          </div>
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
              onOpenDetail={openDetail}
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
              onOpenDetail={openDetail}
            />
          ) : (
            <div className="p-8 text-center text-xs text-slate-500">
              Chưa có link hợp đồng/báo giá mua-bán nào.
            </div>
          )}
        </div>
      </div>
      {uploadOpen ? (
        <>
          <div className="crm-drawer-backdrop" onClick={() => setUploadOpen(false)} />
          <aside className="crm-drawer" style={{ width: 'min(52rem, 100%)' }} data-testid="contracts-upload-modal">
            <header className="crm-drawer-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}>
              <div>
                <h2 className="crm-modal-title" style={{ margin: 0 }}>Mẫu hợp đồng</h2>
                <p className="crm-modal-subtitle" style={{ margin: '0.2rem 0 0' }}>Tải mẫu (.docx, .pdf, .txt) để “Soạn hợp đồng AI” tham chiếu văn phong và cấu trúc. Danh sách mẫu đã lưu nằm bên dưới.</p>
              </div>
              <button type="button" className="crm-modal-close" onClick={() => setUploadOpen(false)} aria-label="Đóng">✕</button>
            </header>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
              <ContractTemplatesPanel />
            </div>
          </aside>
        </>
      ) : null}

      <ContractAIWizard open={aiOpen} onClose={() => setAiOpen(false)}
        onCreated={id => { setAiOpen(false); setReloadTick(x => x + 1); if (id) setDetail({ id, edit: false, row: null }); }}
        defaultCustomerId={customerRef?.id} customerNameHint={customerRef?.name} uiOnly />
      <ContractDetailDrawer contractId={detail?.id || null} focusEdit={detail?.edit} initialTab="overview"
        onClose={() => setDetail(null)}
        onChanged={() => setReloadTick(x => x + 1)}
        onOpenLegacyEdit={detail?.row ? () => { const row = detail.row as ContractRow; setDetail(null); onEditContract(row); } : undefined} />
    </div>
  );
}
