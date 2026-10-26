/**
 * useGroupIntentMap — fetch presetGroups và build URL → intent lookup map.
 *
 * Normalize URL: bỏ trailing slash, lowercase để match linh hoạt.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FacebookGroupDTO } from "@/components/facebook-crawler/modules/facebook-crawl/types/data-fb.type";
import {
  getPresetGroupsService,
  getLinkedInGroupsService,
} from "@/components/facebook-crawler/modules/facebook-crawl/services/group";

function normalizeGroupUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

export interface GroupIntentMap {
  /** Tra intent theo group URL — null nếu không tìm thấy. */
  getIntent: (groupUrl: string) => string | null;
  /** Tra industry theo group URL — null nếu không tìm thấy. */
  getIndustry: (groupUrl: string) => string | null;
  /** Tra team theo group URL — mảng rỗng nếu không tìm thấy. */
  getTeam: (groupUrl: string) => string[];
  /** Tra tier theo group URL — null nếu không tìm thấy. */
  getTier: (groupUrl: string) => number | null;
  isLoading: boolean;
  linkedinIntents: string[];
  /** Tất cả groups để lấy danh sách industry, team, tier options */
  allGroups: FacebookGroupDTO[];
}

/**
 * Chuyển giá trị team/icp (string | string[] | undefined) thành mảng string
 */
function toStringArray(value?: string[] | string | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(t => String(t).trim()).filter(Boolean);
  return String(value).split(/[,;]/).map(t => t.trim()).filter(Boolean);
}

/**
 * Fetch preset groups (FB + LinkedIn) rồi build Map<url, intent/industry/team/tier>.
 * @param linkedInEmail — email để fetch LinkedIn groups. Bỏ trống nếu chỉ cần FB.
 */
export function useGroupIntentMap(linkedInEmail?: string | null): GroupIntentMap {
  const [groups, setGroups] = useState<FacebookGroupDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const email = linkedInEmail?.trim() ?? "";

    Promise.all([
      getPresetGroupsService().catch(() => [] as FacebookGroupDTO[]),
      getLinkedInGroupsService(email).catch(() => [] as FacebookGroupDTO[]),
    ])
      .then(([fbData, liData]) => {
        if (cancelled) return;
        const fb = fbData.map((g) => ({ ...g, platform: "facebook" as const }));
        const li = liData.map((g) => ({ ...g, platform: "linkedin" as const }));
        setGroups([...fb, ...li]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [linkedInEmail]);

  const urlToIntent = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      if (!g.url || !g.intent) continue;
      map.set(normalizeGroupUrl(g.url), g.intent);
    }
    return map;
  }, [groups]);

  const urlToIndustry = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      if (!g.url || !g.industry) continue;
      map.set(normalizeGroupUrl(g.url), g.industry);
    }
    return map;
  }, [groups]);

  const urlToTeam = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of groups) {
      if (!g.url) continue;
      map.set(normalizeGroupUrl(g.url), toStringArray(g.team));
    }
    return map;
  }, [groups]);

  const urlToTier = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groups) {
      if (!g.url || g.tier == null) continue;
      map.set(normalizeGroupUrl(g.url), g.tier);
    }
    return map;
  }, [groups]);

  const linkedinIntents = useMemo(() => {
    const intentsSet = new Set<string>();
    for (const g of groups) {
      if (g.platform === "linkedin" && g.intent?.trim()) {
        intentsSet.add(g.intent.trim());
      }
    }
    return Array.from(intentsSet).sort();
  }, [groups]);

  return {
    getIntent: (groupUrl: string) => {
      if (!groupUrl) return null;
      return urlToIntent.get(normalizeGroupUrl(groupUrl)) ?? null;
    },
    getIndustry: (groupUrl: string) => {
      if (!groupUrl) return null;
      return urlToIndustry.get(normalizeGroupUrl(groupUrl)) ?? null;
    },
    getTeam: (groupUrl: string) => {
      if (!groupUrl) return [];
      return urlToTeam.get(normalizeGroupUrl(groupUrl)) ?? [];
    },
    getTier: (groupUrl: string) => {
      if (!groupUrl) return null;
      return urlToTier.get(normalizeGroupUrl(groupUrl)) ?? null;
    },
    isLoading,
    linkedinIntents,
    allGroups: groups,
  };
}
