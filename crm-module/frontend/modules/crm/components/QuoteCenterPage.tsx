'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { teamsService, type TeamRow, projectsService, type Project, usersService, type QuoteBusinessRoleUser } from '@/services/all-platform.service';
import { computeQuoteSla } from '../utils/quoteSla';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { IssuerCompany, Quote, QuoteForm, QuotePhase, QuotesByPhaseResult } from '@/modules/quotes';
import { seedingContractRepository } from '@/modules/contracts';
import type { Contract } from '@/modules/contracts';
import { useCrm } from '../hooks/useCrm';
import { canApproveQuote, canWriteDeal, getPackageText, getServicePackageText } from '../constants/crmConfig';
import type { Deal } from '../types';
import { CreateQuoteModal } from '../integrations/quotes';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import {
  CheckCircle2,
  Eye,
  ExternalLink,
  FileText,
  GitBranchPlus,
  History,
  Link2,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  XCircle,
} from './icons';
import { SearchableSelect } from './SearchableSelect';
import { QuoteWorkspaceModal } from './QuoteWorkspaceModal';
import {
  dealBusinessCode,
  formatDate,
  formatMoney,
  initialsOf,
  isApprovedQuote,
  isLostDeal,
  isWonDeal,
  quoteDisplayStatus,
  relativeTime,
} from '../utils/quoteDisplay';
import '../styles/quote-center.css';

/** Khong co role CEO/Lead Sale rieng trong he thong that (chi co admin/leader/
 * member) - scope chi con 2 lua chon that su phan biet duoc: xem HET pham vi
 * dang loc, hay chi xem CUA TOI (deal minh phu trach/tao, hoac bao gia minh
 * tao neu chua gan deal). */
type RoleScope = 'all' | 'mine';
type Period = 'all' | 'month' | 'quarter' | 'year';

const TEMPLATE_ICON_CLASSES = ['qc-icon-blue', 'qc-icon-rose', 'qc-icon-green'];

function matchesPeriod(dateStr: string | undefined, period: Period): boolean {
  if (period === 'all') return true;
  const date = new Date(dateStr || '');
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (period === 'quarter') {
    return date.getFullYear() === now.getFullYear() && Math.floor(date.getMonth() / 3) === Math.floor(now.getMonth() / 3);
  }
  return date.getFullYear() === now.getFullYear();
}

interface SaleRow {
  key: string;
  name: string;
  dealIds: Set<string>;
  quotes: number;
  sent: number;
  won: number;
  value: number;
  wonValue: number;
}

/** 1 CHUOI version (versionChainId) = 1 "bao gia nghiep vu" duy nhat - moi noi
 * dem so luong (KPI/tab/bang) deu dem so CHUOI, khong dem so dong quote tho
 * (V1/V2/V3 cua cung 1 chuoi CHI tinh la 1). Gia tri/trang thai hien thi luon
 * lay tu `current` (ban co versionNumber lon nhat). Bao gia cu chua co
 * versionChainId (truoc migration 082) tu nhien la 1 chuoi 1 phan tu. */
interface QuoteChainRow {
  current: Quote;
  versionCount: number;
  deal?: Deal;
  status: ReturnType<typeof quoteDisplayStatus>;
}

const QUOTE_ROW_LIMIT = 10;
const TEMPLATE_ROW_LIMIT = 3;
const NO_PROJECT_GROUP_KEY = '__no_project__';
/** 6 tab THAT cua bang "Danh sach bao gia" (Checkpoint C) - suy tu
 * processing_stage/status/sent_at THAT o backend (_derive_quote_phase,
 * migration 085/087/097), KHONG phai enum tu bia. 'admin_review' = "Admin
 * review" (he thong khong co role CEO rieng - xem plan da xac nhan). */
const PHASE_TABS: Array<QuotePhase | 'all'> = ['all', 'presale', 'sale_markup', 'admin_review', 'ready_to_send', 'sent'];
const PHASE_TAB_LABELS: Record<QuotePhase | 'all', string> = {
  all: 'Tất cả',
  presale: 'Presale',
  sale_markup: 'Sale markup',
  admin_review: 'Admin review',
  ready_to_send: 'Sẵn sàng gửi',
  sent: 'Đã gửi',
};
const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: 'Lên kế hoạch',
  active: 'Đang chạy',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

/** Cot "PHASE HIỆN TẠI" trong bang - man hinh nghiep vu CHI TIET hon 5 tab
 * phase o backend (vd tach ready_to_publish/published), uu tien Da chot/Da
 * huy (deal won/lost hoac quote cancelled) truoc khi xet processingStage -
 * dung thu tu uu tien da co san o quoteDisplayStatus(). */
/** THU TU UU TIEN CHINH XAC nhu backend _derive_quote_phase() (da chot,
 * KHONG duoc doi thu tu tuy tien): Deal won/lost (business outcome, ngoai
 * pham vi quote) > cancelled > sent_at > published_at/processing_stage=
 * published > status='approved'/approved_at (nhanh du lieu cu, xem bug that
 * da fix) > processing_stage that (review/pricing/request/technical).
 * status='approved' KHONG BAO GIO duoc ghi de sent/published - test rieng
 * o test_quote_phase_mapping.py (backend) cho tinh huong nay. */
/** 5 mau RIENG cho DUNG 5 phase tab that (Presale=blue/Sale markup=amber/
 * Admin review=purple/Sẵn sàng gửi=teal/Đã gửi=success) - bug thuc te da
 * bao "trùng màu nhãn, 5 mục 5 màu" (truoc day 'neutral' dung chung cho ca
 * Presale lan Sale markup, 'warning' dung chung HEX voi 'Sẵn sàng gửi' cu).
 * 'Đã chốt'/'Đã huỷ'/'Đã duyệt · Chờ phát hành' la override theo KET QUA
 * DEAL (won/lost) hoac trang thai du lieu cu, KHONG phai 1 trong 5 tab -
 * giu rieng success/danger, khong can phan biet voi 5 mau tab o tren. */
function phaseCellLabel(quote: Quote, deal?: Deal): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'blue' | 'amber' | 'purple' | 'teal' } {
  if (isWonDeal(deal)) return { label: 'Đã chốt', tone: 'success' };
  if (isLostDeal(deal) || quote.status === 'cancelled') return { label: 'Đã huỷ', tone: 'danger' };
  if (quote.sentAt) return { label: 'Đã gửi khách', tone: 'success' };
  if (quote.publishedAt || quote.processingStage === 'published') return { label: 'Sẵn sàng gửi', tone: 'teal' };
  if (quote.status === 'approved' || quote.approvedAt) return { label: 'Đã duyệt · Chờ phát hành', tone: 'success' };
  const stage = quote.processingStage || 'request';
  if (stage === 'review') return { label: 'Chờ Admin duyệt', tone: 'purple' };
  if (stage === 'pricing') return { label: 'Chờ Sale markup', tone: 'amber' };
  if (stage === 'ready_to_publish') return { label: 'Đã duyệt · Chờ phát hành', tone: 'success' };
  return { label: 'Chờ Presale input', tone: 'blue' };
}

/** Mau badge Margin - CHI phan biet lo/lai (that su co y nghia nghiep vu
 * pho quat), KHONG bia nguong % cu the (vd "<10% do") vi he thong CHUA co
 * quy tac nguong margin toan cuc thong nhat (chi co nguong theo TUNG bo quy
 * tac duyet cau hinh rieng, khong phai 1 hang so) - tranh doan nghiep vu
 * chua ro. */
function marginTone(percent: number | null | undefined): 'neutral' | 'success' | 'danger' {
  if (percent === null || percent === undefined) return 'neutral';
  return percent < 0 ? 'danger' : 'success';
}

export function QuoteCenterPage() {
  const router = useRouter();
  const { user } = useAppAuth();
  const { deals, agents, loading: dealsLoading } = useCrm();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [forms, setForms] = useState<QuoteForm[]>([]);
  const [issuerCompanies, setIssuerCompanies] = useState<IssuerCompany[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);

  const [roleScope, setRoleScope] = useState<RoleScope>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [teamFilter, setTeamFilter] = useState('');

  const [quoteModal, setQuoteModal] = useState<{ open: boolean; deal: Deal | null; quoteFormId?: string; editQuote?: Quote | null }>({
    open: false,
    deal: null,
  });
  const [dealPickerOpen, setDealPickerOpen] = useState(false);
  const [dealSearch, setDealSearch] = useState('');

  const [listSearch, setListSearch] = useState('');
  const [phaseTab, setPhaseTab] = useState<QuotePhase | 'all'>('all');
  const [customerFilter, setCustomerFilter] = useState('');
  // Section 7 - KPI SLA: bam vao "Quá hạn"/"Sắp đến hạn" loc danh sach TUONG
  // UNG (backend-driven, xem buildByPhaseParams). null = khong loc theo SLA.
  const [slaFilter, setSlaFilter] = useState<'overdue' | 'due_soon' | null>(null);
  const [groupByProject, setGroupByProject] = useState(false);
  const [page, setPage] = useState(1);
  // Bang "Danh sach bao gia" (Checkpoint C) - du lieu THAT tu backend
  // (/quotes/by-phase, gom theo version_chain_id + dem/phan trang/tim kiem o
  // server), KHONG con load-all-roi-loc-client-side nhu truoc. Cac bo loc
  // Khach hang/Nguoi phu trach/Team/Thoi gian/Cua toi VAN ap dung o CLIENT
  // nhung chi tren trang du lieu da tai (backend chua co tham so cho 4 bo loc
  // nay) - da bao ro trong bao cao Checkpoint C, KHONG am tham gia vo "da
  // backend-driven hoan toan".
  const [byPhase, setByPhase] = useState<QuotesByPhaseResult | null>(null);
  const [byPhaseLoading, setByPhaseLoading] = useState(true);
  const [byPhaseError, setByPhaseError] = useState<string | null>(null);
  const byPhaseSeqRef = useRef(0);
  const linkedQuotesSectionRef = useRef<HTMLElement | null>(null);
  /** "Mở báo giá" (bảng) mở workspace ở CHẾ ĐỘ SỬA (quoteId thật). "+ Yêu cầu
   * hỗ trợ báo giá" mở CÙNG component nhưng CHẾ ĐỘ TẠO MỚI (quoteId=null) -
   * KHÔNG dùng chung handler với wizard "Tạo báo giá" (CreateQuoteModal). */
  const [workspaceQuoteId, setWorkspaceQuoteId] = useState<string | null>(null);
  const [workspaceCreateMode, setWorkspaceCreateMode] = useState(false);
  // Block 1: "?openQuote=new&customerId=...&projectId=..." - toi tu nut
  // "Tạo báo giá" o Ho so khach hang/Project card. PHAI THAT SU doc + ap
  // dung (khong chi mang query param roi bo qua) - workspace mo o CHE DO TAO
  // MOI, Khach hang tu dien + khoa; Project (neu co, nghia la toi tu 1
  // Project card cu the) cung tu dien + khoa VA Co hoi chi hien cua DUNG
  // Project do (xem prop lockProject/initialProjectId cua QuoteWorkspaceModal).
  const [workspacePrefill, setWorkspacePrefill] = useState<{ customerId?: string; projectId?: string; lockProject: boolean } | null>(null);
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get('openQuote') !== 'new') return;
    const customerId = searchParams.get('customerId') || undefined;
    const projectId = searchParams.get('projectId') || undefined;
    setWorkspacePrefill({ customerId, projectId, lockProject: Boolean(projectId) });
    setWorkspaceCreateMode(true);
    router.replace('/all-platform/quote-center', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    void seedingQuoteRepository.getQuotes().then(rows => {
      if (alive) setQuotes(rows);
    }).finally(() => alive && setQuotesLoading(false));
    void seedingQuoteRepository.getForms().then(rows => {
      if (alive) setForms(rows);
    });
    void seedingQuoteRepository.getIssuerCompanies().then(rows => {
      if (alive) setIssuerCompanies(rows);
    });
    void teamsService.getAll().then(res => {
      if (alive && res.success && res.data) setTeams(res.data);
    });
    // Dung de tim hop dong THAT gan voi 1 quote da chot ("Xem hop dong" o
    // action menu Won) - khong fabricate, chi hien khi that su co hop dong
    // tra ve tu API.
    void seedingContractRepository.getContracts().then(rows => {
      if (alive) setContracts(rows);
    }).catch(() => {
      if (alive) setContracts([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const dealsById = useMemo(() => new Map(deals.map(deal => [deal.id, deal])), [deals]);
  // Mau bao gia mac dinh cho "Yeu cau ho tro bao gia" (khong co buoc chon mau
  // rieng nhu wizard CreateQuoteModal) - BUG that da fix: truoc day dung dai
  // forms[0] (mau DAU TIEN trong danh sach, khong lien quan gi den dung vi
  // phat hanh) - da tung lam quote moi tao nham dinh dang "villa_solution_
  // package" thay vi mau chuan. Gio uu tien dung defaultQuoteFormId cua don
  // vi phat hanh dau tien (giong quy uoc CreateQuoteModal dang dung), fallback
  // mau co isDefaultTemplate=true (dung DUNG field DB da thiet ke rieng cho
  // truong hop nay - "1 mau active duoc set true lam fallback khi cong ty
  // phat hanh chua gan defaultQuoteFormId rieng"), cuoi cung moi fallback
  // forms[0].
  const defaultFormId = useMemo(() => {
    // Luong "Yeu cau ho tro bao gia" (QuoteWorkspaceModal che do tao moi) chi
    // dung bang hang muc chuan (quote_items) - mau layout_type=
    // 'villa_solution_package' dung cau truc rieng (data.solutionItems),
    // KHONG dung quote_items, nen neu lo mac dinh chon mau nay, moi hang muc
    // nguoi dung go se bi am tham MAT HET luc tao (create_quote() luon
    // insert items=[] cho villa, khong bao loi). BUG THAT DA GAP: 3 issuer
    // company (CG/MK/SZ) deu co sort_order=0 trung nhau nen issuerCompanies[0]
    // (order theo sort_order) KHONG on dinh giua cac lan fetch - co luc roi
    // dung vao issuer ma defaultQuoteFormId lai tro toi 1 mau villa. Loai
    // HOAN TOAN mau villa khoi danh sach ung vien TU DONG chon o day - nguoi
    // dung van chon THU CONG duoc mau villa qua dropdown "Mẫu báo giá" neu
    // that su can, chi khong de no am tham thanh mac dinh.
    const nonVillaForms = forms.filter(f => f.schemaJson?.layoutType !== 'villa_solution_package');
    const primaryIssuer = issuerCompanies[0];
    const issuerDefault = primaryIssuer?.defaultQuoteFormId
      ? nonVillaForms.find(f => f.id === primaryIssuer.defaultQuoteFormId)?.id
      : undefined;
    if (issuerDefault) return issuerDefault;
    const globalDefault = nonVillaForms.find(f => f.isDefaultTemplate)?.id;
    return globalDefault || nonVillaForms[0]?.id;
  }, [forms, issuerCompanies]);
  const contractByQuoteId = useMemo(() => new Map(contracts.filter(c => c.quoteId).map(c => [c.quoteId as string, c])), [contracts]);

  function dealInRoleScope(deal: Deal | undefined, quote?: Quote): boolean {
    if (roleScope === 'all') return true;
    if (deal) return deal.assignment.sdrId === user?.id || deal.assignment.leadedById === user?.id;
    return quote?.createdById === user?.id;
  }
  function dealInTeamScope(deal?: Deal): boolean {
    if (!teamFilter) return true;
    return deal?.teamId === teamFilter;
  }

  const scopedDeals = useMemo(
    () => deals.filter(deal => dealInRoleScope(deal) && dealInTeamScope(deal) && matchesPeriod(deal.createdAt, period)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, roleScope, teamFilter, period, user?.id]
  );

  // Gom TAT CA quote (moi version) thanh chuoi (versionChainId) TRUOC khi loc
  // pham vi - "current" (versionNumber lon nhat) la dai dien duy nhat cho ca
  // chuoi, moi thu con lai (KPI/tab/loc pham vi) deu tinh tren no, khong tinh
  // rieng tung version cu (da "gop" vao chuoi cua no).
  const allChains = useMemo(() => {
    const map = new Map<string, Quote[]>();
    for (const quote of quotes) {
      const key = quote.versionChainId || quote.id;
      const arr = map.get(key);
      if (arr) arr.push(quote);
      else map.set(key, [quote]);
    }
    return Array.from(map.values()).map(versions => {
      const sorted = [...versions].sort((a, b) => (b.versionNumber || 1) - (a.versionNumber || 1));
      return { current: sorted[0], versionCount: versions.length };
    });
  }, [quotes]);

  const scopedChains = useMemo<QuoteChainRow[]>(() => {
    return allChains
      .filter(({ current }) => {
        const deal = current.dealId ? dealsById.get(current.dealId) : undefined;
        if (!dealInRoleScope(deal, current)) return false;
        if (deal ? !dealInTeamScope(deal) : Boolean(teamFilter)) return false;
        if (!matchesPeriod(current.issuedAt || current.createdAt, period)) return false;
        return true;
      })
      .map(({ current, versionCount }) => {
        const deal = current.dealId ? dealsById.get(current.dealId) : undefined;
        return { current, versionCount, deal, status: quoteDisplayStatus(current, deal) };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChains, dealsById, roleScope, teamFilter, period, user?.id]);

  const kpis = useMemo(() => {
    const quotedDealIds = new Set(scopedChains.filter(row => row.current.dealId).map(row => row.current.dealId as string));
    const sent = scopedChains.filter(row => isApprovedQuote(row.current)).length;
    const won = scopedChains.filter(row => isWonDeal(row.deal)).length;
    const totalValue = scopedChains.reduce((sum, row) => sum + (row.current.totalAmount || 0), 0);
    const wonValue = scopedChains.filter(row => isWonDeal(row.deal)).reduce((sum, row) => sum + (row.current.totalAmount || 0), 0);
    return {
      totalDeals: scopedDeals.length,
      quotedCustomers: quotedDealIds.size,
      totalQuotes: scopedChains.length,
      sent,
      won,
      conversionRate: scopedChains.length ? Math.round((won / scopedChains.length) * 1000) / 10 : 0,
      totalValue,
      wonValue,
    };
  }, [scopedChains, scopedDeals]);

  const funnel = useMemo(() => {
    const base = kpis.totalQuotes || 1;
    return [
      { label: 'Tạo báo giá', count: kpis.totalQuotes },
      { label: 'Đã duyệt', count: kpis.sent },
      { label: 'Đã chốt', count: kpis.won },
    ].map(step => ({ ...step, percent: Math.round((step.count / base) * 100) }));
  }, [kpis]);

  const saleRows = useMemo(() => {
    const map = new Map<string, SaleRow>();
    for (const row of scopedChains) {
      const { deal } = row;
      const key = deal?.assignment.sdrId || deal?.assignment.leadedById || 'unassigned';
      const name = deal?.assignment.sdrName || deal?.assignment.leadName || 'Chưa gán';
      let saleRow = map.get(key);
      if (!saleRow) {
        saleRow = { key, name, dealIds: new Set(), quotes: 0, sent: 0, won: 0, value: 0, wonValue: 0 };
        map.set(key, saleRow);
      }
      if (deal) saleRow.dealIds.add(deal.id);
      saleRow.quotes += 1;
      if (isApprovedQuote(row.current)) saleRow.sent += 1;
      saleRow.value += row.current.totalAmount || 0;
      if (isWonDeal(deal)) {
        saleRow.won += 1;
        saleRow.wonValue += row.current.totalAmount || 0;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [scopedChains]);

  // "Hieu suat theo team" - gom theo deal.teamId (chi Deal moi co team that,
  // bao gia khong gan Deal roi vao nhom "Chua gan team").
  const teamRows = useMemo(() => {
    const map = new Map<string, SaleRow>();
    for (const row of scopedChains) {
      const { deal } = row;
      const key = deal?.teamId || 'unassigned';
      const name = deal?.teamName || 'Chưa gán team';
      let teamRow = map.get(key);
      if (!teamRow) {
        teamRow = { key, name, dealIds: new Set(), quotes: 0, sent: 0, won: 0, value: 0, wonValue: 0 };
        map.set(key, teamRow);
      }
      if (deal) teamRow.dealIds.add(deal.id);
      teamRow.quotes += 1;
      if (isApprovedQuote(row.current)) teamRow.sent += 1;
      teamRow.value += row.current.totalAmount || 0;
      if (isWonDeal(deal)) {
        teamRow.won += 1;
        teamRow.wonValue += row.current.totalAmount || 0;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [scopedChains]);

  // Danh sach khach hang de loc - CHI cac Deal co lien ket ho so Khach hang
  // that (crm_customers.id qua deal.customerId) - day la 1 bo loc "Khach
  // hang" (ho so), khong phai "Co hoi" - Co hoi chua gan ho so khach hang
  // khong co 1 crm_customers.id on dinh de backend loc dung, nen khong dua
  // vao danh sach nay (khac ban truoc, tung dung deal.id lam fallback key -
  // khong con phu hop khi filter phai gui customer_id THAT xuong backend).
  const customerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const deal of scopedDeals) {
      if (!deal.customerId) continue;
      if (!map.has(deal.customerId)) {
        map.set(deal.customerId, deal.companyName ? `${deal.customerName} — ${deal.companyName}` : deal.customerName);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [scopedDeals]);

  // Du an phu thuoc dung 1 Khach hang (projects.customer_id NOT NULL) - chua
  // chon Khach hang thi danh sach Du an rong (disable dropdown), doi Khach
  // hang thi Du an dang chon (neu co) tu dong bi bo (clear) vi co the khong
  // con thuoc khach hang moi.
  const [projectFilter, setProjectFilter] = useState('');
  const [projectFilterOptions, setProjectFilterOptions] = useState<Project[]>([]);
  useEffect(() => {
    let alive = true;
    setProjectFilter('');
    if (!customerFilter) {
      setProjectFilterOptions([]);
      return;
    }
    projectsService.list(customerFilter).then(res => {
      if (alive) setProjectFilterOptions(res.success ? res.data || [] : []);
    }).catch(() => {
      if (alive) setProjectFilterOptions([]);
    });
    return () => {
      alive = false;
    };
  }, [customerFilter]);

  // "Tat ca owner" (1 dropdown, khop CA vai tro Presale lan Sale - xem
  // owner_id o backend) - danh sach nguoi that tu quote_business_role
  // (presale/sale that), KHONG phai SDR/leader cua Deal (2 khai niem khac
  // nhau: SDR/leader la nguoi phu trach CO HOI CRM, technicalOwner/quoteOwner
  // la nguoi phu trach XU LY BAO GIA).
  const [ownerFilterOptions, setOwnerFilterOptions] = useState<QuoteBusinessRoleUser[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all([usersService.getUsersByQuoteBusinessRole('presale'), usersService.getUsersByQuoteBusinessRole('sale')]).then(([presaleRes, saleRes]) => {
      if (!alive) return;
      const map = new Map<string, QuoteBusinessRoleUser>();
      for (const u of presaleRes.success ? presaleRes.data || [] : []) map.set(u.id, u);
      for (const u of saleRes.success ? saleRes.data || [] : []) map.set(u.id, u);
      setOwnerFilterOptions(Array.from(map.values()));
    }).catch(() => {
      if (alive) setOwnerFilterOptions([]);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [ownerFilter, setOwnerFilter] = useState('');

  const PAGE_SIZE = QUOTE_ROW_LIMIT;

  // period (Thang nay/Quy nay/Nam nay) -> khoang ngay THAT gui xuong backend
  // (date_from/date_to) - cung 1 dinh nghia biên gioi voi matchesPeriod() o
  // tren (dung cho KPI client-side) de 2 noi luon dong nhat.
  function periodToDateRange(p: Period): { dateFrom?: string; dateTo?: string } {
    if (p === 'all') return {};
    const now = new Date();
    let start: Date;
    if (p === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (p === 'quarter') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    else start = new Date(now.getFullYear(), 0, 1);
    return { dateFrom: start.toISOString() };
  }

  // Reset ve trang 1 khi doi BAT KY filter/tab/tim kiem nao - tranh dung o
  // trang 4 cua bo loc cu nhung bo loc moi chi con 1 trang, hien trang rong
  // vo ly.
  useEffect(() => {
    setPage(1);
  }, [phaseTab, listSearch, customerFilter, projectFilter, ownerFilter, teamFilter, roleScope, period, slaFilter]);

  function buildByPhaseParams(pageArg: number) {
    const { dateFrom, dateTo } = periodToDateRange(period);
    return {
      phase: phaseTab === 'all' ? undefined : phaseTab,
      search: listSearch,
      customerId: customerFilter || undefined,
      projectId: projectFilter || undefined,
      ownerId: ownerFilter || undefined,
      mine: roleScope === 'mine',
      teamId: teamFilter || undefined,
      dateFrom,
      dateTo,
      sla: slaFilter || undefined,
      page: pageArg,
      pageSize: PAGE_SIZE,
    };
  }

  // Bang "Danh sach bao gia" THAT (Checkpoint C) - goi /quotes/by-phase, 1
  // chuoi version = 1 dong, TOAN BO filter + dem/phan trang/tim kiem o
  // BACKEND (khong con loc client-side tren 1 trang da tra ve). Guard dua
  // chon (byPhaseSeqRef) chan ket qua CU tra ve SAU khi nguoi dung da chuyen
  // sang tab/trang/bo loc khac - tranh RACE CONDITION ghi de du lieu moi
  // bang du lieu cu (bug thuc te thuong gap khi chuyen tab nhanh).
  useEffect(() => {
    let alive = true;
    const seq = ++byPhaseSeqRef.current;
    setByPhaseLoading(true);
    setByPhaseError(null);
    seedingQuoteRepository
      .getQuotesByPhase(buildByPhaseParams(page))
      .then(result => {
        if (!alive || seq !== byPhaseSeqRef.current) return;
        setByPhase(result);
      })
      .catch(err => {
        if (!alive || seq !== byPhaseSeqRef.current) return;
        setByPhaseError(err instanceof Error ? err.message : 'Không tải được danh sách báo giá.');
      })
      .finally(() => {
        if (!alive || seq !== byPhaseSeqRef.current) return;
        setByPhaseLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseTab, listSearch, customerFilter, projectFilter, ownerFilter, teamFilter, roleScope, period, slaFilter, page]);

  async function refreshByPhase() {
    const seq = ++byPhaseSeqRef.current;
    try {
      const result = await seedingQuoteRepository.getQuotesByPhase(buildByPhaseParams(page));
      if (seq === byPhaseSeqRef.current) setByPhase(result);
    } catch {
      // Loi refresh sau 1 hanh dong (duyet/huy/tao version...) khong quan
      // trong bang loi tai trang dau - da co state loi rieng cho lan tai
      // chinh, khong can bao trung lap o day.
    }
  }

  // 1 dong bang = 1 quote (da la "current" cua chuoi, DA duoc backend loc +
  // phan trang DAY DU - khong con buoc loc/cat trang nao o client nua). Deal
  // van lay tu dealsById (da co san qua useCrm(), du lieu THAT) CHI de hien
  // thi ten Khach hang/Co hoi - KHONG dung de loc (loc da xong o backend).
  const chainRows = useMemo<QuoteChainRow[]>(() => {
    return (byPhase?.items || []).map(current => {
      const deal = current.dealId ? dealsById.get(current.dealId) : undefined;
      return { current, versionCount: current.versionCount || current.currentVersionNumber || 1, deal, status: quoteDisplayStatus(current, deal) };
    });
  }, [byPhase, dealsById]);

  // "Nhom theo Du an" (thay "Nhom theo Co hoi CRM" cu) - group theo
  // current.project?.id (du lieu THAT tu backend, khong phai deal). Chi gom
  // trong PHAM VI trang dang xem (du lieu da la 1 trang tu backend).
  const groupedByProjectRows = useMemo(() => {
    if (!groupByProject) return [];
    const map = new Map<string, QuoteChainRow[]>();
    for (const row of chainRows) {
      const key = row.current.project?.id || NO_PROJECT_GROUP_KEY;
      const arr = map.get(key);
      if (arr) arr.push(row);
      else map.set(key, [row]);
    }
    return Array.from(map.entries())
      .map(([projectId, rows]) => ({
        projectId,
        project: rows[0]?.current.project,
        rows,
        versionTotal: rows.reduce((sum, row) => sum + row.versionCount, 0),
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [groupByProject, chainRows]);

  const filteredDealsForPicker = useMemo(() => {
    const term = dealSearch.trim().toLowerCase();
    if (!term) return deals.slice(0, 30);
    return deals
      .filter(
        deal =>
          deal.customerName.toLowerCase().includes(term) || (deal.companyName || '').toLowerCase().includes(term)
      )
      .slice(0, 30);
  }, [deals, dealSearch]);

  function openFreshModal() {
    setQuoteModal({ open: true, deal: null });
  }
  /** "+ Yêu cầu hỗ trợ báo giá" - KHÔNG dùng wizard CreateQuoteModal (khác
   * handler hoàn toàn với "Tạo báo giá") - mở thẳng QuoteWorkspaceModal ở chế
   * độ tạo mới (quoteId=null), bám UI/luồng HTML Phase 2. */
  function openRequestWorkspace() {
    setWorkspaceCreateMode(true);
  }
  function openTemplateModal(form: QuoteForm) {
    setQuoteModal({ open: true, deal: null, quoteFormId: form.id });
  }
  function pickDealAndOpen(deal: Deal) {
    setDealPickerOpen(false);
    setDealSearch('');
    setQuoteModal({ open: true, deal });
  }

  async function refreshQuotes() {
    // KPI/phễu/hiệu suất Sale phía trên vẫn tính trên `quotes` (client) - vẫn
    // cần load lại để các số liệu đó đúng sau 1 hành động. Bảng "Danh sách
    // báo giá" bên dưới GIỜ LÀ backend-driven (/quotes/by-phase) - refresh
    // riêng qua refreshByPhase(), KHÔNG còn đọc từ `quotes` state nữa.
    const rows = await seedingQuoteRepository.getQuotes();
    setQuotes(rows);
    await refreshByPhase();
  }

  async function createVersion(quote: Quote) {
    try {
      const result = await seedingQuoteRepository.createQuoteVersion(quote.id);
      if (result.redirectedFromClickedQuote) {
        window.alert(`Chuỗi báo giá đã có bản duyệt mới hơn (V${result.sourceVersionNumber}) — đã tạo phiên bản mới từ bản đó.`);
      } else if (!result.created) {
        window.alert('Chuỗi này đã có bản nháp sẵn — mở bản nháp đó.');
      }
      await refreshQuotes();
      // Bang "Danh sach bao gia" nam khuat ben duoi trang (sau KPI/quick-start/
      // templates) - bao gia moi tao luon o dong dau bang (sort theo updatedAt
      // desc) nhung nguoi dung khong thay ngay vi vi tri cuon trang khong doi -
      // tu cuon xuong dung bang de lo dong moi ra thay vi bat tim thu cong.
      linkedQuotesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const deal = result.quote.dealId ? dealsById.get(result.quote.dealId) : null;
      setQuoteModal({ open: true, deal: deal || null, editQuote: result.quote });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tạo được phiên bản báo giá mới.');
    }
  }

  async function editDraft(row: QuoteChainRow) {
    try {
      const quote = await seedingQuoteRepository.getQuote(row.current.id);
      setQuoteModal({ open: true, deal: row.deal || null, editQuote: quote });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được báo giá để sửa.');
    }
  }

  async function approveNow(row: QuoteChainRow) {
    if (!window.confirm(`Duyệt báo giá ${row.current.quoteNumber}? Sau khi duyệt sẽ không sửa được nữa.`)) return;
    try {
      await seedingQuoteRepository.approveQuote(row.current.id);
      await refreshQuotes();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không duyệt được báo giá.');
    }
  }

  async function deleteDraftNow(row: QuoteChainRow) {
    // deleteQuote() goi DELETE /quotes/{id} - tu Section 3 da doi sang SOFT
    // delete that su (khong con hard-delete am tham), Admin van khoi phuc
    // duoc neu can - khac "Huỷ báo giá" (chuyen trang thai cancelled, giu
    // nguyen record de xem lai), day la go han khoi danh sach dang lam.
    if (!window.confirm(`Xoá báo giá ${row.current.quoteNumber}? Báo giá sẽ chuyển sang trạng thái đã xoá (ẩn khỏi danh sách), Admin có thể khôi phục nếu cần.`)) return;
    try {
      await seedingQuoteRepository.deleteQuote(row.current.id);
      await refreshQuotes();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được báo giá.');
    }
  }

  async function copyPublicLink(row: QuoteChainRow) {
    if (!row.current.publicUrl) return;
    await navigator.clipboard.writeText(`${window.location.origin}${row.current.publicUrl}`);
  }

  const [versionHistory, setVersionHistory] = useState<{ open: boolean; loading: boolean; quoteNumber: string; versions: Quote[] }>({
    open: false,
    loading: false,
    quoteNumber: '',
    versions: [],
  });

  // "Huy bao gia"/"Huy cong khai" (Phase 1, migration 087/089) - popup xac
  // nhan rieng, bat buoc ly do cho huy bao gia, chong double-click bang co
  // `busy` (disable nut Xac nhan trong luc dang goi API).
  const [cancelModal, setCancelModal] = useState<{ open: boolean; quoteId: string; quoteNumber: string; reason: string; busy: boolean }>({
    open: false, quoteId: '', quoteNumber: '', reason: '', busy: false,
  });
  const [revokeModal, setRevokeModal] = useState<{ open: boolean; quoteId: string; quoteNumber: string; busy: boolean }>({
    open: false, quoteId: '', quoteNumber: '', busy: false,
  });

  async function confirmCancelQuote() {
    if (cancelModal.busy) return;
    if (!cancelModal.reason.trim()) {
      window.alert('Vui lòng nhập lý do huỷ báo giá.');
      return;
    }
    setCancelModal(m => ({ ...m, busy: true }));
    try {
      await seedingQuoteRepository.cancelQuote(cancelModal.quoteId, cancelModal.reason.trim());
      setCancelModal({ open: false, quoteId: '', quoteNumber: '', reason: '', busy: false });
      await refreshQuotes();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không huỷ được báo giá.');
      setCancelModal(m => ({ ...m, busy: false }));
    }
  }

  async function confirmRevokePublic() {
    if (revokeModal.busy) return;
    setRevokeModal(m => ({ ...m, busy: true }));
    try {
      await seedingQuoteRepository.revokePublicQuote(revokeModal.quoteId);
      setRevokeModal({ open: false, quoteId: '', quoteNumber: '', busy: false });
      await refreshQuotes();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không huỷ công khai được báo giá.');
      setRevokeModal(m => ({ ...m, busy: false }));
    }
  }

  async function viewVersionHistory(row: QuoteChainRow) {
    setVersionHistory({ open: true, loading: true, quoteNumber: row.current.quoteNumber, versions: [] });
    try {
      const versions = await seedingQuoteRepository.getQuoteVersions(row.current.id);
      setVersionHistory({ open: true, loading: false, quoteNumber: row.current.quoteNumber, versions });
    } catch (err) {
      setVersionHistory({ open: false, loading: false, quoteNumber: '', versions: [] });
      window.alert(err instanceof Error ? err.message : 'Không tải được lịch sử phiên bản.');
    }
  }

  /** Danh sach hanh dong KHONG dung chung 1 mau cho moi trang thai - moi
   * trang thai (Chua duyet/Da duyet/Da chot/Da huy) co 1 tap hanh dong that
   * rieng, dung theo dung yeu cau xac nhan. KHONG co "Gui email cho khach":
   * da grep toan bo backend (`routers/quote.py`, khong co endpoint gui email
   * that nao, chi co /send-telegram) - chua co API that nen KHONG them nut
   * gia/toast demo. Gui khach hien chi qua "Sao chep link"/"Xem ban khach
   * hang" (public link) - "Gui email" se thuoc phase phat hanh bao gia sau
   * nay khi co API that. */
  function rowActionItems(row: QuoteChainRow): ActionMenuItem[] {
    const { current, deal, status, versionCount } = row;
    const canEdit = canWriteDeal(user, deal) || canApproveQuote(user);
    const openItem: ActionMenuItem = {
      key: 'open',
      label: 'Mở báo giá',
      icon: ExternalLink,
      group: 1,
      onSelect: () => setWorkspaceQuoteId(current.id),
    };
    const historyItem: ActionMenuItem = {
      key: 'history',
      label: 'Lịch sử phiên bản',
      icon: History,
      group: 3,
      trailing: String(versionCount),
      onSelect: () => void viewVersionHistory(row),
    };
    const viewPublicItems: ActionMenuItem[] = current.publicUrl
      ? [
          { key: 'view-public', label: 'Xem bản khách hàng', icon: Eye, group: 2, onSelect: () => window.open(current.publicUrl, '_blank', 'noopener') },
          { key: 'copy-link', label: 'Sao chép link báo giá', icon: Link2, group: 2, onSelect: () => void copyPublicLink(row) },
        ]
      : [];

    if (status.key === 'lost') {
      return [openItem, historyItem];
    }
    if (status.key === 'won') {
      const contract = contractByQuoteId.get(current.id);
      const contractItem: ActionMenuItem[] = contract
        ? [{ key: 'view-contract', label: 'Xem hợp đồng', icon: FileText, group: 2, onSelect: () => router.push(`/all-platform/contracts/${contract.id}`) }]
        : [];
      return [openItem, ...viewPublicItems, ...contractItem, historyItem];
    }
    if (current.status === 'draft') {
      const items = [openItem];
      if (canEdit) items.push({ key: 'edit', label: 'Chỉnh sửa bản nháp', icon: Pencil, group: 1, onSelect: () => void editDraft(row) });
      if (canApproveQuote(user)) items.push({ key: 'approve', label: 'Duyệt báo giá', icon: CheckCircle2, group: 1, onSelect: () => void approveNow(row) });
      items.push({
        key: 'cancel',
        label: 'Huỷ báo giá',
        icon: XCircle,
        group: 1,
        danger: true,
        onSelect: () => setCancelModal({ open: true, quoteId: current.id, quoteNumber: current.quoteNumber, reason: '', busy: false }),
      });
      if (canEdit) {
        items.push({
          key: 'delete',
          label: 'Xoá báo giá',
          icon: Trash2,
          group: 1,
          danger: true,
          onSelect: () => void deleteDraftNow(row),
        });
      }
      items.push(historyItem);
      return items;
    }
    // Da duyet (approved/confirmed, chua chot/chua huy). "Tao phien ban moi"
    // CHI cho status='approved' that su - 'confirmed' (du lieu cu truoc
    // migration 053) bi RPC quote_create_version tu choi voi loi
    // quote_not_approved (da test that), khong hien nut cho truong hop nay.
    const items = [openItem];
    if (current.status === 'approved') {
      items.push({
        key: 'create-version',
        label: 'Tạo phiên bản mới',
        icon: GitBranchPlus,
        group: 2,
        trailing: `V${(current.versionNumber || 1) + 1}`,
        onSelect: () => void createVersion(current),
      });
    }
    items.push(...viewPublicItems);
    // Chi enable khi THAT SU dang public (publicEnabled=true) - da co API
    // that (quote_revoke_public, migration 089).
    items.push({
      key: 'unpublish',
      label: 'Huỷ công khai',
      icon: XCircle,
      group: 2,
      danger: true,
      disabled: !current.publicEnabled || !current.publicUrl,
      title: !current.publicEnabled || !current.publicUrl ? 'Báo giá chưa được công khai' : undefined,
      onSelect: () => setRevokeModal({ open: true, quoteId: current.id, quoteNumber: current.quoteNumber, busy: false }),
    });
    items.push(historyItem);
    return items;
  }

  function renderChainRow(row: QuoteChainRow) {
    const { current, deal, versionCount } = row;
    const businessCode = deal ? dealBusinessCode(deal) : null;
    const opportunityName = deal ? getServicePackageText(deal.servicePackage) || getPackageText(deal.package) : '';
    const phase = phaseCellLabel(current, deal);
    const project = current.project;
    // Chua gan Presale/Sale rieng cho quote nay -> fallback ve Quan ly/Phu
    // trach cua DEAL (nguoi dung yeu cau: "chỗ chưa gán lấy từ quản lý với
    // phụ trách") - van hien "Chưa gán" that su neu deal cung khong co ai.
    const techName = current.technicalOwner?.name || deal?.assignment.leadName || null;
    const saleOwnerName = current.quoteOwner?.name || deal?.assignment.sdrName || null;
    const margin = current.hasCostData ? marginTone(current.grossMarginPercent) : 'neutral';
    const sla = computeQuoteSla({ slaDueAt: current.slaDueAt, completedAt: current.completedAt, sentAt: current.sentAt });
    return (
      <tr key={current.id} className="qc-row-compact">
        <td data-label="Báo giá / Cơ hội · Version" className="qc-cell-quote">
          <div className="qc-cell-quote-line1">
            <button type="button" className="qc-row-link qc-row-link-btn" title={current.quoteNumber} onClick={() => setWorkspaceQuoteId(current.id)}>
              {current.quoteNumber}
            </button>
            <span className="qc-badge qc-badge-version">V{current.versionNumber || 1} hiện tại</span>
          </div>
          {typeof current.data?.quoteTitle === 'string' && current.data.quoteTitle ? (
            <div className="qc-cell-quote-title" title={current.data.quoteTitle}>
              {current.data.quoteTitle}
            </div>
          ) : null}
          {deal ? (
            <div className="qc-row-sub">
              <Link href={`/all-platform/crm?openDeal=${deal.id}`} className="qc-row-link">
                {businessCode || 'Cơ hội chưa có mã'}
              </Link>
              {opportunityName ? ` · ${opportunityName}` : ''}
            </div>
          ) : null}
          <div className="qc-row-sub">{versionCount} phiên bản · cập nhật {relativeTime(current.updatedAt || current.createdAt)}</div>
        </td>
        <td data-label="Khách hàng">
          {deal ? (
            <>
              {deal.customerId ? (
                <Link href={`/all-platform/crm/customers/${deal.customerId}`} className="qc-row-link">
                  {deal.customerName}
                </Link>
              ) : (
                <span>{deal.customerName}</span>
              )}
              {deal.industry || deal.city ? (
                <div className="qc-row-sub">{[deal.industry, deal.city].filter(Boolean).join(' · ')}</div>
              ) : null}
            </>
          ) : (
            <span className="qc-row-sub">Chưa gắn cơ hội</span>
          )}
        </td>
        <td data-label="Dự án">
          {project ? (
            <>
              {deal?.customerId ? (
                <Link href={`/all-platform/crm/customers/${deal.customerId}?tab=quotes&projectId=${project.id}`} className="qc-row-link">
                  {project.code ? `${project.code} · ${project.name}` : project.name}
                </Link>
              ) : (
                <span>{project.code ? `${project.code} · ${project.name}` : project.name}</span>
              )}
              {project.status ? <div className="qc-row-sub">{PROJECT_STATUS_LABELS[project.status] || project.status}</div> : null}
            </>
          ) : (
            <span className="qc-row-sub">Chưa thuộc dự án</span>
          )}
        </td>
        <td data-label="Phase hiện tại">
          <span className={`qc-badge qc-badge-${phase.tone}`} style={{ whiteSpace: 'normal' }}>{phase.label}</span>
        </td>
        <td data-label="Presale → Sale">
          <div className="qc-sale-cell qc-sale-cell--text-only">
            <span title={techName || 'Chưa gán'}>{techName || 'Chưa gán'}</span>
            <span aria-hidden className="qc-owner-arrow">→</span>
            <span title={saleOwnerName || 'Chưa gán'}>{saleOwnerName || 'Chưa gán'}</span>
          </div>
        </td>
        <td data-label="Giá nội bộ" className="qc-cell-money">
          {current.costViewAllowed === false ? (
            <span className="qc-row-sub" title="Chỉ Presale/Sale được phân công hoặc Admin mới xem được giá vốn">Không có quyền xem</span>
          ) : current.hasCostData ? (
            formatMoney(current.costTotal || 0)
          ) : (
            <span className="qc-row-sub">Chưa có</span>
          )}
        </td>
        <td data-label="Giá khách" className="qc-cell-money">{formatMoney(current.customerPriceBeforeVat ?? 0)}</td>
        <td data-label="Margin">
          {current.profitabilityViewAllowed === false ? (
            <span className="qc-row-sub" title="Chỉ Sale phụ trách hoặc Admin mới xem được margin">Không có quyền xem</span>
          ) : current.hasCostData && current.grossMarginPercent !== null && current.grossMarginPercent !== undefined ? (
            <span className={`qc-badge qc-badge-${margin}`}>{current.grossMarginPercent.toFixed(1)}%</span>
          ) : (
            <span className="qc-row-sub">Chưa tính</span>
          )}
        </td>
        <td data-label="SLA / Deadline">
          {sla.status === 'not_set' ? (
            <span className="qc-row-sub">{sla.label}</span>
          ) : (
            <>
              <span
                className="qc-badge"
                style={{ color: sla.tone === 'danger' ? '#b3261e' : sla.tone === 'warning' ? '#8a6416' : sla.tone === 'success' ? '#148e61' : undefined }}
              >
                {sla.label}
              </span>
              {sla.relativeText ? <div className="qc-row-sub">{sla.relativeText}</div> : null}
            </>
          )}
        </td>
        <td data-label="" className="qc-cell-actions">
          <ActionMenu items={rowActionItems(row)} />
        </td>
      </tr>
    );
  }

  const loading = dealsLoading || quotesLoading;

  return (
    <div className="qc-page">
      <header className="qc-header">
        <div>
          <h1>Trung tâm báo giá</h1>
          <p>Tạo, gửi và theo dõi báo giá liên kết trực tiếp với CRM</p>
        </div>
        <div className="qc-header-actions">
          <button type="button" className="qc-btn" onClick={openRequestWorkspace} title="Mở workspace xử lý báo giá — chọn khách hàng/cơ hội và người phụ trách ngay trong workspace">
            <Plus className="qc-icon" /> Yêu cầu hỗ trợ báo giá
          </button>
          <button type="button" className="qc-btn qc-btn-primary" onClick={openFreshModal}>
            <Plus className="qc-icon" /> Tạo báo giá
          </button>
        </div>
      </header>

      <section className="qc-insights">
        <div className="qc-section-head">
          <div>
            <h2>Hiệu suất báo giá &amp; CRM</h2>
            <p>KPI tính theo đúng phạm vi/bộ lọc đang chọn ở bảng "Danh sách báo giá" bên dưới</p>
          </div>
        </div>

        {loading ? (
          <div className="qc-state">Đang tải dữ liệu...</div>
        ) : (
          <>
            <div className="qc-metrics">
              <MetricCard tone="rose" label="Tổng khách hàng CRM" value={String(kpis.totalDeals)} />
              <MetricCard tone="blue" label="Khách hàng được báo giá" value={String(kpis.quotedCustomers)} />
              <MetricCard tone="blue" label="Tổng số báo giá" value={String(kpis.totalQuotes)} />
              <MetricCard tone="amber" label="Báo giá đã duyệt" value={String(kpis.sent)} />
              <MetricCard tone="green" label="Báo giá thành công" value={String(kpis.won)} />
              <MetricCard tone="green" label="Tỷ lệ chuyển đổi" value={`${kpis.conversionRate}%`} />
              <MetricCard tone="rose" label="Tổng giá trị báo giá" value={formatMoney(kpis.totalValue)} big />
              <MetricCard tone="green" label="Giá trị đã chốt" value={formatMoney(kpis.wonValue)} big />
            </div>

            <div className="qc-insight-grid">
              <article className="qc-insight-card">
                <h3>Phễu chuyển đổi báo giá</h3>
                <p>Từ khâu tạo báo giá đến khi chốt thành hợp đồng</p>
                <div className="qc-funnel">
                  {funnel.map(step => (
                    <div className="qc-funnel-item" key={step.label}>
                      <span>{step.label}</span>
                      <div className="qc-funnel-track">
                        <i style={{ width: `${step.percent}%` }} />
                      </div>
                      <b>
                        {step.count} · {step.percent}%
                      </b>
                    </div>
                  ))}
                </div>
              </article>

              <article className="qc-insight-card">
                <h3>Hiệu suất theo Sale</h3>
                <p>So sánh số khách hàng, số báo giá, giá trị và tỷ lệ chuyển đổi</p>
                <div className="qc-table-wrap">
                  <table className="qc-team-table">
                    <thead>
                      <tr>
                        <th>Sale</th>
                        <th>KH đã BG</th>
                        <th>Báo giá</th>
                        <th>Đã duyệt</th>
                        <th>Đã chốt</th>
                        <th>Tỷ lệ chốt</th>
                        <th>Giá trị BG</th>
                        <th>Giá trị chốt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="qc-empty">
                            Chưa có dữ liệu trong phạm vi đang chọn.
                          </td>
                        </tr>
                      ) : (
                        saleRows.map(row => (
                          <tr key={row.key}>
                            <td data-label="Sale">
                              <div className="qc-sale-cell">
                                <span className="qc-avatar">{initialsOf(row.name)}</span>
                                <strong>{row.name}</strong>
                              </div>
                            </td>
                            <td data-label="KH đã BG">{row.dealIds.size}</td>
                            <td data-label="Báo giá">{row.quotes}</td>
                            <td data-label="Đã duyệt">{row.sent}</td>
                            <td data-label="Đã chốt">{row.won}</td>
                            <td data-label="Tỷ lệ chốt">{row.quotes ? Math.round((row.won / row.quotes) * 1000) / 10 : 0}%</td>
                            <td data-label="Giá trị BG">{formatMoney(row.value)}</td>
                            <td data-label="Giá trị chốt">{formatMoney(row.wonValue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="qc-insight-card">
                <h3>Hiệu suất theo Team</h3>
                <p>So sánh số khách hàng, số báo giá, giá trị và tỷ lệ chuyển đổi theo team</p>
                <div className="qc-table-wrap">
                  <table className="qc-team-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>KH đã BG</th>
                        <th>Báo giá</th>
                        <th>Đã duyệt</th>
                        <th>Đã chốt</th>
                        <th>Tỷ lệ chốt</th>
                        <th>Giá trị BG</th>
                        <th>Giá trị chốt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="qc-empty">
                            Chưa có dữ liệu trong phạm vi đang chọn.
                          </td>
                        </tr>
                      ) : (
                        teamRows.map(row => (
                          <tr key={row.key}>
                            <td data-label="Team">
                              <strong>{row.name}</strong>
                            </td>
                            <td data-label="KH đã BG">{row.dealIds.size}</td>
                            <td data-label="Báo giá">{row.quotes}</td>
                            <td data-label="Đã duyệt">{row.sent}</td>
                            <td data-label="Đã chốt">{row.won}</td>
                            <td data-label="Tỷ lệ chốt">{row.quotes ? Math.round((row.won / row.quotes) * 1000) / 10 : 0}%</td>
                            <td data-label="Giá trị BG">{formatMoney(row.value)}</td>
                            <td data-label="Giá trị chốt">{formatMoney(row.wonValue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </>
        )}
      </section>

      <section className="qc-quick">
        <div>
          <span className="qc-eyebrow">TẠO NHANH TRONG 60 GIÂY</span>
          <h2>Bắt đầu báo giá mới</h2>
          <p>Chọn khách hàng và mẫu có sẵn, hệ thống sẽ tự điền dịch vụ, giá bán, thuế và điều khoản.</p>
          <div className="qc-quick-buttons">
            <button type="button" className="qc-btn qc-btn-primary" onClick={openFreshModal}>
              <Plus className="qc-icon" /> Tạo báo giá nhanh
            </button>
            <button type="button" className="qc-btn qc-btn-soft" onClick={() => setDealPickerOpen(true)}>
              Tạo từ cơ hội CRM →
            </button>
          </div>
        </div>
        <div className="qc-quick-steps">
          <div className="qc-quick-step">
            <b>1</b>
            <span>
              <strong>Khách hàng</strong>
              <small>Chọn từ CRM</small>
            </span>
          </div>
          <i />
          <div className="qc-quick-step">
            <b>2</b>
            <span>
              <strong>Dịch vụ</strong>
              <small>Từ mẫu báo giá</small>
            </span>
          </div>
          <i />
          <div className="qc-quick-step">
            <b>3</b>
            <span>
              <strong>Gửi khách</strong>
              <small>Link báo giá</small>
            </span>
          </div>
        </div>
      </section>

      <section className="qc-section">
        <div className="qc-section-head">
          <div>
            <h2>Mẫu dùng nhanh</h2>
            <p>Tạo báo giá từ mẫu đã chuẩn hoá</p>
          </div>
          <Link href="/all-platform/quotes" className="qc-link">
            Quản lý mẫu →
          </Link>
        </div>
        {forms.length === 0 ? (
          <div className="qc-state">Chưa có mẫu báo giá đang hoạt động.</div>
        ) : (
          <div className="qc-templates">
            {forms.slice(0, TEMPLATE_ROW_LIMIT).map((form, index) => (
              <article key={form.id} className="qc-template" onClick={() => openTemplateModal(form)}>
                <div className="qc-template-top">
                  <div className={`qc-template-icon ${TEMPLATE_ICON_CLASSES[index % TEMPLATE_ICON_CLASSES.length]}`}>
                    {index % 3 === 2 ? <MessageCircle className="qc-icon" /> : <FileText className="qc-icon" />}
                  </div>
                  <div className="qc-template-body">
                    <h3 title={form.name}>{form.name}</h3>
                    <p>{form.description || 'Mẫu báo giá chuẩn hoá'}</p>
                  </div>
                </div>
                <span className="qc-template-fieldcount">{form.fieldCount} trường dữ liệu</span>
                <button
                  type="button"
                  className="qc-template-cta"
                  onClick={event => {
                    event.stopPropagation();
                    openTemplateModal(form);
                  }}
                >
                  Tạo báo giá
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="qc-section qc-linked-quotes" ref={linkedQuotesSectionRef}>
        <div className="qc-section-head">
          <div>
            <h2>Danh sách báo giá</h2>
            <p>Toàn bộ báo giá trong phạm vi đang chọn — 1 chuỗi phiên bản chỉ tính là 1 dòng</p>
          </div>
        </div>

        {/* Section 7 - KPI SLA: dem TU BACKEND (truoc pagination, bam theo
            filter Customer/Project/Owner/Team/Mine/Period hien tai) - bam
            vao de loc nhanh, bam lai lan nua de bo loc. */}
        <div className="qc-sla-kpi-row" role="group" aria-label="KPI SLA báo giá">
          <button
            type="button"
            className={`qc-sla-kpi qc-sla-kpi--danger ${slaFilter === 'overdue' ? 'active' : ''}`}
            onClick={() => setSlaFilter(prev => (prev === 'overdue' ? null : 'overdue'))}
            disabled={byPhaseLoading && !byPhase}
          >
            <strong>{byPhase?.slaCounts?.overdue ?? '…'}</strong> báo giá quá hạn
          </button>
          <button
            type="button"
            className={`qc-sla-kpi qc-sla-kpi--warning ${slaFilter === 'due_soon' ? 'active' : ''}`}
            onClick={() => setSlaFilter(prev => (prev === 'due_soon' ? null : 'due_soon'))}
            disabled={byPhaseLoading && !byPhase}
          >
            <strong>{byPhase?.slaCounts?.dueSoon ?? '…'}</strong> sắp đến hạn (≤4h)
          </button>
          {slaFilter ? (
            <button type="button" className="qc-sla-kpi-clear" onClick={() => setSlaFilter(null)}>
              Bỏ lọc SLA
            </button>
          ) : null}
        </div>

        <div className="qc-status-tabs">
          {PHASE_TABS.map(key => (
            <button
              key={key}
              type="button"
              className={`qc-status-tab ${phaseTab === key ? 'active' : ''}`}
              onClick={() => setPhaseTab(key)}
            >
              {PHASE_TAB_LABELS[key]} <span>{byPhase ? byPhase.counts[key] : '…'}</span>
            </button>
          ))}
        </div>

        <div className="qc-list-tools">
          <input
            placeholder="Tìm theo mã báo giá..."
            value={listSearch}
            onChange={event => setListSearch(event.target.value)}
          />
          <div className="crm-filter-select-wrap">
            <SearchableSelect
              value={customerFilter}
              onChange={setCustomerFilter}
              placeholder="Tất cả khách hàng"
              options={customerOptions}
            />
          </div>
          <div className="crm-filter-select-wrap">
            <SearchableSelect
              value={projectFilter}
              onChange={setProjectFilter}
              placeholder="Tất cả dự án"
              options={projectFilterOptions.map(p => ({ value: p.id, label: `${p.projectCode} · ${p.name}` }))}
              disabled={!customerFilter}
            />
          </div>
          <div className="crm-filter-select-wrap">
            <SearchableSelect
              value={ownerFilter}
              onChange={setOwnerFilter}
              placeholder="Tất cả owner"
              options={ownerFilterOptions.map(u => ({ value: u.id, label: u.name }))}
            />
          </div>
          <div className="crm-filter-select-wrap">
            <SearchableSelect
              value={teamFilter}
              onChange={setTeamFilter}
              placeholder="Tất cả team"
              options={teams.map(team => ({ value: team.id, label: team.name_team }))}
            />
          </div>
          <select value={period} onChange={event => setPeriod(event.target.value as Period)}>
            <option value="all">Tất cả thời gian</option>
            <option value="month">Tháng này</option>
            <option value="quarter">Quý này</option>
            <option value="year">Năm nay</option>
          </select>
          <div className="qc-role-switch qc-role-switch--compact">
            <button type="button" className={roleScope === 'all' ? 'active' : ''} onClick={() => setRoleScope('all')}>
              Tất cả
            </button>
            <button type="button" className={roleScope === 'mine' ? 'active' : ''} onClick={() => setRoleScope('mine')}>
              Của tôi
            </button>
          </div>
          <label className="qc-group-toggle">
            <input type="checkbox" checked={groupByProject} onChange={event => setGroupByProject(event.target.checked)} />
            Nhóm theo dự án
          </label>
        </div>

        <div className="qc-table-wrap">
          <table className="qc-linked-table qc-linked-table--10col">
            <thead>
              <tr>
                <th>Báo giá / Cơ hội · Version</th>
                <th>Khách hàng</th>
                <th>Dự án</th>
                <th>Phase hiện tại</th>
                <th>Presale → Sale</th>
                <th className="qc-th-money">Giá nội bộ</th>
                <th className="qc-th-money">Giá khách</th>
                <th>Margin</th>
                <th>SLA / Deadline</th>
                <th className="qc-th-actions">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {byPhaseError ? (
                <tr>
                  <td colSpan={10} className="qc-empty qc-empty-error">
                    Không tải được danh sách báo giá: {byPhaseError}
                  </td>
                </tr>
              ) : byPhaseLoading && !byPhase ? (
                <tr>
                  <td colSpan={10} className="qc-empty">
                    Đang tải danh sách báo giá…
                  </td>
                </tr>
              ) : chainRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="qc-empty">
                    {slaFilter === 'overdue'
                      ? 'Không có báo giá nào quá hạn trong phạm vi đang chọn.'
                      : slaFilter === 'due_soon'
                        ? 'Không có báo giá nào sắp đến hạn (≤4 giờ) trong phạm vi đang chọn.'
                        : 'Chưa có báo giá nào trong phạm vi đang chọn.'}
                  </td>
                </tr>
              ) : groupByProject ? (
                groupedByProjectRows.map(group => (
                  <Fragment key={`group-${group.projectId}`}>
                    <tr className="qc-group-header-row">
                      <td colSpan={10}>
                        {group.project ? (
                          <strong>{group.project.code ? `${group.project.code} · ${group.project.name}` : group.project.name}</strong>
                        ) : (
                          <strong>Chưa thuộc dự án</strong>
                        )}
                        <span className="qc-group-header-count">
                          {group.rows.length} báo giá · {group.versionTotal} version
                        </span>
                      </td>
                    </tr>
                    {group.rows.map(row => renderChainRow(row))}
                  </Fragment>
                ))
              ) : (
                chainRows.map(row => renderChainRow(row))
              )}
            </tbody>
          </table>
        </div>
        {!groupByProject && byPhase && byPhase.total > 0 ? (
          <div className="qc-pagination">
            <span className="qc-pagination-summary">
              {(byPhase.page - 1) * byPhase.pageSize + 1}–{Math.min(byPhase.page * byPhase.pageSize, byPhase.total)} / {byPhase.total} báo giá
              {byPhaseLoading ? ' · Đang tải…' : ''}
            </span>
            <div className="qc-pagination-controls">
              <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                ‹
              </button>
              {(() => {
                const totalPages = Math.max(1, Math.ceil(byPhase.total / byPhase.pageSize));
                return Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                  .reduce<number[]>((acc, n) => {
                    if (acc.length && n - acc[acc.length - 1] > 1) acc.push(-1);
                    acc.push(n);
                    return acc;
                  }, [])
                  .map((n, i) =>
                    n === -1 ? (
                      <span key={`gap-${i}`} className="qc-pagination-gap">…</span>
                    ) : (
                      <button key={n} type="button" className={n === page ? 'active' : ''} onClick={() => setPage(n)}>
                        {n}
                      </button>
                    )
                  );
              })()}
              <button
                type="button"
                disabled={page >= Math.max(1, Math.ceil(byPhase.total / byPhase.pageSize))}
                onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(byPhase.total / byPhase.pageSize)), p + 1))}
              >
                ›
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {dealPickerOpen ? (
        <div className="qc-modal-backdrop" onClick={() => setDealPickerOpen(false)}>
          <div className="qc-deal-picker" onClick={event => event.stopPropagation()}>
            <h3>Chọn cơ hội CRM</h3>
            <input
              autoFocus
              placeholder="Tìm theo tên khách hàng hoặc công ty..."
              value={dealSearch}
              onChange={event => setDealSearch(event.target.value)}
            />
            <div className="qc-deal-picker-list">
              {filteredDealsForPicker.length === 0 ? (
                <div className="qc-empty">Không tìm thấy cơ hội phù hợp.</div>
              ) : (
                filteredDealsForPicker.map(deal => (
                  <button type="button" key={deal.id} className="qc-deal-picker-item" onClick={() => pickDealAndOpen(deal)}>
                    <strong>{deal.customerName}</strong>
                    <span>{deal.companyName || 'Chưa có công ty'}</span>
                  </button>
                ))
              )}
            </div>
            <div className="qc-deal-picker-foot">
              <button type="button" className="qc-btn" onClick={() => setDealPickerOpen(false)}>
                Hủy
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {versionHistory.open ? (
        <div className="qc-modal-backdrop" onClick={() => setVersionHistory({ open: false, loading: false, quoteNumber: '', versions: [] })}>
          <div className="qc-deal-picker" onClick={event => event.stopPropagation()}>
            <h3>Lịch sử phiên bản — {versionHistory.quoteNumber}</h3>
            <div className="qc-deal-picker-list">
              {versionHistory.loading ? (
                <div className="qc-empty">Đang tải...</div>
              ) : versionHistory.versions.length === 0 ? (
                <div className="qc-empty">Không có dữ liệu.</div>
              ) : (
                versionHistory.versions.map(version => (
                  <Link
                    key={version.id}
                    href={`/all-platform/quotes/${version.id}`}
                    className="qc-deal-picker-item"
                  >
                    <strong>
                      V{version.versionNumber || 1} · {version.quoteNumber}
                    </strong>
                    <span>{quoteDisplayStatus(version).label} · {formatMoney(version.totalAmount)}</span>
                  </Link>
                ))
              )}
            </div>
            <div className="qc-deal-picker-foot">
              <button
                type="button"
                className="qc-btn"
                onClick={() => setVersionHistory({ open: false, loading: false, quoteNumber: '', versions: [] })}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModal.open ? (
        <div className="qc-modal-backdrop" onClick={() => (!cancelModal.busy ? setCancelModal({ open: false, quoteId: '', quoteNumber: '', reason: '', busy: false }) : undefined)}>
          <div className="qc-deal-picker" onClick={event => event.stopPropagation()}>
            <h3>Huỷ báo giá {cancelModal.quoteNumber}</h3>
            <p className="qc-workspace-note">Báo giá sẽ chuyển sang trạng thái Đã huỷ, không hard-delete, public link (nếu có) sẽ tự tắt.</p>
            <label className="qc-workspace-info-label">Lý do (bắt buộc)</label>
            <textarea
              className="qc-workspace-handoff-note"
              rows={3}
              value={cancelModal.reason}
              onChange={event => setCancelModal(m => ({ ...m, reason: event.target.value }))}
              placeholder="Vì sao huỷ báo giá này..."
            />
            <div className="qc-deal-picker-foot">
              <button type="button" className="qc-btn" disabled={cancelModal.busy} onClick={() => setCancelModal({ open: false, quoteId: '', quoteNumber: '', reason: '', busy: false })}>
                Đóng
              </button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={cancelModal.busy || !cancelModal.reason.trim()} onClick={() => void confirmCancelQuote()}>
                {cancelModal.busy ? 'Đang huỷ...' : 'Xác nhận huỷ'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revokeModal.open ? (
        <div className="qc-modal-backdrop" onClick={() => (!revokeModal.busy ? setRevokeModal({ open: false, quoteId: '', quoteNumber: '', busy: false }) : undefined)}>
          <div className="qc-deal-picker" onClick={event => event.stopPropagation()}>
            <h3>Huỷ công khai {revokeModal.quoteNumber}</h3>
            <p className="qc-workspace-note">Public link của báo giá này sẽ ngừng hoạt động ngay sau khi xác nhận. Báo giá KHÔNG bị xoá, có thể phát hành lại sau.</p>
            <div className="qc-deal-picker-foot">
              <button type="button" className="qc-btn" disabled={revokeModal.busy} onClick={() => setRevokeModal({ open: false, quoteId: '', quoteNumber: '', busy: false })}>
                Đóng
              </button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={revokeModal.busy} onClick={() => void confirmRevokePublic()}>
                {revokeModal.busy ? 'Đang xử lý...' : 'Xác nhận huỷ công khai'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CreateQuoteModal
        open={quoteModal.open}
        deals={deals}
        agents={agents}
        initialDeal={quoteModal.deal}
        editQuote={quoteModal.editQuote}
        initialQuoteFormId={quoteModal.quoteFormId}
        canApproveQuotes={canApproveQuote(user)}
        onClose={() => setQuoteModal({ open: false, deal: null })}
        onCreated={async () => {
          const rows = await seedingQuoteRepository.getQuotes();
          setQuotes(rows);
        }}
        onUpdated={async () => {
          const rows = await seedingQuoteRepository.getQuotes();
          setQuotes(rows);
        }}
      />

      {workspaceQuoteId || workspaceCreateMode ? (
        <QuoteWorkspaceModal
          quoteId={workspaceQuoteId}
          deals={deals}
          dealsById={dealsById}
          agents={agents}
          user={user}
          defaultFormId={defaultFormId}
          quoteForms={forms}
          initialCustomerId={workspacePrefill?.customerId}
          initialProjectId={workspacePrefill?.projectId}
          lockCustomer={Boolean(workspacePrefill?.customerId)}
          lockProject={Boolean(workspacePrefill?.lockProject)}
          onClose={() => {
            setWorkspaceQuoteId(null);
            setWorkspaceCreateMode(false);
            setWorkspacePrefill(null);
          }}
          onChanged={refreshQuotes}
          onEditDraft={quote => setQuoteModal({ open: true, deal: quote.dealId ? dealsById.get(quote.dealId) || null : null, editQuote: quote })}
        />
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, tone, big }: { label: string; value: string; tone: 'rose' | 'blue' | 'green' | 'amber'; big?: boolean }) {
  return (
    <div className="qc-metric">
      <span className={`qc-metric-dot qc-metric-dot-${tone}`} />
      <span className="qc-metric-label">{label}</span>
      <strong className={big ? 'qc-metric-value-lg' : ''}>{value}</strong>
    </div>
  );
}
