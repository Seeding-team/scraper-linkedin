"use client";

import React, { useState } from "react";
import { RotationCrawlPanel } from "@/components/all-platform/components/seeding-extension/rotation-crawl-panel";
import { CrawlQueueMonitor } from "@/components/all-platform/crawl-queue-monitor";
import { cn } from "@/lib/utils";

export default function LichCaoHangDoiPage() {
  const [activeTab, setActiveTab] = useState<"schedule" | "queue">("schedule");

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-6">
      {/* Header riêng biệt của trang */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[28px] text-[#be123c]">schedule</span>
            Lịch cào xoay vòng &amp; Hàng đợi
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Thiết lập lịch cào tự động đa nền tảng (Facebook - LinkedIn - Threads) và giám sát trạng thái hàng đợi cào hệ thống.
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl border border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab("schedule")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5",
              activeTab === "schedule"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">autorenew</span>
            Lịch cào xoay vòng
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("queue")}
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

      {/* Nội dung chuyên biệt */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs">
        {activeTab === "schedule" ? <RotationCrawlPanel /> : <CrawlQueueMonitor />}
      </div>
    </div>
  );
}

