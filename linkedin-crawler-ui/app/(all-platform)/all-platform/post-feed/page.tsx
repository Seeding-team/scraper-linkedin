"use client";

import React, { Suspense } from "react";
import { UnifiedDashboardHomeContent } from "@/components/features/dashboard/UnifiedDashboardHomeContent";

export default function AllPlatformPostFeedPage() {
  return (
    <div className="min-h-screen bg-slate-50/50 p-4 md:p-6 space-y-6">
      <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">Đang tải Hoạt động Seeding...</div>}>
        <UnifiedDashboardHomeContent />
      </Suspense>
    </div>
  );
}
