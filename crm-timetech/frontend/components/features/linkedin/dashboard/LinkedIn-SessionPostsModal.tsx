"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MaterialIcon } from "@/components/ui";
import { useLinkedInEngagementQueue } from "@/components/features/linkedin/dashboard/linkedin-engagement-queue-context";
import type { CrawlSessionGroup } from "@/types/api";

import {} from "@/components/features/linkedin/dashboard/LinkedIn-post-sheet-engagement";
import { SheetCommentStatus } from "@/components/features/linkedin/dashboard/LinkedIn-SheetCommentStatus";
import { SheetInteractionStatus } from "@/components/features/linkedin/dashboard/LinkedIn-SheetInteractionStatus";
import {
  enrichPostRowNumberIfMissing,
  pickNum,
  pickPostUrlFromRecord,
  pickPositiveRowNumberFromPost,
  pickStr,
  postsShareSameLinkedInUrl,
  getPostCrawlError,
} from "@/components/features/linkedin/dashboard/LinkedIn-n8n-sheet-helpers";
import { SessionPostDetailModal } from "@/components/features/linkedin/dashboard/LinkedIn-SessionPostDetailModal";
import { useGroupIntentMap } from "@/hooks/useGroupIntentMap";

/** Badge màu cho intent — đồng bộ style với Facebook DashboardPosts. */
function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent)
    return <span className="text-on-surface-variant text-[10px] italic">—</span>;
  return (
    <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 whitespace-nowrap">
      {intent}
    </span>
  );
}

function rowPatchKey(sessionId: string, rowNum: number): string {
  return `${sessionId}:${rowNum}`;
}

export interface SessionPostsModalProps {
  session: CrawlSessionGroup | null;
  titleSuffix?: string;
  onClose: () => void;
  dashboardEmail?: string | null;
  linkedinPlaywrightSessionId?: string | null;
  /** @deprecated Refresh qua LinkedInEngagementQueueProvider. */
  onRefreshSessions?: () => Promise<void>;
  refreshSessionsBusy?: boolean;
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  const ok = /^https?:\/\//i.test(href);
  if (!ok)
    return <span className="text-on-surface-variant break-all">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline break-all"
    >
      {children}
    </a>
  );
}

export function SessionPostsModal({
  session,
  titleSuffix = "",
  onClose,
  dashboardEmail = null,
  linkedinPlaywrightSessionId = null,
  onRefreshSessions,
  refreshSessionsBusy = false,
}: SessionPostsModalProps) {
  // Tra cứu intent từ presetGroups theo group_url của mỗi post
  const { getIntent } = useGroupIntentMap(dashboardEmail);
  const PAGE_SIZE = 8;
  const { pendingCount } = useLinkedInEngagementQueue();
  const [page, setPage] = useState(1);
  const [detailPost, setDetailPost] = useState<{
    raw: Record<string, unknown>;
    rowNum: number;
  } | null>(null);
  const [postPatches, setPostPatches] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const posts = useMemo(() => session?.posts ?? [], [session]);

  useEffect(() => {
    setPostPatches({});
    setDetailPost(null);
    setPage(1);
  }, [session?.id_session_crawl]);

  const mergedPost = useCallback(
    (raw: Record<string, unknown>, rowNum: number): Record<string, unknown> => {
      const sid = session?.id_session_crawl ?? "";
      const patch = postPatches[rowPatchKey(sid, rowNum)];
      const base = patch ? { ...raw, ...patch } : raw;
      return enrichPostRowNumberIfMissing(base, rowNum);
    },
    [postPatches, session?.id_session_crawl],
  );

  const failedPosts = useMemo(() => {
    return posts
      .map((raw, idx) => {
        const rowNum = idx + 1;
        const post = mergedPost(raw as Record<string, unknown>, rowNum);
        const err = getPostCrawlError(post);
        return err ? { post, rowNum, error: err } : null;
      })
      .filter(Boolean) as Array<{
      post: Record<string, unknown>;
      rowNum: number;
      error: string;
    }>;
  }, [posts, mergedPost]);

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailPost) setDetailPost(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, detailPost, onClose]);

  const totalPosts = posts.length;
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paginatedPosts = useMemo(
    () => posts.slice(pageStart, pageStart + PAGE_SIZE),
    [posts, pageStart],
  );
  if (!session) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-md sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Đóng"
        onClick={onClose}
      />
      <div
        className="bg-white relative z-10 flex max-h-[min(90vh,880px)] w-full max-w-6xl flex-col rounded-2xl border border-slate-100 shadow-2xl font-sans"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-modal-title"
      >
        <div className="border-b border-slate-100 flex shrink-0 items-start justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="session-modal-title"
                className="text-lg font-bold text-slate-800"
              >
                Chi tiết phiên cào
                {titleSuffix ? (
                  <span className="text-slate-500 font-normal">
                    {" "}
                    {titleSuffix}
                  </span>
                ) : null}
              </h3>
              {pendingCount > 0 ? (
                <span
                  className="bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                  title="Playwright và webhook đang xử lý tuần tự ở chế độ nền (vẫn chạy khi đóng modal)"
                >
                  <MaterialIcon
                    name="sync"
                    className="text-[14px] animate-spin"
                  />
                  Nền: {pendingCount} tác vụ
                </span>
              ) : null}
            </div>
            <p className="text-xs text-slate-400 mt-1 break-all font-mono">
              {session.id_session_crawl}
            </p>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              Email:{" "}
              <span className="text-slate-700 font-semibold">
                {session.email_crawl || "—"}
              </span>
              {" · "}
              <span className="text-slate-700 font-semibold">
                {session.posts_count.toLocaleString("vi-VN")}
              </span>{" "}
              nhóm / bài trong phiên
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg p-2 transition-colors"
            aria-label="Đóng hộp thoại"
          >
            <MaterialIcon name="close" className="text-[22px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {failedPosts.length > 0 ? (
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
              <div className="flex items-start gap-2">
                <MaterialIcon
                  name="error"
                  className="text-red-500 text-[20px] shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm">
                    Phát hiện bài viết bị lỗi trong phiên cào này
                  </h4>
                  <p className="text-xs mt-1 text-red-600 leading-relaxed">
                    Có {failedPosts.length} bài viết xảy ra lỗi trong quá trình
                    thu thập thông tin. Bạn có thể xem trực tiếp chi tiết.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 pl-[28px]">
                {failedPosts.map((fp) => (
                  <button
                    key={fp.rowNum}
                    type="button"
                    onClick={() =>
                      setDetailPost({ raw: fp.post, rowNum: fp.rowNum })
                    }
                    className="bg-red-100 hover:bg-red-200 border border-red-200 text-red-700 font-bold py-1 px-3 rounded-lg text-xs flex items-center gap-1 transition-all"
                  >
                    <MaterialIcon name="open_in_new" className="text-[14px]" />
                    Xem bài {fp.rowNum} bị lỗi
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm bg-white">
            <table className="w-full min-w-[960px] border-collapse text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-slate-500 font-bold px-4 py-3 uppercase tracking-wider">
                    #
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 uppercase tracking-wider">
                    Nhóm
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 uppercase tracking-wider">
                    Link nhóm
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 uppercase tracking-wider">
                    Link bài
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 uppercase tracking-wider">
                    Tác giả
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 uppercase tracking-wider">
                    Intent
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 text-right uppercase tracking-wider">
                    Like
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 text-right uppercase tracking-wider">
                    CMT
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 text-right uppercase tracking-wider">
                    Điểm
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 uppercase tracking-wider">
                    Ngày
                  </th>
                  <th className="text-slate-500 font-bold px-4 py-3 text-right uppercase tracking-wider">
                    Chi tiết
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedPosts.map((raw, idx) => {
                  const rowNum = pageStart + idx + 1;
                  const post = mergedPost(raw as Record<string, unknown>, rowNum);
                  const groupName = pickStr(post, [
                    "Tên nhóm",
                    "group_name",
                    "groupName",
                  ]);
                  const groupUrl = pickStr(post, [
                    "URL_Nhóm",
                    "URL_nhom",
                    "group_url",
                    "groupUrl",
                  ]);
                  const postUrl = pickStr(post, [
                    "URL_Bài_Viết",
                    "post_url",
                    "postUrl",
                  ]);
                  const author = pickStr(post, ["Tác giả", "author"]);
                  // Tra intent từ presetGroups theo group_url — fallback sang field "intent" trong post
                  const intentFromGroup = getIntent(groupUrl);
                  const intentFromPost = pickStr(post, ["intent", "Intent", "loại"]);
                  const resolvedIntent = intentFromGroup || intentFromPost || null;
                  const likes = pickNum(post, ["Số like", "likes"]);
                  const comments = pickNum(post, ["Số comment", "comments"]);
                  const score = pickNum(post, ["Điểm", "score", "Score"]);
                  const day = pickStr(post, ["Ngày", "date"]).slice(0, 10);
                  const err = getPostCrawlError(post);
                  const isFailed = Boolean(err);
                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-slate-50/50 transition-colors ${
                        isFailed
                          ? "bg-red-50 hover:bg-red-100/70 text-red-900"
                          : ""
                      }`}
                    >
                      <td className="text-slate-400 font-semibold px-4 py-3 text-sm">
                        <div className="flex items-center gap-1">
                          {rowNum}
                          {isFailed ? (
                            <span
                              className="text-red-500 cursor-help shrink-0"
                              title={`Lỗi cào: ${err}`}
                            >
                              <MaterialIcon
                                name="error"
                                className="text-[16px]"
                              />
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-slate-700 font-semibold max-w-[140px] px-4 py-3 text-sm">
                        <span className="line-clamp-2" title={groupName}>
                          {groupName || "—"}
                        </span>
                      </td>
                      <td className="max-w-[140px] px-4 py-3 align-top text-sm">
                        {groupUrl ? (
                          <ExternalLink href={groupUrl}>Mở</ExternalLink>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="max-w-[140px] px-4 py-3 align-top text-sm">
                        {postUrl ? (
                          <ExternalLink href={postUrl}>Mở</ExternalLink>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-slate-700 font-semibold max-w-[120px] px-4 py-3 text-sm">
                        <span className="line-clamp-2" title={author}>
                          {author || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <IntentBadge intent={resolvedIntent} />
                      </td>
                      <td className="text-slate-700 font-bold px-4 py-3 text-right tabular-nums text-sm">
                        {likes.toLocaleString("vi-VN")}
                      </td>
                      <td className="text-slate-700 font-bold px-4 py-3 text-right tabular-nums text-sm">
                        {comments.toLocaleString("vi-VN")}
                      </td>
                      <td className="text-slate-700 font-bold px-4 py-3 text-right tabular-nums text-sm">
                        {score.toLocaleString("vi-VN")}
                      </td>
                      <td className="text-slate-500 px-4 py-3 whitespace-nowrap text-sm">
                        {day || "—"}
                      </td>
                      <td className="max-w-[200px] px-4 py-3 text-right align-middle text-sm">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <SheetInteractionStatus
                            post={post}
                            variant="table"
                            className="max-w-[92px]"
                          />
                          <SheetCommentStatus
                            post={post}
                            variant="table"
                            className="max-w-[92px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setDetailPost({
                                raw: post,
                                rowNum,
                              })
                            }
                            className="border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition duration-150 shadow-sm"
                          >
                            <MaterialIcon
                              name="visibility"
                              className="text-[16px]"
                            />
                            Xem chi tiết
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-slate-500 mt-4 flex items-center justify-between gap-4 font-sans font-medium">
            <span>
              Hiển thị {pageStart + 1}–
              {Math.min(pageStart + PAGE_SIZE, totalPosts)} / {totalPosts} bài
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="hover:bg-slate-100 rounded-lg p-2 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                aria-label="Trang trước"
              >
                <MaterialIcon name="chevron_left" />
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
                <MaterialIcon name="chevron_right" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {detailPost ? (
        <SessionPostDetailModal
          session={session}
          post={detailPost.raw}
          rowNumber={detailPost.rowNum}
          titleSuffix={titleSuffix}
          dashboardEmail={dashboardEmail}
          linkedinPlaywrightSessionId={linkedinPlaywrightSessionId}
          refreshSessionsBusy={refreshSessionsBusy}
          onRefreshSessions={onRefreshSessions}
          onReactionSucceeded={(rowNum, patch, postUrlForSync) => {
            const sid = session.id_session_crawl;
            const targetUrl = (postUrlForSync || "").trim();
            setPostPatches((prev) => {
              const next = { ...prev };
              posts.forEach((raw, idx) => {
                const ordinal = idx + 1;
                const row =
                  pickPositiveRowNumberFromPost(raw) ?? ordinal;
                const url = pickPostUrlFromRecord(raw);
                const matchesRow = row === rowNum;
                const matchesUrl =
                  targetUrl && url
                    ? postsShareSameLinkedInUrl(url, targetUrl)
                    : false;
                if (!matchesRow && !matchesUrl) return;
                const key = rowPatchKey(sid, row);
                next[key] = { ...next[key], ...patch };
              });
              return next;
            });
            setDetailPost((d) => {
              if (!d) return d;
              const url = pickPostUrlFromRecord(d.raw);
              const matchesRow = d.rowNum === rowNum;
              const matchesUrl =
                targetUrl && url
                  ? postsShareSameLinkedInUrl(url, targetUrl)
                  : false;
              if (!matchesRow && !matchesUrl) return d;
              return { ...d, raw: { ...d.raw, ...patch } };
            });
          }}
          onClose={() => setDetailPost(null)}
        />
      ) : null}
    </div>
  );
}
