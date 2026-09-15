"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MaterialIcon } from "@/components/ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useZaloAccountOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { CreateForwardRuleDialog } from "./CreateForwardRuleDialog";
import {
  deleteZaloForwardRule,
  listZaloForwardLogs,
  listZaloForwardRules,
  updateZaloForwardRule,
} from "@/services/zaloCrawlerService";
import type { ZaloForwardLog, ZaloForwardRule } from "@/types/zalo-api";

const LOG_STATUS_STYLE: Record<string, string> = {
  success: "bg-green-100 text-green-700 border-green-200",
  dry_run: "bg-amber-100 text-amber-700 border-amber-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  skipped: "bg-surface-container text-muted-foreground border-border",
  rate_limited: "bg-orange-100 text-orange-700 border-orange-200",
};

const LOG_STATUS_LABEL: Record<string, string> = {
  success: "Thành công",
  dry_run: "Thử nghiệm (dry-run)",
  failed: "Thất bại",
  skipped: "Bỏ qua",
  rate_limited: "Bị giới hạn tốc độ",
};

export function ZaloForwardRulesPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const [rules, setRules] = useState<ZaloForwardRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logSheetRule, setLogSheetRule] = useState<ZaloForwardRule | null>(null);
  const [logs, setLogs] = useState<ZaloForwardLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const reloadRules = useCallback(async () => {
    if (!selectedAccountId) {
      setRules([]);
      return;
    }
    setLoadingRules(true);
    setError(null);
    try {
      const res = await listZaloForwardRules(selectedAccountId);
      setRules(res.rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách rule");
    } finally {
      setLoadingRules(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void reloadRules();
  }, [reloadRules]);

  async function handleToggle(rule: ZaloForwardRule) {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_enabled: !r.is_enabled } : r)));
    try {
      await updateZaloForwardRule(selectedAccountId, rule.id, { is_enabled: !rule.is_enabled });
    } catch (e) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_enabled: rule.is_enabled } : r)));
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái rule");
    }
  }

  async function handleDelete(rule: ZaloForwardRule) {
    if (!confirm(`Xoá rule "${rule.name || rule.master_thread_name}"? Hành động không thể hoàn tác.`)) return;
    try {
      await deleteZaloForwardRule(selectedAccountId, rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được rule");
    }
  }

  async function openLogs(rule: ZaloForwardRule) {
    setLogSheetRule(rule);
    setLoadingLogs(true);
    try {
      const res = await listZaloForwardLogs(selectedAccountId, rule.id);
      setLogs(res.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được log");
    } finally {
      setLoadingLogs(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Chuyển tiếp tin nhắn tự động</h1>
            <p className="text-sm text-muted-foreground">
              1 nhóm chính tự động chuyển tiếp mọi tin nhắn mới sang N nhóm đích, có giãn cách giữa các nhóm để tránh spam.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
            {selectedAccountId && <CreateForwardRuleDialog accountId={selectedAccountId} onCreated={reloadRules} />}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Danh sách rule</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRules ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Đang tải...</div>
            ) : rules.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <MaterialIcon name="share" className="text-3xl text-muted-foreground" />
                Chưa có rule nào. Bấm "Tạo rule mới" để bắt đầu chuyển tiếp tự động.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {rules.map((rule) => (
                  <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3">
                      <Switch checked={rule.is_enabled} onCheckedChange={() => void handleToggle(rule)} />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{rule.name || rule.master_thread_name}</p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="font-medium">{rule.master_thread_name || rule.master_thread_id}</span>
                          <MaterialIcon name="arrow_forward" className="text-sm" />
                          {(rule.zalo_forward_targets || []).length} nhóm đích
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => void openLogs(rule)}>
                        <MaterialIcon name="history" className="text-base" />
                        Xem log
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void handleDelete(rule)}>
                        <MaterialIcon name="delete" className="text-base" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!logSheetRule} onOpenChange={(open) => !open && setLogSheetRule(null)}>
        <SheetContent className="w-full max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Log chuyển tiếp — {logSheetRule?.name || logSheetRule?.master_thread_name}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            {loadingLogs ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Đang tải log...</div>
            ) : logs.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Chưa có log nào.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nhóm đích</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Thời gian</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="max-w-[140px] truncate text-xs">{log.target_thread_id}</TableCell>
                      <TableCell className="text-xs">{log.content_type}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={LOG_STATUS_STYLE[log.status] || ""}>
                          {LOG_STATUS_LABEL[log.status] || log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("vi-VN")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
