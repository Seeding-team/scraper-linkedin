'use client';

import { Activity, ArrowRight, UserCheck, Clock, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getStageMeta } from '../constants/crmConfig';
import type { DealStage } from '../types';
import { getStageSolidBgClass } from './CrmCustomerDetailPage';

export type CustomerActivityEntry = {
  id: string;
  action: string;
  from_stage?: string | null;
  to_stage?: string | null;
  note?: string | null;
  actor_name?: string | null;
  created_at: string;
};

export function CustomerActivityTab({
  activityItems,
  activityLoading,
  activityError,
}: {
  activityItems: CustomerActivityEntry[];
  activityLoading: boolean;
  activityError: string;
}) {
  return (
    <div className="space-y-3 bg-white py-1">
      {/* Flat Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-[#c2185b]" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">Hoạt động bán hàng ({activityItems.length})</h2>
        </div>
      </div>

      <div>
        {activityError ? (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs mb-3">
            {activityError}
          </div>
        ) : null}

        {activityLoading ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="size-4 animate-spin text-[#c2185b]" />
            <span>Đang tải nhật ký hoạt động...</span>
          </div>
        ) : activityItems.length ? (
          <div className="relative border-l-2 border-slate-100 ml-3 pl-4 space-y-4 py-2">
            {activityItems.map(entry => {
              const fromMeta = entry.from_stage ? getStageMeta(entry.from_stage as DealStage) : null;
              const toMeta = entry.to_stage ? getStageMeta(entry.to_stage as DealStage) : null;

              return (
                <div key={entry.id} className="relative group">
                  {/* Timeline dot */}
                  <div className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-slate-300 ring-4 ring-white group-hover:bg-[#c2185b] transition-colors" />

                  <div className="pb-3 border-b border-slate-100 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {entry.from_stage && entry.to_stage ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${getStageSolidBgClass(entry.from_stage)}`}
                            >
                              {fromMeta?.label || entry.from_stage}
                            </span>
                            <ArrowRight className="size-3 text-slate-400" />
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${getStageSolidBgClass(entry.to_stage)}`}
                            >
                              {toMeta?.label || entry.to_stage}
                            </span>
                          </div>
                        ) : (
                          <span className="font-semibold text-xs text-slate-800">{entry.action}</span>
                        )}

                        {entry.actor_name ? (
                          <Badge variant="outline" className="text-[10px] font-normal gap-1 bg-white text-slate-600 border-slate-200 py-0">
                            <UserCheck className="size-3 text-[#c2185b]" />
                            <span>{entry.actor_name}</span>
                          </Badge>
                        ) : null}
                      </div>

                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Clock className="size-3" />
                        {new Date(entry.created_at).toLocaleString('vi-VN')}
                      </span>
                    </div>

                    {entry.note ? (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100 leading-relaxed font-sans mt-1">
                        {entry.note}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <Activity className="size-8 text-slate-300 stroke-1" />
            <span>Chưa có hoạt động bán hàng nào được ghi nhận.</span>
          </div>
        )}
      </div>
    </div>
  );
}
