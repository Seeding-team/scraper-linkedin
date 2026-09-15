"use client";

/** Giao diện port nguyên từ layout campaigns của zalo-account-module
 * (InvoiceFlowManager) — chỉ đổi màu thương hiệu, giữ nguyên data-fetching/API
 * call hiện có của app này. Responsive breakpoints giữ y hệt bản gốc. */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Megaphone, Plus, RefreshCw } from "lucide-react";
import { MaterialIcon } from "@/components/ui";
import { useZaloAccountOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { CampaignFormDialog } from "./CampaignFormDialog";
import {
  deleteZaloCampaign,
  listZaloCampaignLogs,
  listZaloCampaignRecipients,
  listZaloCampaigns,
  patchZaloCampaign,
} from "@/services/zaloCrawlerService";
import type { ZaloCampaign, ZaloCampaignLog, ZaloCampaignRecipient } from "@/types/zalo-api";
import { alert, btn, btnSize, card, pageStack, pill } from "../centralized-shared/zaloUi";

export function ZaloCampaignsPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const [campaigns, setCampaigns] = useState<ZaloCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [detailCampaign, setDetailCampaign] = useState<ZaloCampaign | null>(null);
  const [recipients, setRecipients] = useState<ZaloCampaignRecipient[]>([]);
  const [logs, setLogs] = useState<ZaloCampaignLog[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<"recipients" | "logs">("recipients");

  const reload = useCallback(async () => {
    if (!selectedAccountId) {
      setCampaigns([]);
      return;
    }
    setLoadingCampaigns(true);
    setError(null);
    try {
      const res = await listZaloCampaigns(selectedAccountId);
      setCampaigns(res.campaigns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách chiến dịch");
    } finally {
      setLoadingCampaigns(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleToggle(c: ZaloCampaign) {
    setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_enabled: !x.is_enabled } : x)));
    try {
      await patchZaloCampaign(selectedAccountId, c.id, { is_enabled: !c.is_enabled });
    } catch (e) {
      setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_enabled: c.is_enabled } : x)));
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái");
    }
  }

  async function handleDelete(c: ZaloCampaign) {
    if (!confirm(`Xoá chiến dịch "${c.name}"? Hành động không thể hoàn tác.`)) return;
    try {
      await deleteZaloCampaign(selectedAccountId, c.id);
      setCampaigns((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được chiến dịch");
    }
  }

  async function openDetail(c: ZaloCampaign) {
    setDetailCampaign(c);
    setDetailTab("recipients");
    setLoadingDetail(true);
    try {
      const [r, l] = await Promise.all([
        listZaloCampaignRecipients(selectedAccountId, c.id),
        listZaloCampaignLogs(selectedAccountId, c.id),
      ]);
      setRecipients(r.recipients);
      setLogs(l.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được chi tiết chiến dịch");
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-4 sm:p-6">
      <div className={`mx-auto max-w-5xl ${pageStack}`}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Chiến dịch nhắn tin tự động</h1>
              <p className="mt-1 max-w-xl text-sm text-slate-500">
                Nhắn tin lặp lịch theo khung giờ/ngày trong tuần, xoay vòng mẫu tin, gợi ý nội dung bằng AI.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
            <button type="button" onClick={() => void reload()} disabled={loadingCampaigns} className={`${btn.outline} ${btnSize.sm}`}>
              {loadingCampaigns ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Làm mới
            </button>
            {selectedAccountId ? (
              <button type="button" onClick={() => setShowEditor(true)} className={`${btn.primary} ${btnSize.sm}`}>
                <Plus className="h-3.5 w-3.5" />
                Tạo chiến dịch
              </button>
            ) : null}
          </div>
        </header>

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
          {campaigns.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">
              {loadingCampaigns ? "Đang tải..." : "Chưa có chiến dịch nào. Bấm \"Tạo chiến dịch\" để bắt đầu."}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {campaigns.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void openDetail(c)}>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggle(c);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleToggle(c)}
                      title={c.is_enabled ? "Đang bật — bấm để tắt" : "Đang tắt — bấm để bật"}
                      className={`inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition ${c.is_enabled ? "bg-brand" : "bg-slate-300"}`}
                    >
                      <span className={`h-4 w-4 rounded-full bg-white shadow transition ${c.is_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                      <p className="mt-0.5 text-[11.5px] text-slate-500">
                        {c.start_time?.slice(0, 5)}–{c.end_time?.slice(0, 5)} · {c.sent_today}/{c.daily_limit} hôm nay
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(c)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                  >
                    <MaterialIcon name="delete" className="text-sm" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showEditor && selectedAccountId ? (
        <CampaignFormDialog
          accountId={selectedAccountId}
          onClose={() => setShowEditor(false)}
          onCreated={() => {
            setShowEditor(false);
            void reload();
          }}
        />
      ) : null}

      {detailCampaign ? (
        <div className="fixed inset-0 z-[170] grid place-items-center bg-black/50 px-4">
          <button type="button" className="absolute inset-0" aria-label="Đóng" onClick={() => setDetailCampaign(null)} />
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">{detailCampaign.name}</h3>
              <button type="button" onClick={() => setDetailCampaign(null)} className="text-slate-400 hover:text-slate-600">
                <MaterialIcon name="close" className="text-base" />
              </button>
            </div>
            <div className="flex shrink-0 gap-1 border-b border-slate-100 px-5 pt-3">
              {(["recipients", "logs"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  className={`cursor-pointer rounded-t-lg px-4 py-1.5 text-[13px] font-medium transition-colors ${
                    detailTab === tab ? "bg-brand text-white" : "bg-[#f1f4f8] text-[#4f5f71] hover:bg-[#e6eaef]"
                  }`}
                >
                  {tab === "recipients" ? `Người nhận (${recipients.length})` : `Log gửi (${logs.length})`}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loadingDetail ? (
                <div className="py-6 text-center text-sm text-slate-500">Đang tải...</div>
              ) : detailTab === "recipients" ? (
                recipients.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">Chưa có người nhận nào.</div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-[12px]">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2.5 py-1.5 text-left font-semibold">Người nhận</th>
                          <th className="px-2.5 py-1.5 text-left font-semibold">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipients.map((r) => (
                          <tr key={r.id} className="border-t border-slate-100">
                            <td className="px-2.5 py-1.5">{r.display_name || r.phone || r.uid}</td>
                            <td className="px-2.5 py-1.5">
                              <span className={r.status === "success" ? pill.success : r.status === "failed" ? pill.danger : pill.info}>{r.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : logs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">Chưa có tin nào được gửi.</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left font-semibold">SĐT</th>
                        <th className="px-2.5 py-1.5 text-left font-semibold">Trạng thái</th>
                        <th className="px-2.5 py-1.5 text-left font-semibold">Thời gian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="px-2.5 py-1.5 font-mono">{l.phone}</td>
                          <td className="px-2.5 py-1.5">
                            <span className={l.status === "success" ? pill.success : pill.danger}>{l.status === "success" ? "Thành công" : "Thất bại"}</span>
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-500">{new Date(l.created_at).toLocaleString("vi-VN")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
