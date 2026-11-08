"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useDashboardCrawler } from "@/hooks/useDashboardCrawler";

import { AppPlatformProvider, useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { LinkedInEngagementQueueProvider } from "@/components/features/linkedin/dashboard/linkedin-engagement-queue-context";
import { DashboardAuthGate } from "./DashboardAuthGate";
import { DashboardProvider } from "./dashboard-context";
import { DashboardSidebar } from "./DashboardSidebar";
import { useAppAuth } from "@/contexts/AppAuthContext";

import type { DashboardCrawlerValue } from "@/hooks/useDashboardCrawler";

function AuthShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAppAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/auth/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="border-primary h-10 w-10 rounded-full border-4 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return <>{children}</>;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const state = useDashboardCrawler();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Only redirect within old (dashboard) routes, not all-platform
    if (state.role === "leader" && pathname !== "/admin/team" && !pathname.startsWith("/all-platform")) {
      router.replace("/admin/team");
    }
  }, [state.role, pathname, router]);

  return (
    <AuthShell>
      <DashboardProvider value={state}>
        <LinkedInEngagementQueueProvider>
          <AppPlatformProvider>
            <DashboardShellInner state={state}>{children}</DashboardShellInner>
          </AppPlatformProvider>
        </LinkedInEngagementQueueProvider>
      </DashboardProvider>
    </AuthShell>
  );
}

function DashboardShellInner({
  state,
  children,
}: {
  state: DashboardCrawlerValue;
  children: React.ReactNode;
}) {
  const { platform, setPlatform } = useAppPlatform();
  const pathname = usePathname();
  const shouldRequireLinkedInCreds = platform === "linkedin";

  useEffect(() => {
    if (pathname.startsWith("/all-platform")) {
      if (platform !== "general") {
        setPlatform("general");
      }
    } else {
      const matchRoutes = [
        "/post-feed",
        "/quan-ly-nhom",
        "/quan-ly-tai-khoan",
        "/quan-ly-danh-muc",
        "/profile"
      ];
      if (matchRoutes.includes(pathname) && platform === "general") {
        setPlatform("facebook");
      }
    }
  }, [pathname, platform, setPlatform]);

  if (shouldRequireLinkedInCreds) {
    return (
      <DashboardAuthGate
        email={state.email}
        password={state.password}
        setEmail={state.setEmail}
        setPassword={state.setPassword}
      >
        <div className="min-h-screen bg-background text-on-background">
          <DashboardSidebar />
          <main className="p-lg lg:ml-64">{children}</main>
        </div>
      </DashboardAuthGate>
    );
  }

  return (
    <div className="min-h-screen bg-background text-on-background">
      <DashboardSidebar />
      <main className="p-lg lg:ml-64">{children}</main>
    </div>
  );
}

