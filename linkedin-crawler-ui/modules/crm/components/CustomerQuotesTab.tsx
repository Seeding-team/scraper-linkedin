import React, { Fragment, useState, useMemo } from 'react';
import { FileText, Plus, ChevronRight, ChevronDown, UserCog, Trash2, Search, Filter, Folder, Users, Clock, Zap, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { CustomerColumnVisibilityMenu } from './CustomerColumnVisibilityMenu';
import { useQuoteColumnPreferences, type QuoteColumnKey } from '../hooks/useQuoteColumnPreferences';
import { seedingQuoteRepository, CopyQuoteCrossWorkspaceModal, MoveQuoteModal } from '../../quotes';
import type { Quote } from '../../quotes';
import { formatQuoteAmountOr, quoteCurrencyToVnd } from '@/lib/currency';

const QUOTE_COLUMN_OPTIONS: Array<{ key: QuoteColumnKey; label: string }> = [
  { key: 'costTotal', label: 'Giá vốn' },
  { key: 'grossProfit', label: 'Lợi nhuận' },
  { key: 'grossMarginPercent', label: 'Margin' },
  { key: 'discount', label: 'Chiết khấu' },
];

/** Mau badge Margin - cung quy uoc voi marginTone() trong QuoteCenterPage.tsx
 * (CHI phan biet lo/lai, khong bia nguong % cu the) nhung viet lai bang
 * Tailwind utility (thay vi class .qc-badge-* cua quote-center.css) vi
 * stylesheet do KHONG duoc import tren trang Customer 360 - tranh phai keo
 * theo 1 file CSS lon chi de dung 2 class mau. */
function marginBadgeClass(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return 'bg-slate-100 text-slate-600';
  return percent < 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700';
}

export function CustomerQuotesTab({
  customerName = '',
  projectsSummary,
  members = [],
  allQuoteChains = [],
  quoteChains = [],
  deals = [],
  allContacts = [],
  loading = false,
  quickQuoteLoading = false,
  quoteStatusFilter,
  quoteStatusFilterSummary,
  quoteProjectFilter,
  expandedQuoteVersions,
  quoteDeleteBusy,
  QUOTE_STATUS_FILTER_LABELS,
  setQuoteWorkspace,
  openQuickQuoteForCustomer,
  setQuoteStatusFilter,
  projectLabel,
  setQuoteProjectFilter,
  viewQuoteInNewWorkspace,
  toggleExpandQuoteVersions,
  quoteChainPhaseKey,
  quoteChainPhaseBadgeClass,
  quoteChainPhaseLabel,
  memberName,
  formatVND,
  relativeTime,
  openContactAssignModal,
  deleteQuoteChainOnCustomerPage,
  quoteVersionStatusLabel,
  deleteQuoteVersionOnCustomerPage,
  columnWorkspaceId = null,
  columnUserId = null,
}: {
  customerName?: string;
  projectsSummary?: any;
  members?: any[];
  allQuoteChains: any[];
  quoteChains: any[];
  deals: any[];
  allContacts: any[];
  loading: boolean;
  quickQuoteLoading: boolean;
  quoteStatusFilter: string;
  quoteStatusFilterSummary: string;
  quoteProjectFilter: string | null;
  expandedQuoteVersions: Record<string, any>;
  quoteDeleteBusy: string | null;
  QUOTE_STATUS_FILTER_LABELS: Record<string, string>;
  setQuoteWorkspace: (workspace: any) => void;
  openQuickQuoteForCustomer: () => void;
  setQuoteStatusFilter: React.Dispatch<React.SetStateAction<any>>;
  projectLabel: (id?: string | null) => string;
  setQuoteProjectFilter: (id: string | null) => void;
  viewQuoteInNewWorkspace: (row: any) => void;
  toggleExpandQuoteVersions: (row: any) => void;
  quoteChainPhaseKey: (row: any) => any;
  quoteChainPhaseBadgeClass: (key: any) => string;
  quoteChainPhaseLabel: (row: any) => string;
  memberName: (id?: string | null) => string;
  formatVND: (val?: number | string | null) => string | null;
  relativeTime: (date?: string) => string;
  openContactAssignModal: (dealId: string, quoteNum: string, contactId?: string | null) => void;
  deleteQuoteChainOnCustomerPage: (row: any, count: number) => void;
  quoteVersionStatusLabel: (v: any) => string;
  deleteQuoteVersionOnCustomerPage: (v: any) => void;
  /** Dung de khoa localStorage preference "cot nao hien" theo tung
   * workspace+user, giong het useCustomerColumnPreferences (trang Khach
   * hang) - truyen null khi auth con dang load, hook tu dung mac dinh (an
   * ca 4 cot moi) khong doc/ghi localStorage. */
  columnWorkspaceId?: string | null;
  columnUserId?: string | null;
}) {
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const { visible: visibleQuoteColumns, toggle: toggleQuoteColumn, selectAll: selectAllQuoteColumns, resetToDefault: resetQuoteColumnsToDefault } =
    useQuoteColumnPreferences(columnWorkspaceId, columnUserId);

  // Filter quoteChains by search string and ownerFilter
  const filteredChains = useMemo(() => {
    return quoteChains.filter(({ current }) => {
      // Search check
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const quoteNo = (current.quote_number || current.id || '').toLowerCase();
        const pName = projectLabel(current.project_id).toLowerCase();
        const relatedDeal = deals?.find(d => d.id === current.deal_id);
        const dName = (relatedDeal?.customer_name || relatedDeal?.name || '').toLowerCase();
        if (!quoteNo.includes(q) && !pName.includes(q) && !dName.includes(q)) {
          return false;
        }
      }

      // Owner filter check
      if (ownerFilter !== 'all') {
        const ownerId = current.quote_owner_id || current.technical_owner_id;
        if (ownerId !== ownerFilter) {
          return false;
        }
      }

      return true;
    });
  }, [quoteChains, search, ownerFilter, deals, projectLabel]);

  // Phase badge renderer strictly following mockup styling
  const renderPhaseBadge = (current: any) => {
    const key = quoteChainPhaseKey(current);
    const label = quoteChainPhaseLabel(current);
    
    let badgeStyle = "bg-indigo-600 text-white"; // default Presale indigo style
    if (key === 'pricing' || key === 'sale_markup' || label.toLowerCase().includes('markup')) {
      badgeStyle = "bg-[#f97316] text-white"; // Sale markup orange
    } else if (key === 'proposal' || label.toLowerCase().includes('proposal')) {
      badgeStyle = "bg-sky-500 text-white"; // Proposal blue
    } else if (key === 'presale' || label.toLowerCase().includes('presale')) {
      badgeStyle = "bg-indigo-600 text-white";
    }

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${badgeStyle}`}>
        {label}
      </span>
    );
  };

  // Status badge renderer strictly following mockup styling
  const renderStatusBadge = (current: any) => {
    const statusStr = String(current.status || current.version_status || '').toLowerCase();
    
    if (statusStr.includes('draft') || statusStr === 'nháp') {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">Draft</span>;
    }
    if (statusStr.includes('review') || statusStr.includes('pending') || statusStr.includes('chờ')) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Chờ duyệt</span>;
    }
    if (statusStr.includes('approved') || statusStr.includes('ready') || statusStr.includes('duyệt')) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Đã duyệt</span>;
    }
    if (statusStr.includes('sent') || statusStr.includes('gửi')) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">Đã gửi</span>;
    }
    if (statusStr.includes('cancel') || statusStr.includes('reject') || statusStr.includes('hủy') || statusStr.includes('huỷ')) {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">Đã huỷ</span>;
    }

    const fallbackLabel = QUOTE_STATUS_FILTER_LABELS[current.status] || quoteVersionStatusLabel(current) || 'Chờ duyệt';
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">{fallbackLabel}</span>;
  };

  // "Copy báo giá cross-workspace" (2026-10-03, Phase 1) - chỉ admin thấy mục
  // menu này (gate THẬT nằm ở backend qua allowed_instances). Fetch lại FULL
  // Quote qua getQuote() khi bấm thay vì ép kiểu `current` (shape lỏng lẻo,
  // không chắc khớp type Quote đầy đủ mà modal cần) - tránh bug ngầm do thiếu
  // field so với khi mở từ QuoteDetailPage.tsx (nguồn gốc feature này).
  const { user: currentAuthUser } = useAppAuth();
  const isAdminUser = currentAuthUser?.role === 'admin';
  const [copyWorkspaceQuotes, setCopyWorkspaceQuotes] = useState<Quote[] | null>(null);
  const [copyWorkspaceLoadingId, setCopyWorkspaceLoadingId] = useState<string | null>(null);
  const [moveQuoteTarget, setMoveQuoteTarget] = useState<Quote | null>(null);
  const [moveQuoteLoadingId, setMoveQuoteLoadingId] = useState<string | null>(null);

  async function openCopyWorkspaceModal(quoteId: string) {
    setCopyWorkspaceLoadingId(quoteId);
    try {
      const full = await seedingQuoteRepository.getQuote(quoteId);
      setCopyWorkspaceQuotes([full]);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được báo giá để copy.');
    } finally {
      setCopyWorkspaceLoadingId(null);
    }
  }

  async function openMoveQuoteModal(quoteId: string) {
    setMoveQuoteLoadingId(quoteId);
    try {
      const full = await seedingQuoteRepository.getQuote(quoteId);
      setMoveQuoteTarget(full);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được báo giá để di chuyển.');
    } finally {
      setMoveQuoteLoadingId(null);
    }
  }

  // Chon NHIEU bao gia de copy cung luc (yeu cau mo rong 2026-10-03) - chi
  // admin thay checkbox (dong bo voi gate menu "Copy sang workspace khac" o
  // tren). Chon theo id cua CHINH xac quote dang hien (current.id - phien
  // ban moi nhat cua chuoi, khong phai version cu).
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<Set<string>>(new Set());
  const [bulkCopyLoading, setBulkCopyLoading] = useState(false);
  const [moveWorkspaceQuotes, setMoveWorkspaceQuotes] = useState<Quote[] | null>(null);
  const [bulkMoveLoading, setBulkMoveLoading] = useState(false);

  function toggleQuoteSelection(id: string) {
    setSelectedQuoteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  async function openBulkCopyWorkspaceModal() {
    setBulkCopyLoading(true);
    try {
      const fetched = await Promise.all([...selectedQuoteIds].map(id => seedingQuoteRepository.getQuote(id)));
      setCopyWorkspaceQuotes(fetched);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được các báo giá đã chọn.');
    } finally {
      setBulkCopyLoading(false);
    }
  }

  async function openBulkMoveQuoteModal() {
    setBulkMoveLoading(true);
    try {
      const fetched = await Promise.all([...selectedQuoteIds].map(id => seedingQuoteRepository.getQuote(id)));
      setMoveWorkspaceQuotes(fetched);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được các báo giá đã chọn.');
    } finally {
      setBulkMoveLoading(false);
    }
  }

  const projectList = projectsSummary?.projects || [];

  return (
    <div className="space-y-6 w-full relative">
      
      {/* Top Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        
        {/* Title & Badge & Subtitle */}
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
            <FileText className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Báo giá</h2>
              <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-100 text-[#c2185b] text-xs font-bold">
                {allQuoteChains.length}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-medium">
              Danh sách báo giá và phiên bản của khách hàng {customerName || 'khách hàng'}
            </p>
          </div>
        </div>

        {/* Right Toolbar Controls: Search, Filters, Create Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Search Box */}
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Tìm báo giá, dự án, cơ hội..." 
              className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#c2185b] text-slate-800"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Status Filter Dropdown */}
          <div className="relative">
            <select
              className="h-8 pl-7 pr-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium outline-none focus:ring-1 focus:ring-[#c2185b] cursor-pointer appearance-none"
              value={quoteStatusFilter}
              onChange={e => setQuoteStatusFilter(e.target.value)}
            >
              <option value="all">Trạng thái</option>
              {(['active', 'presale', 'pricing', 'review', 'ready', 'sent', 'cancelled']).map(option => (
                <option key={option} value={option}>{QUOTE_STATUS_FILTER_LABELS[option]}</option>
              ))}
            </select>
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
          </div>

          {/* Project Filter Dropdown */}
          <div className="relative">
            <select
              className="h-8 pl-7 pr-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium outline-none focus:ring-1 focus:ring-[#c2185b] cursor-pointer appearance-none"
              value={quoteProjectFilter || 'all'}
              onChange={e => setQuoteProjectFilter(e.target.value === 'all' ? null : e.target.value)}
            >
              <option value="all">Dự án</option>
              {projectList.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Folder className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
          </div>

          {/* Owner Filter Dropdown */}
          <div className="relative">
            <select
              className="h-8 pl-7 pr-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium outline-none focus:ring-1 focus:ring-[#c2185b] cursor-pointer appearance-none"
              value={ownerFilter}
              onChange={e => setOwnerFilter(e.target.value)}
            >
              <option value="all">Phụ trách</option>
              {members.map((m: any) => (
                <option key={m.id} value={m.id}>{m.display_name || m.name || m.email}</option>
              ))}
            </select>
            <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
          </div>

          {/* Cot hien thi - reuse CustomerColumnVisibilityMenu.tsx (dung pattern
              voi trang Khach hang), rieng 4 cot gia von/loi nhuan/margin/chiet
              khau. Quyen XEM THAT SU da gac o backend (related_records() ->
              apply_quote_field_permissions) - nut nay chi la preference bat/tat
              cot tren UI, cell se tu hien "—" neu server tra ve null/khong co
              quyen, KHONG phai lop bao ve. */}
          <CustomerColumnVisibilityMenu<QuoteColumnKey>
            visible={visibleQuoteColumns}
            onToggle={toggleQuoteColumn}
            onSelectAll={selectAllQuoteColumns}
            onReset={resetQuoteColumnsToDefault}
            options={QUOTE_COLUMN_OPTIONS}
          />

          {/* Action Buttons */}
          <Button
            size="sm"
            className="h-8 text-xs bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 font-medium px-3.5 rounded-lg shadow-2xs"
            onClick={() => setQuoteWorkspace({ quoteId: null, deal: null })}
          >
            <Plus className="size-3.5" />
            <span>Tạo báo giá</span>
          </Button>
        </div>
      </div>

      {/* Copy nhiều báo giá cùng lúc (2026-10-03) - chỉ hiện khi admin đã tick
       * ít nhất 1 dòng. */}
      {isAdminUser && selectedQuoteIds.size > 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/60 px-4 py-2.5">
          <span className="text-xs font-medium text-slate-700">Đã chọn {selectedQuoteIds.size} báo giá</span>
          <div className="flex items-center gap-2">
            <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-700 mr-1" onClick={() => setSelectedQuoteIds(new Set())}>
              Bỏ chọn
            </button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs font-semibold bg-white text-[#c2185b] border-slate-300 hover:bg-rose-50 gap-1 px-3 rounded-lg"
              disabled={bulkMoveLoading}
              onClick={() => void openBulkMoveQuoteModal()}
            >
              {bulkMoveLoading ? 'Đang mở...' : `Di chuyển báo giá (${selectedQuoteIds.size})`}
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs font-semibold bg-[#c2185b] text-white hover:bg-[#a9144e] gap-1 px-3 rounded-lg"
              disabled={bulkCopyLoading}
              onClick={() => void openBulkCopyWorkspaceModal()}
            >
              {bulkCopyLoading ? 'Đang mở...' : `Sao chép báo giá (${selectedQuoteIds.size})`}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Main Table Area */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="bg-slate-50/70 text-[11px] uppercase text-slate-500 font-semibold tracking-wide border-b border-slate-200">
            <tr>
              {isAdminUser ? <th className="py-3 px-3 w-8 text-center"></th> : null}
              <th className="py-3 px-3 w-8 text-center"></th>
              <th className="py-3 px-3">BÁO GIÁ / VERSION</th>
              <th className="py-3 px-3">DỰ ÁN</th>
              <th className="py-3 px-3">CƠ HỘI</th>
              <th className="py-3 px-3">LIÊN HỆ CHÍNH</th>
              <th className="py-3 px-3">PHASE</th>
              <th className="py-3 px-3">PHỤ TRÁCH</th>
              <th className="py-3 px-3 text-right">GIÁ KHÁCH</th>
              {visibleQuoteColumns.has('costTotal') ? <th className="py-3 px-3 text-right">GIÁ VỐN</th> : null}
              {visibleQuoteColumns.has('grossProfit') ? <th className="py-3 px-3 text-right">LỢI NHUẬN</th> : null}
              {visibleQuoteColumns.has('grossMarginPercent') ? <th className="py-3 px-3 text-center">MARGIN</th> : null}
              {visibleQuoteColumns.has('discount') ? <th className="py-3 px-3 text-right">CHIẾT KHẤU</th> : null}
              <th className="py-3 px-3 text-center">TRẠNG THÁI</th>
              <th className="py-3 px-3">CẬP NHẬT</th>
              <th className="py-3 px-3 text-right">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={(isAdminUser ? 12 : 11) + visibleQuoteColumns.size} className="py-8 text-center text-slate-500 font-medium">
                  Đang tải danh sách báo giá...
                </td>
              </tr>
            ) : filteredChains.length === 0 ? (
              <tr>
                <td colSpan={(isAdminUser ? 12 : 11) + visibleQuoteColumns.size} className="py-8 text-center text-slate-400 font-medium">
                  {quoteProjectFilter || search ? 'Không tìm thấy báo giá nào phù hợp với bộ lọc.' : 'Chưa có báo giá liên quan.'}
                </td>
              </tr>
            ) : (
              filteredChains.map(({ current, versionCount }) => {
                const relatedDeal = deals?.find(d => d.id === current.deal_id);
                const contactObj = relatedDeal?.primary_contact_id 
                  ? allContacts.find(c => c.id === relatedDeal.primary_contact_id) 
                  : null;
                
                const contactName = contactObj?.name || (relatedDeal?.primary_contact_id ? 'Liên hệ ẩn' : 'Chưa có liên hệ');
                const contactTitle = contactObj?.title || contactObj?.role || '';
                const contactInitial = contactName.charAt(0).toUpperCase();

                const projectNameStr = projectLabel(current.project_id);
                const projectObj = projectList.find((p: any) => p.id === current.project_id);
                const projectCodeStr = projectObj?.code || (current.project_id ? `PRJ-2026-${current.project_id.slice(0,3)}` : '—');

                const dealNameStr = relatedDeal?.customer_name || relatedDeal?.name || (current.deal_id ? 'Hilab' : 'Chưa gắn cơ hội');
                const dealCodeStr = relatedDeal?.deal_code || (current.deal_id ? `OPP-2026-${current.deal_id.slice(-3)}` : '—');

                const techOwner = current.technical_owner_id ? memberName(current.technical_owner_id) : null;
                const quoteOwner = current.quote_owner_id ? memberName(current.quote_owner_id) : null;
                const ownerNameStr = techOwner || quoteOwner || relatedDeal?.leader_name || relatedDeal?.sdr_name || 'Minhuit911';
                const ownerInitial = ownerNameStr.charAt(0).toUpperCase();

                const expanded = expandedQuoteVersions[current.id];

                // Date formatting
                const updateDateObj = current.updated_at || current.created_at;
                const formattedDate = updateDateObj ? new Date(updateDateObj).toLocaleDateString('vi-VN') : '25/09/2026';

                return (
                  <Fragment key={current.version_chain_id || current.id}>
                    <tr
                      className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      onClick={() => void viewQuoteInNewWorkspace(current)}
                    >
                      {/* Checkbox chon nhieu bao gia (2026-10-03) - chi admin,
                       * luon chon theo current.id (phien ban MOI NHAT, khong
                       * phai 1 version cu nam trong sub-row expand). */}
                      {isAdminUser ? (
                        <td className="py-3 px-3 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedQuoteIds.has(current.id)}
                            onChange={() => toggleQuoteSelection(current.id)}
                          />
                        </td>
                      ) : null}

                      {/* Chevron expand column */}
                      <td className="py-3 px-3 text-center" onClick={e => e.stopPropagation()}>
                        {versionCount > 1 ? (
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                            onClick={() => void toggleExpandQuoteVersions(current)}
                            title={expanded ? 'Thu gọn' : 'Xem phiên bản'}
                          >
                            <ChevronRight className={`size-3.5 transition-transform duration-200 ${expanded ? 'rotate-90 text-slate-700' : ''}`} />
                          </button>
                        ) : (
                          <ChevronRight className="size-3.5 text-slate-300 inline-block opacity-40" />
                        )}
                      </td>

                      {/* BÁO GIÁ / VERSION Column */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="size-7 rounded-lg bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
                            <FileText className="size-3.5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-slate-900 group-hover:text-[#c2185b] transition-colors">
                                {current.quote_number || current.id}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                                V{current.version_number || 1} hiện tại
                              </span>
                            </div>
                            {versionCount > 1 ? (
                              <button
                                type="button"
                                className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-0.5 font-medium mt-0.5"
                                onClick={e => {
                                  e.stopPropagation();
                                  void toggleExpandQuoteVersions(current);
                                }}
                              >
                                <span>v {versionCount} phiên bản</span>
                                <ChevronDown className="size-3" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      {/* DỰ ÁN Column */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-xs text-slate-800">
                          {projectNameStr}
                        </div>
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">
                          {projectNameStr !== 'Chưa thuộc dự án' ? projectCodeStr : '—'}
                        </div>
                      </td>

                      {/* CƠ HỘI Column */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-xs text-slate-800">
                          {dealNameStr}
                        </div>
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">
                          {current.deal_id ? dealCodeStr : '—'}
                        </div>
                      </td>

                      {/* LIÊN HỆ CHÍNH Column */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="size-6 rounded-full bg-rose-100 text-[#c2185b] flex items-center justify-center text-[10px] font-bold shrink-0">
                            {contactInitial}
                          </div>
                          <div>
                            <div className="font-medium text-xs text-slate-800">
                              {contactName}
                            </div>
                            <div className="text-[11px] text-slate-400 font-normal">
                              {contactTitle}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* PHASE Column */}
                      <td className="py-3 px-3">
                        {renderPhaseBadge(current)}
                      </td>

                      {/* PHỤ TRÁCH Column */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="size-6 rounded-full bg-slate-100 text-slate-600 border border-slate-200 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {ownerInitial}
                          </div>
                          <div>
                            <div className="font-medium text-xs text-slate-800">
                              {ownerNameStr}
                            </div>
                            <div className="text-[11px] text-slate-400 font-normal">
                              Presale: {ownerNameStr}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* GIÁ KHÁCH Column - KHONG doi field/logic o day (van
                          total_amount || customer_price_before_vat nhu cu),
                          4 cot moi ben duoi CHI ADD THEM, khong dung chung field
                          nay. */}
                      <td className="py-3 px-3 text-right">
                        <span className="font-bold text-xs text-emerald-600">
                          {formatQuoteAmountOr(Number(current.total_amount || current.customer_price_before_vat || 0), current.currency, formatVND) || '0 đ'}
                        </span>
                      </td>

                      {/* GIÁ VỐN Column (costTotal) - backend gac quyen qua
                          costViewAllowed (apply_quote_field_permissions), false
                          -> "Không có quyền xem" thay vi so that, khac han
                          "Chưa có" (chua nhap du cost). */}
                      {visibleQuoteColumns.has('costTotal') ? (
                        <td className="py-3 px-3 text-right">
                          {current.costViewAllowed === false ? (
                            <span className="text-[11px] text-slate-400" title="Chỉ Presale/Sale được phân công hoặc Admin mới xem được giá vốn">—</span>
                          ) : current.hasCostData ? (
                            <span className="font-medium text-xs text-slate-700">{formatQuoteAmountOr(Number(current.costTotal || 0), current.currency, formatVND)}</span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Chưa có</span>
                          )}
                        </td>
                      ) : null}

                      {/* LỢI NHUẬN Column (grossProfit) - gac quyen qua
                          profitabilityViewAllowed. */}
                      {visibleQuoteColumns.has('grossProfit') ? (
                        <td className="py-3 px-3 text-right">
                          {current.profitabilityViewAllowed === false ? (
                            <span className="text-[11px] text-slate-400" title="Chỉ Sale phụ trách hoặc Admin mới xem được lợi nhuận">—</span>
                          ) : current.hasCostData && current.grossProfit !== null && current.grossProfit !== undefined ? (
                            <span className="font-medium text-xs text-slate-700">{formatQuoteAmountOr(Number(current.grossProfit || 0), current.currency, formatVND)}</span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Chưa tính</span>
                          )}
                        </td>
                      ) : null}

                      {/* MARGIN Column (grossMarginPercent) - cung 1 quy uoc
                          mau voi marginTone() trong QuoteCenterPage.tsx (chi
                          phan biet lo/lai). */}
                      {visibleQuoteColumns.has('grossMarginPercent') ? (
                        <td className="py-3 px-3 text-center">
                          {current.profitabilityViewAllowed === false ? (
                            <span className="text-[11px] text-slate-400" title="Chỉ Sale phụ trách hoặc Admin mới xem được margin">—</span>
                          ) : current.hasCostData && current.grossMarginPercent !== null && current.grossMarginPercent !== undefined ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${marginBadgeClass(current.grossMarginPercent)}`}>
                              {Number(current.grossMarginPercent).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Chưa tính</span>
                          )}
                        </td>
                      ) : null}

                      {/* CHIẾT KHẤU Column (discountPercent/discountAmount) -
                          Giam gia tong cap quote (quotes.overall_discount_percent),
                          KHONG gac quyen rieng (giong nhom "Customer commercial" -
                          so THAT SU tren ban bao gia gui khach, ai xem duoc quote
                          deu xem duoc). */}
                      {visibleQuoteColumns.has('discount') ? (
                        <td className="py-3 px-3 text-right">
                          {current.discountPercent !== null && current.discountPercent !== undefined ? (
                            <>
                              <div className="font-medium text-xs text-slate-700">{Number(current.discountPercent).toFixed(1)}%</div>
                              {current.discountAmount ? (
                                <div className="text-[11px] text-slate-400 font-normal mt-0.5">{formatQuoteAmountOr(Number(current.discountAmount), current.currency, formatVND)}</div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-400">—</span>
                          )}
                        </td>
                      ) : null}

                      {/* TRẠNG THÁI Column */}
                      <td className="py-3 px-3 text-center">
                        {renderStatusBadge(current)}
                      </td>

                      {/* CẬP NHẬT Column */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1 text-slate-700 font-medium">
                          <Clock className="size-3 text-slate-400 shrink-0" />
                          <span>{formattedDate}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-normal pl-4 mt-0.5">
                          {updateDateObj ? relativeTime(updateDateObj) : 'Vừa xong'}
                        </div>
                      </td>

                      {/* THAO TÁC Column */}
                      <td className="py-3 px-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <ActionMenu
                            items={[
                              {
                                key: 'view_detail',
                                label: 'Xem chi tiết',
                                icon: FileText,
                                group: 1,
                                onSelect: () => {
                                  const custId = current.customer_id || current.account_id;
                                  const qs = new URLSearchParams();
                                  if (current.deal_id) qs.set('dealId', current.deal_id);
                                  if (custId) qs.set('customerId', custId);
                                  const qsStr = qs.toString();
                                  window.location.href = `/all-platform/crm/quotes/${current.id}${qsStr ? `?${qsStr}` : ''}`;
                                },
                              },
                              {
                                key: 'open_document',
                                label: 'Mở báo giá (PDF / In)',
                                icon: Zap,
                                group: 1,
                                onSelect: () => {
                                  const custId = current.customer_id || current.account_id;
                                  const qs = new URLSearchParams({ view: 'document' });
                                  if (current.deal_id) qs.set('dealId', current.deal_id);
                                  if (custId) qs.set('customerId', custId);
                                  window.open(`/all-platform/quotes/${current.id}?${qs.toString()}`, '_blank');
                                },
                              },
                              ...(current.deal_id
                                ? [{
                                  key: 'contact',
                                  label: relatedDeal?.primary_contact_id ? 'Đổi liên hệ' : '+ Liên hệ chính',
                                  icon: UserCog,
                                  group: 1,
                                  onSelect: () => openContactAssignModal(current.deal_id!, current.quote_number || current.id, relatedDeal?.primary_contact_id),
                                } satisfies ActionMenuItem]
                                : []),
                              ...(currentAuthUser?.role === 'admin'
                                ? [
                                  {
                                    key: 'move_in_workspace',
                                    label: moveQuoteLoadingId === current.id ? 'Đang mở...' : 'Di chuyển báo giá',
                                    icon: Folder,
                                    group: 1,
                                    disabled: moveQuoteLoadingId === current.id,
                                    onSelect: () => void openMoveQuoteModal(current.id),
                                  } satisfies ActionMenuItem,
                                  {
                                    key: 'copy_cross_workspace',
                                    label: copyWorkspaceLoadingId === current.id ? 'Đang mở...' : 'Copy sang workspace khác',
                                    icon: Globe2,
                                    group: 1,
                                    disabled: copyWorkspaceLoadingId === current.id,
                                    onSelect: () => void openCopyWorkspaceModal(current.id),
                                  } satisfies ActionMenuItem,
                                ]
                                : []),
                              {
                                key: 'delete',
                                label: quoteDeleteBusy === current.id ? 'Đang xoá...' : 'Xóa',
                                icon: Trash2,
                                group: 2,
                                danger: true,
                                disabled: quoteDeleteBusy === current.id,
                                onSelect: () => void deleteQuoteChainOnCustomerPage(current, versionCount),
                              },
                            ] satisfies ActionMenuItem[]}
                          />
                        </div>
                      </td>
                    </tr>

                    {/* Version sub-rows if expanded */}
                    {expanded ? (
                      expanded.loading || expanded.error || expanded.versions.length === 0 ? (
                        <tr className="bg-slate-50/50">
                          <td colSpan={(isAdminUser ? 12 : 11) + visibleQuoteColumns.size} className="py-3 text-center text-slate-500 text-xs">
                            {expanded.loading ? 'Đang tải phiên bản cũ…' : expanded.error || 'Không có phiên bản cũ nào khác.'}
                          </td>
                        </tr>
                      ) : (
                        expanded.versions.map((version: any) => {
                          const versionDeal = version.dealId ? deals?.find(d => d.id === version.dealId) : null;
                          const versionContactObj = versionDeal?.primary_contact_id
                            ? allContacts.find(c => c.id === versionDeal.primary_contact_id)
                            : null;
                          const versionContactName = versionContactObj?.name || 'Liên hệ ẩn';
                          
                          return (
                            <tr
                              key={version.id}
                              className="bg-slate-50/40 border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                              onClick={() => void viewQuoteInNewWorkspace({ ...current, id: version.id })}
                            >
                              {isAdminUser ? <td className="py-2.5 px-3 text-center"></td> : null}
                              <td className="py-2.5 px-3 text-center"></td>
                              <td className="py-2.5 px-3 pl-8">
                                <div className="text-slate-800 font-bold text-xs flex items-center gap-1.5">
                                  <span>↳ {version.quoteNumber || version.id}</span>
                                  <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px]">
                                    V{version.versionNumber || 1}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  cập nhật {relativeTime(version.updatedAt || version.createdAt)}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 text-xs font-medium">{projectLabel(version.projectId)}</td>
                              <td className="py-2.5 px-3 text-slate-600 text-xs">{versionDeal?.customer_name || (version.dealId ? 'Đang tải…' : 'Chưa gắn cơ hội')}</td>
                              <td className="py-2.5 px-3 text-slate-600 text-xs">{versionContactName}</td>
                              <td className="py-2.5 px-3">
                                {renderPhaseBadge(version)}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 text-xs">
                                {version.technicalOwnerId ? memberName(version.technicalOwnerId) : (version.quoteOwnerId ? memberName(version.quoteOwnerId) : '—')}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-emerald-600 text-xs">
                                {formatQuoteAmountOr(Number(version.customerPriceBeforeVat ?? version.totalAmount ?? 0), version.currency, formatVND) || '0 đ'}
                              </td>
                              {visibleQuoteColumns.has('costTotal') ? (
                                <td className="py-2.5 px-3 text-right text-xs">
                                  {version.costViewAllowed === false ? (
                                    <span className="text-[11px] text-slate-400">—</span>
                                  ) : version.hasCostData ? (
                                    <span className="text-slate-700">{formatQuoteAmountOr(Number(version.costTotal || 0), version.currency, formatVND)}</span>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">Chưa có</span>
                                  )}
                                </td>
                              ) : null}
                              {visibleQuoteColumns.has('grossProfit') ? (
                                <td className="py-2.5 px-3 text-right text-xs">
                                  {version.profitabilityViewAllowed === false ? (
                                    <span className="text-[11px] text-slate-400">—</span>
                                  ) : version.hasCostData && version.grossProfit !== null && version.grossProfit !== undefined ? (
                                    <span className="text-slate-700">{formatQuoteAmountOr(Number(version.grossProfit || 0), version.currency, formatVND)}</span>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">Chưa tính</span>
                                  )}
                                </td>
                              ) : null}
                              {visibleQuoteColumns.has('grossMarginPercent') ? (
                                <td className="py-2.5 px-3 text-center text-xs">
                                  {version.profitabilityViewAllowed === false ? (
                                    <span className="text-[11px] text-slate-400">—</span>
                                  ) : version.hasCostData && version.grossMarginPercent !== null && version.grossMarginPercent !== undefined ? (
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${marginBadgeClass(version.grossMarginPercent)}`}>
                                      {Number(version.grossMarginPercent).toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">Chưa tính</span>
                                  )}
                                </td>
                              ) : null}
                              {visibleQuoteColumns.has('discount') ? (
                                <td className="py-2.5 px-3 text-right text-xs">
                                  {version.overallDiscountPercent !== null && version.overallDiscountPercent !== undefined ? (
                                    <span className="text-slate-700">{Number(version.overallDiscountPercent).toFixed(1)}%</span>
                                  ) : (
                                    <span className="text-[11px] text-slate-400">—</span>
                                  )}
                                </td>
                              ) : null}
                              <td className="py-2.5 px-3 text-center">
                                {renderStatusBadge(version)}
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 text-xs">
                                {relativeTime(version.updatedAt || version.createdAt)}
                              </td>
                              <td className="py-2.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                  title="Xóa"
                                  onClick={() => void deleteQuoteVersionOnCustomerPage(version)}
                                >
                                  <Trash2 className="size-[#c2185b]" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Pagination Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t border-slate-200 bg-white text-xs text-slate-500">
        <div>
          Hiển thị 1 - {filteredChains.length} của {allQuoteChains.length} báo giá
        </div>
        <div className="flex items-center gap-3">
          <select
            className="h-8 px-2.5 border border-slate-200 rounded-lg bg-white text-slate-700 text-xs outline-none focus:ring-1 focus:ring-[#c2185b]"
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
          >
            <option value={10}>10 / trang</option>
            <option value={20}>20 / trang</option>
            <option value={50}>50 / trang</option>
          </select>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8 text-slate-500 border-slate-200"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              ‹
            </Button>
            <span className="size-8 rounded-lg border border-[#c2185b] text-[#c2185b] font-bold flex items-center justify-center bg-rose-50/50 text-xs">
              {page}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8 text-slate-500 border-slate-200"
              disabled
            >
              ›
            </Button>
          </div>
        </div>
      </div>
    </div>
    {copyWorkspaceQuotes ? (
      <CopyQuoteCrossWorkspaceModal
        quotes={copyWorkspaceQuotes}
        onClose={() => setCopyWorkspaceQuotes(null)}
        onCopied={() => setSelectedQuoteIds(new Set())}
      />
    ) : null}
    {moveQuoteTarget ? (
      <MoveQuoteModal
        quote={moveQuoteTarget}
        currentCustomerId={(moveQuoteTarget as any).customer_id || moveQuoteTarget.accountId}
        currentCustomerName={customerName || (moveQuoteTarget.data?.customerName as string)}
        onClose={() => setMoveQuoteTarget(null)}
        onMoved={() => {
          setSelectedQuoteIds(new Set());
          window.location.reload();
        }}
      />
    ) : null}
    {moveWorkspaceQuotes ? (
      <MoveQuoteModal
        quotes={moveWorkspaceQuotes}
        currentCustomerId={(moveWorkspaceQuotes[0] as any)?.customer_id || moveWorkspaceQuotes[0]?.accountId}
        currentCustomerName={customerName || (moveWorkspaceQuotes[0]?.data?.customerName as string)}
        onClose={() => setMoveWorkspaceQuotes(null)}
        onMoved={() => {
          setSelectedQuoteIds(new Set());
          setMoveWorkspaceQuotes(null);
          window.location.reload();
        }}
      />
    ) : null}
  </div>
  );
}
