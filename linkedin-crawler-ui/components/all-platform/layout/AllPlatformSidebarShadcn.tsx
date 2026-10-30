"use client";

// Sidebar theo phong cach hien dai (Anh 2) voi:
// - Header 'MENU HE THONG' chu in hoa nhe, nut chevron thu gon bo tron hien dai
// - Segmented control 'Ca nhan / Nhom' pill mem mai mau do thuong hieu #be123c
// - Typography chu dam, sac net, spacing thoang dang
// - Stroke icons lucide-react hien dai
// - Soft Pill Badges (vien thuoc bo tron) cho moi muc co so luong / trang thai
// - Badge 'Live' cho cac muc Zalo Chat / Kenh
// - Duong chi dan cay thu muc (Tree Connector vertical line) o cac muc con mo rong
// - Giu nguyen 100% logic menu (buildEntries/isLeafActive/getInitials/filterEntriesByEffectiveModules)
//   va luu trang thai mo/dong trong sessionStorage.

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LogOut, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { materialToLucideIcon } from "@/lib/material-to-lucide-icon";
import {
  buildEntries,
  filterEntriesByEffectiveModules,
  isLeafActive,
  getInitials,
  type NavGroupChild,
  type NavGroupItem,
  type NavLeafItem,
  type NavSectionItem,
  type SidebarEntry,
} from "./AllPlatformSidebar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const SUBGROUPS_STORAGE_KEY = "crm_sidebar_subgroups_state";
const GROUPS_STORAGE_KEY = "crm_sidebar_groups_state";

// Header tren cung voi tieu de MENU HE THONG va nut thu gon < kieu hien dai
function SidebarLogoHeader() {
  const { state, isMobile, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;

  if (isCollapsed) {
    return (
      <div className="flex justify-center py-1">
        <button
          type="button"
          onClick={toggleSidebar}
          className="group/logo relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-600 to-rose-700 text-white shadow-sm outline-none transition-transform hover:scale-105 active:scale-95"
          aria-label="Mở rộng sidebar"
          title="Mở rộng sidebar"
        >
          <span className="text-base font-extrabold tracking-tight transition-opacity duration-200 group-hover/logo:opacity-0">
            M
          </span>
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-rose-800 opacity-0 transition-opacity duration-200 group-hover/logo:opacity-100">
            <ChevronRight className="size-4 text-white" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 pb-1">
      {/* Dong 1: Menu he thong + Nut thu gon nho gon kieu Anh 2 */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 select-none">
          Menu Hệ Thống
        </span>
        {!isMobile && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex size-7 items-center justify-center rounded-lg border border-slate-200/70 bg-slate-50 text-slate-500 shadow-2xs transition-all hover:border-rose-200 hover:bg-rose-50/80 hover:text-rose-700 active:scale-95 outline-none cursor-pointer"
            aria-label="Thu gọn sidebar"
            title="Thu gọn sidebar"
          >
            <ChevronLeft className="size-4 stroke-[2.2]" />
          </button>
        )}
      </div>

      {/* Dong 2: Brand Logo Marketing Agents */}
      <Link
        href="/all-platform/internal-engagement"
        className="group/brand flex items-center gap-2.5 rounded-xl px-1.5 py-1 transition-colors hover:bg-slate-50"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-600 to-rose-700 text-white font-extrabold text-base shadow-sm group-hover/brand:shadow-md transition-shadow">
          M
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-bold tracking-tight text-slate-900 group-hover/brand:text-rose-700 leading-tight transition-colors">
            Marketing Agents
          </span>
          <span className="text-[11px] font-medium text-slate-400 leading-tight">
            All-in-One Platform
          </span>
        </div>
      </Link>
    </div>
  );
}

// Badge dang vien thuoc (Pill Badge) dong bo mau do thuong hieu
function PillBadge({
  badge,
  active = false,
  isLive = false,
}: {
  badge?: number | string;
  active?: boolean;
  isLive?: boolean;
}) {
  if (isLive) {
    return (
      <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border border-rose-200/80 bg-rose-50 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-rose-700 uppercase shadow-2xs">
        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
        Live
      </span>
    );
  }

  if (badge === undefined || badge === null) return null;

  return (
    <span
      className={cn(
        "ml-auto shrink-0 inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors shadow-2xs",
        active
          ? "bg-rose-600 text-white shadow-xs"
          : "bg-rose-50/90 text-rose-700 border border-rose-200/70 group-hover:bg-rose-100/70",
      )}
    >
      {badge}
    </span>
  );
}

// Link don le cap 1 (Leaf Item)
function LeafLink({ item }: { item: NavLeafItem }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const Icon = materialToLucideIcon(item.icon);
  const active = isLeafActive(pathname, item, searchParams);

  // Kiem tra badge Live danh cho Zalo Chat / Zalo Accounts
  const isZaloItem =
    item.id === "zalo-accounts" ||
    item.id === "zalo-inbox-admin" ||
    item.id === "omnichannel-inbox" ||
    item.label.toLowerCase().includes("zalo");

  return (
    <SidebarMenuItem className="list-none">
      <Link
        href={item.href}
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-all duration-150 outline-none select-none",
          active
            ? "bg-rose-50/90 text-rose-700 font-bold shadow-2xs border border-rose-100/80"
            : "text-slate-700 hover:bg-slate-100/70 hover:text-slate-950 active:bg-slate-200/50",
        )}
      >
        <Icon
          className={cn(
            "size-[18px] shrink-0 stroke-[1.8] transition-colors",
            active ? "text-rose-700" : "text-slate-500 group-hover:text-slate-700",
          )}
        />
        <span className="truncate">{item.label}</span>

        {item.badge !== undefined ? (
          <PillBadge badge={item.badge} active={active} />
        ) : isZaloItem ? (
          <PillBadge isLive />
        ) : null}
      </Link>
    </SidebarMenuItem>
  );
}

// Nhom cha gom cac muc con (Tree layout co duong line chi dan ben trai)
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
  const searchParams = useSearchParams();
  const Icon = materialToLucideIcon(entry.icon);
  const hasActiveChild = entry.items.some((child) =>
    child.type === "item"
      ? isLeafActive(pathname, child, searchParams)
      : child.items.some((sub) => isLeafActive(pathname, sub, searchParams)),
  );

  // Mac dinh mo, neu co trang con active thi luon luon mo
  const isGroupOpen = hasActiveChild || (openGroups[entry.id] ?? true);

  return (
    <div className="py-0.5">
      {/* Nut bam Nhom cha (Parent Group Button) */}
      <button
        type="button"
        onClick={() => toggleGroup(entry.id, isGroupOpen)}
        className={cn(
          "group flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] font-semibold transition-all duration-150 outline-none select-none cursor-pointer",
          hasActiveChild && !entry.headerNeverActive
            ? "bg-rose-50/60 text-rose-700 font-bold"
            : "text-slate-700 hover:bg-slate-100/70 hover:text-slate-950 active:bg-slate-200/50",
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5 truncate">
          <Icon
            className={cn(
              "size-[18px] shrink-0 stroke-[1.8] transition-colors",
              hasActiveChild && !entry.headerNeverActive
                ? "text-rose-700"
                : "text-slate-500 group-hover:text-slate-700",
            )}
          />
          <span className="truncate">{entry.label}</span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          <ChevronDown
            className={cn(
              "size-4 shrink-0 stroke-[2] text-slate-400 transition-transform duration-200 group-hover:text-slate-600",
              isGroupOpen && "rotate-180 text-rose-600",
            )}
          />
        </span>
      </button>

      {/* Danh sach con xo xuong voi Tree Connector Line kieu Anh 2 */}
      <div
        className={cn(
          "grid overflow-hidden transition-all duration-200 ease-in-out",
          isGroupOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none",
        )}
      >
        <div className="min-h-0">
          <div
            className={cn(
              "ml-5 pl-2.5 my-1 space-y-0.5 border-l-2 transition-colors",
              hasActiveChild ? "border-rose-300" : "border-slate-200/80",
            )}
          >
            {entry.items.map((child) => {
              if (child.type === "item") {
                const ItemIcon = materialToLucideIcon(child.icon);
                const active = isLeafActive(pathname, child, searchParams);
                const isChildZalo =
                  child.id === "zalo-accounts" ||
                  child.id === "zalo-inbox-admin" ||
                  child.label.toLowerCase().includes("zalo");

                return (
                  <Link
                    key={child.id}
                    href={child.href}
                    className={cn(
                      "group relative flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-150 outline-none select-none",
                      active
                        ? "bg-rose-50 text-rose-700 font-bold shadow-2xs"
                        : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 active:bg-slate-200/50",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <ItemIcon
                        className={cn(
                          "size-4 shrink-0 stroke-[1.8] transition-colors",
                          active ? "text-rose-700" : "text-slate-400 group-hover:text-slate-600",
                        )}
                      />
                      <span className="truncate">{child.label}</span>
                    </span>

                    {child.badge !== undefined ? (
                      <PillBadge badge={child.badge} active={active} />
                    ) : isChildZalo ? (
                      <PillBadge isLive />
                    ) : null}
                  </Link>
                );
              }

              // child.type === 'subgroup' (vi du: SEEDING BEN NGOAI)
              const SubIcon = materialToLucideIcon(child.icon);
              const subHasActiveChild = child.items.some((sub) => isLeafActive(pathname, sub, searchParams));
              const isSubOpen = subHasActiveChild || (openSubgroups[child.id] ?? child.defaultOpen ?? true);

              return (
                <div key={child.id} className="pt-1 space-y-0.5">
                  {/* Nut tieu de subgroup */}
                  <button
                    type="button"
                    onClick={() => toggleSubgroup(child.id, isSubOpen)}
                    className={cn(
                      "group/sub flex w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-bold uppercase tracking-wider transition-colors outline-none cursor-pointer",
                      subHasActiveChild
                        ? "text-rose-700 bg-rose-50/80"
                        : "text-slate-500 hover:bg-slate-100/60 hover:text-slate-800",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <SubIcon className="size-3.5 shrink-0 opacity-80" />
                      <span className="truncate">{child.label}</span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 stroke-[2] transition-transform duration-200 text-slate-400 group-hover/sub:text-slate-600",
                        isSubOpen && "rotate-180 text-rose-600",
                      )}
                    />
                  </button>

                  {/* Cac muc con cua subgroup voi nhanh con cap 2 */}
                  <div
                    className={cn(
                      "grid overflow-hidden transition-all duration-200 ease-in-out",
                      isSubOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none",
                    )}
                  >
                    <div className="min-h-0">
                      <div
                        className={cn(
                          "ml-3 pl-2.5 my-0.5 space-y-0.5 border-l-2 transition-colors",
                          subHasActiveChild ? "border-rose-300" : "border-rose-200/60",
                        )}
                      >
                        {child.items.map((subItem) => {
                          const SubItemIcon = materialToLucideIcon(subItem.icon);
                          const subActive = isLeafActive(pathname, subItem, searchParams);
                          return (
                            <Link
                              key={subItem.id}
                              href={subItem.href}
                              className={cn(
                                "group relative flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-all duration-150 outline-none select-none",
                                subActive
                                  ? "bg-rose-50 text-rose-700 font-bold shadow-2xs"
                                  : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 active:bg-slate-200/50",
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-2 truncate">
                                <SubItemIcon
                                  className={cn(
                                    "size-3.5 shrink-0 stroke-[1.8] transition-colors",
                                    subActive ? "text-rose-700" : "text-slate-400 group-hover:text-slate-600",
                                  )}
                                />
                                <span className="truncate">{subItem.label}</span>
                              </span>

                              {subItem.badge !== undefined ? (
                                <PillBadge badge={subItem.badge} active={subActive} />
                              ) : null}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Section Label dang chu in hoa nhe
function SectionLinks({ entry }: { entry: NavSectionItem }) {
  return (
    <div className="pt-3 pb-1 px-3">
      <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 select-none">
        {entry.label}
      </span>
    </div>
  );
}

export function AllPlatformSidebarShadcn() {
  const { user, logout } = useAppAuth();
  const router = useRouter();
  const [workspaceTab, setWorkspaceTab] = React.useState<"personal" | "team">("personal");
  const [showProfileMenu, setShowProfileMenu] = React.useState(false);

  const [openSubgroups, setOpenSubgroups] = React.useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    try {
      const savedSubgroups = sessionStorage.getItem(SUBGROUPS_STORAGE_KEY);
      if (savedSubgroups) {
        setOpenSubgroups(JSON.parse(savedSubgroups));
      }
      const savedGroups = sessionStorage.getItem(GROUPS_STORAGE_KEY);
      if (savedGroups) {
        setOpenGroups(JSON.parse(savedGroups));
      }
    } catch (e) {
      console.warn("Failed to load sidebar state from sessionStorage", e);
    }
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

  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";
  const isSale = Boolean(user?.is_sale);

  const rawEntries = React.useMemo(
    () => buildEntries(isAdmin, isLeader, workspaceTab, isSale),
    [isAdmin, isLeader, isSale, workspaceTab],
  );

  const entries = React.useMemo(
    () => filterEntriesByEffectiveModules(rawEntries, user?.effective_modules ?? null),
    [rawEntries, user?.effective_modules],
  );

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem(SUBGROUPS_STORAGE_KEY);
      sessionStorage.removeItem(GROUPS_STORAGE_KEY);
    } catch {}
    await logout();
    router.push("/auth/login");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-slate-200/80 bg-white">
      {/* Header cua Sidebar */}
      <SidebarHeader className="p-3 pb-2 border-b border-slate-100">
        <SidebarLogoHeader />

        {/* Segmented Control Ca nhan / Nhom kieu Pill hien dai */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100/90 p-1 border border-slate-200/60 group-data-[collapsible=icon]:hidden mt-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setWorkspaceTab("personal")}
            className={cn(
              "flex-1 rounded-lg py-1.5 px-3 text-xs font-semibold transition-all duration-150 outline-none cursor-pointer",
              workspaceTab === "personal"
                ? "bg-rose-600 text-white shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50",
            )}
          >
            Cá nhân
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab("team")}
            className={cn(
              "flex-1 rounded-lg py-1.5 px-3 text-xs font-semibold transition-all duration-150 outline-none cursor-pointer",
              workspaceTab === "team"
                ? "bg-rose-600 text-white shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50",
            )}
          >
            Nhóm
          </button>
        </div>
      </SidebarHeader>

      {/* Noi dung cuon cua Sidebar */}
      <SidebarContent className="p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-0.5">
        {entries.map((entry) =>
          entry.type === "section" ? (
            <SectionLinks key={entry.id} entry={entry} />
          ) : entry.type === "item" ? (
            <div key={entry.id} className="py-0.5">
              <SidebarMenu>
                <LeafLink item={entry} />
              </SidebarMenu>
            </div>
          ) : (
            <GroupLinks
              key={entry.id}
              entry={entry}
              openSubgroups={openSubgroups}
              toggleSubgroup={toggleSubgroup}
              openGroups={openGroups}
              toggleGroup={toggleGroup}
            />
          ),
        )}
      </SidebarContent>

      {/* Footer Profile kieu Card hien dai */}
      <SidebarFooter className="p-2.5 border-t border-slate-100 bg-slate-50/40">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowProfileMenu((v) => !v)}
            className="group flex w-full items-center gap-2.5 rounded-xl border border-slate-200/70 bg-white p-2 text-left shadow-2xs transition-all hover:border-rose-200 hover:bg-rose-50/40 active:scale-[0.99] outline-none cursor-pointer"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-100 to-rose-200 border border-rose-200 text-xs font-bold text-rose-800 shadow-2xs">
              {getInitials(user?.name || user?.email)}
            </div>
            <div className="grid flex-1 min-w-0 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-[13px] font-bold text-slate-900 group-hover:text-rose-700 transition-colors">
                {user?.name || "Người dùng"}
              </span>
              <span className="truncate text-[11px] font-medium text-slate-400">
                {user?.email || ""}
              </span>
            </div>
          </button>

          {showProfileMenu ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl">
                <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/60">
                  <p className="text-xs font-bold text-slate-800 truncate">{user?.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                  <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-rose-50 text-rose-700 border border-rose-200/60">
                    {user?.role || "Member"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50 cursor-pointer"
                >
                  <LogOut className="size-4" />
                  Đăng xuất
                </button>
              </div>
            </>
          ) : null}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
