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

import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { materialToLucideIcon } from "@/lib/material-to-lucide-icon";
import {
  buildEntries,
  isLeafActive,
  getInitials,
  type NavGroupItem,
  type NavLeafItem,
  type NavSectionItem,
} from "./AllPlatformSidebar";
import { WorkspaceSwitcherShadcn } from "./WorkspaceSwitcherShadcn";
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

const SUBGROUPS_STORAGE_KEY = "crm_sidebar_subgroups_state";
const GROUPS_STORAGE_KEY = "crm_sidebar_groups_state";

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
      <Link href="/all-platform/post-feed" className="flex min-w-0 flex-1 items-center gap-2">
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

function GroupLinks({
  entry,
  openSubgroups,
  toggleSubgroup,
  openGroups,
  toggleGroup,
}: {
  entry: NavGroupItem;
  openSubgroups: Record<string, boolean>;
  toggleSubgroup: (id: string, current: boolean) => void;
  openGroups: Record<string, boolean>;
  toggleGroup: (id: string, current: boolean) => void;
}) {
  const pathname = usePathname();
  const Icon = materialToLucideIcon(entry.icon);
  const hasActiveChild = entry.items.some((child) =>
    child.type === "item"
      ? isLeafActive(pathname, child)
      : child.items.some((sub) => isLeafActive(pathname, sub)),
  );

  const isGroupOpen = openGroups[entry.id] ?? hasActiveChild;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        onClick={() => toggleGroup(entry.id, isGroupOpen)}
        isActive={entry.headerNeverActive ? false : hasActiveChild}
        tooltip={entry.label}
        className="justify-between font-semibold"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{entry.label}</span>
        </span>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 transition-transform duration-200 text-sidebar-foreground/50",
            isGroupOpen && "rotate-90",
          )}
        />
      </SidebarMenuButton>

      <div
        className={cn(
          "grid overflow-hidden transition-all duration-200 ease-in-out",
          isGroupOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none",
        )}
      >
        <div className="min-h-0">
          <SidebarMenuSub className="my-0.5 ml-3 space-y-0.5 border-l border-sidebar-border/60 pl-2">
            {entry.items.map((child) => {
              if (child.type === "item") {
                const ItemIcon = materialToLucideIcon(child.icon);
                const active = isLeafActive(pathname, child);
                return (
                  <SidebarMenuSubItem key={child.id}>
                    <SidebarMenuSubButton asChild isActive={active}>
                      <Link href={child.href}>
                        <ItemIcon className="size-4" />
                        <span>{child.label}</span>
                        {child.badge !== undefined ? (
                          <span className="ml-auto text-[10px] font-bold text-sidebar-primary">
                            {child.badge}
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              }
              const SubIcon = materialToLucideIcon(child.icon);
              const subHasActiveChild = child.items.some((sub) => isLeafActive(pathname, sub));
              const isSubOpen = subHasActiveChild || (openSubgroups[child.id] ?? true);
              return (
                <li key={child.id} className="mt-1 list-none space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleSubgroup(child.id, isSubOpen)}
                    className={cn(
                      "flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors outline-none",
                      subHasActiveChild
                        ? "text-sidebar-primary bg-sidebar-primary/10 font-bold"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <SubIcon className="size-3.5 shrink-0 opacity-80" />
                      <span className="truncate">{child.label}</span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition-transform duration-200 text-sidebar-foreground/40",
                        isSubOpen && "rotate-90 text-sidebar-primary",
                      )}
                    />
                  </button>
                  <div
                    className={cn(
                      "grid overflow-hidden transition-all duration-200 ease-in-out",
                      isSubOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none",
                    )}
                  >
                    <ul className="min-h-0 space-y-1 border-l border-sidebar-border/70 ml-2 pl-2 my-0.5">
                      {child.items.map((subItem) => {
                        const SubItemIcon = materialToLucideIcon(subItem.icon);
                        const subActive = isLeafActive(pathname, subItem);
                        return (
                          <SidebarMenuSubItem key={subItem.id}>
                            <SidebarMenuSubButton asChild isActive={subActive}>
                              <Link href={subItem.href}>
                                <SubItemIcon className="size-4" />
                                <span>{subItem.label}</span>
                                {subItem.badge !== undefined ? (
                                  <span className="ml-auto text-[9px] font-bold text-sidebar-primary">
                                    {subItem.badge}
                                  </span>
                                ) : null}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            })}
          </SidebarMenuSub>
        </div>
      </div>
    </SidebarMenuItem>
  );
}

export function AllPlatformSidebarShadcn() {
  const { user, logout } = useAppAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [showProfileMenu, setShowProfileMenu] = React.useState(false);

  const [openSubgroups, setOpenSubgroups] = React.useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});

  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";
  const isSale = Boolean(user?.is_sale);
  const entries = React.useMemo(
    () => buildEntries(isAdmin, isLeader, undefined, isSale),
    [isAdmin, isLeader, isSale],
  );

  React.useEffect(() => {
    try {
      const savedSubgroups = sessionStorage.getItem(SUBGROUPS_STORAGE_KEY);
      setOpenSubgroups(savedSubgroups ? JSON.parse(savedSubgroups) : {});
      const savedGroups = sessionStorage.getItem(GROUPS_STORAGE_KEY);
      let parsed: Record<string, boolean> = {};
      if (savedGroups) {
        parsed = JSON.parse(savedGroups);
      }
      let changed = false;
      for (const entry of entries) {
        if (entry.type === "group") {
          const hasActive = entry.items.some((child) =>
            child.type === "item" ? isLeafActive(pathname, child) : false
          );
          if (hasActive && parsed[entry.id] === undefined) {
            parsed[entry.id] = true;
            changed = true;
          }
        }
      }
      setOpenGroups(parsed);
      if (changed) {
        sessionStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.warn("Failed to load sidebar state from sessionStorage", e);
    }
  }, [pathname, entries]);

  const toggleGroup = React.useCallback((id: string, currentState: boolean) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !currentState };
      try {
        sessionStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.warn("Failed to save group state to sessionStorage", e);
      }
      return next;
    });
  }, []);

  const toggleSubgroup = React.useCallback((id: string, currentState: boolean) => {
    setOpenSubgroups((prev) => {
      const next = { ...prev, [id]: !currentState };
      try {
        sessionStorage.setItem(SUBGROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.warn("Failed to save subgroup state to sessionStorage", e);
      }
      return next;
    });
  }, []);

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem(SUBGROUPS_STORAGE_KEY);
      sessionStorage.removeItem(GROUPS_STORAGE_KEY);
    } catch {}
    await logout();
    router.push("/auth/login");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-1 py-1 group-data-[collapsible=icon]:px-0">
          <SidebarLogoHeader />
        </div>
        {isAdmin || (user?.allowedInstances?.length ?? 0) > 1 ? <WorkspaceSwitcherShadcn /> : null}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2 py-1">
          <SidebarMenu className="gap-1">
            {entries.map((entry) => {
              if (entry.type === "section") {
                return (
                  <SidebarGroupLabel
                    key={entry.id}
                    className="px-2 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-sidebar-foreground/50 first:pt-1"
                  >
                    {entry.label}
                  </SidebarGroupLabel>
                );
              }
              if (entry.type === "item") {
                return <LeafLink key={entry.id} item={entry} />;
              }
              return (
                <GroupLinks
                  key={entry.id}
                  entry={entry}
                  openSubgroups={openSubgroups}
                  toggleSubgroup={toggleSubgroup}
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                />
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
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
