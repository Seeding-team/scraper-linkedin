"use client";

import { useEffect, useState } from "react";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { authService } from "@/services/all-platform.service";

type WorkspaceItem = { instance: string; url: string; current: boolean };

const WORKSPACE_LABELS: Record<string, string> = {
  markee: "Markee",
  cloudgate: "CloudGate",
  SECURITYZONE: "SecurityZone",
};

function workspaceLabel(instance: string): string {
  return WORKSPACE_LABELS[instance] || instance;
}

/** Bản dùng cho AllPlatformSidebarShadcn.tsx (sidebar THẬT đang được render —
 * xem AllPlatformShell.tsx) — cùng logic với WorkspaceSwitcher.tsx (bản cho
 * AllPlatformSidebar.tsx cũ, giờ chỉ còn cung cấp hàm dùng chung, không được
 * render trực tiếp nữa), chỉ khác lớp hiển thị (icon lucide + class shadcn).
 * Chỉ render khi role=admin (kiểm tra ở nơi gọi). */
export function WorkspaceSwitcherShadcn() {
  const [items, setItems] = useState<WorkspaceItem[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<WorkspaceItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSwitching = switchingTo !== null;

  useEffect(() => {
    let cancelled = false;
    authService.listWorkspaces().then((res) => {
      if (!cancelled && res.success && res.data) {
        setItems(res.data.items);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Preconnect (DNS/TLS) tới các domain workspace khác ngay khi biết danh
  // sách — đỡ phải chờ bắt tay TLS lúc thật sự bấm chuyển, đổi domain cảm
  // giác nhanh hơn rõ rệt (chỉ có tác dụng thật với domain thật, vô hại với
  // localhost lúc test).
  useEffect(() => {
    if (!items) return;
    const links: HTMLLinkElement[] = [];
    for (const item of items) {
      if (item.current) continue;
      try {
        const origin = new URL(item.url).origin;
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = origin;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
        links.push(link);
      } catch {
        // URL không hợp lệ thì bỏ qua, không chặn UI.
      }
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [items]);

  if (!items || items.length <= 1) return null;

  const current = items.find((i) => i.current);

  async function handleSwitch(target: WorkspaceItem) {
    if (target.current || isSwitching) return;
    setSwitchingTo(target);
    setError(null);
    try {
      const res = await authService.mintWorkspaceHandoff();
      if (!res.success || !res.data?.code) {
        setError(res.message || "Không tạo được phiên chuyển workspace.");
        setSwitchingTo(null);
        return;
      }
      window.location.href = `${target.url}/auth/handoff?code=${encodeURIComponent(res.data.code)}`;
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại.");
      setSwitchingTo(null);
    }
  }

  return (
    <div className="relative px-2 pt-1 pb-2">
      {isSwitching ? (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <Loader2 className="size-8 animate-spin text-sidebar-primary" />
          <p className="text-sm font-medium text-foreground">
            Đang chuyển sang {workspaceLabel(switchingTo!.instance)}...
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        disabled={isSwitching}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-sidebar px-2.5 py-2 text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent disabled:opacity-60 group-data-[collapsible=icon]:hidden"
      >
        <span className="flex min-w-0 items-center gap-2">
          {isSwitching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-sidebar-primary" />
          ) : (
            <Building2 className="size-4 shrink-0 text-sidebar-primary" />
          )}
          <span className="truncate">{isSwitching ? "Đang chuyển..." : `Workspace: ${workspaceLabel(current?.instance || "")}`}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-sidebar-foreground/60 transition-transform", isOpen && "rotate-180")} />
      </button>

      {error ? <p className="mt-1 px-1 text-xs text-destructive">{error}</p> : null}

      {isOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-x-2 top-full z-50 mt-1 overflow-hidden rounded-xl border border-sidebar-border bg-popover text-popover-foreground shadow-lg">
            {items.map((item) => (
              <button
                key={item.instance}
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  void handleSwitch(item);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-sidebar-accent",
                  item.current && "font-semibold text-sidebar-primary",
                )}
              >
                {workspaceLabel(item.instance)}
                {item.current ? <Check className="size-4" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
