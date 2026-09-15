"use client";

/**
 * Giao diện port nguyên từ ForwardRulesDashboard.tsx (zalo-forward-module,
 * InvoiceFlowManager) — chỉ đổi màu thương hiệu (xem centralized-shared/zaloUi.ts),
 * giữ nguyên toàn bộ data-fetching/hook/API call của app này (KHÔNG đổi logic).
 * Responsive breakpoints (sm:/md:/lg:) giữ y hệt bản gốc.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { MaterialIcon } from "@/components/ui";
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
import { alert, btn, btnSize, card, pageStack, pill } from "../centralized-shared/zaloUi";

function statusPillCls(status: string) {
  switch (status) {
    case "success":
      return pill.success;
    case "dry_run":
      return pill.info;
    case "skipped":
      return pill.neutral;
    case "rate_limited":
      return pill.warning;
    default:
      return pill.danger;
  }
}

const STATUS_LABEL: Record<string, string> = {
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
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedLogsFor, setExpandedLogsFor] = useState<number | null>(null);
  const [logsByRule, setLogsByRule] = useState<Record<number, ZaloForwardLog[]>>({});
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

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
    if (!confirm(`Xoá luật chuyển tiếp "${rule.name || rule.master_thread_name}"? Hành động không thể hoàn tác.`)) return;
    try {
      await deleteZaloForwardRule(selectedAccountId, rule.id);
      setNotice("Đã xoá luật chuyển tiếp.");
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được rule");
    }
  }

  async function toggleLogs(rule: ZaloForwardRule) {
    if (expandedLogsFor === rule.id) {
      setExpandedLogsFor(null);
      return;
    }
    setExpandedLogsFor(rule.id);
    setLoadingLogs(true);
    try {
      const res = await listZaloForwardLogs(selectedAccountId, rule.id);
      setLogsByRule((m) => ({ ...m, [rule.id]: res.logs }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được log");
    } finally {
      setLoadingLogs(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-4 sm:p-6">
      <div className={`mx-auto max-w-5xl ${pageStack}`}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Chuyển tiếp tin nhắn tự động</h1>
              <p className="mt-1 max-w-xl text-sm text-slate-500">
                Chọn 1 nhóm chính, mọi tin nhắn mới gửi trong nhóm đó sẽ tự động chuyển tiếp sang các nhóm đích bên dưới.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
            <button
              type="button"
              onClick={() => void reloadRules()}
              disabled={loadingRules}
              className={`${btn.outline} ${btnSize.sm}`}
            >
              {loadingRules ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Làm mới
            </button>
            {selectedAccountId ? (
              <button type="button" onClick={() => setShowEditor(true)} className={`${btn.primary} ${btnSize.sm}`}>
                <Plus className="h-3.5 w-3.5" />
                Tạo rule mới
              </button>
            ) : null}
          </div>
        </header>

        {notice ? (
          <div className={alert.success}>
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Đóng
            </button>
          </div>
        ) : null}
        {error ? (
          <div className={alert.error}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-xs font-semibold underline">
              Đóng
            </button>
          </div>
        ) : null}

        <section className={`${card} min-h-0 flex-1 overflow-auto`}>
          {rules.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">
              {loadingRules ? "Đang tải..." : "Chưa có luật chuyển tiếp nào. Bấm \"Tạo rule mới\" để bắt đầu."}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rules.map((rule) => (
                <div key={rule.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleToggle(rule)}
                      title={rule.is_enabled ? "Đang bật — bấm để tắt" : "Đang tắt — bấm để bật"}
                      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                        rule.is_enabled ? "bg-brand" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white shadow transition ${
                          rule.is_enabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Send className="h-3.5 w-3.5 shrink-0 text-brand" />
                        <span className="truncate font-semibold text-slate-900">{rule.name || "Luật chuyển tiếp"}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-slate-500">
                        Nhóm chính: <span className="font-semibold text-slate-700">{rule.master_thread_name || rule.master_thread_id}</span>{" "}
                        → {(rule.zalo_forward_targets || []).length} nhóm đích
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void toggleLogs(rule)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {expandedLogsFor === rule.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        Log
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(rule)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {expandedLogsFor === rule.id ? (
                    <div className="mt-2 max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-50">
                      {loadingLogs ? (
                        <div className="flex items-center gap-1 px-3 py-3 text-[11px] text-slate-500">
                          <Loader2 className="h-3 w-3 animate-spin" /> Đang tải log...
                        </div>
                      ) : (logsByRule[rule.id] || []).length === 0 ? (
                        <div className="px-3 py-3 text-[11px] text-slate-500">Chưa có log nào.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead className="sticky top-0 bg-slate-100 text-slate-500">
                              <tr>
                                <th className="px-2 py-1.5 text-left font-semibold">Thời gian</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Nhóm đích</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Loại</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Trạng thái</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Lỗi</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(logsByRule[rule.id] || []).map((log) => (
                                <tr key={log.id} className="border-t border-slate-200">
                                  <td className="px-2 py-1.5 text-slate-500">{new Date(log.created_at).toLocaleString("vi-VN")}</td>
                                  <td className="max-w-[220px] truncate px-2 py-1.5 font-mono" title={log.target_thread_id}>
                                    {log.target_thread_id}
                                  </td>
                                  <td className="px-2 py-1.5">{log.content_type}</td>
                                  <td className="px-2 py-1.5">
                                    <span className={statusPillCls(log.status)}>{STATUS_LABEL[log.status] || log.status}</span>
                                  </td>
                                  <td className="max-w-[240px] truncate px-2 py-1.5 text-red-600" title={log.error || ""}>
                                    {log.error || ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showEditor && selectedAccountId ? (
        <CreateForwardRuleDialog
          accountId={selectedAccountId}
          onClose={() => setShowEditor(false)}
          onCreated={() => {
            setShowEditor(false);
            setNotice("Đã tạo luật chuyển tiếp.");
            void reloadRules();
          }}
        />
      ) : null}
    </div>
  );
}
