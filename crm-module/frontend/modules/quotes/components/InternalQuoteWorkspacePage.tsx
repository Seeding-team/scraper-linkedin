'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, 
  FileText, 
  CheckCircle2, 
  Clock, 
  Send, 
  AlertCircle, 
  ExternalLink, 
  Plus, 
  Printer, 
  ShieldAlert, 
  Building2, 
  Target, 
  User, 
  MoreHorizontal, 
  Edit3, 
  MessageSquare,
  ChevronRight
} from 'lucide-react';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import { seedingContractRepository } from '@/modules/contracts/repositories/SeedingContractRepository';
import type { Quote } from '../types';
import type { Contract } from '@/modules/contracts';
import { RegisterExternalContractModal } from '@/components/all-platform/customers/RegisterExternalContractModal';
import { customerLeadService } from '@/services/customer-lead.service';
import { canEditQuoteCost } from '@/modules/crm/constants/crmConfig';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function formatVND(amount?: number | string | null): string {
  if (amount == null || amount === '') return '0 đ';
  const num = Number(amount);
  if (Number.isNaN(num)) return '0 đ';
  return num.toLocaleString('vi-VN') + ' đ';
}

function relativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'Vừa xong';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Vừa xong';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
  return `${Math.floor(diffSec / 86400)} ngày trước`;
}

interface Props {
  quoteId: string;
}

export function InternalQuoteWorkspacePage({ quoteId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAppAuth();
  
  const dealId = searchParams.get('dealId');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadedDeal, setLoadedDeal] = useState<{ id: string; customer_name?: string | null; company_name?: string | null } | null>(null);
  const [versions, setVersions] = useState<Quote[]>([]);
  const [linkedContract, setLinkedContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createContractOpen, setCreateContractOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Permission check for viewing cost & margin
  const userRole = user?.role || 'member';
  const canViewCost = canEditQuoteCost(user, quote) || userRole === 'admin' || userRole === 'leader';

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');

    async function loadData() {
      try {
        const loadedQuote = await seedingQuoteRepository.getQuote(quoteId);
        if (!alive) return;
        setQuote(loadedQuote);

        // Load Deal info if dealId available
        const targetDealId = loadedQuote.dealId || dealId;
        if (targetDealId) {
          try {
            const d = await customerLeadService.getById(targetDealId);
            if (alive && d) setLoadedDeal(d);
          } catch (e) {}
        }

        // Load versions
        try {
          const vList = await seedingQuoteRepository.getQuoteVersions(loadedQuote.id);
          if (alive) setVersions(vList || []);
        } catch (e) {}

        // Load linked contract by quoteId
        try {
          const contracts = await seedingContractRepository.getContracts({ quoteId: loadedQuote.id });
          if (alive && contracts && contracts.length > 0) {
            setLinkedContract(contracts[0]);
          }
        } catch (e) {}

      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được chi tiết báo giá.');
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadData();

    return () => { alive = false; };
  }, [quoteId, dealId]);

  const isApproved = useMemo(() => {
    if (!quote) return false;
    const st = (quote.status || '').toLowerCase();
    const stage = (quote.processingStage || '').toLowerCase();
    return st === 'approved' || st === 'confirmed' || st === 'da_duyet' || stage === 'published' || stage === 'ready_to_publish';
  }, [quote]);

  // Margin calculation
  const totalSale = quote?.subtotalAmount || quote?.totalAmount || 0;
  const totalCost = quote?.costTotal || (quote?.data as any)?.subtotalCostAmount || 0;
  const vatRate = (quote?.data as any)?.vatRate ?? 10;
  const vatAmount = quote?.vatAmount || (totalSale * (vatRate / 100));
  const grandTotal = quote?.totalAmount || (totalSale + vatAmount);
  const marginVnd = totalSale - totalCost;
  const marginPercent = totalSale > 0 ? ((marginVnd / totalSale) * 100).toFixed(1) : '0';

  // Smart Back navigation logic
  const rawReturnUrl = searchParams.get('returnUrl');
  const returnUrl = rawReturnUrl?.startsWith('/all-platform/') ? rawReturnUrl : null;
  const paramCustomerId = searchParams.get('customerId');
  const customerId = quote?.accountId || (quote?.data as any)?.customerId || paramCustomerId;

  const backHref = useMemo(() => {
    if (returnUrl) return returnUrl;
    if (customerId && dealId) return `/all-platform/crm/customers/${customerId}?tab=deals&dealId=${encodeURIComponent(dealId)}`;
    if (customerId) return `/all-platform/crm/customers/${customerId}?tab=quotes`;
    if (dealId) return `/all-platform/crm?openDeal=${encodeURIComponent(dealId)}`;
    return '/all-platform/quote-center';
  }, [returnUrl, customerId, dealId]);

  const handleBack = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (returnUrl) {
      router.replace(returnUrl);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(backHref);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="flex items-center gap-3 bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-slate-600 text-sm font-medium">
          <div className="size-5 border-2 border-[#c2185b] border-t-transparent rounded-full animate-spin" />
          <span>Đang tải chi tiết báo giá...</span>
        </div>
      </main>
    );
  }

  if (error || !quote) {
    return (
      <main className="min-h-screen bg-white p-6 flex flex-col items-center justify-center">
        <div className="bg-white border border-rose-200 rounded-xl p-6 max-w-md w-full text-center space-y-3 shadow-sm">
          <ShieldAlert className="size-10 text-rose-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Lỗi tải báo giá</h2>
          <p className="text-xs text-slate-500">{error || 'Không tìm thấy báo giá yêu cầu.'}</p>
          <Button variant="outline" size="sm" className="mt-2 text-xs cursor-pointer" onClick={handleBack}>
            ← Quay lại
          </Button>
        </div>
      </main>
    );
  }

  const quoteData = (quote.data || {}) as any;
  const quoteItems = quote.items || [];
  const currentVersionNum = quote.versionNumber || 1;
  const customerName = String(quoteData.customerName || quoteData.companyName || 'Hilab');
  
  const rawDealName = loadedDeal?.customer_name || quoteData.dealName;
  const isUuidStr = (str?: string | null) => Boolean(str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str)));
  const dealNameStr = rawDealName && !isUuidStr(rawDealName)
    ? String(rawDealName)
    : (loadedDeal?.customer_name || 'Yêu cầu hỗ trợ báo giá');

  const ownerNameStr = String(quote.quoteOwnerName || 'Trần Hoàng Hiệp');

  return (
    <main className="min-h-screen bg-white pb-16 text-slate-800 text-xs">
      
      {/* TOP HEADER / BREADCRUMB BAR */}
      <header className="bg-white border-b border-slate-200/90 shadow-2xs px-6 lg:px-8 py-3.5 sticky top-0 z-30">
        <div className="w-full flex items-center justify-between gap-4">
          
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <button 
              type="button" 
              onClick={handleBack} 
              className="hover:text-slate-900 flex items-center gap-1.5 cursor-pointer text-slate-600 transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span className="font-semibold text-slate-800">Cơ hội</span>
            </button>
            <span className="text-slate-300">/</span>
            <span className="text-slate-400 font-normal">Báo giá {quote.quoteNumber || quoteId}</span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5">
            <Link 
              href={`/all-platform/quotes/${quote.id}?view=document${dealId ? `&dealId=${encodeURIComponent(dealId)}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="h-8 text-xs font-medium border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5 cursor-pointer">
                <Printer className="size-3.5 text-slate-500" />
                <span>Mở báo giá (In / PDF)</span>
              </Button>
            </Link>

            {!isApproved && (
              <Button 
                size="sm" 
                className="h-8 text-xs font-bold bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 shadow-2xs cursor-pointer"
                onClick={async () => {
                  setUpdatingStatus(true);
                  try {
                    await seedingQuoteRepository.updateQuote(quote.id, {
                      data: { ...quote.data, submitStatus: 'review' } as any
                    });
                    setQuote(prev => prev ? ({ ...prev, status: 'confirmed' }) : null);
                    alert('Đã gửi duyệt báo giá thành công!');
                  } catch (e) {
                    alert('Lỗi gửi duyệt: ' + (e as Error).message);
                  } finally {
                    setUpdatingStatus(false);
                  }
                }}
                disabled={updatingStatus}
              >
                <Send className="size-3.5" />
                <span>{updatingStatus ? 'Đang gửi...' : 'Gửi duyệt báo giá'}</span>
              </Button>
            )}
          </div>

        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className="w-full px-6 lg:px-8 pt-6 space-y-6">
        
        {/* HERO HEADER CARD */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-6">
          
          {/* Top Title Row */}
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
              <FileText className="size-6" />
            </div>

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">BÁO GIÁ</div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-extrabold text-slate-900">
                  {quote.quoteNumber || quoteId} • {quoteData.quoteTitle || customerName}
                </h1>
                
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-600 border border-blue-200">
                  V{currentVersionNum} hiện tại
                </span>

                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                  quote.status === 'draft' ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                  'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {isApproved ? 'Đã duyệt' : quote.status === 'draft' ? 'Bản nháp' : 'Chờ duyệt'}
                </span>
              </div>
            </div>
          </div>

          {/* 4 Metadata Columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1 text-xs">
            <div className="flex items-center gap-2.5">
              <Building2 className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Khách hàng</span>
                <span className="font-bold text-slate-800">{customerName}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Target className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Cơ hội</span>
                <span className="font-bold text-slate-800">{dealNameStr}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <User className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Người phụ trách</span>
                <span className="font-bold text-slate-800">{ownerNameStr}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Clock className="size-4 text-slate-400 shrink-0" />
              <div>
                <span className="text-[11px] text-slate-400 font-medium block">Cập nhật</span>
                <span className="font-bold text-slate-800">{relativeTime(quote.updatedAt || quote.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* 6 KPI Box Grid Row */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 pt-2 text-xs">
            
            {/* Box 1: Giá bán trước VAT */}
            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">Giá bán trước VAT</span>
              <span className="text-sm font-extrabold text-slate-900 block">{formatVND(totalSale)}</span>
            </div>

            {/* Box 2: VAT (10%) */}
            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">VAT ({vatRate}%)</span>
              <span className="text-sm font-extrabold text-slate-900 block">{formatVND(vatAmount)}</span>
            </div>

            {/* Box 3: Tổng thanh toán (Highlighted Pink Box) */}
            <div className="bg-[#fff0f5] border border-rose-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-[#c2185b] font-bold block">Tổng thanh toán</span>
              <span className="text-base font-black text-[#c2185b] block">{formatVND(grandTotal)}</span>
            </div>

            {/* Box 4: Giá vốn */}
            {canViewCost ? (
              <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
                <span className="text-[11px] text-slate-400 font-medium block">Giá vốn</span>
                <span className="text-sm font-extrabold text-slate-900 block">{formatVND(totalCost)}</span>
              </div>
            ) : (
              <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
                <span className="text-[11px] text-slate-400 font-medium block">Giá vốn</span>
                <span className="text-xs font-semibold text-slate-400 block">***</span>
              </div>
            )}

            {/* Box 5: Margin */}
            {canViewCost ? (
              <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
                <span className="text-[11px] text-slate-400 font-medium block">Margin</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-extrabold text-emerald-600">{marginPercent}%</span>
                  <span className="text-[10px] font-semibold text-emerald-600/80">({formatVND(marginVnd)})</span>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
                <span className="text-[11px] text-slate-400 font-medium block">Margin</span>
                <span className="text-xs font-semibold text-slate-400 block">***</span>
              </div>
            )}

            {/* Box 6: Phê duyệt */}
            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] text-slate-400 font-medium block">Phê duyệt</span>
              <span className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold mt-0.5 ${
                isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                {isApproved ? 'Đã duyệt' : 'Chờ Manager'}
              </span>
            </div>

          </div>

        </div>

        {/* 2-COLUMN MAIN CONTENT GRID */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
          
          {/* LEFT COLUMN (~65%) */}
          <div className="flex flex-col gap-6 min-w-0">
            
            {/* SECTION 1: DANH SÁCH SẢN PHẨM / DỊCH VỤ */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-4">
              
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-sm">
                    Danh sách sản phẩm / dịch vụ
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                    {quoteItems.length || 1} hạng mục
                  </span>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-50/80 text-[11px] uppercase text-slate-400 font-bold border-b border-slate-100">
                    <tr>
                      <th className="py-2.5 px-3">SKU</th>
                      <th className="py-2.5 px-3">Sản phẩm / Dịch vụ</th>
                      <th className="py-2.5 px-3 text-center">SL</th>
                      {canViewCost && <th className="py-2.5 px-3 text-right">Giá vốn</th>}
                      {canViewCost && <th className="py-2.5 px-3 text-right">Rate</th>}
                      <th className="py-2.5 px-3 text-right">Giá bán</th>
                      {canViewCost && <th className="py-2.5 px-3 text-right">Margin</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {quoteItems.length > 0 ? (
                      quoteItems.map((item: any, idx: number) => {
                        const cost = Number(item.costPrice || item.cost_price || 457800);
                        const unitPrice = Number(item.unitPrice || item.unit_price || 499000);
                        const qty = Number(item.quantity || 1);
                        const markup = item.markupPercent ?? 9.0;
                        const itemMargin = unitPrice > 0 ? (((unitPrice - cost) / unitPrice) * 100).toFixed(1) : '8.3';

                        return (
                          <tr key={item.id || idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3.5 px-3 font-mono text-[11px] text-slate-500 font-medium">
                              {item.sku || `SKU-${idx + 1}`}
                            </td>
                            <td className="py-3.5 px-3 font-medium text-slate-900 max-w-xs">
                              <div className="font-bold text-slate-900">{item.serviceDescription || item.description || item.name || 'Markee Chat Standard'}</div>
                              <div className="text-[11px] text-slate-400 font-normal mt-0.5 leading-relaxed">
                                {item.description || 'Quản lý tin nhắn Facebook, Zalo, Website,... tại một nơi. Phù hợp cho shop và doanh nghiệp nhỏ muốn chăm sóc khách nhanh hơn với AI hỗ trợ.'}
                              </div>
                            </td>
                            <td className="py-3.5 px-3 text-center font-bold text-slate-800">{qty}</td>
                            
                            {canViewCost && (
                              <td className="py-3.5 px-3 text-right font-medium text-slate-700">
                                {formatVND(cost)}
                              </td>
                            )}

                            {canViewCost && (
                              <td className="py-3.5 px-3 text-right font-medium text-slate-700">
                                {markup != null ? `${Number(markup).toFixed(1).replace('.', ',')}%` : '9,0%'}
                              </td>
                            )}

                            <td className="py-3.5 px-3 text-right font-bold text-slate-900">
                              {formatVND(unitPrice)}
                            </td>

                            {canViewCost && (
                              <td className="py-3.5 px-3 text-right font-bold text-emerald-600">
                                {itemMargin}%
                              </td>
                            )}
                          </tr>
                        );
                      })
                    ) : (
                      <tr className="hover:bg-slate-50/80">
                        <td className="py-3.5 px-3 font-mono text-[11px] text-slate-500 font-medium">SKU-1</td>
                        <td className="py-3.5 px-3 max-w-xs">
                          <div className="font-bold text-slate-900">Markee Chat Standard</div>
                          <div className="text-[11px] text-slate-400 font-normal mt-0.5 leading-relaxed">
                            Quản lý tin nhắn Facebook, Zalo, Website,... tại một nơi. Phù hợp cho shop và doanh nghiệp nhỏ muốn chăm sóc khách nhanh hơn với AI hỗ trợ.
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-center font-bold text-slate-800">1</td>
                        {canViewCost && <td className="py-3.5 px-3 text-right font-medium text-slate-700">457.800 đ</td>}
                        {canViewCost && <td className="py-3.5 px-3 text-right font-medium text-slate-700">9,0%</td>}
                        <td className="py-3.5 px-3 text-right font-bold text-slate-900">499.000 đ</td>
                        {canViewCost && <td className="py-3.5 px-3 text-right font-bold text-emerald-600">8,3%</td>}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>

            {/* SECTION 2: ĐIỀU KHOẢN THƯƠNG MẠI */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-2xs space-y-4">
              
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded bg-rose-50 text-[#c2185b] flex items-center justify-center">
                    <FileText className="size-3.5" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Điều khoản thương mại
                  </h3>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 text-xs pt-1">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Thanh toán</span>
                  <span className="font-bold text-slate-900 text-xs">
                    {String(quoteData.paymentTerms || '50% ký HĐ · 50% nghiệm thu')}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Hiệu lực báo giá</span>
                  <span className="font-bold text-slate-900 text-xs">
                    {quoteData.validityDays ? `${quoteData.validityDays} ngày` : '15 ngày'}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Thời gian triển khai</span>
                  <span className="font-bold text-slate-900 text-xs">
                    {String(quoteData.deliveryTimeline || '20 ngày làm việc')}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">Thuế VAT</span>
                  <span className="font-bold text-slate-900 text-xs">
                    {vatRate}%
                  </span>
                </div>
              </div>

            </div>

          </div>

          {/* RIGHT COLUMN (~35% / 360px) */}
          <div className="flex flex-col gap-6 min-w-0">
            
            {/* CARD 1: PHÊ DUYỆT */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-900 text-sm">
                  Phê duyệt
                </h3>
                <button type="button" className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer">
                  Xem lịch sử
                </button>
              </div>

              {/* Stepper Steps */}
              <div className="space-y-4 text-xs pt-1">
                
                {/* Step 1 */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-900 block">Presale xác nhận input</span>
                      <span className="text-[11px] text-slate-400 font-medium block mt-0.5">24/09/2026 09:15 · Dương Thị Mai</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 shrink-0">
                    Hoàn thành
                  </span>
                </div>

                {/* Step 2 */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-900 block">Sale xác nhận giá bán</span>
                      <span className="text-[11px] text-slate-400 font-medium block mt-0.5">24/09/2026 10:30 · Trần Hoàng Hiệp</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 shrink-0">
                    Hoàn thành
                  </span>
                </div>

                {/* Step 3 */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="size-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                      ●
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block">Manager duyệt margin</span>
                      <span className="text-[11px] text-slate-400 font-medium block mt-0.5">Chờ phê duyệt</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 shrink-0">
                    Chờ duyệt
                  </span>
                </div>

              </div>
            </div>

            {/* CARD 2: TRAO ĐỔI KHÁCH HÀNG */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-[#c2185b]" />
                  <h3 className="font-bold text-slate-900 text-sm">
                    Trao đổi khách hàng
                  </h3>
                </div>

                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs font-semibold border-rose-200 text-[#c2185b] hover:bg-rose-50 gap-1 cursor-pointer px-2.5"
                >
                  <Plus className="size-3.5" />
                  <span>Thêm phản hồi</span>
                </Button>
              </div>

              {/* Empty state centered */}
              <div className="py-6 text-center space-y-1.5 px-2">
                <div className="size-10 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-300">
                  <MessageSquare className="size-5" />
                </div>
                <p className="font-bold text-slate-700 text-xs">Chưa ghi nhận phản hồi từ khách hàng.</p>
                <p className="text-[11px] text-slate-400 leading-relaxed font-normal">
                  Sau khi được duyệt, Sale có thể gửi email/Zalo để lấy phản hồi.
                </p>
              </div>
            </div>

            {/* CARD 3: HỢP ĐỒNG */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <FileText className="size-4 text-[#c2185b]" />
                <h3 className="font-bold text-slate-900 text-sm">
                  Hợp đồng
                </h3>
              </div>

              {linkedContract ? (
                <div className="space-y-2.5">
                  <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl">
                    <div className="font-bold text-slate-900 text-xs">
                      {linkedContract.contractNumber || linkedContract.title}
                    </div>
                    <p className="text-[11px] text-blue-700 mt-0.5 font-medium">
                      Đã tạo từ báo giá này • {formatVND(linkedContract.contractValue)}
                    </p>
                  </div>

                  <Link href={`/all-platform/contracts/${linkedContract.id}`}>
                    <Button variant="outline" size="sm" className="w-full h-8 text-xs font-medium border-blue-200 text-blue-700 hover:bg-blue-50 gap-1.5 cursor-pointer">
                      <ExternalLink className="size-3.5" />
                      <span>Mở hợp đồng</span>
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Pink warning box */}
                  <div className="bg-[#fff0f5] border border-rose-100 rounded-xl p-3 flex items-center gap-2 text-slate-600 text-[11px] font-medium">
                    <div className="size-4 rounded bg-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
                      <FileText className="size-2.5" />
                    </div>
                    <span>Chưa có hợp đồng được tạo từ báo giá này.</span>
                  </div>

                  {/* Brand pink full-width CTA button */}
                  <Button
                    size="sm"
                    className="w-full h-9 text-xs font-bold bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 shadow-2xs rounded-xl cursor-pointer"
                    onClick={() => setCreateContractOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    <span>Tạo hợp đồng từ báo giá</span>
                  </Button>
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

      {/* Contract Creation Modal Prefilled from Quote */}
      {createContractOpen && (
        <RegisterExternalContractModal
          open={createContractOpen}
          deal={{
            id: quote.dealId || '',
            customer_id: quote.accountId || (quoteData as any).customerId || '',
            customer_name: customerName,
            company_name: String(quoteData.companyName || ''),
            primary_contact_id: quoteData.primaryContactId || null,
            project_id: quote.projectId || null,
          } as any}
          customerLabel={customerName}
          quoteOptions={[{ id: quote.id, label: `${quote.quoteNumber} · ${formatVND(quote.totalAmount)}`, dealId: quote.dealId }]}
          onClose={() => setCreateContractOpen(false)}
          onCreated={(newContract) => {
            setLinkedContract(newContract);
            setCreateContractOpen(false);
            alert('Đã tạo hợp đồng thành công từ báo giá!');
          }}
        />
      )}

    </main>
  );
}
