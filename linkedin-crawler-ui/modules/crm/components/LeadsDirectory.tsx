'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { useMembers } from '@/hooks/useMembers';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { LeadFormDrawer } from './LeadFormDrawer';
import { LeadDetailDrawer } from './LeadDetailDrawer';
import { LeadEditDrawer } from './LeadEditDrawer';
import { LeadImportDialog } from './LeadImportDialog';
import { SearchableSelect } from './SearchableSelect';
import { useCrmCategoryCodeOptions } from './CrmCategorySelect';
import { Loader2, Trash2 } from './icons';
import {
  Users,
  Sparkles,
  CheckCircle2,
  HeartHandshake,
  XCircle,
  Search,
  Building2,
  Phone,
  Mail,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Target,
} from 'lucide-react';
import type { CrmLeadKpi, CrmLeadRow, CrmLeadStatus } from '../types';
import { cascadeLossText, cascadeSummaryFromBody, describeCascadeSummary, sumCascadeSummaries, type CascadeSummary } from '../utils/cascadeDelete';

const AVATAR_COLORS = [
  { bg: '#eff6ff', text: '#2563eb' },
  { bg: '#fdf2f8', text: '#db2777' },
  { bg: '#f0fdf4', text: '#16a34a' },
  { bg: '#fffbeb', text: '#d97706' },
  { bg: '#faf5ff', text: '#9333ea' },
  { bg: '#f0fdfa', text: '#0d9488' },
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function getInitials(name: string) {
  if (!name) return 'L';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Main la CRM markee CO DINH (khong co /auth/workspaces/switcher nhu 3
// clone) - danh sach workspace dich khi sao chep Lead CHI CO 2 clone doc
// lap con lai, khai bao TINH tai day thay vi goi API.
const COPY_TARGET_OPTIONS: { instance: string; label: string }[] = [
  { instance: 'cloudgate', label: 'CloudGate' },
  { instance: 'SECURITYZONE', label: 'SecurityZone' },
];

const STATUS_OPTIONS: Array<{ value: CrmLeadStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'mql', label: 'MQL' },
  { value: 'sql', label: 'SQL' },
  { value: 'nurturing', label: 'Nuôi dưỡng' },
  { value: 'unqualified', label: 'Không đạt chuẩn' },
];

export const LEAD_STATUS_LABEL: Record<string, string> = {
  mql: 'MQL',
  sql: 'SQL',
  nurturing: 'Nuôi dưỡng',
  unqualified: 'Không đạt chuẩn',
  new_lead: 'MQL',
  qualifying: 'MQL',
  qualified: 'SQL',
  nurture: 'Nuôi dưỡng',
  converted: 'SQL',
  disqualified: 'Không đạt chuẩn',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  mql: 'crm-lead-status--new',
  sql: 'crm-lead-status--qualified',
  nurturing: 'crm-lead-status--nurture',
  unqualified: 'crm-lead-status--disqualified',
  new_lead: 'crm-lead-status--new',
  qualifying: 'crm-lead-status--qualifying',
  qualified: 'crm-lead-status--qualified',
  nurture: 'crm-lead-status--nurture',
  converted: 'crm-lead-status--converted',
  disqualified: 'crm-lead-status--disqualified',
};

const PAGE_SIZE = 20;

type ApiLeadRow = {
  id: string;
  lead_name?: string | null;
  company_name?: string | null;
  position?: string | null;
  position_category_id?: string | null;
  position_label_snapshot?: string | null;
  phone?: string | null;
  email?: string | null;
  zalo?: string | null;
  facebook?: string | null;
  telegram?: string | null;
  website?: string | null;
  source?: string | null;
  status?: CrmLeadStatus | null;
  score?: number | null;
  sdr_id?: string | null;
  note?: string | null;
  qualification_need?: string | null;
  qualification_icp_fit?: boolean | null;
  qualification_estimated_value?: number | null;
  qualification_decision_maker?: string | null;
  qualification_expected_timeline?: string | null;
  qualification_ae_id?: string | null;
  next_step?: string | null;
  follow_up_date?: string | null;
  converted_customer_id?: string | null;
  converted_contact_id?: string | null;
  converted_deal_id?: string | null;
  converted_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  can_write?: boolean | null;
};

type ApiListResponse = {
  items?: ApiLeadRow[];
  total?: number;
  page?: number;
  page_size?: number;
  kpi?: Partial<CrmLeadKpi>;
};

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

export function mapLead(row: ApiLeadRow): CrmLeadRow {
  return {
    id: row.id,
    leadName: row.lead_name || 'Lead chưa tên',
    companyName: row.company_name || '',
    position: row.position || '',
    positionCategoryId: row.position_category_id || '',
    positionLabelSnapshot: row.position_label_snapshot || '',
    phone: row.phone || '',
    email: row.email || '',
    zalo: row.zalo || '',
    facebook: row.facebook || '',
    telegram: row.telegram || '',
    website: row.website || '',
    source: row.source || '',
    status: row.status || 'mql',
    score: row.score ?? null,
    sdrId: row.sdr_id || '',
    note: row.note || '',
    qualificationNeed: row.qualification_need || '',
    qualificationIcpFit: row.qualification_icp_fit ?? null,
    qualificationEstimatedValue: row.qualification_estimated_value ?? null,
    qualificationDecisionMaker: row.qualification_decision_maker || '',
    qualificationExpectedTimeline: row.qualification_expected_timeline || '',
    qualificationAeId: row.qualification_ae_id || '',
    nextStep: row.next_step || '',
    followUpDate: row.follow_up_date || '',
    convertedCustomerId: row.converted_customer_id || '',
    convertedContactId: row.converted_contact_id || '',
    convertedDealId: row.converted_deal_id || '',
    convertedAt: row.converted_at || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    canWrite: Boolean(row.can_write),
  };
}

export function LeadsDirectory() {
  const { user, isLoading: authLoading } = useAppAuth();
  const { members, loading: membersLoading } = useMembers();
  const [items, setItems] = useState<CrmLeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<CrmLeadKpi>({ total: 0, mql: 0, sql: 0, nurturing: 0, unqualified: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [sdrId, setSdrId] = useState('');
  const [team, setTeam] = useState('');
  // "Team" = phong ban that trong members (HR roster) - dung LAI DUNG nguon
  // da chot cho Quan ly tien do, loc theo team cua SDR phu trach (sdr_id)
  // tren backend.
  const teamOptions = useMemo(
    () => Array.from(new Set(members.map(m => m.team).filter(Boolean))) as string[],
    [members]
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<CrmLeadRow | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'qualify' | 'convert'>('view');
  const [editLead, setEditLead] = useState<CrmLeadRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CrmLeadRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const { options: sourceOptions } = useCrmCategoryCodeOptions('crm_source');

  // Sao chep Lead (chua convert) sang 1 trong 2 clone CRM doc lap con lai -
  // Lead goc van giu nguyen o Main (khong phai "chuyen han"). Chi Admin
  // THAT moi thay/dung duoc (backend cung chan y het).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copyLeadIds, setCopyLeadIds] = useState<string[]>([]);
  // Moi Lead trong copyLeadIds duoc chon 1 workspace dich RIENG (khong bat
  // buoc ca lo cung 1 dich) - map lead_id -> instance dich.
  const [copyTargets, setCopyTargets] = useState<Record<string, string>>({});
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [copyFailures, setCopyFailures] = useState<Array<{ lead_id: string; message: string }>>([]);
  const canCopyInstance = user?.role === 'admin';
  const copyReady = copyLeadIds.length > 0 && copyLeadIds.every(id => copyTargets[id]);

  // Chức năng: Thao tác xóa hàng loạt Lead (Bulk Delete).
  // Quản lý trạng thái mở modal xác nhận, trạng thái loading khi gọi API và thông báo lỗi.
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState('');
  // Buoc 2 cua xoa hang loat: id cac Lead con du lieu lien quan + tong so se mat.
  const [bulkCascadeIds, setBulkCascadeIds] = useState<string[]>([]);
  const [bulkCascadeSummary, setBulkCascadeSummary] = useState<CascadeSummary | null>(null);
  // Buoc 2 cua xoa 1 Lead: so du lieu lien quan se bi xoa kem (null = buoc 1).
  const [deleteCascadeSummary, setDeleteCascadeSummary] = useState<CascadeSummary | null>(null);
  const deleteCascadeConfirm = deleteCascadeSummary !== null;

  // Chon nhieu de XOA (feedback 2026-09-23: "select 1 hoặc nhiều -> Xóa") -
  // moi Lead nguoi dung co quyen ghi deu chon duoc, ke ca Lead da convert
  // (backend se hoi xac nhan rieng). Sao chep workspace van loai Lead da
  // convert (backend chan) - loc o openCopyModalForSelection().
  const selectableItems = items;
  // BUG THAT DA GAP (fix 9cd93003, ap dung lai o day sau khi merge nhanh
  // feat/crm-quote-feedback-main-first): backend chuan hoa lead.status ve
  // vocab hien thi (mql/sql/nurturing/unqualified) TRUOC KHI tra ve frontend
  // (_normalize_lead_status, LEAD_STATUS_MAP: 'converted' -> 'sql') - frontend
  // KHONG BAO GIO thay gia tri tho 'converted', nen check "=== 'converted'"
  // la dead code (luon false). Dung 'sql' + convertedCustomerId (field that,
  // luon duoc set that su khi convert) de nhan dien dung."
  const isConvertedLead = (lead: CrmLeadRow) => lead.status === 'sql' || Boolean(lead.convertedCustomerId);
  const allOnPageSelected = selectableItems.length > 0 && selectableItems.every(lead => selectedIds.has(lead.id));

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) selectableItems.forEach(lead => next.delete(lead.id));
      else selectableItems.forEach(lead => next.add(lead.id));
      return next;
    });
  }

  function openCopyModalForSelection() {
    const copyable = items.filter(lead => selectedIds.has(lead.id) && !isConvertedLead(lead)).map(lead => lead.id);
    if (copyable.length === 0) {
      window.alert('Các Lead đã chọn đều đã chuyển đổi — không sao chép được sang workspace khác.');
      return;
    }
    setCopyLeadIds(copyable);
    setCopyTargets({});
    setCopyError('');
    setCopyFailures([]);
  }

  function openCopyModal(lead: CrmLeadRow) {
    setCopyLeadIds([lead.id]);
    setCopyTargets({});
    setCopyError('');
    setCopyFailures([]);
  }

  function closeCopyModal() {
    if (copying) return;
    setCopyLeadIds([]);
    setCopyTargets({});
    setCopyError('');
    setCopyFailures([]);
  }

  function setCopyTargetFor(leadId: string, instance: string) {
    setCopyTargets(prev => ({ ...prev, [leadId]: instance }));
  }

  function applyTargetToAll(instance: string) {
    setCopyTargets(prev => {
      const next = { ...prev };
      copyLeadIds.forEach(id => { next[id] = instance; });
      return next;
    });
  }

  async function confirmCopy() {
    if (!copyReady || copying) return;
    setCopying(true);
    setCopyError('');
    setCopyFailures([]);
    try {
      const assignments = copyLeadIds.map(id => ({ lead_id: id, target_instance: copyTargets[id] }));
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/copy-instance`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify({ assignments }),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body?.message || 'Không sao chép được sang workspace khác.');
      const failures = (body.data?.failed || []) as Array<{ lead_id: string; message: string }>;
      if (failures.length > 0) {
        setCopyFailures(failures);
        const failedIds = new Set(failures.map(f => f.lead_id));
        setSelectedIds(prev => new Set([...prev].filter(id => failedIds.has(id))));
        setCopyLeadIds(failures.map(f => f.lead_id));
      } else {
        setSelectedIds(new Set());
        setCopyLeadIds([]);
        setCopyTargets({});
      }
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Không sao chép được sang workspace khác.');
    } finally {
      setCopying(false);
    }
  }

  /**
   * Chức năng: Xử lý gọi API xóa hàng loạt (Bulk Delete) các Lead đã được tick chọn.
   * Thay đổi:
   * - Gọi POST /api/all-platform/crm/leads/bulk-delete với danh sách ID đã chọn.
   * - Sau khi xóa thành công: cập nhật state items, giảm số lượng total, xóa ID khỏi selectedIds.
   * - Tự động reload lại dữ liệu và đồng bộ chỉ số KPI qua setReloadTick.
   * - Đóng modal xác nhận và thông báo chi tiết nếu có Lead không thể xóa.
   */
  async function confirmBulkDelete(confirmCascade = false) {
    const targetIds = confirmCascade ? bulkCascadeIds : Array.from(selectedIds);
    if (targetIds.length === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    setBulkDeleteError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/leads/bulk-delete`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify({ lead_ids: targetIds, confirm_cascade: confirmCascade }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || body?.detail || `Không thể xóa các Lead đã chọn (lỗi ${res.status}).`);
      const deletedIds = (body.data?.deleted_ids || []) as string[];
      const failed = (body.data?.failed || []) as Array<{ lead_id: string; message: string; requiresCascadeConfirm?: boolean; summary?: CascadeSummary | null }>;
      const deletedSet = new Set(deletedIds);
      if (deletedIds.length) {
        // Cập nhật ngay danh sách Lead trên giao diện người dùng
        setItems(current => current.filter(row => !deletedSet.has(row.id)));
        setTotal(current => Math.max(0, current - deletedIds.length));
        setSelectedIds(prev => {
          const next = new Set(prev);
          deletedIds.forEach(id => next.delete(id));
          return next;
        });
        // Kích hoạt reload để đồng bộ lại KPI và số liệu tổng
        setReloadTick(tick => tick + 1);
      }
      // Lead da convert: KHONG chan cung nua - chuyen modal sang buoc 2 hoi
      // xac nhan rieng cho dung cac Lead nay (feedback 2026-09-23).
      const needConfirm = confirmCascade ? [] : failed.filter(f => f.requiresCascadeConfirm);
      const cascadeIds = needConfirm.map(f => f.lead_id);
      const otherFailed = failed.filter(f => confirmCascade || !f.requiresCascadeConfirm);
      if (cascadeIds.length) {
        setBulkCascadeIds(cascadeIds);
        setBulkCascadeSummary(sumCascadeSummaries(needConfirm.map(f => f.summary || {})));
        if (otherFailed.length) setBulkDeleteError(`${otherFailed.length} Lead không xóa được: ${otherFailed[0].message}`);
        return;
      }
      if (!deletedIds.length && otherFailed.length) {
        throw new Error(body?.message || otherFailed[0].message || 'Không thể xóa các Lead đã chọn.');
      }
      setBulkCascadeIds([]);
      setBulkCascadeSummary(null);
      setBulkDeleteOpen(false);
      if (otherFailed.length) {
        alert(`Đã xóa ${deletedIds.length} Lead. Có ${otherFailed.length} Lead không thể xóa do thiếu quyền hoặc lỗi khác.`);
      }
    } catch (err) {
      setBulkDeleteError(err instanceof Error ? err.message : 'Không thể xóa các Lead đã chọn.');
    } finally {
      setBulkDeleting(false);
    }
  }


  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Mac dinh loc "cua toi + team cua toi" khi vao trang (thay vi "Tat ca") -
  // xem giai thich chi tiet o CrmCustomersDirectory.tsx (cung 1 rule, chi
  // doi ownerId/owner_id -> sdrId/sdr_id). Rule tim team CHINH XAC khop
  // _user_department_map() o backend: chi xet members.linked_user_id.
  const defaultFilterAppliedRef = useRef(false);
  const applyDefaultOwnerFilter = useCallback(() => {
    if (!user?.id) return;
    setSdrId(user.id);
    const myMember = members.find(m => m.linked_user_id === user.id);
    setTeam(myMember?.team || '');
  }, [user, members]);

  // Feedback nguoi dung (2026-09-25): quay lai trang Leads (Back, hoac dieu
  // huong sang trang khac roi vao lai) phai hien DUNG lich su tim kiem/loc
  // gan nhat cua chinh minh trong tab nay, giong het co che da lam cho trang
  // Khach hang (CrmCustomersDirectory.tsx) - dung sessionStorage, scope theo
  // user.id, chi ap dung default "cua toi + team cua toi" khi CHUA co lich
  // su nao trong session.
  type StoredLeadFilters = {
    userId: string;
    search: string;
    status: string;
    source: string;
    sdrId: string;
    team: string;
  };
  const FILTERS_STORAGE_KEY = 'crm-leads-filters';

  useEffect(() => {
    if (defaultFilterAppliedRef.current) return;
    if (authLoading || membersLoading) return;
    if (!user?.id) return;
    defaultFilterAppliedRef.current = true;

    let stored: StoredLeadFilters | null = null;
    try {
      const raw = window.sessionStorage.getItem(FILTERS_STORAGE_KEY);
      stored = raw ? (JSON.parse(raw) as StoredLeadFilters) : null;
    } catch {
      stored = null;
    }

    if (stored && stored.userId === user.id) {
      setSearchInput(stored.search);
      setSearch(stored.search);
      setStatus(stored.status);
      setSource(stored.source);
      setSdrId(stored.sdrId);
      setTeam(stored.team);
      return;
    }

    applyDefaultOwnerFilter();
  }, [authLoading, membersLoading, user, members, applyDefaultOwnerFilter]);

  useEffect(() => {
    if (!user?.id) return;
    if (!defaultFilterAppliedRef.current) return; // chua khoi tao xong (dang doi auth/members) - tranh ghi de bang state rong luc mount
    try {
      const payload: StoredLeadFilters = { userId: user.id, search, status, source, sdrId, team };
      window.sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage khong kha dung (che do an danh...) - bo qua, khong chan UI
    }
  }, [user, search, status, source, sdrId, team]);

  useEffect(() => { setPage(1); }, [pageSize, status, source, sdrId, team]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, search, status, source, sdrId, team]);

  const load = useCallback(() => {
    let alive = true;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (sdrId) params.set('sdr_id', sdrId);
    if (team) params.set('team', team);
    setLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/leads?${params.toString()}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được danh sách Lead.');
        return body.data as ApiListResponse;
      })
      .then(data => {
        if (!alive) return;
        setItems((data.items || []).map(mapLead));
        setTotal(data.total || 0);
        const rawKpi = (data.kpi || {}) as Record<string, number | undefined>;
        setKpi({
          total: data.kpi?.total ?? 0,
          mql: rawKpi.mql ?? rawKpi.new_lead ?? 0,
          sql: rawKpi.sql ?? rawKpi.qualified ?? 0,
          nurturing: rawKpi.nurturing ?? rawKpi.nurture ?? 0,
          unqualified: rawKpi.unqualified ?? rawKpi.disqualified ?? 0,
        });
        setError('');
      })
      .catch(err => {
        if (!alive) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Không tải được danh sách Lead.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [page, pageSize, search, status, source, sdrId, team]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load, reloadTick]);

  const sdrName = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) map.set(key, m.display_name);
    });
    if (user?.id && !map.has(user.id)) map.set(user.id, user.name || user.email);
    return map;
  }, [members, user]);

  const sdrFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) seen.set(key, m.display_name);
    });
    // Dam bao option "chinh minh" luon co trong dropdown ke ca khi user hien
    // tai khong co dong trong `members` - xem giai thich o
    // CrmCustomersDirectory.tsx (ownerFilterOptions).
    if (user?.id && !seen.has(user.id)) seen.set(user.id, user.name || user.email);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [members, user]);

  const kpiCards = [
    {
      id: '',
      label: 'Tổng Lead',
      value: kpi.total,
      icon: Users,
      tone: 'tone-slate',
      pct: null,
      isActive: !status,
    },
    {
      id: 'mql',
      label: 'MQL (Tiềm năng)',
      value: kpi.mql,
      icon: Sparkles,
      tone: 'tone-blue',
      pct: kpi.total > 0 ? `${Math.round((kpi.mql / kpi.total) * 100)}%` : null,
      isActive: status === 'mql',
    },
    {
      id: 'sql',
      label: 'SQL (Đạt chuẩn)',
      value: kpi.sql,
      icon: CheckCircle2,
      tone: 'tone-green',
      pct: kpi.total > 0 ? `${Math.round((kpi.sql / kpi.total) * 100)}%` : null,
      isActive: status === 'sql',
    },
    {
      id: 'nurturing',
      label: 'Đang nuôi dưỡng',
      value: kpi.nurturing,
      icon: HeartHandshake,
      tone: 'tone-amber',
      pct: kpi.total > 0 ? `${Math.round((kpi.nurturing / kpi.total) * 100)}%` : null,
      isActive: status === 'nurturing',
    },
    {
      id: 'unqualified',
      label: 'Không đạt chuẩn',
      value: kpi.unqualified,
      icon: XCircle,
      tone: 'tone-rose',
      pct: kpi.total > 0 ? `${Math.round((kpi.unqualified / kpi.total) * 100)}%` : null,
      isActive: status === 'unqualified',
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentSafePage = Math.min(page, totalPages);
  const startRecord = total > 0 ? (currentSafePage - 1) * pageSize + 1 : 0;
  const endRecord = Math.min(currentSafePage * pageSize, total);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentSafePage <= 4) {
        pages.push(1, 2, 3, 4, 5, '...', totalPages);
      } else if (currentSafePage >= totalPages - 3) {
        pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentSafePage - 1, currentSafePage, currentSafePage + 1, '...', totalPages);
      }
    }
    return pages;
  };

  const hasFilters = Boolean(search || status || source || sdrId || team);

  function resetFilters() {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setSource('');
    setSdrId('');
    setTeam('');
    setPage(1);
  }

  function clearSearchFilter() {
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  function openLeadFormDrawer() {
    clearSearchFilter();
    setFormOpen(true);
  }

  function closeLeadFormDrawer() {
    setFormOpen(false);
    clearSearchFilter();
  }

  function handleSaved() {
    setReloadTick(tick => tick + 1);
  }

  function openView(lead: CrmLeadRow) {
    setDetailLead(lead);
    setDetailMode('view');
  }

  /** Lối vào DUY NHẤT của form sửa Lead (LeadEditDrawer). Cả "Sửa nhanh" ở
   * menu "⋯" lẫn nút "Chỉnh sửa" trong drawer "Xác minh Lead" đều gọi hàm
   * này — không có bản form sửa thứ hai ở đâu khác. */
  function openEdit(lead: CrmLeadRow) {
    setEditLead(lead);
  }

  /** Cập nhật NGAY dòng tương ứng trong bảng sau khi lưu (không chờ reload
   * toàn trang), rồi vẫn nạp lại nền để KPI/thứ tự sắp xếp theo updated_at
   * khớp với server. */
  function applyUpdatedLead(updated: CrmLeadRow) {
    setItems(current => current.map(row => (row.id === updated.id ? updated : row)));
    setEditLead(current => (current && current.id === updated.id ? updated : current));
    setDetailLead(current => (current && current.id === updated.id ? updated : current));
    setReloadTick(tick => tick + 1);
  }

  async function confirmDelete(confirmCascade = false) {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/all-platform/crm/leads/${encodeURIComponent(target.id)}${confirmCascade ? '?confirm_cascade=true' : ''}`,
        { method: 'DELETE', credentials: 'include', headers: headers() },
      );
      const body = await res.json();
      if (!res.ok || body.success === false) {
        // Lead da convert: hoi xac nhan rieng thay vi chan (feedback 2026-09-23).
        const summary = confirmCascade ? null : cascadeSummaryFromBody(body);
        if (summary) {
          setDeleteCascadeSummary(summary);
          return;
        }
        throw new Error(body?.message || body?.detail || `Không xóa được Lead (lỗi ${res.status}).`);
      }
      // Bỏ dòng khỏi bảng ngay, đồng thời nạp lại để KPI/tổng số về đúng.
      setItems(current => current.filter(row => row.id !== target.id));
      setTotal(current => Math.max(0, current - 1));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
      setDeleteCascadeSummary(null);
      if (detailLead?.id === target.id) setDetailLead(null);
      if (editLead?.id === target.id) setEditLead(null);
      setReloadTick(tick => tick + 1);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Không xóa được Lead.');
    } finally {
      setDeleting(false);
    }
  }

  function openQualifyForNewLead(lead: CrmLeadRow) {
    setDetailLead(lead);
    setDetailMode('qualify');
  }

  /** Bấm vào tên Lead / dòng Lead mở ĐÚNG cùng 1 drawer "Xác minh Lead" như
   * nút hành động chính — trước đây tên Lead luôn mở chế độ 'view' trong khi
   * nút hành động lại mở chế độ khác, nên 2 lối vào cùng 1 record cho ra 2 màn
   * khác nhau. Lead đã kết thúc luồng (converted / không phù hợp) mở ở chế độ
   * xem, phần còn lại mở thẳng luồng xác minh. */
  function openRow(lead: CrmLeadRow) {
    if (lead.status === 'sql' || lead.status === 'unqualified' || lead.status === 'converted' || lead.status === 'disqualified') {
      openView(lead);
      return;
    }
    openQualifyForNewLead(lead);
  }

  /** Hành động chính của 1 dòng phụ thuộc TRẠNG THÁI lead — mọi trạng thái đều
   * mở đúng 1 drawer "Xác minh Lead", chỉ khác chỗ được cuộn tới; riêng lead đã
   * convert thì mở thẳng Deal đã tạo (?openDeal=<converted_deal_id> — cùng
   * deep-link mà CrmShell.tsx đã đọc sẵn) thay vì mở lại drawer xác minh. */
  function primaryActionOf(lead: CrmLeadRow): { label: string; run: () => void } {
    switch (lead.status) {
      case 'mql':
      case 'new_lead':
      case 'qualifying':
        return { label: 'Xác minh', run: () => openQualifyForNewLead(lead) };
      case 'sql':
      case 'qualified':
      case 'converted':
        if (lead.convertedCustomerId) {
          const customerId = lead.convertedCustomerId;
          return {
            label: 'Xem khách hàng',
            run: () => {
              window.location.href = `/all-platform/crm/customers/${customerId}`;
            },
          };
        }
        if (lead.convertedDealId) {
          // Fallback: chua co lien ket khach hang nhung da co Deal - giu hanh
          // vi cu (mo thang Deal) de khong mat chuc nang khi du lieu thieu.
          const dealId = lead.convertedDealId;
          return {
            label: 'Mở Deal',
            run: () => {
              window.location.href = `/all-platform/crm?openDeal=${encodeURIComponent(dealId)}`;
            },
          };
        }
        return { label: 'Xem xác minh', run: () => openQualifyForNewLead(lead) };
      case 'nurturing':
      case 'nurture':
      case 'unqualified':
      case 'disqualified':
        return { label: 'Xem xác minh', run: () => openQualifyForNewLead(lead) };
      default:
        return { label: 'Mở', run: () => openView(lead) };
    }
  }

  /** Hành động phụ: "Sửa nhanh"/"Xem khách hàng" đã bị bỏ khỏi đây (2026-09-25)
   * — click cả dòng giờ mở thẳng LeadEditDrawer, và "Xem khách hàng" đã lên
   * làm nút hành động chính (xem primaryActionOf) — chỉ còn "Sao chép sang
   * workspace khác" (tuỳ điều kiện) và "Xóa Lead" (đỏ, luôn ở cuối, mở cho
   * mọi người, chỉ hỏi xác nhận — feedback 2026-09-23). Khi danh sách chỉ còn
   * đúng "Xóa Lead", UI render 1 nút xóa trực tiếp thay vì dropdown ⋯ (xem
   * chỗ dùng `secondaryActionsOf` bên dưới). */
  function secondaryActionsOf(lead: CrmLeadRow): ActionMenuItem[] {
    return [
      ...(canCopyInstance && lead.status !== 'sql' && !lead.convertedCustomerId
        ? [{
            key: 'copy-instance',
            label: 'Sao chép sang workspace khác',
            onSelect: () => openCopyModal(lead),
          }]
        : []),
      {
        key: 'delete',
        label: 'Xóa Lead',
        danger: true,
        onSelect: () => {
          setDeleteError('');
          setDeleteCascadeSummary(null);
          setDeleteTarget(lead);
        },
      },
    ];
  }

  /** Xoa Lead truc tiep (dung khi menu phu chi con dung 1 muc "Xoa Lead" -
   * thay vi bat mo dropdown ⋯ chi de chon 1 lua chon duy nhat). */
  function requestDeleteLead(lead: CrmLeadRow) {
    setDeleteError('');
    setDeleteCascadeSummary(null);
    setDeleteTarget(lead);
  }

  /** Khi menu phu chi con dung 1 hanh dong ("Xoa Lead") thi hien thang 1 nut
   * xoa co icon thay vi bat mo dropdown ⋯ chi de chon 1 lua chon duy nhat;
   * neu con hanh dong khac (vd "Sao chep sang workspace khac") thi van giu
   * dropdown ActionMenu nhu cu. */
  function renderSecondaryActions(lead: CrmLeadRow) {
    const actions = secondaryActionsOf(lead);
    if (actions.length === 1 && actions[0].key === 'delete') {
      return (
        <button
          type="button"
          className="crm-row-action-primary crm-row-action-icon crm-row-action-danger"
          title="Xóa Lead"
          onClick={() => requestDeleteLead(lead)}
        >
          <Trash2 className="crm-button-icon" />
        </button>
      );
    }
    return <ActionMenu label="Thao tác khác" items={actions} />;
  }

  return (
    <div className="crm-shell">
      <section className="crm-page-card crm-leads-page-shell">
        {error ? <p className="crm-error">{error}</p> : null}

        <div className="crm-directory-header">
          <div className="crm-directory-title-wrap">
            <h1>
              <span className="crm-directory-title-icon">
                <Target size={19} />
              </span>
              <span>Leads (Đầu mối tiềm năng)</span>
            </h1>
            <p>Thu thập, phân loại MQL/SQL và chuyển đổi lead thành cơ hội kinh doanh</p>
          </div>
          <div className="crm-directory-actions">
            <button type="button" className="crm-secondary-button" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet size={15} />
              <span>Import Excel</span>
            </button>
            <button type="button" className="crm-primary-button" onClick={openLeadFormDrawer}>
              <Plus size={15} />
              <span>Thêm Lead</span>
            </button>
          </div>
        </div>

        <div className="crm-modern-kpi-grid">
          {kpiCards.map(card => {
            const IconComponent = card.icon;
            return (
              <div
                key={card.label}
                className={`crm-modern-kpi-card ${card.isActive ? 'active' : ''}`}
                onClick={() => {
                  if (card.id === '') {
                    setStatus('');
                  } else {
                    setStatus(status === card.id ? '' : (card.id as CrmLeadStatus));
                  }
                  setPage(1);
                }}
                title={`Lọc theo ${card.label}`}
              >
                <div className={`crm-modern-kpi-icon ${card.tone}`}>
                  <IconComponent size={20} />
                </div>
                <div className="crm-modern-kpi-content">
                  <p className="crm-modern-kpi-label">{card.label}</p>
                  <div className="crm-modern-kpi-val-row">
                    <span className="crm-modern-kpi-value">{card.value}</span>
                    {card.pct ? <span className="crm-modern-kpi-pct">{card.pct}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <section className="crm-modern-filter-card">
          <div className="crm-filter-grid crm-filter-grid--leads">
            <div className="crm-search-box">
              <Search size={16} className="crm-search-icon" />
              <input
                type="search"
                name="crm-leads-directory-search"
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                className="crm-input"
                placeholder="Tìm tên, công ty, SĐT, email..."
                autoComplete="off"
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={status}
                onChange={setStatus}
                placeholder="Tất cả trạng thái"
                options={STATUS_OPTIONS.filter(option => option.value !== '')}
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={source}
                onChange={setSource}
                placeholder="Tất cả nguồn"
                options={sourceOptions}
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={sdrId}
                onChange={setSdrId}
                placeholder="Tất cả SDR phụ trách"
                options={sdrFilterOptions.map(([id, name]) => ({ value: id, label: name }))}
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={team}
                onChange={setTeam}
                placeholder="Tất cả Team"
                options={teamOptions.map(t => ({ value: t, label: t }))}
              />
            </div>
            {hasFilters ? (
              <div className="crm-icon-action-group">
                <button type="button" className="crm-secondary-button crm-filter-reset" onClick={resetFilters}>
                  <RotateCcw size={14} className="crm-button-icon" /> Xóa lọc
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {/* 
          Chức năng: Thanh công cụ thao tác hàng loạt trên các Lead được chọn.
          Thay đổi:
          - Hiển thị khi có ít nhất 1 dòng Lead được tick chọn ở bảng dưới (selectedIds.size > 0).
          - Nút "Xóa những cái đã chọn" nằm ở GIỮA nút "Bỏ chọn" và nút "Sao chép sang workspace khác".
          - Nút "Xóa những cái đã chọn" sử dụng cùng class CSS 'crm-primary-button' với nút "Sao chép sang workspace khác".
        */}
        {selectedIds.size > 0 ? (
          <div
            className="crm-filter-card"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}
          >
            <span style={{ fontWeight: 600 }}>Đã chọn {selectedIds.size} Lead</span>
            <div className="crm-icon-action-group" style={{ gap: '0.5rem' }}>
              {/* Nút 1: Bỏ chọn */}
              <button type="button" className="crm-secondary-button" onClick={() => setSelectedIds(new Set())}>
                Bỏ chọn
              </button>
              {/* Nút 2: Xóa những cái đã chọn (nằm ở giữa, dùng class crm-primary-button) */}
              <button
                type="button"
                className="crm-primary-button"
                disabled={bulkDeleting}
                onClick={() => {
                  setBulkDeleteError('');
                  setBulkCascadeIds([]);
                  setBulkCascadeSummary(null);
                  setBulkDeleteOpen(true);
                }}
              >
                Xóa những cái đã chọn
              </button>
              {/* Nút 3: Sao chép sang workspace khác (chỉ hiển thị cho Admin) */}
              {canCopyInstance ? (
                <button type="button" className="crm-primary-button" onClick={openCopyModalForSelection}>
                  Sao chép sang workspace khác
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <section className="crm-directory-list-box">
          <div className="crm-directory-list-top">
            <div>
              <h2 className="crm-directory-list-heading">Danh sách Lead</h2>
              <p className="crm-directory-list-sub">
                Tổng {total} lead · Click vào lead để xem chi tiết và cập nhật tiến độ
              </p>
            </div>
          </div>

          <div className="crm-table-card crm-lead-table-card--desktop">
            <div className="crm-table-scroll">
              <table className="crm-table crm-lead-directory-table">
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col className="crm-col-lead-name" />
                  <col className="crm-col-lead-contact" />
                  <col className="crm-col-lead-source" />
                  <col className="crm-col-lead-score" />
                  <col className="crm-col-lead-status" />
                  <col className="crm-col-lead-sdr" />
                  <col className="crm-col-lead-nextstep" />
                  <col className="crm-col-lead-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="crm-th">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        disabled={selectableItems.length === 0}
                        onChange={toggleSelectAllOnPage}
                        aria-label="Chọn tất cả Lead trên trang này"
                      />
                    </th>
                    <th className="crm-th">Lead</th>
                    <th className="crm-th">Liên hệ</th>
                    <th className="crm-th">Nguồn</th>
                    <th className="crm-th crm-th--right">Score</th>
                    <th className="crm-th">Trạng thái</th>
                    <th className="crm-th">SDR</th>
                    <th className="crm-th">Việc tiếp theo</th>
                    <th className="crm-th crm-th--right crm-th--actions-col">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</td></tr>
                  ) : items.length ? (
                    items.map(lead => {
                      const avatarColor = getAvatarColor(lead.leadName);
                      const initials = getInitials(lead.leadName);
                      return (
                        <tr key={lead.id} className="crm-row">
                          <td className="crm-td" onClick={event => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(lead.id)}
                              onChange={() => toggleSelect(lead.id)}
                              aria-label={`Chọn ${lead.leadName}`}
                            />
                          </td>
                          <td className="crm-td">
                            <div className="crm-lead-identity">
                              <div
                                className="crm-avatar-bubble"
                                style={{ backgroundColor: avatarColor.bg, color: avatarColor.text }}
                              >
                                {initials}
                              </div>
                              <div className="crm-lead-identity-text">
                                <button
                                  type="button"
                                  className="crm-lead-name-btn"
                                  title={lead.leadName}
                                  onClick={() => openRow(lead)}
                                >
                                  {lead.leadName}
                                </button>
                                <div className="crm-sub-text" title={lead.companyName || 'Chưa có công ty'}>
                                  <Building2 size={12} className="shrink-0 text-gray-400" />
                                  <span className="truncate">{lead.companyName || 'Chưa có công ty'}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="crm-td crm-contact-cell">
                            {lead.phone ? (
                              <a
                                className="crm-contact-chip"
                                href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
                                title={lead.phone}
                              >
                                <Phone size={12} />
                                <span>{lead.phone}</span>
                              </a>
                            ) : (
                              <div className="crm-small text-gray-400">-</div>
                            )}
                            {lead.email ? (
                              <a
                                className="crm-contact-chip crm-muted"
                                title={lead.email}
                                href={`mailto:${lead.email}`}
                              >
                                <Mail size={12} />
                                <span className="crm-truncate max-w-[140px]">{lead.email}</span>
                              </a>
                            ) : (
                              <div className="crm-muted text-gray-400">-</div>
                            )}
                          </td>
                          <td className="crm-td">
                            <span className="crm-modern-source-pill">{lead.source || 'Manual'}</span>
                          </td>
                          <td className="crm-td crm-td--right">
                            {lead.score == null ? (
                              <span className="text-gray-400 text-xs">-</span>
                            ) : (
                              <span
                                className={`crm-score-badge ${
                                  lead.score >= 70 ? 'score-high' : lead.score >= 40 ? 'score-mid' : 'score-low'
                                }`}
                              >
                                {lead.score}
                              </span>
                            )}
                          </td>
                          <td className="crm-td">
                            <span className={`crm-lead-status-badge ${STATUS_BADGE_CLASS[lead.status] || ''}`}>
                              <span
                                className="crm-status-dot"
                                style={{
                                  backgroundColor:
                                    lead.status === 'sql'
                                      ? '#16a34a'
                                      : lead.status === 'mql'
                                      ? '#2563eb'
                                      : lead.status === 'nurturing'
                                      ? '#d97706'
                                      : '#dc2626',
                                }}
                              />
                              <span>{LEAD_STATUS_LABEL[lead.status] || lead.status}</span>
                            </span>
                          </td>
                          <td className="crm-td crm-small">{sdrName.get(lead.sdrId || '') || 'Chưa gán'}</td>
                          <td className="crm-td crm-muted crm-truncate" title={lead.nextStep || ''}>
                            {lead.nextStep || '-'}
                          </td>
                          <td className="crm-td crm-td--actions-col">
                            <div className="crm-row-actions">
                              {(() => {
                                const action = primaryActionOf(lead);
                                return (
                                  <button
                                    type="button"
                                    className="crm-row-action-primary crm-lead-row-action"
                                    title={action.label}
                                    onClick={action.run}
                                  >
                                    {action.label}
                                  </button>
                                );
                              })()}
                              <ActionMenu label="Thao tác khác" items={secondaryActionsOf(lead)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9}>
                        <div className="crm-empty-state">
                          <span className="crm-empty-state-icon">
                            <Plus className="crm-button-icon" />
                          </span>
                          <p className="crm-empty-state-title">
                            {hasFilters ? 'Không có Lead phù hợp với bộ lọc' : 'Chưa có Lead'}
                          </p>
                          <p className="crm-empty-state-desc">
                            {hasFilters
                              ? 'Thử đổi từ khóa tìm kiếm hoặc bấm "Xóa lọc" để xem lại toàn bộ danh sách.'
                              : 'Bắt đầu bằng cách thêm Lead đầu tiên vào CRM.'}
                          </p>
                          {hasFilters ? (
                            <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                              <RotateCcw className="crm-button-icon" /> Xóa lọc
                            </button>
                          ) : (
                            <button type="button" className="crm-primary-button" onClick={openLeadFormDrawer}>
                              <Plus className="crm-button-icon" /> Thêm Lead đầu tiên
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Card list cho man hep - cung ly do voi CrmCustomersDirectory.tsx
           * (bang 8 cot ep table-layout:fixed khong doc noi duoi 900px). */}
          <div className="crm-lead-card-list">
            {loading ? (
              <div className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</div>
            ) : items.length ? (
              items.map(lead => (
                <div
                  key={lead.id}
                  className="crm-customer-card crm-lead-card crm-row--clickable"
                  onClick={() => openEdit(lead)}
                >
                  <div className="crm-customer-card-head">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      onClick={event => event.stopPropagation()}
                      aria-label={`Chọn ${lead.leadName}`}
                      style={{ marginTop: 4 }}
                    />
                    <div className="crm-customer-card-identity">
                      <button type="button" className="crm-customer-name-link crm-lead-name-btn" title={lead.leadName} onClick={event => { event.stopPropagation(); openRow(lead); }}>
                        {lead.leadName}
                      </button>
                      <div className="crm-customer-company" title={lead.companyName || 'Chưa có công ty'}>
                        {lead.companyName || 'Chưa có công ty'}
                      </div>
                    </div>
                    <span className={`crm-lead-status-badge ${STATUS_BADGE_CLASS[lead.status] || ''}`}>
                      {LEAD_STATUS_LABEL[lead.status] || lead.status}
                    </span>
                  </div>
                  <div className="crm-customer-card-contact" onClick={event => event.stopPropagation()}>
                    {lead.phone ? (
                      <a className="crm-contact-link" href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>{lead.phone}</a>
                    ) : null}
                    {lead.email ? (
                      <a className="crm-contact-link crm-muted crm-truncate" title={lead.email} href={`mailto:${lead.email}`}>{lead.email}</a>
                    ) : null}
                  </div>
                  <div className="crm-customer-card-meta">
                    <span className="crm-source-badge">{lead.source || 'Manual'}</span>
                    <span className="crm-small">{sdrName.get(lead.sdrId || '') || 'Chưa gán'}</span>
                  </div>
                  <div className="crm-customer-card-metrics">
                    <span>Score: {lead.score == null ? '-' : lead.score}</span>
                    <span className="crm-muted crm-truncate">{lead.nextStep || 'Chưa có việc tiếp theo'}</span>
                  </div>
                  <div className="crm-customer-card-actions" onClick={event => event.stopPropagation()}>
                    {(() => {
                      const action = primaryActionOf(lead);
                      return (
                        <button type="button" className="crm-row-action-primary crm-lead-row-action" onClick={action.run}>
                          {action.label}
                        </button>
                      );
                    })()}
                    {renderSecondaryActions(lead)}
                  </div>
                </div>
              ))
            ) : (
              <div className="crm-empty-state">
                <span className="crm-empty-state-icon">
                  <Plus className="crm-button-icon" />
                </span>
                <p className="crm-empty-state-title">
                  {hasFilters ? 'Không có Lead phù hợp với bộ lọc' : 'Chưa có Lead'}
                </p>
                {hasFilters ? (
                  <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                    <RotateCcw className="crm-button-icon" /> Xóa lọc
                  </button>
                ) : (
                  <button type="button" className="crm-primary-button" onClick={openLeadFormDrawer}>
                    <Plus className="crm-button-icon" /> Thêm Lead đầu tiên
                  </button>
                )}
              </div>
            )}
          </div>

          {total > 0 ? (
            <div className="crm-progress-pagination">
              <div className="crm-progress-pagination-info">
                Hiển thị {startRecord} - {endRecord} trên {total} Lead
              </div>

              <div className="crm-progress-pagination-pages">
                <button
                  type="button"
                  className="crm-progress-pagination-btn"
                  disabled={currentSafePage <= 1 || loading}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  aria-label="Trang trước"
                >
                  <ChevronLeft size={16} />
                </button>

                {getPageNumbers().map((p, idx) => {
                  if (typeof p === 'string') {
                    return (
                      <span key={`ellipsis-${idx}`} className="crm-progress-pagination-ellipsis">
                        ...
                      </span>
                    );
                  }
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`crm-progress-pagination-btn${p === currentSafePage ? ' active' : ''}`}
                      disabled={loading}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  type="button"
                  className="crm-progress-pagination-btn"
                  disabled={currentSafePage >= totalPages || loading}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  aria-label="Trang tiếp"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="crm-progress-pagination-size">
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="progress-pagination-select"
                >
                  <option value={10}>Hiển thị 10 / trang</option>
                  <option value={20}>Hiển thị 20 / trang</option>
                  <option value={50}>Hiển thị 50 / trang</option>
                  <option value={100}>Hiển thị 100 / trang</option>
                </select>
              </div>
            </div>
          ) : null}
        </section>
      </section>

      <LeadFormDrawer
        open={formOpen}
        currentUser={user}
        onClose={closeLeadFormDrawer}
        onSaved={handleSaved}
        onOpenQualification={lead => {
          closeLeadFormDrawer();
          openQualifyForNewLead(lead);
        }}
        onOpenExistingLead={lead => {
          closeLeadFormDrawer();
          openRow(lead);
        }}
      />

      <LeadImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleSaved}
      />

      <LeadDetailDrawer
        lead={detailLead}
        open={Boolean(detailLead)}
        initialMode={detailMode}
        currentUser={user}
        onClose={() => setDetailLead(null)}
        onSaved={updated => {
          setDetailLead(updated);
          handleSaved();
        }}
        onEdit={openEdit}
      />

      <LeadEditDrawer
        lead={editLead}
        open={Boolean(editLead)}
        currentUser={user}
        onClose={() => setEditLead(null)}
        onSaved={applyUpdatedLead}
      />

      {copyLeadIds.length > 0 ? (
        <div
          className="crm-modal-backdrop crm-modal-backdrop--confirm"
          onClick={() => (copying ? undefined : closeCopyModal())}
        >
          <div
            className="crm-modal crm-modal--confirm"
            role="dialog"
            aria-modal="true"
            onClick={event => event.stopPropagation()}
          >
            <header className="crm-modal-header">
              <div>
                <p className="crm-modal-title">Sao chép sang workspace khác</p>
                <p className="crm-modal-subtitle">
                  {copyLeadIds.length > 1
                    ? `Chọn workspace đích riêng cho từng Lead (${copyLeadIds.length} Lead) — Lead gốc vẫn giữ nguyên ở Main.`
                    : `Tạo 1 bản sao của Lead "${items.find(l => l.id === copyLeadIds[0])?.leadName || ''}" ở workspace khác — Lead gốc vẫn giữ nguyên ở Main.`}
                </p>
              </div>
            </header>
            <div className="crm-modal-body">
              {copyError ? <p className="crm-error">{copyError}</p> : null}
              {copyFailures.length > 0 ? (
                <div className="crm-error">
                  <p>{copyFailures.length} Lead sao chép thất bại:</p>
                  <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
                    {copyFailures.map(f => (
                      <li key={f.lead_id}>{items.find(l => l.id === f.lead_id)?.leadName || f.lead_id}: {f.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {copyLeadIds.length > 1 ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <SearchableSelect
                    value=""
                    onChange={applyTargetToAll}
                    placeholder="Áp dụng 1 workspace cho tất cả (tuỳ chọn)"
                    options={COPY_TARGET_OPTIONS.map(option => ({ value: option.instance, label: option.label }))}
                  />
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 260, overflowY: 'auto' }}>
                {copyLeadIds.map(leadId => {
                  const lead = items.find(l => l.id === leadId);
                  return (
                    <div key={leadId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="crm-truncate" style={{ flex: 1, minWidth: 0 }} title={lead?.leadName || leadId}>
                        {lead?.leadName || leadId}
                      </span>
                      <div style={{ width: 200, flexShrink: 0 }}>
                        <SearchableSelect
                          value={copyTargets[leadId] || ''}
                          onChange={value => setCopyTargetFor(leadId, value)}
                          placeholder="Chọn workspace"
                          options={COPY_TARGET_OPTIONS.map(option => ({ value: option.instance, label: option.label }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <footer className="crm-modal-footer">
              <button type="button" className="crm-cancel-button" disabled={copying} onClick={closeCopyModal}>
                Hủy
              </button>
              <button
                type="button"
                className="crm-primary-button"
                disabled={copying || !copyReady}
                onClick={() => void confirmCopy()}
              >
                {copying ? <Loader2 className="crm-save-spinner" /> : null}
                {copying ? 'Đang sao chép...' : 'Sao chép'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="crm-modal-backdrop crm-modal-backdrop--confirm"
          onClick={() => (deleting ? undefined : setDeleteTarget(null))}
        >
          <div
            className="crm-modal crm-modal--confirm"
            role="dialog"
            aria-modal="true"
            data-testid="lead-delete-confirm"
            onClick={event => event.stopPropagation()}
          >
            <header className="crm-modal-header">
              <div>
                <p className="crm-modal-title">Xóa Lead</p>
                <p className="crm-modal-subtitle">Hành động này không thể hoàn tác.</p>
              </div>
            </header>
            <div className="crm-modal-body">
              {deleteError ? <p className="crm-error" data-testid="lead-delete-error">{deleteError}</p> : null}
              <p>
                Xóa Lead <b>&ldquo;{deleteTarget.leadName}&rdquo;</b>? Hành động này không thể hoàn tác.
              </p>
              {deleteCascadeConfirm ? (
                <div className="crm-lead-check-banner crm-lead-check-banner--warning" data-testid="lead-delete-cascade-warning">
                  <b>Lead này còn dữ liệu liên quan</b>
                  <span>
                    Sẽ bị xoá kèm: <b>{describeCascadeSummary(deleteCascadeSummary || {})}</b>. {cascadeLossText(deleteCascadeSummary || {})}
                  </span>
                  <span>Bạn có chấp nhận mất toàn bộ dữ liệu này và xoá không?</span>
                </div>
              ) : (
                <p className="crm-ai-fill-hint">
                  Nếu chỉ muốn ngừng theo dõi, hãy dùng &quot;Sửa nhanh&quot; để chuyển trạng thái sang &quot;Theo dõi
                  sau&quot; hoặc &quot;Không phù hợp&quot; thay vì xóa hẳn.
                </p>
              )}
            </div>
            <footer className="crm-modal-footer">
              <button
                type="button"
                className="crm-cancel-button"
                data-testid="lead-delete-cancel"
                disabled={deleting}
                onClick={() => { setDeleteTarget(null); setDeleteCascadeSummary(null); }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="crm-danger-button"
                data-testid="lead-delete-confirm-btn"
                disabled={deleting}
                onClick={() => void confirmDelete(deleteCascadeConfirm)}
              >
                {deleting ? <Loader2 className="crm-save-spinner" /> : null}
                {deleting ? 'Đang xóa...' : deleteCascadeConfirm ? 'Chấp nhận mất & xóa toàn bộ' : 'Xóa Lead'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* 
        Chức năng: Modal xác nhận xóa hàng loạt Lead (Bulk Delete Confirm Modal).
        Thay đổi:
        - Hiển thị khi người dùng bấm nút "Xóa những cái đã chọn".
        - Báo rõ số lượng Lead sắp xóa ({selectedIds.size} Lead) và cảnh báo không thể hoàn tác.
        - Có nút Hủy và nút Xóa Lead đã chọn (crm-danger-button), hiển thị trạng thái xoay spinner khi đang xóa.
      */}
      {bulkDeleteOpen ? (
        <div
          className="crm-modal-backdrop crm-modal-backdrop--confirm"
          onClick={() => (bulkDeleting ? undefined : setBulkDeleteOpen(false))}
        >
          <div
            className="crm-modal crm-modal--confirm"
            role="dialog"
            aria-modal="true"
            data-testid="lead-bulk-delete-confirm"
            onClick={event => event.stopPropagation()}
          >
            <header className="crm-modal-header">
              <div>
                <p className="crm-modal-title">Xóa {selectedIds.size} Lead đã chọn</p>
                <p className="crm-modal-subtitle">Hành động này không thể hoàn tác.</p>
              </div>
            </header>
            <div className="crm-modal-body">
              {bulkDeleteError ? <p className="crm-error" data-testid="lead-bulk-delete-error">{bulkDeleteError}</p> : null}
              {bulkCascadeIds.length ? (
                <div className="crm-lead-check-banner crm-lead-check-banner--warning" data-testid="lead-bulk-delete-cascade-warning">
                  <b>Còn {bulkCascadeIds.length} Lead có dữ liệu liên quan</b>
                  <span>
                    Sẽ bị xoá kèm: <b>{describeCascadeSummary(bulkCascadeSummary || {})}</b>. {cascadeLossText(bulkCascadeSummary || {})}
                  </span>
                  <span>Bạn có chấp nhận mất toàn bộ dữ liệu này và xoá cả {bulkCascadeIds.length} Lead không?</span>
                </div>
              ) : (
                <>
                  <p>
                    Bạn có chắc chắn muốn xóa <b>{selectedIds.size} Lead</b> đã chọn? Dữ liệu sẽ bị xóa hoàn toàn khỏi hệ thống.
                  </p>
                  <p className="crm-ai-fill-hint">
                    Nếu chỉ muốn ngừng theo dõi, hãy chuyển trạng thái sang &quot;Theo dõi
                    sau&quot; hoặc &quot;Không phù hợp&quot; thay vì xóa hẳn.
                  </p>
                </>
              )}
            </div>
            <footer className="crm-modal-footer">
              <button
                type="button"
                className="crm-cancel-button"
                data-testid="lead-bulk-delete-cancel"
                disabled={bulkDeleting}
                onClick={() => { setBulkDeleteOpen(false); setBulkCascadeIds([]); setBulkCascadeSummary(null); }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="crm-danger-button"
                data-testid="lead-bulk-delete-confirm-btn"
                disabled={bulkDeleting}
                onClick={() => void confirmBulkDelete(bulkCascadeIds.length > 0)}
              >
                {bulkDeleting ? <Loader2 className="crm-save-spinner" /> : null}
                {bulkDeleting ? 'Đang xóa...' : bulkCascadeIds.length ? 'Chấp nhận mất & xóa toàn bộ' : 'Xóa Lead đã chọn'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
