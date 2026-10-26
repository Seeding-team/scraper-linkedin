"use client";

import { useCallback, useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import { crawlQueueService, type CrawlQueueOverview } from "@/services/all-platform.service";

// Khớp WORKER_STALE_SECONDS ở backend (supabase_crawl_queue_service.py) -- worker không
// heartbeat quá ngưỡng này bị coi là offline.
const WORKER_STALE_SECONDS = 90;

function isWorkerOnline(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;
  const diffSec = (Date.now() - new Date(lastHeartbeat).getTime()) / 1000;
  return diffSec <= WORKER_STALE_SECONDS;
}

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: "Đang chờ",
  assigned: "Đã giao",
  processing: "Đang cào",
  done: "Hoàn tất",
  failed: "Thất bại",
};

const JOB_STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-50 text-slate-600 border-slate-200",
  assigned: "bg-amber-50 text-amber-700 border-amber-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  done: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-600 border-red-200",
};

export function CrawlQueueMonitor() {
  const [data, setData] = useState<CrawlQueueOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await crawlQueueService.overview();
      if (res.success && res.data) {
        setData(res.data);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  const jobCounts = data?.job_counts || {};
  const accountCounts = data?.account_counts || {};

  const statTiles = [
    { key: "pending", label: "Đang chờ", value: jobCounts.pending ?? 0, color: "text-slate-600 bg-slate-50 border-slate-200" },
    { key: "processing", label: "Đang cào", value: (jobCounts.assigned ?? 0) + (jobCounts.processing ?? 0), color: "text-blue-700 bg-blue-50 border-blue-200" },
    { key: "done", label: "Hoàn tất", value: jobCounts.done ?? 0, color: "text-green-700 bg-green-50 border-green-200" },
    { key: "failed", label: "Thất bại", value: jobCounts.failed ?? 0, color: "text-red-600 bg-red-50 border-red-200" },
  ];

  return (
    <div className="w-full min-w-0 space-y-6 font-sans">
      <div className="relative overflow-hidden rounded-2xl border border-outline-variant bg-surface p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]">
        <div className="relative flex items-center gap-4">
          <div className="rounded-2xl bg-primary/10 p-3">
            <MaterialIcon name="monitoring" className="text-primary text-3xl" />
          </div>
          <div>
            <h1 className="text-h1 text-on-surface font-bold tracking-tight">Giám sát hàng đợi cào</h1>
            <p className="text-body-md text-on-surface-variant">
              Tình trạng job / acc / VPS worker của hàng đợi cào Facebook đa VPS — tự làm mới mỗi 12 giây
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-700">
          ⚠️ Không tải được dữ liệu giám sát. Kiểm tra backend.
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statTiles.map((tile) => (
          <div key={tile.key} className={cn("rounded-2xl border p-4", tile.color)}>
            <div className="text-2xl font-bold tabular-nums">{loading ? "—" : tile.value}</div>
            <div className="text-xs font-semibold mt-1">{tile.label}</div>
          </div>
        ))}
      </div>

      {/* Workers */}
      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="px-4 py-3 border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
          <h2 className="text-sm font-bold text-on-surface">VPS Worker</h2>
          <span className="text-xs font-semibold text-on-surface-variant px-2 py-0.5 bg-surface-container-highest rounded-full">
            {data?.workers.length ?? 0} worker
          </span>
        </div>
        {!data?.workers.length ? (
          <div className="text-center py-10 text-xs text-on-surface-variant">Chưa có VPS worker nào từng kết nối.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
                <tr>
                  <th className="py-3 px-4">Worker</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4">Heartbeat gần nhất</th>
                  <th className="py-3 px-4">Job đang cào</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-on-surface-variant">
                {data.workers.map((w) => {
                  const online = isWorkerOnline(w.last_heartbeat);
                  return (
                    <tr key={w.worker_id} className="hover:bg-surface-container-low/30 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-on-surface">{w.name || w.worker_id.slice(0, 8)}</div>
                        <div className="text-[10px] font-mono text-on-surface-variant">{w.worker_id}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border",
                          online ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200")}>
                          {online ? `🟢 ${w.status}` : "⚪ offline"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {w.last_heartbeat ? new Date(w.last_heartbeat).toLocaleString("vi-VN") : "—"}
                      </td>
                      <td className="py-3 px-4 font-mono text-[10px]">{w.current_job_id ? w.current_job_id.slice(0, 8) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Accounts */}
      <div className="rounded-xl border border-outline-variant bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-bold text-on-surface mb-3">Pool tài khoản Facebook</h2>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2">
            <span className="text-lg font-bold text-green-700 tabular-nums">{accountCounts.available ?? 0}</span>
            <span className="text-xs text-green-700 ml-1.5">sẵn sàng</span>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
            <span className="text-lg font-bold text-amber-700 tabular-nums">{accountCounts.assigned ?? 0}</span>
            <span className="text-xs text-amber-700 ml-1.5">đang dùng</span>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2">
            <span className="text-lg font-bold text-red-600 tabular-nums">{accountCounts.invalid ?? 0}</span>
            <span className="text-xs text-red-600 ml-1.5">cần đăng nhập lại</span>
          </div>
        </div>
      </div>

      {/* Recent jobs */}
      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="px-4 py-3 border-b border-outline-variant bg-surface-container-low">
          <h2 className="text-sm font-bold text-on-surface">20 job gần nhất</h2>
        </div>
        {!data?.recent_jobs.length ? (
          <div className="text-center py-10 text-xs text-on-surface-variant">Chưa có job nào trong hàng đợi.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase">
                <tr>
                  <th className="py-3 px-4">Nhóm</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4">Worker</th>
                  <th className="py-3 px-4 text-center">Retry</th>
                  <th className="py-3 px-4">Lỗi</th>
                  <th className="py-3 px-4">Tạo lúc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-on-surface-variant">
                {data.recent_jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-surface-container-low/30 transition">
                    <td className="py-3 px-4 min-w-[160px]">
                      <div className="font-bold text-on-surface truncate max-w-[220px]">{job.group_name || job.group_url}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", JOB_STATUS_COLOR[job.status] || "")}>
                        {JOB_STATUS_LABEL[job.status] || job.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[10px]">{job.assigned_worker_id ? job.assigned_worker_id.slice(0, 8) : "—"}</td>
                    <td className="py-3 px-4 text-center tabular-nums">{job.retry_count}</td>
                    <td className="py-3 px-4 max-w-[200px] truncate text-[11px] text-red-500" title={job.error_message || ""}>
                      {job.error_message || "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px]">{new Date(job.created_at).toLocaleString("vi-VN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
