'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { seedingQuoteRepository, QuoteApprovalRequiresExceptionError } from '@/modules/quotes';
import type { Quote, QuoteActivityLogEntry, QuoteHandoffChecklist, QuoteItem, QuoteProcessingStage, QuoteApprovalRuleSet, QuoteApprovalRuleType, QuoteRuleEvaluation, QuoteDeliveryLogEntry } from '@/modules/quotes';
import type { AppUser } from '@/types/unified.types';
import { canApproveQuote, canEditQuoteCost, canEditQuotePricingFields, canWriteDeal, formatMoneyInput, getPackageText, getServicePackageText } from '../constants/crmConfig';
import type { CrmUserOption, Deal } from '../types';
import type { ServiceCatalogItem, ServiceCatalogOptions } from '@/modules/service-catalog/types';
import {
  dealBusinessCode,
  formatDate,
  formatMoney,
  initialsOf,
  quoteDisplayStatus,
  relativeTime,
} from '../utils/quoteDisplay';
import { CheckCircle2, Eye, GitBranchPlus, History, Link2, Pencil, Plus, Send, Settings, X } from './icons';
import { usersService, projectsService, type QuoteBusinessRoleUser, type Project } from '@/services/all-platform.service';
import { computeQuoteSla } from '../utils/quoteSla';
import { SearchableSelect } from './SearchableSelect';

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

function newBlockId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `block_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
  /** Mau bao gia dung khi tao record that luc "Luu nhap"/"Gui yeu cau xu ly" -
   * he thong chua co khai niem "mau mac dinh" rieng, dung mau active dau tien
   * (giong hanh vi "Tao bao gia nhanh" hien co). */
  defaultFormId?: string;
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
  const [checklistDraft, setChecklistDraft] = useState<QuoteHandoffChecklist | null>(null);
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
  const [customers, setCustomers] = useState<{ id: string; label: string }[]>([]);
  const [draftDealId, setDraftDealId] = useState('');
  // Du an that (migration 097) - lay theo dung khach hang (draftCustomerId),
  // KHONG theo Co hoi (1 Du an co nhieu Co hoi). "" = "Chua thuoc du an".
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [draftProjectId, setDraftProjectId] = useState(initialProjectId || '');
  // SLA / han hoan tat noi bo that (migration 097) - datetime-local string,
  // KHAC HOAN TOAN validUntil (hieu luc bao gia voi khach hang).
  const [draftSlaDueAt, setDraftSlaDueAt] = useState('');
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
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogOptions, setCatalogOptions] = useState<ServiceCatalogOptions | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
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

  // ── Rule engine duyet bao gia (migration 091) ────────────────────────────
  const [ruleSet, setRuleSet] = useState<QuoteApprovalRuleSet | null>(null);
  const [ruleSetLoaded, setRuleSetLoaded] = useState(false);
  const [ruleEvaluation, setRuleEvaluation] = useState<QuoteRuleEvaluation | null>(null);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleModalDraft, setRuleModalDraft] = useState<Record<QuoteApprovalRuleType, { thresholdValue: string; isRequired: boolean }>>({
    gross_margin_percent: { thresholdValue: '20', isRequired: true },
    gross_profit_amount: { thresholdValue: '5000000', isRequired: true },
    discount_percent: { thresholdValue: '10', isRequired: true },
    payment_terms_days: { thresholdValue: '45', isRequired: true },
  });
  const [ruleModalAutoApprove, setRuleModalAutoApprove] = useState(false);
  const [ruleModalBusy, setRuleModalBusy] = useState(false);
  const [ruleModalError, setRuleModalError] = useState<string | null>(null);
  const [ruleModalIdempotencyKey, setRuleModalIdempotencyKey] = useState('');

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
  const [workspaceToast, setWorkspaceToast] = useState<{ ok: boolean; text: string } | null>(null);

  function showToast(ok: boolean, text: string) {
    setWorkspaceToast({ ok, text });
    window.setTimeout(() => setWorkspaceToast(null), 4000);
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

  function openRuleSettingsModal() {
    if (ruleSet) {
      const draft: typeof ruleModalDraft = { ...ruleModalDraft };
      for (const rule of ruleSet.rules) {
        draft[rule.ruleType] = { thresholdValue: String(rule.thresholdValue), isRequired: rule.isRequired };
      }
      setRuleModalDraft(draft);
      setRuleModalAutoApprove(ruleSet.autoApproveEnabled);
    } else {
      setRuleModalAutoApprove(false);
    }
    setRuleModalError(null);
    setRuleModalIdempotencyKey(`rule-set-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setRuleModalOpen(true);
  }

  const RULE_LABELS: Record<QuoteApprovalRuleType, { label: string; description: string; unit: string }> = {
    gross_margin_percent: { label: 'Gross margin tối thiểu', description: 'Margin = (Giá sau CK − Cost) / Giá sau CK.', unit: '%' },
    gross_profit_amount: { label: 'Lợi nhuận gộp tối thiểu', description: 'Giá bán sau chiết khấu phải tạo đủ gross profit.', unit: 'đ' },
    discount_percent: { label: 'Chiết khấu thương mại tối đa', description: 'Vượt ngưỡng phải chuyển người có quyền duyệt.', unit: '%' },
    payment_terms_days: { label: 'Thời hạn thanh toán tối đa', description: 'Điều khoản dài hơn ngưỡng được xem là ngoại lệ.', unit: 'ngày' },
  };

  async function saveRuleSettings() {
    setRuleModalError(null);
    const rows: { ruleType: QuoteApprovalRuleType; thresholdValue: number; isRequired: boolean }[] = [];
    for (const ruleType of Object.keys(ruleModalDraft) as QuoteApprovalRuleType[]) {
      const raw = ruleModalDraft[ruleType].thresholdValue;
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) {
        setRuleModalError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" phải là số.`);
        return;
      }
      if ((ruleType === 'gross_margin_percent' || ruleType === 'discount_percent') && (value < 0 || value > 100)) {
        setRuleModalError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" phải trong khoảng 0-100.`);
        return;
      }
      if (ruleType === 'gross_profit_amount' && value < 0) {
        setRuleModalError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" không được âm.`);
        return;
      }
      if (ruleType === 'payment_terms_days' && value <= 0) {
        setRuleModalError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" phải lớn hơn 0.`);
        return;
      }
      rows.push({ ruleType, thresholdValue: value, isRequired: ruleModalDraft[ruleType].isRequired });
    }
    setRuleModalBusy(true);
    try {
      const saved = await seedingQuoteRepository.saveQuoteApprovalRuleSet({ rules: rows, autoApproveEnabled: ruleModalAutoApprove, idempotencyKey: ruleModalIdempotencyKey });
      setRuleSet(saved);
      setRuleModalOpen(false);
      showToast(true, 'Đã lưu quy tắc phê duyệt.');
      if (quote?.id) {
        try {
          const evaluation = await seedingQuoteRepository.evaluateQuoteRules(quote.id);
          setRuleEvaluation(evaluation);
        } catch {
          // Khong chan luong luu neu danh gia lai that bai - card se tu load lai lan sau.
        }
      }
    } catch (err) {
      setRuleModalError(err instanceof Error ? err.message : 'Không lưu được quy tắc phê duyệt.');
    } finally {
      setRuleModalBusy(false);
    }
  }

  // Bang "Hang muc & cau truc gia" - state edit LOCAL, dong bo lai tu
  // quote.items moi lan quote thay doi (sau khi load/luu). Luu that qua
  // updateQuote() - RPC quote_update XOA HET roi CHEN LAI toan bo item moi
  // lan goi (khong phai partial update) nen MOI LAN luu deu phai gui DU CA
  // data LAN items hien tai, neu khong se VO TINH XOA SACH item/data con lai
  // (bug thuc te phat hien khi doc lai RPC, khong phai gia dinh).
  const [itemsDraft, setItemsDraft] = useState<QuoteItem[]>([]);
  useEffect(() => {
    setItemsDraft(quote?.items ? quote.items.map(item => ({ ...item })) : []);
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

  function handleCostPriceChange(index: number, raw: string) {
    const cost = toSafeNonNegative(raw);
    setItemsDraft(prev =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (cost === null) return { ...row, costPrice: null, markupPercent: null };
        const markup = row.markupPercent ?? 0;
        return { ...row, costPrice: cost, costNotApplicable: false, markupPercent: markup, unitPrice: cost * (1 + markup / 100) };
      })
    );
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

  function toItemInput(row: QuoteItem): QuoteItem {
    return {
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
    };
  }

  async function persistQuote(overrides: { data?: Quote['data']; items?: QuoteItem[] }) {
    if (!quote) return;
    setBusy(true);
    try {
      const nextItems = overrides.items ?? itemsDraft;
      const updated = await seedingQuoteRepository.updateQuote(quote.id, {
        data: overrides.data ?? quote.data,
        items: nextItems.map(toItemInput),
      });
      setQuote(updated);
      await onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được thay đổi.');
    } finally {
      setBusy(false);
    }
  }

  function addItemRow() {
    setItemsDraft(prev => [
      ...prev,
      { description: '', quantity: 1, unitPrice: 0, vatRate: 10, discountPercent: 0, costPrice: null, markupPercent: null },
    ]);
  }

  function addItemsFromCatalog(items: QuoteItem[]) {
    if (items.length === 0) return;
    const next = [...itemsDraft, ...items];
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next });
    setCatalogModalOpen(false);
  }

  function catalogItemToQuoteItem(item: ServiceCatalogItem): QuoteItem {
    return {
      description: item.description || item.name,
      serviceDescription: item.name,
      unit: item.unit || '',
      quantity: item.specQuantityPerUnit || 1,
      unitPrice: item.defaultUnitPriceVnd || 0,
      discountPercent: item.defaultDiscountPercent || 0,
      vatRate: item.defaultVatRate ?? 10,
      costPrice: null,
      markupPercent: null,
      catalogItemId: item.id,
    };
  }

  async function openCatalogPicker() {
    setCatalogModalOpen(true);
    if (catalogOptions) return;
    const formId = quote?.quoteFormId || defaultFormId;
    if (!formId) return;
    setCatalogLoading(true);
    try {
      const options = await seedingQuoteRepository.getServiceCatalogOptions(formId);
      setCatalogOptions(options);
    } catch {
      setCatalogOptions({ bundles: [], components: [] });
    } finally {
      setCatalogLoading(false);
    }
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
    const cloned = recentDealQuote.items.map(item => ({
      description: item.description,
      serviceDescription: item.serviceDescription,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent ?? 0,
      vatRate: item.vatRate ?? 10,
      costPrice: item.costPrice ?? null,
      markupPercent: item.markupPercent ?? null,
      catalogItemId: item.catalogItemId,
    }));
    const next = [...itemsDraft, ...cloned];
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next });
  }

  function removeItemRow(index: number) {
    const next = itemsDraft.filter((_, i) => i !== index);
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next });
  }

  function applyQuickMarkup(percent: number) {
    const next = itemsDraft.map(row =>
      row.costPrice != null ? { ...row, markupPercent: percent, unitPrice: row.costPrice * (1 + percent / 100) } : row
    );
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next });
  }

  // "Target margin X%" - khac quick markup (khong dua truc tiep tren %) : suy
  // nguoc gia khach tu margin MUON DAT (margin = loi nhuan/gia khach, KHONG
  // phai loi nhuan/cost) - unitPrice = cost / (1 - margin/100). Chi ap cho
  // dong da co gia von, giong quick markup.
  function applyTargetMargin(marginPercent: number) {
    const next = itemsDraft.map(row => {
      if (row.costPrice == null || marginPercent >= 100) return row;
      const unitPrice = row.costPrice / (1 - marginPercent / 100);
      const markupPercent = row.costPrice > 0 ? ((unitPrice - row.costPrice) / row.costPrice) * 100 : 0;
      return { ...row, unitPrice, markupPercent };
    });
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next });
  }

  const [globalDiscount, setGlobalDiscount] = useState('0');
  useEffect(() => {
    setGlobalDiscount(String(itemsDraft[0]?.discountPercent ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

  function applyGlobalDiscount() {
    const pct = Math.max(0, Math.min(100, Number(globalDiscount) || 0));
    const next = itemsDraft.map(row => ({ ...row, discountPercent: pct }));
    setItemsDraft(next);
    if (quote) void persistQuote({ items: next });
  }

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
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } });
  }

  function addTermNote() {
    const text = window.prompt('Nhập điều khoản bổ sung:');
    if (!text || !text.trim()) return;
    if (!quote) {
      setDraftExtraTerms(prev => [...prev, { id: newBlockId(), title: 'Điều khoản bổ sung', content: text.trim() }]);
      return;
    }
    const blocks = [...(quote.data?.customBlocks || []), { id: newBlockId(), kind: 'custom_field' as const, title: 'Điều khoản bổ sung', content: text.trim() }];
    void persistQuote({ data: { ...quote.data, customBlocks: blocks } });
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
  const [editExpectedProducts, setEditExpectedProducts] = useState('');
  useEffect(() => {
    setEditSummary(requestSummaryText);
    setEditScope(scopeBlock?.content || '');
    setEditExpectedProducts(expectedProductsText);
    setScopeEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id]);

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
    });
    setScopeEditing(false);
  }

  const agentsById = useMemo(() => new Map(agents.map(agent => [agent.id, agent.name])), [agents]);
  function nameFor(id?: string | null): string {
    if (!id) return 'Chưa gán';
    if (id === user?.id && user?.name) return user.name;
    return agentsById.get(id) || 'Không rõ';
  }

  async function load(id: string) {
    setLoading(true);
    try {
      const [q, log, hc] = await Promise.all([
        seedingQuoteRepository.getQuote(id),
        seedingQuoteRepository.getQuoteActivityLog(id).catch(() => []),
        seedingQuoteRepository.getQuoteHandoffChecklist(id).catch(() => null),
      ]);
      setQuote(q);
      setActivity(log);
      setChecklist(hc);
      setChecklistDraft(hc);
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
      setChecklistDraft(null);
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
        return body.data as { items?: Array<{ id: string; customer_name?: string; company_name?: string }> };
      })
      .then(data => {
        if (!alive) return;
        setCustomers(
          (data.items || []).map(row => ({
            id: row.id,
            label: `${row.customer_name || 'Khách hàng chưa tên'}${row.company_name ? ' · ' + row.company_name : ''}`,
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
  const deal = quote?.dealId ? dealsById.get(quote.dealId) : draftDealId ? dealsById.get(draftDealId) : undefined;

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

  if (loading) {
    return (
      <div className="qc-modal-backdrop">
        <div className="qc-workspace qc-workspace--loading">Đang tải báo giá...</div>
      </div>
    );
  }

  const status = quote ? quoteDisplayStatus(quote, deal) : { key: 'draft' as const, label: 'Yêu cầu mới', className: 'qc-badge-amber' };
  const canEdit = quote ? canWriteDeal(user, deal) || canApproveQuote(user) : true;
  const canApprove = canApproveQuote(user);
  // Mirror can_manage_quote_approval_rules() o backend - CHI dung de an/hien
  // nut Cai dat, backend van tu chan that (403) neu goi thang API.
  const canManageApprovalRules = user?.role === 'admin' || user?.role === 'leader';
  const businessCode = deal ? dealBusinessCode(deal) : null;
  const opportunityName = deal ? getServicePackageText(deal.servicePackage) || getPackageText(deal.package) : '';
  const stage = quote?.processingStage || 'request';
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
  const canEditCostCells = canEdit && isDraft && !isLockedForReview && canEditQuoteCost(user, quote);
  const canEditPricingCells = canEdit && isDraft && !isLockedForReview && canEditQuotePricingFields(user, quote);
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
    setDraftDealId(dealId);
    const selected = dealId ? dealsById.get(dealId) : undefined;
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
    if (!draftDealId) {
      window.alert('Vui lòng chọn khách hàng / cơ hội CRM.');
      return;
    }
    const content = draftScope.trim() || draftSummary.trim();
    if (submitFully) {
      if (!content) {
        window.alert('Vui lòng nhập tóm tắt nhu cầu hoặc mô tả scope cần estimate.');
        return;
      }
      if (!draftTechnicalOwnerId && !draftQuoteOwnerId) {
        window.alert('Vui lòng chọn ít nhất 1 người phụ trách (kỹ thuật hoặc báo giá).');
        return;
      }
      // Mirror dung dieu kien backend (set_quote_processing_stage,
      // request->technical) - chan SOM o FE, khong de nguoi dung tao xong
      // roi bi loi am tham khi chuyen buoc.
      const slaIso = datetimeLocalValueToIso(draftSlaDueAt);
      if (!slaIso) {
        window.alert('Vui lòng đặt SLA / hạn hoàn tất nội bộ trước khi gửi yêu cầu xử lý.');
        return;
      }
      if (new Date(slaIso).getTime() <= Date.now()) {
        window.alert('SLA / hạn hoàn tất nội bộ phải là thời điểm trong tương lai.');
        return;
      }
    }
    if (!defaultFormId) {
      window.alert('Chưa có mẫu báo giá nào khả dụng để tạo yêu cầu.');
      return;
    }
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
        quoteFormId: defaultFormId,
        projectId: draftProjectId || null,
        slaDueAt: datetimeLocalValueToIso(draftSlaDueAt),
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
        },
        // Hang muc da nhap truoc khi quote that ton tai (che do tao moi) -
        // gui luon cung luc tao, KHONG bat nguoi dung phai luu roi moi duoc
        // nhap hang muc (yeu cau da xac nhan).
        items: itemsDraft.map(toItemInput),
      });
      if (draftTechnicalOwnerId || draftQuoteOwnerId) {
        await seedingQuoteRepository.assignQuoteOwners(created.id, {
          technicalOwnerId: draftTechnicalOwnerId || undefined,
          quoteOwnerId: draftQuoteOwnerId || undefined,
        });
      }
      // "Gui yeu cau xu ly" (submitFully) THAT SU gui yeu cau sang buoc ky
      // thuat - chuyen processing_stage tu 'request' -> 'technical' ngay,
      // khac voi "Luu nhap" (chi tao record o buoc 'request', chua gui di
      // dau). Day la diem khac biet DUY NHAT giua 2 nut, khong chi la
      // validation chat hon.
      if (submitFully) {
        try {
          await seedingQuoteRepository.setQuoteProcessingStage(created.id, 'technical');
        } catch (stageErr) {
          // Da FE-validate SLA truoc do nen it khi roi vao day, nhung neu
          // backend van tu choi vi ly do khac thi PHAI bao cho nguoi dung
          // biet ro (khong am tham nuot loi nua) - record van da tao dung
          // that, nguoi dung van co the tu bam "Gui yeu cau ky thuat" trong
          // workspace sau khi sua.
          window.alert(
            (stageErr instanceof Error ? stageErr.message : 'Không gửi được yêu cầu xử lý.') +
              ' Báo giá đã được lưu — bạn có thể tự bấm "Gửi yêu cầu xử lý" trong workspace sau khi sửa.'
          );
        }
      }
      await onChanged();
      await load(created.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không lưu được yêu cầu hỗ trợ báo giá.');
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (!quote) return;
    await load(quote.id);
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
    setBusy(true);
    try {
      await seedingQuoteRepository.setQuoteProcessingStage(quote!.id, target);
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không chuyển được bước xử lý.');
    } finally {
      setBusy(false);
    }
  }

  async function saveChecklist() {
    if (!checklistDraft) return;
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
    }
  }

  // "Ban giao xu ly gia" gop lam 1 hanh dong duy nhat (khong con buoc "Luu"
  // rieng bat buoc truoc do): tu luu item/gia von dang sua (phong khi nguoi
  // dung go xong bam thang nut ma chua blur khoi o input) + tu luu checklist
  // neu dang co thay doi CHUA luu, roi MOI goi chuyen buoc - that bai o buoc
  // nao dung lai dung buoc do (khong chuyen buoc neu luu that bai), giu nguyen
  // stage 'technical' de nguoi dung sua va thu lai.
  async function handoffToPricing() {
    if (busy || !quote) return;
    if (itemsMissingCost.length > 0) {
      window.alert(`Còn ${itemsMissingCost.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu "Không áp dụng giá vốn". Vui lòng bổ sung trước khi bàn giao.`);
      return;
    }
    setBusy(true);
    try {
      const savedQuote = await seedingQuoteRepository.updateQuote(quote.id, {
        data: quote.data,
        items: itemsDraft.map(toItemInput),
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

      await seedingQuoteRepository.setQuoteProcessingStage(quote.id, 'pricing');
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không bàn giao được sang xử lý giá.');
    } finally {
      setBusy(false);
    }
  }

  async function approveNow() {
    if (busy) return; // chong double-click
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
    }
  }

  async function approveWithExceptionNow() {
    if (busy) return;
    const reason = exceptionApprovalModal.reason.trim();
    if (!reason) {
      window.alert('Vui lòng nhập lý do phê duyệt ngoại lệ.');
      return;
    }
    setBusy(true);
    try {
      await seedingQuoteRepository.approveQuote(quote!.id, reason);
      setExceptionApprovalModal({ open: false, reason: '', evaluation: null });
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không duyệt ngoại lệ được báo giá.');
    } finally {
      setBusy(false);
    }
  }

  async function publishNow() {
    if (busy) return;
    setBusy(true);
    try {
      await seedingQuoteRepository.publishQuote(quote!.id);
      setPublishModalOpen(false);
      await reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không phát hành được báo giá.');
    } finally {
      setBusy(false);
    }
  }

  async function requestChangesNow() {
    if (busy) return;
    if (!requestChangesReason.trim()) {
      window.alert('Vui lòng nhập lý do yêu cầu chỉnh sửa.');
      return;
    }
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
    }
  }

  async function copyPublicLink() {
    if (!quote!.publicUrl) return;
    await navigator.clipboard.writeText(`${window.location.origin}${quote!.publicUrl}`);
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
  const checklistAllConfirmed = Boolean(
    checklistDraft?.scopeConfirmed && checklistDraft?.costConfirmed && checklistDraft?.timelineConfirmed && checklistDraft?.assumptionConfirmed
  );
  // Hang muc "thieu gia von" = chua nhap costPrice VA chua tick "khong ap
  // dung" - dung DUNG dieu kien RPC quote_set_processing_stage (migration
  // 090) validate ('quote_item_missing_cost_price') de nut FE disable/thong
  // bao KHOP voi that su backend se chan hay khong (khong doan mo ho).
  const itemsMissingCost = itemsDraft.filter(item => !item.costNotApplicable && item.costPrice == null);
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

  return (
    <div className="qc-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="qc-workspace">
        <header className="qc-workspace-header">
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
          <div className="qc-workspace-header-actions">
            <button
              type="button"
              className="qc-btn"
              disabled={versionButtonState.disabled || busy}
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
            {quote && isDraft && canEdit ? (
              <button
                type="button"
                className="qc-btn"
                onClick={() => {
                  onEditDraft(quote);
                  onClose();
                }}
              >
                Chỉnh sửa / Lưu nháp
              </button>
            ) : null}
            {!quote ? (
              <button type="button" className="qc-btn" disabled={busy} onClick={() => void createRequest(false)}>
                Lưu nháp
              </button>
            ) : null}
            <button type="button" className="qc-btn" onClick={onClose}>
              ← Danh sách
            </button>
            <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={onClose}>
              <X className="qc-inline-icon" />
            </button>
          </div>
        </header>

        <div className="qc-workspace-stages">
          {STAGE_ORDER.map((s, index) => {
            const state = stageState(s);
            const owner = stageOwnerName(s);
            const time = stageTimeLabel(s);
            const meta = [owner, time].filter(Boolean).join(' · ');
            return (
              <div className={`qc-stagebar-step qc-stagebar-step--${state}`} key={s}>
                <span className="qc-stagebar-circle">{state === 'done' ? '✓' : index + 1}</span>
                <span className="qc-stagebar-text">
                  <span className="qc-stagebar-label">{stageLabel(s)}</span>
                  {meta ? <span className="qc-stagebar-meta">{meta}</span> : null}
                </span>
                {index < STAGE_ORDER.length - 1 ? <span className="qc-stagebar-connector" aria-hidden="true" /> : null}
              </div>
            );
          })}
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
                  if (draftDealId && dealsById.get(draftDealId)?.customerId !== value) setDraftDealId('');
                  // Du an cung thuoc DUNG 1 khach hang - doi khach hang thi bo
                  // chon Du an cu (se nap lai danh sach Du an moi qua effect).
                  setDraftProjectId('');
                }}
                options={customers.map(c => ({ value: c.id, label: c.label }))}
                placeholder="Chọn khách hàng..."
              />
            ) : (
              <strong>{deal?.customerName || 'Chưa gắn cơ hội'}</strong>
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
                  onChange={value => (quote ? void updateQuoteProject(value) : setDraftProjectId(value))}
                  options={[
                    { value: '', label: 'Chưa thuộc dự án' },
                    ...projects.map(p => ({ value: p.id, label: `${p.projectCode} · ${p.name}` })),
                  ]}
                  placeholder="Chưa thuộc dự án"
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
                options={deals
                  .filter(d => !draftCustomerId || d.customerId === draftCustomerId)
                  // Toi tu 1 Project card cu the (lockProject) - Co hoi CHI
                  // hien dung cua Project do, khong phai moi Co hoi cua Khach hang.
                  .filter(d => !lockProject || !draftProjectId || d.projectId === draftProjectId)
                  .map(d => ({ value: d.id, label: `${d.customerName}${d.companyName ? ' · ' + d.companyName : ''}` }))}
                placeholder="Chọn cơ hội..."
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
                <strong>{businessCode || (deal ? 'Cơ hội chưa có mã' : 'Chưa gắn cơ hội')}</strong>
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
          <div>
            <span className="qc-workspace-info-label">Người phụ trách kỹ thuật</span>
            {!quote || (isDraft && canEdit) ? (
              presaleUsers === null ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải danh sách Presale…</span>
              ) : presaleUsers.length === 0 ? (
                <NoStaffConfigured isAdminOrLeader={canManageApprovalRules} />
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
            <span className="qc-workspace-info-label">Người phụ trách báo giá</span>
            {!quote || (isDraft && canEdit) ? (
              saleUsers === null ? (
                <span className="qc-workspace-muted" style={{ fontSize: 12 }}>Đang tải danh sách Sale…</span>
              ) : saleUsers.length === 0 ? (
                <NoStaffConfigured isAdminOrLeader={canManageApprovalRules} />
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
            <span className="qc-workspace-info-label">Quản lý</span>
            <strong>{deal?.assignment.leadName || 'Chưa gán'}</strong>
          </div>
          <div>
            <span className="qc-workspace-info-label">Team</span>
            <strong>{deal?.teamName || (deal ? 'Chưa gán' : 'Chưa chọn khách hàng')}</strong>
          </div>
          <div>
            <span className="qc-workspace-info-label" title="Hạn xử lý NỘI BỘ - khác hoàn toàn 'Hiệu lực đến' (hiệu lực báo giá với khách hàng)">
              SLA / Hạn hoàn tất nội bộ
            </span>
            {!quote ? (
              <input
                type="datetime-local"
                className="qc-cell-input"
                value={draftSlaDueAt}
                onChange={e => setDraftSlaDueAt(e.target.value)}
              />
            ) : stage === 'request' && canEdit ? (
              <input
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
          {quote?.validUntil ? (
            <div>
              <span className="qc-workspace-info-label">Hiệu lực đến</span>
              <strong>{formatDate(quote.validUntil)}</strong>
            </div>
          ) : null}
        </div>

        <div className="qc-workspace-body" ref={workspaceBodyRef}>
          <div className="qc-workspace-main">
            {!quote ? (
              <div className="qc-workspace-card" data-qc-anchor="scope" data-testid="qc-scope-card">
                <div className="qc-workspace-card-head">
                  <h3 data-testid="qc-scope-card-title">Yêu cầu &amp; phạm vi công việc</h3>
                  {autofillMessage ? <span className="qc-workspace-autofill-toast">{autofillMessage}</span> : null}
                </div>
                <div className="qc-workspace-request-form">
                  <div className="qc-workspace-request-form-cols">
                    <label>
                      <span className="qc-workspace-info-label">Tóm tắt nhu cầu của khách</span>
                      <textarea
                        className="qc-workspace-handoff-note"
                        rows={3}
                        value={draftSummary}
                        onChange={event => setDraftSummary(event.target.value)}
                        placeholder={draftDealId ? 'Cơ hội chưa có mô tả nhu cầu — tự nhập tại đây.' : 'Khách cần gì, bối cảnh yêu cầu...'}
                      />
                    </label>
                    <label>
                      <span className="qc-workspace-info-label">Mô tả scope / yêu cầu cần estimate</span>
                      <textarea className="qc-workspace-handoff-note" rows={3} value={draftScope} onChange={event => setDraftScope(event.target.value)} placeholder="Phạm vi công việc cần kỹ thuật estimate..." />
                    </label>
                  </div>
                  <details className="qc-workspace-request-more">
                    <summary>Sản phẩm dự kiến / Ghi chú nội bộ (tuỳ chọn)</summary>
                    <label>
                      <span className="qc-workspace-info-label">Sản phẩm / dịch vụ dự kiến (nếu có)</span>
                      <input
                        type="text"
                        className="crm-input"
                        value={draftExpectedProducts}
                        onChange={event => setDraftExpectedProducts(event.target.value)}
                        placeholder={draftDealId ? 'Chưa có sản phẩm/dịch vụ — tự nhập tại đây.' : 'Ví dụ: Gói VPS Cloud, dịch vụ tư vấn...'}
                      />
                    </label>
                    <label>
                      <span className="qc-workspace-info-label">Ghi chú nội bộ (không hiện cho khách)</span>
                      <textarea className="qc-workspace-handoff-note" rows={2} value={draftInternalNote} onChange={event => setDraftInternalNote(event.target.value)} placeholder="Ghi chú riêng cho đội xử lý..." />
                    </label>
                    <p className="qc-workspace-note">Chưa hỗ trợ tệp đính kèm.</p>
                  </details>
                </div>
              </div>
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

                      <div className="qc-workspace-card">
                        <h3>Hạng mục &amp; giá khách</h3>
                        {rootItems.length === 0 ? (
                          <p className="qc-workspace-muted">Chưa có hạng mục nào.</p>
                        ) : (
                          <div className="qc-table-wrap">
                            <table className="qc-linked-table">
                              <thead>
                                <tr>
                                  <th>#</th><th>Hạng mục</th><th>Mô tả</th><th>ĐVT</th><th>SL</th>
                                  <th className="qc-th-money">Đơn giá</th><th>CK</th><th>VAT</th><th className="qc-th-money">Thành tiền</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rootItems.map((item, idx) => (
                                  <tr key={item.id || idx}>
                                    <td>{idx + 1}</td>
                                    <td>{item.serviceDescription || '—'}</td>
                                    <td>{item.description || '—'}</td>
                                    <td>{item.unit || '—'}</td>
                                    <td>{item.quantity}</td>
                                    <td className="qc-cell-money">{formatMoney(item.unitPrice)}</td>
                                    <td>{item.discountPercent ? `${item.discountPercent}%` : '—'}</td>
                                    <td>{item.vatRate}%</td>
                                    <td className="qc-cell-money">{formatMoney(item.totalAmount || 0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      <div className="qc-workspace-card">
                        <h3>Tổng hợp giá</h3>
                        <div className="qc-summary-grid qc-summary-grid--2col">
                          <div className="qc-workspace-card">
                            <div><span className="qc-workspace-info-label">Điều khoản thanh toán</span><strong>{paymentTermsBlock?.content || 'Chưa có điều khoản'}</strong></div>
                            <div><span className="qc-workspace-info-label">Hiệu lực báo giá</span><strong>{quote.validUntil ? formatDate(quote.validUntil) : 'Chưa đặt'}</strong></div>
                            <div><span className="qc-workspace-info-label">Phạm vi công việc</span><strong>{scopeBlock?.content || 'Chưa mô tả'}</strong></div>
                          </div>
                          <div>
                            <div><span className="qc-workspace-info-label">Trước chiết khấu</span><strong>{formatMoney(quote.subtotalAmount)}</strong></div>
                            <div><span className="qc-workspace-info-label">VAT</span><strong>{formatMoney(quote.vatAmount)}</strong></div>
                            <div><span className="qc-workspace-info-label">Khách thanh toán</span><strong>{formatMoney(quote.totalAmount)}</strong></div>
                          </div>
                        </div>
                      </div>

                      <div className="qc-workspace-card">
                        <h3>Phê duyệt &amp; version</h3>
                        <div className="qc-summary-grid">
                          <div><span className="qc-workspace-info-label">Version hiện tại</span><strong>V{quote.versionNumber || 1}</strong></div>
                          <div><span className="qc-workspace-info-label">Kết quả Rule Engine</span><strong>{ruleEvaluation ? (ruleEvaluation.result === 'pass' ? 'Đạt' : ruleEvaluation.result === 'fail' ? 'Không đạt' : 'Chưa đủ dữ liệu') : 'Chưa đánh giá'}</strong></div>
                          <div><span className="qc-workspace-info-label">Phê duyệt</span><strong>{ruleEvaluation?.autoApproveEnabled ? 'Tự động duyệt' : 'Duyệt thủ công'}</strong></div>
                          <div><span className="qc-workspace-info-label">Trạng thái public link</span><strong>{quote.publicEnabled ? 'Đang bật' : 'Chưa bật'}</strong></div>
                        </div>
                      </div>

                      {quote.processingStage === 'published' ? (
                        <div className="qc-workspace-card">
                          <h3>{quote.sentAt ? 'Thông tin gửi khách' : 'Thông tin phát hành'}</h3>
                          <div className="qc-summary-grid">
                            <div><span className="qc-workspace-info-label">Public URL</span><strong>{quote.publicUrl || '—'}</strong></div>
                            <div><span className="qc-workspace-info-label">Người phát hành</span><strong>{quote.publishedById ? nameFor(quote.publishedById) : '—'}</strong></div>
                            <div><span className="qc-workspace-info-label">Ngày phát hành</span><strong>{quote.publishedAt ? formatDate(quote.publishedAt) : '—'}</strong></div>
                            {quote.sentAt ? (
                              <>
                                <div><span className="qc-workspace-info-label">Người gửi</span><strong>{quote.sentById ? nameFor(quote.sentById) : '—'}</strong></div>
                                <div><span className="qc-workspace-info-label">Ngày gửi</span><strong>{formatDate(quote.sentAt)}</strong></div>
                                <div><span className="qc-workspace-info-label">SLA</span><strong style={{ color: sla.tone === 'danger' ? '#b3261e' : sla.tone === 'success' ? '#148e61' : undefined }}>{sla.label}</strong></div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </>
            ) : (
              <div className="qc-workspace-card" data-qc-anchor="scope" data-testid="qc-scope-card">
                <div className="qc-workspace-card-head">
                  <h3 data-testid="qc-scope-card-title">{scopeCardLabel(stage)}</h3>
                  {canEdit && isDraft ? (
                    <button type="button" className="qc-mini-btn" onClick={() => setScopeEditing(v => !v)}>
                      {scopeEditing ? 'Đóng' : <><Pencil className="qc-inline-icon" /> Chỉnh sửa</>}
                    </button>
                  ) : null}
                </div>
                {scopeEditing ? (
                  <>
                    <div className="qc-workspace-request-form-cols">
                      <label>
                        <span className="qc-workspace-info-label">Tóm tắt nhu cầu của khách hàng</span>
                        <textarea className="qc-workspace-handoff-note" rows={3} value={editSummary} onChange={event => setEditSummary(event.target.value)} />
                      </label>
                      <label>
                        <span className="qc-workspace-info-label">Phạm vi công việc (scope)</span>
                        <textarea className="qc-workspace-handoff-note" rows={3} value={editScope} onChange={event => setEditScope(event.target.value)} />
                      </label>
                    </div>
                    <label>
                      <span className="qc-workspace-info-label">Sản phẩm/dịch vụ dự kiến</span>
                      <input type="text" className="crm-input" value={editExpectedProducts} onChange={event => setEditExpectedProducts(event.target.value)} placeholder="Chưa có sản phẩm/dịch vụ..." />
                    </label>
                    <div className="qc-workspace-modal-actions">
                      <button type="button" className="qc-btn" onClick={() => setScopeEditing(false)}>Huỷ</button>
                      <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => void saveScopeSummary()}>Lưu</button>
                    </div>
                  </>
                ) : (
                  <div className="qc-workspace-scope-summary">
                    <div>
                      <span className="qc-workspace-info-label">Tóm tắt nhu cầu của khách hàng</span>
                      <p>{requestSummaryText || 'Chưa có tóm tắt.'}</p>
                    </div>
                    <div>
                      <span className="qc-workspace-info-label">Phạm vi công việc (scope)</span>
                      <p>{scopeBlock?.content || 'Chưa mô tả scope.'}</p>
                    </div>
                    <div>
                      <span className="qc-workspace-info-label">Sản phẩm/dịch vụ dự kiến</span>
                      <p>{expectedProductsText || 'Chưa có sản phẩm/dịch vụ.'}</p>
                    </div>
                    {deal?.estimatedBudget ? (
                      <div>
                        <span className="qc-workspace-info-label">Giá trị dự kiến</span>
                        <p>{formatMoney(deal.estimatedBudget)}</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
            <div className="qc-workspace-card" data-qc-anchor="items">
              <div className="qc-workspace-card-head">
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

              {canEditCostCells && isDraft && itemsDraft.length > 0 && itemsMissingCost.length > 0 ? (
                <div className="qc-workspace-warning-banner">
                  Còn {itemsMissingCost.length}/{itemsDraft.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu &quot;Không áp dụng giá vốn&quot; — cần bổ sung trước khi bàn giao.
                </div>
              ) : null}
              {canEditPricingCells && isDraft ? (
                <div className="qc-workspace-quickbar">
                  <span className="qc-workspace-quickbar-rule" title="Chỉ 1 ngưỡng tĩnh, chưa phải rule engine tự động chặn/tự duyệt thật (thuộc Phase 3)">
                    Quy tắc kiểm tra · Ngưỡng margin tham chiếu: 20%
                  </span>
                  <span className="qc-workspace-quickbar-sep" />
                  <span className="qc-workspace-info-label">Áp nhanh markup</span>
                  {[15, 20, 25, 30].map(pct => (
                    <button key={pct} type="button" className="qc-mini-btn" disabled={busy} onClick={() => applyQuickMarkup(pct)}>
                      +{pct}%
                    </button>
                  ))}
                  <button type="button" className="qc-mini-btn" disabled={busy} onClick={() => applyTargetMargin(25)}>
                    Target margin 25%
                  </button>
                  <span className="qc-workspace-quickbar-sep" />
                  <label className="qc-workspace-quickbar-field">
                    CK tổng
                    <input
                      type="number"
                      className="qc-workspace-quickbar-input"
                      value={globalDiscount}
                      onChange={event => setGlobalDiscount(event.target.value)}
                      onBlur={applyGlobalDiscount}
                    />
                    %
                  </label>
                  <label className="qc-workspace-quickbar-field">
                    Thanh toán
                    <select
                      className="qc-workspace-quickbar-input"
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
                  <button type="button" className="qc-mini-btn" onClick={addTermNote}>+ Điều khoản</button>
                  {!quote ? <span className="qc-workspace-quickbar-hint">Lưu tạm — sẽ ghi thật khi tạo yêu cầu</span> : null}
                </div>
              ) : null}
              {!quote && draftExtraTerms.length > 0 ? (
                <ul className="qc-workspace-draft-terms">
                  {draftExtraTerms.map(t => (
                    <li key={t.id}>{t.title}: {t.content}</li>
                  ))}
                </ul>
              ) : null}

              {/* Bang THONG NHAT: Cost (Presale) + Pricing (Sale) tren CUNG 1
                  dong, khong con tab rieng - dung yeu cau "Sale phai doi chieu
                  duoc cost va markup cung dong". overflow-x rieng cho bang
                  (khong lam vo trang) - xem .qc-table-wrap trong quote-center.css. */}
              <div className="qc-table-wrap">
                <table className={`qc-linked-table qc-workspace-items-table qc-workspace-items-table--unified${itemsDraft.length > 0 ? ' qc-workspace-items-table--has-rows' : ''}`}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Hạng mục</th>
                      <th className="qc-th-money">SL</th>
                      <th className="qc-th-money qc-th-cost">Giá vốn/ĐV</th>
                      <th className="qc-th-money qc-th-cost">Giá vốn</th>
                      <th className="qc-th-cost-flag">N/A giá vốn</th>
                      <th className="qc-th-money qc-th-markup">Markup</th>
                      <th className="qc-th-money qc-th-markup">Giá khách/ĐV</th>
                      <th className="qc-th-money">Thành tiền</th>
                      <th className="qc-th-money">Margin</th>
                      {canEdit && isDraft && !isLockedForReview ? <th className="qc-th-actions">Thao tác</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {itemsDraft.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="qc-empty">
                          <div className="qc-workspace-items-empty">
                            <span>Chưa có hạng mục nào.</span>
                            {canEdit && isDraft && !isLockedForReview ? (
                              <div className="qc-workspace-items-empty-actions">
                                <button type="button" className="qc-mini-btn qc-mini-btn-brand" onClick={addItemRow}>
                                  Thêm hạng mục
                                </button>
                                <button type="button" className="qc-mini-btn" onClick={() => void openCatalogPicker()}>
                                  Chọn từ danh mục
                                </button>
                                {recentDealQuote ? (
                                  <button type="button" className="qc-mini-btn" onClick={loadFromRecentQuote}>
                                    Nạp từ báo giá gần nhất ({recentDealQuote.quoteNumber})
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      itemsDraft.map((item, index) => {
                        const margin = item.costPrice != null && item.unitPrice > 0 ? ((item.unitPrice - item.costPrice) / item.unitPrice) * 100 : null;
                        const costTotal = item.costPrice != null ? item.costPrice * item.quantity : null;
                        const editableTechnicalCells = canEditCostCells;
                        const editableCells = canEditPricingCells;
                        return (
                          <tr key={item.id || index}>
                            <td>{index + 1}</td>
                            <td>
                              {(editableTechnicalCells || editableCells) ? (
                                <input className="qc-cell-input" value={item.serviceDescription || ''} onChange={e => updateRow(index, { serviceDescription: e.target.value })} onBlur={() => void persistQuote({})} placeholder="Tên hạng mục" />
                              ) : (
                                item.serviceDescription || '—'
                              )}
                            </td>
                            <td className="qc-cell-money">
                              {editableTechnicalCells ? (
                                <input type="number" className="qc-cell-input qc-cell-input-money" value={item.quantity} onChange={e => updateRow(index, { quantity: Math.max(0, Number(e.target.value) || 0) })} onBlur={() => void persistQuote({})} />
                              ) : item.quantity}
                            </td>
                            <td className={`qc-cell-money qc-cell-cost ${!item.costNotApplicable && item.costPrice == null ? 'qc-cell-cost-missing' : ''}`} title={!editableTechnicalCells && costViewAllowed ? 'Presale đã chốt — chỉ đọc' : undefined}>
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
                                  onBlur={() => void persistQuote({})}
                                />
                              ) : (
                                <>
                                  {item.costNotApplicable ? 'Không áp dụng' : item.costPrice != null ? formatMoney(item.costPrice) : 'Còn thiếu'}
                                  {!editableTechnicalCells && (item.costPrice != null || item.costNotApplicable) ? <span className="qc-row-sub"> · đã chốt</span> : null}
                                </>
                              )}
                            </td>
                            <td className="qc-cell-money qc-cell-cost">
                              {!costViewAllowed ? <span className="qc-row-sub">Không có quyền xem</span> : item.costNotApplicable ? '—' : costTotal != null ? formatMoney(costTotal) : '—'}
                            </td>
                            <td className="qc-cell-cost-flag">
                              {!costViewAllowed ? (
                                '—'
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.costNotApplicable)}
                                  disabled={!editableTechnicalCells}
                                  onChange={e => handleCostNotApplicableChange(index, e.target.checked)}
                                />
                              )}
                            </td>
                            <td className="qc-cell-money qc-cell-markup">
                              {!pricingViewAllowed ? (
                                <span className="qc-row-sub">Không có quyền xem</span>
                              ) : editableCells ? (
                                <input type="number" className="qc-cell-input qc-cell-input-money" value={item.markupPercent ?? ''} placeholder="—" disabled={item.costPrice == null} onChange={e => handleMarkupChange(index, e.target.value)} onBlur={() => void persistQuote({})} />
                              ) : (item.markupPercent != null ? `${item.markupPercent.toFixed(1)}%` : '—')}
                            </td>
                            <td className="qc-cell-money qc-cell-markup">
                              {editableCells ? (
                                <input type="number" className="qc-cell-input qc-cell-input-money" value={item.unitPrice} onChange={e => handleUnitPriceChange(index, e.target.value)} onBlur={() => void persistQuote({})} />
                              ) : formatMoney(item.unitPrice)}
                            </td>
                            <td className="qc-cell-money">{formatMoney(item.totalAmount || item.quantity * item.unitPrice || 0)}</td>
                            <td className={`qc-cell-money ${margin != null && margin >= 20 ? 'qc-cell-margin-good' : margin != null ? 'qc-cell-margin-warn' : ''}`}>
                              {!profitabilityViewAllowed ? <span className="qc-row-sub">Không có quyền xem</span> : margin != null ? `${margin.toFixed(2)}%` : '—'}
                            </td>
                            {canEdit && isDraft && !isLockedForReview ? (
                              <td className="qc-cell-actions">
                                <button type="button" className="qc-row-remove" title="Xoá hạng mục" onClick={() => removeItemRow(index)}>×</button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {canEdit && isDraft && !isLockedForReview && itemsDraft.length > 0 ? (
                <div className="qc-workspace-add-row">
                  <button type="button" className="qc-mini-btn" onClick={addItemRow}>
                    Thêm hạng mục
                  </button>
                  <button type="button" className="qc-mini-btn" onClick={() => void openCatalogPicker()}>Chọn từ danh mục</button>
                </div>
              ) : null}

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
                    {!profitabilityViewAllowed ? 'Không có quyền xem' : hasCostData && quote!.grossMarginPercent != null ? `${quote!.grossMarginPercent.toFixed(2)}%` : 'Chưa có dữ liệu'}
                  </strong>
                </div>
              </div>
            </div>

            {stage === 'technical' ? (
              <div className="qc-workspace-card">
                <div className="qc-workspace-card-head">
                  <h3>Bàn giao kỹ thuật → người phụ trách báo giá</h3>
                  <div className="qc-workspace-card-head-badges">
                    {checklistDirty ? <span className="qc-badge qc-badge-amber">Có thay đổi chưa lưu</span> : null}
                    <span className={`qc-badge ${handoffBadge === 'Đã bàn giao' ? 'qc-badge-green' : handoffBadge === 'Cần bổ sung' ? 'qc-badge-amber' : 'qc-badge-rose'}`}>
                      {handoffBadge}
                    </span>
                  </div>
                </div>
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
                        disabled={!quote || !canEdit || !isDraft}
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
                          disabled={!quote || !canEdit || !isDraft}
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
                    disabled={!quote || !canEdit || !isDraft}
                    onChange={event => setChecklistDraft(prev => (prev ? { ...prev, handoffNote: event.target.value } : prev))}
                  />
                </div>
              </div>
            ) : stage === 'request' ? (
              <div className="qc-workspace-card qc-readiness-card">
                <div className="qc-workspace-card-head">
                  <h3>Chuẩn bị gửi Presale</h3>
                </div>
                <ul className="qc-readiness-list">
                  {([
                    ['Khách hàng đã chọn', Boolean(deal?.customerId || draftCustomerId), 'top'],
                    ['Dự án đã chọn hoặc xác nhận không có', true, 'top'],
                    ['Cơ hội đã chọn hoặc xác nhận không có', Boolean(quote?.dealId || draftDealId), 'top'],
                    ['Presale đã gán', Boolean(quote?.technicalOwnerId || draftTechnicalOwnerId), 'top'],
                    ['Sale đã gán', Boolean(quote?.quoteOwnerId || draftQuoteOwnerId), 'top'],
                    ['SLA đã nhập', Boolean(quote?.slaDueAt || draftSlaDueAt), 'top'],
                    ['Tóm tắt yêu cầu/phạm vi đã nhập', Boolean(requestSummaryText || scopeBlock?.content || draftSummary || draftScope), 'scope'],
                    ['Có ít nhất 1 hạng mục dự kiến', itemsDraft.length > 0, 'items'],
                  ] as const).map(([label, done, anchor]) => (
                    <li key={label} className={`qc-readiness-item ${done ? 'is-done' : 'is-missing'}`}>
                      <span className="qc-readiness-status">{done ? 'Có' : 'Chưa'}</span>
                      <span className="qc-readiness-label">{label}</span>
                      {!done ? (
                        <button type="button" className="qc-mini-btn" onClick={() => jumpToAnchor(anchor)}>Bổ sung</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {stage === 'request' ? (
              <div className="qc-workspace-card" data-qc-anchor="top">
                <h3>Phân công &amp; SLA</h3>
                <div className="qc-workspace-summary-row">
                  <span>Presale</span>
                  <strong>{ownerNameFor(quote ? quote.technicalOwnerId : draftTechnicalOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Sale</span>
                  <strong>{ownerNameFor(quote ? quote.quoteOwnerId : draftQuoteOwnerId)}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>Dự án</span>
                  <strong>{(projects || []).find(p => p.id === (quote ? quote.projectId : draftProjectId))?.name || 'Chưa thuộc dự án'}</strong>
                </div>
                <div className="qc-workspace-summary-row">
                  <span>SLA / hạn hoàn tất nội bộ</span>
                  <strong>{(quote ? quote.slaDueAt : draftSlaDueAt) ? formatDate(quote ? quote.slaDueAt! : new Date(draftSlaDueAt).toISOString()) : 'Chưa đặt SLA'}</strong>
                </div>
                <p className="qc-workspace-note">Các trường này chỉnh sửa trực tiếp ở khu vực thông tin phía trên (Khách hàng/Dự án/Cơ hội/Presale/Sale/SLA).</p>
              </div>
            ) : null}

            {stage === 'pricing' ? (
              <div className="qc-workspace-card">
                <div className="qc-workspace-card-head">
                  <h3>Chuẩn bị hoàn tất giá bán</h3>
                </div>
                <ul className="qc-readiness-list">
                  {([
                    ['Tất cả hạng mục đã có giá bán', itemsDraft.length > 0 && itemsDraft.every(i => (i.unitPrice || 0) > 0)],
                    ['Đã có điều khoản thanh toán', Boolean(paymentTermsBlock)],
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
                <ul className="qc-workspace-activity">
                  {activity.length === 0 ? (
                    <li className="qc-workspace-muted">{quote ? 'Chưa có hoạt động nào.' : 'Yêu cầu chưa được lưu.'}</li>
                  ) : null}
                  {activity.map(entry => (
                    <li key={entry.id}>
                      <strong>{nameFor(entry.actorId)}</strong> {activityLogTail(entry)}
                      <div className="qc-row-sub">{relativeTime(entry.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <aside className="qc-workspace-side">
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
                  <span>Margin {quote.grossMarginPercent.toFixed(2)}%</span>
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
                {canManageApprovalRules ? (
                  <button type="button" className="qc-mini-btn qc-rule-settings-btn" onClick={openRuleSettingsModal}>
                    <Settings className="qc-icon" /> Cài đặt
                  </button>
                ) : null}
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
                  {canManageApprovalRules ? 'Bấm "Cài đặt" để thiết lập quy tắc phê duyệt.' : 'Chưa có quy tắc phê duyệt nào được cấu hình.'}
                </p>
              )}
            </div>
            ) : null}

            {stage === 'review' ? (
            <div className="qc-workspace-card qc-workspace-actions">
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={!canPreview}
                title={previewDisabledReason}
                onClick={() => setPreviewModalOpen(true)}
              >
                <Eye className="qc-icon" /> Xem bản khách hàng
              </button>
              <button
                type="button"
                className="qc-btn qc-btn-send"
                disabled={Boolean(sendDisabledReason)}
                title={sendDisabledReason}
                onClick={() => void openSendModal()}
              >
                <Send className="qc-icon" /> Gửi khách hàng
              </button>
              {quote?.status === 'approved' && quote.publicUrl ? (
                <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                  <Link2 className="qc-icon" /> Sao chép link báo giá
                </button>
              ) : null}
            </div>
            ) : null}

            {stage === 'request' || stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Kiểm tra dữ liệu</h3>
              <ul className="qc-workspace-checks">
                <li className={deal ? 'ok' : 'pending'}>Đã có thông tin khách hàng</li>
                <li className={rootItems.length > 0 ? 'ok' : 'pending'}>Đã có hạng mục và chi phí</li>
                <li className={hasCostData ? 'ok' : 'pending'}>Đã nhập giá bán/markup</li>
                <li className={paymentTermsBlock ? 'ok' : 'pending'}>Đã có điều khoản thanh toán</li>
                <li className={draftScope.trim() || quote?.data?.customBlocks?.some(b => b.kind === 'scope_of_work' && b.content.trim()) ? 'ok' : 'pending'}>Đã mô tả phạm vi công việc</li>
                <li className={checklistAllConfirmed ? 'ok' : 'pending'}>Checklist bàn giao đầy đủ</li>
              </ul>
              {marginBelowThreshold ? (
                <div className="qc-workspace-note-box qc-workspace-note-box--warn">
                  Cảnh báo: margin {quote?.grossMarginPercent?.toFixed(2)}% dưới ngưỡng tham chiếu 20%.
                </div>
              ) : null}
            </div>
            ) : null}

            {stage === 'request' || stage === 'pricing' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>Preview khách hàng</h3>
              {canPreview ? (
                <button type="button" className="qc-workspace-preview qc-workspace-preview--clickable" onClick={() => setPreviewModalOpen(true)}>
                  <div className="qc-workspace-preview-title">{quote ? quote.quoteNumber : 'Bản xem trước'}</div>
                  {itemsDraft.map((item, index) => (
                    <div className="qc-workspace-preview-line" key={item.id || index}>{item.description || 'Hạng mục chưa đặt tên'}</div>
                  ))}
                  <div className="qc-workspace-preview-total">
                    Tổng sau VAT: {formatMoney(quote ? quote.totalAmount : itemsDraft.reduce((sum, i) => sum + (i.quantity * i.unitPrice || 0), 0))}
                  </div>
                </button>
              ) : (
                <div className="qc-workspace-preview qc-workspace-preview--empty">
                  Thêm khách hàng và hạng mục để xem trước.
                </div>
              )}
              <p className="qc-workspace-note">Preview ẩn hoàn toàn giá vốn, markup, margin và ghi chú nội bộ.</p>
            </div>
            ) : null}

            {stage === 'request' || stage === 'technical' || stage === 'review' ? (
            <div className="qc-workspace-card">
              <h3>{stage === 'request' ? 'Activity ngắn' : 'Activity & handoff'}</h3>
              <ul className="qc-workspace-activity">
                {activity.length === 0 ? (
                  <li className="qc-workspace-muted">{quote ? 'Chưa có hoạt động nào.' : 'Yêu cầu chưa được lưu.'}</li>
                ) : null}
                {(stage === 'request' ? activity.slice(0, 3) : activity).map(entry => (
                  <li key={entry.id}>
                    <strong>{nameFor(entry.actorId)}</strong> {ACTIVITY_LABELS[entry.action] || entry.action}
                    <div className="qc-row-sub">{relativeTime(entry.createdAt)}</div>
                  </li>
                ))}
              </ul>
            </div>
            ) : null}
          </aside>
        </div>

        <div className="qc-workspace-footer">
          {!quote ? (
            <>
              <button type="button" className="qc-btn" onClick={onClose}>Huỷ</button>
              <button type="button" className="qc-btn" disabled={busy} onClick={() => void createRequest(false)}>
                Lưu nháp
              </button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !draftSlaDueAt}
                title={!draftSlaDueAt ? 'Cần đặt SLA / hạn hoàn tất nội bộ trước khi gửi yêu cầu xử lý' : undefined}
                onClick={() => void createRequest(true)}
              >
                Gửi yêu cầu xử lý
              </button>
            </>
          ) : !isDraft ? (
            <>
              <button type="button" className="qc-btn" onClick={onClose}>← Danh sách</button>
              {quote.status === 'approved' ? (
                <>
                  <button type="button" className="qc-btn" disabled={!canPreview} title={previewDisabledReason} onClick={() => setPreviewModalOpen(true)}>
                    <Eye className="qc-icon" /> Xem bản khách hàng
                  </button>
                  {quote.processingStage === 'published' ? (
                    <>
                      {quote.publicEnabled ? (
                        <button type="button" className="qc-btn" onClick={() => void copyPublicLink()}>
                          <Link2 className="qc-icon" /> Sao chép link báo giá
                        </button>
                      ) : null}
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
              <button type="button" className="qc-btn" onClick={onClose}>← Danh sách</button>
              {stage === 'request' && canEdit ? (
                <button
                  type="button"
                  className="qc-btn qc-btn-primary"
                  disabled={busy || !quote?.slaDueAt}
                  title={!quote?.slaDueAt ? 'Cần đặt SLA / hạn hoàn tất nội bộ trước khi gửi yêu cầu xử lý' : undefined}
                  onClick={() => void advanceStage('technical')}
                >
                  Gửi yêu cầu xử lý
                </button>
              ) : null}
              {stage === 'technical' && canEdit ? (
                <>
                  <button type="button" className="qc-btn" disabled={busy || !checklistDirty} title="Lưu checklist ngay (không bắt buộc — bấm Bàn giao cũng tự lưu)" onClick={saveChecklist}>Lưu</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || !checklistAllConfirmed || itemsMissingCost.length > 0}
                    title={
                      itemsMissingCost.length > 0
                        ? `Còn ${itemsMissingCost.length} hạng mục chưa nhập giá vốn hoặc chưa đánh dấu "Không áp dụng"`
                        : !checklistAllConfirmed
                        ? 'Cần xác nhận đủ 4 mục Scope/Cost/Timeline/Assumption trước khi bàn giao'
                        : undefined
                    }
                    onClick={() => void handoffToPricing()}
                  >
                    Bàn giao xử lý giá
                  </button>
                </>
              ) : null}
              {stage === 'pricing' && canEdit ? (
                <>
                  <button type="button" className="qc-btn" disabled={busy} onClick={() => void persistQuote({})}>Lưu</button>
                  <button
                    type="button"
                    className="qc-btn qc-btn-primary"
                    disabled={busy || !canReadyForApproval}
                    title={!canReadyForApproval ? 'Cần ít nhất 1 hạng mục và tổng tiền > 0 trước khi gửi duyệt' : undefined}
                    onClick={() => void advanceStage('review')}
                  >
                    Hoàn tất phần giá bán
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

      {previewModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewModalOpen(false); }}>
          <div className="qc-workspace-preview-modal">
            <div className="qc-workspace-modal-head">
              <h3>{quote ? 'Bản xem trước cho khách hàng' : 'Bản xem trước'}</h3>
              <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setPreviewModalOpen(false)}>
                <X className="qc-inline-icon" />
              </button>
            </div>
            {/* Preview chi dung du lieu THAT su duoc phep cong khai - tu chon
             * tung field o day (khong dump nguyen quote/deal object) de dam
             * bao khong bao gio vo tinh lo cost/markup/margin/note noi bo/
             * checklist/activity/owner id, dung tinh than allowlist da dung
             * o backend get_public_quote(). itemsDraft (khong phai rootItems)
             * de phan anh dung ca thay doi CHUA luu, dung yeu cau xac nhan. */}
            <div className="qc-workspace-preview-modal-body">
              {quote ? (
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Mã báo giá</span>
                  <strong>{quote.quoteNumber} · V{quote.versionNumber || 1}</strong>
                </div>
              ) : null}
              <div className="qc-workspace-preview-modal-row">
                <span className="qc-workspace-info-label">Khách hàng</span>
                <strong>{deal?.customerName || 'Chưa gắn cơ hội'}</strong>
              </div>
              <table className="qc-linked-table">
                <thead>
                  <tr>
                    <th>Hạng mục</th>
                    <th className="qc-th-money">SL</th>
                    <th className="qc-th-money">Đơn giá</th>
                    <th className="qc-th-money">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsDraft.map((item, index) => (
                    <tr key={item.id || index}>
                      <td>{item.serviceDescription || '—'}</td>
                      <td className="qc-cell-money">{item.quantity}</td>
                      <td className="qc-cell-money">{formatMoney(item.unitPrice)}</td>
                      <td className="qc-cell-money">{formatMoney(item.totalAmount || item.quantity * item.unitPrice || 0)}</td>
                    </tr>
                  ))}
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
              {paymentTermsBlock ? (
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Điều khoản thanh toán</span>
                  <p>{paymentTermsBlock.content}</p>
                </div>
              ) : !quote ? (
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Điều khoản thanh toán</span>
                  <p>Thanh toán trong {draftPaymentTermsDays} ngày kể từ ngày duyệt báo giá.</p>
                </div>
              ) : null}
              {quote?.validUntil ? (
                <div className="qc-workspace-preview-modal-row">
                  <span className="qc-workspace-info-label">Hiệu lực báo giá</span>
                  <strong>{formatDate(quote.validUntil)}</strong>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

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
              <button type="button" className="qc-btn" onClick={() => setSendModalOpen(false)}>
                {sendSuccess ? 'Đóng' : 'Huỷ'}
              </button>
              {!sendSuccess ? (
                <button
                  type="button"
                  className="qc-btn qc-btn-primary"
                  disabled={sendBusy || !sendRecipientEmail.trim()}
                  onClick={() => void submitSendQuote()}
                >
                  {sendBusy ? 'Đang gửi…' : sendError ? 'Thử lại' : 'Gửi báo giá'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {ruleModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setRuleModalOpen(false); }}>
          <div className="qc-deal-picker qc-rule-modal">
            <h3>Cài đặt quy tắc báo giá</h3>
            <p className="qc-workspace-note">Các quy tắc được đánh giá khi hoàn tất phần giá bán.</p>

            {(Object.keys(RULE_LABELS) as QuoteApprovalRuleType[]).map(ruleType => {
              const meta = RULE_LABELS[ruleType];
              const row = ruleModalDraft[ruleType];
              return (
                <label key={ruleType} className="qc-rule-modal-row">
                  <input
                    type="checkbox"
                    checked={row.isRequired}
                    onChange={e => setRuleModalDraft(prev => ({ ...prev, [ruleType]: { ...prev[ruleType], isRequired: e.target.checked } }))}
                  />
                  <div className="qc-rule-modal-row-body">
                    <strong>{meta.label}</strong>
                    <span className="qc-workspace-muted" style={{ fontSize: 12 }}>{meta.description}</span>
                  </div>
                  <div className="qc-rule-modal-row-input">
                    <input
                      type="number"
                      className="qc-cell-input qc-cell-input-money"
                      value={row.thresholdValue}
                      onChange={e => setRuleModalDraft(prev => ({ ...prev, [ruleType]: { ...prev[ruleType], thresholdValue: e.target.value } }))}
                    />
                    <span>{meta.unit}</span>
                  </div>
                </label>
              );
            })}

            <label className="qc-workspace-checklist-item" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={ruleModalAutoApprove} onChange={e => setRuleModalAutoApprove(e.target.checked)} />
              <div>
                <strong>Tự động duyệt khi đạt tất cả quy tắc</strong>
                <p className="qc-workspace-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                  Tắt: đạt đủ quy tắc → chuyển "Chờ duyệt", người có quyền bấm duyệt.
                  Bật: đạt đủ quy tắc bắt buộc → hệ thống tự duyệt (không tự phát hành, không tự gửi khách hàng).
                  Có 1 quy tắc không đạt hoặc thiếu dữ liệu → không tự duyệt.
                </p>
              </div>
            </label>

            {ruleModalError ? <div className="qc-workspace-note-box qc-workspace-note-box--warn">{ruleModalError}</div> : null}

            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setRuleModalOpen(false)}>Hủy</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={ruleModalBusy} onClick={() => void saveRuleSettings()}>
                {ruleModalBusy ? 'Đang lưu…' : 'Lưu quy tắc'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {workspaceToast ? (
        <div className={`qc-workspace-toast ${workspaceToast.ok ? 'qc-workspace-toast--ok' : 'qc-workspace-toast--error'}`}>
          {workspaceToast.text}
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
                {hasCostData && quote.grossMarginPercent != null ? `${quote.grossMarginPercent.toFixed(2)}%` : 'Chưa có dữ liệu giá vốn'}
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
              <button type="button" className="qc-btn" onClick={() => setApproveModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => void approveNow()}>
                Duyệt báo giá
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
              <button type="button" className="qc-btn" onClick={() => setExceptionApprovalModal({ open: false, reason: '', evaluation: null })}>Huỷ</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !exceptionApprovalModal.reason.trim()}
                onClick={() => void approveWithExceptionNow()}
              >
                Duyệt ngoại lệ
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
              <button type="button" className="qc-btn" onClick={() => setPublishModalOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" disabled={busy} onClick={() => void publishNow()}>
                Xác nhận phát hành
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
              <button type="button" className="qc-btn" onClick={() => setRequestChangesModalOpen(false)}>Huỷ</button>
              <button
                type="button"
                className="qc-btn qc-btn-primary"
                disabled={busy || !requestChangesReason.trim()}
                onClick={() => void requestChangesNow()}
              >
                Gửi yêu cầu chỉnh sửa
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {catalogModalOpen ? (
        <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) setCatalogModalOpen(false); }}>
          <div className="qc-workspace-preview-modal">
            <div className="qc-workspace-modal-head">
              <h3>Chọn từ danh mục dịch vụ</h3>
              <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={() => setCatalogModalOpen(false)}>
                <X className="qc-inline-icon" />
              </button>
            </div>
            <div className="qc-workspace-preview-modal-body">
              {catalogLoading ? (
                <p className="qc-workspace-note">Đang tải danh mục...</p>
              ) : !catalogOptions || (catalogOptions.bundles.length === 0 && catalogOptions.components.length === 0) ? (
                <p className="qc-workspace-note">Mẫu báo giá này chưa liên kết danh mục dịch vụ nào — dùng "+ Thêm hạng mục" để nhập tay.</p>
              ) : (
                <ul className="qc-workspace-catalog-list">
                  {[...catalogOptions.bundles, ...catalogOptions.components].map(item => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <div className="qc-row-sub">{item.unit || '—'} · {formatMoney(item.defaultUnitPriceVnd || 0)}</div>
                      </div>
                      <button type="button" className="qc-mini-btn qc-mini-btn-brand" onClick={() => addItemsFromCatalog([catalogItemToQuoteItem(item)])}>
                        <Plus className="qc-inline-icon" /> Thêm
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="qc-workspace-modal-actions">
              <button type="button" className="qc-btn" onClick={() => setCatalogModalOpen(false)}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
