"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  MapPin,
  MoreVertical,
  PauseCircle,
  Phone,
  Tag,
  UserCog,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getTeamTypeLabel } from "@/lib/teamTypes";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";
import type { ContractStatus, Customer, DealStage } from "@/services/customer-lead.service";
import {
  DEAL_STAGE_META,
  PAYMENT_STATUS_OPTIONS,
  PIPELINE_COLUMNS,
  SERVICE_PACKAGE_OPTIONS,
} from "@/services/customer-lead.service";
import { getCurrentStage, isPaymentOverdue, validateTransition } from "@/services/crm-pipeline.helpers";

interface Props {
  customers: Customer[];
  onRequestMove: (customer: Customer, to: DealStage) => void;
  onCardClick: (customer: Customer) => void;
  onEdit: (customer: Customer) => void;
  onChat: (customer: Customer) => void;
  onDelete: (id: string) => void;
  onNewCustomer: () => void;
  onResumeOnHold?: (customer: Customer) => void;
}

const PIPELINE_STAGES = PIPELINE_COLUMNS.filter((stage) => stage !== "on_hold");
const TERMINAL_STAGES: Array<"won" | "lost" | "on_hold"> = ["won", "lost", "on_hold"];

const CONTRACT_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  dang_xu_ly: {
    label: "Đang xử lý",
    className: "border-red-200 bg-red-50 text-red-600",
  },
  da_bao_gia: {
    label: "Đã báo giá",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  da_chot: {
    label: "Đã chốt",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  active: {
    label: "Đang hoạt động",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  completed: {
    label: "Đã hoàn thành",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  maintenance: {
    label: "Bảo trì / bảo hành",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
};

function formatVND(value: number | null | undefined) {
  if (!value) return null;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("vi-VN");
}

function getDaysSinceCreated(customer: Customer) {
  const base = customer.created_at || customer.stage_entered_at || customer.updated_at;
  if (!base) return customer.days_in_stage ?? 0;

  const createdAt = new Date(base);
  if (Number.isNaN(createdAt.getTime())) return customer.days_in_stage ?? 0;

  const diff = Date.now() - createdAt.getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function getPaymentStatusMeta(value: Customer["payment_status"] | null | undefined) {
  return PAYMENT_STATUS_OPTIONS.find((option) => option.value === value) ?? PAYMENT_STATUS_OPTIONS[0];
}

function getServicePackageText(value: string | null | undefined) {
  if (!value) return "";
  return SERVICE_PACKAGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getOwnerName(customer: Customer) {
  return customer.sdr_name || customer.leader_name || "Chưa phân công";
}

function getOwnerInitial(customer: Customer) {
  return getOwnerName(customer).charAt(0).toUpperCase() || "?";
}

function shouldShowBudget(customer: Customer) {
  return Number(customer.estimated_budget || customer.lifetime_value || 0) > 0;
}

function getVisibleDetails(customer: Customer) {
  return [
    customer.city && {
      key: "city",
      icon: MapPin,
      label: customer.city,
    },
    customer.industry && {
      key: "industry",
      icon: Building2,
      label: customer.industry,
    },
    customer.decision_maker && {
      key: "decision_maker",
      icon: UserCog,
      label: customer.decision_maker,
    },
  ].filter(Boolean) as Array<{ key: string; icon: typeof MapPin; label: string }>;
}

function getAssigneeLines(customer: Customer) {
  return [
    {
      key: "leader",
      label: `Leader: ${customer.leader_name || "Chưa phân công"}`,
    },
    {
      key: "handler",
      label: `Người xử lý: ${customer.sdr_name || customer.leader_name || "Chưa phân công"}`,
    },
  ];
}

function getContractLabel(customer: Customer) {
  return customer.last_attachment_name || null;
}

function getImportantDateLabel(customer: Customer, effectiveStage: DealStage) {
  if (effectiveStage === "won" && customer.contract_signed_at) return `Ngày chốt: ${formatDate(customer.contract_signed_at)}`;
  if (effectiveStage === "lost" && customer.updated_at) return `Ngày mất: ${formatDate(customer.updated_at)}`;
  if (customer.follow_up_date) return `Follow-up: ${formatDate(customer.follow_up_date)}`;
  if (customer.contract_signed_at) return `Ngày ký: ${formatDate(customer.contract_signed_at)}`;
  if (customer.warranty_expires_at) return `Bảo hành đến: ${formatDate(customer.warranty_expires_at)}`;
  if (customer.customer_since) return `Ngày thành khách hàng: ${formatDate(customer.customer_since)}`;
  return null;
}

function getNotePreview(customer: Customer, effectiveStage: DealStage) {
  if (customer.review_result && effectiveStage === "won") {
    const reviewLabel =
      customer.review_result === "Qualify"
        ? "Khách hàng đồng ý / chốt deal"
        : customer.review_result === "Disqualify"
          ? "Chưa đạt điều kiện chốt"
          : "Chưa xem xét";
    return `Review: ${reviewLabel}`;
  }

  if (customer.reject_reason) {
    return `Lý do thất bại: ${customer.reject_reason}`;
  }

  if (customer.care_note) {
    return `Ghi chú CSKH: ${customer.care_note}`;
  }

  if (customer.note) {
    return `Ghi chú: ${customer.note}`;
  }

  return null;
}

function getTerminalContractStatusLabel(stage: DealStage) {
  if (stage === "won") return "Đã chốt";
  if (stage === "lost") return "Không hoạt động";
  if (stage === "on_hold") return "Tạm giữ";
  return null;
}

function getContractStatusLabel(customer: Customer, effectiveStage: DealStage) {
  const terminalLabel = getTerminalContractStatusLabel(effectiveStage);
  if (terminalLabel) return terminalLabel;

  const value = customer.contract_status;
  if (!value) return null;
  return CONTRACT_STATUS_META[value]?.label ?? value;
}

function getContractStatusClass(customer: Customer, effectiveStage: DealStage) {
  if (effectiveStage === "won") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (effectiveStage === "lost") return "border-red-200 bg-red-50 text-red-600";
  if (effectiveStage === "on_hold") return "border-amber-200 bg-amber-50 text-amber-700";

  const value = customer.contract_status as ContractStatus | null | undefined;
  return value ? CONTRACT_STATUS_META[value]?.className ?? "border-slate-200 bg-slate-50 text-slate-600" : "border-slate-200 bg-slate-50 text-slate-600";
}

function getPaymentDueWarningLabel(customer: Customer) {
  const dueAt = formatDate(customer.payment_due_date);
  return dueAt ? `Tới hạn thanh toán: ${dueAt}` : "Cần xử lý thanh toán";
}

function DealCard({
  customer,
  onClick,
  onResume,
  terminal = false,
}: {
  customer: Customer;
  onClick: () => void;
  onResume?: () => void;
  terminal?: boolean;
}) {
  const stage = getCurrentStage(customer);
  const isUnpaid = customer.payment_status === "unpaid" || customer.payment_status === "partial";
  const isUnpaidTerminal = stage === "won" && isUnpaid;
  const effectiveStage = isUnpaidTerminal ? "contract_sent" : stage;
  
  const overdue = isPaymentOverdue(customer);
  const paymentMeta = getPaymentStatusMeta(customer.payment_status);
  let paymentBadgeClass = paymentMeta.badgeClass;
  if (isUnpaid && overdue) {
    paymentBadgeClass = "bg-amber-100 text-amber-700 border-amber-200";
  }
  const visibleDetails = getVisibleDetails(customer);
  const assignees = getAssigneeLines(customer);
  const contractLabel = getContractLabel(customer);
  const importantDate = getImportantDateLabel(customer, effectiveStage);
  const contractStatus = getContractStatusLabel(customer, effectiveStage);
  const notePreview = getNotePreview(customer, effectiveStage);
  const budget = Number(customer.estimated_budget || customer.lifetime_value || 0);
  const showBudget = shouldShowBudget(customer);
  const servicePackage = getServicePackageText(customer.service_package);
  const daysInStage = customer.days_in_stage ?? getDaysSinceCreated(customer);

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/customer-id", customer.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      className={cn(
        "group relative flex cursor-grab flex-col overflow-hidden rounded-xl border border-slate-200 p-3 text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing",
        terminal ? "w-[280px]" : "w-full",
        isUnpaidTerminal ? "bg-amber-100 border-amber-300" : "bg-white",
        overdue && !isUnpaidTerminal && "border-amber-200 shadow-[0_4px_12px_rgba(245,158,11,0.16)]",
      )}
    >
      {customer.team_type ? (
        <div className="crm-team-ribbon" title={customer.team_name ? `Team: ${customer.team_name}` : undefined}>
          {getTeamTypeLabel(customer.team_type)}
        </div>
      ) : null}

      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-slate-900" title={customer.customer_name}>
            {customer.customer_name || "Chưa có tên"}
          </h4>
          <p className="truncate text-xs text-slate-500" title={customer.company_name || undefined}>
            {customer.company_name || "Chưa có công ty"}
          </p>
        </div>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
        >
          <MoreVertical className="size-4" />
        </button>
      </div>

      {servicePackage && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
          <Tag className="size-3.5 shrink-0" />
          <span className="truncate">{servicePackage}</span>
        </div>
      )}

      {overdue && (
        <div
          className="mb-2 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
          title={getPaymentDueWarningLabel(customer)}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">{getPaymentDueWarningLabel(customer)}</span>
        </div>
      )}

      <div className="space-y-1 text-[11px] text-slate-600">
        {customer.phone && (
          <div className="flex items-center gap-2 truncate">
            <Phone className="size-3.5 shrink-0 text-slate-500" />
            <span className="truncate">{customer.phone}</span>
          </div>
        )}
        {customer.email && (
          <div className="flex items-center gap-2 truncate">
            <Mail className="size-3.5 shrink-0 text-slate-500" />
            <span className="truncate">{customer.email}</span>
          </div>
        )}
        {visibleDetails.map((detail) => {
          const Icon = detail.icon;
          return (
            <div key={detail.key} className="flex items-center gap-2 truncate" title={detail.label}>
              <Icon className="size-3.5 shrink-0 text-slate-500" />
              <span className="truncate">{detail.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 space-y-1.5">
        {assignees.map((assignee) => (
          <div
            key={assignee.key}
            className="flex items-start gap-1.5 rounded-xl bg-violet-50 px-1.5 py-1 text-[10px] font-bold text-violet-700"
            title={assignee.label}
          >
            <UserCog className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-normal break-words leading-tight">{assignee.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 space-y-1.5">
        {contractLabel && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (customer.last_attachment_url) {
                window.open(customer.last_attachment_url, "_blank");
              } else {
                toast.error("Chưa có link đính kèm cho hợp đồng/báo giá này");
              }
            }}
            className="flex cursor-pointer transition-colors hover:bg-slate-100 hover:border-slate-300 items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] text-slate-600"
            title={contractLabel}
          >
            <FileText className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
            <span className="whitespace-normal break-words leading-tight">HĐ/BG: {contractLabel}</span>
          </div>
        )}

        {contractStatus && (
          <div
            className={cn(
              "flex items-start gap-1.5 rounded-xl border px-1.5 py-1 text-[10px] font-bold",
              getContractStatusClass(customer, effectiveStage),
            )}
            title={`Tình trạng HĐ: ${contractStatus}`}
          >
            <FileText className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-normal break-words leading-tight">Tình trạng HĐ: {contractStatus}</span>
          </div>
        )}

        {customer.payment_status && customer.payment_status !== "paid" && (
          <div
            className={cn(
              "flex items-start gap-1.5 rounded-xl border px-1.5 py-1 text-[10px] font-bold",
              paymentBadgeClass,
            )}
            title={paymentMeta.label}
          >
            <Wallet className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-normal break-words leading-tight">
              {paymentMeta.label} {overdue ? "(Quá hạn)" : ""}
            </span>
          </div>
        )}

        {importantDate && (
          <div
            className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] text-slate-600"
            title={importantDate}
          >
            <CalendarDays className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
            <span className="whitespace-normal break-words leading-tight">{importantDate}</span>
          </div>
        )}

        {notePreview && (
          <div
            className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] text-slate-600"
            title={notePreview}
          >
            <FileText className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
            <span className="whitespace-normal break-words leading-tight">{notePreview}</span>
          </div>
        )}
      </div>

      {showBudget && (
        <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-2 py-1 text-emerald-700">
          <Wallet className="size-3.5 shrink-0" />
          <span className="truncate text-xs font-black">{formatVND(budget)}</span>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-emerald-600/80">
            Đã báo
          </span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="size-3.5 shrink-0" />
          <span>{daysInStage} ngày</span>
        </div>

        {stage === "on_hold" && onResume ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onResume();
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-amber-600"
          >
            <PauseCircle className="size-4" />
            Mở lại
          </button>
        ) : (
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[13px] font-black text-rose-700"
            title={getOwnerName(customer)}
          >
            {getOwnerInitial(customer)}
          </div>
        )}
      </div>
    </article>
  );
}

function StageColumn({
  stage,
  items,
  customerById,
  onDrop,
  onCardClick,
}: {
  stage: DealStage;
  items: Customer[];
  customerById: Map<string, Customer>;
  onDrop: (customer: Customer) => void;
  onCardClick: (customer: Customer) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const meta = DEAL_STAGE_META[stage];

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const id = event.dataTransfer.getData("text/customer-id");
        if (!id) return;

        const target = customerById.get(id);
        if (!target) return;

        const fromStage = getCurrentStage(target);
        if (fromStage === stage) return;

        const validation = validateTransition(fromStage, stage, target);
        const hasMissingFields = Array.isArray(validation.missing) && validation.missing.length > 0;

        if (!validation.ok && !hasMissingFields) {
          toast.error(validation.reason || "Chuyển stage không hợp lệ");
          return;
        }

        onDrop(target);
      }}
      className={cn(
        "flex w-full flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition",
        dragOver && "border-primary/40 ring-2 ring-primary/20",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
          <h3 className="truncate text-xs font-bold uppercase tracking-wide text-slate-900">
            {meta.label}
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-bold text-slate-500">
          {items.length}
        </span>
      </div>

      <div className="flex min-h-[140px] flex-col gap-4">
        {items.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-[20px] border-2 border-dashed border-slate-200 px-6 text-center text-[14px] font-medium text-slate-400">
            Kéo deal vào đây
          </div>
        ) : (
          items.map((customer) => (
            <DealCard key={customer.id} customer={customer} onClick={() => onCardClick(customer)} />
          ))
        )}
      </div>
    </div>
  );
}

function TerminalDropzone({
  stage,
  count,
  totalValue,
  onDrop,
}: {
  stage: "won" | "lost" | "on_hold";
  count: number;
  totalValue: number;
  onDrop: (customer: Customer) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const palette = {
    won: {
      icon: CheckCircle2,
      title: "Deal đã thắng",
      helper: "Kéo deal đã chốt vào đây để ghi nhận doanh thu.",
      className: "border-emerald-500 bg-emerald-50 text-emerald-700",
      iconClassName: "bg-emerald-600",
    },
    lost: {
      icon: XCircle,
      title: "Deal đã mất",
      helper: "Kéo deal đã mất vào đây để archive.",
      className: "border-red-400 bg-red-50 text-red-600",
      iconClassName: "bg-red-500",
    },
    on_hold: {
      icon: PauseCircle,
      title: "Deal tạm giữ",
      helper: "Kéo deal đang tạm dừng vào đây.",
      className: "border-amber-400 bg-amber-50 text-amber-700",
      iconClassName: "bg-amber-500",
    },
  }[stage];

  const Icon = palette.icon;

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const id = event.dataTransfer.getData("text/customer-id");
        if (!id) return;
        onDrop({ id } as Customer);
      }}
      className={cn(
        "flex min-h-[140px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-4 text-center transition",
        palette.className,
        dragOver && "scale-[1.01] shadow-md",
      )}
    >
      <div className={cn("mb-3 flex size-12 items-center justify-center rounded-full text-white shadow-sm", palette.iconClassName)}>
        <Icon className="size-6" />
      </div>
      <h3 className="text-lg font-bold">{palette.title}</h3>
      <p className="mt-1 max-w-[200px] text-xs text-slate-600">{palette.helper}</p>
      <strong className="mt-3 text-base font-bold">
        {count} deal
        {totalValue > 0 ? ` · ${formatVND(totalValue)}` : ""}
      </strong>
    </div>
  );
}

function TerminalRow({
  stage,
  items,
  onCardClick,
  onResume,
}: {
  stage: "won" | "lost" | "on_hold";
  items: Customer[];
  onCardClick: (customer: Customer) => void;
  onResume?: (customer: Customer) => void;
}) {
  const palette = {
    won: {
      title: "Deal đã thắng",
      color: "bg-emerald-500",
    },
    lost: {
      title: "Deal đã mất",
      color: "bg-red-500",
    },
    on_hold: {
      title: "Deal tạm giữ",
      color: "bg-amber-500",
    },
  }[stage];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={cn("size-3 rounded-full", palette.color)} />
        <h4 className="text-[16px] font-black uppercase tracking-wide text-slate-900">{palette.title}</h4>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-bold text-slate-500">
          {items.length}
        </span>
      </div>

      <div className="overflow-x-auto pb-3">
        {items.length === 0 ? (
          <div className="flex min-h-[96px] items-center justify-center rounded-[24px] border-2 border-dashed border-slate-200 px-6 text-center text-[15px] font-medium text-slate-400">
            Chưa có deal ở trạng thái này
          </div>
        ) : (
          <div className="flex min-w-max gap-4">
            {items.map((customer) => (
              <DealCard
                key={customer.id}
                customer={customer}
                terminal
                onClick={() => onCardClick(customer)}
                onResume={stage === "on_hold" && onResume ? () => onResume(customer) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CrmKanbanBoard({
  customers,
  onRequestMove,
  onCardClick,
  onEdit,
  onChat,
  onDelete,
  onNewCustomer,
  onResumeOnHold,
}: Props) {
  void onEdit;
  void onChat;
  void onDelete;
  void onNewCustomer;

  const grouped = useMemo(() => {
    const groups: Record<DealStage, Customer[]> = {
      new_lead: [],
      contacted: [],
      qualified: [],
      requirement: [],
      proposal_sent: [],
      negotiation: [],
      contract_sent: [],
      on_hold: [],
      won: [],
      lost: [],
    };

    customers.forEach((customer) => {
      let stage = getCurrentStage(customer);
      const isUnpaid = customer.payment_status === "unpaid" || customer.payment_status === "partial";
      if (stage === "won" && isUnpaid) {
        stage = "contract_sent";
      }
      groups[stage].push(customer);
    });

    return groups;
  }, [customers]);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach((customer) => map.set(customer.id, customer));
    return map;
  }, [customers]);

  const terminalStats = useMemo(
    () => ({
      won: {
        count: grouped.won.length,
        value: grouped.won.reduce((sum, customer) => sum + Number(customer.estimated_budget || customer.lifetime_value || 0), 0),
      },
      lost: {
        count: grouped.lost.length,
        value: 0,
      },
      on_hold: {
        count: grouped.on_hold.length,
        value: 0,
      },
    }),
    [grouped],
  );

  useDragAutoScroll<HTMLDivElement>({
    scrollOn: "window",
    edge: 96,
    maxSpeed: 14,
  });

  function handleTerminalDrop(stage: "won" | "lost" | "on_hold", maybeCustomer: Customer) {
    const customer = customerById.get(maybeCustomer.id);
    if (!customer) return;

    const fromStage = getCurrentStage(customer);
    if (fromStage === stage) return;

    const validation = validateTransition(fromStage, stage, customer);
    const hasMissingFields = Array.isArray(validation.missing) && validation.missing.length > 0;

    if (!validation.ok && !hasMissingFields) {
      toast.error(validation.reason || "Chuyển stage không hợp lệ");
      return;
    }

    onRequestMove(customer, stage);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-[24px] font-black tracking-tight text-slate-900">Pipeline bán hàng</h2>
          <p className="mt-1 text-sm text-slate-600">
            Kéo thả deal qua từng stage. Các stage cuối nằm riêng bên dưới.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {PIPELINE_STAGES.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              items={grouped[stage]}
              customerById={customerById}
              onDrop={(customer) => onRequestMove(customer, stage)}
              onCardClick={onCardClick}
            />
          ))}
        </div>
      </section>

      <div className="flex items-center gap-6">
        <div className="h-px flex-1 bg-slate-300" />
        <span className="px-2 text-[12px] font-black uppercase tracking-[0.28em] text-slate-400">
          Trạng thái cuối
        </span>
        <div className="h-px flex-1 bg-slate-300" />
      </div>

      <section className="space-y-6">
        <div>
          <h2 className="text-[24px] font-black tracking-tight text-slate-900">Kết quả cuối cùng</h2>
          <p className="mt-1 text-sm text-slate-600">
            Kéo deal vào các trạng thái terminal để đóng vòng pipeline.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <TerminalDropzone
            stage="won"
            count={terminalStats.won.count}
            totalValue={terminalStats.won.value}
            onDrop={(customer) => handleTerminalDrop("won", customer)}
          />
          <TerminalDropzone
            stage="lost"
            count={terminalStats.lost.count}
            totalValue={terminalStats.lost.value}
            onDrop={(customer) => handleTerminalDrop("lost", customer)}
          />
          <TerminalDropzone
            stage="on_hold"
            count={terminalStats.on_hold.count}
            totalValue={terminalStats.on_hold.value}
            onDrop={(customer) => handleTerminalDrop("on_hold", customer)}
          />
        </div>

        <div className="space-y-8">
          {TERMINAL_STAGES.map((stage) => (
            <TerminalRow
              key={stage}
              stage={stage}
              items={grouped[stage]}
              onCardClick={onCardClick}
              onResume={stage === "on_hold" ? onResumeOnHold : undefined}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
