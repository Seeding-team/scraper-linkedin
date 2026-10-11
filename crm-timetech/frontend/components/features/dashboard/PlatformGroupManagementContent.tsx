"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { FacebookGroupManagementPlaceholder } from "@/components/features/facebook/FacebookGroupManagementPlaceholder";
import { LinkedInGroupManagementPageContent } from "@/components/features/linkedin/group-management";
import { DashboardGroups } from "@/components/facebook-crawler/modules/facebook-crawl/components/dashboard-groups";

export function PlatformGroupManagementContent() {
  const { platform } = useAppPlatform();
  const d = useDashboard();
  const router = useRouter();

  useEffect(() => {
    if (platform === "linkedin" && d.role === "leader") {
      router.replace("/admin/team");
    }
  }, [platform, d.role, router]);

  if (platform === "linkedin" && d.role === "leader") {
    return (
      <div className="text-on-surface-variant flex min-h-[50vh] flex-col items-center justify-center gap-md">
        <div className="border-primary h-10 w-10 animate-spin rounded-full border-2 border-t-transparent" />
        <p className="text-body-md font-medium">Đang chuyển đến Quản lý đội ngũ…</p>
      </div>
    );
  }

  if (platform === "linkedin") {
    return <LinkedInGroupManagementPageContent />;
  }

  if (platform === "facebook") {
    return <FacebookGroupManagementPlaceholder />;
  }

  return (
    <>
      <div className="mb-lg">
        <h1 className="text-h1 text-on-surface font-semibold">Groups</h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          Tất cả nhóm Facebook và LinkedIn — lọc theo nền tảng và taxonomy.
        </p>
      </div>
      <DashboardGroups />
    </>
  );
}
