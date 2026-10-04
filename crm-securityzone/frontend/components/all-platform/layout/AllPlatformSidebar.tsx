"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";

export interface NavLeafItem {
  type: "item";
  id: string;
  href: string;
  icon: MaterialSymbolName;
  label: string;
  matchStartsWith?: string[];
  badge?: number;
  // Chi active dung khi pathname == href, khong prefix-match sang cac trang con
  // (vd "Teams" va "Rule KPI & Thuong" cung nam duoi /admin/teams-management/... -
  // neu khong co co nay, ca 2 muc sidebar se sang mau cung luc).
  exactMatch?: boolean;
}

export interface NavSubGroupItem {
  type: "subgroup";
  id: string;
  icon: MaterialSymbolName;
  label: string;
  items: NavLeafItem[];
}

export type NavGroupChild = NavLeafItem | NavSubGroupItem;

export interface NavGroupItem {
  type: "group";
  id: string;
  icon: MaterialSymbolName;
  label: string;
  items: NavGroupChild[];
  // True = dong header (icon + label, giong het "Quan ly kenh & CSKH") KHONG
  // BAO GIO to active du co muc con dang active hay khong - dung cho "Quan ly
  // CRM": ban than dong header khong dieu huong di dau (khong Link, khong
  // onClick), chi la 1 hang tinh co icon; muc con dau tien ("CRM") moi la
  // link that toi /all-platform/crm va la muc duy nhat duoc to active o Pipeline.
  headerNeverActive?: boolean;
}

export interface NavSectionItem {
  type: "section";
  id: string;
  label: string;
}

export type SidebarEntry = NavLeafItem | NavGroupItem | NavSectionItem;

const navBaseClass =
  "group relative flex min-h-[32px] items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-1 text-sm font-medium leading-relaxed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40";
const navActiveClass = "rounded-md bg-[var(--color-markee-primary)]/10 text-[var(--color-markee-primary)] font-semibold";
const navActiveIndentedClass = "-ml-3 rounded-none border-l-2 border-[var(--color-markee-primary)] pl-5 text-[var(--color-markee-primary)] font-semibold";
const navIdleClass = "text-on-surface hover:bg-surface-container-low";
const iconClass = "shrink-0 text-[18px] transition-transform duration-200 group-hover:scale-105";

// So khop theo TUNG DOAN duong dan (path segment), khong phai chuoi con tho -
// tranh truong hop "/all-platform/tai-khoan" (Zalo) tinh nham la tien to cua
// "/all-platform/tai-khoan-fb" (Facebook) roi ca 2 cung sang active.
function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  return pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

export function isLeafActive(pathname: string, item: NavLeafItem) {
  if (item.exactMatch) return pathname === item.href.split("?")[0];
  if (pathname === item.href) return true;
  if (item.matchStartsWith?.some((prefix) => pathMatchesPrefix(pathname, prefix))) return true;
  return pathMatchesPrefix(pathname, item.href) && item.href !== "/all-platform/post-feed";
}

export function getInitials(name?: string) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }
  return parts[0]?.[0]?.toUpperCase() || "U";
}

/** Trang chủ của module CRM độc lập — module này KHÔNG có Admin Dashboard /
 * Leader Dashboard riêng (những trang đó thuộc app seeding gốc, không nằm
 * trong "Quản lý CRM"), nên mọi role (member/leader/admin) đều về thẳng
 * trang Cơ hội (pipeline) sau khi đăng nhập. */
export function getDashboardHrefForRole(_role?: string | null): string {
  return "/all-platform/crm";
}

// "Nhom quyen" CRM (migration 155, OPT-IN theo tung user) - id cua tung muc
// nav ung voi 1 module. Lead/Customer/Deal/Quote: BACKEND da gate that o
// endpoint list (has_module_access() trong crm_permission_service.py) - an
// sidebar khop dung voi API that.
// Product/Report/Account/Setting: CHI an sidebar, KHONG gate API - vi cac
// endpoint dung chung o day (getAllProfiles cho "members", service-catalog
// GET "" con dung boi quote_picker khi tao bao gia) deu la endpoint DUNG
// CHUNG voi nhieu tinh nang khac ngoai pham vi module nay - gate nham se lam
// gay nhung tinh nang khong lien quan. Ai goi thang API van khong bi chan
// (khac Lead/Customer/Deal/Quote).
// Sidebar redesign (2026-09-29) da doi "crm-lead-rules"/"crm-interest-levels"/
// "crm-deal-stages"/"crm-sale-teams" tu item phang sang nam trong 1 subgroup
// moi "crm-config-group" ("Danh mục CRM") - ca 4 muc nay deu chung 1 module
// "Setting" nen gate nguyen ca subgroup (MODULE_NAV_SUBGROUP_IDS) thay vi
// tung item, dung dung tinh than MODULE_NAV_SUBGROUP_IDS ben ban goc (app
// chinh) da dung cho cac subgroup tuong tu (crm-sub-quotes/...).
const MODULE_NAV_ITEM_IDS: Record<string, string> = {
  "crm-leads": "Lead",
  "crm-customers": "Customer",
  crm: "Deal",
  "quote-center": "Quote",
  "quote-history": "Quote",
  "issuer-companies": "Quote",
  quotes: "Quote",
  "quote-settings": "Quote",
  "crm-progress": "Report",
  "crm-analytics": "Report",
  "service-catalog": "Product",
  "crm-categories": "Setting",
  members: "Account",
};
const MODULE_NAV_SUBGROUP_IDS: Record<string, string> = {
  "crm-config-group": "Setting",
};

function filterNavChildByModules(child: NavGroupChild, effectiveModules: string[] | null): NavGroupChild | null {
  if (effectiveModules === null) return child;
  if (child.type === "subgroup") {
    const requiredModule = MODULE_NAV_SUBGROUP_IDS[child.id];
    if (requiredModule && !effectiveModules.includes(requiredModule)) return null;
    return child;
  }
  const requiredModule = MODULE_NAV_ITEM_IDS[child.id];
  if (requiredModule && !effectiveModules.includes(requiredModule)) return null;
  return child;
}

/** Loc bot muc nav theo `effective_modules` cua user hien tai (tra ve tu
 * `/auth/me`, xem AppAuthContext) - `null` = user chua duoc gan Nhom quyen
 * nao (opt-in), KHONG loc gi ca, sidebar day du nhu hien tai. */
export function filterEntriesByEffectiveModules(entries: SidebarEntry[], effectiveModules: string[] | null): SidebarEntry[] {
  if (effectiveModules === null) return entries;
  return entries.map(entry => {
    if (entry.type !== "group") return entry;
    return {
      ...entry,
      items: entry.items
        .map(child => filterNavChildByModules(child, effectiveModules))
        .filter((child): child is NavGroupChild => child !== null),
    };
  });
}

// Sidebar CRM redesign (2026-09-29): 6 nhom phang cap cao nhat (khong con
// wrapper "section" nhu truoc) - Giao tiep / Ban hang / Theo doi & phan tich /
// Tai nguyen ban hang / Cau hinh CRM / Quan tri. Giu NGUYEN toan bo route +
// dieu kien phan quyen (isAdmin/isLeader) cua tung muc cu, chi doi cach gom
// nhom + nhan + icon hien thi. Luu y 2 muc "Danh mục CRM" TRUNG TEN nhung
// KHAC route trong ban cu (leaf /all-platform/crm/categories vs subgroup
// admin-only "Danh mục & cấu hình") - o day doi ten leaf cu thanh "Nguồn &
// gói sản phẩm" (dung noi dung trang - xem CategoryManagementContent.tsx) de
// tranh trung nhan voi subgroup moi dung dung cai ten "Danh mục CRM" ma yeu
// cau thiet ke chi dinh.
export function buildEntries(isAdmin: boolean, isLeader: boolean, _workspaceTab?: "personal" | "team", _isSale: boolean = false): SidebarEntry[] {
  return [
    // Section label KHONG click/collapse duoc (chi la text phan khu vuc) -
    // "Lam viec" (Giao tiep + Ban hang) / "Van hanh" (Theo doi & tai nguyen) /
    // "He thong" (Cau hinh & quan tri), theo yeu cau thiet ke 2026-09-29
    // (gop 6 nhom phang cu xuong 4 nhom, nhom trong 3 cum theo section).
    { type: "section", id: "section-work", label: "Làm việc" },
    {
      type: "group",
      id: "communication",
      icon: "chat",
      label: "Giao tiếp",
      items: [
        {
          type: "item",
          id: "omnichannel-inbox",
          href: "/all-platform/omnichannel-inbox",
          icon: "forum",
          label: "Hộp thư đa kênh",
          matchStartsWith: ["/all-platform/omnichannel-inbox"],
        },
        {
          type: "item",
          id: "inbox",
          href: "/all-platform/inbox",
          icon: "inbox",
          label: "Facebook Chat",
          matchStartsWith: ["/all-platform/inbox"],
        },
        {
          type: "item",
          id: "zalo-accounts",
          href: "/all-platform/tai-khoan",
          icon: "chat",
          label: "Zalo Chat",
          matchStartsWith: ["/all-platform/tai-khoan"],
        },
        {
          type: "item",
          id: "telegram-chat",
          href: "/all-platform/telegram-chat",
          icon: "send",
          label: "Telegram Chat",
          matchStartsWith: ["/all-platform/telegram-chat"],
        },
        {
          type: "item",
          id: "zalo-inbox-admin",
          href: "/all-platform/zalo-inbox",
          icon: "verified_user",
          label: "Inbox Zalo",
          matchStartsWith: ["/all-platform/zalo-inbox"],
        },
        {
          type: "item",
          id: "fb-accounts",
          href: "/all-platform/quan-ly-tai-khoan",
          icon: "account_circle",
          label: "Tài khoản FB",
          matchStartsWith: ["/all-platform/quan-ly-tai-khoan"],
        },
      ],
    },
    {
      type: "group",
      id: "sales",
      icon: "trending_up",
      label: "Bán hàng",
      items: [
        {
          type: "item",
          id: "crm-leads",
          href: "/all-platform/crm/leads",
          icon: "person_add",
          label: "Leads",
          matchStartsWith: ["/all-platform/crm/leads"],
        },
        {
          type: "item",
          id: "crm-customers",
          href: "/all-platform/crm/customers",
          icon: "domain",
          label: "Khách Hàng",
          matchStartsWith: ["/all-platform/crm/customers"],
        },
        {
          type: "item",
          id: "quote-center",
          href: "/all-platform/quote-center",
          icon: "article",
          label: "Báo Giá",
          matchStartsWith: ["/all-platform/quote-center"],
        },
        {
          type: "item",
          id: "quote-history",
          href: "/all-platform/quote-history",
          icon: "history",
          label: "Lịch sử báo giá",
          matchStartsWith: ["/all-platform/quote-history"],
        },
        {
          type: "item",
          id: "contracts",
          href: "/all-platform/contracts",
          icon: "description",
          label: "Hợp đồng",
          matchStartsWith: ["/all-platform/contracts"],
        },
        {
          type: "item",
          id: "service-catalog",
          href: "/all-platform/service-catalog",
          icon: "inventory_2",
          label: "Sản phẩm và dịch vụ",
          matchStartsWith: ["/all-platform/service-catalog"],
        },
      ],
    },
    { type: "section", id: "section-operations", label: "Vận hành" },
    {
      type: "group",
      id: "operations-resources",
      icon: "analytics",
      label: "Theo dõi & tài nguyên",
      items: [
        {
          type: "item",
          id: "crm-progress",
          href: "/all-platform/crm/progress",
          icon: "speed",
          label: "Quản lý tiến độ",
          matchStartsWith: ["/all-platform/crm/progress"],
        },
        {
          type: "item",
          id: "crm-analytics",
          href: "/all-platform/crm/analytics",
          icon: "bar_chart",
          label: "Phân tích CRM",
          matchStartsWith: ["/all-platform/crm/analytics"],
        },
        {
          type: "item",
          id: "sales-assets",
          href: "/all-platform/sales-assets",
          icon: "folder_copy",
          label: "Tài liệu bán hàng",
          matchStartsWith: ["/all-platform/sales-assets"],
        },
        {
          type: "item",
          id: "issuer-companies",
          href: "/all-platform/issuer-companies",
          icon: "account_balance",
          label: "Đơn vị phát hành",
          matchStartsWith: ["/all-platform/issuer-companies"],
        },
      ],
    },
    { type: "section", id: "section-system", label: "Hệ thống" },
    {
      type: "group",
      id: "config-admin",
      icon: "settings_applications",
      label: "Cấu hình & quản trị",
      items: [
        ...(isAdmin || isLeader
          ? ([
              {
                type: "item",
                id: "quote-settings",
                href: "/all-platform/quote-settings",
                icon: "tune",
                label: "Cài đặt báo giá",
                matchStartsWith: ["/all-platform/quote-settings"],
              },
            ] as NavLeafItem[])
          : []),
        {
          type: "item",
          id: "quotes",
          href: "/all-platform/quotes",
          icon: "star",
          label: "Mẫu báo giá",
          matchStartsWith: ["/all-platform/quotes"],
        },
        {
          type: "item",
          id: "crm-categories",
          href: "/all-platform/crm/categories",
          icon: "category",
          label: "Nguồn & gói sản phẩm",
          matchStartsWith: ["/all-platform/crm/categories"],
        },
        // Group con "Danh mục CRM" (WIP full-flow, prototype
        // markee_crm_v26_compact_opportunity_name.html) - 4 muc: Dieu kien
        // phan loai Lead (da lam that, "chỉ có admin mới được tick chọn" nen
        // an het khoi nay neu khong phai Admin) + Muc do quan tam/Giai doan
        // co hoi/Team Sale (placeholder "Đang phát triển", CHUA co cau hinh
        // that nao trong app).
        ...(isAdmin
          ? ([
              {
                type: "subgroup",
                id: "crm-config-group",
                icon: "schema",
                label: "Danh mục CRM",
                items: [
                  {
                    type: "item",
                    id: "crm-lead-rules",
                    href: "/all-platform/crm/lead-rules",
                    icon: "filter_list",
                    label: "Điều kiện phân loại Lead",
                    matchStartsWith: ["/all-platform/crm/lead-rules"],
                  },
                  {
                    type: "item",
                    id: "crm-interest-levels",
                    href: "/all-platform/crm/interest-levels",
                    icon: "monitoring",
                    label: "Mức độ quan tâm",
                    matchStartsWith: ["/all-platform/crm/interest-levels"],
                  },
                  {
                    type: "item",
                    id: "crm-deal-stages",
                    href: "/all-platform/crm/deal-stages",
                    icon: "account_tree",
                    label: "Giai đoạn cơ hội",
                    matchStartsWith: ["/all-platform/crm/deal-stages"],
                  },
                ],
              },
            ] as NavGroupChild[])
          : []),
        ...(isAdmin || isLeader
          ? ([
              {
                type: "item",
                id: "members",
                href: "/all-platform/admin/quan-ly-thanh-vien",
                icon: "groups",
                label: "Quản lý thành viên",
                matchStartsWith: ["/all-platform/admin/quan-ly-thanh-vien"],
              },
            ] as NavLeafItem[])
          : []),
        {
          type: "item",
          id: "settings",
          href: "/all-platform/profile",
          icon: "power",
          label: "Cài đặt kết nối",
          matchStartsWith: ["/all-platform/profile"],
        },
      ],
    },
  ];
}

// Nhom nao mac dinh MO san khi vao trang (truoc khi biet route dang active) -
// "Bán hàng" la nhom dung nhieu nhat nen luon mo; cac nhom con lai mac dinh
// dong de sidebar gon, se tu mo neu co muc con dang active (xem hasActiveChild
// o SidebarGroup/GroupLinks).
export const DEFAULT_OPEN_GROUP_IDS = new Set<string>(["sales"]);

// Tra ten trang hien tai tu pathname, dung chung 1 nguon du lieu voi menu (entries) -
// tranh phai duy tri rieng 1 bang ten trang khac de rendera thanh tieu de o dau khung noi dung.
export function findCurrentPageLabel(entries: SidebarEntry[], pathname: string): string | undefined {
  for (const entry of entries) {
    if (entry.type === "item") {
      if (isLeafActive(pathname, entry)) return entry.label;
    } else if (entry.type === "group") {
      for (const child of entry.items) {
        if (child.type === "item") {
          if (isLeafActive(pathname, child)) return child.label;
        } else if (child.type === "subgroup") {
          const sub = child.items.find((item) => isLeafActive(pathname, item));
          if (sub) return sub.label;
        }
      }
    }
  }
  return undefined;
}

function SidebarLink({
  item,
  active,
  collapsed,
  indented,
  onNavigate,
}: {
  item: NavLeafItem;
  active: boolean;
  collapsed?: boolean;
  indented?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        navBaseClass,
        active ? (indented ? navActiveIndentedClass : navActiveClass) : navIdleClass,
        collapsed && "justify-center px-2",
      )}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <MaterialIcon name={item.icon} className={cn(iconClass, active && "text-[var(--color-markee-primary)]")} />
      {!collapsed ? <span className="min-w-0 truncate">{item.label}</span> : null}
      {!collapsed && item.badge !== undefined ? (
        <span
          className={cn(
            "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold",
            active ? "bg-[var(--color-markee-primary)]/15 text-[var(--color-markee-primary)]" : "bg-primary/10 text-[var(--color-markee-primary)]",
          )}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function SidebarGroup({
  entry,
  pathname,
  collapsed,
  onNavigate,
  homeHref,
}: {
  entry: NavGroupItem;
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  homeHref?: string;
}) {
  const hasActiveChild = entry.items.some((item) =>
    item.type === "item"
      ? item.href !== homeHref && isLeafActive(pathname, item)
      : item.items.some((sub) => sub.href !== homeHref && isLeafActive(pathname, sub))
  );
  const [isOpen, setIsOpen] = useState(hasActiveChild || DEFAULT_OPEN_GROUP_IDS.has(entry.id));

  useEffect(() => {
    if (hasActiveChild) setIsOpen(true);
  }, [hasActiveChild]);

  if (collapsed) {
    const firstChild = entry.items[0];
    const firstHref = firstChild?.type === "item" ? firstChild.href : firstChild?.items[0]?.href;
    return (
      <SidebarLink
        item={{
          type: "item",
          id: entry.id,
          href: firstHref || "/all-platform/internal-engagement",
          icon: entry.icon,
          label: entry.label,
        }}
        active={hasActiveChild}
        collapsed
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="space-y-0.5">
      {/* Tieu de nhom = nut toggle luon (chu nho, in hoa, mau nhat, KHONG
          nen/khung) - gop chung header + chevron mo/dong lam mot, khong phai
          1 pill lien ket to nhu muc menu thuong. */}
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          "flex min-h-[30px] w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40",
          hasActiveChild
            ? "text-[var(--color-markee-primary)]"
            : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <MaterialIcon name={entry.icon} className="shrink-0 text-[16px]" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider">{entry.label}</span>
        </span>
        <MaterialIcon
          name="chevron_right"
          className={cn("shrink-0 text-[14px] opacity-70 transition-transform", isOpen && "rotate-90")}
        />
      </button>

      <div
        className={cn(
          "grid overflow-hidden transition-all duration-200",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="ml-4 min-h-0 space-y-0.5 border-l border-outline-variant pl-3">
          {entry.items.map((child) => {
            if (child.type === "item") {
              return (
                <SidebarLink
                  key={child.id}
                  item={child}
                  active={isLeafActive(pathname, child)}
                  indented
                  onNavigate={onNavigate}
                />
              );
            }
            return (
              <SidebarSubGroup key={child.id} entry={child} pathname={pathname} onNavigate={onNavigate} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Nhom con cap 2 (vd "Tin nhắn khách hàng", "Danh mục CRM") - cung co the
// thu gon/mo rong rieng, giu dung hanh vi voi ban GroupLinks cua
// AllPlatformSidebarShadcn.tsx (subgroup mac dinh mo neu co muc active).
function SidebarSubGroup({
  entry,
  pathname,
  onNavigate,
}: {
  entry: NavSubGroupItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const hasActiveChild = entry.items.some((sub) => isLeafActive(pathname, sub));
  const [isOpen, setIsOpen] = useState(true);
  const open = hasActiveChild || isOpen;

  return (
    <div className="mt-0.5 space-y-0.5">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs font-semibold outline-none transition-colors",
          hasActiveChild ? "text-[var(--color-markee-primary)]" : "text-on-surface-variant hover:text-on-surface",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <MaterialIcon name={entry.icon} className="shrink-0 text-[15px]" />
          <span className="truncate">{entry.label}</span>
        </span>
        <MaterialIcon
          name="chevron_right"
          className={cn("shrink-0 text-[13px] opacity-70 transition-transform", open && "rotate-90")}
        />
      </button>
      <div
        className={cn(
          "grid overflow-hidden transition-all duration-200",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="ml-3 min-h-0 space-y-0.5 border-l border-outline-variant/60 pl-2">
          {entry.items.map((subItem) => (
            <SidebarLink
              key={subItem.id}
              item={subItem}
              active={isLeafActive(pathname, subItem)}
              indented
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Tieu de nhom (6 nhom phang) — chu nho, in hoa, mau nhat, KHONG nen/khung
// bao quanh (dung y giong nav group label cua app.markeeai.com production).
function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) return null;
  return (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-3 first:pt-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/70">{children}</h3>
    </div>
  );
}

export function AllPlatformSidebar({
  isOpen,
  onClose,
  isCollapsed = false,
  onCollapsedChange,
}: {
  isOpen?: boolean;
  onClose?: () => void;
  isCollapsed?: boolean;
  onCollapsedChange?: (next: boolean) => void;
}) {
  const { user, logout } = useAppAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";
  const isSale = Boolean(user?.is_sale);
  const effectiveModules = user?.effective_modules ?? null;
  const entries = useMemo(
    () => filterEntriesByEffectiveModules(buildEntries(isAdmin, isLeader, undefined, isSale), effectiveModules),
    [isAdmin, isLeader, isSale, effectiveModules],
  );

  const handleLogout = async () => {
    await logout();
    router.push("/auth/login");
  };

  return (
    <>
      {isOpen ? (
        <div className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm lg:hidden" onClick={onClose} />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-outline-variant bg-[#fafafa] text-on-surface shadow-xl transition-all duration-300 lg:translate-x-0 lg:shadow-none",
          isCollapsed ? "w-[70px]" : "w-[280px]",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {isOpen ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-low hover:text-[var(--color-markee-primary)] lg:hidden"
            aria-label="Đóng menu"
          >
            <MaterialIcon name="close" />
          </button>
        ) : null}

        <div className="border-b border-outline-variant px-2 py-2">
          <div className={cn("flex items-center", isCollapsed ? "justify-center" : "justify-between gap-2")}>
            {isCollapsed ? (
              <button
                type="button"
                onClick={() => onCollapsedChange?.(!isCollapsed)}
                className="group/logo relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl outline-none md:flex focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40"
                aria-label="Mở rộng sidebar"
                title="Mở rộng"
              >
                <Image
                  src="/markeeai_logo.svg"
                  alt="Marketing Agents"
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-xl object-contain transition-opacity duration-200 group-hover/logo:opacity-0"
                  priority
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface-container-low opacity-0 transition-opacity duration-200 group-hover/logo:opacity-100">
                  <MaterialIcon name="chevron_right" className="text-[20px] text-[var(--color-markee-primary)]" />
                </span>
              </button>
            ) : null}
            {isCollapsed ? (
              <Link
                href="/all-platform/internal-engagement"
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl md:hidden"
              >
                <Image src="/markeeai_logo.svg" alt="Marketing Agents" width={40} height={40} className="h-10 w-10 rounded-xl object-contain" priority />
              </Link>
            ) : (
              <Link
                href="/all-platform/internal-engagement"
                onClick={onClose}
                className="flex min-w-0 items-center gap-3 rounded-lg p-1 transition hover:bg-surface-container-low active:scale-[0.98]"
              >
                <Image
                  src="/markeeai_logo.svg"
                  alt="Marketing Agents"
                  width={40}
                  height={40}
                  className="h-10 w-10 shrink-0 rounded-xl object-contain"
                  priority
                />
                <span className="text-left text-lg font-semibold leading-5 tracking-tight text-[var(--color-markee-primary)]">
                  Marketing
                  <br />
                  Agents
                </span>
              </Link>
            )}
            {!isCollapsed ? (
              <button
                type="button"
                onClick={() => onCollapsedChange?.(!isCollapsed)}
                className="hidden shrink-0 rounded-lg p-1.5 text-on-surface-variant outline-none transition hover:bg-surface-container-low hover:text-[var(--color-markee-primary)] md:flex focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40"
                aria-label="Thu gọn sidebar"
                title="Thu gọn"
              >
                <MaterialIcon name="chevron_left" className="text-[20px]" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Container cuon DUY NHAT cho toan bo khu vuc menu — an scrollbar
            bang class .scrollbar-none (globals.css) nhung van cuon duoc binh
            thuong bang chuot/touch. */}
        <nav className="scrollbar-none flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          <ul className="space-y-0.5">
            {entries.map((entry) => (
              <li key={entry.id}>
                {entry.type === "section" ? (
                  <SectionLabel collapsed={isCollapsed}>{entry.label}</SectionLabel>
                ) : entry.type === "group" ? (
                  <SidebarGroup
                    entry={entry}
                    pathname={pathname}
                    collapsed={isCollapsed}
                    onNavigate={onClose}
                    homeHref={entries[0]?.type === "item" ? entries[0].href : undefined}
                  />
                ) : (
                  <SidebarLink
                    item={entry}
                    active={isLeafActive(pathname, entry)}
                    collapsed={isCollapsed}
                    onNavigate={onClose}
                  />
                )}
              </li>
            ))}
          </ul>

        </nav>

        <div className={cn("relative mt-auto px-2 py-3", isCollapsed && "px-1")}>
          {showProfileMenu ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
              <div
                className={cn(
                  "absolute z-50 w-60 overflow-hidden rounded-xl border border-outline-variant bg-white shadow-lg",
                  isCollapsed ? "bottom-0 left-full ml-2" : "bottom-full left-2 right-2 mb-2",
                )}
              >
                <Link
                  href="/all-platform/profile"
                  onClick={() => { setShowProfileMenu(false); onClose?.(); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-on-surface transition hover:bg-surface-container-low"
                >
                  <MaterialIcon name="settings" className="text-[18px]" />
                  Cài đặt tài khoản
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="flex w-full items-center gap-2.5 border-t border-outline-variant px-3 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                >
                  <MaterialIcon name="logout" className="text-[18px]" />
                  Đăng xuất
                </button>
              </div>
            </>
          ) : null}

          <div
            className={cn(
              "flex items-center rounded-lg p-2 transition hover:bg-surface-container-low",
              isCollapsed ? "justify-center" : "gap-2.5",
            )}
          >
            <button
              type="button"
              onClick={() => setShowProfileMenu((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40 rounded-lg"
              title={isCollapsed ? user?.name || user?.email || "Người dùng" : undefined}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-[var(--color-markee-primary)]">
                {getInitials(user?.name || user?.email)}
              </span>
              {!isCollapsed ? (
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-on-surface">
                    {user?.name || "Người dùng"}
                  </span>
                  <span className="block truncate text-xs text-on-surface-variant">
                    {user?.email || "Chưa đăng nhập"}
                  </span>
                </span>
              ) : null}
            </button>
            {!isCollapsed ? (
              <button
                type="button"
                title="Thông báo (sắp có)"
                className="relative rounded-lg p-1.5 text-on-surface-variant outline-none transition hover:bg-white hover:text-[var(--color-markee-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40"
              >
                <MaterialIcon name="notifications" className="text-[18px]" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleLogout()}
              title="Đăng xuất"
              className="relative rounded-lg p-1.5 text-on-surface-variant outline-none transition hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40"
            >
              <MaterialIcon name="logout" className="text-[18px]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
