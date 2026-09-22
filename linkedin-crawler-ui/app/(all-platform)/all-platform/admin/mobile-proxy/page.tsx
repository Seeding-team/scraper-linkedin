"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { MobileProxyWorkspace } from "@/components/all-platform/admin/mobile-proxy/MobileProxyWorkspace";
import { useAppAuth } from "@/contexts/AppAuthContext";

export default function AdminMobileProxyPage() {
  const { user, isLoading } = useAppAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.replace("/all-platform/crm/my-dashboard");
    }
  }, [isAdmin, isLoading, router]);

  if (isLoading || !isAdmin) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <div className="size-8 animate-spin rounded-full border-4 border-border border-t-primary" />
        <p>Đang kiểm tra quyền…</p>
      </div>
    );
  }

  return <MobileProxyWorkspace />;
}
