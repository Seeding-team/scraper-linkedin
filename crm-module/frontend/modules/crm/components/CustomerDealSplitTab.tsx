import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Target, X, Search, Filter, Plus, ChevronRight, Briefcase, UserCheck, Calendar, Clock, AlertCircle, Phone, Mail, FileText, Activity, MoreHorizontal, LayoutGrid, CheckCircle2, Sparkles, MessageCircle, Trash2 } from 'lucide-react';
import { customerLeadService, type ActivityLogEntry, type Customer as LiveDealRow, type StageTransitionPayload } from '@/services/customer-lead.service';
import { formatVND, getStageMeta, PIPELINE_COLUMNS, DEAL_STAGE_META } from '../constants/crmConfig';
import { relativeTime } from '../utils/quoteDisplay';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import { usersService, type QuoteBusinessRoleUser } from '@/services/all-platform.service';
import { customerToCrmDeal } from '@/components/all-platform/customers/dealToCrmDeal';
import { StageModal } from './StageModal';
import type { DealStage } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CatalogPickerModal, type CatalogPickerListItem } from '@/modules/service-catalog/CatalogPickerModal';
import { serviceCatalogRepository } from '@/modules/service-catalog/repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem } from '@/modules/service-catalog/types';

export function getStageSolidBgClass(stage?: string | null): string {
  if (!stage) return 'bg-slate-500';
  const s = stage.toLowerCase();
  if (s === 'new_lead' || s === 'lead' || s === 'potential' || s === 'tiem_nang') return 'bg-slate-500';
  if (s === 'evaluating' || s === 'qualified' || s === 'dealing' || s === 'contacted' || s === 'danh_gia') return 'bg-blue-500';
  if (s === 'proposal_sent' || s === 'requirement' || s === 'quote' || s === 'bao_gia') return 'bg-purple-500';
  if (s === 'negotiating' || s === 'dam_phan') return 'bg-amber-500';
  if (s === 'won' || s === 'thanh_cong') return 'bg-emerald-500';
  if (s === 'lost' || s === 'that_bai') return 'bg-rose-500';
  return 'bg-slate-500';
}

function formatCrmDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatCrmDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

type DealAiContext = {
  deal: any;
  quoteCount: number;
  activityCount: number;
  productCount: number;
  hasPrimaryContact: boolean;
  hasPresale: boolean;
  hasBom: boolean;
};

function getDealScopedAiSuggestions(ctx: DealAiContext | null): string[] {
  if (!ctx?.deal) return [];
  const { deal, quoteCount, activityCount, productCount, hasPrimaryContact, hasPresale, hasBom } = ctx;
  const suggestions: string[] = [];
  const stage = String(deal.deal_stage || '').toLowerCase();
  const score = Number(deal.lead_score || 0);
  const hasScore = score > 0;
  const isHighInterest = deal.interest_level === '🔥 Cao' || deal.interest_level === 'Cao' || deal.priority === 'High' || (hasScore && score >= 75);
  const hasFollowUp = Boolean(deal.follow_up_date);
  const hasValue = Boolean(Number(deal.estimated_budget || deal.lifetime_value || 0) > 0);
  const note = String(deal.note || deal.care_note || deal.handover_note || '').trim().toLowerCase();

  if (hasScore && isHighInterest) {
    suggestions.push(`Lead score ${score} (Quan tâm cao) → Ưu tiên follow-up hôm nay.`);
  } else if (hasScore && score < 50) {
    suggestions.push(`Lead score ${score} (Thấp) → Trao đổi thêm để làm rõ nhu cầu.`);
  }

  if (note.includes('demo')) {
    suggestions.push('Khách hàng có nhu cầu Demo → Tạo lịch demo giải pháp.');
  } else if (note.includes('báo giá') || note.includes('bao gia') || note.includes('chi phí')) {
    suggestions.push('Khách quan tâm báo giá & chi phí → Chuẩn bị phương án báo giá phù hợp.');
  }

  if (!hasPrimaryContact) {
    suggestions.push('Thiếu liên hệ chính của cơ hội này → gắn đúng contact trước khi báo giá.');
  }
  if (productCount === 0) {
    suggestions.push('Chưa xác định sản phẩm / giải pháp cho cơ hội này.');
  }
  if (!hasValue) {
    suggestions.push('Chưa nhập giá trị dự kiến của riêng cơ hội này.');
  }
  if (!hasPresale) {
    suggestions.push('Chưa phân công Presale cho cơ hội này.');
  } else if (!hasBom) {
    suggestions.push('Presale đã có, cần hoàn thiện BOM / xác nhận phạm vi cho cơ hội này.');
  }

  if (!hasFollowUp) {
    suggestions.push('Chưa đặt lịch Follow-up tiếp theo.');
  }
  if (hasPrimaryContact && hasValue && productCount > 0 && hasBom && quoteCount === 0) {
    suggestions.push('Input chính đã đủ → có thể chuẩn bị tạo báo giá cho cơ hội này.');
  }
  if (quoteCount > 0) {
    suggestions.push(`Đã có ${quoteCount} báo giá thuộc cơ hội này → theo dõi phản hồi và cập nhật stage.`);
  }
  if (activityCount === 0) {
    suggestions.push('Chưa có lịch sử hoạt động riêng cho cơ hội này → cập nhật tương tác gần nhất.');
  }
  if (stage === 'won') {
    suggestions.push('Cơ hội đã thắng → kiểm tra bàn giao sau bán và hợp đồng liên quan.');
  }

  return suggestions.length > 0 ? suggestions.slice(0, 4) : ['Dữ liệu cơ hội này đã đủ các input chính; tiếp tục bám sát next action theo stage hiện tại.'];
}

function getDealScopedAiActions(ctx: DealAiContext | null): { text: string; done: boolean }[] {
  if (!ctx?.deal) return [];
  const { deal, quoteCount, productCount, hasPrimaryContact, hasPresale, hasBom } = ctx;
  const score = Number(deal.lead_score || 0);
  const hasScore = score > 0;
  const hasFollowUp = Boolean(deal.follow_up_date);
  const hasValue = Boolean(Number(deal.estimated_budget || deal.lifetime_value || 0) > 0);

  const actions = [];

  actions.push({
    text: `1. Call Follow-up & cập nhật trạng thái${hasScore ? ` (Lead score ${score})` : ''}`,
    done: hasFollowUp,
  });

  actions.push({ text: '2. Gắn liên hệ chính cho cơ hội', done: hasPrimaryContact });
  actions.push({ text: productCount > 0 ? '3. Kiểm tra sản phẩm / giải pháp đã chọn' : '3. Chọn sản phẩm / giải pháp', done: productCount > 0 });
  actions.push({ text: '4. Xác nhận giá trị dự kiến', done: hasValue });
  actions.push({ text: hasPresale ? '5. Hoàn thiện BOM / xác nhận phạm vi với Presale' : '5. Phân công Presale phụ trách', done: hasPresale && hasBom });
  actions.push({ text: quoteCount > 0 ? '6. Theo dõi báo giá đã tạo' : '6. Chuẩn bị tạo báo giá khi đủ input', done: quoteCount > 0 });

  return actions;
}

export function CustomerDealSplitTab({ 
  deals, 
  customerId,
  customerName = '',
  allContacts,
  members,
  projectsSummary,
  quotes = [],
  activityItems = [],
  onCreateDeal,
  onCreateQuote,
  onOpenQuote,
  onEditDeal,
  onChanged,
}: { 
  deals: any[];
  customerId: string;
  customerName?: string;
  allContacts: Array<{ id: string; name: string, phone?: string, email?: string }>;
  members: any[];
  projectsSummary: any;
  quotes?: any[];
  activityItems?: any[];
  onCreateDeal: () => void;
  onCreateQuote?: (dealId: string) => void;
  onOpenQuote?: (quoteId: string, dealId: string) => void;
  onEditDeal?: (deal: LiveDealRow) => void;
  onChanged?: () => void;
}) {
  const { user } = useAppAuth();
  const [selectedDealId, setSelectedDealIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const urlDeal = new URLSearchParams(window.location.search).get('dealId');
      if (urlDeal) return urlDeal;
      const saved = localStorage.getItem(`crm_selected_deal_${customerId}`);
      if (saved) return saved;
    }
    return null;
  });

  const setSelectedDealId = (id: string | null) => {
    setSelectedDealIdState(id);
    if (typeof window !== 'undefined') {
      if (id) {
        localStorage.setItem(`crm_selected_deal_${customerId}`, id);
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('dealId', id);
          window.history.replaceState({}, '', url.toString());
        } catch (e) {}
      } else {
        localStorage.removeItem(`crm_selected_deal_${customerId}`);
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('dealId');
          window.history.replaceState({}, '', url.toString());
        } catch (e) {}
      }
    }
  };

  const [detailDeal, setDetailDeal] = useState<LiveDealRow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  const [dealTab, setDealTabState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`crm_deal_subtab_${customerId}`);
      if (saved) return saved;
    }
    return 'overview';
  });

  const setDealTab = (newSubTab: string) => {
    setDealTabState(newSubTab);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`crm_deal_subtab_${customerId}`, newSubTab);
    }
  };
  
  // Follow up state
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({ date: '', time: '09:00', note: '' });

  // Quick Info state
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoForm, setInfoForm] = useState({ service_package: '', estimated_budget: '', source_platform: '', care_note: '' });
  
  // Presale Request state
  const [presaleRequestOpen, setPresaleRequestOpen] = useState(false);
  const [presaleRequestForm, setPresaleRequestForm] = useState({ target: '', deadline: '', presaleId: '' });
  const [presaleRequestLoading, setPresaleRequestLoading] = useState(false);

  // Category Selection Modal & Assignee Edit state
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [selectedCategoryPackage, setSelectedCategoryPackage] = useState('');
  const [categoryPackageBudget, setCategoryPackageBudget] = useState('');
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [editingAssignees, setEditingAssignees] = useState(false);

  // Catalog Picker Modal state matching media_1790531408169.png
  const [catalogItems, setCatalogItems] = useState<ServiceCatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogPickerSource, setCatalogPickerSource] = useState<'internal' | 'zone'>('internal');
  const [catalogGroupFilter, setCatalogGroupFilter] = useState('all');

  useEffect(() => {
    if (categoryModalOpen) {
      let alive = true;
      setLoadingCatalog(true);
      serviceCatalogRepository.list({ context: 'quote_picker' })
        .then(data => {
          if (alive) setCatalogItems(data || []);
        })
        .catch(err => {
          console.error('Lỗi nạp danh mục sản phẩm:', err);
        })
        .finally(() => {
          if (alive) setLoadingCatalog(false);
        });
      return () => { alive = false; };
    }
  }, [categoryModalOpen]);

  const pickerListItems: CatalogPickerListItem[] = useMemo(() => {
    function flattenCatalogTree(roots: ServiceCatalogItem[]): ServiceCatalogItem[] {
      const out: ServiceCatalogItem[] = [];
      function walk(nodes: ServiceCatalogItem[], nearestGroupName?: string) {
        for (const node of nodes) {
          if (node.itemType === 'group') {
            walk(node.children || [], node.name);
          } else {
            out.push({ ...node, groupName: nearestGroupName });
            if (node.children?.length) walk(node.children, nearestGroupName);
          }
        }
      }
      walk(roots);
      return out;
    }

    const flat = flattenCatalogTree(catalogItems);
    return flat.map(item => ({
      id: item.id,
      itemType: (item.itemType as 'component' | 'bundle') || 'component',
      components: item.components as any,
      sku: item.sku,
      name: item.name,
      description: item.description,
      quoteDisplayName: (item as any).quoteDisplayName ?? null,
      quoteDescription: (item as any).quoteDescription ?? null,
      quoteCta: (item as any).quoteCta ?? null,
      groupName: item.groupName ?? null,
      unit: item.unit ?? null,
      vatRate: (item as any).vatRate ?? null,
      costPriceVnd: (item as any).costPriceVnd ?? null,
      markupPercent: (item as any).markupPercent ?? null,
      customerPriceVnd: (item as any).customerPriceVnd || (item as any).customer_price_vnd || 0,
      monthlyPriceVnd: (item as any).monthlyPriceVnd ?? null,
      annualCommitMonthlyPriceVnd: (item as any).annualCommitMonthlyPriceVnd ?? null,
      annualTotalPriceVnd: (item as any).annualTotalPriceVnd ?? null,
      status: item.status as any,
      alreadyAdded: false,
    }));
  }, [catalogItems]);

  async function handleAddSelectedProducts(selectedIds: string[]) {
    if (!currentDisplayDeal || selectedIds.length === 0) return;
    const selectedItems = pickerListItems.filter(i => selectedIds.includes(i.id));
    const pkgName = selectedItems.map(i => i.name).join(', ');
    const budget = selectedItems.reduce((acc, curr) => acc + (curr.customerPriceVnd || 0), 0);
    await updateCurrentDeal({
      service_package: pkgName || (currentDisplayDeal as any).service_package,
      estimated_budget: budget || (currentDisplayDeal as any).estimated_budget || 0,
    });
    setCategoryModalOpen(false);
  }

  const [dealQuotes, setDealQuotes] = useState<Quote[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [dealActivities, setDealActivities] = useState<ActivityLogEntry[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<DealStage | null>(null);
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [deletingDealId, setDeletingDealId] = useState<string | null>(null);
  
  const [editSuccessBanner, setEditSuccessBanner] = useState(false);
  const [aiPlanOpen, setAiPlanOpen] = useState(false);
  const [aiPlanSaving, setAiPlanSaving] = useState(false);

  // Outer filters matching reference mockup
  const [search, setSearch] = useState('');
  const [statusPill, setStatusPill] = useState<'all' | 'dealing' | 'won' | 'lost' | 'paused'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');

  const optimisticDeal = deals.find(d => d.id === selectedDealId);
  const currentDisplayDeal = detailDeal?.id === selectedDealId ? detailDeal : optimisticDeal;

  const [saleRoleUsers, setSaleRoleUsers] = useState<QuoteBusinessRoleUser[]>([]);
  const [presaleRoleUsers, setPresaleRoleUsers] = useState<QuoteBusinessRoleUser[]>([]);

  const hasQuote = dealQuotes.length > 0;
  const hasPresaleInput = Boolean(primaryAssigneeId(currentDisplayDeal) || (currentDisplayDeal as any)?.service_package);
  const isQuoteApproved = dealQuotes.some((q: any) => q.status === 'approved' || q.status === 'da_duyet');
  const isQuoteSent = dealQuotes.some((q: any) => q.status === 'sent' || q.status === 'da_gui' || q.status === 'accepted');

  const dealingCount = useMemo(() => deals.filter(d => {
    const stage = (d.deal_stage || '').toLowerCase();
    return stage !== 'won' && stage !== 'lost' && stage !== 'paused' && stage !== 'thanh_cong' && stage !== 'that_bai';
  }).length, [deals]);

  const wonCount = useMemo(() => deals.filter(d => {
    const stage = (d.deal_stage || '').toLowerCase();
    return stage === 'won' || stage === 'thanh_cong';
  }).length, [deals]);

  const lostCount = useMemo(() => deals.filter(d => {
    const stage = (d.deal_stage || '').toLowerCase();
    return stage === 'lost' || stage === 'that_bai';
  }).length, [deals]);

  const pausedCount = useMemo(() => deals.filter(d => {
    const stage = (d.deal_stage || '').toLowerCase();
    return stage === 'paused' || stage === 'tam_dung';
  }).length, [deals]);

  function projectName(projectId?: string | null): string {
    if (!projectId) return 'Chưa phân loại';
    const p = projectsSummary?.projects?.find((item: any) => item.id === projectId);
    return p?.name || p?.projectCode || 'Chưa phân loại';
  }

  const filteredDeals = useMemo(() => {
    return deals.filter(d => {
      // 1. Search text filter
      if (search) {
        const s = search.toLowerCase();
        const name = (d.customer_name || d.name || d.id || '').toLowerCase();
        const code = (d.deal_code || d.id || '').toLowerCase();
        const stage = (getStageMeta(d.deal_stage)?.label || d.deal_stage || '').toLowerCase();
        if (!name.includes(s) && !code.includes(s) && !stage.includes(s)) {
          return false;
        }
      }

      // 2. Status filter (Pill or Select)
      const stage = (d.deal_stage || '').toLowerCase();
      const effectiveStatus = statusPill !== 'all' ? statusPill : statusFilter;
      if (effectiveStatus !== 'all') {
        if (effectiveStatus === 'dealing' && (stage === 'won' || stage === 'lost' || stage === 'paused' || stage === 'thanh_cong' || stage === 'that_bai')) return false;
        if (effectiveStatus === 'won' && stage !== 'won' && stage !== 'thanh_cong') return false;
        if (effectiveStatus === 'lost' && stage !== 'lost' && stage !== 'that_bai') return false;
        if (effectiveStatus === 'paused' && stage !== 'paused' && stage !== 'tam_dung') return false;
      }

      // 3. Owner filter
      if (ownerFilter !== 'all') {
        const ownerId = d.quote_owner_id || d.owner_id || d.sdr_id;
        if (ownerId !== ownerFilter) return false;
      }

      return true;
    });
  }, [deals, search, statusPill, statusFilter, ownerFilter]);

  useEffect(() => {
    setEditSuccessBanner(false);
    if (selectedDealId) {
      loadDealDetail(selectedDealId);
      loadDealQuotes(selectedDealId);
      loadDealActivities(selectedDealId);
    } else {
      setDetailDeal(null);
      setDealQuotes([]);
      setDealActivities([]);
    }
  }, [selectedDealId]);

  useEffect(() => {
    if (!selectedDealId || !detailDeal) return;
    if (detailDeal.id !== selectedDealId) return;
    const latestRow = deals.find(d => d.id === selectedDealId);
    if (!latestRow) return;
    if ((latestRow as any).updated_at && (latestRow as any).updated_at !== (detailDeal as any).updated_at) {
      loadDealDetail(selectedDealId);
      loadDealActivities(selectedDealId);
    }
  }, [deals, selectedDealId, detailDeal]);

  // Auto-dismiss success banner after 3 seconds
  useEffect(() => {
    if (!editSuccessBanner) return;
    const timer = setTimeout(() => setEditSuccessBanner(false), 3000);
    return () => clearTimeout(timer);
  }, [editSuccessBanner]);

  useEffect(() => {
    if (selectedDealId) loadDealQuotes(selectedDealId);
  }, [quotes, selectedDealId]);

  useEffect(() => {
    let alive = true;
    usersService.getUsersByQuoteBusinessRole('sale')
      .then(res => {
        if (alive) setSaleRoleUsers(res.success ? [...(res.data || [])].sort((a, b) => a.name.localeCompare(b.name)) : []);
      })
      .catch(() => {
        if (alive) setSaleRoleUsers([]);
      });
    usersService.getUsersByQuoteBusinessRole('presale')
      .then(res => {
        if (alive) setPresaleRoleUsers(res.success ? [...(res.data || [])].sort((a, b) => a.name.localeCompare(b.name)) : []);
      })
      .catch(() => {
        if (alive) setPresaleRoleUsers([]);
      });
    return () => { alive = false; };
  }, []);

  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedDealId) {
        setSelectedDealId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDealId]);

  async function loadDealDetail(dealId: string) {
    setLoadingDetail(true);
    try {
      const full = await customerLeadService.getById(dealId);
      setDetailDeal(full);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadDealQuotes(dealId: string) {
    setQuotesLoading(true);
    try {
      const resp = await seedingQuoteRepository.getQuotes({ dealId: dealId });
      setDealQuotes(Array.isArray(resp) ? resp : []);
    } catch (err) {
      console.error(err);
    } finally {
      setQuotesLoading(false);
    }
  }

  async function loadDealActivities(dealId: string) {
    setActivitiesLoading(true);
    try {
      const resp = await customerLeadService.getActivityLog(dealId);
      setDealActivities(resp.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setActivitiesLoading(false);
    }
  }

  async function refreshCurrentDeal() {
    if (selectedDealId) {
      await loadDealDetail(selectedDealId);
      await loadDealActivities(selectedDealId);
    }
    if (onChanged) onChanged();
  }

  async function updateCurrentDeal(payload: Partial<LiveDealRow>) {
    if (!currentDisplayDeal) return;
    const res = await customerLeadService.update(currentDisplayDeal.id, payload);
    if (res?.success === false) throw new Error(res?.message || 'Lỗi cập nhật');
    setEditSuccessBanner(true);
    await refreshCurrentDeal();
  }

  async function deleteDeal(deal: any) {
    if (!deal?.id || deletingDealId) return;
    const label = deal.customer_name || deal.name || deal.deal_code || 'cơ hội này';
    if (!window.confirm(`Xóa cơ hội "${label}"?`)) return;
    setDeletingDealId(deal.id);
    try {
      let res = await customerLeadService.delete(deal.id);
      const needsCascade = Boolean((res as any)?.data?.requiresCascadeConfirm);
      if (res?.success === false && needsCascade) {
        const ok = window.confirm((res as any)?.message || 'Cơ hội này có dữ liệu liên quan. Xóa kèm dữ liệu liên quan?');
        if (!ok) return;
        res = await customerLeadService.delete(deal.id, true);
      }
      if (res?.success === false) throw new Error(res?.message || 'Không xóa được cơ hội.');
      if (selectedDealId === deal.id) setSelectedDealId(null);
      await onChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không xóa được cơ hội.');
    } finally {
      setDeletingDealId(null);
    }
  }

  function primaryContactName(deal: any): string {
    return allContacts.find(c => c.id === deal?.primary_contact_id)?.name || 'Chưa gắn liên hệ';
  }

  function primaryAssigneeId(deal: any): string | null {
    return deal?.sdr_id || null;
  }

  function productLabels(deal: any): string[] {
    return String(deal?.service_package || deal?.industry || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function completionItems(deal: any) {
    return [
      Boolean(deal?.service_package || deal?.industry),
      Boolean(deal?.estimated_budget || deal?.lifetime_value),
      Boolean(deal?.follow_up_date),
      Boolean(deal?.primary_contact_id),
      Boolean(primaryAssigneeId(deal)),
    ];
  }

  function completionPercent(deal: any): number {
    const items = completionItems(deal);
    if (items.length === 0) return 0;
    return Math.round((items.filter(Boolean).length / items.length) * 100);
  }

  async function submitStageTransition(input: any) {
    if (!currentDisplayDeal || !transitionTarget) return;
    setTransitionLoading(true);
    try {
      const payload: StageTransitionPayload = {
        to_stage: transitionTarget as any,
        note: input.note,
        follow_up_date: input.followUpDate || undefined,
        decision_maker: input.decisionMaker || undefined,
        estimated_budget: input.estimatedBudget,
        attachment_url: input.attachmentUrl || undefined,
        reject_reason_text: input.outcome?.reasonText || input.note,
      };
      const res = await customerLeadService.transitionStage(currentDisplayDeal.id, payload);
      if (res?.success === false) throw new Error(res?.message || 'Không chuyển được giai đoạn.');
      setTransitionTarget(null);
      await refreshCurrentDeal();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không chuyển được giai đoạn.');
    } finally {
      setTransitionLoading(false);
    }
  }

  function formatMemberName(m: any): string {
    const rawName = m?.display_name || m?.name || m?.email || '';
    if (!rawName) return 'Thành viên';
    if (/^\d{8,}$/.test(rawName)) return `Thành viên (${rawName.slice(-4)})`;
    return rawName.replace(/^\d+\./, '');
  }

  function memberUserId(m: any): string {
    return String(m?.linked_user_id || m?.linked_user_id_2 || m?.id || '');
  }

  function roleUserDisplayName(u: QuoteBusinessRoleUser): string {
    const match = members.find(m => (m.linked_user_id || m.linked_user_id_2 || m.id) === u.id);
    return match ? formatMemberName(match) : u.name;
  }

  function roleUserLabel(u: QuoteBusinessRoleUser): string {
    const role = u.quote_business_role === 'both' ? 'Sale & Presale' : (u.quote_business_role === 'presale' ? 'Presale' : 'Sale');
    return [roleUserDisplayName(u), role].filter(Boolean).join(' · ');
  }

  const roleUsersById = useMemo(() => {
    const map = new Map<string, QuoteBusinessRoleUser>();
    for (const u of saleRoleUsers) map.set(u.id, u);
    for (const u of presaleRoleUsers) map.set(u.id, u);
    return map;
  }, [saleRoleUsers, presaleRoleUsers]);

  function memberName(userId?: string | null): string {
    if (!userId) return 'Chưa phân công';
    const roleUser = roleUsersById.get(userId);
    if (roleUser) return roleUserDisplayName(roleUser);
    const match = members.find(m => (m.linked_user_id || m.linked_user_id_2 || m.id) === userId);
    if (!match) return 'Chưa phân công';
    return formatMemberName(match);
  }
  
  const saleMembers = useMemo(() => {
    const valid = members.filter(m => {
      const name = m.display_name || m.name || m.email || '';
      if (!name || /^\d{8,}$/.test(name)) return false;
      const r = (m.role || m.business_role || m.position || '').toLowerCase();
      return r.includes('sale') || r.includes('sdr') || r.includes('bd') || r.includes('sales');
    });
    if (valid.length > 0) return valid;
    return members.filter(m => {
      const name = m.display_name || m.name || m.email || '';
      if (!name || /^\d{8,}$/.test(name)) return false;
      const r = (m.role || m.business_role || m.position || '').toLowerCase();
      return !r.includes('presale') && !r.includes('tech') && !r.includes('dev') && !r.includes('admin');
    });
  }, [members]);

  const presaleMembers = useMemo(() => {
    const filtered = members.filter(m => {
      const name = m.display_name || m.name || m.email || '';
      if (!name || /^\d{8,}$/.test(name)) return false;
      const r = (m.role || m.business_role || m.position || '').toLowerCase();
      return r.includes('presale') || r.includes('pre-sale') || r.includes('sa') || r.includes('tech') || r.includes('solution');
    });
    if (filtered.length > 0) return filtered;
    return members.filter(m => {
      const name = m.display_name || m.name || m.email || '';
      if (!name || /^\d{8,}$/.test(name)) return false;
      const r = (m.role || m.business_role || m.position || '').toLowerCase();
      return r.includes('presale') || r.includes('tech') || r.includes('sa');
    });
  }, [members]);

  const saleAssigneeOptions = useMemo(() => {
    if (saleRoleUsers.length > 0) {
      return saleRoleUsers.map(u => ({ id: u.id, label: roleUserLabel(u) }));
    }
    return saleMembers.map(m => ({ id: memberUserId(m), label: formatMemberName(m) })).filter(o => Boolean(o.id));
  }, [saleRoleUsers, saleMembers]);

  const presaleAssigneeOptions = useMemo(() => {
    if (presaleRoleUsers.length > 0) {
      return presaleRoleUsers.map(u => ({ id: u.id, label: roleUserLabel(u) }));
    }
    return presaleMembers.map(m => ({ id: memberUserId(m), label: formatMemberName(m) })).filter(o => Boolean(o.id));
  }, [presaleRoleUsers, presaleMembers]);

  const dealAiContext = useMemo<DealAiContext | null>(() => {
    if (!currentDisplayDeal) return null;
    const products = productLabels(currentDisplayDeal);
    const hasBom = Boolean(
      (currentDisplayDeal as any).bom_status === 'confirmed' ||
      (currentDisplayDeal as any).bom_confirmed ||
      (currentDisplayDeal as any).scope_confirmed ||
      (currentDisplayDeal as any).presale_scope_confirmed ||
      (currentDisplayDeal as any).technical_scope_status === 'confirmed' ||
      (currentDisplayDeal as any).last_attachment_url
    );
    return {
      deal: currentDisplayDeal,
      quoteCount: dealQuotes.length,
      activityCount: dealActivities.length,
      productCount: products.length,
      hasPrimaryContact: Boolean((currentDisplayDeal as any).primary_contact_id),
      hasPresale: Boolean(primaryAssigneeId(currentDisplayDeal)),
      hasBom,
    };
  }, [currentDisplayDeal, dealQuotes.length, dealActivities.length]);

  const dynamicSuggestions = useMemo(() => getDealScopedAiSuggestions(dealAiContext), [dealAiContext]);
  const dynamicActions = useMemo(() => getDealScopedAiActions(dealAiContext), [dealAiContext]);

  const primaryContact = useMemo(() => {
    return allContacts.find(c => c.id === currentDisplayDeal?.primary_contact_id);
  }, [allContacts, currentDisplayDeal?.primary_contact_id]);

  const contactPhone = primaryContact?.phone || (currentDisplayDeal as any)?.phone || (currentDisplayDeal as any)?.zalo || '';
  const contactEmail = primaryContact?.email || (currentDisplayDeal as any)?.email || '';

  return (
    <div className="space-y-6 w-full relative">
      
      {/* Top Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
              <Target className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Cơ hội</h2>
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-100 text-[#c2185b] text-xs font-bold">
                  {deals.length}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">
                Danh sách cơ hội của khách hàng {customerName || 'khách hàng'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <input 
                type="text" 
                placeholder="Tìm tên cơ hội, giai đoạn..." 
                className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#c2185b]"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <select 
              className="h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium outline-none focus:ring-1 focus:ring-[#c2185b]"
              value={ownerFilter}
              onChange={e => setOwnerFilter(e.target.value)}
            >
              <option value="all">Owner</option>
              {saleAssigneeOptions.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>

            <Button size="sm" className="h-8 text-xs bg-[#c2185b] hover:bg-[#a91549] text-white gap-1.5 font-medium px-3.5 rounded-lg shadow-2xs" onClick={onCreateDeal}>
              <Plus className="size-3.5" />
              <span>Tạo cơ hội</span>
            </Button>
          </div>
        </div>

        {/* FULL-WIDTH TABLE: Opportunity List matching reference mockup */}
        <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
          {/* Status Pills Bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50/50 border-b border-slate-200 overflow-x-auto">
          <button
            onClick={() => setStatusPill('all')}
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              statusPill === 'all' 
                ? 'bg-rose-50 text-[#c2185b] border border-rose-200' 
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>Tất cả</span>
            <span className={`px-1.5 py-0.2 text-[10px] rounded-full font-bold ${
              statusPill === 'all' ? 'bg-rose-100 text-[#c2185b]' : 'bg-slate-100 text-slate-600'
            }`}>
              {deals.length}
            </span>
          </button>

          <button
            onClick={() => setStatusPill('dealing')}
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              statusPill === 'dealing' 
                ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="size-2 rounded-full bg-blue-500 inline-block" />
            <span>Đang deal</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">
              {dealingCount}
            </span>
          </button>

          <button
            onClick={() => setStatusPill('won')}
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              statusPill === 'won' 
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="size-2 rounded-full bg-emerald-500 inline-block" />
            <span>Thắng</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">
              {wonCount}
            </span>
          </button>

          <button
            onClick={() => setStatusPill('lost')}
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              statusPill === 'lost' 
                ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="size-2 rounded-full bg-rose-500 inline-block" />
            <span>Thua</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">
              {lostCount}
            </span>
          </button>

          <button
            onClick={() => setStatusPill('paused')}
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              statusPill === 'paused' 
                ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="size-2 rounded-full bg-amber-500 inline-block" />
            <span>Tạm dừng</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">
              {pausedCount}
            </span>
          </button>
        </div>

        {/* Table Area */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/70 text-[11px] uppercase text-slate-500 font-semibold tracking-wide border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">CƠ HỘI</th>
                <th className="px-4 py-3">GIAI ĐOẠN</th>
                <th className="px-4 py-3 text-right">GIÁ TRỊ DỰ KIẾN</th>
                <th className="px-4 py-3">NEXT ACTION</th>
                <th className="px-4 py-3">OWNER</th>
                <th className="px-4 py-3">CẬP NHẬT</th>
                <th className="px-4 py-3 text-right">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDeals.map((deal: any) => {
                const isSelected = selectedDealId === deal.id;
                const meta = getStageMeta((deal.deal_stage as DealStage) || 'new_lead');
                const isOverdue = deal.follow_up_date && new Date(deal.follow_up_date) < new Date();
                const pName = projectName(deal.project_id || deal.projectId);

                return (
                  <tr 
                    key={deal.id} 
                    onClick={() => setSelectedDealId(deal.id)}
                    className={`cursor-pointer transition-colors group ${
                      isSelected ? 'bg-rose-50/40 font-medium' : 'hover:bg-slate-50/80 bg-white'
                    }`}
                  >
                    {/* Cơ hội column */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-lg bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
                          <FileText className="size-4" />
                        </div>
                        <div>
                          <div className={`font-bold text-xs ${isSelected ? 'text-[#c2185b]' : 'text-slate-900 group-hover:text-[#c2185b]'}`}>
                            {deal.customer_name || deal.name || deal.id}
                          </div>
                          <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                            {deal.deal_code || deal.id.split('-')[1]?.substring(0,8) || 'OPP-2026-001'} • Dự án: {pName}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Giai đoạn column */}
                    <td className="px-4 py-3.5">
                      <Badge className="bg-blue-50 text-blue-700 border-blue-100 shadow-none font-semibold px-2.5 py-0.5 rounded-md text-[10px]">
                        {meta.label}
                      </Badge>
                    </td>

                    {/* Giá trị dự kiến column */}
                    <td className="px-4 py-3.5 text-right font-bold text-slate-900">
                      {(deal as any).estimated_budget || (deal as any).lifetime_value ? formatVND((deal as any).estimated_budget || (deal as any).lifetime_value) : '0 đ'}
                    </td>

                    {/* Next Action column */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-start gap-1.5 text-xs">
                        <Clock className={`size-3.5 mt-0.5 shrink-0 ${isOverdue ? 'text-rose-500' : 'text-rose-500'}`} />
                        <div>
                          <div className="text-rose-600 font-semibold">{deal.next_action || deal.next_step || 'Follow-up'}</div>
                          <div className="text-[11px] text-rose-500">{formatCrmDate(deal.follow_up_date) || 'Chưa hẹn'}</div>
                        </div>
                      </div>
                    </td>

                    {/* Owner column */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="size-5 rounded-full bg-slate-200 text-slate-600 font-bold text-[9px] uppercase flex items-center justify-center shrink-0">
                          {memberName((deal as any).quote_owner_id || (deal as any).owner_id)[0] || 'C'}
                        </div>
                        <span className="font-medium text-slate-700 text-xs">{memberName((deal as any).quote_owner_id || (deal as any).owner_id)}</span>
                      </div>
                    </td>

                    {/* Cập nhật column */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-start gap-1.5 text-xs">
                        <Clock className="size-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                          <div className="text-slate-600 font-medium">{relativeTime(deal.updated_at || deal.created_at) || 'Vừa xong'}</div>
                          <div className="text-[11px] text-slate-400">{formatCrmDate(deal.updated_at || deal.created_at)}</div>
                        </div>
                      </div>
                    </td>

                    {/* Thao tác column */}
                    <td className="px-4 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-lg border border-rose-100 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                          disabled={deletingDealId === deal.id}
                          title="Xóa cơ hội"
                          onClick={() => void deleteDeal(deal)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filteredDeals.length && (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-xs">Chưa có cơ hội nào phù hợp.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white border-t border-slate-200 text-xs text-slate-500">
          <div>
            Hiển thị 1 - {filteredDeals.length} của {deals.length} cơ hội
          </div>

          <div className="flex items-center gap-3">
            <select className="h-8 px-2.5 border border-slate-200 rounded-lg bg-white text-slate-700 font-medium outline-none">
              <option value="20">20 / trang</option>
              <option value="50">50 / trang</option>
              <option value="100">100 / trang</option>
            </select>

            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8 rounded-lg border-slate-200 text-slate-400" disabled>
                ‹
              </Button>
              <Button size="icon" className="size-8 rounded-lg bg-[#c2185b] text-white font-bold text-xs">
                1
              </Button>
              <Button variant="outline" size="icon" className="size-8 rounded-lg border-slate-200 text-slate-400" disabled>
                ›
              </Button>
            </div>
          </div>
        </div>

      </div>

      {/* FLOATING SIDE PANEL / WORKSPACE (NO BACKDROP, STAYS OPEN & UPDATES DATA SMOOTHLY) */}
      {selectedDealId && (
        <aside className="fixed right-0 top-0 bottom-0 z-[9990] w-full max-w-[950px] bg-white shadow-2xl flex flex-col border-l border-slate-200 h-screen overflow-hidden">
          
          {loadingDetail && !currentDisplayDeal ? (
            <div className="absolute inset-0 z-20 bg-white/60 backdrop-blur-2xs flex items-center justify-center">
              <div className="animate-spin size-8 border-3 border-[#c2185b] border-t-transparent rounded-full"></div>
            </div>
          ) : loadingDetail ? (
            <div className="absolute top-4 right-16 z-50">
               <div className="animate-spin size-4 border-2 border-[#c2185b] border-t-transparent rounded-full"></div>
            </div>
          ) : null}
          
          {currentDisplayDeal ? (
            <div className="flex flex-col h-full overflow-hidden">
              
              {/* STICKY HEADER (Shrink-0: Deal Title, ID, AI score, + Tạo báo giá, Pipeline, Sub-tabs) */}
              <div className="shrink-0 bg-white border-b border-slate-200 p-5 z-10 shadow-2xs">
                
                {editSuccessBanner && (
                  <div className="mb-3 flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-2xs animate-in fade-in duration-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                      <span>Cập nhật khách hàng thành công!</span>
                    </div>
                    <button type="button" onClick={() => setEditSuccessBanner(false)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer">
                      <X className="size-4" />
                    </button>
                  </div>
                )}

                {/* Header Actions Row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="size-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Target className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h2 className="text-xl font-bold text-slate-900 truncate">{currentDisplayDeal.customer_name || currentDisplayDeal.id}</h2>
                        <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 text-[10px] uppercase font-mono px-1.5">{currentDisplayDeal.id.split('-')[1]?.substring(0,8)}</Badge>
                        <Badge className="bg-blue-100 text-blue-700 shadow-none hover:bg-blue-100 font-semibold text-[11px]">{getStageMeta((currentDisplayDeal.deal_stage as DealStage) || 'new_lead').label}</Badge>
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                        Company: {currentDisplayDeal.company_name || 'Hilab'} • Owner: {memberName(currentDisplayDeal.quote_owner_id)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 rounded-lg border border-rose-100">
                      <span className="text-rose-600 font-bold text-base">
                        {(currentDisplayDeal as any).lead_score && (currentDisplayDeal as any).lead_score !== "N/A" 
                          ? (currentDisplayDeal as any).lead_score 
                          : "-"}
                      </span>
                      <span className="text-rose-500 text-[9px] font-bold uppercase tracking-wider">AI Score</span>
                    </div>
                    <Button size="sm" className="bg-[#c2185b] hover:bg-[#a91549] text-white shadow-2xs h-8 text-xs font-medium" onClick={() => onCreateQuote?.(selectedDealId!)}>
                      + Tạo báo giá
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100" onClick={() => setSelectedDealId(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                
                {/* Pipeline Stage Horizontal (Compact, scroll contained, connector lines stop cleanly between circles) */}
                <div className="overflow-x-auto pb-1 mt-4 [scrollbar-width:none] [::-webkit-scrollbar]:hidden">
                  <div className="flex items-center min-w-[700px] justify-between px-1">
                    {PIPELINE_COLUMNS.map((stageKey, idx) => {
                      const step = DEAL_STAGE_META[stageKey].label;
                      const isCurrent = currentDisplayDeal?.deal_stage === stageKey;
                      const currentOrder = DEAL_STAGE_META[currentDisplayDeal?.deal_stage as DealStage]?.order || 1;
                      const stepOrder = DEAL_STAGE_META[stageKey].order;
                      const isPassed = stepOrder < currentOrder;
                      const daysInStage = (currentDisplayDeal as any).days_in_stage;
                      
                      return (
                        <React.Fragment key={stageKey}>
                          <div 
                            className="flex flex-col items-center gap-1.5 relative group cursor-pointer shrink-0 w-[74px]"
                            onClick={() => setTransitionTarget(stageKey as DealStage)}
                          >
                            <div className={`size-5 rounded-full flex items-center justify-center text-[10px] font-bold z-10 transition-colors ${
                              isCurrent ? 'bg-blue-600 text-white ring-4 ring-blue-50' : 
                                isPassed ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
                            }`}>
                              {idx + 1}
                            </div>
                            <div className="text-center min-h-6">
                              <div className={`text-[10px] leading-tight font-medium ${isCurrent ? 'text-blue-700 font-bold' : isPassed ? 'text-slate-800' : 'text-slate-400'}`}>
                                {step}
                              </div>
                              {isCurrent && daysInStage != null && (
                                <div className="text-[9px] text-blue-600 font-semibold mt-0.5">{daysInStage} ngày</div>
                              )}
                            </div>
                          </div>
                          {idx < PIPELINE_COLUMNS.length - 1 && (
                            <div className={`flex-1 h-[2px] self-start mt-2.5 min-w-[10px] ${isPassed ? 'bg-blue-600' : 'bg-slate-200'}`} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
                  
                {/* Sub-tabs (No Lịch sử tab, only 5 tabs: Tổng quan, Giải pháp & sản phẩm, Báo giá, Hoạt động, Tài liệu) */}
                <div className="flex gap-6 mt-4 border-b border-slate-200 px-1 -mb-5">
                  {[
                    { id: 'overview', label: 'Tổng quan' },
                    { id: 'products', label: 'Giải pháp & sản phẩm' },
                    { id: 'quotes', label: `Báo giá (${dealQuotes.length})` },
                    { id: 'activities', label: 'Hoạt động' },
                    { id: 'documents', label: 'Tài liệu' },
                  ].map((t) => (
                    <div 
                      key={t.id} 
                      onClick={() => setDealTab(t.id)}
                      className={`pb-3 text-xs font-semibold cursor-pointer border-b-2 transition-colors ${
                        dealTab === t.id ? 'text-[#c2185b] border-[#c2185b]' : 'text-slate-500 hover:text-slate-800 border-transparent'
                      }`}
                    >
                      {t.label}
                    </div>
                  ))}
                </div>

              </div>

              {/* SINGLE SCROLLABLE CONTENT BODY (1 Clean Scrollbar for entire body!) */}
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/40 space-y-6 [scrollbar-width:thin] [::-webkit-scrollbar]:w-1.5 [::-webkit-scrollbar-thumb]:bg-slate-300 [::-webkit-scrollbar-thumb]:rounded-full">
                
                {dealTab === 'overview' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_310px] gap-5 items-start">
                    
                    {/* Left Main Column */}
                    <div className="flex flex-col gap-5 min-w-0">
                      
                      {/* 12. Follow-up Strip (Compact height ~60px) */}
                      <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-2xs">
                        <div className="flex items-center gap-3 min-w-0">
                          <Calendar className="size-5 text-rose-500 shrink-0" />
                          <div className="min-w-0">
                            <h4 className="text-rose-700 font-bold text-xs truncate">
                              {(currentDisplayDeal as any).follow_up_date ? "Đã lên lịch Follow-up" : "Chưa có Follow-up"}
                            </h4>
                            <p className="text-rose-600/80 text-[11px] font-medium truncate mt-0.5">
                              {(currentDisplayDeal as any).follow_up_date 
                                ? `${formatCrmDateTime((currentDisplayDeal as any).follow_up_date)} • ${(currentDisplayDeal as any).next_action || (currentDisplayDeal as any).next_step || 'Follow-up khách hàng'}` 
                                : "Hãy đặt lịch để không bỏ lỡ cơ hội."}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {(currentDisplayDeal as any).follow_up_date && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="bg-white text-rose-700 hover:bg-rose-50 border-rose-200 text-xs h-7 px-2.5 font-medium"
                              onClick={() => setFollowUpOpen(true)}
                            >
                              Xem chi tiết
                            </Button>
                          )}
                          
                          {followUpOpen ? (
                            <div className="absolute z-50 bg-white border border-slate-200 shadow-xl rounded-xl p-4 w-72 right-5 mt-8">
                              <h4 className="font-bold text-xs mb-3">Đặt Follow-up</h4>
                              <div className="space-y-2.5">
                                <input type="date" className="w-full text-xs border border-slate-200 rounded p-1.5" value={followUpForm.date} onChange={e => setFollowUpForm(prev => ({...prev, date: e.target.value}))}/>
                                <input type="time" className="w-full text-xs border border-slate-200 rounded p-1.5" value={followUpForm.time} onChange={e => setFollowUpForm(prev => ({...prev, time: e.target.value}))}/>
                                <input type="text" placeholder="Ghi chú (Tùy chọn)" className="w-full text-xs border border-slate-200 rounded p-1.5" value={followUpForm.note} onChange={e => setFollowUpForm(prev => ({...prev, note: e.target.value}))}/>
                                <div className="flex gap-2 pt-1">
                                  <Button size="sm" className="flex-1 h-7 text-xs bg-blue-600 text-white" disabled={followUpLoading || !followUpForm.date} onClick={async () => {
                                    setFollowUpLoading(true);
                                    try {
                                      const dt = new Date(`${followUpForm.date}T${followUpForm.time}`);
                                      await updateCurrentDeal({ follow_up_date: dt.toISOString(), care_note: followUpForm.note });
                                      setFollowUpOpen(false);
                                    } catch(e) {} finally { setFollowUpLoading(false); }
                                  }}>{followUpLoading ? 'Lưu...' : 'Lưu'}</Button>
                                  <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setFollowUpOpen(false)}>Hủy</Button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white shadow-2xs text-xs h-7 px-3 font-medium" onClick={() => setFollowUpOpen(true)}>
                              + Đặt follow-up
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* 2. Thông tin cần để làm việc (Clean 4-column Grid, NO 8 mini-cards) */}
                      <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-2xs space-y-4">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-slate-900 text-sm">Thông tin cần để làm việc</h3>
                          <button 
                            type="button"
                            className="text-blue-600 font-semibold text-xs hover:underline cursor-pointer" 
                            onClick={() => onEditDeal?.(currentDisplayDeal)}
                          >
                            Chỉnh sửa
                          </button>
                        </div>
                        
                        {/* 4-column clean grid (Responsive 4 -> 2 columns) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3.5 gap-x-4 text-xs">
                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Sản phẩm / Dịch vụ</div>
                            <div className="font-semibold text-slate-800 text-xs truncate">{(currentDisplayDeal as any).service_package || currentDisplayDeal.industry || 'Chưa xác định'}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Giá trị dự kiến</div>
                            <div className="font-bold text-slate-900 text-xs">{(currentDisplayDeal as any).estimated_budget || (currentDisplayDeal as any).lifetime_value ? formatVND((currentDisplayDeal as any).estimated_budget || (currentDisplayDeal as any).lifetime_value) : '0 đ'}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Mức độ quan tâm</div>
                            <div className="font-semibold text-slate-800 text-xs">{(currentDisplayDeal as any).interest_level || (currentDisplayDeal as any).priority || ((currentDisplayDeal as any).lead_score > 70 ? '🔥 Cao' : 'Bình thường')}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Dự kiến triển khai</div>
                            <div className="font-semibold text-slate-800 text-xs">{(currentDisplayDeal as any).implementation_timeline || (currentDisplayDeal as any).timeline || 'Chưa xác định'}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Dự kiến chốt</div>
                            <div className="font-semibold text-slate-800 text-xs">{(currentDisplayDeal as any).expected_close_date ? formatCrmDate((currentDisplayDeal as any).expected_close_date) : 'Chưa có'}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Fit khách hàng</div>
                            <div className="font-semibold text-emerald-600 text-xs">{(currentDisplayDeal as any).customer_fit || (currentDisplayDeal.deal_stage === 'won' ? 'Rất phù hợp' : 'Phù hợp')}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Nguồn</div>
                            <div className="font-semibold text-slate-800 text-xs">{(currentDisplayDeal as any).source_platform || (currentDisplayDeal as any).source || 'Personal'}</div>
                          </div>

                          <div>
                            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap mb-0.5">Sale owner</div>
                            <div className="font-semibold text-slate-800 text-xs truncate">{memberName((currentDisplayDeal as any).quote_owner_id || currentDisplayDeal.owner_id || (currentDisplayDeal as any).sdr_id || (currentDisplayDeal as any).marketer_id)}</div>
                          </div>
                        </div>

                        {/* 3. Need / Handover Note (Full width thin border-top area below grid) */}
                        <div className="border-t border-slate-100 pt-3">
                          <div className="text-[11px] text-slate-400 font-medium mb-1">Nhu cầu / Ghi chú bàn giao</div>
                          <div className="text-xs text-slate-700 font-normal leading-relaxed">
                            {(currentDisplayDeal as any).note || (currentDisplayDeal as any).care_note || (currentDisplayDeal as any).handover_note || 'Chưa có ghi chú / nhu cầu được ghi nhận.'}
                          </div>
                        </div>
                      </div>

                      {/* 9. BOM Warning Strip (Thin warning strip) */}
                      {(!currentDisplayDeal.industry && !(currentDisplayDeal as any).service_package && primaryAssigneeId(currentDisplayDeal)) && (
                        <div className="bg-orange-50 border border-orange-200/90 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs shadow-2xs">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <AlertCircle className="size-4 text-orange-500 shrink-0" />
                            <span className="text-orange-800 font-medium truncate">
                              Chưa có BOM kỹ thuật – Presale cần xác nhận phạm vi này.
                            </span>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-white text-blue-600 hover:bg-blue-50 border-blue-200 text-xs h-7 px-3 shrink-0 font-medium" 
                            onClick={() => setCategoryModalOpen(true)}
                          >
                            Chọn từ danh mục
                          </Button>
                        </div>
                      )}

                      {/* 8. Product / Solution (Inside main left column) */}
                      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
                        <div className="px-5 py-3 flex justify-between items-center border-b border-slate-100">
                          <h3 className="font-bold text-slate-800 text-xs">Sản phẩm / Giải pháp</h3>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 text-blue-600 text-xs border-blue-200 px-3 font-medium hover:bg-blue-50" 
                            onClick={() => setCategoryModalOpen(true)}
                          >
                            + Chọn từ danh mục
                          </Button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 font-bold border-b border-slate-100">
                              <tr>
                                <th className="px-5 py-2.5">Tên sản phẩm / giải pháp</th>
                                <th className="px-4 py-2.5">Số lượng</th>
                                <th className="px-4 py-2.5 text-right">Đơn giá</th>
                                <th className="px-4 py-2.5 text-right">Thành tiền</th>
                                <th className="px-4 py-2.5" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {productLabels(currentDisplayDeal).length > 0 ? (
                                productLabels(currentDisplayDeal).map((item, idx) => (
                                  <tr key={idx} className="hover:bg-slate-50">
                                    <td className="px-5 py-3 font-medium text-slate-800">
                                      {item}
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">1</td>
                                    <td className="px-4 py-3 text-right font-medium text-slate-900">{formatVND((currentDisplayDeal as any).estimated_budget) || '0 đ'}</td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-900">{formatVND((currentDisplayDeal as any).estimated_budget) || '0 đ'}</td>
                                    <td className="px-4 py-3 text-right"><MoreHorizontal className="size-4 text-slate-400 cursor-pointer"/></td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={5} className="px-5 py-5 text-center text-slate-400 text-xs">
                                    Chưa có sản phẩm / giải pháp.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* 10. Checklist Trước Báo Giá (Compact Rows) */}
                      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
                        <div className="px-5 py-3 flex justify-between items-center border-b border-slate-100">
                          <h3 className="font-bold text-slate-800 text-xs">Checklist trước báo giá</h3>
                        </div>
                        <div className="p-3 space-y-1">
                          {[
                            { label: 'Sản phẩm / dịch vụ', ok: Boolean((currentDisplayDeal as any).service_package || currentDisplayDeal.industry) },
                            { label: 'Giá trị dự kiến', ok: Boolean((currentDisplayDeal as any).estimated_budget) },
                            { label: 'Follow-up date', ok: Boolean((currentDisplayDeal as any).follow_up_date), text: (currentDisplayDeal as any).follow_up_date ? 'Đã lên lịch' : 'Thiếu' },
                            { label: 'Liên hệ chính', ok: Boolean((currentDisplayDeal as any).primary_contact_id) },
                            { label: 'Xác nhận phạm vi (BOM kỹ thuật)', ok: Boolean(primaryAssigneeId(currentDisplayDeal) && (currentDisplayDeal as any).service_package) },
                          ].map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center px-3 py-1.5 hover:bg-slate-50 rounded-lg text-xs">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`size-4 rounded-full border flex items-center justify-center shrink-0 ${item.ok ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
                                  {item.ok && <CheckCircle2 className="size-3.5 text-white"/>}
                                </div>
                                <span className="text-slate-700 font-medium truncate">{item.label}</span>
                              </div>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap shrink-0 ${
                                item.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                              }`}>
                                {item.text || (item.ok ? 'Đã có' : 'Thiếu')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>

                    {/* Right Rail Column (Width 310px) */}
                    <div className="w-full xl:w-[310px] shrink-0 flex flex-col gap-5 min-w-0">
                      
                      {/* 4. Phụ trách (Clean Text Rows, NO 4 mini-card boxes) */}
                      <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs space-y-3 text-xs">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-slate-900 text-xs">Phụ trách</h3>
                          <button 
                            type="button" 
                            className="text-blue-600 font-semibold text-[11px] hover:underline cursor-pointer"
                            onClick={() => setEditingAssignees(!editingAssignees)}
                          >
                            {editingAssignees ? 'Thu gọn' : 'Thay đổi'}
                          </button>
                        </div>

                        {editingAssignees ? (
                          <div className="space-y-2.5 pt-1">
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">SALE OWNER</label>
                              <select 
                                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-1.5 focus:ring-1 focus:ring-[#c2185b]"
                                value={(currentDisplayDeal as any).quote_owner_id || (currentDisplayDeal as any).owner_id || ''}
                                onChange={async (e) => {
                                  const val = e.target.value;
                                  await updateCurrentDeal({ quote_owner_id: val } as any);
                                }}
                              >
                                <option value="">-- Chưa phân công --</option>
                                {saleAssigneeOptions.map(option => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">PRESALE</label>
                              <select 
                                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-1.5 focus:ring-1 focus:ring-[#c2185b]"
                                value={primaryAssigneeId(currentDisplayDeal) || ''}
                                onChange={async (e) => {
                                  const val = e.target.value;
                                  await updateCurrentDeal({ sdr_id: val });
                                }}
                              >
                                <option value="">+ Phân công</option>
                                {presaleAssigneeOptions.map(option => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">LIÊN HỆ CHÍNH</label>
                              <select 
                                className="w-full text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg p-1.5 focus:ring-1 focus:ring-[#c2185b]"
                                value={(currentDisplayDeal as any).primary_contact_id || ''}
                                onChange={async (e) => {
                                  const val = e.target.value;
                                  await updateCurrentDeal({ primary_contact_id: val } as any);
                                }}
                              >
                                <option value="">-- Chưa chọn --</option>
                                {allContacts.map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2 py-1">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400 font-medium">Sale owner</span>
                              <span className="font-semibold text-slate-800 truncate max-w-[170px] text-right">
                                {memberName((currentDisplayDeal as any).quote_owner_id || currentDisplayDeal.owner_id || (currentDisplayDeal as any).sdr_id)}
                              </span>
                            </div>

                            <div className="flex justify-between items-center">
                              <span className="text-slate-400 font-medium">Presale</span>
                              <span className="font-semibold text-slate-800 truncate max-w-[170px] text-right">
                                {primaryAssigneeId(currentDisplayDeal) ? memberName(primaryAssigneeId(currentDisplayDeal)) : 'Chưa phân công'}
                              </span>
                            </div>

                            <div className="flex justify-between items-center">
                              <span className="text-slate-400 font-medium">Liên hệ chính</span>
                              <span className="font-semibold text-slate-800 truncate max-w-[170px] text-right">
                                {primaryContactName(currentDisplayDeal)}
                              </span>
                            </div>
                          </div>
                        )}

                        <div className="border-t border-slate-100 pt-3 flex items-center gap-2">
                          <a 
                            href={contactPhone ? `tel:${contactPhone}` : undefined}
                            onClick={(e) => { if (!contactPhone) e.preventDefault(); }}
                            className="flex-1 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 font-medium text-slate-700 text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                          >
                            <Phone className="size-3.5 text-slate-500" /> Gọi
                          </a>

                          <a 
                            href={contactEmail ? `mailto:${contactEmail}` : undefined}
                            onClick={(e) => { if (!contactEmail) e.preventDefault(); }}
                            className="flex-1 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 font-medium text-slate-700 text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                          >
                            <Mail className="size-3.5 text-slate-500" /> Email
                          </a>

                          <a 
                            href={contactPhone ? `https://zalo.me/${contactPhone.replace(/\s+/g, '')}` : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => { if (!contactPhone) e.preventDefault(); }}
                            className="flex-1 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 font-medium text-slate-700 text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                          >
                            <MessageCircle className="size-3.5 text-slate-500" /> Zalo
                          </a>
                        </div>
                      </div>

                      {/* 2. AI gợi ý (Dynamic context-aware suggestions) */}
                      <div className="bg-purple-50/60 border border-purple-100 rounded-xl p-4 text-xs shadow-2xs">
                        <div className="flex items-center gap-1.5 font-bold text-purple-900 text-xs mb-2.5">
                          <Sparkles className="size-4 text-purple-600 shrink-0" />
                          <span>AI gợi ý</span>
                        </div>
                        
                        <ul className="space-y-1.5 text-slate-700 font-medium leading-normal text-[11px]">
                          {dynamicSuggestions.map((sug, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="text-purple-600 font-bold">•</span>
                              <span>{sug}</span>
                            </li>
                          ))}
                        </ul>

                        {aiPlanOpen ? (
                          <div className="mt-3 pt-2.5 border-t border-purple-200/80 space-y-2 animate-in fade-in duration-200 text-xs">
                            <div className="font-bold text-purple-900 flex items-center justify-between text-[11px]">
                              <span>📋 Kế hoạch hành động:</span>
                              <button type="button" onClick={() => setAiPlanOpen(false)} className="text-purple-500 hover:text-purple-700 font-semibold cursor-pointer">Thu gọn</button>
                            </div>
                            <div className="space-y-1.5 bg-white/90 p-2.5 rounded-lg border border-purple-100 text-slate-800 text-[11px]">
                              {dynamicActions.map((act, idx) => (
                                <div key={idx} className={`flex items-center gap-1.5 font-semibold ${act.done ? 'text-slate-800' : 'text-slate-600'}`}>
                                  {act.done ? (
                                    <CheckCircle2 className="size-3 text-purple-600 shrink-0" />
                                  ) : (
                                    <div className="size-3 rounded-full border border-slate-300 shrink-0" />
                                  )}
                                  <span>{act.text}</span>
                                </div>
                              ))}
                            </div>
                            <button 
                              type="button" 
                              disabled={aiPlanSaving}
                              onClick={async () => {
                                if (!currentDisplayDeal) return;
                                setAiPlanSaving(true);
                                try {
                                  const prevNote = (currentDisplayDeal as any)?.care_note || (currentDisplayDeal as any)?.note || '';
                                  const planText = dynamicActions.map(a => a.text).join(' | ');
                                  const firstOpenAction = dynamicActions.find(a => !a.done)?.text || dynamicActions[0]?.text || 'Theo dõi cơ hội theo stage hiện tại';
                                  const contextLine = `[AI Plan][deal_id=${currentDisplayDeal.id}]: ${planText}`;
                                  const newNote = prevNote ? `${prevNote}\n${contextLine}` : contextLine;
                                  await updateCurrentDeal({
                                    care_note: newNote,
                                    last_care_at: new Date().toISOString(),
                                    next_step: firstOpenAction,
                                  } as any);
                                  setAiPlanOpen(false);
                                } catch (err) {
                                  console.error(err);
                                } finally {
                                  setAiPlanSaving(false);
                                }
                              }}
                              className="w-full py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
                            >
                              {aiPlanSaving ? 'Đang áp dụng...' : 'Áp dụng gợi ý'}
                            </button>
                          </div>
                        ) : (
                          <button 
                            type="button"
                            onClick={() => setAiPlanOpen(true)}
                            className="mt-3 py-1 px-3 border border-purple-200 rounded-lg bg-white hover:bg-purple-50 font-semibold text-purple-700 text-[11px] shadow-2xs transition-colors cursor-pointer"
                          >
                            Áp dụng gợi ý
                          </button>
                        )}
                      </div>

                      {/* 3. Tiến độ báo giá (Compact 1-row / 2x2 grid) */}
                      <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs space-y-3">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-slate-900 text-xs">Tiến độ báo giá</h3>
                          {dealQuotes.length > 0 && (
                            <span className="text-[11px] font-semibold text-rose-600">
                              {dealQuotes.length} báo giá
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                            <span className="text-[11px] text-slate-500 font-medium">Trạng thái</span>
                            <span className={`text-[11px] font-semibold flex items-center gap-1 ${hasQuote ? 'text-emerald-700' : 'text-slate-500'}`}>
                              <span className={`size-1.5 rounded-full ${hasQuote ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {hasQuote ? 'Đã tạo' : 'Chưa tạo'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                            <span className="text-[11px] text-slate-500 font-medium">Input Presale</span>
                            <span className={`text-[11px] font-semibold flex items-center gap-1 ${hasPresaleInput ? 'text-emerald-700' : 'text-slate-500'}`}>
                              <span className={`size-1.5 rounded-full ${hasPresaleInput ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {hasPresaleInput ? 'Đã có' : 'Chưa có'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                            <span className="text-[11px] text-slate-500 font-medium">Duyệt</span>
                            <span className={`text-[11px] font-semibold flex items-center gap-1 ${isQuoteApproved ? 'text-emerald-700' : 'text-slate-500'}`}>
                              <span className={`size-1.5 rounded-full ${isQuoteApproved ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {isQuoteApproved ? 'Đã duyệt' : (hasQuote ? 'Đang duyệt' : '—')}
                            </span>
                          </div>

                          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                            <span className="text-[11px] text-slate-500 font-medium">Khách hàng</span>
                            <span className={`text-[11px] font-semibold flex items-center gap-1 ${isQuoteSent ? 'text-emerald-700' : 'text-slate-500'}`}>
                              <span className={`size-1.5 rounded-full ${isQuoteSent ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {isQuoteSent ? 'Đã gửi' : 'Chưa gửi'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 4. Manager Control (Compact management panel) */}
                      <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs space-y-3 text-xs">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-slate-900 text-xs">Manager control</h3>
                          <button 
                            type="button" 
                            className="text-blue-600 font-semibold text-[11px] hover:underline cursor-pointer"
                            onClick={() => setDealTab('overview')}
                          >
                            Xem chi tiết
                          </button>
                        </div>

                        {/* Mức hoàn thiện */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[11px] font-medium">
                            <span className="text-slate-500">Mức hoàn thiện</span>
                            <span className="font-bold text-slate-800">{completionPercent(currentDisplayDeal)}%</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div 
                              className="bg-[#c2185b] h-full rounded-full transition-all duration-300" 
                              style={{ width: `${completionPercent(currentDisplayDeal)}%` }} 
                            />
                          </div>
                        </div>

                        {/* 2-column key-value metrics */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1 border-t border-slate-100 text-[11px]">
                          <div>
                            <span className="text-slate-400 font-medium block">SLA</span>
                            <span className="font-semibold text-emerald-600">Đúng hạn</span>
                          </div>

                          <div>
                            <span className="text-slate-400 font-medium block">Next action</span>
                            <span className="font-semibold text-slate-800 truncate block">
                              {(currentDisplayDeal as any)?.next_action || (currentDisplayDeal as any)?.next_step || ((currentDisplayDeal as any)?.follow_up_date ? 'Đã có' : 'Chưa có')}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 font-medium block">Presale</span>
                            <span className="font-semibold text-slate-800">
                              {primaryAssigneeId(currentDisplayDeal) ? 'Đã giao' : 'Chưa giao'}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 font-medium block">Last activity</span>
                            <span className="font-semibold text-slate-800">
                              {dealActivities[0]?.created_at ? relativeTime(dealActivities[0].created_at) : 'Vừa xong'}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 font-medium block">Tuổi cơ hội</span>
                            <span className="font-semibold text-slate-800">
                              {Math.max(1, Math.floor((Date.now() - new Date((currentDisplayDeal as any)?.created_at || Date.now()).getTime()) / (1000 * 60 * 60 * 24)))} ngày
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 font-medium block">Risk</span>
                            <span className="font-semibold text-amber-600">
                              {(currentDisplayDeal as any)?.risk_level || (primaryAssigneeId(currentDisplayDeal) ? 'Bình thường' : 'Trung bình')}
                            </span>
                          </div>
                        </div>

                        {/* Bottom action buttons */}
                        <div className="border-t border-slate-100 pt-3 flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-7 text-[11px] border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
                            onClick={() => alert('Đã gửi thông báo nhắc nhở tới Sale owner phụ trách!')}
                          >
                            Nhắc Sale
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 h-7 text-[11px] bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-2xs"
                            onClick={() => setPresaleRequestOpen(true)}
                          >
                            Giao Presale
                          </Button>
                        </div>
                      </div>

                      {/* 7. Yêu cầu Presale (Compact) */}
                      <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-2xs text-xs space-y-2.5">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                            <Briefcase className="size-4 text-[#c2185b]" /> 
                            <span>Yêu cầu Presale</span>
                          </h3>
                          {presaleRequestOpen && (
                            <button type="button" className="text-slate-400 hover:text-slate-600 text-[11px] font-medium" onClick={() => setPresaleRequestOpen(false)}>
                              Thu gọn
                            </button>
                          )}
                        </div>

                        {presaleRequestOpen ? (
                          <div className="space-y-2.5 pt-1">
                            <select className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white" value={presaleRequestForm.target} onChange={e => setPresaleRequestForm(prev => ({ ...prev, target: e.target.value }))}>
                              <option value="">-- Mục tiêu --</option>
                              <option value="Demo + giải pháp">Demo + giải pháp</option>
                              <option value="BOM">Lên BOM/Báo giá</option>
                            </select>

                            <select className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white" value={presaleRequestForm.presaleId} onChange={e => setPresaleRequestForm(prev => ({ ...prev, presaleId: e.target.value }))}>
                              <option value="">-- Chọn Presale --</option>
                              {presaleAssigneeOptions.map(option => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>

                            <input type="date" className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white" value={presaleRequestForm.deadline} onChange={e => setPresaleRequestForm(prev => ({ ...prev, deadline: e.target.value }))} />
                            
                            <div className="flex gap-2 pt-1">
                              <Button size="sm" className="flex-1 h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium" disabled={presaleRequestLoading || !presaleRequestForm.target || !presaleRequestForm.presaleId} onClick={async () => {
                                setPresaleRequestLoading(true);
                                try {
                                  await updateCurrentDeal({
                                    sdr_id: presaleRequestForm.presaleId,
                                    deal_stage: 'requirement',
                                  });
                                  alert('Gửi yêu cầu Presale thành công!');
                                  setPresaleRequestOpen(false);
                                } catch (e) {
                                  alert('Lỗi: ' + (e as Error).message);
                                } finally {
                                  setPresaleRequestLoading(false);
                                }
                              }}>
                                {presaleRequestLoading ? 'Đang gửi...' : 'Gửi yêu cầu'}
                              </Button>
                              <Button size="sm" variant="outline" className="h-8 text-xs border-slate-200" onClick={() => setPresaleRequestOpen(false)}>Hủy</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-slate-400 text-[11px]">Chưa có yêu cầu đang xử lý.</p>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="w-full h-8 text-xs border-dashed border-slate-300 text-slate-700 hover:bg-slate-50 font-medium" 
                              onClick={() => setPresaleRequestOpen(true)}
                            >
                              + Yêu cầu Presale
                            </Button>
                          </div>
                        )}
                      </div>

                    </div>

                  </div>
                )}

                {dealTab === 'products' && (
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-slate-800 text-xs">Giải pháp & sản phẩm</h3>
                      <Button variant="outline" size="sm" className="h-6 text-blue-600 text-[11px] border-blue-200" onClick={() => alert("Chức năng Chọn từ danh mục đang phát triển")}>
                        Chọn từ danh mục
                      </Button>
                    </div>
                    <div className="py-12 text-center text-slate-400 text-xs">Chưa có sản phẩm / giải pháp được gắn.</div>
                  </div>
                )}

                {dealTab === 'quotes' && (
                  <div className="space-y-3">
                    {quotesLoading ? (
                      <div className="flex justify-center p-8"><div className="animate-spin size-6 border-2 border-[#c2185b] border-t-transparent rounded-full"></div></div>
                    ) : dealQuotes.length > 0 ? (
                      <div className="space-y-2.5">
                        {dealQuotes.map((q: any) => {
                          const isApproved = q.status === 'approved' || q.status === 'confirmed' || q.status === 'da_duyet';
                          return (
                            <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 shadow-2xs text-xs">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="size-9 rounded-lg bg-rose-50 border border-rose-100 text-[#c2185b] flex items-center justify-center shrink-0">
                                  <FileText className="size-4.5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-800 flex items-center gap-2 truncate">
                                    <span>{q.quote_number || q.id}</span>
                                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                      q.is_current !== false ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                                    }`}>
                                      V{q.version_number || 1}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">{(currentDisplayDeal as any).company_name || 'Báo giá dịch vụ'}</div>
                                </div>
                              </div>

                              <div className="flex items-center gap-4 shrink-0">
                                <div className="text-right">
                                  <div className="font-bold text-slate-900">{formatVND(q.total_amount)}</div>
                                  <Badge className={`mt-0.5 font-semibold shadow-none rounded text-[10px] ${
                                    isApproved ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                                  }`}>
                                    {isApproved ? 'Đã duyệt' : 'Chờ duyệt'}
                                  </Badge>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <Link href={`/all-platform/crm/quotes/${q.id}?dealId=${encodeURIComponent(currentDisplayDeal.id)}${currentDisplayDeal.customer_id ? `&customerId=${encodeURIComponent(currentDisplayDeal.customer_id)}` : ''}`}>
                                    <Button size="sm" variant="outline" className="h-7 text-xs font-semibold border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer">
                                      Xem chi tiết
                                    </Button>
                                  </Link>
                                  <Link href={`/all-platform/quotes/${q.id}?view=document&dealId=${encodeURIComponent(currentDisplayDeal.id)}${currentDisplayDeal.customer_id ? `&customerId=${encodeURIComponent(currentDisplayDeal.customer_id)}` : ''}`}>
                                    <Button size="sm" variant="outline" className="h-7 text-xs font-medium border-rose-200 text-[#c2185b] hover:bg-rose-50 cursor-pointer">
                                      Mở báo giá
                                    </Button>
                                  </Link>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12 bg-white border border-slate-200 rounded-xl shadow-2xs">
                        <FileText className="size-10 mx-auto mb-3 text-slate-200" />
                        <h3 className="font-semibold text-slate-700 text-xs mb-1">Chưa có báo giá</h3>
                        <p className="text-[11px] text-slate-400 mb-3">Cơ hội này chưa được tạo báo giá nào.</p>
                        <Button size="sm" onClick={() => onCreateQuote?.(currentDisplayDeal.id)} className="bg-[#c2185b] hover:bg-[#a91549] text-white text-xs h-8">Tạo báo giá đầu tiên</Button>
                      </div>
                    )}
                  </div>
                )}

                {dealTab === 'activities' && (
                  <div>
                    {activitiesLoading ? (
                      <div className="flex justify-center p-8"><div className="animate-spin size-6 border-2 border-[#c2185b] border-t-transparent rounded-full"></div></div>
                    ) : dealActivities.length > 0 ? (
                      <div className="space-y-3 bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
                        {dealActivities.map(a => (
                          <div key={a.id} className="relative pl-5 pb-4 border-l border-slate-100 last:border-0 last:pb-0">
                            <div className="absolute -left-1 top-1 size-2 rounded-full bg-blue-500" />
                            <div className="flex justify-between gap-3 text-xs">
                              <span className="font-semibold text-slate-800">{a.action}</span>
                              <span className="text-[10px] font-medium text-slate-400">{formatCrmDateTime(a.created_at)}</span>
                            </div>
                            {(a.from_stage || a.to_stage) ? (
                              <div className="text-[11px] font-medium text-slate-500 mt-0.5">{a.from_stage || '?'} → {a.to_stage || '?'}</div>
                            ) : null}
                            {a.note ? <div className="text-xs text-slate-600 mt-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-100">{a.note}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 text-center py-12 bg-white rounded-xl border border-slate-200 shadow-2xs">
                        <Activity className="size-8 mx-auto mb-2 text-slate-200" />
                        Chưa có hoạt động.
                      </div>
                    )}
                  </div>
                )}

                {dealTab === 'documents' && (
                  <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400 shadow-2xs">
                    <FileText className="size-8 mx-auto mb-2 text-slate-300 stroke-1" />
                    <h3 className="font-bold text-xs text-slate-700">Chưa có tài liệu</h3>
                    <p className="text-[11px] text-slate-400 mt-1">API quản lý tài liệu chưa được triển khai.</p>
                  </div>
                )}

              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
              <Target className="size-12 mb-3 opacity-20" />
              <p className="text-xs font-semibold">Chọn cơ hội để xem chi tiết</p>
            </div>
          )}
        </aside>
      )}

      <StageModal
        open={Boolean(transitionTarget && currentDisplayDeal)}
        deal={currentDisplayDeal ? customerToCrmDeal(currentDisplayDeal) : null}
        toStage={transitionTarget as DealStage}
        loading={transitionLoading}
        onClose={() => setTransitionTarget(null)}
        onSubmit={submitStageTransition}
      />

      {/* CATEGORY PICKER MODAL POPUP matching media_1790531408169.png */}
      <CatalogPickerModal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        showZoneTab={false}
        activeSource={catalogPickerSource}
        onSourceChange={setCatalogPickerSource}
        loading={loadingCatalog}
        items={pickerListItems}
        onAddSelected={handleAddSelectedProducts}
        groupFilterValue={catalogGroupFilter}
        onGroupFilterChange={setCatalogGroupFilter}
      />
    </div>
  );
}

// HMR Touch 1790529193.9477959
