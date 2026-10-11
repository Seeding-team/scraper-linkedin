"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";

import { MaterialIcon } from "@/components/ui";
import { GroupTaxonomyFields } from "@/components/features/shared/GroupTaxonomyFields";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { useGetIntents } from "@/components/facebook-crawler/modules/facebook-crawl/hooks/use-get-intents";
import {
  emptyUnifiedGroupEntry,
  unifiedRegistryFormSchema,
  type UnifiedGroupEntryValues,
  type UnifiedRegistryFormValues,
} from "@/lib/group-form-shared";
import { submitSharedAddGroup } from "@/lib/group-platform-api";
import { INDUSTRY_OPTIONS } from "@/lib/group-taxonomy";
import { cn } from "@/lib/utils";

const INPUT =
  "border-outline-variant bg-surface focus:border-primary focus:ring-primary w-full rounded-lg border px-md py-sm text-sm outline-none focus:ring-1";
const LABEL =
  "text-label-md text-on-surface-variant font-semibold tracking-wide uppercase";

function taxonomyTags(entry: UnifiedGroupEntryValues) {
  const tags: { key: string; label: string; cls: string }[] = [];
  if (entry.industry) {
    const ind = INDUSTRY_OPTIONS.find((o) => o.value === entry.industry);
    tags.push({ key: "ind", label: ind?.label ?? entry.industry, cls: "bg-blue-100 text-blue-800" });
  }
  if (entry.team) tags.push({ key: "team", label: entry.team, cls: "bg-green-100 text-green-800" });
  if (entry.icp) tags.push({ key: "icp", label: entry.icp.split(",")[0]?.trim() || entry.icp, cls: "bg-violet-100 text-violet-800" });
  if (entry.tier === 1) tags.push({ key: "t1", label: "🔥 Tier 1", cls: "bg-red-100 text-red-800" });
  else if (entry.tier === 2) tags.push({ key: "t2", label: "⚡ Tier 2", cls: "bg-amber-100 text-amber-900" });
  else if (entry.tier === 3) tags.push({ key: "t3", label: "Tier 3", cls: "bg-slate-100 text-slate-600" });
  return tags;
}

export function UnifiedGroupRegistrySection({
  platform,
}: {
  platform: "facebook" | "linkedin";
}) {
  const d = useDashboard();
  const queryClient = useQueryClient();
  const { intents, fetchIntents } = useGetIntents();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const {
    control,
    register,
    watch,
    setValue,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UnifiedRegistryFormValues>({
    resolver: zodResolver(unifiedRegistryFormSchema) as Resolver<UnifiedRegistryFormValues>,
    defaultValues: {
      entries: [emptyUnifiedGroupEntry(platform)],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "entries" });
  const entries = watch("entries");

  useEffect(() => {
    void fetchIntents();
  }, [fetchIntents]);

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const onSaveAll = handleSubmit(async (data) => {
    setFeedback(null);
    if (platform === "linkedin" && !d.email.trim()) {
      setFeedback({ type: "err", text: "Nhập email LinkedIn ở mục cấu hình crawl trước khi lưu nhóm." });
      return;
    }
    setBusy(true);
    const failures: string[] = [];
    let okCount = 0;
    for (const row of data.entries) {
      const res = await submitSharedAddGroup(
        {
          platform: platform,
          group_name: row.name,
          link_group: row.url,
          intent: row.intent,
          members: row.member,
          posts_per_week: row.posts_per_week ?? 0,
          chay_24h: row.chay_24h ?? false,
          health_score: row.health_score ?? 0,
          industry: row.industry,
          tier: row.tier,
          team: row.team,
          icp: row.icp,
          icp_desc: row.icp_desc,
        },
        d.email,
      );
      if (res.ok) okCount += 1;
      else failures.push(`${row.name || row.url}: ${res.message}`);
    }
    setBusy(false);
    if (okCount > 0) {
      void queryClient.invalidateQueries({ queryKey: ["presetGroups"] });
    }
    if (failures.length === 0) {
      setFeedback({ type: "ok", text: `Đã lưu ${okCount} nhóm lên hệ thống.` });
      reset({ entries: [emptyUnifiedGroupEntry(platform)] });
      setExpanded(new Set([0]));
    } else {
      setFeedback({
        type: "err",
        text: `${okCount}/${data.entries.length} thành công. ${failures.slice(0, 3).join(" · ")}`,
      });
    }
  });

  const intentOptions = (intents ?? []).map((i) => ({ value: i.value, name: i.name }));

  return (
    <div className="border-outline-variant bg-surface mt-lg flex flex-col overflow-hidden rounded-xl border shadow-sm">
      <div className="border-outline-variant bg-surface-container-low/60 flex items-center gap-sm border-b px-lg py-md">
        <span className="bg-primary text-on-primary flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
          3
        </span>
        <div>
          <h2 className="text-label-md text-on-surface font-bold">Thêm Groups & Phân loại</h2>
          <p className="text-body-sm text-on-surface-variant">
            {platform === "linkedin" ? "LinkedIn" : "Facebook"} — bấm row để mở taxonomy
          </p>
        </div>
        <span className="text-on-surface-variant text-body-sm ml-auto">
          {fields.length} group đang nhập
        </span>
      </div>

      <div className="space-y-md p-lg">
        <div className="bg-surface-container-low text-on-surface-variant flex flex-wrap gap-md rounded-lg px-md py-sm text-[11px]">
          <span>Ngành · Team · ICP · Tier</span>
          <span className="text-primary">👆 Bấm vào row để mở taxonomy</span>
        </div>

        {platform === "linkedin" && !d.email.trim() ? (
          <p className="text-body-sm text-error border-error-container rounded-lg border px-md py-sm" role="alert">
            Cần email LinkedIn trong form crawl phía dưới (hoặc trang Crawler trực tiếp).
          </p>
        ) : null}

        <div className="flex flex-col gap-sm">
          {fields.map((field, index) => {
            const entry = entries[index] ?? emptyUnifiedGroupEntry(platform);
            const isOpen = expanded.has(index);
            const tags = taxonomyTags(entry);
            const rowErr = errors.entries?.[index];

            return (
              <div
                key={field.id}
                className={cn(
                  "overflow-hidden rounded-xl border bg-surface-container-lowest transition-colors",
                  isOpen ? "border-primary bg-surface" : "border-outline-variant",
                  rowErr ? "border-error" : "",
                )}
              >
                <div
                  className={cn(
                    "grid cursor-pointer grid-cols-[auto_1fr_auto_auto_auto] items-center gap-sm px-md py-sm sm:grid-cols-[auto_1fr_1fr_auto_auto]",
                    isOpen && "border-outline-variant border-b bg-surface-container-low/50",
                  )}
                  onClick={() => toggleExpand(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") toggleExpand(index);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="bg-surface-container text-on-surface-variant flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{entry.name || "— Tên group —"}</p>
                    <p className="text-on-surface-variant truncate text-[10px]">
                      {entry.url.replace(/^https?:\/\//, "") || "url…"}
                    </p>
                  </div>
                  <div className="hidden flex-wrap gap-1 sm:flex">
                    {tags.length ? (
                      tags.map((t) => (
                        <span key={t.key} className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", t.cls)}>
                          {t.label}
                        </span>
                      ))
                    ) : (
                      <span className="text-on-surface-variant text-[10px] italic">Chưa phân loại</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="border-outline-variant hover:border-primary size-7 rounded-lg border text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(index);
                    }}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? "▲" : "▼"}
                  </button>
                  <button
                    type="button"
                    className="text-error hover:bg-error-container/30 size-7 rounded-lg text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fields.length > 1) remove(index);
                    }}
                    disabled={fields.length <= 1}
                    aria-label="Xóa dòng"
                  >
                    <MaterialIcon name="delete" className="text-[18px]" />
                  </button>
                </div>

                {isOpen ? (
                  <div className="space-y-md p-md">
                    <div className="grid grid-cols-1 gap-md md:grid-cols-3">
                      <div>
                        <label className={LABEL}>Tên group *</label>
                        <input className={INPUT} {...register(`entries.${index}.name`)} />
                      </div>
                      <div className="md:col-span-2">
                        <label className={LABEL}>URL Group *</label>
                        <input
                          className={INPUT}
                          placeholder={
                            platform === "linkedin"
                              ? "https://www.linkedin.com/groups/…"
                              : "https://www.facebook.com/groups/…"
                          }
                          {...register(`entries.${index}.url`)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
                      <div>
                        <label className={LABEL}>
                          {platform === "linkedin" ? "Loại nhóm *" : "Intent *"}
                        </label>
                        <select className={INPUT} {...register(`entries.${index}.intent`)}>
                          <option value="">— Chọn —</option>
                          {intentOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={LABEL}>Thành viên</label>
                        <input type="number" min={0} className={INPUT} {...register(`entries.${index}.member`)} />
                      </div>
                      {platform === "facebook" ? (
                        <>
                          <div>
                            <label className={LABEL}>Post/tuần</label>
                            <input type="number" min={0} className={INPUT} {...register(`entries.${index}.posts_per_week`)} />
                          </div>
                          <div>
                            <label className={LABEL}>Health score</label>
                            <input type="number" min={0} max={100} className={INPUT} {...register(`entries.${index}.health_score`)} />
                          </div>
                          <label className="flex items-center gap-sm text-sm">
                            <input type="checkbox" className="accent-primary size-4" {...register(`entries.${index}.chay_24h`)} />
                            Chạy 24h
                          </label>
                        </>
                      ) : null}
                    </div>
                    <GroupTaxonomyFields
                      industry={entry.industry ?? ""}
                      tier={entry.tier ?? ""}
                      team={entry.team ?? ""}
                      icp={entry.icp ?? ""}
                      icp_desc={entry.icp_desc ?? ""}
                      onIndustryChange={(v) => setValue(`entries.${index}.industry`, v)}
                      onTierChange={(v) => setValue(`entries.${index}.tier`, v === "" ? undefined : v)}
                      onTeamChange={(v) => setValue(`entries.${index}.team`, v)}
                      onIcpChange={(v) => setValue(`entries.${index}.icp`, v)}
                      onIcpDescChange={(v) => setValue(`entries.${index}.icp_desc`, v)}
                      disabled={busy}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className="border-primary text-primary rounded-lg border border-dashed px-md py-sm text-xs font-bold"
            onClick={() => {
              const idx = fields.length;
              append(emptyUnifiedGroupEntry(platform));
              setExpanded((p) => new Set(p).add(idx));
            }}
            disabled={busy}
          >
            + Thêm dòng group
          </button>
          <span className="flex-1" />
          <button
            type="button"
            className="bg-primary text-on-primary rounded-lg px-lg py-sm text-sm font-bold disabled:opacity-50"
            onClick={() => void onSaveAll()}
            disabled={busy}
          >
            {busy ? "Đang lưu…" : "Lưu nhóm lên hệ thống"}
          </button>
        </div>

        {feedback ? (
          <p
            className={cn(
              "rounded-lg border px-md py-sm text-body-sm",
              feedback.type === "ok"
                ? "border-secondary-container bg-secondary-container/20 text-on-secondary-container"
                : "border-error-container bg-error-container/30 text-error",
            )}
            role="status"
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
