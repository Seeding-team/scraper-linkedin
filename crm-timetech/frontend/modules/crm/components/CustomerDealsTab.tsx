import React from 'react';
import { Target, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DealStage } from '../types';

export function CustomerDealsTab({
  deals,
  loading,
  allContacts,
  setDealModal,
  openDealWorkspace,
  projectLabel,
  getStageMeta,
  getStageSolidBgClass,
  formatVND,
  relativeTime,
  setReloadTick,
  ContactAssignCell,
}: {
  deals: any[];
  loading: boolean;
  allContacts: any[];
  setDealModal: (modal: any) => void;
  openDealWorkspace: (id: string) => void;
  projectLabel: (id?: string | null) => string;
  getStageMeta: (stage: DealStage) => any;
  getStageSolidBgClass: (stage?: string | null) => string;
  formatVND: (val?: number | string | null) => string | null;
  relativeTime: (date?: string) => string;
  setReloadTick: React.Dispatch<React.SetStateAction<number>>;
  ContactAssignCell: React.ElementType;
}) {
  return (
    <div>
      <div className="py-3 px-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-[#c2185b]" />
          <span className="font-semibold text-sm text-slate-800">Danh sách Cơ hội</span>
          <Badge variant="secondary" className="text-xs font-bold px-2 py-0.5 bg-slate-200 text-slate-700">
            {deals?.length || 0}
          </Badge>
        </div>
        <Button
          size="sm"
          className="gap-1.5 shadow-sm bg-white text-[#c2185b] border border-slate-200 hover:bg-slate-50"
          onClick={() => setDealModal({ open: true, project: null, contactId: null })}
        >
          <Plus className="size-3.5" />
          <span>Tạo cơ hội</span>
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-3 px-4 font-semibold text-slate-600">Tên cơ hội</th>
              <th className="py-3 px-4 font-semibold text-slate-600">Liên hệ chính</th>
              <th className="py-3 px-4 font-semibold text-slate-600">Dự án</th>
              <th className="py-3 px-4 font-semibold text-slate-600">Giai đoạn</th>
              <th className="py-3 px-4 font-semibold text-slate-600 text-right">Giá trị</th>
              <th className="py-3 px-4 font-semibold text-slate-600">Cập nhật</th>
              <th className="py-3 px-4 font-semibold text-slate-600 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">Đang tải...</td></tr>
            ) : deals?.length ? (
              deals.map(deal => {
                const primaryContactName = deal.primary_contact_id
                  ? allContacts.find(c => c.id === deal.primary_contact_id)?.name || 'Liên hệ ẩn'
                  : 'Chưa có';
                return (
                  <tr
                    key={deal.id}
                    className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    onClick={() => openDealWorkspace(deal.id)}
                    title="Mở Deal Workspace"
                  >
                    <td className="py-3 px-4">
                      <strong className="text-slate-800">{deal.customer_name || deal.id}</strong>
                    </td>
                    <td className="py-3 px-4 text-slate-500">{primaryContactName}</td>
                    <td className="py-3 px-4 text-slate-500">{projectLabel(deal.project_id)}</td>
                    <td className="py-3 px-4">
                      {(() => {
                        const meta = getStageMeta((deal.deal_stage as DealStage) || 'new_lead');
                        return (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-white ${getStageSolidBgClass(deal.deal_stage)}`}>{meta.label}</span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-emerald-600">
                      {formatVND(Number(deal.estimated_budget || deal.lifetime_value || 0)) || '0 đ'}
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-xs">
                      {relativeTime(deal.updated_at || deal.created_at || undefined)}
                    </td>
                    <td className="py-3 px-4 text-right" onClick={event => event.stopPropagation()}>
                      <ContactAssignCell
                        dealId={deal.id}
                        currentContactId={deal.primary_contact_id}
                        contacts={allContacts}
                        onAssigned={() => setReloadTick(t => t + 1)}
                      />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">Chưa có cơ hội nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
