"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CrawlScheduleHistoryPanel } from "@/components/all-platform/crawl-schedule-history-panel";
import { CrawlQueueMonitor } from "@/components/all-platform/crawl-queue-monitor";
import { Public4GCrawlerPanel } from "@/components/all-platform/components/public-crawler/Public4GCrawlerPanel";
import { Public4GCrawledPostsPanel } from "@/components/all-platform/components/public-crawler/Public4GCrawledPostsPanel";
import { MultiPlatformAndEaaPanel } from "@/components/all-platform/components/public-crawler/MultiPlatformAndEaaPanel";
import { cn } from "@/lib/utils";

type TabKey = "public-4g" | "multi-platform-eaa" | "crawled-posts" | "history" | "queue";

function parseTabParam(raw: string | null): TabKey {
  if (raw === "crawled-posts" || raw === "posts") {
    return "crawled-posts";
  }
  if (raw === "multi-platform-eaa" || raw === "eaa" || raw === "instagram" || raw === "linkedin") {
    return "multi-platform-eaa";
  }
  if (raw === "history" || raw === "queue" || raw === "public-4g") {
    return raw;
  }
  return "public-4g";
}

function LichCaoHangDoiInner() {
  const searchParams = useSearchParams();
  const [selectedTab, setSelectedTab] = useState<TabKey | null>(null);
  const activeTab = selectedTab ?? parseTabParam(searchParams.get("tab"));

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-6">
      {/* Header riêng biệt của trang */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[28px] text-[#be123c]">public</span>
            Trung tâm Cào Public 4G (No-Acc) &amp; Giám sát VPS
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Cào nhanh bài viết tự động không cần tài khoản đa nền tảng (Facebook - Threads - LinkedIn) qua Mobile Proxy 4G và giám sát hàng đợi VPS.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl border border-gray-200">
          <button
            type="button"
            onClick={() => setSelectedTab("public-4g")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5",
              activeTab === "public-4g"
                ? "bg-white text-emerald-700 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">public</span>
            Cào Public 4G (Không Acc)
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("multi-platform-eaa")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5",
              activeTab === "multi-platform-eaa"
                ? "bg-white text-indigo-700 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">vpn_key</span>
            Đa nền tảng (IG · LI) &amp; EAA Token
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("crawled-posts")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5",
              activeTab === "crawled-posts"
                ? "bg-white text-sky-700 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">fact_check</span>
            Bài viết cào được
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("history")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5",
              activeTab === "history"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">history</span>
            Lịch sử cào từ lịch
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("queue")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5",
              activeTab === "queue"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">dns</span>
            Giám sát hàng đợi VPS
          </button>
        </div>
      </div>

      {/* Nội dung chuyên biệt theo tab */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs">
        {activeTab === "public-4g" ? (
          <Public4GCrawlerPanel />
        ) : activeTab === "multi-platform-eaa" ? (
          <MultiPlatformAndEaaPanel />
        ) : activeTab === "crawled-posts" ? (
          <Public4GCrawledPostsPanel />
        ) : activeTab === "history" ? (
          <CrawlScheduleHistoryPanel />
        ) : (
          <CrawlQueueMonitor />
        )}
      </div>
    </div>
  );
}

export default function LichCaoHangDoiPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Đang tải trung tâm cào...</div>}>
      <LichCaoHangDoiInner />
    </Suspense>
  );
}
