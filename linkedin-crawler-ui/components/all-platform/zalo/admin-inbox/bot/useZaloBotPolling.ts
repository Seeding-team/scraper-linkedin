"use client";

import { useEffect, useRef } from "react";

/** Gọi `fn` định kỳ, chỉ khi tab đang hiển thị; quay lại tab thì gọi bù ngay. Không gọi lần đầu. */
export function useVisiblePolling(fn: () => void, intervalMs: number, enabled: boolean) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") fnRef.current();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, enabled]);
}
