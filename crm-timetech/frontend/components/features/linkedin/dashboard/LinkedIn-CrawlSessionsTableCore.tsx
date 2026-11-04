"use client";

import { useMemo, useState } from "react";

import type { CrawlSessionGroup } from "@/types/api";
import type { CrawlTableViewMode } from "@/components/features/dashboard/types";

import {
  sessionLatestDateLabel,
  shortenSessionId,
} from "@/components/features/linkedin/dashboard/LinkedIn-n8n-sheet-helpers";
import { SessionPostsModal } from "@/components/features/linkedin/dashboard/LinkedIn-SessionPostsModal";
import { linkedInCrawlService } from "@/services/all-platform.service";
import { MaterialIcon } from "@/components/ui";

export interface CrawlSessionsTableCoreProps {
  sessions: CrawlSessionGroup[] | null;
  emptyHint: string;
  busy?: boolean;
  loadingHint?: string;
  modalTitleSuffix?: string;
  dashboardEmail?: string | null;
  linkedinPlaywrightSessionId?: string | null;
  /** Sau reaction + webhook OK — dialog OK gọi làm mới get-all-posts. */
  refreshSessionsAfterReaction?: () => Promise<void>;
  refreshSessionsBusy?: boolean;
  tableVariant?: CrawlTableViewMode;
  /** Chỉ khi ``tableVariant === 'filtered'`` — hiển thị cột «Ngày / điều kiện lọc». */
  filterAppliedLabel?: string;
}

/**
 * Bảng phiên cào + modal chi tiết — dùng trong Kết quả Crawl.
 */
export function CrawlSessionsTableCore({
  sessions,
  emptyHint,
  busy = false,
  loadingHint = "Đang tải dữ liệu phiên từ n8n…",
  modalTitleSuffix,
  dashboardEmail = null,
  linkedinPlaywrightSessionId = null,
  refreshSessionsAfterReaction,
  refreshSessionsBusy = false,
  tableVariant = "all",
  filterAppliedLabel = "",
}: CrawlSessionsTableCoreProps) {
  const PAGE_SIZE = 8;
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const open = useMemo(() => {
    if (!openSessionId || !sessions) return null;
    return sessions.find((s) => s.id_session_crawl === openSessionId) ?? null;
  }, [openSessionId, sessions]);
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa phiên cào này và TẤT CẢ các bài viết trong phiên?")) return;
    setDeletingId(sessionId);
    try {
      const res = await linkedInCrawlService.deleteSession(sessionId);
      if (res.success) {
        if (refreshSessionsAfterReaction) {
          await refreshSessionsAfterReaction();
        }
      } else {
        alert(res.message || "Xóa thất bại");
      }
    } catch (e) {
      alert("Lỗi khi xóa phiên cào");
    } finally {
      setDeletingId(null);
    }
  };

  const isFiltered = tableVariant === "filtered";
  const colCount = isFiltered ? 6 : 5;

  const loading = busy && sessions === null;
  const loadedEmpty = !busy && sessions !== null && sessions.length === 0;
  const hasRows = !busy && sessions !== null && sessions.length > 0;
  const refreshingWithRows = busy && sessions !== null && sessions.length > 0;
  const totalRows = sessions?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paginatedSessions = useMemo(
    () => (sessions ?? []).slice(pageStart, pageStart + PAGE_SIZE),
    [sessions, pageStart],
  );

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs font-sans">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-slate-500 font-bold px-4 py-3.5 uppercase tracking-wider">
                Phiên cào
              </th>
              <th className="text-slate-500 font-bold px-4 py-3.5 uppercase tracking-wider">
                Email crawl
              </th>
              <th className="text-slate-500 font-bold px-4 py-3.5 text-right uppercase tracking-wider">
                Số nhóm / bài
              </th>
              <th className="text-slate-500 font-bold px-4 py-3.5 uppercase tracking-wider">
                Ngày (gần nhất)
              </th>
              {isFiltered ? (
                <th className="text-slate-500 font-bold max-w-[200px] px-4 py-3.5 uppercase tracking-wider">
                  Ngày / điều kiện lọc
                </th>
              ) : null}
              <th className="text-slate-500 font-bold px-4 py-3.5 text-right uppercase tracking-wider">
                Hành động
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="text-slate-500 px-4 py-8 text-center font-medium text-sm"
                >
                  {loadingHint}
                </td>
              </tr>
            ) : null}

            {loadedEmpty ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="text-slate-500 px-4 py-8 text-center font-medium text-sm"
                >
                  {emptyHint}
                </td>
              </tr>
            ) : null}

            {(hasRows || refreshingWithRows) &&
              paginatedSessions.map((row, rowIdx) => (
                <tr
                  key={`${row.id_session_crawl}-${pageStart + rowIdx}`}
                  className={`hover:bg-slate-50/50 transition-colors ${
                    refreshingWithRows ? "opacity-70" : ""
                  }`}
                >
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => setOpenSessionId(row.id_session_crawl)}
                      className="text-[#E3000F] hover:text-[#C40009] hover:underline text-left font-mono font-bold text-xs"
                      title={row.id_session_crawl}
                    >
                      {shortenSessionId(row.id_session_crawl)}
                    </button>
                  </td>
                  <td className="text-slate-700 font-semibold max-w-[200px] px-4 py-3.5 break-all text-sm">
                    {row.email_crawl || "—"}
                  </td>
                  <td className="text-slate-700 font-bold px-4 py-3.5 text-right tabular-nums text-sm">
                    {row.posts_count.toLocaleString("vi-VN")}
                  </td>
                  <td className="text-slate-500 px-4 py-3.5 whitespace-nowrap text-sm">
                    {sessionLatestDateLabel(row)}
                  </td>
                  {isFiltered ? (
                    <td className="text-slate-500 max-w-[220px] px-4 py-3.5 text-xs break-words font-medium">
                      {filterAppliedLabel || "—"}
                    </td>
                  ) : null}
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenSessionId(row.id_session_crawl)}
                        className="text-[#E3000F] hover:bg-[#F5F5F5] rounded-lg p-1.5 transition cursor-pointer"
                        title="Xem chi tiết"
                      >
                        <MaterialIcon name="visibility" className="text-base" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSession(row.id_session_crawl)}
                        disabled={deletingId === row.id_session_crawl}
                        className="text-[#FF3344] hover:bg-red-50 rounded-lg p-1.5 transition cursor-pointer disabled:opacity-50"
                        title="Xóa phiên"
                      >
                        {deletingId === row.id_session_crawl ? (
                          <div className="w-4 h-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />
                        ) : (
                          <MaterialIcon name="delete" className="text-base" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

            {!loading && !loadedEmpty && !hasRows && !refreshingWithRows ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="text-slate-500 px-4 py-8 text-center font-medium text-sm"
                >
                  {emptyHint}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {hasRows || refreshingWithRows ? (
        <div className="text-xs text-slate-500 mt-4 flex items-center justify-between gap-4 font-sans font-medium">
          <span>
            Hiển thị {pageStart + 1}–
            {Math.min(pageStart + PAGE_SIZE, totalRows)} / {totalRows} phiên
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="hover:bg-slate-100 rounded-lg p-2 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Trang trước"
            >
              ‹
            </button>
            <span className="text-slate-800 px-3 font-bold text-sm">
              {safePage}/{totalPages}
            </span>
            <button
              type="button"
              className="hover:bg-slate-100 rounded-lg p-2 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Trang sau"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

      <SessionPostsModal
        session={open}
        titleSuffix={modalTitleSuffix}
        dashboardEmail={dashboardEmail}
        linkedinPlaywrightSessionId={linkedinPlaywrightSessionId}
        onRefreshSessions={refreshSessionsAfterReaction}
        refreshSessionsBusy={refreshSessionsBusy}
        onClose={() => setOpenSessionId(null)}
      />
    </>
  );
}
