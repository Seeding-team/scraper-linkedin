"use client";

import { useEffect, useState } from "react";

import { MaterialIcon } from "@/components/ui";
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

/** Chỉ render khi role=admin (kiểm tra ở AllPlatformSidebar trước khi mount
 * component này) — dropdown chọn 1 trong các workspace/brand khác. Chọn brand
 * khác sẽ ĐIỀU HƯỚNG SANG DOMAIN THẬT của brand đó (không phải chỉ đổi state
 * UI), kèm 1 mã dùng 1 lần để tự đăng nhập lại ở domain đích — xem
 * workspace_handoff_service.py (backend) để hiểu vì sao cần bước này. */
export function WorkspaceSwitcher() {
  const [items, setItems] = useState<WorkspaceItem[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!items || items.length <= 1) return null;

  const current = items.find((i) => i.current);

  async function handleSwitch(target: WorkspaceItem) {
    if (target.current || isSwitching) return;
    setIsSwitching(true);
    setError(null);
    try {
      const res = await authService.mintWorkspaceHandoff();
      if (!res.success || !res.data?.code) {
        setError(res.message || "Không tạo được phiên chuyển workspace.");
        setIsSwitching(false);
        return;
      }
      window.location.href = `${target.url}/auth/handoff?code=${encodeURIComponent(res.data.code)}`;
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại.");
      setIsSwitching(false);
    }
  }

  return (
    <div className="relative pb-2">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        disabled={isSwitching}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-outline-variant bg-white px-3 py-2 text-sm font-medium text-on-surface transition hover:bg-surface-container-low disabled:opacity-60"
      >
        <span className="flex items-center gap-2">
          <MaterialIcon name="domain" className="text-[18px] text-[var(--color-markee-primary)]" />
          {isSwitching ? "Đang chuyển..." : `Workspace: ${workspaceLabel(current?.instance || "")}`}
        </span>
        <MaterialIcon
          name="arrow_drop_down"
          className={cn("text-[18px] text-on-surface-variant transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {error ? <p className="mt-1 px-1 text-xs text-red-600">{error}</p> : null}

      {isOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-x-2 bottom-full z-50 mb-1 overflow-hidden rounded-xl border border-outline-variant bg-white shadow-lg">
            {items.map((item) => (
              <button
                key={item.instance}
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  void handleSwitch(item);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-surface-container-low",
                  item.current && "font-semibold text-[var(--color-markee-primary)]",
                )}
              >
                {workspaceLabel(item.instance)}
                {item.current ? <MaterialIcon name="check" className="text-[16px]" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
