'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, API_KEY } from '@/lib/env';
import { useAppAuth } from '@/contexts/AppAuthContext';
import { formatVND, getStageMeta } from '../constants/crmConfig';
import type { DealStage } from '../types';
import { CustomerFormModal } from './CustomerFormModal';
import { CrmContactsPanel } from './CrmContactsPanel';
import { ProjectFormModal } from './ProjectFormModal';
import { Loader2, Plus } from './icons';
import type { CrmCustomerRow } from '../types';
import { customerProjectsSummaryService, type CustomerProjectsSummary, type Project } from '@/services/all-platform.service';
import { formatMoney, relativeTime } from '../utils/quoteDisplay';
import { useMembers } from '@/hooks/useMembers';
import { QuoteWorkspaceModal } from './QuoteWorkspaceModal';
import { seedingCrmRepository } from '../repositories/SeedingCrmRepository';
import type { Deal } from '../types';

type RelatedPayload = {
  customer?: {
    id: string;
    customer_name?: string | null;
    company_name?: string | null;
    position?: string | null;
    phone?: string | null;
    email?: string | null;
    zalo?: string | null;
    facebook?: string | null;
    telegram?: string | null;
    website?: string | null;
    tax_code?: string | null;
    address?: string | null;
    city?: string | null;
    industry?: string | null;
    source?: string | null;
    status?: CrmCustomerRow['status'] | null;
    owner_id?: string | null;
    note?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  };
  deals?: Array<{
    id: string;
    customer_name?: string | null;
    deal_stage?: string | null;
    estimated_budget?: number | string | null;
    lifetime_value?: number | string | null;
    updated_at?: string | null;
    project_id?: string | null;
    leader_name?: string | null;
    sdr_name?: string | null;
  }>;
  // Nguon: related_records() (crm_customer_service.py) -> supabase.table("quotes").select("*")
  // - TRA VE NGUYEN raw row cua bang quotes (snake_case that, KHONG qua lop
  // chuan hoa camelCase dung o /quotes/by-phase) - dung DUNG ten cot that.
  quotes?: Array<{
    id: string;
    quote_number?: string | null;
    status?: string | null;
    total_amount?: number | string | null;
    deal_id?: string | null;
    project_id?: string | null;
    version_chain_id?: string | null;
    version_number?: number | null;
    processing_stage?: string | null;
    technical_owner_id?: string | null;
    quote_owner_id?: string | null;
    sla_due_at?: string | null;
    approved_at?: string | null;
    published_at?: string | null;
    sent_at?: string | null;
    deleted_at?: string | null;
    updated_at?: string | null;
  }>;
  contracts?: Array<{
    id: string;
    contract_number?: string | null;
    status?: string | null;
    deal_id?: string | null;
  }>;
  kpi?: {
    deal_count?: number;
    quote_count?: number;
    contract_count?: number;
    total_value?: number;
  };
};

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

type RelatedQuoteRow = NonNullable<RelatedPayload['quotes']>[number];

// Cung DUNG 1 thu tu uu tien voi _derive_quote_phase() (backend,
// supabase_quote_service.py) va phaseCellLabel() (QuoteCenterPage.tsx) -
// KHONG duoc de status ghi de tin hieu sent/published (xem lich su fix
// "Admin review 4" trong phien nay).
function quoteChainPhaseLabel(row: RelatedQuoteRow): string {
  if (row.deleted_at || row.status === 'cancelled') return 'Đã huỷ';
  if (row.sent_at) return 'Đã gửi';
  if (row.published_at || row.processing_stage === 'published') return 'Sẵn sàng gửi';
  if (row.status === 'approved' || row.approved_at) return 'Sẵn sàng gửi';
  if (row.processing_stage === 'review') return 'Admin review';
  if (row.processing_stage === 'pricing') return 'Sale markup';
  return 'Presale';
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: 'Lên kế hoạch',
  active: 'Đang triển khai',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

function headers() {
  const value: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) value['X-API-Key'] = API_KEY;
  return value;
}

function isAdminOrLeader(role?: string) {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'admin' || normalized === 'leader';
}

function toCustomerRow(customer: RelatedPayload['customer']): CrmCustomerRow | null {
  if (!customer) return null;
  return {
    id: customer.id,
    customerName: customer.customer_name || '',
    companyName: customer.company_name || '',
    position: customer.position || '',
    phone: customer.phone || '',
    email: customer.email || '',
    zalo: customer.zalo || '',
    facebook: customer.facebook || '',
    telegram: customer.telegram || '',
    website: customer.website || '',
    taxCode: customer.tax_code || '',
    address: customer.address || '',
    city: customer.city || '',
    industry: customer.industry || '',
    source: customer.source || '',
    status: customer.status || undefined,
    ownerId: customer.owner_id || '',
    note: customer.note || '',
    createdAt: customer.created_at || '',
    updatedAt: customer.updated_at || '',
  };
}

type Tab = 'projects' | 'deals' | 'quotes' | 'contracts';

export function CrmCustomerDetailPage({ customerId }: { customerId: string }) {
  const { user } = useAppAuth();
  const searchParams = useSearchParams();
  const [data, setData] = useState<RelatedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Cho phep deep-link tu trang khac (vd cot "Dự án" o Trung tâm báo giá):
  // ?tab=quotes&projectId=xxx -> mo dung tab + loc dung Du an ngay khi vao
  // trang, khong bat nguoi dung tu bam lai. Chi doc 1 LAN luc mount (gia tri
  // ban dau cua useState) - doi tab/filter sau do van la tuong tac binh
  // thuong cua nguoi dung, khong bi query string cu ghi de lai.
  const initialTabParam = searchParams.get('tab');
  const initialTab: Tab = initialTabParam === 'quotes' || initialTabParam === 'deals' || initialTabParam === 'contracts' ? initialTabParam : 'projects';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editOpen, setEditOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Tab "Du an" (Checkpoint C) - 1 API tong hop rieng (khong nam trong
  // /related cu, tranh phinh to payload cho nhung trang khac khong can Du an).
  const [projectsSummary, setProjectsSummary] = useState<CustomerProjectsSummary | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [projectModal, setProjectModal] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });

  // Tab "Báo giá" - filter theo 1 Project cu the (Block 1, muc 7: "Xem báo
  // giá" tren Project card phai THAT SU chuyen tab + loc, khong chi navigate).
  const [quoteProjectFilter, setQuoteProjectFilter] = useState<string | null>(searchParams.get('projectId'));
  // "Xem" tren 1 dong Bao gia -> mo 1 QuoteWorkspaceModal instance MOI (Block
  // 1, muc 9) - deal that duoc nap lazy (1 lan, dung luc bam Xem) de modal co
  // du du lieu Khach hang/Co hoi hien dung, khong dung ban Deal rut gon cua
  // trang nay.
  const [quoteWorkspace, setQuoteWorkspace] = useState<{ quoteId: string; deal: Deal | null } | null>(null);
  const [quoteWorkspaceLoading, setQuoteWorkspaceLoading] = useState(false);
  // Presale/Sale hien ten that (technical_owner_id/quote_owner_id la
  // app_users.id that) - dung DUNG 1 nguon voi moi noi khac trong app
  // (useMembers(), khop linked_user_id).
  const { members } = useMembers();
  function projectLabel(projectId?: string | null): string {
    if (!projectId) return 'Chưa thuộc dự án';
    const found = projectsSummary?.projects.find(p => p.id === projectId);
    return found ? `${found.projectCode} · ${found.name}` : 'Đang tải…';
  }
  function memberName(userId?: string | null): string {
    if (!userId) return 'Chưa gán';
    const match = members.find(m => (m.linked_user_id || m.linked_user_id_2) === userId);
    return match?.display_name || 'Chưa gán';
  }

  async function viewQuoteInNewWorkspace(row: RelatedQuoteRow) {
    setQuoteWorkspaceLoading(true);
    try {
      const deal = row.deal_id ? await seedingCrmRepository.getDeal(row.deal_id).catch(() => null) : null;
      setQuoteWorkspace({ quoteId: row.id, deal });
    } finally {
      setQuoteWorkspaceLoading(false);
    }
  }

  // Bao gia tab: gom theo version_chain_id (fallback ve id neu chua co
  // chuoi), CHI giu ban CURRENT (version_number lon nhat) trong moi chuoi -
  // dung nguyen tac da dung o get_customer_projects_summary() backend.
  const allQuoteChains = useMemo(() => {
    const rows = data?.quotes || [];
    const byChain = new Map<string, RelatedQuoteRow[]>();
    for (const row of rows) {
      const key = row.version_chain_id || row.id;
      const list = byChain.get(key) || [];
      list.push(row);
      byChain.set(key, list);
    }
    return [...byChain.values()].map(list => {
      const sorted = [...list].sort((a, b) => (b.version_number || 1) - (a.version_number || 1));
      return { current: sorted[0], versionCount: list.length };
    });
  }, [data?.quotes]);
  const quoteChains = useMemo(
    () => (quoteProjectFilter ? allQuoteChains.filter(c => c.current.project_id === quoteProjectFilter) : allQuoteChains),
    [allQuoteChains, quoteProjectFilter]
  );

  useEffect(() => {
    let alive = true;
    setProjectsLoading(true);
    customerProjectsSummaryService.get(customerId).then(res => {
      if (!alive) return;
      if (res.success && res.data) {
        setProjectsSummary(res.data);
        setProjectsError('');
      } else {
        setProjectsError(res.message || 'Không tải được danh sách dự án.');
      }
    }).catch(err => {
      if (alive) setProjectsError(err instanceof Error ? err.message : 'Không tải được danh sách dự án.');
    }).finally(() => {
      if (alive) setProjectsLoading(false);
    });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/all-platform/crm/customers/${encodeURIComponent(customerId)}/related`, {
      credentials: 'include',
      headers: headers(),
    })
      .then(async res => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || 'Không tải được hồ sơ khách hàng.');
        return body.data as RelatedPayload;
      })
      .then(payload => {
        if (alive) {
          setData(payload);
          setError('');
        }
      })
      .catch(err => {
        if (alive) setError(err instanceof Error ? err.message : 'Không tải được hồ sơ khách hàng.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [customerId, reloadTick]);

  const customer = data?.customer;
  const customerRow = useMemo(() => toCustomerRow(customer), [customer]);

  // can_edit KHÔNG được /related trả kèm (chỉ list_customers() mới attach) —
  // suy lại đúng quy tắc can_edit_customer() ở backend (crm_customer_service.py):
  // admin/leader luôn sửa được; còn lại chỉ khi owner_id === chính mình. Đây
  // chỉ là UX (ẩn/hiện nút Sửa) — server vẫn tự enforce lại khi PUT.
  const canEdit = Boolean(
    customer &&
    user &&
    (isAdminOrLeader(user.role) || String(customer.owner_id || '') === String(user.id || ''))
  );

  // Mirror can_manage_project(user, project=None) o backend cho TAO MOI -
  // CHI Admin/Leader (sale-team membership KHONG cap quyen tao Project, xem
  // crm_permission_service.py) - server van tu enforce lai khi POST.
  const canManageProject = Boolean(user && isAdminOrLeader(user.role));

  const dealLink = useMemo(() => {
    if (!customer) return '/all-platform/crm';
    const params = new URLSearchParams({
      openDeal: 'new',
      customerId: customer.id,
      customerName: customer.customer_name || '',
    });
    if (customer.company_name) params.set('companyName', customer.company_name);
    if (customer.phone) params.set('phone', customer.phone);
    if (customer.email) params.set('email', customer.email);
    return `/all-platform/crm?${params.toString()}`;
  }, [customer]);

  // "+ Tạo báo giá" o header - CHI mang customerId (khong projectId, Du an
  // se cho chon tu do trong workspace vi day la muc header cua ca Ho so,
  // khong phai cua 1 Project cu the - khac voi nut tren tung Project card).
  const quoteLink = useMemo(() => {
    if (!customer) return '/all-platform/quote-center';
    const params = new URLSearchParams({ openQuote: 'new', customerId: customer.id });
    return `/all-platform/quote-center?${params.toString()}`;
  }, [customer]);

  if (loading && !data) {
    return (
      <div className="crm-shell">
        <div className="crm-loading">
          <Loader2 className="crm-spin-icon" />
          <span>Đang tải hồ sơ khách hàng...</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="crm-shell">
        <div className="crm-empty">
          <div>
            <h3>Không tải được hồ sơ khách hàng</h3>
            <p>{error}</p>
            <button type="button" className="crm-primary-button crm-empty-action" onClick={() => setReloadTick(t => t + 1)}>
              Thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  const initial = (customer?.customer_name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="crm-shell">
      <section className="crm-page-card crm-customers-page-shell">
        <Link href="/all-platform/crm/customers" className="crm-back-button crm-customer-detail-back">
          ← Hồ sơ khách hàng
        </Link>
        <div className="crm-header">
          <div className="crm-customer-detail-header">
            <span className="crm-customer-avatar" aria-hidden="true">{initial}</span>
            <div className="crm-customer-detail-title">
              <h1>{customer?.customer_name || 'Khách hàng chưa tên'}</h1>
              <div className="crm-customer-detail-meta">
                <span>{[customer?.company_name, customer?.phone, customer?.email].filter(Boolean).join(' · ') || 'Chưa có thông tin liên hệ'}</span>
                {customer?.status ? (
                  <span className={`crm-customer-status-badge ${STATUS_BADGE_CLASS[customer.status] || ''}`}>
                    {STATUS_LABEL[customer.status] || customer.status}
                  </span>
                ) : null}
              </div>
              {error ? <p className="crm-error">{error}</p> : null}
            </div>
          </div>
          <div className="crm-header-actions">
            {canEdit ? (
              <button type="button" className="crm-secondary-button" onClick={() => setEditOpen(true)}>
                Sửa khách hàng
              </button>
            ) : null}
            {canManageProject ? (
              <button type="button" className="crm-secondary-button" onClick={() => setProjectModal({ open: true, project: null })}>
                + Tạo dự án
              </button>
            ) : null}
            <Link href={dealLink} className="crm-secondary-button">
              + Tạo cơ hội
            </Link>
            <Link href={quoteLink} className="crm-primary-button">
              + Tạo báo giá
            </Link>
          </div>
        </div>

        <div className="crm-stat-grid">
          <div className="crm-stat-card"><p className="crm-stat-label">Dự án</p><p className="crm-stat-value">{projectsSummary?.projectCount || 0}</p></div>
          <div className="crm-stat-card"><p className="crm-stat-label">Quote Cases</p><p className="crm-stat-value">{projectsSummary?.quoteCaseCount ?? data?.kpi?.quote_count ?? 0}</p></div>
          <div className="crm-stat-card"><p className="crm-stat-label">Hợp đồng</p><p className="crm-stat-value">{data?.kpi?.contract_count || 0}</p></div>
          <div className="crm-stat-card"><p className="crm-stat-label">Giá đang quote</p><p className="crm-stat-value">{formatVND(projectsSummary?.currentQuoteValue || 0) || '0 đ'}</p></div>
        </div>

        {customer ? (
          <section className="crm-detail-info-grid">
            {customer.position ? <InfoItem label="Chức vụ" value={customer.position} /> : null}
            {customer.address ? <InfoItem label="Địa chỉ" value={customer.address} /> : null}
            {customer.city ? <InfoItem label="Thành phố" value={customer.city} /> : null}
            {customer.industry ? <InfoItem label="Lĩnh vực" value={customer.industry} /> : null}
            {customer.source ? <InfoItem label="Nguồn" value={customer.source} /> : null}
            {customer.zalo ? <InfoItem label="Zalo" value={customer.zalo} /> : null}
            {customer.facebook ? <InfoItem label="Facebook" value={customer.facebook} /> : null}
            {customer.telegram ? <InfoItem label="Telegram" value={customer.telegram} /> : null}
            {customer.website ? <InfoItem label="Website" value={customer.website} /> : null}
            {customer.tax_code ? <InfoItem label="Mã số thuế" value={customer.tax_code} /> : null}
            {customer.note ? <InfoItem label="Ghi chú" value={customer.note} full /> : null}
          </section>
        ) : null}

        {customer ? <CrmContactsPanel customerId={customer.id} canEdit={canEdit} /> : null}

        <section className="crm-content-section">
          <div className="crm-segment crm-customer-tabs">
            <button type="button" className={`crm-segment-button ${tab === 'projects' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('projects')}>
              Dự án ({projectsSummary?.projectCount || 0})
            </button>
            <button type="button" className={`crm-segment-button ${tab === 'deals' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('deals')}>
              Cơ hội ({data?.deals?.length || 0})
            </button>
            <button
              type="button"
              className={`crm-segment-button ${tab === 'quotes' ? 'crm-segment-button--active' : ''}`}
              onClick={() => { setTab('quotes'); setQuoteProjectFilter(null); }}
            >
              Báo giá ({allQuoteChains.length})
            </button>
            <button type="button" className={`crm-segment-button ${tab === 'contracts' ? 'crm-segment-button--active' : ''}`} onClick={() => setTab('contracts')}>
              Hợp đồng ({data?.contracts?.length || 0})
            </button>
          </div>

          {tab === 'projects' ? (
            <div className="crm-projects-tab">
              <div className="crm-projects-tab-head">
                <div>
                  <h3>Dự án của khách hàng</h3>
                  <p>Dự án là lớp quản lý giữa Khách hàng và Cơ hội/Báo giá.</p>
                </div>
                {canManageProject ? (
                  <button type="button" className="crm-primary-button" onClick={() => setProjectModal({ open: true, project: null })}>
                    <Plus className="crm-icon" /> Tạo dự án mới
                  </button>
                ) : null}
              </div>

              {projectsLoading ? (
                <div className="crm-loading"><Loader2 className="crm-spin-icon" /><span>Đang tải dự án...</span></div>
              ) : projectsError ? (
                <div className="crm-empty"><p>{projectsError}</p></div>
              ) : !projectsSummary || projectsSummary.projectCount === 0 ? (
                <div className="crm-empty">
                  <div>
                    <h3>Khách hàng này chưa có dự án nào.</h3>
                    {canManageProject ? (
                      <button type="button" className="crm-primary-button crm-empty-action" onClick={() => setProjectModal({ open: true, project: null })}>
                        Tạo dự án đầu tiên
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <div className="crm-stat-grid crm-projects-summary-grid">
                    <div className="crm-stat-card"><p className="crm-stat-label">Tổng dự án</p><p className="crm-stat-value">{projectsSummary.projectCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Đang hoạt động</p><p className="crm-stat-value">{projectsSummary.activeProjectCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Quote Cases</p><p className="crm-stat-value">{projectsSummary.quoteCaseCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Cơ hội CRM</p><p className="crm-stat-value">{projectsSummary.opportunityCount}</p></div>
                    <div className="crm-stat-card"><p className="crm-stat-label">Giá trị quote hiện tại</p><p className="crm-stat-value">{formatMoney(projectsSummary.currentQuoteValue)}</p></div>
                  </div>

                  <div className="crm-projects-grid">
                    {projectsSummary.projects.map(project => (
                      <div key={project.id} className="crm-project-card">
                        <div className="crm-project-card-head">
                          <div>
                            <span className="crm-project-code">{project.projectCode}</span>
                            <h4>{project.name}</h4>
                          </div>
                          <span className={`crm-project-status crm-project-status--${project.status}`}>{PROJECT_STATUS_LABELS[project.status] || project.status}</span>
                        </div>
                        <div className="crm-project-card-meta">
                          <span>Owner: {memberName(project.managerId)}</span>
                          <span>{project.opportunityCount} cơ hội</span>
                          <span>{project.quoteCaseCount} Quote Case · {project.versionCount} version</span>
                          <span>{project.processingCount} đang xử lý</span>
                          <span>Giá quote hiện tại: {formatMoney(project.currentQuoteValue)}</span>
                        </div>
                        <div className="crm-project-card-actions">
                          <button
                            type="button"
                            className="crm-secondary-button"
                            onClick={() => { setQuoteProjectFilter(project.id); setTab('quotes'); }}
                          >
                            Xem báo giá
                          </button>
                          <Link className="crm-secondary-button" href={`/all-platform/quote-center?openQuote=new&projectId=${project.id}&customerId=${customerId}`}>
                            Tạo báo giá
                          </Link>
                          <Link className="crm-secondary-button" href={`/all-platform/crm?openDeal=new&customerId=${customerId}&projectId=${project.id}`}>
                            Tạo cơ hội
                          </Link>
                          {canManageProject ? (
                            <button type="button" className="crm-secondary-button" onClick={() => setProjectModal({ open: true, project })}>
                              Sửa dự án
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === 'projects' ? null : (
          <div className="crm-table-card">
            <div className="crm-table-scroll">
              {tab === 'deals' ? (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th className="crm-th">Deal</th>
                      <th className="crm-th">Dự án</th>
                      <th className="crm-th">Giai đoạn</th>
                      <th className="crm-th crm-th--right">Giá trị</th>
                      <th className="crm-th">Cập nhật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={5} className="crm-empty-cell">Đang tải...</td></tr>
                    ) : data?.deals?.length ? (
                      data.deals.map(deal => (
                        <tr key={deal.id} className="crm-row">
                          <td className="crm-td">{deal.customer_name || deal.id}</td>
                          <td className="crm-td crm-muted">{projectLabel(deal.project_id)}</td>
                          <td className="crm-td">
                            {(() => {
                              const meta = getStageMeta((deal.deal_stage as DealStage) || 'new_lead');
                              return (
                                <span className={`crm-stage-badge ${meta.badgeClass}`}>{meta.label}</span>
                              );
                            })()}
                          </td>
                          <td className="crm-td crm-td--right crm-budget">{formatVND(Number(deal.estimated_budget || deal.lifetime_value || 0)) || '0 đ'}</td>
                          <td className="crm-td crm-muted">{deal.updated_at ? new Date(deal.updated_at).toLocaleDateString('vi-VN') : '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={5} className="crm-empty-cell">Chưa có deal liên quan.</td></tr>
                    )}
                  </tbody>
                </table>
              ) : null}

              {tab === 'quotes' ? (
                <>
                  {quoteProjectFilter ? (
                    <div className="crm-quote-filter-pill">
                      <span>Đang lọc theo dự án: {projectLabel(quoteProjectFilter)}</span>
                      <button type="button" className="crm-inline-link-btn" onClick={() => setQuoteProjectFilter(null)}>
                        Bỏ lọc — xem tất cả báo giá
                      </button>
                    </div>
                  ) : null}
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th className="crm-th">Báo giá / Version</th>
                        <th className="crm-th">Dự án</th>
                        <th className="crm-th">Cơ hội</th>
                        <th className="crm-th">Phase</th>
                        <th className="crm-th">Presale → Sale</th>
                        <th className="crm-th crm-th--right">Giá khách</th>
                        <th className="crm-th crm-th--right">Margin</th>
                        <th className="crm-th">SLA</th>
                        <th className="crm-th crm-th--right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={9} className="crm-empty-cell">Đang tải...</td></tr>
                      ) : quoteChains.length ? (
                        quoteChains.map(({ current, versionCount }) => {
                          const relatedDeal = data?.deals?.find(d => d.id === current.deal_id);
                          return (
                            <tr key={current.version_chain_id || current.id} className="crm-row">
                              <td className="crm-td">
                                {current.quote_number || current.id}
                                <div className="crm-row-sub">V{current.version_number || 1} · {versionCount} version</div>
                              </td>
                              <td className="crm-td crm-muted">{projectLabel(current.project_id)}</td>
                              <td className="crm-td crm-muted">{relatedDeal?.customer_name || (current.deal_id ? 'Đang tải…' : 'Chưa gắn cơ hội')}</td>
                              <td className="crm-td"><span className="crm-source-badge">{quoteChainPhaseLabel(current)}</span></td>
                              <td className="crm-td crm-muted">
                                {current.technical_owner_id ? memberName(current.technical_owner_id) : relatedDeal?.leader_name || 'Chưa gán'}
                                {' → '}
                                {current.quote_owner_id ? memberName(current.quote_owner_id) : relatedDeal?.sdr_name || 'Chưa gán'}
                              </td>
                              <td className="crm-td crm-td--right crm-budget">{formatVND(Number(current.total_amount || 0)) || '0 đ'}</td>
                              <td className="crm-td crm-td--right crm-muted" title="Chưa có dữ liệu giá vốn ở tab này">—</td>
                              <td className="crm-td crm-muted">{current.sla_due_at ? relativeTime(current.sla_due_at) : 'Chưa đặt SLA'}</td>
                              <td className="crm-td crm-td--right">
                                <button
                                  type="button"
                                  className="crm-row-action"
                                  disabled={quoteWorkspaceLoading}
                                  onClick={() => void viewQuoteInNewWorkspace(current)}
                                >
                                  Xem
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr><td colSpan={9} className="crm-empty-cell">{quoteProjectFilter ? 'Dự án này chưa có báo giá nào.' : 'Chưa có báo giá liên quan.'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </>
              ) : null}

              {tab === 'contracts' ? (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th className="crm-th">Số hợp đồng</th>
                      <th className="crm-th">Trạng thái</th>
                      <th className="crm-th crm-th--right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={3} className="crm-empty-cell">Đang tải...</td></tr>
                    ) : data?.contracts?.length ? (
                      data.contracts.map(contract => (
                        <tr key={contract.id} className="crm-row">
                          <td className="crm-td">{contract.contract_number || contract.id}</td>
                          <td className="crm-td"><span className="crm-source-badge">{contract.status || '-'}</span></td>
                          <td className="crm-td crm-td--right">
                            <Link className="crm-row-action" href={`/all-platform/contracts/${contract.id}`}>Xem</Link>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={3} className="crm-empty-cell">Chưa có hợp đồng liên quan.</td></tr>
                    )}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
          )}
        </section>
      </section>

      <CustomerFormModal
        open={editOpen}
        customer={customerRow}
        currentUser={user}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); setReloadTick(t => t + 1); }}
      />
      <ProjectFormModal
        open={projectModal.open}
        customerId={customerId}
        customerName={customer?.customer_name || 'Khách hàng chưa tên'}
        project={projectModal.project}
        onClose={() => setProjectModal({ open: false, project: null })}
        onSaved={() => { setProjectModal({ open: false, project: null }); setReloadTick(t => t + 1); }}
      />
      {quoteWorkspace ? (
        <QuoteWorkspaceModal
          quoteId={quoteWorkspace.quoteId}
          deals={quoteWorkspace.deal ? [quoteWorkspace.deal] : []}
          dealsById={new Map(quoteWorkspace.deal ? [[quoteWorkspace.deal.id, quoteWorkspace.deal]] : [])}
          agents={[]}
          user={user}
          onClose={() => setQuoteWorkspace(null)}
          onChanged={() => setReloadTick(t => t + 1)}
          onEditDraft={editQuote => setQuoteWorkspace({ quoteId: editQuote.id, deal: quoteWorkspace.deal })}
        />
      ) : null}
    </div>
  );
}

function InfoItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`crm-detail-info-item ${full ? 'crm-detail-info-item--full' : ''}`}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}
