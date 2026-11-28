"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { slaAlertsService } from "@/services/slaAlertsService";
import {
  normalizeSlaChannel,
  type JsEngineStatus,
  type LiveSlaBadge,
  type SlaChannelFilter,
} from "@/types/sla-alerts";

function stripZaloConvPrefix(convId: string): string {
  const trimmed = convId.trim();
  if (/^(?:u|g|user|group)_/i.test(trimmed)) {
    return trimmed.replace(/^(?:u|g|user|group)_/i, "");
  }
  return trimmed;
}

export interface UseSlaLiveBadgesOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
}

export interface UseSlaLiveBadgesResult {
  badges: LiveSlaBadge[];
  engineStatus: JsEngineStatus | null;
  loading: boolean;
  lastUpdatedAt: number | null;
  waitingCount: number;
  warningCount: number;
  breachedCount: number;
  refresh: () => Promise<void>;
  /** Tra cứu badge theo (channel, accountId, conversationId) — tự chuẩn hóa `facebook -> messenger` & tiền tố Zalo `u_`/`g_` */
  getBadgeFor: (
    channel: string,
    conversationId: string,
    accountId?: string | null,
  ) => LiveSlaBadge | null;
}

/**
 * Poll `/api/all-platform/sla-alerts/live-badges` định kỳ (mặc định 15s, tự dừng khi tab ẩn)
 * để gắn Live SLA Badge lên từng hội thoại trong Zalo Inbox & Omnichannel Inbox.
 */
export function useSlaLiveBadges(
  channel: SlaChannelFilter | string = "all",
  options?: UseSlaLiveBadgesOptions,
): UseSlaLiveBadgesResult {
  const { user } = useAppAuth();
  const userEmail = user?.email ?? null;
  const enabled = options?.enabled ?? true;
  const pollIntervalMs = options?.pollIntervalMs ?? 15_000;

  const [badges, setBadges] = useState<LiveSlaBadge[]>([]);
  const [engineStatus, setEngineStatus] = useState<JsEngineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const inflightRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const normalizedFilter = useMemo(
    () => (channel === "all" ? "all" : normalizeSlaChannel(channel) || "all"),
    [channel],
  );

  const refresh = useCallback(async () => {
    if (!enabled || inflightRef.current) return;
    inflightRef.current = true;
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    try {
      const res = await slaAlertsService.getLiveBadges(normalizedFilter, userEmail);
      if (res.success && res.data) {
        const items = Array.isArray(res.data.items) ? res.data.items : [];
        setBadges(items);
        if (res.data.engine_status !== undefined) {
          setEngineStatus(res.data.engine_status ?? null);
        }
        hasLoadedRef.current = true;
        setLastUpdatedAt(Date.now());
      }
    } catch {
      // Fail-soft: never break inbox UI when SLA endpoint is unavailable
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, [enabled, normalizedFilter, userEmail]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void refresh();
    });

    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, pollIntervalMs);

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, pollIntervalMs, refresh]);

  // Multi-key lookup map for O(1) rendering inside conversation lists
  const lookupMaps = useMemo(() => {
    const exact = new Map<string, LiveSlaBadge>();
    const byConv = new Map<string, LiveSlaBadge>();

    for (const badge of badges) {
      const ch = normalizeSlaChannel(badge.channel);
      const acc = (badge.account_id || "").trim();
      const conv = (badge.conversation_id || "").trim();
      if (!conv) continue;

      const stripped = ch === "zalo" ? stripZaloConvPrefix(conv) : conv;

      if (acc) {
        exact.set(`${ch}|${acc}|${conv}`, badge);
        if (stripped !== conv) {
          exact.set(`${ch}|${acc}|${stripped}`, badge);
        }
      }
      // Fallback by (channel, conv) when accountId format differs or is omitted
      if (!byConv.has(`${ch}|${conv}`)) {
        byConv.set(`${ch}|${conv}`, badge);
      }
      if (stripped !== conv && !byConv.has(`${ch}|${stripped}`)) {
        byConv.set(`${ch}|${stripped}`, badge);
      }
    }
    return { exact, byConv };
  }, [badges]);

  const getBadgeFor = useCallback(
    (convChannel: string, conversationId: string, accountId?: string | null): LiveSlaBadge | null => {
      if (!conversationId) return null;
      const ch = normalizeSlaChannel(convChannel);
      const conv = conversationId.trim();
      const stripped = ch === "zalo" ? stripZaloConvPrefix(conv) : conv;
      const acc = (accountId || "").trim();

      if (acc) {
        const hitExact =
          lookupMaps.exact.get(`${ch}|${acc}|${conv}`) ||
          (stripped !== conv ? lookupMaps.exact.get(`${ch}|${acc}|${stripped}`) : undefined);
        if (hitExact) return hitExact;
      }

      return (
        lookupMaps.byConv.get(`${ch}|${conv}`) ||
        (stripped !== conv ? lookupMaps.byConv.get(`${ch}|${stripped}`) : undefined) ||
        null
      );
    },
    [lookupMaps],
  );

  const counts = useMemo(() => {
    let warning = 0;
    let breached = 0;
    for (const b of badges) {
      const state = b.state || b.live_state || "ok";
      if (state === "breached") breached += 1;
      else if (state === "warning") warning += 1;
    }
    return { waiting: badges.length, warning, breached };
  }, [badges]);

  return {
    badges,
    engineStatus,
    loading,
    lastUpdatedAt,
    waitingCount: counts.waiting,
    warningCount: counts.warning,
    breachedCount: counts.breached,
    refresh,
    getBadgeFor,
  };
}
