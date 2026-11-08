import { z } from "zod";

import { INDUSTRY_OPTIONS, TEAM_OPTIONS } from "@/lib/group-taxonomy";

/** Giá trị taxonomy dùng chung form đăng ký / sửa nhóm. */
export const groupTaxonomySchema = z.object({
  industry: z.string().optional(),
  tier: z.coerce.number().int().min(1).max(3).optional().or(z.literal("")),
  team: z.string().optional(),
  icp: z.string().optional(),
  icp_desc: z.string().optional(),
  platform: z.enum(["facebook", "linkedin"]).optional(),
});

export type GroupTaxonomyValues = z.infer<typeof groupTaxonomySchema>;

export const unifiedGroupEntrySchema = z.object({
  url: z.string().min(1, "URL nhóm bắt buộc").url("URL không hợp lệ"),
  name: z.string().min(1, "Tên nhóm bắt buộc"),
  member: z.coerce.number().int().min(0, "Số thành viên ≥ 0"),
  intent: z.string().min(1, "Chọn Intent / loại nhóm"),
  posts_per_week: z.coerce.number().int().min(0).optional(),
  health_score: z.coerce.number().min(0).max(100).optional(),
  chay_24h: z.boolean().optional(),
  industry: z.string().optional(),
  tier: z.coerce.number().int().min(1).max(3).optional(),
  team: z.string().optional(),
  icp: z.string().optional(),
  icp_desc: z.string().optional(),
});

export type UnifiedGroupEntryValues = z.infer<typeof unifiedGroupEntrySchema>;

export const unifiedRegistryFormSchema = z.object({
  entries: z.array(unifiedGroupEntrySchema).min(1, "Cần ít nhất một nhóm"),
});

export type UnifiedRegistryFormValues = z.infer<typeof unifiedRegistryFormSchema>;

export const emptyUnifiedGroupEntry = (
  platform: "facebook" | "linkedin",
): UnifiedGroupEntryValues => ({
  url: "",
  name: "",
  member: 0,
  intent: "",
  posts_per_week: 0,
  health_score: 0,
  chay_24h: false,
  industry: "",
  tier: platform === "linkedin" ? undefined : 2,
  team: "",
  icp: "",
  icp_desc: "",
});

import { detectPlatformFromUrl } from "@/lib/group-taxonomy";

export const LINKEDIN_GROUP_TYPE_OPTIONS: readonly string[] = []; // Deprecated, use dynamic categories from getCategoriesService() instead

export function detectPlatformFromGroupUrl(url: string): "facebook" | "linkedin" {
  return detectPlatformFromUrl(url);
}

export function parseTierForApi(tier: number | "" | undefined): number | undefined {
  if (tier === "" || tier === undefined || tier === null) return undefined;
  const n = Number(tier);
  if (Number.isNaN(n) || n < 1 || n > 3) return undefined;
  return n;
}

export function industryOptionsForSelect() {
  return INDUSTRY_OPTIONS;
}

export function teamOptionsForSelect() {
  return TEAM_OPTIONS;
}
