"use client";

/**
 * Tab bodies for the Deal Workspace (Dự án / Báo giá / Hợp đồng / Tài liệu),
 * used by DealDetailDrawer.tsx. Split out to keep that file's diff scoped.
 *
 * Canonical-resolution rules (Phase 2 plan):
 *  - Project: customer_leads.project_id → projectsService.get(id) directly
 *    (never list+search — that's only used for the "Đổi dự án" picker).
 *  - Quote: GET /quotes?deal_id= (canonical, all quotes for this deal).
 *  - Contract: GET /contracts?deal_id= (canonical, from Phase 1). Legacy
 *    customer_leads contract/attachment fields are a READ-ONLY labeled
 *    fallback shown only when this deal has zero canonical contracts —
 *    never a write target here.
 *  - Document: no canonical/listable document entity exists — this tab only
 *    filters the already-fetched activity log for attachment_url, no upload.
 */

import { useEffect, useState } from "react";
import { FileText, Loader2, Wallet, CalendarDays, FolderKanban, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { customerLeadService, type ActivityLogEntry, type Customer } from "@/services/customer-lead.service";
import { projectsService, type Project } from "@/services/all-platform.service";
import { seedingQuoteRepository } from "@/modules/quotes";
import type { Quote } from "@/modules/quotes";
import { seedingContractRepository } from "@/modules/contracts/repositories/SeedingContractRepository";
import type { Contract } from "@/modules/contracts";
import { contractStatusLabel } from "@/modules/contracts/constants/contractConfig";
import { ManualContractModal } from "@/modules/contracts/components/ManualContractModal";
import { RegisterExternalContractModal } from "./RegisterExternalContractModal";
import { CreateQuoteModal } from "@/modules/crm/integrations/quotes";
import { customerToCrmDeal } from "./dealToCrmDeal";
import { QuoteQuickViewDrawer } from "./QuoteQuickViewDrawer";
import { internalQuoteStatusClass, internalQuoteStatusLabel } from "@/modules/quotes/constants/quoteConfig";

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("vi-VN");
}

function formatVND(value?: number | null) {
  if (value == null) return null;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
}

/* ───────────────────────── Dự án ───────────────────────── */

export function ProjectTab({ customer, onCustomerUpdated }: { customer: Customer; onCustomerUpdated: (c: Customer) => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState<Project[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProject(null);
    setError("");
    if (!customer.project_id) return;
    setLoading(true);
    projectsService
      .get(customer.project_id)
      .then((res) => {
        if (res.success === false) throw new Error(res.message || "Không tải được dự án");
        setProject(res.data ?? null);
      })
      .catch((err) => setError(err?.message || "Không tải được dự án"))
      .finally(() => setLoading(false));
  }, [customer.project_id]);

  function openPicker() {
    if (!customer.customer_id) return;
    setPicking(true);
    setLoadingOptions(true);
    projectsService
      .list(customer.customer_id)
      .then((res) => setOptions(res.data ?? []))
      .catch(() => setOptions([]))
      .finally(() => setLoadingOptions(false));
  }

  async function linkProject(projectId: string) {
    setSaving(true);
    try {
      const res = await customerLeadService.update(customer.id, { project_id: projectId || null });
      if (res?.success === false) throw new Error(res?.message || "Cập nhật thất bại");
      toast.success(projectId ? "Đã gắn Dự án" : "Đã gỡ Dự án");
      onCustomerUpdated({ ...customer, project_id: projectId || null });
      setPicking(false);
    } catch (err: any) {
      toast.error(err?.message || "Không cập nhật được Dự án");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Dự án liên kết</h4>
        <button
          type="button"
          onClick={openPicker}
          disabled={!customer.customer_id}
          title={!customer.customer_id ? "Deal chưa liên kết Khách hàng CRM (crm_customers)" : undefined}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className="size-3" /> Đổi dự án
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" /> Đang tải…
        </div>
      ) : error ? (
        <p className="rounded-md bg-red-50 p-3 text-xs text-red-600">{error}</p>
      ) : project ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FolderKanban className="size-4 text-slate-400" /> {project.name}
          </div>
          <div className="mt-1 text-xs text-slate-500">Mã: {project.projectCode}</div>
          <div className="mt-1 text-xs text-slate-500">Trạng thái: {project.status}</div>
          {project.description && <p className="mt-2 whitespace-pre-line text-xs text-slate-600">{project.description}</p>}
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">Deal này chưa gắn Dự án nào.</p>
      )}

      {picking && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Chọn dự án của khách hàng này</div>
          {loadingOptions ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="size-3.5 animate-spin" /> Đang tải…
            </div>
          ) : (
            <div className="space-y-1">
              {customer.project_id && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => linkProject("")}
                  className="block w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
                >
                  Gỡ liên kết Dự án
                </button>
              )}
              {options.length === 0 ? (
                <p className="text-xs text-slate-500">Khách hàng này chưa có Dự án nào.</p>
              ) : (
                options.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={saving}
                    onClick={() => linkProject(p.id)}
                    className="block w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {p.name} <span className="text-slate-400">({p.projectCode})</span>
                  </button>
                ))
              )}
              <button type="button" onClick={() => setPicking(false)} className="mt-1 text-[11px] text-slate-400 hover:underline">
                Đóng
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── Báo giá ───────────────────────── */

function isQuoteEditable(quote: Quote): boolean {
  return quote.status === "draft";
}

export function QuoteTab({ customer }: { customer: Customer }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState<"create" | Quote | null>(null);
  const [quickView, setQuickView] = useState<Quote | null>(null);

  function refresh() {
    setLoading(true);
    seedingQuoteRepository
      .getQuotes({ dealId: customer.id })
      .then(setQuotes)
      .catch(() => setQuotes([]))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [customer.id]);

  const crmDeal = customerToCrmDeal(customer);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Báo giá của deal này</h4>
        <button
          type="button"
          onClick={() => setModalOpen("create")}
          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/20"
        >
          + Tạo báo giá
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" /> Đang tải…
        </div>
      ) : quotes.length === 0 ? (
        <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">Chưa có báo giá nào cho deal này.</p>
      ) : (
        <ul className="space-y-2">
          {quotes.map((q) => (
            <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{q.quoteNumber}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">V{q.versionNumber || 1}</span>
                    <span className={`quote-badge ${internalQuoteStatusClass(q.status)}`}>{internalQuoteStatusLabel(q.status)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">Cập nhật: {formatDate(q.updatedAt) || "—"}</div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-slate-700">{formatVND(q.totalAmount) || "—"}</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuickView(q)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Xem nhanh
                </button>
                {isQuoteEditable(q) ? (
                  <button
                    type="button"
                    onClick={() => setModalOpen(q)}
                    className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/20"
                  >
                    Chỉnh sửa
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {modalOpen && (
        <CreateQuoteModal
          open
          deals={[crmDeal]}
          initialDeal={modalOpen === "create" ? crmDeal : undefined}
          editQuote={modalOpen !== "create" ? (modalOpen as Quote) : undefined}
          onClose={() => setModalOpen(null)}
          onCreated={() => {
            setModalOpen(null);
            refresh();
          }}
          onUpdated={() => {
            setModalOpen(null);
            refresh();
          }}
        />
      )}

      <QuoteQuickViewDrawer
        quote={quickView}
        open={Boolean(quickView)}
        customerName={customer.customer_name || customer.company_name}
        dealName={customer.customer_name}
        onClose={() => setQuickView(null)}
        onEdit={(q) => {
          setQuickView(null);
          setModalOpen(q);
        }}
      />
    </section>
  );
}

/* ───────────────────────── Hợp đồng ───────────────────────── */

const LEGACY_CONTRACT_FIELDS: Array<keyof Customer> = [
  "contract_status",
  "payment_status",
  "payment_due_date",
  "contract_signed_at",
  "warranty_expires_at",
  "last_attachment_name",
];

function sourceBadge(source: Contract["source"]) {
  return source === "external" ? (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Bên ngoài</span>
  ) : (
    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Tạo trong CRM</span>
  );
}

export function ContractTab({ customer }: { customer: Customer }) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Contract | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  function refresh() {
    setLoading(true);
    seedingContractRepository
      .getContracts({ dealId: customer.id })
      .then(setContracts)
      .catch(() => setContracts([]))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [customer.id]);

  // Vấn đề 2 (2026-09): purchase/sale_contract_links là mảng — Boolean([]) luôn
  // true nên không đưa vào LEGACY_CONTRACT_FIELDS, check riêng bằng length.
  const hasLegacy =
    contracts.length === 0 &&
    (LEGACY_CONTRACT_FIELDS.some((f) => Boolean(customer[f])) ||
      (customer.purchase_contract_links ?? []).some((l) => l?.url) ||
      (customer.sale_contract_links ?? []).some((l) => l?.url));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Hợp đồng của deal</h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            + Tạo hợp đồng
          </button>
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            + Ghi nhận hợp đồng có sẵn
          </button>
        </div>
      </div>

      <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        Hợp đồng có thể được tạo trực tiếp trong CRM hoặc ghi nhận từ hợp đồng đã ký bên ngoài (file, link,...). Tất cả hợp đồng
        đều được quản lý tập trung và hiển thị thống nhất tại deal, khách hàng và danh sách hợp đồng.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" /> Đang tải…
        </div>
      ) : contracts.length > 0 ? (
        <ul className="space-y-2">
          {contracts.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <button type="button" onClick={() => setSelected(c)} className="block w-full text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{c.title}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {contractStatusLabel(c.status)}
                  </span>
                  {sourceBadge(c.source)}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{c.contractNumber}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-slate-500">
                  {c.signedAt ? <span>Ngày ký: {formatDate(c.signedAt)}</span> : null}
                  <span>Giá trị: {formatVND(c.contractValue) || "0 đ"}</span>
                  {c.endDate ? <span>Hiệu lực đến: {formatDate(c.endDate)}</span> : null}
                </div>
              </button>
              {c.fileUrl ? (
                <a
                  href={c.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FileText className="size-3" /> {c.source === "external" ? "Mở file/link" : "Mở file"}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !hasLegacy ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-center">
          <FileText className="mx-auto size-6 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Chưa có hợp đồng nào được ghi nhận trong CRM.</p>
          <p className="mt-0.5 text-xs text-slate-400">Bạn có thể tạo hợp đồng mới hoặc ghi nhận hợp đồng đã ký bên ngoài.</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              + Tạo hợp đồng
            </button>
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              + Ghi nhận hợp đồng có sẵn
            </button>
          </div>
        </div>
      ) : null}

      {/* "Thông tin hợp đồng cũ" — CHỈ hiện khi thật sự có dữ liệu legacy trên
          customer_leads.contract_* VÀ deal chưa có Contract canonical nào.
          Đây KHÔNG phải 1 Hợp đồng chưa chính thức - chỉ là dữ liệu tham
          khảo từ bản CRM trước, không ghi ngược giá trị nào vào các field cũ
          này từ đây. */}
      {hasLegacy && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-amber-900">Thông tin hợp đồng cũ</div>
              <p className="mt-0.5 text-xs text-amber-700">Dữ liệu được ghi nhận từ phiên bản CRM trước.</p>
            </div>
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              Liên kết với hợp đồng
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-600">Trạng thái (cũ)</div>
              <div className="mt-0.5 text-sm font-medium text-amber-900">{customer.contract_status || "—"}</div>
            </div>
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-600">Thanh toán (cũ)</div>
              <div className="mt-0.5 text-sm font-medium text-amber-900">{customer.payment_status || "—"}</div>
            </div>
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-600">Hạn thanh toán (cũ)</div>
              <div className="mt-0.5 text-sm font-medium text-amber-900">{formatDate(customer.payment_due_date) || "—"}</div>
            </div>
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-600">Ngày ký (cũ)</div>
              <div className="mt-0.5 text-sm font-medium text-amber-900">{formatDate(customer.contract_signed_at) || "—"}</div>
            </div>
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-600">Bảo hành đến (cũ)</div>
              <div className="mt-0.5 text-sm font-medium text-amber-900">{formatDate(customer.warranty_expires_at) || "—"}</div>
            </div>
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-600">Tệp/liên kết cũ</div>
              {customer.last_attachment_name ? (
                customer.last_attachment_url ? (
                  <a
                    href={customer.last_attachment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                  >
                    <FileText className="size-3" /> Xem file
                  </a>
                ) : (
                  <div className="mt-0.5 truncate text-sm font-medium text-amber-900">{customer.last_attachment_name}</div>
                )
              ) : (
                <div className="mt-0.5 text-sm font-medium text-amber-900">—</div>
              )}
            </div>
            {/* Vấn đề 2 (2026-09): hợp đồng/báo giá MUA (Phase 1) — có thể nhiều link. */}
            {(customer.purchase_contract_links ?? []).filter((l) => l?.url).length > 0 && (
              <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-600">Hợp đồng mua (Phase 1)</div>
                <div className="mt-0.5 space-y-0.5">
                  {(customer.purchase_contract_links ?? [])
                    .filter((l) => l?.url)
                    .map((l, i) => (
                      <a
                        key={i}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 truncate text-sm font-medium text-blue-700 hover:underline"
                      >
                        <FileText className="size-3 shrink-0" /> {l.name || l.url}
                      </a>
                    ))}
                </div>
              </div>
            )}
            {/* Vấn đề 2 (2026-09): hợp đồng/báo giá BÁN (Phase 2) — có thể nhiều link. */}
            {(customer.sale_contract_links ?? []).filter((l) => l?.url).length > 0 && (
              <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-600">Hợp đồng bán (Phase 2)</div>
                <div className="mt-0.5 space-y-0.5">
                  {(customer.sale_contract_links ?? [])
                    .filter((l) => l?.url)
                    .map((l, i) => (
                      <a
                        key={i}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 truncate text-sm font-medium text-blue-700 hover:underline"
                      >
                        <FileText className="size-3 shrink-0" /> {l.name || l.url}
                      </a>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Child detail panel — xem 1 hợp đồng canonical, KHÔNG phải modal riêng. */}
      {selected && (
        <div className="rounded-lg border border-primary/30 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">{selected.contractNumber}</div>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-400 hover:underline">
              Đóng
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <div className="text-[10px] uppercase text-slate-400">Trạng thái</div>
              <div className="font-medium text-slate-700">{contractStatusLabel(selected.status)}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <div className="text-[10px] uppercase text-slate-400">
                <Wallet className="mr-1 inline size-3" />
                Giá trị
              </div>
              <div className="font-medium text-slate-700">{formatVND(selected.contractValue) || "0 đ"}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <div className="text-[10px] uppercase text-slate-400">
                <CalendarDays className="mr-1 inline size-3" />
                Bắt đầu
              </div>
              <div className="font-medium text-slate-700">{formatDate(selected.startDate) || "—"}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <div className="text-[10px] uppercase text-slate-400">
                <CalendarDays className="mr-1 inline size-3" />
                Kết thúc
              </div>
              <div className="font-medium text-slate-700">{formatDate(selected.endDate) || "—"}</div>
            </div>
            {selected.paymentTerms && (
              <div className="col-span-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="text-[10px] uppercase text-slate-400">Điều khoản thanh toán</div>
                <div className="font-medium text-slate-700">{selected.paymentTerms}</div>
              </div>
            )}
            {selected.note && (
              <div className="col-span-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="text-[10px] uppercase text-slate-400">Ghi chú</div>
                <div className="font-medium text-slate-700">{selected.note}</div>
              </div>
            )}
          </div>
          <a
            href={`/all-platform/contracts/${selected.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <FileText className="size-3" /> Mở trang chi tiết đầy đủ
          </a>
        </div>
      )}

      <ManualContractModal
        open={createOpen}
        lockedDealId={customer.id}
        lockedDealLabel={customer.customer_name}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />

      <RegisterExternalContractModal
        open={registerOpen}
        deal={customer}
        onClose={() => setRegisterOpen(false)}
        onCreated={() => {
          setRegisterOpen(false);
          refresh();
        }}
      />
    </section>
  );
}

/* ───────────────────────── Tài liệu ───────────────────────── */

export function DocumentTab({ log }: { log: ActivityLogEntry[] }) {
  const attachments = log.filter((entry) => Boolean(entry.attachment_url));

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Tệp đính kèm từ hoạt động</h4>
      <p className="text-[11px] text-slate-400">
        Chỉ hiện các tệp đã đính kèm khi chuyển giai đoạn deal — chưa có kho tài liệu tổng hợp riêng.
      </p>
      {attachments.length === 0 ? (
        <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">Chưa có tệp đính kèm nào.</p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((entry) => (
            <li key={entry.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] text-slate-400">{new Date(entry.created_at).toLocaleString("vi-VN")}</div>
              <a href={entry.attachment_url || undefined} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-sm font-medium text-blue-700 hover:underline">
                <FileText className="mr-1 inline size-3.5" />
                {entry.attachment_name || entry.attachment_url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
