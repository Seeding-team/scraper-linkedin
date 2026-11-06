"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Avatar } from "../../dashboard/Avatar";
import {
  zaloBotApi,
  type ZaloBotCandidate,
  type ZaloBotScopeMode,
  type ZaloBotScopeSummary,
} from "@/lib/zaloBotClient";

type Props = {
  accountId: string;
  /** Chế độ phạm vi đang chọn trong form (chỉ dùng để hiển thị bot đang bật/tắt thực tế cho từng người). */
  scopeMode: ZaloBotScopeMode;
  summary: ZaloBotScopeSummary | undefined;
  readOnly: boolean;
  /** Gọi sau khi đổi rule để cha tải lại số liệu tóm tắt. */
  onChanged: () => void;
};

type ListStore = { key: string; items: ZaloBotCandidate[]; error: string | null };
type SelectionStore = { account: string; ids: Set<string> };

const EMPTY_IDS = new Set<string>();

/** Bot có đang trả lời người này không (theo phạm vi + rule đặt tay). */
function effectiveOn(mode: ZaloBotScopeMode, rule: boolean | null): boolean {
  return mode === "selected" ? rule === true : rule !== false;
}

/**
 * Chọn người để bật/tắt bot hàng loạt. Thay đổi áp dụng NGAY (không cần bấm "Lưu" của bảng cài đặt),
 * vì đây là rule theo từng người, không phải cấu hình tài khoản.
 */
export default function ZaloBotScopePeople({ accountId, scopeMode, summary, readOnly, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [list, setList] = useState<ListStore | null>(null);
  const [selection, setSelection] = useState<SelectionStore>({ account: accountId, ids: EMPTY_IDS });
  const [busy, setBusy] = useState(false);

  const listKey = `${accountId}\u0000${query.trim()}\u0000${tick}`;

  useEffect(() => {
    // Người chỉ xem không có quyền gọi API danh sách/quy tắc theo người -> không gọi (tránh lỗi 403).
    if (!accountId || readOnly) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      zaloBotApi
        .getScopeCandidates(accountId, query.trim(), 80, ctrl.signal)
        .then((res) => setList({ key: listKey, items: res.items ?? [], error: null }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setList({ key: listKey, items: [], error: e instanceof Error ? e.message : "Không tải được danh sách người" });
        });
    }, query ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [accountId, query, listKey, readOnly]);

  const current = list && list.key === listKey ? list : null;
  const loading = current === null;
  const items = current?.items ?? [];
  const selected = selection.account === accountId ? selection.ids : EMPTY_IDS;

  const setSelected = useCallback(
    (ids: Set<string>) => setSelection({ account: accountId, ids }),
    [accountId],
  );

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const allChecked = items.length > 0 && items.every((i) => selected.has(i.thread_id));
  const toggleAll = (on: boolean) => {
    const next = new Set(selected);
    for (const i of items) {
      if (on) next.add(i.thread_id);
      else next.delete(i.thread_id);
    }
    setSelected(next);
  };

  const apply = async (botOn: boolean | null) => {
    const ids = [...selected];
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const res = await zaloBotApi.setScopeRules(accountId, ids, botOn);
      const verb = botOn === true ? "Đã bật bot" : botOn === false ? "Đã tắt bot" : "Đã bỏ đặt tay";
      toast.success(`${verb} cho ${res.changed} người`);
      setSelected(EMPTY_IDS);
      setTick((t) => t + 1);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (busy) return;
    if (!window.confirm("Xoá toàn bộ cài đặt bật/tắt theo từng người? Bot sẽ chạy theo đúng chế độ phạm vi ở trên.")) return;
    setBusy(true);
    try {
      await zaloBotApi.clearScopeRules(accountId);
      toast.success("Đã xoá cài đặt theo từng người");
      setSelected(EMPTY_IDS);
      setTick((t) => t + 1);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  };

  const manualCount = (summary?.on_count ?? 0) + (summary?.off_count ?? 0);

  if (readOnly) {
    return (
      <p className="text-xs text-muted-foreground">
        Đặt tay: <b className="text-green-700 dark:text-green-400">{summary?.on_count ?? 0} bật</b>
        {" · "}
        <b className="text-red-700 dark:text-red-400">{summary?.off_count ?? 0} tắt</b>
        . Danh sách chi tiết chỉ hiển thị cho người quản lý bot.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Đặt tay: <b className="text-green-700 dark:text-green-400">{summary?.on_count ?? 0} bật</b>
          {" · "}
          <b className="text-red-700 dark:text-red-400">{summary?.off_count ?? 0} tắt</b>
        </span>
        {manualCount > 0 && !readOnly && (
          <button type="button" className="font-medium text-primary hover:underline disabled:opacity-50" disabled={busy} onClick={() => void clearAll()}>
            Xoá hết đặt tay
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm người theo tên…"
          className="h-8 pl-8 text-xs"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <label className="flex cursor-pointer items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-xs font-medium border-border">
          <Checkbox checked={allChecked} disabled={readOnly || items.length === 0} onCheckedChange={(v) => toggleAll(v === true)} />
          <span className="flex-1">Chọn tất cả đang hiển thị ({items.length})</span>
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </label>
        <div className="max-h-64 overflow-y-auto">
          {current?.error ? (
            <p className="px-3 py-4 text-xs text-red-600">{current.error}</p>
          ) : items.length === 0 && !loading ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {query ? "Không tìm thấy người nào." : "Chưa có hội thoại 1-1 nào."}
            </p>
          ) : (
            items.map((item) => {
              const on = effectiveOn(scopeMode, item.rule);
              return (
                <label
                  key={item.thread_id}
                  className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-1.5 text-xs last:border-b-0 hover:bg-muted/40 border-border"
                >
                  <Checkbox
                    checked={selected.has(item.thread_id)}
                    disabled={readOnly}
                    onCheckedChange={(v) => toggle(item.thread_id, v === true)}
                  />
                  <Avatar src={item.avatar_url} name={item.name} className="size-8 text-[11px]" />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold border-border",
                      on
                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                    title={item.rule === null ? "Theo chế độ phạm vi (chưa đặt tay)" : "Đã đặt tay"}
                  >
                    {on ? "Bot bật" : "Bot tắt"}
                    {item.rule !== null && " • tay"}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Đã chọn {selected.size} người:</span>
          <Button type="button" size="sm" className="h-7 text-xs" disabled={busy || selected.size === 0} onClick={() => void apply(true)}>
            Bật bot
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy || selected.size === 0} onClick={() => void apply(false)}>
            Tắt bot
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy || selected.size === 0} onClick={() => void apply(null)}>
            Bỏ đặt tay
          </Button>
          {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}
    </div>
  );
}
