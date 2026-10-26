"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Search, Send, X } from "lucide-react";

import {
  getSalesAssetSourceLabel,
  getSalesAssetTypeLabel,
  SALES_ASSET_TYPE_OPTIONS,
  salesAssetService,
  type SalesAsset,
  type SalesAssetType,
} from "@/services/sales-asset.service";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSend: (asset: SalesAsset) => Promise<void> | void;
  sending?: boolean;
  customerLeadId?: string | null;
  dealId?: string | null;
}

export function SalesAssetPickerModal({ open, onClose, onSend, sending, customerLeadId, dealId }: Props) {
  const [assets, setAssets] = useState<SalesAsset[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<SalesAssetType | "">("");
  const [project, setProject] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      setLoading(true);
      setError("");
      try {
        let data = await salesAssetService.list({
          status: "active",
          customerLeadId: customerLeadId || undefined,
          dealId: dealId || undefined,
        });
        if (!data.length && (customerLeadId || dealId)) {
          data = await salesAssetService.list({ status: "active" });
        }
        if (cancelled) return;
        setAssets(data);
        setSelectedId(data[0]?.id || "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, customerLeadId, dealId]);

  const projectOptions = useMemo(
    () => [...new Set(assets.map((asset) => asset.projectName).filter(Boolean))],
    [assets],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesType = !type || asset.type === type;
      const matchesProject = !project || asset.projectName === project;
      const haystack = [
        asset.customerName,
        asset.title,
        asset.description,
        asset.projectName,
        asset.version,
        asset.industry,
        asset.servicePackage,
        asset.tags.join(" "),
      ].join(" ").toLowerCase();
      return matchesType && matchesProject && (!needle || haystack.includes(needle));
    });
  }, [assets, search, type, project]);

  const selected = filtered.find((asset) => asset.id === selectedId) || filtered[0];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">Gửi tài liệu</h2>
            <p className="text-sm text-slate-500">Ưu tiên tài liệu của đúng khách hàng/deal đang chat, rồi chèn link vào hội thoại.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm theo tiêu đề, tag, ngành hàng..."
                className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
              />
            </label>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as SalesAssetType | "")}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
            >
              <option value="">Tất cả loại</option>
              {SALES_ASSET_TYPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <select
              value={project}
              onChange={(event) => setProject(event.target.value)}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
            >
              <option value="">Tất cả dự án</option>
              {projectOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="min-h-[280px] flex-1 overflow-auto p-4">
          {loading ? <div className="py-12 text-center text-sm text-slate-500">Đang tải tài liệu...</div> : null}
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div> : null}
          {!loading && !error && filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">Chưa có tài liệu phù hợp.</div>
          ) : null}
          <div className="space-y-2">
            {filtered.map((asset) => (
              <button
                type="button"
                key={asset.id}
                onClick={() => setSelectedId(asset.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
                  selected?.id === asset.id ? "border-rose-400 bg-rose-50/60" : "border-slate-200 bg-white hover:border-slate-300"
                )}
              >
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <FileText size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-950">{asset.title}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                      {getSalesAssetTypeLabel(asset.type)}
                    </span>
                    {asset.version ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">
                        {asset.version}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm text-slate-600">
                    {[asset.customerName, asset.projectName, getSalesAssetSourceLabel(asset.sourceType)].filter(Boolean).join(" - ") || asset.shareUrl}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {asset.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                        {tag}
                      </span>
                    ))}
                  </span>
                </span>
                {asset.shareUrl ? (
                  <a
                    href={asset.shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-900"
                    title="Xem trước"
                  >
                    <ExternalLink size={16} />
                  </a>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Hủy
          </button>
          <button
            type="button"
            onClick={() => selected && onSend(selected)}
            disabled={!selected || sending}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-rose-600/20 hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {sending ? "Đang gửi..." : "Gửi"}
          </button>
        </div>
      </div>
    </div>
  );
}
