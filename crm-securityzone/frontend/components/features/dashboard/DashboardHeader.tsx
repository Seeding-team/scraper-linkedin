"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MaterialIcon } from "@/components/ui";
import { PROFILE_IMAGE_URL } from "@/components/features/dashboard/constants";
import { cn } from "@/lib/utils";

const navActive =
  "cursor-pointer border-b-2 border-primary pb-1 text-body-md font-semibold text-primary transition-colors";
const navIdle =
  "cursor-pointer text-body-md font-semibold text-on-surface-variant transition-colors hover:text-primary";

export function DashboardHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isTopPost = pathname.startsWith("/top-post");

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-outline-variant bg-surface px-lg">
      <div className="flex items-center gap-8">
        <Link
          href="/"
          className="flex items-center gap-sm text-h3 text-on-surface"
        >
          <span className="relative h-8 w-8 overflow-hidden rounded-lg border border-outline-variant bg-surface">
            <Image
              src="/securityzone_logo.png"
              alt="SecurityZone"
              fill
              sizes="32px"
              className="object-contain p-1"
              priority
            />
          </span>
          MarkeeAI
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          <Link href="/" className={cn(isHome ? navActive : navIdle)}>
            Tổng quan
          </Link>
          <Link href="/top-post" className={cn(isTopPost ? navActive : navIdle)}>
            Top bài
          </Link>
          <span className={navIdle}>
            Lịch sử
          </span>
          <span className={navIdle}>
            Lịch chạy
          </span>
          <span className={navIdle}>
            Tài liệu
          </span>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative hidden lg:block">
          <MaterialIcon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-on-surface-variant"
          />
          <input
            className="w-64 rounded-lg border border-outline-variant bg-surface-container-low py-2 pr-4 pl-10 text-body-sm text-on-surface outline-none transition placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/15"
            placeholder="Tìm kiếm crawler..."
            type="search"
            aria-label="Tìm kiếm crawler"
          />
        </div>
        <button
          type="button"
          className="cursor-pointer text-on-surface-variant"
          aria-label="Thông báo"
        >
          <MaterialIcon name="notifications" />
        </button>
        <button
          type="button"
          className="cursor-pointer text-on-surface-variant"
          aria-label="Cài đặt"
        >
          <MaterialIcon name="settings" />
        </button>
        <div className="h-8 w-8 overflow-hidden rounded-full bg-surface-container-low ring-1 ring-outline-variant">
          <Image
            src={PROFILE_IMAGE_URL}
            alt="Ảnh hồ sơ người dùng"
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
