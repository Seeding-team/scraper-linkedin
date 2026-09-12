"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { FaRobot } from "react-icons/fa";
import { AiOutlineInteraction } from "react-icons/ai";
import { MaterialIcon } from "@/components/ui";
import { useAppPlatform } from "@/components/providers/AppPlatformProvider";
import { cn } from "@/lib/utils";

import { useAppAuth } from "@/contexts/AppAuthContext";
import { DashboardPlatformSwitcher } from "./DashboardPlatformSwitcher";
import { useDashboard } from "./dashboard-context";

/** Modal chuyển đổi role */
function RoleSwitchModal({
  isOpen,
  onClose,
  currentRole,
  onSwitchToLeader,
  onSwitchToMember,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentRole: "leader" | "member";
  onSwitchToLeader: (email: string, code: string) => Promise<void>;
  onSwitchToMember: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const isToLeader = currentRole === "member";

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError("Vui lòng nhập email.");
      return;
    }
    if (isToLeader && !code.trim()) {
      setError("Vui lòng nhập mã code Leader.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (isToLeader) {
        await onSwitchToLeader(email.trim(), code.trim());
      } else {
        await onSwitchToMember(email.trim());
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-md bg-black/50 backdrop-blur-sm">
      <div className="w-[min(92vw,400px)] bg-surface rounded-xl border border-outline-variant p-xl shadow-2xl space-y-lg">
        <div className="text-center space-y-xs">
          <div className={`inline-flex h-12 w-12 items-center justify-center rounded-full mb-md ${
            isToLeader ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
          }`}>
            <MaterialIcon name={isToLeader ? "shield_person" : "person"} className="text-3xl" />
          </div>
          <h3 className="text-h3 font-bold text-on-surface">
            {isToLeader ? "Chuyển sang Leader" : "Chuyển sang Member"}
          </h3>
          <p className="text-body-sm text-on-surface-variant">
            {isToLeader
              ? "Nhập email và mã code để xác thực Leader."
              : "Nhập email member để chuyển vai trò."}
          </p>
        </div>

        <div className="space-y-md">
          <div className="space-y-xs">
            <label className="text-label-md font-bold text-on-surface-variant">Email {isToLeader ? "Leader" : "của bạn"} <span className="text-error">*</span></label>
            <input
              type="email"
              placeholder={isToLeader ? "email@example.com" : "email@example.com"}
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm outline-none focus:ring-2 focus:ring-primary text-body-md"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              disabled={busy}
            />
          </div>

          {isToLeader && (
            <div className="space-y-xs">
              <label className="text-label-md font-bold text-on-surface-variant">Mã code xác nhận</label>
              <input
                type="password"
                placeholder="••••"
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm text-center text-xl outline-none focus:ring-2 focus:ring-primary"
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(null); }}
                disabled={busy}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-xs text-error bg-error-container/20 p-sm rounded border border-error-container text-body-sm">
            <MaterialIcon name="error" className="text-lg" />
            {error}
          </div>
        )}

        <div className="flex gap-md">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 border border-outline-variant hover:bg-surface-container-high py-sm rounded-lg font-bold text-body-md transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="flex-1 bg-primary text-on-primary py-sm rounded-lg font-bold text-body-md hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Đang xử lý..." : "Xác nhận"}
          </button>
        </div>
      </div>
    </div>
  );
}

const sideActive =
  "flex items-center gap-3 rounded-lg bg-primary px-md py-sm text-body-sm font-semibold text-on-primary shadow-sm transition active:scale-[0.98]";
const sideIdle =
  "flex items-center gap-3 rounded-lg px-md py-sm text-body-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-low hover:text-on-surface active:scale-[0.98]";

export function DashboardSidebar() {
  const d = useDashboard();
  const { platform } = useAppPlatform();
  const { user, logout } = useAppAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [roleSwitchOpen, setRoleSwitchOpen] = useState(false);
  const isHome = pathname === "/" || pathname === "/post-feed" || pathname === "/all-platform/post-feed";

  const getInitials = (name?: string) => {
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return parts.slice(-2).map(p => p[0]).join('').toUpperCase();
    }
    return parts[0] ? parts[0][0].toUpperCase() : "U";
  };
  const isGroupMgmt = pathname === "/quan-ly-nhom" || pathname === "/all-platform/quan-ly-nhom";
  const isTeamAdmin = pathname === "/admin/team";
  const isCrawlFb = pathname === "/crawl-data";
  const isInteraction = pathname === "/Interaction";
  const isAccountMgmt = pathname === "/quan-ly-tai-khoan" || pathname === "/all-platform/quan-ly-tai-khoan";
  const isCategoryMgmt = pathname === "/quan-ly-danh-muc" || pathname === "/all-platform/quan-ly-danh-muc";
  const isProfile = pathname === "/profile" || pathname === "/all-platform/profile";

  /** Leader role: chỉ dùng màn quản lý đội và KPI. */
  const isLeader = d.role === "leader";

  const handleSwitchToLeader = async (email: string, code: string) => {
    await d.confirmLeaderRoleWithSheet(email, code);
    router.push("/admin/team");
  };

  const handleSwitchToMember = async (email: string) => {
    await d.demoteLeaderToMemberWithSheet(email);
    router.push("/");
  };

  return (
    <aside className="fixed top-0 left-0 z-40 hidden h-screen w-64 flex-col border-r border-outline-variant bg-surface lg:flex">
      <div className="border-b border-outline-variant px-md py-md">
        <div className="flex items-center gap-3">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-sm">
          <Image
            src="/securityzone_logo.png"
            alt="SecurityZone"
            fill
            sizes="44px"
            className="object-contain p-1.5"
            priority
          />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-h3 text-on-surface">
            MarkeeAi Seeding
          </h2>
          <p className="mt-1 truncate text-body-sm font-semibold text-on-surface-variant">
            {isLeader
              ? "Leader workspace"
              : (platform === "linkedin" ? "LinkedIn" : platform === "facebook" ? "Facebook" : "General") + " workspace"}
          </p>
        </div>
        </div>
      </div>
      {!isLeader && <DashboardPlatformSwitcher />}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-md">
        {isLeader ? (
          <Link
            href="/admin/team"
            className={cn(isTeamAdmin ? sideActive : sideIdle)}
          >
            <MaterialIcon name="group_add" className="shrink-0" />
            <span className="min-w-0 leading-snug">Quản lý KPI & Đội ngũ</span>
          </Link>
        ) : (
          <>
            <Link
              href={platform === "general" ? "/all-platform/post-feed" : "/post-feed"}
              className={cn(isHome ? sideActive : sideIdle)}
            >
              <MaterialIcon name="radar" className="shrink-0" />
              <span className="min-w-0 leading-snug">Post Feed</span>
            </Link>
            <Link
              href={platform === "general" ? "/all-platform/quan-ly-nhom" : "/quan-ly-nhom"}
              className={cn(isGroupMgmt ? sideActive : sideIdle)}
            >
              <MaterialIcon name="group" className="shrink-0" />
              <span className="min-w-0 leading-snug">Groups</span>
            </Link>

             {/* Menu Quản lý tài khoản */}
            <Link
              href={platform === "general" ? "/all-platform/quan-ly-tai-khoan" : "/quan-ly-tai-khoan"}
              className={cn(isAccountMgmt ? sideActive : sideIdle)}
            >
              <MaterialIcon name="account_circle" className="shrink-0" />
              <span className="min-w-0 leading-snug">Tài khoản</span>
            </Link>

            {/* Menu Profile */}
            <Link
              href={platform === "general" ? "/all-platform/profile" : "/profile"}
              className={cn(isProfile ? sideActive : sideIdle)}
            >
              <MaterialIcon name="person" className="shrink-0" />
              <span className="min-w-0 leading-snug">Trang cá nhân</span>
            </Link>

            {/* Menu Quản lý danh mục - Chỉ hiển thị cho Tổng hợp (general) */}
            {platform === "general" && (
              <Link
                href="/all-platform/quan-ly-danh-muc"
                className={cn(isCategoryMgmt ? sideActive : sideIdle)}
              >
                <MaterialIcon name="category" className="shrink-0" />
                <span className="min-w-0 leading-snug">Quản lý danh mục</span>
              </Link>
            )}

            {/* Các menu bổ sung cho Facebook workspace */}
            {platform === "facebook" && (
              <>
                <Link
                  href="/crawl-data"
                  className={cn(isCrawlFb ? sideActive : sideIdle)}
                >
                  <FaRobot className="shrink-0 text-2xl" />
                  <span className="min-w-0 leading-snug">Crawl data</span>
                </Link>
                <Link
                  href="/Interaction"
                  className={cn(isInteraction ? sideActive : sideIdle)}
                >
                  <AiOutlineInteraction className="shrink-0 text-2xl" />
                  <span className="min-w-0 leading-snug">Interaction</span>
                </Link>
              </>
            )}
          </>
        )}
      </nav>
      <div className="border-t border-outline-variant bg-surface px-md py-md space-y-3">

        {/* User profile & Logout Box */}
        <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-low p-sm transition hover:bg-surface">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs shrink-0">
              {getInitials(user?.name)}
            </div>
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-on-surface truncate leading-none">
                {user?.name || "Người dùng"}
              </p>
              <p className="text-[10px] text-on-surface-variant truncate mt-0.5 leading-none">
                {user?.email || "Chưa đăng nhập"}
              </p>
            </div>
          </div>
          <button
            onClick={() => void logout()}
            className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-lg transition-colors cursor-pointer shrink-0"
            title="Đăng xuất"
          >
            <MaterialIcon name="logout" className="text-[16px]" />
          </button>
        </div>
      </div>

      <RoleSwitchModal
        isOpen={roleSwitchOpen}
        onClose={() => setRoleSwitchOpen(false)}
        currentRole={d.role ?? "member"}
        onSwitchToLeader={handleSwitchToLeader}
        onSwitchToMember={handleSwitchToMember}
      />
    </aside>
  );
}
