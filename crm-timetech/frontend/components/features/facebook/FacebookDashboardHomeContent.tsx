"use client";

import { DashboardPosts } from "@/components/facebook-crawler/modules/facebook-crawl/components/dashboard-post";

export function FacebookDashboardHomeContent({ hideHeader }: { hideHeader?: boolean }) {
  return (
    <>
      {!hideHeader && (
        <div className="mb-xl">
          <h1 className="text-h1 text-on-surface mb-xs font-semibold">Post Feed</h1>
          <p className="text-body-lg text-on-surface-variant">
            Bài viết đã crawl từ các nhóm Facebook — phiên cào, điểm và tương tác theo sheet.
          </p>
        </div>
      )}
      <DashboardPosts forcedPlatform="facebook" />
    </>
  );
}
