"use client";

import { useState, useEffect, useMemo } from "react";
import { INDUSTRY_OPTIONS, TEAM_OPTIONS, TIER_OPTIONS } from "@/lib/group-taxonomy";
import { cn } from "@/lib/utils";
import { useGetCategoriesQuery } from "@/components/facebook-crawler/modules/facebook-crawl/hooks/use-get-categories-query";

const LABEL =
  "text-label-md text-on-surface-variant font-semibold tracking-wide uppercase";
const INPUT =
  "border-outline-variant bg-surface focus:border-primary focus:ring-primary w-full rounded-lg border px-md py-sm text-sm outline-none focus:ring-1";

export interface GroupTaxonomyFieldsProps {
  industry: string;
  tier: number | "";
  team: string;
  icp: string;
  icp_desc: string;
  onIndustryChange: (v: string) => void;
  onTierChange: (v: number | "") => void;
  onTeamChange: (v: string) => void;
  onIcpChange: (v: string) => void;
  onIcpDescChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}

export function GroupTaxonomyFields({
  industry,
  tier,
  team,
  icp,
  icp_desc,
  onIndustryChange,
  onTierChange,
  onTeamChange,
  onIcpChange,
  onIcpDescChange,
  disabled = false,
  className,
}: GroupTaxonomyFieldsProps) {
  const { data } = useGetCategoriesQuery();

  const dynCategories = useMemo(() => {
    if (!data) {
      return {
        industry: [],
        team: [],
        tier: [],
        icp: [],
      };
    }

    const mappedIndustries = (data.industry || []).map((item: any) => ({
      id: item.code || item.value,
      label: item.name,
      value: item.code || item.value,
    }));

    const teams = (data.team || []).map((item: any) => ({
      code: item.code || item.value || item.team_name,
      name: item.name || item.leader,
    }));

    const icps = (data.icp || []).map((item: any) => ({
      code: item.code || item.value || item.target,
      name: item.name || item.geo,
    }));

    const tiers = (data.tier || []).map((item: any) => {
      const tierNum = parseInt(item.code || item.value) || 1;
      const parts = item.name.split(" ");
      const icon = parts[0] || "🔥";
      const title = parts.slice(1).join(" ") || `Tier ${tierNum}`;
      const sub = item.name.includes("-") ? item.name.split("-")[1].trim() : "";
      return {
        tier: tierNum,
        icon,
        title,
        sub,
      };
    });

    return {
      industry: mappedIndustries,
      team: teams,
      tier: tiers,
      icp: icps,
    };
  }, [data]);

  return (
    <div className={cn("space-y-md", className)}>
      <p className={LABEL}>Phân loại & ICP (Taxonomy)</p>
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <div>
          <label className={LABEL}>Ngành</label>
          <select
            className={INPUT}
            value={industry}
            onChange={(e) => onIndustryChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">— Chọn ngành —</option>
            {dynCategories.industry.map((o) => (
              <option key={o.id} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL}>Team phụ trách</label>
          <select
            className={INPUT}
            value={team}
            onChange={(e) => onTeamChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">— Chọn team —</option>
            {dynCategories.team.map((t) => (
              <option key={t.code} value={t.code}>
                {t.code} {t.name ? `(Leader: ${t.name})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className={LABEL}>Tier ưu tiên</span>
        <div className="mt-sm grid grid-cols-3 gap-sm">
          {dynCategories.tier.map((t) => (
            <button
              key={t.tier}
              type="button"
              disabled={disabled}
              onClick={() => onTierChange(t.tier)}
              className={cn(
                "rounded-lg border px-sm py-sm text-center transition-colors",
                tier === t.tier
                  ? "border-primary bg-primary/10 text-primary font-bold"
                  : "border-outline-variant bg-surface hover:border-primary/40",
              )}
            >
              <div className="text-base">{t.icon}</div>
              <div className="text-[11px] font-bold">{t.title}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={LABEL}>ICP (phân cách dấu phẩy nếu nhiều)</label>
        <select
          className={INPUT}
          value={icp}
          onChange={(e) => onIcpChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">— Chọn ICP —</option>
          {dynCategories.icp.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code} {t.name ? `(${t.name})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL}>Mô tả ICP</label>
        <textarea
          className={`${INPUT} min-h-[72px] resize-y`}
          value={icp_desc}
          onChange={(e) => onIcpDescChange(e.target.value)}
          placeholder="Mô tả đối tượng mục tiêu…"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
