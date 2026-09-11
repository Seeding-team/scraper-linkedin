"use client";

// Sidebar dung dung shadcn/ui Sidebar block (components/ui/sidebar.tsx) + token
// mau lay tu app.markeeai.com production CSS, thay cho AllPlatformSidebar.tsx
// (ban tu viet bang div/Link tho). Dung LAI CHINH XAC logic menu that
// (buildEntries/isLeafActive/getInitials) tu file goc - chi doi lop hien thi,
// khong doi hanh vi/quyen.
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Settings2, ChevronLeft, ChevronRight } from "lucide-react";

import { useAppAuth } from "@/contexts/AppAuthContext";
import { materialToLucideIcon } from "@/lib/material-to-lucide-icon";
import { WorkspaceSwitcherShadcn } from "./WorkspaceSwitcherShadcn";
import {
  buildEntries,
  isLeafActive,
  getInitials,
  type NavGroupItem,
  type NavLeafItem,
  type NavSectionItem,
} from "./AllPlatformSidebar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";

// Logo + nut thu gon/mo rong dat NGAY TRONG sidebar (khong phai 1 nut rieng o
// khung noi dung chinh) - dung y het app.markeeai.com: luc mo rong co 1 nut
// chevron nho canh logo de thu gon; luc da thu gon (icon-only) thi logo TU no
// la nut mo rong, hover vao logo moi hien icon chevron-phai de bam mo lai.
function SidebarLogoHeader() {
  const { state, isMobile, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;

  if (isCollapsed) {
    return (
      <div className="flex justify-center">
        <button
          type="button"
          onClick={toggleSidebar}
          className="group/logo relative flex size-8 shrink-0 items-center justify-center rounded-lg outline-none"
          aria-label="Mở rộng sidebar"
          title="Mở rộng"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold transition-opacity duration-200 group-hover/logo:opacity-0">
            M
          </span>
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-sidebar-accent opacity-0 transition-opacity duration-200 group-hover/logo:opacity-100">
            <ChevronRight className="size-4 text-sidebar-primary" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-2">
      <Link href="/all-platform/crm" className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-base font-bold">
          M
        </div>
        <span className="truncate text-base font-bold leading-[1.15] text-sidebar-primary">
          Marketing
          <br />
          Agents
        </span>
      </Link>
      {!isMobile ? (
        <button
          type="button"
          onClick={toggleSidebar}
          className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/50 outline-none transition hover:bg-sidebar-accent hover:text-sidebar-primary"
          aria-label="Thu gọn sidebar"
          title="Thu gọn"
        >
          <ChevronLeft className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function LeafLink({ item }: { item: NavLeafItem }) {
  const pathname = usePathname();
  const Icon = materialToLucideIcon(item.icon);
  const active = isLeafActive(pathname, item);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.href}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge !== undefined ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );
}

function GroupLinks({ entry }: { entry: NavGroupItem }) {
  const pathname = usePathname();
  const Icon = materialToLucideIcon(entry.icon);
  const hasActiveChild = entry.items.some((item) => isLeafActive(pathname, item));

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{entry.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={entry.headerNeverActive ? false : hasActiveChild} tooltip={entry.label}>
              <Icon />
              <span>{entry.label}</span>
            </SidebarMenuButton>
            <SidebarMenuSub>
              {entry.items.map((item) => {
                const ItemIcon = materialToLucideIcon(item.icon);
                const active = isLeafActive(pathname, item);
                return (
                  <SidebarMenuSubItem key={item.id}>
                    <SidebarMenuSubButton asChild isActive={active}>
                      <Link href={item.href}>
                        <ItemIcon className="size-4" />
                        <span>{item.label}</span>
                        {item.badge !== undefined ? (
                          <span className="ml-auto text-[10px] font-bold text-sidebar-primary">{item.badge}</span>
                        ) : null}
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function SectionLinks({ entry }: { entry: NavSectionItem }) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>{entry.label}</SidebarGroupLabel>
    </SidebarGroup>
  );
}

export function AllPlatformSidebarShadcn() {
  const { user, logout } = useAppAuth();
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = React.useState(false);

  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";
  const isSale = Boolean(user?.is_sale);
  // Module CRM độc lập chỉ có 1 bộ menu duy nhất (không còn "Cá nhân"/"Nhóm"
  // khác nội dung nhau như app seeding gốc) — bỏ toggle, tham số thứ 3 của
  // buildEntries không còn ảnh hưởng tới kết quả trả về.
  const entries = React.useMemo(
    () => buildEntries(isAdmin, isLeader, "team", isSale),
    [isAdmin, isLeader, isSale],
  );

  const handleLogout = async () => {
    await logout();
    router.push("/auth/login");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-1 py-1 group-data-[collapsible=icon]:px-0">
          <SidebarLogoHeader />
        </div>
        {isAdmin ? <WorkspaceSwitcherShadcn /> : null}
      </SidebarHeader>

      <SidebarContent>
        {entries.map((entry) =>
          entry.type === "section" ? (
            <SectionLinks key={entry.id} entry={entry} />
          ) : entry.type === "item" ? (
            <SidebarGroup key={entry.id} className="py-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  <LeafLink item={entry} />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : (
            <GroupLinks key={entry.id} entry={entry} />
          ),
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => setShowProfileMenu((v) => !v)}
              className="relative"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/10 text-xs font-bold text-sidebar-primary">
                {getInitials(user?.name || user?.email)}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">{user?.name || "Người dùng"}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">{user?.email || ""}</span>
              </div>
            </SidebarMenuButton>
            {showProfileMenu ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-sidebar-border bg-popover text-popover-foreground shadow-lg">
                  
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2.5 text-left text-sm text-destructive transition hover:bg-destructive/10"
                  >
                    <LogOut className="size-4" />
                    Đăng xuất
                  </button>
                </div>
              </>
            ) : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
