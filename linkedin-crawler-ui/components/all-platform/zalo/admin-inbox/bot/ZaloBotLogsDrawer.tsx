"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  zaloBotApi,
  type ZaloBotLogDirection,
  type ZaloBotLogItem,
  type ZaloBotLogStatus,
  type ZaloBotStats,
} from "@/lib/zaloBotClient";
import { useVisiblePolling } from "./useZaloBotPolling";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountLabel: string;
  /** thread_id của hội thoại 1-1 đang mở (nếu có) — dùng cho bộ lọc "chỉ hội thoại đang mở". */
  currentThreadId: string | null;
  /** Thống kê tổng của cả tài khoản chỉ dành cho admin/leader/chủ tài khoản; người khác chỉ xem nhật ký. */
  canViewStats: boolean;
};

const PAGE_SIZE = 50;
const ALL = "all";

const STATUS_LABEL: Record<ZaloBotLogStatus, string> = {
  forwarded: "Đã chuyển",
  sent: "Đã gửi",
  dry_run: "Chạy thử",
  skipped: "Bỏ qua",
  paused: "Tạm dừng",
  error: "Lỗi",
};

const STATUS_CLASS: Record<ZaloBotLogStatus, string> = {
  forwarded: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  sent: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  dry_run: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  skipped: "bg-muted text-muted-foreground",
  paused: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  error: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function formatVnTime(iso: string): string {
  // chuỗi không kèm múi giờ được coi là UTC
  const normalized = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 border-border">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-bold", tone)}>{value}</div>
    </div>
  );
}

function DayChart({ data }: { data: ZaloBotStats["by_day"] }) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out, d.error]));
  const W = 560;
  const H = 110;
  const slot = W / data.length;
  const barW = Math.max(2, Math.min(10, slot / 4));
  const h = (n: number) => (n / max) * (H - 4);
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <div className="rounded-lg border bg-card p-3 border-border">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Tin theo ngày</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block size-2 rounded-sm bg-blue-500" />Vào</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block size-2 rounded-sm bg-green-500" />Ra</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block size-2 rounded-sm bg-red-500" />Lỗi</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="h-36 w-full" role="img" aria-label="Biểu đồ tin bot theo ngày">
        <line x1="0" y1={H} x2={W} y2={H} className="stroke-border" />
        {data.map((d, i) => {
          const cx = i * slot + slot / 2;
          const x0 = cx - (barW * 3 + 2) / 2;
          return (
            <g key={d.date}>
              <title>{`${d.date}: vào ${d.in}, ra ${d.out}, lỗi ${d.error}`}</title>
              <rect x={x0} y={H - h(d.in)} width={barW} height={h(d.in)} className="fill-blue-500" />
              <rect x={x0 + barW + 1} y={H - h(d.out)} width={barW} height={h(d.out)} className="fill-green-500" />
              <rect x={x0 + (barW + 1) * 2} y={H - h(d.error)} width={barW} height={h(d.error)} className="fill-red-500" />
              {i % labelEvery === 0 && (
                <text x={cx} y={H + 12} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LogRow({ item }: { item: ZaloBotLogItem }) {
  const [expanded, setExpanded] = useState(false);
  const content = item.content ?? "";
  const long = content.length > 140 || content.includes("\n");
  const isError = item.status === "error";

  return (
    <li className={cn("rounded-lg border p-3 text-xs border-border", isError ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40" : "bg-card")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[11px] text-muted-foreground">{formatVnTime(item.created_at)}</span>
        <span
          className={cn(
            "rounded px-1.5 py-px text-[10px] font-bold",
            item.direction === "in"
              ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
              : "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
          )}
        >
          {item.direction === "in" ? "Vào" : "Ra"}
        </span>
        <span className={cn("rounded px-1.5 py-px text-[10px] font-bold", STATUS_CLASS[item.status])}>{STATUS_LABEL[item.status]}</span>
        <span className="min-w-0 truncate font-semibold">{item.thread_name || item.thread_id}</span>
        {item.status === "dry_run" && <span className="text-[10px] italic text-amber-700 dark:text-amber-300">Chưa gửi thật</span>}
      </div>

      {content && (
        <button
          type="button"
          onClick={() => long && setExpanded((v) => !v)}
          className={cn("mt-1.5 block w-full text-left whitespace-pre-wrap break-words", !expanded && long && "line-clamp-2", long && "cursor-pointer")}
          title={long ? (expanded ? "Thu gọn" : "Bấm để xem đầy đủ") : undefined}
        >
          {content}
        </button>
      )}

      {item.error && !isError && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">ⓘ {item.error}</p>
      )}

      {item.error && isError && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-red-300 bg-red-100/70 px-2 py-1.5 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <span className="min-w-0 flex-1 break-words font-medium">{item.error}</span>
          <button
            type="button"
            className="shrink-0 rounded p-1 hover:bg-red-200/70 dark:hover:bg-red-900"
            title="Sao chép lỗi"
            aria-label="Sao chép lỗi"
            onClick={() => {
              void navigator.clipboard
                .writeText(item.error ?? "")
                .then(() => toast.success("Đã sao chép lỗi"))
                .catch(() => toast.error("Không sao chép được"));
            }}
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

export default function ZaloBotLogsDrawer({ open, onOpenChange, accountId, accountLabel, currentThreadId, canViewStats }: Props) {
  const [days, setDays] = useState(7);
  const [direction, setDirection] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [items, setItems] = useState<ZaloBotLogItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<ZaloBotStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const q = useDebounced(search.trim(), 400);
  const onlyCurrentActive = onlyCurrent && Boolean(currentThreadId);
  const threadFilter = onlyCurrentActive ? (currentThreadId ?? undefined) : undefined;
  const filterKey = [accountId, direction, status, q, threadFilter ?? "", days].join("|");
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<ZaloBotLogItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const baseQuery = useCallback(
    () => ({
      account_id: accountId,
      thread_id: threadFilter,
      direction: direction === ALL ? undefined : (direction as ZaloBotLogDirection),
      status: status === ALL ? undefined : (status as ZaloBotLogStatus),
      q: q || undefined,
      limit: PAGE_SIZE,
    }),
    [accountId, threadFilter, direction, status, q],
  );

  const loadFirst = useCallback(
    async (silent: boolean) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await zaloBotApi.getLogs(baseQuery(), ctrl.signal);
        if (silent) {
          // tự làm mới: chỉ thêm tin mới lên đầu, giữ nguyên các trang đã tải thêm
          const topId = itemsRef.current[0]?.id ?? 0;
          const fresh = res.items.filter((it) => it.id > topId);
          if (fresh.length > 0) setItems((prev) => [...fresh, ...prev]);
        } else {
          setItems(res.items);
          setHasMore(res.has_more);
          setNextBeforeId(res.next_before_id);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!silent) {
          setItems([]);
          setHasMore(false);
          setError(e instanceof Error ? e.message : "Không tải được nhật ký bot");
        }
      } finally {
        if (!silent && abortRef.current === ctrl) setLoading(false);
      }
    },
    [baseQuery],
  );

  const loadStats = useCallback(async () => {
    if (!accountId || !canViewStats) return;
    try {
      const res = await zaloBotApi.getStats(accountId, days);
      setStats(res);
      setStatsError(null);
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "Không tải được thống kê");
    }
  }, [accountId, days, canViewStats]);

  useEffect(() => {
    if (!open || !accountId) return;
    // hoãn sang callback: loadFirst bật cờ loading ngay khi chạy
    const timer = window.setTimeout(() => void loadFirst(false), 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filterKey]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadStats(), 0);
    return () => window.clearTimeout(timer);
  }, [open, loadStats]);

  useVisiblePolling(
    () => {
      void loadFirst(true);
      void loadStats();
    },
    10_000,
    open && autoRefresh && Boolean(accountId),
  );

  const loadMore = async () => {
    if (!hasMore || nextBeforeId == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await zaloBotApi.getLogs({ ...baseQuery(), before_id: nextBeforeId });
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...res.items.filter((it) => !seen.has(it.id))];
      });
      setHasMore(res.has_more);
      setNextBeforeId(res.next_before_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không tải thêm được");
    } finally {
      setLoadingMore(false);
    }
  };

  const totals = stats?.totals;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="z-[100001] w-full overflow-y-auto sm:max-w-[56rem] border-border" overlayClassName="z-[100000]">
        <SheetHeader>
          <SheetTitle>Nhật ký Bot AI</SheetTitle>
          <SheetDescription className="truncate">Tài khoản Zalo: {accountLabel || "—"}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 px-4 pb-6">
          {canViewStats ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Thống kê</h3>
                <div className="flex items-center gap-1">
                  {[1, 7, 30].map((d) => (
                    <Button key={d} size="sm" variant={days === d ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setDays(d)}>
                      {d === 1 ? "Hôm nay" : `${d} ngày`}
                    </Button>
                  ))}
                </div>
              </div>

              {statsError && <p className="text-xs text-red-600">{statsError}</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <StatCard label="Tin bot đã chuyển" value={totals?.forwarded ?? "—"} />
                <StatCard label="Đã gửi" value={totals?.sent ?? "—"} tone="text-green-600" />
                <StatCard label="Chạy thử" value={totals?.dry_run ?? "—"} tone="text-amber-600" />
                <StatCard label="Lỗi" value={totals?.error ?? "—"} tone="text-red-600" />
                <StatCard label="Khách đã xử lý" value={stats?.threads_handled ?? "—"} />
              </div>
              {stats && <DayChart data={stats.by_day} />}
            </>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Thống kê tổng chỉ dành cho admin, leader hoặc chủ tài khoản Zalo. Bạn đang xem nhật ký của những cuộc trò chuyện bạn có quyền truy cập.
            </p>
          )}

          <div className={cn("flex flex-wrap items-end gap-3 pt-4", canViewStats && "border-t border-border")}>
            <div className="space-y-1">
              <Label className="text-[11px]">Hướng</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[100010]">
                  <SelectItem value={ALL}>Tất cả</SelectItem>
                  <SelectItem value="in">Vào</SelectItem>
                  <SelectItem value="out">Ra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Trạng thái</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[100010]">
                  <SelectItem value={ALL}>Tất cả</SelectItem>
                  {(Object.keys(STATUS_LABEL) as ZaloBotLogStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px] flex-1 space-y-1">
              <Label className="text-[11px]">Tìm theo nội dung / tên khách</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nhập từ khoá..." className="h-8 text-xs" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className={cn("flex items-center gap-2 text-xs", !currentThreadId && "opacity-50")}>
              <Checkbox checked={onlyCurrentActive} disabled={!currentThreadId} onCheckedChange={(v) => setOnlyCurrent(v === true)} />
              Chỉ hội thoại đang mở
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
                Tự làm mới (10s)
              </label>
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => { void loadFirst(false); void loadStats(); }} disabled={loading}>
                <RefreshCw className={cn(loading && "animate-spin")} />
                Làm mới
              </Button>
            </div>
          </div>

          {loading && items.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <span>{error}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadFirst(false)}>
                Thử lại
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground border-border">
              Chưa có nhật ký nào khớp bộ lọc.
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {items.map((it) => (
                  <LogRow key={it.id} item={it} />
                ))}
              </ul>
              {hasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore && <Loader2 className="animate-spin" />}
                    Tải thêm
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
