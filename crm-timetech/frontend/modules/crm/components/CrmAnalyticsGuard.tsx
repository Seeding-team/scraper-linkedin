"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { AnalyticsView } from "./AnalyticsView";
import { hasFullCrmAccess } from "../constants/crmConfig";

/**
 * Trang "/crm/analytics" ("Kết quả cuối cùng") trước đây KHÔNG có guard thật —
 * chỉ ẩn link sidebar cho non-leader/admin, ai gõ thẳng URL vẫn xem được.
 * Chỉ admin/leader/Sale (team_type='sale', migration 049) được xem — member
 * thường bị đưa về Pipeline chính.
 */
export function CrmAnalyticsGuard() {
  const { user, isLoading } = useAppAuth();
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const allowed = hasFullCrmAccess(user);
    if (allowed) {
      setAuthorized(true);
    } else {
      router.replace("/all-platform/crm");
    }
  }, [isLoading, user, router]);

  if (authorized === null) {
    return (
      <div className="flex h-64 flex-col items-center justify-center p-6 text-center text-on-surface-variant">
        <div className="mb-3 h-8 w-8 animate-spin rounded-full border-4 border-outline-variant border-t-primary" />
        <p>Đang kiểm tra quyền truy cập...</p>
      </div>
    );
  }

  return <AnalyticsView />;
}
