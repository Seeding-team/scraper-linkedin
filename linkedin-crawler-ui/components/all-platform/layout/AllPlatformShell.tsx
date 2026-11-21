"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { AppPlatformProvider, useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { AllPlatformSidebarShadcn } from "./AllPlatformSidebarShadcn";
import { buildEntries, findCurrentPageLabel } from "./AllPlatformSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { GlobalCrawlNotification } from "../components/global-crawl-notification";

// Dung buildEntries(true, true, "team") - tap hop day du nhat (bao gom ca muc admin/leader) -
// chi de TRA TEN TRANG hien thi o thanh tieu de, khong lien quan phan quyen thuc te (phan quyen
// that van do AllPlatformSidebarShadcn tu quan ly rieng dua tren role that cua user).
const ALL_ENTRIES_FOR_TITLE_LOOKUP = buildEntries(true, true, "team");

// Việc 1 (2026-11-21): cho phép 1 trang cụ thể (vd. post-feed) tự thay thế tiêu đề mặc định
// ("Marketing Agents"/tên trang tra từ sidebar) bằng nội dung riêng (breadcrumb + nút hành
// động...) mà KHÔNG hardcode logic đó trong AllPlatformShell (shell dùng chung cho mọi trang
// /all-platform/*) — trang nào gọi usePageHeaderSlot(node) thì trang đó tự quyết định nội dung,
// Shell chỉ render những gì nhận được qua context. Không gọi hook này (hoặc gọi với null) thì
// Shell vẫn hiện tiêu đề mặc định như cũ.
const PageHeaderSlotContext = createContext<(node: React.ReactNode | null) => void>(() => {});

export function usePageHeaderSlot(node: React.ReactNode | null) {
  const setHeaderSlot = useContext(PageHeaderSlotContext);
  useEffect(() => {
    setHeaderSlot(node);
    return () => setHeaderSlot(null);
  }, [setHeaderSlot, node]);
}

/**
 * AllPlatformShell — Layout shell danh rieng cho module All-Platform.
 *
 * - Tu dong redirect ve /auth/login neu chua dang nhap.
 * - Khong phu thuoc vao DashboardProvider, useDashboardCrawler, hay
 *   bat ky context cu nao cua Facebook/LinkedIn.
 * - Role check lay truc tiep tu Supabase thong qua useAppAuth().
 * - Boc AppPlatformProvider va tu dong set platform = "general".
 *
 * Dung shadcn/ui Sidebar block (SidebarProvider/Sidebar/SidebarInset) lay mau
 * that tu app.markeeai.com production CSS, thay cho ban tu viet truoc day
 * (div + margin-left thu cong). Giu nguyen 100% logic auth/platform/notification
 * ben duoi - chi doi lop hien thi sidebar + khung trang.
 */
function AllPlatformShellInner({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, refreshUser } = useAppAuth();
  const { platform, setPlatform } = useAppPlatform();
  const router = useRouter();
  const pathname = usePathname();
  const [authRetried, setAuthRetried] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<React.ReactNode | null>(null);

  // Force platform to "general" for all-platform routes
  useEffect(() => {
    if (platform !== "general") {
      setPlatform("general");
    }
  }, [platform, setPlatform]);

  // Neu check auth lan dau that bai (co the do 1 request thoang qua bi loi,
  // khong phai that su chua dang nhap), thu lai 1 lan truoc khi day ve login -
  // tranh tinh trang session hop le van bi vang ve trang login/rong du lieu,
  // nguoi dung phai F5 thu cong moi vao lai duoc.
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    if (authRetried) {
      router.push("/auth/login");
      return;
    }
    setAuthRetried(true);
    void refreshUser();
  }, [isAuthenticated, isLoading, authRetried, refreshUser, router]);

  // Loading state (bao gom ca luc dang thu lai auth check lan 2)
  if (isLoading || (!isAuthenticated && !authRetried)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="border-primary h-10 w-10 rounded-full border-4 border-t-transparent animate-spin" />
      </div>
    );
  }

  // Not authenticated — will redirect, render nothing
  if (!isAuthenticated) return null;

  const isChatPage =
    pathname === "/zalo-chat" ||
    pathname.startsWith("/zalo-chat") ||
    pathname.startsWith("/telegram-chat/") ||
    pathname === "/all-platform/omnichannel-inbox" ||
    pathname.startsWith("/all-platform/omnichannel-inbox");
  const pageTitle = findCurrentPageLabel(ALL_ENTRIES_FOR_TITLE_LOOKUP, pathname) ?? "Marketing Agents";

  return (
    <SidebarProvider>
      <AllPlatformSidebarShadcn />
      <SidebarInset className="min-w-0 bg-white">
        <header className="no-print sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-white px-3">
          <SidebarTrigger className="lg:hidden" />
          <Separator orientation="vertical" className="h-4 lg:hidden" />
          <div className="flex-1 min-w-0 flex items-center">
            {headerSlot ?? <span className="text-sm font-semibold text-foreground">{pageTitle}</span>}
          </div>
        </header>
        <div
          className={
            isChatPage
              ? "flex-1 h-[calc(100svh-3rem)] overflow-hidden p-0"
              : "flex-1 overflow-x-hidden bg-white p-3 sm:p-5 lg:p-8"
          }
        >
          <GlobalCrawlNotification />
          <PageHeaderSlotContext.Provider value={setHeaderSlot}>{children}</PageHeaderSlotContext.Provider>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function AllPlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <AppPlatformProvider>
      <AllPlatformShellInner>{children}</AllPlatformShellInner>
    </AppPlatformProvider>
  );
}
