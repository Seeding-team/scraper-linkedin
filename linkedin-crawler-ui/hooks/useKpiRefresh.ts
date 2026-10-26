"use client";

import { useEffect } from "react";

/** Event name dispatched after KPI actions to trigger dashboard refresh */
export const KPI_REFRESH_EVENT = "kpi-dashboard-refresh";

/**
 * Dispatch this after KPI bulk verify / assign / sync to force leader dashboard to refresh.
 * Usage:
 *   window.dispatchEvent(new CustomEvent(KPI_REFRESH_EVENT));
 */
export function dispatchKpiRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(KPI_REFRESH_EVENT));
  }
}

/**
 * Hook for leader dashboard to listen for KPI refresh events.
 * Auto-reloads overview when KPI changes are made.
 */
export function useKpiRefresh(onRefresh: () => void) {
  useEffect(() => {
    const handler = () => {
      onRefresh();
    };
    window.addEventListener(KPI_REFRESH_EVENT, handler);
    return () => window.removeEventListener(KPI_REFRESH_EVENT, handler);
  }, [onRefresh]);
}
