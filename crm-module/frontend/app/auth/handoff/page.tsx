"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getDashboardHrefForRole } from "@/components/all-platform/layout/AllPlatformSidebar";
import { authService } from "@/services/all-platform.service";

/** Trang đích của switcher workspace — KHÔNG dùng AppAuthContext (cookie
 * domain này chưa có, refreshUser() sẽ luôn thất bại trước khi consume xong)
 * — tự gọi thẳng API đổi mã lấy cookie mới cho domain này rồi mới điều
 * hướng vào app, xem workspace_handoff_service.py (backend) để hiểu luồng. */
function HandoffInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("Thiếu mã chuyển workspace.");
      return;
    }
    let cancelled = false;
    authService.consumeWorkspaceHandoff(code).then((res) => {
      if (cancelled) return;
      if (res.success && res.data?.user) {
        router.replace(getDashboardHrefForRole(res.data.user.role));
      } else {
        setError(res.message || "Mã chuyển workspace đã hết hạn hoặc không hợp lệ.");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      {error ? (
        <>
          <p className="text-sm text-red-600">{error}</p>
          <a href="/auth/login" className="text-sm text-[var(--color-markee-primary)] underline">
            Về trang đăng nhập
          </a>
        </>
      ) : (
        <p className="text-sm text-on-surface-variant">Đang chuyển workspace...</p>
      )}
    </div>
  );
}

export default function WorkspaceHandoffPage() {
  return (
    <Suspense fallback={null}>
      <HandoffInner />
    </Suspense>
  );
}
