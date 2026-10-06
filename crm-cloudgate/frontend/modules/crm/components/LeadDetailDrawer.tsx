'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { usersService, crmTeamsService, projectsService, type QuoteBusinessRoleUser, type CrmTeam, type AppUserProfile, type Project } from '@/services/all-platform.service';
import { parseMoney, DEAL_STAGE_META } from '../constants/crmConfig';
import { mapLead } from './LeadsDirectory';
import { CheckCircle2, HelpCircle, Loader2, X } from './icons';
import { LeadDealQualificationPanel, formatEstimatedValue } from './LeadDealQualificationPanel';
import { CrmTeamFormModal } from './CrmTeamFormModal';
import type { SelectAction } from './SearchableSelect';
import { getSourceLabel } from './DealFormFields';
import { useCrmCategoryLabels } from './CrmCategorySelect';
import { useLeadQualificationEngine } from '../hooks/useLeadQualificationEngine';
import {
  ICP_OPTIONS,
  INTEREST_LEVEL_OPTIONS,
  icpToApi,
  interestLevelFromScore,
  toDatetimeLocal,
  type InterestLevel,
} from '../utils/leadQualificationRules';
import type { AppUser } from '@/types/unified.types';
import type { CrmLeadRow } from '../types';

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

type CompanyMatchRow = {
  id: string;
  customer_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  match_reason?: string;
};

type ConvertedDealSnapshot = {
  customer_id?: string | null;
  deal_stage?: string | null;
  team_id?: string | null;
  sdr_id?: string | null;
  service_package?: string | null;
  estimated_budget?: number | string | null;
  next_step?: string | null;
  follow_up_date?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  project?: { name?: string | null } | null;
};

function initialOf(name: string): string {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

type VerifyForm = {
  interest: string;
  interestLevel: InterestLevel | '';
  score: number | null;
  timeline: string;
  estimatedValue: number | null;
  nextStep: string;
  nextStepAt: string;
  aeId: string;
  note: string;
  followUpChannel: string;
  dealStage: string;
  /** "Dự án (tùy chọn)" - feedback leader + WIP full-flow, section A "Thông
   * tin then chốt". Chỉ gõ TÊN (chưa có ProjectPicker chọn Dự án có sẵn ở
   * màn Xác minh Lead - Customer thường CHƯA xác định lúc này) - backend
   * (crm_lead_service.convert_lead) tự tạo Dự án THẬT sau khi convert xong,
   * gắn vào Deal vừa tạo (migration 153 + supabase_project_service). */
  project: string;
  projectId: string;
};

/**
 * Drawer "Xác minh Lead" — 1 luồng có dẫn dắt thay cho 3 khối rời rạc trước đây
 * (xem/sửa + form Qualification thô + nút Convert nổi). Vẫn thao tác trên đúng
 * 1 record crm_leads và vẫn dùng đúng 2 endpoint cũ:
 *   - PUT  /crm/leads/{id}          — lưu xác minh (KHÔNG BAO GIỜ tạo hồ sơ)
 *   - POST /crm/leads/{id}/convert  — tạo Customer+Contact+Deal+Activity
 *     nguyên tử qua RPC crm_convert_lead (migration 078), giữ nguyên
 *     idempotency_key như trước.
 *
 * "Mức sẵn sàng Convert" tính HOÀN TOÀN phía client từ 5 điều kiện thật của
 * form — không có cột/endpoint mới, và cũng không còn nút "Đủ điều kiện" đơn lẻ
 * nào có thể tự mở khoá Convert.
 */
export function LeadDetailDrawer({
  lead,
  open,
  initialMode,
  currentUser,
  onClose,
  onSaved,
  onEdit,
}: {
  lead: CrmLeadRow | null;
  open: boolean;
  initialMode: 'view' | 'qualify' | 'convert';
  currentUser: AppUser | null;
  onClose: () => void;
  onSaved: (lead: CrmLeadRow) => void;
  /** Mở form sửa hồ sơ Lead. Drawer này KHÔNG tự dựng form sửa riêng — nó đẩy
   * ngược lên LeadsDirectory để mở đúng LeadEditDrawer mà "Sửa nhanh" dùng,
   * nên chỉ tồn tại duy nhất 1 bản form sửa Lead trong toàn bộ ứng dụng. */
  onEdit?: (lead: CrmLeadRow) => void;
}) {
  const router = useRouter();
  const [saleOptions, setSaleOptions] = useState<QuoteBusinessRoleUser[]>([]);
  // "Team Sale" - filter cascading rieng, KHONG luu vao lead (chi aeId moi
  // luu that). teamOptions fetch 1 lan/moi lan mo (giong pattern saleOptions
  // ben duoi); teamMembers fetch lai moi khi doi teamId, thay THANG cho
  // saleOptions he thong (feedback: "CHỈ xổ các thành viên thuộc Team đó").
  const [teamOptions, setTeamOptions] = useState<CrmTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [teamMembers, setTeamMembers] = useState<AppUserProfile[] | null>(null);
  // "+ Thêm Team mới" trong dropdown Team Sale (feedback leader 2026-09-29:
  // "tái sử dụng lại bên chỗ team crm") - tai su dung CrmTeamFormModal (dung
  // chung voi CrmTeamsShell/trang Team CRM).
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [teamLeaders, setTeamLeaders] = useState<AppUserProfile[]>([]);
  const [teamAllUsers, setTeamAllUsers] = useState<AppUserProfile[]>([]);
  const [form, setForm] = useState<VerifyForm>({
    interest: '',
    interestLevel: '',
    score: null,
    timeline: '',
    estimatedValue: null,
    nextStep: '',
    nextStepAt: '',
    aeId: '',
    note: '',
    followUpChannel: '',
    dealStage: 'dealing',
    project: '',
    projectId: '',
  });
  const [customerProjects, setCustomerProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState('');
  const [suggestionUsed, setSuggestionUsed] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [companyMatches, setCompanyMatches] = useState<CompanyMatchRow[]>([]);
  const [dupChecked, setDupChecked] = useState(false);
  const [customerChoice, setCustomerChoice] = useState<'new' | string>('new');
  const [contact, setContact] = useState({ name: '', phone: '', email: '', positionCategoryId: '', positionLabel: '' });
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');
  const [nurtureReason, setNurtureReason] = useState('');
  const [unqualifiedReason, setUnqualifiedReason] = useState('');
  // Lead da convert - panel Thong tin then chot/Ban giao Sale mac dinh khoa
  // (read-only), nut "Chỉnh sửa" o day de MO KHOA lai (feedback: "hiện tại
  // đang có 1 nút chỉnh sửa thông tin lead, giờ cho thêm 1 nút... chỉnh sửa
  // phần này"). Bam Luu chi PUT thuong vao dung Lead (saveVerification(),
  // KHONG dung submitFinalOutcome/handleConvert) - tuyet doi khong tao lai
  // Customer/Deal moi hay doi status.
  const [qualificationEditOpen, setQualificationEditOpen] = useState(false);
  const idempotencyKeyRef = useRef<string>('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const readinessRef = useRef<HTMLElement>(null);

  const setField = <K extends keyof VerifyForm>(key: K, value: VerifyForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Chi khoi tao lai form khi mo 1 LEAD KHAC (hoac mo lai drawer), khong phai
  // moi lan prop `lead` doi tham chieu: sau khi "Lưu xác minh" thanh cong,
  // LeadsDirectory day xuong 1 object lead moi -> neu effect nay chay lai theo
  // tham chieu thi no se reset ca `convertOpen` vua bat, khien nut "Tạo cơ hội
  // & bàn giao Sale" bam xong khong mo duoc buoc xac nhan (bug thuc te bat
  // duoc luc chay Playwright, khong phai gia thuyet).
  const initializedLeadRef = useRef<string>('');

  const [freshLead, setFreshLead] = useState<CrmLeadRow | null>(null);
  const [convertedDeal, setConvertedDeal] = useState<ConvertedDealSnapshot | null>(null);

  // ── Master Hydration Function (Pure Drawer Hydration, NO onSaved call!) ────
  const hydrateLeadDrawer = useCallback((params: {
    lead: CrmLeadRow;
    freshLead?: CrmLeadRow | null;
    deal?: ConvertedDealSnapshot | null;
    customerProjects: Project[];
  }) => {
    const { lead, freshLead, deal, customerProjects } = params;
    const currentLead = freshLead || lead;

    // ── 1. SALE PHỤ TRÁCH (aeId) ───────────────────────────────────────────
    // Source chính: crm_leads.qualification_ae_id
    // Priority: Valid Lead qualificationAeId || Valid Deal sdr_id || ''
    const rawLeadAe = currentLead.qualificationAeId || lead.qualificationAeId || '';
    const rawDealAe = deal?.sdr_id || '';
    const resolvedAeId = rawLeadAe || rawDealAe || '';

    // ── 2. TEAM SALE (teamId) ──────────────────────────────────────────────
    // Rule: Lead teamId valid > Deal team_id valid > infer từ Sale > empty
    const rawLeadTeam = currentLead.teamId || lead.teamId || '';
    const rawDealTeam = deal?.team_id || '';
    const resolvedTeamId = rawLeadTeam || rawDealTeam || '';

    // ── 3. DỰ ÁN (project & projectId) ──────────────────────────────────────
    // Vì Lead đã có converted_deal_id, Project phải hydrate từ converted Deal detail.
    let resolvedProjectId = currentLead.projectId || lead.projectId || deal?.project_id || '';
    let resolvedProjectName = currentLead.projectName || lead.projectName || deal?.project_name || deal?.project?.name || '';

    if (deal) {
      if (deal.project_id) resolvedProjectId = deal.project_id;
      if (deal.project?.name) {
        resolvedProjectName = deal.project.name;
      } else if (deal.project_name) {
        resolvedProjectName = deal.project_name;
      }
    }

    // Nếu Deal API chỉ trả project_id mà không trả tên (hoặc ngược lại): resolve từ customerProjects
    if (resolvedProjectId && !resolvedProjectName && customerProjects.length > 0) {
      const foundProject = customerProjects.find(p => p.id === resolvedProjectId);
      if (foundProject) resolvedProjectName = foundProject.name;
    } else if (resolvedProjectName && !resolvedProjectId && customerProjects.length > 0) {
      const foundProject = customerProjects.find(p => p.name === resolvedProjectName);
      if (foundProject) resolvedProjectId = foundProject.id;
    }

    // ── 4. GIAI ĐOẠN (dealStage) ───────────────────────────────────────────
    // Converted: deal.deal_stage || lead.dealStage || 'dealing'
    // Unconverted: lead.dealStage || 'dealing'
    let resolvedDealStage = currentLead.dealStage || lead.dealStage || 'dealing';
    if (deal && deal.deal_stage) {
      resolvedDealStage = deal.deal_stage;
    }

    const estimatedValue = deal?.estimated_budget != null && deal.estimated_budget !== ''
      ? Number(deal.estimated_budget)
      : (currentLead.qualificationEstimatedValue ?? lead.qualificationEstimatedValue ?? null);

    setForm(prev => ({
      ...prev,
      interest: deal?.service_package || currentLead.qualificationNeed || lead.qualificationNeed || prev.interest || '',
      interestLevel: interestLevelFromScore(currentLead.score ?? lead.score) || prev.interestLevel,
      score: currentLead.score ?? lead.score ?? prev.score,
      timeline: currentLead.qualificationExpectedTimeline || lead.qualificationExpectedTimeline || prev.timeline || '',
      estimatedValue: estimatedValue == null || Number.isNaN(estimatedValue) ? prev.estimatedValue : estimatedValue,
      nextStep: deal?.next_step || currentLead.nextStep || lead.nextStep || prev.nextStep || '',
      nextStepAt: deal?.follow_up_date
        ? toDatetimeLocal(String(deal.follow_up_date))
        : (toDatetimeLocal(currentLead.followUpDate || lead.followUpDate) || prev.nextStepAt),
      note: currentLead.note || lead.note || prev.note || '',
      aeId: resolvedAeId,
      dealStage: resolvedDealStage,
      project: resolvedProjectName,
      projectId: resolvedProjectId,
    }));

    setTeamId(resolvedTeamId || '');
    // Team Sale theo Sale phu trach: team that cua Sale (leader/thanh vien) la nguon dung nhat.
    // team_id da luu co the cu/lech (vd Sale la leader Team Minh nhung lead luu Presale) -> uu tien team cua Sale,
    // chi giu team da luu khi Sale khong thuoc Team CRM nao.
    if (resolvedAeId) {
      const leadIdAtRequest = lead.id;
      crmTeamsService.getTeamIdForUser(resolvedAeId)
        .then(res => {
          if (initializedLeadRef.current !== leadIdAtRequest) return;
          const foundTeamId = res.success ? res.data?.crm_team_id : null;
          if (foundTeamId) setTeamId(foundTeamId);
        })
        .catch(() => {});
    }
  }, []);

  // ── Master Hydration Effect ────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !lead) return;
    hydrateLeadDrawer({
      lead,
      freshLead,
      deal: convertedDeal,
      customerProjects,
    });
  }, [open, lead, freshLead, convertedDeal, customerProjects, hydrateLeadDrawer]);

  useEffect(() => {
    if (!open || !lead) {
      initializedLeadRef.current = '';
      setFreshLead(null);
      setConvertedDeal(null);
      setAddTeamOpen(false);
      return;
    }
    if (initializedLeadRef.current === lead.id) return;
    initializedLeadRef.current = lead.id;
    setFreshLead(null);
    setConvertedDeal(null);
    setError('');
    setSavedOk('');
    setConvertError('');
    setSuggestionUsed(false);
    setConvertOpen(initialMode === 'convert');
    setNurtureReason('');
    setUnqualifiedReason('');
    setQualificationEditOpen(false);
    setAddTeamOpen(false);
    setContact({
      name: lead.leadName || '',
      phone: lead.phone || '',
      email: lead.email || '',
      positionCategoryId: lead.positionCategoryId || '',
      positionLabel: lead.positionLabelSnapshot || lead.position || '',
    });
    setCustomerChoice('new');
    idempotencyKeyRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `lead-convert-${lead.id}-${Date.now()}`;

    setCompanyMatches([]);
    setDupChecked(false);
    const hasCompanyKeys = Boolean(lead.companyName || lead.website);
    const url = hasCompanyKeys
      ? (() => {
          const params = new URLSearchParams();
          if (lead.website) params.set('website', lead.website);
          if (lead.companyName) params.set('name', lead.companyName);
          return `${API_BASE_URL}/api/all-platform/crm/leads/company-match?${params.toString()}`;
        })()
      : (() => {
          const params = new URLSearchParams();
          if (lead.phone) params.set('phone', lead.phone);
          if (lead.email) params.set('email', lead.email);
          return `${API_BASE_URL}/api/all-platform/crm/leads/duplicate-check?${params.toString()}`;
        })();
    fetch(url, { credentials: 'include', headers: headers() })
      .then(res => res.json())
      .then(body => {
        if (body.success === false) return;
        if (hasCompanyKeys) setCompanyMatches((body.data?.matches || []) as CompanyMatchRow[]);
        setDupChecked(true);
      })
      .catch(() => setDupChecked(false));
  }, [open, lead, initialMode]);

  // Always fetch fresh Lead details from server on drawer open (read-only, NO onSaved!)
  useEffect(() => {
    if (!open || !lead?.id) return;
    let alive = true;
    const targetLeadId = lead.id;
    fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(targetLeadId)}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(res => res.json())
      .then(body => {
        if (!alive || body.success === false || !body.data) return;
        const mapped = mapLead(body.data);
        setFreshLead(mapped);
      })
      .catch(() => { /* silent fallback */ });
    return () => { alive = false; };
  }, [open, lead?.id]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    usersService.getUsersByQuoteBusinessRole('sale')
      .then(res => {
        if (!alive) return;
        const rows = res.success ? res.data || [] : [];
        setSaleOptions([...rows].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (alive) setSaleOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    crmTeamsService.list()
      .then(res => {
        if (!alive) return;
        const rows = res.success ? res.data || [] : [];
        setTeamOptions(rows);
      })
      .catch(() => {
        if (alive) setTeamOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Danh sach Leader/user cho modal "+ Thêm Team mới" (CrmTeamFormModal).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    usersService.getAllProfiles().then(res => {
      if (!alive || !res.success) return;
      const rows = res.data || [];
      setTeamLeaders(rows.filter(u => u.role === 'leader' || u.role === 'admin'));
      setTeamAllUsers(rows);
    });
    return () => { alive = false; };
  }, [open]);

  // Load danh sach Du an cua Khach hang (neu lead da link voi Customer hoac user chon Customer co san).
  const hydratedLead = freshLead || lead;
  const targetCustomerId = convertedDeal?.customer_id
    || hydratedLead?.convertedCustomerId
    || (customerChoice !== 'new' ? customerChoice : undefined);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    projectsService.list(targetCustomerId)
      .then(res => {
        if (!alive) return;
        setCustomerProjects(res.success && res.data ? res.data : []);
      })
      .catch(() => {
        if (alive) setCustomerProjects([]);
      });
    return () => { alive = false; };
  }, [open, targetCustomerId]);

  // Doi Team -> tai lai thanh vien Team do, thay THANG cho danh sach Sale he thong.
  useEffect(() => {
    if (!teamId) {
      setTeamMembers(null);
      return;
    }
    let alive = true;
    crmTeamsService.get(teamId)
      .then(res => {
        if (!alive) return;
        const members = res.success ? res.data?.members || [] : [];
        const leaderId = res.success ? res.data?.leader_user_id : undefined;
        const leaderName = res.success ? res.data?.leader_name : undefined;
        const hasLeader = leaderId && members.some(m => m.id === leaderId);
        setTeamMembers(
          leaderId && !hasLeader
            ? [...members, { id: leaderId, name: leaderName || '', email: '' } as AppUserProfile]
            : members
        );
      })
      .catch(() => {
        if (alive) setTeamMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [teamId]);

  // Fetch Converted Deal snapshot (read-only hydration, NO onSaved call!)
  useEffect(() => {
    if (!open || !lead?.convertedDealId) return;
    let alive = true;
    const leadIdAtRequest = lead.id;
    fetch(`${API_BASE_URL}/api/all-platform/customer-leads/${encodeURIComponent(lead.convertedDealId)}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(res => res.json())
      .then(body => {
        if (!alive || initializedLeadRef.current !== leadIdAtRequest || body.success === false) return;
        const deal = (body.data || {}) as ConvertedDealSnapshot;
        setConvertedDeal(deal);
      })
      .catch(() => { /* silent fallback */ });
    return () => {
      alive = false;
    };
  }, [open, lead?.id, lead?.convertedDealId]);

  const { labels: knownProductLabels } = useCrmCategoryLabels('crm_service_package');

  const {
    ruleConditions, verificationOutcome, outcomeReasons, outcomeMissing, sqlProgress, icpFit,
  } = useLeadQualificationEngine({
    open,
    productValue: form.interest,
    knownProductLabels,
    hasInterestLevel: Boolean(form.interestLevel),
    hasValue: form.estimatedValue != null,
    hasTeam: Boolean(form.aeId),
    hasNext: Boolean(form.nextStep.trim()),
    hasFollow: Boolean(form.nextStepAt),
    hasContact: Boolean(contact.phone.trim() || contact.email.trim()),
  });

  // Chua chon Team -> giu danh sach Sale toan he thong nhu cu (fallback UX);
  // da chon Team -> THAY THANG bang dung thanh vien Team do (khong hoi cu).
  const aeOptions = useMemo(() => {
    const list = teamId && teamMembers && teamMembers.length > 0
      ? [...teamMembers, ...saleOptions]
      : saleOptions;
    const seen = new Set<string>();
    const result: Array<{ value: string; label: string }> = [];
    for (const u of list) {
      if (u && u.id && !seen.has(u.id)) {
        seen.add(u.id);
        result.push({ value: u.id, label: u.name || (u as any).email || u.id });
      }
    }
    return result;
  }, [teamId, teamMembers, saleOptions]);
  const teamOptionsForSelect = useMemo(
    () => teamOptions.map(team => ({ value: team.id, label: team.name })),
    [teamOptions],
  );
  const teamActions: SelectAction[] = useMemo(
    () => [{ key: 'add-team', label: '+ Thêm Team mới', type: 'add', onSelect: () => setAddTeamOpen(true) }],
    [],
  );
  const projectOptions = useMemo(
    () => customerProjects.map(p => ({ id: p.id, name: p.name, code: (p as Project & { code?: string }).code })),
    [customerProjects],
  );
  /** Doi Team do NGUOI DUNG tu bam (khac voi auto-load luc mo lead) - phai
   * reset aeId dang chon vi Sale cu co the khong con thuoc Team moi. */
  function handleTeamIdChange(value: string) {
    setTeamId(value);
    setField('aeId', '');
  }
  const aeName = (id?: string) => {
    if (!id) return 'Chưa gán';
    if (id === currentUser?.id) return currentUser?.name || currentUser?.email || 'Bạn';
    // Tim ca trong saleOptions (he thong) lan teamMembers (dang loc theo Team)
    // - aeId da luu co the thuoc Team dang chon nhung khong nam trong danh
    // sach vai tro "sale" he thong (vd Leader/Presale duoc bo sung vao Team).
    return saleOptions.find(user => user.id === id)?.name
      || (teamMembers || []).find(user => user.id === id)?.name
      || 'Chưa gán';
  };

  // ---- Mức sẵn sàng Convert: tính hoàn toàn client-side từ 5 điều kiện thật.
  const checks = useMemo(() => {
    const nextStepOk = Boolean(form.nextStep.trim()) && Boolean(form.nextStepAt);
    return [
      { key: 'need', label: 'Nhu cầu đã xác định', ok: Boolean(form.interest.trim()) },
      { key: 'icp', label: 'ICP đã xác định', ok: icpFit !== 'unknown' },
      { key: 'next', label: 'Việc tiếp theo đã có', ok: nextStepOk },
      { key: 'dup', label: 'Doanh nghiệp đã được check trùng', ok: dupChecked },
      { key: 'ae', label: 'Sale nhận bàn giao đã chọn', ok: Boolean(form.aeId) },
    ];
  }, [form, dupChecked, icpFit]);

  const okCount = checks.filter(c => c.ok).length;
  const isReady = okCount === checks.length;
  const readinessLabel = isReady ? 'Sẵn sàng tạo cơ hội' : okCount >= 3 ? 'Cần xác minh thêm' : 'Chưa sẵn sàng';
  const readinessTone: 'ready' | 'partial' | 'blocked' = isReady ? 'ready' : okCount >= 3 ? 'partial' : 'blocked';

  const nextStepWarning = verificationOutcome === 'sql' && (Boolean(form.nextStep.trim()) !== Boolean(form.nextStepAt) || (!form.nextStep.trim() && !form.nextStepAt));

  // Nhảy tới phần liên quan nhất với trạng thái Lead lúc mở drawer.
  useEffect(() => {
    if (!open || !lead) return;
    if (initialMode !== 'convert' && lead.status !== 'sql' && lead.status !== 'qualified') return;
    const timer = window.setTimeout(() => {
      readinessRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, lead, initialMode]);

  if (!open || !lead) return null;
  const canWrite = Boolean(lead.canWrite);
  const hasConvertedDeal = Boolean(lead.convertedDealId);
  const isConverted = hasConvertedDeal;
  const displayScore = form.score ?? lead.score ?? null;

  /** "Dùng gợi ý" — suy ra giá trị từ CHÍNH dữ liệu Lead đang có (ghi chú,
   * nguồn, công ty). Đây là gợi ý theo quy tắc, KHÔNG phải AI: khối này không
   * gọi model nào cả nên không được (và không) nói là "AI đã gợi ý". Chỉ điền
   * vào ô đang trống — không bao giờ ghi đè thứ SDR đã nhập, và không bịa ra
   * thông tin không có trong Lead. */
  function applySuggestion() {
    const haystack = `${lead?.note || ''} ${lead?.qualificationNeed || ''} ${lead?.source || ''}`.toLowerCase();
    setForm(prev => {
      const next = { ...prev };
      if (!next.interest.trim() && lead?.qualificationNeed) next.interest = lead.qualificationNeed;
      if (!next.timeline) {
        if (/(gấp|ngay|asap|luôn)/.test(haystack)) next.timeline = 'Ngay';
        else if (/(tháng này|trong tháng|1 tháng)/.test(haystack)) next.timeline = 'Trong 1 tháng';
        else if (/(quý|3 tháng)/.test(haystack)) next.timeline = '1-3 tháng';
      }
      if (next.estimatedValue == null) {
        const money = (lead?.note || '').match(/(\d[\d.,]{5,})/);
        if (money) next.estimatedValue = parseMoney(money[1]);
      }
      if (!next.nextStep.trim()) next.nextStep = lead?.phone ? 'Gọi lại' : 'Gửi tài liệu';
      if (!next.nextStepAt) {
        const when = new Date();
        when.setDate(when.getDate() + 1);
        when.setHours(9, 0, 0, 0);
        next.nextStepAt = toDatetimeLocal(when.toISOString());
      }
      if (!next.interestLevel && next.score == null) {
        next.interestLevel = 'need';
        next.score = 55;
      }
      if (!next.aeId) next.aeId = lead?.qualificationAeId || lead?.sdrId || currentUser?.id || '';
      return next;
    });
    setSuggestionUsed(true);
  }

  function resetSuggestion() {
    if (!lead) return;
    setForm({
      interest: lead.qualificationNeed || '',
      interestLevel: interestLevelFromScore(lead.score),
      score: lead.score ?? null,
      timeline: lead.qualificationExpectedTimeline || '',
      estimatedValue: lead.qualificationEstimatedValue ?? null,
      nextStep: lead.nextStep || '',
      nextStepAt: toDatetimeLocal(lead.followUpDate),
      aeId: lead.qualificationAeId || '',
      note: lead.note || '',
      followUpChannel: '',
      dealStage: lead.dealStage || 'dealing',
      project: lead.projectName || '',
      projectId: '',
    });
    setSuggestionUsed(false);
  }

  function setInterestLevel(value: InterestLevel) {
    const option = INTEREST_LEVEL_OPTIONS.find(item => item.value === value);
    setForm(prev => ({
      ...prev,
      interestLevel: value,
      score: option?.score ?? prev.score,
    }));
  }

  function buildQualificationPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      score: form.score ?? null,
      qualification_need: form.interest.trim() || null,
      qualification_icp_fit: icpToApi(icpFit),
      qualification_estimated_value: form.estimatedValue ?? null,
      qualification_expected_timeline: form.timeline || null,
      qualification_ae_id: form.aeId || null,
      next_step: form.nextStep.trim() || null,
      follow_up_date: form.nextStepAt ? new Date(form.nextStepAt).toISOString() : null,
      note: form.note.trim() || null,
      team_id: teamId || null,
      // "Dự án"/"Giai đoạn" là field thật trên crm_leads (migration 165/166)
      // nên luôn gửi, kể cả khi Lead chưa convert — trước đây chỉ gửi khi
      // convertedDealId nên gõ/chọn ở trạng thái Nuôi dưỡng/SQL chưa chốt bị
      // rớt mất.
      project_name: form.project.trim() || null,
      deal_stage: form.dealStage || null,
    };
    if (lead?.convertedDealId) {
      if (form.projectId) payload.project_id = form.projectId;
    }
    return payload;
  }

  function noteWithVerification(prefix: string, reason?: string) {
    const details = [prefix, reason ? `Lý do: ${reason}` : '', form.note.trim()].filter(Boolean);
    return details.join('\n');
  }

  /** Đồng bộ lại form/teamId ngay sau khi lưu thành công, KHÔNG qua effect
   * khởi tạo (effect đó cố tình bỏ qua khi `lead.id` không đổi - xem comment
   * ở initializedLeadRef - để không reset convertOpen/qualificationEditOpen
   * giữa chừng). Thiếu bước này thì giá trị vừa lưu (Team Sale/Dự án/Giai
   * đoạn/Sale phụ trách...) không hiện liền trên UI, phải F5 mới thấy, dù
   * data đã lưu đúng dưới DB. */
  function syncFormFromSavedLead(updatedLead: CrmLeadRow) {
    if (updatedLead.teamId) {
      setTeamId(updatedLead.teamId);
    } else {
      const ae = updatedLead.qualificationAeId || form.aeId;
      if (ae) {
        crmTeamsService.getTeamIdForUser(ae)
          .then(res => {
            const foundTeamId = res.success ? res.data?.crm_team_id : null;
            if (foundTeamId) setTeamId(foundTeamId);
          })
          .catch(() => {});
      }
    }
    setForm(prev => ({
      ...prev,
      interest: updatedLead.qualificationNeed || '',
      interestLevel: interestLevelFromScore(updatedLead.score),
      score: updatedLead.score ?? null,
      timeline: updatedLead.qualificationExpectedTimeline || '',
      estimatedValue: updatedLead.qualificationEstimatedValue ?? null,
      nextStep: updatedLead.nextStep || '',
      nextStepAt: toDatetimeLocal(updatedLead.followUpDate),
      aeId: updatedLead.qualificationAeId || prev.aeId,
      note: updatedLead.note || '',
      dealStage: updatedLead.dealStage || prev.dealStage || 'dealing',
      project: updatedLead.projectName || prev.project,
      projectId: updatedLead.projectId || prev.projectId,
    }));
  }

  /** Lưu xác minh — PUT thường, TUYỆT ĐỐI không tạo Customer/Contact/Deal.
   * `status` chỉ đi lên theo đúng mức đã xác minh được (new_lead -> qualifying,
   * và chỉ lên 'qualified' khi checklist thật sự đủ 5/5) — thay cho nút "Đủ
   * điều kiện" cũ vốn bật qualified mà không kiểm tra gì. */
  async function saveVerification(overrideStatus?: string) {
    if (!lead) return false;
    if (!overrideStatus && form.nextStep.trim() && !form.nextStepAt) {
      setError('Đã chọn "Việc tiếp theo" thì phải chọn "Khi nào làm".');
      return false;
    }
    setSaving(true);
    setError('');
    setSavedOk('');
    try {
      const formSnapshot = form;
      const teamIdSnapshot = teamId;
      const payload: Record<string, unknown> = overrideStatus
        ? { ...buildQualificationPayload(), status: overrideStatus }
        : buildQualificationPayload();
      if (!overrideStatus && (lead.status === 'mql' || lead.status === 'new_lead' || lead.status === 'qualifying')) payload.status = 'mql';
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không lưu được thông tin xác minh.');
      const updatedLead = mapLead(body.data);
      if (formSnapshot.project) updatedLead.projectName = formSnapshot.project;
      if (formSnapshot.projectId) updatedLead.projectId = formSnapshot.projectId;
      if (teamIdSnapshot) updatedLead.teamId = teamIdSnapshot;
      if (formSnapshot.dealStage) updatedLead.dealStage = formSnapshot.dealStage;
      setFreshLead(updatedLead);
      onSaved(updatedLead);
      syncFormFromSavedLead(updatedLead);
      setSavedOk(overrideStatus ? 'Đã chốt kết quả xác minh.' : 'Đã lưu xác minh. Chưa tạo Cơ hội/Khách hàng nào.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được thông tin xác minh.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitNurturing() {
    if (!nurtureReason.trim()) {
      setError('Nuôi dưỡng cần chọn lý do nuôi dưỡng.');
      return;
    }
    if (!form.nextStepAt) {
      setError('Nuôi dưỡng cần chọn ngày chăm sóc lại.');
      return;
    }
    const payload = buildQualificationPayload();
    payload.status = 'nurturing';
    payload.next_step = nurtureReason.trim();
    payload.note = noteWithVerification(
      'Kết quả xác minh: Nuôi dưỡng',
      [nurtureReason.trim(), form.followUpChannel ? `Kênh chăm sóc: ${form.followUpChannel}` : ''].filter(Boolean).join('\n'),
    );
    await saveVerificationWithPayload(payload, 'Đã lưu Lead vào Nuôi dưỡng.');
  }

  async function submitUnqualified() {
    if (!unqualifiedReason) {
      setError('Vui lòng chọn lý do Không đạt chuẩn.');
      return;
    }
    const payload = buildQualificationPayload();
    payload.status = 'unqualified';
    payload.note = noteWithVerification('Kết quả xác minh: Không đạt chuẩn', unqualifiedReason);
    await saveVerificationWithPayload(payload, 'Đã xác nhận Lead Không đạt chuẩn.');
  }

  async function saveVerificationWithPayload(payload: Record<string, unknown>, okMessage: string) {
    if (!lead) return false;
    setSaving(true);
    setError('');
    setSavedOk('');
    try {
      const formSnapshot = form;
      const teamIdSnapshot = teamId;
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không lưu được kết quả xác minh.');
      const updatedLead = mapLead(body.data);
      if (formSnapshot.project) updatedLead.projectName = formSnapshot.project;
      if (formSnapshot.projectId) updatedLead.projectId = formSnapshot.projectId;
      if (teamIdSnapshot) updatedLead.teamId = teamIdSnapshot;
      if (formSnapshot.dealStage) updatedLead.dealStage = formSnapshot.dealStage;
      setFreshLead(updatedLead);
      onSaved(updatedLead);
      syncFormFromSavedLead(updatedLead);
      setSavedOk(okMessage);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được kết quả xác minh.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleConvert() {
    if (!lead || converting) return;
    setConverting(true);
    setConvertError('');
    try {
      const dealPayload: Record<string, unknown> = {};
      dealPayload.deal_stage = form.dealStage || 'dealing';
      if (form.aeId) dealPayload.sdr_id = form.aeId;
      if (form.nextStep.trim()) dealPayload.next_step = form.nextStep.trim();
      if (form.nextStepAt) dealPayload.follow_up_date = new Date(form.nextStepAt).toISOString();
      if (form.estimatedValue != null) dealPayload.estimated_budget = form.estimatedValue;
      // "Dự án" (feedback leader) - go TEN moi, backend tu tao Project that
      // sau khi convert xong (xem crm_lead_service.convert_lead(), migration
      // 153). Man Xac minh Lead chua co ProjectPicker chon Du an co san.
      if (form.project.trim()) dealPayload.project_name = form.project.trim();
      if (form.projectId) dealPayload.project_id = form.projectId;

      const payload: Record<string, unknown> = {
        deal: dealPayload,
        update_customer: false,
        idempotency_key: idempotencyKeyRef.current,
        contact: {
          name: contact.name.trim() || lead.leadName,
          phone: contact.phone.trim() || null,
          email: contact.email.trim() || null,
          position_category_id: contact.positionCategoryId || null,
          is_primary: true,
        },
      };
      if (customerChoice === 'new') {
        payload.customer = {
          // BUG THAT DA GAP: truoc day luon dung lead.leadName (ten CA NHAN)
          // lam customer_name - Khach hang (crm_customers) la TO CHUC/CONG TY
          // trong mo hinh B2B nay (company_name la field rieng, contact.name
          // moi la nguoi), nen tieu de Khach hang (CrmCustomerDetailPage/
          // CrmCustomersDirectory deu hien thi customer_name lam <h1> chinh)
          // bi doi lot thanh ten nguoi. Uu tien company_name neu Lead co cong
          // ty - dung CHINH pattern fallback da dung san o hien thi dropdown
          // "Doanh nghiep" ngay ben duoi (dong ~624/632: lead.companyName ||
          // lead.leadName) - chi Lead ca nhan/khong co cong ty moi fallback
          // ve leadName (customer_name NOT NULL, khong the de rong).
          customer_name: lead.companyName || lead.leadName,
          company_name: lead.companyName || null,
          tax_code: lead.taxCode || null,
          position_category_id: lead.positionCategoryId || null,
          phone: lead.phone || null,
          email: lead.email || null,
          zalo: lead.zalo || null,
          facebook: lead.facebook || null,
          telegram: lead.telegram || null,
          website: lead.website || null,
          source: lead.source || null,
        };
      } else {
        payload.customer_id = customerChoice;
      }

      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(lead.id)}/convert`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Tạo cơ hội thất bại.');
      const result = body.data || {};
      const newCustomerId = result.customer?.id || result.customer_id || '';
      onSaved({
        ...lead,
        status: 'sql',
        convertedCustomerId: newCustomerId,
        convertedContactId: result.contact?.id || result.contact_id || '',
        convertedDealId: result.deal?.id || result.deal_id || '',
      });
      setConvertOpen(false);
      // Feedback 2026-09-26: "xác minh lead xong thì tự trỏ về đúng trang chi
      // tiết khách hàng" - truoc day chi hien man "Da tao co hoi" tinh, phai
      // tu bam link "Xem Khách hàng" moi qua duoc. Dong drawer + dieu huong
      // thang, khong can cho user bam them.
      if (newCustomerId) {
        onClose();
        router.push(`/all-platform/crm/customers/${newCustomerId}?tab=deals`);
      }
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Tạo cơ hội thất bại.');
    } finally {
      setConverting(false);
    }
  }

  /** Lưu xác minh trước rồi mới mở bước xác nhận Convert (giữ nguyên bước xác
   * nhận cũ, không dựng lại) — để dữ liệu vừa nhập chắc chắn đã nằm trên lead
   * trước khi RPC đọc nó. */
  async function openConvertConfirm() {
    if (!isReady) {
      setError('SQL cần hoàn thành đủ Mức sẵn sàng tạo cơ hội.');
      readinessRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (!teamId) {
      setError('SQL bắt buộc chọn Team Sale.');
      return;
    }
    if (!form.aeId) {
      setError('SQL bắt buộc chọn Sale nhận bàn giao.');
      return;
    }
    const ok = await saveVerification();
    if (ok) setConvertOpen(true);
  }

  async function submitFinalOutcome() {
    // 'pending' = chua du du lieu de he thong ket luan - nut submit da bi
    // disable o footer, day chi la guard phong thu (khong duoc rot vao
    // nhanh Khong dat chuan mac dinh nhu truoc khi tach rieng 'pending').
    if (verificationOutcome === 'pending') return;
    if (verificationOutcome === 'sql') {
      await openConvertConfirm();
      return;
    }
    if (verificationOutcome === 'nurturing') {
      await submitNurturing();
      return;
    }
    await submitUnqualified();
  }

  const finalSubmitLabel =
    verificationOutcome === 'sql'
      ? 'Tạo cơ hội & bàn giao Sale'
      : verificationOutcome === 'nurturing'
        ? 'Lưu vào Nuôi dưỡng'
        : verificationOutcome === 'unqualified'
          ? 'Xác nhận không đạt chuẩn'
          : 'Chưa đủ dữ liệu để lưu kết quả';

  // "Tóm tắt quyết định" — cot phai KHONG con la checklist ky thuat (chi
  // dung/sai) ma hien gia tri that de SDR/Sale ra quyet dinh nhanh, dung thu
  // tu da chot: Nhu cau -> Gia tri -> ICP -> Thoi gian trien khai -> Viec tiep
  // theo -> Sale nhan ban giao -> Check trung.
  const decisionRows = [
    { key: 'need', label: 'Nhu cầu', value: form.interest.trim() || '—', ok: Boolean(form.interest.trim()) },
    {
      key: 'value',
      label: 'Giá trị ước tính',
      value: formatEstimatedValue(form.estimatedValue),
      ok: form.estimatedValue != null,
    },
    {
      key: 'icp',
      label: 'ICP',
      value: ICP_OPTIONS.find(o => o.value === icpFit)?.label || '—',
      ok: icpFit !== 'unknown',
    },
    { key: 'timeline', label: 'Thời gian triển khai', value: form.timeline || '—', ok: Boolean(form.timeline) },
    {
      key: 'next',
      label: 'Tiếp theo',
      value: form.nextStep.trim()
        ? `${form.nextStep}${form.nextStepAt ? ' · ' + new Date(form.nextStepAt).toLocaleString('vi-VN') : ''}`
        : '—',
      ok: Boolean(form.nextStep.trim()) && Boolean(form.nextStepAt),
    },
    { key: 'ae', label: 'Sale nhận bàn giao', value: form.aeId ? aeName(form.aeId) : '—', ok: Boolean(form.aeId) },
    { key: 'stage', label: 'Giai đoạn', value: DEAL_STAGE_META[form.dealStage as keyof typeof DEAL_STAGE_META]?.label || form.dealStage, ok: true },
    {
      key: 'dup',
      label: 'Check trùng doanh nghiệp',
      value: dupChecked ? (companyMatches.length ? `${companyMatches.length} khả năng trùng` : 'Không trùng') : 'Chưa kiểm tra',
      ok: dupChecked,
    },
  ];

  return (
    <>
      {/* Visual-only layer: LeadsDirectory handles click-away so the lead list stays interactive. */}
      <div className="crm-drawer-backdrop crm-lead-verify-backdrop crm-lead-verify-backdrop--passive" />
      <aside className="crm-drawer crm-lead-detail-drawer crm-verify-drawer">
        <header className="crm-lead-drawer-header crm-verify-header">
          <div className="crm-verify-header-text">
            <h2>
              Xác minh Lead
              <span
                className="crm-help-icon"
                tabIndex={0}
                title="SDR chỉ cần xác nhận vài thông tin then chốt. Hệ thống tự chấm điểm Lead và dùng nội dung trao đổi, nguồn Lead, thông tin doanh nghiệp để gợi ý nhu cầu, mức phù hợp, giá trị và việc tiếp theo."
              >
                <HelpCircle className="crm-icon" />
              </span>
            </h2>
          </div>
          <div className="crm-lead-drawer-header-actions">
            {isConverted && canWrite ? (
              <button
                type="button"
                className="crm-secondary-button crm-button-sm"
                data-testid="lead-detail-edit-qualification"
                onClick={() => setQualificationEditOpen(open => !open)}
              >
                {qualificationEditOpen ? 'Xem (khoá sửa)' : 'Chỉnh sửa thông tin xác minh'}
              </button>
            ) : null}
            {onEdit ? (
              <button
                type="button"
                className="crm-secondary-button crm-button-sm"
                data-testid="lead-detail-edit"
                onClick={() => onEdit(lead)}
              >
                Sửa thông tin Lead
              </button>
            ) : null}
            <button type="button" className="crm-drawer-close" onClick={onClose} aria-label="Đóng">
              <X className="crm-icon" />
            </button>
          </div>
        </header>

        <div className="crm-drawer-body crm-lead-drawer-body crm-verify-body" ref={bodyRef}>
          {error ? <p className="crm-error">{error}</p> : null}
          {savedOk ? <p className="crm-verify-ok">{savedOk}</p> : null}

          <section className="crm-verify-summary">
            <span className="crm-verify-avatar" aria-hidden>{initialOf(lead.leadName)}</span>
            <div className="crm-verify-summary-main">
              <p className="crm-verify-name">{lead.leadName}</p>
              <p className="crm-verify-sub">
                {[lead.positionLabelSnapshot || lead.position, lead.companyName].filter(Boolean).join(' · ') || 'Chưa có chức vụ/công ty'}
              </p>
              <p className="crm-verify-sub">
                {lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : <span>Chưa có SĐT</span>}
                <span className="crm-verify-dot">·</span>
                {lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span>Chưa có email</span>}
              </p>
              <p className="crm-verify-sub">Công ty: {lead.companyName || 'Chưa có'} <span className="crm-verify-dot">·</span> SDR: {aeName(lead.sdrId)}</p>
            </div>
            <div className="crm-verify-score">
              <b>{displayScore == null ? '—' : displayScore}</b>
              <span>ĐIỂM LEAD</span>
            </div>
          </section>

          {isConverted ? (
            <section className="crm-terminal-note crm-terminal-note--won">
              <CheckCircle2 className="crm-line-icon" />
              <div>
                <strong>Lead đã được tạo cơ hội.</strong>
                {lead.convertedCustomerId ? (
                  <p><Link href={`/all-platform/crm/customers/${lead.convertedCustomerId}`} target="_blank">Xem Khách hàng</Link></p>
                ) : null}
              </div>
            </section>
          ) : null}

          {convertOpen ? (
            <section className="crm-form-section crm-lead-convert-section" id="crm-lead-convert">
              <p className="crm-form-title">Xác nhận tạo cơ hội &amp; bàn giao Sale</p>
              <div className="crm-lead-convert-confirm">
                {convertError ? <p className="crm-error">{convertError}</p> : null}

                <div className="crm-lead-convert-summary">
                  <b>Deal sẽ được tạo với:</b>
                  <div className="crm-convert-kpi-grid">
                    <div className="crm-convert-kpi-card">
                      <span>Tên cơ hội</span>
                      <b>{[lead.companyName || lead.leadName, form.interest].filter(Boolean).join(' - ')}</b>
                    </div>
                    <div className="crm-convert-kpi-card">
                      <span>Giá trị dự kiến</span>
                      <b>{formatEstimatedValue(form.estimatedValue)}</b>
                    </div>
                    <div className="crm-convert-kpi-card">
                      <span>Giai đoạn</span>
                      <b>{DEAL_STAGE_META[form.dealStage as keyof typeof DEAL_STAGE_META]?.label || form.dealStage}</b>
                    </div>
                    <div className="crm-convert-kpi-card">
                      <span>Mức quan tâm</span>
                      <b>{INTEREST_LEVEL_OPTIONS.find(o => o.value === form.interestLevel)?.label || 'Chưa có'}</b>
                    </div>
                  </div>
                  <div className="crm-convert-columns">
                    <div className="crm-convert-column">
                      <p className="crm-convert-column-title">Sale cần xử lý</p>
                      <div className="crm-convert-row"><span>Sale nhận bàn giao</span><b>{aeName(form.aeId || lead.sdrId)}</b></div>
                      <div className="crm-convert-row"><span>Việc tiếp theo</span><b>{form.nextStep || 'Chưa có'}</b></div>
                      <div className="crm-convert-row"><span>Hạn follow-up</span><b>{form.nextStepAt ? new Date(form.nextStepAt).toLocaleString('vi-VN') : 'Chưa có'}</b></div>
                      <div className="crm-convert-row"><span>Người liên hệ</span><b>{contact.name || lead.leadName}</b></div>
                    </div>
                    <div className="crm-convert-column">
                      <p className="crm-convert-column-title">Khách hàng</p>
                      <div className="crm-convert-row"><span>Tên khách hàng</span><b>{lead.companyName || lead.leadName}</b></div>
                      <div className="crm-convert-row"><span>SĐT</span><b>{lead.phone || 'Chưa có'}</b></div>
                      <div className="crm-convert-row"><span>Nguồn</span><b>{getSourceLabel(lead.source || 'Manual')}</b></div>
                      <div className="crm-convert-row"><span>Marketing</span><b>{aeName(lead.createdBy)}</b></div>
                    </div>
                  </div>
                </div>

                <div className="crm-lead-qualification-actions">
                  <button type="button" className="crm-secondary-button" disabled={converting} onClick={() => setConvertOpen(false)}>
                    Quay lại
                  </button>
                  <button type="button" className="crm-primary-button" disabled={converting} onClick={() => void handleConvert()}>
                    {converting ? <Loader2 className="crm-save-spinner" /> : null} Xác nhận tạo cơ hội
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              {!isConverted ? (
                <>
                  <section className="crm-verify-suggest">
                    <div className="crm-verify-suggest-head">
                      <p className="crm-form-title">
                        Gợi ý từ dữ liệu Lead
                        <span
                          className="crm-help-icon"
                          tabIndex={0}
                          title="Gợi ý theo quy tắc từ ghi chú, nguồn Lead và công ty đang có — không phải AI. Chỉ điền vào ô đang trống, không ghi đè dữ liệu SDR đã nhập."
                        >
                          <HelpCircle className="crm-icon" />
                        </span>
                      </p>
                      <span className={`crm-verify-suggest-pill ${suggestionUsed ? 'is-used' : ''}`}>
                        {suggestionUsed ? 'Đã dùng gợi ý' : 'Chưa dùng gợi ý'}
                      </span>
                    </div>
                    <div className="crm-verify-suggest-actions">
                      <button type="button" className="crm-secondary-button" disabled={!canWrite} onClick={applySuggestion}>
                        Dùng gợi ý
                      </button>
                      <button type="button" className="crm-ghost-button" disabled={!canWrite} onClick={resetSuggestion}>
                        Đặt lại
                      </button>
                    </div>
                  </section>

                  <div className="crm-verify-kpi-strip">
                    <div><span>Nguồn Lead</span><b>{getSourceLabel(lead.source || 'Manual')}</b></div>
                    <div><span>Trạng thái</span><b>{lead.status || 'MQL'}</b></div>
                    <div><span>Owner</span><b>{aeName(lead.sdrId)}</b></div>
                    <div><span>Gợi ý</span><b>{suggestionUsed ? 'Đã dùng' : 'Chưa dùng'}</b></div>
                  </div>
                </>
              ) : null}

              {/* Lead đã convert - hiện lại đủ 3 khối Thông tin then chốt/
               * Bàn giao Sale/Tóm tắt quyết định ở dạng READ-ONLY (feedback:
               * "cái này cho hiển thị full... phần này chưa làm này" - trước
               * đây bị ẩn trắng hết, chỉ còn mỗi banner xanh) - canWrite ép
               * về false dù lead.canWrite là gì, vì sửa ở đây KHÔNG tự đồng
               * bộ ngược lại Deal/Khách hàng thật đã tạo (muốn sửa thật phải
               * qua đúng trang Khách hàng/Cơ hội). */}
              <LeadDealQualificationPanel
                canWrite={canWrite && (!isConverted || qualificationEditOpen)}
                interest={form.interest}
                onInterestChange={value => setField('interest', value)}
                estimatedValue={form.estimatedValue}
                onEstimatedValueChange={value => setField('estimatedValue', value)}
                interestLevel={form.interestLevel}
                onInterestLevelChange={setInterestLevel}
                timeline={form.timeline}
                onTimelineChange={value => setField('timeline', value)}
                project={form.project}
                projectOptions={projectOptions}
                onPickProject={p => setForm(prev => ({ ...prev, project: p.name, projectId: p.id }))}
                onProjectChange={value => setForm(prev => ({ ...prev, project: value, projectId: '' }))}
                note={form.note}
                onNoteChange={value => setField('note', value)}
                teamId={teamId}
                onTeamIdChange={handleTeamIdChange}
                teamOptions={teamOptionsForSelect}
                teamActions={teamActions}
                aeId={form.aeId}
                onAeIdChange={value => setField('aeId', value)}
                aeOptions={aeOptions}
                contactName={contact.name}
                onContactNameChange={value => setContact(c => ({ ...c, name: value }))}
                nextStep={form.nextStep}
                onNextStepChange={value => setField('nextStep', value)}
                nextStepAt={form.nextStepAt}
                onNextStepAtChange={value => setField('nextStepAt', value)}
                dealStage={form.dealStage}
                onDealStageChange={value => setField('dealStage', value)}
                verificationOutcome={verificationOutcome}
                ruleConditions={ruleConditions}
                outcomeReasons={outcomeReasons}
                outcomeMissing={outcomeMissing}
                sqlProgress={sqlProgress}
                nurtureReason={nurtureReason}
                onNurtureReasonChange={setNurtureReason}
                unqualifiedReason={unqualifiedReason}
                onUnqualifiedReasonChange={setUnqualifiedReason}
                followUpChannel={form.followUpChannel}
                onFollowUpChannelChange={value => setField('followUpChannel', value)}
                nextStepWarning={nextStepWarning}
                decisionRows={decisionRows}
                readinessLabel={readinessLabel}
                readinessTone={readinessTone}
                extraHint={companyMatches.length ? (
                  <p className="crm-ai-fill-hint">
                    Tìm thấy {companyMatches.length} doanh nghiệp có thể trùng — hệ thống vẫn sẽ tạo doanh nghiệp mới khi bấm xác nhận.
                  </p>
                ) : null}
                readinessRef={readinessRef}
              />
            </>
          )}
        </div>

        {!isConverted && canWrite && !convertOpen ? (
          <footer className="crm-drawer-footer crm-verify-footer">
            <div className="crm-footer-actions">
              <button type="button" className="crm-secondary-button" disabled={saving} onClick={() => void saveVerification()}>
                {saving ? <Loader2 className="crm-save-spinner" /> : null} Lưu nháp
              </button>
              <button
                type="button"
                className="crm-primary-button"
                disabled={saving || verificationOutcome === 'pending'}
                title={
                  verificationOutcome === 'pending'
                    ? 'Hệ thống chưa đủ dữ liệu để phân loại Lead này — bổ sung thêm thông tin bên trên.'
                    : verificationOutcome === 'sql' && !isReady
                      ? 'Hoàn tất checklist "Mức sẵn sàng tạo cơ hội" trước'
                      : undefined
                }
                onClick={() => void submitFinalOutcome()}
              >
                {finalSubmitLabel}
              </button>
            </div>
          </footer>
        ) : null}

        {/* Lead da convert, dang mo khoa sua (qualificationEditOpen) - CHI
         * Luu thay doi thuong vao dung Lead (saveVerification(), giong het
         * nut "Lưu nháp" cua nhanh chua convert) - KHONG dung
         * submitFinalOutcome/handleConvert o day vi se tao trung Deal/
         * Customer moi hoac doi status ngoai y muon. */}
        {isConverted && canWrite && qualificationEditOpen ? (
          <footer className="crm-drawer-footer crm-verify-footer">
            <div className="crm-footer-actions">
              <button type="button" className="crm-secondary-button" disabled={saving} onClick={() => setQualificationEditOpen(false)}>
                Huỷ
              </button>
              <button
                type="button"
                className="crm-primary-button"
                disabled={saving}
                onClick={async () => {
                  const ok = await saveVerification();
                  if (ok) setQualificationEditOpen(false);
                }}
              >
                {saving ? <Loader2 className="crm-save-spinner" /> : null} Lưu thay đổi
              </button>
            </div>
          </footer>
        ) : null}
      </aside>

      <CrmTeamFormModal
        open={addTeamOpen}
        editingId={null}
        initialTeam={null}
        leaders={teamLeaders}
        allUsers={teamAllUsers}
        allowAddMembersAfterCreate
        onClose={() => setAddTeamOpen(false)}
        onSaved={newTeam => {
          setAddTeamOpen(false);
          setTeamOptions(prev => [...prev, newTeam]);
          handleTeamIdChange(newTeam.id);
        }}
      />
    </>
  );
}

function Field({
  label,
  full,
  hint,
  required,
  children,
}: {
  label: string;
  full?: boolean;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`crm-field ${full ? 'crm-field--full' : ''}`}>
      <span>{label}{required ? ' *' : ''}</span>
      {children}
      {hint ? <small className="crm-verify-hint">{hint}</small> : null}
    </label>
  );
}
