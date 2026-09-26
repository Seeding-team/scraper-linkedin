'use client';

import React, { useMemo, useState } from 'react';
import {
  TrendingUp,
  FileText,
  ChevronRight,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  Layers,
  CircleDot,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  AlertCircle,
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

interface CustomerProjectCrmOverviewProps {
  deals: OverviewDealItem[];
  quotes: OverviewQuoteItem[];
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

const PIPELINE_STAGES: Array<{
  key: PipelineStageKey;
  label: string;
  bgColor: string;
  textColor: string;
  countColor: string;
}> = [
  { key: 'potential', label: 'Tiềm năng', bgColor: 'bg-slate-100 dark:bg-slate-800', textColor: 'text-slate-600 dark:text-slate-300', countColor: 'text-slate-600 dark:text-slate-400' },
  { key: 'evaluating', label: 'Đánh giá', bgColor: 'bg-blue-100/90 dark:bg-blue-950/60', textColor: 'text-blue-700 dark:text-blue-300', countColor: 'text-blue-600 dark:text-blue-400 font-bold' },
  { key: 'quote', label: 'Báo giá', bgColor: 'bg-purple-100/80 dark:bg-purple-950/60', textColor: 'text-purple-700 dark:text-purple-300', countColor: 'text-purple-600 dark:text-purple-400' },
  { key: 'negotiation', label: 'Đàm phán', bgColor: 'bg-amber-100/90 dark:bg-amber-950/60', textColor: 'text-amber-800 dark:text-amber-300', countColor: 'text-amber-600 dark:text-amber-400 font-bold' },
  { key: 'won', label: 'Thắng', bgColor: 'bg-emerald-100/90 dark:bg-emerald-950/60', textColor: 'text-emerald-800 dark:text-emerald-300', countColor: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'lost', label: 'Thua', bgColor: 'bg-rose-100/90 dark:bg-rose-950/60', textColor: 'text-rose-800 dark:text-rose-300', countColor: 'text-rose-600 dark:text-rose-400' },
];

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
    return <Badge variant="outline" className="text-[11px] bg-destructive/10 text-destructive border-destructive/20 font-medium">Đã huỷ</Badge>;
  }
  if (q.sent_at || q.status === 'sent') {
    return <Badge variant="outline" className="text-[11px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 font-medium">Đã gửi</Badge>;
  }
  if (q.status === 'accepted' || q.status === 'confirmed') {
    return <Badge variant="outline" className="text-[11px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 font-medium">Đã chấp nhận</Badge>;
  }
  if (q.status === 'approved' || q.approved_at || q.published_at || q.processing_stage === 'published') {
    return <Badge variant="outline" className="text-[11px] bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 font-medium">Sẵn sàng gửi</Badge>;
  }
  if (q.processing_stage === 'review') {
    return <Badge variant="outline" className="text-[11px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 font-medium">Admin review</Badge>;
  }
  if (q.processing_stage === 'pricing') {
    return <Badge variant="outline" className="text-[11px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 font-medium">Sale markup</Badge>;
  }
  return <Badge variant="outline" className="text-[11px] bg-muted text-muted-foreground border-border font-medium">Đang soạn</Badge>;
}

function getDealStageBadge(stage?: string | null) {
  const key = getPipelineStageKey(stage);
  const match = PIPELINE_STAGES.find(p => p.key === key) || PIPELINE_STAGES[0];
  return (
    <Badge variant="outline" className={`text-[11px] ${match.bgColor} ${match.textColor} border-transparent font-medium`}>
      {match.label}
    </Badge>
  );
}

export function CustomerProjectCrmOverview({
  deals,
  quotes,
  onNavigateTab,
  onOpenDeal,
  onOpenQuote,
}: CustomerProjectCrmOverviewProps) {
  const [filterMode, setFilterMode] = useState<'status' | 'all'>('status');

  // 1. Phân loại Pipeline Cơ hội
  const pipelineCounts = useMemo(() => {
    const counts: Record<PipelineStageKey, number> = {
      potential: 0,
      evaluating: 0,
      quote: 0,
      negotiation: 0,
      won: 0,
      lost: 0,
    };
    for (const d of deals) {
      const key = getPipelineStageKey(d.deal_stage);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [deals]);

  // 2. Thống kê Giá trị Báo giá (Donut Chart)
  const quoteMetrics = useMemo(() => {
    let sentCount = 0;
    let sentAmount = 0;
    let draftCount = 0;
    let draftAmount = 0;
    let acceptedCount = 0;
    let acceptedAmount = 0;
    let rejectedCount = 0;
    let rejectedAmount = 0;

    for (const q of quotes) {
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
  }, [quotes]);

  // 3. Tính toán đường tròn Donut SVG
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

  // 4. Danh sách Cơ hội & Báo giá mới nhất (tối đa 5 dòng)
  const recentDeals = useMemo(() => {
    return [...deals]
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
      .slice(0, 5);
  }, [deals]);

  const recentQuotes = useMemo(() => {
    return [...quotes]
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
      .slice(0, 5);
  }, [quotes]);

  return (
    <div className="space-y-5">
      {/* ── KHỐI 1: PIPELINE CƠ HỘI & GIÁ TRỊ BÁO GIÁ ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CARD TRÁI: Pipeline Cơ hội */}
        <Card className="bg-card border border-border/80 shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-base font-bold text-foreground tracking-tight flex items-center justify-between">
              <span>Pipeline cơ hội</span>
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
                const isLast = idx === PIPELINE_STAGES.length - 1;
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
                    {/* Thanh chevron mũi tên */}
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

        {/* CARD PHẢI: Giá trị Báo giá */}
        <Card className="bg-card border border-border/80 shadow-xs">
          <CardHeader className="pb-2 pt-5 px-5 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold text-foreground tracking-tight">
              Giá trị báo giá
            </CardTitle>
            <div className="relative">
              <select
                value={filterMode}
                onChange={e => setFilterMode(e.target.value as any)}
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

      {/* ── KHỐI 2: CÁC BẢNG CƠ HỘI VÀ BÁO GIÁ MỚI NHẤT ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* BẢNG 1: Cơ hội mới nhất */}
        <Card className="bg-card border border-border/80 shadow-xs flex flex-col">
          <CardHeader className="py-3 px-5 border-b border-border/60 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold text-foreground">
                Cơ hội mới nhất
              </CardTitle>
              <Badge variant="secondary" className="text-[11px] font-normal px-2 py-0">
                {deals.length}
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
                <span>Khách hàng chưa có cơ hội nào.</span>
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
                          {getDealStageBadge(d.deal_stage)}
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
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold text-foreground">
                Báo giá mới nhất
              </CardTitle>
              <Badge variant="secondary" className="text-[11px] font-normal px-2 py-0">
                {quotes.length}
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
                <span>Khách hàng chưa có báo giá nào.</span>
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
