'use client';

import React, { useMemo, useState } from 'react';
import {
  TrendingUp,
  FileText,
  ChevronRight,
  ArrowRight,
  ChevronDown,
  Layers,
  FolderKanban,
  Target,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { formatVND } from '../constants/crmConfig';

export interface OverviewDealItem {
  id: string;
  customer_name?: string | null;
  deal_stage?: string | null;
  estimated_budget?: number | string | null;
  lifetime_value?: number | string | null;
  updated_at?: string | null;
  created_at?: string | null;
  project_id?: string | null;
  primary_contact_id?: string | null;
  leader_name?: string | null;
  sdr_name?: string | null;
}

export interface OverviewQuoteItem {
  id: string;
  quote_number?: string | null;
  status?: string | null;
  total_amount?: number | string | null;
  deal_id?: string | null;
  project_id?: string | null;
  version_chain_id?: string | null;
  version_number?: number | null;
  processing_stage?: string | null;
  approved_at?: string | null;
  published_at?: string | null;
  sent_at?: string | null;
  deleted_at?: string | null;
  updated_at?: string | null;
}

export interface OverviewProjectItem {
  id: string;
  name: string;
  projectCode?: string | null;
  status?: string | null;
  description?: string | null;
  createdAt?: string | null;
  opportunityCount?: number | null;
  quoteCaseCount?: number | null;
  versionCount?: number | null;
  currentQuoteValue?: number | null;
}

interface CustomerProjectCrmOverviewProps {
  deals: OverviewDealItem[];
  quotes: OverviewQuoteItem[];
  projects?: OverviewProjectItem[];
  onNavigateTab: (tab: 'deals' | 'quotes') => void;
  onOpenDeal: (dealId: string) => void;
  onOpenQuote: (quote: OverviewQuoteItem) => void;
}

type PipelineStageKey = 'potential' | 'evaluating' | 'quote' | 'negotiation' | 'won' | 'lost';

function getPipelineStageKey(stage?: string | null): PipelineStageKey {
  if (!stage) return 'potential';
  const s = stage.toLowerCase();
  if (s === 'new_lead' || s === 'lead' || s === 'potential' || s === 'tiem_nang') return 'potential';
  if (s === 'evaluating' || s === 'qualified' || s === 'dealing' || s === 'contacted' || s === 'danh_gia') return 'evaluating';
  if (s === 'proposal_sent' || s === 'requirement' || s === 'quote' || s === 'bao_gia') return 'quote';
  if (s === 'negotiation' || s === 'dang_dam_phan' || s === 'contract_sent' || s === 'dam_phan') return 'negotiation';
  if (s === 'won' || s === 'contract_signed' || s === 'payment_1' || s === 'implementation' || s === 'acceptance' || s === 'payment_final' || s === 'post_sale_care' || s === 'thang') return 'won';
  if (s === 'lost' || s === 'on_hold' || s === 'thua') return 'lost';
  return 'evaluating';
}

// Bảng màu giai đoạn Pipeline trên Stepper: Nền màu đặc tươi sáng (Solid 500) và Chữ màu trắng tinh
const PIPELINE_STAGES: Array<{
  key: PipelineStageKey;
  label: string;
  bgColor: string;
  textColor: string;
  countColor: string;
}> = [
  { key: 'potential', label: 'Tiềm năng', bgColor: 'bg-slate-500', textColor: 'text-white', countColor: 'text-slate-600 font-bold' },
  { key: 'evaluating', label: 'Đánh giá', bgColor: 'bg-blue-500', textColor: 'text-white', countColor: 'text-blue-600 font-bold' },
  { key: 'quote', label: 'Báo giá', bgColor: 'bg-purple-500', textColor: 'text-white', countColor: 'text-purple-600 font-bold' },
  { key: 'negotiation', label: 'Đàm phán', bgColor: 'bg-orange-500', textColor: 'text-white', countColor: 'text-orange-600 font-bold' },
  { key: 'won', label: 'Thắng', bgColor: 'bg-green-500', textColor: 'text-white', countColor: 'text-green-600 font-bold' },
  { key: 'lost', label: 'Thua', bgColor: 'bg-red-500', textColor: 'text-white', countColor: 'text-red-600 font-bold' },
];

// Cấu hình màu sắc giai đoạn với Nền đặc 500 và Chữ trắng tinh (White text)
const STAGE_BRIGHT_CONFIG: Record<PipelineStageKey, {
  label: string;
  badgeClass: string;
  dotClass: string;
}> = {
  potential: {
    label: 'Tiềm năng',
    badgeClass: 'bg-slate-500 text-white border-transparent',
    dotClass: 'bg-white',
  },
  evaluating: {
    label: 'Đánh giá',
    badgeClass: 'bg-blue-500 text-white border-transparent',
    dotClass: 'bg-white',
  },
  quote: {
    label: 'Báo giá',
    badgeClass: 'bg-purple-500 text-white border-transparent',
    dotClass: 'bg-white',
  },
  negotiation: {
    label: 'Đàm phán',
    badgeClass: 'bg-orange-500 text-white border-transparent font-semibold',
    dotClass: 'bg-white',
  },
  won: {
    label: 'Thắng',
    badgeClass: 'bg-green-500 text-white border-transparent font-semibold',
    dotClass: 'bg-white',
  },
  lost: {
    label: 'Thua',
    badgeClass: 'bg-red-500 text-white border-transparent',
    dotClass: 'bg-white',
  },
};

function formatShortCurrency(value: number): string {
  if (!value || value === 0) return '0 đ';
  if (value >= 1_000_000_000) {
    const num = value / 1_000_000_000;
    return `${Number(num.toFixed(2))}B`;
  }
  if (value >= 1_000_000) {
    const num = value / 1_000_000;
    return `${Number(num.toFixed(2))}M`;
  }
  if (value >= 1_000) {
    const num = value / 1_000;
    return `${Number(num.toFixed(1))}K`;
  }
  return `${value.toLocaleString('vi-VN')} đ`;
}

function formatDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function getQuoteStatusBadge(q: OverviewQuoteItem) {
  if (q.deleted_at || q.status === 'cancelled') {
    return <Badge className="text-[11px] bg-red-500 text-white border-transparent font-medium">Đã huỷ</Badge>;
  }
  if (q.sent_at || q.status === 'sent') {
    return <Badge className="text-[11px] bg-blue-500 text-white border-transparent font-medium">Đã gửi</Badge>;
  }
  if (q.status === 'accepted' || q.status === 'confirmed') {
    return <Badge className="text-[11px] bg-green-500 text-white border-transparent font-medium">Đã chấp nhận</Badge>;
  }
  if (q.status === 'approved' || q.approved_at || q.published_at || q.processing_stage === 'published') {
    return <Badge className="text-[11px] bg-purple-500 text-white border-transparent font-medium">Sẵn sàng gửi</Badge>;
  }
  if (q.processing_stage === 'review') {
    return <Badge className="text-[11px] bg-orange-500 text-white border-transparent font-medium">Admin review</Badge>;
  }
  if (q.processing_stage === 'pricing') {
    return <Badge className="text-[11px] bg-orange-500 text-white border-transparent font-medium">Sale markup</Badge>;
  }
  return <Badge className="text-[11px] bg-slate-500 text-white border-transparent font-medium">Đang soạn</Badge>;
}

// Badge giai đoạn với Solid Bright Background và White Text
function getBrightDealStageBadge(stage?: string | null) {
  const key = getPipelineStageKey(stage);
  const match = STAGE_BRIGHT_CONFIG[key] || STAGE_BRIGHT_CONFIG.evaluating;
  return (
    <Badge
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium shadow-xs text-white ${match.badgeClass}`}
    >
      <span className={`size-1.5 rounded-full ${match.dotClass} shrink-0`} />
      <span className="text-white">{match.label}</span>
    </Badge>
  );
}

export function CustomerProjectCrmOverview({
  deals,
  quotes,
  projects = [],
  onNavigateTab,
  onOpenDeal,
  onOpenQuote,
}: CustomerProjectCrmOverviewProps) {
  const [filterMode, setFilterMode] = useState<'status' | 'all'>('status');
  // State phân tầng theo Dự án (all = Tất cả, unassigned = Chưa gán, projectId = Dự án cụ thể)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  // State quản lý các dropdown xổ xuống của từng dự án trong mục Phân tầng dự án
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());

  const toggleExpandProject = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 1. Phân tầng Dự án (Hierarchy mapping: Số dự án, mỗi cái có bao nhiêu cơ hội và bao nhiêu báo giá)
  const projectHierarchy = useMemo(() => {
    const list = projects.map(p => {
      const pDeals = deals.filter(d => d.project_id === p.id);
      const pQuotes = quotes.filter(q => q.project_id === p.id);
      const dealCount = pDeals.length > 0 ? pDeals.length : (p.opportunityCount || 0);
      const quoteCount = pQuotes.length > 0 ? pQuotes.length : (p.quoteCaseCount || 0);
      const dealsBudget = pDeals.reduce((sum, d) => sum + Number(d.estimated_budget || d.lifetime_value || 0), 0);
      const quoteAmount = pQuotes.reduce((sum, q) => sum + Number(q.total_amount || 0), 0) || (p.currentQuoteValue || 0);

      return {
        id: p.id,
        name: p.name,
        projectCode: p.projectCode,
        status: p.status,
        description: p.description,
        createdAt: p.createdAt,
        dealCount,
        quoteCount,
        dealsBudget,
        quoteAmount,
        deals: pDeals,
        quotes: pQuotes,
      };
    });

    const assignedProjectIds = new Set(projects.map(p => p.id));
    const unassignedDeals = deals.filter(d => !d.project_id || !assignedProjectIds.has(d.project_id));
    const unassignedQuotes = quotes.filter(q => !q.project_id || !assignedProjectIds.has(q.project_id));
    const unassignedBudget = unassignedDeals.reduce((sum, d) => sum + Number(d.estimated_budget || d.lifetime_value || 0), 0);
    const unassignedQuoteAmount = unassignedQuotes.reduce((sum, q) => sum + Number(q.total_amount || 0), 0);

    return {
      projects: list,
      totalProjects: list.length,
      unassigned: {
        dealCount: unassignedDeals.length,
        quoteCount: unassignedQuotes.length,
        dealsBudget: unassignedBudget,
        quoteAmount: unassignedQuoteAmount,
        deals: unassignedDeals,
        quotes: unassignedQuotes,
      },
    };
  }, [projects, deals, quotes]);

  // 2. Dữ liệu lọc theo Phân tầng Dự án đã chọn
  const activeDeals = useMemo(() => {
    if (selectedProjectId === 'all') return deals;
    if (selectedProjectId === 'unassigned') return projectHierarchy.unassigned.deals;
    return deals.filter(d => d.project_id === selectedProjectId);
  }, [deals, selectedProjectId, projectHierarchy]);

  const activeQuotes = useMemo(() => {
    if (selectedProjectId === 'all') return quotes;
    if (selectedProjectId === 'unassigned') return projectHierarchy.unassigned.quotes;
    return quotes.filter(q => q.project_id === selectedProjectId);
  }, [quotes, selectedProjectId, projectHierarchy]);

  // 3. Phân loại Pipeline Cơ hội (theo phân tầng đang chọn)
  const pipelineCounts = useMemo(() => {
    const counts: Record<PipelineStageKey, number> = {
      potential: 0,
      evaluating: 0,
      quote: 0,
      negotiation: 0,
      won: 0,
      lost: 0,
    };
    for (const d of activeDeals) {
      const key = getPipelineStageKey(d.deal_stage);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [activeDeals]);

  // 4. Thống kê Giá trị Báo giá (Donut Chart theo phân tầng đang chọn)
  const quoteMetrics = useMemo(() => {
    let sentCount = 0;
    let sentAmount = 0;
    let draftCount = 0;
    let draftAmount = 0;
    let acceptedCount = 0;
    let acceptedAmount = 0;
    let rejectedCount = 0;
    let rejectedAmount = 0;

    for (const q of activeQuotes) {
      const amount = Number(q.total_amount || 0);
      if (q.deleted_at || q.status === 'cancelled' || q.status === 'rejected') {
        rejectedCount++;
        rejectedAmount += amount;
      } else if (q.status === 'accepted' || q.status === 'confirmed') {
        acceptedCount++;
        acceptedAmount += amount;
      } else if (q.sent_at || q.status === 'sent') {
        sentCount++;
        sentAmount += amount;
      } else if (q.status === 'approved' || q.approved_at) {
        acceptedCount++;
        acceptedAmount += amount;
      } else {
        draftCount++;
        draftAmount += amount;
      }
    }

    const totalAmount = sentAmount + draftAmount + acceptedAmount + rejectedAmount;
    const totalCount = sentCount + draftCount + acceptedCount + rejectedCount;

    return {
      sent: { count: sentCount, amount: sentAmount, color: '#2563eb', label: 'Đã gửi' },
      draft: { count: draftCount, amount: draftAmount, color: '#6366f1', label: 'Đang soạn' },
      accepted: { count: acceptedCount, amount: acceptedAmount, color: '#f59e0b', label: 'Đã chấp nhận' },
      rejected: { count: rejectedCount, amount: rejectedAmount, color: '#ef4444', label: 'Đã từ chối' },
      totalAmount,
      totalCount,
    };
  }, [activeQuotes]);

  // 5. Tính toán đường tròn Donut SVG
  const radius = 56;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius; // ~351.86

  const donutSegments = useMemo(() => {
    const list = [
      quoteMetrics.sent,
      quoteMetrics.draft,
      quoteMetrics.accepted,
      quoteMetrics.rejected,
    ];

    const basis = quoteMetrics.totalAmount > 0 ? quoteMetrics.totalAmount : quoteMetrics.totalCount;
    if (basis <= 0) return [];

    let accumulatedPercentage = 0;
    return list.map(item => {
      const val = quoteMetrics.totalAmount > 0 ? item.amount : item.count;
      const percentage = val / basis;
      const strokeDasharray = `${percentage * circumference} ${circumference}`;
      const strokeDashoffset = -accumulatedPercentage * circumference;
      accumulatedPercentage += percentage;
      return {
        ...item,
        percentage,
        strokeDasharray,
        strokeDashoffset,
      };
    });
  }, [quoteMetrics, circumference]);

  // 6. Danh sách Cơ hội & Báo giá mới nhất (theo phân tầng)
  const recentDeals = useMemo(() => {
    return [...activeDeals]
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
      .slice(0, 5);
  }, [activeDeals]);

  const recentQuotes = useMemo(() => {
    return [...activeQuotes]
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
      .slice(0, 5);
  }, [activeQuotes]);

  return (
    <div className="space-y-5">
      {/* ── BỘ ĐIỀU HƯỚNG PHÂN TẦNG DỰ ÁN (HIERARCHY FILTER PILLS) ── */}
      {(projectHierarchy.totalProjects > 0 || projectHierarchy.unassigned.dealCount > 0 || projectHierarchy.unassigned.quoteCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-muted/40 border border-border/70 text-xs">
          <div className="flex items-center gap-2 px-2 shrink-0 font-medium text-foreground">
            {/* Icon phân tầng: Nền trắng, nổi bật */}
            <div className="size-6 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-indigo-500">
              <Filter className="size-3.5" />
            </div>
            <span>Phân tầng:</span>
          </div>

          {/* Nút Xem tất cả dự án */}
          <Button
            type="button"
            variant={selectedProjectId === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedProjectId('all')}
            className={`h-7 text-xs rounded-lg gap-1.5 transition-all ${
              selectedProjectId === 'all'
                ? 'bg-indigo-500 text-white shadow-xs font-semibold hover:bg-indigo-600'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-border/80'
            }`}
          >
            <span>Tất cả</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
              selectedProjectId === 'all' ? 'bg-white/25 text-white' : 'bg-slate-500 text-white'
            }`}>
              {projectHierarchy.totalProjects} DA · {deals.length} CH · {quotes.length} BG
            </span>
          </Button>

          {/* Nút từng Dự án cụ thể */}
          {projectHierarchy.projects.map(p => (
            <Button
              key={p.id}
              type="button"
              variant={selectedProjectId === p.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedProjectId(p.id)}
              className={`h-7 text-xs rounded-lg gap-1.5 transition-all max-w-[240px] ${
                selectedProjectId === p.id
                  ? 'bg-indigo-500 text-white shadow-xs font-semibold hover:bg-indigo-600'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-border/80'
              }`}
            >
              <span className="truncate">{p.name}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full shrink-0 font-medium ${
                selectedProjectId === p.id ? 'bg-white/25 text-white' : 'bg-slate-500 text-white'
              }`}>
                {p.dealCount} CH · {p.quoteCount} BG
              </span>
            </Button>
          ))}

          {/* Nút Chưa gán dự án (nếu có deals/quotes mồ côi) */}
          {(projectHierarchy.unassigned.dealCount > 0 || projectHierarchy.unassigned.quoteCount > 0) && (
            <Button
              type="button"
              variant={selectedProjectId === 'unassigned' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedProjectId('unassigned')}
              className={`h-7 text-xs rounded-lg gap-1.5 transition-all ${
                selectedProjectId === 'unassigned'
                  ? 'bg-indigo-500 text-white shadow-xs font-semibold hover:bg-indigo-600'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-border/80'
              }`}
            >
              <span>Chưa thuộc DA</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                selectedProjectId === 'unassigned' ? 'bg-white/25 text-white' : 'bg-slate-500 text-white'
              }`}>
                {projectHierarchy.unassigned.dealCount} CH · {projectHierarchy.unassigned.quoteCount} BG
              </span>
            </Button>
          )}
        </div>
      )}

      {/* ── KHỐI 1: CƠ HỘI & BÁO GIÁ (GIỮ THIẾT KẾ ĐẶC TRƯNG) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CARD TRÁI: CƠ HỘI (Đổi từ 'Pipeline cơ hội') */}
        <Card className="bg-card border border-border/80 shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base font-bold text-foreground tracking-tight flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {/* Icon Cơ hội: Nền trắng, làm sáng và nổi bật màu Icon lên */}
                <div className="size-8 rounded-xl bg-white border border-gray-100 shadow-sm flex items-center justify-center text-orange-500">
                  <TrendingUp className="size-4.5" />
                </div>
                <span>Cơ hội</span>
                {selectedProjectId !== 'all' && (
                  <Badge className="text-[10px] font-medium py-0 bg-orange-500 text-white border-transparent">
                    Đang lọc phân tầng
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 gap-1 text-muted-foreground hover:text-primary p-0 px-2"
                onClick={() => onNavigateTab('deals')}
              >
                <span>Xem cơ hội</span>
                <ChevronRight className="size-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-6 pt-2">
            {/* Stepper Chevron 6 giai đoạn */}
            <div className="flex items-center w-full overflow-x-auto scrollbar-none py-1">
              {PIPELINE_STAGES.map((stage, idx) => {
                const count = pipelineCounts[stage.key];
                const isFirst = idx === 0;
                // Clip path đa giác mũi tên chuẩn
                const clipStyle = isFirst
                  ? 'polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%)'
                  : 'polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%, 10px 50%)';

                return (
                  <div
                    key={stage.key}
                    onClick={() => onNavigateTab('deals')}
                    className="flex-1 min-w-[72px] flex flex-col items-center group cursor-pointer"
                    title={`Xem cơ hội giai đoạn ${stage.label}`}
                  >
                    {/* Thanh chevron mũi tên với màu sáng thanh thoát */}
                    <div
                      style={{ clipPath: clipStyle }}
                      className={`w-full h-11 flex items-center justify-center px-2.5 transition-all duration-200 group-hover:brightness-95 ${stage.bgColor} ${!isFirst ? '-ml-1.5' : ''}`}
                    >
                      <span className={`text-[11px] sm:text-xs font-medium select-none truncate ${stage.textColor}`}>
                        {stage.label}
                      </span>
                    </div>

                    {/* Số lượng bên dưới mũi tên */}
                    <div className="pt-2 text-center">
                      <span className={`text-sm ${stage.countColor}`}>
                        {count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* CARD PHẢI: BÁO GIÁ (Đổi từ 'Giá trị báo giá') */}
        <Card className="bg-card border border-border/80 shadow-xs">
          <CardHeader className="pb-2 pt-5 px-5 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold text-foreground tracking-tight flex items-center gap-2.5">
              {/* Icon Báo giá: Nền trắng, làm sáng và nổi bật màu Icon lên */}
              <div className="size-8 rounded-xl bg-white border border-gray-100 shadow-sm flex items-center justify-center text-blue-500">
                <FileText className="size-4.5" />
              </div>
              <span>Báo giá</span>
              {selectedProjectId !== 'all' && (
                <Badge className="text-[10px] font-medium py-0 bg-blue-500 text-white border-transparent">
                  Đang lọc phân tầng
                </Badge>
              )}
            </CardTitle>
            <div className="relative">
              <select
                value={filterMode}
                onChange={e => setFilterMode(e.target.value as 'status' | 'all')}
                className="appearance-none text-xs text-muted-foreground bg-muted/40 hover:bg-muted/70 border border-border/70 rounded-lg px-2.5 py-1 pr-6 cursor-pointer focus:outline-hidden"
              >
                <option value="status">Theo trạng thái</option>
                <option value="all">Tất cả báo giá</option>
              </select>
              <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-1">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              {/* Donut Chart SVG */}
              <div className="relative size-36 shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 160 160" className="size-full -rotate-90">
                  {quoteMetrics.totalCount === 0 ? (
                    <circle
                      cx="80"
                      cy="80"
                      r={radius}
                      fill="none"
                      stroke="currentColor"
                      className="text-muted/30"
                      strokeWidth={strokeWidth}
                    />
                  ) : (
                    donutSegments.map((seg, i) => (
                      <circle
                        key={i}
                        cx="80"
                        cy="80"
                        r={radius}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={seg.strokeDasharray}
                        strokeDashoffset={seg.strokeDashoffset}
                        className="transition-all duration-300"
                      />
                    ))
                  )}
                </svg>
                {/* Tâm biểu đồ: Tổng giá trị */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                  <span className="text-base sm:text-lg font-bold text-foreground tracking-tight leading-tight">
                    {formatShortCurrency(quoteMetrics.totalAmount)}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    Tổng giá trị
                  </span>
                </div>
              </div>

              {/* Danh sách 4 trạng thái chi tiết */}
              <div className="flex-1 w-full space-y-2.5 text-xs">
                {[quoteMetrics.sent, quoteMetrics.draft, quoteMetrics.accepted, quoteMetrics.rejected].map(item => (
                  <div
                    key={item.label}
                    onClick={() => onNavigateTab('quotes')}
                    className="flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-muted/40 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-foreground font-medium">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground font-medium min-w-[14px] text-center">
                        {item.count}
                      </span>
                      <span className="font-semibold text-foreground text-right min-w-[85px]">
                        {formatVND(item.amount) || '0 đ'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── KHỐI PHÂN TẦNG DỰ ÁN CHI TIẾT (HIERARCHY BREAKDOWN CARD) ── */}
      <Card className="bg-card border border-border/80 shadow-xs">
        <CardHeader className="py-3 px-5 border-b border-border/60 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* Icon Dự án: Nền trắng, làm sáng và nổi bật màu Icon lên */}
            <div className="size-8 rounded-xl bg-white border border-gray-100 shadow-sm flex items-center justify-center text-indigo-500">
              <FolderKanban className="size-4.5" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <span>Phân tầng dự án</span>
                <Badge className="text-[11px] font-medium px-2 py-0 bg-indigo-500 text-white border-transparent">
                  {projectHierarchy.totalProjects} dự án
                </Badge>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Thống kê số lượng cơ hội và báo giá được phân bổ trên từng dự án
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {projectHierarchy.projects.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
              <AlertCircle className="size-6 text-muted-foreground/30 stroke-1" />
              <span>Khách hàng chưa có dự án nào. Cơ hội và báo giá hiện thuộc nhóm chung.</span>
            </div>
          ) : (
            <div className="divide-y divide-border/50 text-xs">
              {projectHierarchy.projects.map((p) => {
                const isExpanded = expandedProjectIds.has(p.id);
                return (
                  <div key={p.id} className="transition-colors">
                    {/* Hàng tiêu đề Dự án */}
                    <div
                      onClick={() => toggleExpandProject(p.id)}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 cursor-pointer transition-colors ${
                        isExpanded
                          ? 'bg-muted/40 border-l-4 border-l-indigo-500'
                          : 'hover:bg-muted/30'
                      }`}
                    >
                      {/* Cột 1: Thông tin nhận diện dự án */}
                      <div className="flex items-start gap-3 min-w-[200px]">
                        <div className="size-8 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-indigo-500 shrink-0 mt-0.5">
                          <FolderKanban className="size-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground text-sm hover:text-primary transition-colors">
                              {p.name}
                            </span>
                            {p.projectCode && (
                              <Badge className="font-mono text-[10px] px-1.5 py-0 bg-slate-500 text-white border-transparent">
                                {p.projectCode}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Trạng thái: <span className="text-foreground">{p.status === 'active' ? 'Đang hoạt động' : p.status === 'completed' ? 'Hoàn thành' : 'Khác'}</span>
                          </p>
                        </div>
                      </div>

                      {/* Cột 2 & 3: Thống kê Cơ hội & Báo giá + Dropdown Trigger */}
                      <div className="flex flex-wrap items-center gap-3 sm:gap-6">
                        {/* Số Cơ hội */}
                        <div className="flex items-center gap-2 bg-orange-500 text-white px-3 py-1.5 rounded-lg shadow-2xs">
                          <Target className="size-3.5 text-white shrink-0" />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-white">{p.dealCount}</span>
                              <span className="text-white/90 text-[11px]">Cơ hội</span>
                            </div>
                            {p.dealsBudget > 0 && (
                              <span className="text-[10px] text-white/95 block font-medium">
                                {formatVND(p.dealsBudget)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Số Báo giá */}
                        <div className="flex items-center gap-2 bg-blue-500 text-white px-3 py-1.5 rounded-lg shadow-2xs">
                          <FileText className="size-3.5 text-white shrink-0" />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-white">{p.quoteCount}</span>
                              <span className="text-white/90 text-[11px]">Báo giá</span>
                            </div>
                            {p.quoteAmount > 0 && (
                              <span className="text-[10px] text-white/95 block font-medium">
                                {formatVND(p.quoteAmount)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Dropdown Button (Xổ xuống / Thu gọn) */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => toggleExpandProject(p.id, e)}
                          className={`text-xs h-7 px-2.5 gap-1.5 shrink-0 ml-auto sm:ml-0 transition-all ${
                            isExpanded
                              ? 'bg-indigo-500 text-white border-indigo-500 shadow-xs hover:bg-indigo-600 hover:text-white'
                              : 'bg-white hover:bg-slate-50 text-slate-700 border-border/80'
                          }`}
                        >
                          <span>{isExpanded ? 'Thu gọn' : 'Chi tiết'}</span>
                          <ChevronDown className={`size-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </Button>
                      </div>
                    </div>

                    {/* DROPDOWN XỔ XUỐNG: THÔNG TIN CƠ HỘI, BÁO GIÁ VÀ LIÊN QUAN DỰ ÁN TỪ DB */}
                    {isExpanded && (
                      <div className="bg-slate-100/70 border-t border-border/70 p-4 sm:p-5 space-y-4 animate-in fade-in-50 duration-200">
                        {/* 1. Thông tin liên quan dự án (Lấy từ DB - Nền trắng tinh) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 rounded-xl bg-white border border-gray-200/90 shadow-xs">
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Mã dự án</span>
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {p.projectCode || 'Chưa đặt mã'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Trạng thái</span>
                            <Badge
                              className={`text-[10px] font-semibold text-white border-transparent ${
                                p.status === 'active'
                                  ? 'bg-green-500'
                                  : p.status === 'completed'
                                  ? 'bg-blue-500'
                                  : p.status === 'cancelled'
                                  ? 'bg-red-500'
                                  : 'bg-slate-500'
                              }`}
                            >
                              {p.status === 'active' ? 'Đang hoạt động' : p.status === 'completed' ? 'Hoàn thành' : p.status === 'cancelled' ? 'Đã hủy' : (p.status || 'Khác')}
                            </Badge>
                          </div>
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Tổng ngân sách cơ hội</span>
                            <span className="text-xs font-bold text-orange-600">
                              {formatVND(p.dealsBudget) || '0 đ'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Tổng giá trị báo giá</span>
                            <span className="text-xs font-bold text-blue-600">
                              {formatVND(p.quoteAmount) || '0 đ'}
                            </span>
                          </div>
                          {p.description && (
                            <div className="sm:col-span-2 lg:col-span-4 pt-2 border-t border-border/40">
                              <span className="text-[11px] font-semibold text-slate-500 block mb-0.5">Mô tả dự án:</span>
                              <p className="text-xs text-slate-900 whitespace-pre-line leading-relaxed">
                                {p.description}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* 2. Hai cột: Danh sách Cơ hội & Danh sách Báo giá của dự án */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Cột Cơ hội (Nền trắng) */}
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between pb-1 border-b border-border/50">
                              <div className="flex items-center gap-2">
                                <Target className="size-4 text-orange-500" />
                                <span className="font-semibold text-xs text-slate-900">Cơ hội thuộc dự án</span>
                                <Badge className="text-[10px] font-semibold px-1.5 py-0 bg-orange-500 text-white border-transparent">
                                  {p.deals.length}
                                </Badge>
                              </div>
                              {p.deals.length > 0 && (
                                <span className="text-[11px] text-slate-500">
                                  Tổng: <b className="text-slate-900">{formatVND(p.dealsBudget)}</b>
                                </span>
                              )}
                            </div>

                            {p.deals.length === 0 ? (
                              <div className="py-6 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-gray-200 flex flex-col items-center gap-1.5 shadow-2xs">
                                <Target className="size-5 text-slate-400 stroke-1" />
                                <span>Chưa có cơ hội nào gắn với dự án này.</span>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                                {p.deals.map((deal) => (
                                  <div
                                    key={deal.id}
                                    className="p-3 rounded-xl bg-white border border-gray-200/80 hover:border-orange-500/50 hover:shadow-xs transition-all flex items-center justify-between gap-2.5"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-xs text-slate-900 truncate max-w-[200px]" title={deal.customer_name || deal.id}>
                                          {deal.customer_name || deal.id}
                                        </span>
                                        {getBrightDealStageBadge(deal.deal_stage)}
                                      </div>
                                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                                        <span>Kỳ vọng: <b className="text-orange-600">{formatVND(Number(deal.estimated_budget || deal.lifetime_value || 0))}</b></span>
                                        {deal.leader_name && <span>· Phụ trách: {deal.leader_name}</span>}
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs px-2 text-primary hover:text-primary hover:bg-slate-100 gap-1 shrink-0"
                                      onClick={() => onOpenDeal(deal.id)}
                                    >
                                      <span>Xem</span>
                                      <ArrowRight className="size-3" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Cột Báo giá (Nền trắng) */}
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between pb-1 border-b border-border/50">
                              <div className="flex items-center gap-2">
                                <FileText className="size-4 text-blue-500" />
                                <span className="font-semibold text-xs text-slate-900">Báo giá thuộc dự án</span>
                                <Badge className="text-[10px] font-semibold px-1.5 py-0 bg-blue-500 text-white border-transparent">
                                  {p.quotes.length}
                                </Badge>
                              </div>
                              {p.quotes.length > 0 && (
                                <span className="text-[11px] text-slate-500">
                                  Tổng: <b className="text-slate-900">{formatVND(p.quoteAmount)}</b>
                                </span>
                              )}
                            </div>

                            {p.quotes.length === 0 ? (
                              <div className="py-6 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-gray-200 flex flex-col items-center gap-1.5 shadow-2xs">
                                <FileText className="size-5 text-slate-400 stroke-1" />
                                <span>Chưa có báo giá nào gắn với dự án này.</span>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                                {p.quotes.map((quote) => (
                                  <div
                                    key={quote.id}
                                    className="p-3 rounded-xl bg-white border border-gray-200/80 hover:border-blue-500/50 hover:shadow-xs transition-all flex items-center justify-between gap-2.5"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono font-semibold text-xs text-slate-900">
                                          {quote.quote_number || 'Báo giá'}
                                        </span>
                                        {getQuoteStatusBadge(quote)}
                                      </div>
                                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                                        <span>Giá trị: <b className="text-blue-600">{formatVND(Number(quote.total_amount || 0))}</b></span>
                                        {quote.version_number && <span>· Phiên bản v{quote.version_number}</span>}
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs px-2 text-primary hover:text-primary hover:bg-slate-100 gap-1 shrink-0"
                                      onClick={() => onOpenQuote(quote)}
                                    >
                                      <span>Mở</span>
                                      <ArrowRight className="size-3" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Nhóm Chưa gán dự án */}
              {(projectHierarchy.unassigned.dealCount > 0 || projectHierarchy.unassigned.quoteCount > 0) && (() => {
                const isUnassignedExpanded = expandedProjectIds.has('unassigned');
                return (
                  <div className="transition-colors">
                    <div
                      onClick={() => toggleExpandProject('unassigned')}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 cursor-pointer transition-colors ${
                        isUnassignedExpanded
                          ? 'bg-muted/40 border-l-4 border-l-slate-600'
                          : 'hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-[200px]">
                        <div className="size-8 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-slate-500 shrink-0 mt-0.5">
                          <Layers className="size-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-foreground text-sm">
                            Chưa thuộc dự án
                          </span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Các cơ hội và báo giá độc lập chưa gắn vào dự án cụ thể nào
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 sm:gap-6">
                        <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 rounded-lg border border-border/70">
                          <Target className="size-3.5 text-muted-foreground shrink-0" />
                          <span className="font-bold text-foreground">{projectHierarchy.unassigned.dealCount}</span>
                          <span className="text-muted-foreground text-[11px]">Cơ hội</span>
                        </div>

                        <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 rounded-lg border border-border/70">
                          <FileText className="size-3.5 text-muted-foreground shrink-0" />
                          <span className="font-bold text-foreground">{projectHierarchy.unassigned.quoteCount}</span>
                          <span className="text-muted-foreground text-[11px]">Báo giá</span>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => toggleExpandProject('unassigned', e)}
                          className={`text-xs h-7 px-2.5 gap-1.5 shrink-0 ml-auto sm:ml-0 transition-all ${
                            isUnassignedExpanded
                              ? 'bg-slate-700 text-white border-slate-700 shadow-xs hover:bg-slate-800 hover:text-white'
                              : 'bg-white hover:bg-slate-50 text-slate-700 border-border/80'
                          }`}
                        >
                          <span>{isUnassignedExpanded ? 'Thu gọn' : 'Chi tiết'}</span>
                          <ChevronDown className={`size-3 transition-transform duration-200 ${isUnassignedExpanded ? 'rotate-180' : ''}`} />
                        </Button>
                      </div>
                    </div>

                    {/* DROPDOWN XỔ XUỐNG: CƠ HỘI VÀ BÁO GIÁ CHƯA THUỘC DỰ ÁN (Nền trắng) */}
                    {isUnassignedExpanded && (
                      <div className="bg-slate-100/70 border-t border-border/70 p-4 sm:p-5 space-y-4 animate-in fade-in-50 duration-200">
                        {/* Khung Phân loại & Tổng ngân sách độc lập (Nền trắng tinh) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-white border border-gray-200/90 shadow-xs">
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Phân loại</span>
                            <span className="text-xs font-bold text-slate-900">
                              Chưa gắn vào dự án cụ thể nào
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Tổng ngân sách độc lập</span>
                            <span className="text-xs font-bold text-slate-900">
                              {formatVND(projectHierarchy.unassigned.dealsBudget + projectHierarchy.unassigned.quoteAmount)}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Cột Cơ hội chưa gán (Nền trắng) */}
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between pb-1 border-b border-border/50">
                              <div className="flex items-center gap-2">
                                <Target className="size-4 text-orange-500" />
                                <span className="font-semibold text-xs text-slate-900">Cơ hội độc lập</span>
                                <Badge className="text-[10px] font-semibold px-1.5 py-0 bg-orange-500 text-white border-transparent">
                                  {projectHierarchy.unassigned.deals.length}
                                </Badge>
                              </div>
                              {projectHierarchy.unassigned.deals.length > 0 && (
                                <span className="text-[11px] text-slate-500">
                                  Tổng: <b className="text-slate-900">{formatVND(projectHierarchy.unassigned.dealsBudget)}</b>
                                </span>
                              )}
                            </div>

                            {projectHierarchy.unassigned.deals.length === 0 ? (
                              <div className="py-6 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-gray-200 flex flex-col items-center gap-1.5 shadow-2xs">
                                <Target className="size-5 text-slate-400 stroke-1" />
                                <span>Không có cơ hội độc lập.</span>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                                {projectHierarchy.unassigned.deals.map((deal) => (
                                  <div
                                    key={deal.id}
                                    className="p-3 rounded-xl bg-white border border-gray-200/80 hover:border-orange-500/50 hover:shadow-xs transition-all flex items-center justify-between gap-2.5"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-xs text-slate-900 truncate max-w-[200px]" title={deal.customer_name || deal.id}>
                                          {deal.customer_name || deal.id}
                                        </span>
                                        {getBrightDealStageBadge(deal.deal_stage)}
                                      </div>
                                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                                        <span>Kỳ vọng: <b className="text-orange-600">{formatVND(Number(deal.estimated_budget || deal.lifetime_value || 0))}</b></span>
                                        {deal.leader_name && <span>· Phụ trách: {deal.leader_name}</span>}
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs px-2 text-primary hover:text-primary hover:bg-slate-100 gap-1 shrink-0"
                                      onClick={() => onOpenDeal(deal.id)}
                                    >
                                      <span>Xem</span>
                                      <ArrowRight className="size-3" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Cột Báo giá chưa gán (Nền trắng) */}
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between pb-1 border-b border-border/50">
                              <div className="flex items-center gap-2">
                                <FileText className="size-4 text-blue-500" />
                                <span className="font-semibold text-xs text-slate-900">Báo giá độc lập</span>
                                <Badge className="text-[10px] font-semibold px-1.5 py-0 bg-blue-500 text-white border-transparent">
                                  {projectHierarchy.unassigned.quotes.length}
                                </Badge>
                              </div>
                              {projectHierarchy.unassigned.quotes.length > 0 && (
                                <span className="text-[11px] text-slate-500">
                                  Tổng: <b className="text-slate-900">{formatVND(projectHierarchy.unassigned.quoteAmount)}</b>
                                </span>
                              )}
                            </div>

                            {projectHierarchy.unassigned.quotes.length === 0 ? (
                              <div className="py-6 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-gray-200 flex flex-col items-center gap-1.5 shadow-2xs">
                                <FileText className="size-5 text-slate-400 stroke-1" />
                                <span>Không có báo giá độc lập.</span>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                                {projectHierarchy.unassigned.quotes.map((quote) => (
                                  <div
                                    key={quote.id}
                                    className="p-3 rounded-xl bg-white border border-gray-200/80 hover:border-blue-500/50 hover:shadow-xs transition-all flex items-center justify-between gap-2.5"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono font-semibold text-xs text-slate-900">
                                          {quote.quote_number || 'Báo giá'}
                                        </span>
                                        {getQuoteStatusBadge(quote)}
                                      </div>
                                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                                        <span>Giá trị: <b className="text-blue-600">{formatVND(Number(quote.total_amount || 0))}</b></span>
                                        {quote.version_number && <span>· Phiên bản v{quote.version_number}</span>}
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs px-2 text-primary hover:text-primary hover:bg-slate-100 gap-1 shrink-0"
                                      onClick={() => onOpenQuote(quote)}
                                    >
                                      <span>Mở</span>
                                      <ArrowRight className="size-3" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── KHỐI 2: CÁC BẢNG CƠ HỘI VÀ BÁO GIÁ MỚI NHẤT ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* BẢNG 1: Cơ hội mới nhất */}
        <Card className="bg-card border border-border/80 shadow-xs flex flex-col">
          <CardHeader className="py-3 px-5 border-b border-border/60 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2.5">
              {/* Icon Cơ hội mới nhất: Nền trắng, làm sáng và nổi bật màu Icon lên */}
              <div className="size-7 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-orange-500">
                <TrendingUp className="size-4" />
              </div>
              <CardTitle className="text-sm font-semibold text-foreground">
                Cơ hội mới nhất
              </CardTitle>
              <Badge className="text-[11px] font-medium px-2 py-0 bg-orange-500 text-white border-transparent">
                {activeDeals.length}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 text-muted-foreground hover:text-primary gap-1 px-2"
              onClick={() => onNavigateTab('deals')}
            >
              <span>Xem tất cả</span>
              <ArrowRight className="size-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            {recentDeals.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                <AlertCircle className="size-6 text-muted-foreground/30 stroke-1" />
                <span>Không có cơ hội nào trong phạm vi đang chọn.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs">Tên cơ hội</TableHead>
                      <TableHead className="text-xs">Giai đoạn</TableHead>
                      <TableHead className="text-xs text-right">Kỳ vọng</TableHead>
                      <TableHead className="text-xs text-right">Cập nhật</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentDeals.map(d => (
                      <TableRow
                        key={d.id}
                        onClick={() => {
                          onOpenDeal(d.id);
                        }}
                        className="cursor-pointer hover:bg-muted/50 transition-colors group"
                      >
                        <TableCell className="font-medium text-xs text-foreground max-w-[180px] truncate" title={d.customer_name || d.id}>
                          {d.customer_name || d.id}
                        </TableCell>
                        <TableCell>
                          {/* Render màu giai đoạn với độ sáng cao hơn (High Luminosity) */}
                          {getBrightDealStageBadge(d.deal_stage)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-semibold text-foreground">
                          {formatVND(Number(d.estimated_budget || d.lifetime_value || 0)) || '0 đ'}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground whitespace-nowrap">
                          {formatDateDisplay(d.updated_at || d.created_at)}
                        </TableCell>
                        <TableCell className="text-right p-2">
                          <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BẢNG 2: Báo giá mới nhất */}
        <Card className="bg-card border border-border/80 shadow-xs flex flex-col">
          <CardHeader className="py-3 px-5 border-b border-border/60 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2.5">
              {/* Icon Báo giá mới nhất: Nền trắng, làm sáng và nổi bật màu Icon lên */}
              <div className="size-7 rounded-lg bg-white border border-gray-100 shadow-sm flex items-center justify-center text-blue-500">
                <FileText className="size-4" />
              </div>
              <CardTitle className="text-sm font-semibold text-foreground">
                Báo giá mới nhất
              </CardTitle>
              <Badge className="text-[11px] font-medium px-2 py-0 bg-blue-500 text-white border-transparent">
                {activeQuotes.length}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 text-muted-foreground hover:text-primary gap-1 px-2"
              onClick={() => onNavigateTab('quotes')}
            >
              <span>Xem tất cả</span>
              <ArrowRight className="size-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            {recentQuotes.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                <AlertCircle className="size-6 text-muted-foreground/30 stroke-1" />
                <span>Không có báo giá nào trong phạm vi đang chọn.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs">Mã báo giá</TableHead>
                      <TableHead className="text-xs">Trạng thái</TableHead>
                      <TableHead className="text-xs text-right">Giá trị</TableHead>
                      <TableHead className="text-xs text-right">Cập nhật</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentQuotes.map(q => (
                      <TableRow
                        key={q.id}
                        onClick={() => {
                          onOpenQuote(q);
                        }}
                        className="cursor-pointer hover:bg-muted/50 transition-colors group"
                      >
                        <TableCell className="font-medium font-mono text-xs text-foreground max-w-[140px] truncate" title={q.quote_number || q.id}>
                          {q.quote_number || q.id}
                        </TableCell>
                        <TableCell>
                          {getQuoteStatusBadge(q)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-semibold text-foreground">
                          {formatVND(Number(q.total_amount || 0)) || '0 đ'}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground whitespace-nowrap">
                          {formatDateDisplay(q.updated_at || q.sent_at)}
                        </TableCell>
                        <TableCell className="text-right p-2">
                          <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
