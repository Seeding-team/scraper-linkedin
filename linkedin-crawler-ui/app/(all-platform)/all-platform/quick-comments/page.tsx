"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function QuickCommentsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/all-platform/quan-ly-nhom?tab=threads");
  }, [router]);

  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-on-surface-variant font-medium">
        <span className="material-symbols-outlined animate-spin text-primary">sync</span>
        <span>Đang chuyển hướng sang Quản lý nhóm (tab Threads)...</span>
      </div>
    </div>
  );
}
