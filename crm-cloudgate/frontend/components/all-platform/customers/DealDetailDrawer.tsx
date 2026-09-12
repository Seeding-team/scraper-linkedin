"use client";

/**
 * DealDetailDrawer — Sheet bên phải, hiển thị chi tiết 1 deal + audit log.
 *
 * Tabs:
 *   1. Tổng quan — thông tin khách, stage hiện tại, các action nhanh
 *   2. Lịch sử (Audit Trail) — mọi lần đổi stage + ghi chú, format theo timeline
 *
 * Stage hiện tại hiển thị rõ ràng + badge cho biết transition nào là hợp lệ.
 * Won/Lost: ẩn nút "đổi stage", chỉ cho xem.
 */

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Phone,
  Mail,
  MapPin,
  Building2,
  Tag as TagIcon,
  Clock,
  CalendarDays,
  FileText,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Wallet,
  UserCog,
  MessageCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  customerLeadService,
  type ActivityLogEntry,
  type ContractStatus,
  type Customer,
  type DealStage,
  type PaymentStatus,
  type ReviewResult,
  DEAL_STAGE_META,
  LOST_REASON_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  REJECT_REASON_TYPE_OPTIONS,
  REVIEW_RESULT_OPTIONS,
  SERVICE_PACKAGE_OPTIONS,
  type RejectReasonType,
} from "@/services/customer-lead.service";
import {
  allowedNextStages,
  getCurrentStage,
  isPaymentOverdue,
  stageBadgeClass,
  stageLabel,
} from "@/services/crm-pipeline.helpers";
import { QuickChatBox } from "./QuickChatBox";
import { useCrmCategoryCodeOptions } from "@/modules/crm/components/CrmCategorySelect";

interface Props {
  customer: Customer | null;
  open: boolean;
  onClose: () => void;
  onRequestTransition: (c: Customer, to: DealStage) => void;
  onEditCustomer: (c: Customer) => void;
  onDeleteCustomer: (c: Customer) => void;
  /** Gọi lại sau khi sửa nhanh 1 field trong drawer (vd đổi trạng thái hợp đồng) — parent nên refetch list. */
  onCustomerUpdated?: (customer: Customer) => void;
}

const CONTRACT_STATUS_OPTIONS: { value: ContractStatus; label: string }[] = [
  { value: "dang_xu_ly", label: "Đang xử lý" },
  { value: "da_bao_gia", label: "Đã báo giá" },
  { value: "da_chot", label: "Đã chốt" },
  { value: "active", label: "Đang hoạt động" },
  { value: "completed", label: "Đã hoàn thành" },
  { value: "maintenance", label: "Bảo trì / bảo hành" },
];

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("vi-VN");
}

function formatVND(value?: number | null) {
  if (!value) return null;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function getServicePackageText(value?: string | null) {
  if (!value) return "";
  return SERVICE_PACKAGE_OPTIONS.find((option) => option.value === value)?.label || value;
}

function getTerminalContractStatus(stage: DealStage, currentLabel?: string | null) {
  if (stage === "won") return "Đã chốt";
  if (stage === "lost") return "Không hoạt động";
  return currentLabel || "Đang xử lý";
}

export function DealDetailDrawer({ customer, open, onClose, onRequestTransition, onEditCustomer, onDeleteCustomer, onCustomerUpdated }: Props) {
  const [log, setLog] = useState<ActivityLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [contractStatusDraft, setContractStatusDraft] = useState<ContractStatus>("dang_xu_ly");
  const [savingContractStatus, setSavingContractStatus] = useState(false);
  const [paymentStatusDraft, setPaymentStatusDraft] = useState<PaymentStatus>("unpaid");
  const [savingPaymentStatus, setSavingPaymentStatus] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<ReviewResult>("Chua_xem_xet");
  const [savingReview, setSavingReview] = useState(false);
  const { options: contractStatusOptions } = useCrmCategoryCodeOptions("crm_contract_status", CONTRACT_STATUS_OPTIONS);
  const { options: paymentStatusOptions } = useCrmCategoryCodeOptions("crm_payment_status", PAYMENT_STATUS_OPTIONS);
  const { options: lostReasonOptions } = useCrmCategoryCodeOptions("crm_lost_reason", LOST_REASON_OPTIONS);

  const stage = useMemo(() => (customer ? getCurrentStage(customer) : null), [customer]);
  const nextOptions = useMemo(() => (stage ? allowedNextStages(stage) : []), [stage]);
  const reviewButtonLabel = useMemo(() => (stage === "won" ? "Won Review" : "Lost Review"), [stage]);
  const reviewButtonClass = useMemo(
    () =>
      stage === "lost"
        ? "inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
        : "inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100",
    [stage],
  );

  useEffect(() => {
    if (!open || !customer) {
      setLog([]);
      return;
    }
    setLoadingLog(true);
    customerLeadService
      .getActivityLog(customer.id, { limit: 100 })
      .then((res) => setLog(res.items ?? []))
      .catch(() => setLog([]))
      .finally(() => setLoadingLog(false));
  }, [open, customer?.id]);

  // Đồng bộ dropdown với deal đang mở — customer đổi (chuyển sang deal khác)
  // hoặc load lại sau update thì phải nạp lại giá trị hiện tại.
  useEffect(() => {
    setContractStatusDraft(customer?.contract_status ?? "dang_xu_ly");
  }, [customer?.id, customer?.contract_status]);

  useEffect(() => {
    setPaymentStatusDraft(customer?.payment_status ?? "unpaid");
  }, [customer?.id, customer?.payment_status]);

  useEffect(() => {
    setReviewDraft(customer?.review_result ?? "Chua_xem_xet");
  }, [customer?.id, customer?.review_result]);

  async function handleContractStatusChange(next: ContractStatus) {
    if (!customer || next === customer.contract_status) {
      setContractStatusDraft(next);
      return;
    }
    const prev = contractStatusDraft;
    setContractStatusDraft(next);
    setSavingContractStatus(true);
    try {
      const res = await customerLeadService.update(customer.id, { contract_status: next });
      if (res?.success === false) throw new Error(res?.message || "Cập nhật thất bại");
      toast.success("Đã cập nhật trạng thái hợp đồng");
      onCustomerUpdated?.({ ...customer, contract_status: next });
    } catch (err: any) {
      setContractStatusDraft(prev);
      toast.error(err?.message || "Không cập nhật được trạng thái hợp đồng");
    } finally {
      setSavingContractStatus(false);
    }
  }

  async function handlePaymentStatusChange(next: PaymentStatus) {
    if (!customer || next === customer.payment_status) {
      setPaymentStatusDraft(next);
      return;
    }
    const prev = paymentStatusDraft;
    setPaymentStatusDraft(next);
    setSavingPaymentStatus(true);
    try {
      const res = await customerLeadService.update(customer.id, { payment_status: next });
      if (res?.success === false) throw new Error(res?.message || "Cập nhật thất bại");
      toast.success("Đã cập nhật trạng thái thanh toán");
      onCustomerUpdated?.({ ...customer, payment_status: next });
    } catch (err: any) {
      setPaymentStatusDraft(prev);
      toast.error(err?.message || "Không cập nhật được trạng thái thanh toán");
    } finally {
      setSavingPaymentStatus(false);
    }
  }

  async function handleSaveReview() {
    if (!customer) return;
    setSavingReview(true);
    try {
      const res = await customerLeadService.update(customer.id, { review_result: reviewDraft });
      if (res?.success === false) throw new Error(res?.message || "Cập nhật review thất bại");
      toast.success(`${reviewButtonLabel} đã được cập nhật`);
      onCustomerUpdated?.({ ...customer, review_result: reviewDraft });
      setReviewOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Không lưu được review");
    } finally {
      setSavingReview(false);
    }
  }

  if (!customer || !stage) return null;

  const isTerminal = stage === "won" || stage === "lost";
  const leadName = customer.leader_name || customer.sdr_name || null;
  const handlerName = customer.sdr_name || customer.leader_name || null;
  const servicePackageLabel = getServicePackageText(customer.service_package);
  const terminalContractStatus = getTerminalContractStatus(
    stage,
    contractStatusOptions.find((option) => option.value === contractStatusDraft)?.label || null,
  );
  const lostReasonLabel =
    customer.reject_reason_type
      ? lostReasonOptions.find((r) => r.value === customer.reject_reason_type)?.label ??
        customer.reject_reason_type
      : null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[99990] bg-black/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Drawer */}
      <aside
        className={`fixed right-0 top-0 z-[99991] flex h-screen w-full max-w-[42rem] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className={`flex items-start justify-between ${DEAL_STAGE_META[stage].headerClass} px-5 py-4 text-white`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs opacity-90">
              <span className="font-semibold uppercase tracking-wider">{stageLabel(stage)}</span>
              {customer.days_in_stage != null && (
                <span className="rounded-full bg-white/20 px-2 py-0.5">
                  {customer.days_in_stage} ngày ở stage
                </span>
              )}
            </div>
            <h2 className="mt-1 truncate text-lg font-bold">{customer.customer_name}</h2>
            {customer.company_name && (
              <div className="mt-0.5 truncate text-sm opacity-90">{customer.company_name}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Body — scroll */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {/* Contact block */}
          <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            {customer.phone && (
              <div className="flex items-center gap-2 text-slate-700">
                <Phone className="size-3.5 text-slate-400" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-2 text-slate-700">
                <Mail className="size-3.5 text-slate-400" />
                <span className="truncate">{customer.email}</span>
              </div>
            )}
            {customer.city && (
              <div className="flex items-center gap-2 text-slate-700">
                <MapPin className="size-3.5 text-slate-400" />
                <span>{customer.city}</span>
              </div>
            )}
            {customer.industry && (
              <div className="flex items-center gap-2 text-slate-700">
                <Building2 className="size-3.5 text-slate-400" />
                <span>{customer.industry}</span>
              </div>
            )}
            {(customer.tags ?? []).length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <TagIcon className="size-3.5 text-slate-400" />
                {(customer.tags ?? []).map((t) => (
                  <span key={t} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Pipeline history */}
          {isTerminal && (
            <section
              className={`flex items-start gap-2 rounded-md p-3 text-xs ${
                stage === "won"
                  ? "border border-green-200 bg-green-50 text-green-800"
                  : "border border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {stage === "won" ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              )}
              <div>
                <div className="font-semibold">
                  Deal {stage === "won" ? "đã thắng" : "đã thua"} — trạng thái kết thúc.
                </div>
                {lostReasonLabel && (
                  <div className="mt-0.5">
                    Lý do: <b>{lostReasonLabel}</b>
                    {customer.reject_reason && (
                      <span className="ml-1 text-slate-600">— {customer.reject_reason}</span>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Pipeline meta */}
          <section className="grid grid-cols-2 gap-2">
            {customer.decision_maker && (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                  <UserCog className="size-3" /> Decision Maker
                </div>
                <div className="mt-0.5 truncate font-medium text-slate-700">{customer.decision_maker}</div>
              </div>
            )}
            {customer.estimated_budget ? (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                  <Wallet className="size-3" /> Ngân sách
                </div>
                <div className="mt-0.5 font-semibold text-slate-700">
                  {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(
                    customer.estimated_budget,
                  )}
                </div>
              </div>
            ) : null}
            {customer.follow_up_date && (
              <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Clock className="mr-1 inline size-3" />
                Follow-up dự kiến: <b>{new Date(customer.follow_up_date).toLocaleDateString("vi-VN")}</b>
              </div>
            )}
            {leadName && (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                  <UserCog className="size-3" /> Người lead
                </div>
                <div className="mt-0.5 truncate font-medium text-slate-700">{leadName}</div>
              </div>
            )}
            {handlerName && (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                  <UserCog className="size-3" /> Người xử lý
                </div>
                <div className="mt-0.5 truncate font-medium text-slate-700">{handlerName}</div>
              </div>
            )}
            {isTerminal && (
              <div className="col-span-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                  <CheckCircle2 className="size-3" /> Kết quả review
                </div>
                <div className="mt-0.5 font-medium text-slate-700">
                  {REVIEW_RESULT_OPTIONS.find((item) => item.value === (customer.review_result ?? "Chua_xem_xet"))?.label ?? "Chưa xem xét"}
                </div>
              </div>
            )}
          </section>

          {/* Ghi chú hiện tại */}
          {(customer.service_package ||
            customer.lifetime_value ||
            customer.contract_status ||
            customer.contract_signed_at ||
            customer.warranty_expires_at ||
            customer.customer_since ||
            customer.last_care_at ||
            customer.last_attachment_name ||
            customer.care_note) && (
            <section className="space-y-2">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
                Hợp đồng & chăm sóc
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {servicePackageLabel && (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                      <TagIcon className="size-3" /> Gói dịch vụ
                    </div>
                    <div className="mt-0.5 truncate font-medium text-slate-700">{servicePackageLabel}</div>
                  </div>
                )}
                {customer.lifetime_value ? (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                      <Wallet className="size-3" /> Giá trị hợp đồng
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-700">{formatVND(customer.lifetime_value)}</div>
                  </div>
                ) : null}
                <div className="col-span-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                    <FileText className="size-3" /> Trạng thái hợp đồng
                    {!isTerminal && savingContractStatus && <Loader2 className="size-3 animate-spin text-slate-400" />}
                  </div>
                  {isTerminal ? (
                    <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-medium text-slate-700">
                      {terminalContractStatus}
                    </div>
                  ) : (
                    <select
                      value={contractStatusDraft}
                      disabled={savingContractStatus}
                      onChange={(e) => handleContractStatusChange(e.target.value as ContractStatus)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                    >
                      {contractStatusOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="col-span-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                    <Wallet className="size-3" /> Trạng thái thanh toán
                    {savingPaymentStatus && <Loader2 className="size-3 animate-spin text-slate-400" />}
                  </div>
                  <select
                    value={paymentStatusDraft}
                    disabled={savingPaymentStatus}
                    onChange={(e) => handlePaymentStatusChange(e.target.value as PaymentStatus)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                  >
                    {paymentStatusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {customer.payment_due_date && (
                  <div
                    className={`rounded-md border px-3 py-2 ${
                      isPaymentOverdue(customer)
                        ? "border-amber-200 bg-amber-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div
                      className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wider ${
                        isPaymentOverdue(customer) ? "text-amber-700" : "text-slate-500"
                      }`}
                    >
                      <CalendarDays className="size-3" />
                      {isPaymentOverdue(customer) ? "Đã quá hạn thanh toán" : "Hạn thanh toán"}
                    </div>
                    <div
                      className={`mt-0.5 font-medium ${
                        isPaymentOverdue(customer) ? "text-amber-800" : "text-slate-700"
                      }`}
                    >
                      {formatDate(customer.payment_due_date)}
                    </div>
                  </div>
                )}
                {customer.last_attachment_name && (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                      <FileText className="size-3" /> File hợp đồng / báo giá
                    </div>
                    {customer.last_attachment_url ? (
                      <a
                        href={customer.last_attachment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate font-medium text-blue-700 hover:underline"
                      >
                        {customer.last_attachment_name}
                      </a>
                    ) : (
                      <div className="mt-0.5 truncate font-medium text-slate-700">
                        {customer.last_attachment_name}
                      </div>
                    )}
                  </div>
                )}
                {customer.customer_since && (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                      <CalendarDays className="size-3" /> Ngày thành khách hàng
                    </div>
                    <div className="mt-0.5 font-medium text-slate-700">{formatDate(customer.customer_since)}</div>
                  </div>
                )}
                {customer.contract_signed_at && (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                      <CalendarDays className="size-3" /> Ngày ký
                    </div>
                    <div className="mt-0.5 font-medium text-slate-700">{formatDate(customer.contract_signed_at)}</div>
                  </div>
                )}
                {customer.warranty_expires_at && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-700">
                      <CalendarDays className="size-3" /> Hết hạn bảo hành
                    </div>
                    <div className="mt-0.5 font-medium text-amber-800">{formatDate(customer.warranty_expires_at)}</div>
                  </div>
                )}
                {customer.last_care_at && (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                      <Clock className="size-3" /> Chăm sóc gần nhất
                    </div>
                    <div className="mt-0.5 font-medium text-slate-700">{formatDate(customer.last_care_at)}</div>
                  </div>
                )}
              </div>
              {customer.care_note && (
                <p className="whitespace-pre-line rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  {customer.care_note}
                </p>
              )}
            </section>
          )}

          {customer.note && (
            <section>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
                Ghi chú
              </h4>
              <p className="whitespace-pre-line rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
                {customer.note}
              </p>
            </section>
          )}

          {/* Actions — chỉ hiện khi chưa terminal */}
          {!isTerminal && (
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Chuyển stage tiếp theo
              </h4>
              <div className="flex flex-wrap gap-2">
                {nextOptions.map((to) => {
                  const m = DEAL_STAGE_META[to];
                  return (
                    <button
                      key={to}
                      onClick={() => onRequestTransition(customer, to)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${m.badgeClass} hover:brightness-95`}
                    >
                      <ArrowRight className="size-3" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
              {stage === "on_hold" && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Deal này đang tạm dừng. Chỉ có thể chuyển sang Lost, hoặc{" "}
                  <button
                    onClick={() => customer.prev_stage && onRequestTransition(customer, customer.prev_stage)}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                    disabled={!customer.prev_stage}
                  >
                    resume về {customer.prev_stage ? DEAL_STAGE_META[customer.prev_stage].label : "stage trước"}
                  </button>
                  .
                </p>
              )}
            </section>
          )}

          {/* Stage history (audit trail) */}
          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              Lịch sử thay đổi stage
            </h4>
            {loadingLog ? (
              <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
                <Loader2 className="size-3.5 animate-spin" /> Đang tải…
              </div>
            ) : log.length === 0 ? (
              <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">Chưa có lịch sử.</p>
            ) : (
              <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
                {log.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span
                      className={`absolute -left-[1.41rem] top-1 size-2.5 rounded-full ring-4 ring-white ${
                        entry.to_stage ? stageBadgeClass(entry.to_stage).split(" ")[1]?.replace("text-", "bg-") : "bg-slate-400"
                      }`}
                    />
                    <div className="text-[11px] uppercase tracking-wider text-slate-400">
                      {new Date(entry.created_at).toLocaleString("vi-VN")}
                      {entry.actor ? ` • ${entry.actor}` : ""}
                    </div>
                    {entry.from_stage && entry.to_stage ? (
                      <div className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${stageBadgeClass(entry.from_stage)}`}>
                          {stageLabel(entry.from_stage)}
                        </span>
                        <ArrowRight className="size-3 text-slate-400" />
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${stageBadgeClass(entry.to_stage)}`}>
                          {stageLabel(entry.to_stage)}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-0.5 text-sm text-slate-700">{entry.action}</div>
                    )}
                    {entry.note && (
                      <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        {entry.note}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Footer — 3 nút chính: Chăm sóc nhanh / Sửa / Xóa, luôn hiển thị */}
        <footer className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <div className="flex gap-2">
            <button
              onClick={() => setChatOpen(true)}
              disabled={!customer.conv_id}
              title={customer.conv_id ? "Mở chat nhanh" : "Khách chưa có hội thoại"}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MessageCircle className="size-3.5" /> Chăm sóc nhanh
            </button>
            <button
              onClick={() => onEditCustomer(customer)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              <UserCog className="size-3.5" /> Sửa thông tin
            </button>
            {isTerminal && (
              <button
                onClick={() => onRequestTransition?.(customer, stage as DealStage)}
                className={reviewButtonClass}
              >
                <CheckCircle2 className="size-3.5" /> {reviewButtonLabel}
              </button>
            )}
            <button
              onClick={() => {
                if (confirm(`Xóa khách hàng "${customer.customer_name}"?\nHành động này không thể hoàn tác.`)) {
                  onDeleteCustomer(customer);
                  onClose();
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
            >
              <Trash2 className="size-3.5" /> Xóa
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
          >
            Đóng
          </button>
        </footer>
      </aside>

      {reviewOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/35 p-6 backdrop-blur-[1px]">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-slate-900">{reviewButtonLabel}</h3>
              <p className="mt-1 text-sm text-slate-500">Cập nhật đánh giá cho deal terminal này.</p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Kết quả review</span>
                <select
                  value={reviewDraft}
                  onChange={(e) => setReviewDraft(e.target.value as ReviewResult)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {REVIEW_RESULT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={savingReview}
                onClick={handleSaveReview}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {savingReview ? "Đang lưu..." : "Lưu review"}
              </button>
            </div>
          </div>
        </div>
      )}

      {chatOpen && customer.conv_id && (
        <QuickChatBox
          convId={customer.conv_id}
          customerName={customer.customer_name}
          onClose={() => setChatOpen(false)}
        />
      )}
    </>
  );
}

// re-export for callers
export { REJECT_REASON_TYPE_OPTIONS };
