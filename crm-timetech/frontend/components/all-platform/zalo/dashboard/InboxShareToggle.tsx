"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { MaterialIcon } from "@/components/ui";
import { zaloInboxShareService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";

interface InboxShareToggleProps {
  accountId: string;
  conversationId: string;
  /** Hiển thị label nhỏ bên cạnh icon; default = false (icon-only cho gọn) */
  showLabel?: boolean;
  /** size = "sm" (24px) | "md" (28px) */
  size?: "sm" | "md";
  /** Callback khi tick thay đổi để parent cập nhật state */
  onChange?: (isActive: boolean) => void;
}

interface ShareState {
  loading: boolean;
  isActive: boolean;
  error: string | null;
}

interface SharePermissionItem {
  account_id: string;
  conversation_id: string;
  [key: string]: unknown;
}

interface ShareListResponse {
  success?: boolean;
  message?: string;
  items?: SharePermissionItem[];
  total?: number;
  data?: { items?: SharePermissionItem[] };
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
}

// useSyncExternalStore pattern — server snapshot = false, client snapshot = true
// Tránh vi phạm rule "setState in effect" khi check mounted
function subscribeNoop() {
  return () => {};
}
function getClientSnapshot() {
  return true;
}
function getServerSnapshot() {
  return false;
}

/**
 * Icon toggle cho phép leader xem conversation này (luồng "Tin nhắn KPI").
 *
 * Tooltip tự viết bằng createPortal + position: fixed, không dùng thư viện
 * nào để tránh React 19 cloneElement ref warning. CSS định nghĩa trong
 * `app/globals.css` với class `.app-tooltip`.
 */
export function InboxShareToggle({
  accountId,
  conversationId,
  showLabel = false,
  size = "sm",
  onChange,
}: InboxShareToggleProps) {
  const { user } = useAppAuth();
  const [state, setState] = useState<ShareState>({ loading: true, isActive: false, error: null });
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mounted = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);

  const email = (user?.email || "").trim().toLowerCase();
  const hasValidInput = Boolean(email && accountId && conversationId);

  // Tính vị trí tooltip dựa trên button
  const updateTooltipPosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // Đặt tooltip ở giữa theo chiều dọc của button, lệch sang phải 8px
    setTooltip({
      visible: true,
      x: rect.right + 8,
      y: rect.top + rect.height / 2,
    });
  }, []);

  // Quản lý show/hide với delay
  useEffect(() => {
    const shouldShow = isHovering || isFocused;

    if (shouldShow) {
      // Clear any pending hide
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      // Delay show 200ms
      if (!tooltip.visible) {
        showTimerRef.current = setTimeout(() => {
          updateTooltipPosition();
        }, 200);
      } else {
        updateTooltipPosition();
      }
    } else {
      // Clear any pending show
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      // Delay hide 100ms
      hideTimerRef.current = setTimeout(() => {
        setTooltip((prev) => ({ ...prev, visible: false }));
      }, 100);
    }

    return () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };
  }, [isHovering, isFocused, tooltip.visible, updateTooltipPosition]);

  // Cập nhật vị trí khi scroll/resize (tooltip dùng position: fixed)
  useEffect(() => {
    if (!tooltip.visible) return;
    const handler = () => updateTooltipPosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [tooltip.visible, updateTooltipPosition]);

  // Cleanup timers khi unmount
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Load trạng thái ban đầu — skip hoàn toàn khi thiếu input
  useEffect(() => {
    if (!hasValidInput) return;
    let cancelled = false;
    (async () => {
      try {
        const res = (await zaloInboxShareService.listMine(email, true)) as ShareListResponse;
        if (cancelled) return;
        // BE trả {success, items, total} phẳng, không bọc trong .data
        const items: SharePermissionItem[] =
          (res as { items?: SharePermissionItem[] })?.items ||
          (res as { data?: { items?: SharePermissionItem[] } })?.data?.items ||
          [];
        const found = items.find(
          (it) => it.account_id === accountId && it.conversation_id === conversationId,
        );
        if (process.env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.debug("[InboxShareToggle] listMine", {
            email, accountId, conversationId, itemsCount: items.length, found: !!found, res,
          });
        }
        setState({ loading: false, isActive: !!found, error: null });
      } catch (err) {
        if (cancelled) return;
        if (process.env.NODE_ENV === "development") {
          // eslint-disable-next-line no-console
          console.debug("[InboxShareToggle] listMine FAILED", {
            email, accountId, conversationId,
            err: err instanceof Error ? err.message : err,
          });
        }
        setState({
          loading: false,
          isActive: false,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, accountId, conversationId, hasValidInput]);

  // Auto-hide error sau 3s
  useEffect(() => {
    if (!state.error) return;
    const t = setTimeout(() => setState((p) => ({ ...p, error: null })), 3000);
    return () => clearTimeout(t);
  }, [state.error]);

  const handleToggle = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!email || state.loading) return;

      const newActive = !state.isActive;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const res = await zaloInboxShareService.toggle({
          account_id: accountId,
          conversation_id: conversationId,
          member_email: email,
          is_active: newActive,
        });
        if (res?.success) {
          setState({ loading: false, isActive: newActive, error: null });
          onChange?.(newActive);
        } else {
          setState({
            loading: false,
            isActive: state.isActive,
            error: res?.message || "Toggle thất bại",
          });
        }
      } catch (err) {
        setState({
          loading: false,
          isActive: state.isActive,
          error: err instanceof Error ? err.message : "Lỗi mạng",
        });
      }
    },
    [email, accountId, conversationId, state.isActive, state.loading, onChange],
  );

  if (!email) return null;

  const dim = size === "md" ? "h-7 w-7" : "h-6 w-6";
  const iconSize = size === "md" ? "text-[15px]" : "text-[13px]";

  const tipText = state.isActive
    ? "Đã share — leader có thể xem & tính KPI. Bấm để tắt."
    : "Bấm vào đây để share đoạn chat này cho leader xem và tính KPI";

  return (
    <span
      className="relative inline-flex items-center shrink-0"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-label={tipText}
        aria-describedby={tooltip.visible ? "inbox-share-tooltip" : undefined}
        aria-pressed={state.isActive}
        className={`${dim} inline-flex items-center justify-center rounded-md transition shrink-0 ${
          state.isActive
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
            : "bg-surface-container-low text-on-surface-variant border border-outline-variant hover:bg-surface-container-low hover:text-on-surface-variant"
        } ${state.loading ? "opacity-60 cursor-wait" : "active:scale-95"}`}
      >
        <MaterialIcon
          name={state.isActive ? "visibility" : "visibility_off"}
          className={iconSize}
        />
        {showLabel && (
          <span className="ml-1 text-[10px] font-semibold">
            {state.loading ? "..." : state.isActive ? "Share" : "Riêng tư"}
          </span>
        )}
      </button>

      {/* Tooltip — Portal vào body, tránh bị che bởi overflow parent */}
      {mounted && tooltip.visible
        ? createPortal(
            <div
              id="inbox-share-tooltip"
              role="tooltip"
              className="app-tooltip"
              style={{
                position: "fixed",
                left: `${tooltip.x}px`,
                top: `${tooltip.y}px`,
                transform: "translateY(-50%)",
                zIndex: 9999,
              }}
            >
              <span className="block max-w-[240px] whitespace-normal">{tipText}</span>
              <span className="app-tooltip-arrow" />
            </div>,
            document.body,
          )
        : null}

      {/* Error toast — nổi lên trên icon */}
      {state.error && (
        <div
          role="alert"
          className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-[10000] whitespace-nowrap pointer-events-none"
        >
          <div className="bg-red-600 text-white text-[10.5px] font-semibold px-2 py-1 rounded shadow-lg flex items-center gap-1">
            <MaterialIcon name="error" className="text-[12px]" />
            {state.error}
            <span className="absolute top-full left-1/2 -translate-x-1/2 border-x-[4px] border-t-[4px] border-transparent border-t-red-600" />
          </div>
        </div>
      )}
    </span>
  );
}

