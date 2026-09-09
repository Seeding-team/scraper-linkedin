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

export interface NavGroupItem {
  type: "group";
  id: string;
  icon: MaterialSymbolName;
  label: string;
  items: NavLeafItem[];
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
  "group relative flex min-h-[36px] items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-sm font-medium leading-relaxed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-markee-primary)]/40";
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
  if (item.exactMatch) return pathname === item.href;
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

/** Trang chủ đúng theo role — dùng chung cho sidebar (mục "Trang chủ") lẫn
 * redirect ngay sau khi đăng nhập (AuthPage.tsx), để admin/leader không bị
 * đưa nhầm về post-feed (trang chủ của member) sau khi đăng nhập. */
export function getDashboardHrefForRole(role?: string | null): string {
  if (role === "admin") return "/all-platform/admin/dashboard";
  if (role === "leader") return "/all-platform/leader/dashboard";
  // Member: trang chủ giờ là Dashboard Pipeline cá nhân (số liệu deal/phase/
  // trễ hạn...) thay vì post-feed — post-feed vẫn còn, chỉ không còn là
  // trang chủ mặc định (vẫn truy cập được qua mục "Sản xuất nội dung").
  return "/all-platform/crm/my-dashboard";
}

export function buildEntries(isAdmin: boolean, isLeader: boolean, workspaceTab: "personal" | "team", isSale: boolean = false): SidebarEntry[] {
  const dashboardHref = getDashboardHrefForRole(isAdmin ? "admin" : isLeader ? "leader" : "member");
  const teamHref = isAdmin
    ? "/all-platform/admin/teams-management"
    : "/all-platform/leader/team";

  const managementItems: NavLeafItem[] = [
    {
      type: "item",
      id: "teams",
      href: teamHref,
      icon: "groups",
      label: "Teams",
      exactMatch: true,
    },
    ...(isAdmin
      ? ([
          {
            type: "item",
            id: "kpi-rules",
            href: "/all-platform/admin/teams-management/kpi-rules",
            icon: "tune",
            label: "Rule KPI & Thưởng",
            matchStartsWith: ["/all-platform/admin/teams-management/kpi-rules"],
          },
          {
            type: "item",
            id: "kpi-summary",
            href: "/all-platform/admin/teams-management/kpi-summary",
            icon: "monitoring",
            label: "Tổng hợp KPI & Thưởng",
            matchStartsWith: ["/all-platform/admin/teams-management/kpi-summary"],
          },
          {
            type: "item",
            id: "kpi-leaderboard",
            href: "/all-platform/kpi-leaderboard",
            icon: "trending_up",
            label: "KPI & Leaderboard",
            matchStartsWith: ["/all-platform/kpi-leaderboard"],
          },
        ] as NavLeafItem[])
      : []),
    {
      type: "item",
      id: "accounts",
      href: "/all-platform/quan-ly-tai-khoan",
      icon: "manage_accounts",
      label: "Tài khoản seeding",
      matchStartsWith: ["/all-platform/quan-ly-tai-khoan"],
    },
    {
      type: "item",
      id: "crawl-queue-monitor",
      href: "/all-platform/giam-sat-hang-doi",
      icon: "monitoring",
      label: "Giám sát hàng đợi cào",
      matchStartsWith: ["/all-platform/giam-sat-hang-doi"],
    },
    {
      type: "item",
      id: "groups",
      href: "/all-platform/quan-ly-nhom",
      icon: "folder",
      label: "Kho nhóm",
      matchStartsWith: ["/all-platform/quan-ly-nhom"],
    },
    {
      type: "item",
      id: "categories",
      href: "/all-platform/quan-ly-danh-muc",
      icon: "category",
      label: "Danh mục",
      matchStartsWith: ["/all-platform/quan-ly-danh-muc"],
    },
    {
      type: "item",
      id: "members",
      href: "/all-platform/admin/quan-ly-thanh-vien",
      icon: "manage_accounts",
      label: "Quản lý thành viên",
      matchStartsWith: ["/all-platform/admin/quan-ly-thanh-vien"],
    },
  ];

  const contentItems: NavLeafItem[] = [
    {
      type: "item",
      id: "post-feed",
      href: "/all-platform/post-feed",
      icon: "radar",
      label: "Post feed",
      matchStartsWith: ["/all-platform/post-feed"],
    },
    {
      type: "item",
      id: "internal-engagement",
      href: "/all-platform/internal-engagement",
      icon: "chat_bubble",
      label: "Tương tác nội bộ",
      matchStartsWith: ["/all-platform/internal-engagement"],
    },
    {
      type: "item",
      id: "quick-comments",
      href: "/all-platform/quick-comments",
      icon: "chat_bubble",
      label: "Thư viện mẫu câu",
      matchStartsWith: ["/all-platform/quick-comments"],
    },
  ];

  const channelItems: NavLeafItem[] = [
    {
      type: "item",
      id: "inbox",
      href: "/all-platform/inbox",
      icon: "inbox",
      label: "Inbox FB",
      matchStartsWith: ["/all-platform/inbox"],
      badge: 5,
    },
    {
      type: "item",
      id: "zalo-accounts",
      href: "/all-platform/tai-khoan",
      icon: "chat",
      label: "Zalo Chat",
      matchStartsWith: ["/all-platform/tai-khoan"],
    },
  ];

  // Space "QUAN LY CRM": dong header co icon (giong het "Quan ly kenh & CSKH")
  // nhung KHONG dieu huong va KHONG BAO GIO to active (headerNeverActive) -
  // chot lai sau 2 vong sua truoc. Item con dau tien la "CRM" (link that toi
  // /all-platform/crm, la muc DUY NHAT duoc to active o Pipeline). Khong
  // caret/collapse - SidebarMenuSub luon render (xem GroupLinks trong
  // AllPlatformSidebarShadcn.tsx).
  // ===== BEGIN Leads/Khách hàng/Cơ hội reorder (2026-08-29) =====
  // /all-platform/crm render CrmShell = bảng Pipeline/Kanban (8 giai đoạn,
  // kéo-thả), KHÔNG phải trang tổng quan — đổi nhãn "CRM" -> "Cơ hội" cho
  // đúng thực tế, icon "filter_alt" (phễu) để phân biệt hẳn "group" không
  // còn dùng ở đâu khác trong CRM. Thứ tự đúng luồng nghiệp vụ: "Leads"
  // (đầu mối chưa xác minh) -> "Khách hàng" (hồ sơ doanh nghiệp gốc) ->
  // "Cơ hội" (deal/pipeline). Thứ tự 12 mục còn lại giữ nguyên logic cũ,
  // chỉ dời "Phân tích CRM" xuống sau "Cơ hội" theo đúng thứ tự sản phẩm
  // yêu cầu.
  const crmChildren: NavLeafItem[] = [
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
      icon: "person_search",
      label: "Khách hàng",
      matchStartsWith: ["/all-platform/crm/customers"],
    },
    {
      type: "item",
      id: "crm",
      href: "/all-platform/crm",
      icon: "filter_alt",
      label: "Cơ hội",
      exactMatch: true,
    },
    // ===== END Leads/Khách hàng/Cơ hội reorder =====
    // Thu tu day du sau "Co hoi" theo dung yeu cau moi nhat (2026-09-09):
    // Bao gia -> Phan tich CRM -> Lich su bao gia -> Hop dong -> Tai lieu ban
    // hang -> San pham & dich vu -> Danh muc CRM -> Mau bao gia -> Don vi
    // phat hanh -> Cai dat bao gia (truoc day: Bao gia -> Hop dong -> Phan
    // tich CRM -> Lich su bao gia -> ... -> San pham & dich vu -> Mau bao
    // gia -> Don vi phat hanh -> Danh muc CRM -> Cai dat bao gia).
    {
      type: "item",
      id: "quote-center",
      href: "/all-platform/quote-center",
      icon: "request_quote",
      label: "Báo giá",
      matchStartsWith: ["/all-platform/quote-center"],
    },
    // Phan tich CRM: theo yeu cau Mylife (22/07) chi leader/admin thay "full"
    // CRM, member chi thay pipeline ban hang (muc "Co hoi" o tren). Mo rong
    // cho Sale (team_type='sale', migration 049) - duoc nang quyen ngang
    // leader rieng cho Pipeline + Phan tich CRM.
    ...(isAdmin || isLeader || isSale
      ? ([
          {
            type: "item",
            id: "crm-analytics",
            href: "/all-platform/crm/analytics",
            icon: "monitoring",
            label: "Phân tích CRM",
            matchStartsWith: ["/all-platform/crm/analytics"],
          },
        ] as NavLeafItem[])
      : []),
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
      id: "sales-assets",
      href: "/all-platform/sales-assets",
      icon: "campaign",
      label: "Tài liệu bán hàng",
      matchStartsWith: ["/all-platform/sales-assets"],
    },
    {
      type: "item",
      id: "service-catalog",
      href: "/all-platform/service-catalog",
      icon: "category",
      label: "Sản phẩm & dịch vụ",
      matchStartsWith: ["/all-platform/service-catalog"],
    },
    {
      type: "item",
      id: "crm-categories",
      href: "/all-platform/crm/categories",
      // "category" da dung cho "San pham & dich vu" ngay ben tren - truoc day
      // trung icon voi muc nay khien 2 muc lien tiep nhau nhin y het nhau
      // ("sp với danh mục trùng icon"). Doi sang "list_alt" (da co san trong
      // MaterialSymbolName, dai dien dung "danh muc/danh sach" thay vi "san
      // pham").
      icon: "list_alt",
      label: "Danh mục CRM",
      matchStartsWith: ["/all-platform/crm/categories"],
    },
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
      id: "issuer-companies",
      href: "/all-platform/issuer-companies",
      icon: "domain",
      label: "Đơn vị phát hành",
      matchStartsWith: ["/all-platform/issuer-companies"],
    },
    // Gom "Email gửi báo giá" (truoc o Trang ca nhan) + "Quy tắc phê duyệt"
    // (truoc la modal trong Workspace bao gia Buoc 2) ve 1 trang cai dat rieng
    // - chi Admin/Leader thay muc nay, giong dieu kien can_manage_quote_email_
    // settings()/can_manage_quote_approval_rules() o backend.
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
  ];
  const crmEntries: SidebarEntry[] = [
    {
      type: "group",
      id: "crm-group",
      icon: "folder",
      label: "Quản lý CRM",
      headerNeverActive: true,
      items: crmChildren,
    },
  ];

  // Inbox Zalo Admin (/all-platform/zalo-inbox): xem hoi thoai Zalo cua TOAN
  // BO nhan su + duyet KPI - dung phong voi "Teams"/"quan ly" nen chi hien o
  // tab Nhom, khong hien o tab Ca nhan (giong dung tinh than comment o duoi:
  // "Nhom: full bo cong cu quan ly"). Truoc day file nay khong co entry nao
  // tro toi trang do ca - nguoi dung chi vao duoc qua link truc tiep.
  const channelItemsTeam: NavLeafItem[] = [
    ...channelItems,
    {
      type: "item",
      id: "zalo-inbox-admin",
      href: "/all-platform/zalo-inbox",
      icon: "verified_user",
      label: "Inbox Zalo Admin",
      matchStartsWith: ["/all-platform/zalo-inbox"],
    },
  ];

  const resourceItems: NavLeafItem[] = [
    {
      type: "item",
      id: "vps",
      href: "/all-platform/quan-ly-vps",
      icon: "database",
      label: "Quản lý VPS",
      matchStartsWith: ["/all-platform/quan-ly-vps"],
    },
    {
      type: "item",
      id: "vps-monitor",
      href: "/all-platform/vps-vnc-ssh-rdp",
      icon: "monitoring",
      label: "Giám sát VPS",
      matchStartsWith: ["/all-platform/vps-vnc-ssh-rdp"],
    },
  ];

  const homeEntry: SidebarEntry = {
    type: "item",
    id: "home",
    href: dashboardHref,
    icon: "dashboard",
    label: "Trang chủ",
    matchStartsWith: [dashboardHref],
  };
  const phoneBridgeEntry: NavLeafItem = {
    type: "item",
    id: "admin-phone-bridge",
    href: "/all-platform/admin/phone-bridge",
    icon: "settings_input_component",
    label: "Phone Bridge",
    matchStartsWith: ["/all-platform/admin/phone-bridge"],
  };
  const contentGroup: SidebarEntry = {
    type: "group",
    id: "content",
    icon: "article",
    label: "Sản xuất nội dung",
    items: contentItems,
  };
  const channelGroup: SidebarEntry = {
    type: "group",
    id: "channel",
    icon: "support_agent",
    label: "Quản lý kênh & CSKH",
    items: channelItems,
  };
  const channelGroupTeam: SidebarEntry = {
    type: "group",
    id: "channel",
    icon: "support_agent",
    label: "Quản lý kênh & CSKH",
    items: channelItemsTeam,
  };

  // "Cài đặt kết nối" luôn là 1 mục PHẲNG (không submenu/chevron) mở
  // "/all-platform/profile" - trang đó tự có tab "Email gửi báo giá" (chỉ
  // Admin/Leader thấy tab đó) qua query param ?tab=quote-email, KHÔNG dùng
  // route/submenu sidebar riêng (route riêng trước đó gây 404, đã bỏ).
  const connectionSettingsEntry: SidebarEntry = {
    type: "item",
    id: "settings",
    href: "/all-platform/profile",
    icon: "settings",
    label: "Cài đặt kết nối",
    matchStartsWith: ["/all-platform/profile"],
  };

  // Ca nhan: chi viec hang ngay cua tung nguoi (dang bai, inbox, acc FB cua minh).
  // Nhom: full bo cong cu quan ly - Teams, thu vien nhom, KPI acc seeding, ha tang VPS.
  if (workspaceTab === "personal") {
    return [
      homeEntry,
      ...(isAdmin ? [phoneBridgeEntry] : []),
      contentGroup,
      channelGroup,
      ...crmEntries,
      {
        type: "item",
        id: "fb-accounts-personal",
        href: "/all-platform/quan-ly-tai-khoan",
        icon: "account_circle",
        label: "Tài khoản FB",
        matchStartsWith: ["/all-platform/quan-ly-tai-khoan"],
      },
      connectionSettingsEntry,
    ];
  }

  return [
    homeEntry,
    ...(isAdmin ? [phoneBridgeEntry] : []),
    {
      type: "group",
      id: "management",
      icon: "groups",
      label: "Quản lý",
      items: managementItems,
    },
    contentGroup,
    channelGroupTeam,
    ...crmEntries,
    ...(isAdmin || isLeader
      ? [
          {
            type: "group",
            id: "resources",
            icon: "database",
            label: "Quản lý tài nguyên",
            items: resourceItems,
          } as SidebarEntry,
        ]
      : []),
    connectionSettingsEntry,
  ];
}

// Tra ten trang hien tai tu pathname, dung chung 1 nguon du lieu voi menu (entries) -
// tranh phai duy tri rieng 1 bang ten trang khac de rendera thanh tieu de o dau khung noi dung.
export function findCurrentPageLabel(entries: SidebarEntry[], pathname: string): string | undefined {
  for (const entry of entries) {
    if (entry.type === "item") {
      if (isLeafActive(pathname, entry)) return entry.label;
    } else if (entry.type === "group") {
      const child = entry.items.find((item) => isLeafActive(pathname, item));
      if (child) return child.label;
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
  const hasActiveChild = entry.items.some((item) => item.href !== homeHref && isLeafActive(pathname, item));
  const [isOpen, setIsOpen] = useState(hasActiveChild);

  useEffect(() => {
    if (hasActiveChild) setIsOpen(true);
  }, [hasActiveChild]);

  if (collapsed) {
    return (
      <SidebarLink
        item={{
          type: "item",
          id: entry.id,
          href: entry.items[0]?.href || "/all-platform/post-feed",
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
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          navBaseClass,
          "w-full justify-between",
          hasActiveChild ? "bg-[var(--color-markee-primary)]/10 text-[var(--color-markee-primary)] font-semibold" : navIdleClass,
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <MaterialIcon name={entry.icon} className={iconClass} />
          <span className="truncate">{entry.label}</span>
        </span>
        <MaterialIcon
          name="chevron_right"
          className={cn("shrink-0 text-[18px] transition-transform", isOpen && "rotate-90")}
        />
      </button>

      <div
        className={cn(
          "grid overflow-hidden transition-all duration-200",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="ml-5 min-h-0 space-y-1 border-l border-outline-variant pl-3">
          {entry.items.map((item) => (
            <SidebarLink
              key={item.id}
              item={item}
              active={isLeafActive(pathname, item)}
              indented
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) return null;
  return (
    <div className="flex items-center justify-between px-2 pt-2">
      <h3 className="text-sm font-semibold tracking-wider text-on-surface-variant">{children}</h3>
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
  const [workspaceTab, setWorkspaceTab] = useState<"personal" | "team">("personal");
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";
  const isSale = Boolean(user?.is_sale);
  const entries = useMemo(() => buildEntries(isAdmin, isLeader, workspaceTab, isSale), [isAdmin, isLeader, workspaceTab, isSale]);

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
                href="/all-platform/post-feed"
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl md:hidden"
              >
                <Image src="/markeeai_logo.svg" alt="Marketing Agents" width={40} height={40} className="h-10 w-10 rounded-xl object-contain" priority />
              </Link>
            ) : (
              <Link
                href="/all-platform/post-feed"
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

        {!isCollapsed ? (
          <div className="px-3 py-2">
            <div className="flex items-center gap-1 rounded-full bg-surface-container-low p-1">
              <button
                type="button"
                onClick={() => setWorkspaceTab("personal")}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition",
                  workspaceTab === "personal"
                    ? "bg-[var(--color-markee-primary)] text-white shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface",
                )}
              >
                Cá nhân
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceTab("team")}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition",
                  workspaceTab === "team"
                    ? "bg-[var(--color-markee-primary)] text-white shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface",
                )}
              >
                Nhóm
              </button>
            </div>
          </div>
        ) : null}

        <nav className="flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-2 pb-2">
          <SectionLabel collapsed={isCollapsed}>Tác vụ của tôi</SectionLabel>
          <ul className="space-y-1">
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
