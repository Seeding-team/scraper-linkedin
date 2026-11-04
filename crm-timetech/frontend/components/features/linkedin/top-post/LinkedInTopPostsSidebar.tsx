"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

const sideActive =
  "flex items-center gap-3 border-r-4 border-primary bg-surface-container-low py-3 pr-5 pl-6 text-primary transition-all duration-150 active:scale-95";
const sideIdle =
  "flex items-center gap-3 px-6 py-3 text-on-surface-variant transition-all duration-150 hover:bg-surface-container-low hover:text-primary active:scale-95";

export function LinkedInTopPostsSidebar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isTopPost = pathname.startsWith("/top-post");
  const isGroupMgmt = pathname === "/quan-ly-nhom";

  return (
    <aside className="fixed top-0 left-0 z-40 hidden h-screen w-64 flex-col border-r border-outline-variant bg-surface pt-20 lg:flex">
      <div className="mb-8 flex items-center gap-3 px-6">
        <div className="bg-primary-container flex h-10 w-10 shrink-0 items-center justify-center rounded text-white">
          <MaterialIcon name="analytics" />
        </div>
        <div>
          <h2 className="text-lg leading-tight font-black text-on-surface">
            LinkedIn Scraper
          </h2>
        </div>
      </div>
      <nav className="flex-1 space-y-1">
        <Link href="/" className={cn(isHome ? sideActive : sideIdle)}>
          <MaterialIcon name="radar" className="shrink-0" />
          <span className="font-sans text-xs font-bold uppercase">
            Post Feed
          </span>
        </Link>
       
        
        <Link
          href="/quan-ly-nhom"
          className={cn(isGroupMgmt ? sideActive : sideIdle)}
        >
          <MaterialIcon name="group" className="shrink-0" />
          <span className="font-sans text-xs font-bold uppercase">
            GROUP
          </span>
        </Link>
        
       
      </nav>
      <div className="border-t border-outline-variant p-6">
        <button
          type="button"
          className="mb-6 w-full rounded bg-primary px-3 py-2 text-xs font-bold text-on-primary uppercase transition-colors hover:bg-on-primary-fixed-variant"
        >
          Crawl mới
        </button>
        <div className="space-y-1">
          <span className="text-on-surface-variant hover:text-primary flex cursor-pointer items-center gap-3 py-2 transition-colors">
            <MaterialIcon name="help" className="text-sm" />
            <span className="text-xs font-bold uppercase">
              Trợ giúp
            </span>
          </span>
          <span className="text-on-surface-variant hover:text-primary flex cursor-pointer items-center gap-3 py-2 transition-colors">
            <MaterialIcon name="account_circle" className="text-sm" />
            <span className="text-xs font-bold uppercase">
              Tài khoản
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}
