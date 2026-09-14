"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { getDashboardHrefForRole } from "@/components/all-platform/layout/AllPlatformSidebar";
import { authService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";

/** Trang đích của switcher workspace — KHÔNG dùng AppAuthContext để ĐĂNG
 * NHẬP (cookie domain này chưa có, refreshUser() sẽ luôn thất bại trước khi
 * consume xong) — tự gọi thẳng API đổi mã lấy cookie mới cho domain này. Sau
 * khi consume xong (cookie đã có) mới gọi refreshUser() để nạp lại
 * AppAuthContext.user (role/allowedInstances...) TRƯỚC KHI điều hướng vào
 * app — nếu không, context vẫn giữ user cũ (thường là null từ lần check lúc
 * trang vừa load, trước khi có cookie) vì router.replace() chỉ là điều
 * hướng phía client, không tự làm AppAuthContext gọi lại /auth/me. Xem
 * workspace_handoff_service.py (backend) để hiểu luồng. */
function HandoffInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAppAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("Thiếu mã chuyển workspace.");
      return;
    }
    let cancelled = false;
    authService.consumeWorkspaceHandoff(code).then(async (res) => {
      if (cancelled) return;
      if (res.success && res.data?.user) {
        await refreshUser();
        if (cancelled) return;
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-center animate-in fade-in duration-300">
      {error ? (
        <>
          <p className="text-sm text-red-600">{error}</p>
          <a href="/auth/login" className="text-sm text-[var(--color-markee-primary)] underline">
            Về trang đăng nhập
          </a>
        </>
      ) : (
        <>
          <Loader2 className="size-8 animate-spin text-[var(--color-markee-primary)]" />
          <p className="text-sm text-on-surface-variant">Đang chuyển workspace...</p>
        </>
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
