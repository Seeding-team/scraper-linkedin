import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FolderKanban,
  Plus,
  ArrowLeft,
  FileText,
  Search,
  User,
  Folder,
  Calendar,
  Target,
  FileCheck,
  Paperclip,
  ChevronRight,
  DollarSign,
  Activity
} from 'lucide-react';
import { formatVND } from '../constants/crmConfig';

function formatCrmDate(value?: string | null): string {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function CustomerProjectsTab({
  deals = [],
  quotes = [],
  contracts = [],
  projectsSummary,
  projectsLoading,
  canManageProject,
  openDealWorkspace,
  viewQuoteInNewWorkspace,
  setProjectModal,
  setDealModal,
  onCreateQuote,
  onCreateContract,
  memberName,
  allContacts = [],
  activityItems = [],
}: {
  deals: any[];
  quotes: any[];
  contracts: any[];
  projectsSummary: any;
  projectsLoading: boolean;
  projectsError?: string;
  canManageProject: boolean;
  setTab?: (tab: any) => void;
  openDealWorkspace: (id: string) => void;
  viewQuoteInNewWorkspace: (row: any) => void;
  setProjectModal: (modal: any) => void;
  setDealModal: (modal: any) => void;
  /** "Tạo báo giá" trên Project card (tab Báo giá) - mở QuoteWorkspaceModal khóa sẵn Dự án này,
   * KHÔNG mở nhầm form Tạo Cơ hội như trước (bug thực tế đã xác nhận, xem thao/CRM_KNOWN_BUGS_FIXED.md). */
  onCreateQuote: (projectId: string) => void;
  /** "Tạo hợp đồng" trên Project card (tab Hợp đồng) - cùng pattern với onCreateQuote. */
  onCreateContract: (projectId: string) => void;
  memberName: (id?: string | null) => string;
  allContacts?: any[];
  activityItems?: any[];
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSubTab, setProjectSubTab] = useState<'overview' | 'deals' | 'quotes' | 'contracts' | 'contacts' | 'documents' | 'activities'>('overview');
  
  // Outer project list filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Sub-tab filters
  const [dealSearch, setDealSearch] = useState('');
  const [dealStageFilter, setDealStageFilter] = useState('all');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [contractSearch, setContractSearch] = useState('');

  const projects = useMemo(() => projectsSummary?.projects || [], [projectsSummary]);
  const selectedProject = useMemo(() => projects.find((p: any) => p.id === selectedProjectId), [projects, selectedProjectId]);

  const filteredProjects = useMemo(() => {
    return projects.filter((p: any) => {
      const matchSearch = !search || (p.name || p.projectCode || p.id).toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || (p.status || '').toLowerCase() === statusFilter.toLowerCase();
      return matchSearch && matchStatus;
    });
  }, [projects, search, statusFilter]);

  const projectDeals = useMemo(() => {
    if (!selectedProjectId) return [];
    return deals.filter((d: any) => d.project_id === selectedProjectId || d.projectId === selectedProjectId);
  }, [deals, selectedProjectId]);

  const filteredProjectDeals = useMemo(() => {
    return projectDeals.filter((d: any) => {
      const matchSearch = !dealSearch || (d.customer_name || d.id || '').toLowerCase().includes(dealSearch.toLowerCase());
      const matchStage = dealStageFilter === 'all' || (d.deal_stage || '').toLowerCase() === dealStageFilter.toLowerCase();
      return matchSearch && matchStage;
    });
  }, [projectDeals, dealSearch, dealStageFilter]);

  const projectQuotes = useMemo(() => {
    if (!selectedProjectId) return [];
    const dealIds = new Set(projectDeals.map((d: any) => d.id));
    return quotes.filter((q: any) => q.project_id === selectedProjectId || q.projectId === selectedProjectId || (q.deal_id && dealIds.has(q.deal_id)));
  }, [quotes, selectedProjectId, projectDeals]);

  const filteredProjectQuotes = useMemo(() => {
    return projectQuotes.filter((q: any) => {
      return !quoteSearch || (q.quote_number || q.id || '').toLowerCase().includes(quoteSearch.toLowerCase());
    });
  }, [projectQuotes, quoteSearch]);

  const projectContracts = useMemo(() => {
    if (!selectedProjectId) return [];
    const dealIds = new Set(projectDeals.map((d: any) => d.id));
    return contracts.filter((c: any) => c.project_id === selectedProjectId || c.projectId === selectedProjectId || (c.deal_id && dealIds.has(c.deal_id)));
  }, [contracts, selectedProjectId, projectDeals]);

  const filteredProjectContracts = useMemo(() => {
    return projectContracts.filter((c: any) => {
      return !contractSearch || (c.contract_number || c.title || c.id || '').toLowerCase().includes(contractSearch.toLowerCase());
    });
  }, [projectContracts, contractSearch]);

  const projectBudget = useMemo(() => {
    return projectDeals.reduce((sum: number, d: any) => sum + Number(d.estimated_budget || d.lifetime_value || 0), 0);
  }, [projectDeals]);

  // VIEW 2: PROJECT WORKSPACE (DETAIL VIEW)
  if (selectedProject) {
    return (
      <div className="space-y-5 bg-white py-1">
        
        {/* Back Button */}
        <div>
          <button
            onClick={() => setSelectedProjectId(null)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span>Dự án</span>
          </button>
        </div>

        {/* Workspace Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3.5 min-w-[280px]">
            <div className="size-11 rounded-xl bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0 shadow-sm">
              <Folder className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">{selectedProject.name || selectedProject.projectCode || selectedProject.id}</h2>
                <Badge className="bg-blue-50 text-blue-700 border-blue-100 shadow-none font-semibold text-[11px] px-2.5 py-0.5 rounded-full">
                  {selectedProject.status || 'Lập kế hoạch'}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap font-medium">
                <span>{selectedProject.projectCode || selectedProject.id?.slice(0, 8)}</span>
                {(selectedProject.startDate || selectedProject.endDate) ? (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3 text-slate-400" />
                      {formatCrmDate(selectedProject.startDate)} → {formatCrmDate(selectedProject.endDate)}
                    </span>
                  </>
                ) : null}
                <span>•</span>
                <span>Owner: <strong className="text-slate-700 font-semibold">{memberName(selectedProject.owner_id || selectedProject.ownerId)}</strong></span>
                <span>•</span>
                <span>Cập nhật: {formatCrmDate(selectedProject.updatedAt || selectedProject.createdAt)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canManageProject && (
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-xs gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
                onClick={() => setProjectModal({ open: true, project: selectedProject })}
              >
                Chỉnh sửa dự án
              </Button>
            )}
          </div>
        </div>

        {/* Project Sub-tabs Bar */}
        <div className="flex items-center gap-6 border-b border-slate-200 overflow-x-auto">
          {[
            { id: 'overview', label: 'Tổng quan' },
            { id: 'deals', label: 'Cơ hội', count: projectDeals.length },
            { id: 'quotes', label: 'Báo giá', count: projectQuotes.length },
            { id: 'contracts', label: 'Hợp đồng', count: projectContracts.length },
            { id: 'contacts', label: 'Người liên hệ', count: allContacts.length },
            { id: 'documents', label: 'Tài liệu', count: 0 },
            { id: 'activities', label: 'Hoạt động', count: activityItems?.length || 0 },
          ].map(t => {
            const active = projectSubTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setProjectSubTab(t.id as any)}
                className={`relative pb-3 text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  active ? 'text-[#c2185b]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span className={`min-w-4 h-4 px-1.5 rounded-full text-[10px] inline-flex items-center justify-center font-bold ${
                    active ? 'bg-rose-100 text-[#c2185b]' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {t.count}
                  </span>
                )}
                {active && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-[#c2185b] rounded-t-full" />}
              </button>
            );
          })}
        </div>

        {/* Sub-tab Content Area */}
        <div className="pt-2">
          
          {/* 1. TỔNG QUAN */}
          {projectSubTab === 'overview' && (
            <div className="space-y-6">
              
              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Cơ hội liên quan</div>
                    <div className="text-xl font-bold text-slate-900 mt-0.5">{projectDeals.length}</div>
                  </div>
                  <div className="size-9 rounded-lg bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center">
                    <Target className="size-4.5" />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Báo giá</div>
                    <div className="text-xl font-bold text-slate-900 mt-0.5">{projectQuotes.length}</div>
                  </div>
                  <div className="size-9 rounded-lg bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center">
                    <FileText className="size-4.5" />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Hợp đồng</div>
                    <div className="text-xl font-bold text-slate-900 mt-0.5">{projectContracts.length}</div>
                  </div>
                  <div className="size-9 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center">
                    <FileCheck className="size-4.5" />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Tổng giá trị dự kiến</div>
                    <div className="text-xl font-bold text-emerald-600 mt-0.5">{formatVND(projectBudget) || '0 đ'}</div>
                  </div>
                  <div className="size-9 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center">
                    <DollarSign className="size-4.5" />
                  </div>
                </div>
              </div>

              {/* Linked Deals List */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="font-bold text-xs uppercase tracking-wide text-slate-700 flex items-center gap-2">
                    <Target className="size-4 text-[#c2185b]" />
                    <span>Cơ hội trong dự án này</span>
                  </h3>
                  <Button variant="link" className="text-[#c2185b] p-0 text-xs font-semibold h-auto" onClick={() => setProjectSubTab('deals')}>
                    Xem tất cả ({projectDeals.length})
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50/50 text-[11px] text-slate-500 uppercase font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Cơ hội</th>
                        <th className="px-4 py-2.5">Giai đoạn</th>
                        <th className="px-4 py-2.5 text-right">Giá trị dự kiến</th>
                        <th className="px-4 py-2.5 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {projectDeals.length ? projectDeals.slice(0, 5).map((d: any) => (
                        <tr key={d.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer" onClick={() => openDealWorkspace(d.id)}>
                          <td className="px-4 py-3 font-semibold text-slate-900">{d.customer_name || d.id}</td>
                          <td className="px-4 py-3"><Badge className="bg-blue-50 text-blue-700 border-blue-100 font-semibold text-[10px]">{d.deal_stage}</Badge></td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900">{formatVND(Number(d.estimated_budget || 0))}</td>
                          <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" className="h-6 text-xs text-[#c2185b] font-medium">Chi tiết</Button></td>
                        </tr>
                      )) : (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Chưa gắn cơ hội nào vào dự án này.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* 2. CƠ HỘI */}
          {projectSubTab === 'deals' && (
            <div className="space-y-4">
              {/* Toolbar with Create Button */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 p-2.5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Tìm cơ hội..." 
                      className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#c2185b]"
                      value={dealSearch}
                      onChange={e => setDealSearch(e.target.value)}
                    />
                  </div>
                  <select 
                    className="h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 outline-none focus:ring-1 focus:ring-[#c2185b]"
                    value={dealStageFilter}
                    onChange={e => setDealStageFilter(e.target.value)}
                  >
                    <option value="all">Tất cả giai đoạn</option>
                    <option value="lead">Khách hàng tiềm năng</option>
                    <option value="qualification">Đánh giá nhu cầu</option>
                    <option value="proposal">Báo giá / Đề xuất</option>
                    <option value="negotiation">Đàm phán</option>
                    <option value="won">Thành công</option>
                    <option value="lost">Thất bại</option>
                  </select>
                </div>

                <Button 
                  size="sm" 
                  className="h-8 text-xs bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 font-medium px-3 rounded-lg shadow-sm"
                  onClick={() => setDealModal({ open: true, project: selectedProject })}
                >
                  <Plus className="size-3.5" /> Tạo cơ hội
                </Button>
              </div>

              {/* Deals Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">Cơ hội</th>
                      <th className="px-4 py-2.5">Giai đoạn</th>
                      <th className="px-4 py-2.5 text-right">Giá trị dự kiến</th>
                      <th className="px-4 py-2.5">Người phụ trách</th>
                      <th className="px-4 py-2.5">Cập nhật</th>
                      <th className="px-4 py-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProjectDeals.length ? filteredProjectDeals.map((d: any) => (
                      <tr key={d.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer" onClick={() => openDealWorkspace(d.id)}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{d.customer_name || d.id}</td>
                        <td className="px-4 py-3"><Badge className="bg-blue-50 text-blue-700 border-blue-100 font-semibold text-[10px]">{d.deal_stage}</Badge></td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{formatVND(Number(d.estimated_budget || 0))}</td>
                        <td className="px-4 py-3 text-slate-600">{memberName(d.quote_owner_id || d.owner_id)}</td>
                        <td className="px-4 py-3 text-slate-400">{formatCrmDate(d.updated_at || d.created_at)}</td>
                        <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" className="h-6 text-xs text-[#c2185b] font-medium">Mở workspace</Button></td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Không có cơ hội nào phù hợp.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. BÁO GIÁ */}
          {projectSubTab === 'quotes' && (
            <div className="space-y-4">
              {/* Toolbar with Create Button */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 p-2.5 rounded-xl border border-slate-200">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Tìm báo giá..." 
                    className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#c2185b]"
                    value={quoteSearch}
                    onChange={e => setQuoteSearch(e.target.value)}
                  />
                </div>

                <Button
                  size="sm"
                  className="h-8 text-xs bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 font-medium px-3 rounded-lg shadow-sm"
                  onClick={() => selectedProject && onCreateQuote(selectedProject.id)}
                >
                  <Plus className="size-3.5" /> Tạo báo giá
                </Button>
              </div>

              {/* Quotes Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">Mã báo giá</th>
                      <th className="px-4 py-2.5 text-right">Giá trị</th>
                      <th className="px-4 py-2.5">Trạng thái</th>
                      <th className="px-4 py-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProjectQuotes.length ? filteredProjectQuotes.map((q: any) => (
                      <tr key={q.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer" onClick={() => viewQuoteInNewWorkspace(q)}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{q.quote_number || q.id}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{formatVND(Number(q.total_amount || 0))}</td>
                        <td className="px-4 py-3"><Badge className="bg-amber-50 text-amber-700 border-amber-100 text-[10px] font-semibold">Chờ duyệt</Badge></td>
                        <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" className="h-6 text-xs text-[#c2185b] font-medium">Xem báo giá</Button></td>
                      </tr>
                    )) : (
                      <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Chưa có báo giá thuộc dự án này.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4. HỢP ĐỒNG */}
          {projectSubTab === 'contracts' && (
            <div className="space-y-4">
              {/* Toolbar with Create Button */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 p-2.5 rounded-xl border border-slate-200">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Tìm hợp đồng..." 
                    className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#c2185b]"
                    value={contractSearch}
                    onChange={e => setContractSearch(e.target.value)}
                  />
                </div>

                <Button
                  size="sm"
                  className="h-8 text-xs bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 font-medium px-3 rounded-lg shadow-sm"
                  onClick={() => selectedProject && onCreateContract(selectedProject.id)}
                >
                  <Plus className="size-3.5" /> Tạo hợp đồng
                </Button>
              </div>

              {/* Contracts Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">Hợp đồng</th>
                      <th className="px-4 py-2.5">Trạng thái</th>
                      <th className="px-4 py-2.5 text-right">Giá trị hợp đồng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProjectContracts.length ? filteredProjectContracts.map((c: any) => (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-900">{c.title || c.contract_number || c.id}</td>
                        <td className="px-4 py-3"><Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 text-[10px] font-semibold">{c.status || 'Hiệu lực'}</Badge></td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{formatVND(Number(c.contract_value || 0))}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400">Chưa có hợp đồng nào thuộc dự án này.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. NGƯỜI LIÊN HỆ */}
          {projectSubTab === 'contacts' && (
            <div className="space-y-3">
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white divide-y divide-slate-100">
                {allContacts.length ? allContacts.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-200">
                        {c.name ? c.name[0]?.toUpperCase() : 'C'}
                      </div>
                      <div>
                        <div className="font-semibold text-xs text-slate-900">{c.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{c.position || 'Liên hệ chính'} • {c.phone || c.email || 'Chưa có thông tin'}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-medium border-slate-200 text-slate-600 bg-slate-50">Tham gia dự án</Badge>
                  </div>
                )) : (
                  <div className="text-center py-10 text-xs text-slate-400">Chưa có người liên hệ nào.</div>
                )}
              </div>
            </div>
          )}

          {/* 6. TÀI LIỆU */}
          {projectSubTab === 'documents' && (
            <div className="py-14 text-center border border-slate-200 rounded-xl bg-slate-50/50">
              <FileText className="size-9 mx-auto text-slate-300 stroke-1" />
              <p className="text-xs font-semibold text-slate-700 mt-2">Chưa có tài liệu nào</p>
              <p className="text-[11px] text-slate-400 mt-1">API quản lý và đính kèm tài liệu cho dự án chưa được khởi tạo.</p>
            </div>
          )}

          {/* 7. HOẠT ĐỘNG */}
          {projectSubTab === 'activities' && (
            <div className="py-14 text-center border border-slate-200 rounded-xl bg-slate-50/50">
              <Activity className="size-9 mx-auto text-slate-300 stroke-1" />
              <p className="text-xs font-semibold text-slate-700 mt-2">Nhật ký hoạt động</p>
              <p className="text-[11px] text-slate-400 mt-1">Chưa có hoạt động nào được ghi nhận cho dự án này.</p>
            </div>
          )}

        </div>
      </div>
    );
  }

  // VIEW 1: PROJECT LIST (FLAT CARD ROW LIST)
  return (
    <div className="space-y-6 bg-white py-1">
      
      {/* Workspace Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <FolderKanban className="size-5 text-[#c2185b]" />
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              Dự án
              <span className="inline-flex items-center justify-center size-5 rounded-full bg-rose-100 text-[#c2185b] text-xs font-bold">
                {projects.length}
              </span>
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Danh sách dự án của khách hàng</p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Tìm dự án..." 
              className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#c2185b]"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select 
            className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium outline-none focus:ring-1 focus:ring-[#c2185b]"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="planning">Lập kế hoạch</option>
            <option value="in_progress">Đang triển khai</option>
            <option value="completed">Hoàn thành</option>
          </select>

          {canManageProject && (
            <Button 
              size="sm" 
              className="h-8 text-xs bg-[#c2185b] hover:bg-[#a91549] text-white gap-1 font-medium px-3 rounded-lg shadow-sm"
              onClick={() => setProjectModal({ open: true, project: null })}
            >
              <Plus className="size-3.5" /> Tạo dự án
            </Button>
          )}
        </div>
      </div>

      {/* Project Card Rows List */}
      {projectsLoading ? (
        <div className="py-12 text-center text-xs text-slate-400">Đang tải danh sách dự án...</div>
      ) : filteredProjects.length ? (
        <div className="space-y-3">
          {filteredProjects.map((p: any) => {
            const pDeals = deals.filter((d: any) => d.project_id === p.id || d.projectId === p.id);
            const pQuotes = quotes.filter((q: any) => q.project_id === p.id || q.projectId === p.id);
            const pContracts = contracts.filter((c: any) => c.project_id === p.id || c.projectId === p.id);
            const projectValue = pDeals.reduce((sum: number, d: any) => sum + Number(d.estimated_budget || d.lifetime_value || 0), 0);

            return (
              <div 
                key={p.id} 
                className="p-4 rounded-xl border border-slate-200/90 bg-white hover:border-slate-300 transition-all flex flex-wrap items-center justify-between gap-4 cursor-pointer group"
                onClick={() => setSelectedProjectId(p.id)}
              >
                {/* Column 1: Pink Folder Box + Project Name + Code & Update Date */}
                <div className="flex items-center gap-3.5 min-w-[220px]">
                  <div className="size-10 rounded-xl bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
                    <Folder className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-slate-900 truncate">{p.name || p.projectCode || p.id}</div>
                    <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                      {p.projectCode || p.id?.slice(0, 8)} • Cập nhật {formatCrmDate(p.updatedAt || p.createdAt)}
                    </div>
                  </div>
                </div>

                {/* Column 2: Status Badge */}
                <div className="shrink-0 min-w-[110px]">
                  <Badge className="bg-blue-50 text-blue-700 border-blue-100 shadow-none font-semibold text-[11px] px-2.5 py-0.5 rounded-full">
                    {p.status || 'Lập kế hoạch'}
                  </Badge>
                </div>

                {/* Column 3: Owner */}
                <div className="flex items-center gap-2 shrink-0 min-w-[120px]">
                  <div className="size-6 rounded-full bg-slate-200 text-slate-700 font-bold text-[10px] flex items-center justify-center shrink-0">
                    {memberName(p.owner_id || p.ownerId)[0] || 'M'}
                  </div>
                  <span className="text-xs font-medium text-slate-700 truncate">{memberName(p.owner_id || p.ownerId)}</span>
                </div>

                {/* Column 4: Date Range (Only show if real dates exist) */}
                {(p.startDate || p.endDate) ? (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium shrink-0 min-w-[180px]">
                    <Calendar className="size-3.5 text-slate-400 shrink-0" />
                    <span>{formatCrmDate(p.startDate)} → {formatCrmDate(p.endDate)}</span>
                  </div>
                ) : null}

                {/* Column 5: Entity Counters */}
                <div className="flex items-center gap-4 text-xs shrink-0 border-l border-slate-100 pl-4">
                  <div className="flex items-center gap-1.5">
                    <Target className="size-3.5 text-[#c2185b]" />
                    <span className="font-bold text-slate-800">{pDeals.length}</span>
                    <span className="text-[11px] text-slate-400">Cơ hội</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileText className="size-3.5 text-amber-600" />
                    <span className="font-bold text-slate-800">{pQuotes.length}</span>
                    <span className="text-[11px] text-slate-400">Báo giá</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileCheck className="size-3.5 text-emerald-600" />
                    <span className="font-bold text-slate-800">{pContracts.length}</span>
                    <span className="text-[11px] text-slate-400">Hợp đồng</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Paperclip className="size-3.5 text-blue-600" />
                    <span className="font-bold text-slate-800">0</span>
                    <span className="text-[11px] text-slate-400">Tài liệu</span>
                  </div>
                </div>

                {/* Column 6: Estimated Value & Action Arrow */}
                <div className="flex items-center gap-3 shrink-0 border-l border-slate-100 pl-4">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 font-medium uppercase">Giá trị dự kiến</div>
                    <div className="text-xs font-bold text-slate-900">{formatVND(projectValue) || '0 đ'}</div>
                  </div>
                  <ChevronRight className="size-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
          <FolderKanban className="size-10 text-slate-300 stroke-1" />
          <span>Chưa có dự án nào được tạo cho khách hàng này.</span>
        </div>
      )}

    </div>
  );
}
