"use client";

import { cn } from "@/lib/utils";

export interface PlatformStatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  hintTone?: "up" | "down" | "neutral";
  accent?: "primary" | "secondary" | "success" | "warning" | "error";
}

const accentBorder: Record<NonNullable<PlatformStatCardProps["accent"]>, string> = {
  primary: "border-l-primary",
  secondary: "border-l-slate-400",
  success: "border-l-[var(--color-success,#22c55e)]",
  warning: "border-l-[var(--color-warning,#f59e0b)]",
  error: "border-l-error",
};

const hintCls: Record<NonNullable<PlatformStatCardProps["hintTone"]>, string> = {
  up: "text-[var(--color-success,#16a34a)]",
  down: "text-error",
  neutral: "text-on-surface-variant",
};

export function PlatformStatCard({
  label,
  value,
  hint,
  hintTone = "neutral",
  accent = "primary",
}: PlatformStatCardProps) {
  return (
    <div
      className={cn(
        "border-outline-variant bg-surface relative overflow-hidden rounded-xl border border-l-4 p-md",
        accentBorder[accent],
      )}
    >
      <p className="text-on-surface-variant text-[10px] font-bold tracking-wide uppercase">
        {label}
      </p>
      <p className="text-on-surface mt-1 text-2xl font-extrabold tabular-nums leading-none">
        {typeof value === "number" ? value.toLocaleString("vi-VN") : value}
      </p>
      {hint ? (
        <p className={cn("mt-1.5 text-[11px] font-semibold", hintCls[hintTone])}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PlatformStatsRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-lg grid grid-cols-1 gap-sm sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </div>
  );
}
