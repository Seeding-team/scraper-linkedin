"use client";

/**
 * Trang CRM — /all-platform/crm
 *
 * Quy tắc vận hành (rút gọn từ tài liệu nghiệp vụ):
 *   1. Không cho nhảy cóc giữa các stage — mỗi stage chỉ sang 1 số stage nhất định
 *      theo state machine (xem `services/crm-pipeline.helpers.ts`).
 *   2. Mỗi lần đổi stage phải ghi log ai đổi, lúc nào, từ đâu sang đâu — server đã lo qua
 *      POST /customer-leads/{id}/transition.
 *   3. Một số stage bắt buộc có data đi kèm mới cho lưu (lost→lý do, qualified→NS+DM…).
 *   4. Won / Lost là TERMINAL — không drag đi đâu, hiển thị ở tab "Kết quả".
 *   5. On Hold cũng là "ngoài flow chính" — tab riêng "Tạm dừng".
 *
 * Tab CrmKanbanBoard (3 tab con):
 *   - Pipeline — 7 stage chính xếp dọc (mỗi stage = 1 row), KHÔNG scroll ngang.
 *   - Tạm dừng — grid deal đang On Hold.
 *   - Kết quả — Won + Lost tách riêng.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutGrid,
  Table as TableIcon,
  Trophy,
  Search,
  RotateCcw,
  Plus,
  Flag,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { CrmCustomerModal } from "@/components/all-platform/components/CrmCustomerModal";
import { QuickChatBox } from "./QuickChatBox";
import { StageTransitionModal } from "./StageTransitionModal";
import { DealDetailDrawer } from "./DealDetailDrawer";
import { CrmKanbanBoard } from "./CrmKanbanBoard";
import { CrmTableView } from "./CrmTableView";

import {
  customerLeadService,
  type Customer,
  type DealStage,
  type PaymentStatus,
  type SourcePlatform,
  DEAL_STAGE_META,
  PAYMENT_STATUS_OPTIONS,
} from "@/services/customer-lead.service";
import { getCurrentStage, isPaymentOverdue } from "@/services/crm-pipeline.helpers";
import { cn } from "@/lib/utils";
import { useCrmCategoryCodeOptions, useCrmCategoryLabels } from "@/modules/crm/components/CrmCategorySelect";

type ViewMode = "kanban" | "table";

interface FilterState {
  search: string;
  city: string;
  industry: string;
  source_platform: string;
  /** Lọc theo 1 stage cụ thể (multi-select qua OR logic). */
  stageFilter: Set<DealStage>;
  /** Lọc theo trạng thái thanh toán (multi-select qua OR logic). */
  paymentFilter: Set<PaymentStatus>;
  /** Chỉ hiện khách đã quá hạn thanh toán. */
  onlyOverdue: boolean;
}

const inputCls =
  "px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

// Toàn bộ stage có thể lọc (gồm cả 3 trạng thái cuối)
const STAGE_FILTER_OPTIONS: DealStage[] = [
  "new_lead", "contacted", "qualified", "requirement",
  "proposal_sent", "negotiation", "contract_sent",
  "on_hold", "won", "lost",
];

function FilterBar({
  filters,
  onChange,
  stageCounts,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  stageCounts: Record<string, number>;
}) {
  const set = <K extends keyof FilterState>(key: K, val: FilterState[K]) =>
    onChange({ ...filters, [key]: val });
  const toggleStage = (s: DealStage) => {
    const next = new Set(filters.stageFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    set("stageFilter", next);
  };
  const togglePayment = (s: PaymentStatus) => {
    const next = new Set(filters.paymentFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    set("paymentFilter", next);
  };
  const hasFilter =
    filters.search ||
    filters.city ||
    filters.industry ||
    filters.source_platform ||
    filters.stageFilter.size > 0 ||
    filters.paymentFilter.size > 0 ||
    filters.onlyOverdue;
  const { options: sourceOptions } = useCrmCategoryCodeOptions("crm_source");
  const { labels: cityOptions } = useCrmCategoryLabels("crm_city");
  const { options: industryOptions } = useCrmCategoryCodeOptions("crm_industry");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm tên, SĐT, email..."
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            className={cn(inputCls, "w-full pl-9")}
          />
        </div>
        <select
          value={filters.source_platform}
          onChange={(e) => set("source_platform", e.target.value)}
          className={inputCls}
        >
          <option value="">Tất cả nguồn</option>
          {sourceOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={filters.city}
          onChange={(e) => set("city", e.target.value)}
          className={cn(inputCls, "min-w-[150px]")}
        >
          <option value="">Tất cả thành phố</option>
          {cityOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={filters.industry}
          onChange={(e) => set("industry", e.target.value)}
          className={cn(inputCls, "min-w-[180px]")}
        >
          <option value="">Tất cả lĩnh vực</option>
          {industryOptions.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={() =>
              onChange({
                search: "",
                city: "",
                industry: "",
                source_platform: "",
                stageFilter: new Set(),
                paymentFilter: new Set(),
                onlyOverdue: false,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
          >
            <RotateCcw className="size-3.5" /> Xóa lọc
          </button>
        )}
      </div>

      {/* Stage filter pills — lọc theo từng stage riêng */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-slate-500">Stage:</span>
        {STAGE_FILTER_OPTIONS.map((s) => {
          const meta = DEAL_STAGE_META[s];
          const active = filters.stageFilter.has(s);
          const count = stageCounts[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => toggleStage(s)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                active
                  ? meta.badgeClass + " ring-2 ring-primary/30"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              {meta.label}
              <span className={cn("rounded-full px-1 text-[10px]", active ? "bg-white/40" : "bg-slate-100 text-slate-500")}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Payment filter pills — lọc nhanh khách còn nợ / quá hạn thanh toán */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-slate-500">Thanh toán:</span>
        {PAYMENT_STATUS_OPTIONS.map((opt) => {
          const active = filters.paymentFilter.has(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => togglePayment(opt.value)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                active
                  ? opt.badgeClass + " ring-2 ring-primary/30"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              {opt.label}
            </button>
          );
        })}
        <button
          onClick={() => onChange({ ...filters, onlyOverdue: !filters.onlyOverdue })}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
            filters.onlyOverdue
              ? "border-red-200 bg-red-100 text-red-700 ring-2 ring-primary/30"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
          )}
        >
          <AlertTriangle className="size-3" /> Chỉ khách quá hạn
        </button>
      </div>
    </div>
  );
}

export default function CrmCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("kanban");

  const [filters, setFilters] = useState<FilterState>({
    search: "",
    city: "",
    industry: "",
    source_platform: "",
    stageFilter: new Set(),
    paymentFilter: new Set(),
    onlyOverdue: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const [transitionTarget, setTransitionTarget] = useState<{
    customer: Customer;
    toStage: DealStage;
  } | null>(null);

  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [quickChat, setQuickChat] = useState<Customer | null>(null);

  // ─────────── Fetch (full list, không loại terminal — Kanban tab quản lý hiển thị) ───────────
  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customerLeadService.getAll({
        search: filters.search || undefined,
        city: filters.city || undefined,
        industry: filters.industry || undefined,
        source_platform: filters.source_platform || undefined,
        page: 1,
        page_size: 500,
      });
      setCustomers(res.items ?? []);
    } catch {
      toast.error("Lỗi khi tải danh sách khách hàng");
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.city, filters.industry, filters.source_platform]);

  const fetchStageCounts = useCallback(async () => {
    try {
      const counts = await customerLeadService.getStageCounts();
      setStageCounts(counts);
    } catch {
      /* fallback: tính từ customers */
    }
  }, []);

  useEffect(() => {
    void fetchCustomers();
    void fetchStageCounts();
  }, [fetchCustomers, fetchStageCounts]);

  // ─────────── Filter theo stageFilter + paymentFilter/onlyOverdue (client-side) ───────────
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (filters.stageFilter.size > 0 && !filters.stageFilter.has(getCurrentStage(c))) return false;
      if (filters.paymentFilter.size > 0 && !filters.paymentFilter.has(c.payment_status ?? "unpaid")) return false;
      if (filters.onlyOverdue && !isPaymentOverdue(c)) return false;
      return true;
    });
  }, [customers, filters.stageFilter, filters.paymentFilter, filters.onlyOverdue]);

  // ─────────── KPI stats (server-fetched, fallback local) ───────────
  const stats = useMemo(() => {
    const localCounts: Record<string, number> = {};
    let openCount = 0;
    let wonValue = 0;
    let owingCount = 0;
    let overdueCount = 0;
    for (const c of filteredCustomers) {
      const s = getCurrentStage(c);
      localCounts[s] = (localCounts[s] ?? 0) + 1;
      if (s !== "won" && s !== "lost") openCount++;
      if (s === "won") wonValue += c.estimated_budget ?? c.lifetime_value ?? 0;
      if ((c.payment_status ?? "unpaid") !== "paid") owingCount++;
      if (isPaymentOverdue(c)) overdueCount++;
    }
    return {
      openCount,
      wonValue,
      owingCount,
      overdueCount,
      counts: { ...stageCounts, ...localCounts },
    };
  }, [filteredCustomers, stageCounts]);

  // ─────────── Handlers ───────────

  const handleFilterChange = (f: FilterState) => setFilters(f);

  function openNewModal() {
    setEditingCustomer(null);
    setModalOpen(true);
  }

  function openEditModal(c: Customer) {
    setEditingCustomer(c);
    setModalOpen(true);
  }

  function handleSaved() {
    void fetchCustomers();
    void fetchStageCounts();
  }

  function handleDelete(id: string) {
    setDeleteId(id);
  }
  async function confirmDelete() {
    if (!deleteId) return;
    try {
      const res = await customerLeadService.delete(deleteId);
      if (res?.success) {
        toast.success("Đã xóa khách hàng");
        setDeleteId(null);
        void fetchCustomers();
        void fetchStageCounts();
      } else {
        toast.error(res?.message || "Xóa thất bại");
      }
    } catch {
      toast.error("Lỗi khi xóa");
    }
  }

  function openDetail(c: Customer) {
    setDetailCustomer(c);
  }

  function requestMove(c: Customer, to: DealStage) {
    const fromStage = getCurrentStage(c);
    if (fromStage === to) {
      openDetail(c);
      return;
    }
    setTransitionTarget({ customer: c, toStage: to });
  }

  async function performTransition(payload: any) {
    if (!transitionTarget) return;
    const { customer, toStage } = transitionTarget;
    // Optimistic update
    const prevList = customers;
    const optimistic: Customer = {
      ...customer,
      deal_stage: toStage,
      stage_entered_at: new Date().toISOString(),
      days_in_stage: 0,
      ...(payload.decision_maker ? { decision_maker: payload.decision_maker } : {}),
      ...(payload.estimated_budget ? { estimated_budget: payload.estimated_budget } : {}),
      ...(payload.follow_up_date ? { follow_up_date: payload.follow_up_date } : {}),
      ...(payload.reject_reason_type
        ? {
            reject_reason_type: payload.reject_reason_type,
            reject_reason: payload.reject_reason_text ?? customer.reject_reason,
          }
        : {}),
    };
    setCustomers((list) => list.map((c) => (c.id === customer.id ? optimistic : c)));
    setTransitionTarget(null);

    try {
      const res = await customerLeadService.transitionStage(customer.id, payload);
      if (!res?.success) {
        const missing: string[] = res?.data?.missing_fields ?? [];
        const errMsg =
          missing.length > 0
            ? `Thiếu: ${missing.join(", ")}`
            : res?.message || "Lỗi server";
        throw new Error(errMsg);
      }
      toast.success(`Đã chuyển sang "${DEAL_STAGE_META[toStage].label}"`);
      // Refresh để lấy audit log + count mới
      await fetchCustomers();
      await fetchStageCounts();
    } catch (err: any) {
      setCustomers(prevList);
      toast.error(err?.message || "Đổi stage thất bại");
    }
  }

  return (
    <div className="min-h-screen w-full min-w-0 bg-white">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            Quản lý pipeline bán hàng theo 7 stage chính + 3 trạng thái cuối (On Hold / Won / Lost).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-slate-200 p-0.5">
            <button
              onClick={() => setView("kanban")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
                view === "kanban" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800",
              )}
            >
              <LayoutGrid className="size-3.5" /> Kanban
            </button>
            <button
              onClick={() => setView("table")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
                view === "table" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800",
              )}
            >
              <TableIcon className="size-3.5" /> Bảng
            </button>
          </div>
          <button
            onClick={openNewModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition hover:bg-primary/90"
          >
            <Plus className="size-4" /> Thêm deal
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Tổng deal</div>
          <div className="mt-0.5 text-xl font-bold text-slate-800">{filteredCustomers.length}</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-blue-700">Đang mở</div>
          <div className="mt-0.5 text-xl font-bold text-blue-800">{stats.openCount}</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-green-700">
            <Trophy className="size-3" /> Won
          </div>
          <div className="mt-0.5 text-xl font-bold text-green-800">{stats.counts.won ?? 0}</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-amber-700">
            <Flag className="size-3" /> Giá trị Won
          </div>
          <div className="mt-0.5 text-xl font-bold text-amber-800">
            {new Intl.NumberFormat("vi-VN", {
              style: "currency",
              currency: "VND",
              maximumFractionDigits: 0,
            }).format(stats.wonValue)}
          </div>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-orange-700">Đang nợ</div>
          <div className="mt-0.5 text-xl font-bold text-orange-800">{stats.owingCount}</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-red-700">
            <AlertTriangle className="size-3" /> Quá hạn
          </div>
          <div className="mt-0.5 text-xl font-bold text-red-800">{stats.overdueCount}</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <FilterBar filters={filters} onChange={handleFilterChange} stageCounts={stats.counts} />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-16">
          <div className="size-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : view === "kanban" ? (
        <CrmKanbanBoard
          customers={filteredCustomers}
          onRequestMove={requestMove}
          onCardClick={openDetail}
          onEdit={openEditModal}
          onChat={(c) => setQuickChat(c)}
          onDelete={handleDelete}
          onNewCustomer={openNewModal}
          onResumeOnHold={(c) => {
            // Resume deal On Hold: mở modal có dropdown chọn stage đích.
            // Vì rule chỉ cho resume về prev_stage hoặc lost → modal tự filter
            // option trong dropdown (StageTransitionModal nhận allowStageSelect).
            const fallbackTo = (c.prev_stage as DealStage | null) ?? "lost";
            setTransitionTarget({ customer: c, toStage: fallbackTo });
          }}
        />
      ) : (
        <CrmTableView
          customers={filteredCustomers}
          onCardClick={openDetail}
          onEdit={openEditModal}
          onChat={(c) => setQuickChat(c)}
          onDelete={handleDelete}
        />
      )}

      {/* Add / Edit customer modal */}
      <CrmCustomerModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingCustomer(null);
        }}
        customer={editingCustomer}
        defaultSourcePlatform={"Manual" as SourcePlatform}
        onSuccess={handleSaved}
      />

      {/* Stage transition modal */}
      {transitionTarget && (
        <StageTransitionModal
          customer={transitionTarget.customer}
          toStage={transitionTarget.toStage}
          isOpen={!!transitionTarget}
          allowStageSelect={getCurrentStage(transitionTarget.customer) === "on_hold"}
          onClose={() => setTransitionTarget(null)}
          onSubmit={performTransition}
        />
      )}

      <DealDetailDrawer
        customer={detailCustomer}
        open={!!detailCustomer}
        onClose={() => setDetailCustomer(null)}
        onRequestTransition={(c, to) => setTransitionTarget({ customer: c, toStage: to })}
        onEditCustomer={(c) => {
          setDetailCustomer(null);
          openEditModal(c);
        }}
        onDeleteCustomer={(c) => {
          setDetailCustomer(null);
          handleDelete(c.id);
        }}
        onCustomerUpdated={(updated) => {
          // Cập nhật ngay trong list + drawer đang mở (đổi trạng thái hợp đồng
          // xong không cần đóng/mở lại), rồi refetch để đồng bộ đầy đủ với server.
          setDetailCustomer(updated);
          setCustomers((list) => list.map((c) => (c.id === updated.id ? updated : c)));
          void fetchCustomers();
        }}
      />

      {/* Quick chat */}
      {quickChat?.conv_id && (
        <QuickChatBox
          key={quickChat.conv_id}
          convId={quickChat.conv_id}
          customerName={quickChat.customer_name}
          onClose={() => setQuickChat(null)}
        />
      )}

      {/* Confirm delete */}
      {deleteId && (
        <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-[360px] rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-bold text-slate-800">Xác nhận xóa</h3>
            <p className="mb-5 text-sm text-slate-500">
              Xóa khách hàng? Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteId(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
