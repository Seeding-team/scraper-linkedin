"use client";

import { useState } from "react";
import { useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { FacebookDashboardHomeContent } from "@/components/features/facebook/FacebookDashboardHomeContent";
import { LinkedInDashboardHomeContent } from "@/components/features/linkedin/dashboard";
import { UnifiedDashboardHomeContent } from "@/components/features/dashboard/UnifiedDashboardHomeContent";
import { CrawlLinkedInPopup } from "@/components/all-platform/crawl-linkedin-popup";
import { CrawlFacebookPopup } from "@/components/all-platform/crawl-facebook-popup";
import { MaterialIcon } from "@/components/ui";

export function DashboardHomeContent() {
  const { platform } = useAppPlatform();
  const [showFacebookCrawl, setShowFacebookCrawl] = useState(false);
  const [showLinkedInCrawl, setShowLinkedInCrawl] = useState(false);

  // Cấu hình tiêu đề theo nền tảng
  let title = "Unified Post Feed";
  let subtitle = "";

  if (platform === "linkedin") {
    title = "LinkedIn Group Crawler";
    subtitle = "Thu thập và phân tích dữ liệu từ nhiều nhóm LinkedIn một cách hiệu quả.";
  } else if (platform === "facebook") {
    title = "Facebook Post Feed";
    subtitle = "Bài viết đã cào từ các nhóm Facebook — phiên cào, điểm và tương tác theo sheet.";
  }

  return (
    <div className="w-full space-y-lg">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-md mb-xl">
        <div className="space-y-xs">
          <h1 className="text-h1 text-on-surface font-semibold">
            {title}
          </h1>
          <p className="text-body-lg text-on-surface-variant max-w-3xl">
            {subtitle}
          </p>
        </div>
        <button
          onClick={() => {
            if (platform === "linkedin") setShowLinkedInCrawl(true);
            else setShowFacebookCrawl(true);
          }}
          className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm text-sm font-bold text-on-primary shadow-md transition-all hover:bg-primary-container active:scale-[0.98] cursor-pointer shrink-0 w-fit"
        >
          <MaterialIcon name="file_download" className="text-[18px]" />
          Cào dữ liệu
        </button>
      </div>

      {/* RENDER CONTENT */}
      {platform === "linkedin" && <LinkedInDashboardHomeContent hideHeader={true} />}
      {platform === "facebook" && <FacebookDashboardHomeContent hideHeader={true} />}
      {platform === "general" && <UnifiedDashboardHomeContent hideHeader={true} />}

      {/* CRAWL MODALS */}
      <CrawlLinkedInPopup
        open={showLinkedInCrawl}
        onClose={() => setShowLinkedInCrawl(false)}
        onSuccess={() => setShowLinkedInCrawl(false)}
      />
      <CrawlFacebookPopup
        open={showFacebookCrawl}
        onClose={() => setShowFacebookCrawl(false)}
        onSuccess={() => setShowFacebookCrawl(false)}
      />
    </div>
  );
}

