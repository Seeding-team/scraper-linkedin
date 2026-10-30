"use client";

import React from "react";
import { SeedingAccountsOverview } from "@/components/all-platform/seeding-accounts-overview";

export default function ThongKeTaiKhoanPage() {
  return (
    <div className="min-h-screen bg-slate-50/50 p-6 md:p-8 space-y-6">
      {/* Header riêng biệt của trang */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[28px] text-[#be123c]">manage_accounts</span>
            Thống kê tài khoản Seeding
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Theo dõi các tài khoản mạng xã hội dùng để cào bài của các thành viên trong team và lịch sử cào.
          </p>
        </div>
      </div>

      {/* Nội dung chuyên biệt */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-xs">
        <SeedingAccountsOverview />
      </div>
    </div>
  );
}

