import React, { useMemo, useState } from 'react';
import { getStageMeta, formatVND } from '../constants/crmConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Target,
  Activity,
  Briefcase,
  FileText,
  ArrowRight,
  Building2,
  Calendar,
  Clock,
  CheckCircle2,
  UserCheck,
  FolderKanban,
  FileCheck,
  ChevronRight,
  Phone,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Folder
} from 'lucide-react';
import { relativeTime } from '../utils/quoteDisplay';

function formatCrmDate(value?: string | null): string {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function ZaloIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.912 1.455 5.518 3.734 7.215L4.5 22l3.961-1.32c1.11.365 2.3.578 3.539.578 5.523 0 10-4.145 10-9.258C22 6.145 17.523 2 12 2zm1.688 12.875h-3.375v-1.125h2.25v-1.125h-2.25v-1.125h3.375V10.25H9.188v5.75h4.5v-1.125z"/>
    </svg>
  );
}

export function CustomerOverviewTab({
  data,
  customerId,
  allContacts,
  members,
  projectsSummary,
  activityItems,
  setTab,
  onCreateDeal,
  onEditCustomer,
}: {
  data: any;
  customerId: string;
  allContacts: any[];
  members: any[];
  projectsSummary: any;
  activityItems: any[];
  setTab: (tab: any) => void;
  onCreateDeal: () => void;
  onEditCustomer?: () => void;
}) {
  const customer = data?.customer;
  const deals = data?.deals || [];
  const quotes = data?.quotes || [];
  const contracts = data?.contracts || [];
  const projects = projectsSummary?.projects || [];

  const openDeals = useMemo(() => {
    return deals
      .filter((deal: any) => deal.deal_stage !== 'won' && deal.deal_stage !== 'lost')
      .sort((a: any, b: any) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  }, [deals]);

  const pipelineValue = useMemo(() => {
    return openDeals.reduce((sum: number, d: any) => sum + Number(d.estimated_budget || d.lifetime_value || 0), 0);
  }, [openDeals]);

  const recentActivities = useMemo(() => [...activityItems].slice(0, 5), [activityItems]);
  
  const primaryContactId = customer?.primary_contact_id || openDeals.find((deal: any) => deal.primary_contact_id)?.primary_contact_id || allContacts[0]?.id || null;
  const primaryContact = allContacts.find(contact => contact.id === primaryContactId);
  
  const tasks = useMemo(() => {
    return [...deals]
      .filter((deal: any) => deal.follow_up_date)
      .sort((a: any, b: any) => new Date(a.follow_up_date).getTime() - new Date(b.follow_up_date).getTime());
  }, [deals]);
  
  const nextFollowUpDeal = tasks[0] || openDeals[0] || deals[0];

  function memberName(userId?: string | null): string {
    if (!userId) return 'Chưa phân công';
    const match = members.find(member => member.linked_user_id === userId || member.linked_user_id_2 === userId || member.id === userId);
    return match?.display_name || match?.name || match?.email || 'Chưa phân công';
  }

  function contactName(contactId?: string | null): string {
    if (!contactId) return 'Chưa có';
    return allContacts.find(contact => contact.id === contactId)?.name || 'Liên hệ ẩn';
  }

  const [recentTab, setRecentTab] = useState<'projects' | 'quotes' | 'contracts'>('projects');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 bg-white py-2">
      
      {/* LEFT MAIN COLUMN (~70%) */}
      <div className="space-y-5 min-w-0">
        
        {/* 1. ALERT BANNER: VIỆC CẦN LÀM TIẾP THEO */}
        {nextFollowUpDeal && (
          <div className="bg-rose-50/80 border border-rose-200/90 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="size-10 rounded-lg bg-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
                <Calendar className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm">Việc cần làm tiếp theo</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-0.5">
                  <span className="font-medium">{nextFollowUpDeal.next_action || 'Follow-up khách hàng'}</span>
                  <span>•</span>
                  <span>Cơ hội: <span className="font-semibold text-slate-800">{nextFollowUpDeal.customer_name || customer?.customer_name || 'Hilab'}</span></span>
                  <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-transparent text-[10px] font-semibold px-2 py-0">
                    Quá hạn
                  </Badge>
                  <span className="text-slate-500 inline-flex items-center gap-1">
                    <Clock className="size-3 text-slate-400" />
                    Hôm nay 15:00 • {formatCrmDate(nextFollowUpDeal.follow_up_date || customer?.updated_at)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button 
                variant="outline" 
                size="sm" 
                className="bg-white text-rose-700 hover:bg-rose-50 border-rose-300 text-xs h-8 px-3 font-medium rounded-lg" 
                onClick={() => setTab('deals')}
              >
                Xem chi tiết
              </Button>
              <Button 
                size="sm" 
                className="bg-[#c2185b] hover:bg-[#a91549] text-white shadow-2xs text-xs h-8 px-3 font-medium rounded-lg gap-1" 
                onClick={() => setTab('deals')}
              >
                <span>Mở cơ hội</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* 2. SECTION: CƠ HỘI ĐANG XỬ LÝ */}
        <section className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <h2 className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <Target className="size-4 text-[#c2185b]" />
              <span>Cơ hội đang xử lý ({openDeals.length})</span>
            </h2>
            <Button variant="link" className="text-blue-600 h-auto p-0 text-xs font-semibold hover:text-blue-700 flex items-center gap-1" onClick={() => setTab('deals')}>
              <span>Xem tất cả</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200 font-semibold">
                <tr>
                  <th className="px-3 py-2.5">Tên cơ hội</th>
                  <th className="px-3 py-2.5">Giai đoạn</th>
                  <th className="px-3 py-2.5 text-right">Giá trị dự kiến</th>
                  <th className="px-3 py-2.5">Dự kiến chốt</th>
                  <th className="px-3 py-2.5">Next action</th>
                  <th className="px-3 py-2.5">Owner</th>
                  <th className="px-2 py-2.5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openDeals.length ? openDeals.map((deal: any) => {
                  const meta = getStageMeta((deal.deal_stage as any) || 'new_lead');
                  return (
                    <tr 
                      key={deal.id} 
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group" 
                      onClick={() => setTab('deals')}
                    >
                      <td className="px-3 py-3">
                        <div className="font-bold text-slate-800 text-xs">{deal.customer_name || deal.name || deal.id}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{deal.deal_code || deal.id?.slice(0, 8)} • {deal.industry || 'Chưa phân loại'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge className="bg-blue-50 text-blue-700 border-blue-100 font-semibold shadow-none rounded-full px-2.5 py-0.5 text-[11px]">{meta.label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-slate-900 text-xs">
                        {formatVND(Number(deal.estimated_budget || deal.lifetime_value || 0)) || '0 đ'}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{formatCrmDate(deal.expected_close_date)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 text-rose-600">
                          <Clock className="size-3.5 shrink-0" />
                          <div>
                            <div className="text-xs font-semibold">{deal.next_action || 'Follow-up'}</div>
                            <div className="text-[11px] text-rose-500">{formatCrmDate(deal.follow_up_date || customer?.updated_at)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="size-5 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[9px] font-bold uppercase shrink-0">
                            {memberName(deal.quote_owner_id)[0]}
                          </div>
                          <span className="text-slate-700 font-medium truncate max-w-[100px]">{memberName(deal.quote_owner_id)}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right text-slate-400 group-hover:text-slate-600">
                        <ChevronRight className="size-4 ml-auto" />
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400 text-xs">Chưa có cơ hội nào đang xử lý.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 3. SECTION: TỔNG QUAN KINH DOANH (5 STAT CARDS) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <h2 className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <Activity className="size-4 text-[#c2185b]" />
              <span>Tổng quan kinh doanh</span>
            </h2>
            <select className="h-7 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-medium outline-none">
              <option value="year">Năm nay</option>
              <option value="quarter">Quý này</option>
              <option value="month">Tháng này</option>
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {/* Stat 1: Dự án */}
            <div 
              className="bg-white border border-slate-200/90 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-blue-300 hover:shadow-2xs transition-all"
              onClick={() => setTab('projects')}
            >
              <div className="size-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <FolderKanban className="size-4.5" />
              </div>
              <div>
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Dự án</div>
                <div className="text-lg font-bold text-slate-800 mt-0.5 leading-none">{projects.length}</div>
              </div>
            </div>

            {/* Stat 2: Cơ hội */}
            <div 
              className="bg-white border border-slate-200/90 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-rose-300 hover:shadow-2xs transition-all"
              onClick={() => setTab('deals')}
            >
              <div className="size-9 rounded-lg bg-rose-50 text-[#c2185b] flex items-center justify-center shrink-0">
                <Target className="size-4.5" />
              </div>
              <div>
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Cơ hội</div>
                <div className="text-lg font-bold text-slate-800 mt-0.5 leading-none">{deals.length}</div>
              </div>
            </div>

            {/* Stat 3: Báo giá */}
            <div 
              className="bg-white border border-slate-200/90 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-amber-300 hover:shadow-2xs transition-all"
              onClick={() => setTab('quotes')}
            >
              <div className="size-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <FileText className="size-4.5" />
              </div>
              <div>
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Báo giá</div>
                <div className="text-lg font-bold text-slate-800 mt-0.5 leading-none">{quotes.length}</div>
              </div>
            </div>

            {/* Stat 4: Hợp đồng */}
            <div 
              className="bg-white border border-slate-200/90 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-emerald-300 hover:shadow-2xs transition-all"
              onClick={() => setTab('contracts')}
            >
              <div className="size-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <FileCheck className="size-4.5" />
              </div>
              <div>
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Hợp đồng</div>
                <div className="text-lg font-bold text-slate-800 mt-0.5 leading-none">{contracts.length}</div>
              </div>
            </div>

            {/* Stat 5: Giá trị Pipeline */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-3 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <Briefcase className="size-4.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide truncate">Giá trị Pipeline</div>
                <div className="text-sm font-bold text-emerald-600 mt-0.5 leading-none truncate">{formatVND(pipelineValue) || '0 đ'}</div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. SECTION: RECENT ACTIVITY + TASKS (2-COLUMN GRID) */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-1">
          
          {/* Left Column: Hoạt động gần đây */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-bold text-xs uppercase tracking-wide text-slate-800 flex items-center gap-2">
                <Activity className="size-4 text-[#c2185b]" />
                <span>Hoạt động gần đây</span>
              </h3>
              <Button variant="link" className="text-blue-600 h-auto p-0 text-xs font-semibold hover:text-blue-700 flex items-center gap-1" onClick={() => setTab('activity')}>
                <span>Xem tất cả</span>
                <ArrowRight className="size-3" />
              </Button>
            </div>
            
            <div className="space-y-3">
              {recentActivities.length ? recentActivities.map((entry: any) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 text-xs py-1 border-b border-slate-100 last:border-0">
                  <div className="flex items-start gap-2.5">
                    <div className="size-2 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-800">{entry.action || entry.action_type || 'Cập nhật'}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{entry.actor_name || 'Hệ thống'}</div>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 shrink-0 font-medium">{relativeTime(entry.created_at)}</div>
                </div>
              )) : (
                <div className="py-6 text-center text-slate-400 text-xs">Chưa có hoạt động gần đây.</div>
              )}
            </div>
          </div>

          {/* Right Column: Việc cần làm */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-bold text-xs uppercase tracking-wide text-slate-800 flex items-center gap-2">
                <CheckCircle2 className="size-4 text-[#c2185b]" />
                <span>Việc cần làm ({tasks.length})</span>
              </h3>
              <Button variant="link" className="text-blue-600 h-auto p-0 text-xs font-semibold hover:text-blue-700 flex items-center gap-1" onClick={() => setTab('deals')}>
                <span>Xem tất cả</span>
                <ArrowRight className="size-3" />
              </Button>
            </div>

            <div className="space-y-2.5">
              {tasks.length ? tasks.slice(0, 3).map((task: any) => {
                return (
                  <div 
                    key={task.id} 
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setTab('deals')}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="size-2 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 text-xs truncate">{task.next_action || 'Follow-up khách hàng'}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          Cơ hội: {task.customer_name || customer?.customer_name || 'Hilab'}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="size-3 text-slate-400" />
                          <span>{formatCrmDate(task.follow_up_date)} 15:00</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-transparent text-[10px] font-semibold px-2 py-0">
                        Quá hạn
                      </Badge>
                      <button type="button" className="text-slate-400 hover:text-slate-600 p-1">
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <div className="py-6 text-center text-slate-400 text-xs">Chưa có việc cần làm.</div>
              )}
            </div>
          </div>

        </section>

        {/* 5. SECTION: LIÊN QUAN GẦN ĐÂY */}
        <section className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200">
            <div className="flex items-center gap-4">
              <h3 className="font-bold text-xs uppercase tracking-wide text-slate-800 flex items-center gap-2">
                <Folder className="size-4 text-[#c2185b]" />
                <span>Liên quan gần đây</span>
              </h3>
              <div className="flex items-center gap-1.5">
                <button 
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${recentTab === 'projects' ? 'bg-[#c2185b] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  onClick={() => setRecentTab('projects')}
                >
                  Dự án ({projects.length})
                </button>
                <button 
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${recentTab === 'quotes' ? 'bg-[#c2185b] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  onClick={() => setRecentTab('quotes')}
                >
                  Báo giá ({quotes.length})
                </button>
                <button 
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${recentTab === 'contracts' ? 'bg-[#c2185b] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  onClick={() => setRecentTab('contracts')}
                >
                  Hợp đồng ({contracts.length})
                </button>
              </div>
            </div>
            <Button variant="link" className="text-blue-600 h-auto p-0 text-xs font-semibold hover:text-blue-700 flex items-center gap-1" onClick={() => setTab(recentTab)}>
              <span>Xem tất cả</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>

          <div className="space-y-2">
            {recentTab === 'projects' && (
              projects.length ? projects.slice(0, 2).map((p: any) => (
                <div 
                  key={p.id} 
                  className="p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                  onClick={() => setTab('projects')}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <FolderKanban className="size-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-xs">{p.name || p.projectCode || p.id}</div>
                      <Badge className="bg-blue-50 text-blue-700 border-blue-100 shadow-none font-medium text-[10px] mt-0.5">
                        {p.status || 'Planning'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-8 text-xs text-slate-500">
                    <div>Owner: <span className="font-medium text-slate-700">{memberName(p.owner_id || p.ownerId)}</span></div>
                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Calendar className="size-3" />
                      <span>{formatCrmDate(p.updatedAt || p.createdAt)}</span>
                    </div>
                    <ChevronRight className="size-4 text-slate-400" />
                  </div>
                </div>
              )) : <div className="py-6 text-center text-slate-400 text-xs">Chưa có dự án nào liên quan.</div>
            )}

            {recentTab === 'quotes' && (
              quotes.length ? quotes.slice(0, 2).map((q: any) => (
                <div 
                  key={q.id} 
                  className="p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                  onClick={() => setTab('quotes')}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                      <FileText className="size-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-xs">{q.quote_number || q.quoteNumber || q.id}</div>
                      <div className="text-[11px] text-emerald-600 font-bold mt-0.5">{formatVND(Number(q.total_amount || q.totalAmount || 0))}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-8 text-xs text-slate-500">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Calendar className="size-3" />
                      <span>{formatCrmDate(q.updated_at || q.created_at)}</span>
                    </div>
                    <ChevronRight className="size-4 text-slate-400" />
                  </div>
                </div>
              )) : <div className="py-6 text-center text-slate-400 text-xs">Chưa có báo giá nào liên quan.</div>
            )}

            {recentTab === 'contracts' && (
              contracts.length ? contracts.slice(0, 2).map((c: any) => (
                <div 
                  key={c.id} 
                  className="p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                  onClick={() => setTab('contracts')}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <FileCheck className="size-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-xs">{c.title || c.contract_number || c.id}</div>
                      <div className="text-[11px] text-emerald-600 font-bold mt-0.5">{formatVND(Number(c.contract_value || 0))}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-8 text-xs text-slate-500">
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 text-[10px] shadow-none">{c.status || 'Hiệu lực'}</Badge>
                    <ChevronRight className="size-4 text-slate-400" />
                  </div>
                </div>
              )) : <div className="py-6 text-center text-slate-400 text-xs">Chưa có hợp đồng nào liên quan.</div>
            )}
          </div>
        </section>

      </div>

      {/* RIGHT SIDEBAR CONTEXT RAIL (~30%) */}
      <div className="pl-6 border-l border-slate-200 space-y-6 min-w-0">
        
        {/* Section 1: THÔNG TIN KHÁCH HÀNG */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <h3 className="font-bold text-xs uppercase tracking-wide text-slate-800 flex items-center gap-1.5">
              <Building2 className="size-4 text-[#c2185b]" />
              <span>Thông tin khách hàng</span>
            </h3>
            {onEditCustomer && (
              <Button variant="link" className="text-blue-600 h-auto p-0 text-xs font-semibold hover:text-blue-700" onClick={onEditCustomer}>
                Chỉnh sửa
              </Button>
            )}
          </div>
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-slate-400 font-medium">Công ty</span>
              <span className="font-semibold text-slate-800 truncate">{customer?.company_name || customer?.customer_name || 'Hilab'}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-slate-400 font-medium">Mã số thuế</span>
              <span className="font-medium text-slate-700">{customer?.tax_code || '—'}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-slate-400 font-medium">Lĩnh vực</span>
              <span className="font-medium text-slate-700">{customer?.industry || '—'}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-slate-400 font-medium">Nguồn</span>
              <span className="font-medium text-slate-700">{customer?.source || 'Personal'}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-slate-400 font-medium">Owner (Sale)</span>
              <span className="font-semibold text-slate-800 truncate">{memberName(customer?.owner_id) || 'Minhuit911'}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-slate-400 font-medium">Ngày tạo</span>
              <span className="font-medium text-slate-700">{formatCrmDate(customer?.created_at || '2026-09-21')}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-slate-400 font-medium">Cập nhật gần nhất</span>
              <span className="font-medium text-slate-700">{formatCrmDate(customer?.updated_at || '2026-09-24')}</span>
            </div>
          </div>
        </div>

        {/* Section 2: LIÊN HỆ CHÍNH */}
        <div className="space-y-3 pt-1 border-t border-slate-100">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <h3 className="font-bold text-xs uppercase tracking-wide text-slate-800 flex items-center gap-1.5">
              <UserCheck className="size-4 text-[#c2185b]" />
              <span>Liên hệ chính</span>
            </h3>
            <Button variant="link" className="text-blue-600 h-auto p-0 text-xs font-semibold hover:text-blue-700" onClick={() => setTab('contacts')}>
              Xem tất cả
            </Button>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-full bg-rose-100 text-[#c2185b] font-bold text-sm flex items-center justify-center shrink-0">
                {(primaryContact?.name || contactName(primaryContactId) || 'T').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-slate-900 text-xs truncate">{primaryContact?.name || contactName(primaryContactId) || 'Trần Hoàng Hiệp'}</div>
                <div className="text-[11px] text-slate-500 font-medium truncate">{primaryContact?.position || 'Giám đốc'}</div>
              </div>
            </div>

            {primaryContact?.phone ? (
              <div className="text-xs text-slate-600 pt-1 font-medium">{primaryContact.phone}</div>
            ) : <div className="text-xs text-slate-600 pt-1 font-medium">0935383940</div>}

            {/* Social / Contact round logo icon buttons: Call, Mail, Zalo */}
            <div className="flex items-center gap-3 pt-2">
              <a 
                href={`tel:${(primaryContact?.phone || '0935383940').replace(/\D/g, '')}`} 
                className="size-9 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-[#c2185b] hover:text-[#c2185b] hover:bg-rose-50/50 flex items-center justify-center transition-all shadow-2xs"
                title="Gọi điện"
              >
                <Phone className="size-4 stroke-[1.75]" />
              </a>
              <a 
                href={`mailto:${primaryContact?.email || ''}`} 
                className="size-9 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-[#c2185b] hover:text-[#c2185b] hover:bg-rose-50/50 flex items-center justify-center transition-all shadow-2xs"
                title="Gửi Email"
              >
                <Mail className="size-4 stroke-[1.75]" />
              </a>
              <a 
                href={primaryContact?.zalo || `https://zalo.me/${(primaryContact?.phone || '0935383940').replace(/\D/g, '')}`} 
                target="_blank"
                rel="noreferrer"
                className="size-9 rounded-full border border-slate-200 bg-white text-blue-600 hover:border-blue-500 hover:bg-blue-50/50 flex items-center justify-center transition-all shadow-2xs"
                title="Nhắn Zalo"
              >
                <ZaloIcon className="size-4 text-blue-600" />
              </a>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
