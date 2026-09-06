'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { ContractDetailModal } from './ContractDetailModal';
import { CrmKanbanBoard } from './CrmKanbanBoard';
import { CrmTableView } from './CrmTableView';
import { DealFormModal, clearDealDraft } from './DealFormModal';
import { DetailDrawer } from './DetailDrawer';
import { FileText, LayoutGrid, Loader2, Plus, RotateCcw, TableIcon, Trophy } from './icons';
import { StageModal } from './StageModal';
import { CreateQuoteModal } from '../integrations/quotes';
import {
  CITY_OPTIONS,
  DEAL_STAGE_META,
  DEAL_STAGES,
  INDUSTRY_OPTIONS,
  SOURCE_OPTIONS,
  canApproveQuote,
  formatVND,
  getContractUrl,
  humanizeCrmError,
} from '../constants/crmConfig';
import { useCrm } from '../hooks/useCrm';
import type { ContractStatus, CreateDealInput, Deal, DealStage, StageTransitionInput, UpdateDealInput } from '../types';
import { teamsService, type TeamRow } from '@/services/all-platform.service';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';
import { useAppAuth } from '@/contexts/AppAuthContext';

type FilterState = {
  search: string;
  source: string;
  city: string;
  industry: string;
  team: string;
};

export function CrmShell() {
  const {
    deals,
    agents,
    sourceOptions: dealFormSourceOptions,
    servicePackageOptions: dealFormServicePackageOptions,
    packageOptions: dealFormPackageOptions,
    industryOptions: dealFormIndustryOptions,
    loading,
    saving,
    error,
    stats,
    loadDeals,
    getDeal,
    createDeal,
    updateDeal,
    deleteDeal,
    moveDeal,
  } = useCrm();
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [filters, setFilters] = useState<FilterState>({ search: '', source: '', city: '', industry: '', team: '' });
  const [teams, setTeams] = useState<TeamRow[]>([]);

  // Dropdown lọc team — DB-driven (GET /teams), không hard-code.
  useEffect(() => {
    let alive = true;
    void teamsService.getAll().then(res => {
      if (alive && res.success && res.data) setTeams(res.data);
    });
    return () => { alive = false; };
  }, []);
  const [activeStageFilters, setActiveStageFilters] = useState<DealStage[]>([]);
  const [openFilter, setOpenFilter] = useState('');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [contractDeal, setContractDeal] = useState<Deal | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [quoteModal, setQuoteModal] = useState<{ open: boolean; deal: Deal | null; editQuote: Quote | null }>({ open: false, deal: null, editQuote: null });
  const { user } = useAppAuth();
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [stageData, setStageData] = useState<{ deal: Deal; toStage: DealStage } | null>(null);
  const [reviewData, setReviewData] = useState<{ deal: Deal; toStage: DealStage } | null>(null);
  const [toast, setToast] = useState('');
  // Bump sau moi lan tao phien ban moi de DetailDrawer biet fetch lai
  // "Lich su phien ban" - deal.quote.id (van la ban DA DUYET) khong doi khi
  // tao ban nhap moi nen khong the dung no lam dependency duy nhat.
  const [quoteVersionsRefreshKey, setQuoteVersionsRefreshKey] = useState(0);

  // Toast tự ẩn sau vài giây — không dùng window.alert() cho việc báo thành công
  // vì alert chặn thao tác tiếp theo, gây khó chịu cho hành động vốn đã ổn.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Khoá scroll của trang nền khi có modal/drawer nào đang mở — nếu không, cuộn
  // chuột bên trong popup (vd DetailDrawer) vẫn kéo theo cuộn cả trang phía sau.
  // createOpen/editingDeal (DealFormModal) tu khoa rieng qua useBodyScrollLock
  // trong chinh no roi - khong dua lai vao day, tranh 2 noi doc lap cung khoa
  // 1 tai nguyen (bug thuc te gap phai: body ket o overflow:hidden vinh vien
  // vi thu tu cleanup cua 2 effect rieng biet khong dong bo voi nhau).
  const anyOverlayOpen = detailOpen || Boolean(contractDeal) || quoteModal.open || Boolean(stageData) || Boolean(reviewData);
  useBodyScrollLock(anyOverlayOpen);

  const sourceOptions = useMemo(() => {
    const fromData = deals.map(deal => deal.sourcePlatform || 'Manual').filter(Boolean);
    const map = new Map(SOURCE_OPTIONS.map(option => [option.value, option]));
    fromData.forEach(value => {
      if (!map.has(value)) map.set(value, { value, label: value });
    });
    return [...map.values()];
  }, [deals]);

  const cityOptions = useMemo(() => [...new Set([...CITY_OPTIONS, ...deals.map(deal => deal.city || '').filter(Boolean)])], [deals]);
  const industryOptions = useMemo(() => [...new Set([...INDUSTRY_OPTIONS, ...deals.map(deal => deal.industry || '').filter(Boolean)])], [deals]);

  const filterDropdownOptions = {
    source: [{ value: '', label: 'Tất cả nguồn' }, ...sourceOptions],
    city: [{ value: '', label: 'Tất cả thành phố' }, ...cityOptions.map(city => ({ value: city, label: city }))],
    industry: [{ value: '', label: 'Tất cả lĩnh vực' }, ...industryOptions.map(industry => ({ value: industry, label: industry }))],
    team: [{ value: '', label: 'Tất cả team' }, ...teams.map(t => ({ value: t.id, label: t.name_team }))],
  };

  const filteredDeals = useMemo(() => {
    let list = [...deals];
    const q = filters.search.trim().toLowerCase();
    if (q) {
      list = list.filter(deal =>
        [deal.customerName, deal.companyName, deal.phone, deal.email, deal.sourcePlatform, deal.city, deal.industry]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(q))
      );
    }
    if (filters.source) list = list.filter(deal => deal.sourcePlatform === filters.source);
    if (filters.city) list = list.filter(deal => deal.city === filters.city);
    if (filters.industry) list = list.filter(deal => deal.industry === filters.industry);
    if (filters.team) list = list.filter(deal => deal.teamId === filters.team);
    if (activeStageFilters.length) list = list.filter(deal => activeStageFilters.includes(deal.stage));
    return list;
  }, [activeStageFilters, deals, filters]);

  const hasFilters = filters.search || filters.source || filters.city || filters.industry || filters.team || activeStageFilters.length;

  function filterLabel(key: 'source' | 'city' | 'industry' | 'team') {
    return filterDropdownOptions[key].find(option => option.value === filters[key])?.label || 'Tất cả';
  }

  function selectFilter(key: 'source' | 'city' | 'industry' | 'team', value: string) {
    setFilters(current => ({ ...current, [key]: value }));
    setOpenFilter('');
  }

  function toggleStageFilter(stage: DealStage) {
    setActiveStageFilters(current =>
      current.includes(stage) ? current.filter(item => item !== stage) : [...current, stage]
    );
  }

  async function openDetail(deal: Deal) {
    setSelectedDeal(deal);
    setDetailOpen(true);
    try {
      setSelectedDeal(await getDeal(deal.id));
    } catch {
      setSelectedDeal(deal);
    }
  }

  // Chỉ có id (chưa có object Deal đầy đủ) - dùng khi quay lại từ trang chi
  // tiết báo giá (?openDeal=<id>), không có sẵn Deal để hiện tạm như openDetail.
  async function openDetailById(id: string) {
    setDetailOpen(true);
    try {
      setSelectedDeal(await getDeal(id));
    } catch {
      setDetailOpen(false);
    }
  }

  // "Mở báo giá" (chưa duyệt) trong DetailDrawer điều hướng sang trang chi
  // tiết báo giá kèm ?dealId=... ; nút "Quay lại" ở đó đưa về đây kèm
  // ?openDeal=... để tự mở lại đúng drawer deal đang xem trước đó, thay vì về
  // board trống trơn. Xoá query khỏi URL ngay sau khi xử lý (router.replace,
  // không thêm history) để F5/back sau đó không mở lại lặp lại.
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialCustomer, setInitialCustomer] = useState<{ id: string; name: string; companyName?: string; phone?: string; email?: string } | null>(null);
  useEffect(() => {
    const openDealId = searchParams.get('openDeal');
    if (!openDealId) return;
    // "?openDeal=new&customerId=...": tới từ nút "+ Deal"/"+ Tạo deal mới" ở trang Hồ sơ
    // khách hàng — mở popup "Thêm deal nhanh" có sẵn, prefill khách hàng đã chọn, KHÔNG
    // dựng 1 form tạo-deal riêng cho luồng này.
    if (openDealId === 'new') {
      const customerId = searchParams.get('customerId');
      if (customerId) {
        setInitialCustomer({
          id: customerId,
          name: searchParams.get('customerName') || '',
          companyName: searchParams.get('companyName') || undefined,
          phone: searchParams.get('phone') || undefined,
          email: searchParams.get('email') || undefined,
        });
        setCreateOpen(true);
      }
    } else {
      void openDetailById(openDealId);
    }
    router.replace('/all-platform/crm', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleCreate(input: CreateDealInput) {
    try {
      const deal = await createDeal(input);
      clearDealDraft();
      setCreateOpen(false);
      setInitialCustomer(null);
      setSelectedDeal(deal);
      setDetailOpen(true);
      if (deal.customerProfileMessage) setToast(deal.customerProfileMessage);
    } catch (err) {
      window.alert(err instanceof Error ? humanizeCrmError(err.message) : 'Không tạo được deal. Vui lòng kiểm tra lại thông tin.');
    }
  }

  /** "Lưu & thêm tiếp" — tạo deal nhưng KHÔNG đóng modal/mở chi tiết như handleCreate, để
   * Sale nhập liên tiếp nhiều deal. Ném lỗi ngược lại cho DealFormModal xử lý (giữ nguyên
   * form đang nhập khi lỗi) thay vì tự alert rồi nuốt luôn ở đây. */
  async function handleCreateAndContinue(input: CreateDealInput) {
    const deal = await createDeal(input);
    if (deal.customerProfileMessage) setToast(deal.customerProfileMessage);
    void deal; // không cần mở chi tiết/chọn deal — chỉ tạo xong là xong, Sale tiếp tục nhập deal mới
  }

  async function handleUpdate(id: string, input: UpdateDealInput) {
    try {
      const deal = await updateDeal(id, input);
      setEditingDeal(null);
      setSelectedDeal(deal);
    } catch (err) {
      window.alert(err instanceof Error ? humanizeCrmError(err.message) : 'Không lưu được deal. Vui lòng kiểm tra lại thông tin.');
    }
  }

  async function handleDelete(deal: Deal) {
    if (!window.confirm(`Xóa deal "${deal.customerName}"?`)) return;
    try {
      await deleteDeal(deal.id);
      setDetailOpen(false);
      setSelectedDeal(null);
    } catch (err) {
      window.alert(err instanceof Error ? humanizeCrmError(err.message) : 'Không xóa được deal. Vui lòng thử lại.');
    }
  }

  async function handleMove(payload: StageTransitionInput) {
    if (!stageData) return;
    try {
      const transitionPayload: StageTransitionInput = {
        ...payload,
        attachmentUrl: payload.attachmentUrl || getContractUrl(stageData.deal) || undefined,
      };
      const isReviewUpdate =
        stageData.deal.stage === stageData.toStage && (stageData.toStage === 'won' || stageData.toStage === 'lost');
      const deal = isReviewUpdate
        ? await updateDeal(stageData.deal.id, {
            decisionMaker: transitionPayload.decisionMaker,
            estimatedBudget: transitionPayload.estimatedBudget,
            followUpDate: transitionPayload.followUpDate,
            outcome: {
              ...transitionPayload.outcome,
              reviewType: stageData.toStage as 'won' | 'lost',
              reviewedAt: new Date().toISOString(),
            },
          })
        : await moveDeal(stageData.deal.id, stageData.toStage, transitionPayload);
      const toStage = stageData.toStage;
      setStageData(null);
      // Đóng luôn drawer chi tiết — nó vẫn phủ kín màn hình phía sau StageModal,
      // để mở thì cuộn board bên dưới xong cũng không thấy được gì (đã bị che).
      setDetailOpen(false);
      setSelectedDeal(deal);
      setToast(`Đã chuyển "${deal.customerName}" sang "${DEAL_STAGE_META[toStage].label}".`);
      // Cuộn tới đúng cột/ô mà deal vừa "hạ cánh" trên board — cột pipeline bình
      // thường hay ô trạng thái cuối (Thắng/Thua/Tạm dừng) nằm tuốt dưới cùng
      // trang. Đợi 1 nhịp cho drawer/modal đóng animation + body scroll-lock gỡ
      // ra rồi mới cuộn, không thì scrollIntoView chạy giữa lúc overflow:hidden.
      window.setTimeout(() => {
        document
          .querySelector(`[data-crm-stage-column="${toStage}"], [data-crm-terminal-stage="${toStage}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    } catch (err) {
      window.alert(err instanceof Error ? humanizeCrmError(err.message) : 'Không chuyển được giai đoạn. Vui lòng kiểm tra lại thông tin.');
    }
  }

  async function updateContractStatus(deal: Deal, status: ContractStatus) {
    try {
      const updated = await updateDeal(deal.id, { contract: { status } });
      setSelectedDeal(updated);
    } catch (err) {
      window.alert(err instanceof Error ? humanizeCrmError(err.message) : 'Không lưu được trạng thái hợp đồng.');
    }
  }

  async function handleEditQuote(deal: Deal) {
    if (!deal.quote?.id) return;
    try {
      const quote = await seedingQuoteRepository.getQuote(deal.quote.id);
      setQuoteModal({ open: true, deal, editQuote: quote });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được báo giá để sửa.');
    }
  }

  async function handleOpenQuoteVersion(deal: Deal, quoteId: string) {
    try {
      const quote = await seedingQuoteRepository.getQuote(quoteId);
      setQuoteModal({ open: true, deal, editQuote: quote });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được phiên bản báo giá này.');
    }
  }

  async function handleCreateQuoteVersion(deal: Deal) {
    if (!deal.quote?.id) return;
    try {
      const result = await seedingQuoteRepository.createQuoteVersion(deal.quote.id);
      if (result.redirectedFromClickedQuote) {
        setToast(
          `Chuỗi báo giá đã có bản duyệt mới hơn (V${result.sourceVersionNumber}) — đã tạo phiên bản mới từ bản đó thay vì bản bạn chọn.`
        );
      } else if (!result.created) {
        setToast('Chuỗi này đã có bản nháp sẵn — mở bản nháp đó.');
      } else {
        setToast(`Đã tạo phiên bản mới V${result.quote.versionNumber}.`);
      }
      setQuoteVersionsRefreshKey(key => key + 1);
      setQuoteModal({ open: true, deal, editQuote: result.quote });
    } catch (err) {
      window.alert(err instanceof Error ? humanizeCrmError(err.message) : 'Không tạo được phiên bản báo giá mới.');
    }
  }

  async function handleDeleteQuote(deal: Deal) {
    if (!deal.quote?.id) return;
    if (!window.confirm(`Xoá báo giá ${deal.quote.number || ''} khỏi deal "${deal.customerName}"? Không thể hoàn tác.`)) return;
    try {
      await seedingQuoteRepository.deleteQuote(deal.quote.id);
      await refreshDealAfterQuoteChange(deal.id);
      setToast('Đã xoá báo giá.');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được báo giá.');
    }
  }

  // Sau khi tạo/sửa/duyệt báo giá: refresh cả list board (card ngoài kanban)
  // LẪN selectedDeal đang mở trong drawer (nếu trùng deal) - trước đây chỉ
  // loadDeals() nên drawer đang mở vẫn hiện dữ liệu cũ cho tới khi đóng/mở lại.
  async function refreshDealAfterQuoteChange(dealId?: string) {
    await loadDeals();
    if (dealId && selectedDeal?.id === dealId) {
      try {
        setSelectedDeal(await getDeal(dealId));
      } catch { /* giữ nguyên bản cũ neu load loi */ }
    }
  }

  return (
    <div className="crm-shell">
      <section className="crm-page-card">
        <div className="crm-header">
          <div>
            <p>Quản lý pipeline bán hàng theo 7 giai đoạn chính + 3 trạng thái cuối (Tạm dừng / Hoàn thành / Từ chối).</p>
            {error ? <p className="crm-error">{error}</p> : null}
          </div>
          <div className="crm-header-actions">
            <div className="crm-segment">
              <button type="button" className={`crm-segment-button ${viewMode === 'kanban' ? 'crm-segment-button--active' : ''}`} onClick={() => setViewMode('kanban')}>
                <LayoutGrid className="crm-button-icon" /> Kanban
              </button>
              <button type="button" className={`crm-segment-button ${viewMode === 'table' ? 'crm-segment-button--active' : ''}`} onClick={() => setViewMode('table')}>
                <TableIcon className="crm-button-icon" /> Bảng
              </button>
            </div>
            <button
              type="button"
              className="crm-secondary-button"
              disabled={loading || saving}
              onClick={() => setQuoteModal({ open: true, deal: null, editQuote: null })}
            >
              <FileText className="crm-button-icon" /> Tạo báo giá
            </button>
            <button type="button" className="crm-primary-button" disabled={loading || saving} onClick={() => setCreateOpen(true)}>
              <Plus className="crm-button-icon" /> Thêm deal
            </button>
          </div>
        </div>

        <div className="crm-stat-grid">
          <StatCard tone="total" label="Tổng deal" value={stats.totalDeals} />
          <StatCard tone="open" label="Đang mở" value={stats.openCount} />
          <StatCard tone="won" label={<><Trophy className="crm-inline-icon" /> Hoàn thành</>} value={stats.wonCount} />
          <StatCard tone="won-value" label="Giá trị hoàn thành" value={formatVND(stats.wonValue) || '0 đ'} />
        </div>

        <section className="crm-filter-card">
          <div className="crm-filter-grid">
            <input
              value={filters.search}
              onChange={event => setFilters(current => ({ ...current, search: event.target.value }))}
              type="text"
              className="crm-input"
              placeholder="Tìm tên, SĐT, email..."
              autoComplete="off"
            />
            {(['source', 'city', 'industry', 'team'] as const).map(key => (
              <div key={key} className="crm-filter-select">
                <button
                  type="button"
                  className={`crm-filter-select-button ${openFilter === key ? 'is-open' : ''}`}
                  onClick={() => setOpenFilter(openFilter === key ? '' : key)}
                >
                  <span>{filterLabel(key)}</span>
                </button>
                {openFilter === key ? (
                  <div className="crm-filter-select-menu">
                    {filterDropdownOptions[key].map(option => (
                      <button
                        key={`${key}-${option.value}`}
                        type="button"
                        className={`crm-filter-select-option ${filters[key] === option.value ? 'is-selected' : ''}`}
                        onClick={() => selectFilter(key, option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {hasFilters ? (
              <button
                type="button"
                className="crm-secondary-button crm-filter-reset"
                onClick={() => {
                  setFilters({ search: '', source: '', city: '', industry: '', team: '' });
                  setActiveStageFilters([]);
                }}
              >
                <RotateCcw className="crm-button-icon" /> Xóa lọc
              </button>
            ) : null}
          </div>

          <div className="crm-stage-filter">
            {DEAL_STAGES.map(stage => (
              <button
                key={stage}
                type="button"
                className={`crm-stage-pill ${activeStageFilters.includes(stage) ? DEAL_STAGE_META[stage].badgeClass : 'crm-stage-pill--idle'}`}
                onClick={() => toggleStageFilter(stage)}
              >
                {DEAL_STAGE_META[stage].label}
                <b>{stats.counts[stage] || 0}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="crm-content-section">
          {loading && !deals.length ? (
            <div className="crm-loading">
              <Loader2 className="crm-spin-icon" />
              <span>Đang tải...</span>
            </div>
          ) : !filteredDeals.length ? (
            <div className="crm-empty">
              <div>
                <h3>Chưa có khách hàng CRM</h3>
                <p>Tạo deal mới để bắt đầu quản lý pipeline.</p>
                <button type="button" className="crm-primary-button crm-empty-action" onClick={() => setCreateOpen(true)}>
                  <Plus className="crm-button-icon" /> Thêm deal
                </button>
              </div>
            </div>
          ) : viewMode === 'kanban' ? (
            <CrmKanbanBoard
              deals={filteredDeals}
              loading={loading}
              onCardClick={openDetail}
              onContractClick={setContractDeal}
              onCreateQuote={deal => setQuoteModal({ open: true, deal, editQuote: null })}
              onRequestMove={(deal, toStage) => setStageData({ deal, toStage })}
            />
          ) : (
            <CrmTableView deals={filteredDeals} onCardClick={openDetail} onContractClick={setContractDeal} onEdit={setEditingDeal} onDelete={handleDelete} />
          )}
        </section>
      </section>

      {toast ? <div className="crm-toast">{toast}</div> : null}

      <DetailDrawer
        deal={selectedDeal}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRequestTransition={(deal, toStage) => setStageData({ deal, toStage })}
        onViewReview={deal => setReviewData({ deal, toStage: deal.stage })}
        onEdit={setEditingDeal}
        onDelete={handleDelete}
        onUpdateContractStatus={updateContractStatus}
        onCreateQuote={deal => setQuoteModal({ open: true, deal, editQuote: null })}
        onEditQuote={handleEditQuote}
        onDeleteQuote={handleDeleteQuote}
        onCreateQuoteVersion={handleCreateQuoteVersion}
        onOpenQuoteVersion={handleOpenQuoteVersion}
        quoteVersionsRefreshKey={quoteVersionsRefreshKey}
      />
      <StageModal
        open={Boolean(stageData)}
        deal={stageData?.deal || null}
        toStage={stageData?.toStage || 'new_lead'}
        loading={saving}
        onClose={() => setStageData(null)}
        onSubmit={handleMove}
      />
      <StageModal
        open={Boolean(reviewData)}
        deal={reviewData?.deal || null}
        toStage={reviewData?.toStage || 'won'}
        readOnly
        onClose={() => setReviewData(null)}
        onSubmit={() => undefined}
      />
      <CreateQuoteModal
        open={quoteModal.open}
        deals={deals}
        agents={agents}
        initialDeal={quoteModal.deal}
        editQuote={quoteModal.editQuote}
        canApproveQuotes={canApproveQuote(user)}
        onClose={() => setQuoteModal({ open: false, deal: null, editQuote: null })}
        onCreated={async quote => {
          // Quote tạo xong đã gắn deal_id (nếu có) ở backend rồi, nhưng danh sách
          // deal trên board vẫn là bản cũ trong state — phải load lại thì card mới
          // thấy quote vừa tạo (deal.quote), không thì cứ tưởng chưa tạo được gì.
          await refreshDealAfterQuoteChange(quote.dealId);
          setToast(`Đã tạo báo giá ${quote.quoteNumber} — chưa duyệt.`);
        }}
        onUpdated={async quote => {
          await refreshDealAfterQuoteChange(quote.dealId);
          setToast(quote.status === 'approved' ? `Đã duyệt báo giá ${quote.quoteNumber}.` : `Đã cập nhật báo giá ${quote.quoteNumber}.`);
        }}
      />
      <DealFormModal
        open={createOpen || Boolean(editingDeal)}
        deal={editingDeal}
        loading={saving}
        agents={agents}
        sourceOptions={dealFormSourceOptions}
        servicePackageOptions={dealFormServicePackageOptions}
        packageOptions={dealFormPackageOptions}
        industryOptions={dealFormIndustryOptions}
        onClose={() => {
          setCreateOpen(false);
          setEditingDeal(null);
          setInitialCustomer(null);
        }}
        onCreate={handleCreate}
        onCreateAndContinue={handleCreateAndContinue}
        onUpdate={handleUpdate}
        currentUser={user}
        initialCustomer={initialCustomer}
      />
      <ContractDetailModal deal={contractDeal} open={Boolean(contractDeal)} onClose={() => setContractDeal(null)} />
    </div>
  );
}

function StatCard({ tone, label, value }: { tone: string; label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className={`crm-stat-card crm-stat-card--${tone}`}>
      <p className="crm-stat-label">{label}</p>
      <p className="crm-stat-value">{value}</p>
    </div>
  );
}
