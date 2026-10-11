"use client";

import CombinedCrawlForm from "@/components/facebook-crawler/modules/facebook-crawl/components/combined-crawl-form";

export default function CrawlDataPage() {
  return <CombinedCrawlForm onSuccess={() => window.location.href = "/"} />;
}
