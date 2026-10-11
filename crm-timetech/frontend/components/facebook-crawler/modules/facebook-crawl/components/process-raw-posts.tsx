"use client";

import { GroupSummaryType } from "../types/crawl-fb.type";
import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { formatRelativeCrawl } from "@/lib/group-taxonomy";
import { cn } from "@/lib/utils";

function scoreTone(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 40) return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: MaterialSymbolName;
  label: string;
  value: number;
}) {
  return (
    <div className="border-outline-variant/80 bg-surface-container-low flex items-center gap-sm rounded-lg border px-sm py-xs">
      <MaterialIcon name={icon} className="text-primary shrink-0 text-[18px]" />
      <div className="min-w-0">
        <p className="text-on-surface text-sm font-bold tabular-nums">{value}</p>
        <p className="text-on-surface-variant text-[10px] uppercase tracking-wide">
          {label}
        </p>
      </div>
    </div>
  );
}

function GroupCrawlCard({ group }: { group: GroupSummaryType }) {
  const post = group.hot_post;

  if (!post) {
    return (
      <article className="border-outline-variant bg-surface-container-low/40 flex flex-col rounded-xl border border-dashed p-lg">
        <div className="flex items-start gap-md">
          <span className="bg-surface-container text-on-surface-variant flex size-10 shrink-0 items-center justify-center rounded-lg">
            <MaterialIcon name="group" className="text-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-on-surface line-clamp-2 font-semibold">
              {group.group_name || "Nhóm không tên"}
            </h3>
            <p className="text-on-surface-variant mt-xs text-body-sm">
              Không có bài viết nổi bật trong 24h gần nhất
            </p>
            <p className="text-on-surface-variant mt-sm text-xs">
              Tổng bài quét:{" "}
              <span className="text-on-surface font-semibold tabular-nums">
                {group.total_posts_24h ?? 0}
              </span>
            </p>
          </div>
        </div>
      </article>
    );
  }

  const dateLabel = formatRelativeCrawl(post.date);
  const hasImages = Boolean(post.images?.length);
  const hasVideo = Boolean(post.media_url?.trim());

  return (
    <article className="border-outline-variant bg-surface flex flex-col overflow-hidden rounded-xl border shadow-sm">
      <header className="border-outline-variant bg-surface-container-low/50 border-b px-md py-md">
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0 flex-1">
            <p className="text-label-md text-on-surface-variant uppercase tracking-wide">
              Nhóm
            </p>
            <h3 className="text-on-surface mt-xs line-clamp-2 text-base font-bold">
              {group.group_name || post.group_name}
            </h3>
            <div className="text-on-surface-variant mt-sm flex flex-wrap items-center gap-sm text-xs">
              <span className="inline-flex items-center gap-1">
                <MaterialIcon name="history" className="text-[14px]" />
                {dateLabel !== "—" ? dateLabel : post.date || "—"}
              </span>
              <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">
                {group.total_posts_24h ?? 0} bài / 24h
              </span>
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-lg border px-sm py-xs text-xs font-bold tabular-nums",
              scoreTone(post.score ?? 0),
            )}
          >
            Điểm {post.score ?? 0}
          </span>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-md p-md">
        {post.content?.trim() ? (
          <p className="text-on-surface text-body-sm leading-relaxed line-clamp-6">
            {post.content}
          </p>
        ) : (
          <p className="text-on-surface-variant text-body-sm italic">
            Không trích được nội dung bài viết.
          </p>
        )}

        <div className="grid grid-cols-3 gap-sm">
          <StatPill icon="thumb_up" label="Like" value={post.reactions ?? 0} />
          <StatPill icon="chat_bubble" label="Comment" value={post.comments ?? 0} />
          <StatPill icon="share" label="Share" value={post.shares ?? 0} />
        </div>

        {(hasVideo || hasImages) && (
          <div className="border-outline-variant bg-surface-container-low/30 space-y-sm rounded-lg border p-sm">
            {hasVideo ? (
              <div>
                <p className="text-label-md text-on-surface-variant mb-xs font-semibold uppercase">
                  Video / media
                </p>
                <a
                  href={post.media_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary break-all text-xs font-medium hover:underline"
                >
                  {post.media_url}
                </a>
              </div>
            ) : null}
            {hasImages ? (
              <div>
                <p className="text-label-md text-on-surface-variant mb-xs font-semibold uppercase">
                  Ảnh ({post.images!.length})
                </p>
                <div className="flex flex-wrap gap-sm">
                  {post.images!.slice(0, 6).map((img, i) => (
                    <a
                      key={`${img}-${i}`}
                      href={img}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-outline-variant block overflow-hidden rounded-lg border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img}
                        alt=""
                        className="size-16 object-cover sm:size-20"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {post.url ? (
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-on-primary hover:bg-primary-container mt-auto inline-flex items-center justify-center gap-sm rounded-lg py-sm text-sm font-bold transition-colors"
          >
            <MaterialIcon name="open_in_new" className="text-[18px]" />
            Xem bài viết trên Facebook
          </a>
        ) : null}
      </div>
    </article>
  );
}

export default function FacebookPosts({
  mockPosts,
}: {
  mockPosts: GroupSummaryType[];
}) {
  const withPost = mockPosts.filter((g) => g.hot_post).length;
  const empty = mockPosts.length - withPost;

  return (
    <section className="border-outline-variant bg-surface-container-lowest mt-xl overflow-hidden rounded-xl border">
      <div className="border-outline-variant bg-surface-container-low/60 flex flex-col gap-sm border-b px-lg py-md sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-h2 text-on-surface font-semibold">Kết quả crawl Facebook</h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            {mockPosts.length} nhóm · {withPost} có bài nổi bật · {empty} không có bài
          </p>
        </div>
      </div>

      <div className="grid gap-md p-md md:grid-cols-2">
        {mockPosts.map((group, index) => (
          <GroupCrawlCard key={`${group.group_name}-${index}`} group={group} />
        ))}
      </div>
    </section>
  );
}
