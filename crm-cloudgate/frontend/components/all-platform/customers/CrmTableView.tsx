"use client";

/**
 * CrmTableView — view dạng bảng cho CRM Pipeline, dùng các primitives từ
 * design system (Button, Card, Input) nếu có; ở đây dùng Tailwind class trực
 * tiếp cho gọn (match style Kanban/Page).
 *
 * Hỗ trợ: search nhanh trên 1 dòng + highlight row theo stage.
 * Click vào row → mở DealDetailDrawer.
 */

import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Customer, DealStage } from "@/services/customer-lead.service";
import { DEAL_STAGE_META, PAYMENT_STATUS_OPTIONS } from "@/services/customer-lead.service";
import { getCurrentStage, isPaymentOverdue } from "@/services/crm-pipeline.helpers";

interface ColumnDef<T> {
  key: keyof T | string;
  label: string;
  align?: "left" | "right" | "center";
  className?: string;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
}

function formatVND(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("vi-VN");
  } catch {
    return "—";
  }
}

interface Props {
  customers: Customer[];
  onCardClick: (c: Customer) => void;
  onEdit: (c: Customer) => void;
  onChat: (c: Customer) => void;
  onDelete: (id: string) => void;
}

export function CrmTableView({ customers, onCardClick, onEdit, onChat, onDelete }: Props) {
  const [sortKey, setSortKey] = useState<string>("stage_entered_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const columns: ColumnDef<Customer>[] = useMemo(
    () => [
      {
        key: "customer_name",
        label: "Khách hàng",
        sortable: true,
        render: (c) => (
          <div>
            <div className="font-semibold text-slate-800">{c.customer_name}</div>
            {c.company_name && <div className="text-xs text-slate-500">{c.company_name}</div>}
          </div>
        ),
      },
      {
        key: "phone",
        label: "Liên hệ",
        render: (c) => (
          <div className="text-xs">
            {c.phone && <div className="text-slate-700">{c.phone}</div>}
            {c.email && <div className="truncate text-slate-500">{c.email}</div>}
          </div>
        ),
      },
      {
        key: "source_platform",
        label: "Nguồn",
        sortable: true,
        render: (c) => (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {c.source_platform ?? "Manual"}
          </span>
        ),
      },
      {
        key: "deal_stage",
        label: "Stage",
        sortable: true,
        render: (c) => {
          const s = getCurrentStage(c);
          const m = DEAL_STAGE_META[s];
          return (
            <div>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${m.badgeClass}`}>
                {m.label}
              </span>
              {c.days_in_stage != null && (
                <div className="mt-0.5 text-[11px] text-slate-500">{c.days_in_stage}d tại stage</div>
              )}
            </div>
          );
        },
      },
      {
        key: "estimated_budget",
        label: "Ngân sách",
        align: "right",
        sortable: true,
        render: (c) => (
          <div className="font-semibold text-emerald-700">{formatVND(c.estimated_budget)}</div>
        ),
      },
      {
        key: "decision_maker",
        label: "Decision Maker",
        sortable: true,
        render: (c) => <span className="text-xs text-slate-700">{c.decision_maker ?? "—"}</span>,
      },
      {
        key: "follow_up_date",
        label: "Follow-up",
        sortable: true,
        render: (c) => (
          <span className="text-xs text-amber-700">{formatDate(c.follow_up_date)}</span>
        ),
      },
      {
        key: "payment_status",
        label: "Thanh toán",
        sortable: true,
        render: (c) => {
          const meta = PAYMENT_STATUS_OPTIONS.find((o) => o.value === c.payment_status) ?? PAYMENT_STATUS_OPTIONS[0];
          const overdue = isPaymentOverdue(c);
          return (
            <div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
                  overdue ? "border-red-200 bg-red-100 text-red-700" : meta.badgeClass,
                )}
              >
                {overdue ? "Quá hạn" : meta.label}
              </span>
              {c.payment_due_date && (
                <div className={cn("mt-0.5 text-[11px]", overdue ? "text-red-600" : "text-slate-500")}>
                  Hạn: {formatDate(c.payment_due_date)}
                </div>
              )}
            </div>
          );
        },
      },
      {
        key: "created_at",
        label: "Ngày tạo",
        sortable: true,
        render: (c) => <span className="text-xs text-slate-500">{formatDate(c.created_at)}</span>,
      },
      {
        key: "actions",
        label: "Thao tác",
        align: "right",
        render: (c) => (
          <div className="flex justify-end gap-1">
            {c.conv_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChat(c);
                }}
                className="rounded border border-blue-200 px-2 py-1 text-xs text-blue-600 transition hover:bg-blue-50"
              >
                Chat
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(c);
              }}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
            >
              Sửa
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 transition hover:bg-red-50"
            >
              Xóa
            </button>
          </div>
        ),
      },
    ],
    [onChat, onEdit, onDelete],
  );

  const sorted = useMemo(() => {
    const list = [...customers];
    list.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av > bv ? 1 : -1) : (bv > av ? 1 : -1);
    });
    return list;
  }, [customers, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {columns.map((col) => (
                <th
                  key={col.key as string}
                  onClick={() => col.sortable && toggleSort(col.key as string)}
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500",
                    col.align === "right" ? "text-right" : "text-left",
                    col.sortable && "cursor-pointer select-none hover:text-slate-800",
                    col.className,
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key ? (
                      sortDir === "asc" ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-500">
                  Chưa có deal nào
                </td>
              </tr>
            ) : (
              sorted.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onCardClick(c)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key as string}
                      className={cn("px-3 py-2.5", col.align === "right" ? "text-right" : "text-left")}
                    >
                      {col.render(c)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
