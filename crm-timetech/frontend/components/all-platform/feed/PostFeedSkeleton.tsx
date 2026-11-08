"use client";

/**
 * Phase 6: Loading skeleton for the unified post feed.
 * Renders a pulse-animated placeholder matching the StatCard layout + PostCard layout.
 * Used while `isLoadingPosts` is true.
 */

export function PostFeedSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* 15 skeleton PostCards */}
      {Array.from({ length: 15 }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  );
}

function PostCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-4 flex gap-4 items-start">
      {/* AI Score box */}
      <div className="w-[60px] h-[60px] rounded-xl bg-slate-100 shrink-0" />

      {/* Content */}
      <div className="flex-1 flex flex-col gap-3">
        {/* Header badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-4 w-24 rounded bg-slate-100" />
          <div className="h-3 w-16 rounded bg-purple-50" />
          <div className="h-3 w-20 rounded bg-indigo-50" />
        </div>

        {/* Content text */}
        <div className="space-y-1.5">
          <div className="h-3 w-full rounded bg-slate-50" />
          <div className="h-3 w-4/5 rounded bg-slate-50" />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2.5 flex-wrap pt-1">
          <div className="h-5 w-16 rounded bg-amber-50" />
          <div className="h-5 w-14 rounded bg-slate-100" />
          <div className="h-5 w-14 rounded bg-blue-50" />
          <div className="ml-auto h-7 w-24 rounded-lg bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

export function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-white border border-slate-100 p-4 rounded-xl flex flex-col justify-between h-[88px]"
        >
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="h-2 w-16 rounded bg-slate-100" />
              <div className="h-5 w-12 rounded bg-slate-100 mt-1" />
            </div>
            <div className="w-9 h-9 rounded-xl bg-slate-100 shrink-0" />
          </div>
          <div className="mt-4 pt-3 border-t border-slate-50">
            <div className="h-1.5 w-full rounded-full bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}