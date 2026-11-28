"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  MessageSquare,
  Phone,
  Search,
  X,
} from "lucide-react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { slaAlertsService } from "@/services/slaAlertsService";
import {
  alert as uiAlert,
  btn,
  btnSize,
  card,
  input as uiInput,
  modal as uiModal,
  pill,
  select as uiSelect,
  table,
} from "@/components/all-platform/zalo/centralized-shared/zaloUi";
import { SlaBadgePill } from "./SlaBadgePill";
import {
  formatDateTimeVn,
  formatDurationVi,
  getChannelMeta,
  PRIMARY_SLA_CHANNELS,
  type SlaLiveState,
  type SlaTurn,
} from "@/types/sla-alerts";

export interface SlaTurnsQueueTabProps {
  startDate: string;
  endDate: string;
  channelFilter: string;
  initialStatusFilter?: string;
  refreshSignal: number;
  onMutated?: () => void;
}

const STATUS_TABS = [
  { id: "all", label: "Tất cả" },
  { id: "waiting", label: "Đang chờ" },
  { id: "waiting_breached", label: "Đang quá hạn" },
  { id: "breached", label: "Quá hạn" },
  { id: "met", label: "Đạt SLA" },
  { id: "dismissed", label: "Đã bỏ qua" },
] as const;

const DISMISS_QUICK_REASONS = [
  "Tin spam / quảng cáo",
  "Nhóm nội bộ / không phải khách",
  "Khách đã trao đổi qua điện thoại",
  "Tin hệ thống / tự động",
];

const PAGE_LIMIT = 50;

function fallbackOpenUrl(turn: SlaTurn): string {
  if (turn.open_url) return turn.open_url;
  const ch = (turn.channel || "").toLowerCase();
  if (ch === "zalo") {
    const qs = new URLSearchParams();
    if (turn.account_id) qs.set("account", turn.account_id);
    if (turn.conversation_id) qs.set("conversation", turn.conversation_id);
    return `/all-platform/zalo-inbox?${qs.toString()}`;
  }
  if (ch === "messenger" || ch === "facebook") return "/all-platform/messenger-inbox";
  if (ch === "telegram") return "/all-platform/telegram-chat";
  if (ch === "whatsapp") return "/all-platform/whatsapp-chat";
  return "/all-platform/omnichannel-inbox";
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? "").replace(/\r?\n/g, " ");
  if (/[",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function SlaTurnsQueueTab({
  startDate,
  endDate,
  channelFilter,
  initialStatusFilter = "all",
  refreshSignal,
  onMutated,
}: SlaTurnsQueueTabProps) {
  const { user } = useAppAuth();
  const userEmail = user?.email ?? null;
  const canDismiss = user?.role === "admin" || user?.role === "leader";

  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [localChannel, setLocalChannel] = useState<string>(channelFilter || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const [items, setItems] = useState<SlaTurn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fetchedAtMs, setFetchedAtMs] = useState<number>(() => Date.now());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Dismiss modal state
  const [dismissTarget, setDismissTarget] = useState<SlaTurn | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissing, setDismissing] = useState(false);

  const loadTurns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await slaAlertsService.listTurns(
        {
          status: statusFilter,
          channel: localChannel,
          start_date: startDate,
          end_date: endDate,
          limit: PAGE_LIMIT,
          offset,
        },
        userEmail,
      );
      if (res.success && res.data) {
        setItems(Array.isArray(res.data.items) ? res.data.items : []);
        setTotal(typeof res.data.total === "number" ? res.data.total : 0);
        setFetchedAtMs(Date.now());
      } else {
        setError(res.message || "Không tải được danh sách lượt hội thoại SLA.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải danh sách lượt SLA.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, localChannel, startDate, endDate, offset, userEmail]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void loadTurns();
    });
    return () => {
      alive = false;
    };
  }, [loadTurns, refreshSignal]);

  // Soft client tick every 5s for live waiting timers + auto server refresh every 15s when viewing waiting
  useEffect(() => {
    const tickTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 5_000);

    const pollTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (
        statusFilter === "waiting" ||
        statusFilter === "waiting_breached" ||
        statusFilter === "all"
      ) {
        void loadTurns();
      }
    }, 15_000);

    return () => {
      window.clearInterval(tickTimer);
      window.clearInterval(pollTimer);
    };
  }, [statusFilter, loadTurns]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) => {
      return (
        (t.customer_name || "").toLowerCase().includes(q) ||
        (t.customer_phone || "").toLowerCase().includes(q) ||
        (t.account_name || "").toLowerCase().includes(q) ||
        (t.responded_by_name || "").toLowerCase().includes(q) ||
        (t.responded_by_email || "").toLowerCase().includes(q) ||
        (t.first_msg_preview || "").toLowerCase().includes(q) ||
        (t.last_msg_preview || "").toLowerCase().includes(q) ||
        (t.conversation_id || "").toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  const computeLiveWait = useCallback(
    (turn: SlaTurn): { waitSeconds: number; liveState: SlaLiveState } => {
      const baseWait = turn.current_wait_business_seconds ?? 0;
      const elapsedSinceFetch = Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000));
      const waitSeconds = baseWait + elapsedSinceFetch;
      const target = Math.max(1, turn.target_seconds || 300);

      let liveState: SlaLiveState = turn.live_state || "ok";
      if (waitSeconds >= target) {
        liveState = "breached";
      } else if (waitSeconds >= target * 0.7 && liveState === "ok") {
        liveState = "warning";
      }
      return { waitSeconds, liveState };
    },
    [nowMs, fetchedAtMs],
  );

  const handleExportCsv = () => {
    const headers = [
      "Kênh",
      "Tài khoản",
      "Khách hàng",
      "SĐT",
      "Tin nhắn khách",
      "Số tin chưa trả lời",
      "Lúc khách nhắn",
      "Hạn SLA",
      "Lúc NV trả lời",
      "Nhân viên xử lý",
      "Thời gian phản hồi (giây LV)",
      "Mục tiêu SLA (giây)",
      "Trạng thái",
      "Lý do bỏ qua",
    ];

    const rows = filteredItems.map((t) => {
      const waitSec =
        t.status === "waiting"
          ? computeLiveWait(t).waitSeconds
          : (t.business_response_seconds ?? t.raw_response_seconds ?? "");
      return [
        getChannelMeta(t.channel).label,
        t.account_name || t.account_id,
        t.customer_name || t.conversation_id,
        t.customer_phone || "",
        t.last_msg_preview || t.first_msg_preview || "",
        t.unanswered_msg_count,
        formatDateTimeVn(t.customer_msg_at),
        formatDateTimeVn(t.deadline_at),
        formatDateTimeVn(t.staff_reply_at),
        t.responded_by_name || t.responded_by_email || "",
        waitSec,
        t.target_seconds,
        t.status,
        t.dismiss_reason || "",
      ]
        .map(escapeCsvCell)
        .join(",");
    });

    const csv = "\uFEFF" + [headers.map(escapeCsvCell).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sla-turns_${startDate}_${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleConfirmDismiss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dismissTarget) return;
    const reason = dismissReason.trim() || "Tin spam / không cần phản hồi";
    setDismissing(true);
    setError(null);
    try {
      const res = await slaAlertsService.dismissTurn(dismissTarget.id, reason, user?.email);
      if (res.success) {
        setNotice(`Đã bỏ qua lượt hỏi của "${dismissTarget.customer_name || dismissTarget.conversation_id}".`);
        setDismissTarget(null);
        setDismissReason("");
        await loadTurns();
        onMutated?.();
      } else {
        setError(res.message || "Không thể bỏ qua lượt SLA này.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi bỏ qua lượt SLA.");
    } finally {
      setDismissing(false);
    }
  };

  const pageFrom = total === 0 ? 0 : offset + 1;
  const pageTo = Math.min(total, offset + items.length);

  return (
    <div className="space-y-4">
      {notice && (
        <div className={uiAlert.success}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}
      {error && (
        <div className={uiAlert.error}>
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <div className={`${card} flex flex-wrap items-center justify-between gap-3 p-4 shadow-2xs`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((st) => {
            const active = statusFilter === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => {
                  setStatusFilter(st.id);
                  setOffset(0);
                }}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer",
                  active
                    ? "bg-brand text-white shadow-xs shadow-brand/25"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900",
                )}
              >
                {st.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên, SĐT khách, nội dung..."
              className={`${uiInput} h-9 pl-8 pr-7 text-xs`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Xóa tìm kiếm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            value={localChannel}
            onChange={(e) => {
              setLocalChannel(e.target.value);
              setOffset(0);
            }}
            className={`${uiSelect} h-9 text-xs`}
            aria-label="Lọc theo kênh"
          >
            <option value="all">Tất cả kênh</option>
            {PRIMARY_SLA_CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredItems.length === 0}
            className={`${btn.outline} ${btnSize.sm} text-xs cursor-pointer`}
          >
            <Download className="h-3.5 w-3.5" />
            Xuất CSV
          </button>
        </div>
      </div>

      {/* ── Queue Table ────────────────────────────────────────────────────── */}
      <section className={`${card} overflow-hidden shadow-2xs`}>
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            Đang tải hàng đợi lượt hội thoại SLA...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <MessageSquare className="mx-auto h-9 w-9 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              Không có lượt hội thoại nào khớp bộ lọc
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Thử đổi trạng thái, mở rộng khoảng ngày hoặc xóa từ khóa tìm kiếm.
            </p>
          </div>
        ) : (
          <div className={table.wrapper}>
            <table className={table.root}>
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  <th className={`${table.head} pl-5`}>Kênh &amp; Khách hàng</th>
                  <th className={table.head}>Tin nhắn khách</th>
                  <th className={table.head}>Thời điểm / Hạn SLA</th>
                  <th className={table.head}>Trạng thái &amp; Đồng hồ</th>
                  <th className={table.head}>Nhân viên xử lý</th>
                  <th className={`${table.head} pr-5 text-right`}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((turn) => {
                  const meta = getChannelMeta(turn.channel);
                  const live = turn.status === "waiting" ? computeLiveWait(turn) : null;
                  const openHref = fallbackOpenUrl(turn);
                  const preview = turn.last_msg_preview || turn.first_msg_preview || "—";

                  return (
                    <tr
                      key={turn.id}
                      className={cn(
                        table.row,
                        turn.status === "waiting" &&
                          live?.liveState === "breached" &&
                          "bg-rose-50/40 hover:bg-rose-50/70",
                      )}
                    >
                      {/* Channel & Customer */}
                      <td className={`${table.cell} pl-5`}>
                        <div className="flex items-start gap-2.5">
                          <span
                            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white shadow-2xs"
                            style={{ backgroundColor: meta.color }}
                            title={meta.label}
                          >
                            {meta.short}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="max-w-[200px] truncate font-bold text-slate-900">
                                {turn.customer_name || turn.conversation_id}
                              </span>
                              {turn.is_first_turn && (
                                <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                                  Lần đầu
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              <span className="truncate max-w-[160px]" title={turn.account_name || turn.account_id}>
                                {turn.account_name || turn.account_id}
                              </span>
                              {turn.customer_phone && (
                                <span className="inline-flex items-center gap-0.5 font-medium text-slate-600">
                                  <Phone className="h-2.5 w-2.5" />
                                  {turn.customer_phone}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Message preview */}
                      <td className={`${table.cell} max-w-[260px]`}>
                        <p className="line-clamp-2 text-xs text-slate-700" title={preview}>
                          {preview}
                        </p>
                        {turn.unanswered_msg_count > 1 && (
                          <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {turn.unanswered_msg_count} tin liên tiếp
                          </span>
                        )}
                      </td>

                      {/* Timestamps */}
                      <td className={`${table.cell} whitespace-nowrap text-xs tabular-nums`}>
                        <div className="font-medium text-slate-800">
                          {formatDateTimeVn(turn.customer_msg_at)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          Hạn ({Math.round((turn.target_seconds || 300) / 60)}p):{" "}
                          <span className="font-semibold text-slate-700">
                            {formatDateTimeVn(turn.deadline_at)}
                          </span>
                        </div>
                      </td>

                      {/* Status & Live Timer */}
                      <td className={`${table.cell} whitespace-nowrap`}>
                        {turn.status === "waiting" && live ? (
                          <SlaBadgePill
                            state={live.liveState}
                            waitSeconds={live.waitSeconds}
                            targetSeconds={turn.target_seconds}
                            unansweredCount={turn.unanswered_msg_count}
                          />
                        ) : turn.status === "met" ? (
                          <div className="space-y-0.5">
                            <span className={pill.success}>✓ Đạt SLA</span>
                            <div className="text-[11px] font-medium text-slate-600 tabular-nums">
                              Trả lời sau{" "}
                              <strong className="text-[#0d857f]">
                                {formatDurationVi(turn.business_response_seconds ?? turn.raw_response_seconds)}
                              </strong>
                            </div>
                          </div>
                        ) : turn.status === "breached" ? (
                          <div className="space-y-0.5">
                            <span className={pill.danger}>✕ Quá hạn SLA</span>
                            <div className="text-[11px] font-medium text-slate-600 tabular-nums">
                              Trả lời sau{" "}
                              <strong className="text-brand">
                                {formatDurationVi(turn.business_response_seconds ?? turn.raw_response_seconds)}
                              </strong>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className={pill.neutral}>Đã bỏ qua</span>
                            {turn.dismiss_reason && (
                              <div
                                className="max-w-[160px] truncate text-[11px] text-slate-500"
                                title={turn.dismiss_reason}
                              >
                                {turn.dismiss_reason}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Staff */}
                      <td className={`${table.cell} text-xs`}>
                        {turn.responded_by_name || turn.responded_by_email ? (
                          <div>
                            <div className="font-semibold text-slate-800">
                              {turn.responded_by_name || turn.responded_by_email}
                            </div>
                            {turn.staff_reply_at && (
                              <div className="text-[11px] text-slate-500 tabular-nums">
                                {formatDateTimeVn(turn.staff_reply_at)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className={`${table.cell} pr-5 text-right whitespace-nowrap`}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Link
                            href={openHref}
                            className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand-subtle px-3 py-1 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Mở chat
                          </Link>
                          {canDismiss && turn.status === "waiting" && (
                            <button
                              type="button"
                              onClick={() => {
                                setDismissTarget(turn);
                                setDismissReason("");
                              }}
                              title="Bỏ qua lượt này (tin spam / không cần tính SLA)"
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
                            >
                              <Ban className="h-3 w-3" />
                              Bỏ qua
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs text-slate-600">
          <span className="tabular-nums">
            Hiển thị <strong>{pageFrom}</strong>–<strong>{pageTo}</strong> trên tổng{" "}
            <strong>{total}</strong> lượt
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_LIMIT))}
              className={`${btn.outline} h-8 px-3 text-xs cursor-pointer`}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Trước
            </button>
            <button
              type="button"
              disabled={offset + PAGE_LIMIT >= total || loading}
              onClick={() => setOffset((prev) => prev + PAGE_LIMIT)}
              className={`${btn.outline} h-8 px-3 text-xs cursor-pointer`}
            >
              Sau
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* ── Dismiss Modal ──────────────────────────────────────────────────── */}
      {dismissTarget && (
        <div
          className={`${uiModal.overlay} flex items-center justify-center`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dismiss-turn-title"
        >
          <form
            onSubmit={handleConfirmDismiss}
            className={`${uiModal.panel} max-w-md p-6`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="dismiss-turn-title" className="text-base font-bold text-slate-900">
                  Bỏ qua lượt SLA (Spam / Không tính)
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Khách: <strong>{dismissTarget.customer_name || dismissTarget.conversation_id}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDismissTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {DISMISS_QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDismissReason(r)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer",
                    dismissReason === r
                      ? "border-brand bg-brand-subtle text-brand"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Lý do bỏ qua
              </label>
              <input
                type="text"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="Nhập lý do bỏ qua lượt này..."
                className={uiInput}
                required
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDismissTarget(null)}
                className={`${btn.outline} ${btnSize.sm} cursor-pointer`}
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={dismissing}
                className={`${btn.primary} ${btnSize.sm} cursor-pointer`}
              >
                {dismissing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Xác nhận bỏ qua
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
