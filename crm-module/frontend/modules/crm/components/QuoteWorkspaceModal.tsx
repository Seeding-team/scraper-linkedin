'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { seedingQuoteRepository, QuoteApprovalRequiresExceptionError, QuoteDocumentRenderer } from '@/modules/quotes';
import type { Quote, QuoteActivityLogEntry, QuoteHandoffChecklist, QuoteItem, QuoteProcessingStage, QuoteApprovalRuleSet, QuoteApprovalRuleType, QuoteRuleEvaluation, QuoteDeliveryLogEntry, QuoteForm } from '@/modules/quotes';
import type { AppUser } from '@/types/unified.types';
import { canApproveQuote, canEditQuoteCost, canEditQuotePricingFields, canWriteDeal, formatMoneyInput, getPackageText, getServicePackageText, SOURCE_OPTIONS, SERVICE_PACKAGE_OPTIONS, CRM_PACKAGE_OPTIONS, INDUSTRY_OPTIONS } from '../constants/crmConfig';
import type { CrmUserOption, Deal, CreateDealInput } from '../types';
import type { ServiceCatalogItem } from '@/modules/service-catalog/types';
import { serviceCatalogRepository } from '@/modules/service-catalog/repositories/ServiceCatalogRepository';
import { priceBookZoneRepository, type PriceBookItem } from '@/modules/service-catalog/repositories/PriceBookZoneRepository';
import { previewPriceBookItem, formatVnd as formatPriceBookVnd, formatPercent as formatPriceBookPercent } from '@/modules/service-catalog/price-book-preview';
import { CatalogPickerModal, type CatalogPickerListItem } from '@/modules/service-catalog/CatalogPickerModal';
import { useCatalogItemAdd } from '@/modules/service-catalog/useCatalogItemAdd';
import { QuickAddProductModal } from '@/modules/service-catalog/QuickAddProductModal';
import { QuickAddGroupModal } from '@/modules/service-catalog/QuickAddGroupModal';
import {
  dealBusinessCode,
  formatDate,
  formatMoney,
  formatPercentTrim,
  initialsOf,
  quoteDisplayStatus,
  relativeTime,
} from '../utils/quoteDisplay';
import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronUp, Eye, GitBranchPlus, History, LayoutGrid, Link2, Plus, Send, Trash2, X } from './icons';
import { usersService, projectsService, allPlatformCategoriesService, type QuoteBusinessRoleUser, type Project } from '@/services/all-platform.service';
import { computeQuoteSla } from '../utils/quoteSla';
import { SearchableSelect } from './SearchableSelect';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import { ProjectFormModal } from './ProjectFormModal';
import { DealFormModal, clearDealDraft } from './DealFormModal';
import { ConfirmModal } from './ConfirmModal';
import { ActionMenu } from './ActionMenu';

/** 4 buoc THAT (Yeu cau bao gia/Thong tin ky thuat/Hoan thien gia ban/Cho
 * duyet-Phat hanh) - anh xa dung 1-1 voi `quotes.processing_stage` (migration
 * 085). KHONG phai Presale/Sale/CEO - he thong chi co Admin/Leader/Member +
 * Team Sale/Dev/MKT that (xem plan da xac nhan). */
const STAGE_ORDER: QuoteProcessingStage[] = ['request', 'technical', 'pricing', 'review'];
const STAGE_LABELS: Record<QuoteProcessingStage, string> = {
  request: 'Yêu cầu báo giá',
  technical: 'Thông tin kỹ thuật',
  pricing: 'Hoàn thiện giá bán',
  review: 'Chờ duyệt',
  // Khong hien nhu 1 step rieng tren stage bar (STAGE_ORDER van dung 4 buoc
  // theo dung HTML) - chi dung lam fallback text khi can, gia tri that hien
  // qua stageLabel() dua tren processingStage/status THAT (migration 087).
  ready_to_publish: 'Đã duyệt · Chưa phát hành',
  published: 'Đã phát hành',
};

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Tạo báo giá',
  updated: 'Cập nhật báo giá',
  approved: 'Duyệt báo giá',
  cancelled: 'Huỷ báo giá',
  version_created: 'Tạo phiên bản mới',
  stage_changed: 'Chuyển bước xử lý',
  handoff_updated: 'Cập nhật bàn giao kỹ thuật',
  owner_assigned: 'Gán người phụ trách',
  version_reason: 'Ghi lý do tạo phiên bản',
  approved_with_exception: 'đã phê duyệt ngoại lệ',
  auto_approved_by_rule_engine: 'Tự động duyệt bởi Rule Engine',
};

/** Section 5 - hien cau tu nhien "<Ten> đã phê duyệt ngoại lệ cho V2 lúc …"
 * cho rieng action nay (khac cach hien chung "<Ten> <nhan>" cua cac action
 * khac) - dung yeu cau audit doc duoc ngay, khong phai 1 dong nhan chung
 * chung. Tra ve PHAN SAU ten (giu nguyen pattern <strong>{ten}</strong>
 * {phan_sau} o noi goi). Fallback ve nhan chung neu thieu
 * changes.versionNumber (du lieu cu truoc migration 102). */
function activityLogTail(entry: QuoteActivityLogEntry): string {
  if (entry.action === 'approved_with_exception') {
    const versionNumber = (entry.changes as { versionNumber?: number } | null)?.versionNumber;
    const at = formatDate(entry.createdAt);
    return versionNumber ? `đã phê duyệt ngoại lệ cho V${versionNumber} lúc ${at}` : `đã phê duyệt ngoại lệ lúc ${at}`;
  }
  return ACTIVITY_LABELS[entry.action] || entry.action;
}

/** Gop cac activity LIEN TIEP cung nguoi + cung loai hanh dong trong 1 cua so
 * thoi gian ngan (5 phut) thanh 1 dong kem "(xN)" - chi gop o TANG HIEN THI,
 * khong dung/sua data goc trong `quote_activity_log` (van con nguyen ven cho
 * moi lan doc lai). Dung cho ca 2 panel Activity trong workspace. */
const ACTIVITY_GROUP_WINDOW_MS = 5 * 60 * 1000;
const ACTIVITY_COLLAPSED_LIMIT = 5;

function groupActivityEntries(entries: QuoteActivityLogEntry[]): Array<{ entry: QuoteActivityLogEntry; count: number }> {
  const out: Array<{ entry: QuoteActivityLogEntry; count: number }> = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (
      last &&
      last.entry.actorId === entry.actorId &&
      last.entry.action === entry.action &&
      Math.abs(new Date(last.entry.createdAt).getTime() - new Date(entry.createdAt).getTime()) <= ACTIVITY_GROUP_WINDOW_MS
    ) {
      last.count += 1;
      continue;
    }
    out.push({ entry, count: 1 });
  }
  return out;
}

/** Empty-state khi chua co ai duoc cau hinh Presale/Sale (quote_business_role) -
 * gon trong 1 dong nho (khong de text dai lam lech header info-row), CTA
 * THAT cho Admin/Leader (link that toi Quan ly thanh vien), chi dan lien he
 * Admin cho Member (khong co quyen tu gan). */
function NoStaffConfigured({ isAdminOrLeader }: { isAdminOrLeader: boolean }) {
  return (
    <span className="qc-no-staff">
      <span className="qc-no-staff-text">Chưa có nhân sự phù hợp.</span>
      {isAdminOrLeader ? (
        <Link href="/all-platform/admin/quan-ly-thanh-vien" className="qc-no-staff-cta">Đi tới Quản lý thành viên</Link>
      ) : (
        <span className="qc-no-staff-cta qc-no-staff-cta--muted">Vui lòng liên hệ Admin.</span>
      )}
    </span>
  );
}

/** So La Ma cho Muc cha (I, II, III...) - dung 1 bang tra don gian, du dung
 * (bang hang muc thuc te chi vai chuc nhom la cung, khong can thuat toan
 * tong quat cho so lon). */
function toRomanNumeral(num: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let n = num;
  let out = '';
  for (const [value, symbol] of table) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out || String(num);
}

/** Bug that da gap ("I. I. Phan mem"): mot so Muc cha (Section) co san du lieu
 * da tu go san so La Ma vao dau ten (vd "I. Phần mềm" go tu Excel/thoi quen
 * cu), trong khi UI moi LUON tu dong ghep them so La Ma tinh theo vi tri
 * (`toRomanNumeral(sectionCounter)`) truoc ten - ghep 2 cai lai thanh lap
 * ("I. I. Phần mềm"). CHI strip dung so La Ma KHOP VOI vi tri hien tai cua
 * chinh no (`expectedRoman`) + dau cham theo sau - KHONG dung regex chung
 * chung moi chuoi bat dau bang chu hoa (se cat nham ten that su bat dau bang
 * chu "I"/"V"/"X"... khong phai so thu tu, vd "Video call"). */
function stripLeadingRomanPrefix(text: string, expectedRoman: string): string {
  const pattern = new RegExp(`^${expectedRoman}\\.\\s*`, 'i');
  return text.replace(pattern, '');
}

function newBlockId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `block_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}


/** Muc cha (Section)/hang muc con - xem migration 104. `itemsDraft` (state
 * edit cua bang hang muc) LUON giu dang PHANG (khong dung cay `children`
 * long nhau) de moi thao tac (them/xoa/nhan ban/doi thu tu/chuyen nhom) chi
 * la 1 phep splice mang don gian, khong phai de quy cay. Cay chi ton tai
 * ngan gon o 2 dau: (1) load() nap `quote.items` (BE tra ve dang cay qua
 * _quote_item_tree) -> lam PHANG ngay de edit; (2) luc gui len BE, gop lai
 * thanh cay dung dinh dang API cu da co san (children long nhau) truoc khi
 * map qua toItemInput(). Section/item lien he nhau qua `parentItemId` (tro
 * toi `id` cua dong section, ke ca id TAM cho section moi tao chua luu). */
function flattenItemTree(items: QuoteItem[]): QuoteItem[] {
  const out: QuoteItem[] = [];
  for (const item of items) {
    const { children, ...rest } = item;
    out.push(rest);
    if (children && children.length) out.push(...flattenItemTree(children));
  }
  return out;
}

function buildItemTree(flat: QuoteItem[]): QuoteItem[] {
  const withChildren = flat.map(item => ({ ...item, children: [] as QuoteItem[] }));
  const byId = new Map<string, QuoteItem & { children: QuoteItem[] }>();
  for (const item of withChildren) {
    if (item.id) byId.set(item.id, item);
  }
  const roots: QuoteItem[] = [];
  for (const item of withChildren) {
    const parent = item.parentItemId ? byId.get(item.parentItemId) : undefined;
    if (parent) parent.children.push(item);
    else roots.push(item);
  }
  return roots;
}

/** Sau MOI lan sap xep lai (keo-tha, di chuyen len/xuong, xoa/them dong) -
 * gan lai `parentItemId` THEO DUNG VI TRI hien tai: 1 hang muc thuoc DUNG
 * Muc cha (Section) gan lien truoc no gan nhat (cho toi khi gap 1 Section
 * khac). Cach lam nay bien "thuoc nhom nao" thanh 1 THUOC TINH SUY RA TU VI
 * TRI, KHONG con phai tu quan ly parentItemId thu cong moi lan di chuyen -
 * tranh ca 1 lop bug "keo xong quen cap nhat nhom" de xay ra neu lam nguoc
 * lai (giu parentItemId co dinh, tu tinh vi tri theo no). */
function recomputeParentIds(items: QuoteItem[]): QuoteItem[] {
  let currentSectionId: string | undefined;
  return items.map(item => {
    if (item.rowType === 'section') {
      currentSectionId = item.id;
      return item;
    }
    return { ...item, parentItemId: currentSectionId };
  });
}

/** [start, end) cua 1 "khoi" bat dau tu `index` - neu la 1 hang muc thuong
 * (rowType='item') thi khoi chi co dung 1 dong; neu la Muc cha (Section) thi
 * khoi gom CA dong Section VA toan bo hang muc con lien tiep ngay sau no
 * (toi khi gap Section tiep theo hoac het mang) - dam bao keo 1 Muc cha se
 * mang theo CA nhom cua no, khong bao gio lam roi hang muc con lai phia sau. */
function getRowBlockRange(items: QuoteItem[], index: number): [number, number] {
  if (items[index]?.rowType !== 'section') return [index, index + 1];
  let end = index + 1;
  while (end < items.length && items[end].rowType !== 'section') end += 1;
  return [index, end];
}

/** Nguoc voi getRowBlockRange (do CHI tinh xuoi) - dung khi can biet khoi
 * LIEN KE PHIA TRUOC bat dau tu dau, cho truong hop "di chuyen len": cho
 * truoc chi so cua DONG CUOI khoi do (`endingAtIndex`), tim dung diem bat
 * dau. Neu dong do thuoc 1 Section (co parentItemId), phai quet NGUOC tim
 * dung dong Section chu no - khong the chi lay [index,index+1) nhu 1 hang
 * muc doc lap, vi nhu vay se "cat doi" 1 Section dang co nhieu hang muc con
 * (bug that da tim thay khi tu trace tay truoc khi port). */
function blockStartEndingAt(items: QuoteItem[], endingAtIndex: number): number {
  const row = items[endingAtIndex];
  if (!row || row.rowType === 'section' || !row.parentItemId) return endingAtIndex;
  for (let i = endingAtIndex; i >= 0; i -= 1) {
    if (items[i].rowType === 'section') return i;
  }
  return endingAtIndex;
}

/** Di chuyen 1 khoi (xem getRowBlockRange) tu vi tri `fromIndex` toi ngay
 * TRUOC `targetIndex` (theo chi so cua mang GOC, truoc khi cat khoi ra) - tu
 * dong gan lai parentItemId theo vi tri moi qua recomputeParentIds(), KHONG
 * can code rieng xu ly tung truong hop "keo hang muc vao 1 nhom"/"keo ca 1
 * nhom di noi khac" nua, vi nhom gio la thuoc tinh suy ra tu vi tri. */
function moveRowBlock(items: QuoteItem[], fromIndex: number, targetIndex: number): QuoteItem[] {
  const [start, end] = getRowBlockRange(items, fromIndex);
  if (targetIndex >= start && targetIndex < end) return items; // tha vao chinh no/con cua no - khong doi gi
  const block = items.slice(start, end);
  const rest = [...items.slice(0, start), ...items.slice(end)];
  let insertAt = targetIndex > start ? targetIndex - (end - start) : targetIndex;
  insertAt = Math.max(0, Math.min(insertAt, rest.length));
  return recomputeParentIds([...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]);
}

const VERSION_REASONS = [
  { value: 'scope_change', label: 'Khách thay đổi scope' },
  { value: 'price_change', label: 'Đổi giá/chiết khấu' },
  { value: 'add_items', label: 'Bổ sung hạng mục' },
  { value: 'other', label: 'Khác' },
];

export function QuoteWorkspaceModal({
  quoteId,
  deals,
  dealsById,
  agents,
  user,
  onClose,
  onChanged,
  onEditDraft,
  defaultFormId,
  quoteForms = [],
  initialCustomerId,
  initialProjectId,
  lockCustomer = false,
  lockProject = false,
}: {
  /** null = che do TAO MOI ("+ Yeu cau ho tro bao gia") - workspace hien day
   * du UI ngay nhung CHUA co record that nao cho toi khi bam Luu nhap/Gui yeu
   * cau xu ly (tranh tao "quote rong" ngay khi mo modal, chi 1 lan bam huy se
   * khong de lai rac trong DB). */
  quoteId: string | null;
  deals: Deal[];
  dealsById: Map<string, Deal>;
  agents: CrmUserOption[];
  user: AppUser | null | undefined;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onEditDraft: (quote: Quote) => void;
  /** Mau bao gia GOI Y mac dinh khi vua mo (uu tien defaultQuoteFormId cua don
   * vi phat hanh, fallback mau isDefaultTemplate - xem QuoteCenterPage) - Sale
   * van doi lai duoc qua dropdown "Mau bao gia" (draftFormId) neu can. */
  defaultFormId?: string;
  /** Danh sach mau bao gia active de hien dropdown "Mau bao gia" o Buoc 1
   * (CHI khi tao moi, quoteId=null) - rong thi an han dropdown, dung nguyen
   * defaultFormId nhu truoc. */
  quoteForms?: QuoteForm[];
  /** Block 1: mo tu nut "Tạo báo giá" o Ho so khach hang/Project card - PHAI
   * THAT SU doc + ap dung (khong chi mang query param roi bo qua). Khach
   * hang/Du an tu dien vao draftCustomerId/draftProjectId ngay khi mo o CHE
   * DO TAO MOI (quoteId=null); lockCustomer/lockProject an dropdown, hien
   * text tinh - CHI ap dung khi quoteId=null. */
  initialCustomerId?: string;
  initialProjectId?: string;
  lockCustomer?: boolean;
  lockProject?: boolean;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(Boolean(quoteId));
  const [activity, setActivity] = useState<QuoteActivityLogEntry[]>([]);
  const [checklist, setChecklist] = useState<QuoteHandoffChecklist | null>(null);
  // Gop Buoc 1+2: cho tick checklist bang giao NGAY tu luc con o Buoc 1 (truoc
  // ca khi quote tu tao xong) - khong duoc de null nua (setChecklistDraft(prev
  // => prev ? {...} : prev) se KHONG lam gi neu prev=null, tick se vo tac
  // dung im lang). Dung 1 object rong lam gia tri khoi tao thay vi null.
  function emptyChecklist(): QuoteHandoffChecklist {
    return {
      quoteId: '',
      scopeConfirmed: false,
      scopeNote: '',
      costConfirmed: false,
      costNote: '',
      timelineConfirmed: false,
      timelineNote: '',
      assumptionConfirmed: false,
      assumptionNote: '',
      handoffNote: '',
    };
  }
  const [checklistDraft, setChecklistDraft] = useState<QuoteHandoffChecklist>(emptyChecklist());
  const [busy, setBusy] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionReason, setVersionReason] = useState(VERSION_REASONS[0].value);
  // Checkpoint D muc 6 - neu chuoi DA CO 1 draft moi hon quote approved dang
  // xem (vd dang xem V2 approved nhung V3 draft da ton tai tu truoc), nut
  // header PHAI ghi "Tiep tuc chinh sua V{n}" va MO THANG draft do, KHONG
  // tao them 1 draft thu 2 (RPC createQuoteVersion() da tu chan viec nay o
  // backend, nhung nut o day phai PHAN ANH DUNG truoc khi bam, khong de
  // nguoi dung bam "Tao phien ban moi" roi bi redirect bat ngo).
  const [existingDraftVersion, setExistingDraftVersion] = useState<Quote | null>(null);
  // Reset scroll ve dau moi lan mo/chuyen quote (bug thuc te da bao: mo quote
  // moi nhung dung giua vung trang cua quote TRUOC do, tao cam giac "man
  // hinh trong" du noi dung THAT su van co o phia tren).
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (workspaceBodyRef.current) workspaceBodyRef.current.scrollTop = 0;
  }, [quote?.id]);
  // Card "Chuẩn bị gửi Presale" (stage 'request') - nut "Bổ sung" nhay THAT
  // toi dung khu vuc con thieu, khong phai link tro suong. Cac field
  // Khach hang/Du an/Co hoi/Presale/Sale/SLA nam trong info-strip CO DINH
  // (ngoai qc-workspace-body cuon duoc) - "nhay" toi cho cac field nay chi
  // can dua body ve dau (info-strip luon hien san, khong bao gio cuon mat).
  function jumpToAnchor(anchor: string) {
    if (anchor === 'top') {
      if (workspaceBodyRef.current) workspaceBodyRef.current.scrollTop = 0;
      return;
    }
    const el = workspaceBodyRef.current?.querySelector(`[data-qc-anchor="${anchor}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Che do tao moi - toan bo state duoi day chi LOCAL (chua ghi DB) cho toi
  // khi tao record that (createRequest). Khach hang (crm_customers, ho so
  // rieng biet) va Co hoi CRM (Deal) la 2 THUC THE THAT KHAC NHAU trong DB
  // (deal.customerId tro toi 1 crm_customers, co the null) - chon rieng tung
  // cai, KHONG suy quan ly/team tu khach hang (chi Deal moi mang assignment/
  // team that). Quote chi luu duoc deal_id (khong co cot customer_id rieng)
  // nen Khach hang o day chi dung de LOC danh sach Co hoi cho de tim, gia tri
  // THAT su duoc ghi la draftDealId.
  const [draftCustomerId, setDraftCustomerId] = useState(initialCustomerId || '');
  const [customers, setCustomers] = useState<
    { id: string; label: string; name?: string; companyName?: string; phone?: string; email?: string; address?: string; taxCode?: string }[]
  >([]);
  const [draftDealId, setDraftDealId] = useState('');
  // "+ Tạo cơ hội mới" ngay trong dropdown - BUG THAT DA GAP (gap that su,
  // khong phai gia dinh): khach hang chua co Cơ hội nao thi dropdown chi
  // hien "Không tìm thấy", bat nguoi dung THOAT KHOI form dang dien de di
  // tao Co hoi o cho khac roi quay lai tu dau - mat het du lieu dang go
  // (Hạng mục/scope...). `deals`/`dealsById` la PROP tu component cha
  // (QuoteCenterPage/CrmCustomerDetailPage), khong the goi API cha refetch
  // tu day - luu Co hoi vua tao THEM vao 1 state local, GOP voi prop that
  // moi noi can doc (xem effectiveDeals/effectiveDealsById ben duoi) de hien
  // ngay khong can cho cha tai lai.
  const [locallyCreatedDeals, setLocallyCreatedDeals] = useState<Deal[]>([]);
  const effectiveDeals = useMemo(
    () => (locallyCreatedDeals.length ? [...deals, ...locallyCreatedDeals] : deals),
    [deals, locallyCreatedDeals]
  );
  const effectiveDealsById = useMemo(() => {
    if (!locallyCreatedDeals.length) return dealsById;
    const map = new Map(dealsById);
    locallyCreatedDeals.forEach(d => map.set(d.id, d));
    return map;
  }, [dealsById, locallyCreatedDeals]);
  const CREATE_NEW_DEAL_OPTION = '__create_new_deal__';
  const CREATE_NEW_PROJECT_OPTION = '__create_new_project__';
  // "Tạo dự án mới"/"Tạo cơ hội mới" nhanh ngay trong workspace - tái dùng
  // dung 2 component chuan hoa da co cho toan he thong (ProjectFormModal,
  // DealFormModal) thay vi 1 form rieng tu viet - vua dam bao du field
  // (nguoi phu trach, gia tri du kien, next step...) vua khong tao code
  // trung lap. `agents` chi can fetch 1 lan cho ca 2 modal nay dung chung.
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [dealModalOpen, setDealModalOpen] = useState(false);
  const [dealCreateBusy, setDealCreateBusy] = useState(false);
  const [dealCreateError, setDealCreateError] = useState('');
  const [quickCreateAgents, setQuickCreateAgents] = useState<CrmUserOption[]>([]);
  useEffect(() => {
    void seedingCrmRepository.getAgents().then(setQuickCreateAgents).catch(() => setQuickCreateAgents([]));
  }, []);

  async function handleCreateQuickDeal(input: CreateDealInput) {
    setDealCreateBusy(true);
    setDealCreateError('');
    try {
      const created = await seedingCrmRepository.createDeal(input);
      clearDealDraft();
      setLocallyCreatedDeals(prev => [...prev, created]);
      setDraftDealId(created.id);
      if (created.projectId) setDraftProjectId(created.projectId);
      setDealModalOpen(false);
    } catch (err) {
      setDealCreateError(err instanceof Error ? err.message : 'Không tạo được cơ hội.');
    } finally {
      setDealCreateBusy(false);
    }
  }
  // "Mau bao gia" - Sale duoc doi lai mau goi y mac dinh (defaultFormId) qua
  // dropdown rieng, CHI o che do tao moi (quoteId=null). '' = chua co goi y
  // nao (dang cho fetch defaultFormId) - fallback ve defaultFormId luc gui.
  const [draftFormId, setDraftFormId] = useState('');
  useEffect(() => {
    if (defaultFormId) setDraftFormId(prev => prev || defaultFormId);
  }, [defaultFormId]);
  // Du an that (migration 097) - lay theo dung khach hang (draftCustomerId),
  // KHONG theo Co hoi (1 Du an co nhieu Co hoi). "" = "Chua thuoc du an".
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [draftProjectId, setDraftProjectId] = useState(initialProjectId || '');
  // SLA / han hoan tat noi bo that (migration 097) - datetime-local string,
  // KHAC HOAN TOAN validUntil (hieu luc bao gia voi khach hang).
  const [draftSlaDueAt, setDraftSlaDueAt] = useState('');
  // "Loai bao gia" (migration 112) - phai chon duoc TU BUOC 1 (truoc khi
  // quote that ton tai), mirror dung pattern draftSlaDueAt/draftProjectId.
  const [draftQuoteTypeCodes, setDraftQuoteTypeCodes] = useState<string[]>([]);
  const [quoteTypeOptions, setQuoteTypeOptions] = useState<{ value: string; label: string }[]>([]);
  const [quoteTypeDropdownOpen, setQuoteTypeDropdownOpen] = useState(false);
  const [quoteTypeSearch, setQuoteTypeSearch] = useState('');
  useEffect(() => {
    let alive = true;
    allPlatformCategoriesService
      .getAll('crm_quote_type', { activeOnly: true })
      .then(res => {
        if (alive) setQuoteTypeOptions((res.data || []).map(c => ({ value: c.code, label: c.name || c.code })));
      })
      .catch(() => {
        if (alive) setQuoteTypeOptions([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  // BUG THAT DA GAP ("bấm nó k hiện tick luôn"): truoc day checkbox controlled
  // THANG theo quote.quoteTypeCodes (du lieu server) - luu lai la 1 request
  // async, nen ngay khi bam, React render lai TRUOC khi request kip xong, ep
  // checkbox ve lai trang thai cu (server chua doi), nhin nhu bam khong an
  // thua gi ca. Fix: dong bo draftQuoteTypeCodes tu quote MOI LOAD/DOI (effect
  // duoi day), roi luon doc/ghi qua state LOCAL nay (optimistic) - luu xuong
  // server chay NGAM phia sau, khong con cho round-trip moi thay doi UI.
  useEffect(() => {
    setDraftQuoteTypeCodes(quote?.quoteTypeCodes || []);
  }, [quote?.id]);
  const currentQuoteTypeCodes = draftQuoteTypeCodes;
  function toggleQuoteTypeCode(code: string) {
    const set = new Set(currentQuoteTypeCodes);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    const next = [...set];
    setDraftQuoteTypeCodes(next);
    if (quote) void persistQuote({ quoteTypeCodes: next }, { silent: true });
  }
  function quoteTypeLabel(code: string): string {
    return quoteTypeOptions.find(o => o.value === code)?.label || code;
  }
  const [draftTitle, setDraftTitle] = useState('');
  const [draftScope, setDraftScope] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftExpectedProducts, setDraftExpectedProducts] = useState('');
  const [draftInternalNote, setDraftInternalNote] = useState('');
  const [autofillMessage, setAutofillMessage] = useState('');
  const [draftTechnicalOwnerId, setDraftTechnicalOwnerId] = useState('');
  const [draftQuoteOwnerId, setDraftQuoteOwnerId] = useState('');
  // Che do tao moi (chua co quote.id that) - dieu khoan thanh toan/CK tong
  // van phai nhap duoc NGAY, luu tam local roi gop vao data.customBlocks
  // that luc tao quote (createRequest) - KHONG doi thanh 1 luong luu rieng
  // thu 2.
  const [draftPaymentTermsDays, setDraftPaymentTermsDays] = useState('30');
  const [draftExtraTerms, setDraftExtraTerms] = useState<{ id: string; title: string; content: string }[]>([]);
  const [recentDealQuote, setRecentDealQuote] = useState<Quote | null>(null);
  // "Chon tu danh muc" - lay THANG tu CRM -> San pham & dich vu (dung
  // serviceCatalogRepository.list(), CHINH LA repository ma man "Mau bao
  // gia" (QuoteFormBuilderPage) dang dung) - KHONG con phu thuoc
  // quote_form_catalog_links, khong con bao "mau chua lien ket danh muc".
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogTree, setCatalogTree] = useState<ServiceCatalogItem[] | null>(null);
  // quote?.id (hoac null luc dang tao moi) tai THOI DIEM fetch catalogTree
  // gan nhat - dung de biet co can fetch LAI hay khong khi quote chuyen tu
  // "chua co" sang "da luu that" (xem openCatalogPicker()).
  const [catalogTreeQuoteId, setCatalogTreeQuoteId] = useState<string | null>(null);
  // "Tạo nhanh sản phẩm/nhóm sản phẩm ngay trong popup chọn từ danh mục" +
  // "Nhận biết hạng mục đã có trong Sản phẩm & dịch vụ" (2 yeu cau dung
  // CHUNG QuickAddProductModal - xem file rieng). `quickAddProductTarget`
  // phan biet 2 luong gọi: 'newRow' (nut "+ Sản phẩm mới" trong popup Chọn
  // tu danh muc - san pham tao xong THEM THANH 1 DONG MOI trong bao gia) vs
  // { linkIndex } (bam dau "+" canh 1 hang muc da co san trong bao gia -
  // san pham tao xong CHI GAN ID nguoc lai dong do, KHONG tao dong moi).
  const [quickAddProductTarget, setQuickAddProductTarget] = useState<'newRow' | { linkIndex: number; locked?: boolean } | null>(null);
  // BUG THAT DA GAP ("tự động thêm thẳng vào báo giá ngay sau khi lưu sản
  // phẩm"): luong 'newRow' TRUOC DAY tu goi catalogAdd.handleAddSelected()
  // ngay sau khi tao xong - sai vi Sale co the tao nham hoac muon tao nhieu
  // san pham TRUOC KHI ap dung. Dung luong: chi luu id vua tao vao day, Picker
  // (van dang mo) se TU TICH CHON no (xem prop autoSelectId cua
  // CatalogPickerModal) - Sale tu kiem tra roi bam "+ Thêm vào báo giá" nhu
  // binh thuong, KHONG con dong nao tu dong them dong vao bao gia nua.
  const [autoSelectCatalogItemId, setAutoSelectCatalogItemId] = useState<string | null>(null);
  const [quickAddGroupOpen, setQuickAddGroupOpen] = useState(false);
  const [pickerGroupFilter, setPickerGroupFilter] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTargetSectionId, setCatalogTargetSectionId] = useState('');
  // "+" rieng tren TUNG dong hang muc (yeu cau rieng "thao tác thêm hạng
  // mục") - chen NGAY SAU dung dong do (khac voi catalogTargetSectionId chi
  // dam bao "cuoi 1 Muc cha"). Uu tien HON catalogTargetSectionId trong
  // addItemsFromCatalog() khi ca 2 cung duoc set - xem ham do.
  const [catalogInsertAfterIndex, setCatalogInsertAfterIndex] = useState<number | null>(null);
  // "Batch" cac hang muc vua chon nhieu tu Danh muc cung 1 luc (yeu cau rieng
  // "đánh dấu là một batch và giữ trạng thái được chọn... nhập Giá vốn ở
  // dòng đầu tiên -> auto fill cùng Giá vốn cho cả batch") - chi la trang
  // thai CUC BO o Workspace (khong luu DB, khong can ton tai qua lan tai
  // lai), reset moi khi them 1 batch MOI (thay the batch cu, khong cong don).
  const [costBatchIds, setCostBatchIds] = useState<string[]>([]);
  const [zoneAdding, setZoneAdding] = useState(false);
  // Bang gia VPS Zone (migration 106) - nguon THU 2 song song voi danh muc
  // noi bo hien co, KHONG doi luong cu. `catalogSource` chi anh huong modal
  // "Chon tu danh muc" dang mo - chua co du lieu Zone (issuer khac SecurityZone)
  // thi list rong, khong loi.
  const [catalogSource, setCatalogSource] = useState<'internal' | 'zone'>('internal');
  const [priceBookItems, setPriceBookItems] = useState<PriceBookItem[] | null>(null);
  const [priceBookLoading, setPriceBookLoading] = useState(false);
  // "Chi tiet gia" drawer - chi mo cho dong co priceBookItemId (Zone), doc
  // TU priceBookSnapshot da dong cung tren chinh dong do, KHONG goi lai API
  // price book goc (dung nguyen tac an bien cua snapshot).
  const [priceBookDrawerIndex, setPriceBookDrawerIndex] = useState<number | null>(null);
  // Drawer "Chi tiet hang muc" CHUNG (yeu cau chung, khong rieng nguon nao) -
  // mo cho MOI dong hang muc (nhap tay/catalog/Zone), khac priceBookDrawerIndex
  // o tren (CHI danh cho dong Zone, hien cong thuc gia). Dung khi ten hang muc
  // bi cat ngan trong bang (nhieu cot), xem toan bo + sua field co quyen.
  const [itemDetailDrawerIndex, setItemDetailDrawerIndex] = useState<number | null>(null);
  // Snapshot dong tai THOI DIEM mo drawer - dung de HUY sua doi neu nguoi
  // dung dong (X/"Đóng") ma KHONG bam "Lưu" (bug that da gap: sua nham gia
  // tri roi bam X, blur cua input tu dong fire TRUOC khi modal dong, khien
  // persistQuote() im lang chay va luu nham gia tri sai - gio inputs trong
  // drawer nay KHONG con tu luu qua onBlur nua, chi luu that khi bam "Lưu"
  // ro rang; dong khong luu se phuc hoi lai dung snapshot nay).
  const [itemDetailDrawerSnapshot, setItemDetailDrawerSnapshot] = useState<QuoteItem | null>(null);
  const [costOverrideModal, setCostOverrideModal] = useState<{ index: number; reason: string } | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  // Section 5 - Admin duyet ngoai le theo version: modal RIENG, chi mo khi
  // backend tra "quote_requires_exception_reason" (Rule Engine gan nhat
  // result != 'pass'). evaluation = snapshot ket qua rule de hien ro dang
  // chan vi ly do gi (khong bat nguoi dung tu doan).
  const [exceptionApprovalModal, setExceptionApprovalModal] = useState<{
    open: boolean;
    reason: string;
    evaluation: { result?: string; details?: unknown } | null;
  }>({ open: false, reason: '', evaluation: null });
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [requestChangesModalOpen, setRequestChangesModalOpen] = useState(false);
  const [requestChangesSection, setRequestChangesSection] = useState<'technical' | 'pricing'>('pricing');
  const [requestChangesReason, setRequestChangesReason] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientSource, setSendRecipientSource] = useState<string | null>(null);
  const [sendSubject, setSendSubject] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendAttachPdf, setSendAttachPdf] = useState(false);
  const [sendAvailability, setSendAvailability] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState('');
  // "Xem lich su gui" (Checkpoint D, phase Da phat hanh/Da gui) - repository
  // + backend da co san (get_quote_delivery_log/getQuoteDeliveryLog) nhung
  // CHUA co UI nao dung toi - bo sung modal + nut footer that.
  const [deliveryLogModal, setDeliveryLogModal] = useState<{ open: boolean; loading: boolean; entries: QuoteDeliveryLogEntry[]; error: string | null }>({
    open: false, loading: false, entries: [], error: null,
  });

  // ── Rule engine duyet bao gia (migration 091) - CHI CON HIEN THI o day (xem
  // card "Quy tắc phê duyệt" ben duoi); sua that chuyen sang trang rieng
  // "Cài đặt báo giá" (components/all-platform/admin/QuoteApprovalRuleSettings.tsx,
  // menu Quan ly CRM) - khong con modal sua ngay trong workspace nay nua. ──
  const [ruleSet, setRuleSet] = useState<QuoteApprovalRuleSet | null>(null);
  const [ruleSetLoaded, setRuleSetLoaded] = useState(false);
  const [ruleEvaluation, setRuleEvaluation] = useState<QuoteRuleEvaluation | null>(null);

  // ── Owner-picker Presale/Sale (migration 095) - THAY the "agents" cu (chi
  // admin/leader, dung cho gan SDR/quan ly Deal CRM, KHONG dung cho owner
  // bao gia) bang 2 danh sach rieng loc theo quote_business_role that. ────
  const [presaleUsers, setPresaleUsers] = useState<QuoteBusinessRoleUser[] | null>(null);
  const [saleUsers, setSaleUsers] = useState<QuoteBusinessRoleUser[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    usersService.getUsersByQuoteBusinessRole('presale').then(res => {
      if (!cancelled) setPresaleUsers(res.success ? (res.data || []) : []);
    }).catch(() => { if (!cancelled) setPresaleUsers([]); });
    usersService.getUsersByQuoteBusinessRole('sale').then(res => {
      if (!cancelled) setSaleUsers(res.success ? (res.data || []) : []);
    }).catch(() => { if (!cancelled) setSaleUsers([]); });
    return () => { cancelled = true; };
  }, []);

  // Nguoi tao la Sale/Both -> mac dinh gan CHINH HO lam quote_owner_id o
  // create-mode (dung yeu cau "Neu nguoi tao la Sale/Both va co quyen, co
  // the mac dinh gan chinh nguoi tao") - CHI khi chua co quote that va chua
  // tu chon ai khac, van cho phep chon lai binh thuong.
  useEffect(() => {
    if (quote || draftQuoteOwnerId || !saleUsers || !user?.id) return;
    if (saleUsers.some(u => u.id === user.id)) {
      setDraftQuoteOwnerId(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleUsers, user?.id, quote]);

  // Tuong tu Sale o tren - nguoi tao la Presale/Both -> mac dinh gan CHINH
  // HO lam technical_owner_id (Presale) o create-mode, khong bat tu chon lai
  // tu dau (bug/thieu sot that da gap: chi Sale duoc tu gan, Presale luon
  // "Chua gan" du nguoi dang login chinh la Presale).
  useEffect(() => {
    if (quote || draftTechnicalOwnerId || !presaleUsers || !user?.id) return;
    if (presaleUsers.some(u => u.id === user.id)) {
      setDraftTechnicalOwnerId(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presaleUsers, user?.id, quote]);

  function businessRoleLabel(role?: string | null): string {
    if (role === 'presale') return 'Presale';
    if (role === 'sale') return 'Sale';
    if (role === 'both') return 'Presale & Sale';
    return '';
  }
  function systemRoleLabel(role?: string): string {
    if (role === 'admin') return 'Admin';
    if (role === 'leader') return 'Leader';
    return 'Member';
  }
  function ownerOptionLabel(u: QuoteBusinessRoleUser): string {
    const parts = [u.name, systemRoleLabel(u.role), businessRoleLabel(u.quote_business_role)].filter(Boolean);
    return parts.join(' · ');
  }
  // Ten hien thi cho 1 owner id DA GAN - phai tim ca trong danh sach
  // presale/sale (khong chi "agents" cu) de nguoi da gan truoc do (vd tung
  // la Presale nhung Admin vua bo gan business role) van hien dung TEN, KHONG
  // hien "Không rõ"/"undefined".
  const businessRoleUsersById = useMemo(() => {
    const map = new Map<string, QuoteBusinessRoleUser>();
    for (const u of presaleUsers || []) map.set(u.id, u);
    for (const u of saleUsers || []) map.set(u.id, u);
    return map;
  }, [presaleUsers, saleUsers]);
  function ownerNameFor(id?: string | null): string {
    if (!id) return 'Chưa gán';
    if (id === user?.id && user?.name) return user.name;
    const found = businessRoleUsersById.get(id);
    if (found) return ownerOptionLabel(found);
    return agentsById.get(id) || 'Không rõ (đã bỏ vai trò báo giá)';
  }
  // `action` tuy chon - yeu cau rieng "cho + sp và dv ở đâu luôn bro nếu
  // quên sao": toast bao "Báo giá đã khoá..." truoc day CHI la text, nguoi
  // dung phai tu nho di bam "Tạo phiên bản mới" o dau khac - gio toast co
  // luon 1 nut hanh dong ngay tai cho, bam la mo thang luong tao phien ban
  // (KHONG chi huong dan suong). Tham so tuy chon nen KHONG anh huong cac
  // showToast(...) khac dang khong truyen action.
  const [workspaceToast, setWorkspaceToast] = useState<{ ok: boolean; text: string; action?: { label: string; onClick: () => void } } | null>(null);

  function showToast(ok: boolean, text: string, action?: { label: string; onClick: () => void }) {
    setWorkspaceToast({ ok, text, action });
    window.setTimeout(() => setWorkspaceToast(null), action ? 8000 : 4000);
  }

  // Nhan biet CU THE nut nao dang chay (khong dung chung 1 boolean `busy` mo
  // ho cho MOI nut - bug de gap: nhieu nut cung disable/spinner nhung khong
  // ro dang cho hanh dong nao, nguoi dung khong biet dang cho gi). Cac ham
  // async lien quan gan/xoa key nay quanh setBusy(true)/false.
  type WorkspaceAction = 'draftSave' | 'handoff' | 'reviewPricing' | 'requestChanges' | 'approve' | 'publish' | 'send';
  const ACTION_LOADING_LABELS: Record<WorkspaceAction, string> = {
    draftSave: 'Đang lưu…',
    handoff: 'Đang lưu và bàn giao…',
    reviewPricing: 'Đang gửi duyệt…',
    requestChanges: 'Đang gửi yêu cầu…',
    approve: 'Đang duyệt…',
    publish: 'Đang phát hành…',
    send: 'Đang gửi…',
  };
  const [activeAction, setActiveAction] = useState<WorkspaceAction | null>(null);
  /** Noi dung nut khi dang chay: spinner nho + chu mo ta (khong bao gio chi
   * hien spinner tron - accessibility, nguoi dung phai biet dang cho gi). */
  function actionButtonContent(key: WorkspaceAction, idleContent: React.ReactNode) {
    if (busy && activeAction === key) {
      return (
        <>
          <span className="qc-btn-spinner" aria-hidden="true" />
          {ACTION_LOADING_LABELS[key]}
        </>
      );
    }
    return idleContent;
  }

  // Bo quy tac active - doc 1 lan (khong phu thuoc quote - "Create mode chua
  // co du lieu van phai render card").
  useEffect(() => {
    let cancelled = false;
    seedingQuoteRepository.getActiveQuoteApprovalRuleSet().then(result => {
      if (!cancelled) setRuleSet(result);
    }).catch(() => {
      if (!cancelled) setRuleSet(null);
    }).finally(() => {
      if (!cancelled) setRuleSetLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Danh gia LAI THAT moi lan bao gia thay doi (khong chi doc snapshot cu -
  // neu khong, card se hien "Chua co du lieu" ngay ca khi bao gia da co day
  // du gia von/gia ban, vi CHUA CO lan danh gia nao duoc luu tu truoc toi
  // gio - danh gia chi tung chay tu dong luc "Hoan tat phan gia ban"). Goi
  // evaluate-rules() de vua tinh LAI so that vua luu snapshot moi, thay vi
  // cho toi luc chuyen buoc.
  useEffect(() => {
    if (!quote?.id) {
      setRuleEvaluation(null);
      return;
    }
    let cancelled = false;
    seedingQuoteRepository.evaluateQuoteRules(quote.id).then(result => {
      if (!cancelled) setRuleEvaluation(result);
    }).catch(() => {
      if (!cancelled) setRuleEvaluation(null);
    });
    return () => { cancelled = true; };
  }, [quote?.id, quote?.updatedAt]);

  const RULE_LABELS: Record<QuoteApprovalRuleType, { label: string; description: string; unit: string }> = {
    gross_margin_percent: { label: 'Gross margin tối thiểu', description: 'Margin = (Giá sau CK − Cost) / Giá sau CK.', unit: '%' },
    gross_profit_amount: { label: 'Lợi nhuận gộp tối thiểu', description: 'Giá bán sau chiết khấu phải tạo đủ gross profit.', unit: 'đ' },
    discount_percent: { label: 'Chiết khấu thương mại tối đa', description: 'Vượt ngưỡng phải chuyển người có quyền duyệt.', unit: '%' },
    payment_terms_days: { label: 'Thời hạn thanh toán tối đa', description: 'Điều khoản dài hơn ngưỡng được xem là ngoại lệ.', unit: 'ngày' },
  };

  // Bang "Hang muc & cau truc gia" - state edit LOCAL, dong bo lai tu
  // quote.items moi lan quote thay doi (sau khi load/luu). Luu that qua
  // updateQuote() - RPC quote_update XOA HET roi CHEN LAI toan bo item moi
  // lan goi (khong phai partial update) nen MOI LAN luu deu phai gui DU CA
  // data LAN items hien tai, neu khong se VO TINH XOA SACH item/data con lai
  // (bug thuc te phat hien khi doc lai RPC, khong phai gia dinh).
  const [itemsDraft, setItemsDraft] = useState<QuoteItem[]>([]);
  useEffect(() => {
    setItemsDraft(quote?.items ? flattenItemTree(quote.items) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  // Kiem tra kenh gui email san sang hay chua - CHI goi khi bao gia da
  // duyet+phat hanh (dung dieu kien "Chua duyet"/"Chua phat hanh" da du de
  // disable nut roi, khong can goi API som hon). Endpoint nay khong doi hoi
  // quyen Admin/Leader - bat ky ai duoc GUI bao gia nay deu goi duoc (xem
  // /quotes/{id}/send-availability).
  useEffect(() => {
    if (!quote || quote.status !== 'approved' || quote.processingStage !== 'published' || !quote.publicEnabled) {
      setSendAvailability(null);
      return;
    }
    let cancelled = false;
    seedingQuoteRepository.getQuoteSendAvailability(quote.id).then(result => {
      if (!cancelled) setSendAvailability(result);
    }).catch(() => {
      if (!cancelled) setSendAvailability({ available: false, reason: 'Không kiểm tra được kênh gửi email.' });
    });
    return () => { cancelled = true; };
  }, [quote?.id, quote?.status, quote?.processingStage, quote?.publicEnabled]);

  function updateRow(index: number, patch: Partial<QuoteItem>) {
    setItemsDraft(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // Ca 3 handler duoi day PHAI khong bao gio tao ra NaN/Infinity du nguoi
  // dung nhap ky tu la, so am hay de trong - dung Number.isFinite() thay vi
  // `Number(raw) || 0` (KHONG du: NaN||0 tinh cờ ve 0 dung, nhung Math.max(0,
  // NaN) van tra ve NaN - da xac nhan bug that qua test yeu cau, khong phai
  // gia dinh).
  function toSafeNonNegative(raw: string): number | null {
    // Strip dau cham ngan nghin (nguoi dung go "1.500.000") truoc khi parse -
    // Number("1.500.000") se ra NaN neu khong strip.
    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (!digitsOnly) return null;
    const parsed = Number(digitsOnly);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, parsed);
  }

  function applyCostToRow(row: QuoteItem, cost: number | null): QuoteItem {
    if (cost === null) return { ...row, costPrice: null, markupPercent: null };
    // BUG that da fix: truoc day markup mac dinh ve 0 khi chua dat, khien
    // Gia khach TU DONG nhay bang dung Gia von moi nhap (Sale chua he
    // dong vao Gia khach). CHI tinh lai unitPrice khi markup DA duoc dat
    // ro rang (khac null) - giu nguyen Gia khach neu markup chua xac dinh.
    // Chot lai them: CHI tu tinh lai unitPrice (Gia khach) khi nguoi dang
    // sua THAT SU co quyen pricing (canEditPricingCells) - Presale (chi co
    // quyen Cost, khong co quyen Pricing) sua Gia von KHONG duoc phep lam
    // Gia khach am tham doi theo, du markup dong do da co san tu truoc.
    if (row.markupPercent == null || !canEditPricingCells) {
      return { ...row, costPrice: cost, costNotApplicable: false };
    }
    return { ...row, costPrice: cost, costNotApplicable: false, unitPrice: cost * (1 + row.markupPercent / 100) };
  }

  // CHOT LAI LAN 2 ("Bỏ tự động lan Giá vốn từ dòng đầu"): TRUOC day nhap
  // Gia von o dong DAU TIEN cua 1 batch vua them se tu dong lan sang cac
  // dong con lai (dung 1 lan). Yeu cau ro rang lan nay: BO HOAN TOAN hanh vi
  // tu dong lan, KE CA lan nhap dau tien - sua/nhap Gia von o BAT KY dong
  // nao CHI doi dung dong do, khong bao gio tu dong anh huong dong khac.
  // Muon dien nhieu dong PHAI chu dong bam icon "Điền xuống" (xem
  // fillDownTargets/applyFillDown/fillDownUndo ben duoi) - tach biet hoan
  // toan 2 co che, khong con "1 lan tu dong + Dien xuong thu cong" nhu truoc.
  function handleCostPriceChange(index: number, raw: string) {
    const cost = toSafeNonNegative(raw);
    setItemsDraft(prev => prev.map((r, i) => (i === index ? applyCostToRow(r, cost) : r)));
  }

  function handleCostPriceBlur() {
    void persistQuote({}, { silent: true });
  }

  // Tick "Khong ap dung gia von" xoa luon costPrice/markupPercent dang co -
  // 2 trang thai nay khong duoc cung ton tai (tranh vua co gia von vua danh
  // dau khong ap dung, vo nghia va se bi RPC ep ve NULL/false phia server
  // (migration 090) neu lo gui len).
  function handleCostNotApplicableChange(index: number, checked: boolean) {
    setItemsDraft(prev =>
      prev.map((row, i) => (i === index ? { ...row, costNotApplicable: checked, costPrice: checked ? null : row.costPrice, markupPercent: checked ? null : row.markupPercent } : row))
    );
  }

  /** Override Gia von cho dong nguon Bang gia VPS Zone (muc 13 yeu cau) - PHAI
   * co ly do, luu gia cu/moi/nguoi sua/thoi gian. CHI dung cho dong co
   * priceBookItemId (dong danh muc noi bo khong co khai niem "gia chuan" de
   * so sanh, khong can luong nay). KHONG goi API Bang gia VPS Zone - chi sua
   * dong quote_items hien tai (dung nguyen tac snapshot bat bien). */
  function applyCostOverride(index: number, newCost: number, reason: string) {
    setItemsDraft(prev =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const original = row.costPriceOriginal ?? row.costPrice ?? null;
        return {
          ...row,
          costPriceOriginal: original,
          costPrice: newCost,
          costOverrideReason: reason,
          costOverrideBy: user?.id || null,
          costOverrideAt: new Date().toISOString(),
        };
      })
    );
    setCostOverrideModal(null);
    if (quote) void persistQuote({}, { silent: true });
  }

  function restoreCostFormula(index: number) {
    setItemsDraft(prev =>
      prev.map((row, i) =>
        i === index
          ? { ...row, costPrice: row.costPriceOriginal ?? row.costPrice, costPriceOriginal: null, costOverrideReason: null, costOverrideBy: null, costOverrideAt: null }
          : row
      )
    );
    if (quote) void persistQuote({}, { silent: true });
  }

  function handleMarkupChange(index: number, raw: string) {
    setItemsDraft(prev =>
      prev.map((row, i) => {
        if (i !== index || row.costPrice == null) return row;
        if (raw.trim() === '') return { ...row, markupPercent: 0, unitPrice: row.costPrice };
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return row;
        // Markup < -100% se cho ra gia am - kep san o -100 (gia khach toi
        // thieu = 0, khong the thap hon gia von).
        const markup = Math.max(-100, parsed);
        return { ...row, markupPercent: markup, unitPrice: row.costPrice * (1 + markup / 100) };
      })
    );
  }

  function handleUnitPriceChange(index: number, raw: string) {
    const price = toSafeNonNegative(raw) ?? 0;
    setItemsDraft(prev =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (row.costPrice == null || row.costPrice <= 0) return { ...row, unitPrice: price };
        return { ...row, unitPrice: price, markupPercent: ((price - row.costPrice) / row.costPrice) * 100 };
      })
    );
  }

  // "Dien xuong" Gia von/Markup (yeu cau chung - KHONG phai autofill tu danh
  // muc, huong do da bi huy). Pham vi = cac dong LIEN TIEP ngay sau `index`
  // co CUNG parentItemId voi dong nguon - dung dung bat bien ma
  // recomputeParentIds() da giu xuyen suot (parentItemId luon suy tu vi tri,
  // Muc cha gan truoc no gan nhat), nen chi can dung lai khi gap 1 Section
  // hoac 1 parentItemId khac. Muc cha (rowType==='section') khong bao gio
  // duoc chon lam dong nguon/dich.
  type FillDownMode = 'empty' | 'all';
  const [fillDownConfirm, setFillDownConfirm] = useState<
    { index: number; field: 'costPrice' | 'markupPercent'; targetIndices: number[]; mode: FillDownMode } | null
  >(null);
  // "Sau khi áp dụng phải có toast thông báo và Undo" - snapshot TOAN BO
  // itemsDraft truoc khi ap dung fill-down, cho phep hoan tac dung 1 lan gan
  // nhat (khong phai stack nhieu buoc). Doc lap hoan toan voi co che autofill
  // tu dong da BI BO o tren - day CHI kich hoat khi nguoi dung CHU DONG bam
  // "Điền xuống", khong bao gio tu chay.
  const [fillDownUndo, setFillDownUndo] = useState<{ items: QuoteItem[]; message: string } | null>(null);

  // Pham vi "hang muc con" - chi cac dong LIEN TIEP ngay sau `index` cung
  // parentItemId (dung Section lam ranh gioi). Muc cha (rowType==='section')
  // khong bao gio duoc chon lam dong nguon/dich.
  function fillDownTargets(index: number): number[] {
    const source = itemsDraft[index];
    if (!source || source.rowType === 'section') return [];
    const targets: number[] = [];
    for (let i = index + 1; i < itemsDraft.length; i++) {
      const row = itemsDraft[i];
      if (row.rowType === 'section') break;
      if (row.parentItemId !== source.parentItemId) break;
      targets.push(i);
    }
    return targets;
  }

  // "Chỉ điền các dòng đang trống" - subset cua fillDownTargets() ma field
  // tuong ung dang null (chua nhap) - CHE DO NAY khong bao gio ghi de, nen
  // khong can ConfirmModal du co bao nhieu dong.
  function fillDownEmptyTargets(index: number, field: 'costPrice' | 'markupPercent'): number[] {
    return fillDownTargets(index).filter(i => {
      const row = itemsDraft[i];
      return field === 'costPrice' ? row.costPrice == null : row.markupPercent == null;
    });
  }

  function applyFillDown(index: number, field: 'costPrice' | 'markupPercent', targetIndices: number[], mode: FillDownMode) {
    const source = itemsDraft[index];
    if (!source) return;
    const undoSnapshot = itemsDraft.map(r => ({ ...r }));
    const targetSet = new Set(targetIndices);
    const next = itemsDraft.map((row, i) => {
      if (!targetSet.has(i)) return row;
      if (field === 'costPrice') {
        // Chi copy gia von don thuan - GIU NGUYEN markup/gia khach hien co
        // cua tung dong con (dung yeu cau "dien gia von", khong tu dong tinh
        // lai gia ban).
        return { ...row, costPrice: source.costPrice, costNotApplicable: false };
      }
      // markupPercent: ap CUNG % markup nhu dong nguon, roi tinh lai gia
      // khach - CHI cho dong da co gia von rieng (thieu gia von thi bo qua,
      // khong the suy unitPrice tu markup neu khong co cost).
      if (row.costPrice == null) return row;
      const markup = source.markupPercent ?? 0;
      return { ...row, markupPercent: markup, unitPrice: row.costPrice * (1 + markup / 100) };
    });
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
    setFillDownConfirm(null);
    const fieldLabel = field === 'costPrice' ? 'Giá vốn' : 'Markup';
    const scopeLabel = mode === 'empty' ? 'đang trống' : 'đã chọn';
    const message = `Đã điền ${fieldLabel} xuống ${targetIndices.length} dòng ${scopeLabel}.`;
    setFillDownUndo({ items: undoSnapshot, message });
    showToast(true, message);
  }

  function undoFillDown() {
    if (!fillDownUndo) return;
    setItemsDraft(fillDownUndo.items);
    if (quote) void persistQuote({ items: fillDownUndo.items }, { silent: true });
    setFillDownUndo(null);
  }

  // Vao dung 1 trong 2 che do nguoi dung chon o popover cua icon "Điền
  // xuống" (xem renderFillDownIcon) - "empty" khong bao gio ghi de (bo qua
  // ConfirmModal), "all" moi can hoi xac nhan neu co dong da co gia tri.
  function fillDownWithMode(index: number, field: 'costPrice' | 'markupPercent', mode: FillDownMode) {
    const source = itemsDraft[index];
    if (!source) return;
    if (field === 'costPrice' && source.costPrice == null) return;
    if (field === 'markupPercent' && source.markupPercent == null) return;
    const targetIndices = mode === 'empty' ? fillDownEmptyTargets(index, field) : fillDownTargets(index);
    if (targetIndices.length === 0) return;
    if (mode === 'all') {
      const overwriteCount = targetIndices.filter(i => {
        const row = itemsDraft[i];
        return field === 'costPrice' ? row.costPrice != null : row.markupPercent != null;
      }).length;
      if (overwriteCount > 0) {
        setFillDownConfirm({ index, field, targetIndices, mode });
        return;
      }
    }
    applyFillDown(index, field, targetIndices, mode);
  }

  /** Icon nho "Điền xuống" (yeu cau rieng: khong hien chu, dung icon +
   * tooltip/aria-label) - bam mo popover (ActionMenu) cho chon 1 trong 2
   * pham vi RO RANG ("Chỉ điền các dòng đang trống" / "Điền toàn bộ các
   * dòng") thay vi chay thang 1 hanh dong duy nhat nhu ban truoc - dung yeu
   * cau moi "phải hiển thị phạm vi và số dòng sẽ bị ảnh hưởng" (hien so
   * dong ngay trong nhan cua tung lua chon). Chi hien khi dong nay CO the
   * lam nguon (da co gia tri o field tuong ung) VA co it nhat 1 hang muc
   * con. Dung lai ActionMenu (portal + position:fixed) - da xac nhan an
   * toan voi overflow:auto cua bang cha tu bug fix truoc do. */
  function renderFillDownIcon(index: number, field: 'costPrice' | 'markupPercent') {
    if (!canEdit || !isDraft || isLockedForReview) return null;
    const item = itemsDraft[index];
    const hasSourceValue = field === 'costPrice' ? item.costPrice != null : item.markupPercent != null;
    if (!hasSourceValue) return null;
    const allTargets = fillDownTargets(index);
    if (allTargets.length === 0) return null;
    const emptyTargets = fillDownEmptyTargets(index, field);
    const fieldLabel = field === 'costPrice' ? 'Giá vốn' : 'Markup';
    const label = `Điền ${fieldLabel} xuống`;
    return (
      <ActionMenu
        label={label}
        icon={ArrowDownToLine}
        triggerClassName="qc-fill-down-icon-btn"
        iconClassName="qc-inline-icon"
        items={[
          {
            key: 'empty',
            label: `Chỉ điền các dòng đang trống (${emptyTargets.length})`,
            disabled: emptyTargets.length === 0,
            title: emptyTargets.length === 0 ? 'Không còn dòng nào đang trống trong phạm vi này' : undefined,
            onSelect: () => fillDownWithMode(index, field, 'empty'),
          },
          {
            key: 'all',
            label: `Điền toàn bộ (${allTargets.length} dòng)`,
            onSelect: () => fillDownWithMode(index, field, 'all'),
          },
        ]}
      />
    );
  }

  function toItemInput(row: QuoteItem): QuoteItem {
    return {
      rowType: row.rowType === 'section' ? 'section' : 'item',
      description: row.description || '',
      serviceDescription: row.serviceDescription,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      discountPercent: row.discountPercent ?? 0,
      vatRate: row.vatRate ?? 10,
      costPrice: row.costPrice ?? null,
      markupPercent: row.markupPercent ?? null,
      costNotApplicable: row.costNotApplicable ?? false,
      catalogItemId: row.catalogItemId,
      bundleSnapshot: row.bundleSnapshot,
      // BUG THAT DA GAP (phat hien khi test snapshot USD Bang gia VPS Zone):
      // toItemInput() liet ke tung field mot, THIEU HAN 3 field nay - moi
      // hang muc them tu "Bảng giá VPS Zone" (priceBookItemToQuoteItem())
      // gan priceBookItemId/priceBookVersionId/priceBookSnapshot ngay luc
      // them, nhung khi gui len BE qua ham nay thi 3 field do bi ROI RA
      // (undefined, khong nam trong object tra ve) - DB luu NULL, mat het
      // lien ket toi price_book_items goc LAN toan bo snapshot audit-trail
      // (costMode/unitPriceUsd/exchangeRate/costUsd/customerPriceUsd...),
      // du cot DB da co san tu migration 106. Anh huong CA yeu cau "reload
      // quote van giu dung snapshot" moi lan nay.
      priceBookItemId: row.priceBookItemId,
      priceBookVersionId: row.priceBookVersionId,
      priceBookSnapshot: row.priceBookSnapshot,
      // De quy - hang muc thuoc 1 nhom (Section) duoc gui long trong
      // `children` cua dong section do, dung DINH DANG API cu da co san
      // (xem buildItemTree() gop itemsDraft PHANG thanh cay truoc khi goi
      // ham nay o cap goc).
      children: (row.children || []).map(toItemInput),
    };
  }

  /** Gop itemsDraft (PHANG) thanh cay + anh xa qua toItemInput - dung DUY
   * NHAT 1 cho truoc moi lan gui hang muc len BE (thay cho
   * `itemsDraft.map(toItemInput)` cu, von bo lo cau truc nhom vi map phang
   * khong biet hang muc nao thuoc section nao). */
  function buildItemsPayload(flat: QuoteItem[]): QuoteItem[] {
    return buildItemTree(flat).map(toItemInput);
  }

  // Xem giai thich day du trong persistQuote() ben duoi - danh dau "sap dong,
  // dung autosave nua" tren onMouseDown cua nut Dong/Huy (chay TRUOC blur).
  const skipNextAutoSaveRef = useRef(false);
  function markClosingIntent() {
    skipNextAutoSaveRef.current = true;
  }

  async function persistQuote(overrides: { data?: Quote['data']; items?: QuoteItem[]; overallDiscountPercent?: number | null; quoteTypeCodes?: string[] }, opts?: { silent?: boolean }) {
    if (!quote) return;
    // BUG THAT DA GAP ("sua nham 1 o roi bam X dong luon van bi luu"): moi o
    // sua trong bang hang muc (Markup/Gia von/Gia khach/Mo ta/SL...) deu
    // auto-save NGAM qua onBlur - khi bam nut Dong (X)/Huy/"← Danh sách", trinh
    // duyet BLUR o dang go TRUOC KHI chay onClick cua nut do, nen gia tri vua
    // go (co the go NHAM) van bi luu xuong DB truoc khi modal kip dong, du
    // nguoi dung chua he bam nut "Lưu thay đổi" chinh. Cac nut dong/huy nay
    // gio deu co onMouseDown={markClosingIntent} (mousedown chay TRUOC blur)
    // de bao truoc "sap dong, dung luu autosave nua" - CHI chan cuoc goi
    // SILENT (autosave ngam), KHONG anh huong nut "Lưu thay đổi" chinh (luon
    // goi khong co silent, van luu binh thuong khi nguoi dung chu dong bam).
    if (opts?.silent && skipNextAutoSaveRef.current) return;
    // silent=true: dung cho auto-save NGAM khi go/blur tung o (mo ta/SL/gia
    // von/markup...) - KHONG dung chung co `busy`/`activeAction` voi cac nut
    // hanh dong chinh (Bàn giao/Gửi duyệt...) nua. BUG THAT DA GAP: truoc day
    // MOI auto-save nay deu bat `busy=true`, khien nut "Bàn giao" bi disable
    // (khong the bam) DUNG NGAY luc nguoi dung vua nhap xong hang muc roi bam
    // lien tay - lan bam dau tien bi "nuot mat" (nut dang disable, trinh
    // duyet khong phat click), phai bam LAN 2 (luc auto-save da xong,
    // busy=false) moi thanh cong - nhin nhu phai bam 2 lan Bàn giao moi qua
    // duoc buoc 2. Auto-save van chay binh thuong ngam, chi khong con chan
    // cac nut hanh dong khac trong luc no dang luu.
    if (!opts?.silent) {
      setActiveAction('draftSave');
      setBusy(true);
    }
    try {
      const nextItems = overrides.items ?? itemsDraft;
      const updated = await seedingQuoteRepository.updateQuote(quote.id, {
        data: overrides.data ?? quote.data,
        items: buildItemsPayload(nextItems),
        ...('overallDiscountPercent' in overrides ? { overallDiscountPercent: overrides.overallDiscountPercent } : {}),
        ...('quoteTypeCodes' in overrides ? { quoteTypeCodes: overrides.quoteTypeCodes } : {}),
      });
      setQuote(updated);
      await onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được thay đổi.');
    } finally {
      if (!opts?.silent) {
        setBusy(false);
        setActiveAction(null);
      }
    }
  }

  function addItemRow() {
    setItemsDraft(prev => [
      ...prev,
      { description: '', quantity: 1, unitPrice: 0, vatRate: 10, discountPercent: 0, costPrice: null, markupPercent: null },
    ]);
  }

  // Muc cha (Section, migration 104) - dong tieu de nhom THUAN TUY, khong
  // tinh tien (server tu ep qty/gia ve 0 du client gui gi). `id` TAM (client-
  // side, chua luu that) de cac hang muc con moi them ngay sau do co the tro
  // toi qua `parentItemId` TRUOC ca khi bam Luu - buildItemsPayload() gop lai
  // dung nhom nay luc gui len, BE se tra ve id THAT sau khi luu/tai lai.
  function addSectionRow() {
    setItemsDraft(prev => [
      ...prev,
      { id: newBlockId(), rowType: 'section', description: 'Mục mới', quantity: 0, unitPrice: 0, vatRate: 0, discountPercent: 0 },
    ]);
  }

  // "+" tren TUNG dong hang muc (yeu cau rieng "thao tác thêm hạng mục" -
  // KHONG con nut tren Muc cha nua) - them 1 dong TRONG NGAY SAU dong o
  // index, ke thua dung parentItemId cua dong nguon (dong thuoc Muc cha nao
  // thi dong moi cung vao dung Muc cha do, dong ngoai Muc cha nao thi cung
  // khong gan Muc cha - dung tinh chat "cac hang muc cua 1 nhom nam LIEN
  // TIEP trong mang" ma vong lap render dang dua vao).
  function addBlankItemAfterIndex(index: number) {
    setItemsDraft(prev => {
      const sourceRow = prev[index];
      if (!sourceRow) return prev;
      const newRow: QuoteItem = {
        description: '', quantity: 1, unitPrice: 0, vatRate: 10, discountPercent: 0,
        costPrice: null, markupPercent: null, parentItemId: sourceRow.parentItemId,
      };
      return [...prev.slice(0, index + 1), newRow, ...prev.slice(index + 1)];
    });
  }

  function duplicateItemRow(index: number) {
    setItemsDraft(prev => {
      const source = prev[index];
      if (!source) return prev;
      const clone: QuoteItem = { ...source, id: undefined };
      const next = [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)];
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }

  // Keo-tha sap xep/chuyen nhom bang hang muc - dung API HTML5 Drag and Drop
  // thuan (khong them thu vien ngoai, bang chi vai chuc dong la nhieu). Chi
  // luu INDEX dang keo trong 1 ref (khong can state, khong lam re-render moi
  // khi keo qua tung hang). Tha 1 hang muc VAO 1 Muc cha se tu chuyen no vao
  // dung nhom do (thanh hang muc DAU TIEN cua nhom) - tha VAO 1 hang muc
  // khac se xep truoc dong do (thua ke DUNG nhom cua dong do, ke ca "khong
  // thuoc nhom nao"). Keo ca 1 Muc cha se mang theo CA hang muc con cua no
  // (xem getRowBlockRange/moveRowBlock).
  const dragRowIndexRef = useRef<number | null>(null);
  function handleRowDragStart(index: number) {
    dragRowIndexRef.current = index;
  }
  function handleRowDrop(targetIndex: number, targetIsSection: boolean) {
    const fromIndex = dragRowIndexRef.current;
    dragRowIndexRef.current = null;
    if (fromIndex === null || fromIndex === targetIndex) return;
    setItemsDraft(prev => {
      const draggedIsSection = prev[fromIndex]?.rowType === 'section';
      let insertBeforeIndex = targetIndex;
      if (targetIsSection && !draggedIsSection) {
        // Drop an item on a section: make it the section's first child.
        insertBeforeIndex = targetIndex + 1;
      } else if (targetIsSection && draggedIsSection && fromIndex < targetIndex) {
        // Moving a section downward must place its whole block after the
        // target block. Inserting before the target collapses back to the
        // original index once the dragged block is removed.
        insertBeforeIndex = getRowBlockRange(prev, targetIndex)[1];
      }
      const next = moveRowBlock(prev, fromIndex, insertBeforeIndex);
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }
  // Doi cho voi CA khoi lien ke (tren/duoi) - dung getRowBlockRange 2 lan de
  // biet dung ranh gioi khoi lang gieng (phong khoi do la 1 Section nhieu
  // hang muc con, khong phai luon dung 1 dong).
  function moveRowUpDown(index: number, direction: -1 | 1) {
    setItemsDraft(prev => {
      const [start, end] = getRowBlockRange(prev, index);
      let insertBeforeIndex: number;
      if (direction === -1) {
        if (start === 0) return prev;
        insertBeforeIndex = blockStartEndingAt(prev, start - 1);
      } else {
        if (end >= prev.length) return prev;
        insertBeforeIndex = getRowBlockRange(prev, end)[1];
      }
      const next = moveRowBlock(prev, index, insertBeforeIndex);
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }

  // Danh sach phang cac dong BAN DUOC (bundle/component) tu cay catalog day
  // du - group chi dung lam ten nhom + loc, khong tu chon duoc. Gan kem
  // groupName cua group CHA GAN NHAT (catalog hien chi 1 cap group->item,
  // nhung ham nay van de quy vong sau phong khi mo rong).
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

  function addItemsFromCatalog(itemsIn: QuoteItem[]) {
    if (itemsIn.length === 0) return;
    // Gan id ON DINH cho tung dong MOI ngay tu day (thay vi de trong cho tam
    // server sinh sau khi luu) - can co id THAT SU de theo doi dung batch
    // qua costBatchIds, khong phu thuoc vao index (index se doi khi chen/xoa/
    // keo tha dong khac).
    const items = itemsIn.map(item => (item.id ? item : { ...item, id: newBlockId() }));
    if (items.length > 1) setCostBatchIds(items.map(item => item.id!));
    else setCostBatchIds([]);
    let next = itemsDraft;
    if (catalogInsertAfterIndex != null && itemsDraft[catalogInsertAfterIndex]) {
      // "+" tren 1 dong cu the - chen NGAY SAU dung dong do, ke thua
      // parentItemId cua chinh dong nguon (dong thuoc Muc cha nao thi hang
      // muc moi vao dung Muc cha do; dong khong thuoc Muc cha nao - vd nam
      // ngoai moi Section - thi hang muc moi cung khong co parentItemId,
      // dung yeu cau "nếu dòng không thuộc Mục cha → chèn ngay sau dòng đó
      // ở cấp ngoài").
      const sourceRow = itemsDraft[catalogInsertAfterIndex];
      const insertAt = catalogInsertAfterIndex + 1;
      next = [
        ...next.slice(0, insertAt),
        ...items.map(item => ({ ...item, parentItemId: sourceRow.parentItemId })),
        ...next.slice(insertAt),
      ];
    } else if (catalogTargetSectionId) {
      const sectionIndex = next.findIndex(row => row.id === catalogTargetSectionId);
      if (sectionIndex !== -1) {
        let insertAt = sectionIndex + 1;
        while (insertAt < next.length && next[insertAt].parentItemId === catalogTargetSectionId) insertAt += 1;
        next = [
          ...next.slice(0, insertAt),
          ...items.map(item => ({ ...item, parentItemId: catalogTargetSectionId })),
          ...next.slice(insertAt),
        ];
      } else {
        next = [...next, ...items];
      }
    } else {
      next = [...next, ...items];
    }
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  /** Mapping khi them tu danh muc - CHI dien ma/ten, mo ta, don vi, VAT, SL
   * mac dinh 1. TUYET DOI khong tu dien "Gia khach" (unitPrice) khi con o
   * Buoc 1 (chua duoc canEditPricingCells) - giu dung hanh vi khoa gia Sale
   * da co san, tranh lo gia truoc khi sang Buoc 2. */
  function catalogItemToQuoteItem(item: ServiceCatalogItem): QuoteItem {
    return {
      description: item.description || item.name,
      serviceDescription: item.sku ? `${item.sku} - ${item.name}` : item.name,
      unit: item.unit || '',
      quantity: item.specQuantityPerUnit || 1,
      // Uu tien Gia khach da cau hinh o Bo gia mac dinh (migration 107) -
      // fallback ve Don gia Sale cu (default_unit_price_vnd) cho san pham
      // CHUA duoc cau hinh bo gia moi, tranh Gia khach ve 0 vo ly.
      unitPrice: canEditPricingCells ? (item.defaultCustomerPriceVnd ?? item.defaultUnitPriceVnd ?? 0) : 0,
      discountPercent: item.defaultDiscountPercent || 0,
      vatRate: item.defaultVatRate ?? 10,
      // Bo gia MAC DINH cua danh muc chung (migration 107,
      // service_catalog_item_pricing) - CHI la GIA TRI MAC DINH luc chon,
      // sua trong quote KHONG ghi nguoc ve danh muc (dung nguyen tac
      // snapshot, giong het Bang gia VPS Zone). item.defaultCostPriceVnd co
      // the la `undefined` (khong du quyen xem, API da loai han field) hoac
      // `null` (du quyen nhung chua cau hinh) - ca 2 truong hop deu quy ve
      // costPrice=null, KHONG bia so 0.
      costPrice: canEditCostCells ? (item.defaultCostPriceVnd ?? null) : null,
      // BUG THAT DA GAP: markupPercent truoc day gate theo canEditCostCells
      // (chi yeu cau stage != 'request') nhung backend coi markupPercent la
      // field PRICING (_PRICING_ITEM_FIELD_PAIRS trong quote.py), CHI duoc
      // sua o dung stage 'pricing' - Presale them hang muc o Buoc 2 (technical)
      // co san defaultMarkupPercent se bi BACKEND TU CHOI CA REQUEST voi loi
      // "Markup/Giá khách chỉ được nhập ở Bước 3" du costPrice hoan toan hop
      // le, khien hang muc KHONG luu duoc. Doi sang canEditPricingCells cho
      // dung phan loai field cua backend.
      markupPercent: canEditPricingCells ? (item.defaultMarkupPercent ?? null) : null,
      catalogItemId: item.id,
    };
  }

  /** Mapping cho nguon "Bang gia VPS Zone" (migration 106) - SONG SONG voi
   * catalogItemToQuoteItem(), KHONG sua ham do. Khac 1 diem CO CHU DICH: Zone
   * co san gia von/Rate THAT (khong nhu danh muc noi bo khong co khai niem
   * cost), nen dien san costPrice/markupPercent lam GIA TRI MAC DINH - nhung
   * 2 gate canEditCostCells/canEditPricingCells VAN quyet dinh co duoc SUA
   * hay khong, khong bi mo khoa som hon quy dinh boi nguon Zone. */
  function priceBookItemToQuoteItem(item: PriceBookItem): QuoteItem {
    const preview = previewPriceBookItem({
      costMode: item.costMode,
      unitPriceUsd: item.unitPriceUsd,
      exchangeRate: item.exchangeRate,
      unitPriceVndDirect: item.unitPriceVndDirect,
      importDutyPercent: item.importDutyPercent,
      vatInPercent: item.vatInPercent,
      vatEuPercent: item.vatEuPercent,
      defaultQuantity: item.defaultQuantity,
      defaultRatePercent: item.defaultRatePercent,
      referencePrice: item.referencePrice,
    });
    return {
      description: item.description || item.name,
      serviceDescription: `${item.sku} - ${item.name}`,
      unit: item.unit || '',
      quantity: item.defaultQuantity || 1,
      unitPrice: canEditPricingCells ? preview.unitPrice || 0 : 0,
      discountPercent: 0,
      vatRate: item.vatEuPercent ?? 10,
      costPrice: canEditCostCells ? preview.costUnit ?? null : null,
      // Cung bug/fix voi catalogItemToQuoteItem() o tren - markupPercent la
      // field PRICING (chi sua duoc o stage 'pricing'), khong phai canEditCostCells.
      markupPercent: canEditPricingCells ? item.defaultRatePercent ?? null : null,
      catalogItemId: undefined,
      priceBookItemId: item.id,
      priceBookVersionId: item.priceBookVersionId,
      priceBookSnapshot: { ...item, computedAtSelection: preview },
    };
  }

  async function loadPriceBookItems() {
    // BUG THAT DA GAP ("SAO ĐANG TẠO CÁI MỚI MÀ BÊN VPS ZONE K HIỂN DANH MỤC
    // TA"): truoc day chan han khi !quote?.id (dang tao moi, chua co quote
    // that) - khien tab "Bảng giá VPS Zone" luon 0 san pham trong luc tao
    // moi, khac voi "Danh mục nội bộ" van xem binh thuong. quote_id gio la
    // optional o ca repository lan backend (tra danh sach day du, chi an gia
    // von/markup neu thieu quote that) - goi duoc ca khi !quote.
    if (priceBookItems !== null) return;
    setPriceBookLoading(true);
    try {
      const list = await priceBookZoneRepository.listPublishedForQuote(quote?.id);
      setPriceBookItems(list);
    } catch {
      setPriceBookItems([]);
    } finally {
      setPriceBookLoading(false);
    }
  }

  // `target` tuy chon (yeu cau rieng "thao tác thêm hạng mục" - bam "+" tai
  // 1 Muc cha hoac tai 1 dong hang muc, khong chi qua nut "Chọn từ danh mục"
  // chung o cuoi bang nhu truoc): { sectionId } = luon them vao CUOI dung
  // Muc cha do; { afterIndex } = chen NGAY SAU dung dong o vi tri do (dong
  // do co the thuoc 1 Muc cha hay khong, addItemsFromCatalog() tu suy
  // parentItemId tu chinh dong nguon). Khong truyen gi = giu nguyen hanh vi
  // cu (them vao cuoi bang, nguoi dung tu chon Muc cha dich qua dropdown
  // extraToolbar neu muon).
  async function openCatalogPicker(target?: { sectionId?: string; afterIndex?: number }) {
    setCatalogModalOpen(true);
    setCatalogTargetSectionId(target?.sectionId || '');
    setCatalogInsertAfterIndex(target?.afterIndex ?? null);
    if (catalogSource === 'zone') {
      void loadPriceBookItems();
    }
    // Cache theo DUNG quote?.id da fetch lan truoc - neu quote vua duoc tao
    // that (chuyen tu chua co sang co id that) phai FETCH LAI, khong dung
    // cay cu (fetch luc chua co quote_id se KHONG kem Gia von/Markup - giu
    // nguyen cay do mai mai se ket "khong bao gio thay cost" du bao gia da
    // luu xong).
    if (catalogTree && catalogTreeQuoteId === (quote?.id ?? null)) return;
    setCatalogLoading(true);
    try {
      // context='quote_picker' + quoteId THAT (khi da co) - dieu kien BAT
      // BUOC de backend cap Gia von/Markup (xem _resolve_catalog_pricing_visibility,
      // routers/service_catalog.py). Che do TAO MOI (quote?.id con undefined)
      // se KHONG kem quote_id - Picker van dung duoc binh thuong (Gia khach
      // luon hien), chi CHUA thay Gia von/Markup cho toi khi bao gia duoc
      // luu that (khong con ngoai le "tu cap cho nguoi goi" nhu thiet ke cu
      // - da bi audit bat lo hong bao mat, xem plan).
      const tree = await serviceCatalogRepository.list({ context: 'quote_picker', quoteId: quote?.id });
      setCatalogTree(tree);
      setCatalogTreeQuoteId(quote?.id ?? null);
    } catch {
      setCatalogTree([]);
      setCatalogTreeQuoteId(quote?.id ?? null);
    } finally {
      setCatalogLoading(false);
    }
  }

  // Dau "+" canh 1 hang muc CHUA lien ket (xem cot ten hang muc) - mo THANG
  // QuickAddProductModal, khong can mo ca popup Chọn từ danh mục truoc. Phai
  // tu dam bao catalogTree da tai (dau "+" nay co the la LAN DAU nguoi dung
  // cham toi danh muc trong phien lam viec nay, khac voi luong tu popup Chọn
  // từ danh mục von da goi openCatalogPicker() truoc do).
  function openQuickAddForRow(index: number, locked?: boolean) {
    setQuickAddProductTarget({ linkIndex: index, locked });
    if (!catalogTree || catalogTreeQuoteId !== (quote?.id ?? null)) void refreshCatalogTree();
  }

  const catalogFlatItems = useMemo(() => (catalogTree ? flattenCatalogTree(catalogTree) : []), [catalogTree]);
  const catalogSectionOptions = useMemo(
    () => itemsDraft.filter(row => row.rowType === 'section' && row.id).map(row => ({ id: row.id as string, label: row.description || 'Mục cha' })),
    [itemsDraft]
  );

  // Khoa trung lap: catalogItemId/priceBookItemId -> index dong DA CO trong
  // itemsDraft (bo qua Muc cha). Tinh lai moi render - phan anh dung state
  // THAT ngay luc bam "Them vao bao gia", khong cache.
  const existingCatalogKeys = useMemo(() => {
    const map = new Map<string, number>();
    itemsDraft.forEach((row, index) => {
      if (row.rowType !== 'section' && row.catalogItemId) map.set(row.catalogItemId, index);
    });
    return map;
  }, [itemsDraft]);
  const existingZoneKeys = useMemo(() => {
    const map = new Map<string, number>();
    itemsDraft.forEach((row, index) => {
      if (row.rowType !== 'section' && row.priceBookItemId) map.set(row.priceBookItemId, index);
    });
    return map;
  }, [itemsDraft]);

  // Dung CHUNG useCatalogItemAdd (module service-catalog) cho ca 2 nguon -
  // dam bao hanh vi "san pham da co trong bang" GIONG HET nhau (hien "Da
  // them" + ConfirmModal tang SL/them dong moi) nhu FillQuoteStep dung cho
  // luong "Tao bao gia nhanh" (xem CatalogPickerModal + useCatalogItemAdd).
  const catalogAdd = useCatalogItemAdd<QuoteItem>({ existingKeys: existingCatalogKeys, onAdd: addItemsFromCatalog });
  const zoneAdd = useCatalogItemAdd<QuoteItem>({ existingKeys: existingZoneKeys, onAdd: addItemsFromCatalog });

  const internalPickerItems: CatalogPickerListItem[] = useMemo(
    () =>
      catalogFlatItems.map(item => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        description: item.description,
        groupName: item.groupName,
        unit: item.unit,
        vatRate: item.defaultVatRate,
        costPriceVnd: item.defaultCostPriceVnd,
        markupPercent: item.defaultMarkupPercent,
        customerPriceVnd: item.defaultCustomerPriceVnd ?? item.defaultUnitPriceVnd ?? 0,
        status: item.status,
        alreadyAdded: existingCatalogKeys.has(item.id),
      })),
    [catalogFlatItems, existingCatalogKeys]
  );
  function handleAddSelectedCatalogItems(ids: string[]) {
    const selectedItems = catalogFlatItems.filter(item => ids.includes(item.id));
    const dedupCount = catalogAdd.handleAddSelected(
      selectedItems.map(item => ({ key: item.id, item: catalogItemToQuoteItem(item), label: item.name }))
    );
    if (dedupCount === 0) setCatalogModalOpen(false);
  }

  function handleAddSelectedZoneItems(ids: string[]) {
    const selectedItems = (priceBookItems || []).filter(item => ids.includes(item.id));
    const dedupCount = zoneAdd.handleAddSelected(
      selectedItems.map(item => ({ key: item.id, item: priceBookItemToQuoteItem(item), label: item.name }))
    );
    if (dedupCount === 0) setCatalogModalOpen(false);
  }

  // Lam moi catalogTree SAU KHI tao san pham/nhom moi (QuickAddProductModal/
  // QuickAddGroupModal) - dung LAI DUNG API/cache-key voi openCatalogPicker()
  // (context='quote_picker' + quote?.id) de san pham/nhom vua tao "xuất hiện
  // ngay trong danh sách" voi DAY DU gia von/markup (khong phai ban rong).
  async function refreshCatalogTree() {
    try {
      const tree = await serviceCatalogRepository.list({ context: 'quote_picker', quoteId: quote?.id });
      setCatalogTree(tree);
      setCatalogTreeQuoteId(quote?.id ?? null);
    } catch {
      // Giu nguyen cay cu neu lam moi loi - khong lam hong popup dang mo.
    }
  }

  // "+ Nhóm sản phẩm" - nhom tao xong: lam moi cay + tu dong loc sang dung
  // nhom vua tao (rong, chua co san pham nao) de Sale "chuyển sang nhóm vừa
  // tạo và thêm sản phẩm ngay" nhu yeu cau, khong bat thoat popup.
  async function handleGroupCreated(created: ServiceCatalogItem) {
    await refreshCatalogTree();
    setPickerGroupFilter(created.name);
    setQuickAddGroupOpen(false);
    showToast(true, `Đã tạo nhóm "${created.name}".`);
  }

  // "+ Sản phẩm mới" (tu popup, them thanh DONG MOI) HOAC dau "+" canh 1
  // hang muc co san (chi GAN ID nguoc lai dong do, khong tao dong moi) - xem
  // giai thich quickAddProductTarget o khai bao state.
  async function handleQuickAddProductCreated(created: ServiceCatalogItem) {
    await refreshCatalogTree();
    if (quickAddProductTarget && typeof quickAddProductTarget === 'object') {
      const { linkIndex, locked } = quickAddProductTarget;
      if (locked) {
        // "k cần tạo phiên bản mới bro" - quote/version da khoa: VAN cho tao
        // san pham vao "Sản phẩm & dịch vụ" binh thuong (khong con bat qua
        // luong "Tạo phiên bản mới" nua), nhung KHONG ghi catalogItemId
        // nguoc lai dong hang muc cua version da khoa (giu nguyen bat bien
        // du lieu quote da duyet - dung tinh than yeu cau truoc do "có thể
        // cho tạo vào Sản phẩm & dịch vụ, nhưng không được ghi ngược ID vào
        // version đã khóa").
        showToast(true, `Đã tạo "${created.name}" vào Sản phẩm & dịch vụ. Báo giá đã khoá nên chưa liên kết vào hạng mục này.`);
        setQuickAddProductTarget(null);
        return;
      }
      setItemsDraft(prev => prev.map((row, i) => (i === linkIndex ? { ...row, catalogItemId: created.id } : row)));
      if (quote) void persistQuote({}, { silent: true });
      showToast(true, `Đã thêm "${created.name}" vào Sản phẩm & dịch vụ và liên kết với hạng mục này.`);
    } else {
      // 'newRow' - CHI tao san pham + tu tich chon trong Picker (van dang
      // mo), KHONG tu dong them vao bao gia (xem giai thich o khai bao
      // autoSelectCatalogItemId) - Sale tu bam "+ Thêm vào báo giá" khi da
      // san sang.
      setAutoSelectCatalogItemId(created.id);
      showToast(true, `Đã tạo "${created.name}" và tự chọn trong danh sách — bấm "+ Thêm vào báo giá" khi sẵn sàng.`);
    }
    setQuickAddProductTarget(null);
  }

  function increaseExistingRowQty(existingIndex: number, addQuantity: number) {
    setItemsDraft(prev => {
      const next = prev.map((row, index) => (index === existingIndex ? { ...row, quantity: (row.quantity || 0) + (addQuantity || 1) } : row));
      if (quote) void persistQuote({ items: next }, { silent: true });
      return next;
    });
  }


  // "Nap tu bao gia gan nhat" - CHI hien CTA khi thuc su tim thay 1 bao gia
  // KHAC (cung deal) co hang muc that qua API that (getQuotes() + loc client
  // theo dealId) - khong bao gio bia san 1 nut "co ve nhu co du lieu".
  useEffect(() => {
    if (quote) return; // chi ap dung luc tao moi
    if (!draftDealId) {
      setRecentDealQuote(null);
      return;
    }
    let alive = true;
    seedingQuoteRepository
      .getQuotes()
      .then(all => {
        if (!alive) return;
        const candidates = all
          .filter(q => q.dealId === draftDealId && q.items && q.items.length > 0)
          .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
        setRecentDealQuote(candidates[0] || null);
      })
      .catch(() => {
        if (alive) setRecentDealQuote(null);
      });
    return () => {
      alive = false;
    };
  }, [draftDealId, quote]);

  function loadFromRecentQuote() {
    if (!recentDealQuote) return;
    // Yeu cau that: nap tu bao gia gan nhat CHI nap Gia von (costPrice) -
    // Markup/Gia khach la quyet dinh rieng cua Sale cho TUNG khach/deal,
    // KHONG duoc tu dong keo theo gia cu cua 1 khach/deal khac - Presale/Sale
    // luon phai tu dinh gia lai tu dau cho bao gia moi nay, chi do lai duoc
    // phan uoc luong ky thuat (gia von) da lam truoc do.
    const cloned = recentDealQuote.items.map(item => ({
      description: item.description,
      serviceDescription: item.serviceDescription,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: 0,
      discountPercent: item.discountPercent ?? 0,
      vatRate: item.vatRate ?? 10,
      costPrice: item.costPrice ?? null,
      markupPercent: null,
      catalogItemId: item.catalogItemId,
    }));
    const next = [...itemsDraft, ...cloned];
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  function removeItemRow(index: number) {
    const target = itemsDraft[index];
    // Xoa 1 Muc cha (Section) thi xoa LUON toan bo hang muc con thuoc nhom do
    // (khop hanh vi ON DELETE CASCADE tren parent_item_id da co san o DB tu
    // migration 063 - khong de lai hang muc "mo coi" khong thuoc nhom nao ma
    // nguoi dung khong co y dinh giu lai rieng).
    const next = target?.rowType === 'section' && target.id
      ? itemsDraft.filter((row, i) => i !== index && row.parentItemId !== target.id)
      : itemsDraft.filter((_, i) => i !== index);
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  // Markup nhanh (preset +15/20/25/30% hoac Tuy chinh) - CHI ap cho hang muc
  // THAT (row.costPrice != null da tu loai Muc cha, vi Muc cha luon co
  // costPrice=null). Neu >=1 dong da co markupPercent (da tung nhap gia
  // truoc do) thi phai xac nhan ghi de qua ConfirmModal (yeu cau rieng - benh
  // vien nhieu lan ghi de nham markup dang dung khi bam preset khac).
  function doApplyQuickMarkup(percent: number) {
    const next = itemsDraft.map(row =>
      row.costPrice != null ? { ...row, markupPercent: percent, unitPrice: row.costPrice * (1 + percent / 100) } : row
    );
    setItemsDraft(next);
    setLastAppliedMarkupPct(percent);
    setLastAppliedMarginPct(null);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }
  // Margin mục tiêu (KHOI PHUC - yeu cau rieng): suy nguoc gia khach tu
  // margin MUON DAT (margin = loi nhuan/gia khach, KHONG phai loi nhuan/
  // cost) - unitPrice = cost / (1 - margin/100), roi tu do suy lai
  // markupPercent (LUON chi luu markupPercent tren row, margin CHUA BAO GIO
  // luu rieng - chi tinh lai o render, xem bien `margin` trong vong lap
  // render ben duoi) - dam bao Markup/Margin khong bao gio mau thuan nhau vi
  // chi co DUY NHAT markupPercent la nguon that.
  function doApplyTargetMargin(marginPercent: number) {
    const next = itemsDraft.map(row => {
      if (row.costPrice == null) return row;
      const unitPrice = row.costPrice / (1 - marginPercent / 100);
      const markupPercent = row.costPrice > 0 ? ((unitPrice - row.costPrice) / row.costPrice) * 100 : 0;
      return { ...row, unitPrice, markupPercent };
    });
    setItemsDraft(next);
    setLastAppliedMarginPct(marginPercent);
    setLastAppliedMarkupPct(null);
    if (quote) void persistQuote({ items: next }, { silent: true });
  }

  const [markupApplyConfirm, setMarkupApplyConfirm] = useState<{ percent: number } | null>(null);
  function applyQuickMarkup(percent: number) {
    if (!Number.isFinite(percent)) return;
    const hasExisting = itemsDraft.some(row => row.costPrice != null && row.markupPercent != null);
    if (hasExisting) {
      setMarkupApplyConfirm({ percent });
      return;
    }
    doApplyQuickMarkup(percent);
  }

  const [marginApplyConfirm, setMarginApplyConfirm] = useState<{ percent: number } | null>(null);
  function applyTargetMargin(marginPercent: number) {
    if (!(marginPercent >= 0 && marginPercent < 100)) {
      window.alert('Margin phải trong khoảng 0% đến dưới 100%.');
      return;
    }
    const hasExisting = itemsDraft.some(row => row.costPrice != null && row.markupPercent != null);
    if (hasExisting) {
      setMarginApplyConfirm({ percent: marginPercent });
      return;
    }
    doApplyTargetMargin(marginPercent);
  }

  // Markup Tuy chinh (o nhap % rieng, canh cac nut preset - yeu cau rieng,
  // dung CHUNG applyQuickMarkup/doApplyQuickMarkup nhu preset, khong tach
  // logic rieng).
  const [markupCustomInput, setMarkupCustomInput] = useState('');
  // Margin Tuy chinh - tuong tu Markup Tuy chinh o tren.
  const [marginCustomInput, setMarginCustomInput] = useState('');
  // Highlight dung nut preset Markup/Margin vua ap de biet dang o muc nao - 2
  // nhom loai tru nhau (ap Markup thi bo highlight Margin va nguoc lai, vi 2
  // cach nhap khac nhau du cung chi ra 1 markupPercent duy nhat).
  const [lastAppliedMarkupPct, setLastAppliedMarkupPct] = useState<number | null>(null);
  const [lastAppliedMarginPct, setLastAppliedMarginPct] = useState<number | null>(null);

  // Thu gon Activity (yeu cau chung, khong rieng 1 stage) - mac dinh chi hien
  // ACTIVITY_COLLAPSED_LIMIT dong moi nhat, toggle "Xem tat ca (N)"/"Thu gon"
  // dung chung 1 state cho ca 2 panel Activity trong workspace.
  const [activityExpanded, setActivityExpanded] = useState(false);

  // CK tong (yeu cau rieng): TRUOC DAY co 1 o "CK tổng" trong quickbar tu
  // set `discountPercent` cho TUNG DONG (ap dung o buoc Thanh tien = subtotal
  // - subtotal*discountPercent/100 - xem lineSubtotal ben duoi) - BUG vi CK
  // tong lai am tham thay doi so lieu tung dong, trai voi yeu cau "CK tổng
  // chỉ giảm trên tổng tiền cuối báo giá, không đổi Markup/Giá khách/ĐV từng
  // dòng". Quote DA CO SAN dung 1 co che nay roi: cot `overall_discount_percent`
  // tren quotes (KHONG dung tren tung quote_items) - chi tru thang vao
  // `totalAmount` sau cung (xem "Giá sau giảm" o khoi Loi nhuan ben duoi, cung
  // dùng chính field nay) - XOA hang "CK tổng" cu (tung set discountPercent
  // tung dong) va THAY bang o nhap CUNG tro toi `quote.overallDiscountPercent`
  // ngay trong quickbar (ke Markup nhanh) de de thao tac, khong tao co che
  // thu 2 nao moi.

  const paymentTermsBlockDraft = quote?.data?.customBlocks?.find(b => b.kind === 'payment_terms');
  const paymentTermsDaysMatch = paymentTermsBlockDraft?.content.match(/(\d+)/);
  const [paymentTermsDays, setPaymentTermsDays] = useState('30');
  useEffect(() => {
    setPaymentTermsDays(paymentTermsDaysMatch ? paymentTermsDaysMatch[1] : '30');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  function applyPaymentTerms(days: string) {
    if (!quote) {
      // Che do tao moi: chua co quote.data that - giu tam o state rieng,
      // gop vao customBlocks that luc createRequest().
      setDraftPaymentTermsDays(days);
      return;
    }
    const blocks = [...(quote.data?.customBlocks || [])];
    const idx = blocks.findIndex(b => b.kind === 'payment_terms');
    const newBlock = {
      id: idx >= 0 ? blocks[idx].id : newBlockId(),
      kind: 'payment_terms' as const,
      title: 'Điều khoản thanh toán',
      content: `Thanh toán trong ${days} ngày kể từ ngày duyệt báo giá.`,
    };
    if (idx >= 0) blocks[idx] = newBlock;
    else blocks.push(newBlock);
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
  }

  // Popup nho canh nut "+ Điều khoản" (thay window.prompt() cu) - o nhap
  // ngay ke ben, khong con hop thoai native cua trinh duyet.
  const [termNotePopoverOpen, setTermNotePopoverOpen] = useState(false);
  const [termNoteInput, setTermNoteInput] = useState('');

  function submitTermNote() {
    const text = termNoteInput.trim();
    if (!text) return;
    if (!quote) {
      setDraftExtraTerms(prev => [...prev, { id: newBlockId(), title: 'Điều khoản', content: text }]);
    } else {
      const blocks = [...(quote.data?.customBlocks || []), { id: newBlockId(), kind: 'custom_field' as const, title: 'Điều khoản', content: text }];
      void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
    }
    setTermNoteInput('');
    setTermNotePopoverOpen(false);
  }

  // Danh sach dieu khoan bo sung da them (nut "+ Điều khoản") - hien NGAY
  // duoi quickbar kem Sửa/Xóa, ca 2 che do: che do tao moi doc draftExtraTerms
  // (chua ghi DB that), quote da ton tai doc thang tu quote.data.customBlocks
  // (kind='custom_field' - KHONG lay payment_terms/scope_of_work, 2 kind do
  // co UI rieng o cho khac).
  const extraTermsList = quote
    ? (quote.data?.customBlocks || []).filter(b => b.kind === 'custom_field').map(b => ({ id: b.id, title: b.title, content: b.content }))
    : draftExtraTerms;

  function editTermNote(id: string) {
    const current = extraTermsList.find(t => t.id === id);
    if (!current) return;
    const text = window.prompt('Sửa điều khoản:', current.content);
    if (text === null || !text.trim()) return;
    if (!quote) {
      setDraftExtraTerms(prev => prev.map(t => (t.id === id ? { ...t, content: text.trim() } : t)));
      return;
    }
    const blocks = (quote.data?.customBlocks || []).map(b => (b.id === id ? { ...b, content: text.trim() } : b));
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
  }

  function removeTermNote(id: string) {
    if (!quote) {
      setDraftExtraTerms(prev => prev.filter(t => t.id !== id));
      return;
    }
    const blocks = (quote.data?.customBlocks || []).filter(b => b.id !== id);
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } }, { silent: true });
  }

  // The gon "Yeu cau & pham vi cong viec" cho bao gia DA TON TAI - hien tom
  // tat readonly (giong mockup), bam "Chinh sua" moi lo textarea. Luu vao
  // cung noi da dung o che do tao moi (customBlocks kind='scope_of_work' +
  // data.requestSummary) - KHONG tao co che luu rieng thu hai.
  const scopeBlock = quote?.data?.customBlocks?.find(b => b.kind === 'scope_of_work');
  const requestSummaryText = typeof quote?.data?.requestSummary === 'string' ? quote.data.requestSummary : '';
  // Bug da xac nhan (audit trude): expectedProducts duoc GHI luc tao quote
  // nhung khong co cho nao DOC lai sau khi quote da ton tai - them bien nay
  // + dua vao form Chinh sua/tom tat de nguoi dung con thay lai duoc.
  const expectedProductsText = typeof quote?.data?.expectedProducts === 'string' ? quote.data.expectedProducts : '';
  const [scopeEditing, setScopeEditing] = useState(false);
  const [editSummary, setEditSummary] = useState('');
  const [editScope, setEditScope] = useState('');
  // BUG THAT DA GAP ("card Yêu cầu & phạm vi đóng sẵn không mở được"): truoc
  // day `open` cua <details> duoc TINH LAI moi lan render (theo
  // editSummary/editScope hien tai) - component nay re-render RAT thuong
  // xuyen (autosave onBlur o hang chuc o input khac), nen ngay sau khi
  // nguoi dung bam mo tay, 1 render tiep theo (do 1 o BAT KY khac thay doi)
  // se tinh lai `open` va React DONG LAI NGAY, ghi de thao tac bam cua
  // nguoi dung. Fix: chi tinh gia tri MAC DINH 1 LAN duy nhat luc mount
  // (lazy initializer), sau do doc/ghi qua state rieng nay + onToggle - la
  // pattern dung de bien 1 <details> "uncontrolled tu nhien" thanh co the
  // set MAC DINH ban dau ma khong bi ep lai lien tuc.
  // Chot lai theo yeu cau ro rang cua nguoi dung: LUON mac dinh DONG (khong
  // con phan biet co/khong co du lieu nua) - "cần thì mới mở", tu bam mo khi
  // muon xem/sua lai.
  const [scopeCardOpen, setScopeCardOpen] = useState(false);
  // Card "Bàn giao kỹ thuật" - CHOT LAI LAN 3 (yeu cau ro rang "Khối này mặc
  // định đóng khi mở popup yêu cầu báo giá... Bàn giao kỹ thuật chỉ là tính
  // năng hỗ trợ, không phải điều kiện bắt buộc"): mac dinh DONG (dao nguoc
  // lai quyet dinh truoc do). Checklist trong card nay KHONG con dung de
  // chan Luu/Chuyen buoc/Ban giao/Duyet nua; card chi con la tinh nang ho tro.
  const [handoffCardOpen, setHandoffCardOpen] = useState(false);
  // Card "Hạng mục & giá khách" o ban tom tat quote da khoa (review/
  // approved/published) - yeu cau rieng "cho thu gon" - mac dinh dong,
  // giong "Yêu cầu & phạm vi".
  const [summaryItemsCardOpen, setSummaryItemsCardOpen] = useState(false);
  const [editExpectedProducts, setEditExpectedProducts] = useState('');
  // "Giới hạn xem link báo giá bằng Email hoặc Số điện thoại" (migration 118,
  // thay the checkbox+email don le cu) - state cuc bo cho khoi sua trong card
  // "Thông tin phát hành", dong bo lai TU quote moi lan doi quote?.id (cung
  // pattern voi scopeCardOpen/handoffCardOpen ben tren - QuoteCenterPage
  // khong unmount modal giua 2 lan mo quote khac nhau).
  const [accessMode, setAccessMode] = useState<'none' | 'email' | 'phone'>('none');
  const [accessEmailsText, setAccessEmailsText] = useState('');
  const [accessPhonesText, setAccessPhonesText] = useState('');
  const [accessSaving, setAccessSaving] = useState(false);
  useEffect(() => {
    setEditSummary(requestSummaryText);
    setEditScope(scopeBlock?.content || '');
    setEditExpectedProducts(expectedProductsText);
    setScopeEditing(false);
    // Dong bo lai mac dinh mo/dong THEO DUNG quote vua tai (chi chay 1 lan
    // khi doi quote, khong phai moi render - xem giai thich o khai bao
    // scopeCardOpen ben tren).
    setScopeCardOpen(false);
    // BUG THAT DA GAP ("Bàn giao kỹ thuật không mặc định đóng"): QuoteCenterPage
    // KHONG unmount QuoteWorkspaceModal giua 2 lan mo bao gia khac nhau (chi
    // doi prop quoteId) - component INSTANCE dung lai nguyen, nen state cuc
    // bo handoffCardOpen tung mo o bao gia A se "ro ri" sang bao gia B ke
    // tiep neu khong tu reset khi doi quote. Reset lai o DUNG effect nay
    // (chay moi lan quote?.id doi that su).
    setHandoffCardOpen(false);
    setSummaryItemsCardOpen(false);
    setAccessMode(quote?.publicAccessMode || 'none');
    setAccessEmailsText((quote?.publicAllowedEmails || []).join('\n'));
    setAccessPhonesText((quote?.publicAllowedPhones || []).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  async function saveAccessRestriction() {
    if (!quote) return;
    const emails = accessEmailsText.split(/[\n,;]/).map(e => e.trim()).filter(Boolean);
    const phones = accessPhonesText.split(/[\n,;]/).map(p => p.trim()).filter(Boolean);
    setAccessSaving(true);
    try {
      // BUG THAT DA GAP ("tắt giới hạn nhưng vẫn yêu cầu Email"): fix o day la
      // CHI gui dung 1 `mode` duy nhat (enum) - khong con gui song song 1
      // boolean rieng nen KHONG the xay ra truong hop "tat qua duong nay
      // nhung code khac van doc co cu". Khi mode==='none', backend tu bo qua
      // moi kiem tra Email/SDT (xem get_public_quote()) - khach mo tab an
      // danh la xem duoc ngay, khong con man hinh xac minh nao ca.
      const updated = await seedingQuoteRepository.setPublicAccessRestriction(quote.id, accessMode, emails, phones);
      setQuote(updated);
      showToast(true, 'Đã lưu cấu hình giới hạn xem link.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được cấu hình giới hạn xem link.');
    } finally {
      setAccessSaving(false);
    }
  }

  async function saveScopeSummary() {
    if (!quote) return;
    const blocks = [...(quote.data?.customBlocks || [])];
    const idx = blocks.findIndex(b => b.kind === 'scope_of_work');
    if (editScope.trim()) {
      const newBlock = { id: idx >= 0 ? blocks[idx].id : newBlockId(), kind: 'scope_of_work' as const, title: 'Mô tả scope / yêu cầu cần estimate', content: editScope.trim() };
      if (idx >= 0) blocks[idx] = newBlock;
      else blocks.push(newBlock);
    } else if (idx >= 0) {
      blocks.splice(idx, 1);
    }
    await persistQuote({
      data: { ...quote.data, customBlocks: blocks, requestSummary: editSummary.trim() || undefined, expectedProducts: editExpectedProducts.trim() || undefined },
    }, { silent: true });
    setScopeEditing(false);
  }

  const agentsById = useMemo(() => new Map(agents.map(agent => [agent.id, agent.name])), [agents]);
  function nameFor(id?: string | null): string {
    if (!id) return 'Chưa gán';
    if (id === user?.id && user?.name) return user.name;
    return agentsById.get(id) || 'Không rõ';
  }

  async function load(id: string, opts?: { silent?: boolean }) {
    // "silent" - dung cho reload() sau 1 thao tac nho (gan nguoi phu trach,
    // sua 1 field...) - KHONG duoc bat lai "loading" toan man hinh (truoc day
    // luon bat, khien ca form bi thay bang "Đang tải báo giá..." roi hien lai
    // - giat/nhay y het load lai trang, du chi doi 1 truong nho). Chi lan tai
    // DAU TIEN (mo modal) moi can man hinh loading day du.
    if (!opts?.silent) setLoading(true);
    try {
      const [q, log, hc] = await Promise.all([
        seedingQuoteRepository.getQuote(id),
        seedingQuoteRepository.getQuoteActivityLog(id).catch(() => []),
        seedingQuoteRepository.getQuoteHandoffChecklist(id).catch(() => null),
      ]);
      setQuote(q);
      setActivity(log);
      setChecklist(hc);
      setChecklistDraft(hc || emptyChecklist());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được báo giá.');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  // Chi can kiem tra "da co draft moi hon" khi quote dang xem la approved
  // (chi luc nay nut "Tao phien ban moi" moi enable) - khong goi cho draft/
  // request/technical/pricing/review (chua the tao version moi tu do).
  useEffect(() => {
    let cancelled = false;
    if (!quote || quote.status !== "approved") {
      setExistingDraftVersion(null);
      return;
    }
    seedingQuoteRepository.getQuoteVersions(quote.id).then(versions => {
      if (cancelled) return;
      const draft = versions.find(v => v.status === "draft" && (v.versionNumber || 1) > (quote.versionNumber || 1)) || null;
      setExistingDraftVersion(draft);
    }).catch(() => {
      if (!cancelled) setExistingDraftVersion(null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, quote?.status, quote?.versionNumber]);

  useEffect(() => {
    if (quoteId) {
      void load(quoteId);
    } else {
      setQuote(null);
      setActivity([]);
      setChecklist(null);
      setChecklistDraft(emptyChecklist());
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Danh sach Khach hang (ho so crm_customers that, KHAC voi Deal/Co hoi) -
  // chi can khi mo o che do tao moi. page_size lon vi list nay chi dung de
  // loc nhanh trong 1 dropdown local (giong cach `deals` cua ca trang da
  // load full roi loc client-side), khong phan trang server.
  useEffect(() => {
    if (quoteId) return;
    let alive = true;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers?page=1&page_size=200`, { credentials: 'include', headers })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'load failed');
        return body.data as {
          items?: Array<{
            id: string;
            customer_name?: string;
            company_name?: string;
            phone?: string;
            email?: string;
            address?: string;
            tax_code?: string;
          }>;
        };
      })
      .then(data => {
        if (!alive) return;
        setCustomers(
          (data.items || []).map(row => ({
            id: row.id,
            label: `${row.customer_name || 'Khách hàng chưa tên'}${row.company_name ? ' · ' + row.company_name : ''}`,
            name: row.customer_name,
            companyName: row.company_name,
            phone: row.phone,
            email: row.email,
            address: row.address,
            taxCode: row.tax_code,
          }))
        );
      })
      .catch(() => {
        if (alive) setCustomers([]);
      });
    return () => {
      alive = false;
    };
  }, [quoteId]);

  // "deal"/effectiveCustomerIdForProjects va useEffect ngay duoi day PHAI
  // dung TRUOC bat ky early return nao (vd "if (loading) return" ben duoi) -
  // Rules of Hooks: 1 useEffect nam SAU 1 return co dieu kien se bi SKIP tren
  // nhung render co dieu kien do dung (vd loading=true giua luc load(id) sau
  // khi tao bao gia), gay loi that "change in the order of Hooks" (bug that
  // da xay ra khi bam Luu nhap/Gui yeu cau xu ly trong che do tao moi).
  const deal = quote?.dealId ? effectiveDealsById.get(quote.dealId) : draftDealId ? effectiveDealsById.get(draftDealId) : undefined;

  // Goi y + tu dien email/SDT khach hang cua chinh quote nay (cung nguon voi
  // autofill customerEmail/customerPhone luc tao quote o tren - uu tien ho so
  // Khach hang that, fallback ve Co hoi) - dung de goi y khi Sale bat 1 trong
  // 2 che do gioi han o card "Thông tin phát hành" ma chua nhap gi ca, KHONG
  // tu dong ghi de neu da co du lieu nguoi dung tung nhap.
  const suggestedCustomerEmail = useMemo(() => {
    const customerId = deal?.customerId || draftCustomerId;
    const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
    return customerRecord?.email || deal?.email || '';
  }, [deal, draftCustomerId, customers]);
  const suggestedCustomerPhone = useMemo(() => {
    const customerId = deal?.customerId || draftCustomerId;
    const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
    return customerRecord?.phone || deal?.phone || '';
  }, [deal, draftCustomerId, customers]);

  function setAccessModeAndSuggest(mode: 'none' | 'email' | 'phone') {
    setAccessMode(mode);
    if (mode === 'email' && !accessEmailsText.trim() && suggestedCustomerEmail) {
      setAccessEmailsText(suggestedCustomerEmail);
    } else if (mode === 'phone' && !accessPhonesText.trim() && suggestedCustomerPhone) {
      setAccessPhonesText(suggestedCustomerPhone);
    }
  }

  // Du an cascade THEO KHACH HANG that (Khach hang -> Du an -> Co hoi) - chua
  // biet khach hang (create-mode chua chon, hoac quote da ton tai khong gan
  // Co hoi nao) thi Project luon rong ([]) - disable dropdown, KHONG goi API
  // vo ich.
  const effectiveCustomerIdForProjects = quote ? deal?.customerId : draftCustomerId;
  useEffect(() => {
    if (!effectiveCustomerIdForProjects) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    setProjects(null);
    projectsService.list(effectiveCustomerIdForProjects).then(res => {
      if (!cancelled) setProjects(res.success ? (res.data || []) : []);
    }).catch(() => { if (!cancelled) setProjects([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCustomerIdForProjects]);

  const status = quote ? quoteDisplayStatus(quote, deal) : { key: 'draft' as const, label: 'Yêu cầu mới', className: 'qc-badge-amber' };
  const canEdit = quote ? canWriteDeal(user, deal) || canApproveQuote(user) : true;
  const canApprove = canApproveQuote(user);
  // Admin/leader (dung cho cac cho KHONG lien quan quy tac phe duyet, vd
  // NoStaffConfigured Presale/Sale ben duoi - tach rieng khoi
  // canManageApprovalRules de doi rieng gia tri kia khong lam sai cho nay).
  const isAdminOrLeader = user?.role === 'admin' || user?.role === 'leader';
  // Mirror can_manage_quote_approval_rules() o backend (SUA LAI: chi Admin,
  // khong con Leader) - CHI dung de hien goi y trong card "Quy tắc phê
  // duyệt", sua that da chuyen het sang trang "Cài đặt báo giá" rieng.
  const canManageApprovalRules = user?.role === 'admin';
  const businessCode = deal ? dealBusinessCode(deal) : null;
  const opportunityName = deal ? getServicePackageText(deal.servicePackage) || getPackageText(deal.package) : '';
  const stage = quote?.processingStage || 'request';
  // "Loai bao gia" (yeu cau rieng): sua duoc o Buoc 1 (request/technical, da
  // gop UI thanh "Bàn giao") + Buoc 2 (pricing) - CHI KHOA khi sang Buoc 3
  // "Chờ duyệt" (review); tra ve Buoc 1/2 thi sua lai duoc. Dung quyen chinh
  // bao gia CHUNG (canEdit) - KHONG phu thuoc canEditCostCells/
  // canEditPricingCells (2 quyen do rieng cho Gia von/Gia ban, khac pham vi).
  const canEditQuoteType = canEdit && stage !== 'review';
  const isDraft = quote ? quote.status === 'draft' : true;
  const isCancelled = quote ? status.key === 'lost' : false;
  const hasCostData = Boolean(quote?.hasCostData);
  // Bang hang muc THONG NHAT (Section 4) - 1 bang duy nhat, KHONG con toggle
  // 2 giao dien roi (Thong tin ky thuat / Gia ban) khien Sale khong doi chieu
  // duoc gia von + markup CUNG dong. Cot Gia von luon hien thi tren CUNG dong
  // voi cot Markup/Gia khach; editable/read-only tach theo QUYEN THAT (mirror
  // backend can_edit_technical_quote/can_edit_quote_pricing), KHONG theo tab
  // nguoi dung tu bam. Backend van la lop chan that qua
  // _check_item_field_level_permission - day chi la UX.
  // stage 'review' = dang cho Admin duyet/tra ve - KHONG ai (ke ca Presale/
  // Sale) duoc sua hang muc nua, chi Admin xem READ-ONLY + quyet dinh duyet/
  // tra ve (dung yeu cau "Review/Admin: hien thi Cost+Pricing+Profitability
  // dang read-only"). Sau 'review' (approved) da tu khoa qua isDraft roi.
  const isLockedForReview = stage === 'review';
  // Khoa theo BUOC (moi, SUA LAI lan 2: bo han ngoai le Admin/Leader - khoa
  // that cho TAT CA, khong con bypass): Buoc 1 (request) chi dien Hang
  // muc+SL, CHUA duoc dien Gia von (tu Buoc 2 - technical - tro di moi
  // duoc); Markup/Gia khach CHI dien duoc dung o Buoc 3 (pricing). Backend
  // enforce lai y het qua _check_item_field_level_permission - day chi la
  // UX, khong phai lop chan that.
  // Che do TAO MOI (!quote) gio la man hinh GOP Buoc 1+2 - Gia von phai dien
  // duoc ngay tai day (khong con man "Thong tin ky thuat" rieng nua), du
  // `stage` fallback ve 'request' khi chua co quote that. Quote CU da ton
  // tai nhung con ket o 'request' (truoc khi co thay doi nay) van GIU khoa
  // cho toi khi tu chuyen qua nut "Gửi yêu cầu xử lý" (duong lui cu, xem
  // footer) - tranh mo khoa nham cho du lieu cu chua qua luong moi.
  // Bao gia VERSION MOI (V2, V3...) la BAN SAO cua 1 bao gia DA DUYET - da co
  // san Gia von/Markup/Gia khach day du tu ban nguon ngay luc tao (khong phai
  // rong nhu bao gia tao moi tu dau) - yeu cau nguoi dung xac nhan ro (khong
  // doan): cho sua gia NGAY o Buoc 1 khi tao V2, KHONG bat di lai tu dau
  // luong "Bàn giao kỹ thuật -> Hoàn thiện giá bán" nhu bao gia tao moi hoan
  // toan. Chi ap dung cho quote CO version_number > 1 (that su la 1 phien
  // ban tiep theo trong chuoi) - quote V1/tao moi van giu dung khoa theo
  // stage nhu cu, tranh sua gia non khi chua qua xac nhan ky thuat.
  const isVersionedQuote = (quote?.versionNumber || 1) > 1;
  const costStageOk = !quote || stage !== 'request' || isVersionedQuote;
  const pricingStageOk = stage === 'pricing' || isVersionedQuote;
  const canEditCostCells = canEdit && isDraft && !isLockedForReview && canEditQuoteCost(user, quote) && costStageOk;
  const canEditPricingCells = canEdit && isDraft && !isLockedForReview && canEditQuotePricingFields(user, quote) && pricingStageOk;
  // BUG THAT DA GAP: zonePickerItems truoc day khai bao O TREN (gan
  // catalogPickerItems, ~dong 1248) - nhung lai doc canEditCostCells (khai
  // bao O DUOI, dong nay) ngay trong THAN useMemo, chay NGAY LUC RENDER nen
  // bi crash "Cannot access 'canEditCostCells' before initialization" (Runtime
  // ReferenceError, phat hien khi mo tab "Bảng giá VPS Zone" trong Catalog
  // Picker). Chuyen useMemo nay xuong DAY, SAU khi canEditCostCells da khoi
  // tao xong, va them canEditCostCells vao dependency array (truoc day thieu,
  // se khong re-tinh khi quyen thay doi).
  const zonePickerItems: CatalogPickerListItem[] = useMemo(
    () =>
      (priceBookItems || []).map(item => {
        const preview = previewPriceBookItem({
          costMode: item.costMode,
          unitPriceUsd: item.unitPriceUsd,
          exchangeRate: item.exchangeRate,
          unitPriceVndDirect: item.unitPriceVndDirect,
          importDutyPercent: item.importDutyPercent,
          vatInPercent: item.vatInPercent,
          vatEuPercent: item.vatEuPercent,
          defaultQuantity: item.defaultQuantity,
          defaultRatePercent: item.defaultRatePercent,
          referencePrice: item.referencePrice,
        });
        return {
          id: item.id,
          sku: item.sku,
          name: item.name,
          description: item.description,
          groupName: item.sourceSheet?.startsWith('1.') ? 'Mục I' : item.sourceSheet?.startsWith('2.') ? 'Mục II' : undefined,
          unit: item.unit,
          vatRate: item.vatEuPercent,
          // Bang gia VPS Zone da co san gia von/Rate THAT (khac danh muc noi
          // bo truoc day khong co khai niem cost) - hien luon trong Picker
          // giong het danh muc noi bo, van gate theo canEditCostCells
          // (undefined = an han neu khong du quyen, dung PATTERN da dung o
          // priceBookItemToQuoteItem()).
          costPriceVnd: canEditCostCells ? preview.costUnit ?? null : undefined,
          markupPercent: canEditCostCells ? item.defaultRatePercent ?? null : undefined,
          customerPriceVnd: preview.unitPrice || 0,
          // Lop XEM QUY DOI USD (tham khao) - da tinh THAT o backend bang
          // Decimal (attach_usd_conversion(), price_book_service.py), chi
          // truyen qua day, KHONG tu tinh lai o FE. costPriceUsd gate giong
          // costPriceVnd; customerPriceUsd/exchangeRate KHONG gate (backend
          // da tu strip exchangeRate rieng cho nguoi khong du quyen xem gia
          // von, customerPriceUsd van tinh dung du co bi strip exchangeRate
          // hay khong).
          costPriceUsd: canEditCostCells ? item.costUsd ?? null : undefined,
          customerPriceUsd: item.customerPriceUsd ?? null,
          exchangeRate: item.exchangeRate ?? null,
          alreadyAdded: existingZoneKeys.has(item.id),
        };
      }),
    [priceBookItems, existingZoneKeys, canEditCostCells]
  );
  // "Chưa có/Chưa tính" (khong du du lieu) khac "Không có quyền xem" (bi
  // chan boi apply_quote_field_permissions o backend) - quote moi (chua co
  // quote.id, dang tao) mac dinh coi la duoc xem/sua (draft cua chinh minh).
  const costViewAllowed = quote ? quote.costViewAllowed !== false : true;
  const pricingViewAllowed = quote ? quote.pricingViewAllowed !== false : true;
  const profitabilityViewAllowed = quote ? quote.profitabilityViewAllowed !== false : true;

  // Sau khi chon Co hoi CRM (che do tao moi), tu dien cac field nghiep vu tu
  // CHINH Deal that (khong bia noi dung) - CHI dien field dang TRONG, hoi xac
  // nhan truoc khi ghi de field da co du lieu nguoi dung tu nhap. Deal khong
  // co du lieu cho field nao thi bao ro that (khong de trang im lang khien
  // tuong nut khong hoat dong - dung phan hoi UI da xac nhan can sua).
  function handleSelectDeal(dealId: string) {
    if (dealId === CREATE_NEW_DEAL_OPTION) {
      setDealCreateError('');
      setDealModalOpen(true);
      return;
    }
    setDraftDealId(dealId);
    const selected = dealId ? effectiveDealsById.get(dealId) : undefined;
    // Co hoi da co san Du an -> tu chon dung Du an do (dung yeu cau "Chon
    // Opportunity co project_id: tu chon dung Project").
    if (selected?.projectId) setDraftProjectId(selected.projectId);
    if (!selected) return;

    const needSummary = selected.note?.trim() || selected.nextStep?.trim() || '';
    const needProducts = getServicePackageText(selected.servicePackage) || getPackageText(selected.package) || '';
    let filledAny = false;

    if (needSummary) {
      if (!draftSummary.trim()) {
        setDraftSummary(needSummary);
        filledAny = true;
      } else if (draftSummary.trim() !== needSummary && window.confirm('Tóm tắt nhu cầu đã có nội dung bạn tự nhập. Ghi đè bằng dữ liệu thật từ cơ hội này?')) {
        setDraftSummary(needSummary);
        filledAny = true;
      }
    }
    if (needProducts) {
      if (!draftExpectedProducts.trim()) {
        setDraftExpectedProducts(needProducts);
        filledAny = true;
      } else if (draftExpectedProducts.trim() !== needProducts && window.confirm('Sản phẩm/dịch vụ dự kiến đã có nội dung bạn tự nhập. Ghi đè bằng dữ liệu thật từ cơ hội này?')) {
        setDraftExpectedProducts(needProducts);
        filledAny = true;
      }
    }

    setAutofillMessage(filledAny ? 'Đã nạp thông tin từ cơ hội' : 'Cơ hội chưa có thông tin phạm vi/hạng mục');
    window.setTimeout(() => setAutofillMessage(''), 4000);
  }

  async function createRequest(submitFully: boolean) {
    // Gop Buoc 1 (Yeu cau bao gia) + Buoc 2 (Thong tin ky thuat) lam MOT -
    // cung 1 nguoi (thuong la Presale) dien hang muc VA gia von ngay tai day.
    // 2 nut goi ham nay: header "Lưu / Chỉnh sửa" (submitFully=false, CHI luu
    // ban nhap, giu nguyen o 'request', KHONG bat SLA) va footer "Bàn giao"
    // (submitFully=true, luu VA tu chuyen sang 'technical' ngay, bat dau SLA).
    if (!draftDealId || (!draftFormId && !defaultFormId)) return;
    // Bam "Bàn giao" (submitFully=true) la muon chuyen sang buoc 2 ngay -
    // backend (set_quote_processing_stage) bat buoc phai co sla_due_at hop
    // le (da dat + con trong tuong lai) moi cho chuyen buoc, neu khong se
    // chan luon o day thay vi tao xong quote roi lang le "ket" o buoc 1 (bug
    // that da gap: Sale bam Bàn giao nhung khong thay gi doi, phai tu bam
    // nut du phong "Gửi yêu cầu xử lý" moi hieu ra vi sao).
    if (submitFully) {
      const slaIso = datetimeLocalValueToIso(draftSlaDueAt);
      if (!slaIso || new Date(slaIso).getTime() <= Date.now()) {
        window.alert('Vui lòng đặt SLA / Hạn hoàn tất nội bộ (một thời điểm trong tương lai) trước khi Bàn giao.');
        return;
      }
    }
    setActiveAction(submitFully ? 'handoff' : 'draftSave');
    setBusy(true);
    try {
      const customBlocks = [
        ...(draftScope.trim()
          ? [{ id: newBlockId(), kind: 'scope_of_work' as const, title: 'Mô tả scope / yêu cầu cần estimate', content: draftScope.trim() }]
          : []),
        // Dieu khoan thanh toan/bo sung nguoi dung da nhap TRUOC khi quote
        // that ton tai (che do tao moi) - gop vao cung luc tao, khong bat
        // nguoi dung phai lam lai sau khi luu.
        {
          id: newBlockId(),
          kind: 'payment_terms' as const,
          title: 'Điều khoản thanh toán',
          content: `Thanh toán trong ${draftPaymentTermsDays} ngày kể từ ngày duyệt báo giá.`,
        },
        ...draftExtraTerms.map(t => ({ id: t.id, kind: 'custom_field' as const, title: t.title, content: t.content })),
      ];
      const created = await seedingQuoteRepository.createQuote({
        dealId: draftDealId,
        // Da validate o tren (!draftFormId && !defaultFormId -> return som) -
        // toi day chac chan co 1 trong 2 gia tri, an toan non-null assert.
        quoteFormId: (draftFormId || defaultFormId)!,
        projectId: draftProjectId || null,
        slaDueAt: datetimeLocalValueToIso(draftSlaDueAt),
        quoteTypeCodes: draftQuoteTypeCodes,
        data: {
          quoteTitle: draftTitle.trim() || 'Yêu cầu hỗ trợ báo giá',
          customBlocks,
          // Field noi bo rieng cho luong "Yeu cau ho tro bao gia" - KHONG phai
          // customBlocks (customBlocks la du lieu hien cho khach qua public
          // link/PDF) - luu truc tiep vao `data` (JSONB schema-less, khong can
          // migration) de khong bao gio lo ra ban khach hang.
          requestSummary: draftSummary.trim() || undefined,
          expectedProducts: draftExpectedProducts.trim() || undefined,
          internalRequestNote: draftInternalNote.trim() || undefined,
          // BUG that da fix: khoi "THONG TIN KHACH HANG" tren ban khach truoc
          // day luon rong ([Kinh gui]/[Khach hang]...) du da chon dung Khach
          // hang/Co hoi o tren, vi day la field text tu do rieng cua tung
          // quote (data.customerRecipient...), KHONG tu dong lay tu ho so CRM
          // - copy san tu `deal`/Khach hang da chon luc tao, Sale van sua lai
          // duoc binh thuong neu can khac di.
          // BUG THAT DA GAP LAN 2 ("autofill thi bien mat"): `deal` (Co hoi,
          // bang customer_leads) chi la ban ghi pipeline, cot phone/email/
          // tax_code cua no THUONG XUYEN de trong (Sale khong nhap lai) - chi
          // co address la hay duoc dien. Ho so Khach hang that (crm_customers,
          // tim qua `customers` da fetch o tren) moi la noi luu day du SDT/
          // Email/MST/Dia chi that su - uu tien ho so Khach hang lam nguon
          // chinh, CHI fallback ve field cua deal khi Khach hang khong co du
          // lieu (vd deal.address con nhap tay rieng khac dia chi ho so).
          ...(() => {
            const customerId = deal?.customerId || draftCustomerId;
            const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
            if (!deal && !customerRecord) return {};
            const displayName = customerRecord?.name || deal?.customerName;
            return {
              customerRecipient: displayName || undefined,
              customerCompanyName: customerRecord?.companyName || deal?.companyName || undefined,
              customerContactName: displayName || undefined,
              customerAddress: customerRecord?.address || deal?.address || undefined,
              customerPhone: customerRecord?.phone || deal?.phone || undefined,
              customerEmail: customerRecord?.email || deal?.email || undefined,
              customerTaxCode: customerRecord?.taxCode || deal?.taxCode || undefined,
            };
          })(),
        },
        // Hang muc da nhap truoc khi quote that ton tai (che do tao moi) -
        // gui luon cung luc tao, KHONG bat nguoi dung phai luu roi moi duoc
        // nhap hang muc (yeu cau da xac nhan).
        items: buildItemsPayload(itemsDraft),
      });
      // BUG that da fix: createRequest() gio tu chay ngam ngay khi co hang
      // muc dau tien - rat co the Sale/Presale CHUA KIP chon dropdown Presale/
      // Sale luc do. Neu bo trong ca 2, khong ai la technicalOwnerId/
      // quoteOwnerId cua quote moi tao -> chinh nguoi vua tao lai KHONG sua
      // duoc hang muc cua chinh minh (canEditQuoteCost/PricingFields deu
      // false neu ho khong phai admin/leader/sale-team). Mac dinh gan CHINH
      // nguoi dang tao vao ca 2 vai tro neu chua chon ai - ho tu doi lai binh
      // thuong qua dropdown sau, khong bi khoa ngay chinh du lieu minh vua go.
      const resolvedTechnicalOwnerId = draftTechnicalOwnerId || user?.id;
      const resolvedQuoteOwnerId = draftQuoteOwnerId || user?.id;
      if (resolvedTechnicalOwnerId || resolvedQuoteOwnerId) {
        await seedingQuoteRepository.assignQuoteOwners(created.id, {
          technicalOwnerId: resolvedTechnicalOwnerId || undefined,
          quoteOwnerId: resolvedQuoteOwnerId || undefined,
        });
      }
      // submitFully=true (nut "Bàn giao"): tu dong chuyen processing_stage tu
      // 'request' -> 'technical' ngay sau khi tao - day chinh la moc SLA bat
      // dau tinh (sla_started_at chi set o lan dau request->technical, xem
      // set_quote_processing_stage). SLA da duoc validate hop le O TREN
      // (truoc khi tao quote) khi submitFully=true, nen toi day chac chan
      // chuyen buoc duoc - khong con nhanh "im lang bo qua" nua. submitFully
      // =false (nut header "Lưu / Chỉnh sửa"): CHI luu ban nhap, KHONG chuyen
      // buoc - giu nguyen o 'request' de Sale con sua thoai mai.
      let advancedToTechnical = false;
      if (submitFully) {
        try {
          await seedingQuoteRepository.setQuoteProcessingStage(created.id, 'technical');
          advancedToTechnical = true;
        } catch (stageErr) {
          window.alert(
            (stageErr instanceof Error ? stageErr.message : 'Không chuyển được sang bước Thông tin kỹ thuật.') +
              ' Báo giá đã được lưu — bạn có thể tự bấm "Bàn giao" trong workspace sau khi sửa.'
          );
        }
      }
      await onChanged();
      // Sale co the da tick san checklist ban giao (Scope/Cost/Timeline/
      // Assumption) NGAY tu luc con o Buoc 1, TRUOC khi quote tu tao xong -
      // luu lai truoc khi load() ben duoi lam mat (load() luon nap checklist
      // THAT tu server, luc nay chi la record rong vua tao, se de mat trang
      // tick cuc bo neu khong luu lai truoc).
      const pendingChecklist = checklistDraft;
      const hasChecklistInput = Boolean(
        pendingChecklist.scopeConfirmed || pendingChecklist.costConfirmed ||
        pendingChecklist.timelineConfirmed || pendingChecklist.assumptionConfirmed ||
        pendingChecklist.scopeNote?.trim() || pendingChecklist.costNote?.trim() ||
        pendingChecklist.timelineNote?.trim() || pendingChecklist.assumptionNote?.trim() ||
        pendingChecklist.handoffNote?.trim()
      );
      // silent:true - tranh giat/nhay y het reload() (xem comment o load()) -
      // vua tao xong quote, form dang hien day du du lieu, khong can che het
      // bang man hinh "Đang tải báo giá..." roi hien lai.
      await load(created.id, { silent: true });
      if (hasChecklistInput) {
        try {
          const saved = await seedingQuoteRepository.saveQuoteHandoffChecklist(created.id, {
            scopeConfirmed: pendingChecklist.scopeConfirmed,
            scopeNote: pendingChecklist.scopeNote,
            costConfirmed: pendingChecklist.costConfirmed,
            costNote: pendingChecklist.costNote,
            timelineConfirmed: pendingChecklist.timelineConfirmed,
            timelineNote: pendingChecklist.timelineNote,
            assumptionConfirmed: pendingChecklist.assumptionConfirmed,
            assumptionNote: pendingChecklist.assumptionNote,
            handoffNote: pendingChecklist.handoffNote,
          });
          setChecklist(saved);
          setChecklistDraft(saved);
        } catch {
          // Khong critical - Sale van tu tick lai binh thuong o Buoc 2/3 duoc.
        }
      }
      // Bam "Bàn giao" tuc la Presale coi nhu DA XONG ca hang muc lan gia
      // von NGAY tai buoc gop (bubble "Yêu cầu & Kỹ thuật") - neu moi thu da
      // du dieu kien (dung DUNG dieu kien RPC quote_set_processing_stage,
      // migration 090, se kiem tra that: co scope, co hang muc, SL>0, da
      // nhap gia von hoac tick "khong ap dung", checklist 4/4) thi chuyen
      // luon tiep sang 'pricing' TRONG CUNG 1 lan bam - tranh nguoi dung
      // tuong "bam bàn giao xong roi" ma van con ket o bubble buoc 1 (bug
      // that da gap: du da chuyen 'technical' that su duoi DB, bubble van
      // hien "current" vi bubble nay gop chung request+technical). Neu con
      // thieu dieu kien nao, IM LANG dung lai o 'technical' - nut "Bàn giao
      // xử lý giá" rieng trong workspace van con do de Sale/Presale tu bam
      // tiep sau khi bo sung du.
      if (submitFully && advancedToTechnical) {
        const realDraftItems = itemsDraft.filter(item => item.rowType !== 'section');
        const stillMissingCost = realDraftItems.some(item => !item.costNotApplicable && item.costPrice == null);
        const stillMissingQty = realDraftItems.some(item => !(item.quantity > 0));
        const finalChecklist = hasChecklistInput ? pendingChecklist : checklistDraft;
        const checklistReady = Boolean(
          finalChecklist.scopeConfirmed && finalChecklist.costConfirmed &&
          finalChecklist.timelineConfirmed && finalChecklist.assumptionConfirmed
        );
        // Ly do CU THE khien chua chuyen tiep duoc sang 'pricing' - hien ro
        // cho nguoi dung (KHONG im lang nua, bug that da gap: nguoi dung
        // khong hieu vi sao bam "Bàn giao" xong van con nut "Bàn giao xử lý
        // giá" o Buoc 1, tuong he thong bi loi).
        const blockingReasons = [
          realDraftItems.length === 0 ? 'chưa có hạng mục nào' : null,
          stillMissingQty ? 'còn hạng mục chưa nhập số lượng' : null,
          stillMissingCost ? 'còn hạng mục chưa nhập giá vốn (hoặc chưa tick "Không áp dụng")' : null,
          !checklistReady ? 'checklist bàn giao chưa tick đủ 4 mục' : null,
        ].filter((reason): reason is string => Boolean(reason));
        if (blockingReasons.length === 0) {
          try {
            await seedingQuoteRepository.setQuoteProcessingStage(created.id, 'pricing');
            // BUG THAT DA GAP ("không được mặc định hoàn thành Bước 1 là luôn
            // điều hướng sang Bước 2") - dung y het logic o handoffStep1ToPricing()
            // (quote da ton tai): so sale_user_id (resolvedQuoteOwnerId) voi
            // current_user_id (user?.id) bang ID THAT, khong so ten.
            const currentUserId = user?.id || null;
            if (resolvedQuoteOwnerId && currentUserId && resolvedQuoteOwnerId === currentUserId) {
              await load(created.id, { silent: true });
            } else {
              showToast(
                true,
                resolvedQuoteOwnerId
                  ? `Đã hoàn thành Bước 1 và bàn giao cho ${nameFor(resolvedQuoteOwnerId)}.`
                  : 'Đã hoàn thành Bước 1. Báo giá đang chờ phân công Sale.'
              );
              window.setTimeout(() => {
                markClosingIntent();
                onClose();
              }, 1200);
            }
          } catch (pricingErr) {
            showToast(false, `Đã lưu, nhưng chưa chuyển được sang "Hoàn thiện giá bán": ${pricingErr instanceof Error ? pricingErr.message : 'lỗi không xác định'}. Bổ sung rồi bấm "Bàn giao" lại.`);
          }
        } else {
          showToast(false, `Đã lưu, nhưng CHƯA sang được "Hoàn thiện giá bán" vì: ${blockingReasons.join(', ')}. Bổ sung rồi bấm "Bàn giao" lại.`);
        }
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được yêu cầu hỗ trợ báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  // SUA LAI lan 2 (bo tu dong): Sale phan hoi la tu dong tao ngam ngay khi co
  // hang muc dau tien lam form GIAT/RELOAD giua luc dang go du da them dieu
  // kien "phai co noi dung" - van con dinh do khong on. Quay lai bam nut ro
  // rang ("Tạo báo giá") thay vi tu chay ngam - Sale tu quyet dinh luc nao
  // xong de bam, khong bi ngat ngang khi dang nhap lieu nua.

  async function reload() {
    if (!quote) return;
    await load(quote.id, { silent: true });
    await onChanged();
  }

  function stageState(target: QuoteProcessingStage): 'done' | 'current' | 'upcoming' | 'halted' {
    if (isCancelled) return 'halted';
    if (!isDraft) return 'done'; // da duyet/confirmed -> ca 4 buoc coi nhu da qua
    const currentIdx = STAGE_ORDER.indexOf(stage);
    const idx = STAGE_ORDER.indexOf(target);
    if (idx < currentIdx) return 'done';
    if (idx === currentIdx) return 'current';
    return 'upcoming';
  }

  // Buoc 4 dung CHUNG 1 gia tri DB 'review' (chi co 4 gia tri trong
  // processing_stage) cho ca "dang cho duyet" LAN "da duyet, san sang phat
  // hanh" - phan biet bang label hien thi (KHONG them gia tri DB moi):
  // quote.status='approved' -> "San sang phat hanh", con lai (draft o buoc
  // review) -> "Cho duyet".
  function stageLabel(target: QuoteProcessingStage): string {
    // Gio da co state THAT rieng (migration 087/089: ready_to_publish/
    // published) - khong con phai dung nhan FE gia tren cung 1 gia tri DB
    // 'review' nua, doc thang tu quote.processingStage that.
    if (target === 'review') {
      if (quote?.processingStage === 'published') return 'Đã phát hành';
      if (quote?.processingStage === 'ready_to_publish') return 'Đã duyệt · Chưa phát hành';
    }
    return STAGE_LABELS[target];
  }

  // Nhan card "Pham vi" doi theo DUNG phase - truoc day dung chung 1 label
  // cho moi phase ("Yêu cầu & phạm vi công việc"), gay sai ngu canh o
  // technical/pricing/locked (khong con la "yeu cau" nua, ma la pham vi da
  // CHOT/da BAN GIAO). KHONG giu text sai chi vi test cu key cung vao no -
  // test phai tro qua data-testid="qc-scope-card-title" (xem JSX).
  function scopeCardLabel(target: QuoteProcessingStage): string {
    if (target === 'technical') return 'Phạm vi kỹ thuật';
    if (target === 'pricing') return 'Phạm vi đã bàn giao';
    if (target === 'review' || target === 'ready_to_publish' || target === 'published') return 'Phạm vi công việc';
    return 'Yêu cầu & phạm vi công việc';
  }

  function stageOwnerName(target: QuoteProcessingStage): string {
    if (!quote) {
      if (target === 'request') return nameFor(user?.id);
      if (target === 'technical') return nameFor(draftTechnicalOwnerId);
      if (target === 'pricing') return nameFor(draftQuoteOwnerId);
      return 'Chưa duyệt';
    }
    if (target === 'request') return nameFor(quote.createdById);
    if (target === 'technical') return ownerNameFor(quote.technicalOwnerId);
    if (target === 'pricing') return ownerNameFor(quote.quoteOwnerId);
    if (quote.processingStage === 'published') return nameFor(quote.publishedById);
    return nameFor(quote.approvedById);
  }

  function stageTimeLabel(target: QuoteProcessingStage): string {
    if (!quote) return target === 'request' ? 'Đang soạn' : '';
    if (target === 'request') return relativeTime(quote.createdAt);
    if (target === 'technical') return relativeTime(checklist?.updatedAt || quote.updatedAt);
    if (target === 'pricing') return relativeTime(quote.updatedAt);
    if (!quote.approvedAt) return 'Chưa duyệt';
    if (quote.processingStage === 'published' && quote.publishedAt) return relativeTime(quote.publishedAt);
    return relativeTime(quote.approvedAt);
  }

  async function assignOwner(field: 'technicalOwnerId' | 'quoteOwnerId', value: string) {
    setBusy(true);
    try {
      await seedingQuoteRepository.assignQuoteOwners(quote!.id, { [field]: value || null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gán được người phụ trách.');
    } finally {
      setBusy(false);
    }
  }

  // <input type="datetime-local"> lam viec theo GIO DIA PHUONG cua trinh
  // duyet, con quote.slaDueAt la ISO UTC - PHAI tu doi 2 chieu, khong duoc
  // .slice(0,16) truc tiep (se lech dung bang so gio UTC offset cua nguoi
  // dung, vd sai 7 tieng o VN).
  function isoToDatetimeLocalValue(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function datetimeLocalValueToIso(value: string): string | null {
    if (!value) return null;
    const d = new Date(value); // parse nhu gio dia phuong (dung hanh vi cua datetime-local)
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  async function updateQuoteSlaDueAt(localValue: string) {
    const iso = datetimeLocalValueToIso(localValue);
    setBusy(true);
    try {
      await seedingQuoteRepository.updateQuote(quote!.id, { slaDueAt: iso });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được SLA.');
    } finally {
      setBusy(false);
    }
  }

  async function updateQuoteProject(projectId: string) {
    setBusy(true);
    try {
      await seedingQuoteRepository.updateQuote(quote!.id, { projectId: projectId || null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gán được dự án.');
    } finally {
      setBusy(false);
    }
  }

  async function advanceStage(target: QuoteProcessingStage) {
    // Chi con dung cho 'review' (Hoan tat phan gia ban) - hop request-
    // >technical->pricing gio di qua handoffStep1ToPricing() rieng (nut
    // "Bàn giao" hop nhat Buoc 1), khong con goi ham nay voi 'technical' nua.
    setActiveAction('reviewPricing');
    setBusy(true);
    try {
      await seedingQuoteRepository.setQuoteProcessingStage(quote!.id, target);
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không chuyển được bước xử lý.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function saveChecklist() {
    if (!checklistDraft) return;
    setActiveAction('draftSave');
    setBusy(true);
    try {
      const saved = await seedingQuoteRepository.saveQuoteHandoffChecklist(quote!.id, {
        scopeConfirmed: checklistDraft.scopeConfirmed,
        scopeNote: checklistDraft.scopeNote,
        costConfirmed: checklistDraft.costConfirmed,
        costNote: checklistDraft.costNote,
        timelineConfirmed: checklistDraft.timelineConfirmed,
        timelineNote: checklistDraft.timelineNote,
        assumptionConfirmed: checklistDraft.assumptionConfirmed,
        assumptionNote: checklistDraft.assumptionNote,
        handoffNote: checklistDraft.handoffNote,
      });
      setChecklist(saved);
      setChecklistDraft(saved);
      await onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được checklist bàn giao.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  // BUG THAT DA GAP (phan anh tu nguoi dung): quote da luu (khong phai vua
  // tao) dang o Buoc 1 gop ("Yêu cầu & Kỹ thuật") nhung UI van bat bam HAI
  // nut lien tiep - "Gửi yêu cầu xử lý" (request->technical, UI KHONG doi vi
  // van con Buoc 1) roi moi hien "Bàn giao xử lý giá" (technical->pricing,
  // luc nay UI moi qua Buoc 2) - nhin nhu Buoc 1 bi lap lai 2 lan. Gop lam
  // MOT hanh dong "Bàn giao" duy nhat cho ca 2 truong hop (stage='request'
  // HOAC 'technical'): luu toan bo du lieu dang sua truoc, chuyen
  // request->technical NEU con o request (khong hien rieng buoc nay ra UI -
  // bubble 1 van gop chung ca 2), roi chuyen tiep technical->pricing luon -
  // CHI 1 lan bam la xong, giong dung hanh vi cua nut "Bàn giao" luc tao moi
  // (createRequest). That bai o buoc nao (vd thieu scope/checklist chua du)
  // thi dung lai dung do, KHONG mat du lieu, bam lai se tu bo qua buoc da
  // xong (processingStage da doc lai tu response, khong goi lai buoc thua).
  async function handoffStep1ToPricing() {
    if (busy || !quote) return;
    if (quote.processingStage === 'request' && !quote.slaDueAt) {
      window.alert('Cần đặt SLA / hạn hoàn tất nội bộ trước khi Bàn giao.');
      return;
    }
    if (itemsMissingCost.length > 0) {
      window.alert(`Còn ${itemsMissingCost.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu "Không áp dụng giá vốn". Vui lòng bổ sung trước khi bàn giao.`);
      return;
    }
    setActiveAction('handoff');
    setBusy(true);
    try {
      const savedQuote = await seedingQuoteRepository.updateQuote(quote.id, {
        data: quote.data,
        items: buildItemsPayload(itemsDraft),
      });
      setQuote(savedQuote);

      if (checklistDraft && checklistDirty) {
        const savedChecklist = await seedingQuoteRepository.saveQuoteHandoffChecklist(quote.id, {
          scopeConfirmed: checklistDraft.scopeConfirmed,
          scopeNote: checklistDraft.scopeNote,
          costConfirmed: checklistDraft.costConfirmed,
          costNote: checklistDraft.costNote,
          timelineConfirmed: checklistDraft.timelineConfirmed,
          timelineNote: checklistDraft.timelineNote,
          assumptionConfirmed: checklistDraft.assumptionConfirmed,
          assumptionNote: checklistDraft.assumptionNote,
          handoffNote: checklistDraft.handoffNote,
        });
        setChecklist(savedChecklist);
        setChecklistDraft(savedChecklist);
      }

      // Neu van con o 'request' (chua tung Gui yeu cau xu ly lan nao), tu
      // chuyen sang 'technical' TRUOC (day chinh la moc bat SLA that -
      // set_quote_processing_stage chi set sla_started_at o LAN DAU tien
      // request->technical, Admin tra ve 'technical' sau nay se KHONG bi bat
      // lai SLA lan 2 vi da co sla_started_at tu truoc). KHONG reload/doi UI
      // giua chung - bubble 1 van gop ca 2 stage nay, nguoi dung khong can
      // thay buoc trung gian.
      if (savedQuote.processingStage === 'request') {
        await seedingQuoteRepository.setQuoteProcessingStage(quote.id, 'technical');
      }
      const finalQuote = await seedingQuoteRepository.setQuoteProcessingStage(quote.id, 'pricing');
      if (finalQuote.processingStage !== 'pricing') {
        throw new Error('Chưa thể hoàn tất bàn giao. Vui lòng thử lại.');
      }

      // BUG THAT DA GAP ("không được mặc định hoàn thành Bước 1 là luôn điều
      // hướng sang Bước 2"): truoc day luon `await reload()` roi de nguyen UI
      // hien buoc moi nhat cua quote (pricing) - Presale KHONG phai Sale
      // duoc phan cong cung bi "keo theo" sang man hinh Buoc 2 (thuc chat
      // khong lam gi duoc o do vi khong co quyen sua Buoc 2). Dung DUNG
      // sale_user_id (quote.quoteOwnerId) so voi current_user_id (user?.id)
      // - so bang ID THAT, KHONG so ten/email/text role.
      const saleUserId = finalQuote.quoteOwnerId || null;
      const currentUserId = user?.id || null;
      if (saleUserId && currentUserId && saleUserId === currentUserId) {
        // Truong hop 1: 1 nguoi kiem ca Presale+Sale - giu popup mo, tu nhay
        // sang Buoc 2 (reload() tai lai quote/checklist/activity moi nhat,
        // UI tu ve dung stage='pricing' vi da co san logic theo stage).
        await reload();
      } else {
        // Truong hop 2/3: Sale la nguoi khac (hoac chua gan Sale) - KHONG
        // dieu huong Presale sang Buoc 2. Hien toast xac nhan TRUOC, roi moi
        // dong popup sau 1 khoang ngan de nguoi dung con kip doc toast (dong
        // ngay lap tuc se lam bien mat toast chua kip hien - modal se
        // unmount cung luc voi state toast).
        showToast(
          true,
          saleUserId
            ? `Đã hoàn thành Bước 1 và bàn giao cho ${nameFor(saleUserId)}.`
            : 'Đã hoàn thành Bước 1. Báo giá đang chờ phân công Sale.'
        );
        window.setTimeout(() => {
          markClosingIntent();
          onClose();
        }, 1200);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Chưa thể hoàn tất bàn giao. Vui lòng thử lại.');
      // Du that bai o buoc nao, tai lai du lieu THAT tu server (co the da
      // qua duoc request->technical) - khong de UI dung sai lech voi DB
      // that. Popup GIU NGUYEN MO (khong dong) - dung yeu cau "Nếu API lỗi
      // thì giữ popup mở, giữ nguyên dữ liệu" - nguoi dung tu bam "Bàn giao"
      // lai de thu lai (dong vai tro nut "thu lai").
      await reload();
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function approveNow() {
    if (busy) return; // chong double-click
    setActiveAction('approve');
    setBusy(true);
    try {
      // Duyet KHONG con tu bat public link nua (tach rieng khoi publish, xem
      // quote_approve RPC migration 089) - sau khi duyet processingStage se
      // la 'ready_to_publish', PHAI bam "Phat hanh" rieng moi co public link that.
      await seedingQuoteRepository.approveQuote(quote!.id);
      setApproveModalOpen(false);
      await reload();
    } catch (err) {
      if (err instanceof QuoteApprovalRequiresExceptionError) {
        // Rule Engine khong dat - dong modal duyet thuong, mo modal "Phê
        // duyệt ngoại lệ" rieng (Section 5), bat nhap ly do.
        setApproveModalOpen(false);
        setExceptionApprovalModal({ open: true, reason: '', evaluation: err.evaluation });
        return;
      }
      window.alert(err instanceof Error ? err.message : 'Không duyệt được báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function approveWithExceptionNow() {
    if (busy) return;
    const reason = exceptionApprovalModal.reason.trim();
    if (!reason) {
      window.alert('Vui lòng nhập lý do phê duyệt ngoại lệ.');
      return;
    }
    setActiveAction('approve');
    setBusy(true);
    try {
      await seedingQuoteRepository.approveQuote(quote!.id, reason);
      setExceptionApprovalModal({ open: false, reason: '', evaluation: null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không duyệt ngoại lệ được báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function publishNow() {
    if (busy) return;
    setActiveAction('publish');
    setBusy(true);
    try {
      await seedingQuoteRepository.publishQuote(quote!.id);
      setPublishModalOpen(false);
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không phát hành được báo giá.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function requestChangesNow() {
    if (busy) return;
    if (!requestChangesReason.trim()) {
      window.alert('Vui lòng nhập lý do yêu cầu chỉnh sửa.');
      return;
    }
    setActiveAction('requestChanges');
    setBusy(true);
    try {
      await seedingQuoteRepository.requestQuoteChanges(quote!.id, requestChangesSection, requestChangesReason.trim());
      setRequestChangesModalOpen(false);
      setRequestChangesReason('');
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không gửi được yêu cầu chỉnh sửa.');
    } finally {
      setBusy(false);
      setActiveAction(null);
    }
  }

  async function copyPublicLink() {
    if (!quote!.publicUrl) return;
    await navigator.clipboard.writeText(`${window.location.origin}${quote!.publicUrl}`);
    showToast(true, 'Đã sao chép link báo giá.');
  }

  // "Khoá link báo giá" - yeu cau rieng "gui khach xong lam sao khoa link lai
  // duoc" (endpoint /revoke-public da co san o backend/repository tu truoc,
  // dung o menu "..." tren trang Danh sach bao gia - nhung CHUA co trong
  // Quote Workspace, dung nga can nguoi dung nhat khi ho dang xem chinh link
  // vua gui). Dung lai API cu, chi them nut + cap nhat lai state tai cho.
  async function revokePublicLinkFromWorkspace() {
    if (!quote) return;
    if (!window.confirm('Khoá link báo giá này? Khách hàng sẽ không truy cập được link cũ nữa cho tới khi bạn gửi lại.')) return;
    setBusy(true);
    try {
      const updated = await seedingQuoteRepository.revokePublicQuote(quote.id);
      setQuote(updated);
      showToast(true, 'Đã khoá link báo giá.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không khoá được link báo giá.');
    } finally {
      setBusy(false);
    }
  }

  // "Mở lại link báo giá" - yeu cau rieng ("khóa link rồi ... k thấy nút mở
  // link nha bro"): truoc day chi co chieu khoa (tren), khong co cach nao mo
  // lai link cu ma khong lam gi ca - gio dung API moi (/enable-public,
  // migration 115), giu nguyen public_token cu nen link cu hoat dong lai y
  // het, khong can gui lai link moi cho khach.
  async function enablePublicLinkFromWorkspace() {
    if (!quote) return;
    setBusy(true);
    try {
      const updated = await seedingQuoteRepository.enablePublicQuote(quote.id);
      setQuote(updated);
      showToast(true, 'Đã mở lại link báo giá.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không mở lại được link báo giá.');
    } finally {
      setBusy(false);
    }
  }

  function newSendIdempotencyKey(quoteId: string): string {
    return `${quoteId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function viewDeliveryLog() {
    if (!quote) return;
    setDeliveryLogModal({ open: true, loading: true, entries: [], error: null });
    try {
      const entries = await seedingQuoteRepository.getQuoteDeliveryLog(quote.id);
      setDeliveryLogModal({ open: true, loading: false, entries, error: null });
    } catch (err) {
      setDeliveryLogModal({ open: true, loading: false, entries: [], error: err instanceof Error ? err.message : 'Không tải được lịch sử gửi.' });
    }
  }

  // Mo popup "Gui khach hang" - LUON mo duoc (du thieu recipient), CHI nut
  // submit ben trong bi disable neu thieu du lieu (dung yeu cau "Thieu
  // recipient -> mo popup nhung submit disabled", KHONG chan mo popup).
  async function openSendModal() {
    if (!quote) return;
    setSendError(null);
    setSendSuccess(false);
    setSendAttachPdf(false);
    setSendMessage('');
    setSendRecipientName('');
    setSendRecipientEmail('');
    setSendRecipientSource(null);
    setSendSubject(`Báo giá ${quote.quoteNumber}${quote.data?.quoteTitle ? ` · ${quote.data.quoteTitle}` : ''}`);
    setSendIdempotencyKey(newSendIdempotencyKey(quote.id));
    setSendModalOpen(true);
    try {
      const suggestion = await seedingQuoteRepository.getQuoteRecipientSuggestion(quote.id);
      setSendRecipientName(suggestion.name || '');
      setSendRecipientEmail(suggestion.email || '');
      setSendRecipientSource(suggestion.source);
    } catch {
      // Khong chan mo popup neu goi y that bai - nguoi dung tu nhap tay.
    }
  }

  async function submitSendQuote() {
    if (!quote || sendBusy) return;
    if (!sendRecipientEmail.trim()) {
      setSendError('Vui lòng nhập email người nhận.');
      return;
    }
    setSendBusy(true);
    setSendError(null);
    try {
      const result = await seedingQuoteRepository.sendQuoteEmail(quote.id, {
        recipientName: sendRecipientName.trim() || null,
        recipientEmail: sendRecipientEmail.trim(),
        recipientSource: sendRecipientSource,
        subject: sendSubject,
        message: sendMessage,
        attachPdf: sendAttachPdf,
        idempotencyKey: sendIdempotencyKey,
      });
      if (result.status === 'sent') {
        setSendSuccess(true);
        await reload();
      } else {
        setSendError(result.errorMessage || 'Gửi email thất bại.');
        setSendIdempotencyKey(newSendIdempotencyKey(quote.id));
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Gửi email thất bại.');
      setSendIdempotencyKey(newSendIdempotencyKey(quote.id));
    } finally {
      setSendBusy(false);
    }
  }

  async function confirmCreateVersion() {
    setBusy(true);
    try {
      const result = await seedingQuoteRepository.createQuoteVersion(quote!.id);
      setVersionModalOpen(false);
      if (result.redirectedFromClickedQuote) {
        window.alert(`Chuỗi báo giá đã có bản duyệt mới hơn (V${result.sourceVersionNumber}) — đã tạo phiên bản mới từ bản đó.`);
      } else if (!result.created) {
        window.alert('Chuỗi này đã có bản nháp sẵn — mở bản nháp đó.');
      } else {
        try {
          await seedingQuoteRepository.logQuoteVersionReason(result.quote.id, versionReason);
        } catch {
          // Khong chan luong neu ghi ly do that bai - version van da tao dung that.
        }
      }
      await onChanged();
      await load(result.quote.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tạo được phiên bản báo giá mới.');
    } finally {
      setBusy(false);
    }
  }

  // Nut "Tao phien ban moi" LUON hien o header (dong nhat voi HTML tham
  // khao), nhung CHI enable khi bao gia THAT SU dang o status='approved' va
  // chua chot/huy - moi truong hop khac disabled kem tooltip giai thich dung
  // ly do that (khong an nut, khong copy loi HTML "BG-MOI/V1 nhung nut ghi
  // tu V4"). Nhan label CHI doc quote.versionNumber THAT khi bao gia da ton
  // tai - KHONG BAO GIO hien so gia trong che do tao moi.
  const versionButtonState = (() => {
    if (!quote) {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Cần lưu và duyệt báo giá trước khi tạo phiên bản mới.' };
    }
    if (status.key === 'lost') {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Báo giá đã huỷ, không thể tạo phiên bản mới.' };
    }
    if (status.key === 'won') {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Báo giá đã chốt, không thể tạo phiên bản mới.' };
    }
    if (quote.status !== 'approved') {
      return { disabled: true, label: 'Tạo phiên bản mới', tooltip: 'Chỉ báo giá đã duyệt mới có thể tạo phiên bản mới.' };
    }
    if (existingDraftVersion) {
      return { disabled: false, label: `Tiếp tục chỉnh sửa V${existingDraftVersion.versionNumber || ''}`, tooltip: undefined, continueExisting: true as const };
    }
    return { disabled: false, label: `Tạo phiên bản mới từ V${quote.versionNumber || 1}`, tooltip: undefined };
  })();

  const rootItems = quote?.items || [];
  // Muc cha (Section, migration 104) KHONG tinh tien, khong bat nhap SL/gia
  // von/markup - loai hoan toan khoi moi kiem tra nghiep vu (thieu gia von,
  // dem so hang muc...) giong dung cach RPC backend loai no qua `row_type =
  // 'item'`, tranh dem nham 1 dong tieu de la "hang muc thieu du lieu".
  const realItemsDraft = itemsDraft.filter(item => item.rowType !== 'section');
  // Hang muc "thieu gia von" = chua nhap costPrice VA chua tick "khong ap
  // dung" - dung DUNG dieu kien RPC quote_set_processing_stage (migration
  // 090) validate ('quote_item_missing_cost_price') de nut FE disable/thong
  // bao KHOP voi that su backend se chan hay khong (khong doan mo ho).
  const itemsMissingCost = realItemsDraft.filter(item => !item.costNotApplicable && item.costPrice == null);
  // "Co thay doi chua luu" - so sanh dung 9 field thuc su gui len
  // saveQuoteHandoffChecklist(), KHONG so sanh nguyen object (co the lech field
  // metadata nhu updatedAt lam sai lech ket qua so sanh).
  const checklistDirty = Boolean(
    checklistDraft && (
      checklistDraft.scopeConfirmed !== (checklist?.scopeConfirmed ?? false) ||
      (checklistDraft.scopeNote || '') !== (checklist?.scopeNote || '') ||
      checklistDraft.costConfirmed !== (checklist?.costConfirmed ?? false) ||
      (checklistDraft.costNote || '') !== (checklist?.costNote || '') ||
      checklistDraft.timelineConfirmed !== (checklist?.timelineConfirmed ?? false) ||
      (checklistDraft.timelineNote || '') !== (checklist?.timelineNote || '') ||
      checklistDraft.assumptionConfirmed !== (checklist?.assumptionConfirmed ?? false) ||
      (checklistDraft.assumptionNote || '') !== (checklist?.assumptionNote || '') ||
      (checklistDraft.handoffNote || '') !== (checklist?.handoffNote || '')
    )
  );
  const handoffBadge = checklist?.handedOffAt ? 'Đã bàn giao' : (checklist && (checklist.scopeConfirmed || checklist.costConfirmed || checklist.timelineConfirmed || checklist.assumptionConfirmed)) ? 'Cần bổ sung' : 'Chưa bàn giao';
  const paymentTermsBlock = (quote?.data?.customBlocks || []).find(block => block.kind === 'payment_terms' && block.content.trim());
  const canReadyForApproval = Boolean(quote && rootItems.length > 0 && quote.totalAmount > 0);

  // "Xem ban khach hang" theo dung nguyen tac: nut LUON hien, chi disable +
  // tooltip khi chua du dieu kien - khong an nut. Dieu kien du: da chon
  // khach hang/co hoi (draftDealId o create-mode, hoac quote.dealId khi da
  // ton tai) VA co it nhat 1 hang muc trong itemsDraft (bao gom ca thay doi
  // CHUA luu, dung yeu cau "preview tu state hien tai").
  // Quote da ton tai (du draft/pricing/approved) chi can co hang muc la du -
  // KHONG bat buoc phai co Deal (bao gia co the dung doc lap, khong gan Deal
  // van la 1 trang thai that). Rieng CREATE-MODE moi bat buoc them dieu
  // kien "da chon khach hang/co hoi" vi luc nay chua co gi ngoai draft.
  const canPreview = quote ? itemsDraft.length > 0 : Boolean(draftDealId) && itemsDraft.length > 0;
  const previewDisabledReason = !canPreview
    ? 'Thêm thông tin khách hàng và hạng mục để xem bản khách hàng'
    : undefined;

  // BUG THAT DA GAP ("bấm Preview khách hàng ở bước 1 ra bảng cũ chứ không
  // hiện bản PDF"): modal xem truoc truoc day CHI dung QuoteDocumentRenderer
  // (giong PDF/public that) khi `quote.formSnapshot` co - tuc CHI sau khi da
  // bam Luu/Ban giao it nhat 1 lan (quote that su ton tai trong DB). Truoc
  // do (che do tao moi, quote con null) roi ve ban rut gon 4 cot cu, du
  // nguoi dung DA CHON mau bao gia qua dropdown "Mẫu báo giá" (draftFormId)
  // roi - schema DA BIET, chi la chua duoc luu thanh quote.formSnapshot. Xay
  // "ban nhap" cua schema + du lieu tu chinh cac state dang go (draftTitle/
  // draftScope/draftCustomerId...) - GIONG HET logic build payload luc bam
  // "Bàn giao" that su (xem createRequest(), dong ~2179-2241) - de Preview
  // dung DUNG renderer/schema tu buoc 1, khong con phan biet "truoc/sau khi
  // luu" nua.
  const draftSelectedForm = useMemo(
    () => quoteForms.find(f => f.id === (draftFormId || defaultFormId)),
    [quoteForms, draftFormId, defaultFormId]
  );
  const draftPreviewData = useMemo(() => {
    const customerId = deal?.customerId || draftCustomerId;
    const customerRecord = customerId ? customers.find(c => c.id === customerId) : undefined;
    const displayName = customerRecord?.name || deal?.customerName;
    const customBlocks = [
      ...(draftScope.trim()
        ? [{ id: 'preview-scope', kind: 'scope_of_work' as const, title: 'Mô tả scope / yêu cầu cần estimate', content: draftScope.trim() }]
        : []),
      {
        id: 'preview-payment',
        kind: 'payment_terms' as const,
        title: 'Điều khoản thanh toán',
        content: `Thanh toán trong ${draftPaymentTermsDays} ngày kể từ ngày duyệt báo giá.`,
      },
      ...draftExtraTerms.map(t => ({ id: t.id, kind: 'custom_field' as const, title: t.title, content: t.content })),
    ];
    return {
      quoteTitle: draftTitle.trim() || 'Yêu cầu hỗ trợ báo giá',
      customBlocks,
      ...(deal || customerRecord
        ? {
            customerRecipient: displayName || undefined,
            customerCompanyName: customerRecord?.companyName || deal?.companyName || undefined,
            customerContactName: displayName || undefined,
            customerAddress: customerRecord?.address || deal?.address || undefined,
            customerPhone: customerRecord?.phone || deal?.phone || undefined,
            customerEmail: customerRecord?.email || deal?.email || undefined,
            customerTaxCode: customerRecord?.taxCode || deal?.taxCode || undefined,
          }
        : {}),
    };
  }, [deal, draftCustomerId, customers, draftTitle, draftScope, draftPaymentTermsDays, draftExtraTerms]);
  // Tinh tam TU itemsDraft (chi de xem truoc, KHONG phai so luu that) - khop
  // dung nguyen tac da dung o cac noi khac trong file nay ("so preview FE...
  // khong dua vao de dam bao tinh dung", so that luon do backend tinh lai
  // bang Decimal sau khi luu that).
  const draftPreviewTotals = useMemo(() => {
    const rows = itemsDraft.filter(i => i.rowType !== 'section');
    const subtotalAmount = rows.reduce((sum, i) => sum + (i.amountAfterDiscount ?? (i.quantity * i.unitPrice || 0)), 0);
    const totalVatAmount = rows.reduce((sum, i) => {
      const base = i.amountAfterDiscount ?? (i.quantity * i.unitPrice || 0);
      return sum + (i.vatAmount ?? (base * (i.vatRate || 0)) / 100);
    }, 0);
    return { subtotalAmount, totalVatAmount, totalAmount: subtotalAmount + totalVatAmount };
  }, [itemsDraft]);

  // "Gui khach hang" - LUON hien, ly do disable phai phan biet dung tung
  // tinh huong that (khong gop chung 1 cau chung chung) - dung DUNG thu tu
  // uu tien nhu spec: chua duyet > chua phat hanh > kenh mail chua san sang.
  const sendDisabledReason = !quote
    ? 'Cần lưu và duyệt báo giá trước khi gửi khách'
    : quote.status !== 'approved'
      ? 'Báo giá chưa được duyệt'
      : quote.processingStage !== 'published' || !quote.publicEnabled
        ? 'Cần phát hành báo giá trước khi gửi'
        : !sendAvailability
          ? 'Đang kiểm tra kênh gửi email...'
          : !sendAvailability.available
            ? (sendAvailability.reason || 'Kênh email hiện không hoạt động')
            : undefined;

  // Preview modal phai xem duoc CA o create-mode (chua co quote that) - tinh
  // tong cuc bo tu itemsDraft (dung CHINH XAC cong thuc server: tung dong
  // tinh CK truoc, VAT tren phan sau CK, KHONG lay tong da gom VAT de suy
  // nguoc). Khi da co quote that thi dung so THAT tu quote (khong tinh lai
  // o FE de tranh lech lam tron voi server).
  const marginBelowThreshold = Boolean(hasCostData && quote?.grossMarginPercent != null && quote.grossMarginPercent < 20);

  const previewTotals = quote
    ? { subtotal: quote.subtotalAmount, vat: quote.vatAmount, total: quote.totalAmount }
    : itemsDraft.reduce(
        (acc, item) => {
          const lineSubtotal = (item.quantity || 0) * (item.unitPrice || 0);
          const discountAmount = lineSubtotal * ((item.discountPercent ?? 0) / 100);
          const afterDiscount = lineSubtotal - discountAmount;
          const vat = afterDiscount * ((item.vatRate ?? 10) / 100);
          return { subtotal: acc.subtotal + lineSubtotal, vat: acc.vat + vat, total: acc.total + afterDiscount + vat };
        },
        { subtotal: 0, vat: 0, total: 0 }
      );

  // BUG THAT DA GAP: early return nay truoc day nam O GIUA cac hook (truoc
  // ca zonePickerItems da chuyen xuong duoi) - vi pham Rules of Hooks that su
  // (React bao "change in the order of Hooks" o runtime, khong chi ly thuyet)
  // vi zonePickerItems chi duoc goi khi `loading===false`, sinh so luong hook
  // khac nhau giua 2 lan render. Chuyen xuong DAY - SAU khi TOAN BO hook/
  // useMemo/useEffect cua component da chay xong, chi con anh huong phan
  // RENDER (JSX) nhu cu, khong con cat ngang chuoi hook nua.
  if (loading) {
    return (
      <div className="qc-modal-backdrop">
        <div className="qc-workspace qc-workspace--loading">Đang tải báo giá...</div>
      </div>
    );
  }

  return (
    <div className="qc-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { markClosingIntent(); onClose(); } }}>
      <div className="qc-workspace">
        <header className="qc-workspace-header">
          {/* Dong rieng CHI hien tren mobile (≤767px, CSS an tren desktop) -
           * trang thai + nut dong o TREN CUNG, dung yeu cau "Dòng 1: trạng
           * thái + nút đóng". Cac nut phu (version/quay lai danh sach) don
           * vao 1 menu "⋯" dung chung ActionMenu (khong viet dropdown rieng)
           * de khong con 4 nut chen nhau xuong dong nhu truoc. */}
          <div className="qc-workspace-header-mobile-row">
            <span className={`qc-badge ${status.className}`}>{status.label}</span>
            <div className="qc-workspace-header-mobile-actions">
              <ActionMenu
                label="Thao tác khác"
                items={[
                  {
                    key: 'version',
                    label: versionButtonState.label,
                    disabled: versionButtonState.disabled || busy,
                    title: versionButtonState.tooltip,
                    onSelect: () => {
                      if (existingDraftVersion) {
                        void load(existingDraftVersion.id);
                      } else {
                        setVersionModalOpen(true);
                      }
                    },
                  },
                  { key: 'back', label: '← Danh sách', disabled: busy, onSelect: onClose },
                ]}
              />
              <button type="button" className="crm-icon-action" aria-label="Đóng" disabled={busy} onMouseDown={markClosingIntent} onClick={onClose}>
                <X className="qc-inline-icon" />
              </button>
            </div>
          </div>
          <div className="qc-workspace-header-main">
            {quote ? (
              <>
                <div className="qc-workspace-header-title">
                  <strong>{quote.quoteNumber}</strong>
                  <span className="qc-workspace-version-badge">V{quote.versionNumber || 1}</span>
                  <span className={`qc-badge ${status.className}`}>{status.label}</span>
                </div>
                <div className="qc-workspace-header-sub">
                  {typeof quote.data?.quoteTitle === 'string' && quote.data.quoteTitle ? quote.data.quoteTitle : 'Chưa có tiêu đề báo giá'}
                  {' · '}Cập nhật lần cuối {relativeTime(quote.updatedAt || quote.createdAt)}
                </div>
              </>
            ) : (
              <div className="qc-workspace-header-title qc-workspace-header-title--create">
                <span className={`qc-badge ${status.className}`}>{status.label}</span>
                <input
                  type="text"
                  className="qc-workspace-title-input"
                  placeholder="Tiêu đề yêu cầu hỗ trợ báo giá..."
                  value={draftTitle}
                  onChange={event => setDraftTitle(event.target.value)}
                />
              </div>
            )}
          </div>

          {/* Tien trinh 3 buoc GOP CHUNG 1 hang voi tieu de+nut hanh dong tren
           * desktop (yeu cau "Header và tiến trình chung một hàng") - CHINH
           * la .qc-workspace-stages cu, chi doi VI TRI (nam trong header thay
           * vi la 1 hang rieng ben duoi) - CSS mobile @767px van an di y het
           * truoc (display:none), khong doi hanh vi mobile. */}
          <div className="qc-workspace-stages qc-workspace-header-progress">
            {/* Gop Buoc 1 (request) + Buoc 2 (technical) lam MOT bubble hien
             * thi ("Yêu cầu & Kỹ thuật") - dung 1 nguoi dien hang muc+gia von
             * cung luc, khong con hanh dong rieng giua 2 buoc DB nay nua (xem
             * createRequest). STAGE_ORDER/stage van giu nguyen 4 gia tri DB o
             * moi noi khac (permission/SLA...), CHI gop rieng phan hien thi. */}
            {([
              { key: 'request_technical' as const, label: 'Yêu cầu & Kỹ thuật', repr: (stage === 'technical' ? 'technical' : 'request') as QuoteProcessingStage },
              { key: 'pricing' as const, label: stageLabel('pricing'), repr: 'pricing' as QuoteProcessingStage },
              { key: 'review' as const, label: stageLabel('review'), repr: 'review' as QuoteProcessingStage },
            ]).map((s, index, arr) => {
              const currentIdx = STAGE_ORDER.indexOf(stage);
              const state: 'done' | 'current' | 'upcoming' | 'halted' = isCancelled
                ? 'halted'
                : !isDraft
                  ? 'done'
                  : s.key === 'request_technical'
                    ? (currentIdx > STAGE_ORDER.indexOf('technical') ? 'done' : 'current')
                    : stageState(s.repr);
              const owner = stageOwnerName(s.repr);
              const time = stageTimeLabel(s.repr);
              const meta = [owner, time].filter(Boolean).join(' · ');
              return (
                <div className={`qc-stagebar-step qc-stagebar-step--${state}`} key={s.key}>
                  <span className="qc-stagebar-circle">{state === 'done' ? '✓' : index + 1}</span>
                  <span className="qc-stagebar-text">
                    <span className="qc-stagebar-label">{s.label}</span>
                    {meta ? <span className="qc-stagebar-meta">{meta}</span> : null}
                  </span>
                  {index < arr.length - 1 ? <span className="qc-stagebar-connector" aria-hidden="true" /> : null}
                </div>
              );
            })}
          </div>

          <div className="qc-workspace-header-actions">
            {/* BUG THAT DA GAP ("xóa 3 này đi, nút tạo phiên bản chỉ hiện
             * bước đã duyệt thôi"): "Lưu"/"← Danh sách" o day TRUNG LAP 100%
             * voi cac nut cung chuc nang da co san o footer (xem
             * qc-workspace-footer - moi stage deu co "Lưu" rieng, "← Danh
             * sách" da co san khi !isDraft/khi con la ban nhap) - bo han 2
             * nut nay khoi header, chi giu nut Dong (X). "Tạo phiên bản mới"
             * TRUOC DAY luon hien (disabled+tooltip khi chua duyet) - gio
             * CHI RENDER khi that su dang o trang thai duyet
             * (!versionButtonState.disabled, dung DUNG dieu kien co san,
             * khong doan lai). */}
            {!versionButtonState.disabled ? (
              <button
                type="button"
                className="qc-btn qc-workspace-header-btn-desktop-only"
                disabled={busy}
                title={versionButtonState.tooltip}
                onClick={() => {
                  if (existingDraftVersion) {
                    void load(existingDraftVersion.id);
                  } else {
                    setVersionModalOpen(true);
                  }
                }}
              >
                <GitBranchPlus className="qc-icon" /> {versionButtonState.label}
              </button>
            ) : null}
            {!quote ? (
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} onClick={() => void createRequest(false)}>
                {actionButtonContent('draftSave', 'Lưu / Chỉnh sửa')}
              </button>
            ) : null}
            <button type="button" className="crm-icon-action qc-workspace-header-btn-desktop-only" aria-label="Đóng" disabled={busy} onMouseDown={markClosingIntent} onClick={onClose}>
              <X className="qc-inline-icon" />
            </button>
          </div>
        </header>

        {/* Tom tat progress GON cho mobile (≤767px, CSS an tren desktop) -
         * "Bước X/3 — {label}" 1 dong duy nhat thay vi ep ca 3 buoc + connector
         * + meta nguoi phu trach vao 1 hang chat chu nho. Tinh truc tiep bang
         * JSX (khong doan qua CSS an/hien tung buoc) de chac chan dung noi
         * dung buoc hien tai. */}
        <div className="qc-stagebar-mobile-summary">
          {(() => {
            const mobileSteps = [
              { key: 'request_technical' as const, label: 'Yêu cầu & Kỹ thuật', repr: (stage === 'technical' ? 'technical' : 'request') as QuoteProcessingStage },
              { key: 'pricing' as const, label: stageLabel('pricing'), repr: 'pricing' as QuoteProcessingStage },
              { key: 'review' as const, label: stageLabel('review'), repr: 'review' as QuoteProcessingStage },
            ];
            const currentIdx = STAGE_ORDER.indexOf(stage);
            const states = mobileSteps.map(s =>
              isCancelled
                ? 'halted'
                : !isDraft
                  ? 'done'
                  : s.key === 'request_technical'
                    ? (currentIdx > STAGE_ORDER.indexOf('technical') ? 'done' : 'current')
                    : stageState(s.repr)
            );
            let activeIndex = states.findIndex(s => s === 'current');
            if (activeIndex === -1) activeIndex = states.lastIndexOf('done');
            if (activeIndex === -1) activeIndex = 0;
            return `Bước ${activeIndex + 1}/${mobileSteps.length} — ${mobileSteps[activeIndex].label}`;
          })()}
        </div>

        <div className="qc-workspace-info-strip">
          <div>
            <span className="qc-workspace-info-label">Khách hàng</span>
            {!quote && lockCustomer ? (
              <strong>{customers.find(c => c.id === draftCustomerId)?.label || 'Đang tải…'}</strong>
            ) : !quote ? (
              <SearchableSelect
                value={draftCustomerId}
                onChange={value => {
                  setDraftCustomerId(value);
                  // Doi khach hang -> co hoi da chon (neu co) co the khong con
                  // thuoc khach hang moi - bo chon de tranh luu sai lech.
                  if (draftDealId && effectiveDealsById.get(draftDealId)?.customerId !== value) setDraftDealId('');
                  // Du an cung thuoc DUNG 1 khach hang - doi khach hang thi bo
                  // chon Du an cu (se nap lai danh sach Du an moi qua effect).
                  setDraftProjectId('');
                }}
                options={customers.map(c => ({ value: c.id, label: c.label }))}
                placeholder="Chọn khách hàng..."
              />
            ) : (
              // Quote da tao xong: KHONG con doi Khach hang duoc that su
              // (backend chua co API doi deal_id tren quote da ton tai) -
              // nhung van hien dang o box giong Du an/Presale/Sale (khong
              // hien nhu 1 nhan chu thuong bi khoa cung) de giao dien nhat
              // quan - dung SearchableSelect disabled voi 1 option duy nhat
              // la gia tri hien tai.
              <SearchableSelect
                value="current"
                onChange={() => {}}
                options={[{ value: 'current', label: deal?.customerName || 'Chưa gắn cơ hội' }]}
                disabled
              />
            )}
          </div>
          <div>
            <span className="qc-workspace-info-label">Dự án</span>
            {!quote && lockProject ? (
              <strong>
                {(() => {
                  const found = (projects || []).find(p => p.id === draftProjectId);
                  return found ? `${found.projectCode} · ${found.name}` : 'Đang tải…';
                })()}
              </strong>
            ) : !quote || (isDraft && canEdit) ? (
              !effectiveCustomerIdForProjects ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>
                  {quote ? 'Cơ hội chưa gắn hồ sơ khách hàng' : 'Chọn khách hàng trước'}
                </span>
              ) : projects === null ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải…</span>
              ) : (
                <SearchableSelect
                  value={quote ? quote.projectId || '' : draftProjectId}
                  onChange={value => {
                    if (value === CREATE_NEW_PROJECT_OPTION) {
                      setProjectModalOpen(true);
                      return;
                    }
                    if (quote) void updateQuoteProject(value);
                    else setDraftProjectId(value);
                  }}
                  // BUG THAT DA GAP ("lặp 2 chữ Chưa thuộc dự án"): SearchableSelect
                  // TU render san 1 nut "clear" o dau danh sach dung chinh
                  // `placeholder` lam nhan (xem SearchableSelect.tsx) - truoc day
                  // options con khai bao THEM 1 dong { value: '', label: 'Chưa
                  // thuộc dự án' } giong het, thanh ra hien 2 dong trung nhau.
                  // Chi can placeholder, KHONG khai bao lai value='' trong options.
                  options={[
                    { value: CREATE_NEW_PROJECT_OPTION, label: '+ Tạo dự án mới…' },
                    ...projects.map(p => ({ value: p.id, label: `${p.projectCode} · ${p.name}` })),
                  ]}
                  placeholder="Chưa thuộc dự án"
                  hideClearOption
                />
              )
            ) : (
              <strong>
                {(() => {
                  const found = (projects || []).find(p => p.id === quote.projectId);
                  return found ? `${found.projectCode} · ${found.name}` : quote.projectId ? 'Đang tải…' : 'Chưa thuộc dự án';
                })()}
              </strong>
            )}
          </div>
          <div>
            <span className="qc-workspace-info-label">Cơ hội CRM</span>
            {!quote ? (
              <SearchableSelect
                value={draftDealId}
                onChange={handleSelectDeal}
                options={[
                  { value: CREATE_NEW_DEAL_OPTION, label: '+ Tạo cơ hội mới…' },
                  ...effectiveDeals
                    .filter(d => !draftCustomerId || d.customerId === draftCustomerId)
                    // Toi tu 1 Project card cu the (lockProject) - Co hoi CHI
                    // hien dung cua Project do, khong phai moi Co hoi cua Khach hang.
                    .filter(d => !lockProject || !draftProjectId || d.projectId === draftProjectId)
                    .map(d => ({ value: d.id, label: `${d.customerName}${d.companyName ? ' · ' + d.companyName : ''}` })),
                ]}
                placeholder="Chọn cơ hội..."
                hideClearOption
              />
            ) : null}
            {!quote && draftDealId ? (
              <div className="qc-row-sub">
                Mã cơ hội: {businessCode || 'Chưa có mã'}
                {deal?.estimatedBudget ? ` · Giá trị dự kiến: ${formatMoney(deal.estimatedBudget)}` : ''}
              </div>
            ) : null}
            {quote ? (
              <>
                {/* Tuong tu Khach hang o tren - khong con doi Co hoi duoc
                 * that su sau khi quote da tao, nhung van hien dang box
                 * SearchableSelect disabled cho nhat quan giao dien, khong
                 * hien nhu nhan chu bi khoa cung. */}
                <SearchableSelect
                  value="current"
                  onChange={() => {}}
                  options={[{ value: 'current', label: businessCode || (deal ? 'Cơ hội chưa có mã' : 'Chưa gắn cơ hội') }]}
                  disabled
                />
                <div className="qc-row-sub">
                  {/* opportunityName muon tu ten goi dich vu, KHONG phai "ten
                   * co hoi" that (Deal khong co field nay) - ghi nhan ro
                   * nguon that de khong trinh bay nhu du lieu that khac. */}
                  {opportunityName ? `Gói dịch vụ: ${opportunityName}` : deal ? 'Chưa có gói dịch vụ' : ''}
                  {deal?.estimatedBudget ? ` · Giá trị dự kiến: ${formatMoney(deal.estimatedBudget)}` : ''}
                </div>
              </>
            ) : null}
          </div>
          {!quote && quoteForms.length > 0 ? (
            <div>
              <span className="qc-workspace-info-label">Mẫu báo giá</span>
              <SearchableSelect
                value={draftFormId}
                onChange={setDraftFormId}
                options={quoteForms.map(f => ({ value: f.id, label: f.name }))}
                placeholder="Chọn mẫu báo giá..."
              />
            </div>
          ) : null}
          <div
            tabIndex={-1}
            onBlur={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setQuoteTypeDropdownOpen(false);
            }}
            style={{ position: 'relative' }}
          >
            <span className="qc-workspace-info-label">Loại báo giá</span>
            <div
              className={`qc-quote-type-control${canEditQuoteType ? ' qc-quote-type-control--editable' : ''}`}
              onClick={() => canEditQuoteType && setQuoteTypeDropdownOpen(v => !v)}
            >
              {currentQuoteTypeCodes.length === 0 ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Chọn loại báo giá...</span>
              ) : (
                <div className="qc-quote-type-chips">
                  {currentQuoteTypeCodes.map(code => (
                    <span key={code} className="qc-quote-type-chip">
                      {quoteTypeLabel(code)}
                      {canEditQuoteType ? (
                        <button
                          type="button"
                          aria-label={`Bỏ chọn ${quoteTypeLabel(code)}`}
                          onClick={e => { e.stopPropagation(); toggleQuoteTypeCode(code); }}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {quoteTypeDropdownOpen && canEditQuoteType ? (
              <div className="qc-quote-type-dropdown">
                <input
                  autoFocus
                  className="qc-cell-input"
                  placeholder="Tìm loại báo giá..."
                  value={quoteTypeSearch}
                  onChange={e => setQuoteTypeSearch(e.target.value)}
                />
                <div className="qc-quote-type-dropdown-list">
                  {quoteTypeOptions
                    .filter(o => o.label.toLowerCase().includes(quoteTypeSearch.trim().toLowerCase()))
                    .map(o => (
                      <label key={o.value} className="qc-quote-type-option">
                        <input type="checkbox" checked={currentQuoteTypeCodes.includes(o.value)} onChange={() => toggleQuoteTypeCode(o.value)} />
                        {o.label}
                      </label>
                    ))}
                  {quoteTypeOptions.length === 0 ? (
                    <div className="qc-workspace-muted" style={{ fontSize: 12, padding: 8 }}>
                      Chưa có Loại báo giá nào trong Danh mục CRM.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          {/* Presale/Sale/SLA DA CHUYEN sang sidebar (card "Phân công & SLA",
           * xem <aside className="qc-workspace-side"> ben duoi) theo yeu cau
           * rieng "Phân công & SLA để bên sidebar luôn" - KHONG con nam
           * trong info-strip hang 2 nua, chi con "Loại báo giá"/"Hiệu lực
           * đến" o day. */}
          {quote?.validUntil ? (
            <div>
              <span className="qc-workspace-info-label">Hiệu lực đến</span>
              <strong>{formatDate(quote.validUntil)}</strong>
            </div>
          ) : null}
        </div>

        <div className="qc-workspace-body" ref={workspaceBodyRef}>
          <div className="qc-workspace-main">
            {!quote || isDraft ? (
              // Gop Buoc 1+2: quote co the da duoc tu dong tao ngam (xem
              // createRequest()) ngay khi dang go - KHONG duoc chuyen sang
              // dang "xem tom tat + bam Chinh sua" chi vi da co quote, Sale
              // van dang cam nhan "con o Buoc 1" nen phai giu dung 1 kieu
              // giao dien go truc tiep (khong toggle) xuyen suot. Khi quote
              // da ton tai, doi sang doc/ghi tu editSummary/editScope/
              // editExpectedProducts (da co san co che dong bo + luu qua
              // saveScopeSummary() - xem effect [quote?.id] o tren) thay vi
              // draftSummary/draftScope (chi la buffer cuc bo truoc khi tao).
              <details
                className="qc-workspace-card qc-workspace-collapsible-card"
                data-qc-anchor="scope"
                data-testid="qc-scope-card"
                open={scopeCardOpen}
                onToggle={event => setScopeCardOpen((event.target as HTMLDetailsElement).open)}
              >
                <summary className="qc-workspace-card-head qc-workspace-collapsible-summary">
                  <h3 data-testid="qc-scope-card-title">Yêu cầu &amp; phạm vi công việc</h3>
                  <span className="qc-workspace-collapsible-hint">{scopeCardOpen ? '(bấm để thu gọn)' : '(bấm để xem)'}</span>
                  {autofillMessage ? <span className="qc-workspace-autofill-toast">{autofillMessage}</span> : null}
                </summary>
                <div className="qc-workspace-request-form">
                  <div className="qc-workspace-request-form-cols">
                    <label>
                      <span className="qc-workspace-info-label">Tóm tắt nhu cầu của khách</span>
                      <textarea
                        className="qc-workspace-handoff-note"
                        rows={3}
                        disabled={quote ? !canEdit : false}
                        value={quote ? editSummary : draftSummary}
                        onChange={event => (quote ? setEditSummary : setDraftSummary)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder={draftDealId ? 'Cơ hội chưa có mô tả nhu cầu — tự nhập tại đây.' : 'Khách cần gì, bối cảnh yêu cầu...'}
                      />
                    </label>
                    <label>
                      <span className="qc-workspace-info-label">Mô tả scope / yêu cầu cần estimate</span>
                      <textarea
                        className="qc-workspace-handoff-note"
                        rows={3}
                        disabled={quote ? !canEdit : false}
                        value={quote ? editScope : draftScope}
                        onChange={event => (quote ? setEditScope : setDraftScope)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder="Phạm vi công việc cần kỹ thuật estimate..."
                      />
                    </label>
                  </div>
                  <details className="qc-workspace-request-more">
                    <summary>Sản phẩm dự kiến / Ghi chú nội bộ (tuỳ chọn)</summary>
                    <label>
                      <span className="qc-workspace-info-label">Sản phẩm / dịch vụ dự kiến (nếu có)</span>
                      <input
                        type="text"
                        className="crm-input"
                        disabled={quote ? !canEdit : false}
                        value={quote ? editExpectedProducts : draftExpectedProducts}
                        onChange={event => (quote ? setEditExpectedProducts : setDraftExpectedProducts)(event.target.value)}
                        onBlur={quote ? () => void saveScopeSummary() : undefined}
                        placeholder={draftDealId ? 'Chưa có sản phẩm/dịch vụ — tự nhập tại đây.' : 'Ví dụ: Gói VPS Cloud, dịch vụ tư vấn...'}
                      />
                    </label>
                    {!quote ? (
                      <label>
                        <span className="qc-workspace-info-label">Ghi chú nội bộ (không hiện cho khách)</span>
                        <textarea className="qc-workspace-handoff-note" rows={2} value={draftInternalNote} onChange={event => setDraftInternalNote(event.target.value)} placeholder="Ghi chú riêng cho đội xử lý..." />
                      </label>
                    ) : null}
                    <p className="qc-workspace-note">Chưa hỗ trợ tệp đính kèm.</p>
                  </details>
                </div>
              </details>
            ) : !isDraft ? (
              <>
                {(() => {
                  const project = (projects || []).find(p => p.id === quote.projectId);
                  const techName = quote.technicalOwnerId ? nameFor(quote.technicalOwnerId) : null;
                  const saleName = quote.quoteOwnerId ? nameFor(quote.quoteOwnerId) : null;
                  const sla = computeQuoteSla({ slaDueAt: quote.slaDueAt, completedAt: quote.completedAt, sentAt: quote.sentAt });
                  const missingLinks: string[] = [];
                  if (!deal) missingLinks.push('Chưa gắn khách hàng');
                  if (!project) missingLinks.push('Chưa thuộc dự án');
                  if (!deal) missingLinks.push('Chưa gắn cơ hội');
                  if (!quote.slaDueAt) missingLinks.push('Chưa đặt SLA');
                  return (
                    <>
                      <div className="qc-workspace-card">
                        <div className="qc-workspace-card-head">
                          <h3>Bản tóm tắt báo giá</h3>
                          <span className="qc-badge qc-badge-neutral">Version đã khoá</span>
                        </div>
                        <div className="qc-summary-grid">
                          <div><span className="qc-workspace-info-label">Khách hàng</span><strong>{deal?.customerName || 'Chưa gắn khách hàng'}</strong></div>
                          <div><span className="qc-workspace-info-label">Dự án</span><strong>{project ? `${project.projectCode} · ${project.name}` : 'Chưa thuộc dự án'}</strong></div>
                          <div><span className="qc-workspace-info-label">Cơ hội CRM</span><strong>{businessCode || (deal ? 'Cơ hội chưa có mã' : 'Chưa gắn cơ hội')}</strong></div>
                          <div><span className="qc-workspace-info-label">Presale phụ trách</span><strong>{techName || 'Chưa gán'}</strong></div>
                          <div><span className="qc-workspace-info-label">Sale phụ trách</span><strong>{saleName || 'Chưa gán'}</strong></div>
                          <div><span className="qc-workspace-info-label">SLA</span><strong>{quote.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong></div>
                          <div><span className="qc-workspace-info-label">Người duyệt</span><strong>{quote.approvedById ? nameFor(quote.approvedById) : 'Chưa duyệt'}</strong></div>
                          <div><span className="qc-workspace-info-label">Ngày duyệt</span><strong>{quote.approvedAt ? formatDate(quote.approvedAt) : '—'}</strong></div>
                        </div>
                        {missingLinks.length > 0 ? (
                          <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                            <strong>Thông tin liên kết chưa đầy đủ</strong>
                            <ul>{missingLinks.map(m => <li key={m}>{m}</li>)}</ul>
                            <p>Phiên bản đã duyệt nên không thể sửa trực tiếp. Tạo phiên bản mới để bổ sung thông tin.</p>
                          </div>
                        ) : null}
                      </div>

                      {/* Card "Hạng mục & giá khách" (QuoteDocumentRenderer
                       * rut gon) DA BO - yeu cau ro rang "XÓA NÀY Ở BƯỚC 3
                       * ĐI": trung lap 100% voi bang "Hạng mục & cấu trúc
                       * giá" that (interactive, ngay ben duoi) - quote da
                       * khoa van hien dung bang do (chi READ-ONLY qua
                       * canEdit/isDraft), khong can renderer rut gon rieng
                       * cho cung 1 du lieu. */}
                    </>
                  );
                })()}
              </>
            ) : null}
            <div className="qc-workspace-card qc-workspace-items-card" data-qc-anchor="items">
              <div className="qc-workspace-card-head qc-workspace-items-card-head">
                <div className="qc-workspace-items-card-head-title">
                  <h3>Hạng mục &amp; cấu trúc giá</h3>
                  <span className="qc-row-sub">
                    {canEditCostCells && !canEditPricingCells
                      ? 'Bạn sửa được Giá vốn · Giá bán do Sale phụ trách nhập'
                      : canEditPricingCells && !canEditCostCells
                      ? 'Bạn sửa được Giá bán · Giá vốn do Presale phụ trách nhập (khoá)'
                      : canEditCostCells && canEditPricingCells
                      ? 'Bạn sửa được cả Giá vốn và Giá bán'
                      : 'Chỉ xem — không có quyền sửa hạng mục này'}
                  </span>
                </div>
                {/* Nhom thao tac chinh cua khoi hang muc DUA LEN HEADER (yeu
                 * cau "Đưa thao tác chính lên header của khối") - thay vi 1
                 * hang rieng phia duoi bang (.qc-workspace-add-row, da bo).
                 * "Xem bản khách hàng" dung LAI DUNG canPreview/
                 * previewDisabledReason/setPreviewModalOpen da co san (KHONG
                 * tao renderer/luong preview moi). */}
                <div className="qc-workspace-items-card-head-actions">
                  {/* "Ngưỡng margin tham chiếu" chuyen tu 1 dong rieng trong
                   * quickbar sang icon/tooltip nho o goc phai tieu de bang
                   * (yeu cau rieng "không chiếm thêm một dòng") - chi hien
                   * khi quickbar Markup/Margin thuc su dang hien (dieu kien
                   * giong het). */}
                  {canEditPricingCells && isDraft ? (
                    <span
                      className="qc-qb-margin-hint"
                      title="Chỉ 1 ngưỡng tĩnh, chưa phải rule engine tự động chặn/tự duyệt thật (thuộc Phase 3)"
                    >
                      ⓘ Ngưỡng margin: 20%
                    </span>
                  ) : null}
                  {canEdit && isDraft && !isLockedForReview ? (
                    <>
                      <button type="button" className="qc-mini-btn" onClick={() => void openCatalogPicker()}>Chọn từ danh mục</button>
                      <button type="button" className="qc-mini-btn" onClick={addItemRow}>Thêm hạng mục</button>
                      <button type="button" className="qc-mini-btn" onClick={addSectionRow}>+ Mục cha</button>
                    </>
                  ) : null}
                  <button type="button" className="qc-mini-btn qc-mini-btn-brand" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem bản khách hàng
                  </button>
                </div>
              </div>

              {canEditCostCells && isDraft && itemsDraft.length > 0 && itemsMissingCost.length > 0 ? (
                <div className="qc-workspace-warning-banner">
                  Còn {itemsMissingCost.length}/{itemsDraft.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu &quot;Không áp dụng giá vốn&quot; — cần bổ sung trước khi bàn giao.
                </div>
              ) : null}
              {canEditPricingCells && isDraft ? (
                <div className="qc-workspace-quickbar qc-workspace-quickbar--compact2">
                  {/* Hang 1: Markup nhanh (trai) | Chiết khấu tổng (phai) -
                   * yeu cau rieng "thu gọn còn 2 dòng". KHONG doi cong thuc/
                   * hanh vi - moi control van goi DUNG ham cu
                   * (applyQuickMarkup/persistQuote...), chi doi vi tri/kich
                   * thuoc hien thi. */}
                  <div className="qc-qb-row">
                    <div className="qc-qb-row-left">
                      <span className="qc-workspace-info-label qc-qb-row-label">Markup nhanh</span>
                      {[15, 20, 25, 30].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          className={`qc-mini-btn${lastAppliedMarkupPct === pct ? ' qc-mini-btn-active' : ''}`}
                          disabled={busy}
                          onClick={() => applyQuickMarkup(pct)}
                        >
                          +{pct}%
                        </button>
                      ))}
                      <label className="qc-workspace-quickbar-field">
                        Tuỳ chỉnh
                        <input
                          type="number"
                          className="qc-workspace-quickbar-input"
                          value={markupCustomInput}
                          onChange={event => setMarkupCustomInput(event.target.value)}
                          placeholder="vd 40"
                        />
                        %
                      </label>
                      <button
                        type="button"
                        className="qc-mini-btn"
                        disabled={busy || markupCustomInput.trim() === '' || !Number.isFinite(Number(markupCustomInput))}
                        title="Áp Markup tuỳ chỉnh cho toàn bộ hạng mục có giá vốn hợp lệ"
                        onClick={() => applyQuickMarkup(Number(markupCustomInput))}
                      >
                        Áp dụng
                      </button>
                    </div>
                    <div className="qc-qb-row-right">
                      <label
                        className="qc-workspace-quickbar-field"
                        title="Chỉ giảm trên tổng tiền cuối báo giá — KHÔNG đổi Markup/Giá khách/ĐV của từng dòng"
                      >
                        Chiết khấu tổng
                        <input
                          type="number"
                          className="qc-workspace-quickbar-input qc-qb-discount-input"
                          value={quote?.overallDiscountPercent ?? ''}
                          placeholder="0"
                          onChange={event => {
                            const raw = event.target.value;
                            const value = raw.trim() === '' ? null : Number(raw);
                            setQuote(prev => (prev ? { ...prev, overallDiscountPercent: value } : prev));
                          }}
                          onBlur={() => void persistQuote({ overallDiscountPercent: quote?.overallDiscountPercent ?? null }, { silent: true })}
                        />
                        %
                      </label>
                    </div>
                  </div>

                  {/* Hang 2: Margin mục tiêu (trai) | Thanh toán + Điều
                   * khoản (phai). */}
                  <div className="qc-qb-row">
                    <div className="qc-qb-row-left">
                      <span className="qc-workspace-info-label qc-qb-row-label">Margin mục tiêu</span>
                      {[10, 15, 20, 25, 30].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          className={`qc-mini-btn${lastAppliedMarginPct === pct ? ' qc-mini-btn-active' : ''}`}
                          disabled={busy}
                          title="Áp ngay cho toàn bộ hạng mục có giá vốn hợp lệ"
                          onClick={() => applyTargetMargin(pct)}
                        >
                          {pct}%
                        </button>
                      ))}
                      <label className="qc-workspace-quickbar-field">
                        Tuỳ chỉnh
                        <input
                          type="number"
                          className="qc-workspace-quickbar-input"
                          value={marginCustomInput}
                          onChange={event => setMarginCustomInput(event.target.value)}
                          placeholder="vd 22"
                        />
                        %
                      </label>
                      <button
                        type="button"
                        className="qc-mini-btn"
                        disabled={busy || marginCustomInput.trim() === '' || !Number.isFinite(Number(marginCustomInput))}
                        title="Áp Margin tuỳ chỉnh cho toàn bộ hạng mục có giá vốn hợp lệ"
                        onClick={() => applyTargetMargin(Number(marginCustomInput))}
                      >
                        Áp dụng
                      </button>
                    </div>
                    <div className="qc-qb-row-right">
                      <label className="qc-workspace-quickbar-field" title="Bắt buộc để chuyển bước — khác với &quot;+ Điều khoản&quot; bên cạnh">
                        Thanh toán *
                        <select
                          className="qc-workspace-quickbar-input qc-workspace-quickbar-select"
                          value={quote ? paymentTermsDays : draftPaymentTermsDays}
                          onChange={event => {
                            if (quote) setPaymentTermsDays(event.target.value);
                            applyPaymentTerms(event.target.value);
                          }}
                        >
                          {['15', '30', '45', '60'].map(d => (
                            <option key={d} value={d}>{d} ngày</option>
                          ))}
                        </select>
                      </label>
                      <span className="qc-term-note-anchor">
                        <button
                          type="button"
                          className="qc-mini-btn"
                          onClick={() => setTermNotePopoverOpen(v => !v)}
                          title="Ghi chú điều khoản tự do, hiển thị thêm trên báo giá — KHÔNG thay thế mục Thanh toán (*) bên trái"
                        >
                          + Điều khoản
                        </button>
                        {termNotePopoverOpen ? (
                          <div className="qc-row-margin-popover qc-term-note-popover" onClick={e => e.stopPropagation()}>
                            <textarea
                              autoFocus
                              className="qc-cell-input"
                              rows={3}
                              placeholder="Nhập nội dung điều khoản..."
                              value={termNoteInput}
                              onChange={e => setTermNoteInput(e.target.value)}
                            />
                            <div className="qc-row-margin-popover-actions">
                              <button type="button" className="qc-mini-btn" onClick={() => { setTermNotePopoverOpen(false); setTermNoteInput(''); }}>Huỷ</button>
                              <button type="button" className="qc-mini-btn qc-mini-btn-brand" disabled={!termNoteInput.trim()} onClick={submitTermNote}>Thêm</button>
                            </div>
                          </div>
                        ) : null}
                      </span>
                      {!quote ? <span className="qc-workspace-quickbar-hint">Lưu tạm — sẽ ghi thật khi tạo yêu cầu</span> : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {extraTermsList.length > 0 ? (
                <ul className="qc-workspace-draft-terms">
                  {extraTermsList.map(t => (
                    <li key={t.id}>
                      <span>{t.title}: {t.content}</span>
                      <span className="qc-workspace-draft-terms-actions">
                        <button type="button" className="qc-mini-btn" onClick={() => editTermNote(t.id)}>Sửa</button>
                        <button type="button" className="qc-mini-btn" onClick={() => removeTermNote(t.id)}>Xóa</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {fillDownUndo ? (
                <div className="qc-workspace-note-box qc-workspace-autofill-undo-box">
                  <span>{fillDownUndo.message}</span>
                  <button type="button" className="qc-mini-btn" onClick={undoFillDown}>Hoàn tác</button>
                </div>
              ) : null}
              {/* Bang THONG NHAT: Cost (Presale) + Pricing (Sale) tren CUNG 1
                  dong, khong con tab rieng - dung yeu cau "Sale phai doi chieu
                  duoc cost va markup cung dong". overflow-x rieng cho bang
                  (khong lam vo trang) - xem .qc-table-wrap trong quote-center.css. */}
              <div className="qc-table-wrap qc-workspace-items-scroll">
                <table className={`qc-linked-table qc-workspace-items-table qc-workspace-items-table--unified${itemsDraft.length > 0 ? ' qc-workspace-items-table--has-rows' : ''}`}>
                  {/* BUG THAT DA GAP ("Margin bi cat '23....', cot Thao tac
                   * troi ra ngoai bang"): width % qua nth-child KHONG dang
                   * tin cay duoi table-layout:fixed khi noi dung 1 cell (vd
                   * 2 nut icon +/⋮ trong Thao tac) co kich thuoc PIXEL toi
                   * thieu lon hon % da phan, khien ca hang vuot qua container
                   * - .qc-workspace-items-scroll dang overflow-x:hidden nen
                   * PHAN VUOT bi cat mat thay vi cuon, dung ngay cot cuoi
                   * (Margin/Thao tac). Dung <colgroup> voi PX CO DINH cho moi
                   * cot hep/co dinh (DVT/SL/Gia von/Cost tong/Markup/Gia
                   * khach/Thanh tien/Margin/Thao tac) + de rieng "Hạng mục"
                   * KHONG khai bao width - day la cach table-layout:fixed
                   * tin cay nhat (dung chuan CSS: cot khong khai bao width se
                   * tu chia het phan con lai), khong con phu thuoc content
                   * "vua khit" % duoc gan tren th/td nua. */}
                  <colgroup>
                    <col />
                    <col style={{ width: '92px' }} />
                    <col style={{ width: '64px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '70px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '104px' }} />
                    <col style={{ width: '66px' }} />
                    {canEdit && isDraft && !isLockedForReview ? <col style={{ width: '44px' }} /> : null}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="qc-th-name">Hạng mục</th>
                      <th className="qc-th-unit">ĐVT</th>
                      <th className="qc-th-money qc-th-qty">SL</th>
                      <th className="qc-th-money qc-th-cost">Giá vốn/ĐV</th>
                      <th className="qc-th-money qc-th-cost">Cost tổng</th>
                      <th className="qc-th-money qc-th-markup">Markup</th>
                      <th className="qc-th-money qc-th-markup">Giá khách/ĐV</th>
                      <th className="qc-th-money qc-th-total">Thành tiền</th>
                      <th className="qc-th-money qc-th-margin-col">Margin</th>
                      {canEdit && isDraft && !isLockedForReview ? <th className="qc-th-actions qc-cell-actions--menu" aria-label="Thao tác" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {itemsDraft.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="qc-empty qc-workspace-items-empty-cell">
                          {/* Cac nut thao tac (Chọn từ danh mục/Thêm hạng mục/
                           * + Mục cha) da chuyen len header khoi (xem
                           * qc-workspace-items-card-head-actions) - KHONG lap
                           * lai 1 bo nut nua o day (yeu cau rieng "Các nút
                           * thao tác đã nằm trên header nên không lặp lại
                           * thêm một bộ nút trong empty state"). Chi giu rieng
                           * "Nạp từ báo giá gần nhất" - dac thu cho trang
                           * thai rong, khong nam trong 4 nut header chuan. */}
                          <div className="qc-workspace-items-empty">
                            <span>Chưa có hạng mục nào.</span>
                            {canEdit && isDraft && !isLockedForReview && recentDealQuote ? (
                              <div className="qc-workspace-items-empty-actions">
                                <button type="button" className="qc-mini-btn" onClick={loadFromRecentQuote}>
                                  Nạp từ báo giá gần nhất ({recentDealQuote.quoteNumber})
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (() => {
                        // Muc cha (Section)/hang muc con - migration 104. So
                        // La Ma dem RIENG cho section (theo thu tu xuat hien),
                        // so 01/02/03 dem LIEN TUC cho hang muc that xuyen
                        // suot ca bang (KHONG reset lai moi nhom - dung khop
                        // cach danh so 01-21 lien tuc qua ca 3 "GIAI DOAN"
                        // trong file Excel mau).
                        let sectionCounter = 0;
                        let itemCounter = 0;
                        const canDragRows = canEdit && isDraft && !isLockedForReview;
                        return itemsDraft.map((item, index) => {
                          if (item.rowType === 'section') {
                            sectionCounter += 1;
                            const roman = toRomanNumeral(sectionCounter);
                            return (
                              <tr
                                key={item.id || index}
                                className="qc-workspace-section-row"
                                draggable={canDragRows}
                                onDragStart={() => handleRowDragStart(index)}
                                onDragOver={canDragRows ? event => event.preventDefault() : undefined}
                                onDrop={canDragRows ? () => handleRowDrop(index, true) : undefined}
                              >
                                {/* Nine data columns, plus the separate action cell when editable. */}
                                <td colSpan={9}>
                                  {canDragRows ? <span className="qc-workspace-drag-handle" title="Kéo để sắp xếp">⠿</span> : null}
                                  {/* Roman numeral (I/II/III...) dat TRUOC ten muc (ben trai) thay vi
                                   * sau nhu cu - o kich thuoc nho, badge "I" dat SAU chu de bi doc
                                   * nham thanh dau "!" (theo dung phan anh "I la mã nằm khúc bên
                                   * trái đầu trc chữ hạ á"). */}
                                  <span className="qc-workspace-section-roman">{roman}</span>
                                  {canEdit && isDraft && !isLockedForReview ? (
                                    <input
                                      className="qc-cell-input qc-workspace-section-input"
                                      value={stripLeadingRomanPrefix(item.description || '', roman)}
                                      onChange={e => updateRow(index, { description: e.target.value })}
                                      onBlur={() => void persistQuote({}, { silent: true })}
                                      placeholder="Tên mục cha"
                                    />
                                  ) : (
                                    <strong>{stripLeadingRomanPrefix(item.description || '', roman) || 'Mục mới'}</strong>
                                  )}
                                  {/* Yeu cau moi nhat: Muc cha KHONG con nut them nao
                                   * ca - 2 icon "+"/"danh mục" chuyen het xuong
                                   * TUNG dong hang muc con (cot Thao tac) thay vi
                                   * dat rieng tren hang Muc cha. */}
                                </td>
                                {canEdit && isDraft && !isLockedForReview ? (
                                  <td className="qc-cell-actions qc-cell-actions--menu">
                                    <ActionMenu
                                      label="Thao tác mục cha"
                                      items={[
                                        { key: 'up', label: 'Di chuyển lên', icon: ChevronUp, onSelect: () => moveRowUpDown(index, -1), group: 1 },
                                        { key: 'down', label: 'Di chuyển xuống', icon: ChevronDown, onSelect: () => moveRowUpDown(index, 1), group: 1 },
                                        { key: 'delete', label: 'Xoá mục cha (và toàn bộ hạng mục con)', icon: Trash2, danger: true, onSelect: () => removeItemRow(index), group: 2 },
                                      ]}
                                    />
                                  </td>
                                ) : null}
                              </tr>
                            );
                          }
                        itemCounter += 1;
                        const displayNo = String(itemCounter).padStart(2, '0');
                        const margin = item.costPrice != null && item.unitPrice > 0 ? ((item.unitPrice - item.costPrice) / item.unitPrice) * 100 : null;
                        const costTotal = item.costPrice != null ? item.costPrice * item.quantity : null;
                        const editableTechnicalCells = canEditCostCells;
                        const editableCells = canEditPricingCells;
                        return (
                          <tr
                            key={item.id || index}
                            className={[
                              item.parentItemId ? 'qc-workspace-item-row--nested' : '',
                              item.id && costBatchIds.includes(item.id) ? 'qc-workspace-item-row--batch' : '',
                            ].filter(Boolean).join(' ') || undefined}
                            draggable={canDragRows}
                            onDragStart={() => handleRowDragStart(index)}
                            onDragOver={canDragRows ? event => event.preventDefault() : undefined}
                            onDrop={canDragRows ? () => handleRowDrop(index, false) : undefined}
                          >
                            <td data-label="Hạng mục">
                              <span className="qc-workspace-item-name-cell">
                                <span className="qc-workspace-item-no-col">
                                  {canDragRows ? <span className="qc-workspace-drag-handle" title="Kéo để sắp xếp">⠿</span> : null}
                                  <span className="qc-workspace-item-no">{displayNo}</span>
                                </span>
                                <span className="qc-workspace-item-name-col">
                                  {(editableTechnicalCells || editableCells) ? (
                                    <textarea
                                      className="qc-cell-input qc-cell-textarea"
                                      rows={2}
                                      value={item.serviceDescription || ''}
                                      onChange={e => updateRow(index, { serviceDescription: e.target.value })}
                                      onBlur={() => void persistQuote({}, { silent: true })}
                                      placeholder="Tên hạng mục"
                                      title={[item.serviceDescription, item.description].filter(Boolean).join(' — ') || ''}
                                    />
                                  ) : (
                                    <span
                                      className="qc-workspace-item-name-clamp qc-workspace-item-name-clickable"
                                      title={[item.serviceDescription, item.description].filter(Boolean).join(' — ') || ''}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot({ ...item }); }}
                                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot({ ...item }); } }}
                                    >
                                      {item.serviceDescription || '—'}
                                    </span>
                                  )}
                                  {/* "Nhận biết hạng mục đã có trong Sản phẩm
                                   * & dịch vụ" - xac dinh bang catalogItemId/
                                   * priceBookItemId THAT (ID lien ket that,
                                   * KHONG so sanh theo ten). */}
                                  {/* BUG THAT DA GAP ("Bước 3 chưa hiển thị
                                   * trạng thái liên kết"): nhanh "chua lien
                                   * ket" TRUOC DAY chi render khi
                                   * canEdit && isDraft && !isLockedForReview -
                                   * an HAN icon (khong phai disable) o Buoc 3/
                                   * quote da khoa, sai yeu cau "Không được ẩn
                                   * icon chỉ vì bảng đang read-only". Dung 1
                                   * nhanh render CHUNG cho MOI buoc: co the
                                   * SUA (dau + bam duoc, mo QuickAddProductModal)
                                   * hay CHI XEM/da khoa (dau + mau xam, bam
                                   * vao chi hien thong bao huong dan tao
                                   * phien ban moi, KHONG mo form sua/KHONG
                                   * ghi de catalogItemId len version da khoa). */}
                                  {item.catalogItemId || item.priceBookItemId ? (
                                    <span
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--linked"
                                      title="Đã có trong Sản phẩm & dịch vụ"
                                      aria-label="Đã có trong Sản phẩm & dịch vụ"
                                    >
                                      <CheckCircle2 className="qc-inline-icon" />
                                    </span>
                                  ) : canEdit && isDraft && !isLockedForReview ? (
                                    <button
                                      type="button"
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--unlinked"
                                      title="Thêm vào Sản phẩm & dịch vụ"
                                      aria-label="Thêm vào Sản phẩm & dịch vụ"
                                      onClick={() => openQuickAddForRow(index)}
                                    >
                                      <Plus className="qc-inline-icon" />
                                    </button>
                                  ) : (
                                    // "k cần tạo phiên bản mới bro" - bao giá
                                    // da khoa VAN cho tao san pham vao "Sản
                                    // phẩm & dịch vụ" binh thuong (mo thang
                                    // QuickAddProductModal, khong con bat qua
                                    // luong "Tạo phiên bản mới" nua) - CHI
                                    // khac 1 diem duy nhat: KHONG ghi
                                    // catalogItemId nguoc lai dong hang muc
                                    // cua version da khoa (xem
                                    // handleQuickAddProductCreated, nhanh
                                    // `locked`), giu bat bien du lieu quote
                                    // da duyet.
                                    <button
                                      type="button"
                                      className="qc-workspace-item-link-badge qc-workspace-item-link-badge--unlinked qc-workspace-item-link-badge--locked"
                                      title="Thêm vào Sản phẩm & dịch vụ (báo giá đã khoá nên sẽ không liên kết vào hạng mục này)"
                                      aria-label="Thêm vào Sản phẩm & dịch vụ"
                                      onClick={() => openQuickAddForRow(index, true)}
                                    >
                                      <Plus className="qc-inline-icon" />
                                    </button>
                                  )}
                                  {canEdit && isDraft && !isLockedForReview ? (
                                    <span className="qc-workspace-item-quick-add">
                                      <button
                                        type="button"
                                        className="qc-mini-btn-icon qc-workspace-item-quick-add-btn"
                                        title="Thêm hạng mục trống ngay sau dòng này"
                                        aria-label="Thêm hạng mục trống ngay sau dòng này"
                                        onClick={() => addBlankItemAfterIndex(index)}
                                      >
                                        <Plus className="qc-inline-icon" />
                                      </button>
                                      <button
                                        type="button"
                                        className="qc-mini-btn-icon qc-workspace-item-quick-add-btn"
                                        title="Chọn từ danh mục, chèn ngay sau dòng này"
                                        aria-label="Chọn từ danh mục, chèn ngay sau dòng này"
                                        onClick={() => void openCatalogPicker({ afterIndex: index })}
                                      >
                                        <LayoutGrid className="qc-inline-icon" />
                                      </button>
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                            </td>
                            <td className="qc-cell-unit" data-label="ĐVT">
                              {editableTechnicalCells ? (
                                <input
                                  className="qc-cell-input"
                                  value={item.unit || ''}
                                  onChange={e => updateRow(index, { unit: e.target.value })}
                                  onBlur={() => void persistQuote({}, { silent: true })}
                                  placeholder="Gói, Tháng..."
                                />
                              ) : (
                                item.unit || '—'
                              )}
                            </td>
                            <td className="qc-cell-money qc-cell-qty" data-label="SL">
                              {editableTechnicalCells ? (
                                <input type="number" className="qc-cell-input qc-cell-input-money" value={item.quantity} onChange={e => updateRow(index, { quantity: Math.max(0, Number(e.target.value) || 0) })} onBlur={() => void persistQuote({}, { silent: true })} />
                              ) : item.quantity}
                            </td>
                            <td className={`qc-cell-money qc-cell-cost ${!item.costNotApplicable && item.costPrice == null ? 'qc-cell-cost-missing' : ''}`} data-label="Giá vốn/ĐV" title={!editableTechnicalCells && costViewAllowed ? 'Presale đã chốt — chỉ đọc' : undefined}>
                              {/* BUG THAT DA GAP ("mũi tên xuống dòng riêng
                               * bên dưới số tiền"): gia tri + icon "Điền
                               * xuống" truoc day la 2 phan tu ANH XA rieng le
                               * (input width:100% chiem het dong, hoac chu
                               * dai vua khit) nen KHONG con cho cho icon tren
                               * CUNG 1 dong, buoc phai xuong dong rieng. Boc
                               * chung 1 flex row - LUON giu icon nam ngang
                               * ben phai gia tri, khong con xuong dong. */}
                              <span className="qc-cell-value-row">
                                <span className="qc-cell-value-row-main">
                                  {!costViewAllowed ? (
                                    <span className="qc-row-sub">Không có quyền xem</span>
                                  ) : editableTechnicalCells ? (
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      className="qc-cell-input qc-cell-input-money"
                                      value={item.costPrice != null ? formatMoneyInput(String(item.costPrice)) : ''}
                                      placeholder={item.costNotApplicable ? 'Không áp dụng' : 'Bắt buộc nhập'}
                                      disabled={item.costNotApplicable}
                                      onChange={e => handleCostPriceChange(index, e.target.value)}
                                      onBlur={handleCostPriceBlur}
                                    />
                                  ) : (
                                    (item.costNotApplicable ? 'Không áp dụng' : item.costPrice != null ? formatMoney(item.costPrice) : 'Còn thiếu')
                                  )}
                                </span>
                                {renderFillDownIcon(index, 'costPrice')}
                              </span>
                            </td>
                            <td className="qc-cell-money qc-cell-cost" data-label="Cost tổng">
                              {!costViewAllowed ? <span className="qc-row-sub">Không có quyền xem</span> : item.costNotApplicable ? '—' : costTotal != null ? formatMoney(costTotal) : '—'}
                            </td>
                            <td className="qc-cell-money qc-cell-markup" data-label="Markup">
                              <span className="qc-cell-value-row">
                                <span className="qc-cell-value-row-main">
                                  {!pricingViewAllowed ? (
                                    <span className="qc-row-sub">Không có quyền xem</span>
                                  ) : editableCells ? (
                                    <input type="number" step="0.01" className="qc-cell-input qc-cell-input-money" value={item.markupPercent != null ? Number(item.markupPercent.toFixed(2)) : ''} placeholder="—" disabled={item.costPrice == null} onChange={e => handleMarkupChange(index, e.target.value)} onBlur={() => void persistQuote({}, { silent: true })} />
                                  ) : formatPercentTrim(item.markupPercent)}
                                </span>
                                {renderFillDownIcon(index, 'markupPercent')}
                              </span>
                            </td>
                            <td className="qc-cell-money qc-cell-markup" data-label="Giá khách/ĐV">
                              {editableCells ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="qc-cell-input qc-cell-input-money"
                                  value={item.unitPrice ? formatMoneyInput(String(item.unitPrice)) : ''}
                                  onChange={e => handleUnitPriceChange(index, e.target.value)}
                                  onBlur={() => void persistQuote({}, { silent: true })}
                                />
                              ) : formatMoney(item.unitPrice)}
                            </td>
                            <td className="qc-cell-money" data-label="Thành tiền">{formatMoney(item.totalAmount || item.quantity * item.unitPrice || 0)}</td>
                            <td className={`qc-cell-money qc-th-margin-col ${margin != null && margin >= 20 ? 'qc-cell-margin-good' : margin != null ? 'qc-cell-margin-warn' : ''}`} style={{ position: 'relative' }} data-label="Margin">
                              {!profitabilityViewAllowed ? <span className="qc-row-sub">Không có quyền xem</span> : formatPercentTrim(margin)}
                            </td>
                            {canEdit && isDraft && !isLockedForReview ? (
                              <td className="qc-cell-actions qc-cell-actions--menu" data-label="Thao tác">
                                {/* BUG THAT DA GAP: 2 icon nhanh rieng (Plus/LayoutGrid)
                                 * dat canh nut "⋮" trong 1 cot rat hep gay CHONG
                                 * LAN/vo layout that su tren man hinh (ket hop voi
                                 * ActionMenu tu quan ly vi tri trigger cua no) -
                                 * BO HAN 2 icon rieng, CHI con dung 1 nut "⋮" duy
                                 * nhat, on dinh - 2 hanh dong "Thêm hạng mục trống"/
                                 * "Chọn từ danh mục" van du dung qua menu chu (2
                                 * muc dau tien ben duoi), dung cho ca desktop lan
                                 * mobile (mobile von di khong co hover that su nen
                                 * cung se can menu chu, khong mat chuc nang gi). */}
                                <ActionMenu
                                  label="Thao tác hạng mục"
                                  items={[
                                    { key: 'add-blank', label: 'Thêm hạng mục trống', icon: Plus, onSelect: () => addBlankItemAfterIndex(index), group: 1 },
                                    { key: 'add-catalog', label: 'Chọn từ danh mục', icon: LayoutGrid, onSelect: () => void openCatalogPicker({ afterIndex: index }), group: 1 },
                                    { key: 'detail', label: 'Xem chi tiết hạng mục', onSelect: () => { setItemDetailDrawerIndex(index); setItemDetailDrawerSnapshot({ ...item }); } },
                                    ...(item.priceBookItemId
                                      ? [{ key: 'price-detail', label: 'Chi tiết giá vốn/EU/VAT', onSelect: () => setPriceBookDrawerIndex(index) }]
                                      : []),
                                    // Mobile/man hinh hep an het icon "Điền xuống" ngay tai o
                                    // (xem @media 767px o quote-center.css) - giu du 2 pham vi
                                    // (empty/all) qua menu chu o day, dong bo voi popover desktop.
                                    ...(item.costPrice != null && fillDownTargets(index).length > 0
                                      ? [
                                          { key: 'fill-down-cost-empty', label: `Điền Giá vốn xuống dòng trống (${fillDownEmptyTargets(index, 'costPrice').length})`, onSelect: () => fillDownWithMode(index, 'costPrice', 'empty') },
                                          { key: 'fill-down-cost-all', label: `Điền Giá vốn xuống toàn bộ (${fillDownTargets(index).length})`, onSelect: () => fillDownWithMode(index, 'costPrice', 'all') },
                                        ]
                                      : []),
                                    ...(item.markupPercent != null && fillDownTargets(index).length > 0
                                      ? [
                                          { key: 'fill-down-markup-empty', label: `Điền Markup xuống dòng trống (${fillDownEmptyTargets(index, 'markupPercent').length})`, onSelect: () => fillDownWithMode(index, 'markupPercent', 'empty') },
                                          { key: 'fill-down-markup-all', label: `Điền Markup xuống toàn bộ (${fillDownTargets(index).length})`, onSelect: () => fillDownWithMode(index, 'markupPercent', 'all') },
                                        ]
                                      : []),
                                    { key: 'up', label: 'Di chuyển lên', icon: ChevronUp, onSelect: () => moveRowUpDown(index, -1), group: 2 },
                                    { key: 'down', label: 'Di chuyển xuống', icon: ChevronDown, onSelect: () => moveRowUpDown(index, 1), group: 2 },
                                    { key: 'duplicate', label: 'Nhân bản hạng mục', onSelect: () => duplicateItemRow(index), group: 2 },
                                    { key: 'delete', label: 'Xoá hạng mục', icon: Trash2, danger: true, onSelect: () => removeItemRow(index), group: 3 },
                                  ]}
                                />
                              </td>
                            ) : null}
                          </tr>
                        );
                        });
                      })()
                    )}
                  </tbody>
                </table>
              </div>
              <div className="qc-workspace-totals">
                <div>
                  <span className="qc-workspace-info-label">Tổng giá vốn</span>
                  <strong>{!costViewAllowed ? 'Không có quyền xem' : hasCostData ? formatMoney(quote!.costTotal || 0) : 'Chưa có dữ liệu giá vốn'}</strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Giá khách sau CK</span>
                  <strong>{quote ? formatMoney(quote.totalAmount) : '0 đ'}</strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Lợi nhuận gộp</span>
                  <strong className={hasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                    {!profitabilityViewAllowed ? 'Không có quyền xem' : hasCostData ? formatMoney(quote!.grossProfit || 0) : 'Chưa có dữ liệu'}
                  </strong>
                </div>
                <div>
                  <span className="qc-workspace-info-label">Gross margin</span>
                  <strong className={hasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                    {!profitabilityViewAllowed ? 'Không có quyền xem' : hasCostData && quote!.grossMarginPercent != null ? formatPercentTrim(quote!.grossMarginPercent) : 'Chưa có dữ liệu'}
                  </strong>
                </div>
                {profitabilityViewAllowed && hasCostData && quote?.costTotal ? (
                  <div>
                    <span className="qc-workspace-info-label">Rate tổng</span>
                    <strong>{formatPercentTrim(((quote!.netRevenue || 0) / quote!.costTotal!) * 100 - 100)}</strong>
                  </div>
                ) : null}
                <div>
                  {/* Sua o "Chiết khấu tổng" tren quickbar (canh Markup nhanh) -
                   * day chi con la HIEN THI (khong sua thang o day nua), tranh
                   * 2 o edit cung 1 field gay hieu nham co 2 co che rieng. */}
                  <span className="qc-workspace-info-label">Giảm giá tổng (%)</span>
                  <strong>{quote?.overallDiscountPercent != null ? `${quote.overallDiscountPercent}%` : 'Không giảm'}</strong>
                </div>
                {profitabilityViewAllowed && quote?.overallDiscountPercent != null ? (() => {
                  const amountAfterDiscount = quote.totalAmount * (1 - quote.overallDiscountPercent / 100);
                  const incomeAfterDiscount = hasCostData ? amountAfterDiscount - (quote.costTotal || 0) : null;
                  const marginAfterDiscount = incomeAfterDiscount != null && amountAfterDiscount ? (incomeAfterDiscount / amountAfterDiscount) * 100 : null;
                  return (
                    <>
                      <div>
                        <span className="qc-workspace-info-label">Giá sau giảm</span>
                        <strong>{formatMoney(amountAfterDiscount)}</strong>
                      </div>
                      <div>
                        <span className="qc-workspace-info-label">Margin sau giảm</span>
                        <strong className={marginAfterDiscount != null && marginAfterDiscount >= 0 ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                          {marginAfterDiscount != null ? `${marginAfterDiscount.toFixed(2)}%` : 'Chưa có dữ liệu'}
                        </strong>
                      </div>
                    </>
                  );
                })() : null}
              </div>
            </div>

            {/* "Tổng hợp giá" - CHUYEN xuong ngay duoi "Hạng mục & cấu trúc
             * giá" o Buoc 3 (quote da khoa/duyet) theo yeu cau ro rang "cho
             * nằm dưới đít Hạng mục & cấu trúc giá ở bước 3", thay vi nam
             * ben sidebar phai nhu truoc (xem <aside> - da bo card nay khoi
             * do). Giu nguyen 100% du lieu/logic, chi doi vi tri render. */}
            {!isDraft && quote ? (
              <div className="qc-workspace-card">
                <h3>Tổng hợp giá</h3>
                <div className="qc-summary-grid">
                  <div><span className="qc-workspace-info-label">Điều khoản thanh toán</span><strong>{paymentTermsBlock?.content || 'Chưa có điều khoản'}</strong></div>
                  <div><span className="qc-workspace-info-label">Hiệu lực báo giá</span><strong>{quote.validUntil ? formatDate(quote.validUntil) : 'Chưa đặt'}</strong></div>
                  <div><span className="qc-workspace-info-label">Phạm vi công việc</span><strong>{scopeBlock?.content || 'Chưa mô tả'}</strong></div>
                  <div><span className="qc-workspace-info-label">Trước chiết khấu</span><strong>{formatMoney(quote.subtotalAmount)}</strong></div>
                  <div><span className="qc-workspace-info-label">VAT</span><strong>{formatMoney(quote.vatAmount)}</strong></div>
                  <div><span className="qc-workspace-info-label">Khách thanh toán</span><strong>{formatMoney(quote.totalAmount)}</strong></div>
                </div>
              </div>
            ) : null}

            {stage === 'technical' || stage === 'request' ? (
              // Gop Buoc 1+2: hien san khoi ban giao ngay tu luc con o
              // 'request' (truoc khi Sale kip them hang muc/quote tu tao
              // xong) - dung tinh than "man hinh gop" thay vi doi dung
              // stage==='technical' (chi co that sau khi auto-create xong).
              <details className="qc-workspace-card qc-workspace-collapsible-card" open={handoffCardOpen} onToggle={event => setHandoffCardOpen((event.target as HTMLDetailsElement).open)}>
                <summary className="qc-workspace-card-head qc-workspace-collapsible-summary">
                  <h3>Bàn giao kỹ thuật → người phụ trách báo giá</h3>
                  <span className="qc-workspace-collapsible-hint">{handoffCardOpen ? '(bấm để thu gọn)' : '(bấm để xem)'}</span>
                  <div className="qc-workspace-card-head-badges">
                    {checklistDirty ? <span className="qc-badge qc-badge-amber">Có thay đổi chưa lưu</span> : null}
                    <span className={`qc-badge ${handoffBadge === 'Đã bàn giao' ? 'qc-badge-green' : handoffBadge === 'Cần bổ sung' ? 'qc-badge-amber' : 'qc-badge-rose'}`}>
                      {handoffBadge}
                    </span>
                  </div>
                </summary>
                <div className="qc-workspace-checklist">
                  {([
                    ['scopeConfirmed', 'scopeNote', 'Phạm vi (Scope)'],
                    ['costConfirmed', 'costNote', 'Giá vốn (Cost)'],
                    ['timelineConfirmed', 'timelineNote', 'Tiến độ (Timeline)'],
                    ['assumptionConfirmed', 'assumptionNote', 'Giả định/Ngoại lệ'],
                  ] as const).map(([confirmedKey, noteKey, label]) => (
                    <label className="qc-workspace-checklist-item" key={confirmedKey}>
                      <input
                        type="checkbox"
                        checked={Boolean(checklistDraft?.[confirmedKey])}
                        disabled={!canEdit || !isDraft}
                        onChange={event =>
                          setChecklistDraft(prev => (prev ? { ...prev, [confirmedKey]: event.target.checked } : prev))
                        }
                      />
                      <div>
                        <strong>{label}</strong>
                        <input
                          type="text"
                          className="qc-workspace-note-input"
                          placeholder="Ghi chú..."
                          value={checklistDraft?.[noteKey] || ''}
                          disabled={!canEdit || !isDraft}
                          onChange={event =>
                            setChecklistDraft(prev => (prev ? { ...prev, [noteKey]: event.target.value } : prev))
                          }
                        />
                      </div>
                    </label>
                  ))}
                  <textarea
                    className="qc-workspace-handoff-note"
                    placeholder="Ghi chú bàn giao..."
                    value={checklistDraft?.handoffNote || ''}
                    disabled={!canEdit || !isDraft}
                    onChange={event => setChecklistDraft(prev => (prev ? { ...prev, handoffNote: event.target.value } : prev))}
                  />
                </div>
              </details>
            ) : null}

            {/* Card "Phân công & SLA" READ-ONLY o cot chinh (chi hien stage
             * 'request') DA BO - yeu cau ro rang "chỗ Phân công & SLA này để
             * sidebar bên phải chứ k phải cái kia" - CHI CON DUNG 1 noi DUY
             * NHAT hien thi/sua Presale/Sale/SLA la card cung ten trong
             * <aside className="qc-workspace-side"> (luon hien moi stage,
             * sua truc tiep tai do - xem phia tren), tranh trung lap 2 noi
             * gay nham lan "sua o dau moi dung". */}

            {stage === 'pricing' ? (
              <div className="qc-workspace-card">
                <div className="qc-workspace-card-head">
                  <h3>Chuẩn bị hoàn tất giá bán</h3>
                </div>
                <ul className="qc-readiness-list">
                  {([
                    // BUG THAT DA GAP ("chỗ anh dũng có full r mà sao chỗ ni
                    // báo chưa"): itemsDraft.every() truoc day chay tren CA
                    // dong Section (row_type='section', luon co unitPrice=0
                    // theo dung thiet ke - khong tinh tien) - CHI CAN co 1
                    // Muc cha la check nay luon bao "Chưa" du MOI hang muc
                    // that (row_type='item') da co gia ban day du. Loc chi
                    // con hang muc THAT truoc khi check, dung y het bug
                    // hasCostData da sua o backend (_quote_cost_summary).
                    (() => {
                      const realItems = itemsDraft.filter(i => i.rowType !== 'section');
                      return ['Tất cả hạng mục đã có giá bán', realItems.length > 0 && realItems.every(i => (i.unitPrice || 0) > 0)] as const;
                    })(),
                    // "Đã có điều khoản thanh toán" da BO KHOI danh sach nay
                    // - khong con la dieu kien bat buoc de chuyen pricing->
                    // review (migration 109_quote_payment_terms_not_required.sql,
                    // DA APPLY THAT), giu no o day se hien "Chưa" gay hieu
                    // nham sai la van con chan buoc chuyen tiep.
                    ['Đã có dữ liệu margin', hasCostData],
                    ['Đã xác nhận chiết khấu (có thể 0%)', quote ? quote.subtotalAmount != null : true],
                    ['SLA đã nhập', Boolean(quote?.slaDueAt || draftSlaDueAt)],
                  ] as const).map(([label, done]) => (
                    <li key={label} className={`qc-readiness-item ${done ? 'is-done' : 'is-missing'}`}>
                      <span className="qc-readiness-status">{done ? 'Có' : 'Chưa'}</span>
                      <span className="qc-readiness-label">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>Tóm tắt dữ liệu bàn giao</h3>
                <div className="qc-workspace-summary-row">
                  <span>Số hạng mục</span>
                  <strong>{rootItems.length}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Tổng giá vốn</span>
                  <strong>{hasCostData ? formatMoney(rootItems.reduce((sum, i) => sum + (i.costTotal || 0), 0)) : 'Chưa có dữ liệu'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Hạng mục thiếu giá vốn</span>
                  <strong className={itemsMissingCost.length ? 'qc-cell-margin-bad' : undefined}>{itemsMissingCost.length}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Presale</span>
                  <strong>{ownerNameFor(quote?.technicalOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Sale nhận bàn giao</span>
                  <strong>{ownerNameFor(quote?.quoteOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>SLA còn lại</span>
                  <strong>{quote?.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong>
                </div>
                {checklistDirty ? (
                  <div className="qc-workspace-note-box qc-workspace-note-box--warn">Có thay đổi checklist chưa lưu.</div>
                ) : null}
              </div>
            ) : null}

            {stage === 'request' || stage === 'technical' || stage === 'pricing' ? (
              <div className="qc-workspace-card">
                <h3>{stage === 'request' ? 'Lịch sử yêu cầu' : stage === 'technical' ? 'Lịch sử xử lý' : 'Activity'}</h3>
                {(() => {
                  const grouped = groupActivityEntries(activity);
                  const visible = activityExpanded ? grouped : grouped.slice(0, ACTIVITY_COLLAPSED_LIMIT);
                  return (
                    <>
                      <ul className={`qc-workspace-activity${activityExpanded ? ' qc-workspace-activity--scroll' : ''}`}>
                        {activity.length === 0 ? (
                          <li className="qc-workspace-muted">{quote ? 'Chưa có hoạt động nào.' : 'Yêu cầu chưa được lưu.'}</li>
                        ) : null}
                        {visible.map(({ entry, count }) => (
                          <li key={entry.id}>
                            <strong>{nameFor(entry.actorId)}</strong> {activityLogTail(entry)}{count > 1 ? ` (x${count})` : ''}
                            <div className="qc-row-sub">{relativeTime(entry.createdAt)}</div>
                          </li>
                        ))}
                      </ul>
                      {grouped.length > ACTIVITY_COLLAPSED_LIMIT ? (
                        <button type="button" className="qc-mini-btn" onClick={() => setActivityExpanded(v => !v)}>
                          {activityExpanded ? 'Thu gọn' : `Xem tất cả (${grouped.length})`}
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : null}
          </div>

          <aside className="qc-workspace-side">
            {/* "Phân công & SLA để bên sidebar luôn" - LUON hien (khong gate
             * theo stage/draft) o dau sidebar, tach khoi info-strip chinh
             * (Khach hang/Du an/Co hoi/Mau bao gia/Loai bao gia). Giu NGUYEN
             * y het logic/component cu (SearchableSelect + assignOwner +
             * computeQuoteSla...), chi doi VI TRI render. */}
            <div className="qc-workspace-card qc-workspace-assignment-card">
              <h3>Phân công &amp; SLA</h3>
              <div className="qc-workspace-assignment-grid">
                <div>
                  <span className="qc-workspace-info-label">Presale</span>
                  {!quote || (isDraft && canEdit) ? (
                    presaleUsers === null ? (
                      <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải danh sách Presale…</span>
                    ) : presaleUsers.length === 0 ? (
                      <NoStaffConfigured isAdminOrLeader={isAdminOrLeader} />
                    ) : (
                      <SearchableSelect
                        value={quote ? quote.technicalOwnerId || '' : draftTechnicalOwnerId}
                        onChange={value => (quote ? void assignOwner('technicalOwnerId', value) : setDraftTechnicalOwnerId(value))}
                        options={presaleUsers.map(a => ({ value: a.id, label: ownerOptionLabel(a) }))}
                        placeholder="Chưa gán"
                      />
                    )
                  ) : (
                    <strong>{ownerNameFor(quote.technicalOwnerId)}</strong>
                  )}
                </div>
                <div>
                  <span className="qc-workspace-info-label">Sale</span>
                  {!quote || (isDraft && canEdit) ? (
                    saleUsers === null ? (
                      <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải danh sách Sale…</span>
                    ) : saleUsers.length === 0 ? (
                      <NoStaffConfigured isAdminOrLeader={isAdminOrLeader} />
                    ) : (
                      <SearchableSelect
                        value={quote ? quote.quoteOwnerId || '' : draftQuoteOwnerId}
                        onChange={value => (quote ? void assignOwner('quoteOwnerId', value) : setDraftQuoteOwnerId(value))}
                        options={saleUsers.map(a => ({ value: a.id, label: ownerOptionLabel(a) }))}
                        placeholder="Chưa gán"
                      />
                    )
                  ) : (
                    <strong>{ownerNameFor(quote.quoteOwnerId)}</strong>
                  )}
                </div>
                <div>
                  <span className="qc-workspace-info-label" title="Hạn xử lý NỘI BỘ - khác hoàn toàn 'Hiệu lực đến' (hiệu lực báo giá với khách hàng)">
                    SLA / Hạn hoàn tất nội bộ
                  </span>
                  {!quote ? (
                    <input
                      key="sla-draft"
                      type="datetime-local"
                      className="qc-cell-input"
                      value={draftSlaDueAt}
                      onChange={e => setDraftSlaDueAt(e.target.value)}
                    />
                  ) : stage === 'request' && canEdit ? (
                    // key rieng voi input tren - tranh React tuong "cung 1
                    // input" roi bao "controlled -> uncontrolled" khi quote
                    // tu dong duoc tao xong (tu !quote sang co quote NGAY
                    // TRONG 1 phien, khong qua remount) vi input tren dung
                    // value (controlled) con input nay dung defaultValue
                    // (uncontrolled) - key khac buoc React unmount/mount lai
                    // thay vi doi props tren cung 1 DOM node.
                    <input
                      key="sla-existing"
                      type="datetime-local"
                      className="qc-cell-input"
                      defaultValue={isoToDatetimeLocalValue(quote.slaDueAt)}
                      onBlur={e => void updateQuoteSlaDueAt(e.target.value)}
                    />
                  ) : (
                    <strong>{quote.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong>
                  )}
                  {(() => {
                    const sla = computeQuoteSla({
                      slaDueAt: quote ? quote.slaDueAt : (draftSlaDueAt ? new Date(draftSlaDueAt).toISOString() : null),
                      completedAt: quote?.completedAt,
                      sentAt: quote?.sentAt,
                    });
                    if (sla.status === 'not_set') return null;
                    return (
                      <div
                        className="qc-row-sub"
                        style={{
                          color: sla.tone === 'danger' ? '#b3261e' : sla.tone === 'warning' ? '#8a6416' : sla.tone === 'success' ? '#148e61' : undefined,
                        }}
                      >
                        {sla.label}{sla.relativeText ? ` · ${sla.relativeText}` : ''}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Yeu cau rieng "mấy card này đẻ bên sidebar phải đi, đang trống
             * kế bên kìa" - o quote da khoa/duyet (khong phai draft), sidebar
             * truoc day RONG (cac card duoi day chi gate theo stage request/
             * technical/pricing/review, khong co nhanh nao cho 'published'/
             * 'ready_to_publish') trong khi cot chinh qua tai 3 card tong
             * hop. Chuyen "Phê duyệt & version"/"Thông tin phát hành" sang
             * day, cung dieu kien !isDraft nhu cot chinh. "Tổng hợp giá" DA
             * CHUYEN xuong ngay duoi khoi "Hạng mục & cấu trúc giá" o cot
             * chinh (yeu cau rieng "cho nằm dưới đít Hạng mục & cấu trúc giá
             * ở bước 3") - xem ngay sau </div> dong khoi items card. */}
            {!isDraft && quote ? (
              <>
                <div className="qc-workspace-card">
                  <h3>Phê duyệt &amp; version</h3>
                  <div className="qc-workspace-summary-row"><span>Version hiện tại</span><strong>V{quote.versionNumber || 1}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Kết quả Rule Engine</span><strong>{ruleEvaluation ? (ruleEvaluation.result === 'pass' ? 'Đạt' : ruleEvaluation.result === 'fail' ? 'Không đạt' : 'Chưa đủ dữ liệu') : 'Chưa đánh giá'}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Phê duyệt</span><strong>{ruleEvaluation?.autoApproveEnabled ? 'Tự động duyệt' : 'Duyệt thủ công'}</strong></div>
                  <div className="qc-workspace-summary-row"><span>Trạng thái public link</span><strong>{quote.publicEnabled ? 'Đang bật' : 'Chưa bật'}</strong></div>
                </div>

                {quote.processingStage === 'published' ? (
                  <div className="qc-workspace-card">
                    <h3>{quote.sentAt ? 'Thông tin gửi khách' : 'Thông tin phát hành'}</h3>
                    <div className="qc-workspace-summary-row"><span>Public URL</span><strong>{quote.publicUrl || '—'}</strong></div>
                    <div className="qc-workspace-summary-row"><span>Người phát hành</span><strong>{quote.publishedById ? nameFor(quote.publishedById) : '—'}</strong></div>
                    <div className="qc-workspace-summary-row"><span>Ngày phát hành</span><strong>{quote.publishedAt ? formatDate(quote.publishedAt) : '—'}</strong></div>
                    {/* "Giới hạn xem link báo giá bằng Email hoặc Số điện
                     * thoại" (migration 118) - mac dinh "Không giới hạn"
                     * (khong doi hanh vi cu, ai co link cung xem duoc). CHI 1
                     * trong 3 che do co hieu luc tai 1 thoi diem (radio, khong
                     * phai checkbox+danh sach nhu ban cu) - tranh dut khoat
                     * bug "tắt giới hạn nhưng vẫn yêu cầu Email" da gap truoc
                     * do (khi do dung 1 boolean rieng + danh sach song song,
                     * de "quen" cap nhat 1 trong 2 khi tat). */}
                    <div className="qc-workspace-email-gate">
                      <div className="qc-workspace-access-mode-toggle">
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'none'} onChange={() => setAccessModeAndSuggest('none')} />
                          Không giới hạn
                        </label>
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'email'} onChange={() => setAccessModeAndSuggest('email')} />
                          Giới hạn theo Email
                        </label>
                        <label>
                          <input type="radio" name="quote-public-access-mode" checked={accessMode === 'phone'} onChange={() => setAccessModeAndSuggest('phone')} />
                          Giới hạn theo Số điện thoại
                        </label>
                      </div>
                      {accessMode === 'email' ? (
                        <textarea
                          className="qc-workspace-email-gate-textarea"
                          placeholder={'Nhập email được phép xem, mỗi dòng 1 email\nvd: khach@congty.com'}
                          value={accessEmailsText}
                          onChange={e => setAccessEmailsText(e.target.value)}
                        />
                      ) : null}
                      {accessMode === 'phone' ? (
                        <textarea
                          className="qc-workspace-email-gate-textarea"
                          placeholder={'Nhập số điện thoại được phép xem, mỗi dòng 1 số\nvd: 0901234567'}
                          value={accessPhonesText}
                          onChange={e => setAccessPhonesText(e.target.value)}
                        />
                      ) : null}
                      <button type="button" className="qc-mini-btn" disabled={accessSaving} onClick={() => void saveAccessRestriction()}>
                        {accessSaving ? 'Đang lưu...' : 'Lưu giới hạn xem link'}
                      </button>
                    </div>
                    {quote.sentAt ? (
                      <>
                        <div className="qc-workspace-summary-row"><span>Người gửi</span><strong>{quote.sentById ? nameFor(quote.sentById) : '—'}</strong></div>
                        <div className="qc-workspace-summary-row"><span>Ngày gửi</span><strong>{formatDate(quote.sentAt)}</strong></div>
                        {(() => {
                          const sla = computeQuoteSla({ slaDueAt: quote.slaDueAt, completedAt: quote.completedAt, sentAt: quote.sentAt });
                          return (
                            <div className="qc-workspace-summary-row">
                              <span>SLA</span>
                              <strong style={{ color: sla.tone === 'danger' ? '#b3261e' : sla.tone === 'success' ? '#148e61' : undefined }}>{sla.label}</strong>
                            </div>
                          );
                        })()}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            {stage === 'request' ? (
              <div className="qc-workspace-card">
                <h3>Tóm tắt yêu cầu</h3>
                <div className="qc-workspace-summary-row">
                  <span>Khách hàng</span>
                  <strong>{deal?.customerName || (draftCustomerId ? customers.find(c => c.id === draftCustomerId)?.label : null) || 'Chưa chọn'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Dự án</span>
                  <strong>{(projects || []).find(p => p.id === (quote ? quote.projectId : draftProjectId))?.name || 'Chưa thuộc dự án'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Cơ hội</span>
                  <strong>{businessCode || (deal ? 'Chưa có mã' : 'Chưa gắn cơ hội')}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>SLA</span>
                  <strong>{(quote ? quote.slaDueAt : draftSlaDueAt) ? formatDate(quote ? quote.slaDueAt! : new Date(draftSlaDueAt).toISOString()) : 'Chưa đặt SLA'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Loại báo giá</span>
                  <strong>{currentQuoteTypeCodes.length > 0 ? currentQuoteTypeCodes.map(quoteTypeLabel).join(', ') : 'Chưa chọn'}</strong>
                </div>
              </div>
            ) : null}

            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>Tổng giá vốn</h3>
                <div className="qc-workspace-summary-row">
                  <span>Tổng giá vốn</span>
                  <strong>{hasCostData ? formatMoney(rootItems.reduce((sum, i) => sum + (i.costTotal || 0), 0)) : 'Chưa có dữ liệu'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Hạng mục thiếu giá vốn</span>
                  <strong className={itemsMissingCost.length ? 'qc-cell-margin-bad' : undefined}>{itemsMissingCost.length}</strong>
                </div>
              </div>
            ) : null}
            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>Tiến độ checklist</h3>
                <ul className="qc-workspace-checks">
                  <li className={checklistDraft?.scopeConfirmed ? 'ok' : 'pending'}>Phạm vi (Scope)</li>
                  <li className={checklistDraft?.costConfirmed ? 'ok' : 'pending'}>Giá vốn (Cost)</li>
                  <li className={checklistDraft?.timelineConfirmed ? 'ok' : 'pending'}>Tiến độ (Timeline)</li>
                  <li className={checklistDraft?.assumptionConfirmed ? 'ok' : 'pending'}>Giả định/Ngoại lệ</li>
                </ul>
              </div>
            ) : null}
            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <h3>SLA</h3>
                <div className="qc-workspace-summary-row">
                  <span>Hạn hoàn tất nội bộ</span>
                  <strong>{quote?.slaDueAt ? formatDate(quote.slaDueAt) : 'Chưa đặt SLA'}</strong>
                </div>
              </div>
            ) : null}

            {stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Tổng hợp thương mại</h3>
              <div className="qc-workspace-summary-row">
                <span>Trước chiết khấu</span>
                <strong>{quote ? formatMoney(quote.subtotalAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Chiết khấu</span>
                <strong>{quote ? formatMoney(Math.max(0, quote.subtotalAmount - (quote.netRevenue ?? quote.subtotalAmount))) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Sau chiết khấu</span>
                <strong>{quote ? formatMoney(quote.netRevenue ?? quote.subtotalAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>VAT</span>
                <strong>{quote ? formatMoney(quote.vatAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row qc-workspace-summary-row--total">
                <span>Khách thanh toán</span>
                <strong>{quote ? formatMoney(quote.totalAmount) : '0 đ'}</strong>
              </div>
              <div className="qc-workspace-summary-row">
                <span>Lợi nhuận dự kiến</span>
                <strong className={hasCostData ? 'qc-cell-margin-good' : 'qc-workspace-muted'}>
                  {hasCostData ? formatMoney(quote!.grossProfit || 0) : 'Chưa có dữ liệu giá vốn'}
                </strong>
              </div>
              {hasCostData && quote?.grossMarginPercent != null ? (
                <div className="qc-workspace-margin-bar">
                  <div className="qc-workspace-margin-bar-track">
                    <div className="qc-workspace-margin-bar-fill" style={{ width: `${Math.max(0, Math.min(100, quote.grossMarginPercent))}%` }} />
                  </div>
                  <span>Margin {formatPercentTrim(quote.grossMarginPercent)}</span>
                </div>
              ) : null}
            </div>
            ) : null}

            {stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card qc-rule-card">
              <div className="qc-workspace-card-head">
                <div>
                  <h3>Quy tắc phê duyệt</h3>
                  <p className="qc-rule-card-subtitle">
                    {ruleSet ? `${ruleSet.name} · V${ruleSet.version}` : ruleSetLoaded ? 'Chưa cấu hình quy tắc' : 'Đang tải…'}
                  </p>
                </div>
              </div>

              {ruleSet ? (
                <>
                  <ul className="qc-rule-list">
                    {ruleSet.rules.map(rule => {
                      const detail = ruleEvaluation?.details.find(d => d.ruleType === rule.ruleType);
                      const label = RULE_LABELS[rule.ruleType]?.label || rule.ruleType;
                      const statusIcon = !detail ? '•' : detail.status === 'pass' ? '✓' : detail.status === 'fail' ? '✗' : '•';
                      const statusClass = !detail ? 'qc-rule-row--pending' : detail.status === 'pass' ? 'qc-rule-row--pass' : detail.status === 'fail' ? 'qc-rule-row--fail' : 'qc-rule-row--pending';
                      return (
                        <li key={rule.ruleType} className={`qc-rule-row ${statusClass}`}>
                          <span className="qc-rule-row-icon">{statusIcon}</span>
                          <span className="qc-rule-row-label">{label}</span>
                          <span className="qc-rule-row-value">{detail ? detail.actualDisplay : 'Chưa có dữ liệu'}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="qc-rule-summary">
                    {!ruleEvaluation
                      ? 'Chưa đủ dữ liệu để đánh giá'
                      : ruleEvaluation.result === 'pass'
                        ? `✓ Đạt ${ruleEvaluation.details.length}/${ruleEvaluation.details.length} quy tắc${ruleEvaluation.autoApproveEnabled ? ' · tự động duyệt' : ''}`
                        : ruleEvaluation.result === 'insufficient_data'
                          ? 'Chưa đủ dữ liệu để đánh giá'
                          : `Không đạt ${ruleEvaluation.details.filter(d => d.status === 'fail').length}/${ruleEvaluation.details.length} quy tắc`}
                  </div>
                </>
              ) : (
                <p className="qc-workspace-muted" style={{ fontSize: 13 }}>
                  {canManageApprovalRules
                    ? 'Chưa có quy tắc phê duyệt nào được cấu hình — vào "Cài đặt báo giá" (menu Quản lý CRM) để thiết lập.'
                    : 'Chưa có quy tắc phê duyệt nào được cấu hình.'}
                </p>
              )}
            </div>
            ) : null}

            {/* Card qc-workspace-actions (Xem bản khách hàng/Gửi khách hàng/
             * link) o stage==='review' DA BO HET - yeu cau rieng "Xem bản
             * khách hàng" trùng header (đã gỡ), roi "gửi khách hàng đang
             * chờ duyệt dỡ luôn đi": "Gửi khách hàng" o day LUON disabled
             * (sendDisabledReason luon = "Báo giá chưa được duyệt" khi
             * stage==='review', vi quote.status CHI thanh 'approved' SAU KHI
             * roi khoi stage nay - xem approveNow()/RPC quote_approve) - nut
             * khong bao gio bam duoc o day, chi la UI chet. 3 khoi con lai
             * trong card (copy/khoá/mở link) deu dieu kien
             * quote?.status==='approved' nen CUNG khong bao gio hien khi con
             * o 'review' (status chi approved SAU stage nay) - ca card rong
             * khong con gi de hien, bo han thay vi de trong. */}

            {stage === 'request' || stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Kiểm tra dữ liệu</h3>
              <ul className="qc-workspace-checks">
                <li className={deal ? 'ok' : 'pending'}>Đã có thông tin khách hàng</li>
                {/* BUG THAT DA GAP: rootItems = quote?.items (chi co gia tri
                 * SAU KHI quote da tao that) - o che do tao moi (!quote),
                 * rootItems LUON RONG du go bao nhieu hang muc di nua, khien
                 * o nay khong bao gio hien "da xong" cho toi khi bam Bàn
                 * giao xong. Doc tu itemsDraft (ban nhap dang go) khi chua
                 * co quote that thay vi rootItems. */}
                <li className={(quote ? rootItems.length > 0 : itemsDraft.length > 0) ? 'ok' : 'pending'}>Đã có hạng mục và chi phí</li>
                <li className={(quote ? hasCostData : itemsDraft.some(item => item.markupPercent != null || item.unitPrice > 0)) ? 'ok' : 'pending'}>Đã nhập giá bán/markup</li>
                {/* "Đã có điều khoản thanh toán"/"Đã mô tả phạm vi công việc"
                 * da BO KHOI checklist nay theo yeu cau - ca 2 deu KHONG bat
                 * buoc (dieu khoan thanh toan van con bat buoc rieng o buoc
                 * pricing->review qua "Chuẩn bị hoàn tất giá bán" ben tren,
                 * scope thi khong con bat buoc dau nao ca - xem migration
                 * 108_quote_scope_not_required.sql). */}
              </ul>
              {marginBelowThreshold ? (
                <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                  Cảnh báo: margin {quote?.grossMarginPercent?.toFixed(2)}% dưới ngưỡng tham chiếu 20%.
                </div>
              ) : null}
            </div>
            ) : null}

            {/* Card "Preview khách hàng" lon (o sidebar) DA BO - yeu cau rieng
             * "Bỏ card Preview khách hàng lớn đang chiếm diện tích vì đã có
             * nút Xem bản khách hàng trên header bảng" (xem
             * qc-workspace-items-card-head-actions, dung LAI DUNG
             * canPreview/previewDisabledReason/setPreviewModalOpen, khong
             * tao luong preview moi nao). */}

            {stage === 'request' || stage === 'technical' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>{stage === 'request' ? 'Activity ngắn' : 'Activity & handoff'}</h3>
              {(() => {
                const grouped = groupActivityEntries(activity);
                const visible = activityExpanded ? grouped : grouped.slice(0, ACTIVITY_COLLAPSED_LIMIT);
                return (
                  <>
                    <ul className={`qc-workspace-activity${activityExpanded ? ' qc-workspace-activity--scroll' : ''}`}>
                      {activity.length === 0 ? (
                        <li className="qc-workspace-muted">{quote ? 'Chưa có hoạt động nào.' : 'Yêu cầu chưa được lưu.'}</li>
                      ) : null}
                      {visible.map(({ entry, count }) => (
                        <li key={entry.id}>
                          <strong>{nameFor(entry.actorId)}</strong> {ACTIVITY_LABELS[entry.action] || entry.action}{count > 1 ? ` (x${count})` : ''}
                          <div className="qc-row-sub">{relativeTime(entry.createdAt)}</div>
                        </li>
                      ))}
                    </ul>
                    {grouped.length > ACTIVITY_COLLAPSED_LIMIT ? (
                      <button type="button" className="qc-mini-btn" onClick={() => setActivityExpanded(v => !v)}>
                        {activityExpanded ? 'Thu gọn' : `Xem tất cả (${grouped.length})`}
                      </button>
                    ) : null}
                  </>
                );
              })()}
            </div>
            ) : null}
          </aside>
        </div>

        <div className="qc-workspace-footer">
          {!quote ? (
            <>
              <button type="button" className="qc-btn" disabled={busy} onMouseDown={markClosingIntent} onClick={onClose}>Huỷ</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy}
                aria-busy={busy && activeAction === 'handoff'}
                onClick={() => void createRequest(true)}
              >
                {actionButtonContent('handoff', 'Bàn giao')}
              </button>
            </>
          ) : !isDraft ? (
            <>
              <button type="button" className="qc-btn" disabled={busy} onMouseDown={markClosingIntent} onClick={onClose}>← Danh sách</button>
              {quote.status === 'approved' ? (
                <>
                  <button type="button" className="qc-btn" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem bản khách hàng
                  </button>
                  {quote.processingStage === 'published' ? (
                    <>
                      {quote.publicEnabled ? (
                        <>
                          <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                            <Link2 className="qc-icon" /> Sao chép link báo giá
                          </button>
                          <button type="button" className="qc-btn" disabled={busy} onClick={() => void revokePublicLinkFromWorkspace()}>
                            Khoá link
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="qc-workspace-footer-note">Link báo giá đã bị khoá</span>
                          <button type="button" className="qc-btn" disabled={busy} onClick={() => void enablePublicLinkFromWorkspace()}>
                            Mở lại link
                          </button>
                        </>
                      )}
                      {quote.sentAt ? (
                        <>
                          <button type="button" className="qc-btn" onClick={() => void viewDeliveryLog()}>
                            <History className="qc-icon" /> Xem lịch sử gửi
                          </button>
                          <button
                            type="button"
                            className="qc-btn qc-btn-primary"
                            disabled={Boolean(sendDisabledReason)}
                            title={sendDisabledReason}
                            onClick={() => void openSendModal()}
                          >
                            <Send className="qc-icon" /> Gửi lại
                          </button>
                          <span className="qc-workspace-footer-note">
                            Đã gửi{quote.sentAt ? ` · ${relativeTime(quote.sentAt)}` : ''}
                          </span>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="qc-btn qc-btn-primary"
                          disabled={Boolean(sendDisabledReason)}
                          title={sendDisabledReason}
                          onClick={() => void openSendModal()}
                        >
                          <Send className="qc-icon" /> Gửi khách hàng
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" className="qc-btn qc-btn-primary" onClick={() => setPublishModalOpen(true)}>
                      Phát hành
                    </button>
                  )}
                </>
              ) : null}
              <span className="qc-workspace-footer-note">
                Version đã khoá{versionButtonState.disabled ? '' : ' · Tạo revision để sửa'}
              </span>
            </>
          ) : (
            <>
              <button type="button" className="qc-btn" disabled={busy} onMouseDown={markClosingIntent} onClick={onClose}>← Danh sách</button>
              {(stage === 'request' || stage === 'technical') && canEdit ? (
                // MOT nut duy nhat cho ca Buoc 1 gop (request VA technical la
                // CUNG 1 buoc UI "Yêu cầu & Kỹ thuật") - khong con tach thanh
                // "Gửi yêu cầu xử lý" roi "Bàn giao xử lý giá" nhu 2 luot bam
                // lien tiep (bug that da gap: nhin nhu Buoc 1 chay 2 lan).
                // handoffStep1ToPricing() tu xu ly ca 2 hop (request-
                // >technical NEU can, roi ->pricing) trong CUNG 1 lan bam.
                <>
                  <button type="button" className="qc-btn" disabled={busy || !checklistDirty} title="Lưu checklist ngay (không bắt buộc — bấm Bàn giao cũng tự lưu)" onClick={saveChecklist}>Lưu</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || itemsMissingCost.length > 0 || (stage === 'request' && !quote?.slaDueAt)}
                    aria-busy={busy && activeAction === 'handoff'}
                    title={
                      stage === 'request' && !quote?.slaDueAt
                        ? 'Cần đặt SLA / hạn hoàn tất nội bộ trước khi Bàn giao'
                        : itemsMissingCost.length > 0
                        ? `Còn ${itemsMissingCost.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu "Không áp dụng"`
                        : undefined
                    }
                    onClick={() => void handoffStep1ToPricing()}
                  >
                    {actionButtonContent('handoff', 'Bàn giao')}
                  </button>
                </>
              ) : null}
              {stage === 'pricing' && canEdit ? (
                <>
                  <button type="button" className="qc-btn" disabled={busy} aria-busy={busy && activeAction === 'draftSave'} onClick={() => void persistQuote({}).then(() => showToast(true, 'Đã lưu báo giá.'))}>{actionButtonContent('draftSave', 'Lưu')}</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || !canReadyForApproval}
                    aria-busy={busy && activeAction === 'reviewPricing'}
                    title={!canReadyForApproval ? 'Cần ít nhất 1 hạng mục và tổng tiền > 0 trước khi gửi duyệt' : undefined}
                    onClick={() => void advanceStage('review')}
                  >
                    {actionButtonContent('reviewPricing', 'Hoàn tất phần giá bán')}
                  </button>
                </>
              ) : null}
              {stage === 'review' ? (
                <>
                  <button type="button" className="qc-btn" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem bản khách hàng
                  </button>
                  {canEdit ? (
                    <button type="button" className="qc-btn" disabled={busy} onClick={() => setRequestChangesModalOpen(true)}>
                      Yêu cầu chỉnh sửa
                    </button>
                  ) : null}
                  {canApprove ? (
                    <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => setApproveModalOpen(true)}>
                      <CheckCircle2 className="qc-icon" /> Duyệt báo giá
                    </button>
                  ) : (
                    <span className="qc-workspace-footer-note">Chờ người có quyền duyệt (Admin hoặc được cấp quyền) xử lý.</span>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {quote && versionModalOpen ? (
        <div className="qc-modal-backdrop">
          <div className="qc-deal-picker">
            <h3>Tạo phiên bản V{(quote.versionNumber || 1) + 1}</h3>
            <p className="qc-workspace-note">Báo giá {quote.quoteNumber} · giữ nguyên version cũ để đối chiếu</p>
            <label className="qc-workspace-info-label">Lý do tạo revision</label>
            <select className="crm-input" value={versionReason} onChange={event => setVersionReason(event.target.value)}>
              {VERSION_REASONS.map(reason => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
            <div className="qc-workspace-note-box">
              Version {quote.versionNumber || 1} sẽ được giữ nguyên, không sửa được nữa. Toàn bộ dữ liệu sẽ copy sang bản nháp mới.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setVersionModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => void confirmCreateVersion()}>
                Tạo version mới
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ProjectFormModal
        open={projectModalOpen}
        customerId={effectiveCustomerIdForProjects || ''}
        customerName={quote ? deal?.customerName || 'Khách hàng hiện tại' : customers.find(c => c.id === draftCustomerId)?.label || 'Khách hàng hiện tại'}
        onClose={() => setProjectModalOpen(false)}
        onSaved={created => {
          setProjectModalOpen(false);
          if (!created) return;
          setProjects(prev => [...(prev || []), created]);
          if (quote) void updateQuoteProject(created.id);
          else setDraftProjectId(created.id);
        }}
      />

      <DealFormModal
        open={dealModalOpen}
        loading={dealCreateBusy}
        onClose={() => { if (!dealCreateBusy) setDealModalOpen(false); }}
        onCreate={input => void handleCreateQuickDeal(input)}
        onUpdate={() => {}}
        agents={quickCreateAgents}
        sourceOptions={SOURCE_OPTIONS}
        servicePackageOptions={SERVICE_PACKAGE_OPTIONS}
        packageOptions={CRM_PACKAGE_OPTIONS}
        industryOptions={INDUSTRY_OPTIONS.map(value => ({ value, label: value }))}
        currentUser={user ?? null}
        initialCustomer={
          draftCustomerId
            ? { id: draftCustomerId, name: customers.find(c => c.id === draftCustomerId)?.label || '' }
            : null
        }
        initialProject={draftProjectId ? { id: draftProjectId } : null}
      />
      {dealCreateError ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={() => setDealCreateError('')}>
          <div className="qc-deal-picker" onMouseDown={event => event.stopPropagation()}>
            <h3>Không tạo được cơ hội</h3>
            <div className="qc-workspace-note-box qc-workspace-note-box--warn">{dealCreateError}</div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn qc-btn-primary" onClick={() => setDealCreateError('')}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {previewModalOpen ? (() => {
        // BUG THAT DA GAP ("bấm Preview khách hàng ở bước 1 ra bảng cũ chứ
        // không hiện bản PDF"): xem giai thich day du o khai bao
        // draftSelectedForm/draftPreviewData/draftPreviewTotals o tren -
        // resolve schema tu quote THAT (da luu) HOAC tu mau bao gia da chon
        // trong dropdown (che do tao moi, chua luu) - CHI khi ca 2 deu
        // khong co (chua chon mau nao ca) moi roi ve ban rut gon cu.
        const previewSchema = quote?.formSnapshot || draftSelectedForm?.schemaJson;
        return (
      <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewModalOpen(false); }}>
          <div className={`qc-workspace-preview-modal${previewSchema ? ' qc-workspace-preview-modal--doc' : ''}`}>
            <div className="qc-workspace-modal-head">
              <h3>{quote ? 'Bản xem trước cho khách hàng' : 'Bản xem trước'}</h3>
              <div className="qc-workspace-card-head-badges">
                {/* Yeu cau rieng "xóa nút In/Tải chỗ bản xem trước đi" - bug
                 * phan trang khi in tu modal nay (11 trang, lap letterhead)
                 * chua sua trietj de duoc, bo han nut de tranh nguoi dung
                 * dung nham duong hong loi. In/Tai PDF that van dung duoc
                 * qua trang chi tiet bao gia (/all-platform/quotes/[id]) hoac
                 * link cong khai gui khach - 2 noi do khong qua modal nay. */}
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setPreviewModalOpen(false)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
            </div>
            {/* CHOT LAI (yeu cau ro rang "Preview phải dùng chung renderer và
             * cùng dữ liệu với public quote/PDF/bản in, không duy trì renderer
             * rút gọn riêng"): khi quote da co formSnapshot that (da tao xong,
             * da chon Mau bao gia), dung THANG QuoteDocumentRenderer mode=
             * 'public' - CHINH XAC cung component/du lieu voi trang cong khai
             * (xem PublicQuotePage.tsx) nen tu dong an het Gia von/Markup/
             * Margin/ghi chu noi bo (schema cong khai von di khong co field
             * nay), khong phai tu allowlist rieng nhu ban rut gon cu. Bao boc
             * trong .quote-print-root de tai dung dung co che "in bulletproof"
             * da co san (quotes.css) - visibility:hidden ca trang, chi hien
             * dung khoi nay, hoat dong DU dang nam trong modal long nhieu lop. */}
            {previewSchema ? (
              // CHOT LAI (yeu cau ro rang "popup quá nhỏ, không cuộn xuống
              // được"): BO HAN co che transform:scale() + do dac JS truoc do
              // (fragile, tinh chieu cao sai la mat noi dung/khong cuon
              // duoc) - .quote-sheet/.quote-sheet--print-landscape BAN THAN
              // DA CO `width: min(210mm|297mm, 100%)` (xem quotes.css), tu
              // nhien co lai vua khit container KHONG CAN JS - don gian hon,
              // it loi hon han. Container o day CHI can la vung cuon DOC
              // that (overflow-y:auto, overflow-x:hidden), qua .qc-workspace-
              // preview-modal-body--doc (CSS da doi lai thanh flex:1 min-
              // height:0 - xem quote-center.css).
              <div className="quote-print-root qc-workspace-preview-modal-body qc-workspace-preview-modal-body--doc">
                <QuoteDocumentRenderer
                  schemaSnapshot={previewSchema}
                  quoteData={quote ? quote.data : draftPreviewData}
                  quoteItems={itemsDraft}
                  solutionItems={quote ? quote.data?.solutionItems : undefined}
                  totals={quote ? {
                    subtotalAmount: quote.subtotalAmount ?? 0,
                    totalVatAmount: quote.vatAmount ?? 0,
                    totalAmount: quote.totalAmount ?? 0,
                  } : draftPreviewTotals}
                  mode="public"
                  isPublished={quote ? quote.processingStage === 'published' : false}
                  quoteNumber={quote?.quoteNumber}
                />
              </div>
            ) : (
              /* Chi con dung khi CHUA chon mau bao gia nao ca (khong co
               * schema nao de dung chung renderer) - giu ban toi gian cu lam
               * fallback cuoi cung cho dung truong hop hiem nay. */
              <div className="qc-workspace-preview-modal-body">
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Khách hàng</span>
                  <strong>{deal?.customerName || 'Chưa gắn cơ hội'}</strong>
                </div>
                <table className="qc-linked-table qc-linked-table--preview4col">
                  <thead>
                    <tr>
                      <th>Hạng mục</th>
                      <th className="qc-th-money">SL</th>
                      <th className="qc-th-money">Đơn giá</th>
                      <th className="qc-th-money">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let sectionCounter = 0;
                      return itemsDraft.map((item, index) => {
                        if (item.rowType === 'section') {
                          sectionCounter += 1;
                          const previewRoman = toRomanNumeral(sectionCounter);
                          return (
                            <tr key={item.id || index} className="qc-linked-table-section-row">
                              <td colSpan={4}>
                                <strong>{previewRoman}. {stripLeadingRomanPrefix(item.description || '', previewRoman) || 'Mục mới'}</strong>
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={item.id || index}>
                            <td>{item.serviceDescription || '—'}</td>
                            <td className="qc-cell-money">{item.quantity}</td>
                            <td className="qc-cell-money">{formatMoney(item.unitPrice)}</td>
                            <td className="qc-cell-money">{formatMoney(item.totalAmount || item.quantity * item.unitPrice || 0)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
                <div className="qc-workspace-summary-row">
                  <span>VAT</span>
                  <strong>{formatMoney(previewTotals.vat)}</strong>
                </div>
                <div className="qc-workspace-summary-row qc-workspace-summary-row--total">
                  <span>Tổng thanh toán</span>
                  <strong>{formatMoney(previewTotals.total)}</strong>
                </div>
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Điều khoản thanh toán</span>
                  <p>Thanh toán trong {draftPaymentTermsDays} ngày kể từ ngày duyệt báo giá.</p>
                </div>
              </div>
            )}
          </div>
        </div>
        );
      })() : null}

      {quote && sendModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setSendModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Gửi khách hàng</h3>
            <p className="qc-workspace-note">Báo giá {quote.quoteNumber} · V{quote.versionNumber || 1}</p>

            {sendSuccess ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--ok">
                Đã gửi báo giá tới {sendRecipientEmail}.
              </div>
            ) : (
              <>
                <label className="qc-workspace-info-label">Người nhận</label>
                <input
                  type="text"
                  className="crm-input"
                  value={sendRecipientName}
                  onChange={event => setSendRecipientName(event.target.value)}
                  placeholder="Tên người nhận (không bắt buộc)"
                />
                <label className="qc-workspace-info-label">Email người nhận</label>
                <input
                  type="email"
                  className="crm-input"
                  value={sendRecipientEmail}
                  onChange={event => { setSendRecipientEmail(event.target.value); setSendRecipientSource('manual'); }}
                  placeholder="email@khachhang.com"
                />
                {sendRecipientSource ? (
                  <p className="qc-workspace-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                    Nguồn email: {sendRecipientSource === 'deal_contact' ? 'Cơ hội CRM' : sendRecipientSource === 'crm_customer' ? 'Hồ sơ khách hàng' : 'Nhập tay'}
                  </p>
                ) : null}

                <label className="qc-workspace-info-label">Tiêu đề</label>
                <input
                  type="text"
                  className="crm-input"
                  value={sendSubject}
                  onChange={event => setSendSubject(event.target.value)}
                />

                <label className="qc-workspace-info-label">Lời nhắn</label>
                <textarea
                  className="qc-workspace-handoff-note"
                  rows={3}
                  value={sendMessage}
                  onChange={event => setSendMessage(event.target.value)}
                  placeholder="Lời nhắn gửi kèm báo giá..."
                />

                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Public link</span>
                  <a href={quote.publicUrl || '#'} target="_blank" rel="noreferrer">{quote.publicUrl}</a>
                </div>

                <label className="qc-workspace-checklist-item" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={sendAttachPdf} onChange={event => setSendAttachPdf(event.target.checked)} />
                  <span>Đính kèm PDF (tự render từ bản khách hàng)</span>
                </label>

                {sendError ? (
                  <div className="qc-workspace-note-box qc-workspace-note-box--warn">{sendError}</div>
                ) : null}
              </>
            )}

            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={sendBusy} onClick={() => setSendModalOpen(false)}>
                {sendSuccess ? 'Đóng' : 'Huỷ'}
              </button>
              {!sendSuccess ? (
                <button
                  type="button"
                  className="qc-btn qc-btn-primary"
                  disabled={sendBusy || !sendRecipientEmail.trim()}
                  aria-busy={sendBusy}
                  onClick={() => void submitSendQuote()}
                >
                  {sendBusy ? (<><span className="qc-btn-spinner" aria-hidden="true" /> Đang gửi…</>) : sendError ? 'Thử lại' : 'Gửi báo giá'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}


      {workspaceToast ? (
        <div className={`qc-workspace-toast ${workspaceToast.ok ? 'qc-workspace-toast--ok' : 'qc-workspace-toast--error'}`}>
          <span>{workspaceToast.text}</span>
          {workspaceToast.action ? (
            <button
              type="button"
              className="qc-workspace-toast-action"
              onClick={() => {
                workspaceToast.action!.onClick();
                setWorkspaceToast(null);
              }}
            >
              {workspaceToast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {quote && approveModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setApproveModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Duyệt báo giá</h3>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Mã báo giá/version</span>
              <strong>{quote.quoteNumber} · V{quote.versionNumber || 1}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Người gửi duyệt</span>
              <strong>{ownerNameFor(quote.quoteOwnerId) === 'Chưa gán' ? nameFor(quote.createdById) : ownerNameFor(quote.quoteOwnerId)}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Tổng thanh toán</span>
              <strong>{formatMoney(quote.totalAmount)}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Margin</span>
              <strong className={marginBelowThreshold ? 'qc-cell-margin-warn' : hasCostData ? 'qc-cell-margin-good' : ''}>
                {hasCostData && quote.grossMarginPercent != null ? formatPercentTrim(quote.grossMarginPercent) : 'Chưa có dữ liệu giá vốn'}
              </strong>
            </div>
            {marginBelowThreshold ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                Cảnh báo: margin dưới ngưỡng tham chiếu 20%.
              </div>
            ) : null}
            <div className="qc-workspace-note-box">
              Sau khi duyệt, version {quote.versionNumber || 1} sẽ bị khoá — không sửa được nữa, chỉ tạo được phiên bản mới.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setApproveModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} aria-busy={busy && activeAction === 'approve'} onClick={() => void approveNow()}>
                {actionButtonContent('approve', 'Duyệt báo giá')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && exceptionApprovalModal.open ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setExceptionApprovalModal({ open: false, reason: '', evaluation: null }); }}>
          <div className="qc-deal-picker">
            <h3>Phê duyệt ngoại lệ</h3>
            <div className="qc-workspace-note-box qc-workspace-note-box--warn">
              Báo giá {quote.quoteNumber} · V{quote.versionNumber || 1} chưa đạt Rule Engine
              {exceptionApprovalModal.evaluation?.result === 'insufficient_data' ? ' (chưa đủ dữ liệu để đánh giá)' : ''}.
              Bạn đang duyệt NGOẠI LỆ — bắt buộc nhập lý do, quyết định này sẽ được ghi lại trong lịch sử.
            </div>
            {Array.isArray((exceptionApprovalModal.evaluation?.details as Array<{ label?: string; reason?: string; status?: string }> | undefined)) ? (
              <ul className="qc-workspace-activity" style={{ marginBottom: 12 }}>
                {(exceptionApprovalModal.evaluation!.details as Array<{ ruleType: string; label: string; reason: string; status: string }>).map(d => (
                  <li key={d.ruleType} className={d.status === 'fail' ? 'qc-cell-margin-warn' : d.status === 'insufficient_data' ? 'qc-workspace-muted' : undefined}>
                    {d.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <label>
              <span className="qc-workspace-info-label">Lý do phê duyệt ngoại lệ (bắt buộc)</span>
              <textarea
                className="qc-workspace-handoff-note"
                rows={3}
                value={exceptionApprovalModal.reason}
                onChange={event => setExceptionApprovalModal(prev => ({ ...prev, reason: event.target.value }))}
                placeholder="Vd: Khách hàng chiến lược, chấp nhận margin thấp hơn ngưỡng để giữ quan hệ dài hạn."
              />
            </label>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setExceptionApprovalModal({ open: false, reason: '', evaluation: null })}>Huỷ</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !exceptionApprovalModal.reason.trim()}
                aria-busy={busy && activeAction === 'approve'}
                onClick={() => void approveWithExceptionNow()}
              >
                {actionButtonContent('approve', 'Duyệt ngoại lệ')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && publishModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPublishModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Phát hành báo giá</h3>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Version</span>
              <strong>{quote.quoteNumber} · V{quote.versionNumber || 1}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Hiệu lực báo giá</span>
              <strong>{quote.validUntil ? formatDate(quote.validUntil) : 'Chưa đặt hiệu lực'}</strong>
            </div>
            <div className="qc-workspace-preview-modal-row">
              <span className="qc-workspace-info-label">Public link</span>
              {quote.publicUrl ? (
                <strong>Đã bật — {window.location.origin}{quote.publicUrl}</strong>
              ) : (
                <strong>Chưa bật</strong>
              )}
            </div>
            {quote.publicUrl ? (
              <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                <Link2 className="qc-icon" /> Sao chép public link
              </button>
            ) : null}
            <div className="qc-workspace-note-box">
              Sau khi phát hành, version {quote.versionNumber || 1} sẽ được khoá, public link sẽ được bật thật.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setPublishModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} aria-busy={busy && activeAction === 'publish'} onClick={() => void publishNow()}>
                {actionButtonContent('publish', 'Xác nhận phát hành')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && deliveryLogModal.open ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setDeliveryLogModal(m => ({ ...m, open: false })); }}>
          <div className="qc-deal-picker">
            <h3>Lịch sử gửi báo giá</h3>
            {deliveryLogModal.loading ? (
              <div className="qc-workspace-muted">Đang tải lịch sử gửi…</div>
            ) : deliveryLogModal.error ? (
              <div className="qc-workspace-note-box qc-workspace-note-box--warn">{deliveryLogModal.error}</div>
            ) : deliveryLogModal.entries.length === 0 ? (
              <div className="qc-workspace-muted">Chưa có lần gửi nào.</div>
            ) : (
              <div className="qc-table-wrap">
                <table className="qc-linked-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Người nhận</th>
                      <th>Người gửi</th>
                      <th>Trạng thái</th>
                      <th>Lần thử</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryLogModal.entries.map(entry => (
                      <tr key={entry.id}>
                        <td>{entry.requestedAt ? formatDate(entry.requestedAt) : '—'}</td>
                        <td>
                          {entry.recipientName || 'Chưa rõ'}
                          {entry.recipientEmail ? <div className="qc-row-sub">{entry.recipientEmail}</div> : null}
                        </td>
                        <td>{nameFor(entry.requestedById)}</td>
                        <td>
                          <span className={`qc-badge qc-badge-${entry.status === 'sent' ? 'success' : entry.status === 'failed' ? 'danger' : 'neutral'}`}>
                            {entry.status === 'sent' ? 'Đã gửi' : entry.status === 'failed' ? 'Thất bại' : entry.status === 'sending' ? 'Đang gửi' : 'Đang chờ'}
                          </span>
                          {entry.status === 'failed' && entry.errorMessage ? <div className="qc-row-sub">{entry.errorMessage}</div> : null}
                        </td>
                        <td>{entry.attemptCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setDeliveryLogModal(m => ({ ...m, open: false }))}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {quote && requestChangesModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setRequestChangesModalOpen(false); }}>
          <div className="qc-deal-picker">
            <h3>Yêu cầu chỉnh sửa</h3>
            <label className="qc-workspace-info-label">Chọn phần cần sửa</label>
            <select className="crm-input" value={requestChangesSection} onChange={event => setRequestChangesSection(event.target.value as 'technical' | 'pricing')}>
              <option value="technical">Thông tin kỹ thuật</option>
              <option value="pricing">Giá bán</option>
            </select>
            <label className="qc-workspace-info-label">Lý do (bắt buộc)</label>
            <textarea
              className="qc-workspace-handoff-note"
              rows={3}
              value={requestChangesReason}
              onChange={event => setRequestChangesReason(event.target.value)}
              placeholder="Vì sao cần chỉnh sửa lại..."
            />
            <div className="qc-workspace-note-box">
              Báo giá sẽ chuyển lùi về đúng bước đã chọn để chỉnh sửa lại — chỉ áp dụng khi đang ở "Chờ duyệt", chưa duyệt.
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setRequestChangesModalOpen(false)}>Huỷ</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !requestChangesReason.trim()}
                aria-busy={busy && activeAction === 'requestChanges'}
                onClick={() => void requestChangesNow()}
              >
                {actionButtonContent('requestChanges', 'Gửi yêu cầu chỉnh sửa')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CatalogPickerModal
        open={catalogModalOpen}
        onClose={() => { setCatalogModalOpen(false); setAutoSelectCatalogItemId(null); }}
        showZoneTab
        activeSource={catalogSource}
        onSourceChange={source => {
          setCatalogSource(source);
          if (source === 'zone') void loadPriceBookItems();
        }}
        loading={catalogSource === 'zone' ? priceBookLoading : catalogLoading}
        items={catalogSource === 'zone' ? zonePickerItems : internalPickerItems}
        onAddSelected={ids => (catalogSource === 'zone' ? handleAddSelectedZoneItems(ids) : handleAddSelectedCatalogItems(ids))}
        autoSelectId={catalogSource === 'internal' ? autoSelectCatalogItemId : undefined}
        groupFilterValue={catalogSource === 'internal' ? pickerGroupFilter : undefined}
        onGroupFilterChange={catalogSource === 'internal' ? setPickerGroupFilter : undefined}
        extraToolbar={
          catalogSource === 'internal' ? (
            <div className="cp-filter-chips" style={{ paddingTop: 0 }}>
              {catalogSectionOptions.length > 0 ? (
                <select className="crm-input" value={catalogTargetSectionId} onChange={e => setCatalogTargetSectionId(e.target.value)}>
                  <option value="">Thêm vào: Cuối bảng</option>
                  {catalogSectionOptions.map(s => <option key={s.id} value={s.id}>Thêm vào mục: {s.label}</option>)}
                </select>
              ) : null}
              {/* "Tạo nhanh sản phẩm và nhóm sản phẩm ngay trong popup chọn từ
               * danh mục" - dung DUNG serviceCatalogRepository (xem
               * QuickAddProductModal/QuickAddGroupModal), khong tao nguon du
               * lieu rieng. */}
              <button type="button" className="qc-btn" onClick={() => setQuickAddProductTarget('newRow')}>
                + Sản phẩm mới
              </button>
              <button type="button" className="qc-btn" onClick={() => setQuickAddGroupOpen(true)}>
                + Nhóm sản phẩm
              </button>
            </div>
          ) : undefined
        }
      />

      <QuickAddGroupModal
        open={quickAddGroupOpen}
        onClose={() => setQuickAddGroupOpen(false)}
        onCreated={group => void handleGroupCreated(group)}
      />

      <QuickAddProductModal
        open={quickAddProductTarget != null}
        onClose={() => setQuickAddProductTarget(null)}
        groups={(catalogTree || []).filter(g => g.itemType === 'group')}
        existingItems={catalogFlatItems}
        defaultGroupId={
          // "Khi đang chọn nhóm VPS Hosting, bấm + Sản phẩm mới: Tự chọn sẵn
          // nhóm VPS Hosting" - suy tu pickerGroupFilter (ten nhom dang loc
          // trong Picker) sang id THAT tuong ung trong catalogTree.
          pickerGroupFilter ? (catalogTree || []).find(g => g.itemType === 'group' && g.name === pickerGroupFilter)?.id : undefined
        }
        initialValues={
          typeof quickAddProductTarget === 'object' && quickAddProductTarget
            ? (() => {
                const source = itemsDraft[quickAddProductTarget.linkIndex];
                return source
                  ? {
                      name: source.serviceDescription || source.description,
                      unit: source.unit,
                      vatRate: source.vatRate,
                      unitPriceVnd: source.unitPrice,
                      costPriceVnd: source.costPrice,
                    }
                  : undefined;
              })()
            : undefined
        }
        onCreated={item => void handleQuickAddProductCreated(item)}
      />

      <ConfirmModal
        open={fillDownConfirm != null}
        title="Ghi đè dòng đã có giá trị"
        message={
          fillDownConfirm
            ? `${fillDownConfirm.targetIndices.filter(i => {
                const row = itemsDraft[i];
                return fillDownConfirm.field === 'costPrice' ? row.costPrice != null : row.markupPercent != null;
              }).length} trong số ${fillDownConfirm.targetIndices.length} dòng đã có ${fillDownConfirm.field === 'costPrice' ? 'giá vốn' : 'markup'} — Điền xuống sẽ ghi đè các dòng này. Tiếp tục?`
            : ''
        }
        onClose={() => setFillDownConfirm(null)}
        actions={[
          {
            label: 'Điền xuống, ghi đè',
            variant: 'primary',
            onClick: () => fillDownConfirm && applyFillDown(fillDownConfirm.index, fillDownConfirm.field, fillDownConfirm.targetIndices, fillDownConfirm.mode),
          },
        ]}
      />

      <ConfirmModal
        open={markupApplyConfirm != null}
        title="Ghi đè Markup đã có"
        message={
          markupApplyConfirm
            ? `${itemsDraft.filter(row => row.costPrice != null && row.markupPercent != null).length} hạng mục đã có Markup — áp Markup +${markupApplyConfirm.percent}% sẽ ghi đè giá bán các dòng này. Tiếp tục?`
            : ''
        }
        onClose={() => setMarkupApplyConfirm(null)}
        actions={[
          {
            label: 'Áp dụng, ghi đè',
            variant: 'primary',
            onClick: () => {
              if (markupApplyConfirm) doApplyQuickMarkup(markupApplyConfirm.percent);
              setMarkupApplyConfirm(null);
            },
          },
        ]}
      />

      <ConfirmModal
        open={marginApplyConfirm != null}
        title="Ghi đè Margin đã có"
        message={
          marginApplyConfirm
            ? `${itemsDraft.filter(row => row.costPrice != null && row.markupPercent != null).length} hạng mục đã có Markup/Giá khách — áp Margin mục tiêu ${marginApplyConfirm.percent}% sẽ ghi đè giá bán các dòng này. Tiếp tục?`
            : ''
        }
        onClose={() => setMarginApplyConfirm(null)}
        actions={[
          {
            label: 'Áp dụng, ghi đè',
            variant: 'primary',
            onClick: () => {
              if (marginApplyConfirm) doApplyTargetMargin(marginApplyConfirm.percent);
              setMarginApplyConfirm(null);
            },
          },
        ]}
      />

      <ConfirmModal
        open={catalogAdd.dedupQueue.length > 0}
        title="Sản phẩm đã có trong bảng"
        message={
          catalogAdd.dedupQueue[0]
            ? `"${catalogAdd.dedupQueue[0].label}" đã có sẵn 1 dòng trong bảng hạng mục. Bạn muốn tăng số lượng dòng có sẵn hay vẫn thêm thành dòng mới?`
            : ''
        }
        onClose={() => catalogAdd.cancelDedup()}
        actions={[
          {
            label: 'Tăng số lượng dòng có sẵn',
            variant: 'primary',
            onClick: () => {
              const entry = catalogAdd.dedupQueue[0];
              catalogAdd.resolveDedup('increase', existingIndex => increaseExistingRowQty(existingIndex, entry?.candidate.item.quantity ?? 1));
            },
          },
          { label: 'Vẫn thêm dòng mới', onClick: () => catalogAdd.resolveDedup('addNew', () => {}) },
        ]}
      />

      <ConfirmModal
        open={zoneAdd.dedupQueue.length > 0}
        title="Sản phẩm đã có trong bảng"
        message={
          zoneAdd.dedupQueue[0]
            ? `"${zoneAdd.dedupQueue[0].label}" đã có sẵn 1 dòng trong bảng hạng mục. Bạn muốn tăng số lượng dòng có sẵn hay vẫn thêm thành dòng mới?`
            : ''
        }
        onClose={() => zoneAdd.cancelDedup()}
        actions={[
          {
            label: 'Tăng số lượng dòng có sẵn',
            variant: 'primary',
            onClick: () => {
              const entry = zoneAdd.dedupQueue[0];
              zoneAdd.resolveDedup('increase', existingIndex => increaseExistingRowQty(existingIndex, entry?.candidate.item.quantity ?? 1));
            },
          },
          { label: 'Vẫn thêm dòng mới', onClick: () => zoneAdd.resolveDedup('addNew', () => {}) },
        ]}
      />

      {priceBookDrawerIndex != null && itemsDraft[priceBookDrawerIndex] ? (() => {
        const drawerItem = itemsDraft[priceBookDrawerIndex];
        const snap = (drawerItem.priceBookSnapshot || {}) as Record<string, any>;
        const hasOverride = drawerItem.costPriceOriginal != null;
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPriceBookDrawerIndex(null); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 480 }}>
              <div className="qc-workspace-modal-head">
                <h3>Chi tiết giá — Bảng giá VPS Zone</h3>
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setPriceBookDrawerIndex(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <p><strong>{drawerItem.serviceDescription || drawerItem.description}</strong></p>
                {costViewAllowed ? (
                  <>
                    <p>Chế độ giá vốn: {snap.costMode === 'usd' ? 'USD × Tỷ giá' : 'VND trực tiếp'}</p>
                    {snap.costMode === 'usd' ? (
                      <>
                        <p>Đơn giá USD: {snap.unitPriceUsd ?? '—'}</p>
                        <p>Tỷ giá: {snap.exchangeRate ?? '—'}</p>
                        <p>Thuế nhập khẩu: {snap.importDutyPercent ?? 0}%</p>
                      </>
                    ) : null}
                    <p>VAT đầu vào: {snap.vatInPercent ?? 0}%</p>
                    <p>Nhà cung cấp: {snap.vendorName || '—'}</p>
                    <p>VAT đầu ra: {snap.vatEuPercent ?? 0}%</p>
                    <p>Giá tham chiếu: {snap.referencePrice != null ? formatMoney(snap.referencePrice) : '—'}</p>
                    {snap.referenceLink ? <p>Link tham chiếu: <a href={snap.referenceLink} target="_blank" rel="noreferrer">{snap.referenceLink}</a></p> : null}
                    {snap.quoteLink ? <p>Link/chứng từ giá: <a href={snap.quoteLink} target="_blank" rel="noreferrer">{snap.quoteLink}</a></p> : null}

                    <hr />
                    <p>
                      Giá vốn hiện tại: <strong>{drawerItem.costPrice != null ? formatMoney(drawerItem.costPrice) : '—'}</strong>
                      {hasOverride ? <span className="qc-row-sub"> · Đã điều chỉnh (gốc: {formatMoney(drawerItem.costPriceOriginal || 0)})</span> : null}
                    </p>
                    {drawerItem.costOverrideReason ? (
                      <p className="qc-row-sub">
                        Lý do: {drawerItem.costOverrideReason} — {drawerItem.costOverrideAt ? new Date(drawerItem.costOverrideAt).toLocaleString('vi-VN') : ''}
                      </p>
                    ) : null}

                    {canEditCostCells ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" className="qc-btn" onClick={() => setCostOverrideModal({ index: priceBookDrawerIndex, reason: '' })}>
                          Ghi đè giá vốn (có lý do)
                        </button>
                        {hasOverride ? (
                          <button type="button" className="qc-btn" onClick={() => restoreCostFormula(priceBookDrawerIndex)}>
                            Khôi phục theo công thức
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="qc-row-sub">Không có quyền xem giá vốn.</p>
                )}
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setPriceBookDrawerIndex(null)}>Đóng</button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {itemDetailDrawerIndex != null && itemsDraft[itemDetailDrawerIndex] ? (() => {
        const drawerIndex = itemDetailDrawerIndex;
        const drawerItem = itemsDraft[drawerIndex];
        const drawerEditableTechnical = canEditCostCells;
        const drawerEditablePricing = canEditPricingCells;
        const sourceLabel = drawerItem.priceBookItemId
          ? 'Bảng giá VPS Zone'
          : drawerItem.catalogItemId
            ? 'Danh mục dịch vụ'
            : 'Nhập tay';
        // Dong drawer: 'save' = ghi that (persistQuote), 'discard' = phuc
        // hoi lai DUNG snapshot luc mo (huy moi sua doi con dang o local
        // state, KHONG bao gio goi persistQuote) - khong con onBlur nao tu
        // luu am tham trong drawer nay nua.
        function closeItemDetailDrawer(action: 'save' | 'discard') {
          if (action === 'save') {
            void persistQuote({}, { silent: true });
          } else if (itemDetailDrawerSnapshot) {
            setItemsDraft(prev => prev.map((row, i) => (i === drawerIndex ? itemDetailDrawerSnapshot : row)));
          }
          setItemDetailDrawerIndex(null);
          setItemDetailDrawerSnapshot(null);
        }
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) closeItemDetailDrawer('discard'); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 480 }}>
              <div className="qc-workspace-modal-head">
                <h3>Chi tiết hạng mục</h3>
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => closeItemDetailDrawer('discard')}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <label className="qc-workspace-drawer-field">
                  Tên hạng mục
                  {drawerEditableTechnical ? (
                    <input
                      className="qc-cell-input"
                      value={drawerItem.serviceDescription || ''}
                      onChange={e => updateRow(drawerIndex, { serviceDescription: e.target.value })}
                    />
                  ) : (
                    <p>{drawerItem.serviceDescription || '—'}</p>
                  )}
                </label>
                <label className="qc-workspace-drawer-field">
                  Đơn vị tính (ĐVT)
                  {drawerEditableTechnical ? (
                    <input
                      className="qc-cell-input"
                      value={drawerItem.unit || ''}
                      onChange={e => updateRow(drawerIndex, { unit: e.target.value })}
                      placeholder="Gói, Tháng..."
                    />
                  ) : (
                    <p>{drawerItem.unit || '—'}</p>
                  )}
                </label>
                <label className="qc-workspace-drawer-field">
                  Số lượng
                  {drawerEditableTechnical ? (
                    <input
                      type="number"
                      className="qc-cell-input"
                      value={drawerItem.quantity}
                      onChange={e => updateRow(drawerIndex, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  ) : (
                    <p>{drawerItem.quantity}</p>
                  )}
                </label>
                <p>Nguồn gốc: <strong>{sourceLabel}</strong></p>
                {costViewAllowed ? (
                  <>
                    <label className="qc-workspace-drawer-field">
                      Giá vốn/ĐV
                      {drawerEditableTechnical ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          className="qc-cell-input"
                          value={drawerItem.costPrice != null ? formatMoneyInput(String(drawerItem.costPrice)) : ''}
                          disabled={drawerItem.costNotApplicable}
                          onChange={e => handleCostPriceChange(drawerIndex, e.target.value)}
                        />
                      ) : (
                        <p>{drawerItem.costNotApplicable ? 'Không áp dụng' : drawerItem.costPrice != null ? formatMoney(drawerItem.costPrice) : 'Còn thiếu'}</p>
                      )}
                    </label>
                  </>
                ) : (
                  <p className="qc-row-sub">Không có quyền xem giá vốn.</p>
                )}
                {pricingViewAllowed ? (
                  <label className="qc-workspace-drawer-field">
                    Markup %
                    {drawerEditablePricing ? (
                      <input
                        type="number"
                        className="qc-cell-input"
                        value={drawerItem.markupPercent ?? ''}
                        disabled={drawerItem.costPrice == null}
                        onChange={e => handleMarkupChange(drawerIndex, e.target.value)}
                      />
                    ) : (
                      <p>{formatPercentTrim(drawerItem.markupPercent)}</p>
                    )}
                  </label>
                ) : (
                  <p className="qc-row-sub">Không có quyền xem markup.</p>
                )}
                {drawerEditableTechnical || drawerEditablePricing ? (
                  <p className="qc-row-sub">Sửa xong bấm &quot;Lưu&quot; — đóng bằng X/&quot;Huỷ&quot; sẽ KHÔNG lưu các thay đổi ở trên.</p>
                ) : null}
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => closeItemDetailDrawer('discard')}>Huỷ</button>
                {drawerEditableTechnical || drawerEditablePricing ? (
                  <button type="button" className="qc-btn qc-btn-primary" onClick={() => closeItemDetailDrawer('save')}>Lưu</button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })() : null}

      {costOverrideModal ? (() => {
        const targetItem = itemsDraft[costOverrideModal.index];
        return (
          <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setCostOverrideModal(null); }}>
            <div className="qc-workspace-preview-modal" style={{ maxWidth: 420 }}>
              <div className="qc-workspace-modal-head">
                <h3>Ghi đè giá vốn</h3>
                <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setCostOverrideModal(null)}>
                  <X className="qc-inline-icon" />
                </button>
              </div>
              <div className="qc-workspace-preview-modal-body">
                <label className="qc-field">
                  <span>Giá vốn mới (VND)</span>
                  <input
                    type="number"
                    className="qc-cell-input qc-cell-input-money"
                    defaultValue={targetItem?.costPrice ?? undefined}
                    id="qc-cost-override-value"
                  />
                </label>
                <label className="qc-field">
                  <span>Lý do điều chỉnh *</span>
                  <textarea
                    rows={2}
                    value={costOverrideModal.reason}
                    onChange={e => setCostOverrideModal({ ...costOverrideModal, reason: e.target.value })}
                  />
                </label>
              </div>
              <div className="qc-workspace-modal-actions">
                <button type="button" className="qc-btn" onClick={() => setCostOverrideModal(null)}>Huỷ</button>
                <button
                  type="button"
                  className="qc-btn qc-btn-primary"
                  disabled={!costOverrideModal.reason.trim()}
                  onClick={() => {
                    const input = document.getElementById('qc-cost-override-value') as HTMLInputElement | null;
                    const value = input ? Number(input.value) : NaN;
                    if (!Number.isFinite(value) || value < 0) return;
                    applyCostOverride(costOverrideModal.index, value, costOverrideModal.reason.trim());
                  }}
                >
                  Lưu
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
