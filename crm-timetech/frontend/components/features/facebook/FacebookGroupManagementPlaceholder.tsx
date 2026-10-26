"use client";

import { DashboardGroups } from "@/components/facebook-crawler/modules/facebook-crawl/components/dashboard-groups";

export function FacebookGroupManagementPlaceholder() {
  return (
    <>
      <div className="mb-lg flex flex-wrap items-end justify-between gap-md">
        <div>
          <h1 className="text-h1 text-on-surface font-semibold">Groups</h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            Quản lý và phân loại nhóm Facebook (taxonomy, health, crawl).
          </p>
        </div>
      </div>
      <DashboardGroups forcedPlatform="facebook" />
    </>
  );
}
