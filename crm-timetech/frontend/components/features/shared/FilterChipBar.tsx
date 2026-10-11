"use client";

import { cn } from "@/lib/utils";

export interface FilterChipOption {
  id: string;
  label: string;
}

export function FilterChipBar({
  label,
  options,
  activeId,
  onChange,
}: {
  label: string;
  options: FilterChipOption[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-sm">
      <span className="text-on-surface-variant min-w-[70px] shrink-0 text-[11px] font-semibold">
        {label}
      </span>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "rounded-full border px-md py-0.5 text-[11px] font-medium transition-colors",
            activeId === opt.id
              ? "border-primary bg-primary/10 text-primary font-bold"
              : "border-outline-variant bg-surface-container-low text-on-surface-variant hover:border-primary/50",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
