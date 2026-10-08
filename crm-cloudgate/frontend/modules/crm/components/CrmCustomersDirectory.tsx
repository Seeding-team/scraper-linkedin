'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { useMembers } from '@/hooks/useMembers';
import { crmTeamsService, usersService, type CrmTeam } from '@/services/all-platform.service';
import { formatVND } from '../constants/crmConfig';
import { CustomerAddDrawer } from './CustomerAddDrawer';
import { CreateOpportunityDrawer } from './CreateOpportunityDrawer';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { SearchableSelect } from './SearchableSelect';
import { ContactSummaryBadge } from './ContactSummaryPopover';
import { CustomerColumnVisibilityMenu } from './CustomerColumnVisibilityMenu';
import { CustomerQuickViewPanel } from './CustomerQuickViewPanel';
import { useCustomerColumnPreferences } from '../hooks/useCustomerColumnPreferences';
import { Loader2, Plus, RotateCcw } from './icons';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, ListTodo } from 'lucide-react';
import type { CrmCustomerKpi, CrmCustomerRow } from '../types';
import { cascadeLossText, describeCascadeSummary, sumCascadeSummaries, type CascadeSummary } from '../utils/cascadeDelete';
import { relativeTime } from '../utils/quoteDisplay';

/**
 * Tab -> status mapping (quyet dinh cuoi cung, xem bao cao task):
 *   Tat ca            -> '' (khong loc)
 *   Tiem nang         -> new_lead
 *   Dang ban          -> following
 *   Da mua            -> current_customer
 *   Ngung hoat dong   -> not_fit
 * Chon theo dung 4 gia tri enum status hien co tren crm_customers, dat ten
 * tab theo ngon ngu kinh doanh (khac chut so voi nhan cu "Dang cham soc"/
 * "Khong phu hop") de khop dung tinh than "doanh nghiep la khach hang, dang
 * qua cac giai doan ban hang" cua thiet ke moi.
 */
const STATUS_TABS: Array<{ value: string; label: string; kpiKey: keyof CrmCustomerKpi }> = [
  { value: '', label: 'Tất cả', kpiKey: 'total' },
  { value: 'new_lead', label: 'Tiềm năng', kpiKey: 'new_lead' },
  { value: 'following', label: 'Đang bán', kpiKey: 'following' },
  { value: 'current_customer', label: 'Đã mua', kpiKey: 'current_customer' },
  { value: 'not_fit', label: 'Ngừng hoạt động', kpiKey: 'not_fit' },
];

const STATUS_LABEL: Record<string, string> = {
  new_lead: 'Tiềm năng',
  following: 'Đang bán',
  current_customer: 'Đã mua',
  not_fit: 'Ngừng hoạt động',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  new_lead: 'crm-customer-status--new',
  following: 'crm-customer-status--following',
  current_customer: 'crm-customer-status--current',
  not_fit: 'crm-customer-status--not-fit',
};

/** Nhan nut hanh dong chinh o cot "Hanh dong", theo dung status - Ngung hoat
 * dong KHONG co nut tao deal nao (quyet dinh cua task, tranh tao co hoi ban
 * hang cho khach da ngung). */
const PRIMARY_ACTION_LABEL: Record<string, string> = {
  new_lead: '+ Deal',
  following: '+ Deal',
  current_customer: '+ Upsell',
};

type ApiCustomerRow = {
  id: string;
  customer_name?: string | null;
  short_name?: string | null;
  short_name_manual?: boolean | null;
  company_name?: string | null;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
  tax_code?: string | null;
  city?: string | null;
  website?: string | null;
  source?: string | null;
  status?: CrmCustomerRow['status'] | null;
  owner_id?: string | null;
  can_edit?: boolean | null;
  deal_count?: number | null;
  contact_count?: number | null;
  primary_contact?: { id: string; name: string; phone?: string | null; email?: string | null } | null;
  total_value?: number | string | null;
  last_deal_at?: string | null;
  updated_at?: string | null;
};

type ApiListResponse = {
  items?: ApiCustomerRow[];
  total?: number;
  page?: number;
  page_size?: number;
  // Backend trả đúng {total, new_lead, following, current_customer, not_fit} —
  // KHÔNG phải total_customers/current_customers/new_leads như bản cũ đã đoán
  // sai (bug key mismatch khiến 4 thẻ KPI luôn hiện 0).
  kpi?: Partial<CrmCustomerKpi>;
};

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function mapCustomer(row: ApiCustomerRow): CrmCustomerRow {
  return {
    id: row.id,
    customerName: row.customer_name || 'Khách hàng chưa tên',
    companyName: row.company_name || '',
    shortName: row.short_name || null,
    shortNameManual: Boolean(row.short_name_manual),
    position: row.position || '',
    phone: row.phone || '',
    email: row.email || '',
    taxCode: row.tax_code || '',
    city: row.city || '',
    website: row.website || '',
    source: row.source || '',
    status: row.status || undefined,
    ownerId: row.owner_id || '',
    canEdit: Boolean(row.can_edit),
    dealCount: Number(row.deal_count || 0),
    contactCount: Number(row.contact_count || 0),
    primaryContact: row.primary_contact
      ? { id: row.primary_contact.id, name: row.primary_contact.name || '', phone: row.primary_contact.phone || '', email: row.primary_contact.email || '' }
      : null,
    totalValue: Number(row.total_value || 0),
    lastDealAt: row.last_deal_at || '',
    updatedAt: row.updated_at || '',
  };
}

export function CrmCustomersDirectory() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAppAuth();
  const { members } = useMembers();
  const [items, setItems] = useState<CrmCustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<CrmCustomerKpi>({ total: 0, new_lead: 0, following: 0, current_customer: 0, not_fit: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  // "Team" = Team CRM THAT (crm_teams/crm_team_members, migration 155) - doi tu HR
  // roster (feedback 2026-10-01: "đây là danh sách các team như ảnh 2" -
  // dung dung danh sach Leader/Team hien o trang Quan ly thanh vien > Leader
  // / Team Sale, khong dung phong ban HR nua). Gia tri `team` la crm_team_id.
  const [team, setTeam] = useState('');
  const [crmTeamOptions, setCrmTeamOptions] = useState<CrmTeam[]>([]);
  useEffect(() => {
    let alive = true;
    crmTeamsService
      .list()
      .then(res => {
        if (!alive) return;
        const rows = res.success ? res.data || [] : [];
        setCrmTeamOptions(rows.filter(t => t.status === 'active'));
      })
      .catch(() => {
        if (alive) setCrmTeamOptions([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [opportunityCustomer, setOpportunityCustomer] = useState<CrmCustomerRow | null>(null);
  const [quickViewCustomer, setQuickViewCustomer] = useState<CrmCustomerRow | null>(null);
  const restoringQuickCustomerRef = useRef('');
  // 1 state DUY NHAT dieu khien ca 2 section "Viec cua toi hom nay" + "Can
  // chu y" cung luc (yeu cau: bo 2 nut mui ten rieng, gop lai 1 nut "Mo
  // nhanh"/"Thu gon" chung, mac dinh DONG khi vao trang).
  const [workSectionsExpanded, setWorkSectionsExpanded] = useState(false);
  // Xoa 1 hoac NHIEU khach hang (feedback 2026-09-23: "select 1 hoặc nhiều ->
  // Xóa", dung chung 1 modal). Buoc 2 (cascade): khach con du lieu lien quan
  // -> liet ke ro so luong se bi xoa kem, nguoi dung xac nhan moi xoa.
  const [deleteTargets, setDeleteTargets] = useState<CrmCustomerRow[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cascadeStep, setCascadeStep] = useState<{ ids: string[]; summary: CascadeSummary } | null>(null);

  // Preference "cot nao hien" rieng theo workspace+user (khong phai key
  // global) - workspace = API_BASE_URL (moi deployment/clone co gia tri rieng
  // duoc build-bake tu env, on dinh, khong can them khai niem "workspace"
  // moi o FE). user?.id chua co (dang load auth) -> hook tu dung mac dinh hien
  // het cot, khong dung localStorage - xem useCustomerColumnPreferences.
  const columnWorkspaceId = API_BASE_URL || null;
  const columnUserId = user?.id || null;
  const { visible: visibleColumns, toggle: toggleColumn, selectAll: selectAllColumns, resetToDefault: resetColumnsToDefault } =
    useCustomerColumnPreferences(columnWorkspaceId, columnUserId);

  // Debounce ô tìm kiếm ~300ms — tránh gọi API mỗi lần gõ phím.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Mac dinh loc "cua toi + team cua toi" khi vao trang (thay vi "Tat ca") -
  // chi ap dung khi CHUA co lich su tim kiem nao luu trong sessionStorage
  // (lan dau ghe trang trong tab nay). Team CRM cua nguoi dang dang nhap tra
  // ve tu crmTeamsService.getTeamIdForUser() (crm_team_members) - null neu
  // chua thuoc Team CRM nao thi giu team rong (khong loi, hien "Tat ca Team").
  const defaultFilterAppliedRef = useRef(false);
  const applyDefaultOwnerFilter = useCallback(() => {
    if (!user?.id) return;
    setOwnerId(user.id);
    crmTeamsService
      .getTeamIdForUser(user.id)
      .then(res => setTeam((res.success ? res.data?.crm_team_id : null) || ''))
      .catch(() => setTeam(''));
  }, [user]);

  // Feedback nguoi dung (2026-09-24): quay lai trang Khach hang (Back, hoac
  // dieu huong sang trang khac roi vao lai) phai hien DUNG lich su tim kiem/
  // loc gan nhat cua chinh minh trong tab nay - ke ca da bam "Xoa loc" (hien
  // tat ca) hoac doi sang loc 1 nguoi khac - khong ep ve lai "cua toi" nua.
  // Dung sessionStorage (khong phai chi dua vao Next.js router cache, vi
  // cache co the bi evict) de robust hon; scope theo user.id de tranh lay
  // nham lich su cua nguoi khac neu dang xuat/dang nhap tai khoan khac trong
  // cung tab. Chi khi CHUA co lich su nao (lan dau ghe trang trong session)
  // moi ap dung mac dinh "cua toi + team cua toi".
  type StoredCustomerFilters = {
    userId: string;
    search: string;
    status: string;
    ownerId: string;
    team: string;
  };
  const FILTERS_STORAGE_KEY = 'crm-customers-filters-v2';

  useEffect(() => {
    if (defaultFilterAppliedRef.current) return;
    if (authLoading) return;
    if (!user?.id) return;
    defaultFilterAppliedRef.current = true;

    let stored: StoredCustomerFilters | null = null;
    try {
      const raw = window.sessionStorage.getItem(FILTERS_STORAGE_KEY);
      stored = raw ? (JSON.parse(raw) as StoredCustomerFilters) : null;
    } catch {
      stored = null;
    }

    if (stored && stored.userId === user.id) {
      setSearchInput(stored.search);
      setSearch(stored.search);
      setStatus(stored.status);
      setOwnerId(stored.ownerId);
      setTeam(stored.team);
      return;
    }

    applyDefaultOwnerFilter();
  }, [authLoading, user, applyDefaultOwnerFilter]);

  useEffect(() => {
    if (!user?.id) return;
    if (!defaultFilterAppliedRef.current) return; // chua khoi tao xong (dang doi auth/members) - tranh ghi de bang state rong luc mount
    try {
      const payload: StoredCustomerFilters = { userId: user.id, search, status, ownerId, team };
      window.sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage khong kha dung (che do an danh...) - bo qua, khong chan UI
    }
  }, [user, search, status, ownerId, team]);

  useEffect(() => { setPage(1); }, [status, ownerId, team]);

  const load = useCallback(() => {
    let alive = true;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (ownerId) params.set('owner_id', ownerId);
    if (team) params.set('team', team);
    setLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers?${params.toString()}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được hồ sơ khách hàng.');
        return body.data as ApiListResponse;
      })
      .then(data => {
        if (!alive) return;
        setItems((data.items || []).map(mapCustomer));
        setTotal(data.total || 0);
        setKpi({
          total: data.kpi?.total ?? 0,
          new_lead: data.kpi?.new_lead ?? 0,
          following: data.kpi?.following ?? 0,
          current_customer: data.kpi?.current_customer ?? 0,
          not_fit: data.kpi?.not_fit ?? 0,
        });
        setError('');
      })
      .catch(err => {
        if (!alive) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Không tải được hồ sơ khách hàng.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [page, pageSize, search, status, ownerId, team]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load, reloadTick]);

  useEffect(() => {
    const customerId = new URLSearchParams(window.location.search).get('quickCustomer') || '';
    if (!customerId) {
      restoringQuickCustomerRef.current = '';
      return;
    }
    if (quickViewCustomer?.id === customerId) return;

    const listedCustomer = items.find(customer => customer.id === customerId);
    if (listedCustomer) {
      restoringQuickCustomerRef.current = customerId;
      setQuickViewCustomer(listedCustomer);
      return;
    }
    if (loading || restoringQuickCustomerRef.current === customerId) return;

    restoringQuickCustomerRef.current = customerId;
    let alive = true;
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được khách hàng.');
        return body.data as ApiCustomerRow;
      })
      .then(customer => {
        if (alive) setQuickViewCustomer(mapCustomer(customer));
      })
      .catch(() => {
        if (alive) restoringQuickCustomerRef.current = '';
      });
    return () => { alive = false; };
  }, [items, loading, quickViewCustomer?.id]);

  const ownerName = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key) map.set(key, m.display_name);
    });
    if (user?.id && !map.has(user.id)) map.set(user.id, user.name || user.email);
    return map;
  }, [members, user]);

  const ownerTeamName = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach(m => {
      const key = m.linked_user_id || m.linked_user_id_2;
      if (key && m.team) map.set(key, m.team);
    });
    return map;
  }, [members]);

  function nextActionOf(customer: CrmCustomerRow) {
    if (customer.status === 'new_lead') return 'Xác minh nhu cầu';
    if (customer.status === 'following') return 'Theo dõi cơ hội';
    if (customer.status === 'current_customer') return 'Chăm sóc / upsell';
    if (customer.status === 'not_fit') return 'Không còn theo dõi';
    return 'Cập nhật hồ sơ';
  }

  function customerDueState(customer: CrmCustomerRow) {
    const activityAt = customer.lastDealAt || customer.updatedAt;
    const activityTime = activityAt ? new Date(activityAt).getTime() : 0;
    if (!activityTime || Number.isNaN(activityTime)) return { label: 'Chưa có hạn', overdue: false };
    const inactiveDays = Math.floor((Date.now() - activityTime) / 86_400_000);
    if (inactiveDays >= 14) return { label: `${inactiveDays} ngày chưa cập nhật`, overdue: true };
    return { label: 'Chưa có hạn', overdue: false };
  }

  // "Tất cả người phụ trách" (2026-10-03): trước đây lấy TOÀN BỘ HR roster
  // (members, không lọc vai trò) - quá rộng, lẫn cả người không liên quan gì
  // tới bán hàng. Chỉ lấy Sale/Presale (quote_business_role), dùng CHUNG
  // nguồn/API với dropdown "Người lead"/"Người xử lý (SDR)" đã sửa trước đó
  // (customerLeadService.getSdrs() - BE đã gộp admin/leader + sale/presale,
  // ở đây CHỈ giữ lại đúng sale/presale, bỏ admin/leader vì dropdown này là
  // "Người phụ trách Customer", không phải "Người lead/xử lý Deal").
  const [salePresaleUsers, setSalePresaleUsers] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      usersService.getUsersByQuoteBusinessRole('presale'),
      usersService.getUsersByQuoteBusinessRole('sale'),
    ])
      .then(([presaleRes, saleRes]) => {
        if (!alive) return;
        const byId = new Map<string, string>();
        [
          ...(presaleRes.success ? presaleRes.data || [] : []),
          ...(saleRes.success ? saleRes.data || [] : []),
        ].forEach(item => {
          if (item.id && !byId.has(item.id)) byId.set(item.id, item.name || 'Chưa đặt tên');
        });
        setSalePresaleUsers([...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => { if (alive) setSalePresaleUsers([]); });
    return () => { alive = false; };
  }, []);

  const ownerFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    salePresaleUsers.forEach(u => seen.set(u.id, u.name));
    // Dam bao option "chinh minh" luon co trong dropdown ke ca khi user hien
    // tai khong phai sale/presale (vd tai khoan admin) - neu khong, dropdown
    // se hien placeholder rong dù ownerId da duoc mac dinh = user.id (vi
    // pham yeu cau "gia tri ap dung phai hien ro tren dropdown").
    if (user?.id && !seen.has(user.id)) seen.set(user.id, user.name || user.email);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [salePresaleUsers, user]);

  const myWorkCustomers = useMemo(() => {
    if (!user?.id) return [];
    return items
      .filter(customer => customer.ownerId === user.id && customer.status !== 'not_fit')
      .sort((a, b) => {
        const aTime = new Date(a.lastDealAt || a.updatedAt || 0).getTime();
        const bTime = new Date(b.lastDealAt || b.updatedAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 3);
  }, [items, user?.id]);

  const attentionItems = useMemo(() => {
    const now = Date.now();
    return items
      .filter(customer => customer.status !== 'not_fit')
      .map(customer => {
        const activityAt = customer.lastDealAt || customer.updatedAt;
        const activityTime = activityAt ? new Date(activityAt).getTime() : 0;
        const inactiveDays = activityTime > 0 ? Math.floor((now - activityTime) / 86_400_000) : null;

        if (inactiveDays !== null && inactiveDays >= 7) {
          return { customer, message: `Không có hoạt động ${inactiveDays} ngày`, severity: 'high' as const, priority: 4 };
        }
        if (!customer.primaryContact) {
          return { customer, message: 'Thiếu người liên hệ chính', severity: 'medium' as const, priority: 3 };
        }
        if (!customer.dealCount) {
          return { customer, message: 'Chưa có cơ hội bán hàng', severity: 'medium' as const, priority: 2 };
        }
        if (customer.status === 'new_lead') {
          return { customer, message: 'Tiềm năng cần cập nhật bước tiếp theo', severity: 'medium' as const, priority: 1 };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.priority - a.priority || (b.customer.totalValue || 0) - (a.customer.totalValue || 0))
      .slice(0, 3);
  }, [items]);

  // Feedback (2026-09-24, cap nhat 2026-10-01 sang Team CRM that): chon
  // "Người phụ trách" thi tu dong loc luon Team CRM cua chinh nguoi do (vd
  // chon thanh vien A cua Team B -> Team tu hien "B"). Owner khong thuoc
  // Team CRM nao (hoac bo chon ve "Tat ca") -> Team cung ve rong.
  function handleOwnerFilterChange(value: string) {
    setOwnerId(value);
    if (!value) {
      setTeam('');
      return;
    }
    crmTeamsService
      .getTeamIdForUser(value)
      .then(res => setTeam((res.success ? res.data?.crm_team_id : null) || ''))
      .catch(() => setTeam(''));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentSafePage = Math.min(page, totalPages);
  const startRecord = total === 0 ? 0 : (currentSafePage - 1) * pageSize + 1;
  const endRecord = Math.min(currentSafePage * pageSize, total);

  function getPageNumbers(): (number | string)[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentSafePage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (currentSafePage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', currentSafePage - 1, currentSafePage, currentSafePage + 1, '...', totalPages];
  }
  const hasFilters = Boolean(search || ownerId || team);
  // "Doanh nghiệp" + "Hành động" luon hien (khong dua vao preference) + so cot
  // tuy chon dang bat - dung de colSpan cho hang loading/empty khop dung so
  // cot that su dang render.
  const visibleColumnCount = 10; // checkbox + compact customer columns + existing action column

  function resetFilters() {
    setSearchInput('');
    setSearch('');
    setOwnerId('');
    setTeam('');
    setPage(1);
  }

  function clearSearchFilter() {
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  function openAddCustomerDrawer() {
    clearSearchFilter();
    setAddDrawerOpen(true);
  }

  function closeAddCustomerDrawer() {
    setAddDrawerOpen(false);
    clearSearchFilter();
  }

  // "Chỉnh sửa" ngay trong drawer Quick View (2026-10-03) - phải cập nhật
  // NGAY `quickViewCustomer` (drawer đang mở, đọc object này trực tiếp) để
  // quay lại Quick View thấy dữ liệu mới tức thì, KHÔNG đợi reload danh sách
  // (setReloadTick vẫn gọi để đồng bộ nền cho bảng/list phía sau).
  function handleQuickViewCustomerUpdated(updated: CrmCustomerRow) {
    setQuickViewCustomer(updated);
    setReloadTick(tick => tick + 1);
  }

  function handleCreated(customerId: string) {
    setAddDrawerOpen(false);
    setReloadTick(tick => tick + 1);
    router.push(`/all-platform/crm/customers/${customerId}`);
  }

  function openCustomerRow(customer: CrmCustomerRow) {
    if (opportunityCustomer) {
      setOpportunityCustomer(customer);
      return;
    }
    setQuickViewCustomer(customer);
    syncQuickViewUrl(customer.id);
  }

  function syncQuickViewUrl(customerId?: string) {
    const url = new URL(window.location.href);
    if (customerId) url.searchParams.set('quickCustomer', customerId);
    else url.searchParams.delete('quickCustomer');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function closeQuickView() {
    setQuickViewCustomer(null);
    syncQuickViewUrl();
  }

  useEffect(() => {
    if (!quickViewCustomer) return;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-crm-customer-quickview="true"]')) return;
      if (target.closest('[data-crm-customer-row="true"]')) return;
      if (target.closest('[role="dialog"],.crm-modal,.crm-modal-backdrop,.crm-verify-drawer,.crm-action-menu')) return;
      closeQuickView();
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  }, [quickViewCustomer]);

  function quickViewReturnUrl(customerId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('quickCustomer', customerId);
    const returnUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', returnUrl);
    return returnUrl;
  }

  function openQuoteFromQuickView(quoteId: string, customerId: string) {
    const params = new URLSearchParams({
      customerId,
      returnUrl: quickViewReturnUrl(customerId),
    });
    router.push(`/all-platform/crm/quotes/${encodeURIComponent(quoteId)}?${params.toString()}`);
  }

  function openContractFromQuickView(contractId: string, customerId: string) {
    const params = new URLSearchParams({ returnUrl: quickViewReturnUrl(customerId) });
    router.push(`/all-platform/contracts/${encodeURIComponent(contractId)}?${params.toString()}`);
  }

  function handleOpportunityCreated() {
    setOpportunityCustomer(null);
    setReloadTick(tick => tick + 1);
  }

  function handleShellPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!opportunityCustomer) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.crm-verify-drawer')) return;
    if (target.closest('[data-crm-customer-row="true"]')) return;
    if (
      target.closest(
        'button,a,input,select,textarea,[role="button"],[role="menu"],[role="dialog"],.crm-action-menu,.crm-filter-card,.crm-page-tabs'
      )
    ) {
      return;
    }
    setOpportunityCustomer(null);
  }

  function openDelete(targets: CrmCustomerRow[]) {
    if (!targets.length) return;
    setDeleteError('');
    setCascadeStep(null);
    setDeleteTargets(targets);
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTargets(null);
    setCascadeStep(null);
    setDeleteError('');
  }

  /** Buoc 1 (confirmCascade=false): gui toan bo id da chon. Khach khong con
   * du lieu lien quan -> xoa luon; khach con du lieu -> backend tra ve trong
   * `failed` kem summary, chuyen modal sang buoc 2 liet ke tong so se mat.
   * Buoc 2 (confirmCascade=true): CHI gui id cua cac khach can xac nhan. */
  async function confirmDelete(confirmCascade = false) {
    const targets = deleteTargets;
    if (!targets || deleting) return;
    const ids = confirmCascade && cascadeStep ? cascadeStep.ids : targets.map(t => t.id);
    if (!ids.length) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/all-platform/crm/customers/bulk-delete`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify({ customer_ids: ids, confirm_cascade: confirmCascade }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || body?.detail || `Không xóa được khách hàng (lỗi ${res.status}).`);
      const deletedIds = (body.data?.deleted_ids || []) as string[];
      const failed = (body.data?.failed || []) as Array<{
        customer_id: string;
        message: string;
        requiresCascadeConfirm?: boolean;
        summary?: CascadeSummary;
      }>;
      if (deletedIds.length) {
        const deletedSet = new Set(deletedIds);
        setItems(current => current.filter(row => !deletedSet.has(row.id)));
        setTotal(current => Math.max(0, current - deletedIds.length));
        setSelectedIds(prev => {
          const next = new Set(prev);
          deletedIds.forEach(id => next.delete(id));
          return next;
        });
        setReloadTick(tick => tick + 1);
      }
      const nameOf = (id: string) => targets.find(t => t.id === id)?.customerName || id;
      const needConfirm = confirmCascade ? [] : failed.filter(f => f.requiresCascadeConfirm && f.summary);
      const otherFailed = failed.filter(f => confirmCascade || !f.requiresCascadeConfirm);
      if (needConfirm.length) {
        setCascadeStep({
          ids: needConfirm.map(f => f.customer_id),
          summary: sumCascadeSummaries(needConfirm.map(f => f.summary || {})),
        });
        if (otherFailed.length) setDeleteError(otherFailed.map(f => `${nameOf(f.customer_id)}: ${f.message}`).join(' · '));
        return;
      }
      if (otherFailed.length) {
        setCascadeStep(null);
        setDeleteError(otherFailed.map(f => `${nameOf(f.customer_id)}: ${f.message}`).join(' · '));
        return;
      }
      setDeleteTargets(null);
      setCascadeStep(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Không xóa được khách hàng.');
    } finally {
      setDeleting(false);
    }
  }

  // "ai muốn xóa thì xóa" - moi khach hang deu chon duoc de xoa.
  const selectableCustomers = items;
  const allOnPageSelected = selectableCustomers.length > 0 && selectableCustomers.every(customer => selectedIds.has(customer.id));
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
      if (allOnPageSelected) selectableCustomers.forEach(customer => next.delete(customer.id));
      else selectableCustomers.forEach(customer => next.add(customer.id));
      return next;
    });
  }


  /** Dùng chung cho cả bảng desktop lẫn card mobile — tránh 2 bản danh sách
   * hành động lệch nhau. "Xóa" chỉ hiện với người có quyền sửa hồ sơ (đúng
   * quyền `can_edit_customer` backend đã kiểm — canEdit dùng chung cho cả
   * sửa lẫn xóa). Còn dữ liệu liên quan thì backend yêu cầu xác nhận xoá kèm
   * (bước 2 của modal), không chặn cứng. */
  function secondaryActionsOf(customer: CrmCustomerRow): ActionMenuItem[] {
    // "Sửa" (2026-10-03): bỏ khỏi menu 3 chấm - sửa giờ nằm ở icon bút chì
    // ngay trong drawer "Xem thông tin nhanh" (CustomerQuickViewPanel), mở
    // 2 đường cho cùng 1 thao tác gây nhầm lẫn. Xoa van mo cho moi nguoi
    // (chi hoi xac nhan).
    return [
      {
        key: 'delete',
        label: 'Xóa',
        danger: true,
        onSelect: () => openDelete([customer]),
      },
    ];
  }

  function renderPrimaryAction(customer: CrmCustomerRow) {
    const label = PRIMARY_ACTION_LABEL[customer.status || ''];
    if (!label) return null;
    return (
      <button
        type="button"
        className="crm-row-action-primary"
        onClick={event => {
          event.stopPropagation();
          setOpportunityCustomer(customer);
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="crm-shell" onPointerDownCapture={handleShellPointerDown}>
      <section className="crm-page-card crm-customers-page-shell">
        {error ? <p className="crm-error">{error}</p> : null}

        <div className="crm-guidance-strip">
          <div className="crm-guidance-chip">Biết rõ doanh nghiệp/khách hàng → Thêm khách hàng.</div>
          <div className="crm-guidance-chip">
            Đầu mối chưa xác minh → <Link href="/all-platform/crm/leads">Tạo Lead</Link>.
          </div>
          <div className="crm-guidance-chip">Có nhu cầu bán hàng → Tạo cơ hội.</div>
        </div>

        <div className="crm-page-tabs" role="tablist">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value || 'all'}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              className={`crm-page-tab ${status === tab.value ? 'crm-page-tab--active' : ''}`}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
              <span className="crm-page-tab-count">{kpi[tab.kpiKey]}</span>
            </button>
          ))}
        </div>

        <section className="crm-filter-card">
          <div className="crm-filter-grid crm-filter-grid--customers-v2">
            <input
              type="search"
              name="crm-customers-directory-search"
              value={searchInput}
              onChange={event => setSearchInput(event.target.value)}
              className="crm-input"
              placeholder="Tìm tên doanh nghiệp, mã KH, mã LH, MST, người liên hệ, SĐT, email..."
              autoComplete="off"
            />
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={ownerId}
                onChange={handleOwnerFilterChange}
                placeholder="Tất cả người phụ trách"
                options={ownerFilterOptions.map(([id, name]) => ({ value: id, label: name }))}
              />
            </div>
            <div className="crm-filter-select-wrap">
              <SearchableSelect
                value={team}
                onChange={setTeam}
                placeholder="Tất cả Team"
                options={crmTeamOptions.map(t => ({ value: t.id, label: t.name }))}
              />
            </div>
            <div className="crm-icon-action-group" style={{ gap: '0.5rem' }}>
              {hasFilters ? (
                <button type="button" className="crm-secondary-button crm-filter-reset" onClick={resetFilters}>
                  <RotateCcw className="crm-button-icon" /> Xóa lọc
                </button>
              ) : null}
              <CustomerColumnVisibilityMenu
                visible={visibleColumns}
                onToggle={toggleColumn}
                onSelectAll={selectAllColumns}
                onReset={resetColumnsToDefault}
              />
              <button type="button" className="crm-primary-button" onClick={openAddCustomerDrawer}>
                <Plus className="crm-button-icon" /> Thêm khách hàng
              </button>
            </div>
          </div>
        </section>

        {selectedIds.size > 0 ? (
          <div
            className="crm-filter-card"
            data-testid="customer-bulk-bar"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}
          >
            <span style={{ fontWeight: 600 }}>Đã chọn {selectedIds.size} khách hàng</span>
            <div className="crm-icon-action-group" style={{ gap: '0.5rem' }}>
              <button type="button" className="crm-secondary-button" onClick={() => setSelectedIds(new Set())}>
                Bỏ chọn
              </button>
              <button
                type="button"
                className="crm-primary-button"
                data-testid="customer-bulk-delete-btn"
                onClick={() => openDelete(items.filter(customer => selectedIds.has(customer.id)))}
              >
                Xóa những khách hàng đã chọn
              </button>
            </div>
          </div>
        ) : null}

        <div className={`crm-customer-workspace${!workSectionsExpanded ? ' is-work-collapsed' : ''}`}>
        <aside className="crm-customer-side-rail" aria-label="Công việc và cảnh báo khách hàng">
        <div className="crm-work-sections-toggle-row">
          <button
            type="button"
            className="crm-work-sections-toggle"
            onClick={() => setWorkSectionsExpanded(value => !value)}
            aria-expanded={workSectionsExpanded}
            aria-label={workSectionsExpanded ? 'Thu gọn' : 'Mở nhanh'}
            title={workSectionsExpanded ? 'Thu gọn' : 'Mở nhanh'}
          >
            {workSectionsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
        <section className={`crm-my-work${workSectionsExpanded ? ' is-expanded' : ' is-collapsed'}`} aria-labelledby="crm-my-work-title">
          <div className="crm-my-work-header">
            <div>
              <span className="crm-my-work-icon" aria-hidden="true"><ListTodo size={18} /></span>
              <div>
                <h2 id="crm-my-work-title">Việc của tôi hôm nay</h2>
                <p>{myWorkCustomers.length ? `${myWorkCustomers.length} khách hàng cần theo dõi trên trang này` : 'Chưa có khách hàng cần theo dõi trên trang này'}</p>
              </div>
            </div>
          </div>
          {workSectionsExpanded ? (
            <div className="crm-my-work-list">
              {myWorkCustomers.length ? myWorkCustomers.map(customer => (
                <button
                  key={customer.id}
                  type="button"
                  className={`crm-my-work-item${quickViewCustomer?.id === customer.id ? ' is-active' : ''}`}
                  onClick={() => openCustomerRow(customer)}
                >
                  <span className="crm-my-work-item-main">
                    <strong>{customer.customerName}</strong>
                    <small>
                      {customer.status === 'new_lead'
                        ? 'Xác minh nhu cầu và cập nhật bước tiếp theo'
                        : customer.status === 'current_customer'
                          ? 'Chăm sóc khách hàng và rà soát cơ hội'
                          : 'Theo dõi cơ hội đang bán'}
                    </small>
                  </span>
                  <span className="crm-my-work-item-meta">
                    <span><Clock3 size={13} /> {relativeTime(customer.lastDealAt || customer.updatedAt) || 'Chưa cập nhật'}</span>
                    <b>{formatVND(customer.totalValue || 0) || '0 đ'}</b>
                  </span>
                </button>
              )) : (
                <div className="crm-my-work-empty">Không có việc cần ưu tiên trong danh sách hiện tại.</div>
              )}
            </div>
          ) : null}
        </section>

        <section className={`crm-attention${workSectionsExpanded ? ' is-expanded' : ' is-collapsed'}`} aria-labelledby="crm-attention-title">
          <div className="crm-my-work-header">
            <div>
              <span className="crm-attention-icon" aria-hidden="true"><AlertTriangle size={18} /></span>
              <div>
                <h2 id="crm-attention-title">Cần chú ý</h2>
                <p>{attentionItems.length ? `${attentionItems.length} hồ sơ cần kiểm tra` : 'Không có cảnh báo trên trang này'}</p>
              </div>
            </div>
          </div>
          {workSectionsExpanded ? (
            <div className="crm-attention-list">
              {attentionItems.length ? attentionItems.map(entry => (
                <button
                  key={entry.customer.id}
                  type="button"
                  className="crm-attention-item"
                  onClick={() => openCustomerRow(entry.customer)}
                >
                  <span>
                    <strong>{entry.customer.customerName}</strong>
                    <small>{entry.message} · {formatVND(entry.customer.totalValue || 0) || '0 đ'}</small>
                  </span>
                  <b className={`crm-attention-level is-${entry.severity}`}>{entry.severity === 'high' ? 'Cao' : 'TB'}</b>
                </button>
              )) : (
                <div className="crm-my-work-empty">Không có hồ sơ cần chú ý trong danh sách hiện tại.</div>
              )}
            </div>
          ) : null}
        </section>
        </aside>

        <section className="crm-directory-list-box">
          <div className="crm-directory-list-top">
            <div>
              <h2 className="crm-directory-list-heading">Danh sách khách hàng</h2>
              <p className="crm-directory-list-sub">
                Tổng {total} khách hàng · Click vào khách hàng để mở hồ sơ chi tiết
              </p>
            </div>
          </div>

          <div className="crm-table-card crm-customer-table-card--desktop">
            <div className="crm-table-scroll">
              <table className="crm-table crm-customer-directory-table crm-customer-directory-table--v2">
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col className="crm-col-customer-compact-main" />
                  <col className="crm-col-customer-compact-owner" />
                  <col className="crm-col-customer-compact-count" />
                  <col className="crm-col-customer-compact-money" />
                  <col className="crm-col-customer-compact-stage" />
                  <col className="crm-col-customer-compact-next" />
                  <col className="crm-col-customer-compact-due" />
                  <col className="crm-col-customer-compact-activity" />
                  <col className="crm-col-cust-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="crm-th">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        disabled={selectableCustomers.length === 0}
                        onChange={toggleSelectAllOnPage}
                        aria-label="Chọn tất cả khách hàng trên trang này"
                      />
                    </th>
                    <th className="crm-th">Khách hàng</th>
                    <th className="crm-th">Team / Owner</th>
                    <th className="crm-th crm-th--right">Cơ hội mở</th>
                    <th className="crm-th crm-th--right">Pipeline</th>
                    <th className="crm-th">Giai đoạn</th>
                    <th className="crm-th">Việc tiếp theo</th>
                    <th className="crm-th">Hạn</th>
                    <th className="crm-th">Last activity</th>
                    <th className="crm-th crm-th--right crm-th--actions-col">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={visibleColumnCount} className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</td></tr>
                  ) : items.length ? (
                    items.map(customer => {
                      const primaryContactName = customer.primaryContact?.name || customer.companyName || 'Chưa có liên hệ';
                      const primaryPhone = customer.primaryContact?.phone || customer.phone || '';
                      const owner = ownerName.get(customer.ownerId || '') || 'Chưa gán';
                      const teamName = ownerTeamName.get(customer.ownerId || '') || 'Chưa có team';
                      const dueState = customerDueState(customer);
                      const activityLabel = relativeTime(customer.lastDealAt || customer.updatedAt) || 'Chưa cập nhật';
                      const isActiveCustomer = quickViewCustomer?.id === customer.id || opportunityCustomer?.id === customer.id;
                      return (
                        <tr
                          key={customer.id}
                          className={`crm-row crm-row--clickable crm-customer-compact-row${isActiveCustomer ? ' is-quickview-selected' : ''}`}
                          data-crm-customer-row="true"
                          onClick={() => openCustomerRow(customer)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className="crm-td" onClick={event => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(customer.id)}
                              onChange={() => toggleSelect(customer.id)}
                              aria-label={`Chọn ${customer.customerName}`}
                            />
                          </td>
                          <td className="crm-td crm-customer-compact-main-cell">
                            <div className="crm-customer-compact-identity">
                              <Link
                                href={`/all-platform/crm/customers/${customer.id}`}
                                className="crm-customer-compact-name"
                                title={customer.companyName && customer.companyName !== (customer.shortName || customer.customerName) ? `${customer.companyName}${customer.customerName && customer.customerName !== customer.companyName ? ` (${customer.customerName})` : ''}` : customer.customerName}
                                onClick={event => event.stopPropagation()}
                              >
                                {customer.shortName || customer.companyName || customer.customerName}
                              </Link>
                              <div className="crm-customer-compact-sub" title={[primaryContactName, primaryPhone].filter(Boolean).join(' · ')}>
                                <span>{primaryContactName}</span>
                                {primaryPhone ? <span>·</span> : null}
                                {primaryPhone ? (
                                  <a href={`tel:${primaryPhone.replace(/[^\d+]/g, '')}`} onClick={event => event.stopPropagation()}>
                                    {primaryPhone}
                                  </a>
                                ) : null}
                                {(customer.contactCount || 0) > 1 ? (
                                  <ContactSummaryBadge customerId={customer.id} extraCount={(customer.contactCount || 0) - 1} />
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="crm-td crm-customer-compact-stack">
                            <strong title={teamName}>{teamName}</strong>
                            <span title={owner}>{owner}</span>
                          </td>
                          <td className="crm-td crm-td--right crm-customer-compact-count">{customer.dealCount || 0}</td>
                          <td className="crm-td crm-td--right">
                            <span className="crm-customer-compact-money">{formatVND(customer.totalValue || 0) || '0 đ'}</span>
                          </td>
                          <td className="crm-td">
                            <span className={`crm-customer-status-badge ${STATUS_BADGE_CLASS[customer.status || ''] || ''}`}>
                              {STATUS_LABEL[customer.status || ''] || 'Chưa phân loại'}
                            </span>
                          </td>
                          <td className="crm-td crm-customer-compact-stack">
                            <strong title={nextActionOf(customer)}>{nextActionOf(customer)}</strong>
                            <span>{customer.dealCount ? `${customer.dealCount} cơ hội` : 'Chưa có cơ hội'}</span>
                          </td>
                          <td className="crm-td">
                            <span className={`crm-customer-compact-due${dueState.overdue ? ' is-overdue' : ''}`}>{dueState.label}</span>
                          </td>
                          <td className="crm-td crm-small crm-customer-compact-activity" title={activityLabel}>{activityLabel}</td>
                        <td className="crm-td crm-td--actions-col" onClick={event => event.stopPropagation()}>
                          <div className="crm-row-actions">
                            {renderPrimaryAction(customer)}
                            <ActionMenu
                              label="Thao tác khác"
                              items={secondaryActionsOf(customer)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                  ) : (
                    <tr>
                      <td colSpan={visibleColumnCount}>
                        <div className="crm-empty-state">
                          <span className="crm-empty-state-icon">
                            <Plus className="crm-button-icon" />
                          </span>
                          <p className="crm-empty-state-title">
                            {hasFilters ? 'Không có hồ sơ phù hợp với bộ lọc' : 'Chưa có khách hàng'}
                          </p>
                          <p className="crm-empty-state-desc">
                            {hasFilters
                              ? 'Thử đổi từ khóa tìm kiếm hoặc bấm "Xóa lọc" để xem lại toàn bộ danh sách.'
                              : 'Bắt đầu bằng cách thêm hồ sơ khách hàng đầu tiên vào CRM.'}
                          </p>
                          {hasFilters ? (
                            <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                              <RotateCcw className="crm-button-icon" /> Xóa lọc
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="crm-primary-button"
                              onClick={openAddCustomerDrawer}
                            >
                              <Plus className="crm-button-icon" /> Thêm khách hàng đầu tiên
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

          {/* Bang desktop 8 cot khong dung duoc o man hep - table-layout:fixed
           * ep het chu xuong tung ky tu, khong doc noi (bug thuc te thay qua
           * anh chup 375/768px). Thay bang danh sach card rieng, chi hien o
           * man hep qua CSS (xem .crm-customer-card-list). */}
          <div className="crm-customer-card-list">
            {loading ? (
              <div className="crm-empty-cell"><Loader2 className="crm-spin-icon" /> Đang tải...</div>
            ) : items.length ? (
              items.map(customer => (
                <div
                  key={customer.id}
                  className={`crm-customer-card${quickViewCustomer?.id === customer.id || opportunityCustomer?.id === customer.id ? ' is-quickview-selected' : ''}`}
                  data-crm-customer-row="true"
                  onClick={() => openCustomerRow(customer)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="crm-customer-card-head">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(customer.id)}
                      onClick={event => event.stopPropagation()}
                      onChange={() => toggleSelect(customer.id)}
                      aria-label={`Chọn ${customer.customerName}`}
                      style={{ marginTop: 4 }}
                    />
                    <div className="crm-customer-card-identity">
                      <Link
                        href={`/all-platform/crm/customers/${customer.id}`}
                        className="crm-customer-name-link"
                        title={customer.customerName}
                        onClick={event => event.stopPropagation()}
                      >
                        {customer.customerName}
                      </Link>
                      <div className="crm-customer-company" title={customer.taxCode ? `MST: ${customer.taxCode}` : 'Chưa có MST'}>
                        {customer.taxCode ? `MST: ${customer.taxCode}` : 'Chưa có MST'}
                      </div>
                    </div>
                    <span className={`crm-customer-status-badge ${STATUS_BADGE_CLASS[customer.status || ''] || ''}`}>
                      {STATUS_LABEL[customer.status || ''] || 'Chưa phân loại'}
                    </span>
                  </div>
                  <div className="crm-customer-card-meta">
                    <span className="crm-small">{ownerName.get(customer.ownerId || '') || 'Chưa gán'}</span>
                  </div>
                  <div className="crm-customer-card-metrics">
                    <span>{customer.contactCount || 0} contact</span>
                    <span>{customer.dealCount || 0} deal</span>
                    <span className="crm-budget">{formatVND(customer.totalValue || 0) || '0 đ'}</span>
                  </div>
                  <div className="crm-customer-card-actions" onClick={event => event.stopPropagation()}>
                    {renderPrimaryAction(customer)}
                    <ActionMenu
                      label="Thao tác khác"
                      items={secondaryActionsOf(customer)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="crm-empty-state">
                <span className="crm-empty-state-icon">
                  <Plus className="crm-button-icon" />
                </span>
                <p className="crm-empty-state-title">
                  {hasFilters ? 'Không có hồ sơ phù hợp với bộ lọc' : 'Chưa có khách hàng'}
                </p>
                <p className="crm-empty-state-desc">
                  {hasFilters
                    ? 'Thử đổi từ khóa tìm kiếm hoặc bấm "Xóa lọc" để xem lại toàn bộ danh sách.'
                    : 'Bắt đầu bằng cách thêm hồ sơ khách hàng đầu tiên vào CRM.'}
                </p>
                {hasFilters ? (
                  <button type="button" className="crm-secondary-button" onClick={resetFilters}>
                    <RotateCcw className="crm-button-icon" /> Xóa lọc
                  </button>
                ) : (
                  <button
                    type="button"
                    className="crm-primary-button"
                    onClick={openAddCustomerDrawer}
                  >
                    <Plus className="crm-button-icon" /> Thêm khách hàng đầu tiên
                  </button>
                )}
              </div>
            )}
          </div>

          {total > 0 ? (
            <div className="crm-progress-pagination">
              <div className="crm-progress-pagination-info">
                Hiển thị {startRecord} - {endRecord} trên {total} Khách hàng
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
                  aria-label="Trang sau"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="crm-progress-pagination-size">
                <select
                  value={pageSize}
                  onChange={e => {
                    const newSize = Number(e.target.value);
                    setPageSize(newSize);
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
        </div>
      </section>

      <CustomerQuickViewPanel
        open={Boolean(quickViewCustomer)}
        customer={quickViewCustomer}
        ownerName={ownerName.get(quickViewCustomer?.ownerId || '') || 'Chưa gán'}
        onClose={closeQuickView}
        onCreateOpportunity={customer => setOpportunityCustomer(customer)}
        onOpenDetail={(customerId, tab) => router.push(`/all-platform/crm/customers/${customerId}${tab ? `?tab=${tab}` : ''}`)}
        onOpenQuote={openQuoteFromQuickView}
        onOpenContract={openContractFromQuickView}
        currentUser={user}
        onCustomerUpdated={handleQuickViewCustomerUpdated}
      />

      <CustomerAddDrawer
        open={addDrawerOpen}
        currentUser={user}
        onClose={closeAddCustomerDrawer}
        onCreated={handleCreated}
      />

      <CreateOpportunityDrawer
        open={Boolean(opportunityCustomer)}
        customer={opportunityCustomer}
        currentUser={user}
        onClose={() => setOpportunityCustomer(null)}
        onCreated={handleOpportunityCreated}
      />

      {deleteTargets ? (
        <div className="crm-modal-backdrop crm-modal-backdrop--confirm" onClick={closeDelete}>
          <div
            className="crm-modal crm-modal--confirm"
            role="dialog"
            aria-modal="true"
            data-testid="customer-delete-confirm"
            onClick={event => event.stopPropagation()}
          >
            <header className="crm-modal-header">
              <div>
                <p className="crm-modal-title">
                  {deleteTargets.length === 1 ? 'Xóa khách hàng' : `Xóa ${deleteTargets.length} khách hàng`}
                </p>
                <p className="crm-modal-subtitle">Hành động này không thể hoàn tác.</p>
              </div>
            </header>
            <div className="crm-modal-body">
              {deleteError ? <p className="crm-error" data-testid="customer-delete-error">{deleteError}</p> : null}
              {cascadeStep ? (
                <>
                  <div className="crm-lead-check-banner crm-lead-check-banner--warning" data-testid="customer-delete-cascade-warning">
                    <b>
                      {cascadeStep.ids.length === 1 && deleteTargets.length === 1
                        ? `Khách hàng “${deleteTargets[0].customerName}” còn dữ liệu liên quan`
                        : `${cascadeStep.ids.length} khách hàng còn dữ liệu liên quan`}
                    </b>
                    <span>
                      Sẽ bị xoá kèm: <b>{describeCascadeSummary(cascadeStep.summary)}</b>. {cascadeLossText(cascadeStep.summary)}
                    </span>
                    <span>Bạn có chấp nhận mất toàn bộ dữ liệu này và xoá không?</span>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {deleteTargets.length === 1 ? (
                      <>Xóa khách hàng <b>&ldquo;{deleteTargets[0].customerName}&rdquo;</b>?</>
                    ) : (
                      <>Xóa <b>{deleteTargets.length} khách hàng</b> đã chọn?</>
                    )}{' '}
                    Hành động này không thể hoàn tác.
                  </p>
                  <p className="crm-ai-fill-hint">
                    Nếu khách hàng còn cơ hội, lead, người liên hệ, dự án, báo giá hoặc hợp đồng, hệ thống sẽ liệt kê rõ và
                    hỏi lại trước khi xoá kèm — không xoá âm thầm.
                  </p>
                </>
              )}
            </div>
            <footer className="crm-modal-footer">
              <button
                type="button"
                className="crm-cancel-button"
                data-testid="customer-delete-cancel"
                disabled={deleting}
                onClick={closeDelete}
              >
                Hủy
              </button>
              <button
                  type="button"
                  className="crm-danger-button"
                  data-testid="customer-delete-confirm-btn"
                  disabled={deleting}
                  onClick={() => void confirmDelete(Boolean(cascadeStep))}
                >
                  {deleting ? <Loader2 className="crm-save-spinner" /> : null}
                  {deleting ? 'Đang xóa...' : cascadeStep ? 'Chấp nhận mất & xóa toàn bộ' : deleteTargets.length === 1 ? 'Xóa khách hàng' : 'Xóa khách hàng đã chọn'}
                </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
