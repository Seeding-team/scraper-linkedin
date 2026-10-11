"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { getDashboardHrefForRole } from "@/components/all-platform/layout/AllPlatformSidebar";

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading } = useAppAuth();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user ? getDashboardHrefForRole(user.role) : "/auth/login");
  }, [isLoading, router, user]);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-3 text-sm font-semibold text-primary">
        <span className="h-6 w-6 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        Đang mở MarkeeAI...
      </div>
    </main>
  );
}
