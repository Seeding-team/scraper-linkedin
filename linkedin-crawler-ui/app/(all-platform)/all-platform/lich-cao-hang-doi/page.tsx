"use client";

import React from "react";
import { RotationCrawlPanel } from "@/components/all-platform/components/seeding-extension/rotation-crawl-panel";
import { CrawlQueueMonitor } from "@/components/all-platform/crawl-queue-monitor";

export default function LichCaoHangDoiPage() {
  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-8">
      {/* Header riêng biệt của trang */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[28px] text-[#be123c]">schedule</span>
          Lịch cào xoay vòng &amp; Hàng đợi
        </h1>
        <p className="text-xs text-gray-500 mt-1 font-medium">
          Thiết lập lịch cào tự động đa nền tảng (Facebook - LinkedIn - Threads) và giám sát trạng thái hàng đợi cào hệ thống.
        </p>
      </div>

      {/* Khối 1: Lịch cào xoay vòng */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
          <span className="material-symbols-outlined text-[20px] text-[#be123c]">autorenew</span>
          <h2 className="text-base font-bold text-gray-900">Lịch cào xoay vòng tự động</h2>
        </div>
        <RotationCrawlPanel />
      </div>

      {/* Khối 2: Giám sát hàng đợi VPS */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
          <span className="material-symbols-outlined text-[20px] text-blue-600">dns</span>
          <h2 className="text-base font-bold text-gray-900">Giám sát hàng đợi cào VPS</h2>
        </div>
        <CrawlQueueMonitor />
      </div>
    </div>
  );
}
