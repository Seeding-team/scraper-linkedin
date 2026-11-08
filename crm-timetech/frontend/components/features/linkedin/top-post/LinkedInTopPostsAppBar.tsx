"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

import { LINKEDIN_TOP_POST_HEADER_AVATAR } from "./LinkedInTopPostConstants";

const navActive =
  "cursor-pointer border-b-2 border-primary pb-1 font-sans text-sm font-semibold text-primary opacity-90 transition-colors hover:opacity-100";
const navIdle =
  "cursor-pointer font-sans text-sm font-semibold text-on-surface-variant opacity-90 transition-colors hover:text-primary hover:opacity-100";

export function LinkedInTopPostsAppBar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isTopPost = pathname.startsWith("/top-post");

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-outline-variant bg-surface px-6">
      <div className="flex items-center gap-8">
        <Link
          href="/"
          className="text-xl font-bold text-primary"
        >
          MarkeeAI
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          <Link href="/" className={cn(isHome ? navActive : navIdle)}>
            Tổng quan
          </Link>
          <Link href="/top-post" className={cn(isTopPost ? navActive : navIdle)}>
            Top bài
          </Link>
          <span className="cursor-pointer font-sans text-sm font-semibold text-on-surface-variant opacity-90 transition-colors hover:text-primary hover:opacity-100">
            Lịch sử
          </span>
          <span className="cursor-pointer font-sans text-sm font-semibold text-on-surface-variant opacity-90 transition-colors hover:text-primary hover:opacity-100">
            Lịch chạy
          </span>
          <span className="cursor-pointer font-sans text-sm font-semibold text-on-surface-variant opacity-90 transition-colors hover:text-primary hover:opacity-100">
            Tài liệu
          </span>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative hidden sm:block">
          <MaterialIcon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-on-surface-variant"
          />
          <input
            className="border-outline-variant bg-surface-container-low focus:ring-primary-container w-64 rounded-lg border py-1.5 pr-4 pl-10 text-sm focus:ring-1 focus:outline-none"
            placeholder="Tìm crawler..."
            type="search"
            aria-label="Tìm crawler"
          />
        </div>
        <button
          type="button"
          className="text-on-surface-variant hover:text-primary"
          aria-label="Thông báo"
        >
          <MaterialIcon name="notifications" />
        </button>
        <button
          type="button"
          className="text-on-surface-variant hover:text-primary"
          aria-label="Cài đặt"
        >
          <MaterialIcon name="settings" />
        </button>
        <div className="h-8 w-8 overflow-hidden rounded-full border border-outline-variant">
          <Image
            src={LINKEDIN_TOP_POST_HEADER_AVATAR}
            alt="Ảnh hồ sơ"
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
